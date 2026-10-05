import { type FastifyInstance, type FastifyRequest } from "fastify";
import { generateAssetsAndPack, getPromptTemplate } from "../services/generate/flow";
import { generateSingleResource } from "../services/generate/single";
import { importStickerPack } from "../services/generate/import";
import { restorePackFromZip } from "../services/generate/restore";
import { promptSchema, generateSchema, cancelSchema, resourceSchema } from "../shared/contracts";
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
import { resolveRequester } from "../lib/owner";

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
    const { owner } = await resolveRequester(req);
    return importStickerPack(deps.assetStore, deps.dataDir, presetId, req, owner);
  });

  // 导入从本站下载的 ZIP 包，还原生成现场（可继续单张重生成 / 二次编辑）。
  app.post("/generate/import-pack", async (req, reply) => {
    const presetId = (req.body as any)?.presetId || "wechat_stickers";
    const { owner } = await resolveRequester(req);
    return restorePackFromZip(deps.assetStore, deps.dataDir, presetId, req, owner);
  });

  // Daily quota: registered users capped per account, anonymous users capped per IP.
  // 返回 null 表示放行；否则返回要为客户端回写的错误体。
  async function enforceGenerationQuota(req: FastifyRequest): Promise<{ status: number; body: unknown } | null> {
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
        return {
          status: 429,
          body: {
            error: "QuotaExceeded",
            message: isRegistered
              ? `今日生成配额已用完（注册用户每日 ${limit} 次）。`
              : `今日生成配额已用完（匿名用户每日 ${limit} 次），登录后可提升配额。`
          }
        };
      }
      deps.usageStore.log({ email: quotaKey, action: "generate", success: true });
    } catch {}
    return null;
  }

  app.post("/generate/resource", async (req, reply) => {
    const parsed = resourceSchema.safeParse(req.body);
    if (!parsed.success) {
      reply.status(400);
      return { error: "BadRequest", message: "invalid request body", issues: parsed.error.issues };
    }
    const quotaError = await enforceGenerationQuota(req);
    if (quotaError) {
      reply.status(quotaError.status);
      return quotaError.body;
    }
    return generateSingleResource(deps.assetStore, parsed.data.presetId, parsed.data);
  });

  app.post("/generate/start", async (req, reply) => {
    const parsed = generateSchema.safeParse(req.body);
    if (!parsed.success) {
      reply.status(400);
      return { error: "BadRequest", message: "invalid request body", issues: parsed.error.issues };
    }
    const task = createTask();

    const quotaError = await enforceGenerationQuota(req);
    if (quotaError) {
      reply.status(quotaError.status);
      return quotaError.body;
    }

    const abortController = new AbortController();
    setTaskCancelHandler(task.id, () => abortController.abort());
    // 在请求生命周期内解析归属（setImmediate 之后 req.user 可能已不可用）
    const { owner } = await resolveRequester(req);

    setImmediate(async () => {
      try {
        await generateAssetsAndPack(
          deps.assetStore,
          deps.dataDir,
          parsed.data.presetId,
          parsed.data,
          (event, data) => appendEvent(task, event, data),
          () => Boolean(getTask(task.id)?.canceled),
          abortController.signal,
          owner
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
