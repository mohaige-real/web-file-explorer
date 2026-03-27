from __future__ import annotations

import mimetypes
import os
import shutil
from datetime import datetime
from pathlib import Path
from typing import Any

from flask import Flask, abort, jsonify, render_template, request, send_file

app = Flask(__name__)

# Restrict browsing to this root directory. You can change it with FILE_BROWSER_ROOT.
BROWSE_ROOT = Path(os.environ.get("FILE_BROWSER_ROOT", "/")).resolve()
MAX_TEXT_PREVIEW_SIZE = 512 * 1024  # 512 KB


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
    mime_type, _ = mimetypes.guess_type(path.name)
    return {
        "name": path.name,
        "path": str(path),
        "type": "dir" if is_dir else "file",
        "size": 0 if is_dir else stat.st_size,
        "size_human": "-" if is_dir else _human_size(stat.st_size),
        "modified": datetime.fromtimestamp(stat.st_mtime).isoformat(timespec="seconds"),
        "mime_type": mime_type or "",
    }


def _get_file_kind(path: Path) -> str:
    mime_type, _ = mimetypes.guess_type(path.name)
    if not mime_type:
        return "binary"

    if mime_type.startswith("text/"):
        return "text"
    if mime_type.startswith("image/"):
        return "image"
    if mime_type.startswith("video/"):
        return "video"
    if mime_type.startswith("audio/"):
        return "audio"
    if mime_type in {"application/pdf", "application/json", "application/xml"}:
        return "text"
    return "binary"


def _json_payload() -> dict[str, Any]:
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        abort(400, description="Invalid JSON payload")
    return payload


def _resolve_from_payload(payload: dict[str, Any], key: str) -> Path:
    raw_path = payload.get(key, "")
    if not isinstance(raw_path, str) or not raw_path:
        abort(400, description=f"Missing {key}")
    try:
        return _safe_path(raw_path)
    except PermissionError:
        abort(403, description="Access denied")


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
    try:
        children = list(target.iterdir())
    except OSError:
        abort(403, description="Directory is not readable")

    for child in children:
        try:
            entries.append(_entry_to_dict(child))
        except OSError:
            # Skip unreadable/broken entries.
            continue

    # Sort after metadata extraction to avoid is_dir()/stat() failures during sorting.
    entries.sort(key=lambda item: (item["type"] != "dir", str(item["name"]).lower()))

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


@app.route("/api/preview-meta")
def preview_meta():
    raw_path = request.args.get("path", "")
    if not raw_path:
        abort(400, description="Missing path")

    try:
        target = _safe_path(raw_path)
    except PermissionError:
        abort(403, description="Access denied")

    if not target.exists() or not target.is_file():
        abort(404, description="File not found")

    kind = _get_file_kind(target)
    mime_type, _ = mimetypes.guess_type(target.name)
    stat = target.stat()
    return jsonify(
        {
            "path": str(target),
            "name": target.name,
            "kind": kind,
            "mime_type": mime_type or "application/octet-stream",
            "size": stat.st_size,
            "size_human": _human_size(stat.st_size),
            "modified": datetime.fromtimestamp(stat.st_mtime).isoformat(timespec="seconds"),
            "text_too_large": kind == "text" and stat.st_size > MAX_TEXT_PREVIEW_SIZE,
        }
    )


@app.route("/api/raw")
def raw_file():
    raw_path = request.args.get("path", "")
    if not raw_path:
        abort(400, description="Missing path")

    try:
        target = _safe_path(raw_path)
    except PermissionError:
        abort(403, description="Access denied")

    if not target.exists() or not target.is_file():
        abort(404, description="File not found")

    mime_type, _ = mimetypes.guess_type(target.name)
    return send_file(target, as_attachment=False, mimetype=mime_type)


@app.route("/api/text")
def text_preview():
    raw_path = request.args.get("path", "")
    if not raw_path:
        abort(400, description="Missing path")

    try:
        target = _safe_path(raw_path)
    except PermissionError:
        abort(403, description="Access denied")

    if not target.exists() or not target.is_file():
        abort(404, description="File not found")

    if target.stat().st_size > MAX_TEXT_PREVIEW_SIZE:
        abort(413, description="File is too large for text preview")

    try:
        content = target.read_text(encoding="utf-8")
        encoding = "utf-8"
    except UnicodeDecodeError:
        content = target.read_text(encoding="gb18030", errors="replace")
        encoding = "gb18030"

    return jsonify(
        {
            "path": str(target),
            "encoding": encoding,
            "content": content,
        }
    )


@app.route("/api/ops/rename", methods=["POST"])
def rename_path():
    payload = _json_payload()
    source = _resolve_from_payload(payload, "path")
    new_name = payload.get("new_name", "")

    if not source.exists():
        abort(404, description="Path not found")
    if not isinstance(new_name, str) or not new_name.strip() or "/" in new_name or "\\" in new_name:
        abort(400, description="Invalid new_name")

    destination = source.parent / new_name.strip()
    try:
        destination.relative_to(BROWSE_ROOT)
    except ValueError:
        abort(403, description="Access denied")

    if destination.exists():
        abort(409, description="Destination already exists")

    source.rename(destination)
    return jsonify({"ok": True, "path": str(destination)})


@app.route("/api/ops/move", methods=["POST"])
def move_path():
    payload = _json_payload()
    source = _resolve_from_payload(payload, "path")
    destination_dir = _resolve_from_payload(payload, "destination_dir")

    if not source.exists():
        abort(404, description="Path not found")
    if not destination_dir.exists() or not destination_dir.is_dir():
        abort(404, description="Destination directory not found")

    destination = destination_dir / source.name
    if destination.exists():
        abort(409, description="Destination already exists")

    shutil.move(str(source), str(destination))
    return jsonify({"ok": True, "path": str(destination)})


@app.route("/api/ops/copy", methods=["POST"])
def copy_path():
    payload = _json_payload()
    source = _resolve_from_payload(payload, "path")
    destination_dir = _resolve_from_payload(payload, "destination_dir")

    if not source.exists():
        abort(404, description="Path not found")
    if not destination_dir.exists() or not destination_dir.is_dir():
        abort(404, description="Destination directory not found")

    destination = destination_dir / source.name
    if destination.exists():
        abort(409, description="Destination already exists")

    if source.is_dir():
        shutil.copytree(source, destination)
    else:
        shutil.copy2(source, destination)

    return jsonify({"ok": True, "path": str(destination)})


@app.route("/api/ops/delete", methods=["POST"])
def delete_path():
    payload = _json_payload()
    source = _resolve_from_payload(payload, "path")

    if not source.exists():
        abort(404, description="Path not found")

    if source.is_dir():
        shutil.rmtree(source)
    else:
        source.unlink()

    return jsonify({"ok": True})


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
