const fileGridEl = document.getElementById("file-grid");
const statusEl = document.getElementById("status");
const pathInput = document.getElementById("path-input");
const pathSuggestionsEl = document.getElementById("path-suggestions");
const backBtn = document.getElementById("back-btn");
const upBtn = document.getElementById("up-btn");
const previewMetaEl = document.getElementById("preview-meta");
const previewContentEl = document.getElementById("preview-content");
const tabbarEl = document.getElementById("tabbar");
const newTabBtn = document.getElementById("new-tab-btn");
const sortSelect = document.getElementById("sort-select");
const sortOrderBtn = document.getElementById("sort-order-btn");
const searchInput = document.getElementById("search-input");
const iconSizeInput = document.getElementById("icon-size");
const iconSizeLabel = document.getElementById("icon-size-label");
const columnCountInput = document.getElementById("column-count");
const columnCountLabel = document.getElementById("column-count-label");
const densitySlider = document.getElementById("density-slider");
const densityLabel = document.getElementById("density-label");
const contextMenuEl = document.getElementById("context-menu");
const splitLayoutEl = document.getElementById("split-layout");
const resizerEl = document.getElementById("resizer");

const rootPath = document.getElementById("root-path").textContent;
const PREFS_KEY = "web_file_explorer_prefs_v1";
const HISTORY_KEY = "web_file_explorer_opened_paths_v1";

let tabs = [];
let activeTabId = null;
let nextTabId = 1;
let contextTargetPath = null;
let manualOpenedHistory = [];

const densityMap = { 1: { label: "低" }, 2: { label: "中" }, 3: { label: "高" } };
const uiPrefs = { iconSize: 44, columns: 3, densityLevel: 3 };

function showStatus(msg, isError = false) {
  statusEl.textContent = msg;
  statusEl.className = isError ? "error" : "";
}
function formatDate(isoDate) { return new Date(isoDate).toLocaleString(); }
function escapeHtml(raw) { const div = document.createElement("div"); div.textContent = raw; return div.innerHTML; }
function getActiveTab() { return tabs.find((tab) => tab.id === activeTabId) || null; }
function shortenPathLabel(path) { return path.length <= 26 ? (path || "(空路径)") : `${path.slice(0, 8)}...${path.slice(-15)}`; }

function savePrefs() {
  localStorage.setItem(PREFS_KEY, JSON.stringify(uiPrefs));
}
function loadPrefs() {
  try {
    const parsed = JSON.parse(localStorage.getItem(PREFS_KEY) || "{}");
    if (Number.isFinite(parsed.iconSize)) uiPrefs.iconSize = Math.max(28, Math.min(88, parsed.iconSize));
    if (Number.isFinite(parsed.columns)) uiPrefs.columns = Math.max(1, Math.min(8, parsed.columns));
    if (Number.isFinite(parsed.densityLevel)) uiPrefs.densityLevel = Math.max(1, Math.min(3, parsed.densityLevel));
  } catch (_err) {}
}

function loadManualHistory() {
  try {
    const parsed = JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
    if (Array.isArray(parsed)) manualOpenedHistory = parsed.filter((v) => typeof v === "string");
  } catch (_err) {
    manualOpenedHistory = [];
  }
}
function saveManualHistory() {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(manualOpenedHistory.slice(0, 50)));
}
function rememberManualPath(path) {
  const cleaned = path.trim();
  if (!cleaned) return;
  manualOpenedHistory = [cleaned, ...manualOpenedHistory.filter((item) => item !== cleaned)].slice(0, 50);
  saveManualHistory();
}
function deleteHistoryPath(path) {
  manualOpenedHistory = manualOpenedHistory.filter((item) => item !== path);
  saveManualHistory();
  renderPathSuggestions();
}

function applyUiPrefs() {
  document.documentElement.style.setProperty("--icon-size", `${uiPrefs.iconSize}px`);
  document.documentElement.style.setProperty("--columns", String(uiPrefs.columns));
  iconSizeInput.value = String(uiPrefs.iconSize);
  iconSizeLabel.textContent = String(uiPrefs.iconSize);
  columnCountInput.value = String(uiPrefs.columns);
  columnCountLabel.textContent = String(uiPrefs.columns);
  densitySlider.value = String(uiPrefs.densityLevel);
  densityLabel.textContent = densityMap[uiPrefs.densityLevel].label;
}

function hideContextMenu() { contextMenuEl.style.display = "none"; contextTargetPath = null; }
function hideSuggestions() { pathSuggestionsEl.style.display = "none"; }

function renderPathSuggestions() {
  const q = pathInput.value.trim();
  const items = [];
  if (q) items.push({ type: "open", path: q });
  for (const p of manualOpenedHistory) items.push({ type: "history", path: p });
  if (items.length === 0) {
    hideSuggestions();
    return;
  }

  pathSuggestionsEl.innerHTML = items
    .map((item) => {
      if (item.type === "open") {
        return `<div class="suggest-item" onclick="openFromSuggestion('${encodeURIComponent(item.path)}')"><span>打开路径：${escapeHtml(item.path)}</span></div>`;
      }
      return `<div class="suggest-item" onclick="openFromSuggestion('${encodeURIComponent(item.path)}')"><span>${escapeHtml(item.path)}</span><button onclick="deleteSuggestionPath(event, '${encodeURIComponent(item.path)}')">删除</button></div>`;
    })
    .join("");
  pathSuggestionsEl.style.display = "block";
}

window.openFromSuggestion = async function openFromSuggestion(encodedPath) {
  const path = decodeURIComponent(encodedPath);
  const tab = getActiveTab();
  hideSuggestions();
  if (!tab) return;
  const ok = await fetchDir(tab.id, path, true, true);
  if (ok) rememberManualPath(path);
};

window.deleteSuggestionPath = function deleteSuggestionPath(event, encodedPath) {
  event.stopPropagation();
  deleteHistoryPath(decodeURIComponent(encodedPath));
};

function renderTabs() {
  tabbarEl.innerHTML = tabs
    .map((tab) => `<div class="tab ${tab.id === activeTabId ? "active" : ""}" onclick="switchTab(${tab.id})" title="${escapeHtml(tab.currentPath)}"><span class="tab-label">${escapeHtml(tab.label)}</span><button class="tab-close" type="button" onclick="closeTab(event, ${tab.id})">×</button></div>`)
    .join("");
}

function clearPreview(tab, message = "请从左侧选择一个文件进行预览。") {
  tab.previewMeta = message;
  tab.previewHTML = "";
  previewMetaEl.textContent = message;
  previewContentEl.innerHTML = "";
}

function sortEntries(entries, tab) {
  const sorted = [...entries];
  sorted.sort((a, b) => {
    if (tab.sortKey === "type") {
      const av = a.type === "dir" ? 0 : 1;
      const bv = b.type === "dir" ? 0 : 1;
      if (av === bv) return a.name.localeCompare(b.name) * tab.sortDir;
      return (av - bv) * tab.sortDir;
    }
    if (tab.sortKey === "name") return a.name.localeCompare(b.name) * tab.sortDir;
    if (tab.sortKey === "size") return (a.size - b.size) * tab.sortDir;
    return a.modified.localeCompare(b.modified) * tab.sortDir;
  });
  return sorted;
}

function filterEntries(entries) {
  const raw = searchInput.value.trim().toLowerCase();
  if (!raw) return entries;
  const terms = raw.split(/\s+/).filter(Boolean);
  return entries.filter((entry) => terms.every((term) => entry.name.toLowerCase().includes(term)));
}

function buildMetaByDensity(entry) {
  if (uiPrefs.densityLevel === 1) return "";
  if (uiPrefs.densityLevel === 2) return `<div class="entry-meta">大小：${escapeHtml(entry.size_human)}</div>`;
  return `<div class="entry-meta">大小：${escapeHtml(entry.size_human)}<br/>修改：${escapeHtml(formatDate(entry.modified))}</div>`;
}

function renderGrid(tab) {
  const sorted = sortEntries(filterEntries(tab.entries), tab);
  fileGridEl.innerHTML = sorted
    .map((entry) => {
      const icon = entry.type === "dir" ? "📁" : "📄";
      const openActionOnCard = entry.type === "dir"
        ? `ondblclick="openDir('${encodeURIComponent(entry.path)}')" title="双击打开文件夹"`
        : `onclick="previewFile('${encodeURIComponent(entry.path)}')" title="单击预览文件"`;
      return `<div class="entry-card" ${openActionOnCard} oncontextmenu="showContextMenu(event, '${encodeURIComponent(entry.path)}', '${entry.type}')"><div class="entry-main"><div class="entry-icon">${icon}</div><div class="entry-text" style="min-width:0;flex:1;"><div class="entry-title">${escapeHtml(entry.name)}</div>${buildMetaByDensity(entry)}</div></div></div>`;
    })
    .join("");
  showStatus(`显示 ${sorted.length} / 共 ${tab.entries.length} 项`);
}

function renderActiveTab() {
  const tab = getActiveTab();
  if (!tab) return;
  pathInput.value = tab.currentPath;
  sortSelect.value = tab.sortKey;
  sortOrderBtn.textContent = tab.sortDir === 1 ? "升序 ↑" : "降序 ↓";
  backBtn.disabled = tab.navIndex <= 0;
  renderGrid(tab);
  previewMetaEl.innerHTML = tab.previewMeta;
  previewContentEl.innerHTML = tab.previewHTML;
  renderTabs();
}

async function fetchDir(tabId, path, resetPreview = true, trackHistory = true) {
  const tab = tabs.find((item) => item.id === tabId);
  if (!tab) return false;
  try {
    showStatus("加载中...");
    const resp = await fetch(`/api/list?path=${encodeURIComponent(path)}`);
    if (!resp.ok) throw new Error(`请求失败：${resp.status}`);
    const data = await resp.json();

    tab.currentPath = data.current;
    tab.currentParent = data.parent;
    tab.entries = data.entries;
    tab.label = shortenPathLabel(data.current);

    if (trackHistory) {
      if (tab.navStack[tab.navIndex] !== data.current) {
        tab.navStack = tab.navStack.slice(0, tab.navIndex + 1);
        tab.navStack.push(data.current);
        tab.navIndex = tab.navStack.length - 1;
      }
    }

    if (resetPreview) clearPreview(tab);
    if (tab.id === activeTabId) renderActiveTab(); else renderTabs();
    return true;
  } catch (err) {
    showStatus(err.message, true);
    return false;
  }
}

async function apiPost(url, payload) {
  const resp = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  if (!resp.ok) throw new Error(`${url} 失败：${resp.status} ${await resp.text()}`);
  return resp.json();
}
async function refreshCurrentTab() { const tab = getActiveTab(); if (tab) await fetchDir(tab.id, tab.currentPath, false, false); }

window.showContextMenu = function showContextMenu(event, encodedPath, entryType = "file") {
  event.preventDefault();
  contextTargetPath = decodeURIComponent(encodedPath);
  const historyBtn = entryType === "dir" ? `<button onclick="addFolderToHistory()">添加到历史记录</button>` : "";
  contextMenuEl.innerHTML = `${historyBtn}<button onclick="renameTarget()">重命名</button><button onclick="moveTarget()">移动到...</button><button onclick="copyTarget()">复制到...</button><button onclick="deleteTarget()">删除</button>`;
  contextMenuEl.style.left = `${event.clientX}px`;
  contextMenuEl.style.top = `${event.clientY}px`;
  contextMenuEl.style.display = "block";
};
window.addFolderToHistory = function addFolderToHistory() {
  if (!contextTargetPath) return;
  rememberManualPath(contextTargetPath);
  hideContextMenu();
  showStatus("已添加到历史记录");
};
window.renameTarget = async function renameTarget() { if (!contextTargetPath) return; const newName = prompt("输入新名称："); hideContextMenu(); if (!newName) return; try { await apiPost("/api/ops/rename", { path: contextTargetPath, new_name: newName }); await refreshCurrentTab(); } catch (err) { showStatus(err.message, true); } };
window.moveTarget = async function moveTarget() { if (!contextTargetPath) return; const destinationDir = prompt("输入目标目录绝对路径："); hideContextMenu(); if (!destinationDir) return; try { await apiPost("/api/ops/move", { path: contextTargetPath, destination_dir: destinationDir }); await refreshCurrentTab(); } catch (err) { showStatus(err.message, true); } };
window.copyTarget = async function copyTarget() { if (!contextTargetPath) return; const destinationDir = prompt("输入复制目标目录绝对路径："); hideContextMenu(); if (!destinationDir) return; try { await apiPost("/api/ops/copy", { path: contextTargetPath, destination_dir: destinationDir }); await refreshCurrentTab(); } catch (err) { showStatus(err.message, true); } };
window.deleteTarget = async function deleteTarget() { if (!contextTargetPath) return; const ok = confirm(`确定删除吗？\n${contextTargetPath}`); hideContextMenu(); if (!ok) return; try { await apiPost("/api/ops/delete", { path: contextTargetPath }); await refreshCurrentTab(); } catch (err) { showStatus(err.message, true); } };

async function previewText(path) { const resp = await fetch(`/api/text?path=${encodeURIComponent(path)}`); if (!resp.ok) throw new Error(`文本预览失败：${resp.status}`); return `<pre>${escapeHtml((await resp.json()).content)}</pre>`; }
function buildImageHTML(path) { return `<img src="/api/raw?path=${encodeURIComponent(path)}" alt="image preview" />`; }
function buildVideoHTML(path) { return `<video controls src="/api/raw?path=${encodeURIComponent(path)}"></video>`; }
function buildAudioHTML(path) { return `<audio controls src="/api/raw?path=${encodeURIComponent(path)}"></audio>`; }
function buildFallbackHTML(path, mimeType) { return `<p>当前文件类型暂不支持内嵌预览。</p><p>MIME: <code>${escapeHtml(mimeType || "unknown")}</code></p><p><a href="/api/raw?path=${encodeURIComponent(path)}" target="_blank" rel="noreferrer">新窗口打开</a></p>`; }

function createTab(initialPath = rootPath) {
  const tab = { id: nextTabId++, label: shortenPathLabel(initialPath), currentPath: initialPath, currentParent: null, entries: [], sortKey: "type", sortDir: 1, previewMeta: "请从左侧选择一个文件进行预览。", previewHTML: "", navStack: [initialPath], navIndex: 0 };
  tabs.push(tab);
  activeTabId = tab.id;
  renderTabs();
  fetchDir(tab.id, initialPath, true, false);
}
window.switchTab = function switchTab(tabId) { activeTabId = tabId; renderActiveTab(); };
window.closeTab = function closeTab(event, tabId) { event.stopPropagation(); const idx = tabs.findIndex((tab) => tab.id === tabId); if (idx < 0) return; tabs.splice(idx, 1); if (tabs.length === 0) return createTab(rootPath); if (activeTabId === tabId) activeTabId = tabs[Math.max(0, idx - 1)].id; renderActiveTab(); };
window.openDir = function openDir(encodedPath) { const tab = getActiveTab(); if (tab) fetchDir(tab.id, decodeURIComponent(encodedPath), true, true); };
window.previewFile = async function previewFile(encodedPath) {
  const tab = getActiveTab();
  if (!tab) return;
  const path = decodeURIComponent(encodedPath);
  try {
    tab.previewMeta = "正在加载预览...";
    tab.previewHTML = "";
    renderActiveTab();
    const metaResp = await fetch(`/api/preview-meta?path=${encodeURIComponent(path)}`);
    if (!metaResp.ok) throw new Error(`获取预览信息失败：${metaResp.status}`);
    const meta = await metaResp.json();
    tab.previewMeta = `<strong>${escapeHtml(meta.name)}</strong><br />大小：${escapeHtml(meta.size_human)} ｜ 修改：${escapeHtml(formatDate(meta.modified))} ｜ 类型：${escapeHtml(meta.mime_type)}`;
    if (meta.kind === "text") tab.previewHTML = meta.text_too_large ? `<p>文本文件过大（>${escapeHtml(String(512))}KB），请下载后查看。</p>` : await previewText(path);
    else if (meta.kind === "image") tab.previewHTML = buildImageHTML(path);
    else if (meta.kind === "video") tab.previewHTML = buildVideoHTML(path);
    else if (meta.kind === "audio") tab.previewHTML = buildAudioHTML(path);
    else tab.previewHTML = buildFallbackHTML(path, meta.mime_type);
    if (tab.id === activeTabId) renderActiveTab();
  } catch (err) {
    tab.previewMeta = "预览失败";
    tab.previewHTML = `<p class="error">${escapeHtml(err.message)}</p>`;
    if (tab.id === activeTabId) renderActiveTab();
  }
};

newTabBtn.addEventListener("click", () => createTab(getActiveTab()?.currentPath || rootPath));
backBtn.addEventListener("click", async () => {
  const tab = getActiveTab();
  if (!tab || tab.navIndex <= 0) return;
  tab.navIndex -= 1;
  await fetchDir(tab.id, tab.navStack[tab.navIndex], true, false);
});
upBtn.addEventListener("click", () => { const tab = getActiveTab(); if (tab?.currentParent) fetchDir(tab.id, tab.currentParent, true, true); });

pathInput.addEventListener("focus", renderPathSuggestions);
pathInput.addEventListener("input", renderPathSuggestions);
pathSuggestionsEl.addEventListener("mousedown", (event) => {
  // Prevent input blur before suggestion click is handled.
  event.preventDefault();
});
pathInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    const q = pathInput.value.trim();
    if (!q) return;
    openFromSuggestion(encodeURIComponent(q));
  }
});
pathInput.addEventListener("blur", () => setTimeout(hideSuggestions, 120));

sortSelect.addEventListener("change", () => { const tab = getActiveTab(); if (!tab) return; tab.sortKey = sortSelect.value; renderGrid(tab); });
sortOrderBtn.addEventListener("click", () => { const tab = getActiveTab(); if (!tab) return; tab.sortDir *= -1; sortOrderBtn.textContent = tab.sortDir === 1 ? "升序 ↑" : "降序 ↓"; renderGrid(tab); });
searchInput.addEventListener("input", () => { const tab = getActiveTab(); if (tab) renderGrid(tab); });

iconSizeInput.addEventListener("input", () => { uiPrefs.iconSize = Number(iconSizeInput.value); applyUiPrefs(); savePrefs(); });
columnCountInput.addEventListener("input", () => { uiPrefs.columns = Number(columnCountInput.value); applyUiPrefs(); savePrefs(); });
densitySlider.addEventListener("input", () => { uiPrefs.densityLevel = Number(densitySlider.value); applyUiPrefs(); savePrefs(); const tab = getActiveTab(); if (tab) renderGrid(tab); });

let resizing = false;
resizerEl.addEventListener("mousedown", () => { resizing = true; document.body.style.userSelect = "none"; });
window.addEventListener("mousemove", (event) => {
  if (!resizing) return;
  const rect = splitLayoutEl.getBoundingClientRect();
  const raw = ((event.clientX - rect.left) / rect.width) * 100;
  document.documentElement.style.setProperty("--left-panel-width", `${Math.max(25, Math.min(75, raw))}%`);
});
window.addEventListener("mouseup", () => { resizing = false; document.body.style.userSelect = ""; });

window.addEventListener("click", (event) => {
  if (!pathSuggestionsEl.contains(event.target) && event.target !== pathInput) hideSuggestions();
  hideContextMenu();
});
window.addEventListener("scroll", hideContextMenu, true);

loadPrefs();
loadManualHistory();
applyUiPrefs();
createTab(rootPath);
