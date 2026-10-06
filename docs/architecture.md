# EasySticker 架构与设计决策

> 本文记录**目标架构**、**模块边界**，以及**已落地的关键设计决策**（连同当时的理由）。
> 原则：模块化单体（modular monolith）+ 契约优先 + 组合根装配 + 前端按功能垂直切片。不引入微服务。
>
> 只读的历史改造记录见 [history.md](history.md)；文档分工见 [README.md](README.md)。

---

## 1. 目标分层

```
interfaces（HTTP 层）     routes：只做参数校验/鉴权/序列化，不写业务
        │ 调用
application（用例层）     generate / import / restore / pack / auth
        │ 依赖接口（Port）
domain（领域/策略）       ai 接口+registry、platform preset、config schema、契约
        ▲
infrastructure（适配器）  providers 实现、fileAssetStore、mailer、monitorStore
```

依赖方向只指向内层；`infrastructure` 实现 `domain` 定义的接口，由 `src/server.ts`（组合根）装配。

---

## 2. 模块边界（bounded contexts）

| 模块 | 职责 | 当前状态 |
|------|------|---------|
| `auth` | 注册/登录/JWT/邮箱验证 | route + `lib/security.ts` + `lib/userStore.ts`，待抽 service |
| `generation` | 生成编排、任务、SSE 进度 | `flow.ts` 编排，`single.ts` / `extras.ts` / `restore.ts` / `import.ts` 已拆出 |
| `ai` | Provider 接口 + 注册表 + 实现 | ✅ 已注册表化（`mock` / `openai` 两个实现） |
| `platform` | 平台 preset + 校验策略 | ✅ 数据驱动（`PlatformPreset`），`generate/convert.ts` 做尺寸/格式转换 |
| `pack` | 包清单 + 现场打包 | ✅ `pack/service.ts`：清单落盘、ZIP 按需现打 |
| `assets` | 素材存储 | ✅ `AssetStore` 接口 + `createFileAssetStore`；查找 O(1) |
| `usage` / `monitoring` | 统计 / 监控告警 | 工厂 + JSONL，未做仓储接口（够用） |
| `config` | 配置加载/校验 | `promptConfig.ts` 深合并；路由层仍用 Fastify JSON schema |
| `shared` | 契约、类型、通用工具 | ✅ `shared/contracts.ts`（zod） |
| `maintenance` | GC / 保留期 | ✅ `services/maintenance/{gc,scheduler,retention}.ts` |

---

## 3. 已落地的设计决策

### 3.1 后端

- **AI Provider 注册表**（`services/ai/registry.ts`）：新增 provider = 新增一个文件并自注册，不改中心 switch。生图**统一为 OpenAI 兼容 Images API**，通过 `variant` 切换参数画像（`gpt-image` / `generic`）。
- **密钥只走环境变量**：`AI_<PROVIDER_ID>_API_KEY`。优先级 真实环境变量 > `.env` > `prompt-config.json` > 代码默认。`/api/config` 与后台接口都不回显 Key。`.env` 由 `lib/envFile.ts` 读写，启动时 `loadEnvFile()` 自动加载且**不覆盖**已有环境变量。
- **配置基线必需**：`prompt-config.default.json` 缺失或非法即启动报错；`prompt-config.json` 只写与默认不同的字段，按 section 深合并（`providers` 按 id、`global`/`templates`/`extraPrompts` 按 key、`emotions`/`promptPresets` 整体替换）。
- **组合根 + 依赖注入**：`server.ts` 装配全部依赖，`lib/deps.ts` 定义 `AppDeps`。路由/服务不通过 `app.decorate()` 取依赖，也没有 `declare module "fastify"` 增强。
- **领域层去 Fastify 化**：`findAssetFile` / `createPackArchive` / 生成流水线都不接收 `FastifyInstance`。
- **单资源重生成**（`generate/single.ts` + `POST /api/generate/resource`）：按 `target`（`sticker.index` 或 `extra.key`）只重做一张，复用同一套提示词模板/尺寸/平台校验。前端「编辑图片」用 `mode="edit"`：以**当前这张图**为参考图，把 `instruction` 以「编辑要求：…」追加进提示词，只重做这一张，并把 `sourceAssetId` 写回 metadata 供追溯；还可再附一张参考图（`editReferenceAssetId`，同时记入 metadata 并纳入 GC 引用，避免刚上传就被当孤儿回收）。多图经 `AiGenerateInput.additionalReferenceImages` 下传：generic 变体把 `image` 传数组（实测豆包 Seedream 接受），gpt-image 变体用 `image[]`；**只有一张时不走数组**，单图路径行为不变。
- **扩展资源单张失败不中断整包**：`extras.ts` 记录 `failures` 并照常发带 `error` 的 `extra` 事件，前端把该卡片渲染成可点击重试的错误态。
- **多套提示词预设，与自定义互补**（`flow.ts` + `prompt-config.default.json`）：`promptPresets` 内置 12 套基础提示词（`global.styles` 同为 12 种风格），`/api/config` 与 `POST /api/generate/prompt` 只回传可选项（**不替用户随机选**）；前端用「提示词预设」下拉 + 「提示词自定义」textarea，最终提示词 = 预设 + 自定义（可只填其一），提交前拼接 —— 解决「只能拿到同一段默认提示词、连续多次生成结果雷同」。情绪仍按顺序逐张分配，不做随机。
- **素材查找 O(1)**：`lib/assets.ts` 按已知扩展名 `statSync` 探测，而不是 `readdirSync` 扫目录。后者是 O(目录大小) 的**同步** I/O，挂在 `GET /api/assets/:id`（结果页每张图一个请求）和打包（每包约 30 次）热路径上；实测 333 文件时 0.699ms → 0.023ms，且不随规模退化。同时用 `ASSET_ID_PATTERN` 白名单挡路径穿越。
- **包只存清单，ZIP 按需现打**：`packs/<packId>.json` 存 `PackManifest`（逐张提示词/尺寸/角色），下载时 `createPackArchive` 现场打包、边打边发。消除了「uploads 一份 + ZIP 一份」的双倍占用，也让「单资源重生成 → 重建整包」从搬几 MB 变成写几 KB。旧包（仅 `.zip`）仍可直接流式下载，无需迁移。
- **包归属（owner）**：清单记录 `owner`（已登录 = 邮箱，未登录 = 前端持久化的 `x-client-id`）。注意它与**匿名日配额**用的是不同键：配额按 `ip:<req.ip>` 防刷，归属按 `client:<id>` 让未登录用户找回历史，见 `lib/owner.ts`。`GET /api/packs` 只返回请求者自己的包 —— 无归属的旧包不出现在任何人列表里，避免列出别人的包。`owner` **只进清单，不进 ZIP 的 `metadata.json`**（那个会随表情包分发出去）。删包/还原要求 owner 匹配或管理员。
- **保留期不追溯既往**（`maintenance/retention.ts`）：策略生效起点记在 `data/maintenance.json`，过期时间 = `max(包创建时间, 生效起点) + 保留天数`。所以「今天才把 `packRetentionDays` 从 0 改成 30」不会立刻清空历史数据。
- **GC 只做可证明安全的回收**（`maintenance/gc.ts`）：压缩旧包（缺 `files[]` 或素材不全则跳过）、清孤儿素材（须过安全期）、清 `.orig` 备份、按保留期删包。服务端每 6 小时巡检（`server.maintenance`），CLI 入口 `npm run gc`，后台「存储」面板同源调用。
- **静态资源豁免鉴权与限流**：`isPublicRoute` 放行 `/api/assets/:id` 与 `/api/packs/:id/download`（前缀匹配）。`<img>` / `<a>` 带不了 `Authorization`，且结果页并发加载几十张图会撞 429。
- **限流按路由豁免而非按方法判断**，避免把静态资源计入 API 频率（`test/rateLimit.test.ts` 覆盖）。
- **管理员独立限流桶**：后台一次页面加载 / 切页会并发很多请求（图表、表格、设置、SSE），普通额度会误伤。
  管理员身份已在「停用/删除即失效」钩子里确认，因此单独走 `admin:<ip>` 桶（600 次/分），
  普通用户与匿名仍按配置额度。
- **账号软删 / 硬删**：软删 = `setDisabled`（登录被拒）；硬删 `DELETE /api/admin/users/:email`
  可选 `purge=true`，依次删除名下包（`deletePacksAndReclaim` 回收素材）、用量日志、监控记录，
  以及「上传但从未进包」的散图。**管理员账号受保护**，不能停用/删除（单管理员模型）。
- **停用/删除后 JWT 立即失效**：全局 `onRequest` 钩子在每次请求校验 JWT 后回查 `userStore`，
  用户不存在或被停用即 401 —— 修复了「仅在登录时校验 disabled，旧 token 默认 7 天仍可用」的缺口。
- **素材归属索引 + 定向散图回收**：`lib/assetOwners.ts` 用追加写的 `data/uploads/.owners.jsonl`
  记录 `assetId → owner`（生成/导入/上传经 `withAssetOwner` 包一层即可，各服务无感）。
  `reclaimAssetsByOwner` 据此只删「归属该用户且无人引用」的散图，不误伤他人；GC 顺带压缩索引。
- **文生参考图**（`generate/reference.ts` + `POST /api/generate/reference`）：复用 provider/尺寸配置，
  **不传参考图**即走 text-to-image（gpt-image 走 `/images/generations`，generic 走 `generations` 且不带 `image`），
  结果落盘为 asset，返回值与上传接口一致（`uploadId` / `url`），前端无需区分来源。

### 3.2 缓存（三档策略，互相锁死）

| 资源 | 策略 | 理由 |
|------|------|------|
| `/api/assets/:id` | `public, max-age=31536000, immutable` | assetId 是内容不可变的 nanoid，写入即定、永不覆盖。这条头直接决定预览区会不会每次导航都重传几十张图（修复前 24 张贴纸每次约 1MB，修复后预热即 0 请求） |
| HTML / JSON | `no-cache` | **整套方案的地基**：只有它总在重新校验，新资源哈希才会被发现 |
| 带 `?v=<哈希>` 的 JS/CSS/图标 | `immutable` 缓存一年 | 内容变则 URL 变，旧 URL 本来就该命中旧内容 |
| **没带版本号**的静态资源 | 退回 `no-cache` | 可能是被外链或遗漏的引用，长缓存会变成「永久持有旧文件」的陷阱 |

哈希由 `scripts/version-assets.mjs`（`npm run web:build` 自动跑）写入 `public/**/*.html`，取 sha256 前 8 位。
`test/httpCaching.test.ts` 有一条测试扫描**所有** HTML，确保没有遗漏的未版本化引用 —— 这条纪律一旦被破坏，immutable 就从优化变成事故。

> 踩过的坑：`@fastify/static` 的 `maxAge: "3600"` 会被 `send` 按**毫秒**解析（= 3.6 秒），要写 `"1h"`；
> 它的 `setHeaders` 会被随后的 `reply.headers()` 覆盖，改 cache-control 必须用 `onSend` 钩子。

### 3.3 前端

- **按功能垂直切片，构建为 IIFE**：七个入口构建成 `public/js/{auth,preview,generator-api,ui,app,admin,theme}.js`，分别由对应 HTML 加载。旧的单体 `public/app.js` / `public/admin.js` 已删除。
- **IIFE 之间用 `window._xxx` 桥接**：`window._ui` / `window._preview` / `window._auth` / `window._generatorApi`，依赖经 `configure()` 注入而不是模块 import —— 因为独立 IIFE 之间没有共享模块作用域。
- **管理后台用 `data-action` 事件委托**，不使用内联 `onclick`（CSP `script-src 'self'`）。
- **`currentStickers` 是预览的唯一渲染来源**，任何写入都必须带全字段（尤其 `url`），渲染层同时兜底。
- **单资源改动走定点更新**：`renderPreview` 只能追加卡片，所以早期更新一张图只能 `innerHTML=""` + 整组重绘 —— 24 张贴纸会销毁重建 24 个 `<img>`，实测多出 26 次图片请求与 136ms 长任务。现在 `updatePreviewCard(index)` / `updateExtraAsset(key)` 只替换受影响的那个节点（重测：0 次图片请求、0 长任务）。
- **弹窗不做背景模糊**：`backdrop-filter` 会强制浏览器对弹窗背后的整个视口重新做模糊合成，首次打开多出约 30ms 长任务；换纯色遮罩视觉几乎一致。另外挂载后空闲时空跑一次弹窗，把首次绘制的样式/合成开销前移。
- **编辑后的状态必须回写本地**：`applyResourceResult` 同步更新 `lastPackResult.stickers[index]`，编辑完调 `persistLastPackPayload()` 并就地更新历史记录。否则刷新会退回编辑前的图，**再编辑会以旧图为源、把上一次编辑悄悄丢掉**。
- **前端资源用内容哈希**：见 §3.2。
- **统计页用独立图表模块**（`web/src/features/charts.ts`）：零依赖 SVG，按容器真实宽度绘制 +
  `ResizeObserver` 自适应（不再用 `preserveAspectRatio="none"` 拉伸），带坐标轴/网格/图例/悬浮读数；
  曲线用单调三次插值避免过冲。颜色走 CSS 变量，自动适配亮/暗主题。
- **AI 提供商选择器放在第 1 步**（`#aiProviderField`）：参考图支持 AI 生成后，提供商同时决定「参考图」和「整包表情」的生成，而它原来在第 3 步「配置与信息」里，用户在第 2 步点「AI 生成参考图」时看不到用的哪个模型。现在第 1 步依次是「创建方式 → AI 提供商（仅 AI 模式）→ 目标平台」，选 AI 模式即可确认提供商；「配置与信息」只剩 提示词预设/自定义、风格、数量、元数据。提示词不再「上传后自动填一整套」，而是「提示词预设（下拉，可留空）+ 提示词自定义」，两者拼接后提交。

### 3.4 实时通信（SSE，两处）

两处都用 `reply.hijack()` + `raw.write()` 手写 SSE，并配 15 秒心跳注释防中间层掐连接。

| 端点 | 用途 | 要点 |
|------|------|------|
| `POST /api/generate/start` → `GET /api/generate/stream` | 生成进度逐张推送 | 带 `id:` 支持 `Last-Event-ID` 断线续传（有 backlog） |
| `GET /api/admin/monitoring/stream` | 后台仪表盘实时指标 | 每 5 秒推快照、**连上立即推一帧**、告警只在内容变化时推 |

后台仪表盘原本是 `setInterval(loadDashboard, 15000)`：每个开着的页面每 15 秒发 2 个请求，数据却永远滞后。改成一条长连接后实测 20 秒内 `/api/admin/monitoring` 请求数 **2 → 0**。前端用 `fetch` + `SseParser` 而不是原生 `EventSource` —— 后者不能带 `Authorization` 头，把 JWT 放进 URL 会漏进访问日志。切到别的标签页或页面隐藏时主动 `close()`，断线按 1s→30s 指数退避重连，重连期间退回拉一次 REST 兜底。

### 3.5 监控与告警

- **指标采集**（`lib/monitorStore.ts`）：请求级每次 API 请求（`/api/assets/*` 已排除，否则一次页面加载几十张图会淹没真实调用）、系统级每 10 秒、磁盘每 60 秒，按天写 JSONL 到 `data/monitoring/`。
- **告警引擎**（`lib/alertEngine.ts`）：阈值 + 持续时长 + 10% 回滞解决 + 静默期防重复。默认规则见 [configuration-reference.md](configuration-reference.md)。历史存 `data/alerts-history.json`。
- **通知**：Webhook（飞书机器人格式）+ 本地日志。

---

## 4. 待迁移（按优先级）

### P1 契约
- [ ] 所有路由统一从 `shared/contracts` 引用 schema（auth 仍用 Fastify JSON schema）。
- [ ] API 加 `/v1` 前缀，旧 `/api/*` 保留为兼容别名（标记 deprecated）。
- [ ] 引入 `openapi-typescript`，前端共享生成类型。

### P2 组合根
- [x] `server.ts` 建容器，构造注入 store（`lib/deps.ts` 定义 `AppDeps`）。
- [x] 去掉 `app.decorate()` 与 `declare module "fastify"` 增强。
- [ ] `app.ts` 拆为多个 plugin（security / monitoring / static / routes）。

### P3 模块化后端
- [ ] 按 `modules/` 重排目录（见 §5）。
- [ ] `flow.ts` 拆为 pipeline 步骤。
- [x] 平台规则策略化（`PlatformPreset` 取代散落的 `isWeChat`；扩展资源抽到 `generate/extras.ts`）。

### P4 存储仓储化
- [x] `AssetStore` 接口 + 文件实现（`lib/assets.ts`）。
- [ ] `UserRepository` / `UsageRepository` / `MonitorRepository` 命名接口（当前用工厂返回类型，够用）。
- [x] Pack 存储收敛到 `pack/service.ts`（读/写清单、打包、删除、列举）。

### P5 前端模块化
- [x] Vite + TypeScript 工具链，产物落 `public/js/`。
- [x] 类型化 API 客户端（`web/src/api/`）+ auth 单一状态源（`web/src/store/auth.ts`）。
- [x] 旧单体删除，拆为七个 IIFE 切片。
- [ ] 用 `dist-web` 替换 `public` 静态目录（可选收尾）。

### P6 护栏
- [ ] dependency-cruiser / ESLint import 边界，CI 强制依赖方向。
- [ ] 契约测试（基于 `shared/contracts`）。
- [ ] changesets 发版（当前用手工维护的 [CHANGELOG.md](../CHANGELOG.md)）。
- [x] CI workflow（`.github/workflows/ci.yml`：类型 / 单测 / 构建 / 文档链接 + e2e；
      `.github/workflows/docker.yml`：构建并推送 `ghcr.io/easyindie/easysticker`）。

### 已知小项
- usage 成功率恒 100%（没有把失败计入）。
- `usageStore` / `monitorStore` 用 `appendFileSync`（实测 0.117ms/次，异步化会引入崩溃丢数据的风险，暂不改）。
- 智能提示词仍未真正分析参考图（`getPromptTemplate` 只是随机推荐一套 `promptPresets`）。
- `ai.referenceMode = "assetId"` 已无 provider 消费（仅 base64 / url / multipart 有效）。

---

## 5. 目标目录结构

```
src/
  server.ts                 # 组合根：装配并启动
  app.ts                    # 只做插件编排
  cli/gc.ts                 # GC CLI
  shared/contracts.ts       # zod schema + 类型
  routes/                   # auth / admin / assets / packs / uploads / generate / config
  lib/                      # assets / zip / owner / security / userStore / usageStore
                            # monitorStore / alertEngine / alertNotifier / envFile / deps
  services/
    ai/{provider,registry,providers/*}
    generate/{flow,single,extras,import,restore,convert,promptConfig}
    pack/service.ts
    platform/presets.ts
    maintenance/{gc,scheduler,retention}
```

前端：

```
web/src/
  *-entry.ts               # 七个入口（auth/preview/generator-api/ui/app/admin/main）
  app.ts                   # 主站 controller
  api/                     # client / auth / generate / generate-stream / sse / request
                           # clientId / admin-stream
  store/auth.ts            # 单一状态源
  features/                # auth / preview / ui / admin
```

---

## 6. 验证「互不影响」的护栏

1. **依赖方向**：`infrastructure → application`、`routes → domain 实现` 等反向依赖在 CI 直接报红（P6 待做）。
2. **契约测试**：改 schema 时前后端同时感知，不靠口头约定。
3. **三层测试**：单元（domain/pipeline 单步）→ 集成（provider/repo/exporter）→ E2E（关键用户旅程）。
4. **单一组合根**：模块只通过 `index.ts` 导出 public API，禁止深路径 import。
