import bcrypt from "bcryptjs";
import { NextRequest, NextResponse } from "next/server";
import { Prisma, Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { ensureSameOrigin, jsonError } from "@/lib/http";
const schema = z.object({ name: z.string().trim().min(2).max(100), email: z.string().trim().email().transform((v) => v.toLowerCase()), mobile: z.string().trim().max(30).optional(), role: z.nativeEnum(Role), department: z.string().trim().max(100).optional(), active: z.boolean().default(true), password: z.string().min(12).max(128) });
export async function GET(request: NextRequest) {
  try { await requireRole([Role.ADMIN], request); return NextResponse.json({ users: await db.user.findMany({ select: { id: true, name: true, email: true, mobile: true, role: true, department: true, active: true, createdAt: true }, orderBy: { createdAt: "desc" } }) }); }
  catch (error) { return jsonError(error); }
}
export async function POST(request: NextRequest) {
  try {
    ensureSameOrigin(request); await requireRole([Role.ADMIN], request);
    const d = schema.parse(await request.json());
    const passwordHash = await bcrypt.hash(d.password, 12);
    const user = await db.user.create({ data: { name: d.name, email: d.email, mobile: d.mobile, role: d.role, department: d.department, active: d.active, passwordHash }, select: { id: true, name: true, email: true, mobile: true, role: true, department: true, active: true, createdAt: true } });
    return NextResponse.json({ user }, { status: 201 });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return NextResponse.json({ error: "An account with this email already exists." }, { status: 409 });
    return jsonError(error);
  }
}
