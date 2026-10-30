import fs from "node:fs";
import path from "node:path";
import type { FastifyRequest } from "fastify";
import createHttpError from "http-errors";
import { nanoid } from "nanoid";
import type { AssetStore } from "../../lib/assets";
import { readZipEntries, type ZipEntry } from "../../lib/zip";
import { getPlatformPreset } from "../platform/presets";
import { validateAssetList } from "../platform/validate";
import {
  createPack,
  findPackZipPath,
  getPackInfo,
  packExists,
  readPackManifest,
  type PackFileMetadata,
  type PackFileRole,
  type PackFileVersion,
  type PackGenerationInfo
} from "../pack/service";

/**
 * 从「下载按钮导出的 ZIP」或「服务端已存的包」还原生成现场。
 *
 * 与 `importStickerPack`（导入零散图片、统一重编码为平台规格）不同，这里**不改动
 * 任何像素**：素材按原字节入库，并读回 `metadata.json` 里的逐张提示词 / 风格 /
 * 情绪 / 参考图，于是可以：
 *
 *   - 预览之前生成的结果；
 *   - 单张重新生成或编辑图片（沿用原始提示词）；
 *   - 再次导出，metadata 不丢信息。
 *
 * 三条入口：
 *   1. `restorePackFromZip`  —— 用户上传一个 ZIP 文件；
 *   2. `restorePackById`     —— 历史记录一键还原；包已有清单时直接复用，零拷贝；
 *   3. 旧包（只有 ZIP、没有清单）走「解 ZIP + 素材入库」的慢路径。
 */

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif"]);

/** 老包 `files[]` 可能缺失，按 `meta/` 下的文件名推断角色。 */
const ROLE_BY_BASENAME: Record<string, PackFileRole> = {
  cover: "cover",
  icon: "icon",
  banner: "banner",
  "reward-guide": "reward-guide",
  "reward-thanks": "reward-thanks",
  reference: "reference"
};

const EXTRA_KEYS: Array<
  [PackFileRole, "coverAssetId" | "iconAssetId" | "bannerAssetId" | "rewardGuideAssetId" | "rewardThanksAssetId"]
> = [
  ["cover", "coverAssetId"],
  ["icon", "iconAssetId"],
  ["banner", "bannerAssetId"],
  ["reward-guide", "rewardGuideAssetId"],
  ["reward-thanks", "rewardThanksAssetId"]
];

/** packId 由 nanoid 生成；限字符集同时挡住路径穿越。 */
const PACK_ID_PATTERN = /^[A-Za-z0-9_-]{6,64}$/;

type PackMetadataLike = {
  title?: string;
  author?: string;
  copyright?: string;
  version?: string;
  rewardMessage?: string;
};

type ParsedPack = {
  schema?: string;
  packId?: string;
  presetId?: string;
  metadata?: PackMetadataLike;
  generation?: PackGenerationInfo;
  files?: Array<Record<string, unknown>>;
  assets?: Array<Record<string, unknown>>;
};

type DeclaredFile = {
  role?: string;
  label?: unknown;
  assetId?: unknown;
  filename?: unknown;
  zipPath?: unknown;
  prompt?: unknown;
  style?: unknown;
  emotion?: unknown;
  sourceAssetId?: unknown;
  editReferenceAssetId?: unknown;
  versions?: unknown;
};

type RestoredFile = PackFileMetadata & { role: PackFileRole };
type StickerPayload = {
  label: string;
  assetId: string;
  prompt?: string;
  style?: string;
  emotion?: string;
  sourceAssetId?: string;
  editReferenceAssetId?: string;
  versions?: PackFileVersion[];
};

/** 从不可信的 metadata.json 里安全地解析历史版本数组。 */
function parseVersions(value: unknown): PackFileVersion[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const kinds = new Set<PackFileVersion["kind"]>(["generate", "fill", "upload", "edit", "regenerate", "restore"]);
  const out: PackFileVersion[] = [];
  for (const raw of value) {
    if (out.length >= 50) break;
    if (!raw || typeof raw !== "object") continue;
    const item = raw as Record<string, unknown>;
    const assetId = cleanText(item.assetId);
    const createdAt = cleanText(item.createdAt);
    const kind = typeof item.kind === "string" && kinds.has(item.kind as PackFileVersion["kind"])
      ? (item.kind as PackFileVersion["kind"])
      : "generate";
    if (!assetId || !createdAt) continue;
    out.push({
      assetId,
      createdAt,
      kind,
      ...(cleanText(item.instruction) ? { instruction: String(item.instruction).trim() } : {}),
      ...(cleanText(item.prompt) ? { prompt: String(item.prompt).trim() } : {}),
      ...(cleanText(item.style) ? { style: String(item.style).trim() } : {}),
      ...(cleanText(item.emotion) ? { emotion: String(item.emotion).trim() } : {}),
      ...(cleanText(item.zipPath) ? { zipPath: String(item.zipPath).trim() } : {})
    });
  }
  return out.length ? out : undefined;
}

/**
 * 把 ZIP 里的历史版本图片重新入库，并把 assetId 重映射到新库里的 id。
 * - 等于原当前版本的条目 → 指向刚入库的当前图；
 * - 其余带 zipPath 的 → 从包内解出并入库；
 * - 既非当前又无图（旧清单）→ 丢弃，避免留下悬空引用。
 */
function remapZipVersions(
  assetStore: AssetStore,
  entries: ZipEntry[],
  file: DeclaredFile,
  newCurrentAssetId: string
): PackFileVersion[] | undefined {
  const versions = parseVersions(file.versions);
  if (!versions?.length) return undefined;
  const originalCurrent = cleanText(file.assetId);
  const out: PackFileVersion[] = [];
  for (const version of versions) {
    if (originalCurrent && version.assetId === originalCurrent) {
      out.push({ ...version, assetId: newCurrentAssetId, zipPath: undefined });
      continue;
    }
    if (!version.zipPath) continue;
    const entry = findEntry(entries, version.zipPath);
    if (!entry || !isImage(entry.name)) continue;
    const ext = path.extname(entry.name).slice(1).toLowerCase();
    const versionAssetId = nanoid();
    assetStore.save(entry.content, versionAssetId, ext);
    out.push({ ...version, assetId: versionAssetId, zipPath: undefined });
  }
  return out.length ? out : undefined;
}

async function readFileBuffer(file: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of file) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

function cleanText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isImage(name: string): boolean {
  return IMAGE_EXTENSIONS.has(path.extname(name).toLowerCase());
}

/** 没有 `files[]` 时，按 ZIP 内目录结构推断每个文件的角色。 */
function inferFiles(entries: ZipEntry[]): DeclaredFile[] {
  const files: DeclaredFile[] = [];
  for (const entry of entries) {
    if (entry.name === "metadata.json" || !isImage(entry.name)) continue;
    const filename = path.basename(entry.name);
    if (entry.name.startsWith("assets/")) {
      files.push({
        role: "sticker",
        label: path.basename(filename, path.extname(filename)),
        filename,
        zipPath: entry.name
      });
      continue;
    }
    const role = ROLE_BY_BASENAME[path.basename(filename, path.extname(filename))];
    if (role) files.push({ role, filename, zipPath: entry.name });
  }
  return files;
}

function findEntry(entries: ZipEntry[], zipPath: string, filename?: string): ZipEntry | undefined {
  if (zipPath) {
    const direct = entries.find((e) => e.name === zipPath);
    if (direct) return direct;
  }
  if (filename) {
    const base = path.basename(filename);
    return entries.find((e) => path.basename(e.name) === base);
  }
  return undefined;
}

/** 从 ZIP 条目里取出并解析 metadata.json。 */
function parsePackEntries(entries: ZipEntry[]): ParsedPack {
  const metaEntry = entries.find((e) => e.name === "metadata.json");
  if (!metaEntry) {
    throw createHttpError(400, "这个 ZIP 里没有 metadata.json，无法还原生成现场（请使用本站下载的 ZIP 包）");
  }
  try {
    return JSON.parse(metaEntry.content.toString("utf8")) as ParsedPack;
  } catch {
    throw createHttpError(400, "metadata.json 解析失败，无法还原生成现场");
  }
}

/** 把 `files[]` 拆成「贴纸序列 / 扩展资源 / 参考图」。素材已在库里，不再复制。 */
function splitFiles(files: PackFileMetadata[]) {
  const stickers: StickerPayload[] = files
    .filter((f) => f.role === "sticker")
    .sort((a, b) =>
      String(a.label ?? "").localeCompare(String(b.label ?? ""), undefined, { numeric: true })
    )
    .map((f, i) => ({
      label: f.label ?? String(i + 1).padStart(3, "0"),
      assetId: f.assetId,
      ...(f.prompt ? { prompt: f.prompt } : {}),
      ...(f.style ? { style: f.style } : {}),
      ...(f.emotion ? { emotion: f.emotion } : {}),
      ...(f.sourceAssetId ? { sourceAssetId: f.sourceAssetId } : {}),
      ...(f.editReferenceAssetId ? { editReferenceAssetId: f.editReferenceAssetId } : {}),
      ...(f.versions?.length ? { versions: f.versions } : {})
    }));

  const extraIds: Record<string, string> = {};
  const extraDetails: Partial<Record<PackFileRole, { prompt?: string; style?: string; sourceAssetId?: string; editReferenceAssetId?: string; versions?: PackFileVersion[] }>> = {};
  for (const [role, key] of EXTRA_KEYS) {
    const file = files.find((f) => f.role === role);
    if (!file) continue;
    extraIds[key] = file.assetId;
    const detail = {
      ...(file.prompt ? { prompt: file.prompt } : {}),
      ...(file.style ? { style: file.style } : {}),
      ...(file.sourceAssetId ? { sourceAssetId: file.sourceAssetId } : {}),
      ...(file.editReferenceAssetId ? { editReferenceAssetId: file.editReferenceAssetId } : {}),
      ...(file.versions?.length ? { versions: file.versions } : {})
    };
    if (Object.keys(detail).length) extraDetails[role] = detail;
  }

  const reference = files.find((f) => f.role === "reference");
  return { stickers, extraIds, extraDetails, referenceAssetId: reference?.assetId ?? null };
}

/** 三个入口共用的响应组装：与 AI 生成结果同构，前端可直接套用。 */
function buildRestoreResponse(input: {
  packId: string;
  downloadUrl: string;
  downloadFilename: string;
  metadataJson: string;
  presetId: string;
  metadata: PackMetadataLike;
  generation: PackGenerationInfo;
  files: PackFileMetadata[];
  stickers: StickerPayload[];
  extraIds: Record<string, string>;
  extraDetails: Partial<
    Record<PackFileRole, { prompt?: string; style?: string; sourceAssetId?: string; editReferenceAssetId?: string; versions?: PackFileVersion[] }>
  >;
  referenceAssetId: string | null;
  warnings: string[];
  restoredFrom: string | null;
  schema: string | null;
}) {
  const includeReward = Boolean(input.extraIds.rewardGuideAssetId || input.extraIds.rewardThanksAssetId);
  return {
    packId: input.packId,
    downloadUrl: input.downloadUrl,
    downloadFilename: input.downloadFilename,
    metadataJson: input.metadataJson,
    stickers: input.stickers.map((s) => ({ ...s, role: "sticker" as const, url: `/api/assets/${s.assetId}` })),
    extras: input.extraIds,
    extraDetails: input.extraDetails,
    generation: input.generation,
    meta: {
      count: input.stickers.length,
      styles: input.generation.styles ?? ["导入 ZIP"],
      title: input.metadata.title ?? null,
      author: input.metadata.author ?? null,
      version: input.metadata.version ?? null,
      copyright: input.metadata.copyright ?? null,
      rewardMessage: input.metadata.rewardMessage ?? null,
      rewardEnabled: includeReward,
      referenceAssetId: input.referenceAssetId,
      referenceMode: input.generation.referenceMode ?? (input.referenceAssetId ? "restored" : "none"),
      presetId: input.presetId,
      files: input.files.length
    },
    restored: {
      fromPackId: input.restoredFrom,
      schema: input.schema,
      warnings: input.warnings
    }
  };
}

/* ── 入口 1：用户上传一个 ZIP 文件 ─────────────────────────────────────── */

export async function restorePackFromZip(
  assetStore: AssetStore,
  dataDir: string,
  fallbackPresetId: string,
  req: FastifyRequest,
  owner?: string | null
) {
  const partsFactory = (req as any).parts;
  if (typeof partsFactory !== "function") {
    throw createHttpError(400, "multipart request is required");
  }

  let zipBuffer: Buffer | null = null;
  const fields: Record<string, string> = {};
  // ZIP 里可能带着参考图，比单张图片的 25MB 上限放宽一些
  for await (const part of partsFactory.call(req, { limits: { fileSize: 100 * 1024 * 1024 } })) {
    if (part.type === "file") {
      if (part.fieldname !== "file") continue;
      zipBuffer = await readFileBuffer(part.file);
      continue;
    }
    fields[part.fieldname] = String(part.value);
  }
  if (!zipBuffer || !zipBuffer.length) throw createHttpError(400, "请选择要导入的 ZIP 包");

  let entries: ZipEntry[];
  try {
    entries = readZipEntries(zipBuffer);
  } catch {
    throw createHttpError(400, "无法解析这个 ZIP，请确认它是从本站下载的表情包");
  }

  const parsed = parsePackEntries(entries);
  const presetId = cleanText(fields.presetId) ?? cleanText(parsed.presetId) ?? fallbackPresetId;
  return restoreFromEntries(assetStore, dataDir, presetId, entries, parsed, undefined, owner);
}

/* ── 入口 2 / 3：按 packId 还原服务端已存的包 ──────────────────────────── */

export async function restorePackById(
  assetStore: AssetStore,
  dataDir: string,
  fallbackPresetId: string,
  packId: string,
  owner?: string | null
) {
  if (!PACK_ID_PATTERN.test(packId)) throw createHttpError(400, "invalid packId");
  if (!packExists(dataDir, packId)) {
    throw createHttpError(404, "找不到这个表情包的原始文件，可能已被清理");
  }

  const info = getPackInfo(dataDir, packId);
  const manifest = readPackManifest(dataDir, packId);

  // 新包：清单里就有完整 metadata，素材也都在 uploads 里 —— 零拷贝、不解 ZIP
  if (manifest) {
    const { stickers, extraIds, extraDetails, referenceAssetId } = splitFiles(manifest.metadata.files);
    if (!stickers.length) throw createHttpError(400, "这个包里没有找到贴纸图片，无法还原");

    const generation: PackGenerationInfo = {
      ...(manifest.metadata.generation ?? {}),
      restoredFrom: packId
    };
    const warnings = await collectValidationWarnings(
      assetStore,
      manifest.metadata.presetId ?? fallbackPresetId,
      stickers.map((s) => s.assetId)
    );
    const missing = manifest.metadata.files.filter((f) => !assetStore.find(f.assetId)).length;
    if (missing) warnings.push(`有 ${missing} 个素材文件已被清理，重新导出时会被跳过`);

    return buildRestoreResponse({
      packId,
      downloadUrl: `/api/packs/${packId}/download`,
      downloadFilename: info.downloadFilename,
      metadataJson: JSON.stringify(manifest.metadata, null, 2),
      presetId: manifest.metadata.presetId ?? fallbackPresetId,
      metadata: manifest.metadata.metadata ?? {},
      generation,
      files: manifest.metadata.files,
      stickers,
      extraIds,
      extraDetails,
      referenceAssetId,
      warnings,
      restoredFrom: packId,
      schema: manifest.metadata.schema ?? null
    });
  }

  // 旧包：只有 ZIP，需要解开并把素材重新入库
  const zipPath = findPackZipPath(dataDir, packId);
  if (!zipPath) throw createHttpError(404, "找不到这个表情包的原始文件，可能已被清理");

  let entries: ZipEntry[];
  try {
    entries = readZipEntries(fs.readFileSync(zipPath));
  } catch {
    throw createHttpError(400, "原始包已损坏，无法还原");
  }

  const parsed = parsePackEntries(entries);
  const presetId = cleanText(parsed.presetId) ?? fallbackPresetId;
  return restoreFromEntries(
    assetStore,
    dataDir,
    presetId,
    entries,
    parsed,
    {
      packId,
      downloadUrl: `/api/packs/${packId}/download`,
      downloadFilename: info.downloadFilename
    },
    owner
  );
}

async function collectValidationWarnings(
  assetStore: AssetStore,
  presetId: string,
  assetIds: string[]
): Promise<string[]> {
  try {
    const validation = await validateAssetList(assetStore, presetId, assetIds);
    if (!validation.ok) {
      return ["还原的贴纸与当前平台规格不完全一致，导出前建议先单张重新生成或核对尺寸"];
    }
  } catch {
    // 校验失败不应阻断还原
  }
  return [];
}

/* ── 核心：把 ZIP 条目按原字节入库，重建可继续编辑的结果 ───────────────── */

async function restoreFromEntries(
  assetStore: AssetStore,
  dataDir: string,
  presetId: string,
  entries: ZipEntry[],
  parsed: ParsedPack,
  reusePack?: { packId: string; downloadUrl: string; downloadFilename: string },
  owner?: string | null
) {
  const preset = getPlatformPreset(presetId);
  if (!preset) throw createHttpError(400, `unknown presetId: ${presetId}`);

  const declared: DeclaredFile[] =
    Array.isArray(parsed.files) && parsed.files.length
      ? (parsed.files as DeclaredFile[])
      : inferFiles(entries);

  // 逐张原样入库（不重编码），保持字节一致
  const warnings: string[] = [];
  const restored: RestoredFile[] = [];
  for (const file of declared) {
    const role = file.role as PackFileRole | undefined;
    if (!role) continue;
    const zipPath = typeof file.zipPath === "string" ? file.zipPath : "";
    const filename = typeof file.filename === "string" ? file.filename : "";
    const entry = findEntry(entries, zipPath, filename);
    if (!entry || !isImage(entry.name)) {
      warnings.push(`包内缺少 ${zipPath || filename}，已跳过`);
      continue;
    }
    const ext = path.extname(entry.name).slice(1).toLowerCase();
    const assetId = nanoid();
    assetStore.save(entry.content, assetId, ext);
    const versions = remapZipVersions(assetStore, entries, file, assetId);
    restored.push({
      role,
      assetId,
      filename: path.basename(entry.name),
      zipPath: entry.name,
      // 尺寸/体积由 createPack 用 sharp 实测后写进清单，这里不重复测
      width: null,
      height: null,
      format: null,
      mimeType: null,
      bytes: null,
      ...(file.label ? { label: String(file.label) } : {}),
      ...(cleanText(file.prompt) ? { prompt: String(file.prompt) } : {}),
      ...(cleanText(file.style) ? { style: String(file.style) } : {}),
      ...(cleanText(file.emotion) ? { emotion: String(file.emotion) } : {}),
      ...(cleanText(file.sourceAssetId) ? { sourceAssetId: String(file.sourceAssetId) } : {}),
      ...(cleanText(file.editReferenceAssetId) ? { editReferenceAssetId: String(file.editReferenceAssetId) } : {}),
      ...(versions?.length ? { versions } : {})
    });
  }

  const stickerFiles = restored
    .filter((f) => f.role === "sticker")
    .sort((a, b) =>
      String(a.label ?? "").localeCompare(String(b.label ?? ""), undefined, { numeric: true })
    );
  if (!stickerFiles.length) {
    throw createHttpError(400, "这个 ZIP 里没有找到贴纸图片，无法还原");
  }

  const extraIds: Record<string, string> = {};
  const extraDetails: Partial<Record<PackFileRole, { prompt?: string; style?: string; sourceAssetId?: string; editReferenceAssetId?: string; versions?: PackFileVersion[] }>> = {};
  for (const [role, key] of EXTRA_KEYS) {
    const file = restored.find((f) => f.role === role);
    if (!file) continue;
    extraIds[key] = file.assetId;
    const detail = {
      ...(file.prompt ? { prompt: file.prompt } : {}),
      ...(file.style ? { style: file.style } : {}),
      ...(file.sourceAssetId ? { sourceAssetId: file.sourceAssetId } : {}),
      ...(file.editReferenceAssetId ? { editReferenceAssetId: file.editReferenceAssetId } : {}),
      ...(file.versions?.length ? { versions: file.versions } : {})
    };
    if (Object.keys(detail).length) extraDetails[role] = detail;
  }
  const reference = restored.find((f) => f.role === "reference");

  const sourceGeneration = parsed.generation ?? {};
  const generation: PackGenerationInfo = {
    ...sourceGeneration,
    // 参考图导入后拿到新的 assetId，下次重建仍要带上它
    ...(reference ? { referenceAssetId: reference.assetId } : {}),
    restoredFrom: cleanText(parsed.packId) ?? sourceGeneration.restoredFrom,
    targetSize: sourceGeneration.targetSize ?? { width: preset.maxWidth, height: preset.maxHeight },
    include: sourceGeneration.include ?? {
      cover: Boolean(extraIds.coverAssetId),
      icon: Boolean(extraIds.iconAssetId),
      banner: Boolean(extraIds.bannerAssetId),
      reward: Boolean(extraIds.rewardGuideAssetId || extraIds.rewardThanksAssetId)
    }
  };

  const assetsPayload = stickerFiles.map((f, i) => ({
    label: f.label ?? String(i + 1).padStart(3, "0"),
    assetId: f.assetId,
    role: "sticker" as const,
    ...(f.prompt ? { prompt: f.prompt } : {}),
    ...(f.style ? { style: f.style } : {}),
    ...(f.emotion ? { emotion: f.emotion } : {}),
    ...(f.sourceAssetId ? { sourceAssetId: f.sourceAssetId } : {}),
    ...(f.editReferenceAssetId ? { editReferenceAssetId: f.editReferenceAssetId } : {}),
    ...(f.versions?.length ? { versions: f.versions.map((v) => ({ ...v, zipPath: undefined })) } : {})
  }));

  const metadata: PackMetadataLike = {
    title: cleanText(parsed.metadata?.title),
    author: cleanText(parsed.metadata?.author),
    version: cleanText(parsed.metadata?.version),
    copyright: cleanText(parsed.metadata?.copyright),
    rewardMessage: cleanText(parsed.metadata?.rewardMessage)
  };

  let packId: string;
  let downloadUrl: string;
  let downloadFilename: string;
  let metadataJson: string;
  let files: PackFileMetadata[];

  if (reusePack) {
    ({ packId, downloadUrl, downloadFilename } = reusePack);
    metadataJson = JSON.stringify(parsed, null, 2);
    files = restored;
  } else {
    const built = await createPack(assetStore, dataDir, {
      presetId,
      assets: assetsPayload,
      coverAssetId: extraIds.coverAssetId,
      iconAssetId: extraIds.iconAssetId,
      bannerAssetId: extraIds.bannerAssetId,
      rewardGuideAssetId: extraIds.rewardGuideAssetId,
      rewardThanksAssetId: extraIds.rewardThanksAssetId,
      referenceAssetId: reference?.assetId,
      metadata,
      generation,
      extraDetails
    }, owner);
    packId = built.packId;
    downloadUrl = built.downloadUrl;
    downloadFilename = built.downloadFilename;
    metadataJson = built.metadataJson;
    const rebuilt = readPackManifest(dataDir, packId);
    files = rebuilt?.metadata.files ?? restored;
  }

  const stickerIds = assetsPayload.map((a) => a.assetId);
  const validationWarnings = reusePack
    ? []
    : await collectValidationWarnings(assetStore, presetId, stickerIds);

  return buildRestoreResponse({
    packId,
    downloadUrl,
    downloadFilename,
    metadataJson,
    presetId,
    metadata,
    generation,
    files,
    stickers: assetsPayload.map((a, i) => ({
      label: a.label,
      assetId: a.assetId,
      ...(stickerFiles[i]?.prompt ? { prompt: stickerFiles[i].prompt } : {}),
      ...(stickerFiles[i]?.style ? { style: stickerFiles[i].style } : {}),
      ...(stickerFiles[i]?.emotion ? { emotion: stickerFiles[i].emotion } : {}),
      ...(stickerFiles[i]?.sourceAssetId ? { sourceAssetId: stickerFiles[i].sourceAssetId } : {}),
      ...(stickerFiles[i]?.editReferenceAssetId
        ? { editReferenceAssetId: stickerFiles[i].editReferenceAssetId }
        : {}),
      ...(stickerFiles[i]?.versions?.length ? { versions: stickerFiles[i].versions } : {})
    })),
    extraIds,
    extraDetails,
    referenceAssetId: reference?.assetId ?? null,
    warnings: [...warnings, ...validationWarnings],
    restoredFrom: cleanText(parsed.packId) ?? null,
    schema: cleanText(parsed.schema) ?? null
  });
}
