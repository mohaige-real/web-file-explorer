from __future__ import annotations

import os
from datetime import datetime
from pathlib import Path
from typing import Any

from flask import Flask, abort, jsonify, render_template, request, send_file

app = Flask(__name__)

# Restrict browsing to this root directory. You can change it with FILE_BROWSER_ROOT.
BROWSE_ROOT = Path(os.environ.get("FILE_BROWSER_ROOT", "/")).resolve()


def _safe_path(raw_path: str) -> Path:
    """Resolve a user-provided path and ensure it is under BROWSE_ROOT."""
    candidate = (BROWSE_ROOT / raw_path).resolve() if not raw_path.startswith("/") else Path(raw_path).resolve()
    try:
        candidate.relative_to(BROWSE_ROOT)
    except ValueError as exc:
        raise PermissionError("Path is outside allowed root") from exc
    return candidate


def _human_size(num: int) -> str:
    if num < 1024:
        return f"{num} B"
    for unit in ["KB", "MB", "GB", "TB", "PB"]:
        num /= 1024
        if num < 1024:
            return f"{num:.1f} {unit}"
    return f"{num:.1f} EB"


def _entry_to_dict(path: Path) -> dict[str, Any]:
    stat = path.stat()
    is_dir = path.is_dir()
    return {
        "name": path.name,
        "path": str(path),
        "type": "dir" if is_dir else "file",
        "size": 0 if is_dir else stat.st_size,
        "size_human": "-" if is_dir else _human_size(stat.st_size),
        "modified": datetime.fromtimestamp(stat.st_mtime).isoformat(timespec="seconds"),
    }


@app.route("/")
def index() -> str:
    return render_template("index.html", browse_root=str(BROWSE_ROOT))


@app.route("/api/list")
def list_directory():
    raw_path = request.args.get("path", str(BROWSE_ROOT))
    try:
        target = _safe_path(raw_path)
    except PermissionError:
        abort(403, description="Access denied")

    if not target.exists() or not target.is_dir():
        abort(404, description="Directory not found")

    entries = []
    for child in sorted(target.iterdir(), key=lambda p: (not p.is_dir(), p.name.lower())):
        try:
            entries.append(_entry_to_dict(child))
        except OSError:
            # Skip unreadable/broken entries.
            continue

    parent = None
    if target != BROWSE_ROOT:
        parent = str(target.parent)

    return jsonify(
        {
            "current": str(target),
            "parent": parent,
            "entries": entries,
        }
    )


@app.route("/api/download")
def download_file():
    raw_path = request.args.get("path", "")
    if not raw_path:
        abort(400, description="Missing path")

    try:
        target = _safe_path(raw_path)
    except PermissionError:
        abort(403, description="Access denied")

    if not target.exists() or not target.is_file():
        abort(404, description="File not found")

    return send_file(target, as_attachment=True, download_name=target.name)


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8000, debug=True)
