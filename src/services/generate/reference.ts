import type { AssetStore } from "../../lib/assets";
import { nanoid } from "nanoid";
import { getAiProvider } from "../ai";
import { buildMinimalClient } from "../ai/client";
import { loadPromptConfig } from "./promptConfig";

export type GenerateReferenceRequest = {
  prompt: string;
  provider?: string;
  style?: string;
};

export type GenerateReferenceResult = {
  /** 落盘后的 assetId，可直接当 `referenceAssetId` 用于整套生成。 */
  uploadId: string;
  url: string;
  prompt: string;
  provider: string;
};

/**
 * 用文字直接生成一张参考图（文生图）。
 *
 * 复用与整套生成相同的 provider / 尺寸配置。关键点是**不传任何参考图**：
 * - OpenAI `gpt-image` 变体据此走 `/images/generations`（而不是 `/images/edits`）；
 * - 通用 OpenAI 兼容接口（豆包 Seedream / 硅基流动等）本来就走 `generations`，
 *   不带 `image` 字段即为纯文生图。
 *
 * 生成结果存进 assetStore，返回值与上传接口对齐（uploadId / url），
 * 前端拿到后即可当作普通「上传的参考图」继续走原有流程。
 */
export async function generateReferenceImage(
  assetStore: AssetStore,
  req: GenerateReferenceRequest
): Promise<GenerateReferenceResult> {
  const promptConfig = loadPromptConfig();
  const providerId = req.provider ?? promptConfig.ai?.defaultProvider ?? "mock";
  const provider = getAiProvider(providerId);
  const client = buildMinimalClient(provider);

  const width = promptConfig.ai?.imageSize?.width ?? 1024;
  const height = promptConfig.ai?.imageSize?.height ?? 1024;
  const style = req.style?.trim() || undefined;
  const prompt = style ? `${req.prompt}\n画面风格：${style}` : req.prompt;

  const out = await client.generateImage({
    prompt,
    negativePrompt: promptConfig.global.negativePrompt,
    style,
    width,
    height
  });

  const id = nanoid();
  const ext = out.mime.includes("jpeg") ? "jpg" : out.mime.includes("webp") ? "webp" : "png";
  assetStore.save(out.bytes, id, ext);

  return { uploadId: id, url: `/api/assets/${id}`, prompt, provider: providerId };
}
