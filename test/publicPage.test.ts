import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import sharp from "sharp";
import { buildApp } from "../src/app";

function multipartPayload(field: string, filename: string, contentType: string, buf: Buffer) {
  const boundary = `----easysticker-${Math.random().toString(16).slice(2)}`;
  const head = Buffer.from(
    `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="${field}"; filename="${filename}"\r\n` +
      `Content-Type: ${contentType}\r\n\r\n`
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  return {
    boundary,
    body: Buffer.concat([head, buf, tail])
  };
}

class FakeElement {
  tagName: string;
  id: string;
  children: FakeElement[];
  dataset: Record<string, string>;
  style: Record<string, string>;
  className: string;
  textContent: string;
  value: string;
  disabled: boolean;
  checked: boolean;
  hidden: boolean;
  src: string;
  href: string;
  rel: string;
  download: string;
  type: string;
  alt: string;
  clicked: boolean;
  focused: boolean;
  files?: { 0?: { name: string }; length: number };
  classList: { add: (...tokens: string[]) => void };
  listeners: Map<string, (event?: { preventDefault: () => void }) => void | Promise<void>>;
  private _innerHTML: string;

  constructor(tagName = "div", id = "") {
    this.tagName = tagName.toUpperCase();
    this.id = id;
    this.children = [];
    this.dataset = {};
    this.style = {};
    this.className = "";
    this.textContent = "";
    this._innerHTML = "";
    this.value = "";
    this.disabled = false;
    this.checked = false;
    this.hidden = false;
    this.src = "";
    this.href = "";
    this.rel = "";
    this.download = "";
    this.type = "";
    this.alt = "";
    this.clicked = false;
    this.focused = false;
    this.files = { length: 0 };
    this.listeners = new Map();
    this._children = [];
    this._childrenById = new Map();
    this.classList = {
      add: (...tokens: string[]) => {
        const classes = new Set(this.className.split(/\s+/).filter(Boolean));
        for (const token of tokens) classes.add(token);
        this.className = Array.from(classes).join(" ");
      }
    };
  }

  get innerHTML() {
    return this._innerHTML;
  }

  set innerHTML(value: string) {
    this._innerHTML = value;
    this.children = [];
  }

  appendChild(child: FakeElement) {
    this.children.push(child);
    return child;
  }

  removeChild(child: FakeElement) {
    this.children = this.children.filter((item) => item !== child);
    return child;
  }

  addEventListener(type: string, listener: (event?: { preventDefault: () => void }) => void | Promise<void>) {
    this.listeners.set(type, listener);
  }

  setAttribute(name: string, value: string) {
    if (name === "readonly") return;
    (this as unknown as Record<string, string>)[name] = value;
  }

  getAttribute(name: string) {
    const val = (this as unknown as Record<string, string>)[name];
    return val === "" || val === undefined ? null : val;
  }

  removeAttribute(name: string) {
    (this as unknown as Record<string, string>)[name] = "";
  }

  querySelectorAll(_selector: string) {
    return [] as FakeElement[];
  }

  querySelector(_selector: string) {
    return null;
  }

  select() {
    return undefined;
  }

  click() {
    this.clicked = true;
    return undefined;
  }

  focus() {
    this.focused = true;
    return undefined;
  }

  reset() {
    this.value = "";
    this.checked = false;
    this.files = { length: 0 };
    return undefined;
  }
}

function createAppSandbox(persistedValue?: Record<string, unknown>) {
  const ids = [
    "uploadForm",
    "uploadSubmit",
    "uploadState",
    "creationModeAi",
    "creationModeImport",
    "aiSourceSection",
    "importSourceSection",
    "aiConfigFields",
    "importForm",
    "importHeading",
    "importUploadText",
    "importFiles",
    "importCover",
    "importIcon",
    "importBanner",
    "importRewardGuide",
    "importRewardThanks",
    "importState",
    "importHint",
    "originalPreviewPlaceholder",
    "originalPreview",
    "wechatAiForm",
    "generateSubmit",
    "regenerateSubmit",
    "cancelGenerate",
    "resetSubmit",
    "generateState",
    "wechatAiZipLink",
    "wechatAiActions",
    "sectionPrimary",
    "sectionCover",
    "wechatAiCover",
    "sectionIcon",
    "wechatAiIcon",
    "sectionBanner",
    "wechatAiBanner",
    "sectionRewardGuide",
    "wechatAiRewardGuide",
    "sectionRewardThanks",
    "wechatAiRewardThanks",
    "exportConfirmPanel",
    "wechatAiPreview",
    "sectionCoverIcon",
    "wechatAiProvider",
    "wechatAiPrompt",
    "wechatAiTitle",
    "wechatAiAuthor",
    "wechatAiVersion",
    "wechatAiCopyright",
    "wechatAiCount",
    "wechatAiCountDec",
    "wechatAiCountInc",
    "wechatAiRewardField",
    "wechatAiRewardEnabled",
    "wechatAiRewardMessageField",
    "importExtraSection",
    "wechatAiMetadataSection",
    "wechatAiVersionField",
    "wechatAiCopyrightField",
    "wechatAiTitleField",
    "wechatAiAuthorField",
    "importSectionDesc",
    "generateSectionDesc",
    "heroBadge",
    "heroText",
    "wechatAiRewardMessage",
    "wechatAiStyleOptions",
    "wechatAiExportInfo",
    "wechatAiMetadataPreview",
    "wechatAiFeedback",
    "promptHint",
    "globalNotice",
    "toastNotice",
    "generateErrorSummary",
    "generateErrorList",
    "uploadHint",
    "wechatAiPromptError",
    "wechatAiTitleHint",
    "wechatAiTitleError",
    "wechatAiAuthorHint",
    "wechatAiAuthorError",
    "wechatAiVersionHint",
    "wechatAiCopyrightHint",
    "wechatAiCountHint",
    "wechatAiCountError",
    "wechatAiStyleHint",
    "wechatAiStyleError",
    "wechatAiRewardEnabledHint",
    "wechatAiRewardHint",
    "wechatAiRewardMessageError",
    "wechatAiRewardField",
    "wechatAiMetadataSection",
    "wechatAiVersionField",
    "wechatAiCopyrightField",
    "wechatAiTitleField",
    "wechatAiAuthorField",
    "importExtraSection",
    "aiSourceSection",
    "importSourceSection",
    "aiConfigFields",
    "generateSectionDesc",
    "importSectionDesc",
    "importHint",
    "heroBadge",
    "heroText",
    "generationProgressWrap",
    "generationProgressBar",
    "generationProgressPct",
    "clearHistory",
    "historyList",
    "historySection",
    "platformSelector",
    "file",
    "stickyActionBar",
    "stickyStatus",
    "stickyRegenerate",
    "stickyDownload",
    "stickyReset",
    "stepNav",
    "mobileViewTabs"
  ];

  const elements = new Map(ids.map((id) => [id, new FakeElement("div", id)]));
  const body = new FakeElement("body");
  const storage = new Map<string, string>();
  const clipboard = { value: "" };
  const fetchCalls: Array<{ url: string; options: Record<string, unknown> | undefined }> = [];
  const fetchState = { ok: true, text: "{}", blob: new Blob(["zip"]) };
  const urlShim = URL as typeof URL & {
    createObjectURL: () => string;
    revokeObjectURL: () => undefined;
  };
  urlShim.createObjectURL = () => "blob:http://localhost:3000/mock-download";
  urlShim.revokeObjectURL = () => undefined;
  if (persistedValue) {
    storage.set("easysticker:last-wechat-pack", JSON.stringify(persistedValue));
  }

  // Create mock radio inputs for platform selection
  const platformRadios = [
    new FakeElement("input", ""),
    new FakeElement("input", ""),
    new FakeElement("input", "")
  ];
  platformRadios[0].value = "wechat_stickers"; platformRadios[0].checked = true;
  platformRadios[1].value = "telegram_static";
  platformRadios[2].value = "whatsapp_webp";

  const document = {
    body,
    getElementById(id: string) {
      const el = elements.get(id);
      if (!el) throw new Error(`missing element: ${id}`);
      return el;
    },
    createElement(tagName: string) {
      return new FakeElement(tagName);
    },
    execCommand() {
      return true;
    },
    querySelectorAll(selector: string) {
      if (selector === 'input[name="platform"]') {
        return platformRadios;
      }
      return [];
    },
    querySelector(selector: string) {
      if (selector === 'input[name="platform"]:checked') {
        return platformRadios.find(r => r.checked) || null;
      }
      return null;
    }
  };

  const localStorage = {
    getItem(key: string) {
      return storage.has(key) ? storage.get(key)! : null;
    },
    setItem(key: string, value: string) {
      storage.set(key, value);
    },
    removeItem(key: string) {
      storage.delete(key);
    }
  };

  const sandbox = {
    document,
    window: {
      document,
      localStorage,
      location: { origin: "http://localhost:3000" }
    },
    localStorage,
    navigator: {
      clipboard: {
        async writeText(text: string) {
          clipboard.value = text;
          return undefined;
        }
      }
    },
    FormData: class {
      append() {
        return undefined;
      }
    },
    fetch: async (url: string, options?: Record<string, unknown>) => {
      fetchCalls.push({ url, options });
      return { ok: fetchState.ok, text: async () => fetchState.text, blob: async () => fetchState.blob };
    },
    URL: urlShim,
    console,
    setTimeout,
    clearTimeout
  };

  return { sandbox, elements, storage, clipboard, fetchCalls, fetchState };
}

function loadPublicApp(persistedValue?: Record<string, unknown>) {
  const { sandbox, elements, storage, clipboard, fetchCalls, fetchState } = createAppSandbox(persistedValue);
  const source = fs.readFileSync(path.join(process.cwd(), "public/app.js"), "utf8");
  const script = `${source}
globalThis.__appTest = {
  resetGenerationResult,
  resetAllState,
  restorePersistedPackResult,
  clearPersistedPackResult,
  renderPreview,
  generateWechatPack,
  getState: () => ({ currentUploadId, currentStyles, hasGenerationAttempted, lastPackResult })
};`;
  vm.runInNewContext(script, sandbox);
  return {
    app: (sandbox as typeof sandbox & { __appTest: Record<string, () => unknown> }).__appTest,
    elements,
    storage,
    clipboard,
    fetchCalls,
    fetchState
  };
}

function findChildByText(parent: FakeElement | undefined, text: string) {
  return parent?.children.find((child) => child.textContent === text);
}

function getErrorSummaryTexts(elements: Map<string, FakeElement>) {
  return elements
    .get("generateErrorList")
    ?.children.map((child) => child.children[0]?.textContent ?? child.textContent);
}

describe("public page", () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "easysticker-public-"));
  const app = buildApp({ host: "127.0.0.1", port: 0, dataDir, logLevel: "silent" });

  beforeAll(async () => {
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it("serves a minimal wechat ai flow page", async () => {
    const res = await app.inject({ method: "GET", url: "/" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/html");

    const html = res.body;
    expect(html).toContain("上传参考图");
    expect(html).toContain("选择创建方式");
    expect(html).toContain("配置与信息");
    expect(html).toContain("导入已有表情图");
    expect(html).toContain("生成表情");
    expect(html).toContain("预览与下载");
    expect(html).toContain('id="wechatAiProvider"');
    expect(html).toContain('id="wechatAiAuthor"');
    expect(html).toContain('id="wechatAiVersion"');
    expect(html).toContain('id="wechatAiCopyright"');
    expect(html).toContain('id="wechatAiCount"');
    expect(html).toContain('id="wechatAiRewardEnabled"');
    expect(html).toContain('id="wechatAiRewardMessage"');
    expect(html).toContain('id="wechatAiStyleOptions"');
    expect(html).toContain('id="regenerateSubmit"');
    expect(html).toContain('id="resetSubmit"');
    expect(html).toContain('id="wechatAiFeedback"');
    expect(html).toContain('id="wechatAiExportInfo"');
    expect(html).toContain('id="wechatAiMetadataPreview"');
    expect(html).toContain('id="toastNotice"');
    expect(html).toContain('id="generateErrorSummary"');
    expect(html).toContain('id="generateErrorList"');
    expect(html).toContain('id="wechatAiPromptError"');
    expect(html).toContain('id="wechatAiTitleHint"');
    expect(html).toContain('id="wechatAiTitleError"');
    expect(html).toContain('id="wechatAiStyleHint"');
    expect(html).toContain('id="wechatAiStyleError"');
    expect(html).toContain("导出确认面板");
    expect(html).toContain("内部开发页");
    expect(html).toContain('href="/internal.html"');
    expect(html).not.toContain("打开组件库文档页");
    expect(html).not.toContain('href="/components.html"');
    expect(html).not.toContain('href="/design-spec.html"');
    expect(html).not.toContain('href="/compatibility-report.html"');
    expect(html).not.toContain('href="/performance-report.html"');
    expect(html).toContain('id="uploadHint"');
    expect(html).toContain('aria-describedby="uploadHint"');
    expect(html).toContain('id="wechatAiVersionHint"');
    expect(html).toContain('id="wechatAiCopyrightHint"');
    expect(html).toContain('id="wechatAiRewardEnabledHint"');
    expect(html).toContain("建议上传主体清晰、边缘完整的 PNG 或 JPG");
    expect(html).toContain("建议在提示词中补充主体、情绪、动作和背景限制");
    expect(html).toContain('<span class="required-mark">*</span>选择图片');
    expect(html).toContain('<span class="required-mark">*</span>AI 提供商选择');
    expect(html).toContain('<span class="required-mark">*</span>提示词');
    expect(html).toContain('<span class="required-mark">*</span>表情包标题');
    expect(html).toContain('<span class="required-mark">*</span>作者名');
    expect(html).toContain('<span class="required-mark">*</span>贴纸数量');
    expect(html).toContain('<span class="required-mark">*</span>风格选择');
    expect(html).toContain('版本信息<span class="optional-mark">可选</span>');
    expect(html).toContain('版权信息<span class="optional-mark">可选</span>');
    expect(html).toContain('赞赏功能<span class="optional-mark">可选</span>');
    expect(html).toContain('<span class="required-mark">*</span>赞赏引导语');
    expect(html.indexOf('class="export-confirm-panel"')).toBeLessThan(html.indexOf('id="wechatAiExportInfo"'));
    expect(html).toContain("结果概览、导出信息与 metadata.json");
    expect(html).not.toContain("令牌驱动的页面层与组件规范");
    expect(html).not.toContain("A11y Error Summary");
    expect(html).not.toContain("Compatibility Report");
    expect(html).not.toContain("Performance Report");
    expect(html).not.toContain("<pre");
    expect(html).not.toContain("referenceAssetId");
    expect(html).not.toContain("stickerCount");
    expect(html).not.toContain("wechatAiStyles");
    expect(html).not.toContain("wechatRefId");
  });

  it("hides the internal page link in production", async () => {
    const originalNodeEnv = process.env.NODE_ENV;
    const prodDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "easysticker-public-prod-"));
    process.env.NODE_ENV = "production";
    const prodApp = buildApp({ host: "127.0.0.1", port: 0, dataDir: prodDataDir, logLevel: "silent" });

    try {
      await prodApp.ready();
      const res = await prodApp.inject({ method: "GET", url: "/" });
      expect(res.statusCode).toBe(200);
      expect(res.body).toContain("选择创建方式");
      expect(res.body).not.toContain("内部开发页");
      expect(res.body).not.toContain('href="/internal.html"');
    } finally {
      await prodApp.close();
      if (originalNodeEnv === undefined) {
        delete process.env.NODE_ENV;
      } else {
        process.env.NODE_ENV = originalNodeEnv;
      }
      fs.rmSync(prodDataDir, { recursive: true, force: true });
    }
  });

  it("triggers upload automatically when file input changes", async () => {
    const { elements, fetchCalls } = loadPublicApp();
    await new Promise(resolve => setTimeout(resolve, 50));
    
    const fileInput = elements.get("file")! as FakeElement & Record<string, unknown>;
    fileInput.files = { 0: { name: "safe.png" }, length: 1 };
    await fileInput.listeners.get("change")?.();
    
    expect(fetchCalls.at(-1)?.url).toBe("/api/uploads");
  });

  it("serves frontend script with preview assets and retry states", async () => {
    const res = await app.inject({ method: "GET", url: "/app.js" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("application/javascript");
    expect(res.body).toContain("renderExportInfo");
    expect(res.body).toContain("renderExtraAssets");
    expect(res.body).toContain("renderActions");
    expect(res.body).toContain("renderStyleOptions");
    expect(res.body).toContain("renderExportInfo");
    expect(res.body).toContain("DEFAULT_STYLE_OPTIONS");
    expect(res.body).toContain("resetAllState");
    expect(res.body).toContain("buildExportInfoCardText");
    expect(res.body).toContain("buildDetailGridMarkup");
    expect(res.body).toContain("CONFIRM_CARD_CONFIGS");
    expect(res.body).toContain("renderConfirmCard");
    expect(res.body).toContain("handleConfirmCardClick");
    expect(res.body).toContain("确认无误，下载ZIP包");
    expect(res.body).toContain("结果概览");
    expect(res.body).toContain("复制 metadata.json");
    expect(res.body).toContain("validateGenerateInputs");
    expect(res.body).toContain("enableReward");
    expect(res.body).toContain("rewardMessage");
    expect(res.body).toContain("rewardGuideAssetId");
    expect(res.body).toContain("rewardThanksAssetId");
    expect(res.body).toContain("toggle-export-info");
    expect(res.body).toContain("metadata.json");
    expect(res.body).toContain("buildMetadataPreviewText");
    expect(res.body).toContain("toggle-metadata-preview");
    expect(res.body).toContain("展开内容");
    expect(res.body).toContain("showToast");
    expect(res.body).toContain("用于展示聊天场景贴纸与序号资源。");
    expect(res.body).toContain("getExtraAssetDescription");
    expect(res.body).toContain("preview-description");
    expect(res.body).toContain("createPreviewCard");
    expect(res.body).toContain("240 × 240");
    expect(res.body).toContain("link.download");
    expect(res.body).toContain("未命名表情包");
    expect(res.body).toContain("重新生成中...");
    expect(res.body).toContain("生成完成后自动更新");
    expect(res.body).toContain("生成失败后可重新生成");
    expect(res.body).toContain("easysticker:last-wechat-pack");
    expect(res.body).toContain("restorePersistedPackResult");
    expect(res.body).toContain("generateErrorSummary");
    expect(res.body).toContain("FIELD_A11Y_CONFIGS");
    expect(res.body).toContain("syncGenerateErrorSummary");
    expect(res.body).toContain("jumpToInvalidField");
    expect(res.body).toContain("error-summary-link");
    expect(res.body).toContain("建议在提示词中补充主体、情绪、动作和背景限制");
  });

  it("serves the consolidated internal development page", async () => {
    const res = await app.inject({ method: "GET", url: "/internal.html" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/html");

    const html = res.body;
    expect(html).toContain("EasySticker 内部开发页");
    expect(html).toContain("组件与令牌");
    expect(html).toContain("设计原则");
    expect(html).toContain("兼容性与回归检查");
    expect(html).toContain("性能基线");
    expect(html).toContain("键盘操作速查表");
    expect(html).toContain("Ctrl + Enter");
    expect(html).not.toContain('data-include="/partials/keyboard-cheatsheet.html"');
    expect(html).not.toContain('<script src="/include.js"></script>');
    expect(html).toContain("导出确认卡");
    expect(html).toContain('href="/"');
    expect(html).toContain('href="#componentGuide"');
    expect(html).toContain('href="#designRules"');
    expect(html).toContain('href="#qualityChecks"');
    expect(html).toContain('href="#performanceBaseline"');
    expect(html).toContain("role=\"main\"");
    expect(html).not.toContain('href="/components.html"');
    expect(html).not.toContain('href="/design-spec.html"');
    expect(html).not.toContain('href="/compatibility-report.html"');
    expect(html).not.toContain('href="/performance-report.html"');
  });

  it("does not serve removed standalone internal pages", async () => {
    for (const url of ["/components.html", "/design-spec.html", "/compatibility-report.html", "/performance-report.html"]) {
      const res = await app.inject({ method: "GET", url });
      expect(res.statusCode).toBe(404);
    }
  });

  it("serves a noop vite client shim for embedded preview environments", async () => {
    const res = await app.inject({ method: "GET", url: "/@vite/client" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("application/javascript");
    expect(res.body).toContain("export {}");
  });

  it("restores the latest generated result from local storage on page boot", async () => {
    const persistedValue = {
      version: 1,
      uploadId: "upload-123",
      provider: "doubao",
      prompt: "生成一组猫咪表情",
      title: "猫咪日常",
      author: "EasySticker Studio",
      versionText: "v1.2",
      copyrightText: "© EasySticker",
      rewardEnabled: true,
      rewardMessage: "喜欢的话欢迎赞赏支持",
      stickerCount: 12,
      styles: ["可爱", "简洁"],
      hasGenerationAttempted: true,
      result: {
        packId: "pack-001",
        downloadUrl: "/api/packs/pack-001/download",
        downloadFilename: "猫咪日常-pack-001.zip",
        stickers: [
          { label: "001", url: "/api/assets/sticker-001", assetId: "sticker-001" },
          { label: "002", url: "/api/assets/sticker-002", assetId: "sticker-002" }
        ],
        metadataJson: JSON.stringify(
          {
            schema: "easysticker-pack@0.1",
            packId: "pack-001",
            presetId: "wechat_stickers",
            createdAt: "2026-03-31T00:00:00.000Z",
            metadata: {
              title: "猫咪日常",
              author: "EasySticker Studio",
              version: "v1.2",
              copyright: "© EasySticker",
              rewardMessage: "喜欢的话欢迎赞赏支持"
            },
            extras: {
              coverAssetId: "cover-001",
              iconAssetId: "icon-001",
              bannerAssetId: "banner-001",
              rewardGuideAssetId: "reward-guide-001",
              rewardThanksAssetId: "reward-thanks-001"
            },
            assets: [
              { assetId: "sticker-001", filename: "001.png", zipPath: "assets/001.png" },
              { assetId: "sticker-002", filename: "002.png", zipPath: "assets/002.png" }
            ]
          },
          null,
          2
        ),
        meta: {
          title: "猫咪日常",
          styles: ["可爱", "简洁"],
          author: "EasySticker Studio",
          version: "v1.2",
          copyright: "© EasySticker",
          rewardMessage: "喜欢的话欢迎赞赏支持",
          rewardEnabled: true,
          count: 8,
          referenceMode: "base64"
        },
        extras: {
          coverAssetId: "cover-001",
          iconAssetId: "icon-001",
          bannerAssetId: "banner-001",
          rewardGuideAssetId: "reward-guide-001",
          rewardThanksAssetId: "reward-thanks-001"
        }
      }
    };

    const { app: pageApp, elements } = loadPublicApp(persistedValue);
    // await for the async initApp to finish fetching config
    await new Promise(resolve => setTimeout(resolve, 50));
    
    const state = (pageApp.getState as () => {
      currentUploadId: string;
      currentStyles: string[];
      hasGenerationAttempted: boolean;
      lastPackResult: { packId: string };
    })();

    expect(state.currentUploadId).toBe("upload-123");
    expect(state.currentStyles).toEqual(["可爱"]); // 已经改为单选，只会恢复第一个
    expect(state.hasGenerationAttempted).toBe(true);
    expect(state.lastPackResult.packId).toBe("pack-001");
    expect(elements.get("wechatAiProvider")?.value).toBe("doubao");
    expect(elements.get("wechatAiPrompt")?.value).toBe("生成一组猫咪表情");
    expect(elements.get("wechatAiTitle")?.value).toBe("猫咪日常");
    expect(elements.get("wechatAiAuthor")?.value).toBe("EasySticker Studio");
    expect(elements.get("wechatAiVersion")?.value).toBe("v1.2");
    expect(elements.get("wechatAiCopyright")?.value).toBe("© EasySticker");
    expect(elements.get("wechatAiRewardEnabled")?.checked).toBe(true);
    expect(elements.get("wechatAiRewardMessageField")?.hidden).toBe(false);
    expect(elements.get("wechatAiRewardMessage")?.value).toBe("喜欢的话欢迎赞赏支持");
    expect(elements.get("wechatAiCount")?.value).toBe("12");
    expect(elements.get("originalPreview")?.src).toBe("/api/assets/upload-123");
    expect(elements.get("uploadState")?.textContent).toBe("已恢复参考图");
    expect(elements.get("wechatAiFeedback")?.innerHTML).toContain("已从本地恢复最近一次生成结果");
    expect(elements.get("globalNotice")?.textContent).toContain("已恢复最近一次生成结果");
    expect(elements.get("promptHint")?.textContent).toContain("可爱"); // 改为了单选，只包含一个
    expect(elements.get("promptHint")?.textContent).toContain("12 张");
    expect(elements.get("wechatAiExportInfo")?.innerHTML).toContain("结果概览与导出信息");
    expect(elements.get("wechatAiExportInfo")?.innerHTML).toContain("复制导出信息");
    expect(elements.get("wechatAiExportInfo")?.innerHTML).toContain("展开内容");
    expect(elements.get("wechatAiExportInfo")?.innerHTML).toContain("已默认折叠");
    expect(elements.get("wechatAiExportInfo")?.innerHTML).not.toContain("pack-001");
    expect(elements.get("wechatAiMetadataPreview")?.innerHTML).toContain("metadata.json");
    expect(elements.get("wechatAiMetadataPreview")?.innerHTML).toContain("复制 metadata.json");
    expect(elements.get("wechatAiMetadataPreview")?.innerHTML).toContain("展开内容");
    expect(elements.get("wechatAiMetadataPreview")?.innerHTML).toContain("已默认折叠");
    expect(elements.get("wechatAiMetadataPreview")?.innerHTML).not.toContain("&quot;packId&quot;: &quot;pack-001&quot;");
    expect(elements.get("wechatAiStyleOptions")?.children.length).toBeGreaterThan(0);
    expect(elements.get("wechatAiFeedback")?.innerHTML).toContain("已从本地恢复最近一次生成结果");
    expect(elements.get("wechatAiZipLink")?.children).toHaveLength(2);
    expect(elements.get("wechatAiZipLink")?.children[0]?.download).toBe("猫咪日常-pack-001.zip");
    expect(elements.get("wechatAiPreview")?.children).toHaveLength(2);
    expect(elements.get("wechatAiPreview")?.children[0]?.children[0]?.children.map((child) => child.textContent)).toEqual([
      "表情 001",
      "240 × 240",
      "用于展示聊天场景贴纸与序号资源。 当前序号：001"
    ]);
    expect(elements.get("wechatAiCover")?.children).toHaveLength(1);
    expect(elements.get("regenerateSubmit")?.disabled).toBe(false);
    expect(elements.get("wechatAiCover")?.children[0]?.children[0]?.children.map((child) => child.textContent)).toEqual([
      "Cover 预览",
      "240 × 240",
      "用于表情包封面展示。"
    ]);
    expect(elements.get("wechatAiRewardGuide")?.children[0]?.children[0]?.children.map((child) => child.textContent)).toEqual([
      "赞赏引导图",
      "750 × 400",
      "用于展示赞赏引导语。 当前文案：喜欢的话欢迎赞赏支持"
    ]);
    expect(elements.get("wechatAiRewardThanks")?.children[0]?.children[0]?.children.map((child) => child.textContent)).toEqual([
      "赞赏感谢图",
      "750 × 400",
      "用于赞赏完成后的感谢反馈。 当前文案：喜欢的话欢迎赞赏支持"
    ]);
  });

  it("shows download success toast after clicking download button", async () => {
    const persistedValue = {
      version: 1,
      uploadId: "upload-download",
      prompt: "生成整套表情",
      title: "下载测试",
      author: "EasySticker Studio",
      stickerCount: 8,
      styles: ["可爱"],
      hasGenerationAttempted: true,
      result: {
        packId: "pack-download",
        downloadUrl: "/api/packs/pack-download/download",
        downloadFilename: "下载测试-pack-download.zip",
        stickers: [],
        meta: { title: "下载测试", author: "EasySticker Studio", count: 8, styles: ["可爱"] },
        extras: {}
      }
    };

    const { elements, fetchCalls } = loadPublicApp(persistedValue);
    await new Promise(resolve => setTimeout(resolve, 50));
    const link = elements.get("wechatAiZipLink")?.children[0];
    await link?.listeners.get("click")?.({ preventDefault: () => undefined });

    expect(fetchCalls.at(-1)?.url).toBe("/api/packs/pack-download/download");
    expect(elements.get("globalNotice")?.textContent).toBe("下载已开始，请留意浏览器下载列表。");
    expect(elements.get("toastNotice")?.textContent).toBe("下载已开始，请留意浏览器下载列表。");
  });

  it("shows download failure toast when zip request fails", async () => {
    const persistedValue = {
      version: 1,
      uploadId: "upload-download-fail",
      prompt: "生成整套表情",
      title: "下载测试",
      author: "EasySticker Studio",
      stickerCount: 8,
      styles: ["可爱"],
      hasGenerationAttempted: true,
      result: {
        packId: "pack-download-fail",
        downloadUrl: "/api/packs/pack-download-fail/download",
        downloadFilename: "下载测试-pack-download-fail.zip",
        stickers: [],
        meta: { title: "下载测试", author: "EasySticker Studio", count: 8, styles: ["可爱"] },
        extras: {}
      }
    };

    const { elements, fetchState } = loadPublicApp(persistedValue);
    await new Promise(resolve => setTimeout(resolve, 50));
    fetchState.ok = false;
    const link = elements.get("wechatAiZipLink")?.children[0];
    await link?.listeners.get("click")?.({ preventDefault: () => undefined });

    expect(elements.get("globalNotice")?.textContent).toBe("下载失败，请稍后重试。");
    expect(elements.get("toastNotice")?.textContent).toBe("下载失败，请稍后重试。");
  });

  it("prevents generate request when required fields are missing", async () => {
    const persistedValue = {
      version: 1,
      uploadId: "upload-validate",
      prompt: "生成表情",
      title: "原始标题",
      author: "原始作者",
      stickerCount: 8,
      styles: ["可爱"],
      hasGenerationAttempted: true,
      result: {
        packId: "pack-validate",
        downloadUrl: "/api/packs/pack-validate/download",
        stickers: [],
        meta: { count: 8, styles: ["可爱"] },
        extras: {}
      }
    };

    const { app: pageApp, elements, fetchCalls } = loadPublicApp(persistedValue);
    await new Promise(resolve => setTimeout(resolve, 50));
    const titleEl = elements.get("wechatAiTitle")! as FakeElement & Record<string, string>;
    const authorEl = elements.get("wechatAiAuthor")! as FakeElement & Record<string, string>;
    titleEl.value = "";
    await (pageApp.generateWechatPack as () => Promise<void>)();
    // fetchCalls is 1 because of the initApp config fetch
    expect(fetchCalls).toHaveLength(1);
    expect(elements.get("globalNotice")?.textContent).toBe("请填写表情包标题。");
    expect(titleEl["aria-invalid"]).toBe("true");
    expect(titleEl["aria-describedby"]).toContain("wechatAiTitleHint");
    expect(titleEl["aria-describedby"]).toContain("wechatAiTitleError");
    expect(elements.get("wechatAiTitleError")?.textContent).toBe("请填写表情包标题。");
    expect(elements.get("generateErrorSummary")?.hidden).toBe(false);
    expect(elements.get("generateErrorSummary")?.focused).toBe(false);
    expect(getErrorSummaryTexts(elements)).toEqual(["表情包标题：请填写表情包标题。"]);

    titleEl.value = "新的标题";
    authorEl.value = "";
    await (pageApp.generateWechatPack as () => Promise<void>)();
    expect(fetchCalls).toHaveLength(1);
    expect(elements.get("globalNotice")?.textContent).toBe("请填写作者名。");
    expect(authorEl["aria-invalid"]).toBe("true");
    expect(getErrorSummaryTexts(elements)).toEqual(["作者名：请填写作者名。"]);

    authorEl.value = "新的作者";
    elements.get("wechatAiRewardEnabled")!.checked = true;
    elements.get("wechatAiRewardEnabled")?.listeners.get("change")?.();
    await (pageApp.generateWechatPack as () => Promise<void>)();
    expect(fetchCalls).toHaveLength(1);
    expect(elements.get("globalNotice")?.textContent).toBe("开启赞赏功能后，请填写赞赏引导语。");
    const rewardMessageEl = elements.get("wechatAiRewardMessage")! as FakeElement & Record<string, string>;
    expect(rewardMessageEl["aria-invalid"]).toBe("true");
    expect(rewardMessageEl["aria-describedby"]).toContain("wechatAiRewardHint");
    expect(rewardMessageEl["aria-describedby"]).toContain("wechatAiRewardMessageError");
    expect(elements.get("wechatAiRewardMessageError")?.textContent).toBe("开启赞赏功能后，请填写赞赏引导语。");
    expect(getErrorSummaryTexts(elements)).toEqual([
      "赞赏引导语：开启赞赏功能后，请填写赞赏引导语。"
    ]);
  });

  it("jumps from error summary items to the related field", async () => {
    const persistedValue = {
      version: 1,
      uploadId: "upload-summary-jump",
      prompt: "生成一组猫咪表情",
      title: "",
      author: "EasySticker Studio",
      stickerCount: 8,
      styles: ["可爱"],
      hasGenerationAttempted: true,
      result: {
        packId: "pack-summary-jump",
        downloadUrl: "/api/packs/pack-summary-jump/download",
        stickers: [],
        meta: {},
        extras: {}
      }
    };

    const { app: pageApp, elements, fetchCalls } = loadPublicApp(persistedValue);
    await new Promise(resolve => setTimeout(resolve, 50));
    await (pageApp.generateWechatPack as () => Promise<void>)();

    expect(fetchCalls).toHaveLength(1);
    const errorJumpButton = elements.get("generateErrorList")?.children[0]?.children[0];
    expect(errorJumpButton?.textContent).toBe("表情包标题：请填写表情包标题。");

    await errorJumpButton?.listeners.get("click")?.();

    expect(elements.get("wechatAiTitle")?.focused).toBe(true);
  });

  it("aggregates multiple validation errors into the a11y summary container", async () => {
    const persistedValue = {
      version: 1,
      uploadId: "upload-aggregate",
      prompt: "",
      title: "",
      author: "",
      stickerCount: 8,
      styles: ["可爱"],
      hasGenerationAttempted: true,
      result: {
        packId: "pack-aggregate",
        downloadUrl: "/api/packs/pack-aggregate/download",
        stickers: [],
        meta: { count: 8, styles: ["可爱"] },
        extras: {}
      }
    };

    const { app: pageApp, elements, fetchCalls } = loadPublicApp(persistedValue);
    await new Promise(resolve => setTimeout(resolve, 50));
    const promptEl = elements.get("wechatAiPrompt")! as FakeElement & Record<string, string>;
    const titleEl = elements.get("wechatAiTitle")! as FakeElement & Record<string, string>;
    const authorEl = elements.get("wechatAiAuthor")! as FakeElement & Record<string, string>;
    promptEl.value = "";
    titleEl.value = "";
    authorEl.value = "";

    await (pageApp.generateWechatPack as () => Promise<void>)();

    expect(fetchCalls).toHaveLength(1);
    expect(elements.get("globalNotice")?.textContent).toBe("请先填写提示词。");
    expect(elements.get("generateState")?.textContent).toBe("待处理 3 项输入问题");
    expect(elements.get("generateErrorSummary")?.hidden).toBe(false);
    expect(getErrorSummaryTexts(elements)).toEqual([
      "提示词：请先填写提示词。",
      "表情包标题：请填写表情包标题。",
      "作者名：请填写作者名。"
    ]);
    expect(promptEl["aria-describedby"]).toContain("promptHint");
    expect(promptEl["aria-describedby"]).toContain("wechatAiPromptError");
    expect(elements.get("wechatAiPromptError")?.textContent).toBe("请先填写提示词。");
  });

  it("renders all restored sticker previews instead of truncating to six", async () => {
    const stickers = Array.from({ length: 7 }, (_, index) => ({
      label: String(index + 1).padStart(3, "0"),
      url: `/api/assets/sticker-${index + 1}`,
      assetId: `sticker-${index + 1}`
    }));

    const persistedValue = {
      version: 1,
      uploadId: "upload-many",
      prompt: "生成整套表情",
      stickerCount: 7,
      styles: ["可爱"],
      hasGenerationAttempted: true,
      result: {
        packId: "pack-many",
        downloadUrl: "/api/packs/pack-many/download",
        downloadFilename: "pack-many.zip",
        stickers,
        meta: { count: 7, styles: ["可爱"] },
        extras: {}
      }
    };

    const { elements } = loadPublicApp(persistedValue);
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(elements.get("wechatAiPreview")?.children).toHaveLength(7);
    expect(elements.get("wechatAiPreview")?.children[0]?.children[0]?.children.map((child) => child.textContent)).toEqual([
      "表情 001",
      "240 × 240",
      "用于展示聊天场景贴纸与序号资源。 当前序号：001"
    ]);
  });

  it("renders extra asset placeholders as title size description blocks", async () => {
    const { elements } = loadPublicApp();
    await new Promise(resolve => setTimeout(resolve, 50));

    expect(elements.get("wechatAiCover")?.children).toHaveLength(1);
    expect(elements.get("wechatAiIcon")?.children).toHaveLength(1);
    expect(elements.get("wechatAiBanner")?.children).toHaveLength(1);
    expect(elements.get("wechatAiRewardGuide")?.children).toHaveLength(0);
    
    expect(elements.get("wechatAiCover")?.children[0]?.children[0]?.children.map((child) => child.textContent)).toEqual([
      "Cover 预览",
      "240 × 240",
      "用于表情包封面展示。 等待生成后展示。"
    ]);
    expect(elements.get("wechatAiCover")?.children[0]?.children[1]?.textContent).toBe("等待生成");

    elements.get("wechatAiRewardEnabled")!.checked = true;
    elements.get("wechatAiRewardEnabled")?.listeners.get("change")?.();

    expect(elements.get("wechatAiRewardGuide")?.children).toHaveLength(1);
    expect(elements.get("wechatAiRewardThanks")?.children).toHaveLength(1);
    expect(elements.get("wechatAiRewardGuide")?.children[0]?.children[0]?.children.map((child) => child.textContent)).toEqual([
      "赞赏引导图",
      "750 × 400",
      "用于展示赞赏引导语。 等待生成后展示。"
    ]);
    expect(elements.get("wechatAiRewardGuide")?.children[0]?.children[1]?.textContent).toBe("等待生成");
  });

  it("hides sectionPrimary when no stickers are present in idle state", async () => {
    const { elements } = loadPublicApp();
    await new Promise(resolve => setTimeout(resolve, 50));

    expect(elements.get("sectionPrimary")?.hidden).toBe(true);
    expect(elements.get("wechatAiPreview")?.children).toHaveLength(0);
  });

  it("renders sticker preview loading and error copy with resource description tone", async () => {
    const { app: pageApp, elements } = loadPublicApp();
    await new Promise(resolve => setTimeout(resolve, 50));

    (pageApp.renderPreview as (stickers: Array<Record<string, unknown>>, tone: string) => void)([], "loading");
    expect(elements.get("wechatAiPreview")?.children[0]?.children[0]?.children.map((child) => child.textContent)).toEqual([
      "表情预览",
      "240 × 240",
      "用于展示聊天场景贴纸与序号资源。 生成完成后自动更新。"
    ]);
    expect(elements.get("wechatAiPreview")?.children[0]?.children[1]?.textContent).toBe("生成中，完成后自动展示");

    (pageApp.renderPreview as (stickers: Array<Record<string, unknown>>, tone: string) => void)([], "error");
    expect(elements.get("wechatAiPreview")?.children[0]?.children[0]?.children.map((child) => child.textContent)).toEqual([
      "表情预览",
      "240 × 240",
      "用于展示聊天场景贴纸与序号资源。 生成失败后可重新生成。"
    ]);
    expect(elements.get("wechatAiPreview")?.children[0]?.children[1]?.textContent).toBe("生成失败，可点击重新生成");
  });

  it("toggles export info card content from collapsed state", async () => {
    const persistedValue = {
      version: 1,
      uploadId: "upload-export-toggle",
      prompt: "生成一组猫咪表情",
      title: "猫咪日常",
      author: "EasySticker Studio",
      versionText: "v1.2",
      copyrightText: "© EasySticker",
      stickerCount: 8,
      styles: ["可爱"],
      hasGenerationAttempted: true,
      result: {
        packId: "pack-export-toggle",
        downloadUrl: "/api/packs/pack-export-toggle/download",
        downloadFilename: "猫咪日常-pack-export-toggle.zip",
        stickers: [],
        meta: {
          title: "猫咪日常",
          author: "EasySticker Studio",
          version: "v1.2",
          copyright: "© EasySticker"
        },
        extras: {}
      }
    };

    const { elements } = loadPublicApp(persistedValue);
    await new Promise(resolve => setTimeout(resolve, 50));
    const exportInfo = elements.get("wechatAiExportInfo");
    const actionsContainer = exportInfo?.children[0]?.children[1];
    const toggleButton = actionsContainer?.children[1];

    expect(exportInfo?.innerHTML).not.toContain("pack-export-toggle");

    exportInfo?.listeners.get("click")?.({
      preventDefault: () => undefined,
      target: {
        closest: (selector: string) => (selector === '[data-action="toggle-export-info"]' ? {} : null)
      }
    } as unknown as { preventDefault: () => void });

    expect(exportInfo?.innerHTML).toContain("收起内容");
    expect(exportInfo?.innerHTML).toContain("pack-export-toggle");
    expect(exportInfo?.innerHTML).toContain("猫咪日常-pack-export-toggle.zip");

    exportInfo?.listeners.get("click")?.({
      preventDefault: () => undefined,
      target: {
        closest: (selector: string) => (selector === '[data-action="toggle-export-info"]' ? {} : null)
      }
    } as unknown as { preventDefault: () => void });

    expect(exportInfo?.innerHTML).toContain("展开内容");
    expect(exportInfo?.innerHTML).not.toContain("pack-export-toggle");
  });

  it("toggles metadata preview content from collapsed state", async () => {
    const persistedValue = {
      version: 1,
      uploadId: "upload-toggle",
      prompt: "生成一组猫咪表情",
      title: "猫咪日常",
      author: "EasySticker Studio",
      versionText: "v1.2",
      copyrightText: "© EasySticker",
      stickerCount: 8,
      styles: ["可爱"],
      hasGenerationAttempted: true,
      result: {
        packId: "pack-toggle",
        downloadUrl: "/api/packs/pack-toggle/download",
        downloadFilename: "猫咪日常-pack-toggle.zip",
        metadataJson: JSON.stringify({ packId: "pack-toggle", metadata: { title: "猫咪日常" } }, null, 2),
        stickers: [],
        meta: {
          title: "猫咪日常",
          author: "EasySticker Studio",
          version: "v1.2",
          copyright: "© EasySticker"
        },
        extras: {}
      }
    };

    const { elements } = loadPublicApp(persistedValue);
    await new Promise(resolve => setTimeout(resolve, 50));
    const metadataPreview = elements.get("wechatAiMetadataPreview");
    const actionsContainer = metadataPreview?.children[0]?.children[1];
    const toggleButton = actionsContainer?.children[1];

    expect(metadataPreview?.innerHTML).not.toContain("&quot;packId&quot;: &quot;pack-metadata-toggle&quot;");

    metadataPreview?.listeners.get("click")?.({
      preventDefault: () => undefined,
      target: {
        closest: (selector: string) => (selector === '[data-action="toggle-metadata-preview"]' ? {} : null)
      }
    } as unknown as { preventDefault: () => void });

    expect(metadataPreview?.innerHTML).toContain("收起内容");
    expect(metadataPreview?.innerHTML).toContain("&quot;packId&quot;: &quot;pack-toggle&quot;");

    metadataPreview?.listeners.get("click")?.({
      preventDefault: () => undefined,
      target: {
        closest: (selector: string) => (selector === '[data-action="toggle-metadata-preview"]' ? {} : null)
      }
    } as unknown as { preventDefault: () => void });

    expect(metadataPreview?.innerHTML).toContain("展开内容");
    expect(metadataPreview?.innerHTML).not.toContain("&quot;packId&quot;: &quot;pack-toggle&quot;");
  });

  it("ignores unrelated clicks on shared confirm card handlers", async () => {
    const persistedValue = {
      version: 1,
      uploadId: "upload-ignore-click",
      prompt: "生成一组猫咪表情",
      title: "猫咪日常",
      author: "EasySticker Studio",
      versionText: "v1.2",
      copyrightText: "© EasySticker",
      stickerCount: 8,
      styles: ["可爱"],
      hasGenerationAttempted: true,
      result: {
        packId: "pack-ignore-click",
        downloadUrl: "/api/packs/pack-ignore-click/download",
        downloadFilename: "猫咪日常-pack-ignore-click.zip",
        metadataJson: JSON.stringify({ packId: "pack-ignore-click", metadata: { title: "猫咪日常" } }, null, 2),
        stickers: [],
        meta: {
          title: "猫咪日常",
          author: "EasySticker Studio",
          version: "v1.2",
          copyright: "© EasySticker"
        },
        extras: {}
      }
    };

    const { elements } = loadPublicApp(persistedValue);
    await new Promise(resolve => setTimeout(resolve, 50));
    const exportInfo = elements.get("wechatAiExportInfo");
    const metadataPreview = elements.get("wechatAiMetadataPreview");
    const initialExportInfo = exportInfo?.innerHTML;
    const initialMetadata = metadataPreview?.innerHTML;

    const clickEvent = {
      preventDefault: () => undefined,
      target: {
        closest: () => null
      }
    } as unknown as { preventDefault: () => void };

    exportInfo?.listeners.get("click")?.(clickEvent);
    metadataPreview?.listeners.get("click")?.(clickEvent);

    expect(exportInfo?.innerHTML).toBe(initialExportInfo);
    expect(metadataPreview?.innerHTML).toBe(initialMetadata);
  });

  it("copies export info from card action button", async () => {
    const persistedValue = {
      version: 1,
      uploadId: "upload-copy",
      prompt: "生成一组猫咪表情",
      title: "猫咪日常",
      author: "EasySticker Studio",
      versionText: "v1.2",
      copyrightText: "© EasySticker",
      stickerCount: 8,
      styles: ["可爱"],
      hasGenerationAttempted: true,
      result: {
        packId: "pack-copy",
        downloadUrl: "/api/packs/pack-copy/download",
        downloadFilename: "猫咪日常-pack-copy.zip",
        stickers: [],
        meta: {
          title: "猫咪日常",
          author: "EasySticker Studio",
          version: "v1.2",
          copyright: "© EasySticker"
        },
        extras: {}
      }
    };

    const { elements, clipboard } = loadPublicApp(persistedValue);
    await new Promise(resolve => setTimeout(resolve, 50));
    // `.export-confirm-card` 结构：
    // wechatAiExportInfo.children[0] 是 card-header
    // card-header.children[1] 是 actions 容器
    // actions.children[0] 是复制按钮
    const actionsContainer = elements.get("wechatAiExportInfo")?.children[0]?.children[1];
    const exportButton = actionsContainer?.children[0];
    
    await elements.get("wechatAiExportInfo")?.listeners.get("click")?.({
      preventDefault: () => undefined,
      stopPropagation: () => undefined,
      target: { closest: (selector: string) => (selector === '[data-action="copy-export-info"]' ? {} : null) }
    } as unknown as Event);

    expect(clipboard.value).toContain("标题：猫咪日常");
    expect(clipboard.value).toContain("packId：pack-copy");
    expect(elements.get("globalNotice")?.textContent).toBe("导出信息已复制");
    expect(elements.get("toastNotice")?.textContent).toBe("导出信息已复制");
    expect(elements.get("toastNotice")?.dataset.visible).toBe("true");
  });

  it("copies metadata preview from card action button", async () => {
    const persistedValue = {
      version: 1,
      uploadId: "upload-meta",
      prompt: "生成一组猫咪表情",
      title: "猫咪日常",
      author: "EasySticker Studio",
      versionText: "v1.2",
      copyrightText: "© EasySticker",
      stickerCount: 8,
      styles: ["可爱"],
      hasGenerationAttempted: true,
      result: {
        packId: "pack-meta",
        downloadUrl: "/api/packs/pack-meta/download",
        downloadFilename: "猫咪日常-pack-meta.zip",
        metadataJson: JSON.stringify({ packId: "pack-meta", metadata: { title: "猫咪日常" } }, null, 2),
        stickers: [],
        meta: {
          title: "猫咪日常",
          author: "EasySticker Studio",
          version: "v1.2",
          copyright: "© EasySticker"
        },
        extras: {}
      }
    };

    const { elements, clipboard } = loadPublicApp(persistedValue);
    await new Promise(resolve => setTimeout(resolve, 50));
    const actionsContainer = elements.get("wechatAiMetadataPreview")?.children[0]?.children[1];
    const metadataButton = actionsContainer?.children[0];

    await elements.get("wechatAiMetadataPreview")?.listeners.get("click")?.({
      preventDefault: () => undefined,
      stopPropagation: () => undefined,
      target: { closest: (selector: string) => (selector === '[data-action="copy-metadata-preview"]' ? {} : null) }
    } as unknown as Event);

    expect(clipboard.value).toContain('"packId": "pack-meta"');
    expect(clipboard.value).toContain('"title": "猫咪日常"');
    expect(elements.get("globalNotice")?.textContent).toBe("metadata.json 已复制");
    expect(elements.get("toastNotice")?.textContent).toBe("metadata.json 已复制");
    expect(elements.get("toastNotice")?.dataset.visible).toBe("true");
  });

  it("clears persisted result when resetting generation state", async () => {
    const persistedValue = {
      result: {
        packId: "pack-002",
        downloadUrl: "/api/packs/pack-002/download"
      }
    };

    const { app: pageApp, elements, storage } = loadPublicApp(persistedValue);
    await new Promise(resolve => setTimeout(resolve, 50));
    (pageApp.resetGenerationResult as (options?: { clearPersisted?: boolean }) => void)();

    expect(storage.has("easysticker:last-wechat-pack")).toBe(false);
    expect(elements.get("generateState")?.textContent).toBe("等待生成");
    expect(elements.get("wechatAiExportInfo")?.innerHTML).toContain("生成后在这里查看标题、数量、风格、参考图方式与导出文件。");
    expect(elements.get("wechatAiMetadataPreview")?.innerHTML).toContain("生成后在这里查看 ZIP 中的 metadata.json 内容");
    expect(elements.get("sectionPrimary")?.hidden).toBe(true);
    expect(elements.get("wechatAiPreview")?.children).toHaveLength(0);
    expect(elements.get("regenerateSubmit")?.disabled).toBe(true);
  });

  it("resets inputs, preview and storage with one-click reset", async () => {
    const persistedValue = {
      version: 1,
      uploadId: "upload-999",
      prompt: "旧提示词",
      title: "旧标题",
      stickerCount: 16,
      styles: ["像素风"],
      hasGenerationAttempted: true,
      result: {
        packId: "pack-999",
        downloadUrl: "/api/packs/pack-999/download",
        stickers: [],
        meta: {},
        extras: {}
      }
    };

    const { app: pageApp, elements, storage } = loadPublicApp(persistedValue);
    await new Promise(resolve => setTimeout(resolve, 50));
    (pageApp.resetAllState as () => void)();

    expect(storage.has("easysticker:last-wechat-pack")).toBe(false);
    expect(elements.get("wechatAiProvider")?.value).toBe("mock");
    expect(elements.get("wechatAiPrompt")?.value).toBe("");
    expect(elements.get("wechatAiTitle")?.value).toBe("");
    expect(elements.get("wechatAiAuthor")?.value).toBe("");
    expect(elements.get("wechatAiVersion")?.value).toBe("");
    expect(elements.get("wechatAiCopyright")?.value).toBe("");
    expect(elements.get("wechatAiCount")?.value).toBe("8");
    expect(elements.get("originalPreview")?.src).toBe("");
    expect(elements.get("uploadState")?.textContent).toBe("等待上传");
    expect(elements.get("globalNotice")?.textContent).toContain("已重置当前配置与最近结果");
    expect(elements.get("wechatAiZipLink")?.children).toHaveLength(0);
    expect(elements.get("wechatAiMetadataPreview")?.innerHTML).toContain("生成后在这里查看 ZIP 中的 metadata.json 内容");
    expect(elements.get("regenerateSubmit")?.disabled).toBe(true);
  });
});
