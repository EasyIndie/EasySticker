/* ===== Auth Module ===== */
(function(){
  const TOKEN_KEY = 'easysticker_token';
  const USER_KEY = 'easysticker_user';
  let authToken = localStorage.getItem(TOKEN_KEY) || null;
  let authUser = JSON.parse(localStorage.getItem(USER_KEY) || 'null');

  async function api(url, opts = {}) {
    const headers = opts.headers || {};
    if (authToken) {
      headers['Authorization'] = `Bearer ${authToken}`;
    }
    const res = await fetch(url, { ...opts, headers });
    if (res.status === 401 && !url.includes('/auth/')) {
      logout();
      showAuth();
      throw new Error('Session expired. Please log in again.');
    }
    return res;
  }

  function login(token, user) {
    authToken = token;
    authUser = user;
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_KEY, JSON.stringify(user));
    updateUI();
  }

  function logout() {
    authToken = null;
    authUser = null;
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    updateUI();
  }

  function isLoggedIn() {
    return !!authToken && !!authUser;
  }

  function getUser() {
    return authUser;
  }

  function getToken() {
    return authToken;
  }

  const overlay = document.getElementById('authOverlay');
  const authTitle = document.getElementById('authTitle');
  const authSubtitle = document.getElementById('authSubtitle');
  const authForm = document.getElementById('authForm');
  const authSubmit = document.getElementById('authSubmit');
  const loginEmail = document.getElementById('loginEmail');
  const loginPassword = document.getElementById('loginPassword');
  const authError = document.getElementById('authError');
  const authToggle = document.getElementById('authToggle');
  const authSwitch = document.getElementById('authSwitch');
  const authQuotaBar = document.getElementById('authQuotaBar');
  const quotaDisplay = document.getElementById('quotaDisplay');
  const userBadge = document.getElementById('userBadge');
  const loginBtn = document.getElementById('loginBtn');

  let isRegisterMode = false;

  function showAuth() {
    if (!overlay) return;
    overlay.removeAttribute('hidden');
  }

  // Close auth overlay on backdrop click
  overlay.addEventListener('click', function (e) {
    if (e.target === overlay) hideAuth();
  });

  // Close auth overlay on Escape
  document.addEventListener('keydown', function escHandler(e) {
    if (e.key === 'Escape' && !overlay.hasAttribute('hidden')) {
      hideAuth();
    }
  });

  function hideAuth() {
    if (overlay) overlay.setAttribute('hidden', '');
    loadQuota();
  }

  function updateUI() {
    const adminEntry = document.getElementById('adminEntry');
    if (isLoggedIn()) {
      if (userBadge) {
        userBadge.textContent = authUser.email;
        userBadge.removeAttribute('hidden');
      }
      if (loginBtn) loginBtn.textContent = '🚪';
      loginBtn.title = '注销';
      // Show admin entry for admin users
      if (adminEntry) {
        if (authUser.role === 'admin') {
          adminEntry.removeAttribute('hidden');
        } else {
          adminEntry.setAttribute('hidden', '');
        }
      }
      hideAuth();
    } else {
      if (userBadge) userBadge.setAttribute('hidden', '');
      if (adminEntry) adminEntry.setAttribute('hidden', '');
      if (loginBtn) loginBtn.textContent = '👤';
      loginBtn.title = '登录';
      // Don't show auth overlay — let user click to login
    }
  }

  function toggleMode() {
    isRegisterMode = !isRegisterMode;
    const inviteField = document.getElementById('inviteField');
    if (isRegisterMode) {
      authTitle.textContent = '注册 EasySticker';
      authSubtitle.textContent = '创建一个账户以使用生成服务';
      authSubmit.textContent = '注册';
      authToggle.textContent = '已有账户？登录';
      if (inviteField) inviteField.removeAttribute('hidden');
    } else {
      authTitle.textContent = '登录 EasySticker';
      authSubtitle.textContent = '输入邮箱和密码进入工作台';
      authSubmit.textContent = '登录';
      authToggle.textContent = '没有账户？注册';
      if (inviteField) inviteField.setAttribute('hidden', '');
    }
  }

  async function loadQuota() {
    if (!isLoggedIn() || !quotaDisplay || !authQuotaBar) return;
    try {
      const res = await api('/api/auth/quota');
      if (res.ok) {
        const data = await res.json();
        quotaDisplay.textContent = `${data.used} / ${data.remaining + data.used}`;
        authQuotaBar.removeAttribute('hidden');
      }
    } catch {}
  }

  // Auth form handler
  if (authForm) {
    authForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = loginEmail.value.trim();
      const password = loginPassword.value;
      authError.setAttribute('hidden', '');
      authSubmit.disabled = true;
      authSubmit.textContent = isRegisterMode ? '注册中...' : '登录中...';

      try {
        let url, body;
        if (isRegisterMode) {
          url = '/api/auth/register';
          const inviteTokenInput = document.getElementById('inviteToken');
          const adminToken = inviteTokenInput ? inviteTokenInput.value.trim() : '';
          body = { email, password };
          if (adminToken) body.adminToken = adminToken;
        } else {
          url = '/api/auth/login';
          body = { email, password };
        }
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });
        const data = await res.json();
        if (!res.ok) {
          authError.textContent = data.message || 'Authentication failed';
          authError.removeAttribute('hidden');
          return;
        }
        login(data.token, data.user);
      } catch (err) {
        authError.textContent = 'Network error. Please try again.';
        authError.removeAttribute('hidden');
      } finally {
        authSubmit.disabled = false;
        authSubmit.textContent = isRegisterMode ? '注册' : '登录';
      }
    });
  }

  if (authToggle) {
    authToggle.addEventListener('click', (e) => {
      e.preventDefault();
      toggleMode();
    });
  }

  if (loginBtn) {
    loginBtn.addEventListener('click', () => {
      if (isLoggedIn()) {
        logout();
      } else {
        showAuth();
      }
    });
  }

  // Auth close button
  const authClose = document.getElementById('authClose');
  if (authClose) {
    authClose.addEventListener('click', hideAuth);
  }

  // Expose to global scope
  window._auth = { api, login, logout, isLoggedIn, getUser, getToken, loadQuota };

  // Check auth on load — don't block UI, just silently check
  if (isLoggedIn()) {
    hideAuth();
    loadQuota();
    // userBadge already hidden by default, show it if logged in
    updateUI();
  }
})();
/* ===== End Auth Module ===== */

const uploadForm = document.getElementById("uploadForm");
const fileInput = document.getElementById("file");
const uploadState = document.getElementById("uploadState");
const importForm = document.getElementById("importForm");
const importFiles = document.getElementById("importFiles");
const importCover = document.getElementById("importCover");
const importIcon = document.getElementById("importIcon");
const importBanner = document.getElementById("importBanner");
const importRewardGuide = document.getElementById("importRewardGuide");
const importRewardThanks = document.getElementById("importRewardThanks");
const importState = document.getElementById("importState");
const originalPreview = document.getElementById("originalPreview");
const creationModeAi = document.getElementById("creationModeAi");
const creationModeImport = document.getElementById("creationModeImport");
const aiSourceSection = document.getElementById("aiSourceSection");
const importSourceSection = document.getElementById("importSourceSection");
const aiConfigFields = document.getElementById("aiConfigFields");
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
const generationProgressWrap = document.getElementById("generationProgressWrap");
const generationProgressBar = document.getElementById("generationProgressBar");
const generationProgressPct = document.getElementById("generationProgressPct");
const historySection = document.getElementById("historySection");
const historyList = document.getElementById("historyList");
const clearHistoryBtn = document.getElementById("clearHistory");
const originalPreviewPlaceholder = document.getElementById("originalPreviewPlaceholder");
const platformSelector = document.getElementById("platformSelector");
const platformRadios = document.querySelectorAll('input[name="platform"]');
const stickyActionBar = document.getElementById("stickyActionBar");
const stickyStatus = document.getElementById("stickyStatus");
const stickyRegenerate = document.getElementById("stickyRegenerate");
const stickyDownload = document.getElementById("stickyDownload");
const stickyReset = document.getElementById("stickyReset");
const viewTabs = document.getElementById("viewTabs");
const configArea = document.querySelector(".config-area");
const previewArea = document.querySelector(".preview-area");

function getSelectedPlatform() {
  const checked = document.querySelector('input[name="platform"]:checked');
  return checked ? checked.value : "wechat_stickers";
}

function setSelectedPlatform(value) {
  platformRadios.forEach(r => { r.checked = r.value === value; });
}

function setPlatformDisabled(disabled) {
  platformRadios.forEach(r => { r.disabled = disabled; });
}

let DEFAULT_STYLE_OPTIONS = ["扁平插画", "3D 卡通", "日系 Q 版", "像素风", "国潮风"];
const LAST_WECHAT_PACK_STORAGE_KEY = "easysticker:last-wechat-pack";
const PACK_HISTORY_STORAGE_KEY = "easysticker:pack-history";
const MAX_HISTORY = 10;
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

// ========== Multi-Platform Support ==========
const PLATFORM_SPECS = {
  wechat_stickers: {
    minCount: 8, maxCount: 24, defaultCount: 8,
    showsStyle: true, showsPrompt: true,
    showsReward: true, showsExtraAssets: true, showsMetadata: true,
    showsTitle: true, showsAuthor: true, showsVersion: true, showsCopyright: true,
    previewLabel: "240 × 240", fileFormat: "PNG",
    extraAssetDefs: [...BASE_EXTRA_ASSET_DEFS, ...REWARD_EXTRA_ASSET_DEFS],
    outputFormat: "png",
    exportHint: "此 ZIP 中包含符合微信表情包规范的资源文件。",
    platformLabel: "微信表情包",
    countHint: "推荐 8-24 张，系统会额外补齐封面、图标和横幅资源。",
    heroText: "上传参考图，补充提示词，一键生成可预览、可下载的微信表情包。",
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
    extraAssetDefs: [],
    outputFormat: "png",
    exportHint: "此 ZIP 中包含 PNG 贴纸文件，可直接用于 Telegram。",
    platformLabel: "Telegram 贴纸",
    countHint: "推荐 1-50 张。",
    heroText: "上传参考图，补充提示词，一键生成可预览、可下载的 Telegram 贴纸包。",
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
    extraAssetDefs: [],
    outputFormat: "webp",
    exportHint: "此 ZIP 中包含 .webp 贴纸文件，可直接用于 WhatsApp。",
    platformLabel: "WhatsApp 贴纸",
    countHint: "推荐 1-30 张。",
    heroText: "上传参考图，补充提示词，一键生成可预览、可下载的 WhatsApp 贴纸包。",
    importDesc: "已有成品图片时，可直接批量导入并自动规范为 WhatsApp 贴纸规格。",
    importHint: "导入后会统一居中、等比缩放、补透明边，并转换为符合 WhatsApp 贴纸规格的 WebP。",
    importHeading: "导入贴纸图",
    importUploadText: "支持 WebP，建议一次导入 1-30 张。",
    importAccept: "image/webp",
    generateDesc: "基于上传图和提示词自动生成并打包。"
  }
};
let currentPlatform = "wechat_stickers";
let currentMobileView = "config";

const STEP_NAV_ITEMS = [
  { step: 0, label: "选择平台" },
  { step: 1, label: "上传参考图" },
  { step: 2, label: "配置参数" },
  { step: 3, label: "生成" },
  { step: 4, label: "预览下载" }
];

let DEFAULT_STICKER_COUNT = PLATFORM_SPECS.wechat_stickers.defaultCount;
let MIN_STICKER_COUNT = PLATFORM_SPECS.wechat_stickers.minCount;
let MAX_STICKER_COUNT = PLATFORM_SPECS.wechat_stickers.maxCount;
let STICKER_PREVIEW_SPEC = PLATFORM_SPECS.wechat_stickers.previewLabel;

const PLACEHOLDER_STATE_TEXT = {
  idle: "等待生成",
  loading: "生成中，完成后自动展示",
  error: "生成失败，可点击重新生成",
  success: "本次结果未返回该资源"
};
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
  let lastProgressTotal = 0;
  let lastProgressCurrent = 0;
  let availableStyles = [...DEFAULT_STYLE_OPTIONS];
  let currentRewardEnabled = false;
  let currentRewardMessage = "";
  let currentAiProvider = "mock";
  let currentCreationMode = "ai";
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

// ========== Scroll Helpers ==========
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

// ========== Step Card Collapse ==========
function collapseStepCard(cardEl, summaryText, tone = "success") {
  if (!cardEl || cardEl.classList.contains("collapsed")) return;

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

function expandAllStepCards() {
  document.querySelectorAll(".step-card.collapsed").forEach(card => {
    card.classList.remove("collapsed");
  });
}

// ========== Step Navigation ==========
function updateStepNav(activeStep, completedSteps = []) {
  const nav = document.getElementById("stepNav");
  if (!nav) return;

  const items = nav.querySelectorAll(".step-nav-item");
  items.forEach((item, idx) => {
    item.classList.remove("active", "completed");
    if (idx === activeStep) item.classList.add("active");
    else if (completedSteps.includes(idx)) item.classList.add("completed");

    item.onclick = () => {
      const targetStep = parseInt(item.dataset.step);
      scrollToStep(targetStep);
    };
  });
}

function scrollToStep(stepIndex) {
  if (stepIndex <= 3) {
    const cards = configArea?.querySelectorAll(".step-card");
    if (cards && cards[stepIndex]) {
      scrollToElement(cards[stepIndex], { block: "start" });
    }
  } else if (stepIndex === 4) {
    const cards = previewArea?.querySelectorAll(".step-card");
    if (cards && cards[0]) {
      scrollToElement(cards[0], { block: "start" });
    }
  }
}

// ========== Mobile View Tabs ==========
function syncMobileView(view) {
  if (!configArea || !previewArea || !viewTabs) return;

  const tabs = viewTabs.querySelectorAll(".view-tab");
  tabs.forEach(t => {
    t.classList.toggle("active", t.dataset.view === view);
    t.setAttribute("aria-pressed", t.dataset.view === view ? "true" : "false");
  });

  configArea.hidden = view !== "config";
  previewArea.hidden = view !== "preview";

  if (view === "preview") {
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
}

function initMobileViewTabs() {
  if (!viewTabs) return;
  viewTabs.querySelectorAll(".view-tab").forEach(tab => {
    tab.addEventListener("click", () => {
      syncMobileView(tab.dataset.view);
    });
  });
}

// ========== Sticky Action Bar ==========
function showStickyBar(packTitle, packId, downloadUrl, downloadFilename) {
  if (!stickyActionBar) return;
  if (stickyStatus) stickyStatus.textContent = packTitle ? `✅ ${packTitle}` : "✅ 已生成";
  stickyActionBar.hidden = false;

  // Wire download
  if (stickyDownload && downloadUrl) {
    const newDownload = stickyDownload.cloneNode(true);
    stickyDownload.parentNode.replaceChild(newDownload, stickyDownload);
    const stickyDownloadRef = document.getElementById("stickyDownload");
    if (stickyDownloadRef) {
      stickyDownloadRef.addEventListener("click", () => {
        const a = document.createElement("a");
        a.href = downloadUrl;
        a.download = downloadFilename || `${packId}.zip`;
        a.click();
      });
    }
  }
}

function hideStickyBar() {
  if (stickyActionBar) stickyActionBar.hidden = true;
}

function initStickyBarButtons() {
  if (stickyRegenerate) {
    stickyRegenerate.addEventListener("click", async () => {
      if (currentCreationMode === "ai") {
        expandAllStepCards();
        scrollToElement(document.querySelector(".config-area"), { block: "start" });
        await generatePlatformPack();
      }
    });
  }
  if (stickyReset) {
    stickyReset.addEventListener("click", () => {
      expandAllStepCards();
      resetAllState();
      hideStickyBar();
    });
  }
}

// ========== Platform UI Sync ==========
function syncPlatformUI() {
  const spec = PLATFORM_SPECS[currentPlatform];

  // Update global limits
  MIN_STICKER_COUNT = spec.minCount;
  MAX_STICKER_COUNT = spec.maxCount;
  DEFAULT_STICKER_COUNT = spec.defaultCount;
  STICKER_PREVIEW_SPEC = spec.previewLabel;

  // Update count stepper attributes
  if (wechatAiCount) {
    wechatAiCount.min = spec.minCount;
    wechatAiCount.max = spec.maxCount;
    const currentVal = Number(wechatAiCount.value || DEFAULT_STICKER_COUNT);
    setCountValue(currentVal);
  }

  // Show/hide platform-specific fields
  const rewardField = document.getElementById("wechatAiRewardField");
  if (rewardField) rewardField.hidden = !spec.showsReward;

  const importExtraSection = document.getElementById("importExtraSection");
  if (importExtraSection) importExtraSection.hidden = !spec.showsExtraAssets;

  const metadataSection = document.getElementById("wechatAiMetadataSection");
  if (metadataSection) metadataSection.hidden = !spec.showsMetadata;

  const versionField = document.getElementById("wechatAiVersionField");
  if (versionField) versionField.hidden = !spec.showsVersion;

  const copyrightField = document.getElementById("wechatAiCopyrightField");
  if (copyrightField) copyrightField.hidden = !spec.showsCopyright;

  const titleField = document.getElementById("wechatAiTitleField");
  if (titleField) titleField.hidden = !spec.showsTitle;

  const authorField = document.getElementById("wechatAiAuthorField");
  if (authorField) authorField.hidden = !spec.showsAuthor;

  // Update count hint text
  const countHint = document.getElementById("wechatAiCountHint");
  if (countHint) countHint.textContent = spec.countHint;

  // Update hero elements
  const heroBadge = document.getElementById("heroBadge");
  if (heroBadge) heroBadge.textContent = spec.platformLabel + " AI 表情流程";

  const heroText = document.getElementById("heroText");
  if (heroText) heroText.textContent = spec.heroText;

  // Update import section
  const importSectionDesc = document.getElementById("importSectionDesc");
  if (importSectionDesc) importSectionDesc.textContent = spec.importDesc;

  const importHint = document.getElementById("importHint");
  if (importHint) importHint.textContent = spec.importHint;

  const importHeading = document.getElementById("importHeading");
  if (importHeading) importHeading.textContent = spec.importHeading;

  const importUploadText = document.getElementById("importUploadText");
  if (importUploadText) importUploadText.textContent = spec.importUploadText;

  const importFiles = document.getElementById("importFiles");
  if (importFiles) importFiles.accept = spec.importAccept;

  // Update generate section description
  const generateSectionDesc = document.getElementById("generateSectionDesc");
  if (generateSectionDesc) generateSectionDesc.textContent = spec.generateDesc;

  // Update prompt hint
  setPromptHint(currentStyles);

  // Update preview spec labels on existing rendered items
  document.querySelectorAll(".preview-spec").forEach(el => {
    el.textContent = STICKER_PREVIEW_SPEC;
  });

  // Lock/unlock platform selector
  setPlatformDisabled(hasGenerationAttempted && lastPackResult ? true : false);
  if (getSelectedPlatform() !== currentPlatform) {
    setSelectedPlatform(currentPlatform);
  }

  // Reset validation since limits changed
  clearGenerateValidation();

  // If reward was enabled but platform doesn't support, disable it
  if (!spec.showsReward && currentRewardEnabled) {
    currentRewardEnabled = false;
    if (wechatAiRewardEnabled) wechatAiRewardEnabled.checked = false;
    syncRewardFields();
  }
}

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
  const spec = PLATFORM_SPECS[currentPlatform];
  let extraText = "";
  if (spec.showsExtraAssets) {
    extraText = currentRewardEnabled
      ? "，并附带赞赏引导图和感谢图"
      : "，并自动补齐封面、图标和横幅";
  }
  promptHint.textContent = Array.isArray(styles) && styles.length
    ? `已加载推荐风格：${styles.join("、")}。建议在提示词中补充主体、情绪、动作和背景限制。当前生成 ${count} 张表情${extraText}。`
    : `建议在提示词中补充主体、情绪、动作和背景限制。当前生成 ${count} 张表情${extraText}。`;
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
    currentStyles = [availableStyles[0]];
  } else if (currentStyles.length > 1) {
    currentStyles = [currentStyles[0]];
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
    return null;
  }

  const result = raw.result;
  if (!result || typeof result !== "object" || typeof result.packId !== "string" || typeof result.downloadUrl !== "string") {
    return null;
  }

  // Backward compat: if no platform field, default to wechat_stickers
  const platform = (typeof raw.platform === "string" && PLATFORM_SPECS[raw.platform])
    ? raw.platform
    : "wechat_stickers";

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
  addToPackHistory(result);
}

function restorePersistedPackResult() {
  const storage = getStorage();
  if (!storage) return false;

  try {
    const rawText = storage.getItem(LAST_WECHAT_PACK_STORAGE_KEY);
    if (!rawText) return false;

    const restored = sanitizePersistedPackResult(JSON.parse(rawText));
    if (!restored) {
      clearPersistedPackResult();
      return false;
    }

    // Restore platform
    currentPlatform = restored.platform;
    setSelectedPlatform(currentPlatform);

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

    syncPlatformUI();
    syncRewardFields();
    renderStyleOptions(DEFAULT_STYLE_OPTIONS);
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

// ========== Pack History (localStorage array) ==========

function getPackHistory() {
  const storage = getStorage();
  if (!storage) return [];
  try {
    const raw = storage.getItem(PACK_HISTORY_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.slice(0, MAX_HISTORY) : [];
  } catch {
    return [];
  }
}

function savePackHistory(history) {
  const storage = getStorage();
  if (!storage) return;
  try {
    storage.setItem(PACK_HISTORY_STORAGE_KEY, JSON.stringify(history.slice(0, MAX_HISTORY)));
  } catch {
    // ignore quota errors
  }
}

function addToPackHistory(result) {
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
}

function renderPackHistory() {
  const history = getPackHistory();
  if (!historySection || !historyList) return;
  if (history.length === 0) {
    historySection.hidden = true;
    return;
  }
  historySection.hidden = false;
  
  if (history.length === 0) {
    historyList.innerHTML = '<div class="history-empty">暂无历史记录</div>';
    return;
  }

  historyList.innerHTML = history
    .map(
      (entry) => `
      <div class="history-item" data-pack-id="${escapeAttr(entry.packId)}">
        <div class="history-item-meta">
          <div class="history-item-title">${escapeHtml(entry.title)}</div>
          <div class="history-item-sub">${escapeHtml(entry.author ? entry.author + " · " : "")}${entry.stickerCount} 张${entry.styles ? " · " + escapeHtml(entry.styles) : ""}${entry.rewardEnabled ? " · 含赞赏" : ""}${entry.platformLabel ? " · " + escapeHtml(entry.platformLabel) : ""} · ${formatTimeAgo(entry.createdAt) || "刚刚"}</div>
        </div>
        <div class="history-item-actions">
          <button type="button" class="secondary history-dl-btn" data-pack-id="${escapeAttr(entry.packId)}" data-dl-url="${escapeAttr(entry.downloadUrl)}" data-filename="${escapeAttr(entry.downloadFilename)}">下载</button>
        </div>
      </div>
    `
    )
    .join("");
    
  historyList.querySelectorAll(".history-dl-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const url = btn.dataset.dlUrl;
      const filename = btn.dataset.filename;
      if (url) {
        const a = document.createElement("a");
        a.href = url;
        a.download = filename || "pack.zip";
        a.click();
      }
    });
  });
}

function clearPackHistory() {
  savePackHistory([]);
  renderPackHistory();
  setNotice("历史记录已清空", "info");
}

function formatTimeAgo(iso) {
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
  } catch {
    return "";
  }
}

function escapeAttr(str) {
  return String(str).replace(/"/g, "&quot;").replace(/'/g, "&#39;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function setBusy(button, busy, text) {
  button.disabled = busy;
  button.dataset.label = button.dataset.label || button.textContent;
  button.textContent = busy ? text : button.dataset.label;
}

function setButtonLabel(button, text) {
  if (!button) return;
  button.textContent = text;
  delete button.dataset.label;
}

function updateGenerationProgress(current, total) {
  lastProgressCurrent = current;
  lastProgressTotal = total;
  if (!generationProgressWrap || !generationProgressBar || !generationProgressPct) return;
  generationProgressWrap.hidden = false;
  const pct = total > 0 ? Math.round((current / total) * 100) : 0;
  generationProgressBar.style.setProperty("--progress-width", pct + "%");
  generationProgressPct.textContent = pct + "%";
}

function resetGenerationProgress() {
  lastProgressCurrent = 0;
  lastProgressTotal = 0;
  if (generationProgressWrap) generationProgressWrap.hidden = true;
  if (generationProgressBar) generationProgressBar.style.setProperty("--progress-width", "0%");
  if (generationProgressPct) generationProgressPct.textContent = "0%";
}

function getFriendlyErrorHint(error) {
  const msg = (error instanceof Error ? error.message : String(error)).toLowerCase();
  if (msg.includes("timed out") || msg.includes("timeout") || msg.includes("超时")) {
    return "生成超时，建议减少贴纸数量或尝试切换到其他 AI 提供商。";
  }
  if (msg.includes("api key") || msg.includes("unauthorized") || msg.includes("401") || msg.includes("403") || msg.includes("认证") || msg.includes("token")) {
    return "AI 服务认证失败，请检查 prompt-config.json 中的 API Key 配置是否正确。";
  }
  if (msg.includes("rate limit") || msg.includes("429") || msg.includes("频率")) {
    return "AI 服务触发频率限制，请稍后再试或降低并发数。";
  }
  if (msg.includes("network") || msg.includes("fetch") || msg.includes("econnrefused") || msg.includes("enotfound") || msg.includes("网络")) {
    return "网络连接异常，请检查服务器网络和 AI 提供商服务状态。";
  }
  if (msg.includes("validation") || msg.includes("校验") || msg.includes("validate")) {
    return "生成结果未通过平台规格校验，尝试更换风格或参考图。";
  }
  if (msg.includes("cancel") || msg.includes("取消")) {
    return "生成已取消。";
  }
  return "请检查 AI 提供商配置，或尝试使用其他提供商。如果持续失败，检查 prompt-config.json 配置。";
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
  toastNotice.style.pointerEvents = "auto";
  if (toastTimer) {
    clearTimeout(toastTimer);
  }
  // Auto-hide: base 2.5s + 50ms per char, capped at 8s
  const duration = Math.min(2500 + text.length * 50, 8000);
  toastTimer = setTimeout(() => {
    toastNotice.dataset.visible = "false";
    toastNotice.style.pointerEvents = "";
  }, duration);
}

// Dismiss toast on click
toastNotice.addEventListener("click", function () {
  if (toastTimer) clearTimeout(toastTimer);
  toastNotice.dataset.visible = "false";
  toastNotice.style.pointerEvents = "";
});

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
  const spec = PLATFORM_SPECS[currentPlatform];

  if (!prompt) {
    errors.push({ target: wechatAiPrompt, message: "请先填写提示词。" });
  }

  if (spec.showsTitle && !title) {
    errors.push({ target: wechatAiTitle, message: "请填写表情包标题。" });
  }

  if (spec.showsAuthor && !author) {
    errors.push({ target: wechatAiAuthor, message: "请填写作者名。" });
  }

  if (!Number.isInteger(stickerCount) || stickerCount < MIN_STICKER_COUNT || stickerCount > MAX_STICKER_COUNT) {
    errors.push({ target: wechatAiCount, message: `贴纸数量需在 ${MIN_STICKER_COUNT}-${MAX_STICKER_COUNT} 张之间。` });
  }

  if (spec.showsStyle && !currentStyles.length) {
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
  const title = result?.meta?.title ?? "未填写";
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
  const spec = PLATFORM_SPECS[currentPlatform];

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

  const spec = PLATFORM_SPECS[currentPlatform];
  const metadata = {
    schema: "easysticker-pack@0.1",
    packId: result?.packId ?? null,
    presetId: currentPlatform,
    createdAt: null,
    metadata: {
      ...(result?.meta?.title ? { title: result.meta.title } : {}),
      ...(result?.meta?.author ? { author: result.meta.author } : {}),
      ...(spec.showsVersion && result?.meta?.version ? { version: result.meta.version } : {}),
      ...(spec.showsCopyright && result?.meta?.copyright ? { copyright: result.meta.copyright } : {}),
      ...(spec.showsReward && result?.meta?.rewardMessage ? { rewardMessage: result.meta.rewardMessage } : {})
    },
    extras: spec.showsExtraAssets ? {
      coverAssetId: result?.extras?.coverAssetId ?? null,
      bannerAssetId: result?.extras?.bannerAssetId ?? null,
      iconAssetId: result?.extras?.iconAssetId ?? null,
      rewardGuideAssetId: result?.extras?.rewardGuideAssetId ?? null,
      rewardThanksAssetId: result?.extras?.rewardThanksAssetId ?? null
    } : {},
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
  const spec = PLATFORM_SPECS[currentPlatform];
  if (!spec.showsExtraAssets) return [];
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
  return currentCreationMode === "ai" && Boolean(currentUploadId && wechatAiPrompt.value.trim() && hasGenerationAttempted);
}

function syncRegenerateButton() {
  regenerateSubmit.disabled = canRegenerate() ? false : true;
  regenerateSubmit.hidden = currentCreationMode !== "ai";
}

function setGenerateButtonsBusy(busy) {
  setBusy(generateSubmit, busy, currentCreationMode === "import" ? "导入中..." : "生成中...");
  setBusy(regenerateSubmit, busy, "重新生成中...");
  if (wechatAiProvider) {
    wechatAiProvider.disabled = busy;
  }
  if (cancelGenerate) {
    cancelGenerate.hidden = busy && currentCreationMode === "ai" ? false : true;
    cancelGenerate.disabled = busy ? false : true;
  }
  if (!busy) {
    syncRegenerateButton();
  }
}

function syncCreationMode() {
  currentCreationMode = creationModeImport?.checked ? "import" : "ai";
  if (aiSourceSection) aiSourceSection.hidden = currentCreationMode !== "ai";
  if (importSourceSection) importSourceSection.hidden = currentCreationMode !== "import";
  if (aiConfigFields) aiConfigFields.hidden = currentCreationMode !== "ai";
  setButtonLabel(generateSubmit, currentCreationMode === "import" ? "导入并打包" : "开始生成");
  regenerateSubmit.hidden = currentCreationMode !== "ai";
  cancelGenerate.hidden = true;
  clearGenerateValidation();
  syncPlatformUI();
  if (currentCreationMode === "import") {
    setStatus(generateState, "等待导入", "idle");
    setNotice("请选择已有表情图，系统会自动标准化并打包。", "info");
  } else {
    setStatus(generateState, "等待生成", "idle");
    setNotice(currentUploadId ? "参考图已就绪，可继续生成表情包。" : "先上传一张主体清晰的图片。", "info");
  }
  syncRegenerateButton();
}

function renderExtraAssets(extras = {}, tone = "idle") {
  // 清空所有额外资源容器
  wechatAiCover.innerHTML = "";
  wechatAiIcon.innerHTML = "";
  wechatAiBanner.innerHTML = "";
  wechatAiRewardGuide.innerHTML = "";
  wechatAiRewardThanks.innerHTML = "";

  const defs = getExtraAssetDefs(extras);

  // Hide all extra sections, they'll be shown if needed
  const sectionCoverIcon = document.getElementById("sectionCoverIcon");
  if (sectionCoverIcon) sectionCoverIcon.hidden = true;
  sectionBanner.hidden = true;
  sectionRewardGuide.hidden = true;
  sectionRewardThanks.hidden = true;

  if (!defs.length) return;

  for (const item of defs) {
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

    if (item.key === "coverAssetId") {
      wechatAiCover.appendChild(card);
      if (assetId && sectionCoverIcon) sectionCoverIcon.hidden = false;
    } else if (item.key === "iconAssetId") {
      wechatAiIcon.appendChild(card);
      if (assetId && sectionCoverIcon) sectionCoverIcon.hidden = false;
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
  
  const sectionCoverIcon = document.getElementById("sectionCoverIcon");
  if (sectionCoverIcon) sectionCoverIcon.hidden = true;
  sectionBanner.hidden = true;
  sectionRewardGuide.hidden = true;
  sectionRewardThanks.hidden = true;
  
  const exportConfirmPanel = document.getElementById("exportConfirmPanel");
  if (exportConfirmPanel) exportConfirmPanel.hidden = true;

  renderPreview([], "idle");
  renderExtraAssets({}, "idle");

  const spec = PLATFORM_SPECS[currentPlatform];
  const feedbackText = spec.showsExtraAssets
    ? "等待生成后展示 cover、icon、banner 与表情预览。"
    : "等待生成后展示贴纸预览。";
  setFeedback(feedbackText, "idle");
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

  // === UX: expand all cards, reset nav, hide sticky bar ===
  document.querySelectorAll(".step-card.collapsed").forEach(function (c) { expandStepCard(c); });
  updateStepNav(0, []);
  hideStickyActionBar();
  syncViewTab("config");

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
  setStatus(uploadState, "等待上传", "idle");
  setStatus(importState, "等待导入", "idle");
  syncCreationMode();
  setNotice("已重置当前配置与最近结果，请重新上传一张主体清晰的图片。", "info");
}

function renderDownload(packId, downloadUrl, filename) {
  if (!downloadUrl) return;
  const resolvedFilename = filename || `${packId}.zip`;
  const spec = PLATFORM_SPECS[currentPlatform];
  
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
      setNotice("正在准备下载文件…", "info");
      const api = (window._auth && window._auth.api) || fetch;
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
      setNotice("下载已开始，请留意浏览器下载列表。", "success");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "下载失败，请稍后重试。", "error");
    }
  });
  
  wechatAiZipLink.appendChild(link);

  // Platform export hint
  const hint = document.createElement("p");
  hint.className = "muted";
  hint.style.marginTop = "12px";
  hint.style.textAlign = "center";
  hint.style.fontSize = "var(--font-13)";
  hint.textContent = spec.exportHint;
  wechatAiZipLink.appendChild(hint);
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
  const api = (window._auth && window._auth.api) || fetch;
  const response = await api(url, options);
  const json = await parseJson(response);
  if (!response.ok) {
    throw new Error(json?.message || "请求失败，请稍后重试");
  }
  return json;
}

async function suggestPrompt() {
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
  } catch (error) {
    // 忽略后台提示词生成错误，不影响主流程
  }
}

function getMetadataPayload() {
  const spec = PLATFORM_SPECS[currentPlatform];
  const title = spec.showsTitle ? wechatAiTitle.value.trim() : "";
  const author = spec.showsAuthor ? wechatAiAuthor.value.trim() : "";
  const version = spec.showsVersion ? wechatAiVersion.value.trim() : "";
  const copyright = spec.showsCopyright ? wechatAiCopyright.value.trim() : "";
  const rewardMessage = spec.showsReward ? wechatAiRewardMessage.value.trim() : "";

  const result = {
    ...(title ? { title } : {}),
    ...(author ? { author } : {}),
    ...(version ? { version } : {}),
    ...(copyright ? { copyright } : {}),
    ...(rewardMessage ? { rewardMessage } : {})
  };

  return Object.keys(result).length ? result : undefined;
}

// Backward compat alias
function getWechatMetadataPayload() {
  return getMetadataPayload();
}

function renderCompletedPackResult(json, successMessage, feedbackMessage) {
  currentRewardEnabled = Boolean(json?.meta?.rewardEnabled ?? false);
  currentRewardMessage = json?.meta?.rewardMessage ?? "";
  wechatAiRewardEnabled.checked = currentRewardEnabled;
  wechatAiRewardMessage.value = currentRewardMessage;
  syncRewardFields();
  lastPackResult = json;
  renderPreview(json?.stickers ?? [], "success");
  renderExtraAssets(json?.extras ?? {}, "success");

  const exportConfirmPanel = document.getElementById("exportConfirmPanel");
  if (exportConfirmPanel) exportConfirmPanel.hidden = false;

  renderDownload(json?.packId, json?.downloadUrl, json?.downloadFilename);
  renderActions(json);
  persistLastGeneratedResult(json);
  setStatus(generateState, "已完成", "success");
  setNotice(successMessage, "success");
  setFeedback(feedbackMessage, "success");
  renderExportInfo(json);
  renderMetadataPreview(json);
}

async function importPlatformPack() {
  const files = importFiles?.files;
  const count = Number(files?.length || 0);
  if (count < MIN_STICKER_COUNT || count > MAX_STICKER_COUNT) {
    setNotice(`请选择 ${MIN_STICKER_COUNT}-${MAX_STICKER_COUNT} 张图片后再导入。`, "error");
    setStatus(importState, "数量不符合", "error");
    return;
  }

  const spec = PLATFORM_SPECS[currentPlatform];

  setStatus(importState, "处理中...", "loading");
  setStatus(generateState, "正在导入", "loading");
  setNotice("正在标准化导入图片并打包。", "info");
  resetGenerationResult({ clearPersisted: true });
  renderPreview([], "loading");
  renderExtraAssets({}, "idle");
  setFeedback(`正在把导入图片转换为${spec.platformLabel}规格。`, "loading");
  renderMetadataPreview(null, "loading");
  setGenerateButtonsBusy(true);

  try {
    const formData = new FormData();
    formData.append("presetId", currentPlatform);
    for (const file of Array.from(files)) {
      formData.append("stickers", file);
    }
    const optionalFiles = [
      ["cover", importCover?.files?.[0]],
      ["icon", importIcon?.files?.[0]],
      ["banner", importBanner?.files?.[0]],
      ["rewardGuide", importRewardGuide?.files?.[0]],
      ["rewardThanks", importRewardThanks?.files?.[0]]
    ];
    for (const [field, file] of optionalFiles) {
      if (file) formData.append(field, file);
    }
    if (currentRewardEnabled || importRewardGuide?.files?.[0] || importRewardThanks?.files?.[0]) {
      formData.append("includeReward", "true");
    }
    const metadata = getMetadataPayload();
    if (metadata) {
      for (const [key, value] of Object.entries(metadata)) {
        formData.append(key, value);
      }
    }

    const json = await requestJson("/api/generate/import", {
      method: "POST",
      body: formData
    });

    setStatus(importState, "导入完成", "success");
    renderCompletedPackResult(
      json,
      "图片已导入并标准化，可以预览后下载 ZIP。",
      `已将导入图片统一处理为${spec.platformLabel}规格，可继续核对并下载 ZIP。`
    );
  } catch (error) {
    setStatus(importState, "导入失败", "error");
    setStatus(generateState, "导入失败", "error");
    setNotice(error instanceof Error ? error.message : "导入失败，请稍后重试。", "error");
    renderPreview([], "error");
    renderExtraAssets({}, "error");
    setFeedback("导入失败，请检查图片格式和数量后重试。", "error");
    renderMetadataPreview(null, "error");
  } finally {
    setGenerateButtonsBusy(false);
  }
}

// Backward compat alias
async function importWechatPack() {
  await importPlatformPack();
}

async function generatePlatformPack() {
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
  const rewardMessage = wechatAiRewardMessage.value.trim();
  const stickerCount = Number(wechatAiCount.value || DEFAULT_STICKER_COUNT);
  const spec = PLATFORM_SPECS[currentPlatform];

  hasGenerationAttempted = true;
  setGenerateButtonsBusy(true);
  setStatus(generateState, "生成中...", "loading");
  resetGenerationProgress();
  setNotice(`正在生成${spec.platformLabel}并打包，请稍候...`, "info");
  wechatAiZipLink.innerHTML = "";
  
  const sectionCoverIcon = document.getElementById("sectionCoverIcon");
  if (sectionCoverIcon) sectionCoverIcon.hidden = true;
  sectionBanner.hidden = true;
  sectionRewardGuide.hidden = true;
  sectionRewardThanks.hidden = true;
  
  const exportConfirmPanel = document.getElementById("exportConfirmPanel");
  if (exportConfirmPanel) exportConfirmPanel.hidden = true;

  renderPreview([], "loading");
  renderExtraAssets({}, "loading");
  const loadingFeedback = spec.showsExtraAssets
    ? (currentRewardEnabled
        ? "正在生成 cover、icon、banner、赞赏引导图、赞赏感谢图与表情预览。"
        : "正在生成 cover、icon、banner 与表情预览。")
    : "正在生成贴纸与表情预览。";
  setFeedback(loadingFeedback, "loading");
  setExportInfo("结果概览与导出信息", "正在生成中，请稍候。");
  renderMetadataPreview(null, "loading");

  // Lock platform selector once generation starts
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

    const stickers = [];
    const extras = {};
    let totalCount = stickerCount;

    cancelRequested = false;
    sseAbortController = new AbortController();
    const api = (window._auth && window._auth.api) || fetch;
    const startRes = await api("/api/generate/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    });
    const startJson = await startRes.json();
    if (!startRes.ok) {
      throw new Error(startJson?.message || "生成失败，请稍后重试。");
    }
    if (!startJson?.taskId) {
      throw new Error("生成失败，请稍后重试。");
    }
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
        updateGenerationProgress(0, totalCount);
        return;
      }
      if (eventName === "progress") {
        const current = Number(data?.current || 0);
        setStatus(generateState, `生成中 (${current}/${totalCount})`, "loading");
        updateGenerationProgress(current, totalCount);
        return;
      }
      if (eventName === "sticker") {
        stickers.push({ label: data.label, assetId: data.assetId, url: data.url, prompt: data.prompt });
        renderPreview(stickers, "loading");
        const current = Number(data?.current || stickers.length);
        setStatus(generateState, `生成中 (${current}/${totalCount})`, "loading");
        updateGenerationProgress(current, totalCount);
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
        updateGenerationProgress(current, totalCount);
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
        renderPreview(stickers, "success");
        renderExtraAssets(json?.extras ?? {}, "success");
        
        if (exportConfirmPanel) exportConfirmPanel.hidden = false;
        
        renderDownload(json?.packId, json?.downloadUrl, json?.downloadFilename);
        renderActions(json);
        persistLastGeneratedResult(json);
        resetGenerationProgress();
        setStatus(generateState, "生成完成", "success");
        setNotice("表情包已生成完成，可以先预览，再下载 ZIP。", "success");
        const successFeedback = spec.showsExtraAssets
          ? (currentRewardEnabled
              ? "已生成 cover、icon、banner、赞赏引导图、赞赏感谢图与表情预览，可继续重新生成当前方案。"
              : "已生成 cover、icon、banner 与表情预览，可继续重新生成当前方案。")
          : "已生成贴纸与表情预览，可继续重新生成当前方案。";
        setFeedback(successFeedback, "success");

        renderExportInfo(json);
        renderMetadataPreview(json);

        // === UX: collapse config, show sticky bar, update nav ===
        var stepCards = document.querySelectorAll(".step-card");
        if (stepCards[0]) collapseStepCard(stepCards[0], "已选择 " + (PLATFORM_SPECS[currentPlatform] ? PLATFORM_SPECS[currentPlatform].platformLabel : currentPlatform), "success");
        if (stepCards[1]) collapseStepCard(stepCards[1], "参考图已上传", "success");
        if (stepCards[2]) collapseStepCard(stepCards[2], "配置已完成" + (json?.meta?.count ? "，" + json.meta.count + " 张" : ""), "success");
        updateStepNav(4, [0, 1, 2, 3]);
        showStickyActionBar("生成完成");
        syncViewTab("preview");
      }
      if (eventName === "error") {
        const msg = String(data?.message || "");
        currentTaskId = null;
        sseAbortController = null;
        if (msg.includes("取消")) {
          cancelRequested = true;
          resetGenerationProgress();
          setStatus(generateState, "已取消", "error");
          setNotice("已取消本次生成。", "error");
          setFeedback("本次生成已取消，可直接点击重新生成再次尝试。", "error");
          setGenerateButtonsBusy(false);
          return;
        }
        const hint = getFriendlyErrorHint(msg);
        const err = new Error(msg || "生成失败");
        err.isServerError = true;
        err.userHint = hint;
        throw err;
      }
    };

    for (let attempt = 0; attempt <= maxRetries && !completed && !cancelRequested; attempt++) {
      const headers = { accept: "text/event-stream" };
      if (lastEventId > 0) headers["Last-Event-ID"] = String(lastEventId);
      const sseApi = (window._auth && window._auth.api) || fetch;
      const res = await sseApi(`/api/generate/stream?taskId=${encodeURIComponent(currentTaskId)}`, {
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
      setGenerateButtonsBusy(false);
    } else {
      if (lastPackResult) {
        renderActions(lastPackResult);
        renderExportInfo(lastPackResult);
        renderMetadataPreview(lastPackResult);
        if (exportConfirmPanel) exportConfirmPanel.hidden = false;
      } else {
        renderMetadataPreview(null, "error");
      }
      setStatus(generateState, "生成失败", "error");
      const errMsg = error instanceof Error ? error.message : "生成失败";
      const errHint = error?.userHint || getFriendlyErrorHint(error);
      setNotice(errMsg + " " + errHint, "error");
      renderPreview([], "error");
      renderExtraAssets({}, "error");
      setFeedback("本次生成失败，可直接点击重新生成再次尝试。", "error");
      setExportInfo("结果概览与导出信息", "生成失败，请调整提示词或稍后重试。");
    }
  } finally {
    currentTaskId = null;
    sseAbortController = null;
    setGenerateButtonsBusy(false);
    // Re-lock platform if result exists
    setPlatformDisabled(lastPackResult ? true : false);
  }
}

// Backward compat alias
async function generateWechatPack() {
  await generatePlatformPack();
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
    // === UX: update step nav to config ===
    updateStepNav(2, [0, 1]);

    try {
      await suggestPrompt();
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

// ========== Event Listeners ==========

fileInput?.addEventListener("change", async () => {
  if (fileInput.files?.length > 0) {
    await handleFileUpload();
  }
});

uploadForm.addEventListener("submit", (event) => {
  event.preventDefault();
});

importForm?.addEventListener("submit", async (event) => {
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

// Platform selector
// Platform selector via radio buttons
platformRadios.forEach(radio => {
  radio.addEventListener("change", () => {
    const newPlatform = radio.value;
    if (newPlatform && PLATFORM_SPECS[newPlatform] && newPlatform !== currentPlatform) {
      currentPlatform = newPlatform;
      syncPlatformUI();
      // If we had a previous result, invalidate it since platform changed
      if (lastPackResult) {
        resetGenerationResult({ clearPersisted: true });
        setNotice(`已切换到${PLATFORM_SPECS[currentPlatform].platformLabel}，请重新生成。`, "info");
      }
    }
  });
});

function getSelectedAiProvider() {
  return wechatAiProvider ? wechatAiProvider.value : currentAiProvider;
}

function isLocalComfyProvider() {
  return getSelectedAiProvider() === "comfy-local";
}

async function requestCancelCurrentGeneration(options = {}) {
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

cancelGenerate?.addEventListener("click", async () => {
  try {
    await requestCancelCurrentGeneration();
    sseAbortController?.abort?.();
  } catch {
    // ignore
  } finally {
    setGenerateButtonsBusy(false);
  }
});

function cancelLocalComfyGenerationOnLeave() {
  if (!currentTaskId || cancelRequested || !isLocalComfyProvider()) return;
  void requestCancelCurrentGeneration({ keepalive: true }).catch(() => {
    // The browser is leaving; cancellation is best effort from this side.
  });
  sseAbortController?.abort?.();
}

if (typeof window.addEventListener === "function") {
  window.addEventListener("pagehide", cancelLocalComfyGenerationOnLeave);
  window.addEventListener("beforeunload", cancelLocalComfyGenerationOnLeave);
}

creationModeAi?.addEventListener("change", syncCreationMode);
creationModeImport?.addEventListener("change", syncCreationMode);
syncCreationMode();

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
    if (currentCreationMode === "import") {
      await importPlatformPack();
    } else {
      await generatePlatformPack();
    }
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
  if (currentCreationMode === "import") {
    await importPlatformPack();
  } else {
    await generatePlatformPack();
  }
});

regenerateSubmit.addEventListener("click", async () => {
  if (currentCreationMode !== "ai") return;
  await generatePlatformPack();
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

clearHistoryBtn?.addEventListener("click", () => {
  clearPackHistory();
});

originalPreview.addEventListener("error", () => {
  originalPreview.removeAttribute("src");
  syncOriginalPreviewSlot();
  setStatus(uploadState, "图片加载失败", "error");
  setNotice("图片加载失败，请重新上传。", "error");
});

async function initApp() {
  try {
    const api = (window._auth && window._auth.api) || fetch;
    const configRes = await api("/api/config");
    if (configRes.ok) {
      const config = await configRes.json();

      // Show/hide environment badge
      const envBadge = document.getElementById('envBadge');
      if (envBadge && config.env === 'development') {
        envBadge.removeAttribute('hidden');
      }

      // Support new platforms format
      if (config?.platforms) {
        const wc = config.platforms.wechat_stickers;
        if (wc) {
          DEFAULT_STYLE_OPTIONS = wc.styles || DEFAULT_STYLE_OPTIONS;
          const providerConfig = wc.ai || wc;
          if (providerConfig.availableProviders && wechatAiProvider) {
            wechatAiProvider.innerHTML = "";
            providerConfig.availableProviders.forEach(p => {
              const option = document.createElement("option");
              option.value = p.id;
              option.textContent = p.name;
              wechatAiProvider.appendChild(option);
            });
          }
          if (providerConfig.defaultProvider && wechatAiProvider) {
            currentAiProvider = providerConfig.defaultProvider;
            wechatAiProvider.value = currentAiProvider;
          }
        }
      } else if (config?.wechat) {
        // Backward compat: old wechat-only config
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
  syncPlatformUI();
  syncRewardFields();
  resetGenerationResult({ clearPersisted: false });
  setPromptHint(currentStyles);
  restorePersistedPackResult();
  renderPackHistory();

  // === UX: init step nav, sticky bar, tabs ===
  updateStepNav(0, []);
  initStickyBar();
  initViewTabs();

  // === Dark mode, drop zone, lightbox, keyboard shortcuts ===
  initDarkMode();
  initDropZone();
  initLightbox();
  initKeyboardShortcuts();
}

// ========== Phase 1-3: UX Improvements ==========

// ---- Scroll utility ----
function scrollToElement(el, options) {
  if (!el) return;
  options = options || {};
  var prefersReducedMotion = Boolean(
    window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
  try {
    el.scrollIntoView({
      behavior: prefersReducedMotion ? "auto" : "smooth",
      block: options.block || "start"
    });
  } catch (e) {
    el.scrollIntoView();
  }
}

// ---- Step Card Collapse / Expand ----
function collapseStepCard(cardEl, summaryText, tone) {
  if (!cardEl || cardEl.classList.contains("collapsed")) return;
  tone = tone || "success";

  var summary = cardEl.querySelector(".step-summary");
  if (!summary) {
    summary = document.createElement("div");
    summary.className = "step-summary";

    var statusDot = document.createElement("span");
    statusDot.className = "step-summary-status";
    statusDot.dataset.tone = tone;

    var textEl = document.createElement("span");
    textEl.className = "step-summary-text";

    var editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.className = "step-summary-edit secondary";
    editBtn.textContent = "\u5C55\u5F00\u4FEE\u6539";
    editBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      expandStepCard(cardEl);
    });

    summary.appendChild(statusDot);
    summary.appendChild(textEl);
    summary.appendChild(editBtn);
    cardEl.querySelector(".step-head").appendChild(summary);
  }

  var textEl2 = cardEl.querySelector(".step-summary-text");
  if (textEl2) textEl2.textContent = summaryText || "";
  var dotEl = cardEl.querySelector(".step-summary-status");
  if (dotEl) dotEl.dataset.tone = tone;

  cardEl.classList.add("collapsed");
}

function expandStepCard(cardEl) {
  if (!cardEl || !cardEl.classList.contains("collapsed")) return;
  cardEl.classList.remove("collapsed");
}

// ---- Step Navigation ----
function updateStepNav(activeStep, completedSteps) {
  var nav = document.getElementById("stepNav");
  if (!nav) return;
  completedSteps = completedSteps || [];

  var items = typeof nav.querySelectorAll === "function" ? nav.querySelectorAll(".step-nav-item") : [];
  items.forEach(function (item, idx) {
    item.classList.remove("active", "completed");
    if (idx === activeStep) {
      item.classList.add("active");
    } else if (completedSteps.indexOf(idx) !== -1) {
      item.classList.add("completed");
    }
    item.onclick = function () {
      scrollToStep(parseInt(item.dataset.step));
    };
  });
}

function scrollToStep(stepIndex) {
  var cards = document.querySelectorAll(".step-card");
  if (cards[stepIndex]) {
    scrollToElement(cards[stepIndex], { block: "start" });
  }
}

// ---- Mobile View Tabs ----
function syncViewTab(view) {
  var configArea = document.querySelector(".config-area");
  var previewArea = document.querySelector(".preview-area");
  var tabsEl = document.getElementById("viewTabs");
  if (!configArea || !previewArea || !tabsEl) return;

  var tabs = tabsEl.querySelectorAll(".view-tab");
  tabs.forEach(function (t) {
    var active = t.dataset.view === view;
    t.classList.toggle("active", active);
    t.setAttribute("aria-pressed", active ? "true" : "false");
  });

  configArea.hidden = view !== "config";
  previewArea.hidden = view !== "preview";
}

// ---- Sticky Action Bar ----
function showStickyActionBar(stateText) {
  var bar = document.getElementById("stickyActionBar");
  var statusEl = document.getElementById("stickyStatus");
  if (!bar) return;
  if (statusEl) statusEl.textContent = stateText || "";
  bar.hidden = false;
  var pageEl = document.querySelector(".page");
  if (pageEl) pageEl.classList.add("has-sticky-bar");
}

function hideStickyActionBar() {
  var bar = document.getElementById("stickyActionBar");
  if (!bar) return;
  bar.hidden = true;
  var pageEl = document.querySelector(".page");
  if (pageEl) pageEl.classList.remove("has-sticky-bar");
}

// ---- History Restore ----
function restoreFromHistory(packId) {
  var history = getPackHistory();
  if (!Array.isArray(history)) return;
  var entry = history.find(function (h) { return h.packId === packId; });
  if (!entry) {
    showToast("未找到该记录", "error");
    return;
  }

  // Restore platform
  if (entry.platform && PLATFORM_SPECS[entry.platform]) {
    currentPlatform = entry.platform;
    setSelectedPlatform(currentPlatform);
    syncPlatformUI();
  }

  // Reset but keep history
  resetAllState();

  // Restore editable fields
  if (entry.title) wechatAiTitle.value = entry.title;
  if (entry.author) wechatAiAuthor.value = entry.author;
  if (entry.stickerCount) wechatAiCount.value = String(entry.stickerCount);

  // Switch to AI mode
  if (creationModeAi) creationModeAi.checked = true;
  syncCreationMode();

  var titleText = entry.title || "未命名";
  setNotice("\u5DF2\u6062\u590D\u300C" + titleText + "\u300D\u7684\u914D\u7F6E\uFF0C\u5982\u9700\u751F\u6210\u8BF7\u8865\u5145\u53C2\u8003\u56FE\u3002", "info");
  scrollToElement(document.querySelector(".flow"), { block: "start" });
}

// Sticky bar button handlers (bound once after init)
function initStickyBar() {
  var regenBtn = document.getElementById("stickyRegenerate");
  var dlBtn = document.getElementById("stickyDownload");
  var resetBtn = document.getElementById("stickyReset");

  if (regenBtn) {
    regenBtn.addEventListener("click", function () {
      if (currentCreationMode === "ai") {
        generatePlatformPack();
      }
    });
  }

  if (dlBtn) {
    dlBtn.addEventListener("click", function () {
      if (lastPackResult && lastPackResult.downloadUrl) {
        window.open(lastPackResult.downloadUrl, "_blank");
      }
    });
  }

  if (resetBtn) {
    resetBtn.addEventListener("click", function () {
      resetAllState();
    });
  }
}

// Mobile tab handlers
function initViewTabs() {
  var tabs = document.querySelectorAll(".view-tab");
  tabs.forEach(function (tab) {
    tab.addEventListener("click", function () {
      syncViewTab(tab.dataset.view);
    });
  });
}

// ---- Patch existing functions for UX integration ----

// Patch renderPackHistory to add restore buttons
var _origRenderPackHistory = renderPackHistory;
renderPackHistory = function () {
  _origRenderPackHistory();

  // Add restore buttons to history items
  var items = typeof historyList.querySelectorAll === "function" ? historyList.querySelectorAll(".history-item") : [];
  items.forEach(function (item) {
    if (item.querySelector(".history-restore-btn")) return;

    var actionsEl = item.querySelector(".history-item-actions");
    if (!actionsEl) return;

    var restoreBtn = document.createElement("button");
    restoreBtn.type = "button";
    restoreBtn.className = "secondary history-restore-btn";
    restoreBtn.textContent = "\u270F\uFE0F \u6062\u590D\u7F16\u8F91";
    restoreBtn.style.fontSize = "var(--font-12)";
    restoreBtn.style.padding = "6px 10px";
    restoreBtn.style.borderRadius = "var(--radius-sm)";

    // Find packId from the download button
    var dlBtn = actionsEl.querySelector("a, button");
    var packId = dlBtn ? (dlBtn.dataset ? dlBtn.dataset.packId : null) : null;
    if (packId) {
      restoreBtn.dataset.packId = packId;
    }

    restoreBtn.addEventListener("click", function () {
      restoreFromHistory(restoreBtn.dataset.packId || "");
    });

    actionsEl.appendChild(restoreBtn);
  });
}

// ========== Dark Mode ==========
function initDarkMode() {
  var toggle = document.getElementById("darkModeToggle");
  if (!toggle) return;
  var saved = localStorage.getItem("easysticker-theme");
  var prefersDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
  var theme = saved || (prefersDark ? "dark" : "light");
  document.documentElement.setAttribute("data-theme", theme);
  toggle.textContent = theme === "dark" ? "☀️" : "🌙";
  var meta = document.getElementById("themeMeta");
  if (meta) meta.content = theme === "dark" ? "#111827" : "#07c160";
  toggle.addEventListener("click", function () {
    var next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    localStorage.setItem("easysticker-theme", next);
    toggle.textContent = next === "dark" ? "☀️" : "🌙";
    if (meta) meta.content = next === "dark" ? "#111827" : "#07c160";
  });
}

// ========== Drag & Drop Upload ==========
function initDropZone() {
  var dropZone = document.getElementById("dropZone");
  if (!dropZone) return;
  var dragCounter = 0;
  ["dragenter", "dragover", "dragleave", "drop"].forEach(function (evt) {
    document.addEventListener(evt, function (e) { e.preventDefault(); e.stopPropagation(); }, false);
  });
  document.addEventListener("dragenter", function (e) {
    dragCounter++;
    if (dragCounter === 1) dropZone.classList.add("drag-active");
  }, false);
  document.addEventListener("dragleave", function (e) {
    dragCounter--;
    if (dragCounter === 0) dropZone.classList.remove("drag-active");
  }, false);
  document.addEventListener("drop", function (e) {
    dragCounter = 0;
    dropZone.classList.remove("drag-active");
    var files = e.dataTransfer && e.dataTransfer.files;
    if (files && files.length > 0) {
      var fileInput = document.getElementById("file");
      if (fileInput) {
        fileInput.files = files;
        var event = new Event("change", { bubbles: true });
        fileInput.dispatchEvent(event);
      }
    }
  }, false);
}

// ========== Lightbox ==========
function initLightbox() {
  var lightbox = document.getElementById("lightbox");
  var backdrop = document.getElementById("lightboxBackdrop");
  var closeBtn = document.getElementById("lightboxClose");
  var lightboxImg = document.getElementById("lightboxImage");
  if (!lightbox || !backdrop || !closeBtn || !lightboxImg) return;

  // Delegate click on preview images
  document.addEventListener("click", function (e) {
    var target = e.target.closest(".preview-item img");
    if (!target) return;
    var src = target.getAttribute("src") || target.src;
    if (!src) return;
    lightboxImg.src = src;
    lightbox.hidden = false;
    document.body.style.overflow = "hidden";
  });

  function closeLightbox() {
    lightbox.hidden = true;
    lightboxImg.src = "";
    document.body.style.overflow = "";
  }

  backdrop.addEventListener("click", closeLightbox);
  closeBtn.addEventListener("click", closeLightbox);
  lightbox._close = closeLightbox;
}

// ========== Keyboard Shortcuts ==========
function initKeyboardShortcuts() {
  document.addEventListener("keydown", function (e) {
    // Escape: close lightbox
    if (e.key === "Escape") {
      var lightbox = document.getElementById("lightbox");
      if (lightbox && !lightbox.hidden && lightbox._close) {
        e.preventDefault();
        lightbox._close();
        return;
      }
    }
    // Ctrl+Enter / Cmd+Enter on textareas: trigger generate
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      var active = document.activeElement;
      if (active && (active.tagName === "TEXTAREA" || active.tagName === "INPUT")) {
        e.preventDefault();
        if (currentCreationMode === "ai") {
          generatePlatformPack();
        }
      }
    }
  });
}

initApp();
