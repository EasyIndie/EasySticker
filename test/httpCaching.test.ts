import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import sharp from "sharp";
import { buildApp } from "../src/app";
import { createFileAssetStore } from "../src/lib/assets";

/**
 * 缓存策略回归测试。
 *
 * `/api/assets/:id` 早期没有任何 cache-control，于是预览区每次页面加载都会把
 * 几十张图完整重传（实测 24 张贴纸 ≈ 1MB/次）。assetId 是内容不可变的 nanoid，
 * 可以放心长缓存 —— 这几条断言就是为了别再把那个头弄丢。
 */
describe("HTTP 缓存策略", () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "easysticker-cache-"));
  const app = buildApp({ host: "127.0.0.1", port: 0, dataDir, logLevel: "silent" });
  const store = createFileAssetStore(dataDir);
  const assetId = "cache-test-asset";

  beforeAll(async () => {
    store.save(
      await sharp({
        create: { width: 240, height: 240, channels: 4, background: { r: 1, g: 2, b: 3, alpha: 1 } }
      })
        .png()
        .toBuffer(),
      assetId,
      "png"
    );
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it("素材可以长缓存（immutable）", async () => {
    const res = await app.inject({ method: "GET", url: `/api/assets/${assetId}` });
    expect(res.statusCode).toBe(200);
    const cc = res.headers["cache-control"];
    expect(cc).toContain("public");
    expect(cc).toContain("immutable");
    expect(cc).toMatch(/max-age=(\d{7,})/); // 至少 100 天
  });

  it("HTML / CSS / JS 每次校验（改完前端不用记得 bump 版本号）", async () => {
    for (const url of ["/", "/index.html", "/styles.css", "/js/app.js"]) {
      const res = await app.inject({ method: "GET", url });
      expect(res.statusCode, url).toBe(200);
      expect(res.headers["cache-control"], url).toBe("no-cache");
    }
  });

  it("图标类静态资源用插件给的 1 小时缓存", async () => {
    const res = await app.inject({ method: "GET", url: "/logo.svg" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["cache-control"]).toContain("max-age=3600");
  });

  it("AI 接口不带长缓存", async () => {
    const res = await app.inject({ method: "GET", url: "/api/config" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["cache-control"] ?? "").not.toContain("immutable");
  });
});
