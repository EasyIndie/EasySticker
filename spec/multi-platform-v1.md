# EasySticker 多平台支持 — 前端方案设计 v1

## 1. 背景

EasySticker v0.1.0 当前只绑定微信表情包一套流程。后端 presets 已定义 WeChat/Telegram/WhatsApp 三套平台规格，但前端和核心流程全部硬编码为 `"wechat_stickers"`。需要在不破坏现有流程的前提下，让用户可以在创建时选择目标平台。

## 2. 目标

- 用户在 Step 00「选择创建方式」处同时选择目标平台
- 后续所有流程（上传/导入尺寸、AI 生成参数、校验、打包、下载）按所选平台的规格执行
- 存量用户无感知 — 默认选中 WeChat
- 不增加第三方依赖，不改变 AI provider 层，保持 SPA 结构

---

## 3. 数据流图

```
┌────────────────────────────────────────────────────────────────────────┐
│  用户操作                              前端                            │
│                                                                        │
│  [Step 00]  选择平台 + 创建方式                                        │
│     ├── WeChat (default) ──→  更新 UI：show AI fields, hide extras     │
│     ├── Telegram  ────────→  更新 UI：hide count limit, simple zip     │
│     └── WhatsApp  ────────→  更新 UI：hide count/reward/extra,         │
│                                           show webp info               │
│                                                                        │
│  [Step 01]  上传参考图 / 导入已有图片                                   │
│       │     ──→  POST /api/uploads (通用，无变化)                      │
│       │     ──→  POST /api/{platform}/import  (按平台)                │
│       └─────→  客户端校验：文件格式/尺寸按平台 presets                   │
│                                                                        │
│  [Step 02]  配置 & metadata                                            │
│       │     ──→  GET /api/config (返回各平台配置)                     │
│       └─────→  UI 字段根据平台动态显示/隐藏                             │
│                                                                        │
│  [Step 03]  生成                                                       │
│       └─────→  POST /api/{platform}/generate/start                     │
│                payload 包含 selectedPresetId                            │
│                                                                        │
│  [Step 04]  预览 & 下载                                                 │
│       └─────→  ZIP 按平台规格打包                                      │
│                metadata.json 结构按平台差异生成                         │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 4. 前端组件/交互设计

### 4.1 平台选择器（Step 00）

在现有 Step 00「选择创建方式」卡片中添加平台选择行。

**HTML 结构变化：**

```html
<!-- 现有：只显示创建方式 radiogroup -->
<!-- 新增：在这个卡片中增加平台选择器 -->
<article class="card step-card">
  <div class="step-head">
    <h2>选择创建方式</h2>
  </div>
  <!-- 平台选择 -->
  <div class="field platform-selector">
    <span class="section-title">目标平台</span>
    <select id="platformSelect">
      <option value="wechat_stickers">微信表情包 (240×240 PNG)</option>
      <option value="telegram_static">Telegram 贴纸 (512×512 PNG)</option>
      <option value="whatsapp_webp">WhatsApp 贴纸 (512×512 WebP)</option>
    </select>
  </div>
  <!-- 创建方式 (保持不变) -->
  <div class="mode-selector" role="radiogroup">
    <!-- ... existing radio buttons ... -->
  </div>
</article>
```

**交互规则：**

| 操作 | 效果 |
|------|------|
| 切换平台 | 更新 Step 01/02/03/04 所有依赖平台的部分 |
| 切换创建方式 | 保持平台不变，仅切换 AI/Import 模式 |
| 平台切换发生在 | 未开始生成之前。**一旦生成了结果，锁定当前平台**（变灰禁用） |

### 4.2 各平台的 UI 差异

#### WeChat (wechat_stickers) — 保持完全不变

| UI 元素 | 显示状态 | 备注 |
|---------|----------|------|
| 贴纸数量选择器 | ✅ 显示，范围 8-24 | 保持现有 |
| 风格选择器 | ✅ 显示 | 保持现有 |
| 提示词 | ✅ 显示 | 保持现有 |
| 赞赏功能 | ✅ 显示 | 保持现有 |
| Title/Author/Version/Copyright | ✅ 显示 | 保持现有 |
| 额外资源区（Cover/Icon/Banner） | ✅ 显示 | 保持现有 |
| 预览尺寸标注 | 240×240 | 保持现有 |
| AI 生成尺寸 (imageSize) | 按 prompt-config 配置 | 保持现有 |

#### Telegram (telegram_static)

| UI 元素 | 显示状态 | 备注 |
|---------|----------|------|
| 贴纸数量选择器 | ✅ 显示，范围 1-50 | **不设严格上限**，给一个合理默认值 8，前端给建议上限 50 |
| 风格选择器 | ✅ 显示 | 通用 |
| 提示词 | ✅ 显示 | 通用 |
| 赞赏功能 | ❌ 隐藏 | Telegram 贴纸无此概念 |
| Title/Author | ✅ 显示，**可选** | Telegram 不需要 metadata，保留供用户参考 |
| Version/Copyright | ❌ 隐藏 | Telegram 无此需求 |
| 额外资源区（Cover/Icon/Banner） | ❌ 隐藏 | Telegram 贴纸只有贴纸本身 |
| 预览尺寸标注 | 512×512 | 按 preset 规格 |
| AI 生成尺寸 (imageSize) | 按 prompt-config 配置 | 但最终 resize 到 512×512 |
| 文件格式提示 | PNG | 按 preset allowedExts |
| 导出提示 | "此 ZIP 中包含 PNG 贴纸文件，可直接用于 Telegram" | |

#### WhatsApp (whatsapp_webp)

| UI 元素 | 显示状态 | 备注 |
|---------|----------|------|
| 贴纸数量选择器 | ✅ 显示，范围 1-30 | 不设严格上限，默认 8，前端建议上限 30 |
| 风格选择器 | ✅ 显示 | 通用 |
| 提示词 | ✅ 显示 | 通用 |
| 赞赏功能 | ❌ 隐藏 | WhatsApp 无此概念 |
| Title/Author | ✅ 显示，**可选** | 保留供参考 |
| Version/Copyright | ❌ 隐藏 | 无此需求 |
| 额外资源区 | ❌ 隐藏 | WhatsApp 只有贴纸本身 |
| 预览尺寸标注 | 512×512 | 按 preset 规格 |
| AI 生成尺寸 (imageSize) | 按 prompt-config 配置 | 最终 resize 到 512×512 WebP |
| 文件格式提示 | WebP（透明背景，高压缩） | |
| 导出提示 | "此 ZIP 中包含 .webp 贴纸文件，可直接用于 WhatsApp" | |

### 4.3 前端全局状态变化

在 `app.js` 中增加新的全局状态变量：

```js
// 新增
let currentPlatform = "wechat_stickers";       // 当前选中平台

// 平台到 UI 配置的映射（替代硬编码常量）
const PLATFORM_SPECS = {
  wechat_stickers: {
    minCount: 8, maxCount: 24, defaultCount: 8,
    showsStyle: true, showsPrompt: true, showsReward: true,
    showsExtraAssets: true, showsMetadata: true,
    showsTitle: true, showsAuthor: true, showsVersion: true, showsCopyright: true,
    previewLabel: "240 × 240",
    fileFormat: "PNG",
    exportHint: "此 ZIP 中包含符合微信表情包规范的资源文件。",
    extraAssetDefs: [...], // cover/icon/banner/reward defs
    aiImageSize: null,     // 使用 prompt-config 或默认
    outputFormat: "png"
  },
  telegram_static: {
    minCount: 1, maxCount: 50, defaultCount: 8,
    showsStyle: true, showsPrompt: true, showsReward: false,
    showsExtraAssets: false, showsMetadata: false,
    showsTitle: true, showsAuthor: true, showsVersion: false, showsCopyright: false,
    previewLabel: "512 × 512",
    fileFormat: "PNG",
    exportHint: "此 ZIP 中包含 PNG 贴纸文件，可直接用于 Telegram。",
    extraAssetDefs: [],
    outputFormat: "png"
  },
  whatsapp_webp: {
    minCount: 1, maxCount: 30, defaultCount: 8,
    showsStyle: true, showsPrompt: true, showsReward: false,
    showsExtraAssets: false, showsMetadata: false,
    showsTitle: true, showsAuthor: true, showsVersion: false, showsCopyright: false,
    previewLabel: "512 × 512",
    fileFormat: "WebP",
    exportHint: "此 ZIP 中包含 .webp 贴纸文件，可直接用于 WhatsApp。",
    extraAssetDefs: [],
    outputFormat: "webp"
  }
};
```

### 4.4 前端核心函数变化清单

以下是 `app.js` 中需要修改的核心函数：

| 函数 | 修改内容 |
|------|----------|
| `syncCreationMode()` | 增加 `syncPlatformUI()` 调用；loading/success 文案用平台名 |
| `syncPlatformUI()` | **新函数**：根据 `currentPlatform` 显示/隐藏/调整所有平台依赖 UI |
| `validateGenerateInputs()` | min/max count 从 `PLATFORM_SPECS[currentPlatform]` 取 |
| `setPromptHint()` | 文案中的贴纸数量和类型从平台 spec 取 |
| `generateWechatPack()` | → 改为 `generatePlatformPack()`，API 路径改为 `/api/{platform}/generate/start` |
| `importWechatPack()` | → 改为 `importPlatformPack()`，API 路径改为 `/api/{platform}/import` |
| `renderPreview()` | 预览卡片的 spec 标注从平台 spec 取 |
| `renderExtraAssets()` | 只在 `showsExtraAssets` 时展示 |
| `renderExportInfo()` | metadata fields 按平台动态生成 |
| `renderCompletedPackResult()` | 文案用平台名称 |
| `resetAllState()` | 重置 `currentPlatform` 为 `wechat_stickers` |
| `getWechatMetadataPayload()` | → 改为 `getMetadataPayload()`，按平台决定哪些字段有效 |
| `persistPersistedPackResult()` | 存储 `platform` 字段 |
| `restorePersistedPackResult()` | 恢复时还原平台状态 |
| `suggestPrompt()` | 通用化 |
| `handleFileUpload()` | 通用化 |
| 所有 `setCountValue()` | 用平台 spec 的 min/max |
| 所有事件监听 | 引用平台 spec 的常量而非硬编码 |

### 4.5 新增函数

```js
function syncPlatformUI() {
  const spec = PLATFORM_SPECS[currentPlatform];
  
  // Show/hide based on platform
  // WeChat extra config fields (sticker count area already dynamic)
  document.getElementById("wechatAiRewardField").hidden = !spec.showsReward;
  document.getElementById("wechatAiExtraSection").hidden = !spec.showsExtraAssets;
  document.getElementById("wechatAiMetadataSection").hidden = !spec.showsMetadata;
  document.getElementById("wechatAiVersionField").hidden = !spec.showsVersion;
  document.getElementById("wechatAiCopyrightField").hidden = !spec.showsCopyright;
  document.getElementById("wechatAiTitleField").hidden = !spec.showsTitle;
  document.getElementById("wechatAiAuthorField").hidden = !spec.showsAuthor;
  
  // Update labels, hints, preview specs
  document.getElementById("specLabel").textContent = spec.previewLabel;
  
  // Update count stepper limits
  MIN_STICKER_COUNT = spec.minCount;
  MAX_STICKER_COUNT = spec.maxCount;
  DEFAULT_STICKER_COUNT = spec.defaultCount;
  setCountValue(wechatAiCount.value || DEFAULT_STICKER_COUNT);
  
  // Update the header badge text and step notes
  updatePageHeader();
}
```

---

## 5. API 接口变更说明

### 5.1 `/api/config` — 返回各平台配置（修改）

**当前：** 只返回 `{ wechat: {...} }`

**修改为：**

```json
{
  "platforms": {
    "wechat_stickers": {
      "title": "微信表情包 (240×240 PNG)",
      "minCount": 8,
      "maxCount": 24,
      "defaultCount": 8,
      "preset": { "allowedExts": [".png", ".jpg", ".jpeg", ".gif"], "maxBytes": 512000, "exactWidth": 240, "exactHeight": 240 },
      "extraAssetTypes": ["cover", "icon", "banner", "rewardGuide", "rewardThanks"],
      "supportsReward": true,
      "ai": { "defaultProvider": "...", "availableProviders": [...] }
    },
    "telegram_static": {
      "title": "Telegram 贴纸 (512×512 PNG)",
      "minCount": null,
      "maxCount": null,
      "defaultCount": 8,
      "preset": { "allowedExts": [".png"], "maxBytes": 524288, "maxWidth": 512, "maxHeight": 512, "requiredSquare": true },
      "extraAssetTypes": [],
      "supportsReward": false,
      "ai": { "defaultProvider": "...", "availableProviders": [...] }
    },
    "whatsapp_webp": {
      "title": "WhatsApp 贴纸 (512×512 WebP)",
      "minCount": null,
      "maxCount": null,
      "defaultCount": 8,
      "preset": { "allowedExts": [".webp"], "maxBytes": 102400, "exactWidth": 512, "exactHeight": 512 },
      "extraAssetTypes": [],
      "supportsReward": false,
      "ai": { "defaultProvider": "...", "availableProviders": [...] }
    }
  }
}
```

**向后兼容：** 保留 `wechat` 字段 3 个版本，标记 deprecated。

### 5.2 `/wechat/*` → 改为 `/generate/*` 加 `presetId` 参数

**当前：** 所有路由前缀 `/wechat/*`

**改为：** 保留 `/wechat/*` 作为 WeChat 专用别名（向后兼容），新增通用路由 `/generate/*`，接受 `presetId` 参数。

#### `/api/generate/prompt` (POST)

```json
// Request
{ "referenceAssetId": "xxx", "presetId": "wechat_stickers" }

// Response (新增 presetId 字段)
{ "referenceAssetId": "xxx", "presetId": "wechat_stickers", "prompt": "...", "negativePrompt": "...", "styles": [...] }
```

#### `/api/generate/start` (POST)

```json
// Request — 新增 presetId 字段
{
  "referenceAssetId": "xxx",
  "presetId": "wechat_stickers",
  "prompt": "...",
  "provider": "...",
  "styles": [...],
  "stickerCount": 8,
  "enableReward": true,
  "includeCover": true,
  "includeIcon": true,
  "includeBanner": true,
  "metadata": { "title": "...", "author": "...", ... }
}
```

**注意：** `enableReward` / `includeCover` / `includeIcon` / `includeBanner` 仅在 WeChat 平台有效。Telegram/WhatsApp 后端会自动忽略这些字段。

#### `/api/generate/import` (POST) — multipart

```json
// 新增 field: presetId
// Request form fields: presetId, stickers[], cover, icon, banner, rewardGuide, rewardThanks, title, author...
```

#### 关于 schema 校验

`wechatAi.ts` → `generateSchema` 中的 `stickerCount` 范围 `8-24` 需要改为由 `presetId` 动态决定。修改方式：将 min/max 校验在后端通过 presets 表查询。

```ts
// 动态校验
const preset = PLATFORM_PRESETS.find(p => p.id === presetId);
if (!preset) throw createHttpError(400, "unknown presetId");
if (preset.minCount && stickerCount < preset.minCount) { ... }
if (preset.maxCount && stickerCount > preset.maxCount) { ... }
```

### 5.3 `stickerCount` 校验放宽

对于 Telegram/WhatsApp（无 minCount/maxCount），`stickerCount` 不做上下限校验。前端给默认值，后端同样不做限制。

---

## 6. 后端模块变更清单

### 6.1 `src/services/wechat/aiFlow.ts` — 核心改动

| 改动项 | 内容 |
|--------|------|
| 函数签名 | `generateWeChatAssetsAndPack` → 增加 `presetId: string` 参数 |
| 贴纸生成 | `toStickerPng(input, size)` — size 从 preset 的 exactWidth/exactHeight 取 |
| 数量限制 | `const count = Math.max(min, Math.min(max, Math.floor(req.stickerCount ?? default)))` 从 preset 取 |
| 额外资源 | 只对包含额外资源的平台（目前只有 WeChat）生成 cover/icon/banner/reward |
| 生成尺寸 | `toStickerPng` 的 resize target 改为 preset 的 exact 尺寸 |
| WebP 支持 | WhatsApp 需要将最终图片转为 WebP 格式而非 PNG |
| 文件名 | 改名为 `generateAssetsAndPack`（通用化），保留别名 |

具体伪代码：

```ts
export async function generateAssetsAndPack(
  app: FastifyInstance,
  presetId: string,
  req: WeChatAiGenerateRequest,  // 类型名可改为 PlatformGenerateRequest
  emit?: ...,
  isCanceled?: ...,
  signal?: AbortSignal
) {
  const preset = PLATFORM_PRESETS.find(p => p.id === presetId);
  if (!preset) throw createHttpError(400, "unknown presetId");

  const min = preset.minCount ?? 1;
  const max = preset.maxCount ?? 50;
  const count = Math.max(min, Math.min(max, Math.floor(req.stickerCount ?? 8)));

  // Decide target size
  const targetW = preset.exactWidth ?? preset.maxWidth;
  const targetH = preset.exactHeight ?? preset.maxHeight;

  // If platform requires square, resize to square
  let resizeTarget: { width: number; height: number };
  if (preset.exactWidth && preset.exactHeight) {
    resizeTarget = { width: preset.exactWidth, height: preset.exactHeight };
  } else if (preset.requiredSquare) {
    resizeTarget = { width: targetW, height: targetW };
  } else {
    resizeTarget = { width: targetW, height: targetH };
  }

  // Generate individual stickers
  // ... (same flow but using resizeTarget) ...

  // Convert to platform format
  const convert = (buf: Buffer) => {
    // WhatsApp → WebP, otherwise PNG
    if (presetId === "whatsapp_webp") {
      return sharp(buf).resize(resizeTarget).webp({ quality: 90 }).toBuffer();
    }
    return toFormatPng(buf, resizeTarget);
  };

  // Only generate extras if platform supports them
  // ... (condition by presetId or extraAssetTypes) ...

  // Build pack with dynamic presetId
  return buildZipPack(app, { presetId, assets, ... });
}

// 保留别名
export const generateWeChatAssetsAndPack = (app, req, ...) =>
  generateAssetsAndPack(app, "wechat_stickers", req, ...);
```

### 6.2 `src/services/wechat/importFlow.ts` — 核心改动

| 改动项 | 内容 |
|--------|------|
| 函数签名 | 增加 `presetId: string` 参数 |
| 目标尺寸 | 从 preset 取 exact/max 尺寸 |
| 格式转换 | 按平台决定输出格式（PNG/WebP） |
| 额外资源导入 | 仅当 preset 有额外资源字段时处理 |
| 文件名 | 改名为 `importStickerPack`（通用化），保留别名 |

### 6.3 `src/services/pack/service.ts` — 改动

| 改动项 | 内容 |
|--------|------|
| ZIP 目录结构 | 当前 meta/cover.png etc. → 仅对 WeChat 生成 meta 目录 |
| 元数据结构 | `metadata.json` 的 `extras` 字段按平台决定是否包含 |
| 元数据 Schema | `schema` 字段 **不变**（统一在 `easysticker-pack@0.1`），但 content 按平台动态生成 |
| WebP 格式 | ZIP 中的图片按实际格式保存，不强制 PNG |

```ts
function buildPackMetadata(..., req: PackRequest, entries, createdAt) {
  const isWeChat = req.presetId?.startsWith("wechat_");
  return {
    schema: "easysticker-pack@0.1",
    packId, presetId: req.presetId,
    createdAt,
    metadata: req.metadata ?? {},
    extras: isWeChat ? { coverAssetId, ... } : {},
    assets: entries
  };
}
```

### 6.4 `src/routes/wechatAi.ts` — 路由改造

| 改动项 | 内容 |
|--------|------|
| 新增路由 | `/api/generate/prompt`, `/api/generate/start`, `/api/generate/import`, `/api/generate/stream`, `/api/generate/cancel` |
| 保留别名 | `/api/wechat/*` 继续存在，内部调用 `generateAssetsAndPack(app, "wechat_stickers", ...)` |
| schema 校验 | 动态从 PLATFORM_PRESETS 取 minCount/maxCount |

### 6.5 `src/routes/config.ts` — 扩展

| 改动项 | 内容 |
|--------|------|
| 数据 | 改为返回 `platforms` 映射（所有 preset）|
| 兼容 | 保留 `wechat` 字段 |

### 6.6 `src/services/platform/presets.ts` — 补充字段

当前 presets 已经很完整，建议补充：

```ts
export type PlatformPreset = {
  id: string;
  title: string;
  description?: string;           // 用于前端 UI 展示
  allowedExts: string[];
  maxBytes: number;
  requiredSquare?: boolean;
  exactWidth?: number;
  exactHeight?: number;
  maxWidth: number;
  maxHeight: number;
  minCount?: number;
  maxCount?: number;
  outputFormat?: "png" | "webp";  // 新增：指定输出格式
};
```

给三个主 preset 添加：

- `wechat_stickers`: `outputFormat: "png"`
- `telegram_static`: `outputFormat: "png"`
- `whatsapp_webp`: `outputFormat: "webp"`

---

## 7. 数据模型变更

### 7.1 前端持久化（localStorage）

当前 key 为 `easysticker:last-wechat-pack` → 改为 `easysticker:last-pack`。

新增字段：

```json
{
  "version": 2,
  "platform": "wechat_stickers",
  "presetId": "wechat_stickers",
  ...
}
```

向后兼容：检测到 `version: 1` 或无 `platform` 字段，视为 `"wechat_stickers"`。

### 7.2 后端 PackMetadata

当前 `metadata.json`：

```json
{
  "schema": "easysticker-pack@0.1",
  "packId": "...",
  "presetId": "wechat_stickers",
  "createdAt": "...",
  "metadata": { "title": "...", ... },
  "extras": { "coverAssetId": "...", ... },
  "assets": [...]
}
```

**无需变更 schema 字段**，但需要保证：

- `presetId` 字段正确设置
- `extras` 对无额外资源的平台为空对象或缺失
- ZIP 中的 `meta/` 目录仅在 WeChat 平台存在

### 7.3 前端 PLATFORM_SPECS 数据结构

```js
const PLATFORM_SPECS = {
  wechat_stickers: {
    minCount: 8, maxCount: 24, defaultCount: 8,
    showsStyle: true, showsPrompt: true,
    showsReward: true, showsExtraAssets: true, showsMetadata: true,
    showsTitle: true, showsAuthor: true, showsVersion: true, showsCopyright: true,
    previewLabel: "240 × 240", fileFormat: "PNG",
    extraAssetDefs: [cover, icon, banner, rewardGuide, rewardThanks],
    outputFormat: "png",
    exportHint: "此 ZIP 中包含符合微信表情包规范的资源文件。"
  },
  telegram_static: {
    minCount: 1, maxCount: 50, defaultCount: 8,
    showsStyle: true, showsPrompt: true,
    showsReward: false, showsExtraAssets: false, showsMetadata: false,
    showsTitle: true, showsAuthor: true, showsVersion: false, showsCopyright: false,
    previewLabel: "512 × 512", fileFormat: "PNG",
    extraAssetDefs: [],
    outputFormat: "png",
    exportHint: "此 ZIP 中包含 PNG 贴纸文件，可直接用于 Telegram。"
  },
  whatsapp_webp: {
    minCount: 1, maxCount: 30, defaultCount: 8,
    showsStyle: true, showsPrompt: true,
    showsReward: false, showsExtraAssets: false, showsMetadata: false,
    showsTitle: true, showsAuthor: true, showsVersion: false, showsCopyright: false,
    previewLabel: "512 × 512", fileFormat: "WebP",
    extraAssetDefs: [],
    outputFormat: "webp",
    exportHint: "此 ZIP 中包含 .webp 贴纸文件，可直接用于 WhatsApp。"
  }
};
```

---

## 8. 文件修改清单（完整）

### 前端

| 文件 | 修改内容 |
|------|----------|
| `public/index.html` | 1) Step 00 增加平台选择 `<select>`；2) Step 02 将 wechat-specific 字段用 `id` 包裹以便切换显示；3) 更新文案、badge 等引用 "微信" 的地方改为动态；4) 添加 `#specLabel` 等锚点；5) 保持 HTML 向后兼容 |
| `public/app.js` | 1) 新增 `PLATFORM_SPECS` 和 `currentPlatform`；2) 新增 `syncPlatformUI()`；3) 修改所有硬编码 `8`/`24` 为平台 spec 取值；4) API 路径改为动态 `/api/generate/*`；5) 持久化 key 和支持平台字段；6) 函数重命名（保留 WeChat 别名） |
| `public/styles.css` | 可能微调平台选择器的样式，影响极小 |

### 后端

| 文件 | 修改内容 |
|------|----------|
| `src/services/platform/presets.ts` | 新增 `outputFormat` 字段和 `description` 字段 |
| `src/services/wechat/aiFlow.ts` | 通用化为 `generateAssetsAndPack`，支持动态 presetId；调整 resize/format 逻辑 |
| `src/services/wechat/importFlow.ts` | 通用化为 `importStickerPack`，支持动态 presetId；调整 resize/format 逻辑 |
| `src/services/pack/service.ts` | `buildPackMetadata` 按 `presetId` 动态构建 extras 和目录结构；ZIP 内文件格式保持原始格式（不强制 PNG） |
| `src/routes/wechatAi.ts` | 新增 `/api/generate/*` 通用路由；保留 `/api/wechat/*` 别名；schema 校验动态化 |
| `src/routes/config.ts` | 返回 `platforms` 字段 + 保留 `wechat` 兼容字段 |
| `src/routes/uploads.ts` | **无变化**（上传已通用） |
| `src/services/ai/client.ts` | `generateImage` 尺寸已由外部传入，**无变化** |

### 不需要改动的文件

| 文件 | 原因 |
|------|------|
| `src/services/ai/provider.ts` | 接口通用 |
| `src/services/ai/index.ts` | 通用 |
| `src/services/ai/providers/*.ts` | AI 生成图片尺寸由外部传参，provider 自身不感知平台 |
| `src/services/wechat/promptConfig.ts` | 提示词模板结构通用 |
| `src/services/wechat/tasks.ts` | 任务系统通用 |
| `src/lib/*.ts` | 通用工具库 |
| `src/app.ts` | 路由注册顺序无关 |
| `src/server.ts` | 服务启动通用 |

---

## 9. 重点风险和边界情况

### 9.1 向后兼容

- **前端缓存**：用户如果浏览器缓存了旧的 `index.html`，会出现 JS 引用旧 API 路径。需要设置 `ETag` 或 `Cache-Control: no-cache`，或在 `app.js` 文件名加 hash。
- **浏览器 localStorage**：旧数据的 key 是 `easysticker:last-wechat-pack`，缺少 `platform` 字段。需要做版本检测和适配。
- **API 兼容**：`/api/wechat/*` 路由必须保留并正常工作至 v0.2.0 至少。

### 9.2 格式转换质量

- **WebP 转换**：WhatsApp 需要高质量 WebP 输出。`sharp` 转 WebP 时需设置合理的 quality（建议 85-92）。
- **GIF 动画**：WeChat 支持 GIF，但当前 `toStickerPng` 使用 `{ animated: false }`。如果用户导入 GIF，动画会丢失。这是已有行为，不在本次修改范围内。

### 9.3 前端状态复杂化

- `currentPlatform` + `currentCreationMode` 组成 2×3=6 种初始状态组合。重置流程需要同时重置两者。
- 每次 `syncPlatformUI()` 调用后，需要确保 validate 状态重新计算，避免残留校验错误。

### 9.4 平台选择锁定

- **规则**：一旦生成了结果（`hasGenerationAttempted && lastPackResult`），`platform` 选择器应当禁用并提示 "当前结果基于 X 平台生成，如需切换请重置"。
- **重置按钮**：清除结果后恢复平台选择能力。

### 9.5 导入文件格式校验

- WhatsApp 只接受 `.webp`，但用户导入时可能提供 PNG/JPG。后端需要做格式转换（PNG → WebP）。
- 建议导入时一律转换为目标平台格式，不管用户上传了什么格式。
- 当前 `importFlow.ts` 中的 SUPPORTED_MIMES 需要保持泛化（接受更多输入格式），然后根据 preset 决定输出格式。

### 9.6 Telegram 的尺寸灵活性

- Telegram `telegram_static` preset 没有 exactWidth/exactHeight，只有 `maxWidth: 512, maxHeight: 512` 和 `requiredSquare: true`。这意味着：
  - 允许不大于 512×512 的 PNG
  - 不需要恰好 512×512
  - resize 时用 `{ fit: "contain" }` 缩放到不超过 512×512
  - 前端预览标注为 "≤ 512 × 512"

### 9.7 导入流程的 minCount/maxCount

- WeChat 强制 8-24 张
- Telegram/WhatsApp 无限制
- 导入流程已用 `MIN_STICKER_COUNT` / `MAX_STICKER_COUNT` 控制，这部分动态化后，Telegram 导入 1 张也可以，WhatsApp 也是。

### 9.8 网络波动重试

- 现有的 SSE 重试机制（`maxRetries=3`）是通用的，不需要修改。
- 但注意重试时再请求 `/api/generate/stream`，当前的 task 回调机制需要支持按 presetId 正确重建。

### 9.9 调试和测试

- 测试覆盖每个平台的完整流程（AI 生成 + 导入）
- 特别测试：
  - WeChat→Telegram 切换（所有 WeChat-specific UI 应消失）
  - 重新生成时平台选择器应已禁用
  - 重置后平台选择器恢复
  - 导入 WhatsApp 时 PNG 输入→WebP 输出
  - 导出 ZIP 中 Telegram 贴纸没有 `meta/` 目录

---

## 10. 实施建议

### 10.1 分步实施顺序

1. **后端优先** — 通用化 `aiFlow.ts` 和 `importFlow.ts`，新增 `/api/generate/*` 路由
2. **config 扩展** — 更新 `/api/config` 返回 `platforms`
3. **前端核心逻辑** — `PLATFORM_SPECS`、`syncPlatformUI()`、API 动态化
4. **UI 调整** — `index.html` 的平台选择器和动态字段
5. **打包适配** — `pack/service.ts` 的 ZIP 结构和 metadata 动态化
6. **全面测试** — 三个平台的完整 E2E

### 10.2 最小可行版本

如果希望分步上线，MVP 可以：

- 只改后端（通用化和 `/api/generate/*` 路由）
- 前端先只通过 URL 参数或简单选择切换平台（不全面 UI 重构）
- 后续再完善前端的各平台差异 UI

但本次设计的目的是「一步到位」，以上建议仅供参考。
