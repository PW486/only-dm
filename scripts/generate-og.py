#!/usr/bin/env python3
"""Generate the 1200x630 Open Graph image for OnlyDM.

Design:
    - Gradient wallpaper background, cover-cropped to 1200x630 and dimmed
      slightly so the copy stays readable.
    - App icon with a soft drop shadow.
    - "OnlyDM" title, subtitle, and a translucent glass pill.
    - No grid and no inset border.

Output:
    landing/assets/og-image.png
    (the og:image / twitter:image referenced by landing/index.html)

Source assets:
    scripts/assets/og-background.jpg
    landing/assets/app-icon.png

Requirements:
    - Pillow: pip install Pillow
    - Plus Jakarta Sans installed system-wide via Homebrew:
        brew install --cask font-plus-jakarta-sans

Usage:
    python3 scripts/generate-og.py
    python3 scripts/generate-og.py --output /tmp/og.png
    npm run assets:og
"""

from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parents[1]

W, H = 1200, 630
CX = W // 2

DEFAULT_OUT = ROOT / "landing" / "assets" / "og-image.png"
DEFAULT_ICON = ROOT / "landing" / "assets" / "app-icon.png"
DEFAULT_BACKGROUND = ROOT / "scripts" / "assets" / "og-background.jpg"
DEFAULT_FONT_DIR = Path.home() / "Library" / "Fonts"

FONT_FAMILY = "Plus Jakarta Sans"
FONT_BREW_CASK = "font-plus-jakarta-sans"

# --- OG copy (edit here for future OG changes) ---------------------------
TITLE = "OnlyDM"
SUBTITLE = "Desktop Client for Instagram DM"
PILL_TEXT = "Free & Open Source \u00b7 macOS 11+"

# Ink widths that keep the same composition as the previous OG image.
TITLE_TARGET_W = 408
SUBTITLE_TARGET_W = 452
PILL_TARGET_W = 294

TITLE_WEIGHT = 800
SUBTITLE_WEIGHT = 400
PILL_WEIGHT = 500

# Tighter tracking on the wordmark, matching the landing page hero title.
TITLE_TRACKING_EM = -0.035

# --- layout --------------------------------------------------------------
ICON_SIZE = 138
ICON_TOP = 102
TITLE_INK_TOP = 299
SUBTITLE_INK_TOP = 422
PILL_TOP = 485
PILL_HEIGHT = 49
PILL_RADIUS = PILL_HEIGHT // 2
PILL_PAD_X = 20
PILL_DOT_D = 8
PILL_DOT_GAP = 14

# --- colors --------------------------------------------------------------
BACKGROUND_DIM = 0.10
BACKGROUND_DIM_COLOR = (9, 7, 15)
TITLE_FILL = (243, 244, 246, 215)
SUBTITLE_FILL = (215, 221, 231, 215)
PILL_FILL = (23, 22, 28, 215)
PILL_BORDER = (255, 255, 255, 45)
PILL_TEXT_FILL = (218, 222, 228, 255)
PILL_DOT_FILL = (0, 255, 137, 255)

TITLE_SHADOW = (20, 6, 22)
SUBTITLE_SHADOW = (20, 6, 22)
PILL_SHADOW = (15, 5, 18)
ICON_SHADOW = (22, 6, 26)

def font_candidates(font_dir: Path) -> list[Path]:
    """Return upright Plus Jakarta Sans font files, best candidates first."""
    directories = [
        font_dir,
        Path.home() / "Library" / "Fonts",
        Path("/Library/Fonts"),
        Path("/System/Library/Fonts"),
        Path("/opt/homebrew/share/fonts"),
        Path("/usr/local/share/fonts"),
    ]
    seen: set[Path] = set()
    candidates: list[Path] = []
    for directory in directories:
        if not directory.exists():
            continue
        for path in sorted(directory.glob("PlusJakartaSans*")):
            if path.suffix.lower() not in {".ttf", ".otf"}:
                continue
            if "italic" in path.name.lower():
                continue
            if path in seen:
                continue
            seen.add(path)
            candidates.append(path)

    # Prefer the variable weight axis file, then static weight files.
    candidates.sort(key=lambda p: ("wght" not in p.name.lower(), p.name))
    return candidates


def load_font(font_dir: Path, size: int, weight: int) -> ImageFont.FreeTypeFont:
    candidates = font_candidates(font_dir)
    if not candidates:
        raise SystemExit(
            f"{FONT_FAMILY} not found. Install it with:\n"
            f"    brew install --cask {FONT_BREW_CASK}\n"
            f"or pass --font-dir pointing at a folder containing the font files."
        )

    # Variable font: pick the upright file and set the weight axis.
    for path in candidates:
        if "wght" not in path.name.lower():
            continue
        try:
            font = ImageFont.truetype(str(path), size)
            font.set_variation_by_axes([weight])
            return font
        except Exception:
            continue

    # Static font: match the requested weight by filename.
    weight_names = {
        300: "Light",
        400: "Regular",
        500: "Medium",
        600: "SemiBold",
        700: "Bold",
        800: "ExtraBold",
    }
    weight_name = weight_names.get(weight)
    if weight_name:
        for path in candidates:
            if f"-{weight_name}." in path.name or f"-{weight_name}[" in path.name:
                return ImageFont.truetype(str(path), size)

    raise SystemExit(
        f"Could not load {FONT_FAMILY} at weight {weight}. "
        f"Reinstall with `brew install --cask {FONT_BREW_CASK}` "
        f"or pass --font-dir to a folder with the static font weights."
    )


def fit_size(
    font_dir: Path,
    text: str,
    target_w: int,
    weight: int,
    lo: int = 10,
    hi: int = 140,
) -> tuple[int, ImageFont.FreeTypeFont]:
    """Pick the font size whose ink width is closest to target_w."""
    best: tuple[int, int, ImageFont.FreeTypeFont] | None = None
    for size in range(lo, hi + 1):
        font = load_font(font_dir, size, weight)
        bbox = font.getbbox(text)
        width = bbox[2] - bbox[0]
        distance = abs(width - target_w)
        if best is None or distance < best[0]:
            best = (distance, size, font)
    assert best is not None
    return best[1], best[2]


def cover(im: Image.Image, width: int, height: int) -> Image.Image:
    """Resize and center-crop an image to exactly width x height."""
    im = im.convert("RGB")
    scale = max(width / im.width, height / im.height)
    resized = im.resize(
        (round(im.width * scale), round(im.height * scale)),
        Image.LANCZOS,
    )
    left = (resized.width - width) // 2
    top = (resized.height - height) // 2
    return resized.crop((left, top, left + width, top + height)).convert("RGBA")


def text_layer(
    text: str,
    font: ImageFont.FreeTypeFont,
    fill: tuple[int, int, int, int],
    tracking: int = 0,
) -> tuple[Image.Image, int, int]:
    """Render text and crop the layer to its actual ink bounds.

    A non-zero tracking value is applied between glyphs. The final crop makes
    centering independent of font side bearings.
    """
    bbox = font.getbbox(text)
    padding = 16
    width = round(font.getlength(text)) + padding * 2 + abs(tracking) * len(text)
    height = bbox[3] - bbox[1] + padding * 2
    layer = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    baseline_y = padding - bbox[1]

    if tracking:
        for index, char in enumerate(text):
            x = padding + font.getlength(text[:index]) + tracking * index
            draw.text((x, baseline_y), char, font=font, fill=fill)
    else:
        draw.text((padding - bbox[0], baseline_y), text, font=font, fill=fill)

    ink_bbox = layer.getchannel("A").getbbox()
    if ink_bbox is None:
        raise SystemExit(f"Could not render text: {text!r}")
    layer = layer.crop(ink_bbox)
    return layer, layer.width, layer.height


def shadow(
    layer: Image.Image,
    position: tuple[int, int],
    blur: int,
    offset: tuple[int, int],
    opacity: float,
    color: tuple[int, int, int],
) -> Image.Image:
    """Build a full-canvas soft shadow from a layer's alpha channel."""
    canvas = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    canvas.alpha_composite(layer, position)
    if offset != (0, 0):
        shifted = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        shifted.alpha_composite(canvas, offset)
        canvas = shifted
    alpha = canvas.getchannel("A").filter(ImageFilter.GaussianBlur(blur))
    if opacity < 1:
        alpha = alpha.point(lambda value: int(value * opacity))
    out = Image.new("RGBA", (W, H), color + (0,))
    out.putalpha(alpha)
    return out


def add_text(
    img: Image.Image,
    text: str,
    font: ImageFont.FreeTypeFont,
    fill: tuple[int, int, int, int],
    ink_top: int,
    shadow_color: tuple[int, int, int],
    shadow_blur: int,
    shadow_offset: tuple[int, int],
    shadow_opacity: float,
    tracking: int = 0,
) -> int:
    layer, ink_w, _ = text_layer(text, font, fill, tracking)
    position = (round(CX - ink_w / 2), ink_top)
    img.alpha_composite(
        shadow(layer, position, shadow_blur, shadow_offset, shadow_opacity, shadow_color)
    )
    img.alpha_composite(layer, position)
    return ink_w


def run(args: argparse.Namespace) -> None:
    for path, label in (
        (args.icon, "Icon"),
        (args.background, "Background"),
    ):
        if not path.exists():
            raise SystemExit(f"{label} source not found: {path}")

    title_size, title_font = fit_size(
        args.font_dir, TITLE, TITLE_TARGET_W, TITLE_WEIGHT, 70, 140
    )
    subtitle_size, subtitle_font = fit_size(
        args.font_dir, SUBTITLE, SUBTITLE_TARGET_W, SUBTITLE_WEIGHT, 15, 60
    )
    pill_size, pill_font = fit_size(
        args.font_dir, PILL_TEXT, PILL_TARGET_W, PILL_WEIGHT, 12, 36
    )

    # --- background ------------------------------------------------------
    img = cover(Image.open(args.background), W, H)
    dim_alpha = round(255 * BACKGROUND_DIM)
    img.alpha_composite(Image.new("RGBA", (W, H), BACKGROUND_DIM_COLOR + (dim_alpha,)))

    # --- icon ------------------------------------------------------------
    icon = Image.open(args.icon).convert("RGBA").resize(
        (ICON_SIZE, ICON_SIZE), Image.LANCZOS
    )
    icon_bbox = icon.getchannel("A").getbbox()
    if icon_bbox is None:
        raise SystemExit(f"Icon has no visible pixels: {args.icon}")
    icon_center_x = (icon_bbox[0] + icon_bbox[2] - 1) / 2
    icon_pos = (round(CX - icon_center_x), ICON_TOP)
    img.alpha_composite(shadow(icon, icon_pos, 18, (0, 12), 0.55, ICON_SHADOW))
    img.alpha_composite(icon, icon_pos)

    # --- title + subtitle ------------------------------------------------
    title_tracking = round(TITLE_TRACKING_EM * title_size)
    title_ink_w = add_text(
        img,
        TITLE,
        title_font,
        TITLE_FILL,
        TITLE_INK_TOP,
        TITLE_SHADOW,
        11,
        (0, 5),
        0.46,
        tracking=title_tracking,
    )
    subtitle_ink_w = add_text(
        img,
        SUBTITLE,
        subtitle_font,
        SUBTITLE_FILL,
        SUBTITLE_INK_TOP,
        SUBTITLE_SHADOW,
        8,
        (0, 3),
        0.50,
    )

    # --- translucent pill ------------------------------------------------
    pill_text_layer, pill_text_w, pill_text_h = text_layer(
        PILL_TEXT, pill_font, PILL_TEXT_FILL
    )
    pill_content_w = PILL_DOT_D + PILL_DOT_GAP + pill_text_w
    pill_w = round(PILL_PAD_X * 2 + pill_content_w)
    if pill_w % 2:
        pill_w += 1
    pill_left = (W - pill_w) // 2
    pill_right = pill_left + pill_w
    pill_bottom = PILL_TOP + PILL_HEIGHT

    pill_mask = Image.new("L", (W, H), 0)
    ImageDraw.Draw(pill_mask).rounded_rectangle(
        [pill_left, PILL_TOP, pill_right, pill_bottom],
        radius=PILL_RADIUS,
        fill=255,
    )
    pill_shadow_alpha = pill_mask.filter(ImageFilter.GaussianBlur(16)).point(
        lambda value: int(value * 0.45)
    )
    pill_shadow = Image.new("RGBA", (W, H), PILL_SHADOW + (0,))
    pill_shadow.putalpha(pill_shadow_alpha)
    img.alpha_composite(ImageChops.offset(pill_shadow, 0, 8))

    pill_layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    pill_draw = ImageDraw.Draw(pill_layer)
    pill_draw.rounded_rectangle(
        [pill_left, PILL_TOP, pill_right, pill_bottom],
        radius=PILL_RADIUS,
        fill=PILL_FILL,
        outline=PILL_BORDER,
        width=1,
    )
    img.alpha_composite(pill_layer)

    draw = ImageDraw.Draw(img)
    content_left = pill_left + (pill_w - pill_content_w) // 2
    dot_cx = content_left + PILL_DOT_D // 2
    dot_cy = (PILL_TOP + pill_bottom) // 2
    draw.ellipse(
        [
            dot_cx - PILL_DOT_D // 2,
            dot_cy - PILL_DOT_D // 2,
            dot_cx + PILL_DOT_D // 2,
            dot_cy + PILL_DOT_D // 2,
        ],
        fill=PILL_DOT_FILL,
    )
    text_x = content_left + PILL_DOT_D + PILL_DOT_GAP
    text_y = round(dot_cy - pill_text_h / 2)
    img.alpha_composite(pill_text_layer, (round(text_x), text_y))

    # --- save ------------------------------------------------------------
    args.output.parent.mkdir(parents=True, exist_ok=True)
    out = img.convert("RGB")
    out.save(args.output, "PNG", optimize=True)
    print(
        f"title size={title_size} ink={title_ink_w}px "
        f"tracking={title_tracking}px"
    )
    print(f"subtitle size={subtitle_size} ink={subtitle_ink_w}px")
    print(f"pill text size={pill_size} ink={pill_text_w}px, pill width={pill_w}px")
    try:
        output_label = args.output.relative_to(ROOT)
    except ValueError:
        output_label = args.output
    print(f"wrote {output_label} ({W}x{H})")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        formatter_class=argparse.RawTextHelpFormatter,
        description="Generate landing/assets/og-image.png (1200x630)",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=DEFAULT_OUT,
        help="Output PNG path",
    )
    parser.add_argument(
        "--icon",
        type=Path,
        default=DEFAULT_ICON,
        help="Source app icon PNG",
    )
    parser.add_argument(
        "--background",
        type=Path,
        default=DEFAULT_BACKGROUND,
        help="Wallpaper background image",
    )
    parser.add_argument(
        "--font-dir",
        type=Path,
        default=DEFAULT_FONT_DIR,
        help="Folder with Plus Jakarta Sans font files",
    )
    return parser


def main() -> None:
    run(build_parser().parse_args())


if __name__ == "__main__":
    main()
