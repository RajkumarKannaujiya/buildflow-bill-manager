"use client";

import { Plus, Trash2 } from "lucide-react";

export type BillLineItemDraft = { description: string; quantity: string; unit: string; rate: string };

export function billLineAmount(item: BillLineItemDraft) {
  const amount = Number(item.quantity || 0) * Number(item.rate || 0);
  return Number.isFinite(amount) ? Math.round((amount + Number.EPSILON) * 100) / 100 : 0;
}

export function billLineSubtotal(items: BillLineItemDraft[]) {
  return Math.round((items.reduce((sum, item) => sum + billLineAmount(item), 0) + Number.EPSILON) * 100) / 100;
}

export function BillLineItemsEditor({ items, onChange }: { items: BillLineItemDraft[]; onChange: (items: BillLineItemDraft[]) => void }) {
  function update(index: number, key: keyof BillLineItemDraft, value: string) {
    onChange(items.map((item, itemIndex) => itemIndex === index ? { ...item, [key]: value } : item));
  }

  return <section className="bill-items-editor">
    <div className="bill-items-head"><div><strong>Material / work breakdown</strong><span>Add each material or work item with quantity and rate for the project builder to review.</span></div><button type="button" className="button small" disabled={items.length >= 100} onClick={() => onChange([...items, { description: "", quantity: "1", unit: "nos", rate: "" }])}><Plus size={13} /> Add item</button></div>
    <div className="bill-items-scroll"><div className="bill-item-labels"><span>Material / work description</span><span>Quantity</span><span>Unit</span><span>Rate (₹)</span><span>Amount (₹)</span><span /></div>
      {items.map((item, index) => <div className="bill-item-row" key={index}>
        <input aria-label={`Item ${index + 1} material or work description`} value={item.description} onChange={(event) => update(index, "description", event.target.value)} placeholder="e.g. OPC cement, M25 concrete, electrical cable" maxLength={500} />
        <input aria-label={`Item ${index + 1} quantity`} type="number" min="0.001" step="0.001" value={item.quantity} onChange={(event) => update(index, "quantity", event.target.value)} />
        <input aria-label={`Item ${index + 1} unit`} value={item.unit} onChange={(event) => update(index, "unit", event.target.value)} placeholder="bags, kg, m³" maxLength={30} />
        <input aria-label={`Item ${index + 1} rate`} type="number" min="0" step="0.01" value={item.rate} onChange={(event) => update(index, "rate", event.target.value)} placeholder="0.00" />
        <strong className="bill-item-amount">{billLineAmount(item).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong>
        <button type="button" className="icon-button bill-item-remove" aria-label={`Remove item ${index + 1}`} disabled={items.length <= 1} onClick={() => onChange(items.filter((_, itemIndex) => itemIndex !== index))}><Trash2 size={14} /></button>
      </div>)}
    </div>
    <p className="bill-items-note">Item subtotal: <strong>₹{billLineSubtotal(items).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong> · This subtotal becomes the bill amount; GST and other charges are added separately.</p>
  </section>;
}
