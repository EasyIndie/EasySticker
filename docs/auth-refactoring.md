# 认证模块重构方案

## 现状问题

当前两套独立的登录逻辑：

| | 首页 (app.js) | 管理后台 (admin.js) |
|---|---|---|
| Token 存储 | `localStorage.easysticker_token` | `sessionStorage.admin_token` |
| 用户信息 | `localStorage.easysticker_user` | `sessionStorage.admin_user` |
| 登录 | API 登录 → localStorage | API 登录 → sessionStorage |
| 登出 | 清 localStorage → 迁 session | 清 session + local → 设退出标记 |
| 相互感知 | 无 | admin 从 local 拉 token 做"恢复" |

### 具体问题

1. **两套 storage key** — 首页用 `easysticker_*`，后台用 `admin_*`，不一致
2. **退出不同步** — 首页退出了不清 sessionStorage，后台退出了但 session 标记可能被跳过
3. **入口控制不一致** — 首页关闭时 JS 控制显示，但硬链接 `<a href="/admin.html">` 不受控
4. **token 生命期不同** — localStorage 跨标签页持久化，sessionStorage 同标签页
5. **后台 `checkAuth` 从 local 自动恢复** — 是 hack 而非设计

## 重构方案

### 核心设计：单源真理 (Single Source of Truth)

```
            localStorage (持久化)
                 │
    ┌────────────┴────────────┐
    │                        │
  首页 (app.js)         管理后台 (admin.js)
  读取 localStorage     读取 localStorage
  写入 localStorage     写入 localStorage
```

- **唯一存储位置**: `localStorage`
- **Key**: `easysticker_token` + `easysticker_user`
- **两页读取相同 key，写入相同 key**

### 具体变更

#### 1. 管理后台 token 存储改为 localStorage

```js
// admin.js — 登录
localStorage.setItem("easysticker_token", result.token);
localStorage.setItem("easysticker_user", JSON.stringify(result.user));

// admin.js — API 调用
const token = localStorage.getItem("easysticker_token");

// admin.js — 登出
localStorage.removeItem("easysticker_token");
localStorage.removeItem("easysticker_user");

// 不再使用 sessionStorage 做 token 存储
// sessionStorage 只放退出标记
```

#### 2. 移除 admin.js 的 checkAuth 从 session 恢复逻辑

```js
// 删除从 sessionStorage 拿 token 和从 localStorage 自动恢复的代码
// checkAuth 只做：
//   1. 检查退出标记 → return
//   2. 从 localStorage 拿 token → 有则登录
```

#### 3. 统一退出标记

```js
// 任何地方的退出操作都写入：
sessionStorage.setItem("admin_logged_out", "1");
// 任何地方的登录操作都清除：
sessionStorage.removeItem("admin_logged_out");
```

#### 4. 首页底部"管理后台"链接控制

已有 `hidden` 属性控制，不需要额外改动。

### 边界情况覆盖

| 场景 | 预期行为 |
|------|---------|
| 首页登录 → 点管理后台 | 自动进入（token 在 localStorage） |
| 首页退出 → 点管理后台 | 显示登录页（退出标记 + 无 token） |
| 管理后台退出 → 刷新首页 | 底部链接隐藏，token 无 |
| 管理后台退出 → 点管理后台 | 显示登录页（退出标记） |
| 管理后台登录 → 刷新管理后台 | 自动进入（localStorage 还在） |
| 两个标签页：首页 + 后台 | 登录/退出互相感知（同一 localStorage） |
| 关闭浏览器 → 打开 | token 持久化，未退出则仍登录 |
| 管理后台登录 → 点首页退出 → 刷新管理后台 | 显示登录页 |

### 风险

- localStorage 跨标签页共享，logout 时两页同时感知 token 被移除
- 但 JS 不会自动监听到 localStorage 变化。首页通过 `storage` 事件可以监听，后台不需监听（退出时跳转）
- **建议**: 如果首页想实时感知其他标签页的退出，加 `window.addEventListener('storage', handler)`

## 实施计划

1. 修改 `admin.js`：token 存储改为 localStorage，简化 checkAuth
2. 修改 `app.js`：统一退出标记设置（已有），确认 login/logout 使用相同 key
3. 验证所有场景（上面 6 个）
