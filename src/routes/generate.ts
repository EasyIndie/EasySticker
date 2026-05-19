import { type FastifyInstance } from "fastify";
import { z } from "zod";
import { generateAssetsAndPack, getPromptTemplate } from "../services/generate/flow";
import { importStickerPack } from "../services/generate/import";
import { getPlatformPreset } from "../services/platform/presets";
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

function buildCountSchema(presetId: string) {
  const preset = getPlatformPreset(presetId);
  const min = preset?.minCount ?? 1;
  const max = preset?.maxCount ?? 50;
  return z.number().int().min(min).max(max);
}

const promptSchema = z.object({
  referenceAssetId: z.string().min(1),
  presetId: z.string().min(1).default("wechat_stickers")
});

const generateSchema = z.object({
  presetId: z.string().min(1).default("wechat_stickers"),
  referenceAssetId: z.string().min(1),
  prompt: z.string().min(1),
  provider: z.string().optional(),
  styles: z.array(z.string().min(1)).optional(),
  stickerCount: z.number().int().min(1).max(50).optional(),
  enableReward: z.boolean().optional(),
  includeCover: z.boolean().optional(),
  includeIcon: z.boolean().optional(),
  includeBanner: z.boolean().optional(),
  metadata: z
    .object({
      title: z.string().min(1).optional(),
      author: z.string().min(1).optional(),
      copyright: z.string().min(1).optional(),
      version: z.string().min(1).optional(),
      rewardMessage: z.string().min(1).optional()
    })
    .optional()
});

const cancelSchema = z.object({
  taskId: z.string().min(1)
});

export async function registerGenerateRoutes(app: FastifyInstance) {
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
    const result = await importStickerPack(app, presetId, req);
    return result;
  });

  app.post("/generate/start", async (req, reply) => {
    const parsed = generateSchema.safeParse(req.body);
    if (!parsed.success) {
      reply.status(400);
      return { error: "BadRequest", message: "invalid request body", issues: parsed.error.issues };
    }
    const task = createTask();
    const abortController = new AbortController();
    setTaskCancelHandler(task.id, () => abortController.abort());

    setImmediate(async () => {
      try {
        await generateAssetsAndPack(
          app,
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
}
