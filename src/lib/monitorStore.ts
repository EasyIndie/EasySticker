import fs from "node:fs";
import path from "node:path";
import os from "node:os";

// ── Types ──────────────────────────────────────────────────────

export interface CurrentMetrics {
  cpu: { percent: number; loadAvg: number[] };
  memory: { totalMb: number; usedMb: number; percent: number };
  disk: { totalMb: number; usedMb: number; percent: number };
  uptime: number;
  requestsLastMinute: number;
  requestsLastMinuteTotal: number;
  errorsLastMinute: number;
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

interface SecondSlot {
  count: number;
  errors: number;
  totalDuration: number;
}

function createSlots(): SecondSlot[] {
  return Array.from({ length: 60 }, () => ({ count: 0, errors: 0, totalDuration: 0 }));
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
      slots[slotIndex] = { count: 0, errors: 0, totalDuration: 0 };
    }
    // If we jumped more than 60 seconds, reset everything
    if (diff >= 60) {
      for (let i = 0; i < 60; i++) {
        slots[i] = { count: 0, errors: 0, totalDuration: 0 };
      }
      slotIndex = 0;
    }
    lastSlotSecond = nowSec * 1000;
  }

  function getSlotFor(ts: number): SecondSlot {
    advanceSlots(ts);
    return slots[slotIndex];
  }

  function aggregateSlots(): { count: number; errors: number; totalDuration: number } {
    let count = 0;
    let errors = 0;
    let totalDuration = 0;
    for (const s of slots) {
      count += s.count;
      errors += s.errors;
      totalDuration += s.totalDuration;
    }
    return { count, errors, totalDuration };
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
      if (rec.status >= 400) slot.errors++;
      slot.totalDuration += rec.durationMs;

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

      return {
        cpu,
        memory,
        disk,
        uptime,
        requestsLastMinute: agg.count,
        requestsLastMinuteTotal: agg.count,
        errorsLastMinute: agg.errors,
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
