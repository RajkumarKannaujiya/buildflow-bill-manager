import { Role } from "@prisma/client";
import { db } from "@/lib/db";

export async function notifyRoles(roles: Role[], title: string, message: string, href?: string, billId?: string) {
  const setting = await db.setting.findUnique({ where: { key: "notificationsEnabled" } });
  if (setting?.value === false) return;
  const users = await db.user.findMany({ where: { active: true, role: { in: roles } }, select: { id: true } });
  if (!users.length) return;
  await db.notification.createMany({ data: users.map((u) => ({ userId: u.id, title, message, href, billId })) });
}
export async function notifyUsers(userIds: string[], title: string, message: string, href?: string, billId?: string) {
  const setting = await db.setting.findUnique({ where: { key: "notificationsEnabled" } });
  if (setting?.value === false) return;
  const ids = [...new Set(userIds)];
  if (ids.length) await db.notification.createMany({ data: ids.map((userId) => ({ userId, title, message, href, billId })) });
}
