"""Draw the Lantern app icon (a warm paper lantern) and save build/icon.ico + icon.png."""
import os, math
from PIL import Image, ImageDraw, ImageFilter

os.chdir(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.makedirs('build', exist_ok=True)

S = 1024
img = Image.new('RGBA', (S, S), (0, 0, 0, 0))
d = ImageDraw.Draw(img)

# Rounded-square background in the app's warm dark tone.
pad = 70
d.rounded_rectangle([pad, pad, S - pad, S - pad], radius=190, fill=(26, 20, 15, 255))

cx = S // 2
# Soft glow behind the lantern.
glow = Image.new('RGBA', (S, S), (0, 0, 0, 0))
gd = ImageDraw.Draw(glow)
gd.ellipse([cx - 300, 300, cx + 300, 820], fill=(232, 169, 75, 150))
glow = glow.filter(ImageFilter.GaussianBlur(90))
img.alpha_composite(glow)

# Top cap and finial.
d.rounded_rectangle([cx - 110, 250, cx + 110, 310], radius=20, fill=(201, 120, 46, 255))
d.rectangle([cx - 18, 210, cx + 18, 260], fill=(201, 120, 46, 255))
d.ellipse([cx - 34, 182, cx + 34, 240], fill=(224, 178, 74, 255))

# Lantern body: a vertical gradient from amber to deep orange-red, clipped to a rounded barrel.
top, bot = 300, 740
body = Image.new('RGBA', (S, S), (0, 0, 0, 0))
bd = ImageDraw.Draw(body)
for y in range(top, bot):
    t = (y - top) / (bot - top)
    # width bulges in the middle (barrel shape)
    bulge = math.sin(t * math.pi)
    half = 150 + 160 * bulge
    r = int(232 + (199 - 232) * t)
    g = int(169 + (60 - 169) * t)
    b = int(75 + (40 - 75) * t)
    bd.line([(cx - half, y), (cx + half, y)], fill=(r, g, b, 255))
# round the barrel ends by masking
mask = Image.new('L', (S, S), 0)
md = ImageDraw.Draw(mask)
md.rounded_rectangle([cx - 320, top, cx + 320, bot], radius=130, fill=255)
body.putalpha(Image.composite(body.getchannel('A'), Image.new('L', (S, S), 0), mask))
img.alpha_composite(body)

# Horizontal ribs.
for yy in (372, 452, 532, 612, 672):
    half = 150 + 160 * math.sin((yy - top) / (bot - top) * math.pi)
    d.line([(cx - half + 8, yy), (cx + half - 8, yy)], fill=(120, 40, 30, 110), width=8)

# Bottom cap and tassel.
d.rounded_rectangle([cx - 90, 735, cx + 90, 790], radius=18, fill=(201, 120, 46, 255))
d.rectangle([cx - 10, 790, cx + 10, 850], fill=(224, 178, 74, 255))
d.ellipse([cx - 26, 838, cx + 26, 890], fill=(224, 178, 74, 255))

img.save('build/icon.png')
img.save('build/icon.ico', sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
print('wrote build/icon.png and build/icon.ico')
