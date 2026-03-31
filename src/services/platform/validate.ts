import fs from "node:fs";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import createHttpError from "http-errors";
import sharp from "sharp";
import { findAssetFile } from "../../lib/assets";
import { PLATFORM_PRESETS } from "./presets";

export type ValidationIssue = { code: string; message: string };

export async function validateAsset(app: FastifyInstance, presetId: string, assetId: string) {
  const preset = PLATFORM_PRESETS.find((p) => p.id === presetId);
  if (!preset) throw createHttpError(404, "unknown preset");

  const asset = findAssetFile(app, assetId);
  if (!asset) throw createHttpError(404, "asset not found");

  const st = fs.statSync(asset.filePath);
  const ext = path.extname(asset.filename).toLowerCase();

  const issues: ValidationIssue[] = [];
  if (!preset.allowedExts.includes(ext)) {
    issues.push({ code: "format", message: `ext ${ext} not allowed for ${presetId}` });
  }
  if (st.size > preset.maxBytes) {
    issues.push({ code: "size", message: `file too large: ${st.size} bytes (max ${preset.maxBytes})` });
  }

  const meta = await sharp(asset.filePath, { animated: true }).metadata();
  const w = meta.width ?? 0;
  const h = meta.height ?? 0;
  if (!w || !h) issues.push({ code: "dimension", message: "missing width/height" });
  if (w > preset.maxWidth || h > preset.maxHeight) {
    issues.push({ code: "dimension", message: `too large: ${w}x${h} (max ${preset.maxWidth}x${preset.maxHeight})` });
  }
  if (preset.exactWidth && w && w !== preset.exactWidth) {
    issues.push({ code: "dimension", message: `width must be ${preset.exactWidth}: got ${w}` });
  }
  if (preset.exactHeight && h && h !== preset.exactHeight) {
    issues.push({ code: "dimension", message: `height must be ${preset.exactHeight}: got ${h}` });
  }
  if (preset.requiredSquare && w && h && w !== h) {
    issues.push({ code: "dimension", message: `must be square: got ${w}x${h}` });
  }

  return {
    presetId,
    assetId,
    ok: issues.length === 0,
    issues,
    meta: { bytes: st.size, ext, width: w, height: h }
  };
}

export async function validateAssetList(app: FastifyInstance, presetId: string, assetIds: string[]) {
  const preset = PLATFORM_PRESETS.find((p) => p.id === presetId);
  if (!preset) throw createHttpError(404, "unknown preset");
  const issues = [];

  if (preset.minCount && assetIds.length < preset.minCount) {
    issues.push({ code: "count", message: `count must be >= ${preset.minCount}` });
  }
  if (preset.maxCount && assetIds.length > preset.maxCount) {
    issues.push({ code: "count", message: `count must be <= ${preset.maxCount}` });
  }

  const items = [];
  for (const assetId of assetIds) {
    const res = await validateAsset(app, presetId, assetId);
    if (!res.ok) issues.push({ code: "asset", message: `asset ${assetId} not compatible` });
    items.push(res);
  }

  return { presetId, ok: issues.length === 0, issues, items };
}
