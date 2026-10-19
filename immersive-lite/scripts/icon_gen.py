# 生成扩展图标:靛蓝圆角方块 + 白色「译」字
# 用法: uv run --with pillow python scripts/icon_gen.py
from PIL import Image, ImageDraw, ImageFont
from pathlib import Path

FONT = "/usr/share/fonts/truetype/winfonts/NotoSansSC-VF.ttf"
OUT = Path(__file__).resolve().parent.parent / "icons"
OUT.mkdir(exist_ok=True)


def gen(size: int) -> None:
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    # 垂直渐变背景圆角方块(靛蓝 → 蓝)
    top, bottom = (91, 108, 255), (64, 92, 235)
    radius = max(4, size // 5)
    for y in range(size):
        t = y / max(1, size - 1)
        color = tuple(round(a + (b - a) * t) for a, b in zip(top, bottom))
        d.line([(0, y), (size, y)], fill=color + (255,))
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, size - 1, size - 1], radius, fill=255)
    img.putalpha(mask)
    # 居中「译」
    f = ImageFont.truetype(FONT, round(size * 0.62))
    x0, y0, x1, y1 = d.textbbox((0, 0), "译", font=f)
    d.text(((size - x1 - x0) / 2, (size - y1 - y0) / 2 - size * 0.02), "译",
           font=f, fill=(255, 255, 255, 255))
    img.save(OUT / f"icon{size}.png")


for s in (16, 32, 48, 128):
    gen(s)
print("icons written to", OUT)
