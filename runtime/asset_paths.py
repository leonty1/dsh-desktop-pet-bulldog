"""Where the Helper reads its sprite frames and sounds from.

The Qt Helper runs two ways: as `python runtime/helper.py` from an installed package, and as a
PyInstaller `--onefile` executable under `runtime/bin/<platform>/`. Neither carries the frames
inside itself — `assets/` is build output that `prepare` bakes next to the package — so both
need the package root, and the macOS Swift port resolves the same three roots.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

ASSET_ROOT_ENV = "DSH_FRENCHIE_ASSET_ROOT"
MANIFEST = ("assets", "pet-manifest.json")


def _roots() -> list[Path]:
    roots: list[Path] = []
    override = os.environ.get(ASSET_ROOT_ENV)
    if override:
        roots.append(Path(override))
    roots.append(Path(__file__).resolve().parent.parent)
    if getattr(sys, "frozen", False):
        # The onefile executable is runtime/bin/<platform>/dsh-frenchie-helper[.exe], four
        # levels under the package that holds assets/.
        roots.append(Path(sys.executable).resolve().parents[3])
    return roots


def bundle_root() -> Path:
    """The directory whose `assets/` holds `pet-manifest.json`.

    Raises FileNotFoundError naming every root it checked, so a Helper that cannot see its
    frames says where it looked instead of failing on the first paint.
    """
    checked: list[str] = []
    for root in _roots():
        checked.append(str(root))
        if root.joinpath(*MANIFEST).is_file():
            return root
    raise FileNotFoundError(f"no {'/'.join(MANIFEST)} under: {', '.join(checked)}")
