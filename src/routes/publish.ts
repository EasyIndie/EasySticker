import { type FastifyInstance } from "fastify";
import { z } from "zod";
import createHttpError from "http-errors";
import { getJob } from "../services/publish/jobStore";
import { assertTelegramRequest, startTelegramPublish } from "../services/publish/service";

const telegramSchema = z.object({
  token: z.string().min(1).optional(),
  userId: z.number().int().positive(),
  setName: z.string().min(1),
  setTitle: z.string().min(1),
  assetIds: z.array(z.string().min(1)).min(1),
  emojis: z.string().min(1).optional()
});

export async function registerPublishRoutes(app: FastifyInstance) {
  app.post("/publish/telegram", async (req) => {
    const parsed = telegramSchema.safeParse(req.body);
    if (!parsed.success) {
      throw createHttpError(400, "invalid request body");
    }

    const tokenFromHeader = req.headers["x-telegram-bot-token"];
    const token =
      typeof tokenFromHeader === "string" && tokenFromHeader.length > 0 ? tokenFromHeader : parsed.data.token;

    const job = startTelegramPublish(app, assertTelegramRequest({ ...parsed.data, token }));
    return { jobId: job.jobId, statusUrl: `/api/publish/${job.jobId}` };
  });

  app.get<{
    Params: { jobId: string };
  }>("/publish/:jobId", async (req) => {
    const job = getJob(req.params.jobId);
    if (!job) throw createHttpError(404, "publish job not found");
    return job;
  });
}

