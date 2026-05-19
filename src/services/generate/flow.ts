import fs from "node:fs";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import createHttpError from "http-errors";
import { nanoid } from "nanoid";
import sharp from "sharp";
import { findAssetFile } from "../../lib/assets";
import { uploadsDir } from "../../lib/paths";
import { validateAsset, validateAssetList } from "../platform/validate";
import { getPlatformPreset } from "../platform/presets";
import { buildZipPack } from "../pack/service";
import { getAiProvider } from "../ai";
import { buildMinimalClient } from "../ai/client";
import { loadPromptConfig, compilePrompt } from "./promptConfig";

export type PlatformGenerateRequest = {
  referenceAssetId: string;
  prompt: string;
  provider?: string;
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

function saveAsset(app: FastifyInstance, bytes: Buffer, assetId: string, ext = "png") {
  const dir = uploadsDir(app);
  fs.mkdirSync(dir, { recursive: true });
  const outPath = path.join(dir, `${assetId}.${ext}`);
  fs.writeFileSync(outPath, bytes);
  return outPath;
}

async function convertToPlatformFormat(
  input: Buffer,
  presetId: string,
  targetW: number,
  targetH: number
): Promise<Buffer> {
  const pipeline = sharp(input).ensureAlpha().resize(targetW, targetH, {
    fit: "contain",
    background: { r: 0, g: 0, b: 0, alpha: 0 }
  });

  if (presetId === "whatsapp_webp") {
    // WhatsApp 要求单张 sticker ≤ 100KB。从高到低尝试 quality 直到文件体积达标
    const maxBytes = 100 * 1024;
    for (let quality = 90; quality >= 30; quality -= 5) {
      const buf = await pipeline.clone().webp({ quality }).toBuffer();
      if (buf.length <= maxBytes) return buf;
    }
    // 保底：最低 quality
    return pipeline.webp({ quality: 30 }).toBuffer();
  }

  return pipeline.png({ compressionLevel: 9, adaptiveFiltering: true }).toBuffer();
}

async function toBannerPng(input: Buffer) {
  return sharp(input)
    .ensureAlpha()
    .resize(750, 400, { fit: "cover" })
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer();
}

export async function getPromptTemplate(referenceAssetId: string) {
  const promptConfig = loadPromptConfig();
  return {
    referenceAssetId,
    prompt: promptConfig.global.prompt,
    negativePrompt: promptConfig.global.negativePrompt,
    styles: promptConfig.global.styles
  };
}

export async function generateAssetsAndPack(
  app: FastifyInstance,
  presetId: string,
  req: PlatformGenerateRequest,
  emit?: (event: string, data: unknown) => void,
  isCanceled?: () => boolean,
  signal?: AbortSignal
) {
  const preset = getPlatformPreset(presetId);
  if (!preset) throw createHttpError(400, `unknown presetId: ${presetId}`);

  const min = preset.minCount ?? 1;
  const max = preset.maxCount ?? 50;
  const count = Math.max(min, Math.min(max, Math.floor(req.stickerCount ?? 8)));
  const styles = (req.styles?.filter(Boolean) ?? []).length ? (req.styles!.filter(Boolean) as string[]) : ["默认"];
  if (!req.referenceAssetId) throw createHttpError(400, "missing referenceAssetId");
  if (!req.prompt) throw createHttpError(400, "missing prompt");

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

  const promptConfig = loadPromptConfig();
  const providerId = req.provider ?? promptConfig.ai?.defaultProvider ?? "mock";
  const provider = getAiProvider(providerId);
  const client = buildMinimalClient(provider);
  const reference = findAssetFile(app, req.referenceAssetId);
  if (!reference) throw createHttpError(404, "reference asset not found");
  const referenceBytes = fs.readFileSync(reference.filePath);
  const referenceBase64 = referenceBytes.toString("base64");
  const providerComfyOptions = promptConfig.ai?.providers?.[providerId]?.comfy;
  const emotions = promptConfig.emotions;

  const referenceMode = promptConfig.ai?.referenceMode ?? "base64";
  const baseUrl = promptConfig.ai?.publicBaseUrl || "";
  const referenceUrl = baseUrl
    ? `${baseUrl.replace(/\/+$/, "")}/api/assets/${req.referenceAssetId}`
    : undefined;

  const imageWidth = promptConfig.ai?.imageSize?.width ?? 1024;
  const imageHeight = promptConfig.ai?.imageSize?.height ?? 1024;

  // Count total images for progress tracking
  const isWeChat = presetId === "wechat_stickers";
  let totalImageCount = count;
  if (req.includeCover && isWeChat) totalImageCount++;
  if (req.includeIcon && isWeChat) totalImageCount++;
  if (req.includeBanner && isWeChat) totalImageCount++;
  if (req.enableReward && isWeChat) totalImageCount += 2;

  emit?.("start", { count: totalImageCount, styles, referenceMode, presetId });
  const stickerAssetIds: string[] = [];
  let currentGenerated = 0;
  const throwIfCanceled = () => {
    if (signal?.aborted || isCanceled?.()) throw createHttpError(499, "生成任务已取消");
  };

  // Generate stickers
  for (let i = 0; i < count; i++) {
    throwIfCanceled();
    const style = styles[i % styles.length]!;
    const emotion = emotions[i % emotions.length];

    emit?.("progress", { phase: "stickers", current: currentGenerated + 1, total: totalImageCount });
    const compiledPrompt = compilePrompt(promptConfig.templates.sticker, {
      prompt: req.prompt,
      emotion,
      style
    });

    const out = await client.generateImage(
      {
        prompt: compiledPrompt,
        negativePrompt: promptConfig.global.negativePrompt,
        style,
        width: imageWidth,
        height: imageHeight,
        referenceImageTransport: referenceMode as "base64" | "url" | "assetId" | "multipart",
        referenceImageBase64:
          referenceMode === "base64" || referenceMode === "multipart" ? referenceBase64 : undefined,
        referenceImageUrl: referenceMode === "url" ? referenceUrl : undefined,
        referenceImageMime: "image/png",
        referenceImageAssetId: referenceMode === "assetId" ? req.referenceAssetId : undefined,
        providerOptions: providerComfyOptions ? { comfy: providerComfyOptions } : undefined
      },
      signal
    );
    throwIfCanceled();

    const sticker = await convertToPlatformFormat(out.bytes, presetId, targetW, targetH);
    const id = nanoid();
    const ext = presetId === "whatsapp_webp" ? "webp" : "png";
    saveAsset(app, sticker, id, ext);
    stickerAssetIds.push(id);
    currentGenerated++;
    const label = String(i + 1).padStart(3, "0");
    emit?.("sticker", {
      label,
      assetId: id,
      url: `/api/assets/${id}`,
      prompt: compiledPrompt,
      current: currentGenerated,
      total: totalImageCount
    });
  }

  // Validate stickers
  const stickersValidation = await validateAssetList(app, presetId, stickerAssetIds);
  if (!stickersValidation.ok) {
    throw createHttpError(400, `${presetId} validation failed`);
  }

  let coverAssetId: string | undefined;
  let iconAssetId: string | undefined;
  let bannerAssetId: string | undefined;
  let rewardGuideAssetId: string | undefined;
  let rewardThanksAssetId: string | undefined;

  // Generate extra images only for WeChat
  const generateExtraImage = async (customPrompt: string) => {
    throwIfCanceled();
    const compiledPrompt = compilePrompt(promptConfig.templates.extra, {
      prompt: req.prompt,
      customPrompt,
      style: styles[0]!
    });

    const res = await client.generateImage(
      {
        prompt: compiledPrompt,
        negativePrompt: promptConfig.global.negativePrompt,
        style: styles[0],
        width: imageWidth,
        height: imageHeight,
        referenceImageTransport: referenceMode as "base64" | "url" | "assetId" | "multipart",
        referenceImageBase64:
          referenceMode === "base64" || referenceMode === "multipart" ? referenceBase64 : undefined,
        referenceImageUrl: referenceMode === "url" ? referenceUrl : undefined,
        referenceImageMime: "image/png",
        referenceImageAssetId: referenceMode === "assetId" ? req.referenceAssetId : undefined,
        providerOptions: providerComfyOptions ? { comfy: providerComfyOptions } : undefined
      },
      signal
    );
    throwIfCanceled();
    return { ...res, prompt: compiledPrompt };
  };

  if (isWeChat) {
    if (req.includeCover) {
      throwIfCanceled();
      emit?.("progress", { phase: "extras", label: "表情封面图", current: currentGenerated + 1, total: totalImageCount });
      const out = await generateExtraImage(promptConfig.extraPrompts.cover);
      const cover = await convertToPlatformFormat(out.bytes, presetId, 240, 240);
      coverAssetId = nanoid();
      saveAsset(app, cover, coverAssetId);
      const v = await validateAsset(app, "wechat_cover", coverAssetId);
      if (!v.ok) throw createHttpError(400, "wechat cover validation failed");
      currentGenerated++;
      emit?.("extra", {
        key: "coverAssetId",
        assetId: coverAssetId,
        url: `/api/assets/${coverAssetId}`,
        prompt: out.prompt,
        current: currentGenerated,
        total: totalImageCount
      });
    }

    if (req.includeIcon) {
      throwIfCanceled();
      emit?.("progress", { phase: "extras", label: "聊天面板图标", current: currentGenerated + 1, total: totalImageCount });
      const out = await generateExtraImage(promptConfig.extraPrompts.icon);
      const icon = await convertToPlatformFormat(out.bytes, presetId, 50, 50);
      iconAssetId = nanoid();
      saveAsset(app, icon, iconAssetId);
      const v = await validateAsset(app, "wechat_icon", iconAssetId);
      if (!v.ok) throw createHttpError(400, "wechat icon validation failed");
      currentGenerated++;
      emit?.("extra", {
        key: "iconAssetId",
        assetId: iconAssetId,
        url: `/api/assets/${iconAssetId}`,
        prompt: out.prompt,
        current: currentGenerated,
        total: totalImageCount
      });
    }

    if (req.includeBanner) {
      throwIfCanceled();
      emit?.("progress", { phase: "extras", label: "详情页横幅", current: currentGenerated + 1, total: totalImageCount });
      const out = await generateExtraImage(promptConfig.extraPrompts.banner);
      const banner = await toBannerPng(out.bytes);
      bannerAssetId = nanoid();
      saveAsset(app, banner, bannerAssetId);
      const v = await validateAsset(app, "wechat_banner", bannerAssetId);
      if (!v.ok) throw createHttpError(400, "wechat banner validation failed");
      currentGenerated++;
      emit?.("extra", {
        key: "bannerAssetId",
        assetId: bannerAssetId,
        url: `/api/assets/${bannerAssetId}`,
        prompt: out.prompt,
        current: currentGenerated,
        total: totalImageCount
      });
    }

    if (req.enableReward) {
      throwIfCanceled();
      emit?.("progress", { phase: "extras", label: "赞赏引导图", current: currentGenerated + 1, total: totalImageCount });
      const outGuide = await generateExtraImage(promptConfig.extraPrompts.rewardGuide);
      const rewardGuide = await toBannerPng(outGuide.bytes);
      rewardGuideAssetId = nanoid();
      saveAsset(app, rewardGuide, rewardGuideAssetId);
      const rewardGuideValidation = await validateAsset(app, "wechat_reward_guide", rewardGuideAssetId);
      if (!rewardGuideValidation.ok) throw createHttpError(400, "wechat reward guide validation failed");
      currentGenerated++;
      emit?.("extra", {
        key: "rewardGuideAssetId",
        assetId: rewardGuideAssetId,
        url: `/api/assets/${rewardGuideAssetId}`,
        prompt: outGuide.prompt,
        current: currentGenerated,
        total: totalImageCount
      });

      throwIfCanceled();
      emit?.("progress", { phase: "extras", label: "赞赏感谢图", current: currentGenerated + 1, total: totalImageCount });
      const outThanks = await generateExtraImage(promptConfig.extraPrompts.rewardThanks);
      const rewardThanks = await toBannerPng(outThanks.bytes);
      rewardThanksAssetId = nanoid();
      saveAsset(app, rewardThanks, rewardThanksAssetId);
      const rewardThanksValidation = await validateAsset(app, "wechat_reward_thanks", rewardThanksAssetId);
      if (!rewardThanksValidation.ok) throw createHttpError(400, "wechat reward thanks validation failed");
      currentGenerated++;
      emit?.("extra", {
        key: "rewardThanksAssetId",
        assetId: rewardThanksAssetId,
        url: `/api/assets/${rewardThanksAssetId}`,
        prompt: outThanks.prompt,
        current: currentGenerated,
        total: totalImageCount
      });
    }
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
      referenceMode,
      presetId
    },
    extras: { coverAssetId, iconAssetId, bannerAssetId, rewardGuideAssetId, rewardThanksAssetId }
  };
  emit?.("done", result);
  return result;
}
