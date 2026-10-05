import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import sharp from "sharp";
import { buildApp } from "../src/app";
import { createFileAssetStore, findAssetFile } from "../src/lib/assets";
import { readZipEntries } from "../src/lib/zip";

describe("包的归属与访问控制", () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "easysticker-owner-"));
  const app = buildApp({ host: "127.0.0.1", port: 0, dataDir, logLevel: "silent" });
  const store = createFileAssetStore(dataDir);

  const ALICE = "aliceclient00001";
  const BOB = "bobclient000001";

  beforeAll(async () => {
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  /** 上传一张图并建一个包，返回 packId。 */
  async function makePack(clientId?: string, title = "归属测试"): Promise<string> {
    const assetId = `own-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    store.save(
      await sharp({
        create: { width: 240, height: 240, channels: 4, background: { r: 10, g: 20, b: 30, alpha: 1 } }
      })
        .png()
        .toBuffer(),
      assetId,
      "png"
    );
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (clientId) headers["x-client-id"] = clientId;
    const res = await app.inject({
      method: "POST",
      url: "/api/packs",
      payload: {
        presetId: "wechat_stickers",
        assets: [{ label: "001", assetId, role: "sticker", prompt: "提示词", style: "贴纸" }],
        metadata: { title },
        generation: { source: "ai-generate", providerId: "mock", prompt: "原始", styles: ["贴纸"] }
      },
      headers
    });
    expect(res.statusCode).toBe(200);
    return res.json().packId;
  }

  async function listPacksFor(clientId?: string) {
    const headers: Record<string, string> = {};
    if (clientId) headers["x-client-id"] = clientId;
    const res = await app.inject({ method: "GET", url: "/api/packs", headers });
    expect(res.statusCode).toBe(200);
    return res.json();
  }

  it("列表只返回自己的包", async () => {
    const alicePack = await makePack(ALICE, "Alice 的包");
    const bobPack = await makePack(BOB, "Bob 的包");

    const alice = await listPacksFor(ALICE);
    const ids = alice.packs.map((p: any) => p.packId);
    expect(ids).toContain(alicePack);
    expect(ids).not.toContain(bobPack);
    expect(alice.owner).toBe(`client:${ALICE}`);

    // 展示字段齐全，前端可以据此重建历史列表
    const entry = alice.packs.find((p: any) => p.packId === alicePack);
    expect(entry).toMatchObject({
      title: "Alice 的包",
      stickerCount: 1,
      styles: ["贴纸"],
      presetId: "wechat_stickers",
      owner: `client:${ALICE}`
    });
    expect(entry.downloadUrl).toBe(`/api/packs/${alicePack}/download`);
  });

  it("没有 client id 时列表为空 —— 不会把别人的包列出来", async () => {
    const anonymous = await listPacksFor();
    expect(anonymous.packs).toEqual([]);
    expect(anonymous.owner).toBeNull();
  });

  it("保留期信息一并返回，且过期时间不早于策略生效起点", async () => {
    const alice = await listPacksFor(ALICE);
    // 测试环境用的是仓库里的默认配置：保留 30 天
    expect(alice.retentionDays).toBe(30);
    for (const p of alice.packs) {
      if (!p.expiresAt) continue;
      expect(Date.parse(p.expiresAt)).toBeGreaterThan(Date.now());
    }
  });

  it("删别人的包 403，本人删除成功", async () => {
    const packId = await makePack(ALICE, "待删");

    const byBob = await app.inject({
      method: "DELETE",
      url: `/api/packs/${packId}`,
      headers: { "x-client-id": BOB }
    });
    expect(byBob.statusCode).toBe(403);
    // 还在
    expect((await app.inject({ method: "GET", url: `/api/packs/${packId}` })).statusCode).toBe(200);

    const byAlice = await app.inject({
      method: "DELETE",
      url: `/api/packs/${packId}`,
      headers: { "x-client-id": ALICE }
    });
    expect(byAlice.statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: `/api/packs/${packId}` })).statusCode).toBe(404);
  });

  it("download / restore 仍凭 packId 可用（与既有的公网访问一致）", async () => {
    const packId = await makePack(ALICE, "可下载");
    // 不带任何身份也能下载：`<a download>` 无法携带 Authorization
    const download = await app.inject({ method: "GET", url: `/api/packs/${packId}/download` });
    expect(download.statusCode).toBe(200);
    expect(readZipEntries(download.rawPayload).map((e) => e.name)).toContain("metadata.json");

    const byBob = await app.inject({
      method: "POST",
      url: `/api/packs/${packId}/restore`,
      payload: {},
      headers: { "x-client-id": BOB }
    });
    expect(byBob.statusCode).toBe(403);
  });

  it("owner 只存在清单里，不会写进 ZIP 的 metadata.json", async () => {
    const packId = await makePack(ALICE, "别泄露邮箱");
    const download = await app.inject({ method: "GET", url: `/api/packs/${packId}/download` });
    const metaEntry = readZipEntries(download.rawPayload, (n) => n === "metadata.json")[0]!;
    const metadata = JSON.parse(metaEntry.content.toString("utf8"));
    expect(metadata).not.toHaveProperty("owner");
    // 但清单里有
    const manifest = JSON.parse(fs.readFileSync(path.join(dataDir, "packs", `${packId}.json`), "utf8"));
    expect(manifest.owner).toBe(`client:${ALICE}`);
    expect(manifest.metadata).not.toHaveProperty("owner");
  });

  it("非法 client id 被忽略（不会当成归属）", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/packs",
      headers: { "x-client-id": "../etc/passwd" }
    });
    expect(res.json().owner).toBeNull();
  });

  it("素材查找仍拒绝路径穿越", () => {
    expect(findAssetFile(dataDir, "../../etc/passwd")).toBeNull();
  });
});
