import fs from "node:fs";
import path from "node:path";
import createHttpError from "http-errors";
import archiver from "archiver";
import { nanoid } from "nanoid";
import sharp from "sharp";
import type { AssetStore } from "../../lib/assets";
import { expiryFor } from "../maintenance/retention";

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

/** 单张资源的历史版本类型：初版 / 编辑 / 重生成 / 回退。 */
export type PackFileVersionKind = "generate" | "edit" | "regenerate" | "restore";
export type PackFileVersion = {
  assetId: string;
  createdAt: string;
  kind: PackFileVersionKind;
  /** 编辑时填写的修改要求。 */
  instruction?: string;
  prompt?: string;
  style?: string;
  emotion?: string;
  /** 该版本在 ZIP 内的路径（非当前版本才会打包进 `history/`）。 */
  zipPath?: string;
};

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
  /** 编辑图片时这张图的来源资源。 */
  sourceAssetId?: string;
  /** 编辑图片时额外提供的那张参考图。 */
  editReferenceAssetId?: string;
  /** 历史版本（含初版），用于查看与回退。 */
  versions?: PackFileVersion[];
};

/**
 * 生成上下文：记录「这套图是怎么生成的」，让 ZIP 重新导入后可以还原提示词、
 * 风格、尺寸与参考图，从而继续做编辑/优化。
 */
export type PackGenerationInfo = {
  source?: "ai-generate" | "import";
  providerId?: string;
  model?: string;
  prompt?: string;
  /** 生成时选中的提示词预设 id；空/缺失表示未用预设（旧包）。 */
  promptPreset?: string | null;
  /** 生成时「提示词自定义」输入框的内容；与 promptPreset 一起完整还原表单。 */
  promptCustom?: string | null;
  /** 自定义提示词与预设的关系：append 追加 / override 覆盖；旧包缺失时按 append 处理。 */
  promptMode?: "append" | "override" | null;
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
  /** 若这一包是导入旧 ZIP 还原而来，记录原始 packId。 */
  restoredFrom?: string | null;
  /** 本次实际包含的扩展资源。 */
  include?: { cover?: boolean; icon?: boolean; banner?: boolean; reward?: boolean };
  createdAt?: string;
};

export type PackRequest = {
  /**
   * 可选：重建时覆盖同一个包。命中且归属一致时原地更新清单并保留原 `createdAt`，
   * 让「编辑一张图后重新打包」在历史里始终只有一条记录。
   */
  packId?: string;
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
    Record<
      PackFileRole,
      {
        prompt?: string;
        style?: string;
        sourceAssetId?: string;
        editReferenceAssetId?: string;
        versions?: PackFileVersion[];
      }
    >
  >;
};

export type PackInfo = {
  packId: string;
  downloadFilename: string;
};

/**
 * 包清单，落在 `packs/<packId>.json`。
 * ZIP 不再常驻磁盘，只看这份清单就能在下载时现打出来。
 */
export type PackManifest = {
  packId: string;
  downloadFilename: string;
  /**
   * 归属：已登录用户是邮箱，未登录是 `client:<id>`，null 表示无法归属。
   * **只存在清单里，不进 ZIP 的 metadata.json** —— 那个会随表情包分发给别人。
   */
  owner?: string | null;
  /** 会原样写进 ZIP 里那份 `metadata.json` 的内容。 */
  metadata: PackMetadata;
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
  editReferenceAssetId?: string;
  /** 历史版本（含初版），用于查看与回退。 */
  versions?: PackFileVersion[];
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

/**
 * 生成一个包：只写清单（几 KB），**不再落地 ZIP**。
 *
 * 早期实现会把整包图片再复制一份成 `<packId>.zip`，于是「uploads 一份 + zip 一份」
 * 双倍占用；而且前端每次单资源重生成都会 `POST /api/packs` 重建整包，一份结果会被
 * 复制 N 次。现在下载时按需现打，存储降到约一半，重建也从「搬几 MB」变成「写几 KB」。
 */
export async function createPack(
  assetStore: AssetStore,
  dataDir: string,
  req: PackRequest,
  owner?: string | null
) {
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

  // 覆盖同一 packId：编辑图片重建时前端会带上原 packId。
  // 命中且归属一致 → 原地更新清单（保留 createdAt），历史天然只有一条；
  // 未命中 / 归属不符 / 未提供 → 新建，避免覆盖他人的包或让客户端任意指定 ID。
  const requestedPackId = req.packId?.trim();
  const existing = requestedPackId ? readPackManifest(dataDir, requestedPackId) : null;
  const canOverwrite = Boolean(existing && (existing.owner ?? null) === (owner ?? null));
  const packId = canOverwrite ? requestedPackId! : nanoid();
  const createdAt = canOverwrite ? existing!.metadata.createdAt : new Date().toISOString();
  const downloadFilename = buildDownloadFilename(req, packId);

  const entries: Array<{ assetId: string; filename: string; zipPath: string }> = [];
  const files: PackFileMetadata[] = [];

  for (const asset of normalizedAssets) {
    const id = asset.assetId;
    const file = assetStore.find(id);
    if (!file) throw createHttpError(404, `asset not found: ${id}`);

    const ext = path.extname(file.filename).toLowerCase();
    const name = `${asset.label}${ext}`;
    const inZip = path.posix.join("assets", name);
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
      ...(asset.sourceAssetId ? { sourceAssetId: asset.sourceAssetId } : {}),
      ...(asset.editReferenceAssetId ? { editReferenceAssetId: asset.editReferenceAssetId } : {}),
      ...(asset.versions?.length ? { versions: asset.versions } : {})
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
    const detail = req.extraDetails?.[extra.role];
    files.push({
      role: extra.role,
      assetId,
      filename: name,
      zipPath: inZip,
      ...(await readFileFacts(file.filePath)),
      ...(detail?.prompt ? { prompt: detail.prompt } : {}),
      ...(detail?.style ? { style: detail.style } : {}),
      ...(detail?.sourceAssetId ? { sourceAssetId: detail.sourceAssetId } : {}),
      ...(detail?.editReferenceAssetId ? { editReferenceAssetId: detail.editReferenceAssetId } : {}),
      ...(detail?.versions?.length ? { versions: detail.versions } : {})
    });
  }

  // 参考图是可选的补充素材：缺失时跳过而不是让整个打包失败
  // （例如重建时 uploads 已被清理）。
  if (req.referenceAssetId) {
    const reference = assetStore.find(req.referenceAssetId);
    if (reference) {
      const ext = path.extname(reference.filename).toLowerCase();
      const name = `reference${ext}`;
      const inZip = path.posix.join("source", name);
      files.push({
        role: "reference",
        assetId: req.referenceAssetId,
        filename: name,
        zipPath: inZip,
        ...(await readFileFacts(reference.filePath))
      });
    }
  }

  // 为历史版本分配 ZIP 内路径（当前版本已在 assets/ 里，不重复打包）。
  // 下载时会把它们一并打进 history/，导入后历史版本仍可查看/回退。
  for (const file of files) {
    const versions = file.versions;
    if (!versions?.length) continue;
    const ext = path.extname(file.zipPath) || ".png";
    const stem = path.posix.basename(file.zipPath, path.extname(file.zipPath));
    let n = 0;
    for (const version of versions) {
      if (!version.assetId || version.assetId === file.assetId || version.zipPath) continue;
      if (!assetStore.find(version.assetId)) continue;
      n += 1;
      version.zipPath = path.posix.join("history", stem, `v${n}${ext}`);
    }
  }

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

  const manifest: PackManifest = { packId, downloadFilename, owner: owner ?? null, metadata };
  fs.mkdirSync(packsDir(dataDir), { recursive: true });
  fs.writeFileSync(packInfoPath(dataDir, packId), JSON.stringify(manifest, null, 2));
  // 覆盖旧包时若存在同名旧 ZIP，删掉它 —— 下载优先走 ZIP（见 routes/packs.ts），留着会发旧内容。
  if (canOverwrite) {
    const legacyZip = findPackZipPath(dataDir, packId);
    if (legacyZip) fs.rmSync(legacyZip, { force: true });
  }

  return {
    packId,
    downloadUrl: `/api/packs/${packId}/download`,
    downloadFilename,
    metadataJson: JSON.stringify(metadata, null, 2)
  };
}

/** 读取包清单；旧包（只有 ZIP 或只有 `{packId, downloadFilename}` 侧车）返回 null。 */
export function readPackManifest(dataDir: string, packId: string): PackManifest | null {
  const infoPath = packInfoPath(dataDir, packId);
  if (!fs.existsSync(infoPath)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(infoPath, "utf8")) as Partial<PackManifest>;
    if (!parsed || typeof parsed !== "object" || !parsed.metadata) return null;
    return {
      packId: parsed.packId ?? packId,
      downloadFilename: parsed.downloadFilename ?? `${packId}.zip`,
      owner: parsed.owner ?? null,
      metadata: parsed.metadata
    };
  } catch {
    return null;
  }
}

/** 把清单落盘（迁移旧包、修复历史包时用）。 */
export function writePackManifest(dataDir: string, manifest: PackManifest): void {
  fs.mkdirSync(packsDir(dataDir), { recursive: true });
  fs.writeFileSync(packInfoPath(dataDir, manifest.packId), JSON.stringify(manifest, null, 2));
}

/** 清单里所有文件是否都还在 uploads 里；返回缺失的 zipPath 列表。 */
export function missingPackFiles(assetStore: AssetStore, manifest: PackManifest): string[] {
  const missing: string[] = [];
  for (const f of manifest.metadata.files) {
    if (!assetStore.find(f.assetId)) missing.push(f.zipPath);
    for (const version of f.versions ?? []) {
      if (version.zipPath && !assetStore.find(version.assetId)) missing.push(version.zipPath);
    }
  }
  return missing;
}

/**
 * 现场把清单打成 ZIP 流（边打边发，不在磁盘留副本）。
 * 调用前请先用 `missingPackFiles` 校验，避免流到一半才发现缺文件。
 */
export function createPackArchive(assetStore: AssetStore, manifest: PackManifest) {
  // 图片本身已是压缩格式（PNG/WebP），用低压缩级别换打包速度，体积几乎无差别
  const zip = archiver("zip", { zlib: { level: 1 } });
  for (const file of manifest.metadata.files) {
    const found = assetStore.find(file.assetId);
    if (found) zip.file(found.filePath, { name: file.zipPath });
    // 历史版本同样打进 ZIP，导入后仍可逐版查看/回退
    for (const version of file.versions ?? []) {
      if (!version.zipPath) continue;
      const vfound = assetStore.find(version.assetId);
      if (vfound) zip.file(vfound.filePath, { name: version.zipPath });
    }
  }
  zip.append(JSON.stringify(manifest.metadata, null, 2), { name: "metadata.json" });
  // archiver 出错时若无人监听 'error' 会抛未捕获异常；交给响应流自然中断
  zip.on("error", () => {});
  void zip.finalize();
  return zip;
}

export function findPackZipPath(dataDir: string, packId: string): string | null {
  const filePath = path.join(packsDir(dataDir), `${packId}.zip`);
  return fs.existsSync(filePath) ? filePath : null;
}

export function getPackZipPath(dataDir: string, packId: string) {
  const filePath = findPackZipPath(dataDir, packId);
  if (!filePath) throw createHttpError(404, "pack not found");
  return filePath;
}

/** 包是否存在（清单或旧 ZIP 任一在即为存在）。 */
export function packExists(dataDir: string, packId: string): boolean {
  return fs.existsSync(packInfoPath(dataDir, packId)) || findPackZipPath(dataDir, packId) !== null;
}

/** 删除一个包：清单 + 旧 ZIP 一并清掉。返回是否删掉了东西。 */
export function deletePack(dataDir: string, packId: string): boolean {
  let removed = false;
  const zipPath = findPackZipPath(dataDir, packId);
  if (zipPath) {
    fs.rmSync(zipPath, { force: true });
    removed = true;
  }
  const infoPath = packInfoPath(dataDir, packId);
  if (fs.existsSync(infoPath)) {
    fs.rmSync(infoPath, { force: true });
    removed = true;
  }
  return removed;
}

export type PackSummary = {
  packId: string;
  downloadUrl: string;
  downloadFilename: string;
  createdAt: string;
  presetId: string | null;
  title: string | null;
  author: string | null;
  stickerCount: number;
  bytes: number;
  hasZip: boolean;
  /** 归属者（邮箱或 `client:<id>`）；旧包可能是 null。 */
  owner: string | null;
  styles: string[];
  rewardEnabled: boolean;
  rewardMessage: string | null;
  hasReference: boolean;
  /** 开启保留期时，这个包会在什么时候被自动清理。 */
  expiresAt: string | null;
};

/**
 * 列出服务端保存的所有包。会扫描 packs 目录，仅供后台/低频接口使用。
 * 已压缩（只有清单）的包能给出完整信息；仍是旧 ZIP 的包只回退到文件时间与体积。
 */
export function listPacks(
  dataDir: string,
  retentionDays = 0,
  retentionStartedAt: string | null = null
): PackSummary[] {
  const dir = packsDir(dataDir);
  if (!fs.existsSync(dir)) return [];
  const ids = new Set<string>();
  for (const name of fs.readdirSync(dir)) {
    if (name.endsWith(".zip")) ids.add(name.slice(0, -4));
    else if (name.endsWith(".json")) ids.add(name.slice(0, -5));
  }

  const out: PackSummary[] = [];
  for (const packId of ids) {
    const manifest = readPackManifest(dataDir, packId);
    const zipPath = findPackZipPath(dataDir, packId);
    const zipBytes = zipPath ? fs.statSync(zipPath).size : 0;
    if (manifest) {
      const stickerCount = manifest.metadata.files.filter((f) => f.role === "sticker").length;
      const bytes = manifest.metadata.files.reduce((sum, f) => sum + (f.bytes ?? 0), 0) + zipBytes;
      const createdAt = manifest.metadata.createdAt;
      out.push({
        packId,
        downloadUrl: `/api/packs/${packId}/download`,
        downloadFilename: manifest.downloadFilename,
        createdAt,
        presetId: manifest.metadata.presetId ?? null,
        title: manifest.metadata.metadata?.title ?? null,
        author: manifest.metadata.metadata?.author ?? null,
        stickerCount,
        bytes,
        hasZip: Boolean(zipPath),
        owner: manifest.owner ?? null,
        styles: manifest.metadata.generation?.styles ?? [],
        rewardEnabled: Boolean(
          manifest.metadata.extras?.rewardGuideAssetId || manifest.metadata.extras?.rewardThanksAssetId
        ),
        rewardMessage: manifest.metadata.metadata?.rewardMessage ?? null,
        hasReference: manifest.metadata.files.some((f) => f.role === "reference"),
        expiresAt: expiryFor(createdAt, retentionDays, retentionStartedAt)
      });
      continue;
    }
    const fallback = getPackInfo(dataDir, packId);
    const legacyCreatedAt = new Date(zipBytes ? fs.statSync(zipPath!).mtimeMs : 0).toISOString();
    out.push({
      packId,
      downloadUrl: `/api/packs/${packId}/download`,
      downloadFilename: fallback.downloadFilename,
      createdAt: legacyCreatedAt,
      presetId: null,
      title: null,
      author: null,
      stickerCount: 0,
      bytes: zipBytes,
      hasZip: Boolean(zipPath),
      owner: null,
      styles: [],
      rewardEnabled: false,
      rewardMessage: null,
      hasReference: false,
      expiresAt: expiryFor(legacyCreatedAt, retentionDays, retentionStartedAt)
    });
  }
  return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function getPackInfo(dataDir: string, packId: string): PackInfo {
  const infoPath = packInfoPath(dataDir, packId);
  if (fs.existsSync(infoPath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(infoPath, "utf8")) as PackInfo;
      if (parsed && typeof parsed.downloadFilename === "string") return parsed;
    } catch {
      // 退回到文件名默认值
    }
  }
  return { packId, downloadFilename: `${packId}.zip` };
}
