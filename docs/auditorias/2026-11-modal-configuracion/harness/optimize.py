# Reduce el peso de las capturas: paleta adaptativa de 256 colores sin tramado (texto nítido).
import sys, os
from PIL import Image
for path in sys.argv[1:]:
    before = os.path.getsize(path)
    im = Image.open(path).convert('RGB')
    q = im.quantize(colors=256, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
    tmp = path + '.tmp.png'
    q.save(tmp, optimize=True)
    after = os.path.getsize(tmp)
    if after < before * 0.9:
        os.replace(tmp, path)
    else:
        os.remove(tmp)
        after = before
    print(f'{os.path.basename(path)}: {before//1024} KB -> {after//1024} KB')
