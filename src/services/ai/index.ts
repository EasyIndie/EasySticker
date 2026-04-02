import createHttpError from "http-errors";
import { HttpAiProvider } from "./providers/http";
import { MockAiProvider } from "./providers/mock";
import { PicsumAiProvider } from "./providers/picsum";
import { HfAiProvider } from "./providers/hf";
import { DoubaoAiProvider } from "./providers/doubao";

export function getAiProvider() {
  const kind = process.env.AI_PROVIDER ?? "mock";
  if (kind === "mock") return new MockAiProvider();
  if (kind === "http") {
    const endpoint = process.env.AI_HTTP_ENDPOINT;
    if (!endpoint) throw createHttpError(500, "AI_HTTP_ENDPOINT is required for AI_PROVIDER=http");
    return new HttpAiProvider(endpoint, process.env.AI_HTTP_API_KEY);
  }
  if (kind === "picsum") {
    const base = process.env.PICSUM_BASE_URL || "https://picsum.photos";
    return new PicsumAiProvider(base);
  }
  if (kind === "doubao") {
    const baseUrl = process.env.ARK_BASE_URL || "https://ark.cn-beijing.volces.com/api/v3";
    const apiKey = process.env.ARK_API_KEY;
    const model = process.env.ARK_MODEL || "doubao-seedream-5-0-260128";
    if (!apiKey) throw createHttpError(500, "ARK_API_KEY is required for AI_PROVIDER=doubao");
    return new DoubaoAiProvider(baseUrl, apiKey, model);
  }
  if (kind === "hf") {
    const endpoint = process.env.AI_HTTP_ENDPOINT;
    const apiKey = process.env.AI_HTTP_API_KEY;
    if (!endpoint) throw createHttpError(500, "AI_HTTP_ENDPOINT is required for AI_PROVIDER=hf");
    if (!apiKey) throw createHttpError(500, "AI_HTTP_API_KEY is required for AI_PROVIDER=hf");
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
