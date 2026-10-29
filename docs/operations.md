# 运维手册

> 本文负责**上线之后怎么维护**：日志、存储清理、备份、监控告警、压测与排障。
> 部署步骤见 [部署指南](deployment.md)，配置项含义见 [配置参考](configuration-reference.md)。

---

## 1. 日常巡检

每天 / 每周可以只看这几处：

| 检查项 | 方式 | 异常信号 |
|--------|------|---------|
| 服务存活 | `GET /health` | 非 200 |
| 错误日志 | `docker compose logs` 或日志采集器 | 5xx、provider 报错、磁盘写入失败 |
| 实时指标 | 后台「仪表盘」（SSE） | CPU / 内存持续高位、请求量异常 |
| 告警 | 后台告警列表 / Webhook | 长时间 active、没有恢复通知 |
| 存储 | 后台「存储」标签页 | 占用持续增长、孤儿素材变多 |
| 备份 | 备份任务 / 恢复演练 | 备份失败、文件大小异常 |

---

## 2. 日志

Pino 输出 **JSON lines 到 stdout**，一行一个对象，可直接被 Loki / Datadog / ELK / CloudWatch 采集。

| 变量 | 默认 | 取值 |
|------|------|------|
| `LOG_LEVEL` | `info` | `fatal` / `error` / `warn` / `info` / `debug` / `trace` / `silent` |

`NODE_ENV !== "production"` 时使用 `pino-pretty` 输出可读格式。

```json
{"level":30,"time":1717000000000,"pid":1,"hostname":"abc123","msg":"server started","port":3000}
```

```bash
docker compose logs -f easysticker
docker compose logs easysticker | grep "Default admin"   # 查找随机生成的管理员密码
```

### Docker 日志轮转

否则日志会撑满磁盘。宿主机 `/etc/docker/daemon.json`：

```json
{ "log-driver": "json-file", "log-opts": { "max-size": "10m", "max-file": "3" } }
```

修改后执行 `sudo systemctl restart docker`。若无法改 driver，可用 logrotate 处理
`/var/lib/docker/containers/*/*.log`（`daily` / `rotate 7` / `compress` / `copytruncate` / `maxsize 50M`）。

| 环境 | 建议级别 | 采集方式 |
|------|---------|---------|
| 开发 | `debug` | 终端（pino-pretty） |
| 预发 | `info` | Docker logs + Loki |
| 生产 | `info` | JSON → 日志收集器 |

---

## 3. 存储清理与回收

### 3.1 存储模型

**素材只存一份，ZIP 不落盘**，所以磁盘占用约等于素材本身：

```
data/uploads/<assetId>.<ext>     # 所有素材，只存一份
data/packs/<packId>.json         # 包清单（几 KB），含逐张提示词 / 尺寸 / 角色 / owner
```

用户点「下载 ZIP」时才按清单现场打包、边打边发。单资源重生成、重建 ZIP 都只写几 KB 清单，
不会复制整包图片。

> 历史遗留：早期版本把整包 ZIP 存在 `packs/<packId>.zip`，造成双倍占用。
> 这些包会被 GC 转成清单（素材本来就在 uploads 里），下载链接不变。

### 3.2 自动巡检

服务端每 6 小时跑一次（`server.maintenance`，首次延迟 30 秒），只做**可证明安全**的四件事：

| 动作 | 安全条件 |
|------|---------|
| 压缩旧包 | 缺 `files[]` 或素材不全则跳过 |
| 清孤儿素材 | 无人引用 **且** 落盘超过 `orphanMinAgeHours` |
| 清 `.orig` 备份 | `repair-pack` 的中间产物 |
| 按保留期删包 | 默认 30 天，且**不追溯既往** |

保留期语义：过期时间 = `max(包创建时间, 策略生效时间) + 保留天数`。
所以今天才把 `packRetentionDays` 从 0 改成 30，不会立刻清空历史数据。

### 3.3 手动体检 / 清理

```bash
npm run gc                                    # 只体检，不删任何东西
npm run gc -- --apply                         # 执行
npm run gc -- --apply --retention-days 30     # 顺带清掉 30 天前的包
npm run gc -- --apply --keep-orig             # 保留 .orig 备份
npm run gc -- --apply --orphan-min-age-hours 1
```

> ⚠️ **不要**使用 `find data -mtime +N -delete` 这类按 mtime 的清理方式。
> 素材的 mtime 与「是否仍被引用」无关，直接删会把包打坏（图片 404、ZIP 打不出来）。
> 用 `npm run gc`，它按引用关系判断。

后台「存储」标签页能看到占用、待回收量与全部包列表，支持多选 / 全选 + 批量删除
（删除需二次确认，全选删除需输入 `DELETE`）；删除后立即回收该包素材，不必等下一次巡检。

### 3.4 修复历史包

早期导出的 ZIP 里 `metadata.json` 缺尺寸 / 提示词，可用脚本就地升级：
用 Sharp 重新测量尺寸、补齐 `files[]`；`uploads/` 里还留着参考图就一并收进 `source/reference.*`。

```bash
npm run repair-pack -- <packId>            # 修复单个包
npm run repair-pack -- --all               # 修复所有旧 schema 的包
npm run repair-pack -- --all --dry-run     # 只看会改什么
```

原包会备份成 `<packId>.zip.orig`，`packId` 与下载链接不变。
旧版本没有把生成上下文落盘，只能从浏览器 localStorage 找回：

```js
// 项目页面 F12 → console
copy(localStorage.getItem('easysticker:last-wechat-pack'))
```

存成 `context.json` 后执行 `npm run repair-pack -- <packId> --context context.json`，
可写回 `generation` 与逐张提示词。

### 3.5 账号与数据删除

后台「用户」标签页支持：

- **停用**：账号保留，登录被拒；已签发的 JWT **立即失效**。
- **硬删**（`DELETE /api/admin/users/:email`）：删除账号；加 `?purge=true` 时一并清理
  其名下包（并回收素材）、用量日志、监控记录，以及该用户上传但从未进入任何包的散图
  （依据素材归属索引 `data/uploads/.owners.jsonl` 精确匹配）。
- 管理员账号受保护，不能停用 / 删除。

---

## 4. 监控与告警

### 4.1 指标采集

| 类型 | 频率 | 位置 |
|------|------|------|
| 请求级 | 每次 API 请求（`/api/assets/*` 已排除） | 60 个 1 秒环形 slot |
| 系统级 | 每 10 秒 | CPU / 内存 |
| 磁盘 | 每 60 秒 | `data/` 占用 |

按天写入 `data/monitoring/*.jsonl`。请求窗口由 1 秒定时器持续推进，
**空闲期同样会过期**，不会冻结在最后一次请求上。

### 4.2 告警规则

默认规则：

| 规则 | 指标 | 默认阈值 | 状态 |
|------|------|---------|------|
| 服务端错误率过高 | `serverErrorRate`（5xx） | 2% | 启用 |
| 客户端错误率偏高 | `clientErrorRate`（4xx） | 20% | 关闭 |
| CPU 过高 | `cpu.percent` | 80% | 启用 |
| 磁盘空间不足 | `disk.usedMb` | 500 MB | 启用 |
| 响应延迟过高 | `avgLatencyMs` | 5000 ms | 启用 |
| 请求量异常激增 | `requestsPerMinute` | 100 | 关闭 |

错误率规则还要求窗口内至少有 `minSamples` 个请求（默认 20），低于该值视为无数据，
避免低流量下单个错误被放大成 100%。

告警逻辑：

- 条件需持续 `duration` 秒才触发；
- 值回落到阈值即恢复（没有回滞死区）；
- 同一条告警的提醒间隔为 `max(规则 silenceMs, 全局 notificationInterval)`；
- 触发与恢复各推送一次，`lastNotifiedAt` / `notifyCount` 持久化，重启不会立即重推；
- 消息带出错路由、5xx / 4xx 拆分、状态码分布与排查建议。

规则、Webhook、通知间隔、监控保留天数在后台「设置」或 `data/alerts-config.json` 中配置；
指标与字段说明见 [配置参考 · 告警规则](configuration-reference.md#61-告警规则)。

### 4.3 通知

- Webhook：飞书交互卡片或通用 JSON；
- 本地日志；
- 后台告警列表（含已确认 / 已解决状态）。

---

## 5. 备份与恢复

所有持久化数据都在 `./data/`：

| 路径 | 内容 |
|------|------|
| `data/users.json` | 用户账户（邮箱、密码哈希、角色） |
| `data/uploads/` | 所有素材（表情图、参考图、扩展资源、历史版本） |
| `data/uploads/.owners.jsonl` | 素材归属索引，硬删账号清理散图用；备份建议一并带上 |
| `data/packs/` | 包清单（含逐张提示词 / 尺寸 / owner） |
| `data/usage/` | 使用量统计 |
| `data/monitoring/` | 请求 / 系统 / 磁盘指标 JSONL |
| `data/alerts-config.json` / `data/alerts-history.json` | 告警规则与历史 |
| `data/maintenance.json` | 保留期策略生效起点（**恢复时一并带上**） |

```bash
# 手动备份
tar czf backup-$(date +%Y%m%d-%H%M%S).tar.gz ./data

# 每天 3 点备份，保留 30 天
0 3 * * * cd /path/to/easysticker && tar czf /backups/easysticker-$(date +\%Y\%m\%d).tar.gz ./data \
          && find /backups -name 'easysticker-*.tar.gz' -mtime +30 -delete

# Docker 具名卷
docker run --rm -v easysticker_data:/data -v /backups:/backup alpine \
  tar czf /backup/easysticker-$(date +%Y%m%d).tar.gz -C /data .
```

> 恢复后请保留 `data/maintenance.json`，否则保留期策略会重新计时
>（包不会被立刻删，但窗口会重置）。

---

## 6. 压测

使用 [autocannon](https://github.com/mcollina/autocannon)：`npm i -g autocannon`。

```bash
autocannon -c 50 -d 30 http://localhost:3000/health
autocannon -c 20 -d 30 http://localhost:3000/
autocannon -c 20 -d 30 -H "Authorization: Bearer <TOKEN>" http://localhost:3000/api/auth/me
```

限流默认 30 req/min、匿名日配额 10，压测 / e2e 前务必放宽，否则结果全是 429：

```bash
RATE_LIMIT_MAX=600 DAILY_QUOTA_ANONYMOUS_MAX=500 node dist/server.js
```

参考量级（Mac mini M2，Docker 容器内，仅用于判断是否数量级异常）：

| 场景 | RPS | P99 |
|------|-----|-----|
| `/health`（50 并发） | ~850 | 113 ms |
| 首页静态（20 并发） | ~400 | 81 ms |
| 认证 API（20 并发） | ~260 | 177 ms |

> 首页首次加载会把 `styles.css` 与 6 个 JS 拉一遍，之后靠内容哈希长缓存命中。
> 压测静态资源时注意区分「冷启动」与「已预热」。

---

## 7. 排障速查

| 现象 | 多半是 |
|------|--------|
| 生成进度卡住不动 | 反代把 SSE 缓冲了（`proxy_buffering off`） |
| 后台仪表盘「已断开，正在重连」 | 同上；前端会自动退避重连并退回 REST 兜底 |
| 图片 404 / ZIP 打不出来 | 素材被按 mtime 的清理脚本删了，或包引用的素材缺失（`npm run gc` 能看到） |
| 忘记管理员密码 | 设置 `ADMIN_PASSWORD` 重启；或删 `data/users.json` 里的对应用户重新注册为管理员 |
| 重启后所有人被登出 | 未固定 `JWT_SECRET` |
| 大量 429 | 限流 / 日配额太紧，或压测时没放宽（见 §6） |
| 告警 webhook 太频繁 | ① 错误率默认只看 5xx；仍频繁就调大 `silenceMs` 或全局 `notificationInterval`；② 恢复后会发一条恢复通知，不再反复推送；③ 旧配置启动时会自动迁移 |
| 告警只说「错误率过高」 | 升级后消息会带出错路由、状态码分布与排查建议；可在 `data/monitoring/request/*.jsonl` 按 route / status 搜索 |
| 首页还在跑旧的前端代码 | 执行 `npm run web:build`（会同时刷新 HTML 里的内容哈希） |
| 生成结果一直是随机图 | `ai.defaultProvider` 还是 `mock`，或没有可用 API Key |
| 数据目录越来越大 | 检查 `packRetentionDays`、孤儿素材安全期与备份策略；先 `npm run gc` 体检 |
