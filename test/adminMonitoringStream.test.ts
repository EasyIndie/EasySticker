import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app";
import { createAlertEngine } from "../src/lib/alertEngine";
import { createMonitorStore } from "../src/lib/monitorStore";

/**
 * 后台仪表盘的实时数据流。
 *
 * 这里刻意用「真实 listen + fetch」而不是 app.inject：SSE 是一条长连接，
 * 需要在 headers 之后持续写数据，inject 的请求/响应模型测不出这个行为。
 * 重点验证三件事：鉴权、首帧立即到达、后续按周期推送。
 */
describe("后台监控 SSE", () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "easysticker-sse-"));
  const monitorStore = createMonitorStore(dataDir);
  const alertEngine = createAlertEngine(path.join(dataDir, "alerts.json"), monitorStore);
  const app = buildApp(
    {
      host: "127.0.0.1",
      port: 0,
      dataDir,
      logLevel: "silent",
      security: { jwtSecret: "test-secret-for-sse" }
    },
    { monitorStore, alertEngine }
  );
  let baseUrl = "";
  let adminToken = "";

  beforeAll(async () => {
    await app.listen({ port: 0, host: "127.0.0.1" });
    const { port } = app.server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${port}`;
    adminToken = app.jwt.sign({ email: "admin@test.local", role: "admin" });
  });

  afterAll(async () => {
    // SSE 是长连接，app.close() 会一直等它自然结束；测试结束前主动掐断。
    app.server.closeAllConnections?.();
    await app.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }, 20_000);

  /**
   * 读取 SSE 流，直到收集到 `count` 个指定类型的事件（或超时）。
   * 按类型过滤是必要的：alerts 帧只在内容变化时推，刚连上的第一帧会带上它，
   * 所以「收到 3 个事件」不等于「收到 3 个 snapshot」。
   */
  async function readEvents(
    count: number,
    eventName = "snapshot",
    timeoutMs = 12_000
  ): Promise<Array<{ event: string; data: any }>> {
    const res = await fetch(`${baseUrl}/api/admin/monitoring/stream`, {
      headers: { accept: "text/event-stream", authorization: `Bearer ${adminToken}` }
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    expect(res.headers.get("cache-control")).toContain("no-cache");

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const events: Array<{ event: string; data: any }> = [];
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      let matched = 0;
      while (matched < count) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let idx: number;
        while ((idx = buffer.indexOf("\n\n")) !== -1) {
          const block = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          const eventLine = /^event: (.+)$/m.exec(block)?.[1];
          const dataLine = /^data: (.+)$/m.exec(block)?.[1];
          if (eventLine && dataLine) {
            events.push({ event: eventLine, data: JSON.parse(dataLine) });
            if (eventLine === eventName) matched += 1;
          }
        }
      }
    } finally {
      clearTimeout(timer);
      controller.abort();
    }
    return events;
  }

  it("未登录访问监控流返回 401", async () => {
    const res = await fetch(`${baseUrl}/api/admin/monitoring/stream`, {
      headers: { accept: "text/event-stream" }
    });
    expect(res.status).toBe(401);
    // 不能把 401 也当成 event-stream 挂着，必须立刻结束
    await res.text();
  });

  it("普通用户（非管理员）访问监控流返回 403", async () => {
    const token = app.jwt.sign({ email: "user@test.local", role: "user" });
    const res = await fetch(`${baseUrl}/api/admin/monitoring/stream`, {
      headers: { accept: "text/event-stream", authorization: `Bearer ${token}` }
    });
    expect(res.status).toBe(403);
    await res.text();
  });

  it("连接后立即推送一帧快照，并附上告警列表", async () => {
    // 首帧 snapshot 之后紧跟一帧 alerts，收 2 个 snapshot 即可确保都到齐
    const events = await readEvents(2);
    const snapshot = events.find((e) => e.event === "snapshot");
    const alerts = events.find((e) => e.event === "alerts");

    expect(snapshot, "应立刻收到 snapshot 帧，不用等第一个采样周期").toBeTruthy();
    expect(snapshot!.data.snapshot).toHaveProperty("cpu");
    expect(snapshot!.data.snapshot).toHaveProperty("memory");
    expect(snapshot!.data.trends).toHaveProperty("requestsPerMinute");

    expect(alerts, "首帧后应跟一帧 alerts").toBeTruthy();
    expect(Array.isArray(alerts!.data.alerts)).toBe(true);
  }, 15_000);

  it("之后按 5 秒周期持续推送快照（不是一次性响应）", async () => {
    // 收 3 帧：首帧 + 两个周期，超过 5 秒才可能拿满，能证明连接是持续的
    const started = Date.now();
    const events = await readEvents(3);
    const snapshots = events.filter((e) => e.event === "snapshot");
    expect(snapshots.length).toBe(3);
    expect(events.filter((e) => e.event === "alerts").length).toBe(1); // 告警未变化，只推一次
    expect(Date.now() - started).toBeGreaterThan(5_000);
  }, 20_000);
});
