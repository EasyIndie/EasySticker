import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createMonitorStore } from "../src/lib/monitorStore";

const tmpDirs: string[] = [];

function makeDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "easysticker-monitor-"));
  tmpDirs.push(dir);
  return dir;
}

afterEach(() => {
  vi.useRealTimers();
  while (tmpDirs.length) fs.rmSync(tmpDirs.pop()!, { recursive: true, force: true });
});

describe("monitorStore — 60s 滚动窗口由时间驱动", () => {
  it("没有新请求时，窗口随当前时间推进并清空陈旧数据", () => {
    vi.useFakeTimers();
    const start = new Date("2026-10-20T09:53:12.048Z");
    vi.setSystemTime(start);

    const store = createMonitorStore(makeDir());
    store.recordRequest({ method: "GET", route: "/api/config", status: 200, durationMs: 3 });
    store.recordRequest({ method: "GET", route: "/api/packs", status: 401, durationMs: 2 });

    expect(store.getCurrentSnapshot().requestsLastMinute).toBe(2);

    // 只推进时钟，不产生任何 /api 请求，也不手动触发定时器：
    // getCurrentSnapshot() 会先把窗口推进到当前时刻。
    vi.setSystemTime(new Date(start.getTime() + 61_000));
    const snapshot = store.getCurrentSnapshot();

    expect(snapshot.requestsLastMinute).toBe(0);
    expect(snapshot.errorsLastMinute).toBe(0);
    expect(snapshot.serverErrorsLastMinute).toBe(0);
  });

  it("定时器会主动推进 slot，空闲后新请求不会和旧数据叠加", () => {
    vi.useFakeTimers();
    const start = new Date("2026-10-20T09:53:12.048Z");
    vi.setSystemTime(start);

    const store = createMonitorStore(makeDir());
    store.recordRequest({ method: "GET", route: "/api/packs", status: 500, durationMs: 2 });

    // 等待超过一个完整窗口，期间没有任何请求，仅靠 1s 定时器推进 slot。
    vi.advanceTimersByTime(61_000);

    expect(store.getCurrentSnapshot().serverErrorsLastMinute).toBe(0);

    store.recordRequest({ method: "GET", route: "/api/config", status: 200, durationMs: 3 });
    const snapshot = store.getCurrentSnapshot();
    expect(snapshot.requestsLastMinute).toBe(1);
    expect(snapshot.serverErrorsLastMinute).toBe(0);
  });
});
