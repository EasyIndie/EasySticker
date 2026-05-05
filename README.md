# EasySticker

Node.js + TypeScript 的表情包自动化生产与打包服务（Fastify）。

## 本地运行

```bash
# 安装依赖
npm i

# 开发模式运行 (热更新)
npm run dev

# 生产模式运行
npm run prod
```

- Web UI: http://localhost:3000/
- API 文档: http://localhost:3000/docs

## 配置文件 (prompt-config.json)

所有系统和 AI 相关的参数均通过根目录下的 JSON 配置文件进行集中管理。

系统启动时会优先读取 **`prompt-config.json`**（用户自定义配置，建议添加到 `.gitignore`）。如果不存在或部分字段缺失，则会自动回退并深度合并 **`prompt-config.default.json`** 中的出厂默认配置。

### 1. 服务器与系统配置
在配置文件的 `server` 节点下可以设置运行端口、数据目录和日志级别等：
```json
{
  "server": {
    "host": "0.0.0.0",
    "port": 3000,
    "dataDir": "data",
    "logLevel": "info"
  }
}
```

### 2. AI 模型提供商配置
系统支持同时配置多个 AI 模型提供商，并在前端自由切换（生产环境下会自动隐藏 mock 选项）。在配置文件的 `ai` 节点下进行配置：

```json
{
  "ai": {
    "defaultProvider": "doubao", // 默认选中的提供商 ID
    "referenceMode": "base64",   // 参考图传输模式: base64 | url | assetId | multipart
    "providers": {
      // 1. 豆包大模型 (火山引擎 Ark)
      "doubao": {
        "type": "doubao",
        "name": "豆包大模型",
        "baseUrl": "https://ark.cn-beijing.volces.com/api/v3",
        "model": "doubao-seedream-5-0-260128",
        "apiKey": "YOUR_ARK_API_KEY"
      },
      // 2. OpenAI 图片生成
      "openai": {
        "type": "openai",
        "name": "OpenAI 图片生成",
        "baseUrl": "https://api.openai.com/v1",
        "model": "gpt-image-1.5",
        "apiKey": "YOUR_OPENAI_API_KEY",
        "background": "transparent",
        "quality": "auto",
        "outputFormat": "png",
        "moderation": "auto",
        "inputFidelity": "high"
      },
      // 3. HuggingFace Inference
      "hf": {
        "type": "hf",
        "name": "HuggingFace",
        "endpoint": "https://router.huggingface.co/hf-inference/models/black-forest-labs/FLUX.1-schnell",
        "apiKey": "YOUR_HF_TOKEN"
      },
      // 4. 通用 HTTP 服务 (对接私有部署或第三方 API)
      "my-custom-api": {
        "type": "http",
        "name": "公司内部模型",
        "endpoint": "http://internal-api.company.com/generate",
        "apiKey": "YOUR_CUSTOM_KEY"
      }
    }
  }
}
```
**说明：**
- 每个 Provider 必须声明底层驱动 `type`（如 `doubao`, `hf`, `http`, `mock` 等）。
- `key`（如上文的 `my-custom-api`）可以自由命名，作为该提供商的唯一 ID。
- `name` 字段用于前端下拉框的友好展示。
- 只有参数配置完整（如填写了正确的 `apiKey` 或 `endpoint`）的提供商才会在前端页面中显示。
- OpenAI Provider 会在无参考图时调用图片生成接口，在有参考图时调用图片编辑接口；本项目默认通过 `referenceMode: "base64"` 传递参考图。

## AI 最小流程（微信）

接口：
- `POST /api/wechat/prompt`：返回提示词模板与风格列表
- `POST /api/wechat/generate/start`：发起批量生成任务
- `GET /api/wechat/generate/stream`：获取生成进度的 SSE 数据流

## 本地 mock AI HTTP 服务（联调用）

你可以启动一个独立的 Mock HTTP 服务来测试 `http` 类型的提供商：

```bash
npm run mock-ai
```
配合使用：在 `prompt-config.json` 中添加一个 `type: "http"` 的 provider，并将其 `endpoint` 指向 `http://127.0.0.1:8787`。

HTTP 契约详情见：
- [ai-http-contract.md](https://github.com/EasyIndie/EasySticker/spec/ai-http-contract.md)

## 本地 ComfyUI 接入

如果使用 ComfyUI Desktop，可以让 EasySticker 在真正生成时自动启动本地适配器，无需手动常驻 `comfy-adapter`：

```json
{
  "ai": {
    "defaultProvider": "comfy-local",
    "referenceMode": "base64",
    "imageSize": { "width": 512, "height": 512 },
    "settings": {
      "timeoutMs": 300000,
      "retryMax": 0,
      "retryBaseMs": 1000
    },
    "providers": {
      "comfy-local": {
        "type": "http",
        "name": "本地 ComfyUI",
        "endpoint": "http://127.0.0.1:8787/generate",
        "autoStart": {
          "command": "npm",
          "args": ["run", "comfy-adapter"],
          "cwd": ".",
          "healthUrl": "http://127.0.0.1:8787/health",
          "cancelUrl": "http://127.0.0.1:8787/cancel",
          "startupTimeoutMs": 20000,
          "idleMs": 120000
        }
      }
    }
  }
}
```

使用前只需要保持 ComfyUI Desktop 运行在 `http://127.0.0.1:8000`，并确保 `comfy/workflow_api.json` 指向可用 checkpoint。`autoStart.idleMs` 表示适配器空闲多久后自动停止；设为 `0` 可禁用自动停止。`cancelUrl` 用于页面离开或手动取消时中断本地 ComfyUI 当前任务。

### 本地 ComfyUI 表情包质量档位

`comfy-local` provider 支持通过 `comfy.qualityPreset` 选择本地图生图参数，适合微信人物表情包的默认档位如下：

```json
{
  "comfy": {
    "qualityPreset": "standard",
    "qualityPresets": {
      "fast": { "steps": 16, "cfg": 5.5, "denoise": 0.4, "samplerName": "dpmpp_2m", "scheduler": "karras" },
      "standard": { "steps": 22, "cfg": 5.5, "denoise": 0.45, "samplerName": "dpmpp_2m", "scheduler": "karras" },
      "quality": { "steps": 28, "cfg": 6, "denoise": 0.5, "samplerName": "dpmpp_2m", "scheduler": "karras" },
      "expressive": { "steps": 26, "cfg": 6.5, "denoise": 0.6, "samplerName": "dpmpp_2m", "scheduler": "karras" }
    }
  }
}
```

调参建议：人物不像参考图时降低 `denoise`；动作和表情不够夸张时提高到 `expressive`；最终批量出图时用 `quality`。如果下载了更适合贴纸的 checkpoint，可在 `comfy.checkpoint` 或对应 preset 里填写 ComfyUI 识别到的模型名。

## Docker 部署

在构建和运行 Docker 容器时，建议通过挂载卷的方式将你的自定义 `prompt-config.json` 注入到容器中：

```bash
docker build -t easysticker .

docker run -d -p 3000:3000 \
  -v "$PWD/data:/app/data" \
  -v "$PWD/prompt-config.json:/app/prompt-config.json" \
  easysticker
```
