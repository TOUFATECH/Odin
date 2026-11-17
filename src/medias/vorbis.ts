// Médias reçus : commentaires Vorbis (FLAC, Ogg Vorbis, Opus, Speex, Ogg FLAC) et bloc PICTURE (FLAC, et
// METADATA_BLOCK_PICTURE en base64). Clés insensibles à la casse, répétitions gardées (plusieurs artistes) ; nombre de
// commentaires borné ET vérifié contre la taille du bloc avant toute lecture.

import type { Contexte, FicheEnCours, ImageJointe } from './contrat.ts';
import { ErreurFormat } from './contrat.ts';
import { ajouterChamp, ajouterDate, ajouterImage, ajouterIsrc, ajouterLangue, ajouterTexteInclus, dimensionsImage, formatImage, remarque } from './champs.ts';
import { lireDateIso } from './dates.ts';
import { versBcp47 } from './langues-codes.ts';
import { base64Borne, nettoyerTexte } from './octets.ts';
import { genreId3 } from './id3.ts';

const CLES: Record<string, [string, number?]> = {
  TITLE: ['titre'], VERSION: ['sous_titre'], SUBTITLE: ['sous_titre'], GROUPING: ['regroupement'], ALBUM: ['album'], ARTIST: ['artiste'],
  ALBUMARTIST: ['artiste_album'], 'ALBUM ARTIST': ['artiste_album'], PERFORMER: ['interprete'], CONDUCTOR: ['chef'], REMIXER: ['remix'], ARRANGER: ['arrangeur'],
  COMPOSER: ['compositeur'], LYRICIST: ['parolier'], WRITER: ['parolier', 1], PRODUCER: ['producteur'], ENGINEER: ['ingenieur'], MIXER: ['ingenieur', 1], GENRE: ['genre'],
  COMPILATION: ['compilation'], LABEL: ['label', 0], PUBLISHER: ['label', 1], ORGANIZATION: ['label', 2], DISTRIBUTOR: ['distributeur'],
  COPYRIGHT: ['droits'], LICENSE: ['licence'], BARCODE: ['code_barres'], UPC: ['code_barres'], EAN: ['code_barres'], CATALOGNUMBER: ['catalogue'],
  LOCATION: ['lieu_enregistrement'], ENCODER: ['logiciel'], 'ENCODED-BY': ['logiciel', 1], ENCODEDBY: ['logiciel', 1], DESCRIPTION: ['description'],
  COMMENT: ['commentaire'], BPM: ['tempo'], KEY: ['tonalite'], INITIALKEY: ['tonalite'], MOOD: ['humeur'], MEDIA: ['support'],
};
const TYPES_IMAGE: Record<number, ImageJointe['role']> = { 3: 'pochette recto', 4: 'pochette verso', 7: 'artiste', 8: 'artiste' };

/** Lit un bloc PICTURE (FLAC). `pos` = position du bloc dans le fichier (ou -1 s'il vient d'un base64). */
export function lireBlocPicture(b: Buffer, f: FicheEnCours, ctx: Contexte, pos: number, origine: string, base64?: { decalage: number; taille: number }): void {
  if (b.length < 32) throw new ErreurFormat(`${origine} : bloc PICTURE trop court`);
  const type = b.readUInt32BE(0);
  let p = 4;
  const lm = b.readUInt32BE(p); p += 4;
  if (lm > 256 || p + lm > b.length) throw new ErreurFormat(`${origine} : type MIME d'image invalide`);
  const mime = b.toString('latin1', p, p + lm); p += lm;
  const ld = b.readUInt32BE(p); p += 4;
  if (ld > 64 * 1024 || p + ld > b.length) throw new ErreurFormat(`${origine} : description d'image invalide`);
  const desc = nettoyerTexte(b.subarray(p, p + ld)).texte; p += ld;
  if (p + 20 > b.length) throw new ErreurFormat(`${origine} : bloc PICTURE tronqué`);
  const L = b.readUInt32BE(p), H = b.readUInt32BE(p + 4);
  p += 16;
  const n = b.readUInt32BE(p); p += 4;
  if (n > ctx.budget.bornes.imageJointe || p + n > b.length) throw new ErreurFormat(`${origine} : image jointe plus longue que le bloc`);
  const img = b.subarray(p, p + n);
  const dims = dimensionsImage(img);
  const i: ImageJointe = {
    role: TYPES_IMAGE[type] ?? 'autre', format: formatImage(img), mimeDeclare: mime || undefined, largeur: dims.largeur ?? (L || undefined), hauteur: dims.hauteur ?? (H || undefined),
    description: desc || undefined, decalage: base64 ? base64.decalage : pos >= 0 ? pos + p : -1, taille: base64 ? base64.taille : n, codage: base64 ? 'base64' : 'brut',
  };
  ajouterImage(f, i, img, ctx);
}

/** Commentaires Vorbis. `avecCadre` : un octet de cadrage (Vorbis) suit ; `pos` : position dans le fichier ou -1. */
export function lireCommentaires(b: Buffer, f: FicheEnCours, ctx: Contexte, origine = 'Vorbis', pos = -1): void {
  if (b.length < 8) throw new ErreurFormat(`${origine} : commentaires tronqués`);
  const lv = b.readUInt32LE(0);
  if (4 + lv + 4 > b.length) throw new ErreurFormat(`${origine} : fournisseur plus long que le bloc`);
  const vendeur = nettoyerTexte(b.subarray(4, 4 + lv)).texte;
  if (vendeur) ajouterChamp(f, ctx, 'encodeur_audio', vendeur, `${origine}:vendor`);
  let p = 4 + lv;
  const n = b.readUInt32LE(p); p += 4;
  if (n > ctx.budget.bornes.vorbisCommentaires || n * 4 > b.length - p) throw new ErreurFormat(`${origine} : ${n} commentaires annoncés pour ${b.length - p} octets`);
  const vals = new Map<string, Array<{ v: string; pos: number; taille: number }>>();
  for (let i = 0; i < n; i++) {
    ctx.budget.pas();
    if (p + 4 > b.length) throw new ErreurFormat(`${origine} : commentaire tronqué`);
    const l = b.readUInt32LE(p); p += 4;
    if (p + l > b.length) throw new ErreurFormat(`${origine} : commentaire plus long que le bloc`);
    const e = b.indexOf(0x3d, p);
    if (e < 0 || e >= p + l || e - p > 256) { p += l; continue; }
    const cle = b.toString('latin1', p, e).toUpperCase();
    const brut = b.subarray(e + 1, p + l);
    const grand = cle === 'METADATA_BLOCK_PICTURE' || cle === 'COVERART' || cle === 'LYRICS' || cle === 'UNSYNCEDLYRICS';
    const v = grand && (cle === 'METADATA_BLOCK_PICTURE' || cle === 'COVERART') ? brut.toString('latin1') : nettoyerTexte(brut).texte;
    const l2 = vals.get(cle) ?? [];
    if (l2.length < 256) l2.push({ v, pos: pos >= 0 ? pos + e + 1 : -1, taille: brut.length });
    vals.set(cle, l2);
    p += l;
  }
  const premier = (k: string) => vals.get(k)?.[0]?.v;
  const src = (k: string) => `${origine}:${k}`;
  const nombre = (k1: string, totaux: string[]) => {
    const n1 = premier(k1); if (!n1) return undefined;
    if (n1.includes('/')) return n1;
    const t = totaux.map(premier).find(Boolean);
    return t ? `${n1}/${t}` : n1;
  };
  for (const [k, liste] of vals) {
    const valeurs = liste.map((x) => x.v).filter(Boolean);
    if (!valeurs.length) continue;
    switch (k) {
      case 'TRACKNUMBER': { const v = nombre(k, ['TRACKTOTAL', 'TOTALTRACKS']); if (v) ajouterChamp(f, ctx, 'piste', v, src(k)); continue; }
      case 'DISCNUMBER': { const v = nombre(k, ['DISCTOTAL', 'TOTALDISCS']); if (v) ajouterChamp(f, ctx, 'disque', v, src(k)); continue; }
      case 'TRACKTOTAL': case 'TOTALTRACKS': case 'DISCTOTAL': case 'TOTALDISCS': continue;
      case 'DATE': case 'YEAR': ajouterDate(f, ctx, 'date_enregistrement', lireDateIso(valeurs[0], 'enregistrement', ctx.maintenant), src(k)); continue;
      case 'ORIGINALDATE': case 'ORIGINALYEAR': ajouterDate(f, ctx, 'date_origine', lireDateIso(valeurs[0], 'parution originale', ctx.maintenant), src(k)); continue;
      case 'ISRC': ajouterIsrc(f, ctx, valeurs[0], src(k)); continue;
      case 'LANGUAGE': for (const v of valeurs) { const c = versBcp47(v); if (c) { ajouterChamp(f, ctx, 'langue_declaree', c, src(k)); ajouterLangue(f, c, src(k)); } } continue;
      case 'LYRICS': case 'UNSYNCEDLYRICS': ajouterTexteInclus(f, { genre: 'paroles', texte: valeurs[0], source: src(k) }); continue;
      case 'GENRE': { const g = valeurs.map(genreId3); ajouterChamp(f, ctx, 'genre', g.join(' ; '), src(k), { valeurs: g.length > 1 ? g : undefined }); continue; }
      case 'COMPILATION': if (valeurs[0] === '1') ajouterChamp(f, ctx, 'compilation', 'oui', src(k)); continue;
      case 'METADATA_BLOCK_PICTURE': case 'COVERART':
        for (const x of liste) {
          try {
            const d = base64Borne(x.v, ctx.budget.bornes.base64);
            if (k === 'METADATA_BLOCK_PICTURE') lireBlocPicture(d, f, ctx, -1, src(k), { decalage: x.pos, taille: x.taille });
            else ajouterImage(f, { role: 'pochette', format: formatImage(d), ...dimensionsImage(d), decalage: x.pos, taille: x.taille, codage: 'base64' }, d, ctx);
          } catch (e) { remarque(f, `${origine} : pochette illisible (${(e as Error).message})`); }
        }
        continue;
      default: break;
    }
    const c = CLES[k];
    if (c) {
      if (c[0] === 'droits') ctx.travail.droitsBruts.push(valeurs[0]);
      ajouterChamp(f, ctx, c[0], valeurs.join(' ; '), src(k), { valeurs: valeurs.length > 1 ? valeurs : undefined, sousRang: c[1] ?? 0 });
    } else if (k.startsWith('MUSICBRAINZ')) ajouterChamp(f, ctx, 'identifiant', `${k} : ${valeurs[0]}`, src(k));
    else ajouterChamp(f, ctx, `x:${k.slice(0, 64)}`, valeurs.join(' ; '), src(k), { nom: k.slice(0, 64), groupe: k.startsWith('REPLAYGAIN') ? 'technique' : 'œuvre', valeurs: valeurs.length > 1 ? valeurs : undefined });
  }
}
