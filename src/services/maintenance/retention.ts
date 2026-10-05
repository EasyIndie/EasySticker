import fs from "node:fs";
import path from "node:path";

/**
 * 保留策略的「生效起点」。
 *
 * 开启按时间删包时不能追溯既往 —— 否则一开启就把历史数据全删了。这里记录策略
 * 首次生效的时间，过期时间按 `max(包创建时间, 生效时间) + 保留天数` 计算：
 * 每个包要么享受完整的保留窗口，要么（更晚创建的包）从自己的创建时间起算。
 *
 * 落在 `data/maintenance.json`，与配置分开：改配置不会重置窗口。
 */

export type RetentionState = {
  /** 策略首次生效时间（ISO）；从未启用过则为 null。 */
  retentionStartedAt: string | null;
};

const STATE_FILE = "maintenance.json";
/** 生效时间的容错范围：比这更早的「起点」视为已失效，需要重新锚定。 */
const ANCHOR_TOLERANCE_MS = 60 * 1000;

function statePath(dataDir: string) {
  return path.join(dataDir, STATE_FILE);
}

export function readRetentionState(dataDir: string): RetentionState {
  try {
    const raw = JSON.parse(fs.readFileSync(statePath(dataDir), "utf8")) as Partial<RetentionState>;
    const startedAt = typeof raw.retentionStartedAt === "string" ? raw.retentionStartedAt : null;
    return { retentionStartedAt: startedAt && Number.isFinite(Date.parse(startedAt)) ? startedAt : null };
  } catch {
    return { retentionStartedAt: null };
  }
}

/**
 * 确保保留策略有一个生效起点。首次调用（或起点在未来）时落盘为 `now`。
 * 只在真的启用保留期（`retentionDays > 0`）时调用。
 */
export function ensureRetentionStarted(dataDir: string, now = Date.now()): RetentionState {
  const current = readRetentionState(dataDir);
  if (current.retentionStartedAt) {
    const stamp = Date.parse(current.retentionStartedAt);
    // 起点不能在未来（例如系统时间被改过）——重新锚定
    if (stamp <= now + ANCHOR_TOLERANCE_MS) return current;
  }
  const startedAt = new Date(now).toISOString();
  try {
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(statePath(dataDir), JSON.stringify({ retentionStartedAt: startedAt }, null, 2));
  } catch {
    // 写不了就不持久化，至少这一次用内存里的值
  }
  return { retentionStartedAt: startedAt };
}

/**
 * 计算一个包的过期时间；未启用保留期时返回 null。
 * `createdAt` 解析失败时退回到生效起点（不因为脏数据提前删包）。
 */
export function expiryFor(
  createdAt: string,
  retentionDays: number,
  retentionStartedAt: string | null
): string | null {
  if (retentionDays <= 0) return null;
  const created = Date.parse(createdAt);
  const anchor = retentionStartedAt ? Date.parse(retentionStartedAt) : Number.NaN;
  const candidates = [created, anchor].filter((v) => Number.isFinite(v));
  if (!candidates.length) return null;
  const base = Math.max(...candidates);
  return new Date(base + retentionDays * 24 * 60 * 60 * 1000).toISOString();
}
