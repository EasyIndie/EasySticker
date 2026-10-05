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
  <span>OpenAI 兼容 API · 任意兼容端点</span>
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
| **多风格** | 支持扁平插画、贴纸、3D 卡通、日系 Q 版、像素风、国潮风等多种风格（可自定义） |
| **多 AI 后端** | 统一 OpenAI 兼容接口，可对接 OpenAI 或任意 OpenAI 兼容网关，自由切换 |
| **SSE 实时推送** | 生成进度逐张展示，含进度条和百分比 |
| **智能提示词** | 上传参考图后自动生成推荐提示词 |
| **赞赏图** | 可选开启赞赏，自动生成引导图和答谢图 |
| **单资源重生成** | 某张图失败时点该卡片只重生成这一张（`POST /api/generate/resource`），不重跑整包；单张扩展资源失败不会中断整包 |

### 📦 导入已有图片
| 功能 | 说明 |
|------|------|
| **批量导入** | PNG/JPG/WebP/GIF 批量导入，自动缩放 |
| **自动补齐** | 补全封面、图标、横幅、赞赏图 |
| **元数据编辑** | 标题、作者、版权、版本号、赞赏语，完整可编辑 |
| **导入 ZIP 还原** | 直接导入本站下载的 ZIP 包，读回提示词 / 风格 / 情绪 / 参考图，可接着单张重生成或二次编辑 |
| **历史一键还原** | 历史记录每条都带「还原现场」，直接按 `packId` 从服务端还原，不用再翻本地文件 |
| **记录可删除** | 历史记录每条都能删，同时删掉服务端的包，立刻释放磁盘 |
| **历史跟着账号走** | 已登录用户的历史存在服务端（按邮箱归属），清浏览器缓存也不会丢；未登录用户按设备标识尽力保留 |

### 🔧 导出与校验
| 功能 | 说明 |
|------|------|
| **多平台校验** | 微信 240×240 PNG、Telegram 512×512 PNG、WhatsApp 512×512 WebP |
| **结构化 ZIP** | 主表情 + 封面图标 + 横幅 + 参考图 + metadata.json，开箱即提交 |
| **文件尺寸自动控制** | WebP 质量递减至 ≤100KB，PNG 超限自动 palette 量化 |
| **Swagger API** | 完整的 OpenAPI 文档（`/docs`） |

### 💾 存储与清理

**素材只存一份、ZIP 不落盘**，所以磁盘占用约等于素材本身：

```
data/uploads/<assetId>.<ext>     # 所有素材，只存一份
data/packs/<packId>.json         # 包清单（几 KB），含逐张提示词/尺寸/角色
```

用户点「下载 ZIP」时才按清单现场打包，边打边发。因此单资源重生成、重建 ZIP
都只是写几 KB 清单，不会把整包图片再复制一遍。

服务端每 6 小时自动巡检一次，做四件「可证明安全」的事：

| 动作 | 说明 |
|------|------|
| 压缩旧包 | 早期版本留下的整包 `.zip` 转成清单（素材本来就在 uploads 里） |
| 清孤儿素材 | 不再被任何包引用的 uploads 文件，且落盘超过 6 小时 |
| 清 `.orig` 备份 | `repair-pack` 的中间产物 |
| 按保留期删包 | 默认 **30 天**。**不追溯既往** —— 过期时间按 `max(包创建时间, 策略生效时间) + 30 天` 计算，所以开启当天不会清掉旧数据 |

历史记录区块会显示「服务端保留 N 天」，快过期的条目会标出「剩余 N 天」。

手动体检 / 清理：

```bash
npm run gc                                        # 只体检，不删任何东西
npm run gc -- --apply                             # 执行
npm run gc -- --apply --retention-days 30         # 顺带清掉 30 天前的包
npm run gc -- --apply --keep-orig                 # 保留 .orig 备份
```

后台「存储」标签页也能看到占用、待回收量、全部包列表，并手动清理或逐个删除。

### 🧾 metadata.json 结构

导出的 ZIP 内附带 `metadata.json`，记录**每个文件的名称与尺寸**，以及**生成时使用的提示词、要求与风格**，
便于把包重新导入后继续做二次编辑 / 优化。

> 在页面的「导入已有图片」步骤里选择这个 ZIP，即可**还原生成现场**：
> 提示词、风格、情绪、参考图都会被读回，之后可以单张重新生成、导出，或在此基础上改提示词重做。

```json
{
  "schema": "easysticker-pack@0.3",
  "packId": "…",
  "presetId": "wechat_stickers",
  "createdAt": "2026-10-05T10:51:49.901Z",
  "metadata": { "title": "…", "author": "…", "version": "v1.0", "copyright": "…" },
  "generation": {
    "source": "ai-generate",
    "providerId": "seedream",
    "model": "doubao-seedream-5-0-flash-260915",
    "prompt": "一只橘猫在打篮球",
    "negativePrompt": "文字、水印、二维码、…",
    "styles": ["贴纸"],
    "stickerCount": 8,
    "imageSize": { "width": 1024, "height": 1024 },
    "targetSize": { "width": 240, "height": 240 },
    "referenceAssetId": "…",
    "referenceMode": "base64",
    "include": { "cover": true, "icon": true, "banner": true, "reward": false }
  },
  "extras": {
    "coverAssetId": "…",
    "bannerAssetId": "…",
    "iconAssetId": "…",
    "rewardGuideAssetId": null,
    "rewardThanksAssetId": null
  },
  "files": [
    {
      "role": "sticker",
      "label": "001",
      "assetId": "…",
      "filename": "001.png",
      "zipPath": "assets/001.png",
      "width": 240,
      "height": 240,
      "format": "png",
      "mimeType": "image/png",
      "bytes": 23187,
      "prompt": "一只橘猫在打篮球\n当前表情主题与动作：开心，大笑，挥手打招呼\n风格：贴纸\n画面要求：…",
      "style": "贴纸",
      "emotion": "开心，大笑，挥手打招呼"
    },
    {
      "role": "cover",
      "assetId": "…",
      "filename": "cover.png",
      "zipPath": "meta/cover.png",
      "width": 240,
      "height": 240,
      "format": "png",
      "mimeType": "image/png",
      "bytes": 21447,
      "prompt": "…实际使用的完整提示词…",
      "style": "贴纸"
    },
    {
      "role": "reference",
      "assetId": "…",
      "filename": "reference.png",
      "zipPath": "source/reference.png",
      "width": 1254,
      "height": 1254,
      "format": "png",
      "mimeType": "image/png",
      "bytes": 1088103
    }
  ],
  "assets": [{ "assetId": "…", "filename": "001.png", "zipPath": "assets/001.png" }]
}
```

- `files` 覆盖包内**所有**图片（贴纸 + 封面 / 图标 / 横幅 / 赞赏图 + 参考图），每条都带 `width`/`height`/`format`/`mimeType`/`bytes`；
  贴纸与扩展资源还会带上各自实际使用的 `prompt` / `style`（贴纸另有 `emotion`）。
- 参考图会原图存进 `source/reference.*`（不压缩、不改尺寸），配合 `generation` 即可**完整还原**这次生成：
  参考图 + 原始提示词 + 风格 + 情绪序列 → 可重放出同一套图，也可在此基础上做二次编辑。
- `generation` 记录整套图的生成上下文（提供商、模型、原始提示词、负向提示词、风格、参考图方式与尺寸），
  `source` 区分 `ai-generate` 与 `import`。
- `assets` 是旧版最小清单，保留以兼容既有工具；新代码请优先读取 `files`。

历史包（旧 schema）可用 `npm run repair-pack` 补全，见下方 FAQ。

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

### 2. 创建环境变量文件

```bash
cp .env.example .env
```

本地开发无需修改（默认 `development` + Mock 模式，可直接跑起来）。要用真实模型，见下一步。

### 3. 配置 AI 提供商（可选）

不配置也能以 Mock 模式启动。默认模板 `prompt-config.default.json` 已内置 `mock` / `seedream` / `openai` 三个 provider。

`prompt-config.json` **只需写要覆盖的字段**，其余自动继承默认值（无需复制整份模板）。例如把默认生图切到豆包 Seedream：

```json
{
  "ai": { "defaultProvider": "seedream" }
}
```

要自定义模型/端点（如换 Seedream 版本），只覆盖对应 provider 的字段即可（其余字段仍继承默认）：

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

> 🔐 **推荐**：API Key 不要写进 `prompt-config.json`，而是放到 `.env`（已在 `.gitignore` 中）：
> ```bash
> AI_SEEDREAM_API_KEY=你的火山方舟KEY
> ```
> 命名规则 `AI_<PROVIDER_ID>_API_KEY`（provider id 见 `ai.providers` 的键名）。环境变量优先于配置文件，`apiKey` 字段留空即可，密钥不会随配置文件分享/备份/Docker 镜像而泄露。

> 💡 **不想手改文件？** 两种懒人方式：
> - 命令行向导：`npm run setup`（交互式选择模型并填入 Key）
> - 网页配置：启动后进管理后台 →「设置 → AI 提供商」，可视化编辑并**一键测试连通**

### 4. 启动
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

所有真实生图统一走 **OpenAI 兼容 Images API**（`/images/generations`），`baseUrl` 可指向任意兼容端点，通过 `variant` 切换参数画像：

| 提供商 | 类型 / variant | 说明 | 透明底 |
|--------|---------------|------|--------|
| **OpenAI gpt-image-1.x** | `openai` / `gpt-image` | 参考图生图、文字改图、文字生图全覆盖 | ✅ 原生 |
| **豆包 Seedream（火山方舟）** | `openai` / `generic` | 国内模型，支付宝/对公付费 | ❌ 实底 |
| **任意 OpenAI 兼容端点**（硅基流动 FLUX 等） | `openai` / `generic` | 换 `baseUrl`/`model` 即可接入 | 视模型 |
| **本地模拟 (Mock)** | `mock` | 无需 API Key，用于功能测试 | — |

---

## 🏗 Architecture

```
┌─────────────┐    ┌──────────────────┐    ┌──────────────────────┐
│   Web UI    │    │   Fastify API    │    │     AI Provider      │
│ (TS + Vite) │───▶│  (Node.js + TS)  │────│      (插件化)        │
│             │    │                  │    │ ┌──────────────────┐ │
│  · 上传参考图 │    │  · 图生图流水线   │    │ │ OpenAI 兼容 API  │ │
│  · 编辑信息  │    │  · 表情校验      │    │ │ (任意兼容端点)    │ │
│  · 预览下载  │    │  · ZIP 打包     │    │ │ Mock (本地模拟)   │ │
│  · 历史记录  │    │  · SSE 流推送   │    │ └──────────────────┘ │
└─────────────┘    │  · 元数据注入    │    └──────────────────────┘
                   └───────┬──────────┘
                           ▼
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
A: 不需要也能启动（本地模拟 Mock 模式）。但想要真正的 AI 生成能力，需要配置一个 OpenAI 兼容的 AI 提供商并填入 `apiKey`。

**Q: 生成的图片存储在哪里？**
A: 全部存储在服务器的 `data/` 目录下。任务状态在内存中默认 1h 后自动过期；磁盘上的 `data/uploads/` 与 `data/packs/` 需用 `node scripts/cleanup.mjs --days 7` 或 Docker `cleanup` profile 定期清理。

**Q: 支持微信表情开放平台提审吗？**
A: 输出 ZIP 包完全符合微信表情开放平台的上架规范，可以直接用该 ZIP 提交审核。目前不支持通过 API 自动提审。

**Q: 支持商用吗？**
A: 项目采用 Apache-2.0 许可证，可自由使用和修改。注意生成的图片版权取决于底层的 AI 模型服务条款。

**Q: 生图质量不满意怎么办？**
A: 可调整提示词、更换风格、切换 AI 提供商；也可在 `prompt-config.json` 里调整 provider 的 `quality` / `outputFormat` / `size`（generic 变体）以及全局 `ai.imageSize`。某张图不满意时，直接点击该预览卡片即可单张重生成，无需整包重跑。

**Q: 早期导出的 ZIP 里 metadata.json 没有尺寸 / 提示词，能补回来吗？**
A: 图片本身不会丢（都在 `data/packs/*.zip` 与 `data/uploads/` 里）。用 `npm run repair-pack` 可以把旧包就地升级到最新 schema，用 `sharp` 重新测量每张图的尺寸并补齐角色、`files` 等字段；若 `uploads/` 里还留着参考图，也会一并收进 `source/reference.*`（原包备份成 `<packId>.zip.orig`，下载链接不变）：

```bash
npm run repair-pack -- <packId>          # 修复单个包
npm run repair-pack -- --all             # 修复所有旧 schema 的包
npm run repair-pack -- --all --dry-run   # 只看会改什么，不写盘
```

生成上下文（原始提示词 / 风格 / 提供商 / 参考图）旧版本没有落盘，只能从浏览器 localStorage 找回：

```js
// 在项目页面按 F12，console 里执行
copy(localStorage.getItem('easysticker:last-wechat-pack'))
```

把结果存成 `context.json` 后带 `--context` 重跑，即可把 `generation` 与逐张 `prompt`/`style`/`emotion` 一并写回：

```bash
npm run repair-pack -- <packId> --context context.json
```

---

## 📄 License

Apache-2.0 © 2025-2026 EasySticker Contributors

---

<p align="center">
  <sub>Made with ❤️ for the sticker community</sub>
</p>
