// Ce que chaque personne de Persona fait elle-même, sur Odin, sans le propriétaire :
//   - /sso/compte : « Mon compte » (connexion, clés d'accès : en ajouter, en retirer ; se déconnecter) ;
//   - /sso/cle/*  : se connecter avec une clé d'accès sur le portail de la connexion unique ;
//   - /sso/invitation?j=… : une invitation par lien (envoyée par e-mail, ou donnée à la main) : la personne choisit son
//     identifiant et son mot de passe ; elle entre dans les groupes prévus (code de double authentification réglé sur
//     place si son groupe l'exige) ;
//   - /sso/oubli : mot de passe oublié → un lien par e-mail (30 minutes, une seule fois), puis un nouveau mot de passe
//     (et le code de double authentification si elle l'a). Toutes ses connexions sont alors coupées.
// Les jetons des liens ne sont gardés que par leur empreinte SHA-256. Les messages ne disent jamais si un compte existe.

import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomBytes } from 'node:crypto';
import { networkInterfaces } from 'node:os';
import type { Action, ModCtx, Param } from '../types.ts';
import { hashPassword } from '../valgrind/proxy.ts';
import { totp } from '../modules/brisingamen.ts';
import { svg as qrSvg } from '../qr.ts';
import { adresseOdin, courrier, personaPage } from './registre.ts';
import { b64u, sha256hex } from './jwt.ts';
import { lierProprietaire, noter, parSub, persona, personnes, prenomProprio, revoquerPersonne, trouver, type Personne } from './etat.ts';
import { erreur, issuerDe, json, ouvrirNavigateur, sessionNavigateur, verifierPersonne, demandeValide, type DepsSSO } from './oidc.ts';
import { WEBAUTHN_JS, nouveauDefi, optionsConnexion, optionsInscription, siteWebauthn, verifierConnexion, verifierInscription, type CleAcces } from './cles-acces.ts';
import { groupeExiste, nomGroupe } from './groupes.ts';

const s = (v: unknown) => (v === undefined || v === null ? '' : String(v)).trim();
const esc = (x: string) => x.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const LOGIN = /^[a-z0-9][a-z0-9._-]{1,31}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const quand = (t: number) => new Date(t).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });

// ---------------- Données (réglages de Persona, fichier déjà bloqué pour les outils de fichiers)
export interface Invitation { id: string; h: string; nom: string; groupes: string[]; email?: string; cree: number; exp: number; etat: 'envoyée' | 'code' | 'utilisée' | 'annulée'; login?: string }
interface Reinit { h: string; sub: string; exp: number }
export const clesAcces = (ctx: ModCtx): CleAcces[] => (ctx.settings.clesAcces as CleAcces[] | undefined) ?? [];
const sauverCles = (ctx: ModCtx, l: CleAcces[]) => ctx.saveSettings({ clesAcces: l.slice(-500) });
export const invitations = (ctx: ModCtx): Invitation[] => (ctx.settings.invitations as Invitation[] | undefined) ?? [];
const sauverInvitations = (ctx: ModCtx, l: Invitation[]) => { const now = Date.now(); ctx.saveSettings({ invitations: l.filter((x) => x.exp > now - 30 * 86_400_000).slice(-200) }); };
const reinits = (ctx: ModCtx): Reinit[] => ((ctx.settings.reinit as Reinit[] | undefined) ?? []).filter((x) => x.exp > Date.now());

// ---------------- L'adresse d'Odin dans les liens envoyés
const lanIp = () => Object.values(networkInterfaces()).flat().find((i) => i && i.family === 'IPv4' && !i.internal)?.address ?? '127.0.0.1';
const estIp = (h: string) => /^\d{1,3}(\.\d{1,3}){3}$/.test(h) || h.includes(':');
/** L'adresse d'Odin pour un lien (réglée dans Persona, sinon celle par laquelle on l'a joint si elle est sûre, sinon son adresse sur le réseau). */
export function baseLiens(ctx: ModCtx, req?: IncomingMessage, https = false): string {
  const fixe = s(ctx.settings.adresseLiens).replace(/\/+$/, ''); if (fixe) return fixe;
  if (req) {
    // L'en-tête Host vient du visiteur : on ne s'en sert que s'il désigne une adresse IP, la machine, ou le domaine de Persona.
    const iss = issuerDe(req, https), h = new URL(iss).hostname.replace(/^\[|\]$/g, ''), dom = s(ctx.settings.cookieDomain);
    if (estIp(h) || h === 'localhost' || (dom && (h === dom || h.endsWith(`.${dom}`)))) return iss;
  }
  const w = adresseOdin(); return `${w.tls ? 'https' : 'http'}://${lanIp()}:${w.port}`;
}

// ---------------- Pages
function page(res: ServerResponse, status: number, titre: string, corps: string, script = ''): void {
  const nonce = randomBytes(16).toString('base64');
  res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-frame-options': 'DENY', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer',
    'content-security-policy': `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; img-src data:; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'` });
  res.end(personaPage(titre, `${corps}${script ? `<script nonce="${nonce}">${script}</script>` : ''}`, nonce));
}
const carte = (titre: string, texte: string, plus = '') => `<div class="card"><h1>${esc(titre)}</h1>${texte ? `<p>${esc(texte)}</p>` : ''}${plus}</div>`;
const err = (m: string) => (m ? `<p class="err" role="alert">${esc(m)}</p>` : '');
async function lireForm(req: IncomingMessage, max = 8000): Promise<Record<string, string>> {
  let raw = ''; for await (const c of req) { raw += c; if (raw.length > max) break; }
  if (/application\/json/i.test(s(req.headers['content-type']))) { try { const j = JSON.parse(raw || '{}') as Record<string, unknown>; return Object.fromEntries(Object.entries(j).map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v)])); } catch { return {}; } }
  return Object.fromEntries(new URLSearchParams(raw));
}
/** Un formulaire envoyé depuis un autre site est refusé. */
const memeSite = (req: IncomingMessage, iss: string) => { const o = s(req.headers.origin); return !o || o === 'null' || o === iss; };
const totpOk = (secret: string, code: string, at = Date.now()) => { const c = code.replace(/\s/g, ''); return /^\d{6}$/.test(c) && [-30_000, 0, 30_000].some((d) => totp(secret, at + d).code === c); };
const secretTotp = () => { const a = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'; let x = ''; for (const b of randomBytes(20)) x += a[b % 32]; return x; };

// ---------------- Défis des clés d'accès (en mémoire, 2 minutes, une seule fois)
const defis = new Map<string, { defi: string; exp: number; sub?: string; nom?: string }>();
function garderDefi(cle: string, x: { sub?: string; nom?: string } = {}): string { const now = Date.now(); for (const [k, v] of defis) if (v.exp < now) defis.delete(k); const defi = nouveauDefi(); defis.set(cle, { defi, exp: now + 120_000, ...x }); return defi; }
function prendreDefi(cle: string): { defi: string; sub?: string; nom?: string } | undefined { const d = defis.get(cle); defis.delete(cle); return d && d.exp > Date.now() ? d : undefined; }

/** La personne connectée sur ce navigateur (session Persona du portail, ou session du propriétaire). */
function quiEst(ctx: ModCtx, req: IncomingMessage, d: DepsSSO): { p: Personne; nav?: string } | undefined {
  const nav = sessionNavigateur(ctx, req); if (nav) return { p: nav.p, nav: nav.id };
  if (d.proprietaireConnecte()) { const p = lierProprietaire(ctx); if (p) return { p }; }
  return undefined;
}

/** Les routes de ce fichier ; rend true si la requête est servie ici. */
export async function routeComptes(req: IncomingMessage, res: ServerResponse, url: URL, d: DepsSSO): Promise<boolean> {
  const p0 = url.pathname;
  if (!/^\/sso\/(compte(\/.*)?|cle\/(debut|fin)|invitation|oubli(\/nouveau)?)$/.test(p0)) return false;
  const ctx = persona(); if (!ctx) { erreur(res, 503, 'indisponible', 'La connexion unique d\'Odin ne tourne pas (applis arrêtées) : réessaie dans un moment.'); return true; }
  const iss = issuerDe(req, d.https), m = req.method ?? 'GET';
  if (m === 'POST' && !memeSite(req, iss)) { erreur(res, 403, 'refuse', 'Formulaire envoyé depuis un autre site.'); return true; }
  if (p0 === '/sso/cle/debut' || p0 === '/sso/cle/fin') { await connexionParCle(ctx, req, res, d, iss, p0.endsWith('debut')); return true; }
  if (p0.startsWith('/sso/compte')) { await compte(ctx, req, res, url, d, iss); return true; }
  if (p0 === '/sso/invitation') { await invitation(ctx, req, res, url, d); return true; }
  await oubli(ctx, req, res, url, d, iss); return true;
}

// ---------------- Connexion par clé d'accès (portail de la connexion unique)
async function connexionParCle(ctx: ModCtx, req: IncomingMessage, res: ServerResponse, d: DepsSSO, iss: string, debut: boolean): Promise<void> {
  if (m(req) !== 'POST' || !/application\/json/i.test(s(req.headers['content-type']))) return erreur(res, 415, 'json_attendu', 'Envoie du JSON.');
  const b = await lireForm(req, 20_000), dem = s(b.demande);
  let site: { origine: string; rpId: string }; try { site = siteWebauthn(iss); } catch (e) { return erreur(res, 400, 'requete_invalide', (e as Error).message); }
  if (!demandeValide(dem)) return erreur(res, 400, 'requete_invalide', 'La page de connexion a expiré : recommence depuis l\'appli.');
  if (debut) return json(res, 200, { ok: true, options: optionsConnexion({ rpId: site.rpId, defi: garderDefi(`connexion:${dem}`) }) });
  const df = prendreDefi(`connexion:${dem}`); if (!df) return erreur(res, 400, 'requete_invalide', 'Défi expiré : recommence.');
  let cle: CleAcces;
  try { cle = verifierConnexion({ id: b.id, clientDataJSON: b.clientDataJSON, authenticatorData: b.authenticatorData, signature: b.signature, userHandle: b.userHandle }, clesAcces(ctx), { defi: df.defi, origine: site.origine, rpId: site.rpId }); }
  catch (e) { d.fail(); noter(ctx, { login: '?', ip: d.ip, ok: false, why: `clé d'accès refusée · ${(e as Error).message}` }); return erreur(res, 401, 'identifiants', (e as Error).message); }
  const p = parSub(ctx, cle.sub);
  if (!p || !p.active) { d.fail(); return erreur(res, 401, 'identifiants', 'Ce compte ne peut plus se connecter.'); }
  if (p.lockedUntil && p.lockedUntil > Date.now()) return erreur(res, 423, 'verrouille', `Compte verrouillé après trop d'essais : réessaie dans ${Math.ceil((p.lockedUntil - Date.now()) / 60_000)} minute(s).`);
  sauverCles(ctx, clesAcces(ctx).map((x) => (x.id === cle.id ? cle : x)));
  ctx.saveSettings({ people: personnes(ctx).map((x) => (x.id === p.id ? { ...x, fails: 0, lastLogin: Date.now() } : x)) });
  ouvrirNavigateur(ctx, req, res, p, d); noter(ctx, { login: p.login, ip: d.ip, ok: true, why: `clé d'accès (${cle.nom})` });
  return json(res, 200, { ok: true });
}
const m = (req: IncomingMessage) => req.method ?? 'GET';

// ---------------- Mon compte
async function compte(ctx: ModCtx, req: IncomingMessage, res: ServerResponse, url: URL, d: DepsSSO, iss: string): Promise<void> {
  const p0 = url.pathname, moi = quiEst(ctx, req, d);
  if (p0 === '/sso/compte' && m(req) === 'POST') {
    const f = await lireForm(req), r = await verifierPersonne(ctx, d, s(f.identifiant), f.motdepasse ?? '', s(f.code).replace(/\s/g, ''), 'Mon compte');
    if (!r.ok) return pageConnexion(res, r.code === 'code_requis' ? '' : r.message, r.code === 'code_requis' ? s(f.identifiant) : '', r.code === 'code_requis', r.code === 'code_requis' ? 200 : r.status);
    ouvrirNavigateur(ctx, req, res, r.p, d); res.writeHead(303, { location: '/sso/compte', 'cache-control': 'no-store' }); return void res.end();
  }
  if (p0 === '/sso/compte' && m(req) === 'GET') {
    if (!moi) return pageConnexion(res);
    const mes = clesAcces(ctx).filter((c) => c.sub === moi.p.id);
    let note = ''; try { siteWebauthn(iss); } catch (e) { note = (e as Error).message; }
    return page(res, 200, 'Mon compte · Odin', carte(`Bonjour ${moi.p.name}`, `Identifiant « ${moi.p.login} » · groupes : ${moi.p.groups.join(', ') || 'aucun'}.`,
      `<h2 style="font-size:17px;margin:8px 0 0">Clés d'accès</h2><p>Une clé d'accès remplace le mot de passe et le code : ton téléphone ou ton ordinateur te reconnaît (empreinte, visage ou code de l'appareil).</p>
${mes.length ? `<ul>${mes.map((c) => `<li><form method="post" action="/sso/compte/cle/retirer" style="display:flex;gap:8px;align-items:center"><input type="hidden" name="id" value="${esc(c.id)}"><span style="flex:1">${esc(c.nom)} · ${esc(quand(c.cree))}${c.vu ? ` · servie le ${esc(quand(c.vu))}` : ''}</span><button class="ghost" type="submit" style="width:auto;padding:0 14px">Retirer</button></form></li>`).join('')}</ul>` : '<p>Aucune clé pour l\'instant.</p>'}
${note ? `<p class="err">${esc(note)}</p>` : `<label for="n">Nom de la clé</label><input id="n" value="${esc('Mon appareil')}" maxlength="60"><button type="button" id="ajouter">Ajouter une clé d'accès</button><p class="err" id="msg" role="alert"></p>`}
<form method="post" action="/sso/compte/deconnexion"><button class="ghost" type="submit">Se déconnecter</button></form>`),
    note ? '' : `${WEBAUTHN_JS}const b=document.getElementById('ajouter');b.onclick=async()=>{const m=document.getElementById('msg');m.textContent='';b.disabled=true;try{if(!window.PublicKeyCredential)throw new Error('Ce navigateur ne sait pas créer de clé d’accès.');await odinCleCreer('/sso/compte/cle/debut','/sso/compte/cle/fin',{nom:document.getElementById('n').value});location.reload();}catch(e){m.textContent=e.name==='NotAllowedError'?'Annulé.':e.message;}b.disabled=false;};`);
  }
  if (!moi) { if (/application\/json/i.test(s(req.headers['content-type']))) return erreur(res, 401, 'jeton_requis', 'Connecte-toi d\'abord.'); res.writeHead(303, { location: '/sso/compte' }); return void res.end(); }
  if (p0 === '/sso/compte/deconnexion' && m(req) === 'POST') {
    if (moi.nav) ctx.saveSettings({ sessions: ((ctx.settings.sessions as Array<{ id: string }> | undefined) ?? []).filter((x) => x.id !== moi.nav) });
    res.writeHead(303, { location: '/sso/compte', 'set-cookie': `odin_var=; Path=/sso; HttpOnly; SameSite=Lax; Max-Age=0${d.https ? '; Secure' : ''}`, 'cache-control': 'no-store' }); return void res.end();
  }
  if (p0 === '/sso/compte/cle/retirer' && m(req) === 'POST') {
    const f = await lireForm(req), id = s(f.id), l = clesAcces(ctx);
    if (l.some((c) => c.id === id && c.sub === moi.p.id)) { sauverCles(ctx, l.filter((c) => c.id !== id)); noter(ctx, { login: moi.p.login, ip: d.ip, ok: true, why: 'clé d\'accès retirée' }); }
    res.writeHead(303, { location: '/sso/compte', 'cache-control': 'no-store' }); return void res.end();
  }
  if ((p0 === '/sso/compte/cle/debut' || p0 === '/sso/compte/cle/fin') && m(req) === 'POST') {
    if (!/application\/json/i.test(s(req.headers['content-type']))) return erreur(res, 415, 'json_attendu', 'Envoie du JSON.');
    let site: { origine: string; rpId: string }; try { site = siteWebauthn(iss); } catch (e) { return erreur(res, 400, 'requete_invalide', (e as Error).message); }
    const f = await lireForm(req, 30_000), cle = `inscription:${moi.p.id}`;
    if (p0.endsWith('debut')) {
      const deja = clesAcces(ctx).filter((c) => c.sub === moi.p.id && c.rp === site.rpId).map((c) => c.id);
      if (deja.length >= 10) return erreur(res, 400, 'requete_invalide', '10 clés d\'accès au plus : retires-en une.');
      return json(res, 200, { ok: true, options: optionsInscription({ rpId: site.rpId, defi: garderDefi(cle, { sub: moi.p.id, nom: s(f.nom) }), sub: moi.p.id, login: moi.p.login, nom: moi.p.name, deja }) });
    }
    const df = prendreDefi(cle); if (!df || df.sub !== moi.p.id) return erreur(res, 400, 'requete_invalide', 'Défi expiré : recommence.');
    try {
      const c = verifierInscription({ clientDataJSON: f.clientDataJSON, attestationObject: f.attestationObject }, { defi: df.defi, origine: site.origine, rpId: site.rpId, sub: moi.p.id, nom: s(f.nom) || df.nom || 'clé d\'accès' });
      if (clesAcces(ctx).some((x) => x.id === c.id)) return erreur(res, 400, 'requete_invalide', 'Cette clé est déjà inscrite.');
      sauverCles(ctx, [...clesAcces(ctx), c]); noter(ctx, { login: moi.p.login, ip: d.ip, ok: true, why: `clé d'accès ajoutée (${c.nom})` });
      ctx.emit('cle_acces_ajoutee', { login: moi.p.login, nom: c.nom });
      return json(res, 200, { ok: true, cle: { id: c.id, nom: c.nom } });
    } catch (e) { return erreur(res, 400, 'requete_invalide', (e as Error).message); }
  }
  erreur(res, 404, 'introuvable', 'Page inconnue.');
}
function pageConnexion(res: ServerResponse, msg = '', ident = '', code = false, status = 200): void {
  page(res, status, 'Mon compte · Odin', carte(code ? 'Code de vérification' : 'Mon compte', code ? 'Tape le code à 6 chiffres de ton appli d\'authentification.' : 'Connecte-toi avec ton compte Odin.', `<form method="post" action="/sso/compte">
${code ? `<input type="hidden" name="identifiant" value="${esc(ident)}"><label for="c">Code</label><input id="c" name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9 ]{6,7}" maxlength="7" required autofocus>`
    : `<label for="l">Identifiant ou e-mail</label><input id="l" name="identifiant" autocomplete="username" autocapitalize="none" spellcheck="false" required autofocus><label for="p">Mot de passe</label><input id="p" name="motdepasse" type="password" autocomplete="current-password" required>`}
${err(msg)}<button type="submit">${code ? 'Vérifier' : 'Se connecter'}</button></form><p><a href="/sso/oubli" style="color:inherit">Mot de passe oublié ?</a></p>`));
}

// ---------------- Invitation par lien
const deJeton = (l: Invitation[], j: string) => { const h = sha256hex(j); return /^[A-Za-z0-9_-]{43}$/.test(j) ? l.find((x) => x.h === h) : undefined; };
async function invitation(ctx: ModCtx, req: IncomingMessage, res: ServerResponse, url: URL, d: DepsSSO): Promise<void> {
  const f = m(req) === 'POST' ? await lireForm(req) : {}, j = s(f.j || url.searchParams.get('j')), all = invitations(ctx), inv = deJeton(all, j), now = Date.now();
  if (!inv || inv.exp < now || inv.etat === 'utilisée' || inv.etat === 'annulée') { if (j) d.fail(); return page(res, 410, 'Invitation · Odin', carte('Invitation plus valable', 'Ce lien a déjà servi, a été annulé ou a expiré. Demande une nouvelle invitation.')); }
  const exige = ((ctx.settings.require2fa as string[] | undefined) ?? []).some((g) => inv.groupes.includes(g));
  const formCode = (p: Personne, msg = '') => { const uri = `otpauth://totp/${encodeURIComponent(`Odin:${p.login}`)}?secret=${p.totpPending}&issuer=Odin&digits=6&period=30`;
    return page(res, msg ? 401 : 200, 'Invitation · Odin', carte('Double authentification', 'Ton groupe demande un code en plus du mot de passe. Scanne ce QR code avec une appli d\'authentification (Aegis, Google Authenticator…), puis tape le code affiché.',
      `<div style="background:#fff;border-radius:12px;padding:8px;margin:0 auto">${qrSvg(uri, { scale: 4, margin: 2 })}</div><p style="font-family:monospace">${esc(String(p.totpPending).replace(/(.{4})/g, '$1 ').trim())}</p><form method="post" action="/sso/invitation"><input type="hidden" name="j" value="${esc(j)}"><label for="c">Code</label><input id="c" name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="7" required autofocus>${err(msg)}<button type="submit">Vérifier</button></form>`)); };
  const fini = (p: Personne) => {
    sauverInvitations(ctx, invitations(ctx).map((x) => (x.id === inv.id ? { ...x, etat: 'utilisée' as const, login: p.login } : x)));
    ouvrirNavigateur(ctx, req, res, p, d); noter(ctx, { login: p.login, ip: d.ip, ok: true, why: 'compte créé par invitation' });
    ctx.alert({ level: 'info', title: `${p.name} a accepté l'invitation`, detail: `Compte « ${p.login} », groupes ${p.groups.join(', ') || '—'}.`, key: `var-invitation-${inv.id}` }); ctx.emit('invitation_acceptee', { login: p.login });
    return page(res, 200, 'Bienvenue · Odin', carte(`Bienvenue ${p.name}`, `Ton compte « ${p.login} » est prêt : il sert pour toutes les applis d'Odin auxquelles tu as droit.`, '<p><a href="/sso/compte" style="color:inherit">Ajouter une clé d\'accès (plus besoin de mot de passe)</a></p><p><a href="/sso/odin" style="color:inherit">Ouvrir Odin</a></p>'));
  };
  // Étape du code (le compte existe déjà, le code doit confirmer la double authentification).
  if (inv.etat === 'code') {
    const p = personnes(ctx).find((x) => x.login === inv.login); if (!p || !p.totpPending) return page(res, 410, 'Invitation · Odin', carte('Invitation plus valable', 'Demande une nouvelle invitation.'));
    if (m(req) !== 'POST') return formCode(p);
    if (!totpOk(p.totpPending, s(f.code))) { d.fail(); return formCode(p, 'Code incorrect : vérifie l\'heure du téléphone et réessaie.'); }
    const ok = { ...p, totp: p.totpPending, totpPending: undefined }; ctx.saveSettings({ people: personnes(ctx).map((x) => (x.id === p.id ? ok : x)) });
    return fini(ok);
  }
  const formulaire = (msg = '', v: Record<string, string> = {}) => page(res, msg ? 400 : 200, 'Invitation · Odin', carte(`Bonjour ${inv.nom}`, `${prenomProprio(ctx)} t'invite à utiliser Odin. Choisis ton identifiant et ton mot de passe (valable jusqu'au ${quand(inv.exp)}).`,
    `<form method="post" action="/sso/invitation"><input type="hidden" name="j" value="${esc(j)}">
<label for="l">Identifiant</label><input id="l" name="login" autocomplete="username" autocapitalize="none" spellcheck="false" required pattern="[a-z0-9][a-z0-9._\\-]{1,31}" value="${esc(v.login ?? inv.nom.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '.').replace(/^\.+|\.+$/g, '').slice(0, 32))}">
${inv.email ? '' : `<label for="e">E-mail (facultatif : pour retrouver ton mot de passe)</label><input id="e" name="email" type="email" autocomplete="email" value="${esc(v.email ?? '')}">`}
<label for="p">Mot de passe (10 caractères au moins)</label><input id="p" name="motdepasse" type="password" autocomplete="new-password" minlength="10" required>
<label for="p2">Encore une fois</label><input id="p2" name="motdepasse2" type="password" autocomplete="new-password" minlength="10" required>
${err(msg)}<button type="submit">Créer mon compte</button></form>`));
  if (m(req) !== 'POST') return formulaire();
  const login = s(f.login).toLowerCase(), mdp = f.motdepasse ?? '', email = inv.email ?? s(f.email);
  if (!LOGIN.test(login)) return formulaire('Identifiant : 2 à 32 lettres minuscules, chiffres, . _ -', f);
  if (personnes(ctx).some((p) => p.login === login)) return formulaire('Cet identifiant est déjà pris : choisis-en un autre.', f);
  if (mdp.length < 10) return formulaire('Le mot de passe doit faire 10 caractères au moins.', f);
  if (mdp !== (f.motdepasse2 ?? '')) return formulaire('Les deux mots de passe sont différents.', f);
  if (email && (!EMAIL.test(email) || personnes(ctx).some((p) => (p.email ?? '').toLowerCase() === email.toLowerCase()))) return formulaire('Adresse e-mail invalide ou déjà utilisée.', f);
  const p: Personne = { id: randomBytes(5).toString('hex'), login, name: inv.nom, ...(email ? { email } : {}), groups: inv.groupes.filter((g) => g !== 'admin'), hash: hashPassword(mdp), active: true, created: now, fails: 0, ...(exige ? { totpPending: secretTotp() } : {}) };
  ctx.saveSettings({ people: [...personnes(ctx), p] });
  if (exige) { sauverInvitations(ctx, invitations(ctx).map((x) => (x.id === inv.id ? { ...x, etat: 'code' as const, login } : x))); return formCode(p); }
  return fini(p);
}

// ---------------- Mot de passe oublié
const demandesOubli = new Map<string, number[]>();
async function oubli(ctx: ModCtx, req: IncomingMessage, res: ServerResponse, url: URL, d: DepsSSO, iss: string): Promise<void> {
  void iss;
  if (url.pathname === '/sso/oubli') {
    const form = (msg = '') => page(res, 200, 'Mot de passe oublié · Odin', carte('Mot de passe oublié', 'Donne ton identifiant ou ton adresse e-mail : si ton compte a une adresse e-mail, Odin t\'envoie un lien pour choisir un nouveau mot de passe.',
      `<form method="post" action="/sso/oubli"><label for="l">Identifiant ou e-mail</label><input id="l" name="identifiant" autocomplete="username" autocapitalize="none" spellcheck="false" required autofocus>${msg ? `<p>${esc(msg)}</p>` : ''}<button type="submit">Recevoir le lien</button></form>`));
    if (m(req) !== 'POST') return form();
    const f = await lireForm(req), now = Date.now(), t = (demandesOubli.get(d.ip) ?? []).filter((x) => now - x < 3600_000);
    const reponse = 'Si ce compte existe et a une adresse e-mail, un message vient de partir (lien valable 30 minutes). Pense à regarder dans les indésirables.';
    if (t.length >= 5) { d.fail(); return form('Trop de demandes depuis cette adresse : réessaie dans une heure.'); }
    demandesOubli.set(d.ip, [...t, now]);
    const p = trouver(ctx, s(f.identifiant).slice(0, 120));
    if (!p || !p.active || !p.email || p.proprio) { noter(ctx, { login: (p?.login ?? s(f.identifiant)).slice(0, 32), ip: d.ip, ok: false, why: `mot de passe oublié · ${!p ? 'compte inconnu' : p.proprio ? 'compte du propriétaire (son mot de passe est celui d\'Odin)' : 'pas d\'adresse e-mail ou compte coupé'}` }); return form(reponse); }
    const deja = reinits(ctx).filter((x) => x.sub === p.id);
    if (deja.length >= 3) return form(reponse);
    const j = b64u(randomBytes(32)), lien = `${baseLiens(ctx, req, d.https)}/sso/oubli/nouveau?j=${j}`;
    ctx.saveSettings({ reinit: [...reinits(ctx), { h: sha256hex(j), sub: p.id, exp: now + 30 * 60_000 }].slice(-100) });
    try { await courrier()(p.email, 'Odin : choisir un nouveau mot de passe', `Bonjour ${p.name},\n\nQuelqu'un (sans doute toi) a demandé un nouveau mot de passe pour ton compte Odin « ${p.login} ».\nOuvre ce lien dans les 30 minutes pour le choisir :\n\n${lien}\n\nSi tu n'as rien demandé, ignore ce message : ton mot de passe ne change pas.\n\n— Odin`); noter(ctx, { login: p.login, ip: d.ip, ok: true, why: 'mot de passe oublié · lien envoyé par e-mail' }); }
    catch (e) { noter(ctx, { login: p.login, ip: d.ip, ok: false, why: `mot de passe oublié · e-mail non parti (${(e as Error).message.slice(0, 60)})` }); ctx.alert({ level: 'moyenne', title: 'Un e-mail de Persona n\'a pas pu partir', detail: `Lien de nouveau mot de passe pour ${p.login} : ${(e as Error).message}. Vérifie Réglages → Mail.`, key: 'var-courrier' }); }
    return form(reponse);
  }
  // /sso/oubli/nouveau
  const f = m(req) === 'POST' ? await lireForm(req) : {}, j = s(f.j || url.searchParams.get('j')), h = sha256hex(j), r = /^[A-Za-z0-9_-]{43}$/.test(j) ? reinits(ctx).find((x) => x.h === h) : undefined, p = r ? parSub(ctx, r.sub) : undefined;
  if (!r || !p || !p.active) { if (j) d.fail(); return page(res, 410, 'Nouveau mot de passe · Odin', carte('Lien plus valable', 'Ce lien a déjà servi ou il a expiré (30 minutes). Recommence depuis « Mot de passe oublié ».', '<p><a href="/sso/oubli" style="color:inherit">Mot de passe oublié</a></p>')); }
  const form = (msg = '') => page(res, msg ? 400 : 200, 'Nouveau mot de passe · Odin', carte('Nouveau mot de passe', `Pour ton compte « ${p.login} ».`, `<form method="post" action="/sso/oubli/nouveau"><input type="hidden" name="j" value="${esc(j)}">
<label for="p">Nouveau mot de passe (10 caractères au moins)</label><input id="p" name="motdepasse" type="password" autocomplete="new-password" minlength="10" required autofocus>
<label for="p2">Encore une fois</label><input id="p2" name="motdepasse2" type="password" autocomplete="new-password" minlength="10" required>
${p.totp ? '<label for="c">Code de ton appli d\'authentification</label><input id="c" name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="7" required>' : ''}
${err(msg)}<button type="submit">Changer le mot de passe</button></form>`));
  if (m(req) !== 'POST') return form();
  const mdp = f.motdepasse ?? '';
  if (mdp.length < 10) return form('Le mot de passe doit faire 10 caractères au moins.');
  if (mdp !== (f.motdepasse2 ?? '')) return form('Les deux mots de passe sont différents.');
  if (p.totp && !totpOk(p.totp, s(f.code))) { d.fail(); noter(ctx, { login: p.login, ip: d.ip, ok: false, why: 'nouveau mot de passe · mauvais code' }); return form('Code incorrect.'); }
  ctx.saveSettings({ reinit: reinits(ctx).filter((x) => x.sub !== p.id), people: personnes(ctx).map((x) => (x.id === p.id ? { ...x, hash: hashPassword(mdp), fails: 0, lockedUntil: undefined } : x)),
    sessions: ((ctx.settings.sessions as Array<{ login: string }> | undefined) ?? []).filter((x) => x.login !== p.login) });
  const n = revoquerPersonne(ctx, p.login, 'nouveau mot de passe');
  noter(ctx, { login: p.login, ip: d.ip, ok: true, why: `nouveau mot de passe par le lien e-mail (${n} connexion(s) coupée(s))` });
  ctx.alert({ level: 'info', title: `${p.name} a changé son mot de passe`, detail: `Par le lien « mot de passe oublié » envoyé à son e-mail, depuis ${d.ip}. Ses connexions ouvertes ont été coupées.`, key: `var-reinit-${p.id}-${Math.floor(Date.now() / 60_000)}` });
  return page(res, 200, 'Nouveau mot de passe · Odin', carte('Mot de passe changé', 'Tes anciennes connexions sont coupées : reconnecte-toi avec le nouveau mot de passe.', '<p><a href="/sso/compte" style="color:inherit">Mon compte</a></p>'));
}

// ---------------- Actions de Persona (invitations, adresse des liens, clés d'accès)
const P_INV: Param[] = [{ key: 'nom', label: 'Nom de la personne', kind: 'text', required: true }, { key: 'groupes', label: 'Groupes (ex. famille)', kind: 'text', default: 'famille' }, { key: 'email', label: 'E-mail (vide : tu donnes le lien toi-même)', kind: 'text', default: '' }, { key: 'jours', label: 'Valable (jours)', kind: 'number', default: 7 }];
export const comptesActions: Action[] = [
  { id: 'inviter', label: 'Inviter par lien', what: 'Un lien pour que la personne crée elle-même son compte (identifiant, mot de passe), dans les groupes choisis ; envoyé par e-mail si tu donnes son adresse', params: P_INV, words: ['invite', 'inviter', 'invitation', 'envoie une invitation'], run: async (ctx, i) => {
    const nom = s(i.nom).slice(0, 60); if (!nom) throw new Error('le nom de la personne ?');
    const gs = [...new Set(s(i.groupes || 'famille').toLowerCase().split(/[\s,;]+/).filter(Boolean).map(nomGroupe))];
    if (gs.includes('admin')) throw new Error('on n\'invite pas dans le groupe admin : ajoute la personne, puis mets-la dans le groupe à la main');
    for (const g of gs) if (!groupeExiste(ctx, g) && !['famille', 'invite'].includes(g)) throw new Error(`le groupe « ${g} » n'existe pas (crée-le d'abord)`);
    const email = s(i.email); if (email && !EMAIL.test(email)) throw new Error('adresse e-mail invalide');
    const jours = Math.min(30, Math.max(1, Number(i.jours) || 7)), j = b64u(randomBytes(32)), now = ctx.now().getTime();
    const inv: Invitation = { id: randomBytes(5).toString('hex'), h: sha256hex(j), nom, groupes: gs, ...(email ? { email } : {}), cree: now, exp: now + jours * 86_400_000, etat: 'envoyée' };
    sauverInvitations(ctx, [...invitations(ctx), inv]);
    const lien = `${baseLiens(ctx)}/sso/invitation?j=${j}`;
    let parti = '';
    if (email) { try { await courrier()(email, `${prenomProprio(ctx)} t'invite sur Odin`, `Bonjour ${nom},\n\n${prenomProprio(ctx)} t'invite à utiliser Odin (groupes : ${gs.join(', ')}).\nOuvre ce lien pour choisir ton identifiant et ton mot de passe (valable ${jours} jour(s)) :\n\n${lien}\n\nSi tu n'attendais pas ce message, ignore-le.\n\n— Odin`); parti = ` Envoyée à ${email}.`; } catch (e) { parti = ` ⚠ L'e-mail n'a pas pu partir (${(e as Error).message}) : donne le lien toi-même.`; } }
    return { text: `✉ Invitation pour ${nom} (groupes ${gs.join(', ')}, valable ${jours} jour(s)).${parti}\nLien (à usage unique) : ${lien}`, data: { svg: qrSvg(lien, { scale: 4, margin: 2 }), alt: 'QR code de l\'invitation', lien, id: inv.id } };
  } },
  { id: 'annuler_invitation', label: 'Annuler une invitation', what: 'Le lien ne marche plus', quick: false, params: [{ key: 'id', label: 'Invitation', kind: 'text', required: true }], run: (ctx, i) => {
    const x = invitations(ctx).find((y) => y.id === s(i.id)); if (!x) throw new Error('invitation inconnue');
    sauverInvitations(ctx, invitations(ctx).map((y) => (y.id === x.id ? { ...y, etat: 'annulée' as const } : y)));
    return { text: `🚫 Invitation de ${x.nom} annulée.` };
  } },
  { id: 'adresse_liens', label: 'Adresse d\'Odin dans les liens', what: 'L\'adresse mise dans les liens envoyés par e-mail (invitations, mot de passe oublié)', quick: false, params: [{ key: 'adresse', label: 'Adresse (ex. https://odin.exemple.fr ; vide : celle du réseau local)', kind: 'text', default: '' }], run: (ctx, i) => {
    const a = s(i.adresse).replace(/\/+$/, ''); if (a && !/^https?:\/\/[a-z0-9.[\]:-]+$/i.test(a)) throw new Error('adresse invalide (ex. https://odin.exemple.fr)');
    ctx.saveSettings({ adresseLiens: a }); return { text: a ? `🔗 Les liens envoyés commencent par ${a}.` : `🔗 Les liens envoyés utilisent l'adresse d'Odin sur le réseau local (${baseLiens(ctx)}).` };
  } },
  { id: 'retirer_cle', label: 'Retirer une clé d\'accès', what: 'Cette clé ne permet plus d\'entrer', quick: false, params: [{ key: 'id', label: 'Clé', kind: 'text', required: true }], run: (ctx, i) => {
    const l = clesAcces(ctx), c = l.find((x) => x.id === s(i.id)); if (!c) throw new Error('clé inconnue');
    sauverCles(ctx, l.filter((x) => x.id !== c.id)); return { text: `🔑 Clé « ${c.nom} » retirée.` };
  } },
];

/** Les sections de la page Persona : invitations et clés d'accès. */
export function comptesSections(ctx: ModCtx): Array<import('../types.ts').Section> {
  const now = Date.now(), inv = invitations(ctx).filter((x) => x.exp > now - 7 * 86_400_000).reverse(), ps = personnes(ctx), cles = clesAcces(ctx);
  return [
    { kind: 'form', onglet: 'Personnes', title: 'Inviter par lien', action: 'inviter', submit: 'Créer l\'invitation', params: P_INV, aide: 'La personne choisit elle-même son identifiant et son mot de passe. Avec une adresse e-mail, Odin lui envoie le lien.' },
    { kind: 'table', onglet: 'Personnes', title: 'Invitations', columns: ['Pour', 'Groupes', 'E-mail', 'Jusqu\'au', 'État'], empty: 'Aucune invitation.',
      rows: inv.map((x) => ({ cells: [x.nom, x.groupes.join(', '), x.email ?? '—', quand(x.exp), x.etat === 'utilisée' ? `acceptée (${x.login})` : x.exp < now ? 'expirée' : x.etat === 'code' ? 'code attendu' : x.etat], tone: x.etat === 'utilisée' ? 'bon' as const : undefined, actions: x.etat === 'envoyée' && x.exp > now ? [{ action: 'annuler_invitation', label: 'Annuler', input: { id: x.id } }] : [] })) },
    { kind: 'table', onglet: 'Personnes', title: 'Clés d\'accès', columns: ['Personne', 'Clé', 'Site', 'Ajoutée', 'Servie'], empty: 'Aucune clé d\'accès : chacun en ajoute depuis « Mon compte » (/sso/compte).',
      rows: cles.map((c) => ({ cells: [ps.find((p) => p.id === c.sub)?.name ?? '?', c.nom, c.rp, quand(c.cree), c.vu ? quand(c.vu) : 'jamais'], actions: [{ action: 'retirer_cle', label: 'Retirer', input: { id: c.id } }] })) },
  ];
}
