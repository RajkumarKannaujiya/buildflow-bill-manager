import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { z } from "zod";
import { requireRole, requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { ensureSameOrigin, jsonError } from "@/lib/http";
const schema = z.object({ name: z.string().trim().min(2).max(120), code: z.string().trim().min(2).max(24).transform((v) => v.toUpperCase()), clientName: z.string().trim().max(120).optional(), location: z.string().trim().min(2).max(200), startDate: z.string().optional(), expectedEndDate: z.string().optional(), status: z.enum(["ACTIVE", "ON_HOLD", "COMPLETED"]).default("ACTIVE") });
export async function GET(request: NextRequest) {
  try { await requireUser(request); return NextResponse.json({ projects: await db.project.findMany({ orderBy: { name: "asc" }, include: { _count: { select: { bills: { where: { deletedAt: null } } } } } }) }); }
  catch (error) { return jsonError(error); }
}
export async function POST(request: NextRequest) {
  try {
    ensureSameOrigin(request); await requireRole([Role.ADMIN], request);
    const d = schema.parse(await request.json());
    const project = await db.project.create({ data: { ...d, startDate: d.startDate ? new Date(d.startDate) : undefined, expectedEndDate: d.expectedEndDate ? new Date(d.expectedEndDate) : undefined } });
    return NextResponse.json({ project }, { status: 201 });
  } catch (error) { return jsonError(error); }
}
