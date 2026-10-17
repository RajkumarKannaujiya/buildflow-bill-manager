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
  const expected = process.env.APP_URL || request.nextUrl.origin;
  if (new URL(origin).origin !== new URL(expected).origin) throw new HttpError(403, "Request origin is not allowed.");
}
