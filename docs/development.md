# 开发指南

> 本文负责**本地开发**：环境、命令、目录、测试与编码约定。
> 架构与设计取舍见 [架构设计](architecture.md)，部署见 [部署指南](deployment.md)。

---

## 1. 环境准备

- **Node.js 20+**（CI 与 Docker 使用 Node 20；更高版本通常也可）
- npm（随 Node 附带）

```bash
git clone https://github.com/EasyIndie/EasySticker.git
cd EasySticker
npm install
cp .env.example .env      # 本地开发可原样使用：development + Mock 模式
```

不配置任何 AI 提供商也能启动。需要真实模型时，按 [配置参考 · AI](configuration-reference.md#3-ai-生成)
设置 `ai.defaultProvider` 与 `AI_<PROVIDER_ID>_API_KEY`。

---

## 2. 常用命令

| 命令 | 作用 |
|------|------|
| `npm run dev` | 后端开发服务：`tsup --watch` 编译 + `node --watch` 重启（http://localhost:3000/） |
| `npm run web:dev` | 前端开发服务：Vite（http://localhost:5173/） |
| `npm run build` | 编译后端（tsup → `dist/`） |
| `npm run web:build` | 编译全部前端切片（vite → `public/js/*`）并刷新 HTML 内容哈希 |
| `npm run web:version` | 只重算内容哈希 |
| `npm test` | typecheck + 前端 typecheck + build + vitest（提交前必跑） |
| `npm run test:e2e` | Playwright 端到端 |
| `npm run docs:check` | 校验文档相对链接与锚点 |
| `npm run setup` | 交互式 AI 配置向导 |
| `npm run gc` | 数据目录巡检（默认只体检，`--apply` 才执行） |
| `npm run repair-pack` | 修复历史包（见 [运维手册](operations.md#34-修复历史包)） |

提交前至少跑：

```bash
npm test && npm run docs:check
```

---

## 3. 目录结构

### 后端 `src/`

```
server.ts              组合根：装配依赖、启动、定时采样与 GC 调度
app.ts                 插件编排：安全 / 监控 hook / 静态资源与缓存 / 路由注册
shared/contracts.ts    前后端共享 zod 契约（请求体 / 响应形状的唯一事实源）
routes/                auth / admin / assets / packs / uploads / generate / config
services/
  ai/                  provider 接口 + 注册表 + providers/{mock,openai}
  generate/            flow（整套编排）/ single / extras / import / restore
                       reference / convert / promptConfig / promptBuilder
  pack/service.ts      包清单读写、现场打包、删除、列举
  platform/presets.ts  平台规则（数量 / 尺寸 / 格式 / 扩展资源）
  maintenance/         gc / scheduler / retention
lib/                   assets / assetOwners / zip / owner / security
                       userStore / usageStore / monitorStore / alertEngine / deps
cli/gc.ts              npm run gc 入口
```

### 前端 `web/src/`

生产页面由 6 个 Vite IIFE 切片组成：

| 切片 | 入口 | 产物 |
|------|------|------|
| auth | `auth-entry.ts` | `public/js/auth.js` |
| preview | `preview-entry.ts` | `public/js/preview.js` |
| generator-api | `generator-api-entry.ts` | `public/js/generator-api.js` |
| ui | `ui-entry.ts` | `public/js/ui.js` |
| app | `app-entry.ts` | `public/js/app.js` |
| admin | `admin-entry.ts` | `public/js/admin.js` |

另有 `public/js/theme.js`：**手写并提交到仓库**，不是 Vite 构建产物。它在样式表之前同步执行，
负责首屏主题（避免闪烁）与静态页面主题切换。

```
web/src/
  *-entry.ts            6 个 IIFE 入口
  app.ts                主站 controller
  api/                  client / auth / generate / generate-stream / sse
                        request / clientId / admin-stream
  store/auth.ts         auth 单一状态源（localStorage + 跨标签页同步）
  features/             auth / preview / ui / admin / charts
  main.ts               Vite 开发页（web/index.html）入口，不参与生产构建
```

> 独立 IIFE 之间**没有共享模块作用域**，用 `window._xxx` + `configure()` 注入依赖，
> 而不是 ES import。这是刻意取舍，见 [历史记录 §5](history.md#5-前端切片迁移p5)。

---

## 4. 测试

### 单元 / 集成（Vitest，`test/*.test.ts`）

```bash
npm test                           # typecheck + build + 全量 vitest
npx vitest run test/gc.test.ts     # 只跑某个文件
```

- `test/httpCaching.test.ts`、`test/rateLimit.test.ts` 这类是「守住纪律」的契约测试：
  不测业务，而是防止缓存头、限流豁免等规则被无意破坏。
- 后台鉴权测试使用**真实 JWT**：`app.jwt.sign(...)` 的账号必须先在注入的 `userStore` 注册，
  否则会被「账号停用 / 删除即失效」的钩子挡下。这是有意行为。

### 端到端（Playwright，`test/e2e/*.spec.ts`）

```bash
npx playwright install chromium   # 首次
npm run test:e2e
```

`playwright.config.ts` 会在需要时自动起一个专用服务端，并设置：

- `DISABLE_AUTH=1`：**必需**。空 `data/` 首次启动会把管理员密码当作邀请 token 自动开启鉴权，
  匿名 `/api/packs` 返回 401、前端弹出登录框，测试会全部阻塞。
- **开发模式**（不设置 `NODE_ENV=production`）：生产模式会隐藏 `mock` provider，
  而 e2e 正需要 `mock` 跳过真实生图。
- `RATE_LIMIT_MAX=600`、`DAILY_QUOTA_ANONYMOUS_MAX=500`：否则几十秒内的上百个请求会撞 429。

复用已有服务端时：

```bash
DISABLE_AUTH=1 DATA_DIR=/tmp/es-e2e PORT=3010 \
  RATE_LIMIT_MAX=600 DAILY_QUOTA_ANONYMOUS_MAX=500 node dist/server.js &
BASE_URL=http://localhost:3010 npm run test:e2e
```

> ⚠️ 不要对着生产数据目录跑 e2e，它会真的创建 / 删除包。用临时 `DATA_DIR`。

---

## 5. 构建与内容哈希

- 后端：`npm run build`（tsup，CJS 产物到 `dist/`）。
- 前端：6 个切片分别由 `web/vite.*.config.ts` 打成 IIFE 到 `public/js/`；
  `npm run web:build` 末尾执行 `scripts/version-assets.mjs`，把 `sha256[:8]` 写进
  `public/**/*.html` 的 `?v=` 查询串。

> 改了前端**务必**执行 `npm run web:build`（会同时刷新哈希）。只跑 vite 不刷新哈希，
> 浏览器会一直使用旧的 immutable 缓存。详见 [架构设计 · 缓存](architecture.md#56-缓存策略)。

---

## 6. 编码约定

- **提交信息用 Conventional Commits**：`feat(admin): …`、`fix(api): …`、`docs: …`。
  一个提交只做一件事，描述说清「为什么」。
- **契约优先**：请求体校验从 `src/shared/contracts.ts`（zod）引用，不要在路由里散写 schema。
- **依赖方向只指向内层**：`routes → services → lib/domain`；领域层不接收 Fastify 实例。
  新依赖尽量通过 `lib/deps.ts` 的 `AppDeps` 注入，不滥用 `app.decorate()`。
- **加配置项 / 环境变量**：同步更新 `prompt-config.default.json`、`.env.example`
  与 [配置参考](configuration-reference.md)。
- **改用户可见功能 / 部署 / 清理 / metadata**：按 [文档中心](README.md#维护规则) 的分工更新活文档。

---

## 7. 可选：pi 本地指令

仓库自带 `.pi/extensions/dev-commands.ts`，在 pi 会话中提供 `/dev` 指令（细节见 [`.pi/README.md`](../.pi/README.md)）：

| 指令 | 等价命令 | 说明 |
|------|---------|------|
| `/dev` | `npm run dev` | 后端开发服务，默认仅本机 |
| `/dev lan` | `HOST=0.0.0.0 npm run dev` | 允许局域网访问 |
| `/dev status` / `logs` / `restart` / `stop` | — | 管理后台常驻进程 |

PID、日志与访问模式在 `.pi/run/`（已 gitignore）。不使用 pi 可完全忽略本节。
