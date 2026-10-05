#!/usr/bin/env node
/**
 * 数据目录清理 CLI。
 *
 *   npm run gc                  # 只体检，不删任何东西（默认 dry-run）
 *   npm run gc -- --apply       # 真的执行
 *   npm run gc -- --apply --retention-days 30   # 顺带清掉 30 天前的包
 *   npm run gc -- --keep-orig   # 保留 repair-pack 的 .orig 备份
 *
 * 默认保留期不启用（0），也就是只做「压缩旧包 + 清孤儿素材 + 清 .orig 备份」，
 * 这些都不会让用户丢掉仍被引用的数据。
 */
import path from "node:path";
import { runGc } from "../services/maintenance/gc";
import { loadPromptConfig } from "../services/generate/promptConfig";

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  if (index < 0) return undefined;
  const value = process.argv[index + 1];
  return value && !value.startsWith("--") ? value : "";
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

const MB = 1024 * 1024;
const mb = (bytes: number) => `${(bytes / MB).toFixed(2)} MB`;

async function main() {
  const dryRun = !hasFlag("apply");
  // 没显式指定时用配置里的值，否则体检结果会和服务端实际行为对不上
  const configRetention = loadPromptConfig().server?.maintenance?.packRetentionDays ?? 0;
  const retentionRaw = arg("retention-days");
  const retentionDays = retentionRaw ? Number(retentionRaw) : configRetention;
  const orphanAgeRaw = arg("orphan-min-age-hours");
  const orphanMinAgeMs = orphanAgeRaw ? Number(orphanAgeRaw) * 60 * 60 * 1000 : undefined;
  const dataDir = arg("data-dir") || process.env["DATA_DIR"] || path.join(process.cwd(), "data");

  console.log(`数据目录： ${dataDir}`);
  console.log(dryRun ? "模式：     dry-run（只体检，不删除）\n" : "模式：     apply（会真的删除）\n");

  const report = await runGc({
    dataDir,
    dryRun,
    packRetentionDays: Number.isFinite(retentionDays) ? retentionDays : 0,
    ...(Number.isFinite(orphanMinAgeMs) ? { orphanMinAgeMs: orphanMinAgeMs as number } : {}),
    dropOrigBackups: !hasFlag("keep-orig")
  });

  if (retentionDays > 0) {
    console.log(`保留期：   包保留 ${retentionDays} 天（生效起点 ${report.expired.retentionStartedAt ?? "待锚定"}）`);
    console.log("           过期时间 = max(包创建时间, 生效起点) + 保留天数，不追溯既往\n");
  }

  console.log("─ 现状 ──────────────────────────────");
  console.log(`包：       ${report.packs.total} 个 (${mb(report.packs.bytes)})，其中仍是整包 ZIP 的 ${report.packs.legacyZips} 个`);
  console.log(`素材：     ${report.uploads.total} 个 (${mb(report.uploads.bytes)})`);
  console.log("\n─ 可回收 ────────────────────────────");
  console.log(`压缩旧包： ${report.compacted.count} 个 → 回收 ${mb(report.compacted.bytes)}`);
  console.log(`孤儿素材： ${report.orphanAssets.count} 个 → 回收 ${mb(report.orphanAssets.bytes)}`);
  console.log(`.orig 备份：${report.origBackups.count} 个 → 回收 ${mb(report.origBackups.bytes)}`);
  if (retentionDays > 0) {
    console.log(`过期包：   ${report.expired.count} 个 → 回收 ${mb(report.expired.bytes)}`);
  }
  console.log(`\n合计可回收：${mb(report.reclaimedBytes)}`);

  if (report.orphanAssets.keptRecent > 0) {
    console.log(`\n（${report.orphanAssets.keptRecent} 个孤儿素材刚落盘不久，已跳过，避免误删正在生成的资源）`);
  }
  if (report.compacted.skipped.length) {
    console.log(`\n（${report.compacted.skipped.length} 个旧包因素材不全而保留原 ZIP：`);
    console.log(`  ${report.compacted.skipped.join(", ")}）`);
  }
  if (report.errors.length) {
    console.error("\n错误：");
    for (const error of report.errors) console.error(`  - ${error}`);
  }
  if (dryRun) {
    console.log("\n加 --apply 才会真正执行。");
  }
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
