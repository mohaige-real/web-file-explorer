const tbody = document.getElementById("file-table-body");
const statusEl = document.getElementById("status");
const pathInput = document.getElementById("path-input");
const upBtn = document.getElementById("up-btn");
const goBtn = document.getElementById("go-btn");
const previewMetaEl = document.getElementById("preview-meta");
const previewContentEl = document.getElementById("preview-content");
const tabbarEl = document.getElementById("tabbar");
const newTabBtn = document.getElementById("new-tab-btn");

const rootPath = document.getElementById("root-path").textContent;

let tabs = [];
let activeTabId = null;
let nextTabId = 1;

function showStatus(msg, isError = false) {
  statusEl.textContent = msg;
  statusEl.className = isError ? "error" : "";
}

function formatDate(isoDate) {
  return new Date(isoDate).toLocaleString();
}

function escapeHtml(raw) {
  const div = document.createElement("div");
  div.textContent = raw;
  return div.innerHTML;
}

function getActiveTab() {
  return tabs.find((tab) => tab.id === activeTabId) || null;
}

function shortenPathLabel(path) {
  if (path.length <= 26) {
    return path || "(空路径)";
  }
  return `${path.slice(0, 8)}...${path.slice(-15)}`;
}

function renderTabs() {
  tabbarEl.innerHTML = tabs
    .map(
      (tab) => `
      <div class="tab ${tab.id === activeTabId ? "active" : ""}" onclick="switchTab(${tab.id})" title="${escapeHtml(tab.currentPath)}">
        <span class="tab-label">${escapeHtml(tab.label)}</span>
        <button class="tab-close" type="button" onclick="closeTab(event, ${tab.id})">×</button>
      </div>`
    )
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
    let av = a[tab.sortKey];
    let bv = b[tab.sortKey];

    if (tab.sortKey === "type") {
      av = a.type === "dir" ? 0 : 1;
      bv = b.type === "dir" ? 0 : 1;
      if (av === bv) {
        return a.name.localeCompare(b.name) * tab.sortDir;
      }
      return (av - bv) * tab.sortDir;
    }

    if (tab.sortKey === "name") {
      return a.name.localeCompare(b.name) * tab.sortDir;
    }

    if (tab.sortKey === "size") {
      return (a.size - b.size) * tab.sortDir;
    }

    return a.modified.localeCompare(b.modified) * tab.sortDir;
  });
  return sorted;
}

function renderTable(tab) {
  const sorted = sortEntries(tab.entries, tab);
  tbody.innerHTML = sorted
    .map((entry) => {
      const openAction =
        entry.type === "dir"
          ? `<span class="dir-link" onclick="openDir('${encodeURIComponent(entry.path)}')">${escapeHtml(entry.name)}</span>`
          : `<span class="file-link" onclick="previewFile('${encodeURIComponent(entry.path)}')">${escapeHtml(entry.name)}</span>`;

      const fileAction =
        entry.type === "file"
          ? `<a href="/api/download?path=${encodeURIComponent(entry.path)}">下载</a>`
          : "-";

      return `
      <tr>
        <td>${entry.type === "dir" ? "📁 文件夹" : "📄 文件"}</td>
        <td class="name-cell">${openAction}</td>
        <td>${entry.size_human}</td>
        <td>${formatDate(entry.modified)}</td>
        <td>${fileAction}</td>
      </tr>`;
    })
    .join("");
}

function renderActiveTab() {
  const tab = getActiveTab();
  if (!tab) {
    tbody.innerHTML = "";
    pathInput.value = "";
    showStatus("没有可用标签页", true);
    previewMetaEl.textContent = "";
    previewContentEl.innerHTML = "";
    return;
  }

  pathInput.value = tab.currentPath;
  renderTable(tab);
  showStatus(`共 ${tab.entries.length} 项`);
  previewMetaEl.innerHTML = tab.previewMeta;
  previewContentEl.innerHTML = tab.previewHTML;
  renderTabs();
}

async function fetchDir(tabId, path, resetPreview = true) {
  const tab = tabs.find((item) => item.id === tabId);
  if (!tab) return;

  try {
    showStatus("加载中...");
    const resp = await fetch(`/api/list?path=${encodeURIComponent(path)}`);
    if (!resp.ok) {
      throw new Error(`请求失败：${resp.status}`);
    }

    const data = await resp.json();
    tab.currentPath = data.current;
    tab.currentParent = data.parent;
    tab.entries = data.entries;
    tab.label = shortenPathLabel(data.current);

    if (resetPreview) {
      clearPreview(tab);
    }

    if (tab.id === activeTabId) {
      renderActiveTab();
    } else {
      renderTabs();
    }
  } catch (err) {
    showStatus(err.message, true);
  }
}

async function previewText(path) {
  const resp = await fetch(`/api/text?path=${encodeURIComponent(path)}`);
  if (!resp.ok) {
    throw new Error(`文本预览失败：${resp.status}`);
  }
  const data = await resp.json();
  return `<pre>${escapeHtml(data.content)}</pre>`;
}

function buildImageHTML(path) {
  return `<img src="/api/raw?path=${encodeURIComponent(path)}" alt="image preview" />`;
}

function buildVideoHTML(path) {
  return `<video controls src="/api/raw?path=${encodeURIComponent(path)}"></video>`;
}

function buildAudioHTML(path) {
  return `<audio controls src="/api/raw?path=${encodeURIComponent(path)}"></audio>`;
}

function buildFallbackHTML(path, mimeType) {
  return `
    <p>当前文件类型暂不支持内嵌预览。</p>
    <p>MIME: <code>${escapeHtml(mimeType || "unknown")}</code></p>
    <p><a href="/api/raw?path=${encodeURIComponent(path)}" target="_blank" rel="noreferrer">新窗口打开</a></p>
  `;
}

function createTab(initialPath = rootPath) {
  const tab = {
    id: nextTabId++,
    label: shortenPathLabel(initialPath),
    currentPath: initialPath,
    currentParent: null,
    entries: [],
    sortKey: "type",
    sortDir: 1,
    previewMeta: "请从左侧选择一个文件进行预览。",
    previewHTML: "",
  };
  tabs.push(tab);
  activeTabId = tab.id;
  renderTabs();
  fetchDir(tab.id, initialPath);
}

window.switchTab = function switchTab(tabId) {
  activeTabId = tabId;
  renderActiveTab();
};

window.closeTab = function closeTab(event, tabId) {
  event.stopPropagation();
  const idx = tabs.findIndex((tab) => tab.id === tabId);
  if (idx < 0) return;

  tabs.splice(idx, 1);

  if (tabs.length === 0) {
    createTab(rootPath);
    return;
  }

  if (activeTabId === tabId) {
    activeTabId = tabs[Math.max(0, idx - 1)].id;
  }

  renderActiveTab();
};

window.openDir = function openDir(encodedPath) {
  const tab = getActiveTab();
  if (!tab) return;
  const path = decodeURIComponent(encodedPath);
  fetchDir(tab.id, path);
};

window.previewFile = async function previewFile(encodedPath) {
  const tab = getActiveTab();
  if (!tab) return;

  const path = decodeURIComponent(encodedPath);
  try {
    tab.previewMeta = "正在加载预览...";
    tab.previewHTML = "";
    renderActiveTab();

    const metaResp = await fetch(`/api/preview-meta?path=${encodeURIComponent(path)}`);
    if (!metaResp.ok) {
      throw new Error(`获取预览信息失败：${metaResp.status}`);
    }

    const meta = await metaResp.json();
    tab.previewMeta = `
      <strong>${escapeHtml(meta.name)}</strong><br />
      大小：${escapeHtml(meta.size_human)} ｜ 修改：${escapeHtml(formatDate(meta.modified))} ｜ 类型：${escapeHtml(meta.mime_type)}
    `;

    if (meta.kind === "text") {
      if (meta.text_too_large) {
        tab.previewHTML = `<p>文本文件过大（>${escapeHtml(String(512))}KB），请下载后查看。</p>`;
      } else {
        tab.previewHTML = await previewText(path);
      }
    } else if (meta.kind === "image") {
      tab.previewHTML = buildImageHTML(path);
    } else if (meta.kind === "video") {
      tab.previewHTML = buildVideoHTML(path);
    } else if (meta.kind === "audio") {
      tab.previewHTML = buildAudioHTML(path);
    } else {
      tab.previewHTML = buildFallbackHTML(path, meta.mime_type);
    }

    if (tab.id === activeTabId) {
      renderActiveTab();
    }
  } catch (err) {
    tab.previewMeta = "预览失败";
    tab.previewHTML = `<p class="error">${escapeHtml(err.message)}</p>`;
    if (tab.id === activeTabId) {
      renderActiveTab();
    }
  }
};

newTabBtn.addEventListener("click", () => {
  const current = getActiveTab();
  createTab(current ? current.currentPath : rootPath);
});

upBtn.addEventListener("click", () => {
  const tab = getActiveTab();
  if (tab && tab.currentParent) {
    fetchDir(tab.id, tab.currentParent);
  }
});

goBtn.addEventListener("click", () => {
  const tab = getActiveTab();
  if (tab) {
    fetchDir(tab.id, pathInput.value.trim());
  }
});

pathInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    const tab = getActiveTab();
    if (tab) {
      fetchDir(tab.id, pathInput.value.trim());
    }
  }
});

document.querySelectorAll("th[data-sort]").forEach((th) => {
  th.addEventListener("click", () => {
    const tab = getActiveTab();
    if (!tab) return;

    const key = th.dataset.sort;
    if (tab.sortKey === key) {
      tab.sortDir *= -1;
    } else {
      tab.sortKey = key;
      tab.sortDir = 1;
    }
    renderTable(tab);
  });
});

createTab(rootPath);
