import { loadConnectedPages, loadSettings, saveSettings } from "../lib/storage.js";
import { getExpiringPages, disconnectPage } from "../background/auth.js";
import { DEFAULT_SETTINGS } from "../lib/constants.js";

const els = {};

document.addEventListener("DOMContentLoaded", init);

async function init() {
  [
    "pagesList",
    "connectBtn",
    "planBadge",
    "planSelect",
    "warnOffHoursCheckbox",
    "warnFrequencyCheckbox",
    "markdownStyleSelect",
  ].forEach((id) => (els[id] = document.getElementById(id)));

  els.connectBtn.addEventListener("click", async () => {
    const response = await chrome.runtime.sendMessage({ type: "CONNECT_PAGES" });
    if (!response.ok) {
      alert(`Couldn't connect: ${response.error.message}`);
      return;
    }
    renderPages();
  });

  els.planSelect.addEventListener("change", async (e) => {
    const settings = await loadSettings(DEFAULT_SETTINGS);
    settings.plan = e.target.value;
    await saveSettings(settings);
    renderPlan(settings);
  });

  els.warnOffHoursCheckbox.addEventListener("change", persistSettingsFromForm);
  els.warnFrequencyCheckbox.addEventListener("change", persistSettingsFromForm);
  els.markdownStyleSelect.addEventListener("change", persistSettingsFromForm);

  const settings = await loadSettings(DEFAULT_SETTINGS);
  els.warnOffHoursCheckbox.checked = settings.warnOnOffHours;
  els.warnFrequencyCheckbox.checked = settings.warnOnFrequencyCap;
  els.markdownStyleSelect.value = settings.markdownStyle;
  els.planSelect.value = settings.plan;
  renderPlan(settings);

  await renderPages();
}

async function persistSettingsFromForm() {
  const settings = await loadSettings(DEFAULT_SETTINGS);
  settings.warnOnOffHours = els.warnOffHoursCheckbox.checked;
  settings.warnOnFrequencyCap = els.warnFrequencyCheckbox.checked;
  settings.markdownStyle = els.markdownStyleSelect.value;
  await saveSettings(settings);
}

function renderPlan(settings) {
  els.planBadge.textContent = settings.plan.charAt(0).toUpperCase() + settings.plan.slice(1);
}

async function renderPages() {
  const pages = await loadConnectedPages();
  const expiring = await getExpiringPages();
  const expiringIds = new Set(expiring.map((p) => p.id));

  els.pagesList.innerHTML = "";
  if (pages.length === 0) {
    els.pagesList.innerHTML = '<li class="pp-opts-hint">No Pages connected yet.</li>';
    return;
  }

  for (const page of pages) {
    const li = document.createElement("li");
    li.className = "pp-page-item";

    const meta = document.createElement("div");
    meta.className = "pp-page-meta";
    if (page.picture) {
      const img = document.createElement("img");
      img.src = page.picture;
      meta.appendChild(img);
    }
    const name = document.createElement("span");
    name.textContent = page.name;
    meta.appendChild(name);
    if (expiringIds.has(page.id)) {
      const badge = document.createElement("span");
      badge.className = "pp-expiring-badge";
      badge.textContent = "\u26a0\ufe0f Reconnect soon";
      meta.appendChild(badge);
    }
    li.appendChild(meta);

    const disconnectBtn = document.createElement("button");
    disconnectBtn.className = "pp-opts-btn-danger";
    disconnectBtn.textContent = "Disconnect";
    disconnectBtn.addEventListener("click", async () => {
      await disconnectPage(page.id);
      renderPages();
    });
    li.appendChild(disconnectBtn);

    els.pagesList.appendChild(li);
  }
}
