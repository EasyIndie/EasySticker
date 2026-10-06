# 表情包格式与存储模型

> 本文说明 **服务端怎么存**（`data/` 目录）与 **导出的 ZIP 长什么样**（`metadata.json` / 目录结构）。
> 面向要对接、备份或写脚本处理产物的开发者。日常使用看 [README](../README.md)；
> 清理与备份操作看 [operations.md](operations.md)。

---

## 1. 存储模型：素材只存一份，ZIP 不落盘

```
data/uploads/<assetId>.<ext>     # 所有素材，只存一份（表情图 / 参考图 / 扩展资源）
data/packs/<packId>.json         # 包清单（几 KB），含逐张提示词 / 尺寸 / 角色 / owner
```

用户点「下载 ZIP」时才按清单**现场打包、边打边发**。因此：

- 单资源重生成、重建 ZIP 都只是写几 KB 清单，不会把整包图片再复制一遍；
- 磁盘占用约等于素材本身，没有「uploads 一份 + ZIP 一份」的双倍浪费。

> 历史遗留：早期版本把整包 ZIP 存在 `packs/<packId>.zip`。这些包会被 GC 转成清单
> （素材本来就在 uploads 里），下载链接不变；未转换前也仍可直接流式下载。

`uploads/` 还有一个隐藏文件 `.owners.jsonl`：素材归属索引（`assetId → owner`，追加写）。
它让「硬删账号」能精确清理该用户上传、但从未进入任何包的散图，见
[operations.md §3](operations.md#3-存储清理与回收)。`listAssetFiles` 会跳过以 `.` 开头的文件。

---

## 2. 导出的 ZIP 结构

```
<downloadFilename>.zip
├── assets/001.png            # 主表情（按 label 命名）
├── assets/002.png
├── meta/cover.png            # 封面图（微信）
├── meta/icon.png             # 聊天面板图标
├── meta/banner.png           # 详情页横幅
├── meta/reward-guide.png     # 赞赏引导图（可选）
├── meta/reward-thanks.png    # 赞赏感谢图（可选）
├── source/reference.png      # 参考图原图（不压缩、不改尺寸）
└── metadata.json             # 清单：文件名、尺寸、生成上下文、逐张提示词
```

> 具体包含哪些扩展资源取决于平台与选项（目前扩展资源仅微信生成）。

---

## 3. `metadata.json`（schema `easysticker-pack@0.3`）

记录**每个文件的名称与尺寸**，以及**生成时使用的提示词、要求与风格**，便于重新导入后继续编辑 / 优化。

> 在页面「导入已有图片」步骤里选择这个 ZIP，即可**还原生成现场**：提示词、风格、情绪、
> 参考图都会被读回，之后可以单张重新生成、导出，或在此基础上改提示词重做。

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

字段说明：

- `files` 覆盖包内**所有**图片（贴纸 + 封面 / 图标 / 横幅 / 赞赏图 + 参考图），
  每条都带 `width` / `height` / `format` / `mimeType` / `bytes`；贴纸与扩展资源还带各自
  实际使用的 `prompt` / `style`（贴纸另有 `emotion`）。编辑过的图会多出：
  - `sourceAssetId`：从哪一张改过来的；
  - `editReferenceAssetId`：用了哪张附加参考图。
- `role` 取值：`sticker` / `cover` / `icon` / `banner` / `reward-guide` / `reward-thanks` / `reference`。
- `generation` 记录整套图的生成上下文（提供商、模型、原始提示词、负向提示词、风格、参考图方式与尺寸），
  `source` 区分 `ai-generate` 与 `import`。
- 参考图原图存进 `source/reference.*`（不压缩、不改尺寸），配合 `generation` 即可**完整还原**这次生成：
  参考图 + 原始提示词 + 风格 + 情绪序列 → 可重放出同一套图，也可在此基础上做编辑。
- `assets` 是旧版最小清单，保留以兼容既有工具；新代码请优先读取 `files`。
- `owner`（包归属）**只进服务端清单，不进 ZIP 的 `metadata.json`** —— 那个会随表情包分发出去。

历史包（旧 schema，缺尺寸 / 提示词）可用 `npm run repair-pack` 就地补全，
见 [operations.md §3.4](operations.md#34-修复历史包)。

---

## 4. 参考图传递方式

打包时参考图会写入 `source/reference.*`；生成时如何把它传给模型由 `ai.referenceMode` 决定：

| 值 | 行为 | 状态 |
|----|------|------|
| `base64` | 读成 base64 内联进请求体（默认） | ✅ 有效 |
| `url` | 用 `ai.publicBaseUrl` 拼出 `/api/assets/:id` 的 URL | ✅ 有效 |
| `multipart` | 以 multipart 表单上传 | ✅ 有效 |
| `assetId` | 只传资产 id | ⚠️ 无 provider 消费，保留待实现 |

参考图也可以不来自上传：`POST /api/generate/reference` 能用文字直接生成一张参考图（文生图），
返回值与上传接口一致，见 [architecture.md §3.1](architecture.md#31-后端)。
