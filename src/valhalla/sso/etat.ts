// La connexion unique d'Odin, ce qu'elle garde (dans les réglages de Persona, fichier déjà bloqué pour les outils de
// fichiers) : les applis clientes, les droits par appli, les sessions des applis (jetons de renouvellement), les sessions
// de poste. Seules les empreintes SHA-256 des jetons sont gardées. Et les règles : qui a le droit d'ouvrir quelle appli.

import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import type { ModCtx } from '../types.ts';
import type { Person } from '../modules/var.ts';
import { persona as personaCtx } from './registre.ts';
import { NAMES } from '../names.ts';
import { Accounts } from '../../web/account.ts';

export type Personne = Person & { /** le compte du propriétaire d'Odin (son mot de passe reste celui de compte.json) */ proprio?: boolean };
export interface Appareil { id: string; nom: string; plateforme: string }
export interface Client {
  id: string; nom: string; retours: string[];
  /** l'appli d'Odin qui va avec (dossier des sauvegardes, page) */ module?: string;
  /** client « confidentiel » (logiciel du proxy) : empreinte de son secret */ secret?: string;
  /** logiciel installé à côté d'Odin (penpot…) */ logiciel?: string;
  /** taille max d'une sauvegarde (octets) */ tailleMax?: number;
  prereg?: boolean; ajoute?: number;
}
export interface SessionAppli { id: string; sub: string; login: string; appli: string; appareil: Appareil; cree: number; vu: number; fin: number; h: string; anciens: string[]; poste?: string; via: string; revoque?: number; scope: string }
export interface SessionPoste { id: string; sub: string; login: string; appareil: Appareil; utilisateur: string; cree: number; vu: number; fin: number; h: string; revoque?: number }

export const ACCES_MIN = 15 * 60;                       // jeton d'accès : 15 minutes (secondes)
export const RENOUV_INACTIF = 30 * 86_400_000, RENOUV_MAX = 180 * 86_400_000;
export const POSTE_INACTIF = 30 * 86_400_000, POSTE_MAX = 90 * 86_400_000;
export const TAILLE_MAX = 500 * 1024 * 1024;

const s = (v: unknown) => (v === undefined || v === null ? '' : String(v)).trim();
export const nouvelId = (n = 5) => randomBytes(n).toString('hex');

/** Le contexte de Persona (undefined si les applis ne tournent pas). */
export const persona = (): ModCtx | undefined => personaCtx();
export const personnes = (ctx: ModCtx): Personne[] => (ctx.settings.people as Personne[] | undefined) ?? [];
const sauverPersonnes = (ctx: ModCtx, l: Personne[]) => ctx.saveSettings({ people: l });

// ---------------- Applis clientes
export const LOOPBACK = ['http://127.0.0.1/sso/retour', 'http://[::1]/sso/retour'];
/** Pégase et Vénus sont préinscrites ; l'adresse de Vénus vient de l'appli Vénus d'Odin (si elle est reliée). */
export function preinscrites(venusUrl = ''): Client[] {
  const v = venusUrl.replace(/\/+$/, '');
  return [
    { id: 'pegase', nom: 'Pégase', retours: [...LOOPBACK, 'pegase://sso/retour'], module: 'pegase', prereg: true },
    { id: 'venus', nom: 'Vénus', retours: [...LOOPBACK, ...(/^https?:\/\//.test(v) ? [`${v}/auth/odin/retour`] : [])], module: 'freyja', prereg: true },
    { id: 'agora', nom: 'Agora', retours: [...LOOPBACK, 'agora://sso/retour'], module: 'agora', prereg: true },
    { id: 'odin', nom: 'Odin', retours: [], prereg: true },
  ];
}
let venusUrl = () => '';
/** L'adresse de Vénus (appli Vénus d'Odin) pour son adresse de retour préinscrite. */
export function setVenusUrl(f: () => string): void { venusUrl = f; }
export function clients(ctx: ModCtx): Client[] {
  const mine = (ctx.settings.ssoApplis as Client[] | undefined) ?? [], out: Client[] = [];
  for (const p of preinscrites(venusUrl())) { const m = mine.find((x) => x.id === p.id); out.push(m ? { ...p, ...m, retours: [...new Set([...p.retours, ...m.retours])], prereg: true } : p); }
  for (const m of mine) if (!out.some((x) => x.id === m.id)) out.push(m);
  return out;
}
export const client = (ctx: ModCtx, id: string) => clients(ctx).find((c) => c.id === id);
export function sauverClient(ctx: ModCtx, c: Client): void {
  const mine = ((ctx.settings.ssoApplis as Client[] | undefined) ?? []).filter((x) => x.id !== c.id);
  const pre = preinscrites().find((p) => p.id === c.id);
  const keep: Client = pre ? { ...c, retours: c.retours.filter((r) => !pre.retours.includes(r)) } : c;
  ctx.saveSettings({ ssoApplis: [...mine, keep] });
}
/** L'adresse de retour est-elle déclarée ? Exacte, sauf le port des adresses de la machine elle-même déclarées sans port (RFC 8252 § 7.3). */
export function retourPermis(c: Client, uri: string): boolean {
  if (!uri || uri.length > 2000 || /#/.test(uri)) return false;
  if (c.retours.includes(uri)) return true;
  let u: URL; try { u = new URL(uri); } catch { return false; }
  if (u.protocol !== 'http:' || !['127.0.0.1', '[::1]', 'localhost'].includes(u.hostname)) return false;
  return c.retours.some((r) => { try { const d = new URL(r); return d.protocol === 'http:' && !d.port && d.hostname === u.hostname && d.pathname === u.pathname && d.search === u.search; } catch { return false; } });
}

// ---------------- Droits
/** `odin` : entrer dans l'interface d'Odin (on n'y voit que les applis auxquelles on a droit). */
const DROITS0: Record<string, string[]> = { odin: ['famille', 'admin'], pegase: ['famille', 'admin', 'invite'], venus: ['famille', 'admin'], /* le store : chacun y voit ce à quoi il a droit */ agora: ['*'] };
/** Une appli d'Odin qui est aussi une appli cliente (même droit) : Vénus (freyja) ↔ venus. */
export const ALIAS: Record<string, string> = { freyja: 'venus' };
export const cleDroit = (id: string) => ALIAS[id] ?? id;
export function droits(ctx: ModCtx): Record<string, string[]> { return { ...DROITS0, ...((ctx.settings.ssoDroits as Record<string, string[]> | undefined) ?? {}) }; }
export const groupesDe = (ctx: ModCtx, appli: string) => droits(ctx)[cleDroit(appli)] ?? ['admin'];
export function changerDroit(ctx: ModCtx, appli: string, groupe: string, donner: boolean): string[] {
  const k = cleDroit(appli), cur = groupesDe(ctx, k), next = donner ? [...new Set([...cur, groupe])] : cur.filter((g) => g !== groupe);
  ctx.saveSettings({ ssoDroits: { ...((ctx.settings.ssoDroits as Record<string, string[]> | undefined) ?? {}), [k]: next } });
  return next;
}
/** Le propriétaire et le groupe admin ont tout ; sinon un groupe autorisé, « * » (toute personne connectée) ou « @identifiant ». */
export function aDroit(ctx: ModCtx, p: Personne | undefined, appli: string): boolean {
  if (!p || !p.active) return false;
  if (p.proprio || p.groups.includes('admin')) return true;
  const g = groupesDe(ctx, appli);
  return g.includes('*') || g.includes(`@${p.login}`) || p.groups.some((x) => g.includes(x));
}
export const nomAppli = (ctx: ModCtx | undefined, id: string) => (ctx ? client(ctx, id)?.nom : undefined) ?? NAMES[id] ?? id;
export function prenomProprio(ctx: ModCtx): string { const p = new Accounts(ctx.home).profile(); return p?.prenom || personnes(ctx).find((x) => x.proprio)?.name || 'l\'administrateur d\'Odin'; }
/** « Tu n'as pas accès à Vénus. Demande à Awa de t'ajouter au groupe famille. » */
export function messageRefus(ctx: ModCtx, appli: string): string {
  const g = groupesDe(ctx, appli).filter((x) => x !== 'admin' && x !== '*' && !x.startsWith('@'))[0];
  return `Tu n'as pas accès à ${nomAppli(ctx, cleDroit(appli))}. Demande à ${prenomProprio(ctx)} ${g ? `de t'ajouter au groupe ${g}` : 'de te donner l\'accès'}.`;
}
export function applisDe(ctx: ModCtx, p: Personne): string[] { return clients(ctx).filter((c) => c.id !== 'odin' && aDroit(ctx, p, c.id)).map((c) => c.id); }

// ---------------- Personnes
export function trouver(ctx: ModCtx, ident: string): Personne | undefined {
  const x = s(ident).toLowerCase(); if (!x) return undefined;
  const l = personnes(ctx); return l.find((p) => p.login === x) ?? l.find((p) => (p.email ?? '').toLowerCase() === x);
}
export const parSub = (ctx: ModCtx, sub: string) => personnes(ctx).find((p) => p.id === sub);
/**
 * Le compte du propriétaire d'Odin devient une personne de Persona (groupe admin). Rien n'est recopié de son mot de passe :
 * il reste dans compte.json (retour arrière : « Délier le compte du propriétaire » retire seulement la fiche).
 */
export function lierProprietaire(ctx: ModCtx): Personne | undefined {
  if (ctx.settings.proprioDelie === true) return personnes(ctx).find((p) => p.proprio);
  const a = new Accounts(ctx.home).profile(); if (!a) return undefined;
  const l = personnes(ctx), cur = l.find((p) => p.proprio), name = `${a.prenom} ${a.nom}`.trim();
  if (cur) {
    if (cur.email !== a.email || cur.name !== name || !cur.groups.includes('admin')) { const p = { ...cur, email: a.email, name, groups: [...new Set(['admin', ...cur.groups])] }; sauverPersonnes(ctx, l.map((x) => (x.id === cur.id ? p : x))); return p; }
    return cur;
  }
  const taken = new Set(l.map((p) => p.login)); let login = 'proprietaire', i = 2; while (taken.has(login)) login = `proprietaire${i++}`;
  const p: Personne = { id: nouvelId(), login, name, email: a.email, groups: ['admin'], hash: '', active: true, created: Date.now(), fails: 0, proprio: true };
  sauverPersonnes(ctx, [...l, p]); return p;
}
export function delierProprietaire(ctx: ModCtx): boolean {
  const l = personnes(ctx), p = l.find((x) => x.proprio); ctx.saveSettings({ proprioDelie: true });
  if (!p) return false;
  sauverPersonnes(ctx, l.filter((x) => x.id !== p.id)); revoquerPersonne(ctx, p.login, 'compte du propriétaire délié'); return true;
}
export function relierProprietaire(ctx: ModCtx): Personne | undefined { ctx.saveSettings({ proprioDelie: false }); return lierProprietaire(ctx); }

// ---------------- Sessions des applis et des postes
export const sessionsApplis = (ctx: ModCtx): SessionAppli[] => (ctx.settings.ssoSessions as SessionAppli[] | undefined) ?? [];
export const sessionsPostes = (ctx: ModCtx): SessionPoste[] => (ctx.settings.ssoPostes as SessionPoste[] | undefined) ?? [];
export const vivante = (x: { revoque?: number; fin: number; vu: number }, inactif: number, now = Date.now()) => !x.revoque && x.fin > now && now - x.vu < inactif;
export function sauverSessions(ctx: ModCtx, l: SessionAppli[]): void { const now = Date.now(); ctx.saveSettings({ ssoSessions: l.filter((x) => (x.revoque ?? x.fin) > now - 7 * 86_400_000 && x.fin > now - 7 * 86_400_000).slice(-1000) }); }
export function sauverPostes(ctx: ModCtx, l: SessionPoste[]): void { const now = Date.now(); ctx.saveSettings({ ssoPostes: l.filter((x) => (x.revoque ?? x.fin) > now - 7 * 86_400_000).slice(-500) }); }
/** Une session d'appli est-elle encore bonne (pour un jeton d'accès qui la cite) ? */
export function sessionValide(ctx: ModCtx, sid: string): SessionAppli | undefined {
  const x = sessionsApplis(ctx).find((y) => y.id === sid); if (!x || !vivante(x, RENOUV_INACTIF)) return undefined;
  const p = parSub(ctx, x.sub); if (!p || !p.active) return undefined;
  if (x.poste) { const po = sessionsPostes(ctx).find((y) => y.id === x.poste); if (!po || !vivante(po, POSTE_INACTIF)) return undefined; }
  return x;
}
export function revoquerSession(ctx: ModCtx, sid: string): boolean { let n = false; sauverSessions(ctx, sessionsApplis(ctx).map((x) => (x.id === sid && !x.revoque ? (n = true, { ...x, revoque: Date.now() }) : x))); return n; }
export function revoquerPoste(ctx: ModCtx, pid: string): number {
  const now = Date.now(); let n = 0;
  sauverPostes(ctx, sessionsPostes(ctx).map((x) => (x.id === pid && !x.revoque ? (n++, { ...x, revoque: now }) : x)));
  sauverSessions(ctx, sessionsApplis(ctx).map((x) => (x.poste === pid && !x.revoque ? (n++, { ...x, revoque: now }) : x)));
  return n;
}
/** Coupe tout ce qu'une personne a ouvert (compte coupé, retiré, mot de passe changé). */
export function revoquerPersonne(ctx: ModCtx, login: string, _pourquoi = ''): number {
  const now = Date.now(); let n = 0;
  sauverSessions(ctx, sessionsApplis(ctx).map((x) => (x.login === login && !x.revoque ? (n++, { ...x, revoque: now }) : x)));
  sauverPostes(ctx, sessionsPostes(ctx).map((x) => (x.login === login && !x.revoque ? (n++, { ...x, revoque: now }) : x)));
  return n;
}
/** Journal des connexions de Persona (le même que le portail). */
export function noter(ctx: ModCtx, e: { login: string; ip: string; ok: boolean; why: string }): void {
  const j = (ctx.settings.journal as Array<Record<string, unknown>> | undefined) ?? [];
  ctx.saveSettings({ journal: [...j, { t: Date.now(), login: e.login.slice(0, 32), ip: e.ip, ok: e.ok, why: e.why.slice(0, 120) }].slice(-500) });
}
/** Le dossier de l'appli d'Odin où vont les sauvegardes d'une appli cliente. */
export function dossierSauvegardes(ctx: ModCtx, appli: string, login: string): string {
  const c = client(ctx, appli), mod = (c?.module ?? appli).replace(/[^\w-]/g, '_');
  return join(ctx.home, 'valhalla', mod, 'sauvegardes', login.replace(/[^\w.-]/g, '_'));
}
