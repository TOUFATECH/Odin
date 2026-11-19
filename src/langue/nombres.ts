// Nombres, pourcentages, règle de trois, unités et monnaies, calculés EXACTEMENT, en règles, sans service en ligne ni
// modèle. Deuxième brique de la « réponse directe » d'une recherche (la première : temps-fuseaux.ts) : même forme de
// résultat (réponse directe, points, ce qui n'est pas sûr, conseils, comment c'est calculé, les nombres), en DONNÉES ;
// le branchement dans la conversation vient ensuite, ailleurs.
//  - Les calculs se font en fractions de grands entiers (BigInt) : 0,1 + 0,2 vaut 3/10, jamais 0,30000000000000004.
//    Un résultat qui n'a pas d'écriture décimale finie (1/3) est rendu arrondi, et l'arrondi est annoncé.
//  - Les facteurs des unités sont des définitions exactes (le pouce vaut 0,0254 m, la livre 0,45359237 kg…).
//  - Une monnaie ne se convertit QU'AVEC un taux fourni par l'appelant (daté, sourcé) : aucun taux n'est écrit ici.
//  - Langues couvertes : français, anglais, espagnol, allemand, arabe, swahili. Une autre langue ne rend rien ; sans
//    langue donnée, celle des mots de la phrase, et rien si les mots ne tranchent pas (jamais une réponse devinée).
//  - Une ambiguïté (séparateur décimal, gallon américain ou impérial, Go en 10^9 ou 2^30…) est dite dans `pasSur`.
//  - Bornes : longueur de la phrase, chiffres d'un nombre, taille des résultats.
// Pur : aucune lecture de fichier, aucune horloge, aucun exécuteur de code.

// ---------------------------------------------------------------------------------------------------------------
// Les langues

export type Langue = 'fr' | 'en' | 'es' | 'de' | 'ar' | 'sw';
export const LANGUES_CALCUL: readonly Langue[] = ['fr', 'en', 'es', 'de', 'ar', 'sw'];
/** Codes ISO 639-3 (ceux de la reconnaissance des langues) → codes des textes. */
const ISO3: Record<string, Langue> = {
  fra: 'fr', eng: 'en', spa: 'es', deu: 'de', ger: 'de', ara: 'ar', arb: 'ar', ary: 'ar', arz: 'ar', apc: 'ar', ajp: 'ar', acm: 'ar', swa: 'sw', swh: 'sw',
};
/** La langue demandée ramenée à un code de textes ; `undefined` : une langue que ces calculs ne couvrent pas. */
export function langueCouverte(langue: string): Langue | undefined {
  const c = String(langue ?? '').toLowerCase().split(/[-_]/)[0];
  return (LANGUES_CALCUL as readonly string[]).includes(c) ? (c as Langue) : ISO3[c];
}

/** Forme de comparaison : minuscules, sans accents (les hamzas arabes tombent avec), ß → ss, ى → ي, sans tatouïl. */
export function norm(s: string): string {
  return s.normalize('NFKD').replace(/\p{M}+/gu, '').toLowerCase().replace(/ß/g, 'ss').replace(/[’‘`´]/g, "'").replace(/ى/g, 'ي').replace(/ـ/g, '');
}
const PREFIXES_AR = ['و', 'ب', 'ل', 'ف', 'ك', 'ال', 'بال', 'لل', 'وال', 'وب', 'ول', 'فال', 'كال'];
/** Les formes d'un mot arabe sans ses préfixes collés (« بالكيلومتر » → « كيلومتر »). */
export function sansPrefixesAr(n: string): string[] {
  if (!/\p{Script=Arabic}/u.test(n)) return [];
  return PREFIXES_AR.filter((p) => n.startsWith(p) && n.length - p.length >= 2).map((p) => n.slice(p.length));
}

/**
 * Choisit la langue des textes : celle demandée (couverte, sinon rien), sinon la seule langue dont le plus de mots sont
 * dans la phrase. Égalité ou aucun mot : rien.
 */
export function choisirLangue(jetons: Jeton[], langue: string | undefined, mots: Record<Langue, Set<string>>): Langue | undefined {
  if (langue !== undefined && langue !== '') return langueCouverte(langue);
  const scores = new Map<Langue, number>();
  for (const l of LANGUES_CALCUL) {
    const s = mots[l];
    let k = 0;
    for (let i = 0; i < jetons.length; i++) {
      const j = jetons[i];
      if (j.sorte !== 'mot') continue;
      const deux = i + 1 < jetons.length ? j.n + ' ' + jetons[i + 1].n : '';
      const trois = i + 2 < jetons.length ? deux + ' ' + jetons[i + 2].n : '';
      if ((j.n.length > 1 && s.has(j.n)) || (deux && s.has(deux)) || (trois && s.has(trois)) || sansPrefixesAr(j.n).some((x) => s.has(x))) k++;
    }
    scores.set(l, k);
  }
  const tri = [...scores.entries()].sort((a, b) => b[1] - a[1]);
  if (!tri[0] || tri[0][1] === 0 || tri[0][1] === tri[1]?.[1]) return undefined;
  return tri[0][0];
}

// ---------------------------------------------------------------------------------------------------------------
// Les fractions exactes

/** Une fraction irréductible, dénominateur positif. */
export interface Rationnel { readonly n: bigint; readonly d: bigint }
const absB = (x: bigint) => (x < 0n ? -x : x);
function pgcd(a: bigint, b: bigint): bigint { a = absB(a); b = absB(b); while (b) { const t = a % b; a = b; b = t; } return a; }
/** Une fraction réduite ; un dénominateur nul lève une erreur (les appelants le testent avant). */
export function rat(n: bigint, d: bigint = 1n): Rationnel {
  if (d === 0n) throw new RangeError('division par zéro');
  if (d < 0n) { n = -n; d = -d; }
  const g = pgcd(n, d) || 1n;
  return { n: n / g, d: d / g };
}
export const plus = (a: Rationnel, b: Rationnel) => rat(a.n * b.d + b.n * a.d, a.d * b.d);
export const moins = (a: Rationnel, b: Rationnel) => rat(a.n * b.d - b.n * a.d, a.d * b.d);
export const fois = (a: Rationnel, b: Rationnel) => rat(a.n * b.n, a.d * b.d);
/** a ÷ b ; `undefined` quand b est nul. */
export const divise = (a: Rationnel, b: Rationnel): Rationnel | undefined => (b.n === 0n ? undefined : rat(a.n * b.d, a.d * b.n));
export const oppose = (a: Rationnel): Rationnel => ({ n: -a.n, d: a.d });
export const estEntier = (a: Rationnel) => a.d === 1n;
export const compare = (a: Rationnel, b: Rationnel) => { const x = a.n * b.d - b.n * a.d; return x < 0n ? -1 : x > 0n ? 1 : 0; };
const longueurBits = (x: bigint) => (x === 0n ? 0 : absB(x).toString(2).length);
/** La taille d'une fraction en bits (le plus long du numérateur et du dénominateur). */
export const bitsDe = (a: Rationnel) => Math.max(longueurBits(a.n), longueurBits(a.d));
/** Taille maximale d'un résultat, en bits (environ 1 230 chiffres). */
export const BITS_MAX = 4096;

/** a^e pour un exposant entier ; `undefined` si le résultat dépasserait la borne ou pour 0 à une puissance négative. */
export function puissanceEntiere(a: Rationnel, e: bigint, maxBits = BITS_MAX): Rationnel | undefined {
  if (e === 0n) return rat(1n);
  if (a.n === 0n) return e < 0n ? undefined : rat(0n);
  const k = absB(e);
  if (BigInt(bitsDe(a)) * k > BigInt(maxBits) + 1n && !(absB(a.n) === 1n && a.d === 1n)) return undefined;
  const p = absB(a.n) === 1n && a.d === 1n ? rat(a.n < 0n && k % 2n === 1n ? -1n : 1n) : rat(a.n ** k, a.d ** k);
  return e < 0n ? rat(p.d, p.n) : p;
}

/** « -123.456 » → fraction exacte. */
export function depuisDecimal(s: string): Rationnel {
  const m = /^([+-]?)(\d+)(?:\.(\d+))?$/.exec(s.trim());
  if (!m) throw new RangeError('nombre décimal illisible');
  const dec = m[3] ?? '';
  const r = rat(BigInt(m[2] + dec), 10n ** BigInt(dec.length));
  return m[1] === '-' ? oppose(r) : r;
}
/** « 1/3 », ou « 5 » pour un entier. */
export const versFraction = (a: Rationnel) => (a.d === 1n ? a.n.toString() : `${a.n}/${a.d}`);

/** L'écriture décimale exacte (avec « . »), si elle est finie et tient en `maxDecimales` chiffres après la virgule. */
export function decimalExact(a: Rationnel, maxDecimales = 20): string | undefined {
  let d = a.d, k2 = 0, k5 = 0;
  while (d % 2n === 0n) { d /= 2n; k2++; }
  while (d % 5n === 0n) { d /= 5n; k5++; }
  if (d !== 1n) return undefined;
  const k = Math.max(k2, k5);
  if (k > maxDecimales) return undefined;
  return ecrireEchelle(a.n * 10n ** BigInt(k) / a.d, k);
}
/** Un entier « mis à l'échelle » (valeur × 10^k) écrit en décimal, zéros de fin retirés. */
function ecrireEchelle(v: bigint, k: number): string {
  const neg = v < 0n, s = absB(v).toString().padStart(k + 1, '0');
  let ent = s.slice(0, s.length - k), dec = k ? s.slice(s.length - k) : '';
  dec = dec.replace(/0+$/, '');
  if (!ent) ent = '0';
  const r = dec ? `${ent}.${dec}` : ent;
  return neg && /[1-9]/.test(r) ? '-' + r : r;
}
/** Arrondi à `k` décimales, la moitié loin de zéro ; écrit avec « . ». */
export function arrondir(a: Rationnel, k: number): string {
  const e = 10n ** BigInt(k);
  const num = absB(a.n) * e * 2n + a.d, den = a.d * 2n; // (|x|·10^k + 1/2) tronqué
  const v = num / den;
  return ecrireEchelle(a.n < 0n ? -v : v, k);
}

export interface Ecriture {
  /** L'écriture décimale (« . »), exacte ou arrondie. */
  decimal: string;
  /** Vrai si `decimal` est la valeur exacte. */
  exact: boolean;
  /** Le nombre de décimales de l'arrondi (absent si exact). */
  decimales?: number;
}
/** L'écriture d'un résultat : exacte si possible, sinon arrondie à `decimales` (plus si l'arrondi donnerait 0). */
export function ecrire(a: Rationnel, decimales = 6): Ecriture {
  const ex = decimalExact(a, 20);
  if (ex !== undefined) return { decimal: ex, exact: true };
  let k = decimales, s = arrondir(a, k);
  while (/^-?0(?:\.0*)?$/.test(s) && k < 36) { k += decimales; s = arrondir(a, k); }
  return { decimal: s, exact: false, decimales: k };
}

/** Au-delà de ce nombre de chiffres avant la virgule, un résultat s'écrit en notation scientifique. */
const CHIFFRES_ECRITS_MAX = 40;
/**
 * La notation scientifique d'une valeur non nulle : mantisse arrondie à 6 décimales (7 chiffres significatifs), ramenée
 * entre 1 et 10 (9,9999997 devient 1 et l'exposant monte de 1), et `exact` vrai seulement si l'arrondi ne perd rien.
 */
function scientifique(a: Rationnel): { mantisse: string; exposant: number; exact: boolean } {
  const n = absB(a.n);
  const ramene = (k: number) => (k >= 0 ? rat(n, a.d * 10n ** BigInt(k)) : rat(n * 10n ** BigInt(-k), a.d));
  let p = n.toString().length - a.d.toString().length;
  if (compare(ramene(p), rat(1n)) < 0) p--;
  let m = ramene(p), s = arrondir(m, 6);
  if (compare(depuisDecimal(s), rat(10n)) >= 0) { p++; m = ramene(p); s = arrondir(m, 6); }
  return { mantisse: (a.n < 0n ? '-' : '') + s, exposant: p, exact: compare(depuisDecimal(s), m) === 0 };
}
const formaterSimple = (decimal: string, langue: Langue) => new Intl.NumberFormat(langue, { maximumFractionDigits: 100 }).format(decimal as unknown as number);
function texteScientifique(a: Rationnel, langue: Langue): { texte: string; exact: boolean } {
  const s = scientifique(a);
  return { texte: `${formaterSimple(s.mantisse, langue)} × 10^${s.exposant}`, exact: s.exact };
}
/** Un décimal (« 1234.5 ») mis en forme dans la langue (« 1 234,5 ») ; très grand : en écriture scientifique. */
export function formater(decimal: string, langue: Langue): string {
  const ent = decimal.replace(/^-/, '').split('.')[0];
  if (ent.length > CHIFFRES_ECRITS_MAX) return texteScientifique(depuisDecimal(decimal), langue).texte;
  return formaterSimple(decimal, langue);
}
/** « = 0,3 », ou « ≈ 0,333333 » quand le texte du résultat est un arrondi (il commence par « ≈ »). */
export const egal = (texte: string) => (texte.startsWith('≈ ') ? '≈ ' + texte.slice(2) : '= ' + texte);
/**
 * Le résultat écrit pour la phrase : « 0,3 », ou « ≈ 0,333333 » quand c'est un arrondi. Très grand (plus de 40 chiffres)
 * ou très petit (arrondi à 0) : en notation scientifique, avec « ≈ » dès qu'elle arrondit (`arrondiScientifique` vrai).
 */
export function ecrireNombre(a: Rationnel, langue: Langue, decimales = 6): { texte: string; ecriture: Ecriture; arrondiScientifique?: boolean } {
  const e = ecrire(a, decimales);
  const ent = e.decimal.replace(/^-/, '').split('.')[0];
  if (a.n !== 0n && (ent.length > CHIFFRES_ECRITS_MAX || /^-?0(?:\.0*)?$/.test(e.decimal))) {
    const s = texteScientifique(a, langue);
    return { texte: (s.exact ? '' : '≈ ') + s.texte, ecriture: e, ...(s.exact ? {} : { arrondiScientifique: true }) };
  }
  return { texte: (e.exact ? '' : '≈ ') + formater(e.decimal, langue), ecriture: e };
}

// ---------------------------------------------------------------------------------------------------------------
// Les jetons d'une phrase

export interface Jeton {
  brut: string;
  /** Forme de comparaison (voir `norm`). */
  n: string;
  sorte: 'nombre' | 'mot' | 'signe';
  debut: number;
  fin: number;
}
/** Chiffres de toutes les écritures → chiffres latins ; « ٫ » (virgule arabe) et « ٬ » (séparateur arabe) gardés. */
export function chiffresLatins(s: string): string {
  return s.replace(/\p{Nd}/gu, (c) => {
    const cp = c.codePointAt(0)!;
    for (const z of [0x30, 0x660, 0x6f0, 0x966, 0x9e6, 0xff10]) if (cp >= z && cp <= z + 9) return String(cp - z);
    return c;
  }).replace(/٪/g, '%');
}
const RE_JETON = /(\d+(?:(?:[.,'’  ٬٫]| (?=\d{3}(?!\d)))\d+)*)|([\p{L}\p{M}]+(?:['’\-][\p{L}\p{M}]+)*)|(\S)/gu;
const ELISION = /^(l|d|j|qu|jusqu|lorsqu|puisqu|s|n|m|t|c)['’](.+)$/i;
const SANS_ELISION = new Set(["aujourd'hui"]);
/** Découpe une phrase en nombres, mots et signes (les élisions françaises « d'heures » sont séparées). */
export function jetons(phrase: string): Jeton[] {
  const s = chiffresLatins(phrase);
  const out: Jeton[] = [];
  for (const m of s.matchAll(RE_JETON)) {
    const debut = m.index ?? 0, brut = m[0];
    if (m[1]) { out.push({ brut, n: brut, sorte: 'nombre', debut, fin: debut + brut.length }); continue; }
    if (m[2]) {
      const e = ELISION.exec(brut);
      if (e && !SANS_ELISION.has(norm(brut))) {
        const k = e[1].length + 1;
        out.push({ brut: brut.slice(0, k), n: norm(brut.slice(0, k)), sorte: 'mot', debut, fin: debut + k });
        out.push({ brut: brut.slice(k), n: norm(brut.slice(k)), sorte: 'mot', debut: debut + k, fin: debut + brut.length });
      } else out.push({ brut, n: norm(brut), sorte: 'mot', debut, fin: debut + brut.length });
      continue;
    }
    out.push({ brut, n: brut, sorte: 'signe', debut, fin: debut + brut.length });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Les nombres en chiffres

/** Le séparateur décimal habituel de chaque langue (l'autre sert aux milliers). */
const DECIMALE: Record<Langue, ',' | '.'> = { fr: ',', de: ',', es: ',', en: '.', sw: '.', ar: '.' };
/** Chiffres au plus dans un nombre écrit. */
export const CHIFFRES_MAX = 40;

export interface NombreLu {
  valeur: Rationnel;
  /** Vrai quand « 1,250 » / « 1.250 » peut se lire en milliers ou en décimales : `autre` est l'autre lecture. */
  ambigu?: boolean;
  autre?: Rationnel;
}
/**
 * Lit un nombre écrit en chiffres (« 1 250,50 », « 1,250.50 », « 0,1 », « ٣٫٥ »). Le séparateur décimal se reconnaît à la
 * forme ; quand la forme ne tranche pas (un seul séparateur suivi de trois chiffres), c'est l'habitude de la langue, et
 * c'est dit (`ambigu`). Un groupement irrégulier (« 1,2,3 ») ou un nombre trop long : `undefined`.
 */
export function lireChiffres(brut: string, langue: Langue): NombreLu | undefined {
  if (!LANGUES_CALCUL.includes(langue)) return undefined;
  const s = chiffresLatins(brut).replace(/[  '’ ]/g, '_');
  const parts = s.split(/([._,٬٫])/);
  const groupes = parts.filter((_, i) => i % 2 === 0), seps = parts.filter((_, i) => i % 2 === 1);
  if (groupes.some((g) => !/^\d+$/.test(g))) return undefined;
  if (groupes.join('').length > CHIFFRES_MAX) return undefined;
  if (!seps.length) return { valeur: rat(BigInt(groupes[0])) };
  const fabriquer = (dec: number): Rationnel | undefined => {
    // dec : place du séparateur décimal dans `seps` (-1 : aucun). Avant lui, des groupes de trois chiffres.
    const avant = dec < 0 ? groupes : groupes.slice(0, dec + 1);
    if (avant.length > 1 && (avant[0].length > 3 || avant.slice(1).some((g) => g.length !== 3))) return undefined;
    const sepsAvant = dec < 0 ? seps : seps.slice(0, dec);
    if (new Set(sepsAvant).size > 1) return undefined;
    if (dec >= 0 && dec !== seps.length - 1) return undefined;
    return depuisDecimal(avant.join('') + (dec >= 0 ? '.' + groupes[dec + 1] : ''));
  };
  const arabe = seps.indexOf('٫');
  if (arabe >= 0) { const v = fabriquer(arabe); return v && { valeur: v }; }
  const ponct = seps.map((x, i) => [x, i] as const).filter(([x]) => x === '.' || x === ',');
  if (!ponct.length) { const v = fabriquer(-1); return v && { valeur: v }; }
  const sortes = new Set(ponct.map(([x]) => x));
  if (sortes.size === 2) { const v = fabriquer(ponct[ponct.length - 1][1]); return v && { valeur: v }; }
  if (ponct.length > 1) { const v = fabriquer(-1); return v && { valeur: v }; }
  const [c, i] = ponct[0];
  if (i !== seps.length - 1) { const v = fabriquer(-1); return v && { valeur: v }; }
  const groupesAilleurs = seps.length > 1; // déjà groupé par des espaces : la ponctuation est la décimale
  const douteux = !groupesAilleurs && groupes.length === 2 && groupes[1].length === 3 && groupes[0].length <= 3 && groupes[0] !== '0';
  if (!douteux) { const v = fabriquer(i); return v && { valeur: v }; }
  const enDecimale = fabriquer(i), enMilliers = fabriquer(-1);
  if (!enDecimale || !enMilliers) return undefined;
  return c === DECIMALE[langue] ? { valeur: enDecimale, ambigu: true, autre: enMilliers } : { valeur: enMilliers, ambigu: true, autre: enDecimale };
}

// ---------------------------------------------------------------------------------------------------------------
// Les nombres en lettres

type Atome = { v: bigint; k: 'u' | 'c' | 'h' | 'm' | 'M' | 'j' | 'a' };
// u : de 0 à 99 ; c : « cent » (multiplie) ; h : une centaine écrite d'un mot (« doscientos ») ; m : mille, million…
// (multiplie) ; M : un nombre de milliers écrit d'un mot (« ألفان ») ; j : « et », « and », « y », « und », « na » ;
// a : l'article anglais « a » (« a hundred »).
const LETTRES: Record<Langue, Record<string, Atome>> = { fr: {}, en: {}, es: {}, de: {}, ar: {}, sw: {} };
function remplirLettres(): void {
  const mettre = (l: Langue, k: Atome['k'], liste: string) => {
    for (const x of liste.split(',')) { const [mot, v] = x.split('='); LETTRES[l][norm(mot.trim())] = { v: BigInt(v ?? 0), k }; }
  };
  mettre('fr', 'u', 'zéro=0,un=1,une=1,deux=2,trois=3,quatre=4,cinq=5,six=6,sept=7,huit=8,neuf=9,dix=10,onze=11,douze=12,treize=13,quatorze=14,quinze=15,seize=16,vingt=20,vingts=20,trente=30,quarante=40,cinquante=50,soixante=60,septante=70,octante=80,huitante=80,nonante=90');
  mettre('fr', 'c', 'cent=100,cents=100');
  mettre('fr', 'm', 'mille=1000,million=1000000,millions=1000000,milliard=1000000000,milliards=1000000000');
  mettre('fr', 'j', 'et');
  mettre('en', 'u', 'zero=0,one=1,two=2,three=3,four=4,five=5,six=6,seven=7,eight=8,nine=9,ten=10,eleven=11,twelve=12,thirteen=13,fourteen=14,fifteen=15,sixteen=16,seventeen=17,eighteen=18,nineteen=19,twenty=20,thirty=30,forty=40,fifty=50,sixty=60,seventy=70,eighty=80,ninety=90');
  mettre('en', 'c', 'hundred=100');
  mettre('en', 'm', 'thousand=1000,million=1000000,billion=1000000000');
  mettre('en', 'j', 'and');
  mettre('en', 'a', 'a=1');
  mettre('es', 'u', 'cero=0,uno=1,una=1,un=1,dos=2,tres=3,cuatro=4,cinco=5,seis=6,siete=7,ocho=8,nueve=9,diez=10,once=11,doce=12,trece=13,catorce=14,quince=15,dieciséis=16,diecisiete=17,dieciocho=18,diecinueve=19,veinte=20,veintiuno=21,veintiún=21,veintiuna=21,veintidós=22,veintitrés=23,veinticuatro=24,veinticinco=25,veintiséis=26,veintisiete=27,veintiocho=28,veintinueve=29,treinta=30,cuarenta=40,cincuenta=50,sesenta=60,setenta=70,ochenta=80,noventa=90');
  mettre('es', 'h', 'cien=100,ciento=100,doscientos=200,doscientas=200,trescientos=300,trescientas=300,cuatrocientos=400,cuatrocientas=400,quinientos=500,quinientas=500,seiscientos=600,seiscientas=600,setecientos=700,setecientas=700,ochocientos=800,ochocientas=800,novecientos=900,novecientas=900');
  mettre('es', 'm', 'mil=1000,millón=1000000,millones=1000000');
  mettre('es', 'j', 'y');
  mettre('de', 'u', 'null=0,ein=1,eins=1,eine=1,einen=1,zwei=2,drei=3,vier=4,fünf=5,sechs=6,sieben=7,acht=8,neun=9,zehn=10,elf=11,zwölf=12,dreizehn=13,vierzehn=14,fünfzehn=15,sechzehn=16,siebzehn=17,achtzehn=18,neunzehn=19,zwanzig=20,dreißig=30,vierzig=40,fünfzig=50,sechzig=60,siebzig=70,achtzig=80,neunzig=90');
  mettre('de', 'c', 'hundert=100');
  mettre('de', 'm', 'tausend=1000,million=1000000,millionen=1000000,milliarde=1000000000,milliarden=1000000000');
  mettre('de', 'j', 'und');
  mettre('ar', 'u', 'صفر=0,واحد=1,واحدة=1,أحد=1,إحدى=1,اثنان=2,اثنين=2,اثنتان=2,اثنتين=2,اثنا=2,اثنتا=2,ثلاثة=3,ثلاث=3,أربعة=4,أربع=4,خمسة=5,خمس=5,ستة=6,ست=6,سبعة=7,سبع=7,ثمانية=8,ثماني=8,ثمان=8,تسعة=9,تسع=9,عشرة=10,عشر=10,عشرون=20,عشرين=20,ثلاثون=30,ثلاثين=30,أربعون=40,أربعين=40,خمسون=50,خمسين=50,ستون=60,ستين=60,سبعون=70,سبعين=70,ثمانون=80,ثمانين=80,تسعون=90,تسعين=90');
  mettre('ar', 'c', 'مائة=100,مئة=100');
  mettre('ar', 'h', 'مائتان=200,مئتان=200,مائتين=200,مئتين=200,ثلاثمائة=300,ثلاثمئة=300,أربعمائة=400,أربعمئة=400,خمسمائة=500,خمسمئة=500,ستمائة=600,ستمئة=600,سبعمائة=700,سبعمئة=700,ثمانمائة=800,ثمانمئة=800,تسعمائة=900,تسعمئة=900');
  mettre('ar', 'm', 'ألف=1000,آلاف=1000,مليون=1000000,ملايين=1000000,مليار=1000000000');
  mettre('ar', 'M', 'ألفان=2000,ألفين=2000');
  mettre('sw', 'u', 'sifuri=0,moja=1,mbili=2,tatu=3,nne=4,tano=5,sita=6,saba=7,nane=8,tisa=9,kumi=10,ishirini=20,thelathini=30,arobaini=40,hamsini=50,sitini=60,sabini=70,themanini=80,tisini=90');
  mettre('sw', 'm', 'mia=100,elfu=1000,laki=100000,milioni=1000000');
  mettre('sw', 'j', 'na');
}
remplirLettres();

/** Les mots-nombres d'un jeton : « vingt-trois » → [vingt, trois] ; « einundzwanzig » → [ein, und, zwanzig] ; « وعشرون » → [و…]. */
function atomesDuJeton(n: string, l: Langue): Atome[] | undefined {
  const T = LETTRES[l];
  if (l === 'de') {
    // Les nombres allemands s'écrivent d'un seul mot : découpe gloutonne par les morceaux connus (mot borné).
    if (n.length > 80) return undefined;
    const out: Atome[] = [];
    let i = 0;
    const cles = Object.keys(T).sort((a, b) => b.length - a.length);
    while (i < n.length) {
      const c = cles.find((k) => n.startsWith(k, i));
      if (!c) return undefined;
      out.push(T[c]); i += c.length;
    }
    return out.length ? out : undefined;
  }
  const out: Atome[] = [];
  for (const morceau of n.split('-')) {
    if (!morceau) return undefined;
    let a = T[morceau];
    if (!a && l === 'ar' && morceau.startsWith('و') && T[morceau.slice(1)]) { out.push({ v: 0n, k: 'j' }); a = T[morceau.slice(1)]; }
    if (!a) return undefined;
    out.push(a);
  }
  return out;
}

/** Calcule une suite d'atomes ; `undefined` si la suite n'est pas un nombre bien formé. */
function valeurAtomes(atomes: Atome[], l: Langue): bigint | undefined {
  if (l === 'sw') return valeurSwahili(atomes);
  // dernierM : le dernier multiplicateur (mille, million…) ; il ne se répète pas (« mille mille ») et un plus grand ne
  // vient après lui que pour un composé (« mille millions »).
  let total = 0n, cur = 0n, vu = false, dernierU: bigint | undefined, joint = false, dernierM: bigint | undefined;
  for (let i = 0; i < atomes.length; i++) {
    const a = atomes[i];
    if (a.k === 'j') { if (!vu) return undefined; joint = true; continue; }
    if (a.k === 'a') { if (!['c', 'm'].includes(atomes[i + 1]?.k ?? '')) return undefined; cur += 1n; vu = true; dernierU = undefined; continue; }
    if (a.k === 'u') {
      if (dernierU !== undefined) {
        const okDizaine = dernierU >= 10n && dernierU % 10n === 0n && a.v < dernierU; // vingt-trois, soixante-dix
        const okUnitesDizaines = (l === 'de' || l === 'ar') && dernierU < 10n && joint && a.v >= 20n && a.v % 10n === 0n; // fünfundzwanzig
        const okArabeOnze = l === 'ar' && dernierU < 10n && a.v === 10n; // ثلاثة عشر
        const okQuatreVingts = l === 'fr' && dernierU === 4n && a.v === 20n;
        if (okQuatreVingts) { cur += 76n; dernierU = 80n; vu = true; joint = false; continue; }
        if (!okDizaine && !okUnitesDizaines && !okArabeOnze) return undefined;
      }
      cur += a.v; dernierU = a.v; vu = true; joint = false; continue;
    }
    // Une seule centaine par groupe : « cent cent », « trois cent cent » ne sont pas des nombres.
    if (a.k === 'c') { if (cur % 1000n >= 100n) return undefined; cur = (cur || 1n) * 100n; dernierU = undefined; vu = true; joint = false; continue; }
    if (a.k === 'h') { if (cur % 1000n >= 100n) return undefined; cur += a.v; dernierU = undefined; vu = true; joint = false; continue; }
    if (a.k === 'M') { if (dernierM !== undefined && dernierM <= 1000n) return undefined; total += a.v; dernierM = 1000n; dernierU = undefined; vu = true; joint = false; continue; }
    // a.k === 'm'
    if (dernierM === undefined) total += (cur || 1n) * a.v;
    else if (a.v === dernierM) return undefined;
    else if (a.v > dernierM) { if (total >= a.v) return undefined; total = (total + cur) * a.v; }
    else total += (cur || 1n) * a.v;
    dernierM = a.v; cur = 0n; dernierU = undefined; vu = true; joint = false;
  }
  if (!vu || joint) return undefined;
  return total + cur;
}
/** Le swahili place le multiplicateur avant : « mia tatu » (300), « elfu mbili » (2 000), « ishirini na tano » (25). */
function valeurSwahili(atomes: Atome[]): bigint | undefined {
  let i = 0;
  const sousCent = (): bigint | undefined => {
    // dizaine [na unité] | unité | kumi na unité
    const a = atomes[i];
    if (!a || a.k !== 'u') return undefined;
    i++;
    let v = a.v;
    if (a.v >= 10n && atomes[i]?.k === 'j' && atomes[i + 1]?.k === 'u' && atomes[i + 1].v < 10n) { v += atomes[i + 1].v; i += 2; }
    return v;
  };
  const sousMille = (): bigint | undefined => {
    let v = 0n, vu = false;
    if (atomes[i]?.k === 'm' && atomes[i].v === 100n) {
      i++;
      const u = atomes[i]?.k === 'u' && atomes[i].v < 10n ? atomes[i++].v : 1n;
      v += u * 100n; vu = true;
      if (atomes[i]?.k === 'j') i++;
    }
    const r = atomes[i]?.k === 'u' ? sousCent() : undefined;
    if (r !== undefined) { v += r; vu = true; }
    return vu ? v : undefined;
  };
  // Les multiplicateurs vont en décroissant (« milioni … laki … elfu … »), sans se répéter ; le groupe sans
  // multiplicateur vient une seule fois, à la fin (« mia mia » n'est pas un nombre).
  let total = 0n, vu = false, echelle: bigint | undefined, groupeSimple = false;
  while (i < atomes.length) {
    const a = atomes[i];
    if (a.k === 'j') { if (!vu) return undefined; i++; continue; }
    if (a.k === 'm' && a.v >= 1000n) {
      if (groupeSimple || (echelle !== undefined && a.v >= echelle)) return undefined;
      echelle = a.v; i++;
      const s = sousMille() ?? 1n;
      total += s * a.v; vu = true; continue;
    }
    if (groupeSimple) return undefined;
    const s = sousMille();
    if (s === undefined) return undefined;
    total += s; vu = true; groupeSimple = true;
  }
  return vu ? total : undefined;
}

/**
 * Lit un nombre en lettres à partir du jeton `i` : le plus long nombre bien formé. Rend sa valeur et l'indice du
 * jeton qui suit. Un mot seul qui sert aussi d'article (« un », « a ») compte comme 1, sauf l'anglais « a » seul.
 */
export function lireNombreMots(js: Jeton[], i: number, langue: Langue): { valeur: bigint; fin: number } | undefined {
  if (!LANGUES_CALCUL.includes(langue)) return undefined;
  const atomes: Atome[] = [], bornes: number[] = [];
  for (let k = i; k < js.length && k < i + 24; k++) {
    if (js[k].sorte !== 'mot') break;
    const a = atomesDuJeton(js[k].n, langue);
    if (!a) break;
    atomes.push(...a); bornes.push(atomes.length);
  }
  for (let b = bornes.length; b > 0; b--) {
    const v = valeurAtomes(atomes.slice(0, bornes[b - 1]), langue);
    if (v !== undefined) return { valeur: v, fin: i + b };
  }
  return undefined;
}
/** Un texte entier qui est un nombre en lettres (« quatre-vingt-dix-sept » → 97) ; sinon `undefined`. */
export function lireNombre(texte: string, langue: Langue): bigint | undefined {
  if (typeof texte !== 'string' || texte.length > 300 || !LANGUES_CALCUL.includes(langue)) return undefined;
  const js = jetons(texte);
  if (!js.length) return undefined;
  const r = lireNombreMots(js, 0, langue);
  return r && r.fin === js.length ? r.valeur : undefined;
}

// ---------------------------------------------------------------------------------------------------------------
// La forme des réponses (la même que temps-fuseaux.ts : direct, points, pasSur, conseils, calcul, donnees)

export interface ConseilCalcul { id: 'convertir-unite' | 'ajouter-calendrier' | 'creer-rappel'; libelle: string }
export interface ReponseCalculee<D = Record<string, unknown>> {
  /** La langue des textes rendus (fr, en, es, de, ar, sw). */
  langue: Langue;
  /** Ce qui a été reconnu (« conversion », « pourcentage », « expression », « date »…). */
  sorte: string;
  /** Faux quand la question est reconnue mais ne se calcule pas (division par zéro, monnaie sans taux…) : `direct` le dit. */
  reconnu: boolean;
  /** La phrase de réponse directe. */
  direct: string;
  /** Les points courts. */
  points: string[];
  /** Ce qui n'est pas sûr (ambiguïtés, hypothèses du calcul). */
  pasSur: string[];
  /** La suite proposée (boutons à venir). */
  conseils: ConseilCalcul[];
  /** Comment c'est calculé (pastille « calcul »). */
  calcul?: { par: 'regles'; texte: string };
  /** Les nombres du calcul. */
  donnees?: D;
}

export const remplir = (modele: string, v: Record<string, string>) => modele.replace(/\{(\w+)\}/g, (_, k: string) => v[k] ?? '');

// ---------------------------------------------------------------------------------------------------------------
// Les unités

type Dim = 'longueur' | 'masse' | 'volume' | 'temperature' | 'vitesse' | 'surface' | 'donnees' | 'duree';
interface Unite {
  id: string;
  dim: Dim;
  /** Valeur de base = valeur × f + b (base : m, kg, L, K, m/s, m², octet, s). */
  f: Rationnel;
  b?: Rationnel;
  /** Symboles, casse exacte, sans espaces (« km/h », « °C »). */
  sym: string[];
  /** Noms par langue (forme de comparaison, plusieurs mots permis). */
  noms: Partial<Record<Langue, string[]>>;
  /** Unité à symbole court (« m », « in ») : reconnue seulement après un nombre ou un mot de conversion. */
  court?: boolean;
  /** L'unité d'`Intl.NumberFormat` quand elle existe (sinon le premier symbole). */
  intl?: string;
  /** Une ambiguïté à dire quand cette unité est employée. */
  ambigu?: 'gallon' | 'ton' | 'binaire' | 'usuk';
}
const dec = (s: string) => depuisDecimal(s);
const r10 = (k: number) => rat(10n ** BigInt(Math.max(0, k)), 10n ** BigInt(Math.max(0, -k)));
const GAL_US = dec('3.785411784'), GAL_UK = dec('4.54609');
const UNITES: Unite[] = [
  // Longueur (m)
  { id: 'mm', dim: 'longueur', f: r10(-3), sym: ['mm'], intl: 'millimeter', noms: { fr: ['millimetre', 'millimetres'], en: ['millimeter', 'millimeters', 'millimetre', 'millimetres'], es: ['milimetro', 'milimetros'], de: ['millimeter'], ar: ['مليمتر', 'ملم'], sw: ['milimita'] } },
  { id: 'cm', dim: 'longueur', f: r10(-2), sym: ['cm'], intl: 'centimeter', noms: { fr: ['centimetre', 'centimetres'], en: ['centimeter', 'centimeters', 'centimetre', 'centimetres'], es: ['centimetro', 'centimetros'], de: ['zentimeter'], ar: ['سنتيمتر', 'سنتيمترات', 'سم'], sw: ['sentimita'] } },
  { id: 'm', dim: 'longueur', f: rat(1n), sym: ['m'], court: true, intl: 'meter', noms: { fr: ['metre', 'metres'], en: ['meter', 'meters', 'metre', 'metres'], es: ['metro', 'metros'], de: ['meter'], ar: ['متر', 'امتار'], sw: ['mita'] } },
  { id: 'km', dim: 'longueur', f: r10(3), sym: ['km'], intl: 'kilometer', noms: { fr: ['kilometre', 'kilometres'], en: ['kilometer', 'kilometers', 'kilometre', 'kilometres'], es: ['kilometro', 'kilometros'], de: ['kilometer'], ar: ['كيلومتر', 'كيلومترات', 'كم'], sw: ['kilomita'] } },
  { id: 'in', dim: 'longueur', f: dec('0.0254'), sym: ['in', '″', '"'], court: true, intl: 'inch', noms: { fr: ['pouce', 'pouces'], en: ['inch', 'inches'], es: ['pulgada', 'pulgadas'], de: ['zoll'], ar: ['بوصة', 'انش', 'بوصات'], sw: ['inchi'] } },
  { id: 'ft', dim: 'longueur', f: dec('0.3048'), sym: ['ft', '′'], intl: 'foot', noms: { fr: ['pied', 'pieds'], en: ['foot', 'feet'], es: ['pie', 'pies'], de: ['fuss'], ar: ['قدم', 'اقدام'], sw: ['futi'] } },
  { id: 'yd', dim: 'longueur', f: dec('0.9144'), sym: ['yd'], intl: 'yard', noms: { fr: ['yard', 'yards'], en: ['yard', 'yards'], es: ['yarda', 'yardas'], de: ['yard'], ar: ['ياردة', 'ياردات'], sw: ['yadi'] } },
  { id: 'mi', dim: 'longueur', f: dec('1609.344'), sym: ['mi'], court: true, intl: 'mile', noms: { fr: ['mile', 'miles'], en: ['mile', 'miles'], es: ['milla', 'millas'], de: ['meile', 'meilen'], ar: ['ميل', 'اميال'], sw: ['maili'] } },
  { id: 'nmi', dim: 'longueur', f: rat(1852n), sym: ['nmi', 'NM'], noms: { fr: ['mille marin', 'milles marins', 'mille nautique', 'milles nautiques'], en: ['nautical mile', 'nautical miles'], es: ['milla nautica', 'millas nauticas'], de: ['seemeile', 'seemeilen'], ar: ['ميل بحري', 'اميال بحرية'] } },
  // Masse (kg)
  { id: 'mg', dim: 'masse', f: r10(-6), sym: ['mg'], noms: { fr: ['milligramme', 'milligrammes'], en: ['milligram', 'milligrams', 'milligramme', 'milligrammes'], es: ['miligramo', 'miligramos'], de: ['milligramm'], ar: ['مليغرام', 'مليجرام'], sw: ['miligramu'] } },
  { id: 'g', dim: 'masse', f: r10(-3), sym: ['g'], court: true, intl: 'gram', noms: { fr: ['gramme', 'grammes'], en: ['gram', 'grams', 'gramme', 'grammes'], es: ['gramo', 'gramos'], de: ['gramm'], ar: ['غرام', 'جرام', 'غرامات', 'جرامات'], sw: ['gramu'] } },
  { id: 'kg', dim: 'masse', f: rat(1n), sym: ['kg'], intl: 'kilogram', noms: { fr: ['kilogramme', 'kilogrammes', 'kilo', 'kilos'], en: ['kilogram', 'kilograms', 'kilogramme', 'kilogrammes', 'kilo', 'kilos'], es: ['kilogramo', 'kilogramos', 'kilo', 'kilos'], de: ['kilogramm', 'kilo'], ar: ['كيلوغرام', 'كيلوجرام', 'كيلو'], sw: ['kilogramu', 'kilo'] } },
  { id: 't', dim: 'masse', f: r10(3), sym: ['t'], court: true, noms: { fr: ['tonne', 'tonnes'], en: ['tonne', 'tonnes', 'metric ton', 'metric tons'], es: ['tonelada', 'toneladas'], de: ['tonne', 'tonnen'], ar: ['طن', 'اطنان'], sw: ['tani'] } },
  { id: 'ton', dim: 'masse', f: dec('907.18474'), sym: [], ambigu: 'ton', noms: { en: ['ton', 'tons', 'short ton', 'short tons'] } },
  { id: 'oz', dim: 'masse', f: dec('0.028349523125'), sym: ['oz'], intl: 'ounce', noms: { fr: ['once', 'onces'], en: ['ounce', 'ounces'], es: ['onza', 'onzas'], de: ['unze', 'unzen'], ar: ['اونصة', 'اوقية'], sw: ['aunsi'] } },
  { id: 'lb', dim: 'masse', f: dec('0.45359237'), sym: ['lb', 'lbs'], intl: 'pound', noms: { fr: ['livre', 'livres'], en: ['pound', 'pounds'], es: ['libra', 'libras'], de: ['pfund'], ar: ['رطل', 'ارطال'], sw: ['ratili', 'paundi'] } },
  { id: 'st', dim: 'masse', f: dec('6.35029318'), sym: ['st'], intl: 'stone', noms: { en: ['stone', 'stones'] } },
  // Volume (L)
  { id: 'ml', dim: 'volume', f: r10(-3), sym: ['ml', 'mL'], intl: 'milliliter', noms: { fr: ['millilitre', 'millilitres'], en: ['milliliter', 'milliliters', 'millilitre', 'millilitres'], es: ['mililitro', 'mililitros'], de: ['milliliter'], ar: ['مليلتر', 'مل'], sw: ['mililita'] } },
  { id: 'cl', dim: 'volume', f: r10(-2), sym: ['cl', 'cL'], noms: { fr: ['centilitre', 'centilitres'], en: ['centiliter', 'centiliters', 'centilitre', 'centilitres'], es: ['centilitro', 'centilitros'], de: ['zentiliter'] } },
  { id: 'dl', dim: 'volume', f: r10(-1), sym: ['dl', 'dL'], noms: { fr: ['decilitre', 'decilitres'], en: ['deciliter', 'deciliters', 'decilitre', 'decilitres'], es: ['decilitro', 'decilitros'], de: ['deziliter'] } },
  { id: 'l', dim: 'volume', f: rat(1n), sym: ['l', 'L'], court: true, intl: 'liter', noms: { fr: ['litre', 'litres'], en: ['liter', 'liters', 'litre', 'litres'], es: ['litro', 'litros'], de: ['liter'], ar: ['لتر', 'لترات'], sw: ['lita'] } },
  { id: 'm3', dim: 'volume', f: r10(3), sym: ['m³'], noms: { fr: ['metre cube', 'metres cubes'], en: ['cubic meter', 'cubic meters', 'cubic metre', 'cubic metres'], es: ['metro cubico', 'metros cubicos'], de: ['kubikmeter'], ar: ['متر مكعب', 'امتار مكعبة'] } },
  { id: 'cm3', dim: 'volume', f: r10(-3), sym: ['cm³', 'cc'], noms: { fr: ['centimetre cube', 'centimetres cubes'], en: ['cubic centimeter', 'cubic centimeters', 'cubic centimetre', 'cubic centimetres'], es: ['centimetro cubico', 'centimetros cubicos'], de: ['kubikzentimeter'] } },
  { id: 'gal', dim: 'volume', f: GAL_US, sym: ['gal'], intl: 'gallon', ambigu: 'gallon', noms: { fr: ['gallon', 'gallons'], en: ['gallon', 'gallons', 'us gallon', 'us gallons'], es: ['galon', 'galones'], de: ['gallone', 'gallonen'], ar: ['غالون', 'جالون'], sw: ['galoni'] } },
  { id: 'galuk', dim: 'volume', f: GAL_UK, sym: [], noms: { fr: ['gallon imperial', 'gallons imperiaux'], en: ['imperial gallon', 'imperial gallons', 'uk gallon', 'uk gallons'], es: ['galon imperial', 'galones imperiales'], de: ['imperiale gallone'] } },
  { id: 'floz', dim: 'volume', f: rat(GAL_US.n, GAL_US.d * 128n), sym: ['floz', 'fl.oz'], intl: 'fluid-ounce', ambigu: 'usuk', noms: { fr: ['once liquide', 'onces liquides'], en: ['fluid ounce', 'fluid ounces'], es: ['onza liquida', 'onzas liquidas'], de: ['flussigunze'] } },
  { id: 'pt', dim: 'volume', f: rat(GAL_US.n, GAL_US.d * 8n), sym: ['pt'], ambigu: 'usuk', noms: { fr: ['pinte', 'pintes'], en: ['pint', 'pints'], es: ['pinta', 'pintas'], de: ['pint'] } },
  // Température (K) : K = x·f + b
  { id: 'C', dim: 'temperature', f: rat(1n), b: dec('273.15'), sym: ['°C', '℃'], intl: 'celsius', noms: { fr: ['celsius', 'degre celsius', 'degres celsius'], en: ['celsius', 'degree celsius', 'degrees celsius'], es: ['celsius', 'grado celsius', 'grados celsius'], de: ['celsius', 'grad celsius'], ar: ['سيلسيوس', 'درجة مئوية', 'درجات مئوية', 'مئوية'], sw: ['selsiasi'] } },
  { id: 'F', dim: 'temperature', f: rat(5n, 9n), b: rat(45967n * 5n, 900n), sym: ['°F', '℉'], intl: 'fahrenheit', noms: { fr: ['fahrenheit', 'degre fahrenheit', 'degres fahrenheit'], en: ['fahrenheit', 'degree fahrenheit', 'degrees fahrenheit'], es: ['fahrenheit', 'grado fahrenheit', 'grados fahrenheit'], de: ['fahrenheit', 'grad fahrenheit'], ar: ['فهرنهايت'], sw: ['farenhaiti'] } },
  { id: 'K', dim: 'temperature', f: rat(1n), b: rat(0n), sym: ['K'], court: true, noms: { fr: ['kelvin', 'kelvins'], en: ['kelvin', 'kelvins'], es: ['kelvin'], de: ['kelvin'], ar: ['كلفن'], sw: ['kelvini'] } },
  // Vitesse (m/s)
  { id: 'km/h', dim: 'vitesse', f: rat(5n, 18n), sym: ['km/h', 'kmh', 'km/hr', 'kph'], intl: 'kilometer-per-hour', noms: { fr: ['kilometre par heure', 'kilometres par heure', 'kilometre-heure', 'kilometres-heure'], en: ['kilometer per hour', 'kilometers per hour', 'kilometre per hour', 'kilometres per hour'], es: ['kilometro por hora', 'kilometros por hora'], de: ['kilometer pro stunde', 'stundenkilometer'], ar: ['كيلومتر في الساعة', 'كم/س'], sw: ['kilomita kwa saa'] } },
  { id: 'm/s', dim: 'vitesse', f: rat(1n), sym: ['m/s'], intl: 'meter-per-second', noms: { fr: ['metre par seconde', 'metres par seconde'], en: ['meter per second', 'meters per second', 'metre per second', 'metres per second'], es: ['metro por segundo', 'metros por segundo'], de: ['meter pro sekunde'], ar: ['متر في الثانية'], sw: ['mita kwa sekunde'] } },
  { id: 'mph', dim: 'vitesse', f: dec('0.44704'), sym: ['mph'], intl: 'mile-per-hour', noms: { fr: ['mile par heure', 'miles par heure'], en: ['mile per hour', 'miles per hour'], es: ['milla por hora', 'millas por hora'], de: ['meile pro stunde', 'meilen pro stunde'], ar: ['ميل في الساعة'], sw: ['maili kwa saa'] } },
  { id: 'kn', dim: 'vitesse', f: rat(1852n, 3600n), sym: ['kn', 'kt'], noms: { fr: ['noeud', 'noeuds'], en: ['knot', 'knots'], es: ['nudo', 'nudos'], de: ['knoten'], ar: ['عقدة', 'عقد'] } },
  // Surface (m²)
  { id: 'cm2', dim: 'surface', f: r10(-4), sym: ['cm²'], noms: { fr: ['centimetre carre', 'centimetres carres'], en: ['square centimeter', 'square centimeters', 'square centimetre', 'square centimetres'], es: ['centimetro cuadrado', 'centimetros cuadrados'], de: ['quadratzentimeter'], ar: ['سنتيمتر مربع'] } },
  { id: 'm2', dim: 'surface', f: rat(1n), sym: ['m²'], noms: { fr: ['metre carre', 'metres carres'], en: ['square meter', 'square meters', 'square metre', 'square metres'], es: ['metro cuadrado', 'metros cuadrados'], de: ['quadratmeter'], ar: ['متر مربع', 'امتار مربعة'], sw: ['mita mraba', 'mita za mraba'] } },
  { id: 'km2', dim: 'surface', f: r10(6), sym: ['km²'], noms: { fr: ['kilometre carre', 'kilometres carres'], en: ['square kilometer', 'square kilometers', 'square kilometre', 'square kilometres'], es: ['kilometro cuadrado', 'kilometros cuadrados'], de: ['quadratkilometer'], ar: ['كيلومتر مربع'], sw: ['kilomita mraba', 'kilomita za mraba'] } },
  { id: 'ha', dim: 'surface', f: r10(4), sym: ['ha'], intl: 'hectare', noms: { fr: ['hectare', 'hectares'], en: ['hectare', 'hectares'], es: ['hectarea', 'hectareas'], de: ['hektar'], ar: ['هكتار', 'هكتارات'], sw: ['hekta'] } },
  { id: 'acre', dim: 'surface', f: dec('4046.8564224'), sym: ['ac'], intl: 'acre', noms: { fr: ['acre', 'acres'], en: ['acre', 'acres'], es: ['acre', 'acres'], de: ['acre'], sw: ['ekari'] } },
  { id: 'ft2', dim: 'surface', f: dec('0.09290304'), sym: ['ft²', 'sqft'], noms: { fr: ['pied carre', 'pieds carres'], en: ['square foot', 'square feet'], es: ['pie cuadrado', 'pies cuadrados'], de: ['quadratfuss'], ar: ['قدم مربع'] } },
  // Données (octet)
  { id: 'bit', dim: 'donnees', f: rat(1n, 8n), sym: ['bit', 'bits'], intl: 'bit', noms: { fr: ['bit', 'bits'], en: ['bit', 'bits'], es: ['bit', 'bits'], de: ['bit'], ar: ['بت'] } },
  { id: 'o', dim: 'donnees', f: rat(1n), sym: ['o', 'B'], court: true, intl: 'byte', noms: { fr: ['octet', 'octets'], en: ['byte', 'bytes'], es: ['byte', 'bytes', 'octeto', 'octetos'], de: ['byte'], ar: ['بايت'], sw: ['baiti'] } },
  { id: 'ko', dim: 'donnees', f: r10(3), sym: ['ko', 'Ko', 'kB', 'KB'], intl: 'kilobyte', ambigu: 'binaire', noms: { fr: ['kilooctet', 'kilooctets'], en: ['kilobyte', 'kilobytes'], es: ['kilobyte', 'kilobytes'], de: ['kilobyte'], ar: ['كيلوبايت'] } },
  { id: 'Mo', dim: 'donnees', f: r10(6), sym: ['Mo', 'MB'], intl: 'megabyte', ambigu: 'binaire', noms: { fr: ['megaoctet', 'megaoctets'], en: ['megabyte', 'megabytes'], es: ['megabyte', 'megabytes'], de: ['megabyte'], ar: ['ميغابايت', 'ميجابايت'], sw: ['megabaiti'] } },
  { id: 'Go', dim: 'donnees', f: r10(9), sym: ['Go', 'GB'], intl: 'gigabyte', ambigu: 'binaire', noms: { fr: ['gigaoctet', 'gigaoctets'], en: ['gigabyte', 'gigabytes'], es: ['gigabyte', 'gigabytes'], de: ['gigabyte'], ar: ['غيغابايت', 'جيجابايت'], sw: ['gigabaiti'] } },
  { id: 'To', dim: 'donnees', f: r10(12), sym: ['To', 'TB'], intl: 'terabyte', ambigu: 'binaire', noms: { fr: ['teraoctet', 'teraoctets'], en: ['terabyte', 'terabytes'], es: ['terabyte', 'terabytes'], de: ['terabyte'], ar: ['تيرابايت'] } },
  { id: 'Kio', dim: 'donnees', f: rat(1024n), sym: ['Kio', 'KiB'], noms: { fr: ['kibioctet', 'kibioctets'], en: ['kibibyte', 'kibibytes'] } },
  { id: 'Mio', dim: 'donnees', f: rat(1024n ** 2n), sym: ['Mio', 'MiB'], noms: { fr: ['mebioctet', 'mebioctets'], en: ['mebibyte', 'mebibytes'] } },
  { id: 'Gio', dim: 'donnees', f: rat(1024n ** 3n), sym: ['Gio', 'GiB'], noms: { fr: ['gibioctet', 'gibioctets'], en: ['gibibyte', 'gibibytes'] } },
  { id: 'Tio', dim: 'donnees', f: rat(1024n ** 4n), sym: ['Tio', 'TiB'], noms: { fr: ['tebioctet', 'tebioctets'], en: ['tebibyte', 'tebibytes'] } },
  { id: 'Mbit', dim: 'donnees', f: rat(10n ** 6n, 8n), sym: ['Mbit', 'Mb'], intl: 'megabit', noms: { fr: ['megabit', 'megabits'], en: ['megabit', 'megabits'], es: ['megabit', 'megabits'], de: ['megabit'] } },
  { id: 'Gbit', dim: 'donnees', f: rat(10n ** 9n, 8n), sym: ['Gbit', 'Gb'], intl: 'gigabit', noms: { fr: ['gigabit', 'gigabits'], en: ['gigabit', 'gigabits'], es: ['gigabit', 'gigabits'], de: ['gigabit'] } },
  // Durées (s) : jusqu'à la semaine (un mois ou une année n'ont pas de durée fixe)
  { id: 's', dim: 'duree', f: rat(1n), sym: ['s', 'sec'], court: true, intl: 'second', noms: { fr: ['seconde', 'secondes'], en: ['second', 'seconds'], es: ['segundo', 'segundos'], de: ['sekunde', 'sekunden'], ar: ['ثانية', 'ثوان', 'ثواني'], sw: ['sekunde'] } },
  { id: 'min', dim: 'duree', f: rat(60n), sym: ['min'], intl: 'minute', noms: { fr: ['minute', 'minutes'], en: ['minute', 'minutes'], es: ['minuto', 'minutos'], de: ['minute', 'minuten'], ar: ['دقيقة', 'دقائق'], sw: ['dakika'] } },
  { id: 'h', dim: 'duree', f: rat(3600n), sym: ['h'], court: true, intl: 'hour', noms: { fr: ['heure', 'heures'], en: ['hour', 'hours'], es: ['hora', 'horas'], de: ['stunde', 'stunden'], ar: ['ساعة', 'ساعات'], sw: ['saa'] } },
  { id: 'j', dim: 'duree', f: rat(86400n), sym: ['j', 'd'], court: true, intl: 'day', noms: { fr: ['jour', 'jours'], en: ['day', 'days'], es: ['dia', 'dias'], de: ['tag', 'tage', 'tagen'], ar: ['يوم', 'ايام'], sw: ['siku'] } },
  { id: 'sem', dim: 'duree', f: rat(604800n), sym: [], intl: 'week', noms: { fr: ['semaine', 'semaines'], en: ['week', 'weeks'], es: ['semana', 'semanas'], de: ['woche', 'wochen'], ar: ['اسبوع', 'اسابيع'], sw: ['wiki'] } },
];

/** Convertit une valeur d'une unité à une autre (identifiants de la table) ; `undefined` si l'une est inconnue ou si elles ne mesurent pas la même chose. */
export function convertir(valeur: Rationnel, de: string, vers: string): Rationnel | undefined {
  const a = UNITES.find((u) => u.id === de), b = UNITES.find((u) => u.id === vers);
  if (!a || !b || a.dim !== b.dim) return undefined;
  const base = plus(fois(valeur, a.f), a.b ?? rat(0n));
  return divise(moins(base, b.b ?? rat(0n)), b.f);
}
export const unitesConnues = (): string[] => UNITES.map((u) => u.id);

// Les monnaies : seulement des noms et des symboles ; AUCUN taux n'est écrit ici.
interface Monnaie { code: string; sym: string[]; noms: Partial<Record<Langue, string[]>>; ambigu?: boolean }
const MONNAIES: Monnaie[] = [
  { code: 'EUR', sym: ['€'], noms: { fr: ['euro', 'euros'], en: ['euro', 'euros'], es: ['euro', 'euros'], de: ['euro'], ar: ['يورو'], sw: ['yuro'] } },
  { code: 'USD', sym: ['$', 'US$'], ambigu: true, noms: { fr: ['dollar', 'dollars'], en: ['dollar', 'dollars'], es: ['dolar', 'dolares'], de: ['dollar'], ar: ['دولار', 'دولارات'], sw: ['dola'] } },
  { code: 'GBP', sym: ['£'], noms: { fr: ['livre sterling', 'livres sterling'], en: ['pound sterling', 'pounds sterling'], es: ['libra esterlina', 'libras esterlinas'], de: ['pfund sterling'], ar: ['جنيه استرليني'] } },
  { code: 'JPY', sym: ['¥'], ambigu: true, noms: { fr: ['yen', 'yens'], en: ['yen'], es: ['yen', 'yenes'], de: ['yen'], ar: ['ين'] } },
  { code: 'CHF', sym: [], noms: { fr: ['franc suisse', 'francs suisses'], en: ['swiss franc', 'swiss francs'], es: ['franco suizo', 'francos suizos'], de: ['franken', 'schweizer franken'] } },
];
let codesMonnaie: Set<string> | undefined;
const estCodeMonnaie = (s: string) => {
  if (!/^[A-Z]{3}$/.test(s)) return false;
  codesMonnaie ??= new Set(typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('currency') : MONNAIES.map((m) => m.code));
  return codesMonnaie.has(s);
};

// ---------------------------------------------------------------------------------------------------------------
// Les mots des questions, par langue (forme de comparaison)

const liste = (s: string) => s.split(',').map((x) => norm(x.trim())).filter(Boolean);
/** Mots de conversion (« en », « in », « a », « nach », « إلى », « kuwa »…). */
const CONVERSION: Record<Langue, string[]> = {
  fr: liste('en,vers,convertir,convertis,conversion,combien,dans,font,fait'),
  en: liste('in,to,into,convert,conversion,how,many,much,are'),
  es: liste('a,en,convertir,convierte,conversion,cuantos,cuantas,hay,son'),
  de: liste('in,nach,umrechnen,umrechnung,wie,viele,viel,sind'),
  ar: liste('إلى,الى,حول,تحويل,كم,في'),
  sw: liste('kuwa,kwa,badilisha,geuza,ngapi,katika,ni'),
};
/** « pour cent » et ses semblables (après le nombre ; « asilimia » vient avant). */
const POUR_CENT: Record<Langue, string[]> = {
  fr: liste('pour cent,pourcent,pourcents'), en: liste('percent,per cent'), es: liste('por ciento,porciento'),
  de: liste('prozent'), ar: liste('بالمئة,بالمائة,في المئة,في المائة'), sw: [],
};
const MOT_POURCENTAGE: Record<Langue, string[]> = {
  fr: liste('pourcentage,pourcentages,pour cent,%'), en: liste('percentage,percent,per cent'), es: liste('porcentaje,por ciento'),
  de: liste('prozent,prozentsatz'), ar: liste('نسبة,النسبة,بالمئة,بالمائة,مئوية'), sw: liste('asilimia'),
};
const HAUSSE: Record<Langue, string[]> = {
  fr: liste('augmenter,augmente,augmenté,augmentée,augmentation,hausse,majorer,majoré,majoration,ajouter,ajoute'),
  en: liste('increase,increased,increasing,raise,raised,add,markup,plus'),
  es: liste('aumentar,aumenta,aumento,aumentado,incrementar,incrementa,incremento,subir,sube,subida'),
  de: liste('erhöhen,erhöht,erhöhung,aufschlag,zuschlag,plus'),
  ar: liste('زيادة,زد,اضف,ارفع,رفع'), sw: liste('ongeza,ongezeko,ongezea,panda'),
};
const BAISSE: Record<Langue, string[]> = {
  fr: liste('baisser,baisse,baissé,diminuer,diminue,diminution,réduction,réduire,réduit,remise,rabais,ristourne,soldé,solde,retirer,enlever'),
  en: liste('decrease,decreased,reduce,reduced,reduction,discount,discounted,off,less,minus,cut'),
  es: liste('descuento,rebaja,rebajar,reducir,reduce,reducción,disminuir,disminuye,disminución,bajar,baja'),
  de: liste('rabatt,senken,senkung,reduzieren,reduziert,reduzierung,abzug,ermäßigung,nachlass,minus'),
  ar: liste('خصم,تخفيض,خفض,انقص,نقص,تنزيل'), sw: liste('punguza,punguzo,pungu,toa,shusha'),
};
/** « sur », « of », « de », « von », « من », « ya » : le mot avant le tout d'un pourcentage. */
const SUR: Record<Langue, string[]> = { fr: liste('sur,de,du'), en: liste('of,out of'), es: liste('de,sobre'), de: liste('von'), ar: liste('من'), sw: liste('ya,kati ya') };
const DEPUIS: Record<Langue, string[]> = { fr: liste('de,depuis'), en: liste('from'), es: liste('de,desde'), de: liste('von'), ar: liste('من'), sw: liste('kutoka') };
const JUSQUA: Record<Langue, string[]> = { fr: liste('à,a,vers'), en: liste('to'), es: liste('a,hasta'), de: liste('auf,zu,nach'), ar: liste('إلى,الى'), sw: liste('hadi,mpaka') };
const EVOLUTION: Record<Langue, string[]> = {
  fr: liste('évolution,variation,changement,progression'), en: liste('change,increase,decrease,growth'), es: liste('cambio,variación,variacion,evolución'),
  de: liste('veränderung,änderung,anstieg,rückgang'), ar: liste('تغير,التغير,تغيير'), sw: liste('mabadiliko,badiliko'),
};
const REGLE_DE_TROIS: Record<Langue, string[]> = { fr: liste('règle de trois'), en: liste('rule of three'), es: liste('regla de tres'), de: liste('dreisatz'), ar: [], sw: [] };

/** Les mots qui désignent une langue (pour la choisir quand elle n'est pas donnée). */
let MOTS_LANGUE: Record<Langue, Set<string>> | undefined;
function motsLangue(): Record<Langue, Set<string>> {
  if (MOTS_LANGUE) return MOTS_LANGUE;
  const m = {} as Record<Langue, Set<string>>;
  for (const l of LANGUES_CALCUL) {
    const s = new Set<string>([...CONVERSION[l], ...POUR_CENT[l], ...MOT_POURCENTAGE[l], ...HAUSSE[l], ...BAISSE[l], ...REGLE_DE_TROIS[l], ...EVOLUTION[l]]);
    for (const u of UNITES) for (const x of u.noms[l] ?? []) s.add(x);
    for (const mo of MONNAIES) for (const x of mo.noms[l] ?? []) s.add(x);
    for (const x of Object.keys(LETTRES[l])) if (x.length > 3) s.add(x);
    s.delete('%');
    m[l] = s;
  }
  return (MOTS_LANGUE = m);
}

// ---------------------------------------------------------------------------------------------------------------
// Les textes

interface Textes {
  conversion: string; incompatibles: string; sansTaux: string; taux: string; tauxDate: string; arrondiMonnaie: string;
  exacte: string; arrondi: string; separateur: string;
  gallon: string; ton: string; binaire: string; usuk: string; livre: string; dollar: string; yen: string;
  calcul: string; convertir: string; scientifique: string; zero: string;
}
const TEXTES: Record<Langue, Textes> = {
  fr: {
    conversion: '{a} {b}', incompatibles: 'On ne peut pas convertir des {a} en {b} : ils ne mesurent pas la même chose.',
    sansTaux: "Pour convertir des {a} en {b}, il me faut un taux de change daté et sourcé : je n'en invente pas.",
    taux: 'Taux employé : 1 {a} = {t} {b}.', tauxDate: 'Taux fourni du {date} ({source}) : le cours du moment peut être différent.',
    arrondiMonnaie: "Arrondi à l'unité la plus petite de la monnaie.",
    exacte: 'Valeur exacte : {f}.', arrondi: 'Arrondi à {k} décimales ; valeur exacte : {f}.',
    separateur: '« {brut} » est lu {lu} ; il peut aussi se lire {autre}.',
    gallon: 'Gallon américain pris (3,785411784 L) ; le gallon impérial vaut 4,54609 L.',
    ton: 'Tonne courte américaine prise (907,18474 kg) ; la tonne métrique vaut 1 000 kg, la tonne longue 1 016,0469088 kg.',
    binaire: "Préfixes décimaux pris (1 Go = 10^9 octets) ; certains logiciels affichent « Go » pour 2^30 octets (Gio).",
    usuk: 'Mesure américaine prise ; la mesure impériale est différente.',
    livre: 'Livre anglaise prise (453,59237 g) ; l’ancienne livre française valait 500 g.',
    dollar: 'Dollar américain pris (USD) ; d’autres pays ont un dollar.',
    yen: 'Yen japonais pris (JPY) ; le même signe sert au yuan chinois.',
    calcul: 'Calculé par Odin, en règles, avec des fractions exactes.', convertir: 'Convertir dans une autre unité',
    scientifique: 'Écrit en notation scientifique, arrondi à 7 chiffres significatifs ; valeur exacte : {f}.', zero: 'Division par zéro : pas de résultat.',
  },
  en: {
    conversion: '{a} {b}', incompatibles: 'I cannot convert {a} to {b}: they do not measure the same thing.',
    sansTaux: 'To convert {a} to {b} I need a dated exchange rate with its source: I do not make one up.',
    taux: 'Rate used: 1 {a} = {t} {b}.', tauxDate: 'Rate given for {date} ({source}): the current rate may differ.',
    arrondiMonnaie: 'Rounded to the smallest unit of the currency.',
    exacte: 'Exact value: {f}.', arrondi: 'Rounded to {k} decimal places; exact value: {f}.',
    separateur: '“{brut}” is read as {lu}; it could also mean {autre}.',
    gallon: 'US gallon used (3.785411784 L); the imperial gallon is 4.54609 L.',
    ton: 'US short ton used (907.18474 kg); a metric tonne is 1,000 kg, a long ton 1,016.0469088 kg.',
    binaire: 'Decimal prefixes used (1 GB = 10^9 bytes); some software shows “GB” for 2^30 bytes (GiB).',
    usuk: 'US measure used; the imperial measure differs.',
    livre: 'Avoirdupois pound used (453.59237 g).',
    dollar: 'US dollar used (USD); other countries have a dollar too.',
    yen: 'Japanese yen used (JPY); the same sign is used for the Chinese yuan.',
    calcul: 'Calculated by Odin, with rules and exact fractions.', convertir: 'Convert to another unit',
    scientifique: 'Written in scientific notation, rounded to 7 significant digits; exact value: {f}.', zero: 'Division by zero: no result.',
  },
  es: {
    conversion: '{a} {b}', incompatibles: 'No se puede convertir {a} en {b}: no miden lo mismo.',
    sansTaux: 'Para convertir {a} en {b} necesito un tipo de cambio con fecha y fuente: no lo invento.',
    taux: 'Tipo usado: 1 {a} = {t} {b}.', tauxDate: 'Tipo dado del {date} ({source}): el cambio actual puede ser distinto.',
    arrondiMonnaie: 'Redondeado a la unidad más pequeña de la moneda.',
    exacte: 'Valor exacto: {f}.', arrondi: 'Redondeado a {k} decimales; valor exacto: {f}.',
    separateur: '«{brut}» se lee {lu}; también puede leerse {autre}.',
    gallon: 'Galón estadounidense (3,785411784 L); el galón imperial vale 4,54609 L.',
    ton: 'Tonelada corta estadounidense (907,18474 kg); la tonelada métrica vale 1000 kg.',
    binaire: 'Prefijos decimales (1 GB = 10^9 bytes); algunos programas muestran «GB» para 2^30 bytes (GiB).',
    usuk: 'Medida estadounidense; la medida imperial es distinta.',
    livre: 'Libra inglesa (453,59237 g).',
    dollar: 'Dólar estadounidense (USD); otros países también tienen dólar.',
    yen: 'Yen japonés (JPY); el mismo signo sirve para el yuan chino.',
    calcul: 'Calculado por Odin, con reglas y fracciones exactas.', convertir: 'Convertir a otra unidad',
    scientifique: 'Escrito en notación científica, redondeado a 7 cifras significativas; valor exacto: {f}.', zero: 'División por cero: no hay resultado.',
  },
  de: {
    conversion: '{a} {b}', incompatibles: '{a} lässt sich nicht in {b} umrechnen: Sie messen nicht dasselbe.',
    sansTaux: 'Um {a} in {b} umzurechnen, brauche ich einen datierten Wechselkurs mit Quelle: Ich erfinde keinen.',
    taux: 'Verwendeter Kurs: 1 {a} = {t} {b}.', tauxDate: 'Kurs vom {date} ({source}): Der aktuelle Kurs kann abweichen.',
    arrondiMonnaie: 'Auf die kleinste Einheit der Währung gerundet.',
    exacte: 'Genauer Wert: {f}.', arrondi: 'Auf {k} Nachkommastellen gerundet; genauer Wert: {f}.',
    separateur: '„{brut}“ wird als {lu} gelesen; es kann auch {autre} bedeuten.',
    gallon: 'US-Gallone verwendet (3,785411784 L); die imperiale Gallone hat 4,54609 L.',
    ton: 'US-Short-Ton verwendet (907,18474 kg); eine metrische Tonne hat 1000 kg.',
    binaire: 'Dezimale Vorsätze (1 GB = 10^9 Byte); manche Programme zeigen „GB“ für 2^30 Byte (GiB).',
    usuk: 'US-Maß verwendet; das imperiale Maß ist anders.',
    livre: 'Englisches Pfund verwendet (453,59237 g); das deutsche Pfund sind 500 g.',
    dollar: 'US-Dollar verwendet (USD); auch andere Länder haben einen Dollar.',
    yen: 'Japanischer Yen verwendet (JPY); dasselbe Zeichen steht für den chinesischen Yuan.',
    calcul: 'Von Odin berechnet, mit Regeln und exakten Brüchen.', convertir: 'In eine andere Einheit umrechnen',
    scientifique: 'In wissenschaftlicher Schreibweise, auf 7 signifikante Stellen gerundet; genauer Wert: {f}.', zero: 'Division durch null: kein Ergebnis.',
  },
  ar: {
    conversion: '{a} {b}', incompatibles: 'لا يمكن تحويل {a} إلى {b}: لا يقيسان الشيء نفسه.',
    sansTaux: 'لتحويل {a} إلى {b} أحتاج إلى سعر صرف مؤرخ مع مصدره: لا أخترع سعرًا.',
    taux: 'السعر المستخدم: 1 {a} = {t} {b}.', tauxDate: 'السعر المعطى بتاريخ {date} ({source}): قد يختلف السعر الحالي.',
    arrondiMonnaie: 'مقرّب إلى أصغر وحدة في العملة.',
    exacte: 'القيمة الدقيقة: {f}.', arrondi: 'مقرّب إلى {k} منازل عشرية؛ القيمة الدقيقة: {f}.',
    separateur: 'قُرئ «{brut}» على أنه {lu}؛ وقد يعني أيضًا {autre}.',
    gallon: 'اعتمدت الغالون الأمريكي (3.785411784 لتر)؛ الغالون الإمبراطوري 4.54609 لتر.',
    ton: 'اعتمدت الطن القصير الأمريكي (907.18474 كغ)؛ الطن المتري 1000 كغ.',
    binaire: 'اعتمدت البادئات العشرية (1 غيغابايت = 10^9 بايت)؛ بعض البرامج تعرض 2^30 بايت.',
    usuk: 'اعتمدت المقياس الأمريكي؛ المقياس الإمبراطوري مختلف.',
    livre: 'اعتمدت الرطل الإنجليزي (453.59237 غرام).',
    dollar: 'اعتمدت الدولار الأمريكي (USD)؛ لدول أخرى دولار أيضًا.',
    yen: 'اعتمدت الين الياباني (JPY)؛ الرمز نفسه يُستخدم لليوان الصيني.',
    calcul: 'حسبه Odin بالقواعد وبكسور دقيقة.', convertir: 'التحويل إلى وحدة أخرى',
    scientifique: 'مكتوب بالصيغة العلمية، مقرّب إلى 7 أرقام معنوية؛ القيمة الدقيقة: {f}.', zero: 'قسمة على صفر: لا نتيجة.',
  },
  sw: {
    conversion: '{a} {b}', incompatibles: 'Siwezi kubadilisha {a} kuwa {b}: havipimi kitu kimoja.',
    sansTaux: 'Ili kubadilisha {a} kuwa {b} nahitaji kiwango cha ubadilishaji chenye tarehe na chanzo: sibuni kiwango.',
    taux: 'Kiwango kilichotumika: 1 {a} = {t} {b}.', tauxDate: 'Kiwango kilichotolewa cha {date} ({source}): kiwango cha sasa kinaweza kuwa tofauti.',
    arrondiMonnaie: 'Imekadiriwa hadi kipimo kidogo kabisa cha sarafu.',
    exacte: 'Thamani kamili: {f}.', arrondi: 'Imekadiriwa hadi desimali {k}; thamani kamili: {f}.',
    separateur: '“{brut}” imesomwa kama {lu}; inaweza pia kumaanisha {autre}.',
    gallon: 'Galoni ya Marekani imetumika (lita 3.785411784); galoni ya kifalme ni lita 4.54609.',
    ton: 'Tani fupi ya Marekani imetumika (kg 907.18474); tani ya kimetriki ni kg 1000.',
    binaire: 'Viambishi vya desimali vimetumika (GB 1 = baiti 10^9); baadhi ya programu huonyesha baiti 2^30.',
    usuk: 'Kipimo cha Marekani kimetumika; kipimo cha kifalme ni tofauti.',
    livre: 'Ratili ya Kiingereza imetumika (gramu 453.59237).',
    dollar: 'Dola ya Marekani imetumika (USD); nchi nyingine pia zina dola.',
    yen: 'Yeni ya Japani imetumika (JPY); alama hiyo hiyo hutumika kwa yuan ya China.',
    calcul: 'Imekokotolewa na Odin, kwa kanuni na sehemu kamili.', convertir: 'Badilisha kuwa kipimo kingine',
    scientifique: 'Imeandikwa kwa nukuu ya kisayansi, imekadiriwa hadi tarakimu 7 muhimu; thamani kamili: {f}.', zero: 'Kugawanya kwa sifuri: hakuna jibu.',
  },
};
export const textesCalcul = (l: Langue) => TEXTES[l].calcul;
/** « Écrit en notation scientifique, arrondi… ; valeur exacte : {f}. », dans la langue. */
export const texteArrondiScientifique = (l: Langue) => TEXTES[l].scientifique;

// ---------------------------------------------------------------------------------------------------------------
// Lire une phrase en éléments : nombres, pourcentages, unités, monnaies, mots, signes

type Element =
  | { k: 'nombre'; v: Rationnel; brut: string; lu?: NombreLu; i: number; j: number }
  | { k: 'pct'; v: Rationnel; brut: string; lu?: NombreLu; i: number; j: number }
  | { k: 'unite'; u: Unite; via: string; i: number; j: number }
  | { k: 'monnaie'; m: Monnaie; via: string; i: number; j: number }
  | { k: 'mot'; n: string; i: number; j: number }
  | { k: 'signe'; s: string; i: number; j: number };

/** Remplace « m2 », « km2 », « cm3 »… par « m² », « km² », « cm³ » avant de couper la phrase. */
const exposants = (s: string) => s.replace(/(?<![\p{L}\d])(mm|cm|dm|m|km|ft|in)([23])(?![\p{L}\d])/gu, (_, u: string, e: string) => u + (e === '2' ? '²' : '³'));

function chercherUnite(js: Jeton[], i: number, l: Langue): { u?: Unite; m?: Monnaie; long: number; via: string } | undefined {
  // Symboles (casse exacte, jusqu'à 4 jetons collés) puis noms (jusqu'à 4 mots), le plus long d'abord.
  for (let long = Math.min(4, js.length - i); long >= 1; long--) {
    const morceaux = js.slice(i, i + long);
    const colle = morceaux.every((x, k) => k === 0 || x.debut === morceaux[k - 1].fin);
    const brut = morceaux.map((x) => x.brut).join('');
    const mots = morceaux.map((x) => x.n).join(' ');
    if (colle) {
      const u = UNITES.find((x) => x.sym.includes(brut));
      if (u) return { u, long, via: brut };
      const mo = MONNAIES.find((x) => x.sym.includes(brut));
      if (mo) return { m: mo, long, via: brut };
    }
    if (morceaux.every((x) => x.sorte === 'mot')) {
      const formes = [mots, ...(long === 1 ? sansPrefixesAr(mots) : [])];
      const pourLangue = (noms: Partial<Record<Langue, string[]>>) => formes.some((f) => (noms[l] ?? []).includes(f));
      const mo = MONNAIES.find((x) => pourLangue(x.noms));
      if (mo) return { m: mo, long, via: mots };
      const u = UNITES.find((x) => pourLangue(x.noms));
      if (u) return { u, long, via: mots };
      if (long === 1 && estCodeMonnaie(js[i].brut)) return { m: MONNAIES.find((x) => x.code === js[i].brut) ?? { code: js[i].brut, sym: [], noms: {} }, long, via: js[i].brut };
    }
  }
  return undefined;
}

/** Les articles qui s'écrivent comme « un » (forme de comparaison). */
const ARTICLES: Record<Langue, string[]> = { fr: liste('un,une'), en: [], es: liste('un,una'), de: liste('ein,eine,einen'), ar: [], sw: [] };

function elements(phrase: string, l: Langue): Element[] {
  const js = jetons(exposants(phrase));
  const out: Element[] = [];
  const conv = new Set(CONVERSION[l]);
  const pc = POUR_CENT[l].map((x) => x.split(' '));
  for (let i = 0; i < js.length;) {
    const j = js[i], prec = out[out.length - 1];
    // Un nombre en chiffres (avec son signe moins collé en tête de phrase ou après un mot).
    if (j.sorte === 'nombre') {
      const lu = lireChiffres(j.brut, l);
      if (!lu) { out.push({ k: 'mot', n: j.n, i, j: i + 1 }); i++; continue; }
      let v = lu.valeur;
      const signe = prec?.k === 'signe' && (prec.s === '-' || prec.s === '−') && js[prec.i].fin === j.debut && (out.length === 1 || out[out.length - 2].k === 'mot');
      if (signe) { out.pop(); v = oppose(v); }
      out.push({ k: 'nombre', v, brut: j.brut, lu, i: signe ? i - 1 : i, j: i + 1 });
      i++; continue;
    }
    // « % » ou « pour cent » après un nombre ; « asilimia » avant.
    const dernier = out[out.length - 1];
    if (dernier?.k === 'nombre' && (j.brut === '%' || pc.some((p) => p.every((w, k) => js[i + k]?.n === w)))) {
      const long = j.brut === '%' ? 1 : pc.find((p) => p.every((w, k) => js[i + k]?.n === w))!.length;
      out[out.length - 1] = { k: 'pct', v: dernier.v, brut: dernier.brut, lu: dernier.lu, i: dernier.i, j: i + long };
      i += long; continue;
    }
    // Unités et monnaies.
    // Les expressions figées (« règle de trois ») : un seul mot, sans lire « trois » comme un nombre.
    const fige = REGLE_DE_TROIS[l].map((x) => x.split(' ')).find((p) => p.every((w, k) => js[i + k]?.n === w));
    if (fige) { out.push({ k: 'mot', n: fige.join(' '), i, j: i + fige.length }); i += fige.length; continue; }
    const t = chercherUnite(js, i, l);
    if (t && (t.long > 1 || !t.u?.court || prec?.k === 'nombre' || (prec?.k === 'mot' && conv.has(prec.n)))) {
      if (t.u) out.push({ k: 'unite', u: t.u, via: t.via, i, j: i + t.long });
      else out.push({ k: 'monnaie', m: t.m!, via: t.via, i, j: i + t.long });
      i += t.long; continue;
    }
    if (j.sorte === 'mot') {
      const nm = lireNombreMots(js, i, l);
      // Un article seul (« une remise », « un rabais ») n'est un nombre que devant une unité (« un kilomètre »).
      const article = nm && nm.fin === i + 1 && ARTICLES[l].includes(j.n) && !chercherUnite(js, nm.fin, l);
      if (nm && !article) { out.push({ k: 'nombre', v: rat(nm.valeur), brut: js.slice(i, nm.fin).map((x) => x.brut).join(' '), i, j: nm.fin }); i = nm.fin; continue; }
      out.push({ k: 'mot', n: j.n, i, j: i + 1 }); i++; continue;
    }
    out.push({ k: 'signe', s: j.brut, i, j: i + 1 }); i++;
  }
  // « asilimia 17 » : le pourcentage vient avant le nombre en swahili.
  for (let k = 0; k + 1 < out.length; k++) {
    const a = out[k], b = out[k + 1];
    if (a.k === 'mot' && a.n === 'asilimia' && b.k === 'nombre') out.splice(k, 2, { k: 'pct', v: b.v, brut: b.brut, lu: b.lu, i: a.i, j: b.j });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Les réponses

export interface TauxChange {
  /** Code ISO 4217 de la monnaie de départ et d'arrivée. */
  de: string;
  vers: string;
  /** 1 `de` = `valeur` `vers`, en écriture décimale avec un point (« 1.08 »). */
  valeur: string;
  /** La date du taux et sa source : elles sont redites dans la réponse. */
  date: string;
  source: string;
}
export interface OptionsNombres {
  /** La langue de la réponse (« fr », ou un code ISO 639-3 comme « swh »). Absente : celle des mots de la phrase. */
  langue?: string;
  /** Les taux de change que l'appelant fournit (datés, sourcés). Sans eux, aucune monnaie n'est convertie. */
  taux?: TauxChange[];
}
export interface DonneesNombres {
  /** L'écriture décimale du résultat (« . »), exacte ou arrondie. */
  resultat: string;
  /** La fraction exacte du résultat. */
  exact: string;
  arrondi: boolean;
  [cle: string]: unknown;
}

/** Longueur maximale d'une phrase lue ici. */
export const LONGUEUR_MAX = 500;

/** Une quantité écrite dans la langue (« 3 km », « 1,864114 mi », « 37,8 °C »). */
function quantite(v: Rationnel, u: Unite, l: Langue): { texte: string; e: Ecriture } {
  const e = ecrire(v);
  const nombre = formater(e.decimal, l);
  let t: string | undefined;
  if (u.intl) { try { t = new Intl.NumberFormat(l, { style: 'unit', unit: u.intl, unitDisplay: 'short', maximumFractionDigits: 100 }).format(e.decimal as unknown as number); } catch { t = undefined; } }
  return { texte: (e.exact ? '' : '≈ ') + (t ?? `${nombre} ${u.sym[0] ?? u.id}`), e };
}
const nomUnite = (u: Unite, l: Langue) => (u.noms[l]?.[1] ?? u.noms[l]?.[0] ?? u.sym[0] ?? u.id);

function pasSurNombres(els: Element[], l: Langue): string[] {
  const T = TEXTES[l], out: string[] = [];
  for (const e of els) {
    if ((e.k === 'nombre' || e.k === 'pct') && e.lu?.ambigu && e.lu.autre) {
      out.push(remplir(T.separateur, { brut: e.brut, lu: formater(ecrire(e.lu.valeur).decimal, l), autre: formater(ecrire(e.lu.autre).decimal, l) }));
    }
  }
  return out;
}
function ambiguUnite(u: Unite, via: string, l: Langue): string | undefined {
  const T = TEXTES[l];
  if (u.id === 'lb' && (via === 'livre' || via === 'livres')) return T.livre;
  if (u.ambigu === 'gallon') return T.gallon;
  if (u.ambigu === 'ton') return T.ton;
  if (u.ambigu === 'binaire') return T.binaire;
  if (u.ambigu === 'usuk') return T.usuk;
  return undefined;
}
function reponse(l: Langue, sorte: string, direct: string, v: Rationnel, extra: { points?: string[]; pasSur?: string[]; conseils?: ConseilCalcul[]; donnees?: Record<string, unknown>; e?: Ecriture; arrondiScientifique?: boolean }): ReponseCalculee<DonneesNombres> {
  const T = TEXTES[l];
  const e = extra.e ?? ecrire(v);
  const f = versFraction(v);
  const points = [...(extra.points ?? []), extra.arrondiScientifique ? remplir(T.scientifique, { f }) : e.exact ? remplir(T.exacte, { f }) : remplir(T.arrondi, { k: String(e.decimales), f })];
  return {
    langue: l, sorte, reconnu: true, direct, points, pasSur: extra.pasSur ?? [], conseils: extra.conseils ?? [],
    calcul: { par: 'regles', texte: T.calcul },
    donnees: { ...(extra.donnees ?? {}), resultat: e.decimal, exact: versFraction(v), arrondi: !e.exact },
  };
}
const nonReconnu = (l: Langue, sorte: string, direct: string, pasSur: string[] = []): ReponseCalculee<DonneesNombres> =>
  ({ langue: l, sorte, reconnu: false, direct, points: [], pasSur, conseils: [], calcul: { par: 'regles', texte: TEXTES[l].calcul } });

/** La règle de trois : a → b, c → ? (= b × c ÷ a) ; `undefined` si a est nul. */
export function regleDeTrois(a: Rationnel, b: Rationnel, c: Rationnel): Rationnel | undefined {
  return divise(fois(b, c), a);
}

/**
 * La réponse à une question de nombres : conversion d'unités, pourcentage (hausse, remise, part d'un tout, évolution),
 * règle de trois, monnaie (seulement avec un taux fourni). Rend `undefined` quand la phrase n'est pas une de ces
 * questions, ou quand sa langue n'est pas couverte.
 */
export function repondreNombres(phrase: string, o: OptionsNombres = {}): ReponseCalculee<DonneesNombres> | undefined {
  if (typeof phrase !== 'string' || !phrase.trim() || phrase.length > LONGUEUR_MAX) return undefined;
  const l = choisirLangue(jetons(phrase), o?.langue, motsLangue());
  if (!l) return undefined;
  const els = elements(phrase, l);
  const T = TEXTES[l];
  const mots = new Set(els.filter((e) => e.k === 'mot').map((e) => (e as { n: string }).n));
  const texteMots = ' ' + els.filter((e) => e.k === 'mot').map((e) => (e as { n: string }).n).join(' ') + ' ';
  const contient = (liste: string[]) => liste.some((x) => mots.has(x) || (x.includes(' ') && texteMots.includes(` ${x} `)));
  const pasSurN = pasSurNombres(els, l);
  const nombres = els.filter((e) => e.k === 'nombre') as Extract<Element, { k: 'nombre' }>[];
  const pcts = els.filter((e) => e.k === 'pct') as Extract<Element, { k: 'pct' }>[];
  const unites = els.filter((e) => e.k === 'unite') as Extract<Element, { k: 'unite' }>[];
  const monnaies = els.filter((e) => e.k === 'monnaie') as Extract<Element, { k: 'monnaie' }>[];
  const avant = (e: Element) => els[els.indexOf(e) - 1];
  const apres = (e: Element) => els[els.indexOf(e) + 1];
  const conseilUnite: ConseilCalcul = { id: 'convertir-unite', libelle: T.convertir };

  // 1. Monnaies : un montant, une monnaie d'arrivée.
  if (monnaies.length === 2 && nombres.length === 1 && !pcts.length && contient(CONVERSION[l])) {
    const n = nombres[0];
    const prem = monnaies.find((m) => apres(n) === m || avant(n) === m);
    const autre = monnaies.find((m) => m !== prem);
    if (prem && autre && prem.m.code !== autre.m.code) {
      const pasSur = [...pasSurN];
      for (const m of [prem, autre]) if (m.m.ambigu) pasSur.push(m.m.code === 'JPY' ? T.yen : T.dollar);
      const t = (o.taux ?? []).find((x) => (x.de === prem.m.code && x.vers === autre.m.code) || (x.de === autre.m.code && x.vers === prem.m.code));
      let taux: Rationnel | undefined;
      try { taux = t && typeof t.valeur === 'string' && t.valeur.length <= CHIFFRES_MAX && /^\d+(?:\.\d+)?$/.test(t.valeur) ? depuisDecimal(t.valeur) : undefined; } catch { taux = undefined; }
      if (!t || !taux || taux.n === 0n) return nonReconnu(l, 'monnaie', remplir(T.sansTaux, { a: prem.m.code, b: autre.m.code }), pasSur);
      const r = t.de === prem.m.code ? fois(n.v, taux) : divise(n.v, taux)!;
      const chiffres = new Intl.NumberFormat('en', { style: 'currency', currency: autre.m.code }).resolvedOptions().maximumFractionDigits ?? 2;
      const arr = depuisDecimal(arrondir(r, chiffres));
      const fmt = (v: Rationnel, code: string) => new Intl.NumberFormat(l, { style: 'currency', currency: code, maximumFractionDigits: 20 }).format(ecrire(v, 20).decimal as unknown as number);
      const exactR = versFraction(arr) === versFraction(r);
      const e: Ecriture = exactR ? { decimal: ecrire(arr).decimal, exact: true } : { decimal: ecrire(arr).decimal, exact: false, decimales: chiffres };
      pasSur.push(remplir(T.tauxDate, { date: t.date, source: t.source }));
      return reponse(l, 'monnaie', `${fmt(n.v, prem.m.code)} ${exactR ? '=' : '≈'} ${fmt(arr, autre.m.code)}`, r, {
        e, pasSur, points: [remplir(T.taux, { a: t.de, t: formater(t.valeur, l), b: t.vers }), ...(exactR ? [] : [T.arrondiMonnaie])],
        donnees: { montant: ecrire(n.v).decimal, de: prem.m.code, vers: autre.m.code, taux: t.valeur, dateTaux: t.date, sourceTaux: t.source },
      });
    }
  }

  // 2. Conversion d'unités : une quantité (nombre + unité, ou unité + nombre en swahili), une unité d'arrivée.
  if (unites.length === 2 && nombres.length === 1 && !pcts.length && !monnaies.length) {
    const n = nombres[0];
    const source = unites.find((u) => avant(u) === n) ?? unites.find((u) => apres(u) === n);
    const cible = unites.find((u) => u !== source);
    if (source && cible && contient(CONVERSION[l])) {
      if (source.u.dim !== cible.u.dim) return nonReconnu(l, 'conversion', remplir(T.incompatibles, { a: nomUnite(source.u, l), b: nomUnite(cible.u, l) }));
      const r = convertir(n.v, source.u.id, cible.u.id)!;
      const a = quantite(n.v, source.u, l), b = quantite(r, cible.u, l);
      const pasSur = [...pasSurN];
      for (const u of [source, cible]) { const x = ambiguUnite(u.u, u.via, l); if (x && !pasSur.includes(x)) pasSur.push(x); }
      return reponse(l, 'conversion', remplir(T.conversion, { a: a.texte.replace(/^≈ /, ''), b: egal(b.texte) }), r, {
        e: b.e, pasSur, conseils: [conseilUnite], donnees: { valeur: ecrire(n.v).decimal, de: source.u.id, vers: cible.u.id, dimension: source.u.dim },
      });
    }
  }
  if (unites.length || monnaies.length) return undefined;

  // 3. Règle de trois : « a → b, c → ? », « a : b = c : x », ou le mot (« règle de trois », « Dreisatz ») et trois nombres.
  const signes = els.filter((e) => e.k === 'signe').map((e) => (e as { s: string }).s).join('');
  const fleches = (signes.match(/→|->/g) ?? []).length;
  const proportion = /^[:/]=[:/]$/.test(signes.replace(/[?,.]/g, '')) && (mots.has('x') || signes.includes('?'));
  if (nombres.length === 3 && !pcts.length && (fleches === 2 || proportion || contient(REGLE_DE_TROIS[l]))) {
    const [a, b, c] = nombres.map((x) => x.v);
    const r = regleDeTrois(a, b, c);
    if (!r) return nonReconnu(l, 'regle-de-trois', T.zero);
    const w = ecrireNombre(r, l);
    const f = (x: Rationnel) => formater(ecrire(x).decimal, l);
    return reponse(l, 'regle-de-trois', `${f(b)} × ${f(c)} ÷ ${f(a)} ${egal(w.texte)}`, r, {
      e: w.ecriture, arrondiScientifique: w.arrondiScientifique, pasSur: pasSurN, points: [`${f(a)} → ${f(b)}`, `${f(c)} → ${w.texte}`],
      donnees: { a: ecrire(a).decimal, b: ecrire(b).decimal, c: ecrire(c).decimal },
    });
  }

  // 4. Pourcentages.
  const cent = rat(100n);
  const pctTexte = (ratio: Rationnel) => {
    const e = ecrire(fois(ratio, cent));
    return (e.exact ? '' : '≈ ') + new Intl.NumberFormat(l, { style: 'percent', maximumFractionDigits: 100 }).format(ecrire(ratio, (e.decimales ?? 0) + 2).decimal as unknown as number);
  };
  // 4a. Hausse ou baisse d'un pourcentage : un pourcentage, un nombre, un mot de hausse ou de baisse.
  if (pcts.length === 1 && nombres.length === 1) {
    const hausse = contient(HAUSSE[l]), baisse = contient(BAISSE[l]);
    if (hausse !== baisse) {
      const p = pcts[0].v, x = nombres[0].v;
      const r = fois(x, plus(rat(1n), (baisse ? oppose : (y: Rationnel) => y)(divise(p, cent)!)));
      const w = ecrireNombre(r, l);
      const f = (y: Rationnel) => formater(ecrire(y).decimal, l);
      return reponse(l, 'pourcentage', `${f(x)} ${baisse ? '−' : '+'} ${pctTexte(divise(p, cent)!)} ${egal(w.texte)}`, r, {
        e: w.ecriture, arrondiScientifique: w.arrondiScientifique, pasSur: pasSurN, donnees: { valeur: ecrire(x).decimal, pourcentage: ecrire(p).decimal, sens: baisse ? 'baisse' : 'hausse' },
      });
    }
  }
  if (!pcts.length && nombres.length === 2 && (contient(MOT_POURCENTAGE[l]) || signes.includes('%'))) {
    const [n1, n2] = nombres;
    const motAvant = (e: Element) => { const a = avant(e); return a?.k === 'mot' ? a.n : ''; };
    const deuxMotsAvant = (e: Element) => { const k = els.indexOf(e); const a = els[k - 2], b = els[k - 1]; return a?.k === 'mot' && b?.k === 'mot' ? `${a.n} ${b.n}` : ''; };
    const est = (e: Element, liste: string[]) => liste.includes(motAvant(e)) || liste.includes(deuxMotsAvant(e));
    // 4b. Évolution : « de 80 à 100 », « from 80 to 100 », « von 80 auf 100 »…
    if (est(n1, DEPUIS[l]) && est(n2, JUSQUA[l]) && (contient(EVOLUTION[l]) || contient(MOT_POURCENTAGE[l]))) {
      if (n1.v.n === 0n) return nonReconnu(l, 'pourcentage', T.zero);
      const ratio = divise(moins(n2.v, n1.v), n1.v)!;
      const r = fois(ratio, cent);
      const f = (y: Rationnel) => formater(ecrire(y).decimal, l);
      const signe = compare(ratio, rat(0n)) > 0 ? '+' : '';
      return reponse(l, 'pourcentage', `(${f(n2.v)} − ${f(n1.v)}) ÷ ${f(n1.v)} ${egal(pctTexte(ratio)).replace(/^([=≈]) /, `$1 ${signe}`)}`, r, {
        pasSur: pasSurN, donnees: { depuis: ecrire(n1.v).decimal, jusqua: ecrire(n2.v).decimal, sorte: 'evolution' },
      });
    }
    // 4c. Part d'un tout : le nombre qui suit « sur », « of », « von », « من »… est le tout.
    const tout = est(n2, SUR[l]) ? n2 : est(n1, SUR[l]) ? n1 : undefined;
    if (tout) {
      const part = tout === n1 ? n2 : n1;
      if (tout.v.n === 0n) return nonReconnu(l, 'pourcentage', T.zero);
      const ratio = divise(part.v, tout.v)!;
      const r = fois(ratio, cent);
      const f = (y: Rationnel) => formater(ecrire(y).decimal, l);
      return reponse(l, 'pourcentage', `${f(part.v)} ÷ ${f(tout.v)} ${egal(pctTexte(ratio))}`, r, {
        pasSur: pasSurN, donnees: { part: ecrire(part.v).decimal, tout: ecrire(tout.v).decimal, sorte: 'part' },
      });
    }
  }
  return undefined;
}
