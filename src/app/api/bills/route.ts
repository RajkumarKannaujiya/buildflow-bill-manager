import { BillStatus, Prisma, Role } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { requireRole, requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { notifyRoles } from "@/lib/notifications";
import { sendWorkflowEmail, workflowRecipients } from "@/lib/email";
import { HttpError, ensureSameOrigin, jsonError, requestIp } from "@/lib/http";
import { savePrivateFile, deletePrivateFile } from "@/lib/storage";
import { billInput } from "@/lib/validation";
import { recordAudit, changeStatus } from "@/lib/audit";

const include = {
  vendor: { select: { id: true, name: true, companyName: true, gstin: true, gstRegistered: true, mobile: true, email: true } },
  project: true, createdBy: { select: { id: true, name: true, email: true, role: true } }, documents: true, lineItems: { orderBy: { sortOrder: "asc" as const } },
  payment: { include: { paidBy: { select: { id: true, name: true } } } },
  history: { include: { user: { select: { name: true, role: true } } }, orderBy: { createdAt: "asc" as const } },
};

export async function GET(request: NextRequest) {
  try {
    await requireUser(request);
    const q = request.nextUrl.searchParams;
    const search = q.get("search")?.trim();
    const status = q.get("status") as BillStatus | null;
    const projectId = q.get("projectId") || undefined;
    const vendorId = q.get("vendorId") || undefined;
    const submittedById = q.get("submittedById") || undefined;
    const approvedById = q.get("approvedById") || undefined;
    const paidById = q.get("paidById") || undefined;
    const from = q.get("from"), to = q.get("to"), min = q.get("minAmount"), max = q.get("maxAmount");
    const where: Prisma.BillWhereInput = {
      deletedAt: null,
      ...(status && Object.values(BillStatus).includes(status) ? { currentStatus: status } : {}),
      ...(projectId ? { projectId } : {}), ...(vendorId ? { vendorId } : {}),
      ...(submittedById ? { createdById: submittedById } : {}),
      ...(approvedById ? { history: { some: { action: "BILL_APPROVED", userId: approvedById } } } : {}),
      ...(paidById ? { payment: { paidById } } : {}),
      ...(from || to ? { billDate: { ...(from ? { gte: new Date(from) } : {}), ...(to ? { lte: new Date(`${to}T23:59:59.999Z`) } : {}) } } : {}),
      ...(min || max ? { totalAmount: { ...(min ? { gte: new Prisma.Decimal(min) } : {}), ...(max ? { lte: new Prisma.Decimal(max) } : {}) } } : {}),
      ...(search ? { OR: [
        { billNumber: { contains: search, mode: "insensitive" } },
        { vendor: { name: { contains: search, mode: "insensitive" } } },
        { project: { name: { contains: search, mode: "insensitive" } } },
        { payment: { utrNumber: { contains: search, mode: "insensitive" } } },
        { payment: { paymentReference: { contains: search, mode: "insensitive" } } },
      ] } : {}),
    };
    const bills = await db.bill.findMany({ where, include, orderBy: { createdAt: "desc" }, take: 300 });
    return NextResponse.json({ bills });
  } catch (error) { return jsonError(error); }
}

export async function POST(request: NextRequest) {
  let savedKey: string | undefined;
  let committed = false;
  try {
    ensureSameOrigin(request);
    const actor = await requireRole([Role.TEAM_1], request);
    const form = await request.formData();
    const raw = Object.fromEntries([...form.entries()].filter(([key]) => key !== "document"));
    const intent = String(form.get("intent") || "submit") === "draft" ? "draft" : "submit";
    const input = billInput.parse(raw);
    const gstSetting = await db.setting.findUnique({ where: { key: "gstEnabled" } });
    if (gstSetting?.value === false && input.gstAmount > 0) throw new HttpError(400, "GST is currently disabled in company settings.");
    const file = form.get("document");
    if (!(file instanceof File) || file.size === 0) {
      if (intent === "submit") throw new HttpError(400, "Please upload the bill document.");
    } else await validateDocument(file);
    const vendor = await db.vendor.findUnique({ where: { id: input.vendorId }, select: { id: true, name: true, gstRegistered: true, active: true } });
    const project = await db.project.findUnique({ where: { id: input.projectId }, select: { id: true, name: true, location: true, status: true } });
    if (!vendor?.active) throw new HttpError(400, "Select an active vendor.");
    if (!vendor.gstRegistered && input.gstAmount > 0) throw new HttpError(400, "This vendor is marked non-GST. Set the bill GST amount to ₹0.");
    if (!project || project.status !== "ACTIVE") throw new HttpError(400, "Select an active project.");
    const exact = await db.bill.findFirst({ where: { vendorId: vendor.id, billNumber: input.billNumber, projectId: project.id }, include: { payment: { include: { paidBy: true } }, vendor: true, project: true } });
    const global = exact ? null : await db.bill.findFirst({ where: { billNumber: input.billNumber }, include: { payment: { include: { paidBy: true } }, vendor: true, project: true } });
    const duplicate = exact || global;
    if (duplicate) {
      const paid = duplicate.currentStatus === BillStatus.PAID || !!duplicate.payment;
      await recordAudit(db, { actor, billId: duplicate.id, action: "DUPLICATE_ATTEMPT", previous: duplicate.currentStatus, next: "DUPLICATE", remarks: `Submission blocked for bill ${input.billNumber}`, ipAddress: requestIp(request), metadata: { attemptedVendor: vendor.name, attemptedProject: project.name } });
      await notifyRoles([Role.TEAM_1, Role.TEAM_2], paid ? "Already paid bill blocked" : "Bill already in process", `${input.billNumber} was blocked as a duplicate.`, `/bills/${duplicate.id}`, duplicate.id);
      const recipients = await workflowRecipients(actor.id, [Role.TEAM_1, Role.TEAM_2]);
      const detailRows: Array<[string, string]> = [["Bill number", input.billNumber], ["Vendor", duplicate.vendor.name], ["Project", duplicate.project.name]];
      if (duplicate.payment) detailRows.push(["Paid amount", money(duplicate.payment.paidAmount.toString())], ["Payment date", duplicate.payment.paymentDate.toLocaleDateString("en-IN")], ["Payment reference", duplicate.payment.paymentReference || duplicate.payment.utrNumber || "—"], ["Paid by", duplicate.payment.paidBy.name]);
      else detailRows.push(["Current status", duplicate.currentStatus]);
      await sendWorkflowEmail({ to: recipients, subject: `Duplicate / Already Paid Bill Detected - ${input.billNumber}`, heading: paid ? "ALREADY PAID" : "BILL ALREADY IN PROCESS", details: detailRows, actionUrl: `${process.env.APP_URL || request.nextUrl.origin}/bills/${duplicate.id}`, billId: duplicate.id });
      return NextResponse.json({ error: paid ? "ALREADY PAID – This bill cannot be submitted again." : "BILL ALREADY IN PROCESS", duplicate: { ...duplicate, paidAmount: duplicate.payment?.paidAmount.toString(), paymentDate: duplicate.payment?.paymentDate, paymentReference: duplicate.payment?.paymentReference || duplicate.payment?.utrNumber } }, { status: 409 });
    }
    const lineItems = intent === "submit" && !input.lineItems.length
      ? [{ description: input.workCategory || "Materials / work as described in bill", quantity: 1, unit: "lot", rate: input.billAmount }]
      : input.lineItems;
    const lineItemData = lineItems.map((item, sortOrder) => {
      const quantity = new Prisma.Decimal(item.quantity), rate = new Prisma.Decimal(item.rate);
      return { description: item.description, quantity, unit: item.unit, rate, amount: quantity.mul(rate).toDecimalPlaces(2), sortOrder };
    });
    const lineSubtotal = lineItemData.reduce((sum, item) => sum.plus(item.amount), new Prisma.Decimal(0));
    if (lineItemData.length && lineSubtotal.comparedTo(input.billAmount) !== 0) throw new HttpError(400, "Bill amount must match the material/work item subtotal.");
    const total = new Prisma.Decimal(input.billAmount).plus(input.gstAmount).plus(input.otherCharges);
    if (file instanceof File && file.size > 0) savedKey = await savePrivateFile(file, "bill");
    const bill = await db.$transaction(async (tx) => {
      const created = await tx.bill.create({ data: {
        billNumber: input.billNumber, vendorId: vendor.id, projectId: project.id, description: input.description,
        billDate: new Date(input.billDate), submissionDate: new Date(), billAmount: input.billAmount, gstAmount: input.gstAmount,
        otherCharges: input.otherCharges, totalAmount: total, vendorContact: input.vendorContact, vendorEmail: input.vendorEmail || undefined,
        projectLocation: input.projectLocation || project.location, workCategory: input.workCategory, remarks: input.remarks,
        currentStatus: BillStatus.DRAFT, createdById: actor.id,
        ...(lineItemData.length ? { lineItems: { create: lineItemData } } : {}),
        ...(savedKey && file instanceof File ? { documents: { create: { storageKey: savedKey, originalName: file.name.slice(0, 250), mimeType: file.type, sizeBytes: file.size } } } : {}),
      } });
      await recordAudit(tx, { actor, billId: created.id, action: "BILL_CREATED", next: BillStatus.DRAFT, remarks: input.remarks, ipAddress: requestIp(request) });
      if (intent === "submit") await changeStatus(tx, created, actor, BillStatus.SUBMITTED, "BILL_SUBMITTED", input.remarks, requestIp(request));
      else await tx.billStatusHistory.create({ data: { billId: created.id, userId: actor.id, previous: BillStatus.DRAFT, next: BillStatus.DRAFT, action: "BILL_CREATED", remarks: input.remarks } });
      return created;
    });
    committed = true;
    if (intent === "submit") try {
      const recipients = await workflowRecipients(actor.id, [Role.TEAM_1, Role.TEAM_2, Role.ADMIN]);
      await notifyRoles([Role.TEAM_1, Role.TEAM_2, Role.ADMIN], "New bill submitted", `Bill ${bill.billNumber} is ready for verification.`, `/bills/${bill.id}`, bill.id);
      await sendWorkflowEmail({ to: recipients, subject: `New Bill Submitted - ${bill.billNumber} - ${project.name}`, heading: "New bill submitted", details: [["Bill number", bill.billNumber], ["Vendor", vendor.name], ["Project", project.name], ["Amount", money(total.toString())], ["Submitted by", actor.name], ["Current status", "Submitted"]], actionUrl: `${process.env.APP_URL || request.nextUrl.origin}/bills/${bill.id}`, billId: bill.id });
    } catch (notificationError) { console.error("Bill notification delivery failed", notificationError); }
    return NextResponse.json({ bill: await db.bill.findUnique({ where: { id: bill.id }, include }) }, { status: 201 });
  } catch (error) {
    if (savedKey && !committed) await deletePrivateFile(savedKey);
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return NextResponse.json({ error: "BILL ALREADY IN PROCESS" }, { status: 409 });
    return jsonError(error);
  }
}

export async function validateDocument(file: File) {
  const max = Number(process.env.MAX_UPLOAD_MB || 10) * 1024 * 1024;
  if (file.size > max) throw new HttpError(413, `File must be ${process.env.MAX_UPLOAD_MB || 10} MB or smaller.`);
  const signatures: Record<string, (bytes: Uint8Array) => boolean> = {
    "application/pdf": (b) => String.fromCharCode(...b.slice(0, 5)) === "%PDF-",
    "image/jpeg": (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
    "image/png": (b) => b.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => b[i] === v),
    "image/webp": (b) => String.fromCharCode(...b.slice(0, 4)) === "RIFF" && String.fromCharCode(...b.slice(8, 12)) === "WEBP",
  };
  const valid = signatures[file.type];
  if (!valid) throw new HttpError(400, "Upload a PDF, JPG, PNG, or WEBP file.");
  if (!valid(new Uint8Array(await file.slice(0, 16).arrayBuffer()))) throw new HttpError(400, "The uploaded file does not match its PDF or image type.");
}
function money(value: string) { return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(Number(value)); }
