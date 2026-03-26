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
    transport
  };
}
