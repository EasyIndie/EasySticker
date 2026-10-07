<p align="center">
  <img src="docs/assets/logo.svg" width="120" alt="EasySticker" />
</p>

<h1 align="center">EasySticker</h1>

<p align="center">
  <strong>表情包 AI 自动化生产线</strong>
  <br />
  参考图 → AI 生成 / 批量导入 → 自动标准化 → 一键下载 ZIP
</p>

<p align="center">
  <a href="#-quick-start">快速开始</a> •
  <a href="#-docker-部署">Docker 部署</a> •
  <a href="#-features">功能</a> •
  <a href="#-faq">FAQ</a> •
  <a href="docs/README.md">文档</a>
</p>

<p align="center">
  <a href="https://github.com/EasyIndie/EasySticker/actions/workflows/ci.yml"><img src="https://github.com/EasyIndie/EasySticker/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <a href="https://github.com/EasyIndie/EasySticker/pkgs/container/easysticker"><img src="https://img.shields.io/badge/ghcr.io-easysticker-2496ED?logo=docker&logoColor=white" alt="GHCR" /></a>
  <a href="https://github.com/EasyIndie/EasySticker/releases"><img src="https://img.shields.io/github/v/release/EasyIndie/EasySticker" alt="Release" /></a>
  <img src="https://img.shields.io/badge/node-%3E%3D20-339933?logo=node.js&logoColor=white" alt="Node" />
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-blue" alt="License" /></a>
</p>

<p align="center">
  <span>⚡ 开源 · 自托管 · Node.js · 微信 / Telegram / WhatsApp</span>
</p>

---

## 📸 界面

<p align="center">
  <img src="docs/screenshots/home.png" width="880" alt="选择平台与创建方式" />
  <br />
  <sub>选择目标平台与创建方式 —— 微信 / Telegram / WhatsApp，或改为批量导入已有图片</sub>
</p>

<p align="center">
  <img src="docs/screenshots/config.png" width="620" alt="配置与信息" />
  <br />
  <sub>逐卡片配置：提供商、提示词、风格、数量、标题作者、赞赏信息</sub>
</p>

<p align="center">
  <img src="docs/screenshots/preview.png" width="880" alt="预览与下载" />
  <br />
  <sub>预览逐张标注实际使用的提示词 / 情绪 / 风格，每张都能单独重新生成或编辑</sub>
</p>

---

## 🎯 解决的问题

制作一套表情包要经历「设计 → 切图 → 调尺寸 → 补封面/图标/横幅 → 写元数据 → 校验 → 打包」。
EasySticker 把整个过程压缩为 **选择平台 → 准备参考图 → 配置与生成 → 预览与下载**。

**核心价值：**

- ⏱ **从 2-3 小时 → 5 分钟**：手工做一套 24 张表情包至少 2 小时，AI 生成只需几分钟
- 📐 **自动平台合规**：微信 240×240 PNG、Telegram 512×512 PNG、WhatsApp 512×512 WebP，全部自动处理
- 🧩 **配套资源一站式补齐**：封面图、聊天面板图标、详情页横幅、赞赏引导图/答谢图
- 🔐 **数据不外传**：自托管部署，参考图和生成结果全部留在你自己的服务器

---

## ✨ Features

### 🎨 AI 生成流程

| 功能 | 说明 |
|------|------|
| **图生图** | 上传参考人物/角色，AI 基于角色生成多组情绪表情 |
| **AI 生成参考图** | 没有现成图片？用文字描述让 AI 先生成一张参考图（文生图）；也可以再传底图走图生图（参考图 + 文字，支持 1 张主底图 + 3 张附加参考图），再据此生成整套 |
| **多风格** | 12 种内置风格：扁平插画、贴纸、3D 卡通、日系 Q 版、像素风、国潮风、手绘涂鸦、水彩风、软萌毛绒、黏土 3D、极简线条、复古漫画（可自定义） |
| **多 AI 后端** | 统一 OpenAI 兼容接口，可对接 OpenAI 或任意兼容网关，自由切换 |
| **SSE 实时推送** | 生成进度逐张展示，含进度条和百分比 |
| **智能提示词** | 参考图就绪后自动生成推荐提示词 |
| **赞赏图** | 可选开启赞赏，自动生成引导图和答谢图 |
| **单资源重生成** | 某张失败时只重生成这一张，不重跑整包 |
| **单图二次编辑** | 任一已生成的图都能「编辑图片」：填一句要求只重做这一张，还可再附一张参考图 |

### 📦 导入已有图片

| 功能 | 说明 |
|------|------|
| **批量导入** | PNG/JPG/WebP/GIF 批量导入，自动缩放 |
| **自动补齐** | 补全封面、图标、横幅、赞赏图 |
| **元数据编辑** | 标题、作者、版权、版本号、赞赏语，完整可编辑 |
| **导入 ZIP 还原** | 选择本站下载的 ZIP 即可读回提示词 / 风格 / 情绪 / 参考图，接着单张重生成或编辑 |
| **历史一键还原** | 历史记录每条都带「还原现场」，按 `packId` 从服务端还原 |
| **历史跟着账号走** | 已登录用户的历史存服务端（按邮箱归属）；未登录按设备标识尽力保留 |

### 🔧 导出与校验

| 功能 | 说明 |
|------|------|
| **多平台校验** | 微信 240×240 PNG、Telegram 512×512 PNG、WhatsApp 512×512 WebP |
| **结构化 ZIP** | 主表情 + 封面/图标/横幅 + 参考图 + `metadata.json`，开箱即提交 |
| **尺寸自动控制** | WebP 质量递减至 ≤100KB，PNG 超限自动 palette 量化 |
| **Swagger API** | 完整的 OpenAPI 文档（`/docs`） |

### 💾 存储与管理后台

**素材只存一份、ZIP 不落盘**：包只存几 KB 的清单，用户点下载时才现场打包。
服务端每 6 小时自动巡检（压缩旧包 / 清孤儿素材 / 清备份 / 按保留期删包，保留期默认 30 天且**不追溯既往**）。
后台提供实时仪表盘（SSE）、统计图表、用户与存储管理，并支持批量删包 + 立即回收素材。

> 详细存储模型、ZIP 结构与 `metadata.json` 字段见 [docs/pack-format.md](docs/pack-format.md)。

---

## 🚀 Quick Start

### 前置条件

- Node.js 20+（或直接用 [Docker](#-docker-部署)）
- npm

### 1. 克隆并安装

```bash
git clone https://github.com/EasyIndie/EasySticker.git
cd EasySticker
npm install
```

### 2. 创建环境变量文件

```bash
cp .env.example .env
```

本地开发无需修改（默认 `development` + Mock 模式，可直接跑起来）。

### 3. 配置 AI 提供商（可选）

不配置也能以 Mock 模式启动。默认模板已内置 `mock` / `seedream` / `openai` 三个 provider。

`prompt-config.json` **只需写要覆盖的字段**，其余自动继承默认值：

```json
{
  "ai": { "defaultProvider": "seedream" }
}
```

要自定义模型/端点，只覆盖对应字段即可：

```json
{
  "ai": {
    "defaultProvider": "seedream",
    "providers": {
      "seedream": {
        "type": "openai",
        "name": "豆包 Seedream（火山方舟）",
        "baseUrl": "https://ark.cn-beijing.volces.com/api/v3",
        "model": "doubao-seedream-5-0-flash-260915",
        "variant": "generic"
      }
    }
  }
}
```

> 🔐 **推荐**：API Key 不要写进 `prompt-config.json`，而是放到 `.env`：
> ```bash
> AI_SEEDREAM_API_KEY=你的火山方舟KEY
> ```
> 命名规则 `AI_<PROVIDER_ID>_API_KEY`，环境变量优先于配置文件，密钥不会随配置分享/备份/镜像泄露。

> 💡 **不想手改文件？** 命令行向导 `npm run setup`，或启动后进管理后台 →「设置 → AI 提供商」可视化编辑并一键测试连通。

### 4. 启动

```bash
npm run dev      # 开发模式（热更新）
npm run prod     # 生产模式（先 npm run build && npm run web:build）
```

打开 http://localhost:3000/ 即可使用。完整开发命令见 [docs/development.md](docs/development.md)。

---

## 🐳 Docker 部署

### 方式 A：免源码（推荐）

直接拉取预构建镜像，**不需要克隆仓库、不需要 Node 环境**：

```bash
# 1. 准备两个文件
curl -O https://raw.githubusercontent.com/EasyIndie/EasySticker/main/docker-compose.image.yml
curl -o .env https://raw.githubusercontent.com/EasyIndie/EasySticker/main/.env.example

# 2. 编辑 .env，至少填写 API_TOKEN / JWT_SECRET / ADMIN_PASSWORD

# 3. 启动
docker compose -f docker-compose.image.yml up -d
```

镜像 `ghcr.io/easyindie/easysticker` 同时提供 `linux/amd64` 与 `linux/arm64`，
含 `:latest` 与版本 tag（如 `:0.3.0`）。数据落在 `./data`。

升级 / 锁版本：

```bash
# 升级到最新
docker compose -f docker-compose.image.yml pull && docker compose -f docker-compose.image.yml up -d
# 锁定版本：在 .env 里设 EASYSTICKER_TAG=0.3.0
```

不想用 compose，一条 `docker run` 也可以：

```bash
docker run -d --name easysticker -p 3000:3000 \
  -v "$PWD/data:/app/data" \
  -e API_TOKEN=换成随机串 -e JWT_SECRET=换成随机串 -e ADMIN_PASSWORD=你的密码 \
  ghcr.io/easyindie/easysticker:latest
```

### 方式 B：从源码构建

```bash
docker compose build
docker compose up -d
```

> 面向公网部署时，**不要直接暴露 3000 端口**，请在前面加一层 HTTPS 反向代理（Nginx/Caddy 示例见
> [docs/operations.md](docs/operations.md)），并设置 `server.security.trustProxy`。

---

## 🔧 支持的 AI 提供商

所有真实生图统一走 **OpenAI 兼容 Images API**（`/images/generations`），`baseUrl` 可指向任意兼容端点，
通过 `variant` 切换参数画像：

| 提供商 | 类型 / variant | 说明 | 透明底 |
|--------|---------------|------|--------|
| **OpenAI gpt-image-1.x** | `openai` / `gpt-image` | 参考图生图、文字改图、文字生图全覆盖 | ✅ 原生 |
| **豆包 Seedream（火山方舟）** | `openai` / `generic` | 国内模型，支付宝/对公付费 | ❌ 实底 |
| **任意 OpenAI 兼容端点**（硅基流动 FLUX 等） | `openai` / `generic` | 换 `baseUrl`/`model` 即可接入 | 视模型 |
| **本地模拟 (Mock)** | `mock` | 无需 API Key，用于功能测试 | — |

---

## 🏗 架构

```
┌─────────────┐    ┌──────────────────┐    ┌──────────────────────┐
│   Web UI    │    │   Fastify API    │    │     AI Provider      │
│ (TS + Vite) │───▶│  (Node.js + TS)  │────│      (插件化)        │
│             │    │                  │    │ ┌──────────────────┐ │
│  · 参考图    │    │  · 图生图流水线   │    │ │ OpenAI 兼容 API  │ │
│  · 预览下载  │    │  · 表情校验      │    │ │ (任意兼容端点)    │ │
│  · 历史记录  │    │  · ZIP 打包     │    │ │ Mock (本地模拟)   │ │
│  · 管理后台  │    │  · SSE 流推送   │    │ └──────────────────┘ │
└─────────────┘    │  · 元数据注入    │    └──────────────────────┘
                   └───────┬──────────┘
                           ▼
                   ┌──────────────┐
                   │  Sharp 图片   │
                   │  处理引擎     │
                   └──────────────┘
```

**技术栈：** Node.js 20 · TypeScript · Fastify · Sharp · SSE · Vite · Docker

设计取舍与模块边界见 [docs/architecture.md](docs/architecture.md)。

---

## 📋 配置

所有系统参数通过 `prompt-config.json` 集中管理（不存在则用 `prompt-config.default.json`），
密钥等敏感项通过 `.env` 覆盖。完整清单见
[docs/configuration-reference.md](docs/configuration-reference.md)。

常用项：

- `server.port` / `server.host`：监听地址
- `server.dataDir`：数据目录（默认 `data`）
- `ai.defaultProvider` / `ai.providers`：默认提供商与端点 / 模型
- `ai.imageSize`：生成图宽高（默认 1024×1024）
- `emotions`：情绪词列表，按序分配给每张贴纸

---

## 🤔 FAQ

**Q: 需要自己的 AI API Key 吗？**
A: 不需要也能启动（Mock 模式）。想要真正的 AI 生成能力，配置一个 OpenAI 兼容提供商并填入密钥即可。

**Q: 生成的图片存在哪里？怎么清理？**
A: 全部在服务器 `data/` 目录（素材只存一份，ZIP 不落盘）。服务端每 6 小时自动巡检，
也可手动 `npm run gc`（默认只体检，`--apply` 才执行）。⚠️ **不要**用 `find data -mtime +N -delete`
这类按 mtime 的清理方式——素材 mtime 与「是否仍被引用」无关，会删坏包。
详见 [docs/operations.md §3](docs/operations.md#3-存储清理与回收)。

**Q: 支持微信表情开放平台提审吗？**
A: 输出 ZIP 完全符合上架规范，可直接提交审核；目前不支持自动提审。

**Q: 支持商用吗？**
A: 采用 Apache-2.0，可自由使用和修改。生成图片的版权取决于底层 AI 模型服务条款。

**Q: 生图质量不满意怎么办？**
A: 调整提示词 / 风格 / 提供商；某张不满意就点该预览卡片单张重生成或编辑，无需整包重跑。

**Q: 早期导出的 ZIP 缺尺寸 / 提示词，能补回来吗？**
A: 用 `npm run repair-pack` 就地升级到最新 schema。详见
[docs/operations.md §3.4](docs/operations.md#34-修复历史包)。

---

## 📚 文档

| 文档 | 内容 |
|------|------|
| [docs/README.md](docs/README.md) | 文档索引与维护规则（先看这个） |
| [docs/development.md](docs/development.md) | 本地开发：环境、命令、目录、测试 |
| [docs/configuration-reference.md](docs/configuration-reference.md) | 全部配置项、提示词模板、环境变量 |
| [docs/pack-format.md](docs/pack-format.md) | 存储模型、ZIP 结构、`metadata.json` 字段 |
| [docs/operations.md](docs/operations.md) | 部署、反向代理、日志、存储回收、备份、压测、排障 |
| [docs/architecture.md](docs/architecture.md) | 架构分层、模块边界、设计决策与待办 |
| [docs/history.md](docs/history.md) | 改造历史与关键决策（只读） |
| [CHANGELOG.md](CHANGELOG.md) | 版本更新日志 |
| [CONTRIBUTING.md](CONTRIBUTING.md) | 如何贡献 |
| [SECURITY.md](SECURITY.md) | 安全策略与漏洞上报 |

---

## 📄 License

Apache-2.0 © 2025-2026 EasySticker Contributors

---

<p align="center">
  <sub>Made with ❤️ for the sticker community</sub>
</p>
