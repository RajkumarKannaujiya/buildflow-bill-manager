import { NextRequest, NextResponse } from "next/server";
import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { jsonError } from "@/lib/http";

const columns = ["Bill No", "Vendor", "Project", "Bill Date", "Status", "Work Description", "Material Breakdown", "Bill Amount", "GST", "Other Charges", "Total Amount", "Payment Date", "Paid Amount", "Payment Method", "UTR", "Payment Reference", "Paid By"];
export async function GET(request: NextRequest) {
  try {
    await requireRole([Role.ADMIN, Role.TEAM_2], request);
    const p = request.nextUrl.searchParams, format = p.get("format") || "json", projectId = p.get("projectId") || undefined;
    const scope = { deletedAt: null, ...(projectId ? { projectId } : {}) };
    const bills = await db.bill.findMany({ where: scope, include: { vendor: true, project: true, lineItems: { orderBy: { sortOrder: "asc" } }, payment: { include: { paidBy: true } } }, orderBy: { createdAt: "desc" } });
    const rows = bills.map((b) => [b.billNumber, b.vendor.name, b.project.name, b.billDate.toLocaleDateString("en-IN"), b.currentStatus, b.description,
      b.lineItems.map((item) => `${item.description} (${item.quantity} ${item.unit} × ₹${item.rate} = ₹${item.amount})`).join("; "),
      b.billAmount.toString(), b.gstAmount.toString(), b.otherCharges.toString(), b.totalAmount.toString(), b.payment?.paymentDate.toLocaleDateString("en-IN") || "",
      b.payment?.paidAmount.toString() || "", b.payment?.paymentMethod || "", b.payment?.utrNumber || "", b.payment?.paymentReference || "", b.payment?.paidBy.name || ""]);
    if (format === "csv") {
      const csv = [columns, ...rows].map((row) => row.map((v) => `"${String(v).replaceAll('"', '""')}"`).join(",")).join("\r\n");
      return new NextResponse(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": "attachment; filename=buildflow-bill-report.csv" } });
    }
    if (format === "xlsx") {
      const workbook = new ExcelJS.Workbook(), sheet = workbook.addWorksheet("Bills");
      sheet.addRow(columns); rows.forEach((row) => sheet.addRow(row));
      sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } }; sheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF17443D" } };
      sheet.columns = columns.map((header) => ({ header, width: Math.max(14, header.length + 2) }));
      const buffer = await workbook.xlsx.writeBuffer();
      return new NextResponse(new Uint8Array(buffer), { headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": "attachment; filename=buildflow-bill-report.xlsx" } });
    }
    if (format === "pdf") {
      const buffer = await buildPdf(rows);
      return new NextResponse(new Uint8Array(buffer), { headers: { "Content-Type": "application/pdf", "Content-Disposition": "attachment; filename=buildflow-bill-report.pdf" } });
    }
    const [groups, total, paid, pending] = await Promise.all([db.bill.groupBy({ by: ["currentStatus"], where: scope, _count: { _all: true }, _sum: { totalAmount: true } }),
      db.bill.aggregate({ where: scope, _sum: { totalAmount: true } }), db.payment.aggregate({ where: { bill: { is: scope } }, _sum: { paidAmount: true } }),
      db.bill.aggregate({ where: { ...scope, currentStatus: { notIn: ["PAID", "ADMIN_REJECTED", "CANCELLED", "DUPLICATE"] } }, _sum: { totalAmount: true } })]);
    const projectSummary = new Map<string, { name: string; count: number; total: number; approved: number; paid: number; pending: number }>();
    const vendorSummary = new Map<string, { name: string; count: number; total: number; paid: number }>();
    const paymentByMonth = new Map<string, number>();
    for (const bill of bills) {
      const totalValue = Number(bill.totalAmount), paidValue = Number(bill.payment?.paidAmount || 0);
      const projectRow = projectSummary.get(bill.projectId) || { name: bill.project.name, count: 0, total: 0, approved: 0, paid: 0, pending: 0 };
      projectRow.count += 1; projectRow.total += totalValue; projectRow.paid += paidValue;
      if (["ADMIN_APPROVED", "PAYMENT_PENDING", "PAID"].includes(bill.currentStatus)) projectRow.approved += totalValue;
      if (!["PAID", "ADMIN_REJECTED", "CANCELLED", "DUPLICATE"].includes(bill.currentStatus)) projectRow.pending += totalValue;
      projectSummary.set(bill.projectId, projectRow);
      const vendorRow = vendorSummary.get(bill.vendorId) || { name: bill.vendor.name, count: 0, total: 0, paid: 0 };
      vendorRow.count += 1; vendorRow.total += totalValue; vendorRow.paid += paidValue; vendorSummary.set(bill.vendorId, vendorRow);
      if (bill.payment) {
        const date = bill.payment.paymentDate, key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
        paymentByMonth.set(key, (paymentByMonth.get(key) || 0) + paidValue);
      }
    }
    return NextResponse.json({ rows: groups.map((g) => ({ status: g.currentStatus, count: g._count._all, amount: g._sum.totalAmount?.toString() || "0" })),
      total: total._sum.totalAmount?.toString() || "0", paid: paid._sum.paidAmount?.toString() || "0", pending: pending._sum.totalAmount?.toString() || "0", bills: rows.length,
      projects: [...projectSummary.values()].sort((a, b) => b.total - a.total), vendors: [...vendorSummary.values()].sort((a, b) => b.paid - a.paid).slice(0, 8),
      paymentByMonth: [...paymentByMonth.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([month, amount]) => ({ month, amount })) });
  } catch (error) { return jsonError(error); }
}
async function buildPdf(rows: Array<Array<string>>) {
  return new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", layout: "landscape", margin: 32 });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk)); doc.on("end", () => resolve(Buffer.concat(chunks))); doc.on("error", reject);
    doc.fontSize(18).fillColor("#173958").text("J.P. PROJECTS · Bill report"); doc.moveDown(0.4).fontSize(8).fillColor("#64748b").text(`Generated ${new Date().toLocaleString("en-IN")} · ${rows.length} bills`); doc.moveDown();
    const visible = [0, 1, 2, 3, 4, 5, 10, 11, 12, 14];
    const headers = visible.map((i) => columns[i]);
    const widths = [56, 78, 96, 54, 60, 136, 66, 58, 64, 62];
    const drawHeader = () => { const y = doc.y; let x = 32; doc.rect(32, y, widths.reduce((a, b) => a + b, 0), 24).fill("#17443d"); headers.forEach((h, i) => { doc.fillColor("white").fontSize(7).text(h, x + 4, y + 8, { width: widths[i] - 8, ellipsis: true }); x += widths[i]; }); doc.y = y + 28; };
    drawHeader();
    rows.forEach((row, index) => {
      if (doc.y > 525) { doc.addPage(); drawHeader(); }
      const y = doc.y, values = visible.map((i) => row[i]); let x = 32;
      if (index % 2 === 0) doc.rect(32, y - 2, widths.reduce((a, b) => a + b, 0), 22).fill("#f3f7f5");
      values.forEach((v, i) => { doc.fillColor("#263b37").fontSize(7).text(v, x + 4, y + 5, { width: widths[i] - 8, ellipsis: true }); x += widths[i]; }); doc.y = y + 23;
    });
    doc.end();
  });
}
