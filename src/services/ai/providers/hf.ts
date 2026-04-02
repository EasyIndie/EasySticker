import createHttpError from "http-errors";
import { fetch } from "undici";
import { type AiGenerateInput, type AiGenerateOutput, type AiProvider } from "../provider";

/**
 * Hugging Face Inference API provider (text-to-image) via router.
 * Endpoint format: https://router.huggingface.co/hf-inference/models/<org>/<model>
 * POST with { inputs, parameters, options } and Authorization Bearer token.
 * Returns raw image bytes (content-type: image/*).
 */
export class HfAiProvider implements AiProvider {
  constructor(
    private readonly endpoint: string,
    private readonly apiKey: string
  ) {}

  async generateImage(input: AiGenerateInput): Promise<AiGenerateOutput> {
    const body = {
      inputs: input.prompt,
      parameters: {
        // Many models ignore width/height; keep for those that support it
        width: input.width,
        height: input.height
      },
      options: {
        wait_for_model: true
      }
    };

    const res = await fetch(this.endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.apiKey}`
      },
      body: JSON.stringify(body)
    });

    if (!res.ok) {
      let message = `hf provider error: ${res.status}`;
      try {
        const ct = res.headers.get("content-type") ?? "";
        if (ct.includes("application/json")) {
          const json = (await res.json()) as any;
          message = typeof json?.error === "string" ? json.error : message;
        } else {
          const text = await res.text();
          if (text) {
            message = text;
          }
        }
      } catch {
        // ignore parse errors
      }
      if (res.status === 404) {
        message =
          "Hugging Face router returned 404. Confirm AI_HTTP_ENDPOINT is https://router.huggingface.co/hf-inference/models/<org>/<model>. For initial verification, try stabilityai/stable-diffusion-xl-base-1.0.";
      }
      console.error("[HfAiProvider] Request failed:", res.status, message);
      throw createHttpError(502, message);
    }

    const ct = res.headers.get("content-type") ?? "";
    if (!ct.startsWith("image/")) {
      // Some endpoints return JSON (e.g., gated or loading)
      const json = await res.json().catch(() => ({}));
      throw createHttpError(502, typeof (json as any)?.error === "string" ? (json as any).error : "hf provider invalid response");
    }

    const bytes = Buffer.from(await res.arrayBuffer());
    return { mime: ct || "image/png", bytes };
  }
}
