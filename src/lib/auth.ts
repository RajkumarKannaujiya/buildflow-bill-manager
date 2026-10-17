import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { NextRequest } from "next/server";
import { Role } from "@prisma/client";
import { HttpError } from "@/lib/http";
import { db } from "@/lib/db";

const COOKIE = "buildflow_session";
const secret = () => {
  const value = process.env.AUTH_SECRET;
  if (!value || value.length < 32) throw new Error("AUTH_SECRET must contain at least 32 characters.");
  return new TextEncoder().encode(value);
};

export type SessionUser = { id: string; name: string; email: string; role: Role };
export async function createSessionToken(user: SessionUser) {
  return new SignJWT({ id: user.id, name: user.name, email: user.email, role: user.role }).setProtectedHeader({ alg: "HS256" }).setSubject(user.id).setIssuedAt().setExpirationTime("8h").sign(secret());
}
export async function getSession(request?: NextRequest): Promise<SessionUser | null> {
  const token = request ? request.cookies.get(COOKIE)?.value : (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret());
    if (!payload.sub || !payload.email || !payload.role) return null;
    return { id: String(payload.sub), name: String(payload.name), email: String(payload.email), role: payload.role as Role };
  } catch { return null; }
}
export function setSessionCookie(token: string) {
  return { name: COOKIE, value: token, httpOnly: true, sameSite: "strict" as const, secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 8 };
}
export function clearSessionCookie() { return { name: COOKIE, value: "", httpOnly: true, sameSite: "strict" as const, secure: process.env.NODE_ENV === "production", path: "/", maxAge: 0 }; }
export async function requireUser(request?: NextRequest) {
  const user = await getSession(request);
  if (!user) throw new HttpError(401, "Please sign in to continue.");
  const dbUser = await db.user.findUnique({ where: { id: user.id }, select: { active: true } });
  if (!dbUser?.active) throw new HttpError(401, "Your account is inactive.");
  return user;
}
export async function requireRole(roles: Role[], request?: NextRequest) {
  const user = await requireUser(request);
  if (!roles.includes(user.role)) throw new HttpError(403, "You do not have permission to perform this action.");
  return user;
}
