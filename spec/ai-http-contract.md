# HTTP AI Provider 契约（EasySticker）

本项目通过 `AI_PROVIDER=http` 将图片生成请求转发到外部 AI 服务。为了减少对接成本，这里约定一个最小、稳定、可扩展的 HTTP 契约。

## Endpoint

- Method: `POST`
- URL: `AI_HTTP_ENDPOINT`
- Content-Type: `application/json`
- Auth: 可选 `Authorization: Bearer ${AI_HTTP_API_KEY}`

## Request（JSON）

必填字段：

- `prompt`: string
- `width`: number
- `height`: number

可选字段：

- `negativePrompt`: string
- `style`: string

参考图（任选一种即可；服务端会按配置发送）：

- `referenceImageBase64`: string（base64，无 data URL 头）
- `referenceImageMime`: string（例如 `image/png`）
- `referenceImageUrl`: string（外网/内网可访问 URL）
- `referenceImageAssetId`: string（可选：当你的服务与本系统部署在同网段，可用 assetId 反查）
- multipart 表单字段 `referenceImage`: file（二进制上传）

说明：

- 当 `AI_HTTP_REFERENCE_MODE=base64` 时发送 `referenceImageBase64` + `referenceImageMime`
- 当 `AI_HTTP_REFERENCE_MODE=url` 时发送 `referenceImageUrl`（需要设置 `AI_PUBLIC_BASE_URL`）
- 当 `AI_HTTP_REFERENCE_MODE=assetId` 时发送 `referenceImageAssetId`
- 当 `AI_HTTP_REFERENCE_MODE=multipart` 时发送 `multipart/form-data`

## Request（multipart/form-data）

当 `AI_HTTP_REFERENCE_MODE=multipart` 时，请求字段为：

- `prompt`
- `negativePrompt`（可选）
- `style`（可选）
- `width`
- `height`
- `referenceImage`（文件）

## Response

成功响应（两种返回方式任选其一）：

### 方式 A：返回二进制图片
- HTTP 200
- Body: 图片 bytes
- Header: `Content-Type: image/png`（或其他图片类型）

### 方式 B：返回 JSON（base64）
- HTTP 200
- Header: `Content-Type: application/json`
- Body:

```json
{
  "mime": "image/png",
  "imageBase64": "...."
}
```

错误响应：

- HTTP 4xx/5xx
- Body 可为任意文本或 JSON，本系统会统一映射为 `502 ai provider error`
