// Les liens vivants du Cerveau : la force de chaque lien (synapse) rangée à part, dans la table Muninn
// « cerveau-liens » (~/.odin/memoire/cerveau-liens.jsonl). Le texte des notes n'est JAMAIS touché.
//  - la table des voisins : liens écrits ([[…]] du propriétaire), liens d'usage (fiche ↔ appli, liens
//    entre applis, chaînes des usages), liens appris (lignes de la table), freins (« remplace », « contredit ») ;
//  - l'apprentissage du tour : seulement sur un usage confirmé (note citée ou lue, action d'appli réussie) ;
//  - la nuit : consolidation (neurones.ts) ; la remise à zéro (avec une copie) ; la vue pour la carte.
// Identifiants internes : n:<chemin.md>, a:<appli>, s:<souvenir>, m:<mot>. Seuls les chemins de notes et les
// identifiants d'applis (avec leur nom) sortent vers la carte : jamais un mot de demande ni un souvenir.
// Rien n'est écrit en mode privé.

import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import type { Mnemosyne } from '../muninn/store.ts';
import type { Table } from '../muninn/tables.ts';
import type { Message } from '../types.ts';
import { fold, keywords } from '../valhalla/besoin.ts';
import { LINKS, USAGES } from '../valhalla/links.ts';
import { valhallaOf } from '../valhalla/odin.ts';
import type { BrainContext } from './contexte.ts';
import { perimee } from './rappel.ts';
import { cle, consolider, deux, forceDe, nouvelle, R, renforcer, type Bilan, type Frein, type Origine, type Synapse, type Voisin } from './neurones.ts';
import { isoDay, vaultEvents, type Note, type Vault } from './vault.ts';

/** Ce dont on a besoin des applis (une Valhalla, ou plus petit dans les essais). */
export interface AppsLike { module(id: string): { id: string; name: string } | undefined; modules?(): Array<{ id: string; name: string }> }
/** Un lien changé, tel qu'il part vers la carte (ids de la carte, titres et nombres seulement). */
export interface LienChange { de: string; vers: string; deNom: string; versNom: string; f: number; o: Origine; n: number; vu: number }

const APPS_DIR = 'Odin/Applis/';
const JOUR = 86_400_000, HEURE = 3_600_000;
const HUB = (n: Note) => n.path.startsWith('Odin/') && !n.path.startsWith(APPS_DIR);
const pasFiable = (n: Note) => n.meta.type === 'capture' || n.meta.fiable === false;
const cleNote = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\.md$/, '').trim();
const FOLD = new WeakMap<Note, string>();
const plie = (n: Note) => { let t = FOLD.get(n); if (t === undefined) { t = fold(`${n.title} ${n.body}`); FOLD.set(n, t); } return t; };
/** La note contient-elle ce mot (même racine que la recherche du Cerveau) ? */
const contient = (n: Note, w: string) => plie(n).includes(w.slice(0, Math.max(4, w.length - 1)));

type Ligne = Synapse & Record<string, unknown>;

/** Ce qui ne dépend que du coffre et des applis : refait seulement quand une note change. */
interface Statique {
  notes: Note[]; apps?: AppsLike;
  parChemin: Map<string, Note>; parSansMd: Map<string, Note>; parCle: Map<string, Note>;
  ecrit: Set<string>; usage: Set<string>;
  adj: Map<string, string[]>;
  freins: Map<string, Array<{ id: string; fr: Frein }>>;
  ficheApp: Map<string, string>; appFiche: Map<string, string>; noms: Map<string, string>;
  /** Liens écrits : combien de notes font exister chaque lien (A→B et B→A comptent pour deux), et ceux de chaque note. */
  nbEcrit: Map<string, number>; sortants: Map<string, string[]>;
  /** Liens et freins écrits vers une note qui n'existe pas (encore) : une note créée plus tard peut les faire exister. */
  orphelins: Array<{ de: string; ref: string }>;
}

/** Au plus combien de notes nouvelles ou changées d'un coup avant de tout refaire (au-delà, refaire est aussi rapide). */
const MAJ_PARTIELLE_MAX = 20;
const trouverDans = (st: Statique, ref: string) => st.parSansMd.get(ref.replace(/\.md$/, '')) ?? st.parCle.get(cleNote(ref.split('/').pop() ?? ref));
/** Ajoute (ou compte une fois de plus) un lien écrit. */
function lierEcrit(st: Statique, x: string, y: string): string | undefined {
  if (x === y) return undefined;
  const k = cle(x, y), nb = st.nbEcrit.get(k) ?? 0;
  st.nbEcrit.set(k, nb + 1);
  if (nb === 0) { st.ecrit.add(k); for (const [u, v] of [[x, y], [y, x]]) { const l = st.adj.get(u); if (l) { if (!l.includes(v)) l.push(v); } else st.adj.set(u, [v]); } }
  return k;
}
/** Retire une contribution à un lien écrit (le lien disparaît quand plus aucune note ne l'écrit). */
function delierEcrit(st: Statique, k: string): void {
  const nb = (st.nbEcrit.get(k) ?? 0) - 1;
  if (nb > 0) { st.nbEcrit.set(k, nb); return; }
  st.nbEcrit.delete(k); st.ecrit.delete(k);
  if (st.usage.has(k)) return; // le lien d'usage garde les deux points voisins
  const [x, y] = k.split('\u0001');
  for (const [u, v] of [[x, y], [y, x]]) { const l = st.adj.get(u); if (!l) continue; const i = l.indexOf(v); if (i >= 0) l.splice(i, 1); if (!l.length) st.adj.delete(u); }
}
/** Les liens écrits d'une note fiable (ses [[…]]) ; les cibles introuvables sont gardées comme orphelins. */
function liensDeNote(st: Statique, n: Note): void {
  const ks: string[] = [];
  for (const l of n.links) {
    const t = trouverDans(st, l);
    if (!t) { st.orphelins.push({ de: n.path, ref: l }); continue; }
    if (t.path !== n.path && !pasFiable(t)) { const k = lierEcrit(st, `n:${n.path}`, `n:${t.path}`); if (k) ks.push(k); }
  }
  st.sortants.set(n.path, ks);
}
/** Les freins d'une note fiable (« remplace », « contredit » dans ses propriétés), refaits en entier pour elle. */
function freinsDeNote(st: Statique, n: Note): void {
  st.freins.delete(`n:${n.path}`);
  for (const fr of ['remplace', 'contredit'] as const) {
    const v = n.meta[fr]; if (v === undefined || v === '' || typeof v === 'boolean' || typeof v === 'number') continue;
    for (const raw of Array.isArray(v) ? v : [v]) {
      const ref = String(raw).replace(/^\s*!?\[\[|\]\]\s*$/g, '').split('|')[0].split('#')[0].trim(); if (!ref) continue;
      const t = trouverDans(st, ref); if (!t) { st.orphelins.push({ de: n.path, ref }); continue; }
      if (t.path === n.path) continue;
      const l = st.freins.get(`n:${n.path}`) ?? []; if (!l.some((x) => x.id === `n:${t.path}`)) l.push({ id: `n:${t.path}`, fr }); st.freins.set(`n:${n.path}`, l);
    }
  }
}

/** Ce que la consultation du Cerveau utilise : voisins, origine d'un lien, gain d'un point, noms. */
export interface Vue {
  origine(x: string, y: string): Origine;
  voisins(id: string, now: number): Voisin[];
  info(id: string): { gain: number; reduit: number };
  note(id: string): Note | undefined;
  nom(id: string): string;
  /** L'identifiant de ce point sur la carte (chemin de note, identifiant d'appli), ou rien (mot, souvenir). */
  carte(id: string): string | undefined;
  lien(x: string, y: string, now: number): { f: number; o: Origine; n: number; vu: number };
  enRepos(id: string, now: number): boolean;
  /** Les notes que ce point freine (« remplace », « contredit » dans ses propriétés). */
  freins(id: string): Array<{ id: string; fr: Frein }>;
}

const MAGASINS = new Set<WeakRef<LiensVivants>>();
// Une note renommée par Odin : ses liens la suivent (événement à part, pas « change » : les automatisations ne le voient pas).
vaultEvents.on('renommée', (e: { ancien?: string; nouveau?: string }) => {
  for (const r of [...MAGASINS]) { const m = r.deref(); if (!m) { MAGASINS.delete(r); continue; } try { if (e?.ancien && e.nouveau) m.renommer(e.ancien, e.nouveau); } catch { /* facultatif */ } }
});

export class LiensVivants {
  readonly table: Table<Ligne>;
  private recs?: Map<string, Synapse>;
  private idx = new Map<string, Set<string>>();
  private st?: Statique;
  private repos = new Map<string, number>();
  private readonly muninn: Mnemosyne;
  constructor(muninn: Mnemosyne) {
    this.muninn = muninn;
    this.table = muninn.table<Ligne>('cerveau-liens', (r) => r.id);
    MAGASINS.add(new WeakRef(this));
  }

  // ---------- Réglage ----------
  actif(): boolean { return this.muninn.getKv('cerveau-liens-actif') !== 'non'; }
  regler(actif: boolean): boolean { this.muninn.setKv('cerveau-liens-actif', actif ? '' : 'non'); return this.actif(); }

  // ---------- Lignes rangées ----------
  private lignes(): Map<string, Synapse> {
    if (!this.recs) {
      this.recs = new Map(); this.idx = new Map();
      for (const r of this.table.values()) { if (typeof r.id !== 'string' || typeof r.a !== 'string' || typeof r.b !== 'string') continue; this.recs.set(r.id, { ...r }); this.indexer(r.a, r.b); }
    }
    return this.recs;
  }
  private indexer(a: string, b: string) { for (const [x, y] of [[a, b], [b, a]]) { let s = this.idx.get(x); if (!s) { s = new Set(); this.idx.set(x, s); } s.add(y); } }
  private desindexer(a: string, b: string) { this.idx.get(a)?.delete(b); this.idx.get(b)?.delete(a); }
  private ecrire(l: Synapse): void {
    const recs = this.lignes();
    recs.set(l.id, l); this.indexer(l.a, l.b);
    this.table.put({ ...l } as Ligne);
  }
  private supprimer(id: string): boolean {
    const recs = this.lignes(), l = recs.get(id);
    if (!l) return false;
    recs.delete(id); this.desindexer(l.a, l.b); this.table.delete(id);
    return true;
  }

  // ---------- Table des voisins ----------
  private statique(vault: Vault, apps?: AppsLike): Statique {
    const notes = vault.all();
    const s = this.st;
    // Le coffre relu sans changement rend un nouveau tableau avec les mêmes notes : la table sert encore.
    if (s && s.apps === apps && (s.notes === notes || (s.notes.length === notes.length && s.notes.every((n, i) => n === notes[i])))) { s.notes = notes; return s; }
    // Quelques notes écrites ou ajoutées (le cas courant : Odin vient d'écrire une note) : la table est mise à jour pour
    // elles seules. Même table qu'une reconstruction ; dès qu'un cas sort de l'ordinaire, on refait tout.
    if (s && s.apps === apps && this.majPartielle(s, notes)) return s;
    const st: Statique = { notes, apps, parChemin: new Map(), parSansMd: new Map(), parCle: new Map(), ecrit: new Set(), usage: new Set(), adj: new Map(), freins: new Map(), ficheApp: new Map(), appFiche: new Map(), noms: new Map(), nbEcrit: new Map(), sortants: new Map(), orphelins: [] };
    for (const n of notes) {
      st.parChemin.set(n.path, n);
      const p = n.path.replace(/\.md$/, ''); if (!st.parSansMd.has(p)) st.parSansMd.set(p, n);
      for (const k of [cleNote(basename(n.path)), cleNote(n.title)]) if (!st.parCle.has(k)) st.parCle.set(k, n);
    }
    const trouver = (ref: string) => trouverDans(st, ref);
    const lier = (set: Set<string>, x: string, y: string) => {
      if (x === y) return; const k = cle(x, y); if (set.has(k)) return; set.add(k);
      for (const [u, v] of [[x, y], [y, x]]) { const l = st.adj.get(u); if (l) { if (!l.includes(v)) l.push(v); } else st.adj.set(u, [v]); }
    };
    for (const n of notes) {
      // Une capture (pas fiable) n'écrit ni lien ni frein : ses [[…]] viennent de l'extérieur, pas du propriétaire
      // (sinon quelques captures qui citent une note diluent son influx et passent pour des liens écrits).
      if (pasFiable(n)) continue;
      liensDeNote(st, n);
      freinsDeNote(st, n);
    }
    const ids = new Set<string>([...LINKS.flatMap((l) => [l.from, l.to]), ...USAGES.flatMap((u) => u.chain)]);
    try { for (const m of apps?.modules?.() ?? []) ids.add(m.id); } catch { /* applis facultatives */ }
    for (const id of [...ids].sort()) {
      const m = apps?.module(id); if (!m) continue;
      st.noms.set(id, m.name);
      const f = trouver(`${APPS_DIR}${m.name}`);
      if (f && f.path.startsWith(APPS_DIR)) { st.appFiche.set(id, f.path); st.ficheApp.set(f.path, id); lier(st.usage, `n:${f.path}`, `a:${id}`); }
    }
    for (const l of LINKS) lier(st.usage, `a:${l.from}`, `a:${l.to}`);
    for (const u of USAGES) for (let k = 1; k < u.chain.length; k++) lier(st.usage, `a:${u.chain[k - 1]}`, `a:${u.chain[k]}`);
    this.st = st;
    return st;
  }

  /**
   * Met la table à jour pour quelques notes nouvelles ou changées. Rend false (tout sera refait) si une note a disparu,
   * si une fiche d'appli bouge, si un titre ou la fiabilité d'une note change, ou si une note nouvelle prend un nom déjà
   * porté (le premier trouvé l'emporterait selon l'ordre du dossier) : ces cas changent la façon de trouver les notes.
   */
  private majPartielle(s: Statique, notes: Note[]): boolean {
    const avant = s.parChemin, ajoutees: Note[] = [], changees: Array<[Note, Note]> = [];
    if (avant.size !== s.notes.length) return false; // deux notes au même chemin : cas inattendu, on refait tout
    for (const n of notes) { const o = avant.get(n.path); if (!o) ajoutees.push(n); else if (o !== n) changees.push([o, n]); }
    if (avant.size + ajoutees.length !== notes.length) return false; // une note a disparu
    if (ajoutees.length + changees.length > MAJ_PARTIELLE_MAX) return false;
    for (const n of [...ajoutees, ...changees.map((c) => c[1])]) if (n.path.startsWith(APPS_DIR)) return false;
    for (const [o, n] of changees) if (o.title !== n.title || pasFiable(o) !== pasFiable(n)) return false;
    const nouvellesCles = new Set<string>();
    for (const n of ajoutees) {
      const ks = [`p:${n.path.replace(/\.md$/, '')}`, `c:${cleNote(basename(n.path))}`, `c:${cleNote(n.title)}`];
      if (s.parSansMd.has(ks[0].slice(2)) || s.parCle.has(ks[1].slice(2)) || s.parCle.has(ks[2].slice(2))) return false;
      if (nouvellesCles.has(ks[0]) || nouvellesCles.has(ks[1])) return false; // deux notes nouvelles au même nom
      ks.forEach((k) => nouvellesCles.add(k));
    }
    // Les liens et freins écrits par une note sont refaits pour elle seule.
    const refaire = (n: Note) => {
      for (const k of s.sortants.get(n.path) ?? []) delierEcrit(s, k);
      s.sortants.delete(n.path); s.freins.delete(`n:${n.path}`);
      s.orphelins = s.orphelins.filter((x) => x.de !== n.path);
      if (!pasFiable(n)) { liensDeNote(s, n); freinsDeNote(s, n); }
    };
    for (const [o, n] of changees) {
      s.parChemin.set(n.path, n);
      const p = n.path.replace(/\.md$/, ''); if (s.parSansMd.get(p) === o) s.parSansMd.set(p, n);
      for (const k of [cleNote(basename(n.path)), cleNote(n.title)]) if (s.parCle.get(k) === o) s.parCle.set(k, n);
      refaire(n);
    }
    for (const n of ajoutees) {
      s.parChemin.set(n.path, n);
      s.parSansMd.set(n.path.replace(/\.md$/, ''), n);
      for (const k of [cleNote(basename(n.path)), cleNote(n.title)]) if (!s.parCle.has(k)) s.parCle.set(k, n);
    }
    // Les notes qui écrivaient déjà vers une note nouvelle (lien ou frein orphelin) : leurs liens sont refaits.
    const nouvelles = new Set(ajoutees.map((n) => n.path));
    const touchees = new Set(s.orphelins.filter((x) => { const t = trouverDans(s, x.ref); return t && nouvelles.has(t.path); }).map((x) => x.de));
    for (const n of ajoutees) refaire(n);
    for (const de of touchees) { const n = s.parChemin.get(de); if (n && !nouvelles.has(de)) refaire(n); }
    s.notes = notes;
    return true;
  }

  /** La vue du moment (coffre + applis + liens rangés), pour la consultation, l'apprentissage et la carte. */
  voisinage(vault: Vault, apps: AppsLike | undefined = valhallaOf()): Vue {
    const st = this.statique(vault, apps), recs = this.lignes(), idx = this.idx;
    const origine = (x: string, y: string): Origine => { const k = cle(x, y); return st.ecrit.has(k) ? 'ecrit' : st.usage.has(k) ? 'usage' : 'appris'; };
    const note = (id: string) => (id.startsWith('n:') ? st.parChemin.get(id.slice(2)) : undefined);
    return {
      origine,
      note,
      voisins: (id, now) => {
        const out: Voisin[] = [], vus = new Set<string>();
        for (const j of st.adj.get(id) ?? []) { vus.add(j); const o = origine(id, j); out.push({ id: j, f: forceDe(recs.get(cle(id, j)), o, now), o }); }
        for (const j of idx.get(id) ?? []) {
          if (vus.has(j) || (id.startsWith('m:') && j.startsWith('a:')) || (j.startsWith('m:') && id.startsWith('a:'))) continue;
          const f = forceDe(recs.get(cle(id, j)), 'appris', now); if (f > 0) out.push({ id: j, f, o: 'appris' });
        }
        for (const x of st.freins.get(id) ?? []) out.push({ id: x.id, f: 0, o: 'frein' });
        return out;
      },
      info: (id) => {
        if (!id.startsWith('n:')) return { gain: 1, reduit: 1 };
        const n = note(id); if (!n) return { gain: 0, reduit: 1 };
        const vieille = perimee(n);
        return { gain: pasFiable(n) || HUB(n) || vieille ? 0 : 1, reduit: vieille ? R.REDUIT_PERIME : 1 };
      },
      nom: (id) => (id.startsWith('n:') ? note(id)?.title ?? basename(id.slice(2), '.md') : id.startsWith('a:') ? st.noms.get(id.slice(2)) ?? id.slice(2) : ''),
      carte: (id) => (id.startsWith('n:') ? (st.parChemin.has(id.slice(2)) ? id.slice(2) : undefined) : id.startsWith('a:') ? id.slice(2) : undefined),
      lien: (x, y, now) => { const o = origine(x, y), r = recs.get(cle(x, y)); return { f: deux(forceDe(r, o, now)), o, n: r?.n ?? 0, vu: r?.vu ?? 0 }; },
      enRepos: (id, now) => (this.repos.get(id) ?? 0) > now,
      freins: (id) => st.freins.get(id) ?? [],
    };
  }

  // ---------- Repos ----------
  reposer(ids: string[], now: number): void {
    for (const [k, v] of this.repos) if (v <= now) this.repos.delete(k);
    for (const id of ids) this.repos.set(id, now + R.REPOS_MS);
  }

  // ---------- Apprentissage du tour ----------
  /**
   * Ce qui a servi ensemble se relie, sur un usage confirmé seulement : note consultée (ou lue) PUIS citée en
   * [[…]], note lue avec cerveau_lire, action d'appli réussie, souvenir rappelé quand une note a été citée,
   * mot de la demande ↔ note citée qui ne le contient pas. Jamais une note pas fiable ni une note carrefour.
   */
  apprendreDuTour(t: { consult: BrainContext; texte: string; lus: string[]; applis: string[]; souvenirs: number[]; mots: string[]; vault: Vault; apps?: AppsLike }, now: number): LienChange[] {
    if (!this.actif() || this.muninn.privateMode) return [];
    const apps = t.apps === undefined ? valhallaOf() : t.apps;
    const vue = this.voisinage(t.vault, apps), st = this.st!;
    const trouver = (ref: string) => st.parSansMd.get(ref.replace(/\.md$/, '')) ?? st.parCle.get(cleNote(ref.split('/').pop() ?? ref));
    const citees = new Set<string>();
    for (const m of t.texte.matchAll(/\[\[([^\]|#]+)/g)) { const n = trouver(m[1].trim()); if (n) citees.add(n.path); }
    const lus = new Set(t.lus.map((x) => trouver(x)?.path).filter(Boolean) as string[]);
    const par = new Map((t.consult.entres ?? []).map((e) => [e.id, e.par]));
    const connues = [...new Set([...t.consult.notes.map((n) => n.path), ...lus])].sort();
    const preuve = new Map<string, number>(), mettre = (id: string, s: number) => preuve.set(id, Math.max(preuve.get(id) ?? 0, s));
    const citeesOk: Note[] = [];
    for (const p of connues) {
      const n = st.parChemin.get(p); if (!n || pasFiable(n) || HUB(n)) continue;
      // Une note entrée par association et seulement citée ne prouve rien : le modèle cite ce qu'on lui donne, et le
      // lien se nourrirait de lui-même. Il faut un usage indépendant : lue avec cerveau_lire, ou entrée directement.
      const assoc = par.get(`n:${p}`) === 'association';
      if (citees.has(p) && !assoc) { citeesOk.push(n); mettre(`n:${p}`, 1); }
      else if (lus.has(p)) mettre(`n:${p}`, 0.8);
    }
    for (const a of t.applis) mettre(`a:${a}`, 1);
    if (citeesOk.length) {
      for (const s of t.souvenirs) mettre(`s:${s}`, 0.5);
      for (const w of t.mots) if (citeesOk.some((n) => !contient(n, w))) mettre(`m:${w}`, 0.6);
    }
    const U = [...preuve].sort((x, y) => y[1] - x[1] || (x[0] < y[0] ? -1 : 1)).slice(0, 8);
    const changes: LienChange[] = [], faits = new Set<string>();
    // Une appli qui a une fiche : quand la fiche est déjà reliée à la note (lien écrit ou d'usage), c'est ce lien-là
    // qui se renforce, pas un lien appris en double à côté de celui du propriétaire.
    const parFiche = (id: string, autre: string) => {
      const f = id.startsWith('a:') && autre.startsWith('n:') ? st.appFiche.get(id.slice(2)) : undefined;
      return f && vue.origine(`n:${f}`, autre) !== 'appris' ? `n:${f}` : id;
    };
    for (let i = 0; i < U.length; i++) for (let j = i + 1; j < U.length; j++) {
      const [x0, sx] = U[i], [y0, sy] = U[j];
      const x = parFiche(x0, y0), y = parFiche(y0, x0);
      if (x === y || (!x.startsWith('n:') && !y.startsWith('n:'))) continue;
      const mot = x.startsWith('m:') ? [x, y] : y.startsWith('m:') ? [y, x] : undefined;
      // Jamais de lien mot → note entrée par association (même lue) : la demande ne l'a pas trouvée, Odin l'a proposée.
      if (mot) { const n = vue.note(mot[1]); if (!n || contient(n, mot[0].slice(2)) || par.get(mot[1]) === 'association') continue; }
      const o = vue.origine(x, y), k = cle(x, y), recs = this.lignes();
      if (faits.has(k)) continue; // un même lien une seule fois par tour
      faits.add(k);
      const l = recs.get(k) ? { ...recs.get(k)! } : nouvelle(x, y, o, now);
      if (l.bloque && l.bloque > now) continue;
      const e = renforcer(l, Math.min(sx, sy), now, o);
      this.ecrire(l);
      if (!(e > 0)) continue;
      const de = vue.carte(l.a), vers = vue.carte(l.b), f = deux(forceDe(l, o, now));
      if (!de || !vers || (o === 'appris' && f < R.APPRIS_VISIBLE)) continue;
      if (changes.length < 30) changes.push({ de, vers, deNom: vue.nom(l.a), versNom: vue.nom(l.b), f, o, n: l.n, vu: l.vu });
    }
    return changes;
  }

  // ---------- La nuit ----------
  /** Consolidation de la nuit (3 h à 5 h, ou dès 36 h sans nuit) : jamais pendant un travail. */
  nuitSiBesoin(now: number, o: { occupe?: boolean; vault?: Vault; apps?: AppsLike; force?: boolean }): (Bilan & { at: number }) | undefined {
    if (o.occupe || !o.vault || !this.actif() || this.muninn.privateMode) return undefined;
    const last = Number(this.muninn.getKv('cerveau-nuit') ?? 0) || 0, h = new Date(now).getHours();
    if (!o.force && !((h >= 3 && h < 5 && now - last > 20 * HEURE) || now - last > 36 * HEURE)) return undefined;
    const apps = o.apps === undefined ? valhallaOf() : o.apps;
    const vue = this.voisinage(o.vault, apps), st = this.st!;
    const existe = (id: string) => {
      if (id.startsWith('n:')) return st.parChemin.has(id.slice(2));
      if (id.startsWith('a:')) return apps ? Boolean(apps.module(id.slice(2))) : true;
      if (id.startsWith('s:')) return Boolean(this.muninn.getMemory(Number(id.slice(2))));
      return true;
    };
    const recs = this.lignes();
    const avant = [...recs.values()].map((l) => ({ ...l }));
    const r = consolider(avant, now, { origine: vue.origine, existe });
    // Seules les lignes qui ont vraiment changé sont écrites, et d'un seul bloc (une nuit ne bloque pas le serveur).
    // Une ligne qui n'a fait que vieillir garde sa force rangée et sa date : sa force lue reste la même.
    const changees: Synapse[] = [];
    for (const l of r.garder) {
      const v = recs.get(l.id);
      if (v && (v.j || 0) === 0 && (v.k || 0) === (l.k || 0) && v.bloque === l.bloque && v.absent === l.absent && forceDe(v, vue.origine(v.a, v.b), now) === l.w) continue;
      changees.push(l);
    }
    for (const id of r.effacer) { const l = recs.get(id); if (l) { recs.delete(id); this.desindexer(l.a, l.b); } }
    for (const l of changees) { recs.set(l.id, l); this.indexer(l.a, l.b); }
    this.table.enBloc(changees.map((l) => ({ ...l }) as Ligne), r.effacer);
    const bilan = { at: now, ...r.bilan };
    this.muninn.setKv('cerveau-nuit', String(now));
    this.muninn.setKv('cerveau-nuit-bilan', JSON.stringify(bilan));
    return bilan;
  }

  // ---------- Renommage ----------
  renommer(ancien: string, nouveau: string): number {
    if (this.muninn.privateMode || ancien === nouveau) return 0;
    const de = `n:${ancien}`, vers = `n:${nouveau}`;
    const touches = [...(this.lignes(), this.idx.get(de) ?? [])];
    let n = 0;
    for (const autre of touches) {
      const vieux = this.recs!.get(cle(de, autre)); if (!vieux) continue;
      this.supprimer(vieux.id);
      const bout = autre === de ? vers : autre;
      if (bout === vers) continue;
      const neuf = { ...vieux, ...nouvelle(vers, bout, 'appris', vieux.cree), w: vieux.w, t: vieux.t, j: vieux.j, vu: vieux.vu, n: vieux.n, k: vieux.k, cree: vieux.cree };
      if (vieux.bloque) neuf.bloque = vieux.bloque; if (vieux.absent) delete neuf.absent;
      const deja = this.recs!.get(neuf.id);
      if (deja && deja.w >= neuf.w) continue;
      this.ecrire(neuf); n++;
    }
    return n;
  }

  // ---------- Oublier ----------
  private sauvegarder(now: number): boolean {
    const f = this.table.file; if (!f || !existsSync(f) || !this.muninn.dir) return false;
    const dir = join(dirname(this.muninn.dir), 'memoire-sauve');
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    copyFileSync(f, join(dir, `cerveau-liens-${isoDay(new Date(now))}.jsonl`));
    const copies = readdirSync(dir).filter((x) => /^cerveau-liens-\d{4}-\d{2}-\d{2}\.jsonl$/.test(x)).sort().reverse();
    for (const x of copies.slice(3)) rmSync(join(dir, x), { force: true });
    this.muninn.setKv('cerveau-liens-sauvegarde', String(now));
    return true;
  }

  /** « appris » : les liens appris et les mots ; « tout » : toute la table ; « lien » : un lien (appris supprimé, autre remis à sa base), bloqué 90 j. */
  oublier(quoi: string, o: { de?: string; vers?: string; vault: Vault; apps?: AppsLike }, now: number): { ok: true; effaces: number } | { ok: false; error: string } {
    const apps = o.apps === undefined ? valhallaOf() : o.apps;
    const vue = this.voisinage(o.vault, apps), st = this.st!;
    if (quoi === 'appris' || quoi === 'tout') {
      this.sauvegarder(now);
      const recs = this.lignes(), partir: string[] = [];
      for (const l of [...recs.values()]) if (quoi === 'tout' || l.a.startsWith('m:') || l.b.startsWith('m:') || vue.origine(l.a, l.b) === 'appris') { recs.delete(l.id); this.desindexer(l.a, l.b); partir.push(l.id); }
      this.table.enBloc([], partir); // d'un seul bloc : pas une écriture disque par lien
      this.table.compact(); // effacés pour de bon sur le disque (la copie est gardée à part)
      return { ok: true, effaces: partir.length };
    }
    if (quoi !== 'lien') return { ok: false, error: 'quoi : « appris », « tout » ou « lien »' };
    const ids = (x?: string): string[] => {
      const v = String(x ?? '').trim(); if (!v) return [];
      const n = st.parChemin.get(v) ?? st.parChemin.get(`${v}.md`);
      if (n) { const app = st.ficheApp.get(n.path); return app ? [`n:${n.path}`, `a:${app}`] : [`n:${n.path}`]; }
      if (apps?.module(v)) { const f = st.appFiche.get(v); return f ? [`a:${v}`, `n:${f}`] : [`a:${v}`]; }
      return [];
    };
    const A = ids(o.de), B = ids(o.vers);
    if (!A.length || !B.length) return { ok: false, error: 'lien introuvable' };
    let n = 0;
    const bloque = now + R.BLOQUE_JOURS * JOUR;
    for (const x of A) for (const y of B) {
      if (x === y) continue;
      const og = vue.origine(x, y), deja = this.lignes().get(cle(x, y));
      if (deja) n++;
      const l = deja ? { ...deja } : nouvelle(x, y, og, now);
      l.w = R.BASE[og]; l.t = now; l.j = 0; l.k = 0; if (og === 'appris') l.n = 0;
      l.bloque = bloque;
      this.ecrire(l);
    }
    return { ok: true, effaces: n };
  }

  // ---------- Vue pour la carte ----------
  /** Le graphe du Cerveau enrichi : force des liens écrits, liens appris visibles, freins. */
  versCarte<G extends { nodes: Array<{ id: string }>; edges: Array<{ from: string; to: string; kind: string }> }>(g: G, vault: Vault, apps: AppsLike | undefined, now: number): G & { edges: Array<Record<string, unknown>>; neurones: { actif: boolean; maintenant: number } } {
    const vue = this.voisinage(vault, apps), st = this.st!;
    const noeuds = new Set(g.nodes.map((n) => n.id));
    const paires = new Set<string>();
    const edges: Array<Record<string, unknown>> = g.edges.map((e) => {
      if (e.kind !== 'lien') return e;
      paires.add(cle(e.from, e.to));
      const x = `n:${e.from}`, y = `n:${e.to}`;
      // Une arête qui touche une capture n'est pas un lien écrit par le propriétaire : dessinée comme avant, sans force.
      const nx = vue.note(x), ny = vue.note(y);
      if ((nx && pasFiable(nx)) || (ny && pasFiable(ny))) return e;
      const l = vue.lien(x, y, now);
      const fr = st.freins.get(x)?.find((z) => z.id === y)?.fr;
      return { ...e, f: l.f, o: l.o, n: l.n, vu: l.vu, ...(fr ? { fr } : {}) };
    });
    const versNoeud = (id: string) => { const p = id.startsWith('n:') ? id.slice(2) : id.startsWith('a:') ? st.appFiche.get(id.slice(2)) : undefined; return p && noeuds.has(p) ? p : undefined; };
    const appris: Array<{ from: string; to: string; kind: 'appris'; f: number; o: 'appris'; n: number; vu: number }> = [], vus = new Set<string>();
    for (const l of this.lignes().values()) {
      if (vue.origine(l.a, l.b) !== 'appris') continue;
      const f = deux(forceDe(l, 'appris', now)); if (f < R.APPRIS_VISIBLE) continue;
      const from = versNoeud(l.a), to = versNoeud(l.b); if (!from || !to || from === to) continue;
      const k = cle(from, to); if (vus.has(k) || paires.has(k)) continue; vus.add(k); // déjà un lien écrit : pas de trait en double
      appris.push({ from, to, kind: 'appris', f, o: 'appris', n: l.n, vu: l.vu });
    }
    appris.sort((p, q) => q.f - p.f || (cle(p.from, p.to) < cle(q.from, q.to) ? -1 : 1));
    edges.push(...appris.slice(0, 3000));
    for (const [x, l] of [...st.freins].sort((p, q) => (p[0] < q[0] ? -1 : 1))) for (const z of l) {
      const from = x.slice(2), to = z.id.slice(2);
      if (!noeuds.has(from) || !noeuds.has(to) || paires.has(cle(from, to))) continue;
      edges.push({ from, to, kind: 'frein', fr: z.fr });
    }
    return { ...g, edges, neurones: { actif: this.actif(), maintenant: now } };
  }

  /** Le résumé pour la page du Cerveau (« Liens vivants »). */
  etat(vault: Vault, apps: AppsLike | undefined, now: number): { ok: true; actif: boolean; total: number; appris: number; candidats: number; nuit: null | { at: number; renforces: number; effaces: number; recadres: number }; sauvegarde: null | { at: number } } {
    const vue = this.voisinage(vault, apps);
    let appris = 0, candidats = 0;
    for (const l of this.lignes().values()) if (vue.origine(l.a, l.b) === 'appris') { if (forceDe(l, 'appris', now) >= R.APPRIS_VISIBLE) appris++; else candidats++; }
    let nuit: { at: number; renforces: number; effaces: number; recadres: number } | null = null;
    try { const b = JSON.parse(this.muninn.getKv('cerveau-nuit-bilan') ?? 'null'); if (b && typeof b === 'object') nuit = { at: Number(b.at) || 0, renforces: Number(b.renforces) || 0, effaces: Number(b.effaces) || 0, recadres: Number(b.recadres) || 0 }; } catch { /* bilan abîmé */ }
    const s = Number(this.muninn.getKv('cerveau-liens-sauvegarde') ?? 0);
    return { ok: true, actif: this.actif(), total: this.lignes().size, appris, candidats, nuit, sauvegarde: s ? { at: s } : null };
  }
}

const PAR_MEMOIRE = new WeakMap<Mnemosyne, LiensVivants>();
/** Le magasin des liens vivants de cette mémoire (un seul par mémoire). */
export function liensDe(muninn: Mnemosyne): LiensVivants {
  let l = PAR_MEMOIRE.get(muninn);
  if (!l) { l = new LiensVivants(muninn); PAR_MEMOIRE.set(muninn, l); }
  return l;
}

/**
 * Fin d'un tour de l'agent : ce qui a vraiment servi (notes lues avec cerveau_lire, actions d'applis réussies,
 * notes citées) renforce les liens. Rend les liens changés (pour l'événement « liens »).
 */
export function apprendreDeLAgent(muninn: Mnemosyne, t: { consult: BrainContext; texte: string; turnLog: Message[]; souvenirs: number[]; demande: string; vault: Vault; apps?: AppsLike }, now: number): LienChange[] {
  const l = liensDe(muninn);
  if (!l.actif() || muninn.privateMode) return [];
  const apps = t.apps === undefined ? valhallaOf() : t.apps;
  const sortie = (id: string) => t.turnLog.find((m) => m.role === 'tool' && m.toolCallId === id)?.content ?? '';
  const appels = t.turnLog.flatMap((m) => m.toolCalls ?? []);
  const lus = appels.filter((c) => c.name === 'cerveau_lire' && !/^Note introuvable/.test(sortie(c.id))).map((c) => String(c.input.note ?? '')).filter(Boolean);
  const idAppli = (x: string): string | undefined => {
    if (!x) return undefined;
    if (apps?.module(x)) return x;
    const f = fold(x).trim(); return apps?.modules?.().find((m) => fold(m.name) === f || m.id === f)?.id;
  };
  const applis = [...new Set(appels.filter((c) => c.name === 'valhalla' && c.input.action === 'action' && !/^(Erreur|Action refusée|Refusé|\[Mode essai\])/.test(sortie(c.id))).map((c) => idAppli(String(c.input.appli ?? ''))).filter(Boolean) as string[])];
  return l.apprendreDuTour({ consult: t.consult, texte: t.texte, lus, applis, souvenirs: t.souvenirs, mots: keywords(t.demande), vault: t.vault, apps }, now);
}
