// State
const state = {
  source: { connected: false, base: "", env: "" },
  dest: { connected: false, base: "", env: "" },
  currentPath: "",
  pathStack: [],
  selectedItems: new Map(), // id -> {id, name, isFolder}
  transferring: false,
};

// DOM elements
const $ = (sel) => document.querySelector(sel);
const sourceUrl = $("#source-url");
const sourceApiKey = $("#source-apikey");
const sourceConnectBtn = $("#source-connect-btn");
const sourceStatus = $("#source-status");
const sourceBrowser = $("#source-browser");
const sourceResource = $("#source-resource");
const sourceBreadcrumb = $("#source-breadcrumb");
const sourceFileList = $("#source-file-list");
const selectedCount = $("#selected-count");
const transferBtn = $("#transfer-btn");

const destUrl = $("#dest-url");
const destApiKey = $("#dest-apikey");
const destConnectBtn = $("#dest-connect-btn");
const destStatus = $("#dest-status");
const destInfo = $("#dest-info");
const destEnvName = $("#dest-env-name");

const transferOverlay = $("#transfer-overlay");
const transferTitle = $("#transfer-title");
const progressFill = $("#progress-fill");
const transferLog = $("#transfer-log");
const transferActions = $("#transfer-actions");
const transferCloseBtn = $("#transfer-close-btn");

// API helper
async function api(endpoint, data) {
  const resp = await fetch(`/api${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  const json = await resp.json();
  if (!resp.ok) {
    throw new Error(json.error || `Request failed with status ${resp.status}`);
  }
  return json;
}

// Connect to source
sourceConnectBtn.addEventListener("click", async () => {
  const url = sourceUrl.value.trim();
  const apiKey = sourceApiKey.value.trim();

  if (!url || !apiKey) {
    alert("Please enter both URL and API Key");
    return;
  }

  setStatus(sourceStatus, "connecting", "Connecting...");
  sourceConnectBtn.disabled = true;

  try {
    const result = await api("/connect", { url, apiKey, role: "source" });
    state.source = { connected: true, base: result.base, env: result.env };
    setStatus(sourceStatus, "connected", `Connected: ${result.env}`);
    sourceBrowser.classList.remove("hidden");
    browseTo("");
  } catch (e) {
    setStatus(sourceStatus, "disconnected", "Disconnected");
    alert(`Connection failed: ${e.message}`);
  } finally {
    sourceConnectBtn.disabled = false;
  }
});

// Connect to destination
destConnectBtn.addEventListener("click", async () => {
  const url = destUrl.value.trim();
  const apiKey = destApiKey.value.trim();

  if (!url || !apiKey) {
    alert("Please enter both URL and API Key");
    return;
  }

  setStatus(destStatus, "connecting", "Connecting...");
  destConnectBtn.disabled = true;

  try {
    const result = await api("/connect", { url, apiKey, role: "destination" });
    state.dest = { connected: true, base: result.base, env: result.env };
    setStatus(destStatus, "connected", `Connected: ${result.env}`);
    destInfo.classList.remove("hidden");
    destEnvName.textContent = result.env;
  } catch (e) {
    setStatus(destStatus, "disconnected", "Disconnected");
    alert(`Connection failed: ${e.message}`);
  } finally {
    destConnectBtn.disabled = false;
  }
});

// Resource type change
sourceResource.addEventListener("change", () => {
  state.currentPath = "";
  state.pathStack = [];
  state.selectedItems.clear();
  updateSelectionUI();
  updateBreadcrumb();
  browseTo("");
});

// Set status indicator
function setStatus(el, type, text) {
  el.className = `status ${type}`;
  el.textContent = text;
}

// Browse to a path
async function browseTo(path) {
  state.currentPath = path;
  sourceFileList.innerHTML =
    '<div class="loading-state"><div class="spinner"></div>Loading...</div>';

  try {
    const result = await api("/browse", {
      role: "source",
      resource: sourceResource.value,
      path: path,
    });

    renderFileList(result.items);
  } catch (e) {
    sourceFileList.innerHTML = `<div class="empty-state">Error: ${e.message}</div>`;
  }
}

// Render file list
function renderFileList(items) {
  sourceFileList.innerHTML = "";

  // Add back navigation if not at root
  if (state.pathStack.length > 0) {
    const backItem = document.createElement("div");
    backItem.className = "file-list-item back-item";
    backItem.innerHTML = `
      <span class="icon">&#8592;</span>
      <span class="item-name">.. (Back)</span>
    `;
    backItem.addEventListener("click", () => {
      state.pathStack.pop();
      const parentPath =
        state.pathStack.length > 0
          ? state.pathStack[state.pathStack.length - 1]
          : "";
      updateBreadcrumb();
      browseTo(parentPath);
    });
    sourceFileList.appendChild(backItem);
  }

  if (items.length === 0 && state.pathStack.length === 0) {
    sourceFileList.innerHTML =
      '<div class="empty-state">No items found</div>';
    return;
  }

  // Sort: folders first, then files
  const sorted = [...items].sort((a, b) => {
    if (a.isFolder && !b.isFolder) return -1;
    if (!a.isFolder && b.isFolder) return 1;
    return a.name.localeCompare(b.name);
  });

  for (const item of sorted) {
    const el = document.createElement("div");
    el.className = "file-list-item";
    if (state.selectedItems.has(item.id)) {
      el.classList.add("selected");
    }

    const icon = item.isFolder ? "&#128193;" : "&#128196;";
    const iconClass = item.isFolder ? "folder" : "file";

    el.innerHTML = `
      <span class="icon ${iconClass}">${icon}</span>
      <span class="item-name">${escapeHtml(item.name)}</span>
      ${!item.isFolder ? `<span class="item-id">${item.id}</span>` : ""}
    `;

    el.addEventListener("click", () => {
      if (item.isFolder) {
        // Navigate into folder
        const newPath = state.currentPath
          ? state.currentPath + "\\" + item.name
          : item.name;
        state.pathStack.push(newPath);
        updateBreadcrumb();
        browseTo(newPath);
      } else {
        // Toggle selection
        if (state.selectedItems.has(item.id)) {
          state.selectedItems.delete(item.id);
          el.classList.remove("selected");
        } else {
          state.selectedItems.set(item.id, {
            id: item.id,
            name: item.name,
          });
          el.classList.add("selected");
        }
        updateSelectionUI();
      }
    });

    sourceFileList.appendChild(el);
  }
}

// Update breadcrumb
function updateBreadcrumb() {
  sourceBreadcrumb.innerHTML = "";

  const root = document.createElement("span");
  root.className = "breadcrumb-item breadcrumb-root";
  root.textContent = "Root";
  root.addEventListener("click", () => {
    state.pathStack = [];
    state.currentPath = "";
    updateBreadcrumb();
    browseTo("");
  });
  sourceBreadcrumb.appendChild(root);

  for (let i = 0; i < state.pathStack.length; i++) {
    const sep = document.createElement("span");
    sep.className = "breadcrumb-separator";
    sep.textContent = "/";
    sourceBreadcrumb.appendChild(sep);

    const parts = state.pathStack[i].split("\\");
    const folderName = parts[parts.length - 1];

    const crumb = document.createElement("span");
    crumb.className = "breadcrumb-item";
    crumb.textContent = folderName;

    const pathAtIndex = state.pathStack[i];
    crumb.addEventListener("click", () => {
      state.pathStack = state.pathStack.slice(0, i + 1);
      updateBreadcrumb();
      browseTo(pathAtIndex);
    });

    sourceBreadcrumb.appendChild(crumb);
  }
}

// Update selection UI
function updateSelectionUI() {
  selectedCount.textContent = state.selectedItems.size;
  transferBtn.disabled =
    state.selectedItems.size === 0 || !state.dest.connected;
}

// Transfer button
transferBtn.addEventListener("click", () => {
  if (state.selectedItems.size === 0) return;
  if (!state.dest.connected) {
    alert("Please connect the destination first");
    return;
  }

  startTransfer();
});

// Start transfer
async function startTransfer() {
  state.transferring = true;
  transferOverlay.classList.remove("hidden");
  transferActions.classList.add("hidden");
  transferTitle.textContent = "Transferring...";
  transferLog.innerHTML = "";
  progressFill.className = "progress-fill indeterminate";
  progressFill.style.width = "";

  const items = Array.from(state.selectedItems.values());
  const resource = sourceResource.value;

  addLogEntry(
    "info",
    `Starting transfer of ${items.length} ${resource} item(s)...`,
  );

  // Set up SSE for progress
  const evtSource = new EventSource("/api/transfer/events");

  evtSource.addEventListener("connected", () => {
    // Connected to SSE, now start the transfer
    api("/transfer", { resource, items }).catch((e) => {
      addLogEntry("error", `Transfer request failed: ${e.message}`);
      onTransferDone(false);
    });
  });

  evtSource.addEventListener("log", (e) => {
    const data = JSON.parse(e.data);
    // Detect success messages
    if (data.message.includes("Successifully uploaded") || data.message.includes("Successfully uploaded")) {
      addLogEntry("success", data.message);
    } else {
      addLogEntry("log", data.message);
    }
  });

  evtSource.addEventListener("error", (e) => {
    if (e.data) {
      const data = JSON.parse(e.data);
      addLogEntry("error", data.message);
    }
  });

  evtSource.addEventListener("start", (e) => {
    const data = JSON.parse(e.data);
    addLogEntry("info", data.message);
  });

  evtSource.addEventListener("complete", (e) => {
    const data = JSON.parse(e.data);
    addLogEntry("success", data.message);
    evtSource.close();
    onTransferDone(true);
  });

  evtSource.onerror = () => {
    // SSE connection error - may just be the stream closing
    if (state.transferring) {
      evtSource.close();
      onTransferDone(false);
    }
  };
}

function onTransferDone(success) {
  state.transferring = false;
  transferActions.classList.remove("hidden");

  if (success) {
    transferTitle.textContent = "Transfer Complete";
    progressFill.className = "progress-fill complete";
  } else {
    transferTitle.textContent = "Transfer Finished (with errors)";
    progressFill.className = "progress-fill error";
    progressFill.style.width = "100%";
  }
}

// Close transfer overlay
transferCloseBtn.addEventListener("click", () => {
  transferOverlay.classList.add("hidden");
  state.selectedItems.clear();
  updateSelectionUI();
  // Re-render current view to clear selections
  browseTo(state.currentPath);
});

// Log entry helper
function addLogEntry(type, message) {
  const entry = document.createElement("div");
  entry.className = `log-entry ${type}`;
  entry.textContent = message;
  transferLog.appendChild(entry);
  transferLog.scrollTop = transferLog.scrollHeight;
}

// HTML escape
function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

// Allow Enter key to trigger connect
sourceApiKey.addEventListener("keydown", (e) => {
  if (e.key === "Enter") sourceConnectBtn.click();
});
destApiKey.addEventListener("keydown", (e) => {
  if (e.key === "Enter") destConnectBtn.click();
});
