import createHttpError from "http-errors";
import { HttpAiProvider } from "./providers/http";
import { MockAiProvider } from "./providers/mock";
import { PicsumAiProvider } from "./providers/picsum";
import { HfAiProvider } from "./providers/hf";
import { DoubaoAiProvider } from "./providers/doubao";

import { loadPromptConfig } from "../wechat/promptConfig";

export function getAiProvider(overrideKind?: string) {
  const config = loadPromptConfig();
  const kind = overrideKind ?? config.ai?.defaultProvider ?? "mock";
  if (kind === "mock") return new MockAiProvider();
  if (kind === "http") {
    const endpoint = config.ai?.providers?.http?.endpoint;
    if (!endpoint) throw createHttpError(500, "endpoint is required in prompt-config.json for ai.providers.http");
    return new HttpAiProvider(endpoint, config.ai?.providers?.http?.apiKey);
  }
  if (kind === "picsum") {
    const base = config.ai?.providers?.picsum?.baseUrl || "https://picsum.photos";
    return new PicsumAiProvider(base);
  }
  if (kind === "doubao") {
    const baseUrl = config.ai?.providers?.doubao?.baseUrl || "https://ark.cn-beijing.volces.com/api/v3";
    const apiKey = config.ai?.providers?.doubao?.apiKey;
    const model = config.ai?.providers?.doubao?.model || "doubao-seedream-5-0-260128";
    if (!apiKey) throw createHttpError(500, "apiKey is required in prompt-config.json for ai.providers.doubao");
    return new DoubaoAiProvider(baseUrl, apiKey, model);
  }
  if (kind === "hf") {
    const endpoint = config.ai?.providers?.hf?.endpoint;
    const apiKey = config.ai?.providers?.hf?.apiKey;
    if (!endpoint) throw createHttpError(500, "endpoint is required in prompt-config.json for ai.providers.hf");
    if (!apiKey) throw createHttpError(500, "apiKey is required in prompt-config.json for ai.providers.hf");
    if (endpoint.includes("api-inference.huggingface.co")) {
      throw createHttpError(
        500,
        "Hugging Face deprecated api-inference host. Use https://router.huggingface.co/hf-inference/models/<org>/<model> as AI_HTTP_ENDPOINT."
      );
    }
    if (!endpoint.includes("router.huggingface.co/hf-inference/models/")) {
      throw createHttpError(
        500,
        "Hugging Face endpoint must include model path. Set AI_HTTP_ENDPOINT to e.g. https://router.huggingface.co/hf-inference/models/stabilityai/stable-diffusion-xl-base-1.0"
      );
    }
    return new HfAiProvider(endpoint, apiKey);
  }
  throw createHttpError(500, `unknown AI_PROVIDER: ${kind}`);
}
