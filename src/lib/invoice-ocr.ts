import { validateGstin } from "@/lib/gstin";

export type InvoiceSuggestions = {
  billNumber?: string;
  billDate?: string;
  gstin?: string;
  billAmount?: string;
  gstAmount?: string;
};

export type OcrProgress = (progress: number, message: string) => void;

/** Reads a PDF or image locally in the browser. Invoice bytes are never sent to an OCR API. */
export async function readInvoiceText(file: File, onProgress: OcrProgress): Promise<string> {
  if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    pdfjs.GlobalWorkerOptions.workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjs.version}/legacy/build/pdf.worker.min.mjs`;
    onProgress(0.08, "Reading PDF");
    const pdf = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false }).promise;
    const pageCount = Math.min(pdf.numPages, 4);
    const textPages: string[] = [];
    for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      textPages.push(content.items.map((item) => "str" in item ? item.str : "").join(" "));
      onProgress(0.08 + 0.12 * (pageNumber / pageCount), `Reading page ${pageNumber} of ${pageCount}`);
    }
    const embeddedText = textPages.join("\n");
    if (embeddedText.replace(/\s/g, "").length >= 35) return embeddedText;

    const worker = await createOcrWorker(onProgress);
    try {
      const scannedPages: string[] = [];
      for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
        const page = await pdf.getPage(pageNumber);
        const viewport = page.getViewport({ scale: 1.6 });
        const canvas = document.createElement("canvas");
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        const context = canvas.getContext("2d");
        if (!context) throw new Error("Your browser could not prepare the PDF page for reading.");
        await page.render({ canvasContext: context, viewport }).promise;
        const result = await worker.recognize(canvas, {}, {}, `pdf-page-${pageNumber}`);
        scannedPages.push(result.data.text);
        canvas.width = 0;
        canvas.height = 0;
        onProgress(0.2 + 0.78 * (pageNumber / pageCount), `Reading scanned page ${pageNumber} of ${pageCount}`);
      }
      return scannedPages.join("\n");
    } finally {
      await worker.terminate();
      await pdf.destroy();
    }
  }

  const worker = await createOcrWorker(onProgress);
  try {
    const result = await worker.recognize(file, {}, {}, "invoice-image");
    return result.data.text;
  } finally {
    await worker.terminate();
  }
}

async function createOcrWorker(onProgress: OcrProgress) {
  const { createWorker } = await import("tesseract.js");
  return createWorker("eng", undefined, {
    logger: (event) => {
      if (event.status === "recognizing text") onProgress(0.2 + Math.round(event.progress * 75) / 100, "Reading invoice text");
      else if (event.status === "loading language traineddata") onProgress(0.12, "Preparing English text recognition");
    },
  });
}

export function parseInvoiceText(text: string): InvoiceSuggestions {
  const lines = text.split(/\r?\n/).map((line) => line.replace(/\s+/g, " ").trim()).filter(Boolean);
  const joined = lines.join("\n");
  const result: InvoiceSuggestions = {};

  const invoiceLine = lines.find((line) => /(?:invoice|bill)\s*(?:number|no\.?|#)\s*[:#-]?\s*[A-Z0-9][A-Z0-9\/-]{1,}/i.test(line));
  const invoiceMatch = invoiceLine?.match(/(?:invoice|bill)\s*(?:number|no\.?|#)\s*[:#-]?\s*([A-Z0-9][A-Z0-9\/-]{1,})/i);
  if (invoiceMatch?.[1]) result.billNumber = invoiceMatch[1].slice(0, 80).toUpperCase();

  const dateLine = lines.find((line) => /(?:invoice|bill|document)\s*date|date\s*of\s*(?:invoice|bill)/i.test(line));
  const dateMatch = dateLine?.match(/\b(?:\d{1,2}[./-]\d{1,2}[./-]\d{2,4}|\d{4}[./-]\d{1,2}[./-]\d{1,2})\b/);
  const parsedDate = dateMatch?.[0] ? normalizeInvoiceDate(dateMatch[0]) : undefined;
  if (parsedDate) result.billDate = parsedDate;

  const gstinCandidates = Array.from(joined.matchAll(/\b[0-9A-Z](?:[\s-]?[0-9A-Z]){14}\b/gi))
    .map((match) => match[0].replace(/[^a-z0-9]/gi, "").toUpperCase())
    .filter((value) => value.length === 15);
  const gstin = gstinCandidates.find((value) => validateGstin(value).valid) || gstinCandidates[0];
  if (gstin) result.gstin = gstin;

  const taxable = findLabelAmount(lines, /taxable\s+(?:value|amount)|assessable\s+value|sub\s*total|subtotal|amount\s+before\s+tax/i);
  const gstTotal = findLabelAmount(lines, /total\s+gst|gst\s+amount|total\s+tax|tax\s+amount/i);
  let gst = gstTotal;
  if (gst === undefined) {
    const taxLines = lines.filter((line) => /\b(?:cgst|sgst|igst)\b/i.test(line));
    if (taxLines.length) gst = taxLines.reduce((sum, line) => sum + (amountFromLine(line) || 0), 0);
  }
  const grandTotal = findLabelAmount(lines, /grand\s+total|total\s+(?:invoice\s+)?(?:amount|value)|amount\s+payable|net\s+payable|invoice\s+value/i);
  const billAmount = taxable ?? (grandTotal !== undefined && gst !== undefined ? grandTotal - gst : grandTotal);
  if (billAmount !== undefined && billAmount > 0) result.billAmount = billAmount.toFixed(2);
  if (gst !== undefined && gst >= 0) result.gstAmount = gst.toFixed(2);
  return result;
}

function findLabelAmount(lines: string[], label: RegExp): number | undefined {
  for (const line of lines) {
    const match = label.exec(line);
    if (!match) continue;
    const amount = amountFromLine(line.slice(match.index + match[0].length), false) ?? amountFromLine(line);
    if (amount !== undefined) return amount;
  }
  return undefined;
}

function amountFromLine(line: string, fromEnd = true): number | undefined {
  const matches = Array.from(line.matchAll(/(?:₹|Rs\.?|INR)?\s*((?:[0-9]{1,3}(?:,[0-9]{2,3})+|[0-9]+)(?:\.\d{1,2})?)/gi));
  const candidates = fromEnd ? matches.reverse() : matches;
  for (const match of candidates) {
    const amount = Number(match[1].replace(/,/g, ""));
    if (Number.isFinite(amount) && amount <= 1_000_000_000) return amount;
  }
  return undefined;
}

function normalizeInvoiceDate(value: string): string | undefined {
  const parts = value.split(/[./-]/).map(Number);
  let year: number, month: number, day: number;
  if (parts[0] > 31) [year, month, day] = parts;
  else [day, month, year] = parts;
  if (year < 100) year += year >= 70 ? 1900 : 2000;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return undefined;
  return `${year.toString().padStart(4, "0")}-${month.toString().padStart(2, "0")}-${day.toString().padStart(2, "0")}`;
}
