import { type FastifyInstance } from "fastify";
import { z } from "zod";
import { generateWeChatAssetsAndPack, getWeChatPromptTemplate } from "../services/wechat/aiFlow";

const promptSchema = z.object({
  referenceAssetId: z.string().min(1)
});

const generateSchema = z.object({
  referenceAssetId: z.string().min(1),
  prompt: z.string().min(1),
  styles: z.array(z.string().min(1)).optional(),
  stickerCount: z.number().int().min(8).max(24).optional(),
  includeCover: z.boolean().optional(),
  includeIcon: z.boolean().optional(),
  includeBanner: z.boolean().optional(),
  metadata: z
    .object({
      title: z.string().min(1).optional(),
      author: z.string().min(1).optional(),
      copyright: z.string().min(1).optional()
    })
    .optional()
});

export async function registerWeChatAiRoutes(app: FastifyInstance) {
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
    return generateWeChatAssetsAndPack(app, parsed.data);
  });
}

