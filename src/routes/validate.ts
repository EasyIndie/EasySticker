import { type FastifyInstance } from "fastify";
import { z } from "zod";
import { PLATFORM_PRESETS } from "../services/platform/presets";
import { validateAsset } from "../services/platform/validate";

const schema = z.object({
  presetId: z.string().min(1),
  assetId: z.string().min(1)
});

export async function registerValidateRoutes(app: FastifyInstance) {
  app.get("/presets", async () => {
    return { presets: PLATFORM_PRESETS };
  });

  app.post("/validate", async (req, reply) => {
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      reply.status(400);
      return { error: "BadRequest", message: "invalid request body", issues: parsed.error.issues };
    }
    return validateAsset(app, parsed.data.presetId, parsed.data.assetId);
  });
}

