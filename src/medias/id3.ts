// Médias reçus : ID3v2.2 / 2.3 / 2.4, ID3v1 / 1.1, APEv2, Lyrics3 (repéré). La désynchronisation est défaite sur une
// COPIE bornée ; le bogue courant des balises 2.4 écrites avec des tailles 2.3 est reconnu ; les trames chiffrées sont
// ignorées, les compressées décompressées (bornées). En 2.3, « / » n'est PAS un séparateur ; en 2.4, NUL l'est.

import type { Contexte, FicheEnCours, ImageJointe } from './contrat.ts';
import { ErreurFormat } from './contrat.ts';
import { ajouterChamp, ajouterChampOctets, ajouterDate, ajouterImage, ajouterIsrc, ajouterLangue, ajouterTexteInclus, dimensionsImage, formatImage, remarque } from './champs.ts';
import { dateDepuisParties, lireDateIso } from './dates.ts';
import { versBcp47 } from './langues-codes.ts';
import { gonfler, nettoyerTexte, type Source } from './octets.ts';

/** Genres ID3v1 0–191 (liste publique de Winamp). */
export const GENRES_ID3: string[] = ('Blues|Classic Rock|Country|Dance|Disco|Funk|Grunge|Hip-Hop|Jazz|Metal|New Age|Oldies|Other|Pop|R&B|Rap|Reggae|Rock|Techno|'
  + 'Industrial|Alternative|Ska|Death Metal|Pranks|Soundtrack|Euro-Techno|Ambient|Trip-Hop|Vocal|Jazz+Funk|Fusion|Trance|Classical|Instrumental|Acid|House|'
  + 'Game|Sound Clip|Gospel|Noise|AlternRock|Bass|Soul|Punk|Space|Meditative|Instrumental Pop|Instrumental Rock|Ethnic|Gothic|Darkwave|Techno-Industrial|'
  + 'Electronic|Pop-Folk|Eurodance|Dream|Southern Rock|Comedy|Cult|Gangsta|Top 40|Christian Rap|Pop/Funk|Jungle|Native American|Cabaret|New Wave|Psychadelic|'
  + 'Rave|Showtunes|Trailer|Lo-Fi|Tribal|Acid Punk|Acid Jazz|Polka|Retro|Musical|Rock & Roll|Hard Rock|Folk|Folk-Rock|National Folk|Swing|Fast Fusion|Bebob|'
  + 'Latin|Revival|Celtic|Bluegrass|Avantgarde|Gothic Rock|Progressive Rock|Psychedelic Rock|Symphonic Rock|Slow Rock|Big Band|Chorus|Easy Listening|Acoustic|'
  + 'Humour|Speech|Chanson|Opera|Chamber Music|Sonata|Symphony|Booty Bass|Primus|Porn Groove|Satire|Slow Jam|Club|Tango|Samba|Folklore|Ballad|Power Ballad|'
  + 'Rhythmic Soul|Freestyle|Duet|Punk Rock|Drum Solo|A capella|Euro-House|Dance Hall|Goa|Drum & Bass|Club-House|Hardcore|Terror|Indie|BritPop|Afro-Punk|'
  + 'Polsk Punk|Beat|Christian Gangsta Rap|Heavy Metal|Black Metal|Crossover|Contemporary Christian|Christian Rock|Merengue|Salsa|Thrash Metal|Anime|JPop|'
  + 'Synthpop|Abstract|Art Rock|Baroque|Bhangra|Big Beat|Breakbeat|Chillout|Downtempo|Dub|EBM|Eclectic|Electro|Electroclash|Emo|Experimental|Garage|Global|'
  + 'IDM|Illbient|Industro-Goth|Jam Band|Krautrock|Leftfield|Lounge|Math Rock|New Romantic|Nu-Breakz|Post-Punk|Post-Rock|Psytrance|Shoegaze|Space Rock|'
  + 'Trop Rock|World Music|Neoclassical|Audiobook|Audio Theatre|Neue Deutsche Welle|Podcast|Indie Rock|G-Funk|Dubstep|Garage Rock|Psybient').split('|');

const TYPES_IMAGE: Record<number, ImageJointe['role']> = { 3: 'pochette recto', 4: 'pochette verso', 7: 'artiste', 8: 'artiste' };
const V22: Record<string, string> = {
  TT1: 'TIT1', TT2: 'TIT2', TT3: 'TIT3', TAL: 'TALB', TOT: 'TOAL', TP1: 'TPE1', TP2: 'TPE2', TP3: 'TPE3', TP4: 'TPE4', TCM: 'TCOM', TXT: 'TEXT',
  TOA: 'TOPE', TCO: 'TCON', TRK: 'TRCK', TPA: 'TPOS', TCP: 'TCMP', TPB: 'TPUB', TCR: 'TCOP', TRC: 'TSRC', TYE: 'TYER', TDA: 'TDAT', TIM: 'TIME',
  TOR: 'TORY', TSS: 'TSSE', TEN: 'TENC', TLA: 'TLAN', TBP: 'TBPM', TKE: 'TKEY', TMT: 'TMED', TXX: 'TXXX', COM: 'COMM', ULT: 'USLT', SLT: 'SYLT',
  PIC: 'APIC', POP: 'POPM', UFI: 'UFID', GEO: 'GEOB', IPL: 'IPLS', TLE: 'TLEN', WXX: 'WXXX',
};
const TEXTE: Record<string, string> = {
  TIT1: 'regroupement', TIT2: 'titre', TIT3: 'sous_titre', TALB: 'album', TOAL: 'album_origine', TPE1: 'artiste', TPE2: 'artiste_album', TPE3: 'chef',
  TPE4: 'remix', TCOM: 'compositeur', TEXT: 'parolier', TOPE: 'artiste_origine', TPUB: 'label', TCOP: 'droits', TPRO: 'production_droits', TSSE: 'logiciel',
  TENC: 'logiciel', TBPM: 'tempo', TKEY: 'tonalite', TMOO: 'humeur', TMED: 'support', TOWN: 'proprietaire_fichier', TRCK: 'piste', TPOS: 'disque',
  TSST: 'x:Sous-titre du disque', TOFN: 'x:Fichier d\'origine', TFLT: 'x:Type de fichier', TOLY: 'parolier', TRSN: 'x:Radio', TRSO: 'x:Propriétaire de la radio',
};
const TXXX: Record<string, string> = {
  LABEL: 'label', PUBLISHER: 'label', ORGANIZATION: 'label', DISTRIBUTOR: 'distributeur', BARCODE: 'code_barres', UPC: 'code_barres', EAN: 'code_barres',
  CATALOGNUMBER: 'catalogue', 'CATALOG NUMBER': 'catalogue', ARTISTS: 'artiste', LANGUAGE: 'langue_declaree', ISRC: 'isrc', LYRICIST: 'parolier',
  ORIGINALDATE: 'date_origine', ORIGINALYEAR: 'date_origine', CONDUCTOR: 'chef', REMIXER: 'remix', ARRANGER: 'arrangeur', PRODUCER: 'producteur',
  ENGINEER: 'ingenieur', MOOD: 'humeur', LICENSE: 'licence', COPYRIGHT: 'droits', ALBUMARTIST: 'artiste_album', 'ALBUM ARTIST': 'artiste_album',
  SUBTITLE: 'sous_titre', MEDIA: 'support', COMPOSER: 'compositeur', DISCOGS_LABEL: 'label',
};
const RANG_TXXX: Record<string, number> = { PUBLISHER: 1, ORGANIZATION: 2 };
const COMM_TECHNIQUES = ['ITUNNORM', 'ITUNSMPB', 'ITUNPGAP', 'ITUNES_CDDB'];
const ENC = ['latin1', 'utf-16', 'utf-16be', 'utf-8'];

const idValide = (b: Buffer, p: number, n: number) => { for (let i = 0; i < n; i++) { const c = b[p + i]; if (!((c >= 0x41 && c <= 0x5a) || (c >= 0x30 && c <= 0x39))) return false; } return true; };

/** Défait la désynchronisation (FF 00 → FF) ; garde les positions des octets retirés (pour retrouver une image). */
export function desynchroniser(b: Buffer): { out: Buffer; sauts: number[] } {
  const out = Buffer.allocUnsafe(b.length);
  const sauts: number[] = [];
  let k = 0;
  for (let i = 0; i < b.length; i++) {
    out[k++] = b[i];
    if (b[i] === 0xff && b[i + 1] === 0x00) { i++; sauts.push(k); }
  }
  return { out: out.subarray(0, k), sauts };
}
/** Position dans l'original d'une position dans la copie désynchronisée. */
function versOriginal(d: number, sauts: number[]): number {
  let lo = 0, hi = sauts.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (sauts[m] <= d) lo = m + 1; else hi = m; }
  return d + lo;
}

/** Décode un texte d'une trame (encodage 0–3), en coupant ou en séparant aux NUL. */
function textes(b: Buffer, enc: number, version: number): { valeurs: string[]; douteux: boolean; brut: Buffer } {
  const nom = ENC[enc] ?? 'latin1';
  let t: string;
  if (enc === 1) {
    if (b.length >= 2 && b[0] === 0xfe && b[1] === 0xff) t = new TextDecoder('utf-16be').decode(b.subarray(2));
    else t = new TextDecoder('utf-16le').decode(b.length >= 2 && b[0] === 0xff && b[1] === 0xfe ? b.subarray(2) : b);
    // BOM possibles devant chaque valeur suivante
    t = t.split('﻿').join('').split('￾').join('');
  } else t = new TextDecoder(nom).decode(b);
  let douteux = false;
  if (enc === 0) for (const o of b) if (o >= 0x80) { douteux = true; break; }
  const parties = version >= 4 ? t.split('\0') : [t.split('\0')[0]];
  return { valeurs: parties.map((x) => nettoyerTexte(x).texte).filter(Boolean), douteux, brut: b };
}

/** Coupe « encodage + chaîne terminée » ; rend la chaîne et la suite. */
function chaineTerminee(b: Buffer, p: number, enc: number): { texte: string; suite: number } {
  const large = enc === 1 || enc === 2;
  let q = p;
  if (large) { while (q + 1 < b.length && !(b[q] === 0 && b[q + 1] === 0)) q += 2; }
  else { while (q < b.length && b[q] !== 0) q++; }
  const brut = b.subarray(p, Math.min(q, b.length));
  return { texte: textes(brut, enc, 3).valeurs[0] ?? '', suite: Math.min(b.length, q + (large ? 2 : 1)) };
}

/** Taille d'une balise ID3v2 à `pos` (en-tête compris, pied compris) ; undefined si ce n'en est pas une. */
export function tailleId3(h: Buffer, p = 0): number | undefined {
  if (h.length < p + 10 || h.toString('latin1', p, p + 3) !== 'ID3') return undefined;
  if (h[p + 3] === 0xff || h[p + 4] === 0xff) return undefined;
  let t = 0;
  for (let i = 0; i < 4; i++) { const o = h[p + 6 + i]; if (o & 0x80) return undefined; t = (t << 7) | o; }
  return 10 + t + (h[p + 5] & 0x10 ? 10 : 0);
}

/** Lit une balise ID3v2 à `pos` dans le fichier. Rend sa longueur totale (0 si absente). */
export function lireId3v2(src: Source, pos: number, f: FicheEnCours, ctx: Contexte, o: { teteFichier?: boolean } = {}): number {
  const h = src.lire(pos, 10);
  if (h.length < 10 || h.toString('latin1', 0, 3) !== 'ID3') return 0;
  const version = h[3], drapeaux = h[5];
  let taille = 0;
  for (let i = 0; i < 4; i++) { const x = h[6 + i]; if (x & 0x80) throw new ErreurFormat('ID3 : taille non syncsafe'); taille = (taille << 7) | x; }
  const total = 10 + taille + (drapeaux & 0x10 ? 10 : 0);
  if (version < 2 || version > 4) { remarque(f, `balise ID3v2.${version} inconnue, ignorée`); return total; }
  if (taille > ctx.budget.bornes.id3Taille) throw new ErreurFormat('ID3 : balise plus grande que 32 Mio');
  if (pos + 10 + taille > src.taille) throw new ErreurFormat('ID3 : balise plus longue que le fichier');
  const V = `ID3v2.${version}`;
  let corps = src.lire(pos + 10, taille);
  let sauts: number[] | undefined;
  if (version <= 3 && drapeaux & 0x80) { const d = desynchroniser(corps); corps = d.out; sauts = d.sauts; }
  let p = 0;
  if (drapeaux & 0x40 && version >= 3) {
    if (version === 3) p = 4 + corps.readUInt32BE(0);
    else { let t = 0; for (let i = 0; i < 4; i++) t = (t << 7) | (corps[i] & 0x7f); p = t; }
    if (p > corps.length) throw new ErreurFormat('ID3 : en-tête étendu trop long');
  }
  const enteteTrame = version === 2 ? 6 : 10, lid = version === 2 ? 3 : 4;
  const tailleTrame = (q: number, u32: boolean) => version === 2 ? corps.readUIntBE(q + 3, 3)
    : version === 3 || u32 ? corps.readUInt32BE(q + 4) : ((corps[q + 4] & 0x7f) << 21) | ((corps[q + 5] & 0x7f) << 14) | ((corps[q + 6] & 0x7f) << 7) | (corps[q + 7] & 0x7f);
  // Bogue 2.4 : tailles écrites en u32.
  let u32 = false;
  if (version === 4) {
    const marche = (en32: boolean) => {
      let q = p, n = 0;
      while (q + enteteTrame <= corps.length && n++ < 64) {
        if (corps[q] === 0) return true;
        if (!idValide(corps, q, lid)) return false;
        if (!en32) for (let i = 4; i < 8; i++) if (corps[q + i] & 0x80) return false;
        const t = tailleTrame(q, en32);
        q += enteteTrame + t;
        if (q > corps.length) return false;
      }
      return q === corps.length || q + enteteTrame > corps.length || n >= 64;
    };
    if (!marche(false) && marche(true)) { u32 = true; remarque(f, 'balise mal écrite (tailles ID3v2.3 dans une balise 2.4)'); }
  }
  let annee: string | undefined, jourMois: string | undefined, heure: string | undefined;
  let n = 0;
  while (p + enteteTrame <= corps.length) {
    if (corps[p] === 0) break;       // bourrage
    if (++n > ctx.budget.bornes.id3Trames) { remarque(f, 'ID3 : trop de trames'); break; }
    ctx.budget.pas();
    if (!idValide(corps, p, lid)) throw new ErreurFormat(`${V} : identifiant de trame invalide`);
    let id = corps.toString('latin1', p, p + lid);
    const t = tailleTrame(p, u32);
    const fl = version === 2 ? 0 : corps[p + 9];
    const debut = p + enteteTrame;
    if (debut + t > corps.length) throw new ErreurFormat(`${V} : trame ${id} plus longue que la balise`);
    let d = corps.subarray(debut, debut + t);
    let posFichier: number | undefined = sauts ? undefined : pos + 10 + debut;
    let sautsTrame: number[] | undefined;
    p = debut + t;
    if (version === 2) id = V22[id] ?? id;
    // Drapeaux de format.
    if (version === 3) {
      if (fl & 0x40) continue;                         // chiffrée
      let q = 0;
      const comp = fl & 0x80;
      if (comp) q += 4;
      if (fl & 0x20) q += 1;
      d = d.subarray(q);
      if (comp) { try { d = gonfler(d, ctx.budget.bornes.decompresse); posFichier = undefined; } catch { remarque(f, `${V} : trame ${id} compressée illisible`); continue; } }
      else if (posFichier !== undefined) posFichier += q;
    } else if (version === 4) {
      if (fl & 0x04) continue;
      let q = 0;
      if (fl & 0x40) q += 1;
      if (fl & 0x01) q += 4;
      d = d.subarray(q);
      if (posFichier !== undefined) posFichier += q;
      if (fl & 0x02 || drapeaux & 0x80) { const x = desynchroniser(d); d = x.out; sautsTrame = x.sauts; }
      if (fl & 0x08) { try { d = gonfler(d, ctx.budget.bornes.decompresse); posFichier = undefined; } catch { remarque(f, `${V} : trame ${id} compressée illisible`); continue; } }
    }
    if (!d.length) continue;
    const src2 = `${V}:${id}`;
    const enc = d[0];
    if (id === 'TXXX') {
      const desc = chaineTerminee(d, 1, enc);
      const v = textes(d.subarray(desc.suite), enc, version);
      const D = desc.texte.toUpperCase();
      if (!v.valeurs.length) continue;
      const cle = TXXX[D] ?? (D.startsWith('MUSICBRAINZ') ? 'identifiant' : `x:${desc.texte.slice(0, 64)}`);
      const s = `${V}:TXXX:${desc.texte.slice(0, 40)}`;
      if (cle === 'isrc') ajouterIsrc(f, ctx, v.valeurs[0], s);
      else if (cle === 'langue_declaree') { const c = versBcp47(v.valeurs[0]); if (c) { ajouterChamp(f, ctx, cle, c, s); ajouterLangue(f, c, s); } }
      else if (cle === 'date_origine') ajouterDate(f, ctx, cle, lireDateIso(v.valeurs[0], 'parution originale', ctx.maintenant), s);
      else ajouterChamp(f, ctx, cle, v.valeurs[0], s, {
        valeurs: v.valeurs, nom: cle.startsWith('x:') ? desc.texte.slice(0, 64) : undefined, groupe: cle.startsWith('x:') ? (D.startsWith('REPLAYGAIN') ? 'technique' : 'œuvre') : undefined,
        sousRang: RANG_TXXX[D] ?? 0, encodageDouteux: v.douteux,
      });
      continue;
    }
    if (id === 'COMM' || id === 'USLT') {
      if (d.length < 4) continue;
      const langue = versBcp47(d.toString('latin1', 1, 4));
      const desc = chaineTerminee(d, 4, enc);
      const v = textes(d.subarray(desc.suite), enc, 3);
      const texte = v.valeurs[0];
      if (!texte) continue;
      if (id === 'USLT') { ajouterTexteInclus(f, { genre: 'paroles', texte, langue, source: src2 }); continue; }
      const D = desc.texte.toUpperCase();
      if (COMM_TECHNIQUES.some((x) => D.startsWith(x))) continue;
      ajouterChamp(f, ctx, 'commentaire', texte, src2, { langue, encodageDouteux: v.douteux });
      if (texte.length > 200) ajouterTexteInclus(f, { genre: 'commentaire', texte, langue, source: src2 });
      continue;
    }
    if (id === 'SYLT') {
      if (d.length < 6) continue;
      const langue = versBcp47(d.toString('latin1', 1, 4));
      const format = d[4];
      const desc = chaineTerminee(d, 6, enc);
      const lignes: Array<{ tSec: number; texte: string }> = [];
      let q = desc.suite;
      while (q < d.length && lignes.length < ctx.budget.bornes.syltPaires) {
        const c = chaineTerminee(d, q, enc);
        if (c.suite + 4 > d.length) break;
        const tps = d.readUInt32BE(c.suite);
        q = c.suite + 4;
        lignes.push({ tSec: format === 2 ? tps / 1000 : tps, texte: c.texte });
      }
      if (format !== 2) remarque(f, 'paroles synchronisées en trames : temps non convertis');
      if (lignes.length) ajouterTexteInclus(f, { genre: 'paroles synchronisées', texte: lignes.map((l) => l.texte).join('\n'), langue, source: src2, lignes: format === 2 ? lignes : undefined });
      continue;
    }
    if (id === 'APIC') {
      let q = 1, mime = '';
      if (version === 2) { mime = `image/${d.toString('latin1', 1, 4).toLowerCase()}`; q = 4; }
      else { const m = chaineTerminee(d, 1, 0); mime = m.texte; q = m.suite; }
      const type = d[q];
      const desc = chaineTerminee(d, q + 1, enc);
      const img = d.subarray(desc.suite);
      if (!img.length || img.length > ctx.budget.bornes.imageJointe) continue;
      const i: ImageJointe = { role: TYPES_IMAGE[type] ?? (type === 0 ? 'autre' : 'autre'), format: formatImage(img), mimeDeclare: mime || undefined, ...dimensionsImage(img), description: desc.texte || undefined, decalage: 0, taille: img.length, codage: 'brut' };
      const debutImg = desc.suite;
      if (posFichier !== undefined && !sautsTrame) { i.decalage = posFichier + debutImg; }
      else if (sautsTrame && posFichier !== undefined) {
        // Désynchronisée par trame (2.4) : les octets bruts vont de l'image jusqu'à la fin de la trame.
        const a = versOriginal(debutImg, sautsTrame), z = versOriginal(d.length - 1, sautsTrame) + 1;
        i.decalage = posFichier + a; i.taille = z - a; i.codage = 'désynchronisé';
      } else if (sauts && o.teteFichier && !sautsTrame && version <= 3) {
        const dans = debut + (d.byteOffset - corps.subarray(debut).byteOffset) + debutImg;
        const a = versOriginal(dans, sauts), z = versOriginal(dans + img.length - 1, sauts) + 1;
        i.decalage = pos + 10 + a; i.taille = z - a; i.codage = 'désynchronisé';
      } else { remarque(f, 'pochette dans une trame compressée : non extractible'); continue; }
      ajouterImage(f, i);
      continue;
    }
    if (id === 'POPM') {
      const c = chaineTerminee(d, 0, 0);
      if (c.suite < d.length) ajouterChamp(f, ctx, 'note_ecoute', `${d[c.suite]}/255`, src2, { brut: d[c.suite] });
      if (c.texte) ajouterChamp(f, ctx, 'x:popm_compte', c.texte, src2, { nom: 'Compte de la note', groupe: 'personnes', sensible: true });
      continue;
    }
    if (id === 'UFID') { const c = chaineTerminee(d, 0, 0); const v = nettoyerTexte(d.subarray(c.suite), 'latin1').texte; if (v) ajouterChamp(f, ctx, 'identifiant', `${c.texte ? `${c.texte} : ` : ''}${v}`, src2); continue; }
    if (id === 'GEOB') { const m = chaineTerminee(d, 1, 0); const nom = chaineTerminee(d, m.suite, enc); remarque(f, `fichier joint dans la balise : ${nom.texte || 'sans nom'}`); continue; }
    if (id === 'CHAP') { lireChap(d, f, version); continue; }
    if (id === 'CTOC' || id === 'PRIV' || id === 'TLEN' || id === 'MCDI' || id === 'PCNT' || id === 'RVA2' || id === 'RVAD' || id === 'ETCO' || id === 'MLLT' || id === 'SEEK') continue;
    if (id === 'WXXX' || (id[0] === 'W' && id.length === 4)) {
      const s = id === 'WXXX' ? chaineTerminee(d, 1, enc).suite : 0;
      const v = nettoyerTexte(d.subarray(s), 'latin1', { nul: true }).texte;
      if (v) ajouterChamp(f, ctx, 'x:lien', v, src2, { nom: 'Lien', groupe: 'droits et diffusion' });
      continue;
    }
    if (id[0] !== 'T') continue;
    const v = textes(d.subarray(1), enc, version);
    if (!v.valeurs.length) continue;
    const premier = v.valeurs[0];
    switch (id) {
      case 'TCON': {
        const genres = v.valeurs.map((g) => genreId3(g)).filter(Boolean);
        if (genres.length) ajouterChamp(f, ctx, 'genre', genres.join(' ; '), src2, { valeurs: genres.length > 1 ? genres : undefined });
        continue;
      }
      case 'TCMP': if (premier === '1') ajouterChamp(f, ctx, 'compilation', 'oui', src2); continue;
      case 'TSRC': ajouterIsrc(f, ctx, premier, src2); continue;
      case 'TLAN': for (const x of v.valeurs) { const c = versBcp47(x); if (c) { ajouterChamp(f, ctx, 'langue_declaree', c, src2); ajouterLangue(f, c, src2); } } continue;
      case 'TDRC': ajouterDate(f, ctx, 'date_enregistrement', lireDateIso(premier, 'enregistrement', ctx.maintenant), src2); continue;
      case 'TDRL': ajouterDate(f, ctx, 'date_parution', lireDateIso(premier, 'parution', ctx.maintenant), src2); continue;
      case 'TDOR': case 'TORY': ajouterDate(f, ctx, 'date_origine', lireDateIso(premier, 'parution originale', ctx.maintenant), src2); continue;
      case 'TDEN': case 'TDTG': continue;
      case 'TYER': annee = premier; continue;
      case 'TDAT': jourMois = premier; continue;
      case 'TIME': heure = premier; continue;
      case 'TIPL': case 'IPLS': case 'TMCL': {
        const paires: string[] = [];
        for (let i = 0; i + 1 < v.valeurs.length; i += 2) paires.push(`${v.valeurs[i]} : ${v.valeurs[i + 1]}`);
        const liste = paires.length ? paires : v.valeurs;
        ajouterChamp(f, ctx, id === 'TMCL' ? 'musiciens' : 'personnes', liste.join(' ; '), src2, { valeurs: liste.length > 1 ? liste : undefined });
        for (let i = 0; i + 1 < v.valeurs.length; i += 2) {
          const role = v.valeurs[i].toLowerCase();
          const cle = role.includes('arrang') ? 'arrangeur' : role.includes('produc') ? 'producteur' : role.includes('engineer') || role === 'mix' ? 'ingenieur' : undefined;
          if (cle) ajouterChamp(f, ctx, cle, v.valeurs[i + 1], src2);
        }
        continue;
      }
      default: break;
    }
    const cle = TEXTE[id];
    if (!cle) { if (!id.startsWith('TSO')) ajouterChamp(f, ctx, `x:${id}`, premier, src2, { nom: id, groupe: 'œuvre' }); continue; }
    if (cle === 'droits' || cle === 'production_droits') ctx.travail.droitsBruts.push(premier);
    if (v.douteux && v.valeurs.length === 1) ajouterChampOctets(f, ctx, cle, d.subarray(1), 'latin1', src2, { nom: cle.startsWith('x:') ? cle.slice(2) : undefined });
    else ajouterChamp(f, ctx, cle, premier, src2, { valeurs: v.valeurs.length > 1 ? v.valeurs : undefined, nom: cle.startsWith('x:') ? cle.slice(2) : undefined, groupe: cle.startsWith('x:') ? 'œuvre' : undefined });
  }
  // ID3v2.3 : TYER + TDAT + TIME.
  if (annee) {
    const a = Number(annee.slice(0, 4));
    const j = jourMois && jourMois.length === 4 ? Number(jourMois.slice(0, 2)) : undefined, mo = jourMois && jourMois.length === 4 ? Number(jourMois.slice(2, 4)) : undefined;
    const h = heure && heure.length === 4 ? Number(heure.slice(0, 2)) : undefined, mi = heure && heure.length === 4 ? Number(heure.slice(2, 4)) : undefined;
    const d = dateDepuisParties({ a, mo, j: mo ? j : undefined, h: mo && j ? h : undefined, mi: mo && j && h !== undefined ? mi : undefined }, 'enregistrement', ctx.maintenant)
      ?? dateDepuisParties({ a }, 'enregistrement', ctx.maintenant);
    ajouterDate(f, ctx, 'date_enregistrement', d, `${V}:TYER${jourMois ? '+TDAT' : ''}${heure ? '+TIME' : ''}`);
  }
  return total;
}

/** « (13) », « 13 », « (13)Pop », « (RX) », « (CR) » → nom du genre. */
export function genreId3(g: string): string {
  const t = g.trim();
  if (t === '(RX)' || t === 'RX') return 'Remix';
  if (t === '(CR)' || t === 'CR') return 'Reprise';
  let k = 0;
  if (t[0] === '(') {
    let q = 1, num = '';
    while (q < t.length && t[q] >= '0' && t[q] <= '9' && num.length < 3) num += t[q++];
    if (t[q] === ')' && num) { k = q + 1; const reste = t.slice(k).trim(); if (reste && !reste.startsWith('(')) return reste; return GENRES_ID3[Number(num)] ?? t; }
  }
  let tousChiffres = t.length > 0 && t.length <= 3;
  for (const c of t) if (c < '0' || c > '9') tousChiffres = false;
  if (tousChiffres) return GENRES_ID3[Number(t)] ?? t;
  return t;
}

/** CHAP : identifiant, début et fin (ms), sous-trames (TIT2). */
function lireChap(d: Buffer, f: FicheEnCours, version: number): void {
  const z = d.indexOf(0);
  if (z < 0 || z + 17 > d.length || f.chapitres.length >= 1000) return;
  const debut = d.readUInt32BE(z + 1), fin = d.readUInt32BE(z + 5);
  let titre = '';
  let p = z + 17;
  while (p + 10 <= d.length) {
    const id = d.toString('latin1', p, p + 4);
    const t = version === 4 ? ((d[p + 4] & 0x7f) << 21) | ((d[p + 5] & 0x7f) << 14) | ((d[p + 6] & 0x7f) << 7) | (d[p + 7] & 0x7f) : d.readUInt32BE(p + 4);
    if (p + 10 + t > d.length || t === 0) break;
    if (id === 'TIT2') titre = textes(d.subarray(p + 11, p + 10 + t), d[p + 10], version).valeurs[0] ?? '';
    p += 10 + t;
  }
  f.chapitres.push({ debutSec: debut / 1000, finSec: fin !== 0xffffffff ? fin / 1000 : undefined, titre: titre || `Chapitre ${f.chapitres.length + 1}` });
}

/**
 * Queue d'un fichier son : [APE][Lyrics3][ID3v1], et une balise ID3v2 en pied (« 3DI »). Rend la fin des données
 * audio (pour la durée estimée).
 */
export function lireQueue(src: Source, f: FicheEnCours, ctx: Contexte, finAudio = src.taille): number {
  let fin = finAudio;
  // ID3v1.
  if (fin >= 128) {
    const t = src.lire(fin - 128, 128);
    if (t.length === 128 && t.toString('latin1', 0, 3) === 'TAG') { lireId3v1(t, f, ctx); fin -= 128; }
  }
  // Lyrics3v2.
  if (fin >= 15) {
    const l = src.lire(fin - 15, 15);
    if (l.toString('latin1', 6, 15) === 'LYRICS200') {
      let n = 0, ok = true;
      for (let i = 0; i < 6; i++) { const c = l[i] - 48; if (c < 0 || c > 9) ok = false; n = n * 10 + c; }
      if (ok && n + 15 <= fin) { remarque(f, 'paroles Lyrics3 présentes, non lues'); fin -= n + 15; }
    } else if (l.toString('latin1', 6, 15) === 'LYRICSEND') remarque(f, 'paroles Lyrics3 (v1) présentes, non lues');
  }
  // APEv2.
  if (fin >= 32) {
    const p = src.lire(fin - 32, 32);
    if (p.toString('latin1', 0, 8) === 'APETAGEX') {
      const taille = p.readUInt32LE(12), n = p.readUInt32LE(16), drapeaux = p.readUInt32LE(20);
      if (taille >= 32 && taille <= fin && taille <= 16 * 1024 * 1024) {
        lireApe(src.lire(fin - taille, taille - 32), n, f, ctx);
        fin -= taille + (drapeaux & 0x80000000 ? 32 : 0);
      } else remarque(f, 'APEv2 : taille impossible');
    }
  }
  // ID3v2 en pied.
  if (fin >= 10) {
    const p = src.lire(fin - 10, 10);
    if (p.toString('latin1', 0, 3) === '3DI') {
      let t = 0, ok = true;
      for (let i = 0; i < 4; i++) { if (p[6 + i] & 0x80) ok = false; t = (t << 7) | p[6 + i]; }
      const debut = fin - 10 - t - 10;
      if (ok && debut >= 0) { lireId3v2(src, debut, f, ctx); fin = debut; }
    }
  }
  return fin;
}

function lireId3v1(t: Buffer, f: FicheEnCours, ctx: Contexte): void {
  const a = (cle: string, debut: number, n: number) => {
    if (f.champs.some((c) => c.cle === cle && !c.source.startsWith('ID3v1'))) return;
    ajouterChampOctets(f, ctx, cle, t.subarray(debut, debut + n), 'latin1', 'ID3v1', { fiabilite: 'probable' });
  };
  a('titre', 3, 30); a('artiste', 33, 30); a('album', 63, 30);
  if (!f.champs.some((c) => c.cle === 'date_enregistrement')) {
    const an = t.toString('latin1', 93, 97);
    const d = lireDateIso(an, 'enregistrement', ctx.maintenant);
    if (d) ajouterDate(f, ctx, 'date_enregistrement', d, 'ID3v1', { fiabilite: 'probable' });
  }
  if (t[125] === 0 && t[126] !== 0) {
    a('commentaire', 97, 28);
    if (!f.champs.some((c) => c.cle === 'piste')) ajouterChamp(f, ctx, 'piste', String(t[126]), 'ID3v1', { fiabilite: 'probable' });
  } else a('commentaire', 97, 30);
  if (t[127] < GENRES_ID3.length && !f.champs.some((c) => c.cle === 'genre')) ajouterChamp(f, ctx, 'genre', GENRES_ID3[t[127]], 'ID3v1', { fiabilite: 'probable' });
}

const APE: Record<string, string> = {
  TITLE: 'titre', ARTIST: 'artiste', ALBUM: 'album', YEAR: 'date_enregistrement', TRACK: 'piste', GENRE: 'genre', COMPOSER: 'compositeur', PUBLISHER: 'label',
  LABEL: 'label', COPYRIGHT: 'droits', ISRC: 'isrc', BARCODE: 'code_barres', CATALOGNUMBER: 'catalogue', DISTRIBUTOR: 'distributeur', COMMENT: 'commentaire',
  'ALBUM ARTIST': 'artiste_album', ALBUMARTIST: 'artiste_album', DISC: 'disque', CONDUCTOR: 'chef', LANGUAGE: 'langue_declaree',
};

function lireApe(b: Buffer, n: number, f: FicheEnCours, ctx: Contexte): void {
  if (n > ctx.budget.bornes.apeElements) { remarque(f, 'APEv2 : trop d\'éléments annoncés'); n = ctx.budget.bornes.apeElements; }
  let p = 0;
  for (let i = 0; i < n && p + 9 <= b.length; i++) {
    ctx.budget.pas();
    const t = b.readUInt32LE(p), fl = b.readUInt32LE(p + 4);
    const z = b.indexOf(0, p + 8);
    if (z < 0 || z - (p + 8) > 255) throw new ErreurFormat('APEv2 : clé invalide');
    const cle = b.toString('latin1', p + 8, z);
    const v = z + 1;
    if (v + t > b.length) throw new ErreurFormat('APEv2 : valeur plus longue que la balise');
    const val = b.subarray(v, v + t);
    p = v + t;
    if (((fl >> 1) & 3) !== 0) continue;           // binaire ou lien externe
    const K = cle.toUpperCase();
    const valeurs = nettoyerTexte(val).texte.split('\0').map((x) => x.trim()).filter(Boolean);
    if (!valeurs.length) continue;
    const s = `APE:${cle.slice(0, 40)}`;
    if (K === 'LYRICS') { ajouterTexteInclus(f, { genre: 'paroles', texte: valeurs.join('\n'), source: s }); continue; }
    const c = APE[K];
    if (c === 'isrc') { ajouterIsrc(f, ctx, valeurs[0], s); continue; }
    if (c === 'date_enregistrement') { ajouterDate(f, ctx, c, lireDateIso(valeurs[0], 'enregistrement', ctx.maintenant), s); continue; }
    if (c === 'genre') { ajouterChamp(f, ctx, c, genreId3(valeurs[0]), s); continue; }
    if (c) { if (c === 'droits') ctx.travail.droitsBruts.push(valeurs[0]); ajouterChamp(f, ctx, c, valeurs[0], s, { valeurs: valeurs.length > 1 ? valeurs : undefined }); }
    else ajouterChamp(f, ctx, `x:${cle.slice(0, 64)}`, valeurs[0], s, { nom: cle.slice(0, 64), groupe: 'œuvre' });
  }
}
