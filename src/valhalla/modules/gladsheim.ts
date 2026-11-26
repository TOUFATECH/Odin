// Hestia · la maison en un écran : un tableau de bord plein écran (tablette murale, téléphone, ordinateur,
// et dans Home Assistant), à thèmes, qui réunit les appareils de Midgard (lumières, volets, clim, serrures,
// lecteurs), les scènes, la météo, l'état de toutes les applis d'Odin, et des boutons vers n'importe quelle
// action d'une appli (bloquer quelqu'un, VPN, accès réseau, mises à jour…). La mascotte s'y promène, joue,
// donne la météo et l'heure, et exécute ce que tu lui demandes avec les mêmes droits que partout dans Odin.
// Reprend les idées de Home Assistant (Lovelace, Mushroom, Bubble Card), Homepage, Dashy et Homarr.
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { accord } from '../../core/genre.ts';
import type { ModCtx, Module, Param, Tone } from '../types.ts';
import { valhallaOf } from '../odin.ts';
import { FAMILLES, THEME_NAMES } from './apparence.ts';
import { homeDevices } from './midgard.ts';
import { nourrir, oublier } from '../gna/historique.ts';
import { arrondirPosition, ecrireFichierPrive, lireFichierPrive } from '../../prive.ts';
import { PAYS_PAR_DEFAUT, degres, fuseauValide, lieuDuFuseau, regionDe, setLieuCourant, temperature, vitesse, type Region, type Unites } from '../lieu.ts';
import { fetchPropre } from '../../net/fetch-propre.ts';
import { agissant } from '../sso/acces.ts';
import { accueilSeulement, admiseALaMaison, droitDeVoir, sorteDe, sortesPosables, type IdSortePosable } from '../widgets/index.ts';
import { ACCUEIL_RECU, CODES_PAGES, PAGE_AUJOURDHUI, type CodePage } from '../widgets/aujourdhui.ts';
import { actionsOuvertures, lecteurDe, ouverturesGardees } from '../widgets/ouvertures.ts';
import { ADRESSE_MAX, adressesRefusees, retraitRefuse, toucherNet, toucherServi, type Toucher } from '../widgets/regler.ts';

const s = (v: unknown) => String(v ?? '');
export const THEMES: Record<string, { label: string; dark: boolean }> = {
  verre: { label: 'Verre sombre (tuiles colorées)', dark: true },
  nuit: { label: 'Bleu nuit', dark: true },
  braise: { label: 'Braise (orange)', dark: true },
  acier: { label: 'Acier (gris bleuté)', dark: true },
  mural: { label: 'Tablette murale (noir et cyan)', dark: true },
  crepuscule: { label: 'Crépuscule (paysage)', dark: true },
  classique: { label: 'Classique (comme Home Assistant)', dark: true },
  violet: { label: 'Violet', dark: true },
  aurore: { label: 'Aurore (violet et soleil)', dark: true },
  lagon: { label: 'Lagon (bleu-vert)', dark: true },
  clair: { label: 'Clair', dark: false },
  ocean: { label: 'Bleu océan', dark: true }, blanc: { label: 'Blanc pur', dark: false }, rubis: { label: 'Rouge rubis', dark: true }, foret: { label: 'Vert forêt', dark: true }, soleil: { label: 'Jaune soleil', dark: false },
  plage: { label: 'Plage (palmier)', dark: false }, etoiles: { label: 'Ciel étoilé', dark: true }, boreale: { label: 'Aurore boréale', dark: true }, mayotte: { label: 'Lagon de Mayotte', dark: false }, coucher: { label: 'Coucher de soleil', dark: true },
  montagne: { label: 'Montagne et brume', dark: false }, tropical: { label: 'Forêt tropicale', dark: true }, desert: { label: 'Désert', dark: false }, neige: { label: 'Neige', dark: false }, abysses: { label: 'Océan profond', dark: true },
  neon: { label: 'Néon', dark: true }, bois: { label: 'Bois et lin', dark: false }, graphite: { label: 'Graphite', dark: true }, pastel: { label: 'Pastel', dark: false }, espace: { label: 'Espace', dark: true },
};
/**
 * La liste entière de l'écran de la maison : les familles de Réglages → Apparence, dans leur ordre (« Mis en avant »,
 * dont « Home Assistant » et « Maison claire » ; « Les thèmes d'Odin » ; « Thèmes de Hestia » ; « Événements de
 * l'année »), avec les mêmes noms. Un thème d'Odin y est rangé avec le préfixe « o- » (« o-nuit », « o-ev-noel ») ;
 * les thèmes de Hestia gardent leur identifiant sans préfixe (règle des identifiants de /maison : sans préfixe, c'est
 * d'abord un thème de Hestia), tous, pour que l'ancien réglage reste lisible. Un réglage pour cet écran, un autre pour
 * Odin : ils ne se touchent pas.
 * Une exception : le thème classique d'Odin (« Valhalla (classique) ») n'a pas de ciel, il n'est donc pas un thème de
 * cet écran, comme dans la maquette (qui ne transforme que les thèmes qui ont un ciel). Il reste dans Réglages →
 * Apparence ; ici, il n'est ni proposé ni accepté, et un ancien « o-valhalla » se dessine comme le thème de départ.
 */
const HORS_ECRAN_MAISON = new Set(['valhalla']);
export const THEMES_MAISON: Record<string, { label: string }> = Object.fromEntries(FAMILLES.flatMap((f) => (f.id === 'hestia'
  ? Object.entries(THEMES).map(([id, x]) => [id, x])
  : f.ids.filter((id) => !HORS_ECRAN_MAISON.has(id)).map((id) => [`o-${id}`, { label: THEME_NAMES[id] }]))));
export interface Tile { id: string; label: string; module: string; action: string; input: Record<string, unknown>; icon: string; color?: string }
export interface Key { id: string; name: string; hash: string; rights: 'maison' | 'complet'; at: number; used?: number }
/** Un membre de la famille qui partage sa position avec l'appli OwnTracks (il l'installe et peut la mettre en pause). */
export interface Member { id: string; name: string; user: string; hash: string; tid: string; at: number }
export interface Fix { at: number; lat: number; lon: number; acc?: number; batt?: number; conn?: string; place?: string }
const members = (ctx: ModCtx): Member[] => (ctx.settings.members as Member[] | undefined) ?? [];
/** Le dossier d'Ulysse (les trajets), à côté de celui de Hestia : chaque position reçue y est gardée si le membre a allumé son historique. */
const trajetsDir = (ctx: ModCtx) => join(ctx.dir, '..', 'gna');
const nombre = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : undefined);
/** Les membres de la famille lus dans le dossier de Hestia, sans leurs identifiants secrets (pour Ulysse). Rien (undefined) si le fichier est illisible. */
export function famille(dossier: string): Array<{ id: string; name: string; user: string }> | undefined {
  const f = join(dossier, 'réglages.json'); if (!existsSync(f)) return [];
  try { const l = (JSON.parse(readFileSync(f, 'utf8')) as { members?: Member[] }).members; return (Array.isArray(l) ? l : []).filter((m) => m && typeof m.id === 'string').map((m) => ({ id: m.id, name: String(m.name ?? ''), user: String(m.user ?? '') })); } catch { return undefined; }
}
const fixesFile = (ctx: ModCtx) => join(ctx.dir, 'positions.json');
// Les positions de la famille : fichier chiffré avec la clé de la machine (jamais en clair sur le disque).
function readFixes(ctx: ModCtx): Record<string, Fix[]> { return lireFichierPrive<Record<string, Fix[]>>(ctx.home, fixesFile(ctx)) ?? {}; }
const writeFixes = (ctx: ModCtx, all: Record<string, Fix[]>) => ecrireFichierPrive(ctx.home, fixesFile(ctx), all);
/** Positions gardées `days` jours (1 par défaut), puis effacées. */
function keepDays(ctx: ModCtx) { return Math.max(1, Math.min(30, Number(ctx.settings.positionsJours) || 1)); }
/** OwnTracks (mode HTTP) : identifiants Basic d'un membre → le membre, ou rien. */
export function memberOf(ctx: ModCtx, authorization: string): Member | undefined {
  const m = /^Basic\s+([A-Za-z0-9+/=]+)$/.exec(authorization.trim()); if (!m) return undefined;
  const raw = Buffer.from(m[1], 'base64').toString('utf8'), k = raw.indexOf(':'); if (k < 1) return undefined;
  const user = raw.slice(0, k), pass = raw.slice(k + 1), h = Buffer.from(hash(pass), 'hex');
  return members(ctx).find((x) => { const b = Buffer.from(x.hash, 'hex'); return x.user === user && b.length === h.length && timingSafeEqual(b, h); });
}
/** Range une position envoyée par OwnTracks, efface les vieilles, et rend celles des autres membres (chacun voit la famille sur sa carte). */
export function recordFix(ctx: ModCtx, m: Member, body: Record<string, unknown>, now = Date.now()): Array<Record<string, unknown>> {
  const all = readFixes(ctx), limit = now - keepDays(ctx) * 864e5;
  if (body._type === 'location' && Number.isFinite(Number(body.lat)) && Number.isFinite(Number(body.lon)) && Math.abs(Number(body.lat)) <= 90 && Math.abs(Number(body.lon)) <= 180) {
    const f: Fix = { at: Number(body.tst) ? Math.min(now, Number(body.tst) * 1000) : now, lat: Math.round(Number(body.lat) * 1e5) / 1e5, lon: Math.round(Number(body.lon) * 1e5) / 1e5, ...(Number.isFinite(Number(body.acc)) ? { acc: Math.round(Number(body.acc)) } : {}), ...(Number.isFinite(Number(body.batt)) ? { batt: Number(body.batt) } : {}), ...(typeof body.conn === 'string' ? { conn: body.conn.slice(0, 2) } : {}), ...(Array.isArray(body.inregions) && body.inregions.length ? { place: String(body.inregions[0]).slice(0, 60) } : {}) };
    all[m.id] = [...(all[m.id] ?? []), f].slice(-2000);
    // Ulysse (trajets) : la position rejoint l'historique du membre seulement s'il l'a allumé ; sinon rien de plus n'est gardé.
    const vel = nombre(body.vel), alt = nombre(body.alt);
    nourrir(trajetsDir(ctx), m.id, { t: f.at, lat: f.lat, lon: f.lon, ...(f.acc !== undefined ? { acc: f.acc } : {}), ...(vel !== undefined ? { vel } : {}), ...(alt !== undefined ? { alt } : {}) }, now);
  }
  for (const k of Object.keys(all)) { all[k] = all[k].filter((x) => x.at >= limit); if (!all[k].length || !members(ctx).some((x) => x.id === k)) delete all[k]; }
  try { mkdirSync(ctx.dir, { recursive: true }); writeFixes(ctx, all); } catch { /* disque plein */ }
  return members(ctx).filter((x) => x.id !== m.id && all[x.id]?.length).flatMap((x) => { const f = all[x.id].at(-1)!; return [{ _type: 'card', tid: x.tid, name: x.name }, { _type: 'location', tid: x.tid, lat: f.lat, lon: f.lon, tst: Math.round(f.at / 1000), ...(f.acc ? { acc: f.acc } : {}), ...(f.batt !== undefined ? { batt: f.batt } : {}) }]; });
}
/** La dernière position de chaque membre (pour l'écran de la maison et la mascotte). */
export function familyNow(ctx: ModCtx): Array<{ id: string; name: string; at: number; lat: number; lon: number; acc?: number; batt?: number; place?: string }> {
  const all = readFixes(ctx), limit = Date.now() - keepDays(ctx) * 864e5;
  return members(ctx).flatMap((m) => { const f = all[m.id]?.filter((x) => x.at >= limit).at(-1); return f ? [{ id: m.id, name: m.name, at: f.at, lat: f.lat, lon: f.lon, ...(f.acc ? { acc: f.acc } : {}), ...(f.batt !== undefined ? { batt: f.batt } : {}), ...(f.place ? { place: f.place } : {}) }] : []; });
}
const tiles = (ctx: ModCtx): Tile[] | undefined => ctx.settings.tiles as Tile[] | undefined;
const keys = (ctx: ModCtx): Key[] => (ctx.settings.keys as Key[] | undefined) ?? [];
const hash = (k: string) => createHash('sha256').update(k).digest('hex');

/** Les boutons proposés au départ : seulement ceux dont l'appli existe. */
export function defaultTiles(ctx: ModCtx): Tile[] {
  const want: Array<[string, string, string, Record<string, unknown>, string]> = [
    ['VPN : allumer', 'gjoll', 'allumer', {}, '🛡'], ['Appareils du VPN', 'gjoll', 'appareils', {}, '📱'], ['Ports ouverts', 'garmr', 'ports_ouverts', {}, '🚪'],
    ['Adresses bannies', 'garmr', 'bannis', {}, '⛔'], ['Couper les sessions d\'une personne', 'var', 'couper_sessions', {}, '🚫'], ['Personnes', 'var', 'personnes', {}, '👥'],
    ['État de l\'ordinateur', 'eir', 'etat', {}, '🩺'], ['Problèmes', 'vordr', 'problemes', {}, '⚠'], ['Protection', 'ullr', 'etat', {}, '🦠'],
    ['Sauvegarder', 'sindri', 'sauvegarder', {}, '💾'], ['ISO à jour', 'eitri', 'mettre_a_jour', {}, '💿'], ['Logiciels à jour', 'fjalar', 'mettre_a_jour', {}, '📦'],
  ];
  return want.filter(([, m, a]) => ctx.modules().some((x) => x.id === m && x.actions.some((y) => y.id === a))).map(([label, module, action, input, icon]) => ({ id: `${module}-${action}`, label, module, action, input, icon }));
}
export const tilesOf = (ctx: ModCtx) => tiles(ctx) ?? defaultTiles(ctx);

/** Une clé de tablette (lien à ouvrir sur une tablette murale ou dans Home Assistant) : ses droits, ou rien. */
export function keyRights(ctx: ModCtx, key: string): Key | undefined {
  if (!/^gk_[A-Za-z0-9_-]{30,60}$/.test(key)) return undefined;
  const h = Buffer.from(hash(key), 'hex');
  const k = keys(ctx).find((x) => { const b = Buffer.from(x.hash, 'hex'); return b.length === h.length && timingSafeEqual(b, h); });
  if (k && Date.now() - (k.used ?? 0) > 3600_000) ctx.saveSettings({ keys: keys(ctx).map((x) => (x.id === k.id ? { ...x, used: Date.now() } : x)) });
  return k;
}

// ---------------- Météo (Open-Meteo, sans clé ; ou ton propre serveur Open-Meteo : réglages meteoApi / meteoGeo) ----------------
export interface Weather { place: string; lat?: number; lon?: number; /** fuseau horaire du lieu (ex. Indian/Mayotte) */ fuseau?: string; /** unités d'affichage (les nombres restent en °C et km/h) */ unites?: Unites; temp: number; feels?: number; code: number; humidity?: number; wind?: number; hi?: number; lo?: number; rain?: number; sunrise?: string; sunset?: string; days: Array<{ day: string; code: number; hi: number; lo: number }>; hours: Array<{ t: string; temp: number }>; at: number }
let wx: Weather | undefined, wxErr = '';
export const WCODE: Record<number, [string, string]> = { 0: ['Ciel dégagé', '☀️'], 1: ['Plutôt dégagé', '🌤'], 2: ['Partiellement nuageux', '⛅'], 3: ['Couvert', '☁️'], 45: ['Brouillard', '🌫'], 48: ['Brouillard givrant', '🌫'], 51: ['Bruine', '🌦'], 53: ['Bruine', '🌦'], 55: ['Bruine forte', '🌧'], 61: ['Pluie faible', '🌦'], 63: ['Pluie', '🌧'], 65: ['Forte pluie', '🌧'], 66: ['Pluie verglaçante', '🌧'], 67: ['Pluie verglaçante', '🌧'], 71: ['Neige faible', '🌨'], 73: ['Neige', '🌨'], 75: ['Forte neige', '❄️'], 80: ['Averses', '🌦'], 81: ['Averses', '🌧'], 82: ['Violentes averses', '⛈'], 95: ['Orage', '⛈'], 96: ['Orage et grêle', '⛈'], 99: ['Orage et grêle', '⛈'] };
export const wword = (c: number) => (WCODE[c] ?? ['Temps variable', '🌡'])[0];
/**
 * Le lieu d'Odin : l'endroit exact où il est installé (village ou ville). La météo, l'heure locale (fuseau), le thème
 * automatique, les événements du jour et le briefing du matin s'en servent. Il se règle par son nom (« ma ville est
 * Dembéni », la carte météo, la page de Hestia) ou par la position de l'appareil (bouton « Me localiser » : le GPS
 * d'un téléphone est précis ; un ordinateur donne souvent une position approximative, et Odin le dit).
 * Tant que rien n'est réglé : Mamoudzou.
 */
export const LIEU_PAR_DEFAUT = 'Mamoudzou';
export interface Lieu { nom: string; lat: number; lon: number; pays?: string; region?: string; fuseau?: string }
/**
 * Ce qui découle du lieu (pays → unités, heure sur 12 ou 24 h, devise, fêtes), avec ce que tu as réglé à la main
 * par-dessus (réglages `unites`, `heure`, `devise` : vides = automatique).
 */
export function regionActuelle(ctx: ModCtx): Region & { manuel: string[] } {
  const r = regionDe(s(ctx.settings.pays) || PAYS_PAR_DEFAUT), manuel: string[] = [];
  const u = s(ctx.settings.unites), h = s(ctx.settings.heure), d = s(ctx.settings.devise).toUpperCase();
  if (u === 'metrique' || u === 'imperial') { r.unites = u; manuel.push('unités'); }
  if (h === '24h' || h === '12h') { r.heure = h; manuel.push('heure'); }
  if (/^[A-Z]{3}$/.test(d)) { r.devise = d; manuel.push('devise'); }
  return { ...r, manuel };
}
/** Dit au reste d'Odin où il est (thème, événements, consignes du modèle). À appeler après tout changement, et au démarrage. */
export function publierLieu(ctx: ModCtx): void {
  const lat = Number(ctx.settings.lat), lon = Number(ctx.settings.lon), nom = s(ctx.settings.villeNom) || s(ctx.settings.ville);
  setLieuCourant(nom ? { nom, ...(ctx.settings.lat && Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : {}), ...(s(ctx.settings.fuseau) ? { fuseau: s(ctx.settings.fuseau) } : {}), region: regionActuelle(ctx), ...(ctx.settings.suppose === true ? { suppose: true } : {}) } : undefined);
}
/** Un lieu vient de changer : s'il est dans un autre pays, les réglages faits à la main (unités, heure, devise) repassent en automatique. */
function nouveauPays(ctx: ModCtx, pays?: string): Record<string, unknown> {
  return pays && pays !== (s(ctx.settings.pays) || PAYS_PAR_DEFAUT) ? { unites: '', heure: '', devise: '' } : {};
}
/**
 * Où la connexion Internet de la machine sort (utile pour un serveur loué : la ville du centre de données). Demandé
 * seulement quand tu dis « configure-toi tout seul » : l'adresse publique de la machine est vue par ce service
 * (réglable : `lieuConnexion`). À la maison, c'est approximatif (souvent la grande ville voisine) : Odin le dit.
 */
export async function lieuDeLaConnexion(ctx: ModCtx): Promise<Lieu | undefined> {
  try {
    const j = await (await ctx.fetch(s(ctx.settings.lieuConnexion) || 'https://ipapi.co/json/', { headers: { 'user-agent': 'Odin (assistant personnel)' }, signal: AbortSignal.timeout(10_000) })).json() as Record<string, unknown>;
    const lat = Number(j.latitude ?? j.lat), lon = Number(j.longitude ?? j.lon), nom = s(j.city), tz = typeof j.timezone === 'string' ? j.timezone : s((j.timezone as { id?: string } | undefined)?.id), pays = s(j.country_code || j.countryCode || j.country).toUpperCase();
    if (!nom || !Number.isFinite(lat) || !Number.isFinite(lon) || (lat === 0 && lon === 0)) return undefined;
    return { nom: nom.slice(0, 80), lat: Math.round(lat * 1e4) / 1e4, lon: Math.round(lon * 1e4) / 1e4, ...(/^[A-Z]{2}$/.test(pays) ? { pays } : {}), ...(s(j.region || j.country_name) ? { region: s(j.region || j.country_name).slice(0, 80) } : {}), ...(tz && fuseauValide(tz) ? { fuseau: tz } : {}) };
  } catch { return undefined; }
}
/** Ce que l'horloge de la machine laisse supposer, tant que rien n'est réglé (au démarrage, sans rien demander à Internet). */
export function supposerLieu(ctx: ModCtx, tz = Intl.DateTimeFormat().resolvedOptions().timeZone, force = false): boolean {
  if (!force && s(ctx.settings.ville)) return false;
  const g = lieuDuFuseau(tz); if (!g) return false;
  ctx.saveSettings({ ville: g.ville, villeNom: g.ville, pays: g.pays, fuseau: tz, lat: '', lon: '', suppose: true }); wx = undefined;
  return true;
}
/** Une phrase qui dit comment Odin est réglé pour ce lieu. */
export function texteRegion(ctx: ModCtx): string {
  const r = regionActuelle(ctx), nom = s(ctx.settings.villeNom) || s(ctx.settings.ville) || LIEU_PAR_DEFAUT, tz = s(ctx.settings.fuseau);
  let heure = ''; try { heure = new Intl.DateTimeFormat('fr-FR', { hour: 'numeric', minute: '2-digit', hour12: r.heure === '12h', ...(tz ? { timeZone: tz } : {}) }).format(ctx.now()); } catch { /* fuseau inconnu de la machine */ }
  const fetes = Object.entries(r.fetes).filter(([, on]) => on).map(([k]) => k);
  return `Je suis ${accord('réglé', 'réglée')} pour ${nom} (${r.nom})${ctx.settings.suppose === true ? `, supposé d'après l'horloge de la machine` : ''} : ${tz ? `fuseau ${tz}${heure ? ` (il est ${heure})` : ''}, ` : ''}${r.unites === 'imperial' ? 'degrés Fahrenheit et miles' : 'degrés Celsius et kilomètres'}, heure sur ${r.heure === '12h' ? '12 heures' : '24 heures'}, prix en ${r.devise}${fetes.length ? `, fêtes ajoutées : ${fetes.join(', ')}` : ''}${r.manuel.length ? ` (réglé à la main : ${r.manuel.join(', ')})` : ''}.`;
}
let lieuChange: ((l: Lieu) => void) | undefined;
/** Prévenu à chaque changement de lieu (Odin recopie la ville dans le briefing du matin). */
export function surLieu(f: ((l: Lieu) => void) | undefined): void { lieuChange = f; }
const sansAccent = (t: string) => t.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
/**
 * Les lieux qui portent ce nom (Open-Meteo, sans clé), le plus probable d'abord : celui du pays ou de la région
 * précisés (« Dembéni, Mayotte »), sinon celui du pays où est Odin (réglage `pays`), sinon celui de Mayotte (son pays
 * d'origine), sinon le premier proposé. Les autres sont toujours cités, pour pouvoir corriger.
 */
export async function trouverLieux(ctx: ModCtx, nom: string): Promise<Lieu[]> {
  const [ville, precision] = nom.split(',').map((x) => x.trim()), pays = (s(ctx.settings.pays) || 'YT').toUpperCase();
  if (!ville) return [];
  const res = await fetchPropre(`${s(ctx.settings.meteoGeo) || 'https://geocoding-api.open-meteo.com'}/v1/search?name=${encodeURIComponent(ville)}&count=10&language=fr`, { fetch: ctx.fetch, timeoutMs: 10_000, label: 'La recherche de lieu' });
  if (!res.ok || !res.reponse) throw new Error(res.erreur ?? 'service de lieux injoignable');
  const g = await res.reponse.json().catch(() => ({})) as { results?: Array<{ name: string; latitude: number; longitude: number; country_code?: string; country?: string; admin1?: string; timezone?: string }> };
  const rang = (x: { country?: string; country_code?: string; admin1?: string }) => (precision && [x.country, x.country_code, x.admin1].some((y) => y && sansAccent(y) === sansAccent(precision)) ? 0 : x.country_code?.toUpperCase() === pays ? 1 : x.country_code?.toUpperCase() === PAYS_PAR_DEFAUT ? 2 : 3);
  return (g.results ?? []).map((r, i) => ({ r, i })).sort((a, b) => rang(a.r) - rang(b.r) || a.i - b.i)
    .map(({ r }) => ({ nom: r.name || ville, lat: r.latitude, lon: r.longitude, ...(r.country_code ? { pays: r.country_code.toUpperCase() } : {}), ...(r.admin1 || r.country ? { region: [r.admin1, r.country].filter(Boolean).filter((x, i, l) => l.indexOf(x) === i).join(', ') } : {}), ...(r.timezone ? { fuseau: r.timezone } : {}) }));
}
/**
 * Le nom du village où se trouve une position (OpenStreetMap Nominatim, sans clé ; adresse réglable : `lieuInverse`).
 * Rend « Village (Commune) » quand les deux sont connus. Rien si le service ne répond pas.
 */
export async function nommerPosition(ctx: ModCtx, lat: number, lon: number): Promise<{ nom: string; pays?: string; region?: string } | undefined> {
  try {
    const r = await (await ctx.fetch(`${s(ctx.settings.lieuInverse) || 'https://nominatim.openstreetmap.org'}/reverse?format=jsonv2&lat=${lat}&lon=${lon}&zoom=16&accept-language=fr`, { headers: { 'user-agent': 'Odin (assistant personnel)' }, signal: AbortSignal.timeout(10_000) })).json() as { address?: Record<string, string> };
    const a = r.address ?? {}, village = a.village || a.hamlet || a.suburb || a.neighbourhood || a.quarter || a.town || a.city, commune = a.municipality || a.town || a.city || a.county;
    const nom = village && commune && sansAccent(village) !== sansAccent(commune) ? `${village} (${commune})` : village || commune;
    return nom ? { nom: nom.slice(0, 80), ...(a.country_code ? { pays: a.country_code.toUpperCase() } : {}), ...(a.state || a.country ? { region: a.state || a.country } : {}) } : undefined;
  } catch { return undefined; }
}
/** Change le lieu par son nom : il est d'abord cherché (rien ne change s'il est introuvable), puis gardé avec son vrai nom, ses coordonnées et son fuseau. Rend aussi les autres lieux du même nom. */
export async function changerLieu(ctx: ModCtx, ville: string): Promise<Lieu & { autres: Lieu[] }> {
  const v = ville.replace(/\s+/g, ' ').trim().slice(0, 80); if (!v) throw new Error('dis-moi le nom du village ou de la ville (par exemple « ma ville est Dembéni »)');
  let l: Lieu[]; try { l = await trouverLieux(ctx, v); } catch { throw new Error('je n\'arrive pas à chercher ce lieu pour l\'instant (pas d\'Internet ?) : le lieu n\'a pas changé'); }
  const g = l[0]; if (!g) throw new Error(`je ne trouve pas « ${v} » : vérifie l'orthographe, ou précise le pays (« ${v}, Mayotte »)`);
  ctx.saveSettings({ ville: v, villeNom: g.nom, lat: arrondirPosition(g.lat), lon: arrondirPosition(g.lon), precisionM: '', suppose: '', ...nouveauPays(ctx, g.pays), ...(g.pays ? { pays: g.pays } : {}), ...(g.fuseau ? { fuseau: g.fuseau } : {}) }); wx = undefined;
  publierLieu(ctx); lieuChange?.(g);
  return { ...g, autres: l.slice(1, 5) };
}
/** Change le lieu par la position de l'appareil (GPS) : le village est nommé d'après la position ; `precision` en mètres. */
export async function changerPosition(ctx: ModCtx, lat: number, lon: number, precision?: number): Promise<Lieu & { precision?: number; nomme: boolean }> {
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) throw new Error('position illisible : la latitude va de -90 à 90, la longitude de -180 à 180');
  const la = Math.round(lat * 1e5) / 1e5, lo = Math.round(lon * 1e5) / 1e5, n = await nommerPosition(ctx, la, lo);
  const nom = n?.nom ?? `Position ${la.toFixed(3)}, ${lo.toFixed(3)}`, p = precision !== undefined && Number.isFinite(precision) && precision >= 0 ? Math.round(precision) : undefined;
  // Le village est nommé d'après la position exacte, mais seule une position arrondie à ~100 m est gardée (chiffrée).
  const ga = arrondirPosition(la), go = arrondirPosition(lo);
  ctx.saveSettings({ ville: nom, villeNom: nom, lat: ga, lon: go, precisionM: p ?? '', suppose: '', ...nouveauPays(ctx, n?.pays), ...(n?.pays ? { pays: n.pays } : {}) }); wx = undefined;
  const g: Lieu = { nom, lat: ga, lon: go, ...(n?.pays ? { pays: n.pays } : {}), ...(n?.region ? { region: n.region } : {}) };
  publierLieu(ctx); lieuChange?.(g);
  return { ...g, ...(p !== undefined ? { precision: p } : {}), nomme: Boolean(n) };
}
/** Le lieu en place (rien : jamais réglé, Odin se croit à Mamoudzou). */
export function lieuDe(ctx: ModCtx): (Lieu & { precision?: number }) | undefined {
  const lat = Number(ctx.settings.lat), lon = Number(ctx.settings.lon);
  if (!s(ctx.settings.ville) || !ctx.settings.lat || !Number.isFinite(lat) || !Number.isFinite(lon)) return undefined;
  return { nom: s(ctx.settings.villeNom) || s(ctx.settings.ville), lat, lon, ...(s(ctx.settings.pays) ? { pays: s(ctx.settings.pays) } : {}), ...(s(ctx.settings.fuseau) ? { fuseau: s(ctx.settings.fuseau) } : {}), ...(Number(ctx.settings.precisionM) > 0 ? { precision: Number(ctx.settings.precisionM) } : {}) };
}
/** Les prévisions d'un point précis (Open-Meteo), sans rien garder : sert au lieu d'Odin et à « la météo à … » d'un autre endroit. */
export async function previsions(ctx: ModCtx, lat: number, lon: number, place: string): Promise<Weather> {
  const res = await fetchPropre(`${s(ctx.settings.meteoApi) || 'https://api.open-meteo.com'}/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,precipitation&hourly=temperature_2m&daily=weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset&timezone=auto&forecast_days=7`, { fetch: ctx.fetch, timeoutMs: 10_000, label: 'La météo' });
  if (!res.ok || !res.reponse) throw new Error(res.erreur ?? 'Open-Meteo ne répond pas');
  const r = await res.reponse.json().catch(() => ({})) as { timezone?: string; current: Record<string, number>; hourly: { time: string[]; temperature_2m: number[] }; daily: { time: string[]; weather_code: number[]; temperature_2m_max: number[]; temperature_2m_min: number[]; sunrise: string[]; sunset: string[] } };
  const now = new Date().toISOString().slice(0, 13), from = Math.max(0, r.hourly.time.findIndex((t) => t.slice(0, 13) >= now));
  return { place, lat, lon, ...(typeof r.timezone === 'string' && r.timezone ? { fuseau: r.timezone } : {}), unites: regionActuelle(ctx).unites, temp: Math.round(r.current.temperature_2m), feels: Math.round(r.current.apparent_temperature), code: r.current.weather_code, humidity: r.current.relative_humidity_2m, wind: Math.round(r.current.wind_speed_10m), rain: r.current.precipitation, hi: Math.round(r.daily.temperature_2m_max[0]), lo: Math.round(r.daily.temperature_2m_min[0]), sunrise: r.daily.sunrise[0]?.slice(11, 16), sunset: r.daily.sunset[0]?.slice(11, 16), days: r.daily.time.map((d, i) => ({ day: d, code: r.daily.weather_code[i], hi: Math.round(r.daily.temperature_2m_max[i]), lo: Math.round(r.daily.temperature_2m_min[i]) })), hours: r.hourly.time.slice(from, from + 24).map((t, i) => ({ t: t.slice(11, 16), temp: Math.round(r.hourly.temperature_2m[from + i]) })), at: Date.now() };
}
export async function weather(ctx: ModCtx, fresh = false): Promise<Weather | undefined> {
  if (!fresh && wx && Date.now() - wx.at < 15 * 60_000) return wx;
  let place = s(ctx.settings.villeNom) || s(ctx.settings.ville) || LIEU_PAR_DEFAUT;
  try {
    let lat = Number(ctx.settings.lat), lon = Number(ctx.settings.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || !ctx.settings.lat) {
      const g = (await trouverLieux(ctx, s(ctx.settings.ville) || LIEU_PAR_DEFAUT))[0];
      if (!g) throw new Error(`lieu introuvable : ${place}`);
      lat = g.lat; lon = g.lon; place = g.nom; ctx.saveSettings({ lat: arrondirPosition(lat), lon: arrondirPosition(lon), villeNom: g.nom, ...(g.fuseau ? { fuseau: g.fuseau } : {}) });
    }
    wx = await previsions(ctx, lat, lon, place);
    if (wx.fuseau && wx.fuseau !== s(ctx.settings.fuseau)) { ctx.saveSettings({ fuseau: wx.fuseau }); publierLieu(ctx); }
    wxErr = ''; return wx;
  } catch (e) { wxErr = (e as Error).message; return wx; }
}
/** Vrai si la dernière mise à jour météo a échoué : le cache encore montré est « ancien ». */
export function meteoAncienne(): { ancien: boolean; motif: string } { return { ancien: Boolean(wxErr), motif: wxErr }; }
export const weatherText = (w?: Weather) => (w ? `À ${w.place} : ${temperature(w.temp, w.unites)}, ${wword(w.code).toLowerCase()}${w.hi !== undefined && w.lo !== undefined ? ` (min ${degres(w.lo, w.unites)}, max ${degres(w.hi, w.unites)})` : ''}${w.humidity !== undefined ? `, humidité ${w.humidity} %` : ''}${w.wind !== undefined ? `, vent ${vitesse(w.wind, w.unites)}` : ''}.` : `Météo indisponible${wxErr ? ` (${wxErr})` : ''}.`);

// ---------------- L'état des applis (tuiles d'état) ----------------
export interface AppState { id: string; name: string; family: string; alerts: number; kpis: Array<{ label: string; value: string; tone?: Tone }> }
let apps: { at: number; list: AppState[] } | undefined;
/** Les deux premiers chiffres clés de chaque appli et ses alertes en cours (gardé une minute). */
export async function appStates(): Promise<AppState[]> {
  const v = valhallaOf(); if (!v) return [];
  if (apps && Date.now() - apps.at < 60_000) return apps.list;
  const open = v.alerts({ limit: 500 }).filter((a) => !a.ack);
  const list = await Promise.all(v.modules().filter((m) => m.id !== 'gladsheim').map(async (m) => {
    let kpis: AppState['kpis'] = [];
    try { const view = await Promise.race([m.view(v.ctx(m.id), new URLSearchParams()), new Promise<never>((_, ko) => setTimeout(() => ko(new Error('lent')), 2000))]); kpis = (view.kpis ?? []).slice(0, 2).map((k) => ({ label: k.label, value: k.value, ...(k.tone ? { tone: k.tone } : {}) })); } catch { /* appli lente ou pas prête */ }
    return { id: m.id, name: m.name, family: m.family, alerts: open.filter((a) => a.module === m.id).length, kpis };
  }));
  apps = { at: Date.now(), list }; return list;
}
export function resetGladsheim(): void { wx = undefined; wxErr = ''; apps = undefined; }

const TILE: Param[] = [
  { key: 'nom', label: 'Texte du bouton', kind: 'text', required: true },
  { key: 'appli', label: 'Appli (ex. gjoll, var, garmr)', kind: 'text', required: true },
  { key: 'action', label: 'Action (ex. allumer, couper_sessions)', kind: 'text', required: true },
  { key: 'reglages', label: 'Réglages de l\'action (clé=valeur, une par ligne)', kind: 'textarea', default: '' },
  { key: 'icone', label: 'Icône (un emoji)', kind: 'text', default: '⚡' },
  { key: 'couleur', label: 'Couleur (#RRGGBB, facultatif)', kind: 'text', default: '' },
];

// ---------------- La fenêtre d'Odin : pages de modules d'applis, modifiables (maquettes validées) ----------------
/**
 * Les sortes de modules acceptées : celles que les fichiers de famille (src/valhalla/widgets/) disent posables, et non plus
 * une liste écrite ici (lot 23, constat M14). Aujourd'hui : « heure » (la date, l'heure et le lieu d'Odin), « meteo »,
 * « site » (une sonde de Pulsar, nommée par `label`), « chiffres », « section » (une partie de page), « bouton ».
 */
export type WidgetKind = IdSortePosable;
/**
 * Un module de la fenêtre. Sa place, c'est son rang dans la liste de la page (la grille se remplit toute seule).
 * Sa taille (grille de la maquette validée) : `c` colonnes sur 12, `r` lignes ; au téléphone, à part, `pc` colonnes
 * sur 4 et `pr` lignes (absentes : l'écran choisit). `w` (1, 2 ou 3 colonnes) est l'ancienne largeur, toujours rendue
 * pour l'écran d'aujourd'hui : elle se déduit de `c` (1 à 4 → 1, 5 à 8 → 2, 9 à 12 → 3).
 */
export interface Widget { id: string; kind: WidgetKind; w: 1 | 2 | 3; c: number; r: number; pc?: number; pr?: number; module?: string; section?: string; label?: string; action?: string; input?: Record<string, string>; style?: string; /** « Quand je touche le widget » (lot 25b) ; absent : ouvrir son appli. */ toucher?: Toucher; /** L'appareil, la pièce ou le capteur choisi (« appareil:<id> », « piece:<nom> ») : famille « maison », nettoyé par sa sorte. */ cible?: string }
/**
 * Une page de la fenêtre. `code` : une page rangée sous un code (« aujourdhui », lot 26) ; son nom n'est alors pas dans
 * la donnée (vide), l'interface l'écrit dans sa langue — sauf si le propriétaire l'a renommée. Elle peut être marquée
 * « Écran de la maison », comme une autre page (validé le 24/11) : seuls ses widgets ordinaires y vont, jamais ceux de
 * l'accueil du propriétaire, et l'écran de la maison ne reçoit ni son code ni son nom (pagesMaisonPermises).
 */
export interface FPage { id: string; name: string; code?: CodePage; maison?: boolean; widgets: Widget[] }
/**
 * La fenêtre. `accueil` : la dernière livraison de l'accueil du propriétaire qu'elle a reçue (lot 27 : 2, puis 3 avec les
 * cinq chiffres, puis 4 avec les quatre tuiles d'état ; absent : au plus celle du lot 26). La page le renvoie tel quel quand elle range ; rien d'autre n'en dépend.
 */
export interface Layout { pages: FPage[]; accueil?: number }
/** La grille de la maquette : 12 colonnes, 4 au téléphone, 7 lignes au plus. */
export const GRILLE = { colonnes: 12, colonnesTel: 4, lignesMax: 7 } as const;
/** Pages au plus, sans compter une page rangée sous un code (« Aujourd'hui » s'ajoute aux pages du propriétaire). */
export const PAGES_MAX = 8;
/** Le nom d'une page rangée sous un code, pour les phrases d'Odin (l'écran a son propre dictionnaire). */
const NOMS_PAGES: Record<CodePage, string> = { aujourdhui: 'Aujourd\'hui' };
/** Le nom à dire d'une page : celui que le propriétaire lui a donné, sinon celui de son code. */
export const nomPage = (p: Pick<FPage, 'name' | 'code'>): string => p.name || (p.code ? NOMS_PAGES[p.code] : '');
/** Modules par page, au plus (24 avant la grille ; l'écran « maison » de départ de la maquette en a 31). */
export const MODULES_PAR_PAGE = 48;
/** Par sorte de module : sa plus petite taille [colonnes, lignes] et sa hauteur de départ. */
export const TAILLE_SORTE = Object.fromEntries(sortesPosables().map((x) => [x.id, { mini: [x.taille.mini[0], x.taille.mini[1]], r: x.taille.r }])) as Record<WidgetKind, { mini: [number, number]; r: number }>;
/** La seule table des tailles en mots (petit, moyen, grand, toute la largeur) : des colonnes sur 12. */
export const TAILLES_MOTS = { petit: 3, moyen: 6, grand: 9, plein: 12 } as const;
/** L'ancienne largeur (1, 2 ou 3 colonnes) d'une largeur sur 12 : même proportion. */
export const largeurAncienne = (c: number): 1 | 2 | 3 => (c <= 4 ? 1 : c <= 8 ? 2 : 3);
/** Ce que l'écran reçoit de la taille d'un module. */
export const tailleDe = (w: Widget) => ({ w: w.w, c: w.c, r: w.r, ...(w.pc === undefined ? {} : { pc: w.pc }), ...(w.pr === undefined ? {} : { pr: w.pr }) });

// ---------------- L'écran de la maison : sa grille (le modèle ; l'écran ne le lit pas encore) ----------------
/**
 * Une commande d'une carte de l'écran de la maison : un code (les mots sont dans l'écran, dans sa langue), les ordres
 * envoyés tels quels (`POST /api/maison/appareil` ou `/scene`), et pour un curseur ses bornes et la forme de l'ordre
 * (`{n}` : le nombre choisi) — jamais une valeur de départ. `accord` : Odin demande toujours l'accord avant cet ordre ;
 * absent, le serveur décide quand même à chaque ordre (une scène, un garage, un portail : midgard.ts, sensitive).
 */
export interface CommandeMaison {
  code: string; ordres: readonly string[]; nombre?: { min?: number; max?: number; pas?: number; ordre: string }; geste?: 'glisser'; accord?: true;
  /** Une action d'une appli d'Odin (`POST /api/valhalla/act`) au lieu d'un ordre ; `saisie` : le champ que l'on tape. */
  acte?: { module: string; action: string; saisie?: string };
}
/** Les commandes de la carte météo pour qui a tous les droits : changer le lieu d'Odin (maison.js, lieuBar). */
const COMMANDES_METEO_COMPLET: readonly CommandeMaison[] = [
  { code: 'lieu', ordres: [], acte: { module: 'gladsheim', action: 'lieu', saisie: 'ville' } },
  { code: 'me_localiser', ordres: [], acte: { module: 'gladsheim', action: 'lieu_position' } },
];
const INTERRUPTEUR: CommandeMaison = { code: 'interrupteur', ordres: ['on', 'off'] };
/**
 * Les commandes d'une carte d'appareil, par sorte d'appareil (celles du pont, midgard.ts) : exactement celles de
 * l'écran d'aujourd'hui (maison.js, devCard ; constat G3). Un capteur, un détecteur : aucune.
 */
export const COMMANDES_APPAREIL: Readonly<Record<string, readonly CommandeMaison[]>> = {
  'lumière': [INTERRUPTEUR, { code: 'intensite', ordres: [], nombre: { min: 1, max: 100, ordre: '{n} %' } }],
  prise: [INTERRUPTEUR], ventilateur: [INTERRUPTEUR],
  volet: [{ code: 'monter', ordres: ['ouvre'] }, { code: 'arreter', ordres: ['stop'] }, { code: 'descendre', ordres: ['ferme'] }],
  clim: [{ code: 'consigne', ordres: [], nombre: { pas: 1, ordre: '{n}' } }, { code: 'marche_arret', ordres: ['on', 'off'] }],
  lecteur: [{ code: 'precedent', ordres: ['precedent'] }, { code: 'lecture_pause', ordres: ['lecture', 'pause'] }, { code: 'suivant', ordres: ['suivant'] }],
  aspirateur: [{ code: 'nettoyer', ordres: ['on'] }, { code: 'base', ordres: ['off'] }],
  serrure: [{ code: 'ouvrir', ordres: ['deverrouille'], geste: 'glisser', accord: true }, { code: 'verrouiller', ordres: ['verrouille'] }],
};
/** Les sortes d'appareil dont la carte d'aujourd'hui est large (deux colonnes de l'ancienne grille). */
const APPAREILS_LARGES: readonly string[] = ['serrure', 'lecteur'];
/** Une carte de l'écran de départ de la maison, posée dans la grille. */
export interface CarteMaison {
  id: string; carte: 'meteo' | 'heure' | 'scenes' | 'appareil' | 'nouvelles'; c: number; r: number;
  /** Où partent ses ordres : `/api/maison/appareil` ou `/api/maison/scene`. */
  route?: 'appareil' | 'scene'; appareil?: string; piece?: string; commandes: CommandeMaison[];
}
/** Ce que le modèle lit : l'état que la page de l'écran de la maison reçoit (`/api/maison/etat`), pour ce public. */
export interface EtatPourGrille { rights?: unknown; weather?: unknown; scenes?: unknown; notices?: unknown; rooms?: unknown; fenetre?: unknown }
/** Ce que la grille de l'écran de la maison contient : la grille, l'écran de départ, puis ses pages de la fenêtre. */
export interface GrilleMaison { grille: typeof GRILLE; depart: CarteMaison[]; pages: Array<{ id: string; name: string; widgets: Array<{ id: string; kind: string } & Record<string, unknown>> }> }
/**
 * La grille de l'écran de la maison, la même que l'accueil (GRILLE). L'écran de départ est CALCULÉ d'après ce qui
 * existe chez lui, dans l'ordre de l'écran d'aujourd'hui : la météo (si elle a été lue), l'heure (l'horloge d'Odin),
 * ses scènes (s'il en a), un widget par appareil (avec sa pièce et toutes ses commandes), les dernières nouvelles (s'il
 * y en a). Aucun widget sans source : rien d'inventé, ni appareil, ni scène, ni pièce. Les pages de la fenêtre marquées
 * « écran de la maison » suivent, chacune réduite aux sortes que la règle admet (admiseALaMaison). Lu dans l'état reçu
 * par ce public : il n'y a jamais plus que ce qu'il reçoit déjà. Pur ; une donnée abîmée ne fait rien planter.
 */
export function grilleMaison(e: EtatPourGrille): GrilleMaison {
  const liste = (x: unknown): unknown[] => (Array.isArray(x) ? x : []);
  const objet = (x: unknown): Record<string, unknown> | undefined => (x && typeof x === 'object' && !Array.isArray(x) ? x as Record<string, unknown> : undefined);
  const colonnes = (large: boolean) => (large ? 2 : 1) * (GRILLE.colonnes / 3);
  const depart: CarteMaison[] = [];
  // La météo : « Changer de lieu » et « Me localiser » seulement pour qui a tous les droits, comme l'écran d'aujourd'hui.
  if (objet(e.weather)) depart.push({ id: 'meteo', carte: 'meteo', c: colonnes(false), r: TAILLE_SORTE.meteo.r, commandes: e.rights === 'complet' ? COMMANDES_METEO_COMPLET.map((x) => ({ ...x, acte: { ...x.acte! } })) : [] });
  depart.push({ id: 'heure', carte: 'heure', c: colonnes(false), r: TAILLE_SORTE.heure.r, commandes: [] });
  const scenes = liste(e.scenes).filter((x): x is string => typeof x === 'string' && x !== '');
  if (scenes.length) depart.push({ id: 'scenes', carte: 'scenes', c: colonnes(true), r: TAILLE_SORTE.bouton.r, route: 'scene', commandes: [{ code: 'lancer', ordres: scenes }] });
  const vus = new Set<string>();
  for (const p of liste(e.rooms).map(objet)) {
    if (!p || typeof p.name !== 'string') continue;
    for (const d of liste(p.devices).map(objet)) {
      if (!d || typeof d.id !== 'string' || !d.id || vus.has(d.id)) continue;
      vus.add(d.id);
      const kind = typeof d.kind === 'string' ? d.kind : '';
      depart.push({ id: `appareil:${d.id}`, carte: 'appareil', c: colonnes(APPAREILS_LARGES.includes(kind)), r: TAILLE_SORTE.bouton.r, route: 'appareil', appareil: d.id, piece: p.name,
        commandes: Object.hasOwn(COMMANDES_APPAREIL, kind) ? COMMANDES_APPAREIL[kind].map((x) => ({ ...x })) : [] });
    }
  }
  if (liste(e.notices).length) depart.push({ id: 'nouvelles', carte: 'nouvelles', c: colonnes(true), r: TAILLE_SORTE.meteo.r, commandes: [] });
  const pages: GrilleMaison['pages'] = [];
  for (const p of liste(e.fenetre).map(objet)) {
    if (!p || typeof p.id !== 'string') continue;
    const widgets = liste(p.widgets).map(objet).filter((w): w is { id: string; kind: string } & Record<string, unknown> => Boolean(w) && typeof w!.id === 'string' && admiseALaMaison(w!.kind));
    pages.push({ id: p.id, name: typeof p.name === 'string' ? p.name : '', widgets: widgets.map((w) => ({ ...w })) });
  }
  return { grille: GRILLE, depart, pages };
}
/** La taille d'un module envoyé par l'interface, nettoyée : des entiers dans la grille, rien d'inventé pour le téléphone. Pur. */
function tailleNette(o: Record<string, unknown>, kind: WidgetKind): Pick<Widget, 'w' | 'c' | 'r' | 'pc' | 'pr'> {
  const entier = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) ? v : undefined), borne = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
  const t = TAILLE_SORTE[kind], ancien = [1, 2, 3].includes(Number(o.w)) ? Number(o.w) : undefined;
  let c = entier(o.c); if (c !== undefined) c = borne(c, t.mini[0], GRILLE.colonnes);
  // Pas de largeur sur 12, ou une largeur périmée (l'écran d'aujourd'hui n'a changé que `w`) : elle suit `w`.
  if (c === undefined || (ancien !== undefined && largeurAncienne(c) !== ancien)) c = (ancien ?? 1) * 4;
  const r = entier(o.r), pc = entier(o.pc), pr = entier(o.pr);
  return { w: largeurAncienne(c), c, r: r === undefined ? t.r : borne(r, t.mini[1], GRILLE.lignesMax),
    ...(pc === undefined ? {} : { pc: borne(pc, 2, GRILLE.colonnesTel) }), ...(pr === undefined ? {} : { pr: borne(pr, t.mini[1], GRILLE.lignesMax) }) };
}
const wid = () => randomBytes(4).toString('hex');
/** La page « Aujourd'hui » de départ : les cinq chiffres en tête (lot 27), « Tu veux sans doute », « À faire », « Ce qu'Odin a fait » (lot 26), « Comment Odin se comporte », puis les quatre tuiles d'état (lot 27). */
const pageAujourdhui = (): FPage => ({ id: PAGE_AUJOURDHUI.id, name: '', code: PAGE_AUJOURDHUI.code,
  widgets: PAGE_AUJOURDHUI.widgets.map((x) => ({ id: x.id, kind: x.kind, ...tailleNette({ c: x.c }, x.kind) })) });
/** La fenêtre porte-t-elle « À faire » (sur n'importe quelle page) ? */
const porteAFaire = (l: Layout) => l.pages.some((p) => p.widgets.some((w) => w.kind === 'a_faire'));
/** Un identifiant libre : celui demandé, sinon le suivant qui n'est pas pris (toujours le même pour la même fenêtre). */
function idLibre(id: string, pris: Set<string>): string {
  let n = parseInt(id, 16), x = id;
  while (pris.has(x)) { n = (n + 0x10) >>> 0; x = n.toString(16).padStart(8, '0'); }
  pris.add(x); return x;
}
/**
 * Une fenêtre rangée avant le lot 26 reçoit la page « Aujourd'hui », en premier, sans rien déplacer du reste — une
 * seule fois : « À faire » ne se retire pas, une fenêtre qui le porte l'a donc déjà reçue (même si les deux autres
 * widgets en ont été retirés depuis, ou « À faire » déplacé sur une autre page).
 * Une fenêtre sans « À faire » qui porte déjà quelque chose du jour (une donnée abîmée, ou rangée à la main) ne perd
 * rien et ne reçoit rien en double : seuls les blocs qui manquent arrivent ; s'il y a déjà une page sous le code, ils
 * y sont posés en tête, et la page garde sa place, son nom et ses widgets ; un identifiant déjà pris n'est pas repris.
 * Pur.
 *
 * Lot 27 : « Comment Odin se comporte », puis les cinq chiffres, arrivent de la même manière, une seule fois chacun
 * (`depuis` dans PAGE_AUJOURDHUI). Eux se retirent : la marque « déjà reçu » est donc écrite dans la fenêtre
 * (`accueil`), que la page renvoie quand elle range. Une fenêtre qui porte déjà « À faire » le reçoit À LA FIN de la
 * page « Aujourd'hui » (sinon de la page qui porte « À faire », sinon de la première page ordinaire qui a de la
 * place, sinon d'une page « Écran de la maison », où il n'est servi à personne d'autre) : rien n'est déplacé, et il
 * était déjà sous la fenêtre. La fenêtre rendue porte la marque dès qu'il est arrivé ; s'il n'y a de place nulle part,
 * elle est rendue telle quelle, SANS la marque (il arrivera quand une place se libère : la marque dit « reçu », pas
 * « essayé ») ; une fenêtre qui l'a déjà est rendue telle quelle.
 * Ils arrivent un à un, dans l'ordre des livraisons, chacun sur la première page qui a encore une place : une seule
 * place libre suffit au premier. La marque dit alors la dernière livraison reçue EN ENTIER (2 si « Comment Odin se
 * comporte » est arrivé et pas les chiffres) : le suivant arrivera quand une autre place se libère.
 * Les cinq chiffres (`tete` dans PAGE_AUJOURDHUI, choix du propriétaire, comme la maquette) arrivent EN TÊTE de la page
 * choisie, par la même règle : ce qui y était descend d'une rangée, dans le même ordre ; « Comment Odin se comporte »
 * garde sa place, à la fin.
 * Les quatre tuiles d'état (Surveillance, Sauvegarde, Résumé du matin, Application) sont une même livraison (4) : elles
 * arrivent à la fin, dans cet ordre, chacune sur la première page qui a encore une place. Une livraison arrive en entier
 * ou pas du tout : s'il n'y a de place que pour une partie d'entre elles, aucune n'arrive et la marque reste 3 (elles
 * arriveront ensemble quand il y aura assez de place) ; une tuile arrivée puis retirée ne revient donc jamais. Celles
 * que la fenêtre porte déjà (reposées à la main) ne sont pas reposées en double.
 */
export function avecAujourdhui(l: Layout): Layout {
  const recu = l.accueil ?? 1, sansAFaire = !porteAFaire(l);
  if (!sansAFaire && recu >= ACCUEIL_RECU) return l;
  const portees = new Set<string>(l.pages.flatMap((p) => p.widgets.map((w) => w.kind))), pris = new Set(l.pages.flatMap((p) => p.widgets.map((w) => w.id)));
  // Ce que la fenêtre n'a pas encore reçu, et qu'elle ne porte pas déjà, dans l'ordre de la page de départ : en tête ceux
  // du lot 26 et ceux marqués `tete`, à la fin les autres.
  const depuis = new Map<string, number>(PAGE_AUJOURDHUI.widgets.map((x) => [x.kind, x.depuis]));
  const enTete = new Set<string>(PAGE_AUJOURDHUI.widgets.filter((x) => 'tete' in x && x.tete).map((x) => x.kind));
  const dus = pageAujourdhui().widgets.filter((w) => (depuis.get(w.kind)! <= 1 ? sansAFaire : recu < depuis.get(w.kind)!) && !portees.has(w.kind));
  const manquants = dus.map((w) => ({ ...w, id: idLibre(w.id, pris) }));
  const tete = manquants.filter((w) => depuis.get(w.kind)! <= 1 || enTete.has(w.kind)), fin = manquants.filter((w) => !tete.includes(w));
  const i = l.pages.findIndex((p) => p.code === PAGE_AUJOURDHUI.code), rendue = { ...l, accueil: ACCUEIL_RECU };
  const poses = (j: number, avant: Widget[], apres: Widget[]) => l.pages.map((p, k) => (k === j ? { ...p, widgets: [...avant, ...p.widgets, ...apres] } : p));
  if (sansAFaire) {
    if (i >= 0) return { ...rendue, pages: poses(i, tete, fin) };
    return { ...rendue, pages: [{ ...pageAujourdhui(), id: idLibre(PAGE_AUJOURDHUI.id, new Set(l.pages.map((p) => p.id))), widgets: manquants }, ...l.pages] };
  }
  // Les livraisons d'après le lot 26, dans l'ordre où elles sont venues (la marque en dépend), quelle que soit leur place.
  const tardifs = manquants.filter((w) => depuis.get(w.kind)! > 1).sort((a, b) => depuis.get(a.kind)! - depuis.get(b.kind)!);
  if (!tardifs.length) return rendue;
  const aFaire = l.pages.findIndex((p) => p.widgets.some((w) => w.kind === 'a_faire'));
  const rangs = l.pages.map((_, k) => k), ordinaires = rangs.filter((k) => !l.pages[k].maison), maison = rangs.filter((k) => l.pages[k].maison);
  let pages = l.pages, marque = ACCUEIL_RECU;
  // Une livraison arrive EN ENTIER ou pas du tout : si une partie seulement arrivait, la marque resterait à la livraison
  // d'avant, et un widget arrivé puis retiré reviendrait à la lecture suivante.
  for (const d of [...new Set(tardifs.map((w) => depuis.get(w.kind)!))]) {
    let essai = pages;
    for (const w of tardifs.filter((x) => depuis.get(x.kind) === d)) {
      const j = [i, aFaire, ...ordinaires, ...maison].find((k) => k >= 0 && essai[k].widgets.length < MODULES_PAR_PAGE);
      if (j === undefined) { essai = pages; break; }
      essai = essai.map((p, k) => (k === j ? { ...p, widgets: enTete.has(w.kind) ? [w, ...p.widgets] : [...p.widgets, w] } : p));
    }
    // Plus assez de place : ni elle ni les suivantes n'arrivent ; la marque s'arrête à la livraison d'avant.
    if (essai === pages) { marque = d - 1; break; }
    pages = essai;
  }
  return pages === l.pages ? l : { ...l, pages, accueil: marque };
}
/** La fenêtre de départ : ce qui compte le plus, avec les applis présentes. */
export function defaultLayout(ids: string[]): Layout {
  const has = (m: string) => ids.includes(m), w = (kind: WidgetKind, module?: string, size: 1 | 2 | 3 = 1): Widget => ({ id: wid(), kind, ...tailleNette({ w: size }, kind), ...(module ? { module } : {}) });
  const maison: Widget[] = [w('heure'), w('meteo'), ...['midgard', 'himinbjorg'].filter(has).map((m) => w('chiffres', m))];
  const reseau: Widget[] = ['vidarr', 'ran', 'vordr'].filter(has).map((m) => w('chiffres', m, m === 'ran' ? 2 : 1));
  const secu: Widget[] = ['ullr', 'garmr', 'eir'].filter(has).map((m) => w('chiffres', m));
  const mach: Widget[] = ['ymir', 'naglfar'].filter(has).map((m) => w('chiffres', m));
  return { pages: [pageAujourdhui(), ...[{ id: wid(), name: 'Maison', maison: true, widgets: maison }, { id: wid(), name: 'Réseau', widgets: reseau }, { id: wid(), name: 'Sécurité', widgets: secu }, { id: wid(), name: 'Machines', widgets: mach }].filter((p) => p.widgets.length)], accueil: ACCUEIL_RECU };
}
/** Une fenêtre envoyée par l'interface, nettoyée : rien d'inconnu, rien de trop long, pas d'appli inventée. Pur. */
export function cleanLayout(raw: unknown, ids: string[]): Layout {
  const r = (raw && typeof raw === 'object' ? raw : {}) as { pages?: unknown; accueil?: unknown };
  const str = (v: unknown, n: number) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, n);
  const pages: FPage[] = [], codes = new Set<string>(), seules = new Set<string>();
  let ordinaires = 0;
  for (const p of (Array.isArray(r.pages) ? r.pages : []).slice(0, PAGES_MAX * 4)) {
    const pp = (p ?? {}) as Record<string, unknown>, widgets: Widget[] = [];
    // Une page rangée sous un code connu (une seule par code) : elle ne compte pas dans les pages du propriétaire, et
    // ne porte un nom que s'il lui en a donné un. Les autres : PAGES_MAX au plus, toujours nommées.
    const code = CODES_PAGES.find((c) => c === pp.code && !codes.has(c));
    if (code) codes.add(code); else if (ordinaires >= PAGES_MAX) continue; else ordinaires++;
    const name = str(pp.name, 24) || (code ? '' : `Page ${pages.length + 1}`);
    for (const x of (Array.isArray(pp.widgets) ? pp.widgets : []).slice(0, MODULES_PAR_PAGE)) {
      const o = (x ?? {}) as Record<string, unknown>, sorte = sorteDe(o.kind);
      // Une sorte inconnue, ou déclarée mais pas encore posable (l'écran ne sait pas la dessiner) : jetée.
      if (!sorte?.posable) continue;
      const kind = sorte.id as WidgetKind, module = str(o.module, 40);
      // Une sorte qui lit l'appli choisie a besoin d'une appli présente ; les autres (heure, météo) n'en gardent aucune.
      const libre = sorte.applis !== 'choisie';
      if (!libre && !ids.includes(module)) continue;
      // Les sortes de l'accueil du propriétaire (« À faire »…) : une seule de chaque dans toute la fenêtre.
      if (sorte.accueilSeul) { if (seules.has(kind)) continue; seules.add(kind); }
      const out: Widget = { id: /^[0-9a-f]{8}$/.test(String(o.id)) ? String(o.id) : wid(), kind, ...tailleNette(o, kind), ...(libre ? {} : { module }) };
      // Les réglages propres à la sorte (partie de page, action, libellé…), nettoyés par son fichier de famille.
      if (sorte.nettoyer && !sorte.nettoyer(o, out, { str })) continue;
      // Un style, seulement s'il est l'un de ceux de la sorte et pas celui de départ (rien d'écrit sinon).
      const style = str(o.style, 24); if (style && style !== sorte.styles[0] && sorte.styles.includes(style)) out.style = style;
      // « Quand je touche le widget » (lot 25b) : une action de SON appli, un écran connu, une adresse http(s) nettoyée,
      // ou rien. Tout le reste est jeté (le widget ouvre alors son appli, comme avant).
      const toucher = toucherNet(o.toucher, sorte, out, { str }); if (toucher) out.toucher = toucher;
      widgets.push(out);
    }
    pages.push({ id: /^[0-9a-f]{8}$/.test(String(pp.id)) ? String(pp.id) : wid(), name, ...(code ? { code } : {}), ...(pp.maison ? { maison: true } : {}), widgets });
  }
  if (!pages.length) throw new Error('la fenêtre doit garder au moins une page');
  // La marque « livraison de l'accueil déjà reçue » (lot 27) : un entier connu, sinon rien (la fenêtre la recevra).
  const accueil = typeof r.accueil === 'number' && Number.isInteger(r.accueil) && r.accueil >= 2 ? Math.min(r.accueil, ACCUEIL_RECU) : undefined;
  return { pages, ...(accueil === undefined ? {} : { accueil }) };
}

/**
 * Les 12 animations de déplacement des modules de la fenêtre (maquette validée « Accueil », lot 17) : les mêmes
 * identifiants que src/web/pages/accueil-animations.js. Le choix est gardé ici, le même sur tous les appareils du
 * propriétaire ; un choix inconnu (un vieux réglage, un réglage abîmé) vaut « classique ».
 */
export const ANIMATIONS = ['classique', 'glace', 'miroir', 'ressort', 'aimant', 'flottant', 'fondu', 'domino', 'vague', 'zoom', 'elastique', 'cascade'] as const;
export type Animation = typeof ANIMATIONS[number];
export const animationDe = (v: unknown): Animation => (typeof v === 'string' && (ANIMATIONS as readonly string[]).includes(v) ? v as Animation : 'classique');
/**
 * « Quand je touche le widget » (lot 25b), pour une personne connectée qui n'est pas le propriétaire : ce réglage ne lui
 * est servi que sur un widget qu'elle peut voir (son droit sur chaque appli lue ; la vie privée seulement si le
 * propriétaire le lui a ouvert) — sinon l'adresse à ouvrir, l'action et ses réglages lui arriveraient quand même. Et,
 * comme pour le bouton sur mesure : jamais une action grave, « propriétaire seul » ou introuvable. Ce qu'on n'a pas
 * pu vérifier : non.
 */
function toucherPermisA(ctx: ModCtx, login: string): (w: Widget) => boolean {
  const l = lecteurDe(ctx, login), v = valhallaOf();
  if (!l || !v) return () => false;
  const src = { appli: (id: string) => { const m = v.module(id); return m && m.id === id && v.estActive(m.id) ? { id: m.id, name: m.name, family: m.family } : undefined; } };
  return (w) => {
    if (droitDeVoir(w, l, src)) return false;
    const t = w.toucher; if (t?.quoi !== 'action') return true;
    const f = w.module ? v.action(w.module, t.action) : undefined; if (!f || f.m.id !== w.module) return false;
    const c = v.ctx(f.m.id), input = t.input ?? {};
    return !f.a.grave?.(input, c) && !(typeof f.a.proprietaireSeul === 'function' ? f.a.proprietaireSeul(input, c) : f.a.proprietaireSeul === true);
  };
}
/** La fenêtre rendue à la page : avec l'animation choisie, seulement si elle a été choisie (sinon rien ne change). */
/**
 * LA fenêtre du propriétaire, pour tous ceux qui la lisent : celle qu'il a rangée (avec la page « Aujourd'hui » si elle
 * date d'avant le lot 26), sinon celle de départ.
 */
export function fenetreRangee(ctx: Pick<ModCtx, 'settings' | 'modules'>): Layout {
  const ids = ctx.modules().map((m) => m.id);
  return ctx.settings.fenetre ? avecAujourdhui(cleanLayout(ctx.settings.fenetre, ids)) : defaultLayout(ids);
}
/**
 * La fenêtre servie à un autre que le propriétaire : sans les sortes de son accueil (« À faire », « Ce qu'Odin a
 * fait », « Tu veux sans doute »… : ses validations, constat G4), et sans une page sous un code qu'elles laissent
 * vide. Il reste toujours une page : s'il n'y avait que celle-là, une page ordinaire, vide, qui ne dit rien d'elle. Pur.
 */
export function sansAccueilDuProprietaire<L extends Layout>(l: L): L {
  const pages = l.pages.map((p) => ({ ...p, widgets: p.widgets.filter((w) => !accueilSeulement(w.kind)) })), gardees = pages.filter((p) => !p.code || p.widgets.length);
  // Il ne reste que la page sous le code, vide : une page ordinaire à sa place (ni son code, ni son identifiant, ni son nom).
  // La marque de ce que l'accueil du propriétaire a reçu ne lui est pas dite non plus.
  const { accueil: _accueil, ...reste } = l;
  return { ...reste, pages: gardees.length ? gardees : [{ id: '00000000', name: 'Page 1', widgets: [] }] } as L;
}
const avecAnimation = (ctx: ModCtx, l: Layout): Layout & { animation?: Animation } => (ctx.settings.animation === undefined ? l : { ...l, animation: animationDe(ctx.settings.animation) });

export const gladsheim: Module = {
  id: 'gladsheim', name: 'Hestia', family: 'Maison',
  what: 'La maison en un écran, pour tablette murale, téléphone, ordinateur et Home Assistant : appareils, scènes, météo, état de toutes tes applis, tes boutons, onze thèmes, et la mascotte qui joue et obéit.',
  does: ['écran plein format à onze thèmes (verre, bleu nuit, braise, acier, tablette murale, crépuscule, classique, violet, aurore, lagon, clair)', 'pièces et appareils de toutes tes box (Midgard) : lumières (intensité), volets, clim (+/−), serrures (glisser pour ouvrir, avec ton accord), lecteurs', 'scènes d\'un geste', 'météo du lieu choisi (heure par heure, 7 jours, lever et coucher du soleil)', 'l\'état de toutes tes applis (alertes, chiffres clés), un clic pour ouvrir', 'tes boutons vers n\'importe quelle action d\'une appli : bloquer quelqu\'un, VPN, accès réseau, informations, mises à jour…', 'la mascotte se promène, joue à la balle, donne la météo, l\'heure, les alertes, et fait ce que tu lui dis (mêmes droits et mêmes validations que partout dans Odin)', 'clés de tablette (lien à poser sur une tablette ou dans Home Assistant), droits « maison » ou « complet », retirables', 'dans Home Assistant : un tableau de bord « page web » prêt à coller'],
  from: ['Home Assistant', 'Mushroom', 'Bubble Card', 'Homepage', 'Dashy', 'Homarr'], upstream: ['home-assistant/frontend', 'piitaya/lovelace-mushroom', 'gethomepage/homepage', 'Lissy93/dashy', 'homarr-labs/homarr'],
  words: ['glaðsheimr', 'gladsheim', 'écran de la maison', 'tablette murale', 'tableau de la maison', 'thème de la maison', 'bouton de la maison', 'météo', 'quel temps', 'température dehors', 'fait-il dehors'],
  actions: [
    { id: 'ouvrir', label: 'Ouvrir l\'écran de la maison', what: 'L\'adresse de l\'écran plein format', read: true, words: ['écran de la maison', 'ouvre l\'écran de la maison'], run: () => ({ text: '🏠 L\'écran de la maison : /maison sur l\'adresse d\'Odin (garde-le en favori, ou « Ajouter à l\'écran d\'accueil » sur la tablette).', data: { url: '/maison' } }) },
    { id: 'theme', label: 'Thème', what: 'Le thème de l\'écran de la maison', params: [{ key: 'theme', label: 'Thème', kind: 'select', options: Object.keys(THEMES_MAISON), required: true }], words: ['change le thème de l\'écran', 'change le thème'], run: (ctx, i) => { const t = s(i.theme); if (!Object.hasOwn(THEMES_MAISON, t)) throw new Error(`thèmes : ${Object.keys(THEMES_MAISON).join(', ')}`); ctx.saveSettings({ theme: t }); return { text: `🎨 Thème « ${THEMES_MAISON[t].label} ».` }; } },
    { id: 'fenetre', label: 'Ma fenêtre', what: 'Les pages de modules de la fenêtre d\'Odin (ordinateur, téléphone, écran de la maison)', read: true, quiet: true, words: ['ma fenêtre', 'tableau de bord'], run: (ctx) => {
      // À un autre que le propriétaire : jamais les widgets de son accueil (lot 26), et « Quand je touche » seulement
      // sur les widgets qu'il peut voir (lot 25b).
      const qui = agissant(), l = qui ? toucherServi(sansAccueilDuProprietaire(fenetreRangee(ctx)), toucherPermisA(ctx, qui.login)) : fenetreRangee(ctx);
      return { text: l.pages.map((p) => `- ${nomPage(p)}${p.maison ? ' (écran de la maison)' : ''} : ${p.widgets.length} module(s)`).join('\n'), data: avecAnimation(ctx, l) };
    } },
    { id: 'regler_fenetre', label: 'Ranger ma fenêtre', what: 'Enregistre les pages et les modules (mode « Modifier »)', quick: false, proprietaireSeul: true, params: [{ key: 'fenetre', label: 'Fenêtre (JSON)', kind: 'textarea', required: true }], run: (ctx, i) => {
      let raw: unknown; try { raw = typeof i.fenetre === 'string' ? JSON.parse(i.fenetre) : i.fenetre; } catch { throw new Error('fenêtre illisible'); }
      // Avec la fenêtre : les ouvertures de la vie privée des widgets qui existent encore, lisent encore cette appli et
      // montrent encore la même chose qu'avant ce rangement.
      // « Régler » (lot 25b) : une adresse à ouvrir au toucher qui n'est pas une adresse web sûre est refusée, et dite.
      const refusees = adressesRefusees(raw);
      if (refusees.length) throw new Error(`adresse refusée : « ${refusees[0]} ». Une adresse à ouvrir commence par http:// ou https://, sans identifiant ni mot de passe dedans, ${ADRESSE_MAX} signes au plus.`);
      const ids = ctx.modules().map((m) => m.id), l = cleanLayout(raw, ids), avant = ctx.settings.fenetre ? cleanLayout(ctx.settings.fenetre, ids) : undefined;
      // « À faire » se déplace mais ne se retire pas (constat M11) : une fenêtre rangée qui le portait le garde. Une
      // fenêtre qui ne l'a encore jamais porté (rangée avant le lot 26, ou envoyée par une page ouverte avant) n'est
      // pas refusée : elle reçoit la page « Aujourd'hui » à la lecture (fenetreRangee), et la rend ici.
      if (retraitRefuse(avant, l)) throw new Error('« À faire » se déplace mais ne se retire pas : garde-le sur une de tes pages.');
      ctx.saveSettings({ fenetre: l, ...(ctx.settings.ouvertures === undefined ? {} : { ouvertures: ouverturesGardees(ctx, l, avant) }) });
      const rendue = avecAujourdhui(l);
      return { text: `✓ Fenêtre rangée : ${rendue.pages.map((p) => `${nomPage(p)} (${p.widgets.length})`).join(', ')}.`, data: avecAnimation(ctx, rendue) };
    } },
    { id: 'regler_animation', label: 'Animation des modules', what: 'L\'animation qui joue quand tu déplaces ou agrandis un module de ta fenêtre (la même sur tous tes appareils)', quick: false, proprietaireSeul: true,
      params: [{ key: 'animation', label: 'Animation', kind: 'select', options: [...ANIMATIONS], required: true }], run: (ctx, i) => {
        const a = s(i.animation).trim();
        if (!(ANIMATIONS as readonly string[]).includes(a)) throw new Error(`animations : ${ANIMATIONS.join(', ')}`);
        ctx.saveSettings({ animation: a });
        return { text: `✓ Animation des modules : ${a}.`, data: { animation: a } };
      } },
    // La vie privée, widget par widget et personne par personne (sa question 15, réponse b) : ouvrir ou refermer un
    // widget à une personne, la liste, et « qui a fait quoi ». Tout est dans src/valhalla/widgets/ouvertures.ts.
    ...actionsOuvertures((ctx) => fenetreRangee(ctx), (ctx, id) => ctx.modules().find((m) => m.id === id)?.name ?? id),
    { id: 'meteo', label: 'Météo', what: 'Le temps qu\'il fait là où est Odin, ou dans une autre ville si tu la nommes (sans changer le lieu d\'Odin)', read: true, params: [{ key: 'ville', label: 'Autre ville (vide : là où est Odin)', kind: 'text', default: '' }], words: ['météo de la maison', 'la météo', 'quel temps fait-il', 'météo', 'meteo', 'température dehors', 'quelle température fait-il', 'temps qu\'il fait', 'quel temps', 'quel temps fera demain'], run: async (ctx, i) => {
      // Une autre ville : la météo de là-bas, sans changer le lieu d'Odin (pour le changer : l'action « lieu »).
      const v = s(i.ville).trim(), ici = sansAccent(v) === sansAccent(s(ctx.settings.villeNom) || s(ctx.settings.ville) || LIEU_PAR_DEFAUT);
      if (v && !ici) { const g = (await trouverLieux(ctx, v))[0]; if (!g) throw new Error(`je ne trouve pas « ${v} » : vérifie l'orthographe, ou précise le pays (« ${v}, France »)`); return { text: weatherText(await previsions(ctx, g.lat, g.lon, g.nom)), data: { ailleurs: true } }; }
      const w = await weather(ctx); return { text: `${weatherText(w)}${w?.days[1] ? ` Demain : ${wword(w.days[1].code).toLowerCase()}, ${degres(w.days[1].lo, w.unites)} à ${degres(w.days[1].hi, w.unites)}.` : ''}${!s(ctx.settings.ville) ? ` (Lieu par défaut : ${LIEU_PAR_DEFAUT}. Pour le changer : « ma ville est … ».)` : ctx.settings.suppose === true ? ` (Je me crois à ${s(ctx.settings.villeNom) || s(ctx.settings.ville)} d'après l'horloge de la machine. Si ce n'est pas ça : « ma ville est … ».)` : ''}`, data: w };
    } },
    { id: 'lieu', label: 'Changer de lieu (météo)', what: 'La ville où tu es : la météo, le thème automatique et les phrases d\'Odin s\'en servent', params: [{ key: 'ville', label: 'Ville (ex. Dembéni ; « Ville, pays » si plusieurs portent ce nom)', kind: 'text', required: true }],
      words: ['ma ville est', 'change ma ville', 'change de ville', 'change le lieu de la météo', 'lieu de la météo', 'j\'habite à'],
      undo: (_i, r) => { const d = r.data as { avant?: string } | undefined; return d?.avant ? { action: 'lieu', input: { ville: d.avant }, label: `lieu remis à ${d.avant}` } : undefined; },
      run: async (ctx, i) => {
        const avant = s(ctx.settings.ville) || LIEU_PAR_DEFAUT, g = await changerLieu(ctx, s(i.ville).trim());
        const w = await weather(ctx, true), ailleurs = g.autres.filter((x) => x.region && x.region !== g.region);
        return { text: `📍 C'est noté : Odin est à ${g.nom}${g.region ? ` (${g.region})` : ''}. ${weatherText(w)}${ailleurs.length ? `\nD'autres lieux portent ce nom (${ailleurs.map((x) => x.region).slice(0, 3).join(' ; ')}) : si ce n'est pas le bon, précise « ${g.nom}, pays ».` : ''}`, data: { lieu: g, avant } };
      } },
    { id: 'lieu_position', label: 'Me localiser (position de l\'appareil)', what: 'Règle le lieu d\'Odin sur la position exacte de l\'appareil (GPS). Pour trouver le nom du village, la position est envoyée une fois à OpenStreetMap', quick: false,
      params: [{ key: 'lat', label: 'Latitude', kind: 'number', required: true }, { key: 'lon', label: 'Longitude', kind: 'number', required: true }, { key: 'precision', label: 'Précision (mètres)', kind: 'number' }],
      undo: (_i, r) => { const d = r.data as { avant?: string } | undefined; return d?.avant ? { action: 'lieu', input: { ville: d.avant }, label: `lieu remis à ${d.avant}` } : undefined; },
      run: async (ctx, i) => {
        const avant = s(ctx.settings.ville) || LIEU_PAR_DEFAUT, g = await changerPosition(ctx, Number(i.lat), Number(i.lon), i.precision === undefined || i.precision === '' ? undefined : Number(i.precision));
        const w = await weather(ctx, true), flou = g.precision !== undefined && g.precision > 1500;
        return { text: `📍 ${g.nomme ? `Tu es à ${g.nom}` : `Position gardée (${g.lat}, ${g.lon}), mais je n'ai pas pu trouver le nom du village`}${g.precision !== undefined ? ` (position à ± ${g.precision >= 1000 ? `${(g.precision / 1000).toFixed(1).replace('.', ',')} km` : `${g.precision} m`})` : ''}. ${weatherText(w)}${flou ? '\n⚠ Cet appareil donne une position approximative : si le village n\'est pas le bon, dis « ma ville est … » ou localise-toi depuis ton téléphone (GPS).' : ''}`, data: { lieu: g, avant } };
      } },
    { id: 'se_configurer', label: 'Se configurer d\'après le lieu', what: 'Odin se règle pour un lieu : la ville ou la position que tu donnes (« Paris », « New York, États-Unis », « -12.84, 45.18 »), ou, sans rien dire, là où il se trouve d\'après sa connexion Internet (son adresse publique est alors vue par un service de localisation) puis l\'horloge de la machine. Fuseau, unités, heure, devise et fêtes suivent',
      params: [{ key: 'ou', label: 'Ville, « Ville, pays » ou position « latitude, longitude » (vide : Odin cherche tout seul)', kind: 'text' }], words: ['configure-toi', 'configure toi tout seul', 'localise-toi tout seul', 'règle-toi pour'],
      undo: (_i, r) => { const d = r.data as { avant?: string } | undefined; return d?.avant ? { action: 'lieu', input: { ville: d.avant }, label: `lieu remis à ${d.avant}` } : undefined; },
      run: async (ctx, i) => {
        const avant = s(ctx.settings.ville), ou = s(i.ou).trim(), pos = /^(-?\d{1,2}(?:[.,]\d+)?)\s*[,; ]\s*(-?\d{1,3}(?:[.,]\d+)?)$/.exec(ou);
        let comment = '';
        if (pos) { const g = await changerPosition(ctx, Number(pos[1].replace(',', '.')), Number(pos[2].replace(',', '.'))); comment = g.nomme ? `position ${g.lat}, ${g.lon}` : `position ${g.lat}, ${g.lon} (nom du village introuvable)`; }
        else if (ou) { await changerLieu(ctx, ou); comment = 'lieu que tu m' + "'" + 'as donné'; }
        else {
          const g = await lieuDeLaConnexion(ctx);
          if (g) { ctx.saveSettings({ ville: g.nom, villeNom: g.nom, lat: arrondirPosition(g.lat), lon: arrondirPosition(g.lon), precisionM: '', suppose: '', ...nouveauPays(ctx, g.pays), ...(g.pays ? { pays: g.pays } : {}), ...(g.fuseau ? { fuseau: g.fuseau } : {}) }); wx = undefined; publierLieu(ctx); lieuChange?.(g); comment = 'd' + "'" + 'après ma connexion Internet : c' + "'" + 'est approximatif, dis « ma ville est … » si le village n' + "'" + 'est pas le bon'; }
          else if (supposerLieu(ctx, undefined, true)) { publierLieu(ctx); comment = 'd' + "'" + 'après l' + "'" + 'horloge de la machine, faute de réponse du service de localisation'; }
          else throw new Error('je n' + "'" + 'arrive pas à me localiser ' + accord('tout seul', 'toute seule') + ' (pas de réponse du service, et l' + "'" + 'horloge de la machine ne dit pas où je suis) : dis-moi « configure-toi pour Paris » ou « ma ville est … »');
        }
        ctx.saveSettings({ unites: '', heure: '', devise: '' }); publierLieu(ctx);
        const w = await weather(ctx, true);
        return { text: `📍 ${texteRegion(ctx)} (${comment})\n${weatherText(w)}`, data: { lieu: lieuDe(ctx), region: regionActuelle(ctx), avant: avant || undefined } };
      } },
    { id: 'region', label: 'Réglages régionaux', what: 'Régler à la main ce qui découle du lieu : pays, fuseau horaire, unités, heure sur 12 ou 24 heures, devise (« automatique » : d\'après le lieu)', quick: false,
      params: [{ key: 'pays', label: 'Pays (2 lettres : FR, YT, US… ; vide : inchangé)', kind: 'text' }, { key: 'fuseau', label: 'Fuseau horaire (ex. Europe/Paris ; vide : inchangé)', kind: 'text' },
        { key: 'unites', label: 'Unités', kind: 'select', options: ['inchangé', 'automatique', 'métriques (°C, km)', 'impériales (°F, miles)'], default: 'inchangé' },
        { key: 'heure', label: 'Heure', kind: 'select', options: ['inchangé', 'automatique', '24 heures', '12 heures'], default: 'inchangé' }, { key: 'devise', label: 'Devise (3 lettres : EUR, USD… ; « auto » : d\'après le pays ; vide : inchangé)', kind: 'text' }],
      run: (ctx, i) => {
        const patch: Record<string, unknown> = {}, pays = s(i.pays).trim().toUpperCase(), tz = s(i.fuseau).trim(), u = s(i.unites), h = s(i.heure), d = s(i.devise).trim().toUpperCase();
        if (pays) { if (!/^[A-Z]{2}$/.test(pays)) throw new Error('le pays s' + "'" + 'écrit en deux lettres (FR, YT, US…)'); patch.pays = pays; }
        if (tz) { if (!fuseauValide(tz)) throw new Error(`fuseau horaire inconnu : « ${tz} » (exemples : Europe/Paris, Indian/Mayotte, America/New_York)`); patch.fuseau = tz; }
        if (/^auto/.test(u)) patch.unites = ''; else if (/^m/.test(u)) patch.unites = 'metrique'; else if (/^imp/.test(u)) patch.unites = 'imperial';
        if (/^auto/.test(h)) patch.heure = ''; else if (/^24/.test(h)) patch.heure = '24h'; else if (/^12/.test(h)) patch.heure = '12h';
        if (d) { if (d === 'AUTO' || d === 'AUTOMATIQUE') patch.devise = ''; else if (/^[A-Z]{3}$/.test(d)) patch.devise = d; else throw new Error('la devise s' + "'" + 'écrit en trois lettres (EUR, USD…), ou « auto »'); }
        if (!Object.keys(patch).length) throw new Error('rien à changer : donne au moins un réglage');
        ctx.saveSettings(patch); wx = undefined; publierLieu(ctx);
        return { text: `✓ ${texteRegion(ctx)}`, data: { region: regionActuelle(ctx) } };
      } },
    { id: 'region_actuelle', label: 'Comment Odin est réglé pour son lieu', what: 'Le lieu d\'Odin et ce qui en découle : fuseau, unités, heure, devise, fêtes', read: true, words: ['réglages régionaux actuels', 'pour quel lieu es-tu réglé'], run: (ctx) => ({ text: `📍 ${texteRegion(ctx)}`, data: { lieu: lieuDe(ctx) ?? null, region: regionActuelle(ctx), suppose: ctx.settings.suppose === true, ville: s(ctx.settings.villeNom) || s(ctx.settings.ville) || LIEU_PAR_DEFAUT, fuseau: s(ctx.settings.fuseau) } }) },
    { id: 'lieu_actuel', label: 'Où est Odin', what: 'Le lieu réglé pour Odin (village, coordonnées, fuseau horaire)', read: true, words: ['quel lieu est réglé', 'lieu réglé pour la météo'], run: (ctx) => {
      const l = lieuDe(ctx);
      return l ? { text: `📍 Odin est à ${l.nom} (${l.lat}, ${l.lon})${l.fuseau ? `, fuseau ${l.fuseau}` : ''}${l.precision ? `, position à ± ${l.precision} m` : ''}.`, data: l } : { text: `Aucun lieu n'est réglé : je me crois à ${LIEU_PAR_DEFAUT}. Dis « ma ville est … », ou touche « Me localiser » sur la carte météo.`, data: null };
    } },
    { id: 'bouton', label: 'Ajouter un bouton', what: 'Un bouton vers une action de n\'importe quelle appli', params: TILE, words: ['ajoute un bouton'], run: (ctx, i) => {
      const m = ctx.modules().find((x) => x.id === s(i.appli).trim().toLowerCase() || x.name.toLowerCase() === s(i.appli).trim().toLowerCase()); if (!m) throw new Error(`appli inconnue : ${s(i.appli)}`);
      const a = m.actions.find((x) => x.id === s(i.action).trim() || x.label.toLowerCase() === s(i.action).trim().toLowerCase()); if (!a) throw new Error(`action inconnue dans ${m.name} : ${s(i.action)} (actions : ${m.actions.map((x) => x.id).join(', ')})`);
      const input = Object.fromEntries(s(i.reglages).split('\n').map((l) => l.split('=')).filter((p) => p.length >= 2 && p[0].trim()).map(([k, ...v]) => [k.trim(), v.join('=').trim()]));
      const color = s(i.couleur).trim(); if (color && !/^#[0-9a-f]{6}$/i.test(color)) throw new Error('couleur sous la forme #FF8800');
      const label = s(i.nom).trim().slice(0, 40) || a.label, t: Tile = { id: randomBytes(4).toString('hex'), label, module: m.id, action: a.id, input, icon: [...s(i.icone).trim()].slice(0, 2).join('') || '⚡', ...(color ? { color } : {}) };
      ctx.saveSettings({ tiles: [...tilesOf(ctx), t] });
      return { text: `➕ Bouton « ${label} » → ${m.name} · ${a.label}${a.grave ? ' (action grave : confirmation à chaque clic)' : ''}.`, data: { id: t.id } };
    }, undo: (i) => ({ action: 'retirer_bouton', input: { nom: i.nom }, label: 'Retirer le bouton' }) },
    { id: 'retirer_bouton', label: 'Retirer un bouton', what: 'Par son texte', quick: false, params: [{ key: 'nom', label: 'Texte du bouton', kind: 'text', required: true }], run: (ctx, i) => { const l = tilesOf(ctx), t = l.find((x) => x.id === s(i.nom) || x.label.toLowerCase() === s(i.nom).trim().toLowerCase()); if (!t) throw new Error('bouton introuvable'); ctx.saveSettings({ tiles: l.filter((x) => x.id !== t.id) }); return { text: `🗑 Bouton « ${t.label} » retiré.` }; } },
    { id: 'boutons', label: 'Boutons', what: 'Les boutons de l\'écran de la maison', read: true, words: ['boutons de l\'écran de la maison', 'mes boutons'], run: (ctx) => ({ text: tilesOf(ctx).map((t) => `- ${t.icon} ${t.label} → ${t.module}.${t.action}`).join('\n') || 'Aucun bouton.' }) },
    { id: 'cle_tablette', label: 'Clé de tablette', what: 'Un lien pour une tablette murale ou Home Assistant, sans mot de passe (gardé secret)', quick: false,
      // Une personne de Persona (un membre) ne s'en crée pas : une clé « complet » lui rendrait les droits du propriétaire.
      proprietaireSeul: () => Boolean(agissant()), params: [{ key: 'nom', label: 'Nom (ex. Tablette entrée)', kind: 'text', required: true }, { key: 'droits', label: 'Droits', kind: 'select', options: ['maison', 'complet'], default: 'maison', help: 'maison : appareils, scènes, boutons sans action grave ; complet : comme toi (la mascotte fait tout, avec les mêmes validations)' }], words: ['clé de tablette', 'tablette murale'],
      // Une clé ouvre Odin sans mot de passe à qui a le lien : ta validation, en voyant avec quels droits.
      grave: (i) => `créer une clé « ${s(i.nom).trim().slice(0, 40)} » qui ouvre Odin sans mot de passe à qui a le lien (${s(i.droits) === 'complet' ? 'droits complets : comme toi' : 'droits maison : appareils, scènes, boutons sans action grave'})`,
      run: (ctx, i) => {
      const name = s(i.nom).trim().slice(0, 40); if (!name) throw new Error('donne un nom'); if (keys(ctx).some((k) => k.name.toLowerCase() === name.toLowerCase())) throw new Error('ce nom existe déjà');
      const key = `gk_${randomBytes(24).toString('base64url')}`, rights = s(i.droits) === 'complet' ? 'complet' : 'maison';
      ctx.saveSettings({ keys: [...keys(ctx), { id: randomBytes(4).toString('hex'), name, hash: hash(key), rights, at: Date.now() }] });
      return { text: `🔑 Clé « ${name} » (${rights}) créée. Ouvre sur la tablette : /maison#cle=${key}\nElle ne sera plus affichée : garde le lien secret. Retire la clé si la tablette est perdue.`, data: { key } };
    }, undo: (i) => ({ action: 'retirer_cle', input: { nom: i.nom }, label: 'Retirer la clé' }) },
    { id: 'retirer_cle', label: 'Retirer une clé de tablette', what: 'La tablette perd l\'accès tout de suite', quick: false, params: [{ key: 'nom', label: 'Nom', kind: 'text', required: true }], run: (ctx, i) => { const k = keys(ctx).find((x) => x.name.toLowerCase() === s(i.nom).trim().toLowerCase()); if (!k) throw new Error('clé introuvable'); ctx.saveSettings({ keys: keys(ctx).filter((x) => x.id !== k.id) }); return { text: `🔒 Clé « ${k.name} » retirée.` }; } },
    { id: 'membre', label: 'Ajouter un membre (OwnTracks)', what: 'Un membre de la famille partage sa position avec l\'appli OwnTracks : Odin lui donne ses identifiants', quick: false, params: [{ key: 'nom', label: 'Prénom', kind: 'text', required: true }, { key: 'adresse', label: 'Adresse d\'Odin vue du téléphone (https://…)', kind: 'text', default: '' }], words: ['owntracks', 'partage de position'], grave: (i) => `donner à ${s(i.nom).trim().slice(0, 40)} des identifiants pour envoyer sa position à Odin depuis son téléphone (OwnTracks)`, run: (ctx, i) => {
      const name = s(i.nom).trim().slice(0, 40); if (!name) throw new Error('donne un prénom');
      if (members(ctx).some((m) => m.name.toLowerCase() === name.toLowerCase())) throw new Error('ce membre existe déjà');
      const user = name.toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, '').slice(0, 20) || `membre${members(ctx).length + 1}`, pass = randomBytes(15).toString('base64url');
      const tid = (name.normalize('NFD').replace(/[^A-Za-z0-9]/g, '').slice(0, 2) || 'XX').toUpperCase();
      ctx.saveSettings({ members: [...members(ctx), { id: randomBytes(4).toString('hex'), name, user, hash: hash(pass), tid, at: Date.now() }] });
      const base = s(i.adresse).trim().replace(/\/$/, '') || 'https://<adresse d\'Odin>';
      return { text: `📍 ${name} peut partager sa position. Sur son téléphone, dans OwnTracks : Réglages → Connexion → Mode « HTTP »\n- Adresse : ${base}/api/owntracks\n- Identifiant : ${user}\n- Mot de passe : ${pass}\n- Appareil : ${tid}\nLe mot de passe ne sera plus affiché. ${name} voit l'appli sur son téléphone et peut la mettre en pause quand il veut. Les positions sont gardées ${keepDays(ctx)} jour(s), puis effacées.${ctx.modules().some((x) => x.id === 'gna') ? `\nSes trajets (Ulysse) ne sont pas gardés : ${name} peut allumer son historique, et le revoir, sur ${base}/trajets avec ces mêmes identifiants.` : ''}`, data: { user } };
    }, undo: (i) => ({ action: 'retirer_membre', input: { nom: i.nom }, label: 'Retirer le membre' }) },
    { id: 'retirer_membre', label: 'Retirer un membre', what: 'Ses identifiants ne marchent plus et ses positions sont effacées', quick: false, params: [{ key: 'nom', label: 'Prénom', kind: 'text', required: true }], run: (ctx, i) => {
      const m = members(ctx).find((x) => x.name.toLowerCase() === s(i.nom).trim().toLowerCase()); if (!m) throw new Error('membre introuvable');
      ctx.saveSettings({ members: members(ctx).filter((x) => x.id !== m.id) }); const all = readFixes(ctx); delete all[m.id]; try { writeFixes(ctx, all); } catch { /* */ }
      oublier(trajetsDir(ctx), m.id, true);   // et son historique de trajets (Ulysse), avec ses choix
      return { text: `🗑 ${m.name} retiré ; ses positions sont effacées.` };
    } },
    { id: 'positions', label: 'Où est la famille', what: 'La dernière position partagée de chacun', read: true, words: ['où est la famille', 'position de la famille'], run: (ctx) => {
      const f = familyNow(ctx); return { text: f.length ? f.map((x) => `- ${x.name} : ${x.place ? `${x.place}, ` : ''}https://www.openstreetmap.org/?mlat=${x.lat}&mlon=${x.lon} (il y a ${Math.max(1, Math.round((Date.now() - x.at) / 60_000))} min${x.batt !== undefined ? `, batterie ${x.batt} %` : ''})`).join('\n') : 'Aucune position partagée pour l\'instant.', data: f };
    } },
    { id: 'duree_positions', label: 'Durée de garde des positions', what: '1 jour par défaut, 30 au plus', quick: false, params: [{ key: 'jours', label: 'Jours', kind: 'number', default: 1 }], run: (ctx, i) => { const n = Math.max(1, Math.min(30, Number(i.jours) || 1)); ctx.saveSettings({ positionsJours: n }); return { text: `Positions gardées ${n} jour(s).` }; } },
    { id: 'home_assistant', label: 'Afficher dans Home Assistant', what: 'Autorise ta box Home Assistant à afficher l\'écran, et donne le tableau de bord à coller', params: [{ key: 'adresse', label: 'Adresse de Home Assistant (https://…:8123)', kind: 'text', required: true }, { key: 'odin', label: 'Adresse d\'Odin vue par Home Assistant (https://…)', kind: 'text', required: true }], words: ['dans home assistant', 'afficher dans home assistant'], grave: (i) => { let o = s(i.adresse).trim(); try { o = new URL(o).origin; } catch { /* montré tel quel */ } return `autoriser ${o.slice(0, 120)} (Home Assistant) à afficher l'écran de la maison d'Odin`; }, run: (ctx, i) => {
      let ha: URL, od: URL; try { ha = new URL(s(i.adresse).trim()); od = new URL(s(i.odin).trim()); } catch { throw new Error('adresses complètes attendues (https://…)'); }
      if (!/^https?:$/.test(ha.protocol) || !/^https?:$/.test(od.protocol)) throw new Error('http ou https seulement');
      ctx.saveSettings({ haOrigin: ha.origin });
      const warn = ha.protocol === 'https:' && od.protocol === 'http:' ? '\n⚠ Home Assistant est en https et Odin en http : le navigateur bloquera l\'écran. Mets Odin en https (Valgrind ou Bifröst).' : '';
      return { text: `🏠 Home Assistant (${ha.origin}) peut afficher l'écran de la maison.\n1. Crée une clé de tablette (« Clé de tablette ») et copie son lien.\n2. Dans Home Assistant : Paramètres → Tableaux de bord → Ajouter → « Page web », adresse : ${od.origin}/maison#cle=<ta clé>\n   ou dans un tableau existant, une carte « Page web » :\n   type: iframe\n   url: ${od.origin}/maison#cle=<ta clé>\n   aspect_ratio: 62%${warn}` };
    } },
  ],
  async view(ctx) {
    const t = tilesOf(ctx), w = await weather(ctx), dev = await homeDevices(valhallaOf()?.ctx('midgard') ?? ctx).catch(() => []);
    return {
      subtitle: `Thème « ${THEMES_MAISON[s(ctx.settings.theme) || 'verre']?.label ?? 'Verre sombre'} » · ${t.length} bouton(s) · ${dev.length} appareil(s) · ${keys(ctx).length} clé(s) de tablette`,
      kpis: [{ label: 'Météo', value: w ? `${w.temp} °C${wxErr ? ' (anciennes)' : ''}` : '—' }, { label: 'Appareils', value: String(dev.length) }, { label: 'Boutons', value: String(t.length) }, { label: 'Tablettes', value: String(keys(ctx).length) }],
      sections: [
        { kind: 'steps', title: 'L\'écran de la maison', items: [{ title: 'Ouvrir l\'écran', detail: '/maison sur l\'adresse d\'Odin', done: true }, { title: 'Une tablette murale ?', detail: 'Crée une clé de tablette (droits « maison » conseillés)', done: keys(ctx).length > 0 }, { title: 'Dans Home Assistant ?', detail: 'Autorise ta box et colle la carte « Page web »', done: Boolean(ctx.settings.haOrigin) }] },
        { kind: 'table', title: 'Boutons', columns: ['', 'Texte', 'Appli', 'Action'], empty: 'Aucun bouton.', rows: t.map((x) => ({ cells: [x.icon, x.label, ctx.modules().find((m) => m.id === x.module)?.name ?? x.module, x.action], actions: [{ action: 'retirer_bouton', label: 'Retirer', input: { nom: x.id } }] })) },
        { kind: 'table', title: 'Clés de tablette', columns: ['Nom', 'Droits', 'Créée', 'Dernier usage'], empty: 'Aucune clé.', rows: keys(ctx).map((k) => ({ cells: [k.name, k.rights, new Date(k.at).toLocaleDateString('fr-FR'), k.used ? new Date(k.used).toLocaleString('fr-FR') : 'jamais'], actions: [{ action: 'retirer_cle', label: 'Retirer', input: { nom: k.name } }] })) },
      ],
      side: [{ kind: 'form', title: 'Thème', action: 'theme', submit: 'Choisir', params: [{ key: 'theme', label: 'Thème', kind: 'select', options: Object.keys(THEMES_MAISON), default: s(ctx.settings.theme) || 'verre' }] }, { kind: 'form', title: 'Ajouter un bouton', action: 'bouton', submit: 'Ajouter', params: TILE }, { kind: 'form', title: 'Lieu de la météo', action: 'meteo', submit: 'Choisir', params: [{ key: 'ville', label: 'Ville', kind: 'text', default: s(ctx.settings.ville) || 'Mamoudzou' }] }],
    };
  },
};
