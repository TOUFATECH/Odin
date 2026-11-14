// Pégase : qui est connecté ? Les profils Pégase sont des personnes de Persona (connexion unique d'Odin) :
// même e-mail, même mot de passe (empreinte scrypt de Persona), même double authentification, et l'accès dépend du
// droit de la personne sur l'appli « pegase » (table des droits par appli de Persona).
//
// Toute la vérification d'un jeton passe par UNE fonction : `identifier`. Elle accepte les jetons d'appareil de
// Pégase (« pg1.… ») et, dès que le fournisseur d'identité d'Odin (SSO) se branche avec `brancherSso`, ses jetons
// d'appli (appli = pegase).

import { randomBytes } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { ModCtx } from '../types.ts';
import type { Person } from '../modules/var.ts';
import { totpOk } from '../modules/var.ts';
import { checkPassword, hashPassword } from '../valgrind/proxy.ts';
import { magasin, type Appareil, type Magasin, type Voir } from './store.ts';

export type Personne = Person;
/** Groupes autorisés sur Pégase quand Persona n'a pas encore de table des droits (contrat SSO). */
export const DROITS_PAR_DEFAUT = ['famille', 'admin', 'admins', 'invite'];
/** Groupes qui peuvent poser des questions à l'IA d'Odin depuis Pégase (réglable dans l'appli Pégase). */
export const IA_PAR_DEFAUT = ['admin', 'admins', 'famille'];
export const estAdmin = (p: Personne) => Boolean((p as { proprio?: boolean }).proprio) || p.groups.some((g) => g === 'admin' || g === 'admins');

const s = (v: unknown) => (v === undefined || v === null ? '' : String(v)).trim();
export const personnes = (varCtx: ModCtx): Personne[] => (varCtx.settings.people as Personne[] | undefined) ?? [];
const sauverPersonnes = (varCtx: ModCtx, l: Personne[]) => varCtx.saveSettings({ people: l });
export const personne = (varCtx: ModCtx, id: string) => personnes(varCtx).find((p) => p.id === id);
export const parEmail = (varCtx: ModCtx, x: string) => { const e = s(x).toLowerCase(); return personnes(varCtx).find((p) => (p.email ?? '').toLowerCase() === e || p.login === e); };

/**
 * Les groupes qui ont le droit d'utiliser Pégase : la table des droits par appli de Persona (« ssoDroits », écrite par le
 * SSO d'Odin ; « applis » ou « droits » acceptés aussi), sinon les groupes par défaut. « * » : toute personne connectée ;
 * « @identifiant » : une personne précise.
 */
export function groupesAutorises(varCtx: ModCtx): string[] {
  for (const k of ['ssoDroits', 'applis', 'droits']) {
    const t = varCtx.settings[k] as Record<string, string[] | { groupes?: string[]; groups?: string[] }> | undefined;
    const d = t?.pegase; const l = Array.isArray(d) ? d : d?.groupes ?? d?.groups;
    if (l) return l;
  }
  return DROITS_PAR_DEFAUT;
}
/** A-t-elle le droit sur Pégase ? (le propriétaire et le groupe admin ont toujours tout). Sinon, le message à montrer tel quel. */
export function droit(varCtx: ModCtx, p: Personne, proprietaire: string): string | undefined {
  if (!p.active) return 'Ton compte Odin est coupé : demande au propriétaire d\'Odin de le réactiver.';
  if (estAdmin(p)) return undefined;
  const g = groupesAutorises(varCtx);
  if (g.includes('*') || g.includes(`@${p.login}`) || g.some((x) => p.groups.includes(x))) return undefined;
  const propose = g.filter((x) => x !== 'admin' && x !== 'admins' && x !== '*' && !x.startsWith('@'))[0];
  return `Tu n'as pas accès à Pégase. Demande à ${proprietaire || 'la personne qui gère Odin'} ${propose ? `de t'ajouter au groupe ${propose}` : 'de te donner l\'accès'}.`;
}
export const voirParDefaut = (p: Personne): Voir => (estAdmin(p) ? 'tout' : 'sans-historique');

/** Le profil tel que Pégase le voit (jamais de mot de passe ni de secret). */
export function profilPublic(m: Magasin, p: Personne) {
  return { id: p.id, login: p.login, email: p.email ?? '', nom: p.name, groupes: p.groups, role: estAdmin(p) ? 'proprietaire' : 'membre', voir: m.prefs(p.id, voirParDefaut(p)).voir };
}

const LOGIN = /^[a-z0-9][a-z0-9._-]{1,31}$/;
/** Un identifiant Persona libre tiré de l'adresse e-mail (awa, awa2…). */
export function loginLibre(varCtx: ModCtx, email: string): string {
  let base = email.split('@')[0].normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9._-]+/g, '').replace(/^[._-]+/, '').slice(0, 28);
  if (base.length < 2) base = `pegase${base}`;
  const pris = new Set(personnes(varCtx).map((p) => p.login));
  let l = base, i = 2; while (pris.has(l) || !LOGIN.test(l)) l = `${base}${i++}`;
  return l;
}
/** Crée une personne de Persona (l'empreinte du mot de passe est déjà calculée : le mot de passe n'arrive jamais ici). */
export function creerPersonne(varCtx: ModCtx, o: { email: string; nom: string; hash: string; groupes: string[] }): Personne {
  if (parEmail(varCtx, o.email)) throw new Error('existe');
  const p: Personne = { id: randomBytes(5).toString('hex'), login: loginLibre(varCtx, o.email), name: o.nom.slice(0, 60), email: o.email, groups: o.groupes, hash: o.hash, active: true, created: Date.now(), fails: 0 };
  sauverPersonnes(varCtx, [...personnes(varCtx), p]);
  return p;
}
export { hashPassword };

/** Une empreinte factice : un e-mail inconnu coûte le même temps de calcul qu'un vrai. */
const FACTICE = hashPassword(randomBytes(12).toString('hex'));
export type Verdict = { ok: true; personne: Personne } | { ok: false; code: 'identifiants' | 'code_requis' | 'trop_d_essais' | 'pas_de_droit'; texte: string; attente?: number };
/**
 * Vérifie e-mail (ou identifiant) + mot de passe (+ code) d'une personne de Persona, avec son verrouillage.
 * Le propriétaire d'Odin (personne marquée « proprio » par le SSO) garde le mot de passe de son compte d'Odin : `proprio` le vérifie.
 */
export async function verifierMotDePasse(varCtx: ModCtx, o: { email: string; motdepasse: string; code?: string; proprietaire: string; now?: number; proprio?: (motdepasse: string) => Promise<boolean> }): Promise<Verdict> {
  const now = o.now ?? Date.now(), p = parEmail(varCtx, o.email);
  if (p?.lockedUntil && p.lockedUntil > now) return { ok: false, code: 'trop_d_essais', texte: 'Trop d\'essais ratés pour ce compte : réessaie dans quelques minutes.', attente: Math.ceil((p.lockedUntil - now) / 1000) };
  const parCompte = Boolean((p as { proprio?: boolean } | undefined)?.proprio) && Boolean(o.proprio);
  const bon = (parCompte ? await o.proprio!(o.motdepasse) : checkPassword(o.motdepasse, p?.hash || FACTICE)) && Boolean(p) && p!.active;
  if (!bon || !p) {
    if (p) {
      const fails = (p.fails ?? 0) + 1;
      sauverPersonnes(varCtx, personnes(varCtx).map((x) => (x.id === p.id ? { ...x, fails, ...(fails >= 5 ? { lockedUntil: now + 15 * 60_000 } : {}) } : x)));
    }
    return { ok: false, code: 'identifiants', texte: 'Adresse e-mail ou mot de passe incorrect.' };
  }
  if (p.totp) {
    if (!s(o.code)) return { ok: false, code: 'code_requis', texte: 'Tape le code à 6 chiffres de ton appli d\'authentification.' };
    if (!totpOk(p.totp, s(o.code), now)) return { ok: false, code: 'identifiants', texte: 'Code incorrect : regarde ton appli d\'authentification et recommence.' };
  }
  const d = droit(varCtx, p, o.proprietaire); if (d) return { ok: false, code: 'pas_de_droit', texte: d };
  sauverPersonnes(varCtx, personnes(varCtx).map((x) => (x.id === p.id ? { ...x, fails: 0, lockedUntil: undefined, lastLogin: now } : x)));
  return { ok: true, personne: p };
}

// ---------------- Le jeton : une seule fonction ----------------
/** Ce que le SSO d'Odin (fournisseur OpenID, agent « sso-odin ») sait d'un de ses jetons d'appli. */
export interface JetonSso { /** identifiant de la personne dans Persona (`sub`) */ sub: string; /** la session (de poste ou d'appareil) : sert à reconnaître l'appareil */ session?: string; appli?: string }
let sso: ((jeton: string, appli: 'pegase', req?: IncomingMessage) => Promise<JetonSso | undefined> | JetonSso | undefined) | undefined;
/** Le SSO d'Odin se branche ici : ses jetons d'appli sont alors acceptés sur toutes les routes de Pégase. */
export function brancherSso(f: typeof sso): void { sso = f; }
/** Le SSO est-il déjà branché ? */
export const ssoBranche = (): boolean => Boolean(sso);

export type Identite = { ok: true; personne: Personne; appareil: Appareil; nouveau?: boolean } | { ok: false; http: number; code: string; texte: string };
/**
 * Qui présente ce jeton ? (jeton d'appareil « pg1.… » ou jeton d'appli du SSO). Le droit sur Pégase est revérifié
 * à chaque fois : retiré dans Persona, il ne marche plus aussitôt.
 */
export async function identifier(pegCtx: ModCtx, varCtx: ModCtx, bearer: string, o: { proprietaire: string; nomAppareil?: string; ip?: string; req?: IncomingMessage }): Promise<Identite> {
  const m = magasin(pegCtx.dir), jeton = s(bearer);
  if (!jeton) return { ok: false, http: 401, code: 'jeton_requis', texte: 'Connecte-toi à Odin dans Pégase.' };
  let appareil: Appareil | undefined, nouveau = false;
  if (jeton.startsWith('pg1.')) appareil = m.parJeton(jeton);
  else if (sso) {
    const r = await Promise.resolve().then(() => sso!(jeton, 'pegase', o.req)).catch(() => undefined);
    if (r && (!r.appli || r.appli === 'pegase')) {
      const x = m.parSso(r.sub, r.session ?? 'sso', s(o.nomAppareil).slice(0, 60) || 'Pégase (connexion unique)', 'autre', o.ip);
      appareil = x.appareil; nouveau = x.nouveau;
    }
  }
  if (!appareil) return { ok: false, http: 401, code: 'jeton_invalide', texte: 'Ce Pégase n\'est plus reconnu par Odin : reconnecte-toi.' };
  const p = personne(varCtx, appareil.profil);
  if (!p) return { ok: false, http: 401, code: 'jeton_invalide', texte: 'Ton profil n\'existe plus dans Odin : reconnecte-toi ou demande au propriétaire.' };
  const d = droit(varCtx, p, o.proprietaire); if (d) return { ok: false, http: 403, code: 'pas_de_droit', texte: d };
  return { ok: true, personne: p, appareil, ...(nouveau ? { nouveau } : {}) };
}
