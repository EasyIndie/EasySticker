import crypto from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { UserStore } from "../lib/userStore";
import type { UsageStore } from "../lib/usageStore";
import type { Mailer } from "../lib/mailer";

declare module "fastify" {
  interface FastifyInstance {
    userStore: UserStore;
    usageStore: UsageStore;
    mailer?: Mailer;
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

    const appConfig = app.appConfig;
    const adminSecret = appConfig.security?.apiToken;
    const { allowed: regAllowed, mode: regMode } = app.security.checkRegistration();

    // 'closed' mode — no registrations at all
    if (regMode === "closed") {
      return reply.status(403).send({
        error: "Registration disabled",
        message: "New user registration is currently disabled."
      });
    }

    // 'invite' mode — need admin token (unless first user which auto-becomes admin)
    const existingUsers = app.userStore.list();
    if (regMode === "invite") {
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
    }

    const role = existingUsers.length === 0 ? "admin" : "user";
    const user = app.userStore.register(email, password, role);
    if (!user) {
      return reply.status(409).send({
        error: "Email exists",
        message: "An account with this email already exists."
      });
    }

    // Send email verification (first-time users who are not admin)
    if (role !== "admin" && app.mailer) {
      const verifyToken = crypto.randomBytes(32).toString("hex");
      app.userStore.setEmailVerifyToken(user.email, verifyToken, 86_400_000); // 24h
      app.mailer.sendVerifyEmail(user.email, verifyToken).catch(() => {});
    }

    // Generate JWT token (default 7d expiry)
    const expiresIn = app.appConfig.security?.jwtExpiresIn ?? "7d";
    const token = await reply.jwtSign({ email: user.email, role: user.role }, { expiresIn });
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

    // Reject unverified users
    if (!user.emailVerified && user.role !== "admin") {
      // Allow resending verification
      return reply.status(403).send({
        error: "Email not verified",
        message: "请先验证邮箱后再登录。",
        email: user.email
      });
    }

    const expiresIn = app.appConfig.security?.jwtExpiresIn ?? "7d";
    const token = await reply.jwtSign({ email: user.email, role: user.role }, { expiresIn });
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

  // POST /api/auth/forgot-password — send password reset email
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

    // Always return same message (don't reveal whether email exists)
    const genericMsg = "如果该邮箱已注册，你将收到密码重置邮件。";

    if (!user) {
      return { success: true, message: genericMsg };
    }

    if (!app.mailer) {
      app.log.warn({ email }, "Password reset requested but no mailer configured");
      return { success: true, message: genericMsg };
    }

    // Generate a secure random token
    const token = crypto.randomBytes(32).toString("hex");
    const ttlMs = 3600_000; // 1 hour
    app.userStore.setResetToken(email, token, ttlMs);

    const sent = await app.mailer.sendResetPassword(email, token);
    if (!sent) {
      app.log.error({ email }, "Failed to send password reset email");
      return { success: true, message: genericMsg };
    }

    return {
      success: true,
      message: genericMsg
    };
  });

  // POST /api/auth/reset-password-with-token — user resets password using email token
  app.post("/auth/reset-password-with-token", {
    schema: {
      body: {
        type: "object",
        required: ["token", "password"],
        properties: {
          token: { type: "string" },
          password: { type: "string", minLength: 6 }
        }
      }
    }
  }, async (req, reply) => {
    const { token, password } = req.body as { token: string; password: string };

    const user = app.userStore.getByResetToken(token);
    if (!user) {
      return reply.status(400).send({
        error: "Invalid token",
        message: "重置链接无效或已过期，请重新申请。"
      });
    }

    app.userStore.updatePassword(user.email, password);
    app.userStore.clearResetToken(user.email);

    return { success: true, message: "密码已重置，请用新密码登录。" };
  });

  // POST /api/auth/reset-password — admin/machine resets a user's password (keep for admin panel)
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

  // POST /api/auth/verify-email — confirm email via token
  app.post("/auth/verify-email", {
    schema: {
      body: {
        type: "object",
        required: ["token"],
        properties: {
          token: { type: "string" }
        }
      }
    }
  }, async (req, reply) => {
    const { token } = req.body as { token: string };
    const ok = app.userStore.verifyEmail(token);
    if (!ok) {
      return reply.status(400).send({
        error: "Invalid token",
        message: "验证链接无效或已过期，请重新注册。"
      });
    }
    return { success: true, message: "邮箱验证成功，请登录。" };
  });

  // POST /api/auth/resend-verification — resend verification email
  app.post("/auth/resend-verification", {
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
    if (!user || user.emailVerified) {
      // Don't reveal if email exists or already verified
      return { success: true, message: "如果该邮箱未验证，你将收到验证邮件。" };
    }
    if (!app.mailer) {
      app.log.warn({ email }, "Verification email requested but no mailer configured");
      return { success: true, message: "如果该邮箱未验证，你将收到验证邮件。" };
    }
    const verifyToken = crypto.randomBytes(32).toString("hex");
    app.userStore.setEmailVerifyToken(email, verifyToken, 86_400_000);
    app.mailer.sendVerifyEmail(email, verifyToken).catch(() => {});
    return { success: true, message: "如果该邮箱未验证，你将收到验证邮件。" };
  });
}
