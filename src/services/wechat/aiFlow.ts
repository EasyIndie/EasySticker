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
  return {
    referenceAssetId,
    prompt:
      "基于参考图的主体形象，生成一张微信聊天场景可用的表情贴纸。要求：可爱有趣，主体居中，背景透明或纯色简洁，避免文字与水印。",
    negativePrompt: "文字、水印、二维码、品牌logo、复杂背景、低清晰度、锯齿、模糊",
    styles: ["扁平插画", "3D 卡通", "日系 Q 版", "像素风", "国潮风"]
  };
}

export async function generateWeChatAssetsAndPack(app: FastifyInstance, req: WeChatAiGenerateRequest) {
  const count = Math.max(8, Math.min(24, Math.floor(req.stickerCount ?? 8)));
  const styles = (req.styles?.filter(Boolean) ?? []).length ? (req.styles!.filter(Boolean) as string[]) : ["默认"];
  if (!req.referenceAssetId) throw createHttpError(400, "missing referenceAssetId");
  if (!req.prompt) throw createHttpError(400, "missing prompt");

  const provider = getAiProvider();
  const reference = findAssetFile(app, req.referenceAssetId);
  if (!reference) throw createHttpError(404, "reference asset not found");
  const referenceBytes = fs.readFileSync(reference.filePath);
  const referenceBase64 = referenceBytes.toString("base64");
  const baseUrl = process.env.AI_PUBLIC_BASE_URL;
  const referenceUrl = baseUrl ? `${baseUrl.replace(/\/+$/, "")}/api/assets/${req.referenceAssetId}` : undefined;
  const referenceMode = process.env.AI_HTTP_REFERENCE_MODE ?? "base64";

  const stickerAssetIds: string[] = [];
  for (let i = 0; i < count; i++) {
    const style = styles[i % styles.length]!;
    const out = await provider.generateImage({
      prompt: `${req.prompt}\n风格：${style}`,
      negativePrompt: undefined,
      style,
      width: 1024,
      height: 1024,
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
  const primaryStickerBytes = await fs.promises.readFile(path.join(uploadsDir(app), `${stickerAssetIds[0]}.png`));

  if (req.includeCover) {
    const cover = await toStickerPng(primaryStickerBytes, 240);
    coverAssetId = nanoid();
    saveAssetPng(app, cover, coverAssetId);
    const v = await validateAsset(app, "wechat_cover", coverAssetId);
    if (!v.ok) throw createHttpError(400, "wechat cover validation failed");
  }

  if (req.includeIcon) {
    const icon = await toStickerPng(primaryStickerBytes, 50);
    iconAssetId = nanoid();
    saveAssetPng(app, icon, iconAssetId);
    const v = await validateAsset(app, "wechat_icon", iconAssetId);
    if (!v.ok) throw createHttpError(400, "wechat icon validation failed");
  }

  if (req.includeBanner) {
    const banner = await toBannerPng(primaryStickerBytes);
    bannerAssetId = nanoid();
    saveAssetPng(app, banner, bannerAssetId);
    const v = await validateAsset(app, "wechat_banner", bannerAssetId);
    if (!v.ok) throw createHttpError(400, "wechat banner validation failed");
  }

  if (req.enableReward) {
    const rewardGuide = await toBannerPng(primaryStickerBytes);
    rewardGuideAssetId = nanoid();
    saveAssetPng(app, rewardGuide, rewardGuideAssetId);
    const rewardGuideValidation = await validateAsset(app, "wechat_reward_guide", rewardGuideAssetId);
    if (!rewardGuideValidation.ok) throw createHttpError(400, "wechat reward guide validation failed");

    const rewardThanks = await toBannerPng(primaryStickerBytes);
    rewardThanksAssetId = nanoid();
    saveAssetPng(app, rewardThanks, rewardThanksAssetId);
    const rewardThanksValidation = await validateAsset(app, "wechat_reward_thanks", rewardThanksAssetId);
    if (!rewardThanksValidation.ok) throw createHttpError(400, "wechat reward thanks validation failed");
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

  return {
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
}
