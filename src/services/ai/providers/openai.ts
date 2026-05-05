import createHttpError from "http-errors";
import { fetch, FormData } from "undici";
import { type AiGenerateInput, type AiGenerateOutput, type AiProvider } from "../provider";

type OpenAiImageOptions = {
  background?: "transparent" | "opaque" | "auto";
  quality?: "low" | "medium" | "high" | "auto";
  outputFormat?: "png" | "jpeg" | "webp";
  moderation?: "low" | "auto";
  inputFidelity?: "low" | "high";
};

export class OpenAiImageProvider implements AiProvider {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
    private readonly model: string,
    private readonly options: OpenAiImageOptions = {}
  ) {}

  async generateImage(input: AiGenerateInput, signal?: AbortSignal): Promise<AiGenerateOutput> {
    const hasReference = Boolean(input.referenceImageBase64 || input.referenceImageUrl);
    const endpoint = `${this.baseUrl.replace(/\/+$/, "")}/images/${hasReference ? "edits" : "generations"}`;
    const prompt = this.buildPrompt(input);

    const res = hasReference
      ? await this.createEdit(endpoint, input, prompt, signal)
      : await this.createGeneration(endpoint, input, prompt, signal);

    if (!res.ok) {
      const message = await this.readErrorMessage(res, "openai provider error");
      console.error("[OpenAiImageProvider] Request failed:", res.status, message);
      throw createHttpError(this.toHttpErrorStatus(res.status), message);
    }

    const json = (await res.json()) as any;
    const first = json?.data?.[0];
    const b64 = first?.b64_json;
    if (typeof b64 === "string" && b64.length > 0) {
      return { mime: this.mimeFromOutputFormat(), bytes: Buffer.from(b64, "base64") };
    }

    if (typeof first?.url === "string" && first.url.length > 0) {
      const imageRes = await fetch(first.url, { signal });
      if (!imageRes.ok) throw createHttpError(502, `openai image download failed: ${imageRes.status}`);
      return {
        mime: imageRes.headers.get("content-type") || this.mimeFromOutputFormat(),
        bytes: Buffer.from(await imageRes.arrayBuffer())
      };
    }

    console.error("[OpenAiImageProvider] Unexpected response:", JSON.stringify(json).slice(0, 300));
    throw createHttpError(502, "openai provider returned no image data");
  }

  private async createGeneration(endpoint: string, input: AiGenerateInput, prompt: string, signal?: AbortSignal) {
    const body: Record<string, unknown> = {
      model: this.model,
      prompt,
      n: 1,
      size: this.toOpenAiSize(input.width, input.height)
    };
    this.addCommonImageOptions(body);

    if (this.model.startsWith("dall-e-")) {
      body.response_format = "b64_json";
    }

    return fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.apiKey}`
      },
      body: JSON.stringify(body),
      signal
    });
  }

  private async createEdit(endpoint: string, input: AiGenerateInput, prompt: string, signal?: AbortSignal) {
    if (input.referenceImageUrl && !input.referenceImageBase64) {
      const body: Record<string, unknown> = {
        model: this.model,
        prompt,
        images: [{ image_url: input.referenceImageUrl }],
        n: 1,
        size: this.toOpenAiSize(input.width, input.height)
      };
      this.addCommonImageOptions(body);
      this.addEditOptions(body);

      return fetch(endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.apiKey}`
        },
        body: JSON.stringify(body),
        signal
      });
    }

    const mime = input.referenceImageMime || "image/png";
    const ext = this.extensionFromMime(mime);
    const form = new FormData();
    form.set("model", this.model);
    form.set("prompt", prompt);
    form.set("n", "1");
    form.set("size", this.toOpenAiSize(input.width, input.height));
    this.addCommonImageOptions(form);
    this.addEditOptions(form);
    form.set("image", new Blob([Buffer.from(input.referenceImageBase64 || "", "base64")], { type: mime }), `reference.${ext}`);

    return fetch(endpoint, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.apiKey}`
      },
      body: form,
      signal
    });
  }

  private buildPrompt(input: AiGenerateInput) {
    const parts = [input.prompt];
    if (input.negativePrompt) {
      parts.push(`Avoid: ${input.negativePrompt}`);
    }
    return parts.join("\n");
  }

  private addCommonImageOptions(target: Record<string, unknown> | FormData) {
    const outputFormat = this.options.outputFormat || "png";
    this.set(target, "output_format", outputFormat);
    this.set(target, "background", this.options.background || "transparent");
    this.set(target, "quality", this.options.quality || "auto");
    if (this.options.moderation) this.set(target, "moderation", this.options.moderation);
  }

  private addEditOptions(target: Record<string, unknown> | FormData) {
    if (this.options.inputFidelity) this.set(target, "input_fidelity", this.options.inputFidelity);
  }

  private set(target: Record<string, unknown> | FormData, key: string, value: string) {
    if (target instanceof FormData) {
      target.set(key, value);
    } else {
      target[key] = value;
    }
  }

  private toOpenAiSize(width: number, height: number) {
    if (width > height) return "1536x1024";
    if (height > width) return "1024x1536";
    return "1024x1024";
  }

  private mimeFromOutputFormat() {
    return `image/${this.options.outputFormat || "png"}`;
  }

  private extensionFromMime(mime: string) {
    if (mime.includes("jpeg")) return "jpg";
    if (mime.includes("webp")) return "webp";
    return "png";
  }

  private async readErrorMessage(res: Response, fallback: string) {
    try {
      const ct = res.headers.get("content-type") ?? "";
      if (ct.includes("application/json")) {
        const json = (await res.json()) as any;
        return json?.error?.message || json?.message || `${fallback}: ${res.status}`;
      }
      const text = await res.text();
      return text || `${fallback}: ${res.status}`;
    } catch {
      return `${fallback}: ${res.status}`;
    }
  }

  private toHttpErrorStatus(status: number) {
    if (status === 401 || status === 403 || status === 429) return status;
    if (status >= 400 && status < 500) return 400;
    return 502;
  }
}
