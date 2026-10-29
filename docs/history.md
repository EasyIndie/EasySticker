# 改造历史与关键决策

> ⚠️ **这是只读的历史记录，描述的是当时的状态，不是现状。**
> 想了解当前实现请看 [architecture.md](architecture.md)；实现细节用 `git log -p <path>` 查。
>
> 保留本文的目的只有一个：记住**为什么**这么改，以及**哪些当初的做法后来被推翻了**。

---

## 1. 认证统一（当时的做法）

**问题**：首页与管理后台各有一套登录逻辑，token 分别存在 `localStorage` 与 `sessionStorage`，
退出标记不一致，导致「首页登出了后台还登着」。

**结论**：收敛成单一状态源。

- token / user 统一存 `localStorage` 的 `easysticker_token` / `easysticker_user`；
- 退出标记统一为 `sessionStorage.easysticker_logged_out`；
- 首页监听 `storage` 事件，其他标签页登录/退出实时感知。

**后来**：前端切片迁移后，这套逻辑落在 `web/src/store/auth.ts`（单一状态源）与
`web/src/features/auth.ts`（DOM 控制器）；管理后台改为**复用同一套 localStorage key 但不 import 前端模块**，
因为它被构建成独立 IIFE。

---

## 2. UX v2（当时的做法）

**问题**：单列瀑布式 5 步堆叠，生成后用户要在配置区与预览区之间反复滑动。

**做法**：

| 改动 | 说明 |
|------|------|
| 粘性操作底栏 | 固定底部 bar（重新生成 / 下载 ZIP / 重置），加 `env(safe-area-inset-bottom)` |
| 生成后自动折叠配置区 | Step 00-02 折叠为摘要卡（状态圆点 + 摘要 + 「展开修改」） |
| 自动跳转滚动 | 生成完滚到预览区，重新生成滚回配置区，尊重 `prefers-reduced-motion` |
| 暗色模式 | `data-theme` + `localStorage.easysticker-theme`，跨页保持一致 |
| 拖拽上传、预览 Lightbox、快捷键、进度动画 | 若干独立增强 |

**后来被推翻的部分**：

- ❌ **顶部 Tab 切换（配置区 / 预览区）**：后来去掉了，改成**单列步骤序号卡片、逐卡片配置**，
  不用手动切 Tab。`.config-area` / `.preview-area` 现在只剩布局分组作用，不再承载 Tab 语义。
- ❌ **桌面双栏**：方案阶段计划 ≥1024px 双栏、<768px 切 Tab，实际从未采用双栏。
- 🔁 **图标从 emoji 换成统一 SVG**（`stroke="currentColor"`，自动适配亮/暗）。

**仍然有效的部分**：粘性底栏、折叠摘要卡、自动滚动、暗色模式、拖拽上传、Lightbox、快捷键。

---

## 3. 多平台支持（当时的做法）

**目标**：一套流程产出微信 / Telegram / WhatsApp 三种规格，而不是各写一遍。

**做法**：把平台差异全部数据化 —— `PLATFORM_SPECS`（数量上下限、字段可见性、文案、
交付尺寸与格式）驱动前端 UI；后端用 `PlatformPreset` 取代散落的 `isWeChat` 判断；
扩展资源（封面/图标/横幅/赞赏图）只对微信生成。

**交付规格**：微信 240×240 PNG、Telegram ≤512×512 PNG、WhatsApp 512×512 WebP。

**后来被推翻的部分**：

- ❌ **`/api/wechat/*` 兼容别名**：已删除，只保留 `/api/generate/*`。
- ❌ **`public/app.js` 里的平台逻辑**：已迁到 `web/src/app.ts` 的 `PLATFORM_SPECS`。

---

## 4. 监控告警 + 管理后台（当时的做法）

**做法**：请求级指标由 Fastify `onResponse` 采集，系统级每 10 秒、磁盘每 60 秒采样，
按天写 JSONL；告警引擎做阈值 + 持续时长 + 10% 回滞 + 静默期；通知走 Webhook（飞书格式）。

**后来调整的部分**：

- 🔁 后台仪表盘从 `setInterval(loadDashboard, 15000)` 轮询改为 SSE 长连接
  （详见 [架构设计 · SSE](architecture.md#45-sse)）。
- 🔁 `/api/assets/*` 从监控中排除 —— 结果页一次加载几十张图，会把真实调用淹掉。
- 🔁 管理后台的 CSP 要求：内联 `onclick` 全部改为 `data-action` 事件委托。

现状见 [架构设计 · 监控与告警](architecture.md#59-监控与告警) 与 [配置参考](configuration-reference.md)。

---

## 5. 前端切片迁移（P5）

**问题**：`public/app.js`（约 3300 行）+ `public/admin.js`（约 775 行）两个单体，
没有类型、没有模块边界。

**做法**：按**功能垂直切片**迁到 `web/src/`，每个切片作为独立 IIFE 构建到 `public/js/`：

`auth` / `preview` / `generator-api` / `ui` / `app` / `admin`

另有 `public/js/theme.js`：用于首屏主题与静态页主题切换，**手写并提交到仓库**，
不是 Vite 构建产物。

**关键约束（决定了现在的写法）**：

- 独立 IIFE 之间**没有共享模块作用域**，所以用 `window._xxx` 桥接 + `configure()` 注入依赖，
  而不是 ES import。这是刻意的取舍，不是遗留问题。
- 管理后台单独切片，复用同一套 `localStorage` key 而不是 import 主站模块。

**为什么不做成一个 bundle**：各页面只需要自己那份（登录页不需要加载生图预览逻辑），
且拆开后单个文件的缓存失效面更小。

---

## 6. 生图方案收敛

**曾经的方案**：多个 provider 并存 —— 本地 ComfyUI 适配、`doubao`、`hf`、`http`、
`managedHttp`（自动启停的 HTTP 服务）、`picsum`（随机图）。

**结论**：全部删除，**统一为 OpenAI 兼容 Images API**，通过 `variant` 切换参数画像：

- `gpt-image`：OpenAI `gpt-image-1.x`，原生透明底，参考图/改图/文字生图全覆盖；
- `generic`：任意 OpenAI 兼容端点（豆包 Seedream、硅基流动 FLUX 等），把参考图放在 `image` 字段。

**连带后果**：`spec/ai-http-contract.md` 描述的 `type: "http"` 契约随之作废（已删除该文档）；
`ai.referenceMode` 现在只有 `base64` / `url` / `multipart` 真正被消费。

**取舍**：本地生成（ComfyUI）响应慢、显存要求高、部署成本远超收益，砍掉后自托管门槛显著降低。

**收尾**：遗留的参考工作流文件 `comfy/workflow_api.json` 已于 0.2.0 从仓库删除
（provider 早已移除，保留它只会让人误以为还能用）。
