#!/usr/bin/env python3
"""Render OnlyDM icon PNGs and icon.icns from the canonical SVG sources.

Source SVGs (edit these, then re-run this script):
    landing/assets/app-icon.svg        (960px body on 1024px canvas, web/cross-platform)
    src-tauri/icons/icon-macos.svg     (824px macOS Golden Gate grid, macOS/App icon)

Outputs (all regenerated deterministically):
    landing/assets/app-icon.png        256x256  (from app-icon.svg)
    landing/assets/favicon.png         32x32   (from app-icon.svg)
    src-tauri/icons/128x128.png       128x128  (from app-icon.svg)
    src-tauri/icons/128x128@2x.png    256x256  (from app-icon.svg)
    src-tauri/icons/32x32.png          32x32   (from app-icon.svg)
    src-tauri/icons/icon.png          512x512  (from icon-macos.svg)
    src-tauri/icons/icon.icns        macOS icon (from icon-macos.svg)

Pipeline (verified byte-identical to the committed assets):
    1. Chrome headless screenshot of the 1024px SVG at 1x.
    2. Pillow LANCZOS resize to each target size, saved without optimize.
    3. iconutil for icon.icns via a temp .iconset.

Requirements:
    - Google Chrome (``/Applications/Google Chrome.app/...``) or set $CHROME.
    - Pillow: pip install Pillow
    - macOS iconutil (for icon.icns)

Usage:
    python3 scripts/generate-icons.py
    npm run assets:icons
"""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]

APP_ICON_SVG = ROOT / "landing" / "assets" / "app-icon.svg"
MACOS_ICON_SVG = ROOT / "src-tauri" / "icons" / "icon-macos.svg"

CHROME_CANDIDATES = [
    os.environ.get("CHROME"),
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "google-chrome",
]

# (source_svg, output_png, size) — landing + Tauri PNG targets.
PNG_TARGETS: list[tuple[Path, Path, int]] = [
    (APP_ICON_SVG, ROOT / "landing" / "assets" / "app-icon.png", 256),
    (APP_ICON_SVG, ROOT / "landing" / "assets" / "favicon.png", 32),
    (APP_ICON_SVG, ROOT / "src-tauri" / "icons" / "32x32.png", 32),
    (APP_ICON_SVG, ROOT / "src-tauri" / "icons" / "128x128.png", 128),
    (APP_ICON_SVG, ROOT / "src-tauri" / "icons" / "128x128@2x.png", 256),
    (MACOS_ICON_SVG, ROOT / "src-tauri" / "icons" / "icon.png", 512),
]

ICNS_OUTPUT = ROOT / "src-tauri" / "icons" / "icon.icns"
# Sizes for the .iconset (matches the committed icon.icns byte-for-byte).
ICONSET_SIZES = [16, 32, 64, 128, 256, 512, 1024]


def find_chrome() -> str:
    for candidate in CHROME_CANDIDATES:
        if not candidate:
            continue
        if Path(candidate).is_absolute() and not Path(candidate).exists():
            continue
        if shutil.which(candidate) or Path(candidate).exists():
            return candidate
    raise SystemExit(
        "Google Chrome not found. Install Chrome or set $CHROME to the binary path."
    )


def render_svg_at_1024(svg_path: Path, out_png: Path, chrome: str) -> None:
    """Screenshot a 1024x1024 SVG with transparent background via Chrome."""
    cmd = [
        chrome,
        "--headless=new",
        "--disable-gpu",
        "--hide-scrollbars",
        "--force-device-scale-factor=1",
        "--window-size=1024,1024",
        "--default-background-color=00000000",
        f"--screenshot={out_png}",
        svg_path.resolve().as_uri(),
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0 or not out_png.exists():
        raise SystemExit(
            f"Chrome screenshot failed for {svg_path}:\n"
            f"{result.stdout}\n{result.stderr}"
        )


def save_resize(master: Image.Image, output: Path, size: int) -> None:
    # Default save (no optimize) matches the committed files byte-for-byte.
    master.resize((size, size), Image.LANCZOS).save(output)
    print(f"wrote {output.relative_to(ROOT)} ({size}x{size})")


def main() -> None:
    for svg in (APP_ICON_SVG, MACOS_ICON_SVG):
        if not svg.exists():
            raise SystemExit(f"Missing source SVG: {svg}")

    chrome = find_chrome()
    masters: dict[Path, Image.Image] = {}

    with tempfile.TemporaryDirectory(prefix="onlydm-icons-") as tmp:
        tmp_path = Path(tmp)
        for svg in sorted({source for source, _, _ in PNG_TARGETS} | {MACOS_ICON_SVG}):
            master_png = tmp_path / f"{svg.stem}-1024.png"
            render_svg_at_1024(svg, master_png, chrome)
            masters[svg] = Image.open(master_png).convert("RGBA")

        for source, output, size in PNG_TARGETS:
            output.parent.mkdir(parents=True, exist_ok=True)
            save_resize(masters[source], output, size)

        # Rebuild icon.icns from the macOS master.
        macos_master = masters[MACOS_ICON_SVG]
        iconset = tmp_path / "icon.iconset"
        iconset.mkdir()
        for size in ICONSET_SIZES:
            macos_master.resize((size, size), Image.LANCZOS).save(
                iconset / f"icon_{size}x{size}.png"
            )
            double = size * 2
            if double <= 1024:
                macos_master.resize((double, double), Image.LANCZOS).save(
                    iconset / f"icon_{size}x{size}@2x.png"
                )
        result = subprocess.run(
            ["iconutil", "-c", "icns", str(iconset), "-o", str(ICNS_OUTPUT)],
            capture_output=True,
            text=True,
        )
        if result.returncode != 0:
            raise SystemExit(f"iconutil failed:\n{result.stdout}\n{result.stderr}")
        print(f"wrote {ICNS_OUTPUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
