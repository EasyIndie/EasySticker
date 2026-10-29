# 路线图

> 本文记录**接下来要做什么**。当前实现见 [架构设计](architecture.md)，
> 历史改造见 [history.md](history.md)。标注 `[ ]` 的项都可以认领。

---

## 怎么认领

1. 在 Issue 里说明要做哪一项，避免多人重复；
2. 保持 PR 小而聚焦，一个 PR 只做一件事；
3. 改完同步更新本文（`[ ]` → `[x]`），必要时在 [架构设计](architecture.md) 补设计决策；
4. 提交前跑 `npm test && npm run docs:check`。

---

## P1 契约

- [ ] 所有路由统一从 `shared/contracts.ts` 引用 schema（auth 仍用 Fastify JSON schema）。
- [ ] API 加 `/v1` 前缀，旧 `/api/*` 保留为兼容别名（标记 deprecated）。
- [ ] 引入 `openapi-typescript`，前端共享生成类型。

## P2 组合根

- [x] `server.ts` 建容器，构造注入 store（`lib/deps.ts` 定义 `AppDeps`）。
- [x] 去掉 `app.decorate()` 与 `declare module "fastify"` 增强。
- [ ] `app.ts` 拆为多个 plugin（security / monitoring / static / routes）。

## P3 模块化后端

- [ ] 按 `modules/` 重排目录。
- [ ] `flow.ts` 拆为 pipeline 步骤。
- [x] 平台规则策略化（`PlatformPreset` 取代散落的 `isWeChat`；扩展资源抽到 `generate/extras.ts`）。

## P4 存储仓储化

- [x] `AssetStore` 接口 + 文件实现（`lib/assets.ts`）。
- [ ] `UserRepository` / `UsageRepository` / `MonitorRepository` 命名接口（当前用工厂返回类型，够用）。
- [x] Pack 存储收敛到 `pack/service.ts`（读 / 写清单、打包、删除、列举）。

## P5 前端模块化

- [x] Vite + TypeScript 工具链，产物落 `public/js/`。
- [x] 类型化 API 客户端（`web/src/api/`）+ auth 单一状态源（`web/src/store/auth.ts`）。
- [x] 旧单体删除，拆为独立 IIFE 切片。
- [ ] 用 `dist-web` 替换 `public` 静态目录（可选收尾）。

## P6 护栏

- [ ] dependency-cruiser / ESLint import 边界，CI 强制依赖方向。
- [ ] 契约测试（基于 `shared/contracts`）。
- [ ] changesets 发版（当前用手工维护的 [CHANGELOG](../CHANGELOG.md)）。
- [x] CI workflow（`.github/workflows/ci.yml`：类型 / 单测 / 构建 / 文档链接 + e2e；
      `.github/workflows/docker.yml`：构建并推送 `ghcr.io/easyindie/easysticker`）。

---

## 目标目录结构

后端：

```
src/
  server.ts                 # 组合根：装配并启动
  app.ts                    # 插件编排
  cli/gc.ts                 # GC CLI
  shared/contracts.ts       # zod schema + 类型
  routes/                   # auth / admin / assets / packs / uploads / generate / config
  lib/                      # assets / zip / owner / security / userStore / usageStore
                            # monitorStore / alertEngine / alertNotifier / envFile / deps
  services/
    ai/{provider,registry,providers/*}
    generate/{flow,single,extras,import,restore,convert,promptConfig,promptBuilder}
    pack/service.ts
    platform/presets.ts
    maintenance/{gc,scheduler,retention}
```

前端：

```
web/src/
  *-entry.ts               # 6 个 IIFE 入口（auth / preview / generator-api / ui / app / admin）
  app.ts                   # 主站 controller
  api/                     # client / auth / generate / generate-stream / sse
                           # request / clientId / admin-stream
  store/auth.ts            # 单一状态源
  features/                # auth / preview / ui / admin / charts
```

---

## 验证「互不影响」的护栏

1. **依赖方向**：反向依赖在 CI 直接报红（P6 待做）。
2. **契约测试**：改 schema 时前后端同时感知，不靠口头约定。
3. **三层测试**：单元（domain / pipeline 单步）→ 集成（provider / repo / exporter）→ E2E（关键用户旅程）。
4. **单一组合根**：模块只通过 `index.ts` 导出 public API，禁止深路径 import。
