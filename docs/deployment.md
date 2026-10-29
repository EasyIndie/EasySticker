# 部署指南

> 本文负责**把 EasySticker 安全地跑起来**：Docker / 裸机、反向代理、安全基线、升级。
> 日常运维（日志、备份、清理、排障）见 [运维手册](operations.md)，
> 配置项含义见 [配置参考](configuration-reference.md)。

---

## 1. 部署前检查

### 运行环境

| 方式 | 要求 |
|------|------|
| Docker | Docker Engine + Compose v2（建议使用较新版本），支持 `linux/amd64` / `linux/arm64` |
| 源码 / 裸机 | Node.js 20+、npm；`sharp` 需要常见 Linux 运行库 |
| 数据目录 | 一个可写、可持久化的目录（容器内 `/app/data`） |
| 反向代理 | 公网部署建议 Nginx / Caddy 终止 TLS |

### 必须准备的密钥

| 变量 | 作用 | 不设置的后果 |
|------|------|-------------|
| `API_TOKEN` | API 认证，同时兼作邀请码 | **鉴权关闭**，任何人都能调用接口并消耗 AI 额度 |
| `JWT_SECRET` | 登录 token 签名 | 每次重启随机生成，所有用户被登出 |
| `ADMIN_PASSWORD` | 首个管理员密码 | 每次启动随机生成并打印到日志 |

这三个值放在 `.env` 或宿主机环境变量中，不要提交到仓库，也不要写进 `prompt-config.json`。

> 注意：`API_TOKEN` 留空时鉴权关闭。只有在首次初始化（`data/` 为空）时，服务端会临时
> 使用管理员密码作为邀请码；重启后该临时 token 不会保留。生产环境务必显式设置。

---

## 2. Docker 部署（推荐）

### 2.1 免源码：使用预构建镜像

不需要克隆仓库，也不需要 Node 环境：

```bash
curl -O https://raw.githubusercontent.com/EasyIndie/EasySticker/main/docker-compose.image.yml
curl -o .env https://raw.githubusercontent.com/EasyIndie/EasySticker/main/.env.example

# 编辑 .env，至少填写 API_TOKEN / JWT_SECRET / ADMIN_PASSWORD
docker compose -f docker-compose.image.yml up -d
```

打开 `http://服务器地址:3000/`。

- 镜像：`ghcr.io/easyindie/easysticker`（`linux/amd64` + `linux/arm64`）。
- 默认使用 `:latest`；在 `.env` 中设置 `EASYSTICKER_TAG=<版本号>` 可锁定版本。
- 数据默认映射到 `./data`。
- 如果拉取镜像返回 401 / 404，通常是 GHCR 包尚未设为 public：请让发布者把包可见性改为
  Public，或改用「从源码构建镜像」。

不用 Compose 也可以：

```bash
docker run -d --name easysticker -p 3000:3000 \
  -v "$PWD/data:/app/data" \
  -e API_TOKEN=换成随机串 \
  -e JWT_SECRET=换成随机串 \
  -e ADMIN_PASSWORD=你的密码 \
  ghcr.io/easyindie/easysticker:latest
```

### 2.2 从源码构建镜像

```bash
git clone https://github.com/EasyIndie/EasySticker.git
cd EasySticker
cp .env.example .env      # 填写安全相关变量
docker compose build
docker compose up -d easysticker
```

`docker-compose.yml` 会把宿主 `./data` 挂到容器 `/app/data`，并以非 root 用户运行。

### 2.3 数据、配置与定时清理

| 项目 | 说明 |
|------|------|
| 数据目录 | 必须持久化；备份与迁移只需要这一个目录 |
| 环境变量 | 两个 compose 文件都通过 `env_file: .env` 注入；新增变量不需要改 compose |
| 配置文件 | 默认使用镜像内置的 `prompt-config.default.json`；深度定制时挂载 `prompt-config.json` |
| 挂载注意事项 | 宿主机文件必须**先创建**，否则 Docker 会把不存在的路径建成目录 |
| AI 密钥 | 推荐通过 `AI_<PROVIDER_ID>_API_KEY` 环境变量传入 |
| 定时清理 | 镜像内置 GC；需要容器化定时执行时启用 `cleanup` profile |

`prompt-config.json` 只写与默认值不同的字段。挂载示例：

```yaml
volumes:
  - ./data:/app/data
  - ./prompt-config.json:/app/prompt-config.json:ro
```

启用一次性清理任务：

```bash
docker compose -f docker-compose.image.yml --profile cleanup run --rm cleanup
```

> GC 按**引用关系**判断孤儿素材，并遵守保留期「不追溯既往」。
> 不要用按 mtime 的 `find` / `rm` 清理数据目录，会删坏包。

---

## 3. 裸机 / 源码运行

```bash
git clone https://github.com/EasyIndie/EasySticker.git
cd EasySticker
npm install
cp .env.example .env

npm run build        # 后端 → dist/
npm run web:build    # 前端 → public/js/，并写入内容哈希
npm run prod         # NODE_ENV=production node dist/server.js
```

开发模式使用 `npm run dev` 与 `npm run web:dev`，见 [开发指南](development.md)。

> 改动前端后必须重新执行 `npm run web:build`，否则浏览器会继续使用旧的 immutable 缓存。

---

## 4. 反向代理

### 4.1 Nginx

```nginx
server {
    listen 443 ssl;
    server_name sticker.example.com;
    ssl_certificate     /etc/letsencrypt/live/sticker.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/sticker.example.com/privkey.pem;

    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Frame-Options "DENY" always;
    add_header X-Content-Type-Options "nosniff" always;

    client_max_body_size 10m;   # 参考图上传上限

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # SSE 必需：否则生成进度 / 后台实时指标会被缓冲，表现为「卡住不动」。
        # 涉及 /api/generate/stream 与 /api/admin/monitoring/stream。
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 86400s;
    }
}
```

申请证书：`sudo certbot --nginx -d sticker.example.com`。
反向代理下记得开启 `server.security.trustProxy`，否则限流看到的是代理 IP。

### 4.2 Caddy

```caddyfile
sticker.example.com {
    reverse_proxy 127.0.0.1:3000
    request_body max_size 10mb
}
```

Caddy 默认不缓冲流式响应，SSE 无需额外配置。

### 4.3 防火墙

```bash
sudo ufw allow 443/tcp
sudo ufw allow 22/tcp
sudo ufw deny 3000/tcp
sudo ufw enable
```

只允许反向代理访问 3000 端口。容器部署时可把端口绑定改成 `127.0.0.1:3000:3000`。

---

## 5. 安全基线

面向公网部署时，逐项确认：

- [ ] 已设置 `API_TOKEN`、`JWT_SECRET`、`ADMIN_PASSWORD`，且长度足够。
- [ ] 已启用 HTTPS，3000 端口未直接暴露。
- [ ] 已开启 `server.security.trustProxy`（在反代之后）。
- [ ] 已按需调整 `rateLimit`、`dailyQuota` 与 `registration.mode`。
- [ ] 已配置 `BASE_URL`，密码重置链接才能指向正确域名。
- [ ] 已关闭 `DISABLE_AUTH`（仅开发 / e2e 使用）。
- [ ] 已为 `data/` 配置备份与磁盘告警。

更完整的威胁模型（鉴权、账号、归属、只读资源、文件安全）见 [SECURITY.md](../SECURITY.md)。

---

## 6. 升级、回滚与迁移

### Docker

```bash
# 升级到最新
docker compose -f docker-compose.image.yml pull
docker compose -f docker-compose.image.yml up -d

# 回滚 / 锁版本：在 .env 中设置 EASYSTICKER_TAG=<旧版本>
```

### 源码

```bash
git pull
npm ci
npm run build && npm run web:build
npm run prod
```

### 升级前

1. 备份 `data/`（含 `data/maintenance.json`）；
2. 确认目标版本的 [CHANGELOG](../CHANGELOG.md)，注意 **BREAKING** 条目；
3. 升级后检查 `/health`、登录、生成一条 Mock 任务、下载一个包。

数据目录可整体迁移到新机器；恢复后保留 `data/maintenance.json`，避免保留期策略重新计时。

---

## 7. 上线检查清单

- [ ] `GET /health` 返回 200。
- [ ] 首页、`/docs`、`/admin.html` 可访问。
- [ ] 使用 `ADMIN_EMAIL` / `ADMIN_PASSWORD` 能登录后台。
- [ ] 设置页能看到 AI 提供商，测试连通成功。
- [ ] 生成 / 导入各跑一次，ZIP 能下载并包含 `metadata.json`。
- [ ] 反向代理下 SSE 进度正常推进（不是一次性跳到最后）。
- [ ] 备份任务已配置，`data/` 所在磁盘有足够空间。
