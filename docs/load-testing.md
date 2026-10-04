# EasySticker 压力测试

使用 [autocannon](https://github.com/mcollina/autocannon) 对关键端点进行压测。

## 安装

```bash
npm install -g autocannon
```

## 测试场景

### 1. 健康检查

```bash
autocannon -c 50 -d 30 http://localhost:3000/health
```

- 50 并发连接
- 持续 30 秒

### 2. 首页静态资源

```bash
autocannon -c 20 -d 30 http://localhost:3000/
```

- 20 并发，30 秒

### 3. 登录接口（带限流）

```bash
autocannon -c 10 -d 10 \
  -m POST \
  -H "Content-Type: application/json" \
  -b '{"email":"admin@easysticker.app","password":"test123456"}' \
  http://localhost:3000/api/auth/login
```

- 10 并发，10 秒
- 注意：登录接口有限流（5/min），此测试会触发 429

### 4. API 认证接口

```bash
autocannon -c 20 -d 30 \
  -H "Authorization: Bearer <YOUR_TOKEN>" \
  http://localhost:3000/api/auth/me
```

- 20 并发，30 秒
- 需要先获取有效 token

## 测试结果（Mac mini M2, Docker 模式）

| 场景 | 实际 RPS | 实际 P99 延迟 | 错误率 |
|------|---------|-------------|-------|
| 健康检查（50并发/20s） | ~850 | 113ms | 0% |
| 首页（20并发/20s） | ~400 | 81ms | 0% |
| 登录（10并发/10s） | 限流触发（~9 成功） | — | 100% 429（预期） |
| 认证 API（20并发/20s） | ~260 | 177ms | 0% 2xx，100% 401（密码错误） |

> 认证 API 的 RPS 受限于 JWT 验证开销，仍远高于正常流量。以上测试均在 Docker 容器中运行，直接运行可更高。

## 期望指标

| 场景 | 期望 RPS | 期望 P99 延迟 | 期望错误率 |
|------|---------|-------------|-----------|
| 健康检查 | ≥500 | <50ms | 0% |
| 首页 | ≥100 | <200ms | 0% |
| 登录 | — | — | 会触发 429（限流正常） |
| 认证 API | ≥200 | <100ms | 0% |
