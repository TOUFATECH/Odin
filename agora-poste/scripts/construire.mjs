// Construit Agora (processus principal, preload, interface) dans dist/ : TypeScript compilé, fichiers copiés.
// Les icônes (build/icones/*.png, build/icon.png) viennent de build/agora.svg, l'icône validée d'Agora
// (régénérées par : for t in 16 24 32 48 64 128 256 512; do rsvg-convert -w $t -h $t build/agora.svg -o build/icones/${t}x${t}.png; done ;
// rsvg-convert -w 1024 -h 1024 build/agora.svg -o build/icon.png ; et pour Windows, le .ico multi-tailles intégré au .exe et à
// l'installateur : convert build/icones/{16x16,24x24,32x32,48x48,64x64,128x128,256x256}.png build/icon.ico).
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ici = join(dirname(fileURLToPath(import.meta.url)), '..'), require = createRequire(import.meta.url);
const tsc = require.resolve('typescript/bin/tsc');
rmSync(join(ici, 'dist'), { recursive: true, force: true });
execFileSync(process.execPath, [tsc, '-p', join(ici, 'tsconfig.main.json')], { stdio: 'inherit' });
execFileSync(process.execPath, [tsc, '-p', join(ici, 'tsconfig.ui.json')], { stdio: 'inherit' });
copyFileSync(join(ici, 'src/main/odin-sso.mjs'), join(ici, 'dist/main/odin-sso.mjs'));
mkdirSync(join(ici, 'dist/ui'), { recursive: true });
for (const f of ['index.html', 'style.css']) copyFileSync(join(ici, 'src/ui', f), join(ici, 'dist/ui', f));
// Icônes de la fenêtre et de la zone de notification (le .ico sous Windows), et le logo des écrans d'accueil.
copyFileSync(join(ici, 'build/icones/64x64.png'), join(ici, 'dist/ui/agora.png'));
copyFileSync(join(ici, 'build/icones/256x256.png'), join(ici, 'dist/ui/agora-256.png'));
copyFileSync(join(ici, 'build/icon.ico'), join(ici, 'dist/ui/agora.ico'));
console.log('Agora construit dans dist/');
