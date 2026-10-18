import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";

export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export function jsonError(error: unknown) {
  if (error instanceof HttpError) return NextResponse.json({ error: error.message }, { status: error.status });
  if (error instanceof ZodError) return NextResponse.json({ error: "Please check the highlighted fields.", issues: error.flatten().fieldErrors }, { status: 400 });
  console.error(error);
  return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
}

export function requestIp(request: NextRequest) {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || undefined;
}

export function ensureSameOrigin(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (!origin) return;
  let submittedOrigin: string;
  try { submittedOrigin = new URL(origin).origin; }
  catch { throw new HttpError(403, "Request origin is not allowed."); }
  const allowed = new Set<string>([request.nextUrl.origin]);
  for (const candidate of [process.env.APP_URL, process.env.URL, process.env.DEPLOY_PRIME_URL, process.env.DEPLOY_URL]) {
    if (!candidate) continue;
    try { allowed.add(new URL(candidate).origin); } catch { /* Ignore malformed optional deployment URLs. */ }
  }
  if (!allowed.has(submittedOrigin)) throw new HttpError(403, "Request origin is not allowed.");
}
