// Apparence · les thèmes d'Odin (maquettes validées ; 7 thèmes et 6 de température ajoutés le 15/11/2026). Le choix est
// gardé par Odin (le même sur tous tes écrans), se change dans les Réglages, en parlant (« Odin, change ton thème »,
// « mets le thème glace », « remets automatique », aussi sur Telegram), ou tout seul. En automatique, dans l'ordre :
//   1. le thème du calendrier (Nouvel An, Pâques, 1er mai, Noël… : un thème fixe qui revient chaque année ce jour-là,
//      posé par l'interface d'après l'événement du jour, voir fetes.ts et themes.js) ;
//   2. le temps qu'il fait : orage, pluie, neige, brouillard, grand vent ;
//   3. la température, quand elle sort de l'ordinaire : gel, froid, frais, chaud, torride, canicule ;
//   4. sinon le moment de la journée (veille de l'aube 3 h – 6 h, jour, après-midi, soir, nuit), dont le thème varie
//      selon l'humeur d'Odin (tranquille, joyeux, ou plus doux quand il est fatigué ou triste).
// La météo, la température et l'humeur changent le thème au plus une fois par heure (sauf orage). Odin prend toujours
// la couleur du thème affiché (sauf alerte grave). Couleurs et décors : themes.js ; ici, le choix et la règle automatique.
import type { ModCtx, Module } from '../types.ts';
import { CLICK_CATALOG, cleanClicks2 } from '../clics.ts';
import { EVENTS, EVENT_BY_ID, todayEvent, upcoming, ymd, type EventsCfg } from '../fetes.ts';
import { currentMood, humeurVive, socle } from '../../mood/mood.ts';
import { lieuCourant } from '../lieu.ts';

const s = (x: unknown) => (typeof x === 'string' ? x : x === undefined || x === null ? '' : String(x));
// Les textes de ce module qui parlent des familles et de la question « lequel ? » (en tête, pour les traduire d'un
// seul endroit). Les titres des familles sont ceux de Réglages → Apparence (src/web/themes.js).
export const TEXTES = {
  familles: { enavant: 'Mis en avant', odin: 'Les thèmes d\'Odin', hestia: 'Thèmes de Hestia', evenements: 'Événements de l\'année' },
  // Le mot court qui désigne une famille après un nom (« Neige Hestia ») : il sert d'exemple dans la question.
  court: { enavant: 'en avant', odin: 'Odin', hestia: 'Hestia', evenements: 'fête' },
  // Les mots qui, dits avec un nom, désignent une famille (« neige de la maison », « néon mis en avant »). Comparés
  // sans accents ni casse ; le titre et le mot court de la famille comptent aussi.
  mots: { enavant: ['mis en avant'], odin: [], hestia: ['maison'], evenements: ['evenement', 'evenements'] } as Record<string, string[]>,
  nomEtFamille: '{nom} ({famille})',
  liste: ', ',
  // {n} : le nombre de thèmes ; {nom} : ce qui a été dit ; {liste} : chaque thème avec sa famille ; {exemple} : un nom
  // qui ne laisse pas de doute.
  question: '{n} thèmes répondent à « {nom} » : {liste}. Lequel ? Dis par exemple « mets le thème {exemple} ».',
  humeurCoupee: 'En automatique, l\'humeur d\'Odin ne change plus le thème.',
  humeurMise: 'En automatique, l\'humeur d\'Odin peut changer le thème (au plus une fois par heure).',
};
const remplir = (modele: string, v: Record<string, string | number>) => modele.replace(/\{(\w+)\}/g, (x, k: string) => (k in v ? String(v[k]) : x));
/** Un mot comparé sans accents ni casse, dans toutes les écritures (lettres et chiffres gardés, le reste devient espace). */
export const plat = (x: string) => x.normalize('NFD').replace(/\p{M}+/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
export const THEME_NAMES: Record<string, string> = {
  glace: 'Glace', vacances: 'Vacances', paysage: 'Paysage', ciel: 'Ciel', nuit: 'Nuit étoilée', aurore: 'Aurore boréale', ocean: 'Océan', plage: 'Plage et palmiers', foret: 'Forêt', montagne: 'Montagne',
  coucher: 'Coucher de soleil', desert: 'Désert', pluie: 'Pluie', orage: 'Orage', neige: 'Neige', mayotte: 'Mayotte', printemps: 'Printemps fleuri', automne: 'Automne', espace: 'Espace',
  veille: 'Veille de l\'aube', lagon: 'Lagon', volcan: 'Volcan', savane: 'Savane', lavande: 'Lavande', cerisier: 'Cerisiers', minuit: 'Minuit',
  gel: 'Gel (0° et moins)', froid: 'Froid (1° à 9°)', frais: 'Frais (10° à 17°)', chaud: 'Chaud (28° à 31°)', torride: 'Torride (32° à 35°)', canicule: 'Canicule (36° et plus)',
  valhalla: 'Valhalla (classique)',
  // Les thèmes « Mis en avant » de la maquette validée qui n'existaient pas encore (mêmes identifiants et mêmes noms
  // que src/web/pages/themes-catalogue.js ; « glace » y est aussi, sous son identifiant d'avant).
  vitre: 'Vitre', glacenuit: 'Glace nuit', neon: 'Néon', ha: 'Home Assistant', clair: 'Maison claire',
  // Les 31 thèmes de Hestia (mêmes identifiants h-… et mêmes noms que src/web/pages/themes-catalogue.js : ceux que
  // l'écran de la maison leur donne). Un nom pris aussi par un thème d'avant : en parlant, c'est le thème d'avant.
  'h-verre': 'Verre sombre (tuiles colorées)', 'h-nuit': 'Bleu nuit', 'h-braise': 'Braise (orange)', 'h-acier': 'Acier (gris bleuté)',
  'h-mural': 'Tablette murale (noir et cyan)', 'h-crepuscule': 'Crépuscule (paysage)', 'h-classique': 'Classique (comme Home Assistant)',
  'h-violet': 'Violet', 'h-aurore': 'Aurore (violet et soleil)', 'h-lagon': 'Lagon (bleu-vert)', 'h-clair': 'Clair',
  'h-ocean': 'Bleu océan', 'h-blanc': 'Blanc pur', 'h-rubis': 'Rouge rubis', 'h-foret': 'Vert forêt', 'h-soleil': 'Jaune soleil',
  'h-plage': 'Plage (palmier)', 'h-etoiles': 'Ciel étoilé', 'h-boreale': 'Aurore boréale', 'h-mayotte': 'Lagon de Mayotte', 'h-coucher': 'Coucher de soleil',
  'h-montagne': 'Montagne et brume', 'h-tropical': 'Forêt tropicale', 'h-desert': 'Désert', 'h-neige': 'Neige', 'h-abysses': 'Océan profond',
  'h-neon': 'Néon', 'h-bois': 'Bois et lin', 'h-graphite': 'Graphite', 'h-pastel': 'Pastel', 'h-espace': 'Espace',
  // Les 16 thèmes des événements de l'année (mêmes identifiants et mêmes noms que EVENT_THEMES dans themes.js) :
  // ils se choisissent comme les autres, mais « au hasard » ne tombe jamais dessus.
  'ev-noel': 'Noël', 'ev-nouvelan': 'Nouvel An', 'ev-carnaval': 'Carnaval', 'ev-paques': 'Pâques', 'ev-abolition': '27 avril', 'ev-travail': '1er mai',
  'ev-musique': 'Fête de la musique', 'ev-nationale': '14 juillet', 'ev-ramadan': 'Ramadan', 'ev-aidfitr': 'Aïd el-Fitr', 'ev-aidkebir': 'Aïd el-Kébir',
  'ev-valentin': 'Saint-Valentin', 'ev-patrick': 'Saint-Patrick', 'ev-halloween': 'Halloween', 'ev-thanksgiving': 'Thanksgiving', 'ev-anniversaire': 'Anniversaire',
};
const IDS = Object.keys(THEME_NAMES);
/** Les thèmes d'Odin, sans ceux des événements. */
const ODIN_IDS = IDS.filter((x) => !x.startsWith('ev-'));
/** Les thèmes « Mis en avant » de la maquette validée (mêmes que src/web/pages/themes-catalogue.js, sans Hestia). */
const EN_AVANT = new Set(['glace', 'vitre', 'glacenuit', 'neon', 'ha', 'clair']);
export type Famille = keyof typeof TEXTES.familles;
/** La famille d'un thème, comme dans Réglages → Apparence. */
export const familleDe = (id: string): Famille => (id.startsWith('ev-') ? 'evenements' : id.startsWith('h-') ? 'hestia' : EN_AVANT.has(id) ? 'enavant' : 'odin');
/** Les familles dans l'ordre de Réglages → Apparence, avec leurs thèmes. */
export const FAMILLES = (Object.keys(TEXTES.familles) as Famille[]).map((f) => ({ id: f, titre: TEXTES.familles[f], ids: IDS.filter((x) => familleDe(x) === f) }));
// Les noms, comparés sans accents ni casse : un nom porté par deux thèmes (« Neige » d'Odin et de Hestia) ; un
// identifiant qui s'écrit comme le nom d'un autre thème (« neige », « clair ») : dit, il ne désigne pas sûrement le sien.
const PAR_NOM = new Map<string, string[]>();
for (const x of IDS) { const k = plat(THEME_NAMES[x]); PAR_NOM.set(k, [...(PAR_NOM.get(k) ?? []), x]); }
const partage = (x: string) => (PAR_NOM.get(plat(THEME_NAMES[x])) ?? []).length > 1;
const heurte = (x: string) => (PAR_NOM.get(plat(x)) ?? []).some((y) => y !== x);
/** Les mots d'une famille (titre, mot court, autres mots), sans accents ni casse. */
const motsDe = (f: Famille) => [TEXTES.familles[f], TEXTES.court[f], ...(TEXTES.mots[f] ?? [])].map(plat).filter(Boolean);
/** Le nom d'un thème qui ne laisse pas de doute : le nom seul s'il est unique, sinon le nom et le mot court de sa famille. */
const nomSur = (x: string) => (partage(x) ? `${THEME_NAMES[x]} ${TEXTES.court[familleDe(x)]}` : THEME_NAMES[x]);
/**
 * Ce que désigne `brut` : un thème sûr, plusieurs (Odin demande lequel), ou rien. Dans l'ordre : l'identifiant exact
 * (celui qu'envoient les cartes et les listes) ; puis, sans accents ni casse, le nom exact ; le nom avec un mot de sa
 * famille ; l'identifiant écrit autrement ; le début d'un nom (3 lettres au moins). Jamais un choix au hasard entre deux.
 */
export function trouverTheme(brut: string): { id: string } | { choix: string[] } | undefined {
  const exact = IDS.find((x) => x === brut.trim()); if (exact) return { id: exact };
  const w = plat(brut); if (!w) return undefined;
  const un = (l: string[]) => (l.length === 1 ? { id: l[0] } : l.length ? { choix: l } : undefined);
  const parNom = IDS.filter((x) => plat(THEME_NAMES[x]) === w); if (parNom.length) return un(parNom);
  const avecFamille = IDS.filter((x) => {
    const n = plat(THEME_NAMES[x]); if (!(w.startsWith(`${n} `) || w.endsWith(` ${n}`))) return false;
    const reste = ` ${w.startsWith(`${n} `) ? w.slice(n.length) : w.slice(0, -n.length)} `;
    return motsDe(familleDe(x)).some((m) => reste.includes(` ${m} `));
  });
  if (avecFamille.length) return un(avecFamille);
  const parId = IDS.find((x) => plat(x) === w); if (parId) return { id: parId };
  return w.length >= 3 ? un(IDS.filter((x) => plat(THEME_NAMES[x]).startsWith(w))) : undefined;
}
/** Le nom d'un thème dans une réponse : avec sa famille quand un autre thème porte le même nom. */
const nomDit = (x: string) => (partage(x) ? remplir(TEXTES.nomEtFamille, { nom: THEME_NAMES[x], famille: TEXTES.familles[familleDe(x)] }) : THEME_NAMES[x]);
/** La question quand plusieurs thèmes répondent : chacun avec sa famille, et un exemple sûr. Rien n'est changé. */
function question(brut: string, choix: string[]) {
  const liste = choix.map((x) => remplir(TEXTES.nomEtFamille, { nom: THEME_NAMES[x], famille: TEXTES.familles[familleDe(x)] })).join(TEXTES.liste);
  // (dans la liste, chaque thème dit sa famille, même un nom unique : c'est elle qui aide à choisir)
  const exemple = nomSur(choix[choix.length - 1]);
  // (ce qui a été dit est redit tel quel, mais pas plus long qu'un nom : un texte sans fin ne s'y recopie pas)
  const dit = [...brut.trim()].slice(0, 60).join('');
  return { text: `🎨 ${remplir(TEXTES.question, { n: choix.length, nom: dit, liste, exemple })}`, data: { question: true, nom: dit, choix: choix.map((x) => ({ id: x, nom: THEME_NAMES[x], famille: familleDe(x), titreFamille: TEXTES.familles[familleDe(x)], exemple: nomSur(x) })) } };
}
// Ce qu'on peut dire pour « Thème » : les identifiants, sauf ceux qui s'écrivent comme le nom d'un autre thème ;
// les noms en double, et chacun avec le mot court de sa famille (« Neige Hestia »). La parole sans IA prend, dans
// cette liste, la plus longue qui est dans la phrase : chaque nom y est donc (sinon « Bleu océan » donnait l'Océan
// d'Odin, « Forêt tropicale » la Forêt, « Aïd el-Kébir » l'Aïd el-Fitr), aussi sans ses parenthèses et sans ses
// traits d'union (on ne les dit pas : « Lagon bleu-vert », « Saint Patrick ») ; et le premier mot de plusieurs noms
// quand ce n'est pas un identifiant (« Bleu », « Aïd », « Saint ») : Odin demande lequel, au lieu d'en prendre un.
const GARDES = IDS.filter((x) => !heurte(x));
const sansParentheses = (n: string) => n.replace(/[()]/g, ' ').replace(/\s+/g, ' ').trim();
const sansTraits = (n: string) => sansParentheses(n).replace(/-/g, ' ');
const premiersMots = [...new Set(IDS.map((x) => THEME_NAMES[x].split(/[\s(-]+/)[0]))].filter((m) => plat(m).length >= 3 && !IDS.includes(plat(m)) && !PAR_NOM.has(plat(m))
  && IDS.filter((x) => plat(THEME_NAMES[x]).startsWith(`${plat(m)} `)).length > 1);
const OPTIONS_THEMES = [...new Set([...GARDES,
  ...IDS.map((x) => THEME_NAMES[x]).filter((n) => !GARDES.includes(plat(n))), ...IDS.flatMap((x) => [sansParentheses(THEME_NAMES[x]), sansTraits(THEME_NAMES[x])]).filter((n) => !GARDES.includes(plat(n))),
  ...IDS.filter(partage).map(nomSur), ...premiersMots])];
/** « Odin change de thème selon son humeur » (Réglages → Apparence) : mis par défaut, comme avant. */
const humeurJoue = (ctx: ModCtx) => ctx.settings.humeurTheme !== false;
/** L'humeur que voit la règle automatique : celle d'Odin si l'interrupteur est mis, sinon « neutre » (elle ne joue plus). */
const humeurPourTheme = (ctx: ModCtx) => (humeurJoue(ctx) ? currentMood(ctx.now().getTime()) : 'neutre');
/** « Au hasard » : un thème d'Odin, jamais un événement, ni Valhalla, ni le thème en cours. */
const auHasard = (avant: string) => { const l = ODIN_IDS.filter((x) => x !== avant && x !== 'valhalla'); return l[Math.floor(Math.random() * l.length)]; };
interface Wx { place?: string; temp?: number; code?: number; wind?: number; lat?: number; lon?: number; /** fuseau du lieu d'Odin (Hestia) */ fuseau?: string }
/** Le fuseau horaire : celui réglé ici, sinon celui du lieu d'Odin (Hestia : « ma ville est … »), sinon Mayotte. */
/** Le fuseau quand rien d'autre n'est connu. */
export const FUSEAU_PAR_DEFAUT = 'Indian/Mayotte';
const fuseauDe = (ctx: ModCtx, wx?: Wx) => s(ctx.settings.fuseau) || s(lieuCourant()?.fuseau) || s(wx?.fuseau) || FUSEAU_PAR_DEFAUT;
/** Les fêtes proposées d'office suivent le pays où est Odin ; ce que tu as choisi toi-même passe avant. */
const selonLePays = (ev: EventsCfg): EventsCfg => ({ ...ev, choix: { ...(lieuCourant()?.region.fetes ?? {}), ...(ev.choix ?? {}) } });
const wordOf = (c?: number) => (c === undefined ? '' : c <= 1 ? 'beau' : c <= 3 ? 'nuageux' : c <= 48 ? 'brumeux' : c <= 67 || (c >= 80 && c <= 82) ? 'pluvieux' : c <= 77 || c === 85 || c === 86 ? 'neigeux' : 'orageux');

/**
 * Les moments de la journée (décision du 15/11/2026) et leurs thèmes selon l'humeur d'Odin :
 * [tranquille ou concentré, joyeux, plus doux (fatigué, triste, inquiet)].
 */
export const MOMENTS: Array<{ from: number; to: number; ids: [string, string, string]; why: string }> = [
  { from: 3, to: 6, ids: ['veille', 'aurore', 'minuit'], why: 'c\'est la veille de l\'aube (3 h – 6 h)' },
  { from: 6, to: 12, ids: ['ciel', 'printemps', 'paysage'], why: 'c\'est le jour (6 h – 12 h)' },
  { from: 12, to: 17, ids: ['plage', 'vacances', 'lagon'], why: 'c\'est l\'après-midi (12 h – 17 h)' },
  { from: 17, to: 21, ids: ['coucher', 'cerisier', 'lavande'], why: 'c\'est le soir (17 h – 21 h)' },
  { from: 21, to: 27, ids: ['nuit', 'espace', 'minuit'], why: 'c\'est la nuit (21 h – 3 h)' },
];
const JOYEUX = new Set(['joie', 'rire', 'amour', 'fierte', 'excite', 'clin', 'malice', 'surprise']);
const DOUX = new Set(['triste', 'fatigue', 'inquiet', 'peur', 'gene', 'confus']);
/** Les températures et leur thème (en dehors de 18° à 27°, où l'heure décide). */
export const TEMPERATURES: Array<{ max: number; id: string }> = [
  { max: 0, id: 'gel' }, { max: 9, id: 'froid' }, { max: 17, id: 'frais' }, { max: 27, id: '' }, { max: 31, id: 'chaud' }, { max: 35, id: 'torride' }, { max: Infinity, id: 'canicule' },
];
/** Les thèmes imposés par le temps ou la température : ils changent au plus une fois par heure (sauf orage). */
const METEO = new Set(['orage', 'pluie', 'neige', 'foret', 'ocean', ...TEMPERATURES.map((t) => t.id).filter(Boolean)]);
/** Le thème automatique : le temps, puis la température, puis le moment de la journée selon l'humeur. Pur. */
export function autoTheme(hour: number, w?: Wx, humeur = 'neutre'): { id: string; why: string } {
  const c = w?.code, t = w?.temp, at = w?.place ? ` à ${w.place}` : '';
  if (c !== undefined && c >= 95) return { id: 'orage', why: `orage${at}` };
  if (c !== undefined && ((c >= 51 && c <= 67) || (c >= 80 && c <= 82))) return { id: 'pluie', why: `il pleut${at}` };
  if (c !== undefined && ((c >= 71 && c <= 77) || c === 85 || c === 86)) return { id: 'neige', why: `il neige${at}` };
  if (c !== undefined && (c === 45 || c === 48)) return { id: 'foret', why: `brouillard${at}` };
  if (w?.wind !== undefined && w.wind >= 50) return { id: 'ocean', why: `grand vent (${w.wind} km/h)${at}` };
  if (t !== undefined) { const b = TEMPERATURES.find((x) => t <= x.max); if (b?.id) return { id: b.id, why: `il fait ${t}°${at}` }; }
  const h = hour < 3 ? hour + 24 : hour, m = MOMENTS.find((x) => h >= x.from && h < x.to) ?? MOMENTS[1];
  const i = JOYEUX.has(socle(humeur)) ? 1 : DOUX.has(socle(humeur)) ? 2 : 0; // une émotion de la palette compte comme son socle
  return { id: m.ids[i], why: `${m.why}${i ? `, Odin est ${i === 1 ? 'joyeux' : 'd\'humeur douce'}` : ''}` };
}
/** Ce que font les clics rapides sur Odin (maquette validée) ; chaque nombre se règle. */
export const CLICK_ACTIONS: Record<string, string> = { rien: 'Rien', rire: 'Il rit', phrase: 'Une phrase', avertir: 'Il prévient', cacher: 'Se cacher partout', muet: 'Couper sa voix', theme: 'Thème au hasard', redemarrer: 'Proposer de redémarrer' };
export const DEFAULT_CLICKS: Record<string, string> = { 5: 'rire', 7: 'phrase', 8: 'avertir', 10: 'cacher', 12: 'muet', 15: 'theme', 20: 'redemarrer' };
export function cleanClicks(c: unknown): Record<string, string> {
  const out: Record<string, string> = { ...DEFAULT_CLICKS };
  if (c && typeof c === 'object') for (const [k, v] of Object.entries(c as Record<string, unknown>)) { const n = Number(k); if (Number.isInteger(n) && n >= 2 && n <= 20 && typeof v === 'string' && CLICK_ACTIONS[v]) { if (v === 'rien') delete out[k]; else out[k] = v; } }
  return out;
}
export function cleanEvents(e: unknown): EventsCfg {
  const x = (e && typeof e === 'object' ? e : {}) as EventsCfg, md = /^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
  const choix: Record<string, boolean> = {}; for (const [k, v] of Object.entries(x.choix ?? {})) if (EVENT_BY_ID[k] && typeof v === 'boolean') choix[k] = v;
  return {
    actif: x.actif !== false, themes: x.themes !== false, choix, pauses: (x.pauses ?? []).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).slice(-200), ramadanSeul: x.ramadanSeul !== false,
    decalageHijri: Math.max(-2, Math.min(2, Math.round(Number(x.decalageHijri) || 0))), anniversaire: md.test(x.anniversaire ?? '') ? x.anniversaire : undefined,
    famille: (x.famille ?? []).filter((f) => f && typeof f.nom === 'string' && md.test(f.date)).map((f) => ({ nom: f.nom.slice(0, 40), date: f.date })).slice(0, 50),
  };
}
/**
 * « Transparence du verre » (maquette validée : un curseur de 0 à 100, gardé pour chaque thème) : la valeur choisie par
 * thème, nettoyée — un thème connu (pas Valhalla, qui n'a pas de verre), un nombre ramené entre 0 et 100, arrondi.
 * Un thème sans valeur garde sa transparence de départ. La limite de lisibilité de chaque thème est tenue par la page
 * (src/web/themes.js) : la carte n'y devient jamais plus transparente que ce que ses textes supportent.
 */
export function cleanVerre(x: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!x || typeof x !== 'object' || Array.isArray(x)) return out;
  for (const [k, v] of Object.entries(x as Record<string, unknown>)) {
    if (!IDS.includes(k) || k === 'valhalla' || typeof v !== 'number' || !Number.isFinite(v)) continue;
    out[k] = Math.round(Math.max(0, Math.min(100, v)));
  }
  return out;
}
/**
 * Les réglages envoyés à « regler_mascotte » parlent-ils du verre ou du fond animé ? (ces réglages-là sont réservés au
 * propriétaire). « Fond animé » (maquette validée : le fond qui vit derrière l'accueil) : oui ou non, oui sans réglage.
 */
const parleDuVerre = (i: Record<string, unknown>) => { try { const j = JSON.parse(s(i.reglages)) as unknown; return Boolean(j && typeof j === 'object' && ('verre' in j || 'fondAnime' in j)); } catch { return false; } };
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
    const wx = await meteo(ctx), c = autoTheme(hourIn(ctx.now(), fuseauDe(ctx, wx)), wx, humeurPourTheme(ctx));
    const last = ctx.settings.auto as { theme?: string; at?: number; why?: string } | undefined, t = ctx.now().getTime();
    // La météo change au plus une fois par heure (sauf orage) ; le moment de la journée change à l'heure dite.
    // Changement d'humeur dans le même moment de la journée : au plus une fois par heure aussi.
    const memeMoment = MOMENTS.some((x) => x.ids.includes(c.id) && x.ids.includes(last?.theme ?? ''));
    const parMeteo = METEO.has(c.id) || METEO.has(last?.theme ?? '') || memeMoment;
    if (parMeteo && last?.theme && last.theme !== c.id && t - (last.at ?? 0) < 3600_000 && c.id !== 'orage') return { mode: 'auto', theme: last.theme, why: last.why ?? '', wx };
    if (last?.theme !== c.id) ctx.saveSettings({ auto: { theme: c.id, at: t, why: c.why } });
    return { mode: 'auto', theme: c.id, why: c.why, wx };
  }
  const others = (cur: string) => ['glace', 'nuit', 'mayotte'].filter((x) => x !== cur).slice(0, 3).map((x) => THEME_NAMES[x]).concat('Au hasard').join(' · ');
  return {
    id: 'apparence', name: 'Apparence', family: 'Maison',
    what: `Les ${ODIN_IDS.length} thèmes d'Odin : couleurs, décor et couleur d'Odin, choisis par toi ou selon l'heure et la météo.`,
    does: [`${ODIN_IDS.length} thèmes, dont 6 de température (gel, froid, frais, chaud, torride, canicule), plus ceux des fêtes du calendrier`, 'le même thème sur tous tes écrans', 'automatique : la fête du jour, puis le temps, la température, et sinon l\'heure selon l\'humeur d\'Odin', 'Odin prend toujours la couleur du thème ; ses humeurs ne le colorent qu\'un instant', '« Odin, change ton thème », aussi sur Telegram'],
    from: [], upstream: [],
    words: ['change ton thème', 'change de thème', 'thème d\'odin', 'mets le thème', 'remets automatique', 'thèmes', 'réapparais', 'cache-toi', 'prochaines fêtes', 'événements de l\'année'],
    actions: [
      { id: 'etat', label: 'Thème actuel', what: 'Le thème d\'Odin en ce moment, et pourquoi', read: true, quiet: true, words: ['quel thème', 'thème actuel'], run: async (ctx) => {
        const n = await now(ctx); return { text: `🎨 Thème : ${THEME_NAMES[n.theme]} (${n.mode === 'auto' ? `automatique : ${n.why}` : 'choisi par toi'}).`, data: { mode: n.mode, theme: n.theme, name: THEME_NAMES[n.theme], why: n.why } };
      } },
      { id: 'theme', label: 'Changer de thème', what: 'Un thème au choix, « automatique » (heure et météo) ou « au hasard » ; sans précision, Odin choisit celui qui va avec le temps qu\'il fait', params: [{ key: 'theme', label: 'Thème', kind: 'select', options: ['automatique', 'au hasard', ...OPTIONS_THEMES], default: '' }],
        words: ['change ton thème', 'change de thème', 'mets le thème', 'remets automatique', 'thème automatique'], run: async (ctx, i) => {
          const brut = s(i.theme).trim(), want = plat(brut), before = (await now(ctx)).theme, exact = IDS.includes(brut);
          if (!exact && (want === 'auto' || want.startsWith('automati'))) { ctx.saveSettings({ mode: 'auto', auto: undefined }); const n = await now(ctx); return { text: `🎨 Automatique : en ce moment ${THEME_NAMES[n.theme]} (${n.why}). Il changera selon l'heure et la météo.`, data: { mode: 'auto', theme: n.theme } }; }
          // Plusieurs thèmes répondent (un nom porté par deux familles) : Odin les cite avec leur famille et demande
          // lequel, sans rien changer. Un identifiant exact ne pose pas de question.
          const t = exact ? { id: brut } : /hasard/.test(want) ? undefined : trouverTheme(brut);
          if (t && 'choix' in t) return question(brut, t.choix);
          let id = t?.id;
          let why = '';
          if (!id && /hasard/.test(want)) id = auHasard(before);
          // (« 🌙 » ou « ??? » ne se ramène à aucun mot : c'est inconnu, pas « sans précision » — rien ne change)
          if (!id && brut) throw new Error(`thème inconnu : « ${[...brut].slice(0, 60).join('')} » (${IDS.map((x) => THEME_NAMES[x]).join(', ')})`);
          if (!id) { // « change ton thème » : celui qui va avec le temps, sinon un autre
            const wx = await meteo(ctx), c = autoTheme(hourIn(ctx.now(), fuseauDe(ctx, wx)), wx, humeurPourTheme(ctx));
            id = c.id !== before ? c.id : auHasard(before); why = c.id === id ? c.why : '';
          }
          ctx.saveSettings({ mode: 'fixe', theme: id });
          return { text: `🎨 Je passe en ${nomDit(id)}${why ? ` : ${why}` : ''}. Tu en préfères un autre ? ${others(id)}. Dis « remets automatique » pour suivre l'heure et la météo.`, data: { mode: 'fixe', theme: id } };
        } },
      { id: 'mascotte', label: 'Odin : apparence du moment', what: 'Thème (Odin en prend la couleur), événement du jour, clics : ce que tous tes écrans affichent', read: true, quiet: true, run: async (ctx) => {
        const n = await now(ctx), tz = fuseauDe(ctx, n.wx ?? await meteo(ctx)), day = ymd(ctx.now(), tz), ev = selonLePays(cleanEvents(ctx.settings.evenements)), m = (ctx.settings.mascotte ?? {}) as { cache?: boolean; clics?: unknown; clics2?: unknown; clicsOn?: boolean };
        // Odin prend la couleur du thème affiché : plus de couleur à part selon la météo (décision du 15/11/2026).
        const event = todayEvent(day, ev);
        const data = { mode: n.mode, theme: n.theme, why: n.why, event, day, cache: m.cache === true, clics: cleanClicks2(m.clics2), clicsOn: m.clicsOn !== false, clicsCatalogue: CLICK_CATALOG, evenements: ev, humeurTheme: humeurJoue(ctx), humeur: humeurVive(ctx.now().getTime()), maintenant: ctx.now().getTime(), verre: cleanVerre(ctx.settings.verre), fondAnime: ctx.settings.fondAnime !== false };
        return { text: `🎨 ${THEME_NAMES[n.theme]}${event ? ` · ${event.name}` : ''}${data.cache ? ' · Odin caché' : ''}`, data };
      } },
      { id: 'regler_mascotte', label: 'Régler Odin (clics, événements)', what: 'Enregistre les réglages venus de l\'écran Réglages → Apparence (JSON : mascotte, evenements, humeurTheme, verre)', quiet: true, quick: false,
        // La transparence du verre (par thème) et le fond animé (oui / non) : réservés au propriétaire ; le reste ne change pas.
        proprietaireSeul: parleDuVerre,
        params: [{ key: 'reglages', label: 'Réglages (JSON)', kind: 'text', required: true }], run: (ctx, i) => {
          let j: Record<string, unknown>; try { j = JSON.parse(s(i.reglages)) as Record<string, unknown>; } catch { throw new Error('réglages illisibles'); }
          const patch: Record<string, unknown> = {};
          if (j.mascotte && typeof j.mascotte === 'object') { const m = j.mascotte as { cache?: unknown; clics?: unknown; clics2?: unknown; clicsOn?: unknown }, old = (ctx.settings.mascotte ?? {}) as Record<string, unknown>; patch.mascotte = { ...old, ...(typeof m.cache === 'boolean' ? { cache: m.cache } : {}), ...(m.clics !== undefined ? { clics: cleanClicks(m.clics) } : {}), ...(m.clics2 !== undefined ? { clics2: cleanClicks2(m.clics2) } : {}), ...(typeof m.clicsOn === 'boolean' ? { clicsOn: m.clicsOn } : {}) }; }
          if (j.evenements !== undefined) patch.evenements = cleanEvents({ ...cleanEvents(ctx.settings.evenements), ...(j.evenements as object) });
          // « Odin change de thème selon son humeur » : changé, la règle automatique repart tout de suite (sans attendre l'heure).
          if (typeof j.humeurTheme === 'boolean') { patch.humeurTheme = j.humeurTheme; if (j.humeurTheme !== humeurJoue(ctx)) patch.auto = undefined; }
          // « Transparence du verre » : la valeur d'un thème (ou de plusieurs), ajoutée à celles des autres thèmes.
          if (j.verre && typeof j.verre === 'object') { const v = cleanVerre(j.verre); if (Object.keys(v).length) patch.verre = { ...cleanVerre(ctx.settings.verre), ...v }; }
          // « Fond animé » derrière l'accueil : un vrai oui ou non seulement.
          if (typeof j.fondAnime === 'boolean') patch.fondAnime = j.fondAnime;
          if (!Object.keys(patch).length) throw new Error('rien à enregistrer');
          ctx.saveSettings(patch);
          const dit = typeof j.humeurTheme === 'boolean' ? ` ${j.humeurTheme ? TEXTES.humeurMise : TEXTES.humeurCoupee}` : '';
          return { text: `✓ Réglages d'Odin enregistrés.${dit}`, data: patch };
        } },
      { id: 'cacher', label: 'Odin se cache', what: 'Odin disparaît de tous tes écrans (il revient par Réglages → Apparence, ou « Odin, reviens »)', words: ['cache-toi partout', 'disparais partout'], run: (ctx) => { ctx.saveSettings({ mascotte: { ...((ctx.settings.mascotte ?? {}) as object), cache: true } }); return { text: '🙈 Je me cache sur tous tes écrans. Pour me revoir : Réglages → Apparence → Odin, ou dis « Odin, reviens ».' }; } },
      { id: 'montrer', label: 'Odin revient', what: 'Odin réapparaît sur tous tes écrans', words: ['réapparais à l\'écran', 'reviens à l\'écran', 'montre-toi'], run: (ctx) => { ctx.saveSettings({ mascotte: { ...((ctx.settings.mascotte ?? {}) as object), cache: false } }); return { text: '👋 Me revoilà !' }; } },
      { id: 'evenements', label: 'Événements de l\'année', what: 'Les prochaines fêtes et anniversaires, et ce qui est activé', read: true, words: ['prochaines fêtes', 'événements de l\'année', 'quelle fête aujourd\'hui'], run: async (ctx) => {
        const ev = selonLePays(cleanEvents(ctx.settings.evenements)), tz = fuseauDe(ctx, await meteo(ctx)), day = ymd(ctx.now(), tz), t = todayEvent(day, ev), list = upcoming(day, 366, ev);
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
          // Rangés par familles, comme dans Réglages → Apparence (titre et nombre).
          ...FAMILLES.map((f) => ({ kind: 'cards' as const, title: `${f.titre} · ${f.ids.length}`, items: f.ids.map((id) => ({ title: THEME_NAMES[id], badge: id === n.theme ? 'en ce moment' : undefined, tone: id === n.theme ? 'bon' as const : 'neutre' as const, actions: id === n.theme ? [] : [{ action: 'theme', label: 'Choisir', input: { theme: id } }] })) })),
          { kind: 'text', title: 'En automatique', text: `${humeurJoue(ctx) ? TEXTES.humeurMise : TEXTES.humeurCoupee} Calendrier : le thème de la fête du jour (Nouvel An, Pâques, 1er mai, Noël…). Sinon, le temps : orage, pluie, neige, brouillard (Forêt), grand vent (Océan). Sinon, la température : ${TEMPERATURES.filter((x) => x.id).map((x) => THEME_NAMES[x.id]).join(' · ')}. Sinon, l'heure, selon l'humeur d'Odin : ${MOMENTS.map((x) => `${x.from} h – ${x.to % 24} h : ${x.ids.map((i) => THEME_NAMES[i]).join(' / ')}`).join(' · ')}. Odin prend la couleur du thème ; le temps, la température et l'humeur changent le thème au plus une fois par heure ; une alerte grave reste toujours rouge.` },
        ],
      };
    },
  };
})();
