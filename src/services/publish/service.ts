import type { FastifyInstance } from "fastify";
import createHttpError from "http-errors";
import { createJob, setJobStatus, updateJob } from "./jobStore";
import { publishToTelegram } from "./providers/telegram";
import type { PublishJob, TelegramPublishRequest } from "./types";

export function startTelegramPublish(app: FastifyInstance, req: TelegramPublishRequest): PublishJob {
  const job = createJob("telegram");

  setImmediate(async () => {
    try {
      setJobStatus(job.jobId, "running");
      const result = await publishToTelegram(app, req);
      updateJob(job.jobId, { status: "succeeded", result });
    } catch (e: any) {
      updateJob(job.jobId, { status: "failed", error: e?.message ?? "unknown error" });
    }
  });

  return job;
}

export function assertTelegramRequest(req: Partial<TelegramPublishRequest>): TelegramPublishRequest {
  if (!req.token) throw createHttpError(400, "missing telegram token");
  if (!req.userId) throw createHttpError(400, "missing userId");
  if (!req.setName) throw createHttpError(400, "missing setName");
  if (!req.setTitle) throw createHttpError(400, "missing setTitle");
  if (!req.assetIds?.length) throw createHttpError(400, "missing assetIds");
  return req as TelegramPublishRequest;
}

