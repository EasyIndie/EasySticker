import fs from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import { nanoid } from "nanoid";
import createHttpError from "http-errors";
import { uploadsDir } from "../lib/paths";
import { recordAssetOwner } from "../lib/assetOwners";
import { resolveRequester } from "../lib/owner";
import type { AppDeps } from "../lib/deps";

function extFromMime(mime: string): string {
  if (mime === "image/png") return ".png";
  if (mime === "image/jpeg") return ".jpg";
  return "";
}

export function registerUploadRoutes(deps: AppDeps) {
  return async (app: FastifyInstance) => {
    app.post("/uploads", async (req: FastifyRequest, reply: FastifyReply) => {
      const part = await req.file();
      if (!part) throw createHttpError(400, "missing multipart file field");

      const ext = extFromMime(part.mimetype);
      if (!ext) throw createHttpError(415, "only image/png and image/jpeg are supported");

      const id = nanoid();
      const dir = uploadsDir(deps.dataDir);
      fs.mkdirSync(dir, { recursive: true });

      const filePath = path.join(dir, `${id}${ext}`);
      await pipeline(part.file, fs.createWriteStream(filePath));

      // 记下归属：硬删账号时据此清理「传了但没进任何包」的散图。
      // owner 已登录是邮箱，未登录是 client:<id>。
      const { owner } = await resolveRequester(req);
      recordAssetOwner(deps.dataDir, id, owner);

      // Log usage for authenticated users
      if (owner && !owner.startsWith("client:")) {
        try {
          deps.usageStore.maybeRotate();
          deps.usageStore.log({ email: owner, action: "upload", success: true });
        } catch {}
      }

      reply.send({
        uploadId: id,
        original: {
          mime: part.mimetype,
          filename: part.filename,
          url: `/api/assets/${id}`
        }
      });
    });
  };
}
