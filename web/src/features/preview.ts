/**
 * Preview + export-confirm vertical slice (P5).
 *
 * Migrated from public/app.js. Owns rendering of the sticker/extra-asset
 * preview grid, the download slot, the export-info + metadata.json confirm
 * cards, and the shared escaping/clipboard helpers those features use.
 *
 * Cross-feature dependencies (notice, platform spec, reward state, auth api)
 * are injected through `configure` so this module never reaches into app.js
 * globals.
 */

declare global {
  interface Window {
    _preview?: {
      configure: (deps: PreviewDeps) => void;
      escapeHtml: (text: string) => string;
      escapeAttr: (value: string) => string;
      buildAssetUrl: (assetId: string) => string;
      setFeedback: (text: string, tone?: Tone) => void;
      renderPreview: (stickers: StickerPreview[], tone?: Tone) => void;
      renderExtraAssets: (extras: Record<string, any>, tone?: Tone) => void;
      renderDownload: (
        packId: string | undefined,
        downloadUrl: string | undefined,
        filename: string | undefined
      ) => void;
      renderExportInfo: (result: PackResult | null) => void;
      renderMetadataPreview: (result: PackResult | null, tone?: Tone) => void;
      setExportInfo: (title: string, description: string) => void;
      handleConfirmCardClick: (key: ConfirmCardKey, event: Event) => Promise<void>;
    };
  }
}

type Tone = "idle" | "loading" | "error" | "success";
type ConfirmCardKey = "exportInfo" | "metadata";

type PlatformSpec = {
  platformLabel: string;
  fileFormat: string;
  outputFormat: string;
  exportHint: string;
  showsExtraAssets: boolean;
  showsReward: boolean;
  showsAuthor: boolean;
  showsVersion: boolean;
  showsCopyright: boolean;
};

export type PreviewDeps = {
  setNotice: (text: string, tone?: string) => void;
  getSpec: () => PlatformSpec;
  getPlatformId: () => string;
  getDefaultStickerCount: () => number;
  getPreviewSpec: () => string;
  getRewardEnabled: () => boolean;
  getRewardMessage: () => string;
  getAuthApi: () => (url: string, opts?: RequestInit) => Promise<Response>;
};

export type StickerPreview = {
  label?: string;
  url?: string;
  assetId?: string;
  prompt?: string;
};

export type PackResult = {
  packId?: string;
  downloadUrl?: string;
  downloadFilename?: string;
  stickers?: StickerPreview[];
  metadataJson?: string;
  meta?: Record<string, any>;
  extras?: Record<string, any>;
};

type ExtraAssetDef = {
  key: string;
  title: string;
  spec: string;
  description: string;
  alt: string;
  wide?: boolean;
  /** 赞赏图：宽高比为 750×560，与横幅(750×400)区分 */
  reward?: boolean;
};

type ConfirmCardConfig = {
  element: HTMLElement | null;
  title: string;
  description: string;
  toggleAction: string;
  toggleButtonClass: string;
  copyAction: string;
  copyButtonClass: string;
  copyLabel: string;
  copySuccess: string;
  collapsedPlaceholder: string;
  getExpandedContent: (result: PackResult) => string;
  getCopyText: (result: PackResult) => string;
};

function byId<T extends HTMLElement = HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null;
}

// ── DOM elements owned by this slice ─────────────────────────────────────────
const wechatAiPreview = byId("wechatAiPreview");
const wechatAiCover = byId("wechatAiCover");
const wechatAiIcon = byId("wechatAiIcon");
const wechatAiBanner = byId("wechatAiBanner");
const wechatAiRewardGuide = byId("wechatAiRewardGuide");
const wechatAiRewardThanks = byId("wechatAiRewardThanks");
const sectionAssetsGroup = byId("sectionAssetsGroup");
const sectionRewardGroup = byId("sectionRewardGroup");
const wechatAiFeedback = byId("wechatAiFeedback");
const wechatAiExportInfo = byId("wechatAiExportInfo");
const wechatAiMetadataPreview = byId("wechatAiMetadataPreview");
const wechatAiZipLink = byId("wechatAiZipLink");

// ── Internal state (confirm-card results + collapse) ────────────────────────
let exportInfoResult: PackResult | null = null;
let metadataPreviewResult: PackResult | null = null;
let isExportInfoCollapsed = true;
let isMetadataPreviewCollapsed = true;

// ── Preview-specific constants ──────────────────────────────────────────────
const BASE_EXTRA_ASSET_DEFS: ExtraAssetDef[] = [
  { key: "coverAssetId", title: "表情封面图 (Cover)", spec: "240 × 240", description: "用于表情包封面展示。", alt: "生成封面预览" },
  { key: "iconAssetId", title: "聊天面板图标 (Icon)", spec: "50 × 50", description: "用于列表入口与缩略图展示。", alt: "生成图标预览" },
  { key: "bannerAssetId", title: "详情页横幅 (Banner)", spec: "750 × 400", description: "用于详情页横幅展示。", alt: "生成横幅预览", wide: true }
];

const REWARD_EXTRA_ASSET_DEFS: ExtraAssetDef[] = [
  { key: "rewardGuideAssetId", title: "赞赏引导图", spec: "750 × 560", description: "用于展示赞赏引导语。", alt: "赞赏引导图预览", wide: true, reward: true },
  { key: "rewardThanksAssetId", title: "赞赏感谢图", spec: "750 × 560", description: "用于赞赏完成后的感谢反馈。", alt: "赞赏感谢图预览", wide: true, reward: true }
];

const PLACEHOLDER_STATE_TEXT: Record<Tone, string> = {
  idle: "等待生成",
  loading: "生成中，完成后自动展示",
  error: "生成失败，可点击重新生成",
  success: "本次结果未返回该资源"
};

const COPY_ICON_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>';

// ── Injected cross-feature context (set by app.js via configure) ────────────
let ctx: PreviewDeps = {
  setNotice: () => {},
  getSpec: () => ({
    platformLabel: "微信表情包",
    fileFormat: "PNG",
    outputFormat: "png",
    exportHint: "此 ZIP 中包含符合微信表情包规范的资源文件。",
    showsExtraAssets: true,
    showsReward: true,
    showsAuthor: true,
    showsVersion: true,
    showsCopyright: true
  }),
  getPlatformId: () => "wechat_stickers",
  getDefaultStickerCount: () => 8,
  getPreviewSpec: () => "240 × 240",
  getRewardEnabled: () => false,
  getRewardMessage: () => "",
  getAuthApi: () => fetch as (url: string, opts?: RequestInit) => Promise<Response>
};

// ── Shared helpers ──────────────────────────────────────────────────────────
export function escapeHtml(text: string): string {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function escapeAttr(value: string): string {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

export function buildAssetUrl(assetId: string): string {
  return assetId ? `/api/assets/${assetId}` : "";
}

async function copyText(text: string): Promise<void> {
  if (!text) throw new Error("没有可复制的内容");
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const input = document.createElement("textarea");
  input.value = text;
  input.setAttribute("readonly", "");
  input.style.position = "absolute";
  input.style.left = "-9999px";
  document.body.appendChild(input);
  input.select();
  const ok = document.execCommand("copy");
  document.body.removeChild(input);
  if (!ok) throw new Error("复制失败，请手动复制");
}

// ── Feedback card ───────────────────────────────────────────────────────────
export function setFeedback(text: string, tone: Tone = "idle"): void {
  if (!wechatAiFeedback) return;
  wechatAiFeedback.dataset.tone = tone;
  wechatAiFeedback.innerHTML = `
    <div class="section-title">预览状态</div>
    <p class="muted">${escapeHtml(text)}</p>
  `;
}

// ── Sticker / extra-asset preview rendering ─────────────────────────────────
function getExtraAssetDefs(extras: Record<string, any> = {}): ExtraAssetDef[] {
  const spec = ctx.getSpec();
  if (!spec.showsExtraAssets) return [];
  const rewardAssetPresent = Boolean(extras?.rewardGuideAssetId || extras?.rewardThanksAssetId);
  return ctx.getRewardEnabled() || rewardAssetPresent
    ? [...BASE_EXTRA_ASSET_DEFS, ...REWARD_EXTRA_ASSET_DEFS]
    : BASE_EXTRA_ASSET_DEFS;
}

function getExtraAssetDescription(item: ExtraAssetDef, assetId: string | undefined, tone: Tone, prompt: string | undefined): string {
  const descriptions = [item.description];
  const isRewardAsset = item.key === "rewardGuideAssetId" || item.key === "rewardThanksAssetId";

  if (isRewardAsset && ctx.getRewardMessage()) {
    descriptions.push(`当前文案：${ctx.getRewardMessage()}`);
  } else if (tone === "success" && !assetId) {
    descriptions.push("本次结果未返回该资源。");
  } else if (tone === "loading") {
    descriptions.push("生成完成后自动更新。");
  } else if (tone === "error") {
    descriptions.push("生成失败后可重新生成。");
  } else if (tone === "idle") {
    descriptions.push("等待生成后展示。");
  }

  if (tone === "success" && prompt) {
    descriptions.push(`\n提示词：${prompt}`);
  }

  return descriptions.filter(Boolean).join(" ");
}

function getPreviewCardContent(sticker: StickerPreview | null, tone: Tone): { title: string; description: string } {
  const descriptionPrefix = "用于展示聊天场景贴纸与序号资源。";

  if (tone === "loading") {
    return { title: "表情预览", description: `${descriptionPrefix} 生成完成后自动更新。` };
  }
  if (tone === "error") {
    return { title: "表情预览", description: `${descriptionPrefix} 生成失败后可重新生成。` };
  }
  if (tone !== "success") {
    return { title: "表情预览", description: `${descriptionPrefix} 等待生成后展示。` };
  }

  const label = sticker?.label || "---";
  const promptText = sticker?.prompt ? `\n提示词：${sticker.prompt}` : "";
  return { title: `表情 ${label}`, description: `${descriptionPrefix} 当前序号：${label}${promptText}` };
}

function createPreviewCard(sticker: StickerPreview | null, tone: Tone, index?: number): HTMLElement {
  const card = document.createElement("article");
  card.className = "preview-item";
  // 标记该卡片对应的资源目标，供失败时做单资源重生成。
  if (typeof index === "number") {
    card.dataset.target = JSON.stringify({ kind: "sticker", index });
  }

  const isRealSticker = Boolean(sticker?.url);
  const cardTone: Tone = isRealSticker ? "success" : tone;
  card.dataset.tone = cardTone;

  if (cardTone !== "success") {
    card.classList.add("preview-item-empty");
  }

  const content = getPreviewCardContent(sticker, cardTone);
  const hasImage = isRealSticker;

  const head = document.createElement("div");
  head.className = "preview-head";

  const title = document.createElement("div");
  title.className = "preview-title";
  title.textContent = content.title;

  const spec = document.createElement("div");
  // 仅在贴纸卡上使用 preview-spec-sticker，便于 app.js 在切换平台时
  // 只刷新贴纸尺寸，而不误改封面/图标/横幅/赞赏卡的尺寸标签。
  spec.className = "preview-spec preview-spec-sticker";
  spec.textContent = ctx.getPreviewSpec();

  const description = document.createElement("p");
  description.className = "preview-description";
  description.textContent = content.description;
  description.style.whiteSpace = "pre-wrap";

  head.appendChild(title);
  head.appendChild(spec);
  head.appendChild(description);

  const media = document.createElement(hasImage ? "img" : "div");
  media.className = "preview-media";

  if (hasImage) {
    (media as HTMLImageElement).src = sticker?.url ?? "";
    (media as HTMLImageElement).alt = `聊天场景贴纸 ${sticker?.label ?? ""} 预览`;
    (media as HTMLImageElement).loading = "lazy";
    (media as HTMLImageElement).decoding = "async";
    (media as HTMLImageElement).onerror = () => {
      media.outerHTML = `<div class="preview-media asset-placeholder">${PLACEHOLDER_STATE_TEXT.error}</div>`;
      card.dataset.tone = "error";
      card.classList.add("preview-item-empty");
      const desc = card.querySelector(".preview-description");
      if (desc) desc.textContent = "生成失败后可重新生成。";
    };
  } else {
    media.classList.add("asset-placeholder");
    media.textContent = PLACEHOLDER_STATE_TEXT[tone] ?? PLACEHOLDER_STATE_TEXT.idle;
  }

  card.appendChild(head);
  card.appendChild(media);
  return card;
}

export function renderPreview(stickers: StickerPreview[], tone: Tone = "success"): void {
  const sectionPrimary = document.getElementById("sectionPrimary");
  if (!wechatAiPreview) return;

  if (!stickers.length) {
    if (tone === "idle") {
      if (sectionPrimary) sectionPrimary.hidden = true;
      wechatAiPreview.innerHTML = "";
      return;
    }
    if (sectionPrimary) sectionPrimary.hidden = false;
    const desiredTone: Tone = tone === "success" ? "idle" : tone;
    wechatAiPreview.innerHTML = "";
    wechatAiPreview.appendChild(createPreviewCard(null, desiredTone));
    return;
  }

  if (sectionPrimary) sectionPrimary.hidden = false;

  const existingCount = wechatAiPreview.children.length;
  const needClearPlaceholder = existingCount === 1 && (wechatAiPreview.firstChild as HTMLElement | null)?.dataset?.tone !== "success";
  if (needClearPlaceholder) {
    wechatAiPreview.innerHTML = "";
    const frag = document.createDocumentFragment();
    for (let i = 0; i < stickers.length; i++) {
      frag.appendChild(createPreviewCard(stickers[i], tone, i));
    }
    wechatAiPreview.appendChild(frag);
    return;
  }

  const frag = document.createDocumentFragment();
  for (let i = existingCount; i < stickers.length; i++) {
    frag.appendChild(createPreviewCard(stickers[i], tone, i));
  }
  wechatAiPreview.appendChild(frag);
}

export function renderExtraAssets(extras: Record<string, any> = {}, tone: Tone = "idle"): void {
  if (wechatAiCover) wechatAiCover.innerHTML = "";
  if (wechatAiIcon) wechatAiIcon.innerHTML = "";
  if (wechatAiBanner) wechatAiBanner.innerHTML = "";
  if (wechatAiRewardGuide) wechatAiRewardGuide.innerHTML = "";
  if (wechatAiRewardThanks) wechatAiRewardThanks.innerHTML = "";

  const defs = getExtraAssetDefs(extras);

  if (sectionAssetsGroup) sectionAssetsGroup.hidden = true;
  if (sectionRewardGroup) sectionRewardGroup.hidden = true;

  if (!defs.length) return;

  for (const item of defs) {
    const assetId = extras?.[item.key] as string | undefined;
    // 整包成功但该资源缺失（单张失败）时，也渲染为可点击重试的错误卡片。
    const effectiveTone: Tone = tone === "success" && !assetId ? "error" : tone;
    const card = document.createElement("article");
    card.className = `preview-item${item.wide ? " preview-item-wide" : ""}`;
    card.dataset.tone = effectiveTone;
    // 标记扩展资源目标，供失败时做单资源重生成。
    card.dataset.target = JSON.stringify({ kind: "extra", key: item.key });

    const head = document.createElement("div");
    head.className = "preview-head";

    const title = document.createElement("div");
    title.className = "preview-title";
    title.textContent = item.title;

    const spec = document.createElement("div");
    spec.className = "preview-spec";
    spec.textContent = item.spec;

    const description = document.createElement("p");
    description.className = "preview-description";
    description.textContent = getExtraAssetDescription(item, assetId, effectiveTone, extras?.[`${item.key}_prompt`] as string | undefined);
    description.style.whiteSpace = "pre-wrap";

    head.appendChild(title);
    head.appendChild(spec);
    head.appendChild(description);

    const media = document.createElement(assetId && effectiveTone === "success" ? "img" : "div");
    media.className = `preview-media${item.reward ? " preview-media-reward" : item.wide ? " preview-media-wide" : ""}`;

    if (assetId && effectiveTone === "success") {
      (media as HTMLImageElement).src = buildAssetUrl(assetId);
      (media as HTMLImageElement).alt = item.alt;
      (media as HTMLImageElement).loading = "lazy";
      (media as HTMLImageElement).decoding = "async";
      (media as HTMLImageElement).onerror = () => {
        media.outerHTML = `<div class="preview-media${item.reward ? " preview-media-reward" : item.wide ? " preview-media-wide" : ""} asset-placeholder">${PLACEHOLDER_STATE_TEXT.error}</div>`;
        card.dataset.tone = "error";
        const desc = card.querySelector(".preview-description");
        if (desc) desc.textContent = "生成失败后可重新生成。";
      };
    } else {
      media.classList.add("asset-placeholder");
      media.textContent = PLACEHOLDER_STATE_TEXT[effectiveTone] ?? PLACEHOLDER_STATE_TEXT.idle;
    }

    card.appendChild(head);
    card.appendChild(media);

    // 有资源，或本次生成失败（显示失败卡片供点击重试），都要让分组可见。
    const revealSection = Boolean(assetId) || effectiveTone === "error";
    if (item.key === "coverAssetId") {
      wechatAiCover?.appendChild(card);
      if (revealSection && sectionAssetsGroup) sectionAssetsGroup.hidden = false;
    } else if (item.key === "iconAssetId") {
      wechatAiIcon?.appendChild(card);
      if (revealSection && sectionAssetsGroup) sectionAssetsGroup.hidden = false;
    } else if (item.key === "bannerAssetId") {
      wechatAiBanner?.appendChild(card);
      if (revealSection && sectionAssetsGroup) sectionAssetsGroup.hidden = false;
    } else if (item.key === "rewardGuideAssetId") {
      wechatAiRewardGuide?.appendChild(card);
      if (revealSection && sectionRewardGroup) sectionRewardGroup.hidden = false;
    } else if (item.key === "rewardThanksAssetId") {
      wechatAiRewardThanks?.appendChild(card);
      if (revealSection && sectionRewardGroup) sectionRewardGroup.hidden = false;
    }
  }
}

// ── Download slot ───────────────────────────────────────────────────────────
export function renderDownload(
  packId: string | undefined,
  downloadUrl: string | undefined,
  filename: string | undefined
): void {
  if (!downloadUrl || !wechatAiZipLink) return;
  const resolvedFilename = filename || `${packId || "pack"}.zip`;
  const spec = ctx.getSpec();

  wechatAiZipLink.innerHTML = "";

  const link = document.createElement("a");
  link.href = downloadUrl;
  link.className = "download-button";
  link.rel = "noopener";
  link.download = resolvedFilename;
  link.innerHTML = `
    <span class="download-button-title">确认无误，下载ZIP包</span>
    <span class="download-button-subtitle">${resolvedFilename}</span>
  `;
  link.addEventListener("click", async (event) => {
    event.preventDefault();
    try {
      ctx.setNotice("正在准备下载文件…", "info");
      const api = ctx.getAuthApi();
      const response = await api(link.href);
      if (!response.ok) {
        throw new Error("下载失败，请稍后重试。");
      }
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const tempLink = document.createElement("a");
      tempLink.href = objectUrl;
      tempLink.download = resolvedFilename;
      tempLink.style.display = "none";
      document.body.appendChild(tempLink);
      tempLink.click();
      document.body.removeChild(tempLink);
      setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
      ctx.setNotice("下载已开始，请留意浏览器下载列表。", "success");
    } catch (error) {
      ctx.setNotice(error instanceof Error ? error.message : "下载失败，请稍后重试。", "error");
    }
  });

  wechatAiZipLink.appendChild(link);

  const hint = document.createElement("p");
  hint.className = "muted";
  hint.style.marginTop = "12px";
  hint.style.textAlign = "center";
  hint.style.fontSize = "var(--font-13)";
  hint.textContent = spec.exportHint;
  wechatAiZipLink.appendChild(hint);
}

// ── Export-info + metadata.json confirm cards ───────────────────────────────
const CONFIRM_CARD_CONFIGS: Record<ConfirmCardKey, ConfirmCardConfig> = {
  exportInfo: {
    element: wechatAiExportInfo,
    title: "结果概览与导出信息",
    description: "确认生成范围、风格与导出信息，确认后可直接复制。",
    toggleAction: "toggle-export-info",
    toggleButtonClass: "ghost-button export-info-toggle-button panel-toggle-button",
    copyAction: "copy-export-info",
    copyButtonClass: "ghost-button export-info-copy-button",
    copyLabel: "复制导出信息",
    copySuccess: "导出信息已复制",
    collapsedPlaceholder: "已默认折叠，展开后查看完整信息。",
    getExpandedContent(result) {
      return buildDetailGridMarkup(getExportInfoData(result).items);
    },
    getCopyText(result) {
      return buildExportInfoCardText(result);
    }
  },
  metadata: {
    element: wechatAiMetadataPreview,
    title: "metadata.json",
    description: "确认 packId、资源映射与扩展资源字段，再继续下载或提审。",
    toggleAction: "toggle-metadata-preview",
    toggleButtonClass: "ghost-button metadata-toggle-button panel-toggle-button",
    copyAction: "copy-metadata-preview",
    copyButtonClass: "ghost-button metadata-copy-button",
    copyLabel: "复制 metadata.json",
    copySuccess: "metadata.json 已复制",
    collapsedPlaceholder: "已默认折叠，展开后查看 ZIP 中完整的 metadata.json 内容。",
    getExpandedContent(result) {
      return `<pre class="code-preview"><code>${escapeHtml(buildMetadataPreviewText(result))}</code></pre>`;
    },
    getCopyText(result) {
      return buildMetadataPreviewText(result);
    }
  }
};

const CONFIRM_CARD_STATE: Record<
  ConfirmCardKey,
  {
    getResult: () => PackResult | null;
    setResult: (result: PackResult | null) => void;
    getCollapsed: () => boolean;
    setCollapsed: (value: boolean) => void;
  }
> = {
  exportInfo: {
    getResult: () => exportInfoResult,
    setResult: (result) => {
      exportInfoResult = result;
    },
    getCollapsed: () => isExportInfoCollapsed,
    setCollapsed: (value) => {
      isExportInfoCollapsed = value;
    }
  },
  metadata: {
    getResult: () => metadataPreviewResult,
    setResult: (result) => {
      metadataPreviewResult = result;
    },
    getCollapsed: () => isMetadataPreviewCollapsed,
    setCollapsed: (value) => {
      isMetadataPreviewCollapsed = value;
    }
  }
};

function buildConfirmCardMarkup({
  title,
  description,
  actions = "",
  content = ""
}: {
  title: string;
  description: string;
  actions?: string;
  content?: string;
}): string {
  return `
    <div class="summary-card-head">
      <div class="summary-card-copy">
        <div class="section-title">${title}</div>
        <p class="muted">${description}</p>
      </div>
      ${actions}
    </div>
    ${content}
  `;
}

function buildConfirmCardActions(key: ConfirmCardKey, config: ConfirmCardConfig, collapsed: boolean): string {
  const actions: string[] = [];

  if (config.copyAction) {
    actions.push(`
      <button
        type="button"
        class="${config.copyButtonClass}"
        data-action="${config.copyAction}"
        title="${config.copyLabel}"
        aria-label="${config.copyLabel}"
      >${COPY_ICON_SVG}</button>
    `);
  }

  if (config.toggleAction) {
    actions.push(`
      <button
        type="button"
        class="${config.toggleButtonClass}"
        data-action="${config.toggleAction}"
        aria-expanded="${collapsed ? "false" : "true"}"
      >${collapsed ? "展开内容" : "收起内容"}</button>
    `);
  }

  return actions.join("");
}

function renderConfirmCardPlaceholder(key: ConfirmCardKey, message: string, opts: { title?: string } = {}): void {
  const config = CONFIRM_CARD_CONFIGS[key];
  const state = CONFIRM_CARD_STATE[key];
  state.setResult(null);
  state.setCollapsed(true);
  if (!config.element) return;
  config.element.innerHTML = buildConfirmCardMarkup({
    title: opts.title ?? config.title,
    description: config.description,
    content: `<p class="muted summary-card-placeholder">${escapeHtml(message)}</p>`
  });
}

function renderConfirmCard(key: ConfirmCardKey, result: PackResult | null, opts: { resetCollapsed?: boolean } = {}): void {
  const config = CONFIRM_CARD_CONFIGS[key];
  const state = CONFIRM_CARD_STATE[key];
  const element = config?.element;
  if (!element) return;

  if (!result) {
    renderConfirmCardPlaceholder(key, "");
    return;
  }

  state.setResult(result);
  if (opts.resetCollapsed !== false) {
    state.setCollapsed(true);
  }

  const collapsed = state.getCollapsed();
  element.dataset.copyContent = config.getCopyText ? config.getCopyText(result) : "";

  try {
    element.innerHTML = buildConfirmCardMarkup({
      title: config.title,
      description: config.description,
      actions: buildConfirmCardActions(key, config, collapsed),
      content: collapsed
        ? `<p class="muted summary-card-placeholder">${config.collapsedPlaceholder}</p>`
        : config.getExpandedContent(result)
    });
  } catch (err) {
    console.error(`Failed to render confirm card ${key}:`, err);
  }
}

function toggleConfirmCard(key: ConfirmCardKey): void {
  const state = CONFIRM_CARD_STATE[key];
  const result = state.getResult();
  if (!result) return;
  state.setCollapsed(!state.getCollapsed());
  renderConfirmCard(key, result, { resetCollapsed: false });
}

async function copyConfirmCardContent(key: ConfirmCardKey): Promise<void> {
  const config = CONFIRM_CARD_CONFIGS[key];
  const result = CONFIRM_CARD_STATE[key].getResult();
  if (!config.getCopyText || !result) return;
  await copyText(config.getCopyText(result));
  ctx.setNotice(config.copySuccess, "success");
}

export async function handleConfirmCardClick(key: ConfirmCardKey, event: Event): Promise<void> {
  const config = CONFIRM_CARD_CONFIGS[key];
  const state = CONFIRM_CARD_STATE[key];
  const target = event?.target as HTMLElement | null;
  const toggleButton = target?.closest?.(`[data-action="${config.toggleAction}"]`);
  if (toggleButton && state.getResult()) {
    toggleConfirmCard(key);
    return;
  }

  if (!config.copyAction) return;

  const copyButton = target?.closest?.(`[data-action="${config.copyAction}"]`);
  if (!copyButton || !state.getResult()) return;

  try {
    const element = config.element;
    if (element) {
      await copyText(element.dataset.copyContent || "");
      ctx.setNotice(config.copySuccess, "success");
    } else {
      await copyConfirmCardContent(key);
    }
  } catch (error) {
    ctx.setNotice(error instanceof Error ? error.message : "复制失败，请稍后重试。", "error");
  }
}

function buildDetailGridMarkup(items: Array<{ label: string; value: string }>): string {
  return `
    <div class="detail-grid">
      ${items
        .map(
          (item) => `
            <div class="detail-item">
              <span class="muted">${escapeHtml(item.label)}</span>
              <strong>${escapeHtml(item.value)}</strong>
            </div>
          `
        )
        .join("")}
    </div>
  `;
}

export function renderExportInfo(result: PackResult | null): void {
  if (!result) {
    setExportInfo("结果概览与导出信息", "生成后在这里查看标题、数量、风格、参考图方式与导出文件。");
    return;
  }
  renderConfirmCard("exportInfo", result, { resetCollapsed: true });
}

function getExportInfoData(result: PackResult): { items: Array<{ label: string; value: string }> } {
  const title = result?.meta?.title ?? "未填写";
  const author = result?.meta?.author ?? "未填写";
  const version = result?.meta?.version ?? "未填写";
  const copyright = result?.meta?.copyright ?? "未填写";
  const packId = result?.packId ?? "未生成";
  const filename = result?.downloadFilename ?? `${packId}.zip`;
  const rewardEnabled = result?.meta?.rewardEnabled ? "已开启" : "未开启";
  const rewardMessage = result?.meta?.rewardMessage ?? "未填写";
  const count = result?.stickers?.length ?? result?.meta?.count ?? ctx.getDefaultStickerCount();
  const styles = Array.isArray(result?.meta?.styles) && result.meta.styles.length ? result.meta.styles.join("、") : "默认";
  const referenceMode = result?.meta?.referenceMode ?? "base64";
  const spec = ctx.getSpec();

  return {
    items: [
      { label: "平台", value: spec.platformLabel },
      { label: "标题", value: title },
      ...(spec.showsAuthor ? [{ label: "作者", value: author }] : []),
      ...(spec.showsVersion ? [{ label: "版本", value: version }] : []),
      ...(spec.showsCopyright ? [{ label: "版权", value: copyright }] : []),
      { label: "贴纸数量", value: `${count} 张` },
      ...(spec.showsReward ? [{ label: "赞赏功能", value: rewardEnabled }] : []),
      ...(result?.meta?.rewardEnabled ? [{ label: "赞赏引导语", value: rewardMessage }] : []),
      { label: "风格", value: styles },
      { label: "参考图方式", value: referenceMode },
      { label: "文件格式", value: spec.fileFormat },
      { label: "packId", value: packId },
      { label: "导出文件", value: filename }
    ]
  };
}

function buildExportInfoCardText(result: PackResult): string {
  if (!result) return "";
  return getExportInfoData(result).items.map((item) => `${item.label}：${item.value}`).join("\n");
}

function buildMetadataPreviewText(result: PackResult): string {
  if (!result) return "";
  if (typeof result.metadataJson === "string" && result.metadataJson.trim()) {
    return result.metadataJson;
  }

  const spec = ctx.getSpec();
  const metadata = {
    schema: "easysticker-pack@0.1",
    packId: result?.packId ?? null,
    presetId: ctx.getPlatformId(),
    createdAt: null,
    metadata: {
      ...(result?.meta?.title ? { title: result.meta.title } : {}),
      ...(result?.meta?.author ? { author: result.meta.author } : {}),
      ...(spec.showsVersion && result?.meta?.version ? { version: result.meta.version } : {}),
      ...(spec.showsCopyright && result?.meta?.copyright ? { copyright: result.meta.copyright } : {}),
      ...(spec.showsReward && result?.meta?.rewardMessage ? { rewardMessage: result.meta.rewardMessage } : {})
    },
    extras: spec.showsExtraAssets
      ? {
          coverAssetId: result?.extras?.coverAssetId ?? null,
          bannerAssetId: result?.extras?.bannerAssetId ?? null,
          iconAssetId: result?.extras?.iconAssetId ?? null,
          rewardGuideAssetId: result?.extras?.rewardGuideAssetId ?? null,
          rewardThanksAssetId: result?.extras?.rewardThanksAssetId ?? null
        }
      : {},
    assets: Array.isArray(result?.stickers)
      ? result.stickers.map((item) => ({
          assetId: item.assetId ?? null,
          filename: `${item.label ?? "sticker"}.${spec.outputFormat}`,
          zipPath: `assets/${item.label ?? "sticker"}.${spec.outputFormat}`
        }))
      : []
  };

  return JSON.stringify(metadata, null, 2);
}

export function renderMetadataPreview(result: PackResult | null, tone: Tone = "success"): void {
  if (tone === "loading") {
    setMetadataPreview("正在准备 metadata.json 内容...");
    return;
  }
  if (tone === "error") {
    setMetadataPreview("生成失败，暂时无法展示 metadata.json 内容。");
    return;
  }
  if (!result || tone === "idle") {
    setMetadataPreview("生成后在这里查看 ZIP 中的 metadata.json 内容。");
    return;
  }
  renderConfirmCard("metadata", result, { resetCollapsed: true });
}

export function setExportInfo(title: string, description: string): void {
  renderConfirmCardPlaceholder("exportInfo", description, { title });
}

function setMetadataPreview(message: string): void {
  renderConfirmCardPlaceholder("metadata", message);
}

// ── Mount: configure + bind confirm-card listeners + expose bridge ─────────
export function mountPreview(): void {
  wechatAiExportInfo?.addEventListener("click", (event) => void handleConfirmCardClick("exportInfo", event));
  wechatAiMetadataPreview?.addEventListener("click", (event) => void handleConfirmCardClick("metadata", event));

  window._preview = {
    configure: (next) => {
      ctx = next;
    },
    escapeHtml,
    escapeAttr,
    buildAssetUrl,
    setFeedback,
    renderPreview,
    renderExtraAssets,
    renderDownload,
    renderExportInfo,
    renderMetadataPreview,
    setExportInfo,
    handleConfirmCardClick
  };
}
