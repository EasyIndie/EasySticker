import fs from "node:fs";
import path from "node:path";

interface UsageRecord {
  date: string;  // YYYY-MM-DD
  email: string;
  action: "generate" | "download" | "upload";
  success: boolean;
  timestamp: string;
}

interface UsageSummary {
  email: string;
  todayGenerated: number;
  /** 今日成功次数（后台统计页用来算「今日成功率」，避免再拿全量比率去乘）。 */
  todaySuccess: number;
  todaySuccessRate: number;
  totalGenerated: number;
  /** 累计成功次数。 */
  totalSuccess: number;
  successRate: number;
  lastActive: string | null;
}

export function createUsageStore(dataPath: string, logDir?: string) {
  const logPath = logDir || path.join(dataPath, "usage");
  let today = new Date().toISOString().slice(0, 10);

  // In-memory daily counters: email -> count
  const dailyCounts = new Map<string, number>();
  const dailySuccess = new Map<string, number>();
  const totalCounts = new Map<string, number>();
  const totalSuccess = new Map<string, number>();

  // Load existing daily log
  function loadDailyLog(date: string) {
    dailyCounts.clear();
    dailySuccess.clear();
    const file = path.join(logPath, `${date}.jsonl`);
    try {
      if (fs.existsSync(file)) {
        const lines = fs.readFileSync(file, "utf-8").trim().split("\n");
        for (const line of lines) {
          if (!line) continue;
          const record: UsageRecord = JSON.parse(line);
          const email = record.email;
          dailyCounts.set(email, (dailyCounts.get(email) || 0) + 1);
          if (record.success) {
            dailySuccess.set(email, (dailySuccess.get(email) || 0) + 1);
          }
        }
      }
    } catch { /* ignore */ }
  }

  // Load total counts from all log files
  function loadTotalCounts() {
    totalCounts.clear();
    totalSuccess.clear();
    try {
      if (fs.existsSync(logPath)) {
        const files = fs.readdirSync(logPath).filter(f => f.endsWith(".jsonl"));
        for (const file of files) {
          const content = fs.readFileSync(path.join(logPath, file), "utf-8");
          for (const line of content.trim().split("\n")) {
            if (!line) continue;
            const record: UsageRecord = JSON.parse(line);
            totalCounts.set(record.email, (totalCounts.get(record.email) || 0) + 1);
            if (record.success) {
              totalSuccess.set(record.email, (totalSuccess.get(record.email) || 0) + 1);
            }
          }
        }
      }
    } catch { /* ignore */ }
  }

  // Initialize
  fs.mkdirSync(logPath, { recursive: true });
  loadDailyLog(today);
  loadTotalCounts();

  return {
    /** Log a usage event for a user. */
    log(record: Omit<UsageRecord, "date" | "timestamp">): void {
      const now = new Date();
      const date = now.toISOString().slice(0, 10);
      const full: UsageRecord = {
        ...record,
        date,
        timestamp: now.toISOString()
      };

      // Update in-memory
      dailyCounts.set(record.email, (dailyCounts.get(record.email) || 0) + 1);
      if (record.success) {
        dailySuccess.set(record.email, (dailySuccess.get(record.email) || 0) + 1);
      }
      totalCounts.set(record.email, (totalCounts.get(record.email) || 0) + 1);
      if (record.success) {
        totalSuccess.set(record.email, (totalSuccess.get(record.email) || 0) + 1);
      }

      // Append to daily log file (async, no need to wait)
      const file = path.join(logPath, `${date}.jsonl`);
      fs.appendFileSync(file, JSON.stringify(full) + "\n", "utf-8");
    },

    /** Check if user has remaining quota for today. */
    checkDailyQuota(email: string, maxPerDay: number): { allowed: boolean; used: number; remaining: number } {
      const used = dailyCounts.get(email) || 0;
      return {
        allowed: used < maxPerDay,
        used,
        remaining: Math.max(0, maxPerDay - used)
      };
    },

    /** Get daily usage summary for a user. */
    getSummary(email: string): UsageSummary {
      const total = totalCounts.get(email) || 0;
      const successes = totalSuccess.get(email) || 0;
      const today = dailyCounts.get(email) || 0;
      const todayOk = dailySuccess.get(email) || 0;
      return {
        email,
        todayGenerated: today,
        todaySuccess: todayOk,
        todaySuccessRate: today > 0 ? todayOk / today : 1,
        totalGenerated: total,
        totalSuccess: successes,
        successRate: total > 0 ? successes / total : 1,
        lastActive: null // could be tracked separately
      };
    },

    /** Get usage summary for all users (admin). */
    getAllSummaries(): UsageSummary[] {
      const emails = new Set([...dailyCounts.keys(), ...totalCounts.keys()]);
      return Array.from(emails).map(email => this.getSummary(email));
    },

    /** Rotate to new day (auto-detects date change). */
    maybeRotate() {
      const newToday = new Date().toISOString().slice(0, 10);
      if (newToday !== today) {
        today = newToday;
        loadDailyLog(today);
      }
    },

    /** 硬删账号时抹掉该用户的全部用量记录，返回删除条数。 */
    purgeUser(email: string): number {
      const target = email.toLowerCase().trim();
      let removed = 0;
      try {
        if (fs.existsSync(logPath)) {
          for (const file of fs.readdirSync(logPath).filter(f => f.endsWith(".jsonl"))) {
            const full = path.join(logPath, file);
            const lines = fs.readFileSync(full, "utf-8").split("\n");
            const kept: string[] = [];
            for (const line of lines) {
              if (!line) continue;
              try {
                const rec = JSON.parse(line);
                if (String(rec.email ?? "").toLowerCase().trim() === target) {
                  removed += 1;
                  continue;
                }
              } catch { /* 保留无法解析的行，不因清理而丢数据 */ }
              kept.push(line);
            }
            fs.writeFileSync(full, kept.length ? kept.join("\n") + "\n" : "", "utf-8");
          }
        }
      } catch (err) {
        console.error("Failed to purge usage records:", err);
      }
      loadTotalCounts();
      loadDailyLog(today);
      return removed;
    }
  };
}

export type UsageStore = ReturnType<typeof createUsageStore>;
