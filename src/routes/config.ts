import type { FastifyInstance } from "fastify";
import { loadPromptConfig } from "../services/wechat/promptConfig";

export async function registerConfigRoutes(app: FastifyInstance) {
  app.get("/config", async (req, reply) => {
    const promptConfig = loadPromptConfig();
    return {
      wechat: {
        styles: promptConfig.global.styles,
        minStickerCount: 8,
        maxStickerCount: 24,
        defaultStickerCount: 8
      }
    };
  });
}