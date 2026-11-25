// Vénus · l'administration, première part : ce que lit le tableau de bord (pages/Dashboard.js du dépôt Venus) —
// aperçu, en ce moment, appareils, activité, santé, tâches de fond, médiathèques. Tout vient de ce qu'Odin garde
// déjà dans VENUS_ODIN (la bibliothèque, la reprise, l'historique, le journal de Comète, les versions légères, les
// écrans connus, les dossiers) ; seules les analyses des médiathèques n'avaient pas de journal : une petite table
// bornée (« journal ») les garde. Ce qu'Odin ne sait pas n'est pas rempli : pas de case, ou « absente » avec sa raison.
//
// Réservé au profil administrateur (la route le vérifie). Jamais une adresse IP ; le chemin d'un dossier n'est donné
// qu'à l'administrateur ; le message d'une analyse ratée n'est pas gardé (il peut porter un chemin).
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, statSync, statfsSync } from 'node:fs';
import { cpus, freemem, totalmem } from 'node:os';
import { join, resolve, sep } from 'node:path';
import type { MagasinVenus } from './base.ts';
import { dossiers } from './bibliotheque.ts';
import { catalogue, PROFIL_PROPRIETAIRE, profils } from './app/appli.ts';
import { journalComete } from './comete/index.ts';
import { conversionEnCours } from './pistes.ts';
import { demanderVignettes } from './vignettes.ts';
import { attendFiche, reglageEnregistre, sourceFiche } from './metadonnees.ts';
import { reglagesCatalogue } from './catalogue/index.ts';
import { armerMenage, MENAGE } from './hors-ligne.ts';
import { valhallaOf } from '../odin.ts';
import { fuseauOdin } from '../../draupnir/rythme.ts';

const s = (v: unknown) => (v === undefined || v === null ? '' : String(v)).trim();
const n = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/** Le lecteur note la reprise toutes les 10 s pendant la lecture : notée depuis moins que ça, elle est « en ce moment ». */
export const FENETRE_LECTURE_MS = 35_000;
/** Une reprise à 95 % est un titre vu (même seuil que la bibliothèque) : plus « en ce moment ». */
const FINI = 0.95;
/** Le journal des analyses garde ses dernières lignes seulement. */
export const JOURNAL_MAX = 200;

// ---------------------------------------------------------------- le journal des analyses (table « journal »)
export interface LigneJournal { genre: 'analyse'; ajoutes?: number; introuvables?: number; erreur?: true }
/** Note une ligne au journal de Vénus ; au-delà de JOURNAL_MAX, les plus anciennes partent. */
export function noterActivite(mag: MagasinVenus, l: LigneJournal): void {
  mag.poser('journal', `${Date.now().toString(36)}-${randomBytes(3).toString('hex')}`, { at: Date.now(), ...l });
  const toutes = mag.liste('journal');
  if (toutes.length > JOURNAL_MAX) for (const x of toutes.sort((a, b) => n(a.data.at) - n(b.data.at) || a.maj - b.maj).slice(0, toutes.length - JOURNAL_MAX)) mag.retirer('journal', x.id);
}
/** Les analyses en cours, par magasin (un compteur : deux analyses lancées ensemble ne s'effacent pas l'une l'autre). */
const analyses = new Map<string, { n: number; debut: number }>();
/**
 * Fait passer une analyse des médiathèques (celle qui existe : POST /venus/scan) par le journal : « en cours » pendant,
 * puis une ligne (titres ajoutés, dossiers introuvables), ou « échec » sans le message.
 */
export async function suivreAnalyse<T extends { oeuvres: number; dossiersIntrouvables: string[] }>(mag: MagasinVenus, faire: () => Promise<T>): Promise<T> {
  const cle = resolve(mag.dir), a = analyses.get(cle) ?? { n: 0, debut: Date.now() };
  a.n++; analyses.set(cle, a);
  try {
    const b = await faire();
    noterActivite(mag, { genre: 'analyse', ajoutes: n(b.oeuvres), introuvables: b.dossiersIntrouvables.length });
    return b;
  } catch (e) { noterActivite(mag, { genre: 'analyse', erreur: true }); throw e; }
  finally { if (--a.n <= 0) analyses.delete(cle); }
}

// ---------------------------------------------------------------- la santé (injectable pour les essais)
interface Coeur { times: { user: number; nice: number; sys: number; idle: number; irq: number } }
export interface SourcesSante {
  cpus(): Coeur[];
  memTotale(): number;
  memLibre(): number;
  /** la place d'un disque (le dossier d'une médiathèque), ou rien si le système ne la dit pas */
  place(dossier: string): { total: number; libre: number } | undefined;
}
const REELLES: SourcesSante = {
  cpus: () => { try { return cpus(); } catch { return []; } },
  memTotale: () => { try { return totalmem(); } catch { return 0; } },
  memLibre: () => { try { return freemem(); } catch { return 0; } },
  place: (d) => { try { const f = statfsSync(d); const total = Number(f.blocks) * Number(f.bsize), libre = Number(f.bavail) * Number(f.bsize); return total > 0 ? { total, libre } : undefined; } catch { return undefined; } },
};
let sources: SourcesSante = REELLES;
let releve: { idle: number; total: number } | undefined;
/** (essais) d'autres sources de santé ; sans argument, les vraies. */
export function reglerSourcesSante(o: Partial<SourcesSante> = {}): void { sources = { ...REELLES, ...o }; releve = undefined; }

/** Pourquoi une mesure manque : « aucune » (le système ne la donne pas à Odin), « mesure » (premier relevé, pas encore de comparaison). */
export type Absente = { absent: 'aucune' | 'mesure' };
export type Processeur = { pct: number; cores: number; model: string } | Absente;
export type Memoire = { total: number; free: number } | Absente;
export type Disques = Array<{ total: number; free: number; categories: string[] }> | Absente;

/** La charge du processeur entre deux relevés (temps des cœurs, le même moyen sur tous les systèmes). */
function processeur(): Processeur {
  const c = sources.cpus(); if (!c.length) return { absent: 'aucune' };
  let idle = 0, total = 0;
  for (const x of c) { const t = x.times; idle += n(t.idle); total += n(t.user) + n(t.nice) + n(t.sys) + n(t.idle) + n(t.irq); }
  const avant = releve; releve = { idle, total };
  if (!avant || total <= avant.total) return { absent: 'mesure' };
  const pct = Math.max(0, Math.min(100, (1 - (idle - avant.idle) / (total - avant.total)) * 100));
  return { pct, cores: c.length, model: s((c[0] as { model?: string }).model) };
}
function memoire(): Memoire {
  const total = sources.memTotale(), libre = sources.memLibre();
  return total > 0 && libre >= 0 && libre <= total ? { total, free: libre } : { absent: 'aucune' };
}
/** Les disques des médiathèques (un disque partagé par deux dossiers n'est compté qu'une fois). */
function disques(libs: Array<{ path: string; exists: boolean; category: string }>): Disques {
  const vus = new Map<string, { total: number; free: number; categories: string[] }>();
  for (const l of libs) {
    if (!l.exists) continue;
    const p = sources.place(l.path); if (!p) continue;
    const k = `${p.total}|${p.libre}`, d = vus.get(k) ?? { total: p.total, free: p.libre, categories: [] };
    if (!d.categories.includes(l.category)) d.categories.push(l.category);
    vus.set(k, d);
  }
  return vus.size ? [...vus.values()] : { absent: 'aucune' };
}

// ---------------------------------------------------------------- le tableau
export interface EnLecture { itemId: string; showId?: string; title: string; showTitle?: string; season?: number; episode?: number; profile: string; avatar: number; position: number; duration: number; at: number; poster?: string; backdrop?: string; mode?: 'transcode' }
export interface Activite { kind: 'play' | 'scan' | 'seerr' | 'legere'; at: number; title?: string; who?: string; n?: number; missing?: number; error?: true; quality?: string }
export interface Mediatheque { category: string; path: string; exists: boolean; items: number }
export interface Tableau {
  server: { uptime: number; zone: string };
  counts: { movie: number; show: number; anime: number; clip: number; episode: number };
  /** la place prise et les heures de vidéo, seulement quand Odin les connaît pour chaque fichier */
  totals: { size?: number; hours?: number };
  playing: EnLecture[]; transcodes: number;
  devices: Array<{ name: string; type: string; seen?: number }>;
  tasks: {
    scan: { running: boolean; since?: number; last?: { at: number; n?: number; missing?: number; error?: true } };
    vignettes: number; fiches: number;
    legeres: { working: number; queued: number; progress?: number };
    menage?: { state: string; last?: { at: number; ok: boolean }; next?: number };
  };
  system: { cpu: Processeur; mem: Memoire; disks: Disques };
  activity: Activite[];
  libraries: Mediatheque[];
}

/** Le même nom de dossier partout (Windows ne distingue pas les majuscules). */
const normal = (p: string) => { const r = resolve(p); return process.platform === 'win32' ? r.toLowerCase() : r; };
const sous = (fichier: string, dossier: string) => { const f = normal(fichier), d = normal(dossier); return f === d || f.startsWith(d.endsWith(sep) ? d : d + sep); };
const lisible = (d: string) => { try { return existsSync(d) && statSync(d).isDirectory(); } catch { return false; } };

/** Les fiches qui attendent (la même règle que lancerFiches, sans rien lancer ; de la clé, seule sa présence compte, elle n'est jamais renvoyée). */
function fichesEnAttente(mag: MagasinVenus): number {
  if (!reglageEnregistre(mag)) return 0;
  const r = reglagesCatalogue(mag);
  let aCle = false; try { aCle = r.films === 'cle' && !!(JSON.parse(readFileSync(join(mag.dir, 'catalogue-cle.json'), 'utf8')) as { cle?: string }).cle; } catch { aCle = false; }
  return mag.liste('oeuvres').filter((o) => attendFiche(o) && sourceFiche(r, o.data.type as 'film' | 'serie', s(o.data.categorie) === 'anime', true, aCle)).length;
}
/** La ligne « Ménage des versions légères » du registre des automatismes (Talos), si ce magasin est celui d'Odin. */
function menage(mag: MagasinVenus): Tableau['tasks']['menage'] {
  const v = valhallaOf();
  if (!v || resolve(v.dir, 'freyja') !== resolve(mag.dir) || !armerMenage(mag)) return undefined;
  const l = v.automatismes.ligne(`tache:freyja:${MENAGE}`); if (!l) return undefined;
  const at = l.derniere ? Date.parse(l.derniere.at) : NaN, next = l.prochaine ? Date.parse(l.prochaine) : NaN;
  return { state: l.etat, ...(Number.isFinite(at) ? { last: { at, ok: l.derniere!.ok } } : {}), ...(Number.isFinite(next) ? { next } : {}) };
}

/** Le tableau de bord de Vénus, pour l'administrateur. */
export function tableau(mag: MagasinVenus, home: string, maintenant = Date.now()): Tableau {
  const personnes = new Map(profils(home).map((p) => [p.id, p]));
  const oeuvres = mag.liste('oeuvres'), eps = mag.liste('episodes');

  // Aperçu : les comptes (mêmes catégories que la bibliothèque), la place et les heures si chaque fichier les dit.
  const counts = { movie: 0, show: 0, anime: 0, clip: 0, episode: eps.length };
  for (const o of oeuvres) {
    const c = s(o.data.categorie);
    if (o.data.type === 'film') counts[c === 'clip' ? 'clip' : 'movie']++;
    else if (o.data.type === 'serie') counts[c === 'anime' ? 'anime' : 'show']++;
  }
  const videos = [...oeuvres.filter((o) => o.data.type === 'film'), ...eps];
  let size: number | undefined = 0, secondes: number | undefined = 0;
  for (const v of videos) {
    const f = s(v.data.fichier), e = f ? mag.get('fichiers', f.replace(/[^A-Za-z0-9_.:-]/g, '_').slice(-199)) : undefined;
    const t = Number(e?.data.taille);
    if (size !== undefined) size = Number.isFinite(t) && t >= 0 && e ? size + t : undefined;
    const d = Number(v.data.duree);
    if (secondes !== undefined) secondes = d > 0 ? secondes + d : undefined;
  }

  // En ce moment : la reprise notée à l'instant, pas finie.
  const conv = conversionEnCours();
  const lus: Array<{ p: EnLecture; profil: string }> = [];
  for (const r of mag.liste('reprise')) {
    const at = n(r.data.maj) || r.maj, pos = n(r.data.position_s), cible = s(r.data.cible_id), qui = personnes.get(s(r.data.profil));
    if (!qui || maintenant - at > FENETRE_LECTURE_MS || at - maintenant > 5000) continue;
    const ep = mag.get('episodes', cible), oe = ep ? mag.get('oeuvres', s(ep.data.oeuvre_id)) : mag.get('oeuvres', cible);
    if (!oe || (ep ? oe.data.type !== 'serie' : oe.data.type !== 'film')) continue;
    const dur = n(r.data.duree_s) || n((ep ?? oe).data.duree);
    if (dur > 0 && pos >= dur * FINI) continue;
    lus.push({ profil: s(r.data.profil), p: { itemId: cible, title: s(oe.data.titre) || oe.id, ...(ep ? { showId: oe.id, showTitle: s(oe.data.titre) || oe.id, season: n(ep.data.saison), episode: n(ep.data.episode) } : {}),
      profile: qui.name, avatar: qui.avatar, position: pos, duration: dur, at } });
  }
  lus.sort((a, b) => b.p.at - a.p.at);
  // La conversion en cours (une à la fois) est celle d'un profil : elle va à sa lecture la plus récente.
  let convVue = false, playing: EnLecture[] = [];
  if (lus.length) {
    const images = new Map(catalogue(mag, PROFIL_PROPRIETAIRE).map((x) => [x.id, x]));
    playing = lus.map(({ p, profil }) => {
      const i = images.get(p.showId ?? p.itemId);
      const mode = !convVue && conv !== undefined && profil === conv ? (convVue = true, 'transcode' as const) : undefined;
      return { ...p, ...(i?.poster ? { poster: i.poster } : {}), ...(i?.backdrop ? { backdrop: i.backdrop } : {}), ...(mode ? { mode } : {}) };
    });
  }

  // Médiathèques : chaque dossier déclaré, son nombre d'œuvres, s'il est accessible.
  const fichiersOeuvre: Array<[string, string]> = [
    ...oeuvres.filter((o) => s(o.data.fichier)).map((o): [string, string] => [s(o.data.fichier), o.id]),
    ...eps.map((e): [string, string] => [s(e.data.fichier), s(e.data.oeuvre_id)]),
    ...mag.liste('pistes').map((p): [string, string] => [s(p.data.fichier), s(p.data.oeuvre_id)]),
  ].filter(([f, id]) => f && id);
  const libraries: Mediatheque[] = dossiers(mag).filter((d) => d.actif !== false && d.chemin).map((d) => {
    const ids = new Set<string>(); for (const [f, id] of fichiersOeuvre) if (sous(f, d.chemin)) ids.add(id);
    return { category: d.categorie, path: d.chemin, exists: lisible(d.chemin), items: ids.size };
  });

  // Activité : lectures (historique), analyses (journal), téléchargements rangés (Comète), versions légères prêtes.
  const activity: Activite[] = [];
  for (const h of mag.liste('historique')) { const qui = personnes.get(s(h.data.profil)); activity.push({ kind: 'play', at: n(h.data.quand), title: s(h.data.titre), ...(qui ? { who: qui.name } : {}) }); }
  for (const j of mag.liste('journal')) if (j.data.genre === 'analyse') activity.push({ kind: 'scan', at: n(j.data.at), ...(j.data.erreur ? { error: true as const } : { n: n(j.data.ajoutes), missing: n(j.data.introuvables) }) });
  for (const c of journalComete(mag, 50)) if (c.quoi === 'terminé' || c.quoi === 'accepté') activity.push({ kind: 'seerr', at: n(c.at), title: s(c.titre) });
  const legeres = { working: 0, queued: 0, progress: undefined as number | undefined };
  for (const e of mag.liste('hors_ligne')) {
    if (e.data.etat === 'ready' && n(e.data.fini)) { const qui = personnes.get(s(e.data.profil)); activity.push({ kind: 'legere', at: n(e.data.fini), title: s(e.data.titre), quality: s(e.data.quality), ...(qui ? { who: qui.name } : {}) }); }
    if (e.data.etat === 'working') { legeres.working++; legeres.progress = n(e.data.progress); }
    if (e.data.etat === 'queued') legeres.queued++;
  }
  activity.sort((a, b) => b.at - a.at);

  const cle = resolve(mag.dir), enCours = analyses.get(cle);
  const derniere = mag.liste('journal').filter((j) => j.data.genre === 'analyse').sort((a, b) => n(b.data.at) - n(a.data.at))[0];
  const m = menage(mag);
  return {
    server: { uptime: Math.round(process.uptime()), zone: fuseauOdin() },
    counts, totals: { ...(size !== undefined ? { size } : {}), ...(secondes !== undefined ? { hours: Math.round(secondes / 3600) } : {}) },
    playing, transcodes: conv ? 1 : 0,
    devices: mag.liste('ecrans').map((e) => ({ name: s(e.data.nom) || e.id, type: s(e.data.type), ...(n(e.data.vu) ? { seen: n(e.data.vu) } : {}) })).sort((a, b) => (b.seen ?? 0) - (a.seen ?? 0)),
    tasks: {
      scan: { running: !!enCours, ...(enCours ? { since: enCours.debut } : {}), ...(derniere ? { last: { at: n(derniere.data.at), ...(derniere.data.erreur ? { error: true as const } : { n: n(derniere.data.ajoutes), missing: n(derniere.data.introuvables) }) } } : {}) },
      vignettes: demanderVignettes(mag, []), fiches: fichesEnAttente(mag),
      legeres: { working: legeres.working, queued: legeres.queued, ...(legeres.progress !== undefined ? { progress: legeres.progress } : {}) },
      ...(m ? { menage: m } : {}),
    },
    system: { cpu: processeur(), mem: memoire(), disks: disques(libraries.map((l) => ({ path: l.path, exists: l.exists, category: l.category }))) },
    activity: activity.slice(0, 20),
    libraries,
  };
}
