import fs from "node:fs";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import createHttpError from "http-errors";
import { nanoid } from "nanoid";
import sharp from "sharp";
import { uploadsDir } from "../../lib/paths";
import { validateAsset, validateAssetList } from "../platform/validate";
import { buildZipPack } from "../pack/service";
import { getAiProvider } from "../ai";

export type WeChatAiGenerateRequest = {
  referenceAssetId: string;
  prompt: string;
  styles?: string[];
  stickerCount?: number;
  metadata?: {
    title?: string;
    author?: string;
    copyright?: string;
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

  const stickerAssetIds: string[] = [];
  for (let i = 0; i < count; i++) {
    const style = styles[i % styles.length]!;
    const out = await provider.generateImage({
      prompt: `${req.prompt}\n风格：${style}`,
      negativePrompt: undefined,
      style,
      width: 1024,
      height: 1024
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

  if (req.includeCover) {
    const cover = await toStickerPng(await fs.promises.readFile(path.join(uploadsDir(app), `${stickerAssetIds[0]}.png`)), 240);
    coverAssetId = nanoid();
    saveAssetPng(app, cover, coverAssetId);
    const v = await validateAsset(app, "wechat_cover", coverAssetId);
    if (!v.ok) throw createHttpError(400, "wechat cover validation failed");
  }

  if (req.includeIcon) {
    const base = await fs.promises.readFile(path.join(uploadsDir(app), `${stickerAssetIds[0]}.png`));
    const icon = await toStickerPng(base, 50);
    iconAssetId = nanoid();
    saveAssetPng(app, icon, iconAssetId);
    const v = await validateAsset(app, "wechat_icon", iconAssetId);
    if (!v.ok) throw createHttpError(400, "wechat icon validation failed");
  }

  if (req.includeBanner) {
    const base = await fs.promises.readFile(path.join(uploadsDir(app), `${stickerAssetIds[0]}.png`));
    const banner = await toBannerPng(base);
    bannerAssetId = nanoid();
    saveAssetPng(app, banner, bannerAssetId);
    const v = await validateAsset(app, "wechat_banner", bannerAssetId);
    if (!v.ok) throw createHttpError(400, "wechat banner validation failed");
  }

  const assets = stickerAssetIds.map((assetId, idx) => ({
    label: String(idx + 1).padStart(3, "0"),
    assetId
  }));

  const { packId } = await buildZipPack(app, {
    presetId: "wechat_stickers",
    assets,
    coverAssetId,
    iconAssetId,
    bannerAssetId,
    metadata: req.metadata
  });

  return {
    packId,
    downloadUrl: `/api/packs/${packId}/download`,
    stickers: assets.map((a) => ({ ...a, url: `/api/assets/${a.assetId}` })),
    meta: { count, styles },
    extras: { coverAssetId, iconAssetId, bannerAssetId }
  };
}

