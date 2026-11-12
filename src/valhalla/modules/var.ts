// Vár — les identités d'Odin : les personnes, leurs groupes, un seul mot de passe (et la double
// authentification) pour entrer sur tous les sites du proxy Valgrind. Portail de connexion à la mascotte
// d'Odin, sessions qu'on peut couper, verrouillage après trop d'essais, journal des connexions, graphe.
// Fonctions reprises (réécrites) d'Authelia, Authentik et Keycloak.
// (Vár : la déesse qui entend les serments et veille sur la parole donnée.)
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import type { GraphDetail, GraphEdge, GraphNode, ModCtx, Module, Param, Tone } from '../types.ts';
import { hashPassword, checkPassword } from '../valgrind/proxy.ts';
import { totp } from './brisingamen.ts';
import { svg as qrSvg } from '../qr.ts';

export interface Person { id: string; login: string; name: string; email?: string; groups: string[]; hash: string; totp?: string; totpPending?: string; active: boolean; created: number; lastLogin?: number; fails: number; lockedUntil?: number }
export interface Rule { domain: string; groups: string[] }
interface Session { id: string; login: string; created: number; expires: number; ip: string; agent: string; seen: number }
interface Entry { t: number; login: string; ip: string; ok: boolean; why: string }

const s = (v: unknown) => (v === undefined || v === null ? '' : String(v)).trim();
let appCtx: ModCtx | undefined; let mascot = '';
/** La mascotte d'Odin (prise sur l'écran de connexion) pour le portail. */
export function setMascot(svg: string): void { mascot = svg; }
/** La mascotte, pour les pages publiques des autres applis (liens de partage…). */
export const mascotSvg = () => mascot;
// Le dernier contexte vu sert au proxy, qui demande à chaque requête qui est connecté.
const people = (ctx: ModCtx): Person[] => { appCtx = ctx; return (ctx.settings.people as Person[] | undefined) ?? []; };
const rules = (ctx: ModCtx): Rule[] => (ctx.settings.rules as Rule[] | undefined) ?? [];
const sessions = (ctx: ModCtx): Session[] => ((ctx.settings.sessions as Session[] | undefined) ?? []).filter((x) => x.expires > Date.now());
const journal = (ctx: ModCtx): Entry[] => (ctx.settings.journal as Entry[] | undefined) ?? [];
const conf = (ctx: ModCtx) => ({ portal: s(ctx.settings.portal), cookieDomain: s(ctx.settings.cookieDomain), hours: Number(ctx.settings.hours ?? 12), rememberDays: Number(ctx.settings.rememberDays ?? 30), require2fa: (ctx.settings.require2fa as string[] | undefined) ?? [] });
const sha = (x: string) => createHash('sha256').update(x).digest('hex');
const savePeople = (ctx: ModCtx, l: Person[]) => ctx.saveSettings({ people: l });
const log = (ctx: ModCtx, e: Entry) => ctx.saveSettings({ journal: [...journal(ctx), e].slice(-500) });
const LOGIN = /^[a-z0-9][a-z0-9._-]{1,31}$/;

/** Le code à 6 chiffres est-il bon (fenêtre de ±30 s) ? */
export function totpOk(secret: string, code: string, at = Date.now()): boolean { const c = code.replace(/\s/g, ''); return /^\d{6}$/.test(c) && [-30_000, 0, 30_000].some((d) => totp(secret, at + d).code === c); }
/** Le nom de domaine du cookie couvre-t-il ce nom ? (pour ne renvoyer qu'à des sites à soi après connexion) */
export const within = (host: string, dom: string) => Boolean(dom) && (host === dom || host.endsWith(`.${dom}`));
/** Qui est connecté avec ce cookie, et a-t-il le droit d'entrer sur ce site ? (appelé par le proxy à chaque requête) */
export function check(cookie: string, domain: string, _ip?: string): { user: string; groups: string[] } | 'refusé' | undefined {
  const ctx = appCtx; if (!ctx) return undefined;
  const tok = /(?:^|;\s*)odin_var=([A-Za-z0-9_-]{20,100})/.exec(cookie)?.[1]; if (!tok) return undefined;
  const ss = sessions(ctx), x = ss.find((y) => y.id === sha(tok)); if (!x) return undefined;
  const p = people(ctx).find((y) => y.login === x.login && y.active); if (!p) return undefined;
  if (Date.now() - x.seen > 60_000) ctx.saveSettings({ sessions: ss.map((y) => (y === x ? { ...y, seen: Date.now() } : y)) });
  const r = rules(ctx).find((y) => y.domain === domain) ?? rules(ctx).find((y) => y.domain.startsWith('*.') && domain.endsWith(y.domain.slice(1)));
  if (r && !r.groups.includes('*') && !r.groups.some((g) => p.groups.includes(g))) return 'refusé';
  return { user: p.login, groups: p.groups };
}
export const portalDomain = () => (appCtx ? conf(appCtx).portal || undefined : undefined);
export const portalUrl = () => { const d = portalDomain(); return d ? `https://${d}` : undefined; };

// ---------------- Le portail ----------------
const esc = (x: string) => x.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
function page(title: string, body: string, nonce: string): string {
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><title>${esc(title)}</title><style>
:root{--bg:#f4f5f7;--panel:#fff;--ink:#1c1f24;--muted:#4b5563;--line:#d1d5db;--accent:#2563eb;--bad:#b91c1c}
@media (prefers-color-scheme:dark){:root{--bg:#16181c;--panel:#23262c;--ink:#f3f4f6;--muted:#c3c7ce;--line:#3f444c;--accent:#3b82f6;--bad:#fca5a5}}
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--ink);font-family:system-ui,-apple-system,"Segoe UI",sans-serif}
main{width:100%;max-width:400px;padding:28px 18px;display:flex;flex-direction:column;gap:12px}.card{background:var(--panel);border:1px solid var(--line);border-radius:20px;padding:24px;display:flex;flex-direction:column;gap:10px}
.m{width:92px;height:92px;margin:0 auto;animation:f 4s ease-in-out infinite}@keyframes f{50%{transform:translateY(-6px)}}@media (prefers-reduced-motion:reduce){.m{animation:none}}.m svg{width:100%;height:100%}.m .orbit{display:none}
h1{margin:0;font-size:22px;text-align:center}p{margin:0;color:var(--muted);line-height:1.5;text-align:center}label{font-size:14px;font-weight:600}
input{width:100%;min-height:48px;border-radius:12px;border:1px solid var(--line);background:var(--bg);color:var(--ink);padding:0 14px;font-size:16px}
button{min-height:50px;border-radius:12px;border:0;background:var(--accent);color:#fff;font-size:16px;font-weight:600;cursor:pointer;width:100%}.ghost{background:transparent;color:var(--ink);border:1px solid var(--line)}
.err{color:var(--bad);font-size:14px;text-align:center}ul{margin:0;padding:0;list-style:none}li a{display:block;padding:12px 14px;border:1px solid var(--line);border-radius:12px;color:var(--ink);text-decoration:none;margin:0 0 8px}
</style></head><body><main><div class="m" aria-hidden="true">${mascot}</div>${body}</main><script nonce="${nonce}">for(const f of document.querySelectorAll('form'))f.addEventListener('submit',()=>{for(const b of f.querySelectorAll('button'))b.disabled=true;});</script></body></html>`;
}
const tries = new Map<string, number[]>();
async function readForm(q: IncomingMessage): Promise<Record<string, string>> { let raw = ''; for await (const c of q) { raw += c; if (raw.length > 8000) break; } return Object.fromEntries(new URLSearchParams(raw)); }
/** Ce que répond le portail : connexion, code de double authentification, déconnexion, page « connecté ». */
export async function portal(q: IncomingMessage, r: ServerResponse, secure: boolean): Promise<void> {
  const ctx = appCtx, nonce = randomBytes(16).toString('base64'), url = new URL(q.url ?? '/', 'http://x'), ip = (q.socket.remoteAddress ?? '').replace(/^::ffff:/, '');
  // Après la connexion, le navigateur suit la redirection vers le site demandé : « form-action » doit l'autoriser (les sites du domaine commun).
  const dom0 = ctx ? conf(ctx).cookieDomain : '', formTo = dom0 ? ` https://${dom0}:* https://*.${dom0}:*` : '';
  const headers = { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-frame-options': 'DENY', 'x-content-type-options': 'nosniff', // « same-origin » : le navigateur envoie l'origine du formulaire (avec « no-referrer » il envoie « null »).
    'referrer-policy': 'same-origin', 'content-security-policy': `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; form-action 'self'${formTo}; frame-ancestors 'none'; base-uri 'none'` };
  if (!ctx) { r.writeHead(503, headers); return void r.end(page('Indisponible', '<div class="card"><h1>Connexion indisponible</h1></div>', nonce)); }
  const c = conf(ctx), rd = s(url.searchParams.get('rd'));
  const safeRd = (() => { try { const u = new URL(rd); return /^https?:$/.test(u.protocol) && within(u.hostname, c.cookieDomain) ? u.toString() : ''; } catch { return ''; } })();
  const cookie = (v: string, maxAge: number) => `odin_var=${v}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${c.cookieDomain ? `; Domain=${c.cookieDomain}` : ''}${secure ? '; Secure' : ''}`;
  const form = (err = '', step: 'mdp' | 'code' = 'mdp', login = '') => page('Connexion · Odin', `<div class="card"><h1>${step === 'code' ? 'Code de vérification' : 'Connexion'}</h1><p>${step === 'code' ? 'Tape le code à 6 chiffres de ton appli d\'authentification.' : 'Un seul compte pour tous les sites d\'Odin.'}</p>
<form method="post" action="/connexion${safeRd ? `?rd=${encodeURIComponent(safeRd)}` : ''}">
${step === 'mdp' ? `<label for="l">Identifiant</label><input id="l" name="login" autocomplete="username" autocapitalize="none" spellcheck="false" required value="${esc(login)}" autofocus>
<label for="p">Mot de passe</label><input id="p" name="password" type="password" autocomplete="current-password" required>` : `<input type="hidden" name="login" value="${esc(login)}"><input type="hidden" name="password" value="">
<label for="c">Code</label><input id="c" name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9 ]{6,7}" maxlength="7" required autofocus>`}
${err ? `<p class="err" role="alert">${esc(err)}</p>` : ''}<button type="submit">${step === 'code' ? 'Vérifier' : 'Se connecter'}</button></form></div>`, nonce);
  // Déjà connecté ?
  const tok = /(?:^|;\s*)odin_var=([A-Za-z0-9_-]{20,100})/.exec(String(q.headers.cookie ?? ''))?.[1], cur = tok ? sessions(ctx).find((x) => x.id === sha(tok)) : undefined;
  if (q.method === 'POST' && url.pathname === '/deconnexion') {
    if (cur) ctx.saveSettings({ sessions: sessions(ctx).filter((x) => x !== cur) });
    r.writeHead(303, { location: '/', 'set-cookie': cookie('', 0), 'cache-control': 'no-store' }); return void r.end();
  }
  if (q.method === 'POST' && url.pathname === '/connexion') {
    const origin = String(q.headers.origin ?? ''); if (origin && !origin.endsWith(`//${String(q.headers.host ?? '')}`)) { r.writeHead(403, headers); return void r.end(page('Refusé', '<div class="card"><h1>Refusé</h1><p>Formulaire envoyé depuis un autre site.</p></div>', nonce)); }
    const f = await readForm(q), login = s(f.login).toLowerCase(), now = Date.now();
    const t = [...(tries.get(ip) ?? []).filter((x) => now - x < 600_000)]; if (t.length >= 20) { r.writeHead(429, headers); return void r.end(form('Trop d\'essais depuis cette adresse : réessaie dans 10 minutes.', 'mdp', login)); }
    const all = people(ctx), p = all.find((x) => x.login === login);
    const fail = (why: string, msg = 'Identifiant ou mot de passe incorrect.') => {
      tries.set(ip, [...t, now]); log(ctx, { t: now, login: login.slice(0, 32), ip, ok: false, why });
      if (p) { const n = p.fails + 1, lock = n >= 5 ? now + 15 * 60_000 : p.lockedUntil; savePeople(ctx, people(ctx).map((x) => (x.id === p.id ? { ...x, fails: n, lockedUntil: lock } : x)));
        if (n === 5) { ctx.alert({ level: 'haute', title: `Compte « ${p.login} » verrouillé 15 minutes`, detail: `5 mauvais essais, le dernier depuis ${ip}. Si ce n'est pas cette personne, quelqu'un essaie de deviner son mot de passe.`, key: `var-verrou-${p.id}-${Math.floor(now / 900_000)}` }); ctx.emit('verrouillage', { login: p.login, ip }); void ctx.call('garmr', 'bannir', { ip, raison: `5 mauvais mots de passe sur le compte ${p.login} (Vár)`, minutes: 60 }, 'trop d\'essais de mot de passe').catch(() => undefined); } }
      ctx.emit('connexion_refusee', { login: login.slice(0, 32), ip, essais: t.length + 1 });
      r.writeHead(401, headers); r.end(form(msg, 'mdp', login));
    };
    if (!p || !p.active) return fail('compte inconnu ou coupé');
    if (p.lockedUntil && p.lockedUntil > now) { r.writeHead(423, headers); return void r.end(form(`Compte verrouillé après trop d'essais : réessaie après ${new Date(p.lockedUntil).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}.`, 'mdp', login)); }
    // Étape du code : le mot de passe a été vérifié juste avant (jeton court, en mémoire).
    if (s(f.code)) {
      const st = [...pending.entries()].find(([, v]) => v.login === login && v.ip === ip && v.exp > now);
      if (!st || !p.totp) return fail('code sans mot de passe');
      if (!totpOk(p.totp, s(f.code))) { pending.delete(st[0]); return fail('mauvais code', 'Code incorrect : recommence depuis le mot de passe.'); }
      pending.delete(st[0]);
    } else {
      if (!checkPassword(s(f.password), p.hash)) return fail('mauvais mot de passe');
      const needs = p.totp || c.require2fa.some((g) => p.groups.includes(g));
      if (needs && !p.totp) { log(ctx, { t: now, login, ip, ok: false, why: 'double authentification à configurer' }); r.writeHead(403, headers); return void r.end(page('Double authentification', '<div class="card"><h1>Double authentification obligatoire</h1><p>Ton groupe demande un code en plus du mot de passe. Demande à l\'administrateur d\'Odin de l\'activer pour toi (Vár → Double authentification).</p></div>', nonce)); }
      if (p.totp) { pending.set(randomBytes(12).toString('hex'), { login, ip, exp: now + 5 * 60_000 }); r.writeHead(200, headers); return void r.end(form('', 'code', login)); }
    }
    const token = randomBytes(32).toString('base64url'), hours = c.hours;
    ctx.saveSettings({ sessions: [...sessions(ctx), { id: sha(token), login, created: now, expires: now + hours * 3600_000, ip, agent: String(q.headers['user-agent'] ?? '').slice(0, 120), seen: now }].slice(-200) });
    savePeople(ctx, people(ctx).map((x) => (x.id === p.id ? { ...x, fails: 0, lockedUntil: undefined, lastLogin: now } : x)));
    tries.delete(ip); log(ctx, { t: now, login, ip, ok: true, why: p.totp ? 'mot de passe + code' : 'mot de passe' });
    // Nouvelle adresse pour cette personne : on prévient (sans bloquer).
    if (!journal(ctx).some((e) => e.ok && e.login === login && e.ip === ip && e.t < now)) ctx.emit('nouvelle_adresse', { login, ip });
    r.writeHead(303, { location: safeRd || '/', 'set-cookie': cookie(token, hours * 3600), 'cache-control': 'no-store' }); return void r.end();
  }
  if (cur) {
    const p = people(ctx).find((x) => x.login === cur.login), mine = rules(ctx).filter((x) => !x.domain.startsWith('*.') && (x.groups.includes('*') || x.groups.some((g) => p?.groups.includes(g))));
    r.writeHead(200, headers); return void r.end(page('Connecté · Odin', `<div class="card"><h1>Bonjour ${esc(p?.name ?? cur.login)}</h1><p>Tu es connecté jusqu'à ${new Date(cur.expires).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}.</p>${mine.length ? `<ul>${mine.map((m) => `<li><a href="https://${esc(m.domain)}">${esc(m.domain)}</a></li>`).join('')}</ul>` : ''}<form method="post" action="/deconnexion"><button class="ghost" type="submit">Se déconnecter</button></form></div>`, nonce));
  }
  r.writeHead(200, headers); r.end(form());
}
const pending = new Map<string, { login: string; ip: string; exp: number }>();

// ---------------- Le graphe ----------------
export function idGraph(ps: Person[], rs: Rule[], ss: Session[], now = Date.now()): { nodes: GraphNode[]; edges: GraphEdge[]; details: Record<string, GraphDetail> } {
  const nodes: GraphNode[] = [{ id: 'odin', label: 'Odin · Vár', sub: `${ps.length} personne(s)`, square: true, size: 18, color: '#4F9DDE', hub: true }], edges: GraphEdge[] = [], details: Record<string, GraphDetail> = {};
  const groups = [...new Set(ps.flatMap((p) => p.groups))];
  details.odin = { kind: 'Vár', title: 'Les identités', subtitle: `${ps.length} personne(s) · ${groups.length} groupe(s) · ${ss.length} session(s) ouverte(s)`, rows: [{ k: 'Sites protégés', v: rs.map((r) => r.domain).join(', ') || 'aucun' }, { k: 'Double authentification', v: `${ps.filter((p) => p.totp).length} / ${ps.length} personne(s)` }] };
  for (const g of groups) { nodes.push({ id: `g:${g}`, label: g, sub: 'groupe', square: true, size: 11, color: '#7FB3E6', hub: true }); edges.push({ a: 'odin', b: `g:${g}`, w: 2, color: '#7FB3E6' }); details[`g:${g}`] = { kind: 'Groupe', title: g, rows: [{ k: 'Personnes', v: ps.filter((p) => p.groups.includes(g)).map((p) => p.name).join(', ') }, { k: 'Sites', v: rs.filter((r) => r.groups.includes(g) || r.groups.includes('*')).map((r) => r.domain).join(', ') || '—' }] }; }
  for (const r of rs) { const id = `s:${r.domain}`; nodes.push({ id, label: r.domain, sub: r.groups.includes('*') ? 'tout le monde (connecté)' : r.groups.join(', '), size: 7, color: '#F0A040' }); for (const g of r.groups.includes('*') ? groups : r.groups) if (groups.includes(g)) edges.push({ a: `g:${g}`, b: id, dash: true, color: '#F0A040' }); details[id] = { kind: 'Site protégé', title: r.domain, rows: [{ k: 'Autorisés', v: r.groups.includes('*') ? 'toute personne connectée' : r.groups.join(', ') }], actions: [{ action: 'proteger_site', label: 'Changer les groupes', input: { domaine: r.domain, groupes: r.groups.join(', ') } }] }; }
  for (const p of ps) {
    const id = `p:${p.login}`, mine = ss.filter((x) => x.login === p.login), locked = Boolean(p.lockedUntil && p.lockedUntil > now);
    nodes.push({ id, label: p.name, sub: p.login, size: 9, color: !p.active ? '#7d8791' : mine.length ? '#57C98A' : '#E8EAEC', off: !p.active, ring: locked ? '#EE6A55' : p.totp ? '#B48CF0' : undefined, search: `${p.login} ${p.email ?? ''} ${p.groups.join(' ')}` });
    if (!p.groups.length) edges.push({ a: id, b: 'odin' }); for (const g of p.groups) edges.push({ a: id, b: `g:${g}` });
    details[id] = {
      kind: 'Personne', title: p.name, subtitle: `${p.login}${p.email ? ` · ${p.email}` : ''}`,
      chips: [{ label: p.active ? 'Active' : 'Coupée', tone: p.active ? 'bon' : 'neutre' }, { label: p.totp ? 'Double authentification' : 'Mot de passe seul', tone: (p.totp ? 'bon' : 'attention') as Tone }, ...(locked ? [{ label: 'Verrouillée', tone: 'mauvais' as Tone }] : []), ...(mine.length ? [{ label: `${mine.length} session(s)`, tone: 'bon' as Tone }] : [])],
      rows: [{ k: 'Groupes', v: p.groups.join(', ') || '—' }, { k: 'Dernière connexion', v: p.lastLogin ? new Date(p.lastLogin).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : 'jamais' }, { k: 'Créée le', v: new Date(p.created).toLocaleDateString('fr-FR') }],
      list: { title: 'Sessions ouvertes', items: mine.map((x) => ({ text: `${x.ip} · ${x.agent.slice(0, 50) || 'navigateur'}`, meta: `jusqu'à ${new Date(x.expires).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}` })) },
      actions: [{ action: 'double_auth', label: p.totp ? 'Refaire la double authentification' : 'Activer la double authentification', input: { login: p.login }, primary: !p.totp }, { action: 'couper_sessions', label: 'Couper ses sessions', input: { login: p.login } }, { action: 'mot_de_passe', label: 'Nouveau mot de passe', input: { login: p.login, mot_de_passe: '' } }],
    };
  }
  return { nodes, edges, details };
}

const byLogin = (ctx: ModCtx, l: unknown): Person => { const p = people(ctx).find((x) => x.login === s(l).toLowerCase()); if (!p) throw new Error(`personne « ${s(l)} » inconnue`); return p; };
const groupsOf = (v: unknown) => [...new Set(s(v).toLowerCase().split(/[\s,;]+/).filter(Boolean))].map((g) => { if (!/^[\w-]{1,30}$/.test(g) && g !== '*') throw new Error(`groupe invalide : ${g}`); return g; });
async function vault(ctx: ModCtx, p: { login: string; name: string }, pass: string): Promise<boolean> {
  const r = await ctx.call('brisingamen', 'ajouter', { nom: `Compte Odin · ${p.name}`, identifiant: p.login, mot_de_passe: pass, site: portalUrl() ?? '', coffre: 'Personnel' }, `ranger le mot de passe de ${p.name}`).catch(() => ({ ok: false }));
  return r.ok !== false;
}
const ADD: Param[] = [{ key: 'login', label: 'Identifiant (ex. awa)', kind: 'text', required: true }, { key: 'nom', label: 'Nom affiché', kind: 'text', required: true }, { key: 'groupes', label: 'Groupes (ex. famille, admins)', kind: 'text', default: 'famille' }, { key: 'email', label: 'E-mail (facultatif, reste sur Odin)', kind: 'text', default: '' }, { key: 'mot_de_passe', label: 'Mot de passe (vide : Odin en choisit un, rangé dans le coffre)', kind: 'password', default: '' }];

export const varModule: Module = {
  id: 'var', name: 'Vár', family: 'Accès',
  what: 'Les identités : les personnes et leurs groupes, un seul compte (et la double authentification) pour entrer sur tous les sites du proxy, avec sessions, verrouillage et journal.',
  does: ['personnes, groupes, comptes coupés ou réactivés', 'portail de connexion à la mascotte d\'Odin : une connexion pour tous les sites du proxy Valgrind (connexion unique)', 'double authentification par code (appli Google Authenticator, Aegis…), obligatoire par groupe', 'sites réservés à des groupes ; l\'identité est transmise au service (Remote-User, Remote-Groups)', 'sessions ouvertes visibles et coupables, durée réglable', 'verrouillage après 5 essais, adresse bannie par Garmr, alerte, journal des connexions', 'mots de passe choisis par Odin rangés dans le coffre', 'graphe : personnes, groupes, sites, sessions'],
  from: ['Authelia', 'Authentik', 'Keycloak'], upstream: ['authelia/authelia', 'goauthentik/authentik', 'keycloak/keycloak'],
  words: ['identité', 'identités', 'connexion unique', 'sso', 'comptes', 'utilisateurs', 'double authentification', '2fa', 'groupes', 'portail de connexion'],
  actions: [
    { id: 'ajouter', label: 'Ajouter une personne', what: 'Un compte pour entrer sur les sites d\'Odin', params: ADD, run: async (ctx, i) => {
      const login = s(i.login).toLowerCase(), name = s(i.nom).slice(0, 60); if (!LOGIN.test(login)) throw new Error('identifiant : 2 à 32 lettres minuscules, chiffres, . _ -'); if (!name) throw new Error('nom affiché ?');
      if (people(ctx).some((p) => p.login === login)) throw new Error('cet identifiant existe déjà');
      if (s(i.email) && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s(i.email))) throw new Error('adresse e-mail invalide');
      const pass = s(i.mot_de_passe) || randomBytes(12).toString('base64url'); if (pass.length < 10) throw new Error('mot de passe : 10 caractères au moins');
      const p: Person = { id: randomBytes(5).toString('hex'), login, name, ...(s(i.email) ? { email: s(i.email) } : {}), groups: groupsOf(i.groupes || 'famille'), hash: hashPassword(pass), active: true, created: Date.now(), fails: 0 };
      savePeople(ctx, [...people(ctx), p]);
      const inVault = await vault(ctx, p, pass);
      return { text: `👤 ${name} (« ${login} », groupes ${p.groups.join(', ')}) ajouté. ${inVault ? 'Son mot de passe est dans le coffre Brísingamen.' : s(i.mot_de_passe) ? '' : '⚠ Le coffre n\'a pas pu garder le mot de passe : choisis-en un toi-même.'}` };
    }, undo: (i) => ({ action: 'retirer', input: { login: i.login }, label: 'Retirer la personne' }) },
    { id: 'modifier', label: 'Modifier une personne', what: 'Nom, groupes, compte actif', quick: false, params: [{ key: 'login', label: 'Identifiant', kind: 'text', required: true }, { key: 'nom', label: 'Nom affiché', kind: 'text', default: '' }, { key: 'groupes', label: 'Groupes (vide : inchangés)', kind: 'text', default: '' }, { key: 'actif', label: 'Compte', kind: 'select', options: ['inchangé', 'actif', 'coupé'], default: 'inchangé' }], run: (ctx, i) => {
      const p = { ...byLogin(ctx, i.login) }; if (s(i.nom)) p.name = s(i.nom).slice(0, 60); if (s(i.groupes)) p.groups = groupsOf(i.groupes); if (s(i.actif) === 'actif') p.active = true; if (s(i.actif) === 'coupé') p.active = false;
      savePeople(ctx, people(ctx).map((x) => (x.id === p.id ? p : x))); if (!p.active) ctx.saveSettings({ sessions: sessions(ctx).filter((x) => x.login !== p.login) });
      return { text: `✏️ ${p.name} : groupes ${p.groups.join(', ') || '—'}, compte ${p.active ? 'actif' : 'coupé (sessions fermées)'}.` };
    } },
    { id: 'retirer', label: 'Retirer une personne', what: 'Son compte et ses sessions disparaissent', quick: false, params: [{ key: 'login', label: 'Identifiant', kind: 'text', required: true }], grave: () => 'supprimer ce compte (ses sessions sont fermées tout de suite)', run: (ctx, i) => { const p = byLogin(ctx, i.login); savePeople(ctx, people(ctx).filter((x) => x.id !== p.id)); ctx.saveSettings({ sessions: sessions(ctx).filter((x) => x.login !== p.login) }); return { text: `🗑 ${p.name} retiré.` }; } },
    { id: 'mot_de_passe', label: 'Nouveau mot de passe', what: 'Remplace le mot de passe (rangé dans le coffre) et ferme les sessions', quick: false, params: [{ key: 'login', label: 'Identifiant', kind: 'text', required: true }, { key: 'mot_de_passe', label: 'Mot de passe (vide : Odin en choisit un)', kind: 'password', default: '' }], run: async (ctx, i) => {
      const p = byLogin(ctx, i.login), pass = s(i.mot_de_passe) || randomBytes(12).toString('base64url'); if (pass.length < 10) throw new Error('10 caractères au moins');
      savePeople(ctx, people(ctx).map((x) => (x.id === p.id ? { ...x, hash: hashPassword(pass), fails: 0, lockedUntil: undefined } : x))); ctx.saveSettings({ sessions: sessions(ctx).filter((x) => x.login !== p.login) });
      const v = await vault(ctx, p, pass); return { text: `🔑 Nouveau mot de passe pour ${p.name}${v ? ' (dans le coffre)' : ''} ; ses sessions sont fermées.` };
    } },
    { id: 'double_auth', label: 'Double authentification', what: 'Un QR code à scanner avec une appli d\'authentification, puis un code pour confirmer', quick: false, params: [{ key: 'login', label: 'Identifiant', kind: 'text', required: true }], run: (ctx, i) => {
      const p = byLogin(ctx, i.login), a = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'; let sec = ''; for (const b of randomBytes(20)) sec += a[b % 32];
      savePeople(ctx, people(ctx).map((x) => (x.id === p.id ? { ...x, totpPending: sec } : x)));
      const uri = `otpauth://totp/${encodeURIComponent(`Odin:${p.login}`)}?secret=${sec}&issuer=Odin&digits=6&period=30`;
      return { text: `📱 Scanne le QR code avec l'appli d'authentification de ${p.name}, puis « Confirmer la double authentification » avec le code affiché.`, data: { svg: qrSvg(uri, { scale: 5, margin: 3 }), alt: 'QR code de double authentification', conf: sec.replace(/(.{4})/g, '$1 ').trim(), label: 'Clé à taper à la main (secrète)', filename: `double-auth-${p.login}.txt` } };
    } },
    { id: 'confirmer_double_auth', label: 'Confirmer la double authentification', what: 'Le code à 6 chiffres de l\'appli', params: [{ key: 'login', label: 'Identifiant', kind: 'text', required: true }, { key: 'code', label: 'Code', kind: 'text', required: true }], run: (ctx, i) => {
      const p = byLogin(ctx, i.login); if (!p.totpPending) throw new Error('commence par « Double authentification » (QR code)');
      if (!totpOk(p.totpPending, s(i.code))) throw new Error('code incorrect : vérifie l\'heure du téléphone et réessaie');
      savePeople(ctx, people(ctx).map((x) => (x.id === p.id ? { ...x, totp: p.totpPending, totpPending: undefined } : x)));
      return { text: `✅ Double authentification active pour ${p.name} : un code sera demandé à chaque connexion.` };
    } },
    { id: 'couper_sessions', label: 'Couper les sessions', what: 'La personne devra se reconnecter partout', quick: false, words: ['couper les sessions', 'déconnecter partout', 'fermer les sessions'], params: [{ key: 'login', label: 'Identifiant (vide : tout le monde)', kind: 'text', default: '' }], run: (ctx, i) => { const l = s(i.login).toLowerCase(), before = sessions(ctx).length, left = sessions(ctx).filter((x) => l && x.login !== l); ctx.saveSettings({ sessions: left }); return { text: `✂ ${before - left.length} session(s) fermée(s).` }; } },
    { id: 'proteger_site', label: 'Réserver un site', what: 'Un site du proxy demande la connexion d\'Odin, pour certains groupes', params: [{ key: 'domaine', label: 'Site (nom du proxy)', kind: 'text', required: true }, { key: 'groupes', label: 'Groupes autorisés (« * » : toute personne connectée)', kind: 'text', default: '*' }], run: async (ctx, i) => {
      const d = s(i.domaine).toLowerCase(), gs = groupsOf(i.groupes || '*');
      if (!conf(ctx).portal) throw new Error('règle d\'abord le portail (Réglages : son nom, ex. connexion.exemple.fr)');
      const r = await ctx.call('valgrind', 'connexion_unique', { domaine: d, actif: true }, `réserver ${d} aux personnes connectées`);
      if (r.ok === false) throw new Error(r.text);
      ctx.saveSettings({ rules: [...rules(ctx).filter((x) => x.domain !== d), { domain: d, groups: gs }] });
      return { text: `🛡 ${d} demande maintenant la connexion d'Odin (${gs.includes('*') ? 'toute personne connectée' : `groupes ${gs.join(', ')}`}).` };
    } },
    { id: 'liberer_site', label: 'Libérer un site', what: 'Plus besoin de se connecter', quick: false, params: [{ key: 'domaine', label: 'Site', kind: 'text', required: true }], run: async (ctx, i) => { const d = s(i.domaine).toLowerCase(); await ctx.call('valgrind', 'connexion_unique', { domaine: d, actif: false }).catch(() => undefined); ctx.saveSettings({ rules: rules(ctx).filter((x) => x.domain !== d) }); return { text: `🔓 ${d} ne demande plus de connexion.` }; } },
    { id: 'reglages', label: 'Réglages', what: 'Le nom du portail, le domaine, la durée des sessions, la double authentification obligatoire', quick: false, params: [{ key: 'portail', label: 'Nom du portail (ex. connexion.exemple.fr)', kind: 'text', required: true }, { key: 'domaine', label: 'Domaine commun (ex. exemple.fr)', kind: 'text', required: true }, { key: 'heures', label: 'Durée d\'une session (heures)', kind: 'number', default: 12 }, { key: 'double_auth', label: 'Double authentification obligatoire pour les groupes', kind: 'text', default: 'admins' }], run: async (ctx, i) => {
      const portal = s(i.portail).toLowerCase(), dom = s(i.domaine).toLowerCase().replace(/^\./, ''), h = Number(i.heures) || 12;
      if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(portal)) throw new Error('nom du portail invalide'); if (!within(portal, dom)) throw new Error(`le portail doit être dans le domaine commun (${portal} n'est pas dans ${dom})`);
      if (h < 1 || h > 24 * 30) throw new Error('durée entre 1 heure et 30 jours');
      ctx.saveSettings({ portal, cookieDomain: dom, hours: h, require2fa: s(i.double_auth) ? groupsOf(i.double_auth) : [] });
      const r = await ctx.call('valgrind', 'portail', { domaine: portal }, 'servir le portail de connexion').catch((e) => ({ ok: false, text: (e as Error).message }));
      // Avec un tunnel Cloudflare (Brú), le portail est aussi publié sur Internet.
      const pub = await ctx.call('bru', 'publier', { domaine: portal }, 'publier le portail de connexion sur Internet').catch(() => ({ ok: false, text: '' }));
      return { text: `⚙️ Portail ${portal} (sessions de ${h} h, valables sur *.${dom})${r.ok !== false ? ' servi par le proxy.' : ` — ⚠ le proxy n'a pas pu le servir : ${r.text}`}${pub.ok !== false && pub.text ? `\n${pub.text}` : ''}` };
    } },
    { id: 'personnes', label: 'Personnes et groupes', what: 'Qui a un compte et dans quels groupes (sans aucun mot de passe)', read: true, quiet: true, run: (ctx) => {
      const l = people(ctx).map((p) => ({ login: p.login, name: p.name, groups: p.groups, active: p.active }));
      return { text: l.length ? l.map((p) => `- ${p.name} (${p.login}) : ${p.groups.join(', ')}${p.active ? '' : ' · coupé'}`).join('\n') : 'Personne pour l\'instant.', data: { people: l } };
    } },
    { id: 'journal', label: 'Journal des connexions', what: 'Qui s\'est connecté, d\'où, et les échecs', read: true, run: (ctx) => ({ text: journal(ctx).slice(-40).reverse().map((e) => `${new Date(e.t).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })} ${e.ok ? '✅' : '❌'} ${e.login} depuis ${e.ip} (${e.why})`).join('\n') || 'Rien.' }) },
  ],
  view(ctx) {
    appCtx = ctx;
    const ps = people(ctx), ss = sessions(ctx), rs = rules(ctx), c = conf(ctx), now = Date.now(), j = journal(ctx), fails = j.filter((e) => !e.ok && now - e.t < 86400_000).length;
    return {
      subtitle: c.portal ? `Portail ${c.portal} · ${ps.length} personne(s) · ${ss.length} session(s)` : 'À régler : le nom du portail de connexion (Réglages).',
      kpis: [{ label: 'Personnes', value: String(ps.length) }, { label: 'Sessions ouvertes', value: String(ss.length), tone: 'bon' }, { label: 'Double authentification', value: `${ps.filter((p) => p.totp).length} / ${ps.length}`, tone: ps.some((p) => !p.totp) ? 'attention' : 'bon' }, { label: 'Échecs (24 h)', value: String(fails), tone: fails > 10 ? 'mauvais' : fails ? 'attention' : 'bon' }],
      sections: [
        ...(c.portal && ps.length && rs.length ? [] : [{ kind: 'steps' as const, title: 'Mettre en route', items: [{ title: 'Régler le portail', detail: 'Son nom (ex. connexion.exemple.fr, qui pointe vers ta box comme tes sites) et le domaine commun (exemple.fr).', done: Boolean(c.portal) }, { title: 'Ajouter les personnes', detail: 'Un identifiant et des groupes (famille, admins…) pour chacune.', done: ps.length > 0 }, { title: 'Réserver un site', detail: 'Un site du proxy demande alors la connexion d\'Odin.', done: rs.length > 0 }] }]),
        { kind: 'graph', title: 'Graphe des identités', ...idGraph(ps, rs, ss, now), empty: 'Personne pour l\'instant : ajoute une personne à droite.', legend: [['#4F9DDE', 'Odin, groupes'], ['#57C98A', 'connecté en ce moment'], ['#E8EAEC', 'personne'], ['#B48CF0', 'double authentification'], ['#F0A040', 'site réservé'], ['#EE6A55', 'verrouillé']] },
        { kind: 'table', title: 'Personnes', columns: ['Nom', 'Identifiant', 'Groupes', 'Double auth.', 'Dernière connexion'], empty: 'Personne.', rows: ps.map((p) => ({ cells: [p.name, p.login, p.groups.join(', ') || '—', p.totp ? 'oui' : 'non', p.lastLogin ? new Date(p.lastLogin).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : 'jamais'], tone: !p.active ? 'neutre' as const : p.lockedUntil && p.lockedUntil > now ? 'mauvais' as const : undefined, actions: [{ action: 'double_auth', label: 'Double auth.', input: { login: p.login } }] })) },
        { kind: 'log', title: 'Journal des connexions', lines: j.slice(-25).reverse().map((e) => `${new Date(e.t).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })} ${e.ok ? '✅' : '❌'} ${e.login} depuis ${e.ip} (${e.why})`) },
        { kind: 'list', title: 'Liens avec les prochaines applis', items: [{ title: 'Sól (photos)', detail: 'les albums visibles selon les groupes' }, { title: 'Snotra (bureau)', detail: 'le bureau à distance réservé aux admins, avec code' }] },
      ],
      side: [{ kind: 'form', title: 'Ajouter une personne', action: 'ajouter', submit: 'Ajouter', params: ADD }, { kind: 'form', title: 'Réserver un site', action: 'proteger_site', submit: 'Réserver', params: varModule.actions.find((a) => a.id === 'proteger_site')!.params! }, { kind: 'form', title: 'Réglages du portail', action: 'reglages', submit: 'Enregistrer', params: varModule.actions.find((a) => a.id === 'reglages')!.params! }],
    };
  },
  start(ctx) { appCtx = ctx; },
  stop() { appCtx = undefined; },
  watch: { every: 300, run(ctx) {
    appCtx = ctx; const all = (ctx.settings.sessions as Session[] | undefined) ?? [];
    if (all.some((x) => x.expires <= Date.now())) ctx.saveSettings({ sessions: sessions(ctx) });
    for (const [k, v] of pending) if (v.exp < Date.now()) pending.delete(k);
  } },
};
export const attach = (ctx: ModCtx) => { appCtx = ctx; };
