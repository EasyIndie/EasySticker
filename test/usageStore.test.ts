import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createUsageStore } from "../src/lib/usageStore";

function tmpDir(): string {
  return mkdtempSync(join(tmpdir(), "easysticker-usage-test-"));
}

function cleanup(dir: string) {
  rmSync(dir, { recursive: true, force: true });
}

describe("createUsageStore", () => {
  let dir: string;

  beforeEach(() => {
    dir = tmpDir();
  });

  afterEach(() => {
    cleanup(dir);
  });

  it("starts with no usage data", () => {
    const store = createUsageStore(dir);
    const summary = store.getSummary("alice@test.com");
    expect(summary.email).toBe("alice@test.com");
    expect(summary.todayGenerated).toBe(0);
    expect(summary.totalGenerated).toBe(0);
    expect(summary.successRate).toBe(1);
    expect(summary.lastActive).toBeNull();
  });

  it("logs a usage event and updates summary", () => {
    const store = createUsageStore(dir);
    store.log({ email: "alice@test.com", action: "generate", success: true });

    const summary = store.getSummary("alice@test.com");
    expect(summary.todayGenerated).toBe(1);
    expect(summary.totalGenerated).toBe(1);
    expect(summary.successRate).toBe(1);
  });

  it("logs multiple events and tracks totals", () => {
    const store = createUsageStore(dir);
    store.log({ email: "alice@test.com", action: "generate", success: true });
    store.log({ email: "alice@test.com", action: "generate", success: true });
    store.log({ email: "alice@test.com", action: "generate", success: false });

    const summary = store.getSummary("alice@test.com");
    expect(summary.todayGenerated).toBe(3);
    expect(summary.totalGenerated).toBe(3);
    expect(summary.successRate).toBeCloseTo(2 / 3);
    // 统计页需要「成功次数」本身，而不是只拿全量比率去乘今日数量
    expect(summary.todaySuccess).toBe(2);
    expect(summary.todaySuccessRate).toBeCloseTo(2 / 3);
    expect(summary.totalSuccess).toBe(2);
  });

  it("checkDailyQuota reports usage correctly", () => {
    const store = createUsageStore(dir);
    expect(store.checkDailyQuota("alice@test.com", 10)).toEqual({
      allowed: true, used: 0, remaining: 10
    });

    store.log({ email: "alice@test.com", action: "generate", success: true });
    store.log({ email: "alice@test.com", action: "generate", success: true });

    expect(store.checkDailyQuota("alice@test.com", 10)).toEqual({
      allowed: true, used: 2, remaining: 8
    });
  });

  it("checkDailyQuota blocks when limit reached", () => {
    const store = createUsageStore(dir);
    store.log({ email: "bob@test.com", action: "generate", success: true });
    store.log({ email: "bob@test.com", action: "generate", success: true });
    store.log({ email: "bob@test.com", action: "generate", success: true });

    expect(store.checkDailyQuota("bob@test.com", 3)).toEqual({
      allowed: false, used: 3, remaining: 0
    });
  });

  it("getAllSummaries returns all users", () => {
    const store = createUsageStore(dir);
    expect(store.getAllSummaries()).toEqual([]);

    store.log({ email: "a@test.com", action: "generate", success: true });
    store.log({ email: "b@test.com", action: "generate", success: true });

    const summaries = store.getAllSummaries();
    expect(summaries).toHaveLength(2);
    const emails = summaries.map(s => s.email).sort();
    expect(emails).toEqual(["a@test.com", "b@test.com"]);
  });

  it("logs different action types (generate, download, upload)", () => {
    const store = createUsageStore(dir);
    store.log({ email: "alice@test.com", action: "generate", success: true });
    store.log({ email: "alice@test.com", action: "download", success: true });
    store.log({ email: "alice@test.com", action: "upload", success: true });

    const summary = store.getSummary("alice@test.com");
    expect(summary.totalGenerated).toBe(3);
  });

  it("persists log files to disk", () => {
    const store = createUsageStore(dir);
    store.log({ email: "alice@test.com", action: "generate", success: true });

    // Check that a .jsonl file was created
    const logDir = join(dir, "usage");
    const files = readdirSync(logDir);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^\d{4}-\d{2}-\d{2}\.jsonl$/);

    // Verify file content
    const content = readFileSync(join(logDir, files[0]), "utf-8");
    const lines = content.trim().split("\n");
    expect(lines).toHaveLength(1);
    const record = JSON.parse(lines[0]);
    expect(record.email).toBe("alice@test.com");
    expect(record.action).toBe("generate");
    expect(record.success).toBe(true);
    expect(record.date).toBeTruthy();
    expect(record.timestamp).toBeTruthy();
  });

  it("loads existing data from disk on creation", () => {
    const store1 = createUsageStore(dir);
    store1.log({ email: "persist@test.com", action: "generate", success: true });

    // Create a new store pointing to the same dir — it should reload data
    const store2 = createUsageStore(dir);
    const summary = store2.getSummary("persist@test.com");
    expect(summary.todayGenerated).toBe(1);
    expect(summary.totalGenerated).toBe(1);
  });

  it("maybeRotate handles same-day (no-op)", () => {
    const store = createUsageStore(dir);
    store.log({ email: "alice@test.com", action: "generate", success: true });

    store.maybeRotate(); // should be no-op since date is same
    const summary = store.getSummary("alice@test.com");
    expect(summary.todayGenerated).toBe(1);
  });

  it("getSummary successRate is 1 for zero events", () => {
    const store = createUsageStore(dir);
    const summary = store.getSummary("newuser@test.com");
    expect(summary.successRate).toBe(1);
  });

  it("handles multiple users with independent counts", () => {
    const store = createUsageStore(dir);
    store.log({ email: "heavy@test.com", action: "generate", success: true });
    store.log({ email: "heavy@test.com", action: "generate", success: true });
    store.log({ email: "heavy@test.com", action: "generate", success: true });
    store.log({ email: "light@test.com", action: "generate", success: true });

    expect(store.getSummary("heavy@test.com").totalGenerated).toBe(3);
    expect(store.getSummary("light@test.com").totalGenerated).toBe(1);

    expect(store.checkDailyQuota("heavy@test.com", 5).remaining).toBe(2);
    expect(store.checkDailyQuota("light@test.com", 5).remaining).toBe(4);
  });

  it("handles custom logDir parameter", () => {
    const customDir = tmpDir();
    const logDir = join(customDir, "my-logs");
    const store = createUsageStore(dir, logDir);
    
    store.log({ email: "test@test.com", action: "generate", success: true });
    
    // Log file should be in the custom logDir
    expect(existsSync(logDir)).toBe(true);
    const files = readdirSync(logDir);
    expect(files).toHaveLength(1);
    
    cleanup(customDir);
  });

  it("purgeUser 只删除目标用户的记录", () => {
    const store = createUsageStore(dir);
    store.log({ email: "alice@test.com", action: "generate", success: true });
    store.log({ email: "alice@test.com", action: "generate", success: false });
    store.log({ email: "bob@test.com", action: "generate", success: true });

    expect(store.purgeUser("alice@test.com")).toBe(2);
    expect(store.getSummary("alice@test.com").totalGenerated).toBe(0);
    expect(store.getSummary("bob@test.com").totalGenerated).toBe(1);

    // 重新从磁盘加载也确认已落盘清理
    const store2 = createUsageStore(dir);
    expect(store2.getSummary("alice@test.com").totalGenerated).toBe(0);
    expect(store2.getSummary("bob@test.com").totalGenerated).toBe(1);
  });
});
