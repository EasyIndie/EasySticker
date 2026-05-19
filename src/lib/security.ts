/**
 * Production security: API token auth, rate limiting, daily quota.
 * All in-memory — simple, no Redis dependency. Resets on server restart.
 */

export type SecurityConfig = {
  apiToken?: string;
  enableAuth?: boolean;
  rateLimit?: {
    maxRequests: number;
    windowMs: number;
  };
  dailyQuota?: {
    maxGenerations: number;
  };
  corsAllowOrigin?: string;
};

interface RateEntry {
  count: number;
  resetAt: number;
}

interface QuotaEntry {
  count: number;
  date: string; // YYYY-MM-DD
}

export function createSecurity(config: SecurityConfig) {
  const authEnabled = config.enableAuth !== false && !!config.apiToken;
  const rateLimitEnabled = !!config.rateLimit;
  const quotaEnabled = !!config.dailyQuota;

  // Rate limiting state
  const rateMap = new Map<string, RateEntry>();

  // Daily quota state
  const quotaMap = new Map<string, QuotaEntry>();

  // Periodic cleanup of stale entries
  let cleanupTimer: ReturnType<typeof setInterval> | null = null;
  function startCleanup(intervalMs = 60_000) {
    stopCleanup();
    cleanupTimer = setInterval(() => {
      const now = Date.now();
      // Clean rate limit entries
      for (const [key, entry] of rateMap) {
        if (now >= entry.resetAt) rateMap.delete(key);
      }
      // Clean old quota entries
      const today = new Date().toISOString().slice(0, 10);
      for (const [key, entry] of quotaMap) {
        if (entry.date !== today) quotaMap.delete(key);
      }
    }, intervalMs);
    // Allow process to exit even if timer is still running
    if (cleanupTimer && typeof cleanupTimer === "object" && "unref" in cleanupTimer) {
      cleanupTimer.unref();
    }
  }

  function stopCleanup() {
    if (cleanupTimer) {
      clearInterval(cleanupTimer);
      cleanupTimer = null;
    }
  }

  return {
    /** Check if API token is valid. Returns true if auth is disabled or token matches. */
    checkAuth(token: string | undefined): boolean {
      if (!authEnabled) return true; // auth disabled
      if (!token) return false;
      return token === config.apiToken;
    },

    /** Check rate limit for a key (IP or token). Returns null if allowed, or error info. */
    checkRateLimit(key: string): { allowed: boolean; remaining: number; resetAt: number } | null {
      if (!rateLimitEnabled) return null;
      const cfg = config.rateLimit!;
      const now = Date.now();
      const entry = rateMap.get(key);

      if (!entry || now >= entry.resetAt) {
        // New window
        const resetAt = now + cfg.windowMs;
        rateMap.set(key, { count: 1, resetAt });
        return { allowed: true, remaining: cfg.maxRequests - 1, resetAt };
      }

      if (entry.count >= cfg.maxRequests) {
        return { allowed: false, remaining: 0, resetAt: entry.resetAt };
      }

      entry.count++;
      return { allowed: true, remaining: cfg.maxRequests - entry.count, resetAt: entry.resetAt };
    },

    /** Check daily generation quota for a key. Returns actual quota info. */
    checkQuota(key: string): { allowed: boolean; used: number; remaining: number; max: number } {
      if (!quotaEnabled) {
        return { allowed: true, used: 0, remaining: Infinity, max: Infinity };
      }
      const cfg = config.dailyQuota!;
      const today = new Date().toISOString().slice(0, 10);
      const entry = quotaMap.get(key);

      if (!entry || entry.date !== today) {
        quotaMap.set(key, { count: 1, date: today });
        return { allowed: true, used: 1, remaining: cfg.maxGenerations - 1, max: cfg.maxGenerations };
      }

      if (entry.count >= cfg.maxGenerations) {
        return { allowed: false, used: entry.count, remaining: 0, max: cfg.maxGenerations };
      }

      entry.count++;
      return { allowed: true, used: entry.count, remaining: cfg.maxGenerations - entry.count, max: cfg.maxGenerations };
    },

    /** Record a generation for quota tracking (call after successful generation) */
    recordGeneration(key: string): void {
      if (!quotaEnabled) return;
      const cfg = config.dailyQuota!;
      const today = new Date().toISOString().slice(0, 10);
      const entry = quotaMap.get(key);
      if (!entry || entry.date !== today) {
        quotaMap.set(key, { count: 1, date: today });
      } else {
        entry.count++;
      }
    },

    isAuthEnabled: authEnabled,
    isRateLimitEnabled: rateLimitEnabled,
    isQuotaEnabled: quotaEnabled,
    startCleanup,
    stopCleanup
  };
}

export type Security = ReturnType<typeof createSecurity>;
