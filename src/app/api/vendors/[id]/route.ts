import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { recordAudit } from "@/lib/audit";
import { ensureSameOrigin, HttpError, jsonError, requestIp } from "@/lib/http";
import { encryptSensitive } from "@/lib/crypto";
import { validateGstin } from "@/lib/gstin";
const schema = z.object({ name: z.string().trim().min(2).max(120).optional(), companyName: z.string().trim().max(120).optional(), gstin: z.string().trim().max(20).optional(), pan: z.string().trim().max(20).optional(), mobile: z.string().trim().max(30).optional(), email: z.string().email().or(z.literal("")).optional(), address: z.string().trim().max(300).optional(), bankDetails: z.string().trim().max(500).optional(), active: z.boolean().optional() });
export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    ensureSameOrigin(request); const actor = await requireRole([Role.ADMIN, Role.TEAM_2], request); const { id } = await context.params; const data = schema.parse(await request.json());
    if (actor.role === Role.TEAM_2 && (data.bankDetails !== undefined || data.pan !== undefined)) throw new HttpError(403, "Only Admin can edit vendor tax or bank details.");
    const gstin = data.gstin?.replace(/[^a-z0-9]/gi, "").toUpperCase();
    if (gstin && !validateGstin(gstin).valid) throw new HttpError(400, validateGstin(gstin).message);
    const current = await db.vendor.findUnique({ where: { id }, select: { id: true } }); if (!current) throw new HttpError(404, "Vendor not found.");
    const updated = await db.vendor.update({ where: { id }, data: { ...data, gstin: gstin || undefined, email: data.email || undefined, bankDetails: encryptSensitive(data.bankDetails) }, select: { id: true, name: true, companyName: true, gstin: true, mobile: true, email: true, active: true } });
    await recordAudit(db, { actor, action: "VENDOR_UPDATED", remarks: `Vendor ${updated.name} updated`, ipAddress: requestIp(request), metadata: { targetVendorId: id, changedFields: Object.keys(data).filter((key) => key !== "bankDetails") } });
    return NextResponse.json({ vendor: updated });
  } catch (error) { return jsonError(error); }
}
