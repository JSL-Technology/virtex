// Recorta capturas al área de contenido de la modal (sin la barra lateral) para revisión.
// Uso: node crop.js <dir> <archivo...>   (o --all)
const path = require('path');
const sharp = require(path.join(__dirname, '../../../../node_modules/sharp'));
const fs = require('fs');
const [dir, ...files] = process.argv.slice(2);
const src = path.join(__dirname, '..', 'salida', 'shots', dir);
const dst = path.join(__dirname, '..', 'salida', 'shots', dir + '-crop');
fs.mkdirSync(dst, { recursive: true });
const list = files[0] === '--all' ? fs.readdirSync(src).filter((f) => f.endsWith('.png')) : files;
(async () => {
  for (const f of list) {
    const img = sharp(path.join(src, f));
    const meta = await img.metadata();
    const k = meta.width / 1440;
    await img.extract({ left: Math.round(305 * k), top: Math.round(78 * k), width: Math.round(1095 * k), height: Math.round(806 * k) })
      .resize({ width: 1095 }).png().toFile(path.join(dst, f));
  }
  console.log('ok', list.length);
})();
