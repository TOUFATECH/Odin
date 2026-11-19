// Les expressions de calcul (+ − × ÷ ^, parenthèses, pourcentages), lues par un analyseur écrit à la main (descente
// récursive) et calculées en fractions exactes (voir nombres.ts) : 0,1 + 0,2 = 0,3. Le texte n'est JAMAIS exécuté comme
// du code. Les opérations s'écrivent en signes ou en mots (« trois plus quatre », « seven times six », « zwölf geteilt
// durch vier », « 3 زائد 4 », « 5 mara 6 »), en français, anglais, espagnol, allemand, arabe et swahili.
//  - Priorités usuelles : la puissance d'abord (de droite à gauche : 2^3^2 = 2^9), puis × et ÷, puis + et −. Le moins
//    devant une puissance s'applique après elle (−2^2 = −4) : c'est dit dans `pasSur`.
//  - « 17 % » vaut 17/100 ; « 17 % de 240 » vaut 0,17 × 240 ; « 240 + 17 % » est lu 240 + 17 % de 240 (comme sur une
//    calculatrice), et c'est dit.
//  - Pas de multiplication sous-entendue (« 2(3 + 4) ») : l'expression n'est pas devinée, `direct` demande le signe.
//  - Bornes : longueur de l'expression, nombre de morceaux, profondeur des parenthèses, chiffres d'un nombre, taille
//    des résultats et des puissances. Une puissance non entière n'est pas calculée (pas de valeur exacte en fraction).
// Pur : aucune lecture de fichier, aucune horloge.

import {
  BITS_MAX, LONGUEUR_MAX, bitsDe, choisirLangue, CHIFFRES_MAX, divise, ecrire, ecrireNombre, egal, fois, formater, jetons, lireChiffres,
  lireNombreMots, moins, norm, oppose, plus, puissanceEntiere, rat, remplir, texteArrondiScientifique, textesCalcul, versFraction, LANGUES_CALCUL,
  type Jeton, type Langue, type Rationnel, type ReponseCalculee,
} from './nombres.ts';

/** Profondeur maximale des parenthèses. */
export const PROFONDEUR_MAX = 20;
/** Nombre maximal de morceaux (nombres, signes) dans une expression. */
export const MORCEAUX_MAX = 200;

export type ErreurCalcul = 'division-par-zero' | 'puissance-non-entiere' | 'trop-grand' | 'trop-long' | 'trop-profond' | 'nombre-trop-long' | 'syntaxe' | 'inconnu';

// ---------------------------------------------------------------------------------------------------------------
// Les mots, par langue (forme de comparaison ; plusieurs mots permis)

type Op = '+' | '-' | '*' | '/' | '^' | '(' | ')' | '%' | 'de' | '²' | '³' | 'pct-avant';
const mots = (s: string) => s.split(',').map((x) => norm(x.trim())).filter(Boolean);
const OPERATIONS: Record<Langue, Array<[string[], Op]>> = {
  fr: [[mots('plus'), '+'], [mots('moins'), '-'], [mots('fois,multiplié par,multiplie par,x'), '*'], [mots('divisé par,divise par'), '/'],
    [mots('puissance,à la puissance,a la puissance'), '^'], [mots('au carré'), '²'], [mots('au cube'), '³'], [mots('pour cent,pourcent'), '%'], [mots('de,du,des'), 'de']],
  en: [[mots('plus'), '+'], [mots('minus'), '-'], [mots('times,multiplied by,x'), '*'], [mots('divided by'), '/'],
    [mots('to the power of,to the power,power'), '^'], [mots('squared'), '²'], [mots('cubed'), '³'], [mots('percent,per cent'), '%'], [mots('of'), 'de']],
  es: [[mots('más,mas'), '+'], [mots('menos'), '-'], [mots('por,multiplicado por,x'), '*'], [mots('dividido por,dividido entre,entre'), '/'],
    [mots('elevado a,a la potencia'), '^'], [mots('al cuadrado'), '²'], [mots('al cubo'), '³'], [mots('por ciento'), '%'], [mots('de,del'), 'de']],
  de: [[mots('plus,und'), '+'], [mots('minus,weniger'), '-'], [mots('mal,multipliziert mit,x'), '*'], [mots('geteilt durch,dividiert durch,durch'), '/'],
    [mots('hoch'), '^'], [mots('zum quadrat,im quadrat'), '²'], [mots('prozent'), '%'], [mots('von'), 'de']],
  ar: [[mots('زائد,زايد,جمع'), '+'], [mots('ناقص,طرح'), '-'], [mots('ضرب,مضروب في,في'), '*'], [mots('قسمة,مقسوم على,على'), '/'],
    [mots('أس,اس,قوة'), '^'], [mots('تربيع'), '²'], [mots('بالمئة,بالمائة,في المئة,في المائة'), '%'], [mots('من'), 'de']],
  sw: [[mots('jumlisha,ongeza'), '+'], [mots('toa,kutoa,ondoa'), '-'], [mots('mara,zidisha'), '*'], [mots('gawanya kwa,gawanya'), '/'],
    [mots('asilimia'), 'pct-avant'], [mots('ya'), 'de']],
};
/** Les mots qui ouvrent ou ferment une question de calcul (retirés avant de lire l'expression). */
const DEBUTS: Record<Langue, string[]> = {
  fr: mots("combien font,combien fait,combien ça fait,combien ca fait,ça fait combien,ca fait combien,combien vaut,que vaut,calcule,calculer,calcul,résultat de,c'est combien"),
  en: mots("what is,what's,how much is,calculate,compute,evaluate"),
  es: mots('cuánto es,cuanto es,cuánto son,cuanto son,cuánto da,cuanto da,calcula,calcular'),
  de: mots('was ist,wie viel ist,wieviel ist,was ergibt,berechne,rechne'),
  ar: mots('كم يساوي,كم تساوي,ما ناتج,ما هو ناتج,ما حاصل,احسب,كم'),
  sw: mots('hesabu,kokotoa,jumla ya'),
};
const FINS: Record<Langue, string[]> = {
  fr: mots('égal,égale,égal à,font combien,fait combien'), en: mots('equals,equal'), es: mots('igual a,es igual'),
  de: mots('gleich,ist gleich'), ar: mots('يساوي,تساوي'), sw: mots('ni ngapi,ni sawa na'),
};
/** Ce qui peut finir une phrase sans faire partie du calcul. */
const PONCTUATION_FIN = new Set(['?', '؟', '=', '.', '!']);

let MOTS_LANGUE: Record<Langue, Set<string>> | undefined;
function motsLangue(): Record<Langue, Set<string>> {
  if (MOTS_LANGUE) return MOTS_LANGUE;
  const m = {} as Record<Langue, Set<string>>;
  for (const l of LANGUES_CALCUL) {
    const s = new Set<string>([...DEBUTS[l], ...FINS[l]]);
    for (const [liste, op] of OPERATIONS[l]) if (op !== 'de') for (const x of liste) if (x.length > 1) s.add(x);
    m[l] = s;
  }
  // Les mots-nombres longs (« quatre », « seven »…) comptent aussi pour leur langue.
  const nombres: Record<Langue, string[]> = {
    fr: mots('deux,trois,quatre,cinq,sept,huit,neuf,onze,douze,treize,quatorze,quinze,seize,vingt,trente,quarante,cinquante,soixante,cent,mille'),
    en: mots('zero,three,four,five,seven,eight,nine,eleven,twelve,twenty,thirty,forty,fifty,hundred,thousand'),
    es: mots('cero,tres,cuatro,cinco,seis,siete,ocho,nueve,diez,once,doce,veinte,treinta,cien,ciento,mil'),
    de: mots('zwei,drei,vier,fünf,sechs,sieben,acht,neun,zehn,zwölf,zwanzig,dreißig,hundert,tausend'),
    ar: mots('واحد,اثنان,ثلاثة,أربعة,خمسة,ستة,سبعة,ثمانية,تسعة,عشرة'),
    sw: mots('moja,mbili,tatu,nne,tano,sita,saba,nane,tisa,kumi,ishirini,mia,elfu'),
  };
  for (const l of LANGUES_CALCUL) for (const x of nombres[l]) m[l].add(x);
  return (MOTS_LANGUE = m);
}

// ---------------------------------------------------------------------------------------------------------------
// Les morceaux d'une expression

type Morceau = { k: 'n'; v: Rationnel; brut: string; ambigu?: { autre: Rationnel } } | { k: 'op'; op: Op };

class Arret extends Error { readonly code: ErreurCalcul; constructor(code: ErreurCalcul) { super(code); this.code = code; } }

/** Les jetons d'une expression → nombres et opérations. Un mot inconnu : erreur « inconnu ». */
function morceaux(js: Jeton[], l: Langue): Morceau[] {
  const out: Morceau[] = [];
  const ops = OPERATIONS[l].flatMap(([liste, op]) => liste.map((m) => [m.split(' '), op] as const)).sort((a, b) => b[0].length - a[0].length);
  for (let i = 0; i < js.length;) {
    const j = js[i];
    if (j.sorte === 'nombre') {
      if (j.brut.replace(/\D/g, '').length > CHIFFRES_MAX) throw new Arret('nombre-trop-long');
      const lu = lireChiffres(j.brut, l);
      if (!lu) throw new Arret('syntaxe');
      out.push({ k: 'n', v: lu.valeur, brut: j.brut, ...(lu.ambigu && lu.autre ? { ambigu: { autre: lu.autre } } : {}) });
      i++; continue;
    }
    if (j.sorte === 'signe') {
      const s = j.brut;
      if (s === '*' && js[i + 1]?.brut === '*' && js[i + 1].debut === j.fin) { out.push({ k: 'op', op: '^' }); i += 2; continue; }
      const op: Op | undefined = s === '+' ? '+' : s === '-' || s === '−' || s === '–' ? '-' : s === '*' || s === '×' || s === '·' || s === '⋅' ? '*'
        : s === '/' || s === '÷' ? '/' : s === '^' ? '^' : s === '(' ? '(' : s === ')' ? ')' : s === '%' ? '%' : s === '²' ? '²' : s === '³' ? '³' : undefined;
      if (op) { out.push({ k: 'op', op }); i++; continue; }
      if (s === ':') {
        // « 12 : 4 » (deux-points entourés d'espaces) est une division ; « 12:30 » est une heure, pas un calcul.
        const espaces = i > 0 && js[i - 1].fin < j.debut && i + 1 < js.length && js[i + 1].debut > j.fin;
        if (!espaces) throw new Arret('syntaxe');
        out.push({ k: 'op', op: '/' }); i++; continue;
      }
      throw new Arret('inconnu');
    }
    // Un mot : une opération (le plus long d'abord), sinon un nombre en lettres.
    const trouve = ops.find(([m]) => m.every((w, k) => js[i + k]?.sorte === 'mot' && js[i + k].n === w));
    if (trouve) {
      const op = trouve[1];
      // « de », « of », « von »… ne valent « × » que juste après un pourcentage.
      if (op === 'de' && !(out[out.length - 1]?.k === 'op' && (out[out.length - 1] as { op: Op }).op === '%')) throw new Arret('inconnu');
      out.push({ k: 'op', op }); i += trouve[0].length; continue;
    }
    const nm = lireNombreMots(js, i, l);
    if (nm) { out.push({ k: 'n', v: rat(nm.valeur), brut: js.slice(i, nm.fin).map((x) => x.brut).join(' ') }); i = nm.fin; continue; }
    throw new Arret('inconnu');
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// L'analyseur (descente récursive) et le calcul

interface Noeud {
  v: Rationnel;
  /** L'expression réécrite, dans la langue (« 2 + 3 × 4 »). */
  t: string;
  /** Un pourcentage seul (« 17 % ») : un « + » ou un « − » qui le précède le prend sur le nombre de gauche. */
  pct?: boolean;
  /** Une puissance sans parenthèses (pour dire que −a^b vaut −(a^b)). */
  puissance?: boolean;
}
interface Avis { moinsPuissance: boolean; pourcent: Array<{ a: string; s: string; p: string }>; ambigus: Array<{ brut: string; lu: Rationnel; autre: Rationnel }> }

function analyser(ms: Morceau[], l: Langue): { noeud: Noeud; avis: Avis } {
  let i = 0, profondeur = 0;
  const avis: Avis = { moinsPuissance: false, pourcent: [], ambigus: [] };
  const f = (v: Rationnel) => { const e = ecrire(v, 6); return e.exact ? formater(e.decimal, l) : versFraction(v); };
  const borne = (v: Rationnel): Rationnel => { if (bitsDe(v) > BITS_MAX) throw new Arret('trop-grand'); return v; };
  const voir = (): Morceau | undefined => ms[i];
  const estOp = (op: Op) => { const m = ms[i]; return m?.k === 'op' && m.op === op; };

  function expression(): Noeud {
    let g = terme();
    while (estOp('+') || estOp('-')) {
      const op = (ms[i++] as { op: Op }).op;
      const d = terme();
      let dv = d.v;
      if (d.pct) { dv = fois(g.v, d.v); avis.pourcent.push({ a: g.t, s: op === '+' ? '+' : '−', p: d.t }); }
      g = { v: borne(op === '+' ? plus(g.v, dv) : moins(g.v, dv)), t: `${g.t} ${op === '+' ? '+' : '−'} ${d.t}` };
    }
    return g;
  }
  function terme(): Noeud {
    let g = unaire();
    while (estOp('*') || estOp('/') || estOp('de')) {
      const op = (ms[i++] as { op: Op }).op;
      const d = unaire();
      if (op === '/') {
        const q = divise(g.v, d.v);
        if (!q) throw new Arret('division-par-zero');
        g = { v: borne(q), t: `${g.t} ÷ ${d.t}` };
      } else g = { v: borne(fois(g.v, d.v)), t: `${g.t} ${op === 'de' ? '×' : '×'} ${d.t}` };
    }
    return g;
  }
  function unaire(): Noeud {
    if (estOp('-')) { i++; const n = unaire(); if (n.puissance) avis.moinsPuissance = true; return { v: oppose(n.v), t: `−${n.t}` }; }
    if (estOp('+')) { i++; return unaire(); }
    if (estOp('pct-avant')) {
      // « asilimia 17 » : 17 %.
      i++; const n = postfixe();
      return { v: divise(n.v, rat(100n))!, t: `${n.t} %`, pct: true };
    }
    return puissance();
  }
  function puissance(): Noeud {
    const base = postfixe();
    if (!estOp('^')) return base;
    i++;
    const e = unaire(); // de droite à gauche, exposant signé permis : 2^-2
    if (e.v.d !== 1n) throw new Arret('puissance-non-entiere');
    if (e.v.n > 100000n || e.v.n < -100000n) throw new Arret('trop-grand');
    if (base.v.n === 0n && e.v.n < 0n) throw new Arret('division-par-zero');
    const p = puissanceEntiere(base.v, e.v.n);
    if (!p) throw new Arret('trop-grand');
    return { v: borne(p), t: `${base.t}^${e.t}`, puissance: true };
  }
  function postfixe(): Noeud {
    let n = primaire();
    for (;;) {
      if (estOp('%')) { i++; n = { v: divise(n.v, rat(100n))!, t: `${n.t} %`, pct: true }; continue; }
      if (estOp('²') || estOp('³')) {
        const k = estOp('²') ? 2n : 3n; i++;
        const p = puissanceEntiere(n.v, k);
        if (!p) throw new Arret('trop-grand');
        n = { v: borne(p), t: `${n.t}^${k}`, puissance: true }; continue;
      }
      break;
    }
    // Un nombre ou une parenthèse juste après : multiplication sous-entendue, non devinée.
    const s = voir();
    if (s && (s.k === 'n' || (s.k === 'op' && s.op === '('))) throw new Arret('syntaxe');
    return n;
  }
  function primaire(): Noeud {
    const m = voir();
    if (!m) throw new Arret('syntaxe');
    if (m.k === 'n') {
      i++;
      if (m.ambigu) avis.ambigus.push({ brut: m.brut, lu: m.v, autre: m.ambigu.autre });
      return { v: m.v, t: f(m.v) };
    }
    if (m.op === '(') {
      if (++profondeur > PROFONDEUR_MAX) throw new Arret('trop-profond');
      i++;
      const n = expression();
      if (!estOp(')')) throw new Arret('syntaxe');
      i++; profondeur--;
      return { v: n.v, t: `(${n.t})` };
    }
    throw new Arret('syntaxe');
  }

  const noeud = expression();
  if (i !== ms.length) throw new Arret('syntaxe');
  return { noeud, avis };
}

export interface Evaluation {
  valeur?: Rationnel;
  erreur?: ErreurCalcul;
  /** L'expression réécrite (« 2 + 3 × 4 »). */
  texte?: string;
  avis?: Avis;
}

function evaluerJetons(js: Jeton[], l: Langue): Evaluation {
  try {
    if (js.length > MORCEAUX_MAX) return { erreur: 'trop-long' };
    const ms = morceaux(js, l);
    // Les parenthèses trop imbriquées arrêtent tout, avant même de savoir s'il y a une opération.
    let p = 0;
    for (const m of ms) if (m.k === 'op') { if (m.op === '(') { p++; if (p > PROFONDEUR_MAX) return { erreur: 'trop-profond' }; } else if (m.op === ')') p--; }
    if (!ms.some((m) => m.k === 'op' && m.op !== '(' && m.op !== ')')) return { erreur: 'inconnu' }; // un nombre seul n'est pas un calcul
    const { noeud, avis } = analyser(ms, l);
    return { valeur: noeud.v, texte: noeud.t, avis };
  } catch (e) {
    if (e instanceof Arret) return { erreur: e.code };
    if (e instanceof RangeError) return { erreur: 'trop-grand' };
    throw e;
  }
}

/** Calcule une expression écrite (« (2 + 3) × 4 », « trois plus quatre ») dans une langue couverte. */
export function evaluer(expression: string, langue: string): Evaluation {
  const l = LANGUES_CALCUL.includes(langue as Langue) ? (langue as Langue) : undefined;
  if (!l) return { erreur: 'inconnu' };
  if (typeof expression !== 'string' || expression.length > LONGUEUR_MAX) return { erreur: 'trop-long' };
  return evaluerJetons(jetons(expression), l);
}

// ---------------------------------------------------------------------------------------------------------------
// La réponse

interface Textes {
  erreurs: Record<Exclude<ErreurCalcul, 'inconnu'>, string>;
  moinsPuissance: string; pourcent: string; separateur: string; exacte: string; arrondi: string;
}
const TEXTES: Record<Langue, Textes> = {
  fr: {
    erreurs: {
      'division-par-zero': 'Division par zéro : pas de résultat.', 'puissance-non-entiere': "Puissance non entière : je ne la calcule pas, faute de valeur exacte.",
      'trop-grand': 'Résultat trop grand pour être calculé exactement.', 'trop-long': 'Expression trop longue : je ne la calcule pas.',
      'trop-profond': 'Trop de parenthèses imbriquées : je ne la calcule pas.', 'nombre-trop-long': 'Un nombre a trop de chiffres (40 au plus).',
      syntaxe: 'Je ne lis pas cette expression : écris chaque signe, par exemple 2 × (3 + 4).',
    },
    moinsPuissance: 'Le signe moins est appliqué après la puissance : −a^b = −(a^b).', pourcent: '« {a} {s} {p} » est lu comme {a} {s} ({p} de {a}).',
    separateur: '« {brut} » est lu {lu} ; il peut aussi se lire {autre}.', exacte: 'Valeur exacte : {f}.', arrondi: 'Arrondi à {k} décimales ; valeur exacte : {f}.',
  },
  en: {
    erreurs: {
      'division-par-zero': 'Division by zero: no result.', 'puissance-non-entiere': 'Non-integer power: not calculated, as it has no exact value.',
      'trop-grand': 'The result is too large to calculate exactly.', 'trop-long': 'The expression is too long: not calculated.',
      'trop-profond': 'Too many nested brackets: not calculated.', 'nombre-trop-long': 'A number has too many digits (40 at most).',
      syntaxe: 'I cannot read this expression: write every sign, for example 2 × (3 + 4).',
    },
    moinsPuissance: 'The minus sign applies after the power: −a^b = −(a^b).', pourcent: '“{a} {s} {p}” is read as {a} {s} ({p} of {a}).',
    separateur: '“{brut}” is read as {lu}; it could also mean {autre}.', exacte: 'Exact value: {f}.', arrondi: 'Rounded to {k} decimal places; exact value: {f}.',
  },
  es: {
    erreurs: {
      'division-par-zero': 'División por cero: no hay resultado.', 'puissance-non-entiere': 'Potencia no entera: no la calculo, no tiene valor exacto.',
      'trop-grand': 'Resultado demasiado grande para calcularlo exactamente.', 'trop-long': 'Expresión demasiado larga: no la calculo.',
      'trop-profond': 'Demasiados paréntesis anidados: no la calculo.', 'nombre-trop-long': 'Un número tiene demasiadas cifras (40 como máximo).',
      syntaxe: 'No puedo leer esta expresión: escribe cada signo, por ejemplo 2 × (3 + 4).',
    },
    moinsPuissance: 'El signo menos se aplica después de la potencia: −a^b = −(a^b).', pourcent: '«{a} {s} {p}» se lee como {a} {s} ({p} de {a}).',
    separateur: '«{brut}» se lee {lu}; también puede leerse {autre}.', exacte: 'Valor exacto: {f}.', arrondi: 'Redondeado a {k} decimales; valor exacto: {f}.',
  },
  de: {
    erreurs: {
      'division-par-zero': 'Division durch null: kein Ergebnis.', 'puissance-non-entiere': 'Nicht ganzzahlige Potenz: nicht berechnet, da es keinen exakten Wert gibt.',
      'trop-grand': 'Das Ergebnis ist zu groß für eine exakte Berechnung.', 'trop-long': 'Der Ausdruck ist zu lang: nicht berechnet.',
      'trop-profond': 'Zu viele verschachtelte Klammern: nicht berechnet.', 'nombre-trop-long': 'Eine Zahl hat zu viele Ziffern (höchstens 40).',
      syntaxe: 'Ich kann diesen Ausdruck nicht lesen: Schreibe jedes Zeichen, zum Beispiel 2 × (3 + 4).',
    },
    moinsPuissance: 'Das Minuszeichen gilt nach der Potenz: −a^b = −(a^b).', pourcent: '„{a} {s} {p}“ wird als {a} {s} ({p} von {a}) gelesen.',
    separateur: '„{brut}“ wird als {lu} gelesen; es kann auch {autre} bedeuten.', exacte: 'Genauer Wert: {f}.', arrondi: 'Auf {k} Nachkommastellen gerundet; genauer Wert: {f}.',
  },
  ar: {
    erreurs: {
      'division-par-zero': 'قسمة على صفر: لا نتيجة.', 'puissance-non-entiere': 'أس غير صحيح: لا أحسبه لعدم وجود قيمة دقيقة.',
      'trop-grand': 'النتيجة أكبر من أن تُحسب بدقة.', 'trop-long': 'العبارة طويلة جدًا: لا أحسبها.',
      'trop-profond': 'أقواس متداخلة كثيرة جدًا: لا أحسبها.', 'nombre-trop-long': 'عدد فيه أرقام كثيرة جدًا (40 على الأكثر).',
      syntaxe: 'لا أستطيع قراءة هذه العبارة: اكتب كل علامة، مثلًا 2 × (3 + 4).',
    },
    moinsPuissance: 'تُطبَّق إشارة السالب بعد الأس: −a^b = −(a^b).', pourcent: 'قُرئت «{a} {s} {p}» على أنها {a} {s} ({p} من {a}).',
    separateur: 'قُرئ «{brut}» على أنه {lu}؛ وقد يعني أيضًا {autre}.', exacte: 'القيمة الدقيقة: {f}.', arrondi: 'مقرّب إلى {k} منازل عشرية؛ القيمة الدقيقة: {f}.',
  },
  sw: {
    erreurs: {
      'division-par-zero': 'Kugawanya kwa sifuri: hakuna jibu.', 'puissance-non-entiere': 'Kipeo kisicho namba kamili: sikikokotoi, hakina thamani kamili.',
      'trop-grand': 'Jibu ni kubwa mno kukokotolewa kikamilifu.', 'trop-long': 'Hesabu ni ndefu mno: siikokotoi.',
      'trop-profond': 'Mabano mengi mno ndani ya mengine: siikokotoi.', 'nombre-trop-long': 'Namba ina tarakimu nyingi mno (40 zaidi).',
      syntaxe: 'Siwezi kusoma hesabu hii: andika kila alama, kwa mfano 2 × (3 + 4).',
    },
    moinsPuissance: 'Alama ya kutoa inatumika baada ya kipeo: −a^b = −(a^b).', pourcent: '“{a} {s} {p}” imesomwa kama {a} {s} ({p} ya {a}).',
    separateur: '“{brut}” imesomwa kama {lu}; inaweza pia kumaanisha {autre}.', exacte: 'Thamani kamili: {f}.', arrondi: 'Imekadiriwa hadi desimali {k}; thamani kamili: {f}.',
  },
};

export interface OptionsCalcul {
  /** La langue de la réponse (« fr », ou un code ISO 639-3). Absente : celle des mots de la phrase (sans mot : rien). */
  langue?: string;
}
export interface DonneesCalcul {
  /** L'expression lue, réécrite. */
  expression: string;
  /** L'écriture décimale (« . ») du résultat, exacte ou arrondie. */
  decimal: string;
  /** La fraction exacte. */
  exact: string;
  arrondi: boolean;
}

/** Retire les mots d'ouverture et de fin d'une question de calcul (« combien font … ? »). */
function deshabiller(js: Jeton[], l: Langue): Jeton[] {
  let a = 0, b = js.length;
  while (b > a && js[b - 1].sorte === 'signe' && PONCTUATION_FIN.has(js[b - 1].brut)) b--;
  const egalA = (liste: string[], depuisFin: boolean) => {
    for (const m of [...liste].sort((x, y) => y.split(' ').length - x.split(' ').length)) {
      const w = m.split(' ');
      const k0 = depuisFin ? b - w.length : a;
      if (k0 < a || k0 + w.length > b) continue;
      if (w.every((x, k) => js[k0 + k].sorte === 'mot' && js[k0 + k].n === x)) return w.length;
    }
    return 0;
  };
  const d = egalA(DEBUTS[l], false); a += d;
  const f = egalA(FINS[l], true); b -= f;
  while (b > a && js[b - 1].sorte === 'signe' && PONCTUATION_FIN.has(js[b - 1].brut)) b--;
  if (a < b && js[a].sorte === 'signe' && js[a].brut === ':') a++; // « calcule : 2 + 2 »
  return js.slice(a, b);
}

/**
 * La réponse à une question de calcul (« combien font 2 + 3 × 4 ? », « what is seven times six »). Rend `undefined`
 * quand la phrase n'est pas un calcul (un mot inconnu, aucun signe d'opération) ou que sa langue n'est pas couverte.
 * Une expression reconnue mais incalculable (division par zéro, bornes) : `reconnu` faux, et `direct` le dit.
 */
export function repondreCalcul(phrase: string, o: OptionsCalcul = {}): ReponseCalculee<DonneesCalcul> | undefined {
  if (typeof phrase !== 'string' || !phrase.trim() || phrase.length > 20 * LONGUEUR_MAX) return undefined;
  const js = jetons(phrase);
  const l = choisirLangue(js, o?.langue, motsLangue());
  if (!l) return undefined;
  const T = TEXTES[l];
  const base = { langue: l, sorte: 'expression', points: [] as string[], conseils: [], calcul: { par: 'regles' as const, texte: textesCalcul(l) } };
  if (phrase.length > LONGUEUR_MAX) {
    // Trop long : on ne le dit que si c'est bien une expression (chiffres et signes seulement).
    return /^[\p{Nd}\s+\-−*/×÷^().,%:]+$/u.test(phrase) ? { ...base, reconnu: false, direct: T.erreurs['trop-long'], pasSur: [] } : undefined;
  }
  const r = evaluerJetons(deshabiller(js, l), l);
  if (r.erreur === 'inconnu') return undefined;
  if (r.erreur || !r.valeur) return { ...base, reconnu: false, direct: T.erreurs[(r.erreur ?? 'syntaxe') as Exclude<ErreurCalcul, 'inconnu'>], pasSur: [] };
  const w = ecrireNombre(r.valeur, l);
  const pasSur: string[] = [];
  for (const a of r.avis?.ambigus ?? []) pasSur.push(remplir(T.separateur, { brut: a.brut, lu: formater(ecrire(a.lu).decimal, l), autre: formater(ecrire(a.autre).decimal, l) }));
  if (r.avis?.moinsPuissance) pasSur.push(T.moinsPuissance);
  for (const p of r.avis?.pourcent ?? []) pasSur.push(remplir(T.pourcent, p));
  const fx = versFraction(r.valeur);
  const points = [w.arrondiScientifique ? remplir(texteArrondiScientifique(l), { f: fx }) : w.ecriture.exact ? remplir(T.exacte, { f: fx }) : remplir(T.arrondi, { k: String(w.ecriture.decimales), f: fx })];
  return {
    ...base, reconnu: true, direct: `${r.texte} ${egal(w.texte)}`, points, pasSur,
    donnees: { expression: r.texte!, decimal: w.ecriture.decimal, exact: versFraction(r.valeur), arrondi: !w.ecriture.exact },
  };
}
