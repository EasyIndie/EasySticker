import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import Fastify, {
  type FastifyError,
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest
} from "fastify";
import multipart from "@fastify/multipart";
import staticPlugin from "@fastify/static";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import { buildLogger } from "./lib/logger";
import { createSecurity, type SecurityConfig } from "./lib/security";
import { registerUploadRoutes } from "./routes/uploads";
import { registerAssetRoutes } from "./routes/assets";
import { registerPackRoutes } from "./routes/packs";
import { registerGenerateRoutes } from "./routes/generate";
import { registerConfigRoutes } from "./routes/config";

export type AppConfig = {
  host: string;
  port: number;
  dataDir: string;
  logLevel: string;
  security?: SecurityConfig;
};

declare module "fastify" {
  interface FastifyInstance {
    appConfig: AppConfig;
    security: ReturnType<typeof createSecurity>;
  }
}

// Routes that don't require authentication
const PUBLIC_ROUTES = new Set([
  "/", "/index.html",
  "/health", "/docs", "/docs/",
  "/@vite/client"
]);
// Static file extensions that don't need auth
const STATIC_EXTS = new Set([".css", ".js", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".ico", ".html", ".json"]);

function isPublicRoute(url: string): boolean {
  const [path] = url.split("?");
  if (PUBLIC_ROUTES.has(path)) return true;
  const ext = path.slice(path.lastIndexOf("."));
  if (ext && STATIC_EXTS.has(ext)) return true;
  return false;
}

async function renderIndexHtml() {
  return fs.readFile(path.join(process.cwd(), "public", "index.html"), "utf8");
}

export function buildApp(config: AppConfig): FastifyInstance {
  const app = Fastify({
    logger: buildLogger(config.logLevel),
    genReqId: () => crypto.randomUUID(),
    bodyLimit: 10 * 1024 * 1024 // 10MB JSON body limit
  });

  app.decorate("appConfig", config);
  app.decorate("security", createSecurity(config.security ?? {}));

  // Start rate limit / quota cleanup
  app.addHook("onReady", () => {
    app.security.startCleanup();
  });

  app.addHook("onClose", (_instance, done) => {
    app.security.stopCleanup();
    done();
  });

  // ===== Global Hooks =====

  // 1. Health check (no auth)
  app.get("/health", async (_req, reply) => {
    return {
      ok: true,
      uptime: process.uptime(),
      timestamp: new Date().toISOString()
    };
  });

  // 2. API Token authentication
  app.addHook("onRequest", async (req, reply) => {
    // Skip auth for public routes
    if (isPublicRoute(req.url)) return;

    // Skip auth for OPTIONS (CORS preflight)
    if (req.method === "OPTIONS") return;

    if (!app.security.isAuthEnabled) return;

    const authHeader = req.headers.authorization;
    const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : undefined;

    if (!app.security.checkAuth(token)) {
      reply.status(401).send({
        error: "Unauthorized",
        message: "Missing or invalid API token. Set Authorization: Bearer <token>.",
        requestId: req.id
      });
    }
  });

  // 3. Rate limiting
  app.addHook("onRequest", async (req, reply) => {
    if (!app.security.isRateLimitEnabled) return;
    if (isPublicRoute(req.url)) return;
    if (req.method === "OPTIONS") return;

    const key = (req.headers.authorization?.slice(7)) || req.ip;
    const result = app.security.checkRateLimit(key);

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

  // 4. Daily generation quota check (only for generate routes)
  app.addHook("onRequest", async (req, reply) => {
    if (!app.security.isQuotaEnabled) return;
    if (isPublicRoute(req.url)) return;
    if (req.method === "OPTIONS") return;

    // Only enforce quota on generation API calls
    const url = req.url.split("?")[0];
    if (!url.startsWith("/api/generate/")) return;

    const key = (req.headers.authorization?.slice(7)) || req.ip;
    const quota = app.security.checkQuota(key);

    if (!quota.allowed) {
      reply.status(429).send({
        error: "Quota Exceeded",
        message: `Daily generation quota of ${quota.max} exceeded. Try again tomorrow.`,
        used: quota.used,
        max: quota.max,
        requestId: req.id
      });
    }
  });

  // 5. CORS — restrict in production if allowOrigin configured
  app.addHook("onRequest", async (req, reply) => {
    const origin = req.headers.origin;
    if (origin) {
      const allowed = config.security?.corsAllowOrigin;
      if (allowed === "*" || !allowed) {
        reply.header("Access-Control-Allow-Origin", origin);
      } else if (allowed === origin) {
        reply.header("Access-Control-Allow-Origin", origin);
      }
      reply.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      reply.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
    }
    if (req.method === "OPTIONS") {
      reply.status(204).send();
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

  // ===== Static file serving & SPA routes =====
  async function serveIndex(_req: FastifyRequest, reply: FastifyReply) {
    reply.header("content-type", "text/html; charset=utf-8");
    return renderIndexHtml();
  }

  app.get("/", serveIndex);
  app.get("/index.html", serveIndex);

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

  // ===== API routes =====
  app.register(registerUploadRoutes, { prefix: "/api" });
  app.register(registerAssetRoutes, { prefix: "/api" });
  app.register(registerPackRoutes, { prefix: "/api" });
  app.register(registerGenerateRoutes, { prefix: "/api" });
  app.register(registerConfigRoutes, { prefix: "/api" });

  return app;
}
