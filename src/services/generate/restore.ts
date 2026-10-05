import fs from "node:fs";
import path from "node:path";
import type { FastifyRequest } from "fastify";
import createHttpError from "http-errors";
import { nanoid } from "nanoid";
import type { AssetStore } from "../../lib/assets";
import { readZipEntries, type ZipEntry } from "../../lib/zip";
import { getPlatformPreset } from "../platform/presets";
import { validateAssetList } from "../platform/validate";
import { buildZipPack, getPackInfo, getPackZipPath, type PackFileRole, type PackGenerationInfo } from "../pack/service";

/**
 * 从「下载按钮导出的 ZIP」还原生成现场。
 *
 * 与 `importStickerPack`（导入零散图片、统一重编码为平台规格）不同，这里**不改动
 * 任何像素**：把包内图片按原字节重新入库，并读回 `metadata.json` 里的
 * 逐张提示词 / 风格 / 情绪 / 参考图，于是可以：
 *
 *   - 预览之前生成的结果；
 *   - 单张重新生成或二次编辑（沿用原始提示词）；
 *   - 再次导出，metadata 不丢信息。
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

const EXTRA_KEYS: Array<[PackFileRole, "coverAssetId" | "iconAssetId" | "bannerAssetId" | "rewardGuideAssetId" | "rewardThanksAssetId"]> = [
  ["cover", "coverAssetId"],
  ["icon", "iconAssetId"],
  ["banner", "bannerAssetId"],
  ["reward-guide", "rewardGuideAssetId"],
  ["reward-thanks", "rewardThanksAssetId"]
];

type ParsedPack = {
  schema?: string;
  packId?: string;
  presetId?: string;
  metadata?: {
    title?: string;
    author?: string;
    copyright?: string;
    version?: string;
    rewardMessage?: string;
  };
  generation?: PackGenerationInfo;
  files?: Array<Record<string, unknown>>;
  assets?: Array<Record<string, unknown>>;
};

type DeclaredFile = {
  role?: string;
  label?: unknown;
  filename?: unknown;
  zipPath?: unknown;
  prompt?: unknown;
  style?: unknown;
  emotion?: unknown;
  sourceAssetId?: unknown;
};

type RestoredFile = {
  role: PackFileRole;
  label?: string;
  filename: string;
  zipPath: string;
  assetId: string;
  prompt?: string;
  style?: string;
  emotion?: string;
  sourceAssetId?: string;
};

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

export async function restorePackFromZip(
  assetStore: AssetStore,
  dataDir: string,
  fallbackPresetId: string,
  req: FastifyRequest
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
  return restoreFromEntries(assetStore, dataDir, presetId, entries, parsed);
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

/**
 * 按 packId 还原服务端已保存的包（历史记录「一键还原」用，不需要用户再找文件）。
 * 包本身已存在且下载链接有效，直接复用，不再复制一份。
 */
export async function restorePackById(
  assetStore: AssetStore,
  dataDir: string,
  fallbackPresetId: string,
  packId: string
) {
  if (!/^[A-Za-z0-9_-]{6,64}$/.test(packId)) throw createHttpError(400, "invalid packId");
  let zipPath: string;
  try {
    zipPath = getPackZipPath(dataDir, packId);
  } catch {
    throw createHttpError(404, "找不到这个表情包的原始文件，可能已被清理");
  }

  let entries: ZipEntry[];
  try {
    entries = readZipEntries(fs.readFileSync(zipPath));
  } catch {
    throw createHttpError(400, "原始包已损坏，无法还原");
  }

  const parsed = parsePackEntries(entries);
  const presetId = cleanText(parsed.presetId) ?? fallbackPresetId;
  const info = getPackInfo(dataDir, packId);
  return restoreFromEntries(assetStore, dataDir, presetId, entries, parsed, {
    packId,
    downloadUrl: `/api/packs/${packId}/download`,
    downloadFilename: info.downloadFilename || `easysticker-pack-${packId}.zip`,
    // 包没变，metadata 直接沿用磁盘上的那份
    metadataJson: JSON.stringify(parsed, null, 2)
  });
}

/**
 * 还原核心：把 ZIP 条目按原字节入库，重建可继续编辑的结果。
 * `reusePack` 用于「按 packId 还原」——包已在服务端且下载链接有效，不必再复制一份。
 */
async function restoreFromEntries(
  assetStore: AssetStore,
  dataDir: string,
  presetId: string,
  entries: ZipEntry[],
  parsed: ParsedPack,
  reusePack?: { packId: string; downloadUrl: string; downloadFilename: string; metadataJson: string }
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
    restored.push({
      role,
      ...(file.label ? { label: String(file.label) } : {}),
      filename: path.basename(entry.name),
      zipPath: entry.name,
      assetId,
      ...(cleanText(file.prompt) ? { prompt: String(file.prompt) } : {}),
      ...(cleanText(file.style) ? { style: String(file.style) } : {}),
      ...(cleanText(file.emotion) ? { emotion: String(file.emotion) } : {}),
      ...(cleanText(file.sourceAssetId) ? { sourceAssetId: String(file.sourceAssetId) } : {})
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
  const extraDetails: Partial<Record<PackFileRole, { prompt?: string; style?: string }>> = {};
  for (const [role, key] of EXTRA_KEYS) {
    const file = restored.find((f) => f.role === role);
    if (!file) continue;
    extraIds[key] = file.assetId;
    const detail = {
      ...(file.prompt ? { prompt: file.prompt } : {}),
      ...(file.style ? { style: file.style } : {})
    };
    if (Object.keys(detail).length) extraDetails[role] = detail;
  }
  const reference = restored.find((f) => f.role === "reference");

  const sourceGeneration = parsed.generation ?? {};
  const generation: PackGenerationInfo = {
    ...sourceGeneration,
    // 参考图导入后拿到新的 assetId，下次重建 ZIP 仍要带上它
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
    role: "sticker" as const
  }));

  const metadata = {
    title: cleanText(parsed.metadata?.title),
    author: cleanText(parsed.metadata?.author),
    version: cleanText(parsed.metadata?.version),
    copyright: cleanText(parsed.metadata?.copyright),
    rewardMessage: cleanText(parsed.metadata?.rewardMessage)
  };

  let packId: string;
  let downloadFilename: string;
  let metadataJson: string;
  let downloadUrl: string;
  if (reusePack) {
    ({ packId, downloadFilename, metadataJson, downloadUrl } = reusePack);
  } else {
    const built = await buildZipPack(assetStore, dataDir, {
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
    });
    packId = built.packId;
    downloadFilename = built.downloadFilename;
    metadataJson = built.metadataJson;
    downloadUrl = `/api/packs/${packId}/download`;
  }

  const validation = await validateAssetList(
    assetStore,
    presetId,
    assetsPayload.map((a) => a.assetId)
  );
  if (!validation.ok) {
    warnings.push("还原的贴纸与当前平台规格不完全一致，导出前建议先单张重新生成或核对尺寸");
  }

  const includeReward = Boolean(extraIds.rewardGuideAssetId || extraIds.rewardThanksAssetId);

  return {
    packId,
    downloadUrl,
    downloadFilename,
    metadataJson,
    stickers: assetsPayload.map((a, i) => ({
      ...a,
      url: `/api/assets/${a.assetId}`,
      ...(stickerFiles[i].prompt ? { prompt: stickerFiles[i].prompt } : {}),
      ...(stickerFiles[i].style ? { style: stickerFiles[i].style } : {}),
      ...(stickerFiles[i].emotion ? { emotion: stickerFiles[i].emotion } : {}),
      ...(stickerFiles[i].sourceAssetId ? { sourceAssetId: stickerFiles[i].sourceAssetId } : {})
    })),
    extras: extraIds,
    extraDetails,
    generation,
    meta: {
      count: assetsPayload.length,
      styles: generation.styles ?? ["导入 ZIP"],
      title: metadata.title ?? null,
      author: metadata.author ?? null,
      version: metadata.version ?? null,
      copyright: metadata.copyright ?? null,
      rewardMessage: metadata.rewardMessage ?? null,
      rewardEnabled: includeReward,
      referenceAssetId: reference?.assetId ?? null,
      referenceMode: generation.referenceMode ?? (reference ? "restored" : "none"),
      presetId
    },
    restored: {
      fromPackId: cleanText(parsed.packId) ?? null,
      schema: cleanText(parsed.schema) ?? null,
      warnings
    }
  };
}
