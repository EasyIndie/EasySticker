export function buildLogger(level: string) {
  // `node --watch` 会在受监视进程（以及它创建的 worker 线程）里开启依赖上报，
  // 上报消息会与 pino 的 worker transport（thread-stream）协议冲突，
  // 导致启动即崩溃（Error: this should not happen: undefined）。
  // 因此 watch 模式下退化为 JSON 日志，保证 `npm run dev` 可用。
  const underWatch =
    process.execArgv.includes("--watch") || process.env["WATCH_REPORT_DEPENDENCIES"] !== undefined;
  const transport =
    process.env.NODE_ENV === "production" || underWatch
      ? undefined
      : {
          target: "pino-pretty",
          options: { translateTime: "SYS:standard", colorize: true }
        };

  return {
    level,
    transport,
    redact: ["req.headers.authorization", "req.headers.cookie", "req.body.password", "req.body.newPassword", "req.body.token", "req.body.adminToken"]
  };
}
