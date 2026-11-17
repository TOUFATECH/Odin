// Syrinx — retrouver un son déjà entendu, et apprendre des corrections, sur place.
//   - par une PHRASE : les mots normalisés de la phrase contre les libellés français, les étiquettes, le résumé, l'ambiance
//     et le sujet de chaque analyse rangée (déchiffrés ici, en mémoire seulement). Un plongeur de texte audio n'est pas
//     branché dans ce lot : la recherche par phrase reste par les mots, et la page le dit ;
//   - par un SON : cosinus entre plongements (192 nombres) et vote par empreinte (codes partagés, même décalage) ;
//   - les CORRECTIONS avec un plongement deviennent des prototypes appris chez toi : le plus proche, au-dessus d'un
//     cosinus de 0,8, est montré « appris chez toi : <libellé> ».
// Rien n'est lu ailleurs que dans le dossier de Syrinx (jamais les doubles d'autres applis ni la mémoire audio d'Odin).
import type { AnalyseSon, EmpreinteSon } from '../../audio/contrat.ts';
import type { SensSon } from './ligne-de-temps.ts';
import { candidatsEmpreinte, lireContenu, lireCorrections, listerSons, plongementDe, type EnteteSon } from './magasin.ts';
import type { Oreille } from './bande-son.ts';

export const SEUIL_PROTOTYPE = 0.8;
const VIDES = new Set(['le', 'la', 'les', 'un', 'une', 'des', 'de', 'du', 'd', 'l', 'et', 'ou', 'a', 'au', 'aux', 'en', 'avec', 'sans', 'son', 'sons', 'ce', 'cette', 'qui', 'que', 'quoi', 'on', 'y', 'il', 'elle', 'trouve', 'retrouve', 'moi', 'mon', 'ma', 'mes', 'est', 'ou']);
/** Les mots utiles d'un texte : minuscules, sans accents, sans les petits mots. */
export function mots(t: string): string[] {
  return t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').split(/[^a-z0-9]+/).filter((m) => m.length > 1 && !VIDES.has(m));
}
/** Un mot ressemble à un autre (même racine de 5 lettres, ou l'un contient l'autre) : « aboiement » ~ « aboie ». */
const proche = (a: string, b: string) => a === b || (a.length >= 4 && b.length >= 4 && (a.startsWith(b.slice(0, 5)) || b.startsWith(a.slice(0, 5))));

/** Le sac de mots d'une analyse (libellés, étiquettes, résumé, ambiance, sujet ; jamais le texte d'une chanson). */
export function sacDeMots(a: AnalyseSon, sens?: SensSon): string[] {
  const t: string[] = [];
  if (a.sons.etat === 'fait') {
    for (const e of a.sons.etiquettes) if (e.p >= e.seuil) t.push(e.libelle, e.cle.replace(/[_-]/g, ' '));
    for (const m of a.sons.moments) t.push(m.libelle);
  }
  if (a.musique.probable) t.push('musique', a.musique.tonalite?.nom ?? '', a.musique.parties.some((p) => p.refrainProbable) ? 'refrain' : '');
  if (a.parole.etat === 'faite') t.push('parole voix', a.parole.langue ?? '');
  if (a.parole.sujet) t.push(a.parole.sujet);
  if (sens) t.push(sens.resume, sens.ambiance, ...sens.moments.map((m) => m.quoi));
  return [...new Set(mots(t.join(' ')))];
}

export interface Trouve { id: string; quand: string; sourceRef: string; score: number; pourquoi: string }

/** Retrouve par une phrase (mots), parmi les 2000 sons les plus récents. */
export function retrouverParPhrase(dir: string, home: string, phrase: string, n = 5): Trouve[] {
  const q = mots(phrase); if (!q.length) return [];
  const out: Trouve[] = [];
  for (const e of listerSons(dir).slice(0, 2000)) {
    const c = lireContenu(home, e); if (!c) continue;
    const sac = sacDeMots(c.analyse, c.sens);
    const vus = q.filter((m) => sac.some((s) => proche(m, s)));
    if (vus.length) out.push({ id: e.id, quand: e.quand, sourceRef: e.sourceRef, score: vus.length / q.length, pourquoi: `mots : ${vus.join(', ')}` });
  }
  return out.sort((a, b) => b.score - a.score || b.quand.localeCompare(a.quand)).slice(0, n);
}

/** Cosinus de deux vecteurs (0 si l'un est vide ou de taille différente). */
export function cosinus(a: ArrayLike<number>, b: ArrayLike<number>): number {
  if (!a.length || a.length !== b.length) return 0;
  let s = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { s += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return na && nb ? s / Math.sqrt(na * nb) : 0;
}

/** Retrouve par un son : plongement (cosinus) et empreinte (vote). `sauf` : un identifiant à ne pas compter. */
export function retrouverParSon(dir: string, home: string, q: { plongement?: ArrayLike<number>; empreinte?: EmpreinteSon }, voter?: Oreille['voterEmpreinte'], n = 5): Trouve[] {
  const parId = new Map<string, Trouve>(), entetes = new Map<string, EnteteSon>(listerSons(dir).map((e) => [e.id, e]));
  if (q.empreinte?.codes.length && voter) {
    for (const v of voter(q.empreinte, candidatsEmpreinte(dir, q.empreinte))) {
      const e = entetes.get(v.id); if (!e || v.score <= 0) continue;
      parId.set(v.id, { id: v.id, quand: e.quand, sourceRef: e.sourceRef, score: v.meme ? 1 : Math.min(0.99, v.score), pourquoi: v.meme ? `même son (empreinte, décalage ${v.decalageS.toFixed(1)} s)` : `empreinte proche (${Math.round(v.score * 100)} %)` });
    }
  }
  if (q.plongement?.length) {
    for (const e of listerSons(dir).slice(0, 2000)) {
      const p = plongementDe(dir, home, e); if (!p?.length) continue;
      const cos = cosinus(q.plongement, p); if (cos < 0.5) continue;
      const deja = parId.get(e.id);
      if (!deja || deja.score < cos) parId.set(e.id, { id: e.id, quand: e.quand, sourceRef: e.sourceRef, score: cos, pourquoi: `ressemblance du son ${Math.round(cos * 100)} %${deja ? ` ; ${deja.pourquoi}` : ''}` });
    }
  }
  return [...parId.values()].sort((a, b) => b.score - a.score).slice(0, n);
}

/** Les prototypes appris des corrections : un vecteur moyen (normalisé) par libellé. */
export function prototypes(dir: string, home: string): Array<{ libelle: string; vecteur: number[]; n: number }> {
  const parLib = new Map<string, { s: number[]; n: number }>();
  for (const c of lireCorrections(dir, home)) {
    const p = c.plongement; if (!p?.length) continue;
    const norme = Math.sqrt(p.reduce((s, x) => s + x * x, 0)) || 1;
    const g = parLib.get(c.libelle) ?? { s: new Array(p.length).fill(0), n: 0 };
    if (g.s.length !== p.length) continue;
    for (let i = 0; i < p.length; i++) g.s[i] += p[i] / norme;
    g.n++; parLib.set(c.libelle, g);
  }
  return [...parLib].map(([libelle, g]) => ({ libelle, vecteur: g.s.map((x) => x / g.n), n: g.n }));
}
/** Le prototype appris le plus proche d'un plongement, s'il dépasse le seuil de cosinus (0,8). */
export function prototypeProche(dir: string, home: string, plongement?: ArrayLike<number>): { libelle: string; cos: number; n: number } | undefined {
  if (!plongement?.length) return undefined;
  let best: { libelle: string; cos: number; n: number } | undefined;
  for (const p of prototypes(dir, home)) { const cos = cosinus(plongement, p.vecteur); if (cos >= SEUIL_PROTOTYPE && (!best || cos > best.cos)) best = { libelle: p.libelle, cos, n: p.n }; }
  return best;
}
