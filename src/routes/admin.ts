import type { AlertRule, AlertRecord } from "../lib/alertEngine";
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import type { AppDeps } from "../lib/deps";
import { loadPromptConfig, updatePromptConfig } from "../services/generate/promptConfig";
import { getAiProvider } from "../services/ai/index";
import { providerApiKeyEnvName, resolveProviderApiKey, setProviderApiKey } from "../services/ai/apiKey";
import { runGc } from "../services/maintenance/gc";
import { deletePack, listPacks } from "../services/pack/service";

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

    // POST /api/admin/users/:email/toggle — enable/disable user
    app.post("/admin/users/:email/toggle", { preHandler: [requireAdmin] }, async (req, reply) => {
      const { email } = req.params as any;
      const user = userStore.get(email);
      if (!user) {
        return reply.status(404).send({ error: "User not found" });
      }
      const updated = userStore.setDisabled(email, !user.disabled);
      return { success: updated, email, disabled: !user.disabled };
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
      const report = await runGc({ dataDir: deps.dataDir, dryRun: true });
      return {
        report,
        packs: listPacks(deps.dataDir).map((p) => ({
          packId: p.packId,
          title: p.title,
          createdAt: p.createdAt,
          stickerCount: p.stickerCount,
          bytes: p.bytes,
          hasZip: p.hasZip
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

    app.delete("/admin/packs/:packId", { preHandler: [requireAdmin] }, async (req, reply) => {
      const { packId } = req.params as { packId: string };
      const removed = deletePack(deps.dataDir, packId);
      if (!removed) {
        reply.status(404);
        return { error: "NotFound", message: "pack not found" };
      }
      return { ok: true, packId };
    });
  };
}
