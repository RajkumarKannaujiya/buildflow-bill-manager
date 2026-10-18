import { NextRequest, NextResponse } from "next/server";
import { BillStatus } from "@prisma/client";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { jsonError } from "@/lib/http";
export async function GET(request: NextRequest) {
  try {
    const user = await requireUser(request);
    const visibleBills = { deletedAt: null };
    const [counts, billed, paid, duplicates, pendingVerification, pendingApproval, paymentPending, currencySetting] = await Promise.all([
      db.bill.groupBy({ by: ["currentStatus"], where: visibleBills, _count: { _all: true } }),
      db.bill.aggregate({ where: visibleBills, _sum: { totalAmount: true } }),
      db.payment.aggregate({ where: { bill: { is: visibleBills } }, _sum: { paidAmount: true }, _count: { _all: true } }),
      db.auditLog.count({ where: { action: "DUPLICATE_ATTEMPT" } }),
      db.bill.count({ where: { ...visibleBills, currentStatus: BillStatus.SUBMITTED } }),
      db.bill.count({ where: { ...visibleBills, currentStatus: BillStatus.ADMIN_PENDING } }),
      db.bill.count({ where: { ...visibleBills, currentStatus: BillStatus.PAYMENT_PENDING } }),
      db.setting.findUnique({ where: { key: "currency" } }),
    ]);
    const byStatus = Object.fromEntries(counts.map((row) => [row.currentStatus, row._count._all]));
    const pendingAmount = await db.bill.aggregate({ where: { ...visibleBills, currentStatus: { notIn: [BillStatus.PAID, BillStatus.ADMIN_REJECTED, BillStatus.CANCELLED, BillStatus.DUPLICATE] } }, _sum: { totalAmount: true } });
    const unread = await db.notification.count({ where: { userId: user.id, readAt: null } });
    return NextResponse.json({ kpis: { totalBills: Object.values(byStatus).reduce((a, b) => a + b, 0), drafts: byStatus.DRAFT || 0, submitted: byStatus.SUBMITTED || 0,
      underVerification: byStatus.TEAM_2_REVIEW || 0, pendingAdmin: byStatus.ADMIN_PENDING || 0, approved: (byStatus.ADMIN_APPROVED || 0) + (byStatus.PAYMENT_PENDING || 0) + (byStatus.PAID || 0), rejected: byStatus.ADMIN_REJECTED || 0,
      paymentPending: byStatus.PAYMENT_PENDING || 0, paidBills: byStatus.PAID || 0, duplicates,
      totalAmount: billed._sum.totalAmount?.toString() || "0", paidAmount: paid._sum.paidAmount?.toString() || "0", pendingAmount: pendingAmount._sum.totalAmount?.toString() || "0", unread },
      currency: String(currencySetting?.value || "INR"), queues: { pendingVerification, pendingApproval, paymentPending } });
  } catch (error) { return jsonError(error); }
}
