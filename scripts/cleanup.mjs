#!/usr/bin/env node

/**
 * Temp file cleanup script.
 * Deletes uploaded reference images and generated packs older than N days.
 * Run via cron or manually:
 *   node scripts/cleanup.mjs                   # 7 day default
 *   node scripts/cleanup.mjs --days 14          # custom days
 *   node scripts/cleanup.mjs --dry-run          # preview without deleting
 */

import fs from "node:fs";
import path from "node:path";

const DATA_DIR = process.env["DATA_DIR"] || path.join(process.cwd(), "data");
const UPLOADS_DIR = path.join(DATA_DIR, "uploads");
const PACKS_DIR = path.join(DATA_DIR, "packs");

function parseArgs() {
  const args = process.argv.slice(2);
  const days = args.includes("--days") ? Number(args[args.indexOf("--days") + 1]) : 7;
  const dryRun = args.includes("--dry-run");
  return { days, dryRun };
}

function isOlderThan(name, days) {
  // Files named with timestamps: "pack-xxx-1234567890.png" or just check mtime
  try {
    const stat = fs.statSync(name);
    const age = (Date.now() - stat.mtimeMs) / (1000 * 60 * 60 * 24);
    return age > days;
  } catch {
    return false;
  }
}

function cleanupDir(dir, days, dryRun) {
  if (!fs.existsSync(dir)) {
    console.log(`[SKIP] ${dir} does not exist`);
    return 0;
  }

  let deleted = 0;
  let skipped = 0;
  const entries = fs.readdirSync(dir);

  for (const entry of entries) {
    const fullPath = path.join(dir, entry);
    const stat = fs.statSync(fullPath);

    if (stat.isDirectory()) {
      // Recursively clean subdirectories
      deleted += cleanupDir(fullPath, days, dryRun);
      // Remove empty directories
      if (fs.readdirSync(fullPath).length === 0) {
        if (dryRun) {
          console.log(`[DRY-RUN] would remove empty dir: ${fullPath}`);
        } else {
          fs.rmdirSync(fullPath);
          console.log(`[REMOVED] empty dir: ${fullPath}`);
        }
        deleted++;
      }
      continue;
    }

    if (isOlderThan(fullPath, days)) {
      if (dryRun) {
        console.log(`[DRY-RUN] would delete: ${fullPath} (${(stat.size / 1024).toFixed(1)}KB, age: ${((Date.now() - stat.mtimeMs) / (1000 * 60 * 60 * 24)).toFixed(1)}d)`);
      } else {
        fs.unlinkSync(fullPath);
        console.log(`[DELETED] ${fullPath}`);
      }
      deleted++;
    } else {
      skipped++;
    }
  }

  return deleted;
}

function main() {
  const { days, dryRun } = parseArgs();
  
  if (dryRun) {
    console.log(`\n🔍 DRY RUN — no files will be deleted\n`);
  }

  console.log(`🧹 Cleaning up files older than ${days} days in:\n  ${UPLOADS_DIR}\n  ${PACKS_DIR}\n`);

  const uploadsDeleted = cleanupDir(UPLOADS_DIR, days, dryRun);
  const packsDeleted = cleanupDir(PACKS_DIR, days, dryRun);

  const total = uploadsDeleted + packsDeleted;
  console.log(`\n✅ Done. Deleted ${total} file(s) (uploads: ${uploadsDeleted}, packs: ${packsDeleted})`);
  
  if (dryRun) {
    console.log(`   (dry-run — nothing was actually deleted)`);
  }

  process.exit(0);
}

main();
