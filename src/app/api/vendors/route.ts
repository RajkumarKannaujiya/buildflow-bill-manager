import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { z } from "zod";
import { requireRole, requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { ensureSameOrigin, HttpError, jsonError } from "@/lib/http";
import { encryptSensitive, decryptSensitive } from "@/lib/crypto";
import { validateGstin } from "@/lib/gstin";
const schema = z.object({ name: z.string().trim().min(2).max(120), companyName: z.string().trim().max(120).optional(), gstin: z.string().trim().max(20).optional(), pan: z.string().trim().max(20).optional(), mobile: z.string().trim().max(30).optional(), email: z.string().email().or(z.literal("")).optional(), address: z.string().trim().max(300).optional(), bankDetails: z.string().trim().max(500).optional(), active: z.boolean().default(true) });
export async function GET(request: NextRequest) {
  try {
    const user = await requireUser(request);
    const vendors = await db.vendor.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, companyName: true, gstin: true, pan: true, mobile: true, email: true, address: true, ...(user.role !== Role.TEAM_1 ? { bankDetails: true } : {}), active: true, createdAt: true, _count: { select: { bills: true } } } });
    return NextResponse.json({ vendors: vendors.map((v) => ({ ...v, ...(user.role !== Role.TEAM_1 ? { bankDetails: decryptSensitive(v.bankDetails) } : {}) })) });
  } catch (error) { return jsonError(error); }
}
export async function POST(request: NextRequest) {
  try {
    ensureSameOrigin(request); await requireRole([Role.ADMIN, Role.TEAM_2], request);
    const d = schema.parse(await request.json());
    const gstin = d.gstin?.replace(/[^a-z0-9]/gi, "").toUpperCase();
    if (gstin && !validateGstin(gstin).valid) throw new HttpError(400, validateGstin(gstin).message);
    const vendor = await db.vendor.create({ data: { ...d, gstin: gstin || undefined, email: d.email || undefined, bankDetails: encryptSensitive(d.bankDetails) } });
    return NextResponse.json({ vendor }, { status: 201 });
  } catch (error) { return jsonError(error); }
}
