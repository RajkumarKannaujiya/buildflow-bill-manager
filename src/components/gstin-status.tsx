"use client";

import { BadgeCheck, CircleAlert } from "lucide-react";
import { validateGstin } from "@/lib/gstin";

export function GstinStatus({ value }: { value: string }) {
  if (!value.trim()) return null;
  const check = validateGstin(value);
  const Icon = check.valid ? BadgeCheck : CircleAlert;
  return <div className={`gstin-check ${check.valid ? "valid" : "invalid"}`} role="status">
    <Icon size={15} />
    <div className="gstin-check-copy"><strong>{check.valid ? "Format and checksum passed" : "Check the GSTIN"}</strong><span>{check.message}</span><small>Offline check only · live GST registration status is not confirmed.</small></div>
    <a href="https://services.gst.gov.in/services/quicklinks/searchtxp" target="_blank" rel="noreferrer">GST Portal ↗</a>
  </div>;
}
