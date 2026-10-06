#!/usr/bin/env node
/**
 * 文档体检：校验仓库内 Markdown 的**相对链接**与**锚点**是否有效。
 *
 * 为什么需要：文档腐烂最常见、也最容易被忽略的就是死链 —— 重命名文件、
 * 调整标题、删除章节之后，引用还留在原处，读者点进去 404。本脚本零依赖，
 * 进 CI（`npm run docs:check`）就能防住这类回归。
 *
 * 规则：
 *   - 只检查相对链接（http/https/mailto/tel 及纯 `#anchor` 之外的都算）；
 *   - 链接目标文件必须存在（目录链接以 `/` 结尾也支持）；
 *   - 目标是 .md 且带 `#anchor` 时，校验锚点在目标文件里存在（GitHub slug 规则）；
 *   - 指向外部 URL 的锚点不校验（无法离线判断）。
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "dist-web",
  "coverage",
  "playwright-report",
  "test-results",
  "data",
  ".cache"
]);
const SKIP_PATH_SEGMENTS = [path.join(".pi", "run")];

function shouldSkipDir(absDir) {
  const rel = path.relative(ROOT, absDir);
  if (!rel) return false;
  const parts = rel.split(path.sep);
  if (parts.some((p) => SKIP_DIRS.has(p))) return true;
  return SKIP_PATH_SEGMENTS.some((seg) => rel === seg || rel.startsWith(seg + path.sep));
}

function walkMarkdown(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (shouldSkipDir(abs)) continue;
      walkMarkdown(abs, out);
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
      out.push(abs);
    }
  }
  return out;
}

/** GitHub 风格 slug：trim → 去标点/符号（保留字母数字、CJK、`-` `_`、空格）→ 空格转 `-`。 */
function slugify(text) {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M}\-_ ]/gu, "")
    .replace(/ /g, "-");
}

function headingSlugs(markdown) {
  const slugs = new Set();
  const seen = new Map();
  const withoutCode = stripCode(markdown);
  const headingRe = /^(#{1,6})\s+(.*?)\s*#*\s*$/gm;
  let match;
  while ((match = headingRe.exec(withoutCode)) !== null) {
    // 去掉标题里的行内格式（`code`、**bold**、[link](url)）
    const text = match[2]
      .replace(/`([^`]*)`/g, "$1")
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/[*_~]/g, "");
    const base = slugify(text);
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    slugs.add(count === 0 ? base : `${base}-${count}`);
  }
  return slugs;
}

/** 去掉围栏代码块与行内代码，避免把示例里的“链接”当成真链接。 */
function stripCode(markdown) {
  return markdown
    .replace(/```[\s\S]*?```/g, "")
    .replace(/~~~[\s\S]*?~~~/g, "")
    .replace(/`[^`\n]*`/g, "");
}

const LINK_RE = /!?\[[^\]]*\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g;

function isExternal(target) {
  return /^(https?:|mailto:|tel:|data:|ftp:)/i.test(target);
}

function main() {
  const files = walkMarkdown(ROOT);
  const errors = [];
  let checked = 0;

  const headingCache = new Map();
  const getHeadings = (absPath) => {
    if (!headingCache.has(absPath)) {
      headingCache.set(absPath, headingSlugs(fs.readFileSync(absPath, "utf-8")));
    }
    return headingCache.get(absPath);
  };

  for (const absFile of files) {
    const relFile = path.relative(ROOT, absFile);
    const raw = fs.readFileSync(absFile, "utf-8");
    const body = stripCode(raw);
    let m;
    while ((m = LINK_RE.exec(body)) !== null) {
      let target = m[1].trim();
      if (!target || target.startsWith("#")) {
        if (target.startsWith("#")) {
          const anchor = decodeURIComponent(target.slice(1));
          const own = getHeadings(absFile);
          checked++;
          if (anchor && !own.has(anchor)) {
            errors.push(`${relFile}: 锚点不存在 #${anchor}`);
          }
        }
        continue;
      }
      if (isExternal(target)) continue;

      const hashIndex = target.indexOf("#");
      const pathPart = hashIndex >= 0 ? target.slice(0, hashIndex) : target;
      const anchor = hashIndex >= 0 ? decodeURIComponent(target.slice(hashIndex + 1)) : "";
      if (!pathPart) continue;

      const decoded = decodeURIComponent(pathPart);
      const absTarget = path.resolve(path.dirname(absFile), decoded);
      checked++;

      if (!absTarget.startsWith(ROOT + path.sep) && absTarget !== ROOT) {
        errors.push(`${relFile}: 链接指到仓库外 ${target}`);
        continue;
      }

      if (decoded.endsWith("/")) {
        if (!fs.existsSync(absTarget) || !fs.statSync(absTarget).isDirectory()) {
          errors.push(`${relFile}: 目录不存在 ${target}`);
        }
        continue;
      }

      if (!fs.existsSync(absTarget) || !fs.statSync(absTarget).isFile()) {
        errors.push(`${relFile}: 文件不存在 ${target}`);
        continue;
      }

      if (anchor && absTarget.toLowerCase().endsWith(".md")) {
        if (!getHeadings(absTarget).has(anchor)) {
          errors.push(`${relFile}: 锚点不存在 ${target}`);
        }
      }
    }
  }

  if (errors.length) {
    console.error(`✗ 文档检查发现 ${errors.length} 个问题（共检查 ${checked} 个链接）：\n`);
    for (const err of errors) console.error("  - " + err);
    process.exit(1);
  }
  console.log(`✓ 文档链接检查通过：${files.length} 个 Markdown 文件，${checked} 个链接。`);
}

main();
