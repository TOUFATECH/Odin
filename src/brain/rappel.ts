// Le rappel par association, branché dans la consultation du Cerveau (contexte.ts) quand les liens vivants
// sont allumés. Les notes, applis, souvenirs et mots de la demande retenus sont les points de départ ;
// l'activation se propage le long des liens selon leur force (neurones.ts). Une note fiable très activée
// entre dans la réponse même sans mot commun (2 au plus), avec la raison lisible (« via »).
// Garde-fous : une note pas fiable (capture) n'entre jamais par association et n'a jamais d'extrait ; une
// note carrefour ou périmée non plus. Vers la carte (influx) : titres, identifiants et nombres seulement.

import type { AppFinder } from '../valhalla/besoin.ts';
import type { BrainContext } from './contexte.ts';
import type { LiensVivants } from './liens-vivants.ts';
import { deux, propager, R, type Origine } from './neurones.ts';
import type { Note, Vault } from './vault.ts';

/** Une entrée d'influx pour la carte (contrat E) : d'où part l'activation, où elle arrive, combien, par quel lien. */
export interface Influx { de: string; vers: string; deNom: string; versNom: string; a: number; saut: 0 | 1 | 2; f: number; o: Origine | 'odin'; entre: boolean }

const APPS_DIR = 'Odin/Applis/';
const HUB = (n: Note) => n.path.startsWith('Odin/') && !n.path.startsWith(APPS_DIR);
const pasFiable = (n: Note) => n.meta.type === 'capture' || n.meta.fiable === false;
const plie = (t: string) => t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
/** Note périmée : propriété perime/périmé à vrai, ou statut obsolète, abandonné, annulé, périmé. */
export const perimee = (n: Note) => n.meta.perime === true || n.meta['périmé'] === true || /^(obsolete|abandonnee?|annulee?|perimee?)$/.test(plie(String(n.meta.statut ?? '')).trim());
const virgule = (x: number) => x.toFixed(2).replace('.', ',');
const NATURE: Record<Origine, string> = { appris: 'lien appris', ecrit: 'lien écrit', usage: 'lien d\'usage' };

export function rappelParAssociation(p: {
  liens: LiensVivants; vault: Vault; apps?: AppFinder; out: BrainContext; words: string[]; limit: number;
  retenues: string[]; found: Note[]; scores: Map<string, number>; souvenirs: number[]; now: number;
  add: (n: Note, via: string) => void;
  step: (de: string, deNom: string, vers: string, versNom: string, libelle: string) => void;
  hits: (n: Note) => number;
}): void {
  const { out, now } = p;
  const vue = p.liens.voisinage(p.vault, p.apps);
  // Points de départ et leur activation.
  const depart = new Map<string, number>();
  const mettre = (id: string, a: number) => depart.set(id, Math.max(depart.get(id) ?? 0, Math.min(1, a)));
  const parNom = new Map<string, number>();
  for (const a of out.apps) { const a0 = Math.min(1, 0.4 + 0.1 * (p.scores.get(a.id) ?? 0)); parNom.set(a.name, a0); mettre(`a:${a.id}`, a0); }
  const rang = new Map(p.found.map((n, i) => [n.path, i]));
  for (const path of p.retenues) {
    const fiche = path.startsWith(APPS_DIR) ? parNom.get(vue.note(`n:${path}`)?.title ?? '') : undefined;
    const r = rang.get(path);
    mettre(`n:${path}`, fiche ?? (r !== undefined ? 0.4 + 0.6 / (1 + r) : 0.4));
  }
  for (const s of p.souvenirs) mettre(`s:${s}`, 0.6);
  for (const w of p.words) mettre(`m:${w}`, 0.6 / Math.sqrt(p.words.length));
  const res = propager(depart, (id) => vue.voisins(id, now), vue.info, (id) => vue.enRepos(id, now));

  // Règle (b) : rappel par association.
  const dans = new Set(out.notes.map((n) => n.path));
  const cands: Array<{ id: string; n: Note; de: string; score: number }> = [];
  for (const [id, x] of res) {
    if (!id.startsWith('n:') || x.saut === 0) continue;
    const n = vue.note(id); if (!n || dans.has(n.path) || pasFiable(n) || HUB(n) || perimee(n)) continue;
    const score = x.a + 0.15 * Math.min(2, p.hits(n));
    if (score >= R.SEUIL_AJOUT) cands.push({ id, n, de: x.de ?? '', score });
  }
  cands.sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const assoc = new Map<string, string>();
  for (const c of cands.slice(0, R.AJOUTS_MAX)) {
    if (out.notes.length >= p.limit) break;
    p.add(c.n, viaDe(c.de, c.id));
    if (!out.notes.some((n) => n.path === c.n.path)) continue;
    assoc.set(c.n.path, c.de);
    const carte = c.de ? vue.carte(c.de) : undefined;
    if (carte) p.step(carte, vue.nom(c.de), c.n.path, c.n.title, 'rappel par association');
    else p.step('odin', 'Odin', c.n.path, c.n.title, 'rappel par association');
  }

  // Freins : une note de la réponse que remplace ou contredit une note fiable (dans la réponse ou allumée) le dit
  // dans son « via » et passe juste après celle qui la remplace. Titres seulement ; jamais depuis une capture.
  const sources = [...new Set([...res.keys(), ...out.notes.map((n) => `n:${n.path}`)])].filter((id) => id.startsWith('n:')).sort();
  for (const src of sources) {
    const ns = vue.note(src); if (!ns || pasFiable(ns) || HUB(ns) || perimee(ns)) continue;
    for (const z of vue.freins(src)) {
      const i = out.notes.findIndex((n) => `n:${n.path}` === z.id); if (i < 0) continue;
      const h = out.notes[i];
      h.via += ` ; ${z.fr === 'remplace' ? 'remplacée' : 'contredite'} par [[${ns.title}]]`;
      const j = out.notes.findIndex((n) => n.path === ns.path);
      if (j > i) { out.notes.splice(i, 1); out.notes.splice(j, 0, h); }
    }
  }

  // Influx pour la carte.
  const notesIn = new Set(out.notes.map((n) => n.path)), appsIn = new Set(out.apps.map((a) => a.id));
  const influx: Influx[] = [];
  for (const [id, x] of res) {
    const vers = vue.carte(id); if (!vers) continue;
    const entre = id.startsWith('n:') ? notesIn.has(id.slice(2)) : appsIn.has(id.slice(2));
    const n = vue.note(id); if (n && pasFiable(n) && !entre) continue;
    let de = 'odin', deNom = 'Odin';
    const c = x.saut > 0 && x.de ? vue.carte(x.de) : undefined;
    if (c) { de = c; deNom = vue.nom(x.de!); }
    if (de === vers) continue;
    influx.push({ de, vers, deNom, versNom: vue.nom(id), a: deux(x.a), saut: Math.min(2, x.saut) as 0 | 1 | 2, f: x.saut > 0 ? deux(x.f ?? 0) : 0, o: x.saut > 0 ? x.o ?? 'appris' : 'odin', entre });
  }
  influx.sort((a, b) => a.saut - b.saut || b.a - a.a || (a.vers < b.vers ? -1 : a.vers > b.vers ? 1 : 0));
  if (influx.length) out.influx = influx.slice(0, 40);
  out.entres = out.notes.map((n) => (assoc.has(n.path)
    ? { id: `n:${n.path}`, par: 'association' as const, de: assoc.get(n.path) }
    : { id: `n:${n.path}`, par: n.via.startsWith('liée depuis') ? 'lien' as const : 'direct' as const }));
  // Au repos : seulement les points allumés par propagation (un point de départ transmet toujours pleinement).
  p.liens.reposer([...res].filter(([, x]) => x.saut > 0).map(([id]) => id), now);

  /** Pourquoi cette note remonte, en clair. */
  function viaDe(de: string, id: string): string {
    if (de.startsWith('n:')) { const l = vue.lien(de, id, now); return `rappelée par association depuis [[${vue.nom(de)}]] (${NATURE[l.o]}, force ${virgule(l.f)}${l.n ? `, utilisés ensemble ${l.n} fois` : ''})`; }
    if (de.startsWith('a:')) return `rappelée par association depuis l'appli ${vue.nom(de)}`;
    if (de.startsWith('s:')) return 'rappelée par association avec un souvenir';
    if (de.startsWith('m:')) return `rappelée par association avec le mot « ${de.slice(2)} »`;
    return 'rappelée par association';
  }
}
