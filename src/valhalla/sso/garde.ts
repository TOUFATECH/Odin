// La garde de la connexion unique, appelée une fois par requête par le serveur web d'Odin (le plus tôt possible) :
//   - les routes OpenID (/.well-known, /sso/*) et la sauvegarde des applis (/api/sauvegardes/*) ;
//   - l'interface d'Odin elle-même se connecte par Persona (/sso/odin → portail → /sso/odin/retour) : le propriétaire
//     retrouve sa session habituelle, une autre personne ouvre une session « membre » ;
//   - pour un membre (personne de Persona qui n'est ni le propriétaire ni du groupe admin), tout passe ici : il ne voit et
//     ne fait agir que les applis auxquelles il a droit (liste, page, actions, phrases, port direct, /maison, /recherche) ;
//     le reste de l'interface (réglages, conversations avec l'IA, machines…) lui est fermé.

import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomBytes } from 'node:crypto';
import type { ModCtx } from '../types.ts';
import { valhallaOf } from '../odin.ts';
import { sessionCookie, clearSessionCookie, SESSION_RE } from '../../web/account.ts';
import { valhallaGet, valhallaPost } from '../../web/valhalla-api.ts';
import { b64u, sha256, sha256hex } from './jwt.ts';
import { auNomDe, setVerificateur, type Agissant } from './acces.ts';
import { aDroit, setVenusUrl, lierProprietaire, messageRefus, nomAppli, noter, persona, personnes, prenomProprio, type Personne } from './etat.ts';
import { consommerCode, erreur, issuerDe, json, routeOidc, type DepsSSO } from './oidc.ts';
import { routeSauvegardes } from './sauvegardes.ts';
import { routeVenus } from './fiches.ts';
import { routeComptes } from './comptes.ts';
import { echangeBus, echangesRecents, type Echange } from '../echanges.ts';
import { understand } from '../huginn.ts';
import type { GateDecision, GateInput } from '../../heimdall/policy.ts';

export interface DepsGarde extends DepsSSO {
  /** l'appli du port direct par lequel la requête arrive */ direct?: string;
  /** ouvre la session habituelle du propriétaire (cookie de l'interface) */ ouvrirSessionProprio(): void;
  /** l'état complet de l'interface (vidé pour un membre) */ etat(): unknown;
  /** l'adresse de Vénus (son adresse de retour préinscrite) */ venus?: string;
  /** la page de connexion de l'interface d'Odin (son port à elle), avec le message de refus pour cette appli */ accueil?: (appli: string) => string;
  /**
   * Le validateur d'Odin (Heimdall et sa passerelle, le même que pour les demandes venues des messageries) : la demande
   * d'un membre part chez le propriétaire, là où il les reçoit déjà ; rend sa décision (refus sans réponse dans le délai).
   * Absent : le membre reçoit le refus, sans demande.
   */
  demander?: (g: GateInput) => Promise<GateDecision>;
}
const s = (v: unknown) => (v === undefined || v === null ? '' : String(v)).trim();

// Le vérificateur de Valhalla : une personne sans droit sur une appli ne la fait pas agir.
setVerificateur((moduleId, qui) => {
  const ctx = persona(); if (!ctx) return 'Les droits des applis ne sont pas chargés (Persona arrêté).';
  const p = personnes(ctx).find((x) => x.login === qui.login);
  return aDroit(ctx, p, moduleId) ? undefined : messageRefus(ctx, moduleId);
});

/** Le membre connecté à l'interface d'Odin avec ce cookie de session (undefined : propriétaire, ou personne). */
export function membreDe(cookie: string): { p: Personne; ctx: ModCtx; h: string } | undefined {
  const tok = SESSION_RE.exec(cookie)?.[1]; if (!tok) return undefined;
  const ctx = persona(); if (!ctx) return undefined;
  const h = sha256hex(tok), now = Date.now(), x = ((ctx.settings.sessions as Array<{ id: string; login: string; expires: number; ou?: string; seen: number }> | undefined) ?? []).find((y) => y.id === h && y.ou === 'odin' && y.expires > now);
  const p = x ? personnes(ctx).find((y) => y.login === x.login && y.active) : undefined;
  if (!x || !p) return undefined;
  if (now - x.seen > 5 * 60_000) ctx.saveSettings({ sessions: ((ctx.settings.sessions as Array<{ id: string }> | undefined) ?? []).map((y) => (y.id === h ? { ...y, seen: now } : y)) });
  return { p, ctx, h };
}
/** Ce cookie est-il la session d'un membre ? (pour le serveur : la session vaut alors « connecté ») */
export const sessionMembre = (token: string) => Boolean(membreDe(`odin_session=${token}`));
export const estMembre = (req: IncomingMessage) => Boolean(membreDe(s(req.headers.cookie)));

const debuts = new Map<string, { verifier: string; exp: number }>();
const agissantDe = (p: Personne): Agissant => ({ login: p.login, name: p.name, groups: p.groups });
const ferme = (res: ServerResponse) => erreur(res, 403, 'reserve', 'Cette partie d\'Odin est réservée à son propriétaire.');
/** Vide une donnée en gardant sa forme (les tableaux deviennent vides, les textes vides) : l'interface ne casse pas, rien ne fuit. */
export function vider(x: unknown): unknown {
  if (Array.isArray(x)) return [];
  if (x && typeof x === 'object') return Object.fromEntries(Object.entries(x as Record<string, unknown>).map(([k, v]) => [k, vider(v)]));
  return typeof x === 'string' ? '' : typeof x === 'number' ? 0 : x;
}
/** Les pages servies à part et l'appli qui les fournit. */
const PAGES: Array<[RegExp, string]> = [[/^\/(maison|maison\.js)$|^\/api\/maison\/|^\/api\/owntracks$/, 'gladsheim'], [/^\/(recherche|recherche\.js)$|^\/api\/recherche\//, 'volva']];

/**
 * Le refus d'une action grave à un membre : ce qu'elle ferait (la demande de confirmation de l'appli, sur une ligne,
 * coupée à 100 caractères, avec une majuscule au début) et qui seul la confirme. Sans prénom du propriétaire,
 * prenomProprio rend déjà « l'administrateur d'Odin » : on ne le redit pas.
 */
export function refusGrave(confirm: string, proprio: string): { quoi: string; texte: string } {
  const l = [...confirm.replace(/^Confirmer : /, '').replace(/ \?$/, '').replace(/[\u0000-\u001f\u007f-\u009f]+/g, ' ').replace(/\s+/g, ' ').trim()];
  const court = l.length > 100 ? [...l.slice(0, 99), '…'] : l;
  const quoi = (court[0] ?? '').toUpperCase() + court.slice(1).join('');
  const qui = proprio === 'l\'administrateur d\'Odin' ? proprio : `${proprio} (le propriétaire d'Odin)`;
  return { quoi, texte: `${quoi} : c'est une action grave, seul ${qui} la confirme. Demande-la-lui.` };
}

/**
 * Un texte venu d'un membre (ou d'une appli qui le recopie), montré au propriétaire : sur une ligne, sans caractère de
 * contrôle ni de sens d'écriture, sans commande (« /yes … » ne se lit plus comme une réponse), sans lien ni bloc de code
 * (crochets et accents graves remplacés), coupé à `max` caractères.
 */
export function ligneSure(t: string, max: number): string {
  const sur: Record<string, string> = { '[': '(', ']': ')', '`': '\'', '<': '‹', '>': '›' };
  const l = [...t.replace(/[\u0000-\u001f\u007f-\u009f\u200e\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069]+/g, ' ').replace(/\/(?=\p{L})/gu, '\u2215').replace(/[[\]`<>]/g, (c) => sur[c]).replace(/\s+/g, ' ').trim()];
  return (l.length > max ? [...l.slice(0, max - 1), '…'] : l).join('');
}

/**
 * Les demandes d'actions graves des membres, en mémoire (comme les validations qui attendent le propriétaire). Une rafale
 * est bornée : au plus 3 demandes en attente par membre et 10 en tout ; une demande identique à une demande en attente
 * n'est pas renvoyée. Une demande répondue est oubliée dès que le membre a lu sa réponse (à sa prochaine action).
 */
interface Demande { cle: string; quoi: string; etat: 'en attente' | 'faite' | 'pas validée' | 'pas faite'; detail?: string; vue?: boolean }
const demandes = new Map<string, Demande[]>();
const MAX_ATTENTE_MEMBRE = 3, MAX_ATTENTE = 10;
const enAttente = (l: Demande[]) => l.filter((x) => x.etat === 'en attente');
const quiConfirme = (ctx: ModCtx) => { const p = prenomProprio(ctx); return p === 'l\'administrateur d\'Odin' ? p : `${p} (le propriétaire d'Odin)`; };

/** Ce que le membre apprend en revenant : la réponse à ses demandes (une seule fois chacune). */
function nouvelles(login: string, ctx: ModCtx): string {
  const l = demandes.get(login) ?? [], proprio = prenomProprio(ctx), out: string[] = [];
  for (const x of l) {
    if (x.etat === 'en attente' || x.vue) continue;
    x.vue = true;
    out.push(x.etat === 'faite' ? `Ta demande « ${x.quoi} » : ${proprio} l'a validée, c'est fait.`
      : x.etat === 'pas validée' ? `Ta demande « ${x.quoi} » n'a pas été validée par ${proprio} (refusée ou restée sans réponse) : rien n'est parti.`
      : `Ta demande « ${x.quoi} » a été validée par ${proprio}, mais l'action n'est pas partie${x.detail ? ` (${x.detail})` : ''}.`);
  }
  demandes.set(login, l.filter((x) => x.etat === 'en attente' || !x.vue));
  return out.slice(-3).join('\n');
}
/** Ce qu'il vient de faire d'abord, puis la réponse à ses demandes. */
const avecNouvelles = (login: string, t: string, ctx: ModCtx) => { const n = nouvelles(login, ctx); return n ? (t ? `${t}\n${n}` : n) : t; };

/**
 * L'action grave qu'un membre a touchée part chez le propriétaire par le validateur d'Odin. Rend ce que lit le membre
 * (« Demande envoyée à … »), ou undefined quand elle ne peut pas être demandée (il reçoit alors le refus habituel).
 * Oui : l'action part au nom du membre (son droit est recontrôlé, et ce doit être exactement l'action montrée).
 * Non, ou sans réponse dans le délai du validateur : rien ne part.
 */
async function demanderAuProprietaire(ctx: ModCtx, p: Personne, qui: Agissant, path: string, b: Record<string, unknown>, confirm: string, quoi: string, d: DepsGarde): Promise<string | undefined> {
  const v = valhallaOf(), demander = d.demander; if (!v || !demander) return undefined;
  // L'action exacte : celle du bouton, ou celle que la barre des applis a comprise (sans rien lancer).
  let cible: { module: string; action: string; input: Record<string, unknown> } | undefined;
  if (path === '/api/valhalla/act') cible = { module: s(b.module), action: s(b.action), input: (b.input && typeof b.input === 'object' && !Array.isArray(b.input) ? b.input : {}) as Record<string, unknown> };
  else {
    const u = await auNomDe(qui, () => understand(v, s(b.text).slice(0, 2000).trim(), `web:${`membre-${p.login}`.replace(/[^\w-]/g, '').slice(0, 40)}`)).catch(() => undefined);
    if (u?.kind === 'action') cible = { module: u.module, action: u.action, input: u.input };
  }
  const f = cible ? v.action(cible.module, cible.action) : undefined;
  if (!cible || !f || !aDroit(ctx, p, f.m.id)) return undefined;
  const input = cible.input;
  // « Propriétaire seul » : jamais demandé (refusé, comme avant).
  if (auNomDe(qui, () => (typeof f.a.proprietaireSeul === 'function' ? f.a.proprietaireSeul(input, v.ctx(f.m.id)) : f.a.proprietaireSeul === true))) return undefined;
  // Ce que le propriétaire valide est exactement ce qui a été montré : la même demande de confirmation.
  const graveDe = (): string | undefined => { try { return auNomDe(qui, () => f.a.grave?.(input, v.ctx(f.m.id))); } catch { return undefined; } };
  const w = graveDe(); if (!w || `Confirmer : ${w} ?` !== confirm) return undefined;
  // Le propriétaire valide l'action entière : trop longue pour lui être montrée sans la couper, elle n'est pas demandée
  // (le membre garde le refus). Même mesure que refusGrave, qui coupe au-delà de 100 caractères.
  if ([...w.replace(/[\u0000-\u001f\u007f-\u009f]+/g, ' ').replace(/\s+/g, ' ').trim()].length > 100) return undefined;
  // Une rafale est bornée.
  const l = demandes.get(p.login) ?? [], cle = sha256hex(JSON.stringify([f.m.id, f.a.id, input])), proprio = quiConfirme(ctx);
  demandes.set(p.login, l);
  if (enAttente(l).some((x) => x.cle === cle)) return `Demande déjà envoyée à ${proprio} : elle attend sa réponse.`;
  const total = [...demandes.values()].reduce((n, x) => n + enAttente(x).length, 0);
  if (enAttente(l).length >= MAX_ATTENTE_MEMBRE) return `Tu as déjà ${enAttente(l).length} demandes en attente chez ${proprio} : attends sa réponse avant d'en envoyer une autre.`;
  if (total >= MAX_ATTENTE) return `Trop de demandes sont déjà en attente chez ${proprio} : réessaie plus tard.`;
  const x: Demande = { cle, quoi, etat: 'en attente' }; l.push(x);
  const nom = ligneSure(p.name, 40), appli = ligneSure(f.m.name, 30), montre = ligneSure(quoi, 110);
  noter(ctx, { login: p.login, ip: d.ip, ok: true, why: `interface d'Odin · demande au propriétaire · ${[...montre].slice(0, 50).join('')} · envoyée` });
  // Même chemin que la demande d'un membre venue d'une messagerie : Heimdall (verrou « grave », jamais d'autorisation
  // permanente, refus sans réponse dans son délai), puis la passerelle, qui la porte au propriétaire. « membre:… » ne
  // désigne aucune messagerie : la demande va là où le propriétaire reçoit les siennes.
  const g: GateInput = { tool: 'valhalla', risk: 'exec', summary: `${nom} (membre de la famille) demande, dans ${appli} : ${montre}`, grave: `${ligneSure(w, 160)} — demandé par ${nom}, membre de la famille`, sessionId: `membre:${p.login}`, tainted: false, maxAutonomy: 'prudent' };
  void (async () => {
    let dec: GateDecision; try { dec = await demander(g); } catch { dec = { allowed: false, reason: 'validateur indisponible' }; }
    if (!dec.allowed) { x.etat = 'pas validée'; noter(ctx, { login: p.login, ip: d.ip, ok: false, why: `interface d'Odin · demande au propriétaire · ${[...montre].slice(0, 50).join('')} · pas validée` }); return; }
    // Validée : elle part au nom du membre, s'il a toujours le droit et si c'est toujours la même action.
    const pp = personnes(ctx).find((y) => y.login === p.login && y.active);
    if (!pp || !aDroit(ctx, pp, f.m.id) || graveDe() !== w) { x.etat = 'pas faite'; x.detail = !pp || !aDroit(ctx, pp, f.m.id) ? 'tu n\'as plus le droit sur cette appli' : 'elle a changé depuis ta demande'; return; }
    const r = await auNomDe({ ...qui, accord: quoi }, () => valhallaPost('/api/valhalla/act', { module: f.m.id, action: f.a.id, input, confirm: true })) as Record<string, unknown> | undefined;
    x.etat = r?.ok === true ? 'faite' : 'pas faite'; if (r?.ok !== true) x.detail = ligneSure(s(r?.text ?? r?.error), 100);
    noter(ctx, { login: p.login, ip: d.ip, ok: x.etat === 'faite', why: `interface d'Odin · demande au propriétaire · ${[...montre].slice(0, 50).join('')} · ${x.etat === 'faite' ? 'validée, faite' : 'validée, pas faite'}` });
  })().catch(() => { x.etat = 'pas faite'; });
  // Ce que le membre lit dit vrai : la demande n'est montrée que sur Odin ouvert ou sur la messagerie du propriétaire.
  return `Demande envoyée à ${proprio} : ${quoi}. Elle ne part qu'après sa validation : elle lui est montrée sur Odin s'il est ouvert, ou sur sa messagerie ; sans sa réponse à temps, rien ne part.`;
}

/** Rend true si la requête est servie ici. */
export async function gardeSSO(req: IncomingMessage, res: ServerResponse, url: URL, d: DepsGarde): Promise<boolean> {
  const path = url.pathname; setVenusUrl(() => d.venus ?? '');
  // L'interface d'Odin par Persona (Odin est sa propre appli cliente).
  if (path === '/sso/odin' || path === '/sso/odin/retour') return odinParPersona(req, res, url, d);
  if (await routeComptes(req, res, url, d)) return true;
  if (await routeOidc(req, res, url, d)) return true;
  if (await routeSauvegardes(req, res, url)) return true;
  if (await routeVenus(req, res, url)) return true;
  const m = membreDe(s(req.headers.cookie)); if (!m) return false;
  const { p, ctx } = m, v = valhallaOf();
  // Port direct d'une appli : sans le droit, la page renvoie à l'écran de connexion d'Odin (la session est fermée) ;
  // les appels de l'API reçoivent le refus en clair et l'adresse de cet écran.
  if (d.direct && !aDroit(ctx, p, d.direct)) {
    noter(ctx, { login: p.login, ip: d.ip, ok: false, why: `port direct · ${nomAppli(ctx, d.direct)} · pas le droit` });
    if ((req.method ?? 'GET') === 'GET' && path === '/' && d.accueil) {
      fermerSessionMembre(ctx, m.h);
      res.writeHead(303, { location: d.accueil(d.direct), 'set-cookie': clearSessionCookie(d.https), 'cache-control': 'no-store' }); res.end(); return true;
    }
    erreur(res, 403, 'refuse', messageRefus(ctx, d.direct), d.accueil ? { accueil: d.accueil(d.direct) } : {}); return true;
  }
  // Par l'interface d'Odin (pas un port d'appli) : il faut le droit « odin » (entrer dans Odin). Sans lui (groupe retiré
  // depuis, ou session ouverte sur le port d'une appli), rien de l'interface ne répond ; la session reste bonne sur le
  // port de ses applis (le même cookie sert pour tous les ports de la machine).
  if (!d.direct && !aDroit(ctx, p, 'odin') && (path.startsWith('/api/') || path === '/mcp')) {
    if (path === '/api/account/logout') { fermerSessionMembre(ctx, m.h); res.setHeader('set-cookie', clearSessionCookie(d.https)); json(res, 200, { ok: true }); return true; }
    noter(ctx, { login: p.login, ip: d.ip, ok: false, why: 'interface d\'Odin · pas le droit' });
    erreur(res, 403, 'refuse', messageRefus(ctx, 'odin')); return true;
  }
  for (const [re, mod] of PAGES) if (re.test(path)) { if (!aDroit(ctx, p, mod)) { erreur(res, 403, 'refuse', messageRefus(ctx, mod)); return true; } return false; }
  if (!path.startsWith('/api/') && path !== '/mcp') return false; // la page d'Odin, ses scripts, ses images
  const meth = req.method ?? 'GET';
  if (path === '/api/account/logout' && meth === 'POST') {
    ctx.saveSettings({ sessions: ((ctx.settings.sessions as Array<{ id: string }> | undefined) ?? []).filter((x) => x.id !== m.h) });
    res.setHeader('set-cookie', clearSessionCookie(d.https)); json(res, 200, { ok: true }); return true;
  }
  if (path === '/api/account/me' && meth === 'GET') { json(res, 200, { ok: true, profile: { prenom: p.name, nom: '', email: p.email ?? '', created: new Date(p.created).toISOString(), changed: '' }, sessions: [], membre: { login: p.login, name: p.name, groups: p.groups } }); return true; }
  if (path === '/api/state' && meth === 'GET') {
    const full = d.etat() as Record<string, unknown>, st = vider(full) as Record<string, unknown>;
    json(res, 200, { ...st, name: full.name, version: full.version, membre: { login: p.login, name: p.name, groups: p.groups } }); return true;
  }
  if (path === '/api/stream' && meth === 'GET') {
    // Le fil en direct de l'interface porte les messages du propriétaire : un membre reçoit un fil muet (la page ne boucle pas),
    // sauf les échanges entre deux applis auxquelles il a droit toutes les deux (qui demande quoi à qui, sans les données).
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' }); res.write(': ok\n\n');
    const voit = (id: string) => aDroit(ctx, personnes(ctx).find((x) => x.login === p.login), id);
    const recents = echangesRecents(voit); if (recents.length) res.write(`data: ${JSON.stringify({ type: 'echanges', maintenant: Date.now(), list: recents })}\n\n`);
    const surEchange = (e: Echange) => { if (!res.writableEnded && voit(e.de) && voit(e.vers)) res.write(`data: ${JSON.stringify({ type: 'echange', echange: e })}\n\n`); };
    echangeBus.on('echange', surEchange);
    const ping = setInterval(() => res.write(': ping\n\n'), 25_000); req.on('close', () => { clearInterval(ping); echangeBus.off('echange', surEchange); }); return true;
  }
  if (!v) { erreur(res, 503, 'indisponible', 'Les applis d\'Odin ne sont pas démarrées.'); return true; }
  const qui = agissantDe(p), ok = (id: string) => aDroit(ctx, p, id);
  if (meth === 'GET' && path === '/api/valhalla/fichier') { const mod = s(url.searchParams.get('module')); if (!ok(mod)) { erreur(res, 403, 'refuse', messageRefus(ctx, mod)); return true; } return false; }
  if (meth === 'GET' && path.startsWith('/api/valhalla/')) {
    if (path === '/api/valhalla/view') { const id = s(url.searchParams.get('id')); if (!ok(id)) { json(res, 403, { ok: false, code: 'refuse', error: messageRefus(ctx, id), message: messageRefus(ctx, id) }); return true; } }
    if (path === '/api/valhalla/manips') { json(res, 200, { ok: true, autonomy: v.autonomy(), pending: 0, manips: [] }); return true; }
    const r = await auNomDe(qui, () => valhallaGet(path, url.searchParams)) as Record<string, unknown> | undefined;
    if (!r) { json(res, 404, { error: 'inconnu' }); return true; }
    if (Array.isArray(r.modules)) r.modules = (r.modules as Array<{ id: string }>).filter((x) => ok(x.id));
    if (Array.isArray(r.alerts)) r.alerts = (r.alerts as Array<{ module: string }>).filter((x) => ok(x.module));
    if (Array.isArray(r.notices)) r.notices = (r.notices as Array<{ module: string }>).filter((x) => ok(x.module));
    if (Array.isArray(r.found)) r.found = (r.found as Array<{ id: string }>).filter((x) => ok(x.id));
    json(res, 200, r); return true;
  }
  if (meth === 'POST' && (path === '/api/valhalla/act' || path === '/api/valhalla/order')) {
    if (req.headers['x-odin'] !== '1') { json(res, 403, { error: 'en-tête x-odin manquant' }); return true; }
    const parts: Buffer[] = []; let n = 0; for await (const c of req) { n += (c as Buffer).length; if (n > 1024 * 1024) { erreur(res, 413, 'trop_gros', 'Trop long.'); return true; } parts.push(c as Buffer); }
    let b: Record<string, unknown> = {}; try { b = JSON.parse(Buffer.concat(parts).toString('utf8') || '{}') as Record<string, unknown>; } catch { erreur(res, 400, 'requete_invalide', 'JSON illisible.'); return true; }
    if (path === '/api/valhalla/act' && !ok(s(b.module))) { noter(ctx, { login: p.login, ip: d.ip, ok: false, why: `interface d'Odin · ${nomAppli(ctx, s(b.module))} · pas le droit` }); json(res, 403, { ok: false, code: 'refuse', error: messageRefus(ctx, s(b.module)), text: messageRefus(ctx, s(b.module)) }); return true; }
    // Une action « propriétaire seul » (changer les droits ou les comptes des personnes…) : refusée ici, avant même de
    // demander une confirmation (Valhalla la refuserait de toute façon : le membre agit en son nom).
    if (path === '/api/valhalla/act') {
      const f = v.action(s(b.module), s(b.action)), input = (b.input && typeof b.input === 'object' ? b.input : {}) as Record<string, unknown>;
      const seul = f ? auNomDe(qui, () => (typeof f.a.proprietaireSeul === 'function' ? f.a.proprietaireSeul(input, v.ctx(f.m.id)) : f.a.proprietaireSeul === true)) : false;
      if (f && seul) {
        noter(ctx, { login: p.login, ip: d.ip, ok: false, why: `interface d'Odin · ${f.m.name} · ${f.a.label} · réservé au propriétaire` });
        const t = `${f.m.name} · ${f.a.label} : seul le propriétaire le règle lui-même.`; json(res, 403, { ok: false, code: 'reserve', error: t, text: t }); return true;
      }
    }
    // Une action grave n'est jamais confirmée par un membre (page, barre des applis, port direct) : elle part sans sa
    // confirmation, donc Valhalla ne la lance pas et rend ce qu'il faudrait confirmer ; le membre reçoit alors le refus.
    // Seul le propriétaire la confirme (« la famille ne peut pas faire de manip critique sur Odin »).
    const r = await auNomDe(qui, () => valhallaPost(path, { ...b, confirm: false, session: `membre-${p.login}` })) as Record<string, unknown> | undefined;
    if (r?.confirm) {
      // Une phrase vers une appli à laquelle il n'a pas droit : le refus habituel (rien de ce qu'elle ferait n'est dit).
      if (s(r.module) && !ok(s(r.module))) { const t = messageRefus(ctx, s(r.module)); json(res, 403, { ok: false, code: 'refuse', error: t, text: t }); return true; }
      const { quoi, texte } = refusGrave(s(r.confirm), prenomProprio(ctx));
      noter(ctx, { login: p.login, ip: d.ip, ok: false, why: `interface d'Odin · action grave · ${[...quoi].slice(0, 55).join('')} · réservé au propriétaire` });
      // La demande part chez le propriétaire, par le validateur d'Odin ; il ne l'exécute toujours pas lui-même. Sans
      // validateur, ou si l'action ne peut pas lui être demandée (« propriétaire seul »…) : le refus, comme avant.
      const envoi = d.demander ? await demanderAuProprietaire(ctx, p, qui, path, b, s(r.confirm), quoi, d) : undefined;
      const t = avecNouvelles(p.login, envoi ?? texte, ctx);
      json(res, 403, { ok: false, code: 'reserve', error: t, text: t, ...(envoi ? { demande: true } : {}) }); return true;
    }
    if (r && typeof r === 'object') r.text = avecNouvelles(p.login, s(r.text), ctx) || r.text;
    json(res, 200, r); return true;
  }
  if (path === '/api/message' || path === '/api/ask') { erreur(res, 403, 'reserve', 'La conversation avec l\'IA d\'Odin est réservée à son propriétaire. Ouvre directement une de tes applis, ou demande-lui en une phrase dans la barre des applis.'); return true; }
  // Les conversations sont celles du propriétaire : un membre en voit une vide (la page s'affiche sans erreur).
  if (path === '/api/history' && meth === 'GET') { json(res, 200, { peer: '', messages: [] }); return true; }
  ferme(res); return true;
}

/** /sso/odin : l'interface d'Odin demande une connexion Persona (PKCE) ; /sso/odin/retour : session ouverte. */
async function odinParPersona(req: IncomingMessage, res: ServerResponse, url: URL, d: DepsGarde): Promise<boolean> {
  const ctx = persona(); if (!ctx) { erreur(res, 503, 'indisponible', 'Persona ne tourne pas : connecte-toi avec le compte d\'Odin.'); return true; }
  const iss = issuerDe(req, d.https), retour = `${iss}/sso/odin/retour`, now = Date.now();
  if (url.pathname === '/sso/odin') {
    for (const [k, v] of debuts) if (v.exp < now) debuts.delete(k);
    const verifier = b64u(randomBytes(32)), state = b64u(randomBytes(16));
    debuts.set(state, { verifier, exp: now + 10 * 60_000 });
    const u = new URL(`${iss}/sso/autoriser`);
    for (const [k, v] of Object.entries({ response_type: 'code', client_id: 'odin', redirect_uri: retour, scope: 'openid profile groups', state, code_challenge: b64u(sha256(verifier)), code_challenge_method: 'S256', ...(url.searchParams.get('prompt') === 'login' ? { prompt: 'login' } : {}) })) u.searchParams.set(k, v);
    res.writeHead(303, { location: u.pathname + u.search, 'cache-control': 'no-store' }); res.end(); return true;
  }
  const state = s(url.searchParams.get('state')), st = debuts.get(state); debuts.delete(state);
  const page = (titre: string, texte: string, status = 400) => { res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'" }); res.end(`<!doctype html><html lang="fr"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${titre}</title><body style="font-family:system-ui;max-width:420px;margin:15vh auto;padding:0 16px"><h1 style="font-size:22px">${titre}</h1><p>${texte.replace(/[&<>]/g, (c) => `&#${c.charCodeAt(0)};`)}</p><p><a href="/">Revenir à Odin</a></p></body></html>`); };
  if (!st || st.exp < now) { page('Connexion expirée', 'Recommence la connexion depuis la page d\'Odin.'); return true; }
  if (url.searchParams.get('error')) { page('Pas d\'accès', s(url.searchParams.get('error_description')) || 'Connexion refusée.', 403); return true; }
  const sub = consommerCode(s(url.searchParams.get('code')), retour, st.verifier), p = sub ? personnes(ctx).find((x) => x.id === sub) : undefined;
  if (!p || !p.active) { page('Connexion impossible', 'Le code de connexion n\'est plus valable : recommence.'); return true; }
  if (p.proprio || p.id === lierProprietaire(ctx)?.id) { d.ouvrirSessionProprio(); noter(ctx, { login: p.login, ip: d.ip, ok: true, why: 'interface d\'Odin (propriétaire) · Persona' }); res.writeHead(303, { location: '/' }); res.end(); return true; }
  const cookie = ouvrirSessionMembre(ctx, p, { ip: d.ip, agent: s(req.headers['user-agent']), https: d.https, via: 'interface d\'Odin · Persona' });
  res.writeHead(303, { location: '/', 'set-cookie': cookie, 'cache-control': 'no-store' }); res.end(); return true;
}

/** Ouvre une session « membre » de l'interface d'Odin pour cette personne de Persona ; rend le cookie à poser. */
export function ouvrirSessionMembre(ctx: ModCtx, p: Personne, o: { ip: string; agent: string; https: boolean; via: string }): string {
  const token = randomBytes(32).toString('base64url'), hours = Number(ctx.settings.hours ?? 12), now = Date.now();
  const all = ((ctx.settings.sessions as Array<{ expires: number }> | undefined) ?? []).filter((x) => x.expires > now);
  ctx.saveSettings({ sessions: [...all, { id: sha256hex(token), login: p.login, created: now, expires: now + hours * 3600_000, ip: o.ip, agent: o.agent.slice(0, 120), seen: now, ou: 'odin' }].slice(-200) });
  noter(ctx, { login: p.login, ip: o.ip, ok: true, why: o.via });
  return sessionCookie(token, o.https);
}
/** Ferme la session « membre » dont le cookie a cette empreinte. */
export function fermerSessionMembre(ctx: ModCtx, h: string): void {
  ctx.saveSettings({ sessions: ((ctx.settings.sessions as Array<{ id: string }> | undefined) ?? []).filter((x) => x.id !== h) });
}
