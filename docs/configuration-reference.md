# EasySticker 配置参考

> 本文是配置项的**唯一权威清单**。默认值以 `prompt-config.default.json` 为准，环境变量以 `.env.example` 为准。
> 两者不一致时以代码为准，请顺手修文档。

---

## 1. 配置机制

```
真实环境变量  >  .env  >  prompt-config.json  >  prompt-config.default.json
   （最高）                                          （必需基线）
```

| 文件 | 作用 |
|------|------|
| `prompt-config.default.json` | **必需**。内置默认基线，缺失或非法即启动报错 |
| `prompt-config.json` | 可选。只写与默认不同的字段，其余继承默认 |
| `.env` | 可选。优先级最高，适合放密钥；由 `lib/envFile.ts` 读写，启动时自动加载且**不覆盖**已有环境变量 |

**合并规则**：以 default 为基线做 section 深合并 —— `providers` 按 provider id 合并、`global` / `templates` / `extraPrompts` 按 key 合并、`emotions` / `promptPresets` 整体替换（不是逐项合并）。所以覆盖文件通常只需几行：

```json
{
  "ai": { "defaultProvider": "seedream" },
  "server": { "security": { "registration": { "mode": "open" } } }
}
```

> 🔐 密钥（API Key、JWT secret）**不要写进配置文件**，放 `.env`。环境变量优先，`apiKey` 留空即可。

---

## 2. `server` — 服务端

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `host` | string | `"0.0.0.0"` | 监听地址 |
| `port` | number | `3000` | 监听端口（`PORT` 环境变量优先） |
| `dataDir` | string | `"data"` | 数据存储目录（`DATA_DIR` 环境变量优先） |
| `logLevel` | string | `"info"` | `trace`/`debug`/`info`/`warn`/`error`/`fatal`/`silent` |
| `taskTtlMs` | number | `3600000` | 生成任务在内存中的 TTL（1 小时） |
| `taskGcIntervalMs` | number | `600000` | 过期任务清理间隔（10 分钟） |

### 2.1 `server.security`

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `apiToken` | string | `""` | API Token（机器间认证），亦兼作邀请码。**留空 = 关闭鉴权**。可用 `API_TOKEN` 环境变量 |
| `enableAuth` | boolean | `true` | 仅在 `apiToken` 非空时真正生效。`DISABLE_AUTH=true` 可强制关闭 |
| `jwtSecret` | string | 随机生成 | JWT 签名密钥。生产环境**必须**固定，否则重启后所有 token 失效。可用 `JWT_SECRET` |
| `jwtExpiresIn` | string | `"7d"` | Token 有效期，支持 `"24h"`/`"30d"` 或毫秒数 |
| `trustProxy` | boolean | `false` | 反代场景开启，真实 IP 取自 `X-Forwarded-For` |
| `corsAllowOrigin` | string | 未设置（同源） | 单域名白名单，不设则禁止跨域 |

#### `rateLimit`

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `maxRequests` | number | `30` | 每窗口最大请求数（`RATE_LIMIT_MAX` 优先） |
| `windowMs` | number | `60000` | 窗口时长（毫秒） |

> 登录/注册接口使用独立限流：每 IP 每分钟 5 次。
>
> **已认证管理员**使用独立且宽松的额度（`admin:<ip>`，600 次/分）：后台一次页面加载/切页会
> 并发很多请求（图表、表格、设置、SSE），用普通额度会误伤。普通用户与匿名请求仍按 `maxRequests` 限制。
>
> ⚠️ 别把两个「匿名用户标识」搞混：**日配额按 IP**（`ip:<req.ip>`），
> **包的归属按前端持久化的 `x-client-id`**（`client:<id>`，见 `lib/owner.ts`）。前者防刷，
> 后者让未登录用户也能找回自己的历史，两者互不影响。
>
> **只读资源豁免限流与鉴权**：`/api/assets/:id` 与 `/api/packs/:id/download`。
> `<img>` / `<a>` 无法携带 `Authorization`，且一次结果页会几乎同时加载几十张图，
> 若计入限流会触发 429 导致图片加载失败。

#### `dailyQuota`

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `maxGenerations` | number | `100` | 登录用户每日生成次数（`DAILY_QUOTA_MAX` 优先） |
| `anonymousMaxGenerations` | number | `10` | 匿名用户每日生成次数（`DAILY_QUOTA_ANONYMOUS_MAX` 优先）。**按 IP 计** |

#### `registration`

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `mode` | string | `"invite"` | `"open"` 开放注册 / `"invite"` 需邀请码（即 `API_TOKEN`）/ `"closed"` 完全关闭 |

### 2.2 `server.maintenance` — 数据目录清理

`data/uploads`（素材）与 `data/packs`（包清单）不清理会一直增长。GC 只做「可证明安全」的回收。

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `gcEnabled` | boolean | `true` | 是否启用定期巡检。关掉则只能手动 `npm run gc` |
| `gcIntervalMs` | number | `21600000` | 巡检间隔（6 小时）。启动后延迟 30 秒跑第一次 |
| `packRetentionDays` | number | `30` | 包保留天数，`0` = 不按时间清理。**非 0 会真的删除用户历史包** |
| `orphanMinAgeHours` | number | `6` | 孤儿素材安全期。只有「无人引用」**且**「落盘超过这么久」才删 |
| `compactLegacyPacks` | boolean | `true` | 把仅有 `.zip` 的历史包转成清单（素材本来就在 uploads 里） |
| `dropOrigBackups` | boolean | `true` | 删除 `repair-pack` 留下的 `<packId>.zip.orig` |

**保留期不追溯既往**：过期时间 = `max(包创建时间, 策略生效时间) + 保留天数`，
生效时间记在 `data/maintenance.json`。所以「今天才把 `packRetentionDays` 从 0 改成 30」不会立刻清空历史数据。

```json
{
  "server": {
    "maintenance": {
      "gcEnabled": true,
      "gcIntervalMs": 21600000,
      "packRetentionDays": 30,
      "orphanMinAgeHours": 6
    }
  }
}
```

---

## 3. `ai` — AI 生成

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `defaultProvider` | string | `"mock"` | 默认提供商 ID（须存在于 `ai.providers`） |
| `referenceMode` | string | `"base64"` | 参考图传递方式。**实际被消费的只有 `base64` / `url` / `multipart`**（见 `providers/openai.ts`）；`assetId` 已无 provider 实现 |
| `publicBaseUrl` | string | `""` | 外网可访问的 base URL，`referenceMode: "url"` 时需要 |

### 3.1 `ai.imageSize` / `ai.settings`

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `imageSize.width` | number | `1024` | 生成图宽度 |
| `imageSize.height` | number | `1024` | 生成图高度 |
| `settings.timeoutMs` | number | `60000` | 单次调用超时（毫秒） |
| `settings.retryMax` | number | `3` | 失败重试次数 |
| `settings.retryBaseMs` | number | `1000` | 重试基础等待（毫秒，指数退避） |

> 生成尺寸与交付尺寸是两件事：`ai.imageSize` 是**生成**尺寸，交付尺寸由平台 preset 决定
> （微信 240×240 / Telegram ≤512×512 / WhatsApp 512×512 WebP），转换在 `generate/convert.ts`。

### 3.2 `ai.providers`

内置三个：`mock`（本地模拟，无需 Key）、`openai`（`variant: "gpt-image"`）、`seedream`（豆包，`variant: "generic"`）。

每个 provider 支持的字段：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `type` | string | 是 | `"mock"` 或 `"openai"`（生图统一走 OpenAI 兼容 Images API） |
| `name` | string | 是 | 展示名称（显示在前端下拉框） |
| `baseUrl` | string | 否 | 兼容端点基础 URL（默认 `https://api.openai.com/v1`） |
| `model` | string | 否 | 模型名（默认 `gpt-image-1.5`） |
| `apiKey` | string | 否 | **推荐改用 `AI_<PROVIDER_ID>_API_KEY`**（环境变量优先） |
| `variant` | string | 否 | `"gpt-image"`（默认）或 `"generic"`。generic 用于豆包 Seedream、硅基流动 FLUX 等 |
| `size` | string | 否 | generic 变体输出尺寸（如 `"1024x1024"`、`"2K"`），默认 `"1024x1024"` |
| `background` | string | 否 | `"transparent"` / `"opaque"` / `"auto"`（仅 gpt-image） |
| `quality` | string | 否 | `"low"` / `"medium"` / `"high"` / `"auto"`（仅 gpt-image） |
| `outputFormat` | string | 否 | `"png"` / `"jpeg"` / `"webp"`（仅 gpt-image） |
| `moderation` | string | 否 | `"low"` / `"auto"`（仅 gpt-image） |
| `inputFidelity` | string | 否 | `"low"` / `"high"`，参考图保真度（仅 gpt-image） |

新增 provider 只需在 `services/ai/providers/` 加一个文件并自注册，不用改中心 switch。

---

## 4. 提示词与文案

这四段决定生成出什么。改文案就会改变产物，改完建议用 mock provider 跑一遍确认。

### 4.1 `global`

| 字段 | 默认值（节选） | 说明 |
|------|---------------|------|
| `global.prompt` | 「基于参考图中的人物主体，生成微信聊天场景可用的表情包贴纸。要求：单人主体，Q版大头…」 | 所有生成的基础正向提示词 |
| `global.negativePrompt` | 「文字、水印、二维码、品牌logo、复杂背景、多人、写实照片…」 | 负向提示词 |
| `global.styles` | 6 个风格名（扁平插画 / 贴纸 / 3D 卡通 / 日系 Q 版 / 像素风 / 国潮风） | 前端「风格选择」的可选项 |

### 4.2 `emotions`

24 个情绪/动作词，按顺序分配给每一张贴纸（第 N 张贴纸用第 N 个）。

### 4.3 `templates`

| 字段 | 模板 | 说明 |
|------|------|------|
| `templates.sticker` | `{{prompt}}\n当前表情主题与动作：{{emotion}}\n风格：{{style}}\n画面要求：…` | 每张贴纸的提示词模板 |
| `templates.extra` | `{{prompt}}\n{{customPrompt}}\n风格：{{style}}` | 扩展资源（封面/图标/横幅/赞赏图）的模板 |

占位符：`{{prompt}}`（基础提示词）、`{{emotion}}`、`{{style}}`、`{{customPrompt}}`（来自 `extraPrompts`）。

> 生成的 metadata.json 会逐张记录**实际拼好的完整提示词**，所以改模板后仍可追溯每张图当时是怎么来的。

### 4.4 `extraPrompts`

每个扩展资源额外追加的 `{{customPrompt}}`，按 key 覆盖：

| key | 对应资源 |
|-----|---------|
| `cover` | 封面图 |
| `icon` | 聊天面板图标 |
| `banner` | 详情页横幅 |
| `rewardGuide` | 赞赏引导图（仅微信） |
| `rewardThanks` | 赞赏答谢图（仅微信） |

### 4.5 `promptPresets`

多套提示词预设，与「提示词自定义」**互补**：最终提示词 = 预设内容 + 自定义内容（可只填其一），由前端拼接后提交。默认内置 6 套：日常聊天 / 职场吐槽 / 萌宠拟人 / 情侣互动 / 节日祝福 / 沙雕搞怪。

| 字段 | 说明 |
|------|------|
| `id` | 唯一标识，用于下拉框选中项 |
| `name` | 展示名 |
| `prompt` | 选中后作为基础提示词，拼接到自定义提示词**之前** |

`/api/config` 与 `POST /api/generate/prompt` 都只回传可选项，**不替用户随机选择**。整体替换：在 `prompt-config.json` 写 `promptPresets` 即完全覆盖默认 6 套。

---

## 5. 环境变量（`.env`）

| 变量 | 必填 | 默认值 | 说明 |
|------|------|--------|------|
| `API_TOKEN` | 推荐 | `""` | API Token 认证，亦兼作邀请码。**留空 = 关闭鉴权** |
| `JWT_SECRET` | 推荐 | 随机生成 | 生产环境**必须**固定，否则重启后所有 token 失效 |
| `ADMIN_PASSWORD` | 推荐 | 自动生成 | 首个管理员账户密码（不设则每次启动随机生成并打印到日志） |
| `ADMIN_EMAIL` | 否 | `admin@easysticker.app` | 首个管理员邮箱 |
| `AI_<PROVIDER_ID>_API_KEY` | 推荐 | — | 各提供商密钥，如 `AI_SEEDREAM_API_KEY`、`AI_OPENAI_API_KEY`。优先于配置文件 |
| `PORT` | 否 | `3000` | 服务端口 |
| `DATA_DIR` | 否 | `data` | 数据存储目录 |
| `LOG_LEVEL` | 否 | `info` | 日志级别 |
| `NODE_ENV` | 否 | `development` | 公网部署改 `production` |
| `RATE_LIMIT_MAX` | 否 | `30` | 每分钟每 IP 最大请求数 |
| `DAILY_QUOTA_MAX` | 否 | `100` | 登录用户每日生成次数 |
| `DAILY_QUOTA_ANONYMOUS_MAX` | 否 | `10` | 匿名用户每日生成次数（e2e / 压测时调大） |
| `CORS_ALLOW_ORIGIN` | 否 | 同源 | 允许跨域的单域名白名单 |
| `DISABLE_AUTH` | 否 | — | 设为真值强制关闭鉴权（仅开发/测试） |
| `BASE_URL` | 否 | — | 外部访问地址，用于密码重置链接 |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` / `SMTP_FROM` | 否 | `587` | 密码重置邮件。不配则关闭邮件功能 |

> `.env.example` 是完整的变量清单模板，新加变量请同步更新它。

---

## 6. 运行时生成的文件（后台可改，不在 `prompt-config.json`）

有些配置由运行期产生、可在管理后台修改，它们**不在** `prompt-config.json` 里：

| 文件 | 内容 | 改法 |
|------|------|------|
| `data/alerts-config.json` | 告警规则、Webhook、通知间隔、监控保留天数 | 后台「设置」标签页 |
| `data/alerts-history.json` | 告警历史（含已确认/已解决状态） | 后台告警列表 |
| `data/maintenance.json` | 保留期策略生效起点（**不要手改**） | 由 `retention.ts` 自动写入 |
| `data/users.json` | 用户与密码哈希 | 后台「用户」标签页 |
| `data/monitoring/*.jsonl` | 请求/系统/磁盘指标，按天分文件 | 自动 |
| `data/uploads/.owners.jsonl` | 素材归属索引（`assetId → owner`，追加写） | 自动（硬删账号清理散图时用到） |

完整的 HTTP 接口清单一律以 `/docs`（Swagger UI）与 `src/routes/*.ts` 为准。
