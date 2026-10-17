import { randomUUID } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

const bucket = process.env.S3_BUCKET;
const client = bucket ? new S3Client({ region: process.env.S3_REGION || "auto", endpoint: process.env.S3_ENDPOINT || undefined,
  forcePathStyle: process.env.S3_FORCE_PATH_STYLE !== "false", credentials: process.env.S3_ACCESS_KEY_ID ? { accessKeyId: process.env.S3_ACCESS_KEY_ID, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || "" } : undefined }) : null;
export async function savePrivateFile(file: File, prefix: "bill" | "payment") {
  const key = `${prefix}/${randomUUID()}${path.extname(file.name).toLowerCase()}`;
  const bytes = Buffer.from(await file.arrayBuffer());
  if (client && bucket) await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: bytes, ContentType: file.type, ServerSideEncryption: "AES256" }));
  else {
    const root = path.join(process.cwd(), "private-uploads");
    const target = path.join(root, key);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, bytes, { flag: "wx", mode: 0o600 });
  }
  return key;
}
export async function readPrivateFile(key: string) {
  if (client && bucket) {
    const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    if (!response.Body) throw new Error("Object not found");
    return { bytes: Buffer.from(await response.Body.transformToByteArray()), contentType: response.ContentType || "application/octet-stream" };
  }
  const safe = key.replace(/\\/g, "/").split("/").filter((p) => p && p !== "." && p !== "..").join(path.sep);
  const full = path.join(process.cwd(), "private-uploads", safe);
  return { bytes: await readFile(full), contentType: inferMime(full) };
}
export async function deletePrivateFile(key: string) {
  if (client && bucket) { const { DeleteObjectCommand } = await import("@aws-sdk/client-s3"); await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key })); return; }
  const safe = key.replace(/\\/g, "/").split("/").filter((p) => p && p !== "." && p !== "..").join(path.sep);
  await unlink(path.join(process.cwd(), "private-uploads", safe)).catch(() => undefined);
}
function inferMime(file: string) { return /\.pdf$/i.test(file) ? "application/pdf" : /\.png$/i.test(file) ? "image/png" : /\.webp$/i.test(file) ? "image/webp" : "image/jpeg"; }
