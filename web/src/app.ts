/**
 * Legacy controller (P5) — faithful TS port of the remaining public/app.js.
 * Split from the monolith after auth / preview / generator-api / ui slices.
 */

const STORAGE_LAST_PACK = "easysticker:last-wechat-pack";
const STORAGE_PACK_HISTORY = "easysticker:pack-history";
const MAX_HISTORY = 10;

function byId<T extends HTMLElement = HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null;
}
function req<T extends HTMLElement = HTMLElement>(id: string): T {
  const el = document.getElementById(id) as T | null;
  if (!el) throw new Error(`Missing required element #${id}`);
  return el;
}

type PlatformSpec = Record<string, any>;

const PLATFORM_SPECS: Record<string, PlatformSpec> = {
  wechat_stickers: {
    minCount: 8, maxCount: 24, defaultCount: 8,
    showsStyle: true, showsPrompt: true,
    showsReward: true, showsExtraAssets: true, showsMetadata: true,
    showsTitle: true, showsAuthor: true, showsVersion: true, showsCopyright: true,
    previewLabel: "240 × 240", fileFormat: "PNG",
    outputFormat: "png",
    exportHint: "此 ZIP 中包含符合微信表情包规范的资源文件。",
    platformLabel: "微信表情包",
    countHint: "推荐 8-24 张，系统会额外补齐封面、图标和横幅资源。",
    importDesc: "已有成品图片时，可直接批量导入并自动规范为微信 240 × 240 表情图。",
    importHint: "导入后会统一居中、等比缩放、补透明边，并转换为符合微信表情包规格的 PNG。",
    importHeading: "导入已有表情图",
    importUploadText: "支持 PNG、JPG、WebP、GIF，建议一次导入 8-24 张。",
    importAccept: "image/png,image/jpeg,image/webp,image/gif",
    generateDesc: "基于上传图和提示词自动生成并打包。"
  },
  telegram_static: {
    minCount: 1, maxCount: 50, defaultCount: 8,
    showsStyle: true, showsPrompt: true,
    showsReward: false, showsExtraAssets: false, showsMetadata: false,
    showsTitle: true, showsAuthor: true, showsVersion: false, showsCopyright: false,
    previewLabel: "≤ 512 × 512", fileFormat: "PNG",
    outputFormat: "png",
    exportHint: "此 ZIP 中包含 PNG 贴纸文件，可直接用于 Telegram。",
    platformLabel: "Telegram 贴纸",
    countHint: "推荐 1-50 张。",
    importDesc: "已有成品图片时，可直接批量导入并自动规范为 Telegram 贴纸规格。",
    importHint: "导入后会统一居中、等比缩放、补透明边，并转换为符合 Telegram 贴纸规格的 PNG。",
    importHeading: "导入贴纸图",
    importUploadText: "支持 PNG，建议一次导入 1-50 张。",
    importAccept: "image/png",
    generateDesc: "基于上传图和提示词自动生成并打包。"
  },
  whatsapp_webp: {
    minCount: 1, maxCount: 30, defaultCount: 8,
    showsStyle: true, showsPrompt: true,
    showsReward: false, showsExtraAssets: false, showsMetadata: false,
    showsTitle: true, showsAuthor: true, showsVersion: false, showsCopyright: false,
    previewLabel: "512 × 512", fileFormat: "WebP",
    outputFormat: "webp",
    exportHint: "此 ZIP 中包含 .webp 贴纸文件，可直接用于 WhatsApp。",
    platformLabel: "WhatsApp 贴纸",
    countHint: "推荐 1-30 张。",
    importDesc: "已有成品图片时，可直接批量导入并自动规范为 WhatsApp 贴纸规格。",
    importHint: "导入后会统一居中、等比缩放、补透明边，并转换为符合 WhatsApp 贴纸规格的 WebP。",
    importHeading: "导入贴纸图",
    importUploadText: "支持 WebP，建议一次导入 1-30 张。",
    importAccept: "image/webp",
    generateDesc: "基于上传图和提示词自动生成并打包。"
  }
};

// ── DOM elements ────────────────────────────────────────────────────────────
const uploadForm = req<HTMLFormElement>("uploadForm");
const fileInput = req<HTMLInputElement>("file");
const uploadState = req("uploadState");
const importForm = byId<HTMLFormElement>("importForm");
const importFiles = byId<HTMLInputElement>("importFiles");
const importCover = byId<HTMLInputElement>("importCover");
const importIcon = byId<HTMLInputElement>("importIcon");
const importBanner = byId<HTMLInputElement>("importBanner");
const importRewardGuide = byId<HTMLInputElement>("importRewardGuide");
const importRewardThanks = byId<HTMLInputElement>("importRewardThanks");
const importZip = byId<HTMLInputElement>("importZip");
const importState = req("importState");
const originalPreview = req<HTMLImageElement>("originalPreview");
const creationModeAi = byId<HTMLInputElement>("creationModeAi");
const creationModeImport = byId<HTMLInputElement>("creationModeImport");
const aiSourceSection = byId("aiSourceSection");
const importSourceSection = byId("importSourceSection");
const aiConfigFields = byId("aiConfigFields");
const wechatAiForm = req<HTMLFormElement>("wechatAiForm");
const generateSubmit = req<HTMLButtonElement>("generateSubmit");
const regenerateSubmit = req<HTMLButtonElement>("regenerateSubmit");
const resetSubmit = req<HTMLButtonElement>("resetSubmit");
const cancelGenerate = byId<HTMLButtonElement>("cancelGenerate");
const generateState = req("generateState");
const wechatAiZipLink = req("wechatAiZipLink");
const wechatAiPreview = req("wechatAiPreview");
const sectionAssetsGroup = req("sectionAssetsGroup");
const sectionRewardGroup = req("sectionRewardGroup");
const wechatAiPrompt = req<HTMLTextAreaElement>("wechatAiPrompt");
const wechatAiTitle = req<HTMLInputElement>("wechatAiTitle");
const wechatAiAuthor = req<HTMLInputElement>("wechatAiAuthor");
const wechatAiVersion = req<HTMLInputElement>("wechatAiVersion");
const wechatAiCopyright = req<HTMLInputElement>("wechatAiCopyright");
const wechatAiCount = req<HTMLInputElement>("wechatAiCount");
const wechatAiRewardEnabled = req<HTMLInputElement>("wechatAiRewardEnabled");
const wechatAiRewardMessageField = req("wechatAiRewardMessageField");
const wechatAiRewardMessage = req<HTMLInputElement>("wechatAiRewardMessage");
const wechatAiStyleOptions = req("wechatAiStyleOptions");
const wechatAiCountDec = byId<HTMLButtonElement>("wechatAiCountDec");
const wechatAiCountInc = byId<HTMLButtonElement>("wechatAiCountInc");
const wechatAiProvider = byId<HTMLSelectElement>("wechatAiProvider");
const promptHint = req("promptHint");
const generateErrorSummary = byId("generateErrorSummary");
const generateErrorList = byId("generateErrorList");
const historySection = byId("historySection");
const historyList = byId("historyList");
const historyBody = byId("historyBody");
const historyCollapseIcon = byId("historyCollapseIcon");
const historySummary = byId("historySummary");
const clearHistoryBtn = byId<HTMLButtonElement>("clearHistory");
const originalPreviewPlaceholder = byId("originalPreviewPlaceholder");
const platformRadios = document.querySelectorAll<HTMLInputElement>('input[name="platform"]');

// ── Mutable state ───────────────────────────────────────────────────────────
let DEFAULT_STYLE_OPTIONS = ["扁平插画", "贴纸", "3D 卡通", "日系 Q 版", "像素风", "国潮风"];
let currentPlatform = "wechat_stickers";
let DEFAULT_STICKER_COUNT: number = PLATFORM_SPECS.wechat_stickers.defaultCount;
let MIN_STICKER_COUNT: number = PLATFORM_SPECS.wechat_stickers.minCount;
let MAX_STICKER_COUNT: number = PLATFORM_SPECS.wechat_stickers.maxCount;
let STICKER_PREVIEW_SPEC: string = PLATFORM_SPECS.wechat_stickers.previewLabel;
let currentUploadId: string | null = null;
let currentStyles: string[] = [];
let availableStyles: string[] = [...DEFAULT_STYLE_OPTIONS];
let currentRewardEnabled = false;
let currentRewardMessage = "";
let currentAiProvider = "mock";
let currentCreationMode = "ai";
let hasGenerationAttempted = false;
let lastPackResult: any = null;
// 当前预览中的贴纸与扩展资源（含 *_prompt），供单资源重生成时更新。
let currentStickers: any[] = [];
let currentExtras: Record<string, any> = {};
let resourceRegenerating = false;
let currentTaskId: string | null = null;
let sseAbortController: AbortController | null = null;
let cancelRequested = false;
let historyExpanded = false;
const flashTimers = new Map<string, ReturnType<typeof setTimeout>>();
const validationErrors = new Map<string, { key: string; label: string; message: string }>();

type FieldA11yConfig = {
  key: string;
  target: HTMLElement;
  label: string;
  errorId: string;
  baseDescribedBy: string[];
  focusTarget?: HTMLElement;
};

const FIELD_A11Y_CONFIGS: Record<string, FieldA11yConfig> = {
  prompt: { key: "prompt", target: wechatAiPrompt, label: "提示词", errorId: "wechatAiPromptError", baseDescribedBy: ["promptHint"] },
  title: { key: "title", target: wechatAiTitle, label: "表情包标题", errorId: "wechatAiTitleError", baseDescribedBy: ["wechatAiTitleHint"] },
  author: { key: "author", target: wechatAiAuthor, label: "作者名", errorId: "wechatAiAuthorError", baseDescribedBy: ["wechatAiAuthorHint"] },
  count: { key: "count", target: wechatAiCount, label: "贴纸数量", errorId: "wechatAiCountError", baseDescribedBy: ["wechatAiCountHint"] },
  styles: { key: "styles", target: wechatAiStyleOptions, label: "风格选择", errorId: "wechatAiStyleError", baseDescribedBy: ["wechatAiStyleHint"], focusTarget: wechatAiStyleOptions },
  rewardMessage: { key: "rewardMessage", target: wechatAiRewardMessage, label: "赞赏引导语", errorId: "wechatAiRewardMessageError", baseDescribedBy: ["wechatAiRewardHint"] }
};

// ── Platform selection ──────────────────────────────────────────────────────
function getSelectedPlatform(): string {
  const checked = document.querySelector<HTMLInputElement>('input[name="platform"]:checked');
  return checked ? checked.value : "wechat_stickers";
}
function setSelectedPlatform(value: string): void {
  platformRadios.forEach((r) => { r.checked = r.value === value; });
}
function setPlatformDisabled(disabled: boolean): void {
  platformRadios.forEach((r) => { r.disabled = disabled; });
}

function expandStepCard(cardEl: HTMLElement | null): void {
  if (!cardEl || !cardEl.classList.contains("collapsed")) return;
  cardEl.classList.remove("collapsed");
}
function expandAllStepCards(): void {
  document.querySelectorAll(".step-card.collapsed").forEach((card) => {
    card.classList.remove("collapsed");
  });
}

// ── Platform UI sync ────────────────────────────────────────────────────────
function syncPlatformUI(): void {
  const spec = PLATFORM_SPECS[currentPlatform];
  MIN_STICKER_COUNT = spec.minCount;
  MAX_STICKER_COUNT = spec.maxCount;
  DEFAULT_STICKER_COUNT = spec.defaultCount;
  STICKER_PREVIEW_SPEC = spec.previewLabel;

  wechatAiCount.min = String(spec.minCount);
  wechatAiCount.max = String(spec.maxCount);
  setCountValue(Number(wechatAiCount.value || DEFAULT_STICKER_COUNT));

  const rewardField = byId("wechatAiRewardField");
  if (rewardField) rewardField.hidden = !spec.showsReward;
  const importExtraSection = byId("importExtraSection");
  if (importExtraSection) importExtraSection.hidden = !spec.showsExtraAssets;
  const metadataSection = byId("wechatAiMetadataSection");
  if (metadataSection) metadataSection.hidden = !spec.showsMetadata;
  const versionField = byId("wechatAiVersionField");
  if (versionField) versionField.hidden = !spec.showsVersion;
  const copyrightField = byId("wechatAiCopyrightField");
  if (copyrightField) copyrightField.hidden = !spec.showsCopyright;
  const titleField = byId("wechatAiTitleField");
  if (titleField) titleField.hidden = !spec.showsTitle;
  const authorField = byId("wechatAiAuthorField");
  if (authorField) authorField.hidden = !spec.showsAuthor;

  const countHint = byId("wechatAiCountHint");
  if (countHint) countHint.textContent = spec.countHint;
  const heroBadge = byId("heroBadge");
  if (heroBadge) heroBadge.textContent = spec.platformLabel + " AI 表情流程";
  const importSectionDesc = byId("importSectionDesc");
  if (importSectionDesc) importSectionDesc.textContent = spec.importDesc;
  const importHint = byId("importHint");
  if (importHint) importHint.textContent = spec.importHint;
  const importHeading = byId("importHeading");
  if (importHeading) importHeading.textContent = spec.importHeading;
  const importUploadText = byId("importUploadText");
  if (importUploadText) importUploadText.textContent = spec.importUploadText;
  const importFilesEl = byId<HTMLInputElement>("importFiles");
  if (importFilesEl) importFilesEl.accept = spec.importAccept;
  const generateSectionDesc = byId("generateSectionDesc");
  if (generateSectionDesc) generateSectionDesc.textContent = spec.generateDesc;

  setPromptHint(currentStyles);
  // 只更新贴纸卡的尺寸标签；封面/图标/横幅/赞赏卡各自维护自己的尺寸。
  document.querySelectorAll(".preview-spec-sticker").forEach((el) => {
    el.textContent = STICKER_PREVIEW_SPEC;
  });

  setPlatformDisabled(Boolean(hasGenerationAttempted && lastPackResult));
  if (getSelectedPlatform() !== currentPlatform) {
    setSelectedPlatform(currentPlatform);
  }

  clearGenerateValidation();

  if (!spec.showsReward && currentRewardEnabled) {
    currentRewardEnabled = false;
    wechatAiRewardEnabled.checked = false;
    syncRewardFields();
  }
}

// ── Validation / a11y ───────────────────────────────────────────────────────
function getFieldConfig(target: HTMLElement | null): FieldA11yConfig | null {
  if (!target?.id) return null;
  return Object.values(FIELD_A11Y_CONFIGS).find((config) => config.target?.id === target.id) ?? null;
}
function syncFieldDescribedBy(config: FieldA11yConfig | null, invalid: boolean): void {
  if (!config?.target?.setAttribute) return;
  const describedBy = [...config.baseDescribedBy, ...(invalid ? [config.errorId] : [])].filter(Boolean).join(" ");
  if (describedBy) config.target.setAttribute("aria-describedby", describedBy);
  else config.target.removeAttribute?.("aria-describedby");
}
function syncGenerateErrorSummary(): void {
  if (!generateErrorSummary || !generateErrorList) return;
  generateErrorList.innerHTML = "";
  if (!validationErrors.size) {
    generateErrorSummary.hidden = true;
    return;
  }
  for (const item of validationErrors.values()) {
    const line = document.createElement("li");
    const jumpButton = document.createElement("button");
    jumpButton.type = "button";
    jumpButton.className = "error-summary-link";
    jumpButton.dataset.fieldKey = item.key;
    jumpButton.textContent = `${item.label}：${item.message}`;
    jumpButton.addEventListener("click", () => jumpToInvalidField(item.key));
    line.appendChild(jumpButton);
    generateErrorList.appendChild(line);
  }
  generateErrorSummary.hidden = false;
}
function jumpToInvalidField(fieldKey: string): void {
  if (!fieldKey) return;
  const config = FIELD_A11Y_CONFIGS[fieldKey];
  const focusTarget = (config?.focusTarget ?? config?.target) as HTMLElement | undefined;
  const flashTarget = (config?.target?.closest?.(".field") ?? config?.target) as HTMLElement | undefined;

  if (typeof focusTarget?.scrollIntoView === "function") {
    const prefersReducedMotion = Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches);
    try {
      focusTarget.scrollIntoView({ behavior: prefersReducedMotion ? "auto" : "smooth", block: "center" });
    } catch {
      focusTarget.scrollIntoView();
    }
  }
  if (typeof focusTarget?.focus === "function") focusTarget.focus();

  if (flashTarget?.dataset) {
    const prev = flashTimers.get(fieldKey);
    if (prev) clearTimeout(prev);
    flashTarget.dataset.flash = "true";
    flashTimers.set(fieldKey, setTimeout(() => { flashTarget.dataset.flash = "false"; }, 1200));
  }
}
function initializeFieldAccessibility(): void {
  for (const config of Object.values(FIELD_A11Y_CONFIGS)) {
    syncFieldDescribedBy(config, false);
    config.target.setAttribute?.("aria-invalid", "false");
  }
}
function setFieldInvalid(target: HTMLElement | null, invalid: boolean, message = "", opts: { syncSummary?: boolean } = {}): void {
  if (!target) return;
  const config = getFieldConfig(target);
  const container = (target.className?.includes?.("style-options") ? target : target.closest?.(".field") || target) as HTMLElement;
  if (container?.dataset) container.dataset.invalid = invalid ? "true" : "false";
  target.setAttribute?.("aria-invalid", invalid ? "true" : "false");

  if (config) {
    const errorNode = document.getElementById(config.errorId);
    if (errorNode) {
      errorNode.hidden = !invalid;
      errorNode.textContent = invalid ? message : "";
    }
    syncFieldDescribedBy(config, invalid);
    if (invalid && message) validationErrors.set(config.key, { key: config.key, label: config.label, message });
    else validationErrors.delete(config.key);
  }
  if (opts.syncSummary !== false) syncGenerateErrorSummary();
}
function clearGenerateValidation(): void {
  validationErrors.clear();
  setFieldInvalid(wechatAiPrompt, false, "", { syncSummary: false });
  setFieldInvalid(wechatAiTitle, false, "", { syncSummary: false });
  setFieldInvalid(wechatAiAuthor, false, "", { syncSummary: false });
  setFieldInvalid(wechatAiCount, false, "", { syncSummary: false });
  setFieldInvalid(wechatAiRewardMessage, false, "", { syncSummary: false });
  setFieldInvalid(wechatAiStyleOptions, false, "", { syncSummary: false });
  syncGenerateErrorSummary();
}
function validateGenerateInputs(): boolean {
  clearGenerateValidation();
  const prompt = wechatAiPrompt.value.trim();
  const title = wechatAiTitle.value.trim();
  const author = wechatAiAuthor.value.trim();
  const rewardMessage = wechatAiRewardMessage.value.trim();
  const stickerCount = Number(wechatAiCount.value || DEFAULT_STICKER_COUNT);
  const errors: Array<{ target: HTMLElement; message: string }> = [];
  const spec = PLATFORM_SPECS[currentPlatform];

  if (!prompt) errors.push({ target: wechatAiPrompt, message: "请先填写提示词。" });
  if (spec.showsTitle && !title) errors.push({ target: wechatAiTitle, message: "请填写表情包标题。" });
  if (spec.showsAuthor && !author) errors.push({ target: wechatAiAuthor, message: "请填写作者名。" });
  if (!Number.isInteger(stickerCount) || stickerCount < MIN_STICKER_COUNT || stickerCount > MAX_STICKER_COUNT) {
    errors.push({ target: wechatAiCount, message: `贴纸数量需在 ${MIN_STICKER_COUNT}-${MAX_STICKER_COUNT} 张之间。` });
  }
  if (spec.showsStyle && !currentStyles.length) errors.push({ target: wechatAiStyleOptions, message: "请至少选择一种风格。" });
  if (currentRewardEnabled && !rewardMessage) errors.push({ target: wechatAiRewardMessage, message: "开启赞赏功能后，请填写赞赏引导语。" });

  if (!errors.length) { syncGenerateErrorSummary(); return true; }
  for (const item of errors) setFieldInvalid(item.target, true, item.message, { syncSummary: false });
  syncGenerateErrorSummary();
  window._ui!.setNotice(errors[0].message, "error");
  window._ui!.setStatus(generateState, errors.length === 1 ? "待处理 1 项输入问题" : `待处理 ${errors.length} 项输入问题`, "error");
  return false;
}

// ── Form/config sync ────────────────────────────────────────────────────────
function setPromptHint(styles: string[] = []): void {
  const count = Number(wechatAiCount.value || DEFAULT_STICKER_COUNT);
  const spec = PLATFORM_SPECS[currentPlatform];
  let extraText = "";
  if (spec.showsExtraAssets) {
    extraText = currentRewardEnabled ? "，并附带赞赏引导图和感谢图" : "，并自动补齐封面、图标和横幅";
  }
  promptHint.textContent = Array.isArray(styles) && styles.length
    ? `已加载推荐风格：${styles.join("、")}。建议在提示词中补充主体、情绪、动作和背景限制。当前生成 ${count} 张表情${extraText}。`
    : `建议在提示词中补充主体、情绪、动作和背景限制。当前生成 ${count} 张表情${extraText}。`;
}
function syncOriginalPreviewSlot(): void {
  const hasSrc = Boolean(originalPreview?.getAttribute("src"));
  if (originalPreviewPlaceholder) originalPreviewPlaceholder.hidden = hasSrc;
  originalPreview.hidden = !hasSrc;
}
function syncRewardFields(): void {
  currentRewardEnabled = Boolean(wechatAiRewardEnabled.checked);
  wechatAiRewardMessageField.hidden = !currentRewardEnabled;
  if (!currentRewardEnabled) {
    wechatAiRewardMessage.value = "";
    currentRewardMessage = "";
    setFieldInvalid(wechatAiRewardMessage, false);
  }
}
function setCountValue(next: number): void {
  const val = Math.max(MIN_STICKER_COUNT, Math.min(MAX_STICKER_COUNT, Number(next || DEFAULT_STICKER_COUNT)));
  wechatAiCount.value = String(val);
  setFieldInvalid(wechatAiCount, false);
  setPromptHint(currentStyles);
  if (wechatAiCountDec) wechatAiCountDec.disabled = val <= MIN_STICKER_COUNT;
  if (wechatAiCountInc) wechatAiCountInc.disabled = val >= MAX_STICKER_COUNT;
}
function renderStyleOptions(styles: string[] = DEFAULT_STYLE_OPTIONS): void {
  availableStyles = Array.isArray(styles) && styles.length ? [...new Set(styles.filter(Boolean))] : [...DEFAULT_STYLE_OPTIONS];
  currentStyles = currentStyles.filter((item) => availableStyles.includes(item));
  if (!currentStyles.length) currentStyles = [availableStyles[0]];
  else if (currentStyles.length > 1) currentStyles = [currentStyles[0]];

  wechatAiStyleOptions.innerHTML = "";
  for (const style of availableStyles) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "style-chip";
    const isSelected = currentStyles.includes(style);
    button.dataset.selected = isSelected ? "true" : "false";
    button.setAttribute("aria-pressed", isSelected ? "true" : "false");
    button.setAttribute("aria-describedby", "wechatAiStyleChipHelp wechatAiStyleHint");
    button.textContent = style;
    button.addEventListener("click", () => {
      currentStyles = [style];
      setFieldInvalid(wechatAiStyleOptions, false);
      renderStyleOptions(availableStyles);
      setPromptHint(currentStyles);
    });
    wechatAiStyleOptions.appendChild(button);
  }
}

// ── Persistence ─────────────────────────────────────────────────────────────
function getStorage(): Storage | null {
  try { return window.localStorage; } catch { return null; }
}
function clearPersistedPackResult(): void {
  const storage = getStorage();
  if (!storage) return;
  try { storage.removeItem(STORAGE_LAST_PACK); } catch { /* ignore */ }
}
function sanitizePersistedPackResult(raw: any): any {
  if (!raw || typeof raw !== "object") return null;
  const result = raw.result;
  if (!result || typeof result !== "object" || typeof result.packId !== "string" || typeof result.downloadUrl !== "string") return null;

  const platform = (typeof raw.platform === "string" && PLATFORM_SPECS[raw.platform]) ? raw.platform : "wechat_stickers";
  const stickers = Array.isArray(result.stickers)
    ? result.stickers
        .filter((item: any) => item && typeof item === "object" && typeof item.label === "string" && typeof item.url === "string")
        .map((item: any) => ({
          label: item.label,
          url: item.url,
          assetId: typeof item.assetId === "string" ? item.assetId : undefined,
          prompt: typeof item.prompt === "string" ? item.prompt : undefined
        }))
    : [];

  return {
    platform,
    uploadId: typeof raw.uploadId === "string" ? raw.uploadId : null,
    prompt: typeof raw.prompt === "string" ? raw.prompt : "",
    provider: typeof raw.provider === "string" ? raw.provider : undefined,
    title: typeof raw.title === "string" ? raw.title : "",
    author: typeof raw.author === "string" ? raw.author : "",
    versionText: typeof raw.versionText === "string" ? raw.versionText : "",
    copyrightText: typeof raw.copyrightText === "string" ? raw.copyrightText : "",
    rewardEnabled: Boolean(raw.rewardEnabled),
    rewardMessage: typeof raw.rewardMessage === "string" ? raw.rewardMessage : "",
    stickerCount: Number.isFinite(raw.stickerCount) ? raw.stickerCount : DEFAULT_STICKER_COUNT,
    styles: Array.isArray(raw.styles) ? raw.styles.filter((item: any) => typeof item === "string" && item.trim()) : [],
    hasGenerationAttempted: Boolean(raw.hasGenerationAttempted),
    result: {
      packId: result.packId,
      downloadUrl: result.downloadUrl,
      downloadFilename: typeof result.downloadFilename === "string" ? result.downloadFilename : undefined,
      stickers,
      metadataJson: typeof result.metadataJson === "string" ? result.metadataJson : undefined,
      meta: result.meta && typeof result.meta === "object"
        ? {
            ...result.meta,
            ...(typeof raw.title === "string" && raw.title ? { title: raw.title } : {}),
            ...(typeof raw.author === "string" && raw.author ? { author: raw.author } : {}),
            ...(typeof raw.versionText === "string" && raw.versionText ? { version: raw.versionText } : {}),
            ...(typeof raw.copyrightText === "string" && raw.copyrightText ? { copyright: raw.copyrightText } : {}),
            ...(typeof raw.rewardMessage === "string" && raw.rewardMessage ? { rewardMessage: raw.rewardMessage } : {}),
            ...(raw.rewardEnabled ? { rewardEnabled: true } : {})
          }
        : {
            ...(typeof raw.title === "string" && raw.title ? { title: raw.title } : {}),
            ...(typeof raw.author === "string" && raw.author ? { author: raw.author } : {}),
            ...(typeof raw.versionText === "string" && raw.versionText ? { version: raw.versionText } : {}),
            ...(typeof raw.copyrightText === "string" && raw.copyrightText ? { copyright: raw.copyrightText } : {}),
            ...(typeof raw.rewardMessage === "string" && raw.rewardMessage ? { rewardMessage: raw.rewardMessage } : {}),
            ...(raw.rewardEnabled ? { rewardEnabled: true } : {})
          },
      extras: result.extras && typeof result.extras === "object" ? result.extras : {}
    }
  };
}
function persistLastGeneratedResult(result: any): void {
  const storage = getStorage();
  if (!storage || !result?.packId || !result?.downloadUrl) return;

  const payload = {
    version: 2,
    platform: currentPlatform,
    savedAt: new Date().toISOString(),
    uploadId: currentUploadId,
    prompt: wechatAiPrompt.value,
    provider: currentAiProvider,
    title: wechatAiTitle.value,
    author: wechatAiAuthor.value,
    versionText: wechatAiVersion.value,
    copyrightText: wechatAiCopyright.value,
    rewardEnabled: currentRewardEnabled,
    rewardMessage: wechatAiRewardMessage.value,
    stickerCount: Number(wechatAiCount.value || DEFAULT_STICKER_COUNT),
    styles: Array.isArray(currentStyles) ? currentStyles.filter(Boolean) : [],
    hasGenerationAttempted,
    result: {
      packId: result.packId,
      downloadUrl: result.downloadUrl,
      downloadFilename: result.downloadFilename,
      stickers: Array.isArray(result.stickers)
        ? result.stickers
            .filter((item: any) => item && typeof item.label === "string" && typeof item.url === "string")
            .map((item: any) => ({
              label: item.label,
              url: item.url,
              assetId: typeof item.assetId === "string" ? item.assetId : undefined,
              prompt: typeof item.prompt === "string" ? item.prompt : undefined
            }))
        : [],
      metadataJson: typeof result.metadataJson === "string" ? result.metadataJson : undefined,
      meta: result.meta && typeof result.meta === "object" ? result.meta : {},
      extras: result.extras && typeof result.extras === "object" ? result.extras : {}
    }
  };
  try { storage.setItem(STORAGE_LAST_PACK, JSON.stringify(payload)); } catch { /* ignore */ }
  addToPackHistory(result);
}
function restorePersistedPackResult(): boolean {
  const storage = getStorage();
  if (!storage) return false;
  try {
    const rawText = storage.getItem(STORAGE_LAST_PACK);
    if (!rawText) return false;
    const restored = sanitizePersistedPackResult(JSON.parse(rawText));
    if (!restored) { clearPersistedPackResult(); return false; }

    currentPlatform = restored.platform;
    setSelectedPlatform(currentPlatform);
    currentUploadId = restored.uploadId;
    if (restored.provider) currentAiProvider = restored.provider;
    currentStyles = restored.styles.length ? restored.styles : [...DEFAULT_STYLE_OPTIONS];
    currentRewardEnabled = Boolean(restored.rewardEnabled || restored.result?.meta?.rewardEnabled);
    hasGenerationAttempted = Boolean(restored.uploadId && restored.prompt && restored.hasGenerationAttempted);
    lastPackResult = restored.result;

    wechatAiPrompt.value = restored.prompt;
    if (wechatAiProvider) wechatAiProvider.value = currentAiProvider;
    wechatAiTitle.value = restored.title;
    wechatAiAuthor.value = restored.author;
    wechatAiVersion.value = restored.versionText;
    wechatAiCopyright.value = restored.copyrightText;
    wechatAiRewardMessage.value = restored.rewardMessage;
    wechatAiCount.value = String(restored.stickerCount || DEFAULT_STICKER_COUNT);
    wechatAiRewardEnabled.checked = currentRewardEnabled;
    currentRewardMessage = restored.rewardMessage;

    syncPlatformUI();
    syncRewardFields();
    renderStyleOptions(DEFAULT_STYLE_OPTIONS);
    setPromptHint(currentStyles);

    if (restored.uploadId) {
      originalPreview.src = window._preview!.buildAssetUrl(restored.uploadId);
      syncOriginalPreviewSlot();
      window._ui!.setStatus(uploadState, "已恢复参考图", "success");
    }

    window._preview!.renderPreview(restored.result.stickers, "success");
    window._preview!.renderExtraAssets(restored.result.extras, "success");
    window._preview!.renderDownload(restored.result.packId, restored.result.downloadUrl, restored.result.downloadFilename);
    window._preview!.renderExportInfo(restored.result);
    window._preview!.renderMetadataPreview(restored.result);
    const exportConfirmPanel = byId("exportConfirmPanel");
    if (exportConfirmPanel) exportConfirmPanel.hidden = false;
    window._ui!.setStatus(generateState, "已恢复最近结果", "success");
    window._preview!.setFeedback("已从本地恢复最近一次生成结果，可直接预览、下载或重新生成。", "success");
    window._ui!.setNotice("已恢复最近一次生成结果，可继续下载或重新生成。", "success");
    syncRegenerateButton();
    return true;
  } catch (e) {
    console.error("restorePersistedPackResult error:", e);
    clearPersistedPackResult();
    return false;
  }
}

// ── Pack history ────────────────────────────────────────────────────────────
function getPackHistory(): any[] {
  const storage = getStorage();
  if (!storage) return [];
  try {
    const raw = storage.getItem(STORAGE_PACK_HISTORY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.slice(0, MAX_HISTORY) : [];
  } catch { return []; }
}
/**
 * 服务端的包列表（当前用户可见的那些）。
 * 服务端是「这个用户有哪些包」的权威来源：清了浏览器缓存也能把历史补回来。
 */
let serverPacks: any[] | null = null;
let serverRetentionDays = 0;

/** 拉一次服务端包列表，并把本地历史与服务端对账。 */
async function refreshPackHistory(): Promise<void> {
  try {
    const json = await requestJson("/api/packs");
    if (!Array.isArray(json?.packs)) return;
    const packs: any[] = json.packs;
    serverPacks = packs;
    serverRetentionDays = Number(json?.retentionDays) || 0;

    // 本地有、服务端列表里没有的，不能直接判定「已过期」：
    // 开启归属之前建的包没有 owner，不会出现在任何人的列表里。逐个探一下确认真伪。
    const known = new Set(packs.map((p) => p.packId));
    const local = getPackHistory();
    const unknown = local.filter((e) => e?.packId && !known.has(e.packId));
    const missingIds = new Set<string>();
    const api = (window._auth && window._auth.api) || fetch;
    await Promise.all(
      unknown.map(async (e) => {
        try {
          const res = await api(`/api/packs/${encodeURIComponent(e.packId)}`);
          if (res.status === 404) missingIds.add(e.packId);
        } catch {
          // 网络问题不判定，保持原样
        }
      })
    );

    const merged = mergeHistoryWithServer(local, packs, missingIds);
    savePackHistory(merged);
    renderPackHistory();
  } catch {
    // 拉不到就继续用本地缓存，不影响使用
    renderPackHistory();
  }
}

/**
 * 合并本地历史与服务端列表：
 * - 服务端有的以服务端为准（标题/数量/过期时间等展示字段都对齐）；
 * - 服务端没有的本地记录标记为 `missing`（已过期或被删），灰显但仍可点删除；
 * - 服务端有、本地没有的（例如清了缓存）补回来 —— 这就是「历史不丢」的关键。
 */
function mergeHistoryWithServer(local: any[], server: any[], missingIds: Set<string> = new Set()): any[] {
  const merged = new Map<string, any>();
  for (const p of server) {
    if (!p?.packId) continue;
    merged.set(p.packId, {
      packId: p.packId,
      downloadUrl: p.downloadUrl,
      downloadFilename: p.downloadFilename || `${p.packId}.zip`,
      platform: p.presetId || "wechat_stickers",
      platformLabel: PLATFORM_SPECS[p.presetId]?.platformLabel || "",
      title: p.title || "未命名表情包",
      author: p.author || "",
      stickerCount: p.stickerCount || 0,
      styles: Array.isArray(p.styles) ? p.styles.join(", ") : "",
      createdAt: Date.parse(p.createdAt) || Date.now(),
      rewardEnabled: Boolean(p.rewardEnabled),
      expiresAt: p.expiresAt || null,
      missing: false
    });
  }
  for (const e of local) {
    if (!e?.packId || merged.has(e.packId)) continue;
    merged.set(e.packId, { ...e, missing: missingIds.has(e.packId) });
  }
  return [...merged.values()]
    .sort((a, b) => (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0))
    .slice(0, MAX_HISTORY);
}

/** 「还剩 N 天」：只在快过期时提示，避免每条都挤满噪音。 */
function expiryHint(expiresAt: string | null | undefined): string {
  if (!expiresAt) return "";
  const stamp = Date.parse(expiresAt);
  if (!Number.isFinite(stamp)) return "";
  const days = Math.ceil((stamp - Date.now()) / 86400000);
  if (days < 0) return "已过期";
  if (days > 7) return "";
  if (days === 0) return "今天到期";
  return `剩余 ${days} 天`;
}

function savePackHistory(history: any[]): void {
  const storage = getStorage();
  if (!storage) return;
  try { storage.setItem(STORAGE_PACK_HISTORY, JSON.stringify(history.slice(0, MAX_HISTORY))); } catch { /* ignore */ }
}
function addToPackHistory(result: any): void {
  if (!result?.packId || !result?.downloadUrl) return;
  const history = getPackHistory();
  const filtered = history.filter((h) => h.packId !== result.packId);
  const spec = PLATFORM_SPECS[currentPlatform];
  const entry = {
    packId: result.packId,
    downloadUrl: result.downloadUrl,
    downloadFilename: result.downloadFilename || `${result.packId}.zip`,
    platform: currentPlatform,
    platformLabel: spec.platformLabel,
    title: result?.meta?.title || "未命名表情包",
    author: result?.meta?.author || "",
    stickerCount: result?.stickers?.length || result?.meta?.count || 0,
    styles: Array.isArray(result?.meta?.styles) ? result.meta.styles.join(", ") : "",
    createdAt: new Date().toISOString(),
    rewardEnabled: Boolean(result?.meta?.rewardEnabled),
    versionText: result?.meta?.version || "",
    metadataJson: typeof result.metadataJson === "string" ? result.metadataJson.slice(0, 500) : ""
  };
  savePackHistory([entry, ...filtered]);
  renderPackHistory();
  // 顺带对齐服务端字段（过期时间等）
  if (serverPacks) void refreshPackHistory();
}
function formatTimeAgo(iso: string): string {
  if (!iso) return "";
  try {
    const diff = Date.now() - new Date(iso).getTime();
    const minutes = Math.floor(diff / 60000);
    if (minutes < 1) return "刚刚";
    if (minutes < 60) return minutes + " 分钟前";
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return hours + " 小时前";
    const days = Math.floor(hours / 24);
    return days + " 天前";
  } catch { return ""; }
}
function renderPackHistory(): void {
  const history = getPackHistory();
  if (!historySection || !historyList) return;
  if (history.length === 0) {
    // 先清空节点再隐藏：否则删掉最后一条后，DOM 里会残留（不可见的）陈旧记录
    historyList.innerHTML = "";
    historySection.style.display = "none";
    return;
  }
  historySection.style.display = "block";

  if (historySummary) {
    const latest = history[0];
    const timeAgo = formatTimeAgo(latest.createdAt) || "刚刚";
    const retention = serverRetentionDays > 0 ? ` · 服务端保留 ${serverRetentionDays} 天` : "";
    historySummary.textContent = `${history.length} 条记录 · 最近 ${timeAgo}${retention}`;
  }

  historyList.innerHTML = history
    .map((entry) => `
      <div class="history-item${entry.missing ? " history-item-missing" : ""}" data-pack-id="${window._preview!.escapeAttr(entry.packId)}">
        <div class="history-item-meta">
          <div class="history-item-title">${window._preview!.escapeHtml(entry.title)}${entry.missing ? ' <span class="history-tag">已过期</span>' : ""}</div>
          <div class="history-item-sub">${window._preview!.escapeHtml(entry.author ? entry.author + " · " : "")}${entry.stickerCount} 张${entry.styles ? " · " + window._preview!.escapeHtml(entry.styles) : ""}${entry.rewardEnabled ? " · 含赞赏" : ""}${entry.platformLabel ? " · " + window._preview!.escapeHtml(entry.platformLabel) : ""} · ${formatTimeAgo(entry.createdAt) || "刚刚"}${expiryHint(entry.expiresAt) ? " · " + expiryHint(entry.expiresAt) : ""}</div>
        </div>
        <div class="history-item-actions">
          <button type="button" class="secondary history-dl-btn" data-pack-id="${window._preview!.escapeAttr(entry.packId)}" data-dl-url="${window._preview!.escapeAttr(entry.downloadUrl)}" data-filename="${window._preview!.escapeAttr(entry.downloadFilename)}"${entry.missing ? " disabled" : ""}>下载</button>
          <button type="button" class="secondary history-restore-btn" data-pack-id="${window._preview!.escapeAttr(entry.packId)}"${entry.missing ? " disabled" : ""}><svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l3 2"/></svg> 还原现场</button>
          <button type="button" class="secondary history-delete-btn" data-pack-id="${window._preview!.escapeAttr(entry.packId)}" title="删除这条记录（同时删掉服务端的包）" aria-label="删除这条记录"><svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>
        </div>
      </div>
    `).join("");

  historyList.querySelectorAll(".history-dl-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const el = btn as HTMLButtonElement;
      const url = el.dataset.dlUrl;
      const filename = el.dataset.filename;
      if (url) {
        const a = document.createElement("a");
        a.href = url;
        a.download = filename || "pack.zip";
        a.click();
      }
    });
  });
  historyList.querySelectorAll(".history-restore-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      void restoreFromHistory((btn as HTMLButtonElement).dataset.packId || "");
    });
  });
  historyList.querySelectorAll(".history-delete-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      void deletePackFromHistory((btn as HTMLButtonElement).dataset.packId || "");
    });
  });
}
/**
 * 清空历史记录。
 *
 * 服务端是这个用户「有哪些包」的权威来源，所以只清本地的话，下次刷新会原样回来。
 * 因此这里一并删掉服务端的包 —— 做了二次确认，且是唯一会批量删文件的操作。
 */
async function clearPackHistory(): Promise<void> {
  const history = getPackHistory();
  const confirmed = window.confirm(
    history.length
      ? `确定删除全部 ${history.length} 条记录？\n\n这同时会删掉服务端保存的表情包，不可恢复。`
      : "当前没有历史记录。"
  );
  if (!confirmed) return;

  savePackHistory([]);
  await Promise.allSettled(
    history.map((e) =>
      e?.packId
        ? requestJson(`/api/packs/${encodeURIComponent(e.packId)}`, { method: "DELETE" })
        : Promise.resolve()
    )
  );
  if (serverPacks) serverPacks = [];
  renderPackHistory();
  window._ui!.setNotice(
    history.length ? `已删除全部 ${history.length} 条记录（含服务端的包）` : "历史记录已清空",
    "info"
  );
}
/** 把当前平台切到指定值（含单选按钮与 UI 同步）。 */
function switchPlatform(platform: string | undefined): void {
  if (platform && PLATFORM_SPECS[platform]) {
    currentPlatform = platform;
    setSelectedPlatform(currentPlatform);
    syncPlatformUI();
  }
}

/**
 * 删除一条历史记录：服务端的包一并删掉，释放磁盘。
 * 服务端删失败（比如包早已被清理）也要清掉本地记录，否则这条会永远删不掉。
 */
async function deletePackFromHistory(packId: string): Promise<void> {
  const history = getPackHistory();
  const entry = history.find((h) => h.packId === packId);
  try {
    await requestJson(`/api/packs/${encodeURIComponent(packId)}`, { method: "DELETE" });
  } catch {
    // 包可能已经不在了，继续清本地记录
  }
  savePackHistory(history.filter((h) => h.packId !== packId));
  if (serverPacks) serverPacks = serverPacks.filter((p) => p.packId !== packId);
  renderPackHistory();
  if (lastPackResult?.packId === packId) resetGenerationResult({ clearPersisted: true });
  window._ui!.setNotice(`已删除「${entry?.title || packId}」`, "info");
}

/**
 * 历史记录「还原现场」：包还在服务端，直接按 packId 还原生成现场，
 * 不用用户再去翻本地文件。包已被清理时退回「只恢复表单配置」。
 */
async function restoreFromHistory(packId: string): Promise<void> {
  const history = getPackHistory();
  if (!Array.isArray(history)) return;
  const entry = history.find((h) => h.packId === packId);
  if (!entry) {
    window._ui!.showToast("未找到该记录", "error");
    return;
  }
  const titleText = entry.title || "未命名";
  switchPlatform(entry.platform);

  window._ui!.setStatus(generateState, "正在还原", "loading");
  window._ui!.setNotice(`正在还原「${titleText}」的生成现场。`, "info");
  try {
    const json = await requestJson(`/api/packs/${encodeURIComponent(packId)}/restore`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ presetId: currentPlatform })
    });

    resetGenerationResult({ clearPersisted: true });
    currentUploadId = null;
    originalPreview.removeAttribute("src");
    syncOriginalPreviewSlot();
    // 清空元数据表单，让包里的标题 / 作者 / 版权写回来
    wechatAiTitle.value = "";
    wechatAiAuthor.value = "";
    wechatAiVersion.value = "";
    wechatAiCopyright.value = "";
    switchPlatform(json?.meta?.presetId);
    if (creationModeImport) creationModeImport.checked = true;
    syncCreationMode();

    renderCompletedPackResult(
      json,
      `已还原「${titleText}」的生成现场，可继续单张重新生成或下载。`,
      "提示词、风格、情绪与参考图已还原，可直接下载或继续编辑。"
    );
    scrollToElement(document.querySelector(".flow"), { block: "start" });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "还原失败";
    resetAllState();
    switchPlatform(entry.platform);
    if (entry.title) wechatAiTitle.value = entry.title;
    if (entry.author) wechatAiAuthor.value = entry.author;
    if (entry.stickerCount) wechatAiCount.value = String(entry.stickerCount);
    if (creationModeAi) creationModeAi.checked = true;
    syncCreationMode();
    window._ui!.setNotice(`${reason}，已只恢复配置，如需重新生成请补充参考图。`, "error");
  }
}
function toggleHistory(expand?: boolean): void {
  historyExpanded = expand !== undefined ? expand : !historyExpanded;
  if (historyBody) historyBody.style.display = historyExpanded ? "block" : "none";
  // 用空字符串清掉内联 display，让 .history-list 的 display:flex 生效（否则 gap 失效、记录会贴在一起）。
  if (historyList) historyList.style.display = historyExpanded ? "" : "none";
  if (historyCollapseIcon) historyCollapseIcon.classList.toggle("expanded", historyExpanded);
}

// ── Buttons / creation mode ─────────────────────────────────────────────────
function canRegenerate(): boolean {
  return currentCreationMode === "ai" && Boolean(currentUploadId && wechatAiPrompt.value.trim() && hasGenerationAttempted);
}
function syncRegenerateButton(): void {
  regenerateSubmit.disabled = canRegenerate() ? false : true;
  regenerateSubmit.hidden = currentCreationMode !== "ai";
}
// 点击生成失败的预览卡片时重试：行为与「开始生成 / 重新生成 / 导入并打包」一致。
function retryFromFailedPreview(): void {
  if (currentCreationMode === "import") {
    void importPlatformPack();
    return;
  }
  if (!canRegenerate()) {
    window._ui!.setNotice(
      currentUploadId ? "请先补充提示词，再重新生成。" : "请先上传参考图，再重新生成。",
      "info"
    );
    return;
  }
  void generatePlatformPack();
}

// ── 单资源重生成 ─────────────────────────────────────────────────────────────
const EXTRA_ASSET_KEYS = [
  "coverAssetId",
  "iconAssetId",
  "bannerAssetId",
  "rewardGuideAssetId",
  "rewardThanksAssetId"
] as const;

/** currentExtras 的资源 key → metadata.json 中的文件 role。 */
const EXTRA_ROLE_BY_KEY: Record<string, string> = {
  coverAssetId: "cover",
  iconAssetId: "icon",
  bannerAssetId: "banner",
  rewardGuideAssetId: "reward-guide",
  rewardThanksAssetId: "reward-thanks"
};

/** 汇总当前预览中已有的资源（含生成上下文），用于重新打包。 */
function collectPackAssets(): {
  assets: Array<{ label: string; assetId: string; role: string; prompt?: string; style?: string; emotion?: string }>;
  extras: Record<string, string>;
  extraDetails: Record<string, { prompt?: string; style?: string }>;
} {
  const assets = currentStickers
    .filter((s) => s && s.assetId)
    .map((s, i) => ({
      label: String(s.label ?? i + 1).padStart(3, "0"),
      assetId: s.assetId as string,
      role: "sticker",
      ...(s.prompt ? { prompt: s.prompt } : {}),
      ...(s.style ? { style: s.style } : {}),
      ...(s.emotion ? { emotion: s.emotion } : {})
    }));
  const extras: Record<string, string> = {};
  const extraDetails: Record<string, { prompt?: string; style?: string }> = {};
  for (const key of EXTRA_ASSET_KEYS) {
    const id = currentExtras[key];
    if (typeof id === "string" && id) extras[key] = id;
    const detail: { prompt?: string; style?: string } = {};
    if (currentExtras[`${key}_prompt`]) detail.prompt = currentExtras[`${key}_prompt`];
    if (currentExtras[`${key}_style`]) detail.style = currentExtras[`${key}_style`];
    if (Object.keys(detail).length) extraDetails[EXTRA_ROLE_BY_KEY[key]!] = detail;
  }
  return { assets, extras, extraDetails };
}

/** 用当前资源重新打包 ZIP，让下载内容与预览保持一致。 */
async function rebuildPackFromState(): Promise<void> {
  const { assets, extras, extraDetails } = collectPackAssets();
  if (!assets.length) return;
  try {
    const body: Record<string, unknown> = {
      presetId: currentPlatform,
      assets,
      ...extras,
      metadata: getMetadataPayload()
    };
    if (Object.keys(extraDetails).length) body.extraDetails = extraDetails;
    if (lastPackResult?.generation) body.generation = lastPackResult.generation;
    // 参考图一并打进 source/，保证重建后的 ZIP 仍可完整还原
    const referenceAssetId = currentUploadId ?? lastPackResult?.generation?.referenceAssetId;
    if (referenceAssetId) body.referenceAssetId = referenceAssetId;
    const res = await requestJson("/api/packs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    });
    lastPackResult = {
      ...(lastPackResult ?? {}),
      packId: res.packId,
      downloadUrl: res.downloadUrl,
      downloadFilename: res.downloadFilename
    };
    window._preview!.renderDownload(res.packId, res.downloadUrl, res.downloadFilename);
  } catch {
    // 重新打包失败不影响单资源结果的展示
  }
}

/** 只重生成失败的那一张资源（贴纸或扩展图），不重跑整包。 */
async function regenerateResource(target: { kind: string; index?: number; key?: string }): Promise<void> {
  if (resourceRegenerating) return;
  if (!currentUploadId) {
    window._ui!.setNotice("请先上传参考图。", "error");
    return;
  }
  const prompt = wechatAiPrompt.value.trim();
  if (!prompt) {
    window._ui!.setNotice("请先补充提示词。", "error");
    return;
  }
  const targetLabel = target.kind === "sticker" ? `第 ${(target.index ?? 0) + 1} 张表情` : "该资源";
  resourceRegenerating = true;
  window._ui!.setNotice(`正在重新生成${targetLabel}...`, "info");
  try {
    const res = await requestJson("/api/generate/resource", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        presetId: currentPlatform,
        referenceAssetId: currentUploadId,
        prompt,
        provider: wechatAiProvider ? wechatAiProvider.value : undefined,
        styles: currentStyles.length ? currentStyles : undefined,
        stickerCount: Number(wechatAiCount.value || DEFAULT_STICKER_COUNT),
        metadata: getMetadataPayload(),
        target,
        mode: "regenerate"
      })
    });
    const url = res.url || `/api/assets/${res.assetId}`;
    if (target.kind === "sticker" && typeof target.index === "number") {
      const index = target.index;
      const existing = currentStickers[index];
      if (existing) {
        currentStickers[index] = {
          ...existing,
          label: res.label ?? existing.label,
          assetId: res.assetId,
          url,
          prompt: res.prompt,
          style: res.style ?? existing.style,
          emotion: res.emotion ?? existing.emotion
        };
        // renderPreview 带增量渲染，已存在的卡片不会重绘；先清空以强制整组重建。
        wechatAiPreview.innerHTML = "";
        window._preview!.renderPreview(currentStickers, "success");
      }
    } else if (target.key) {
      currentExtras[target.key] = res.assetId;
      currentExtras[`${target.key}_prompt`] = res.prompt;
      if (res.style) currentExtras[`${target.key}_style`] = res.style;
      delete currentExtras[`${target.key}_error`];
      window._preview!.renderExtraAssets(currentExtras, "success");
    }
    if (lastPackResult) await rebuildPackFromState();
    window._ui!.setNotice(`${targetLabel}已重新生成。`, "success");
  } catch (error) {
    window._ui!.setNotice(error instanceof Error ? error.message : "重新生成失败，请稍后重试。", "error");
  } finally {
    resourceRegenerating = false;
  }
}

function setGenerateButtonsBusy(busy: boolean): void {
  window._ui!.setBusy(generateSubmit, busy, currentCreationMode === "import" ? "导入中..." : "生成中...");
  window._ui!.setBusy(regenerateSubmit, busy, "重新生成中...");
  if (wechatAiProvider) wechatAiProvider.disabled = busy;
  if (cancelGenerate) {
    cancelGenerate.hidden = busy && currentCreationMode === "ai" ? false : true;
    cancelGenerate.disabled = busy ? false : true;
  }
  if (!busy) syncRegenerateButton();
}
function syncCreationMode(): void {
  currentCreationMode = creationModeImport?.checked ? "import" : "ai";
  const step2Label = document.querySelector(".step-nav-item[data-step='1'] .step-nav-label");
  if (step2Label) step2Label.textContent = currentCreationMode === "import" ? "导入已有表情图" : "上传参考图";
  if (aiSourceSection) aiSourceSection.hidden = currentCreationMode !== "ai";
  if (importSourceSection) importSourceSection.hidden = currentCreationMode !== "import";
  if (aiConfigFields) aiConfigFields.hidden = currentCreationMode !== "ai";
  window._ui!.setButtonLabel(generateSubmit, currentCreationMode === "import" ? "导入并打包" : "开始生成");
  regenerateSubmit.hidden = currentCreationMode !== "ai";
  if (cancelGenerate) cancelGenerate.hidden = true;
  clearGenerateValidation();
  syncPlatformUI();
  if (currentCreationMode === "import") {
    window._ui!.setStatus(generateState, "等待导入", "idle");
    window._ui!.setNotice("请选择已有表情图，系统会自动标准化并打包。", "info");
  } else {
    window._ui!.setStatus(generateState, "等待生成", "idle");
    window._ui!.setNotice(currentUploadId ? "参考图已就绪，可继续生成表情包。" : "先上传一张主体清晰的图片。", "info");
  }
  syncRegenerateButton();
}

// ── Reset ───────────────────────────────────────────────────────────────────
function resetGenerationResult(opts: { clearPersisted?: boolean } = {}): void {
  wechatAiZipLink.innerHTML = "";
  clearGenerateValidation();
  wechatAiPreview.innerHTML = "";
  currentStickers = [];
  currentExtras = {};

  sectionAssetsGroup.hidden = true;
  sectionRewardGroup.hidden = true;

  const exportConfirmPanel = byId("exportConfirmPanel");
  if (exportConfirmPanel) exportConfirmPanel.hidden = true;

  window._preview!.renderPreview([], "idle");
  window._preview!.renderExtraAssets({}, "idle");

  const spec = PLATFORM_SPECS[currentPlatform];
  const feedbackText = spec.showsExtraAssets ? "等待生成后展示 cover、icon、banner 与表情预览。" : "等待生成后展示贴纸预览。";
  window._preview!.setFeedback(feedbackText, "idle");
  window._preview!.setExportInfo("结果概览与导出信息", "生成后在这里查看标题、数量、风格、参考图方式与导出文件。");
  window._preview!.renderMetadataPreview(null);
  window._ui!.setStatus(generateState, "等待生成", "idle");
  hasGenerationAttempted = false;
  lastPackResult = null;
  if (opts.clearPersisted !== false) clearPersistedPackResult();
  syncRegenerateButton();
  syncOriginalPreviewSlot();
}
function resetAllState(): void {
  currentPlatform = "wechat_stickers";
  setSelectedPlatform("wechat_stickers");
  currentUploadId = null;
  currentStyles = [...DEFAULT_STYLE_OPTIONS];
  availableStyles = [...DEFAULT_STYLE_OPTIONS];
  currentRewardEnabled = false;
  currentRewardMessage = "";
  currentCreationMode = "import";
  hasGenerationAttempted = false;
  lastPackResult = null;

  document.querySelectorAll(".step-card.collapsed").forEach((c) => expandStepCard(c as HTMLElement));
  updateStepNav(0, []);
  hideStickyActionBar();
  scrollToStep(0);

  uploadForm.reset();
  importForm?.reset?.();
  if (creationModeImport) creationModeImport.checked = true;
  if (creationModeAi) creationModeAi.checked = false;
  wechatAiPrompt.value = "";
  wechatAiTitle.value = "";
  wechatAiAuthor.value = "";
  wechatAiVersion.value = "";
  wechatAiCopyright.value = "";
  wechatAiCount.value = String(DEFAULT_STICKER_COUNT);
  wechatAiRewardEnabled.checked = false;
  wechatAiRewardMessage.value = "";
  syncPlatformUI();
  syncRewardFields();
  originalPreview.removeAttribute("src");
  syncOriginalPreviewSlot();

  setCountValue(DEFAULT_STICKER_COUNT);
  renderStyleOptions(DEFAULT_STYLE_OPTIONS);
  resetGenerationResult({ clearPersisted: true });
  setPromptHint(currentStyles);
  window._ui!.setStatus(uploadState, "等待上传", "idle");
  window._ui!.setStatus(importState, "等待导入", "idle");
  syncCreationMode();
  window._ui!.setNotice("已重置当前配置与最近结果，请重新上传一张主体清晰的图片。", "info");
}

// ── Request / prompt / metadata ─────────────────────────────────────────────
async function parseJson(response: Response): Promise<any> {
  const text = await response.text();
  if (!text) return {};
  try { return JSON.parse(text); } catch { throw new Error("服务返回了无法解析的响应"); }
}
async function requestJson(url: string, options?: RequestInit): Promise<any> {
  const api = (window._auth && window._auth.api) || fetch;
  const response = await api(url, options);
  const json = await parseJson(response);
  if (!response.ok) throw new Error(json?.message || "请求失败，请稍后重试");
  return json;
}
async function suggestPrompt(): Promise<void> {
  if (!currentUploadId) return;
  try {
    const json = await requestJson("/api/generate/prompt", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ referenceAssetId: currentUploadId, presetId: currentPlatform })
    });
    wechatAiPrompt.value = json.prompt ?? "";
    currentStyles = Array.isArray(json.styles) ? json.styles.filter(Boolean) : [];
    renderStyleOptions(DEFAULT_STYLE_OPTIONS);
    setPromptHint(currentStyles);
  } catch { /* 忽略后台提示词生成错误 */ }
}
function getMetadataPayload(): Record<string, string> | undefined {
  const spec = PLATFORM_SPECS[currentPlatform];
  const title = spec.showsTitle ? wechatAiTitle.value.trim() : "";
  const author = spec.showsAuthor ? wechatAiAuthor.value.trim() : "";
  const version = spec.showsVersion ? wechatAiVersion.value.trim() : "";
  const copyright = spec.showsCopyright ? wechatAiCopyright.value.trim() : "";
  const rewardMessage = spec.showsReward ? wechatAiRewardMessage.value.trim() : "";
  const result: Record<string, string> = {
    ...(title ? { title } : {}),
    ...(author ? { author } : {}),
    ...(version ? { version } : {}),
    ...(copyright ? { copyright } : {}),
    ...(rewardMessage ? { rewardMessage } : {})
  };
  return Object.keys(result).length ? result : undefined;
}

// ── Result rendering (orchestration) ────────────────────────────────────────
/**
 * 把结果里的资源与生成上下文写回模块状态，供「单资源重生成」与「重新打包」使用。
 * 导入图片（`/api/generate/import`）与导入 ZIP 还原（`/api/generate/import-pack`）也走这里，
 * 于是导入后的包同样能单张重生成、二次编辑并重建 ZIP。
 */
function syncStateFromResult(json: any): void {
  const stickers = Array.isArray(json?.stickers) ? json.stickers : [];
  currentStickers = stickers.map((s: any, i: number) => ({
    label: s?.label ?? String(i + 1).padStart(3, "0"),
    assetId: s?.assetId,
    ...(s?.prompt ? { prompt: s.prompt } : {}),
    ...(s?.style ? { style: s.style } : {}),
    ...(s?.emotion ? { emotion: s.emotion } : {}),
    ...(s?.sourceAssetId ? { sourceAssetId: s.sourceAssetId } : {})
  }));

  currentExtras = {};
  for (const key of EXTRA_ASSET_KEYS) {
    const id = json?.extras?.[key];
    if (typeof id === "string" && id) currentExtras[key] = id;
  }
  const extraDetails = json?.extraDetails ?? {};
  for (const [key, role] of Object.entries(EXTRA_ROLE_BY_KEY)) {
    const detail = extraDetails[role];
    if (!detail) continue;
    if (detail.prompt) currentExtras[`${key}_prompt`] = detail.prompt;
    if (detail.style) currentExtras[`${key}_style`] = detail.style;
  }

  // 还原 ZIP 时把包里的风格 / 标题 / 作者写回表单，后续重建 ZIP 才能保持一致
  const styles = Array.isArray(json?.generation?.styles) ? json.generation.styles.filter(Boolean) : [];
  if (styles.length) {
    currentStyles = styles;
    renderStyleOptions(availableStyles);
    setPromptHint(currentStyles);
  }
  if (json?.meta?.title && !wechatAiTitle.value.trim()) wechatAiTitle.value = json.meta.title;
  if (json?.meta?.author && !wechatAiAuthor.value.trim()) wechatAiAuthor.value = json.meta.author;
  if (json?.meta?.version && !wechatAiVersion.value.trim()) wechatAiVersion.value = json.meta.version;
  if (json?.meta?.copyright && !wechatAiCopyright.value.trim()) wechatAiCopyright.value = json.meta.copyright;

  // 包内带着参考图时把它接上，单张重新生成才有素材可用
  const referenceAssetId = json?.meta?.referenceAssetId;
  if (!currentUploadId && typeof referenceAssetId === "string" && referenceAssetId) {
    currentUploadId = referenceAssetId;
    originalPreview.src = window._preview!.buildAssetUrl(referenceAssetId);
    syncOriginalPreviewSlot();
    window._ui!.setStatus(uploadState, "已还原参考图", "success");
  }
}

function renderCompletedPackResult(json: any, successMessage: string, feedbackMessage: string): void {
  currentRewardEnabled = Boolean(json?.meta?.rewardEnabled ?? false);
  currentRewardMessage = json?.meta?.rewardMessage ?? "";
  wechatAiRewardEnabled.checked = currentRewardEnabled;
  wechatAiRewardMessage.value = currentRewardMessage;
  syncRewardFields();
  lastPackResult = json;
  syncStateFromResult(json);
  window._preview!.renderPreview(json?.stickers ?? [], "success");
  window._preview!.renderExtraAssets(json?.extras ?? {}, "success");

  const exportConfirmPanel = byId("exportConfirmPanel");
  if (exportConfirmPanel) exportConfirmPanel.hidden = false;

  window._preview!.renderDownload(json?.packId, json?.downloadUrl, json?.downloadFilename);
  persistLastGeneratedResult(json);
  window._ui!.setStatus(generateState, "已完成", "success");
  window._ui!.setNotice(successMessage, "success");
  window._preview!.setFeedback(feedbackMessage, "success");
  window._preview!.renderExportInfo(json);
  window._preview!.renderMetadataPreview(json);
  finalizePackFlow(json, "导入完成");
}

async function importPlatformPack(): Promise<void> {
  // ZIP 包走「还原生成现场」，零散图片走「标准化导入」
  const zipFile = importZip?.files?.[0];
  if (zipFile) {
    await restorePackZip(zipFile);
    return;
  }
  const files = importFiles?.files;
  const count = Number(files?.length || 0);
  if (count < MIN_STICKER_COUNT || count > MAX_STICKER_COUNT) {
    window._ui!.setNotice(`请选择 ${MIN_STICKER_COUNT}-${MAX_STICKER_COUNT} 张图片后再导入。`, "error");
    window._ui!.setStatus(importState, "数量不符合", "error");
    return;
  }
  const spec = PLATFORM_SPECS[currentPlatform];

  window._ui!.setStatus(importState, "处理中...", "loading");
  window._ui!.setStatus(generateState, "正在导入", "loading");
  window._ui!.setNotice("正在标准化导入图片并打包。", "info");
  resetGenerationResult({ clearPersisted: true });
  window._preview!.renderPreview([], "loading");
  window._preview!.renderExtraAssets({}, "idle");
  window._preview!.setFeedback(`正在把导入图片转换为${spec.platformLabel}规格。`, "loading");
  window._preview!.renderMetadataPreview(null, "loading");
  setGenerateButtonsBusy(true);

  try {
    const formData = new FormData();
    formData.append("presetId", currentPlatform);
    for (const file of Array.from(files as FileList)) formData.append("stickers", file);
    const optionalFiles: Array<[string, File | undefined]> = [
      ["cover", importCover?.files?.[0]],
      ["icon", importIcon?.files?.[0]],
      ["banner", importBanner?.files?.[0]],
      ["rewardGuide", importRewardGuide?.files?.[0]],
      ["rewardThanks", importRewardThanks?.files?.[0]]
    ];
    for (const [field, file] of optionalFiles) if (file) formData.append(field, file);
    if (currentRewardEnabled || importRewardGuide?.files?.[0] || importRewardThanks?.files?.[0]) {
      formData.append("includeReward", "true");
    }
    const metadata = getMetadataPayload();
    if (metadata) for (const [key, value] of Object.entries(metadata)) formData.append(key, value);

    const json = await requestJson("/api/generate/import", { method: "POST", body: formData });
    window._ui!.setStatus(importState, "导入完成", "success");
    renderCompletedPackResult(json, "图片已导入并标准化，可以预览后下载 ZIP。", `已将导入图片统一处理为${spec.platformLabel}规格，可继续核对并下载 ZIP。`);
  } catch (error) {
    window._ui!.setStatus(importState, "导入失败", "error");
    window._ui!.setStatus(generateState, "导入失败", "error");
    window._ui!.setNotice(error instanceof Error ? error.message : "导入失败，请稍后重试。", "error");
    window._preview!.renderPreview([], "error");
    window._preview!.renderExtraAssets({}, "error");
    window._preview!.setFeedback("导入失败，请检查图片格式和数量后重试。", "error");
    window._preview!.renderMetadataPreview(null, "error");
  } finally {
    setGenerateButtonsBusy(false);
  }
}

/** 导入从本站下载的 ZIP 包，还原之前的生成现场（不重编码任何图片）。 */
async function restorePackZip(file: File): Promise<void> {
  window._ui!.setStatus(importState, "还原中...", "loading");
  window._ui!.setStatus(generateState, "正在还原", "loading");
  window._ui!.setNotice("正在读取 ZIP 包并还原生成现场。", "info");
  resetGenerationResult({ clearPersisted: true });
  // 包里的参考图才是这次生成的素材，避免沿用上一轮上传的参考图
  currentUploadId = null;
  originalPreview.removeAttribute("src");
  syncOriginalPreviewSlot();
  window._preview!.renderPreview([], "loading");
  window._preview!.renderExtraAssets({}, "idle");
  window._preview!.setFeedback("正在从 ZIP 包中读回提示词、风格与参考图。", "loading");
  window._preview!.renderMetadataPreview(null, "loading");
  setGenerateButtonsBusy(true);

  try {
    const formData = new FormData();
    formData.append("presetId", currentPlatform);
    formData.append("file", file, file.name || "pack.zip");
    const json = await requestJson("/api/generate/import-pack", { method: "POST", body: formData });

    const restoredPlatform = json?.meta?.presetId;
    if (restoredPlatform && PLATFORM_SPECS[restoredPlatform] && restoredPlatform !== currentPlatform) {
      currentPlatform = restoredPlatform;
      setSelectedPlatform(currentPlatform);
      syncPlatformUI();
    }
    window._ui!.setStatus(importState, "已还原", "success");
    renderCompletedPackResult(
      json,
      "已还原之前的生成现场，可继续单张重新生成或二次编辑。",
      "提示词、风格、情绪与参考图已从 ZIP 包中读回，可直接下载或继续编辑。"
    );

    const warnings: string[] = Array.isArray(json?.restored?.warnings) ? json.restored.warnings : [];
    if (warnings.length) window._ui!.setNotice(warnings.join("；"), "info");
    if (!json?.meta?.referenceAssetId) window._ui!.setStatus(uploadState, "该包未包含参考图", "idle");
    // 清空选择，避免下次切回图片导入时误触再次还原
    if (importZip) {
      importZip.value = "";
      importZip.dispatchEvent(new Event("change"));
    }
  } catch (error) {
    window._ui!.setStatus(importState, "还原失败", "error");
    window._ui!.setStatus(generateState, "还原失败", "error");
    window._ui!.setNotice(error instanceof Error ? error.message : "还原失败，请确认这是本站下载的 ZIP 包。", "error");
    window._preview!.renderPreview([], "error");
    window._preview!.renderExtraAssets({}, "error");
    window._preview!.setFeedback("还原失败，请确认 ZIP 包完整且包含 metadata.json。", "error");
    window._preview!.renderMetadataPreview(null, "error");
  } finally {
    setGenerateButtonsBusy(false);
  }
}

async function generatePlatformPack(): Promise<void> {
  if (!currentUploadId) {
    window._ui!.setNotice("请先上传参考图。", "error");
    window._ui!.setStatus(generateState, "缺少参考图", "error");
    return;
  }
  if (!validateGenerateInputs()) { syncRegenerateButton(); return; }

  const prompt = wechatAiPrompt.value.trim();
  const rewardMessage = wechatAiRewardMessage.value.trim();
  const stickerCount = Number(wechatAiCount.value || DEFAULT_STICKER_COUNT);
  const spec = PLATFORM_SPECS[currentPlatform];

  hasGenerationAttempted = true;
  setGenerateButtonsBusy(true);
  window._ui!.setStatus(generateState, "生成中...", "loading");
  window._ui!.resetGenerationProgress();
  window._ui!.setNotice(`正在生成${spec.platformLabel}并打包，请稍候...`, "info");
  wechatAiZipLink.innerHTML = "";

  sectionAssetsGroup.hidden = true;
  sectionRewardGroup.hidden = true;

  const exportConfirmPanel = byId("exportConfirmPanel");
  if (exportConfirmPanel) exportConfirmPanel.hidden = true;

  window._preview!.renderPreview([], "loading");
  window._preview!.renderExtraAssets({}, "loading");
  const loadingFeedback = spec.showsExtraAssets
    ? (currentRewardEnabled ? "正在生成 cover、icon、banner、赞赏引导图、赞赏感谢图与表情预览。" : "正在生成 cover、icon、banner 与表情预览。")
    : "正在生成贴纸与表情预览。";
  window._preview!.setFeedback(loadingFeedback, "loading");
  window._preview!.setExportInfo("结果概览与导出信息", "正在生成中，请稍候。");
  window._preview!.renderMetadataPreview(null, "loading");

  setPlatformDisabled(true);

  try {
    const payload = {
      referenceAssetId: currentUploadId,
      presetId: currentPlatform,
      prompt,
      provider: wechatAiProvider ? wechatAiProvider.value : "mock",
      styles: currentStyles.length ? currentStyles : undefined,
      stickerCount,
      enableReward: currentRewardEnabled,
      includeCover: spec.showsExtraAssets,
      includeIcon: spec.showsExtraAssets,
      includeBanner: spec.showsExtraAssets,
      metadata: getMetadataPayload()
    };

    currentStickers = [];
    currentExtras = {};
    let totalCount = stickerCount;

    cancelRequested = false;
    sseAbortController = new AbortController();
    const api = (window._auth && window._auth.api) || fetch;
    currentTaskId = await window._generatorApi!.startGenerationTask(payload, api);

    const handleEvent = (eventName: string, data: any) => {
      if (eventName === "start") {
        totalCount = Number(data?.count || stickerCount);
        window._ui!.setStatus(generateState, `生成中 (0/${totalCount})`, "loading");
        window._ui!.updateGenerationProgress(0, totalCount);
        return;
      }
      if (eventName === "progress") {
        const current = Number(data?.current || 0);
        window._ui!.setStatus(generateState, `生成中 (${current}/${totalCount})`, "loading");
        window._ui!.updateGenerationProgress(current, totalCount);
        return;
      }
      if (eventName === "sticker") {
        currentStickers.push({
          label: data.label,
          assetId: data.assetId,
          url: data.url,
          prompt: data.prompt,
          style: data.style,
          emotion: data.emotion
        });
        window._preview!.renderPreview(currentStickers, "loading");
        const current = Number(data?.current || currentStickers.length);
        window._ui!.setStatus(generateState, `生成中 (${current}/${totalCount})`, "loading");
        window._ui!.updateGenerationProgress(current, totalCount);
        return;
      }
      if (eventName === "extra") {
        if (data?.key) {
          currentExtras[data.key] = data.assetId ?? null;
          currentExtras[`${data.key}_prompt`] = data.prompt ?? null;
          if (data.style) currentExtras[`${data.key}_style`] = data.style;
          if (data.error) currentExtras[`${data.key}_error`] = data.error;
          else delete currentExtras[`${data.key}_error`];
        }
        window._preview!.renderExtraAssets(currentExtras, "loading");
        const current = Number(data?.current || 0);
        window._ui!.setStatus(generateState, `生成中 (${current}/${totalCount})`, "loading");
        window._ui!.updateGenerationProgress(current, totalCount);
        return;
      }
      if (eventName === "done") {
        const json = data;
        currentTaskId = null;
        sseAbortController = null;
        currentRewardEnabled = Boolean(json?.meta?.rewardEnabled ?? currentRewardEnabled);
        currentRewardMessage = json?.meta?.rewardMessage ?? rewardMessage;
        wechatAiRewardEnabled.checked = currentRewardEnabled;
        wechatAiRewardMessage.value = currentRewardMessage;
        syncRewardFields();
        lastPackResult = json;
        window._preview!.renderPreview(currentStickers, "success");
        window._preview!.renderExtraAssets(currentExtras, "success");
        if (exportConfirmPanel) exportConfirmPanel.hidden = false;
        window._preview!.renderDownload(json?.packId, json?.downloadUrl, json?.downloadFilename);
        persistLastGeneratedResult(json);
        window._ui!.resetGenerationProgress();
        window._ui!.setStatus(generateState, "生成完成", "success");
        window._ui!.setNotice("表情包已生成完成，可以先预览，再下载 ZIP。", "success");
        const successFeedback = spec.showsExtraAssets
          ? (currentRewardEnabled ? "已生成 cover、icon、banner、赞赏引导图、赞赏感谢图与表情预览，可继续重新生成当前方案。" : "已生成 cover、icon、banner 与表情预览，可继续重新生成当前方案。")
          : "已生成贴纸与表情预览，可继续重新生成当前方案。";
        window._preview!.setFeedback(successFeedback, "success");
        window._preview!.renderExportInfo(json);
        window._preview!.renderMetadataPreview(json);

        finalizePackFlow(json, "生成完成");
      }
      if (eventName === "error") {
        const msg = String(data?.message || "");
        currentTaskId = null;
        sseAbortController = null;
        if (msg.includes("取消")) {
          cancelRequested = true;
          window._ui!.resetGenerationProgress();
          window._ui!.setStatus(generateState, "已取消", "error");
          window._ui!.setNotice("已取消本次生成。", "error");
          window._preview!.setFeedback("本次生成已取消，可直接点击重新生成再次尝试。", "error");
          setGenerateButtonsBusy(false);
          return;
        }
        const hint = window._ui!.getFriendlyErrorHint(msg);
        const err: any = new Error(msg || "生成失败");
        err.isServerError = true;
        err.userHint = hint;
        throw err;
      }
    };

    await window._generatorApi!.streamGeneration(currentTaskId, sseAbortController.signal, handleEvent, {
      fetchApi: api,
      isCancelled: () => cancelRequested
    });
  } catch (error) {
    if (cancelRequested) {
      setGenerateButtonsBusy(false);
    } else {
      if (lastPackResult) {
        window._preview!.renderExportInfo(lastPackResult);
        window._preview!.renderMetadataPreview(lastPackResult);
        if (exportConfirmPanel) exportConfirmPanel.hidden = false;
      } else {
        window._preview!.renderMetadataPreview(null, "error");
      }
      window._ui!.setStatus(generateState, "生成失败", "error");
      const errMsg = error instanceof Error ? error.message : "生成失败";
      const errHint = (error as any)?.userHint || window._ui!.getFriendlyErrorHint(error);
      window._ui!.setNotice(errMsg + " " + errHint, "error");
      window._preview!.renderPreview([], "error");
      window._preview!.renderExtraAssets({}, "error");
      window._preview!.setFeedback("本次生成失败，可直接点击重新生成再次尝试。", "error");
      window._preview!.setExportInfo("结果概览与导出信息", "生成失败，请调整提示词或稍后重试。");
    }
  } finally {
    currentTaskId = null;
    sseAbortController = null;
    setGenerateButtonsBusy(false);
    setPlatformDisabled(lastPackResult ? true : false);
  }
}

async function handleFileUpload(): Promise<void> {
  const file = fileInput.files?.[0];
  if (!file) {
    window._ui!.setNotice("请选择一张图片后再上传。", "error");
    window._ui!.setStatus(uploadState, "缺少图片", "error");
    return;
  }
  window._ui!.setStatus(uploadState, "上传中...", "loading");
  window._ui!.setNotice("正在上传参考图...", "info");
  resetGenerationResult();

  const form = new FormData();
  form.append("file", file);

  try {
    const json = await requestJson("/api/uploads", { method: "POST", body: form });
    currentUploadId = json?.uploadId ?? null;
    currentStyles = [...DEFAULT_STYLE_OPTIONS];
    renderStyleOptions(DEFAULT_STYLE_OPTIONS);
    clearGenerateValidation();
    hasGenerationAttempted = false;

    if (json?.original?.url) {
      originalPreview.src = json.original.url;
      syncOriginalPreviewSlot();
    }
    window._ui!.setStatus(uploadState, "上传成功", "success");
    window._ui!.setNotice("参考图已上传，正在为你准备推荐提示词。", "success");
    window._preview!.setExportInfo("结果概览与导出信息", "参考图已就绪，下一步补充提示词并生成表情包。");
    updateStepNav(2, [0, 1]);

    try { await suggestPrompt(); }
    catch (promptError) {
      window._ui!.setNotice(promptError instanceof Error ? promptError.message : "参考图已上传，请手动生成提示词。", "error");
    }
  } catch (error) {
    currentUploadId = null;
    hasGenerationAttempted = false;
    originalPreview.removeAttribute("src");
    window._ui!.setStatus(uploadState, "上传失败", "error");
    window._ui!.setNotice(error instanceof Error ? error.message : "上传失败，请稍后重试。", "error");
    syncRegenerateButton();
  }
}

// ── Cancel / leave ──────────────────────────────────────────────────────────
async function requestCancelCurrentGeneration(options: { keepalive?: boolean } = {}): Promise<boolean> {
  const taskId = currentTaskId;
  if (!taskId) return false;
  cancelRequested = true;
  const body = JSON.stringify({ taskId });
  const keepalive = Boolean(options.keepalive);
  if (keepalive && navigator.sendBeacon) {
    const blob = new Blob([body], { type: "application/json" });
    if (navigator.sendBeacon("/api/generate/cancel", blob)) return true;
  }
  const api = (window._auth && window._auth.api) || fetch;
  await api("/api/generate/cancel", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
    keepalive
  });
  return true;
}

// ── UX ──────────────────────────────────────────────────────────────────────
function scrollToElement(el: Element | null, options: { block?: string } = {}): void {
  if (!el) return;
  const prefersReducedMotion = Boolean(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  try {
    el.scrollIntoView({ behavior: prefersReducedMotion ? "auto" : "smooth", block: (options.block as ScrollLogicalPosition) || "start" });
  } catch {
    el.scrollIntoView();
  }
}
function finalizePackFlow(json: any, actionLabel: string): void {
  const step0 = document.querySelector<HTMLElement>('.step-card[data-step-index="0"]');
  const step1 = document.querySelector<HTMLElement>(currentCreationMode === "import" ? "#importSourceSection" : "#aiSourceSection");
  const step2 = document.querySelector<HTMLElement>('.step-card[data-step-index="2"]');
  collapseStepCard(step0, "已选择 " + PLATFORM_SPECS[currentPlatform].platformLabel, "success");
  collapseStepCard(step1, currentCreationMode === "import" ? "图片已导入" : "参考图已上传", "success");
  collapseStepCard(step2, "配置已完成" + (json?.meta?.count ? "，" + json.meta.count + " 张" : ""), "success");
  updateStepNav(4, [0, 1, 2, 3]);
  showStickyActionBar(actionLabel);
  scrollToStep(4);
}
function collapseStepCard(cardEl: HTMLElement | null, summaryText: string, tone = "success"): void {
  if (!cardEl || cardEl.classList.contains("collapsed")) return;

  let summary = cardEl.querySelector(".step-summary") as HTMLElement | null;
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
    (cardEl.querySelector(".step-head") as HTMLElement | null)?.appendChild(summary);
  }

  const textEl2 = cardEl.querySelector(".step-summary-text");
  if (textEl2) textEl2.textContent = summaryText || "";
  const dotEl = cardEl.querySelector(".step-summary-status");
  if (dotEl) (dotEl as HTMLElement).dataset.tone = tone;
  cardEl.classList.add("collapsed");
}
function updateStepNav(activeStep: number, completedSteps: number[] = []): void {
  const nav = byId("stepNav");
  if (!nav) return;
  const items = nav.querySelectorAll(".step-nav-item");
  items.forEach((item, idx) => {
    item.classList.remove("active", "completed");
    if (idx === activeStep) item.classList.add("active");
    else if (completedSteps.indexOf(idx) !== -1) item.classList.add("completed");
    (item as HTMLElement).onclick = () => {
      const stepIndex = parseInt((item as HTMLElement).dataset.step || "0");
      scrollToStep(stepIndex);
      items.forEach((n) => n.classList.remove("active"));
      item.classList.add("active");
    };
  });
}
function scrollToStep(stepIndex: number): void {
  let sel = `.step-card[data-step-index='${stepIndex}']`;
  if (stepIndex === 1 && currentCreationMode === "import") sel = "#importSourceSection";
  const card = document.querySelector(sel);
  if (card) scrollToElement(card, { block: "start" });
}
function showStickyActionBar(stateText: string): void {
  const bar = byId("stickyActionBar");
  const statusEl = byId("stickyStatus");
  if (!bar) return;
  if (statusEl) statusEl.textContent = stateText || "";
  bar.hidden = false;
  document.querySelector(".page")?.classList.add("has-sticky-bar");
}
function hideStickyActionBar(): void {
  const bar = byId("stickyActionBar");
  if (!bar) return;
  bar.hidden = true;
  document.querySelector(".page")?.classList.remove("has-sticky-bar");
}
function initStickyBar(): void {
  byId("stickyRegenerate")?.addEventListener("click", () => {
    if (currentCreationMode === "ai") void generatePlatformPack();
  });
  byId("stickyDownload")?.addEventListener("click", () => {
    if (lastPackResult && lastPackResult.downloadUrl) window.open(lastPackResult.downloadUrl, "_blank");
  });
  byId("stickyReset")?.addEventListener("click", () => resetAllState());
}
const ICON_SUN = '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>';
const ICON_MOON = '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';
const ICON_UPLOAD = '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>';

// 原生 file input 的外观由浏览器接管、无法跟随主题，统一替换为自定义选择器。
function initFilePickers(): void {
  const inputs = document.querySelectorAll<HTMLInputElement>('input[type="file"]');
  inputs.forEach((input) => {
    if (input.dataset.pickerReady === "true") return;
    input.dataset.pickerReady = "true";
    input.classList.add("file-native");

    const picker = document.createElement("span");
    picker.className = "file-picker";
    picker.dataset.empty = "true";

    const trigger = document.createElement("span");
    trigger.className = "file-picker-trigger";
    trigger.innerHTML = `${ICON_UPLOAD}<span>选择文件</span>`;

    const name = document.createElement("span");
    name.className = "file-picker-name";
    name.textContent = "未选择文件";

    picker.appendChild(trigger);
    picker.appendChild(name);
    input.insertAdjacentElement("afterend", picker);

    const sync = () => {
      const files = input.files;
      if (!files || files.length === 0) {
        picker.dataset.empty = "true";
        name.textContent = "未选择文件";
        name.removeAttribute("title");
        return;
      }
      picker.dataset.empty = "false";
      const label = files.length === 1 ? files[0]!.name : `已选择 ${files.length} 个文件`;
      name.textContent = label;
      name.title = label;
    };
    input.addEventListener("change", sync);
    sync();
  });
}

function setDarkModeIcon(toggle: HTMLElement, theme: string): void {
  toggle.innerHTML = theme === "dark" ? ICON_SUN : ICON_MOON;
}

function initDarkMode(): void {
  const toggle = byId("darkModeToggle");
  if (!toggle) return;
  const saved = localStorage.getItem("easysticker-theme");
  const prefersDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
  const theme = saved || (prefersDark ? "dark" : "light");
  document.documentElement.setAttribute("data-theme", theme);
  setDarkModeIcon(toggle, theme);
  const meta = byId<HTMLMetaElement>("themeMeta");
  if (meta) meta.content = theme === "dark" ? "#111827" : "#07c160";
  toggle.addEventListener("click", () => {
    const next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    localStorage.setItem("easysticker-theme", next);
    setDarkModeIcon(toggle, next);
    if (meta) meta.content = next === "dark" ? "#111827" : "#07c160";
  });
}
function initDropZone(): void {
  const dropZone = byId("dropZone");
  if (!dropZone) return;
  let dragCounter = 0;
  ["dragenter", "dragover", "dragleave", "drop"].forEach((evt) => {
    document.addEventListener(evt, (e) => { e.preventDefault(); e.stopPropagation(); }, false);
  });
  document.addEventListener("dragenter", () => {
    dragCounter++;
    if (dragCounter === 1) dropZone.classList.add("drag-active");
  }, false);
  document.addEventListener("dragleave", () => {
    dragCounter--;
    if (dragCounter === 0) dropZone.classList.remove("drag-active");
  }, false);
  document.addEventListener("drop", (e) => {
    dragCounter = 0;
    dropZone.classList.remove("drag-active");
    const files = e.dataTransfer && e.dataTransfer.files;
    if (files && files.length > 0) {
      const fileInputEl = byId<HTMLInputElement>("file");
      if (fileInputEl) {
        fileInputEl.files = files;
        fileInputEl.dispatchEvent(new Event("change", { bubbles: true }));
      }
    }
  }, false);
}
function initLightbox(): void {
  const lightbox = byId("lightbox");
  const backdrop = byId("lightboxBackdrop");
  const closeBtn = byId("lightboxClose");
  const lightboxImg = byId<HTMLImageElement>("lightboxImage");
  if (!lightbox || !backdrop || !closeBtn || !lightboxImg) return;

  document.addEventListener("click", (e) => {
    const target = (e.target as HTMLElement | null)?.closest?.(".preview-item img") as HTMLImageElement | null;
    if (!target) return;
    const src = target.getAttribute("src") || target.src;
    if (!src) return;
    lightboxImg.src = src;
    lightbox.hidden = false;
    document.body.style.overflow = "hidden";
  });

  function closeLightbox() {
    lightbox!.hidden = true;
    lightboxImg!.src = "";
    document.body.style.overflow = "";
  }
  backdrop.addEventListener("click", closeLightbox);
  closeBtn.addEventListener("click", closeLightbox);
  (lightbox as any)._close = closeLightbox;
}
function initKeyboardShortcuts(): void {
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      const lightbox = byId("lightbox") as any;
      if (lightbox && !lightbox.hidden && lightbox._close) {
        e.preventDefault();
        lightbox._close();
        return;
      }
    }
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      const active = document.activeElement as HTMLElement | null;
      if (active && (active.tagName === "TEXTAREA" || active.tagName === "INPUT")) {
        e.preventDefault();
        if (currentCreationMode === "ai") void generatePlatformPack();
      }
    }
  });
}

// ── Event listeners ─────────────────────────────────────────────────────────
function bindEvents(): void {
  fileInput.addEventListener("change", () => { if (fileInput.files?.length) void handleFileUpload(); });
  uploadForm.addEventListener("submit", (e) => e.preventDefault());
  importForm?.addEventListener("submit", async (e) => { e.preventDefault(); });

  wechatAiPrompt.addEventListener("input", () => { setFieldInvalid(wechatAiPrompt, false); syncRegenerateButton(); });
  wechatAiTitle.addEventListener("input", () => setFieldInvalid(wechatAiTitle, false));
  wechatAiAuthor.addEventListener("input", () => setFieldInvalid(wechatAiAuthor, false));
  wechatAiCount.addEventListener("change", () => { setFieldInvalid(wechatAiCount, false); setPromptHint(currentStyles); });
  wechatAiCount.addEventListener("keydown", (event) => {
    const key = event?.key;
    if (key === "ArrowUp") { event.preventDefault?.(); setCountValue(Number(wechatAiCount.value || DEFAULT_STICKER_COUNT) + 1); }
    else if (key === "ArrowDown") { event.preventDefault?.(); setCountValue(Number(wechatAiCount.value || DEFAULT_STICKER_COUNT) - 1); }
  });
  wechatAiCount.addEventListener("input", () => setCountValue(Number(wechatAiCount.value || DEFAULT_STICKER_COUNT)));
  wechatAiCountDec?.addEventListener("click", () => setCountValue(Number(wechatAiCount.value || DEFAULT_STICKER_COUNT) - 1));
  wechatAiCountInc?.addEventListener("click", () => setCountValue(Number(wechatAiCount.value || DEFAULT_STICKER_COUNT) + 1));
  wechatAiRewardEnabled.addEventListener("change", () => {
    syncRewardFields();
    setPromptHint(currentStyles);
    window._preview!.renderExtraAssets(lastPackResult?.extras ?? {}, lastPackResult ? "success" : "idle");
  });

  platformRadios.forEach((radio) => {
    radio.addEventListener("change", () => {
      const newPlatform = radio.value;
      if (newPlatform && PLATFORM_SPECS[newPlatform] && newPlatform !== currentPlatform) {
        currentPlatform = newPlatform;
        syncPlatformUI();
        if (lastPackResult) {
          resetGenerationResult({ clearPersisted: true });
          window._ui!.setNotice(`已切换到${PLATFORM_SPECS[currentPlatform].platformLabel}，请重新生成。`, "info");
        }
      }
    });
  });

  cancelGenerate?.addEventListener("click", async () => {
    try {
      await requestCancelCurrentGeneration();
      sseAbortController?.abort?.();
    } catch { /* ignore */ }
    finally { setGenerateButtonsBusy(false); }
  });

  creationModeAi?.addEventListener("change", syncCreationMode);
  creationModeImport?.addEventListener("change", syncCreationMode);

  wechatAiStyleOptions.addEventListener("focus", (event) => {
    if (event?.target === wechatAiStyleOptions) {
      const chips = Array.from(wechatAiStyleOptions.querySelectorAll(".style-chip")) as HTMLElement[];
      const firstSelected = chips.find((btn) => btn.dataset.selected === "true");
      (firstSelected || chips[0])?.focus?.();
    }
  });
  wechatAiStyleOptions.addEventListener("keydown", (event) => {
    const key = event?.key;
    const chips = Array.from(wechatAiStyleOptions.querySelectorAll(".style-chip")) as HTMLElement[];
    if (!chips.length) return;
    const currentIndex = Math.max(0, chips.findIndex((btn) => btn === document.activeElement));
    let nextIndex = currentIndex;
    if (key === "ArrowRight" || key === "ArrowDown") { event.preventDefault?.(); nextIndex = currentIndex + 1 >= chips.length ? 0 : currentIndex + 1; chips[nextIndex]?.focus?.(); }
    else if (key === "ArrowLeft" || key === "ArrowUp") { event.preventDefault?.(); nextIndex = currentIndex - 1 < 0 ? chips.length - 1 : currentIndex - 1; chips[nextIndex]?.focus?.(); }
    else if (key === "Home") { event.preventDefault?.(); chips[0]?.focus?.(); }
    else if (key === "End") { event.preventDefault?.(); chips[chips.length - 1]?.focus?.(); }
    else if (key === "Enter" || key === " ") { event.preventDefault?.(); (chips[currentIndex] as HTMLElement)?.click?.(); }
  });

  wechatAiForm.addEventListener("keydown", async (event) => {
    if (event?.ctrlKey && event?.key === "Enter") {
      event.preventDefault?.();
      if (currentCreationMode === "import") await importPlatformPack();
      else await generatePlatformPack();
    }
  });
  wechatAiProvider?.addEventListener("change", () => { if (wechatAiProvider) currentAiProvider = wechatAiProvider.value; });
  wechatAiRewardMessage.addEventListener("input", () => {
    currentRewardMessage = wechatAiRewardMessage.value.trim();
    setFieldInvalid(wechatAiRewardMessage, false);
  });
  wechatAiForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (currentCreationMode === "import") await importPlatformPack();
    else await generatePlatformPack();
  });
  regenerateSubmit.addEventListener("click", async () => {
    if (currentCreationMode !== "ai") return;
    await generatePlatformPack();
  });
  resetSubmit.addEventListener("click", () => resetAllState());
  // 阻止冒泡：清空按钮位于 #historyToggle 内，避免同时触发折叠/展开
  clearHistoryBtn?.addEventListener("click", (event) => { event.stopPropagation(); void clearPackHistory(); });

  document.addEventListener("click", (e) => {
    const target = (e.target as HTMLElement | null)?.closest?.("#historyToggle, .collapse-btn");
    if (target) toggleHistory();
  });
  // 失败卡片（贴纸 + 封面/图标/横幅/赞赏图）点击重试，兑现代占位符文案「可点击重新生成」。
  // 有明确 target 时只重生成该资源；否则（整体失败）回退为整包重生成。
  document.addEventListener("click", (e) => {
    const failedCard = (e.target as HTMLElement | null)?.closest?.('.preview-item[data-tone="error"]') as HTMLElement | null;
    if (!failedCard) return;
    e.preventDefault();
    let target: { kind: string; index?: number; key?: string } | null = null;
    const raw = failedCard.dataset.target;
    if (raw) {
      try { target = JSON.parse(raw); } catch { target = null; }
    }
    if (target) void regenerateResource(target);
    else retryFromFailedPreview();
  });
  document.addEventListener("keydown", (e) => {
    if ((e.key === "Enter" || e.key === " ") && (e.target as HTMLElement | null)?.closest) {
      const el = (e.target as HTMLElement).closest("#historyToggle, .collapse-btn");
      if (el) { e.preventDefault(); toggleHistory(); }
    }
  });

  originalPreview.addEventListener("error", () => {
    originalPreview.removeAttribute("src");
    syncOriginalPreviewSlot();
    window._ui!.setStatus(uploadState, "图片加载失败", "error");
    window._ui!.setNotice("图片加载失败，请重新上传。", "error");
  });
}

// ── Init ────────────────────────────────────────────────────────────────────
async function initApp(): Promise<void> {
  window._preview?.configure({
    setNotice: window._ui!.setNotice,
    getSpec: () => PLATFORM_SPECS[currentPlatform] as any,
    getPlatformId: () => currentPlatform,
    getDefaultStickerCount: () => DEFAULT_STICKER_COUNT,
    getPreviewSpec: () => STICKER_PREVIEW_SPEC,
    getRewardEnabled: () => currentRewardEnabled,
    getRewardMessage: () => currentRewardMessage,
    getAuthApi: () => (window._auth && window._auth.api) || fetch
  });

  try {
    const api = (window._auth && window._auth.api) || fetch;
    const configRes = await api("/api/config");
    if (configRes.ok) {
      const config: any = await configRes.json();
      const envBadge = byId("envBadge");
      if (envBadge) {
        if (config.env === "development") { envBadge.removeAttribute("hidden"); envBadge.style.display = ""; }
        else envBadge.style.display = "none";
      }

      if (config?.platforms) {
        const wc = config.platforms.wechat_stickers;
        if (wc) {
          DEFAULT_STYLE_OPTIONS = wc.styles || DEFAULT_STYLE_OPTIONS;
          const providerConfig = wc.ai || wc;
          if (providerConfig.availableProviders && wechatAiProvider) {
            wechatAiProvider.innerHTML = "";
            providerConfig.availableProviders.forEach((p: any) => {
              const option = document.createElement("option");
              option.value = p.id;
              option.textContent = p.name;
              wechatAiProvider!.appendChild(option);
            });
          }
          if (providerConfig.defaultProvider && wechatAiProvider) {
            currentAiProvider = providerConfig.defaultProvider;
            wechatAiProvider.value = currentAiProvider;
          }
        }
      } else if (config?.wechat) {
        DEFAULT_STYLE_OPTIONS = config.wechat.styles || DEFAULT_STYLE_OPTIONS;
        MIN_STICKER_COUNT = config.wechat.minStickerCount || MIN_STICKER_COUNT;
        MAX_STICKER_COUNT = config.wechat.maxStickerCount || MAX_STICKER_COUNT;
        DEFAULT_STICKER_COUNT = config.wechat.defaultStickerCount || DEFAULT_STICKER_COUNT;
        if (config.wechat.availableProviders && wechatAiProvider) {
          wechatAiProvider.innerHTML = "";
          config.wechat.availableProviders.forEach((p: any) => {
            const option = document.createElement("option");
            option.value = p.id;
            option.textContent = p.name;
            wechatAiProvider!.appendChild(option);
          });
        }
        if (config.wechat.defaultProvider && wechatAiProvider) {
          currentAiProvider = config.wechat.defaultProvider;
          wechatAiProvider.value = currentAiProvider;
        }
      }
    }
  } catch (err) {
    console.warn("Failed to load config from server, using default constants.");
  }

  initializeFieldAccessibility();
  renderStyleOptions(DEFAULT_STYLE_OPTIONS);
  syncPlatformUI();
  syncRewardFields();
  resetGenerationResult({ clearPersisted: false });
  setPromptHint(currentStyles);
  restorePersistedPackResult();
  renderPackHistory();
  void refreshPackHistory();

  updateStepNav(0, []);
  initStickyBar();
  initDarkMode();
  initDropZone();
  initFilePickers();
  initLightbox();
  initKeyboardShortcuts();
}

export function mountApp(): void {
  syncCreationMode();
  bindEvents();
  void initApp();
}
