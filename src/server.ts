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
import { getDefaultProviderSummary } from "./services/ai/index";

/**
 * 配置优先级（从高到低）：
 *   1. 真实环境变量（shell / 系统 / CI 注入）
 *   2. `.env` 文件（本地密钥 / 覆盖项，不提交到版本控制）
 *   3. `prompt-config.json` 的 `server.*` 段
 *   4. 代码默认值
 *
 * 加载 `.env` 时不会覆盖已存在的环境变量，因此真实环境变量永远优先于
 * `.env`，而 `.env` 又优先于 prompt-config.json（见下方各处 `process.env
 * ?? config ?? default` 的取值方式）。
 */
function loadEnvFile(filePath = path.join(process.cwd(), ".env")): void {
  try {
    if (!fs.existsSync(filePath)) return;
    const content = fs.readFileSync(filePath, "utf-8");
    for (const rawLine of content.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;

      const eq = line.indexOf("=");
      if (eq <= 0) continue;

      let key = line.slice(0, eq).trim();
      // 支持 `export KEY=VALUE` 写法
      key = key.replace(/^export\s+/, "");
      let value = line.slice(eq + 1).trim();
      // 去掉成对引号
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }

      if (key && process.env[key] === undefined) {
        process.env[key] = value;
      }
    }
  } catch (err) {
    console.warn("Failed to load .env file:", err instanceof Error ? err.message : err);
  }
}

function loadSecurityConfig(config: PromptConfig): SecurityConfig {
  const security = config.server?.security ?? {};

  const envToken = process.env["API_TOKEN"];
  const envRateLimit = process.env["RATE_LIMIT_MAX"];
  const envQuota = process.env["DAILY_QUOTA_MAX"];
  const envAnonymousQuota = process.env["DAILY_QUOTA_ANONYMOUS_MAX"];
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
      anonymousMaxGenerations: Number(envAnonymousQuota ?? security.dailyQuota?.anonymousMaxGenerations ?? 10)
    },
    corsAllowOrigin: envCors || security.corsAllowOrigin,
    trustProxy: security.trustProxy,
    registration: security.registration
  };
}

async function main() {
  // 先加载 .env（不覆盖真实环境变量），再读取其余配置。
  loadEnvFile();

  const config = loadPromptConfig();
  const serverConfig = config.server || {};

  // HOST 环境变量优先（pi 的 /dev 指令据此控制本机/局域网监听），
  // 其次 prompt-config 的 server.host，最后默认 0.0.0.0。
  const host = process.env["HOST"] ?? serverConfig.host ?? "0.0.0.0";
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
    monitorRetentionDays: config.server?.security?.monitorRetentionDays ?? 7,
    maintenance: config.server?.maintenance ?? {}
  };

  const app = buildApp(appConfig, deps);

  const alertNotifier = createAlertNotifier(() => alertEngine.getConfig(), logger);

  // Evaluate alerts every 30s and dispatch notifications.
  //
  // 节流策略（修复「webhook 发送太频繁」）：
  // - 触发 / 恢复这类状态变化立即推送一次；
  // - 告警持续期间按 max(规则 silenceMs, 全局 notificationInterval) 提醒，
  //   且 lastNotifiedAt 持久化在告警记录里 —— 重启后不会立刻把活跃告警再推一遍；
  // - 恢复通知只发一次（drainResolved 取走）。
  const alertInterval = setInterval(() => {
    alertEngine.evaluate();
    const config = alertEngine.getConfig();
    const now = Date.now();

    // 1) 持续中的告警：到点才提醒（全局间隔作为下限，避免规则各自为政造成密集推送）
    for (const alert of alertEngine.getActiveAlerts()) {
      const rule = alertEngine.getRules().find((r) => r.id === alert.rule);
      if (!rule) continue;
      const interval = Math.max(rule.silenceMs, config.notificationInterval);
      const last = alert.lastNotifiedAt ? Date.parse(alert.lastNotifiedAt) : 0;
      if (now - last >= interval) {
        void alertNotifier.send(alert);
        alertEngine.markNotified(alert.id);
      }
    }

    // 2) 已恢复的告警：补一条恢复通知（旧实现不发恢复，无法知道何时结束）
    for (const alert of alertEngine.drainResolved()) {
      void alertNotifier.send(alert);
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

  // AI 状态：让用户一眼看清是否配置好真实模型
  const ai = getDefaultProviderSummary();
  if (ai.ready && ai.type !== "mock") {
    console.log(`   🤖 AI:   ${ai.id}${ai.model ? ` (${ai.model})` : ""} ✅`);
  } else if (ai.type === "mock") {
    console.log(`   🤖 AI:   mock（本地模拟）`);
    console.log(`           配置真实模型：在 .env 填入 AI_<provider>_API_KEY，或访问管理后台「AI 提供商」`);
  } else {
    console.log(`   🤖 AI:   ${ai.id} ⚠️  不可用 —— ${ai.reason}`);
    console.log(`           当前将回退到 mock；请修正后重启或访问管理后台「AI 提供商」`);
  }
  console.log();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
