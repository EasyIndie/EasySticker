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
  metadata?: {
    title?: string;
    author?: string;
    copyright?: string;
  };
};

function packsDir(app: FastifyInstance) {
  return path.join(app.appConfig.dataDir, "packs");
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

  const meta = {
    schema: "easysticker-pack@0.1",
    packId,
    presetId: req.presetId,
    createdAt: new Date().toISOString(),
    metadata: req.metadata ?? {},
    extras: {
      coverAssetId: req.coverAssetId ?? null,
      bannerAssetId: req.bannerAssetId ?? null,
      iconAssetId: req.iconAssetId ?? null
    },
    assets: entries
  };
  zip.append(JSON.stringify(meta, null, 2), { name: "metadata.json" });

  await zip.finalize();
  await done;

  return { packId, zipPath };
}

export function getPackZipPath(app: FastifyInstance, packId: string) {
  const filePath = path.join(packsDir(app), `${packId}.zip`);
  if (!fs.existsSync(filePath)) throw createHttpError(404, "pack not found");
  return filePath;
}
