import fs from "node:fs";
import createHttpError from "http-errors";
import { nanoid } from "nanoid";
import type { AssetStore } from "../../lib/assets";
import { validateAssetList } from "../platform/validate";
import { getPlatformPreset, resolveTargetSize } from "../platform/presets";
import { createPack, EXTRA_ASSET_KEY_TO_ROLE, type PackFileRole } from "../pack/service";
import { getAiProvider } from "../ai";
import { buildMinimalClient } from "../ai/client";
import { loadPromptConfig, compilePrompt } from "./promptConfig";
import { convertToPlatformFormat } from "./convert";
import { generateWechatExtras, type ExtrasResult } from "./extras";

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
  assetStore: AssetStore,
  dataDir: string,
  presetId: string,
  req: PlatformGenerateRequest,
  emit?: (event: string, data: unknown) => void,
  isCanceled?: () => boolean,
  signal?: AbortSignal,
  owner?: string | null
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
  const { width: targetW, height: targetH } = resolveTargetSize(preset);

  const promptConfig = loadPromptConfig();
  const providerId = req.provider ?? promptConfig.ai?.defaultProvider ?? "mock";
  const provider = getAiProvider(providerId);
  const client = buildMinimalClient(provider);
  const reference = assetStore.find(req.referenceAssetId);
  if (!reference) throw createHttpError(404, "reference asset not found");
  const referenceBytes = fs.readFileSync(reference.filePath);
  const referenceBase64 = referenceBytes.toString("base64");
  const emotions = promptConfig.emotions;

  const referenceMode = promptConfig.ai?.referenceMode ?? "base64";
  const baseUrl = promptConfig.ai?.publicBaseUrl || "";
  const referenceUrl = baseUrl
    ? `${baseUrl.replace(/\/+$/, "")}/api/assets/${req.referenceAssetId}`
    : undefined;

  const imageWidth = promptConfig.ai?.imageSize?.width ?? 1024;
  const imageHeight = promptConfig.ai?.imageSize?.height ?? 1024;

  // Count total images for progress tracking
  const supportsExtras = preset.supportsExtras === true;
  let totalImageCount = count;
  if (supportsExtras) {
    if (req.includeCover) totalImageCount++;
    if (req.includeIcon) totalImageCount++;
    if (req.includeBanner) totalImageCount++;
    if (req.enableReward) totalImageCount += 2;
  }

  emit?.("start", { count: totalImageCount, styles, referenceMode, presetId });
  const stickerAssetIds: string[] = [];
  // 逐张记录生成上下文，随 metadata.json 一起落盘，方便后续二次编辑。
  const stickerMetas: Array<{ label: string; assetId: string; prompt: string; style: string; emotion: string }> = [];
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
        referenceImageAssetId: referenceMode === "assetId" ? req.referenceAssetId : undefined
      },
      signal
    );
    throwIfCanceled();

    const sticker = await convertToPlatformFormat(out.bytes, presetId, targetW, targetH);
    const id = nanoid();
    const ext = presetId === "whatsapp_webp" ? "webp" : "png";
    assetStore.save(sticker, id, ext);
    stickerAssetIds.push(id);
    currentGenerated++;
    const label = String(i + 1).padStart(3, "0");
    stickerMetas.push({ label, assetId: id, prompt: compiledPrompt, style, emotion });
    emit?.("sticker", {
      label,
      assetId: id,
      url: `/api/assets/${id}`,
      prompt: compiledPrompt,
      style,
      emotion,
      current: currentGenerated,
      total: totalImageCount
    });
  }

  // Validate stickers
  const stickersValidation = await validateAssetList(assetStore, presetId, stickerAssetIds);
  if (!stickersValidation.ok) {
    throw createHttpError(400, `${presetId} validation failed`);
  }

  // Generate extra images only for platforms that support them (WeChat)
  const extrasResult = supportsExtras
    ? await generateWechatExtras(
        {
          assetStore,
          presetId,
          client,
          promptConfig,
          prompt: req.prompt,
          styles,
          referenceMode: referenceMode as "base64" | "url" | "assetId" | "multipart",
          referenceBase64,
          referenceUrl,
          referenceImageAssetId: req.referenceAssetId,
          emit,
          isCanceled,
          signal
        },
        {
          includeCover: req.includeCover,
          includeIcon: req.includeIcon,
          includeBanner: req.includeBanner,
          enableReward: req.enableReward,
          currentGenerated,
          totalImageCount
        }
      )
    : ({ currentGenerated, failures: {}, details: {} } as ExtrasResult);

  const coverAssetId = extrasResult.coverAssetId;
  const iconAssetId = extrasResult.iconAssetId;
  const bannerAssetId = extrasResult.bannerAssetId;
  const rewardGuideAssetId = extrasResult.rewardGuideAssetId;
  const rewardThanksAssetId = extrasResult.rewardThanksAssetId;
  currentGenerated = extrasResult.currentGenerated;

  const assets = stickerMetas.map((meta) => ({
    label: meta.label,
    assetId: meta.assetId,
    role: "sticker" as const,
    prompt: meta.prompt,
    style: meta.style,
    emotion: meta.emotion
  }));

  const extraDetails: Partial<Record<PackFileRole, { prompt?: string; style?: string }>> = {};
  for (const [key, detail] of Object.entries(extrasResult.details)) {
    const role = EXTRA_ASSET_KEY_TO_ROLE[key];
    if (role) extraDetails[role] = detail;
  }

  const generation = {
    source: "ai-generate" as const,
    providerId,
    model: promptConfig.ai?.providers?.[providerId]?.model,
    prompt: req.prompt,
    negativePrompt: promptConfig.global.negativePrompt,
    styles,
    stickerCount: count,
    emotions,
    imageSize: { width: imageWidth, height: imageHeight },
    targetSize: { width: targetW, height: targetH },
    referenceAssetId: req.referenceAssetId,
    referenceMode,
    include: {
      cover: Boolean(req.includeCover),
      icon: Boolean(req.includeIcon),
      banner: Boolean(req.includeBanner),
      reward: Boolean(req.enableReward)
    }
  };

  const { packId, downloadFilename, metadataJson } = await createPack(assetStore, dataDir, {
    presetId,
    assets,
    coverAssetId,
    iconAssetId,
    bannerAssetId,
    rewardGuideAssetId,
    rewardThanksAssetId,
    referenceAssetId: req.referenceAssetId,
    metadata: req.metadata,
    generation,
    extraDetails
  }, owner);

  const result = {
    packId,
    downloadUrl: `/api/packs/${packId}/download`,
    downloadFilename,
    stickers: assets.map((a) => ({ ...a, url: `/api/assets/${a.assetId}` })),
    metadataJson,
    generation,
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
    extras: { coverAssetId, iconAssetId, bannerAssetId, rewardGuideAssetId, rewardThanksAssetId },
    // 扩展资源各自实际使用的提示词 / 风格：导入 ZIP 还原或重建时据此写回 metadata
    extraDetails,
    // 单张扩展资源失败的 key → 原因；前端据此渲染失败卡片并支持单资源重生成。
    extraFailures: extrasResult.failures
  };
  emit?.("done", result);
  return result;
}
