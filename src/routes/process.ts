import { type FastifyInstance } from "fastify";
import { z } from "zod";
import { processUploadToPng } from "../services/image/service";

const bodySchema = z
  .object({
    threshold: z.number().int().min(0).max(255).optional(),
    softness: z.number().int().min(0).max(255).optional()
  })
  .optional();

export async function registerProcessRoutes(app: FastifyInstance) {
  app.post<{
    Params: { uploadId: string };
  }>("/process/:uploadId", async (req, reply) => {
    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) {
      req.log.warn({ issues: parsed.error.issues }, "invalid body");
      reply.status(400);
      return {
        error: "BadRequest",
        message: "invalid request body",
        issues: parsed.error.issues
      };
    }

    const { assetId, result } = await processUploadToPng(app, req.params.uploadId, parsed.data ?? {});
    return {
      uploadId: req.params.uploadId,
      assetId,
      width: result.width,
      height: result.height,
      url: `/api/assets/${assetId}`
    };
  });
}
