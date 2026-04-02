import createHttpError from "http-errors";
import { HttpAiProvider } from "./providers/http";
import { MockAiProvider } from "./providers/mock";
import { PicsumAiProvider } from "./providers/picsum";

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
  throw createHttpError(500, `unknown AI_PROVIDER: ${kind}`);
}
