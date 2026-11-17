// Compare les fichiers partagés (applications/commun/) à leur version sur la branche main de l'application Odin, et les
// copies de la connexion unique à commun/odin-sso.mjs. Ne modifie rien. Code de sortie 1 s'il y a un écart.
//   git fetch origin main && node applications/commun/verifier.mjs [référence, par défaut origin/main]
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ici = dirname(fileURLToPath(import.meta.url));
const applis = join(ici, '..');
const ref = process.argv[2] || 'origin/main';

/** Fichier d'ici → chemin sur main. */
const ORIGINES = {
  'plume.js': 'src/web/plume.js',
  'plume.css': 'src/web/plume.css',
  'app-icons.js': 'src/web/app-icons.js',
  'names.ts': 'src/valhalla/names.ts',
  'odin-sso.mjs': 'clients/odin-sso.mjs',
};
/** Copies qui doivent être identiques à un fichier d'ici. */
const COPIES = {
  'pegase/src/main/odin-sso.mjs': 'odin-sso.mjs',
  'agora-poste/src/main/odin-sso.mjs': 'odin-sso.mjs',
};

let ecarts = 0;
const dire = (ok, texte) => { if (!ok) ecarts++; console.log(`${ok ? 'à jour  ' : 'ÉCART   '} ${texte}`); };

for (const [ici_, origine] of Object.entries(ORIGINES)) {
  let distant;
  try { distant = execFileSync('git', ['show', `${ref}:${origine}`], { cwd: applis, maxBuffer: 64 * 1024 * 1024 }); }
  catch { dire(false, `${ici_} : impossible de lire ${ref}:${origine} (faire « git fetch origin main » d'abord)`); continue; }
  dire(Buffer.compare(distant, readFileSync(join(ici, ici_))) === 0, `${ici_} ↔ ${ref}:${origine}`);
}
for (const [copie, ref_] of Object.entries(COPIES)) {
  dire(Buffer.compare(readFileSync(join(applis, copie)), readFileSync(join(ici, ref_))) === 0, `${copie} ↔ commun/${ref_}`);
}
console.log(ecarts ? `${ecarts} écart(s) : recopier depuis main, mettre ORIGINE.md à jour, refabriquer.` : 'Tout est à jour.');
process.exit(ecarts ? 1 : 0);
