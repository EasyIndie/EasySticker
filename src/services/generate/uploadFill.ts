import createHttpError from "http-errors";
import { nanoid } from "nanoid";
import sharp from "sharp";
import type { AssetStore } from "../../lib/assets";
import { getPlatformPreset, resolveTargetSize } from "../platform/presets";
import { validateAsset } from "../platform/validate";
import { convertToPlatformFormat } from "./convert";

/**
 * 「补齐」支持直接上传成品图。上传的图片不能原样塞进包：
 * - 主图必须符合当前平台尺寸 / 格式（微信 240×240 PNG、WhatsApp 512×512 WebP 等）；
 * - 封面 / 图标 / 横幅 / 赞赏图各有固定尺寸；
 * - 作为 AI 参考图时统一转成 PNG，避免不同模型对 WebP / GIF 支持不一致。
 */
export type UploadFillRole =
  | "sticker"
  | "cover"
  | "icon"
  | "banner"
  | "reward-guide"
  | "reward-thanks"
  | "reference";

const UPLOAD_FILL_ROLES = new Set<UploadFillRole>([
  "sticker",
  "cover",
  "icon",
  "banner",
  "reward-guide",
  "reward-thanks",
  "reference"
]);

export const UPLOAD_FILL_MIMES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

export function parseUploadFillRole(value: unknown): UploadFillRole | null {
  if (typeof value !== "string") return null;
  return UPLOAD_FILL_ROLES.has(value as UploadFillRole) ? (value as UploadFillRole) : null;
}

type ExtraUploadSpec = {
  presetId: string;
  width: number;
  height: number;
  fit: "contain" | "cover";
};

const EXTRA_UPLOAD_SPECS: Record<Exclude<UploadFillRole, "sticker" | "reference">, ExtraUploadSpec> = {
  cover: { presetId: "wechat_cover", width: 240, height: 240, fit: "contain" },
  icon: { presetId: "wechat_icon", width: 50, height: 50, fit: "contain" },
  banner: { presetId: "wechat_banner", width: 750, height: 400, fit: "cover" },
  "reward-guide": { presetId: "wechat_reward_guide", width: 750, height: 560, fit: "cover" },
  "reward-thanks": { presetId: "wechat_reward_thanks", width: 750, height: 560, fit: "cover" }
};

function isExtraRole(role: UploadFillRole): role is keyof typeof EXTRA_UPLOAD_SPECS {
  return role in EXTRA_UPLOAD_SPECS;
}

async function toFixedPng(
  input: Buffer,
  width: number,
  height: number,
  fit: "contain" | "cover"
): Promise<Buffer> {
  return sharp(input, { animated: false })
    .rotate()
    .ensureAlpha()
    .resize(width, height, {
      fit,
      background: { r: 0, g: 0, b: 0, alpha: 0 }
    })
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer();
}

/** 参考图只用于 AI 生成，不要求平台规格；限制最大边避免把超大原图直接送进模型。 */
async function toReferencePng(input: Buffer): Promise<Buffer> {
  return sharp(input, { animated: false })
    .rotate()
    .ensureAlpha()
    .resize({ width: 1024, height: 1024, fit: "inside", withoutEnlargement: true })
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer();
}

export async function saveUploadFillAsset(
  assetStore: AssetStore,
  bytes: Buffer,
  presetId: string,
  role: UploadFillRole
) {
  const assetId = nanoid();
  let output: Buffer;
  let ext = "png";
  let validatePresetId: string | null = null;

  if (role === "reference") {
    output = await toReferencePng(bytes);
  } else if (role === "sticker") {
    const preset = getPlatformPreset(presetId);
    if (!preset) throw createHttpError(400, `unknown presetId: ${presetId}`);
    const target = resolveTargetSize(preset);
    const rotated = await sharp(bytes, { animated: false }).rotate().ensureAlpha().toBuffer();
    output = await convertToPlatformFormat(rotated, presetId, target.width, target.height);
    ext = preset.outputFormat === "webp" ? "webp" : "png";
    validatePresetId = presetId;
  } else if (isExtraRole(role)) {
    const spec = EXTRA_UPLOAD_SPECS[role];
    output = await toFixedPng(bytes, spec.width, spec.height, spec.fit);
    validatePresetId = spec.presetId;
  } else {
    throw createHttpError(400, "unknown upload role");
  }

  assetStore.save(output, assetId, ext);

  if (validatePresetId) {
    const validation = await validateAsset(assetStore, validatePresetId, assetId);
    if (!validation.ok) {
      const detail = validation.issues.map((issue) => issue.message).join("; ");
      throw createHttpError(400, `图片不符合 ${validatePresetId} 规格：${detail}`);
    }
  }

  return {
    assetId,
    url: `/api/assets/${assetId}`,
    role,
    presetId: role === "reference" ? presetId : validatePresetId ?? presetId,
    format: ext
  };
}
