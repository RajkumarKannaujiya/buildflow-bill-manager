import { NextRequest, NextResponse } from "next/server";
import { clearSessionCookie } from "@/lib/auth";
import { ensureSameOrigin } from "@/lib/http";
export async function POST(request: NextRequest) {
  ensureSameOrigin(request);
  const response = NextResponse.json({ ok: true });
  response.cookies.set(clearSessionCookie());
  return response;
}
