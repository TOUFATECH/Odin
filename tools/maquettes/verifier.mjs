// Contrôle toutes les maquettes dans Chrome sans écran : sur téléphone, tablette et ordinateur, chaque vue et chaque
// onglet est ouvert ; rien ne doit dépasser en largeur, et boutons, onglets et champs doivent avoir la même hauteur.
//   node tools/maquettes/verifier.mjs [identifiant]
import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const dossier = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'docs', 'maquettes');
const chrome = process.env.CHROME || 'google-chrome';
let total = 0;
for (const f of readdirSync(dossier).filter((x) => x.endsWith('.html') && (!process.argv[2] || x === `${process.argv[2]}.html`))) {
  let dom = '';
  try { dom = execFileSync(chrome, ['--headless=new', '--no-sandbox', '--disable-gpu', '--window-size=1500,1200', '--virtual-time-budget=6000', '--dump-dom', `file://${join(dossier, f)}#controle`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 1 << 28 }); } catch (e) { console.log(`${f} : Chrome a échoué`); total++; continue; }
  const m = dom.match(/<pre id="controle">([\s\S]*?)<\/pre>/);
  if (!m) { console.log(`${f} : la page ne s'est pas dessinée (erreur de script ?)`); total++; continue; }
  const pb = JSON.parse(m[1].replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&amp;/g, '&').replace(/&quot;/g, '"'));
  total += pb.length;
  for (const p of pb.slice(0, 6)) console.log(`${f} : ${p}`);
  if (pb.length > 6) console.log(`${f} : … et ${pb.length - 6} autres`);
}
console.log(total ? `${total} problème(s).` : 'Tout est aligné : rien ne dépasse, mêmes hauteurs partout.');
process.exitCode = total ? 1 : 0;
