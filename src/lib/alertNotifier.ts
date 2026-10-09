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
        metric: alert.metric,
        value: alert.value,
        resolved: Boolean(alert.resolvedAt),
        message: alert.message,
        details: alert.details,
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
  const resolved = Boolean(alert.resolvedAt);

  if (isFeishu) {
    return {
      msg_type: "interactive",
      card: {
        header: {
          title: {
            tag: "plain_text",
            content: resolved ? "✅ EasySticker 告警恢复" : "🚨 EasySticker 告警",
          },
          template: resolved ? "green" : "red",
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

  // Generic webhook: 保留 text 兼容 Slack/自定义机器人，同时附带结构化字段
  const detailLines = (alert.details ?? []).map((d) => `· ${d}`);
  return {
    text: [`${resolved ? "✅ 告警恢复" : "🚨 告警"}：${alert.message}`, ...detailLines].join("\n"),
    event: resolved ? "alert.resolved" : "alert.fired",
    alert: {
      id: alert.id,
      rule: alert.rule,
      metric: alert.metric ?? null,
      message: alert.message,
      value: alert.value,
      details: alert.details ?? [],
      startedAt: alert.startedAt,
      resolvedAt: alert.resolvedAt,
      acknowledged: alert.acknowledged,
      notifyCount: alert.notifyCount ?? 0,
    },
  };
}

function buildFeishuMdContent(alert: AlertRecord): string {
  const resolved = Boolean(alert.resolvedAt);
  const status = resolved ? "已恢复 ✅" : alert.acknowledged ? "已确认" : "触发 🚨";
  const lines: string[] = [
    `**状态**：${status}`,
    `**规则**：\`${alert.rule}\`（${alert.metric ?? "unknown"}）`,
    `**详情**：${alert.message}`,
    `**开始时间**：${alert.startedAt}`,
  ];

  if (resolved && alert.resolvedAt) {
    lines.push(`**恢复时间**：${alert.resolvedAt}`);
  } else if ((alert.notifyCount ?? 0) > 1) {
    lines.push(`**提醒**：第 ${alert.notifyCount} 次通知` + (alert.lastNotifiedAt ? `（上次：${alert.lastNotifiedAt}）` : ""));
  }

  if (alert.details?.length) {
    lines.push("");
    lines.push("**归因 / 排查**：");
    for (const detail of alert.details) {
      lines.push(`- ${detail}`);
    }
  }

  return lines.join("\n");
}
