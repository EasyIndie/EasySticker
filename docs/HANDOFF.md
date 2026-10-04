# 会话接力说明（Handoff）

> 新会话开局：读本文档 + `docs/architecture.md`，即可接续推进。

## 项目
EasySticker — 开源自托管的 AI 表情包生成工具（微信/Telegram/WhatsApp）。
Fastify + TypeScript 后端，原生 JS 前端，Sharp 图片处理，SSE 进度流。

## 当前状态（截至最近提交）
- 3 个 commit 已推 origin/main：`d011344` / `efb005c` / `ceda15b`
- `npm test` 全绿：typecheck + web:typecheck + build + 80/80 vitest
- 后端架构性改造已完成：契约层、组合根依赖注入、Provider 注册表、平台策略、AssetStore

## 必读文档
1. `docs/architecture.md` —— 目标架构 + 模块边界 + P1–P6 迁移清单（先读这个）
2. `git log --oneline` —— 看最近 3 个 commit 的 message

## 下一步：P5 前端迁移（唯一大块头）
- 目标：把 `public/app.js`（约 3300 行原生 JS）按 feature 垂直切片迁到 `web/src/` TS 模块
- 已就绪的地基：`vite.config.ts` + `web/`（index.html、src/main.ts、src/api/client.ts、src/api/generate.ts）
- 迁移顺序建议：auth → preview → generator → history → admin
- 每搬一块删一块旧代码，用 Playwright e2e 验证

## 新会话开场命令
```bash
npx playwright install chromium   # 装浏览器（当前未装）
npm test                           # 确认基线绿
npm run test:e2e                   # 跑前端 e2e（需先起服务）
```

## 关键文件索引
- `public/app.js` —— 待迁移的旧前端（唯一大单体）
- `web/src/api/` —— 已建的类型化 API 客户端（消费 src/shared/contracts）
- `src/shared/contracts.ts` —— 前后端共享 zod 契约
- `src/lib/deps.ts` —— AppDeps 依赖容器
- `src/server.ts` —— 组合根
- `src/services/ai/registry.ts` —— AI Provider 注册表（新增 provider 只需自注册）

## 遗留小项（低优先级）
- usage 成功率恒 100%（需 usageStore 重构）
- usageStore/monitorStore 同步 I/O（appendFileSync）
- /api/assets 图片请求计入 30/min 限流
- 智能提示词是空壳（getPromptTemplate 未分析参考图）
- P6：dependency-cruiser、契约测试、changesets、CI workflow
