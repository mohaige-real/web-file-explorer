const tbody = document.getElementById("file-table-body");
const statusEl = document.getElementById("status");
const pathInput = document.getElementById("path-input");
const upBtn = document.getElementById("up-btn");
const goBtn = document.getElementById("go-btn");
const previewMetaEl = document.getElementById("preview-meta");
const previewContentEl = document.getElementById("preview-content");

let currentPath = document.getElementById("root-path").textContent;
let currentParent = null;
let currentEntries = [];
let sortKey = "type";
let sortDir = 1;

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

function clearPreview(message = "请从左侧选择一个文件进行预览。") {
  previewMetaEl.textContent = message;
  previewContentEl.innerHTML = "";
}

function sortEntries(entries) {
  const sorted = [...entries];
  sorted.sort((a, b) => {
    let av = a[sortKey];
    let bv = b[sortKey];

    if (sortKey === "type") {
      av = a.type === "dir" ? 0 : 1;
      bv = b.type === "dir" ? 0 : 1;
      if (av === bv) {
        return a.name.localeCompare(b.name) * sortDir;
      }
      return (av - bv) * sortDir;
    }

    if (sortKey === "name") {
      return a.name.localeCompare(b.name) * sortDir;
    }

    if (sortKey === "size") {
      return (a.size - b.size) * sortDir;
    }

    return a.modified.localeCompare(b.modified) * sortDir;
  });
  return sorted;
}

function renderTable(entries) {
  const sorted = sortEntries(entries);
  tbody.innerHTML = sorted
    .map((entry) => {
      const openDirAction =
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
        <td class="name-cell">${openDirAction}</td>
        <td>${entry.size_human}</td>
        <td>${formatDate(entry.modified)}</td>
        <td>${fileAction}</td>
      </tr>`;
    })
    .join("");
}

async function fetchDir(path) {
  try {
    showStatus("加载中...");
    const resp = await fetch(`/api/list?path=${encodeURIComponent(path)}`);
    if (!resp.ok) {
      throw new Error(`请求失败：${resp.status}`);
    }

    const data = await resp.json();
    currentPath = data.current;
    currentParent = data.parent;
    currentEntries = data.entries;
    pathInput.value = currentPath;
    renderTable(currentEntries);
    showStatus(`共 ${currentEntries.length} 项`);
    clearPreview();
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
  previewContentEl.innerHTML = `<pre>${escapeHtml(data.content)}</pre>`;
}

function previewImage(path) {
  previewContentEl.innerHTML = `<img src="/api/raw?path=${encodeURIComponent(path)}" alt="image preview" />`;
}

function previewVideo(path) {
  previewContentEl.innerHTML = `<video controls src="/api/raw?path=${encodeURIComponent(path)}"></video>`;
}

function previewAudio(path) {
  previewContentEl.innerHTML = `<audio controls src="/api/raw?path=${encodeURIComponent(path)}"></audio>`;
}

function previewFallback(path, mimeType) {
  previewContentEl.innerHTML = `
    <p>当前文件类型暂不支持内嵌预览。</p>
    <p>MIME: <code>${escapeHtml(mimeType || "unknown")}</code></p>
    <p><a href="/api/raw?path=${encodeURIComponent(path)}" target="_blank" rel="noreferrer">新窗口打开</a></p>
  `;
}

window.previewFile = async function previewFile(encodedPath) {
  const path = decodeURIComponent(encodedPath);
  try {
    previewMetaEl.textContent = "正在加载预览...";
    previewContentEl.innerHTML = "";

    const metaResp = await fetch(`/api/preview-meta?path=${encodeURIComponent(path)}`);
    if (!metaResp.ok) {
      throw new Error(`获取预览信息失败：${metaResp.status}`);
    }

    const meta = await metaResp.json();
    previewMetaEl.innerHTML = `
      <strong>${escapeHtml(meta.name)}</strong><br />
      大小：${escapeHtml(meta.size_human)} ｜ 修改：${escapeHtml(formatDate(meta.modified))} ｜ 类型：${escapeHtml(meta.mime_type)}
    `;

    if (meta.kind === "text") {
      if (meta.text_too_large) {
        previewContentEl.innerHTML = `<p>文本文件过大（>${escapeHtml(String(512))}KB），请下载后查看。</p>`;
      } else {
        await previewText(path);
      }
      return;
    }

    if (meta.kind === "image") {
      previewImage(path);
      return;
    }

    if (meta.kind === "video") {
      previewVideo(path);
      return;
    }

    if (meta.kind === "audio") {
      previewAudio(path);
      return;
    }

    previewFallback(path, meta.mime_type);
  } catch (err) {
    previewMetaEl.textContent = "预览失败";
    previewContentEl.innerHTML = `<p class="error">${escapeHtml(err.message)}</p>`;
  }
};

window.openDir = function openDir(encodedPath) {
  const path = decodeURIComponent(encodedPath);
  fetchDir(path);
};

upBtn.addEventListener("click", () => {
  if (currentParent) {
    fetchDir(currentParent);
  }
});

goBtn.addEventListener("click", () => {
  fetchDir(pathInput.value.trim());
});

pathInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    fetchDir(pathInput.value.trim());
  }
});

document.querySelectorAll("th[data-sort]").forEach((th) => {
  th.addEventListener("click", () => {
    const key = th.dataset.sort;
    if (sortKey === key) {
      sortDir *= -1;
    } else {
      sortKey = key;
      sortDir = 1;
    }
    renderTable(currentEntries);
  });
});

fetchDir(currentPath);
