import { describe, expect, it } from "vitest";
import { createSecurity } from "../src/lib/security";

describe("createSecurity — checkAuth", () => {
  it("returns true when auth is disabled (no apiToken)", () => {
    const sec = createSecurity({});
    expect(sec.checkAuth(undefined)).toBe(true);
    expect(sec.checkAuth("anything")).toBe(true);
    expect(sec.isAuthEnabled).toBe(false);
  });

  it("returns true when auth is disabled explicitly (enableAuth: false)", () => {
    const sec = createSecurity({ apiToken: "secret", enableAuth: false });
    expect(sec.checkAuth(undefined)).toBe(true);
    expect(sec.checkAuth("wrong")).toBe(true);
    expect(sec.isAuthEnabled).toBe(false);
  });

  it("returns true when auth is enabled and correct token is provided", () => {
    const sec = createSecurity({ apiToken: "my-secret-token" });
    expect(sec.isAuthEnabled).toBe(true);
    expect(sec.checkAuth("my-secret-token")).toBe(true);
  });

  it("returns false when auth is enabled but no token is provided", () => {
    const sec = createSecurity({ apiToken: "my-secret-token" });
    expect(sec.checkAuth(undefined)).toBe(false);
  });

  it("returns false when auth is enabled but wrong token is provided", () => {
    const sec = createSecurity({ apiToken: "my-secret-token" });
    expect(sec.checkAuth("wrong-token")).toBe(false);
  });
});

describe("createSecurity — checkRateLimit", () => {
  it("returns null when rate limiting is disabled", () => {
    const sec = createSecurity({});
    expect(sec.checkRateLimit("key")).toBeNull();
    expect(sec.isRateLimitEnabled).toBe(false);
  });

  it("allows requests within limit", () => {
    const sec = createSecurity({
      rateLimit: { maxRequests: 5, windowMs: 60_000 }
    });
    expect(sec.isRateLimitEnabled).toBe(true);

    const first = sec.checkRateLimit("ip:1.2.3.4");
    expect(first!.allowed).toBe(true);
    expect(first!.remaining).toBe(4);
    expect(first!.resetAt).toBeGreaterThan(Date.now());

    const second = sec.checkRateLimit("ip:1.2.3.4");
    expect(second!.allowed).toBe(true);
    expect(second!.remaining).toBe(3);
  });

  it("blocks when limit is exceeded", () => {
    const sec = createSecurity({
      rateLimit: { maxRequests: 3, windowMs: 60_000 }
    });

    sec.checkRateLimit("key");
    sec.checkRateLimit("key");
    sec.checkRateLimit("key");
    const blocked = sec.checkRateLimit("key");
    expect(blocked!.allowed).toBe(false);
    expect(blocked!.remaining).toBe(0);
    expect(blocked!.resetAt).toBeGreaterThan(Date.now());
  });

  it("tracks different keys independently", () => {
    const sec = createSecurity({
      rateLimit: { maxRequests: 2, windowMs: 60_000 }
    });

    expect(sec.checkRateLimit("alice")!.allowed).toBe(true);
    expect(sec.checkRateLimit("alice")!.allowed).toBe(true);
    expect(sec.checkRateLimit("alice")!.allowed).toBe(false);

    // Bob is still allowed
    expect(sec.checkRateLimit("bob")!.allowed).toBe(true);
  });

  it("resets after window expires", async () => {
    const sec = createSecurity({
      rateLimit: { maxRequests: 1, windowMs: 50 }
    });

    expect(sec.checkRateLimit("key")!.allowed).toBe(true);
    expect(sec.checkRateLimit("key")!.allowed).toBe(false);

    // Wait for window to expire
    await new Promise((r) => setTimeout(r, 60));

    expect(sec.checkRateLimit("key")!.allowed).toBe(true);
    expect(sec.checkRateLimit("key")!.remaining).toBe(0); // back to 1 used
  });
});

describe("createSecurity — checkQuota", () => {
  it("returns unlimited when quota is disabled", () => {
    const sec = createSecurity({});
    expect(sec.isQuotaEnabled).toBe(false);
    const result = sec.checkQuota("user@test.com");
    expect(result.allowed).toBe(true);
    expect(result.used).toBe(0);
    expect(result.remaining).toBe(Infinity);
    expect(result.max).toBe(Infinity);
  });

  it("allows within daily quota", () => {
    const sec = createSecurity({
      dailyQuota: { maxGenerations: 10 }
    });
    expect(sec.isQuotaEnabled).toBe(true);

    const first = sec.checkQuota("user@test.com");
    expect(first.allowed).toBe(true);
    expect(first.used).toBe(1);
    expect(first.remaining).toBe(9);
    expect(first.max).toBe(10);

    const second = sec.checkQuota("user@test.com");
    expect(second.allowed).toBe(true);
    expect(second.used).toBe(2);
    expect(second.remaining).toBe(8);
  });

  it("blocks when quota exceeded", () => {
    const sec = createSecurity({
      dailyQuota: { maxGenerations: 2 }
    });

    sec.checkQuota("user");
    sec.checkQuota("user");
    const blocked = sec.checkQuota("user");
    expect(blocked.allowed).toBe(false);
    expect(blocked.used).toBe(2);
    expect(blocked.remaining).toBe(0);
    expect(blocked.max).toBe(2);
  });

  it("tracks different users independently", () => {
    const sec = createSecurity({
      dailyQuota: { maxGenerations: 2 }
    });

    sec.checkQuota("alice");
    sec.checkQuota("alice");
    expect(sec.checkQuota("alice").allowed).toBe(false);

    // Bob still has quota
    expect(sec.checkQuota("bob").allowed).toBe(true);
    expect(sec.checkQuota("bob").remaining).toBe(0);
  });

  it("recordGeneration increments quota without returning info", () => {
    const sec = createSecurity({
      dailyQuota: { maxGenerations: 3 }
    });

    sec.recordGeneration("user");
    sec.recordGeneration("user");

    const result = sec.checkQuota("user");
    expect(result.used).toBe(3); // 2 records + 1 from checkQuota
  });

  it("recordGeneration is no-op when quota is disabled", () => {
    const sec = createSecurity({});
    sec.recordGeneration("user"); // should not throw
    const result = sec.checkQuota("user");
    expect(result.allowed).toBe(true);
  });
});

describe("createSecurity — combined scenarios", () => {
  it("can have auth + rate limit + quota all enabled", () => {
    const sec = createSecurity({
      apiToken: "token",
      rateLimit: { maxRequests: 10, windowMs: 60_000 },
      dailyQuota: { maxGenerations: 50 }
    });

    expect(sec.isAuthEnabled).toBe(true);
    expect(sec.isRateLimitEnabled).toBe(true);
    expect(sec.isQuotaEnabled).toBe(true);

    expect(sec.checkAuth("token")).toBe(true);
    expect(sec.checkRateLimit("ip").allowed).toBe(true);
    expect(sec.checkQuota("user").allowed).toBe(true);
  });

  it("can have all features disabled", () => {
    const sec = createSecurity({});
    expect(sec.isAuthEnabled).toBe(false);
    expect(sec.isRateLimitEnabled).toBe(false);
    expect(sec.isQuotaEnabled).toBe(false);

    expect(sec.checkAuth(undefined)).toBe(true);
    expect(sec.checkRateLimit("key")).toBeNull();
    expect(sec.checkQuota("key").allowed).toBe(true);
  });
});

describe("createSecurity — cleanup lifecycle", () => {
  it("startCleanup and stopCleanup work without errors", () => {
    const sec = createSecurity({
      rateLimit: { maxRequests: 10, windowMs: 60_000 }
    });

    // Should not throw
    sec.startCleanup(5000);
    sec.stopCleanup();
    sec.startCleanup(5000);
    sec.stopCleanup();
  });

  it("calling startCleanup multiple times replaces timer", () => {
    const sec = createSecurity({
      rateLimit: { maxRequests: 10, windowMs: 60_000 }
    });

    sec.startCleanup(100);
    sec.startCleanup(200); // replaces first
    sec.stopCleanup();
  });
});
