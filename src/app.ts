import crypto from "node:crypto";
import path from "node:path";
import Fastify, {
  type FastifyError,
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest
} from "fastify";
import multipart from "@fastify/multipart";
import staticPlugin from "@fastify/static";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import { buildLogger } from "./lib/logger";
import { registerUploadRoutes } from "./routes/uploads";
import { registerAssetRoutes } from "./routes/assets";
import { registerPackRoutes } from "./routes/packs";
import { registerWeChatAiRoutes } from "./routes/wechatAi";

export type AppConfig = {
  host: string;
  port: number;
  dataDir: string;
  logLevel: string;
};

export function buildApp(config: AppConfig): FastifyInstance {
  const app = Fastify({
    logger: buildLogger(config.logLevel),
    genReqId: () => crypto.randomUUID()
  });

  app.decorate("appConfig", config);

  app.setErrorHandler((err: FastifyError, req: FastifyRequest, reply: FastifyReply) => {
    req.log.error({ err }, "request error");
    const statusCode = typeof (err as any).statusCode === "number" ? (err as any).statusCode : 500;
    reply.status(statusCode).send({
      requestId: req.id,
      error: statusCode >= 500 ? "InternalServerError" : "BadRequest",
      message: err.message
    });
  });

  app.register(swagger, {
    openapi: {
      info: {
        title: "EasySticker API",
        version: "0.1.0"
      }
    }
  });
  app.register(swaggerUi, { routePrefix: "/docs" });

  app.register(multipart, {
    limits: { fileSize: 25 * 1024 * 1024 }
  });

  app.register(staticPlugin, {
    root: path.join(process.cwd(), "public"),
    prefix: "/"
  });

  app.register(registerUploadRoutes, { prefix: "/api" });
  app.register(registerAssetRoutes, { prefix: "/api" });
  app.register(registerPackRoutes, { prefix: "/api" });
  app.register(registerWeChatAiRoutes, { prefix: "/api" });

  return app;
}
