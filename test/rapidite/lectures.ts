// Banc de rapidité : QUI lit quoi pendant un tour (lectures de fichier longues ou répétées, avec la pile d'appel).
//
//   node --disable-warning=ExperimentalWarning test/rapidite/lectures.ts [gros|petit]
//
// Enveloppe readFileSync et networkInterfaces le temps de quelques tours espacés ; rend, par appelant, le nombre
// d'appels et le temps cumulé. Sert à trouver ce qui relit un fichier ou interroge le système à chaque message.

process.env.ODIN_ESSAI = '1';
process.env.ODIN_NO_VOICE_INSTALL = '1';
process.env.ODIN_NO_LOCAL_BRAIN = '1';

import fs from 'node:fs';
import os from 'node:os';
import { syncBuiltinESMExports } from 'node:module';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { ecrireResultat, tableau } from './outils.ts';
import { GROS, PETIT, remplir } from './remplir.ts';
import { monter } from './chemin.ts';

const parAppelant = new Map<string, { n: number; ms: number; octets: number }>();
let actif = false;
function appelant(): string {
  const pile = (new Error().stack ?? '').split('\n').slice(3).map((l) => l.trim()).filter((l) => /[\\/]src[\\/]/.test(l) && !/rapidite/.test(l));
  return pile.slice(0, 2).map((l) => l.replace(/^at /, '').replace(/\(?file:\/\/\/.*?[\\/]src[\\/]/, 'src/').replace(/\)$/, '')).join(' ← ') || '(hors src)';
}
function envelopper(obj: Record<string, unknown>, nom: string): void {
  const f = obj[nom] as (...a: unknown[]) => unknown;
  obj[nom] = function (this: unknown, ...a: unknown[]) {
    if (!actif) return f.apply(this, a);
    const t = performance.now(); const r = f.apply(this, a); const d = performance.now() - t;
    const k = `${nom} · ${appelant()}`; const e = parAppelant.get(k) ?? { n: 0, ms: 0, octets: 0 };
    e.n++; e.ms += d; e.octets += typeof r === 'string' ? r.length : Buffer.isBuffer(r) ? r.length : 0; parAppelant.set(k, e);
    return r;
  };
}
envelopper(fs as unknown as Record<string, unknown>, 'readFileSync');
envelopper(fs as unknown as Record<string, unknown>, 'statSync');
envelopper(os as unknown as Record<string, unknown>, 'networkInterfaces');
syncBuiltinESMExports();

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const quoi = process.argv[2] === 'gros' ? 'gros' : 'petit';
  const r = remplir(quoi === 'gros' ? GROS : PETIT);
  const od = await monter(r.home);
  await od.dire('Bonjour, prépare-toi.'); await od.dire('Qu\'est-ce que j\'avais noté sur la sauvegarde du serveur ?');
  const N = 6;
  for (let i = 0; i < N; i++) {
    await new Promise((x) => setTimeout(x, 3100));
    actif = true; await od.dire(['Rappelle-moi la facture d\'électricité.', 'Où en est le projet de la boutique ?', 'Que faire pour la panne de l\'imprimante ?'][i % 3]);
    await new Promise((x) => setTimeout(x, 300)); actif = false; // ce qui part juste après le tour (setImmediate) compte aussi
  }
  od.fermer();
  const lignes = [...parAppelant].map(([k, v]) => ({ k, n: v.n / N, ms: v.ms / N, ko: v.octets / N / 1024 })).sort((a, b) => b.ms - a.ms).slice(0, 25);
  const texte = `Lectures et appels système par tour (${quoi}, ${N} tours espacés, moyenne par tour) :\n` + tableau(['appel · appelant', 'appels/tour', 'ms/tour', 'Ko lus/tour'], lignes.map((l) => [l.k.slice(0, 150), Math.round(l.n * 10) / 10, Math.round(l.ms * 100) / 100, Math.round(l.ko)])) + '\n';
  ecrireResultat(`lectures-${quoi}`, lignes, texte);
  console.log(texte);
  process.exit(0);
}
