// Odin, fournisseur d'identité (OpenID Connect, écrit dans Odin, sans dépendance) : découverte, autoriser (le portail
// Persona, code + PKCE S256 obligatoire), jetons (ES256, 15 min), renouvellement lié à l'appareil (rotation, réutilisation
// détectée), infos, clés, déconnexion, révocation ; et le SSO du poste (connexion, poste, échange). Voir docs/sso-protocole.md.

import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { join } from 'node:path';
import type { ModCtx } from '../types.ts';
import { checkPassword } from '../valgrind/proxy.ts';
import { personaPage, totpOk } from '../modules/var.ts';
import type { Accounts } from '../../web/account.ts';
import { b64u, sha256, sha256hex, signer, signeur, verifier, type Signeur } from './jwt.ts';
import {
  ACCES_MIN, POSTE_INACTIF, POSTE_MAX, RENOUV_INACTIF, RENOUV_MAX, aDroit, applisDe, client, clients, lierProprietaire, messageRefus, nomAppli, noter, nouvelId,
  parSub, persona, personnes, retourPermis, revoquerPoste, revoquerSession, sauverPostes, sauverSessions, sessionValide, sessionsApplis, sessionsPostes, trouver, vivante,
  type Appareil, type Client, type Personne, type SessionAppli,
} from './etat.ts';

export interface DepsSSO {
  /** le compte du propriétaire (son mot de passe est vérifié par lui) */ accounts: Accounts;
  /** adresse du visiteur */ ip: string;
  https: boolean;
  /** un essai raté compte aussi dans le freinage général d'Odin */ fail(): void;
  /** ce navigateur a-t-il la session de l'interface du propriétaire ? */ proprietaireConnecte(): boolean;
  version: string;
}

const s = (v: unknown) => (v === undefined || v === null ? '' : String(v)).trim();
export const issuerDe = (req: IncomingMessage, https: boolean) => `${https ? 'https' : 'http'}://${s(req.headers.host) || 'localhost'}`;
export const cleSignature = (ctx: ModCtx): Signeur => signeur(join(ctx.dir, 'sso', 'cle-signature.enc'));
const egal = (a: string, b: string) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); };

export function json(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', pragma: 'no-cache', 'x-content-type-options': 'nosniff', ...headers });
  res.end(JSON.stringify(body));
}
export const erreur = (res: ServerResponse, status: number, code: string, message: string, plus: Record<string, unknown> = {}, headers: Record<string, string> = {}) => json(res, status, { ok: false, code, message, ...plus }, headers);
const oauth = (res: ServerResponse, status: number, error: string, message: string, headers: Record<string, string> = {}) => json(res, status, { error, error_description: message, message }, headers);

async function lireCorps(req: IncomingMessage, max = 64 * 1024): Promise<{ ok: true; v: Record<string, string>; json: boolean } | { ok: false; status: number }> {
  const parts: Buffer[] = []; let n = 0;
  for await (const c of req) { n += (c as Buffer).length; if (n > max) return { ok: false, status: 413 }; parts.push(c as Buffer); }
  const raw = Buffer.concat(parts).toString('utf8'), type = s(req.headers['content-type']);
  if (/application\/json/i.test(type)) {
    try { const j = JSON.parse(raw || '{}') as unknown; if (!j || typeof j !== 'object' || Array.isArray(j)) return { ok: false, status: 400 };
      const v: Record<string, string> = {}; for (const [k, x] of Object.entries(j as Record<string, unknown>)) v[k] = typeof x === 'object' && x !== null ? JSON.stringify(x) : s(x); return { ok: true, v, json: true }; } catch { return { ok: false, status: 400 }; }
  }
  return { ok: true, v: Object.fromEntries(new URLSearchParams(raw)), json: false };
}
const objet = (x: string): Record<string, unknown> => { try { const j = JSON.parse(x) as unknown; return j && typeof j === 'object' ? j as Record<string, unknown> : {}; } catch { return {}; } };
const PLATEFORMES = ['windows', 'mac', 'linux', 'android', 'web', 'autre'];
/** Un appareil décrit par l'appli : `{ id, nom, plateforme }` (ou une simple chaîne : le nom). */
export function appareilDe(raw: string, plusNom = '', plusPlat = ''): Appareil | string {
  const o = raw.startsWith('{') ? objet(raw) : { id: raw, nom: plusNom, plateforme: plusPlat };
  const id = s(o.id), nom = s(o.nom).replace(/[\u0000-\u001f]/g, ' ').slice(0, 60) || 'appareil', plateforme = s(o.plateforme).toLowerCase() || 'autre';
  if (id && !/^[A-Za-z0-9_-]{8,64}$/.test(id)) return 'appareil.id : 8 à 64 caractères (lettres, chiffres, _ et -)';
  if (!PLATEFORMES.includes(plateforme)) return `appareil.plateforme : ${PLATEFORMES.join(', ')}`;
  return { id, nom, plateforme };
}

// ---------------- Vérifier une personne (mot de passe, code), avec freinage et journal
const essais = new Map<string, number[]>();
const pendants = new Map<string, { sub: string; ip: string; exp: number }>();
type Verif = { ok: true; p: Personne } | { ok: false; status: number; code: string; message: string; attente?: number };
export async function verifierPersonne(ctx: ModCtx, d: DepsSSO, ident: string, mdp: string, code: string, quoi: string): Promise<Verif> {
  const now = Date.now(), t = (essais.get(d.ip) ?? []).filter((x) => now - x < 600_000);
  if (t.length >= 20) { const attente = Math.ceil((t[0] + 600_000 - now) / 1000); return { ok: false, status: 429, code: 'trop_d_essais', message: `Trop d'essais depuis cette adresse : réessaie dans ${Math.ceil(attente / 60)} minute(s).`, attente }; }
  const a = d.accounts.profile();
  let p = trouver(ctx, ident);
  if (!p && a && s(ident).toLowerCase() === a.email) p = lierProprietaire(ctx);
  const rate = (why: string, codeErr = 'identifiants', msg = 'Identifiant ou mot de passe incorrect.'): Verif => {
    essais.set(d.ip, [...t, now]); d.fail(); noter(ctx, { login: (p?.login ?? s(ident)).slice(0, 32), ip: d.ip, ok: false, why: `${quoi} · ${why}` });
    if (p && !p.proprio) {
      const n = p.fails + 1, lock = n >= 5 ? now + 15 * 60_000 : p.lockedUntil, id = p.id;
      ctx.saveSettings({ people: personnes(ctx).map((x) => (x.id === id ? { ...x, fails: n, lockedUntil: lock } : x)) });
      if (n === 5) { ctx.alert({ level: 'haute', title: `Compte « ${p.login} » verrouillé 15 minutes`, detail: `5 mauvais essais (${quoi}), le dernier depuis ${d.ip}. Si ce n'est pas cette personne, quelqu'un essaie de deviner son mot de passe.`, key: `var-verrou-${p.id}-${Math.floor(now / 900_000)}` }); void ctx.call('garmr', 'bannir', { ip: d.ip, raison: `5 mauvais mots de passe sur le compte ${p.login} (connexion unique)`, minutes: 60 }, 'trop d\'essais de mot de passe').catch(() => undefined); }
    }
    return { ok: false, status: 401, code: codeErr, message: msg };
  };
  if (!p || !p.active) { checkPassword(mdp, '00000000000000000000000000000000:00'); return rate('compte inconnu ou coupé'); }
  if (p.lockedUntil && p.lockedUntil > now) return { ok: false, status: 423, code: 'verrouille', message: `Compte verrouillé après trop d'essais : réessaie dans ${Math.ceil((p.lockedUntil - now) / 60_000)} minute(s).`, attente: Math.ceil((p.lockedUntil - now) / 1000) };
  // Étape du code : le mot de passe vient d'être vérifié (jeton court en mémoire), ou il est redonné avec le code.
  const pend = [...pendants.entries()].find(([, v]) => v.sub === p!.id && v.ip === d.ip && v.exp > now);
  if (!(code && pend && !mdp)) {
    if (p.proprio) {
      const r = await d.accounts.login(p.email, mdp);
      if (!r.ok) { if (r.retryAfter && /Trop d'essais/.test(r.error)) return { ok: false, status: 429, code: 'trop_d_essais', message: r.error, attente: r.retryAfter }; return rate('mauvais mot de passe'); }
    } else if (!checkPassword(mdp, p.hash)) return rate('mauvais mot de passe');
  }
  const exige = ((ctx.settings.require2fa as string[] | undefined) ?? []).some((g) => p!.groups.includes(g));
  if (exige && !p.totp) { noter(ctx, { login: p.login, ip: d.ip, ok: false, why: `${quoi} · double authentification à régler` }); return { ok: false, status: 403, code: 'double_auth_a_regler', message: 'Ton groupe demande un code en plus du mot de passe. Demande à l\'administrateur d\'Odin de l\'activer pour toi (Persona → Double authentification).' }; }
  if (p.totp) {
    if (!code) { pendants.set(randomBytes(9).toString('hex'), { sub: p.id, ip: d.ip, exp: now + 5 * 60_000 }); return { ok: false, status: 401, code: 'code_requis', message: 'Tape le code à 6 chiffres de ton appli d\'authentification.' }; }
    if (pend) pendants.delete(pend[0]);
    if (!totpOk(p.totp, code)) return rate('mauvais code', 'code_faux', 'Code incorrect : recommence avec le mot de passe et un nouveau code.');
  }
  essais.delete(d.ip); const id = p.id;
  ctx.saveSettings({ people: personnes(ctx).map((x) => (x.id === id ? { ...x, fails: 0, lockedUntil: undefined, lastLogin: now } : x)) });
  return { ok: true, p: parSub(ctx, id) ?? p };
}

// ---------------- Émettre les jetons
export interface Reponse { access_token: string; token_type: 'Bearer'; expires_in: number; id_token: string; refresh_token: string; scope: string }
function jetons(ctx: ModCtx, p: Personne, c: Client, x: SessionAppli, iss: string, nonce: string | undefined, secret: string, authTime: number): Reponse {
  const sg = cleSignature(ctx), t = Math.floor(Date.now() / 1000);
  const id = { name: p.name, preferred_username: p.login, ...(p.email ? { email: p.email } : {}), groups: p.groups };
  const access = signer(sg, { iss, sub: p.id, aud: c.id, client_id: c.id, iat: t, exp: t + ACCES_MIN, jti: b64u(randomBytes(12)), sid: x.id, scope: x.scope, ...id }, 'at+jwt');
  const idt = signer(sg, { iss, sub: p.id, aud: c.id, iat: t, exp: t + ACCES_MIN, auth_time: Math.floor(authTime / 1000), sid: x.id, ...(nonce ? { nonce } : {}), ...id });
  return { access_token: access, token_type: 'Bearer', expires_in: ACCES_MIN, id_token: idt, refresh_token: `odr1.${x.id}.${secret}`, scope: x.scope };
}
export function emettre(ctx: ModCtx, p: Personne, c: Client, o: { iss: string; appareil: Appareil; via: string; poste?: string; scope?: string; nonce?: string; authTime?: number }): Reponse {
  const now = Date.now(), secret = b64u(randomBytes(32)), x: SessionAppli = { id: nouvelId(), sub: p.id, login: p.login, appli: c.id, appareil: o.appareil, cree: now, vu: now, fin: now + RENOUV_MAX, h: sha256hex(`odr1.${''}`), anciens: [], via: o.via, scope: o.scope || 'openid profile email groups offline_access', ...(o.poste ? { poste: o.poste } : {}) };
  x.h = sha256hex(`odr1.${x.id}.${secret}`);
  sauverSessions(ctx, [...sessionsApplis(ctx), x]);
  return jetons(ctx, p, c, x, o.iss, o.nonce, secret, o.authTime ?? now);
}
const personneJson = (p: Personne) => ({ sub: p.id, preferred_username: p.login, name: p.name, ...(p.email ? { email: p.email } : {}), groups: p.groups });

/** Le jeton d'accès de cette requête : signature, expiration, session encore ouverte, personne active. */
export function lireJeton(ctx: ModCtx, req: IncomingMessage): { ok: true; charge: Record<string, unknown>; p: Personne; session: SessionAppli } | { ok: false; status: number; code: string; message: string } {
  const b = /^Bearer\s+(\S+)$/i.exec(s(req.headers.authorization))?.[1];
  if (!b) return { ok: false, status: 401, code: 'jeton_requis', message: 'Connexion à Odin demandée (jeton absent).' };
  const v = verifier(b, cleSignature(ctx).public, { typ: 'at+jwt' });
  if (!v.ok) return { ok: false, status: 401, code: 'jeton_invalide', message: v.raison === 'jeton expiré' ? 'Ta connexion à Odin a expiré : renouvelle-la.' : 'Ce jeton n\'est pas reconnu par Odin : reconnecte-toi.' };
  const x = sessionValide(ctx, s(v.charge.sid)), p = x ? parSub(ctx, x.sub) : undefined;
  if (!x || !p) return { ok: false, status: 401, code: 'jeton_invalide', message: 'Cette connexion a été coupée dans Odin : reconnecte-toi.' };
  return { ok: true, charge: v.charge, p, session: x };
}

// ---------------- Pages (portail Persona)
const esc = (x: string) => x.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
function page(res: ServerResponse, status: number, titre: string, corps: string, formTo = ''): void {
  const nonce = randomBytes(16).toString('base64');
  res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-frame-options': 'DENY', 'x-content-type-options': 'nosniff', 'referrer-policy': 'same-origin',
    'content-security-policy': `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; form-action 'self'${formTo}; frame-ancestors 'none'; base-uri 'none'` });
  res.end(personaPage(titre, corps, nonce));
}
const pageErreur = (res: ServerResponse, status: number, titre: string, texte: string) => page(res, status, titre, `<div class="card"><h1>${esc(titre)}</h1><p>${esc(texte)}</p></div>`);
interface Demande { c: string; redirect: string; state: string; nonce: string; challenge: string; scope: string; appareil: Appareil; exp: number; code?: { sub: string } }
const demandes = new Map<string, Demande>();
interface Code { c: string; redirect: string; challenge: string; nonce: string; sub: string; scope: string; authTime: number; appareil: Appareil; exp: number; used?: boolean; sid?: string }
const codes = new Map<string, Code>();
const SESSION_COOKIE = 'odin_var';
function cookieSso(token: string, maxAge: number, https: boolean) { return `${SESSION_COOKIE}=${token}; Path=/sso; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${https ? '; Secure' : ''}`; }
/** La personne de la session Persona de ce navigateur sur Odin (cookie sur /sso). */
function sessionNavigateur(ctx: ModCtx, req: IncomingMessage): { p: Personne; id: string } | undefined {
  const tok = /(?:^|;\s*)odin_var=([A-Za-z0-9_-]{20,100})/.exec(s(req.headers.cookie))?.[1]; if (!tok) return undefined;
  const all = (ctx.settings.sessions as Array<{ id: string; login: string; expires: number }> | undefined) ?? [], h = sha256hex(tok), x = all.find((y) => y.id === h && y.expires > Date.now());
  const p = x ? personnes(ctx).find((y) => y.login === x.login && y.active) : undefined; return p && x ? { p, id: h } : undefined;
}
function ouvrirNavigateur(ctx: ModCtx, req: IncomingMessage, res: ServerResponse, p: Personne, d: DepsSSO): void {
  const token = randomBytes(32).toString('base64url'), now = Date.now(), hours = Number(ctx.settings.hours ?? 12);
  const all = ((ctx.settings.sessions as Array<{ expires: number }> | undefined) ?? []).filter((x) => x.expires > now);
  ctx.saveSettings({ sessions: [...all, { id: sha256hex(token), login: p.login, created: now, expires: now + hours * 3600_000, ip: d.ip, agent: s(req.headers['user-agent']).slice(0, 120), seen: now, ou: 'sso' }].slice(-200) });
  res.setHeader('set-cookie', cookieSso(token, hours * 3600, d.https));
}
function renvoi(res: ServerResponse, uri: string, params: Record<string, string>): void {
  const u = new URL(uri); for (const [k, v] of Object.entries(params)) if (v) u.searchParams.set(k, v);
  res.writeHead(303, { location: u.toString(), 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' }); res.end();
}
const formTo = (uri: string) => { try { const u = new URL(uri); return /^https?:$/.test(u.protocol) ? ` ${u.origin}` : ` ${u.protocol}`; } catch { return ''; } };
/** Fin du parcours : droit vérifié, puis code (ou refus) renvoyé à l'appli. */
function finir(ctx: ModCtx, res: ServerResponse, dm: Demande, p: Personne, iss: string, d: DepsSSO, via: string): void {
  const c = client(ctx, dm.c)!;
  if (!aDroit(ctx, p, c.id)) { noter(ctx, { login: p.login, ip: d.ip, ok: false, why: `SSO ${c.nom} · pas le droit` }); return renvoi(res, dm.redirect, { error: 'access_denied', error_description: messageRefus(ctx, c.id), state: dm.state, iss }); }
  const code = b64u(randomBytes(32));
  codes.set(sha256hex(code), { c: c.id, redirect: dm.redirect, challenge: dm.challenge, nonce: dm.nonce, sub: p.id, scope: dm.scope, authTime: Date.now(), appareil: dm.appareil, exp: Date.now() + 60_000 });
  for (const [k, v] of codes) if (v.exp < Date.now() - 600_000) codes.delete(k);
  noter(ctx, { login: p.login, ip: d.ip, ok: true, why: `SSO ${c.nom} · ${via}` });
  renvoi(res, dm.redirect, { code, state: dm.state, iss });
}
function formulaire(res: ServerResponse, id: string, dm: Demande, ctx: ModCtx, etape: 'mdp' | 'code', ident = '', err = '', status = 200): void {
  const nom = esc(nomAppli(ctx, dm.c));
  page(res, status, `Connexion · ${nomAppli(ctx, dm.c)}`, `<div class="card"><h1>${etape === 'code' ? 'Code de vérification' : 'Connexion'}</h1><p>${etape === 'code' ? 'Tape le code à 6 chiffres de ton appli d\'authentification.' : `${nom} te demande de te connecter avec ton compte Odin.`}</p>
<form method="post" action="/sso/autoriser"><input type="hidden" name="demande" value="${esc(id)}">
${etape === 'mdp' ? `<label for="l">Identifiant ou e-mail</label><input id="l" name="identifiant" autocomplete="username" autocapitalize="none" spellcheck="false" required value="${esc(ident)}" autofocus>
<label for="p">Mot de passe</label><input id="p" name="motdepasse" type="password" autocomplete="current-password" required>` : `<input type="hidden" name="identifiant" value="${esc(ident)}">
<label for="c">Code</label><input id="c" name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9 ]{6,7}" maxlength="7" required autofocus>`}
${err ? `<p class="err" role="alert">${esc(err)}</p>` : ''}<button type="submit">${etape === 'code' ? 'Vérifier' : 'Se connecter'}</button></form></div>`, formTo(dm.redirect));
}

// ---------------- CORS (applis web déclarées)
function cors(ctx: ModCtx, req: IncomingMessage, res: ServerResponse): void {
  const o = s(req.headers.origin); if (!o) return;
  const ok = clients(ctx).some((c) => c.retours.some((r) => { try { const u = new URL(r); return /^https?:$/.test(u.protocol) && u.origin === o; } catch { return false; } }));
  if (ok) { res.setHeader('access-control-allow-origin', o); res.setHeader('vary', 'Origin'); res.setHeader('access-control-allow-headers', 'authorization, content-type'); res.setHeader('access-control-allow-methods', 'GET, POST'); }
}

/** Les routes /.well-known/openid-configuration et /sso/*. Rend true si la requête est servie. */
export async function routeOidc(req: IncomingMessage, res: ServerResponse, url: URL, d: DepsSSO): Promise<boolean> {
  const p0 = url.pathname;
  if (p0 !== '/.well-known/openid-configuration' && !p0.startsWith('/sso/')) return false;
  const ctx = persona();
  if (!ctx) { erreur(res, 503, 'indisponible', 'La connexion unique d\'Odin ne tourne pas (applis arrêtées) : réessaie dans un moment.'); return true; }
  const iss = issuerDe(req, d.https), m = req.method ?? 'GET';
  res.setHeader('cross-origin-resource-policy', 'cross-origin'); cors(ctx, req, res);
  if (m === 'OPTIONS') { res.writeHead(204); res.end(); return true; }
  if (p0 === '/.well-known/openid-configuration') {
    json(res, 200, { issuer: iss, authorization_endpoint: `${iss}/sso/autoriser`, token_endpoint: `${iss}/sso/jeton`, userinfo_endpoint: `${iss}/sso/infos`, jwks_uri: `${iss}/sso/cles`, end_session_endpoint: `${iss}/sso/deconnexion`, revocation_endpoint: `${iss}/sso/revoquer`,
      response_types_supported: ['code'], response_modes_supported: ['query'], grant_types_supported: ['authorization_code', 'refresh_token'], subject_types_supported: ['public'], id_token_signing_alg_values_supported: ['ES256'],
      code_challenge_methods_supported: ['S256'], token_endpoint_auth_methods_supported: ['none', 'client_secret_basic', 'client_secret_post'], scopes_supported: ['openid', 'profile', 'email', 'groups', 'offline_access'],
      claims_supported: ['sub', 'name', 'preferred_username', 'email', 'groups', 'applis', 'nonce', 'auth_time', 'sid'], authorization_response_iss_parameter_supported: true,
      odin: { protocole: 1, nom: 'Odin', version: d.version, connexion: `${iss}/sso/connexion`, poste: `${iss}/sso/poste`, echange: `${iss}/sso/echange`, sauvegardes: `${iss}/api/sauvegardes/` } }, { 'cache-control': 'max-age=300' });
    return true;
  }
  if (p0 === '/sso/cles') { json(res, 200, { keys: [cleSignature(ctx).jwk] }, { 'cache-control': 'max-age=300' }); return true; }
  if (p0 === '/sso/autoriser') { await autoriser(ctx, req, res, url, d, iss); return true; }
  if (p0 === '/sso/jeton') { if (m !== 'POST') { oauth(res, 405, 'invalid_request', 'Utilise POST.'); return true; } await jeton(ctx, req, res, d, iss); return true; }
  if (p0 === '/sso/infos') {
    const j = lireJeton(ctx, req); if (!j.ok) { erreur(res, j.status, j.code, j.message, {}, { 'www-authenticate': 'Bearer error="invalid_token"' }); return true; }
    json(res, 200, { ...personneJson(j.p), applis: applisDe(ctx, j.p), appli: j.session.appli }); return true;
  }
  if (p0 === '/sso/deconnexion') { await deconnexion(ctx, req, res, url, d); return true; }
  if (p0 === '/sso/revoquer') {
    if (m !== 'POST') { erreur(res, 405, 'requete_invalide', 'Utilise POST.'); return true; }
    const b = await lireCorps(req); if (!b.ok) { erreur(res, b.status, 'requete_invalide', 'Corps illisible.'); return true; }
    revoquer(ctx, b.v.jeton_poste || '', b.v.token || b.v.refresh_token || '', d); json(res, 200, { ok: true }); return true;
  }
  if (p0 === '/sso/connexion' || p0 === '/sso/poste' || p0 === '/sso/echange') {
    if (m !== 'POST') { erreur(res, 405, 'requete_invalide', 'Utilise POST.'); return true; }
    if (!/application\/json/i.test(s(req.headers['content-type']))) { erreur(res, 415, 'json_attendu', 'Envoie du JSON (content-type: application/json).'); return true; }
    const b = await lireCorps(req); if (!b.ok) { erreur(res, b.status === 413 ? 413 : 400, b.status === 413 ? 'trop_gros' : 'requete_invalide', 'Corps illisible.'); return true; }
    if (p0 === '/sso/connexion') await connexion(ctx, res, b.v, d, iss);
    else if (p0 === '/sso/poste') poste(ctx, req, res, b.v);
    else echange(ctx, res, b.v, d, iss);
    return true;
  }
  return false;
}

async function autoriser(ctx: ModCtx, req: IncomingMessage, res: ServerResponse, url: URL, d: DepsSSO, iss: string): Promise<void> {
  if (req.method === 'POST') {
    const origin = s(req.headers.origin); if (origin && origin !== 'null' && origin !== iss) return pageErreur(res, 403, 'Refusé', 'Formulaire envoyé depuis un autre site.');
    const b = await lireCorps(req, 8000); if (!b.ok) return pageErreur(res, 400, 'Formulaire illisible', 'Recommence depuis l\'appli.');
    const id = b.v.demande ?? '', dm = demandes.get(id);
    if (!dm || dm.exp < Date.now()) return pageErreur(res, 400, 'Demande expirée', 'La page de connexion est restée ouverte trop longtemps : recommence depuis l\'appli.');
    const r = await verifierPersonne(ctx, d, s(b.v.identifiant), b.v.motdepasse ?? '', s(b.v.code).replace(/\s/g, ''), `SSO ${nomAppli(ctx, dm.c)}`);
    if (!r.ok) return r.code === 'code_requis' ? formulaire(res, id, dm, ctx, 'code', s(b.v.identifiant)) : formulaire(res, id, dm, ctx, 'mdp', s(b.v.identifiant), r.message, r.status);
    demandes.delete(id); ouvrirNavigateur(ctx, req, res, r.p, d);
    return finir(ctx, res, dm, r.p, iss, d, r.p.totp ? 'mot de passe + code' : 'mot de passe');
  }
  const q = url.searchParams, c = client(ctx, s(q.get('client_id'))), redirect = s(q.get('redirect_uri'));
  if (!c) return pageErreur(res, 400, 'Appli inconnue', 'Cette appli n\'est pas déclarée dans Odin (Persona → Applis).');
  const okRetour = c.id === 'odin' ? redirect === `${iss}/sso/odin/retour` : retourPermis(c, redirect);
  if (!okRetour) return pageErreur(res, 400, 'Adresse de retour non déclarée', `L'adresse de retour demandée n'est pas déclarée pour ${c.nom}. Le propriétaire peut l'ajouter dans Persona → Applis.`);
  const state = s(q.get('state')), back = (error: string, msg: string) => renvoi(res, redirect, { error, error_description: msg, state, iss });
  if (q.get('response_type') !== 'code') return back('unsupported_response_type', 'Seul response_type=code est accepté.');
  if (state.length < 8 || state.length > 512) return back('invalid_request', 'Le paramètre state est obligatoire (8 à 512 caractères).');
  if (!s(q.get('scope')).split(/\s+/).includes('openid')) return back('invalid_scope', 'Le scope doit contenir openid.');
  const challenge = s(q.get('code_challenge')), methode = s(q.get('code_challenge_method'));
  if (!c.secret || challenge) { if (!/^[A-Za-z0-9_-]{43}$/.test(challenge) || methode !== 'S256') return back('invalid_request', 'PKCE obligatoire : code_challenge (SHA-256 en base64url) et code_challenge_method=S256.'); }
  const nonce = s(q.get('nonce')).slice(0, 512), app = appareilDe(s(q.get('appareil')), s(q.get('appareil_nom')), s(q.get('plateforme')) || 'web');
  const dm: Demande = { c: c.id, redirect, state, nonce, challenge, scope: s(q.get('scope')).slice(0, 300), appareil: typeof app === 'string' ? { id: '', nom: 'navigateur', plateforme: 'web' } : app, exp: Date.now() + 10 * 60_000 };
  const prompt = s(q.get('prompt'));
  if (prompt !== 'login') {
    const nav = sessionNavigateur(ctx, req);
    if (nav) return finir(ctx, res, dm, nav.p, iss, d, 'session du navigateur');
    if (d.proprietaireConnecte()) { const p = lierProprietaire(ctx); if (p) return finir(ctx, res, dm, p, iss, d, 'session du propriétaire'); }
    // Le cookie de l'interface d'Odin est « SameSite=Strict » : arrivé depuis un autre site, le navigateur ne l'envoie pas.
    // Un détour par une page d'Odin rend la navigation « du même site » : il l'envoie alors (une seule fois).
    if (s(req.headers['sec-fetch-site']) === 'cross-site' && q.get('_odin') !== '1') {
      const u = new URL(url.toString(), iss); u.searchParams.set('_odin', '1'); const nonce2 = randomBytes(16).toString('base64');
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer', 'content-security-policy': `default-src 'none'; script-src 'nonce-${nonce2}'; frame-ancestors 'none'; base-uri 'none'` });
      return void res.end(`<!doctype html><meta charset="utf-8"><title>Odin</title><script nonce="${nonce2}">location.replace(${JSON.stringify(u.pathname + u.search).replace(/</g, '\\u003c')})</script><noscript><a href="${esc(u.pathname + u.search)}">Continuer</a></noscript>`);
    }
  }
  if (prompt === 'none') return back('login_required', 'Aucune session Odin ouverte dans ce navigateur.');
  for (const [k, v] of demandes) if (v.exp < Date.now()) demandes.delete(k);
  if (demandes.size > 5000) return pageErreur(res, 503, 'Trop de demandes', 'Réessaie dans quelques minutes.');
  const id = b64u(randomBytes(18)); demandes.set(id, dm);
  return formulaire(res, id, dm, ctx, 'mdp', s(q.get('login_hint')).slice(0, 100));
}

function authClient(c: Client, req: IncomingMessage, v: Record<string, string>): boolean {
  if (!c.secret) return true;
  let sec = v.client_secret ?? '';
  const basic = /^Basic\s+(\S+)$/i.exec(s(req.headers.authorization))?.[1];
  if (basic) { const [id, pw] = Buffer.from(basic, 'base64').toString('utf8').split(':'); if (decodeURIComponent(id ?? '') === c.id) sec = decodeURIComponent(pw ?? ''); }
  return Boolean(sec) && egal(sha256hex(sec), c.secret);
}

async function jeton(ctx: ModCtx, req: IncomingMessage, res: ServerResponse, d: DepsSSO, iss: string): Promise<void> {
  const b = await lireCorps(req); if (!b.ok) return oauth(res, 400, 'invalid_request', 'Corps illisible.');
  const v = b.v, basicId = (() => { const x = /^Basic\s+(\S+)$/i.exec(s(req.headers.authorization))?.[1]; return x ? decodeURIComponent(Buffer.from(x, 'base64').toString('utf8').split(':')[0] ?? '') : ''; })();
  const c = client(ctx, v.client_id || basicId);
  if (!c || c.id === 'odin') return oauth(res, 401, 'invalid_client', 'Appli inconnue : déclare-la dans Odin (Persona → Applis).');
  if (!authClient(c, req, v)) { d.fail(); return oauth(res, 401, 'invalid_client', 'Secret de l\'appli incorrect.'); }
  if (v.grant_type === 'authorization_code') {
    const h = sha256hex(v.code ?? ''), x = codes.get(h);
    if (!x || x.exp < Date.now() || x.c !== c.id) { d.fail(); return oauth(res, 400, 'invalid_grant', 'Ce code est inconnu ou il a expiré : recommence la connexion.'); }
    if (x.used) { if (x.sid) revoquerSession(ctx, x.sid); d.fail(); return oauth(res, 400, 'invalid_grant', 'Ce code a déjà servi : par prudence, la connexion qu\'il avait ouverte est coupée. Recommence.'); }
    if (x.redirect !== (v.redirect_uri ?? '')) return oauth(res, 400, 'invalid_grant', 'redirect_uri différente de celle de la demande.');
    if (x.challenge || !c.secret) {
      const ver = v.code_verifier ?? '';
      if (!/^[A-Za-z0-9._~-]{43,128}$/.test(ver) || b64u(sha256(ver)) !== x.challenge) { x.used = true; d.fail(); return oauth(res, 400, 'invalid_grant', 'Preuve PKCE fausse (code_verifier) : recommence la connexion.'); }
    }
    x.used = true;
    const p = parSub(ctx, x.sub); if (!p || !p.active) return oauth(res, 400, 'invalid_grant', 'Ce compte n\'est plus actif.');
    if (!aDroit(ctx, p, c.id)) return oauth(res, 403, 'access_denied', messageRefus(ctx, c.id));
    const app = v.appareil ? appareilDe(v.appareil, v.appareil_nom ?? '', v.plateforme ?? '') : x.appareil;
    if (typeof app === 'string') return oauth(res, 400, 'invalid_request', app);
    const r = emettre(ctx, p, c, { iss, appareil: app, via: 'navigateur', scope: x.scope, nonce: x.nonce || undefined, authTime: x.authTime });
    x.sid = r.refresh_token.split('.')[1];
    return json(res, 200, r);
  }
  if (v.grant_type === 'refresh_token') {
    const m = /^odr1\.([a-f0-9]{10})\.[A-Za-z0-9_-]{43}$/.exec(v.refresh_token ?? '');
    const all = sessionsApplis(ctx), x = m ? all.find((y) => y.id === m[1]) : undefined;
    if (!x || !vivante(x, RENOUV_INACTIF) || x.appli !== c.id) { d.fail(); return oauth(res, 400, 'invalid_grant', 'Cette connexion a été coupée ou elle a expiré : reconnecte-toi.'); }
    const h = sha256hex(v.refresh_token);
    if (!egal(h, x.h)) {
      if (x.anciens.includes(h)) { revoquerSession(ctx, x.id); noter(ctx, { login: x.login, ip: d.ip, ok: false, why: `SSO ${c.nom} · jeton de renouvellement réutilisé (session coupée)` }); ctx.alert({ level: 'haute', title: `Connexion de ${x.login} à ${c.nom} coupée`, detail: `Un ancien jeton de renouvellement a été présenté depuis ${d.ip} : il a peut-être été volé. La session (${x.appareil.nom}) est coupée ; la personne doit se reconnecter.`, key: `sso-reuse-${x.id}` }); }
      d.fail(); return oauth(res, 400, 'invalid_grant', 'Ce jeton de renouvellement a déjà servi : par prudence, la connexion est coupée. Reconnecte-toi.');
    }
    if (x.appareil.id && (v.appareil ?? '') !== x.appareil.id) { d.fail(); return oauth(res, 400, 'invalid_grant', 'Ce jeton appartient à un autre appareil.'); }
    if (x.poste) { const po = sessionsPostes(ctx).find((y) => y.id === x.poste); if (!po || !vivante(po, POSTE_INACTIF)) return oauth(res, 400, 'invalid_grant', 'La connexion de ce poste a été coupée : reconnecte-toi.'); }
    const p = parSub(ctx, x.sub); if (!p || !p.active) return oauth(res, 400, 'invalid_grant', 'Ce compte n\'est plus actif.');
    if (!aDroit(ctx, p, c.id)) return oauth(res, 403, 'access_denied', messageRefus(ctx, c.id));
    const secret = b64u(randomBytes(32)), nx: SessionAppli = { ...x, vu: Date.now(), h: sha256hex(`odr1.${x.id}.${secret}`), anciens: [...x.anciens, x.h].slice(-30) };
    sauverSessions(ctx, sessionsApplis(ctx).map((y) => (y.id === x.id ? nx : y)));
    return json(res, 200, jetons(ctx, p, c, nx, iss, undefined, secret, nx.cree));
  }
  return oauth(res, 400, 'unsupported_grant_type', 'grant_type : authorization_code ou refresh_token.');
}

async function deconnexion(ctx: ModCtx, req: IncomingMessage, res: ServerResponse, url: URL, d: DepsSSO): Promise<void> {
  if (/^Bearer\s+/i.test(s(req.headers.authorization))) {
    const j = lireJeton(ctx, req); if (!j.ok) return erreur(res, j.status, j.code, j.message);
    revoquerSession(ctx, j.session.id); noter(ctx, { login: j.p.login, ip: d.ip, ok: true, why: `SSO ${nomAppli(ctx, j.session.appli)} · déconnexion` });
    return json(res, 200, { ok: true });
  }
  let q = url.searchParams; if (req.method === 'POST') { const b = await lireCorps(req, 8000); if (b.ok) q = new URLSearchParams(b.v); }
  const nav = sessionNavigateur(ctx, req);
  if (nav) ctx.saveSettings({ sessions: ((ctx.settings.sessions as Array<{ id: string }> | undefined) ?? []).filter((x) => x.id !== nav.id) });
  const hint = s(q.get('id_token_hint'));
  let appli = s(q.get('client_id'));
  if (hint) { const v = verifier(hint, cleSignature(ctx).public, { maintenant: 0 }); if (v.ok) { revoquerSession(ctx, s(v.charge.sid)); appli = appli || s(v.charge.aud); } }
  res.setHeader('set-cookie', cookieSso('', 0, d.https));
  const c = appli ? client(ctx, appli) : undefined, post = s(q.get('post_logout_redirect_uri'));
  if (c && post && retourPermis(c, post)) return renvoi(res, post, { state: s(q.get('state')) });
  return pageErreur(res, 200, 'Tu es déconnecté', 'Tu peux fermer cette page.');
}

function revoquer(ctx: ModCtx, jp: string, tok: string, d: DepsSSO): void {
  const m = /^odp1\.([a-f0-9]{10})\.[A-Za-z0-9_-]{43}$/.exec(jp);
  if (m) { const x = sessionsPostes(ctx).find((y) => y.id === m[1]); if (x && egal(sha256hex(jp), x.h)) { revoquerPoste(ctx, x.id); noter(ctx, { login: x.login, ip: d.ip, ok: true, why: `SSO du poste · déconnexion (${x.appareil.nom})` }); } else d.fail(); }
  const r = /^odr1\.([a-f0-9]{10})\.[A-Za-z0-9_-]{43}$/.exec(tok);
  if (r) { const x = sessionsApplis(ctx).find((y) => y.id === r[1]), h = sha256hex(tok); if (x && (egal(h, x.h) || x.anciens.includes(h))) revoquerSession(ctx, x.id); }
}

async function connexion(ctx: ModCtx, res: ServerResponse, v: Record<string, string>, d: DepsSSO, iss: string): Promise<void> {
  const c = client(ctx, v.appli ?? '');
  if (!c || c.id === 'odin') return erreur(res, 404, 'appli_inconnue', `L'appli « ${s(v.appli).slice(0, 40)} » n'est pas déclarée dans Odin (Persona → Applis).`);
  if (!s(v.identifiant) || !v.motdepasse && !s(v.code)) return erreur(res, 400, 'requete_invalide', 'Indique ton identifiant (ou ton e-mail) et ton mot de passe.');
  const app = appareilDe(v.appareil ?? '');
  if (typeof app === 'string') return erreur(res, 400, 'requete_invalide', app);
  const r = await verifierPersonne(ctx, d, s(v.identifiant), v.motdepasse ?? '', s(v.code).replace(/\s/g, ''), `SSO ${c.nom}`);
  if (!r.ok) return erreur(res, r.status, r.code, r.message, r.attente ? { attente: r.attente } : {}, r.attente ? { 'retry-after': String(r.attente) } : {});
  if (!aDroit(ctx, r.p, c.id)) { noter(ctx, { login: r.p.login, ip: d.ip, ok: false, why: `SSO ${c.nom} · pas le droit` }); return erreur(res, 403, 'refuse', messageRefus(ctx, c.id)); }
  noter(ctx, { login: r.p.login, ip: d.ip, ok: true, why: `SSO ${c.nom} · ${r.p.totp ? 'mot de passe + code' : 'mot de passe'} (${app.nom})` });
  json(res, 200, { ok: true, ...emettre(ctx, r.p, c, { iss, appareil: app, via: 'mot de passe' }), personne: personneJson(r.p), appli: c.id, applis: applisDe(ctx, r.p) });
}

function poste(ctx: ModCtx, req: IncomingMessage, res: ServerResponse, v: Record<string, string>): void {
  const j = lireJeton(ctx, req); if (!j.ok) return erreur(res, j.status, j.code, j.message);
  const app = appareilDe(v.appareil ?? ''), user = s(v.utilisateur);
  if (typeof app === 'string' || !app.id) return erreur(res, 400, 'requete_invalide', typeof app === 'string' ? app : 'appareil.id est obligatoire (le même pour tous les programmes du poste).');
  if (!user || user.length > 64 || /[\u0000-\u001f]/.test(user)) return erreur(res, 400, 'requete_invalide', 'utilisateur : le nom de l\'utilisateur du système (1 à 64 caractères).');
  if (j.session.appareil.id && j.session.appareil.id !== app.id) return erreur(res, 400, 'requete_invalide', 'Cet appareil n\'est pas celui de la connexion.');
  const now = Date.now(), id = nouvelId(), secret = b64u(randomBytes(32)), tok = `odp1.${id}.${secret}`;
  sauverPostes(ctx, [...sessionsPostes(ctx), { id, sub: j.p.id, login: j.p.login, appareil: app, utilisateur: user, cree: now, vu: now, fin: now + POSTE_MAX, h: sha256hex(tok) }]);
  sauverSessions(ctx, sessionsApplis(ctx).map((x) => (x.id === j.session.id ? { ...x, poste: id, appareil: x.appareil.id ? x.appareil : app } : x)));
  json(res, 200, { ok: true, jeton_poste: tok, poste: { id, expire: now + POSTE_MAX } });
}

function echange(ctx: ModCtx, res: ServerResponse, v: Record<string, string>, d: DepsSSO, iss: string): void {
  const bad = () => { d.fail(); erreur(res, 401, 'jeton_poste_invalide', 'La connexion de ce poste à Odin n\'est plus valable : reconnecte-toi.'); };
  const tok = v.jeton_poste ?? '', m = /^odp1\.([a-f0-9]{10})\.[A-Za-z0-9_-]{43}$/.exec(tok), app = appareilDe(v.appareil ?? '');
  const x = m ? sessionsPostes(ctx).find((y) => y.id === m[1]) : undefined;
  if (!x || !vivante(x, POSTE_INACTIF) || !egal(sha256hex(tok), x.h)) return bad();
  if (typeof app === 'string' || app.id !== x.appareil.id || s(v.utilisateur) !== x.utilisateur) return bad();
  const p = parSub(ctx, x.sub); if (!p || !p.active) return bad();
  const c = client(ctx, v.appli ?? '');
  if (!c || c.id === 'odin') return erreur(res, 404, 'appli_inconnue', `L'appli « ${s(v.appli).slice(0, 40)} » n'est pas déclarée dans Odin (Persona → Applis).`);
  if (!aDroit(ctx, p, c.id)) { noter(ctx, { login: p.login, ip: d.ip, ok: false, why: `SSO ${c.nom} · échange du poste · pas le droit` }); return erreur(res, 403, 'refuse', messageRefus(ctx, c.id)); }
  sauverPostes(ctx, sessionsPostes(ctx).map((y) => (y.id === x.id ? { ...y, vu: Date.now() } : y)));
  noter(ctx, { login: p.login, ip: d.ip, ok: true, why: `SSO ${c.nom} · échange du poste (${x.appareil.nom})` });
  json(res, 200, { ok: true, ...emettre(ctx, p, c, { iss, appareil: { ...app, nom: app.nom === 'appareil' ? x.appareil.nom : app.nom }, via: 'poste', poste: x.id }), personne: personneJson(p), appli: c.id, applis: applisDe(ctx, p) });
}

/** Odin lui-même comme appli cliente (connexion de son interface par Persona) : le code est consommé sur place. */
export function consommerCode(code: string, redirect: string, verifier: string): string | undefined {
  const h = sha256hex(code), x = codes.get(h);
  if (!x || x.used || x.exp < Date.now() || x.c !== 'odin' || x.redirect !== redirect || b64u(sha256(verifier)) !== x.challenge) return undefined;
  x.used = true; return x.sub;
}
