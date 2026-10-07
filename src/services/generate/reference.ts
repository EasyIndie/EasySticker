import fs from "node:fs";
import createHttpError from "http-errors";
import type { AssetStore } from "../../lib/assets";
import { nanoid } from "nanoid";
import { getAiProvider } from "../ai";
import { buildMinimalClient } from "../ai/client";
import type { AiReferenceImage } from "../ai/provider";
import { loadPromptConfig } from "./promptConfig";

export type GenerateReferenceRequest = {
  prompt: string;
  provider?: string;
  style?: string;
  /** 可选：已上传的参考图 assetId，作为图生图的主底图。 */
  referenceImageAssetId?: string;
  /** 可选：额外参考图 assetId 列表，排在主底图之后（仅部分模型支持多图）。 */
  additionalReferenceImageAssetIds?: string[];
};

export type GenerateReferenceResult = {
  /** 落盘后的 assetId，可直接当 `referenceAssetId` 用于整套生成。 */
  uploadId: string;
  url: string;
  prompt: string;
  provider: string;
};

function mimeFromFilename(filename: string): string {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".gif")) return "image/gif";
  return "image/png";
}

/** 把一个 assetId 解析成 provider 的参考图描述（url 或 base64，取决于 referenceMode）。 */
function resolveReferenceImage(
  assetStore: AssetStore,
  assetId: string,
  referenceMode: string,
  baseUrl: string
): AiReferenceImage {
  const asset = assetStore.find(assetId);
  if (!asset) throw createHttpError(404, `reference asset not found: ${assetId}`);
  const mime = mimeFromFilename(asset.filename);
  const url = baseUrl ? `${baseUrl.replace(/\/+$/, "")}/api/assets/${assetId}` : undefined;
  if (referenceMode === "url" && url) {
    return { url, mime };
  }
  return { base64: fs.readFileSync(asset.filePath).toString("base64"), mime };
}

/**
 * 生成一张参考图：默认是纯文生图；传入 referenceImageAssetId 时走图生图
 * （参考图 + 文字），让模型在既有图片的基础上结合描述与风格生成新的参考图。
 *
 * 多参考图：`referenceImageAssetId` 是主底图，`additionalReferenceImageAssetIds`
 * 排在其后（对应 provider 的 `additionalReferenceImages`）。只有部分模型支持多图，
 * 不传时行为与单图路径完全一致。
 *
 * 复用与整套生成相同的 provider / 尺寸配置。参考图传参与 flow.ts / single.ts 一致：
 * - `referenceMode === "url"` 且配置了 publicBaseUrl 时传 URL；
 * - 否则按 base64 传入（OpenAI `gpt-image` 会据此走 `/images/edits`）。
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

  // 图生图：把已上传的参考图传给 provider（主参考图 + 可选附加参考图）。
  const referenceMode = promptConfig.ai?.referenceMode ?? "base64";
  const baseUrl = promptConfig.ai?.publicBaseUrl || "";

  const hasMainReference = Boolean(req.referenceImageAssetId);
  const mainReference = hasMainReference
    ? resolveReferenceImage(assetStore, req.referenceImageAssetId!, referenceMode, baseUrl)
    : null;

  const additionalIds = (req.additionalReferenceImageAssetIds ?? []).filter(Boolean);
  const additionalReferenceImages: AiReferenceImage[] = additionalIds.map((id) =>
    resolveReferenceImage(assetStore, id, referenceMode, baseUrl)
  );

  const out = await client.generateImage({
    prompt,
    negativePrompt: promptConfig.global.negativePrompt,
    style,
    width,
    height,
    ...(mainReference
      ? {
          referenceImageTransport: referenceMode as "base64" | "url" | "assetId" | "multipart",
          referenceImageBase64:
            referenceMode === "base64" || referenceMode === "multipart" ? mainReference.base64 : undefined,
          referenceImageUrl: referenceMode === "url" ? mainReference.url : undefined,
          referenceImageMime: mainReference.mime,
          referenceImageAssetId: referenceMode === "assetId" ? req.referenceImageAssetId : undefined
        }
      : {}),
    ...(additionalReferenceImages.length ? { additionalReferenceImages } : {})
  });

  const id = nanoid();
  const ext = out.mime.includes("jpeg") ? "jpg" : out.mime.includes("webp") ? "webp" : "png";
  assetStore.save(out.bytes, id, ext);

  return { uploadId: id, url: `/api/assets/${id}`, prompt, provider: providerId };
}
