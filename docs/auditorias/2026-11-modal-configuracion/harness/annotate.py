# Señala en rojo y numera los defectos en las capturas «antes» de la reevaluación (390 × 844).
import sys, os
from PIL import Image, ImageDraw, ImageFont
SRC, OUT = sys.argv[1], sys.argv[2]
RED = (229, 72, 77)
MARKS = {
  'R01-a-casilla-44px-preferencias.png': [(14, 639, 70, 695)],
  'R01-b-casillas-44px-ia.png': [(12, 364, 66, 418), (12, 594, 66, 645)],
  'R02-segmentado-partido-usuarios.png': [(12, 318, 378, 401)],
  'R03-espaciado-mi-perfil.png': [(10, 424, 380, 484), (10, 686, 380, 746), (10, 756, 310, 799)],
  'R04-roles-editar-muerto.png': [(10, 433, 64, 458), (10, 619, 64, 644), (10, 784, 64, 809)],
  'R05-paginador-y-registro-auditoria.png': [(12, 272, 72, 328), (10, 436, 380, 466), (100, 726, 380, 832)],
}
try:
    font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 12)
except Exception:
    font = ImageFont.load_default()
for name, rects in MARKS.items():
    im = Image.open(os.path.join(SRC, name)).convert('RGB')
    scale = 2
    im = im.resize((im.width * scale, im.height * scale), Image.LANCZOS)
    d = ImageDraw.Draw(im)
    for i, (x1, y1, x2, y2) in enumerate(rects, 1):
        x1, y1, x2, y2 = [v * scale for v in (x1, y1, x2, y2)]
        d.rectangle((x1, y1, x2, y2), outline=RED, width=5)
        bx, by = max(0, x1 - 16), max(0, y1 - 16)
        d.ellipse((bx, by, bx + 32, by + 32), fill=RED, outline=(255, 255, 255), width=3)
        f = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 18) if os.path.exists('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf') else font
        tw = d.textlength(str(i), font=f)
        d.text((bx + 16 - tw / 2, by + 6), str(i), fill=(255, 255, 255), font=f)
    im.save(os.path.join(OUT, name), optimize=True)
    print('marked', name)
