"""Small, DSH-owned persistence layer for companion window layout."""

from __future__ import annotations

import json
import os
import tempfile
from pathlib import Path
from typing import Any


DEFAULT_LAYOUT: dict[str, Any] = {
    "version": 1,
    "x": None,
    "y": None,
    "petX": None,
    "petY": None,
    "scale": 1.0,
    "bubbleScale": 1.0,
    "reducedMotion": False,
    # Minutes of quiet before each rung of the drowsiness ladder, counted from the last
    # activity. Lying comes first, so a pet with nothing to do settles down before it sleeps.
    "lieAfterMinutes": 1.0,
    "sleepAfterMinutes": 6.0,
    "bubbleMode": "always",
    "bubbleStates": ["SUCCESS", "ERROR", "WAITING"],
}


def default_layout_path() -> Path:
    override = os.environ.get("DSH_FRENCHIE_LAYOUT_PATH")
    if override:
        return Path(override)
    dsh_home = os.environ.get("DSH_HOME")
    if dsh_home:
        return Path(dsh_home) / "dsh-frenchie" / "layout.json"
    local_app_data = os.environ.get("LOCALAPPDATA")
    if local_app_data:
        return Path(local_app_data) / "DSH" / "dsh-frenchie" / "layout.json"
    xdg_config = os.environ.get("XDG_CONFIG_HOME")
    if xdg_config:
        return Path(xdg_config) / "dsh" / "dsh-frenchie" / "layout.json"
    return Path.home() / ".dsh" / "dsh-frenchie" / "layout.json"


def normalise_layout(value: Any) -> dict[str, Any]:
    layout = dict(DEFAULT_LAYOUT)
    if not isinstance(value, dict):
        return layout
    for key in ("x", "y", "petX", "petY"):
        coordinate = value.get(key)
        if isinstance(coordinate, int) and not isinstance(coordinate, bool):
            layout[key] = coordinate
    scale = value.get("scale")
    if isinstance(scale, (int, float)) and not isinstance(scale, bool):
        layout["scale"] = min(1.4, max(0.55, float(scale)))
    bubble_scale = value.get("bubbleScale")
    if isinstance(bubble_scale, (int, float)) and not isinstance(bubble_scale, bool):
        layout["bubbleScale"] = min(1.2, max(0.8, float(bubble_scale)))
    if isinstance(value.get("reducedMotion"), bool):
        layout["reducedMotion"] = value["reducedMotion"]
    # Minutes of quiet before each rung of the ladder; zero never reaches that rung.
    for key in ("lieAfterMinutes", "sleepAfterMinutes"):
        minutes = value.get(key)
        if isinstance(minutes, (int, float)) and not isinstance(minutes, bool):
            layout[key] = min(180.0, max(0.0, float(minutes)))
    if value.get("bubbleMode") in {"always", "hidden", "custom"}:
        layout["bubbleMode"] = value["bubbleMode"]
    if isinstance(value.get("bubbleStates"), list):
        layout["bubbleStates"] = [str(state) for state in value["bubbleStates"] if isinstance(state, str)]
    return layout


def load_layout(path: Path) -> dict[str, Any]:
    try:
        return normalise_layout(json.loads(path.read_text(encoding="utf-8")))
    except (OSError, ValueError):
        return dict(DEFAULT_LAYOUT)


def save_layout(path: Path, value: dict[str, Any]) -> None:
    layout = normalise_layout(value)
    path.parent.mkdir(parents=True, exist_ok=True)
    handle, temporary_name = tempfile.mkstemp(prefix=f".{path.name}.", suffix=".tmp", dir=path.parent)
    try:
        with os.fdopen(handle, "w", encoding="utf-8", newline="\n") as stream:
            json.dump(layout, stream, ensure_ascii=False, indent=2)
            stream.write("\n")
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary_name, path)
    finally:
        try:
            Path(temporary_name).unlink()
        except FileNotFoundError:
            pass
