import type { FastifyInstance } from "fastify";
import type { UserStore } from "../lib/userStore";
import type { UsageStore } from "../lib/usageStore";

declare module "fastify" {
  interface FastifyInstance {
    userStore: UserStore;
    usageStore: UsageStore;
  }
}

export function registerAuthRoutes(app: FastifyInstance, _opts: unknown): void {
  // POST /api/auth/register
  app.post("/auth/register", {
    schema: {
      body: {
        type: "object",
        required: ["email", "password"],
        properties: {
          email: { type: "string", format: "email" },
          password: { type: "string", minLength: 6 },
          adminToken: { type: "string" }
        }
      }
    }
  }, async (req, reply) => {
    const { email, password, adminToken } = req.body as any;

    // Check if admin token is correct for admin registration
    const appConfig = app.appConfig;
    const adminSecret = appConfig.security?.apiToken;

    // First user auto-becomes admin; subsequent registrations require admin token
    const existingUsers = app.userStore.list();
    if (existingUsers.length > 0 && !adminToken) {
      return reply.status(403).send({
        error: "Registration closed",
        message: "New user registration requires an admin invite token."
      });
    }

    // If admin token provided, verify it
    if (adminToken && adminToken !== adminSecret) {
      return reply.status(403).send({
        error: "Invalid token",
        message: "The admin invite token is invalid."
      });
    }

    const role = existingUsers.length === 0 ? "admin" : "user";
    const user = app.userStore.register(email, password, role);
    if (!user) {
      return reply.status(409).send({
        error: "Email exists",
        message: "An account with this email already exists."
      });
    }

    // Generate JWT token
    const token = await reply.jwtSign({ email: user.email, role: user.role });
    return { token, user: { email: user.email, role: user.role } };
  });

  // POST /api/auth/login
  app.post("/auth/login", {
    schema: {
      body: {
        type: "object",
        required: ["email", "password"],
        properties: {
          email: { type: "string" },
          password: { type: "string" }
        }
      }
    }
  }, async (req, reply) => {
    const { email, password } = req.body as any;
    const user = app.userStore.login(email, password);
    if (!user) {
      return reply.status(401).send({
        error: "Invalid credentials",
        message: "Email or password is incorrect."
      });
    }

    const token = await reply.jwtSign({ email: user.email, role: user.role });
    return { token, user: { email: user.email, role: user.role } };
  });

  // GET /api/auth/me — current user info
  app.get("/auth/me", async (req, reply) => {
    try {
      await req.jwtVerify();
    } catch {
      return reply.status(401).send({ error: "Unauthorized", message: "Invalid or expired token." });
    }

    const { email, role } = req.user as any;
    const user = app.userStore.get(email);
    if (!user) {
      return reply.status(401).send({ error: "User not found" });
    }

    // Get usage summary
    const usage = app.usageStore.getSummary(email);

    return {
      user: { email: user.email, role: user.role, createdAt: user.createdAt, lastLogin: user.lastLogin },
      usage
    };
  });

  // GET /api/auth/quota — check remaining daily quota
  app.get("/auth/quota", async (req, reply) => {
    try {
      await req.jwtVerify();
    } catch {
      return reply.status(401).send({ error: "Unauthorized" });
    }

    const { email } = req.user as any;
    const APP_CONF = app.appConfig;
    const maxPerDay = APP_CONF.security?.dailyQuota?.maxGenerations ?? 100;
    app.usageStore.maybeRotate();
    const quota = app.usageStore.checkDailyQuota(email, maxPerDay);
    return quota;
  });

  // POST /api/auth/forgot-password — request password reset (local mode: contact admin)
  app.post("/auth/forgot-password", {
    schema: {
      body: {
        type: "object",
        required: ["email"],
        properties: {
          email: { type: "string" }
        }
      }
    }
  }, async (req, reply) => {
    const { email } = req.body as { email: string };
    const user = app.userStore.get(email);
    if (!user) {
      // Don't reveal whether email exists — always return success
      return { success: true, message: "如果该邮箱已注册，请联系管理员重置密码。" };
    }

    // In local dev mode, just respond with contact info
    return {
      success: true,
      message: "密码重置请求已记录。请管理员登录管理后台为用户重置密码。"
    };
  });

  // POST /api/auth/reset-password — admin resets a user's password
  app.post("/auth/reset-password", {
    schema: {
      body: {
        type: "object",
        required: ["email", "newPassword"],
        properties: {
          email: { type: "string" },
          newPassword: { type: "string", minLength: 6 }
        }
      }
    }
  }, async (req, reply) => {
    try {
      await req.jwtVerify();
    } catch {
      return reply.status(401).send({ error: "Unauthorized" });
    }

    const { role } = req.user as any;
    if (role !== "admin") {
      return reply.status(403).send({ error: "Forbidden", message: "Only admins can reset passwords." });
    }

    const { email, newPassword } = req.body as { email: string; newPassword: string };
    const ok = app.userStore.updatePassword(email, newPassword);
    if (!ok) {
      return reply.status(404).send({ error: "User not found" });
    }

    return { success: true, message: "密码已重置。" };
  });
}
