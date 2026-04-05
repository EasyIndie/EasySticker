const uploadForm = document.getElementById("uploadForm");
const fileInput = document.getElementById("file");
const uploadState = document.getElementById("uploadState");
const originalPreview = document.getElementById("originalPreview");
const wechatAiForm = document.getElementById("wechatAiForm");
const generateSubmit = document.getElementById("generateSubmit");
const regenerateSubmit = document.getElementById("regenerateSubmit");
const resetSubmit = document.getElementById("resetSubmit");
const cancelGenerate = document.getElementById("cancelGenerate");
const generateState = document.getElementById("generateState");
const wechatAiZipLink = document.getElementById("wechatAiZipLink");
const wechatAiActions = document.getElementById("wechatAiActions");
const wechatAiPreview = document.getElementById("wechatAiPreview");
const sectionCover = document.getElementById("sectionCover");
const wechatAiCover = document.getElementById("wechatAiCover");
const sectionIcon = document.getElementById("sectionIcon");
const wechatAiIcon = document.getElementById("wechatAiIcon");
const sectionBanner = document.getElementById("sectionBanner");
const wechatAiBanner = document.getElementById("wechatAiBanner");
const sectionRewardGuide = document.getElementById("sectionRewardGuide");
const wechatAiRewardGuide = document.getElementById("wechatAiRewardGuide");
const sectionRewardThanks = document.getElementById("sectionRewardThanks");
const wechatAiRewardThanks = document.getElementById("wechatAiRewardThanks");

const wechatAiPrompt = document.getElementById("wechatAiPrompt");
const wechatAiTitle = document.getElementById("wechatAiTitle");
const wechatAiAuthor = document.getElementById("wechatAiAuthor");
const wechatAiVersion = document.getElementById("wechatAiVersion");
const wechatAiCopyright = document.getElementById("wechatAiCopyright");
const wechatAiCount = document.getElementById("wechatAiCount");
const wechatAiRewardEnabled = document.getElementById("wechatAiRewardEnabled");
const wechatAiRewardMessageField = document.getElementById("wechatAiRewardMessageField");
const wechatAiRewardMessage = document.getElementById("wechatAiRewardMessage");
const wechatAiStyleOptions = document.getElementById("wechatAiStyleOptions");
const wechatAiCountDec = document.getElementById("wechatAiCountDec");
const wechatAiCountInc = document.getElementById("wechatAiCountInc");
const wechatAiProvider = document.getElementById("wechatAiProvider");
const wechatAiExportInfo = document.getElementById("wechatAiExportInfo");
const wechatAiMetadataPreview = document.getElementById("wechatAiMetadataPreview");
const wechatAiFeedback = document.getElementById("wechatAiFeedback");
const promptHint = document.getElementById("promptHint");
const globalNotice = document.getElementById("globalNotice");
const toastNotice = document.getElementById("toastNotice");
const generateErrorSummary = document.getElementById("generateErrorSummary");
const generateErrorList = document.getElementById("generateErrorList");
const originalPreviewPlaceholder = document.getElementById("originalPreviewPlaceholder");

let DEFAULT_STICKER_COUNT = 8;
let MIN_STICKER_COUNT = 8;
let MAX_STICKER_COUNT = 24;
let DEFAULT_STYLE_OPTIONS = ["扁平插画", "3D 卡通", "日系 Q 版", "像素风", "国潮风"];
const LAST_WECHAT_PACK_STORAGE_KEY = "easysticker:last-wechat-pack";
const BASE_EXTRA_ASSET_DEFS = [
  {
    key: "coverAssetId",
    title: "Cover 预览",
    spec: "240 × 240",
    description: "用于表情包封面展示。",
    alt: "生成封面预览"
  },
  {
    key: "iconAssetId",
    title: "Icon 预览",
    spec: "50 × 50",
    description: "用于列表入口与缩略图展示。",
    alt: "生成图标预览"
  },
  {
    key: "bannerAssetId",
    title: "Banner 预览",
    spec: "750 × 400",
    description: "用于详情页横幅展示。",
    alt: "生成横幅预览",
    wide: true
  }
];
const REWARD_EXTRA_ASSET_DEFS = [
  {
    key: "rewardGuideAssetId",
    title: "赞赏引导图",
    spec: "750 × 400",
    description: "用于展示赞赏引导语。",
    alt: "赞赏引导图预览",
    wide: true
  },
  {
    key: "rewardThanksAssetId",
    title: "赞赏感谢图",
    spec: "750 × 400",
    description: "用于赞赏完成后的感谢反馈。",
    alt: "赞赏感谢图预览",
    wide: true
  }
];
const PLACEHOLDER_STATE_TEXT = {
  idle: "等待生成",
  loading: "生成中，完成后自动展示",
  error: "生成失败，可点击重新生成",
  success: "本次结果未返回该资源"
};
const STICKER_PREVIEW_SPEC = "240 × 240";
const FIELD_A11Y_CONFIGS = {
  prompt: {
    key: "prompt",
    target: wechatAiPrompt,
    label: "提示词",
    errorId: "wechatAiPromptError",
    baseDescribedBy: ["promptHint"]
  },
  title: {
    key: "title",
    target: wechatAiTitle,
    label: "表情包标题",
    errorId: "wechatAiTitleError",
    baseDescribedBy: ["wechatAiTitleHint"]
  },
  author: {
    key: "author",
    target: wechatAiAuthor,
    label: "作者名",
    errorId: "wechatAiAuthorError",
    baseDescribedBy: ["wechatAiAuthorHint"]
  },
  count: {
    key: "count",
    target: wechatAiCount,
    label: "贴纸数量",
    errorId: "wechatAiCountError",
    baseDescribedBy: ["wechatAiCountHint"]
  },
  styles: {
    key: "styles",
    target: wechatAiStyleOptions,
    label: "风格选择",
    errorId: "wechatAiStyleError",
    baseDescribedBy: ["wechatAiStyleHint"],
    focusTarget: wechatAiStyleOptions
  },
  rewardMessage: {
      key: "rewardMessage",
      target: wechatAiRewardMessage,
      label: "赞赏引导语",
      errorId: "wechatAiRewardMessageError",
      baseDescribedBy: ["wechatAiRewardHint"]
    }
  };
  
  let currentUploadId = null;
  let currentStyles = [];
  let availableStyles = [...DEFAULT_STYLE_OPTIONS];
  let currentRewardEnabled = false;
  let currentRewardMessage = "";
  let currentAiProvider = "mock";
  let hasGenerationAttempted = false;
let lastPackResult = null;
let currentTaskId = null;
let sseAbortController = null;
let cancelRequested = false;
let exportInfoResult = null;
let metadataPreviewResult = null;
let isExportInfoCollapsed = true;
let isMetadataPreviewCollapsed = true;
let toastTimer = null;
const flashTimers = new Map();
const validationErrors = new Map();
const CONFIRM_CARD_CONFIGS = {
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
const CONFIRM_CARD_STATE = {
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

function getFieldConfig(target) {
  if (!target?.id) return null;
  return Object.values(FIELD_A11Y_CONFIGS).find((config) => config.target?.id === target.id) ?? null;
}

function syncFieldDescribedBy(config, invalid) {
  if (!config?.target?.setAttribute) return;
  const describedBy = [...config.baseDescribedBy, ...(invalid ? [config.errorId] : [])].filter(Boolean).join(" ");
  if (describedBy) {
    config.target.setAttribute("aria-describedby", describedBy);
  } else {
    config.target.removeAttribute?.("aria-describedby");
  }
}

function syncGenerateErrorSummary() {
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
    jumpButton.addEventListener("click", () => {
      jumpToInvalidField(item.key);
    });
    line.appendChild(jumpButton);
    generateErrorList.appendChild(line);
  }

  generateErrorSummary.hidden = false;
  if (typeof generateErrorSummary.focus === "function") {
    generateErrorSummary.focus();
  }
}

function jumpToInvalidField(fieldKey) {
  if (!fieldKey) return;
  const config = FIELD_A11Y_CONFIGS[fieldKey];
  const focusTarget = config?.focusTarget ?? config?.target;
  const flashTarget = config?.target?.closest?.(".field") ?? config?.target;

  if (typeof focusTarget?.scrollIntoView === "function") {
    const prefersReducedMotion = Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches);
    try {
      focusTarget.scrollIntoView({
        behavior: prefersReducedMotion ? "auto" : "smooth",
        block: "center"
      });
    } catch {
      focusTarget.scrollIntoView();
    }
  }
  if (typeof focusTarget?.focus === "function") {
    focusTarget.focus();
  }

  if (flashTarget?.dataset) {
    const prev = flashTimers.get(fieldKey);
    if (prev) clearTimeout(prev);
    flashTarget.dataset.flash = "true";
    flashTimers.set(
      fieldKey,
      setTimeout(() => {
        flashTarget.dataset.flash = "false";
      }, 1200)
    );
  }
}

function initializeFieldAccessibility() {
  for (const config of Object.values(FIELD_A11Y_CONFIGS)) {
    syncFieldDescribedBy(config, false);
    config.target.setAttribute?.("aria-invalid", "false");
  }
}

function setPromptHint(styles = []) {
  const count = Number(wechatAiCount.value || DEFAULT_STICKER_COUNT);
  promptHint.textContent = Array.isArray(styles) && styles.length
    ? `已加载推荐风格：${styles.join("、")}。建议在提示词中补充主体、情绪、动作和背景限制。当前生成 ${count} 张表情${currentRewardEnabled ? "，并附带赞赏引导图和感谢图" : ""}。`
    : `建议在提示词中补充主体、情绪、动作和背景限制。当前生成 ${count} 张表情，并自动补齐封面、图标和横幅${currentRewardEnabled ? "，以及赞赏引导图和感谢图" : ""}。`;
}

function syncOriginalPreviewSlot() {
  const hasSrc = Boolean(originalPreview?.getAttribute("src"));
  if (originalPreviewPlaceholder) {
    originalPreviewPlaceholder.hidden = hasSrc ? true : false;
  }
  if (originalPreview) {
    originalPreview.hidden = hasSrc ? false : true;
  }
}

function syncRewardFields() {
  currentRewardEnabled = Boolean(wechatAiRewardEnabled.checked);
  wechatAiRewardMessageField.hidden = !currentRewardEnabled;
  if (!currentRewardEnabled) {
    wechatAiRewardMessage.value = "";
    currentRewardMessage = "";
    setFieldInvalid(wechatAiRewardMessage, false);
  }
}

function setCountValue(next) {
  const val = Math.max(MIN_STICKER_COUNT, Math.min(MAX_STICKER_COUNT, Number(next || DEFAULT_STICKER_COUNT)));
  wechatAiCount.value = String(val);
  setFieldInvalid(wechatAiCount, false);
  setPromptHint(currentStyles);
  if (wechatAiCountDec) {
    wechatAiCountDec.disabled = val <= MIN_STICKER_COUNT;
  }
  if (wechatAiCountInc) {
    wechatAiCountInc.disabled = val >= MAX_STICKER_COUNT;
  }
}

function renderStyleOptions(styles = DEFAULT_STYLE_OPTIONS) {
  availableStyles = Array.isArray(styles) && styles.length ? [...new Set(styles.filter(Boolean))] : [...DEFAULT_STYLE_OPTIONS];
  currentStyles = currentStyles.filter((item) => availableStyles.includes(item));
  if (!currentStyles.length) {
    currentStyles = [availableStyles[0]]; // 默认选择第一个风格
  } else if (currentStyles.length > 1) {
    currentStyles = [currentStyles[0]]; // 强制单选
  }

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
      // 单选逻辑：点击任何项都直接变为唯一选中项
      currentStyles = [style];
      setFieldInvalid(wechatAiStyleOptions, false);
      renderStyleOptions(availableStyles);
      setPromptHint(currentStyles);
    });
    wechatAiStyleOptions.appendChild(button);
  }
}

function getStorage() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function clearPersistedPackResult() {
  const storage = getStorage();
  if (!storage) return;
  try {
    storage.removeItem(LAST_WECHAT_PACK_STORAGE_KEY);
  } catch {
    // ignore storage errors
  }
}

function sanitizePersistedPackResult(raw) {
  if (!raw || typeof raw !== "object") {
    console.log("sanitize failed: not object", raw);
    return null;
  }

  const result = raw.result;
  if (!result || typeof result !== "object" || typeof result.packId !== "string" || typeof result.downloadUrl !== "string") {
    console.log("sanitize failed: result invalid", result);
    return null;
  }

  const stickers = Array.isArray(result.stickers)
    ? result.stickers
        .filter((item) => item && typeof item === "object" && typeof item.label === "string" && typeof item.url === "string")
        .map((item) => ({
          label: item.label,
          url: item.url,
          assetId: typeof item.assetId === "string" ? item.assetId : undefined,
          prompt: typeof item.prompt === "string" ? item.prompt : undefined
        }))
    : [];

  return {
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
    styles: Array.isArray(raw.styles) ? raw.styles.filter((item) => typeof item === "string" && item.trim()) : [],
    hasGenerationAttempted: Boolean(raw.hasGenerationAttempted),
    result: {
      packId: result.packId,
      downloadUrl: result.downloadUrl,
      downloadFilename: typeof result.downloadFilename === "string" ? result.downloadFilename : undefined,
      stickers,
      metadataJson: typeof result.metadataJson === "string" ? result.metadataJson : undefined,
      meta:
        result.meta && typeof result.meta === "object"
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

function persistLastGeneratedResult(result) {
  const storage = getStorage();
  if (!storage || !result?.packId || !result?.downloadUrl) return;

  const payload = {
    version: 1,
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
            .filter((item) => item && typeof item.label === "string" && typeof item.url === "string")
            .map((item) => ({
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

  try {
    storage.setItem(LAST_WECHAT_PACK_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // ignore storage errors
  }
}

function restorePersistedPackResult() {
  const storage = getStorage();
  if (!storage) return false;

  try {
    const rawText = storage.getItem(LAST_WECHAT_PACK_STORAGE_KEY);
    if (!rawText) return false;

    const restored = sanitizePersistedPackResult(JSON.parse(rawText));
    if (!restored) {
      console.log("sanitizePersistedPackResult returned null");
      clearPersistedPackResult();
      return false;
    }

    currentUploadId = restored.uploadId;
    if (restored.provider) {
      currentAiProvider = restored.provider;
    }
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
    syncRewardFields();
    renderStyleOptions(currentStyles);
    setPromptHint(currentStyles);

    if (restored.uploadId) {
      originalPreview.src = buildAssetUrl(restored.uploadId);
      syncOriginalPreviewSlot();
      setStatus(uploadState, "已恢复参考图", "success");
    }

    renderPreview(restored.result.stickers, "success");
    renderExtraAssets(restored.result.extras, "success");
    renderDownload(restored.result.packId, restored.result.downloadUrl, restored.result.downloadFilename);
    renderActions(restored.result);
    renderExportInfo(restored.result);
    renderMetadataPreview(restored.result);
    const exportConfirmPanel = document.getElementById("exportConfirmPanel");
    if (exportConfirmPanel) exportConfirmPanel.hidden = false;
    setStatus(generateState, "已恢复最近结果", "success");
    setFeedback("已从本地恢复最近一次生成结果，可直接预览、下载或重新生成。", "success");
    setNotice("已恢复最近一次生成结果，可继续下载或重新生成。", "success");
    syncRegenerateButton();
    return true;
  } catch (e) {
    console.error("restorePersistedPackResult error:", e);
    clearPersistedPackResult();
    return false;
  }
}

function setBusy(button, busy, text) {
  button.disabled = busy;
  button.dataset.label = button.dataset.label || button.textContent;
  button.textContent = busy ? text : button.dataset.label;
}

function setStatus(node, text, tone = "idle") {
  node.textContent = text;
  node.dataset.tone = tone;
}

function setNotice(text, tone = "info") {
  globalNotice.textContent = text;
  globalNotice.dataset.tone = tone;
  if (tone === "success" || tone === "error") {
    showToast(text, tone);
  }
}

function showToast(text, tone = "info") {
  if (!toastNotice) return;
  toastNotice.textContent = text;
  toastNotice.dataset.tone = tone;
  toastNotice.dataset.visible = "true";
  if (toastTimer) {
    clearTimeout(toastTimer);
  }
  toastTimer = setTimeout(() => {
    toastNotice.dataset.visible = "false";
  }, 2200);
}

function setFieldInvalid(target, invalid, message = "", { syncSummary = true } = {}) {
  if (!target) return;
  const config = getFieldConfig(target);
  const container = target.className?.includes?.("style-options") ? target : target.closest?.(".field") || target;
  if (container?.dataset) {
    container.dataset.invalid = invalid ? "true" : "false";
  }
  if (target.setAttribute) {
    target.setAttribute("aria-invalid", invalid ? "true" : "false");
  }

  if (config) {
    const errorNode = document.getElementById(config.errorId);
    if (errorNode) {
      errorNode.hidden = !invalid;
      errorNode.textContent = invalid ? message : "";
    }
    syncFieldDescribedBy(config, invalid);

    if (invalid && message) {
      validationErrors.set(config.key, { key: config.key, label: config.label, message });
    } else {
      validationErrors.delete(config.key);
    }
  }

  if (syncSummary) {
    syncGenerateErrorSummary();
  }
}

function clearGenerateValidation() {
  validationErrors.clear();
  setFieldInvalid(wechatAiPrompt, false, "", { syncSummary: false });
  setFieldInvalid(wechatAiTitle, false, "", { syncSummary: false });
  setFieldInvalid(wechatAiAuthor, false, "", { syncSummary: false });
  setFieldInvalid(wechatAiCount, false, "", { syncSummary: false });
  setFieldInvalid(wechatAiRewardMessage, false, "", { syncSummary: false });
  setFieldInvalid(wechatAiStyleOptions, false, "", { syncSummary: false });
  syncGenerateErrorSummary();
}

function validateGenerateInputs() {
  clearGenerateValidation();

  const prompt = wechatAiPrompt.value.trim();
  const title = wechatAiTitle.value.trim();
  const author = wechatAiAuthor.value.trim();
  const rewardMessage = wechatAiRewardMessage.value.trim();
  const stickerCount = Number(wechatAiCount.value || DEFAULT_STICKER_COUNT);
  const errors = [];

  if (!prompt) {
    errors.push({ target: wechatAiPrompt, message: "请先填写提示词。" });
  }

  if (!title) {
    errors.push({ target: wechatAiTitle, message: "请填写表情包标题。" });
  }

  if (!author) {
    errors.push({ target: wechatAiAuthor, message: "请填写作者名。" });
  }

  if (!Number.isInteger(stickerCount) || stickerCount < MIN_STICKER_COUNT || stickerCount > MAX_STICKER_COUNT) {
    errors.push({ target: wechatAiCount, message: `贴纸数量需在 ${MIN_STICKER_COUNT}-${MAX_STICKER_COUNT} 张之间。` });
  }

  if (!currentStyles.length) {
    errors.push({ target: wechatAiStyleOptions, message: "请至少选择一种风格。" });
  }

  if (currentRewardEnabled && !rewardMessage) {
    errors.push({ target: wechatAiRewardMessage, message: "开启赞赏功能后，请填写赞赏引导语。" });
  }

  if (!errors.length) {
    syncGenerateErrorSummary();
    return true;
  }

  for (const item of errors) {
    setFieldInvalid(item.target, true, item.message, { syncSummary: false });
  }
  syncGenerateErrorSummary();
  setNotice(errors[0].message, "error");
  setStatus(generateState, errors.length === 1 ? "待处理 1 项输入问题" : `待处理 ${errors.length} 项输入问题`, "error");
  return false;
}

function buildConfirmCardMarkup({ title, description, actions = "", content = "" }) {
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

function setExportInfo(title, description) {
  renderConfirmCardPlaceholder("exportInfo", description, { title });
}

function setMetadataPreview(message) {
  renderConfirmCardPlaceholder("metadata", message);
}

const COPY_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>`;

function buildConfirmCardActions(key, config, collapsed) {
  const actions = [];
  
  if (config.copyAction) {
    actions.push(`
      <button
        type="button"
        class="${config.copyButtonClass}"
        data-action="${config.copyAction}"
        title="${config.copyLabel}"
        aria-label="${config.copyLabel}"
        onclick="(function(e){
          e.preventDefault();
          e.stopPropagation();
          copyText(document.getElementById('${config.element.id}').dataset.copyContent || '')
            .then(() => setNotice('${config.copySuccess}', 'success'))
            .catch((err) => setNotice('复制失败：' + err.message, 'error'));
        })(event)"
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

function renderConfirmCardPlaceholder(key, message, { title } = {}) {
  const config = CONFIRM_CARD_CONFIGS[key];
  const state = CONFIRM_CARD_STATE[key];
  state.setResult(null);
  state.setCollapsed(true);
  config.element.innerHTML = buildConfirmCardMarkup({
    title: title ?? config.title,
    description: config.description,
    content: `<p class="muted summary-card-placeholder">${escapeHtml(message)}</p>`
  });
}

function renderConfirmCard(key, result, { resetCollapsed = true } = {}) {
  const config = CONFIRM_CARD_CONFIGS[key];
  const state = CONFIRM_CARD_STATE[key];
  const element = config?.element;
  if (!element) return;

  if (!result) {
    renderConfirmCardPlaceholder(key, "");
    return;
  }

  state.setResult(result);
  if (resetCollapsed) {
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

function toggleConfirmCard(key) {
  const state = CONFIRM_CARD_STATE[key];
  const result = state.getResult();
  if (!result) return;
  state.setCollapsed(!state.getCollapsed());
  renderConfirmCard(key, result, { resetCollapsed: false });
}

async function copyConfirmCardContent(key) {
  const config = CONFIRM_CARD_CONFIGS[key];
  const result = CONFIRM_CARD_STATE[key].getResult();
  if (!config.getCopyText || !result) return;
  await copyText(config.getCopyText(result));
  setNotice(config.copySuccess, "success");
}

async function handleConfirmCardClick(key, event) {
  const config = CONFIRM_CARD_CONFIGS[key];
  const state = CONFIRM_CARD_STATE[key];
  const toggleButton = event?.target?.closest?.(`[data-action="${config.toggleAction}"]`);
  if (toggleButton && state.getResult()) {
    toggleConfirmCard(key);
    return;
  }

  if (!config.copyAction) return;

  const copyButton = event?.target?.closest?.(`[data-action="${config.copyAction}"]`);
  if (!copyButton || !state.getResult()) return;

  try {
    const element = document.getElementById(config.element.id);
    if (element) {
      await copyText(element.dataset.copyContent || "");
      setNotice(config.copySuccess, "success");
    } else {
      await copyConfirmCardContent(key);
    }
  } catch (error) {
    setNotice(error instanceof Error ? error.message : "复制失败，请稍后重试。", "error");
  }
}

function buildDetailGridMarkup(items) {
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

function renderExportInfo(result, { resetCollapsed = true } = {}) {
  if (!result) {
    setExportInfo("结果概览与导出信息", "生成后在这里查看标题、数量、风格、参考图方式与导出文件。");
    return;
  }

  renderConfirmCard("exportInfo", result, { resetCollapsed });
}

function setFeedback(text, tone = "idle") {
  if (!wechatAiFeedback) return;
  wechatAiFeedback.dataset.tone = tone;
  wechatAiFeedback.innerHTML = `
    <div class="section-title">预览状态</div>
    <p class="muted">${escapeHtml(text)}</p>
  `;
}

function escapeHtml(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function getExportInfoData(result) {
  const title = result?.meta?.title ?? "未命名表情包";
  const author = result?.meta?.author ?? "未填写";
  const version = result?.meta?.version ?? "未填写";
  const copyright = result?.meta?.copyright ?? "未填写";
  const packId = result?.packId ?? "未生成";
  const filename = result?.downloadFilename ?? `${packId}.zip`;
  const rewardEnabled = result?.meta?.rewardEnabled ? "已开启" : "未开启";
  const rewardMessage = result?.meta?.rewardMessage ?? "未填写";
  const count = result?.stickers?.length ?? result?.meta?.count ?? DEFAULT_STICKER_COUNT;
  const styles = Array.isArray(result?.meta?.styles) && result.meta.styles.length ? result.meta.styles.join("、") : "默认";
  const referenceMode = result?.meta?.referenceMode ?? "base64";

  return {
    title,
    author,
    version,
    copyright,
    rewardEnabled,
    rewardMessage,
    packId,
    filename,
    items: [
      { label: "标题", value: title },
      { label: "作者", value: author },
      { label: "版本", value: version },
      { label: "版权", value: copyright },
      { label: "贴纸数量", value: `${count} 张` },
      { label: "赞赏功能", value: rewardEnabled },
      ...(result?.meta?.rewardEnabled ? [{ label: "赞赏引导语", value: rewardMessage }] : []),
      { label: "风格", value: styles },
      { label: "参考图方式", value: referenceMode },
      { label: "packId", value: packId },
      { label: "导出文件", value: filename }
    ]
  };
}

function buildExportInfoCardText(result) {
  if (!result) return "";
  return getExportInfoData(result).items.map((item) => `${item.label}：${item.value}`).join("\n");
}

function buildExportInfoText(result) {
  if (!result) return "";
  const { title, author, version, copyright, packId, filename } = getExportInfoData(result);
  const downloadHref = result?.downloadUrl ? new URL(result.downloadUrl, window.location.origin).toString() : "未生成";

  return [
    `标题：${title}`,
    `作者：${author}`,
    `版本：${version}`,
    `版权：${copyright}`,
    `packId：${packId}`,
    `导出文件：${filename}`,
    `下载链接：${downloadHref}`
  ].join("\n");
}

function buildMetadataPreviewText(result) {
  if (!result) return "";
  if (typeof result.metadataJson === "string" && result.metadataJson.trim()) {
    return result.metadataJson;
  }

  const metadata = {
    schema: "easysticker-pack@0.1",
    packId: result?.packId ?? null,
    presetId: "wechat_stickers",
    createdAt: null,
    metadata: {
      ...(result?.meta?.title ? { title: result.meta.title } : {}),
      ...(result?.meta?.author ? { author: result.meta.author } : {}),
      ...(result?.meta?.version ? { version: result.meta.version } : {}),
      ...(result?.meta?.copyright ? { copyright: result.meta.copyright } : {}),
      ...(result?.meta?.rewardMessage ? { rewardMessage: result.meta.rewardMessage } : {})
    },
    extras: {
      coverAssetId: result?.extras?.coverAssetId ?? null,
      bannerAssetId: result?.extras?.bannerAssetId ?? null,
      iconAssetId: result?.extras?.iconAssetId ?? null,
      rewardGuideAssetId: result?.extras?.rewardGuideAssetId ?? null,
      rewardThanksAssetId: result?.extras?.rewardThanksAssetId ?? null
    },
    assets: Array.isArray(result?.stickers)
      ? result.stickers.map((item) => ({
          assetId: item.assetId ?? null,
          filename: `${item.label ?? "sticker"}.png`,
          zipPath: `assets/${item.label ?? "sticker"}.png`
        }))
      : []
  };

  return JSON.stringify(metadata, null, 2);
}

function renderMetadataPreview(result, tone = "success", { resetCollapsed = true } = {}) {
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

  renderConfirmCard("metadata", result, { resetCollapsed });
}

async function copyText(text) {
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

function buildAssetUrl(assetId) {
  return assetId ? `/api/assets/${assetId}` : "";
}

function getExtraAssetDefs(extras = {}) {
  const rewardAssetPresent = Boolean(extras?.rewardGuideAssetId || extras?.rewardThanksAssetId);
  return currentRewardEnabled || rewardAssetPresent
    ? [...BASE_EXTRA_ASSET_DEFS, ...REWARD_EXTRA_ASSET_DEFS]
    : BASE_EXTRA_ASSET_DEFS;
}

function getExtraAssetDescription(item, assetId, tone, prompt) {
  const descriptions = [item.description];
  const isRewardAsset = item.key === "rewardGuideAssetId" || item.key === "rewardThanksAssetId";

  if (isRewardAsset && currentRewardMessage) {
    descriptions.push(`当前文案：${currentRewardMessage}`);
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

function getPreviewCardContent(sticker, tone) {
  const descriptionPrefix = "用于展示聊天场景贴纸与序号资源。";

  if (tone === "loading") {
    return {
      title: "表情预览",
      description: `${descriptionPrefix} 生成完成后自动更新。`
    };
  }

  if (tone === "error") {
    return {
      title: "表情预览",
      description: `${descriptionPrefix} 生成失败后可重新生成。`
    };
  }

  if (tone !== "success") {
    return {
      title: "表情预览",
      description: `${descriptionPrefix} 等待生成后展示。`
    };
  }

  const label = sticker?.label || "---";
  const promptText = sticker?.prompt ? `\n提示词：${sticker.prompt}` : "";
  return {
    title: `表情 ${label}`,
    description: `${descriptionPrefix} 当前序号：${label}${promptText}`
  };
}

function createPreviewCard(sticker, tone = "success") {
  const card = document.createElement("article");
  card.className = "preview-item";
  
  // 如果有真实图片数据，当前卡片就应该被视为 success 状态展示图片
  const isRealSticker = Boolean(sticker?.url);
  const cardTone = isRealSticker ? "success" : tone;
  
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
  spec.className = "preview-spec";
  spec.textContent = STICKER_PREVIEW_SPEC;

  const description = document.createElement("p");
  description.className = "preview-description";
  description.textContent = content.description;
  // 识别提示词的换行
  description.style.whiteSpace = "pre-wrap";

  head.appendChild(title);
  head.appendChild(spec);
  head.appendChild(description);

  const media = document.createElement(hasImage ? "img" : "div");
  media.className = "preview-media";

  if (hasImage) {
    media.src = sticker.url;
    media.alt = `聊天场景贴纸 ${sticker.label} 预览`;
    media.loading = "lazy";
    media.decoding = "async";
    media.onerror = () => {
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

function canRegenerate() {
  return Boolean(currentUploadId && wechatAiPrompt.value.trim() && hasGenerationAttempted);
}

function syncRegenerateButton() {
  regenerateSubmit.disabled = canRegenerate() ? false : true;
}

function setGenerateButtonsBusy(busy) {
  setBusy(generateSubmit, busy, "生成中...");
  setBusy(regenerateSubmit, busy, "重新生成中...");
  if (wechatAiProvider) {
    wechatAiProvider.disabled = busy;
  }
  if (cancelGenerate) {
    cancelGenerate.hidden = busy ? false : true;
    cancelGenerate.disabled = busy ? false : true;
  }
  if (!busy) {
    syncRegenerateButton();
  }
}

function renderExtraAssets(extras = {}, tone = "idle") {
  // 清空所有额外资源容器
  wechatAiCover.innerHTML = "";
  wechatAiIcon.innerHTML = "";
  wechatAiBanner.innerHTML = "";
  wechatAiRewardGuide.innerHTML = "";
  wechatAiRewardThanks.innerHTML = "";

  for (const item of getExtraAssetDefs(extras)) {
    const assetId = extras?.[item.key];
    const card = document.createElement("article");
    card.className = `preview-item${item.wide ? " preview-item-wide" : ""}`;
    card.dataset.tone = tone;

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
    description.textContent = getExtraAssetDescription(item, assetId, tone, extras?.[`${item.key}_prompt`]);
    description.style.whiteSpace = "pre-wrap";

    head.appendChild(title);
    head.appendChild(spec);
    head.appendChild(description);

    const media = document.createElement(assetId && tone === "success" ? "img" : "div");
    media.className = `preview-media${item.wide ? " preview-media-wide" : ""}`;

    if (assetId && tone === "success") {
      media.src = buildAssetUrl(assetId);
      media.alt = item.alt;
      media.loading = "lazy";
      media.decoding = "async";
      media.onerror = () => {
        media.outerHTML = `<div class="preview-media${item.wide ? " preview-media-wide" : ""} asset-placeholder">${PLACEHOLDER_STATE_TEXT.error}</div>`;
        card.dataset.tone = "error";
        const desc = card.querySelector(".preview-description");
        if (desc) desc.textContent = "生成失败后可重新生成。";
      };
    } else {
      media.classList.add("asset-placeholder");
      media.textContent = PLACEHOLDER_STATE_TEXT[tone] ?? PLACEHOLDER_STATE_TEXT.idle;
    }

    card.appendChild(head);
    card.appendChild(media);

    // 将卡片添加到对应的容器中，并显示区块
    if (item.key === "coverAssetId") {
      wechatAiCover.appendChild(card);
      if (assetId) {
        const sectionCoverIcon = document.getElementById("sectionCoverIcon");
        if (sectionCoverIcon) sectionCoverIcon.hidden = false;
      }
    } else if (item.key === "iconAssetId") {
      wechatAiIcon.appendChild(card);
      if (assetId) {
        const sectionCoverIcon = document.getElementById("sectionCoverIcon");
        if (sectionCoverIcon) sectionCoverIcon.hidden = false;
      }
    } else if (item.key === "bannerAssetId") {
      wechatAiBanner.appendChild(card);
      if (assetId) sectionBanner.hidden = false;
    } else if (item.key === "rewardGuideAssetId") {
      wechatAiRewardGuide.appendChild(card);
      if (assetId) sectionRewardGuide.hidden = false;
    } else if (item.key === "rewardThanksAssetId") {
      wechatAiRewardThanks.appendChild(card);
      if (assetId) sectionRewardThanks.hidden = false;
    }
  }
}

function resetGenerationResult({ clearPersisted = true } = {}) {
  wechatAiZipLink.innerHTML = "";
  clearGenerateValidation();
  wechatAiPreview.innerHTML = "";
  
  // 隐藏所有额外资源区块
  const sectionCoverIcon = document.getElementById("sectionCoverIcon");
  if (sectionCoverIcon) sectionCoverIcon.hidden = true;
  sectionBanner.hidden = true;
  sectionRewardGuide.hidden = true;
  sectionRewardThanks.hidden = true;
  
  const exportConfirmPanel = document.getElementById("exportConfirmPanel");
  if (exportConfirmPanel) exportConfirmPanel.hidden = true;

  renderPreview([], "idle");
  renderExtraAssets({}, "idle");

  setFeedback("等待生成后展示 cover、icon、banner 与表情预览。", "idle");
  setExportInfo("结果概览与导出信息", "生成后在这里查看标题、数量、风格、参考图方式与导出文件。");
  renderMetadataPreview(null);
  setStatus(generateState, "等待生成", "idle");
  hasGenerationAttempted = false;
  lastPackResult = null;
  if (clearPersisted) {
    clearPersistedPackResult();
  }
  syncRegenerateButton();
  syncOriginalPreviewSlot();
}

function resetAllState() {
  currentUploadId = null;
  currentStyles = [...DEFAULT_STYLE_OPTIONS];
  availableStyles = [...DEFAULT_STYLE_OPTIONS];
  currentRewardEnabled = false;
  currentRewardMessage = "";
  hasGenerationAttempted = false;
  lastPackResult = null;

  uploadForm.reset();
  wechatAiPrompt.value = "";
  wechatAiTitle.value = "";
  wechatAiAuthor.value = "";
  wechatAiVersion.value = "";
  wechatAiCopyright.value = "";
  wechatAiCount.value = String(DEFAULT_STICKER_COUNT);
  wechatAiRewardEnabled.checked = false;
  wechatAiRewardMessage.value = "";
  syncRewardFields();
  originalPreview.removeAttribute("src");
  syncOriginalPreviewSlot();

  renderStyleOptions(DEFAULT_STYLE_OPTIONS);
  resetGenerationResult({ clearPersisted: true });
  setPromptHint(currentStyles);
  setStatus(uploadState, "等待上传", "idle");
  setNotice("已重置当前配置与最近结果，请重新上传一张主体清晰的图片。", "info");
}

function renderDownload(packId, downloadUrl, filename) {
  if (!downloadUrl) return;
  const resolvedFilename = filename || `${packId}.zip`;
  
  wechatAiZipLink.innerHTML = "";
  
  // 主下载按钮
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
      setNotice("正在准备下载文件…", "info");
      const response = await fetch(link.href);
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
      setNotice("下载已开始，请留意浏览器下载列表。", "success");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "下载失败，请稍后重试。", "error");
    }
  });
  
  wechatAiZipLink.appendChild(link);
}

function renderActions(result) {
  // 原有的 actions 逻辑已移除，功能转移到 confirm card 和 download slot 中
}

function renderPreview(stickers, tone = "success") {
  const sectionPrimary = document.getElementById("sectionPrimary");
  
  if (!stickers.length) {
    if (tone === "idle") {
      sectionPrimary.hidden = true;
      wechatAiPreview.innerHTML = "";
      return;
    }
    sectionPrimary.hidden = false;
    const desiredTone = tone === "success" ? "idle" : tone;
    wechatAiPreview.innerHTML = "";
    wechatAiPreview.appendChild(createPreviewCard(null, desiredTone));
    return;
  }

  sectionPrimary.hidden = false;

  // 增量 append：仅为新增的贴纸追加卡片
  const existingCount = wechatAiPreview.children.length;
  const needClearPlaceholder = existingCount === 1 && wechatAiPreview.firstChild?.dataset?.tone !== "success";
  if (needClearPlaceholder) {
    wechatAiPreview.innerHTML = "";
    const fragFactory = document.createDocumentFragment?.bind(document);
    if (fragFactory) {
      const frag = fragFactory();
      for (let i = 0; i < stickers.length; i++) {
        frag.appendChild(createPreviewCard(stickers[i], tone));
      }
      wechatAiPreview.appendChild(frag);
    } else {
      for (let i = 0; i < stickers.length; i++) {
        wechatAiPreview.appendChild(createPreviewCard(stickers[i], tone));
      }
    }
    return;
  }
  const fragFactory = document.createDocumentFragment?.bind(document);
  if (fragFactory) {
    const frag = fragFactory();
    for (let i = existingCount; i < stickers.length; i++) {
      frag.appendChild(createPreviewCard(stickers[i], tone));
    }
    wechatAiPreview.appendChild(frag);
  } else {
    for (let i = existingCount; i < stickers.length; i++) {
      wechatAiPreview.appendChild(createPreviewCard(stickers[i], tone));
    }
  }
}

async function parseJson(response) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("服务返回了无法解析的响应");
  }
}

async function requestJson(url, options) {
  const response = await fetch(url, options);
  const json = await parseJson(response);
  if (!response.ok) {
    throw new Error(json?.message || "请求失败，请稍后重试");
  }
  return json;
}

async function suggestPrompt() {
  if (!currentUploadId) return;

  try {
    const json = await requestJson("/api/wechat/prompt", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ referenceAssetId: currentUploadId })
    });

    wechatAiPrompt.value = json.prompt ?? "";
    currentStyles = Array.isArray(json.styles) ? json.styles.filter(Boolean) : [];
    renderStyleOptions(currentStyles.length ? currentStyles : DEFAULT_STYLE_OPTIONS);
    setPromptHint(currentStyles);
  } catch (error) {
    // 忽略后台提示词生成错误，不影响主流程
  }
}

async function generateWechatPack() {
  if (!currentUploadId) {
    setNotice("请先上传参考图。", "error");
    setStatus(generateState, "缺少参考图", "error");
    return;
  }

  if (!validateGenerateInputs()) {
    syncRegenerateButton();
    return;
  }

  const prompt = wechatAiPrompt.value.trim();
  const title = wechatAiTitle.value.trim();
  const author = wechatAiAuthor.value.trim();
  const version = wechatAiVersion.value.trim();
  const copyright = wechatAiCopyright.value.trim();
  const rewardMessage = wechatAiRewardMessage.value.trim();
  const stickerCount = Number(wechatAiCount.value || DEFAULT_STICKER_COUNT);

  hasGenerationAttempted = true;
  setGenerateButtonsBusy(true);
  setStatus(generateState, "生成中...", "loading");
  setNotice("正在生成微信表情并打包，请稍候...", "info");
  wechatAiZipLink.innerHTML = "";
  
  // 隐藏所有额外资源区块，准备新的流式生成
  const sectionCoverIcon = document.getElementById("sectionCoverIcon");
  if (sectionCoverIcon) sectionCoverIcon.hidden = true;
  sectionBanner.hidden = true;
  sectionRewardGuide.hidden = true;
  sectionRewardThanks.hidden = true;
  
  const exportConfirmPanel = document.getElementById("exportConfirmPanel");
  if (exportConfirmPanel) exportConfirmPanel.hidden = true;

  renderPreview([], "loading");
  renderExtraAssets({}, "loading");
  setFeedback(
    currentRewardEnabled
      ? "正在生成 cover、icon、banner、赞赏引导图、赞赏感谢图与表情预览。"
      : "正在生成 cover、icon、banner 与表情预览。",
    "loading"
  );
  setExportInfo("结果概览与导出信息", "正在生成中，请稍候。");
  renderMetadataPreview(null, "loading");

  try {
    const payload = {
      referenceAssetId: currentUploadId,
      prompt,
      provider: wechatAiProvider ? wechatAiProvider.value : "mock",
      styles: currentStyles.length ? currentStyles : undefined,
      stickerCount,
      enableReward: currentRewardEnabled,
      includeCover: true,
      includeIcon: true,
      includeBanner: true,
      metadata:
        title || author || version || copyright || rewardMessage
          ? {
              ...(title ? { title } : {}),
              ...(author ? { author } : {}),
              ...(version ? { version } : {}),
              ...(copyright ? { copyright } : {}),
              ...(rewardMessage ? { rewardMessage } : {})
            }
          : undefined
    };

    const stickers = [];
    const extras = {};
    let totalCount = stickerCount;

    cancelRequested = false;
    sseAbortController = new AbortController();
    const startRes = await fetch("/api/wechat/generate/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    });
    const startJson = await startRes.json();
    if (!startRes.ok || !startJson?.taskId) throw new Error("生成失败，请稍后重试。");
    currentTaskId = startJson.taskId;

    const decoder = new TextDecoder();
    let buffer = "";
    let lastEventId = 0;
    let completed = false;
    const maxRetries = 3;
    const baseBackoff = 500;

    const handleEvent = (eventName, data) => {
      if (eventName === "start") {
        totalCount = Number(data?.count || stickerCount);
        setStatus(generateState, `生成中 (0/${totalCount})`, "loading");
        return;
      }
      if (eventName === "progress") {
        const current = Number(data?.current || 0);
        setStatus(generateState, `生成中 (${current}/${totalCount})`, "loading");
        return;
      }
      if (eventName === "sticker") {
        stickers.push({ label: data.label, assetId: data.assetId, url: data.url, prompt: data.prompt });
        renderPreview(stickers, "loading");
        const current = Number(data?.current || stickers.length);
        setStatus(generateState, `生成中 (${current}/${totalCount})`, "loading");
        return;
      }
      if (eventName === "extra") {
        if (data?.key) {
          extras[data.key] = data.assetId ?? null;
          extras[`${data.key}_prompt`] = data.prompt ?? null;
        }
        renderExtraAssets(extras, "loading");
        const current = Number(data?.current || 0);
        setStatus(generateState, `生成中 (${current}/${totalCount})`, "loading");
        return;
      }
      if (eventName === "done") {
        const json = data;
        currentRewardEnabled = Boolean(json?.meta?.rewardEnabled ?? currentRewardEnabled);
        currentRewardMessage = json?.meta?.rewardMessage ?? rewardMessage;
        wechatAiRewardEnabled.checked = currentRewardEnabled;
        wechatAiRewardMessage.value = currentRewardMessage;
        syncRewardFields();
        lastPackResult = json;
        renderPreview(stickers, "success");
        renderExtraAssets(json?.extras ?? {}, "success");
        
        const exportConfirmPanel = document.getElementById("exportConfirmPanel");
        if (exportConfirmPanel) exportConfirmPanel.hidden = false;
        
        renderDownload(json?.packId, json?.downloadUrl, json?.downloadFilename);
        renderActions(json);
        persistLastGeneratedResult(json);
        setStatus(generateState, "生成完成", "success");
        setNotice("表情包已生成完成，可以先预览，再下载 ZIP。", "success");
        setFeedback(
          currentRewardEnabled
            ? "已生成 cover、icon、banner、赞赏引导图、赞赏感谢图与表情预览，可继续重新生成当前方案。"
            : "已生成 cover、icon、banner 与表情预览，可继续重新生成当前方案。",
          "success"
        );

        renderExportInfo(json);
        renderMetadataPreview(json);
      }
      if (eventName === "error") {
        const msg = String(data?.message || "");
        if (msg.includes("取消")) {
          cancelRequested = true;
          setStatus(generateState, "已取消", "error");
          setNotice("已取消本次生成。", "error");
          setFeedback("本次生成已取消，可直接点击重新生成再次尝试。", "error");
          setGenerateButtonsBusy(false);
          return;
        }
        const err = new Error(msg || "生成失败，请稍后重试。");
        err.isServerError = true;
        throw err;
      }
    };

    for (let attempt = 0; attempt <= maxRetries && !completed && !cancelRequested; attempt++) {
      const headers = { accept: "text/event-stream" };
      if (lastEventId > 0) headers["Last-Event-ID"] = String(lastEventId);
      const res = await fetch(`/api/wechat/generate/stream?taskId=${encodeURIComponent(currentTaskId)}`, {
        method: "GET",
        headers,
        signal: sseAbortController.signal
      });
      if (!res.ok) throw new Error("生成失败，请稍后重试。");
      const reader = res.body?.getReader?.();
      if (!reader) throw new Error("生成失败，请稍后重试。");
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
          let idx;
          while ((idx = buffer.indexOf("\n\n")) !== -1) {
            const chunk = buffer.slice(0, idx);
            buffer = buffer.slice(idx + 2);
            if (!chunk.trim()) continue;
            let eventName = "message";
            let dataText = "";
            let idText = "";
            for (const line of chunk.split("\n")) {
              if (line.startsWith("id:")) idText = line.slice(3).trim();
              if (line.startsWith("event:")) eventName = line.slice(6).trim();
              if (line.startsWith("data:")) dataText += (dataText ? "\n" : "") + line.slice(5).trim();
            }
            if (!dataText) continue;
            if (idText) {
              const n = Number(idText);
              if (Number.isFinite(n)) lastEventId = n;
            }
            const data = JSON.parse(dataText);
            handleEvent(eventName, data);
            if (eventName === "done") completed = true;
          }
        }
      } catch (e) {
        if (cancelRequested) break;
        if (e.isServerError) throw e;
        
        if (!completed && attempt < maxRetries) {
          setStatus(generateState, "网络波动，正在重连...", "loading");
          const backoff = baseBackoff * Math.pow(2, attempt);
          await new Promise((r) => setTimeout(r, backoff));
          continue;
        } else {
          throw e;
        }
      }
    }
  } catch (error) {
    if (cancelRequested) {
      // 保留已渲染的部分结果，不清空
      setGenerateButtonsBusy(false);
    } else {
      if (lastPackResult) {
        renderActions(lastPackResult);
        renderExportInfo(lastPackResult);
        renderMetadataPreview(lastPackResult);
        const exportConfirmPanel = document.getElementById("exportConfirmPanel");
        if (exportConfirmPanel) exportConfirmPanel.hidden = false;
      } else {
        renderMetadataPreview(null, "error");
      }
      setStatus(generateState, "生成失败", "error");
      setNotice(error instanceof Error ? error.message : "生成失败，请稍后重试。", "error");
      renderPreview([], "error");
      renderExtraAssets({}, "error");
      setFeedback("本次生成失败，可直接点击重新生成再次尝试。", "error");
      setExportInfo("结果概览与导出信息", "生成失败，请调整提示词或稍后重试。");
    }
  } finally {
    setGenerateButtonsBusy(false);
  }
}

async function handleFileUpload() {
  const file = fileInput.files?.[0];
  if (!file) {
    setNotice("请选择一张图片后再上传。", "error");
    setStatus(uploadState, "缺少图片", "error");
    return;
  }

  setStatus(uploadState, "上传中...", "loading");
  setNotice("正在上传参考图...", "info");
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

    setStatus(uploadState, "上传成功", "success");
    setNotice("参考图已上传，正在为你准备推荐提示词。", "success");
    setExportInfo("结果概览与导出信息", "参考图已就绪，下一步补充提示词并生成表情包。");

    try {
      await suggestPrompt({ silent: true });
    } catch (promptError) {
      setNotice(
        promptError instanceof Error ? promptError.message : "参考图已上传，请手动生成提示词。",
        "error"
      );
    }
  } catch (error) {
    currentUploadId = null;
    hasGenerationAttempted = false;
    originalPreview.removeAttribute("src");
    setStatus(uploadState, "上传失败", "error");
    setNotice(error instanceof Error ? error.message : "上传失败，请稍后重试。", "error");
    syncRegenerateButton();
  }
}

fileInput?.addEventListener("change", async () => {
  if (fileInput.files?.length > 0) {
    await handleFileUpload();
  }
});

uploadForm.addEventListener("submit", (event) => {
  event.preventDefault();
});



wechatAiPrompt.addEventListener("input", () => {
  setFieldInvalid(wechatAiPrompt, false);
  syncRegenerateButton();
});

wechatAiTitle.addEventListener("input", () => {
  setFieldInvalid(wechatAiTitle, false);
});

wechatAiAuthor.addEventListener("input", () => {
  setFieldInvalid(wechatAiAuthor, false);
});

wechatAiCount.addEventListener("change", () => {
  setFieldInvalid(wechatAiCount, false);
  setPromptHint(currentStyles);
});

wechatAiCount.addEventListener("keydown", (event) => {
  const key = event?.key;
  if (key === "ArrowUp") {
    event.preventDefault?.();
    setCountValue(Number(wechatAiCount.value || DEFAULT_STICKER_COUNT) + 1);
  } else if (key === "ArrowDown") {
    event.preventDefault?.();
    setCountValue(Number(wechatAiCount.value || DEFAULT_STICKER_COUNT) - 1);
  }
});

wechatAiCount.addEventListener("input", () => {
  setCountValue(Number(wechatAiCount.value || DEFAULT_STICKER_COUNT));
});

wechatAiCountDec?.addEventListener("click", () => {
  setCountValue(Number(wechatAiCount.value || DEFAULT_STICKER_COUNT) - 1);
});

wechatAiCountInc?.addEventListener("click", () => {
  setCountValue(Number(wechatAiCount.value || DEFAULT_STICKER_COUNT) + 1);
});

wechatAiRewardEnabled.addEventListener("change", () => {
  syncRewardFields();
  setPromptHint(currentStyles);
  renderExtraAssets(lastPackResult?.extras ?? {}, lastPackResult ? "success" : "idle");
});

cancelGenerate?.addEventListener("click", async () => {
  try {
    if (currentTaskId) {
      await fetch("/api/wechat/generate/cancel", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ taskId: currentTaskId })
      });
    }
    cancelRequested = true;
    sseAbortController?.abort?.();
  } catch {
    // ignore
  } finally {
    setGenerateButtonsBusy(false);
  }
});

wechatAiStyleOptions.addEventListener("focus", (event) => {
  if (event?.target === wechatAiStyleOptions) {
    const chips = Array.from(wechatAiStyleOptions.querySelectorAll(".style-chip"));
    const firstSelected = chips.find((btn) => btn.dataset.selected === "true");
    (firstSelected || chips[0])?.focus?.();
  }
});

wechatAiStyleOptions.addEventListener("keydown", (event) => {
  const key = event?.key;
  const chips = Array.from(wechatAiStyleOptions.querySelectorAll(".style-chip"));
  if (!chips.length) return;
  const currentIndex = Math.max(
    0,
    chips.findIndex((btn) => btn === document.activeElement)
  );
  let nextIndex = currentIndex;
  if (key === "ArrowRight" || key === "ArrowDown") {
    event.preventDefault?.();
    nextIndex = currentIndex + 1 >= chips.length ? 0 : currentIndex + 1;
    chips[nextIndex]?.focus?.();
  } else if (key === "ArrowLeft" || key === "ArrowUp") {
    event.preventDefault?.();
    nextIndex = currentIndex - 1 < 0 ? chips.length - 1 : currentIndex - 1;
    chips[nextIndex]?.focus?.();
  } else if (key === "Home") {
    event.preventDefault?.();
    chips[0]?.focus?.();
  } else if (key === "End") {
    event.preventDefault?.();
    chips[chips.length - 1]?.focus?.();
  } else if (key === "Enter" || key === " ") {
    event.preventDefault?.();
    const active = chips[currentIndex];
    active?.click?.();
  }
});

wechatAiForm.addEventListener("keydown", async (event) => {
  if (event?.ctrlKey && event?.key === "Enter") {
    event.preventDefault?.();
    await generateWechatPack();
  }
});
wechatAiProvider.addEventListener("change", () => {
  currentAiProvider = wechatAiProvider.value;
});

wechatAiRewardMessage.addEventListener("input", () => {
  currentRewardMessage = wechatAiRewardMessage.value.trim();
  setFieldInvalid(wechatAiRewardMessage, false);
});

wechatAiForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  await generateWechatPack();
});

regenerateSubmit.addEventListener("click", async () => {
  await generateWechatPack();
});

wechatAiMetadataPreview.addEventListener("click", async (event) => {
  await handleConfirmCardClick("metadata", event);
});

wechatAiExportInfo.addEventListener("click", async (event) => {
  await handleConfirmCardClick("exportInfo", event);
});

resetSubmit.addEventListener("click", () => {
  resetAllState();
});

originalPreview.addEventListener("error", () => {
  originalPreview.removeAttribute("src");
  syncOriginalPreviewSlot();
  setStatus(uploadState, "图片加载失败", "error");
  setNotice("图片加载失败，请重新上传。", "error");
});

async function initApp() {
  try {
    const configRes = await fetch("/api/config");
    if (configRes.ok) {
      const config = await configRes.json();
      if (config?.wechat) {
        DEFAULT_STYLE_OPTIONS = config.wechat.styles || DEFAULT_STYLE_OPTIONS;
        MIN_STICKER_COUNT = config.wechat.minStickerCount || MIN_STICKER_COUNT;
        MAX_STICKER_COUNT = config.wechat.maxStickerCount || MAX_STICKER_COUNT;
        DEFAULT_STICKER_COUNT = config.wechat.defaultStickerCount || DEFAULT_STICKER_COUNT;
        
        if (config.wechat.availableProviders && wechatAiProvider) {
          wechatAiProvider.innerHTML = "";
          config.wechat.availableProviders.forEach(p => {
            const option = document.createElement("option");
            option.value = p.id;
            option.textContent = p.name;
            wechatAiProvider.appendChild(option);
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
  syncRewardFields();
  resetGenerationResult({ clearPersisted: false });
  setPromptHint(currentStyles);
  restorePersistedPackResult();
}

initApp();
