import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createAlertEngine, type AlertRule } from "../src/lib/alertEngine";
import { createAlertNotifier } from "../src/lib/alertNotifier";
import type { CurrentMetrics } from "../src/lib/monitorStore";

const tmpDirs: string[] = [];

function makeDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "easysticker-alert-"));
  tmpDirs.push(dir);
  return dir;
}

function writeConfig(dir: string, rules: AlertRule[]): string {
  const configPath = path.join(dir, "alerts.json");
  fs.writeFileSync(
    configPath,
    JSON.stringify({ rules, webhookUrl: "", webhookEnabled: false, notificationInterval: 60_000, monitorRetentionDays: 7 }, null, 2),
    "utf-8"
  );
  return configPath;
}

function snapshot(overrides: Partial<CurrentMetrics> = {}): CurrentMetrics {
  return {
    cpu: { percent: 10, loadAvg: [1, 1, 1] },
    memory: { totalMb: 1000, usedMb: 100, percent: 10 },
    disk: { totalMb: 1000, usedMb: 100, percent: 10 },
    uptime: 100,
    requestsLastMinute: 100,
    requestsLastMinuteTotal: 100,
    errorsLastMinute: 0,
    clientErrorsLastMinute: 0,
    serverErrorsLastMinute: 0,
    errorBreakdown: { windowSeconds: 60, byStatus: [], byRoute: [] },
    avgLatencyLastMinute: 10,
    ...overrides
  };
}

function fakeStore(getSnapshot: () => CurrentMetrics) {
  return { getCurrentSnapshot: getSnapshot } as any;
}

const SERVER_RULE: AlertRule = {
  id: "error_rate_high",
  name: "服务端错误率过高（5xx）",
  metric: "serverErrorRate",
  operator: "gt",
  threshold: 0.02,
  duration: 0,
  silenceMs: 600_000,
  enabled: true
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  while (tmpDirs.length) fs.rmSync(tmpDirs.pop()!, { recursive: true, force: true });
});

describe("alertEngine — 错误率告警只针对 5xx 且消息可定位", () => {
  it("纯 4xx 噪声不会触发服务端错误率告警", () => {
    const dir = makeDir();
    const store = fakeStore(() =>
      snapshot({ clientErrorsLastMinute: 60, errorsLastMinute: 60, serverErrorsLastMinute: 0 })
    );
    const engine = createAlertEngine(writeConfig(dir, [SERVER_RULE]), store);

    engine.evaluate();
    expect(engine.getActiveAlerts()).toHaveLength(0);
  });

  it("5xx 超阈值触发，消息带单位/阈值/持续时间，details 带路由与状态码", () => {
    const dir = makeDir();
    const store = fakeStore(() =>
      snapshot({
        requestsLastMinute: 100,
        errorsLastMinute: 20,
        clientErrorsLastMinute: 15,
        serverErrorsLastMinute: 5,
        errorBreakdown: {
          windowSeconds: 60,
          byStatus: [
            { status: 500, count: 5 },
            { status: 404, count: 15 }
          ],
          byRoute: [
            { route: "/api/generate/start", count: 10, client: 5, server: 5 },
            { route: "/api/packs", count: 10, client: 10, server: 0 }
          ]
        }
      })
    );
    const engine = createAlertEngine(writeConfig(dir, [SERVER_RULE]), store);

    engine.evaluate();
    const active = engine.getActiveAlerts();
    expect(active).toHaveLength(1);

    // 5/100 = 5.00%，阈值 2.00%
    expect(active[0].message).toContain("5.00%");
    expect(active[0].message).toContain("2.00%");
    expect(active[0].metric).toBe("serverErrorRate");

    const details = (active[0].details ?? []).join("\n");
    expect(details).toContain("/api/generate/start");
    expect(details).toContain("5xx 5 / 4xx 5");
    expect(details).toContain("500×5");
    expect(details).toContain("排查建议");
  });

  it("值回落到阈值（而非 90%）即恢复，不再卡在 active 重复推送", () => {
    const dir = makeDir();
    let snap = snapshot({ serverErrorsLastMinute: 3, errorsLastMinute: 3 });
    const engine = createAlertEngine(writeConfig(dir, [SERVER_RULE]), fakeStore(() => snap));

    engine.evaluate();
    expect(engine.getActiveAlerts()).toHaveLength(1);

    // 正好等于阈值 2/100 = 2%：旧实现会停在死区里永不恢复
    snap = snapshot({ serverErrorsLastMinute: 2, errorsLastMinute: 2 });
    engine.evaluate();

    expect(engine.getActiveAlerts()).toHaveLength(0);
    const resolved = engine.drainResolved();
    expect(resolved).toHaveLength(1);
    expect(resolved[0].resolvedAt).toBeTruthy();
    // drain 只取一次
    expect(engine.drainResolved()).toHaveLength(0);
  });

  it("markNotified 写入 notifyCount/lastNotifiedAt 并持久化，重启后不会立刻重复推送", () => {
    const dir = makeDir();
    const configPath = writeConfig(dir, [SERVER_RULE]);
    const engine = createAlertEngine(configPath, fakeStore(() => snapshot({ serverErrorsLastMinute: 5, errorsLastMinute: 5 })));
    engine.evaluate();

    const alert = engine.getActiveAlerts()[0];
    engine.markNotified(alert.id);

    const historyPath = path.join(dir, "alerts-history.json");
    const saved = JSON.parse(fs.readFileSync(historyPath, "utf-8"));
    expect(saved[0].notifyCount).toBe(1);
    expect(saved[0].lastNotifiedAt).toBeTruthy();

    // 重新加载（模拟重启）：活跃告警恢复，且带上上次通知时间
    const reloaded = createAlertEngine(configPath, fakeStore(() => snapshot({ serverErrorsLastMinute: 5, errorsLastMinute: 5 })));
    const restored = reloaded.getActiveAlerts();
    expect(restored).toHaveLength(1);
    expect(restored[0].lastNotifiedAt).toBe(saved[0].lastNotifiedAt);
  });

  it("历史配置迁移：error_rate_high 从 errorRate 切到 serverErrorRate", () => {
    const dir = makeDir();
    const legacy: AlertRule = {
      id: "error_rate_high",
      name: "错误率过高",
      metric: "errorRate",
      operator: "gt",
      threshold: 0.05,
      duration: 120,
      silenceMs: 600_000,
      enabled: true
    };
    const configPath = writeConfig(dir, [legacy]);
    const engine = createAlertEngine(configPath, fakeStore(() => snapshot()));

    const migrated = engine.getRules()[0];
    expect(migrated.metric).toBe("serverErrorRate");
    expect(migrated.name).toBe("服务端错误率过高（5xx）");
    expect(migrated.threshold).toBe(0.02);
    // 迁移结果落盘
    const persisted = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    expect(persisted.rules[0].metric).toBe("serverErrorRate");
  });
});

describe("alertNotifier — webhook 内容带归因", () => {
  const alert = {
    id: "a1",
    rule: "error_rate_high",
    metric: "serverErrorRate",
    message: "服务端错误率过高（5xx）：5.00%（阈值 2.00%，已持续 120s）",
    value: 0.05,
    details: [
      "统计窗口：最近 60s，共 100 次请求、20 次错误（5xx 5 / 4xx 15）",
      "出错最多：/api/generate/start（5xx 5 / 4xx 0）",
      "状态码分布：500×5，404×15"
    ],
    startedAt: "2024-01-01T00:00:00.000Z",
    resolvedAt: null as string | null,
    acknowledged: false,
    notifyCount: 1,
    lastNotifiedAt: null as string | null
  };

  function captureFetch() {
    const calls: Array<{ url: string; body: any }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: any) => {
        calls.push({ url, body: JSON.parse(init.body) });
        return { ok: true, status: 200 } as any;
      })
    );
    return calls;
  }

  it("飞书卡片包含当前值、阈值与出错路由", async () => {
    const calls = captureFetch();
    const notifier = createAlertNotifier(() => ({
      rules: [SERVER_RULE],
      webhookUrl: "https://open.feishu.cn/open-apis/bot/v2/hook/xxx",
      webhookEnabled: true,
      notificationInterval: 60_000,
      monitorRetentionDays: 7
    }));

    expect(await notifier.send(alert as any)).toBe(true);
    const content = calls[0].body.card.elements[0].text.content as string;
    expect(content).toContain("5.00%");
    expect(content).toContain("/api/generate/start");
    expect(content).toContain("归因 / 排查");
  });

  it("恢复通知标题为绿色「告警恢复」", async () => {
    const calls = captureFetch();
    const notifier = createAlertNotifier(() => ({
      rules: [SERVER_RULE],
      webhookUrl: "https://open.feishu.cn/open-apis/bot/v2/hook/xxx",
      webhookEnabled: true,
      notificationInterval: 60_000,
      monitorRetentionDays: 7
    }));

    await notifier.send({ ...alert, resolvedAt: "2024-01-01T00:10:00.000Z" } as any);
    expect(calls[0].body.card.header.title.content).toContain("恢复");
    expect(calls[0].body.card.header.template).toBe("green");
  });

  it("通用 webhook 同时给出 text 与结构化字段", async () => {
    const calls = captureFetch();
    const notifier = createAlertNotifier(() => ({
      rules: [SERVER_RULE],
      webhookUrl: "https://example.com/hook",
      webhookEnabled: true,
      notificationInterval: 60_000,
      monitorRetentionDays: 7
    }));

    await notifier.send(alert as any);
    expect(calls[0].body.text).toContain("告警");
    expect(calls[0].body.text).toContain("/api/generate/start");
    expect(calls[0].body.alert.metric).toBe("serverErrorRate");
    expect(calls[0].body.alert.details).toHaveLength(3);
  });
});
