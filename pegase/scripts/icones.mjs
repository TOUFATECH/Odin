// Génère src/ui/odin-icones.json : l'icône (SVG autonome) et le nom affiché de chaque appli d'Odin,
// tirés tels quels de ../src/web/app-icons.js et ../src/valhalla/names.ts (lus, jamais modifiés).
// Lancé par « npm run build » ; le fichier produit n'est pas suivi par git.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const ici = dirname(fileURLToPath(import.meta.url));
const racine = join(ici, '..', '..');
const code = readFileSync(join(racine, 'src', 'web', 'app-icons.js'), 'utf8');
const fenetre = {};
vm.runInNewContext(code, { window: fenetre, Image: class {}, Map });
const icones = fenetre.OdinAppIcons;
if (!icones) throw new Error('app-icons.js ne définit plus window.OdinAppIcons');

const noms = {};
const textNoms = readFileSync(join(racine, 'src', 'valhalla', 'names.ts'), 'utf8');
const bloc = textNoms.slice(textNoms.indexOf('export const NAMES'), textNoms.indexOf('};', textNoms.indexOf('export const NAMES')));
for (const m of bloc.matchAll(/"([a-z0-9_-]+)":\s*"([^"]+)"/g)) noms[m[1]] = m[2];

const sortie = {};
for (const id of icones.ids()) sortie[id] = { nom: noms[id] || id, svg: icones.svg(id, noms[id] || id) };
writeFileSync(join(ici, '..', 'src', 'ui', 'odin-icones.json'), JSON.stringify(sortie));
console.log(`odin-icones.json : ${Object.keys(sortie).length} icônes`);
