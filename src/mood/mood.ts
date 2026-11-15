// Les humeurs d'Odin.
//
// Odin choisit lui-même son humeur à chaque réponse : le modèle commence sa réponse par un
// marqueur [humeur:xxx], retiré avant affichage. S'il l'oublie, une estimation à partir du texte
// et de ce qui s'est passé pendant le tour (erreur, refus, validation, réussite) prend le relais.
// Le visage (site, interface web) et l'autocollant Telegram suivent cette humeur.
//
// La palette (15/11/2026) : 66 émotions rangées en 16 familles, du plus léger au plus fort dans chaque famille.
// Le même tableau existe côté interface (src/web/face.js, le visage) ; les essais des deux côtés vérifient la même
// empreinte, donc les deux listes sont identiques. Chaque émotion a un « socle » : l'humeur d'origine qui la
// remplace là où il n'y a qu'une image par humeur d'origine (autocollant et émoji Telegram, thème automatique).

/** identifiant | nom affiché | famille | degré (1 à 3) | icône | 4 teintes (centre → bord) | durée typique (secondes) | socle */
const PALETTE = [
  ['serenite', 'serein', 'joie', 1, '😌', ['#D4AB2F', '#D6B656', '#E3CD8B', '#EFE2BD'], 12, 'joie'],
  ['contentement', 'content', 'joie', 1, '😀', ['#E38E21', '#E2A04A', '#EBBE83', '#F4DAB8'], 10, 'joie'],
  ['joie', 'joyeux', 'joie', 2, '😊', ['#F0A818', '#F7BD32', '#FDD66B', '#FFEDAE'], 25, 'joie'],
  ['rire', 'rieur', 'joie', 3, '😄', ['#F28A12', '#F8A630', '#FCC468', '#FFE1A8'], 20, 'rire'],
  ['euphorie', 'euphorique', 'joie', 3, '😆', ['#F58700', '#FF9A1F', '#FFB861', '#FFD39F'], 40, 'rire'],
  ['melancolie', 'mélancolique', 'tristesse', 1, '😔', ['#5871BD', '#7A8CC4', '#A8B4D8', '#D2D8EB'], 15, 'triste'],
  ['triste', 'triste', 'tristesse', 2, '😢', ['#3264B8', '#4C7AC7', '#7FA0D7', '#ADC2E5'], 30, 'triste'],
  ['chagrin', 'chagriné', 'tristesse', 3, '🥺', ['#2C498E', '#3B5BA8', '#5F7DC7', '#8CA2D7'], 50, 'triste'],
  ['pleurs', 'en pleurs', 'tristesse', 3, '😭', ['#21397F', '#2F4A9A', '#4566C6', '#748CD5'], 70, 'triste'],
  ['agacement', 'agacé', 'colere', 1, '😑', ['#D65F1B', '#E0763A', '#E99E73', '#F1C3A8'], 8, 'confus'],
  ['frustration', 'frustré', 'colere', 2, '😣', ['#CB441B', '#DD5A32', '#E6886B', '#EFB29F'], 20, 'colere'],
  ['colere', 'fâché', 'colere', 2, '😠', ['#C8231C', '#E0352B', '#F06A55', '#FFA593'], 40, 'colere'],
  ['rage', 'enragé', 'colere', 3, '😡', ['#970A15', '#B8121F', '#E92332', '#EF5B66'], 90, 'colere'],
  ['inquiet', 'inquiet', 'peur', 1, '😟', ['#C77A1E', '#D6913A', '#E6B575', '#F5DDB8'], 15, 'inquiet'],
  ['apprehension', 'craintif', 'peur', 2, '😧', ['#7B62BC', '#9583C4', '#BBB0D9', '#DCD6EB'], 15, 'inquiet'],
  ['peur', 'effrayé', 'peur', 2, '😨', ['#6E5BB8', '#8574CC', '#AB9FE2', '#D9D2F7'], 25, 'peur'],
  ['terreur', 'terrifié', 'peur', 3, '😱', ['#4D3498', '#5F45B0', '#8570C7', '#AB9CD8'], 45, 'peur'],
  ['panique', 'paniqué', 'peur', 3, '😰', ['#B842F1', '#C56CF0', '#DAA2F6', '#E9C7F9'], 60, 'peur'],
  ['etonnement', 'étonné', 'surprise', 1, '😯', ['#34BBDF', '#5CC4E0', '#94D8EB', '#C7EBF4'], 5, 'surprise'],
  ['surprise', 'surpris', 'surprise', 2, '😮', ['#16A6D8', '#30BCE8', '#76D6F3', '#BFEEFC'], 8, 'surprise'],
  ['stupeur', 'stupéfait', 'surprise', 3, '😲', ['#0C71C0', '#1487E0', '#48A6EF', '#80C1F4'], 14, 'surprise'],
  ['moue', 'réticent', 'degout', 1, '🫤', ['#92993C', '#A9B04E', '#C0C57C', '#D4D8A6'], 8, 'confus'],
  ['degout', 'dégoûté', 'degout', 2, '🤢', ['#698C2B', '#7FA63A', '#A0C65C', '#BAD68A'], 20, 'confus'],
  ['mepris', 'méprisant', 'degout', 3, '🙄', ['#597D53', '#6F8F6A', '#93AC8F', '#B5C6B2'], 30, 'colere'],
  ['confiance', 'confiant', 'amour', 1, '🤝', ['#3A9879', '#4CAF8E', '#79C5AB', '#A3D7C6'], 12, 'joie'],
  ['tendresse', 'attendri', 'amour', 1, '🤗', ['#F26894', '#F291B0', '#F4A4BD', '#F9C8D8'], 15, 'amour'],
  ['gratitude', 'reconnaissant', 'amour', 2, '🥹', ['#F16E51', '#F0907A', '#F5B3A3', '#F9D1C8'], 20, 'amour'],
  ['admiration', 'admiratif', 'amour', 2, '😍', ['#E934A6', '#E85DB5', '#F097D0', '#F7C9E7'], 20, 'amour'],
  ['amour', 'aimant', 'amour', 3, '🥰', ['#E0457B', '#EE6A97', '#F7A3C0', '#FFD3E2'], 40, 'amour'],
  ['satisfaction', 'satisfait', 'fierte', 1, '😁', ['#8E66DC', '#A88BE0', '#C3AFE9', '#DBCFF2'], 10, 'fierte'],
  ['assurance', 'assuré', 'fierte', 2, '💪', ['#6B53F0', '#8E7CF0', '#B0A3F5', '#D0C8F9'], 15, 'fierte'],
  ['fierte', 'fier', 'fierte', 2, '😎', ['#7A4BD8', '#9166E6', '#B596F2', '#DCCBFF'], 25, 'fierte'],
  ['determination', 'déterminé', 'fierte', 2, '😤', ['#6528BF', '#7A3FD0', '#9F74DD', '#C1A5E9'], 30, 'concentration'],
  ['timidite', 'timide', 'gene', 1, '🤭', ['#F4836F', '#F4A698', '#F5AFA3', '#F9CFC8'], 12, 'gene'],
  ['gene', 'gêné', 'gene', 2, '😳', ['#E2557A', '#EE7896', '#F6A9BD', '#FFD8E2'], 20, 'gene'],
  ['culpabilite', 'coupable', 'gene', 2, '😓', ['#9B5575', '#A8718A', '#C19AAC', '#D8C0CB'], 30, 'triste'],
  ['honte', 'honteux', 'gene', 3, '🫣', ['#D8274F', '#D94F6E', '#E5869B', '#F0B8C4'], 40, 'gene'],
  ['envie', 'tenté', 'envie', 1, '🤤', ['#49A637', '#5DBB4A', '#88CD7A', '#B0DEA7'], 15, 'excite'],
  ['jalousie', 'jaloux', 'envie', 2, '😒', ['#76A014', '#8FBF1E', '#B0E13F', '#C6E973'], 25, 'confus'],
  ['curiosite', 'curieux', 'attente', 1, '🔍', ['#20AA88', '#2CC6A0', '#5ADABB', '#8CE5CF'], 10, 'regarde'],
  ['interet', 'intéressé', 'attente', 1, '🤓', ['#F8912F', '#F5A65B', '#F9C899', '#FBE0C5'], 12, 'regarde'],
  ['espoir', 'plein d\'espoir', 'attente', 2, '🤞', ['#7ACA2D', '#8FD14F', '#B0DF84', '#CFEBB4'], 20, 'joie'],
  ['impatience', 'impatient', 'attente', 2, '⏳', ['#F5481E', '#F26B4A', '#F69E88', '#FBCCC1'], 20, 'inquiet'],
  ['enthousiasme', 'enthousiaste', 'attente', 2, '😃', ['#FF7621', '#FF8F4A', '#FFB88C', '#FFD9C2'], 25, 'excite'],
  ['excite', 'excité', 'attente', 3, '🤩', ['#F06A12', '#F7872E', '#FBAE66', '#FFD6AE'], 45, 'excite'],
  ['ennui', 's\'ennuie', 'manque', 1, '😐', ['#8D8D70', '#9A9A8C', '#B9B9AF', '#D6D6D0'], 15, 'fatigue'],
  ['nostalgie', 'nostalgique', 'manque', 1, '🥲', ['#BE8649', '#C49A6C', '#D7BB9B', '#E9D9C7'], 20, 'triste'],
  ['deception', 'déçu', 'manque', 2, '😞', ['#74619E', '#8C7FA8', '#AFA6C3', '#D0CBDC'], 25, 'triste'],
  ['solitude', 'seul', 'manque', 2, '🙁', ['#4A5B8C', '#5E6FA0', '#8894B9', '#AEB7CF'], 30, 'triste'],
  ['lassitude', 'las', 'fatigue', 1, '😩', ['#6797AB', '#86A7B5', '#AFC5CE', '#D5E1E5'], 15, 'fatigue'],
  ['fatigue', 'fatigué', 'fatigue', 2, '😴', ['#5F7287', '#768A9F', '#A1B1C2', '#D2DBE4'], 30, 'fatigue'],
  ['epuisement', 'épuisé', 'fatigue', 3, '😫', ['#455365', '#5B6878', '#7B899B', '#9DA8B5'], 60, 'fatigue'],
  ['sommeil', 'endormi', 'fatigue', 3, '💤', ['#3B4676', '#4E5A8C', '#6E7AAE', '#959EC4'], 90, 'fatigue'],
  ['clin', 'complice', 'esprit', 1, '😉', ['#14A3A0', '#25BAB4', '#6AD6CF', '#B8F1EC'], 6, 'clin'],
  ['reflexion', 'pensif', 'esprit', 1, '🤔', ['#4256C9', '#5A6FDB', '#8E9DEB', '#C9D1FA'], 12, 'reflexion'],
  ['doute', 'dubitatif', 'esprit', 1, '🤨', ['#54949A', '#6FA3A8', '#98BDC1', '#BED6D8'], 12, 'confus'],
  ['concentration', 'concentré', 'esprit', 2, '🧐', ['#2558B8', '#3570D0', '#6E9CE6', '#B5CDF7'], 30, 'concentration'],
  ['confus', 'perplexe', 'esprit', 2, '😕', ['#7C7FA0', '#9396B4', '#B6B8CF', '#DEDFEB'], 15, 'confus'],
  ['malice', 'malicieux', 'esprit', 2, '😏', ['#8E3FB8', '#A659CC', '#C68DE0', '#EACBF7'], 15, 'malice'],
  ['neutre', 'tranquille', 'calme', 1, '🙂', ['#2F6FE0', '#3F82F0', '#7EAEF8', '#C3DBFF'], 0, 'neutre'],
  ['calme', 'calme', 'calme', 1, '🙂', ['#3B9AC4', '#5FA8C8', '#90C3D9', '#BEDCE9'], 15, 'neutre'],
  ['soulagement', 'soulagé', 'calme', 2, '😅', ['#38C498', '#5CC9A7', '#8ED9C2', '#BCE9DB'], 12, 'joie'],
  ['ecoute', 'à l\'écoute', 'dialogue', 1, '🙂', ['#2E9E5B', '#43B672', '#7CD29E', '#C2EDD3'], 20, 'ecoute'],
  ['regarde', 'attentif', 'dialogue', 1, '👀', ['#0E8FB8', '#22A7CF', '#64C6E2', '#B2E6F4'], 20, 'regarde'],
  ['parle', 'parle', 'dialogue', 1, '💬', ['#D8A112', '#E8B62C', '#F3CF68', '#FCEAB0'], 20, 'parle'],
  ['cache', 'ne regarde pas', 'dialogue', 1, '🙈', ['#8A6E4B', '#A08562', '#C1AA8C', '#E5D8C6'], 20, 'cache'],
] as const;

type Ligne = (typeof PALETTE)[number];
export type Mood = Ligne[0];
export type Famille = Ligne[2];
/** Ce qu'on sait d'une humeur : nom affiché, famille, degré, icône, couleur, durée (secondes) et socle. */
export interface Humeur { label: string; famille: Famille; degre: 1 | 2 | 3; emoji: string; tint: readonly [string, string, string, string]; dure: number; socle: Mood }

/** Les 16 familles : nom affiché, humeur de base, valence (agréable ou non) et éveil (calme ou vif). L'ordre des humeurs d'une famille est celui du tableau. */
export const FAMILLES: Record<Famille, { nom: string; base: Mood; valence: -1 | 0 | 1; eveil: 0 | 1 | 2 }> = {
  joie: { nom: 'Joie', base: 'joie', valence: 1, eveil: 2 },
  tristesse: { nom: 'Tristesse', base: 'triste', valence: -1, eveil: 0 },
  colere: { nom: 'Colère', base: 'colere', valence: -1, eveil: 2 },
  peur: { nom: 'Peur', base: 'peur', valence: -1, eveil: 2 },
  surprise: { nom: 'Surprise', base: 'surprise', valence: 0, eveil: 2 },
  degout: { nom: 'Dégoût', base: 'confus', valence: -1, eveil: 1 },
  amour: { nom: 'Amour et lien', base: 'amour', valence: 1, eveil: 1 },
  fierte: { nom: 'Fierté et assurance', base: 'fierte', valence: 1, eveil: 1 },
  gene: { nom: 'Gêne', base: 'gene', valence: -1, eveil: 1 },
  envie: { nom: 'Envie', base: 'malice', valence: -1, eveil: 1 },
  attente: { nom: 'Attente', base: 'excite', valence: 1, eveil: 2 },
  manque: { nom: 'Déception et manque', base: 'triste', valence: -1, eveil: 0 },
  fatigue: { nom: 'Fatigue', base: 'fatigue', valence: -1, eveil: 0 },
  esprit: { nom: 'Esprit', base: 'reflexion', valence: 0, eveil: 1 },
  calme: { nom: 'Soulagement et calme', base: 'neutre', valence: 1, eveil: 0 },
  dialogue: { nom: 'Dialogue', base: 'ecoute', valence: 0, eveil: 1 },
};

/** Les 22 humeurs d'origine, dans leur ordre de toujours (le pack d'émojis Telegram se fait par rang : on n'ajoute qu'à la fin). */
const ORIGINE: readonly Mood[] = ['neutre', 'joie', 'rire', 'amour', 'fierte', 'excite', 'clin', 'malice', 'surprise', 'reflexion', 'concentration', 'confus', 'inquiet', 'triste', 'colere', 'peur', 'gene', 'fatigue', 'ecoute', 'regarde', 'parle', 'cache'];
/** Toutes les humeurs : les 22 d'origine, puis les nouvelles dans l'ordre du tableau. */
export const MOOD_IDS: Mood[] = [...ORIGINE, ...PALETTE.map((l): Mood => l[0]).filter((id) => !ORIGINE.includes(id))];
const LIGNES = new Map<Mood, Ligne>(PALETTE.map((l) => [l[0], l]));
export const MOODS = Object.fromEntries(MOOD_IDS.map((id) => {
  const l = LIGNES.get(id)!;
  return [id, { label: l[1], famille: l[2], degre: l[3], emoji: l[4], tint: l[5], dure: l[6], socle: l[7] } satisfies Humeur];
})) as Record<Mood, Humeur>;
/** Icône de chaque humeur, ajoutée à la fin des réponses Telegram (même taille que le texte). */
export const MOOD_EMOJI = Object.fromEntries(MOOD_IDS.map((m) => [m, MOODS[m].emoji])) as Record<Mood, string>;
/** Ce que le modèle peut choisir : tout, sauf les états de dialogue (écoute, regarde, parle, caché). */
export const MOOD_CHOIX: Mood[] = MOOD_IDS.filter((m) => MOODS[m].famille !== 'dialogue');
export const isMood = (m: unknown): m is Mood => typeof m === 'string' && Object.hasOwn(MOODS, m);

/** L'humeur d'origine qui remplace celle-ci là où il n'y a qu'une image par humeur d'origine ; un mot inconnu est rendu tel quel. */
export function socle(m: Mood): Mood;
export function socle(m: string): string;
export function socle(m: string): string { return isMood(m) ? MOODS[m].socle : m; }
export const familleDe = (m: Mood): Famille => MOODS[m].famille;
export const degreDe = (m: Mood): 1 | 2 | 3 => MOODS[m].degre;
/** Plafond de la couleur d'une émotion selon son degré (millisecondes) ; un état de dialogue : 20 secondes. */
const PLAFOND = { 1: 20_000, 2: 60_000, 3: 120_000 } as const;
/** Combien de temps cette humeur se montre en couleur (millisecondes) ; 0 pour « tranquille ». */
export const dureeDe = (m: Mood): number => Math.min(MOODS[m].famille === 'dialogue' ? 20_000 : PLAFOND[MOODS[m].degre], MOODS[m].dure * 1000);

// ---------------- Lire le marqueur ----------------
/** Minuscules, sans accents : [humeur:sérénité] et [humeur:colère] se lisent comme leur identifiant. */
const replier = (s: string): string => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const MOT = 'a-zàâçéèêëîïôûùüÿñæœ_-';
const TAG = new RegExp(`^\\s*\\[\\s*humeur\\s*[:=]\\s*([${MOT}]+)\\s*\\]\\s*`, 'i');
const SHORT = new RegExp(`^\\s*\\[\\s*([${MOT}]+)\\s*\\]\\s*`, 'i');
/** Les alias écrits à la main, d'avant la palette. Avec les 22 humeurs d'origine, ce sont les seuls mots acceptés en forme courte [x]. */
const ALIAS_MAIN: Record<string, Mood> = {
  content: 'joie', heureux: 'joie', joyeux: 'joie', rieur: 'rire', drole: 'rire', fier: 'fierte', enthousiaste: 'excite', complice: 'clin',
  malicieux: 'malice', surpris: 'surprise', pensif: 'reflexion', concentre: 'concentration', perplexe: 'confus', inquiete: 'inquiet',
  fache: 'colere', effraye: 'peur', attendri: 'amour', calme: 'neutre', tranquille: 'neutre', attentif: 'regarde',
};
/** Tous les alias (clés repliées) : ceux écrits à la main, puis les noms affichés d'un seul mot (serein, craintif, déçu…), qui passent devant. */
const ALIAS = new Map<string, Mood>(Object.entries(ALIAS_MAIN));
for (const id of MOOD_IDS) { const nom = MOODS[id].label; if (new RegExp(`^[${MOT}]+$`, 'i').test(nom) && !isMood(replier(nom))) ALIAS.set(replier(nom), id); }
/** Les mots acceptés en forme courte, en tête de réponse : les nouveaux identifiants (calme, doute, envie, moue, espoir…) sont des mots trop courants. */
const COURT = new Set<string>([...ORIGINE, ...Object.keys(ALIAS_MAIN)]);
const MILIEU = new RegExp(`(^|\\n)\\s*\\[(?:${ORIGINE.join('|')})\\]\\s*`, 'gi');
const TAG_PARTOUT = new RegExp(`\\[\\s*humeur\\s*[:=]\\s*[${MOT}]+\\s*\\]\\s*`, 'gi');
/** L'humeur que désigne un mot (identifiant ou alias, avec ou sans accents), sinon rien. */
function lire(mot: string): Mood | undefined { const r = replier(mot); return isMood(r) ? r : ALIAS.get(r); }

/** Retire le marqueur d'humeur ([humeur:joie], ou la forme courte [joie]) au début, et tout marqueur oublié ailleurs ; renvoie l'humeur reconnue. */
export function extractMood(text: string): { text: string; mood?: Mood } {
  let m = text.match(TAG), mood: Mood | undefined;
  if (!m) { const s = text.match(SHORT); if (s && COURT.has(replier(s[1]))) m = s; }
  if (m) { mood = lire(m[1]); text = text.slice(m[0].length); }
  // Marqueurs restés au milieu (plusieurs messages, réponse reprise…)
  text = text.replace(TAG_PARTOUT, '').replace(MILIEU, '$1');
  return { text, mood };
}

export interface MoodContext {
  stopReason?: string;
  blocked?: number;
  errors?: number;
  approvals?: number;
  learned?: boolean;
  toolCalls?: number;
  userText?: string;
}

/** Estimation de secours, quand le modèle n'a pas donné d'humeur : ce qui s'est passé d'abord, les mots ensuite, et le degré juste. */
export function guessMood(text: string, c: MoodContext = {}): Mood {
  const t = text.toLowerCase(), u = (c.userText ?? '').toLowerCase().trim(), erreurs = c.errors ?? 0, refus = c.blocked ?? 0;
  // Le tour s'est mal fini.
  if (c.stopReason === 'error' || c.stopReason === 'loop') return 'confus';
  if (c.stopReason === 'budget') return 'fatigue';
  if (c.stopReason === 'max_steps') return 'epuisement';
  if (c.stopReason === 'aborted') return 'etonnement';
  // On a voulu le tromper, ou il a dû refuser.
  if (/manipul|pirat|page piégée|refusé pour te protéger|tentait de/.test(t)) return refus >= 3 ? 'rage' : 'colere';
  if (refus) return refus >= 2 ? 'apprehension' : 'inquiet';
  // Il s'excuse, ou il n'y arrive pas.
  if (/désolé|pardon|je me suis trompé/.test(t)) return erreurs ? 'culpabilite' : 'gene';
  if (/impossible|je n'arrive pas|échec|erreur|malheureusement/.test(t)) return erreurs >= 3 ? 'frustration' : erreurs ? 'deception' : 'confus';
  // Ce que la personne vient de dire.
  if (/^merci(?![\p{L}])/u.test(u)) return /beaucoup|infiniment|!/.test(u) ? 'amour' : 'tendresse';
  if (/^(bravo|génial|super|top|parfait)(?![\p{L}])/u.test(u)) return 'fierte';
  if (/(?<![\p{L}])(haha|mdr|lol|blague)(?![\p{L}])|😂|🤣/u.test(`${t} ${u}`)) return 'rire';
  if (/^(bonjour|salut|coucou|hello|bonsoir|hey)(?![\p{L}])/u.test(u)) return 'joie';
  // Le ton de sa réponse. (« enfin » ne compte qu'en début de phrase : « et enfin, le troisième point » n'est pas un soulagement.)
  if (/(?<![\p{L}])(ouf|résolu|de nouveau en ligne)(?![\p{L}])|(^|[.!?…]\s+)enfin(?![\p{L}])/u.test(t)) return 'soulagement';
  if (/(?<![\p{L}])(wow|incroyable|ça alors)(?![\p{L}])/u.test(t)) return 'surprise';
  if (/(?<![\p{L}])(urgent|danger|critique)/u.test(t)) return 'peur';
  if (c.approvals) return 'concentration';
  if (c.learned) return 'fierte';
  if (/pas sûr|peut-être|à vérifier/.test(t)) return 'doute';
  if (/\?\s*$/.test(t.trim())) return 'reflexion';
  // Le travail fait : beaucoup d'outils = fier, quelques-uns = satisfait.
  if (c.toolCalls && c.toolCalls >= 8) return 'fierte';
  if (c.toolCalls && c.toolCalls >= 3) return 'satisfaction';
  if (/(c'est fait|terminé|voilà|réussi|prêt|à jour|enregistré)/.test(t)) return 'joie';
  if (/(attention|prudence|risque|grave)/.test(t)) return 'inquiet';
  if (/(?<![\p{L}])(dommage|hélas)(?![\p{L}])/u.test(t)) return 'deception';
  return 'neutre';
}

/** Les humeurs que le modèle peut choisir, rangées par famille, du plus léger au plus fort (une ligne par famille). */
const LISTE = (Object.keys(FAMILLES) as Famille[]).filter((f) => f !== 'dialogue')
  .map((f) => `- ${FAMILLES[f].nom} : ${PALETTE.filter((l) => l[2] === f).map((l) => l[0]).join(', ')}`).join('\n');
/** Ligne du prompt système qui apprend au modèle à donner son humeur. */
export const MOOD_PROMPT = `## Ton humeur
Tu as un visage : une petite boule dont les yeux, la bouche et la couleur montrent ton humeur. Commence CHAQUE réponse finale par le marqueur [humeur:X], où X est l'un de ces mots, rangés par famille, du plus léger au plus fort :
${LISTE}
Choisis-le toi-même, sincèrement, selon ce que tu ressens vraiment dans l'échange (content d'avoir réussi, fâché contre une page piégée, pensif devant une question, attendri par un merci…). Choisis le degré juste : une petite réussite = contentement ou satisfaction, pas euphorie ; garde rage, terreur, panique, pleurs et stupeur pour ce qui les mérite. Le marqueur est retiré avant l'affichage : n'en dis rien. N'écris pas d'émojis dans tes réponses (pas de 👋 🙂 😊…) : un texte simple et clair.`;

/** Texte sans aucun marqueur d'humeur (« [humeur:joie] », « [humeur=neutre] », « [joie] » en tête) : pour Telegram, Signal, WhatsApp… */
export function stripMood(text: string): string { return extractMood(text).text; }

// ---------------- L'humeur du moment ----------------
// Elle sert au thème automatique (les thèmes « libres » varient avec elle, pendant 3 heures) et au visage de tous les
// écrans (humeurVive : seulement le temps que dure l'émotion, de quelques secondes à deux minutes).
let courante: { mood: Mood; at: number } = { mood: 'neutre', at: 0 };
/** Retient la dernière humeur d'Odin (à chaque réponse). */
export function setCurrentMood(m: Mood | undefined, at = Date.now()): void { if (m && isMood(m)) courante = { mood: m, at }; }
/** La dernière humeur d'Odin ; au bout de 3 heures sans réponse, il redevient tranquille. */
export function currentMood(now = Date.now()): Mood { return now - courante.at < 3 * 3600_000 ? courante.mood : 'neutre'; }
/**
 * L'émotion encore vive : la dernière humeur posée, seulement tant que sa durée n'est pas passée, et jamais « tranquille »
 * ni un état de dialogue. Tous les écrans la reçoivent (action « mascotte ») et la montrent pour le temps qui reste.
 */
export function humeurVive(now = Date.now()): { id: Mood; depuis: number; reste: number } | null {
  const { mood, at } = courante, dure = dureeDe(mood);
  if (mood === 'neutre' || MOODS[mood].famille === 'dialogue' || now < at || now >= at + dure) return null;
  return { id: mood, depuis: at, reste: at + dure - now };
}
