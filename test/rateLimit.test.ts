import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app";

/**
 * 回归测试：静态资源（结果图片 / 打包下载）必须豁免 API 频率限制。
 *
 * 一次结果可能包含 24 张表情 + 封面/图标/横幅/赞赏图，浏览器会在渲染时几乎
 * 同时发起几十个 <img src="/api/assets/:id"> 请求。如果这些请求计入全局限流，
 * 就会瞬间超过 maxRequests 返回 429，图片加载失败并显示「生成失败」。
 */
describe("rate limit — 静态资源豁免", () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "easysticker-rl-"));
  const app = buildApp({
    host: "127.0.0.1",
    port: 0,
    dataDir,
    logLevel: "silent",
    security: { rateLimit: { maxRequests: 3, windowMs: 60_000 } }
  });

  beforeAll(async () => {
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it("批量请求 /api/assets/:id 不会被限流", async () => {
    for (let i = 0; i < 10; i++) {
      const res = await app.inject({ method: "GET", url: `/api/assets/missing-${i}` });
      expect(res.statusCode).not.toBe(429);
    }
  });

  it("下载路由 /api/packs/:id/download 不会被限流", async () => {
    for (let i = 0; i < 10; i++) {
      const res = await app.inject({ method: "GET", url: `/api/packs/missing-${i}/download` });
      expect(res.statusCode).not.toBe(429);
    }
  });

  it("普通受保护接口仍受频率限制", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 5; i++) {
      const res = await app.inject({ method: "GET", url: "/api/packs/does-not-exist" });
      statuses.push(res.statusCode);
    }
    // 前 3 次放行（随后 404），之后返回 429
    expect(statuses.slice(0, 3).every((s) => s !== 429)).toBe(true);
    expect(statuses[3]).toBe(429);
    expect(statuses[4]).toBe(429);
  });
});
