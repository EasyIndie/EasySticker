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

  it("HTML 每次校验（新资源哈希靠它被发现）", async () => {
    for (const url of ["/", "/index.html"]) {
      const res = await app.inject({ method: "GET", url });
      expect(res.statusCode, url).toBe(200);
      expect(res.headers["cache-control"], url).toBe("no-cache");
    }
  });

  it("带内容哈希的 JS / CSS 可以长缓存", async () => {
    // 从真实 HTML 里取版本号，避免测试写死哈希后跟着构建一起烂掉
    const html = fs.readFileSync(path.join(process.cwd(), "public/index.html"), "utf-8");
    const app1 = /<script[^>]+src="(\/js\/app\.js\?v=[^"]+)"/.exec(html)?.[1];
    const css = /<link[^>]+href="(\/styles\.css\?v=[^"]+)"/.exec(html)?.[1];
    expect(app1, "index.html 里的 /js/app.js 应带有 ?v= 内容哈希").toBeTruthy();
    expect(css, "index.html 里的 /styles.css 应带有 ?v= 内容哈希").toBeTruthy();

    for (const url of [app1!, css!]) {
      const res = await app.inject({ method: "GET", url });
      expect(res.statusCode, url).toBe(200);
      expect(res.headers["cache-control"], url).toContain("immutable");
    }
  });

  it("没带版本号的 JS / CSS 退回 no-cache（不能永久缓存旧文件）", async () => {
    for (const url of ["/styles.css", "/js/app.js", "/logo.svg"]) {
      const res = await app.inject({ method: "GET", url });
      expect(res.statusCode, url).toBe(200);
      expect(res.headers["cache-control"], url).toBe("no-cache");
    }
  });

  it("所有 HTML 里的本地 js/css/svg/ico 引用都必须带 ?v=（否则 immutable 会锁死旧文件）", () => {
    const publicDir = path.join(process.cwd(), "public");
    const htmlFiles = fs
      .readdirSync(publicDir)
      .filter((name) => name.endsWith(".html"))
      .map((name) => path.join(publicDir, name));
    expect(htmlFiles.length).toBeGreaterThan(0);

    const offenders: string[] = [];
    for (const file of htmlFiles) {
      const html = fs.readFileSync(file, "utf-8");
      for (const m of html.matchAll(/\b(?:src|href)="([^"]+)"/g)) {
        const ref = m[1];
        // 跳过外链、锚点、data: 等非本地引用
        if (/^(?:#|https?:|mailto:|data:|\/\/)/.test(ref)) continue;
        const clean = ref.split("?")[0];
        // 只盯静态资源；HTML 互链没有版本号是有意的（页面本身 no-cache）
        if (!/\.(?:js|css|svg|ico|png|webp|woff2)$/.test(clean)) continue;
        // 相对路径（如 `admin.css?v=8`）不会被 version-assets 改写，
        // 却会被服务端当成带版本的 immutable 资源 —— 内容变了老用户也拿不到。
        if (!/^(?:\/|\.\/)/.test(ref)) {
          offenders.push(`${path.basename(file)} → ${ref}（相对路径，version-assets 不会改写）`);
          continue;
        }
        if (!/\?v=[0-9a-f]{8}/.test(ref)) {
          offenders.push(`${path.basename(file)} → ${ref}（缺少内容哈希）`);
        }
      }
    }
    expect(
      offenders,
      "跑一下 `npm run web:version`（web:build 已内置）给这些引用补上内容哈希"
    ).toEqual([]);
  });

  it("AI 接口不带长缓存", async () => {
    const res = await app.inject({ method: "GET", url: "/api/config" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["cache-control"] ?? "").not.toContain("immutable");
  });
});
