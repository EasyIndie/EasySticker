import fs from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import { nanoid } from "nanoid";
import createHttpError from "http-errors";
import { uploadsDir } from "../lib/paths";

function extFromMime(mime: string): string {
  if (mime === "image/png") return ".png";
  if (mime === "image/jpeg") return ".jpg";
  return "";
}

export async function registerUploadRoutes(app: FastifyInstance) {
  app.post("/uploads", async (req: FastifyRequest, reply: FastifyReply) => {
    const part = await req.file();
    if (!part) throw createHttpError(400, "missing multipart file field");

    const ext = extFromMime(part.mimetype);
    if (!ext) throw createHttpError(415, "only image/png and image/jpeg are supported");

    const id = nanoid();
    const dir = uploadsDir(app);
    fs.mkdirSync(dir, { recursive: true });

    const filePath = path.join(dir, `${id}${ext}`);
    await pipeline(part.file, fs.createWriteStream(filePath));

    reply.send({
      uploadId: id,
      original: {
        mime: part.mimetype,
        filename: part.filename,
        path: filePath,
        url: `/api/assets/${id}`
      }
    });
  });
}
