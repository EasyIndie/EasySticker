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
  /** 错误率类指标的最小样本量（窗口内请求数），低于该值视为无数据，默认 20。 */
  minSamples?: number;
}

export interface AlertRecord {
  id: string;
  rule: string;     // rule id
  /** 触发规则所用的指标，便于前端/告警消息直接展示。 */
  metric?: string;
  message: string;
  value: number;
  /** 归因明细（出错路由、状态码分布、排查建议等），用于快速定位。 */
  details?: string[];

  startedAt: string;   // ISO
  resolvedAt: string | null;
  acknowledged: boolean;
  /** 已发送通知的次数（首次触发算 1）。 */
  notifyCount?: number;
  /** 最近一次通知时间；持久化后重启不会立即重复推送。 */
  lastNotifiedAt?: string | null;
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
  /** 记录一次通知已发出（跨重启节流用）。 */
  markNotified(id: string): void;
  /** 取出并清空自上次调用以来「已恢复」的告警，用于发送恢复通知。 */
  drainResolved(): AlertRecord[];
}

// ── Defaults ───────────────────────────────────────────────────

/** 低流量下单个错误就能把比例放大到 100%，低于该样本量不参与错误率告警。 */
const DEFAULT_MIN_SAMPLES = 20;

const DEFAULT_RULES: AlertRule[] = [
  { id: "cpu_high", name: "CPU 过高", metric: "cpu.percent", operator: "gt", threshold: 80, duration: 60, silenceMs: 300_000, enabled: true },
  // 只对服务端错误（5xx）告警：4xx 多为参数校验/鉴权/限流/扫描器噪声，纳入会造成告警风暴。
  { id: "error_rate_high", name: "服务端错误率过高（5xx）", metric: "serverErrorRate", operator: "gt", threshold: 0.02, duration: 120, silenceMs: 600_000, enabled: true, minSamples: DEFAULT_MIN_SAMPLES },
  { id: "client_error_rate_high", name: "客户端错误率偏高（4xx）", metric: "clientErrorRate", operator: "gt", threshold: 0.2, duration: 300, silenceMs: 900_000, enabled: false, minSamples: DEFAULT_MIN_SAMPLES },
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
  const total = snapshot.requestsLastMinute;
  const minSamples = Math.max(0, rule.minSamples ?? DEFAULT_MIN_SAMPLES);
  const rate = (numerator: number): number =>
    total > 0 && total >= minSamples ? numerator / total : 0;

  switch (rule.metric) {
    case "cpu.percent":
      return snapshot.cpu.percent;
    case "errorRate":
      return rate(snapshot.errorsLastMinute);
    case "serverErrorRate":
      return rate(snapshot.serverErrorsLastMinute);
    case "clientErrorRate":
      return rate(snapshot.clientErrorsLastMinute);
    case "disk.usedMb":
      return snapshot.disk.usedMb;
    case "avgLatencyMs":
      return snapshot.avgLatencyLastMinute;
    case "requestsPerMinute":
      return total;
    default:
      return 0;
  }
}

function isRateMetric(metric: string): boolean {
  return metric === "errorRate" || metric === "serverErrorRate" || metric === "clientErrorRate";
}

/** 把指标值格式化成带单位、人可读的文本（百分比/毫秒/MB）。 */
function formatValue(metric: string, value: number): string {
  switch (metric) {
    case "cpu.percent":
      return `${value}%`;
    case "errorRate":
    case "serverErrorRate":
    case "clientErrorRate":
      return `${(value * 100).toFixed(2)}%`;
    case "avgLatencyMs":
      return `${value}ms`;
    case "disk.usedMb":
      return `${value}MB`;
    case "requestsPerMinute":
      return `${value} req/min`;
    default:
      return String(value);
  }
}

/**
 * 组装告警定位明细。错误率类告警会带上出错路由、状态码分布、5xx/4xx 拆分，
 * 让收到 webhook 的人不用再翻日志就能知道「哪里错了」。
 */
function buildAlertDetails(
  rule: AlertRule,
  snapshot: ReturnType<MonitorStore["getCurrentSnapshot"]>
): string[] {
  const details: string[] = [];

  if (isRateMetric(rule.metric)) {
    details.push(
      `统计窗口：最近 ${snapshot.errorBreakdown.windowSeconds}s，共 ${snapshot.requestsLastMinute} 次请求、` +
        `${snapshot.errorsLastMinute} 次错误（5xx ${snapshot.serverErrorsLastMinute} / 4xx ${snapshot.clientErrorsLastMinute}）`
    );
    const routes = snapshot.errorBreakdown.byRoute.slice(0, 3);
    if (routes.length) {
      details.push("出错最多：" + routes.map((r) => `${r.route}（5xx ${r.server} / 4xx ${r.client}）`).join("；"));
    }
    const statuses = snapshot.errorBreakdown.byStatus.slice(0, 5);
    if (statuses.length) {
      details.push("状态码分布：" + statuses.map((s) => `${s.status}×${s.count}`).join("，"));
    }
    if (rule.metric === "serverErrorRate") {
      details.push("排查建议：查服务端日志中上述路由的异常堆栈 / AI provider 报错 / 磁盘与内存");
    } else if (rule.metric === "clientErrorRate") {
      details.push("排查建议：4xx 多为客户端行为，确认是否扫描器、鉴权失效或前端参数问题");
    } else {
      details.push("排查建议：先看 5xx 是否为服务端故障，再看 4xx 是否集中于鉴权/限流/校验");
    }
  } else if (rule.metric === "cpu.percent") {
    details.push(`系统负载（1/5/15 分钟）：${snapshot.cpu.loadAvg.join(" / ")}`);
    details.push(`内存占用：${snapshot.memory.percent}%（${snapshot.memory.usedMb}/${snapshot.memory.totalMb} MB）`);
  } else if (rule.metric === "disk.usedMb") {
    details.push(`数据目录占用：${snapshot.disk.usedMb} MB`);
  } else if (rule.metric === "avgLatencyMs") {
    details.push(`最近一分钟请求数：${snapshot.requestsLastMinute}，平均延迟：${snapshot.avgLatencyLastMinute}ms`);
  }

  return details;
}

/**
 * 迁移历史配置：早期把 4xx 也算进 `errorRate`，导致「错误率过高」被客户端噪声频繁触发。
 * 把内置的 `error_rate_high` 从 `errorRate` 切到 `serverErrorRate`（仅 5xx）。
 * 只迁移仍是默认形态的规则，用户自定义过的保持原样。
 */
function migrateRules(rules: AlertRule[]): { rules: AlertRule[]; changed: boolean } {
  let changed = false;
  const next = rules.map((rule) => {
    if (rule.id === "error_rate_high" && rule.metric === "errorRate") {
      changed = true;
      return {
        ...rule,
        metric: "serverErrorRate",
        name: rule.name === "错误率过高" ? "服务端错误率过高（5xx）" : rule.name,
        threshold: rule.threshold === 0.05 ? 0.02 : rule.threshold
      };
    }
    return rule;
  });
  return { rules: next, changed };
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
  // 修正历史规则：错误率告警只针对 5xx，避免被 4xx 噪声打爆
  const migration = migrateRules(config.rules);
  config.rules = migration.rules;
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

  // Alerts that resolved since the last drain, for one-shot recovery notifications.
  const resolvedQueue: AlertRecord[] = [];

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
              metric: rule.metric,
              // 值/阈值统一带单位，并附归因明细，收到告警即可定位
              message:
                `${rule.name}：${formatValue(rule.metric, val)}` +
                `（阈值 ${formatValue(rule.metric, rule.threshold)}，已持续 ${Math.round(elapsedMs / 1000)}s）`,
              value: val,
              details: buildAlertDetails(rule, snapshot),
              startedAt: new Date(startedAt).toISOString(),
              resolvedAt: null,
              acknowledged: false,
              notifyCount: 0,
              lastNotifiedAt: null,
            };

            alertHistory.push(record);
            activeAlerts.set(rule.id, record);
            saveHistory();

            logger?.warn({
              event: "alert_fired",
              ruleId: rule.id,
              ruleName: rule.name,
              value: val,
              threshold: rule.threshold,
              alertId: record.id,
              details: record.details,
            } as Record<string, unknown>);
          }
        } else {
          // Condition cleared → resolve immediately.
          // 旧实现要求跌到阈值 90% 以下才恢复，会让「卡在阈值附近」的告警永远 active，
          // 于是每过一个静默期就重复推送。这里只要不再高于阈值就恢复。
          if (breachStart.has(rule.id)) {
            breachStart.delete(rule.id);
          }
          const active = activeAlerts.get(rule.id);
          if (active) {
            active.resolvedAt = new Date(now).toISOString();
            activeAlerts.delete(rule.id);
            resolvedQueue.push(active);
            saveHistory();

            logger?.info({
              event: "alert_resolved",
              ruleId: rule.id,
              ruleName: rule.name,
              value: val,
              threshold: rule.threshold,
              alertId: active.id,
            } as Record<string, unknown>);
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

    markNotified(id: string): void {
      const record =
        [...activeAlerts.values()].find((r) => r.id === id) ??
        alertHistory.find((r) => r.id === id && r.resolvedAt === null);
      if (!record) return;
      record.notifyCount = (record.notifyCount ?? 0) + 1;
      record.lastNotifiedAt = new Date().toISOString();
      saveHistory();
    },

    drainResolved(): AlertRecord[] {
      return resolvedQueue.splice(0, resolvedQueue.length);
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
