/**
 * 后台仪表盘的实时数据流。
 *
 * 之前是 `setInterval(loadDashboard, 15000)`：每个开着的后台页面每 15 秒发两个
 * 请求（monitoring + alerts），数据却永远滞后最多 15 秒。改成一条 SSE 长连接后：
 *   - 服务端每 5 秒推一帧，告警只在变化时推，请求数从「每 15 秒 2 个」降到 0；
 *   - 切到别的标签页 / 浏览器标签页被隐藏时前端主动断开，不留空转连接；
 *   - 断线自动退避重连（后台服务重启时能自愈）。
 *
 * 用 fetch + SseParser 而不是原生 EventSource：EventSource 不能带
 * Authorization 头，而把 JWT 塞进 URL 会漏进访问日志。
 */
import { SseParser } from "./sse";

export type MonitoringStreamHandlers = {
  /** 监控快照 + 趋势数据（服务端每 5 秒一帧）。 */
  onSnapshot: (payload: { snapshot: any; trends: any }) => void;
  /** 未解决的告警列表（仅在内容变化时推送）。 */
  onAlerts?: (payload: { alerts: any[] }) => void;
  /** 连接状态变化，用于在界面上显示「实时更新中 / 已断开」。 */
  onStatus?: (status: "connecting" | "live" | "offline") => void;
};

export type MonitoringStream = { close: () => void };

const TOKEN_KEY = "easysticker_token";
const MAX_BACKOFF_MS = 30_000;

/**
 * 打开仪表盘实时流。返回的 `close()` 会同时停止重连，调用后不会再发起请求。
 */
export function openMonitoringStream(handlers: MonitoringStreamHandlers): MonitoringStream {
  const controller = new AbortController();
  let stopped = false;
  let attempt = 0;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;

  handlers.onStatus?.("connecting");

  async function run(): Promise<void> {
    if (stopped) return;
    const startedAt = Date.now();
    const token = localStorage.getItem(TOKEN_KEY);
    try {
      const res = await fetch("/api/admin/monitoring/stream", {
        headers: {
          accept: "text/event-stream",
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        signal: controller.signal
      });

      if (!res.ok || !res.body) {
        // 401 说明登录过期，交给调用方下次 apiCall 统一处理，这里只标记离线
        throw new Error(`monitoring stream failed: ${res.status}`);
      }

      attempt = 0;
      handlers.onStatus?.("live");
      const parser = new SseParser();
      const reader = res.body.getReader();
      const decoder = new TextDecoder();

      while (!stopped) {
        const { done, value } = await reader.read();
        if (done) break;
        for (const event of parser.push(decoder.decode(value, { stream: true }))) {
          if (event.event !== "snapshot" && event.event !== "alerts") continue;
          let data: any;
          try {
            data = JSON.parse(event.data);
          } catch {
            continue; // 半截帧等异常数据直接跳过，不要让整条连接断掉
          }
          if (event.event === "snapshot") handlers.onSnapshot(data);
          else handlers.onAlerts?.(data);
        }
      }
      throw new Error("monitoring stream closed");
    } catch (err) {
      if (stopped || controller.signal.aborted) return;
      handlers.onStatus?.("offline");
      // 刚建立就被掐断时也至少等 1s，避免紧凑重连把服务端打爆
      const backoff = Math.max(1000, Math.min(MAX_BACKOFF_MS, 1000 * 2 ** attempt));
      attempt += 1;
      const wait = Math.max(0, backoff - (Date.now() - startedAt));
      retryTimer = setTimeout(() => void run(), wait);
    }
  }

  void run();

  return {
    close: () => {
      stopped = true;
      if (retryTimer) clearTimeout(retryTimer);
      controller.abort();
    }
  };
}
