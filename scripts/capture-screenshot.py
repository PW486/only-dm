#!/usr/bin/env python3
"""Interactively capture a sanitized OnlyDM demo window.

Prerequisites:
  1. Run OnlyDM in development mode (`npm run dev`).
  2. Open the DM conversation you want to use.
  3. Choose "Developer > Prepare Demo Screenshot" and wait for the two green
     lines at the top and bottom of the web content.
  4. Run this script and click the OnlyDM window when prompted.

The whole macOS window is captured, including the title bar and traffic
lights. The green validation rows are replaced with neighbouring content by
the preparation script, so the final image has no green lines and no cropping.
The raw capture is deleted after processing unless --keep-raw is passed.
"""

from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
PREPARE_SCRIPT = REPO_ROOT / "scripts" / "prepare-screenshot.py"


def run_prepare(
    raw_path: Path,
    png_path: Path,
    webp_path: Path,
    mode: str,
    max_width: int,
    width: int,
    height: int,
    quality: int,
    allow_unmarked: bool,
) -> int:
    command = [
        sys.executable,
        str(PREPARE_SCRIPT),
        str(raw_path),
        "--mode",
        mode,
        "--max-width",
        str(max_width),
        "--png",
        str(png_path),
        "--webp",
        str(webp_path),
        "--width",
        str(width),
        "--height",
        str(height),
        "--quality",
        str(quality),
    ]
    if allow_unmarked:
        command.append("--allow-unmarked")
    return subprocess.run(command, check=False).returncode


def main() -> int:
    parser = argparse.ArgumentParser(
        description=(
            "Capture a sanitized OnlyDM window with macOS screencapture and "
            "write the landing PNG/WebP assets. Window mode is the default."
        )
    )
    parser.add_argument(
        "--input",
        type=Path,
        help="process an existing capture instead of taking a new one",
    )
    parser.add_argument(
        "--mode",
        choices=("window", "content"),
        default="window",
        help=(
            "window keeps the full macOS window (default); content crops "
            "between the markers and fits a fixed hero size"
        ),
    )
    parser.add_argument(
        "--max-width",
        type=int,
        default=2400,
        help="downscale window captures wider than this (0 disables; default 2400)",
    )
    parser.add_argument(
        "--keep-raw",
        action="store_true",
        help="keep the raw capture next to the output files",
    )
    parser.add_argument(
        "--png",
        type=Path,
        default=REPO_ROOT / "landing" / "assets" / "screenshot.png",
    )
    parser.add_argument(
        "--webp",
        type=Path,
        default=REPO_ROOT / "landing" / "assets" / "screenshot.webp",
    )
    parser.add_argument(
        "--width", type=int, default=2200, help="content mode target width"
    )
    parser.add_argument(
        "--height", type=int, default=1400, help="content mode target height"
    )
    parser.add_argument("--quality", type=int, default=82)
    parser.add_argument(
        "--allow-unmarked",
        action="store_true",
        help="process even without the green sanitization markers (dangerous)",
    )
    args = parser.parse_args()

    if args.input:
        return run_prepare(
            args.input,
            args.png,
            args.webp,
            args.mode,
            args.max_width,
            args.width,
            args.height,
            args.quality,
            args.allow_unmarked,
        )

    if not shutil.which("screencapture"):
        print(
            "ERROR: macOS screencapture is not available.",
            file=sys.stderr,
        )
        return 2

    print(
        "OnlyDM must already show the sanitized demo screen with two green "
        "lines.\n"
        "If it does not, run the app in development mode, open a conversation, "
        "and choose Developer > Prepare Demo Screenshot.\n"
        "The whole macOS window (title bar and traffic lights included) will "
        "be captured. The green lines are removed afterward.\n"
    )
    input("Press Enter, then click the OnlyDM window in the capture overlay... ")

    with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as temporary:
        raw_path = Path(temporary.name)

    try:
        # -W selects a window directly. -o omits the drop shadow; the landing
        # page adds its own shadow around the image.
        result = subprocess.run(
            ["screencapture", "-i", "-o", "-W", str(raw_path)],
            check=False,
        )
        if (
            result.returncode != 0
            or not raw_path.exists()
            or raw_path.stat().st_size == 0
        ):
            print("Capture cancelled; nothing was written.", file=sys.stderr)
            return 1

        prepare_result = run_prepare(
            raw_path,
            args.png,
            args.webp,
            args.mode,
            args.max_width,
            args.width,
            args.height,
            args.quality,
            args.allow_unmarked,
        )
        if prepare_result != 0:
            return prepare_result

        if args.keep_raw:
            keep_path = args.png.with_name("screenshot-raw.png")
            shutil.copyfile(raw_path, keep_path)
            print(f"Raw capture kept at {keep_path}")
        return 0
    finally:
        try:
            raw_path.unlink()
        except FileNotFoundError:
            pass


if __name__ == "__main__":
    raise SystemExit(main())
