import createHttpError from "http-errors";
import { HttpAiProvider } from "./providers/http";
import { MockAiProvider } from "./providers/mock";

export function getAiProvider() {
  const kind = process.env.AI_PROVIDER ?? "mock";
  if (kind === "mock") return new MockAiProvider();
  if (kind === "http") {
    const endpoint = process.env.AI_HTTP_ENDPOINT;
    if (!endpoint) throw createHttpError(500, "AI_HTTP_ENDPOINT is required for AI_PROVIDER=http");
    return new HttpAiProvider(endpoint, process.env.AI_HTTP_API_KEY);
  }
  throw createHttpError(500, `unknown AI_PROVIDER: ${kind}`);
}

