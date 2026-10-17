import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { jsonError } from "@/lib/http";
export async function GET(request: NextRequest) {
  try {
    await requireRole([Role.ADMIN], request);
    const q = request.nextUrl.searchParams, search = q.get("search")?.trim();
    const logs = await db.auditLog.findMany({ where: search ? { OR: [{ userName: { contains: search, mode: "insensitive" } }, { action: { contains: search, mode: "insensitive" } }, { bill: { billNumber: { contains: search, mode: "insensitive" } } }] } : {}, orderBy: { createdAt: "desc" }, take: 500, select: { id: true, billId: true, userName: true, role: true, action: true, previous: true, next: true, remarks: true, ipAddress: true, createdAt: true, bill: { select: { billNumber: true } } } });
    return NextResponse.json({ logs });
  } catch (error) { return jsonError(error); }
}
