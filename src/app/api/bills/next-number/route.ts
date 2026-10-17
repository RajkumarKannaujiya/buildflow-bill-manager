import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { jsonError } from "@/lib/http";
export async function GET(request: NextRequest) {
  try {
    await requireRole([Role.TEAM_1], request);
    const setting = await db.setting.findUnique({ where: { key: "billNumberFormat" } });
    const format = String(setting?.value || "BL-{YYYY}-{####}");
    const year = new Intl.DateTimeFormat("en", { year: "numeric", timeZone: "Asia/Kolkata" }).format(new Date());
    const template = format.replaceAll("{YYYY}", year);
    const sequence = template.match(/\{(#+)\}/);
    if (!sequence) return NextResponse.json({ billNumber: template });
    const prefix = template.slice(0, sequence.index), suffix = template.slice(sequence.index! + sequence[0].length);
    const bills = await db.bill.findMany({ where: { billNumber: { startsWith: prefix } }, select: { billNumber: true } });
    let max = 0;
    for (const bill of bills) {
      if (!bill.billNumber.endsWith(suffix)) continue;
      const middle = bill.billNumber.slice(prefix.length, bill.billNumber.length - suffix.length || undefined);
      const value = Number(middle);
      if (Number.isInteger(value)) max = Math.max(max, value);
    }
    return NextResponse.json({ billNumber: `${prefix}${String(max + 1).padStart(sequence[1].length, "0")}${suffix}` });
  } catch (error) { return jsonError(error); }
}
