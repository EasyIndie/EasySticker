import type { AlertConfig, AlertRecord } from "./alertEngine";

// ── Types ──────────────────────────────────────────────────────

export interface AlertNotifier {
  /** Send alert notification. Returns true if sent successfully. */
  send(alert: AlertRecord): Promise<boolean>;
}

// ── Factory ────────────────────────────────────────────────────

export function createAlertNotifier(
  getConfig: () => AlertConfig,
  logger?: { warn: (msg: string | object) => void; info: (msg: string | object) => void },
): AlertNotifier {
  return {
    async send(alert: AlertRecord): Promise<boolean> {
      const config = getConfig();

      // 1. Always log locally
      logger?.warn({
        event: "alert_notification",
        alertId: alert.id,
        rule: alert.rule,
        value: alert.value,
        message: alert.message,
      } as Record<string, unknown>);

      // 2. Webhook if enabled
      if (config.webhookEnabled && config.webhookUrl) {
        try {
          const payload = buildWebhookPayload(alert, config.webhookUrl);
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 10_000);

          const res = await fetch(config.webhookUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
            signal: controller.signal,
          });

          clearTimeout(timer);

          if (res.ok) {
            logger?.info({
              event: "webhook_sent",
              alertId: alert.id,
              status: res.status,
            } as Record<string, unknown>);
            return true;
          } else {
            logger?.warn({
              event: "webhook_failed",
              alertId: alert.id,
              status: res.status,
              body: await res.text().catch(() => "n/a"),
            } as Record<string, unknown>);
            return false;
          }
        } catch (err: any) {
          logger?.warn({
            event: "webhook_error",
            alertId: alert.id,
            error: err.message,
          } as Record<string, unknown>);
          return false;
        }
      }

      // webhook disabled → just logged, consider it "sent" locally
      return true;
    },
  };
}

// ── Webhook payload builders ───────────────────────────────────

function buildWebhookPayload(alert: AlertRecord, webhookUrl: string): Record<string, unknown> {
  // Detect Feishu webhook URL pattern
  const isFeishu = /feishu|open\.feishu|lark/i.test(webhookUrl);

  if (isFeishu) {
    return {
      msg_type: "interactive",
      card: {
        header: {
          title: {
            tag: "plain_text",
            content: "🚨 EasySticker 告警",
          },
        },
        elements: [
          {
            tag: "div",
            text: {
              tag: "lark_md",
              content: buildFeishuMdContent(alert),
            },
          },
        ],
      },
    };
  }

  // Generic webhook: plain text payload
  return {
    text: `🚨 告警: ${alert.message}`,
  };
}

function buildFeishuMdContent(alert: AlertRecord): string {
  const lines = [
    `**规则**: ${alert.rule}`,
    `**消息**: ${alert.message}`,
    `**当前值**: ${alert.value}`,
    `**开始时间**: ${alert.startedAt}`,
  ];

  if (alert.acknowledged) {
    lines.push(`**状态**: 已确认`);
  }

  return lines.join("\n");
}
