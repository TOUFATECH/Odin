// Plume · l'orthographe : un lecteur de dictionnaire au format Hunspell (.aff + .dic), écrit pour Odin d'après la
// documentation du format (man 5 hunspell) — aucun code de Hunspell n'est repris. Le dictionnaire livré est le
// dictionnaire français « classique » de Grammalecte (Olivier R., licence MPL 2.0, fichiers inchangés et compressés
// dans `dico/`, licence à côté). Tout se passe sur la machine d'Odin : aucun mot ne part sur Internet.
//
// Ce que ce lecteur sait faire (ce dont le dictionnaire français a besoin) : drapeaux longs (FLAG long), suffixes et
// préfixes avec leurs conditions, préfixe + suffixe croisés (le drapeau du préfixe peut venir du suffixe), FULLSTRIP,
// FORBIDDENWORD, ICONV (apostrophe typographique), et pour les propositions : REP, MAP (accents), KEY (touches voisines),
// TRY (lettres à essayer). Le reste (mots composés…) n'est pas utilisé par ce dictionnaire.

import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';

interface Affixe { drapeau: string; retire: string; ajoute: string; cond: RegExp | null; suite: Set<string>; croise: boolean }
export interface Dico {
  mots: Map<string, Set<string>>;
  suffixes: Map<string, Affixe[]>; prefixes: Map<string, Affixe[]>; maxSuffixe: number; maxPrefixe: number;
  rep: Array<[RegExp, string]>; map: string[]; touches: string[]; essais: string[]; interdit: string; iconv: Array<[string, string]>;
}

const deux = (f: string) => { const out: string[] = []; for (let i = 0; i + 1 < f.length; i += 2) out.push(f.slice(i, i + 2)); return out; };
/** Une condition Hunspell (« [^aeiou]er », « . ») en expression régulière, ancrée à la fin (suffixe) ou au début (préfixe). */
function condition(c: string, fin: boolean): RegExp | null {
  if (c === '.' || c === '') return null;
  const src = c.replace(/[.*+?^${}()|\\]/g, (m) => (m === '.' ? '.' : `\\${m}`)).replace(/\\\^/g, '^');
  return new RegExp(fin ? `${src}$` : `^${src}`, 'u');
}

/** Lit un dictionnaire Hunspell (textes .aff et .dic). Pur. */
export function lireDico(aff: string, dic: string): Dico {
  const d: Dico = { mots: new Map(), suffixes: new Map(), prefixes: new Map(), maxSuffixe: 0, maxPrefixe: 0, rep: [], map: [], touches: [], essais: [], interdit: '', iconv: [] };
  const lignes = aff.split('\n');
  for (let i = 0; i < lignes.length; i++) {
    const p = lignes[i].trim().split(/\s+/); if (!p[0] || p[0].startsWith('#')) continue;
    if (p[0] === 'FORBIDDENWORD') d.interdit = p[1] ?? '';
    else if (p[0] === 'TRY') d.essais = [...new Set([...(p[1] ?? '')].map((c) => c.toLowerCase()))];
    else if (p[0] === 'KEY') d.touches = (p[1] ?? '').split('|');
    else if (p[0] === 'MAP' && p.length === 2 && !/^\d+$/.test(p[1])) d.map.push(p[1]);
    else if (p[0] === 'ICONV' && p.length === 3) d.iconv.push([p[1], p[2]]);
    else if (p[0] === 'REP' && p.length === 3) {
      const de = p[1].replace(/_/g, ' '), vers = p[2].replace(/_/g, ' ');
      const debut = de.startsWith('^'), fin = de.endsWith('$'), coeur = de.replace(/^\^/, '').replace(/\$$/, '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      d.rep.push([new RegExp(`${debut ? '^' : ''}${coeur}${fin ? '$' : ''}`, 'gu'), vers]);
    } else if ((p[0] === 'SFX' || p[0] === 'PFX') && p.length === 4 && /^[YN]$/.test(p[2])) {
      const n = Number(p[3]), suf = p[0] === 'SFX', croise = p[2] === 'Y';
      for (let k = 1; k <= n && i + k < lignes.length; k++) {
        const q = lignes[i + k].trim().split(/\s+/); if (q[0] !== p[0] || q[1] !== p[1]) continue;
        const [aj, suite = ''] = (q[3] ?? '0').split('/');
        const a: Affixe = { drapeau: p[1], retire: q[2] === '0' ? '' : q[2], ajoute: aj === '0' ? '' : aj, cond: condition(q[4] ?? '.', suf), suite: new Set(deux(suite)), croise };
        const table = suf ? d.suffixes : d.prefixes; const l = table.get(a.ajoute); if (l) l.push(a); else table.set(a.ajoute, [a]);
        if (suf) d.maxSuffixe = Math.max(d.maxSuffixe, a.ajoute.length); else d.maxPrefixe = Math.max(d.maxPrefixe, a.ajoute.length);
      }
      i += n;
    }
  }
  const ld = dic.split('\n');
  for (let i = 1; i < ld.length; i++) {
    const l = ld[i]; if (!l) continue;
    const t = l.split(/[\t ]/)[0]; const j = t.indexOf('/');
    const mot = j < 0 ? t : t.slice(0, j), dr = j < 0 ? [] : deux(t.slice(j + 1));
    if (!mot) continue;
    const s = d.mots.get(mot); if (s) for (const x of dr) s.add(x); else d.mots.set(mot, new Set(dr));
  }
  return d;
}

let charge: Dico | undefined;
/** Le dictionnaire français livré avec Odin (chargé une fois, à la première demande : environ une demi-seconde). */
export function dicoFrancais(): Dico {
  if (!charge) {
    const lire = (n: string) => gunzipSync(readFileSync(new URL(`./dico/${n}`, import.meta.url))).toString('utf8');
    charge = lireDico(lire('fr.aff.gz'), lire('fr.dic.gz'));
  }
  return charge;
}

const a = (d: Dico, mot: string, drapeau: string) => { const s = d.mots.get(mot); return Boolean(s && s.has(drapeau) && !(d.interdit && s.has(d.interdit))); };
/** Le mot existe-t-il, tel quel (avec ses accents et sa casse) ? */
export function connu(d: Dico, w: string): boolean {
  const m = d.mots.get(w); if (m && !(d.interdit && m.has(d.interdit))) return true;
  // Suffixe seul.
  for (let k = 0; k <= Math.min(w.length, d.maxSuffixe); k++) {
    const l = d.suffixes.get(w.slice(w.length - k)); if (!l) continue;
    const base = w.slice(0, w.length - k);
    for (const e of l) { const r = base + e.retire; if ((!e.cond || e.cond.test(r)) && a(d, r, e.drapeau)) return true; }
  }
  // Préfixe seul, ou préfixe + suffixe.
  for (let k = 1; k <= Math.min(w.length, d.maxPrefixe); k++) {
    const l = d.prefixes.get(w.slice(0, k)); if (!l) continue;
    for (const e of l) {
      const r = e.retire + w.slice(k); if (e.cond && !e.cond.test(r)) continue;
      if (a(d, r, e.drapeau)) return true;
      if (!e.croise) continue;
      for (let j = 0; j <= Math.min(r.length, d.maxSuffixe); j++) {
        const ls = d.suffixes.get(r.slice(r.length - j)); if (!ls) continue;
        const base = r.slice(0, r.length - j);
        for (const s of ls) {
          if (!s.croise) continue; const rr = base + s.retire;
          if ((!s.cond || s.cond.test(rr)) && a(d, rr, s.drapeau) && (a(d, rr, e.drapeau) || s.suite.has(e.drapeau))) return true;
        }
      }
    }
  }
  return false;
}

/** Mots que le dictionnaire n'a pas mais qu'on écrit tous les jours (Odin, ses applis, l'informatique). */
const EN_PLUS = new Set('ok okay wifi wi-fi email emails e-mail mail mails appli applis smartphone smartphones internet web bluetooth youtube whatsapp telegram signal google facebook instagram tiktok linkedin login logins mdp sms lol bisous svp stp cad etc pdf docx xlsx csv usb hdmi cpu gpu ram ssd nas vpn ia api url urls bug bugs ticket tickets backup backups update updates selfie selfies week-end week-ends'.split(' '));
const ELISION = /^(?:l|d|j|m|n|s|t|c|qu|jusqu|lorsqu|puisqu|quoiqu|presqu)['’]/i;
/** Le mot (un seul, sans espace) est-il bien écrit ? Les majuscules en début de phrase et les élisions (l', qu') sont permises. */
export function motJuste(d: Dico, brut: string): boolean {
  let w = brut; for (const [x, y] of d.iconv) if (w.includes(x)) w = w.split(x).join(y);
  w = w.replace(ELISION, ''); if (!w) return true;
  const bas = w.toLowerCase();
  if (EN_PLUS.has(bas) || connu(d, w) || connu(d, bas)) return true;
  if (w[0] !== bas[0] && connu(d, bas[0] + w.slice(1))) return true;
  // Un mot composé avec des traits d'union : chaque morceau doit exister.
  if (w.includes('-')) return w.split('-').every((x) => !x || motJuste(d, x));
  return false;
}

/** Des sons qui s'écrivent de plusieurs façons (en plus des remplacements du dictionnaire). */
const SONS: Array<[RegExp, string]> = ([['j', 'g'], ['g', 'j'], ['ge', 'j'], ['j', 'ge'], ['k', 'c'], ['c', 'k'], ['s', 'c'], ['c', 's'], ['z', 's'], ['s', 'z'], ['an', 'en'], ['en', 'an'], ['am', 'em'], ['em', 'am'], ['in', 'ain'], ['ain', 'in'], ['in', 'ein'], ['ein', 'in'], ['é', 'er'], ['er', 'é'], ['é', 'ez'], ['é', 'et'], ['o', 'ot'], ['o', 'os'], ['oi', 'oit'], ['ai', 'ait'], ['ai', 'ais'], ['è', 'ai'], ['g', 'gu'], ['gu', 'g'], ['y', 'i'], ['i', 'y'], ['h', '']] as Array<[string, string]>)
  .map(([a, b]) => [new RegExp(a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gu'), b]);
const ACCENTS = (d: Dico) => d.map.filter((m) => /[àâäéèêëîïôöùûüç]/i.test(m)).map((m) => [...m].filter((c) => c === c.toLowerCase()));
/** Propositions pour un mot inconnu, de la meilleure à la moins bonne, avec ce qui a changé (accent, usage, frappe). Pur. */
export function propositions(d: Dico, brut: string, max = 3): Array<{ mot: string; genre: 'orthographe' | 'frappe' }> {
  const elision = ELISION.exec(brut)?.[0] ?? '', w0 = brut.slice(elision.length);
  const maj = w0[0] !== undefined && w0[0] !== w0[0].toLowerCase(), w = w0.toLowerCase();
  if (w.length < 2 || w.length > 40) return [];
  const vus = new Map<string, number>(), ajoute = (c: string, score: number) => { if (c && c !== w && (vus.get(c) ?? 99) > score) vus.set(c, score); };
  // Accents (1 ou 2 lettres changées) : « deja » → « déjà ».
  const groupes = ACCENTS(d), groupeDe = (c: string) => groupes.find((g) => g.includes(c));
  const pos = [...w].map((c, i) => (groupeDe(c) ? i : -1)).filter((i) => i >= 0);
  const lettres = [...w];
  for (const i of pos) for (const x of groupeDe(lettres[i])!) {
    if (x === lettres[i]) continue; const l1 = [...lettres]; l1[i] = x; ajoute(l1.join(''), 0);
    for (const j of pos) if (j > i) for (const y of groupeDe(lettres[j])!) { if (y === lettres[j]) continue; const l2 = [...l1]; l2[j] = y; ajoute(l2.join(''), 0.5); }
  }
  // Les remplacements courants du dictionnaire (REP) : « restorant » → « restaurant ».
  // Et les sons qui s'écrivent autrement (« manjer » → « manger ») ; deux remplacements à la suite au plus (« apeller » → « appeler »).
  const remplacer = (x: string, score: number, suite: boolean) => {
    for (const [re, vers] of suite ? [...d.rep, ...SONS] : d.rep) {
      for (const m of x.matchAll(re)) { const c = x.slice(0, m.index) + vers + x.slice(m.index + m[0].length); if (c === x) continue; ajoute(c, score); if (suite) remplacer(c, score + 0.5, false); }
    }
  };
  remplacer(w, 1, true);
  // Un accent ou un remplacement courant suffit : pas besoin d'essayer toutes les fautes de frappe (plus rapide).
  const trouves = (l: Array<[string, number]>) => l.filter(([c]) => (c.includes(' ') ? c.split(' ').every((x) => connu(d, x)) : connu(d, c)));
  const rendre = (l: Array<[string, number]>) => l.sort((x, y) => x[1] - y[1] || Math.abs(x[0].length - w.length) - Math.abs(y[0].length - w.length)).slice(0, max)
    .map(([c]) => ({ mot: elision + (maj ? c[0].toUpperCase() + c.slice(1) : c), genre: sansAccent(c) !== sansAccent(w) && distance1(w, c) ? 'frappe' as const : 'orthographe' as const }));
  const vite = trouves([...vus.entries()]);
  if (vite.length) return rendre(vite);
  // Fautes de frappe : une lettre en trop, en moins, inversée, ou une touche voisine.
  const voisines = (c: string) => d.touches.flatMap((r) => { const i = r.indexOf(c); return i < 0 ? [] : [r[i - 1], r[i + 1]].filter(Boolean) as string[]; });
  for (let i = 0; i < w.length; i++) {
    ajoute(w.slice(0, i) + w.slice(i + 1), 2.2);
    if (i + 1 < w.length) ajoute(w.slice(0, i) + w[i + 1] + w[i] + w.slice(i + 2), 2);
    for (const c of voisines(w[i])) ajoute(w.slice(0, i) + c + w.slice(i + 1), 2.1);
    for (const c of d.essais) if (/\p{Ll}/u.test(c)) ajoute(w.slice(0, i) + c + w.slice(i + 1), 3);
  }
  for (let i = 0; i <= w.length; i++) for (const c of d.essais) if (/\p{Ll}/u.test(c)) ajoute(w.slice(0, i) + c + w.slice(i), i === w.length ? 2.6 : 2.4);
  // Deux mots collés : « deuxmots » → « deux mots ».
  for (let i = 2; i < w.length - 1; i++) { const x = w.slice(0, i), y = w.slice(i); if (x.length > 1 && y.length > 1) ajoute(`${x} ${y}`, 3.5); }
  return rendre(trouves([...vus.entries()]));
}
const sansAccent = (x: string) => x.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
/** Une seule lettre en plus, en moins, changée ou deux lettres inversées : une faute de frappe. Pur. */
export function distance1(a: string, b: string): boolean {
  if (a === b || Math.abs(a.length - b.length) > 1) return false;
  let i = 0; while (i < a.length && a[i] === b[i]) i++;
  if (a.length === b.length) return a.slice(i + 1) === b.slice(i + 1) || (a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2));
  return a.length > b.length ? a.slice(i + 1) === b.slice(i) : a.slice(i) === b.slice(i + 1);
}
