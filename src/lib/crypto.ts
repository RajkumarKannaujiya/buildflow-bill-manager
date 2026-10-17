import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

function key() {
  const secret = process.env.DATA_ENCRYPTION_KEY || process.env.AUTH_SECRET;
  if (!secret || secret.length < 32) throw new Error("DATA_ENCRYPTION_KEY must contain at least 32 characters.");
  return createHash("sha256").update(secret).digest();
}
export function encryptSensitive(value?: string | null) {
  if (!value) return value || undefined;
  if (value.startsWith("enc:v1:")) return value;
  const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", key(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return `enc:v1:${iv.toString("base64url")}:${cipher.getAuthTag().toString("base64url")}:${encrypted.toString("base64url")}`;
}
export function decryptSensitive(value?: string | null) {
  if (!value) return value || undefined;
  if (!value.startsWith("enc:v1:")) return value;
  const [, , ivText, tagText, body] = value.split(":");
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(ivText, "base64url"));
  decipher.setAuthTag(Buffer.from(tagText, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(body, "base64url")), decipher.final()]).toString("utf8");
}
