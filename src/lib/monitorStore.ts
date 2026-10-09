import fs from "node:fs";
import path from "node:path";
import os from "node:os";

// ── Types ──────────────────────────────────────────────────────

export interface ErrorBreakdown {
  /** 统计窗口（秒）。 */
  windowSeconds: number;
  /** 状态码分布，按次数降序。 */
  byStatus: Array<{ status: number; count: number }>;
  /** 出错路由，按次数降序；client=4xx，server=5xx，count=两者之和。 */
  byRoute: Array<{ route: string; count: number; client: number; server: number }>;
}

export interface CurrentMetrics {
  cpu: { percent: number; loadAvg: number[] };
  memory: { totalMb: number; usedMb: number; percent: number };
  disk: { totalMb: number; usedMb: number; percent: number };
  uptime: number;
  requestsLastMinute: number;
  requestsLastMinuteTotal: number;
  /** 所有 >=400 的响应（包含 4xx 客户端错误）。 */
  errorsLastMinute: number;
  /** 仅 4xx（参数校验、鉴权、限流、404 等，通常是客户端行为）。 */
  clientErrorsLastMinute: number;
  /** 仅 5xx（服务端异常，真正需要告警的部分）。 */
  serverErrorsLastMinute: number;
  /** 错误归因明细，供告警消息定位具体原因。 */
  errorBreakdown: ErrorBreakdown;
  avgLatencyLastMinute: number;
}

export interface TrendData {
  requestsPerMinute: number[];
  errorRate: number[];
  avgLatencyMs: number[];
  cpuHistory: number[];
  memoryHistory: number[];
}

export interface MetricRecord {
  timestamp: string;
  type: "request" | "system" | "disk";
  data: Record<string, unknown>;
}

export interface MonitorStore {
  /** Record a request-level metric (called by onResponse hook). */
  recordRequest(rec: {
    method: string;
    route: string;
    status: number;
    durationMs: number;
    user?: string;
  }): void;

  /** Sample system metrics (CPU, memory, loadavg, uptime). Called every 10s. */
  recordSystem(): void;

  /** Sample disk usage of data directory. Called every 60s. */
  recordDisk(): void;

  /** Get current snapshot from recent data. */
  getCurrentSnapshot(): CurrentMetrics;

  /** Get trend data for the last N minutes. */
  getTrends(minutes: number): TrendData;

  /** Query raw metrics from JSONL files. */
  queryMetrics(opts: {
    from?: string;
    to?: string;
    type?: string;
    limit?: number;
    offset?: number;
  }): { metrics: MetricRecord[]; hasMore: boolean };

  /** Remove old JSONL files beyond retention period. */
  cleanup(): void;

  /** 硬删账号时抹掉监控记录里的该用户，返回删除条数。 */
  purgeUser(email: string): number;
}

// ── Helpers ────────────────────────────────────────────────────

function getToday(): string {
  return new Date().toISOString().slice(0, 10);
}

function appendJsonl(dir: string, date: string, obj: Record<string, unknown>): void {
  fs.mkdirSync(dir, { recursive: true });
  fs.appendFileSync(path.join(dir, `${date}.jsonl`), JSON.stringify(obj) + "\n", "utf-8");
}

/** Calculate directory size recursively via fs.statSync. Returns bytes. */
function getDirSize(dirPath: string): number {
  let total = 0;
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      try {
        if (entry.isDirectory()) {
          // Skip hidden dirs like .git
          if (entry.name.startsWith(".")) continue;
          total += getDirSize(fullPath);
        } else if (entry.isFile()) {
          total += fs.statSync(fullPath).size;
        }
      } catch {
        // skip inaccessible entries
      }
    }
  } catch {
    // directory may not exist yet
  }
  return total;
}

/** CPU times snapshot from os.cpus() — aggregate across all cores. */
function takeCpuTimes(): { idle: number; total: number } {
  const cpus = os.cpus();
  let idle = 0;
  let total = 0;
  for (const cpu of cpus) {
    idle += cpu.times.idle;
    total += cpu.times.user + cpu.times.nice + cpu.times.sys + cpu.times.idle + cpu.times.irq;
  }
  return { idle, total };
}

// ── Rolling Window (1 second granularity, 60 seconds) ─────────

interface RouteErrorStat {
  client: number;
  server: number;
}

interface SecondSlot {
  count: number;
  errors: number;
  clientErrors: number;
  serverErrors: number;
  totalDuration: number;
  byStatus: Map<number, number>;
  byRoute: Map<string, RouteErrorStat>;
}

function emptySlot(): SecondSlot {
  return {
    count: 0,
    errors: 0,
    clientErrors: 0,
    serverErrors: 0,
    totalDuration: 0,
    byStatus: new Map(),
    byRoute: new Map()
  };
}

function createSlots(): SecondSlot[] {
  return Array.from({ length: 60 }, () => emptySlot());
}

// ── Factory ────────────────────────────────────────────────────

export function createMonitorStore(
  dataPath: string,
  retentionDays = 7,
): MonitorStore {
  const logDir = path.join(dataPath, "monitoring");
  let prevCpuTimes = takeCpuTimes();
  let prevCpuTs = Date.now();
  let lastSystemData: { ts: string; cpuPercent: number; loadAvg: number[]; memTotalMb: number; memUsedMb: number; memPercent: number; uptime: number } | null = null;
  let lastDiskData: { ts: string; diskUsedMb: number } | null = null;


  // Rolling window for request metrics (1 second slots, 60 of them)
  const slots = createSlots();
  let slotIndex = 0;
  let lastSlotSecond = Date.now();

  // Rolling window for system metrics (1 per sample, up to 60 samples)
  const cpuSamples: number[] = [];
  const memSamples: number[] = [];

  function advanceSlots(now: number): void {
    const nowSec = Math.floor(now / 1000);
    const lastSec = Math.floor(lastSlotSecond / 1000);
    const diff = Math.min(nowSec - lastSec, 60);
    if (diff <= 0) return;
    for (let i = 0; i < diff; i++) {
      slotIndex = (slotIndex + 1) % 60;
      slots[slotIndex] = emptySlot();
    }
    // If we jumped more than 60 seconds, reset everything
    if (diff >= 60) {
      for (let i = 0; i < 60; i++) {
        slots[i] = emptySlot();
      }
      slotIndex = 0;
    }
    lastSlotSecond = nowSec * 1000;
  }

  function getSlotFor(ts: number): SecondSlot {
    advanceSlots(ts);
    return slots[slotIndex];
  }

  function aggregateSlots(): {
    count: number;
    errors: number;
    clientErrors: number;
    serverErrors: number;
    totalDuration: number;
    byStatus: Map<number, number>;
    byRoute: Map<string, RouteErrorStat>;
  } {
    let count = 0;
    let errors = 0;
    let clientErrors = 0;
    let serverErrors = 0;
    let totalDuration = 0;
    const byStatus = new Map<number, number>();
    const byRoute = new Map<string, RouteErrorStat>();

    for (const s of slots) {
      count += s.count;
      errors += s.errors;
      clientErrors += s.clientErrors;
      serverErrors += s.serverErrors;
      totalDuration += s.totalDuration;
      for (const [status, n] of s.byStatus) byStatus.set(status, (byStatus.get(status) ?? 0) + n);
      for (const [route, stat] of s.byRoute) {
        const cur = byRoute.get(route) ?? { client: 0, server: 0 };
        cur.client += stat.client;
        cur.server += stat.server;
        byRoute.set(route, cur);
      }
    }

    return { count, errors, clientErrors, serverErrors, totalDuration, byStatus, byRoute };
  }

  function pushSystemSample(cpuPercent: number, memPercent: number): void {
    cpuSamples.push(cpuPercent);
    memSamples.push(memPercent);
    if (cpuSamples.length > 60) {
      cpuSamples.shift();
      memSamples.shift();
    }
  }

  // ── Implementation ──────────────────────────────────────────

  const store: MonitorStore = {
    recordRequest(rec) {
      const now = Date.now();
      const slot = getSlotFor(now);
      slot.count++;
      slot.totalDuration += rec.durationMs;

      // 4xx 与 5xx 分开累计：4xx 多为客户端/扫描器噪声，5xx 才是服务端故障。
      // 全量 >=400 仍记进 errors，保持旧指标语义不变。
      if (rec.status >= 400) {
        slot.errors++;
        const isServer = rec.status >= 500;
        if (isServer) slot.serverErrors++;
        else slot.clientErrors++;
        slot.byStatus.set(rec.status, (slot.byStatus.get(rec.status) ?? 0) + 1);
        const route = rec.route || "unknown";
        const stat = slot.byRoute.get(route) ?? { client: 0, server: 0 };
        if (isServer) stat.server++;
        else stat.client++;
        slot.byRoute.set(route, stat);
      }

      // Write to JSONL
      const today = getToday();
      appendJsonl(path.join(logDir, "request"), today, {
        ts: new Date().toISOString(),
        method: rec.method,
        route: rec.route,
        status: rec.status,
        durationMs: rec.durationMs,
        user: rec.user || null,
      });
    },

    recordSystem() {
      const now = Date.now();
      // Determine disk info from os module (approximation via total/free)
      const memTotal = os.totalmem();
      const memFree = os.freemem();
      const memUsed = memTotal - memFree;
      const memUsedMb = Math.round(memUsed / 1024 / 1024);
      const memTotalMb = Math.round(memTotal / 1024 / 1024);
      const memPercent = Math.round((memUsed / memTotal) * 100);

      // CPU percent since last measurement
      const curCpuTimes = takeCpuTimes();
      const curTs = Date.now();
      const idleDelta = curCpuTimes.idle - prevCpuTimes.idle;
      const totalDelta = curCpuTimes.total - prevCpuTimes.total;
      let cpuPercent = 0;
      if (totalDelta > 0) {
        cpuPercent = Math.round((1 - idleDelta / totalDelta) * 100);
      }
      prevCpuTimes = curCpuTimes;

      const uptime = os.uptime();
      const loadAvg = os.loadavg().map(v => Math.round(v * 10) / 10);

      const record = {
        ts: new Date(now).toISOString(),
        cpuPercent,
        loadAvg,
        memTotalMb,
        memUsedMb,
        memPercent,
        uptime,
      };

      lastSystemData = record;

      pushSystemSample(cpuPercent, memPercent);

      const today = getToday();
      appendJsonl(path.join(logDir, "system"), today, record);

      prevCpuTs = curTs;
    },

    recordDisk() {
      const now = Date.now();
      let diskUsedBytes = 0;
      if (fs.existsSync(dataPath)) {
        diskUsedBytes = getDirSize(dataPath);
      }
      const diskUsedMb = Math.round(diskUsedBytes / 1024 / 1024);

      const record = {
        ts: new Date(now).toISOString(),
        diskUsedMb,
      };

      lastDiskData = record;

      const today = getToday();
      appendJsonl(path.join(logDir, "disk"), today, record);
    },

    getCurrentSnapshot(): CurrentMetrics {
      const agg = aggregateSlots();

      const cpu = lastSystemData
        ? { percent: lastSystemData.cpuPercent, loadAvg: lastSystemData.loadAvg }
        : { percent: 0, loadAvg: [0, 0, 0] };

      const memory = lastSystemData
        ? { totalMb: lastSystemData.memTotalMb, usedMb: lastSystemData.memUsedMb, percent: lastSystemData.memPercent }
        : { totalMb: 0, usedMb: 0, percent: 0 };

      const disk = lastDiskData
        ? { totalMb: lastDiskData.diskUsedMb, usedMb: lastDiskData.diskUsedMb, percent: 0 }
        : { totalMb: 0, usedMb: 0, percent: 0 };

      const uptime = lastSystemData?.uptime ?? os.uptime();

      const byStatus = [...agg.byStatus.entries()]
        .map(([status, count]) => ({ status, count }))
        .sort((a, b) => b.count - a.count || a.status - b.status);
      const byRoute = [...agg.byRoute.entries()]
        .map(([route, stat]) => ({ route, count: stat.client + stat.server, client: stat.client, server: stat.server }))
        .sort((a, b) => b.count - a.count || a.route.localeCompare(b.route));

      return {
        cpu,
        memory,
        disk,
        uptime,
        requestsLastMinute: agg.count,
        requestsLastMinuteTotal: agg.count,
        errorsLastMinute: agg.errors,
        clientErrorsLastMinute: agg.clientErrors,
        serverErrorsLastMinute: agg.serverErrors,
        errorBreakdown: { windowSeconds: 60, byStatus, byRoute },
        avgLatencyLastMinute: agg.count > 0 ? Math.round(agg.totalDuration / agg.count) : 0,
      };
    },

    getTrends(minutes: number): TrendData {
      const n = Math.min(minutes, cpuSamples.length);
      const requestsPerMinute: number[] = [];
      const errorRate: number[] = [];
      const avgLatencyMs: number[] = [];

      // Build per-minute from rolling window
      // We have 60 1-second slots; aggregate into minute buckets
      const slotsCopy = [...slots];
      const total = slotsCopy.reduce((acc, s) => ({ count: acc.count + s.count, errors: acc.errors + s.errors, totalDuration: acc.totalDuration + s.totalDuration }), { count: 0, errors: 0, totalDuration: 0 });
      requestsPerMinute.push(total.count);
      errorRate.push(total.count > 0 ? Math.round((total.errors / total.count) * 100) / 100 : 0);
      avgLatencyMs.push(total.count > 0 ? Math.round(total.totalDuration / total.count) : 0);

      // For cpu/memory history, use the system samples
      const cpuHistory = cpuSamples.slice(-n);
      const memoryHistory = memSamples.slice(-n);

      return {
        requestsPerMinute,
        errorRate,
        avgLatencyMs,
        cpuHistory,
        memoryHistory,
      };
    },

    queryMetrics(opts) {
      const { from, to, type, limit = 100, offset = 0 } = opts;
      const results: MetricRecord[] = [];
      const dirTypes = ["request", "system", "disk"];

      for (const dt of dirTypes) {
        if (type && dt !== type) continue;
        const typeDir = path.join(logDir, dt);
        if (!fs.existsSync(typeDir)) continue;

        const dates = fs.readdirSync(typeDir).filter(d => d.endsWith(".jsonl"));
        for (const dateFile of dates) {
          const dateStr = dateFile.replace(".jsonl", "");
          if (from && dateStr < from.slice(0, 10)) continue;
          if (to && dateStr > to.slice(0, 10)) continue;

          const lines = fs.readFileSync(path.join(typeDir, dateFile), "utf-8").trim().split("\n");
          for (const line of lines) {
            if (!line) continue;
            try {
              const data = JSON.parse(line);
              results.push({
                timestamp: data.ts,
                type: dt as "request" | "system" | "disk",
                data,
              });
            } catch {
              // skip malformed lines
            }
          }
        }
      }

      // Sort by timestamp descending
      results.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

      const paginated = results.slice(offset, offset + limit);
      const hasMore = offset + limit < results.length;

      return { metrics: paginated, hasMore };
    },

    purgeUser(email) {
      const target = email.toLowerCase().trim();
      let removed = 0;
      const typeDir = path.join(logDir, "request");
      try {
        if (fs.existsSync(typeDir)) {
          for (const file of fs.readdirSync(typeDir).filter(f => f.endsWith(".jsonl"))) {
            const full = path.join(typeDir, file);
            const lines = fs.readFileSync(full, "utf-8").split("\n");
            const kept: string[] = [];
            for (const line of lines) {
              if (!line) continue;
              try {
                const rec = JSON.parse(line);
                if (rec.user && String(rec.user).toLowerCase().trim() === target) {
                  removed += 1;
                  continue;
                }
              } catch { /* 保留无法解析的行 */ }
              kept.push(line);
            }
            fs.writeFileSync(full, kept.length ? kept.join("\n") + "\n" : "", "utf-8");
          }
        }
      } catch (err) {
        console.error("Failed to purge monitor records:", err);
      }
      return removed;
    },

    cleanup() {
      const now = new Date();
      const cutoff = new Date(now.getTime() - retentionDays * 86400_000);
      const cutoffStr = cutoff.toISOString().slice(0, 10);

      const dirTypes = ["request", "system", "disk"];
      for (const dt of dirTypes) {
        const typeDir = path.join(logDir, dt);
        if (!fs.existsSync(typeDir)) continue;
        const entries = fs.readdirSync(typeDir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.name.endsWith(".jsonl")) {
            const dateStr = entry.name.replace(".jsonl", "");
            if (dateStr.length === 10 && dateStr[4] === "-" && dateStr < cutoffStr) {
              const fullPath = path.join(typeDir, entry.name);
              fs.rmSync(fullPath, { force: true });
            }
          }
        }
      }
    },
  };

  // Initialize: perform first CPU measurement (used as baseline for delta calculation) and disk measurement
  prevCpuTimes = takeCpuTimes();
  prevCpuTs = Date.now();
  // Do initial disk measurement synchronously so snapshot has data
  store.recordDisk();

  return store;
}
