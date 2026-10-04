import type {
  PromptRequest,
  GenerateRequest,
  CancelRequest
} from "../../../src/shared/contracts";
import { request } from "./client";

export function suggestPrompt(input: PromptRequest) {
  return request<{ referenceAssetId: string; prompt: string; negativePrompt: string; styles: string[] }>(
    "/api/generate/prompt",
    { method: "POST", body: JSON.stringify(input) }
  );
}

export function startGeneration(input: GenerateRequest) {
  return request<{ taskId: string }>("/api/generate/start", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function cancelGeneration(input: CancelRequest) {
  return request<{ ok: boolean }>("/api/generate/cancel", {
    method: "POST",
    body: JSON.stringify(input)
  });
}
