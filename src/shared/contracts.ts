import { z } from "zod";

/**
 * Shared API contracts.
 *
 * These schemas are the single source of truth for request payload shapes and
 * are shared between route registrars and (later) generated client types. Keep
 * them framework-agnostic: they depend only on zod, not on Fastify.
 */

export const metadataSchema = z.object({
  title: z.string().min(1).optional(),
  author: z.string().min(1).optional(),
  copyright: z.string().min(1).optional(),
  version: z.string().min(1).optional(),
  rewardMessage: z.string().min(1).optional()
});

/** POST /api/generate/prompt */
export const promptSchema = z.object({
  referenceAssetId: z.string().min(1),
  presetId: z.string().min(1).default("wechat_stickers")
});
export type PromptRequest = z.infer<typeof promptSchema>;

/** POST /api/generate/start */
export const generateSchema = z.object({
  presetId: z.string().min(1).default("wechat_stickers"),
  referenceAssetId: z.string().min(1),
  prompt: z.string().min(1),
  provider: z.string().optional(),
  styles: z.array(z.string().min(1)).optional(),
  stickerCount: z.number().int().min(1).max(50).optional(),
  enableReward: z.boolean().optional(),
  includeCover: z.boolean().optional(),
  includeIcon: z.boolean().optional(),
  includeBanner: z.boolean().optional(),
  metadata: metadataSchema.optional()
});
export type GenerateRequest = z.infer<typeof generateSchema>;

/** POST /api/generate/cancel */
export const cancelSchema = z.object({
  taskId: z.string().min(1)
});
export type CancelRequest = z.infer<typeof cancelSchema>;

/** POST /api/packs */
export const packSchema = z.object({
  presetId: z.string().min(1),
  assetIds: z.array(z.string().min(1)).optional(),
  assets: z
    .array(
      z.object({
        label: z.string().min(1),
        assetId: z.string().min(1)
      })
    )
    .optional(),
  coverAssetId: z.string().min(1).optional(),
  bannerAssetId: z.string().min(1).optional(),
  iconAssetId: z.string().min(1).optional(),
  rewardGuideAssetId: z.string().min(1).optional(),
  rewardThanksAssetId: z.string().min(1).optional(),
  metadata: metadataSchema.optional()
});
export type PackRequest = z.infer<typeof packSchema>;
