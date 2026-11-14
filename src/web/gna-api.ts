// Ulysse côté membre : la page /trajets et son API /api/trajets/*.
// Un membre de la famille y entre avec ses identifiants OwnTracks (ceux que Hestia lui a donnés) : il voit SES trajets,
// règle SON historique (allumer, pause, éteindre, conservation, effacer), nomme ses lieux, exporte en GPX, et choisit
// si le propriétaire d'Odin peut voir ses trajets. Il ne peut rien lire ni changer pour un autre membre : toute demande
// est faite en son nom, quel que soit le membre écrit dans la demande.
// La session du membre tient dans un cookie (12 heures, jamais lisible par un script, jamais envoyé depuis un autre
// site) ; un mauvais mot de passe compte dans la limite d'essais d'Odin, comme pour OwnTracks.
import { createHash, randomBytes } from 'node:crypto';
import { createReadStream, statSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { retrouver } from '../valhalla/gna/historique.ts';
import { memberOf } from '../valhalla/modules/gladsheim.ts';
import { demande, gravite, type Qui } from '../valhalla/modules/gna.ts';
import { valhallaOf } from '../valhalla/odin.ts';

export interface TrajetsDeps { /** un mauvais mot de passe : compté dans la limite d'essais */ fail: () => void; /** la page est servie en HTTPS (le cookie le demande alors) */ https: boolean }
const s = (v: unknown) => String(v ?? '');
const COOKIE = 'odin_trajets', DUREE = 12 * 3600_000;
const sessions = new Map<string, { id: string; exp: number }>();
const empreinte = (jeton: string) => createHash('sha256').update(jeton).digest('hex');
const cookie = (jeton: string, https: boolean, age = DUREE / 1000) => `${COOKIE}=${jeton}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${age}${https ? '; Secure' : ''}`;
const json = (res: ServerResponse, code: number, b: unknown, h: Record<string, string | string[]> = {}) => { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...h }); res.end(JSON.stringify(b)); };
async function corps(req: IncomingMessage): Promise<Record<string, unknown>> {
  const parts: Buffer[] = []; let n = 0;
  for await (const c of req) { n += (c as Buffer).length; if (n > 16_384) throw new Error('trop long'); parts.push(c as Buffer); }
  try { const j = JSON.parse(Buffer.concat(parts).toString('utf8') || '{}') as unknown; return j && typeof j === 'object' && !Array.isArray(j) ? j as Record<string, unknown> : {}; } catch { return {}; }
}
/** Ce qu'un membre peut demander depuis sa page (toujours pour lui-même). */
const PERMIS = new Set(['etat', 'trajets', 'lieux', 'allumer', 'pause', 'eteindre', 'conservation', 'partage', 'effacer', 'nommer_lieu', 'retirer_lieu', 'exporter', 'tuile']);

/** Le membre connecté d'après son cookie (et toujours inscrit dans Hestia), ou rien. */
function membreDe(req: IncomingMessage): { id: string; nom: string } | undefined {
  const v = valhallaOf(); if (!v) return undefined;
  const jeton = new RegExp(`(?:^|;\\s*)${COOKIE}=([A-Za-z0-9_-]{30,80})`).exec(s(req.headers.cookie))?.[1]; if (!jeton) return undefined;
  const cle = empreinte(jeton), x = sessions.get(cle); if (!x) return undefined;
  if (x.exp < Date.now()) { sessions.delete(cle); return undefined; }
  const m = ((v.ctx('gladsheim').settings.members as Array<{ id: string; name: string }> | undefined) ?? []).find((y) => y.id === x.id);
  if (!m) { sessions.delete(cle); return undefined; }
  return { id: m.id, nom: m.name };
}

const PAGE = (nonce: string) => `<!doctype html><html lang="fr" data-ulysse="membre"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="color-scheme" content="dark light"><meta name="theme-color" content="#101A24"><title>Mes trajets · Odin</title><link rel="icon" href="/favicon.svg"><style>
:root{color-scheme:dark;--bg:#101A24;--panel:#172533;--panel2:#13202C;--line:#263849;--ink:#E6ECEF;--muted:#A9B8C4;--dim:#8FA0AE;--accent:#E3AC3F;--accent-2:#F2C366;--good:#6CCFB8;--warn:#F0B860;--bad:#EE8A70;--field:#2E4356;--field-h:#3E566C;--hover:#1C2D3D;--on-accent:#14100A;--bad-l2:#4A2E2B}
@media (prefers-color-scheme:light){:root{color-scheme:light;--bg:#EEF2F1;--panel:#FFFFFF;--panel2:#F6F8F7;--line:#D7E0DF;--ink:#15212B;--muted:#4C5B67;--dim:#5F6E7A;--accent:#A9700F;--accent-2:#C98A14;--good:#1D7F68;--warn:#8F6200;--bad:#B23F2A;--field:#C6D2D1;--field-h:#A9B8B7;--hover:#E5ECEB;--on-accent:#FFFFFF;--bad-l2:#E7B3A7}}
@font-face{font-family:"IBM Plex Sans";font-weight:400;font-display:swap;src:url(/fonts/ibm-plex-sans-latin-400-normal.woff2) format("woff2")}
@font-face{font-family:"IBM Plex Sans";font-weight:600 800;font-display:swap;src:url(/fonts/ibm-plex-sans-latin-600-normal.woff2) format("woff2")}
*{box-sizing:border-box}[hidden]{display:none!important}
html,body{margin:0;min-height:100%;background:var(--bg);color:var(--ink);font:16px/1.5 "IBM Plex Sans",system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
button,input,select{font:inherit;color:inherit}a{color:var(--accent)}
main{max-width:1180px;margin:0 auto;padding:16px max(14px,env(safe-area-inset-right)) 40px max(14px,env(safe-area-inset-left))}
:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
</style></head><body><noscript>Cette page a besoin de JavaScript.</noscript><main id="ulysse"></main><script nonce="${nonce}" src="/pages/gna.js"></script></body></html>`;

/** Rend true si la requête était pour la page des trajets d'un membre. */
export async function trajetsRoute(req: IncomingMessage, res: ServerResponse, url: URL, d: TrajetsDeps): Promise<boolean> {
  const p = url.pathname;
  if (p === '/trajets') {
    if (req.method !== 'GET') { json(res, 405, { ok: false, error: 'méthode refusée' }); return true; }
    const nonce = randomBytes(16).toString('base64');
    res.writeHead(200, {
      'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', 'x-frame-options': 'DENY',
      'content-security-policy': `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; font-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`,
      'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
    });
    res.end(PAGE(nonce)); return true;
  }
  if (!p.startsWith('/api/trajets/')) return false;
  const v = valhallaOf();
  if (!v || !v.module('gna')) { json(res, 503, { ok: false, error: 'Les applis d\'Odin ne sont pas démarrées : réessaie dans un instant.' }); return true; }
  // Le fichier GPX préparé pour CE membre, remis comme un téléchargement.
  if (req.method === 'GET' && p === '/api/trajets/fichier') {
    const m = membreDe(req); if (!m) { json(res, 401, { ok: false, error: 'connexion requise' }); return true; }
    const f = retrouver(v.ctx('gna').dir, s(url.searchParams.get('ref')).slice(0, 300), m.id);
    let taille = -1; try { if (f) taille = statSync(f).size; } catch { /* fichier parti */ }
    if (!f || taille < 0) { json(res, 404, { ok: false, error: 'Ce fichier n\'existe plus (il est effacé au bout d\'une heure) : refais l\'export.' }); return true; }
    const nom = (f.split(/[\\/]/).pop() ?? 'trajets.gpx').replace(/[^\w.() -]/g, '_');
    res.writeHead(200, { 'content-type': 'application/gpx+xml', 'content-length': String(taille), 'content-disposition': `attachment; filename="${nom}"`, 'x-content-type-options': 'nosniff', 'content-security-policy': 'sandbox', 'cache-control': 'no-store' });
    const flux = createReadStream(f); flux.on('error', () => res.destroy()); flux.pipe(res); return true;
  }
  if (req.method !== 'POST') { json(res, 405, { ok: false, error: 'méthode refusée' }); return true; }
  // Une demande venue d'un autre site ne porte pas cet en-tête (et le cookie ne la suit pas).
  if (req.headers['x-odin'] !== '1') { json(res, 403, { ok: false, error: 'en-tête x-odin manquant' }); return true; }
  let b: Record<string, unknown>; try { b = await corps(req); } catch { json(res, 413, { ok: false, error: 'demande trop longue' }); return true; }
  if (p === '/api/trajets/entrer') {
    const user = s(b.identifiant).trim().slice(0, 60), pass = s(b.mot_de_passe).slice(0, 200);
    const m = user && pass ? memberOf(v.ctx('gladsheim'), `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`) : undefined;
    if (!m) { d.fail(); json(res, 401, { ok: false, error: 'Identifiant ou mot de passe incorrect. Ce sont ceux de l\'appli OwnTracks de ton téléphone (donnés par le propriétaire d\'Odin).' }); return true; }
    const now = Date.now(); for (const [k, x] of sessions) if (x.exp < now) sessions.delete(k);
    if (sessions.size >= 500) sessions.delete(sessions.keys().next().value!);
    const jeton = randomBytes(32).toString('base64url'); sessions.set(empreinte(jeton), { id: m.id, exp: now + DUREE });
    json(res, 200, { ok: true, nom: m.name }, { 'set-cookie': cookie(jeton, d.https) }); return true;
  }
  if (p === '/api/trajets/sortir') {
    const jeton = new RegExp(`(?:^|;\\s*)${COOKIE}=([A-Za-z0-9_-]{30,80})`).exec(s(req.headers.cookie))?.[1]; if (jeton) sessions.delete(empreinte(jeton));
    json(res, 200, { ok: true }, { 'set-cookie': cookie('', d.https, 0) }); return true;
  }
  if (p === '/api/trajets/act') {
    const m = membreDe(req); if (!m) { json(res, 401, { ok: false, error: 'connexion requise' }); return true; }
    const action = s(b.action), input = (b.input && typeof b.input === 'object' && !Array.isArray(b.input) ? b.input : {}) as Record<string, unknown>;
    if (!PERMIS.has(action)) { json(res, 403, { ok: false, text: 'Cette demande se fait dans Odin, par son propriétaire.' }); return true; }
    const qui: Qui = { membre: m.id }, ctx = v.ctx('gna');
    // Ce qui efface ou engage demande d'abord l'accord du membre (la page l'affiche, puis renvoie la demande confirmée).
    const pourquoi = gravite(ctx, qui, action, input);
    if (pourquoi && b.confirm !== true) { json(res, 200, { ok: false, confirm: `Confirmer : ${pourquoi} ?` }); return true; }
    const r = await demande(ctx, qui, action, input);
    json(res, 200, { ok: r.ok !== false, text: r.text, ...(r.data !== undefined ? { data: r.data } : {}), ...(r.fichiers?.length ? { fichiers: r.fichiers.slice(0, 5) } : {}) }); return true;
  }
  json(res, 404, { ok: false, error: 'introuvable' }); return true;
}
/** Pour les essais : oublie toutes les sessions des membres. */
export function oublierSessions(): void { sessions.clear(); }
