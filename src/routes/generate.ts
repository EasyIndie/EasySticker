import { type FastifyInstance } from "fastify";
import { z } from "zod";
import { generateAnimated } from "../services/generate/animated";
import { generateStatic } from "../services/generate/static";

const staticSchema = z.object({
  assetId: z.string().min(1),
  sizes: z.array(z.number().int().min(16).max(2048)).min(1),
  format: z.enum(["png", "webp"]).optional(),
  effect: z.enum(["none", "shadow", "glow"]).optional(),
  text: z
    .object({
      content: z.string().min(1),
      fontSize: z.number().int().min(8).max(512).optional(),
      color: z.string().min(1).optional(),
      strokeColor: z.string().min(1).optional(),
      strokeWidth: z.number().int().min(0).max(64).optional()
    })
    .optional()
});

const animatedSchema = z.object({
  frameAssetIds: z.array(z.string().min(1)).min(2),
  size: z.number().int().min(16).max(1024),
  delayMs: z.number().int().min(10).max(10_000),
  format: z.enum(["gif", "webp", "apng"])
});

export async function registerGenerateRoutes(app: FastifyInstance) {
  app.post("/generate/static", async (req, reply) => {
    const parsed = staticSchema.safeParse(req.body);
    if (!parsed.success) {
      reply.status(400);
      return { error: "BadRequest", message: "invalid request body", issues: parsed.error.issues };
    }
    const results = await generateStatic(app, parsed.data);
    return { results };
  });

  app.post("/generate/animated", async (req, reply) => {
    const parsed = animatedSchema.safeParse(req.body);
    if (!parsed.success) {
      reply.status(400);
      return { error: "BadRequest", message: "invalid request body", issues: parsed.error.issues };
    }
    const result = await generateAnimated(app, parsed.data);
    return result;
  });
}

