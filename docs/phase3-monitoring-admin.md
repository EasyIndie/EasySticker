# 监控告警系统 + 管理后台 — 项目现状

> 本文档记录已实现的监控告警和管理后台功能。
>
> ⚠️ **路径已过时：** 文中提到的 `public/admin.js` 已迁至 `web/src/features/admin.ts`（构建为 `public/js/admin.js`）。

## 已实现的功能

### 后端监控告警（完整实现）

#### 监控指标采集 (`src/lib/monitorStore.ts`)

| 指标类型 | 采样频率 | 存储位置 |
|----------|---------|---------|
| 请求级 | 每次 API 请求 | `data/monitoring/request/{YYYY-MM-DD}.jsonl` |
| 系统级 (CPU/内存) | 每 10 秒 | `data/monitoring/system/{YYYY-MM-DD}.jsonl` |
| 磁盘使用 | 每 60 秒 | `data/monitoring/disk/{YYYY-MM-DD}.jsonl` |

**启动方式**：Fastify onResponse hook 采集请求指标，server.ts 中 setInterval 定时采样。

#### 告警引擎 (`src/lib/alertEngine.ts` + `src/lib/alertNotifier.ts`)

**告警生命周期**：正常→触发（超阈值持续 N 秒）→活跃→解决（低于阈值 + 10% 回滞）

**默认告警规则**（配置保存在 `data/alerts-config.json`）：

| 规则 | 指标 | 阈值 | 持续时长 | 静默期 | 默认启用 |
|------|------|------|---------|--------|---------|
| CPU 过高 | cpu.percent | > 80% | 60s | 5min | ✅ |
| 错误率过高 | errorRate | > 5% | 120s | 10min | ✅ |
| 磁盘空间不足 | disk.usedMb | > 500MB | 60s | 10min | ✅ |
| 响应延迟过高 | avgLatencyMs | > 5000ms | 120s | 10min | ✅ |
| 请求量激增 | requestsPerMinute | > 100 | 60s | 5min | ❌ |

**通知渠道**：Webhook (飞书机器人格式) + 本地日志。支持静默期防重复。

**告警历史**存储在 `data/alerts-history.json`。

### 管理后台前端 (`/admin.html`)

**页面结构**：
- 登录界面（邮箱 + 密码，与首页共享 localStorage token）
- 仪表盘 Tab（CPU/内存/磁盘环形仪表盘、今日统计、告警列表）
- 用户管理 Tab（用户列表、搜索、禁用/启用）
- 使用统计 Tab（7 日/30 日趋势折线图、活跃用户排行、成功/失败分布）
- 设置 Tab（告警规则编辑、Webhook URL、保留天数）

**前端技术**：原生 JS + SVG 图表（不依赖第三方图表库）

### 管理后台 API

所有 API 挂载 `/api/admin/*`，使用 requireAdmin 中间件保护。

| API | 方法 | 用途 |
|-----|------|------|
| `/api/admin/monitoring` | GET | 系统监控总览 + 近期趋势 |
| `/api/admin/monitoring/metrics` | GET | 原始指标查询（分页） |
| `/api/admin/alerts/rules` | GET/PUT | 告警规则列表/更新 |
| `/api/admin/alerts/history` | GET | 告警历史（可选过滤活跃状态） |
| `/api/admin/alerts/:id/ack` | POST | 确认告警 |
| `/api/admin/settings` | GET/PUT | 管理后台设置 |
| `/api/admin/users` | GET | 用户列表 |
| `/api/admin/users/:email/toggle` | POST | 启用/禁用用户 |

## 相关文件

| 文件 | 用途 |
|------|------|
| `src/lib/monitorStore.ts` | 指标采集、聚合、JSONL 持久化、环形缓冲区 |
| `src/lib/alertEngine.ts` | 告警规则引擎：阈值判断、状态追踪、频率控制 |
| `src/lib/alertNotifier.ts` | 告警通知：Webhook 推送 + 本地日志 |
| `src/routes/admin.ts` | 管理后台 API 路由 |
| `src/app.ts` | onRequest/onResponse hook 采集起点/耗时 |
| `src/server.ts` | 初始化定时器（采样 + 告警评估 + 清理） |
| `public/admin.html` | 管理后台页面 |
| `web/src/features/admin.ts`（原 `public/admin.js`） | 管理后台前端逻辑 |
| `public/admin.css` | 管理后台样式 |
