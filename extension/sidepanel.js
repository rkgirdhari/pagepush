// Page Push — side panel controller
//
// Drives the Question & Do wizard, talks to the Facebook content script to
// scan/fill the live page, and optionally bridges to a local daemon running
// at 127.0.0.1:8080 for higher-quality generated copy. Every network call
// and DOM mutation is triggered by an explicit button press.

const logEl = document.getElementById("audit-log");
const dotEl = document.getElementById("daemon-dot");
const statusEl = document.getElementById("daemon-status");
const nodesEl = document.getElementById("dom-nodes");

let currentNodes = [];

function appendLog(msg) {
  const ts = new Date().toLocaleTimeString();
  logEl.textContent = `[${ts}] ${msg}\n${logEl.textContent}`;
}

function daemonRequest(endpoint, method, body) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(
      { type: "PAGEPUSH_DAEMON_REQUEST", endpoint, method, body },
      (res) => resolve(res)
    );
  });
}

async function checkDaemonHealth() {
  const res = await daemonRequest("http://127.0.0.1:8080/api/v1/health", "GET");
  if (res?.ok && res.data) {
    dotEl.classList.add("online");
    statusEl.textContent = `Daemon online (${res.data.engine || "unknown engine"})`;
    appendLog("Connected to local daemon.");
  } else {
    dotEl.classList.remove("online");
    statusEl.textContent = "Offline (using built-in templates)";
    appendLog(res?.error || "Local daemon offline; using built-in offline templates.");
  }
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function sendToContentScript(tabId, message) {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, message, (res) => {
      if (chrome.runtime.lastError) {
        resolve({ ok: false, error: chrome.runtime.lastError.message });
        return;
      }
      resolve(res);
    });
  });
}

// --- 1. Question & Do profile setup ---

function buildOfflineBio(company, focus, website) {
  let bio = `${company.trim()} — ${focus.trim()}. ${website.trim()}`;
  return bio.slice(0, 255);
}

function buildOfflineLaunchPost(company, focus, website) {
  return (
    `${company.trim()} is officially live on Facebook.\n\n` +
    `We help with: ${focus.trim()}.\n\n` +
    `Learn more at ${website.trim()}.`
  );
}

document.getElementById("btn-synthesize").addEventListener("click", async () => {
  const company = document.getElementById("q-company").value.trim();
  const focus = document.getElementById("q-focus").value.trim();
  const website = document.getElementById("q-website").value.trim();

  if (!company || !focus) {
    appendLog("Enter at least a company name and primary focus before generating copy.");
    return;
  }

  appendLog("Generating draft bio and launch post...");
  const res = await daemonRequest("http://127.0.0.1:8080/api/v1/interview", "POST", {
    company,
    focus,
    website
  });

  if (res?.ok && res.data?.bio) {
    document.getElementById("q-bio").value = res.data.bio;
    document.getElementById("q-post").value = res.data.launch_post || "";
    appendLog(`Draft generated via local daemon (engine=${res.data.engine || "daemon"}).`);
  } else {
    document.getElementById("q-bio").value = buildOfflineBio(company, focus, website);
    document.getElementById("q-post").value = buildOfflineLaunchPost(company, focus, website);
    appendLog("Draft generated using built-in offline templates.");
  }
});

// --- 2. Facebook page scan & fill ---

document.getElementById("btn-scan-dom").addEventListener("click", async () => {
  const tab = await getActiveTab();
  if (!tab?.id) {
    appendLog("No active tab found.");
    return;
  }

  const res = await sendToContentScript(tab.id, { type: "PAGEPUSH_DISTILL_DOM" });
  if (!res?.ok) {
    appendLog("Scan failed. Make sure you are on facebook.com and the tab has finished loading, then try again.");
    return;
  }

  currentNodes = res.nodes || [];
  appendLog(`Found ${currentNodes.length} interactive element(s) on the page.`);
  renderNodeList(currentNodes, tab.id);
});

function renderNodeList(nodes, tabId) {
  nodesEl.innerHTML = "";
  if (!nodes.length) {
    nodesEl.textContent = "No interactive elements detected in the current viewport. Scroll and scan again.";
    return;
  }

  for (const n of nodes) {
    const row = document.createElement("div");
    row.className = "node-item";
    const label = n.aria_label || n.placeholder || n.text || n.role;
    row.innerHTML = `<span>[${n.id}] <b>${n.kind}</b>: ${escapeHtml(label.slice(0, 38))}</span>`;

    const actBtn = document.createElement("button");
    actBtn.style.padding = "2px 6px";
    actBtn.style.fontSize = "10px";

    if (n.kind === "lexical_editor") {
      actBtn.textContent = "Fill text";
      actBtn.onclick = () => {
        const lower = label.toLowerCase();
        const val = lower.includes("mind") || lower.includes("write something")
          ? document.getElementById("q-post").value
          : document.getElementById("q-bio").value;
        runDomAction(tabId, { op: "type_lexical", target_id: n.id, value: val });
      };
    } else if (n.kind === "react_input") {
      actBtn.textContent = "Fill input";
      actBtn.onclick = () => {
        const lower = label.toLowerCase();
        const val = lower.includes("web")
          ? document.getElementById("q-website").value
          : lower.includes("bio") || lower.includes("description")
          ? document.getElementById("q-bio").value
          : document.getElementById("q-company").value;
        runDomAction(tabId, { op: "type_react", target_id: n.id, value: val });
      };
    } else {
      actBtn.textContent = "Click";
      actBtn.onclick = () => runDomAction(tabId, { op: "click", target_id: n.id });
    }

    row.appendChild(actBtn);
    nodesEl.appendChild(row);
  }
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

async function runDomAction(tabId, action) {
  const res = await sendToContentScript(tabId, { type: "PAGEPUSH_EXECUTE_ACTION", action });
  if (res?.ok) {
    appendLog(`Done: ${res.detail}`);
  } else {
    appendLog(`Failed: ${res?.error || "DOM action failed"}`);
  }
}

document.getElementById("btn-plan-actions").addEventListener("click", async () => {
  if (!currentNodes.length) {
    appendLog("Scan the Facebook tab first.");
    return;
  }

  const tab = await getActiveTab();
  const bio = document.getElementById("q-bio").value;
  const post = document.getElementById("q-post").value;
  const website = document.getElementById("q-website").value;

  const suggestions = [];
  for (const node of currentNodes) {
    const label = `${node.aria_label} ${node.placeholder} ${node.text}`.toLowerCase();
    if (node.kind === "lexical_editor" && (label.includes("mind") || label.includes("write something"))) {
      suggestions.push(node.id);
    } else if (node.kind === "lexical_editor" && label.includes("bio")) {
      suggestions.push(node.id);
    } else if (node.kind === "react_input" && label.includes("web")) {
      suggestions.push(node.id);
    } else if (node.kind === "button" && label.includes("update your page")) {
      suggestions.push(node.id);
    }
  }

  if (!suggestions.length) {
    appendLog("No obvious matching fields found. Scroll the page and scan again, or use the manual Fill buttons above.");
    return;
  }

  appendLog(`Highlighting ${suggestions.length} suggested field(s)...`);
  for (const id of suggestions) {
    await runDomAction(tab.id, { op: "highlight", target_id: id });
  }
  void bio;
  void post;
  void website;
});

// --- 3. Optional local bridge ---

document.getElementById("btn-bridge-sync").addEventListener("click", async () => {
  const endpoint = document.getElementById("bridge-target").value;
  const res = await daemonRequest(endpoint, endpoint.endsWith("/interview") ? "POST" : "GET", {
    company: document.getElementById("q-company").value,
    focus: document.getElementById("q-focus").value,
    website: document.getElementById("q-website").value
  });

  if (res?.ok) {
    appendLog(`Daemon responded: ${JSON.stringify(res.data)}`);
  } else {
    appendLog(`Request failed: ${res?.error || "unknown error"}`);
  }
});

document.getElementById("btn-ping").addEventListener("click", checkDaemonHealth);
checkDaemonHealth();
