import type { AlertRule, AlertRecord } from "../lib/alertEngine";
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import type { AppDeps } from "../lib/deps";

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
  };
}
