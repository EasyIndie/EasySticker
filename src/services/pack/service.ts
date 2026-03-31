import fs from "node:fs";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import createHttpError from "http-errors";
import archiver from "archiver";
import { nanoid } from "nanoid";
import { findAssetFile } from "../../lib/assets";

export type PackRequest = {
  presetId: string;
  assetIds?: string[];
  assets?: Array<{ label: string; assetId: string }>;
  coverAssetId?: string;
  bannerAssetId?: string;
  iconAssetId?: string;
  rewardGuideAssetId?: string;
  rewardThanksAssetId?: string;
  metadata?: {
    title?: string;
    author?: string;
    copyright?: string;
    version?: string;
    rewardMessage?: string;
  };
};

export type PackInfo = {
  packId: string;
  downloadFilename: string;
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
  extras: {
    coverAssetId: string | null;
    bannerAssetId: string | null;
    iconAssetId: string | null;
    rewardGuideAssetId: string | null;
    rewardThanksAssetId: string | null;
  };
  assets: Array<{ assetId: string; filename: string; zipPath: string }>;
};

function packsDir(app: FastifyInstance) {
  return path.join(app.appConfig.dataDir, "packs");
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

function packInfoPath(app: FastifyInstance, packId: string) {
  return path.join(packsDir(app), `${packId}.json`);
}

function buildPackMetadata(
  packId: string,
  req: PackRequest,
  entries: Array<{ assetId: string; filename: string; zipPath: string }>,
  createdAt = new Date().toISOString()
): PackMetadata {
  return {
    schema: "easysticker-pack@0.1",
    packId,
    presetId: req.presetId,
    createdAt,
    metadata: req.metadata ?? {},
    extras: {
      coverAssetId: req.coverAssetId ?? null,
      bannerAssetId: req.bannerAssetId ?? null,
      iconAssetId: req.iconAssetId ?? null,
      rewardGuideAssetId: req.rewardGuideAssetId ?? null,
      rewardThanksAssetId: req.rewardThanksAssetId ?? null
    },
    assets: entries
  };
}

export async function buildZipPack(app: FastifyInstance, req: PackRequest) {
  const normalizedAssets =
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
  const dir = packsDir(app);
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

  for (const asset of normalizedAssets) {
    const id = asset.assetId;
    const file = findAssetFile(app, id);
    if (!file) throw createHttpError(404, `asset not found: ${id}`);

    const ext = path.extname(file.filename).toLowerCase();
    const name = `${asset.label}${ext}`;
    const inZip = path.posix.join("assets", name);
    zip.file(file.filePath, { name: inZip });
    entries.push({ assetId: id, filename: name, zipPath: inZip });
  }

  if (req.coverAssetId) {
    const cover = findAssetFile(app, req.coverAssetId);
    if (!cover) throw createHttpError(404, `asset not found: ${req.coverAssetId}`);
    const ext = path.extname(cover.filename).toLowerCase();
    zip.file(cover.filePath, { name: path.posix.join("meta", `cover${ext}`) });
  }
  if (req.bannerAssetId) {
    const banner = findAssetFile(app, req.bannerAssetId);
    if (!banner) throw createHttpError(404, `asset not found: ${req.bannerAssetId}`);
    const ext = path.extname(banner.filename).toLowerCase();
    zip.file(banner.filePath, { name: path.posix.join("meta", `banner${ext}`) });
  }
  if (req.iconAssetId) {
    const icon = findAssetFile(app, req.iconAssetId);
    if (!icon) throw createHttpError(404, `asset not found: ${req.iconAssetId}`);
    const ext = path.extname(icon.filename).toLowerCase();
    zip.file(icon.filePath, { name: path.posix.join("meta", `icon${ext}`) });
  }
  if (req.rewardGuideAssetId) {
    const rewardGuide = findAssetFile(app, req.rewardGuideAssetId);
    if (!rewardGuide) throw createHttpError(404, `asset not found: ${req.rewardGuideAssetId}`);
    const ext = path.extname(rewardGuide.filename).toLowerCase();
    zip.file(rewardGuide.filePath, { name: path.posix.join("meta", `reward-guide${ext}`) });
  }
  if (req.rewardThanksAssetId) {
    const rewardThanks = findAssetFile(app, req.rewardThanksAssetId);
    if (!rewardThanks) throw createHttpError(404, `asset not found: ${req.rewardThanksAssetId}`);
    const ext = path.extname(rewardThanks.filename).toLowerCase();
    zip.file(rewardThanks.filePath, { name: path.posix.join("meta", `reward-thanks${ext}`) });
  }

  const metadata = buildPackMetadata(packId, req, entries);
  const metadataJson = JSON.stringify(metadata, null, 2);
  zip.append(metadataJson, { name: "metadata.json" });

  await zip.finalize();
  await done;

  fs.writeFileSync(packInfoPath(app, packId), JSON.stringify({ packId, downloadFilename }, null, 2));

  return { packId, zipPath, downloadFilename, metadataJson };
}

export function getPackZipPath(app: FastifyInstance, packId: string) {
  const filePath = path.join(packsDir(app), `${packId}.zip`);
  if (!fs.existsSync(filePath)) throw createHttpError(404, "pack not found");
  return filePath;
}

export function getPackInfo(app: FastifyInstance, packId: string): PackInfo {
  const infoPath = packInfoPath(app, packId);
  if (fs.existsSync(infoPath)) {
    return JSON.parse(fs.readFileSync(infoPath, "utf8")) as PackInfo;
  }
  return { packId, downloadFilename: `${packId}.zip` };
}
