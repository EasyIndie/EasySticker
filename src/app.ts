import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import Fastify, {
  type FastifyError,
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest
} from "fastify";
import jwt from "@fastify/jwt";
import multipart from "@fastify/multipart";
import staticPlugin from "@fastify/static";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import { buildLogger } from "./lib/logger";
import { createFileAssetStore } from "./lib/assets";
import { createSecurity, type SecurityConfig } from "./lib/security";
import { createUserStore } from "./lib/userStore";
import { createUsageStore } from "./lib/usageStore";
import { createMonitorStore } from "./lib/monitorStore";
import type { AppDeps } from "./lib/deps";
import { registerUploadRoutes } from "./routes/uploads";
import { registerAssetRoutes } from "./routes/assets";
import { registerPackRoutes } from "./routes/packs";
import { registerGenerateRoutes } from "./routes/generate";
import { registerConfigRoutes } from "./routes/config";
import { registerAuthRoutes } from "./routes/auth";
import { registerAdminRoutes } from "./routes/admin";

export type AppConfig = {
  host: string;
  port: number;
  dataDir: string;
  logLevel: string;
  security?: SecurityConfig;
  monitorRetentionDays?: number;
};

// Routes that don't require authentication
const PUBLIC_ROUTES = new Set([
  "/", "/index.html", "/internal.html",
  "/health", "/docs", "/docs/",
  "/@vite/client",
  "/api/config",
  "/api/auth/login", "/api/auth/register",
  "/api/auth/forgot-password", "/api/auth/reset-password-with-token"
]);
// Static file extensions that don't need auth
const STATIC_EXTS = new Set([".css", ".js", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".ico", ".html", ".json"]);

// 前缀匹配的公开资源：它们是只读内容，<img src> / <a href> 无法携带
// Authorization 头；同时必须豁免 API 频率限制，否则一次结果要加载几十张
// 图片会瞬间超过 maxRequests 而触发 429，导致图片加载失败。
const PUBLIC_PREFIXES = ["/api/assets/"];

function isPublicRoute(url: string): boolean {
  const [path] = url.split("?");
  if (PUBLIC_ROUTES.has(path)) return true;
  if (PUBLIC_PREFIXES.some((prefix) => path.startsWith(prefix))) return true;
  if (path.startsWith("/api/packs/") && path.endsWith("/download")) return true;
  const ext = path.slice(path.lastIndexOf("."));
  if (ext && STATIC_EXTS.has(ext)) return true;
  return false;
}

async function renderIndexHtml() {
  return fs.readFile(path.join(process.cwd(), "public", "index.html"), "utf8");
}

export function buildApp(config: AppConfig, deps?: Partial<AppDeps>): FastifyInstance {
  const resolved: AppDeps = {
    dataDir: config.dataDir,
    assetStore: deps?.assetStore ?? createFileAssetStore(config.dataDir),
    security: deps?.security ?? createSecurity(config.security ?? {}),
    securityConfig: config.security ?? {},
    userStore: deps?.userStore ?? createUserStore(config.dataDir),
    usageStore: deps?.usageStore ?? createUsageStore(config.dataDir),
    monitorStore: deps?.monitorStore ?? createMonitorStore(config.dataDir, config.monitorRetentionDays),
    alertEngine: deps?.alertEngine,
    mailer: deps?.mailer
  };

  const app = Fastify({
    logger: buildLogger(config.logLevel),
    genReqId: () => crypto.randomUUID(),
    bodyLimit: 10 * 1024 * 1024,
    trustProxy: config.security?.trustProxy ?? false
  });

  // ===== JWT =====
  const jwtSecret = config.security?.jwtSecret || process.env["JWT_SECRET"] || crypto.randomBytes(32).toString("hex");
  app.register(jwt, { secret: jwtSecret });

  // Start periodic cleanup
  app.addHook("onReady", () => {
    resolved.security.startCleanup();
  });

  app.addHook("onClose", (_instance, done) => {
    resolved.security.stopCleanup();
    done();
  });

  // ===== Request Metrics Hook =====
  app.addHook("onRequest", async (req) => {
    (req as any).__startTime = performance.now();
  });

  app.addHook("onResponse", async (req, reply) => {
    if (!req.url.startsWith("/api/")) return;
    const startTime = (req as any).__startTime;
    if (typeof startTime !== "number") return;
    const latencyMs = Math.round(performance.now() - startTime);
    resolved.monitorStore.recordRequest({
      method: req.method,
      route: req.routeOptions?.url || req.url,
      status: reply.statusCode,
      durationMs: latencyMs
    });
  });

  // ===== Security Headers =====
  app.addHook("onRequest", async (req, reply) => {
    // CSP: restrict script/styles to same-origin only
    reply.header("Content-Security-Policy",
      "default-src 'self'; " +
      "script-src 'self' 'sha256-/susv/jnX6eIOdo/5fuyXHc/B4oDj3/0ITkfcVXVkg0='; " +
      "style-src 'self' 'unsafe-inline'; " +
      "img-src 'self' data: blob:; " +
      "font-src 'self'; " +
      "connect-src 'self' ws: wss:; " +
      "frame-ancestors 'none';");
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("X-Frame-Options", "DENY");
    reply.header("Referrer-Policy", "strict-origin-when-cross-origin");
    reply.header("X-DNS-Prefetch-Control", "off");
    // HSTS: only advertise over HTTPS (browsers ignore it on plain HTTP anyway)
    if (req.protocol === "https") {
      reply.header("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    }
  });

  // ===== Global Hooks =====

  // 1. Health check
  app.get("/health", async (_req, reply) => {
    return {
      ok: true,
      uptime: process.uptime(),
      timestamp: new Date().toISOString()
    };
  });

  // 2. CORS
  app.addHook("onRequest", async (req, reply) => {
    const origin = req.headers.origin;
    if (origin) {
      const allowed = config.security?.corsAllowOrigin;
      // Strict same-origin only; if allowOrigin is set, only that origin is allowed
      if (allowed && origin === allowed) {
        reply.header("Access-Control-Allow-Origin", allowed);
        reply.header("Vary", "Origin");
      }
      reply.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      reply.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
      reply.header("Access-Control-Max-Age", "86400");
    }
    if (req.method === "OPTIONS") {
      reply.status(204).send();
    }
  });

  // 3. API Token auth (machine-to-machine, Phase 1)
  app.addHook("onRequest", async (req, reply) => {
    if (isPublicRoute(req.url)) return;
    if (req.method === "OPTIONS") return;
    if (!resolved.security.isAuthEnabled) return;

    const authHeader = req.headers.authorization;
    const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : undefined;

    // 接受两种凭证：机器对机器 API token，或用户 JWT（由各路由自行校验）。
    // 这样设置 API_TOKEN 后，前端仍可继续用 JWT 访问 /api/auth/me、/api/generate/* 等。
    if (resolved.security.checkAuth(token)) return;

    try {
      await req.jwtVerify();
      return; // 有效 JWT，放行
    } catch {
      // 不是有效 JWT，继续拒绝
    }

    reply.status(401).send({
      error: "Unauthorized",
      message: "Missing or invalid API token. Set Authorization: Bearer <token>.",
      requestId: req.id
    });
  });

  // 4. Rate limiting
  app.addHook("onRequest", async (req, reply) => {
    if (!resolved.security.isRateLimitEnabled) return;
    if (isPublicRoute(req.url)) return;
    if (req.method === "OPTIONS") return;

    // Login endpoints: stricter rate limit (half the normal window)
    const isLoginRoute = req.url === "/api/auth/login" || req.url === "/api/auth/register";
    // Key by IP only — using the Authorization header here would let callers bypass
    // the limiter by sending a fresh random token per request.
    const key = req.ip;
    const result = isLoginRoute
      ? resolved.security.checkRateLimit(key, { maxRequests: 5, windowMs: 60_000 })
      : resolved.security.checkRateLimit(key);
    if (result && !result.allowed) {
      const retryAfter = Math.ceil((result.resetAt - Date.now()) / 1000);
      reply.header("Retry-After", String(retryAfter));
      reply.status(429).send({
        error: "Too Many Requests",
        message: `Rate limit exceeded. Try again in ${retryAfter}s.`,
        requestId: req.id
      });
    }
  });

  // ===== Error handler =====
  app.setErrorHandler((err: FastifyError, req: FastifyRequest, reply: FastifyReply) => {
    req.log.error({ err, requestId: req.id }, "request error");
    const statusCode = typeof (err as any).statusCode === "number" ? (err as any).statusCode : 500;
    reply.status(statusCode).send({
      requestId: req.id,
      error: statusCode >= 500 ? "InternalServerError" : "BadRequest",
      message: err.message
    });
  });

  // ===== Plugins =====
  app.register(swagger, {
    openapi: {
      info: {
        title: "EasySticker API",
        version: "0.1.0"
      }
    }
  });
  app.register(swaggerUi, { routePrefix: "/docs" });

  app.register(multipart, {
    limits: { fileSize: 25 * 1024 * 1024 }
  });

  // ===== Static serving =====
  app.register(staticPlugin, {
    root: path.join(process.cwd(), "public"),
    prefix: "/",
    cacheControl: true,
    maxAge: "3600",
    immutable: false,
    decorateReply: false
  });

  app.get("/@vite/client", async (_req, reply) => {
    reply.header("content-type", "application/javascript; charset=utf-8");
    return "export {};";
  });

  async function serveIndex(_req: FastifyRequest, reply: FastifyReply) {
    reply.header("content-type", "text/html; charset=utf-8");
    return renderIndexHtml();
  }

  app.get("/", serveIndex);
  app.get("/index.html", serveIndex);

  // ===== API Routes =====
  app.register(registerAuthRoutes(resolved), { prefix: "/api" });
  app.register(registerAdminRoutes(resolved), { prefix: "/api" });
  app.register(registerUploadRoutes(resolved), { prefix: "/api" });
  app.register(registerAssetRoutes(resolved), { prefix: "/api" });
  app.register(registerPackRoutes(resolved), { prefix: "/api" });
  app.register(registerGenerateRoutes(resolved), { prefix: "/api" });
  app.register(registerConfigRoutes, { prefix: "/api" });

  return app;
}
