// Médias reçus : les métadonnées des documents. PDF (dernier trailer → table xref classique ou flux xref, flux d'objets,
// /Info, catalogue /Lang, /Metadata XMP, /Encrypt, nombre de pages), OOXML (docProps/core.xml et app.xml), ODF
// (meta.xml), EPUB (container.xml → OPF). Tout est borné : 64 références suivies au plus, un Set des objets en cours
// (une boucle est évitée et dite), flux gonflés ≤ 16 Mio avec le contrôle « décompression suspecte », aucune
// expression régulière sur le contenu (lecteur de jetons PDF caractère par caractère, petit lecteur XML borné).

import type { Contexte, DateLue, FicheEnCours, Nature } from './contrat.ts';
import { ErreurFormat } from './contrat.ts';
import { ajouterChamp, ajouterDate, ajouterLangue, ajouterManque, remarque } from './champs.ts';
import { dateDepuisParties, lireDateIso } from './dates.ts';
import { versBcp47 } from './langues-codes.ts';
import { gonfler, nettoyerTexte, type Source } from './octets.ts';
import { lireXml, type NoeudXml } from './xml.ts';
import { lireXmp } from './xmp.ts';
import { lireEntreeZip, listerZip, type EntreeZip } from './zip.ts';

/** Lit les métadonnées d'un document dans la fiche en cours (ne fait rien pour les formats sans métadonnées lues). */
export function lireMetaDocument(src: Source, nature: Nature, f: FicheEnCours, ctx: Contexte): void {
  switch (nature.format) {
    case 'pdf': return lirePdf(src, f, ctx);
    case 'docx': case 'xlsx': case 'pptx': return lireOoxml(src, f, ctx);
    case 'odt': case 'ods': case 'odp': return lireOdf(src, f, ctx);
    case 'epub': return lireEpub(src, f, ctx);
    case 'ole':
      ajouterManque(f, { quoi: 'les métadonnées du document', raison: 'métadonnées des anciens fichiers Office : format non lu', code: 'format-non-lu' });
      return;
    default: return;
  }
}

// ─────────────────────────────── PDF : jetons et objets ───────────────────────────────

type V =
  | { t: 'nul' } | { t: 'bool'; v: boolean } | { t: 'num'; v: number } | { t: 'nom'; v: string } | { t: 'chaine'; v: Buffer }
  | { t: 'tab'; v: V[] } | { t: 'dict'; v: Map<string, V>; flux?: number } | { t: 'ref'; n: number; g: number } | { t: 'mot'; v: string };

const blanc = (c: number) => c === 0 || c === 9 || c === 10 || c === 12 || c === 13 || c === 32;
const delim = (c: number) => c === 0x28 || c === 0x29 || c === 0x3c || c === 0x3e || c === 0x5b || c === 0x5d || c === 0x7b || c === 0x7d || c === 0x2f || c === 0x25;
const chiffre = (c: number) => c >= 48 && c <= 57;
const hexa = (c: number) => (c >= 48 && c <= 57 ? c - 48 : c >= 65 && c <= 70 ? c - 55 : c >= 97 && c <= 102 ? c - 87 : -1);
const MAX_CHAINE = 64 * 1024;

/** Lecteur de valeurs PDF sur un tampon borné. */
class Lecteur {
  b: Buffer; p: number; jetons = 0;
  constructor(b: Buffer, p = 0) { this.b = b; this.p = p; }
  blancs(): void {
    const b = this.b;
    while (this.p < b.length) {
      const c = b[this.p];
      if (blanc(c)) { this.p++; continue; }
      if (c === 0x25) { while (this.p < b.length && b[this.p] !== 10 && b[this.p] !== 13) this.p++; continue; }
      break;
    }
  }
  /** Un mot (suite de caractères réguliers). */
  mot(): string {
    const d = this.p;
    while (this.p < this.b.length && !blanc(this.b[this.p]) && !delim(this.b[this.p]) && this.p - d < 256) this.p++;
    return this.b.toString('latin1', d, this.p);
  }
  entier(): number | undefined {
    this.blancs();
    const d = this.p;
    while (this.p < this.b.length && chiffre(this.b[this.p]) && this.p - d < 16) this.p++;
    if (this.p === d) return undefined;
    return Number(this.b.toString('latin1', d, this.p));
  }
  valeur(prof = 0): V {
    if (prof > 32) throw new ErreurFormat('PDF : objet trop imbriqué');
    if (++this.jetons > 200_000) throw new ErreurFormat('PDF : trop de jetons');
    this.blancs();
    const b = this.b;
    if (this.p >= b.length) throw new ErreurFormat('PDF : objet tronqué');
    const c = b[this.p];
    if (c === 0x2f) { this.p++; return { t: 'nom', v: this.nom() }; }
    if (c === 0x28) { this.p++; return { t: 'chaine', v: this.litterale() }; }
    if (c === 0x3c && b[this.p + 1] === 0x3c) {
      this.p += 2;
      const d = new Map<string, V>();
      for (let k = 0; ; k++) {
        if (k > 4096) throw new ErreurFormat('PDF : dictionnaire trop long');
        this.blancs();
        if (this.p >= b.length) throw new ErreurFormat('PDF : dictionnaire non fermé');
        if (b[this.p] === 0x3e && b[this.p + 1] === 0x3e) { this.p += 2; break; }
        if (b[this.p] !== 0x2f) throw new ErreurFormat('PDF : clé de dictionnaire attendue');
        this.p++;
        const cle = this.nom();
        d.set(cle, this.valeur(prof + 1));
      }
      return { t: 'dict', v: d };
    }
    if (c === 0x3c) { this.p++; return { t: 'chaine', v: this.hexa() }; }
    if (c === 0x5b) {
      this.p++;
      const t: V[] = [];
      for (;;) {
        this.blancs();
        if (this.p >= b.length) throw new ErreurFormat('PDF : tableau non fermé');
        if (b[this.p] === 0x5d) { this.p++; break; }
        if (t.length > 100_000) throw new ErreurFormat('PDF : tableau trop long');
        t.push(this.valeur(prof + 1));
      }
      return { t: 'tab', v: t };
    }
    if (chiffre(c) || c === 0x2b || c === 0x2d || c === 0x2e) {
      const d = this.p;
      this.p++;
      while (this.p < b.length && (chiffre(b[this.p]) || b[this.p] === 0x2e) && this.p - d < 32) this.p++;
      const v = Number(b.toString('latin1', d, this.p));
      // « n g R » : une référence.
      const garde = this.p;
      if (Number.isInteger(v) && v >= 0) {
        const g = this.entier();
        if (g !== undefined) { this.blancs(); if (b[this.p] === 0x52 && (this.p + 1 >= b.length || blanc(b[this.p + 1]) || delim(b[this.p + 1]))) { this.p++; return { t: 'ref', n: v, g }; } }
      }
      this.p = garde;
      return { t: 'num', v: Number.isFinite(v) ? v : 0 };
    }
    if (delim(c)) { this.p++; throw new ErreurFormat('PDF : caractère inattendu'); }
    const m = this.mot();
    if (m === 'true' || m === 'false') return { t: 'bool', v: m === 'true' };
    if (m === 'null') return { t: 'nul' };
    if (!m) { this.p++; throw new ErreurFormat('PDF : jeton vide'); }
    return { t: 'mot', v: m };
  }
  nom(): string {
    let r = '';
    const b = this.b;
    while (this.p < b.length && !blanc(b[this.p]) && !delim(b[this.p]) && r.length < 256) {
      if (b[this.p] === 0x23 && hexa(b[this.p + 1]) >= 0 && hexa(b[this.p + 2]) >= 0) { r += String.fromCharCode(hexa(b[this.p + 1]) * 16 + hexa(b[this.p + 2])); this.p += 3; }
      else { r += String.fromCharCode(b[this.p]); this.p++; }
    }
    return r;
  }
  litterale(): Buffer {
    const b = this.b, out: number[] = [];
    let niveau = 1;
    while (this.p < b.length) {
      const c = b[this.p++];
      if (c === 0x5c) {
        const e = b[this.p++];
        if (e === undefined) break;
        if (e === 0x6e) out.push(10); else if (e === 0x72) out.push(13); else if (e === 0x74) out.push(9);
        else if (e === 0x62) out.push(8); else if (e === 0x66) out.push(12);
        else if (e === 13) { if (b[this.p] === 10) this.p++; }
        else if (e === 10) { /* suite de ligne */ }
        else if (e >= 0x30 && e <= 0x37) {
          let v = e - 0x30;
          for (let k = 0; k < 2 && b[this.p] >= 0x30 && b[this.p] <= 0x37; k++) v = v * 8 + (b[this.p++] - 0x30);
          out.push(v & 255);
        } else out.push(e);
      } else if (c === 0x28) { niveau++; out.push(c); }
      else if (c === 0x29) { if (--niveau === 0) break; out.push(c); }
      else out.push(c);
      if (out.length > MAX_CHAINE) { while (this.p < b.length && niveau > 0) { const x = b[this.p++]; if (x === 0x5c) this.p++; else if (x === 0x28) niveau++; else if (x === 0x29) niveau--; } break; }
    }
    return Buffer.from(out);
  }
  hexa(): Buffer {
    const b = this.b, out: number[] = [];
    let haut = -1;
    while (this.p < b.length && b[this.p] !== 0x3e) {
      const h = hexa(b[this.p++]);
      if (h < 0) continue;
      if (haut < 0) haut = h; else { out.push(haut * 16 + h); haut = -1; }
      if (out.length > MAX_CHAINE) break;
    }
    if (haut >= 0) out.push(haut * 16);
    this.p++;
    return Buffer.from(out);
  }
}

/** PDFDocEncoding : les codes qui diffèrent du Latin-1. */
const PDFDOC: Record<number, string> = {
  0x18: '˘', 0x19: 'ˇ', 0x1a: 'ˆ', 0x1b: '˙', 0x1c: '˝', 0x1d: '˛', 0x1e: '˚', 0x1f: '˜',
  0x80: '•', 0x81: '†', 0x82: '‡', 0x83: '…', 0x84: '—', 0x85: '–', 0x86: 'ƒ', 0x87: '⁄', 0x88: '‹', 0x89: '›', 0x8a: '−', 0x8b: '‰',
  0x8c: '„', 0x8d: '“', 0x8e: '”', 0x8f: '‘', 0x90: '’', 0x91: '‚', 0x92: '™', 0x93: 'ﬁ', 0x94: 'ﬂ', 0x95: 'Ł', 0x96: 'Œ', 0x97: 'Š',
  0x98: 'Ÿ', 0x99: 'Ž', 0x9a: 'ı', 0x9b: 'ł', 0x9c: 'œ', 0x9d: 'š', 0x9e: 'ž', 0xa0: '€',
};
/** Une chaîne de texte PDF : UTF-16BE (FE FF), UTF-8 (EF BB BF) ou PDFDocEncoding. */
export function texteDePdf(b: Buffer): string {
  if (b[0] === 0xfe && b[1] === 0xff) return new TextDecoder('utf-16be', { fatal: false }).decode(b.subarray(2, 2 + ((b.length - 2) & ~1)));
  if (b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) return new TextDecoder('utf-8', { fatal: false }).decode(b.subarray(3));
  let r = '';
  for (const o of b) r += PDFDOC[o] ?? String.fromCharCode(o);
  return r;
}

/** Date PDF « D:AAAAMMJJHHmmSSOHH'mm' » (parties optionnelles), lue caractère par caractère. */
export function lireDatePdf(s0: string, role: DateLue['role'], maintenant: number): DateLue | undefined {
  let s = s0.trim();
  if (s.startsWith('D:')) s = s.slice(2);
  const n = (i: number, k: number): number | undefined => {
    if (i + k > s.length) return undefined;
    let v = 0;
    for (let j = 0; j < k; j++) { const c = s.charCodeAt(i + j) - 48; if (c < 0 || c > 9) return undefined; v = v * 10 + c; }
    return v;
  };
  const a = n(0, 4); if (a === undefined) return undefined;
  const p: { a: number; mo?: number; j?: number; h?: number; mi?: number; s?: number; fuseauMin?: number } = { a };
  let i = 4;
  const etapes: Array<'mo' | 'j' | 'h' | 'mi' | 's'> = ['mo', 'j', 'h', 'mi', 's'];
  for (const k of etapes) { const v = n(i, 2); if (v === undefined) break; p[k] = v; i += 2; }
  if (p.h !== undefined && p.mi === undefined) p.mi = 0;
  const z = s[i];
  if (p.h !== undefined && (z === '+' || z === '-' || z === 'Z')) {
    if (z === 'Z') p.fuseauMin = 0;
    else {
      const hh = n(i + 1, 2);
      let mm = 0;
      if (hh !== undefined) {
        let k = i + 3;
        if (s[k] === '\'') k++;
        mm = n(k, 2) ?? 0;
        p.fuseauMin = (z === '-' ? -1 : 1) * (hh * 60 + mm);
      }
    }
  }
  return dateDepuisParties(p, role, maintenant);
}

interface ObjetPdf { v: V; debutFlux?: number; finObjet: number }
type Entree = { genre: 1; decalage: number } | { genre: 2; flux: number; index: number };

class Pdf {
  src: Source; ctx: Contexte; f: FicheEnCours;
  table = new Map<number, Entree>();
  enCours = new Set<number>();
  suivies = 0;
  fluxObjets = new Map<number, { b: Buffer; premier: number; positions: Map<number, number> } | null>();
  trailer?: Map<string, V>;
  boucle = false;
  constructor(src: Source, f: FicheEnCours, ctx: Contexte) { this.src = src; this.f = f; this.ctx = ctx; }

  /** Lit l'objet « n g obj … » à un décalage (fenêtre de 64 Kio, élargie à 1 Mio si l'objet est plus long). */
  objetA(decalage: number): ObjetPdf {
    for (const fenetre of [64 * 1024, 1024 * 1024]) {
      const b = this.src.lire(decalage, fenetre);
      const l = new Lecteur(b);
      try {
        if (l.entier() === undefined || l.entier() === undefined) throw new ErreurFormat('PDF : en-tête d\'objet invalide');
        l.blancs();
        if (l.mot() !== 'obj') throw new ErreurFormat('PDF : « obj » attendu');
        const v = l.valeur();
        l.blancs();
        let debutFlux: number | undefined;
        if (v.t === 'dict' && b.toString('latin1', l.p, l.p + 6) === 'stream') {
          let q = l.p + 6;
          if (b[q] === 13) q++;
          if (b[q] === 10) q++;
          debutFlux = decalage + q;
        }
        return { v, debutFlux, finObjet: decalage + l.p };
      } catch (e) {
        if (b.length < fenetre || fenetre > 64 * 1024) throw e;
      }
    }
    throw new ErreurFormat('PDF : objet illisible');
  }

  /** Les octets décodés d'un flux (FlateDecode avec prédicteur PNG, ou brut), ≤ 16 Mio. */
  flux(d: Map<string, V>, debut: number): Buffer {
    const borne = this.ctx.budget.bornes.decompresse;
    let longueur = this.valeurDe(d.get('Length'));
    let n = longueur?.t === 'num' && longueur.v >= 0 && Number.isInteger(longueur.v) ? longueur.v : -1;
    if (n < 0 || debut + n > this.src.taille) {
      // Longueur absente ou fausse : chercher « endstream » (fenêtre bornée).
      const fen = this.src.lire(debut, Math.min(borne, this.src.taille - debut));
      const k = fen.indexOf('endstream');
      if (k < 0) throw new ErreurFormat('PDF : fin de flux introuvable');
      n = k;
    }
    if (n > borne) throw new ErreurFormat('PDF : flux trop long');
    const brut = this.src.lire(debut, n);
    longueur = undefined;
    const filtre = this.valeurDe(d.get('Filter'));
    const filtres = filtre?.t === 'nom' ? [filtre.v] : filtre?.t === 'tab' ? filtre.v.map((x) => (x.t === 'nom' ? x.v : '?')) : [];
    if (!filtres.length) return brut;
    if (filtres.length > 1 || (filtres[0] !== 'FlateDecode' && filtres[0] !== 'Fl')) throw new ErreurFormat(`PDF : filtre ${filtres.join('+').slice(0, 40)} non lu`);
    let out = gonfler(brut, borne);
    const parms = this.valeurDe(d.get('DecodeParms'));
    if (parms?.t === 'dict') {
      const pr = this.valeurDe(parms.v.get('Predictor')), col = this.valeurDe(parms.v.get('Columns'));
      if (pr?.t === 'num' && pr.v >= 10) out = predicteurPng(out, col?.t === 'num' && col.v > 0 && col.v <= 65_536 ? col.v : 1);
    }
    return out;
  }

  /** Résout une référence (Set des objets en cours ; 64 références suivies au plus). */
  valeurDe(v: V | undefined, prof = 0): V | undefined {
    if (!v || v.t !== 'ref') return v;
    if (prof > 8) { this.boucle = true; return undefined; }
    if (this.enCours.has(v.n)) { this.boucle = true; return undefined; }
    if (++this.suivies > 64) throw new ErreurFormat('PDF : trop de références suivies');
    this.ctx.budget.pas();
    const e = this.table.get(v.n);
    if (!e) return undefined;
    this.enCours.add(v.n);
    try {
      const o = this.objetNum(v.n, e);
      return o ? this.valeurDe(o.v, prof + 1) : undefined;
    } catch { return undefined; }
    finally { this.enCours.delete(v.n); }
  }
  objetNum(n: number, e: Entree): ObjetPdf | undefined {
    if (e.genre === 1) return this.objetA(e.decalage);
    // Objet rangé dans un flux d'objets.
    let fo = this.fluxObjets.get(e.flux);
    if (fo === undefined) {
      fo = null;
      const ef = this.table.get(e.flux);
      if (ef?.genre === 1 && !this.enCours.has(e.flux)) {
        const o = this.objetA(ef.decalage);
        if (o.v.t === 'dict' && o.debutFlux !== undefined) {
          const b = this.flux(o.v.v, o.debutFlux);
          const nb = this.valeurDe(o.v.v.get('N')), premier = this.valeurDe(o.v.v.get('First'));
          if (nb?.t === 'num' && premier?.t === 'num' && premier.v >= 0 && premier.v < b.length) {
            const positions = new Map<number, number>();
            const l = new Lecteur(b);
            for (let k = 0; k < Math.min(nb.v, 100_000); k++) {
              const num = l.entier(), dec = l.entier();
              if (num === undefined || dec === undefined) break;
              positions.set(num, dec);
            }
            fo = { b, premier: premier.v, positions };
          }
        }
      }
      this.fluxObjets.set(e.flux, fo);
    }
    if (!fo) return undefined;
    const dec = fo.positions.get(n);
    if (dec === undefined || fo.premier + dec >= fo.b.length) return undefined;
    const l = new Lecteur(fo.b, fo.premier + dec);
    return { v: l.valeur(), finObjet: 0 };
  }

  /** Table xref classique à un décalage ; rend le trailer. */
  xrefClassique(dec: number): Map<string, V> {
    const b = this.src.lire(dec, Math.min(this.src.taille - dec, 16 * 1024 * 1024));
    const l = new Lecteur(b);
    l.blancs();
    if (l.mot() !== 'xref') throw new ErreurFormat('PDF : table xref attendue');
    let total = 0;
    for (;;) {
      l.blancs();
      if (b.toString('latin1', l.p, l.p + 7) === 'trailer') { l.p += 7; break; }
      const debut = l.entier(), nb = l.entier();
      if (debut === undefined || nb === undefined) throw new ErreurFormat('PDF : table xref mal formée');
      for (let k = 0; k < nb; k++) {
        if (++total > 1_000_000) throw new ErreurFormat('PDF : table xref trop longue');
        const o = l.entier(), g = l.entier();
        l.blancs();
        const t = l.mot();
        if (o === undefined || g === undefined) throw new ErreurFormat('PDF : entrée xref invalide');
        if (t === 'n' && !this.table.has(debut + k) && o < this.src.taille) this.table.set(debut + k, { genre: 1, decalage: o });
      }
    }
    const t = l.valeur();
    if (t.t !== 'dict') throw new ErreurFormat('PDF : trailer invalide');
    return t.v;
  }

  /** Flux xref (PDF 1.5) : l'objet est lui-même le trailer. */
  xrefFlux(dec: number): Map<string, V> {
    const o = this.objetA(dec);
    if (o.v.t !== 'dict' || o.debutFlux === undefined) throw new ErreurFormat('PDF : flux xref attendu');
    const d = o.v.v;
    const b = this.flux(d, o.debutFlux);
    const w = d.get('W');
    if (w?.t !== 'tab' || w.v.length !== 3) throw new ErreurFormat('PDF : /W invalide');
    const ws = w.v.map((x) => (x.t === 'num' && Number.isInteger(x.v) && x.v >= 0 && x.v <= 8 ? x.v : -1));
    if (ws.some((x) => x < 0) || ws[0] + ws[1] + ws[2] === 0) throw new ErreurFormat('PDF : /W invalide');
    const largeur = ws[0] + ws[1] + ws[2];
    const taille = d.get('Size');
    const index = d.get('Index');
    const plages: number[] = index?.t === 'tab' ? index.v.map((x) => (x.t === 'num' ? x.v : 0)) : [0, taille?.t === 'num' ? taille.v : 0];
    const lireN = (p: number, n: number) => { let v = 0; for (let k = 0; k < n; k++) v = v * 256 + b[p + k]; return v; };
    let p = 0;
    for (let k = 0; k + 1 < plages.length; k += 2) {
      const debut = plages[k], nb = Math.min(plages[k + 1], 1_000_000);
      for (let i = 0; i < nb; i++) {
        if (p + largeur > b.length) return d;
        const genre = ws[0] ? lireN(p, ws[0]) : 1, a = lireN(p + ws[0], ws[1]), c = lireN(p + ws[0] + ws[1], ws[2]);
        p += largeur;
        const num = debut + i;
        if (this.table.has(num)) continue;
        if (genre === 1 && a < this.src.taille) this.table.set(num, { genre: 1, decalage: a });
        else if (genre === 2) this.table.set(num, { genre: 2, flux: a, index: c });
      }
    }
    return d;
  }

  /** Repli : tous les « n g obj » des 16 premiers Mio, et le dernier « trailer ». */
  balayer(): void {
    const b = this.src.lire(0, Math.min(this.src.taille, 16 * 1024 * 1024));
    let trouves = 0;
    let i = b.indexOf('obj', 0, 'latin1');
    while (i >= 0 && trouves < 200_000) {
      const apres = b[i + 3];
      if (i > 0 && blanc(b[i - 1]) && (apres === undefined || blanc(apres) || delim(apres))) {
        // Revenir : blancs, génération, blancs, numéro.
        let k = i - 1;
        while (k >= 0 && blanc(b[k])) k--;
        const finG = k + 1;
        while (k >= 0 && chiffre(b[k]) && finG - k <= 6) k--;
        if (k + 1 < finG) {
          const debG = k + 1;
          while (k >= 0 && blanc(b[k])) k--;
          const finN = k + 1;
          while (k >= 0 && chiffre(b[k]) && finN - k <= 11) k--;
          if (k + 1 < finN && debG > finN) {
            const num = Number(b.toString('latin1', k + 1, finN));
            if (Number.isSafeInteger(num)) { this.table.set(num, { genre: 1, decalage: k + 1 }); trouves++; }
          }
        }
      }
      i = b.indexOf('obj', i + 3, 'latin1');
    }
    if (!this.trailer) {
      const t = b.lastIndexOf('trailer', b.length, 'latin1');
      if (t >= 0) { try { const v = new Lecteur(b, t + 7).valeur(); if (v.t === 'dict') this.trailer = v.v; } catch { /* trailer illisible */ } }
    }
    if (!this.trailer) {
      // Flux xref sans table : chercher un objet qui porte /Root.
      let essais = 0;
      for (const e of [...this.table.values()].reverse()) {
        if (e.genre !== 1 || ++essais > 64) break;
        try { const o = this.objetA(e.decalage); if (o.v.t === 'dict' && o.v.v.has('Root')) { this.trailer = o.v.v; break; } } catch { /* suivant */ }
      }
    }
  }
}

/** Prédicteur PNG (filtres 0 à 4) sur des lignes de `colonnes` octets. */
function predicteurPng(b: Buffer, colonnes: number): Buffer {
  const ligne = colonnes + 1;
  const n = Math.floor(b.length / ligne);
  const out = Buffer.alloc(n * colonnes);
  for (let r = 0; r < n; r++) {
    const filtre = b[r * ligne];
    for (let c = 0; c < colonnes; c++) {
      const x = b[r * ligne + 1 + c];
      const gauche = c > 0 ? out[r * colonnes + c - 1] : 0;
      const haut = r > 0 ? out[(r - 1) * colonnes + c] : 0;
      const hg = r > 0 && c > 0 ? out[(r - 1) * colonnes + c - 1] : 0;
      let v = x;
      if (filtre === 1) v = x + gauche;
      else if (filtre === 2) v = x + haut;
      else if (filtre === 3) v = x + ((gauche + haut) >> 1);
      else if (filtre === 4) { const p = gauche + haut - hg, pa = Math.abs(p - gauche), pb = Math.abs(p - haut), pc = Math.abs(p - hg); v = x + (pa <= pb && pa <= pc ? gauche : pb <= pc ? haut : hg); }
      out[r * colonnes + c] = v & 255;
    }
  }
  return out;
}

const CLES_INFO: Record<string, string> = {
  Title: 'titre', Author: 'auteur_document', Subject: 'description', Keywords: 'mots_cles', Creator: 'logiciel',
};

function lirePdf(src: Source, f: FicheEnCours, ctx: Contexte): void {
  const pdf = new Pdf(src, f, ctx);
  // 1. Le dernier « startxref » des 64 derniers Kio, puis la chaîne des /Prev (16 au plus, sans revenir).
  const q0 = Math.max(0, src.taille - 64 * 1024);
  const q = src.lire(q0, src.taille - q0);
  const k = q.lastIndexOf('startxref', q.length, 'latin1');
  const vus = new Set<number>();
  let dec: number | undefined;
  if (k >= 0) { const l = new Lecteur(q, k + 9); dec = l.entier(); }
  let erreurXref: string | undefined;
  for (let n = 0; dec !== undefined && n < 16; n++) {
    if (vus.has(dec) || dec >= src.taille) { if (vus.has(dec)) remarque(f, 'PDF : chaîne de tables xref en boucle (boucle évitée)'); break; }
    vus.add(dec);
    let t: Map<string, V>;
    try {
      const tete = src.lire(dec, 4).toString('latin1');
      t = tete === 'xref' ? pdf.xrefClassique(dec) : pdf.xrefFlux(dec);
    } catch (e) { erreurXref = e instanceof ErreurFormat ? e.raison : 'table xref illisible'; break; }
    pdf.trailer ??= t;
    const stm = t.get('XRefStm');
    if (stm?.t === 'num' && !vus.has(stm.v)) { vus.add(stm.v); try { pdf.xrefFlux(stm.v); } catch { /* flux hybride illisible */ } }
    const prev = t.get('Prev');
    dec = prev?.t === 'num' && Number.isInteger(prev.v) && prev.v >= 0 ? prev.v : undefined;
  }
  if (erreurXref) remarque(f, `PDF : ${erreurXref} — objets cherchés directement dans le fichier`);
  if (!pdf.trailer || !pdf.table.size) pdf.balayer();
  if (!pdf.trailer) throw new ErreurFormat(erreurXref ? `PDF : ${erreurXref}` : 'PDF : trailer introuvable');

  const chiffre = pdf.trailer.has('Encrypt');
  if (chiffre) {
    ajouterChamp(f, ctx, 'chiffre', 'métadonnées chiffrées', 'PDF:/Encrypt');
    ajouterManque(f, { quoi: 'le titre, l\'auteur et les dates du document', raison: 'document chiffré : ses textes ne se lisent qu\'avec sa clé', code: 'illisible' });
  }
  // 2. /Info
  const info = pdf.valeurDe(pdf.trailer.get('Info'));
  if (info?.t === 'dict' && !chiffre) {
    let libres = 0;
    for (const [cle, v0] of info.v) {
      const v = pdf.valeurDe(v0);
      if (!v || v.t !== 'chaine') continue;
      const texte = texteDePdf(v.v);
      const source = `PDF:/Info/${cle.slice(0, 40)}`;
      if (cle === 'CreationDate' || cle === 'ModDate') {
        const role = cle === 'CreationDate' ? 'création du fichier' : 'modification';
        const d = lireDatePdf(texte, role, ctx.maintenant);
        if (d) ajouterDate(f, ctx, cle === 'CreationDate' ? 'date_creation_fichier' : 'date_modification', d, source);
        else if (texte.trim()) remarque(f, `PDF : date ${cle} illisible`);
      } else if (CLES_INFO[cle]) ajouterChamp(f, ctx, CLES_INFO[cle], texte, source);
      else if (cle === 'Producer') ajouterChamp(f, ctx, 'x:producteur_pdf', texte, source, { nom: 'Producteur PDF', groupe: 'logiciel' });
      else if (cle !== 'Trapped' && libres++ < 64) ajouterChamp(f, ctx, `x:${cle.slice(0, 64)}`, texte, source, { nom: cle.slice(0, 64), groupe: 'document' });
    }
  }
  // 3. Catalogue : /Lang, /Metadata, /Pages /Count.
  const racine = pdf.valeurDe(pdf.trailer.get('Root'));
  if (racine?.t === 'dict') {
    const lang = pdf.valeurDe(racine.v.get('Lang'));
    if (lang?.t === 'chaine' && !chiffre) {
      const t = nettoyerTexte(texteDePdf(lang.v)).texte;
      const code = versBcp47(t);
      if (code) { ajouterChamp(f, ctx, 'langue_declaree', code, 'PDF:/Lang', { brut: code }); ajouterLangue(f, code, 'PDF:/Lang'); }
    }
    const pages = pdf.valeurDe(racine.v.get('Pages'));
    if (pages?.t === 'dict') {
      const n = pdf.valeurDe(pages.v.get('Count'));
      if (n?.t === 'num' && Number.isInteger(n.v) && n.v >= 0 && n.v <= 10_000_000) ajouterChamp(f, ctx, 'pages', String(n.v), 'PDF:/Pages/Count', { brut: n.v });
    }
    const meta = racine.v.get('Metadata');
    if (meta?.t === 'ref' && !chiffre) {
      const e = pdf.table.get(meta.n);
      if (e?.genre === 1) {
        try {
          const o = pdf.objetA(e.decalage);
          if (o.v.t === 'dict' && o.debutFlux !== undefined) {
            const b = pdf.flux(o.v.v, o.debutFlux);
            if (b.length <= ctx.budget.bornes.xmp) lireXmp(b.toString('utf8'), f, ctx, 'XMP');
          }
        } catch (x) { remarque(f, `PDF : XMP illisible (${x instanceof ErreurFormat ? x.raison : 'structure invalide'})`); }
      }
    }
  }
  if (pdf.boucle) { remarque(f, 'PDF : références circulaires (boucle évitée)'); f.partiel ??= 'PDF : références circulaires (boucle évitée)'; }
  if (erreurXref && erreurXref.includes('décompression suspecte')) f.partiel ??= `PDF : ${erreurXref}`;
}

// ─────────────────────────────── OOXML, ODF, EPUB ───────────────────────────────

function entree(entrees: EntreeZip[], nom: string): EntreeZip | undefined { return entrees.find((e) => e.nom === nom); }
function xmlDe(src: Source, e: EntreeZip, ctx: Contexte): NoeudXml | undefined {
  try {
    const b = lireEntreeZip(src, e, 1024 * 1024);
    let t = b.toString('utf8');
    if (t.charCodeAt(0) === 0xfeff) t = t.slice(1);
    return lireXml(t, { profondeur: ctx.budget.bornes.profondeurXml, maxNoeuds: 20_000 });
  } catch { return undefined; }
}
/** Les éléments (profondeur quelconque, bornée) sous un nœud. */
function elements(n: NoeudXml, max = 5000): NoeudXml[] {
  const r: NoeudXml[] = [];
  const pile = [...n.enfants];
  while (pile.length && r.length < max) { const x = pile.shift()!; r.push(x); pile.push(...x.enfants); }
  return r;
}
function dateIso(f: FicheEnCours, ctx: Contexte, cle: string, texte: string, role: DateLue['role'], source: string): void {
  const d = lireDateIso(texte, role, ctx.maintenant);
  if (d) ajouterDate(f, ctx, cle, d, source);
}

function lireOoxml(src: Source, f: FicheEnCours, ctx: Contexte): void {
  const z = listerZip(src);
  const core = entree(z.entrees, 'docProps/core.xml'), app = entree(z.entrees, 'docProps/app.xml');
  if (!core && !app) { ajouterManque(f, { quoi: 'les propriétés du document', raison: 'absent du fichier', code: 'absent' }); return; }
  const c = core && xmlDe(src, core, ctx);
  if (c) for (const n of elements(c)) {
    const t = n.texte.trim(), s = `OOXML:core:${n.local}`;
    if (!t) continue;
    switch (n.local) {
      case 'title': ajouterChamp(f, ctx, 'titre', t, s); break;
      case 'subject': ajouterChamp(f, ctx, 'description', t, s); break;
      case 'creator': ajouterChamp(f, ctx, 'auteur_document', t, s); break;
      case 'keywords': ajouterChamp(f, ctx, 'mots_cles', t, s); break;
      case 'description': ajouterChamp(f, ctx, 'commentaire', t, s); break;
      case 'lastModifiedBy': ajouterChamp(f, ctx, 'modifie_par', t, s); break;
      case 'category': ajouterChamp(f, ctx, 'x:categorie', t, s, { nom: 'Catégorie', groupe: 'document' }); break;
      case 'language': { const code = versBcp47(t); if (code) { ajouterChamp(f, ctx, 'langue_declaree', code, s, { brut: code }); ajouterLangue(f, code, s); } break; }
      case 'created': dateIso(f, ctx, 'date_creation_fichier', t, 'création du fichier', s); break;
      case 'modified': dateIso(f, ctx, 'date_modification', t, 'modification', s); break;
      default: break;
    }
  }
  const a = app && xmlDe(src, app, ctx);
  if (a) for (const n of elements(a)) {
    const t = n.texte.trim(), s = `OOXML:app:${n.local}`;
    if (!t || n.enfants.length) continue;
    switch (n.local) {
      case 'Application': ajouterChamp(f, ctx, 'logiciel', t, s); break;
      case 'Company': ajouterChamp(f, ctx, 'entreprise', t, s); break;
      case 'Pages': ajouterChamp(f, ctx, 'pages', t, s, { brut: Number(t) || t }); break;
      case 'Words': ajouterChamp(f, ctx, 'mots', t, s, { brut: Number(t) || t }); break;
      case 'Slides': ajouterChamp(f, ctx, 'x:diapositives', t, s, { nom: 'Diapositives', groupe: 'document' }); break;
      case 'Manager': ajouterChamp(f, ctx, 'x:responsable', t, s, { nom: 'Responsable', groupe: 'document', sensible: true }); break;
      default: break;
    }
  }
}

function lireOdf(src: Source, f: FicheEnCours, ctx: Contexte): void {
  const z = listerZip(src);
  const m = entree(z.entrees, 'meta.xml');
  const x = m && xmlDe(src, m, ctx);
  if (!x) { ajouterManque(f, { quoi: 'les propriétés du document', raison: 'absent du fichier', code: 'absent' }); return; }
  const mots: string[] = [];
  for (const n of elements(x)) {
    const t = n.texte.trim(), s = `ODF:meta:${n.local}`;
    switch (n.local) {
      case 'title': ajouterChamp(f, ctx, 'titre', t, s); break;
      case 'description': ajouterChamp(f, ctx, 'commentaire', t, s); break;
      case 'subject': ajouterChamp(f, ctx, 'description', t, s); break;
      case 'keyword': if (t && mots.length < 256) mots.push(t); break;
      case 'initial-creator': ajouterChamp(f, ctx, 'auteur_document', t, s); break;
      case 'creator': ajouterChamp(f, ctx, 'modifie_par', t, s); break;
      case 'language': { const code = versBcp47(t); if (code) { ajouterChamp(f, ctx, 'langue_declaree', code, s, { brut: code }); ajouterLangue(f, code, s); } break; }
      case 'creation-date': dateIso(f, ctx, 'date_creation_fichier', t, 'création du fichier', s); break;
      case 'date': dateIso(f, ctx, 'date_modification', t, 'modification', s); break;
      case 'generator': ajouterChamp(f, ctx, 'logiciel', t, s); break;
      case 'document-statistic':
        for (const at of n.attrs) {
          if (at.local === 'page-count') ajouterChamp(f, ctx, 'pages', at.valeur, `${s}/page-count`, { brut: Number(at.valeur) || at.valeur });
          else if (at.local === 'word-count') ajouterChamp(f, ctx, 'mots', at.valeur, `${s}/word-count`, { brut: Number(at.valeur) || at.valeur });
        }
        break;
      default: break;
    }
  }
  if (mots.length) ajouterChamp(f, ctx, 'mots_cles', mots.join(' ; '), 'ODF:meta:keyword', { valeurs: mots });
}

function lireEpub(src: Source, f: FicheEnCours, ctx: Contexte): void {
  const z = listerZip(src);
  let chemin: string | undefined;
  const cont = entree(z.entrees, 'META-INF/container.xml');
  const cx = cont && xmlDe(src, cont, ctx);
  if (cx) for (const n of elements(cx)) if (n.local === 'rootfile') { chemin = n.attrs.find((a) => a.local === 'full-path')?.valeur; if (chemin) break; }
  const opf = (chemin && entree(z.entrees, chemin)) || z.entrees.find((e) => e.nom.toLowerCase().endsWith('.opf'));
  const x = opf && xmlDe(src, opf, ctx);
  if (!x) { ajouterManque(f, { quoi: 'les propriétés du livre', raison: 'paquet OPF absent ou illisible', code: 'absent' }); return; }
  const auteurs: string[] = [];
  for (const n of elements(x)) {
    const t = n.texte.trim(), s = `EPUB:opf:${n.local}`;
    if (!t) continue;
    switch (n.local) {
      case 'title': ajouterChamp(f, ctx, 'titre', t, s, { langue: versBcp47(n.lang) }); break;
      case 'creator': if (auteurs.length < 64) auteurs.push(t); break;
      case 'language': { const code = versBcp47(t); if (code) { ajouterChamp(f, ctx, 'langue_declaree', code, s, { brut: code }); ajouterLangue(f, code, s); } break; }
      case 'publisher': ajouterChamp(f, ctx, 'x:editeur', t, s, { nom: 'Éditeur', groupe: 'droits et diffusion' }); break;
      case 'date': dateIso(f, ctx, 'date_parution', t, 'parution', s); break;
      case 'identifier': ajouterChamp(f, ctx, 'identifiant', t, s); break;
      case 'description': ajouterChamp(f, ctx, 'description', t, s); break;
      case 'subject': ajouterChamp(f, ctx, 'mots_cles', t, s); break;
      case 'rights': ajouterChamp(f, ctx, 'droits', t, s); break;
      case 'contributor': ajouterChamp(f, ctx, 'x:contributeur', t, s, { nom: 'Contributeur', groupe: 'personnes' }); break;
      default: break;
    }
  }
  if (auteurs.length) ajouterChamp(f, ctx, 'auteur_document', auteurs.join(' ; '), 'EPUB:opf:creator', { valeurs: auteurs });
}
