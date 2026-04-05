import type { FastifyInstance } from "fastify";
import { loadPromptConfig } from "../services/wechat/promptConfig";

export async function registerConfigRoutes(app: FastifyInstance) {
  app.get("/config", async (req, reply) => {
    const promptConfig = loadPromptConfig();
    const isProd = process.env.NODE_ENV === "production";
    
    const availableProviders: { id: string; name: string }[] = [];

    const providers = promptConfig.ai?.providers || {};
    for (const [id, config] of Object.entries(providers)) {
      const type = config.type || id;
      if ((type === "mock" || type === "picsum") && isProd) continue;
      
      let name = config.name || id;
      let isValid = true;
      
      if (type === "doubao") {
        if (!config.name) name = "豆包大模型 (Ark)";
        isValid = typeof config.apiKey === "string" && config.apiKey.length > 0;
      } else if (type === "hf") {
        if (!config.name) name = "HuggingFace Inference";
        isValid = !!config.endpoint && typeof config.apiKey === "string" && config.apiKey.length > 0;
      } else if (type === "http") {
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
    
    // 如果在生产环境下，所有提供商都没有配置好导致列表为空，
    // 强行插入一个 mock 兜底，避免前端下拉框完全空白无法交互
    if (availableProviders.length === 0) {
      availableProviders.push({ id: "mock", name: "本地模拟 (生产环境未配置真实模型)" });
      defaultProvider = "mock";
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