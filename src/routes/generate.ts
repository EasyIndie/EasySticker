import { type FastifyInstance } from "fastify";
import { generateAssetsAndPack, getPromptTemplate } from "../services/generate/flow";
import { importStickerPack } from "../services/generate/import";
import { promptSchema, generateSchema, cancelSchema } from "../shared/contracts";
import {
  createTask,
  getTask,
  appendEvent,
  addListener,
  removeListener,
  getEventsSince,
  ensureTaskGc,
  cancelTask,
  setTaskCancelHandler,
  type TaskEvent
} from "../services/generate/tasks";

import { loadPromptConfig } from "../services/generate/promptConfig";
import type { AppDeps } from "../lib/deps";

export function registerGenerateRoutes(deps: AppDeps) {
  return async (app: FastifyInstance) => {
  const config = loadPromptConfig();
  const serverConfig = config.server || {};
  ensureTaskGc(serverConfig.taskTtlMs ?? 10 * 60 * 1000, serverConfig.taskGcIntervalMs ?? 60 * 1000);

  app.post("/generate/prompt", async (req, reply) => {
    const parsed = promptSchema.safeParse(req.body);
    if (!parsed.success) {
      reply.status(400);
      return { error: "BadRequest", message: "invalid request body", issues: parsed.error.issues };
    }
    return getPromptTemplate(parsed.data.referenceAssetId);
  });

  app.post("/generate/import", async (req, reply) => {
    const presetId = (req.body as any)?.presetId || "wechat_stickers";
    const result = await importStickerPack(deps.assetStore, deps.dataDir, presetId, req);
    return result;
  });

  app.post("/generate/start", async (req, reply) => {
    const parsed = generateSchema.safeParse(req.body);
    if (!parsed.success) {
      reply.status(400);
      return { error: "BadRequest", message: "invalid request body", issues: parsed.error.issues };
    }
    const task = createTask();

    // Daily quota: registered users capped per account, anonymous users capped per IP.
    const dailyQuota = deps.securityConfig?.dailyQuota;
    const registeredLimit = dailyQuota?.maxGenerations ?? 100;
    const anonymousLimit = dailyQuota?.anonymousMaxGenerations ?? 10;
    try {
      await req.jwtVerify().catch(() => {});
      const user = req.user as any;
      const isRegistered = Boolean(user && user.email);
      const quotaKey = isRegistered ? (user as { email: string }).email : "ip:" + req.ip;
      const limit = isRegistered ? registeredLimit : anonymousLimit;

      deps.usageStore.maybeRotate();
      const quota = deps.usageStore.checkDailyQuota(quotaKey, limit);
      if (!quota.allowed) {
        reply.status(429);
        return {
          error: "QuotaExceeded",
          message: isRegistered
            ? `今日生成配额已用完（注册用户每日 ${limit} 次）。`
            : `今日生成配额已用完（匿名用户每日 ${limit} 次），登录后可提升配额。`
        };
      }
      deps.usageStore.log({ email: quotaKey, action: "generate", success: true });
    } catch {}

    const abortController = new AbortController();
    setTaskCancelHandler(task.id, () => abortController.abort());

    setImmediate(async () => {
      try {
        await generateAssetsAndPack(
          deps.assetStore,
          deps.dataDir,
          parsed.data.presetId,
          parsed.data,
          (event, data) => appendEvent(task, event, data),
          () => Boolean(getTask(task.id)?.canceled),
          abortController.signal
        );
      } catch (error) {
        if (getTask(task.id)?.canceled) return;
        console.error("[Generate] Task generation failed:", task.id, error);
        appendEvent(task, "error", {
          message: error instanceof Error ? error.message : "生成失败，请稍后重试。"
        });
      }
    });
    return { taskId: task.id };
  });

  app.get("/generate/stream", async (req, reply) => {
    const { taskId } = (req.query ?? {}) as { taskId?: string };
    if (!taskId) {
      reply.status(400);
      return { error: "BadRequest", message: "missing taskId" };
    }
    const task = getTask(taskId);
    if (!task) {
      reply.status(404);
      return { error: "NotFound", message: "task not found" };
    }
    reply.hijack();
    const raw = reply.raw;
    raw.setHeader("content-type", "text/event-stream; charset=utf-8");
    raw.setHeader("cache-control", "no-cache, no-transform");
    raw.setHeader("connection", "keep-alive");
    raw.setHeader("x-accel-buffering", "no");
    raw.flushHeaders?.();

    let closed = false;
    let pingInterval: NodeJS.Timeout;
    let listener: (ev: TaskEvent) => void;

    req.raw.on("close", () => {
      closed = true;
      clearInterval(pingInterval);
      if (listener) removeListener(task, listener);
    });

    pingInterval = setInterval(() => {
      if (!closed) {
        raw.write(`: ping\n\n`);
      }
    }, 10000);

    function send(ev: { id: number; event: string; data: unknown }) {
      if (closed) return;
      raw.write(`id: ${ev.id}\n`);
      raw.write(`event: ${ev.event}\n`);
      raw.write(`data: ${JSON.stringify(ev.data)}\n\n`);
    }

    const lastIdHeader = req.headers["last-event-id"];
    const lastEventId = typeof lastIdHeader === "string" ? Number(lastIdHeader) || 0 : 0;
    const backlog = getEventsSince(task, lastEventId);
    for (const ev of backlog) {
      send(ev);
      if (ev.event === "done" || ev.event === "error") {
        if (!closed) raw.end();
        return;
      }
    }

    listener = (ev: TaskEvent) => {
      send(ev);
      if (ev.event === "done" || ev.event === "error") {
        removeListener(task, listener);
        if (!closed) raw.end();
      }
    };
    addListener(task, listener);
  });

  app.post("/generate/cancel", async (req, reply) => {
    const parsed = cancelSchema.safeParse(req.body);
    if (!parsed.success) {
      reply.status(400);
      return { error: "BadRequest", message: "invalid request body", issues: parsed.error.issues };
    }
    const ok = cancelTask(parsed.data.taskId);
    if (!ok) {
      reply.status(404);
      return { error: "NotFound", message: "task not found" };
    }
    return { ok: true };
    });
  };
}
