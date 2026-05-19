# UX 用户体验改造 v2 — 多阶段改造方案

## 目标

解决当前页面「反复上下滑动」的问题，桌面端与移动端同时优化。

## 当前问题

- 单列瀑布式布局，共 5 个 step card（00→04）纵向堆叠
- 生成后用户需在「配置区（步骤 00-03）」和「预览区（步骤 04）」之间反复滑动
- 移动端屏幕窄，问题更突出

## 改造总览（3 阶段）

```
阶段一：粘性底栏 + 配置折叠 + 自动跳转
阶段二：桌面双栏布局 + 手机 Tab 切换
阶段三：步骤导航栏 + 历史恢复编辑
```

---

## 阶段一：粘性底栏 + 配置折叠 + 自动跳转

### 1.1 粘性操作底栏

**文件：** `public/index.html` + `public/styles.css`

**HTML 改动：** 在 `<main>` 末尾、`<section id="historySection">` 之前，添加：

```html
<div id="stickyActionBar" class="sticky-action-bar" hidden>
  <div class="sticky-action-bar-inner">
    <div class="sticky-action-left">
      <span id="stickyStatus" class="sticky-status"></span>
    </div>
    <div class="sticky-action-right">
      <button type="button" id="stickyRegenerate" class="sticky-action-btn secondary">🔄 重新生成</button>
      <button type="button" id="stickyDownload" class="sticky-action-btn">📥 下载 ZIP</button>
      <button type="button" id="stickyReset" class="sticky-action-btn secondary">↺ 重置</button>
    </div>
  </div>
</div>
```

**CSS 改动：**

```css
.sticky-action-bar {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  z-index: 40;
  background: rgba(255, 255, 255, 0.96);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border-top: 1px solid var(--color-border-subtle);
  box-shadow: 0 -4px 16px rgba(17, 24, 39, 0.08);
  padding: 12px 16px;
  transition: transform 0.25s ease, opacity 0.25s ease;
}

.sticky-action-bar[hidden] {
  display: none;
}

.sticky-action-bar-inner {
  max-width: 980px;
  margin: 0 auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.sticky-action-left {
  font-size: var(--font-13);
  color: var(--color-text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 1;
  min-width: 0;
}

.sticky-action-right {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}

.sticky-action-btn {
  padding: 8px 14px;
  font-size: var(--font-13);
  border-radius: var(--radius-md);
  white-space: nowrap;
}

@media (max-width: 520px) {
  .sticky-action-bar-inner {
    flex-direction: column;
    gap: 8px;
  }
  .sticky-action-left {
    text-align: center;
  }
  .sticky-action-right {
    width: 100%;
  }
  .sticky-action-btn {
    flex: 1;
    text-align: center;
  }
}
```

**页面底部 padding 增加：** `.page` 增加 `padding-bottom: 80px` 以免被底栏遮挡。

### 1.2 生成后自动折叠配置区（步骤 00-02）

**文件：** `public/styles.css` + `public/app.js`

**CSS 改动：** 为 step card 添加折叠状态类名与动画过渡。

```css
.step-card.collapsed {
  /* 折叠态：高度收缩，不显示配置内容，只保留摘要行 */
}

.step-card .step-summary {
  display: none; /* 默认不显示摘要，只在 collapsed 时显示 */
}

.step-card.collapsed .step-body,
.step-card.collapsed .step-index,
.step-card.collapsed .step-head p {
  display: none;
}

.step-card.collapsed .step-summary {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 0;
}

.step-card.collapsed .step-head {
  margin-bottom: 0;
}

.step-summary-status {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex-shrink: 0;
}

.step-summary-status[data-tone="success"] {
  background: var(--color-success);
}

.step-summary-status[data-tone="loading"] {
  background: var(--color-info);
}

.step-summary-text {
  flex: 1;
  font-size: var(--font-13);
  color: var(--color-text-secondary);
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.step-summary-edit {
  padding: 4px 10px;
  font-size: var(--font-12);
  border-radius: var(--radius-sm);
  cursor: pointer;
  flex-shrink: 0;
}

.step-card-collapse-target {
  transition: opacity 0.2s ease, max-height 0.3s ease;
}
```

**JS 改动：** 添加 `collapseStepCard()` / `expandStepCard()` 函数。

```js
function collapseStepCard(cardEl, summaryText, tone = "success") {
  if (!cardEl || cardEl.classList.contains("collapsed")) return;
  
  // 确保有 summary 容器
  let summary = cardEl.querySelector(".step-summary");
  if (!summary) {
    summary = document.createElement("div");
    summary.className = "step-summary";
    
    const statusDot = document.createElement("span");
    statusDot.className = "step-summary-status";
    statusDot.dataset.tone = tone;
    
    const textEl = document.createElement("span");
    textEl.className = "step-summary-text";
    
    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.className = "step-summary-edit secondary";
    editBtn.textContent = "展开修改";
    editBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      expandStepCard(cardEl);
    });
    
    summary.appendChild(statusDot);
    summary.appendChild(textEl);
    summary.appendChild(editBtn);
    cardEl.querySelector(".step-head").appendChild(summary);
  }
  
  cardEl.querySelector(".step-summary-text").textContent = summaryText;
  cardEl.querySelector(".step-summary-status").dataset.tone = tone;
  cardEl.classList.add("collapsed");
}

function expandStepCard(cardEl) {
  if (!cardEl || !cardEl.classList.contains("collapsed")) return;
  cardEl.classList.remove("collapsed");
}
```

在 `generatePlatformPack` 的 `done` 事件触发时，调用 `collapseStepCard` 折叠 step 00-02。
在 `resetAllState` / `regenerate` 时调用 `expandStepCard` 展开。

### 1.3 自动跳转滚动

**文件：** `public/app.js`

**JS 改动：**
- 生成完成时自动滚动到预览区域开头
- 点击「重新生成」时自动滚动到配置区
- 使用 `prefers-reduced-motion` 检测

```js
function scrollToElement(el, options = {}) {
  if (!el) return;
  const prefersReducedMotion = Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches);
  try {
    el.scrollIntoView({
      behavior: prefersReducedMotion ? "auto" : "smooth",
      block: options.block || "start"
    });
  } catch {
    el.scrollIntoView();
  }
}

// 在 generate 完成时：
scrollToElement(document.querySelector(".preview-column"), { block: "start" });
// 或者在双栏布局下不需要此操作
```

---

## 阶段二：桌面双栏布局 + 手机 Tab 布局

### 2.1 HTML 结构重排

**核心思路：** 不改变现有 HTML 层次结构，通过 wrapper div + CSS grid 实现布局切换。

在 `.flow` 内部包裹步骤，增加两个 wrapper：

```html
<div class="flow">
  <!-- Config Area -->
  <div class="config-area">
    <!-- 现有 step 00-03 卡片 -->
    <article class="card step-card">...选择平台...</article>
    <article class="card step-card">...上传参考图...</article>
    <article class="card step-card">...配置与信息...</article>
    <article class="card step-card">...生成按钮...</article>
  </div>
  
  <!-- Preview Area -->
  <div class="preview-area">
    <!-- 现有 step 04 预览卡片 -->
    <article class="card step-card">...预览与下载...</article>
  </div>
</div>
```

### 2.2 CSS — 双栏布局（桌面 >= 1024px）

```css
@media (min-width: 1024px) {
  .flow {
    display: grid;
    grid-template-columns: 380px 1fr;
    gap: var(--gap);
    align-items: start;
  }
  
  .config-area {
    position: sticky;
    top: 16px;
    max-height: calc(100vh - 32px);
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: var(--gap);
  }
  
  .preview-area {
    min-width: 0;
  }
}
```

### 2.3 CSS — 单列（移动端 < 1024px）

```css
@media (max-width: 1023px) {
  .flow {
    display: block;
  }
  
  /* 默认所有内容按顺序显示 */
  .config-area,
  .preview-area {
    display: block;
  }
}
```

### 2.4 手机端 Tab 切换（< 768px）

**HTML 改动：** 在页面顶部（hero 下方）添加 tab 导航栏：

```html
<div id="mobileViewTabs" class="mobile-view-tabs" hidden>
  <button type="button" class="mobile-tab active" data-view="config">⚙️ 配置</button>
  <button type="button" class="mobile-tab" data-view="preview">🖼️ 预览</button>
</div>
```

只在移动端显示 `< 768px`。配置模式下显示 config-area，预览模式下显示 preview-area。

**JS 改动：** 添加 tab 切换逻辑：

```js
const mobileViewTabs = document.getElementById("mobileViewTabs");
const configArea = document.querySelector(".config-area");
const previewArea = document.querySelector(".preview-area");

function syncMobileView(view) {
  if (!configArea || !previewArea || !mobileViewTabs) return;
  
  const tabs = mobileViewTabs.querySelectorAll(".mobile-tab");
  tabs.forEach(t => {
    t.classList.toggle("active", t.dataset.view === view);
    t.setAttribute("aria-pressed", t.dataset.view === view ? "true" : "false");
  });
  
  const isMobile = window.innerWidth < 768;
  if (!isMobile) {
    // 桌面端：两者都显示
    configArea.hidden = false;
    previewArea.hidden = false;
    mobileViewTabs.hidden = true;
    return;
  }
  
  // 手机端：按 tab 切换
  configArea.hidden = view !== "config";
  previewArea.hidden = view !== "preview";
  
  // 生成后自动切到预览
  if (view === "preview") {
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
}

// 监听 resize
let resizeTimer;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    const isMobile = window.innerWidth < 768;
    mobileViewTabs.hidden = false; // always show tabs on mobile
  
    // On resize from mobile to desktop, show both
    if (!isMobile) {
      configArea.hidden = false;
      previewArea.hidden = false;
      mobileViewTabs.hidden = true;
    } else {
      mobileViewTabs.hidden = false;
      // Intentionally use current view from active tab
      const activeTab = mobileViewTabs.querySelector(".mobile-tab.active");
      syncMobileView(activeTab?.dataset?.view || "config");
    }
  }, 200);
});
```

加入现有的 `syncPlatformUI`、`renderCompletedPackResult`、`generatePlatformPack` 等函数中，适当位置触发 `syncMobileView` 更新。

---

## 阶段三：步骤导航栏 + 历史恢复编辑

### 3.1 步骤进度导航

在 hero 下方添加步骤导航栏：

```html
<nav id="stepNav" class="step-nav" aria-label="操作步骤">
  <ol class="step-nav-list">
    <li class="step-nav-item active" data-step="0">
      <span class="step-nav-number">1</span>
      <span class="step-nav-label">选择平台</span>
    </li>
    <li class="step-nav-item" data-step="1">
      <span class="step-nav-number">2</span>
      <span class="step-nav-label">上传参考图</span>
    </li>
    <li class="step-nav-item" data-step="2">
      <span class="step-nav-number">3</span>
      <span class="step-nav-label">配置参数</span>
    </li>
    <li class="step-nav-item" data-step="3">
      <span class="step-nav-number">4</span>
      <span class="step-nav-label">生成</span>
    </li>
    <li class="step-nav-item" data-step="4">
      <span class="step-nav-number">5</span>
      <span class="step-nav-label">预览下载</span>
    </li>
  </ol>
</nav>
```

CSS 样式：

```css
.step-nav {
  margin-bottom: var(--space-5);
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
}

.step-nav-list {
  display: flex;
  gap: 0;
  list-style: none;
  padding: 0;
  margin: 0;
  min-width: max-content;
}

.step-nav-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 16px 8px 12px;
  position: relative;
  cursor: pointer;
  color: var(--color-text-tertiary);
  transition: color 0.2s ease;
  flex-shrink: 0;
}

.step-nav-item::after {
  content: "›";
  margin-left: 12px;
  color: var(--color-border-default);
  font-size: 18px;
  line-height: 1;
}

.step-nav-item:last-child::after {
  display: none;
}

.step-nav-item.active {
  color: var(--color-primary);
  font-weight: 600;
}

.step-nav-item.completed {
  color: var(--color-success);
}

.step-nav-number {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  font-size: var(--font-12);
  font-weight: 700;
  background: var(--color-border-subtle);
  color: var(--color-text-secondary);
  flex-shrink: 0;
  transition: background 0.2s ease, color 0.2s ease;
}

.step-nav-item.active .step-nav-number {
  background: var(--color-primary);
  color: white;
}

.step-nav-item.completed .step-nav-number {
  background: var(--color-success);
  color: white;
}

.step-nav-label {
  font-size: var(--font-13);
  white-space: nowrap;
}

@media (max-width: 520px) {
  .step-nav {
    margin-bottom: var(--space-3);
  }
  .step-nav-item {
    padding: 6px 12px 6px 8px;
  }
  .step-nav-label {
    font-size: var(--font-12);
  }
}
```

**JS 改动：** 添加 `updateStepNav` 函数，在关键操作时更新步骤状态。

```js
const STEP_NAV_ITEMS = [
  { step: 0, label: "选择平台" },
  { step: 1, label: "上传参考图" },
  { step: 2, label: "配置参数" },
  { step: 3, label: "生成" },
  { step: 4, label: "预览下载" }
];

function updateStepNav(activeStep, completedSteps = []) {
  const nav = document.getElementById("stepNav");
  if (!nav) return;
  
  const items = nav.querySelectorAll(".step-nav-item");
  items.forEach((item, idx) => {
    item.classList.remove("active", "completed");
    if (idx === activeStep) item.classList.add("active");
    else if (completedSteps.includes(idx)) item.classList.add("completed");
    
    // Click to scroll to step
    item.onclick = () => {
      const targetStep = parseInt(item.dataset.step);
      scrollToStep(targetStep);
    };
  });
}

function scrollToStep(stepIndex) {
  const cards = document.querySelectorAll(".step-card");
  if (cards[stepIndex]) {
    scrollToElement(cards[stepIndex], { block: "start" });
  }
}
```

在以下时机调用 `updateStepNav`：
- 上传成功后 → step 1 completed, active step 2
- 生成完成后 → steps 0-3 completed, active step 4
- 重新开始/重置 → active step 0
- 切换到导入模式 → step 1 completed

### 3.2 历史记录恢复编辑

目前历史记录只有「下载」按钮，需要添加「恢复编辑」按钮。

**HTML 改动：** 在 history-item-actions 内添加恢复按钮：

```html
<button type="button" class="secondary history-restore-btn" data-pack-id="xxx">✏️ 恢复编辑</button>
```

**JS 改动：** 在 `renderPackHistory` 中添加恢复编辑逻辑。

```js
// 在 renderPackHistory 的 history-item-actions 中添加
<button type="button" class="secondary history-restore-btn" data-pack-id="${escapeAttr(entry.packId)}">✏️ 恢复编辑</button>

// 事件绑定
historyList.querySelectorAll(".history-restore-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    const packId = btn.dataset.packId;
    // 找到历史记录中对应的完整结果
    restoreFromHistory(packId);
  });
});
```

`restoreFromHistory` 实现：

```js
function restoreFromHistory(packId) {
  const history = getPackHistory();
  const entry = history.find(h => h.packId === packId);
  if (!entry) return;
  
  // 恢复平台选择
  if (entry.platform && PLATFORM_SPECS[entry.platform]) {
    currentPlatform = entry.platform;
    setSelectedPlatform(currentPlatform);
    syncPlatformUI();
  }
  
  // 先重置，但不清除历史
  resetAllState();
  
  // 恢复能恢复的字段
  if (entry.title) wechatAiTitle.value = entry.title;
  if (entry.author) wechatAiAuthor.value = entry.author;
  if (entry.stickerCount) wechatAiCount.value = String(entry.stickerCount);
  
  // 切到 AI 模式
  if (creationModeAi) creationModeAi.checked = true;
  syncCreationMode();
  
  setNotice(`已恢复「${entry.title}」的配置，如需生成请补充参考图。`, "info");
  scrollToElement(document.querySelector(".flow"), { block: "start" });
}
```

---

## 实现顺序

1. 先改 `public/styles.css` — 添加所有新增样式
2. 再改 `public/index.html` — 添加新的 DOM 元素（sticky bar, tab, step nav, wrappers）
3. 最后改 `public/app.js` — 添加所有交互逻辑
4. 构建验证
5. 启动 3002 端口确认

---

## 注意事项

- 所有改动不破坏现有功能（上传、生成、下载、历史）
- 保持无障碍 aria 属性
- 手机端 < 768px 按 Tab 切换；768-1023px 仍是单列但显示完整内容；>= 1024px 双栏
- `position: sticky` 和 `position: fixed` 不能混用在同一区域
- 浏览器兼容性：现代浏览器（Safari 15+, Chrome 90+, Firefox 90+）
