# EasySticker 配置参考

## 配置机制

EasySticker 使用两层配置：

1. **`prompt-config.default.json`** — 内置默认值，项目版本内自带
2. **`prompt-config.json`** — 用户覆盖；缺失的字段从 `default` 继承

> 敏感值（API key、JWT secret 等）优先读环境变量，不回写配置文件。

## 完整配置项

### `server` — 服务端

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `host` | string | `"0.0.0.0"` | 监听地址 |
| `port` | number | `3000` | 监听端口 |
| `dataDir` | string | `"data"` | 数据存储目录（用户、使用量、监控数据） |
| `logLevel` | string | `"info"` | 日志级别：`trace`, `debug`, `info`, `warn`, `error`, `fatal` |
| `taskTtlMs` | number | `3600000` | 生成任务 TTL（毫秒，默认 1 小时） |
| `taskGcIntervalMs` | number | `600000` | 过期任务清理间隔（毫秒，默认 10 分钟） |

### `server.security` — 安全与认证

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `apiToken` | string | `""` | API Token（机器间认证）。留空则不启用 API Token 认证。**也可通过 `API_TOKEN` 环境变量设置** |
| `enableAuth` | boolean | `false` | 是否开启 API Token 认证 |
| `jwtSecret` | string | 随机生成 | JWT 签名密钥。**也可通过 `JWT_SECRET` 环境变量设置**。不设置则每次重启生成新的随机密钥（已签发的 token 将失效） |
| `jwtExpiresIn` | string | `"7d"` | JWT Token 过期时长。支持 `ms` 格式如 `3600000`（1 小时）或字符串如 `"7d"`、`"24h"`、`"30d"` |
| `trustProxy` | boolean | `false` | 启用信任代理（Nginx/Caddy 反代场景）。开启后真实 IP 从 `X-Forwarded-For` 获取 |
| `corsAllowOrigin` | string | 未设置（同源） | 允许跨域请求的来源。注意：仅单域名白名单模式，不设则禁止跨域 |

> Fastify v5 和 @fastify/jwt 自动检测 X-Forwarded-For/Proto 头，反代场景无需额外配置。

#### `rateLimit` — 速率限制

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `maxRequests` | number | `30` | 每个窗口内最大请求数 |
| `windowMs` | number | `60000` | 窗口时长（毫秒，默认 1 分钟） |

> 登录/注册接口使用独立限流策略：每 IP 每分钟最多 5 次请求。

#### `dailyQuota` — 每日配额

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `maxGenerations` | number | `100` | 每用户（登录）每日最大生成次数 |
| `anonymousMaxGenerations` | number | `10` | 匿名用户（按 IP）每日最大生成次数 |

#### `registration` — 注册策略

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `mode` | string | `"open"` | 注册模式：`"open"`（开放注册）、`"invite"`（需邀请码）、`"closed"`（完全关闭） |

### `ai` — AI 生成

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `defaultProvider` | string | `"picsum"` | 默认 AI 提供商 ID |
| `referenceMode` | string | `"base64"` | 参考图传递方式：`"base64"` 或 `"url"` |
| `publicBaseUrl` | string | `""` | 外网可访问的 base URL（用于生成公开图片链接） |

#### `ai.imageSize` — 图片尺寸

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `width` | number | `1024` | 生成图片宽度 |
| `height` | number | `1024` | 生成图片高度 |

#### `ai.settings` — 调用设置

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `timeoutMs` | number | `60000` | 单次调用超时（毫秒） |
| `retryMax` | number | `3` | 失败重试次数 |
| `retryBaseMs` | number | `1000` | 重试基础等待（毫秒，指数退避） |

#### `ai.providers` — AI 提供商

每个提供商支持字段：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `type` | string | 是 | 提供商类型：`"mock"`、`"picsum"`、`"doubao"`、`"openai"`、`"hf"`、`"http"` |
| `name` | string | 是 | 展示名称 |
| `baseUrl` | string | 否 | API 基础 URL |
| `endpoint` | string | 否 | HTTP 类型提供商使用完整端点 URL |
| `model` | string | 否 | 模型名称 |
| `apiKey` | string | 否 | API Key。**也可通过 `AI_<PROVIDER>_API_KEY` 环境变量设置** |

### `.env` — 环境变量

| 变量 | 必填 | 默认值 | 说明 |
|------|------|--------|------|
| `API_TOKEN` | 推荐 | `""` | API Token 认证。设置后自动开启 API Token 检查 |
| `JWT_SECRET` | 推荐 | 随机生成 | JWT 签名密钥。生产环境**必须**固定，否则重启后所有 token 失效 |
| `ADMIN_PASSWORD` | 推荐 | 自动生成 | 首个管理员账户密码。Docker 容器中建议设置 |
| `SMTP_HOST` | 否 | — | SMTP 服务器地址（密码重置邮件） |
| `SMTP_PORT` | 否 | `587` | SMTP 端口 |
| `SMTP_USER` | 否 | — | SMTP 用户名 |
| `SMTP_PASS` | 否 | — | SMTP 密码 |
| `SMTP_FROM` | 否 | — | 发件人地址 |
| `MONITOR_RETENTION_DAYS` | 否 | `30` | 监控数据保留天数 |
