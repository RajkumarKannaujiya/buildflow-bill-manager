import { BillStatus, Prisma, Role } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { requireUser, requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { billInput } from "@/lib/validation";
import { HttpError, ensureSameOrigin, jsonError, requestIp } from "@/lib/http";
import { recordAudit, changeStatus } from "@/lib/audit";
import { savePrivateFile, deletePrivateFile } from "@/lib/storage";
import { validateDocument } from "@/app/api/bills/route";
import { notifyRoles, notifyUsers } from "@/lib/notifications";
import { sendWorkflowEmail, workflowRecipients } from "@/lib/email";

const include = { vendor: { select: { id: true, name: true, companyName: true, gstin: true, mobile: true, email: true } }, project: true,
  createdBy: { select: { id: true, name: true, email: true, role: true } }, documents: true,
  payment: { include: { paidBy: { select: { id: true, name: true } } } },
  history: { include: { user: { select: { name: true, role: true } } }, orderBy: { createdAt: "asc" as const } } };

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireUser(request);
    const { id } = await context.params;
    const bill = await db.bill.findUnique({ where: { id }, include });
    if (!bill) throw new HttpError(404, "Bill not found.");
    const audit = await db.auditLog.findMany({ where: { billId: id }, orderBy: { createdAt: "asc" }, select: { id: true, userName: true, role: true, action: true, previous: true, next: true, remarks: true, ...(session.role === Role.ADMIN ? { ipAddress: true } : {}), createdAt: true } });
    const currency = await db.setting.findUnique({ where: { key: "currency" } });
    return NextResponse.json({ bill, audit, currency: String(currency?.value || "INR") });
  } catch (error) { return jsonError(error); }
}

export async function PUT(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  let documentKey: string | undefined;
  let committed = false;
  try {
    ensureSameOrigin(request);
    const actor = await requireRole([Role.TEAM_1], request);
    const { id } = await context.params;
    const form = await request.formData();
    const input = billInput.parse(Object.fromEntries([...form.entries()].filter(([key]) => key !== "document")));
    const intent = String(form.get("intent") || "submit") === "draft" ? "draft" : "submit";
    const file = form.get("document");
    if (file instanceof File && file.size > 0) { await validateDocument(file); documentKey = await savePrivateFile(file, "bill"); }
    const bill = await db.bill.findUnique({ where: { id }, include: { documents: true } });
    if (!bill) throw new HttpError(404, "Bill not found.");
    const isDraft = bill.currentStatus === BillStatus.DRAFT;
    if ((!isDraft && bill.currentStatus !== BillStatus.CORRECTION_REQUIRED) || bill.createdById !== actor.id) throw new HttpError(409, "Only the bill owner can edit a draft or a bill that needs correction.");
    if (isDraft && intent !== "draft") throw new HttpError(409, "Save the draft before submitting it.");
    if (!isDraft && intent !== "submit") throw new HttpError(409, "A corrected bill must be resubmitted to verification.");
    if (intent === "submit" && !bill.documents.length && !documentKey) throw new HttpError(400, "Please upload the bill document.");
    const duplicate = await db.bill.findFirst({ where: { billNumber: input.billNumber, id: { not: id } } });
    if (duplicate) throw new HttpError(409, duplicate.currentStatus === "PAID" ? "ALREADY PAID – This bill cannot be submitted again." : "BILL ALREADY IN PROCESS");
    const [vendor, project] = await Promise.all([db.vendor.findUnique({ where: { id: input.vendorId } }), db.project.findUnique({ where: { id: input.projectId } })]);
    if (!vendor?.active) throw new HttpError(400, "Select an active vendor.");
    if (!project || project.status !== "ACTIVE") throw new HttpError(400, "Select an active project.");
    const total = new Prisma.Decimal(input.billAmount).plus(input.gstAmount).plus(input.otherCharges);
    const updated = await db.$transaction(async (tx) => {
      await tx.bill.update({ where: { id }, data: { billNumber: input.billNumber, vendorId: input.vendorId, projectId: input.projectId, description: input.description,
        billDate: new Date(input.billDate), billAmount: input.billAmount, gstAmount: input.gstAmount, otherCharges: input.otherCharges, totalAmount: total,
        vendorContact: input.vendorContact, vendorEmail: input.vendorEmail || undefined, projectLocation: input.projectLocation, workCategory: input.workCategory,
        remarks: input.remarks, currentStatus: intent === "draft" ? BillStatus.DRAFT : BillStatus.SUBMITTED, ...(intent === "submit" ? { submissionDate: new Date() } : {}), ...(file instanceof File && file.size > 0 ? { documents: { create: { storageKey: documentKey!, originalName: file.name.slice(0, 250), mimeType: file.type, sizeBytes: file.size } } } : {}) } });
      if (intent === "submit") await changeStatus(tx, { id, currentStatus: bill.currentStatus }, actor, BillStatus.SUBMITTED, "BILL_RESUBMITTED", input.remarks, requestIp(request));
      else await tx.billStatusHistory.create({ data: { billId: id, userId: actor.id, previous: BillStatus.DRAFT, next: BillStatus.DRAFT, action: "BILL_DRAFT_UPDATED", remarks: input.remarks } });
      await recordAudit(tx, { actor, billId: id, action: intent === "draft" ? "BILL_DRAFT_UPDATED" : "BILL_CORRECTION_SAVED", previous: bill.currentStatus, next: intent === "draft" ? BillStatus.DRAFT : BillStatus.SUBMITTED, remarks: input.remarks, ipAddress: requestIp(request) });
      return tx.bill.findUnique({ where: { id }, include });
    });
    committed = true;
    if (intent === "submit") try {
      await notifyRoles([Role.TEAM_2, Role.ADMIN], "Corrected bill resubmitted", `Bill ${input.billNumber} is ready for verification again.`, `/bills/${id}`, id);
      await notifyUsers([actor.id], "Bill resubmitted", `Bill ${input.billNumber} was resubmitted to Team 2.`, `/bills/${id}`, id);
      const recipients = await workflowRecipients(actor.id, [Role.TEAM_1, Role.TEAM_2, Role.ADMIN]);
      await sendWorkflowEmail({ to: recipients, subject: `Bill Resubmitted - ${input.billNumber}`, heading: "Corrected bill resubmitted", details: [["Bill number", input.billNumber], ["Vendor", vendor.name], ["Project", project.name], ["Amount", money(total.toString())], ["Submitted by", actor.name], ["Current status", "Submitted"]], actionUrl: `${process.env.APP_URL || request.nextUrl.origin}/bills/${id}`, billId: id, remarks: input.remarks });
    } catch (notificationError) { console.error("Resubmission notification delivery failed", notificationError); }
    return NextResponse.json({ bill: updated });
  } catch (error) { if (documentKey && !committed) await deletePrivateFile(documentKey); return jsonError(error); }
}
function money(value: string) { return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(Number(value)); }
