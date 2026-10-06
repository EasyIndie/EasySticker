# 本地开发指南

> 面向改代码的人：环境、命令、目录、测试与约定。部署与运维看 [operations.md](operations.md)，
> 架构与设计取舍看 [architecture.md](architecture.md)。

---

## 1. 环境准备

- **Node.js 20+**（开发机实测 Node 24 也可；CI 与 Docker 用 Node 20）
- npm（随 Node 附带）

```bash
git clone https://github.com/EasyIndie/EasySticker.git
cd EasySticker
npm install
cp .env.example .env        # 本地开发可原样使用：默认 development + Mock 模式，能直接跑起来
```

要用真实模型再配置 AI 提供商，见 [README §配置 AI 提供商](../README.md#3-配置-ai-提供商可选)
与 [configuration-reference.md](configuration-reference.md)。

---

## 2. 常用命令

| 命令 | 作用 |
|------|------|
| `npm run dev` | 后端开发服务：`tsup --watch` 编译 + `node --watch` 重启（http://localhost:3000/） |
| `npm run web:dev` | 前端开发服务：Vite（http://localhost:5173/） |
| `npm run build` | 编译后端（tsup → `dist/`） |
| `npm run web:build` | 编译全部前端切片（vite → `public/js/*`）并写入 HTML 内容哈希 |
| `npm run web:version` | 只重算内容哈希（`scripts/version-assets.mjs`） |
| `npm test` | typecheck + web typecheck + build + vitest（提交前必跑） |
| `npm run test:e2e` | Playwright 端到端 |
| `npm run setup` | 交互式 AI 配置向导 |
| `npm run gc` | 数据目录巡检（默认只体检；`--apply` 才执行） |
| `npm run repair-pack` | 修复历史包（见 [operations.md §3.4](operations.md#34-修复历史包)） |

### 编辑器 / AI 工具：pi 本地指令

仓库自带 `.pi/extensions/dev-commands.ts`，在 pi 会话里注册了两个指令（详见 [`.pi/README.md`](../.pi/README.md)）：

| 指令 | 等价命令 | 说明 |
|------|---------|------|
| `/dev` | `npm run dev` | 后端开发服务 |
| `/web` | `npm run web:dev` | 前端开发服务 |

都支持 `start` / `stop` / `restart` / `status` / `logs`，默认 `start`。服务后台常驻，
PID 与日志在 `.pi/run/`（已 gitignore）。

---

## 3. 目录结构

### 后端（`src/`）

```
server.ts              组合根：装配依赖、启动、定时采样与 GC 调度
app.ts                 插件编排：安全 / 监控 hook / 静态资源与缓存 / 路由注册
shared/contracts.ts    前后端共享 zod 契约（请求体 / 响应形状的唯一事实源）
routes/                auth / admin / assets / packs / uploads / generate / config
services/
  ai/                  provider 接口 + 注册表 + providers/{mock,openai}
  generate/            flow（整套编排）/ single / extras / import / restore / reference / convert / promptConfig
  pack/service.ts      包清单读写、现场打包、删除、列举
  platform/presets.ts  平台规则（尺寸 / 数量 / 字段可见性）
  maintenance/         gc / scheduler / retention
lib/                   assets / assetOwners / zip / owner / security
                       userStore / usageStore / monitorStore / alertEngine / envFile / deps
cli/gc.ts              npm run gc 入口
```

### 前端（`web/src/`）

```
*-entry.ts            七个 IIFE 入口：auth / preview / generator-api / ui / app / admin / theme
app.ts                主站 controller
api/                  client / auth / generate / generate-stream / sse / request / clientId / admin-stream
store/auth.ts         auth 单一状态源（localStorage + 跨标签页同步）
features/             auth / preview / ui / admin / charts
```

> 独立 IIFE 之间**没有共享模块作用域**，用 `window._xxx` + `configure()` 注入依赖，
> 而不是 ES import。这是刻意取舍，见 [history.md §5](history.md#5-前端切片迁移p5)。

---

## 4. 测试

### 单元 / 集成（vitest，`test/*.test.ts`）

```bash
npm test                    # 提交前必跑：typecheck + build + vitest
npx vitest run test/gc.test.ts   # 只跑某个文件
```

- 契约测试看 `test/httpCaching.test.ts`、`test/rateLimit.test.ts` 这类"守住纪律"的用例：
  它们不测业务，而是防止某条规则被无意破坏（缓存头、限流豁免）。
- 后台鉴权用**真实 JWT**：测试里 `app.jwt.sign(...)` 的账号必须先在注入的 `userStore` 里
  注册，否则会被"账号停用/删除即失效"的钩子挡下 —— 这是有意行为。

### 端到端（Playwright，`test/e2e/*.spec.ts`）

```bash
npx playwright install chromium   # 首次
npm run test:e2e
```

`playwright.config.ts` 会在需要时自动起一个专用服务端，并设置：

- `DISABLE_AUTH=1`：**必需**。当一个实例首次启动、`data/` 为空时，服务端会把管理员密码当作邀请 token
  自动开启 API 鉴权，于是匿名的 `/api/packs` 会返回 401、前端弹出登录框并遮挡页面，测试全部阻塞。
- **开发模式**（不加 `NODE_ENV=production`）：生产模式下 `mock` provider 会被隐藏
  （避免误用假模型），而 e2e 正需要 `mock` 跳过真实生图。
- `RATE_LIMIT_MAX=600`、`DAILY_QUOTA_ANONYMOUS_MAX=500`：否则几十秒内的上百个请求会撞 429。

若复用已有服务端，请用同样的条件启动，再指定 `BASE_URL`：

```bash
DISABLE_AUTH=1 RATE_LIMIT_MAX=600 DAILY_QUOTA_ANONYMOUS_MAX=500 node dist/server.js &
BASE_URL=http://localhost:3000 npm run test:e2e
```

> ⚠️ 别直接对着你的**生产数据目录**跑 e2e —— 它会真的创建 / 删除包。用临时 `DATA_DIR` 最稳妥：
> `DISABLE_AUTH=1 DATA_DIR=/tmp/es-e2e PORT=3010 ... node dist/server.js`。

---

## 5. 构建与内容哈希

- 后端：`npm run build`（tsup，CJS 产物到 `dist/`）。
- 前端：七个切片分别由 `web/vite.*.config.ts` 打成 IIFE 到 `public/js/`；
  `npm run web:build` 末尾跑 `scripts/version-assets.mjs`，把 `sha256[:8]` 写进 `public/**/*.html`
  的 `?v=` 查询串。

> 改了前端**务必**跑 `npm run web:build`（会同时刷新哈希）；只跑 vite 不刷新哈希会导致
> 浏览器一直吃旧的 immutable 缓存。详见 [architecture.md §3.2](architecture.md#32-缓存三档策略互相锁死)。

---

## 6. 编码约定

- **提交信息用 Conventional Commits**：`feat(admin): …`、`fix(api): …`、`chore(dev): …`、
  `perf(frontend): …`、`docs: …`。一个提交只做一件事。
- **契约优先**：请求体校验从 `src/shared/contracts.ts`（zod）引用，不要在路由里散写 schema。
- **依赖方向只指向内层**：`routes → services → lib/domain`；领域层不接收 Fastify 实例。
  新增依赖尽量通过 `lib/deps.ts` 的 `AppDeps` 注入，不滥用 `app.decorate()`。
- **加配置项 / 环境变量**：同步更新 `prompt-config.default.json`、`.env.example`
  与 [configuration-reference.md](configuration-reference.md)。
- **改用户可见功能 / 配置 / 清理策略 / metadata**：同步更新对应的"活文档"，
  分工见 [docs/README.md](README.md)。

跑一遍就绪检查：

```bash
npm test && npm run docs:check
```
