import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { ensureSameOrigin, jsonError } from "@/lib/http";
import { z } from "zod";
export async function GET(request: NextRequest) {
  try {
    const user = await requireUser(request);
    const notifications = await db.notification.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, take: 50 });
    return NextResponse.json({ notifications });
  } catch (error) { return jsonError(error); }
}
export async function POST(request: NextRequest) {
  try {
    ensureSameOrigin(request);
    const user = await requireUser(request);
    const body = z.object({ ids: z.array(z.string()).optional(), all: z.boolean().optional() }).parse(await request.json());
    await db.notification.updateMany({ where: { userId: user.id, readAt: null, ...(body.all ? {} : { id: { in: body.ids || [] } }) }, data: { readAt: new Date() } });
    return NextResponse.json({ ok: true });
  } catch (error) { return jsonError(error); }
}
