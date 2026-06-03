# EasySticker 部署指南

## 概览

EasySticker 是一个自托管的 AI 表情包生成服务。本文档说明如何用 Docker + Nginx 反向代理将其部署到公网，实现 HTTPS 安全访问。

## 目录

1. [快速部署（Docker）](#1-快速部署docker)
2. [HTTPS 反向代理（Nginx）](#2-https-反向代理nginx)
3. [环境变量参考](#3-环境变量参考)
4. [安全加固](#4-安全加固)
5. [常见问题](#5-常见问题)

---

## 1. 快速部署（Docker）

### 前置条件
- 服务器已安装 Docker 和 Docker Compose
- 域名（如 `sticker.example.com`）已解析到服务器 IP
- 服务器开放 80（HTTP 临时）和 443（HTTPS）端口

### 克隆项目
```bash
git clone https://github.com/EasyIndie/EasySticker.git
cd EasySticker
```

### 创建配置文件
```bash
cp prompt-config.default.json prompt-config.json
```

编辑 `prompt-config.json`，至少配置一个 AI 提供商（如不配则只有随机图片模式可用）。

### 启动服务
```bash
# 先启动 EasySticker（监听 127.0.0.1:3000，不直接暴露公网）
docker compose up -d easysticker
```

访问 `http://localhost:3000` 验证服务运行正常，然后配置反向代理。

---

## 2. HTTPS 反向代理（Nginx）

> ⚠️ **不要将 EasySticker 直接暴露到公网（端口 3000）**。必须通过反向代理提供 HTTPS 加密。

### 方案一：Certbot + Nginx（推荐）

#### 1. 安装 Nginx 和 Certbot
```bash
# Ubuntu/Debian
sudo apt update
sudo apt install nginx certbot python3-certbot-nginx
```

#### 2. 配置 Nginx

创建 `/etc/nginx/sites-available/easysticker`：

```nginx
server {
    listen 80;
    server_name sticker.example.com;

    # 首次配置时 Certbot 会处理证书，先保留 HTTP
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # SSE 支持（生成进度推送）
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 86400s;

        # WebSocket 支持（仅必要时）
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }

    # 限制上传大小（参考图最多 10MB）
    client_max_body_size 10m;
}
```

#### 3. 启用站点并申请证书
```bash
sudo ln -s /etc/nginx/sites-available/easysticker /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx

# 申请证书（Certbot 会自动修改 nginx 配置添加 HTTPS）
sudo certbot --nginx -d sticker.example.com
```

#### 4. 最终 Nginx 配置（Certbot 自动生成）

Certbot 会在原配置基础上加入 SSL 相关指令。你可以额外添加安全头：

```nginx
server {
    listen 443 ssl;
    server_name sticker.example.com;

    # SSL 证书（由 Certbot 管理）
    ssl_certificate /etc/letsencrypt/live/sticker.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/sticker.example.com/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;

    # 安全头
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Frame-Options "DENY" always;
    add_header X-Content-Type-Options "nosniff" always;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # SSE 支持
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 86400s;

        # WebSocket 支持
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }

    client_max_body_size 10m;
}

# HTTP → HTTPS 重定向（Certbot 自动生成）
server {
    listen 80;
    server_name sticker.example.com;
    return 301 https://$server_name$request_uri;
}
```

#### 5. 验证
```bash
sudo nginx -t
sudo systemctl reload nginx
curl -I https://sticker.example.com
```

### 方案二：Caddy（更简单，自动 HTTPS）

如果你的服务器有 Caddy，配置只需几行：

```caddyfile
sticker.example.com {
    reverse_proxy 127.0.0.1:3000 {
        # SSE 支持：禁用缓冲
        header_up -Accept-Encoding
    }

    # 限制上传大小
    request_body max_size 10mb
}
```

Caddy 会自动申请和续签 Let's Encrypt 证书。

---

## 3. 环境变量参考

### 安全相关

| 变量 | 必需 | 默认值 | 说明 |
|------|------|--------|------|
| `API_TOKEN` | 强烈推荐 | — | API 认证密钥。不设置则认证关闭，任何人可调用 API |
| `JWT_SECRET` | 推荐 | — | JWT 签名密钥。不设置则随机生成，服务重启后所有令牌失效 |
| `ADMIN_PASSWORD` | 推荐 | 随机生成 | 管理员密码。不设置则每次重启生成随机密码 |
| `DISABLE_AUTH` | 可选 | — | 设为 `1` 强制关闭认证（仅开发环境使用） |

### 服务配置

| 变量 | 必需 | 默认值 | 说明 |
|------|------|--------|------|
| `PORT` | 可选 | 3000 | 服务监听端口（反向代理场景无需修改） |
| `NODE_ENV` | 推荐 | production | 生产环境设为 `production` |
| `DATA_DIR` | 可选 | `./data` | 数据存储目录 |
| `LOG_LEVEL` | 可选 | `info` | 日志级别：`trace`/`debug`/`info`/`warn`/`error` |

### 速率限制与配额

| 变量 | 可选 | 默认值 | 说明 |
|------|------|--------|------|
| `RATE_LIMIT_MAX` | 可选 | 30 | 每分钟每 IP 最大请求数 |
| `DAILY_QUOTA_MAX` | 可选 | 100 | 每日每用户最大生成次数 |
| `CORS_ALLOW_ORIGIN` | 可选 | — | 允许跨域的来源，留空则只有同源可访问 |

### 邮件服务（密码重置）

| 变量 | 适用场景 | 说明 |
|------|---------|------|
| `SMTP_HOST` | 需要密码重置 | SMTP 服务器地址 |
| `SMTP_PORT` | 需要密码重置 | SMTP 端口（默认 587） |
| `SMTP_USER` | 需要密码重置 | SMTP 用户名 |
| `SMTP_PASS` | 需要密码重置 | SMTP 密码 |
| `SMTP_FROM` | 需要密码重置 | 发件人地址 |
| `BASE_URL` | 需要密码重置 | 外部访问地址（用于生成密码重置链接） |

### Docker Compose 环境变量

```yaml
services:
  easysticker:
    environment:
      - API_TOKEN=${API_TOKEN}
      - JWT_SECRET=${JWT_SECRET}
      - ADMIN_PASSWORD=${ADMIN_PASSWORD}
      - SMTP_HOST=${SMTP_HOST}
      - SMTP_PORT=${SMTP_PORT}
      - SMTP_USER=${SMTP_USER}
      - SMTP_PASS=${SMTP_PASS}
      - SMTP_FROM=${SMTP_FROM}
      - BASE_URL=${BASE_URL}
```

创建 `.env` 文件：

```bash
# .env — 不要提交到版本控制！
API_TOKEN=your-secure-api-token-here
JWT_SECRET=your-jwt-secret-here
ADMIN_PASSWORD=your-admin-password-here

# 邮件（可选，用于密码重置）
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=noreply@example.com
SMTP_PASS=your-smtp-password
SMTP_FROM=noreply@example.com
BASE_URL=https://sticker.example.com
```

---

## 4. 安全加固

### 4.1 认证和注册

`prompt-config.json` 中的 `server.security.registration` 控制注册策略：

```json
{
  "server": {
    "security": {
      "registration": {
        "mode": "invite"
      }
    }
  }
}
```

| 模式 | 功能 | 适用场景 |
|------|------|---------|
| `open` | 任何人可注册 | 开发/测试环境 |
| `invite` | 需管理员邀请码（API_TOKEN）才能注册 | 公测、团队使用 |
| `closed` | 禁止注册 | 私有部署、仅管理员可用 |

第一个注册的用户自动成为管理员（三种模式下均如此）。

### 4.2 防火墙

```bash
# 只暴露 443 和 22 端口
sudo ufw allow 443/tcp
sudo ufw allow 22/tcp
sudo ufw deny 3000/tcp
sudo ufw enable
```

### 4.3 定期更新

```bash
# 更新 EasySticker
cd /opt/EasySticker
git pull
docker compose up -d --build easysticker

# 更新系统
sudo apt update && sudo apt upgrade -y
```

### 4.4 数据备份

EasySticker 的所有持久化数据存储在 `./data/` 目录下，包含：

| 路径 | 内容 |
|------|------|
| `data/users.json` | 用户账户（邮箱、密码哈希、角色） |
| `data/usage.json` | 使用量统计 |
| `data/monitor/` | 请求监控数据 |
| `data/uploads/` | 用户上传的文件 |

#### 手动备份

```bash
# 备份全部数据
tar czf backup-$(date +%Y%m%d-%H%M%S).tar.gz ./data

# 恢复到指定目录
mkdir -p /backup/app && tar xzf backup-20260603.tar.gz -C /backup/app
```

#### 定期自动备份（crontab）

```bash
# 每天凌晨 3 点备份，保留最近 30 天
0 3 * * * cd /path/to/easysticker && \
  tar czf /backups/easysticker-\$(date +\\%Y\\%m\\%d).tar.gz ./data && \
  find /backups -name 'easysticker-*.tar.gz' -mtime +30 -delete
```

#### Docker 卷备份

若使用具名卷（Docker Compose 默认），备份方法：

```bash
# 创建临时容器挂载卷，导出数据
docker run --rm -v easysticker_data:/data -v /backups:/backup alpine \
  tar czf /backup/easysticker-$(date +%Y%m%d).tar.gz -C /data .
```

> **建议**：至少保留 30 天备份，并定期测试恢复流程。

---

## 5. 常见问题

### Q: 为什么需要反向代理？
EasySticker 本身是 HTTP 服务，不处理 SSL 证书。通过 Nginx/Caddy 反向代理可以提供：
- HTTPS 加密（防止密码/Token 被截获）
- 防 DDoS、请求过滤
- 静态文件缓存加速

### Q: 首次启动后管理员密码在哪里？
如果未设置 `ADMIN_PASSWORD` 环境变量，系统会生成随机密码并打印在启动日志中：

```
🔑 Default admin: admin@easysticker.app / aB3xK9mP2qR7
```

查看 Docker 日志：
```bash
docker compose logs easysticker | grep "Default admin"
```

建议登录后立即修改密码，并配置 `ADMIN_PASSWORD` 环境变量确保重启后密码不变。

### Q: API_TOKEN 有什么用？
- 作为 API 认证密钥（放在 `Authorization: Bearer <token>` 头中）
- 作为管理员邀请码（注册 `invite` 模式时需要提供）
- 不设置则认证完全关闭，任何人都可以调用生成 API

### Q: 如何查看服务健康状态？
```bash
curl -f http://localhost:3000/health
# 或通过外部域名
curl -f https://sticker.example.com/health
```

Docker 容器内置 HEALTHCHECK，每 30 秒检查一次，`docker ps` 可查看状态。

### Q: 如何获取 SMTP 服务？
- 个人用户：可使用 QQ 邮箱的 SMTP 服务（需开启 SMTP 并获取授权码）
- 企业用户：可使用飞书/企业微信的邮件服务
- 开发环境：不配置 SMTP 的话，密码重置链接会打印到控制台日志中
