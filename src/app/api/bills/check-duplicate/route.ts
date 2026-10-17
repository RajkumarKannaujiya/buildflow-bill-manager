import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { jsonError } from "@/lib/http";
export async function GET(request: NextRequest) {
  try {
    await requireUser(request);
    const p = request.nextUrl.searchParams;
    const billNumber = p.get("billNumber")?.trim().toUpperCase();
    if (!billNumber) return NextResponse.json({ duplicate: null });
    const vendorId = p.get("vendorId"), projectId = p.get("projectId");
    const exact = vendorId && projectId ? await db.bill.findFirst({ where: { billNumber, vendorId, projectId }, include: { vendor: { select: { name: true } }, project: { select: { name: true } }, payment: { include: { paidBy: { select: { name: true } } } } } }) : null;
    const bill = exact || await db.bill.findFirst({ where: { billNumber }, include: { vendor: { select: { name: true } }, project: { select: { name: true } }, payment: { include: { paidBy: { select: { name: true } } } } } });
    if (!bill) return NextResponse.json({ duplicate: null });
    const isPaid = bill.currentStatus === "PAID" || !!bill.payment;
    return NextResponse.json({ duplicate: { id: bill.id, billNumber: bill.billNumber, vendor: bill.vendor.name, project: bill.project.name, status: bill.currentStatus, isPaid,
      paidAmount: bill.payment?.paidAmount.toString() || null, paymentDate: bill.payment?.paymentDate || null,
      paymentReference: bill.payment?.paymentReference || bill.payment?.utrNumber || null, paidBy: bill.payment?.paidBy.name || null } });
  } catch (error) { return jsonError(error); }
}
