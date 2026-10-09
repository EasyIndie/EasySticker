import createHttpError from "http-errors";
import { fetch, FormData } from "undici";
import { type AiGenerateInput, type AiGenerateOutput, type AiProvider } from "../provider";
import { registerProvider } from "../registry";
import { providerApiKeyEnvName, resolveProviderApiKey } from "../apiKey";

type OpenAiImageOptions = {
  background?: "transparent" | "opaque" | "auto";
  quality?: "low" | "medium" | "high" | "auto";
  outputFormat?: "png" | "jpeg" | "webp";
  moderation?: "low" | "auto";
  inputFidelity?: "low" | "high";
  /** "gpt-image" 为 OpenAI gpt-image-1.x；"generic" 为通用 OpenAI 兼容生图接口（豆包 Seedream、硅基流动 FLUX 等） */
  variant?: "gpt-image" | "generic";
  /** generic 变体输出尺寸覆盖；不设则取输入图尺寸（即 ai.imageSize） */
  size?: string;
};

export class OpenAiImageProvider implements AiProvider {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
    private readonly model: string,
    private readonly options: OpenAiImageOptions = {}
  ) {}

  async generateImage(input: AiGenerateInput, signal?: AbortSignal): Promise<AiGenerateOutput> {
    const prompt = this.buildPrompt(input);
    const res = this.options.variant === "generic"
      ? await this.createGenericGeneration(input, prompt, signal)
      : await this.createGptImage(input, prompt, signal);

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

  private createGptImage(input: AiGenerateInput, prompt: string, signal?: AbortSignal) {
    const hasReference = Boolean(input.referenceImageBase64 || input.referenceImageUrl);
    const endpoint = `${this.baseUrl.replace(/\/+$/, "")}/images/${hasReference ? "edits" : "generations"}`;
    return hasReference
      ? this.createEdit(endpoint, input, prompt, signal)
      : this.createGeneration(endpoint, input, prompt, signal);
  }

  private async createGenericGeneration(input: AiGenerateInput, prompt: string, signal?: AbortSignal) {
    const endpoint = `${this.baseUrl.replace(/\/+$/, "")}/images/generations`;
    const body: Record<string, unknown> = {
      model: this.model,
      prompt,
      n: 1,
      size: this.options.size || `${input.width}x${input.height}`,
      response_format: "b64_json",
      watermark: false
    };

    // 通用 OpenAI 兼容接口（豆包 Seedream / 硅基流动等）的图生图：
    // 参考图通过 image 字段以 data URI 或 URL 传入，而不是 /images/edits。
    // 多张参考图时该字段传数组（Ark 的 image 支持 string | string[]）；
    // 只有一张时仍传字符串，保持既有行为不变。
    const references = this.collectReferenceImages(input);
    if (references.length === 1) body.image = references[0];
    else if (references.length > 1) body.image = references;

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

  /**
   * 汇总参考图（主图在前，附加图在后），统一转成 data URI 或 URL。
   * 顺序就是模型看到的顺序，所以调用方要保证「待修改的图」在前。
   */
  private collectReferenceImages(input: AiGenerateInput): string[] {
    const out: string[] = [];
    if (input.referenceImageUrl) out.push(input.referenceImageUrl);
    else if (input.referenceImageBase64) {
      out.push(`data:${input.referenceImageMime || "image/png"};base64,${input.referenceImageBase64}`);
    }
    for (const extra of input.additionalReferenceImages ?? []) {
      if (extra.url) out.push(extra.url);
      else if (extra.base64) out.push(`data:${extra.mime || "image/png"};base64,${extra.base64}`);
    }
    return out;
  }

  private async createEdit(endpoint: string, input: AiGenerateInput, prompt: string, signal?: AbortSignal) {
    const extras = input.additionalReferenceImages ?? [];
    if (input.referenceImageUrl && !input.referenceImageBase64) {
      const body: Record<string, unknown> = {
        model: this.model,
        prompt,
        images: [
          { image_url: input.referenceImageUrl },
          ...extras
            .map((extra) =>
              extra.url ? { image_url: extra.url } : extra.base64 ? { image_url: `data:${extra.mime || "image/png"};base64,${extra.base64}` } : null
            )
            .filter((item): item is { image_url: string } => item !== null)
        ],
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
    // 附加参考图：OpenAI 风格的数组字段是 `image[]`
    extras.forEach((extra, index) => {
      const extraMime = extra.mime || "image/png";
      const bytes = extra.base64 ? Buffer.from(extra.base64, "base64") : null;
      if (!bytes) return;
      form.append("image[]", new Blob([bytes], { type: extraMime }), `reference-${index + 2}.${this.extensionFromMime(extraMime)}`);
    });

    return fetch(endpoint, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.apiKey}`
      },
      body: form,
      signal
    });
  }

  /**
   * 把内容/画面约束拼成最终提示词，并在末尾追加负面约束段。
   * 多数生图接口没有独立的 negative_prompt 字段，所以统一以 `Avoid:` 段落下发，
   * gpt-image 与 generic（豆包/硅基流动等）都走这里，保证两条链路一致。
   */
  private buildPrompt(input: AiGenerateInput) {
    const parts = [input.prompt.trim()];
    const negative = input.negativePrompt?.trim();
    if (negative) {
      parts.push(`Avoid: ${negative}`);
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

registerProvider("openai", (config, providerId) => {
  const baseUrl = config.baseUrl || "https://api.openai.com/v1";
  const apiKey = resolveProviderApiKey(providerId, config);
  const model = config.model || "gpt-image-1.5";
  if (!apiKey) {
    throw createHttpError(
      500,
      `apiKey is required for provider "${providerId}": set env ${providerApiKeyEnvName(providerId)} (recommended) or ai.providers.${providerId}.apiKey in prompt-config.json`
    );
  }
  return new OpenAiImageProvider(baseUrl, apiKey, model, {
    background: config.background,
    quality: config.quality,
    outputFormat: config.outputFormat,
    moderation: config.moderation,
    inputFidelity: config.inputFidelity,
    variant: config.variant,
    size: config.size
  });
});
