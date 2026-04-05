import type { FastifyInstance } from "fastify";
import { loadPromptConfig } from "../services/wechat/promptConfig";

export async function registerConfigRoutes(app: FastifyInstance) {
  app.get("/config", async (req, reply) => {
    const promptConfig = loadPromptConfig();
    const configuredProviders = Object.keys(promptConfig.ai?.providers || {});
    const availableProviders = [
      { id: "mock", name: "本地模拟 (Mock - 无需配置 Key)" },
      ...configuredProviders.map((id) => {
        let name = id;
        if (id === "doubao") name = "豆包大模型 (Ark)";
        else if (id === "hf") name = "HuggingFace Inference";
        else if (id === "http") name = "通用 HTTP 服务";
        return { id, name };
      })
    ];

    return {
      wechat: {
        styles: promptConfig.global.styles,
        minStickerCount: 8,
        maxStickerCount: 24,
        defaultStickerCount: 8,
        defaultProvider: promptConfig.ai?.defaultProvider || "mock",
        availableProviders
      }
    };
  });
}