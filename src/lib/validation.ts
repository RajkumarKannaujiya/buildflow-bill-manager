import { z } from "zod";

const billLineItem = z.object({
  description: z.string().trim().min(1).max(500),
  quantity: z.coerce.number().positive().max(1000000000),
  unit: z.string().trim().min(1).max(30),
  rate: z.coerce.number().min(0).max(1000000000),
});

export const billInput = z.object({
  billNumber: z.string().trim().min(1).max(80).transform((v) => v.toUpperCase()), vendorId: z.string().min(1), projectId: z.string().min(1),
  vendorName: z.string().trim().optional(), vendorContact: z.string().trim().max(40).optional(), vendorEmail: z.string().trim().email().or(z.literal("")).optional(),
  projectLocation: z.string().trim().max(200).optional(), workCategory: z.string().trim().max(100).optional(), description: z.string().trim().min(2).max(2000),
  billDate: z.string().datetime().or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)), billAmount: z.coerce.number().positive().max(1000000000),
  gstAmount: z.coerce.number().min(0).max(1000000000), otherCharges: z.coerce.number().min(0).max(1000000000).default(0),
  lineItems: z.preprocess((value) => {
    if (typeof value !== "string") return value;
    try { return JSON.parse(value); } catch { return value; }
  }, z.array(billLineItem).max(100).optional().default([])),
  remarks: z.string().trim().max(3000).optional(),
});
export const paymentInput = z.object({ paymentDate: z.string().datetime().or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)),
  paidAmount: z.coerce.number().positive().max(1000000000), paymentMethod: z.enum(["BANK_TRANSFER", "UPI", "CHEQUE", "CASH", "OTHER"]),
  bankName: z.string().trim().max(100).optional(), utrNumber: z.string().trim().max(100).transform((v) => v.toUpperCase()).optional(),
  paymentReference: z.string().trim().max(100).transform((v) => v.toUpperCase()).optional(), paymentRemarks: z.string().trim().max(3000).optional(), });
