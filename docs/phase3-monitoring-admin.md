# Phase 3：监控告警系统 + 管理后台 — 架构设计文档

## 1. 背景

EasySticker 已完成生产安全加固（Phase 1）和用户系统与使用统计（Phase 2），目前具备：

- API Token 认证 + 速率限制 + 每日配额 + CORS
- JWT 用户认证（注册/登录/管理员 API）
- JSONL 每日使用日志追踪
- 基础管理 API（用户列表、禁用/启用、使用统计汇总）

**当前缺失的能力：**
- 无系统级监控（CPU/内存/磁盘/请求耗时）
- 无告警机制（无法在问题发生前主动发现）
- 无管理后台（管理员只能通过 API 操作）
- 无法可视化历史趋势

Phase 3 填补这些空白。

---

## 2. 目标

1. **后端监控体系**：采集请求级指标 + 系统级指标 + 磁盘使用，按 JSONL 留存
2. **告警引擎**：可配置规则、状态追踪、防重复、支持 Webhook 通知
3. **管理后台**：独立页面（`/admin.html`），仪表盘 + 用户管理 + 使用统计 + 设置

---

## 3. 文件清单

### 3.1 新建文件

| 文件 | 用途 |
|------|------|
| `src/lib/monitorStore.ts` | 指标采集、聚合、JSONL 持久化、磁盘使用计算 |
| `src/lib/alertEngine.ts` | 告警规则引擎：阈值判断、状态追踪、频率控制 |
| `src/lib/alertNotifier.ts` | 告警通知：Wehook 推送 + 本地日志 |
| `public/admin.html` | 管理后台 HTML 页面 |
| `public/admin.js` | 管理后台 JavaScript 逻辑 |

### 3.2 修改文件

| 文件 | 变更内容 |
|------|----------|
| `src/app.ts` | 注册 `onResponse` hook 采集请求指标、注册 `monitorStore` 装饰器 |
| `src/server.ts` | 加载告警配置、初始化 `monitorStore` 定期采样、初始化告警引擎 |
| `src/routes/admin.ts` | 新增监控 API、告警 API、设置 API |
| `src/types/fastify.d.ts` | 添加 `monitorStore` 类型声明 |

### 3.3 不动的文件

`usageStore.ts`、`userStore.ts`、`security.ts`、`auth.ts`、`generate.ts`、`uploads.ts` 等保持原状。

---

## 4. 后端 API 设计

### 4.1 新增 API 列表

所有新 API 挂载在 `/api/admin/*` 下，沿用现有的 `requireAdmin` 中间件。

#### `GET /api/admin/monitoring` — 系统监控总览

返回当前系统状态 + 近期趋势聚合。

```json
{
  "current": {
    "cpu": { "percent": 45.2, "loadAvg": [1.2, 0.8, 0.6] },
    "memory": { "totalMb": 16384, "usedMb": 8192, "percent": 50.0 },
    "disk": { "totalMb": 102400, "usedMb": 30720, "percent": 30.0 },
    "uptime": 3600,
    "requestsLastMinute": 12
  },
  "trends": {
    "requestsPerMinute": [10, 15, 8, 12, 14, 9, 11, 13, 17, 22],
    "errorRate": [0, 0.02, 0, 0.01, 0, 0.03, 0, 0, 0.01, 0.05],
    "avgLatencyMs": [120, 95, 110, 130, 105, 98, 115, 125, 100, 108],
    "cpuHistory": [30, 35, 42, 48, 45, 40, 38, 50, 55, 45],
    "memoryHistory": [48, 49, 50, 50, 51, 50, 49, 50, 51, 50]
  },
  "alerts": {
    "active": [
      { "id": "...", "rule": "cpu_high", "message": "CPU 使用率 85% > 80%", "startedAt": "..." }
    ],
    "recent": [
      { "id": "...", "rule": "cpu_high", "message": "...", "startedAt": "...", "resolvedAt": null, "acknowledged": false }
    ]
  }
}
```

#### `GET /api/admin/monitoring/metrics` — 原始指标查询（分页）

按时间范围查询原始指标记录。

```
GET /api/admin/monitoring/metrics?from=ISO&to=ISO&limit=100&type=request|system|disk
```

```json
{
  "metrics": [
    {
      "timestamp": "2026-05-20T12:00:00.000Z",
      "type": "request",
      "data": { "method": "POST", "route": "/api/generate/start", "status": 200, "durationMs": 150, "user": "user@example.com" }
    }
  ],
  "hasMore": false
}
```

#### `GET /api/admin/alerts/rules` — 获取告警规则列表

```json
{
  "rules": [
    {
      "id": "cpu_high",
      "name": "CPU 过高",
      "metric": "cpu.percent",
      "operator": "gt",
      "threshold": 80,
      "duration": 60,
      "silenceMs": 300000,
      "enabled": true
    }
  ]
}
```

#### `PUT /api/admin/alerts/rules` — 更新告警规则

请求体同单条 rule 结构。返回更新后的全部规则列表。

#### `GET /api/admin/alerts/history` — 告警历史

可选参数 `?resolved=false` 仅查活跃告警。

```json
{
  "alerts": [
    {
      "id": "...",
      "rule": "cpu_high",
      "message": "CPU 使用率 85% 超过阈值 80%",
      "startedAt": "2026-05-20T12:00:00Z",
      "resolvedAt": null,
      "acknowledged": false,
      "value": 85
    }
  ]
}
```

#### `POST /api/admin/alerts/:id/ack` — 确认告警

```json
{ "success": true }
```

#### `GET /api/admin/settings` — 获取管理后台设置

```json
{
  "webhookUrl": "https://open.feishu.cn/open-apis/bot/v2/hook/xxx",
  "webhookEnabled": true,
  "notificationInterval": 300000,
  "monitorRetentionDays": 7
}
```

#### `PUT /api/admin/settings` — 更新管理后台设置

请求体同返回结构，字段可选。

### 4.2 依赖关系

```
routes/admin.ts
  ├── lib/monitorStore.ts  (装饰在 app 上)
  └── lib/alertEngine.ts   (装饰在 app 上)
       └── lib/alertNotifier.ts
```

---

## 5. 数据存储格式

### 5.1 指标 JSONL

存储在 `data/monitoring/{type}/{YYYY-MM-DD}.jsonl`，三种类型独立目录：

**request** — 请求级指标
```json
{"ts":"2026-05-20T12:00:00.000Z","method":"POST","route":"/api/generate/start","status":200,"durationMs":150,"user":"user@example.com"}
```

**system** — 系统级指标（每 10s 采样）
```json
{"ts":"2026-05-20T12:00:00.000Z","cpuPercent":45.2,"loadAvg":[1.2,0.8,0.6],"memTotalMb":16384,"memUsedMb":8192,"memPercent":50.0,"uptime":3600}
```

**disk** — 磁盘使用（每 60s 采样）
```json
{"ts":"2026-05-20T12:00:00.000Z","diskTotalMb":102400,"diskUsedMb":30720,"diskPercent":30.0}
```

### 5.2 告警配置 JSON

存储在 `data/alerts-config.json`：

```json
{
  "rules": [
    { "id": "cpu_high", "name": "CPU 过高", "metric": "cpu.percent", "operator": "gt", "threshold": 80, "duration": 60, "silenceMs": 300000, "enabled": true },
    { "id": "error_rate_high", "name": "错误率过高", "metric": "errorRate", "operator": "gt", "threshold": 0.05, "duration": 120, "silenceMs": 600000, "enabled": true },
    { "id": "disk_full", "name": "磁盘空间不足", "metric": "disk.percent", "operator": "gt", "threshold": 90, "duration": 60, "silenceMs": 600000, "enabled": true },
    { "id": "latency_high", "name": "响应延迟过高", "metric": "avgLatencyMs", "operator": "gt", "threshold": 5000, "duration": 120, "silenceMs": 600000, "enabled": true },
    { "id": "request_surge", "name": "请求量异常激增", "metric": "requestsPerMinute", "operator": "gt", "threshold": 100, "duration": 60, "silenceMs": 300000, "enabled": false }
  ],
  "webhookUrl": "",
  "webhookEnabled": false,
  "notificationInterval": 300000,
  "monitorRetentionDays": 7
}
```

### 5.3 告警历史 JSON

存储在 `data/alerts-history.json`：

```json
{
  "alerts": [
    { "id": "uuid", "rule": "cpu_high", "message": "...", "value": 85, "startedAt": "...", "resolvedAt": null, "acknowledged": false }
  ]
}
```

### 5.4 管理后台设置

存储在 `data/monitor-settings.json`，结构同 `/api/admin/settings` 响应。

合并告警配置与监控设置为同一个文件更简单：

**`data/monitor-config.json`** — 合并文件，包含告警规则、通知设置、保留天数等。

---

## 6. 关键代码设计

### 6.1 monitorStore — 指标采集与存储

```typescript
// 核心接口
interface MonitorStore {
  // 请求级：由 Fastify onResponse hook 调用
  recordRequest(record: {
    method: string;
    route: string;
    status: number;
    durationMs: number;
    user?: string;
  }): void;

  // 系统级采样：由 setInterval 调用
  recordSystem(): void;

  // 磁盘采样：由 setInterval 调用
  recordDisk(): void;

  // 获取当前快照
  getCurrentSnapshot(): CurrentMetrics;

  // 获取近期趋势聚合（按分钟）
  getTrends(minutes: number): TrendData;

  // 查询原始指标（分页）
  queryMetrics(opts: { from?: Date; to?: Date; type?: string; limit: number }): MetricRecord[];

  // 清理过期数据
  cleanup(): void;
}
```

**实现细节：**
- `recordRequest`：同步写入请求 JSONL，同时更新内存中的滚动窗口（1 分钟粒度的环形缓冲区）
- `recordSystem`：每 10 秒采样 CPU（通过 `os` 模块 `os.cpus()` 计算间隔差值）、内存（`os.totalmem()` / `os.freemem()`）、loadavg
- `recordDisk`：每 60 秒扫描 `data/` 目录的实际占用（使用 `fs.statSync` + 递归或 `du`）
- `getCurrentSnapshot`：返回最近一次采样数据 + 滚动窗口聚合（最近 1 分钟的请求数/错误数/平均延迟）
- `getTrends(n)`：从最近 n 分钟的 JSONL 文件中读取并按分钟聚合
- `cleanup`：删除超过 `retentionDays` 的旧 JSONL 文件

**滚动窗口设计（内存）：**
- 用固定长度的环形缓冲区（60 个 slot，每个 slot 代表 1 秒），避免 OOM
- 每个 slot 记录该秒内的：请求计数、成功计数、失败计数、总耗时
- 查询时聚合指定时间范围

### 6.2 alertEngine — 告警规则引擎

```typescript
interface AlertEngine {
  // 由定时器调用，周期性评估所有规则
  evaluate(): void;

  // 获取当前规则列表
  getRules(): AlertRule[];

  // 更新规则
  updateRules(rules: AlertRule[]): void;

  // 获取活跃告警
  getActiveAlerts(): AlertRecord[];

  // 获取告警历史
  getAlertHistory(): AlertRecord[];

  // 确认告警
  acknowledgeAlert(id: string): boolean;

  // 获取配置（webhook 等）
  getConfig(): MonitorConfig;

  // 更新配置
  updateConfig(config: Partial<MonitorConfig>): void;
}
```

**告警生命周期：**
1. **正常 → 触发**：指标超过阈值持续 `duration` 秒 → 创建告警记录，发送通知
2. **触发 → 活跃**：已发送通知，等待指标回落
3. **活跃 → 解决**：指标低于阈值（含 10% 回滞）→ 标记 `resolvedAt`，可选发送恢复通知
4. **防重复**：同一 rule 的活跃告警存在时，不重复创建（除非已解决）
5. **静默期**：通知发送后 `silenceMs` 内不再发送相同 rule 的通知，但状态继续追踪

**评估流程（每 30 秒执行一次）：**

```
for each rule where enabled:
  fetch current metric value from monitorStore's rolling window
  if value breaches threshold:
    if breach_duration >= rule.duration:
      if no active alert for this rule:
        create alert record
        send notification via notifier
  else:
    if alert exists and not resolved:
      if value < threshold * 0.9 (hysteresis):
        mark alert as resolved
```

### 6.3 alertNotifier — 告警通知

```typescript
interface AlertNotifier {
  send(alert: NewAlert): Promise<void>;
}
```

**支持的渠道：**
1. **Webhook**：POST JSON 到配置的 URL，支持飞书机器人格式和通用格式
   - 飞书格式：`{ "msg_type": "interactive", "card": { ... } }`
   - 通用格式：`{ "text": "...", "attachments": [...] }`
2. **本地日志**：通过 `pino` logger 输出告警日志

**通知频率控制：**
- 全局 `notificationInterval`：同一 rule 两次通知的最小间隔
- 静默期内不发送通知，但告警状态继续更新

### 6.4 onResponse Hook 采集（修改 app.ts）

```typescript
// 在 buildApp 中，API 路由注册之后添加
app.addHook("onResponse", async (req, reply) => {
  const start = (req as any).__startTime;
  if (!start) return;
  const durationMs = performance.now() - start;

  // 只记录 API 路由，忽略静态资源
  if (!req.url.startsWith("/api/")) return;

  let user: string | undefined;
  try {
    await req.jwtVerify().catch(() => {});
    user = (req.user as any)?.email;
  } catch {}

  app.monitorStore.recordRequest({
    method: req.method,
    route: req.routeOptions?.url || req.url,
    status: reply.statusCode,
    durationMs,
    user
  });
});
```

需要同时在 `onRequest` hook 中记录 `__startTime`：

```typescript
app.addHook("onRequest", async (req) => {
  (req as any).__startTime = performance.now();
});
```

### 6.5 server.ts 初始化流程（修改）

```typescript
// 在 buildApp 之后、listen 之前
const monitorStore = app.monitorStore;
const alertEngine = app.alertEngine;

// 启动系统指标采样（每 10 秒）
const systemTimer = setInterval(() => monitorStore.recordSystem(), 10_000);

// 启动磁盘采样（每 60 秒）
const diskTimer = setInterval(() => monitorStore.recordDisk(), 60_000);

// 启动告警评估（每 30 秒）
const alertTimer = setInterval(() => alertEngine.evaluate(), 30_000);

// 启动数据清理（每 1 小时）
const cleanupTimer = setInterval(() => monitorStore.cleanup(), 3600_000);

// onClose 时清理定时器
app.addHook("onClose", () => {
  clearInterval(systemTimer);
  clearInterval(diskTimer);
  clearInterval(alertTimer);
  clearInterval(cleanupTimer);
});
```

---

## 7. 前端组件结构

### 7.1 页面结构 (`public/admin.html`)

```
┌─────────────────────────────────────────────┐
│  EasySticker 管理后台  │ 用户: admin@... │ 登出  │
├─────────────────────────────────────────────┤
│  [仪表盘] [用户管理] [使用统计] [设置]       │
├─────────────────────────────────────────────┤
│                                             │
│  (Tab 内容区域，由 admin.js 动态渲染)        │
│                                             │
└─────────────────────────────────────────────┘
```

### 7.2 admin.js 模块划分

```
admin.js
├── AuthGuard        — 检查 JWT / role === "admin"，否则重定向
├── Tabs             — Tab 切换 + 历史管理
├── DashboardTab
│   ├── HealthGauges — CPU/内存/磁盘 SVG 环形仪表盘
│   ├── StatsCards   — 今日请求量、成功量、错误率、活跃用户
│   └── AlertList    — 最近告警列表（精简版）
├── UsersTab
│   ├── SearchFilter — 邮箱搜索
│   ├── UserTable    — 用户列表（邮箱、角色、注册时间、最后登录、状态）
│   └── ToggleButton — 禁用/启用
├── StatsTab
│   ├── DailyChart   — 7 日/30 日趋势图（SVG 折线图）
│   ├── UserRanking  — 活跃用户排名（柱状图或列表）
│   └── SuccessRate  — 成功/失败分布（圆环图）
└── SettingsTab
    ├── AlertRules   — 规则列表，可编辑阈值/启用
    ├── WebhookConfig — Webhook URL + 开关
    └── RetentionSetting — 数据保留天数
```

### 7.3 SVG 仪表盘设计（不依赖第三方图表库）

**环形仪表盘**：`<circle>` + `stroke-dasharray` + `stroke-dashoffset` 实现

```html
<svg viewBox="0 0 120 120" class="gauge" data-value="45">
  <circle cx="60" cy="60" r="54" fill="none" stroke="#e5e7eb" stroke-width="8"/>
  <circle cx="60" cy="60" r="54" fill="none"
    stroke="#07c160" stroke-width="8"
    stroke-dasharray="339.292"  <!-- 2 * π * 54 -->
    stroke-dashoffset="186.611" <!-- 339.292 * (1 - 0.45) -->
    transform="rotate(-90, 60, 60)"
    stroke-linecap="round"/>
  <text x="60" y="50" text-anchor="middle" font-size="24" font-weight="700">45%</text>
  <text x="60" y="72" text-anchor="middle" font-size="10" fill="#6b7280">CPU</text>
</svg>
```

颜色随值变化：< 60% 绿色、60-80% 黄色、> 80% 红色。

**折线图**：`<polyline>` 基于数据点计算坐标

```html
<svg viewBox="0 0 300 120" class="line-chart">
  <polyline fill="none" stroke="#07c160" stroke-width="2"
    points="0,100 30,80 60,90 90,60 120,70 150,50 180,65 210,55 240,40 270,45" />
</svg>
```

**柱状图**：多个 `<rect>` 排布。

### 7.4 API 调用封装

```javascript
class AdminAPI {
  constructor() { this.base = '/api/admin'; }
  async getToken() { return localStorage.getItem('easysticker_token'); }
  async request(path, opts = {}) {
    const token = await this.getToken();
    const res = await fetch(this.base + path, {
      ...opts,
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json', ...opts.headers }
    });
    if (res.status === 401) { logout(); window.location.href = '/'; }
    return res.json();
  }
  // monitoring
  getMonitoring() { return this.request('/monitoring'); }
  getMetrics(params) { return this.request(`/monitoring/metrics?${new URLSearchParams(params)}`); }
  // alerts
  getAlertRules() { return this.request('/alerts/rules'); }
  updateAlertRules(rules) { return this.request('/alerts/rules', { method: 'PUT', body: JSON.stringify({ rules }) }); }
  getAlertHistory(params) { return this.request(`/alerts/history?${new URLSearchParams(params)}`); }
  acknowledgeAlert(id) { return this.request(`/alerts/${id}/ack`, { method: 'POST' }); }
  // settings
  getSettings() { return this.request('/settings'); }
  updateSettings(settings) { return this.request('/settings', { method: 'PUT', body: JSON.stringify(settings) }); }
  // users — 复用现有接口
  getUsers() { return this.request('/users'); }
  toggleUser(email) { return this.request(`/users/${encodeURIComponent(email)}/toggle`, { method: 'POST' }); }
}
```

### 7.5 认证保护

`admin.html` 加载后立即检查：

```javascript
document.addEventListener('DOMContentLoaded', async () => {
  const token = localStorage.getItem('easysticker_token');
  if (!token) { window.location.href = '/'; return; }

  try {
    const res = await fetch('/api/auth/me', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await res.json();
    if (data.user?.role !== 'admin') {
      window.location.href = '/';
      return;
    }
    // 初始化 admin dashboard
    initAdmin(data.user);
  } catch {
    window.location.href = '/';
  }
});
```

---

## 8. 告警规则参考配置

默认预设五条规则，管理员可在设置页面启用/禁用、调整阈值：

| 规则 ID | 名称 | 指标 | 运算符 | 默认阈值 | 持续时长 | 静默期 | 默认启用 |
|---------|------|------|--------|---------|---------|--------|---------|
| `cpu_high` | CPU 过高 | `cpu.percent` | `gt` | 80% | 60s | 5min | ✅ |
| `error_rate_high` | 错误率过高 | `errorRate` | `gt` | 5% | 120s | 10min | ✅ |
| `disk_full` | 磁盘空间不足 | `disk.percent` | `gt` | 90% | 60s | 10min | ✅ |
| `latency_high` | 响应延迟过高 | `avgLatencyMs` | `gt` | 5000ms | 120s | 10min | ✅ |
| `request_surge` | 请求量异常激增 | `requestsPerMinute` | `gt` | 100 | 60s | 5min | ❌ |

---

## 9. 风险与取舍

### 9.1 取舍

| 决策 | 理由 |
|------|------|
| **不引入外部时序数据库** | 当前 JSONL + 内存滚动窗口足够轻量，保留天数可控 |
| **CPU 使用率用 `os` 模块** | 无需 `pidusage` 等依赖，间隔差值计算足够精确 |
| **前端图表用纯 SVG** | 项目不引入 Chart.js / ECharts，保持零额外依赖 |
| **磁盘占用不递归扫描所有文件** | 使用 `du` 命令或 `fs.stat` 仅扫描 `data/` 一级子目录 |
| **告警规则存 JSON 文件** | 简单可编辑，不引入数据库；重启不丢失 |
| **告警不覆盖 `usageStore`** | 两条线正交——usageStore 记录用户行为，monitorStore 记录系统健康 |

### 9.2 风险

| 风险 | 缓解措施 |
|------|----------|
| JSONL 文件过多占用磁盘 | `cleanup()` 按时删除过期文件，保留天数可配置 |
| 内存滚动窗口数据丢失（重启） | 仅丢失秒级原始数据，分钟级趋势可回溯 JSONL 重建 |
| 告警通知重复 | 状态追踪 + 静默期双重防重复 |
| Webhook 通知失败 | 仅日志记录失败，不重试；告警状态仍维持 |
| 管理后台 JWT 过期 | 前端拦截 401 自动跳转到主页重新登录 |

---

## 10. 实施优先级

建议分三步实现，每步可独立验证。

### Step 1：监控指标采集（后端核心）

**文件：** `src/lib/monitorStore.ts` + 修改 `src/app.ts` + `src/server.ts` + `src/types/fastify.d.ts`

**验证：**
- 启动服务后 `data/monitoring/request/2026-05-20.jsonl` 写入请求记录
- 启动服务后 `data/monitoring/system/...` 和 `disk/...` 写入采样数据
- `GET /api/admin/monitoring` 返回当前状态（此 API 先挂空壳，等 Step 2 完善）

**耗时估算：** ~2h

### Step 2：告警引擎 + 通知

**文件：** `src/lib/alertEngine.ts` + `src/lib/alertNotifier.ts` + 修改 `src/routes/admin.ts`（增加监控/告警 API）+ `src/server.ts`（启动告警引擎）

**验证：**
- 手动调低 CPU 阈值后触发告警，检查 `data/alerts-history.json` 记录
- 配置飞书 Webhook URL，触发告警后收到飞书消息
- 同一告警在静默期内不重复发送

**耗时估算：** ~3h

### Step 3：管理后台（前端）

**文件：** `public/admin.html` + `public/admin.js`

**验证：**
- 普通用户访问 `/admin.html` 被重定向
- 管理员访问看到仪表盘、用户管理、使用统计
- 用户禁用/启用功能正常工作
- 告警规则配置、Webhook URL 配置保存后持久化
- SVG 图表正确渲染

**耗时估算：** ~4h

**总计估算：** ~9h

---

## 11. 附录：monitorStore 核心类型参考

```typescript
// === 指标类型 ===

interface RequestMetric {
  ts: string;           // ISO timestamp
  method: string;
  route: string;
  status: number;
  durationMs: number;
  user?: string;
}

interface SystemMetric {
  ts: string;
  cpuPercent: number;
  loadAvg: [number, number, number];
  memTotalMb: number;
  memUsedMb: number;
  memPercent: number;
  uptime: number;
}

interface DiskMetric {
  ts: string;
  diskTotalMb: number;
  diskUsedMb: number;
  diskPercent: number;
}

// === 趋势聚合 ===

interface MinuteBucket {
  timestamp: number;     // epoch seconds
  requestCount: number;
  successCount: number;
  errorCount: number;
  totalDurationMs: number;
  avgDurationMs: number;
  errorRate: number;
}

// === 告警 ===

interface AlertRule {
  id: string;
  name: string;
  metric: string;            // e.g. "cpu.percent", "errorRate"
  operator: "gt" | "lt";
  threshold: number;
  duration: number;          // seconds the condition must persist
  silenceMs: number;         // cooldown between notifications
  enabled: boolean;
}

interface AlertRecord {
  id: string;
  rule: string;               // rule id
  message: string;
  value: number;
  startedAt: string;
  resolvedAt: string | null;
  acknowledged: boolean;
}

// === 系统当前快照 ===

interface CurrentMetrics {
  cpu: { percent: number; loadAvg: [number, number, number] };
  memory: { totalMb: number; usedMb: number; percent: number };
  disk: { totalMb: number; usedMb: number; percent: number };
  uptime: number;
  requestsLastMinute: number;
  errorsLastMinute: number;
  avgLatencyLastMinute: number;
}
```

---

## 12. 附录：admin.html Tab 路由设计

前端 Tab 切换使用 hash-based routing，避免页面刷新丢失状态：

```
/admin.html#dashboard  — 仪表盘
/admin.html#users      — 用户管理
/admin.html#stats      — 使用统计
/admin.html#settings   — 设置
```

JS 拦截 `hashchange` 事件，根据 hash 加载对应 Tab 内容。

数据刷新策略：
- 仪表盘：首次加载 + 手动刷新按钮
- 用户管理：首次加载 + 操作后刷新
- 使用统计：首次加载 + Tab 切换时刷新
- 设置：首次加载 + 保存后刷新
