import fs from "node:fs";
import path from "node:path";
import { createFileAssetStore, listAssetFiles, type AssetStore } from "../../lib/assets";
import { readZipEntries } from "../../lib/zip";
import { ensureRetentionStarted, expiryFor } from "./retention";
import {
  deletePack,
  findPackZipPath,
  getPackInfo,
  readPackManifest,
  writePackManifest,
  type PackManifest,
  type PackMetadata
} from "../pack/service";

/**
 * 数据目录清理（GC）。
 *
 * 早期版本 `data/uploads` 与 `data/packs` 只增不减：既没有删除接口，也没有保留策略。
 * 这里做四件事，全部是「可证明安全」的：
 *
 *   1. **压缩旧包**：把仍有 `.zip` 的历史包转成清单（素材本来就在 uploads 里），
 *      ZIP 在下载时现打 —— 立刻回收 `packs/` 的大头；
 *   2. **删除 `.orig` 备份**：`repair-pack` 留下的中间产物；
 *   3. **按保留期删包**（可选，默认关闭）；
 *   4. **回收孤儿素材**：不再被任何包引用的 uploads 文件，且落盘超过安全期。
 *
 * 步骤 4 只删「没有任何包引用」且「足够老」的文件，所以不会碰到正在生成中的资源。
 */

const packsDirOf = (dataDir: string) => path.join(dataDir, "packs");

/** 孤儿素材的安全期：刚落盘还没写进清单的资源不能被回收。 */
const DEFAULT_ORPHAN_MIN_AGE_MS = 6 * 60 * 60 * 1000;

export type GcOptions = {
  dataDir: string;
  /** 便于测试注入；默认是本地文件实现。 */
  assetStore?: AssetStore;
  assetRoot?: string;
  /** 孤儿素材需「无人引用」且「落盘超过这么久」才删。默认 6 小时。 */
  orphanMinAgeMs?: number;
  /** 包保留天数；未设置或 <= 0 表示不按时间清理。 */
  packRetentionDays?: number;
  /** 把只有 ZIP 的历史包压缩成清单。默认 true。 */
  compactLegacyPacks?: boolean;
  /** 删除 repair-pack 留下的 `<packId>.zip.orig`。默认 true。 */
  dropOrigBackups?: boolean;
  /** 只统计不落盘。 */
  dryRun?: boolean;
  now?: number;
};

export type GcReport = {
  dryRun: boolean;
  packs: { total: number; bytes: number; legacyZips: number };
  uploads: { total: number; bytes: number };
  compacted: { count: number; bytes: number; skipped: string[] };
  expired: { count: number; bytes: number; packIds: string[]; retentionStartedAt: string | null };
  orphanAssets: { count: number; bytes: number; keptRecent: number };
  origBackups: { count: number; bytes: number };
  reclaimedBytes: number;
  errors: string[];
};

/** 读一个包的 metadata：优先清单，回退到 ZIP 里的 metadata.json。 */
function readPackMetadata(dataDir: string, packId: string): PackMetadata | null {
  const manifest = readPackManifest(dataDir, packId);
  if (manifest) return manifest.metadata;

  const zipPath = findPackZipPath(dataDir, packId);
  if (!zipPath) return null;
  try {
    // 只解压 metadata.json 这一个条目
    const entries = readZipEntries(fs.readFileSync(zipPath), (name) => name === "metadata.json");
    const entry = entries.find((e) => e.name === "metadata.json");
    if (!entry) return null;
    return JSON.parse(entry.content.toString("utf8")) as PackMetadata;
  } catch {
    return null;
  }
}

function listPackIds(dataDir: string): string[] {
  const dir = packsDirOf(dataDir);
  if (!fs.existsSync(dir)) return [];
  const ids = new Set<string>();
  for (const name of fs.readdirSync(dir)) {
    if (name.endsWith(".zip")) ids.add(name.slice(0, -4));
    else if (name.endsWith(".json")) ids.add(name.slice(0, -5));
  }
  return [...ids].sort();
}

function sumFiles(files: Array<{ bytes?: number | null }>): number {
  return files.reduce((sum, f) => sum + (f.bytes ?? 0), 0);
}

export async function runGc(options: GcOptions): Promise<GcReport> {
  const {
    dataDir,
    assetStore = createFileAssetStore(dataDir),
    orphanMinAgeMs = DEFAULT_ORPHAN_MIN_AGE_MS,
    packRetentionDays = 0,
    compactLegacyPacks = true,
    dropOrigBackups = true,
    dryRun = false,
    now = Date.now()
  } = options;

  const errors: string[] = [];
  const report: GcReport = {
    dryRun,
    packs: { total: 0, bytes: 0, legacyZips: 0 },
    uploads: { total: 0, bytes: 0 },
    compacted: { count: 0, bytes: 0, skipped: [] },
    expired: { count: 0, bytes: 0, packIds: [], retentionStartedAt: null },
    orphanAssets: { count: 0, bytes: 0, keptRecent: 0 },
    origBackups: { count: 0, bytes: 0 },
    reclaimedBytes: 0,
    errors
  };

  const dir = packsDirOf(dataDir);
  let packIds = listPackIds(dataDir);

  /* 1. `.orig` 备份：repair-pack 的中间产物，没有任何运行时代码会读它 */
  if (dropOrigBackups && fs.existsSync(dir)) {
    for (const name of fs.readdirSync(dir)) {
      if (!name.endsWith(".orig")) continue;
      const filePath = path.join(dir, name);
      try {
        const st = fs.statSync(filePath);
        report.origBackups.count += 1;
        report.origBackups.bytes += st.size;
        if (!dryRun) fs.rmSync(filePath, { force: true });
      } catch (error) {
        errors.push(`.orig 处理失败 ${name}: ${(error as Error).message}`);
      }
    }
  }

  /* 2. 压缩旧包：ZIP → 清单（素材都在 uploads 里，下载时现打） */
  if (compactLegacyPacks) {
    for (const packId of packIds) {
      if (readPackManifest(dataDir, packId)) continue;
      const zipPath = findPackZipPath(dataDir, packId);
      if (!zipPath) continue;

      const metadata = readPackMetadata(dataDir, packId);
      if (!metadata) {
        report.compacted.skipped.push(packId);
        continue;
      }
      // 元数据里没有 files[]（很旧的 @0.1 包）就不要压缩：
      // 那种包需要 repair-pack 先补全，而 repair-pack 依赖原 ZIP。
      if (!Array.isArray(metadata.files) || !metadata.files.length) {
        report.compacted.skipped.push(packId);
        continue;
      }
      // 素材不全也不要动 —— 留着原 ZIP 至少还能下载
      const missing = metadata.files.filter((f) => !assetStore.find(f.assetId));
      if (missing.length) {
        report.compacted.skipped.push(packId);
        continue;
      }

      let zipBytes = 0;
      try {
        zipBytes = fs.statSync(zipPath).size;
      } catch {
        /* 忽略 */
      }
      const manifest: PackManifest = {
        packId,
        downloadFilename: getPackInfo(dataDir, packId).downloadFilename,
        metadata
      };
      report.compacted.count += 1;
      report.compacted.bytes += zipBytes;
      if (!dryRun) {
        try {
          writePackManifest(dataDir, manifest);
          fs.rmSync(zipPath, { force: true });
        } catch (error) {
          errors.push(`压缩失败 ${packId}: ${(error as Error).message}`);
        }
      }
    }
  }

  /* 3. 按保留期删包 */
  if (packRetentionDays > 0) {
    // 策略起点：过期时间 = max(包创建时间, 策略生效时间) + 保留天数。
    // 这样「刚开启保留期」不会把既有数据一次性清空，每个包都有完整窗口。
    const { retentionStartedAt } = ensureRetentionStarted(dataDir, now);
    report.expired.retentionStartedAt = retentionStartedAt;

    for (const packId of packIds) {
      const metadata = readPackMetadata(dataDir, packId);
      const zipPath = findPackZipPath(dataDir, packId);
      const rawCreated = metadata?.createdAt;
      const createdAt =
        rawCreated && Number.isFinite(Date.parse(rawCreated))
          ? rawCreated
          : zipPath
            ? new Date(fs.statSync(zipPath).mtimeMs).toISOString()
            : null;
      if (!createdAt) continue;

      const expiresAt = expiryFor(createdAt, packRetentionDays, retentionStartedAt);
      if (!expiresAt || Date.parse(expiresAt) > now) continue;

      report.expired.count += 1;
      report.expired.packIds.push(packId);
      report.expired.bytes += zipPath ? fs.statSync(zipPath).size : 0;
      if (!dryRun) {
        try {
          deletePack(dataDir, packId);
        } catch (error) {
          errors.push(`删除过期包失败 ${packId}: ${(error as Error).message}`);
        }
      }
    }
    // 过期包被删掉后，它们的素材才会变成孤儿，所以重新列一次
    packIds = listPackIds(dataDir);
  }

  /* 4. 孤儿素材回收 */
  const referencedAssetIds = new Set<string>();
  for (const packId of packIds) {
    const metadata = readPackMetadata(dataDir, packId);
    if (!metadata) continue;
    for (const file of metadata.files) referencedAssetIds.add(file.assetId);
  }

  // 统计包与素材的当前占用
  const assetFiles = listAssetFiles(dataDir);
  report.uploads.total = assetFiles.length;
  report.uploads.bytes = assetFiles.reduce((sum, f) => sum + f.bytes, 0);
  report.packs.total = packIds.length;
  for (const packId of packIds) {
    const zipPath = findPackZipPath(dataDir, packId);
    if (zipPath) {
      report.packs.legacyZips += 1;
      report.packs.bytes += fs.statSync(zipPath).size;
    } else {
      report.packs.bytes += sumFiles(readPackManifest(dataDir, packId)?.metadata.files ?? []);
    }
  }

  for (const file of assetFiles) {
    if (referencedAssetIds.has(file.assetId)) continue;
    if (now - file.mtimeMs < orphanMinAgeMs) {
      report.orphanAssets.keptRecent += 1;
      continue;
    }
    report.orphanAssets.count += 1;
    report.orphanAssets.bytes += file.bytes;
    if (!dryRun) {
      try {
        fs.rmSync(file.filePath, { force: true });
      } catch (error) {
        errors.push(`删除孤儿素材失败 ${file.filename}: ${(error as Error).message}`);
      }
    }
  }

  report.reclaimedBytes =
    report.compacted.bytes + report.origBackups.bytes + report.orphanAssets.bytes + report.expired.bytes;

  return report;
}
