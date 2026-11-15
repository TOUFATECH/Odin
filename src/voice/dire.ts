// Ce qu'Odin dit à voix haute. Une réponse est écrite pour l'écran (gras, listes, tableaux, liens, « 92 % », « 14:30 ») ;
// avant de la donner à une voix, on la prépare pour qu'elle sonne comme quelqu'un qui parle :
//  - aucun symbole lu (« astérisque », barres de tableau, liens, émojis) ;
//  - les nombres, les heures, les dates, les unités et les sigles dits comme on les dit
//    (« quatorze heures trente », « quatre-vingt-douze pour cent », « douze gigaoctets », « une i a ») ;
//  - de petites pauses : un point en fin de ligne, des virgules à la place des tirets et des parenthèses ;
//  - les listes dites « d'abord…, ensuite…, enfin… », un tableau dit ligne par ligne.
// Tout est pur (du texte en entrée, du texte en sortie) et sert à toutes les voix : ElevenLabs, OpenAI, Piper, navigateur.
// Les nombres et les unités ne sont dits en toutes lettres qu'en français ; dans une autre langue, seul le ménage est fait.

// ---------------------------------------------------------------- Les nombres en toutes lettres

const UNITES = ['zéro', 'un', 'deux', 'trois', 'quatre', 'cinq', 'six', 'sept', 'huit', 'neuf', 'dix', 'onze', 'douze', 'treize', 'quatorze', 'quinze', 'seize', 'dix-sept', 'dix-huit', 'dix-neuf'];
const DIZAINES = ['', 'dix', 'vingt', 'trente', 'quarante', 'cinquante', 'soixante', 'soixante', 'quatre-vingt', 'quatre-vingt'];

function sous100(n: number): string {
  if (n < 20) return UNITES[n];
  const d = Math.floor(n / 10), u = n % 10;
  if (d === 7 || d === 9) return d === 7 && u === 1 ? 'soixante et onze' : `${DIZAINES[d]}-${UNITES[10 + u]}`;
  if (u === 0) return d === 8 ? 'quatre-vingts' : DIZAINES[d];
  return u === 1 && d !== 8 ? `${DIZAINES[d]} et un` : `${DIZAINES[d]}-${UNITES[u]}`;
}
function sous1000(n: number): string {
  const c = Math.floor(n / 100), r = n % 100;
  if (!c) return sous100(r);
  const cent = c === 1 ? 'cent' : `${UNITES[c]} cent${r ? '' : 's'}`;
  return r ? `${cent} ${sous100(r)}` : cent;
}
/** Un nombre entier en toutes lettres : 92 → « quatre-vingt-douze », 1500 → « mille cinq cents ». `feminin` : « une », « vingt et une ». Pur. */
export function nombreEnLettres(n: number, feminin = false): string {
  if (!Number.isFinite(n)) return String(n);
  if (n < 0) return `moins ${nombreEnLettres(-n, feminin)}`;
  const e = Math.floor(n);
  if (e === 0) return 'zéro';
  if (e >= 1e12) return [...String(e)].map((c) => UNITES[Number(c)]).join(' ');
  const mds = Math.floor(e / 1e9), mns = Math.floor((e % 1e9) / 1e6), mil = Math.floor((e % 1e6) / 1e3), r = e % 1000;
  const parts: string[] = [];
  if (mds) parts.push(`${sous1000(mds)} milliard${mds > 1 ? 's' : ''}`);
  if (mns) parts.push(`${sous1000(mns)} million${mns > 1 ? 's' : ''}`);
  // « mille » ne prend jamais de s, et devant lui « cent » et « quatre-vingt » non plus.
  if (mil) parts.push(mil === 1 ? 'mille' : `${sous1000(mil).replace(/(cent|quatre-vingt)s$/, '$1')} mille`);
  if (r) parts.push(sous1000(r));
  const out = parts.join(' ');
  return feminin ? out.replace(/(^|[ -])un$/, '$1une') : out;
}
/** Un nombre tel qu'il est écrit (« 12 », « 3,5 », « 1 234 », « 0.05 », « 007 ») dit en toutes lettres. Pur. */
export function direNombre(ecrit: string, feminin = false): string {
  const t = ecrit.replace(/[\s  ]/g, '');
  const m = /^(-?)(\d+)(?:[.,](\d+))?$/.exec(t);
  if (!m) return ecrit;
  const [, moins, entier, dec] = m;
  // Des zéros devant (« 06 », « 007 ») : ils se disent un par un.
  const zeros = entier.length > 1 ? /^0*/.exec(entier)![0].length : 0;
  const tete = zeros ? [...Array(Math.min(zeros, entier.length)).fill('zéro'), ...(zeros < entier.length ? [nombreEnLettres(Number(entier.slice(zeros)), feminin && !dec)] : [])].join(' ') : nombreEnLettres(Number(entier), feminin && !dec);
  if (!dec) return `${moins ? 'moins ' : ''}${tete}`;
  const z = /^0*/.exec(dec)![0].length, reste = dec.slice(z);
  const queue = [...Array(z).fill('zéro'), ...(reste ? [reste.length <= 3 ? nombreEnLettres(Number(reste)) : [...reste].map((c) => UNITES[Number(c)]).join(' ')] : [])].join(' ');
  return `${moins ? 'moins ' : ''}${tete} virgule ${queue}`;
}
/** « 1 » → « premier », « 2 » → « deuxième », « 21 » → « vingt et unième ». Pur. */
export function ordinal(n: number, feminin = false): string {
  if (n === 1) return feminin ? 'première' : 'premier';
  const mot = nombreEnLettres(n);
  if (/(^|[ -])un$/.test(mot)) return `${mot}ième`;
  if (mot.endsWith('cinq')) return `${mot}uième`;
  if (mot.endsWith('neuf')) return `${mot.slice(0, -1)}vième`;
  return `${mot.replace(/s$/, '').replace(/e$/, '')}ième`;
}

const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const dateDite = (j: number, m: number, a?: number) => `${j === 1 ? 'premier' : nombreEnLettres(j)} ${MOIS[m - 1]}${a ? ` ${nombreEnLettres(a)}` : ''}`;
/** Une heure dite : (14, 30) → « quatorze heures trente », (0, 15) → « minuit quinze », (12, 0) → « midi ». Pur. */
export function heureDite(h: number, min = 0, horloge = true): string {
  const tete = horloge && h === 0 ? 'minuit' : horloge && h === 12 ? 'midi' : `${nombreEnLettres(h, true)} heure${h > 1 ? 's' : ''}`;
  return min ? `${tete} ${nombreEnLettres(min, true)}` : tete;
}

// ---------------------------------------------------------------- Unités, sigles, abréviations

const F = true;
/** [ce qui est écrit, au singulier, au pluriel, féminin ?] — du plus long au plus court. */
const MESURES: Array<[string, string, string, boolean?]> = [
  ['km/h', 'kilomètre-heure', 'kilomètres-heure'], ['m/s', 'mètre par seconde', 'mètres par seconde'],
  ['Gbit/s|Gb/s|Gbps', 'gigabit par seconde', 'gigabits par seconde'], ['Mbit/s|Mb/s|Mbps', 'mégabit par seconde', 'mégabits par seconde'], ['[Kk]bit/s|[Kk]b/s|[Kk]bps', 'kilobit par seconde', 'kilobits par seconde'],
  ['Go/s|GB/s', 'gigaoctet par seconde', 'gigaoctets par seconde'], ['Mo/s|MB/s', 'mégaoctet par seconde', 'mégaoctets par seconde'], ['[Kk]o/s|[Kk]B/s', 'kilooctet par seconde', 'kilooctets par seconde'],
  ['To|TB|Tio', 'téraoctet', 'téraoctets'], ['Go|GB|Gio', 'gigaoctet', 'gigaoctets'], ['Mo|MB|Mio', 'mégaoctet', 'mégaoctets'], ['[Kk]o|[Kk]B|Kio', 'kilooctet', 'kilooctets'],
  ['kWh', 'kilowattheure', 'kilowattheures'], ['Wh', 'wattheure', 'wattheures'], ['kW', 'kilowatt', 'kilowatts'], ['mAh', 'milliampère-heure', 'milliampères-heure'],
  ['GHz', 'gigahertz', 'gigahertz'], ['MHz', 'mégahertz', 'mégahertz'], ['kHz', 'kilohertz', 'kilohertz'], ['Hz', 'hertz', 'hertz'], ['dB', 'décibel', 'décibels'],
  ['km²|km2', 'kilomètre carré', 'kilomètres carrés'], ['m²|m2', 'mètre carré', 'mètres carrés'], ['m³|m3', 'mètre cube', 'mètres cubes'],
  ['km', 'kilomètre', 'kilomètres'], ['cm', 'centimètre', 'centimètres'], ['mm', 'millimètre', 'millimètres'],
  ['kg', 'kilo', 'kilos'], ['mg', 'milligramme', 'milligrammes'], ['m[lL]', 'millilitre', 'millilitres'], ['c[lL]', 'centilitre', 'centilitres'],
  ['ms', 'milliseconde', 'millisecondes', F], ['min|mn', 'minute', 'minutes', F], ['sec|s', 'seconde', 'secondes', F], ['h', 'heure', 'heures', F], ['j', 'jour', 'jours'],
  ['px', 'pixel', 'pixels'], ['fps', 'image par seconde', 'images par seconde', F],
  ['°C|°F|°', 'degré', 'degrés'], ['%', 'pour cent', 'pour cent'], ['‰', 'pour mille', 'pour mille'],
  ['W', 'watt', 'watts'], ['V', 'volt', 'volts'], ['m', 'mètre', 'mètres'], ['g', 'gramme', 'grammes'], ['L', 'litre', 'litres'],
];
const NB = '\\d+(?:[.,]\\d+)?';
const MESURE = new RegExp(`(?<![\\p{L}\\d_.,/-])(-?${NB})\\s?(${MESURES.map((m) => m[0]).join('|')})(?![\\p{L}\\d'’/²³])`, 'gu');
const mesureDe = (ecrit: string) => MESURES.find((m) => new RegExp(`^(?:${m[0]})$`).test(ecrit))!;
const plusieurs = (ecrit: string) => Math.abs(Number(ecrit.replace(',', '.'))) >= 2;

/** Les lettres comme on les dit (pour épeler un sigle qu'une voix lirait comme un mot : « IA » → « i a »). */
const LETTRES: Record<string, string> = { A: 'a', B: 'bé', C: 'cé', D: 'dé', E: 'eu', F: 'èf', G: 'gé', H: 'ache', I: 'i', J: 'ji', K: 'ka', L: 'èl', M: 'èm', N: 'èn', O: 'o', P: 'pé', Q: 'ku', R: 'èr', S: 'ès', T: 'té', U: 'u', V: 'vé', W: 'double vé', X: 'ix', Y: 'i grec', Z: 'zèd' };
const epeler = (s: string) => [...s.toUpperCase()].map((c) => LETTRES[c] ?? c).join(' ');
/** Les sigles avec une voyelle qu'on épelle (sans voyelle, les voix les épellent déjà : VPN, DNS, SSH, PDF…). */
const SIGLES = /(?<![\p{L}\d-])(IA|IP|API|URL|USB|CPU|GPU|OS|UI|ID|AI|HTML|UDP|IPTV|OCR|ISP|FAI|SAV|TVA|EDM|EDF|UPS|OTP|EAN|IMEI|IMAP|OIDC|AES|RSA)(?![\p{L}\d-])/gu;
/** Les abréviations dites en entier. */
const ABREVIATIONS: Array<[RegExp, string]> = [
  [/(?<![\p{L}])p\.\s?ex\.(?![\p{L}])/giu, 'par exemple'], [/(?<![\p{L}])ex\.\s?:/giu, 'exemple :'], [/(?<![\p{L}])ex\.(?=\s+[«"\p{Ll}\d])/giu, 'exemple'],
  [/(?<![\p{L}])c\.-à-d\./giu, 'c\'est-à-dire'], [/(?<![\p{L}])cf\.(?![\p{L}])/giu, 'voir'], [/(?<![\p{L}])env\.(?![\p{L}])/giu, 'environ'],
  [/(?<![\p{L}])max\.(?![\p{L}])/giu, 'maximum'], [/(?<![\p{L}])vs\.?(?![\p{L}])/giu, 'contre'], [/(?<![\p{L}])RAS(?![\p{L}])/gu, 'rien à signaler'],
  [/(?<![\p{L}])stp(?![\p{L}])/giu, 's\'il te plaît'], [/(?<![\p{L}])svp(?![\p{L}])/giu, 's\'il vous plaît'], [/(?<![\p{L}])Mme(?![\p{L}])/gu, 'madame'],
  [/(?<![\p{L}])t[ée]l\.(?![\p{L}])/giu, 'téléphone'], [/(?<![\p{L}])r[ée]f\.(?![\p{L}])/giu, 'référence'], [/(?<![\p{L}])n°\s?(?=\d)/giu, 'numéro '], [/#(?=\d)/g, 'numéro '],
];

// ---------------------------------------------------------------- Le ménage : ce qui est fait pour l'écran

const MOTS_DITS: Record<string, { code: string; lien: string; liens: string; image: string; reste: (n: number) => string }> = {
  fr: { code: 'code affiché à l\'écran', lien: 'le lien affiché', liens: 'les liens affichés', image: 'image', reste: (n) => `Et ${nombreEnLettres(n, true)} autre${n > 1 ? 's' : ''} ligne${n > 1 ? 's' : ''}, à voir à l'écran.` },
  en: { code: 'code shown on screen', lien: 'the link on screen', liens: 'the links on screen', image: 'image', reste: (n) => `And ${n} more row${n > 1 ? 's' : ''} on screen.` },
};
const sansFin = (x: string) => x.trim().replace(/[\s;,.]+$/, '');
/** Mots de liaison devant lesquels la majuscule d'un début de ligne tombe (« Le NAS… » → « d'abord, le NAS… »). */
const PETITS_MOTS = /^(?:(?:Le|La|Les|Un|Une|Des|Je|Tu|Il|Elle|On|Nous|Vous|Ils|Elles|Ce|Cette|Ces|Mon|Ma|Mes|Ton|Ta|Tes|Son|Sa|Ses|Pour|Dans|Sur|Avec|Sans|En|À|Au|Aux|Du|De|Et|Si|Quand|Pas|Plus|Aucun|Aucune|Tout|Toute|Tous|Toutes)(?![\p{L}'’-])|[LDJCN]['’]|Qu['’])/u;
const minuscule = (x: string) => (PETITS_MOTS.test(x) ? x.charAt(0).toLowerCase() + x.slice(1) : x);

/** Une liste dite : courte (« A, B et C »), sinon « D'abord…, ensuite…, enfin… ». Pur. */
export function direListe(items: string[], fr = true): string {
  const l = items.map(sansFin).filter(Boolean);
  if (l.length <= 1) return l.map((x) => `${x}.`).join(' ');
  if (!fr) return l.map((x) => `${x}.`).join(' ');
  if (l.every((x) => x.split(/\s+/).length <= 3)) return `${l.slice(0, -1).join(', ')} et ${l.at(-1)}.`;
  if (l.length > 6) return l.map((x) => `${x}.`).join(' ');
  const liens = ['D\'abord', 'Ensuite', 'Puis', 'Après ça', 'Et aussi'];
  return l.map((x, i) => `${i === l.length - 1 && l.length > 2 ? 'Enfin' : liens[Math.min(i, liens.length - 1)]}, ${minuscule(x)}.`).join(' ');
}

/** Un tableau dit ligne par ligne : « NAS, État : en ligne, Adresse : … ». Huit lignes au plus, le reste est à l'écran. */
function direTableau(lignes: string[], mots: (typeof MOTS_DITS)[string] | undefined): string {
  const rangs = lignes.map((l) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim()));
  const trait = rangs.findIndex((r) => r.length > 0 && r.every((c) => /^:?-{2,}:?$/.test(c)));
  const tetes = trait === 1 ? rangs[0] : undefined;
  const corps = rangs.filter((r, i) => i !== trait && !(tetes && i === 0) && r.some(Boolean));
  const dits = corps.slice(0, 8).map((r) => (tetes && r.length > 2
    ? [r[0], ...r.slice(1).map((c, i) => (c ? `${tetes[i + 1] ? `${tetes[i + 1]} : ` : ''}${c}` : '')).filter(Boolean)].filter(Boolean).join(', ')
    : r.filter(Boolean).join(r.length === 2 ? ' : ' : ', ')));
  const reste = corps.length - dits.length;
  return [...dits.map((d) => `${sansFin(d)}.`), ...(reste > 0 && mots ? [mots.reste(reste)] : [])].join('\n');
}

const PUCE = /^\s*(?:[-*•+–]|\d{1,2}[.)])\s+(?:\[[ xX]\]\s+)?(.*)$/;
/** Le Markdown et les décors retirés, les blocs (titres, listes, tableaux) dits ligne par ligne. */
function menage(text: string, langue: string): string {
  const mots = MOTS_DITS[langue], fr = langue === 'fr';
  const t = text.replace(/\r\n?/g, '\n')
    .replace(/```[\s\S]*?```/g, mots ? `\n(${mots.code})\n` : '\n')
    .replace(/`([^`\n]+)`/g, '$1')
    .replace(/!\[([^\]\n]*)\]\([^)\n]*\)/g, (_m, alt: string) => (alt.trim() ? `${mots?.image ?? ''} ${alt.trim()}`.trim() : ''))
    .replace(/\[\[(?:[^\]|\n]*\|)?([^\]\n]+)\]\]/g, '$1')
    .replace(/\[([^\]\n]+)\]\((?:[^)\n]+)\)/g, '$1')
    .replace(/<?https?:\/\/[^\s<>)\]]*[^\s<>)\].,;:!?…»"']>?/g, mots?.lien ?? '')
    // Un chemin de fichier ne se lit pas : on dit le nom du fichier.
    .replace(/(?<![\p{L}\d])(?:[A-Za-z]:\\|~?\/)(?:[\w.\-]+[\\/])+([\w.\-]*)/gu, (m, nom: string) => nom || m.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || '')
    // Les balises ne se disent pas ; « <conteneur> » (un mot à remplacer) se dit « conteneur ».
    .replace(/<\/?(?:b|i|u|s|a|p|br|em|strong|code|pre|span|div|ul|ol|li|h[1-6]|table|thead|tbody|tr|td|th|img|hr|blockquote|sup|sub|small|details|summary|kbd|mark|del|ins)(?:\s[^<>\n]*)?\/?>/gi, ' ')
    .replace(/<([\p{L}][\p{L} ]{1,30})>/gu, '$1');
  const out: string[] = [];
  const lignes = t.split('\n');
  for (let i = 0; i < lignes.length; i++) {
    const l = lignes[i];
    if (/^\s*\|.*\|\s*$/.test(l)) {
      const bloc = [l]; while (i + 1 < lignes.length && /^\s*\|.*\|\s*$/.test(lignes[i + 1])) bloc.push(lignes[++i]);
      out.push(direTableau(bloc, mots)); continue;
    }
    if (PUCE.test(l)) {
      const items = [PUCE.exec(l)![1]];
      while (i + 1 < lignes.length && PUCE.test(lignes[i + 1])) items.push(PUCE.exec(lignes[++i])![1]);
      // Une ligne qui n'est qu'un lien (« Sources ») ne se dit pas.
      const dits = items.filter((x) => !mots || sansFin(x) !== mots.lien);
      if (dits.length) out.push(direListe(dits, fr)); else if (mots) out.push(`${mots.liens}.`);
      continue;
    }
    // Un trait de séparation, ou le trait d'un tableau écrit sans barres au bord : rien à dire.
    if (/^\s*(?:-{3,}|\*{3,}|_{3,}|={3,})\s*$/.test(l) || /^\s*\|?\s*:?-{2,}:?\s*(?:\|\s*:?-{2,}:?\s*)+\|?\s*$/.test(l)) continue;
    out.push(l.replace(/^\s*#{1,6}\s+/, '').replace(/^\s*>+\s?/, ''));
  }
  return out.join('\n');
}

// ---------------------------------------------------------------- Dit comme on le dit (français)

const AVANT_HEURE = /(?:^|[\s(«"'’])(?:à|a|vers|avant|après|apres|dès|des|jusqu['’]à|il est|pour|de|entre|et|depuis)\s$/iu;
function enFrancais(texte: string): string {
  let t = texte
    // Milliers écrits avec une espace : « 12 000 » → 12000.
    .replace(/(?<![\d.,])(\d{1,3})((?:[   ]\d{3})+)(?![\d])/g, (_m, a: string, b: string) => a + b.replace(/[   ]/g, ''))
    // Dates : « 2026-11-15 10:00 », « 15/11/2026 », « le 15/11 ».
    .replace(/(?<![\d-])(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?Z?)?(?![\d-])/g, (m, a: string, mo: string, j: string, h?: string, mi?: string) => (Number(mo) >= 1 && Number(mo) <= 12 && Number(j) >= 1 && Number(j) <= 31 ? `${dateDite(Number(j), Number(mo), Number(a))}${h ? ` à ${heureDite(Number(h), Number(mi))}` : ''}` : m))
    .replace(/(?<![\d/])(\d{1,2})\/(\d{1,2})\/(\d{4}|\d{2})(?![\d/])/g, (m, j: string, mo: string, a: string) => (Number(mo) >= 1 && Number(mo) <= 12 && Number(j) >= 1 && Number(j) <= 31 ? dateDite(Number(j), Number(mo), a.length === 2 ? 2000 + Number(a) : Number(a)) : m))
    .replace(/((?:^|[\s(])(?:le|du|au|jusqu['’]au|depuis le|dès le|avant le|après le|pour le)\s)(\d{1,2})\/(\d{1,2})(?![\d/])/giu, (m, avant: string, j: string, mo: string) => (Number(mo) >= 1 && Number(mo) <= 12 && Number(j) >= 1 && Number(j) <= 31 ? `${avant}${dateDite(Number(j), Number(mo))}` : m))
    // « 24h/24 », « 7j/7 ».
    .replace(/(?<![\d])24\s?h\s?\/\s?24(?!\d)/gi, 'vingt-quatre heures sur vingt-quatre').replace(/(?<![\d])7\s?j\s?\/\s?7(?!\d)/gi, 'sept jours sur sept')
    // Numéros de téléphone : deux chiffres à la fois.
    .replace(/(?<![\d.])0\d(?:[ .-]?\d{2}){4}(?![\d])/g, (m) => m.replace(/\D/g, '').replace(/(\d{2})(?=\d)/g, '$1, ').split(', ').map((p) => direNombre(p)).join(', '))
    // Heures : « 14:30 », « 14h30 », « 9 h 05 », « 14:30:05 », puis « 9h ».
    .replace(/(?<![\d:.,\p{L}])([01]?\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?(?![\d:\p{L}])/gu, (_m, h: string, mi: string, s?: string) => `${heureDite(Number(h), Number(mi))}${s && Number(s) ? ` et ${nombreEnLettres(Number(s), true)} seconde${Number(s) > 1 ? 's' : ''}` : ''}`)
    .replace(/(?<![\d:.,\p{L}])([01]?\d|2[0-3])\s?h\s?([0-5]\d)(?:\s?(?:min|mn)(?![\p{L}]))?(?![\d\p{L}])/gu, (_m, h: string, mi: string) => heureDite(Number(h), Number(mi)));
  t = t.replace(/(?<![\d:.,\p{L}])([01]?\d|2[0-3])\s?h(?![\p{L}\d'’/])/gu, (m, h: string, pos: number) => heureDite(Number(h), 0, AVANT_HEURE.test(t.slice(Math.max(0, pos - 14), pos))) || m);
  t = t
    // Argent : « 12,50 € » → « douze euros cinquante », « 0,99 € » → « quatre-vingt-dix-neuf centimes ».
    .replace(new RegExp(`(?<![\\p{L}\\d.,])(${NB})\\s?([kM])?(?:€|euros?(?![\\p{L}])|EUR(?![\\p{L}]))`, 'gu'), (_m, n: string, mult?: string) => {
      if (mult) return `${direNombre(n)} ${mult === 'k' ? 'mille' : `million${plusieurs(n) ? 's' : ''} d'`}${mult === 'k' ? ' ' : ''}euros`;
      const c = /^(\d+)[.,](\d{2})$/.exec(n);
      if (c && Number(c[1]) === 0) return `${nombreEnLettres(Number(c[2]))} centime${Number(c[2]) > 1 ? 's' : ''}`;
      if (c) return `${nombreEnLettres(Number(c[1]))} euro${Number(c[1]) > 1 ? 's' : ''}${Number(c[2]) ? ` ${nombreEnLettres(Number(c[2]))}` : ''}`;
      return `${direNombre(n)} euro${plusieurs(n) ? 's' : ''}`;
    })
    .replace(new RegExp(`(?<![\\p{L}\\d.,])(${NB})\\s?(?:\\$|USD(?![\\p{L}]))|\\$\\s?(${NB})`, 'gu'), (_m, a?: string, b?: string) => { const n = a ?? b ?? ''; return `${direNombre(n)} dollar${plusieurs(n) ? 's' : ''}`; })
    .replace(new RegExp(`(?<![\\p{L}\\d.,])(${NB})\\s?£|£\\s?(${NB})`, 'gu'), (_m, a?: string, b?: string) => { const n = a ?? b ?? ''; return `${direNombre(n, true)} livre${plusieurs(n) ? 's' : ''}`; })
    // De … à … : « 18–27 », « 3-4 ».
    .replace(new RegExp(`(?<![\\p{L}\\d.,-])(${NB})\\s?[–—]\\s?(?=\\d)`, 'gu'), '$1 à ')
    .replace(new RegExp(`(?<![\\p{L}\\d.,-])(${NB})-(?=${NB}(?![\\d-]))`, 'gu'), '$1 à ')
    // Unités : « 12 Go », « 92 % », « 24 °C », « 30 min », « 18 km/h ».
    .replace(MESURE, (_m, n: string, u: string) => { const [, un, des, fem] = mesureDe(u); return `${direNombre(n, Boolean(fem))} ${plusieurs(n) ? des : un}`; })
    // Rangs : « 1er », « 1re », « 2e », « 3ème ».
    .replace(/(?<![\p{L}\d.,])1\s?(?:er)(?![\p{L}])/gu, 'premier').replace(/(?<![\p{L}\d.,])1\s?(?:re|ère)(?![\p{L}])/gu, 'première')
    .replace(/(?<![\p{L}\d.,])(\d{1,3})\s?(?:ème|eme|e)(?![\p{L}\d])/gu, (_m, n: string) => ordinal(Number(n)))
    // Versions et adresses : « v1.35.0 », « 192.168.1.20 ».
    .replace(/(?<![\p{L}\d.])(version\s+)?v(\d+(?:\.\d+)+)(?![\p{L}\d])/giu, (_m, deja: string | undefined, n: string) => `${deja ?? 'version '}${n.split('.').map((p) => direNombre(p)).join(' point ')}`)
    .replace(/(?<![\p{L}\d.,])\d+(?:\.\d+){2,}(?![\p{L}\d])/gu, (m) => m.split('.').map((p) => direNombre(p)).join(' point '))
    // « 3/5 » → « trois sur cinq », « ×2 », « 1920x1080 ».
    .replace(/(?<![\p{L}\d.,/])(\d+)\s?\/\s?(\d+)(?![\p{L}\d/])/gu, '$1 sur $2')
    .replace(/(?<![\p{L}\d])(\d+)\s?[x×]\s?(\d+)(?![\p{L}\d])/gu, '$1 par $2').replace(/×\s?(?=\d)/g, 'fois ')
    // Les signes qui se disent.
    .replace(/(?<=^|[\s(:])[-−](?=\d)/gmu, 'moins ').replace(/(?<=^|[\s(])\+(?=\d)/gmu, 'plus ')
    .replace(/\s*(?:→|➜|➔|⇒|->|=>)\s*/g, ', puis ').replace(/\s*(?:←|<-)\s*/g, ', ').replace(/\s*↔\s*/g, ' et ')
    .replace(/(?<=[\p{L}\d])\s?&\s?(?=[\p{L}\d])/gu, ' et ').replace(/\s&\s/g, ' et ')
    .replace(/\s?≥\s?/g, ' supérieur ou égal à ').replace(/\s?≤\s?/g, ' inférieur ou égal à ').replace(/(?<=\d)\s?>\s?(?=\d)/g, ' supérieur à ').replace(/(?<=\d)\s?<\s?(?=\d)/g, ' inférieur à ')
    .replace(/[~≈]\s?(?=\d)/g, 'environ ').replace(/±\s?/g, 'plus ou moins ')
    .replace(/(?<=\d)\s?\+\s?(?=\d)/g, ' plus ').replace(/\s=\s/g, ' égale ')
    .replace(/(?<=[\p{L}])\/(?=[\p{L}])/gu, ' ou ');
  for (const [re, par] of ABREVIATIONS) t = t.replace(re, par);
  return t
    .replace(SIGLES, (m) => epeler(m))
    // Un nom de fichier ou de site : « config.json » → « config point json ».
    .replace(/(?<=[\p{L}\d]{2})\.(?=[\p{L}])/gu, ' point ')
    // Les nombres qui restent, en toutes lettres.
    .replace(new RegExp(`(?<![\\p{L}\\d_.,/-]|[\\p{L}]['’])(${NB})(?![\\p{L}\\d_]|[.,/]\\d)`, 'gu'), (_m, n: string) => direNombre(n));
}

// ---------------------------------------------------------------- Pauses et dernier ménage

/** Ponctuation qui fait respirer la voix, puis tout ce qui ne se dit pas est retiré. */
function pauses(texte: string): string {
  return texte
    // Les émojis et les pictogrammes ne se disent pas.
    .replace(/[\p{Extended_Pictographic}️‍⃣]|[\u{1F3FB}-\u{1F3FF}]|[✓✔✗✘☐☑☒★☆▶►◀●○■□▪▫◆◇→←↑↓⇒➜➔]/gu, '')
    // Une fin de ligne sans ponctuation devient un point : la voix marque la pause (titre, puis texte).
    .split('\n').map((l) => l.trim()).filter(Boolean).map((l, i, tout) => (i === tout.length - 1 || /[.!?:;,…]$/.test(l) ? l : `${l}.`)).join(' ')
    .replace(/\.{3,}/g, '…')
    .replace(/\s+[–—-]\s+/g, ', ').replace(/\s*[·•|]\s*/g, ', ')
    .replace(/\s*\(\s*/g, ', ').replace(/\s*\)/g, ',')
    .replace(/[«»“”"]/g, ' ')
    .replace(/(?<=[\p{L}\d])_(?=[\p{L}\d])/gu, ' ')
    // Une commande écrite (« /essai off ») : la barre ne se dit pas ; une barre entre deux blocs est une pause.
    .replace(/(?<![\p{L}\d])\/(?=\p{L})/gu, '').replace(/\s+\/\s+/g, ', ')
    .replace(/[*_#>`~^\\{}[\]<=+|]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.…])/g, '$1').replace(/,(?:\s*,)+/g, ',').replace(/([.!?…:;])\s*,/g, '$1').replace(/,\s*([.!?…;])/g, '$1').replace(/([!?…])\s*\./g, '$1').replace(/\.(?:\s*\.)+/g, '.').replace(/:\s*\./g, '.').replace(/,\s*:/g, ' :')
    .replace(/^[\s,.;:]+/, '').replace(/[\s,]+$/, '')
    .trim();
}

/**
 * Prépare un texte pour une voix. `langue` : code à deux lettres de la langue du texte (« fr » par défaut) ; les
 * nombres, heures, unités, sigles et listes ne sont dits « à la française » que pour un texte en français. Pur.
 */
export function pourLaVoix(texte: string, langue = 'fr'): string {
  const l = (langue || 'fr').slice(0, 2).toLowerCase();
  let t = menage(texte, l);
  if (l === 'fr') t = enFrancais(t);
  t = pauses(t);
  const mots = MOTS_DITS[l];
  // Plusieurs liens à la suite : dits une seule fois.
  if (mots) t = t.replace(new RegExp(`${mots.lien}(?:[\\s,.;]+(?:et\\s+)?${mots.lien})+`, 'g'), mots.liens);
  return t;
}
