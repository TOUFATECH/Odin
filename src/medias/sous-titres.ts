// Médias reçus : les sous-titres. Des segments de parole (avec ou sans temps par mot) deviennent des répliques lisibles
// dans TOUTES les écritures : largeur et vitesse de lecture propres à l'écriture (16 graphèmes par ligne et 7 par seconde
// pour le chinois, le japonais et le coréen ; 35 et 17 pour le thaï, le lao, le khmer, le birman ; 42 et 17 sinon),
// 2 lignes au plus, coupures à une fin de phrase, un silence, une ponctuation, sinon à la frontière de mot la plus proche
// du milieu (Intl.Segmenter : jamais dans un mot ni dans un graphème). Écriture SRT et WebVTT (droite à gauche marquée
// par U+200F, jamais U+202E), relecture tolérante d'un SRT/VTT reçu (automate ligne par ligne, borné), et traduction
// réplique par réplique par une fonction DONNÉE (jamais fabriquée ici), avec les mêmes temps et l'original gardé.

import type { Briques, Manque, Mot, Segment } from './contrat.ts';
import { BORNES } from './contrat.ts';
import { classeLecture, droiteAGauche } from './ecritures.ts';
import { nettoyerTexte } from './octets.ts';
import { decoderTexteInconnu } from './texte.ts';

export interface Replique { debutMs: number; finMs: number; texte: string; voix?: string; langue?: string; original?: string }

const FIN_PHRASE = new Set(['.', '!', '?', '。', '！', '？', '؟', '۔', '।', '॥', '።', '…', '‽', '՞', '։', '჻', '፧', '።', '؞', '܀']);
const PROPOSITION = new Set([',', ';', ':', '、', '，', '；', '：', '،', '؛', '፣', '፤', '–', '—']);
const MIN_MS = 800, MAX_MS = 7000, ECART_MS = 80, PLAFOND_MS = 99 * 3600 * 1000 - 1;

/** Promesse bornée dans le temps et arrêtable. */
export function avecDelai<T>(p: Promise<T>, ms: number, signal?: AbortSignal, nom = 'opération'): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (signal?.aborted) { reject(Object.assign(new Error('arrêt demandé'), { name: 'AbortError' })); return; }
    const t = setTimeout(() => reject(Object.assign(new Error(`${nom} : délai dépassé (${Math.round(ms / 1000)} s)`), { name: 'Delai' })), Math.max(1, ms));
    const arret = () => { clearTimeout(t); reject(Object.assign(new Error('arrêt demandé'), { name: 'AbortError' })); };
    signal?.addEventListener('abort', arret, { once: true });
    p.then((v) => { clearTimeout(t); signal?.removeEventListener('abort', arret); resolve(v); },
      (e) => { clearTimeout(t); signal?.removeEventListener('abort', arret); reject(e); });
  });
}

// ─────────────────────────────── Mesures sur un texte ───────────────────────────────

/** Un texte préparé : frontières de graphèmes et de mots (indices UTF-16). */
class Texte {
  t: string; g: number[]; frontieres: number[];
  constructor(t: string, langue?: string) {
    this.t = t;
    this.g = [];
    for (const s of new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(t)) this.g.push(s.index);
    let seg: Intl.Segmenter;
    try { seg = new Intl.Segmenter(langue || undefined, { granularity: 'word' }); } catch { seg = new Intl.Segmenter(undefined, { granularity: 'word' }); }
    this.frontieres = [];
    // On coupe devant un mot ou devant un blanc, jamais devant une ponctuation (elle reste avec ce qui la précède).
    for (const s of seg.segment(t)) if (s.index > 0 && (s.isWordLike || estBlanc(s.segment[0]))) this.frontieres.push(s.index);
  }
  /** Nombre de graphèmes dans [a, b), blancs de bord exclus. */
  n(a: number, b: number): number {
    while (a < b && estBlanc(this.t[a])) a++;
    while (b > a && estBlanc(this.t[b - 1])) b--;
    return borneSup(this.g, b) - borneSup(this.g, a);
  }
  morceau(a: number, b: number): string { return this.t.slice(a, b).trim(); }
}
const estBlanc = (c: string | undefined) => c === ' ' || c === '\n' || c === '\t' || c === ' ' || c === '　';
/** Nombre d'éléments < x dans un tableau trié. */
function borneSup(a: number[], x: number): number { let lo = 0, hi = a.length; while (lo < hi) { const m = (lo + hi) >> 1; if (a[m] < x) lo = m + 1; else hi = m; } return lo; }
/** Dernier caractère non blanc avant la position c. */
function avant(t: string, c: number): string { let k = c - 1; while (k >= 0 && estBlanc(t[k])) k--; return k >= 0 ? t[k] : ''; }

/** Met un texte en 1 ou 2 lignes de `parLigne` graphèmes au plus ; undefined si impossible. */
function enLignes(x: Texte, a: number, b: number, parLigne: number): string[] | undefined {
  if (x.n(a, b) <= parLigne) return [x.morceau(a, b)];
  const milieu = (a + b) / 2;
  let meilleur: number | undefined, score = Infinity;
  for (const c of x.frontieres) {
    if (c <= a || c >= b) continue;
    if (x.n(a, c) > parLigne || x.n(c, b) > parLigne) continue;
    if (!x.morceau(a, c) || !x.morceau(c, b)) continue;
    const s = Math.abs(c - milieu) - (PROPOSITION.has(avant(x.t, c)) || FIN_PHRASE.has(avant(x.t, c)) ? (b - a) * 0.15 : 0);
    if (s < score) { score = s; meilleur = c; }
  }
  return meilleur === undefined ? undefined : [x.morceau(a, meilleur), x.morceau(meilleur, b)];
}

// ─────────────────────────────── Segments → répliques ───────────────────────────────

export function repliquesDepuisSegments(seg: Segment[], o: { mots?: Mot[]; langue?: string } = {}): { repliques: Replique[]; horodatageApproximatif: boolean } {
  const propres = seg.filter((s) => s && typeof s.texte === 'string' && Number.isFinite(s.debut) && Number.isFinite(s.fin))
    .map((s) => ({ ...s, debut: Math.max(0, Math.min(s.debut, s.fin)), fin: Math.max(s.debut, s.fin) }))
    .sort((p, q) => p.debut - q.debut).slice(0, BORNES.sousTitresRepliques);
  const mots = (o.mots ?? []).filter((m) => Number.isFinite(m.debut) && Number.isFinite(m.fin) && m.texte).sort((p, q) => p.debut - q.debut);
  let approx = false;
  const sortie: Array<Replique & { classe: ReturnType<typeof classeLecture> }> = [];
  for (const s of propres) {
    const brut = nettoyerTexte(s.texte.split('\n').join(' ')).texte;
    if (!brut) continue;
    const x = new Texte(brut, o.langue);
    const classe = classeLecture(brut);
    // Temps des mots de ce segment, rattachés à leur position dans le texte (sinon : au prorata des graphèmes).
    // Recherche dichotomique du premier mot du segment (mots triés) : coût linéaire, jamais segments × mots.
    let lo = 0, hi = mots.length;
    while (lo < hi) { const mi = (lo + hi) >> 1; if (mots[mi].debut < s.debut - 0.05) lo = mi + 1; else hi = mi; }
    const ici: Mot[] = [];
    for (let k = lo; k < mots.length && mots[k].debut <= s.fin + 0.05 && ici.length < 10_000; k++) if (mots[k].fin <= s.fin + 0.05) ici.push(mots[k]);
    let positions: Array<{ i: number; fin: number; debut: number; finS: number }> | undefined = [];
    let curseur = 0;
    for (const m of ici) {
      const k = brut.indexOf(m.texte.trim(), curseur);
      if (k < 0) { positions = undefined; break; }
      positions.push({ i: k, fin: k + m.texte.trim().length, debut: m.debut, finS: m.fin });
      curseur = k + m.texte.trim().length;
    }
    if (!positions || !positions.length) { positions = undefined; approx = true; }
    const total = Math.max(1, x.n(0, brut.length));
    const tempsDe = (a: number, b: number): [number, number] => {
      if (positions) {
        const dedans = positions.filter((p) => p.i >= a && p.fin <= b);
        if (dedans.length) return [dedans[0].debut, dedans[dedans.length - 1].finS];
      }
      const avantA = x.n(0, a), jusquaB = x.n(0, b);
      const d = s.fin - s.debut;
      return [s.debut + (d * avantA) / total, s.debut + (d * jusquaB) / total];
    };
    const pause = (c: number): number => {
      if (!positions) return 0;
      const g = positions.filter((p) => p.fin <= c).pop(), dr = positions.find((p) => p.i >= c);
      return g && dr ? dr.debut - g.finS : 0;
    };
    const tient = (a: number, b: number) => { const [d, f] = tempsDe(a, b); return f - d <= MAX_MS / 1000 && !!enLignes(x, a, b, classe.parLigne); };
    const morceaux: Array<[number, number]> = [];
    const couper = (a: number, b: number, prof: number): void => {
      if (!x.morceau(a, b)) return;
      if (prof > 64 || tient(a, b)) { morceaux.push([a, b]); return; }
      const long = x.n(a, b);
      const milieu = (a + b) / 2, bas = a + (b - a) * 0.2, haut = a + (b - a) * 0.8;
      const seuilPause = long > 4 * classe.parLigne ? 0.25 : 0.4;
      let meilleur: number | undefined, score = Infinity;
      for (const c of x.frontieres) {
        if (c <= a || c >= b || !x.morceau(a, c) || !x.morceau(c, b)) continue;
        const centre = c >= bas && c <= haut;
        const k = avant(x.t, c);
        const rang = centre && FIN_PHRASE.has(k) ? 0 : centre && pause(c) >= seuilPause ? 1 : centre && PROPOSITION.has(k) ? 2 : 3;
        const s2 = rang * 1e9 + Math.abs(c - milieu);
        if (s2 < score) { score = s2; meilleur = c; }
      }
      if (meilleur === undefined) {
        // Un seul « mot » trop long : coupé au graphème le plus proche du milieu.
        const k = x.g.filter((gi) => gi > a && gi < b);
        if (!k.length) { morceaux.push([a, b]); return; }
        meilleur = k.reduce((p, q) => (Math.abs(q - milieu) < Math.abs(p - milieu) ? q : p));
      }
      couper(a, meilleur, prof + 1);
      couper(meilleur, b, prof + 1);
    };
    couper(0, brut.length, 0);
    for (const [a, b] of morceaux) {
      const [d, f] = tempsDe(a, b);
      const lignes = enLignes(x, a, b, classe.parLigne) ?? [x.morceau(a, b)];
      const r: Replique & { classe: ReturnType<typeof classeLecture> } = { debutMs: Math.round(d * 1000), finMs: Math.round(f * 1000), texte: lignes.join('\n'), classe };
      if (s.voix) r.voix = s.voix;
      if (o.langue) r.langue = o.langue;
      sortie.push(r);
    }
  }
  regler(sortie);
  return { repliques: sortie.map(({ classe: _c, ...r }) => r), horodatageApproximatif: approx };
}

/** Durées 0,8–7 s, écart ≥ 80 ms, fusion des trop courtes, vitesse de lecture, jamais de chevauchement. */
function regler(r: Array<Replique & { classe?: ReturnType<typeof classeLecture> }>): void {
  r.sort((a, b) => a.debutMs - b.debutMs);
  // Fusion des répliques trop courtes avec la suivante (écart < 0,5 s, et si l'ensemble tient en 2 lignes).
  for (let i = 0; i + 1 < r.length;) {
    const a = r[i], b = r[i + 1];
    const classe = a.classe ?? classeLecture(a.texte);
    if (a.finMs - a.debutMs < MIN_MS && b.debutMs - a.finMs < 500 && a.voix === b.voix) {
      const joint = classe.sansEspaces ? `${a.texte.split('\n').join('')}${b.texte.split('\n').join('')}` : `${a.texte.split('\n').join(' ')} ${b.texte.split('\n').join(' ')}`;
      const x = new Texte(joint);
      const lignes = enLignes(x, 0, joint.length, classe.parLigne);
      if (lignes && b.finMs - a.debutMs <= MAX_MS) { r.splice(i, 2, { ...a, finMs: b.finMs, texte: lignes.join('\n') }); continue; }
    }
    i++;
  }
  for (let i = 0; i < r.length; i++) {
    const c = r[i], suiv = r[i + 1];
    c.debutMs = Math.max(0, Math.min(Math.round(c.debutMs), PLAFOND_MS));
    if (i > 0 && c.debutMs < r[i - 1].finMs + ECART_MS) c.debutMs = r[i - 1].finMs + ECART_MS;
    const libre = suiv ? Math.max(c.debutMs + 1, Math.round(suiv.debutMs) - ECART_MS) : c.debutMs + MAX_MS;
    let fin = Math.round(c.finMs);
    const classe = c.classe ?? classeLecture(c.texte);
    const n = new Texte(c.texte).n(0, c.texte.length);
    const voulu = Math.max(MIN_MS, Math.ceil((n / classe.parSeconde) * 1000));
    if (fin - c.debutMs < voulu) fin = Math.min(c.debutMs + voulu, libre);
    fin = Math.min(fin, c.debutMs + MAX_MS, libre, PLAFOND_MS);
    c.finMs = Math.max(fin, c.debutMs + 1);
  }
}

// ─────────────────────────────── Écriture ───────────────────────────────

const d2 = (n: number) => String(n).padStart(2, '0');
function horodatage(ms: number, sep: ',' | '.'): string {
  const x = Math.max(0, Math.min(Math.round(ms), PLAFOND_MS));
  const h = Math.floor(x / 3600000), m = Math.floor((x % 3600000) / 60000), s = Math.floor((x % 60000) / 1000), r = x % 1000;
  return `${d2(h)}:${d2(m)}:${d2(s)}${sep}${String(r).padStart(3, '0')}`;
}
const FINALE = new Set(['.', '!', '?', '؟', '،', '…', ':', '؛', '۔']);
/** Marque de droite à gauche (U+200F) en tête de ligne et après une ponctuation finale, pour l'arabe, l'hébreu… */
function sens(l: string): string {
  if (!droiteAGauche(l)) return l;
  const fin = l[l.length - 1];
  return `‏${l}${FINALE.has(fin) ? '‏' : ''}`;
}
/** Lignes d'une réplique : contrôles bidi d'enchâssement retirés, lignes vides retirées. */
function lignesDe(t: string): string[] {
  const r: string[] = [];
  for (const l of t.split('\n')) {
    let x = '';
    for (const ch of l) { const c = ch.codePointAt(0)!; if ((c >= 0x202a && c <= 0x202e) || (c >= 0x2066 && c <= 0x2069) || c === 0x0d) continue; x += ch; }
    x = x.trim();
    if (x) r.push(x);
  }
  return r;
}

export function ecrireSrt(r: Replique[], o: { bom?: boolean } = {}): string {
  const blocs: string[] = [];
  for (const c of r) {
    const lignes = lignesDe(c.texte).map((l) => sens(l.split('-->').join('→').split('<').join('‹')));
    if (!lignes.length) continue;
    blocs.push(`${blocs.length + 1}\r\n${horodatage(c.debutMs, ',')} --> ${horodatage(c.finMs, ',')}\r\n${lignes.join('\r\n')}\r\n`);
  }
  return `${o.bom ? '﻿' : ''}${blocs.join('\r\n')}`;
}

const echapper = (t: string) => t.split('&').join('&amp;').split('<').join('&lt;').split('>').join('&gt;');
export function ecrireVtt(r: Replique[], o: { langue?: string } = {}): string {
  let s = 'WEBVTT\n';
  if (o.langue) s += `Language: ${echapper(o.langue.slice(0, 35))}\n`;
  s += '\n';
  for (const c of r) {
    const lignes = lignesDe(c.texte).map((l) => sens(echapper(l)));
    if (!lignes.length) continue;
    if (c.voix) lignes[0] = `<v ${echapper(lignesDe(c.voix).join(' ').slice(0, 64))}>${lignes[0]}`;
    s += `${horodatage(c.debutMs, '.')} --> ${horodatage(c.finMs, '.')}\n${lignes.join('\n')}\n\n`;
  }
  return s;
}

// ─────────────────────────────── Lecture ───────────────────────────────

const chiffreC = (c: string | undefined) => c !== undefined && c >= '0' && c <= '9';
/** « hh:mm:ss,mmm », « mm:ss.mmm » (heures facultatives), caractère par caractère ; rend [ms, position suivante]. */
function lireTemps(t: string, p: number): [number, number] | undefined {
  const nombres: number[] = [];
  let q = p;
  for (;;) {
    let v = 0, n = 0;
    while (chiffreC(t[q]) && n < 4) { v = v * 10 + (t.charCodeAt(q) - 48); q++; n++; }
    if (!n) return undefined;
    nombres.push(v);
    if (t[q] === ':' && nombres.length < 3) { q++; continue; }
    break;
  }
  if (nombres.length < 2) return undefined;
  let ms = 0;
  if (t[q] === ',' || t[q] === '.') { q++; let n = 0, f = ''; while (chiffreC(t[q]) && n < 3) { f += t[q]; q++; n++; } while (chiffreC(t[q])) q++; ms = n ? Math.round(Number(`0.${f}`) * 1000) : 0; }
  const [h, m, s] = nombres.length === 3 ? nombres : [0, nombres[0], nombres[1]];
  if (m > 59 || s > 59) return undefined;
  return [((h * 60 + m) * 60 + s) * 1000 + ms, q];
}
/** Ligne d'horodatage « début --> fin [réglages] ». */
function ligneTemps(l: string): [number, number] | undefined {
  let p = 0;
  while (l[p] === ' ' || l[p] === '\t') p++;
  const a = lireTemps(l, p);
  if (!a) return undefined;
  p = a[1];
  while (l[p] === ' ' || l[p] === '\t') p++;
  if (!l.startsWith('-->', p)) return undefined;
  p += 3;
  while (l[p] === ' ' || l[p] === '\t') p++;
  const b = lireTemps(l, p);
  return b ? [a[0], b[0]] : undefined;
}
/** Texte d'une ligne VTT/SRT : balises retirées (la voix gardée), entités décodées. */
function texteDeLigne(l: string): { texte: string; voix?: string } {
  let r = '', voix: string | undefined, i = 0;
  // Recherche de la fermante BORNÉE (200 caractères pour « > », 8 pour « ; ») : une ligne pleine de « < » ou de « & »
  // non fermés reste linéaire (jamais un indexOf jusqu'au bout de la ligne pour chaque ouvrante).
  // La position du prochain « > » (ou « ; ») est mémorisée : elle n'est recherchée à nouveau que lorsqu'on l'a dépassée,
  // donc le coût total reste proportionnel à la longueur de la ligne.
  const prochain: Record<string, number> = { '>': -2, ';': -2 };
  const chercher = (x: string, depuis: number, max: number): number => {
    let p = prochain[x];
    if (p !== -1 && p < depuis) { p = l.indexOf(x, depuis); prochain[x] = p; }
    return p >= 0 && p - depuis < max ? p : -1;
  };
  while (i < l.length) {
    const c = l[i];
    if (c === '<') {
      const f = chercher('>', i + 1, 200);
      if (f < 0) { r += c; i++; continue; }
      const balise = l.slice(i + 1, f);
      if ((balise.startsWith('v ') || balise.startsWith('v.')) && voix === undefined) { const k = balise.indexOf(' '); voix = balise.slice(k + 1).trim() || undefined; }
      i = f + 1;
      continue;
    }
    if (c === '&') {
      const f = chercher(';', i + 1, 8);
      const nom = f > 0 ? l.slice(i + 1, f) : '';
      const v = nom === 'amp' ? '&' : nom === 'lt' ? '<' : nom === 'gt' ? '>' : nom === 'nbsp' ? ' ' : nom === 'lrm' ? '‎' : nom === 'rlm' ? '‏' : undefined;
      if (v !== undefined) { r += v; i = f + 1; continue; }
    }
    r += c; i++;
  }
  return { texte: r.trim(), voix };
}

/** Lit un SRT ou un WebVTT (texte ou octets : BOM, UTF-16 avec BOM), tolérant, borné à 2 Mio et 100 000 répliques. */
export function lireSousTitres(entree: string | Uint8Array): { format: 'srt' | 'vtt' | 'inconnu'; repliques: Replique[]; partiel?: string; remarques?: string[] } {
  let texte: string, partiel: string | undefined;
  const max = BORNES.sousTitresOctets;
  if (typeof entree === 'string') { texte = entree.length > max ? entree.slice(0, max) : entree; if (entree.length > max) partiel = 'sous-titres coupés à 2 Mio'; }
  else {
    const b = Buffer.from(entree.buffer, entree.byteOffset, entree.byteLength);
    texte = decoderTexteInconnu(b.length > max ? b.subarray(0, max) : b).texte;
    if (b.length > max) partiel = 'sous-titres coupés à 2 Mio';
  }
  if (texte.charCodeAt(0) === 0xfeff) texte = texte.slice(1);
  const repliques: Replique[] = [];
  let inversees = 0;
  let format: 'srt' | 'vtt' | 'inconnu' = 'inconnu';
  let i = 0;
  const ligne = (): string | undefined => {
    if (i >= texte.length) return undefined;
    let j = i;
    while (j < texte.length && texte[j] !== '\n' && texte[j] !== '\r') j++;
    const l = texte.slice(i, j);
    i = texte[j] === '\r' && texte[j + 1] === '\n' ? j + 2 : j + 1;
    return l;
  };
  // En-tête WebVTT.
  const debut = i;
  let premiere = ligne();
  while (premiere !== undefined && !premiere.trim()) premiere = ligne();
  if (premiere !== undefined && premiere.trimStart().startsWith('WEBVTT')) {
    format = 'vtt';
    let l = ligne();
    while (l !== undefined && l.trim()) l = ligne();
  } else i = debut;
  let bloc: string[] = [];
  const fermer = () => {
    if (!bloc.length) return;
    const b = bloc; bloc = [];
    if (format === 'vtt' && (b[0].startsWith('NOTE') || b[0].startsWith('STYLE') || b[0].startsWith('REGION'))) return;
    let k = -1, t: [number, number] | undefined;
    for (let x = 0; x < Math.min(3, b.length); x++) { t = b[x].includes('-->') ? ligneTemps(b[x]) : undefined; if (t) { k = x; break; } }
    if (!t || k < 0) return;
    let voix: string | undefined;
    const lignes: string[] = [];
    for (const l of b.slice(k + 1)) { const x = texteDeLigne(l); if (x.voix && !voix) voix = x.voix; if (x.texte) lignes.push(x.texte); }
    if (!lignes.length) return;
    if (format === 'inconnu') format = 'srt';
    if (t[1] < t[0]) inversees++;   // fin avant le début : gardée en durée nulle, et dit
    const r: Replique = { debutMs: t[0], finMs: Math.max(t[0], t[1]), texte: lignes.join('\n') };
    if (voix) r.voix = voix;
    repliques.push(r);
  };
  for (let l = ligne(); l !== undefined; l = ligne()) {
    if (repliques.length >= BORNES.sousTitresRepliques) { partiel ??= `plus de ${BORNES.sousTitresRepliques} répliques : lecture arrêtée`; break; }
    if (!l.trim()) { fermer(); continue; }
    if (bloc.length < 64) bloc.push(l.length > 4096 ? l.slice(0, 4096) : l);
  }
  fermer();
  const r: { format: 'srt' | 'vtt' | 'inconnu'; repliques: Replique[]; partiel?: string; remarques?: string[] } = { format, repliques };
  if (partiel) r.partiel = partiel;
  if (inversees) r.remarques = [`${inversees} réplique(s) dont la fin précède le début : gardée(s) avec une durée nulle`];
  return r;
}

// ─────────────────────────────── Traduction ───────────────────────────────

/** Traduit réplique par réplique (au plus 2 voisines en contexte) ; mêmes temps ; l'original est gardé. */
export async function traduireRepliques(r: Replique[], vers: string, traduire: NonNullable<Briques['traduire']>, o: { deLangue?: string; signal?: AbortSignal; delaiMs?: number } = {}): Promise<{ repliques: Replique[]; manque: Manque[] }> {
  const manque: Manque[] = [];
  const delai = o.delaiMs ?? 30_000;
  const une = async (texte: string, contexte: string[]): Promise<string> => {
    const t = await avecDelai(traduire(texte, vers, { deLangue: o.deLangue, contexte, signal: o.signal }), delai, o.signal, 'traduction');
    const net = nettoyerTexte(String(t ?? ''), 'utf-8', { max: 4096 }).texte;
    if (!net) throw new Error('traduction vide');
    return net;
  };
  const sortie: Array<Replique & { traduite: boolean }> = [];
  for (let i = 0; i < r.length; i++) {
    const c = r[i];
    const source = c.original ?? c.texte;
    if (o.signal?.aborted) { sortie.push({ ...c, traduite: false }); continue; }
    const contexte = [r[i - 1]?.texte, r[i + 1]?.texte].filter((x): x is string => !!x).map((x) => x.split('\n').join(' '));
    try {
      const t = await une(source.split('\n').join(' '), contexte);
      sortie.push({ ...c, texte: t, original: source, langue: vers, traduite: true });
    } catch (e) {
      sortie.push({ ...c, traduite: false });
      manque.push({ quoi: `la traduction de la réplique ${i + 1}`, raison: `${String((e as Error)?.message ?? e).slice(0, 160)} : l'original est gardé`, code: (e as Error)?.name === 'AbortError' ? 'arrete' : 'echec' });
    }
  }
  if (o.signal?.aborted && !manque.some((m) => m.code === 'arrete')) manque.push({ quoi: 'la fin de la traduction', raison: 'arrêt demandé', code: 'arrete' });
  // Vitesse recontrôlée : trop rapide → fin allongée dans l'écart libre, sinon fusion avec la suivante (une fois).
  for (let i = 0; i < sortie.length; i++) {
    const c = sortie[i];
    if (!c.traduite) continue;
    const classe = classeLecture(c.texte);
    const n = new Texte(c.texte).n(0, c.texte.length);
    const voulu = Math.ceil((n / classe.parSeconde) * 1000);
    if (c.finMs - c.debutMs >= voulu) continue;
    const libre = sortie[i + 1] ? sortie[i + 1].debutMs - ECART_MS : c.debutMs + MAX_MS;
    c.finMs = Math.max(c.finMs, Math.min(c.debutMs + voulu, libre, c.debutMs + MAX_MS));
    const s = sortie[i + 1];
    if (c.finMs - c.debutMs < voulu && s && s.traduite && s.finMs - c.debutMs <= MAX_MS && !o.signal?.aborted) {
      try {
        const t = await une(`${c.original ?? ''} ${s.original ?? ''}`.trim(), [sortie[i - 1]?.texte, sortie[i + 2]?.texte].filter((x): x is string => !!x));
        sortie.splice(i, 2, { ...c, finMs: s.finMs, texte: t, original: `${c.original ?? ''}\n${s.original ?? ''}`.trim(), traduite: true });
      } catch { /* on garde les deux répliques telles quelles */ }
    }
  }
  // Remise en lignes de la traduction (2 lignes quand c'est possible).
  const repliques = sortie.map(({ traduite, ...x }) => {
    if (!traduite) return x;
    const classe = classeLecture(x.texte);
    const tx = new Texte(x.texte.split('\n').join(classe.sansEspaces ? '' : ' '));
    const lignes = enLignes(tx, 0, tx.t.length, classe.parLigne);
    return { ...x, texte: lignes ? lignes.join('\n') : tx.t };
  });
  return { repliques, manque };
}
