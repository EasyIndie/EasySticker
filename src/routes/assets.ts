import fs from "node:fs";
import path from "node:path";
import { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import createHttpError from "http-errors";
import { findAssetFile } from "../lib/assets";

function mimeFromExt(ext: string): string {
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  if (ext === ".gif") return "image/gif";
  return "application/octet-stream";
}

export async function registerAssetRoutes(app: FastifyInstance) {
  app.get<{
    Params: { id: string };
  }>("/assets/:id", async (req: FastifyRequest, reply: FastifyReply) => {
    const id = req.params.id;
    const file = findAssetFile(app, id);
    if (!file) throw createHttpError(404, "asset not found");

    const ext = path.extname(file.filename).toLowerCase();
    reply.type(mimeFromExt(ext));
    return reply.send(fs.createReadStream(file.filePath));
  });
}
