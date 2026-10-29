# 配置参考

> 本文是配置项与环境的**权威说明**。默认值以 `prompt-config.default.json` 为准，
> 环境变量以 `.env.example` 为准；两者与代码不一致时以代码为准，请顺手修文档。
>
> 怎么部署见 [部署指南](deployment.md)，运行期文件与告警运维见 [运维手册](operations.md)。

---

## 1. 配置机制

### 1.1 优先级

```
真实环境变量  >  .env  >  prompt-config.json  >  prompt-config.default.json
   （最高）                                          （必需基线）
```

| 文件 | 作用 |
|------|------|
| `prompt-config.default.json` | **必需**。内置默认基线，缺失或非法即启动报错 |
| `prompt-config.json` | 可选。只写与默认不同的字段，其余继承默认 |
| `.env` | 可选。适合放密钥；启动时自动加载且**不覆盖**已有环境变量 |

### 1.2 合并规则

以 default 为基线做 section 深合并：

- `providers` 按 provider id 合并；
- `global` / `templates` / `extraPrompts` 按 key 合并；
- `emotions` / `promptPresets` **整体替换**（不是逐项合并）。

因此覆盖文件通常只需几行：

```json
{
  "ai": { "defaultProvider": "seedream" },
  "server": { "security": { "registration": { "mode": "open" } } }
}
```

> 🔐 密钥（API Key、JWT secret）不要写进配置文件，放 `.env`。环境变量优先，`apiKey` 留空即可。

---

## 2. 服务端 `server`

### 2.1 基础

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `host` | string | `"0.0.0.0"` | 监听地址（`HOST` 环境变量优先） |
| `port` | number | `3000` | 监听端口（`PORT` 环境变量优先） |
| `dataDir` | string | `"data"` | 数据存储目录（`DATA_DIR` 环境变量优先） |
| `logLevel` | string | `"info"` | `trace` / `debug` / `info` / `warn` / `error` / `fatal` / `silent` |
| `taskTtlMs` | number | `3600000` | 生成任务在内存中的 TTL（1 小时） |
| `taskGcIntervalMs` | number | `600000` | 过期任务清理间隔（10 分钟） |

### 2.2 安全 server.security

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `apiToken` | string | `""` | API Token（机器间认证），亦兼作邀请码。**留空时鉴权关闭**；仅在首次初始化（`data/` 为空）时会临时用管理员密码作为邀请码。可用 `API_TOKEN` |
| `enableAuth` | boolean | `true` | 仅在 `apiToken` 非空时真正生效。`DISABLE_AUTH=true` 可强制关闭 |
| `jwtSecret` | string | 随机生成 | JWT 签名密钥。生产环境**必须**固定，否则重启后所有 token 失效。可用 `JWT_SECRET` |
| `jwtExpiresIn` | string | `"7d"` | Token 有效期，支持 `"24h"` / `"30d"` 或毫秒数 |
| `trustProxy` | boolean | `false` | 反代场景开启，真实 IP 取自 `X-Forwarded-For` |
| `corsAllowOrigin` | string | 未设置（同源） | 单域名白名单，不设则禁止跨域 |

#### 限流 `rateLimit`

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `maxRequests` | number | `30` | 每窗口最大请求数（`RATE_LIMIT_MAX` 优先） |
| `windowMs` | number | `60000` | 窗口时长（毫秒） |

补充规则：

- 登录 / 注册接口使用独立限流：每 IP 每分钟 5 次。
- **已认证管理员**使用独立且宽松的额度（`admin:<ip>`，600 次/分）：后台一次页面加载 / 切页会
  并发很多请求（图表、表格、设置、SSE），普通额度会误伤。
- **只读资源豁免限流与鉴权**：`/api/assets/:id` 与 `/api/packs/:id/download`。
  `<img>` / `<a>` 无法携带 `Authorization`，且一次结果页会几乎同时加载几十张图。
- 两个「匿名用户标识」不要混淆：**日配额按 IP**（`ip:<req.ip>`），
  **包归属按前端持久化的 `x-client-id`**（`client:<id>`）。前者防刷，后者让未登录用户找回历史。

#### 每日配额 `dailyQuota`

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `maxGenerations` | number | `100` | 登录用户每日生成次数（`DAILY_QUOTA_MAX` 优先） |
| `anonymousMaxGenerations` | number | `10` | 匿名用户每日生成次数（`DAILY_QUOTA_ANONYMOUS_MAX` 优先）。**按 IP 计** |

#### 注册 `registration`

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `mode` | string | `"invite"` | `"open"` 开放注册 / `"invite"` 需邀请码（即 `API_TOKEN`）/ `"closed"` 完全关闭 |

### 2.3 数据清理 server.maintenance

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `gcEnabled` | boolean | `true` | 是否启用定期巡检。关掉则只能手动 `npm run gc` |
| `gcIntervalMs` | number | `21600000` | 巡检间隔（6 小时）。启动后延迟 30 秒跑第一次 |
| `packRetentionDays` | number | `30` | 包保留天数，`0` = 不按时间清理。**非 0 会真的删除历史包** |
| `orphanMinAgeHours` | number | `6` | 孤儿素材安全期。只有「无人引用」**且**「落盘超过这么久」才删 |
| `compactLegacyPacks` | boolean | `true` | 把仅有 `.zip` 的历史包转成清单（素材本来就在 uploads 里） |
| `dropOrigBackups` | boolean | `true` | 删除 `repair-pack` 留下的 `<packId>.zip.orig` |

**保留期不追溯既往**：过期时间 = `max(包创建时间, 策略生效时间) + 保留天数`，
生效时间记在 `data/maintenance.json`。所以「今天才把 `packRetentionDays` 从 0 改成 30」
不会立刻清空历史数据。

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

## 3. AI 生成

### 3.1 基础

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `defaultProvider` | string | `"mock"` | 默认提供商 ID（须存在于 `ai.providers`） |
| `referenceMode` | string | `"base64"` | 参考图传递方式。实际被消费的只有 `base64` / `url` / `multipart`；`assetId` 已无 provider 实现 |
| `publicBaseUrl` | string | `""` | 外网可访问的 base URL，`referenceMode: "url"` 时需要 |

#### 尺寸与调用参数

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `imageSize.width` | number | `1024` | 生成图宽度 |
| `imageSize.height` | number | `1024` | 生成图高度 |
| `settings.timeoutMs` | number | `60000` | 单次调用超时（毫秒）。超时会**真正 abort 底层请求**，避免 zombie 请求与重试叠加 |
| `settings.retryMax` | number | `3` | 失败重试次数 |
| `settings.retryBaseMs` | number | `1000` | 重试基础等待（毫秒，指数退避） |

> 生成尺寸与交付尺寸是两件事：`ai.imageSize` 是**生成**尺寸，交付尺寸由平台 preset 决定
>（微信 240×240 / Telegram ≤512×512 / WhatsApp 512×512 WebP），转换在 `generate/convert.ts`。

### 3.2 提供商 ai.providers

内置三个：`mock`（本地模拟，无需 Key）、`openai`（`variant: "gpt-image"`）、
`seedream`（豆包，`variant: "generic"`）。

每个 provider 支持的字段：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `type` | string | 是 | `"mock"` 或 `"openai"`（生图统一走 OpenAI 兼容 Images API） |
| `name` | string | 是 | 展示名称（前端下拉框） |
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

### 4.1 global

| 字段 | 说明 |
|------|------|
| `global.negativePrompt` | 全局负向提示词（文字、水印、二维码、品牌 logo、复杂背景等）。透明背景属于贴纸专用规则，写在 `templates.sticker` 里，避免污染封面 / 横幅 / 参考图 |
| `global.styles` | 13 个风格名，前端「风格选择」的可选项 |
| `global.stylePrompts` | 风格名 → 详细风格描述（英文关键词 + 要点）。编译时把模板里的 `{{style}}` 展开成它，**风格只在这一处描述一次**，预设不重复写画风 |

内置风格：扁平插画 / 贴纸 / 3D 卡通 / 日系 Q 版 / 像素风 / 国潮风 / 手绘涂鸦 /
水彩风 / 软萌毛绒 / 黏土 3D / 极简线条 / 复古漫画 / 极简蜡笔涂鸦。

### 4.2 emotions

24 个情绪 / 动作词，按顺序分配给每一张贴纸（第 N 张贴纸用第 N 个）。

如果选中的提示词预设自带 `emotions`，则用预设自己的这一组，**覆盖**全局 `emotions`；
未选预设或预设未声明时回退到全局。这样「一个 IP + 一个模板 + N 组情绪参数」的系列预设
可以自我描述，而不污染其它预设。

### 4.3 templates

| 字段 | 说明 |
|------|------|
| `templates.sticker` | 每张贴纸的提示词模板。**背景透明与画面通用规则（1:1、居中 / 完整 / 元素上限）都写在这里**，预设不必重复 |
| `templates.extra` | 扩展资源（封面 / 图标 / 横幅 / 赞赏图）的模板。资源差异（画面类型 / 构图 / 比例）写在 `extraPrompts`，与风格解耦 |

占位符：`{{prompt}}`（基础提示词）、`{{emotion}}`、`{{style}}`、`{{styleName}}`、
`{{customPrompt}}`（来自 `extraPrompts`）。

> `{{style}}` 在编译时会经 `global.stylePrompts` 展开成**详细风格描述**（命中时），
> 未配置映射的风格则回退为风格名本身；`{{styleName}}` 始终是原始风格名。
> 所以「预设里不要写画风」——画风统一交给风格选项。

> 生成的 `metadata.json` 会逐张记录**实际拼好的完整提示词**，改模板后仍可追溯每张图当时是怎么来的。

### 4.4 extraPrompts

每个扩展资源额外追加的 `{{customPrompt}}`，按 key 覆盖：

| key | 对应资源 |
|-----|---------|
| `cover` | 封面图 |
| `icon` | 聊天面板图标 |
| `banner` | 详情页横幅 |
| `rewardGuide` | 赞赏引导图（仅微信） |
| `rewardThanks` | 赞赏答谢图（仅微信） |

### 4.5 promptPresets

多套提示词预设，与「提示词自定义」**互补**：最终提示词 = 预设内容 + 自定义内容（可只填其一），
由前端拼接后提交。默认内置 13 套：日常聊天 / 职场吐槽 / 萌宠拟人 / 情侣互动 / 节日祝福 /
沙雕搞怪 / 校园学习 / 游戏电竞 / 吃货美食 / 运动健身 / 旅行出游 / 暖心治愈 / 极简蜡笔。

| 字段 | 说明 |
|------|------|
| `id` | 唯一标识，用于下拉框选中项 |
| `name` | 展示名 |
| `prompt` | 选中后作为基础提示词，拼接到自定义提示词**之前** |
| `style` | 可选。推荐风格（须是 `global.styles` 中的名字）；选中该预设时前端自动切到该风格 |
| `emotions` | 可选。预设专属情绪 / 动作集；选中该预设时**覆盖**全局 `emotions` |

`/api/config` 与 `POST /api/generate/prompt` 都只回传可选项，**不替用户随机选择**。
整体替换：在 `prompt-config.json` 写 `promptPresets` 即完全覆盖默认 13 套。

#### 预设提示词结构

`prompt` **只写内容，不写画风 / 背景 / 构图**（那些分别由 `global.stylePrompts` 与
`templates.sticker` 统一注入），并统一按下列字段顺序书写：

```
主体：{主体来源与设定}；主题：{主题/场景}；动作：{动作/情绪覆盖}；元素：{道具/辅助元素}。
```

- `主体`：统一以参考图中的主体为准（如「以参考图中的主体为准，保持角色身份与特征一致」）。
- `主题`：这套预设的场景 / 主题。
- `动作`：覆盖的动作或情绪范围（真正逐张使用的是 `emotions` / 预设自带 `emotions`）。
- `元素`：道具 / 辅助元素；通用的「辅助元素不超过 2 个」已在 `templates.sticker` 里，无需重复。

新增预设时按同结构填写即可；`test/promptPresets.test.ts` 会校验字段齐全且顺序一致。

> `minimal-crayon`（极简蜡笔）是「参数化系列模板」的范例：一段统一结构的预设 +
> 24 组带 `眼睛 / 嘴巴 / 手臂 / 姿势 / 辅助 / 文字` 字段的情绪参数，并用 `style` 固定画风。
> **角色主体不写死**——一律以参考图为准，换成猫、人、吉祥物或任意 IP 都能复用。

### 4.6 自定义提示词模式 promptMode

前端「自定义用法」下拉决定自定义文本与预设的关系，通过 `POST /api/generate/start` 的
`promptMode` 传入，并记入 `metadata.json` 的 `generation.promptMode` 供 ZIP / 历史还原：

| 值 | 行为 |
|----|------|
| `append`（默认） | 最终提示词 = 预设 + `\n` + 自定义 |
| `override` | 填了自定义时**忽略预设**，最终提示词 = 自定义 |

> 「覆盖」只影响提示词，不会改变预设自带的 `emotions` / `style`
>（后端仍按 `promptPreset` 取预设参数）。

### 4.7 最终提示词的拼接顺序

所有生成路径都经过 `src/services/generate/promptBuilder.ts`，最终结构固定为
「内容 → 画面约束 → 负面约束」：

```
{prompt}                        ← 预设 + 自定义（前端按 promptMode 拼好）
表情与动作：{emotion}             ← templates.sticker
画面风格：{style}                 ← global.stylePrompts 展开的详细描述
背景：…                          ← templates.sticker
构图：…                          ← templates.sticker
Avoid: {global.negativePrompt}    ← provider 统一追加（openai.ts: buildPrompt）
```

- **贴纸**：`buildStickerPrompt`。
- **扩展资源**：`buildExtraPrompt` = `{{prompt}}` + `extraPrompts[key]` + `画面风格`；
  **不含**贴纸专用的背景 / 构图段。
- **参考图**：`buildReferencePrompt` = 用户描述 + `画面风格`；无风格时不追加以免污染。

未选择风格时（`styles` 为空或占位值「默认」）自动回退到 `global.styles[0]`，
避免把「默认」这种无意义词写进提示词。

---

## 5. 环境变量

| 变量 | 必填 | 默认值 | 说明 |
|------|------|--------|------|
| `API_TOKEN` | 推荐 | `""` | API 认证，亦兼作邀请码。**留空 = 关闭鉴权** |
| `JWT_SECRET` | 推荐 | 随机生成 | 生产环境**必须**固定，否则重启后所有 token 失效 |
| `ADMIN_PASSWORD` | 推荐 | 自动生成 | 首个管理员账户密码（不设则每次启动随机生成并打印到日志） |
| `ADMIN_EMAIL` | 否 | `admin@easysticker.app` | 首个管理员邮箱 |
| `AI_<PROVIDER_ID>_API_KEY` | 推荐 | — | 各提供商密钥，如 `AI_SEEDREAM_API_KEY`、`AI_OPENAI_API_KEY`。优先于配置文件 |
| `HOST` | 否 | `0.0.0.0` | 监听地址，优先级高于 `server.host`。设 `127.0.0.1` 仅本机可访问 |
| `PORT` | 否 | `3000` | 服务端口 |
| `DATA_DIR` | 否 | `data` | 数据存储目录 |
| `LOG_LEVEL` | 否 | `info` | 日志级别 |
| `NODE_ENV` | 否 | `development` | 公网部署改 `production` |
| `RATE_LIMIT_MAX` | 否 | `30` | 每分钟每 IP 最大请求数 |
| `DAILY_QUOTA_MAX` | 否 | `100` | 登录用户每日生成次数 |
| `DAILY_QUOTA_ANONYMOUS_MAX` | 否 | `10` | 匿名用户每日生成次数（e2e / 压测时调大） |
| `CORS_ALLOW_ORIGIN` | 否 | 同源 | 允许跨域的单域名白名单 |
| `DISABLE_AUTH` | 否 | — | 设为真值强制关闭鉴权（仅开发 / 测试） |
| `BASE_URL` | 否 | `http://localhost:<port>` | 外部访问地址，用于密码重置链接 |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` / `SMTP_FROM` | 否 | `587`（端口） | 密码重置邮件。不配则关闭邮件功能，重置链接只打印到日志 |

> `.env.example` 是完整的变量清单模板，新加变量请同步更新它。

---

## 6. 运行时生成的文件

有些配置由运行期产生、可在管理后台修改，它们**不在** `prompt-config.json` 里：

| 文件 | 内容 | 改法 |
|------|------|------|
| `data/alerts-config.json` | 告警规则、Webhook、通知间隔、监控保留天数 | 后台「设置」 |
| `data/alerts-history.json` | 告警历史（含已确认 / 已解决状态） | 后台告警列表 |
| `data/maintenance.json` | 保留期策略生效起点（**不要手改**） | 由 `retention.ts` 自动写入 |
| `data/users.json` | 用户与密码哈希 | 后台「用户」标签页 |
| `data/monitoring/*.jsonl` | 请求 / 系统 / 磁盘指标，按天分文件 | 自动 |
| `data/uploads/.owners.jsonl` | 素材归属索引（`assetId → owner`，追加写） | 自动（硬删账号清理散图时用到） |

### 6.1 告警规则

`data/alerts-config.json` 里每条规则用 `metric` 选指标（后台「设置」可改）：

| `metric` | 含义 | 建议 |
|----------|------|------|
| `serverErrorRate` | 5xx / 总请求（最近 60s） | **默认告警项**，阈值 0.02（2%） |
| `clientErrorRate` | 4xx / 总请求 | 默认关闭；4xx 多为扫描器 / 鉴权 / 校验噪声 |
| `errorRate` | 全部 >=400 / 总请求 | 保留兼容；想同时盯 4xx + 5xx 才用 |
| `cpu.percent` | CPU 使用率 | — |
| `disk.usedMb` | `data/` 目录占用（MB） | — |
| `avgLatencyMs` | 最近一分钟平均延迟 | — |
| `requestsPerMinute` | 最近一分钟请求数 | — |

规则字段：

| 字段 | 说明 |
|------|------|
| `threshold` | 阈值 |
| `duration` | 条件需持续秒数 |
| `silenceMs` | 同一告警的提醒间隔 |
| `enabled` | 是否启用 |
| `minSamples` | 错误率类指标的最小样本量（默认 20），低于该值视为无数据 |

实际提醒间隔取 `max(silenceMs, notificationInterval)`（后者在后台「设置 → 通知最小间隔」配置）；
触发 / 恢复各推送一次。告警消息含出错路由、状态码分布与排查建议。

完整的 HTTP 接口清单一律以 `/docs`（Swagger UI）与 `src/routes/*.ts` 为准。
