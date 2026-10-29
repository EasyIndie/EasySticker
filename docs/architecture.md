# 架构设计

> 本文描述**当前架构**：分层、模块边界、关键数据流与已落地的设计决策。
> 后续演进计划见 [路线图](roadmap.md)；历史改造记录见 [history.md](history.md)。

---

## 1. 设计原则

- **模块化单体**：一个进程、一个部署单元，按领域分模块，不引入微服务。
- **契约优先**：请求 / 响应 schema 集中在 `src/shared/contracts.ts`（zod）。
- **组合根装配**：`src/server.ts` 创建依赖，`src/lib/deps.ts` 定义 `AppDeps`，
  路由与服务不通过 `app.decorate()` 取依赖。
- **前端垂直切片**：按功能拆成独立 IIFE，各页面只加载自己需要的部分。
- **代码是事实来源**：配置默认值看 JSON，HTTP 契约看 zod / Swagger，本文只解释结构与理由。

---

## 2. 分层与依赖

```
interfaces（HTTP 层）     routes：参数校验 / 鉴权 / 序列化，不写业务
        │ 调用
application（用例层）     generate / import / restore / pack / auth
        │ 依赖接口（Port）
domain（领域 / 策略）     ai 接口 + registry、platform preset、config schema、契约
        ▲
infrastructure（适配器）  providers 实现、fileAssetStore、mailer、monitorStore
```

依赖方向只指向内层。`infrastructure` 实现 `domain` 定义的接口，由组合根装配。

---

## 3. 模块边界

| 模块 | 职责 | 位置 |
|------|------|------|
| `auth` | 注册 / 登录 / JWT / 邮箱验证 | `routes/auth.ts` + `lib/security.ts` + `lib/userStore.ts` |
| `generation` | 生成编排、任务、SSE 进度 | `services/generate/flow.ts` 及同目录拆分文件 |
| `ai` | Provider 接口、注册表、实现 | `services/ai/` |
| `platform` | 平台 preset 与校验策略 | `services/platform/` |
| `pack` | 包清单、现场打包、删除、列举 | `services/pack/service.ts` |
| `assets` | 素材存储与查找 | `lib/assets.ts` + `lib/assetOwners.ts` |
| `usage` / `monitoring` | 统计、指标与告警 | `lib/usageStore.ts`、`lib/monitorStore.ts`、`lib/alertEngine.ts` |
| `config` | 配置加载 / 校验 / 深合并 | `services/generate/promptConfig.ts` |
| `shared` | 契约、类型、通用工具 | `shared/contracts.ts` |
| `maintenance` | GC / 保留期 / 调度 | `services/maintenance/` |

---

## 4. 关键数据流

### 4.1 AI 生成

```
POST /api/generate/start
  → flow.generateAssetsAndPack()
      → promptBuilder 拼接提示词
      → ai provider 逐张生成
      → convert 转平台尺寸 / 格式
      → 扩展资源（仅微信）
      → createPack 写清单
  ← GET /api/generate/stream（SSE 推送进度）
```

要点：

- 数量先按平台 preset 收敛到 `[minCount, maxCount]`。
- 情绪按顺序逐张分配，不做随机。
- 未选风格时回退到 `global.styles[0]`，不会把「默认」写进提示词。
- 单张失败不阻断整包；扩展资源失败只让对应卡片进入可重试状态。
- 已成功的图片即使后续失败也保留在预览区，只有一张都没成功才回到错误占位。

### 4.2 导入

```
POST /api/generate/import       （批量图片）
POST /api/generate/import-pack  （本站导出的 ZIP）
  → 读取 multipart / metadata
  → Sharp 居中、等比缩放、补透明边、转平台格式
  → 微信补齐封面 / 图标（横幅与赞赏图需显式提供）
  → createPack
```

`presetId` 从 URL query 读取，因为 multipart 下 `req.body` 为空。
早期只读 `req.body.presetId` 会静默回落到微信，导致 Telegram / WhatsApp 导入被「至少 8 张」拒绝。

### 4.3 预览、编辑与重建

- 单张重生成：`POST /api/generate/resource`，按 `target` 只重做一张。
- 编辑图片：`mode="edit"`，以当前图为参考图，把修改要求追加进提示词；
  可再附一张参考图，记入 `editReferenceAssetId` 并纳入 GC 引用。
- 历史版本：每次编辑 / 重生成把上一版写进 `metadata.files[].versions[]`；
  回退只移动当前指针，不新增版本。
- 重建 ZIP：前端带上原 `packId`，服务端命中且归属一致就**原地更新清单**并保留 `createdAt`，
  避免每次编辑都新增一条历史。

### 4.4 下载

```
GET /api/packs/:id/download
  → 读取 PackManifest
  → createPackArchive 边打边发
```

服务端只存素材与几 KB 清单，ZIP 不落盘。下载链接保持稳定。

### 4.5 SSE

两处都使用 `reply.hijack()` + `raw.write()` 手写 SSE，并配 15 秒心跳注释防中间层掐连接：

| 端点 | 用途 | 要点 |
|------|------|------|
| `POST /api/generate/start` → `GET /api/generate/stream` | 生成进度 | `id:` 支持 `Last-Event-ID` 断线续传（有 backlog） |
| `GET /api/admin/monitoring/stream` | 后台实时指标 | 每 5 秒推快照、连上立即推一帧、告警只在内容变化时推 |

前端用 `fetch` + `SseParser`，不用原生 `EventSource`：后者不能携带 `Authorization` 头，
把 JWT 放进 URL 会漏进访问日志。页面隐藏时主动关闭，断线按 1s→30s 指数退避重连。

---

## 5. 关键设计决策

### 5.1 配置与密钥

- `prompt-config.default.json` 是**必需基线**，缺失或非法即启动报错。
- `prompt-config.json` 只写差异，按 section 深合并：
  `providers` 按 id、`global` / `templates` / `extraPrompts` 按 key；
  `emotions` / `promptPresets` 整体替换。
- 优先级：真实环境变量 > `.env` > `prompt-config.json` > 代码默认值。
- 密钥只走 `AI_<PROVIDER_ID>_API_KEY`；`/api/config` 与后台接口都不回显。
- `.env` 由 `lib/envFile.ts` 读写，启动时自动加载且**不覆盖**已有环境变量。

### 5.2 AI Provider

- 注册表模式：新增 provider = 在 `services/ai/providers/` 加一个文件并自注册，不改中心 switch。
- 生图统一为 OpenAI 兼容 Images API，通过 `variant` 切换参数画像：
  - `gpt-image`：OpenAI `gpt-image-1.x`，原生透明底，文生图 / 图生图 / 改图全覆盖；
  - `generic`：任意兼容端点（豆包 Seedream、硅基流动 FLUX 等），参考图放在 `image` 字段。
- 多参考图：generic 把 `image` 传数组，gpt-image 用 `image[]`；只有一张时不走数组，保持单图路径不变。
- 超时会与任务取消 signal 联动，真正 `abort` 底层请求，避免 zombie 请求与重复计费。

### 5.3 提示词体系

- 最终提示词 = 提示词预设 + 自定义（`append`）或仅自定义（`override`）。
- 拼接单一入口：`promptBuilder.ts` 的 `buildStickerPrompt` / `buildExtraPrompt` / `buildReferencePrompt`。
- 结构固定为「内容 → 表情与动作 → 画面风格 → 背景 → 构图 → 负面约束（`Avoid:`）」。
- 风格描述只来自 `global.stylePrompts`；预设不重复写画风。
- 透明背景只写在 `templates.sticker`，不进全局负面，避免误伤封面 / 横幅 / 参考图。
- 提示词平台中立：预设与模板不写死「微信」「240px」；平台差异只体现在尺寸 / 格式 / 扩展资源。
- 13 套预设遵循统一结构：`主体：…；主题：…；动作：…；元素：…`；
  「极简蜡笔」是参数化系列模板的范例（1 个 IP + 1 个模板 + 24 组情绪参数）。

### 5.4 存储与包

- **素材只存一份，ZIP 不落盘**：`uploads/<assetId>.<ext>` + `packs/<packId>.json`。
- 包归属 `owner`：已登录 = 邮箱，未登录 = `client:<前端持久化的 x-client-id>`。
  它与匿名日配额的键不同：配额按 `ip:<req.ip>` 防刷，归属按 `client:<id>` 让未登录用户找回历史。
- `GET /api/packs` 只返回请求者自己的包（管理员返回全部）；删包 / 还原要求 owner 匹配或管理员，
  无归属的历史旧包为兼容而放行。
- `owner` 只进服务端清单，不进 ZIP 的 `metadata.json`（那个会随表情包分发出去）。
- 素材查找 O(1)：按已知扩展名 `statSync` 探测，不扫目录；`ASSET_ID_PATTERN` 白名单挡路径穿越。
- 素材归属索引 `data/uploads/.owners.jsonl`（追加写）支持硬删账号时精确清理散图。

### 5.5 保留期与 GC

- 保留期**不追溯既往**：过期时间 = `max(包创建时间, 策略生效时间) + 保留天数`，
  生效起点记在 `data/maintenance.json`。
- GC 只做可证明安全的回收：压缩旧包、清孤儿素材（须过安全期）、清 `.orig` 备份、按保留期删包。
- 服务端每 6 小时巡检（首次延迟 30 秒），CLI 入口 `npm run gc`，后台「存储」面板同源调用。
- 删除包后立即回收素材，不必等下一次巡检。

### 5.6 缓存策略

| 资源 | 策略 | 理由 |
|------|------|------|
| `/api/assets/:id` | `public, max-age=31536000, immutable` | assetId 内容不可变，写入即定；决定预览区是否每次重传几十张图 |
| HTML / JSON | `no-cache` | 整套方案的地基：只有它总在重新校验，新资源哈希才会被发现 |
| 带 `?v=<哈希>` 的 JS / CSS / 图标 | `immutable` 缓存一年 | 内容变则 URL 变，旧 URL 本来就该命中旧内容 |
| **没带版本号**的静态资源 | 退回 `no-cache` | 可能是外链或遗漏引用，长缓存会变成「永久持有旧文件」的陷阱 |

哈希由 `scripts/version-assets.mjs` 在 `npm run web:build` 时写入 `public/**/*.html`，
取 sha256 前 8 位。`test/httpCaching.test.ts` 会扫描所有 HTML，确保没有遗漏的未版本化引用。

> 踩过的坑：`@fastify/static` 的 `maxAge: "3600"` 会被 `send` 按毫秒解析（= 3.6 秒），
> 要写 `"1h"`；它的 `setHeaders` 会被随后的 `reply.headers()` 覆盖，
> 改 cache-control 必须用 `onSend` 钩子。

### 5.7 安全与隔离

- 鉴权：`API_TOKEN`（机器对机器）+ 用户 JWT；`API_TOKEN` 留空 = 关闭鉴权。
- 停用 / 删除账号后，其已签发的 JWT **立即失效**：全局 `onRequest` 在每次请求校验后回查 `userStore`。
- 只读资源豁免鉴权与限流：`/api/assets/:id` 与 `/api/packs/:id/download`
  （`<img>` / `<a>` 带不了 `Authorization`，结果页并发加载几十张图会撞 429）。
- 限流按路由豁免而非按方法判断，避免把静态资源计入 API 频率。
- 管理员使用独立限流桶 `admin:<ip>`（600 次/分），普通用户与匿名仍按配置额度。
- 管理员账号受保护，不能停用 / 删除（单管理员模型）。
- CSP 为 `script-src 'self'`；后台全部使用 `data-action` 事件委托，无内联脚本。

### 5.8 前端

- 6 个 Vite IIFE 切片：`auth` / `preview` / `generator-api` / `ui` / `app` / `admin`；
  `theme.js` 是手写文件，在样式表前同步执行以避免主题闪烁。
- IIFE 之间用 `window._ui` / `_preview` / `_auth` / `_generatorApi` 桥接，依赖经 `configure()` 注入。
- `currentStickers` 是预览的唯一渲染来源，任何写入都必须带全字段（尤其 `url`）。
- 单资源改动走定点更新：`updatePreviewCard(index)` / `updateExtraAsset(key)` 只替换受影响节点，
  避免整组重绘带来的多余图片请求与长任务。
- 弹窗不做背景模糊：`backdrop-filter` 会强制整个视口重新合成，首次打开多出约 30ms 长任务。
- 编辑后的状态必须回写本地：`applyResourceResult` 同步更新 `lastPackResult` 并持久化，
  否则刷新会退回编辑前的图，再编辑会以旧图为源。
- 还原现场要还原「UI 选项」本身：创建方式、提供商、预设 + 自定义 + `promptMode`、风格与数量。
- 统计页使用零依赖 SVG 图表模块，按容器真实宽度绘制 + `ResizeObserver` 自适应，颜色走 CSS 变量。
- AI 提供商选择器放在第 1 步：它同时决定参考图与整包表情的生成模型。

### 5.9 监控与告警

- 指标采集：请求级每次 API 请求（`/api/assets/*` 排除）、系统级每 10 秒、磁盘每 60 秒，
  按天写 JSONL 到 `data/monitoring/`。
- 请求指标使用 60 个 1 秒环形 slot，由 1 秒定时器持续推进（读快照时也会推进），
  **空闲期窗口同样会过期**，不会冻结在最后一次请求上。
- 告警引擎：阈值 + 持续时长 + 静默期防重复，值回落到阈值即恢复。
- 错误率默认只看 5xx（`serverErrorRate`），4xx 另设 `clientErrorRate` 且默认关闭。
- 错误率规则默认要求窗口内至少 20 个请求（`minSamples`），低流量下不误报。
- 通知走 Webhook（飞书交互卡片 / 通用 JSON）+ 本地日志；触发与恢复各一次；
  提醒间隔取 `max(规则 silenceMs, 全局 notificationInterval)`，`lastNotifiedAt` 持久化。

---

## 6. 扩展点

| 要扩展 | 改哪里 |
|--------|--------|
| 新增 AI 提供商 | `src/services/ai/providers/` 新增实现并自注册；配置 `ai.providers` |
| 新增平台 | `src/services/platform/presets.ts` 增加 preset；前端 `PLATFORM_SPECS` 同步 |
| 新增风格 | `prompt-config.default.json` 的 `global.styles` + `global.stylePrompts` |
| 新增提示词预设 | `prompt-config.default.json` 的 `promptPresets`，按 §5.3 的四字段结构填写 |
| 新增扩展资源 | `extraPrompts` + `services/generate/extras.ts` + 打包角色映射 |
| 新增配置项 | `prompt-config.default.json`、`promptConfig.ts` 类型、配置参考、`.env.example`（如可由环境变量覆盖） |

---

## 7. 已知约束

这些是当前接受的技术债或取舍，不代表缺陷修复优先级：

- `usage` 成功率恒为 100%：失败请求尚未计入。
- `usageStore` / `monitorStore` 使用 `appendFileSync`：实测单次约 0.1ms，异步化会引入崩溃丢数据风险，暂不改。
- 智能提示词并未真正分析参考图：`getPromptTemplate` 只是返回可选的预设列表，不替用户随机选。
- `ai.referenceMode = "assetId"` 已无 provider 消费，仅 `base64` / `url` / `multipart` 有效。
- auth 路由仍使用 Fastify JSON schema，尚未全部迁到共享 zod 契约。
- `app.ts` 仍是单一插件编排文件，尚未拆成 security / monitoring / static / routes 多个 plugin。

具体演进计划见 [路线图](roadmap.md)。
