# 更新日志

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 与
[语义化版本](https://semver.org/lang/zh-CN/)。
`0.x` 期间次版本可能包含破坏性变更，会在对应条目用 **BREAKING** 标注。

> 完整提交历史见 `git log`；本文件只记录面向使用者的显著变化。

## [未发布]

### 新增

- **多套提示词模板**：内置 6 套（日常聊天 / 职场吐槽 / 萌宠拟人 / 情侣互动 / 节日祝福 / 沙雕搞怪），
  在「配置与信息」一键套用；每次上传或 AI 生成参考图会**随机**推荐一套，缓解多次生成套图雷同。
  可在 `prompt-config.json` 用 `promptPresets` 整体覆盖。
- **情绪随机化**：每次生成前打乱情绪顺序再逐张分配，即使沿用同一套提示词也能得到不同排布。

### 变更

- **AI 提供商选择器前移**：从第 3 步「配置与信息」移到第 1 步；选择「AI 生成」后即可确认提供商，
  第 1 步顺序调整为「创建方式 → AI 提供商 → 目标平台」，「配置与信息」保留提示词 / 风格 / 数量 / 元数据。

## [0.2.0] - 2026-10-06

自 0.1.0 起共 100+ 次提交，按主题归纳。

### 新增

- **AI 生成参考图**：`POST /api/generate/reference`，用文字直接生成一张参考图（文生图），
  不再要求必须先上传图片；返回值与上传接口一致，可直接进入整套生成。
- **后台 · 全部包**：多选 / 全选 + 「删除选中」，单删与批量均二次确认
  （全选删除需输入 `DELETE`）；删除后**立即回收**该包素材。
- **后台 · 统计页重做**：按分钟聚合的请求吞吐、P50/P95 延迟、CPU/内存图表
  （真实坐标轴 + 网格 + 图例 + 悬浮读数），并新增「用户用量」「接口热点」明细表。
- **后台 · 用户管理**：硬删除账号（`DELETE /api/admin/users/:email`），
  `?purge=true` 一并清理名下包 / 素材、用量与监控记录，并回收该用户上传但从未进包的散图。
- **包归属与服务端历史**：`GET /api/packs` 只返回自己的包；历史记录一键还原生成现场。
- **单图二次编辑**：任一已生成图可「编辑图片」，只重做这一张，并可再附一张参考图；卡片标记「已编辑」。
- **导入 ZIP 还原**：选择本站下载的 ZIP 即可读回提示词 / 风格 / 情绪 / 参考图，继续单张生成或编辑。
- **`metadata.json` 升级到 `easysticker-pack@0.3`**：逐张记录名称 / 尺寸 / 角色 / 提示词 / 风格，
  参考图原图入包；详见 [docs/pack-format.md](docs/pack-format.md)。
- **内容哈希与长缓存**：前端资源按 `sha256[:8]` 版本化，素材与带版本资源 `immutable`，HTML `no-cache`。
- **后台仪表盘改 SSE**：由 15 秒轮询改为服务端推送。
- **项目级开发指令**：`.pi/extensions/dev-commands.ts` 提供 `/dev`、`/web`。

### 变更

- **生图统一为 OpenAI 兼容 Images API**（`gpt-image` / `generic` 两种 `variant`）；
  **BREAKING**：移除 ComfyUI、`doubao`、`hf`、`http`、`managedHttp`、`picsum` 等旧 provider，
  参考图契约文档随之作废（参考工作流 `comfy/workflow_api.json` 已删除）。
- **存储模型**：包只存清单（几 KB），ZIP 下载时现打，不再落盘；磁盘占用约减半。
- 后台暗色主题与主站统一；全站图标统一为 SVG（`currentColor`）。
- 管理后台账号改为**受保护**：不能被停用 / 删除，UI 按钮置灰并说明原因。

### 修复

- **安全**：停用 / 删除账号后，其已签发的 JWT 立即失效（此前要等 7 天过期）。
- 后台「重新体检 / 立即清理」「确认告警 / 启用禁用 / 删除包」缺少可见反馈（无 body 请求误带
  `content-type` 导致 400）。
- 公开页面里**相对引用**的 `admin.css` 命中 1 年 `immutable` 缓存，样式更新不生效。
- 编辑后本地状态未回写，刷新会退回编辑前的图；二次编辑会以旧图为源。
- `node --watch` 与 pino worker transport 冲突导致 `npm run dev` 启动即崩溃。

### 性能

- 素材查找由 O(目录大小) 扫描改为 O(1) 扩展名探测。
- 预览更新由整组重绘改为定点替换单个节点（消除多余图片请求与长任务）。
- 定期 GC（默认每 6 小时）+ 存储面板 + 手动 `npm run gc`；保留期默认 30 天且不追溯既往。

### 文档

- 收敛为「活文档 + 只读材料 + 参考实现」三层；新增
  [docs/development.md](docs/development.md)、[docs/pack-format.md](docs/pack-format.md)、
  本更新日志、[CONTRIBUTING](CONTRIBUTING.md)、[SECURITY](SECURITY.md) 与 CI。

## [0.1.0] - 2026-05-07

首个公开版本：AI 生成 / 批量导入表情包，微信 / Telegram / WhatsApp 多平台规格，
Sharp 尺寸与格式转换，结构化 ZIP（含 `metadata.json`）导出，SSE 生成进度，
管理后台（用户 / 存储 / 设置 / 监控告警），自托管部署（Docker + 反向代理）。

[未发布]: https://github.com/EasyIndie/EasySticker/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/EasyIndie/EasySticker/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/EasyIndie/EasySticker/releases/tag/v0.1.0
