import fs from "node:fs";
import path from "node:path";
import { type FastifyInstance } from "fastify";
import { z } from "zod";
import { buildZipPack, getPackZipPath } from "../services/pack/service";

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
  metadata: z
    .object({
      title: z.string().min(1).optional(),
      author: z.string().min(1).optional(),
      copyright: z.string().min(1).optional()
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

    const { packId } = await buildZipPack(app, parsed.data);
    return { packId, downloadUrl: `/api/packs/${packId}/download` };
  });

  app.get<{
    Params: { packId: string };
  }>("/packs/:packId/download", async (req, reply) => {
    const zipPath = getPackZipPath(app, req.params.packId);
    reply.header("content-type", "application/zip");
    reply.header("content-disposition", `attachment; filename=\"${req.params.packId}.zip\"`);
    return reply.send(fs.createReadStream(zipPath));
  });

  app.get<{
    Params: { packId: string };
  }>("/packs/:packId", async (req) => {
    const zipPath = getPackZipPath(app, req.params.packId);
    const st = fs.statSync(zipPath);
    return { packId: req.params.packId, bytes: st.size, filename: path.basename(zipPath) };
  });
}
