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
      return reply.send(fs.createReadStream(file.filePath));
    });
  };
}
