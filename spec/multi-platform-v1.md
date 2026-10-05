# EasySticker 多平台支持 — 项目现状文档

> 2026-05-19 更新：本文档从「设计方案」更新为「项目现状」，反映已完成的实现。
>
> ⚠️ **路径已过时：** 文中 `public/app.js` 已删除，平台逻辑（`PLATFORM_SPECS` / `syncPlatformUI` / 持久化）已迁至 `web/src/app.ts`（构建为 `public/js/app.js`）。功能仍然有效，路径请以 `web/src/` 为准。

## 1. 状态总览

| 模块 | 状态 | 备注 |
|------|------|------|
| 平台选择器（前端 UI） | ✅ 已完成 | 微信/Telegram/WhatsApp 三选一 radio |
| 动态字段切换（`syncPlatformUI`） | ✅ 已完成 | 按平台切换字段可见性、文案、限制 |
| 后端 API 通用化 | ✅ 已完成 | `/api/generate/*` 路由 + `/api/wechat/*` 别名 |
| config 返回 platforms | ✅ 已完成 | 兼容旧 `wechat` 字段 |
| 图片格式转换 | ✅ 已完成 | WhatsApp→WebP, TG/WX→PNG |
| ZIP 打包按平台 | ✅ 已完成 | metadata 动态化, extras 仅微信生成 |
| 持久化恢复 | ✅ 已完成 | 存储/恢复 platform 字段 |
| 功能级测试 | ✅ 已完成 | 44 测试通过 |

## 2. 前端实现

### 2.1 平台选择器

**位置：** `public/index.html`，Step 00，`#platformSelector`

**实现：** 三个 radio button（非 spec 中建议的 `<select>`），带 emoji icon：

```html
<div class="platform-selector" id="platformSelector" role="radiogroup" aria-label="目标平台">
  <label class="platform-option" data-platform="wechat_stickers">
    <input type="radio" name="platform" value="wechat_stickers" checked />
    <span class="platform-icon">💬</span>
    <span class="platform-name">微信</span>
    <span class="platform-spec">240×240 PNG</span>
  </label>
  <label class="platform-option" data-platform="telegram_static">
    <input type="radio" name="platform" value="telegram_static" />
    <span class="platform-icon">✈️</span>
    <span class="platform-name">Telegram</span>
    <span class="platform-spec">512×512 PNG</span>
  </label>
  <label class="platform-option" data-platform="whatsapp_webp">
    <input type="radio" name="platform" value="whatsapp_webp" />
    <span class="platform-icon">📱</span>
    <span class="platform-name">WhatsApp</span>
    <span class="platform-spec">512×512 WebP</span>
  </label>
</div>
```

### 2.2 PLATFORM_SPECS

**位置：** `public/app.js` line 139-195

```js
const PLATFORM_SPECS = {
  wechat_stickers: {
    minCount: 8, maxCount: 24, defaultCount: 8,
    showsReward: true, showsExtraAssets: true, showsMetadata: true,
    showsTitle: true, showsAuthor: true, showsVersion: true, showsCopyright: true,
    platformLabel: "微信表情包",
    previewLabel: "240 × 240", outputFormat: "png",
    exportHint: "此 ZIP 中包含符合微信表情包规范的资源文件。",
    heroText: "上传参考图，补充提示词，一键生成可预览、可下载的微信表情包。",
    importDesc: "已有成品图片时，可直接批量导入并自动规范为微信表情包规格。",
    importHint: "导入后会统一居中、等比缩放、补透明边，并转换为符合微信表情包规范的 PNG。",
    importHeading: "导入已有表情图",
    importUploadText: "选择图片（支持 PNG / JPG / GIF）",
    importAccept: ".png,.jpg,.jpeg,.gif",
    generateDesc: "点击生成后，系统将依据参考图风格和提示词生成表情包贴纸。",
    countHint: "微信表情包通常包含 8-24 张贴纸。",
    extraAssetDefs: [/* cover/icon/banner/rewardGuide/rewardThanks */]
  },
  telegram_static: {
    minCount: 1, maxCount: 50, defaultCount: 8,
    showsReward: false, showsExtraAssets: false, showsMetadata: false,
    showsTitle: true, showsAuthor: true, showsVersion: false, showsCopyright: false,
    platformLabel: "Telegram 贴纸",
    previewLabel: "512 × 512", outputFormat: "png",
    exportHint: "此 ZIP 中包含 PNG 贴纸文件，可直接用于 Telegram。",
    heroText: "上传参考图，补充提示词，一键生成可预览、可下载的 Telegram 贴纸包。",
    importDesc: "已有成品图片时，可直接批量导入并自动规范为 Telegram 贴纸规格。",
    importHint: "导入后会统一居中、等比缩放、补透明边，并转换为符合 Telegram 贴纸规格的 PNG。",
    importHeading: "导入已有贴纸",
    importUploadText: "选择图片（支持 PNG）",
    importAccept: ".png",
    generateDesc: "点击生成后，系统将依据参考图风格和提示词生成 Telegram 贴纸。",
    countHint: "Telegram 贴纸包支持 1-50 张贴纸。",
    extraAssetDefs: []
  },
  whatsapp_webp: {
    minCount: 1, maxCount: 30, defaultCount: 8,
    showsReward: false, showsExtraAssets: false, showsMetadata: false,
    showsTitle: true, showsAuthor: true, showsVersion: false, showsCopyright: false,
    platformLabel: "WhatsApp 贴纸",
    previewLabel: "512 × 512", outputFormat: "webp",
    exportHint: "此 ZIP 中包含 .webp 贴纸文件，可直接用于 WhatsApp。",
    heroText: "上传参考图，补充提示词，一键生成可预览、可下载的 WhatsApp 贴纸包。",
    importDesc: "已有成品图片时，可直接批量导入并自动规范为 WhatsApp 贴纸规格。",
    importHint: "导入后会统一居中、等比缩放、补透明边，并转换为符合 WhatsApp 贴纸规格的 WebP。",
    importHeading: "导入已有贴纸",
    importUploadText: "选择图片（支持 WebP）",
    importAccept: ".webp",
    generateDesc: "点击生成后，系统将依据参考图风格和提示词生成 WhatsApp 贴纸。",
    countHint: "WhatsApp 贴纸包支持 1-30 张贴纸。",
    extraAssetDefs: []
  }
};
```

### 2.3 syncPlatformUI()

**位置：** `public/app.js` line 513-611

**功能：** 根据 `currentPlatform` 动态切换：

| 效果 | 切换内容 |
|------|----------|
| 更新全局限制 | `MIN_STICKER_COUNT` / `MAX_STICKER_COUNT` / `DEFAULT_STICKER_COUNT` |
| 更新计数器 stepper | `wechatAiCount.min/max` |
| 显示/隐藏字段 | reward / extra assets / metadata / version / copyright / title / author |
| 更新文案 | hero badge / hero text / import section / generate section / count hint / preview spec |
| 锁定/解锁 | 生成后锁定平台选择器 |
| 重置 | 限制变化后清除校验状态 |
| 同步 reward | 不支持 reward 的平台自动关闭 |

### 2.4 生成后平台锁定

**规则：** 一旦 `hasGenerationAttempted && lastPackResult`，`platformSelector` radio 全部 `disabled`。

**解除：** 点击重置按钮清除结果后恢复。

### 2.5 持久化

**localStorage key：** `easysticker:last-pack`（旧 key `easysticker:last-wechat-pack` 已做兼容）

**数据结构：**

```json
{
  "platform": "wechat_stickers",
  "uploadId": "xxx",
  "provider": "...",
  "styles": ["扁平插画"],
  "prompt": "...",
  "result": { ... },
  "hasGenerationAttempted": true
}
```

**恢复：** `restorePersistedPackResult()` 自动恢复平台状态并调用 `syncPlatformUI()`

### 2.6 快捷键

- `Ctrl+Enter` 触发生成（仅当 `currentCreationMode === "ai"`）
- `Escape` 关闭 lightbox（如果有打开的话）

## 3. 后端实现

### 3.1 API 路由

| 路由 | 方法 | 说明 |
|------|------|------|
| `/api/generate/prompt` | POST | 提示词建议，接受 `referenceAssetId` + `presetId` |
| `/api/generate/start` | POST | 启动生成，接受 `presetId` 等参数 |
| `/api/generate/stream` | GET | SSE 流式进度 |
| `/api/generate/cancel` | POST | 取消生成 |
| `/api/generate/import` | POST | 导入已有图片 |
| `/api/generate/import-pack` | POST | 导入本站下载的 ZIP 包，还原提示词 / 风格 / 参考图 |
| `/api/packs/:packId/restore` | POST | 按 packId 还原服务端已存的包（历史记录「一键还原」，不复制新包） |
| `/api/packs` | GET | 当前用户自己的包列表（登录按邮箱，未登录按 `x-client-id`）+ 保留期信息 |
| `/api/packs/:packId` | DELETE | 删除包（清单 + 旧 ZIP），素材交给 GC 回收 |
| `/api/admin/storage` | GET | 存储占用体检 + 全部包列表（管理员） |
| `/api/admin/storage/gc` | POST | 手动执行数据目录清理（管理员） |
| `/api/wechat/*` | 同上 | 向后兼容别名，固定 `presetId=wechat_stickers` |

### 3.2 config 端点

`GET /api/config` 返回：

```json
{
  "wechat": { /* 旧格式，向后兼容 */ },
  "platforms": {
    "wechat_stickers": { /* 完整配置 */ },
    "telegram_static": { /* 完整配置 */ },
    "whatsapp_webp": { /* 完整配置 */ }
  }
}
```

每个 platform 包含：`title`, `description`, `minCount`, `maxCount`, `defaultCount`, `outputFormat`, `ai` (availableProviders + defaultProvider), `supportsExtraAssets`, `supportsReward`, `supportsMetadata`, `extraAssetTypes`, `preset` (allowedExts, maxBytes, exactWidth, exactHeight 等)

### 3.3 生成流程（`flow.ts`）

`generateAssetsAndPack()` 根据 `presetId`：

- 决定 resize 目标尺寸（从 preset 的 exactWidth/exactHeight 取）
- 决定输出格式（WhatsApp→WebP, 其他→PNG）
- 决定是否生成额外资源（仅微信）
- WebP 质量动态递减至 ≤100KB
- PNG 超 512KB 降级 palette 量化

### 3.4 图片处理

**已实现的平台格式转换：**

| 平台 | 目标格式 | 目标尺寸 | 文件大小限制 | 特殊处理 |
|------|---------|---------|-------------|---------|
| 微信表情 | PNG | 240×240 | 512KB | lossless 压缩 |
| Telegram | PNG | 512×512 | 512KB | 超限 palette 量化降级 |
| WhatsApp | WebP | 512×512 | 100KB | quality 30-90 递减探索 |

### 3.5 ZIP 打包

- 微信：含 `meta/` 目录（cover/icon/banner/reward 等额外资源）+ `metadata.json`
- Telegram：仅有贴纸 PNG 文件 + `metadata.json`（无 extras）
- WhatsApp：仅有贴纸 WebP 文件 + `metadata.json`（无 extras）

## 4. 未完成/待改进

| 项 | 说明 | 优先级 |
|----|------|--------|
| 平台间切换后未提交的字段校验残留 | 当前 `syncPlatformUI` 已调用 `clearGenerateValidation()` 处理 | ✅ 已处理 |
| 导入流程的格式自动转换 | 当前 `importFlow.ts` 支持多格式输入，输出按 preset | ✅ 已处理 |
| 动画 GIF 支持 | 微信支持 GIF 但当前 pipeline 默认 `animated: false` | P4 |
| WebP 动画 | WhatsApp 暂无动画贴纸需求 | P4 |
| 批量导入进度 | 导入多张时缺少分步进度反馈 | P3 |
| 平台间切换动画 | 现在 `hidden` 切换直接跳变 | P4 |

## 5. 关键决策记录

### 5.1 radio 而非 select

设计文档建议用 `<select>` 做平台选择，实际使用 radio button + emoji icon，每个选项独立 `label`，更直观、操作区域更大、移动端更好点按。

### 5.2 PLATFORM_SPECS 扩展字段

相比设计文档，实际实现增加了大量前端显示字段：`platformLabel`, `heroText`, `importDesc`, `importHint`, `importHeading`, `importUploadText`, `importAccept`, `generateDesc`, `countHint`。这些字段使 `syncPlatformUI()` 能一站式更新所有文案，无需在多个函数里写 if-else。

### 5.3 后端直接使用 `/api/generate/*` 路由

设计文档建议保留 `/api/wechat/*` 并新增 `/api/generate/*`。实际实现直接注册 `/api/generate/*` 作为主路由，`/api/wechat/*` 作为向后兼容别名。

### 5.4 持久化 key 改名

`easysticker:last-wechat-pack` → `easysticker:last-pack`，旧 key 兼容检测。

## 6. 相关文件索引

| 文件 | 关键区域 |
|------|---------|
| `public/index.html` | 平台选择器, 步骤卡片 |
| `public/app.js` | `PLATFORM_SPECS`, `syncPlatformUI`, 持久化 |
| `public/styles.css` | 平台选择器样式, step nav, sticky bar, 暗色模式 |
| `src/app.ts` | 路由注册 (86-90) |
| `src/routes/generate.ts` | 生成 API |
| `src/routes/config.ts` | config API |
| `src/services/generate/flow.ts` | 格式转换, palette 量化 |
| `src/services/platform/presets.ts` | 平台预设配置 |
| `src/services/platform/validate.ts` | 格式校验 |
| `src/services/pack/service.ts` | ZIP 打包 |
| `test/publicPage.test.ts` | 前端集成测试 |
| `test/pipeline.test.ts` | 全流程 E2E 测试 |
