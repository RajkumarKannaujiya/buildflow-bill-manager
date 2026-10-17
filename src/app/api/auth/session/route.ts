import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { jsonError } from "@/lib/http";
export async function GET(request: NextRequest) {
  try { return NextResponse.json({ user: await requireUser(request) }); }
  catch (error) { return jsonError(error); }
}
