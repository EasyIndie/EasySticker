# EasySticker 运维手册

> 部署、日志、压测、数据清理与备份。配置项本身的含义见 [configuration-reference.md](configuration-reference.md)。

---

## 1. 部署

### 1.1 本地 / 裸机

```bash
git clone https://github.com/EasyIndie/EasySticker.git
cd EasySticker
npm install
cp .env.example .env        # 按需填写，不填则以 Mock 模式启动
npm run build               # 编译服务端（tsup → dist/）
npm run web:build           # 编译前端（vite → public/js/）+ 写入内容哈希
npm run prod                # NODE_ENV=production node dist/server.js
```

开发模式用 `npm run dev`（tsup --watch + node --watch）与 `npm run web:dev`（vite）。

> **不需要**复制 `prompt-config.default.json` 为 `prompt-config.json`。
> 后者是可选的覆盖文件，只写与默认不同的字段即可（见配置参考）。

### 1.2 Docker

**方式 A：免源码（推荐）** —— 拉取预构建镜像，不需要克隆仓库或 Node 环境：

```bash
curl -O https://raw.githubusercontent.com/EasyIndie/EasySticker/main/docker-compose.image.yml
curl -o .env https://raw.githubusercontent.com/EasyIndie/EasySticker/main/.env.example
# 编辑 .env：至少填 API_TOKEN / JWT_SECRET / ADMIN_PASSWORD
docker compose -f docker-compose.image.yml up -d
```

- 镜像：`ghcr.io/easyindie/easysticker`（`linux/amd64` + `linux/arm64`，含 `:latest` 与版本 tag）。
- 锁版本：在 `.env` 里设 `EASYSTICKER_TAG=0.3.0`。
- 升级：`docker compose -f docker-compose.image.yml pull && docker compose -f docker-compose.image.yml up -d`。
- 数据落在 `./data`（映射到容器内 `/app/data`）。

不用 compose 也可以：

```bash
docker run -d --name easysticker -p 3000:3000 \
  -v "$PWD/data:/app/data" \
  -e API_TOKEN=... -e JWT_SECRET=... -e ADMIN_PASSWORD=... \
  ghcr.io/easyindie/easysticker:latest
```

**方式 B：从源码构建**：

```bash
docker compose build
docker compose up -d easysticker
```

容器内监听 `0.0.0.0:3000`（两种 compose 都映射到宿主 `3000`，可用 `.env` 的 `PORT` 改）。
**不要直接暴露到公网**，前面加一层 HTTPS 反代。

> 镜像内置 `prompt-config.default.json` 与前端产物；自定义配置优先用环境变量，
> 需深度定制再挂载 `prompt-config.json`（**先创建宿主文件**，否则 Docker 会把该路径建成目录）。
> 镜像以非 root 用户运行，`/app/data` 为可写卷。

### 1.3 反向代理（Nginx）

```nginx
server {
    listen 443 ssl;
    server_name sticker.example.com;
    ssl_certificate     /etc/letsencrypt/live/sticker.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/sticker.example.com/privkey.pem;

    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Frame-Options "DENY" always;
    add_header X-Content-Type-Options "nosniff" always;

    client_max_body_size 10m;   # 参考图上限

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # SSE 必需 —— 否则进度/实时指标会被缓冲住，表现是「卡住不动」。
        # 涉及两条流：/api/generate/stream（生成进度）与
        # /api/admin/monitoring/stream（后台仪表盘实时数据）
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 86400s;
    }
}
```

申请证书：`sudo certbot --nginx -d sticker.example.com`。

### 1.4 反向代理（Caddy）

```caddyfile
sticker.example.com {
    reverse_proxy 127.0.0.1:3000
    request_body max_size 10mb
}
```

Caddy 默认不缓冲流式响应，SSE 无需额外配置。

### 1.5 防火墙与升级

```bash
sudo ufw allow 443/tcp && sudo ufw allow 22/tcp && sudo ufw deny 3000/tcp && sudo ufw enable

# 升级
git pull && docker compose up -d --build easysticker
```

---

## 2. 日志

Pino 写 **JSON lines 到 stdout**，一行一个 JSON 对象，可直接被 Loki / Datadog / ELK / CloudWatch 采集。

| 变量 | 默认 | 取值 |
|------|------|------|
| `LOG_LEVEL` | `info` | `fatal`/`error`/`warn`/`info`/`debug`/`trace`/`silent` |

`NODE_ENV !== "production"` 时用 `pino-pretty` 输出可读格式。

```json
{"level":30,"time":1717000000000,"pid":1,"hostname":"abc123","msg":"server started","port":3000}
```

```bash
docker compose logs -f easysticker
docker compose logs easysticker | grep "Default admin"   # 找随机生成的管理员密码
```

**Docker 日志轮转**（否则日志会撑满磁盘）—— 宿主机 `/etc/docker/daemon.json`：

```json
{ "log-driver": "json-file", "log-opts": { "max-size": "10m", "max-file": "3" } }
```

改完 `sudo systemctl restart docker`。若无法改 driver，用 logrotate 处理
`/var/lib/docker/containers/*/*.log`（`rotate 7` / `daily` / `compress` / `copytruncate` / `maxsize 50M`）。

| 环境 | 建议级别 | 采集方式 |
|------|---------|---------|
| 开发 | `debug` | 终端（pino-pretty） |
| 预发 | `info` | Docker logs + Loki |
| 生产 | `info` | JSON → 日志收集器 |

---

## 3. 存储：清理与回收

### 3.1 存储模型

**素材只存一份，ZIP 不落盘**，所以磁盘占用约等于素材本身：

```
data/uploads/<assetId>.<ext>     # 所有素材，只存一份
data/packs/<packId>.json         # 包清单（几 KB），含逐张提示词/尺寸/角色/owner
```

用户点「下载 ZIP」时才按清单现场打包、边打边发。因此单资源重生成、重建 ZIP 都只是写几 KB 清单，
不会把整包图片再复制一遍。

> 历史遗留：早期版本把整包 ZIP 存在 `packs/<packId>.zip`，造成「uploads 一份 + ZIP 一份」的双倍占用。
> 这些包会被 GC 转成清单（素材本来就在 uploads 里），下载链接不变。

### 3.2 自动巡检

服务端每 6 小时跑一次（`server.maintenance`，首次延迟 30 秒），只做**可证明安全**的四件事：

| 动作 | 安全条件 |
|------|---------|
| 压缩旧包 | 缺 `files[]` 或素材不全则跳过 |
| 清孤儿素材 | 无人引用 **且** 落盘超过 `orphanMinAgeHours` |
| 清 `.orig` 备份 | `repair-pack` 的中间产物 |
| 按保留期删包 | 默认 30 天，且**不追溯既往** |

### 3.3 手动体检 / 清理

```bash
npm run gc                                    # 只体检，不删任何东西
npm run gc -- --apply                         # 执行
npm run gc -- --apply --retention-days 30     # 顺带清掉 30 天前的包
npm run gc -- --apply --keep-orig             # 保留 .orig 备份
npm run gc -- --apply --orphan-min-age-hours 1
```

> ⚠️ 不要用 `find data -mtime +N -delete` 这类按 mtime 的清理方式。
> 素材的 mtime 与「是否仍被引用」无关，直接删会把包打坏（图片 404、ZIP 打不出来）。
> 用 `npm run gc`，它按引用关系判断。

后台「存储」标签页能看到占用、待回收量、全部包列表，支持**多选 / 全选 + 批量删除**（删除需二次确认，
全选删除需输入 `DELETE`）；**删除后会立即回收该包素材**，不必等下一次巡检。

后台「用户」标签页支持**软删（停用）**与**硬删**：

- **停用**：账号保留，登录被拒；其已签发的 JWT 会**立即失效**（不必等 7 天）。
- **硬删**（`DELETE /api/admin/users/:email`）：删除账号；加 `?purge=true` 时一并清理
  其名下包（并回收素材）、用量日志、监控记录，以及**该用户上传但从未进入任何包的散图**
  （依据素材归属索引 `data/uploads/.owners.jsonl` 精确匹配，不会误伤他人）。
- 管理员账号受保护，不能停用 / 删除。

### 3.4 修复历史包

早期导出的 ZIP 里 `metadata.json` 缺尺寸/提示词，可用脚本就地升级（用 sharp 重新测量尺寸、
补齐 `files[]`；`uploads/` 里还留着参考图就一并收进 `source/reference.*`）：

```bash
npm run repair-pack -- <packId>            # 修复单个包
npm run repair-pack -- --all               # 修复所有旧 schema 的包
npm run repair-pack -- --all --dry-run     # 只看会改什么
```

原包会备份成 `<packId>.zip.orig`，`packId` 与下载链接不变。生成上下文（原始提示词/风格/提供商）
旧版本没落盘，只能从浏览器 localStorage 找回：

```js
// 项目页面 F12 → console
copy(localStorage.getItem('easysticker:last-wechat-pack'))
```

存成 `context.json` 后 `npm run repair-pack -- <packId> --context context.json` 写回 `generation` 与逐张提示词。

---

## 4. 备份

所有持久化数据都在 `./data/`：

| 路径 | 内容 |
|------|------|
| `data/users.json` | 用户账户（邮箱、密码哈希、角色） |
| `data/uploads/` | **所有素材**（表情图、参考图、扩展资源） |
| `data/uploads/.owners.jsonl` | 素材归属索引（`assetId → owner`，追加写）。硬删账号清理散图用；备份建议一并带上 |
| `data/packs/` | 包清单（含逐张提示词/尺寸/owner） |
| `data/usage/` | 使用量统计 |
| `data/monitoring/` | 请求/系统/磁盘指标 JSONL，按天分文件 |
| `data/alerts-config.json` / `data/alerts-history.json` | 告警规则与历史 |
| `data/maintenance.json` | 保留期策略生效起点（**恢复备份时一并带上**） |

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

> 恢复后请保留 `data/maintenance.json`，否则保留期策略会重新计时（包不会被立刻删，但窗口会重置）。

---

## 5. 压测

用 [autocannon](https://github.com/mcollina/autocannon)：`npm i -g autocannon`。

```bash
autocannon -c 50 -d 30 http://localhost:3000/health
autocannon -c 20 -d 30 http://localhost:3000/
autocannon -c 20 -d 30 -H "Authorization: Bearer <TOKEN>" http://localhost:3000/api/auth/me
```

**注意**：限流默认 30 req/min、匿名日配额 10，压测/跑 e2e 前务必放宽，否则结果全是 429：

```bash
RATE_LIMIT_MAX=600 DAILY_QUOTA_ANONYMOUS_MAX=500 node dist/server.js
```

参考量级（Mac mini M2，Docker 容器内，仅用于判断是否数量级异常）：

| 场景 | RPS | P99 |
|------|-----|-----|
| `/health`（50 并发） | ~850 | 113ms |
| 首页静态（20 并发） | ~400 | 81ms |
| 认证 API（20 并发） | ~260 | 177ms |

> 首页首次加载会把 `styles.css` 与 6 个 `js` 拉一遍，之后靠内容哈希长缓存命中（0 请求、0 字节）。
> 压测静态资源时注意区分「冷启动」与「已预热」。

---

## 6. 排障速查

| 现象 | 多半是 |
|------|--------|
| 生成进度卡住不动 | 反代把 SSE 缓冲了（`proxy_buffering off`） |
| 后台仪表盘「已断开，正在重连」 | 同上；前端会自动退避重连并退回 REST 兜底 |
| 图片 404 / ZIP 打不出来 | 素材被按 mtime 的清理脚本删了，或包引用的素材缺失（`npm run gc` 能看到） |
| 忘记管理员密码 | 设置 `ADMIN_PASSWORD` 重启；或删 `data/users.json` 里的对应用户重新注册为管理员 |
| 重启后所有人被登出 | 未固定 `JWT_SECRET` |
| 大量 429 | 限流/日配额太紧，或压测时没放宽（见 §5） |
| 首页还在跑旧的前端代码 | 跑 `npm run web:build`（会同时刷新 HTML 里的内容哈希） |
| 生成结果一直是随机图 | `ai.defaultProvider` 还是 `mock` |
