# 安全策略

## 报告漏洞

**请不要为安全漏洞开公开 Issue。** 请通过以下任一方式私下联系：

- GitHub Security Advisories：仓库 **Security → Report a vulnerability**（推荐）
- 或邮件联系维护者（见 GitHub 主页）

请尽量附上：影响版本、复现步骤、影响面评估。我们会在 **72 小时内**确认收到，
并在修复后于 [CHANGELOG](CHANGELOG.md) 中致谢（除非你希望匿名）。

## 支持范围

项目仍在 `0.x`，仅对最新 `main` 与最新 tag 提供安全修复。

## 安全模型（自托管前提）

EasySticker 设计为**单租户、自托管**，默认假定部署在反向代理之后、不直接暴露端口。
理解以下边界有助于判断风险：

- **鉴权**：`API_TOKEN`（机器对机器）+ 用户 JWT。**`API_TOKEN` 留空时鉴权关闭**
  （例外：首次初始化且 `data/` 为空时会临时用管理员密码作为邀请码），
  任何人都能调用接口并消耗你的 AI 额度。面向公网部署必须设置。
- **账号**：默认单管理员（首个注册用户）；管理员账号受保护，不能被停用 / 删除。
  被停用或删除的账号，其已签发的 JWT 会**立即失效**（不再等到 7 天过期）。
- **密钥**：仅放在 `.env`（`AI_<PROVIDER_ID>_API_KEY`、`JWT_SECRET`、`API_TOKEN`），
  环境变量优先于 `prompt-config.json`，接口**不回显**密钥。生产环境务必固定 `JWT_SECRET`，
  否则重启后所有登录失效。
- **归属边界**：`GET /api/packs` 只返回请求者自己的包（管理员返回全部）；删包 / 还原要求
  owner 匹配或管理员，无归属的历史旧包为兼容而放行。包内容的凭证是不可猜的 `packId`（nanoid）。
- **只读资源**：`/api/assets/:id`、`/api/packs/:id/download` 豁免鉴权（`<img>` / `<a>` 无法带
  `Authorization`），其安全性依赖 `packId` / `assetId` 不可猜。
- **限流与配额**：按 IP 限流（默认 30 次/分；登录 / 注册 5 次/分；已认证管理员 600 次/分），
  匿名按 IP 计日配额，登录用户按账号计。这些是**防滥用**手段，不是多租户隔离。
- **文件安全**：素材查找用 assetId 白名单挡住路径穿越；上传限制为 PNG / JPEG；
  CSP 为 `script-src 'self'`，后台全部用事件委托，无内联脚本。

## 部署基线建议

- 不要直接暴露 3000 端口；用 Nginx / Caddy 终止 TLS。
- 设置 `API_TOKEN`、`JWT_SECRET`、`ADMIN_PASSWORD`，并放到 `.env`（已在 `.gitignore`）。
- 反代下开启 `server.security.trustProxy`，让限流拿到真实 IP。
- 定期备份 `data/`（含 `data/maintenance.json`）。

逐项检查清单见 [部署指南 · 安全基线](docs/deployment.md#5-安全基线)，
备份与恢复见 [运维手册](docs/operations.md#5-备份与恢复)。
