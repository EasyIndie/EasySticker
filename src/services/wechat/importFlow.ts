import fs from "node:fs";
import path from "node:path";
import type { FastifyInstance, FastifyRequest } from "fastify";
import createHttpError from "http-errors";
import { nanoid } from "nanoid";
import sharp from "sharp";
import { uploadsDir } from "../../lib/paths";
import { validateAsset, validateAssetList } from "../platform/validate";
import { buildZipPack } from "../pack/service";

type ImportMetadata = {
  title?: string;
  author?: string;
  copyright?: string;
  version?: string;
  rewardMessage?: string;
};

const SUPPORTED_MIMES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
const IMPORT_FILE_FIELDS = new Set(["stickers", "cover", "icon", "banner", "rewardGuide", "rewardThanks"]);

function saveAssetPng(app: FastifyInstance, bytes: Buffer, assetId: string) {
  const dir = uploadsDir(app);
  fs.mkdirSync(dir, { recursive: true });
  const outPath = path.join(dir, `${assetId}.png`);
  fs.writeFileSync(outPath, bytes);
  return outPath;
}

async function readFileBuffer(file: NodeJS.ReadableStream) {
  const chunks: Buffer[] = [];
  for await (const chunk of file) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

async function toWechatStickerPng(input: Buffer) {
  return sharp(input, { animated: false })
    .rotate()
    .ensureAlpha()
    .resize(240, 240, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer();
}

async function resizePng(input: Buffer, width: number, height: number, fit: "contain" | "cover") {
  return sharp(input, { animated: false })
    .rotate()
    .ensureAlpha()
    .resize(width, height, { fit, background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer();
}

function saveImportedAsset(app: FastifyInstance, bytes: Buffer) {
  const assetId = nanoid();
  saveAssetPng(app, bytes, assetId);
  return assetId;
}

function cleanText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

async function validateOptionalAsset(app: FastifyInstance, presetId: string, assetId?: string) {
  if (!assetId) return;
  const result = await validateAsset(app, presetId, assetId);
  if (!result.ok) throw createHttpError(400, `${presetId} validation failed`);
}

export async function importWeChatStickerPack(app: FastifyInstance, req: FastifyRequest) {
  const partsFactory = (req as any).parts;
  if (typeof partsFactory !== "function") {
    throw createHttpError(400, "multipart request is required");
  }

  const fields: Record<string, unknown> = {};
  const stickerAssetIds: string[] = [];
  const importedExtras: Record<string, Buffer> = {};

  for await (const part of partsFactory.call(req)) {
    if (part.type === "file") {
      if (!part.filename) continue;
      if (!IMPORT_FILE_FIELDS.has(part.fieldname)) continue;
      if (!SUPPORTED_MIMES.has(part.mimetype)) {
        throw createHttpError(415, "only png, jpg, webp and gif images are supported");
      }
      const input = await readFileBuffer(part.file);
      if (part.fieldname === "stickers") {
        if (stickerAssetIds.length >= 24) {
          throw createHttpError(400, "最多只能导入 24 张表情图");
        }
        const sticker = await toWechatStickerPng(input);
        stickerAssetIds.push(saveImportedAsset(app, sticker));
      } else {
        importedExtras[part.fieldname] = input;
      }
      continue;
    }

    fields[part.fieldname] = part.value;
  }

  if (stickerAssetIds.length < 8) {
    throw createHttpError(400, "微信表情包至少需要导入 8 张图片");
  }

  const validation = await validateAssetList(app, "wechat_stickers", stickerAssetIds);
  if (!validation.ok) {
    throw createHttpError(400, "wechat stickers validation failed");
  }

  const metadata: ImportMetadata = {
    title: cleanText(fields.title),
    author: cleanText(fields.author),
    version: cleanText(fields.version),
    copyright: cleanText(fields.copyright),
    rewardMessage: cleanText(fields.rewardMessage)
  };
  const includeReward = fields.includeReward === "true" || Boolean(importedExtras.rewardGuide || importedExtras.rewardThanks);
  const firstSticker = stickerAssetIds[0]
    ? fs.readFileSync(path.join(uploadsDir(app), `${stickerAssetIds[0]}.png`))
    : undefined;

  const coverAssetId = importedExtras.cover
    ? saveImportedAsset(app, await resizePng(importedExtras.cover, 240, 240, "contain"))
    : firstSticker
      ? saveImportedAsset(app, await resizePng(firstSticker, 240, 240, "contain"))
      : undefined;
  const iconSource = importedExtras.icon || importedExtras.cover || firstSticker;
  const iconAssetId = iconSource ? saveImportedAsset(app, await resizePng(iconSource, 50, 50, "contain")) : undefined;
  const bannerAssetId = importedExtras.banner
    ? saveImportedAsset(app, await resizePng(importedExtras.banner, 750, 400, "cover"))
    : undefined;
  const rewardGuideAssetId = importedExtras.rewardGuide
    ? saveImportedAsset(app, await resizePng(importedExtras.rewardGuide, 750, 400, "cover"))
    : undefined;
  const rewardThanksAssetId = importedExtras.rewardThanks
    ? saveImportedAsset(app, await resizePng(importedExtras.rewardThanks, 750, 400, "cover"))
    : undefined;

  await validateOptionalAsset(app, "wechat_cover", coverAssetId);
  await validateOptionalAsset(app, "wechat_icon", iconAssetId);
  await validateOptionalAsset(app, "wechat_banner", bannerAssetId);
  await validateOptionalAsset(app, "wechat_reward_guide", rewardGuideAssetId);
  await validateOptionalAsset(app, "wechat_reward_thanks", rewardThanksAssetId);

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
    metadata
  });

  return {
    packId,
    downloadUrl: `/api/packs/${packId}/download`,
    downloadFilename,
    stickers: assets.map((a) => ({ ...a, url: `/api/assets/${a.assetId}` })),
    metadataJson,
    meta: {
      count: assets.length,
      styles: ["导入图片"],
      title: metadata.title ?? null,
      author: metadata.author ?? null,
      version: metadata.version ?? null,
      copyright: metadata.copyright ?? null,
      rewardMessage: metadata.rewardMessage ?? null,
      rewardEnabled: includeReward,
      referenceAssetId: null,
      referenceMode: "import"
    },
    extras: { coverAssetId, iconAssetId, bannerAssetId, rewardGuideAssetId, rewardThanksAssetId }
  };
}
