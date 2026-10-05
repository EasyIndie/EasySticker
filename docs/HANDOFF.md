# 会话接力说明（Handoff）

> 新会话开局：读本文档 + `docs/architecture.md`，即可接续推进。

## 项目
EasySticker — 开源自托管的 AI 表情包生成工具（微信/Telegram/WhatsApp）。
Fastify + TypeScript 后端，Vite + TypeScript 前端（构建为 `public/js/*` IIFE），Sharp 图片处理，SSE 进度流。

## 当前状态
- 前端 P5 迁移已全部完成：旧单体 `public/app.js` / `public/admin.js` 已删除，迁入 `web/src/` TS，构建为 `public/js/{auth,preview,generator-api,ui,app,admin}.js` 六个 IIFE，由 `public/index.html` 与 `public/admin.html` 分别加载。
- 生图统一为 **OpenAI 兼容 Images API**：仅保留 `mock` / `openai` 两个 provider 文件，删除 `doubao` / `hf` / `http` / `picsum` / `managedHttp` 与本地 ComfyUI 适配；豆包 Seedream 走 `variant: "generic"`（`/images/generations` + `image` 字段传参考图）。
- **密钥只放 `.env`**（`AI_<PROVIDER_ID>_API_KEY`），环境变量优先于 `prompt-config.json`，`/api/config` 与后台均不回显。
- **配置精简**：`prompt-config.default.json` 为必需基线（缺失/非法即启动报错）；`prompt-config.json` 只写与默认不同的字段。
- **启动自动读 `.env`**：`src/server.ts` 的 `loadEnvFile()`（不覆盖已有环境变量）。优先级：真实环境变量 > `.env` > `prompt-config.json` 的 `server.*` > 代码默认值。
- **单资源重生成**：`POST /api/generate/resource`（`src/services/generate/single.ts`），按 `target`（贴纸索引 / 扩展资源 key）只重生成一张；扩展资源「单张失败不中断整包」；`mode="edit"` + `sourceAssetId` + `instruction` 已预留二次编辑能力。
- **静态资源豁免限流**：`/api/assets/:id` 与 `/api/packs/:id/download` 既豁免鉴权（`<img>`/`<a>` 带不了头），也不计入 API 频率限制（否则一次结果几十张图并发加载会触发 429）。
- `npm test` 全绿：typecheck + web:typecheck + build + vitest（当前 **92** 条，11 个文件）
- `BASE_URL=http://localhost:3000 npm run test:e2e` **37/37** 通过

## 必读文档
1. `docs/architecture.md` —— 目标架构 + 模块边界 + P1–P6 迁移清单（先读这个）
2. `git log --oneline` —— 看最近提交

## 下一步：P1–P6 后端/架构收尾
- P1：auth 路由仍用 Fastify JSON schema（未迁到 shared/contracts zod）；未加 `/v1` 前缀；未引入 openapi-typescript。
- P2：`server.ts` 已组合根注入；`app.ts` 尚未拆成 security/monitoring/static/routes 多个 plugin。
- P3：后端未按 `modules/` 重排；`flow.ts` 未拆 pipeline 步骤。
- P4：AssetStore 已仓储化；User/Usage/Monitor 仍是工厂返回类型，Pack 存储未仓储化。
- P6：dependency-cruiser / ESLint 边界、契约测试、changesets、CI workflow 均未做。
- 遗留小项：usage 成功率恒 100%、`usageStore`/`monitorStore` 同步 I/O（appendFileSync）、智能提示词是空壳（`getPromptTemplate` 未分析参考图）。
- 可选：把 `web/src/app.ts` 进一步拆细；用 `dist-web` 替换 `public` 静态目录。

## 新会话开场命令
```bash
npm test                           # 确认基线绿（typecheck + web:typecheck + build + vitest）
npm run web:build                  # 重新生成 public/js/{auth,preview,generator-api,ui,app,admin}.js
# 起服务（端口默认 3000，见 .env 的 PORT / prompt-config.default.json 的 server.port）：
npm run build && node dist/server.js &
BASE_URL=http://localhost:3000 npm run test:e2e   # 37/37
```
> chromium 已通过 `npx playwright install chromium` 装好；若换机器需重装。

## 关键文件索引
- `public/js/{auth,preview,generator-api,ui,app,admin}.js` —— P5 切片构建产物（由 `web/vite.*.config.ts` 生成，勿手改）
- `web/src/app.ts` —— 主站 controller（platform/config/校验/持久化/history/生成编排/单资源重生成/UX），构建为 `public/js/app.js`
- `web/src/features/admin.ts` —— 管理后台（含 AI 提供商配置面板），构建为 `public/js/admin.js`
- `web/src/features/preview.ts` —— 贴图/额外资源/下载/导出信息/metadata 确认卡 + `window._preview` 桥接（依赖经 `configure` 注入）
- `web/src/features/auth.ts` / `ui.ts` —— auth DOM 控制器 / UI 工具
- `web/src/api/` —— 类型化 API 客户端（client / auth / generate / sse / generate-stream）
- `web/src/api/sse.ts` —— 纯 SSE 解析器（`test/sseParser.test.ts` 覆盖）
- `web/src/store/auth.ts` —— auth 单一状态源（localStorage + 跨标签页同步）
- `web/vite.*.config.ts` —— 将各 entry 构建为 IIFE 的独立配置
- `src/shared/contracts.ts` —— 前后端共享 zod 契约（含 `resourceSchema` 单资源重生成）
- `src/services/generate/single.ts` —— 单资源重生成（贴纸 / 扩展资源 / 编辑）
- `src/services/generate/extras.ts` —— 微信扩展资源生成（单张失败不中断整包）
- `src/lib/deps.ts` —— AppDeps 依赖容器
- `src/server.ts` —— 组合根（含 `.env` 自动加载）
- `src/services/ai/registry.ts` —— AI Provider 注册表（新增 provider 只需自注册）
- `src/lib/envFile.ts` —— `.env` 安全读写（后台写 Key 用）
