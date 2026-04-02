import createHttpError from "http-errors";
import { fetch } from "undici";
import { type AiGenerateInput, type AiGenerateOutput, type AiProvider } from "../provider";

/**
 * Volcengine Ark (Doubao) Inference API provider
 * Extracted from user's OpenAI SDK Python snippet
 */
export class DoubaoAiProvider implements AiProvider {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
    private readonly model: string
  ) {}

  async generateImage(input: AiGenerateInput): Promise<AiGenerateOutput> {
    const endpoint = `${this.baseUrl.replace(/\/+$/, "")}/images/generations`;
    
    // 构造请求体，参考用户的 Python snippet 提取核心参数
    const body: any = {
      model: this.model,
      prompt: input.prompt,
      size: "2K", // 根据提供的示例固定为 2K，或者也可以基于 input 动态计算
      response_format: "b64_json",
      // 为了跑通最小核心流程，暂时不开启 stream 和 sequential_image_generation 批处理，
      // 以兼容我们现有的单图循环管线
      stream: false
    };

    // Python 示例中使用了 extra_body，其中包含 image, watermark 等。
    // 在直接通过 HTTP 请求 OpenAI 兼容接口时，这些字段通常会被打平放在 root body 中
    if (input.referenceImageUrl) {
      body.image = input.referenceImageUrl;
    } else if (input.referenceImageBase64) {
      // 这里的 image 需要传递一个 base64 字符串（或者 URL）
      // 尝试拼接 Data URI 格式
      const mime = input.referenceImageMime || "image/png";
      body.image = `data:${mime};base64,${input.referenceImageBase64}`;
    }
    
    // 根据示例默认关闭水印以适应表情包生成的场景
    body.watermark = false;

    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.apiKey}`
      },
      body: JSON.stringify(body)
    });

    if (!res.ok) {
      let message = `doubao provider error: ${res.status}`;
      try {
        const json = (await res.json()) as any;
        message = json?.error?.message || message;
      } catch {
        const text = await res.text();
        if (text) message = text;
      }
      console.error("[DoubaoAiProvider] Request failed:", res.status, message);
      throw createHttpError(res.status === 401 ? 401 : 502, message);
    }

    const json = (await res.json()) as any;
    
    // 兼容标准 OpenAI 响应格式
    const b64 = json?.data?.[0]?.b64_json;
    if (!b64) {
      console.error("[DoubaoAiProvider] Unexpected response:", JSON.stringify(json).slice(0, 200));
      throw createHttpError(502, "doubao provider returned no b64_json in response");
    }

    const bytes = Buffer.from(b64, "base64");
    // 返回格式为 png/jpeg 均可，后续 aiFlow 中的 toStickerPng 会统一处理格式和透明背景
    return { mime: "image/png", bytes };
  }
}
