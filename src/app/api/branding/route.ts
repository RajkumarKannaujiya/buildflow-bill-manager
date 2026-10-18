import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function GET() {
  try {
    const rows = await db.setting.findMany({ where: { key: { in: ["companyName", "companyLogoUrl"] } } });
    const settings = Object.fromEntries(rows.map((row) => [row.key, row.value]));
    return NextResponse.json({ branding: {
      companyName: String(settings.companyName || process.env.COMPANY_NAME || "J.P. PROJECTS"),
      companyLogoUrl: String(settings.companyLogoUrl || process.env.COMPANY_LOGO_URL || "/jp-projects-logo.jpeg"),
    } });
  } catch {
    return NextResponse.json({ branding: { companyName: "J.P. PROJECTS", companyLogoUrl: "/jp-projects-logo.jpeg" } });
  }
}
