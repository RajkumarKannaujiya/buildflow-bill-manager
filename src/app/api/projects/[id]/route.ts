import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { recordAudit } from "@/lib/audit";
import { ensureSameOrigin, HttpError, jsonError, requestIp } from "@/lib/http";
const schema = z.object({ name: z.string().trim().min(2).max(120).optional(), code: z.string().trim().min(2).max(24).transform((v) => v.toUpperCase()).optional(), clientName: z.string().trim().max(120).optional(), location: z.string().trim().min(2).max(200).optional(), startDate: z.string().optional(), expectedEndDate: z.string().optional(), status: z.enum(["ACTIVE", "ON_HOLD", "COMPLETED"]).optional() });
export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    ensureSameOrigin(request); const actor = await requireRole([Role.ADMIN], request); const { id } = await context.params; const d = schema.parse(await request.json());
    const current = await db.project.findUnique({ where: { id }, select: { id: true } }); if (!current) throw new HttpError(404, "Project not found.");
    const project = await db.project.update({ where: { id }, data: { ...d, startDate: d.startDate ? new Date(d.startDate) : undefined, expectedEndDate: d.expectedEndDate ? new Date(d.expectedEndDate) : undefined } });
    await recordAudit(db, { actor, action: "PROJECT_UPDATED", remarks: `Project ${project.code} updated`, ipAddress: requestIp(request), metadata: { targetProjectId: id, changedFields: Object.keys(d) } });
    return NextResponse.json({ project });
  } catch (error) { return jsonError(error); }
}
