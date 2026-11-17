// Banc de rapidité : MAQUETTES de corrections, mesurées dans le banc seulement (le code d'Odin n'est pas modifié :
// les méthodes sont remplacées en mémoire, le temps d'une mesure, puis remises).
//
//   node --disable-warning=ExperimentalWarning test/rapidite/maquettes.ts
//
// M1. Écriture d'une note : le coffre oublie TOUTES les notes lues (Vault.invalidate vide `known`) et la consultation
//     suivante relit et réanalyse tout. Maquette : n'oublier que la note écrite (les autres sont revalidées par leur date
//     et leur taille, comme déjà au-delà de 3 s).
// M2. Recherche du coffre : chaque note candidate est re-découpée (`body.split(w)`) pour compter les occurrences.
//     Maquette : compter par indexOf successifs (même nombre, pas de tableau créé). Résultat comparé à l'original.

process.env.ODIN_ESSAI = '1';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { ecrireResultat, ms, stat, tableau } from './outils.ts';
import { remplir } from './remplir.ts';

const REQ = ['sauvegarde du serveur et disque de stockage', 'facture électricité fournisseur', 'projet boutique site internet', 'rendez-vous médecin mariam', 'budget épargne crédit maison', 'panne imprimante bureau réparation'];

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { Vault } = await import('../../src/brain/vault.ts');
  const { consultBrain } = await import('../../src/brain/contexte.ts');
  const { Mnemosyne } = await import('../../src/muninn/store.ts');
  const { liensDe } = await import('../../src/brain/liens-vivants.ts');
  const r = remplir({ souvenirs: 500, notes: 2000, liens: 20000, conversations: 0, messagesParConv: 0, vecteurs: 0, dim: 128 });
  const m = new Mnemosyne(join(r.home, 'odin.db'));
  const v = new Vault(join(r.home, 'cerveau')); const l = liensDe(m);
  const P = Vault.prototype as unknown as Record<string, unknown>;
  for (let i = 0; i < 3; i++) consultBrain({ vault: v, liens: l }, REQ[i]);

  // ---- M1
  const avant: number[] = [], apres: number[] = [];
  for (let i = 0; i < 8; i++) { v.write(`Journal/m1-a-${i}`, { type: 'journal' }, `# A ${i}\n\nligne`); const t = performance.now(); consultBrain({ vault: v, liens: l, souvenirs: [1] }, REQ[i % 6]); avant.push(performance.now() - t); }
  const invOrig = P.invalidate, writeOrig = P.write;
  P.invalidate = function (this: { cache?: unknown; idx?: unknown }) { this.cache = undefined; this.idx = undefined; }; // `known` gardé
  P.write = function (this: { known: Map<string, unknown>; root: string }, path: string, ...a: unknown[]) { const rel = (writeOrig as (...x: unknown[]) => string).call(this, path, ...a); this.known.delete(rel); return rel; };
  for (let i = 0; i < 8; i++) { v.write(`Journal/m1-b-${i}`, { type: 'journal' }, `# B ${i}\n\nligne`); const t = performance.now(); consultBrain({ vault: v, liens: l, souvenirs: [1] }, REQ[i % 6]); apres.push(performance.now() - t); }
  // Justesse : la note écrite est bien vue, avec son nouveau texte.
  v.write('Journal/m1-b-0', { type: 'journal' }, '# B 0\n\nTexte changé sauvegarde serveur.');
  const vue = v.find('Journal/m1-b-0')?.body.includes('Texte changé') === true;
  P.invalidate = invOrig; P.write = writeOrig;

  // ---- M2
  const lent: number[] = [], vite: number[] = [];
  for (let i = 0; i < 20; i++) { const t = performance.now(); v.search(REQ[i % 6].split(' ').join(' '), 30); lent.push(performance.now() - t); }
  const ref = REQ.map((q) => v.search(q, 30).map((x) => `${x.note.path}:${x.score.toFixed(3)}`).join('|'));
  const splitOrig = String.prototype.split;
  // La maquette : `body.split(w).length - 2` remplacé par un comptage par indexOf (seulement pour un mot simple).
  String.prototype.split = function (this: string, sep: unknown, lim?: number) {
    if (typeof sep === 'string' && sep.length >= 2 && lim === undefined && this.length > 200) { let n = 0; for (let i = this.indexOf(sep); i >= 0; i = this.indexOf(sep, i + sep.length)) n++; return { length: n + 1 } as unknown as string[]; }
    return (splitOrig as (s: unknown, l?: number) => string[]).call(this, sep, lim);
  } as typeof String.prototype.split;
  for (let i = 0; i < 20; i++) { const t = performance.now(); v.search(REQ[i % 6], 30); vite.push(performance.now() - t); }
  const ref2 = REQ.map((q) => v.search(q, 30).map((x) => `${x.note.path}:${x.score.toFixed(3)}`).join('|'));
  String.prototype.split = splitOrig;
  const identique = ref.every((x, i) => x === ref2[i]);

  const s = { m1: { avant: stat(avant), apres: stat(apres), noteEcriteVue: vue }, m2: { avant: stat(lent), apres: stat(vite), resultatsIdentiques: identique } };
  const texte = 'Maquettes (2 000 notes, 20 000 liens) :\n' + tableau(['maquette', 'avant (méd.)', 'avant 95e', 'après (méd.)', 'après 95e', 'justesse'], [
    ['M1 consultation après écriture d\'une note', ms(s.m1.avant.mediane), ms(s.m1.avant.p95), ms(s.m1.apres.mediane), ms(s.m1.apres.p95), vue ? 'note écrite relue : oui' : 'NON'],
    ['M2 recherche du coffre (comptage sans split)', ms(s.m2.avant.mediane), ms(s.m2.avant.p95), ms(s.m2.apres.mediane), ms(s.m2.apres.p95), identique ? 'mêmes notes, mêmes scores' : 'DIFFÉRENT'],
  ]) + '\n';
  ecrireResultat('maquettes', s, texte);
  console.log(texte);
  try { rmSync(r.home, { recursive: true, force: true }); } catch { /* */ }
  process.exit(0);
}
