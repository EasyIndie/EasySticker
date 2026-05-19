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
  totalGenerated: number;
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
      return {
        email,
        todayGenerated: dailyCounts.get(email) || 0,
        totalGenerated: total,
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
    }
  };
}

export type UsageStore = ReturnType<typeof createUsageStore>;
