// Glaðsheimr · la maison en un écran : un tableau de bord plein écran (tablette murale, téléphone, ordinateur,
// et dans Home Assistant), à thèmes, qui réunit les appareils de Midgard (lumières, volets, clim, serrures,
// lecteurs), les scènes, la météo, l'état de toutes les applis d'Odin, et des boutons vers n'importe quelle
// action d'une appli (bloquer quelqu'un, VPN, accès réseau, mises à jour…). La mascotte s'y promène, joue,
// donne la météo et l'heure, et exécute ce que tu lui demandes avec les mêmes droits que partout dans Odin.
// Reprend les idées de Home Assistant (Lovelace, Mushroom, Bubble Card), Homepage, Dashy et Homarr.
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ModCtx, Module, Param, Tone } from '../types.ts';
import { valhallaOf } from '../odin.ts';
import { homeDevices } from './midgard.ts';

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
export interface Tile { id: string; label: string; module: string; action: string; input: Record<string, unknown>; icon: string; color?: string }
export interface Key { id: string; name: string; hash: string; rights: 'maison' | 'complet'; at: number; used?: number }
/** Un membre de la famille qui partage sa position avec l'appli OwnTracks (il l'installe et peut la mettre en pause). */
export interface Member { id: string; name: string; user: string; hash: string; tid: string; at: number }
export interface Fix { at: number; lat: number; lon: number; acc?: number; batt?: number; conn?: string; place?: string }
const members = (ctx: ModCtx): Member[] => (ctx.settings.members as Member[] | undefined) ?? [];
const fixesFile = (ctx: ModCtx) => join(ctx.dir, 'positions.json');
function readFixes(ctx: ModCtx): Record<string, Fix[]> { try { return JSON.parse(readFileSync(fixesFile(ctx), 'utf8')) as Record<string, Fix[]>; } catch { return {}; } }
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
  }
  for (const k of Object.keys(all)) { all[k] = all[k].filter((x) => x.at >= limit); if (!all[k].length || !members(ctx).some((x) => x.id === k)) delete all[k]; }
  try { mkdirSync(ctx.dir, { recursive: true }); writeFileSync(fixesFile(ctx), JSON.stringify(all)); } catch { /* disque plein */ }
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
export interface Weather { place: string; temp: number; feels?: number; code: number; humidity?: number; wind?: number; hi?: number; lo?: number; rain?: number; sunrise?: string; sunset?: string; days: Array<{ day: string; code: number; hi: number; lo: number }>; hours: Array<{ t: string; temp: number }>; at: number }
let wx: Weather | undefined, wxErr = '';
export const WCODE: Record<number, [string, string]> = { 0: ['Ciel dégagé', '☀️'], 1: ['Plutôt dégagé', '🌤'], 2: ['Partiellement nuageux', '⛅'], 3: ['Couvert', '☁️'], 45: ['Brouillard', '🌫'], 48: ['Brouillard givrant', '🌫'], 51: ['Bruine', '🌦'], 53: ['Bruine', '🌦'], 55: ['Bruine forte', '🌧'], 61: ['Pluie faible', '🌦'], 63: ['Pluie', '🌧'], 65: ['Forte pluie', '🌧'], 66: ['Pluie verglaçante', '🌧'], 67: ['Pluie verglaçante', '🌧'], 71: ['Neige faible', '🌨'], 73: ['Neige', '🌨'], 75: ['Forte neige', '❄️'], 80: ['Averses', '🌦'], 81: ['Averses', '🌧'], 82: ['Violentes averses', '⛈'], 95: ['Orage', '⛈'], 96: ['Orage et grêle', '⛈'], 99: ['Orage et grêle', '⛈'] };
export const wword = (c: number) => (WCODE[c] ?? ['Temps variable', '🌡'])[0];
export async function weather(ctx: ModCtx, fresh = false): Promise<Weather | undefined> {
  if (!fresh && wx && Date.now() - wx.at < 15 * 60_000) return wx;
  const place = s(ctx.settings.ville) || 'Mamoudzou';
  try {
    let lat = Number(ctx.settings.lat), lon = Number(ctx.settings.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || !ctx.settings.lat) {
      const g = await (await ctx.fetch(`${s(ctx.settings.meteoGeo) || 'https://geocoding-api.open-meteo.com'}/v1/search?name=${encodeURIComponent(place)}&count=1&language=fr`, { signal: AbortSignal.timeout(10_000) })).json() as { results?: Array<{ latitude: number; longitude: number }> };
      if (!g.results?.[0]) throw new Error(`lieu introuvable : ${place}`);
      lat = g.results[0].latitude; lon = g.results[0].longitude; ctx.saveSettings({ lat, lon });
    }
    const r = await (await ctx.fetch(`${s(ctx.settings.meteoApi) || 'https://api.open-meteo.com'}/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,precipitation&hourly=temperature_2m&daily=weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset&timezone=auto&forecast_days=7`, { signal: AbortSignal.timeout(10_000) })).json() as { current: Record<string, number>; hourly: { time: string[]; temperature_2m: number[] }; daily: { time: string[]; weather_code: number[]; temperature_2m_max: number[]; temperature_2m_min: number[]; sunrise: string[]; sunset: string[] } };
    const now = new Date().toISOString().slice(0, 13), from = Math.max(0, r.hourly.time.findIndex((t) => t.slice(0, 13) >= now));
    wx = { place, temp: Math.round(r.current.temperature_2m), feels: Math.round(r.current.apparent_temperature), code: r.current.weather_code, humidity: r.current.relative_humidity_2m, wind: Math.round(r.current.wind_speed_10m), rain: r.current.precipitation, hi: Math.round(r.daily.temperature_2m_max[0]), lo: Math.round(r.daily.temperature_2m_min[0]), sunrise: r.daily.sunrise[0]?.slice(11, 16), sunset: r.daily.sunset[0]?.slice(11, 16), days: r.daily.time.map((d, i) => ({ day: d, code: r.daily.weather_code[i], hi: Math.round(r.daily.temperature_2m_max[i]), lo: Math.round(r.daily.temperature_2m_min[i]) })), hours: r.hourly.time.slice(from, from + 24).map((t, i) => ({ t: t.slice(11, 16), temp: Math.round(r.hourly.temperature_2m[from + i]) })), at: Date.now() };
    wxErr = ''; return wx;
  } catch (e) { wxErr = (e as Error).message; return wx; }
}
export const weatherText = (w?: Weather) => (w ? `À ${w.place} : ${w.temp} °C, ${wword(w.code).toLowerCase()}${w.hi !== undefined ? ` (min ${w.lo}°, max ${w.hi}°)` : ''}${w.humidity !== undefined ? `, humidité ${w.humidity} %` : ''}${w.wind !== undefined ? `, vent ${w.wind} km/h` : ''}.` : `Météo indisponible${wxErr ? ` (${wxErr})` : ''}.`);

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

export const gladsheim: Module = {
  id: 'gladsheim', name: 'Glaðsheimr', family: 'Maison',
  what: 'La maison en un écran, pour tablette murale, téléphone, ordinateur et Home Assistant : appareils, scènes, météo, état de toutes tes applis, tes boutons, onze thèmes, et la mascotte qui joue et obéit.',
  does: ['écran plein format à onze thèmes (verre, bleu nuit, braise, acier, tablette murale, crépuscule, classique, violet, aurore, lagon, clair)', 'pièces et appareils de toutes tes box (Midgard) : lumières (intensité), volets, clim (+/−), serrures (glisser pour ouvrir, avec ton accord), lecteurs', 'scènes d\'un geste', 'météo du lieu choisi (heure par heure, 7 jours, lever et coucher du soleil)', 'l\'état de toutes tes applis (alertes, chiffres clés), un clic pour ouvrir', 'tes boutons vers n\'importe quelle action d\'une appli : bloquer quelqu\'un, VPN, accès réseau, informations, mises à jour…', 'la mascotte se promène, joue à la balle, donne la météo, l\'heure, les alertes, et fait ce que tu lui dis (mêmes droits et mêmes validations que partout dans Odin)', 'clés de tablette (lien à poser sur une tablette ou dans Home Assistant), droits « maison » ou « complet », retirables', 'dans Home Assistant : un tableau de bord « page web » prêt à coller'],
  from: ['Home Assistant', 'Mushroom', 'Bubble Card', 'Homepage', 'Dashy', 'Homarr'], upstream: ['home-assistant/frontend', 'piitaya/lovelace-mushroom', 'gethomepage/homepage', 'Lissy93/dashy', 'homarr-labs/homarr'],
  words: ['glaðsheimr', 'gladsheim', 'écran de la maison', 'tablette murale', 'tableau de la maison', 'thème de la maison', 'bouton de la maison'],
  actions: [
    { id: 'ouvrir', label: 'Ouvrir l\'écran de la maison', what: 'L\'adresse de l\'écran plein format', read: true, words: ['écran de la maison', 'ouvre l\'écran de la maison'], run: () => ({ text: '🏠 L\'écran de la maison : /maison sur l\'adresse d\'Odin (garde-le en favori, ou « Ajouter à l\'écran d\'accueil » sur la tablette).', data: { url: '/maison' } }) },
    { id: 'theme', label: 'Thème', what: 'Le thème de l\'écran de la maison', params: [{ key: 'theme', label: 'Thème', kind: 'select', options: Object.keys(THEMES), required: true }], words: ['change le thème de l\'écran', 'change le thème'], run: (ctx, i) => { const t = s(i.theme); if (!THEMES[t]) throw new Error(`thèmes : ${Object.keys(THEMES).join(', ')}`); ctx.saveSettings({ theme: t }); return { text: `🎨 Thème « ${THEMES[t].label} ».` }; } },
    { id: 'meteo', label: 'Météo', what: 'Le temps qu\'il fait (et le lieu choisi)', read: true, params: [{ key: 'ville', label: 'Ville (vide : celle déjà choisie)', kind: 'text', default: '' }], words: ['météo de la maison', 'la météo', 'quel temps fait-il', 'météo', 'meteo', 'température dehors'], run: async (ctx, i) => {
      const v = s(i.ville).trim(); if (v && v !== s(ctx.settings.ville)) { ctx.saveSettings({ ville: v.slice(0, 80), lat: '', lon: '' }); wx = undefined; }
      const w = await weather(ctx, Boolean(v)); return { text: `${weatherText(w)}${w?.days[1] ? ` Demain : ${wword(w.days[1].code).toLowerCase()}, ${w.days[1].lo}° à ${w.days[1].hi}°.` : ''}`, data: w };
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
    { id: 'cle_tablette', label: 'Clé de tablette', what: 'Un lien pour une tablette murale ou Home Assistant, sans mot de passe (gardé secret)', quick: false, params: [{ key: 'nom', label: 'Nom (ex. Tablette entrée)', kind: 'text', required: true }, { key: 'droits', label: 'Droits', kind: 'select', options: ['maison', 'complet'], default: 'maison', help: 'maison : appareils, scènes, boutons sans action grave ; complet : comme toi (la mascotte fait tout, avec les mêmes validations)' }], words: ['clé de tablette', 'tablette murale'], run: (ctx, i) => {
      const name = s(i.nom).trim().slice(0, 40); if (!name) throw new Error('donne un nom'); if (keys(ctx).some((k) => k.name.toLowerCase() === name.toLowerCase())) throw new Error('ce nom existe déjà');
      const key = `gk_${randomBytes(24).toString('base64url')}`, rights = s(i.droits) === 'complet' ? 'complet' : 'maison';
      ctx.saveSettings({ keys: [...keys(ctx), { id: randomBytes(4).toString('hex'), name, hash: hash(key), rights, at: Date.now() }] });
      return { text: `🔑 Clé « ${name} » (${rights}) créée. Ouvre sur la tablette : /maison#cle=${key}\nElle ne sera plus affichée : garde le lien secret. Retire la clé si la tablette est perdue.`, data: { key } };
    }, undo: (i) => ({ action: 'retirer_cle', input: { nom: i.nom }, label: 'Retirer la clé' }) },
    { id: 'retirer_cle', label: 'Retirer une clé de tablette', what: 'La tablette perd l\'accès tout de suite', quick: false, params: [{ key: 'nom', label: 'Nom', kind: 'text', required: true }], run: (ctx, i) => { const k = keys(ctx).find((x) => x.name.toLowerCase() === s(i.nom).trim().toLowerCase()); if (!k) throw new Error('clé introuvable'); ctx.saveSettings({ keys: keys(ctx).filter((x) => x.id !== k.id) }); return { text: `🔒 Clé « ${k.name} » retirée.` }; } },
    { id: 'membre', label: 'Ajouter un membre (OwnTracks)', what: 'Un membre de la famille partage sa position avec l\'appli OwnTracks : Odin lui donne ses identifiants', quick: false, params: [{ key: 'nom', label: 'Prénom', kind: 'text', required: true }, { key: 'adresse', label: 'Adresse d\'Odin vue du téléphone (https://…)', kind: 'text', default: '' }], words: ['owntracks', 'partage de position'], run: (ctx, i) => {
      const name = s(i.nom).trim().slice(0, 40); if (!name) throw new Error('donne un prénom');
      if (members(ctx).some((m) => m.name.toLowerCase() === name.toLowerCase())) throw new Error('ce membre existe déjà');
      const user = name.toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, '').slice(0, 20) || `membre${members(ctx).length + 1}`, pass = randomBytes(15).toString('base64url');
      const tid = (name.normalize('NFD').replace(/[^A-Za-z0-9]/g, '').slice(0, 2) || 'XX').toUpperCase();
      ctx.saveSettings({ members: [...members(ctx), { id: randomBytes(4).toString('hex'), name, user, hash: hash(pass), tid, at: Date.now() }] });
      const base = s(i.adresse).trim().replace(/\/$/, '') || 'https://<adresse d\'Odin>';
      return { text: `📍 ${name} peut partager sa position. Sur son téléphone, dans OwnTracks : Réglages → Connexion → Mode « HTTP »\n- Adresse : ${base}/api/owntracks\n- Identifiant : ${user}\n- Mot de passe : ${pass}\n- Appareil : ${tid}\nLe mot de passe ne sera plus affiché. ${name} voit l'appli sur son téléphone et peut la mettre en pause quand il veut. Les positions sont gardées ${keepDays(ctx)} jour(s), puis effacées.`, data: { user } };
    }, undo: (i) => ({ action: 'retirer_membre', input: { nom: i.nom }, label: 'Retirer le membre' }) },
    { id: 'retirer_membre', label: 'Retirer un membre', what: 'Ses identifiants ne marchent plus et ses positions sont effacées', quick: false, params: [{ key: 'nom', label: 'Prénom', kind: 'text', required: true }], run: (ctx, i) => {
      const m = members(ctx).find((x) => x.name.toLowerCase() === s(i.nom).trim().toLowerCase()); if (!m) throw new Error('membre introuvable');
      ctx.saveSettings({ members: members(ctx).filter((x) => x.id !== m.id) }); const all = readFixes(ctx); delete all[m.id]; try { writeFileSync(fixesFile(ctx), JSON.stringify(all)); } catch { /* */ }
      return { text: `🗑 ${m.name} retiré ; ses positions sont effacées.` };
    } },
    { id: 'positions', label: 'Où est la famille', what: 'La dernière position partagée de chacun', read: true, words: ['où est la famille', 'position de la famille'], run: (ctx) => {
      const f = familyNow(ctx); return { text: f.length ? f.map((x) => `- ${x.name} : ${x.place ? `${x.place}, ` : ''}https://www.openstreetmap.org/?mlat=${x.lat}&mlon=${x.lon} (il y a ${Math.max(1, Math.round((Date.now() - x.at) / 60_000))} min${x.batt !== undefined ? `, batterie ${x.batt} %` : ''})`).join('\n') : 'Aucune position partagée pour l\'instant.', data: f };
    } },
    { id: 'duree_positions', label: 'Durée de garde des positions', what: '1 jour par défaut, 30 au plus', quick: false, params: [{ key: 'jours', label: 'Jours', kind: 'number', default: 1 }], run: (ctx, i) => { const n = Math.max(1, Math.min(30, Number(i.jours) || 1)); ctx.saveSettings({ positionsJours: n }); return { text: `Positions gardées ${n} jour(s).` }; } },
    { id: 'home_assistant', label: 'Afficher dans Home Assistant', what: 'Autorise ta box Home Assistant à afficher l\'écran, et donne le tableau de bord à coller', params: [{ key: 'adresse', label: 'Adresse de Home Assistant (https://…:8123)', kind: 'text', required: true }, { key: 'odin', label: 'Adresse d\'Odin vue par Home Assistant (https://…)', kind: 'text', required: true }], words: ['dans home assistant', 'afficher dans home assistant'], run: (ctx, i) => {
      let ha: URL, od: URL; try { ha = new URL(s(i.adresse).trim()); od = new URL(s(i.odin).trim()); } catch { throw new Error('adresses complètes attendues (https://…)'); }
      if (!/^https?:$/.test(ha.protocol) || !/^https?:$/.test(od.protocol)) throw new Error('http ou https seulement');
      ctx.saveSettings({ haOrigin: ha.origin });
      const warn = ha.protocol === 'https:' && od.protocol === 'http:' ? '\n⚠ Home Assistant est en https et Odin en http : le navigateur bloquera l\'écran. Mets Odin en https (Valgrind ou Brú).' : '';
      return { text: `🏠 Home Assistant (${ha.origin}) peut afficher l'écran de la maison.\n1. Crée une clé de tablette (« Clé de tablette ») et copie son lien.\n2. Dans Home Assistant : Paramètres → Tableaux de bord → Ajouter → « Page web », adresse : ${od.origin}/maison#cle=<ta clé>\n   ou dans un tableau existant, une carte « Page web » :\n   type: iframe\n   url: ${od.origin}/maison#cle=<ta clé>\n   aspect_ratio: 62%${warn}` };
    } },
  ],
  async view(ctx) {
    const t = tilesOf(ctx), w = await weather(ctx), dev = await homeDevices(valhallaOf()?.ctx('midgard') ?? ctx).catch(() => []);
    return {
      subtitle: `Thème « ${THEMES[s(ctx.settings.theme) || 'verre']?.label ?? 'Verre sombre'} » · ${t.length} bouton(s) · ${dev.length} appareil(s) · ${keys(ctx).length} clé(s) de tablette`,
      kpis: [{ label: 'Météo', value: w ? `${w.temp} °C` : '—' }, { label: 'Appareils', value: String(dev.length) }, { label: 'Boutons', value: String(t.length) }, { label: 'Tablettes', value: String(keys(ctx).length) }],
      sections: [
        { kind: 'steps', title: 'L\'écran de la maison', items: [{ title: 'Ouvrir l\'écran', detail: '/maison sur l\'adresse d\'Odin', done: true }, { title: 'Une tablette murale ?', detail: 'Crée une clé de tablette (droits « maison » conseillés)', done: keys(ctx).length > 0 }, { title: 'Dans Home Assistant ?', detail: 'Autorise ta box et colle la carte « Page web »', done: Boolean(ctx.settings.haOrigin) }] },
        { kind: 'table', title: 'Boutons', columns: ['', 'Texte', 'Appli', 'Action'], empty: 'Aucun bouton.', rows: t.map((x) => ({ cells: [x.icon, x.label, ctx.modules().find((m) => m.id === x.module)?.name ?? x.module, x.action], actions: [{ action: 'retirer_bouton', label: 'Retirer', input: { nom: x.id } }] })) },
        { kind: 'table', title: 'Clés de tablette', columns: ['Nom', 'Droits', 'Créée', 'Dernier usage'], empty: 'Aucune clé.', rows: keys(ctx).map((k) => ({ cells: [k.name, k.rights, new Date(k.at).toLocaleDateString('fr-FR'), k.used ? new Date(k.used).toLocaleString('fr-FR') : 'jamais'], actions: [{ action: 'retirer_cle', label: 'Retirer', input: { nom: k.name } }] })) },
      ],
      side: [{ kind: 'form', title: 'Thème', action: 'theme', submit: 'Choisir', params: [{ key: 'theme', label: 'Thème', kind: 'select', options: Object.keys(THEMES), default: s(ctx.settings.theme) || 'verre' }] }, { kind: 'form', title: 'Ajouter un bouton', action: 'bouton', submit: 'Ajouter', params: TILE }, { kind: 'form', title: 'Lieu de la météo', action: 'meteo', submit: 'Choisir', params: [{ key: 'ville', label: 'Ville', kind: 'text', default: s(ctx.settings.ville) || 'Mamoudzou' }] }],
    };
  },
};
