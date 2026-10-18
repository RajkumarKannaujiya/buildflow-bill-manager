import { validateGstin } from "@/lib/gstin";

export type InvoiceSuggestions = {
  billNumber?: string;
  billDate?: string;
  gstin?: string;
  billAmount?: string;
  gstAmount?: string;
  lineItems?: InvoiceLineItemSuggestion[];
};

export type InvoiceLineItemSuggestion = { description: string; quantity: string; unit: string; rate: string };

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
      const fragments = content.items.filter((item): item is typeof item & { str: string; transform: number[] } => "str" in item && Boolean(item.str.trim()));
      const rows: Array<{ y: number; fragments: Array<{ x: number; text: string }> }> = [];
      for (const item of fragments) {
        const x = item.transform[4] || 0, y = Math.round((item.transform[5] || 0) * 2) / 2;
        let row = rows.find((candidate) => Math.abs(candidate.y - y) <= 2);
        if (!row) { row = { y, fragments: [] }; rows.push(row); }
        row.fragments.push({ x, text: item.str });
      }
      textPages.push(rows.sort((a, b) => b.y - a.y).map((row) => row.fragments.sort((a, b) => a.x - b.x).map((fragment) => fragment.text).join(" ")).join("\n"));
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
  const lineItems = extractInvoiceLineItems(lines);
  if (lineItems.length) result.lineItems = lineItems;
  return result;
}

function extractInvoiceLineItems(lines: string[]): InvoiceLineItemSuggestion[] {
  const headerIndex = lines.findIndex((line) => /(?:description|particulars|material|item|product|service|work)\b/i.test(line) && /(?:qty|quantity|rate|unit price|amount|value|total)\b/i.test(line));
  const tableLines = headerIndex >= 0 ? lines.slice(headerIndex + 1) : lines;
  const hasHsnColumn = headerIndex >= 0 && /\bhsn\b|\bsac\b/i.test(lines[headerIndex]);
  const result: InvoiceLineItemSuggestion[] = [];
  const seen = new Set<string>();
  for (const line of tableLines) {
    if (/^(?:sub\s*total|subtotal|taxable\s+(?:value|amount)|cgst|sgst|igst|total\s+(?:gst|tax|amount|value)|grand\s+total|amount\s+(?:due|payable)|net\s+payable|round\s*off|balance\s+due|terms\s+and\s+conditions|bank\s+details)\b/i.test(line)) break;
    if (/(?:description|particulars|material|item|product|service|work)\b/i.test(line) && /(?:qty|quantity|rate|unit price|amount|value|hsn|sac)\b/i.test(line)) continue;

    const numberPattern = /(?<![a-z])(?:₹|rs\.?|inr)?\s*(\d{1,3}(?:,\d{2,3})+|\d+)(?:\.(\d{1,3}))?(?![a-z])/gi;
    const tokens: Array<{ value: number; digits: string; decimals: string; start: number; end: number }> = [];
    for (const match of line.matchAll(numberPattern)) {
      const digits = match[1].replace(/,/g, ""), decimals = match[2] || "";
      const value = Number(`${digits}${decimals ? `.${decimals}` : ""}`);
      if (Number.isFinite(value) && value <= 1_000_000_000) tokens.push({ value, digits, decimals, start: match.index || 0, end: (match.index || 0) + match[0].length });
    }
    if (tokens.length < 2) continue;

    const ignored = new Set<number>();
    const first = tokens[0];
    if (tokens.length >= 3 && first.start <= 2 && first.value <= 999 && /^\s*\d{1,3}[.)]?\s+/.test(line)) ignored.add(0);
    if ((hasHsnColumn || tokens.length >= 5) && tokens.length - ignored.size >= 3) {
      const hsnIndex = tokens.findIndex((token, index) => !ignored.has(index) && token.start < tokens[tokens.length - 2].start && !token.decimals && token.digits.length >= 4 && token.digits.length <= 8);
      if (hsnIndex >= 0) ignored.add(hsnIndex);
    }
    const usable = tokens.filter((_, index) => !ignored.has(index));
    if (usable.length < 2) continue;
    const amountToken = usable[usable.length - 1];
    const hasRate = usable.length >= 3;
    const quantityToken = usable[usable.length - (hasRate ? 3 : 2)];
    const rateToken = hasRate ? usable[usable.length - 2] : undefined;
    const quantity = quantityToken.value;
    const amount = amountToken.value;
    if (quantity <= 0 || amount <= 0) continue;

    let description = line.slice(0, quantityToken.start).replace(/^\s*\d{1,3}[.)]?\s+/, "").trim();
    for (const index of ignored) {
      const token = tokens[index];
      if (token.start < quantityToken.start && token.digits.length >= 4) description = description.replace(new RegExp(`(?<![a-z])${token.digits}(?![a-z])`, "i"), " ");
    }
    description = description.replace(/[|:;\-–]+$/g, "").replace(/\s+/g, " ").trim();
    if (description.length < 3 || !/[a-z]{2}/i.test(description) || /^(?:invoice|bill|date|gstin|pan|email|phone|mobile|address|vendor|supplier|customer|buyer|consignee|ship\s+to|bill\s+to)\b/i.test(description)) continue;

    const between = line.slice(quantityToken.end, (rateToken || amountToken).start);
    const unitMatch = between.match(/\b(nos?|pieces?|pcs?|sets?|bags?|kg|kgs|gms?|grams?|litres?|liters?|ltr|ltrs|mt|tonnes?|tons?|cft|m3|m\s*[³3]|cum|sq\.?\s*m|sqm|sq\.?\s*ft|sqft|sft|rmt|rft|running\s*(?:ft|feet|m)|feet|ft|metres?|meters?|mtrs?|rolls?|boxes|box|trips?|loads?|days?|hours?|hrs?|units?|lot)\b/i);
    if (headerIndex < 0 && !unitMatch && usable.length < 3) continue;
    const unit = normalizeInvoiceUnit(unitMatch?.[0] || "nos");
    const rate = rateToken ? rateToken.value : amount / quantity;
    const draft = { description: description.slice(0, 500), quantity: quantity.toFixed(Math.min(3, quantityToken.decimals.length)), unit, rate: rate.toFixed(2) };
    const key = `${draft.description.toLowerCase()}|${draft.quantity}|${draft.rate}`;
    if (!seen.has(key)) { result.push(draft); seen.add(key); }
    if (result.length >= 100) break;
  }
  return result;
}

function normalizeInvoiceUnit(value: string) {
  const normalized = value.toLowerCase().replace(/\s+/g, "").replace(/sq\.?/g, "sq");
  const aliases: Record<string, string> = { no: "nos", pc: "pcs", piece: "pcs", pieces: "pcs", kg: "kg", kgs: "kg", gm: "g", gms: "g", gram: "g", grams: "g", ltr: "ltr", ltrs: "ltr", litre: "ltr", liter: "ltr", litres: "ltr", liters: "ltr", tonne: "tonne", tonnes: "tonne", ton: "tonne", tons: "tonne", mt: "tonne", m3: "m³", "m³": "m³", cum: "m³", cft: "ft³", sqft: "sqft", sft: "sqft", sqm: "sqm", rmt: "m", rft: "rft", metre: "m", metres: "m", meter: "m", meters: "m", mtr: "m", mtrs: "m", hr: "hrs", hour: "hrs", hours: "hrs", hrs: "hrs", unit: "units", units: "units", trip: "trips", trips: "trips", load: "loads", loads: "loads" };
  return aliases[normalized] || normalized.slice(0, 30);
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
