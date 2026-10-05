import fs from "node:fs";
import createHttpError from "http-errors";
import { nanoid } from "nanoid";
import type { AssetStore } from "../../lib/assets";
import { validateAsset } from "../platform/validate";
import { getPlatformPreset, resolveTargetSize } from "../platform/presets";
import { getAiProvider } from "../ai";
import { buildMinimalClient } from "../ai/client";
import type { AiReferenceImage } from "../ai/provider";
import { loadPromptConfig, compilePrompt } from "./promptConfig";
import { convertToPlatformFormat, toBannerPng, toRewardPng } from "./convert";

export type ExtraAssetKey =
  | "coverAssetId"
  | "iconAssetId"
  | "bannerAssetId"
  | "rewardGuideAssetId"
  | "rewardThanksAssetId";

export type ResourceTarget =
  | { kind: "sticker"; index: number }
  | { kind: "extra"; key: ExtraAssetKey };

export type ResourceGenerateRequest = {
  referenceAssetId: string;
  prompt: string;
  provider?: string;
  styles?: string[];
  target: ResourceTarget;
  metadata?: { rewardMessage?: string };
  /** regenerate：按原始上下文重生成；edit：以 sourceAssetId 为参考图做编辑图片。 */
  mode?: "regenerate" | "edit";
  sourceAssetId?: string;
  instruction?: string;
  /** 编辑时额外提供的一张参考图（与待修改的图一起送给模型）。 */
  editReferenceAssetId?: string;
};

export type ResourceGenerateResult = {
  target: ResourceTarget;
  assetId: string;
  url: string;
  prompt: string;
  label?: string;
  key?: ExtraAssetKey;
  /** 本次使用的风格/情绪，以及最终落盘尺寸，便于写回 pack 的 metadata.json。 */
  style?: string;
  emotion?: string;
  targetSize?: { width: number; height: number };
};

type ExtraSpec = {
  promptKey: "cover" | "icon" | "banner" | "rewardGuide" | "rewardThanks";
  validatePreset: string;
  convert: (buf: Buffer) => Promise<Buffer>;
  label: string;
  size: { width: number; height: number };
};

const EXTRA_SPECS: Record<ExtraAssetKey, ExtraSpec> = {
  coverAssetId: {
    promptKey: "cover",
    validatePreset: "wechat_cover",
    convert: (b) => convertToPlatformFormat(b, "wechat_stickers", 240, 240),
    label: "表情封面图",
    size: { width: 240, height: 240 }
  },
  iconAssetId: {
    promptKey: "icon",
    validatePreset: "wechat_icon",
    convert: (b) => convertToPlatformFormat(b, "wechat_stickers", 50, 50),
    label: "聊天面板图标",
    size: { width: 50, height: 50 }
  },
  bannerAssetId: {
    promptKey: "banner",
    validatePreset: "wechat_banner",
    convert: (b) => toBannerPng(b),
    label: "详情页横幅",
    size: { width: 750, height: 400 }
  },
  rewardGuideAssetId: {
    promptKey: "rewardGuide",
    validatePreset: "wechat_reward_guide",
    convert: (b) => toRewardPng(b),
    label: "赞赏引导图",
    size: { width: 750, height: 560 }
  },
  rewardThanksAssetId: {
    promptKey: "rewardThanks",
    validatePreset: "wechat_reward_thanks",
    convert: (b) => toRewardPng(b),
    label: "赞赏感谢图",
    size: { width: 750, height: 560 }
  }
};

export function isExtraAssetKey(key: string): key is ExtraAssetKey {
  return Object.prototype.hasOwnProperty.call(EXTRA_SPECS, key);
}

function mimeFromFilename(filename: string): string {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".gif")) return "image/gif";
  return "image/png";
}

/**
 * 只重生成一张资源（贴纸或扩展资源），复用与整包生成相同的提示词模板、
 * 输出尺寸与平台校验。`mode="edit"` 时以 sourceAssetId 作为参考图，
 * instruction 追加到提示词中，用于后续的编辑/优化能力。
 */
export async function generateSingleResource(
  assetStore: AssetStore,
  presetId: string,
  req: ResourceGenerateRequest
): Promise<ResourceGenerateResult> {
  const preset = getPlatformPreset(presetId);
  if (!preset) throw createHttpError(400, `unknown presetId: ${presetId}`);

  const promptConfig = loadPromptConfig();
  const styles = (req.styles?.filter(Boolean) ?? []).length ? (req.styles!.filter(Boolean) as string[]) : ["默认"];
  const providerId = req.provider ?? promptConfig.ai?.defaultProvider ?? "mock";
  const provider = getAiProvider(providerId);
  const client = buildMinimalClient(provider);

  const reference = assetStore.find(req.referenceAssetId);
  if (!reference) throw createHttpError(404, "reference asset not found");

  const referenceMode = promptConfig.ai?.referenceMode ?? "base64";
  const baseUrl = promptConfig.ai?.publicBaseUrl || "";
  const assetUrl = (id: string) => (baseUrl ? `${baseUrl.replace(/\/+$/, "")}/api/assets/${id}` : undefined);

  let referenceAssetId = req.referenceAssetId;
  let referenceBase64 = fs.readFileSync(reference.filePath).toString("base64");
  let referenceUrl = assetUrl(referenceAssetId);
  let referenceMime = mimeFromFilename(reference.filename);

  // 编辑模式：把「源资源」当作参考图。
  const isEdit = req.mode === "edit" && Boolean(req.sourceAssetId);
  if (isEdit) {
    const source = assetStore.find(req.sourceAssetId!);
    if (!source) throw createHttpError(404, "source asset not found");
    referenceAssetId = req.sourceAssetId!;
    referenceBase64 = fs.readFileSync(source.filePath).toString("base64");
    referenceUrl = assetUrl(referenceAssetId);
    referenceMime = mimeFromFilename(source.filename);
  }

  // 附加参考图（可选）：编辑时除「待修改的这张」外，再给模型一张参考图，
  // 例如「把这个人换成另一张图里的角色」。多图只有部分模型支持，单图路径不变。
  const additionalReferenceImages: AiReferenceImage[] = [];
  if (req.editReferenceAssetId && req.editReferenceAssetId !== referenceAssetId) {
    const extra = assetStore.find(req.editReferenceAssetId);
    if (!extra) throw createHttpError(404, "edit reference asset not found");
    const extraMime = mimeFromFilename(extra.filename);
    const extraUrl = assetUrl(req.editReferenceAssetId);
    if (referenceMode === "url" && extraUrl) {
      additionalReferenceImages.push({ url: extraUrl, mime: extraMime });
    } else {
      additionalReferenceImages.push({
        base64: fs.readFileSync(extra.filePath).toString("base64"),
        mime: extraMime
      });
    }
  }

  const imageWidth = promptConfig.ai?.imageSize?.width ?? 1024;
  const imageHeight = promptConfig.ai?.imageSize?.height ?? 1024;

  const editSuffix = isEdit && req.instruction ? `\n编辑要求：${req.instruction}` : "";
  // 第 1 张是待修改的图，附加参考图排在后面 —— 得让模型知道顺序，否则容易改错对象
  const extraRefHint = additionalReferenceImages.length
    ? "\n参考图说明：除第 1 张待修改的图片外，另附一张参考图，请参考其中的主体形象与风格进行修改。"
    : "";
  const basePrompt = `${req.prompt}${editSuffix}${extraRefHint}`;

  let compiledPrompt: string;
  let convert: (buf: Buffer) => Promise<Buffer>;
  let validatePreset: string;
  let label: string | undefined;
  let targetKey: ExtraAssetKey | undefined;
  let saveExt = "png";
  let usedStyle: string | undefined;
  let usedEmotion: string | undefined;
  let targetSize: { width: number; height: number } | undefined;

  if (req.target.kind === "sticker") {
    const index = req.target.index;
    const emotions = promptConfig.emotions;
    if (!emotions.length) throw createHttpError(500, "emotions 未配置");
    const emotion = emotions[index % emotions.length];
    const style = styles[index % styles.length];
    compiledPrompt = compilePrompt(promptConfig.templates.sticker, {
      prompt: basePrompt,
      emotion,
      style
    });
    const { width, height } = resolveTargetSize(preset);
    convert = (buf) => convertToPlatformFormat(buf, presetId, width, height);
    validatePreset = presetId;
    label = String(index + 1).padStart(3, "0");
    saveExt = presetId === "whatsapp_webp" ? "webp" : "png";
    usedStyle = style;
    usedEmotion = emotion;
    targetSize = { width, height };
  } else {
    const spec = EXTRA_SPECS[req.target.key];
    targetKey = req.target.key;
    const style = styles[0];
    compiledPrompt = compilePrompt(promptConfig.templates.extra, {
      prompt: basePrompt,
      customPrompt: promptConfig.extraPrompts[spec.promptKey],
      style
    });
    convert = spec.convert;
    validatePreset = spec.validatePreset;
    label = spec.label;
    usedStyle = style;
    targetSize = spec.size;
  }

  const out = await client.generateImage({
    prompt: compiledPrompt,
    negativePrompt: promptConfig.global.negativePrompt,
    style: styles[0],
    width: imageWidth,
    height: imageHeight,
    referenceImageTransport: referenceMode as "base64" | "url" | "assetId" | "multipart",
    referenceImageBase64:
      referenceMode === "base64" || referenceMode === "multipart" ? referenceBase64 : undefined,
    referenceImageUrl: referenceMode === "url" ? referenceUrl : undefined,
    referenceImageMime: referenceMime,
    referenceImageAssetId: referenceMode === "assetId" ? referenceAssetId : undefined,
    ...(additionalReferenceImages.length ? { additionalReferenceImages } : {})
  });

  const converted = await convert(out.bytes);
  const id = nanoid();
  assetStore.save(converted, id, saveExt);

  const validation = await validateAsset(assetStore, validatePreset, id);
  if (!validation.ok) {
    throw createHttpError(400, `${validatePreset} validation failed: ${validation.issues.map((i) => i.message).join("; ")}`);
  }

  return {
    target: req.target,
    assetId: id,
    url: `/api/assets/${id}`,
    prompt: compiledPrompt,
    label,
    key: targetKey,
    // 编辑模式：记录这次是从哪一张改过来的、用了哪张附加参考图
    ...(isEdit && req.sourceAssetId ? { sourceAssetId: req.sourceAssetId } : {}),
    ...(isEdit && req.editReferenceAssetId ? { editReferenceAssetId: req.editReferenceAssetId } : {}),
    ...(usedStyle ? { style: usedStyle } : {}),
    ...(usedEmotion ? { emotion: usedEmotion } : {}),
    ...(targetSize ? { targetSize } : {})
  };
}
