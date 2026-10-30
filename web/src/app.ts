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
    importDesc: "已有成品图片时可直接批量导入并规范为微信 240 × 240；想继续改以前生成的包，就用当时下载的 ZIP 还原生成现场。",
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
    importDesc: "已有成品图片时可直接批量导入并规范为 Telegram 贴纸规格；想继续改以前生成的包，就用当时下载的 ZIP 还原生成现场。",
    importHint: "导入后会统一居中、等比缩放、补透明边，并转换为符合 Telegram 贴纸规格的 PNG。",
    importHeading: "导入贴纸图",
    importUploadText: "支持 PNG、JPG、WebP、GIF，导入后会统一转成 PNG；建议一次导入 1-50 张。",
    importAccept: "image/png,image/jpeg,image/webp,image/gif",
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
    importDesc: "已有成品图片时可直接批量导入并规范为 WhatsApp 贴纸规格；想继续改以前生成的包，就用当时下载的 ZIP 还原生成现场。",
    importHint: "导入后会统一居中、等比缩放、补透明边，并转换为符合 WhatsApp 贴纸规格的 WebP。",
    importHeading: "导入贴纸图",
    importUploadText: "支持 PNG、JPG、WebP、GIF，导入后会统一转成 WebP；建议一次导入 1-30 张。",
    importAccept: "image/png,image/jpeg,image/webp,image/gif",
    generateDesc: "基于上传图和提示词自动生成并打包。"
  }
};

// ── DOM elements ────────────────────────────────────────────────────────────
const uploadForm = req<HTMLFormElement>("uploadForm");
const fileInput = req<HTMLInputElement>("file");
const referencePrompt = byId<HTMLTextAreaElement>("referencePrompt");
const referenceStyle = byId<HTMLInputElement>("referenceStyle");
const referenceImageFile = byId<HTMLInputElement>("referenceImageFile");
const referenceImageHint = byId<HTMLParagraphElement>("referenceImageHint");
const referenceImagePreviewList = byId<HTMLDivElement>("referenceImagePreviewList");
const clearReferenceImageBtn = byId<HTMLButtonElement>("clearReferenceImageBtn");
const generateReferenceBtn = byId<HTMLButtonElement>("generateReferenceBtn");
const uploadState = req("uploadState");
const importForm = byId<HTMLFormElement>("importForm");
const importFiles = byId<HTMLInputElement>("importFiles");
const importCover = byId<HTMLInputElement>("importCover");
const importIcon = byId<HTMLInputElement>("importIcon");
const importBanner = byId<HTMLInputElement>("importBanner");
const importRewardGuide = byId<HTMLInputElement>("importRewardGuide");
const importRewardThanks = byId<HTMLInputElement>("importRewardThanks");
const importZip = byId<HTMLInputElement>("importZip");
const editDialog = req("editDialog");
const editDialogBackdrop = req("editDialogBackdrop");
const editDialogClose = req("editDialogClose");
const editDialogCancel = req<HTMLButtonElement>("editDialogCancel");
const editDialogSubmit = req<HTMLButtonElement>("editDialogSubmit");
const editDialogImage = req<HTMLImageElement>("editDialogImage");
const editDialogTarget = req("editDialogTarget");
const editDialogStatus = req("editDialogStatus");
const editInstruction = req<HTMLTextAreaElement>("editInstruction");
const editChips = req("editChips");
const editReference = req<HTMLInputElement>("editReference");
const editUseOriginalRef = req<HTMLInputElement>("editUseOriginalRef");
const fillDialog = byId("fillDialog");
const fillDialogBackdrop = byId("fillDialogBackdrop");
const fillDialogClose = byId("fillDialogClose");
const fillDialogCancel = byId<HTMLButtonElement>("fillDialogCancel");
const fillDialogSubmit = byId<HTMLButtonElement>("fillDialogSubmit");
const fillDialogImage = byId<HTMLImageElement>("fillDialogImage");
const fillDialogPlaceholder = byId("fillDialogPlaceholder");
const fillDialogPlaceholderText = byId("fillDialogPlaceholderText");
const fillDialogTitle = byId("fillDialogTitle");
const fillDialogDescription = byId("fillDialogDescription");
const fillDialogReferenceInfo = byId("fillDialogReferenceInfo");
const fillReferenceSelect = byId<HTMLSelectElement>("fillReferenceSelect");
const fillReferencePrev = byId<HTMLButtonElement>("fillReferencePrev");
const fillReferenceNext = byId<HTMLButtonElement>("fillReferenceNext");
const fillCount = byId<HTMLInputElement>("fillCount");
const fillCountHint = byId("fillCountHint");
const fillPrompt = byId<HTMLTextAreaElement>("fillPrompt");
const fillStyle = byId<HTMLSelectElement>("fillStyle");
const fillSourceExisting = byId<HTMLInputElement>("fillSourceExisting");
const fillSourceUpload = byId<HTMLInputElement>("fillSourceUpload");
const fillSourceHint = byId("fillSourceHint");
const fillReferenceField = byId("fillReferenceField");
const fillUploadFields = byId("fillUploadFields");
const fillUploadFile = byId<HTMLInputElement>("fillUploadFile");
const fillUploadHint = byId("fillUploadHint");
const fillUploadFileName = byId("fillUploadFileName");
const fillActionAi = byId<HTMLInputElement>("fillActionAi");
const fillActionDirect = byId<HTMLInputElement>("fillActionDirect");
const fillActionDirectOption = byId("fillActionDirectOption");
const fillActionHint = byId("fillActionHint");
const fillActionSelector = byId("fillActionSelector");
const fillAiSettingsStep = byId("fillAiSettingsStep");
const fillCountField = byId("fillCountField");
const fillPromptField = byId("fillPromptField");
const fillStyleField = byId("fillStyleField");
const fillDialogStatus = byId("fillDialogStatus");
const versionDialog = byId("versionDialog");
const versionDialogBackdrop = byId("versionDialogBackdrop");
const versionDialogClose = byId("versionDialogClose");
const versionDialogBody = byId("versionDialogBody");
const versionDialogTitle = byId("versionDialogTitle");
const versionDialogTarget = byId("versionDialogTarget");
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
const fillStickersBtn = byId<HTMLButtonElement>("fillStickersBtn");
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
const aiProviderField = byId("aiProviderField");
const promptPresetField = byId("promptPresetField");
const wechatAiPromptPreset = byId<HTMLSelectElement>("wechatAiPromptPreset");
const promptPresetPreview = byId("promptPresetPreview");
const promptModeField = byId("promptModeField");
const wechatAiPromptMode = byId<HTMLSelectElement>("wechatAiPromptMode");
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
let DEFAULT_STYLE_OPTIONS = [
  "扁平插画",
  "贴纸",
  "3D 卡通",
  "日系 Q 版",
  "像素风",
  "国潮风",
  "手绘涂鸦",
  "水彩风",
  "软萌毛绒",
  "黏土 3D",
  "极简线条",
  "复古漫画",
  "极简蜡笔涂鸦"
];
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
// AI 生成参考图时可选的底图（图生图）。第 1 张是主底图，其余作为附加参考图。
let aiReferenceImages: Array<{ assetId: string; url: string; name: string }> = [];
// 多套提示词预设：与「提示词自定义」互补，最终提示词 = 预设 + 自定义。
// 预设可携带推荐风格（style）供前端自动切选。
let promptPresets: Array<{ id: string; name: string; prompt: string; style?: string }> = [];
let currentPresetId = "";
// 自定义提示词与预设的关系：append = 追加（预设 + 自定义），override = 覆盖（仅用自定义）。
let promptMode: "append" | "override" = "append";
let hasGenerationAttempted = false;
let lastPackResult: any = null;
// 当前预览中的贴纸与扩展资源（含 *_prompt），供单资源重生成时更新。
let currentStickers: any[] = [];
let currentExtras: Record<string, any> = {};
let resourceRegenerating = false;
// 补齐时的参考图：优先使用用户选中的已有图片，不要求本包必须有上传参考图。
let fillReferenceAssetId: string | null = null;
// 上传补齐时用于预览的 object URL；关闭弹窗 / 重新选文件时必须释放。
let fillUploadObjectUrls: string[] = [];
// null = 追加主表情；否则 = 补齐某一张扩展资源（封面 / 图标 / 横幅 / 赞赏图）。
let fillDialogTarget: ResourceTarget | null = null;
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
  prompt: { key: "prompt", target: wechatAiPrompt, label: "提示词自定义", errorId: "wechatAiPromptError", baseDescribedBy: ["promptHint"] },
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
  const prompt = getEffectivePrompt();
  const title = wechatAiTitle.value.trim();
  const author = wechatAiAuthor.value.trim();
  const rewardMessage = wechatAiRewardMessage.value.trim();
  const stickerCount = Number(wechatAiCount.value || DEFAULT_STICKER_COUNT);
  const errors: Array<{ target: HTMLElement; message: string }> = [];
  const spec = PLATFORM_SPECS[currentPlatform];

  if (!prompt) errors.push({ target: wechatAiPrompt, message: "请选择提示词预设或填写自定义提示词。" });
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
  const modeText = currentPresetId
    ? (promptMode === "override" ? "自定义覆盖预设" : "自定义追加在预设后")
    : "预设 + 自定义";
  promptHint.textContent = Array.isArray(styles) && styles.length
    ? `已加载推荐风格：${styles.join("、")}。最终提示词：${modeText}，可只填其一。当前生成 ${count} 张表情${extraText}。`
    : `最终提示词：${modeText}，两者至少填一项。当前生成 ${count} 张表情${extraText}。`;
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
function populatePromptPresets(): void {
  if (promptPresetField) promptPresetField.hidden = promptPresets.length === 0;
  if (!wechatAiPromptPreset) return;
  const previous = currentPresetId;
  wechatAiPromptPreset.innerHTML = "";
  const none = document.createElement("option");
  none.value = "";
  none.textContent = "不使用预设（纯自定义）";
  wechatAiPromptPreset.appendChild(none);
  for (const preset of promptPresets) {
    const option = document.createElement("option");
    option.value = preset.id;
    option.textContent = preset.name;
    wechatAiPromptPreset.appendChild(option);
  }
  currentPresetId = promptPresets.some((p) => p.id === previous) ? previous : "";
  wechatAiPromptPreset.value = currentPresetId;
  syncPromptPresetPreview();
  syncPromptModeField();
}
/** 仅当选择预设时，才需要「追加 / 覆盖」二选一。 */
function syncPromptModeField(): void {
  if (promptModeField) promptModeField.hidden = !currentPresetId;
  if (wechatAiPromptMode) wechatAiPromptMode.value = promptMode;
}
function syncPromptPresetPreview(): void {
  if (!promptPresetPreview) return;
  const preset = promptPresets.find((p) => p.id === currentPresetId);
  promptPresetPreview.hidden = !preset;
  promptPresetPreview.textContent = preset
    ? `已选「${preset.name}」：${preset.prompt}`
    : "";
}
/** 选中预设若声明了推荐风格，自动切到该风格（须在可选列表中）。 */
function applyPresetStyle(): void {
  const style = promptPresets.find((p) => p.id === currentPresetId)?.style;
  if (!style || !availableStyles.includes(style)) return;
  if (currentStyles.length === 1 && currentStyles[0] === style) return;
  currentStyles = [style];
  renderStyleOptions(availableStyles);
  setPromptHint(currentStyles);
}
/** 提交给后端的基础提示词：按 promptMode 决定追加还是覆盖；预设与自定义可只填其一。 */
function getEffectivePrompt(): string {
  const custom = wechatAiPrompt.value.trim();
  const preset = promptPresets.find((p) => p.id === currentPresetId);
  const base = preset ? preset.prompt.trim() : "";
  // 覆盖模式：只要填了自定义，就完全忽略预设
  if (custom && promptMode === "override") return custom;
  if (base && custom) return `${base}\n${custom}`;
  return base || custom;
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
          prompt: typeof item.prompt === "string" ? item.prompt : undefined,
          style: typeof item.style === "string" ? item.style : undefined,
          emotion: typeof item.emotion === "string" ? item.emotion : undefined,
          sourceAssetId: typeof item.sourceAssetId === "string" ? item.sourceAssetId : undefined,
          editReferenceAssetId:
            typeof item.editReferenceAssetId === "string" ? item.editReferenceAssetId : undefined,
          versions: Array.isArray(item.versions) ? item.versions : undefined
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
    promptMode: raw.promptMode === "override" ? "override" : "append",
    promptPreset: typeof raw.promptPreset === "string" ? raw.promptPreset : "",
    creationMode: raw.creationMode === "ai" ? "ai" : raw.creationMode === "import" ? "import" : undefined,
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
      extras: result.extras && typeof result.extras === "object" ? result.extras : {},
      generation: result.generation && typeof result.generation === "object" ? result.generation : undefined,
      extraDetails: result.extraDetails && typeof result.extraDetails === "object" ? result.extraDetails : undefined
    }
  };
}
/**
 * 把结果写进 localStorage（不碰历史记录）。
 * 编辑图片后也要调它：否则刷新会把编辑前的图当成「上次结果」，
 * 不仅预览退回旧图，再编辑还会以旧图为源、把上一次编辑悄悄丢掉。
 */
function persistLastPackPayload(result: any): void {
  const storage = getStorage();
  if (!storage || !result?.packId || !result?.downloadUrl) return;

  const payload = {
    version: 2,
    platform: currentPlatform,
    savedAt: new Date().toISOString(),
    uploadId: currentUploadId,
    prompt: wechatAiPrompt.value,
    promptPreset: currentPresetId,
    promptMode,
    provider: currentAiProvider,
    creationMode: currentCreationMode,
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
            // 逐张的 style / emotion / sourceAssetId / editReferenceAssetId 都要留住：
            // 丢了它们，刷新后「已编辑」标记会消失，再次编辑也不再记录来源与参考图。
            .map((item: any) => ({
              label: item.label,
              url: item.url,
              assetId: typeof item.assetId === "string" ? item.assetId : undefined,
              prompt: typeof item.prompt === "string" ? item.prompt : undefined,
              style: typeof item.style === "string" ? item.style : undefined,
              emotion: typeof item.emotion === "string" ? item.emotion : undefined,
              sourceAssetId: typeof item.sourceAssetId === "string" ? item.sourceAssetId : undefined,
              editReferenceAssetId:
                typeof item.editReferenceAssetId === "string" ? item.editReferenceAssetId : undefined,
              versions: Array.isArray(item.versions) ? item.versions : undefined
            }))
        : [],
      metadataJson: typeof result.metadataJson === "string" ? result.metadataJson : undefined,
      meta: result.meta && typeof result.meta === "object" ? result.meta : {},
      // 生成上下文（含 source / providerId / 预设 / 风格 / 数量）：刷新后靠它还原创建方式等 UI
      generation: result.generation && typeof result.generation === "object" ? result.generation : undefined,
      extras: result.extras && typeof result.extras === "object" ? result.extras : {},
      // 扩展资源的历史版本不在 result.extras 里，单独带上，刷新后才能还原
      extraDetails: collectPackAssets().extraDetails
    }
  };
  try { storage.setItem(STORAGE_LAST_PACK, JSON.stringify(payload)); } catch { /* ignore */ }
}

function persistLastGeneratedResult(result: any): void {
  persistLastPackPayload(result);
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
    // 兼容旧 localStorage：补齐曾把选中的图写成整包参考图，这里一并清掉。
    if ((restored.result?.meta?.referenceMode ?? restored.result?.generation?.referenceMode) === "fill") {
      const stickerIds = new Set(
        (restored.result.stickers ?? [])
          .map((sticker: any) => (typeof sticker?.assetId === "string" ? sticker.assetId : ""))
          .filter(Boolean)
      );
      if (currentUploadId && stickerIds.has(currentUploadId)) {
        currentUploadId = null;
        restored.uploadId = null;
        if (restored.result.generation) {
          restored.result.generation.referenceAssetId = null;
          restored.result.generation.referenceMode = "none";
        }
        if (restored.result.meta) {
          restored.result.meta.referenceAssetId = null;
          restored.result.meta.referenceMode = "none";
        }
      }
    }
    if (restored.provider) currentAiProvider = restored.provider;
    currentStyles = restored.styles.length ? restored.styles : [...DEFAULT_STYLE_OPTIONS];
    currentRewardEnabled = Boolean(restored.rewardEnabled || restored.result?.meta?.rewardEnabled);
    hasGenerationAttempted = Boolean(restored.uploadId && restored.prompt && restored.hasGenerationAttempted);
    lastPackResult = restored.result;
    // 必须把资源写回模块状态，否则恢复出来的预览只是「看得见」：
    // 单资源重生成、编辑图片都会因为 currentStickers 为空而静默失效。
    syncStateFromResult(restored.result, { creationMode: restored.creationMode });

    wechatAiPrompt.value = restored.prompt;
    currentPresetId = typeof restored.promptPreset === "string" ? restored.promptPreset : "";
    promptMode = restored.promptMode === "override" ? "override" : "append";
    if (wechatAiPromptPreset) wechatAiPromptPreset.value = currentPresetId;
    syncPromptPresetPreview();
    syncPromptModeField();
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
/**
 * 写入/更新历史记录。
 * `replacePackId` 用于单资源重生成与编辑图片：那是同一个作品的下一版，
 * 包 ID 会变（每次重建都会新建包），但历史记录只该留最新那条。
 */
function addToPackHistory(result: any, replacePackId?: string): void {
  if (!result?.packId || !result?.downloadUrl) return;
  let history = getPackHistory();
  if (replacePackId && replacePackId !== result.packId) {
    history = history.filter((h) => h.packId !== replacePackId);
  }
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
    // 创建方式由 renderCompletedPackResult → syncStateFromResult 按 generation.source 还原，
    // 这里不再硬编码为导入。

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
  // 没有参考图也能重试：整包生成已支持纯文生图，单张重生成会回退到包内已有图片。
  return currentCreationMode === "ai" && Boolean(getEffectivePrompt() && hasGenerationAttempted);
}
/** 「补齐」属于表情主图资源组，只在有主图且未达上限时显示。 */
function syncFillStickersButton(): void {
  if (!fillStickersBtn) return;
  const available = canFill();
  fillStickersBtn.hidden = !available;
  fillStickersBtn.disabled = !available || resourceRegenerating;
}

function syncRegenerateButton(): void {
  syncFillStickersButton();
  // 生成 / 补齐进行中时保留 setBusy 写入的文案，避免被这里的静态标签覆盖。
  if (generateSubmit.disabled || resourceRegenerating) {
    regenerateSubmit.disabled = true;
    return;
  }
  // 「重新生成」只用于 AI 模式下整包重做；导入模式的主图补齐入口在预览区。
  regenerateSubmit.hidden = currentCreationMode !== "ai";
  if (currentCreationMode === "ai") {
    window._ui!.setButtonLabel(regenerateSubmit, "重新生成");
    regenerateSubmit.disabled = !canRegenerate();
  }
}
// 点击生成失败的预览卡片时重试：行为与「开始生成 / 重新生成 / 导入并打包」一致。
function retryFromFailedPreview(): void {
  if (currentCreationMode === "import") {
    void importPlatformPack();
    return;
  }
  if (!canRegenerate()) {
    window._ui!.setNotice("请先补充提示词，再重新生成。", "info");
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

/** 当前可用的 AI 参考图：原包参考图 → 指定资源 → 包内第 1 张。 */
function getAiReferenceAssetId(target?: ResourceTarget): string | null {
  if (currentUploadId) return currentUploadId;
  if (target) {
    const id = resourceAssetId(target);
    if (id) return id;
  }
  return currentStickers[0]?.assetId ?? null;
}

/** 导入 / 已生成过内容的包是否还能继续补齐。 */
function canFill(): boolean {
  return currentStickers.length > 0 && currentStickers.length < MAX_STICKER_COUNT;
}

/** 汇总当前预览中已有的资源（含生成上下文），用于重新打包。 */
function collectPackAssets(): {
  assets: Array<{
    label: string;
    assetId: string;
    role: string;
    prompt?: string;
    style?: string;
    emotion?: string;
    sourceAssetId?: string;
    editReferenceAssetId?: string;
    versions?: any[];
  }>;
  extras: Record<string, string>;
  extraDetails: Record<
    string,
    { prompt?: string; style?: string; sourceAssetId?: string; editReferenceAssetId?: string; versions?: any[] }
  >;
} {
  const assets = currentStickers
    .filter((s) => s && s.assetId)
    .map((s, i) => ({
      label: String(s.label ?? i + 1).padStart(3, "0"),
      assetId: s.assetId as string,
      role: "sticker",
      ...(s.prompt ? { prompt: s.prompt } : {}),
      ...(s.style ? { style: s.style } : {}),
      ...(s.emotion ? { emotion: s.emotion } : {}),
      ...(s.sourceAssetId ? { sourceAssetId: s.sourceAssetId } : {}),
      ...(s.editReferenceAssetId ? { editReferenceAssetId: s.editReferenceAssetId } : {}),
      ...(Array.isArray(s.versions) && s.versions.length ? { versions: s.versions } : {})
    }));
  const extras: Record<string, string> = {};
  const extraDetails: Record<
    string,
    { prompt?: string; style?: string; sourceAssetId?: string; editReferenceAssetId?: string; versions?: any[] }
  > = {};
  for (const key of EXTRA_ASSET_KEYS) {
    const id = currentExtras[key];
    if (typeof id === "string" && id) extras[key] = id;
    const detail: { prompt?: string; style?: string; sourceAssetId?: string; editReferenceAssetId?: string; versions?: any[] } = {};
    if (currentExtras[`${key}_prompt`]) detail.prompt = currentExtras[`${key}_prompt`];
    if (currentExtras[`${key}_style`]) detail.style = currentExtras[`${key}_style`];
    if (currentExtras[`${key}_sourceAssetId`]) detail.sourceAssetId = currentExtras[`${key}_sourceAssetId`];
    if (currentExtras[`${key}_editReferenceAssetId`]) {
      detail.editReferenceAssetId = currentExtras[`${key}_editReferenceAssetId`];
    }
    if (Array.isArray(currentExtras[`${key}_versions`]) && currentExtras[`${key}_versions`].length) {
      detail.versions = currentExtras[`${key}_versions`];
    }
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
    // 带上原 packId：让服务端原地更新这一条历史，而不是每次编辑都新建一个包
    if (lastPackResult?.packId) body.packId = lastPackResult.packId;
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
      downloadFilename: res.downloadFilename,
      ...(typeof res.metadataJson === "string" ? { metadataJson: res.metadataJson } : {})
    };
    window._preview!.renderDownload(res.packId, res.downloadUrl, res.downloadFilename);
  } catch {
    // 重新打包失败不影响单资源结果的展示
  }
}

type ResourceTarget = { kind: string; index?: number; key?: string };

const EXTRA_TITLE_BY_KEY: Record<string, string> = {
  coverAssetId: "封面图",
  iconAssetId: "图标",
  bannerAssetId: "横幅",
  rewardGuideAssetId: "赞赏引导图",
  rewardThanksAssetId: "赞赏答谢图"
};

/** 编辑时用的基础提示词：优先用表单里的，其次回退到包里记录的原始提示词。 */
function resolveBasePrompt(): string {
  const typed = getEffectivePrompt();
  if (typed) return typed;
  const stored = lastPackResult?.generation?.prompt;
  return typeof stored === "string" && stored.trim() ? stored.trim() : "";
}

function resourceLabel(target: ResourceTarget): string {
  if (target.kind === "sticker") return `第 ${(target.index ?? 0) + 1} 张表情`;
  return (target.key && EXTRA_TITLE_BY_KEY[target.key]) || "该资源";
}

/** 该资源当前的 assetId —— 编辑图片要拿它当参考图。 */
function resourceAssetId(target: ResourceTarget): string | null {
  if (target.kind === "sticker" && typeof target.index === "number") {
    return currentStickers[target.index]?.assetId ?? null;
  }
  if (target.key) return currentExtras[target.key] ?? null;
  return null;
}

/** 追加一个新的历史版本；若无历史则先用当前图补一条「初版」。 */
function buildNextVersions(
  existing: { assetId?: string; prompt?: string; style?: string; emotion?: string; versions?: any[] } | undefined,
  res: any,
  kind: "generate" | "fill" | "upload" | "edit" | "regenerate",
  instruction?: string
): any[] {
  const versions =
    Array.isArray(existing?.versions) && existing.versions.length
      ? [...existing.versions]
      : existing?.assetId
        ? [
            {
              assetId: existing.assetId,
              createdAt: lastPackResult?.generation?.createdAt ?? new Date().toISOString(),
              kind: "generate" as const,
              ...(existing.prompt ? { prompt: existing.prompt } : {}),
              ...(existing.style ? { style: existing.style } : {}),
              ...(existing.emotion ? { emotion: existing.emotion } : {})
            }
          ]
        : [];
  versions.push({
    assetId: res.assetId,
    createdAt: typeof res.createdAt === "string" ? res.createdAt : new Date().toISOString(),
    kind,
    ...(instruction ? { instruction } : {}),
    ...(res.prompt ? { prompt: res.prompt } : {}),
    ...(res.style ? { style: res.style } : {}),
    ...(res.emotion ? { emotion: res.emotion } : {})
  });
  // 与服务端 `packFileVersionSchema` 的 max(50) 对齐，避免编辑太多次后重建被打 400
  return versions.slice(-50);
}

/** 把单资源生成的结果写回预览状态。 */
function applyResourceResult(
  target: ResourceTarget,
  res: any,
  meta: { kind: "generate" | "fill" | "upload" | "edit" | "regenerate"; instruction?: string } = { kind: "regenerate" }
): void {
  const url = res.url || `/api/assets/${res.assetId}`;
  if (target.kind === "sticker" && typeof target.index === "number") {
    const index = target.index;
    const existing = currentStickers[index];
    // index === 当前长度说明这是「补齐」追加的新图，而不是替换已有图。
    const isAppend = !existing && index === currentStickers.length;
    if (!existing && !isAppend) return;
    const versions = buildNextVersions(existing, res, meta.kind, meta.instruction);
    currentStickers[index] = {
      ...(existing ?? {}),
      label: res.label ?? existing?.label ?? String(index + 1).padStart(3, "0"),
      assetId: res.assetId,
      url,
      prompt: res.prompt,
      // 补齐时用户可能明确选择「不使用风格」，此时不能沿用上一版的 style。
      style: meta.kind === "fill" || meta.kind === "upload" ? res.style : (res.style ?? existing?.style),
      emotion: meta.kind === "upload" ? res.emotion : (res.emotion ?? existing?.emotion),
      versions,
      ...(res.sourceAssetId ? { sourceAssetId: res.sourceAssetId } : {}),
      ...(res.editReferenceAssetId ? { editReferenceAssetId: res.editReferenceAssetId } : {})
    };
    // 上传成品图是整张替换，旧的「编辑来源 / 附加参考图」不再适用于新图。
    if (meta.kind === "upload") {
      delete currentStickers[index].sourceAssetId;
      delete currentStickers[index].editReferenceAssetId;
    }
    // lastPackResult 也要同步，否则「刷新后恢复」与「重建 ZIP」读到的还是旧图
    if (!lastPackResult?.stickers) lastPackResult = { ...(lastPackResult ?? {}), stickers: [] };
    if (lastPackResult?.stickers) {
      lastPackResult.stickers[index] = {
        ...(lastPackResult.stickers[index] ?? {}),
        label: currentStickers[index].label,
        assetId: currentStickers[index].assetId,
        url: currentStickers[index].url,
        prompt: currentStickers[index].prompt,
        style: currentStickers[index].style,
        emotion: currentStickers[index].emotion,
        versions,
        sourceAssetId: currentStickers[index].sourceAssetId,
        editReferenceAssetId: currentStickers[index].editReferenceAssetId
      };
    }
    // 定点替换这一张。整组重建会让 20+ 张图重新请求与解码，
    // 实测多出一次网络往返并产生 100ms+ 长任务，这里只换一个节点。
    if (!window._preview!.updatePreviewCard(index, currentStickers[index], "success")) {
      if (isAppend) {
        // renderPreview 只追加缺失的卡片，不会重绘已有图片。
        window._preview!.renderPreview(currentStickers, "success");
      } else {
        // 兜底：卡片已经被重建过（比如换平台），退化为整组渲染
        wechatAiPreview.innerHTML = "";
        window._preview!.renderPreview(currentStickers, "success");
      }
    }
    return;
  }
  if (target.key) {
    const key = target.key;
    const existing = {
      assetId: currentExtras[key],
      prompt: currentExtras[`${key}_prompt`],
      style: currentExtras[`${key}_style`],
      versions: currentExtras[`${key}_versions`]
    };
    const versions = buildNextVersions(existing, res, meta.kind, meta.instruction);
    currentExtras[key] = res.assetId;
    if (meta.kind === "upload") {
      // 上传成品图与旧的生成上下文无关，清掉避免 metadata 里留下误导信息。
      delete currentExtras[`${key}_prompt`];
      delete currentExtras[`${key}_style`];
      delete currentExtras[`${key}_sourceAssetId`];
      delete currentExtras[`${key}_editReferenceAssetId`];
    } else {
      currentExtras[`${key}_prompt`] = res.prompt;
      if (meta.kind === "fill" && !res.style) delete currentExtras[`${key}_style`];
      else if (res.style) currentExtras[`${key}_style`] = res.style;
      if (res.sourceAssetId) currentExtras[`${key}_sourceAssetId`] = res.sourceAssetId;
      if (res.editReferenceAssetId) currentExtras[`${key}_editReferenceAssetId`] = res.editReferenceAssetId;
    }
    currentExtras[`${key}_versions`] = versions;
    delete currentExtras[`${key}_error`];
    if (lastPackResult?.extras) {
      lastPackResult.extras = { ...lastPackResult.extras, [key]: res.assetId };
    }
    if (!window._preview!.updateExtraAsset(target.key, currentExtras, "success")) {
      window._preview!.renderExtraAssets(currentExtras, "success");
    }
  }
}

/** 单资源生成的公共部分：请求 → 写回状态 → 重建 ZIP。 */
async function runSingleResource(
  target: ResourceTarget,
  options: {
    mode: "regenerate" | "edit";
    instruction?: string;
    sourceAssetId?: string;
    editReferenceAssetId?: string;
  }
): Promise<void> {
  const res = await requestJson("/api/generate/resource", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      presetId: currentPlatform,
      referenceAssetId: getAiReferenceAssetId(target) ?? undefined,
      prompt: resolveBasePrompt(),
      promptPreset: currentPresetId || undefined,
      provider: wechatAiProvider ? wechatAiProvider.value : undefined,
      styles: currentStyles.length ? currentStyles : undefined,
      stickerCount: Number(wechatAiCount.value || DEFAULT_STICKER_COUNT),
      metadata: getMetadataPayload(),
      target,
      mode: options.mode,
      ...(options.sourceAssetId ? { sourceAssetId: options.sourceAssetId } : {}),
      ...(options.instruction ? { instruction: options.instruction } : {}),
      ...(options.editReferenceAssetId ? { editReferenceAssetId: options.editReferenceAssetId } : {})
    })
  });
  applyResourceResult(target, res, {
    kind: options.mode === "edit" ? "edit" : "regenerate",
    instruction: options.instruction
  });
  const previousPackId = lastPackResult?.packId;
  if (lastPackResult) await rebuildPackFromState();
  // 同步本地持久化：刷新后预览要是编辑后的图，历史记录也要指向最新那个包
  if (lastPackResult) {
    persistLastPackPayload(lastPackResult);
    addToPackHistory(lastPackResult, previousPackId);
  }
}

// ── 历史版本：查看与回退 ────────────────────────────────────────────────

const VERSION_KIND_LABEL: Record<string, string> = {
  generate: "初版",
  fill: "AI 补齐",
  upload: "上传补齐",
  edit: "编辑",
  regenerate: "重新生成",
  restore: "回退"
};

let versionTarget: ResourceTarget | null = null;

/** 读取某个资源当前的历史版本列表（贴纸走 currentStickers，扩展资源走 currentExtras）。 */
function getResourceVersions(target: ResourceTarget): any[] {
  if (target.kind === "sticker" && typeof target.index === "number") {
    const versions = currentStickers[target.index]?.versions;
    return Array.isArray(versions) ? versions : [];
  }
  if (target.key) {
    const versions = currentExtras[`${target.key}_versions`];
    return Array.isArray(versions) ? versions : [];
  }
  return [];
}

function renderVersionDialog(): void {
  if (!versionDialogBody || !versionTarget) return;
  const versions = getResourceVersions(versionTarget);
  const currentId = resourceAssetId(versionTarget);
  versionDialogBody.innerHTML = "";

  versions
    .slice()
    .reverse()
    .forEach((version, revIndex) => {
      const index = versions.length - 1 - revIndex;
      const isCurrent = version.assetId === currentId;
      const item = document.createElement("div");
      item.className = `version-item${isCurrent ? " version-item-current" : ""}`;

      const link = document.createElement("a");
      link.className = "version-thumb-link";
      link.href = window._preview!.buildAssetUrl(version.assetId);
      link.target = "_blank";
      link.rel = "noopener";
      link.title = "点击查看原图";
      const img = document.createElement("img");
      img.className = "version-thumb";
      img.src = window._preview!.buildAssetUrl(version.assetId);
      img.alt = `v${index + 1}`;
      img.loading = "lazy";
      link.appendChild(img);

      const meta = document.createElement("div");
      meta.className = "version-meta";
      const title = document.createElement("div");
      title.className = "version-title";
      title.textContent = `v${index + 1} · ${VERSION_KIND_LABEL[version.kind] ?? version.kind}`;
      if (isCurrent) {
        const tag = document.createElement("span");
        tag.className = "version-current-tag";
        tag.textContent = "当前";
        title.appendChild(tag);
      }
      const time = document.createElement("div");
      time.className = "version-time";
      time.textContent = version.createdAt ? new Date(version.createdAt).toLocaleString() : "";
      meta.appendChild(title);
      meta.appendChild(time);
      if (version.instruction) {
        const instr = document.createElement("div");
        instr.className = "version-instruction";
        instr.textContent = `修改要求：${version.instruction}`;
        meta.appendChild(instr);
      }

      const actions = document.createElement("div");
      actions.className = "version-actions";
      if (!isCurrent) {
        const restore = document.createElement("button");
        restore.type = "button";
        restore.className = "secondary btn-sm";
        restore.textContent = "恢复该版本";
        restore.addEventListener("click", () => void restoreResourceVersion(versionTarget!, version.assetId));
        actions.appendChild(restore);
      }

      item.appendChild(link);
      item.appendChild(meta);
      item.appendChild(actions);
      versionDialogBody.appendChild(item);
    });
}

function openVersionDialog(target: ResourceTarget): void {
  const versions = getResourceVersions(target);
  if (versions.length <= 1) {
    window._ui!.setNotice("这一张还没有历史版本，编辑一次后就能查看。", "info");
    return;
  }
  versionTarget = target;
  if (versionDialogTitle) versionDialogTitle.textContent = `${resourceLabel(target)} · 历史版本`;
  if (versionDialogTarget) {
    versionDialogTarget.textContent = `共 ${versions.length} 个版本（最新在前），可查看原图或恢复某一版。`;
  }
  renderVersionDialog();
  if (versionDialog) {
    versionDialog.style.visibility = "hidden";
    versionDialog.hidden = false;
    void versionDialog.offsetHeight;
    versionDialog.style.visibility = "";
  }
}

function closeVersionDialog(): void {
  if (versionDialog) versionDialog.hidden = true;
  versionTarget = null;
}

/** 回退到某个历史版本：只移动「当前指针」，不改图片、不新增版本。 */
async function restoreResourceVersion(target: ResourceTarget, versionAssetId: string): Promise<void> {
  const versions = getResourceVersions(target);
  const version = versions.find((v) => v.assetId === versionAssetId);
  if (!version) return;
  const url = window._preview!.buildAssetUrl(versionAssetId);

  if (target.kind === "sticker" && typeof target.index === "number") {
    const index = target.index;
    const existing = currentStickers[index];
    if (!existing) return;
    currentStickers[index] = {
      ...existing,
      assetId: version.assetId,
      url,
      ...(version.prompt ? { prompt: version.prompt } : {}),
      ...(version.style ? { style: version.style } : {}),
      ...(version.emotion ? { emotion: version.emotion } : {})
    };
    if (lastPackResult?.stickers?.[index]) {
      lastPackResult.stickers[index] = {
        ...lastPackResult.stickers[index],
        assetId: version.assetId,
        url,
        ...(version.prompt ? { prompt: version.prompt } : {}),
        ...(version.style ? { style: version.style } : {}),
        ...(version.emotion ? { emotion: version.emotion } : {})
      };
    }
    if (!window._preview!.updatePreviewCard(index, currentStickers[index], "success")) {
      wechatAiPreview.innerHTML = "";
      window._preview!.renderPreview(currentStickers, "success");
    }
  } else if (target.key) {
    const key = target.key;
    currentExtras[key] = version.assetId;
    if (version.prompt) currentExtras[`${key}_prompt`] = version.prompt;
    if (version.style) currentExtras[`${key}_style`] = version.style;
    delete currentExtras[`${key}_error`];
    if (lastPackResult?.extras) {
      lastPackResult.extras = { ...lastPackResult.extras, [key]: version.assetId };
    }
    if (!window._preview!.updateExtraAsset(key, currentExtras, "success")) {
      window._preview!.renderExtraAssets(currentExtras, "success");
    }
  }

  closeVersionDialog();
  const previousPackId = lastPackResult?.packId;
  if (lastPackResult) await rebuildPackFromState();
  if (lastPackResult) {
    persistLastPackPayload(lastPackResult);
    addToPackHistory(lastPackResult, previousPackId);
  }
  window._ui!.setNotice(`已恢复到所选历史版本（${resourceLabel(target)}）。`, "success");
}

function mountVersionDialog(): void {
  versionDialogBackdrop?.addEventListener("click", closeVersionDialog);
  versionDialogClose?.addEventListener("click", closeVersionDialog);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && versionDialog && !versionDialog.hidden) closeVersionDialog();
  });
}

/** 把一张本地图片上传成 asset，用作附加参考图。 */
async function uploadReferenceFile(file: File): Promise<string> {
  const form = new FormData();
  form.append("file", file);
  const json = await requestJson("/api/uploads", { method: "POST", body: form });
  if (!json?.uploadId) throw new Error("参考图上传失败，请重试。");
  return json.uploadId as string;
}

/** 只重生成失败的那一张资源（贴纸或扩展图），不重跑整包。 */
async function regenerateResource(target: ResourceTarget): Promise<void> {
  if (resourceRegenerating) return;
  if (!resolveBasePrompt()) {
    window._ui!.setNotice("请先补充提示词，再重新生成。", "error");
    return;
  }
  const label = resourceLabel(target);
  resourceRegenerating = true;
  window._ui!.setNotice(`正在重新生成${label}...`, "info");
  try {
    await runSingleResource(target, { mode: "regenerate" });
    window._ui!.setNotice(`${label}已重新生成。`, "success");
  } catch (error) {
    window._ui!.setNotice(error instanceof Error ? error.message : "重新生成失败，请稍后重试。", "error");
  } finally {
    resourceRegenerating = false;
  }
}

/** 扩展资源 key → generation.include 字段。 */
function extraIncludeField(key: string): "cover" | "icon" | "banner" | "reward" | null {
  if (key === "coverAssetId") return "cover";
  if (key === "iconAssetId") return "icon";
  if (key === "bannerAssetId") return "banner";
  if (key === "rewardGuideAssetId" || key === "rewardThanksAssetId") return "reward";
  return null;
}

/** 删除资源后统一重建当前包，并同步本地持久化 / 历史记录。 */
async function finalizeAfterResourceDeletion(): Promise<void> {
  if (!lastPackResult) return;
  const previousPackId = lastPackResult.packId;
  await rebuildPackFromState();
  persistLastPackPayload(lastPackResult);
  addToPackHistory(lastPackResult, previousPackId);
  window._preview!.renderExportInfo(lastPackResult);
  window._preview!.renderMetadataPreview(lastPackResult);
}

/**
 * 从当前表情包里删除一张资源。
 *
 * 只移动清单指针，不立即删磁盘文件；素材被移出包后由常规 GC 回收。
 * 这样用户可以反复筛选，误删的图也还能通过历史版本 / 补齐找回。
 */
async function deleteResource(target: ResourceTarget): Promise<void> {
  if (resourceRegenerating || generateSubmit.disabled) return;

  if (target.kind === "sticker" && typeof target.index === "number") {
    if (currentStickers.length <= 1) {
      window._ui!.setNotice("至少保留 1 张主表情；如需全部重来，请使用「一键重置」。", "info");
      return;
    }
    const index = target.index;
    const removed = currentStickers[index];
    if (!removed?.assetId) return;
    const label = resourceLabel(target);
    if (!window.confirm(`确定删除${label}？\n\n删除后会从当前表情包移除，可稍后用补齐重新生成或上传成品图。`)) return;

    resourceRegenerating = true;
    try {
      const removedAssetId = removed.assetId;
      currentStickers.splice(index, 1);
      if (Array.isArray(lastPackResult?.stickers)) lastPackResult.stickers.splice(index, 1);
      // 重新编号，保证下载 ZIP 与 metadata 中的主图序号连续。
      currentStickers.forEach((sticker, i) => {
        sticker.label = String(i + 1).padStart(3, "0");
      });
      if (Array.isArray(lastPackResult?.stickers)) {
        lastPackResult.stickers.forEach((sticker: any, i: number) => {
          if (sticker) sticker.label = String(i + 1).padStart(3, "0");
        });
      }
      if (lastPackResult?.meta) lastPackResult.meta.count = currentStickers.length;

      // 如果删掉的正好是本包参考图，换用剩余第一张，避免 ZIP 里继续带着被删的图。
      if (currentUploadId === removedAssetId) {
        currentUploadId = currentStickers[0]?.assetId ?? null;
        if (currentUploadId) {
          originalPreview.src = window._preview!.buildAssetUrl(currentUploadId);
        } else {
          originalPreview.removeAttribute("src");
        }
        syncOriginalPreviewSlot();
        if (lastPackResult?.generation) lastPackResult.generation.referenceAssetId = currentUploadId;
        if (lastPackResult?.meta) lastPackResult.meta.referenceAssetId = currentUploadId;
      }

      // 索引会整体前移，卡片上的 data-target 也必须重建。
      wechatAiPreview.innerHTML = "";
      window._preview!.renderPreview(currentStickers, "success");
      await finalizeAfterResourceDeletion();

      if (currentStickers.length < MIN_STICKER_COUNT) {
        window._ui!.setNotice(
          `已删除${label}，当前 ${currentStickers.length} 张，低于平台最低 ${MIN_STICKER_COUNT} 张，可用补齐补足。`,
          "info"
        );
      } else {
        window._ui!.setNotice(`已删除${label}，当前共 ${currentStickers.length} 张。`, "success");
      }
    } catch (error) {
      window._ui!.setNotice(error instanceof Error ? error.message : "删除失败，请稍后重试。", "error");
    } finally {
      resourceRegenerating = false;
      syncRegenerateButton();
    }
    return;
  }

  if (target.kind === "extra" && target.key) {
    const key = target.key;
    if (!currentExtras[key]) return;
    const label = resourceLabel(target);
    if (!window.confirm(`确定删除${label}？\n\n删除后会从当前表情包移除，可稍后点击空白卡片重新补齐。`)) return;

    resourceRegenerating = true;
    try {
      delete currentExtras[key];
      for (const suffix of ["prompt", "style", "sourceAssetId", "editReferenceAssetId", "versions", "error"]) {
        delete currentExtras[`${key}_${suffix}`];
      }
      if (lastPackResult?.extras) delete lastPackResult.extras[key];
      const role = EXTRA_ROLE_BY_KEY[key];
      if (role && lastPackResult?.extraDetails) delete lastPackResult.extraDetails[role];

      const includeField = extraIncludeField(key);
      const hasRewardAsset = Boolean(currentExtras.rewardGuideAssetId || currentExtras.rewardThanksAssetId);
      if (includeField && lastPackResult?.generation) {
        lastPackResult.generation.include = {
          ...(lastPackResult.generation.include ?? {}),
          [includeField]: includeField === "reward" ? hasRewardAsset : false
        };
      }
      if (includeField === "reward" && lastPackResult?.meta && !hasRewardAsset) {
        lastPackResult.meta.rewardEnabled = false;
        currentRewardEnabled = false;
        wechatAiRewardEnabled.checked = false;
        syncRewardFields();
      }

      window._preview!.renderExtraAssets(currentExtras, "success");
      await finalizeAfterResourceDeletion();
      window._ui!.setNotice(`已删除${label}，可点击空白卡片重新补齐。`, "success");
    } catch (error) {
      window._ui!.setNotice(error instanceof Error ? error.message : "删除失败，请稍后重试。", "error");
    } finally {
      resourceRegenerating = false;
      syncRegenerateButton();
    }
  }
}

// ── 编辑图片：在某一张图的基础上继续改 ────────────────────────────────────
let editTarget: ResourceTarget | null = null;
let editSourceAssetId: string | null = null;

const EDIT_INSTRUCTION_CHIPS = [
  "背景换成纯色",
  "表情更夸张一点",
  "线条加粗",
  "加一顶帽子",
  "换成冬季服装",
  "加上节日元素"
];

function renderEditChips(): void {
  if (!editChips) return;
  editChips.innerHTML = "";
  for (const text of EDIT_INSTRUCTION_CHIPS) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "edit-chip";
    chip.textContent = text;
    chip.addEventListener("click", () => {
      // 追加而不是覆盖，方便组合多条要求
      const current = editInstruction.value.trim();
      editInstruction.value = current ? `${current}，${text}` : text;
      editInstruction.focus();
    });
    editChips.appendChild(chip);
  }
}

function openEditDialog(target: ResourceTarget): void {
  if (resourceRegenerating) return;
  const assetId = resourceAssetId(target);
  if (!assetId) return;

  editTarget = target;
  editSourceAssetId = assetId;
  if (editDialogImage) editDialogImage.src = window._preview!.buildAssetUrl(assetId);
  if (editDialogTarget) editDialogTarget.textContent = `${resourceLabel(target)} · 当前版本`;
  editInstruction.value = "";
  editReference.value = "";
  editReference.dispatchEvent(new Event("change"));
  // 导入包里通常没有「上传的原始参考图」；此时编辑仍以当前图为准，
  // 只是不能再勾选原始参考图。
  editUseOriginalRef.checked = false;
  editUseOriginalRef.disabled = !currentUploadId;
  if (editDialogStatus) editDialogStatus.textContent = "";
  renderEditChips();
  editDialog.hidden = false;
  editInstruction.focus();
}

function closeEditDialog(): void {
  editDialog.hidden = true;
  editTarget = null;
  editSourceAssetId = null;
  if (editDialogStatus) editDialogStatus.textContent = "";
}

async function submitEditDialog(): Promise<void> {
  if (!editTarget || !editSourceAssetId) return;
  const instruction = editInstruction.value.trim();
  if (!instruction) {
    if (editDialogStatus) editDialogStatus.textContent = "请先填写修改要求。";
    editInstruction.focus();
    return;
  }

  const target = editTarget;
  const sourceAssetId = editSourceAssetId;
  const label = resourceLabel(target);
  const submitLabel = editDialogSubmit.textContent || "生成新版本";
  editDialogSubmit.disabled = true;
  editDialogSubmit.textContent = "生成中…";
  resourceRegenerating = true;
  try {
    // 可选：再给模型一张参考图（优先用用户新选的图，否则用本包的原始参考图）
    let editReferenceAssetId: string | undefined;
    const extraFile = editReference.files?.[0];
    if (extraFile) {
      if (editDialogStatus) editDialogStatus.textContent = "正在上传附加参考图…";
      editReferenceAssetId = await uploadReferenceFile(extraFile);
    } else if (editUseOriginalRef.checked && currentUploadId) {
      editReferenceAssetId = currentUploadId;
    }

    if (editDialogStatus) {
      // 生图本身要几秒到十几秒，明确告诉用户可以关掉窗口去忙别的：
      // 请求不会被中断，这一张会在完成后自动更新。
      editDialogStatus.textContent = editReferenceAssetId
        ? "正在生成新版本（含附加参考图）… 可以关掉本窗口，完成后会自动更新这一张。"
        : "正在生成新版本… 可以关掉本窗口，完成后会自动更新这一张。";
    }
    await runSingleResource(target, { mode: "edit", instruction, sourceAssetId, editReferenceAssetId });
    closeEditDialog();
    window._ui!.setNotice(`${label}已更新为编辑后的新版本。`, "success");
  } catch (error) {
    if (editDialogStatus) {
      editDialogStatus.textContent = error instanceof Error ? error.message : "生成失败，请稍后重试。";
    }
  } finally {
    editDialogSubmit.disabled = false;
    editDialogSubmit.textContent = submitLabel;
    resourceRegenerating = false;
  }
}

/**
 * 首次打开弹窗会有一次性的样式/合成开销（实测 80~120ms 的长任务，
 * 之后每次打开都是 0）。挂载后在空闲时「空跑」一次，把这份开销挪到用户点击之前。
 */
function warmUpEditDialog(): void {
  const run = () => {
    if (!editDialog.hidden) return; // 用户已经打开了，别打扰
    editDialog.style.visibility = "hidden";
    editDialog.hidden = false;
    void editDialog.offsetHeight; // 逼浏览器完成一次样式 + 布局 + 合成
    editDialog.hidden = true;
    editDialog.style.visibility = "";
  };
  const idle = (window as any).requestIdleCallback;
  if (typeof idle === "function") idle(run, { timeout: 2000 });
  else window.setTimeout(run, 1000);
}

/** 从卡片上的 data-target 解析出资源目标。 */
function targetFromCard(el: HTMLElement | null): ResourceTarget | null {
  const card = el?.closest?.(".preview-item") as HTMLElement | null;
  const raw = card?.dataset.target;
  if (!raw) return null;
  try {
    return JSON.parse(raw) as ResourceTarget;
  } catch {
    return null;
  }
}

function mountEditDialog(): void {
  editDialogBackdrop?.addEventListener("click", closeEditDialog);
  editDialogClose?.addEventListener("click", closeEditDialog);
  editDialogCancel?.addEventListener("click", closeEditDialog);
  editDialogSubmit?.addEventListener("click", () => void submitEditDialog());
  editReference?.addEventListener("change", () => {
    const picked = Boolean(editReference.files?.length);
    // 两者都指同一条 editReferenceAssetId，同时选会让人困惑 —— 选了图就以图为准
    editUseOriginalRef.disabled = picked;
    if (picked) editUseOriginalRef.checked = false;
  });
  editInstruction?.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      void submitEditDialog();
    }
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && editDialog && !editDialog.hidden) closeEditDialog();
  });
}

// ── 补齐：统一流程（选择图片来源 → 选择处理方式） ─────────────────────
type FillSource = "existing" | "upload";
type FillAction = "ai" | "direct";

function getFillSource(): FillSource {
  return fillSourceUpload?.checked ? "upload" : "existing";
}

function getFillAction(): FillAction {
  return fillActionDirect?.checked ? "direct" : "ai";
}

/** 当前弹窗是否针对单张资源（空白扩展图 / 替换已有图片）。 */
function fillTargetIsSingle(): boolean {
  const target = fillDialogTarget;
  if (!target) return false;
  if (target.kind === "extra" && target.key) return true;
  return Boolean(
    target.kind === "sticker" &&
      typeof target.index === "number" &&
      target.index >= 0 &&
      target.index < currentStickers.length
  );
}

/** 上传成品图时按目标资源选择规范化规格。 */
function fillUploadRole(): string {
  const target = fillDialogTarget;
  if (target?.kind === "extra" && target.key) {
    return EXTRA_ROLE_BY_KEY[target.key] ?? "sticker";
  }
  return "sticker";
}

function fillReferenceCandidates(): Array<{ assetId: string; label: string }> {
  const candidates: Array<{ assetId: string; label: string }> = [];
  const seen = new Set<string>();
  const add = (assetId: unknown, label: string) => {
    if (typeof assetId !== "string" || !assetId || seen.has(assetId)) return;
    seen.add(assetId);
    candidates.push({ assetId, label });
  };
  if (currentUploadId) add(currentUploadId, "原包上传的参考图");
  currentStickers.forEach((sticker, index) => {
    add(sticker?.assetId, `第 ${index + 1} 张${sticker?.label ? `（${sticker.label}）` : ""}`);
  });
  return candidates;
}

/** 左侧预览：有图显示图片，无图显示虚线占位，避免出现浏览器破图图标。 */
function showFillDialogPreview(url: string | null, placeholderText = "选择图片后显示预览"): void {
  if (fillDialogImage) {
    if (url) {
      fillDialogImage.src = url;
      fillDialogImage.hidden = false;
    } else {
      fillDialogImage.removeAttribute("src");
      fillDialogImage.hidden = true;
    }
  }
  if (fillDialogPlaceholder) fillDialogPlaceholder.hidden = Boolean(url);
  if (fillDialogPlaceholderText && !url) fillDialogPlaceholderText.textContent = placeholderText;
}

function syncFillReferencePreview(): void {
  const assetId = fillReferenceSelect?.value || fillReferenceAssetId || "";
  fillReferenceAssetId = assetId || null;
  showFillDialogPreview(assetId ? window._preview!.buildAssetUrl(assetId) : null, "选择参考图后显示预览");
  if (fillDialogReferenceInfo) {
    fillDialogReferenceInfo.textContent = assetId
      ? "新图片会参考这张图的主体形象与画风。"
      : "请选择一张已有图片作为参考。";
  }
}

function syncFillReferenceControls(): void {
  const disabled = (fillReferenceSelect?.options.length ?? 0) < 2;
  if (fillReferencePrev) fillReferencePrev.disabled = disabled;
  if (fillReferenceNext) fillReferenceNext.disabled = disabled;
}

/** 在已有图片之间循环切换；鼠标按钮、↑/↓ 和下拉框共用同一逻辑。 */
function moveFillReference(delta: number): void {
  const select = fillReferenceSelect;
  if (!select || select.options.length < 2) return;
  const length = select.options.length;
  const current = select.selectedIndex < 0 ? 0 : select.selectedIndex;
  const next = (current + delta + length) % length;
  if (next === current) return;
  select.selectedIndex = next;
  select.dispatchEvent(new Event("change", { bubbles: true }));
}

function clearFillUploadPreviewUrls(): void {
  for (const url of fillUploadObjectUrls) URL.revokeObjectURL(url);
  fillUploadObjectUrls = [];
}

function clearFillUploadSelection(): void {
  clearFillUploadPreviewUrls();
  if (fillUploadFile) fillUploadFile.value = "";
}

function selectedFillUploadFiles(): File[] {
  return Array.from(fillUploadFile?.files ?? []);
}

function syncFillUploadFileName(): void {
  if (!fillUploadFileName) return;
  const files = selectedFillUploadFiles();
  fillUploadFileName.textContent = !files.length
    ? "点击选择图片"
    : files.length === 1
      ? files[0]!.name
      : `已选择 ${files.length} 张图片`;
}

/** 上传模式下的本地预览；真正上传发生在提交时。 */
function syncFillUploadPreview(): void {
  syncFillUploadFileName();
  if (getFillSource() !== "upload") {
    clearFillUploadPreviewUrls();
    syncFillReferencePreview();
    return;
  }

  clearFillUploadPreviewUrls();
  const files = selectedFillUploadFiles();
  const action = getFillAction();
  if (!files.length) {
    showFillDialogPreview(null, action === "direct" ? "选择图片后显示预览" : "选择参考图后显示预览");
    if (fillDialogReferenceInfo) {
      fillDialogReferenceInfo.textContent = action === "direct"
        ? "请选择要直接补进表情包的图片。"
        : "请选择一张图片作为 AI 生成的参考图。";
    }
    return;
  }

  // 和已有图片模式共用同一个预览组件：只显示第 1 张，多选时用下方文案说明总数。
  const url = URL.createObjectURL(files[0]!);
  fillUploadObjectUrls.push(url);
  showFillDialogPreview(url, "选择图片后显示预览");
  if (fillDialogReferenceInfo) {
    fillDialogReferenceInfo.textContent = action === "direct"
      ? files.length > 1
        ? `已选择 ${files.length} 张图片，预览显示第 1 张；提交后会按当前平台规格自动规范化。`
        : "已选择 1 张图片，提交后会按当前平台规格自动规范化。"
      : files.length > 1
        ? `当前选择了 ${files.length} 张，AI 参考图只会使用第 1 张。`
        : "会用这张上传图片作为参考，按提示词生成新图。";
  }
}

function syncFillFlowFields(): void {
  const source = getFillSource();
  const isSingle = fillTargetIsSingle();
  if (source === "existing" && getFillAction() === "direct" && fillActionAi) {
    // 「直接使用原图」只适用于上传；切回已有图片时自动回到 AI 生成。
    fillActionAi.checked = true;
  }
  const action = getFillAction();
  const usesAiParams = action === "ai";

  if (fillReferenceField) fillReferenceField.hidden = source !== "existing";
  if (fillUploadFields) fillUploadFields.hidden = source !== "upload";
  if (fillActionDirectOption) fillActionDirectOption.hidden = source !== "upload";
  if (fillActionSelector) fillActionSelector.classList.toggle("fill-choice-grid-single", source !== "upload");
  if (fillAiSettingsStep) fillAiSettingsStep.hidden = !usesAiParams;
  if (fillCountField) fillCountField.hidden = isSingle || !usesAiParams;
  if (fillPromptField) fillPromptField.hidden = !usesAiParams;
  if (fillStyleField) {
    fillStyleField.hidden = !usesAiParams;
    fillStyleField.classList.toggle("field-full", isSingle);
  }
  if (fillUploadFile) {
    // 直接使用原图可以一次补多张；作为 AI 参考图时一次只生成一张。
    fillUploadFile.multiple = source === "upload" && action === "direct" && !isSingle;
  }

  if (fillSourceHint) {
    fillSourceHint.textContent = source === "existing"
      ? "从当前表情包里选一张图，保持角色与画风一致。"
      : "从本地上传图片；既可直接补进包，也可作为 AI 参考图。";
  }
  if (fillActionHint) {
    fillActionHint.textContent = action === "ai"
      ? "以所选图片为参考，按提示词与风格生成新图。"
      : "不经过 AI，上传图片规范化后直接补进表情包。";
  }
  if (fillUploadHint) {
    const role = fillUploadRole();
    const appendDirect = !isSingle && action === "direct";
    fillUploadHint.textContent = action === "direct"
      ? appendDirect
        ? "支持 PNG、JPG、WebP、GIF；可一次选择多张，会统一规范为当前平台尺寸。"
        : role === "sticker"
          ? "选择 1 张图片；会按当前平台规格统一尺寸与格式后补进表情包。"
          : "选择 1 张图片；会按该资源的固定尺寸裁切 / 补边后补进表情包。"
      : "选择 1 张图片；上传后会作为 AI 参考图，不会原样写进包内。";
  }

  if (fillDialogSubmit) {
    fillDialogSubmit.textContent = action === "direct" ? "上传补齐" : "开始补齐";
  }
  syncFillUploadPreview();
}

const FILL_EXTRA_DEFAULT_PROMPTS: Record<string, string> = {
  coverAssetId: "为这套表情包生成封面图：主角居中、构图完整，适合正方形封面展示",
  iconAssetId: "为这套表情包生成聊天面板图标：主体居中、简洁清晰，适合小尺寸缩略图",
  bannerAssetId: "为这套表情包生成详情页横幅：突出主角形象与整体风格，横向构图",
  rewardGuideAssetId: "为这套表情包生成赞赏引导图：画面友好，预留赞赏引导语的位置",
  rewardThanksAssetId: "为这套表情包生成赞赏感谢图：表达感谢，画面温暖友好"
};

function openFillDialog(target?: ResourceTarget): void {
  if (resourceRegenerating) return;
  const isExtra = Boolean(target && target.kind === "extra" && target.key);
  const isReplaceSticker = Boolean(
    target &&
      target.kind === "sticker" &&
      typeof target.index === "number" &&
      target.index >= 0 &&
      target.index < currentStickers.length
  );
  const isSingle = isExtra || isReplaceSticker;
  fillDialogTarget = isSingle ? target! : null;

  if (!currentStickers.length) {
    window._ui!.setNotice("请先导入或生成至少一张图片，再使用补齐。", "error");
    return;
  }
  if (!isSingle && currentStickers.length >= MAX_STICKER_COUNT) {
    window._ui!.setNotice(`当前平台最多 ${MAX_STICKER_COUNT} 张，已达到上限。`, "info");
    return;
  }

  const candidates = fillReferenceCandidates();
  if (!candidates.length) {
    window._ui!.setNotice("找不到可用的参考图片，请先导入一张图片。", "error");
    return;
  }

  if (fillReferenceSelect) {
    fillReferenceSelect.innerHTML = "";
    for (const candidate of candidates) {
      const option = document.createElement("option");
      option.value = candidate.assetId;
      option.textContent = candidate.label;
      fillReferenceSelect.appendChild(option);
    }
    const preferred = fillReferenceAssetId && candidates.some((c) => c.assetId === fillReferenceAssetId)
      ? fillReferenceAssetId
      : candidates[0].assetId;
    fillReferenceSelect.value = preferred;
  }
  syncFillReferenceControls();

  const remaining = MAX_STICKER_COUNT - currentStickers.length;
  if (fillCount) {
    fillCount.min = "1";
    fillCount.max = String(isSingle ? 1 : remaining);
    const suggested = isSingle
      ? 1
      : Math.max(1, Math.min(DEFAULT_STICKER_COUNT - currentStickers.length, remaining));
    fillCount.value = String(suggested);
  }
  if (fillCountHint) {
    fillCountHint.textContent = isReplaceSticker
      ? "重新补齐会替换这张图片的当前版本，并保留历史版本。"
      : isExtra
        ? "空白资源一次补齐一张。"
        : `当前已有 ${currentStickers.length} 张，最多还能补 ${remaining} 张。`;
  }

  if (fillStyle) {
    const styles = availableStyles.length ? availableStyles : DEFAULT_STYLE_OPTIONS;
    fillStyle.innerHTML = "";
    const defaultOption = document.createElement("option");
    defaultOption.value = "";
    defaultOption.textContent = "不指定（不使用风格）";
    fillStyle.appendChild(defaultOption);
    for (const style of styles) {
      const option = document.createElement("option");
      option.value = style;
      option.textContent = style;
      fillStyle.appendChild(option);
    }
    // 替换已有图片时优先预选这张图原来的风格；否则用包里记录的风格。
    // 都没有就保持「不指定」，不替用户挑风格。
    const targetStyle = isExtra
      ? currentExtras[`${target!.key}_style`]
      : isReplaceSticker
        ? currentStickers[target!.index!]?.style
        : null;
    const storedStyles = Array.isArray(lastPackResult?.generation?.styles)
      ? lastPackResult.generation.styles.filter((style: unknown): style is string => typeof style === "string" && Boolean(style))
      : [];
    const preferredStyle = typeof targetStyle === "string" && styles.includes(targetStyle)
      ? targetStyle
      : storedStyles.find((style: string) => styles.includes(style));
    fillStyle.value = preferredStyle ?? "";
  }

  if (fillDialogTitle) {
    fillDialogTitle.textContent = isExtra
      ? `补齐${resourceLabel(target!)}`
      : isReplaceSticker
        ? `重新补齐${resourceLabel(target!)}`
        : "补齐表情";
  }
  if (fillDialogDescription) {
    fillDialogDescription.textContent = isExtra
      ? "只补齐这一张空白资源，不影响其它素材；可以 AI 生成，也可以直接上传成品图。"
      : isReplaceSticker
        ? "替换这一张表情的当前版本，并保留历史记录；可以 AI 生成，也可以直接上传成品图。"
        : "用 AI 生成或上传成品图，把缺少的表情补进当前表情包，已有图片不会被覆盖。";
  }
  if (fillPrompt) {
    const stored = lastPackResult?.generation?.promptCustom || lastPackResult?.generation?.prompt || getEffectivePrompt();
    const fallback = isExtra
      ? FILL_EXTRA_DEFAULT_PROMPTS[target!.key ?? ""] ?? "根据参考图中的主角与画风生成这张资源"
      : "";
    if (isExtra) {
      // 扩展资源在整体提示词后追加该资源的构图要求，保证主体与整套一致。
      fillPrompt.value = typeof stored === "string" && stored.trim()
        ? `${stored.trim()}；${fallback}`
        : fallback;
    } else {
      fillPrompt.value = typeof stored === "string" && stored.trim() ? stored.trim() : "";
    }
  }
  if (fillDialogStatus) fillDialogStatus.textContent = "";
  clearFillUploadSelection();
  if (fillSourceExisting) fillSourceExisting.checked = true;
  if (fillActionAi) fillActionAi.checked = true;
  syncFillFlowFields();
  if (fillDialog) fillDialog.hidden = false;
  fillDialogSubmit!.disabled = false;
  if (fillDialogCancel) fillDialogCancel.disabled = false;
  // 默认先聚焦图片选择器，打开弹窗后可直接用 ↑ / ↓ 快速切换参考图。
  if (getFillSource() === "existing") fillReferenceSelect?.focus();
  else fillUploadFile?.focus();
}

function closeFillDialog(): void {
  if (fillDialog) fillDialog.hidden = true;
  if (fillDialogStatus) fillDialogStatus.textContent = "";
  clearFillUploadSelection();
  fillDialogTarget = null;
}

async function uploadFillFile(file: File, role: string): Promise<string> {
  const form = new FormData();
  form.append("file", file, file.name);
  const params = new URLSearchParams({ presetId: currentPlatform, role });
  const json = await requestJson(`/api/uploads?${params.toString()}`, {
    method: "POST",
    body: form
  });
  if (!json?.uploadId) throw new Error("图片上传失败，请重试。");
  return json.uploadId as string;
}

/** 补齐成功后统一写回包信息、重建 ZIP 与持久化。 */
async function finalizeFillResult(options: {
  singleTarget: ResourceTarget | null;
  extraTarget: ResourceTarget | null;
  appendPrompt?: string;
  appendStyle?: string;
}): Promise<void> {
  const { singleTarget, extraTarget, appendPrompt } = options;
  if (!lastPackResult) return;

  if (singleTarget) {
    // 只补一张资源：保留整套表情原本的提示词 / 参考图 / 风格 / 数量，
    // 只更新该资源是否已包含。补齐时选的参考图只服务这一次生成，
    // 不会升级成整包的参考图。
    const includeField = extraTarget && extraTarget.key ? extraIncludeField(extraTarget.key) : null;
    const include = { ...(lastPackResult.generation?.include ?? {}) };
    if (includeField) include[includeField] = true;
    lastPackResult.generation = {
      ...(lastPackResult.generation ?? {}),
      include
    };
    lastPackResult.meta = {
      ...(lastPackResult.meta ?? {}),
      ...(includeField === "reward" ? { rewardEnabled: true } : {})
    };
    if (includeField === "reward") {
      currentRewardEnabled = true;
      wechatAiRewardEnabled.checked = true;
      syncRewardFields();
    }
  } else if (typeof appendPrompt === "string") {
    // AI 补齐会更新整套的提示词 / 风格；直接上传成品图只更新数量。
    lastPackResult.generation = {
      ...(lastPackResult.generation ?? {}),
      prompt: appendPrompt,
      promptCustom: appendPrompt,
      promptMode: "override",
      ...(options.appendStyle ? { styles: [options.appendStyle] } : {}),
      stickerCount: currentStickers.length
    };
    lastPackResult.meta = {
      ...(lastPackResult.meta ?? {}),
      count: currentStickers.length,
      ...(options.appendStyle ? { styles: [options.appendStyle] } : {})
    };
  } else {
    lastPackResult.generation = {
      ...(lastPackResult.generation ?? {}),
      stickerCount: currentStickers.length
    };
    lastPackResult.meta = {
      ...(lastPackResult.meta ?? {}),
      count: currentStickers.length
    };
  }

  const previousPackId = lastPackResult.packId;
  await rebuildPackFromState();
  persistLastPackPayload(lastPackResult);
  addToPackHistory(lastPackResult, previousPackId);
  window._preview!.renderExportInfo(lastPackResult);
  window._preview!.renderMetadataPreview(lastPackResult);
}

async function submitDirectUpload(
  singleTarget: ResourceTarget | null,
  extraTarget: ResourceTarget | null,
  replaceStickerTarget: ResourceTarget | null,
  files: File[]
): Promise<void> {
  const isSingle = Boolean(singleTarget);
  const remaining = MAX_STICKER_COUNT - currentStickers.length;
  const label = singleTarget ? resourceLabel(singleTarget) : "表情";
  if (files.length < 1) {
    if (fillDialogStatus) fillDialogStatus.textContent = "请先选择要上传的图片。";
    fillUploadFile?.focus();
    return;
  }
  if (isSingle && files.length !== 1) {
    if (fillDialogStatus) fillDialogStatus.textContent = "补齐单张资源时只能上传 1 张图片。";
    return;
  }
  if (!isSingle && files.length > remaining) {
    if (fillDialogStatus) fillDialogStatus.textContent = `最多还能补 ${remaining} 张，请减少上传数量。`;
    return;
  }

  const role = fillUploadRole();
  resourceRegenerating = true;
  setGenerateButtonsBusy(true, "fill");
  fillDialogSubmit!.disabled = true;
  if (fillDialogCancel) fillDialogCancel.disabled = true;
  window._ui!.setStatus(generateState, `上传补齐中 (0/${files.length})`, "loading");
  window._ui!.updateGenerationProgress(0, files.length);

  let uploaded = 0;
  let failure: string | null = null;
  try {
    for (let i = 0; i < files.length; i++) {
      if (fillDialogStatus) {
        fillDialogStatus.textContent = isSingle
          ? `正在上传${label}…`
          : `正在上传第 ${i + 1}/${files.length} 张…`;
      }
      const assetId = await uploadFillFile(files[i]!, role);
      const target: ResourceTarget = singleTarget ?? { kind: "sticker", index: currentStickers.length };
      applyResourceResult(
        target,
        { assetId, url: `/api/assets/${assetId}` },
        { kind: "upload" }
      );
      uploaded += 1;
      window._ui!.setStatus(
        generateState,
        isSingle ? `上传补齐${label}中 (${uploaded}/1)` : `上传补齐中 (${uploaded}/${files.length})`,
        "loading"
      );
      window._ui!.updateGenerationProgress(uploaded, files.length);
    }
  } catch (error) {
    failure = error instanceof Error ? error.message : "图片上传失败，请稍后重试。";
  } finally {
    resourceRegenerating = false;
    fillDialogSubmit!.disabled = false;
    if (fillDialogCancel) fillDialogCancel.disabled = false;
    window._ui!.resetGenerationProgress();
    setGenerateButtonsBusy(false, "fill");
  }

  if (uploaded > 0) {
    await finalizeFillResult({ singleTarget, extraTarget });
  }

  if (failure) {
    if (fillDialogStatus) {
      fillDialogStatus.textContent = uploaded > 0
        ? `已上传补齐 ${uploaded} 张，后续上传失败：${failure}`
        : `上传补齐失败：${failure}`;
    }
    window._ui!.setStatus(generateState, uploaded > 0 ? "部分补齐" : "补齐失败", "error");
    window._ui!.setNotice(
      uploaded > 0 ? `已上传补齐 ${uploaded} 张，还有图片失败，可再次补齐。` : failure,
      "error"
    );
    return;
  }

  closeFillDialog();
  window._ui!.setStatus(generateState, "补齐完成", "success");
  window._ui!.setNotice(
    replaceStickerTarget
      ? `${label}已重新补齐，可预览后下载。`
      : singleTarget
        ? `${label}已补齐，可预览后下载。`
        : `已上传补齐 ${uploaded} 张，当前共 ${currentStickers.length} 张，可预览后下载。`,
    "success"
  );
}

async function submitAiFill(
  singleTarget: ResourceTarget | null,
  extraTarget: ResourceTarget | null,
  replaceStickerTarget: ResourceTarget | null
): Promise<void> {
  const usingUploadedReference = getFillSource() === "upload";
  const files = selectedFillUploadFiles();
  const remaining = MAX_STICKER_COUNT - currentStickers.length;
  const count = singleTarget ? 1 : Number(fillCount?.value || 0);
  const prompt = fillPrompt?.value.trim() ?? "";
  // 风格可选：留空时显式传空数组，表示不写入任何风格描述。
  const style = fillStyle?.value.trim() ?? "";
  let referenceId = usingUploadedReference
    ? ""
    : fillReferenceSelect?.value || fillReferenceAssetId || getAiReferenceAssetId() || "";

  if (usingUploadedReference) {
    if (!files.length) {
      if (fillDialogStatus) fillDialogStatus.textContent = "请先选择一张图片作为参考图。";
      fillUploadFile?.focus();
      return;
    }
  } else if (!referenceId) {
    if (fillDialogStatus) fillDialogStatus.textContent = "请选择一张已有图片作为参考。";
    return;
  }
  if (!singleTarget && (!Number.isInteger(count) || count < 1 || count > remaining)) {
    if (fillDialogStatus) fillDialogStatus.textContent = `补齐张数需在 1-${remaining} 张之间。`;
    fillCount?.focus();
    return;
  }
  if (!prompt) {
    if (fillDialogStatus) {
      fillDialogStatus.textContent = singleTarget ? "请描述这张图要生成的内容。" : "请描述要补齐的表情内容。";
    }
    fillPrompt?.focus();
    return;
  }
  const label = singleTarget ? resourceLabel(singleTarget) : "表情";
  const totalTarget = singleTarget ? currentStickers.length : currentStickers.length + count;
  resourceRegenerating = true;
  setGenerateButtonsBusy(true, "fill");
  fillDialogSubmit!.disabled = true;
  if (fillDialogCancel) fillDialogCancel.disabled = true;
  window._ui!.setStatus(generateState, singleTarget ? `补齐${label}中...` : `补齐中 (0/${count})`, "loading");
  window._ui!.updateGenerationProgress(0, count);

  let generated = 0;
  let failure: string | null = null;
  // 未选风格时，后端会返回它实际采用的默认风格，用于写回包信息。
  let usedStyle = style;
  try {
    if (usingUploadedReference) {
      if (fillDialogStatus) fillDialogStatus.textContent = "正在上传参考图…";
      referenceId = await uploadFillFile(files[0]!, "reference");
    }
    for (let i = 0; i < count; i++) {
      if (fillDialogStatus) {
        fillDialogStatus.textContent = singleTarget
          ? `正在生成${label}…`
          : `正在生成第 ${i + 1}/${count} 张…`;
      }
      const target: ResourceTarget = singleTarget ?? { kind: "sticker", index: currentStickers.length };
      const res = await requestJson("/api/generate/resource", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          presetId: currentPlatform,
          referenceAssetId: referenceId,
          prompt,
          promptPreset: currentPresetId || undefined,
          provider: wechatAiProvider ? wechatAiProvider.value : undefined,
          styles: style ? [style] : [],
          stickerCount: totalTarget,
          metadata: getMetadataPayload(),
          target,
          mode: "regenerate"
        })
      });
      applyResourceResult(target, res, { kind: "fill" });
      if (typeof res.style === "string" && res.style) usedStyle = res.style;
      generated += 1;
      window._ui!.setStatus(
        generateState,
        singleTarget ? `补齐${label}中 (${generated}/1)` : `补齐中 (${generated}/${count})`,
        "loading"
      );
      window._ui!.updateGenerationProgress(generated, count);
    }
  } catch (error) {
    failure = error instanceof Error ? error.message : "生成失败，请稍后重试。";
  } finally {
    resourceRegenerating = false;
    fillDialogSubmit!.disabled = false;
    if (fillDialogCancel) fillDialogCancel.disabled = false;
    window._ui!.resetGenerationProgress();
    setGenerateButtonsBusy(false, "fill");
  }

  if (generated > 0) {
    await finalizeFillResult({
      singleTarget,
      extraTarget,
      ...(singleTarget ? {} : { appendPrompt: prompt, appendStyle: usedStyle })
    });
  }

  if (failure) {
    if (fillDialogStatus) {
      fillDialogStatus.textContent = generated > 0
        ? `已补齐 ${generated} 张，后续生成失败：${failure}`
        : `${singleTarget ? label : "表情"}补齐失败：${failure}`;
    }
    window._ui!.setStatus(generateState, generated > 0 ? "部分补齐" : "补齐失败", "error");
    window._ui!.setNotice(
      generated > 0 ? `已补齐 ${generated} 张，还有图片生成失败，可再次补齐。` : failure,
      "error"
    );
    return;
  }

  closeFillDialog();
  window._ui!.setStatus(generateState, "补齐完成", "success");
  window._ui!.setNotice(
    replaceStickerTarget
      ? `${label}已重新补齐，可预览后下载。`
      : singleTarget
        ? `${label}已补齐，可预览后下载。`
        : `已补齐 ${generated} 张，当前共 ${currentStickers.length} 张，可预览后下载。`,
    "success"
  );
}

async function submitFillDialog(): Promise<void> {
  if (resourceRegenerating) return;
  const extraTarget =
    fillDialogTarget && fillDialogTarget.kind === "extra" && fillDialogTarget.key
      ? fillDialogTarget
      : null;
  const replaceStickerTarget =
    fillDialogTarget && fillDialogTarget.kind === "sticker" && typeof fillDialogTarget.index === "number"
      ? fillDialogTarget
      : null;
  const singleTarget = extraTarget ?? replaceStickerTarget;

  if (getFillSource() === "upload" && getFillAction() === "direct") {
    await submitDirectUpload(singleTarget, extraTarget, replaceStickerTarget, selectedFillUploadFiles());
    return;
  }
  await submitAiFill(singleTarget, extraTarget, replaceStickerTarget);
}

function mountFillDialog(): void {
  fillDialogBackdrop?.addEventListener("click", closeFillDialog);
  fillDialogClose?.addEventListener("click", closeFillDialog);
  fillDialogCancel?.addEventListener("click", closeFillDialog);
  fillDialogSubmit?.addEventListener("click", () => void submitFillDialog());
  fillSourceExisting?.addEventListener("change", () => {
    syncFillFlowFields();
    if (fillSourceExisting.checked) fillReferenceSelect?.focus();
  });
  fillSourceUpload?.addEventListener("change", () => {
    syncFillFlowFields();
    if (fillSourceUpload.checked) fillUploadFile?.focus();
  });
  fillActionAi?.addEventListener("change", syncFillFlowFields);
  fillActionDirect?.addEventListener("change", syncFillFlowFields);
  fillUploadFile?.addEventListener("change", syncFillUploadPreview);
  fillReferenceSelect?.addEventListener("change", syncFillReferencePreview);
  fillReferencePrev?.addEventListener("click", () => moveFillReference(-1));
  fillReferenceNext?.addEventListener("click", () => moveFillReference(1));
  // 焦点不在输入框时也支持上下键切换，例如点过预览区域或导航按钮后可直接连按。
  fillDialog?.addEventListener("keydown", (event) => {
    if (getFillSource() !== "existing") return;
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    const target = event.target as HTMLElement | null;
    if (target?.closest?.("input, textarea, select, [contenteditable='true']")) return;
    event.preventDefault();
    moveFillReference(event.key === "ArrowUp" ? -1 : 1);
  });
  fillDialogImage?.addEventListener("error", () => {
    showFillDialogPreview(null, "图片加载失败，请重新选择");
  });
  fillPrompt?.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      void submitFillDialog();
    }
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && fillDialog && !fillDialog.hidden) closeFillDialog();
  });
}

function setGenerateButtonsBusy(busy: boolean, context: "default" | "fill" = "default"): void {
  const isFill = context === "fill";
  window._ui!.setBusy(
    generateSubmit,
    busy,
    isFill ? "补齐中..." : currentCreationMode === "import" ? "导入中..." : "生成中..."
  );
  window._ui!.setBusy(
    regenerateSubmit,
    busy,
    isFill ? "补齐中..." : "重新生成中..."
  );
  if (fillStickersBtn) fillStickersBtn.disabled = busy || !canFill();
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
  if (aiProviderField) aiProviderField.hidden = currentCreationMode !== "ai";
  window._ui!.setButtonLabel(generateSubmit, currentCreationMode === "import" ? "导入并打包" : "开始生成");
  regenerateSubmit.hidden = currentCreationMode !== "ai";
  window._ui!.setButtonLabel(regenerateSubmit, "重新生成");
  const stickyRegenerate = byId("stickyRegenerate");
  if (stickyRegenerate) stickyRegenerate.hidden = currentCreationMode === "import";
  if (cancelGenerate) cancelGenerate.hidden = true;
  clearGenerateValidation();
  syncPlatformUI();
  if (currentCreationMode === "import") {
    window._ui!.setStatus(generateState, "等待导入", "idle");
    window._ui!.setNotice("请选择已有表情图，系统会自动标准化并打包。", "info");
  } else {
    window._ui!.setStatus(generateState, "等待生成", "idle");
    window._ui!.setNotice(
      currentUploadId
        ? "参考图已就绪，可继续生成表情包。"
        : currentStickers.length
          ? "可继续生成，或导入后使用「补齐」补上缺失的表情。"
          : "可直接填写提示词生成，也可以先上传或让 AI 生成一张参考图。",
      "info"
    );
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
  clearAiReferenceImage();
  if (creationModeImport) creationModeImport.checked = true;
  if (creationModeAi) creationModeAi.checked = false;
  wechatAiPrompt.value = "";
  currentPresetId = "";
  promptMode = "append";
  if (wechatAiPromptPreset) wechatAiPromptPreset.value = "";
  syncPromptPresetPreview();
  syncPromptModeField();
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
    currentStyles = Array.isArray(json.styles) ? json.styles.filter(Boolean) : [];
    renderStyleOptions(DEFAULT_STYLE_OPTIONS);
    promptPresets = Array.isArray(json.promptPresets)
      ? json.promptPresets.filter((p: any) => p && typeof p.id === "string" && typeof p.name === "string" && typeof p.prompt === "string")
      : [];
    populatePromptPresets();
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
 * 于是导入后的包同样能单张重生成、编辑图片并重建 ZIP。
 */
function syncStateFromResult(json: any, fallback?: { creationMode?: string }): void {
  const stickers = Array.isArray(json?.stickers) ? json.stickers : [];
  currentStickers = stickers.map((s: any, i: number) => ({
    label: s?.label ?? String(i + 1).padStart(3, "0"),
    assetId: s?.assetId,
    // url 必须带上：后续任何一次 renderPreview 都靠它，漏了就会渲染成占位符
    url: typeof s?.url === "string" && s.url ? s.url : s?.assetId ? `/api/assets/${s.assetId}` : "",
    ...(s?.prompt ? { prompt: s.prompt } : {}),
    ...(s?.style ? { style: s.style } : {}),
    ...(s?.emotion ? { emotion: s.emotion } : {}),
    ...(s?.sourceAssetId ? { sourceAssetId: s.sourceAssetId } : {}),
    ...(s?.editReferenceAssetId ? { editReferenceAssetId: s.editReferenceAssetId } : {}),
    ...(Array.isArray(s?.versions) && s.versions.length ? { versions: s.versions } : {})
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
    if (detail.sourceAssetId) currentExtras[`${key}_sourceAssetId`] = detail.sourceAssetId;
    if (detail.editReferenceAssetId) {
      currentExtras[`${key}_editReferenceAssetId`] = detail.editReferenceAssetId;
    }
    if (Array.isArray(detail.versions) && detail.versions.length) {
      currentExtras[`${key}_versions`] = detail.versions;
    }
  }

  // 还原 ZIP / 历史时把包里的风格写回表单，后续重建 ZIP 才能保持一致
  const styles = Array.isArray(json?.generation?.styles) ? json.generation.styles.filter(Boolean) : [];
  if (styles.length) {
    currentStyles = styles;
    renderStyleOptions(availableStyles);
    setPromptHint(currentStyles);
  }

  // 还原提示词预设 + 自定义文本 + 自定义用法，保证从 ZIP / 历史还原后能直接再生成。
  // 新包分开存 promptPreset / promptCustom；旧包只有合并后的 prompt。
  const generation = json?.generation ?? {};
  const storedPreset = typeof generation.promptPreset === "string" ? generation.promptPreset : "";
  if (typeof generation.promptCustom === "string") {
    wechatAiPrompt.value = generation.promptCustom;
  } else if (typeof generation.prompt === "string" && !storedPreset) {
    // 旧包没有分开存，只能把合并后的 prompt 当自定义文本；
    // 已知用了预设时不要塞进自定义框，否则会与预设重复。
    wechatAiPrompt.value = generation.prompt;
  } else {
    wechatAiPrompt.value = "";
  }
  setFieldInvalid(wechatAiPrompt, false);
  currentPresetId = storedPreset;
  promptMode = generation.promptMode === "override" ? "override" : "append";
  if (wechatAiPromptPreset) {
    // 预设列表可能还没加载完，先把 id 存下；populatePromptPresets 会再对齐一次
    wechatAiPromptPreset.value = promptPresets.some((p) => p.id === storedPreset) ? storedPreset : "";
  }
  syncPromptPresetPreview();
  syncPromptModeField();

  // 还原「创建方式」（AI 生图 / 导入已有图片）与 AI 提供商；
  // 否则历史还原后按钮会停在导入，AI 相关字段也不可见。
  const source = generation.source;
  const useAi = source
    ? source === "ai-generate"
    : Boolean(generation.providerId || generation.referenceAssetId) || fallback?.creationMode === "ai";
  currentCreationMode = useAi ? "ai" : "import";
  if (creationModeAi) creationModeAi.checked = useAi;
  if (creationModeImport) creationModeImport.checked = !useAi;
  if (typeof generation.providerId === "string" && generation.providerId && wechatAiProvider) {
    const hasOption = Array.from(wechatAiProvider.options).some((o) => o.value === generation.providerId);
    if (hasOption) {
      currentAiProvider = generation.providerId;
      wechatAiProvider.value = generation.providerId;
    }
  }
  syncCreationMode();

  // 还原贴纸数量
  const restoredCount = Number(generation.stickerCount) || Number(json?.meta?.count);
  if (Number.isFinite(restoredCount) && restoredCount > 0) {
    wechatAiCount.value = String(restoredCount);
  }
  if (json?.meta?.title && !wechatAiTitle.value.trim()) wechatAiTitle.value = json.meta.title;
  if (json?.meta?.author && !wechatAiAuthor.value.trim()) wechatAiAuthor.value = json.meta.author;
  if (json?.meta?.version && !wechatAiVersion.value.trim()) wechatAiVersion.value = json.meta.version;
  if (json?.meta?.copyright && !wechatAiCopyright.value.trim()) wechatAiCopyright.value = json.meta.copyright;

  // 旧版本把「补齐时临时选的参考图」写成了整包参考图（referenceMode=fill）。
  // 这会让第 1 张补齐图变成整包参考图；读到这种包时清掉，避免继续误用。
  const legacyFillReference = (json?.meta?.referenceMode ?? json?.generation?.referenceMode) === "fill";
  if (legacyFillReference) {
    if (json?.generation) {
      json.generation.referenceAssetId = null;
      json.generation.referenceMode = "none";
    }
    if (json?.meta) {
      json.meta.referenceAssetId = null;
      json.meta.referenceMode = "none";
    }
    currentUploadId = null;
    originalPreview.removeAttribute("src");
    syncOriginalPreviewSlot();
  }

  // 包内带着真实参考图时把它接上，单张重新生成才有素材可用。
  // 补齐时选的参考图只服务单次生成，不会成为整包参考图。
  const referenceAssetId = json?.meta?.referenceAssetId;
  if (!legacyFillReference && !currentUploadId && typeof referenceAssetId === "string" && referenceAssetId) {
    currentUploadId = referenceAssetId;
    originalPreview.src = window._preview!.buildAssetUrl(referenceAssetId);
    syncOriginalPreviewSlot();
    window._ui!.setStatus(uploadState, "已还原参考图", "success");
  }

  // 导入的包 / 无参考图的包也可能已经有成品图片：启用「补齐」按钮。
  syncRegenerateButton();
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

    // presetId 走 query：multipart 请求下服务端读不到 req.body
    const json = await requestJson(`/api/generate/import?presetId=${encodeURIComponent(currentPlatform)}`, { method: "POST", body: formData });
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
    const json = await requestJson(`/api/generate/import-pack?presetId=${encodeURIComponent(currentPlatform)}`, { method: "POST", body: formData });

    const restoredPlatform = json?.meta?.presetId;
    if (restoredPlatform && PLATFORM_SPECS[restoredPlatform] && restoredPlatform !== currentPlatform) {
      currentPlatform = restoredPlatform;
      setSelectedPlatform(currentPlatform);
      syncPlatformUI();
    }
    window._ui!.setStatus(importState, "已还原", "success");
    renderCompletedPackResult(
      json,
      "已还原之前的生成现场，可继续单张重新生成或编辑图片。",
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
  // 参考图是可选的：没有上传参考图时走纯文生图；导入过成品时也可以
  // 用包内第一张图作为主体依据（由 getAiReferenceAssetId 兜底）。
  const referenceAssetId = getAiReferenceAssetId();
  if (!validateGenerateInputs()) { syncRegenerateButton(); return; }

  const prompt = getEffectivePrompt();
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
      referenceAssetId: referenceAssetId ?? undefined,
      presetId: currentPlatform,
      prompt,
      promptPreset: currentPresetId,
      promptCustom: wechatAiPrompt.value.trim(),
      promptMode,
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
        // 每次只有一个 key 变化：定点更新那个容器即可。
        // 整组重建会把 5 个容器全部清空重画，连带把已加载的图片重新请求一遍。
        if (!data?.key || !window._preview!.updateExtraAsset(data.key, currentExtras, "loading")) {
          window._preview!.renderExtraAssets(currentExtras, "loading");
        }
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
      // 失败时不要清空预览：本轮已经成功生成的贴纸/扩展资源要保留下来，
      // 否则用户白等了。只有一张都没成功时才回到错误占位。
      const hasPartial = currentStickers.length > 0 || Object.keys(currentExtras).length > 0;
      if (hasPartial) {
        const partialHint = currentStickers.length
          ? `本次生成中途失败，但已成功生成的 ${currentStickers.length} 张仍可预览；可直接点击重新生成再次尝试。`
          : "本次生成中途失败，已生成的资源仍可预览；可直接点击重新生成再次尝试。";
        window._preview!.setFeedback(partialHint, "error");
      } else {
        window._preview!.renderPreview([], "error");
        window._preview!.renderExtraAssets({}, "error");
        window._preview!.setFeedback("本次生成失败，可直接点击重新生成再次尝试。", "error");
      }
      window._preview!.setExportInfo("结果概览与导出信息", "生成失败，请调整提示词或稍后重试。");
    }
  } finally {
    currentTaskId = null;
    sseAbortController = null;
    setGenerateButtonsBusy(false);
    setPlatformDisabled(lastPackResult ? true : false);
  }
}

/**
 * 让 AI 生成一张参考图，替代「必须先有一张现成图片」。
 * 默认走文生图；用户选了底图后走图生图（参考图 + 文字），支持多张底图。
 * 返回的 uploadId 与上传接口完全一致，所以后续「生成整套表情包」的流程无需任何改动。
 */
async function generateAiReference(): Promise<void> {
  const prompt = referencePrompt?.value.trim() ?? "";
  if (!prompt) {
    window._ui!.setNotice("请先描述你想要的参考图内容。", "error");
    referencePrompt?.focus();
    return;
  }
  const referenceAssetId = aiReferenceImages[0]?.assetId;
  const additionalReferenceImageAssetIds = aiReferenceImages.slice(1).map((img) => img.assetId);
  if (generateReferenceBtn) generateReferenceBtn.disabled = true;
  window._ui!.setStatus(uploadState, "AI 生成参考图中...", "loading");
  window._ui!.setNotice(referenceAssetId ? "正在基于底图与描述生成参考图，可能需要几十秒..." : "正在用 AI 生成参考图，可能需要几十秒...", "info");
  resetGenerationResult();

  try {
    const json = await requestJson("/api/generate/reference", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        prompt,
        style: referenceStyle?.value.trim() || undefined,
        provider: wechatAiProvider ? wechatAiProvider.value : undefined,
        ...(referenceAssetId ? { referenceImageAssetId: referenceAssetId } : {}),
        ...(additionalReferenceImageAssetIds.length ? { additionalReferenceImageAssetIds } : {})
      })
    });
    if (!json?.uploadId) throw new Error("AI 生成参考图失败，请重试。");

    currentUploadId = json.uploadId as string;
    currentStyles = [...DEFAULT_STYLE_OPTIONS];
    renderStyleOptions(DEFAULT_STYLE_OPTIONS);
    clearGenerateValidation();
    hasGenerationAttempted = false;

    originalPreview.src = window._preview!.buildAssetUrl(currentUploadId);
    syncOriginalPreviewSlot();
    window._ui!.setStatus(uploadState, "AI 参考图已生成", "success");
    window._ui!.setNotice("AI 参考图已生成，正在为你准备推荐提示词。", "success");
    window._preview!.setExportInfo("结果概览与导出信息", "参考图已就绪，下一步补充提示词并生成表情包。");
    updateStepNav(2, [0, 1]);

    try { await suggestPrompt(); }
    catch (promptError) {
      window._ui!.setNotice(promptError instanceof Error ? promptError.message : "参考图已生成，请手动生成提示词。", "error");
    }
  } catch (error) {
    currentUploadId = null;
    hasGenerationAttempted = false;
    originalPreview.removeAttribute("src");
    window._ui!.setStatus(uploadState, "生成失败", "error");
    window._ui!.setNotice(error instanceof Error ? error.message : "AI 生成参考图失败，请稍后重试。", "error");
    syncRegenerateButton();
  } finally {
    if (generateReferenceBtn) generateReferenceBtn.disabled = false;
  }
}

/** 把 AI 生成参考图的可选底图上传成 asset，随后以 referenceImageAssetId / additionalReferenceImageAssetIds 传给服务端走图生图。 */
async function handleAiReferenceImageChange(): Promise<void> {
  const files = Array.from(referenceImageFile?.files ?? []);
  if (!files.length) {
    clearAiReferenceImage();
    return;
  }
  // 第 1 张是主底图，其余是附加参考图；后端 additionalReferenceImageAssetIds 上限 3。
  const MAX_REFERENCE_IMAGES = 4;
  if (files.length > MAX_REFERENCE_IMAGES) {
    window._ui!.setNotice(`最多支持 ${MAX_REFERENCE_IMAGES} 张参考底图（1 张主底图 + 3 张附加参考图）。`, "error");
    if (referenceImageFile) referenceImageFile.value = "";
    return;
  }
  try {
    const uploaded: Array<{ assetId: string; url: string; name: string }> = [];
    for (const file of files) {
      const id = await uploadReferenceFile(file);
      uploaded.push({ assetId: id, url: window._preview!.buildAssetUrl(id), name: file.name });
    }
    aiReferenceImages = uploaded;
    renderAiReferenceImages();
    syncAiReferenceImageHint();
    if (clearReferenceImageBtn) clearReferenceImageBtn.hidden = false;
    window._ui!.setNotice(
      files.length > 1 ? "已上传多张参考底图，可点击 AI 生成参考图。" : "底图已就绪，可点击 AI 生成参考图。",
      "success"
    );
  } catch (error) {
    clearAiReferenceImage();
    window._ui!.setNotice(error instanceof Error ? error.message : "底图上传失败，请重试。", "error");
  }
}

/** 渲染已选底图的预览缩略图。 */
function renderAiReferenceImages(): void {
  if (!referenceImagePreviewList) return;
  referenceImagePreviewList.innerHTML = "";
  aiReferenceImages.forEach((image, index) => {
    const item = document.createElement("div");
    item.className = "reference-image-preview-item";

    const media = document.createElement("img");
    media.src = image.url;
    media.alt = image.name;
    media.loading = "lazy";
    media.decoding = "async";
    media.onerror = () => {
      item.classList.add("reference-image-preview-item-error");
      media.outerHTML = `<div class="reference-image-preview-error">加载失败</div>`;
    };

    const label = document.createElement("span");
    label.className = "reference-image-preview-label";
    label.textContent = index === 0 ? "主底图" : `参考 ${index + 1}`;

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "reference-image-preview-remove";
    remove.setAttribute("aria-label", `移除 ${image.name}`);
    remove.title = `移除 ${image.name}`;
    remove.textContent = "×";
    remove.addEventListener("click", () => removeAiReferenceImage(index));

    item.appendChild(media);
    item.appendChild(label);
    item.appendChild(remove);
    referenceImagePreviewList.appendChild(item);
  });
  referenceImagePreviewList.hidden = aiReferenceImages.length === 0;
}

function syncAiReferenceImageHint(): void {
  if (!referenceImageHint) return;
  if (!aiReferenceImages.length) {
    referenceImageHint.hidden = true;
    return;
  }
  const names = aiReferenceImages.map((image) => image.name).join("、");
  referenceImageHint.textContent =
    aiReferenceImages.length > 1
      ? `已选 ${aiReferenceImages.length} 张底图：${names}。第 1 张为主底图，其余作为附加参考（部分模型支持多图）。`
      : `已选底图：${names}，AI 将在此基础上结合描述生成参考图。`;
  referenceImageHint.hidden = false;
}

/** 移除指定索引的参考底图。 */
function removeAiReferenceImage(index: number): void {
  aiReferenceImages.splice(index, 1);
  renderAiReferenceImages();
  syncAiReferenceImageHint();
  if (!aiReferenceImages.length) {
    if (referenceImageFile) referenceImageFile.value = "";
    if (clearReferenceImageBtn) clearReferenceImageBtn.hidden = true;
  }
}

/** 移除已选的参考底图，回到纯文生图。 */
function clearAiReferenceImage(): void {
  aiReferenceImages = [];
  if (referenceImageFile) referenceImageFile.value = "";
  if (referenceImageHint) referenceImageHint.hidden = true;
  if (clearReferenceImageBtn) clearReferenceImageBtn.hidden = true;
  if (referenceImagePreviewList) {
    referenceImagePreviewList.innerHTML = "";
    referenceImagePreviewList.hidden = true;
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
  const stickyRegenerate = byId("stickyRegenerate");
  if (!bar) return;
  if (statusEl) statusEl.textContent = stateText || "";
  // 导入模式的一键操作是下载 / 重置；补齐入口在「表情主图」资源组内。
  if (stickyRegenerate) stickyRegenerate.hidden = currentCreationMode === "import";
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
  generateReferenceBtn?.addEventListener("click", () => void generateAiReference());
  referenceImageFile?.addEventListener("change", () => void handleAiReferenceImageChange());
  clearReferenceImageBtn?.addEventListener("click", () => clearAiReferenceImage());
  referencePrompt?.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      void generateAiReference();
    }
  });
  importForm?.addEventListener("submit", async (e) => { e.preventDefault(); });

  wechatAiPrompt.addEventListener("input", () => {
    setFieldInvalid(wechatAiPrompt, false);
    syncRegenerateButton();
  });
  wechatAiPromptPreset?.addEventListener("change", () => {
    currentPresetId = wechatAiPromptPreset.value;
    setFieldInvalid(wechatAiPrompt, false);
    syncPromptPresetPreview();
    syncPromptModeField();
    applyPresetStyle();
    setPromptHint(currentStyles);
    syncRegenerateButton();
  });
  wechatAiPromptMode?.addEventListener("change", () => {
    promptMode = wechatAiPromptMode.value === "override" ? "override" : "append";
    setPromptHint(currentStyles);
    syncRegenerateButton();
  });
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
  fillStickersBtn?.addEventListener("click", () => openFillDialog());
  resetSubmit.addEventListener("click", () => resetAllState());
  // 阻止冒泡：清空按钮位于 #historyToggle 内，避免同时触发折叠/展开
  clearHistoryBtn?.addEventListener("click", (event) => { event.stopPropagation(); void clearPackHistory(); });
  mountEditDialog();
  mountFillDialog();
  mountVersionDialog();

  document.addEventListener("click", (e) => {
    const target = (e.target as HTMLElement | null)?.closest?.("#historyToggle, .collapse-btn");
    if (target) toggleHistory();
  });
  // 卡片上的「编辑图片」：在这一张的基础上继续改，不影响其它图片
  document.addEventListener("click", (e) => {
    const editBtn = (e.target as HTMLElement | null)?.closest?.('[data-action="edit-resource"]') as HTMLElement | null;
    if (!editBtn) return;
    e.preventDefault();
    const target = targetFromCard(editBtn);
    if (target) openEditDialog(target);
  });
  // 卡片上的「删除」：从当前包里移除不满意的图片，稍后可重新补齐
  document.addEventListener("click", (e) => {
    const deleteBtn = (e.target as HTMLElement | null)?.closest?.('[data-action="delete-resource"]') as HTMLElement | null;
    if (!deleteBtn) return;
    e.preventDefault();
    e.stopPropagation();
    const target = targetFromCard(deleteBtn);
    if (target) void deleteResource(target);
  });
  // 卡片上的「重新补齐」：对补齐过的图片重新生成或上传替换，可换参考图 / 提示词 / 风格
  document.addEventListener("click", (e) => {
    const refillBtn = (e.target as HTMLElement | null)?.closest?.('[data-action="refill-resource"]') as HTMLElement | null;
    if (!refillBtn) return;
    e.preventDefault();
    const target = targetFromCard(refillBtn);
    if (target) openFillDialog(target);
  });
  // 卡片上的「版本 N」：查看该图的历史版本，可恢复某一版
  document.addEventListener("click", (e) => {
    const versionBtn = (e.target as HTMLElement | null)?.closest?.('[data-action="show-versions"]') as HTMLElement | null;
    if (!versionBtn) return;
    e.preventDefault();
    const target = targetFromCard(versionBtn);
    if (target) openVersionDialog(target);
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
    if (target?.kind === "extra") {
      // 空白 / 失败的扩展资源：打开补齐弹窗，让用户确认内容、参考图与风格。
      openFillDialog(target as ResourceTarget);
      return;
    }
    if (target) void regenerateResource(target as ResourceTarget);
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

      const presetSource = config?.platforms?.wechat_stickers?.promptPresets ?? config?.wechat?.promptPresets;
      if (Array.isArray(presetSource)) {
        promptPresets = presetSource.filter(
          (p: any) => p && typeof p.id === "string" && typeof p.name === "string" && typeof p.prompt === "string"
        );
        populatePromptPresets();
        applyPresetStyle();
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
  warmUpEditDialog();
}

export function mountApp(): void {
  syncCreationMode();
  bindEvents();
  void initApp();
}
