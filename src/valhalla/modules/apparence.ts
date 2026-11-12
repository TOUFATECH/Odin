// Apparence · les 20 thèmes d'Odin (maquettes validées). Le choix est gardé par Odin (le même sur tous tes
// écrans), se change dans les Réglages, en parlant (« Odin, change ton thème », « mets le thème glace »,
// « remets automatique », aussi sur Telegram), ou tout seul selon l'heure et la météo (au plus une fois par heure,
// sauf orage). Les couleurs et décors sont dans l'interface (themes.js) ; ici : le choix et la règle automatique.
import type { ModCtx, Module } from '../types.ts';
import { EVENTS, EVENT_BY_ID, inRamadan, todayEvent, upcoming, ymd, type EventsCfg } from '../fetes.ts';

const s = (x: unknown) => (typeof x === 'string' ? x : x === undefined || x === null ? '' : String(x));
export const THEME_NAMES: Record<string, string> = {
  glace: 'Glace', vacances: 'Vacances', paysage: 'Paysage', ciel: 'Ciel', nuit: 'Nuit étoilée', aurore: 'Aurore boréale', ocean: 'Océan', plage: 'Plage et palmiers', foret: 'Forêt', montagne: 'Montagne',
  coucher: 'Coucher de soleil', desert: 'Désert', pluie: 'Pluie', orage: 'Orage', neige: 'Neige', mayotte: 'Mayotte', printemps: 'Printemps fleuri', automne: 'Automne', espace: 'Espace', valhalla: 'Valhalla (classique)',
};
const IDS = Object.keys(THEME_NAMES);
interface Wx { place?: string; temp?: number; code?: number; wind?: number; lat?: number; lon?: number }
const wordOf = (c?: number) => (c === undefined ? '' : c <= 1 ? 'beau' : c <= 3 ? 'nuageux' : c <= 48 ? 'brumeux' : c <= 67 || (c >= 80 && c <= 82) ? 'pluvieux' : c <= 77 || c === 85 || c === 86 ? 'neigeux' : 'orageux');

/** Le thème qui va avec l'heure et la météo (règles validées sur la maquette). Pur. */
export function autoTheme(hour: number, w?: Wx): { id: string; why: string } {
  const c = w?.code, t = w?.temp, at = w?.place ? ` à ${w.place}` : '';
  if (c !== undefined && c >= 95) return { id: 'orage', why: `orage${at}` };
  if (c !== undefined && ((c >= 51 && c <= 67) || (c >= 80 && c <= 82))) return { id: 'pluie', why: `il pleut${at}` };
  if (c !== undefined && ((c >= 71 && c <= 77) || c === 85 || c === 86)) return { id: 'neige', why: `il neige${at}` };
  if (hour >= 21 || hour < 6) return { id: 'nuit', why: 'c\'est la nuit' };
  if (hour < 9) return { id: 'paysage', why: 'c\'est le matin' };
  if (hour >= 17 && hour < 19) return { id: 'coucher', why: 'fin de journée' };
  if (t !== undefined && t > 32) return { id: 'glace', why: `il fait ${t}°${at}, pour rafraîchir` };
  if (c !== undefined && (c === 3 || c === 45 || c === 48)) return { id: 'foret', why: `ciel couvert${at}` };
  if (c !== undefined && c <= 2 && hour < 19) return hour < 14 ? { id: 'ciel', why: `il fait ${t ?? '?'}° et beau${at}` } : { id: 'plage', why: `il fait ${t ?? '?'}° et beau${at}` };
  return { id: 'mayotte', why: 'par défaut chez toi' };
}
/** La couleur d'Odin en thème automatique (maquette « Thème automatique ») : chaud jaune, froid bleu, vent blanc,
 *  pluie et marée haute bleu très foncé, nuit or. Rien de spécial : la couleur du thème. Pur. */
export function odinColor(hour: number, w?: Wx & { wind?: number }, highTide = false): { color: string; why: string } | undefined {
  const c = w?.code, rain = c !== undefined && ((c >= 51 && c <= 67) || (c >= 80 && c <= 82) || c >= 95);
  if (rain && highTide) return { color: '#16306b', why: 'pluie et marée haute' };
  if (w?.wind !== undefined && w.wind >= 35) return { color: '#f2f6fa', why: `vent à ${w.wind} km/h` };
  if (hour >= 21 || hour < 6) return { color: '#f4d35e', why: 'la nuit' };
  if (w?.temp !== undefined && w.temp >= 30) return { color: '#ffd23a', why: `il fait chaud (${w.temp}°)` };
  if (w?.temp !== undefined && w.temp <= 20) return { color: '#5b8fd9', why: `il fait frais (${w.temp}°)` };
  return undefined;
}
/** Les 38 pouvoirs (maquettes validées, + Éclair et Téléportation) et leur famille. */
export const POWERS: Record<string, { name: string; fam: string }> = {
  feu: { name: 'Boule de feu', fam: 'Feu' }, jet: { name: 'Rayon de feu', fam: 'Feu' }, lave: { name: 'Lave', fam: 'Feu' }, meteores: { name: 'Météores', fam: 'Feu' }, comete: { name: 'Comète', fam: 'Feu' },
  vague: { name: 'Vague', fam: 'Eau' }, bulles: { name: 'Bulles', fam: 'Eau' }, glace: { name: 'Glace', fam: 'Eau' }, blizzard: { name: 'Blizzard', fam: 'Eau' },
  rochers: { name: 'Rochers', fam: 'Terre' }, seisme: { name: 'Séisme', fam: 'Terre' }, sable: { name: 'Tempête de sable', fam: 'Terre' }, cristaux: { name: 'Cristaux', fam: 'Terre' },
  tornade: { name: 'Tornade', fam: 'Air' }, rafale: { name: 'Rafale', fam: 'Air' },
  foudre: { name: 'Foudre', fam: 'Ciel' }, orage: { name: 'Orage', fam: 'Ciel' }, etoiles: { name: 'Étoiles filantes', fam: 'Ciel' }, soleil: { name: 'Rayon de soleil', fam: 'Ciel' }, aurore: { name: 'Aurore boréale', fam: 'Ciel' }, trounoir: { name: 'Trou noir', fam: 'Ciel' },
  lianes: { name: 'Lianes', fam: 'Nature' }, petales: { name: 'Pétales', fam: 'Nature' }, feuilles: { name: 'Feuilles d\'automne', fam: 'Nature' }, poison: { name: 'Poison', fam: 'Nature' },
  laser: { name: 'Laser des yeux', fam: 'Magie' }, runes: { name: 'Runes', fam: 'Magie' }, onde: { name: 'Onde de choc', fam: 'Magie' }, ombre: { name: 'Ombre', fam: 'Magie' }, lumiere: { name: 'Lumière sacrée', fam: 'Magie' }, pixels: { name: 'Pixels', fam: 'Magie' }, aimant: { name: 'Aimant', fam: 'Magie' },
  gungnir: { name: 'Gungnir, la lance', fam: 'Nordique' }, corbeaux: { name: 'Huginn et Muninn', fam: 'Nordique' }, bifrost: { name: 'Bifröst', fam: 'Nordique' }, eclair: { name: 'Éclair', fam: 'Ciel' }, teleport: { name: 'Téléportation', fam: 'Magie' }, artifice: { name: 'Feu d\'artifice', fam: 'Fête' },
};
/** Le pouvoir qui va avec le thème ou la météo. */
export const powerForTheme: Record<string, string> = { glace: 'glace', neige: 'blizzard', pluie: 'vague', orage: 'foudre', ocean: 'bulles', plage: 'vague', desert: 'sable', foret: 'lianes', automne: 'feuilles', printemps: 'petales', nuit: 'etoiles', espace: 'trounoir', aurore: 'aurore', coucher: 'feu', montagne: 'rochers', ciel: 'rafale', paysage: 'feuilles', vacances: 'bulles', mayotte: 'vague', valhalla: 'gungnir' };
export function powerForWeather(w?: Wx & { wind?: number }): string {
  const c = w?.code;
  if (c !== undefined && c >= 95) return 'foudre';
  if (c !== undefined && ((c >= 51 && c <= 67) || (c >= 80 && c <= 82))) return 'vague';
  if (c !== undefined && ((c >= 71 && c <= 77) || c === 85 || c === 86)) return 'blizzard';
  if (w?.wind !== undefined && w.wind >= 35) return 'rafale';
  if (w?.temp !== undefined && w.temp >= 30) return 'feu';
  if (w?.temp !== undefined && w.temp <= 18) return 'glace';
  return 'lumiere';
}
/** Ce que font les clics rapides sur Odin (maquette validée) ; chaque nombre se règle. */
export const CLICK_ACTIONS: Record<string, string> = { rien: 'Rien', rire: 'Il rit', phrase: 'Une phrase', avertir: 'Il prévient', cacher: 'Se cacher partout', muet: 'Couper sa voix', theme: 'Thème au hasard', pouvoir: 'Un pouvoir au hasard', redemarrer: 'Proposer de redémarrer' };
export const DEFAULT_CLICKS: Record<string, string> = { 5: 'rire', 7: 'phrase', 8: 'avertir', 10: 'cacher', 12: 'muet', 15: 'theme', 20: 'redemarrer' };
export interface PowersCfg { actif?: boolean; quand?: { ouvre?: boolean; ferme?: boolean; supprime?: boolean; fenetre?: boolean; clic?: boolean }; choix?: 'hasard' | 'favoris' | 'theme' | 'meteo'; favoris?: string[]; force?: 'discrete' | 'normale' | 'spectaculaire'; son?: boolean }
export const DEFAULT_POWERS: Required<Omit<PowersCfg, 'quand'>> & { quand: Required<NonNullable<PowersCfg['quand']>> } = { actif: false, quand: { ouvre: true, ferme: true, supprime: true, fenetre: true, clic: false }, choix: 'favoris', favoris: ['feu', 'foudre', 'glace', 'lumiere'], force: 'normale', son: false };
/** Réglages des pouvoirs nettoyés (valeurs inconnues ignorées). Pur. */
export function cleanPowers(p: unknown): typeof DEFAULT_POWERS {
  const x = (p && typeof p === 'object' ? p : {}) as PowersCfg, q = { ...DEFAULT_POWERS.quand };
  for (const k of Object.keys(q) as Array<keyof typeof q>) if (typeof x.quand?.[k] === 'boolean') q[k] = x.quand[k] as boolean;
  const fav = Array.isArray(x.favoris) ? x.favoris.filter((f) => POWERS[f]).slice(0, 38) : DEFAULT_POWERS.favoris;
  return { actif: x.actif === true, quand: q, choix: ['hasard', 'favoris', 'theme', 'meteo'].includes(x.choix as string) ? x.choix as 'favoris' : DEFAULT_POWERS.choix, favoris: fav.length ? fav : DEFAULT_POWERS.favoris, force: ['discrete', 'normale', 'spectaculaire'].includes(x.force as string) ? x.force as 'normale' : 'normale', son: x.son === true };
}
export function cleanClicks(c: unknown): Record<string, string> {
  const out: Record<string, string> = { ...DEFAULT_CLICKS };
  if (c && typeof c === 'object') for (const [k, v] of Object.entries(c as Record<string, unknown>)) { const n = Number(k); if (Number.isInteger(n) && n >= 2 && n <= 20 && typeof v === 'string' && CLICK_ACTIONS[v]) { if (v === 'rien') delete out[k]; else out[k] = v; } }
  return out;
}
export function cleanEvents(e: unknown): EventsCfg {
  const x = (e && typeof e === 'object' ? e : {}) as EventsCfg, md = /^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
  const choix: Record<string, boolean> = {}; for (const [k, v] of Object.entries(x.choix ?? {})) if (EVENT_BY_ID[k] && typeof v === 'boolean') choix[k] = v;
  return {
    actif: x.actif !== false, themes: x.themes !== false, choix, pauses: (x.pauses ?? []).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).slice(-200), ramadanSeul: x.ramadanSeul !== false, ramadanSansPouvoirs: x.ramadanSansPouvoirs === true,
    decalageHijri: Math.max(-2, Math.min(2, Math.round(Number(x.decalageHijri) || 0))), anniversaire: md.test(x.anniversaire ?? '') ? x.anniversaire : undefined,
    famille: (x.famille ?? []).filter((f) => f && typeof f.nom === 'string' && md.test(f.date)).map((f) => ({ nom: f.nom.slice(0, 40), date: f.date })).slice(0, 50),
  };
}
/** Marée haute en ce moment ? (Open-Meteo Marine : niveau de la mer de l'heure dans le quart haut de la journée) */
let tide: { at: number; high: boolean } | undefined;
async function highTide(ctx: ModCtx, lat?: number, lon?: number): Promise<boolean> {
  if (lat === undefined || lon === undefined) return false;
  if (tide && Date.now() - tide.at < 30 * 60_000) return tide.high;
  try {
    const r = await (await ctx.fetch(`${s(ctx.settings.mareeApi) || 'https://marine-api.open-meteo.com'}/v1/marine?latitude=${lat}&longitude=${lon}&hourly=sea_level_height_msl&timezone=auto&forecast_days=1`, { signal: AbortSignal.timeout(8000) })).json() as { hourly?: { time: string[]; sea_level_height_msl: Array<number | null> } };
    const lv = (r.hourly?.sea_level_height_msl ?? []).filter((x): x is number => typeof x === 'number'); if (lv.length < 6) throw new Error('pas de marée');
    const h = hourIn(ctx.now(), s(ctx.settings.fuseau) || 'Indian/Mayotte'), cur = r.hourly!.sea_level_height_msl[h] ?? lv[0], lo = Math.min(...lv), hi = Math.max(...lv);
    tide = { at: Date.now(), high: typeof cur === 'number' && cur >= lo + (hi - lo) * 0.75 };
  } catch { tide = { at: Date.now(), high: false }; }
  return tide.high;
}
/** L'heure locale (fuseau réglable, Mayotte par défaut). */
const hourIn = (d: Date, tz: string) => { try { return Number(new Intl.DateTimeFormat('fr-FR', { hour: 'numeric', hourCycle: 'h23', timeZone: tz }).format(d)); } catch { return d.getHours(); } };

export const apparence: Module = (() => {
  const mode = (ctx: ModCtx) => (s(ctx.settings.mode) === 'fixe' ? 'fixe' : 'auto');
  async function meteo(ctx: ModCtx): Promise<Wx | undefined> {
    try { return (await ctx.call('gladsheim', 'meteo', {}, 'choisir le thème selon la météo')).data as Wx | undefined; } catch { return undefined; }
  }
  /** Le thème en ce moment : le choisi, ou l'automatique (au plus un changement par heure, sauf orage). */
  async function now(ctx: ModCtx): Promise<{ mode: 'auto' | 'fixe'; theme: string; why: string; wx?: Wx }> {
    if (mode(ctx) === 'fixe' && THEME_NAMES[s(ctx.settings.theme)]) return { mode: 'fixe', theme: s(ctx.settings.theme), why: 'choisi par toi' };
    const wx = await meteo(ctx), c = autoTheme(hourIn(ctx.now(), s(ctx.settings.fuseau) || 'Indian/Mayotte'), wx);
    const last = ctx.settings.auto as { theme?: string; at?: number; why?: string } | undefined, t = ctx.now().getTime();
    if (last?.theme && last.theme !== c.id && t - (last.at ?? 0) < 3600_000 && c.id !== 'orage') return { mode: 'auto', theme: last.theme, why: last.why ?? '', wx };
    if (last?.theme !== c.id) ctx.saveSettings({ auto: { theme: c.id, at: t, why: c.why } });
    return { mode: 'auto', theme: c.id, why: c.why, wx };
  }
  const others = (cur: string) => ['glace', 'nuit', 'mayotte'].filter((x) => x !== cur).slice(0, 3).map((x) => THEME_NAMES[x]).concat('Au hasard').join(' · ');
  return {
    id: 'apparence', name: 'Apparence', family: 'Maison',
    what: 'Les 20 thèmes d\'Odin : couleurs, décor et couleur d\'Odin au repos, choisis par toi ou selon l\'heure et la météo.',
    does: ['20 thèmes (Glace, Vacances, Paysage, Ciel, Nuit étoilée, Plage, Mayotte…)', 'le même thème sur tous tes écrans', 'automatique : nuit, matin, journée, fin de journée, pluie, orage, chaleur', 'Odin prend la couleur du thème au repos ; ses humeurs gardent leurs couleurs', '« Odin, change ton thème », aussi sur Telegram'],
    from: [], upstream: [],
    words: ['change ton thème', 'change de thème', 'thème d\'odin', 'mets le thème', 'remets automatique', 'thèmes', 'réapparais', 'cache-toi', 'tes pouvoirs', 'pouvoirs d\'odin', 'prochaines fêtes', 'événements de l\'année'],
    actions: [
      { id: 'etat', label: 'Thème actuel', what: 'Le thème d\'Odin en ce moment, et pourquoi', read: true, quiet: true, words: ['quel thème', 'thème actuel'], run: async (ctx) => {
        const n = await now(ctx); return { text: `🎨 Thème : ${THEME_NAMES[n.theme]} (${n.mode === 'auto' ? `automatique : ${n.why}` : 'choisi par toi'}).`, data: { mode: n.mode, theme: n.theme, name: THEME_NAMES[n.theme], why: n.why } };
      } },
      { id: 'theme', label: 'Changer de thème', what: 'Un thème au choix, « automatique » (heure et météo) ou « au hasard » ; sans précision, Odin choisit celui qui va avec le temps qu\'il fait', params: [{ key: 'theme', label: 'Thème', kind: 'select', options: ['automatique', 'au hasard', ...IDS], default: '' }],
        words: ['change ton thème', 'change de thème', 'mets le thème', 'remets automatique', 'thème automatique'], run: async (ctx, i) => {
          const want = s(i.theme).trim().toLowerCase(), before = (await now(ctx)).theme;
          if (/^auto/.test(want)) { ctx.saveSettings({ mode: 'auto', auto: undefined }); const n = await now(ctx); return { text: `🎨 Automatique : en ce moment ${THEME_NAMES[n.theme]} (${n.why}). Il changera selon l'heure et la météo.`, data: { mode: 'auto', theme: n.theme } }; }
          let id = IDS.find((x) => x === want) ?? IDS.find((x) => THEME_NAMES[x].toLowerCase() === want || THEME_NAMES[x].toLowerCase().startsWith(want) && want.length >= 3);
          let why = '';
          if (!id && /hasard/.test(want)) id = IDS.filter((x) => x !== before && x !== 'valhalla')[Math.floor(Math.random() * (IDS.length - 2))];
          if (!id && want) throw new Error(`thème inconnu : « ${want} » (${IDS.map((x) => THEME_NAMES[x]).join(', ')})`);
          if (!id) { // « change ton thème » : celui qui va avec le temps, sinon un autre
            const wx = await meteo(ctx), c = autoTheme(hourIn(ctx.now(), s(ctx.settings.fuseau) || 'Indian/Mayotte'), wx);
            id = c.id !== before ? c.id : IDS.filter((x) => x !== before && x !== 'valhalla')[Math.floor(Math.random() * (IDS.length - 2))]; why = c.id === id ? c.why : '';
          }
          ctx.saveSettings({ mode: 'fixe', theme: id });
          return { text: `🎨 Je passe en ${THEME_NAMES[id]}${why ? ` : ${why}` : ''}. Tu en préfères un autre ? ${others(id)}. Dis « remets automatique » pour suivre l'heure et la météo.`, data: { mode: 'fixe', theme: id } };
        } },
      { id: 'mascotte', label: 'Odin : apparence du moment', what: 'Thème, couleur d\'Odin (météo, marée, nuit), événement du jour, clics, pouvoirs : ce que tous tes écrans affichent', read: true, quiet: true, run: async (ctx) => {
        const n = await now(ctx), tz = s(ctx.settings.fuseau) || 'Indian/Mayotte', day = ymd(ctx.now(), tz), ev = cleanEvents(ctx.settings.evenements), m = (ctx.settings.mascotte ?? {}) as { cache?: boolean; clics?: unknown };
        const color = n.mode === 'auto' ? odinColor(hourIn(ctx.now(), tz), n.wx, n.wx ? await highTide(ctx, n.wx.lat, n.wx.lon) : false) : undefined;
        const event = todayEvent(day, ev), p = cleanPowers(ctx.settings.pouvoirs), mute = ev.ramadanSansPouvoirs && inRamadan(day, ev);
        const power = p.choix === 'theme' ? (event?.power ?? powerForTheme[n.theme] ?? 'feu') : p.choix === 'meteo' ? powerForWeather(n.wx) : undefined;
        const data = { mode: n.mode, theme: n.theme, why: n.why, odin: color, event, day, cache: m.cache === true, clics: cleanClicks(m.clics), pouvoirs: { ...p, actif: p.actif && !mute, coupeRamadan: mute, pouvoir: power }, evenements: ev };
        return { text: `🎨 ${THEME_NAMES[n.theme]}${color ? ` · Odin ${color.why}` : ''}${event ? ` · ${event.name}` : ''} · pouvoirs ${data.pouvoirs.actif ? 'activés' : 'coupés'}${data.cache ? ' · Odin caché' : ''}`, data };
      } },
      { id: 'regler_mascotte', label: 'Régler Odin (clics, pouvoirs, événements)', what: 'Enregistre les réglages venus de l\'écran Réglages → Apparence (JSON : mascotte, pouvoirs, evenements)', quiet: true, quick: false,
        params: [{ key: 'reglages', label: 'Réglages (JSON)', kind: 'text', required: true }], run: (ctx, i) => {
          let j: Record<string, unknown>; try { j = JSON.parse(s(i.reglages)) as Record<string, unknown>; } catch { throw new Error('réglages illisibles'); }
          const patch: Record<string, unknown> = {};
          if (j.mascotte && typeof j.mascotte === 'object') { const m = j.mascotte as { cache?: unknown; clics?: unknown }, old = (ctx.settings.mascotte ?? {}) as Record<string, unknown>; patch.mascotte = { ...old, ...(typeof m.cache === 'boolean' ? { cache: m.cache } : {}), ...(m.clics !== undefined ? { clics: cleanClicks(m.clics) } : {}) }; }
          if (j.pouvoirs !== undefined) patch.pouvoirs = cleanPowers({ ...cleanPowers(ctx.settings.pouvoirs), ...(j.pouvoirs as object), quand: { ...cleanPowers(ctx.settings.pouvoirs).quand, ...((j.pouvoirs as PowersCfg).quand ?? {}) } });
          if (j.evenements !== undefined) patch.evenements = cleanEvents({ ...cleanEvents(ctx.settings.evenements), ...(j.evenements as object) });
          if (!Object.keys(patch).length) throw new Error('rien à enregistrer');
          ctx.saveSettings(patch); return { text: '✓ Réglages d\'Odin enregistrés.', data: patch };
        } },
      { id: 'cacher', label: 'Odin se cache', what: 'Odin disparaît de tous tes écrans (il revient par Réglages → Apparence, ou « Odin, reviens »)', words: ['cache-toi partout', 'disparais partout'], run: (ctx) => { ctx.saveSettings({ mascotte: { ...((ctx.settings.mascotte ?? {}) as object), cache: true } }); return { text: '🙈 Je me cache sur tous tes écrans. Pour me revoir : Réglages → Apparence → Odin, ou dis « Odin, reviens ».' }; } },
      { id: 'montrer', label: 'Odin revient', what: 'Odin réapparaît sur tous tes écrans', words: ['réapparais à l\'écran', 'reviens à l\'écran', 'montre-toi'], run: (ctx) => { ctx.saveSettings({ mascotte: { ...((ctx.settings.mascotte ?? {}) as object), cache: false } }); return { text: '👋 Me revoilà !' }; } },
      { id: 'pouvoirs', label: 'Pouvoirs d\'Odin', what: 'Active ou coupe les pouvoirs (animations quand un onglet s\'ouvre ou se ferme, quand tu supprimes…)', params: [{ key: 'etat', label: 'État', kind: 'select', options: ['activer', 'couper'], default: 'activer' }],
        words: ['coupe tes pouvoirs', 'active tes pouvoirs', 'désactive tes pouvoirs', 'pouvoirs d\'odin'], run: (ctx, i) => {
          const on = !/coup|désactiv|desactiv|off|non/i.test(s(i.etat)); ctx.saveSettings({ pouvoirs: { ...cleanPowers(ctx.settings.pouvoirs), actif: on } });
          return { text: on ? '⚡ Pouvoirs activés : je m\'en sers quand un onglet s\'ouvre ou se ferme, et quand tu supprimes quelque chose.' : '✋ Pouvoirs coupés : plus aucun pouvoir, nulle part.' };
        } },
      { id: 'evenements', label: 'Événements de l\'année', what: 'Les prochaines fêtes et anniversaires, et ce qui est activé', read: true, words: ['prochaines fêtes', 'événements de l\'année', 'quelle fête aujourd\'hui'], run: (ctx) => {
        const ev = cleanEvents(ctx.settings.evenements), tz = s(ctx.settings.fuseau) || 'Indian/Mayotte', day = ymd(ctx.now(), tz), t = todayEvent(day, ev), list = upcoming(day, 366, ev);
        const fmt = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', timeZone: 'UTC' });
        return { text: `${t ? `Aujourd'hui : ${t.name}. ` : ''}${ev.actif === false ? 'Événements coupés.' : `Prochains : ${list.filter((e) => e.on && !e.paused).slice(0, 5).map((e) => `${e.name} (${fmt(e.date)})`).join(', ') || 'aucun'}.`}`, data: { today: t, upcoming: list, events: EVENTS.map((e) => ({ id: e.id, name: e.name, group: e.group, color: e.color, on: ev.choix?.[e.id] ?? e.on })) } };
      } },
    ],
    async view(ctx) {
      const n = await now(ctx);
      return {
        subtitle: `${THEME_NAMES[n.theme]} · ${n.mode === 'auto' ? 'automatique' : 'choisi par toi'}`,
        kpis: [{ label: 'Thème', value: THEME_NAMES[n.theme] }, { label: 'Mode', value: n.mode === 'auto' ? 'Automatique' : 'Choisi', hint: n.why }],
        sections: [
          { kind: 'cards', title: 'Les 20 thèmes', items: IDS.map((id) => ({ title: THEME_NAMES[id], badge: id === n.theme ? 'en ce moment' : undefined, tone: id === n.theme ? 'bon' as const : 'neutre' as const, actions: id === n.theme ? [] : [{ action: 'theme', label: 'Choisir', input: { theme: id } }] })) },
          { kind: 'text', title: 'En automatique', text: '21 h – 6 h : Nuit étoilée · 6 h – 9 h : Paysage · journée, beau temps : Ciel, puis Plage l\'après-midi · 17 h – 19 h : Coucher de soleil · pluie : Pluie · orage ou cyclone : Orage · plus de 32° : Glace · ciel couvert : Forêt · sinon : Mayotte. Au plus un changement par heure, en fondu ; une alerte grave reste toujours rouge.' },
        ],
      };
    },
  };
})();
