# 会话接力说明（Handoff）

> **内部产物**，不在公开文档索引的主路径上。新会话开局：读本文 + [../architecture.md](../architecture.md) + [../README.md](../README.md)。
> 文档分工见 [../README.md](../README.md)（文档索引）。

## 项目

EasySticker —— 开源自托管的 AI 表情包生成工具（微信 / Telegram / WhatsApp）。
Fastify + TypeScript 后端，Vite + TypeScript 前端（构建为 `public/js/*` IIFE），Sharp 图片处理，SSE 进度流。

## 当前状态

- **前端切片**：旧的 `public/app.js` / `public/admin.js` 已删除，迁入 `web/src/`，
  构建为七个 IIFE（`auth` / `preview` / `generator-api` / `ui` / `app` / `admin` / `theme`）。
- **生图统一为 OpenAI 兼容 Images API**：只剩 `mock` / `openai` 两个 provider 实现，
  豆包 Seedream 走 `variant: "generic"`。**参考图不再只能上传**：`POST /api/generate/reference` 可文生图，
  也可传 `referenceImageAssetId`（主底图）+ `additionalReferenceImageAssetIds`（附加参考图，最多 3 张）生成（图生图）。
- **密钥只放 `.env`**（`AI_<PROVIDER_ID>_API_KEY`），环境变量优先于 `prompt-config.json`，接口不回显。
- **包只存清单、ZIP 按需现打**；GC 每 6 小时巡检；保留期默认 30 天且**不追溯既往**。
- **包归属（owner）**：`GET /api/packs` 只返回自己的包；删包 / 还原要求 owner 匹配或管理员。
  另有素材归属索引 `data/uploads/.owners.jsonl`，供硬删账号时清理散图。
- **账号**：单管理员模型，管理员账号受保护（不能停用 / 删除）；停用或删除后其 JWT **立即失效**。
  管理员限流走独立桶（`admin:<ip>`，600 次/分），不受普通 30 次/分影响。
- **metadata schema `easysticker-pack@0.3`**：`files[]` 记录逐张名称 / 尺寸 / 角色 / 提示词 / 风格，
  reference 原图入包，可完整还原生成现场。详见 [../pack-format.md](../pack-format.md)。
- **静态资源三档缓存**：素材 immutable 长缓存、HTML `no-cache`、带内容哈希的 JS/CSS immutable
  （哈希由 `npm run web:build` 自动写入 HTML）。
- **后台**：仪表盘走 SSE；统计页为按分钟聚合的图表；支持批量删包 + 立即回收素材、用户软 / 硬删除。
- **部署**：除源码构建外，发布预构建镜像 `ghcr.io/easyindie/easysticker`（CI 见 `.github/workflows/docker.yml`），
  支持免源码部署。
- **测试基线**：**以 `npm test` / `npm run test:e2e` 的输出为准，不在本文件写死条数**
  （写法见 [../development.md](../development.md)）。

## 必读

1. [../README.md](../README.md)（文档索引）—— 哪份文档该在什么时候改
2. [../architecture.md](../architecture.md) —— 模块边界 + 已落地决策 + 待办（P1–P6）
3. `git log --oneline -20` —— 最近做了什么

## 新会话开场命令

```bash
npm test                                          # 基线应全绿
npm run docs:check                                # 文档链接 / 锚点
npm run web:build                                 # 重建前端 + 刷新 HTML 内容哈希
# e2e：用临时数据目录 + 开发模式 + 关闭鉴权（理由见 docs/development.md §4）
DISABLE_AUTH=1 DATA_DIR=/tmp/es-e2e PORT=3010 \
  RATE_LIMIT_MAX=600 DAILY_QUOTA_ANONYMOUS_MAX=500 node dist/server.js &
BASE_URL=http://localhost:3010 npm run test:e2e
```

> 三个环境变量缺一不可：`DISABLE_AUTH`（否则空 data 目录首次启动会开鉴权，`/api/packs` 401
> 并弹登录框）、开发模式（否则生产模式隐藏 `mock` provider）、放宽限流/配额（否则撞 429）。
> 若换机器，先 `npx playwright install chromium`。

## 下一步

**1. 后端架构收尾（P1–P6）** —— 详见 [../architecture.md](../architecture.md) §4，摘要：

- P1：auth 路由仍用 Fastify JSON schema（未迁 zod）；未加 `/v1` 前缀；未引入 `openapi-typescript`。
- P2：`app.ts` 尚未拆成 security / monitoring / static / routes 多个 plugin。
- P3：后端未按 `modules/` 重排；`flow.ts` 未拆 pipeline 步骤。
- P4：User / Usage / Monitor 仍是工厂返回类型（Asset 与 Pack 已收敛）。
- P6：契约测试、changesets 已由 `CHANGELOG.md` 部分替代；dependency-cruiser 未做；CI 已起步（`.github/workflows/`）。

**2. 已知小项**

- usage 成功率已按今日 / 累计分别统计（不再恒 100%），但 `action` 仍混计 generate/upload。
- `usageStore` / `monitorStore` 用 `appendFileSync`（实测 0.117ms/次，异步化有丢数据风险，暂不改）。
- 智能提示词是空壳（`getPromptTemplate` 未真正分析参考图）。
- `ai.referenceMode = "assetId"` 已无 provider 消费，要么实现要么清掉。

## 关键文件索引

**后端**

| 路径 | 说明 |
|------|------|
| `src/server.ts` | 组合根（含 `.env` 自动加载、定时采样与 GC 调度） |
| `src/app.ts` | 插件编排（安全 / 监控 hook / 静态资源与缓存策略 / 路由注册） |
| `src/lib/deps.ts` | `AppDeps` 依赖容器 |
| `src/shared/contracts.ts` | 前后端共享 zod 契约 |
| `src/routes/*.ts` | auth / admin / assets / packs / uploads / generate / config |
| `src/services/ai/registry.ts` | Provider 注册表（新增 provider 只需自注册） |
| `src/services/generate/` | `flow` 编排 · `single` 单资源 · `extras` 扩展资源 · `restore` 还原 · `reference` 文生参考图 · `convert` · `promptConfig` |
| `src/services/pack/service.ts` | 包清单读写 / 现场打包 / 删除 / 列举 |
| `src/services/maintenance/` | `gc.ts` 回收 · `scheduler.ts` 定时 · `retention.ts` 保留期 |
| `src/lib/assets.ts` · `src/lib/assetOwners.ts` | 素材存储（O(1)）· 素材归属索引 |
| `src/lib/zip.ts` | 只用 `node:zlib` 的 ZIP 读取 |
| `src/cli/gc.ts` | `npm run gc` 入口 |

**前端**

| 路径 | 说明 |
|------|------|
| `web/src/app.ts` | 主站 controller（platform / 校验 / 持久化 / history / 生成编排 / 单资源编辑） |
| `web/src/features/preview.ts` | 预览卡片 / 扩展资源 / 下载 / metadata 卡 + `window._preview` 桥接 |
| `web/src/features/admin.ts` | 管理后台（AI 配置、存储、用户、统计、SSE 仪表盘） |
| `web/src/features/charts.ts` | 零依赖 SVG 图表（统计页） |
| `web/src/features/{auth,ui}.ts` | auth DOM 控制器 / UI 工具 |
| `web/src/api/` | client · auth · generate · generate-stream · sse · request · clientId · admin-stream |
| `web/src/store/auth.ts` | auth 单一状态源（localStorage + 跨标签页同步） |
| `web/vite.*.config.ts` | 各 entry 的 IIFE 构建配置 |
| `scripts/version-assets.mjs` | 构建期内容哈希写入 HTML |

**其他**

| 路径 | 说明 |
|------|------|
| `scripts/setup.mjs` | `npm run setup` 交互式配置向导 |
| `scripts/repair-pack.mjs` | `npm run repair-pack` 修复历史包 |
| `scripts/check-docs.mjs` | `npm run docs:check` 文档链接 / 锚点校验 |
| `Dockerfile` · `docker-compose.yml` · `docker-compose.image.yml` | 源码构建 · 免源码部署 |
| `test/e2e/helpers.ts` | e2e 公共工具（含 429 退避的 `apiRequest`） |
