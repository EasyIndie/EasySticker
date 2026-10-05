# EasySticker 配置参考

## 配置机制

EasySticker 按以下优先级加载配置：

1. **`prompt-config.default.json`**（必需）— 内置默认基线；缺失/非法会导致启动报错
2. **`prompt-config.json`**（可选）— 用户覆盖；**只需写要改动的字段**，其余继承 default
3. **环境变量 / `.env`**（可选）— 最高优先级，覆盖以上两者的对应项

合并规则：以 default 为基线，按 **section 浅合并** 用户配置——`providers` 按 provider id 合并、`global`/`templates`/`extraPrompts` 按 key 合并、`emotions` 整体替换。因此 `prompt-config.json` 通常只需几行：

```json
{
  "ai": { "defaultProvider": "seedream" },
  "server": { "security": { "registration": { "mode": "open" } } }
}
```

> 敏感值（API key、JWT secret 等）优先读环境变量（如 `AI_<PROVIDER_ID>_API_KEY`），**不要写进配置文件**。

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

#### `maintenance` — 数据目录清理

`data/uploads`（素材）与 `data/packs`（包清单）如果不清理会一直增长。这里配置定期巡检。
GC 只做「可证明安全」的回收：压缩旧包、清孤儿素材、清备份；按时间删包默认关闭。

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `gcEnabled` | boolean | `true` | 是否启用定期清理。关掉则只在手动 `npm run gc` 时清理 |
| `gcIntervalMs` | number | `21600000` | 巡检间隔（毫秒，默认 6 小时）。启动后延迟 30 秒跑第一次 |
| `packRetentionDays` | number | `0` | 包保留天数；`0` = 不按时间清理。**非 0 会真的删除用户的历史包**，请确认前端有相应提示 |
| `orphanMinAgeHours` | number | `6` | 孤儿素材安全期（小时）。只有「无人引用」且「落盘超过这么久」的素材才会被删，避免误删正在生成的文件 |
| `compactLegacyPacks` | boolean | `true` | 把仅有 `.zip` 的历史包转成清单（素材本来就在 uploads 里，ZIP 改为下载时现打） |
| `dropOrigBackups` | boolean | `true` | 删除 `repair-pack` 留下的 `<packId>.zip.orig` 备份 |

示例：

```json
{
  "server": {
    "maintenance": {
      "gcEnabled": true,
      "gcIntervalMs": 21600000,
      "packRetentionDays": 0,
      "orphanMinAgeHours": 6
    }
  }
}
```

> 存储模型：**素材只存一份**（`data/uploads/<assetId>.<ext>`），包只存一份几 KB 的清单
> （`data/packs/<packId>.json`）。ZIP 在用户点下载时现场打包，不常驻磁盘。
> 因此「一个包」的磁盘成本 ≈ 素材体积，重试/重建不会成倍放大。

### `server.security` — 安全与认证

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `apiToken` | string | `""` | API Token（机器间认证）。留空则不启用 API Token 认证。**也可通过 `API_TOKEN` 环境变量设置** |
| `enableAuth` | boolean | `true` | 是否开启 API Token 认证。仅在 `apiToken` 非空时真正生效（`enableAuth !== false && !!apiToken`）。可用 `DISABLE_AUTH=true` 强制关闭 |
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
>
> 只读资源（`/api/assets/:id` 与 `/api/packs/:id/download`）**豁免限流与鉴权**：`<img>` / `<a>` 无法携带 `Authorization` 头，且一次结果页会几乎同时加载几十张图，若计入限流会触发 429 导致图片加载失败。

#### `dailyQuota` — 每日配额

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `maxGenerations` | number | `100` | 每用户（登录）每日最大生成次数 |
| `anonymousMaxGenerations` | number | `10` | 匿名用户（按 IP）每日最大生成次数 |

#### `registration` — 注册策略

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `mode` | string | `"open"` | 注册模式：`"open"`（开放注册）、`"invite"`（需邀请码）、`"closed"`（完全关闭）。注意：`prompt-config.default.json` 内置值为 `"invite"`，仓库中的 `prompt-config.json` 已覆盖为 `"open"` |

### `ai` — AI 生成

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `defaultProvider` | string | `"mock"` | 默认 AI 提供商 ID |
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
| `type` | string | 是 | 提供商类型：`"mock"`（本地模拟）或 `"openai"`（OpenAI 兼容 API） |
| `name` | string | 是 | 展示名称 |
| `baseUrl` | string | 否 | OpenAI 兼容 API 基础 URL（默认 `https://api.openai.com/v1`，可指向任意兼容端点） |
| `model` | string | 否 | 模型名称（默认 `gpt-image-1.5`） |
| `apiKey` | string | 否 | API Key。**推荐改用环境变量 `AI_<PROVIDER_ID>_API_KEY`**（环境变量优先于此处配置），避免密钥写入配置文件 |
| `background` | string | 否 | `"transparent"` / `"opaque"` / `"auto"`（默认透明） |
| `quality` | string | 否 | `"low"` / `"medium"` / `"high"` / `"auto"` |
| `outputFormat` | string | 否 | `"png"` / `"jpeg"` / `"webp"` |
| `moderation` | string | 否 | `"low"` / `"auto"`（仅 gpt-image 变体） |
| `inputFidelity` | string | 否 | `"low"` / `"high"`（参考图保真度，仅 gpt-image 变体） |
| `variant` | string | 否 | `"gpt-image"`（默认）或 `"generic"`。`"generic"` 用于豆包 Seedream、硅基流动 FLUX 等通用 OpenAI 兼容生图接口 |
| `size` | string | 否 | generic 变体的输出尺寸（如 `"1024x1024"`、`"2K"`），默认 `"1024x1024"` |

### `.env` — 环境变量

| 变量 | 必填 | 默认值 | 说明 |
|------|------|--------|------|
| `API_TOKEN` | 推荐 | `""` | API Token 认证（亦兼作邀请码）。**留空 = 关闭鉴权**，仅本地自测可留空 |
| `JWT_SECRET` | 推荐 | 随机生成 | JWT 签名密钥。生产环境**必须**固定，否则重启后所有 token 失效 |
| `ADMIN_PASSWORD` | 推荐 | 自动生成 | 首个管理员账户密码 |
| `ADMIN_EMAIL` | 否 | `admin@easysticker.app` | 管理员邮箱（创建首个用户时使用） |
| `AI_<PROVIDER_ID>_API_KEY` | 推荐 | — | 各 AI 提供商的密钥，如 `AI_SEEDREAM_API_KEY`、`AI_OPENAI_API_KEY`。优先级高于 `prompt-config.json` 的 `apiKey` |
| `PORT` | 否 | `3000` | 服务端口 |
| `DATA_DIR` | 否 | `data` | 数据存储目录 |
| `LOG_LEVEL` | 否 | `info` | 日志级别 |
| `NODE_ENV` | 否 | `development` | 运行环境；对公网部署改 `production` 并务必同时设置 `API_TOKEN` |
| `RATE_LIMIT_MAX` | 否 | `30` | 每分钟每 IP 最大请求数（覆盖 `server.security.rateLimit.maxRequests`） |
| `DAILY_QUOTA_MAX` | 否 | `100` | 登录用户每日最大生成次数（匿名用户仍用 `anonymousMaxGenerations`） |
| `CORS_ALLOW_ORIGIN` | 否 | 同源 | 允许跨域的单域名白名单 |
| `DISABLE_AUTH` | 否 | — | 设为真值可强制关闭鉴权 |
| `BASE_URL` | 否 | — | 外部访问地址（密码重置链接） |
| `SMTP_HOST` | 否 | — | SMTP 服务器地址（密码重置邮件） |
| `SMTP_PORT` | 否 | `587` | SMTP 端口 |
| `SMTP_USER` | 否 | — | SMTP 用户名 |
| `SMTP_PASS` | 否 | — | SMTP 密码 |
| `SMTP_FROM` | 否 | — | 发件人地址 |
| `MONITOR_RETENTION_DAYS` | 否 | `30` | 监控数据保留天数 |
