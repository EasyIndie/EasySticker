# EasySticker 架构与演进路线

> 本文记录目标架构、模块边界与分阶段迁移计划，用于指导长期迭代时保持功能解耦。
> 原则：**模块化单体（modular monolith）+ 契约优先 + 组合根装配 + 前端组件化**。不引入微服务。

---

## 1. 目标分层

```
interfaces（HTTP 层）     routes：只做参数校验/鉴权/序列化，不写业务
        │ 调用
application（用例层）     generation.service / import.service / auth.service
        │ 依赖接口（Port）
domain（领域/策略）       ai 接口+registry、platform 策略、pipeline steps、config schema
        ▲
infrastructure（适配器）  providers 实现、exporters、repositories、mailer、monitor
```

依赖方向只指向内层；`infrastructure` 实现 `domain` 定义的接口，由 `server.ts`（组合根）装配。

---

## 2. 模块边界（bounded contexts）

| 模块 | 职责 | 当前状态 |
|------|------|---------|
| `auth` | 注册/登录/JWT/邮箱验证 | route+store 混在一起，待抽 service |
| `generation` | 生成编排、任务、SSE 进度 | `flow.ts` 单体，待拆 pipeline |
| `ai` | Provider 接口 + 注册表 + 实现 | ✅ 已注册表化 |
| `platform` | 平台 preset + 校验策略 | 数据驱动，逻辑待策略化 |
| `pack` | ZIP 打包 | 待按平台拆 exporter |
| `assets` | 图片/文件存储 | 待仓储化 |
| `usage` / `monitoring` | 统计 / 监控告警 | 直接读写文件，待仓储化 |
| `config` | 配置加载/校验 | 待 zod schema 化 |
| `shared` | 契约、错误、通用工具 | ✅ 契约已起步（`shared/contracts.ts`） |

---

## 3. 已落地

- **AI Provider 注册表**：`src/services/ai/registry.ts`。新增 provider = 新增一个文件并自注册，不再改 `index.ts` 的 if/else。
- **共享契约**：`src/shared/contracts.ts`。生成/打包请求的 zod schema 与推断类型收敛于此。
- **配置深合并**：`promptConfig.ts` 对 `server.security` 深合并，避免子字段整体丢失。
- **组合根 + 依赖注入**：`server.ts` 装配全部依赖，`src/lib/deps.ts` 定义 `AppDeps`；路由/服务不再 `app.decorate("xxx")`，彻底移除 `declare module "fastify"` 的 `FastifyInstance` 增强。
- **领域层去 Fastify 化**：`findAssetFile`/`buildZipPack`/`generateAssetsAndPack` 等不再接收 `FastifyInstance`。
- **平台策略化**：`PlatformPreset.supportsExtras` 取代散落的 `isWeChat` 判断；微信额外资源生成抽到 `generate/extras.ts`。
- **单资源重生成**：`generate/single.ts` + `POST /api/generate/resource`。按 `target`（`sticker.index` 或 `extra.key`）只重生成一张，复用统一提示词模板、尺寸与平台校验；契约预留 `mode="edit"` + `sourceAssetId` + `instruction`，为二次编辑/优化打底。扩展资源改为「单张失败不中断整包」：`extras.ts` 记录 `failures` 并发出发带 `error` 的 `extra` 事件，前端将该卡片渲染为可点击重试的错误态。
- **资产仓储 seam**：`AssetStore` 接口 + `createFileAssetStore(dataDir)` 默认实现，注入到服务；未来可换对象存储。
- **静态资源豁免**：`isPublicRoute` 放行 `/api/assets/:id` 与 `/api/packs/:id/download`（前缀匹配）。它们既豁免鉴权（`<img>`/`<a>` 无法携带 `Authorization`），也不计入 API 频率限制，避免结果页并发加载几十张图触发 429。
- **typecheck 门禁**：`npm run typecheck`（`tsc --noEmit`）已接入 `npm test`，当前 0 错误。

---

## 4. 待迁移（按优先级）

### P1 契约（进行中）
- [ ] 所有路由统一从 `shared/contracts` 引用 schema（auth 仍用 Fastify JSON schema，需迁移到 zod）。
- [ ] API 加 `/v1` 前缀，旧 `/api/*` 保留为兼容别名（标记 deprecated）。
- [ ] 引入 OpenAPI 类型生成（`openapi-typescript`），前端 TS 化后共享类型。

### P2 组合根（消灭服务定位器）
- [x] `server.ts` 建容器，构造注入 `userStore`/`usageStore`/`monitorStore` 等（`lib/deps.ts` 定义 `AppDeps`）。
- [x] 去掉 `app.decorate("xxx")` 与 `app.xxx` 的隐式依赖（已移除 `declare module "fastify"` 的 `FastifyInstance` 增强）。
- [ ] `app.ts` 拆为多个 plugin（security、monitoring、static、routes）。

### P3 模块化后端
- [ ] 按 `modules/` 重排目录（见 §5）。
- [ ] `flow.ts` 拆为 pipeline 步骤。
- [x] 平台规则策略化（`PlatformPreset.supportsExtras` 取代散落的 `isWeChat`；扩展资源生成抽到 `generate/extras.ts`）。

### P4 存储仓储化（进行中）
- [x] `AssetStore` 接口 + 文件实现（`lib/assets.ts`）。
- [ ] `UserRepository` / `UsageRepository` / `MonitorRepository` 命名接口（当前用工厂返回类型，已够用）。
- [ ] Pack 存储仓储化。

### P5 前端模块化（已完成）
- [x] Vite + TypeScript 工具链（`vite.config.ts`、`web/vite.*.config.ts`），构建产物落在 `public/js/`。
- [x] 类型化 API 客户端（`web/src/api/`，消费 `src/shared/contracts`）与 auth 单一状态源（`web/src/store/auth.ts`）。
- [x] 旧单体 `public/app.js`（约 3300 行）/ `public/admin.js`（约 775 行）已删除，拆为六个 IIFE 切片：
  - `auth` —— `api/auth` + `store/auth` + `features/auth`（→ `public/js/auth.js`）
  - `preview` —— 贴图/额外资源/下载/导出确认卡（→ `public/js/preview.js`，依赖经 `configure` 注入）
  - `generator-api` —— SSE 客户端（`api/sse.ts` 纯解析器 + `api/generate-stream.ts`，→ `public/js/generator-api.js`）
  - `ui` —— 状态/通知/进度（→ `public/js/ui.js`，暴露 `window._ui`）
  - `app` —— 主站 controller：platform/config 同步、校验、持久化、history、生成编排、单资源重生成、UX（→ `public/js/app.js`）
  - `admin` —— 管理后台（内联 onclick 改为 `data-action` 事件委托以过 CSP，→ `public/js/admin.js`）
- [ ] 迁移完成后用 `dist-web` 替换 `public` 静态目录（可选收尾）。

### P6 护栏
- [ ] dependency-cruiser / ESLint import 边界，CI 强制依赖方向。
- [ ] 契约测试（基于 `shared/contracts`）。
- [ ] changesets 发版与 changelog。

---

## 5. 目标目录结构（后端）

```
src/
  server.ts                 # 组合根：装配并启动
  app.ts                    # 只做插件编排
  shared/
    contracts.ts            # zod schema + 类型
    errors.ts
    config-schema.ts
  modules/
    auth/
    generation/
      generation.routes.ts
      generation.service.ts
      pipeline/
    ai/
      provider.ts           # 接口
      registry.ts
      providers/
    platform/
    pack/
      exporters/
    assets/
    usage/
    monitoring/
    config/
```

前端：

```
web/src/
  main.ts
  auth-entry.ts          # auth 独立入口（构建为 public/js/auth.js）
  preview-entry.ts       # preview 独立入口（构建为 public/js/preview.js）
  generator-api-entry.ts # 生成网络/SSE 客户端入口（构建为 public/js/generator-api.js）
  ui-entry.ts            # UI 工具入口（构建为 public/js/ui.js）
  app-entry.ts           # 主站 controller 入口（构建为 public/js/app.js）
  api/                   # 类型化 client（由契约生成）：client / auth / generate / sse / generate-stream
  store/                 # 单一状态源：auth.ts
  components/
  features/              # auth.ts、preview.ts、ui.ts + app.ts（剩余 controller）
```

---

## 6. 验证「互不影响」的护栏

1. **依赖方向**：`infrastructure → application`、`routes → domain 实现` 等反向依赖在 CI 直接报红。
2. **契约测试**：改 schema 时前后端同时感知，不靠口头约定。
3. **三层测试**：单元（domain/pipeline 单步）→ 集成（provider/repo/exporter）→ E2E（关键用户旅程）。
4. **单一组合根**：模块只通过 `index.ts` 导出 public API，禁止深路径 import。
