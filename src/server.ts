import fs from "node:fs";
import path from "node:path";
import { buildApp } from "./app";

function envInt(name: string, defaultValue: number): number {
  const raw = process.env[name];
  if (!raw) return defaultValue;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : defaultValue;
}

async function main() {
  const host = process.env.HOST ?? "0.0.0.0";
  const port = envInt("PORT", 3000);
  const dataDir = process.env.DATA_DIR ?? path.join(process.cwd(), "data");
  const logLevel = process.env.LOG_LEVEL ?? "info";

  fs.mkdirSync(dataDir, { recursive: true });

  const app = buildApp({ host, port, dataDir, logLevel });

  await app.listen({ host, port });
  app.log.info({ host, port }, "server listening");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

