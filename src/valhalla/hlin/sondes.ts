// Gygès — ce qu'on demande directement à un site, poliment et sans jamais se connecter :
//   1. la présence d'un profil public à un pseudo, sur une liste courte de grands sites écrite pour Odin. Un site
//      n'a une « sonde » que s'il offre une interface publique documentée qui répond clairement sans connexion
//      (oui : la réponse redonne le même pseudo ; non : « introuvable »). Tous les autres (Snapchat, Instagram,
//      TikTok, Facebook, X…) affichent un mur de connexion : Odin ne le contourne pas, il donne le lien à ouvrir
//      soi-même. Toute réponse floue (limite atteinte, page d'attente, redirection) vaut « à vérifier toi-même » ;
//   2. les fuites connues d'une adresse e-mail, par Have I Been Pwned (API v3, avec la clé du propriétaire) ;
//   3. les noms de domaine qui imitent celui d'une société : variantes fabriquées ici, existence vérifiée par DNS.
// Aucune énumération de comptes à partir d'une adresse e-mail (ni GHunt, ni équivalent).
import { Resolver } from 'node:dns/promises';

export const AGENT = 'Odin-Gyges/1 (assistant personnel auto-heberge ; verifie ses propres identifiants)';

// ---------------------------------------------------------------- pseudos
export type Presence = 'présent' | 'absent' | 'à vérifier';
export interface SiteProfil {
  id: string; nom: string;
  /** l'adresse publique du profil : celle qu'on ouvre soi-même */
  profil(p: string): string;
  /** la question posée au site quand il sait répondre clairement ; rend vrai (présent), faux (absent) ou rien (pas clair) */
  sonde?: { url(p: string): string; lire(statut: number, corps: unknown, p: string): boolean | undefined };
}
const e = encodeURIComponent, meme = (a: unknown, b: string) => typeof a === 'string' && a.toLowerCase() === b.toLowerCase();
export const SITES: SiteProfil[] = [
  { id: 'snapchat', nom: 'Snapchat', profil: (p) => `https://www.snapchat.com/add/${e(p)}` },
  { id: 'instagram', nom: 'Instagram', profil: (p) => `https://www.instagram.com/${e(p)}/` },
  { id: 'tiktok', nom: 'TikTok', profil: (p) => `https://www.tiktok.com/@${e(p)}` },
  { id: 'facebook', nom: 'Facebook', profil: (p) => `https://www.facebook.com/${e(p)}` },
  { id: 'x', nom: 'X (Twitter)', profil: (p) => `https://x.com/${e(p)}` },
  { id: 'threads', nom: 'Threads', profil: (p) => `https://www.threads.net/@${e(p)}` },
  { id: 'youtube', nom: 'YouTube', profil: (p) => `https://www.youtube.com/@${e(p)}` },
  { id: 'linkedin', nom: 'LinkedIn', profil: (p) => `https://www.linkedin.com/in/${e(p)}` },
  { id: 'pinterest', nom: 'Pinterest', profil: (p) => `https://www.pinterest.com/${e(p)}/` },
  { id: 'telegram', nom: 'Telegram', profil: (p) => `https://t.me/${e(p)}` },
  { id: 'twitch', nom: 'Twitch', profil: (p) => `https://www.twitch.tv/${e(p)}` },
  { id: 'reddit', nom: 'Reddit', profil: (p) => `https://www.reddit.com/user/${e(p)}` },
  // GitHub, API REST « Get a user » : 200 et le compte, ou 404.
  { id: 'github', nom: 'GitHub', profil: (p) => `https://github.com/${e(p)}`, sonde: { url: (p) => `https://api.github.com/users/${e(p)}`, lire: (st, j, p) => (st === 200 && meme((j as { login?: unknown } | undefined)?.login, p) ? true : st === 404 ? false : undefined) } },
  // GitLab, API « Users » : une liste, vide si personne ne porte ce pseudo.
  { id: 'gitlab', nom: 'GitLab', profil: (p) => `https://gitlab.com/${e(p)}`, sonde: { url: (p) => `https://gitlab.com/api/v4/users?username=${e(p)}`, lire: (st, j, p) => (st !== 200 || !Array.isArray(j) ? undefined : j.length === 0 ? false : j.some((u) => meme((u as { username?: unknown } | undefined)?.username, p)) ? true : undefined) } },
  // Bluesky, API publique « app.bsky.actor.getProfile » : 200 et le profil, ou 400 « Profile not found ».
  { id: 'bluesky', nom: 'Bluesky', profil: (p) => `https://bsky.app/profile/${e(p)}.bsky.social`, sonde: { url: (p) => `https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile?actor=${e(p)}.bsky.social`, lire: (st, j, p) => (st === 200 && meme((j as { handle?: unknown } | undefined)?.handle, `${p}.bsky.social`) ? true : st === 400 && /not found|unable to resolve/i.test(String((j as { message?: unknown } | undefined)?.message ?? '')) ? false : undefined) } },
  // Mastodon (mastodon.social), API « accounts/lookup » : 200 et le compte, ou 404 « Record not found ».
  { id: 'mastodon', nom: 'Mastodon', profil: (p) => `https://mastodon.social/@${e(p)}`, sonde: { url: (p) => `https://mastodon.social/api/v1/accounts/lookup?acct=${e(p)}`, lire: (st, j, p) => (st === 200 && meme((j as { username?: unknown } | undefined)?.username, p) ? true : st === 404 && /not found/i.test(String((j as { error?: unknown } | undefined)?.error ?? '')) ? false : undefined) } },
  // Wikipédia, API MediaWiki « list=users » : un numéro de compte, ou « missing ».
  { id: 'wikipedia', nom: 'Wikipédia', profil: (p) => `https://fr.wikipedia.org/wiki/Utilisateur:${e(p)}`, sonde: { url: (p) => `https://fr.wikipedia.org/w/api.php?action=query&list=users&ususers=${e(p)}&format=json&formatversion=2`, lire: (st, j) => { const u = (j as { query?: { users?: Array<{ userid?: unknown; missing?: unknown }> } } | undefined)?.query?.users?.[0]; return st !== 200 || !u ? undefined : typeof u.userid === 'number' ? true : u.missing === true ? false : undefined; } } },
];
/**
 * Y a-t-il un profil public à ce pseudo sur ce site ? Une seule demande, sans connexion, sans suivre de redirection.
 * Tout ce qui n'est pas une réponse claire (erreur, limite atteinte, page inattendue) vaut « à vérifier ».
 */
export async function sonder(f: typeof fetch, s: SiteProfil, p: string): Promise<Presence> {
  if (!s.sonde) return 'à vérifier';
  try {
    const r = await f(s.sonde.url(p), { redirect: 'manual', headers: { accept: 'application/json', 'user-agent': AGENT }, signal: AbortSignal.timeout(10_000) });
    const t = (await r.text()).slice(0, 200_000); let j: unknown; try { j = JSON.parse(t); } catch { j = undefined; }
    const v = s.sonde.lire(r.status, j, p);
    return v === true ? 'présent' : v === false ? 'absent' : 'à vérifier';
  } catch { return 'à vérifier'; }
}

// ---------------------------------------------------------------- fuites connues (Have I Been Pwned)
// API v3, relue le 14/11/2026 (haveibeenpwned.com/API/v3) : GET /breachedAccount/{adresse encodée}, en-têtes
// « hibp-api-key » (32 caractères hexadécimaux) et « user-agent » (qui décrit vraiment l'appli) ; 200 = fuites,
// 404 = aucune, 401 = clé refusée, 403 = « user-agent » manquant ou accès refusé, 429 = trop vite (en-tête « retry-after », en secondes). Données sous licence
// CC BY 4.0 : la source et un lien vers haveibeenpwned.com sont affichés partout où elles apparaissent.
export interface Fuite { nom: string; titre: string; site: string; date: string; comptes: number; donnees: string[]; spam: boolean; espion: boolean }
export const cleHibpValide = (k: unknown) => typeof k === 'string' && /^[a-f0-9]{32}$/i.test(k.trim());
const CLASSES: Record<string, string> = {
  'Email addresses': 'e-mail', Passwords: 'mot de passe', 'Password hints': 'indice de mot de passe', Usernames: 'pseudo', Names: 'nom', 'Phone numbers': 'téléphone',
  'Physical addresses': 'adresse', 'Dates of birth': 'date de naissance', 'IP addresses': 'adresse IP', 'Geographic locations': 'lieu', Genders: 'genre',
  'Credit cards': 'carte bancaire', 'Partial credit card data': 'carte bancaire (en partie)', 'Bank account numbers': 'compte bancaire', 'Government issued IDs': 'pièce d\'identité',
  'Passport numbers': 'passeport', 'Social security numbers': 'numéro de sécurité sociale', 'Security questions and answers': 'questions secrètes', 'Auth tokens': 'jetons de connexion',
  Purchases: 'achats', 'Private messages': 'messages privés', 'Device information': 'appareil', Employers: 'employeur', 'Job titles': 'métier', 'Social media profiles': 'profils de réseaux sociaux',
};
/** Une fuite telle que la décrit l'API → ce qu'Odin en garde (les données en français). Pur. */
export function lireFuite(b: unknown): Fuite | undefined {
  const x = b as { Name?: unknown; Title?: unknown; Domain?: unknown; BreachDate?: unknown; PwnCount?: unknown; DataClasses?: unknown; IsSpamList?: unknown; IsStealerLog?: unknown; IsRetired?: unknown } | undefined;
  if (!x || typeof x.Name !== 'string' || !/^[\w.-]{1,80}$/.test(x.Name) || x.IsRetired === true) return undefined;
  const propre = (v: unknown, max: number) => String(v ?? '').replace(/[\u0000-\u001f\u007f<>]+/g, ' ').trim().slice(0, max);
  return { nom: x.Name, titre: propre(x.Title, 80) || x.Name, site: propre(x.Domain, 80).toLowerCase(), date: /^\d{4}-\d{2}-\d{2}/.test(String(x.BreachDate)) ? String(x.BreachDate).slice(0, 10) : '', comptes: Number(x.PwnCount) || 0, donnees: (Array.isArray(x.DataClasses) ? x.DataClasses : []).slice(0, 30).map((c) => CLASSES[String(c)] ?? propre(c, 40).toLowerCase()).filter(Boolean), spam: x.IsSpamList === true, espion: x.IsStealerLog === true };
}
export type EtatFuites = 'ok' | 'aucune' | 'clé refusée' | 'limite' | 'erreur';
/** Les fuites connues d'une adresse e-mail. `attendre` : la pause demandée par le service quand on va trop vite (60 s au plus, une seule fois). */
export async function fuitesDe(f: typeof fetch, cle: string, email: string, attendre: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms))): Promise<{ etat: EtatFuites; fuites: Fuite[]; detail?: string }> {
  const url = `https://haveibeenpwned.com/api/v3/breachedAccount/${encodeURIComponent(email)}?truncateResponse=false`;
  for (let essai = 0; essai < 2; essai++) {
    let r: Response;
    try { r = await f(url, { headers: { 'hibp-api-key': cle.trim(), 'user-agent': AGENT, accept: 'application/json' }, signal: AbortSignal.timeout(20_000) }); } catch (err) { return { etat: 'erreur', fuites: [], detail: `Have I Been Pwned ne répond pas (${(err as Error).message.slice(0, 80)})` }; }
    if (r.status === 404) { await r.body?.cancel().catch(() => undefined); return { etat: 'aucune', fuites: [] }; }
    if (r.status === 401) { await r.body?.cancel().catch(() => undefined); return { etat: 'clé refusée', fuites: [], detail: 'Have I Been Pwned refuse la clé (elle est fausse, ou l\'abonnement est fini)' }; }
    if (r.status === 429) { await r.body?.cancel().catch(() => undefined); if (essai) break; await attendre(Math.min(60, Math.max(1, Number(r.headers.get('retry-after')) || 6)) * 1000); continue; }
    if (r.status !== 200) { await r.body?.cancel().catch(() => undefined); return { etat: 'erreur', fuites: [], detail: `Have I Been Pwned a répondu ${r.status}` }; }
    let j: unknown; try { j = await r.json(); } catch { return { etat: 'erreur', fuites: [], detail: 'réponse de Have I Been Pwned illisible' }; }
    const l = (Array.isArray(j) ? j : []).map(lireFuite).filter((x): x is Fuite => Boolean(x));
    return { etat: l.length ? 'ok' : 'aucune', fuites: l };
  }
  return { etat: 'limite', fuites: [], detail: 'Have I Been Pwned demande de ralentir : la suite à la prochaine vérification' };
}

// ---------------------------------------------------------------- noms de domaine qui imitent
export interface Variante { nom: string; genre: 'autre extension' | 'lettre qui ressemble' | 'lettre en moins' | 'lettres inversées' | 'mot ajouté' | 'lettre doublée' | 'tiret' | 'lettre voisine' }
const DOUBLES = new Set(['co.uk', 'org.uk', 'com.au', 'co.nz', 'com.br', 'co.za', 'com.tr', 'co.jp', 'com.mx', 'co.in', 'asso.fr', 'com.fr', 'gouv.fr']);
/** « boutique.exemple.co.uk » → le nom déposé (« exemple ») et son extension (« co.uk »). Pur. */
export function couper(d: string): { nom: string; ext: string } {
  const p = d.toLowerCase().split('.'), deux = p.slice(-2).join('.');
  return DOUBLES.has(deux) && p.length >= 3 ? { nom: p[p.length - 3], ext: deux } : { nom: p[p.length - 2] ?? d, ext: p[p.length - 1] ?? '' };
}
const EXTENSIONS = ['com', 'fr', 'net', 'org', 'co', 'io', 'eu', 'info', 'biz', 'shop', 'online', 'site', 'store', 'app', 'xyz', 'yt', 're'];
const RESSEMBLE: Record<string, string[]> = { o: ['0'], 0: ['o'], l: ['1', 'i'], i: ['1', 'l'], 1: ['l', 'i'], e: ['3'], a: ['4'], s: ['5'], g: ['q'], q: ['g'], u: ['v'], v: ['u'], m: ['rn', 'n'], n: ['m'], w: ['vv'], d: ['cl'], t: ['7'], b: ['d'] };
const VOISINES: Record<string, string> = { a: 'zq', z: 'ae', e: 'zr', r: 'et', t: 'ry', y: 'tu', u: 'yi', i: 'uo', o: 'ip', p: 'o', q: 'as', s: 'qd', d: 'sf', f: 'dg', g: 'fh', h: 'gj', j: 'hk', k: 'jl', l: 'km', m: 'ln', w: 'xq', x: 'wc', c: 'xv', v: 'cb', b: 'vn', n: 'bm' };
/**
 * Les noms qui imitent un nom de domaine : une faute de frappe (lettre en moins, doublée, inversée, voisine sur le
 * clavier), une lettre qui ressemble (0 pour o, rn pour m), un tiret, un mot ajouté (« -sav », « -officiel »), une
 * autre extension. `max` au plus, en prenant un peu de chaque genre. Pur.
 */
export function variantes(domaine: string, max = 120): Variante[] {
  const { nom: n, ext } = couper(domaine); if (!n || !ext) return [];
  const g: Record<Variante['genre'], string[]> = { 'autre extension': [], 'lettre qui ressemble': [], 'lettre en moins': [], 'lettres inversées': [], 'mot ajouté': [], 'lettre doublée': [], tiret: [], 'lettre voisine': [] };
  for (const x of EXTENSIONS) if (x !== ext) g['autre extension'].push(`${n}.${x}`);
  const avec = (l: string) => `${l}.${ext}`;
  for (let k = 0; k < n.length; k++) {
    for (const r of RESSEMBLE[n[k]] ?? []) g['lettre qui ressemble'].push(avec(n.slice(0, k) + r + n.slice(k + 1)));
    if (n.length >= 5) g['lettre en moins'].push(avec(n.slice(0, k) + n.slice(k + 1)));
    if (n.length >= 4 && k < n.length - 1 && n[k] !== n[k + 1]) g['lettres inversées'].push(avec(n.slice(0, k) + n[k + 1] + n[k] + n.slice(k + 2)));
    if (n.length >= 4) g['lettre doublée'].push(avec(n.slice(0, k + 1) + n[k] + n.slice(k + 1)));
    if (n.length >= 4 && k > 0 && n[k] !== '-' && n[k - 1] !== '-') g.tiret.push(avec(`${n.slice(0, k)}-${n.slice(k)}`));
    if (n.length >= 5) for (const v of VOISINES[n[k]] ?? '') g['lettre voisine'].push(avec(n.slice(0, k) + v + n.slice(k + 1)));
  }
  for (const [a, b] of [['rn', 'm'], ['vv', 'w'], ['cl', 'd']]) if (n.includes(a)) g['lettre qui ressemble'].push(avec(n.replace(a, b)));
  if (n.includes('-')) g.tiret.push(avec(n.replace(/-/g, '')));
  if (n.length >= 4) g['mot ajouté'].push(...[`${n}s`, `${n}-officiel`, `${n}-sav`, `${n}-support`, `${n}-client`, `${n}-paiement`, `${n}-shop`, `my${n}`, `www${n}`].map(avec));
  const bon = (d: string) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.[a-z0-9.-]+$/.test(d) && !d.includes('--') && d !== `${n}.${ext}`;
  const out: Variante[] = [], vus = new Set<string>(), files = (Object.entries(g) as Array<[Variante['genre'], string[]]>).map(([genre, l]) => ({ genre, l: [...l] }));
  while (out.length < max && files.some((x) => x.l.length)) for (const x of files) { const d = x.l.shift(); if (d && bon(d) && !vus.has(d) && out.length < max) { vus.add(d); out.push({ nom: d, genre: x.genre }); } }
  return out;
}

/** Ce qu'on demande au DNS : les adresses d'un nom, et s'il reçoit du courrier. Une erreur porte son code (ENOTFOUND, ENODATA…). */
export interface Dns { a(nom: string): Promise<string[]>; mx(nom: string): Promise<boolean> }
/** Le DNS de la machine (ou des serveurs donnés, pour un essai). */
export function dnsSysteme(serveurs?: string[]): Dns {
  const r = new Resolver({ timeout: 3000, tries: 2 }); if (serveurs?.length) r.setServers(serveurs);
  return { a: (nom) => r.resolve4(nom), mx: async (nom) => (await r.resolveMx(nom)).some((x) => x.exchange && x.exchange !== '.') };
}
/**
 * Ce nom existe-t-il ? Oui s'il a une adresse (ou s'il existe sans adresse : « ENODATA »), non si le DNS dit qu'il
 * n'existe pas (« ENOTFOUND ») ; rien quand le DNS ne répond pas clairement (panne, délai) : on ne conclut pas.
 */
export async function existe(dns: Dns, nom: string): Promise<{ existe: boolean; ip?: string; mx?: boolean } | undefined> {
  const courrier = () => dns.mx(nom).catch(() => false);
  try { const ips = await dns.a(nom); return ips.length ? { existe: true, ip: ips[0], mx: await courrier() } : { existe: true, mx: await courrier() }; }
  catch (err) { const c = (err as { code?: string }).code; if (c === 'ENOTFOUND') return { existe: false }; if (c === 'ENODATA') return { existe: true, mx: await courrier() }; return undefined; }
}
