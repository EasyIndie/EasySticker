import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import pino from "pino";
import { buildApp, type AppConfig } from "./app";
import { buildLogger } from "./lib/logger";
import { createFileAssetStore } from "./lib/assets";
import { createSecurity, type SecurityConfig } from "./lib/security";
import { createUserStore } from "./lib/userStore";
import { createUsageStore } from "./lib/usageStore";
import { createMonitorStore } from "./lib/monitorStore";
import { createAlertEngine } from "./lib/alertEngine";
import { createMailer } from "./lib/mailer";
import { createAlertNotifier } from "./lib/alertNotifier";
import type { AppDeps } from "./lib/deps";
import { loadPromptConfig, type PromptConfig } from "./services/generate/promptConfig";

function loadSecurityConfig(config: PromptConfig): SecurityConfig {
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
      maxGenerations: Number(envQuota ?? security.dailyQuota?.maxGenerations ?? 100),
      anonymousMaxGenerations: Number(security.dailyQuota?.anonymousMaxGenerations ?? 10)
    },
    corsAllowOrigin: envCors || security.corsAllowOrigin,
    trustProxy: security.trustProxy,
    registration: security.registration
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

  // ── Composition root: build all dependencies here ──────────
  const logger = pino(buildLogger(logLevel));

  // Default admin is created first so we can fall back to its password
  // as the invite/api token when no explicit token was configured.
  const adminEmail = process.env["ADMIN_EMAIL"] || "admin@easysticker.app";
  const adminPassword = process.env["ADMIN_PASSWORD"] || crypto.randomUUID().slice(0, 12);
  const userStore = createUserStore(dataDir);
  const hasAdmin = userStore.ensureAdmin(adminEmail, adminPassword);

  const securityConfig = loadSecurityConfig(config);
  if (!process.env["API_TOKEN"] && !config.server?.security?.apiToken && hasAdmin) {
    // First run without an explicit token: use the admin password as invite token.
    securityConfig.apiToken = adminPassword;
  }

  const security = createSecurity(securityConfig);
  const usageStore = createUsageStore(dataDir);
  const monitorStore = createMonitorStore(dataDir, config.server?.security?.monitorRetentionDays ?? 7);

  // Mailer (password reset / email verification)
  const smtpHost = process.env["SMTP_HOST"] || "";
  const smtpPort = Number(process.env["SMTP_PORT"] || 587);
  const smtpUser = process.env["SMTP_USER"] || "";
  const smtpPass = process.env["SMTP_PASS"] || "";
  const smtpFrom = process.env["SMTP_FROM"] || "noreply@easysticker.app";
  const baseUrl = process.env["BASE_URL"] || `http://localhost:${port}`;

  const mailer = createMailer(
    { host: smtpHost, port: smtpPort, user: smtpUser, pass: smtpPass, from: smtpFrom, baseUrl },
    logger
  );
  if (smtpHost) {
    logger.info({ host: smtpHost, port: smtpPort }, "Mailer initialized");
  } else {
    logger.warn("No SMTP_HOST configured — password reset emails will be logged to console only");
  }

  // Alert engine
  const alertConfigPath = path.join(dataDir, "alerts-config.json");
  const alertEngine = createAlertEngine(alertConfigPath, monitorStore, logger);

  const deps: AppDeps = {
    dataDir,
    assetStore: createFileAssetStore(dataDir),
    security,
    securityConfig,
    userStore,
    usageStore,
    monitorStore,
    alertEngine,
    mailer
  };

  const appConfig: AppConfig = {
    host,
    port,
    dataDir,
    logLevel,
    security: securityConfig,
    monitorRetentionDays: config.server?.security?.monitorRetentionDays ?? 7
  };

  const app = buildApp(appConfig, deps);

  const alertNotifier = createAlertNotifier(() => alertEngine.getConfig(), logger);

  // Notification cooldown tracker: rule_id → last sent timestamp
  const lastNotifySent = new Map<string, number>();

  // Evaluate alerts every 30s and send notifications
  const alertInterval = setInterval(() => {
    alertEngine.evaluate();
    const active = alertEngine.getActiveAlerts();
    const now = Date.now();
    for (const alert of active) {
      const rule = alertEngine.getRules().find(r => r.id === alert.rule);
      if (!rule) continue;
      const last = lastNotifySent.get(alert.rule) ?? 0;
      if (now - last >= rule.silenceMs) {
        alertNotifier.send(alert);
        lastNotifySent.set(alert.rule, now);
      }
    }
  }, 30_000);

  // Start periodic monitoring
  const systemInterval = setInterval(() => monitorStore.recordSystem(), 10_000);
  const diskInterval = setInterval(() => monitorStore.recordDisk(), 60_000);
  const cleanupInterval = setInterval(() => monitorStore.cleanup(), 3_600_000);

  app.addHook("onClose", (_instance, done) => {
    clearInterval(systemInterval);
    clearInterval(diskInterval);
    clearInterval(cleanupInterval);
    clearInterval(alertInterval);
    done();
  });

  if (hasAdmin) {
    logger.info({ email: adminEmail }, "Default admin account created");
    console.log(`\n🔑 Default admin: ${adminEmail} / ${adminPassword}\n`);
  }

  await app.listen({ host, port });
  app.log.info({ host, port, auth: security.isAuthEnabled }, "server listening");
  console.log(`\n🌐 EasySticker 已启动！`);
  console.log(`   本机:   http://localhost:${port}`);
  if (host === "0.0.0.0") {
    // Show all non-internal network addresses
    const os = require("node:os");
    const ifaces = os.networkInterfaces();
    for (const name of Object.keys(ifaces)) {
      for (const info of ifaces[name] || []) {
        if (info.family === "IPv4" && !info.internal) {
          console.log(`   网络:   http://${info.address}:${port}`);
        }
      }
    }
  } else {
    console.log(`   地址:   http://${host}:${port}`);
  }
  console.log(`   管理后台: http://localhost:${port}/admin.html`);
  console.log();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
