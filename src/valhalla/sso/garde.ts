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
import { aDroit, setVenusUrl, lierProprietaire, messageRefus, nomAppli, noter, persona, personnes, type Personne } from './etat.ts';
import { consommerCode, erreur, issuerDe, json, routeOidc, type DepsSSO } from './oidc.ts';
import { routeSauvegardes } from './sauvegardes.ts';

export interface DepsGarde extends DepsSSO {
  /** l'appli du port direct par lequel la requête arrive */ direct?: string;
  /** ouvre la session habituelle du propriétaire (cookie de l'interface) */ ouvrirSessionProprio(): void;
  /** l'état complet de l'interface (vidé pour un membre) */ etat(): unknown;
  /** l'adresse de Vénus (son adresse de retour préinscrite) */ venus?: string;
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

/** Rend true si la requête est servie ici. */
export async function gardeSSO(req: IncomingMessage, res: ServerResponse, url: URL, d: DepsGarde): Promise<boolean> {
  const path = url.pathname; setVenusUrl(() => d.venus ?? '');
  // L'interface d'Odin par Persona (Odin est sa propre appli cliente).
  if (path === '/sso/odin' || path === '/sso/odin/retour') return odinParPersona(req, res, url, d);
  if (await routeOidc(req, res, url, d)) return true;
  if (await routeSauvegardes(req, res, url)) return true;
  const m = membreDe(s(req.headers.cookie)); if (!m) return false;
  const { p, ctx } = m, v = valhallaOf();
  // Port direct d'une appli.
  if (d.direct && !aDroit(ctx, p, d.direct)) { erreur(res, 403, 'refuse', messageRefus(ctx, d.direct)); return true; }
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
    // Le fil en direct de l'interface porte les messages du propriétaire : un membre reçoit un fil muet (la page ne boucle pas).
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' }); res.write(': ok\n\n');
    const ping = setInterval(() => res.write(': ping\n\n'), 25_000); req.on('close', () => clearInterval(ping)); return true;
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
    const r = await auNomDe(qui, () => valhallaPost(path, { ...b, session: `membre-${p.login}` }));
    json(res, 200, r); return true;
  }
  if (path === '/api/message' || path === '/api/ask') { erreur(res, 403, 'reserve', 'La conversation avec l\'IA d\'Odin est réservée à son propriétaire. Ouvre directement une de tes applis, ou demande-lui en une phrase dans la barre des applis.'); return true; }
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
  const token = randomBytes(32).toString('base64url'), hours = Number(ctx.settings.hours ?? 12);
  const all = ((ctx.settings.sessions as Array<{ expires: number }> | undefined) ?? []).filter((x) => x.expires > now);
  ctx.saveSettings({ sessions: [...all, { id: sha256hex(token), login: p.login, created: now, expires: now + hours * 3600_000, ip: d.ip, agent: s(req.headers['user-agent']).slice(0, 120), seen: now, ou: 'odin' }].slice(-200) });
  noter(ctx, { login: p.login, ip: d.ip, ok: true, why: 'interface d\'Odin · Persona' });
  res.writeHead(303, { location: '/', 'set-cookie': sessionCookie(token, d.https), 'cache-control': 'no-store' }); res.end(); return true;
}
