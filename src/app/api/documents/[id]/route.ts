import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { HttpError, jsonError } from "@/lib/http";
import { readPrivateFile } from "@/lib/storage";
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    await requireUser(request);
    const { id } = await context.params;
    const doc = await db.billDocument.findUnique({ where: { id }, include: { bill: { select: { deletedAt: true } } } });
    if (!doc || doc.bill.deletedAt) throw new HttpError(404, "Document not found.");
    const file = await readPrivateFile(doc.storageKey);
    return new NextResponse(file.bytes, { headers: { "Content-Type": doc.mimeType || file.contentType, "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(doc.originalName)}`, "X-Content-Type-Options": "nosniff", "Cache-Control": "private, no-store" } });
  } catch (error) { return jsonError(error); }
}
