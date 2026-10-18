import { BillStatus, PaymentMethod, PrismaClient, Role } from "@prisma/client";
import bcrypt from "bcryptjs";

const db = new PrismaClient();

async function main() {
  const passwordHash = await bcrypt.hash("Demo123!", 12);
  const users = [
    ...["Aarav Mehta", "Nisha Patel", "Kabir Sharma"].map((name, i) => ({ name, email: `team1${i + 1}@buildflow.local`, role: Role.TEAM_1, department: "Project operations" })),
    ...["Riya Nair", "Dev Malhotra", "Ishita Rao"].map((name, i) => ({ name, email: `team2${i + 1}@buildflow.local`, role: Role.TEAM_2, department: "Finance & payments" })),
    { name: "Ananya Kapoor", email: "admin@buildflow.local", role: Role.ADMIN, department: "Finance administration" },
  ];
  const userRows = [];
  for (const user of users) userRows.push(await db.user.upsert({ where: { email: user.email }, create: { ...user, passwordHash, active: true }, update: { name: user.name, role: user.role, department: user.department, active: true } }));
  const team1 = userRows.filter((u) => u.role === Role.TEAM_1), team2 = userRows.filter((u) => u.role === Role.TEAM_2), admin = userRows.find((u) => u.role === Role.ADMIN)!;
  const projectNames = ["Maple Residency", "Riverside Tower", "Cedar Business Park", "Northgate Villas", "Orchid Heights"];
  const projects = [];
  for (let i = 0; i < projectNames.length; i++) projects.push(await db.project.upsert({ where: { code: `PRJ-${String(i + 1).padStart(2, "0")}` }, create: { name: projectNames[i], code: `PRJ-${String(i + 1).padStart(2, "0")}`, clientName: ["Crestline Group", "Aster Developments"][i % 2], location: ["Whitefield, Bengaluru", "Hitech City, Hyderabad", "Baner, Pune", "Sector 74, Gurugram", "Kakkanad, Kochi"][i], status: "ACTIVE" }, update: { name: projectNames[i], status: "ACTIVE" } }));
  const vendorNames = ["Apex Civil Works", "Northstar Electricals", "Prime Concrete Co.", "Evergreen Interiors", "Solidline Steel", "Brightway Plumbing", "UrbanLift Systems", "TerraSite Materials", "Vertex Safety Services", "Blueoak Logistics"];
  const vendors = [];
  for (let i = 0; i < vendorNames.length; i++) {
    const name = vendorNames[i], existing = await db.vendor.findFirst({ where: { name } });
    vendors.push(existing ? await db.vendor.update({ where: { id: existing.id }, data: { active: true, gstRegistered: true } }) : await db.vendor.create({ data: { name, companyName: `${name} Pvt Ltd`, gstRegistered: true, gstin: `29AABCU${String(1000 + i)}K1Z${i % 9}`, mobile: `+91 98${String(70000000 + i).slice(-8)}`, email: `accounts${i + 1}@vendor.buildflow.local`, address: `${15 + i} Industrial Estate, Bengaluru`, active: true } }));
  }

  const statuses: BillStatus[] = [BillStatus.SUBMITTED, BillStatus.SUBMITTED, BillStatus.TEAM_2_REVIEW, BillStatus.TEAM_2_REVIEW, BillStatus.ADMIN_PENDING, BillStatus.ADMIN_PENDING, BillStatus.PAYMENT_PENDING, BillStatus.PAYMENT_PENDING, BillStatus.PAID, BillStatus.PAID, BillStatus.PAID, BillStatus.PAID, BillStatus.ADMIN_REJECTED, BillStatus.ADMIN_REJECTED, BillStatus.CORRECTION_REQUIRED, BillStatus.CORRECTION_REQUIRED, BillStatus.DRAFT, BillStatus.CANCELLED, BillStatus.SUBMITTED, BillStatus.PAID];
  const actionSet: Record<string, string[]> = {
    SUBMITTED: ["BILL_SUBMITTED"], TEAM_2_REVIEW: ["BILL_SUBMITTED", "BILL_VERIFIED"], ADMIN_PENDING: ["BILL_SUBMITTED", "BILL_VERIFIED", "BILL_SENT_TO_ADMIN"],
    PAYMENT_PENDING: ["BILL_SUBMITTED", "BILL_VERIFIED", "BILL_SENT_TO_ADMIN", "BILL_APPROVED", "PAYMENT_PENDING"],
    PAID: ["BILL_SUBMITTED", "BILL_VERIFIED", "BILL_SENT_TO_ADMIN", "BILL_APPROVED", "PAYMENT_PENDING", "PAYMENT_COMPLETED"],
    ADMIN_REJECTED: ["BILL_SUBMITTED", "BILL_VERIFIED", "BILL_SENT_TO_ADMIN", "BILL_REJECTED"],
    CORRECTION_REQUIRED: ["BILL_SUBMITTED", "BILL_CORRECTION_REQUESTED"], DRAFT: ["BILL_CREATED"], CANCELLED: ["BILL_SUBMITTED", "BILL_CANCELLED"],
  };
  for (let i = 0; i < 20; i++) {
    const billNumber = `BL-2026-${String(i + 11).padStart(4, "0")}`;
    const vendor = vendors[i % vendors.length], project = projects[i % projects.length], status = statuses[i];
    const creator = team1[i % team1.length], verifier = team2[i % team2.length];
    const base = 48000 + i * 12750, gst = Math.round(base * 0.18 * 100) / 100, extras = i % 3 === 0 ? 2500 : 0;
    const total = base + gst + extras;
    const exists = await db.bill.findFirst({ where: { billNumber, vendorId: vendor.id, projectId: project.id } });
    if (exists) continue;
    const bill = await db.bill.create({ data: {
      billNumber, vendorId: vendor.id, projectId: project.id, description: ["Structural concrete supply and placement", "Electrical conduit and panel installation", "Site material delivery and handling", "Interior fit-out milestone work"][i % 4],
      workCategory: ["Civil works", "Electrical", "Materials", "Interiors"][i % 4], billDate: new Date(Date.now() - (i + 3) * 86400000), submissionDate: new Date(Date.now() - (i + 1) * 86400000),
      billAmount: base, gstAmount: gst, otherCharges: extras, totalAmount: total, vendorContact: vendor.mobile, vendorEmail: vendor.email, projectLocation: project.location,
      remarks: status === BillStatus.ADMIN_REJECTED ? "GST calculation does not match the supporting invoice." : status === BillStatus.CORRECTION_REQUIRED ? "Please attach the approved work completion certificate." : "Demo bill record.",
      currentStatus: status, createdById: creator.id,
    } });
    const actions = actionSet[status];
    if (status === BillStatus.PAID) {
      const paidDate = new Date(Date.now() - (i % 5 + 1) * 86400000);
      await db.payment.create({ data: { billId: bill.id, paymentDate: paidDate, paidAmount: total, paymentMethod: i % 2 ? PaymentMethod.BANK_TRANSFER : PaymentMethod.UPI, bankName: i % 2 ? "HDFC Bank" : undefined, utrNumber: `UTR26${String(i + 123456789).slice(-9)}`, paymentReference: `PAY-26-${String(i + 1).padStart(4, "0")}`, paymentRemarks: "Payment released against approved bill.", paidById: verifier.id } });
    }
    for (let step = 0; step < actions.length; step++) {
      const action = actions[step];
      const eventUser = action.includes("APPROVED") || action.includes("REJECTED") ? admin : action.includes("VERIFIED") || action.includes("SENT_TO_ADMIN") || action.includes("PAYMENT") ? verifier : creator;
      const createdAt = new Date(Date.now() - (actions.length - step) * 8 * 3600000 - i * 3600000);
      const next = action === "BILL_CREATED" ? BillStatus.DRAFT : action === "BILL_VERIFIED" ? BillStatus.TEAM_2_REVIEW : action === "BILL_SENT_TO_ADMIN" ? BillStatus.ADMIN_PENDING : action === "BILL_APPROVED" ? BillStatus.ADMIN_APPROVED : action === "PAYMENT_PENDING" ? BillStatus.PAYMENT_PENDING : action === "PAYMENT_COMPLETED" ? BillStatus.PAID : action === "BILL_REJECTED" ? BillStatus.ADMIN_REJECTED : action === "BILL_CORRECTION_REQUESTED" ? BillStatus.CORRECTION_REQUIRED : action === "BILL_CANCELLED" ? BillStatus.CANCELLED : BillStatus.SUBMITTED;
      await db.billStatusHistory.create({ data: { billId: bill.id, userId: eventUser.id, action, next, remarks: action.includes("REJECTED") ? "Please review the invoice and tax calculation." : undefined, createdAt } });
      await db.auditLog.create({ data: { billId: bill.id, userId: eventUser.id, userName: eventUser.name, role: eventUser.role, action, next, createdAt } });
    }
    if (status === BillStatus.ADMIN_REJECTED) await db.auditLog.create({ data: { billId: bill.id, userId: admin.id, userName: admin.name, role: admin.role, action: "BILL_REJECTION_REASON", remarks: "GST calculation does not match the supporting invoice." } });
  }
  const existingPaid = await db.bill.findFirst({ where: { currentStatus: BillStatus.PAID }, include: { payment: true } });
  if (existingPaid && !await db.auditLog.findFirst({ where: { action: "DUPLICATE_ATTEMPT", billId: existingPaid.id } })) {
    await db.auditLog.create({ data: { billId: existingPaid.id, userId: team1[0].id, userName: team1[0].name, role: Role.TEAM_1, action: "DUPLICATE_ATTEMPT", previous: BillStatus.PAID, next: "DUPLICATE", remarks: "Demo duplicate submission attempt blocked by paid-bill check." } });
  }
  for (const [key, value] of Object.entries({ companyName: "BuildFlow Construction", companyLogoUrl: "", supportEmail: "finance@buildflow.local", currency: "INR", billNumberFormat: "BL-{YYYY}-{####}", gstEnabled: true, notificationsEnabled: true })) {
    await db.setting.upsert({ where: { key }, create: { key, value }, update: {} });
  }
  for (const user of userRows) {
    const count = await db.notification.count({ where: { userId: user.id } });
    if (!count) await db.notification.create({ data: { userId: user.id, title: "Welcome to BuildFlow", message: `Your ${user.role.replaceAll("_", " ")} workspace is ready.`, href: "/" } });
  }
  console.log("Seeded 7 users, 5 projects, 10 vendors and up to 20 demo bills.");
  console.log("Demo password for all accounts: Demo123!");
}

main().finally(() => db.$disconnect());
