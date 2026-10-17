import bcrypt from "bcryptjs";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { createSessionToken, setSessionCookie } from "@/lib/auth";
import { ensureSameOrigin, HttpError, jsonError } from "@/lib/http";
import { z } from "zod";

const schema = z.object({ email: z.string().email().transform((v) => v.toLowerCase()), password: z.string().min(1).max(200) });
export async function POST(request: NextRequest) {
  try {
    ensureSameOrigin(request);
    const data = schema.parse(await request.json());
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0] || "unknown";
    const identifier = await import("node:crypto").then(({ createHash }) => createHash("sha256").update(`${ip}:${data.email}`).digest("hex"));
    const attempt = await db.loginAttempt.findUnique({ where: { identifier } });
    if (attempt && attempt.expiresAt > new Date() && attempt.count >= 10) throw new HttpError(429, "Too many sign-in attempts. Please try again in a few minutes.");
    const user = await db.user.findUnique({ where: { email: data.email } });
    if (!user || !user.active || !(await bcrypt.compare(data.password, user.passwordHash))) {
      await db.loginAttempt.upsert({ where: { identifier }, create: { identifier, count: 1, expiresAt: new Date(Date.now() + 10 * 60_000) }, update: attempt && attempt.expiresAt > new Date() ? { count: { increment: 1 } } : { count: 1, expiresAt: new Date(Date.now() + 10 * 60_000) } });
      throw new HttpError(401, "Email or password is incorrect.");
    }
    await db.loginAttempt.deleteMany({ where: { identifier } });
    const token = await createSessionToken({ id: user.id, name: user.name, email: user.email, role: user.role });
    const response = NextResponse.json({ user: { id: user.id, name: user.name, email: user.email, role: user.role } });
    response.cookies.set(setSessionCookie(token));
    return response;
  } catch (error) { return jsonError(error); }
}
