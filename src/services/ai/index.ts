import createHttpError from "http-errors";
import { HttpAiProvider } from "./providers/http";
import { MockAiProvider } from "./providers/mock";
import { PicsumAiProvider } from "./providers/picsum";
import { HfAiProvider } from "./providers/hf";
import { DoubaoAiProvider } from "./providers/doubao";

import { loadPromptConfig } from "../wechat/promptConfig";

export function getAiProvider(overrideKind?: string) {
  const config = loadPromptConfig();
  const providerId = overrideKind ?? config.ai?.defaultProvider ?? "mock";
  const providerConfig = config.ai?.providers?.[providerId];
  
  if (!providerConfig) {
    if (providerId === "mock") return new MockAiProvider();
    throw createHttpError(500, `Provider config not found for ID: ${providerId}`);
  }

  const type = providerConfig.type;

  if (type === "mock") return new MockAiProvider();
  
  if (type === "http") {
    const endpoint = providerConfig.endpoint;
    if (!endpoint) throw createHttpError(500, `endpoint is required in prompt-config.json for provider: ${providerId}`);
    return new HttpAiProvider(endpoint, providerConfig.apiKey);
  }
  
  if (type === "picsum") {
    const base = providerConfig.baseUrl || "https://picsum.photos";
    return new PicsumAiProvider(base);
  }
  
  if (type === "doubao") {
    const baseUrl = providerConfig.baseUrl || "https://ark.cn-beijing.volces.com/api/v3";
    const apiKey = providerConfig.apiKey;
    const model = providerConfig.model || "doubao-seedream-5-0-260128";
    if (!apiKey || typeof apiKey !== "string" || apiKey.length === 0) {
      throw createHttpError(500, `apiKey is required and cannot be empty in prompt-config.json for provider: ${providerId}`);
    }
    return new DoubaoAiProvider(baseUrl, apiKey, model);
  }
  
  if (type === "hf") {
    const endpoint = providerConfig.endpoint;
    const apiKey = providerConfig.apiKey;
    if (!endpoint) throw createHttpError(500, `endpoint is required in prompt-config.json for provider: ${providerId}`);
    if (!apiKey || typeof apiKey !== "string" || apiKey.length === 0) {
      throw createHttpError(500, `apiKey is required and cannot be empty in prompt-config.json for provider: ${providerId}`);
    }
    if (endpoint.includes("api-inference.huggingface.co")) {
      throw createHttpError(
        500,
        "Hugging Face deprecated api-inference host. Use https://router.huggingface.co/hf-inference/models/<org>/<model> as endpoint."
      );
    }
    if (!endpoint.includes("router.huggingface.co/hf-inference/models/")) {
      throw createHttpError(
        500,
        "Hugging Face endpoint must include model path. Set endpoint to e.g. https://router.huggingface.co/hf-inference/models/stabilityai/stable-diffusion-xl-base-1.0"
      );
    }
    return new HfAiProvider(endpoint, apiKey);
  }
  
  throw createHttpError(500, `unknown AI provider type: ${type}`);
}
