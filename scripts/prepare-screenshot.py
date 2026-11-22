#!/usr/bin/env python3
"""Turn a sanitized OnlyDM demo capture into landing-page assets.

The in-app "Developer > Prepare Demo Screenshot" mode draws two pure-green
lines at the top and bottom of the sanitized webview. This script refuses to
process an image without those markers, so a real (unsanitized) capture cannot
accidentally be published.

By default the full macOS window (title bar, traffic lights, window edges) is
kept. The green validation rows are replaced with neighbouring content, not
cropped away, so the window dimensions and layout stay intact.

Usage:
    python3 scripts/prepare-screenshot.py capture.png
    python3 scripts/prepare-screenshot.py capture.png --mode content
    python3 scripts/prepare-screenshot.py capture.png --dry-run
"""

from __future__ import annotations

import argparse
import os
import re
import sys
from pathlib import Path

from PIL import Image, ImageOps

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_PNG = REPO_ROOT / "landing" / "assets" / "screenshot.png"
DEFAULT_WEBP = REPO_ROOT / "landing" / "assets" / "screenshot.webp"


def load_rgb(path: Path) -> Image.Image:
    image = Image.open(path)
    image.load()

    if image.mode in ("RGBA", "LA"):
        # Window captures can contain transparent rounded corners. Composite
        # them over black, matching the dark OnlyDM shell.
        background = Image.new("RGB", image.size, (0, 0, 0))
        background.paste(image, mask=image.split()[-1])
        return background

    return image.convert("RGB")


def marker_rows(image: Image.Image) -> list[int]:
    """Return rows whose average colour is the bright marker green.

    Averages are used instead of exact pixel matching so Display-P3 captures
    and slightly antialiased edges still work. The markers span the full
    webview width, so their row average stays strongly green.
    """

    width, height = image.size
    rows: list[int] = []

    for y in range(height):
        row = image.crop((0, y, width, y + 1)).resize(
            (1, 1), Image.Resampling.BOX
        )
        red, green, blue = row.getpixel((0, 0))
        if green > 120 and green > red * 1.6 and green > blue * 1.6:
            rows.append(y)

    return rows


def group_rows(rows: list[int]) -> list[tuple[int, int]]:
    if not rows:
        return []

    groups: list[tuple[int, int]] = []
    start = previous = rows[0]

    for row in rows[1:]:
        if row == previous + 1:
            previous = row
            continue
        groups.append((start, previous))
        start = previous = row

    groups.append((start, previous))
    return groups


def replace_marker_rows(
    image: Image.Image,
    top_group: tuple[int, int],
    bottom_group: tuple[int, int],
) -> Image.Image:
    """Replace the two green marker bands with adjacent content.

    The bands sit at the top and bottom of the web content, between the native
    title bar and the content and between the content and the window bottom.
    Duplicating the nearest content row keeps the full window dimensions and
    leaves no green pixels, so the real macOS window can be used as-is.
    """

    width, height = image.size
    top_start, top_end = top_group
    bottom_start, bottom_end = bottom_group

    if top_end >= bottom_start:
        raise ValueError("marker bands overlap")

    top_source = min(top_end + 1, height - 1)
    bottom_source = max(bottom_start - 1, 0)

    output = Image.new("RGB", (width, height))
    y = 0

    def paste(part: Image.Image) -> None:
        nonlocal y
        output.paste(part, (0, y))
        y += part.height

    if top_start > 0:
        paste(image.crop((0, 0, width, top_start)))

    top_strip = image.crop((0, top_source, width, top_source + 1))
    for _ in range(top_end - top_start + 1):
        paste(top_strip)

    if bottom_start > top_end + 1:
        paste(image.crop((0, top_end + 1, width, bottom_start)))

    bottom_strip = image.crop(
        (0, bottom_source, width, bottom_source + 1)
    )
    for _ in range(bottom_end - bottom_start + 1):
        paste(bottom_strip)

    if bottom_end + 1 < height:
        paste(image.crop((0, bottom_end + 1, width, height)))

    if y != height:
        raise ValueError("marker replacement changed the image height")

    return output


def sync_landing_dimensions(width: int, height: int) -> None:
    """Keep the landing <img> width/height hints in sync with the asset."""

    html_path = REPO_ROOT / "landing" / "index.html"
    if not html_path.exists():
        return

    text = html_path.read_text()
    pattern = re.compile(
        r'(<img\s+src="assets/screenshot\.png"[^>]*?width=")'
        r"\d+"
        r'("[^>]*?height=")'
        r"\d+"
        r'(")'
    )
    new_text, count = pattern.subn(
        lambda match: (
            f"{match.group(1)}{width}{match.group(2)}{height}{match.group(3)}"
        ),
        text,
        count=1,
    )
    if count == 0:
        print(
            "NOTE: could not find the screenshot <img> tag to update its "
            "dimensions.",
            file=sys.stderr,
        )
        return
    if new_text != text:
        html_path.write_text(new_text)
        print(f"Updated landing image dimensions to {width}x{height}.")


def prepare(
    input_path: Path,
    png_path: Path,
    webp_path: Path,
    mode: str,
    max_width: int,
    target_width: int,
    target_height: int,
    quality: int,
    allow_unmarked: bool,
    dry_run: bool,
) -> int:
    image = load_rgb(input_path)
    width, height = image.size
    print(f"Input: {input_path} ({width}x{height})")

    if allow_unmarked:
        print(
            "WARNING: --allow-unmarked is set. The sanitization gate is "
            "disabled; only use this on an image you have already verified.",
            file=sys.stderr,
        )
        if mode == "content":
            prepared = ImageOps.fit(
                image,
                (target_width, target_height),
                method=Image.Resampling.LANCZOS,
                centering=(0.5, 0.5),
            )
        else:
            prepared = image.copy()
    else:
        rows = marker_rows(image)
        groups = group_rows(rows)

        if len(groups) < 2:
            print(
                "ERROR: sanitization markers were not found.\n"
                "Run OnlyDM in development mode, open a DM conversation, choose "
                "Developer > Prepare Demo Screenshot, wait for the two green "
                "lines, then capture the window. This script refuses to process "
                "an unmarked capture.",
                file=sys.stderr,
            )
            return 2

        top_group, bottom_group = groups[0], groups[-1]
        content_top = top_group[1] + 1
        content_bottom = bottom_group[0]
        print(
            "Markers: "
            f"rows {top_group[0]}-{top_group[1]} and "
            f"{bottom_group[0]}-{bottom_group[1]}"
        )

        if content_bottom - content_top < 100:
            print(
                "ERROR: the area between the markers is too small to be the "
                "OnlyDM window.",
                file=sys.stderr,
            )
            return 2

        if mode == "window":
            if top_group[0] == 0:
                print(
                    "WARNING: the top marker is at row 0, so this looks like a "
                    "content-only capture. Use `npm run screenshot` and select "
                    "the whole OnlyDM window to include the title bar.",
                    file=sys.stderr,
                )
            prepared = replace_marker_rows(
                image, top_group, bottom_group
            )
            print(
                "Window mode: kept the full window; replaced the green "
                "marker rows with adjacent content."
            )
        else:
            content = image.crop(
                (0, content_top, width, content_bottom)
            )
            print(
                f"Sanitized content: {content.width}x{content.height}"
            )

            expected_ratio = target_width / target_height
            actual_ratio = content.width / content.height
            if abs(actual_ratio / expected_ratio - 1) > 0.04:
                print(
                    "WARNING: the capture aspect ratio differs from the "
                    "target. Resize the OnlyDM window so the web content is "
                    "1100x700 points for an exact fit.",
                    file=sys.stderr,
                )
            if content.width < target_width:
                print(
                    "WARNING: the capture is narrower than the target; the "
                    "result may look soft. Capture at Retina resolution.",
                    file=sys.stderr,
                )

            prepared = ImageOps.fit(
                content,
                (target_width, target_height),
                method=Image.Resampling.LANCZOS,
                centering=(0.5, 0.5),
            )

    if mode == "window" and max_width > 0 and prepared.width > max_width:
        ratio = max_width / prepared.width
        new_size = (max_width, round(prepared.height * ratio))
        prepared = prepared.resize(new_size, Image.Resampling.LANCZOS)
        print(f"Scaled to {new_size[0]}x{new_size[1]} (max width {max_width}).")

    clean = Image.new("RGB", prepared.size)
    clean.paste(prepared)
    # `clean` has no EXIF/ICC payload from the capture.
    final_width, final_height = clean.size

    if dry_run:
        print(
            f"Dry run: would write {png_path} and {webp_path} "
            f"at {final_width}x{final_height}."
        )
        return 0

    png_path.parent.mkdir(parents=True, exist_ok=True)
    webp_path.parent.mkdir(parents=True, exist_ok=True)

    tmp_png = png_path.with_name(png_path.name + ".tmp")
    tmp_webp = webp_path.with_name(webp_path.name + ".tmp")

    try:
        clean.save(tmp_png, "PNG", optimize=True)
        clean.save(
            tmp_webp,
            "WEBP",
            quality=quality,
            method=6,
        )
        os.replace(tmp_png, png_path)
        os.replace(tmp_webp, webp_path)
    finally:
        for tmp in (tmp_png, tmp_webp):
            try:
                tmp.unlink()
            except FileNotFoundError:
                pass

    png_kb = png_path.stat().st_size / 1024
    webp_kb = webp_path.stat().st_size / 1024
    print(
        f"Wrote {png_path} ({png_kb:.1f} KB) and "
        f"{webp_path} ({webp_kb:.1f} KB) at {final_width}x{final_height}."
    )

    if png_path.resolve() == DEFAULT_PNG.resolve():
        sync_landing_dimensions(final_width, final_height)

    return 0


def main() -> int:
    parser = argparse.ArgumentParser(
        description=(
            "Validate a sanitized OnlyDM demo capture, remove its green "
            "marker rows, strip metadata, and write PNG + WebP assets. The "
            "default window mode keeps the whole macOS window."
        )
    )
    parser.add_argument("input", type=Path, help="raw capture to process")
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
        "--png",
        type=Path,
        default=DEFAULT_PNG,
        help=f"PNG output path (default: {DEFAULT_PNG})",
    )
    parser.add_argument(
        "--webp",
        type=Path,
        default=DEFAULT_WEBP,
        help=f"WebP output path (default: {DEFAULT_WEBP})",
    )
    parser.add_argument(
        "--max-width",
        type=int,
        default=2400,
        help="downscale window captures wider than this (0 disables; default 2400)",
    )
    parser.add_argument(
        "--width",
        type=int,
        default=2200,
        help="content mode target width (default 2200)",
    )
    parser.add_argument(
        "--height",
        type=int,
        default=1400,
        help="content mode target height (default 1400)",
    )
    parser.add_argument("--quality", type=int, default=82)
    parser.add_argument(
        "--allow-unmarked",
        action="store_true",
        help="process even without the green sanitization markers (dangerous)",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="verify and prepare but do not write output files",
    )
    args = parser.parse_args()

    if not args.input.exists():
        print(f"ERROR: input file not found: {args.input}", file=sys.stderr)
        return 2
    if args.width < 1 or args.height < 1:
        print("ERROR: --width and --height must be positive.", file=sys.stderr)
        return 2
    if args.max_width < 0:
        print("ERROR: --max-width must be zero or positive.", file=sys.stderr)
        return 2

    return prepare(
        input_path=args.input,
        png_path=args.png,
        webp_path=args.webp,
        mode=args.mode,
        max_width=args.max_width,
        target_width=args.width,
        target_height=args.height,
        quality=args.quality,
        allow_unmarked=args.allow_unmarked,
        dry_run=args.dry_run,
    )


if __name__ == "__main__":
    raise SystemExit(main())
