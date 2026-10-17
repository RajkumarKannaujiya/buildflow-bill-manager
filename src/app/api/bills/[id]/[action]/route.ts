import { BillStatus, Role } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { changeStatus } from "@/lib/audit";
import { notifyRoles } from "@/lib/notifications";
import { sendWorkflowEmail, workflowRecipients } from "@/lib/email";
import { ensureSameOrigin, HttpError, jsonError, requestIp } from "@/lib/http";
import { Prisma } from "@prisma/client";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string; action: string }> }) {
  try {
    ensureSameOrigin(request);
    const { id, action } = await context.params;
    const roles: Role[] = action === "approve" || action === "reject" ? [Role.ADMIN] : action === "request-correction" ? [Role.ADMIN, Role.TEAM_2] : action === "submit" ? [Role.TEAM_1] : [Role.TEAM_2];
    const actor = await requireRole(roles, request);
    const payload = await request.json().catch(() => ({})) as { remarks?: string; reason?: string };
    const remarks = String(payload.reason || payload.remarks || "").trim();
    const bill = await db.bill.findUnique({ where: { id }, include: { vendor: true, project: true, createdBy: true, payment: true, documents: true } });
    if (!bill) throw new HttpError(404, "Bill not found.");
    if (bill.currentStatus === BillStatus.PAID || bill.payment) throw new HttpError(409, "PAYMENT ALREADY COMPLETED");

    let next: BillStatus, event: string, title: string, message: string, subject: string, heading: string;
    if (action === "submit") {
      if (bill.currentStatus !== BillStatus.DRAFT || bill.createdById !== actor.id) throw new HttpError(409, "Only the bill owner can submit a draft bill.");
      if (!bill.documents.length) throw new HttpError(400, "Please upload the bill document.");
      next = BillStatus.SUBMITTED; event = "BILL_SUBMITTED"; title = "New bill submitted"; message = `Bill ${bill.billNumber} is ready for verification.`; subject = `New Bill Submitted - ${bill.billNumber} - ${bill.project.name}`; heading = "New bill submitted";
    } else if (action === "verify") {
      if (bill.currentStatus !== BillStatus.SUBMITTED) throw new HttpError(409, "This bill is not awaiting verification.");
      next = BillStatus.TEAM_2_REVIEW; event = "BILL_VERIFIED"; title = "Bill verified"; message = `Bill ${bill.billNumber} has been verified.`; subject = `Bill Verified - ${bill.billNumber}`; heading = "Bill verified";
    } else if (action === "send-to-admin") {
      if (bill.currentStatus !== BillStatus.TEAM_2_REVIEW) throw new HttpError(409, "Verify the bill before forwarding it to Admin.");
      next = BillStatus.ADMIN_PENDING; event = "BILL_SENT_TO_ADMIN"; title = "Bill pending Admin approval"; message = `Bill ${bill.billNumber} is pending Admin approval.`; subject = `Bill Pending Admin Approval - ${bill.billNumber}`; heading = "Bill pending Admin approval";
    } else if (action === "approve") {
      if (bill.currentStatus !== BillStatus.ADMIN_PENDING) throw new HttpError(409, "This bill is not awaiting Admin approval.");
      next = BillStatus.PAYMENT_PENDING; event = "BILL_APPROVED"; title = "Bill approved"; message = `Bill ${bill.billNumber} has been approved and is now pending payment.`; subject = `Bill Approved - ${bill.billNumber}`; heading = "Bill approved";
    } else if (action === "reject") {
      if (!remarks) throw new HttpError(400, "Enter a rejection reason.");
      if (bill.currentStatus !== BillStatus.ADMIN_PENDING) throw new HttpError(409, "This bill is not awaiting Admin approval.");
      next = BillStatus.ADMIN_REJECTED; event = "BILL_REJECTED"; title = "Bill rejected"; message = `Bill ${bill.billNumber} was rejected. ${remarks}`; subject = `Bill Rejected - ${bill.billNumber}`; heading = "Bill rejected";
    } else if (action === "request-correction" || action === "reject-team2") {
      if (!remarks) throw new HttpError(400, "Add a note describing the correction required.");
      if (actor.role === Role.ADMIN && bill.currentStatus !== BillStatus.ADMIN_PENDING) throw new HttpError(409, "This bill is not awaiting Admin approval.");
      if (actor.role === Role.TEAM_2 && !new Set<BillStatus>([BillStatus.SUBMITTED, BillStatus.TEAM_2_REVIEW]).has(bill.currentStatus)) throw new HttpError(409, "This bill cannot be returned for correction at this stage.");
      next = BillStatus.CORRECTION_REQUIRED; event = action === "reject-team2" ? "BILL_REJECTED_BY_TEAM_2" : actor.role === Role.ADMIN ? "BILL_SENT_BACK" : "BILL_CORRECTION_REQUESTED"; title = action === "reject-team2" ? "Bill rejected by Team 2" : "Bill needs correction"; message = `${bill.billNumber} ${action === "reject-team2" ? "was rejected" : "needs correction"}. ${remarks}`; subject = `${action === "reject-team2" ? "Bill Rejected" : "Bill Correction Required"} - ${bill.billNumber}`; heading = action === "reject-team2" ? "Bill rejected by Team 2" : "Bill returned for correction";
    } else throw new HttpError(404, "Unknown bill action.");

    await db.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ currentStatus: BillStatus }>>`SELECT "currentStatus" FROM "Bill" WHERE id = ${id} FOR UPDATE`;
      if (!locked.length || locked[0].currentStatus !== bill.currentStatus) throw new HttpError(409, "The bill changed while you were working. Refresh and try again.");
      if (action === "approve") {
        const intermediate = { id, currentStatus: BillStatus.ADMIN_PENDING };
        await changeStatus(tx, intermediate, actor, BillStatus.ADMIN_APPROVED, event, remarks || undefined, requestIp(request));
        await changeStatus(tx, { id, currentStatus: BillStatus.ADMIN_APPROVED }, actor, BillStatus.PAYMENT_PENDING, "PAYMENT_PENDING", remarks || undefined, requestIp(request));
      } else await changeStatus(tx, { id, currentStatus: bill.currentStatus }, actor, next, event, remarks || undefined, requestIp(request));
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    try {
      const forward = action === "send-to-admin";
      const recipients = await workflowRecipients(bill.createdById, forward ? [Role.ADMIN, Role.TEAM_1] : [Role.TEAM_1, Role.TEAM_2, Role.ADMIN]);
      await notifyRoles(forward ? [Role.ADMIN, Role.TEAM_1] : [Role.TEAM_1, Role.TEAM_2, Role.ADMIN], title, message, `/bills/${id}`, id);
      await sendWorkflowEmail({ to: recipients, subject, heading, details: [["Bill number", bill.billNumber], ["Vendor", bill.vendor.name], ["Project", bill.project.name], ["Amount", money(bill.totalAmount.toString())], ["Current status", next.replaceAll("_", " ")], ["Action by", actor.name]], actionUrl: `${process.env.APP_URL || request.nextUrl.origin}/bills/${id}`, billId: id, remarks: remarks || undefined });
    } catch (notificationError) { console.error("Workflow notification delivery failed", notificationError); }
    return NextResponse.json({ ok: true, status: next });
  } catch (error) { return jsonError(error); }
}
function money(value: string) { return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(Number(value)); }
