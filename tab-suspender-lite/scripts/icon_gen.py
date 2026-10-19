from pathlib import Path

from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parents[1]
ICON_DIR = ROOT / "icons"


def scaled_box(size, left, top, right, bottom):
    scale = size / 128
    return tuple(round(value * scale) for value in (left, top, right, bottom))


def generate_icon(size):
    image = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle(
        scaled_box(size, 4, 4, 124, 124),
        radius=round(size * 26 / 128),
        fill="#4f46e5",
    )
    draw.ellipse(scaled_box(size, 32, 27, 91, 94), fill="#ffffff")
    draw.ellipse(scaled_box(size, 52, 18, 101, 81), fill="#4f46e5")
    image.save(ICON_DIR / f"icon{size}.png", optimize=True)


if __name__ == "__main__":
    ICON_DIR.mkdir(exist_ok=True)
    for icon_size in (16, 32, 48, 128):
        generate_icon(icon_size)
