// Médias reçus : les hésitations d'une parole transcrite (bégaiements, répétitions, mots coupés, mots de remplissage,
// syllabes allongées, reprises). Elles sont REPÉRÉES, jamais réécrites : l'original reste intact, chaque retrait garde
// sa position exacte (unités UTF-16 de l'original, début inclus, fin exclue) et sa certitude. Seuls les retraits sûrs
// sont enlevés du texte nettoyé ; les « possibles » restent (une répétition double peut être voulue : « nous nous »).
//
// Aucune langue n'est supposée : les mots viennent d'Intl.Segmenter (juste en japonais, chinois, thaï…), les
// comparaisons se font après NFKC et minuscules de la langue, diacritiques gardés. La table des mots de remplissage
// n'est utilisée QUE si la langue est donnée, et ses mots « pleins » (qui ont aussi un vrai sens) ne sont jamais sûrs.
// Sans temps par mot, les règles qui demandent une pause ne s'appliquent pas. Une absence d'hésitation ne prouve rien :
// les moteurs de transcription les effacent souvent.

import type { Mot } from './contrat.ts';
import { estLettre, graphemes } from './ecritures.ts';

export interface Retrait { debut: number; fin: number; type: 'repetition' | 'fragment' | 'remplissage' | 'allongement' | 'reprise'; certitude: 'sure' | 'possible' }
export interface Hesitations {
  original: string; nettoye: string; retraits: Retrait[]; compte: { sures: number; possibles: number };
  /**
   * Après une réparation (« non, attends », « no wait », « ich meine »…) : la DERNIÈRE proposition, celle qui dit ce que
   * la personne veut vraiment (répétitions immédiates retirées), et le marqueur entendu. L'original n'est pas touché.
   */
  intention?: { texte: string; marqueur: string };
}

/**
 * Marqueurs de réparation par langue (suites de mots, comparées après NFKC et minuscules) : ce qui précède est abandonné,
 * ce qui suit est l'intention. Utilisés SEULEMENT si la langue est donnée. Table extensible.
 */
export const REPARATIONS: Record<string, string[][]> = {
  fr: [['non', 'attends'], ['non', 'attendez'], ['non', 'pardon'], ['pardon', 'je', 'veux', 'dire'], ['enfin', 'non'], ['je', 'veux', 'dire'], ['ou', 'plutôt'], ['non', 'plutôt']],
  en: [['no', 'wait'], ['wait', 'no'], ['sorry', 'i', 'mean'], ['no', 'sorry'], ['i', 'mean'], ['or', 'rather']],
  es: [['no', 'espera'], ['no', 'perdón'], ['quiero', 'decir'], ['o', 'mejor', 'dicho']],
  de: [['nein', 'warte'], ['nein', 'moment'], ['ich', 'meine'], ['oder', 'besser']],
  it: [['no', 'aspetta'], ['no', 'scusa'], ['voglio', 'dire'], ['anzi']],
  pt: [['não', 'espera'], ['não', 'desculpa'], ['quer', 'dizer'], ['ou', 'melhor']],
  nl: [['nee', 'wacht'], ['ik', 'bedoel'], ['of', 'liever']],
  ru: [['нет', 'подожди'], ['нет', 'стой'], ['то', 'есть'], ['вернее']],
  ar: [['لا', 'انتظر'], ['أقصد'], ['أعني']],
  tr: [['hayır', 'dur'], ['yani', 'hayır'], ['demek', 'istediğim']],
  pl: [['nie', 'czekaj'], ['to', 'znaczy']],
  ja: [['いや', '待って'], ['じゃなくて']],
  zh: [['不', '等等'], ['不对'], ['我是说']],
  ko: [['아니', '잠깐'], ['아니', '그게', '아니라']],
};

/** Mots de remplissage par langue (extensible). Une langue absente de la table : aucun remplissage n'est repéré. */
export const REMPLISSAGES: Record<string, string[]> = {
  fr: ['euh', 'heu', 'euuh', 'hum', 'hmm', 'bah', 'ben', 'beh'],
  en: ['uh', 'um', 'er', 'erm', 'uhm', 'hmm', 'mm', 'ah'],
  es: ['eh', 'em', 'emm', 'este', 'pues', 'mmm'],
  de: ['äh', 'ähm', 'öh', 'hm', 'hmm'],
  it: ['ehm', 'eh', 'mah', 'cioè'],
  pt: ['hã', 'ahn', 'hum', 'tipo', 'né'],
  ja: ['えーと', 'ええと', 'えっと', 'えー', 'あのー', 'あの', 'うーん'],
  zh: ['嗯', '呃', '那个', '这个', '就是'],
  ko: ['음', '어', '그', '저기', '뭐'],
  ar: ['يعني', 'اه', 'امم', 'إمم'],
  ru: ['ну', 'э', 'эм', 'ммм', 'вот'],
  hi: ['मतलब', 'अं', 'उम'],
  tr: ['şey', 'ıı', 'ee', 'hani', 'yani'],
  pl: ['yyy', 'eee', 'hmm', 'no'],
  nl: ['eh', 'uh', 'ehm', 'nou'],
};
/** Mots qui ont aussi un vrai sens : jamais retirés avec certitude. */
const MOTS_PLEINS = new Set(['este', 'tipo', 'يعني', '那个', '这个', '就是', 'ну', 'вот', 'ben', 'pues', 'né', 'cioè', 'şey', 'hani', 'yani', 'मतलब', 'あの', 'その', '그', '뭐', '저기', 'no', 'nou', 'mah']);

/** Séparateurs « légers » entre deux mots répétés (jamais le trait d'union : « orang-orang » est un mot redoublé). */
const LEGER = new Set([' ', '\t', '\n', ',', '،', '、', '，', '…', '.', ' ', '　']);
const TIRETS = new Set(['-', '‐', '‑']);
const PAUSE_S = 0.25;

interface Jeton { i: number; fin: number; n: string }

function normaliser(t: string, langue?: string): string {
  const x = t.normalize('NFKC');
  try { return langue ? x.toLocaleLowerCase(langue) : x.toLowerCase(); } catch { return x.toLowerCase(); }
}

/** Un jeton qui contient un chiffre (« 11 », « 2026 », « ٣ ») n'est jamais retiré : un numéro répété est voulu. */
function aChiffre(t: string): boolean {
  for (const ch of t) { const c = ch.codePointAt(0)!; if ((c >= 0x30 && c <= 0x39) || /\p{Nd}/u.test(ch)) return true; }
  return false;
}
const FIN_PHRASE = new Set(['.', '!', '?', '。', '！', '？', '؟', '।', '۔']);

/**
 * `langueSure` : la langue est reconnue avec certitude (≥ 0,8) ; alors un mot de remplissage de la table qui n'a pas
 * d'autre sens (euh, uh, um, äh, えーと…) est retiré avec certitude même sans temps par mot.
 */
export function reperer(texte: string, o: { langue?: string; langueSure?: boolean; mots?: Mot[]; bruits?: Array<{ debut: number; fin: number }>; sansIntention?: boolean } = {}): Hesitations {
  const original = texte;
  let seg: Intl.Segmenter;
  try { seg = new Intl.Segmenter(o.langue || undefined, { granularity: 'word' }); } catch { seg = new Intl.Segmenter(undefined, { granularity: 'word' }); }
  const toks: Jeton[] = [];
  for (const s of seg.segment(texte)) {
    if (!s.isWordLike) continue;
    toks.push({ i: s.index, fin: s.index + s.segment.length, n: normaliser(s.segment, o.langue) });
    if (toks.length > 200_000) break;
  }
  // Temps par mot : rattachés seulement si les mots horodatés correspondent un à un.
  const temps = o.mots && o.mots.length === toks.length ? o.mots : undefined;
  const pauseEntre = (a: number, b: number): boolean => {
    if (!temps) return false;
    const fa = temps[a]?.fin, db = temps[b]?.debut;
    if (!Number.isFinite(fa) || !Number.isFinite(db)) return false;
    if (db - fa >= PAUSE_S) return true;
    return (o.bruits ?? []).some((x) => x.debut < db && x.fin > fa);
  };
  const sep = (a: number, b: number) => texte.slice(toks[a].fin, toks[b].i);
  const leger = (s: string) => { if (!s.length) return false; for (const c of s) if (!LEGER.has(c)) return false; return true; };
  const candidats: Retrait[] = [];
  const finDe = (k: number) => (k + 1 < toks.length ? toks[k + 1].i : toks[k].fin);

  // 1. Répétitions : « je je je veux ».
  for (let k = 0; k < toks.length;) {
    if (aChiffre(toks[k].n)) { k++; continue; }   // « 06 11 11 11 11 » : un numéro, jamais une hésitation
    let j = k;
    while (j + 1 < toks.length && toks[j + 1].n === toks[k].n && leger(sep(j, j + 1))) j++;
    const L = j - k + 1;
    if (L >= 3) for (let x = k; x < j; x++) candidats.push({ debut: toks[x].i, fin: toks[x + 1].i, type: 'repetition', certitude: 'sure' });
    else if (L === 2) candidats.push({ debut: toks[k].i, fin: toks[k + 1].i, type: 'repetition', certitude: pauseEntre(k, k + 1) ? 'sure' : 'possible' });
    k = j + 1;
  }
  // 2. Mots coupés : « b-b-bonjour », « bon- bonjour », « bon… bonjour ».
  for (let k = 0; k + 1 < toks.length; k++) {
    // Chaîne de traits d'union sans espace.
    let m = k;
    while (m + 1 < toks.length && TIRETS.has(sep(m, m + 1))) m++;
    if (m > k) {
      const der = toks[m].n;
      // « b-b-bonjour » : sûr seulement si le fragment fait une ou deux lettres ET est répété ; « re-read »,
      // « co-construire », « b-bonjour » : possible (un préfixe à trait d'union est souvent un vrai mot composé).
      const fragments = toks.slice(k, m).map((x) => x.n);
      for (let x = k; x < m; x++) {
        const t = toks[x].n;
        if (aChiffre(t) || !(t.length < der.length && der.startsWith(t) && graphemes(t).length <= 3)) continue;
        const repete = fragments.filter((y) => y === t).length >= 2;
        const sure = repete && graphemes(t).length <= 2;
        candidats.push({ debut: toks[x].i, fin: toks[x + 1].i, type: 'fragment', certitude: sure ? 'sure' : 'possible' });
      }
      k = m;
      continue;
    }
    const s = sep(k, k + 1);
    const t = toks[k].n, suiv = toks[k + 1].n;
    const coupe = s.length >= 2 && (TIRETS.has(s[0]) || s[0] === '…') && leger(s.slice(1));
    if (coupe && !aChiffre(t) && t.length < suiv.length && suiv.startsWith(t)) candidats.push({ debut: toks[k].i, fin: toks[k + 1].i, type: 'fragment', certitude: 'sure' });
  }
  // 3. Syllabes allongées : 4 lettres identiques ou plus (« nooooon » ; « Schifffahrt » n'en a que 3).
  for (const t of toks) {
    const g = graphemes(texte.slice(t.i, t.fin));
    for (let a = 0; a < g.length;) {
      let b = a;
      const ga = normaliser(g[a].texte);
      while (b + 1 < g.length && normaliser(g[b + 1].texte) === ga) b++;
      if (b - a + 1 >= 4 && estLettre(g[a].texte)) candidats.push({ debut: t.i + g[a + 1].index, fin: t.i + g[b].index + g[b].texte.length, type: 'allongement', certitude: 'sure' });
      a = b + 1;
    }
  }
  // 4. Mots de remplissage (seulement si la langue est donnée).
  const base = o.langue ? normaliser(o.langue).split('-')[0] : undefined;
  const table = base ? new Set((REMPLISSAGES[base] ?? []).map((x) => normaliser(x, o.langue))) : undefined;
  if (table?.size) for (let k = 0; k < toks.length; k++) {
    if (!table.has(toks[k].n)) continue;
    const isole = (k === 0 || pauseEntre(k - 1, k)) && (k + 1 >= toks.length || pauseEntre(k, k + 1));
    // Sûr : isolé par des pauses (temps par mot), ou langue reconnue avec certitude ; jamais un mot qui a aussi un sens.
    const sure = !MOTS_PLEINS.has(toks[k].n) && ((!!temps && isole) || !!o.langueSure);
    const debut = k + 1 < toks.length || k === 0 ? toks[k].i : toks[k - 1].fin;
    candidats.push({ debut, fin: k + 1 < toks.length ? finDe(k) : toks[k].fin, type: 'remplissage', certitude: sure ? 'sure' : 'possible' });
  }
  // 5. Reprises : « je vais je veux » (un début abandonné puis repris).
  for (let k = 0; k + 3 < toks.length; k++) {
    const [a, b, c, d] = [toks[k].n, toks[k + 1].n, toks[k + 2].n, toks[k + 3].n];
    if (a === c && b !== d && a !== b && !aChiffre(a) && !aChiffre(b) && leger(sep(k + 1, k + 2))) candidats.push({ debut: toks[k].i, fin: toks[k + 2].i, type: 'reprise', certitude: 'possible' });
  }
  // 6. Réparations : « … non, attends. Mets du jazz dans le salon » (seulement si la langue est donnée). Le marqueur est
  // une reprise POSSIBLE (il peut être une vraie réponse) ; l'intention est la dernière proposition qui le suit.
  let intention: Hesitations['intention'];
  const marqueurs = base && !o.sansIntention ? (REPARATIONS[base] ?? []).map((m) => m.map((x) => normaliser(x, o.langue))) : [];
  let dernier: { k: number; L: number } | undefined;
  if (marqueurs.length) for (let k = 1; k < toks.length; k++) {
    for (const m of marqueurs) {
      const L = m.length;
      if (k + L >= toks.length) continue;
      let ok = true;
      for (let x = 0; x < L && ok; x++) ok = toks[k + x].n === m[x] && (x === 0 || leger(sep(k + x - 1, k + x)));
      if (!ok) continue;
      candidats.push({ debut: toks[k].i, fin: toks[k + L].i, type: 'reprise', certitude: 'possible' });
      dernier = { k, L };
      break;
    }
  }
  if (dernier) {
    // L'intention : de la fin du DERNIER marqueur jusqu'à la fin de la phrase qui suit.
    const debut = toks[dernier.k + dernier.L].i;
    let fin = texte.length;
    for (let q = debut; q < texte.length; q++) if (FIN_PHRASE.has(texte[q])) { fin = q + 1; break; }
    intention = { texte: sansRepetitions(texte.slice(debut, fin), o.langue), marqueur: texte.slice(toks[dernier.k].i, toks[dernier.k + dernier.L - 1].fin) };
  }
  // Pas de chevauchement : le plus long gagne (à longueur égale, le sûr).
  candidats.sort((x, y) => (y.fin - y.debut) - (x.fin - x.debut) || (x.certitude === 'sure' ? -1 : 1) - (y.certitude === 'sure' ? -1 : 1) || x.debut - y.debut);
  const retraits: Retrait[] = [];
  for (const c of candidats) if (!retraits.some((r) => c.debut < r.fin && r.debut < c.fin)) retraits.push(c);
  retraits.sort((x, y) => x.debut - y.debut);
  // Texte nettoyé : seuls les retraits sûrs sont enlevés.
  let net = '', p = 0;
  for (const r of retraits) { if (r.certitude !== 'sure') continue; net += texte.slice(p, r.debut); p = r.fin; }
  net += texte.slice(p);
  const sures = retraits.filter((r) => r.certitude === 'sure').length;
  const r: Hesitations = { original, nettoye: sures ? arranger(net) : original, retraits, compte: { sures, possibles: retraits.length - sures } };
  if (intention?.texte) r.intention = intention;
  return r;
}

/** L'intention débarrassée des répétitions immédiates (« Mets, mets du jazz » → « Mets du jazz ») et des remplissages. */
function sansRepetitions(t: string, langue?: string): string {
  const h = reperer(t, { langue, langueSure: true, sansIntention: true });
  let net = '', p = 0;
  for (const x of h.retraits) { if (x.type === 'reprise' || (x.type !== 'repetition' && x.certitude !== 'sure')) continue; net += t.slice(p, x.debut); p = x.fin; }
  net += t.slice(p);
  return arranger(net);
}

/** Espaces doubles fusionnés, « , , » → « , », espace devant une virgule retirée ; aucune espace ajoutée. */
function arranger(t: string): string {
  let r = '';
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (c === ' ' && (r.endsWith(' ') || r.length === 0)) continue;
    if ((c === ',' || c === '،' || c === '、') && (r.endsWith(', ') || r.endsWith(',') || r.endsWith('، ') || r.endsWith('、'))) continue;
    if ((c === ',' || c === '،') && r.endsWith(' ')) r = r.slice(0, -1);
    r += c;
  }
  return r.trim();
}
