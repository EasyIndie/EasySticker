import nodemailer from "nodemailer";
import type { FastifyBaseLogger } from "fastify";

export interface MailerConfig {
  host: string;
  port: number;
  user?: string;
  pass?: string;
  from: string;
  /** Base URL for reset links, e.g. http://localhost:3000 */
  baseUrl: string;
}

export type Mailer = ReturnType<typeof createMailer>;

/**
 * Create a mailer. If SMTP host is empty, falls back to "console mode"
 * where emails are only logged, useful for local development with no SMTP.
 */
export function createMailer(config: MailerConfig, log: FastifyBaseLogger) {
  const transporter =
    config.host
      ? nodemailer.createTransport({
          host: config.host,
          port: config.port,
          secure: config.port === 465,
          auth:
            config.user && config.pass
              ? { user: config.user, pass: config.pass }
              : undefined,
          tls: { rejectUnauthorized: false },
        })
      : null;

  /** Send an email (or log in console mode). Returns true if sent. */
  async function send(options: {
    to: string;
    subject: string;
    text: string;
    html?: string;
  }): Promise<boolean> {
    if (!transporter) {
      log.info(
        { to: options.to, subject: options.subject },
        "[mailer-console] " + options.text.replace(/\n/g, " | ")
      );
      return true; // pretend success
    }

    try {
      await transporter.sendMail({
        from: config.from,
        to: options.to,
        subject: options.subject,
        text: options.text,
        html: options.html,
      });
      log.info({ to: options.to, subject: options.subject }, "Email sent");
      return true;
    } catch (err) {
      log.error({ err, to: options.to }, "Failed to send email");
      return false;
    }
  }

  /** Build the reset-password email content. */
  function buildResetEmail(to: string, token: string): {
    subject: string;
    text: string;
    html: string;
  } {
    const resetUrl = `${config.baseUrl}/reset-password?token=${token}`;
    const subject = "EasySticker — 密码重置";
    const text = `你好，

请点击以下链接重置你的 EasySticker 账户密码：

${resetUrl}

该链接在 1 小时内有效。如果你没有请求重置密码，请忽略此邮件。

EasySticker 团队`;

    const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head><meta charset="utf-8"></head>
<body style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
  <h2>EasySticker — 密码重置</h2>
  <p>你好，</p>
  <p>请点击下方链接重置你的 EasySticker 账户密码：</p>
  <p style="text-align: center; margin: 30px 0;">
    <a href="${resetUrl}" style="display: inline-block; padding: 12px 24px; background: #4f46e5; color: #fff; text-decoration: none; border-radius: 6px; font-size: 16px;">
      重置密码
    </a>
  </p>
  <p>或复制以下链接到浏览器地址栏：</p>
  <p style="word-break: break-all; color: #666;">${resetUrl}</p>
  <p style="color: #999; font-size: 13px;">该链接在 1 小时内有效。如果你没有请求重置密码，请忽略此邮件。</p>
  <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
  <p style="color: #999; font-size: 12px;">EasySticker 团队</p>
</body>
</html>`;

    return { subject, text, html };
  }

  /** Send a password-reset email (or log). */
  async function sendResetPassword(to: string, token: string): Promise<boolean> {
    const { subject, text, html } = buildResetEmail(to, token);
    return send({ to, subject, text, html });
  }

  return { send, sendResetPassword, buildResetEmail };
}
