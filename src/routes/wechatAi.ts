import { type FastifyInstance } from "fastify";
import { z } from "zod";
import { generateWeChatAssetsAndPack, getWeChatPromptTemplate } from "../services/wechat/aiFlow";
import {
  createTask,
  getTask,
  appendEvent,
  addListener,
  removeListener,
  getEventsSince,
  ensureTaskGc
} from "../services/wechat/tasks";

const promptSchema = z.object({
  referenceAssetId: z.string().min(1)
});

const generateSchema = z.object({
  referenceAssetId: z.string().min(1),
  prompt: z.string().min(1),
  styles: z.array(z.string().min(1)).optional(),
  stickerCount: z.number().int().min(8).max(24).optional(),
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

export async function registerWeChatAiRoutes(app: FastifyInstance) {
  ensureTaskGc(Number(process.env.TASK_TTL_MS ?? 10 * 60 * 1000), Number(process.env.TASK_GC_INTERVAL_MS ?? 60 * 1000));
  app.post("/wechat/prompt", async (req, reply) => {
    const parsed = promptSchema.safeParse(req.body);
    if (!parsed.success) {
      reply.status(400);
      return { error: "BadRequest", message: "invalid request body", issues: parsed.error.issues };
    }
    return getWeChatPromptTemplate(parsed.data.referenceAssetId);
  });

  app.post("/wechat/generate", async (req, reply) => {
    const parsed = generateSchema.safeParse(req.body);
    if (!parsed.success) {
      reply.status(400);
      return { error: "BadRequest", message: "invalid request body", issues: parsed.error.issues };
    }
    reply.hijack();
    const raw = reply.raw;
    raw.setHeader("content-type", "text/event-stream; charset=utf-8");
    raw.setHeader("cache-control", "no-cache, no-transform");
    raw.setHeader("connection", "keep-alive");
    raw.setHeader("x-accel-buffering", "no");
    raw.flushHeaders?.();

    let closed = false;
    req.raw.on("close", () => {
      closed = true;
    });

    function send(event: string, data: unknown) {
      if (closed) return;
      raw.write(`event: ${event}\n`);
      raw.write(`data: ${JSON.stringify(data)}\n\n`);
    }

    try {
      await generateWeChatAssetsAndPack(app, parsed.data, send);
    } catch (error) {
      send("error", {
        message: error instanceof Error ? error.message : "生成失败，请稍后重试。"
      });
    } finally {
      if (!closed) raw.end();
    }
  });

  app.post("/wechat/generate/start", async (req, reply) => {
    const parsed = generateSchema.safeParse(req.body);
    if (!parsed.success) {
      reply.status(400);
      return { error: "BadRequest", message: "invalid request body", issues: parsed.error.issues };
    }
    const task = createTask();
    // run in background
    setImmediate(async () => {
      try {
        await generateWeChatAssetsAndPack(
          app,
          parsed.data,
          (event, data) => appendEvent(task, event, data),
          () => Boolean(getTask(task.id)?.canceled)
        );
      } catch (error) {
        console.error("[WeChatAI] Task generation failed:", task.id, error);
        appendEvent(task, "error", {
          message: error instanceof Error ? error.message : "生成失败，请稍后重试。"
        });
      }
    });
    return { taskId: task.id };
  });

  app.get("/wechat/generate/stream", async (req, reply) => {
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
    
    req.raw.on("close", () => {
      closed = true;
      clearInterval(pingInterval);
      removeListener(task, listener);
    });

    pingInterval = setInterval(() => {
      if (!closed) {
        raw.write(`: ping\n\n`);
      }
    }, 10000); // 10秒发一次心跳注释

    function send(ev: { id: number; event: string; data: unknown }) {
      if (closed) return;
      raw.write(`id: ${ev.id}\n`);
      raw.write(`event: ${ev.event}\n`);
      raw.write(`data: ${JSON.stringify(ev.data)}\n\n`);
    }

    const lastIdHeader = req.headers["last-event-id"];
    const lastEventId = typeof lastIdHeader === "string" ? Number(lastIdHeader) || 0 : 0;
    const backlog = getEventsSince(task, lastEventId);
    for (const ev of backlog) send(ev);

    const listener = (ev: { id: number; event: string; data: unknown }) => {
      send(ev);
      if (ev.event === "done") {
        removeListener(task, listener);
        if (!closed) raw.end();
      }
    };
    addListener(task, listener);
  });

  app.post("/wechat/generate/cancel", async (req, reply) => {
    const body = (req.body ?? {}) as { taskId?: string };
    const { taskId } = body;
    if (!taskId) {
      reply.status(400);
      return { error: "BadRequest", message: "missing taskId" };
    }
    const ok = require("../services/wechat/tasks").cancelTask(taskId);
    if (!ok) {
      reply.status(404);
      return { error: "NotFound", message: "task not found" };
    }
    return { ok: true };
  });
}
