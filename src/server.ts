import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { buildApp, type AppConfig } from "./app";
import { createAlertEngine } from "./lib/alertEngine";
import { createAlertNotifier } from "./lib/alertNotifier";
import { loadPromptConfig, type PromptConfig } from "./services/generate/promptConfig";

function loadSecurityConfig(config: PromptConfig): AppConfig["security"] {
  const security = config.server?.security ?? {};

  const envToken = process.env["API_TOKEN"];
  const envRateLimit = process.env["RATE_LIMIT_MAX"];
  const envQuota = process.env["DAILY_QUOTA_MAX"];
  const envCors = process.env["CORS_ALLOW_ORIGIN"];
  const envDisableAuth = process.env["DISABLE_AUTH"];
  const envJwtSecret = process.env["JWT_SECRET"];

  return {
    apiToken: envToken || security.apiToken,
    enableAuth: envDisableAuth ? false : (security.enableAuth ?? true),
    jwtSecret: envJwtSecret || security.jwtSecret,
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
    security: loadSecurityConfig(config),
    monitorRetentionDays: config.server?.security?.monitorRetentionDays ?? 7,
  };

  const app = buildApp(appConfig);

  // ── Alert Engine ──────────────────────────────────────────
  const alertConfigPath = path.join(dataDir, "alerts-config.json");
  const alertEngine = createAlertEngine(alertConfigPath, app.monitorStore, app.log);
  app.decorate("alertEngine", alertEngine);

  const alertNotifier = createAlertNotifier(() => app.alertEngine.getConfig(), app.log);

  // Notification cooldown tracker: rule_id → last sent timestamp
  const lastNotifySent = new Map<string, number>();

  // Evaluate alerts every 30s and send notifications
  const alertInterval = setInterval(() => {
    app.alertEngine.evaluate();
    const active = app.alertEngine.getActiveAlerts();
    const now = Date.now();
    for (const alert of active) {
      const rule = app.alertEngine.getRules().find(r => r.id === alert.rule);
      if (!rule) continue;
      const last = lastNotifySent.get(alert.rule) ?? 0;
      if (now - last >= rule.silenceMs) {
        alertNotifier.send(alert);
        lastNotifySent.set(alert.rule, now);
      }
    }
  }, 30_000);

  // Start periodic monitoring
  const systemInterval = setInterval(() => app.monitorStore.recordSystem(), 10_000);
  const diskInterval = setInterval(() => app.monitorStore.recordDisk(), 60_000);
  const cleanupInterval = setInterval(() => app.monitorStore.cleanup(), 3_600_000);

  app.addHook("onClose", (_instance, done) => {
    clearInterval(systemInterval);
    clearInterval(diskInterval);
    clearInterval(cleanupInterval);
    clearInterval(alertInterval);
    done();
  });

  // Ensure default admin on first run
  const adminEmail = process.env["ADMIN_EMAIL"] || "admin@easysticker.app";
  const adminPassword = process.env["ADMIN_PASSWORD"] || crypto.randomUUID().slice(0, 12);
  const hasAdmin = app.userStore.ensureAdmin(adminEmail, adminPassword);

  if (hasAdmin) {
    app.log.info({ email: adminEmail }, "Default admin account created");
    // If no explicit API_TOKEN was configured, use the admin password as invite token
    if (!process.env["API_TOKEN"] && !config.server?.security?.apiToken) {
      appConfig.security!.apiToken = adminPassword;
    }
    console.log(`\n🔑 Default admin: ${adminEmail} / ${adminPassword}\n`);
  }

  await app.listen({ host, port });
  app.log.info({ host, port, auth: app.security.isAuthEnabled }, "server listening");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
