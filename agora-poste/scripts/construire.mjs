// Construit Agora (processus principal, preload, interface) dans dist/ : TypeScript compilé, fichiers copiés.
// Les icônes (build/icones/*.png, build/icon.png) viennent de build/agora.svg, l'icône validée d'Agora
// (régénérées par : for t in 16 24 32 48 64 128 256 512; do rsvg-convert -w $t -h $t build/agora.svg -o build/icones/${t}x${t}.png; done).
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
copyFileSync(join(ici, 'build/icones/64x64.png'), join(ici, 'dist/ui/agora.png'));
console.log('Agora construit dans dist/');
