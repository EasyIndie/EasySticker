# syntax=docker/dockerfile:1
#
# EasySticker 生产镜像。构建产物会发布到 GHCR，可「无需源码」直接部署：
#   docker run -d -p 3000:3000 -v $PWD/data:/app/data ghcr.io/easyindie/easysticker:latest
# 详见 docs/deployment.md。

# ── 生产依赖（仅 dependencies，不含 tsup/vite/playwright 等）
FROM node:20-bookworm-slim AS prod-deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev --no-audit --no-fund

# ── 构建：全量依赖 + 编译后端（tsup → dist/）
FROM node:20-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --no-audit --no-fund
COPY tsconfig.json tsup.config.ts ./
COPY src ./src
COPY public ./public
RUN npm run build
# 前端产物（public/js 与带内容哈希的 HTML）已随仓库提交，这里直接复用。
# 若希望镜像内也从源码重建前端，取消下面两行（会明显变慢，需要 web/ 目录）：
# COPY web ./web
# RUN npm run web:build

# ── 运行
FROM node:20-bookworm-slim AS runtime
ENV NODE_ENV=production

LABEL org.opencontainers.image.title="EasySticker" \
      org.opencontainers.image.description="表情包 AI 自动化生产线（自托管：参考图 → AI 生成 → 自动标准化 → 打包下载）" \
      org.opencontainers.image.licenses="Apache-2.0" \
      org.opencontainers.image.source="https://github.com/EasyIndie/EasySticker"

WORKDIR /app

# curl 用于 HEALTHCHECK
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/public ./public
COPY prompt-config.default.json ./

# 非 root 运行；data 目录作为可写卷
RUN groupadd -r appuser && useradd -r -g appuser -d /app -s /sbin/nologin appuser \
    && mkdir -p /app/data && chown -R appuser:appuser /app

USER appuser
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD curl -f http://localhost:3000/health || exit 1

CMD ["node", "dist/server.js"]
