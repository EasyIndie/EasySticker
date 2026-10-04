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
- **资产仓储 seam**：`AssetStore` 接口 + `createFileAssetStore(dataDir)` 默认实现，注入到服务；未来可换对象存储。
- **typecheck 门禁**：`npm run typecheck`（`tsc --noEmit`）已接入 `npm test`，当前 0 错误。

---

## 4. 待迁移（按优先级）

### P1 契约（进行中）
- [ ] 所有路由统一从 `shared/contracts` 引用 schema（auth 仍用 Fastify JSON schema，需迁移到 zod）。
- [ ] API 加 `/v1` 前缀，旧 `/api/*` 保留为兼容别名（标记 deprecated）。
- [ ] 引入 OpenAPI 类型生成（`openapi-typescript`），前端 TS 化后共享类型。

### P2 组合根（消灭服务定位器）
- [ ] `server.ts` 建容器，构造注入 `userStore`/`usageStore`/`monitorStore` 等。
- [ ] 去掉 `app.decorate("xxx")` 与 `app.xxx` 的隐式依赖。
- [ ] `app.ts` 拆为多个 plugin（security、monitoring、static、routes）。

### P3 模块化后端
- [ ] 按 `modules/` 重排目录（见 §5）。
- [ ] `flow.ts` 拆为 pipeline 步骤。
- [ ] 平台规则策略化（preset 携带 `strategy`，消除散落的 `isWeChat`）。

### P4 存储仓储化（进行中）
- [x] `AssetStore` 接口 + 文件实现（`lib/assets.ts`）。
- [ ] `UserRepository` / `UsageRepository` / `MonitorRepository` 命名接口（当前用工厂返回类型，已够用）。
- [ ] Pack 存储仓储化。

### P5 前端模块化（进行中）
- [x] Vite + TypeScript 工具链（`vite.config.ts`、`web/`）。
- [x] 类型化 API 客户端（`web/src/api/`，消费 `src/shared/contracts`）。
- [ ] 将 `public/app.js` 按 feature 垂直切片迁移（auth → preview → generator），每搬一块删一块旧代码。
- [ ] 迁移完成后用 `dist-web` 替换 `public` 静态目录。

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
  api/          # 类型化 client（由契约生成）
  store/        # 单一状态源
  components/
  features/     # auth / generator / import / preview / history / admin
```

---

## 6. 验证「互不影响」的护栏

1. **依赖方向**：`infrastructure → application`、`routes → domain 实现` 等反向依赖在 CI 直接报红。
2. **契约测试**：改 schema 时前后端同时感知，不靠口头约定。
3. **三层测试**：单元（domain/pipeline 单步）→ 集成（provider/repo/exporter）→ E2E（关键用户旅程）。
4. **单一组合根**：模块只通过 `index.ts` 导出 public API，禁止深路径 import。
