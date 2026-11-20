#!/usr/bin/env python3
"""Generate (or surgically patch) the 1200x630 Open Graph image.

Default output: landing/assets/og-image.png — the `og:image` /
`twitter:image` referenced by landing/index.html (1200x630).

This single script has two modes:

  generate  from scratch with Pillow. Draws the app icon, "OnlyDM" title,
            subtitle, and pill onto a dark background with faint grid and
            glow, matching the landing page styling. This is the
            re-runnable generator for future OG edits — change the text
            constants below and re-run.

  patch     surgical fix of a pre-existing og-image.png. Keeps the original
            fonts/background pixel-identical while removing the
            ONLY-DM.VERCEL.APP text and the bottom Instagram gradient line,
            then shifts the content block down by 8px to re-center. This is
            the exact patch that produced the currently committed
            og-image.png from the pre-cleanup original.

Requirements:
    - Pillow: pip install Pillow           (both modes)
    - numpy:  pip install numpy            (patch mode only)
    - Inter fonts for generate mode (ExtraBold, Regular, Medium) in
      ~/Library/Fonts or --font-dir. Download from https://github.com/rsms/inter.

Usage:
    python3 scripts/generate-og.py
    python3 scripts/generate-og.py generate --output /tmp/og.png
    python3 scripts/generate-og.py patch --src /path/to/og-image.original.png
    npm run assets:og
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parents[1]

W, H = 1200, 630
CX = 600

DEFAULT_OUT = ROOT / "landing" / "assets" / "og-image.png"
DEFAULT_ICON = ROOT / "landing" / "assets" / "app-icon.png"
DEFAULT_FONT_DIR = Path.home() / "Library" / "Fonts"

# --- OG copy (edit here for future OG changes) ---------------------------
TITLE = "OnlyDM"
SUBTITLE = "Desktop Client for Instagram DM"
PILL_TEXT = "Free & Open Source \u00b7 macOS 11+"

# Fitted text widths used to match the original og-image.png layout.
TITLE_TARGET_W = 407
SUBTITLE_TARGET_W = 448
PILL_TARGET_W = 281

# --- patch mode constants -------------------------------------------------
PATCH_DY = 8
PATCH_Y0 = 84   # first row of shifted block (pure background above icon rim ~90)
PATCH_Y1 = 528  # last row of shifted block (5px below pill border 525)


def find_font(font_dir: Path, filename: str) -> Path:
    candidates = [
        font_dir / filename,
        Path("/Library/Fonts") / filename,
        Path("/System/Library/Fonts") / filename,
    ]
    for candidate in candidates:
        if candidate.exists():
            return candidate
    raise SystemExit(
        f"Inter font not found: {filename}. "
        f"Pass --font-dir pointing to the folder with Inter-ExtraBold.otf, "
        f"Inter-Regular.otf, Inter-Medium.otf, or install them to ~/Library/Fonts."
    )


def fit_size(path: Path, text: str, target_w: int, lo: int = 10, hi: int = 140) -> tuple[int, ImageFont.FreeTypeFont]:
    for size in range(lo, hi + 1):
        f = ImageFont.truetype(str(path), size)
        try:
            w = f.getlength(text)
        except Exception:
            w = f.getbbox(text)[2]
        if w >= target_w:
            if size == lo:
                return size, f
            f_prev = ImageFont.truetype(str(path), size - 1)
            w_prev = f_prev.getlength(text)
            if abs(w_prev - target_w) <= abs(w - target_w):
                return size - 1, f_prev
            return size, f
    f = ImageFont.truetype(str(path), hi)
    return hi, f


def make_glow(base: Image.Image, center: tuple[int, int], radius: int, color: tuple[int, int, int], alpha: int = 110, blur: int = 70) -> Image.Image:
    layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    cx, cy = center
    d.ellipse([cx - radius, cy - radius, cx + radius, cy + radius], fill=color + (alpha,))
    layer = layer.filter(ImageFilter.GaussianBlur(blur))
    base.alpha_composite(layer)
    return base


def run_generate(args: argparse.Namespace) -> None:
    inter = find_font(args.font_dir, "Inter-ExtraBold.otf")
    inter_regular = find_font(args.font_dir, "Inter-Regular.otf")
    inter_medium = find_font(args.font_dir, "Inter-Medium.otf")
    if not args.icon.exists():
        raise SystemExit(f"Icon source not found: {args.icon}")

    # --- base background ---
    img = Image.new("RGBA", (W, H), (9, 10, 15, 255))

    # purple glow top-center (matches original: bright at 600,50, dark at 0,50)
    img = make_glow(img, (600, -70), 450, (96, 34, 58), alpha=82, blur=80)
    # secondary purple to the right, softer
    img = make_glow(img, (1020, 40), 380, (72, 28, 66), alpha=42, blur=85)
    # warm glow bottom-left (matches 100,620 = (39,28,20))
    img = make_glow(img, (0, 700), 340, (96, 68, 38), alpha=78, blur=85)

    # --- faint grid ---
    grid = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    gd = ImageDraw.Draw(grid)
    for x in range(60, W, 60):
        gd.line([(x, 0), (x, H)], fill=(255, 255, 255, 7), width=1)
    for y in range(60, H, 60):
        gd.line([(0, y), (W, y)], fill=(255, 255, 255, 7), width=1)
    img.alpha_composite(grid)

    # --- fonts fitted to original pixel widths ---
    title_size, title_font = fit_size(inter, TITLE, TITLE_TARGET_W, 60, 140)
    subtitle_size, subtitle_font = fit_size(inter_regular, SUBTITLE, SUBTITLE_TARGET_W, 12, 60)
    pill_size, pill_font = fit_size(inter_medium, PILL_TEXT, PILL_TARGET_W, 10, 40)
    # pill text width for layout
    pill_text_w = pill_font.getlength(PILL_TEXT)
    print(f"title size={title_size} w={title_font.getlength(TITLE):.1f} bbox={title_font.getbbox(TITLE)}")
    print(f"subtitle size={subtitle_size} w={subtitle_font.getlength(SUBTITLE):.1f} bbox={subtitle_font.getbbox(SUBTITLE)}")
    print(f"pill text size={pill_size} w={pill_text_w:.1f} bbox={pill_font.getbbox(PILL_TEXT)}")

    # --- layout: vertically centered stack ---
    # app-icon.png content is 244/256 of image, so resize image to 143 to get ~136 content
    icon_img_size = 143
    icon_h = icon_img_size
    title_bbox = title_font.getbbox(TITLE)
    title_h = title_bbox[3] - title_bbox[1]
    subtitle_bbox = subtitle_font.getbbox(SUBTITLE)
    subtitle_h = subtitle_bbox[3] - subtitle_bbox[1]
    pill_h = 48
    gap_icon_title = 38
    gap_title_sub = 22
    gap_sub_pill = 36

    total = icon_h + gap_icon_title + title_h + gap_title_sub + subtitle_h + gap_sub_pill + pill_h
    top = (H - total) // 2
    print(f"layout total={total} top={top} title_h={title_h} subtitle_h={subtitle_h}")

    icon_top = top
    icon_bottom = icon_top + icon_h
    title_top = icon_bottom + gap_icon_title
    title_bottom = title_top + title_h
    subtitle_top = title_bottom + gap_title_sub
    subtitle_bottom = subtitle_top + subtitle_h
    pill_top = subtitle_bottom + gap_sub_pill
    pill_bottom = pill_top + pill_h
    print(f"icon {icon_top}-{icon_bottom}, title {title_top}-{title_bottom}, subtitle {subtitle_top}-{subtitle_bottom}, pill {pill_top}-{pill_bottom}")

    # --- icon halo (warm glow behind icon) ---
    icon_cy = (icon_top + icon_bottom) // 2
    icon_cx = CX
    halo = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    hd = ImageDraw.Draw(halo)
    hd.ellipse([icon_cx - 130, icon_cy - 130, icon_cx + 130, icon_cy + 130], fill=(255, 122, 48, 28))
    halo = halo.filter(ImageFilter.GaussianBlur(70))
    img.alpha_composite(halo)

    # --- icon shadow ---
    icon_src = Image.open(args.icon).convert("RGBA")
    icon_resized = icon_src.resize((icon_img_size, icon_img_size), Image.LANCZOS)
    shadow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    # shadow from icon alpha
    sh_alpha = Image.new("L", (icon_img_size, icon_img_size), 0)
    sh_alpha.paste(255, (0, 0), icon_resized.getchannel("A"))
    # build black shape
    black = Image.new("RGBA", (icon_img_size, icon_img_size), (0, 0, 0, 120))
    shadow.paste(black, (icon_cx - icon_img_size // 2, icon_top + 10), mask=sh_alpha)
    shadow = shadow.filter(ImageFilter.GaussianBlur(14))
    img.alpha_composite(shadow)

    # --- icon ---
    ix = icon_cx - icon_img_size // 2
    img.alpha_composite(icon_resized, (ix, icon_top))

    draw = ImageDraw.Draw(img)

    # --- title ---
    title_cy = (title_top + title_bottom) // 2
    draw.text((CX, title_cy), TITLE, font=title_font, fill=(243, 244, 246, 255), anchor="mm")

    # --- subtitle ---
    subtitle_cy = (subtitle_top + subtitle_bottom) // 2
    draw.text((CX, subtitle_cy), SUBTITLE, font=subtitle_font, fill=(170, 178, 190, 255), anchor="mm")

    # --- pill ---
    dot_d = 8
    dot_gap = 14
    pad_x = 20
    pill_w = int(round(pad_x + dot_d + dot_gap + pill_text_w + pad_x))
    pill_left = (W - pill_w) // 2
    pill_right = pill_left + pill_w
    pill_cy = (pill_top + pill_bottom) // 2
    print(f"pill left={pill_left} right={pill_right} w={pill_w} cy={pill_cy}")
    draw.rounded_rectangle([pill_left, pill_top, pill_right, pill_bottom], radius=pill_h // 2, fill=(23, 22, 28, 255), outline=(52, 52, 64, 255), width=1)
    # dot
    dot_cx = pill_left + pad_x + dot_d // 2
    dot_cy = pill_cy
    draw.ellipse([dot_cx - dot_d // 2, dot_cy - dot_d // 2, dot_cx + dot_d // 2, dot_cy + dot_d // 2], fill=(0, 255, 137, 255))
    # pill text
    text_x = pill_left + pad_x + dot_d + dot_gap
    draw.text((text_x, pill_cy), PILL_TEXT, font=pill_font, fill=(218, 222, 228, 255), anchor="lm")

    # --- inset border (original: inset 22px, radius 34, 1px faint) ---
    border = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    bd = ImageDraw.Draw(border)
    bd.rounded_rectangle([22, 22, W - 22, H - 22], radius=34, outline=(255, 255, 255, 20), width=2)
    img.alpha_composite(border)

    # convert to RGB, save PNG (optimize)
    out = img.convert("RGB")
    args.output.parent.mkdir(parents=True, exist_ok=True)
    out.save(args.output, "PNG", optimize=True)
    print(f"saved {args.output} {out.size}")
    # verify: no bottom gradient line, check bottom rows
    for y in [620, 626, 627, 628, 629]:
        print(f"bottom y={y}", out.getpixel((600, y)), out.getpixel((10, y)), out.getpixel((1190, y)))


def run_patch(args: argparse.Namespace) -> None:
    import numpy as np

    orig = Image.open(args.src).convert("RGB")
    w, h = orig.size
    a = np.asarray(orig).copy()
    print(f"orig {w}x{h}")

    dy, y0, y1 = PATCH_DY, PATCH_Y0, PATCH_Y1
    new = a.copy()

    # 1) Shift block down by DY: new[Y0+DY:Y1+DY+1] = old[Y0:Y1+1]
    new[y0 + dy : y1 + dy + 1, :] = a[y0 : y1 + 1, :]

    # 2) Fill vacated top strip [Y0, Y0+DY) with the row just above the block (per-column background)
    new[y0 : y0 + dy, :] = a[y0 - 1, :]

    # 3) Remove domain text: rect x 480-720, y 572-602, fill per-column from row 560 (solid background)
    # row 560 in original is pure background (domain text is at y 582-593, x 494-703)
    for x in range(480, 721):
        new[572:603, x] = a[560, x]
    # Note: domain is below Y1+DY (538), so unaffected by shift; a[560] is still background.

    # 4) Remove bottom gradient line: rows 625-629 -> copy row 624 (background just above line)
    for y in range(625, 630):
        new[y, :] = a[624, :]

    out = Image.fromarray(new)
    out.save(args.output, "PNG", optimize=True)
    print(f"saved {args.output}")

    # --- verification ---
    check = np.asarray(out).astype(int)

    # domain region should have 0 bright text pixels
    region = check[560:610, 450:750]
    mask = (region[:, :, 0] > 100) & (region[:, :, 1] > 100) & (region[:, :, 2] > 100)
    print(f"domain bright pixels: {int(mask.sum())} (original was 331, expect 0)")

    # bottom line: mean R of bottom 4 rows should be low (dark), not gradient
    bottom = check[626:630]
    print(f"bottom 4 rows mean R={float(bottom[:,:,0].mean()):.1f} (expect <50, was ~180)")
    for x in [0, 100, 300, 600, 900, 1199]:
        print(f"  bottom x={x} new={tuple(check[629,x])} orig={tuple(a[629,x])}")

    # content bounds (bright >80) to show recentering
    bright = check.mean(axis=2) > 80
    ys, xs = np.where(bright[:560, :])
    print(f"new bright y: {ys.min()}..{ys.max()} center {(ys.min()+ys.max())/2} x: {xs.min()}..{xs.max()} center {(xs.min()+xs.max())/2}")
    bright0 = a.mean(axis=2) > 80
    ys0, xs0 = np.where(bright0[:560, :])
    print(f"orig bright y: {ys0.min()}..{ys0.max()} center {(ys0.min()+ys0.max())/2}")

    # font identity: title region translated by DY should match exactly
    # compare new[291+DY:380+DY] vs orig[291:380] in title x-range
    d = np.abs(check[291 + dy : 380 + dy, 398:805].astype(int) - a[291:380, 398:805].astype(int)).max()
    print(f"title patch max diff after DY shift: {d} (expect 0 -> glyphs pixel-identical)")

    # background identity at corners (must be unchanged)
    for (x, y) in [(0, 0), (600, 0), (1199, 0), (0, 50), (1199, 50)]:
        print(f"bg ({x},{y}) new={tuple(check[y,x])} orig={tuple(a[y,x])} same={np.array_equal(check[y,x], a[y,x])}")

    # size
    print("size", out.size)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        formatter_class=argparse.RawTextHelpFormatter,
        description="Generate or patch landing/assets/og-image.png (1200x630)",
        epilog=(
            "examples:\n"
            "  %(prog)s                                  # generate (default)\n"
            "  %(prog)s generate --output /tmp/og.png\n"
            "  %(prog)s patch --src og-image.original.png\n"
        ),
    )
    sub = parser.add_subparsers(dest="command")

    gen = sub.add_parser("generate", help="Draw OG image from scratch (default mode)")
    gen.add_argument("--output", type=Path, default=DEFAULT_OUT, help="Output PNG path")
    gen.add_argument("--icon", type=Path, default=DEFAULT_ICON, help="Source app icon PNG (256px)")
    gen.add_argument("--font-dir", type=Path, default=DEFAULT_FONT_DIR, help="Folder with Inter *.otf files")

    pat = sub.add_parser("patch", help="Surgically patch a pre-existing og-image.png")
    pat.add_argument("--src", type=Path, required=True, help="Original (pre-cleanup) og-image.png, 1200x630")
    pat.add_argument("--output", type=Path, default=DEFAULT_OUT, help="Output PNG path")

    return parser


def main() -> None:
    parser = build_parser()
    argv = sys.argv[1:]
    # Let top-level --help/-h show both subcommands.
    if argv in (["--help"], ["-h"], ["help"]):
        parser.print_help()
        return
    # Bare invocation (e.g. `npm run assets:og`) is treated as `generate`
    # so existing commands keep working.
    if not argv or argv[0] not in ("generate", "patch"):
        argv = ["generate", *argv]
    args = parser.parse_args(argv)
    if args.command == "patch":
        run_patch(args)
    else:
        run_generate(args)


if __name__ == "__main__":
    main()
