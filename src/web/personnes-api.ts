// Fenêtre Profil, lot 2 — la route des personnes qui parlent à Odin : la liste, la carte de la personne choisie, sa
// ligne de temps (paginée), la note libre du propriétaire, l'effacement à la main (aperçu puis confirmation), et le
// signalement d'une erreur par un membre sur SA fiche. Lot 3 : ce qu'Odin a mesuré d'une personne (lecture, mêmes gardes)
// et, pour le propriétaire seul, cacher, corriger ou annuler la correction d'une mesure.
// - QUI VOIT : une seule fonction décide, peutVoir (src/muninn/personnes.ts). Le propriétaire voit tout ; un membre de la
//   maison seulement la sienne, en lecture, et seulement si le lien entre son compte Persona et sa personne est sûr ; un
//   invité rien ; sans connexion : refus.
// - Rien de ce qui est ici ne va dans l'état général de la page (/api/state).
// - Aucun droit n'est donné, retiré ni changé ici : la carte MONTRE l'état des droits, en lecture, dans ses deux registres
//   (rôle et autonomie : mémoire d'Odin ; accès aux applis, groupes, compte, appareils : Persona). Lot 5b : le bloc
//   « Droits » de la page change un droit en appelant les actions qui existent (/api/action, /api/valhalla/act), jamais ici.
// - Le propriétaire voit, dans l'historique d'une personne, les lignes du journal des droits qui la concernent (rangées
//   à son nom à lui) ; un membre ne les voit pas (« prévenir seulement si elle essaie »).
// - Les réponses portent des CODES (rôle, preuve, résultat, refus) : la page les traduit dans la langue de la personne.
// Modèle : epingles-api.ts — une fonction pure (traiterPersonnes) et des dépendances injectées ; la route est appelée par
// le serveur web AVANT la garde des membres, et décide elle-même qui demande.

import type { IncomingMessage, ServerResponse } from 'node:http';
import { createHash } from 'node:crypto';
import type { LigneHistorique, Mnemosyne } from '../muninn/store.ts';
import {
  PROPRIETAIRE, apercuEffacement, carte, cartes, contexteVisibilite, effacerHistoriquePersonne, historiquePersonne, mesuresPersonne, peutVoir, preuveDe,
  reglerMesure, type BilanEffacement, type Carte, type Demandeur,
} from '../muninn/personnes.ts';
import type { CleMesure } from '../muninn/traits.ts';
import { membreDe } from '../valhalla/sso/garde.ts';
import {
  POSTE_INACTIF, RENOUV_INACTIF, aDroit, applisDe, groupesDe, lierProprietaire, nomAppli, persona, personnes, sessionsApplis, sessionsPostes, vivante,
} from '../valhalla/sso/etat.ts';
import { applisConnues } from '../valhalla/sso/persona.ts';
import { postNotice } from '../valhalla/notices.ts';

/** Les codes d'erreur que la page sait dire (son dictionnaire doit les avoir tous). */
export const CODES_ERREUR = ['connexion', 'x_odin', 'methode', 'invalide', 'inconnu', 'refuse', 'reserve', 'change', 'trop', 'indisponible', 'disque'] as const;
export type CodeErreur = typeof CODES_ERREUR[number];

export const PAGE_MAX = 100, PAGE_DEFAUT = 30, NOTE_MAX = 2000, SIGNALEMENT_MAX = 500;

export interface DepsPersonnes {
  mu: Mnemosyne;
  /** Les personnes de Persona (pour nommer le lien posé à la main). Sans Persona : []. */
  personnesPersona(): ReadonlyArray<{ id: string; login?: string; name?: string }>;
  /** Les groupes et les applis qu'une personne de Persona peut ouvrir (lecture seule) ; undefined : inconnue ou Persona arrêté. */
  accesDe(personaId: string): { groupes: string[]; applis: Array<{ id: string; nom: string }> } | undefined;
  /** Ce que Persona dit des droits d'une personne (lecture seule) ; undefined : inconnue ou Persona arrêté. */
  droitsDe?(personaId: string): DroitsPersona | undefined;
  /** Prévient le propriétaire qu'un membre signale une erreur sur sa fiche ; false si personne ne peut être prévenu. */
  prevenir(s: { nom: string; texte: string }): boolean;
  maintenant?(): number;
}
/**
 * L'état des droits d'une personne dans Persona, en lecture : son compte (actif ou coupé), ses groupes, chaque appli à qui
 * l'on peut donner un droit avec d'où vient son accès (`personnel` : « @login » à elle seule ; `par` : le groupe admin, ses
 * groupes autorisés, ou « * » toute personne connectée), et ses appareils connectés. Des codes et des noms : la page traduit.
 */
export interface DroitsPersona {
  login: string; actif: boolean; admin: boolean; groupes: string[];
  applis: Array<{ id: string; nom: string; personnel: boolean; par: string[] }>;
  appareils: Array<{ id?: string; sorte: 'poste' | 'appli'; appli?: string; nom: string; plateforme: string; vu: number }>;
}
export interface Requete { methode: string; chemin: string; query: URLSearchParams; corps?: Record<string, unknown>; demandeur: Demandeur }
export interface Sortie { code: number; body: Record<string, unknown> }

const refus = (code: number, c: CodeErreur, extra: Record<string, unknown> = {}): Sortie => ({ code, body: { ok: false, code: c, ...extra } });
const ok = (body: Record<string, unknown>): Sortie => ({ code: 200, body: { ok: true, ...body } });
const estProprio = (d: Demandeur) => d.sorte === 'proprietaire';

/** Le propriétaire sans (ou avec plusieurs) fiche dans la mémoire d'Odin : une entrée « proprietaire » le représente. */
function carteProprietaire(): Carte & { synthetique: true } {
  return { id: PROPRIETAIRE, nom: '', role: 'owner', autonomie: 'autonome', identites: [], persona: null, note: '', portrait: null, synthetique: true };
}
function toutesLesCartes(d: DepsPersonnes): Array<Carte & { synthetique?: true }> {
  const l: Array<Carte & { synthetique?: true }> = cartes(d.mu, d.personnesPersona());
  if (l.filter((c) => c.role === 'owner').length !== 1) l.unshift(carteProprietaire());
  return l;
}
const canauxDe = (c: Carte) => [...new Set(c.identites.map((i) => i.canal))];

/** La carte telle qu'un demandeur a le droit de la voir : un membre ne reçoit ni la note du propriétaire ni ses réglages. */
function carteVue(c: Carte & { synthetique?: true }, d: DepsPersonnes, proprio: boolean): Record<string, unknown> {
  const identites = c.identites.map((i) => ({ ...i, preuve: preuveDe({ canal: i.canal, proprietaire: c.role === 'owner', connu: true }) }));
  const acces = c.persona ? d.accesDe(c.persona.id) ?? null : null;
  // Les droits dans Persona : un membre lit les siens — les seules applis qu'il peut ouvrir (pas tout le catalogue), sans
  // les identifiants de ses connexions (rien à couper pour lui).
  const dr = c.persona && d.droitsDe ? d.droitsDe(c.persona.id) ?? null : null;
  const droits = dr && !proprio
    ? { ...dr, applis: dr.applis.filter((a) => a.personnel || a.par.length), appareils: dr.appareils.map(({ id: _id, ...x }) => x) }
    : dr;
  return {
    id: c.id, nom: c.nom, role: c.role, autonomie: c.synthetique ? null : c.autonomie, identites, persona: c.persona, acces, droits,
    ...(proprio ? { note: c.note, notable: !c.synthetique } : {}), portrait: c.portrait, ...(c.synthetique ? { synthetique: true } : {}),
  };
}

/** Les lignes du journal des droits qui concernent une personne (pour elle : son id, ou « @login » dans Persona). */
type LigneDroit = LigneHistorique & { droit?: Record<string, unknown> };
function droitsPour(mu: Mnemosyne, c: Carte): LigneDroit[] {
  const cles = new Set([c.id, ...(c.persona?.login ? [`@${c.persona.login}`] : [])]);
  return mu.lignesHistorique((l) => (l.sorte as string) === 'droit' && cles.has(String((l as LigneDroit).droit?.pour ?? ''))) as LigneDroit[];
}
const DROIT_CHAMPS = ['registre', 'pour', 'quoi', 'avant', 'apres', 'sens'] as const;

/** Le jeton qui lie la confirmation à l'aperçu : la cible exacte et les lignes exactes qui seront retirées. */
function jetonDe(qui: string, depuis: number | undefined, jusqua: number, ids: number[]): string {
  return createHash('sha256').update(JSON.stringify({ qui, depuis: depuis ?? null, jusqua, ids })).digest('hex').slice(0, 32);
}
function periode(corps: Record<string, unknown> | undefined, maintenant: number): { depuis?: number; jusqua: number } | undefined {
  const n = (v: unknown) => (v === undefined || v === null || v === '' ? undefined : Number(v));
  const depuis = n(corps?.depuis), j = n(corps?.jusqua);
  if (depuis !== undefined && (!Number.isFinite(depuis) || depuis < 0)) return undefined;
  if (j !== undefined && (!Number.isFinite(j) || j < 0)) return undefined;
  // Sans fin donnée, la période s'arrête à l'instant de l'aperçu : une demande arrivée ensuite n'est jamais effacée.
  const jusqua = Math.min(j ?? maintenant, maintenant);
  if (depuis !== undefined && depuis > jusqua) return undefined;
  return { ...(depuis !== undefined ? { depuis } : {}), jusqua };
}

/** Les mesures d'une personne telles que le demandeur a le droit de les voir (la fonction de Muninn décide). */
function mesuresVues(d: DepsPersonnes, dm: Demandeur, id: string, maintenant: number): Sortie {
  const m = mesuresPersonne(d.mu, dm, id, { maintenant });
  if (!m.ok) return m.raison === 'personne-inconnue' ? refus(404, 'inconnu') : refus(403, 'refuse', { raison: m.raison });
  return ok({ calculeLe: m.calculeLe, mesures: m.mesures });
}

// Un membre ne signale pas plus de 3 erreurs par heure (le propriétaire n'est pas inondé).
const signalements = new Map<string, number[]>();

/** La logique de la route (pure, hors de l'écriture disque faite par la mémoire d'Odin). */
export function traiterPersonnes(q: Requete, d: DepsPersonnes): Sortie {
  const maintenant = d.maintenant?.() ?? Date.now();
  const dm = q.demandeur, proprio = estProprio(dm);
  if (dm.sorte === 'invite') return refus(403, 'refuse', { raison: 'invite' });
  const parts = q.chemin.split('/').filter(Boolean).map((x) => { try { return decodeURIComponent(x); } catch { return '\u0000'; } });
  const ctx = contexteVisibilite(d.mu);
  const voir = (id: string) => peutVoir(dm, id, ctx);
  const get = q.methode === 'GET', post = q.methode === 'POST';

  // GET /api/personnes : la liste (le propriétaire : tout le monde et le compteur des inconnus ; un membre : la sienne).
  if (parts.length === 0) {
    if (!get) return refus(405, 'methode');
    const l = toutesLesCartes(d);
    const visibles = l.filter((c) => voir(c.id).ok);
    // Un membre sans fiche visible : la raison du refus (lien absent, douteux, réglage), sans rien dire des autres.
    if (!proprio && !visibles.length) return refus(403, 'refuse', { raison: voir('\u0000').raison });
    const inconnus = proprio ? d.mu.inconnus() : undefined;
    return ok({
      proprietaire: proprio, reglage: ctx.reglage,
      personnes: visibles.map((c) => ({ id: c.id, nom: c.nom, role: c.role, canaux: canauxDe(c), ...(c.synthetique ? { synthetique: true } : {}) })),
      ...(inconnus ? { inconnus: { total: Object.values(inconnus).reduce((s, x) => s + x.n, 0), parCanal: Object.fromEntries(Object.entries(inconnus).map(([k, v]) => [k, v.n])) } } : {}),
    });
  }

  // POST /api/personnes/moi/signaler : un membre signale une erreur sur SA fiche au propriétaire.
  if (parts[0] === 'moi' && parts[1] === 'signaler' && parts.length === 2) {
    if (!post) return refus(405, 'methode');
    if (proprio) return refus(400, 'invalide', { raison: 'proprietaire' });
    const sienne = toutesLesCartes(d).find((c) => voir(c.id).ok);
    if (!sienne) return refus(403, 'refuse', { raison: voir('\u0000').raison });
    const texte = String(q.corps?.texte ?? '').replace(/\s+/g, ' ').trim();
    if (!texte || texte.length > SIGNALEMENT_MAX) return refus(400, 'invalide', { max: SIGNALEMENT_MAX });
    const cle = dm.sorte === 'membre' ? dm.personaId : '', recents = (signalements.get(cle) ?? []).filter((t) => maintenant - t < 3_600_000);
    if (recents.length >= 3) return refus(429, 'trop');
    if (!d.prevenir({ nom: sienne.nom, texte })) return refus(503, 'indisponible');
    signalements.set(cle, [...recents, maintenant]);
    return ok({ envoye: true });
  }

  const id = parts[0];
  const c = toutesLesCartes(d).find((x) => x.id === id);
  if (!c) return proprio ? refus(404, 'inconnu') : refus(403, 'refuse', { raison: 'autre-personne' });
  const v = voir(id);
  if (!v.ok) return refus(403, 'refuse', { raison: v.raison });

  // GET /api/personnes/:id : la carte.
  if (parts.length === 1) {
    if (!get) return refus(405, 'methode');
    return ok({ proprietaire: proprio, carte: carteVue(c, d, proprio) });
  }

  // GET /api/personnes/:id/historique?avant=<t>-<id>&n= : la ligne de temps, la plus récente d'abord.
  if (parts[1] === 'historique' && parts.length === 2) {
    if (!get) return refus(405, 'methode');
    const n = Math.max(1, Math.min(PAGE_MAX, Math.floor(Number(q.query.get('n')) || PAGE_DEFAUT)));
    const av = /^(\d{1,16})-(\d{1,12})$/.exec(q.query.get('avant') ?? '');
    // Le propriétaire voit aussi, chez une autre personne, les changements de ses droits (journal rangé à son nom à lui).
    const extra = proprio && !c.synthetique && c.role !== 'owner' ? droitsPour(d.mu, c) : [];
    const tous: LigneDroit[] = [...historiquePersonne(d.mu, id), ...extra].sort((a, b) => b.t - a.t || b.id - a.id);
    const apres = av ? tous.filter((l) => l.t < Number(av[1]) || (l.t === Number(av[1]) && l.id < Number(av[2]))) : tous;
    const page = apres.slice(0, n);
    const lignes = page.map((l) => {
      const m = l.mission ? d.mu.getMission(l.mission) : undefined;
      const dr = proprio && (l.sorte as string) === 'droit' && l.droit ? Object.fromEntries(DROIT_CHAMPS.map((k) => [k, String(l.droit![k] ?? '')])) : undefined;
      return { id: l.id, t: l.t, sorte: l.sorte, canal: l.canal, preuve: l.preuve, partage: l.partage, resultat: l.resultat ?? null, ...(m?.goal ? { quoi: m.goal.slice(0, 240) } : {}), ...(dr ? { droit: dr } : {}) };
    });
    const der = page.at(-1);
    return ok({ lignes, total: tous.length, ...(apres.length > n && der ? { suite: `${der.t}-${der.id}` } : {}) });
  }

  // GET /api/personnes/:id/mesures : ce qu'Odin a mesuré d'elle (lot 3). Un membre : les siennes, sans les mesures
  // cachées ni la valeur d'origine d'une mesure corrigée (mesuresPersonne repasse par peutVoir et retire les deux).
  if (parts[1] === 'mesures' && parts.length === 2) {
    if (!get) return refus(405, 'methode');
    return mesuresVues(d, dm, id, maintenant);
  }

  // Tout le reste écrit : le propriétaire seul.
  if (!post) return refus(405, 'methode');
  if (!proprio) return refus(403, 'reserve');

  // POST /api/personnes/:id/mesures/:cle { cacher: bool } | { corriger: valeur } | { annuler: true } : une action à la fois.
  if (parts[1] === 'mesures' && parts.length === 3) {
    const corps = q.corps ?? {}, actions = ['cacher', 'corriger', 'annuler'].filter((k) => corps[k] !== undefined);
    if (actions.length !== 1) return refus(400, 'invalide', { raison: 'une-action' });
    const a = actions[0];
    if (a === 'cacher' && typeof corps.cacher !== 'boolean') return refus(400, 'invalide', { raison: 'une-action' });
    if (a === 'annuler' && corps.annuler !== true) return refus(400, 'invalide', { raison: 'une-action' });
    let r: ReturnType<typeof reglerMesure>;
    try { r = reglerMesure(d.mu, dm, id, parts[2] as CleMesure, a === 'cacher' ? { cacher: corps.cacher as boolean } : a === 'corriger' ? { corriger: corps.corriger } : { annuler: true }); } catch { return refus(500, 'disque'); }
    if (!r.ok) return r.raison === 'proprietaire-seul' ? refus(403, 'reserve') : r.raison === 'personne-inconnue' ? refus(404, 'inconnu') : refus(400, 'invalide', { raison: r.raison });
    return mesuresVues(d, dm, id, maintenant);
  }

  // POST /api/personnes/:id/note { texte } : la note libre du propriétaire (écrite, corrigée, ou vidée).
  if (parts[1] === 'note' && parts.length === 2) {
    if (c.synthetique) return refus(400, 'invalide', { raison: 'sans-fiche' });
    const texte = q.corps?.texte;
    if (typeof texte !== 'string' || texte.length > NOTE_MAX) return refus(400, 'invalide', { max: NOTE_MAX });
    try { d.mu.ecrireNotePersonne(c.id, texte); } catch { return refus(500, 'disque'); }
    return ok({ note: d.mu.notePersonne(c.id) });
  }

  // POST /api/personnes/:id/effacer/apercu { depuis?, jusqua? } : ce qui SERAIT retiré, ce qui resterait ailleurs.
  // POST /api/personnes/:id/effacer { depuis?, jusqua, jeton } : efface exactement ce que l'aperçu a dit, sinon refus.
  if (parts[1] === 'effacer' && (parts.length === 2 || (parts.length === 3 && parts[2] === 'apercu'))) {
    const p = periode(q.corps, maintenant);
    if (!p) return refus(400, 'invalide', { raison: 'periode' });
    const ids = historiquePersonne(d.mu, id, p).map((l) => l.id).sort((a, b) => a - b);
    const jeton = jetonDe(id, p.depuis, p.jusqua, ids);
    const b0: BilanEffacement = apercuEffacement(d.mu, { qui: id, ...p });
    // Les changements de ses droits sont au journal du propriétaire : l'effacement ne les retire pas, l'aperçu le dit.
    const bilan = { ...b0, reste: { ...b0.reste, droits: !c.synthetique && c.role !== 'owner' ? droitsPour(d.mu, c).length : 0 } };
    if (parts.length === 3) return ok({ cible: { id, ...p }, bilan, jeton });
    if (typeof q.corps?.jeton !== 'string' || q.corps.jeton !== jeton) return refus(409, 'change', { cible: { id, ...p }, bilan, jeton });
    try { return ok({ bilan: effacerHistoriquePersonne(d.mu, { qui: id, ...p }) }); } catch { return refus(500, 'disque'); }
  }
  return refus(404, 'inconnu');
}

// ---------------------------------------------------------------- La route

export interface DepsRoute {
  /** la requête vient-elle du propriétaire (session ou clé d'API), et pas d'un membre ? */ proprietaire(): boolean;
  mu: Mnemosyne;
  /** l'appli du port direct par lequel la requête arrive (un membre n'ouvre pas le Profil par le port d'une appli) */ direct?: string;
  /** un essai raté */ fail(): void;
}
const s = (v: unknown) => (v === undefined || v === null ? '' : String(v)).trim();
function json(res: ServerResponse, code: number, body: unknown): void {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  res.end(JSON.stringify(body));
}
async function lireCorps(req: IncomingMessage): Promise<Record<string, unknown> | undefined> {
  const parts: Buffer[] = []; let n = 0;
  for await (const c of req) { n += (c as Buffer).length; if (n > 16 * 1024) return undefined; parts.push(c as Buffer); }
  try { const j = JSON.parse(Buffer.concat(parts).toString('utf8') || '{}') as unknown; return j && typeof j === 'object' && !Array.isArray(j) ? j as Record<string, unknown> : undefined; } catch { return undefined; }
}

/** Les dépendances réelles : Persona (lecture seule) et les bulles du propriétaire. */
export function depsReelles(mu: Mnemosyne): DepsPersonnes {
  return {
    mu,
    personnesPersona: () => { const ctx = persona(); return ctx ? personnes(ctx).map((p) => ({ id: p.id, login: p.login, name: p.name })) : []; },
    accesDe: (pid) => {
      const ctx = persona(); const p = ctx ? personnes(ctx).find((x) => x.id === pid) : undefined;
      if (!ctx || !p) return undefined;
      return { groupes: [...(p.groups ?? [])], applis: applisDe(ctx, p).map((id) => ({ id, nom: nomAppli(ctx, id) })) };
    },
    droitsDe: (pid) => {
      const ctx = persona(); const p = ctx ? personnes(ctx).find((x) => x.id === pid) : undefined;
      if (!ctx || !p) return undefined;
      const moi = `@${p.login}`, admin = Boolean(p.proprio || p.groups.includes('admin')), now = Date.now();
      return {
        login: p.login, actif: p.active !== false, admin, groupes: [...p.groups],
        applis: applisConnues(ctx).map((a) => {
          const g = groupesDe(ctx, a.id);
          return { id: a.id, nom: a.nom, personnel: g.includes(moi), par: [...(admin ? ['admin'] : []), ...g.filter((x) => x === '*' || (x !== 'admin' && !x.startsWith('@') && p.groups.includes(x)))] };
        }),
        appareils: [
          ...sessionsPostes(ctx).filter((x) => x.sub === p.id && vivante(x, POSTE_INACTIF, now)).map((x) => ({ id: x.id, sorte: 'poste' as const, nom: x.appareil.nom, plateforme: x.appareil.plateforme, vu: x.vu })),
          ...sessionsApplis(ctx).filter((x) => x.sub === p.id && vivante(x, RENOUV_INACTIF, now)).map((x) => ({ id: x.id, sorte: 'appli' as const, appli: nomAppli(ctx, x.appli), nom: x.appareil.nom, plateforme: x.appareil.plateforme, vu: x.vu })),
        ],
      };
    },
    prevenir: ({ nom, texte }) => Boolean(postNotice({
      level: 'souci', module: 'var', app: 'Profil', kind: 'Profil', title: `${nom || 'Une personne'} signale une erreur sur sa fiche`, detail: texte,
      steps: ['Ouvre Profil, puis sa carte, pour vérifier.', 'Corrige la note, ou ses réglages dans Réglages › Personnes ou dans Persona.'],
      page: { view: 'profil' }, source: 'info',
    })),
  };
}

/** GET et POST /api/personnes… Rend true si la requête est servie ici. */
export async function personnesRoute(req: IncomingMessage, res: ServerResponse, url: URL, d: DepsRoute, deps?: DepsPersonnes): Promise<boolean> {
  if (url.pathname !== '/api/personnes' && !url.pathname.startsWith('/api/personnes/')) return false;
  const meth = req.method ?? 'GET';
  if (meth !== 'GET' && meth !== 'POST') { json(res, 405, { ok: false, code: 'methode' }); return true; }
  // Qui demande ? Un membre de Persona (cookie), sinon le propriétaire (session ou clé d'API), sinon personne.
  let demandeur: Demandeur;
  const m = membreDe(s(req.headers.cookie));
  if (m) {
    const ctx = persona(), pr = ctx ? lierProprietaire(ctx) : undefined;
    const lui = Boolean(m.p.proprio || (pr && (m.p.id === pr.id || (pr.email && m.p.email && pr.email.toLowerCase() === m.p.email.toLowerCase()))));
    if (lui) demandeur = { sorte: 'proprietaire' };
    else if (d.direct || !aDroit(m.ctx, m.p, 'odin')) { json(res, 403, { ok: false, code: 'refuse', raison: 'invite' }); return true; }
    else demandeur = { sorte: 'membre', personaId: m.p.id };
  } else if (d.proprietaire()) demandeur = { sorte: 'proprietaire' };
  else { d.fail(); json(res, 401, { ok: false, code: 'connexion' }); return true; } // un essai raté, compté comme ailleurs
  const bearer = /^Bearer\s+\S+$/i.test(s(req.headers.authorization));
  if (meth === 'POST' && !bearer && req.headers['x-odin'] !== '1') { json(res, 403, { ok: false, code: 'x_odin' }); return true; }
  let corps: Record<string, unknown> | undefined;
  if (meth === 'POST') { corps = await lireCorps(req); if (!corps) { json(res, 400, { ok: false, code: 'invalide' }); return true; } }
  const r = traiterPersonnes({ methode: meth, chemin: url.pathname.slice('/api/personnes'.length), query: url.searchParams, corps, demandeur }, deps ?? depsReelles(d.mu));
  json(res, r.code, r.body); return true;
}
