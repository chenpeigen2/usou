# -*- coding: utf-8 -*-
# 生成应用图标：渐变圆角方块 + 白色闪电（多尺寸 .ico）
from PIL import Image, ImageDraw, ImageChops, ImageFilter
import os

S = 1024
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)))

# ---- 渐变底：对角线 #4D9FFF -> #A78BFA ----
corners = [(77, 159, 255), (109, 140, 255), (123, 149, 252), (167, 139, 250)]  # TL TR BL BR
g = Image.new('RGB', (2, 2))
for i, c in enumerate(corners):
    g.putpixel((i % 2, i // 2), c)
grad = g.resize((S, S), Image.BILINEAR).convert('RGBA')

# ---- 圆角遮罩 ----
mask = Image.new('L', (S, S), 0)
dm = ImageDraw.Draw(mask)
dm.rounded_rectangle([56, 56, S - 56, S - 56], radius=210, fill=255)

img = Image.new('RGBA', (S, S), (0, 0, 0, 0))
img.paste(grad, (0, 0), mask)

# ---- 顶部高光（椭圆柔光，裁剪在圆角内）----
hi = Image.new('L', (S, S), 0)
dh = ImageDraw.Draw(hi)
dh.ellipse([int(S * 0.08), -int(S * 0.38), int(S * 0.96), int(S * 0.36)], fill=255)
hi = hi.filter(ImageFilter.GaussianBlur(40))
hi = ImageChops.multiply(hi, mask)  # 裁进圆角
white = Image.new('RGBA', (S, S), (255, 255, 255, 0))
white.putalpha(hi.point(lambda a: int(a * 0.30)))
img = Image.alpha_composite(img, white)

# ---- 闪电（标准 256 坐标缩放）----
bolt256 = [(148, 24), (84, 140), (124, 140), (104, 232), (180, 116), (136, 116), (168, 24)]
bolt = [(int(x / 256 * S), int(y / 256 * S)) for x, y in bolt256]

# 投影
sh = Image.new('RGBA', (S, S), (0, 0, 0, 0))
dsh = ImageDraw.Draw(sh)
dsh.polygon([(x, y + 14) for x, y in bolt], fill=(10, 20, 60, 110))
sh = sh.filter(ImageFilter.GaussianBlur(16))
img = Image.alpha_composite(img, sh)

# 本体：白色带一点冷调
bolt_layer = Image.new('RGBA', (S, S), (0, 0, 0, 0))
db = ImageDraw.Draw(bolt_layer)
db.polygon(bolt, fill=(250, 252, 255, 255))
# 闪电内部小高光
db.polygon([(int(S * 0.560), int(S * 0.115)), (int(S * 0.355), int(S * 0.50)),
            (int(S * 0.430), int(S * 0.50)), (int(S * 0.500), int(S * 0.115))],
           fill=(255, 255, 255, 70))
img = Image.alpha_composite(img, bolt_layer)

# ---- 最终按圆角裁剪 alpha ----
img.putalpha(ImageChops.multiply(img.getchannel('A'), mask))

# ---- 输出 ----
icon_png = os.path.join(OUT, 'icon.png')
img.resize((256, 256), Image.LANCZOS).save(icon_png)
sizes = [(256, 256), (128, 128), (96, 96), (64, 64), (48, 48), (40, 40), (32, 32), (24, 24), (16, 16)]
img.save(os.path.join(OUT, 'icon.ico'), sizes=sizes)
print('icon.ico + icon.png ->', OUT)
