# EasySticker 测试报告

**最近更新:** 2026-06-03
**版本:** 0.1.0
**范围:** 后端单元测试 / 前端 Playwright E2E / 构建验证

---

## 1. 测试环境

| 项 | 值 |
|---|---|
| Node.js | v22+ |
| 单元测试框架 | vitest v3.x |
| E2E 框架 | Playwright v1.60 |
| 构建工具 | tsup v8.x |
| 测试服务器 | 127.0.0.1:3002 |

---

## 2. 测试结果

### 后端单元测试（vitest，9 个测试文件）

| 测试文件 | 覆盖内容 |
|---|---|
| `test/config.test.ts` | 配置加载与合并 |
| `test/pipeline.test.ts` | 生成全流程 |
| `test/aiProvider.test.ts` | AI Provider 工厂与分发 |
| `test/openaiProvider.test.ts` | OpenAI 提供商 |
| `test/httpProvider.test.ts` | 通用 HTTP 提供商 |
| `test/managedHttpProvider.test.ts` | 自动启停的 HTTP 提供商 |
| `test/security.test.ts` | 认证 / 限流 / 配额 |
| `test/userStore.test.ts` | 用户存储与密码哈希 |
| `test/usageStore.test.ts` | 使用量统计 |
| `test/fixtures/*` | 测试工具函数 |

### 前端 E2E（Playwright，`test/e2e/`）

| 测试文件 | 覆盖内容 |
|---|---|
| `test/e2e/home.spec.ts` | 首页渲染与导航 |
| `test/e2e/auth.spec.ts` | 登录 / 注册流程 |
| `test/e2e/ai-flow.spec.ts` | AI 生成流程 |
| `test/e2e/import-flow.spec.ts` | 导入已有图片流程 |
| `test/e2e/admin.spec.ts` | 管理后台 |

> 注：早期用 `vm` 模块模拟 DOM 的 `test/publicPage.test.ts` 已移除（该方案在 Node sandbox 中缺少 `addEventListener`/`localStorage` 等浏览器 API），前端行为改由 Playwright 真实浏览器 E2E 覆盖。

---

## 3. 构建验证

| 命令 | 结果 |
|---|---|
| `npm run build` | ✅ 通过 |

CI 构建无错误。
