import fs from "node:fs";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import createHttpError from "http-errors";
import { nanoid } from "nanoid";
import sharp from "sharp";
import { findAssetFile } from "../../lib/assets";
import { uploadsDir } from "../../lib/paths";

export type TextOverlay = {
  content: string;
  fontSize?: number;
  color?: string;
  strokeColor?: string;
  strokeWidth?: number;
};

export type StaticGenerateRequest = {
  assetId: string;
  sizes: number[];
  format?: "png" | "webp";
  text?: TextOverlay;
  effect?: "none" | "shadow" | "glow";
};

function buildTextSvg(size: number, text: TextOverlay, effect: "none" | "shadow" | "glow"): Buffer {
  const fontSize = text.fontSize ?? Math.round(size * 0.14);
  const color = text.color ?? "#ffffff";
  const strokeColor = text.strokeColor ?? "rgba(0,0,0,0.65)";
  const strokeWidth = text.strokeWidth ?? Math.max(2, Math.round(fontSize * 0.12));

  const filter =
    effect === "shadow"
      ? `<filter id="fx"><feDropShadow dx="0" dy="6" stdDeviation="6" flood-color="rgba(0,0,0,0.55)"/></filter>`
      : effect === "glow"
        ? `<filter id="fx"><feGaussianBlur stdDeviation="5" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>`
        : "";

  const y = Math.round(size * 0.88);
  const escaped = text.content
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
  <defs>${filter}</defs>
  <text x="50%" y="${y}" text-anchor="middle" dominant-baseline="middle"
        font-family="system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial"
        font-size="${fontSize}"
        fill="${color}"
        stroke="${strokeColor}"
        stroke-width="${strokeWidth}"
        paint-order="stroke"
        ${effect === "none" ? "" : 'filter="url(#fx)"'}>
    ${escaped}
  </text>
</svg>`;

  return Buffer.from(svg);
}

export async function generateStatic(app: FastifyInstance, req: StaticGenerateRequest) {
  const input = findAssetFile(app, req.assetId);
  if (!input) throw createHttpError(404, "asset not found");

  const dir = uploadsDir(app);
  fs.mkdirSync(dir, { recursive: true });

  const format = req.format ?? "png";
  const effect = req.effect ?? "none";

  const results: Array<{ size: number; assetId: string; url: string }> = [];

  for (const size of req.sizes) {
    if (!Number.isFinite(size) || size <= 0 || size > 2048) {
      throw createHttpError(400, "invalid size");
    }

    const outId = nanoid();
    const ext = format === "png" ? ".png" : ".webp";
    const outPath = path.join(dir, `${outId}${ext}`);

    let pipeline = sharp(input.filePath)
      .ensureAlpha()
      .resize(size, size, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } });

    if (req.text?.content) {
      const svg = buildTextSvg(size, req.text, effect);
      pipeline = pipeline.composite([{ input: svg, top: 0, left: 0 }]);
    }

    if (format === "png") await pipeline.png().toFile(outPath);
    else await pipeline.webp({ quality: 90 }).toFile(outPath);

    results.push({ size, assetId: outId, url: `/api/assets/${outId}` });
  }

  return results;
}

