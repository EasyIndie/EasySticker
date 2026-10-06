import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app";
import { createFileAssetStore } from "../src/lib/assets";

/**
 * 文生图参考图：POST /api/generate/reference。
 *
 * 这是「参考图只能靠上传」的补充路径 —— 用 mock provider 验证：
 * 生成结果会落盘成 asset，且能像上传的参考图一样通过 /api/assets/:id 访问。
 */
describe("POST /api/generate/reference", () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "easysticker-genref-"));
  const assetStore = createFileAssetStore(dataDir);
  const app = buildApp(
    { host: "127.0.0.1", port: 0, dataDir, logLevel: "silent", security: { jwtSecret: "test-secret-genref" } },
    { assetStore }
  );

  afterAll(async () => {
    await app.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it("由文字生成参考图并落盘为可访问的 asset", async () => {
    await app.ready();
    const res = await app.inject({
      method: "POST",
      url: "/api/generate/reference",
      payload: { prompt: "一只戴红围巾的柴犬，白色背景", style: "水彩", provider: "mock" }
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.uploadId).toBeTruthy();
    expect(body.url).toBe(`/api/assets/${body.uploadId}`);
    expect(assetStore.find(body.uploadId)).toBeTruthy();

    const asset = await app.inject({ method: "GET", url: `/api/assets/${body.uploadId}` });
    expect(asset.statusCode).toBe(200);
    expect(asset.headers["content-type"]).toContain("image/");
  });

  it("缺少 prompt 返回 400", async () => {
    const res = await app.inject({ method: "POST", url: "/api/generate/reference", payload: { style: "水彩" } });
    expect(res.statusCode).toBe(400);
  });
});
