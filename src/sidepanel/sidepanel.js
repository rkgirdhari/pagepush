// Side panel controller: the "golden path" UI from spec section 4.
// Talks to the background service worker exclusively via chrome.runtime.sendMessage
// so all Facebook API access, token handling, and persistence stays out of UI code.

import { formatForFacebook } from "../lib/formatter.js";
import { runAllTextChecks, checkImageDimensions, checkImageFileSize } from "../lib/content-checks.js";
import {
  POST_CHARACTER_LIMIT,
  POST_SEE_MORE_FOLD,
  PLAN_LIMITS,
} from "../lib/constants.js";
import {
  loadConnectedPages,
  getActivePageId,
  setActivePageId,
  takePendingCapture,
  loadHistory,
  loadTemplates,
  saveTemplates,
  loadSettings,
} from "../lib/storage.js";

const DEFAULT_SETTINGS = { plan: "free", markdownStyle: "unicode" };

const els = {};
let state = {
  pages: [],
  activePageId: null,
  image: null, // { dataUrl, url, altText, width, height, bytes }
  settings: DEFAULT_SETTINGS,
  mode: "compose",
};

document.addEventListener("DOMContentLoaded", init);

async function init() {
  cacheElements();
  bindEvents();
  state.settings = await loadSettings(DEFAULT_SETTINGS);
  await refreshPages();
  await applyPendingCapture();
  await refreshHistory();
  await refreshTemplates();
  updateComposeDerivedUi();
}

function cacheElements() {
  [
    "noPageState",
    "composeState",
    "connectPagesBtn",
    "pageSelect",
    "postText",
    "charCounter",
    "foldWarning",
    "formatWarnings",
    "imageDropZone",
    "imageInput",
    "imageEmptyState",
    "imagePreviewState",
    "imagePreview",
    "removeImageBtn",
    "browseImageBtn",
    "altTextInput",
    "imageWarnings",
    "cadenceWarnings",
    "togglePreviewBtn",
    "facebookPreview",
    "scheduleRow",
    "scheduleDateTime",
    "statusMessage",
    "saveDraftBtn",
    "scheduleBtn",
    "postNowBtn",
    "confirmScheduleBtn",
    "openOptions",
    "historyList",
    "templatesList",
    "saveAsTemplateBtn",
    "composeTab",
    "historyTab",
    "templatesTab",
  ].forEach((id) => (els[id] = document.getElementById(id)));
  els.tabs = Array.from(document.querySelectorAll(".pp-tab"));
}

function bindEvents() {
  els.connectPagesBtn.addEventListener("click", connectPages);
  els.openOptions.addEventListener("click", () => chrome.runtime.openOptionsPage());
  els.pageSelect.addEventListener("change", async (e) => {
    state.activePageId = e.target.value;
    await setActivePageId(state.activePageId);
    await refreshHistory();
  });

  els.postText.addEventListener("input", updateComposeDerivedUi);

  els.browseImageBtn.addEventListener("click", () => els.imageInput.click());
  els.imageInput.addEventListener("change", (e) => handleImageFile(e.target.files[0]));
  els.removeImageBtn.addEventListener("click", clearImage);

  els.imageDropZone.addEventListener("dragover", (e) => {
    e.preventDefault();
    els.imageDropZone.classList.add("dragover");
  });
  els.imageDropZone.addEventListener("dragleave", () => els.imageDropZone.classList.remove("dragover"));
  els.imageDropZone.addEventListener("drop", (e) => {
    e.preventDefault();
    els.imageDropZone.classList.remove("dragover");
    const file = e.dataTransfer.files[0];
    if (file) handleImageFile(file);
  });
  document.addEventListener("paste", (e) => {
    const item = Array.from(e.clipboardData?.items || []).find((i) => i.type.startsWith("image/"));
    if (item) handleImageFile(item.getAsFile());
  });

  els.togglePreviewBtn.addEventListener("click", () => {
    els.facebookPreview.classList.toggle("hidden");
    renderFacebookPreview();
  });

  els.saveDraftBtn.addEventListener("click", () => submitPost({ published: false }));
  els.postNowBtn.addEventListener("click", () => submitPost({ published: true }));
  els.scheduleBtn.addEventListener("click", () => {
    els.scheduleRow.classList.remove("hidden");
    els.confirmScheduleBtn.classList.remove("hidden");
    const defaultTime = new Date(Date.now() + 60 * 60 * 1000);
    els.scheduleDateTime.value = toLocalDatetimeInputValue(defaultTime);
  });
  els.confirmScheduleBtn.addEventListener("click", () => submitPost({ scheduled: true }));

  els.saveAsTemplateBtn.addEventListener("click", saveCurrentAsTemplate);

  els.tabs.forEach((tab) =>
    tab.addEventListener("click", () => {
      els.tabs.forEach((t) => t.classList.remove("active"));
      tab.classList.add("active");
      state.mode = tab.dataset.tab;
      els.composeTab.classList.toggle("hidden", state.mode !== "compose");
      els.historyTab.classList.toggle("hidden", state.mode !== "history");
      els.templatesTab.classList.toggle("hidden", state.mode !== "templates");
      if (state.mode === "history") refreshHistory();
      if (state.mode === "templates") refreshTemplates();
    })
  );
}

async function connectPages() {
  const response = await chrome.runtime.sendMessage({ type: "CONNECT_PAGES" });
  if (!response.ok) {
    showStatus(`Couldn't connect: ${response.error.message}`, "error");
    return;
  }
  await refreshPages();
}

async function refreshPages() {
  state.pages = await loadConnectedPages();
  const freeLimitHit = state.settings.plan === "free" && state.pages.length > PLAN_LIMITS.free.maxPages;

  if (state.pages.length === 0) {
    els.noPageState.classList.remove("hidden");
    els.composeState.classList.add("hidden");
    return;
  }

  els.noPageState.classList.add("hidden");
  els.composeState.classList.remove("hidden");

  els.pageSelect.innerHTML = "";
  const visiblePages = freeLimitHit ? state.pages.slice(0, PLAN_LIMITS.free.maxPages) : state.pages;
  for (const page of visiblePages) {
    const opt = document.createElement("option");
    opt.value = page.id;
    opt.textContent = page.name;
    els.pageSelect.appendChild(opt);
  }

  state.activePageId = (await getActivePageId()) || visiblePages[0]?.id;
  if (state.activePageId) els.pageSelect.value = state.activePageId;
}

async function applyPendingCapture() {
  const capture = await takePendingCapture();
  if (!capture) return;
  els.postText.value = capture.text || "";
  if (capture.image?.url) {
    state.image = { url: capture.image.url, altText: capture.image.altText || "" };
    renderImagePreview(capture.image.url);
  }
}

function updateComposeDerivedUi() {
  const raw = els.postText.value;
  const { text, length } = formatForFacebook(raw, { style: "plain" });
  // Only used for warnings, not to silently rewrite what the user is typing live;
  // formatting is applied explicitly, warnings just reflect current raw length.
  const currentLength = raw.length;

  els.charCounter.textContent = `${currentLength.toLocaleString()} / ${POST_CHARACTER_LIMIT.toLocaleString()}`;
  els.charCounter.classList.toggle("over-limit", currentLength > POST_CHARACTER_LIMIT);
  els.foldWarning.classList.toggle("hidden", currentLength <= POST_SEE_MORE_FOLD);

  const warnings = runAllTextChecks(raw);
  renderWarnings(els.formatWarnings, warnings.filter((w) => w.code !== "over_limit" && w.code !== "see_more_fold"));

  renderFacebookPreview();
  void length; // reserved for future server-side length validation parity
  void text;
}

function renderWarnings(container, warnings) {
  container.innerHTML = "";
  for (const w of warnings) {
    const div = document.createElement("div");
    div.className = `pp-warning ${w.severity}`;
    div.textContent = w.message;
    container.appendChild(div);
  }
}

function renderFacebookPreview() {
  if (els.facebookPreview.classList.contains("hidden")) return;
  const { text } = formatForFacebook(els.postText.value, { style: state.settings.markdownStyle });
  els.facebookPreview.innerHTML = "";
  const textNode = document.createElement("div");
  textNode.textContent = text;
  els.facebookPreview.appendChild(textNode);
  if (state.image) {
    const img = document.createElement("img");
    img.src = state.image.dataUrl || state.image.url;
    els.facebookPreview.appendChild(img);
  }
}

function handleImageFile(file) {
  if (!file) return;
  const warnings = checkImageFileSize(file.size);
  const reader = new FileReader();
  reader.onload = () => {
    const dataUrl = reader.result;
    const img = new Image();
    img.onload = () => {
      const dimWarnings = checkImageDimensions(img.naturalWidth, img.naturalHeight);
      state.image = { dataUrl, width: img.naturalWidth, height: img.naturalHeight, bytes: file.size, altText: "" };
      renderWarnings(els.imageWarnings, [...warnings, ...dimWarnings]);
      renderImagePreview(dataUrl);
      renderFacebookPreview();
    };
    img.src = dataUrl;
  };
  reader.readAsDataURL(file);
}

function renderImagePreview(src) {
  els.imagePreview.src = src;
  els.imageEmptyState.classList.add("hidden");
  els.imagePreviewState.classList.remove("hidden");
  els.altTextInput.classList.remove("hidden");
  els.altTextInput.value = state.image?.altText || "";
  els.altTextInput.oninput = (e) => {
    if (state.image) state.image.altText = e.target.value;
  };
}

function clearImage() {
  state.image = null;
  els.imageEmptyState.classList.remove("hidden");
  els.imagePreviewState.classList.add("hidden");
  els.altTextInput.classList.add("hidden");
  els.imageWarnings.innerHTML = "";
  renderFacebookPreview();
}

async function submitPost({ published, scheduled }) {
  if (!state.activePageId) {
    showStatus("Select a Page first.", "error");
    return;
  }
  const { text, firstUrl } = formatForFacebook(els.postText.value, { style: state.settings.markdownStyle });
  if (!text.trim() && !state.image) {
    showStatus("Nothing to post \u2014 add some text or an image.", "error");
    return;
  }
  if (text.length > POST_CHARACTER_LIMIT) {
    showStatus("Post is over Facebook's character limit. Trim it before posting.", "error");
    return;
  }

  setButtonsDisabled(true);
  try {
    if (scheduled) {
      const whenEpochMs = new Date(els.scheduleDateTime.value).getTime();
      if (!whenEpochMs || whenEpochMs <= Date.now()) {
        showStatus("Pick a future date/time to schedule.", "error");
        return;
      }
      const response = await chrome.runtime.sendMessage({
        type: "SCHEDULE_POST",
        payload: { pageId: state.activePageId, text, link: firstUrl, image: state.image },
        whenEpochMs,
      });
      if (!response.ok) throw new Error(response.error.message);
      showStatus(`Scheduled for ${new Date(whenEpochMs).toLocaleString()}.`, "success");
      els.scheduleRow.classList.add("hidden");
      els.confirmScheduleBtn.classList.add("hidden");
    } else {
      const response = await chrome.runtime.sendMessage({
        type: "PUBLISH_POST",
        payload: { pageId: state.activePageId, text, link: firstUrl, image: state.image, published },
      });
      if (!response.ok) {
        const suggestion = response.error.suggestion ? ` ${response.error.suggestion}` : "";
        throw new Error(`${response.error.message}${suggestion}`);
      }
      showStatus(published ? "Posted to your Page! \ud83c\udf89" : "Saved as a draft in Business Suite.", "success");
    }
    await refreshHistory();
  } catch (err) {
    showStatus(err.message, "error");
  } finally {
    setButtonsDisabled(false);
  }
}

function setButtonsDisabled(disabled) {
  [els.saveDraftBtn, els.scheduleBtn, els.postNowBtn, els.confirmScheduleBtn].forEach((b) => (b.disabled = disabled));
}

function showStatus(message, kind) {
  els.statusMessage.textContent = message;
  els.statusMessage.className = `pp-status ${kind}`;
  els.statusMessage.classList.remove("hidden");
}

async function refreshHistory() {
  if (!state.activePageId) return;
  const cadenceResponse = await chrome.runtime.sendMessage({ type: "GET_CADENCE_WARNINGS", pageId: state.activePageId });
  if (cadenceResponse.ok) renderWarnings(els.cadenceWarnings, cadenceResponse.result);

  const history = (await loadHistory()).filter((h) => h.pageId === state.activePageId);
  els.historyList.innerHTML = "";
  for (const entry of history.slice(0, 50)) {
    const li = document.createElement("li");
    li.className = "pp-history-item";
    li.innerHTML = `
      <div class="pp-history-meta">
        <span>${new Date(entry.at).toLocaleString()}</span>
        <span class="pp-status-badge ${entry.status}">${entry.status}</span>
      </div>
      <div class="pp-history-text"></div>
    `;
    li.querySelector(".pp-history-text").textContent = entry.text || "(image only)";
    const repostBtn = document.createElement("button");
    repostBtn.className = "pp-btn pp-btn-link";
    repostBtn.textContent = "Repost";
    repostBtn.addEventListener("click", () => {
      els.postText.value = entry.text || "";
      updateComposeDerivedUi();
      document.querySelector('.pp-tab[data-tab="compose"]').click();
    });
    li.appendChild(repostBtn);
    els.historyList.appendChild(li);
  }
}

async function refreshTemplates() {
  const templates = await loadTemplates();
  els.templatesList.innerHTML = "";
  for (const template of templates) {
    const li = document.createElement("li");
    li.className = "pp-template-item";
    const preview = document.createElement("div");
    preview.className = "pp-history-text";
    preview.textContent = template.text;
    li.appendChild(preview);

    const useBtn = document.createElement("button");
    useBtn.className = "pp-btn pp-btn-link";
    useBtn.textContent = "Use";
    useBtn.addEventListener("click", () => {
      els.postText.value = template.text;
      updateComposeDerivedUi();
      document.querySelector('.pp-tab[data-tab="compose"]').click();
    });

    const deleteBtn = document.createElement("button");
    deleteBtn.className = "pp-btn pp-btn-link";
    deleteBtn.textContent = "Delete";
    deleteBtn.addEventListener("click", async () => {
      const remaining = templates.filter((t) => t.id !== template.id);
      await saveTemplates(remaining);
      refreshTemplates();
    });

    li.appendChild(useBtn);
    li.appendChild(deleteBtn);
    els.templatesList.appendChild(li);
  }
}

async function saveCurrentAsTemplate() {
  if (!els.postText.value.trim()) return;
  const templates = await loadTemplates();
  templates.unshift({ id: crypto.randomUUID(), text: els.postText.value, savedAt: Date.now() });
  await saveTemplates(templates);
  refreshTemplates();
}

function toLocalDatetimeInputValue(date) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
