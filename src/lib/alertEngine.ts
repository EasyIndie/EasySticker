import fs from "node:fs";
import path from "node:path";
import type { MonitorStore } from "./monitorStore";

// ── Types ──────────────────────────────────────────────────────

export interface AlertRule {
  id: string;
  name: string;
  metric: string; // "cpu.percent" | "errorRate" | "disk.usedMb" | "avgLatencyMs" | "requestsPerMinute"
  operator: "gt";
  threshold: number;
  duration: number;   // seconds the condition must persist before alert fires
  silenceMs: number;  // notification cooldown per rule (ms)
  enabled: boolean;
}

export interface AlertRecord {
  id: string;
  rule: string;     // rule id
  message: string;
  value: number;

  startedAt: string;   // ISO
  resolvedAt: string | null;
  acknowledged: boolean;
}

export interface AlertConfig {
  rules: AlertRule[];
  webhookUrl: string;
  webhookEnabled: boolean;
  notificationInterval: number; // ms
  monitorRetentionDays: number;
}

export interface AlertEngine {
  evaluate(): void;
  getRules(): AlertRule[];
  updateRules(rules: AlertRule[]): void;
  getActiveAlerts(): AlertRecord[];
  getAlertHistory(): AlertRecord[];
  acknowledgeAlert(id: string): boolean;
  getConfig(): AlertConfig;
  updateConfig(config: Partial<AlertConfig>): void;
}

// ── Defaults ───────────────────────────────────────────────────

const DEFAULT_RULES: AlertRule[] = [
  { id: "cpu_high", name: "CPU 过高", metric: "cpu.percent", operator: "gt", threshold: 80, duration: 60, silenceMs: 300_000, enabled: true },
  { id: "error_rate_high", name: "错误率过高", metric: "errorRate", operator: "gt", threshold: 0.05, duration: 120, silenceMs: 600_000, enabled: true },
  { id: "disk_full", name: "磁盘空间不足", metric: "disk.usedMb", operator: "gt", threshold: 500, duration: 60, silenceMs: 600_000, enabled: true },
  { id: "latency_high", name: "响应延迟过高", metric: "avgLatencyMs", operator: "gt", threshold: 5000, duration: 120, silenceMs: 600_000, enabled: true },
  { id: "request_surge", name: "请求量异常激增", metric: "requestsPerMinute", operator: "gt", threshold: 100, duration: 60, silenceMs: 300_000, enabled: false },
];

const DEFAULT_CONFIG: AlertConfig = {
  rules: DEFAULT_RULES,
  webhookUrl: "",
  webhookEnabled: false,
  notificationInterval: 60_000,
  monitorRetentionDays: 7,
};

// ── Helpers ────────────────────────────────────────────────────

function uid(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}


function readJsonFile<T>(filePath: string, fallback: T): T {
  try {
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, "utf-8");
      return JSON.parse(raw) as T;
    }
  } catch {
    // ignore parse errors, return fallback
  }
  return fallback;
}

function writeJsonFile(filePath: string, data: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
}

/** Extract metric value from monitorStore snapshot. Returns undefined when data is unavailable. */
function getMetricValue(snapshot: ReturnType<MonitorStore["getCurrentSnapshot"]>, rule: AlertRule): number {
  switch (rule.metric) {
    case "cpu.percent":
      return snapshot.cpu.percent;
    case "errorRate":
      return snapshot.requestsLastMinute > 0
        ? snapshot.errorsLastMinute / Math.max(snapshot.requestsLastMinute, 1)
        : 0;
    case "disk.usedMb":
      return snapshot.disk.usedMb;
    case "avgLatencyMs":
      return snapshot.avgLatencyLastMinute;
    case "requestsPerMinute":
      return snapshot.requestsLastMinute;
    default:
      return 0;
  }
}

// ── Factory ────────────────────────────────────────────────────

export function createAlertEngine(
  configPath: string,
  monitorStore: MonitorStore,
  logger?: { warn: (msg: string | object) => void; info: (msg: string | object) => void },
): AlertEngine {
  const historyPath = path.join(path.dirname(configPath), "alerts-history.json");

  // ── State ──────────────────────────────────────────────────
  let config: AlertConfig = readJsonFile(configPath, {} as AlertConfig);

  // Merge defaults for any missing top-level fields
  if (!config.rules || !Array.isArray(config.rules) || config.rules.length === 0) {
    config.rules = [...DEFAULT_RULES];
  }
  config.webhookUrl = config.webhookUrl ?? DEFAULT_CONFIG.webhookUrl;
  config.webhookEnabled = config.webhookEnabled ?? DEFAULT_CONFIG.webhookEnabled;
  config.notificationInterval = config.notificationInterval ?? DEFAULT_CONFIG.notificationInterval;
  config.monitorRetentionDays = config.monitorRetentionDays ?? DEFAULT_CONFIG.monitorRetentionDays;

  // Persist initial config
  writeJsonFile(configPath, config);

  // ── Alert tracking ─────────────────────────────────────────
  let alertHistory: AlertRecord[] = readJsonFile<AlertRecord[]>(historyPath, []);

  // Tracks the timestamp when a rule's threshold was first breached (ms since epoch).
  // If undefined → condition not currently breached.
  const breachStart: Map<string, number> = new Map();

  // Tracks whether an active alert already exists for this rule (unresolved).
  const activeAlerts: Map<string, AlertRecord> = new Map();

  // Tracks last notification time per rule (ms since epoch).
  const lastNotify: Map<string, number> = new Map();

  // ── Helper: persist history ────────────────────────────────
  function saveHistory(): void {
    writeJsonFile(historyPath, alertHistory);
  }

  // ── Helper: save config ────────────────────────────────────
  function saveConfig(): void {
    writeJsonFile(configPath, config);
  }

  // ── Rebuild active-alert map from history on init ──────────
  for (const record of alertHistory) {
    if (record.resolvedAt === null) {
      activeAlerts.set(record.rule, record);
    }
  }

  // ── Implementation ─────────────────────────────────────────

  const engine: AlertEngine = {
    evaluate() {
      const now = Date.now();
      const snapshot = monitorStore.getCurrentSnapshot();

      for (const rule of config.rules) {
        if (!rule.enabled) continue;

        const val = getMetricValue(snapshot, rule);
        const aboveThreshold = val > rule.threshold;
        const belowHysteresis = val < rule.threshold * 0.9;

        // ── Alert firing logic ──────────────────────────────
        if (aboveThreshold) {
          // Track breach start time
          if (!breachStart.has(rule.id)) {
            breachStart.set(rule.id, now);
          }

          const startedAt = breachStart.get(rule.id)!;
          const elapsedMs = now - startedAt;
          const durationSatisfied = elapsedMs >= rule.duration * 1000;

          // Only fire if duration is met and no active alert exists
          if (durationSatisfied && !activeAlerts.has(rule.id)) {
            const record: AlertRecord = {
              id: uid(),
              rule: rule.id,
              message: `${rule.name}: ${val} > ${rule.threshold}`,
              value: val,
              startedAt: new Date(startedAt).toISOString(),
              resolvedAt: null,
              acknowledged: false,
            };

            alertHistory.push(record);
            activeAlerts.set(rule.id, record);
            saveHistory();

            // Notify on creation — only once (we fire notify via the caller or a separate mechanism)
            // The engine collects the alert; notification is handled externally or via a provided callback.
            // We emit a notification record here: the caller (server.ts) can read activeAlerts and dispatch.

            logger?.warn({
              event: "alert_fired",
              ruleId: rule.id,
              ruleName: rule.name,
              value: val,
              threshold: rule.threshold,
              alertId: record.id,
            } as Record<string, unknown>);
          }
        } else {
          // Condition cleared — reset breach timer
          if (breachStart.has(rule.id)) {
            breachStart.delete(rule.id);
          }

          // Below hysteresis → resolve active alert
          if (belowHysteresis) {
            const active = activeAlerts.get(rule.id);
            if (active) {
              active.resolvedAt = new Date(now).toISOString();
              activeAlerts.delete(rule.id);
              saveHistory();

              logger?.info({
                event: "alert_resolved",
                ruleId: rule.id,
                ruleName: rule.name,
                value: val,
                threshold: rule.threshold,
              } as Record<string, unknown>);
            }
          }
        }
      }
    },

    getRules(): AlertRule[] {
      return [...config.rules];
    },

    updateRules(rules: AlertRule[]): void {
      config.rules = rules;
      saveConfig();
    },

    getActiveAlerts(): AlertRecord[] {
      return Array.from(activeAlerts.values());
    },

    getAlertHistory(): AlertRecord[] {
      return [...alertHistory];
    },

    acknowledgeAlert(id: string): boolean {
      const record = alertHistory.find(r => r.id === id);
      if (!record) return false;
      record.acknowledged = true;

      // Also update in activeAlerts map if present
      const active = activeAlerts.get(record.rule);
      if (active && active.id === id) {
        active.acknowledged = true;
      }

      saveHistory();
      return true;
    },

    getConfig(): AlertConfig {
      return { ...config };
    },

    updateConfig(partial: Partial<AlertConfig>): void {
      if (partial.rules !== undefined) config.rules = partial.rules;
      if (partial.webhookUrl !== undefined) config.webhookUrl = partial.webhookUrl;
      if (partial.webhookEnabled !== undefined) config.webhookEnabled = partial.webhookEnabled;
      if (partial.notificationInterval !== undefined) config.notificationInterval = partial.notificationInterval;
      if (partial.monitorRetentionDays !== undefined) config.monitorRetentionDays = partial.monitorRetentionDays;
      saveConfig();
    },
  };

  return engine;
}
