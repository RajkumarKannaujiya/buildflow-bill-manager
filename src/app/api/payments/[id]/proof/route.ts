import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { HttpError, jsonError } from "@/lib/http";
import { readPrivateFile } from "@/lib/storage";
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    await requireUser(request);
    const { id } = await context.params;
    const payment = await db.payment.findUnique({ where: { id }, include: { bill: { select: { deletedAt: true } } } });
    if (!payment?.paymentProofKey || payment.bill.deletedAt) throw new HttpError(404, "Payment proof not found.");
    const file = await readPrivateFile(payment.paymentProofKey);
    return new NextResponse(file.bytes, { headers: { "Content-Type": file.contentType, "Content-Disposition": "inline", "X-Content-Type-Options": "nosniff", "Cache-Control": "private, no-store" } });
  } catch (error) { return jsonError(error); }
}
