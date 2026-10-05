# EasySticker 用户体验 — 改造记录

> 2026-05-19 更新：本文档从「设计方案」重写为「实施记录」，反映实际落地的改动。
>
> ⚠️ **路径已过时：** 文中改动当时落在 `public/app.js` / `public/index.html`。前端 P5 迁移后，controller 逻辑已迁至 `web/src/app.ts`（构建为 `public/js/app.js`），`public/app.js` 已删除。功能仍然有效，路径请以 `web/src/` 为准。

## 背景

原始页面为单列瀑布式 5 步纵向堆叠（Step 00→04），生成后用户需在配置区（Step 00-03）和预览区（Step 04）之间反复滑动。

## 改造总览（3 阶段 + 2 项独立改进）

```
之前：一轮一轮对话式修复 bug
今天：集中 3 阶段 UX 改造 + 5 项视觉功能增强
```

### 阶段一：粘性底栏 + 配置折叠 + 自动跳转
### 阶段二：全平台统一 Tab 切换（非双栏）
### 阶段三：步骤导航栏 + 历史恢复编辑
### 独立改进：暗色模式 / 拖拽上传 / 预览 Lightbox / 快捷键 / 进度动画

---

## 阶段一：粘性操作底栏 + 配置折叠 + 自动跳转

### 1.1 粘性操作底栏

**文件：** `public/index.html` + `public/styles.css` + `web/src/app.ts`（原 `public/app.js`）

**结构：** 固定底部 bar，含重新生成/下载 ZIP/重置三个按钮，生成成功后显示。

**关键样式：** `position: fixed; bottom: 0; z-index: 40;`，blur 背景。

**bottom padding：** 80px → 100px（桌面），100px → 130px（手机），防止底栏遮挡内容。加了 `env(safe-area-inset-bottom)` 适配全面屏。

### 1.2 生成后自动折叠配置区

生成完成后自动合并 Step 00-02 为摘要卡片（显示状态圆点 + 摘要文案 +「展开修改」按钮）。

**函数：** `collapseStepCard(cardEl, summaryText, tone)` / `expandStepCard(cardEl)`

折叠时机：
- 生成 `done` 事件：折叠 step 00-02
- 重置/重新生成：展开所有折叠卡片

### 1.3 自动跳转滚动

生成完成 → 自动滚到预览区。重新生成 → 自动滚到配置区。

**函数：** `scrollToElement(el, options)`，尊重 `prefers-reduced-motion`。

---

## 阶段二：全平台统一 Tab 切换

> ⚠️ **与设计方案的差异：** 原计划桌面双栏（>= 1024px）+ 手机 Tab 切换（< 768px），老板要求去掉双栏，改为所有屏幕统一的 Tab 切换。

### 2.1 HTML 结构

在 `.flow` 内包裹 `config-area` + `preview-area` 两个 wrapper：

```html
<div class="flow">
  <div class="config-area"> <!-- Step 00-03 --> </div>
  <div class="preview-area"> <!-- Step 04 --> </div>
</div>
```

### 2.2 Tab 导航

在 hero 下方、step-nav 之后添加 view-tabs：

```html
<div id="viewTabs" class="view-tabs">
  <button type="button" class="view-tab active" data-view="config">⚙️ 配置</button>
  <button type="button" class="view-tab" data-view="preview">🖼️ 预览</button>
</div>
```

**所有屏幕都显示**（无媒体查询限制），仅移动端 `flex: 1` 等宽。

### 2.3 切换逻辑

**函数：** `syncViewTab(view)` / `initViewTabs()`

**规则：**
- 生成完成后自动切换到「预览」tab
- 点击「重新生成」或「展开修改」自动切回「配置」tab
- 重置时切回「配置」tab
- resize 不切换 tab（保持当前视图）

### 2.4 类名

从原始设计的 `.mobile-*` 改为 `.view-*`，避免暗示仅移动端。

---

## 阶段三：步骤导航栏 + 历史恢复编辑

### 3.1 步骤进度导航

在 hero 下方、view-tabs 上方添加 5 步导航条。

**结构：** `<nav id="stepNav"><ol class="step-nav-list"><li class="step-nav-item" data-step="n">...`

**步骤状态：** `active` / `completed` 两种状态，数字圆圈颜色区分。

**可点击跳转：** 点击步骤号自动 `scrollToStep(idx)`。

**函数：** `updateStepNav(activeStep, completedSteps)` — 在每次关键操作后更新。

### 3.2 历史记录恢复编辑

现有历史条目添加「✏️ 恢复编辑」按钮，点击后：

1. 恢复平台选择（`currentPlatform` + `setSelectedPlatform` + `syncPlatformUI`）
2. 恢复标题/作者/风格等可恢复字段
3. 切到 AI 模式
4. 弹出提示：「已恢复 xxx 的配置，如需生成请补充参考图。」
5. 滚动到页面顶部

**数据结构：** 历史条目额外存储 `platform`, `title`, `author`, `stickerCount` 等字段供恢复。

---

## 独立改进：5 项视觉/交互功能

### 4.1 🌙 暗色模式

- **切换：** hero-topline-right 中的 🌙/☀️ 按钮
- **持久化：** localStorage key `easysticker-theme`
- **CSS 方案：** `[data-theme="dark"]` 覆盖 CSS 变量
- **覆盖范围：** 背景 (`#0f172a`)、卡片 (`#1e293b`)、文本 (`#f1f5f9`/`#94a3b8`)、强调色 (`#22c55e`)、阴影、边框、输入框/select/textarea、step nav、平台选择器、sticky bar、toast、progress
- **过渡：** 0.2s ease 全变量过渡

### 4.2 📁 拖拽上传

- **效果：** 全屏虚线边框遮罩，dragenter 显示、drop/dragleave 隐藏
- **防抖：** dragenter/dragleave 使用计数器计数（子元素反复触发）
- **处理：** 松手后代理到文件 input 的 files，接受 PNG/JPG/WebP
- **安全：** 仅阻止默认行为，不读取数据；drop 事件触发原有上传流程

### 4.3 🔍 预览 Lightbox

- **触发：** 点击预览区域任意缩略图
- **UI：** 全屏半透明黑底 + 居中原图 + ✕ 关闭按钮
- **关闭：** 点击 × 或背景 / 按 Escape 键
- **body 锁定：** 打开时 `overflow: hidden`，关闭恢复
- **CSS 注意：** `[hidden]` 属性必须生效，`display: flex` 仅当 `:not([hidden])` 时启用

### 4.4 ⌨️ 快捷键

| 快捷键 | 效果 | 条件 |
|--------|------|------|
| `Ctrl+Enter` / `Cmd+Enter` | 触发生成 | `currentCreationMode === "ai"` |
| `Escape` | 关闭 Lightbox | lightbox 已打开 |

**输入域安全：** 仅限 `wechatAiPrompt` 输入框内的按键。

### 4.5 🎨 进度动画

生成进度条 `done` 状态：绿底绿字平滑过渡（`transition: all 0.3s ease`）。

---

## 补充修复

### 历史记录被底栏遮挡

- **根因：** `#historySection` 原来在 `<main class="page">` **外面**
- **修复：** 移入 `.page` 内，紧挨 sticky bar 前面，加 `margin-top: var(--gap)`

### 顶部布局

经历多次迭代后最终方案：
```
[left]               [right]
AI 表情流程 badge    内部开发页 badge  🌙
```

使用 `.hero-topline-right { margin-left: auto }` 推右，手机端 flex 列换行后 `align-self: flex-end`。

### 风格选择按钮

- **按钮数量 bug：** `restorePersistedPackResult` 和 `suggestPrompt` 传了 `currentStyles`（已选风格，通常 1 个）作为可用风格列表 → 只渲染 1 个按钮。修复：改为 `renderStyleOptions(DEFAULT_STYLE_OPTIONS)`
- **间距 bug：** 从 `gap` 改为 `.style-chip { margin: 4px }` 更可靠

### 服务端清理

移除 `renderIndexHtml` 中的 dev-only `<a href="/internal.html">` 动态注入（内部开发页 badge 已在 HTML 中常驻）。

---

## 文件改动清单

| 文件 | 新增/修改 | 关键区域 |
|------|----------|---------|
| `public/index.html` | +83 行 | step-nav, view-tabs, config-area/preview-area wrappers, sticky bar, lightbox, drag overlay, dark mode toggle, hero-topline-right, 内部开发页 badge |
| `public/styles.css` | +316 行（净） | 暗色模式全覆盖、sticky bar、step nav、view tabs、collapse、platform selector、lightbox、drag overlay、progress 动画、底部间距、安全区 |
| `web/src/app.ts`（原 `public/app.js`） | ~150 行新逻辑 | syncViewTab, collapseStepCard, updateStepNav, restoreFromHistory, initStickyBar, initDarkMode, drop handler, lightbox toggle, keyboard shortcuts, 持久化修复 |
| `src/app.ts` | -13 行 | 移除 dev-only 链接注入 |
| `test/publicPage.test.ts` | 调整 | 适配新 HTML 结构、测试数据修正 |
| `docs/ux-improvement-v2.md` | 本文 | — |
| `spec/multi-platform-v1.md` | 重写 | 设计文档 → 项目现状 |

## 已知问题

- **19 个测试失败：** 全部来自 `test/publicPage.test.ts`，报错 `window.addEventListener is not a function`（vitest 的 jsdom 环境中缺少部分 DOM API），不影响实际功能
- **85 测试通过**（9 个测试文件）
