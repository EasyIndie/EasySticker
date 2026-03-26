import sharp from "sharp";
import { type ProcessImageResult, type ProcessImageTask } from "../services/image/types";

type RGB = { r: number; g: number; b: number };

function clampInt(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(v)));
}

function rgbDistance(a: RGB, b: RGB): number {
  const dr = a.r - b.r;
  const dg = a.g - b.g;
  const db = a.b - b.b;
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

function estimateCornerBackground(data: Buffer, width: number, height: number): RGB {
  const samplePoints = [
    [0, 0],
    [width - 1, 0],
    [0, height - 1],
    [width - 1, height - 1]
  ];

  let r = 0;
  let g = 0;
  let b = 0;
  for (const [x, y] of samplePoints) {
    const idx = (y * width + x) * 4;
    r += data[idx] ?? 0;
    g += data[idx + 1] ?? 0;
    b += data[idx + 2] ?? 0;
  }
  const n = samplePoints.length;
  return { r: r / n, g: g / n, b: b / n };
}

function findForegroundBounds(
  data: Buffer,
  width: number,
  height: number,
  bg: RGB,
  threshold: number
): { left: number; top: number; width: number; height: number } | null {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const rgb: RGB = { r: data[idx] ?? 0, g: data[idx + 1] ?? 0, b: data[idx + 2] ?? 0 };
      const dist = rgbDistance(rgb, bg);
      if (dist > threshold) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (maxX < 0 || maxY < 0) return null;

  const margin = Math.max(2, Math.round(Math.max(maxX - minX, maxY - minY) * 0.06));
  const left = Math.max(0, minX - margin);
  const top = Math.max(0, minY - margin);
  const right = Math.min(width - 1, maxX + margin);
  const bottom = Math.min(height - 1, maxY + margin);

  return { left, top, width: right - left + 1, height: bottom - top + 1 };
}

function applyBackgroundRemoval(
  data: Buffer,
  width: number,
  height: number,
  bg: RGB,
  threshold: number,
  softness: number
): Buffer {
  const out = Buffer.from(data);
  const t1 = threshold;
  const t2 = threshold + softness;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const rgb: RGB = { r: out[idx] ?? 0, g: out[idx + 1] ?? 0, b: out[idx + 2] ?? 0 };
      const dist = rgbDistance(rgb, bg);
      const alpha =
        dist <= t1 ? 0 : dist >= t2 ? 255 : clampInt(((dist - t1) / (t2 - t1)) * 255, 0, 255);
      const existing = out[idx + 3] ?? 255;
      out[idx + 3] = Math.min(existing, alpha);
    }
  }

  return out;
}

export default async function processImage(task: ProcessImageTask): Promise<ProcessImageResult> {
  const threshold = task.options.threshold ?? 28;
  const softness = task.options.softness ?? 28;

  const meta = await sharp(task.inputPath).metadata();
  const originalW = meta.width ?? 0;
  const originalH = meta.height ?? 0;
  if (!originalW || !originalH) {
    throw new Error("invalid image metadata");
  }

  const analysis = await sharp(task.inputPath)
    .ensureAlpha()
    .resize({ width: 256, height: 256, fit: "inside" })
    .raw()
    .toBuffer({ resolveWithObject: true });

  const bg = estimateCornerBackground(analysis.data, analysis.info.width, analysis.info.height);
  const boundsSmall = findForegroundBounds(analysis.data, analysis.info.width, analysis.info.height, bg, threshold);

  const scaleX = originalW / analysis.info.width;
  const scaleY = originalH / analysis.info.height;
  const extract =
    boundsSmall === null
      ? { left: 0, top: 0, width: originalW, height: originalH }
      : {
          left: clampInt(boundsSmall.left * scaleX, 0, originalW - 1),
          top: clampInt(boundsSmall.top * scaleY, 0, originalH - 1),
          width: clampInt(boundsSmall.width * scaleX, 1, originalW),
          height: clampInt(boundsSmall.height * scaleY, 1, originalH)
        };

  if (extract.left + extract.width > originalW) extract.width = originalW - extract.left;
  if (extract.top + extract.height > originalH) extract.height = originalH - extract.top;

  const cropped = await sharp(task.inputPath)
    .extract(extract)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const removed = applyBackgroundRemoval(cropped.data, cropped.info.width, cropped.info.height, bg, threshold, softness);

  await sharp(removed, {
    raw: {
      width: cropped.info.width,
      height: cropped.info.height,
      channels: 4
    }
  })
    .png()
    .toFile(task.outputPath);

  return { width: cropped.info.width, height: cropped.info.height };
}

