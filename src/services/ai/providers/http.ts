import createHttpError from "http-errors";
import { fetch, FormData } from "undici";
import { type AiGenerateInput, type AiGenerateOutput, type AiProvider } from "../provider";

export class HttpAiProvider implements AiProvider {
  constructor(
    private readonly endpoint: string,
    private readonly apiKey?: string
  ) {}

  async generateImage(input: AiGenerateInput, signal?: AbortSignal): Promise<AiGenerateOutput> {
    const transport = input.referenceImageTransport ?? "base64";
    const payload: Record<string, unknown> = {
      prompt: input.prompt,
      negativePrompt: input.negativePrompt,
      style: input.style,
      width: input.width,
      height: input.height,
      providerOptions: input.providerOptions
    };

    if (input.referenceImageBase64) {
      payload.referenceImageBase64 = input.referenceImageBase64;
      payload.referenceImageMime = input.referenceImageMime ?? "image/png";
    }
    if (input.referenceImageUrl) {
      payload.referenceImageUrl = input.referenceImageUrl;
    }
    if (input.referenceImageAssetId) {
      payload.referenceImageAssetId = input.referenceImageAssetId;
    }

    let res;
    if (transport === "multipart" && input.referenceImageBase64) {
      const form = new FormData();
      form.set("prompt", input.prompt);
      form.set("width", String(input.width));
      form.set("height", String(input.height));
      if (input.negativePrompt) form.set("negativePrompt", input.negativePrompt);
      if (input.style) form.set("style", input.style);
      const mime = input.referenceImageMime ?? "image/png";
      const blob = new Blob([Buffer.from(input.referenceImageBase64, "base64")], { type: mime });
      const ext = mime.split("/")[1] ?? "png";
      form.set("referenceImage", blob, `reference.${ext}`);
      res = await fetch(this.endpoint, {
        method: "POST",
        headers: {
          ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {})
        },
        body: form,
        signal
      });
    } else {
      res = await fetch(this.endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {})
        },
        body: JSON.stringify(payload),
        signal
      });
    }

    if (!res.ok) throw createHttpError(502, `ai provider error: ${res.status}`);

    const ct = res.headers.get("content-type") ?? "";
    if (ct.includes("application/json")) {
      const json = (await res.json()) as any;
      const b64 = json?.imageBase64;
      const mime = json?.mime ?? "image/png";
      if (typeof b64 !== "string") throw createHttpError(502, "ai provider invalid response");
      return { mime, bytes: Buffer.from(b64, "base64") };
    }

    const bytes = Buffer.from(await res.arrayBuffer());
    return { mime: ct || "application/octet-stream", bytes };
  }
}
