const tbody = document.getElementById("file-table-body");
const statusEl = document.getElementById("status");
const pathInput = document.getElementById("path-input");
const upBtn = document.getElementById("up-btn");
const goBtn = document.getElementById("go-btn");

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
      const openAction =
        entry.type === "dir"
          ? `onclick="openDir('${encodeURIComponent(entry.path)}')"`
          : "";
      const fileAction =
        entry.type === "file"
          ? `<a href="/api/download?path=${encodeURIComponent(entry.path)}">下载</a>`
          : "-";

      return `
      <tr>
        <td>${entry.type === "dir" ? "📁 文件夹" : "📄 文件"}</td>
        <td class="name-cell" ${openAction}>${escapeHtml(entry.name)}</td>
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
  } catch (err) {
    showStatus(err.message, true);
  }
}

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
