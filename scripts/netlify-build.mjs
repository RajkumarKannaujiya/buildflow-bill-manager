import { spawn } from "node:child_process";

function run(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { stdio: "inherit", env: process.env });
    child.on("error", reject);
    child.on("exit", (code) => code === 0 ? resolve() : reject(new Error(`node ${args.join(" ")} exited with code ${code}`)));
  });
}

const databaseUrl = process.env.DATABASE_URL || process.env.NETLIFY_DB_URL;
if (databaseUrl) process.env.DATABASE_URL = databaseUrl;

await run(["node_modules/prisma/build/index.js", "generate"]);

if (databaseUrl) {
  await run(["node_modules/prisma/build/index.js", "migrate", "deploy"]);
  const { PrismaClient } = await import("@prisma/client");
  const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  let hasUsers;
  try { hasUsers = (await db.user.count()) > 0; }
  finally { await db.$disconnect(); }
  if (!hasUsers) await run(["node_modules/tsx/dist/cli.mjs", "prisma/seed.ts"]);
} else if (process.env.NETLIFY === "true") {
  console.warn("NETLIFY_DB_URL is not set. The build can publish, but sign-in and bill workflows need a configured PostgreSQL database.");
}

await run(["node_modules/next/dist/bin/next", "build"]);
