#!/usr/bin/env node
/**
 * 修复 / 补全历史包中的 metadata.json。
 *
 * 早期版本导出的 ZIP，其 metadata.json 只有 `assets`（assetId/filename/zipPath），
 * 没有文件尺寸、角色，也没有生成时的提示词 / 风格。图片本身不会丢（都在 ZIP 里），
 * 这个脚本会：
 *
 *   1. 读出旧 ZIP 里的所有条目；
 *   2. 用 sharp 重新测量每张图的 width/height/format/mimeType/bytes；
 *   3. 按路径推断角色（assets/*.png → sticker；meta/*.png → cover/banner/icon/reward-*）；
 *   4. 升级为 `easysticker-pack@0.2` 结构（files + generation）；
 *   5. 原样重写 ZIP（先备份为 `<packId>.zip.orig`，packId 与下载链接不变）。
 *
 * 生成上下文（原始提示词 / 风格 / 提供商 / 参考图）后端没有留存，可从浏览器的
 * localStorage 导出后通过 --context 传入：
 *
 *   # 浏览器 console（在项目页面执行）：
 *   copy(localStorage.getItem('easysticker:last-wechat-pack'))
 *
 *   把它保存成 context.json，然后：
 *   node scripts/repair-pack.mjs <packId> --context context.json
 *
 * 用法：
 *   node scripts/repair-pack.mjs <packId> [--context <file.json>] [--dry-run]
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";
import archiver from "archiver";
import sharp from "sharp";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const EXTRA_ROLES = ["cover", "banner", "icon", "reward-guide", "reward-thanks"];

/* ── 最小 ZIP 读取（只需支持本项目 archiver 产出的包） ───────────────────── */

function findEocd(buf) {
  for (let i = buf.length - 22; i >= 0 && i >= buf.length - 22 - 0xffff; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) return i;
  }
  return -1;
}

function dosToDate(time, date) {
  const year = ((date >> 9) & 0x7f) + 1980;
  const month = Math.max((date >> 5) & 0x0f, 1);
  const day = Math.max(date & 0x1f, 1);
  return new Date(
    year,
    month - 1,
    day,
    (time >> 11) & 0x1f,
    (time >> 5) & 0x3f,
    (time & 0x1f) * 2
  );
}

/** 读取 ZIP 的所有条目（名称 + 解压后的内容 + 修改时间）。 */
export function readZipEntries(buf) {
  const eocd = findEocd(buf);
  if (eocd < 0) throw new Error("不是有效的 ZIP：找不到 EOCD");
  const count = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  const entries = [];
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(off) !== 0x02014b50) throw new Error("ZIP 中央目录损坏");
    const method = buf.readUInt16LE(off + 10);
    const time = buf.readUInt16LE(off + 12);
    const date = buf.readUInt16LE(off + 14);
    const compSize = buf.readUInt32LE(off + 20);
    const nameLen = buf.readUInt16LE(off + 28);
    const extraLen = buf.readUInt16LE(off + 30);
    const commentLen = buf.readUInt16LE(off + 32);
    const localOff = buf.readUInt32LE(off + 42);
    const name = buf.toString("utf8", off + 46, off + 46 + nameLen);
    if (buf.readUInt32LE(localOff) !== 0x04034b50) throw new Error(`ZIP 本地头损坏：${name}`);
    const lNameLen = buf.readUInt16LE(localOff + 26);
    const lExtraLen = buf.readUInt16LE(localOff + 28);
    const start = localOff + 30 + lNameLen + lExtraLen;
    const raw = buf.subarray(start, start + compSize);
    entries.push({
      name,
      content: method === 0 ? Buffer.from(raw) : zlib.inflateRawSync(raw),
      date: dosToDate(time, date)
    });
    off += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

/* ── 元数据重建 ─────────────────────────────────────────────────────────── */

async function fileFacts(content) {
  const bytes = content.length;
  try {
    const meta = await sharp(content).metadata();
    const format = meta.format ?? null;
    return {
      width: meta.width ?? null,
      height: meta.height ?? null,
      format,
      mimeType: format ? `image/${format === "jpg" ? "jpeg" : format}` : null,
      bytes
    };
  } catch {
    return { width: null, height: null, format: null, mimeType: null, bytes };
  }
}

/** 从编译后的提示词里回填风格 / 情绪（模板格式：…\n风格：X\n…）。 */
function parseCompiledPrompt(prompt) {
  const style = /(?:^|\n)风格：([^\n]+)/.exec(prompt)?.[1]?.trim();
  const emotion = /(?:^|\n)当前表情主题与动作：([^\n]+)/.exec(prompt)?.[1]?.trim();
  return { style, emotion };
}

function toArrayContext(raw) {
  if (!raw || typeof raw !== "object") return null;
  return {
    provider: raw.provider ?? raw.providerId,
    prompt: raw.prompt,
    styles: Array.isArray(raw.styles) ? raw.styles.filter(Boolean) : undefined,
    stickerCount: raw.stickerCount,
    referenceAssetId: raw.referenceAssetId ?? raw.uploadId ?? undefined,
    referenceMode: raw.referenceMode,
    // localStorage 的 result.stickers[].prompt
    stickers: Array.isArray(raw.stickers)
      ? raw.stickers
      : Array.isArray(raw.result?.stickers)
        ? raw.result.stickers
        : undefined
  };
}

export async function repairPack(packId, options = {}) {
  const zipPath = path.join(ROOT, "data", "packs", `${packId}.zip`);
  if (!fs.existsSync(zipPath)) throw new Error(`找不到包：${zipPath}`);

  const entries = readZipEntries(fs.readFileSync(zipPath));
  const metaEntry = entries.find((e) => e.name === "metadata.json");
  if (!metaEntry) throw new Error("ZIP 里没有 metadata.json");
  const oldMeta = JSON.parse(metaEntry.content.toString("utf8"));

  const context = toArrayContext(options.context);

  const assetIdByZip = new Map((oldMeta.assets ?? []).map((a) => [a.zipPath, a.assetId]));
  const extraIdByRole = new Map(
    [
      ["cover", oldMeta.extras?.coverAssetId],
      ["banner", oldMeta.extras?.bannerAssetId],
      ["icon", oldMeta.extras?.iconAssetId],
      ["reward-guide", oldMeta.extras?.rewardGuideAssetId],
      ["reward-thanks", oldMeta.extras?.rewardThanksAssetId]
    ].filter(([, id]) => Boolean(id))
  );

  const stickerPrompts = new Map();
  for (const s of context?.stickers ?? []) {
    if (s?.label && s?.prompt) stickerPrompts.set(String(s.label), s.prompt);
  }

  const files = [];
  for (const entry of entries) {
    if (entry.name === "metadata.json") continue;
    const isSticker = entry.name.startsWith("assets/");
    const filename = path.basename(entry.name);
    const role = isSticker ? "sticker" : path.basename(entry.name, path.extname(entry.name));
    if (!isSticker && !EXTRA_ROLES.includes(role)) continue;

    const label = isSticker ? path.basename(filename, path.extname(filename)) : undefined;
    const record = {
      role,
      ...(label ? { label } : {}),
      assetId: isSticker ? assetIdByZip.get(entry.name) : extraIdByRole.get(role),
      filename,
      zipPath: entry.name,
      ...(await fileFacts(entry.content))
    };

    const compiled = isSticker && label ? stickerPrompts.get(label) : undefined;
    if (compiled) {
      record.prompt = compiled;
      const { style, emotion } = parseCompiledPrompt(compiled);
      if (style) record.style = style;
      if (emotion) record.emotion = emotion;
    }
    files.push(record);
  }

  const generation = context
    ? {
        source: "ai-generate",
        ...(context.provider ? { providerId: context.provider } : {}),
        ...(context.prompt ? { prompt: context.prompt } : {}),
        ...(context.styles?.length ? { styles: context.styles } : {}),
        ...(context.stickerCount ? { stickerCount: context.stickerCount } : {}),
        ...(context.referenceAssetId ? { referenceAssetId: context.referenceAssetId } : {}),
        ...(context.referenceMode ? { referenceMode: context.referenceMode } : {}),
        include: {
          cover: Boolean(oldMeta.extras?.coverAssetId),
          icon: Boolean(oldMeta.extras?.iconAssetId),
          banner: Boolean(oldMeta.extras?.bannerAssetId),
          reward: Boolean(oldMeta.extras?.rewardGuideAssetId || oldMeta.extras?.rewardThanksAssetId)
        },
        createdAt: oldMeta.createdAt
      }
    : undefined;

  const newMeta = {
    schema: "easysticker-pack@0.2",
    packId: oldMeta.packId,
    presetId: oldMeta.presetId,
    createdAt: oldMeta.createdAt,
    metadata: oldMeta.metadata ?? {},
    ...(generation ? { generation } : {}),
    extras: {
      coverAssetId: oldMeta.extras?.coverAssetId ?? null,
      bannerAssetId: oldMeta.extras?.bannerAssetId ?? null,
      iconAssetId: oldMeta.extras?.iconAssetId ?? null,
      rewardGuideAssetId: oldMeta.extras?.rewardGuideAssetId ?? null,
      rewardThanksAssetId: oldMeta.extras?.rewardThanksAssetId ?? null
    },
    files,
    assets: oldMeta.assets ?? []
  };

  const summary = {
    packId,
    zipPath,
    files: files.length,
    stickers: files.filter((f) => f.role === "sticker").length,
    extras: files.filter((f) => f.role !== "sticker").map((f) => f.role),
    withPrompt: files.filter((f) => f.prompt).length,
    generation: Boolean(generation),
    previousSchema: oldMeta.schema
  };

  if (options.dryRun) return { summary, metadata: newMeta };

  const tmpPath = `${zipPath}.tmp`;
  const output = fs.createWriteStream(tmpPath);
  const zip = archiver("zip", { zlib: { level: 9 } });
  const done = new Promise((resolve, reject) => {
    output.on("close", resolve);
    output.on("error", reject);
    zip.on("warning", reject);
    zip.on("error", reject);
  });
  zip.pipe(output);
  zip.append(JSON.stringify(newMeta, null, 2), {
    name: "metadata.json",
    date: new Date(oldMeta.createdAt ?? Date.now())
  });
  for (const entry of entries) {
    if (entry.name === "metadata.json") continue;
    zip.append(entry.content, { name: entry.name, date: entry.date });
  }
  await zip.finalize();
  await done;

  if (!fs.existsSync(`${zipPath}.orig`)) fs.copyFileSync(zipPath, `${zipPath}.orig`);
  fs.renameSync(tmpPath, zipPath);

  return { summary, metadata: newMeta };
}

/* ── CLI ───────────────────────────────────────────────────────────────── */

/** 列出所有仍是旧 schema（非 0.2）的 packId。 */
function listLegacyPackIds() {
  const dir = path.join(ROOT, "data", "packs");
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".zip"))
    .map((f) => f.slice(0, -4))
    .filter((id) => {
      try {
        const entries = readZipEntries(fs.readFileSync(path.join(dir, `${id}.zip`)));
        const meta = JSON.parse(entries.find((e) => e.name === "metadata.json").content.toString("utf8"));
        return meta.schema !== "easysticker-pack@0.2";
      } catch {
        return false;
      }
    });
}

async function runCli() {
  const args = process.argv.slice(2);
  const contextFlag = args.indexOf("--context");
  const contextPath = contextFlag >= 0 ? args[contextFlag + 1] : null;
  const context = contextPath ? JSON.parse(fs.readFileSync(contextPath, "utf8")) : null;
  const dryRun = args.includes("--dry-run");
  const all = args.includes("--all");
  const packId = args.find((a) => !a.startsWith("--") && a !== contextPath);

  if (!all && !packId) {
    console.error(
      "用法：node scripts/repair-pack.mjs <packId>|--all [--context <file.json>] [--dry-run]"
    );
    process.exit(1);
  }

  const packIds = all ? listLegacyPackIds() : [packId];
  if (all) console.log(`待修复的旧包：${packIds.length} 个`);

  for (const id of packIds) {
    try {
      const { summary } = await repairPack(id, { context, dryRun });
      console.log(JSON.stringify(summary));
    } catch (error) {
      console.error(`${id}: ${String(error?.message ?? error)}`);
    }
  }

  if (!context) {
    console.log(
      "\n提示：生成上下文（提示词/风格）未恢复。可在项目页面 console 执行\n" +
        "  copy(localStorage.getItem('easysticker:last-wechat-pack'))\n" +
        "把结果存成 context.json，再带 --context context.json 重跑。"
    );
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runCli();
}
