// Profil, lot 1 — les personnes qui parlent à Odin, côté données seulement (aucun écran, aucun droit modifié).
//
// - LA PERSONNE est celle que la mémoire d'Odin tient déjà (UserRow, store.ts) : pas de troisième registre. Sa carte
//   est CALCULÉE : nom, rôle, autonomie, identités, la personne de Persona reliée QUAND un lien a été posé à la main
//   (jamais deviné par le nom ; ce lot le lit seulement), la note libre du propriétaire.
// - SON HISTORIQUE : des renvois (qui, session, message, tour, sorte, résultat, quand), jamais une copie du texte ;
//   chaque ligne porte sa PREUVE d'identité et la mention « appareil partagé ». Gardé sans limite ; effacé à la main,
//   par personne ou par période. Un inconnu non appairé n'a pas de carte : un compteur par canal, sans texte.
// - UNE SEULE fonction décide qui voit quoi : peutVoir.
// - Les COMPTES (tâches, succès, refus, décisions, validations, activités) : une fonction pure sur l'historique.
// Aucun texte affiché ici : des codes, que l'écran traduira dans la langue de la personne.

import { AsyncLocalStorage } from 'node:async_hooks';
import type { LienPersonaRow, LigneHistorique, Mnemosyne, PreuveIdentite, UserRole, UserRow } from './store.ts';

export type { LigneHistorique, PreuveIdentite, SortePersonne } from './store.ts';
export type LienPersona = LienPersonaRow;

/** La clé de l'historique du propriétaire quand il n'a pas (ou pas une seule) fiche dans la mémoire d'Odin. */
export const PROPRIETAIRE = 'proprietaire';

// ---------------------------------------------------------------- Preuve d'identité

/**
 * Comment on sait qui parle. Pur.
 * - Kéryx : un message n'arrive à Odin qu'après le code secret prouvé (valhalla/keryx/canal.ts, gererEntrant).
 * - Le web : quiconque a le jeton local EST le propriétaire (cli/main.ts : owners.web = ['*']) → sa session.
 * - Une identité reliée à une personne, appairée, ou déclarée par le propriétaire (`connu`) → appareil appairé.
 * - Sinon (« * » sur une messagerie, inconnu) → non prouvé.
 */
export function preuveDe(x: { canal: string; proprietaire: boolean; connu: boolean }): PreuveIdentite {
  if (x.canal === 'keryx') return 'code-prouve';
  if (x.canal === 'web' && x.proprietaire) return 'session-proprietaire';
  if (x.connu) return 'appareil-appaire';
  return 'non-prouve';
}

// ---------------------------------------------------------------- Noter une demande (appelé par la passerelle)

/**
 * Le suivi d'une demande, porté par le fil d'exécution de SON message (AsyncLocalStorage) : le tour qu'elle lance
 * démarre dans ce fil, même s'il attend dans la file de la conversation derrière d'autres tours. Le renvoi est donc
 * posé AU DÉPART DU TOUR (le tour, puis le premier message de la personne qui le suit), jamais deviné par l'heure.
 * Une commande traitée par la passerelle ne lance pas de tour : sa ligne reste sans renvoi (« sans_tour »).
 */
interface Suivi { session: string; id?: number; mission?: string; message?: number }
const suivi = new AsyncLocalStorage<Suivi | undefined>();
const ecoutees = new WeakSet<Mnemosyne>();

function ecouter(mu: Mnemosyne): void {
  if (ecoutees.has(mu)) return;
  ecoutees.add(mu);
  mu.ecouterTour((e) => {
    const s = suivi.getStore();
    if (!s || s.session !== e.session) return;
    const p: { mission?: string; message?: number } = {};
    if (e.mission && !s.mission) p.mission = s.mission = e.mission;
    else if (e.message !== undefined && s.mission && s.message === undefined) p.message = s.message = e.message;
    if (s.id && (p.mission || p.message !== undefined)) mu.completerHistorique(s.id, p);
  });
}

/**
 * Note qu'une demande est arrivée. Appelée par la passerelle APRÈS le retrait des clés et du mot de passe ; ne lit
 * jamais le texte. Ne lève jamais, et l'écriture est faite plus tard (setImmediate) : elle ne peut ni faire échouer ni
 * ralentir le traitement d'un message. Les renvois (tour, message) sont posés au départ du tour (voir Suivi).
 */
export function noterDemande(mu: Mnemosyne, e: { canal: string; pair: string; proprietaire: boolean; proprietaires?: readonly string[]; t?: number }): void {
  try {
    // Un nouveau message coupe le suivi du précédent : il ne doit jamais attraper le tour d'un autre.
    suivi.enterWith(undefined);
    const t = e.t ?? Date.now(), canal = String(e.canal), pair = String(e.pair), session = `${canal}:${pair}`;
    const u = mu.userFor(canal, pair);
    const appaire = Boolean(u) || (!e.proprietaire && mu.pairingStatus(canal, pair) === 'approved');
    // Un inconnu non appairé (la passerelle lui envoie un code d'appairage) : un compteur, sans texte.
    if (!e.proprietaire && !appaire) { setImmediate(() => { try { mu.compterInconnu(canal, t); } catch { /* jamais bloquant */ } }); return; }
    const declare = e.proprietaire && (e.proprietaires ?? []).includes(pair);
    const qui = u ? u.id : e.proprietaire ? proprietaireDe(mu) : null;
    const ligne = { t, qui, session, canal, sorte: 'demande' as const, preuve: preuveDe({ canal, proprietaire: e.proprietaire, connu: appaire || declare }), partage: mu.appareilPartage(canal, pair) };
    const s: Suivi = { session };
    ecouter(mu);
    suivi.enterWith(s);
    setImmediate(() => {
      try {
        const id = mu.noterHistorique({ ...ligne, ...(s.mission ? { mission: s.mission } : {}), ...(s.message !== undefined ? { message: s.message } : {}) });
        if (id) s.id = id;
      } catch { /* jamais bloquant */ }
    });
  } catch { /* jamais bloquant : un message passe toujours */ }
}

/** Le propriétaire : sa fiche dans la mémoire s'il en a exactement une, sinon la clé « proprietaire ». */
function proprietaireDe(mu: Mnemosyne): string {
  const o = mu.listUsers().filter((x) => x.role === 'owner');
  return o.length === 1 ? o[0].id : PROPRIETAIRE;
}

// ---------------------------------------------------------------- Historique (renvois résolus)

const ISSUE: Record<string, string> = { 'terminée': 'reussi', 'échouée': 'echoue', 'en attente': 'en_attente', 'arrêtée': 'arrete', 'en cours': 'en_cours' };

/**
 * Le résultat d'une demande, lu dans le tour qu'elle a lancé (renvoi posé au départ du tour). Sans tour : « sans_tour »
 * (commande traitée par la passerelle, tour pas encore parti, ou Odin redémarré entre-temps). Une ligne qui porte déjà
 * son résultat le garde.
 */
function resoudre(mu: Mnemosyne, lignes: LigneHistorique[]): LigneHistorique[] {
  return lignes.map((l) => {
    if (l.sorte !== 'demande' || l.resultat) return l;
    const m = l.mission ? mu.getMission(l.mission) : undefined;
    return { ...l, resultat: m ? (ISSUE[m.status] ?? 'inconnu') : l.mission ? 'inconnu' : 'sans_tour' };
  });
}

/**
 * Les clés d'historique d'une personne. Le propriétaire est noté « proprietaire » tant qu'il n'a pas une seule fiche,
 * puis par son id : les deux sont lus ensemble pour que son historique ne se coupe pas en deux.
 */
function clesDe(mu: Mnemosyne, qui: string | null): Set<string | null> {
  const o = mu.listUsers().filter((x) => x.role === 'owner');
  if (o.length === 1 && (qui === PROPRIETAIRE || qui === o[0].id)) return new Set([PROPRIETAIRE, o[0].id]);
  return new Set([qui]);
}

/** L'historique d'une personne (id, « proprietaire », ou null pour les appairés sans personne), renvois résolus. */
export function historiquePersonne(mu: Mnemosyne, qui: string | null, p: { depuis?: number; jusqua?: number } = {}): LigneHistorique[] {
  const cles = clesDe(mu, qui);
  return resoudre(mu, mu.lignesHistorique((l) => cles.has(l.qui) && dansPeriode(l.t, p)));
}

const dansPeriode = (t: number, p: { depuis?: number; jusqua?: number }) => (p.depuis === undefined || t >= p.depuis) && (p.jusqua === undefined || t <= p.jusqua);

// ---------------------------------------------------------------- La carte

export interface Carte {
  id: string; nom: string; role: UserRole; autonomie: UserRow['autonomy'];
  identites: Array<{ canal: string; pair: string; partage: boolean }>;
  /** La personne de Persona reliée à la main ; null sans lien (jamais devinée). */
  persona: { id: string; login?: string; nom?: string } | null;
  /** La note libre écrite par le propriétaire. */
  note: string;
  /** Le portrait en phrases, rédigé plus tard par le modèle de langue d'Odin : emplacement prévu, vide jusque-là. */
  portrait: null;
}

/** La carte d'une personne. `personnesPersona` : la liste de Persona, fournie par l'appelant (rien n'est lu ailleurs ici). */
export function carte(mu: Mnemosyne, userId: string, personnesPersona: ReadonlyArray<{ id: string; login?: string; name?: string }> = []): Carte | undefined {
  const u = mu.listUsers().find((x) => x.id === userId); if (!u) return undefined;
  const lien = mu.liensPersonaTous().find((l) => l.user_id === u.id);
  const p = lien ? personnesPersona.find((x) => x.id === lien.persona_id) : undefined;
  return {
    id: u.id, nom: u.name, role: u.role, autonomie: u.autonomy,
    identites: u.identities.map((i) => ({ canal: i.channel, pair: i.peer, partage: mu.appareilPartage(i.channel, i.peer) })),
    persona: lien ? { id: lien.persona_id, ...(p?.login ? { login: p.login } : {}), ...(p?.name ? { nom: p.name } : {}) } : null,
    note: mu.notePersonne(u.id),
    portrait: null,
  };
}
export function cartes(mu: Mnemosyne, personnesPersona: ReadonlyArray<{ id: string; login?: string; name?: string }> = []): Carte[] {
  return mu.listUsers().map((u) => carte(mu, u.id, personnesPersona)!).filter(Boolean);
}

// ---------------------------------------------------------------- Qui voit quoi (UNE seule fonction)

export type Visibilite = 'proprietaire' | 'chacun_la_sienne';
/** Le propriétaire ; un membre connecté au web, par SON identité Persona ; un invité. */
export type Demandeur = { sorte: 'proprietaire' } | { sorte: 'membre'; personaId: string } | { sorte: 'invite' };
export interface ContexteVisibilite { reglage: Visibilite; liens: ReadonlyArray<LienPersona>; personnes: ReadonlyArray<{ id: string; role: UserRole }> }
export type RaisonVoir = 'proprietaire' | 'la-sienne' | 'reglage-proprietaire-seul' | 'invite' | 'lien-absent' | 'lien-douteux' | 'autre-personne' | 'demandeur-inconnu';

/**
 * Peut-il voir la carte et l'historique de `cible` (id de personne, ou « proprietaire ») ? Pur. Le propriétaire voit
 * tout ; un invité rien ; un membre seulement les siens, avec « chacun la sienne », et seulement si le lien entre son
 * identité Persona et sa personne est SÛR : un seul lien pour cette identité, posé par le propriétaire, vers une
 * personne qui existe et qui est membre. Sinon : refus.
 */
export function peutVoir(d: Demandeur, cible: string, ctx: ContexteVisibilite): { ok: boolean; raison: RaisonVoir } {
  if (d?.sorte === 'proprietaire') return { ok: true, raison: 'proprietaire' };
  if (d?.sorte === 'invite') return { ok: false, raison: 'invite' };
  if (d?.sorte !== 'membre') return { ok: false, raison: 'demandeur-inconnu' };
  if (ctx.reglage !== 'chacun_la_sienne') return { ok: false, raison: 'reglage-proprietaire-seul' };
  const pid = String(d.personaId ?? '');
  const liens = pid ? ctx.liens.filter((l) => l.persona_id === pid) : [];
  if (!liens.length) return { ok: false, raison: 'lien-absent' };
  const l = liens[0], p = ctx.personnes.find((x) => x.id === l.user_id);
  if (liens.length > 1 || l.par !== PROPRIETAIRE || !p || p.role !== 'member' || ctx.liens.filter((x) => x.user_id === l.user_id).length > 1) return { ok: false, raison: 'lien-douteux' };
  return cible === l.user_id ? { ok: true, raison: 'la-sienne' } : { ok: false, raison: 'autre-personne' };
}

/** Le contexte de peutVoir lu dans la mémoire. Le réglage vaut « chacun la sienne » à l'installation ; une valeur inconnue retombe sur le plus prudent. */
export function contexteVisibilite(mu: Mnemosyne): ContexteVisibilite {
  const v = mu.getKv('personnes-visibilite');
  return { reglage: v === undefined || v === 'chacun_la_sienne' ? 'chacun_la_sienne' : 'proprietaire', liens: mu.liensPersonaTous(), personnes: mu.listUsers().map(({ id, role }) => ({ id, role })) };
}

// ---------------------------------------------------------------- Les comptes (§ 46)

export interface Comptes { taches: number; succes: number; echecs: number; enAttente: number; arretees: number; sansTour: number; refus: number; decisions: number; validations: number; actions: number; connexions: number; activites: number }
const zero = (): Comptes => ({ taches: 0, succes: 0, echecs: 0, enAttente: 0, arretees: 0, sansTour: 0, refus: 0, decisions: 0, validations: 0, actions: 0, connexions: 0, activites: 0 });

/**
 * Par personne (clé : son id, « proprietaire », ou '' pour une ligne sans personne) et sur la période : les tâches
 * confiées et leur issue, les refus, décisions, validations, actions, connexions ; `activites` compte toutes les
 * lignes. Pur, nombres exacts. Lire les lignes avec historiquePersonne (résultats résolus).
 * - `taches` : les demandes qui ont lancé un tour d'Odin. Une demande « sans_tour » (commande comme /stop, « oui »,
 *   /pair…) n'est pas une tâche : elle est comptée à part dans `sansTour`.
 * - `succes` : APPROXIMATION — le tour s'est terminé (« terminée »). Ce n'est pas encore « la bonne chose faite,
 *   vérifiée, annoncée » (§ 46) : il y faudra la vérification de la tâche, qui n'est pas dans ce lot.
 */
export function comptes(lignes: ReadonlyArray<LigneHistorique>, p: { depuis?: number; jusqua?: number } = {}): Record<string, Comptes> {
  const out: Record<string, Comptes> = {};
  for (const l of lignes) {
    if (!dansPeriode(l.t, p)) continue;
    const c = (out[l.qui ?? ''] ??= zero());
    c.activites++;
    if (l.sorte === 'demande') {
      if (l.resultat !== 'sans_tour') c.taches++;
      if (l.resultat === 'reussi') c.succes++; else if (l.resultat === 'echoue') c.echecs++; else if (l.resultat === 'en_attente') c.enAttente++;
      else if (l.resultat === 'arrete') c.arretees++; else if (l.resultat === 'sans_tour') c.sansTour++;
    } else if (l.sorte === 'refus') c.refus++;
    else if (l.sorte === 'decision') c.decisions++;
    else if (l.sorte === 'validation') c.validations++;
    else if (l.sorte === 'action') c.actions++;
    else if (l.sorte === 'connexion') c.connexions++;
  }
  return out;
}

// ---------------------------------------------------------------- Effacement à la main

export interface BilanEffacement {
  /** Ce que l'effacement retire : des lignes de l'historique des personnes, rien d'autre. */
  retire: { historique: number };
  /** Ce qui reste ailleurs (non touché) : l'historique restant, les messages et les tours des conversations de la
   *  personne, le journal d'aiguillage de ces conversations (il garde le début de chaque demande, masqué), ses
   *  souvenirs (« personne:<nom> »), la note du propriétaire et le lien Persona (s'ils existent), le compteur des
   *  inconnus (sans personne), le journal d'audit, les sauvegardes déjà faites. */
  reste: {
    historique: number; messages: number; missions: number; aiguillage: number; souvenirs: number; note: boolean; lienPersona: boolean;
    compteurInconnus: 'non-touche'; audit: 'non-touche'; sauvegardes: 'non-touchees';
  };
}
type Cible = { qui?: string | null; depuis?: number; jusqua?: number };

function viser(mu: Mnemosyne, c: Cible): (l: LigneHistorique) => boolean {
  if (c.qui === undefined && c.depuis === undefined && c.jusqua === undefined) throw new Error('effacement : une personne ou une période est requise');
  const cles = c.qui === undefined ? undefined : clesDe(mu, c.qui);
  return (l) => (cles === undefined || cles.has(l.qui)) && dansPeriode(l.t, c);
}

/** Dit exactement ce qu'un effacement retirerait et ce qui resterait ailleurs, sans rien effacer. */
export function apercuEffacement(mu: Mnemosyne, c: Cible): BilanEffacement {
  const f = viser(mu, c), cles = c.qui === undefined ? undefined : clesDe(mu, c.qui);
  const n = mu.lignesHistorique(f).length;
  const restant = mu.lignesHistorique((l) => !f(l) && (cles === undefined || cles.has(l.qui))).length;
  // Les conversations concernées : celles des identités de la personne, et celles citées par les lignes visées.
  const sessions = new Set(mu.lignesHistorique(f).map((l) => l.session));
  const u = c.qui ? mu.listUsers().find((x) => x.id === c.qui) : undefined;
  for (const i of u?.identities ?? []) sessions.add(`${i.channel}:${i.peer}`);
  let messages = 0, missions = 0, aiguillage = 0;
  for (const s of sessions) {
    messages += mu.allMessages(s).filter((m) => dansPeriode(m.created_at, c)).length;
    missions += mu.missionsDeSession(s).filter((m) => dansPeriode(m.started_at, c)).length;
    aiguillage += mu.aiguillagesDeSession(s, c);
  }
  return { retire: { historique: n }, reste: {
    historique: restant, messages, missions, aiguillage, souvenirs: u ? mu.souvenirsDuSujet(`personne:${u.name}`) : 0,
    note: u ? mu.notePersonne(u.id) !== '' : false, lienPersona: u ? mu.liensPersonaTous().some((l) => l.user_id === u.id) : false,
    compteurInconnus: 'non-touche', audit: 'non-touche', sauvegardes: 'non-touchees',
  } };
}

/** Efface l'historique d'une personne, ou d'une période, ou les deux à la fois ; rend le bilan exact (aperçu pris juste avant). */
export function effacerHistoriquePersonne(mu: Mnemosyne, c: Cible): BilanEffacement {
  const bilan = apercuEffacement(mu, c);
  const n = mu.effacerLignesHistorique(viser(mu, c));
  return { ...bilan, retire: { historique: n } };
}
