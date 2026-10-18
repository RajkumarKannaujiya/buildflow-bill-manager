import { BillStatus, PaymentMethod, Prisma, Role } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { paymentInput } from "@/lib/validation";
import { HttpError, ensureSameOrigin, jsonError, requestIp } from "@/lib/http";
import { savePrivateFile, deletePrivateFile } from "@/lib/storage";
import { changeStatus, recordAudit } from "@/lib/audit";
import { notifyRoles } from "@/lib/notifications";
import { sendWorkflowEmail, workflowRecipients } from "@/lib/email";
import { validateDocument } from "@/app/api/bills/route";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  let proofKey: string | undefined;
  let committed = false;
  try {
    ensureSameOrigin(request);
    const actor = await requireRole([Role.TEAM_2], request);
    const { id } = await context.params;
    const form = await request.formData();
    const raw = Object.fromEntries([...form.entries()].filter(([key]) => key !== "paymentProof"));
    const input = paymentInput.parse(raw);
    const proof = form.get("paymentProof");
    if (proof instanceof File && proof.size > 0) { await validateDocument(proof); proofKey = await savePrivateFile(proof, "payment"); }
    const paidBill = await db.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ id: string; currentStatus: BillStatus }>>`SELECT id, "currentStatus" FROM "Bill" WHERE id = ${id} AND "deletedAt" IS NULL FOR UPDATE`;
      if (!locked.length) throw new HttpError(404, "Bill not found.");
      const bill = await tx.bill.findFirst({ where: { id, deletedAt: null }, include: { vendor: true, project: true, payment: true, createdBy: true } });
      if (!bill) throw new HttpError(404, "Bill not found.");
      if (bill.currentStatus === BillStatus.PAID || bill.payment) throw new HttpError(409, "PAYMENT ALREADY COMPLETED");
      if (bill.currentStatus !== BillStatus.PAYMENT_PENDING) throw new HttpError(409, "Payment cannot be made until Admin approval.");
      const duplicate = await tx.bill.findFirst({ where: { billNumber: bill.billNumber, id: { not: id } }, include: { payment: true } });
      if (duplicate && (duplicate.currentStatus === BillStatus.PAID || duplicate.payment)) throw new HttpError(409, "A bill with this number has already been paid.");
      if (new Prisma.Decimal(input.paidAmount).comparedTo(bill.totalAmount) !== 0) throw new HttpError(400, `Paid amount must match the approved bill total of ${money(bill.totalAmount.toString())}.`);
      await recordAudit(tx, { actor, billId: id, action: "PAYMENT_INITIATED", previous: BillStatus.PAYMENT_PENDING, remarks: input.paymentRemarks, ipAddress: requestIp(request) });
      const payment = await tx.payment.create({ data: { billId: id, paymentDate: new Date(input.paymentDate), paidAmount: input.paidAmount,
        paymentMethod: input.paymentMethod as PaymentMethod, bankName: input.bankName || undefined, utrNumber: input.utrNumber || undefined,
        paymentReference: input.paymentReference || undefined, paymentRemarks: input.paymentRemarks || undefined, paymentProofKey: proofKey, paidById: actor.id } });
      await changeStatus(tx, { id, currentStatus: bill.currentStatus }, actor, BillStatus.PAID, "PAYMENT_COMPLETED", input.paymentRemarks, requestIp(request));
      return { payment, bill };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    committed = true;
    try {
      const recipients = await workflowRecipients(paidBill.bill.createdById, [Role.TEAM_1, Role.TEAM_2, Role.ADMIN]);
      await notifyRoles([Role.TEAM_1, Role.TEAM_2, Role.ADMIN], "Bill payment completed", `Bill ${paidBill.bill.billNumber} has been paid.`, `/bills/${id}`, id);
      await sendWorkflowEmail({ to: recipients, subject: `Bill Paid - ${paidBill.bill.billNumber}`, heading: "Payment completed", details: [["Bill number", paidBill.bill.billNumber], ["Vendor", paidBill.bill.vendor.name], ["Project", paidBill.bill.project.name], ["Paid amount", money(paidBill.payment.paidAmount.toString())], ["Payment date", paidBill.payment.paymentDate.toLocaleDateString("en-IN")], ["Payment method", paidBill.payment.paymentMethod.replaceAll("_", " ")], ["UTR / transaction", paidBill.payment.utrNumber || "—"], ["Payment reference", paidBill.payment.paymentReference || "—"], ["Paid by", actor.name]], actionUrl: `${process.env.APP_URL || request.nextUrl.origin}/bills/${id}`, billId: id });
    } catch (notificationError) { console.error("Payment notification delivery failed", notificationError); }
    return NextResponse.json({ ok: true, status: BillStatus.PAID, payment: { ...paidBill.payment, paidAmount: paidBill.payment.paidAmount.toString() } });
  } catch (error) {
    if (proofKey && !committed) await deletePrivateFile(proofKey);
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const target = String(error.meta?.target || "");
      return NextResponse.json({ error: target.toLowerCase().includes("billid") ? "PAYMENT ALREADY COMPLETED" : "This UTR or payment reference has already been recorded." }, { status: 409 });
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") return NextResponse.json({ error: "A payment is already being processed. Refresh the bill and check its status." }, { status: 409 });
    return jsonError(error);
  }
}
function money(value: string) { return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(Number(value)); }
