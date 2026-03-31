# EasySticker

Node.js + TypeScript 的表情包自动化生产与打包服务（Fastify）。

## 本地运行

```bash
npm i
npm run dev
```

- Web UI: http://localhost:3000/
- API 文档: http://localhost:3000/docs

## UI 能力

- 上传图片与预览
- 生成提示词（可编辑）
- AI 批量生成微信规范资产（mock 或 HTTP Provider）
- 生成完成后一键下载 ZIP

## 关键 API

- 上传与资产：`POST /api/uploads`、`GET /api/assets/:id`
- 打包：`POST /api/packs`、`GET /api/packs/:packId/download`

## AI 最小流程（微信）

默认使用 mock AI（本地生成占位图），可通过环境变量切换到 HTTP AI 服务：

- `AI_PROVIDER=mock|http`（默认 mock）
- `AI_HTTP_ENDPOINT`（当 AI_PROVIDER=http 时必填，POST，返回图片 bytes 或 JSON `{imageBase64,mime}`）
- `AI_HTTP_API_KEY`（可选）

接口：

- `POST /api/wechat/prompt`：返回提示词模板与风格列表
- `POST /api/wechat/generate`：批量生成微信贴纸 + 封面/图标/横幅，并输出 ZIP 下载链接

## 环境变量

- `PORT`：默认 `3000`
- `HOST`：默认 `0.0.0.0`
- `DATA_DIR`：默认 `./data`
- `LOG_LEVEL`：默认 `info`

## Docker 部署

```bash
docker build -t easysticker .
docker run --rm -p 3000:3000 -e DATA_DIR=/app/data -v "$PWD/data:/app/data" easysticker
```
