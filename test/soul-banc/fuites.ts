// Banc de Soul : le contrôle de NON-CONTAMINATION d'un jeu de mesure. Une demande du banc ne doit ressembler à
// aucune phrase que Soul (ou les méthodes sans réseau) a pu apprendre ou indexer : sinon on mesure le par-cœur.
//
// Trois degrés de ressemblance, du plus fort au plus faible :
//   - exacte     : la même phrase, caractère pour caractère (espaces du bord retirés) ;
//   - normalisee : la même après normalisation (minuscules, sans accents, sans ponctuation, espaces simples) ;
//   - quasi      : indice de Jaccard des trigrammes de caractères (sur la forme normalisée) d'au moins 0,8.
//
// Sources d'apprentissage lues (toutes celles du dépôt) :
//   - src/brain/nous/corpus-depart.ts (DEMANDES_EXEMPLES), demandes-langues.ts (DEMANDES_LANGUES), demandes-v2.ts (DEMANDES_V2) ;
//   - les tournures de src/langue/langues/*.json (toutes les chaînes du fichier) ;
//   - les mots, libellés, descriptions et exemples des modules (allModules, examples de huginn.ts, avec les mots des langues),
//     plus les usages et le survol des applis (ils entrent aussi dans le corpus de départ) ;
//   - test/entrainement/*.ts : lus comme TEXTE (chaînes et lignes « xx: a | b ») ; ils ne sont pas importés, car
//     certains lancent un entraînement à l'import.
// Et, entre eux, les jeux du banc (développement contre principal, et chaque jeu contre lui-même).
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Demande } from './mesure.ts';

export interface Source { texte: string; source: string }
export type Degre = 'exacte' | 'normalisee' | 'quasi';
export interface Fuite { id: string; phrase: string; degre: Degre; jaccard: number; source: string; texteSource: string; autres: number }

const RACINE = fileURLToPath(new URL('../../', import.meta.url));

// ------------------------------------------------------------------------------------------------ fonctions pures
/** Minuscules, sans accents (les écritures sans accents gardent leurs caractères entiers), sans ponctuation. */
export function normaliser(t: string): string {
  return t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').normalize('NFC').replace(/[^\p{L}\p{N}\p{M}]+/gu, ' ').replace(/\s+/g, ' ').trim();
}
/** Les trigrammes de caractères de la forme normalisée (bordée d'une espace de chaque côté). */
export function trigrammes(t: string): Set<string> {
  const c = [...` ${normaliser(t)} `], out = new Set<string>();
  if (c.length < 3) { out.add(c.join('')); return out; }
  for (let i = 0; i + 2 < c.length; i++) out.add(c[i] + c[i + 1] + c[i + 2]);
  return out;
}
export function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size && !b.size) return 1;
  let inter = 0; for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

/** Un index de sources pour chercher vite les quasi-doublons (index inversé des trigrammes). */
export class Index {
  private textes: Source[] = [];
  private tris: Set<string>[] = [];
  private exact = new Map<string, number>();
  private norm = new Map<string, number>();
  private inv = new Map<string, number[]>();
  constructor(sources: Source[]) {
    for (const s of sources) {
      const t = s.texte.trim(); if (!t) continue;
      const n = normaliser(t); if (!n) continue;
      const i = this.textes.length;
      this.textes.push({ texte: t, source: s.source });
      const tri = trigrammes(t); this.tris.push(tri);
      if (!this.exact.has(t)) this.exact.set(t, i);
      if (!this.norm.has(n)) this.norm.set(n, i);
      for (const g of tri) { let l = this.inv.get(g); if (!l) this.inv.set(g, l = []); l.push(i); }
    }
  }
  get taille(): number { return this.textes.length; }
  /** La ressemblance la plus forte avec une source, et le nombre de sources qui ressemblent (au seuil). */
  chercher(phrase: string, seuil = 0.8, ignorer?: (s: Source) => boolean): { degre: Degre; jaccard: number; src: Source; autres: number } | undefined {
    const t = phrase.trim(), n = normaliser(t);
    const ok = (i: number | undefined) => i !== undefined && !(ignorer?.(this.textes[i]));
    const A = trigrammes(t), communs = new Map<number, number>();
    for (const g of A) for (const i of this.inv.get(g) ?? []) communs.set(i, (communs.get(i) ?? 0) + 1);
    let best: { i: number; j: number } | undefined, autres = 0;
    for (const [i, inter] of communs) {
      if (ignorer?.(this.textes[i])) continue;
      const j = inter / (A.size + this.tris[i].size - inter);
      if (j >= seuil) { autres++; if (!best || j > best.j) best = { i, j }; }
    }
    const e = this.exact.get(t);
    if (ok(e)) return { degre: 'exacte', jaccard: 1, src: this.textes[e!], autres };
    const m = this.norm.get(n);
    if (ok(m)) return { degre: 'normalisee', jaccard: jaccard(A, this.tris[m!]), src: this.textes[m!], autres };
    // Une égalité exacte ou normalisée cachée par un doublon ignoré : on la retrouve parmi les candidats.
    if (best) {
      const s = this.textes[best.i];
      const degre: Degre = s.texte === t ? 'exacte' : normaliser(s.texte) === n ? 'normalisee' : 'quasi';
      return { degre, jaccard: best.j, src: s, autres };
    }
    return undefined;
  }
}

/** Les demandes d'un jeu qui ressemblent à une source (une ligne par demande fautive, la ressemblance la plus forte). */
export function fuitesContre(demandes: Demande[], index: Index, seuil = 0.8, ignorer?: (d: Demande, s: Source) => boolean): Fuite[] {
  const out: Fuite[] = [];
  for (const d of demandes) {
    const r = index.chercher(d.phrase, seuil, ignorer ? (s) => ignorer(d, s) : undefined);
    if (r) out.push({ id: d.id, phrase: d.phrase, degre: r.degre, jaccard: Math.round(r.jaccard * 1000) / 1000, source: r.src.source, texteSource: r.src.texte, autres: r.autres });
  }
  return out;
}
/** Doublons à l'intérieur d'un même jeu (chaque paire n'est donnée qu'une fois, du second vers le premier). */
export function doublonsInternes(demandes: Demande[], seuil = 0.8): Fuite[] {
  const idx = new Index(demandes.map((d) => ({ texte: d.phrase, source: `#${d.id}` })));
  const rang = new Map(demandes.map((d, i) => [`#${d.id}`, i]));
  return fuitesContre(demandes, idx, seuil, (d, s) => (rang.get(s.source) ?? -1) >= (rang.get(`#${d.id}`) ?? 0));
}
export function resume(f: Fuite[]): Record<Degre, number> & { total: number } {
  return { total: f.length, exacte: f.filter((x) => x.degre === 'exacte').length, normalisee: f.filter((x) => x.degre === 'normalisee').length, quasi: f.filter((x) => x.degre === 'quasi').length };
}

// ------------------------------------------------------------------------------------------------ lecture des sources
/** Chaînes d'un fichier TypeScript lu comme texte : littéraux '…' et "…", lignes de gabarits `…` (format « xx: a | b »). */
export function chainesDuTexte(code: string): string[] {
  const out: string[] = [];
  // Les gabarits d'abord (ils contiennent des apostrophes) ; on les retire avant de chercher les autres littéraux.
  const sansGabarits = code.replace(/`((?:[^`\\]|\\.)*)`/gs, (_t, corps: string) => {
    for (const brut of corps.split('\n')) {
      const l = brut.trim(); if (!l || l.startsWith('#') || /^[a-z0-9_]+\.[a-z0-9_]+$/.test(l) || l.includes('${')) continue;
      const m = /^([a-z]{2,3})\??:\s*(.+)$/.exec(l);
      if (m) out.push(...m[2].split('|').map((x) => x.trim()).filter(Boolean)); else out.push(l);
    }
    return '``';
  });
  for (const brut of sansGabarits.split('\n')) {
    const l = brut.replace(/^\s*(\/\/|\*|\/\*).*$/, ''); // lignes de commentaire
    for (const m of l.matchAll(/'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"/g)) {
      const s = (m[1] ?? m[2] ?? '').replace(/\\(.)/g, '$1');
      if (s.trim()) out.push(s);
    }
  }
  return out.filter((s) => /\p{L}/u.test(s) && normaliser(s).length >= 3);
}
function chainesJson(x: unknown, out: string[] = []): string[] {
  if (typeof x === 'string') out.push(x);
  else if (Array.isArray(x)) for (const y of x) chainesJson(y, out);
  else if (x && typeof x === 'object') for (const [k, v] of Object.entries(x)) { out.push(k); chainesJson(v, out); }
  return out;
}

/** Toutes les sources d'apprentissage du dépôt (le produit est importé : appeler après environnementBanc). */
export async function sourcesApprentissage(mods: Array<import('../../src/valhalla/types.ts').Module>): Promise<{ sources: Source[]; parFamille: Record<string, number> }> {
  const sources: Source[] = [], parFamille: Record<string, number> = {};
  const ajouter = (famille: string, texte: unknown, detail = '') => {
    if (typeof texte !== 'string' || !texte.trim()) return;
    sources.push({ texte, source: detail ? `${famille} (${detail})` : famille }); parFamille[famille] = (parFamille[famille] ?? 0) + 1;
  };
  const { DEMANDES_EXEMPLES } = await import('../../src/brain/nous/corpus-depart.ts');
  for (const d of DEMANDES_EXEMPLES) ajouter('corpus-depart.ts', d.demande, d.module);
  const { DEMANDES_LANGUES } = await import('../../src/brain/nous/demandes-langues.ts');
  for (const d of DEMANDES_LANGUES) ajouter('demandes-langues.ts', d.demande, `${d.module}, ${d.langue}`);
  const { DEMANDES_V2 } = await import('../../src/brain/nous/demandes-v2.ts');
  for (const d of DEMANDES_V2) ajouter('demandes-v2.ts', d.demande, `${d.module}.${d.action}, ${d.langue}`);
  const dl = join(RACINE, 'src', 'langue', 'langues');
  for (const f of readdirSync(dl).filter((x) => x.endsWith('.json')).sort()) for (const s of chainesJson(JSON.parse(readFileSync(join(dl, f), 'utf8')))) ajouter(`langues/${f}`, s);
  const { examples, avecLangues } = await import('../../src/valhalla/huginn.ts');
  for (const m0 of mods) {
    const m = avecLangues(m0);
    for (const w of [m.name, m.what, ...(m.does ?? []), ...(m.words ?? []), ...(m.modes ?? [])]) ajouter('modules', w, m.id);
    for (const a of m.actions) for (const w of [a.label, a.what, ...(a.words ?? [])]) ajouter('modules', w, `${m.id}.${a.id}`);
    try { for (const e of examples(m0)) ajouter('modules:exemples', e, m.id); } catch { /* une appli sans exemples */ }
  }
  const { USAGES } = await import('../../src/valhalla/links.ts');
  for (const u of USAGES) ajouter('links.ts:usages', u.need);
  const { SURVOL } = await import('../../src/valhalla/survol.ts');
  for (const [id, x] of Object.entries(SURVOL as Record<string, { phrase?: string; faire?: string[] }>)) for (const s of [x.phrase, ...(x.faire ?? [])]) ajouter('survol.ts', s, id);
  const de = join(RACINE, 'test', 'entrainement');
  for (const f of readdirSync(de).filter((x) => x.endsWith('.ts')).sort()) for (const s of chainesDuTexte(readFileSync(join(de, f), 'utf8'))) ajouter(`test/entrainement/${f}`, s);
  return { sources, parFamille };
}
