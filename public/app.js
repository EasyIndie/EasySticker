const uploadForm = document.getElementById("uploadForm");
const uploadResult = document.getElementById("uploadResult");
const originalPreview = document.getElementById("originalPreview");
const wechatAiForm = document.getElementById("wechatAiForm");
const wechatAiResult = document.getElementById("wechatAiResult");
const wechatAiZipLink = document.getElementById("wechatAiZipLink");
const wechatAiPreview = document.getElementById("wechatAiPreview");
const wechatAiSuggest = document.getElementById("wechatAiSuggest");

let currentUploadId = null;

uploadForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  uploadResult.textContent = "上传中...";

  const fileEl = document.getElementById("file");
  const file = fileEl.files?.[0];
  if (!file) return;

  const form = new FormData();
  form.append("file", file);

  const res = await fetch("/api/uploads", { method: "POST", body: form });
  const json = await res.json();
  uploadResult.textContent = JSON.stringify(json, null, 2);

  currentUploadId = json?.uploadId ?? null;
  wechatAiResult.textContent = "";
  wechatAiZipLink.innerHTML = "";
  wechatAiPreview.innerHTML = "";

  if (json?.original?.url) {
    originalPreview.src = json.original.url;
  }
  document.getElementById("wechatRefId").value = currentUploadId ?? "";
});

wechatAiSuggest.addEventListener("click", async () => {
  const ref = document.getElementById("wechatRefId").value.trim() || currentUploadId;
  if (!ref) return;
  wechatAiResult.textContent = "生成中...";
  const res = await fetch("/api/wechat/prompt", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ referenceAssetId: ref })
  });
  const json = await res.json();
  wechatAiResult.textContent = JSON.stringify(json, null, 2);
  document.getElementById("wechatAiPrompt").value = json.prompt ?? "";
  document.getElementById("wechatAiStyles").value = (json.styles ?? []).join(",");
});

wechatAiForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const ref = document.getElementById("wechatRefId").value.trim() || currentUploadId;
  if (!ref) return;
  const prompt = document.getElementById("wechatAiPrompt").value.trim();
  if (!prompt) return;

  wechatAiResult.textContent = "生成中...";
  wechatAiZipLink.innerHTML = "";
  wechatAiPreview.innerHTML = "";

  const count = Number(document.getElementById("wechatAiCount").value);
  const stylesRaw = document.getElementById("wechatAiStyles").value.trim();
  const styles = stylesRaw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const title = document.getElementById("wechatAiTitle").value.trim();

  const res = await fetch("/api/wechat/generate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      referenceAssetId: ref,
      prompt,
      styles: styles.length ? styles : undefined,
      stickerCount: Number.isFinite(count) ? count : undefined,
      includeCover: true,
      includeIcon: true,
      includeBanner: true,
      metadata: title ? { title } : undefined
    })
  });
  const json = await res.json();
  wechatAiResult.textContent = JSON.stringify(json, null, 2);

  if (json?.downloadUrl) {
    const link = document.createElement("a");
    link.href = json.downloadUrl;
    link.textContent = `下载 ${json.packId}.zip`;
    link.rel = "noopener";
    wechatAiZipLink.appendChild(link);
  }

  const stickers = json?.stickers ?? [];
  for (const s of stickers.slice(0, 6)) {
    const wrap = document.createElement("div");
    const label = document.createElement("div");
    label.className = "muted";
    label.textContent = s.label;
    const img = document.createElement("img");
    img.className = "preview";
    img.src = s.url;
    wrap.appendChild(label);
    wrap.appendChild(img);
    wechatAiPreview.appendChild(wrap);
  }
});
