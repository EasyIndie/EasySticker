import createHttpError from "http-errors";
import { nanoid } from "nanoid";
import type { AssetStore } from "../../lib/assets";
import { validateAsset } from "../platform/validate";
import { compilePrompt, type PromptConfig } from "./promptConfig";
import { convertToPlatformFormat, toBannerPng } from "./convert";
import type { AiGenerateInput, AiGenerateOutput } from "../ai/provider";

type ImageClient = {
  generateImage(input: AiGenerateInput, signal?: AbortSignal): Promise<AiGenerateOutput>;
};

export type ExtrasContext = {
  assetStore: AssetStore;
  presetId: string;
  client: ImageClient;
  promptConfig: PromptConfig;
  prompt: string;
  styles: string[];
  referenceMode: "base64" | "url" | "assetId" | "multipart";
  referenceBase64: string;
  referenceUrl?: string;
  referenceImageAssetId?: string;
  providerComfyOptions?: Record<string, unknown>;
  emit?: (event: string, data: unknown) => void;
  isCanceled?: () => boolean;
  signal?: AbortSignal;
};

export type ExtrasOptions = {
  includeCover?: boolean;
  includeIcon?: boolean;
  includeBanner?: boolean;
  enableReward?: boolean;
  currentGenerated: number;
  totalImageCount: number;
};

export type ExtrasResult = {
  coverAssetId?: string;
  iconAssetId?: string;
  bannerAssetId?: string;
  rewardGuideAssetId?: string;
  rewardThanksAssetId?: string;
  currentGenerated: number;
};

/** Generate WeChat-specific extra assets (cover/icon/banner/reward). */
export async function generateWechatExtras(ctx: ExtrasContext, opts: ExtrasOptions): Promise<ExtrasResult> {
  let currentGenerated = opts.currentGenerated;
  const total = opts.totalImageCount;

  const throwIfCanceled = () => {
    if (ctx.signal?.aborted || ctx.isCanceled?.()) throw createHttpError(499, "生成任务已取消");
  };

  const generateExtraImage = async (customPrompt: string) => {
    throwIfCanceled();
    const style = ctx.styles[0]!;
    const compiledPrompt = compilePrompt(ctx.promptConfig.templates.extra, {
      prompt: ctx.prompt,
      customPrompt,
      style
    });

    const res = await ctx.client.generateImage(
      {
        prompt: compiledPrompt,
        negativePrompt: ctx.promptConfig.global.negativePrompt,
        style,
        width: ctx.promptConfig.ai?.imageSize?.width ?? 1024,
        height: ctx.promptConfig.ai?.imageSize?.height ?? 1024,
        referenceImageTransport: ctx.referenceMode,
        referenceImageBase64:
          ctx.referenceMode === "base64" || ctx.referenceMode === "multipart" ? ctx.referenceBase64 : undefined,
        referenceImageUrl: ctx.referenceMode === "url" ? ctx.referenceUrl : undefined,
        referenceImageMime: "image/png",
        referenceImageAssetId: ctx.referenceMode === "assetId" ? ctx.referenceImageAssetId : undefined,
        providerOptions: ctx.providerComfyOptions ? { comfy: ctx.providerComfyOptions } : undefined
      },
      ctx.signal
    );
    throwIfCanceled();
    return { ...res, prompt: compiledPrompt };
  };

  const result: ExtrasResult = { currentGenerated };

  if (opts.includeCover) {
    throwIfCanceled();
    ctx.emit?.("progress", { phase: "extras", label: "表情封面图", current: currentGenerated + 1, total });
    const out = await generateExtraImage(ctx.promptConfig.extraPrompts.cover);
    const cover = await convertToPlatformFormat(out.bytes, ctx.presetId, 240, 240);
    const id = nanoid();
    ctx.assetStore.save(cover, id);
    const v = await validateAsset(ctx.assetStore, "wechat_cover", id);
    if (!v.ok) throw createHttpError(400, "wechat cover validation failed");
    result.coverAssetId = id;
    currentGenerated++;
    ctx.emit?.("extra", {
      key: "coverAssetId",
      assetId: id,
      url: `/api/assets/${id}`,
      prompt: out.prompt,
      current: currentGenerated,
      total
    });
  }

  if (opts.includeIcon) {
    throwIfCanceled();
    ctx.emit?.("progress", { phase: "extras", label: "聊天面板图标", current: currentGenerated + 1, total });
    const out = await generateExtraImage(ctx.promptConfig.extraPrompts.icon);
    const icon = await convertToPlatformFormat(out.bytes, ctx.presetId, 50, 50);
    const id = nanoid();
    ctx.assetStore.save(icon, id);
    const v = await validateAsset(ctx.assetStore, "wechat_icon", id);
    if (!v.ok) throw createHttpError(400, "wechat icon validation failed");
    result.iconAssetId = id;
    currentGenerated++;
    ctx.emit?.("extra", {
      key: "iconAssetId",
      assetId: id,
      url: `/api/assets/${id}`,
      prompt: out.prompt,
      current: currentGenerated,
      total
    });
  }

  if (opts.includeBanner) {
    throwIfCanceled();
    ctx.emit?.("progress", { phase: "extras", label: "详情页横幅", current: currentGenerated + 1, total });
    const out = await generateExtraImage(ctx.promptConfig.extraPrompts.banner);
    const banner = await toBannerPng(out.bytes);
    const id = nanoid();
    ctx.assetStore.save(banner, id);
    const v = await validateAsset(ctx.assetStore, "wechat_banner", id);
    if (!v.ok) throw createHttpError(400, "wechat banner validation failed");
    result.bannerAssetId = id;
    currentGenerated++;
    ctx.emit?.("extra", {
      key: "bannerAssetId",
      assetId: id,
      url: `/api/assets/${id}`,
      prompt: out.prompt,
      current: currentGenerated,
      total
    });
  }

  if (opts.enableReward) {
    throwIfCanceled();
    ctx.emit?.("progress", { phase: "extras", label: "赞赏引导图", current: currentGenerated + 1, total });
    const outGuide = await generateExtraImage(ctx.promptConfig.extraPrompts.rewardGuide);
    const rewardGuide = await toBannerPng(outGuide.bytes);
    const guideId = nanoid();
    ctx.assetStore.save(rewardGuide, guideId);
    const guideValidation = await validateAsset(ctx.assetStore, "wechat_reward_guide", guideId);
    if (!guideValidation.ok) throw createHttpError(400, "wechat reward guide validation failed");
    result.rewardGuideAssetId = guideId;
    currentGenerated++;
    ctx.emit?.("extra", {
      key: "rewardGuideAssetId",
      assetId: guideId,
      url: `/api/assets/${guideId}`,
      prompt: outGuide.prompt,
      current: currentGenerated,
      total
    });

    throwIfCanceled();
    ctx.emit?.("progress", { phase: "extras", label: "赞赏感谢图", current: currentGenerated + 1, total });
    const outThanks = await generateExtraImage(ctx.promptConfig.extraPrompts.rewardThanks);
    const rewardThanks = await toBannerPng(outThanks.bytes);
    const thanksId = nanoid();
    ctx.assetStore.save(rewardThanks, thanksId);
    const thanksValidation = await validateAsset(ctx.assetStore, "wechat_reward_thanks", thanksId);
    if (!thanksValidation.ok) throw createHttpError(400, "wechat reward thanks validation failed");
    result.rewardThanksAssetId = thanksId;
    currentGenerated++;
    ctx.emit?.("extra", {
      key: "rewardThanksAssetId",
      assetId: thanksId,
      url: `/api/assets/${thanksId}`,
      prompt: outThanks.prompt,
      current: currentGenerated,
      total
    });
  }

  result.currentGenerated = currentGenerated;
  return result;
}
