# 认证模块重构 — 实施记录

> 2026-06-03 已完成实施。本文档从「设计方案」更新为「实施记录」。

## 现状

两套登录逻辑已统一：

| 维度 | 首页 (app.js) | 管理后台 (admin.js) |
|------|------|------|
| Token 存储 | `localStorage.easysticker_token` | `localStorage.easysticker_token`（同一 key） |
| 用户信息 | `localStorage.easysticker_user` | `localStorage.easysticker_user`（同一 key） |
| 登录 | API 登录 → localStorage | API 登录 → localStorage（同一位置） |
| 退出标记 | `sessionStorage.admin_logged_out` | `sessionStorage.admin_logged_out` |
| checkAuth | 直接从 localStorage 读 | 直接从 localStorage 读 |

### 变更要点

1. **admin.js token 改为 localStorage**（之前用 sessionStorage.admin_token）
2. **移除 admin.js 的 checkAuth 自动恢复逻辑**（从 session→local 的 hack）
3. **退出标记统一**：`sessionStorage.admin_logged_out`，登录时清掉
4. **退出只清 localStorage**，不再清 sessionStorage 旧 key
5. **首页增加 `storage` 事件监听**：其他标签页登录/退出实时感知

### 状态流转

```
初始状态：localStorage 无 token
         → checkAuth 检查 → 无 token → 显示登录页

登录：写入 localStorage.easysticker_token
    → 清除 sessionStorage.admin_logged_out
    → showMainSection

退出：移除 localStorage 中 token/user
    → 设 sessionStorage.admin_logged_out = "1"
    → 切回登录页

其他标签页退出：localStorage token 被删
   → 首页通过 storage 事件感知
   → 自动切换回未登录态
```

### 文件变更

- `public/admin.js` — token 读写全部 localStorage，checkAuth 精简
- `public/app.js` — 增加 `window.addEventListener('storage')` 跨标签页同步
