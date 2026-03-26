import fs from "node:fs";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import createHttpError from "http-errors";
import { nanoid } from "nanoid";
import { findAssetFile } from "../../lib/assets";
import { uploadsDir } from "../../lib/paths";
import { getImagePool } from "./pool";
import { type BackgroundRemovalOptions, type ProcessImageResult, type ProcessImageTask } from "./types";

export async function processUploadToPng(
  app: FastifyInstance,
  uploadId: string,
  options: BackgroundRemovalOptions
): Promise<{ assetId: string; result: ProcessImageResult }> {
  const input = findAssetFile(app, uploadId);
  if (!input) throw createHttpError(404, "upload not found");

  const assetId = nanoid();
  const dir = uploadsDir(app);
  fs.mkdirSync(dir, { recursive: true });
  const outputPath = path.join(dir, `${assetId}.png`);

  const task: ProcessImageTask = {
    inputPath: input.filePath,
    outputPath,
    options
  };

  const result = (await getImagePool().run(task)) as ProcessImageResult;
  return { assetId, result };
}

