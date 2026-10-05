import fs from "node:fs";
import { type FastifyInstance } from "fastify";
import { buildZipPack, getPackInfo, getPackZipPath } from "../services/pack/service";
import { restorePackById } from "../services/generate/restore";
import { packSchema } from "../shared/contracts";
import type { AppDeps } from "../lib/deps";

function buildDownloadDisposition(filename: string) {
  const asciiFallback = filename.replace(/[^\x20-\x7E]/g, "_").replace(/["\\]/g, "_");
  const encodedFilename = encodeURIComponent(filename);
  return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodedFilename}`;
}

export function registerPackRoutes(deps: AppDeps) {
  return async (app: FastifyInstance) => {
    app.post("/packs", async (req, reply) => {
      const parsed = packSchema.safeParse(req.body);
      if (!parsed.success) {
        reply.status(400);
        return { error: "BadRequest", message: "invalid request body", issues: parsed.error.issues };
      }

      const { packId, downloadFilename } = await buildZipPack(deps.assetStore, deps.dataDir, parsed.data);
      return { packId, downloadUrl: `/api/packs/${packId}/download`, downloadFilename };
    });

    app.get<{
      Params: { packId: string };
    }>("/packs/:packId/download", async (req, reply) => {
      const zipPath = getPackZipPath(deps.dataDir, req.params.packId);
      const info = getPackInfo(deps.dataDir, req.params.packId);
      reply.header("content-type", "application/zip");
      reply.header("content-disposition", buildDownloadDisposition(info.downloadFilename));
      return reply.send(fs.createReadStream(zipPath));
    });

    // 历史记录「一键还原」：直接拿服务端存的包还原生成现场，不需要用户再找文件。
    app.post<{
      Params: { packId: string };
    }>("/packs/:packId/restore", async (req) => {
      const presetId =
        (req.body as { presetId?: string } | undefined)?.presetId || "wechat_stickers";
      return restorePackById(deps.assetStore, deps.dataDir, presetId, req.params.packId);
    });

    app.get<{
      Params: { packId: string };
    }>("/packs/:packId", async (req) => {
      const zipPath = getPackZipPath(deps.dataDir, req.params.packId);
      const st = fs.statSync(zipPath);
      const info = getPackInfo(deps.dataDir, req.params.packId);
      return { packId: req.params.packId, bytes: st.size, filename: info.downloadFilename };
    });
  };
}
