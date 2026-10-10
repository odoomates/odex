"""Generate the extension icons (run once; output is committed in src/icons)."""
from pathlib import Path

from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parent.parent / "src" / "icons"
PURPLE = (113, 75, 103, 255)  # Odoo purple
WHITE = (255, 255, 255, 255)
TEAL = (0, 160, 157, 255)  # Odoo teal
SCALE = 8  # supersampling for smooth edges


def icon(size):
    s = size * SCALE
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([0, 0, s - 1, s - 1], radius=s * .22, fill=PURPLE)
    # an "o" ring (Odoo) with a teal "x" crossing its lower right: odeX
    w = round(s * .11)
    cx, cy, r = s * .42, s * .44, s * .22
    d.ellipse([cx - r, cy - r, cx + r, cy + r], outline=WHITE, width=w)
    a, b = s * .58, s * .84
    d.line([(a, a), (b, b)], fill=TEAL, width=w)
    d.line([(a, b), (b, a)], fill=TEAL, width=w)
    return img.resize((size, size), Image.LANCZOS)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    for size in (16, 32, 48, 128):
        icon(size).save(OUT / f"icon-{size}.png")


if __name__ == "__main__":
    main()
