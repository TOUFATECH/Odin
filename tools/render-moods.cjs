// Rend un autocollant Telegram (WEBP 512×512, fond transparent) par humeur, à partir du même
// visage que le site et l'interface. Usage : node tools/render-moods.cjs  (Playwright requis)
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const root = path.resolve(__dirname, '..');
const svg = fs.readFileSync(path.join(root, 'tools/site/parts/mascot.svg'), 'utf8');
const face = fs.readFileSync(path.join(root, 'src/web/face.js'), 'utf8');
const out = path.join(root, 'src/mood/stickers');
(async () => {
  const b = await chromium.launch();
  const p = await (await b.newContext({ viewport: { width: 600, height: 600 }, deviceScaleFactor: 1 })).newPage();
  await p.setContent(`<html><body style="margin:0;background:transparent"><style>*{animation:none!important;transition:none!important}.mood-emoji{display:none}</style><span class="odin" style="display:block;width:512px;height:512px">${svg}</span><script>${face}</script></body></html>`);
  const moods = await p.evaluate(() => Object.keys(window.OdinFace.MOODS));
  const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'odin-moods-'));
  for (const m of moods) {
    await p.evaluate((m) => window.OdinFace.set(document.querySelector('.odin'), m), m);
    await p.locator('.odin').screenshot({ path: path.join(tmp, `${m}.png`), omitBackground: true });
  }
  await b.close();
  execFileSync('python3', ['-c', `import sys,glob,os
from PIL import Image
src,dst=sys.argv[1],sys.argv[2]
for f in glob.glob(os.path.join(src,'*.png')):
    im=Image.open(f).convert('RGBA').resize((512,512),Image.LANCZOS)
    im.save(os.path.join(dst,os.path.basename(f)[:-4]+'.webp'),'WEBP',quality=88,method=6)`, tmp, out]);
  console.log(`${moods.length} autocollants dans ${path.relative(root, out)}`);
})();
