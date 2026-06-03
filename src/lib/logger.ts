export function buildLogger(level: string) {
  const transport =
    process.env.NODE_ENV === "production"
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
