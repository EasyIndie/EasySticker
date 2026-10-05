#!/usr/bin/env node
/**
 * 构建期内容哈希：把 public/ 下所有 HTML 对本地静态资源的引用改写成
 *   /js/app.js          →  /js/app.js?v=a1b2c3d4
 *   /styles.css?v=24    →  /styles.css?v=a1b2c3d4
 *
 * 为什么需要它：只有「URL 跟着内容变」，才能对 JS/CSS 安全地开 immutable
 * 长缓存。否则一旦缓存了旧文件，用户浏览器就再也拿不到新版本 —— 这也是
 * 以前一直不敢给 JS/CSS 长缓存、只能靠人工 bump ?v= 的原因。
 *
 * 安全性来自两条互相锁死的规则：
 *   1. 本脚本保证 HTML 里每一个本地 js/css 引用都带 `?v=<内容哈希>`；
 *   2. HTML 本身永远走 no-cache（每次一个便宜的 304），所以哈希一变，
 *      用户下一次打开页面就会拿到新 URL 并重新下载。
 * 任何一条被破坏，immutable 就会变成「永久缓存旧文件」的陷阱，
 * 因此 test/httpCaching.test.ts 里有一条测试专门盯着规则 1。
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const publicDir = path.join(root, "public");

/** 只有这些扩展名会被哈希；HTML 之间互链不加版本号（页面本身 no-cache）。 */
const HASHED_EXTENSIONS = new Set([".js", ".css", ".svg", ".ico", ".png", ".webp", ".woff2"]);

const hashCache = new Map();

function contentHash(absPath) {
  if (!hashCache.has(absPath)) {
    const digest = createHash("sha256").update(readFileSync(absPath)).digest("hex");
    // 8 位足够区分：同一个文件内容变了必然换 URL
    hashCache.set(absPath, digest.slice(0, 8));
  }
  return hashCache.get(absPath);
}

function listFiles(dir, filter, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      listFiles(abs, filter, out);
    } else if (filter(abs)) {
      out.push(abs);
    }
  }
  return out;
}

const stats = { files: 0, rewritten: 0, unchanged: 0, skipped: [] };

/** 匹配 `src="/..."` / `href="/..."`，只认本地绝对路径。 */
const REFERENCE_RE = /\b(src|href)="(\/[^"]*)"/g;

for (const htmlPath of listFiles(publicDir, (p) => p.endsWith(".html"))) {
  const original = readFileSync(htmlPath, "utf-8");
  stats.files += 1;

  const next = original.replace(REFERENCE_RE, (match, attr, value) => {
    const [rawPath, query = ""] = value.split("?");
    if (!rawPath) return match;

    const ext = path.extname(rawPath).toLowerCase();
    // 页面互链、锚点、无扩展名的路径一律不动
    if (!HASHED_EXTENSIONS.has(ext)) {
      if (ext === "" || ext === ".html") stats.skipped.push(`${path.relative(root, htmlPath)} → ${value}`);
      return match;
    }

    const filePath = path.join(publicDir, decodeURIComponent(rawPath.replace(/^\/+/, "")));
    let isFile = false;
    try {
      isFile = statSync(filePath).isFile();
    } catch {
      isFile = false;
    }
    if (!isFile) {
      // 引用了不存在的文件：留着不动，但要能看见（通常是拼错或忘了构建）
      stats.skipped.push(`${path.relative(root, htmlPath)} → ${value} (文件不存在)`);
      return match;
    }

    const version = contentHash(filePath);
    const nextQuery = query.replace(/(^|&)v=[^&]*/g, "$1").replace(/^&/, "");
    const rebuilt = `${rawPath}?v=${version}${nextQuery ? `&${nextQuery}` : ""}`;

    if (rebuilt === value) {
      stats.unchanged += 1;
      return match;
    }
    stats.rewritten += 1;
    return `${attr}="${rebuilt}"`;
  });

  if (next !== original) writeFileSync(htmlPath, next);
}

console.log(
  `version-assets: 扫描 ${stats.files} 个 HTML，` +
    `更新 ${stats.rewritten} 处引用，${stats.unchanged} 处已是最新。`
);
for (const note of stats.skipped) console.log(`  · 跳过 ${note}`);
