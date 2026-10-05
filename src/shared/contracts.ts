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

/** 单资源重生成目标：一张贴纸（按索引）或一张扩展资源（按 key）。 */
export const resourceTargetSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("sticker"), index: z.number().int().min(0) }),
  z.object({
    kind: z.literal("extra"),
    key: z.enum([
      "coverAssetId",
      "iconAssetId",
      "bannerAssetId",
      "rewardGuideAssetId",
      "rewardThanksAssetId"
    ])
  })
]);
export type ResourceTarget = z.infer<typeof resourceTargetSchema>;

/**
 * POST /api/generate/resource — 只重生成一张资源。
 * mode="regenerate" 按原始上下文重生成；mode="edit" 以 sourceAssetId 为参考图、
 * instruction 为指令做二次编辑/优化（为后续编辑能力预留）。
 */
export const resourceSchema = z.object({
  presetId: z.string().min(1).default("wechat_stickers"),
  referenceAssetId: z.string().min(1),
  prompt: z.string().min(1),
  provider: z.string().optional(),
  styles: z.array(z.string().min(1)).optional(),
  stickerCount: z.number().int().min(1).max(50).optional(),
  metadata: metadataSchema.optional(),
  target: resourceTargetSchema,
  mode: z.enum(["regenerate", "edit"]).default("regenerate"),
  sourceAssetId: z.string().min(1).optional(),
  instruction: z.string().min(1).optional()
});
export type ResourceGenerateRequest = z.infer<typeof resourceSchema>;

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

/* ===== Auth ===== */

/** POST /api/auth/login */
export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6)
});
export type LoginRequest = z.infer<typeof loginSchema>;

/** POST /api/auth/register */
export const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  adminToken: z.string().optional()
});
export type RegisterRequest = z.infer<typeof registerSchema>;

/** Authenticated user shape shared by login/register responses. */
export const authUserSchema = z.object({
  email: z.string().email(),
  role: z.enum(["admin", "user"])
});
export type AuthUser = z.infer<typeof authUserSchema>;

/** { token, user } returned by login/register. */
export const authResponseSchema = z.object({
  token: z.string(),
  user: authUserSchema
});
export type AuthResponse = z.infer<typeof authResponseSchema>;

/** GET /api/auth/quota */
export const quotaResponseSchema = z.object({
  allowed: z.boolean(),
  used: z.number(),
  remaining: z.number()
});
export type QuotaResponse = z.infer<typeof quotaResponseSchema>;
