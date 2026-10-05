import fs from "node:fs";
import path from "node:path";
import createHttpError from "http-errors";
import archiver from "archiver";
import { nanoid } from "nanoid";
import sharp from "sharp";
import type { AssetStore } from "../../lib/assets";

/** 包内每个文件的角色。 */
export type PackFileRole =
  | "sticker"
  | "cover"
  | "icon"
  | "banner"
  | "reward-guide"
  | "reward-thanks"
  /** 生成时使用的参考图（源素材，不是交付资源）。 */
  | "reference";

/** 打包入参中的一张贴纸（可携带它的生成上下文）。 */
export type PackAssetInput = {
  label: string;
  assetId: string;
  role?: PackFileRole;
  /** 该张图实际使用的完整提示词（编译后）。 */
  prompt?: string;
  /** 该张图使用的风格。 */
  style?: string;
  /** 该张图使用的情绪。 */
  emotion?: string;
  /** 二次编辑时这张图的来源资源。 */
  sourceAssetId?: string;
};

/**
 * 生成上下文：记录「这套图是怎么生成的」，让 ZIP 重新导入后可以还原提示词、
 * 风格、尺寸与参考图，从而继续做二次编辑/优化。
 */
export type PackGenerationInfo = {
  source?: "ai-generate" | "import";
  providerId?: string;
  model?: string;
  prompt?: string;
  negativePrompt?: string;
  styles?: string[];
  stickerCount?: number;
  emotions?: string[];
  /** 生图模型请求的尺寸。 */
  imageSize?: { width: number; height: number };
  /** 落地到平台的最终尺寸（单张贴纸）。 */
  targetSize?: { width: number; height: number };
  referenceAssetId?: string | null;
  referenceMode?: string;
  /** 本次实际包含的扩展资源。 */
  include?: { cover?: boolean; icon?: boolean; banner?: boolean; reward?: boolean };
  createdAt?: string;
};

export type PackRequest = {
  presetId: string;
  assetIds?: string[];
  assets?: PackAssetInput[];
  coverAssetId?: string;
  bannerAssetId?: string;
  iconAssetId?: string;
  rewardGuideAssetId?: string;
  rewardThanksAssetId?: string;
  /** 生成时使用的参考图；有则一并打进 `source/`，便于完整还原。 */
  referenceAssetId?: string;
  metadata?: {
    title?: string;
    author?: string;
    copyright?: string;
    version?: string;
    rewardMessage?: string;
  };
  generation?: PackGenerationInfo;
  /** 每张扩展资源（cover/icon/banner/reward-*）的生成细节。 */
  extraDetails?: Partial<
    Record<PackFileRole, { prompt?: string; style?: string; sourceAssetId?: string }>
  >;
};

export type PackInfo = {
  packId: string;
  downloadFilename: string;
};

/** metadata.json 中每个文件的完整描述（名称、尺寸、用途、生成信息）。 */
export type PackFileMetadata = {
  role: PackFileRole;
  label?: string;
  assetId: string;
  filename: string;
  zipPath: string;
  width: number | null;
  height: number | null;
  format: string | null;
  mimeType: string | null;
  bytes: number | null;
  prompt?: string;
  style?: string;
  emotion?: string;
  sourceAssetId?: string;
};

export type PackMetadata = {
  schema: string;
  packId: string;
  presetId: string;
  createdAt: string;
  metadata: {
    title?: string;
    author?: string;
    copyright?: string;
    version?: string;
    rewardMessage?: string;
  };
  generation?: PackGenerationInfo;
  extras: {
    coverAssetId: string | null;
    bannerAssetId: string | null;
    iconAssetId: string | null;
    rewardGuideAssetId: string | null;
    rewardThanksAssetId: string | null;
  };
  /** 包内完整文件清单（贴纸 + 扩展资源），含尺寸与生成信息。 */
  files: PackFileMetadata[];
  /** 兼容旧格式：只含贴纸的最简清单。 */
  assets: Array<{ assetId: string; filename: string; zipPath: string }>;
};

type FileFacts = {
  width: number | null;
  height: number | null;
  format: string | null;
  mimeType: string | null;
  bytes: number | null;
};

function packsDir(dataDir: string) {
  return path.join(dataDir, "packs");
}

function sanitizeFilenamePart(input: string) {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/gi, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
}

function buildDownloadFilename(req: PackRequest, packId: string) {
  const base = sanitizeFilenamePart(req.metadata?.title || "");
  return `${base || req.presetId || "easysticker-pack"}-${packId}.zip`;
}

function packInfoPath(dataDir: string, packId: string) {
  return path.join(packsDir(dataDir), `${packId}.json`);
}

/** 读取图片尺寸/格式/体积；失败时返回 null 而不是中断打包。 */
async function readFileFacts(filePath: string): Promise<FileFacts> {
  try {
    const bytes = fs.statSync(filePath).size;
    const meta = await sharp(filePath).metadata();
    const format = meta.format ?? null;
    return {
      width: meta.width ?? null,
      height: meta.height ?? null,
      format,
      mimeType: format ? `image/${format === "jpg" ? "jpeg" : format}` : null,
      bytes
    };
  } catch {
    return { width: null, height: null, format: null, mimeType: null, bytes: null };
  }
}

/** 生成侧的 assetId 字段名 → metadata.json 文件 role。 */
export const EXTRA_ASSET_KEY_TO_ROLE: Record<string, PackFileRole> = {
  coverAssetId: "cover",
  iconAssetId: "icon",
  bannerAssetId: "banner",
  rewardGuideAssetId: "reward-guide",
  rewardThanksAssetId: "reward-thanks"
};

/** 扩展资源在包内的固定命名与顺序。 */
const EXTRA_FILES: Array<{ role: PackFileRole; field: keyof PackRequest }> = [
  { role: "cover", field: "coverAssetId" },
  { role: "banner", field: "bannerAssetId" },
  { role: "icon", field: "iconAssetId" },
  { role: "reward-guide", field: "rewardGuideAssetId" },
  { role: "reward-thanks", field: "rewardThanksAssetId" }
];

export async function buildZipPack(assetStore: AssetStore, dataDir: string, req: PackRequest) {
  const normalizedAssets: PackAssetInput[] =
    req.assets && req.assets.length
      ? req.assets
      : (req.assetIds ?? []).map((id, index) => ({
          label: String(index + 1).padStart(3, "0"),
          assetId: id
        }));
  if (!normalizedAssets.length) {
    throw createHttpError(400, "assetIds is required");
  }

  const packId = nanoid();
  const downloadFilename = buildDownloadFilename(req, packId);
  const dir = packsDir(dataDir);
  fs.mkdirSync(dir, { recursive: true });

  const zipPath = path.join(dir, `${packId}.zip`);
  const output = fs.createWriteStream(zipPath);
  const zip = archiver("zip", { zlib: { level: 9 } });

  const done = new Promise<void>((resolve, reject) => {
    output.on("close", () => resolve());
    output.on("error", reject);
    zip.on("warning", reject);
    zip.on("error", reject);
  });

  zip.pipe(output);

  const entries: Array<{ assetId: string; filename: string; zipPath: string }> = [];
  const files: PackFileMetadata[] = [];

  for (const asset of normalizedAssets) {
    const id = asset.assetId;
    const file = assetStore.find(id);
    if (!file) throw createHttpError(404, `asset not found: ${id}`);

    const ext = path.extname(file.filename).toLowerCase();
    const name = `${asset.label}${ext}`;
    const inZip = path.posix.join("assets", name);
    zip.file(file.filePath, { name: inZip });
    entries.push({ assetId: id, filename: name, zipPath: inZip });
    files.push({
      role: asset.role ?? "sticker",
      label: asset.label,
      assetId: id,
      filename: name,
      zipPath: inZip,
      ...(await readFileFacts(file.filePath)),
      ...(asset.prompt ? { prompt: asset.prompt } : {}),
      ...(asset.style ? { style: asset.style } : {}),
      ...(asset.emotion ? { emotion: asset.emotion } : {}),
      ...(asset.sourceAssetId ? { sourceAssetId: asset.sourceAssetId } : {})
    });
  }

  for (const extra of EXTRA_FILES) {
    const assetId = req[extra.field] as string | undefined;
    if (!assetId) continue;
    const file = assetStore.find(assetId);
    if (!file) throw createHttpError(404, `asset not found: ${assetId}`);
    const ext = path.extname(file.filename).toLowerCase();
    const name = `${extra.role}${ext}`;
    const inZip = path.posix.join("meta", name);
    zip.file(file.filePath, { name: inZip });
    const detail = req.extraDetails?.[extra.role];
    files.push({
      role: extra.role,
      assetId,
      filename: name,
      zipPath: inZip,
      ...(await readFileFacts(file.filePath)),
      ...(detail?.prompt ? { prompt: detail.prompt } : {}),
      ...(detail?.style ? { style: detail.style } : {}),
      ...(detail?.sourceAssetId ? { sourceAssetId: detail.sourceAssetId } : {})
    });
  }

  // 参考图是可选的补充素材：缺失时跳过而不是让整个打包失败
  // （例如重建 ZIP 时 uploads 已被清理）。
  if (req.referenceAssetId) {
    const reference = assetStore.find(req.referenceAssetId);
    if (reference) {
      const ext = path.extname(reference.filename).toLowerCase();
      const name = `reference${ext}`;
      const inZip = path.posix.join("source", name);
      zip.file(reference.filePath, { name: inZip });
      files.push({
        role: "reference",
        assetId: req.referenceAssetId,
        filename: name,
        zipPath: inZip,
        ...(await readFileFacts(reference.filePath))
      });
    }
  }

  const createdAt = new Date().toISOString();
  const metadata: PackMetadata = {
    schema: "easysticker-pack@0.3",
    packId,
    presetId: req.presetId,
    createdAt,
    metadata: req.metadata ?? {},
    ...(req.generation
      ? { generation: { ...req.generation, createdAt: req.generation.createdAt ?? createdAt } }
      : {}),
    extras: {
      coverAssetId: req.coverAssetId ?? null,
      bannerAssetId: req.bannerAssetId ?? null,
      iconAssetId: req.iconAssetId ?? null,
      rewardGuideAssetId: req.rewardGuideAssetId ?? null,
      rewardThanksAssetId: req.rewardThanksAssetId ?? null
    },
    files,
    assets: entries
  };

  const metadataJson = JSON.stringify(metadata, null, 2);
  zip.append(metadataJson, { name: "metadata.json" });

  await zip.finalize();
  await done;

  fs.writeFileSync(packInfoPath(dataDir, packId), JSON.stringify({ packId, downloadFilename }, null, 2));

  return { packId, zipPath, downloadFilename, metadataJson };
}

export function getPackZipPath(dataDir: string, packId: string) {
  const filePath = path.join(packsDir(dataDir), `${packId}.zip`);
  if (!fs.existsSync(filePath)) throw createHttpError(404, "pack not found");
  return filePath;
}

export function getPackInfo(dataDir: string, packId: string): PackInfo {
  const infoPath = packInfoPath(dataDir, packId);
  if (fs.existsSync(infoPath)) {
    return JSON.parse(fs.readFileSync(infoPath, "utf8")) as PackInfo;
  }
  return { packId, downloadFilename: `${packId}.zip` };
}
