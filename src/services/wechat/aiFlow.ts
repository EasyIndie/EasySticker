import fs from "node:fs";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import createHttpError from "http-errors";
import { nanoid } from "nanoid";
import sharp from "sharp";
import { findAssetFile } from "../../lib/assets";
import { uploadsDir } from "../../lib/paths";
import { validateAsset, validateAssetList } from "../platform/validate";
import { buildZipPack } from "../pack/service";
import { getAiProvider } from "../ai";
import { buildMinimalClient } from "../ai/client";
import { loadPromptConfig, compilePrompt } from "./promptConfig";

export type WeChatAiGenerateRequest = {
  referenceAssetId: string;
  prompt: string;
  styles?: string[];
  stickerCount?: number;
  enableReward?: boolean;
  metadata?: {
    title?: string;
    author?: string;
    copyright?: string;
    version?: string;
    rewardMessage?: string;
  };
  includeCover?: boolean;
  includeIcon?: boolean;
  includeBanner?: boolean;
};

function saveAssetPng(app: FastifyInstance, bytes: Buffer, assetId: string) {
  const dir = uploadsDir(app);
  fs.mkdirSync(dir, { recursive: true });
  const outPath = path.join(dir, `${assetId}.png`);
  fs.writeFileSync(outPath, bytes);
  return outPath;
}

async function toStickerPng(input: Buffer, size: number) {
  const buf = await sharp(input)
    .toFormat("png")
    .ensureAlpha()
    .resize(size, size, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png({ compressionLevel: 9, adaptiveFiltering: true, palette: true })
    .toBuffer();
  return buf;
}

async function toBannerPng(input: Buffer) {
  return sharp(input)
    .ensureAlpha()
    .resize(750, 400, { fit: "cover" })
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer();
}

export async function getWeChatPromptTemplate(referenceAssetId: string) {
  const promptConfig = loadPromptConfig();
  return {
    referenceAssetId,
    prompt: promptConfig.global.prompt,
    negativePrompt: promptConfig.global.negativePrompt,
    styles: promptConfig.global.styles
  };
}

export async function generateWeChatAssetsAndPack(
  app: FastifyInstance,
  req: WeChatAiGenerateRequest,
  emit?: (event: string, data: unknown) => void,
  isCanceled?: () => boolean
) {
  const count = Math.max(8, Math.min(24, Math.floor(req.stickerCount ?? 8)));
  const styles = (req.styles?.filter(Boolean) ?? []).length ? (req.styles!.filter(Boolean) as string[]) : ["默认"];
  if (!req.referenceAssetId) throw createHttpError(400, "missing referenceAssetId");
  if (!req.prompt) throw createHttpError(400, "missing prompt");

  const provider = getAiProvider();
  const client = buildMinimalClient(provider);
  const reference = findAssetFile(app, req.referenceAssetId);
  if (!reference) throw createHttpError(404, "reference asset not found");
  const referenceBytes = fs.readFileSync(reference.filePath);
  const referenceBase64 = referenceBytes.toString("base64");
  const baseUrl = process.env.AI_PUBLIC_BASE_URL;
  const referenceUrl = baseUrl ? `${baseUrl.replace(/\/+$/, "")}/api/assets/${req.referenceAssetId}` : undefined;
  const referenceMode = process.env.AI_HTTP_REFERENCE_MODE ?? "base64";

  const promptConfig = loadPromptConfig();
  const emotions = promptConfig.emotions;

  const imageWidth = Number(process.env.AI_IMAGE_WIDTH ?? 1024);
  const imageHeight = Number(process.env.AI_IMAGE_HEIGHT ?? 1024);

  emit?.("start", { count, styles, referenceMode });
  const stickerAssetIds: string[] = [];
  for (let i = 0; i < count; i++) {
    if (isCanceled?.()) throw createHttpError(499, "生成任务已取消");
    const style = styles[i % styles.length]!;
    const emotion = emotions[i % emotions.length]; // 依次取出一个情绪
    
    emit?.("progress", { phase: "stickers", current: i + 1, total: count });
    const compiledPrompt = compilePrompt(promptConfig.templates.sticker, {
      prompt: req.prompt,
      emotion,
      style
    });
    
    const out = await client.generateImage({
      prompt: compiledPrompt,
      negativePrompt: undefined,
      style,
      width: imageWidth,
      height: imageHeight,
      referenceImageTransport: referenceMode as "base64" | "url" | "assetId" | "multipart",
      referenceImageBase64:
        referenceMode === "base64" || referenceMode === "multipart" ? referenceBase64 : undefined,
      referenceImageUrl: referenceMode === "url" ? referenceUrl : undefined,
      referenceImageMime: "image/png",
      referenceImageAssetId: referenceMode === "assetId" ? req.referenceAssetId : undefined
    });
    const sticker = await toStickerPng(out.bytes, 240);
    const id = nanoid();
    saveAssetPng(app, sticker, id);
    stickerAssetIds.push(id);
    const label = String(i + 1).padStart(3, "0");
    emit?.("sticker", { label, assetId: id, url: `/api/assets/${id}` });
  }

  const stickersValidation = await validateAssetList(app, "wechat_stickers", stickerAssetIds);
  if (!stickersValidation.ok) {
    throw createHttpError(400, "wechat stickers validation failed");
  }

  let coverAssetId: string | undefined;
  let iconAssetId: string | undefined;
  let bannerAssetId: string | undefined;
  let rewardGuideAssetId: string | undefined;
  let rewardThanksAssetId: string | undefined;

  // 辅助函数：调用大模型生成专属的额外资源图
  const generateExtraImage = async (customPrompt: string) => {
    const compiledPrompt = compilePrompt(promptConfig.templates.extra, {
      prompt: req.prompt,
      customPrompt,
      style: styles[0]!
    });
    
    return await client.generateImage({
      prompt: compiledPrompt,
      negativePrompt: undefined,
      style: styles[0],
      width: imageWidth,
      height: imageHeight,
      referenceImageTransport: referenceMode as "base64" | "url" | "assetId" | "multipart",
      referenceImageBase64:
        referenceMode === "base64" || referenceMode === "multipart" ? referenceBase64 : undefined,
      referenceImageUrl: referenceMode === "url" ? referenceUrl : undefined,
      referenceImageMime: "image/png",
      referenceImageAssetId: referenceMode === "assetId" ? req.referenceAssetId : undefined
    });
  };

  if (req.includeCover) {
    if (isCanceled?.()) throw createHttpError(499, "生成任务已取消");
    emit?.("progress", { phase: "extras", label: "表情封面图" });
    const out = await generateExtraImage(promptConfig.extraPrompts.cover);
    const cover = await toStickerPng(out.bytes, 240);
    coverAssetId = nanoid();
    saveAssetPng(app, cover, coverAssetId);
    const v = await validateAsset(app, "wechat_cover", coverAssetId);
    if (!v.ok) throw createHttpError(400, "wechat cover validation failed");
    emit?.("extra", { key: "coverAssetId", assetId: coverAssetId, url: `/api/assets/${coverAssetId}` });
  }

  if (req.includeIcon) {
    if (isCanceled?.()) throw createHttpError(499, "生成任务已取消");
    emit?.("progress", { phase: "extras", label: "聊天面板图标" });
    const out = await generateExtraImage(promptConfig.extraPrompts.icon);
    const icon = await toStickerPng(out.bytes, 50);
    iconAssetId = nanoid();
    saveAssetPng(app, icon, iconAssetId);
    const v = await validateAsset(app, "wechat_icon", iconAssetId);
    if (!v.ok) throw createHttpError(400, "wechat icon validation failed");
    emit?.("extra", { key: "iconAssetId", assetId: iconAssetId, url: `/api/assets/${iconAssetId}` });
  }

  if (req.includeBanner) {
    if (isCanceled?.()) throw createHttpError(499, "生成任务已取消");
    emit?.("progress", { phase: "extras", label: "详情页横幅" });
    const out = await generateExtraImage(promptConfig.extraPrompts.banner);
    const banner = await toBannerPng(out.bytes);
    bannerAssetId = nanoid();
    saveAssetPng(app, banner, bannerAssetId);
    const v = await validateAsset(app, "wechat_banner", bannerAssetId);
    if (!v.ok) throw createHttpError(400, "wechat banner validation failed");
    emit?.("extra", { key: "bannerAssetId", assetId: bannerAssetId, url: `/api/assets/${bannerAssetId}` });
  }

  if (req.enableReward) {
    if (isCanceled?.()) throw createHttpError(499, "生成任务已取消");
    emit?.("progress", { phase: "extras", label: "赞赏引导图" });
    const outGuide = await generateExtraImage(promptConfig.extraPrompts.rewardGuide);
    const rewardGuide = await toBannerPng(outGuide.bytes);
    rewardGuideAssetId = nanoid();
    saveAssetPng(app, rewardGuide, rewardGuideAssetId);
    const rewardGuideValidation = await validateAsset(app, "wechat_reward_guide", rewardGuideAssetId);
    if (!rewardGuideValidation.ok) throw createHttpError(400, "wechat reward guide validation failed");
    emit?.("extra", { key: "rewardGuideAssetId", assetId: rewardGuideAssetId, url: `/api/assets/${rewardGuideAssetId}` });

    if (isCanceled?.()) throw createHttpError(499, "生成任务已取消");
    emit?.("progress", { phase: "extras", label: "赞赏感谢图" });
    const outThanks = await generateExtraImage(promptConfig.extraPrompts.rewardThanks);
    const rewardThanks = await toBannerPng(outThanks.bytes);
    rewardThanksAssetId = nanoid();
    saveAssetPng(app, rewardThanks, rewardThanksAssetId);
    const rewardThanksValidation = await validateAsset(app, "wechat_reward_thanks", rewardThanksAssetId);
    if (!rewardThanksValidation.ok) throw createHttpError(400, "wechat reward thanks validation failed");
    emit?.("extra", { key: "rewardThanksAssetId", assetId: rewardThanksAssetId, url: `/api/assets/${rewardThanksAssetId}` });
  }

  const assets = stickerAssetIds.map((assetId, idx) => ({
    label: String(idx + 1).padStart(3, "0"),
    assetId
  }));

  const { packId, downloadFilename, metadataJson } = await buildZipPack(app, {
    presetId: "wechat_stickers",
    assets,
    coverAssetId,
    iconAssetId,
    bannerAssetId,
    rewardGuideAssetId,
    rewardThanksAssetId,
    metadata: req.metadata
  });

  const result = {
    packId,
    downloadUrl: `/api/packs/${packId}/download`,
    downloadFilename,
    stickers: assets.map((a) => ({ ...a, url: `/api/assets/${a.assetId}` })),
    metadataJson,
    meta: {
      count,
      styles,
      title: req.metadata?.title ?? null,
      author: req.metadata?.author ?? null,
      version: req.metadata?.version ?? null,
      copyright: req.metadata?.copyright ?? null,
      rewardMessage: req.metadata?.rewardMessage ?? null,
      rewardEnabled: Boolean(req.enableReward),
      referenceAssetId: req.referenceAssetId,
      referenceMode
    },
    extras: { coverAssetId, iconAssetId, bannerAssetId, rewardGuideAssetId, rewardThanksAssetId }
  };
  emit?.("done", result);
  return result;
}
