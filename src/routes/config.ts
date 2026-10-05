import type { FastifyInstance } from "fastify";
import { loadPromptConfig } from "../services/generate/promptConfig";
import { resolveProviderApiKey } from "../services/ai/apiKey";
import { PLATFORM_PRESETS } from "../services/platform/presets";

export async function registerConfigRoutes(app: FastifyInstance) {
  app.get("/config", async (req, reply) => {
    const promptConfig = loadPromptConfig();
    const isProd = process.env.NODE_ENV === "production";
    
    const availableProviders: { id: string; name: string }[] = [];

    const providers = promptConfig.ai?.providers || {};
    for (const [id, config] of Object.entries(providers)) {
      const type = config.type || id;
      if (type === "mock" && isProd) continue;

      let name = config.name || id;
      let isValid = true;

      if (type === "openai") {
        if (!config.name) name = "OpenAI 兼容图片生成";
        isValid = Boolean(resolveProviderApiKey(id, config));
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

    // Build platforms map for new frontend (supports wechat/telegram/whatsapp)
    const platforms: Record<string, unknown> = {};
    for (const preset of PLATFORM_PRESETS) {
      // Skip sub-presets like wechat_banner, wechat_cover, etc.
      if (preset.id.startsWith("wechat_") && preset.id !== "wechat_stickers") continue;

      const base = {
        title: preset.title,
        description: preset.description || "",
        minCount: preset.minCount,
        maxCount: preset.maxCount,
        defaultCount: 8,
        outputFormat: preset.outputFormat || "png",
        ai: { defaultProvider, availableProviders }
      };

      if (preset.id === "wechat_stickers") {
        platforms[preset.id] = {
          ...base,
          minCount: 8,
          maxCount: 24,
          supportsExtraAssets: true,
          supportsReward: true,
          supportsMetadata: true,
          extraAssetTypes: ["cover", "icon", "banner", "rewardGuide", "rewardThanks"],
          preset: {
            allowedExts: preset.allowedExts,
            maxBytes: preset.maxBytes,
            exactWidth: preset.exactWidth,
            exactHeight: preset.exactHeight
          }
        };
      } else if (preset.id === "telegram_static") {
        platforms[preset.id] = {
          ...base,
          supportsExtraAssets: false,
          supportsReward: false,
          supportsMetadata: false,
          extraAssetTypes: [],
          preset: {
            allowedExts: preset.allowedExts,
            maxBytes: preset.maxBytes,
            maxWidth: preset.maxWidth,
            maxHeight: preset.maxHeight,
            requiredSquare: preset.requiredSquare
          }
        };
      } else if (preset.id === "whatsapp_webp") {
        platforms[preset.id] = {
          ...base,
          supportsExtraAssets: false,
          supportsReward: false,
          supportsMetadata: false,
          extraAssetTypes: [],
          preset: {
            allowedExts: preset.allowedExts,
            maxBytes: preset.maxBytes,
            exactWidth: preset.exactWidth,
            exactHeight: preset.exactHeight
          }
        };
      }
    }

    return {
      env: isProd ? "production" : "development",
      // Old format for backward compat (tests reference data.wechat.*)
      wechat: {
        styles: promptConfig.global.styles,
        minStickerCount: 8,
        maxStickerCount: 24,
        defaultStickerCount: 8,
        defaultProvider,
        availableProviders
      },
      // New format for multi-platform frontend
      platforms
    };
  });
}
