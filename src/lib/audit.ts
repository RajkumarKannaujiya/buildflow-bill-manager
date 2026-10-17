import { Prisma, Role } from "@prisma/client";
import { db } from "@/lib/db";

type Actor = { id: string; name: string; role: Role };
export async function recordAudit(tx: Prisma.TransactionClient | typeof db, args: {
  actor: Actor; action: string; billId?: string; previous?: string | null; next?: string | null;
  remarks?: string; ipAddress?: string; metadata?: Prisma.InputJsonValue;
}) {
  await tx.auditLog.create({ data: {
    billId: args.billId, userId: args.actor.id, userName: args.actor.name, role: args.actor.role,
    action: args.action, previous: args.previous ?? undefined, next: args.next ?? undefined,
    remarks: args.remarks, ipAddress: args.ipAddress, metadata: args.metadata,
  } });
}
export async function changeStatus(tx: Prisma.TransactionClient, bill: { id: string; currentStatus: string }, actor: Actor,
  next: string, action: string, remarks?: string, ipAddress?: string) {
  await tx.bill.update({ where: { id: bill.id }, data: { currentStatus: next as never } });
  await tx.billStatusHistory.create({ data: {
    billId: bill.id, userId: actor.id, previous: bill.currentStatus as never, next: next as never, action, remarks,
  } });
  await recordAudit(tx, { actor, billId: bill.id, action, previous: bill.currentStatus, next, remarks, ipAddress });
}
