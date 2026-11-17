// Talos, le seul endroit des automatisations : la liste « Automatismes » (ce que les applis font toutes seules, les
// automatisations de Talos, les tâches planifiées et routines d'Odin, les rappels, les rendez-vous à rappeler), avec
// « Lancer maintenant », pause, rythme, décaler, supprimer ; l'onglet « Auto » de chaque appli ; « Faire un lien » ;
// l'aperçu d'un rythme en clair ; l'agenda de tous les plannings. Appelé par les branches « default » de draupnir-api.ts.
// Toutes les routes /api/draupnir/* sont réservées au propriétaire (garde des membres).

import { CATALOG } from '../draupnir/nodes.ts';
import { actionLiable, construireLien, evenementsDe, trouverAppli } from '../draupnir/liens.ts';
import { dateMurale, fuseauOdin, instant, phrase, prochaine, prochaineCron, prochaines, texteDate, verifierRythme, versCron, depuisCron, type GenreRythme, type Rythme } from '../draupnir/rythme.ts';
import { planningDe, type Talos } from '../draupnir/service.ts';
import type { Workflow } from '../draupnir/engine.ts';
import { isReminderJob, parseWhen, reminderText } from '../cron/reminders.ts';
import type { JobRow } from '../muninn/store.ts';
import type { Odin } from '../runtime.ts';
import { draupnirOf } from '../tools/draupnir.ts';
import { couperLien, etatLien, nomMoyen, sourcesOdin, type ElementAgenda, type EtatLien, type Ligne, type SourceJobs } from '../valhalla/automatismes.ts';
import { bookingsDe, oublierRappel } from '../valhalla/frigg/perso.ts';
import { lieuCourant } from '../valhalla/lieu.ts';
import { LINKS, type Coupure, type Link, type Protection } from '../valhalla/links.ts';
import { valhallaOf } from '../valhalla/odin.ts';
import type { Valhalla } from '../valhalla/service.ts';

const s = (v: unknown) => String(v ?? '').trim();
const TOUS: GenreRythme[] = ['minutes', 'heures', 'jour', 'semaine', 'mois', 'une_fois', 'cron'];
const REPETES: GenreRythme[] = ['minutes', 'heures', 'jour', 'semaine', 'mois', 'cron'];
const PHRASE_DECLENCHEUR: Record<string, string> = {
  'déclencheur.manuel': 'À la main', 'déclencheur.webhook': 'Quand on appelle son adresse', 'déclencheur.saga': 'Quand Thot change',
  'déclencheur.flux': 'À chaque nouvel article d\'un flux', 'déclencheur.surveille': 'Quand une page change', 'déclencheur.formulaire': 'À chaque formulaire envoyé',
  'déclencheur.appel': 'Appelée par une automatisation', 'déclencheur.erreur': 'Quand une automatisation échoue',
};

interface Contexte { v?: Valhalla; d?: Talos; jobs?: SourceJobs; now: Date }
function contexte(odin?: Odin): Contexte {
  const src = sourcesOdin();
  return { v: valhallaOf(), d: draupnirOf(), jobs: src.jobs ?? (odin?.muninn as unknown as SourceJobs | undefined), now: new Date() };
}
const quand = (d: Date | undefined, now: Date) => (d ? { prochaine: d.toISOString(), prochaineTexte: texteDate(d, undefined, now) } : {});
const nomAppli = (c: Contexte, id?: string) => (id ? c.v?.module(id)?.name ?? id : 'Odin');

// ---------------------------------------------------------------- Les automatisations de Talos

/** Ce que Talos sait d'une automatisation : son rythme en clair, sa prochaine exécution, les applis qu'elle touche. */
export function infosFlow(wf: Pick<Workflow, 'nodes' | 'active' | 'origin'>, v?: Valhalla, now = new Date()): { phrase?: string; prochaine?: string; prochaineTexte?: string; applis: string[]; origin?: string; rythme?: Rythme; plannings: number } {
  const applis = [...new Set(wf.nodes.filter((n) => !n.disabled && (n.type === 'module.action' || n.type === 'déclencheur.module')).map((n) => s(n.params?.module)).filter(Boolean).map((x) => v?.module(x)?.id ?? x))];
  const pl = wf.nodes.filter((n) => n.type === 'déclencheur.planning' && !n.disabled);
  const un = pl.length === 1 ? planningDe(pl[0].params ?? {}) : undefined;
  let dit: string | undefined;
  if (un) dit = un.phrase;
  else if (pl.length > 1) dit = `${pl.length} plannings`;
  else {
    const t = wf.nodes.find((n) => CATALOG.get(n.type)?.trigger && !n.disabled);
    if (t?.type === 'déclencheur.module') {
      // L'événement attendu complète la phrase (sinon « Quand Durinn signale » reste en suspens).
      const app = nomAppliV(v, s(t.params?.module)), ev = s(t.params?.['événement']).replace(/_/g, ' ').trim();
      dit = ev === 'alerte' ? `Quand ${app} lance une alerte (${s(t.params?.niveau) || 'haute'} ou plus)` : ev ? `Quand ${app} signale « ${ev} »` : `Quand ${app} signale un événement`;
    }
    else if (t) dit = PHRASE_DECLENCHEUR[t.type] ?? CATALOG.get(t.type)?.label;
  }
  const suivante = un && wf.active ? prochaine(un.rythme, now) : undefined;
  return { ...(dit ? { phrase: dit } : {}), ...quand(suivante, now), applis, ...(wf.origin ? { origin: wf.origin } : {}), ...(un ? { rythme: un.rythme } : {}), plannings: pl.length };
}
const nomAppliV = (v: Valhalla | undefined, id: string) => v?.module(id)?.name ?? id;

function ligneFlow(c: Contexte, wf: Workflow): Ligne {
  const i = infosFlow(wf, c.v, c.now), r = c.d?.runs(wf.id, 1)[0];
  const der = r ? { at: r.startedAt, ok: r.status === 'succès', ms: r.ms, texte: r.error ?? (r.status === 'succès' ? 'Automatisation réussie.' : r.status) } : undefined;
  const reglable = i.plannings === 1 ? [...TOUS] : [];
  return {
    id: `flow:${wf.id}`, sorte: 'automatisation', applis: i.applis, nom: wf.name, quoi: s(wf.settings?.description) || wf.nodes.map((n) => n.name).join(' → '),
    ...(i.rythme ? { rythme: i.rythme } : {}), phrase: i.phrase ?? 'À la main', reglable, ...(i.prochaine ? { prochaine: i.prochaine, prochaineTexte: i.prochaineTexte } : {}),
    ...(der ? { derniere: der } : {}), etat: !wf.active ? 'arret' : der && !der.ok ? 'erreur' : 'actif',
    lien: { vue: 'flows', flow: wf.id },
    peut: { lancer: true, pause: true, rythme: reglable.length > 0, decaler: false, supprimer: false },
  };
}

// ---------------------------------------------------------------- Tâches planifiées, routines, rappels

function nomJob(j: JobRow): string {
  const t = isReminderJob(j) ? reminderText(j) : j.prompt.replace(/^\[(routine:[^\]]*|habitude)\]\s*/i, '');
  return t.length > 80 ? `${t.slice(0, 79)}…` : t;
}
function rythmeJob(j: JobRow): Rythme {
  if (j.cron === '@reminder') { const m = dateMurale(new Date(j.next_run)); return { genre: 'une_fois', date: m.date, heure: m.heure }; }
  return depuisCron(j.cron);
}
/** Le rythme d'une tâche planifiée en phrase claire (« Chaque jour à 18 h »), comme Talos le montre. */
export function rythmeEnClair(j: JobRow): string { try { return phrase(rythmeJob(j)); } catch { return j.cron; } }
function ligneJob(c: Contexte, j: JobRow): Ligne {
  const rappel = isReminderJob(j), r = rythmeJob(j), unique = j.cron === '@reminder';
  const bk = rappel && c.v?.module('frigg') ? bookingsDe(c.v.ctx('frigg')).find((b) => b.rappelJob === j.id) : undefined;
  const reglable = rappel ? (unique ? [] : [...REPETES]) : [...REPETES];
  const moyen = j.channel ? nomMoyen(j.channel) : sourcesOdin().moyen?.() ?? 'Discussion d\'Odin';
  const routine = /^\[routine:/i.test(j.prompt) ? 'Routine d\'Odin' : /^\[habitude\]/i.test(j.prompt) ? 'Habitude' : 'Tâche planifiée d\'Odin';
  return {
    id: `${rappel ? 'rappel' : 'job'}:${j.id}`, sorte: rappel ? 'rappel' : 'tache_odin', ...(bk ? { appli: 'frigg' } : {}), applis: bk ? ['frigg'] : [],
    nom: nomJob(j), quoi: rappel ? (bk ? `Rappel du rendez-vous « ${bk.name} » (Chronos)` : 'Rappel envoyé sans IA, avec « C\'est fait » et « Plus tard ».') : routine,
    rythme: r, phrase: phrase(r), reglable,
    ...(j.enabled ? quand(new Date(j.next_run), c.now) : {}),
    ...(j.last_run ? { derniere: { at: new Date(j.last_run).toISOString(), ok: true } } : {}),
    etat: j.enabled ? 'actif' : 'pause', moyen,
    ...(bk ? { quand: bk.debut ?? bk.start, quandTexte: texteDate(new Date(bk.debut ?? bk.start), undefined, c.now) } : {}),
    lien: bk ? { vue: 'app', appli: 'frigg' } : { vue: 'jobs' },
    // Un rappel unique se lance en copie (l'original garde son heure) : il faut pouvoir ajouter une tâche.
    peut: { lancer: !unique || Boolean(c.jobs?.addJob), pause: true, rythme: reglable.length > 0, decaler: true, supprimer: true },
  };
}

// ---------------------------------------------------------------- Rendez-vous des clients (rappel la veille, par Chronos)

function lignesRdv(c: Contexte): Ligne[] {
  if (!c.v?.module('frigg')) return [];
  const moyen = sourcesOdin().moyen?.();
  return bookingsDe(c.v.ctx('frigg')).filter((b) => !b.perso && b.status === 'confirmé' && !b.reminded && new Date(b.start).getTime() > c.now.getTime()).slice(0, 50).map((b): Ligne => {
    const debut = new Date(b.start), m = dateMurale(debut), veille = new Date(Date.UTC(+m.date.slice(0, 4), +m.date.slice(5, 7) - 1, +m.date.slice(8, 10) - 1));
    const tz = fuseauOdin(), rappel = instant(veille.getUTCFullYear(), veille.getUTCMonth() + 1, veille.getUTCDate(), 17, 0, tz);
    return {
      id: `rdv:${b.id}`, sorte: 'rendez_vous', appli: 'frigg', applis: ['frigg'], nom: `Rendez-vous de ${b.name}`, quoi: `${b.service} · rappel la veille, sur ta messagerie`,
      phrase: 'La veille, après 17 h', reglable: [], ...quand(rappel.getTime() > c.now.getTime() ? rappel : c.now, c.now), etat: 'actif', ...(moyen ? { moyen } : {}),
      quand: debut.toISOString(), quandTexte: texteDate(debut, undefined, c.now), lien: { vue: 'app', appli: 'frigg' },
      peut: { lancer: false, pause: false, rythme: false, decaler: false, supprimer: false },
    };
  });
}

// ---------------------------------------------------------------- Les liens écrits entre les applis (LINKS)

/**
 * Un lien automatique écrit dans le code d'Odin (src/valhalla/links.ts), montré tel quel dans la liste : quand telle
 * appli signale telle chose → ce qui se fait. Les 21 liens à point unique (`coupure.par === 'reflexe'`) se coupent et
 * se rétablissent depuis la page (`coupable`, et `coupe` quand ils sont coupés) ; les autres restent en lecture seule.
 * `id` : `lien:` + l'identifiant écrit à la main dans links.ts ; `coupure` : comment il pourra se couper.
 * Gardé à part des autres lignes (ni dans l'agenda, ni dans l'onglet « Auto » d'une appli, ni dans les routes qui agissent).
 */
export interface LigneLien {
  id: string; sorte: 'lien_ecrit'; de: string; vers: string; deNom: string; versNom: string;
  quand: string; fait: string; genre: Link['kind']; etat: 'actif' | 'inactif'; protege: Protection | false; coupure: Coupure;
  /** se coupe d'ici (un des 21 liens à point unique) */
  coupable: boolean;
  /** coupé : depuis quand, et jusqu'à quand pour un lien qui protège */
  coupe?: EtatLien;
  /** Pourquoi un lien est inactif : les applis d'Odin ne tournent pas, ou l'une des deux applis du lien est absente. */
  pourquoi?: string;
}
/** Chaque lien écrit, une fois et une seule, dans l'ordre du fichier. */
export function lignesLiensEcrits(v?: Valhalla, liens: readonly Link[] = LINKS): LigneLien[] {
  const nom = (id: string) => v?.module(id)?.name ?? id;
  // Un lien ne marche que si les applis d'Odin tournent et que ses deux applis sont là (comparaison exacte des identifiants).
  const ids = new Set(v?.modules().map((m) => m.id) ?? []);
  const pourquoi = (l: Link) => (!v ? 'les applis d\'Odin ne tournent pas' : [l.from, l.to].filter((x) => !ids.has(x)).map((x) => `appli absente : ${x}`).join(' ; '));
  return liens.map((l) => {
    const p = pourquoi(l), coupable = 'par' in l.coupure && l.coupure.par === 'reflexe';
    const coupe = coupable ? etatLien(pointDeCoupure(l)) : undefined;
    return {
      id: `lien:${l.id}`, sorte: 'lien_ecrit', de: l.from, vers: l.to, deNom: nom(l.from), versNom: nom(l.to),
      quand: l.when, fait: l.does, genre: l.kind, etat: p ? 'inactif' : 'actif', ...(p ? { pourquoi: p } : {}), protege: l.protege, coupure: l.coupure,
      coupable, ...(coupe ? { coupe } : {}),
    };
  });
}

/** L'identifiant sous lequel un lien se coupe : le sien, ou celui du lien qui partage son point (`memePointQue`). */
const pointDeCoupure = (l: Link) => ('memePointQue' in l.coupure && l.coupure.memePointQue) || l.id;
/**
 * Couper ou rétablir un des 21 liens à point unique. SEULEMENT la session du navigateur du propriétaire (ni la clé
 * d'accès, ni un membre, ni une automatisation, ni l'agent) : server.ts le dit dans `sessionProprio`.
 */
function couperDepuisLaPage(c: Contexte, id: string, b: Record<string, unknown>, o: { sessionProprio?: boolean }) {
  if (o.sessionProprio !== true) return ko('interdit', 'Un lien entre applis ne se coupe que par toi, connecté dans ton navigateur, depuis la page des automatisations.');
  const l = LINKS.find((x) => `lien:${x.id}` === id);
  if (!l) return ko('introuvable', 'Lien introuvable.');
  if (!('par' in l.coupure) || l.coupure.par !== 'reflexe') return ko('interdit', "Ce lien ne se coupe pas encore d'ici.");
  if (!c.v) return ko('introuvable', 'Les applis ne sont pas démarrées.');
  const point = pointDeCoupure(l), cible = LINKS.find((x) => x.id === point) ?? l;
  const nom = (x: Link) => `${c.v?.module(x.from)?.name ?? x.from} → ${c.v?.module(x.to)?.name ?? x.to}`;
  // Tous les liens coupés par ce même interrupteur (le capteur et le lien écrit qui le double).
  const memes = LINKS.filter((x) => x.id !== l.id && pointDeCoupure(x) === point && 'par' in x.coupure && x.coupure.par === 'reflexe');
  const prot = l.protege || cible.protege;
  const r = couperLien({
    id: point, nom: `${nom(l)} (quand ${l.when})`, de: cible.from, protege: prot ? { raison: prot.raison } : false,
    ...(memes.length ? { aussi: memes.map((x) => `${nom(x)} (quand ${x.when})`) } : {}),
    qui: 'le propriétaire, depuis la page des automatisations (session du navigateur)',
  }, b.pause === true, { jusqua: s(b.jusqua) || undefined, confirme: b.confirme === true });
  if (!r.ok) return r;
  return { ok: true, lien: lignesLiensEcrits(c.v).find((x) => x.id === id) };
}

/** Toutes les lignes de la liste « Automatismes ». */
export function lignesTalos(c: Contexte): Ligne[] {
  const out: Ligne[] = [];
  try { out.push(...(c.v?.automatismes.lignes() ?? [])); } catch { /* registre indisponible */ }
  try { for (const wf of c.d?.list() ?? []) out.push(ligneFlow(c, wf)); } catch { /* Talos indisponible */ }
  try { for (const j of c.jobs?.listJobs() ?? []) out.push(ligneJob(c, j)); } catch { /* tâches indisponibles */ }
  try { out.push(...lignesRdv(c)); } catch { /* Chronos indisponible */ }
  return out;
}
function compte(l: Ligne[]) {
  const n = (f: (x: Ligne) => boolean) => l.filter(f).length;
  return { veille: n((x) => x.sorte === 'veille'), tache: n((x) => x.sorte === 'tache'), automatisation: n((x) => x.sorte === 'automatisation'), tache_odin: n((x) => x.sorte === 'tache_odin'), rappel: n((x) => x.sorte === 'rappel'), rendez_vous: n((x) => x.sorte === 'rendez_vous'), pause: n((x) => x.etat === 'pause' || x.etat === 'arret'), erreur: n((x) => x.etat === 'erreur') };
}
const trouver = (c: Contexte, id: string) => (id.startsWith('veille:') || id.startsWith('tache:') ? c.v?.automatismes.ligne(id) : lignesTalos(c).find((x) => x.id === id));
const leJob = (c: Contexte, id: string) => c.jobs?.listJobs().find((j) => j.id === id.replace(/^(job|rappel):/, ''));

// ---------------------------------------------------------------- L'agenda de tous les plannings

/** Les plannings d'Odin entre deux dates (jamais de veille ; un rythme de moins d'une heure : un seul élément « en continu »). */
export function agendaTalos(c: Contexte, de: Date, a: Date): ElementAgenda[] {
  const out: ElementAgenda[] = [];
  const el = (d: Date, titre: string, l: Ligne, fin?: Date) => out.push({ quand: d.toISOString(), quandTexte: texteDate(d, undefined, c.now), ...(fin ? { fin: fin.toISOString() } : {}), titre, sorte: l.sorte, ...(l.appli ? { appli: l.appli } : {}), ...(l.moyen ? { moyen: l.moyen } : {}), ligne: l.id });
  // L'écart entre deux passages : une heure ou moins → un seul élément « en continu » ; plusieurs fois par jour → un
  // élément par jour (le premier passage du jour) ; sinon chaque passage.
  const ecart = (r: Rythme) => { if (r.genre === 'secondes') return r.n * 1000; const x = prochaines(r, de, 2); return x.length === 2 ? x[1].getTime() - x[0].getTime() : Infinity; };
  const enMinuscule = (p: string) => `${p.charAt(0).toLowerCase()}${p.slice(1)}`;
  for (const l of lignesTalos(c)) {
    if (l.sorte === 'veille' || l.etat === 'pause' || l.etat === 'arret') continue;
    if (l.sorte === 'rendez_vous') continue; // compté avec les réservations, plus bas
    const r = l.rythme, g = r && r.genre !== 'libre' ? ecart(r) : Infinity;
    if (r && g <= 3600_000) { el(de, `${l.nom} (en continu : ${enMinuscule(l.phrase)})`, l); continue; }
    if (r && r.genre !== 'secondes' && r.genre !== 'libre') {
      const parJour = g < 86_400_000, vus = new Set<string>();
      let t = new Date(de.getTime() - 1);
      for (let k = 0, n = 0; k < 2000 && n < 62; k++) {
        const x = prochaine(r, t); if (!x || x > a) break; t = x;
        if (parJour) { const j = dateMurale(x).date; if (vus.has(j)) continue; vus.add(j); el(x, `${l.nom} (${enMinuscule(l.phrase)})`, l); } else el(x, l.nom, l);
        n++;
      }
    } else if (l.prochaine) { const x = new Date(l.prochaine); if (x >= de && x <= a) el(x, l.nom, l); }
  }
  // Les rendez-vous de Chronos (à toi et des clients).
  if (c.v?.module('frigg')) for (const b of bookingsDe(c.v.ctx('frigg'))) {
    if (b.status === 'annulé') continue;
    const d = new Date(b.debut ?? b.start); if (d < de || d > a) continue;
    const fin = new Date(b.end), l: Ligne = { id: `rdv:${b.id}`, sorte: 'rendez_vous', appli: 'frigg', applis: ['frigg'], nom: b.name, quoi: '', phrase: '', reglable: [], etat: 'actif', peut: { lancer: false, pause: false, rythme: false, decaler: false, supprimer: false }, ...(b.perso && b.rappel !== 'aucun' && b.rappelJob ? { moyen: sourcesOdin().moyen?.() ?? 'Discussion d\'Odin' } : !b.perso ? { moyen: sourcesOdin().moyen?.() ?? '' } : {}) };
    el(d, b.perso ? `Rendez-vous : ${b.name}${b.lieu ? ` (${b.lieu})` : ''}` : `Rendez-vous de ${b.name} · ${b.service}`, l, Number.isNaN(fin.getTime()) ? undefined : fin);
  }
  return out.sort((x, y) => x.quand.localeCompare(y.quand)).slice(0, 500);
}

// ---------------------------------------------------------------- Routes

export async function talosGet(odin: Odin | undefined, path: string, q: URLSearchParams): Promise<unknown> {
  const c = contexte(odin);
  switch (path) {
    case '/api/draupnir/automatismes': {
      const lignes = lignesTalos(c);
      // `liens` : les liens écrits entre applis, à part des lignes (lecture seule).
      let liens: LigneLien[] = []; try { liens = lignesLiensEcrits(c.v); } catch { /* liste indisponible */ }
      return { ok: true, fuseau: fuseauOdin(), ...(lieuCourant()?.nom ? { ville: lieuCourant()!.nom } : {}), maintenant: c.now.toISOString(), lignes, compte: compte(lignes), liens };
    }
    case '/api/draupnir/appli': {
      const m = c.v ? trouverAppli(c.v.modules(), s(q.get('id'))) : undefined;
      if (!m) return { ok: false, code: 'introuvable', error: 'Appli introuvable.' };
      const lignes = lignesTalos(c).filter((l) => l.applis.includes(m.id)), actions = m.actions.map(actionLiable);
      return { ok: true, appli: { id: m.id, nom: m.name }, montrer: lignes.length > 0 || actions.some((a) => !a.grave), lignes, actions, evenements: evenementsDe(m.id) };
    }
    case '/api/draupnir/applis': {
      const l = (c.v?.modules() ?? []).map((m) => ({ id: m.id, nom: m.name, famille: m.family, actions: m.actions.map(actionLiable), evenements: evenementsDe(m.id) }));
      return { ok: true, applis: l.sort((x, y) => x.nom.localeCompare(y.nom, 'fr')) };
    }
    case '/api/draupnir/automatisme/historique': {
      const id = s(q.get('id'));
      if (id.startsWith('veille:') || id.startsWith('tache:')) return { ok: true, passages: c.v?.automatismes.historique(id) ?? [] };
      if (id.startsWith('flow:')) return { ok: true, passages: (c.d?.runs(id.slice(5), 20) ?? []).map((r) => ({ at: r.startedAt, ok: r.status === 'succès', ms: r.ms, texte: r.error ?? (r.status === 'succès' ? 'Automatisation réussie.' : r.status) })) };
      const j = leJob(c, id);
      return { ok: true, passages: j?.last_run ? [{ at: new Date(j.last_run).toISOString(), ok: true }] : [] };
    }
    case '/api/draupnir/agenda': {
      const tz = fuseauOdin(), jours = Math.max(1, Math.min(62, Math.round(Number(q.get('jours')) || 14)));
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s(q.get('de'))) ?? /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateMurale(c.now).date)!;
      const de = instant(+m[1], +m[2], +m[3], 0, 0, tz), a = new Date(de.getTime() + jours * 86_400_000);
      return { ok: true, fuseau: tz, elements: agendaTalos(c, de, a) };
    }
    default: return undefined;
  }
}

type Rep = Record<string, unknown>;
const ko = (code: string, error: string, plus: Rep = {}) => ({ ok: false, code, error, ...plus });
/** Un rythme qui ne partira jamais (une seule fois déjà passée, planning qui ne tombe jamais) : la phrase d'erreur, sinon undefined. */
function jamais(r: Rythme, now: Date): string | undefined {
  if (r.genre !== 'une_fois' && r.genre !== 'cron') return undefined;
  if (prochaine(r, now)) return undefined;
  return r.genre === 'une_fois' ? 'Cette date est déjà passée.' : 'Ce planning ne tombe jamais.';
}

export async function talosPost(odin: Odin | undefined, path: string, b: Record<string, unknown>, o: { sessionProprio?: boolean } = {}): Promise<unknown> {
  const c = contexte(odin), id = s(b.id);
  switch (path) {
    case '/api/draupnir/rythme/apercu': {
      const v = verifierRythme(b.rythme !== undefined ? b.rythme : { genre: 'cron', cron: s(b.cron) });
      if (!v.ok) return ko('invalide', v.error);
      const nul = jamais(v.rythme, c.now); if (nul) return ko('invalide', nul);
      const p = prochaines(v.rythme, c.now, 3), cron = versCron(v.rythme);
      return { ok: true, rythme: v.rythme, phrase: phrase(v.rythme), ...(cron ? { cron } : {}), prochaines: p.map((d) => d.toISOString()), prochainesTexte: p.map((d) => texteDate(d, undefined, c.now)), fuseau: fuseauOdin(), ...(lieuCourant()?.nom ? { ville: lieuCourant()!.nom } : {}) };
    }
    case '/api/draupnir/automatisme/lancer': {
      if (id.startsWith('veille:') || id.startsWith('tache:')) return c.v ? await c.v.automatismes.lancer(id) : ko('introuvable', 'Les applis ne sont pas démarrées.');
      if (id.startsWith('flow:')) {
        if (!c.d?.get(id.slice(5))) return ko('introuvable', 'Automatisation introuvable.');
        // Un passage (planifié, déclenché ou lancé à la main) tourne encore : pas de seconde exécution par-dessus.
        if (c.d.enCours(id.slice(5))) return ko('en_cours', 'Elle tourne déjà : attends la fin de ce passage.');
        const ex = await c.d.run(id.slice(5), undefined, 'manuel');
        return { ok: true, resultat: { ok: ex.status === 'succès', ms: ex.ms, texte: ex.error ?? 'Automatisation réussie.', at: ex.startedAt } };
      }
      if (id.startsWith('rdv:')) return ko('interdit', 'Lecture seule : ce rappel part la veille, depuis Chronos.');
      const j = leJob(c, id); if (!j) return ko('introuvable', 'Tâche introuvable.');
      if (!j.enabled) return ko('interdit', 'Elle est en pause : reprends-la d\'abord.');
      if (j.cron === '@reminder') {
        // Un rappel unique part une fois puis s'efface : on envoie une copie maintenant, l'original garde son heure
        // (le rappel d'un rendez-vous de Chronos partira donc toujours à son heure).
        if (!c.jobs?.addJob) return ko('interdit', 'Décale-le plutôt : lancé maintenant, il ne partirait plus à son heure.');
        c.jobs.addJob({ id: `rem_${c.now.getTime().toString(36)}_${Math.random().toString(36).slice(2, 6)}`, cron: '@reminder', prompt: j.prompt, channel: j.channel, peer: j.peer, next_run: c.now.getTime(), tainted: j.tainted ? 1 : 0 });
      } else setNext(c, j.id, c.now.getTime());
      const moyen = j.channel ? nomMoyen(j.channel) : sourcesOdin().moyen?.() ?? 'Telegram';
      return { ok: true, resultat: { ok: true, ms: 0, texte: `Part dans la minute sur ${moyen}.`, at: c.now.toISOString() } };
    }
    case '/api/draupnir/automatisme/pause': {
      const pause = b.pause === true;
      if (id.startsWith('lien:')) return couperDepuisLaPage(c, id, b, o);
      if (id.startsWith('veille:') || id.startsWith('tache:')) return c.v ? c.v.automatismes.pause(id, pause, { jusqua: s(b.jusqua) || undefined, confirme: b.confirme === true }) : ko('introuvable', 'Les applis ne sont pas démarrées.');
      if (id.startsWith('flow:')) {
        if (!c.d?.get(id.slice(5))) return ko('introuvable', 'Automatisation introuvable.');
        try { c.d.setActive(id.slice(5), !pause); } catch (e) { return ko('invalide', (e as Error).message); }
        return { ok: true, ligne: trouver(c, id) };
      }
      if (id.startsWith('rdv:')) return ko('invalide', 'Lecture seule : ce rappel se règle dans Chronos.');
      const j = leJob(c, id); if (!j) return ko('introuvable', 'Tâche introuvable.');
      if (c.jobs?.setJobEnabled) c.jobs.setJobEnabled(j.id, !pause); else sourcesOdin().majJob?.activer?.(j.id, !pause);
      return { ok: true, ligne: trouver(c, id) };
    }
    case '/api/draupnir/automatisme/rythme': {
      const l = trouver(c, id); if (!l) return ko('introuvable', 'Automatisme introuvable.');
      { const v0 = verifierRythme(b.rythme), nul = v0.ok ? jamais(v0.rythme, c.now) : undefined; if (nul) return ko('invalide', nul); }
      if (id.startsWith('veille:') || id.startsWith('tache:')) return c.v!.automatismes.rythme(id, b.rythme);
      const v = verifierRythme(b.rythme); if (!v.ok) return ko('invalide', v.error);
      if (!l.reglable.includes(v.rythme.genre)) return ko('invalide', l.reglable.length ? 'Ce rythme ne convient pas ici.' : (l.sorte === 'rappel' ? 'Un rappel unique se décale ; il ne se répète pas.' : 'Ce rythme ne se règle pas ici.'));
      if (id.startsWith('flow:')) {
        const wf = c.d!.get(id.slice(5))!, pl = wf.nodes.filter((n) => n.type === 'déclencheur.planning' && !n.disabled);
        if (pl.length !== 1) return ko('invalide', 'Il faut un seul nœud Planning pour régler le rythme d\'ici : ouvre l\'éditeur.');
        pl[0].params = { ...pl[0].params, mode: 'simple', rythme: v.rythme };
        try { c.d!.save(wf); } catch (e) { return ko('invalide', (e as Error).message); }
        return { ok: true, ligne: trouver(c, id) };
      }
      const cron = versCron(v.rythme); if (!cron) return ko('invalide', 'Ce rythme ne s\'écrit pas en planning (le 29, 30 ou 31 du mois, ou toutes les N minutes qui ne tombent pas juste dans l\'heure).');
      const j = leJob(c, id)!, next = (prochaineCron(cron, c.now) ?? new Date(c.now.getTime() + 60_000)).getTime();
      if (c.jobs?.setJobCron) c.jobs.setJobCron(j.id, cron, next); else sourcesOdin().majJob?.cron?.(j.id, cron, next);
      return { ok: true, ligne: trouver(c, id) };
    }
    case '/api/draupnir/automatisme/decaler': {
      if (!/^(job|rappel):/.test(id)) return ko('invalide', 'Seuls les rappels et les tâches planifiées se décalent.');
      const j = leJob(c, id); if (!j) return ko('introuvable', 'Tâche introuvable.');
      const t = s(b.quand), iso = /^\d{4}-\d{2}-\d{2}T/.test(t) ? new Date(t) : parseWhen(t, c.now);
      if (!iso || Number.isNaN(iso.getTime())) return ko('invalide', `Je ne comprends pas « ${t} » (ex. « demain 8 h »).`);
      if (iso.getTime() <= c.now.getTime()) return ko('invalide', 'Cette date est déjà passée.');
      setNext(c, j.id, iso.getTime());
      return { ok: true, ligne: trouver(c, id) };
    }
    case '/api/draupnir/automatisme/supprimer': {
      if (!/^(job|rappel):/.test(id)) return ko('interdit', 'Non supprimable : mets-le en pause.');
      const j = leJob(c, id); if (!j) return ko('introuvable', 'Tâche introuvable.');
      if (b.confirme !== true) return { ok: false, code: 'accord', confirm: `Supprimer « ${nomJob(j)} » ? Il ne partira plus.`, error: 'Confirme la suppression.' };
      c.jobs!.removeJob(j.id);
      if (c.v?.module('frigg')) oublierRappel(c.v.ctx('frigg'), j.id); // le rappel d'un rendez-vous passe à « aucun »
      return { ok: true };
    }
    case '/api/draupnir/lien': {
      if (!c.v) return ko('introuvable', 'Les applis ne sont pas démarrées.');
      if (!c.d) return ko('invalide', 'Talos n\'est pas démarré.');
      const q = b.quand as { sorte?: unknown; rythme?: unknown } | undefined;
      if (q?.sorte === 'rythme') { const v0 = verifierRythme(q.rythme), nul = v0.ok ? jamais(v0.rythme, c.now) : undefined; if (nul) return ko('invalide', nul); }
      const r = construireLien(b as never, c.v.modules());
      if (!r.ok) return { ok: false, code: r.code, error: r.error, ...(r.etape !== undefined ? { etape: r.etape } : {}) };
      try { return { ok: true, flow: c.d.save(r.flow), phrase: r.phrase }; } catch (e) { return ko('invalide', (e as Error).message); }
    }
    default: return undefined;
  }
}
function setNext(c: Contexte, id: string, next: number): void { if (c.jobs?.setJobNext) c.jobs.setJobNext(id, next); else sourcesOdin().majJob?.prochaine?.(id, next); }

/** La source « agenda » que lit Chronos (posée au démarrage). */
export const agendaPourChronos = (odin?: Odin) => (de: Date, a: Date): ElementAgenda[] => agendaTalos(contexte(odin), de, a);
/** Pour les essais : le contexte construit à partir des sources posées. */
export const contexteTalos = contexte;
