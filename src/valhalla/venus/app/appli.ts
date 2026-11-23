// Vénus, l'interface (lot V1) : la page plein écran de Vénus servie par Odin, et ce qu'elle lit.
//
//   GET /venus/app/                 la page (sa propre politique de contenu : rien d'extérieur, scripts d'Odin seulement)
//   GET /venus/app/app.js           le code de l'interface ; /venus/app/planetes.js : icônes et planètes du dépôt Venus
//   GET /venus/app/css/app.css      la feuille de style du dépôt Venus (licence MIT), /venus/app/fonts/* ses polices
//   GET /venus/api/catalogue        films, séries, animés et clips de la bibliothèque déjà scannée, avec la progression
//   GET /venus/api/titre/<id>       la fiche d'un titre : saisons, épisodes, fichier et fiche technique
//   GET /venus/api/profils          « Qui regarde ? » : les comptes d'Odin (le propriétaire, puis les personnes de Persona)
//   GET|POST /venus/api/preferences la planète et le menu choisis, par profil (base VENUS_ODIN, repli fichiers)
//
// Tout est derrière la garde de routes.ts : le propriétaire seul (un membre n'ouvre ni la page ni ses données).
// Rien n'est inventé : un renseignement absent (affiche, genres, notes, distribution) reste absent, et la page le dit.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import type { Enr, MagasinVenus } from '../base.ts';
import { cibleAJouer, episodes, maListe } from '../bibliotheque.ts';
import { persona, personnes, prenomProprio } from '../../sso/etat.ts';
import { ageDe } from '../../sso/infos.ts';
import { Accounts } from '../../../web/account.ts';

const DOSSIER = new URL('./', import.meta.url);
const s = (v: unknown) => (v === undefined || v === null ? '' : String(v)).trim();

// ---------------- Profils (« Qui regarde ? ») ----------------
export interface ProfilVenus { id: string; name: string; isAdmin?: boolean; isKids?: boolean; avatar: number }
/** Le profil du propriétaire garde l'identifiant d'avant (« moi ») : sa liste et sa reprise ne changent pas. */
export const PROFIL_PROPRIETAIRE = 'moi';
const avatarDe = (t: string) => { let x = 0; for (const c of t) x = (x * 31 + c.charCodeAt(0)) % 8; return x; };
/** Les comptes d'Odin vus comme profils de Vénus : le propriétaire, puis chaque personne active de Persona. */
export function profils(home: string, maintenant = new Date()): ProfilVenus[] {
  const ctx = persona();
  const nom = ctx ? prenomProprio(ctx) : (new Accounts(home).profile()?.prenom || '');
  const out: ProfilVenus[] = [{ id: PROFIL_PROPRIETAIRE, name: nom || 'Odin', isAdmin: true, avatar: 0 }];
  if (!ctx) return out;
  for (const p of personnes(ctx)) {
    if (!p.active || p.proprio || !/^[A-Za-z0-9_.-]{1,60}$/.test(p.login)) continue;
    const enfant = typeof p.naissance === 'number' && ageDe(p.naissance, maintenant) < 13;
    out.push({ id: `p:${p.login}`, name: p.name || p.login, avatar: avatarDe(p.login), ...(enfant ? { isKids: true } : {}) });
  }
  return out;
}
/** Le profil choisi, écrit par la page dans le témoin « venus_profil » (chemin /venus, lu aussi par le lecteur et le flux). */
export const profilDuTemoin = (req: IncomingMessage): string => { const m = /(?:^|;\s*)venus_profil=([^;]+)/.exec(s(req.headers.cookie)); if (!m) return ''; try { return decodeURIComponent(m[1]); } catch { return ''; } };
/** Le profil demandé (en-tête x-venus-profil, sinon le témoin), s'il est un compte d'Odin ; sinon celui du propriétaire. */
export function profilDemande(req: IncomingMessage, home: string): string {
  const v = s(req.headers['x-venus-profil']) || profilDuTemoin(req);
  if (!v || v === PROFIL_PROPRIETAIRE) return PROFIL_PROPRIETAIRE;
  return profils(home).some((p) => p.id === v) ? v : PROFIL_PROPRIETAIRE;
}

// ---------------- Catalogue (lecture de la bibliothèque déjà scannée) ----------------
/** La forme d'un titre pour l'interface (mêmes noms de champs que les composants du dépôt Venus). */
export interface TitreVenus {
  id: string; type: 'movie' | 'show' | 'clip'; category: 'movie' | 'show' | 'anime' | 'clip'; title: string;
  year?: number; runtime?: number; res?: string; added: number; poster?: string;
  progress?: { position: number; duration: number; watched: boolean }; status: 'seen' | 'progress' | 'unseen';
  inList: boolean; played: number; episodes?: number; seasons?: number; unseen?: number;
  /** la prochaine chose à lire (film, ou l'épisode à suivre d'une série) */ play?: { id: string; season?: number; episode?: number; position: number };
}
const FINI = 0.95;
const resDe = (h: number) => (h >= 1800 ? '4K' : h >= 1000 ? '1080p' : h >= 700 ? '720p' : h > 0 ? 'SD' : '');
const hauteur = (r: unknown) => Number(/^(\d+)p$/.exec(s(r))?.[1] ?? 0);
/** La date du fichier (ajout dans Vénus), ou la date d'enregistrement à défaut. */
function dateFichier(mag: MagasinVenus, chemin: unknown, repli: number): number {
  const id = s(chemin).replace(/[^A-Za-z0-9_.:-]/g, '_').slice(-199);
  const f = id ? mag.get('fichiers', id) : undefined;
  return Number(f?.data.mtime) || repli;
}
/** La catégorie d'une œuvre : celle qu'elle porte (animé, clip : posée par un rangement à venir), sinon son type. */
const categorieDe = (o: Enr): TitreVenus['category'] => {
  const c = s(o.data.categorie);
  if (c === 'anime' && o.data.type === 'serie') return 'anime';
  if (c === 'clip' && o.data.type === 'film') return 'clip';
  return o.data.type === 'serie' ? 'show' : 'movie';
};
const afficheUrl = (o: Enr): string | undefined => { const a = s(o.data.affiche); return a && existsSync(a) ? `/venus/vignette/${encodeURIComponent(o.id)}` : undefined; };

/** La reprise d'un profil, par cible. */
function reprises(mag: MagasinVenus, profil: string): Map<string, { position: number; duration: number; maj: number }> {
  const m = new Map<string, { position: number; duration: number; maj: number }>();
  for (const r of mag.liste('reprise')) if (r.data.profil === profil) m.set(s(r.data.cible_id), { position: Number(r.data.position_s) || 0, duration: Number(r.data.duree_s) || 0, maj: Number(r.data.maj) || r.maj });
  return m;
}
const vu = (p: { position: number; duration: number } | undefined, duree = 0) => { const d = p?.duration || duree; return !!p && d > 0 && p.position >= d * FINI; };

/** Un titre de la bibliothèque, pour un profil. */
function titreDe(mag: MagasinVenus, o: Enr, profil: string, rep: Map<string, { position: number; duration: number; maj: number }>, liste: Set<string>): TitreVenus {
  const category = categorieDe(o), type: TitreVenus['type'] = category === 'clip' ? 'clip' : o.data.type === 'serie' ? 'show' : 'movie';
  const base = { id: o.id, type, category, title: s(o.data.titre) || o.id, ...(Number(o.data.annee) ? { year: Number(o.data.annee) } : {}), inList: liste.has(o.id), ...(afficheUrl(o) ? { poster: afficheUrl(o) } : {}) };
  if (type !== 'show') {
    const duree = Number(o.data.duree) || 0, p = rep.get(o.id), w = vu(p, duree);
    return { ...base, ...(duree ? { runtime: Math.round(duree / 60) } : {}), ...(resDe(hauteur(o.data.resolution)) ? { res: resDe(hauteur(o.data.resolution)) } : {}),
      added: dateFichier(mag, o.data.fichier, o.maj), played: p?.maj ?? 0,
      ...(p ? { progress: { position: p.position, duration: p.duration || duree, watched: w } } : {}),
      status: w ? 'seen' : p && p.position > 0 ? 'progress' : 'unseen', play: { id: o.id, position: w ? 0 : p?.position ?? 0 } };
  }
  const eps = episodes(mag, o.id);
  const nVus = eps.filter((e) => vu(rep.get(e.id), Number(e.data.duree) || 0)).length, touche = eps.some((e) => rep.has(e.id));
  const suite = cibleAJouer(mag, o, { profil });
  const play = 'cibleId' in suite ? { id: suite.cibleId, season: suite.saison, episode: suite.episode, position: suite.reprise_s } : undefined;
  const h = Math.max(0, ...eps.map((e) => hauteur(e.data.resolution)));
  const durees = eps.map((e) => Number(e.data.duree) || 0).filter(Boolean);
  return { ...base, added: Math.max(0, ...eps.map((e) => dateFichier(mag, e.data.fichier, e.maj))), played: Math.max(0, ...eps.map((e) => rep.get(e.id)?.maj ?? 0)),
    episodes: eps.length, seasons: new Set(eps.map((e) => Number(e.data.saison))).size, unseen: eps.length - nVus,
    ...(durees.length ? { runtime: Math.round(durees.reduce((a, b) => a + b, 0) / durees.length / 60) } : {}), ...(resDe(h) ? { res: resDe(h) } : {}),
    status: eps.length && nVus === eps.length ? 'seen' : touche ? 'progress' : 'unseen', ...(play ? { play } : {}) };
}

/** Le catalogue de Vénus pour un profil : films, séries, animés et clips (la musique et les livres viennent plus tard). */
export function catalogue(mag: MagasinVenus, profil: string): TitreVenus[] {
  const rep = reprises(mag, profil), liste = new Set(maListe(mag, profil).map((c) => c.id));
  return mag.liste('oeuvres').filter((o) => o.data.type === 'film' || o.data.type === 'serie')
    .map((o) => titreDe(mag, o, profil, rep, liste)).sort((a, b) => a.title.localeCompare(b.title));
}

/** La fiche d'un titre : le titre, ses saisons et épisodes (les numéros qui manquent entre deux épisodes présents sont dits), la fiche technique. */
export function fiche(mag: MagasinVenus, profil: string, id: string): Record<string, unknown> | undefined {
  const o = mag.get('oeuvres', id); if (!o || (o.data.type !== 'film' && o.data.type !== 'serie')) return undefined;
  const rep = reprises(mag, profil), liste = new Set(maListe(mag, profil).map((c) => c.id));
  const t = titreDe(mag, o, profil, rep, liste);
  const tech = (chemin: unknown) => {
    const c = s(chemin); if (!c) return undefined;
    const f = mag.get('fichiers', c.replace(/[^A-Za-z0-9_.:-]/g, '_').slice(-199));
    const probe = (f?.data.probe ?? {}) as { largeur?: number; hauteur?: number; codecs?: string[]; audio?: string[]; sousTitres?: Array<{ langue?: string; titre?: string }> };
    let taille = Number(f?.data.taille) || 0; if (!taille) { try { taille = statSync(c).size; } catch { taille = 0; } }
    return { fichier: c, taille, largeur: probe.largeur, hauteur: probe.hauteur, video: probe.codecs ?? [], audio: probe.audio ?? [] };
  };
  const sousTitres = (l: unknown) => (Array.isArray(l) ? l as Array<{ langue?: string; titre?: string; fichier?: string }> : []).map((x) => ({ langue: s(x.langue), titre: s(x.titre), aPart: !!x.fichier }));
  if (o.data.type !== 'serie') return { titre: t, tech: tech(o.data.fichier), sousTitres: sousTitres(o.data.sous_titres) };
  const eps = episodes(mag, id), parSaison = new Map<number, Enr[]>();
  for (const e of eps) { const n = Number(e.data.saison) || 0; parSaison.set(n, [...(parSaison.get(n) ?? []), e]); }
  const saisons = [...parSaison.entries()].sort((a, b) => a[0] - b[0]).map(([number, l]) => {
    const nums = new Set(l.map((e) => Number(e.data.episode))), max = Math.max(0, ...nums);
    const manquants: number[] = []; for (let k = 1; k < max; k++) if (!nums.has(k)) manquants.push(k);
    return { number, manquants, episodes: l.map((e) => { const p = rep.get(e.id), d = Number(e.data.duree) || 0;
      return { id: e.id, episode: Number(e.data.episode), runtime: d ? Math.round(d / 60) : undefined, res: resDe(hauteur(e.data.resolution)) || undefined, position: p?.position ?? 0, duration: p?.duration || d, watched: vu(p, d) }; }) };
  });
  return { titre: t, saisons, tech: tech(eps[0]?.data.fichier), sousTitres: sousTitres(eps[0]?.data.sous_titres) };
}

// ---------------- Préférences (planète, menu) ----------------
const PLANETES = new Set(['mercure', 'venus', 'terre', 'mars', 'jupiter', 'saturne', 'uranus', 'neptune', 'pluton', 'noir', 'blanc', 'tv', 'cinema', 'verre', 'lagon', 'ocean', 'sable']);
const MENU_IDS = new Set(['home', 'movies', 'shows', 'anime', 'clips', 'request', 'today', 'new', 'tv', 'music', 'photos', 'books', 'mylist', 'collections', 'search', 'seance', 'remote', 'stats', 'downloads', 'dashboard']);
export interface PreferencesVenus { planete?: string; auto?: 'off' | 'sun' | 'system'; verre?: 'auto' | 'day' | 'night'; leger?: 'auto' | 'on' | 'off'; ordre?: string[]; caches?: string[] }
/** Ne garde que des valeurs connues (planète des 17, sections du menu de Vénus). Pur. */
export function nettoyerPreferences(b: Record<string, unknown>): PreferencesVenus {
  const out: PreferencesVenus = {};
  if (PLANETES.has(s(b.planete))) out.planete = s(b.planete);
  if (['off', 'sun', 'system'].includes(s(b.auto))) out.auto = s(b.auto) as PreferencesVenus['auto'];
  if (['auto', 'day', 'night'].includes(s(b.verre))) out.verre = s(b.verre) as PreferencesVenus['verre'];
  if (['auto', 'on', 'off'].includes(s(b.leger))) out.leger = s(b.leger) as PreferencesVenus['leger'];
  const ids = (l: unknown) => (Array.isArray(l) ? [...new Set(l.map(s).filter((x) => MENU_IDS.has(x)))] : undefined);
  const o = ids(b.ordre), c = ids(b.caches); if (o) out.ordre = o; if (c) out.caches = c;
  return out;
}
// Rangées pour l'instant dans un petit fichier du dossier de Vénus (interface.json, mode 0o600), par profil : la base
// VENUS_ODIN n'a pas encore de table pour elles (à ajouter avec base.ts, hors de ce lot ; voir le compte rendu).
const fichierPrefs = (mag: MagasinVenus) => join(mag.dir, 'interface.json');
function toutes(mag: MagasinVenus): Record<string, PreferencesVenus> {
  try { const j = JSON.parse(readFileSync(fichierPrefs(mag), 'utf8')) as unknown; return j && typeof j === 'object' && !Array.isArray(j) ? j as Record<string, PreferencesVenus> : {}; } catch { return {}; }
}
export const preferences = (mag: MagasinVenus, profil: string): PreferencesVenus => nettoyerPreferences((toutes(mag)[profil] ?? {}) as Record<string, unknown>);
export function reglerPreferences(mag: MagasinVenus, profil: string, b: Record<string, unknown>): PreferencesVenus {
  const tout = toutes(mag), p = { ...preferences(mag, profil), ...nettoyerPreferences(b) };
  tout[profil] = p; mkdirSync(mag.dir, { recursive: true, mode: 0o700 });
  const f = fichierPrefs(mag), tmp = `${f}.tmp`; writeFileSync(tmp, JSON.stringify(tout), { mode: 0o600 }); renameSync(tmp, f);
  return p;
}

// ---------------- La page et ses fichiers ----------------
const TYPES: Record<string, string> = { '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.woff2': 'font/woff2', '.LICENSE': 'text/plain; charset=utf-8' };
const FICHIERS = /^(app\.js|planetes\.js|css\/(?:app|odin)\.css|fonts\/[a-z-]+\.(?:woff2|LICENSE)|LICENSE)$/;
/** La page de Vénus : un document à elle (le dépôt Venus fixe son rail sur toute la hauteur), avec « ‹ Odin » pour revenir. */
export function pageAppli(nonce: string, langue = 'fr'): string {
  return `<!doctype html>
<html lang="${langue.replace(/[^A-Za-z-]/g, '') || 'fr'}" data-layout="rail" data-planet="venus" data-tone="dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="color-scheme" content="dark light">
<title>Venus</title>
<link rel="stylesheet" href="/venus/app/css/app.css">
<link rel="stylesheet" href="/venus/app/css/odin.css">
</head>
<body>
<div id="app" aria-busy="true"></div>
<script nonce="${nonce}" src="/venus/app/planetes.js"></script>
<script nonce="${nonce}" src="/pages/venus-lecteur.js"></script>
<script nonce="${nonce}" src="/venus/app/app.js"></script>
</body>
</html>
`;
}
const CSP = (nonce: string) => `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; media-src 'self' blob:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'`;

const envoyer = (res: ServerResponse, code: number, type: string, corps: string | Buffer, cache = 'no-cache') => {
  res.writeHead(code, { 'content-type': type, 'cache-control': cache, 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' }); res.end(corps);
};
const json = (res: ServerResponse, code: number, corps: unknown) => envoyer(res, code, 'application/json; charset=utf-8', JSON.stringify(corps), 'no-store');
async function lireCorps(req: IncomingMessage, max = 16 * 1024): Promise<Record<string, unknown>> {
  const parts: Buffer[] = []; let n = 0;
  for await (const c of req) { n += (c as Buffer).length; if (n > max) return {}; parts.push(c as Buffer); }
  try { const j = JSON.parse(Buffer.concat(parts).toString('utf8') || '{}') as unknown; return j && typeof j === 'object' && !Array.isArray(j) ? j as Record<string, unknown> : {}; } catch { return {}; }
}

/** Les routes de l'interface (/venus/app/…, /venus/api/…). Appelée APRÈS la garde du propriétaire. Rend true si servie. */
export async function routeAppli(req: IncomingMessage, res: ServerResponse, url: URL, home: string, mag: MagasinVenus, profil: string): Promise<boolean> {
  const p = url.pathname, meth = req.method ?? 'GET';
  if (p === '/venus/app' || p === '/venus/app/') {
    if (meth !== 'GET') { json(res, 405, { error: 'GET attendu' }); return true; }
    const nonce = randomBytes(16).toString('base64'), langue = s(req.headers['accept-language']).split(/[,;]/)[0] || 'fr';
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': CSP(nonce), 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', 'cache-control': 'no-store', 'x-frame-options': 'DENY', 'cross-origin-opener-policy': 'same-origin' });
    res.end(pageAppli(nonce, langue)); return true;
  }
  if (p.startsWith('/venus/app/')) {
    const reste = p.slice('/venus/app/'.length);
    if (meth !== 'GET' || !FICHIERS.test(reste)) { json(res, 404, { error: 'fichier inconnu' }); return true; }
    const f = new URL(reste, DOSSIER), ext = /\.LICENSE$|LICENSE$/.test(reste) ? '.LICENSE' : reste.slice(reste.lastIndexOf('.'));
    try { envoyer(res, 200, TYPES[ext] ?? 'application/octet-stream', readFileSync(f), ext === '.woff2' ? 'max-age=604800' : 'no-cache'); } catch { json(res, 404, { error: 'fichier absent' }); }
    return true;
  }
  if (!p.startsWith('/venus/api/')) return false;
  const reste = p.slice('/venus/api/'.length);
  if (meth === 'GET' && reste === 'catalogue') { json(res, 200, { profil, titres: catalogue(mag, profil) }); return true; }
  if (meth === 'GET' && reste.startsWith('titre/')) {
    let id = reste.slice(6); try { id = decodeURIComponent(id); } catch { /* tel quel */ }
    const f = fiche(mag, profil, id); if (!f) { json(res, 404, { error: 'titre introuvable' }); return true; }
    json(res, 200, f); return true;
  }
  // « choisi » : un profil a déjà été choisi sur cet appareil (témoin valide) ; sinon la page montre « Qui regarde ? ».
  if (meth === 'GET' && reste === 'profils') { const l = profils(home), c = profilDuTemoin(req); json(res, 200, { profils: l, actuel: profil, choisi: l.some((p) => p.id === c) }); return true; }
  if (reste === 'preferences') {
    if (meth === 'GET') { json(res, 200, { preferences: preferences(mag, profil) }); return true; }
    // Une écriture : l'en-tête x-odin, comme chaque POST d'Odin (une page d'un autre site ne peut pas le poser).
    if (meth === 'POST' && req.headers['x-odin'] !== '1') { json(res, 403, { error: 'en-tête x-odin manquant' }); return true; }
    if (meth === 'POST') { json(res, 200, { preferences: reglerPreferences(mag, profil, await lireCorps(req)) }); return true; }
  }
  json(res, 404, { error: 'route Vénus inconnue' }); return true;
}
