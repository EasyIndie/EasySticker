import fs from "node:fs";
import path from "node:path";
import { uploadsDir } from "./paths";
import type { AssetStore } from "./assets";

/**
 * 素材归属索引。
 *
 * 之前 uploads 目录里的文件没有「谁传的」信息，于是硬删账号时只能清掉
 * 「被其名下包引用过」的素材；用户传了、但一直没进任何包的散图无法归属，
 * 只能等 6 小时后的常规 GC 当孤儿回收。
 *
 * 这里用一个**追加写**的 JSONL 记录 assetId → owner：
 * - 追加是 O(1)，不会随目录增长而变慢（生成一个包会落盘 ~30 张图）；
 * - 低频的清理操作才重写整个文件。
 *
 * 文件以 `.` 开头，`listAssetFiles` 会跳过，因此不会被当成素材统计或回收。
 */

const OWNER_FILE = ".owners.jsonl";

function indexPath(dataDir: string): string {
  return path.join(uploadsDir(dataDir), OWNER_FILE);
}

export type AssetOwnerEntry = { id: string; owner: string; ts: number };

/** 记录一条归属（owner 为空则忽略）。 */
export function recordAssetOwner(dataDir: string, assetId: string, owner?: string | null): void {
  if (!owner || !assetId) return;
  try {
    fs.mkdirSync(uploadsDir(dataDir), { recursive: true });
    const entry: AssetOwnerEntry = { id: assetId, owner, ts: Date.now() };
    fs.appendFileSync(indexPath(dataDir), JSON.stringify(entry) + "\n", "utf-8");
  } catch (err) {
    console.error("Failed to record asset owner:", err);
  }
}

/** 读取 assetId → owner（后写的记录覆盖先写的）。 */
export function loadAssetOwners(dataDir: string): Map<string, string> {
  const map = new Map<string, string>();
  try {
    const file = indexPath(dataDir);
    if (!fs.existsSync(file)) return map;
    for (const line of fs.readFileSync(file, "utf-8").split("\n")) {
      if (!line) continue;
      try {
        const rec = JSON.parse(line) as AssetOwnerEntry;
        if (rec?.id && rec?.owner) map.set(rec.id, rec.owner);
      } catch {
        /* 跳过损坏行 */
      }
    }
  } catch (err) {
    console.error("Failed to load asset owners:", err);
  }
  return map;
}

/** 删除这些 assetId 的归属记录（重写文件，低频操作）。 */
export function removeAssetOwners(dataDir: string, assetIds: Iterable<string>): void {
  const remove = new Set(assetIds);
  if (remove.size === 0) return;
  try {
    const file = indexPath(dataDir);
    if (!fs.existsSync(file)) return;
    const kept = fs
      .readFileSync(file, "utf-8")
      .split("\n")
      .filter((line) => {
        if (!line) return false;
        try {
          const rec = JSON.parse(line) as AssetOwnerEntry;
          return !remove.has(rec?.id);
        } catch {
          return true;
        }
      });
    fs.writeFileSync(file, kept.length ? kept.join("\n") + "\n" : "", "utf-8");
  } catch (err) {
    console.error("Failed to remove asset owners:", err);
  }
}

/**
 * 压缩索引：只保留「文件仍然存在」的归属记录。
 * 包被删、素材被回收后索引里会留下指向已删文件的旧记录，定期清一次。
 */
export function pruneAssetOwners(dataDir: string, existingIds: Iterable<string>): void {
  const existing = new Set(existingIds);
  try {
    const file = indexPath(dataDir);
    if (!fs.existsSync(file)) return;
    const kept: string[] = [];
    for (const line of fs.readFileSync(file, "utf-8").split("\n")) {
      if (!line) continue;
      try {
        const rec = JSON.parse(line) as AssetOwnerEntry;
        if (rec?.id && existing.has(rec.id)) kept.push(line);
      } catch {
        /* 丢弃损坏行 */
      }
    }
    fs.writeFileSync(file, kept.length ? kept.join("\n") + "\n" : "", "utf-8");
  } catch (err) {
    console.error("Failed to prune asset owners:", err);
  }
}

/**
 * 用一个「带归属」的 store 包住原 store：任何经它 `save` 的素材都会记下 owner。
 * 这样各生成/导入服务无需感知归属，只在路由层包一层即可。
 */
export function withAssetOwner(store: AssetStore, dataDir: string, owner?: string | null): AssetStore {
  if (!owner) return store;
  return {
    save: (bytes, assetId, ext) => {
      const written = store.save(bytes, assetId, ext);
      recordAssetOwner(dataDir, assetId, owner);
      return written;
    },
    find: (assetId) => store.find(assetId)
  };
}
