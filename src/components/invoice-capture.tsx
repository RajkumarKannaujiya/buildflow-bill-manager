"use client";

import { useId, useRef, useState } from "react";
import { FileText, LoaderCircle, ScanText, Sparkles, Upload } from "lucide-react";
import { GstinStatus } from "@/components/gstin-status";
import { parseInvoiceText, readInvoiceText } from "@/lib/invoice-ocr";
import type { InvoiceSuggestions } from "@/lib/invoice-ocr";

type Props = { file: File | null; onFile: (file: File | null) => void; onExtract: (fields: InvoiceSuggestions) => void };

export function InvoiceCapture({ file, onFile, onExtract }: Props) {
  const inputId = useId();
  const scanId = useRef(0);
  const [status, setStatus] = useState<"idle" | "reading" | "ready" | "error">("idle");
  const [message, setMessage] = useState("");
  const [progress, setProgress] = useState(0);
  const [suggestions, setSuggestions] = useState<InvoiceSuggestions>({});
  const [dragging, setDragging] = useState(false);

  async function selectFile(selected: File | null) {
    const currentScan = ++scanId.current;
    onFile(selected);
    setSuggestions({});
    onExtract({});
    if (!selected) { setStatus("idle"); setMessage(""); setProgress(0); return; }
    if (selected.size > 10 * 1024 * 1024) {
      onFile(null);
      setStatus("error");
      setMessage("Choose a file up to 10 MB. The document remains on this device until you save the bill.");
      return;
    }
    if (!(["application/pdf", "image/jpeg", "image/png", "image/webp"].includes(selected.type) || /\.(pdf|jpe?g|png|webp)$/i.test(selected.name))) {
      onFile(null);
      setStatus("error");
      setMessage("Upload a PDF, JPG, PNG, or WEBP document.");
      return;
    }

    setStatus("reading");
    setProgress(0.04);
    setMessage("Preparing private browser-side reading…");
    try {
      const text = await readInvoiceText(selected, (value, label) => {
        if (currentScan !== scanId.current) return;
        setProgress(Math.max(4, Math.min(99, Math.round(value * 100))));
        setMessage(label);
      });
      if (currentScan !== scanId.current) return;
      const fields = parseInvoiceText(text);
      setSuggestions(fields);
      onExtract(fields);
      setStatus("ready");
      setProgress(100);
      const count = Object.keys(fields).length;
      setMessage(count ? `${count} field${count === 1 ? "" : "s"} suggested. Review them in the form.` : "Text read, but no bill fields were clear enough to suggest. Fill them in manually.");
    } catch (error) {
      if (currentScan !== scanId.current) return;
      setStatus("error");
      setMessage(error instanceof Error ? error.message : "Could not read this file. You can still fill the form manually.");
    }
  }

  const foundLabels = [
    ["billNumber", "Bill number"], ["billDate", "Bill date"], ["billAmount", "Bill amount"], ["gstAmount", "GST amount"],
  ].filter(([key]) => Boolean(suggestions[key as keyof InvoiceSuggestions]));
  if (suggestions.lineItems?.length) foundLabels.push(["lineItems", `Material / work · ${suggestions.lineItems.length} rows`]);

  return <section className="invoice-capture" aria-label="Smart invoice capture">
    <div className="capture-heading">
      <div className="capture-icon"><Sparkles size={16} /></div>
      <div className="capture-heading-copy"><strong>Bill document * · Smart capture</strong><span>Read invoice details and item-wise materials/work from a PDF or image.</span></div>
      <span className="capture-private"><ScanText size={13} /> Private browser-side scan</span>
    </div>
    <label className={`upload-zone ${dragging ? "dragging" : ""}`} htmlFor={inputId} onDragOver={(event) => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={(event) => { event.preventDefault(); setDragging(false); void selectFile(event.dataTransfer.files[0] || null); }}>
      <span className="upload-zone-icon">{status === "reading" ? <LoaderCircle className="spin" size={20} /> : file ? <FileText size={20} /> : <Upload size={20} />}</span>
      <span className="upload-zone-copy"><strong>{file?.name || "Drop an invoice here or browse files"}</strong><small>{file ? `${(file.size / 1024 / 1024).toFixed(2)} MB · selected locally` : "PDF, JPG, PNG or WEBP · up to 10 MB"}</small></span>
      <span className="button small">{file ? "Change file" : "Choose file"}</span>
    </label>
    {file && <button type="button" className="capture-remove" aria-label="Remove selected invoice document" onClick={() => void selectFile(null)}>Remove selected document</button>}
    <input id={inputId} className="visually-hidden" type="file" accept=".pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp" onChange={(event) => { void selectFile(event.target.files?.[0] || null); event.currentTarget.value = ""; }} />
    {status !== "idle" && <div className={`capture-progress ${status}`} role="status">
      <div className="capture-progress-label"><span>{message}</span>{status === "reading" && <span>{progress}%</span>}</div>
      {status === "reading" && <div className="capture-progress-track"><span style={{ width: `${progress}%` }} /></div>}
    </div>}
    {status === "ready" && foundLabels.length > 0 && <div className="capture-results">
      <div className="capture-results-title"><Sparkles size={13} /><strong>Suggested fields</strong><span>Check each value before submitting</span></div>
      <div className="capture-chips">{foundLabels.map(([key, label]) => <span key={key}>{label}</span>)}</div>
      {suggestions.gstin && <GstinStatus value={suggestions.gstin} />}
    </div>}
    <p className="capture-footnote">The scan runs on this device; the required document is uploaded only when you save the bill. Review the extracted material rows, quantities, rates, bill total and GSTIN against the original invoice before submitting.</p>
  </section>;
}
