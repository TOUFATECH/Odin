// Plume · le correcteur d'orthographe et de grammaire.
// Deux moteurs : un correcteur de base fait maison (toujours là, sans rien installer) et LanguageTool quand il est
// installé à côté d'Odin (« piloté » : on lui parle par son API HTTP /v2/check, rien de son code n'est repris).
// Les autres applis l'appellent par `ctx.call('snotra', 'corriger', { texte })`.

/** Une faute : où (en caractères), quoi, et les remplacements proposés (le premier est le meilleur). */
export interface Faute { debut: number; longueur: number; message: string; suggestions: string[]; regle: string; extrait: string }
export interface Correction { moteur: 'maison' | 'LanguageTool'; fautes: Faute[]; corrige: string }

const NBSP = ' ', NNBSP = ' ';
const extrait = (t: string, d: number, n: number) => `${t.slice(Math.max(0, d - 20), d)}[${t.slice(d, d + n)}]${t.slice(d + n, d + n + 20)}`.replace(/\s+/g, ' ');

/** Fautes d'usage fréquentes : forme fautive → forme juste (comparées sans tenir compte des majuscules). */
const USAGE: Array<[RegExp, string, string]> = [
  [/\ben faite\b/gi, 'en fait', '« en fait » (pas « en faite »)'],
  [/\bparmis\b/gi, 'parmi', '« parmi » ne prend jamais de s'],
  [/\bmalgrés\b/gi, 'malgré', '« malgré » ne prend pas de s'],
  [/\bquelque soit\b/gi, 'quel que soit', '« quel que soit » s\'écrit en trois mots'],
  [/\bquelques soient\b/gi, 'quels que soient', '« quels que soient » s\'écrit en trois mots'],
  [/\bapeller\b/gi, 'appeler', '« appeler » prend deux p et un l'],
  [/\bsi il\b/gi, 's\'il', 'on écrit « s\'il »'],
  [/\bsi ils\b/gi, 's\'ils', 'on écrit « s\'ils »'],
  [/\bau jour d'aujourd'hui\b/gi, 'aujourd\'hui', 'pléonasme : « aujourd\'hui » suffit'],
  [/\bpallier à\b/gi, 'pallier', '« pallier » se construit sans « à »'],
  [/\bsoit-disant\b/gi, 'soi-disant', '« soi-disant » (soi, pas soit)'],
  [/\bcomme même\b/gi, 'quand même', '« quand même »'],
  [/\bdont auquel\b/gi, 'auquel', '« dont » et « auquel » ne vont pas ensemble'],
  [/\bil à\b/gi, 'il a', '« a » (avoir) : on peut dire « il avait »'],
  [/\belle à\b/gi, 'elle a', '« a » (avoir) : on peut dire « elle avait »'],
  [/\bon à\b/gi, 'on a', '« a » (avoir) : on peut dire « on avait »'],
  [/\bça va de soit\b/gi, 'ça va de soi', '« ça va de soi »'],
  [/\bentrain de\b/gi, 'en train de', '« en train de » s\'écrit en trois mots'],
  [/\bdes fois que\b/gi, 'au cas où', 'familier : « au cas où »'],
];
/** Mots qui restent au singulier après « les », « des »… (ou qui ne sont pas des noms). */
const INVARIABLES = new Set('plus moins tres bien tout toute deux trois quatre cinq six sept huit neuf dix onze douze vingt cent mille autre meme leur leurs lui eux elles nous vous sur sous dans pour par avec sans entre vers chez apres avant pendant depuis afin ainsi alors aussi assez beaucoup peu trop jamais toujours souvent parfois deja encore ici la ou et ni mais donc or car que qui quoi dont uns unes jours nuit fois prix poids temps bois corps pays mois choix avis cas propos accord'.split(' '));
const PLURIELS = /^(les|des|mes|tes|ses|nos|vos|ces|leurs|plusieurs|quelques|certains|certaines|nombreux|nombreuses|divers|diverses)$/i;
const norm = (w: string) => w.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Le correcteur de base, fait maison : sûr plutôt que bavard (peu de fausses alertes). Pur. */
export function corrigerMaison(texte: string): Faute[] {
  const out: Faute[] = [], f = (debut: number, longueur: number, message: string, suggestions: string[], regle: string) => out.push({ debut, longueur, message, suggestions, regle, extrait: extrait(texte, debut, longueur) });
  let m: RegExpExecArray | null;
  // Espaces en trop.
  for (const re = / {2,}/g; (m = re.exec(texte));) if (m.index > 0 && texte[m.index - 1] !== '\n') f(m.index, m[0].length, 'Espaces en trop', [' '], 'ESPACES_DOUBLES');
  // Ponctuation double (« : ; ? ! ») : une espace insécable avant, en français.
  for (const re = /(\S)( ?)([:;?!])(?=\s|$)/g; (m = re.exec(texte));) {
    if (/[:;?!\d/]/.test(m[1]) || (m[3] === ':' && /https?$/.test(texte.slice(Math.max(0, m.index - 5), m.index + 1)))) continue;
    const d = m.index + 1, n = m[2].length + 1;
    f(d, n, m[2] ? `Une espace insécable avant « ${m[3]} » (elle ne se sépare pas en fin de ligne)` : `Une espace (insécable) avant « ${m[3]} » en français`, [`${m[3] === ':' ? NBSP : NNBSP}${m[3]}`], 'ESPACE_PONCTUATION');
  }
  // Espace avant une virgule ou un point, et pas d'espace après.
  for (const re = /(\S) ([,.])(?=\s|$)/g; (m = re.exec(texte));) f(m.index + 1, 2, `Pas d'espace avant « ${m[2]} »`, [m[2]], 'ESPACE_AVANT_VIRGULE');
  for (const re = /([a-zàâäéèêëîïôöùûüç]{2,})([,;])([a-zàâäéèêëîïôöùûüç])/gi; (m = re.exec(texte));) f(m.index + m[1].length, 1, `Une espace après « ${m[2]} »`, [`${m[2]} `], 'ESPACE_APRES_VIRGULE');
  // Majuscule en début de phrase.
  for (const re = /(^|[.!?…]\s+|\n\s*\n\s*)([a-zàâäéèêëîïôöùûüç])/g; (m = re.exec(texte));) {
    const d = m.index + m[1].length; if (m[1] === '' && d !== 0) continue;
    // « etc. », « M. », une abréviation ou une adresse : on n'insiste pas.
    if (/\b(etc|cf|ex|p|M|Mme|env|av|apr|J\.-C)\.\s+$/.test(texte.slice(Math.max(0, d - 8), d)) || /^(www|http)/.test(texte.slice(d))) continue;
    f(d, 1, 'Une majuscule en début de phrase', [m[2].toUpperCase()], 'MAJUSCULE_PHRASE');
  }
  // Mot répété (« le le »).
  for (const re = /(?<![\p{L}\d])(\p{L}+) \1(?![\p{L}\d])/giu; (m = re.exec(texte));) if (!/^(nous|vous|si|tout|bien|très|plus|pas)$/i.test(m[1])) f(m.index, m[0].length, `« ${m[1]} » est écrit deux fois`, [m[1]], 'MOT_REPETE');
  // Accord simple : « les maison » → « les maisons ».
  for (const re = /\b(\p{L}+) (\p{L}{3,})\b/gu; (m = re.exec(texte));) {
    if (!PLURIELS.test(m[1])) { re.lastIndex = m.index + m[1].length + 1; continue; }
    const w = m[2], n = norm(w);
    if (/[sxz]$/.test(n) || INVARIABLES.has(n) || /^[A-Z]/.test(w) || /(ent|ons|ez|ait|aient|er|ir)$/.test(n)) { re.lastIndex = m.index + m[1].length + 1; continue; }
    const pl = /(au|eu)$/.test(n) ? `${w}x` : /al$/.test(n) && !/(bal|carnaval|chacal|festival|recital|regal)$/.test(n) ? `${w.slice(0, -1)}ux` : `${w}s`;
    f(m.index + m[1].length + 1, w.length, `Après « ${m[1]} », le mot se met d'habitude au pluriel`, [pl], 'ACCORD_PLURIEL');
    re.lastIndex = m.index + m[0].length;
  }
  // Les bornes de mot de JavaScript (\b) ignorent les lettres accentuées : on les remplace par des bornes « lettre ».
  for (const [re, juste, msg] of USAGE) for (const r = new RegExp(re.source.replace(/^\\b/, '(?<![\\p{L}\\d])').replace(/\\b$/, '(?![\\p{L}\\d])'), 'giu'); (m = r.exec(texte));) {
    const garde = m[0][0] === m[0][0].toUpperCase() && m[0][0] !== m[0][0].toLowerCase() ? juste[0].toUpperCase() + juste.slice(1) : juste;
    f(m.index, m[0].length, msg, [garde], 'USAGE');
  }
  // Une faute dans une autre (même endroit) : on garde la première trouvée, dans l'ordre du texte.
  out.sort((a, b) => a.debut - b.debut || b.longueur - a.longueur);
  return out.filter((x, i) => !out.slice(0, i).some((y) => x.debut < y.debut + y.longueur && y.debut < x.debut + x.longueur));
}

/** Le texte avec la première suggestion de chaque faute appliquée (de la fin vers le début). Pur. */
export function appliquer(texte: string, fautes: Faute[]): string {
  let t = texte;
  for (const x of [...fautes].sort((a, b) => b.debut - a.debut)) if (x.suggestions[0] !== undefined) t = t.slice(0, x.debut) + x.suggestions[0] + t.slice(x.debut + x.longueur);
  return t;
}

/** La réponse de LanguageTool (POST /v2/check) → nos fautes. Pur. */
export function lireLanguageTool(texte: string, j: unknown): Faute[] {
  const ms = (j as { matches?: unknown[] })?.matches; if (!Array.isArray(ms)) throw new Error('réponse de LanguageTool illisible');
  return ms.map((x) => {
    const o = x as { offset?: number; length?: number; message?: string; shortMessage?: string; replacements?: Array<{ value?: string }>; rule?: { id?: string } };
    const debut = Math.max(0, Number(o.offset) || 0), longueur = Math.max(0, Number(o.length) || 0);
    return { debut, longueur, message: String(o.message || o.shortMessage || 'À vérifier').slice(0, 300), suggestions: (o.replacements ?? []).slice(0, 5).map((r) => String(r.value ?? '')).filter((r) => r.length < 200), regle: String(o.rule?.id ?? 'LANGUAGETOOL').slice(0, 80), extrait: extrait(texte, debut, longueur) };
  }).filter((x) => x.debut + x.longueur <= texte.length);
}

/** Demande à un LanguageTool (son adresse, ex. http://127.0.0.1:20126). Lève une erreur claire s'il ne répond pas. */
export async function corrigerLanguageTool(f: typeof fetch, url: string, texte: string, langue = 'fr'): Promise<Faute[]> {
  const r = await f(`${url.replace(/\/+$/, '')}/v2/check`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' }, body: new URLSearchParams({ text: texte, language: langue }).toString(), signal: AbortSignal.timeout(20_000) });
  if (!r.ok) throw new Error(`LanguageTool répond ${r.status}`);
  return lireLanguageTool(texte, await r.json());
}
