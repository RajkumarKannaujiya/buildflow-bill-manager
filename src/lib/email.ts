import nodemailer from "nodemailer";
import { db } from "@/lib/db";

type EmailArgs = { to: string[]; subject: string; heading: string; details: Array<[string, string]>; actionUrl: string; billId?: string; remarks?: string };
export async function sendWorkflowEmail(args: EmailArgs) {
  const notificationsSetting = await db.setting.findUnique({ where: { key: "notificationsEnabled" } });
  const host = process.env.SMTP_HOST;
  const transport = host ? nodemailer.createTransport({
    host, port: Number(process.env.SMTP_PORT || 587), secure: Number(process.env.SMTP_PORT) === 465,
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD } : undefined,
  }) : null;
  const [companyRow, supportRow, logoRow] = await Promise.all([db.setting.findUnique({ where: { key: "companyName" } }), db.setting.findUnique({ where: { key: "supportEmail" } }), db.setting.findUnique({ where: { key: "companyLogoUrl" } })]);
  const company = String(companyRow?.value || process.env.COMPANY_NAME || "BuildFlow Construction");
  const support = String(supportRow?.value || process.env.SUPPORT_EMAIL || "finance@example.com");
  const logo = String(logoRow?.value || process.env.COMPANY_LOGO_URL || "");
  const details = args.details.map(([label, value]) => `<tr><td style="padding:9px 0;color:#64748b">${escapeHtml(label)}</td><td style="padding:9px 0;text-align:right;font-weight:600">${escapeHtml(value)}</td></tr>`).join("");
  const brand = logo ? `<img src="${escapeHtml(logo)}" alt="${escapeHtml(company)}" style="max-height:34px;max-width:160px;vertical-align:middle;margin-right:10px"/>` : `<span style="display:inline-grid;place-items:center;width:32px;height:32px;border-radius:9px;background:#c5ef68;color:#173c35;margin-right:10px;font-weight:bold">BF</span>`;
  const html = `<div style="background:#f4f6f8;padding:32px;font-family:Arial,sans-serif;color:#182230"><div style="max-width:600px;margin:auto;background:white;border-radius:16px;overflow:hidden"><div style="background:#103b35;color:white;padding:24px 32px;font-weight:700">${brand}${escapeHtml(company)}</div><div style="padding:32px"><h1 style="font-size:22px">${escapeHtml(args.heading)}</h1><table style="width:100%;border-collapse:collapse">${details}</table>${args.remarks ? `<p style="padding:14px;background:#f7f5ee;border-radius:8px">${escapeHtml(args.remarks)}</p>` : ""}<a href="${escapeHtml(args.actionUrl)}" style="display:inline-block;background:#c5ef68;padding:12px 18px;border-radius:8px;color:#173c35;text-decoration:none;font-weight:bold;margin-top:18px">View bill</a><p style="font-size:12px;color:#64748b;margin-top:28px">Need help? ${escapeHtml(support)}<br/>${escapeHtml(company)}</p></div></div></div>`;
  for (const recipient of [...new Set(args.to)].filter(Boolean)) {
    let status = "SKIPPED", error: string | undefined;
    try {
      if (notificationsSetting?.value === false) {
        error = "Notifications are disabled by Admin";
      } else if (transport) {
        await transport.sendMail({ from: process.env.EMAIL_FROM || `BuildFlow <${support}>`, to: recipient, subject: args.subject, html });
        status = "SENT";
      } else error = "SMTP is not configured";
    } catch (err) { status = "FAILED"; error = err instanceof Error ? err.message.slice(0, 500) : "Email delivery failed"; }
    await db.emailLog.create({ data: { recipient, subject: args.subject, status, error, billId: args.billId } });
  }
}
export async function workflowRecipients(creatorId: string, roles: string[]) {
  const users = await db.user.findMany({ where: { active: true, OR: [{ id: creatorId }, { role: { in: roles as never[] } }] }, select: { email: true } });
  return users.map((u) => u.email);
}
function escapeHtml(value: string) { return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!)); }
