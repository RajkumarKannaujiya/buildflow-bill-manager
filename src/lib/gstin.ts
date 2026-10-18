const ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const VALID_STATE_CODES = new Set([
  "01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12", "13",
  "14", "15", "16", "17", "18", "19", "20", "21", "22", "23", "24", "25", "26",
  "27", "28", "29", "30", "31", "32", "33", "34", "35", "36", "37", "38", "97", "99",
]);

export type GstinCheck = { normalized: string; valid: boolean; message: string; stateCode?: string };

export function validateGstin(input: string): GstinCheck {
  const normalized = input.replace(/[^a-z0-9]/gi, "").toUpperCase();
  if (!normalized) return { normalized, valid: false, message: "Enter a GSTIN to check." };
  if (!/^[0-9A-Z]{15}$/.test(normalized)) return { normalized, valid: false, message: "GSTIN must contain 15 letters and numbers." };

  const stateCode = normalized.slice(0, 2);
  if (!VALID_STATE_CODES.has(stateCode)) return { normalized, valid: false, message: "GSTIN has an unrecognized state code.", stateCode };
  const panOrTan = /^(?:[A-Z]{5}[0-9]{4}[A-Z]|[A-Z]{4}[0-9]{5}[A-Z])$/;
  if (!panOrTan.test(normalized.slice(2, 12))) return { normalized, valid: false, message: "GSTIN does not contain a valid PAN/TAN pattern.", stateCode };
  if (!/^[1-9A-Z]Z[0-9A-Z]$/.test(normalized.slice(12))) return { normalized, valid: false, message: "GSTIN entity code or reserved character is invalid.", stateCode };

  let sum = 0;
  for (let index = 0; index < 14; index += 1) {
    const product = ALPHABET.indexOf(normalized[index]) * (index % 2 === 0 ? 1 : 2);
    sum += Math.floor(product / 36) + (product % 36);
  }
  const checkDigit = ALPHABET[(36 - (sum % 36)) % 36];
  if (normalized[14] !== checkDigit) return { normalized, valid: false, message: "GSTIN checksum does not match. Check the number for typing/OCR errors.", stateCode };
  return { normalized, valid: true, message: "GSTIN format and checksum look valid. Live GST registration status has not been checked.", stateCode };
}
