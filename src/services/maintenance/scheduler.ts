import { runGc, type GcReport } from "./gc";

/** `prompt-config.json` → `server.maintenance`。 */
export type MaintenanceConfig = {
  /** 总开关，默认开启（GC 只做可证明安全的回收）。 */
  gcEnabled?: boolean;
  /** 巡检间隔，默认 6 小时。 */
  gcIntervalMs?: number;
  /** 包保留天数；0 / 未设置 = 不按时间清理。 */
  packRetentionDays?: number;
  /** 孤儿素材的安全期（小时），默认 6。 */
  orphanMinAgeHours?: number;
  /** 把只有 ZIP 的历史包压成清单，默认开。 */
  compactLegacyPacks?: boolean;
  /** 删除 repair-pack 留下的 `.orig` 备份，默认开。 */
  dropOrigBackups?: boolean;
};

const DEFAULT_GC_INTERVAL_MS = 6 * 60 * 60 * 1000;
/** 启动后先等一会儿再跑第一次，避免和冷启动抢磁盘 IO。 */
const KICKOFF_DELAY_MS = 30_000;

export type MaintenanceLogger = (message: string, meta?: Record<string, unknown>) => void;

/**
 * 启动周期性数据清理。返回停止函数。
 *
 * 放在 `onReady` 里启动、`onClose` 里停止，与 `security.startCleanup` 同一套路。
 */
export function startMaintenanceGc(
  dataDir: string,
  config: MaintenanceConfig = {},
  log?: MaintenanceLogger
): () => void {
  const intervalMs = config.gcIntervalMs && config.gcIntervalMs > 0 ? config.gcIntervalMs : DEFAULT_GC_INTERVAL_MS;
  const orphanMinAgeMs =
    config.orphanMinAgeHours && config.orphanMinAgeHours >= 0
      ? config.orphanMinAgeHours * 60 * 60 * 1000
      : undefined;

  let running = false;
  const tick = async () => {
    // 上一轮还没跑完就跳过这一轮，避免并发清理互相踩
    if (running) return;
    running = true;
    try {
      const report: GcReport = await runGc({
        dataDir,
        packRetentionDays: config.packRetentionDays ?? 0,
        compactLegacyPacks: config.compactLegacyPacks !== false,
        dropOrigBackups: config.dropOrigBackups !== false,
        ...(orphanMinAgeMs !== undefined ? { orphanMinAgeMs } : {})
      });
      const reclaimed = report.reclaimedBytes;
      if (reclaimed > 0 || report.compacted.count || report.orphanAssets.count || report.errors.length) {
        log?.("数据目录 GC 完成", {
          compactedPacks: report.compacted.count,
          orphanAssets: report.orphanAssets.count,
          droppedOrigBackups: report.origBackups.count,
          expiredPacks: report.expired.count,
          reclaimedMB: Number((reclaimed / 1048576).toFixed(2)),
          errors: report.errors
        });
      }
    } catch (error) {
      log?.("数据目录 GC 失败", { error: (error as Error).message });
    } finally {
      running = false;
    }
  };

  const kickoff = setTimeout(() => void tick(), KICKOFF_DELAY_MS);
  const timer = setInterval(() => void tick(), intervalMs);
  // 不要因为清理定时器让进程无法退出
  kickoff.unref?.();
  timer.unref?.();

  return () => {
    clearTimeout(kickoff);
    clearInterval(timer);
  };
}
