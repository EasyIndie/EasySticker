import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";

export function registerAdminRoutes(app: FastifyInstance, _opts: unknown): void {
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
    const users = app.userStore.list();
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
    const user = app.userStore.get(email);
    if (!user) {
      return reply.status(404).send({ error: "User not found" });
    }
    const updated = app.userStore.setDisabled(email, !user.disabled);
    return { success: updated, email, disabled: !user.disabled };
  });

  // GET /api/admin/usage — usage stats for all users
  app.get("/admin/usage", { preHandler: [requireAdmin] }, async (_req, reply) => {
    app.usageStore.maybeRotate();
    const summaries = app.usageStore.getAllSummaries();
    return { summaries };
  });
}
