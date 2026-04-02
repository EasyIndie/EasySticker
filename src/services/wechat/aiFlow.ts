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
  return {
    referenceAssetId,
    prompt:
      "基于参考图的主体形象，生成一张微信聊天场景可用的表情贴纸。要求：可爱有趣，主体居中，背景透明或纯色简洁，避免文字与水印。",
    negativePrompt: "文字、水印、二维码、品牌logo、复杂背景、低清晰度、锯齿、模糊",
    styles: ["扁平插画", "3D 卡通", "日系 Q 版", "像素风", "国潮风"]
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

  // 定义一组常见的表情包情绪和动作，用于动态注入到每张贴纸的 Prompt 中，让大模型生成多样化的内容
  const emotions = [
    "开心，大笑，挥手打招呼", "点赞，竖起大拇指", "比心，双手比心", "害羞，捂脸",
    "感谢，双手合十", "哭泣，流泪", "生气，双手抱胸", "疑问，头上带有问号",
    "睡觉，打呼噜", "奋斗，头绑发带加油", "震惊，下巴掉下来", "无奈，摊手",
    "期待，星星眼", "庆祝，撒花", "拒绝，双手打叉", "吃瓜，拿爆米花",
    "叹气，扶额", "庆祝，举起酒杯", "思考，手托下巴", "疲惫，瘫倒",
    "偷笑，捂嘴", "抱抱，张开双臂", "冷汗，流汗", "期待，搓手"
  ];

  emit?.("start", { count, styles, referenceMode });
  const stickerAssetIds: string[] = [];
  for (let i = 0; i < count; i++) {
    if (isCanceled?.()) throw createHttpError(499, "生成任务已取消");
    const style = styles[i % styles.length]!;
    const emotion = emotions[i % emotions.length]; // 依次取出一个情绪
    
    emit?.("progress", { phase: "stickers", current: i + 1, total: count });
    const out = await client.generateImage({
      prompt: `${req.prompt}\n当前表情主题与动作：${emotion}\n风格：${style}`,
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
    return await client.generateImage({
      prompt: `${req.prompt}\n${customPrompt}\n风格：${styles[0]}`,
      negativePrompt: undefined,
      style: styles[0],
      width: 1024,
      height: 1024,
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
    const out = await generateExtraImage("当前要求：生成一张能代表整套表情包的高质量主封面，构图饱满，主体居中。");
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
    const out = await generateExtraImage("当前要求：生成一个极简的头像图标，主要突出角色面部特征，大头贴特写。");
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
    const out = await generateExtraImage("当前要求：这是一张宽屏横幅插画，适合作为详情页背景，角色处于画面右侧，左侧留白。");
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
    const outGuide = await generateExtraImage("当前要求：这是一张赞赏引导图横幅，角色做出期待、可怜或感谢的动作，右侧留出空白区域。");
    const rewardGuide = await toBannerPng(outGuide.bytes);
    rewardGuideAssetId = nanoid();
    saveAssetPng(app, rewardGuide, rewardGuideAssetId);
    const rewardGuideValidation = await validateAsset(app, "wechat_reward_guide", rewardGuideAssetId);
    if (!rewardGuideValidation.ok) throw createHttpError(400, "wechat reward guide validation failed");
    emit?.("extra", { key: "rewardGuideAssetId", assetId: rewardGuideAssetId, url: `/api/assets/${rewardGuideAssetId}` });

    if (isCanceled?.()) throw createHttpError(499, "生成任务已取消");
    emit?.("progress", { phase: "extras", label: "赞赏感谢图" });
    const outThanks = await generateExtraImage("当前要求：这是一张感谢打赏的横幅插画，角色非常开心、欢呼撒花，横幅比例。");
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
