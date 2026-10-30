import fs from "node:fs";
import { type FastifyInstance } from "fastify";
import createHttpError from "http-errors";
import {
  createPack,
  createPackArchive,
  deletePack,
  findPackZipPath,
  getPackInfo,
  listPacks,
  missingPackFiles,
  packExists,
  readPackManifest
} from "../services/pack/service";
import { canManagePack, resolveRequester } from "../lib/owner";
import { loadPromptConfig } from "../services/generate/promptConfig";
import { ensureRetentionStarted } from "../services/maintenance/retention";
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
    // 生成/重建一个包：只写清单（几 KB），ZIP 在下载时现打。
    app.post("/packs", async (req, reply) => {
      const parsed = packSchema.safeParse(req.body);
      if (!parsed.success) {
        reply.status(400);
        return { error: "BadRequest", message: "invalid request body", issues: parsed.error.issues };
      }

      const { owner } = await resolveRequester(req);
      const { packId, downloadUrl, downloadFilename, metadataJson } = await createPack(
        deps.assetStore,
        deps.dataDir,
        parsed.data,
        owner
      );
      return { packId, downloadUrl, downloadFilename, metadataJson };
    });

    // 当前用户自己的包列表（已登录按邮箱，未登录按 x-client-id）。
    // 服务端是「这个用户有哪些包」的权威来源，前端用它把历史记录补回来。
    app.get("/packs", async (req) => {
      const requester = await resolveRequester(req);
      const retentionDays = loadPromptConfig().server?.maintenance?.packRetentionDays ?? 0;
      const { retentionStartedAt } = retentionDays > 0 ? ensureRetentionStarted(deps.dataDir) : { retentionStartedAt: null };
      const all = listPacks(deps.dataDir, retentionDays, retentionStartedAt);
      const packs = requester.isAdmin
        ? all
        : all.filter((p) => requester.owner !== null && p.owner === requester.owner);
      return { packs, retentionDays, owner: requester.owner, isAdmin: requester.isAdmin };
    });

    app.get<{
      Params: { packId: string };
    }>("/packs/:packId/download", async (req, reply) => {
      const { packId } = req.params;
      if (!packExists(deps.dataDir, packId)) throw createHttpError(404, "pack not found");

      // 先把「拿不到内容」的情况判完，避免设了响应头再抛错
      const legacyZip = findPackZipPath(deps.dataDir, packId);
      const manifest = legacyZip ? null : readPackManifest(deps.dataDir, packId);
      if (!legacyZip && !manifest) throw createHttpError(404, "pack not found");

      let missing: string[] = [];
      if (manifest) {
        missing = missingPackFiles(deps.assetStore, manifest);
        if (missing.length) {
          throw createHttpError(410, `原始素材已被清理，无法重新打包（缺少 ${missing.length} 个文件）`);
        }
      }

      const info = getPackInfo(deps.dataDir, packId);
      reply.header("content-type", "application/zip");
      reply.header("content-disposition", buildDownloadDisposition(info.downloadFilename));

      // 旧包：磁盘上存着现成的 ZIP，直接流出去
      if (legacyZip) return reply.send(fs.createReadStream(legacyZip));

      // 新包：按清单现场打包，边打边发，磁盘不留副本
      return reply.send(createPackArchive(deps.assetStore, manifest!));
    });

    // 历史记录「一键还原」：直接拿服务端存的包还原生成现场，不需要用户再找文件。
    app.post<{
      Params: { packId: string };
    }>("/packs/:packId/restore", async (req, reply) => {
      const presetId =
        (req.body as { presetId?: string } | undefined)?.presetId || "wechat_stickers";
      const requester = await resolveRequester(req);
      const manifest = readPackManifest(deps.dataDir, req.params.packId);
      if (manifest && !canManagePack(requester, manifest.owner)) {
        reply.status(403);
        return { error: "Forbidden", message: "这个表情包不属于当前账号" };
      }
      return restorePackById(deps.assetStore, deps.dataDir, presetId, req.params.packId, requester.owner);
    });

    // 包的生命周期收尾：删掉清单（与旧 ZIP），素材留给 GC 回收。
    // 访问级别与 download / restore 一致（凭 packId），不额外开权限口子。
    app.delete<{
      Params: { packId: string };
    }>("/packs/:packId", async (req, reply) => {
      if (!packExists(deps.dataDir, req.params.packId)) {
        reply.status(404);
        return { error: "NotFound", message: "pack not found" };
      }
      const requester = await resolveRequester(req);
      const manifest = readPackManifest(deps.dataDir, req.params.packId);
      if (!canManagePack(requester, manifest?.owner)) {
        reply.status(403);
        return { error: "Forbidden", message: "这个表情包不属于当前账号" };
      }
      deletePack(deps.dataDir, req.params.packId);
      return { ok: true, packId: req.params.packId };
    });

    app.get<{
      Params: { packId: string };
    }>("/packs/:packId", async (req) => {
      const { packId } = req.params;
      if (!packExists(deps.dataDir, packId)) throw createHttpError(404, "pack not found");
      const info = getPackInfo(deps.dataDir, packId);
      const zipPath = findPackZipPath(deps.dataDir, packId);
      const manifest = readPackManifest(deps.dataDir, packId);
      return {
        packId,
        filename: info.downloadFilename,
        hasZip: Boolean(zipPath),
        // 旧包是 ZIP 体积；新包是清单里各素材体积之和（下载时现打）
        bytes: zipPath
          ? fs.statSync(zipPath).size
          : (manifest?.metadata.files ?? []).reduce((sum, f) => sum + (f.bytes ?? 0), 0)
      };
    });
  };
}
