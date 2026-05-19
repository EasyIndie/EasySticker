import fs from "node:fs";
import path from "node:path";
import type { FastifyInstance, FastifyRequest } from "fastify";
import createHttpError from "http-errors";
import { nanoid } from "nanoid";
import sharp from "sharp";
import { uploadsDir } from "../../lib/paths";
import { validateAsset, validateAssetList } from "../platform/validate";
import { getPlatformPreset } from "../platform/presets";
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

function saveAsset(app: FastifyInstance, bytes: Buffer, assetId: string, ext = "png") {
  const dir = uploadsDir(app);
  fs.mkdirSync(dir, { recursive: true });
  const outPath = path.join(dir, `${assetId}.${ext}`);
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

async function convertToPlatformFormat(
  input: Buffer,
  presetId: string,
  targetW: number,
  targetH: number
): Promise<Buffer> {
  const pipeline = sharp(input, { animated: false })
    .rotate()
    .ensureAlpha()
    .resize(targetW, targetH, {
      fit: "contain",
      background: { r: 0, g: 0, b: 0, alpha: 0 }
    });

  if (presetId === "whatsapp_webp") {
    return pipeline.webp({ quality: 90 }).toBuffer();
  }

  return pipeline.png({ compressionLevel: 9, adaptiveFiltering: true }).toBuffer();
}

async function resizePng(input: Buffer, width: number, height: number, fit: "contain" | "cover") {
  return sharp(input, { animated: false })
    .rotate()
    .ensureAlpha()
    .resize(width, height, { fit, background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer();
}

function saveImportedAsset(app: FastifyInstance, bytes: Buffer, ext = "png") {
  const assetId = nanoid();
  saveAsset(app, bytes, assetId, ext);
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

export async function importStickerPack(app: FastifyInstance, presetId: string, req: FastifyRequest) {
  const preset = getPlatformPreset(presetId);
  if (!preset) throw createHttpError(400, `unknown presetId: ${presetId}`);

  // Determine resize target
  let targetW: number;
  let targetH: number;
  if (preset.exactWidth && preset.exactHeight) {
    targetW = preset.exactWidth;
    targetH = preset.exactHeight;
  } else if (preset.requiredSquare) {
    const size = Math.min(preset.maxWidth, preset.maxHeight);
    targetW = targetH = size;
  } else {
    targetW = preset.maxWidth;
    targetH = preset.maxHeight;
  }

  const isWeChat = presetId === "wechat_stickers";
  const maxStickers = preset.maxCount ?? 50;

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
        if (stickerAssetIds.length >= maxStickers) {
          throw createHttpError(400, `最多只能导入 ${maxStickers} 张图片`);
        }
        const ext = presetId === "whatsapp_webp" ? "webp" : "png";
        const sticker = await convertToPlatformFormat(input, presetId, targetW, targetH);
        stickerAssetIds.push(saveImportedAsset(app, sticker, ext));
      } else {
        importedExtras[part.fieldname] = input;
      }
      continue;
    }

    fields[part.fieldname] = part.value;
  }

  const minStickers = preset.minCount ?? 1;
  if (stickerAssetIds.length < minStickers) {
    throw createHttpError(400, `该平台至少需要导入 ${minStickers} 张图片`);
  }

  const validation = await validateAssetList(app, presetId, stickerAssetIds);
  if (!validation.ok) {
    throw createHttpError(400, `${presetId} validation failed`);
  }

  const metadata: ImportMetadata = {
    title: cleanText(fields.title),
    author: cleanText(fields.author),
    version: cleanText(fields.version),
    copyright: cleanText(fields.copyright),
    rewardMessage: cleanText(fields.rewardMessage)
  };
  const includeReward =
    fields.includeReward === "true" || Boolean(importedExtras.rewardGuide || importedExtras.rewardThanks);

  let coverAssetId: string | undefined;
  let iconAssetId: string | undefined;
  let bannerAssetId: string | undefined;
  let rewardGuideAssetId: string | undefined;
  let rewardThanksAssetId: string | undefined;

  if (isWeChat) {
    // Determine sticker extension from preset
    const stickerExt = presetId === "whatsapp_webp" ? "webp" : "png";
    const firstSticker = stickerAssetIds[0]
      ? fs.readFileSync(path.join(uploadsDir(app), `${stickerAssetIds[0]}.${stickerExt}`))
      : undefined;

    // WeChat extras are always PNG
    coverAssetId = importedExtras.cover
      ? saveImportedAsset(app, await resizePng(importedExtras.cover, 240, 240, "contain"), "png")
      : firstSticker
        ? saveImportedAsset(app, await resizePng(firstSticker, 240, 240, "contain"), "png")
        : undefined;
    const iconSource = importedExtras.icon || importedExtras.cover || firstSticker;
    iconAssetId = iconSource
      ? saveImportedAsset(app, await resizePng(iconSource, 50, 50, "contain"), "png")
      : undefined;
    bannerAssetId = importedExtras.banner
      ? saveImportedAsset(app, await resizePng(importedExtras.banner, 750, 400, "cover"), "png")
      : undefined;
    rewardGuideAssetId = importedExtras.rewardGuide
      ? saveImportedAsset(app, await resizePng(importedExtras.rewardGuide, 750, 400, "cover"), "png")
      : undefined;
    rewardThanksAssetId = importedExtras.rewardThanks
      ? saveImportedAsset(app, await resizePng(importedExtras.rewardThanks, 750, 400, "cover"), "png")
      : undefined;

    await validateOptionalAsset(app, "wechat_cover", coverAssetId);
    await validateOptionalAsset(app, "wechat_icon", iconAssetId);
    await validateOptionalAsset(app, "wechat_banner", bannerAssetId);
    await validateOptionalAsset(app, "wechat_reward_guide", rewardGuideAssetId);
    await validateOptionalAsset(app, "wechat_reward_thanks", rewardThanksAssetId);
  }

  const assets = stickerAssetIds.map((assetId, idx) => ({
    label: String(idx + 1).padStart(3, "0"),
    assetId
  }));

  const { packId, downloadFilename, metadataJson } = await buildZipPack(app, {
    presetId,
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
      referenceMode: "import",
      presetId
    },
    extras: { coverAssetId, iconAssetId, bannerAssetId, rewardGuideAssetId, rewardThanksAssetId }
  };
}
