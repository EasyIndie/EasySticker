import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import sharp from "sharp";
import { buildApp } from "../src/app";
import { createFileAssetStore } from "../src/lib/assets";
import { recordAssetOwner } from "../src/lib/assetOwners";
import { createMonitorStore } from "../src/lib/monitorStore";
import { createUsageStore } from "../src/lib/usageStore";
import { createUserStore } from "../src/lib/userStore";
import { createPack, readPackManifest } from "../src/services/pack/service";

/**
 * 后台用户的软删（停用）与硬删（删除 + 清理数据）。
 *
 * 顺带覆盖一个真实缺口：被停用/删除的账号，其**已经签发**的 JWT
 * （默认 7 天）必须立即失效，否则停用形同虚设。
 */
describe("后台用户：停用与删除", () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "easysticker-user-admin-"));
  const userStore = createUserStore(dataDir);
  const usageStore = createUsageStore(dataDir);
  const monitorStore = createMonitorStore(dataDir);
  const assetStore = createFileAssetStore(dataDir);
  const app = buildApp(
    { host: "127.0.0.1", port: 0, dataDir, logLevel: "silent", security: { jwtSecret: "test-secret-user-admin" } },
    { userStore, usageStore, monitorStore, assetStore }
  );

  const png = (r: number) =>
    sharp({ create: { width: 240, height: 240, channels: 4, background: { r, g: 120, b: 160, alpha: 1 } } })
      .png()
      .toBuffer();

  let adminToken = "";
  let victimToken = "";
  let victimPackId = "";
  let victimAssetId = "";
  let victimOrphanId = "";
  const otherOrphanId = "other-orphan-1";

  const authed = (token: string) => ({ authorization: `Bearer ${token}` });

  beforeAll(async () => {
    userStore.register("admin@test.local", "pw", "admin");
    userStore.register("admin2@test.local", "pw", "admin");
    userStore.register("victim@test.local", "pw", "user");

    victimAssetId = "victim-asset-1";
    assetStore.save(await png(20), victimAssetId, "png");
    const created = await createPack(
      assetStore,
      dataDir,
      {
        presetId: "wechat_stickers",
        assets: [{ label: "001", assetId: victimAssetId, role: "sticker" }],
        metadata: { title: "victim 的包" },
        generation: { source: "ai-generate", providerId: "mock", prompt: "x", styles: ["贴纸"] }
      },
      "victim@test.local"
    );
    victimPackId = created.packId;

    // 归属 victim、但从未进入任何包的散图（purge 应清掉）
    victimOrphanId = "victim-orphan-1";
    assetStore.save(await png(50), victimOrphanId, "png");
    recordAssetOwner(dataDir, victimOrphanId, "victim@test.local");
    // 归属其他用户的散图（purge 不应触碰）
    assetStore.save(await png(60), otherOrphanId, "png");
    recordAssetOwner(dataDir, otherOrphanId, "other@test.local");

    usageStore.log({ email: "victim@test.local", action: "generate", success: true });
    usageStore.log({ email: "keep@test.local", action: "generate", success: true });
    monitorStore.recordRequest({ method: "GET", route: "/api/x", status: 200, durationMs: 5, user: "victim@test.local" });

    await app.ready();
    adminToken = app.jwt.sign({ email: "admin@test.local", role: "admin" });
    victimToken = app.jwt.sign({ email: "victim@test.local", role: "user" });
  });

  afterAll(async () => {
    await app.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it("停用后已签发的 token 立即失效，重新启用后恢复", async () => {
    const before = await app.inject({ method: "GET", url: "/api/auth/me", headers: authed(victimToken) });
    expect(before.statusCode).toBe(200);

    const off = await app.inject({
      method: "POST",
      url: "/api/admin/users/victim@test.local/toggle",
      headers: authed(adminToken)
    });
    expect(off.statusCode).toBe(200);
    expect(off.json().disabled).toBe(true);

    const blocked = await app.inject({ method: "GET", url: "/api/auth/me", headers: authed(victimToken) });
    expect(blocked.statusCode).toBe(401);

    const on = await app.inject({
      method: "POST",
      url: "/api/admin/users/victim@test.local/toggle",
      headers: authed(adminToken)
    });
    expect(on.json().disabled).toBe(false);

    const restored = await app.inject({ method: "GET", url: "/api/auth/me", headers: authed(victimToken) });
    expect(restored.statusCode).toBe(200);
  });

  it("不允许停用/删除当前登录的管理员", async () => {
    const toggleSelf = await app.inject({
      method: "POST",
      url: "/api/admin/users/admin@test.local/toggle",
      headers: authed(adminToken)
    });
    expect(toggleSelf.statusCode).toBe(400);

    const deleteSelf = await app.inject({
      method: "DELETE",
      url: "/api/admin/users/admin@test.local",
      headers: authed(adminToken)
    });
    expect(deleteSelf.statusCode).toBe(400);
  });

  it("管理员账号受保护：不能停用或删除其他管理员", async () => {
    const off = await app.inject({
      method: "POST",
      url: "/api/admin/users/admin2@test.local/toggle",
      headers: authed(adminToken)
    });
    expect(off.statusCode).toBe(400);

    const del = await app.inject({
      method: "DELETE",
      url: "/api/admin/users/admin2@test.local",
      headers: authed(adminToken)
    });
    expect(del.statusCode).toBe(400);
    expect(userStore.get("admin2@test.local")).toBeTruthy();
  });

  it("删除需要管理员权限", async () => {
    const anon = await app.inject({ method: "DELETE", url: "/api/admin/users/victim@test.local" });
    expect(anon.statusCode).toBe(401);
    const asUser = await app.inject({
      method: "DELETE",
      url: "/api/admin/users/victim@test.local",
      headers: authed(victimToken)
    });
    expect(asUser.statusCode).toBe(403);
  });

  it("硬删并清理：删除账号、名下包与素材、用量与监控记录", async () => {
    expect(readPackManifest(dataDir, victimPackId)).not.toBeNull();

    const res = await app.inject({
      method: "DELETE",
      url: "/api/admin/users/victim@test.local?purge=true",
      headers: authed(adminToken)
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.purged).toBe(true);
    expect(body.summary.packs).toBe(1);
    expect(body.summary.orphanAssets).toBe(1);
    expect(body.summary.reclaimedBytes).toBeGreaterThan(0);
    expect(body.summary.usageRecords).toBeGreaterThanOrEqual(1);
    expect(body.summary.monitorRecords).toBeGreaterThanOrEqual(1);

    // 账号没了，token 也随之失效
    expect(userStore.get("victim@test.local")).toBeUndefined();
    const blocked = await app.inject({ method: "GET", url: "/api/auth/me", headers: authed(victimToken) });
    expect(blocked.statusCode).toBe(401);

    // 关联数据被清理
    expect(readPackManifest(dataDir, victimPackId)).toBeNull();
    expect(assetStore.find(victimAssetId)).toBeNull();
    // 无归属引用的散图被清，其他用户的散图保留
    expect(assetStore.find(victimOrphanId)).toBeNull();
    expect(assetStore.find(otherOrphanId)).not.toBeNull();
    expect(usageStore.getSummary("victim@test.local").totalGenerated).toBe(0);
    // 其他用户不受影响
    expect(usageStore.getSummary("keep@test.local").totalGenerated).toBe(1);
  });

  it("不清理时只删账号，保留其数据", async () => {
    userStore.register("plain@test.local", "pw", "user");
    usageStore.log({ email: "plain@test.local", action: "generate", success: true });

    const res = await app.inject({
      method: "DELETE",
      url: "/api/admin/users/plain@test.local?purge=false",
      headers: authed(adminToken)
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().purged).toBe(false);
    expect(userStore.get("plain@test.local")).toBeUndefined();
    // 数据保留
    expect(usageStore.getSummary("plain@test.local").totalGenerated).toBe(1);
  });
});
