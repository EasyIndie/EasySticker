import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import sharp from "sharp";
import { buildApp } from "../src/app";
import { createFileAssetStore } from "../src/lib/assets";
import { createUserStore } from "../src/lib/userStore";
import { createPack, readPackManifest } from "../src/services/pack/service";

/**
 * 后台「全部包」列表的删除接口。
 *
 * 这里刻意走 HTTP（app.inject）而不是直接调 service：批量删除是路由层新加的，
 * 鉴权、参数校验、以及「删包后立即回收素材」都需要在真实请求链路上验证。
 */
describe("后台包删除接口", () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "easysticker-admin-packs-"));
  const store = createFileAssetStore(dataDir);
  // JWT 账号必须真实存在于 userStore，否则会被「已删除账号 token 失效」钩子挡下
  const userStore = createUserStore(dataDir);
  const app = buildApp(
    {
      host: "127.0.0.1",
      port: 0,
      dataDir,
      logLevel: "silent",
      security: { jwtSecret: "test-secret-admin-packs" }
    },
    { userStore }
  );
  let adminToken = "";

  const png = (r: number) =>
    sharp({ create: { width: 240, height: 240, channels: 4, background: { r, g: 120, b: 160, alpha: 1 } } })
      .png()
      .toBuffer();

  let seq = 0;
  async function mkPack(label: string): Promise<{ packId: string; assetId: string }> {
    const assetId = `admin-pack-asset-${Date.now()}-${seq++}`;
    store.save(await png((seq * 17) % 255), assetId, "png");
    const created = await createPack(store, dataDir, {
      presetId: "wechat_stickers",
      assets: [{ label: "001", assetId, role: "sticker" }],
      metadata: { title: label },
      generation: { source: "ai-generate", providerId: "mock", prompt: "x", styles: ["贴纸"] }
    });
    return { packId: created.packId, assetId };
  }

  beforeAll(async () => {
    userStore.register("admin@test.local", "pw", "admin");
    userStore.register("user@test.local", "pw", "user");
    await app.ready();
    adminToken = app.jwt.sign({ email: "admin@test.local", role: "admin" });
  });

  afterAll(async () => {
    await app.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it("DELETE /api/admin/packs/:id 删包并立即回收素材", async () => {
    const { packId, assetId } = await mkPack("单删");
    const res = await app.inject({
      method: "DELETE",
      url: `/api/admin/packs/${packId}`,
      headers: { authorization: `Bearer ${adminToken}` }
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().reclaimedBytes).toBeGreaterThan(0);
    expect(readPackManifest(dataDir, packId)).toBeNull();
    expect(store.find(assetId)).toBeNull();
  });

  it("POST /api/admin/packs/bulk-delete 批量删除并回收", async () => {
    const a = await mkPack("批删A");
    const b = await mkPack("批删B");
    const res = await app.inject({
      method: "POST",
      url: "/api/admin/packs/bulk-delete",
      headers: { authorization: `Bearer ${adminToken}`, "content-type": "application/json" },
      payload: { packIds: [a.packId, b.packId, "missing-id"] }
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect([...body.deleted].sort()).toEqual([a.packId, b.packId].sort());
    expect(body.missing).toContain("missing-id");
    expect(store.find(a.assetId)).toBeNull();
    expect(store.find(b.assetId)).toBeNull();
  });

  it("缺少 packIds 返回 400", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/admin/packs/bulk-delete",
      headers: { authorization: `Bearer ${adminToken}`, "content-type": "application/json" },
      payload: {}
    });
    expect(res.statusCode).toBe(400);
  });

  it("非管理员不能批量删除", async () => {
    const userToken = app.jwt.sign({ email: "user@test.local", role: "user" });
    const res = await app.inject({
      method: "POST",
      url: "/api/admin/packs/bulk-delete",
      headers: { authorization: `Bearer ${userToken}`, "content-type": "application/json" },
      payload: { packIds: ["x"] }
    });
    expect(res.statusCode).toBe(403);
  });
});
