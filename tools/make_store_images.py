"""Generate store promo images into store/ (Chrome: small tile 440x280, marquee 1400x560)."""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "store"
FONTS = Path("/usr/share/fonts/truetype/noto")
PURPLE = (113, 75, 103)
PURPLE_DARK = (84, 54, 76)
WHITE = (255, 255, 255)
SOFT = (236, 226, 233)


def font(name, size):
    return ImageFont.truetype(str(FONTS / name), size)


def tile(width, height, title_size, tag_size, icon_size, tagline):
    img = Image.new("RGB", (width, height), PURPLE)
    d = ImageDraw.Draw(img)
    # soft diagonal band for depth
    d.polygon([(width * .55, 0), (width, 0), (width, height), (width * .35, height)], fill=PURPLE_DARK)
    icon = Image.open(ROOT / "src" / "icons" / "icon-128.png").convert("RGBA").resize((icon_size, icon_size), Image.LANCZOS)
    pad = round(height * .14)
    img.paste(icon, (pad, (height - icon_size) // 2 - round(height * .12)), icon)
    x = pad + icon_size + round(pad * .6)
    y = (height - icon_size) // 2 - round(height * .12)
    d.text((x, y - round(title_size * .1)), "ode", font=font("NotoSans-Bold.ttf", title_size), fill=WHITE)
    w = d.textlength("ode", font=font("NotoSans-Bold.ttf", title_size))
    d.text((x + w, y - round(title_size * .1)), "X", font=font("NotoSans-Bold.ttf", title_size), fill=SOFT)
    d.text((x, y + round(title_size * 1.15)), "Odoo ORM Box", font=font("NotoSans-SemiBold.ttf", tag_size), fill=WHITE)
    ty = (height + icon_size) // 2 + round(height * .02)
    for k, line in enumerate(tagline):
        d.text((pad, ty + k * round(tag_size * 1.45)), line, font=font("NotoSans-Regular.ttf", round(tag_size * .82)), fill=SOFT)
    return img


def main():
    OUT.mkdir(exist_ok=True)
    tile(440, 280, 44, 19, 72, ["search_read · read · write · fields_get…"]).save(OUT / "promo-small-440x280.png")
    tile(1400, 560, 110, 44, 170, ["Run ORM calls in Python syntax on any Odoo page",
                                   "Table · Tree · JSON · Python · tracebacks · confirm before writes"]).save(OUT / "promo-marquee-1400x560.png")


if __name__ == "__main__":
    main()
