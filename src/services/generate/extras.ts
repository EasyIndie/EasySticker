import createHttpError from "http-errors";
import { nanoid } from "nanoid";
import type { AssetStore } from "../../lib/assets";
import { validateAsset } from "../platform/validate";
import { type PromptConfig } from "./promptConfig";
import { buildExtraPrompt } from "./promptBuilder";
import { convertToPlatformFormat, toBannerPng, toRewardPng } from "./convert";
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
  referenceMode: "base64" | "url" | "multipart" | "none";
  referenceBase64?: string;
  referenceUrl?: string;
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

export type ExtraAssetKey =
  | "coverAssetId"
  | "iconAssetId"
  | "bannerAssetId"
  | "rewardGuideAssetId"
  | "rewardThanksAssetId";

export type ExtrasResult = {
  coverAssetId?: string;
  iconAssetId?: string;
  bannerAssetId?: string;
  rewardGuideAssetId?: string;
  rewardThanksAssetId?: string;
  /** 单张资源生成失败时记录原因，其余资源继续生成，不再中断整包。 */
  failures: Partial<Record<ExtraAssetKey, string>>;
  /** 每张扩展资源实际使用的提示词/风格，写入 metadata.json 供编辑图片。 */
  details: Partial<Record<ExtraAssetKey, { prompt: string; style: string }>>;
  currentGenerated: number;
};

type ExtraJob = {
  key: ExtraAssetKey;
  label: string;
  enabled: boolean;
  promptKey: "cover" | "icon" | "banner" | "rewardGuide" | "rewardThanks";
  validatePreset: string;
  convert: (buf: Buffer) => Promise<Buffer>;
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
    const compiledPrompt = buildExtraPrompt(ctx.promptConfig, {
      prompt: ctx.prompt,
      requirement: customPrompt,
      style
    });

    const res = await ctx.client.generateImage(
      {
        prompt: compiledPrompt,
        negativePrompt: ctx.promptConfig.global.negativePrompt,
        style,
        width: ctx.promptConfig.ai?.imageSize?.width ?? 1024,
        height: ctx.promptConfig.ai?.imageSize?.height ?? 1024,
        referenceImageBase64:
          ctx.referenceMode === "base64" || ctx.referenceMode === "multipart" ? ctx.referenceBase64 : undefined,
        referenceImageUrl: ctx.referenceMode === "url" ? ctx.referenceUrl : undefined,
        referenceImageMime: "image/png"
      },
      ctx.signal
    );
    throwIfCanceled();
    return { ...res, prompt: compiledPrompt, style };
  };

  const jobs: ExtraJob[] = [
    {
      key: "coverAssetId",
      label: "表情封面图",
      enabled: !!opts.includeCover,
      promptKey: "cover",
      validatePreset: "wechat_cover",
      convert: (b) => convertToPlatformFormat(b, ctx.presetId, 240, 240)
    },
    {
      key: "iconAssetId",
      label: "聊天面板图标",
      enabled: !!opts.includeIcon,
      promptKey: "icon",
      validatePreset: "wechat_icon",
      convert: (b) => convertToPlatformFormat(b, ctx.presetId, 50, 50)
    },
    {
      key: "bannerAssetId",
      label: "详情页横幅",
      enabled: !!opts.includeBanner,
      promptKey: "banner",
      validatePreset: "wechat_banner",
      convert: (b) => toBannerPng(b)
    },
    {
      key: "rewardGuideAssetId",
      label: "赞赏引导图",
      enabled: !!opts.enableReward,
      promptKey: "rewardGuide",
      validatePreset: "wechat_reward_guide",
      convert: (b) => toRewardPng(b)
    },
    {
      key: "rewardThanksAssetId",
      label: "赞赏感谢图",
      enabled: !!opts.enableReward,
      promptKey: "rewardThanks",
      validatePreset: "wechat_reward_thanks",
      convert: (b) => toRewardPng(b)
    }
  ];

  const result: ExtrasResult = { failures: {}, details: {}, currentGenerated };

  for (const job of jobs) {
    if (!job.enabled) continue;
    throwIfCanceled();
    ctx.emit?.("progress", { phase: "extras", label: job.label, current: currentGenerated + 1, total });
    try {
      const out = await generateExtraImage(ctx.promptConfig.extraPrompts[job.promptKey]);
      const converted = await job.convert(out.bytes);
      const id = nanoid();
      ctx.assetStore.save(converted, id);
      const validation = await validateAsset(ctx.assetStore, job.validatePreset, id);
      if (!validation.ok) {
        throw createHttpError(400, `${job.validatePreset} validation failed: ${validation.issues.map((i) => i.message).join("; ")}`);
      }
      result[job.key] = id;
      result.details[job.key] = { prompt: out.prompt, style: out.style };
      currentGenerated++;
      ctx.emit?.("extra", {
        key: job.key,
        assetId: id,
        url: `/api/assets/${id}`,
        prompt: out.prompt,
        style: out.style,
        current: currentGenerated,
        total
      });
    } catch (error) {
      // 取消：中断整个任务；其余失败：记录原因后继续，让整包仍可产出，
      // 前端会为该资源显示失败卡片并支持单资源重生成。
      if ((error as { statusCode?: number })?.statusCode === 499) throw error;
      const message = error instanceof Error ? error.message : "生成失败";
      result.failures[job.key] = message;
      currentGenerated++;
      ctx.emit?.("extra", { key: job.key, assetId: null, error: message, current: currentGenerated, total });
    }
  }

  result.currentGenerated = currentGenerated;
  return result;
}
