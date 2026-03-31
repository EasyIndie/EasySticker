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
- 生成提示词、表情包标题、作者名、版本信息、版权信息、风格与贴纸数量（可编辑）
- AI 批量生成微信规范资产（mock 或 HTTP Provider）
- 生成完成后展示结果摘要、导出信息卡、预览卡片，并一键下载优化命名的 ZIP

## 关键 API

- 上传与资产：`POST /api/uploads`、`GET /api/assets/:id`
- 打包：`POST /api/packs`、`GET /api/packs/:packId/download`

## AI 最小流程（微信）

默认使用 mock AI（本地生成占位图），可通过环境变量切换到 HTTP AI 服务：

- `AI_PROVIDER=mock|http`（默认 mock）
- `AI_HTTP_ENDPOINT`（当 AI_PROVIDER=http 时必填，POST，返回图片 bytes 或 JSON `{imageBase64,mime}`）
- `AI_HTTP_API_KEY`（可选）
- `AI_HTTP_REFERENCE_MODE=base64|url|assetId|multipart`（默认 `base64`）
- `AI_PUBLIC_BASE_URL`（当 `AI_HTTP_REFERENCE_MODE=url` 时建议设置，例如 `http://localhost:3000`）

说明：

- mock provider 现在会读取 `referenceAssetId` 对应图片，并基于参考图主色影响生成结果
- http provider 支持两种参考图传参：
  - `referenceImageBase64` + `referenceImageMime`
  - `referenceImageUrl`
  - `referenceImageAssetId`
  - `multipart/form-data` 的 `referenceImage`
- 真实 AI 接口接入时，可根据对方 API 支持情况在 `base64`、`url`、`assetId`、`multipart` 之间切换

接口：

- `POST /api/wechat/prompt`：返回提示词模板与风格列表
- `POST /api/wechat/generate`：批量生成微信贴纸 + 封面/图标/横幅，并输出 ZIP 下载链接

## 本地 mock AI HTTP 服务（联调用）

```bash
npm run mock-ai
```

环境变量：

- `MOCK_AI_PORT`：默认 8787
- `MOCK_AI_RESPONSE=json|binary`：默认 json

配合主服务使用示例：

```bash
AI_PROVIDER=http AI_HTTP_ENDPOINT=http://127.0.0.1:8787 AI_HTTP_REFERENCE_MODE=base64 npm run dev
```

HTTP 契约详情见：

- [ai-http-contract.md](https://github.com/EasyIndie/EasySticker/spec/ai-http-contract.md)

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
