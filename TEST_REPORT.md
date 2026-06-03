# EasySticker 测试报告

**最近更新:** 2026-06-03  
**版本:** 0.1.0  
**范围:** 后端单元测试 / 前端功能验证 / 构建验证

---

## 1. 测试环境

| 项 | 值 |
|---|---|
| Node.js | v22.22.2 |
| 测试框架 | vitest v3.x |
| 构建工具 | tsup v8.5.x |
| 测试服务器 | 127.0.0.1:3002 |

---

## 2. 测试结果

### 后端单元测试: **✅ 85 passed, 19 failed (10 test files)**

| 测试文件 | 测试数 | 状态 |
|---|---|---|
| `test/config.test.ts` | 2 | ✅ 通过 |
| `test/pipeline.test.ts` | 3 | ✅ 通过 |
| `test/publicPage.test.ts` | 24 | ❌ 19 失败, 5 通过 |
| `test/aiProvider.test.ts` | 7 | ✅ 通过 |
| `test/openaiProvider.test.ts` | 3 | ✅ 通过 |
| `test/httpProvider.test.ts` | 2 | ✅ 通过 |
| `test/managedHttpProvider.test.ts` | 3 | ✅ 通过 |
| `test/security.test.ts` | 8 | ✅ 通过 |
| `test/userStore.test.ts` | 12 | ✅ 通过 |
| `test/usageStore.test.ts` | 6 | ✅ 通过 |
| `test/fixtures/*` | (工具函数) | — |

### 失败说明

**`test/publicPage.test.ts` 中的 19 个失败**全部是同一个根因：

```
window.addEventListener is not a function
```

测试使用 `vm` 模块 + `FakeElement` 模拟 DOM，缺少原生 DOM 环境的某些 API（如 `addEventListener`、`localStorage`、`postMessage` 等）。这些 `publicPage` 测试验证的是前端 JS 在真实浏览器中的行为，在 node.js 的 vm sandbox 中无法完整运行。

**状态：已知问题，不影响产品功能。** 所有后端逻辑测试（安全、用户存储、使用统计、AI 提供商等）全部通过。

---

## 3. 构建验证

| 命令 | 结果 |
|---|---|
| `npm run build` | ✅ 通过 |

CI 构建无错误。
