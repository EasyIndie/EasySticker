import fs from "node:fs";
import path from "node:path";
import { finished } from "node:stream/promises";
import type { FastifyInstance } from "fastify";
import createHttpError from "http-errors";
import GIFEncoder from "gif-encoder-2";
import { nanoid } from "nanoid";
import sharp from "sharp";
import UPNG from "upng-js";
import { findAssetFile } from "../../lib/assets";
import { uploadsDir } from "../../lib/paths";

export type AnimatedGenerateRequest = {
  frameAssetIds: string[];
  size: number;
  delayMs: number;
  format: "gif" | "webp" | "apng";
};

async function loadFrameRgba(app: FastifyInstance, assetId: string, size: number): Promise<Buffer> {
  const input = findAssetFile(app, assetId);
  if (!input) throw createHttpError(404, `frame asset not found: ${assetId}`);

  const buf = await sharp(input.filePath)
    .ensureAlpha()
    .resize(size, size, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .raw()
    .toBuffer();

  return buf;
}

async function encodeGif(frames: Buffer[], size: number, delayMs: number, outPath: string) {
  const encoder = new GIFEncoder(size, size, "neuquant", true);
  const stream = encoder.createReadStream();
  const out = fs.createWriteStream(outPath);
  stream.pipe(out);

  encoder.start();
  encoder.setRepeat(0);
  encoder.setDelay(delayMs);
  encoder.setQuality(10);
  for (const frame of frames) encoder.addFrame(frame);
  encoder.finish();

  await finished(out);
}

async function encodeApng(frames: Buffer[], size: number, delays: number[], outPath: string) {
  const abufs = frames.map((b) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
  const png = UPNG.encode(abufs, size, size, 0, delays);
  fs.writeFileSync(outPath, Buffer.from(png));
}

export async function generateAnimated(app: FastifyInstance, req: AnimatedGenerateRequest) {
  if (!Array.isArray(req.frameAssetIds) || req.frameAssetIds.length < 2) {
    throw createHttpError(400, "frameAssetIds must have at least 2 frames");
  }
  if (!Number.isFinite(req.size) || req.size <= 0 || req.size > 1024) {
    throw createHttpError(400, "invalid size");
  }
  if (!Number.isFinite(req.delayMs) || req.delayMs < 10 || req.delayMs > 10_000) {
    throw createHttpError(400, "invalid delayMs");
  }

  const dir = uploadsDir(app);
  fs.mkdirSync(dir, { recursive: true });

  const frames = await Promise.all(req.frameAssetIds.map((id) => loadFrameRgba(app, id, req.size)));
  const delays = frames.map(() => req.delayMs);

  if (req.format === "apng") {
    const assetId = nanoid();
    const outPath = path.join(dir, `${assetId}.png`);
    await encodeApng(frames, req.size, delays, outPath);
    return { assetId, url: `/api/assets/${assetId}` };
  }

  const gifId = nanoid();
  const gifPath = path.join(dir, `${gifId}.gif`);
  await encodeGif(frames, req.size, req.delayMs, gifPath);

  if (req.format === "gif") {
    return { assetId: gifId, url: `/api/assets/${gifId}` };
  }

  const webpId = nanoid();
  const webpPath = path.join(dir, `${webpId}.webp`);
  await sharp(gifPath, { animated: true }).webp({ effort: 4, quality: 80, loop: 0 }).toFile(webpPath);
  return { assetId: webpId, url: `/api/assets/${webpId}` };
}
