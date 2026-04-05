import fs from "node:fs";
import path from "node:path";
import { buildApp } from "./app";
import { loadPromptConfig } from "./services/wechat/promptConfig";

async function main() {
  const config = loadPromptConfig();
  const serverConfig = config.server || {};

  const host = serverConfig.host ?? "0.0.0.0";
  const port = serverConfig.port ?? 3000;
  const dataDir = serverConfig.dataDir ?? path.join(process.cwd(), "data");
  const logLevel = serverConfig.logLevel ?? "info";

  fs.mkdirSync(dataDir, { recursive: true });

  const app = buildApp({ host, port, dataDir, logLevel });

  await app.listen({ host, port });
  app.log.info({ host, port }, "server listening");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

