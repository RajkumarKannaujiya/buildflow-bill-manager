import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { ensureSameOrigin, jsonError } from "@/lib/http";
const schema = z.object({ companyName: z.string().trim().min(2).max(120), companyLogoUrl: z.string().url().or(z.literal("")), supportEmail: z.string().email(), currency: z.string().length(3).transform((v) => v.toUpperCase()), billNumberFormat: z.string().trim().max(50), gstEnabled: z.boolean(), notificationsEnabled: z.boolean() });
export async function GET(request: NextRequest) {
  try {
    await requireRole([Role.ADMIN], request);
    const rows = await db.setting.findMany();
    const settings = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    return NextResponse.json({ settings: { companyName: settings.companyName || process.env.COMPANY_NAME || "BuildFlow Construction", companyLogoUrl: settings.companyLogoUrl || process.env.COMPANY_LOGO_URL || "", supportEmail: settings.supportEmail || process.env.SUPPORT_EMAIL || "", currency: settings.currency || "INR", billNumberFormat: settings.billNumberFormat || "BL-{YYYY}-{####}", gstEnabled: settings.gstEnabled ?? true, notificationsEnabled: settings.notificationsEnabled ?? true } });
  } catch (error) { return jsonError(error); }
}
export async function PUT(request: NextRequest) {
  try {
    ensureSameOrigin(request); await requireRole([Role.ADMIN], request);
    const data = schema.parse(await request.json());
    await db.$transaction(Object.entries(data).map(([key, value]) => db.setting.upsert({ where: { key }, create: { key, value }, update: { value } })));
    return NextResponse.json({ settings: data });
  } catch (error) { return jsonError(error); }
}
