<p align="center">
  <img src="docs/assets/logo.svg" width="120" alt="EasySticker" />
</p>

<h1 align="center">EasySticker</h1>

<p align="center">
  <strong>表情包 AI 自动化生产线</strong>
  <br />
  参考图 → AI 生成/批量导入 → 自动标准化 → 一键下载 ZIP
</p>

<p align="center">
  <a href="#-quick-start">快速开始</a> •
  <a href="#-features">功能</a> •
  <a href="#-configuration">配置</a> •
  <a href="#-faq">FAQ</a>
</p>

<p align="center">
  <span style="color: #07c160;">⚡ 开源 · 自托管 · Node.js</span>
  <br />
  <span>微信 · Telegram · WhatsApp 三平台支持</span>
  <br />
  <span>Doubao · OpenAI · HuggingFace · ComfyUI · 自定义 HTTP</span>
</p>

---

## 🎯 解决的问题

制作一套表情包需要经历「设计→切图→调尺寸→补封面/图标/横幅→写元数据→校验→打包」一系列繁琐步骤。EasySticker 把整个过程压缩为 **选择平台 → 上传素材 → 配置与生成 → 预览与下载** 几步。

**核心价值：**
- ⏱ **从 2-3 小时 → 5 分钟**：手工做一套 24 张表情包至少 2 小时，AI 生成只需几分钟
- 📐 **自动平台合规**：微信 240×240 PNG、Telegram 512×512 PNG、WhatsApp 512×512 WebP，全部自动处理
- 🧩 **配套资源一站式补齐**：封面图、聊天面板图标、详情页横幅、赞赏引导图/答谢图，一次生成全齐
- 🔐 **数据不外传**：自托管部署，参考图和生成结果全部留在你自己的服务器

---

## ✨ Features

### 🎨 AI 生成流程
| 功能 | 说明 |
|------|------|
| **图生图** | 上传参考人物/角色，AI 基于角色生成多组情绪表情 |
| **多风格** | 支持扁平插画、3D 卡通、日系 Q 版、像素风、国潮风等多种风格（可自定义） |
| **多 AI 后端** | 豆包大模型、OpenAI、HuggingFace、ComfyUI、自定义 HTTP，自由切换 |
| **SSE 实时推送** | 生成进度逐张展示，含进度条和百分比 |
| **智能提示词** | 上传参考图后自动生成推荐提示词 |
| **赞赏图** | 可选开启赞赏，自动生成引导图和答谢图 |

### 📦 导入已有图片
| 功能 | 说明 |
|------|------|
| **批量导入** | PNG/JPG/WebP/GIF 批量导入，自动缩放 |
| **自动补齐** | 补全封面、图标、横幅、赞赏图 |
| **元数据编辑** | 标题、作者、版权、版本号、赞赏语，完整可编辑 |

### 🔧 导出与校验
| 功能 | 说明 |
|------|------|
| **多平台校验** | 微信 240×240 PNG、Telegram 512×512 PNG、WhatsApp 512×512 WebP |
| **结构化 ZIP** | 主表情 + 封面图标 + 横幅 + metadata.json，开箱即提交 |
| **文件尺寸自动控制** | WebP 质量递减至 ≤100KB，PNG 超限自动 palette 量化 |
| **Swagger API** | 完整的 OpenAPI 文档（`/docs`） |

---

## 🚀 Quick Start

### 前置条件
- Node.js 20+
- npm

### 1. 克隆并安装
```bash
git clone https://github.com/EasyIndie/EasySticker.git
cd EasySticker
npm install
```

### 2. 配置 AI 提供商（可选）
不配置也能以随机图片模式启动。需要真实 AI 生成能力时复制配置模板并填入 API Key：

```bash
cp prompt-config.default.json prompt-config.json
```

编辑 `prompt-config.json`，配置至少一个 AI 提供商（以火山引擎豆包为例）：

```json
{
  "ai": {
    "defaultProvider": "doubao",
    "providers": {
      "doubao": {
        "type": "doubao",
        "name": "豆包大模型",
        "baseUrl": "https://ark.cn-beijing.volces.com/api/v3",
        "model": "doubao-seedream-5-0-260128",
        "apiKey": "YOUR_ARK_API_KEY"
      }
    }
  }
}
```

### 3. 启动
```bash
# 开发模式（热更新）
npm run dev

# 生产模式
npm run prod
```

打开 http://localhost:3000/ 即可使用。

### Docker 部署
```bash
docker compose build
docker compose up -d
```

环境变量（可选）：
- `ADMIN_PASSWORD` — 管理员密码
- `API_TOKEN` — API 认证密钥
- `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` / `SMTP_FROM` — 邮件服务
- `BASE_URL` — 外部访问地址（用于密码重置链接）
- `PORT` — 服务端口（默认 3000）

---

## 🔧 支持的 AI 提供商

| 提供商 | 类型 | 说明 | 成本 |
|--------|------|------|------|
| **豆包大模型** (火山引擎) | `doubao` | 中文理解好，生图质量稳定，推荐优先使用 | 按量付费（便宜） |
| **OpenAI** | `openai` | GPT Image，参考图强编辑 | 按量付费（中等） |
| **HuggingFace** | `hf` | 开源模型，免费额度 | 免费额度 / 付费 |
| **ComfyUI 本地** | `http` | 本地图生图，数据不出门，可精调参数 | 自备 GPU |
| **自定义 HTTP** | `http` | 对接私有部署或第三方 API | 自定 |
| **随机图片 (Mock/Picsum)** | `mock` / `picsum` | 无需 API Key，用于功能测试 | 免费 |

---

## 🏗 Architecture

```
┌─────────────┐    ┌──────────────────┐    ┌──────────────┐
│   Web UI    │    │   Fastify API    │    │  AI Provider │
│  (原生 JS)   │───▶│  (Node.js + TS)  │────│  (插件化)     │
│             │    │                  │    │ ┌──────────┐ │
│  · 上传参考图 │    │  · 图生图流水线   │    │ │ Doubao   │ │
│  · 编辑信息  │    │  · 表情校验      │    │ │ OpenAI   │ │
│  · 预览下载  │    │  · ZIP 打包     │    │ │ HF       │ │
│  · 历史记录  │    │  · SSE 流推送   │    │ │ ComfyUI  │ │
└─────────────┘    │  · 元数据注入    │    │ │ HTTP     │ │
                   └───────┬──────────┘    │ │ Mock     │ │
                           │                │ └──────────┘ │
                           ▼                └──────────────┘
                   ┌──────────────┐
                   │  Sharp 图片   │
                   │  处理引擎     │
                   │  缩放/格式    │
                   │  转换/量化    │
                   └──────────────┘
```

**技术栈：** Node.js 20 · TypeScript · Fastify · Sharp · SSE · Docker

---

## 📋 配置参考

所有系统参数通过 `prompt-config.json` 集中管理。如果该文件不存在，系统自动使用 `prompt-config.default.json` 默认配置。

### 关键配置
- **server.port / host**：服务监听地址
- **server.dataDir**：数据存储目录（默认 `data`）
- **ai.defaultProvider**：默认 AI 提供商 ID
- **ai.providers**：各 AI 提供商的 endpoint、apiKey、model 等
- **ai.imageSize**：生成图的宽高（默认 1024×1024）
- **emotions**：情绪词列表，按顺序分配给每张贴纸
- **templates.sticker / templates.extra**：提示词模板

完整配置说明见 **[prompt-config.default.json](prompt-config.default.json)**。

---

## 🤔 FAQ

**Q: 需要自己的 AI API Key 吗？**
A: 不需要也能启动（随机图片模式）。但想要真正的 AI 生成能力，需要至少配置一个 AI 提供商（豆包、OpenAI、HF 等）。

**Q: 生成的图片存储在哪里？**
A: 全部存储在服务器的 `data/` 目录下。任务默认 1h 后自动清理。

**Q: 支持微信表情开放平台提审吗？**
A: 输出 ZIP 包完全符合微信表情开放平台的上架规范，可以直接用该 ZIP 提交审核。目前不支持通过 API 自动提审。

**Q: 支持商用吗？**
A: 项目采用 MIT 许可证，可自由使用和修改。注意生成的图片版权取决于底层的 AI 模型服务条款。

**Q: 生图质量不满意怎么办？**
A: 可调整提示词、更换风格、切换 AI 提供商。ComfyUI 用户可通过 qualityPreset 调参。

---

## 📄 License

MIT © 2025-2026 EasySticker Contributors

---

<p align="center">
  <sub>Made with ❤️ for the sticker community</sub>
</p>
