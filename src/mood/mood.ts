// Les humeurs d'Odin.
//
// Odin choisit lui-même son humeur à chaque réponse : le modèle commence sa réponse par un
// marqueur [humeur:xxx], retiré avant affichage. S'il l'oublie, une estimation à partir du texte
// et de ce qui s'est passé pendant le tour (erreur, refus, validation, réussite) prend le relais.
// Le visage (site, interface web) et l'autocollant Telegram suivent cette humeur.

export const MOODS = {
  neutre: { label: 'tranquille' },
  joie: { label: 'content' },
  rire: { label: 'rieur' },
  amour: { label: 'attendri' },
  fierte: { label: 'fier' },
  excite: { label: 'enthousiaste' },
  clin: { label: 'complice' },
  malice: { label: 'malicieux' },
  surprise: { label: 'surpris' },
  reflexion: { label: 'pensif' },
  concentration: { label: 'concentré' },
  confus: { label: 'perplexe' },
  inquiet: { label: 'inquiet' },
  triste: { label: 'triste' },
  colere: { label: 'fâché' },
  peur: { label: 'effrayé' },
  gene: { label: 'gêné' },
  fatigue: { label: 'fatigué' },
  ecoute: { label: 'à l\'écoute' },
  regarde: { label: 'attentif' },
} as const;

export type Mood = keyof typeof MOODS;
/** Émoji de chaque humeur, ajouté à la fin des réponses Telegram (même taille que le texte). */
export const MOOD_EMOJI: Record<Mood, string> = {
  neutre: '🙂', joie: '😊', rire: '😄', amour: '🥰', fierte: '😎', excite: '🤩', clin: '😉', malice: '😏', surprise: '😮', reflexion: '🤔',
  concentration: '🧐', confus: '😕', inquiet: '😟', triste: '😢', colere: '😠', peur: '😨', gene: '😳', fatigue: '😴', ecoute: '🙂', regarde: '👀',
};
export const MOOD_IDS = Object.keys(MOODS) as Mood[];
export const isMood = (m: unknown): m is Mood => typeof m === 'string' && m in MOODS;

const TAG = /^\s*\[\s*humeur\s*[:=]\s*([a-zàâçéèêëîïôûùüÿñæœ_-]+)\s*\]\s*/i;
const ALIAS: Record<string, Mood> = {
  content: 'joie', heureux: 'joie', joyeux: 'joie', rieur: 'rire', drole: 'rire', drôle: 'rire', fier: 'fierte', fierté: 'fierte',
  enthousiaste: 'excite', excité: 'excite', complice: 'clin', malicieux: 'malice', surpris: 'surprise', pensif: 'reflexion', réflexion: 'reflexion',
  concentré: 'concentration', perplexe: 'confus', inquiète: 'inquiet', fâché: 'colere', colère: 'colere', effrayé: 'peur', gêné: 'gene', gêne: 'gene',
  fatigué: 'fatigue', attendri: 'amour', calme: 'neutre', tranquille: 'neutre', attentif: 'regarde', écoute: 'ecoute',
};

/** Retire le marqueur [humeur:xxx] du début de la réponse ; renvoie l'humeur reconnue. */
const SHORT = /^\s*\[\s*([a-zàâçéèêëîïôûùüÿñæœ_-]+)\s*\]\s*/i;
/** Retire le marqueur d'humeur ([humeur:joie], ou la forme courte [joie]) au début, et tout marqueur oublié ailleurs. */
export function extractMood(text: string): { text: string; mood?: Mood } {
  let m = text.match(TAG), mood: Mood | undefined;
  if (!m) { const s = text.match(SHORT); if (s && (isMood(s[1].toLowerCase()) || ALIAS[s[1].toLowerCase()])) m = s; }
  if (m) { const raw = m[1].toLowerCase(); mood = isMood(raw) ? raw : ALIAS[raw]; text = text.slice(m[0].length); }
  // Marqueurs restés au milieu (plusieurs messages, réponse reprise…)
  text = text.replace(/\[\s*humeur\s*[:=]\s*[a-zàâçéèêëîïôûùüÿñæœ_-]+\s*\]\s*/gi, '').replace(/(^|\n)\s*\[(?:neutre|joie|rire|amour|fierte|excite|clin|malice|surprise|reflexion|concentration|confus|inquiet|triste|colere|peur|gene|fatigue|ecoute|regarde)\]\s*/gi, '$1');
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

/** Estimation de secours, quand le modèle n'a pas donné d'humeur. */
export function guessMood(text: string, c: MoodContext = {}): Mood {
  const t = text.toLowerCase(), u = (c.userText ?? '').toLowerCase();
  if (c.stopReason === 'error' || c.stopReason === 'loop') return 'confus';
  if (c.stopReason === 'budget' || c.stopReason === 'max_steps') return 'fatigue';
  if (c.stopReason === 'aborted') return 'surprise';
  if (/manipul|pirat|page piégée|refusé pour te protéger|tentait de/.test(t)) return 'colere';
  if (c.blocked) return 'inquiet';
  if (/désolé|malheureusement|impossible|je n'arrive pas|échec|erreur/.test(t)) return c.errors ? 'triste' : 'confus';
  if (/^(merci|bravo|génial|super|top|parfait)\b/.test(u.trim())) return 'amour';
  if (/\b(haha|mdr|lol|blague|😂|🤣)\b/.test(t + ' ' + u)) return 'rire';
  if (/^(bonjour|salut|coucou|hello|bonsoir|hey)\b/.test(u.trim())) return 'joie';
  if (c.approvals) return 'concentration';
  if (c.learned) return 'fierte';
  if (/\?\s*$/.test(t.trim())) return 'reflexion';
  if (c.toolCalls && c.toolCalls >= 3) return 'fierte';
  if (/(c'est fait|terminé|voilà|réussi|prêt|à jour|enregistré)/.test(t)) return 'joie';
  if (/(attention|prudence|risque|grave)/.test(t)) return 'inquiet';
  return 'neutre';
}

/** Ligne du prompt système qui apprend au modèle à donner son humeur. */
export const MOOD_PROMPT = `## Ton humeur
Tu as un visage (une petite boule dorée) dont la couleur montre ton humeur. Commence CHAQUE réponse finale par le marqueur [humeur:X], où X est l'un de : ${MOOD_IDS.join(', ')}. Choisis-le toi-même, sincèrement, selon ce que tu ressens vraiment dans l'échange (content d'avoir réussi, fâché contre une page piégée, pensif devant une question, attendri par un merci…). Le marqueur est retiré avant l'affichage : n'en parle pas. N'écris pas d'émojis dans tes réponses (pas de 👋 🙂 😊…) : un texte simple et clair.`;

/** Texte sans aucun marqueur d'humeur (« [humeur:joie] », « [humeur=neutre] », « [joie] » en tête) : pour Telegram, Signal, WhatsApp… */
export function stripMood(text: string): string { return extractMood(text).text; }
