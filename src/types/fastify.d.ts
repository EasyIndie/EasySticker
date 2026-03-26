import "fastify";
import type { AppConfig } from "../app";

declare module "fastify" {
  interface FastifyInstance {
    appConfig: AppConfig;
  }
}

