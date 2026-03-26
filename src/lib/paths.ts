import path from "node:path";
import type { FastifyInstance } from "fastify";

export function uploadsDir(app: FastifyInstance) {
  return path.join(app.appConfig.dataDir, "uploads");
}

