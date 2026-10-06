import type { AlertRule, AlertRecord } from "../lib/alertEngine";
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import type { AppDeps } from "../lib/deps";
import { loadPromptConfig, updatePromptConfig } from "../services/generate/promptConfig";
import { getAiProvider } from "../services/ai/index";
import { providerApiKeyEnvName, resolveProviderApiKey, setProviderApiKey } from "../services/ai/apiKey";
import { deletePacksAndReclaim, reclaimAssetsByOwner, runGc } from "../services/maintenance/gc";
import { ensureRetentionStarted } from "../services/maintenance/retention";
import { listPacks } from "../services/pack/service";

export function registerAdminRoutes(deps: AppDeps) {
  return async (app: FastifyInstance): Promise<void> => {
    const userStore = deps.userStore;
    const usageStore = deps.usageStore;
    const monitorStore = deps.monitorStore;
    const alertEngine = deps.alertEngine!;

    // Admin middleware
    async function requireAdmin(req: FastifyRequest, reply: FastifyReply) {
      try {
        await req.jwtVerify();
      } catch {
        return reply.status(401).send({ error: "Unauthorized" });
      }
      const { role } = req.user as any;
      if (role !== "admin") {
        return reply.status(403).send({ error: "Forbidden", message: "Admin access required." });
      }
    }

    // GET /api/admin/users — list all users
    app.get("/admin/users", { preHandler: [requireAdmin] }, async (_req, reply) => {
      const users = userStore.list();
      return {
        users: users.map(u => ({
          email: u.email,
          role: u.role,
          createdAt: u.createdAt,
          lastLogin: u.lastLogin,
          disabled: u.disabled
        }))
      };
    });

    // POST /api/admin/users/:email/toggle — enable/disable user（软删/停用）
    app.post("/admin/users/:email/toggle", { preHandler: [requireAdmin] }, async (req, reply) => {
      const { email } = req.params as any;
      const user = userStore.get(email);
      if (!user) {
        return reply.status(404).send({ error: "User not found" });
      }
      // 管理员账号受保护：停用可能导致后台再无人可管，直接拒绝。
      // 例外：历史遗留的已停用管理员仍允许重新启用。
      if (user.role === "admin" && !user.disabled) {
        return reply.status(400).send({ error: "BadRequest", message: "管理员账号受保护，不能被停用" });
      }
      const updated = userStore.setDisabled(email, !user.disabled);
      return { success: updated, email: user.email, disabled: !user.disabled };
    });

    // DELETE /api/admin/users/:email — 硬删除账号。
    // query purge=true 时一并清理：名下包（并回收素材）、用量日志、监控记录。
    app.delete("/admin/users/:email", { preHandler: [requireAdmin] }, async (req, reply) => {
      const { email } = req.params as { email: string };
      const query = (req.query ?? {}) as { purge?: string };
      const purge = query.purge === "true" || query.purge === "1";

      const target = userStore.get(email);
      if (!target) {
        return reply.status(404).send({ error: "NotFound", message: "user not found" });
      }

      // 管理员账号受保护：删除后可能再也没人能进后台（当前也没有改角色的入口）。
      if (target.role === "admin") {
        return reply.status(400).send({ error: "BadRequest", message: "管理员账号受保护，不能被删除" });
      }

      const summary = { packs: 0, reclaimedBytes: 0, orphanAssets: 0, usageRecords: 0, monitorRecords: 0 };
      if (purge) {
        const owned = listPacks(deps.dataDir).filter(
          (p) => p.owner && p.owner.toLowerCase() === target.email.toLowerCase()
        );
        if (owned.length) {
          const result = await deletePacksAndReclaim(deps.dataDir, owned.map((p) => p.packId));
          summary.packs = result.deleted.length;
          summary.reclaimedBytes = result.reclaimedBytes;
        }
        // 再清掉「传了但没进任何包」的散图（按归属索引，只删该用户且无人引用的）
        const orphan = reclaimAssetsByOwner(deps.dataDir, target.email);
        summary.orphanAssets = orphan.count;
        summary.reclaimedBytes += orphan.bytes;
        summary.usageRecords = usageStore.purgeUser(target.email);
        summary.monitorRecords = monitorStore.purgeUser(target.email);
      }

      if (!userStore.delete(target.email)) {
        return reply.status(500).send({ error: "InternalError", message: "删除账号失败" });
      }
      return { ok: true, email: target.email, purged: purge, summary };
    });

    // GET /api/admin/usage — usage stats for all users
    app.get("/admin/usage", { preHandler: [requireAdmin] }, async (_req, reply) => {
      usageStore.maybeRotate();
      const summaries = usageStore.getAllSummaries();
      return { summaries };
    });

    // GET /api/admin/monitoring — current snapshot + trends
    app.get("/admin/monitoring", { preHandler: [requireAdmin] }, async (_req, reply) => {
      const snapshot = monitorStore.getCurrentSnapshot();
      const trends = monitorStore.getTrends(10);
      return {
        snapshot,
        trends: { minutes: 10, ...trends },
      };
    });

    // GET /api/admin/monitoring/stream — SSE 实时推送（替代前端 15 秒轮询）
    //
    // 系统指标本来就由 server.ts 每 10 秒采样一次，所以这里只是把已有快照
    // 推给浏览器：一次长连接换掉「每个后台标签页每 15 秒一个请求」，
    // 数据还更实时（5 秒一帧），且切到别的标签页时前端会主动断开。
    app.get("/admin/monitoring/stream", { preHandler: [requireAdmin] }, async (req, reply) => {
      reply.hijack();
      const raw = reply.raw;
      raw.setHeader("content-type", "text/event-stream; charset=utf-8");
      raw.setHeader("cache-control", "no-cache, no-transform");
      raw.setHeader("connection", "keep-alive");
      raw.setHeader("x-accel-buffering", "no");
      raw.flushHeaders?.();

      let closed = false;
      let alertSignature = "";

      const send = (event: string, data: unknown) => {
        if (closed) return;
        raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      };

      const push = () => {
        if (closed) return;
        send("snapshot", {
          snapshot: monitorStore.getCurrentSnapshot(),
          trends: { minutes: 10, ...monitorStore.getTrends(10) },
        });

        // 告警只在内容变化时推，避免每帧重传同一份列表
        const alerts = (alertEngine.getAlertHistory() as AlertRecord[]).filter(
          (a) => a.resolvedAt === null
        );
        const signature = JSON.stringify(alerts);
        if (signature !== alertSignature) {
          alertSignature = signature;
          send("alerts", { alerts });
        }
      };

      const snapshotTimer = setInterval(push, 5000);
      const pingTimer = setInterval(() => {
        if (!closed) raw.write(": ping\n\n");
      }, 15000);

      const cleanup = () => {
        closed = true;
        clearInterval(snapshotTimer);
        clearInterval(pingTimer);
      };
      req.raw.on("close", cleanup);
      req.raw.on("error", cleanup);

      // 先立即给一帧：切进仪表盘立刻有数据，不用等第一个采样周期
      push();
    });

    // GET /api/admin/monitoring/metrics — query raw metrics from JSONL
    app.get(
      "/admin/monitoring/metrics",
      { preHandler: [requireAdmin] },
      async (req, reply) => {
        const query = req.query as Record<string, string | undefined>;
        const result = monitorStore.queryMetrics({
          type: query.type as "request" | "system" | "disk" | undefined,
          from: query.from,
          to: query.to,
          limit: query.limit ? Number(query.limit) : 100,
          offset: query.offset ? Number(query.offset) : 0,
        });
        return { records: result.metrics, count: result.metrics.length, hasMore: result.hasMore };
      }
    );

    // ── Alert Engine Routes ──────────────────────────────────

    // GET /api/admin/alerts/rules
    app.get("/admin/alerts/rules", { preHandler: [requireAdmin] }, async (_req, reply) => {
      const rules = alertEngine.getRules();
      return { rules };
    });

    // PUT /api/admin/alerts/rules
    app.put("/admin/alerts/rules", { preHandler: [requireAdmin] }, async (req, reply) => {
      const body = req.body as { rules?: AlertRule[] };
      if (!body || !Array.isArray(body.rules)) {
        return reply.status(400).send({ error: "rules must be an array of AlertRule" });
      }
      alertEngine.updateRules(body.rules);
      return { rules: alertEngine.getRules() };
    });

    // GET /api/admin/alerts/history
    app.get("/admin/alerts/history", { preHandler: [requireAdmin] }, async (req, reply) => {
      const query = req.query as Record<string, string | undefined>;
      const resolvedParam = query.resolved;
      const all = alertEngine.getAlertHistory();

      if (resolvedParam === "false") {
        return { alerts: all.filter((a: AlertRecord) => a.resolvedAt === null) };
      }
      return { alerts: all };
    });

    // POST /api/admin/alerts/:id/ack
    app.post("/admin/alerts/:id/ack", { preHandler: [requireAdmin] }, async (req, reply) => {
      const { id } = req.params as { id: string };
      const ok = alertEngine.acknowledgeAlert(id);
      if (!ok) {
        return reply.status(404).send({ error: "Alert not found" });
      }
      return { success: true };
    });

    // GET /api/admin/settings
    app.get("/admin/settings", { preHandler: [requireAdmin] }, async (_req, reply) => {
      const config = alertEngine.getConfig();
      return {
        webhookUrl: config.webhookUrl,
        webhookEnabled: config.webhookEnabled,
        notificationInterval: config.notificationInterval,
        monitorRetentionDays: config.monitorRetentionDays,
      };
    });

    // PUT /api/admin/settings
    app.put("/admin/settings", { preHandler: [requireAdmin] }, async (req, reply) => {
      const body = req.body as Record<string, unknown>;
      const partial: Partial<import("../lib/alertEngine").AlertConfig> = {};
      if (typeof body.webhookUrl === "string") partial.webhookUrl = body.webhookUrl;
      if (typeof body.webhookEnabled === "boolean") partial.webhookEnabled = body.webhookEnabled;
      if (typeof body.notificationInterval === "number") partial.notificationInterval = body.notificationInterval;
      if (typeof body.monitorRetentionDays === "number") partial.monitorRetentionDays = body.monitorRetentionDays;
      alertEngine.updateConfig(partial);
      const config = alertEngine.getConfig();
      return {
        webhookUrl: config.webhookUrl,
        webhookEnabled: config.webhookEnabled,
        notificationInterval: config.notificationInterval,
        monitorRetentionDays: config.monitorRetentionDays,
      };
    });

    // ── AI 提供商配置（可视化）─────────────────────────────

    /** 列出 provider（密钥只返回“是否已配置”，绝不回传明文）。 */
    function listAiProviders() {
      const config = loadPromptConfig();
      const providers = Object.entries(config.ai?.providers || {}).map(([id, p]: [string, any]) => {
        const type = p.type || id;
        const hasKey = type !== "mock" && Boolean(resolveProviderApiKey(id, p));
        return {
          id,
          type,
          name: p.name || id,
          baseUrl: p.baseUrl ?? null,
          model: p.model ?? null,
          variant: p.variant ?? null,
          size: p.size ?? null,
          hasKey,
          envKey: type === "openai" ? providerApiKeyEnvName(id) : null,
          ready: type === "mock" ? true : hasKey
        };
      });
      return { defaultProvider: config.ai?.defaultProvider || "mock", providers };
    }

    // GET /api/admin/ai/providers
    app.get("/admin/ai/providers", { preHandler: [requireAdmin] }, async () => listAiProviders());

    // PUT /api/admin/ai/providers — 保存 provider 覆盖项 + 默认 provider（密钥写入 .env）
    app.put("/admin/ai/providers", { preHandler: [requireAdmin] }, async (req, reply) => {
      const body = (req.body as { defaultProvider?: string; providers?: Record<string, any> }) || {};
      if (body.defaultProvider !== undefined && typeof body.defaultProvider !== "string") {
        return reply.status(400).send({ error: "defaultProvider must be a string" });
      }

      const current = loadPromptConfig();
      const known = new Set([
        ...Object.keys(current.ai?.providers || {}),
        ...Object.keys(body.providers || {}),
        "mock"
      ]);
      if (body.defaultProvider && !known.has(body.defaultProvider)) {
        return reply.status(400).send({ error: `unknown defaultProvider: ${body.defaultProvider}` });
      }

      const editable = ["type", "name", "baseUrl", "model", "variant", "size"] as const;
      const providers: Record<string, Record<string, unknown>> = {};
      for (const [id, raw] of Object.entries(body.providers || {})) {
        if (!raw || typeof raw !== "object") continue;
        const clean: Record<string, unknown> = {};
        for (const key of editable) {
          if (raw[key] !== undefined) clean[key] = raw[key];
        }
        providers[id] = clean;
        // 密钥只写 .env（AI_<ID>_API_KEY），不写配置文件；空串表示不修改。
        if (typeof raw.apiKey === "string" && raw.apiKey.length > 0) {
          setProviderApiKey(id, raw.apiKey);
        }
      }

      updatePromptConfig({ defaultProvider: body.defaultProvider, providers });
      return listAiProviders();
    });

    // POST /api/admin/ai/test — 真实调用一次，验证 provider 链路（会消耗少量额度）
    app.post("/admin/ai/test", { preHandler: [requireAdmin] }, async (req, reply) => {
      const body = (req.body as { providerId?: string }) || {};
      const config = loadPromptConfig();
      const id = body.providerId || config.ai?.defaultProvider || "mock";
      const started = Date.now();
      try {
        const provider = getAiProvider(id);
        const size = config.ai?.imageSize || { width: 1024, height: 1024 };
        const out = await provider.generateImage({
          prompt: "connectivity test: a simple cute smiley sticker, flat icon, centered",
          negativePrompt: "",
          width: size.width,
          height: size.height
        });
        return { ok: true, providerId: id, ms: Date.now() - started, bytes: out.bytes.length, mime: out.mime };
      } catch (error) {
        return {
          ok: false,
          providerId: id,
          ms: Date.now() - started,
          error: error instanceof Error ? error.message : String(error)
        };
      }
    });

    // ── 存储：占用体检 / 手动清理 / 包列表 ──────────────────────────────
    // 这些是运维视角的接口：整个服务的磁盘占用与包清单（用户侧看不到彼此的数据）。
    app.get("/admin/storage", { preHandler: [requireAdmin] }, async () => {
      const retentionDays = loadPromptConfig().server?.maintenance?.packRetentionDays ?? 0;
      const report = await runGc({ dataDir: deps.dataDir, dryRun: true });
      const { retentionStartedAt } = retentionDays > 0 ? ensureRetentionStarted(deps.dataDir) : { retentionStartedAt: null };
      return {
        report,
        retentionDays,
        retentionStartedAt,
        packs: listPacks(deps.dataDir, retentionDays, retentionStartedAt).map((p) => ({
          packId: p.packId,
          title: p.title,
          createdAt: p.createdAt,
          stickerCount: p.stickerCount,
          bytes: p.bytes,
          hasZip: p.hasZip,
          owner: p.owner,
          expiresAt: p.expiresAt
        }))
      };
    });

    app.post("/admin/storage/gc", { preHandler: [requireAdmin] }, async (req) => {
      const body = (req.body as {
        dryRun?: boolean;
        packRetentionDays?: number;
        orphanMinAgeHours?: number;
        compactLegacyPacks?: boolean;
        dropOrigBackups?: boolean;
      }) || {};
      const report = await runGc({
        dataDir: deps.dataDir,
        dryRun: body.dryRun !== false,
        packRetentionDays: body.packRetentionDays ?? 0,
        ...(body.orphanMinAgeHours !== undefined ? { orphanMinAgeMs: body.orphanMinAgeHours * 3600_000 } : {}),
        compactLegacyPacks: body.compactLegacyPacks !== false,
        dropOrigBackups: body.dropOrigBackups !== false
      });
      return { ok: true, report };
    });

    // 删单个包：删完顺手回收只属于它的素材（不等下一次 GC）
    app.delete("/admin/packs/:packId", { preHandler: [requireAdmin] }, async (req, reply) => {
      const { packId } = req.params as { packId: string };
      const result = await deletePacksAndReclaim(deps.dataDir, [packId]);
      if (!result.deleted.length) {
        reply.status(404);
        return { error: "NotFound", message: "pack not found" };
      }
      return { ok: true, packId, reclaimedBytes: result.reclaimedBytes, errors: result.errors };
    });

    // 批量删包（后台「删除选中 / 删除全部」）。删除不可恢复，前端已做二次确认。
    app.post("/admin/packs/bulk-delete", { preHandler: [requireAdmin] }, async (req, reply) => {
      const body = (req.body as { packIds?: unknown }) || {};
      const ids = Array.isArray(body.packIds)
        ? body.packIds.filter((id): id is string => typeof id === "string" && id.trim().length > 0)
        : [];
      if (!ids.length) {
        reply.status(400);
        return { error: "BadRequest", message: "packIds must be a non-empty array of strings" };
      }
      if (ids.length > 1000) {
        reply.status(400);
        return { error: "BadRequest", message: "too many packIds (max 1000)" };
      }
      const result = await deletePacksAndReclaim(deps.dataDir, ids);
      return { ok: true, ...result };
    });
  };
}
