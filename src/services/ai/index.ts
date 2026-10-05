import createHttpError from "http-errors";
import { loadPromptConfig } from "../generate/promptConfig";
import { getProviderFactory } from "./registry";
import { providerApiKeyEnvName, resolveProviderApiKey } from "./apiKey";

// Side-effect imports: each provider file self-registers its factory into the
// registry on module load. Keep this list in sync with the providers/ directory.
import "./providers/mock";
import "./providers/openai";

/**
 * Resolve a provider instance for the given provider id (or the configured
 * default when omitted). Configuration lookup and validation now live inside
 * each provider's factory, keeping this entry point decoupled from provider
 * implementation details.
 */
export function getAiProvider(overrideKind?: string) {
  const config = loadPromptConfig();
  const providerId = overrideKind ?? config.ai?.defaultProvider ?? "mock";
  const providerConfig = config.ai?.providers?.[providerId];

  if (!providerConfig) {
    // "mock" is special-cased so it works without any config entry.
    if (providerId === "mock") {
      return getProviderFactory("mock")({}, providerId);
    }
    throw createHttpError(500, `Provider config not found for ID: ${providerId}`);
  }

  const factory = getProviderFactory(providerConfig.type);
  return factory(providerConfig, providerId);
}

export type AiProviderSummary = {
  id: string;
  type: string;
  model?: string;
  ready: boolean;
  reason?: string;
};

/** 汇总默认 provider 的可用状态（不抛错），用于启动日志与前台提示。 */
export function getDefaultProviderSummary(): AiProviderSummary {
  const config = loadPromptConfig();
  const id = config.ai?.defaultProvider ?? "mock";
  const providerConfig = config.ai?.providers?.[id];
  const type = providerConfig?.type ?? (id === "mock" ? "mock" : "unknown");

  if (id === "mock" || type === "mock") {
    return { id, type: "mock", ready: true, reason: "本地模拟（未配置真实模型）" };
  }
  if (!providerConfig) {
    return { id, type, ready: false, reason: `provider "${id}" 未在 ai.providers 中定义` };
  }
  const apiKey = resolveProviderApiKey(id, providerConfig);
  if (!apiKey) {
    return {
      id,
      type,
      model: providerConfig.model,
      ready: false,
      reason: `缺少 API Key（设置 ${providerApiKeyEnvName(id)} 或 ai.providers.${id}.apiKey）`
    };
  }
  return { id, type, model: providerConfig.model, ready: true };
}
