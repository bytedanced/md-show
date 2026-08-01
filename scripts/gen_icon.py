"""生成墨览 App 图标：绿色圆角方底 + 白色 M，与左上角品牌徽章一致。"""
from PIL import Image, ImageDraw, ImageFont

SIZE = 1024
BG = (40, 122, 93, 255)      # #287a5d 强调色
FG = (255, 255, 255, 255)

img = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
d = ImageDraw.Draw(img)

# 圆角方形（左上/右下大圆角，右上/左下小圆角 → 与 .brand__mark 的 8px/4px 比例一致）
r_big = int(SIZE * 0.22)
r_small = int(SIZE * 0.07)
d.rounded_rectangle(
    [0, 0, SIZE - 1, SIZE - 1],
    radius=r_big,
    fill=BG,
)
# 覆盖右上/左下为小圆角：用同底色画小圆角矩形修正
d.rounded_rectangle(
    [r_big - r_small, 0, SIZE - 1, r_small * 2],
    radius=r_small,
    fill=BG,
)
d.rounded_rectangle(
    [0, SIZE - r_small * 2, SIZE - r_big + r_small, SIZE - 1],
    radius=r_small,
    fill=BG,
)

# 白色 "M" —— 使用系统可用字体
def load_font(size):
    for name in ["Georgia-Bold", "Times New Roman Bold", "DejaVuSerif-Bold", "Arial Bold"]:
        try:
            return ImageFont.truetype(name, size)
        except Exception:
            continue
    return ImageFont.load_default()

font = load_font(int(SIZE * 0.55))
# 居中绘制文本
bbox = d.textbbox((0, 0), "M", font=font)
tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
x = (SIZE - tw) / 2 - bbox[0]
y = (SIZE - th) / 2 - bbox[1]
d.text((x, y), "M", font=font, fill=FG)

img.save("/tmp/md-show-icon-preview.png")
print("saved /tmp/md-show-icon-preview.png")
