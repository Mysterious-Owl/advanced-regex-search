"""Generate the extension icons in icons/.

Usage:  python tools/make_icons.py
Needs Pillow (pip install pillow). Each size is drawn at 1024 px and downscaled,
so edges stay smooth. Sizes of 32 px and below use a simplified mark (no ".*"
text), since the text would be unreadable.
"""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

SIZES = [16, 24, 32, 48, 64, 72, 96, 128, 256]
CANVAS = 1024
OUT_DIR = Path(__file__).resolve().parent.parent / "icons"

GRADIENT_TOP = (91, 61, 245)      # violet
GRADIENT_BOTTOM = (25, 133, 230)  # blue
WHITE = (255, 255, 255, 255)
HIGHLIGHT = (255, 214, 10, 255)   # highlighter yellow
INK = (30, 27, 75, 255)           # dark text on the highlight

FONT_CANDIDATES = [
    "C:/Windows/Fonts/consolab.ttf",
    "/System/Library/Fonts/Menlo.ttc",
    "/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf",
]


def load_font(size):
    for path in FONT_CANDIDATES:
        if Path(path).exists():
            return ImageFont.truetype(path, size)
    return ImageFont.load_default(size)


def background():
    """Rounded square with a diagonal violet-to-blue gradient."""
    gradient = Image.new("RGBA", (CANVAS, CANVAS))
    pixels = gradient.load()
    for y in range(CANVAS):
        for x in range(CANVAS):
            t = (x + y) / (2 * (CANVAS - 1))
            pixels[x, y] = tuple(
                round(a + (b - a) * t) for a, b in zip(GRADIENT_TOP, GRADIENT_BOTTOM)
            ) + (255,)
    mask = Image.new("L", (CANVAS, CANVAS), 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        (0, 0, CANVAS - 1, CANVAS - 1), radius=int(CANVAS * 0.22), fill=255
    )
    gradient.putalpha(mask)
    return gradient


def draw_mark(image, simple):
    draw = ImageDraw.Draw(image)
    # Lens geometry (upper left), handle toward the bottom right corner.
    cx, cy = CANVAS * 0.43, CANVAS * 0.43
    radius = CANVAS * (0.27 if simple else 0.28)
    ring = CANVAS * (0.085 if simple else 0.06)

    # Handle: a thick rounded line from the ring's edge outward.
    handle_width = int(CANVAS * (0.15 if simple else 0.12))
    start = (cx + radius * 0.62, cy + radius * 0.62)
    end = (CANVAS * 0.80, CANVAS * 0.80)
    draw.line([start, end], fill=WHITE, width=handle_width)
    for x, y in (end,):
        r = handle_width / 2
        draw.ellipse((x - r, y - r, x + r, y + r), fill=WHITE)

    # Ring.
    draw.ellipse((cx - radius, cy - radius, cx + radius, cy + radius), fill=WHITE)
    inner = radius - ring
    if simple:
        # Small sizes: fill the lens with the highlight color.
        draw.ellipse((cx - inner, cy - inner, cx + inner, cy + inner), fill=HIGHLIGHT)
        return

    # Glass: slightly tinted so the highlight swatch reads as "inside" the lens.
    draw.ellipse((cx - inner, cy - inner, cx + inner, cy + inner), fill=(46, 64, 190, 255))
    # Highlighter swatch with ".*" on it.
    sw, sh = inner * 1.5, inner * 0.82
    swatch = (cx - sw / 2, cy - sh / 2, cx + sw / 2, cy + sh / 2)
    draw.rounded_rectangle(swatch, radius=sh * 0.22, fill=HIGHLIGHT)
    font = load_font(int(sh * 1.05))
    draw.text((cx, cy + sh * 0.04), ".*", font=font, fill=INK, anchor="mm")


def render(size):
    image = background()
    draw_mark(image, simple=size <= 32)
    return image.resize((size, size), Image.LANCZOS)


def main():
    OUT_DIR.mkdir(exist_ok=True)
    for size in SIZES:
        path = OUT_DIR / f"icons_{size}.png"
        render(size).save(path)
        print("wrote", path)


if __name__ == "__main__":
    main()
