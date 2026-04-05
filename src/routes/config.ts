import type { FastifyInstance } from "fastify";
import { loadPromptConfig } from "../services/wechat/promptConfig";

export async function registerConfigRoutes(app: FastifyInstance) {
  app.get("/config", async (req, reply) => {
    const promptConfig = loadPromptConfig();
    const isProd = process.env.NODE_ENV === "production";
    
    const availableProviders: { id: string; name: string }[] = [];

    const providers = promptConfig.ai?.providers || {};
    for (const [id, config] of Object.entries(providers)) {
      if ((id === "mock" || id === "picsum") && isProd) continue;
      
      let name = config.name || id;
      let isValid = true;
      
      if (id === "doubao") {
        if (!config.name) name = "豆包大模型 (Ark)";
        isValid = !!config.apiKey;
      } else if (id === "hf") {
        if (!config.name) name = "HuggingFace Inference";
        isValid = !!config.endpoint && !!config.apiKey;
      } else if (id === "http") {
        if (!config.name) name = "通用 HTTP 服务";
        isValid = !!config.endpoint;
      }

      if (isValid) {
        availableProviders.push({ id, name });
      }
    }

    let defaultProvider = promptConfig.ai?.defaultProvider || "mock";
    if (!availableProviders.find((p) => p.id === defaultProvider)) {
      defaultProvider = availableProviders.length > 0 ? availableProviders[0].id : "mock";
    }

    return {
      wechat: {
        styles: promptConfig.global.styles,
        minStickerCount: 8,
        maxStickerCount: 24,
        defaultStickerCount: 8,
        defaultProvider,
        availableProviders
      }
    };
  });
}