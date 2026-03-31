import fs from "node:fs";
import { type FastifyInstance } from "fastify";
import { z } from "zod";
import { buildZipPack, getPackInfo, getPackZipPath } from "../services/pack/service";

function buildDownloadDisposition(filename: string) {
  const asciiFallback = filename.replace(/[^\x20-\x7E]/g, "_").replace(/["\\]/g, "_");
  const encodedFilename = encodeURIComponent(filename);
  return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodedFilename}`;
}

const schema = z.object({
  presetId: z.string().min(1),
  assetIds: z.array(z.string().min(1)).optional(),
  assets: z
    .array(
      z.object({
        label: z.string().min(1),
        assetId: z.string().min(1)
      })
    )
    .optional(),
  coverAssetId: z.string().min(1).optional(),
  bannerAssetId: z.string().min(1).optional(),
  iconAssetId: z.string().min(1).optional(),
  rewardGuideAssetId: z.string().min(1).optional(),
  rewardThanksAssetId: z.string().min(1).optional(),
  metadata: z
    .object({
      title: z.string().min(1).optional(),
      author: z.string().min(1).optional(),
      copyright: z.string().min(1).optional(),
      version: z.string().min(1).optional(),
      rewardMessage: z.string().min(1).optional()
    })
    .optional()
});

export async function registerPackRoutes(app: FastifyInstance) {
  app.post("/packs", async (req, reply) => {
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      reply.status(400);
      return { error: "BadRequest", message: "invalid request body", issues: parsed.error.issues };
    }

    const { packId, downloadFilename } = await buildZipPack(app, parsed.data);
    return { packId, downloadUrl: `/api/packs/${packId}/download`, downloadFilename };
  });

  app.get<{
    Params: { packId: string };
  }>("/packs/:packId/download", async (req, reply) => {
    const zipPath = getPackZipPath(app, req.params.packId);
    const info = getPackInfo(app, req.params.packId);
    reply.header("content-type", "application/zip");
    reply.header("content-disposition", buildDownloadDisposition(info.downloadFilename));
    return reply.send(fs.createReadStream(zipPath));
  });

  app.get<{
    Params: { packId: string };
  }>("/packs/:packId", async (req) => {
    const zipPath = getPackZipPath(app, req.params.packId);
    const st = fs.statSync(zipPath);
    const info = getPackInfo(app, req.params.packId);
    return { packId: req.params.packId, bytes: st.size, filename: info.downloadFilename };
  });
}
