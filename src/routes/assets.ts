import fs from "node:fs";
import path from "node:path";
import { type FastifyInstance } from "fastify";
import createHttpError from "http-errors";
import type { AppDeps } from "../lib/deps";

function mimeFromExt(ext: string): string {
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  if (ext === ".gif") return "image/gif";
  return "application/octet-stream";
}

export function registerAssetRoutes(deps: AppDeps) {
  return async (app: FastifyInstance) => {
    app.get<{
      Params: { id: string };
    }>("/assets/:id", async (req, reply) => {
      const id = req.params.id;
      const file = deps.assetStore.find(id);
      if (!file) throw createHttpError(404, "asset not found");

      const ext = path.extname(file.filename).toLowerCase();
      reply.type(mimeFromExt(ext));
      // assetId 是内容不可变的 nanoid（写入即定，永不覆盖），同一 id 的字节永远相同，
      // 所以可以放心长缓存。这条头直接决定预览区会不会每次导航都重新下载几十张图：
      // 之前没有这个头，实测 24 张贴纸每次加载都完整重传约 1MB。
      reply.header("cache-control", "public, max-age=31536000, immutable");
      return reply.send(fs.createReadStream(file.filePath));
    });
  };
}
