// Banc de rapidité : lance tout, l'un après l'autre (jamais en parallèle : les mesures se gêneraient), chacun dans son
// propre processus (les caches d'un banc ne faussent pas le suivant).
//
//   node --disable-warning=ExperimentalWarning test/rapidite/tout.ts [--court]
//
// Résultats : JSON et texte dans file-attente/rapidite (ou le dossier RAPIDITE_SORTIE). Durée : ~15 min complet,
// ~3 min avec --court. Aucun dossier réel d'Odin n'est touché ; aucune requête ne part vers Internet.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SORTIE } from './outils.ts';

const court = process.argv.includes('--court');
const ici = fileURLToPath(new URL('.', import.meta.url));
const racine = fileURLToPath(new URL('../..', import.meta.url));
const bancs: Array<[string, string[]]> = [
  ['chemin.ts', court ? ['tout', '--court'] : ['tout']],
  ['memoire.ts', court ? ['--court'] : []],
  ['web.ts', court ? ['--court'] : []],
  ['maquettes.ts', []],
  ['lectures.ts', ['gros']],
];
let resume = '';
for (const [f, args] of bancs) {
  const t0 = Date.now();
  process.stdout.write(`→ ${f} ${args.join(' ')}\n`);
  try {
    execFileSync(process.execPath, ['--disable-warning=ExperimentalWarning', join(ici, f), ...args], { cwd: racine, stdio: ['ignore', 'inherit', 'inherit'], timeout: 40 * 60_000 });
    resume += `${f} : fini en ${Math.round((Date.now() - t0) / 1000)} s\n`;
  } catch (e) { resume += `${f} : ÉCHEC (${(e as Error).message.slice(0, 200)})\n`; }
}
const nom = (b: string) => `${b}${court && !/maquettes|lectures/.test(b) ? '-court' : ''}`;
for (const b of ['chemin-tout', 'memoire', 'web', 'maquettes', 'lectures-gros']) { try { resume += `\n${readFileSync(join(SORTIE, `${nom(b)}.txt`), 'utf8')}`; } catch { /* banc en échec */ } }
process.stdout.write(`\n${resume}\nRésultats dans ${SORTIE}\n`);
