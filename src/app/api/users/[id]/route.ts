import bcrypt from "bcryptjs";
import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { recordAudit } from "@/lib/audit";
import { ensureSameOrigin, HttpError, jsonError, requestIp } from "@/lib/http";
const schema = z.object({ name: z.string().trim().min(2).max(100).optional(), email: z.string().email().transform((v) => v.toLowerCase()).optional(), mobile: z.string().trim().max(30).optional(), role: z.nativeEnum(Role).optional(), department: z.string().trim().max(100).optional(), active: z.boolean().optional(), password: z.string().min(12).max(128).optional() });
export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    ensureSameOrigin(request); const actor = await requireRole([Role.ADMIN], request); const { id } = await context.params; const data = schema.parse(await request.json());
    if (id === actor.id && (data.active === false || (data.role && data.role !== Role.ADMIN))) throw new HttpError(400, "You cannot deactivate or remove your own Admin access.");
    const current = await db.user.findUnique({ where: { id }, select: { id: true, role: true, name: true } });
    if (!current) throw new HttpError(404, "User not found.");
    const { password, ...fields } = data;
    const updated = await db.user.update({ where: { id }, data: { ...fields, ...(password ? { passwordHash: await bcrypt.hash(password, 12) } : {}) }, select: { id: true, name: true, email: true, mobile: true, role: true, department: true, active: true, createdAt: true } });
    await recordAudit(db, { actor, action: "USER_UPDATED", remarks: `User access or profile updated for ${updated.email}`, ipAddress: requestIp(request), metadata: { targetUserId: id, changedFields: Object.keys(data).filter((key) => key !== "password") } });
    return NextResponse.json({ user: updated });
  } catch (error) { return jsonError(error); }
}
