import fs from "node:fs";
import path from "node:path";
import { buildApp, type AppConfig } from "./app";
import { loadPromptConfig, type PromptConfig } from "./services/generate/promptConfig";

function loadSecurityConfig(config: PromptConfig): AppConfig["security"] {
  const security = config.server?.security ?? {};
  
  // Env vars override config file
  const envToken = process.env["API_TOKEN"];
  const envRateLimit = process.env["RATE_LIMIT_MAX"];
  const envQuota = process.env["DAILY_QUOTA_MAX"];
  const envCors = process.env["CORS_ALLOW_ORIGIN"];
  const envDisableAuth = process.env["DISABLE_AUTH"];

  return {
    apiToken: envToken || security.apiToken,
    enableAuth: envDisableAuth ? false : (security.enableAuth ?? true),
    rateLimit: {
      maxRequests: Number(envRateLimit ?? security.rateLimit?.maxRequests ?? 30),
      windowMs: security.rateLimit?.windowMs ?? 60_000
    },
    dailyQuota: {
      maxGenerations: Number(envQuota ?? security.dailyQuota?.maxGenerations ?? 100)
    },
    corsAllowOrigin: envCors || security.corsAllowOrigin
  };
}

async function main() {
  const config = loadPromptConfig();
  const serverConfig = config.server || {};

  const host = serverConfig.host ?? "0.0.0.0";
  const port = Number(process.env["PORT"] ?? serverConfig.port ?? 3000);
  const dataDir = process.env["DATA_DIR"] || serverConfig.dataDir || path.join(process.cwd(), "data");
  const logLevel = process.env["LOG_LEVEL"] || serverConfig.logLevel || "info";

  fs.mkdirSync(dataDir, { recursive: true });

  const appConfig: AppConfig = {
    host,
    port,
    dataDir,
    logLevel,
    security: loadSecurityConfig(config)
  };

  const app = buildApp(appConfig);

  await app.listen({ host, port });
  app.log.info({ host, port, auth: app.security.isAuthEnabled }, "server listening");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
