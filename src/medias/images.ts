// Médias reçus : les images. JPEG (segments jusqu'à SOS : EXIF, XMP et XMP étendu, Photoshop/IPTC, ICC, MPF, JFIF,
// commentaire, dimensions), PNG/APNG (IHDR, textes, eXIf, tIME, pHYs, acTL ; CRC vérifié), GIF (écran, images,
// délais, boucle, XMP, commentaires), WebP (VP8 / VP8L / VP8X, EXIF, XMP, ANIM), BMP, ICO, TIFF et RAW (métadonnées
// lues, image non décodée), JPEG XL (reconnu seulement), HEIF / HEIC / AVIF (isobmff.ts).

import { crc32 } from 'node:zlib';
import type { Contexte, FicheEnCours } from './contrat.ts';
import { ErreurFormat } from './contrat.ts';
import { ajouterChamp, ajouterChampOctets, ajouterDate, ajouterManque, remarque } from './champs.ts';
import { dateDepuisParties } from './dates.ts';
import { lire8bim } from './iptc.ts';
import { lireHeif } from './isobmff.ts';
import { decimal, gonfler, nettoyerTexte, type Source } from './octets.ts';
import { morceauxRiff } from './riff.ts';
import { coupure, lireTiff } from './tiff.ts';
import { lireXmp } from './xmp.ts';

const XMP_NS = 'http://ns.adobe.com/xap/1.0/\0';
const XMP_EXT = 'http://ns.adobe.com/xmp/extension/\0';

/** Lit un bloc dans un try : une erreur de sous-bloc rend la fiche partielle, pas illisible. */
function essayer(f: FicheEnCours, nom: string, fn: () => void): void {
  try { fn(); } catch (e) { if ((e as Error).name === 'ArretBudget') throw e; const m = String((e as Error).message ?? e); coupure(f, m.startsWith(nom) ? m : `${nom} : ${m}`); }
}

// ─────────────────────────────── JPEG ───────────────────────────────

export function lireJpeg(src: Source, f: FicheEnCours, ctx: Contexte): void {
  let p = 2, n = 0, sos = false;
  const etendus = new Map<string, { total: number; morceaux: Array<{ off: number; d: Buffer }> }>();
  while (p + 4 <= src.taille) {
    if (++n > ctx.budget.bornes.jpegSegments) { coupure(f, `JPEG : plus de ${ctx.budget.bornes.jpegSegments} segments avant l'image`); break; }
    ctx.budget.pas();
    const h = src.lire(p, 4);
    if (h[0] !== 0xff) throw new ErreurFormat('JPEG : marqueur attendu');
    const m = h[1];
    if (m === 0xff) { p++; continue; }
    if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { p += 2; continue; }
    if (m === 0xd9) break;
    const l = h.readUInt16BE(2);
    if (l < 2) throw new ErreurFormat(`JPEG : segment 0x${m.toString(16)} de longueur ${l}`);
    if (p + 2 + l > src.taille) throw new ErreurFormat('JPEG : segment plus long que le fichier');
    if (m === 0xda) { sos = true; break; }
    const debut = p + 4;
    const lireD = () => src.lire(debut, l - 2);
    if ((m >= 0xc0 && m <= 0xcf) && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
      const d = lireD();
      if (d.length >= 6) {
        f.hauteur = d.readUInt16BE(1); f.largeur = d.readUInt16BE(3);
        const comp = d[5];
        ajouterChamp(f, ctx, 'profondeur_couleurs', `${comp === 1 ? 'niveaux de gris' : comp === 3 ? 'couleur (3 composantes)' : comp === 4 ? 'CMJN (4 composantes)' : `${comp} composantes`}, ${d[0]} bits`, 'JPEG:SOF');
        if (m === 0xc2 || m === 0xc6 || m === 0xca || m === 0xce) ajouterChamp(f, ctx, 'x:progressif', 'oui', 'JPEG:SOF', { nom: 'JPEG progressif', groupe: 'technique' });
      }
    } else if (m === 0xe1) {
      const d = lireD();
      if (d.toString('latin1', 0, 6) === 'Exif\0\0') essayer(f, 'EXIF', () => { lireTiff(d.subarray(6), f, ctx, 'EXIF', debut + 6); });
      else if (d.toString('latin1', 0, XMP_NS.length) === XMP_NS) essayer(f, 'XMP', () => lireXmp(nettoyerTexte(d.subarray(XMP_NS.length), 'utf-8', { max: ctx.budget.bornes.xmp }).texte, f, ctx));
      else if (d.toString('latin1', 0, XMP_EXT.length) === XMP_EXT && d.length >= XMP_EXT.length + 40) {
        const q = XMP_EXT.length, guid = d.toString('latin1', q, q + 32), total = d.readUInt32BE(q + 32), off = d.readUInt32BE(q + 36);
        const e = etendus.get(guid) ?? { total, morceaux: [] };
        if (e.morceaux.length < 128) e.morceaux.push({ off, d: d.subarray(q + 40) });
        etendus.set(guid, e);
      }
    } else if (m === 0xed) { const d = lireD(); if (d.toString('latin1', 0, 14) === 'Photoshop 3.0\0') essayer(f, 'Photoshop', () => lire8bim(d, f, ctx)); }
    else if (m === 0xe2) {
      const d = src.lire(debut, 16);
      if (d.toString('latin1', 0, 12) === 'ICC_PROFILE\0') remarque(f, 'profil de couleurs ICC présent');
      else if (d.toString('latin1', 0, 4) === 'MPF\0') remarque(f, 'plusieurs images dans le fichier (MPF)');
    } else if (m === 0xe0) {
      const d = lireD();
      if (d.toString('latin1', 0, 5) === 'JFIF\0' && d.length >= 12) {
        const u = d[7], x = d.readUInt16BE(8), y = d.readUInt16BE(10);
        if (u && x) ajouterChamp(f, ctx, 'x:densite', `${x}${y !== x ? `×${y}` : ''} points par ${u === 1 ? 'pouce' : 'cm'}`, 'JPEG:JFIF', { nom: 'Densité', groupe: 'technique' });
      }
    } else if (m === 0xfe) ajouterChampOctets(f, ctx, 'commentaire', lireD(), 'utf-8', 'JPEG:COM');
    p += 2 + l;
  }
  // XMP étendu : morceaux recollés par GUID, sans trou, 4 Mio au plus.
  for (const [guid, e] of etendus) {
    if (e.total > ctx.budget.bornes.xmp) { remarque(f, 'XMP étendu trop grand : ignoré'); continue; }
    const tri = e.morceaux.sort((a, b) => a.off - b.off);
    let fin = 0, trou = false;
    for (const x of tri) { if (x.off > fin) { trou = true; break; } fin = Math.max(fin, x.off + x.d.length); }
    if (trou || fin < e.total) { remarque(f, `XMP étendu incomplet (${guid.slice(0, 8)}…) : ignoré`); continue; }
    const tout = Buffer.alloc(e.total);
    for (const x of tri) x.d.copy(tout, x.off, 0, Math.min(x.d.length, e.total - x.off));
    essayer(f, 'XMP étendu', () => lireXmp(nettoyerTexte(tout, 'utf-8', { max: ctx.budget.bornes.xmp }).texte, f, ctx, 'XMP'));
  }
  if (!sos && !f.largeur) remarque(f, 'JPEG sans image (aucun segment SOS)');
}

// ─────────────────────────────── PNG ───────────────────────────────

const COULEURS_PNG: Record<number, string> = { 0: 'niveaux de gris', 2: 'couleur (RVB)', 3: 'palette', 4: 'niveaux de gris + transparence', 6: 'couleur + transparence (RVBA)' };
const TEXTES_PNG: Record<string, string> = { Title: 'titre', Author: 'artiste', Description: 'description', Copyright: 'droits', Software: 'logiciel', Comment: 'commentaire', Disclaimer: 'x:Avertissement légal', Warning: 'x:Avertissement', Source: 'x:Source', 'Creation Time': 'x:Date de création (texte)' };

export function lirePng(src: Source, f: FicheEnCours, ctx: Contexte): void {
  let p = 8, n = 0, crcFaux = false, images = 0, dureeAnim = 0, boucles: number | undefined, idat = false;
  while (p + 12 <= src.taille) {
    if (++n > ctx.budget.bornes.pngChunks) { coupure(f, 'PNG : trop de morceaux'); break; }
    ctx.budget.pas();
    const h = src.lire(p, 8);
    const l = h.readUInt32BE(0), type = h.toString('latin1', 4, 8);
    if (l > 0x7fffffff || p + 12 + l > src.taille) throw new ErreurFormat(`PNG : morceau ${type.replace(/[^\x20-\x7e]/g, '?')} plus long que le fichier`);
    const d0 = p + 8;
    const lit = type !== 'IDAT' && type !== 'fdAT';
    const d = lit ? src.lire(d0, l) : undefined;
    if (d) {
      const crc = src.lire(d0 + l, 4).readUInt32BE(0);
      if (typeof crc32 === 'function' && crc32(d, crc32(Buffer.from(type, 'latin1'))) !== crc) crcFaux = true;
    }
    switch (type) {
      case 'IHDR':
        if (!d || d.length < 13) throw new ErreurFormat('PNG : IHDR invalide');
        f.largeur = d.readUInt32BE(0); f.hauteur = d.readUInt32BE(4);
        ajouterChamp(f, ctx, 'profondeur_couleurs', `${COULEURS_PNG[d[9]] ?? `type ${d[9]}`}, ${d[8]} bits`, 'PNG:IHDR');
        break;
      case 'tEXt': case 'zTXt': case 'iTXt': essayer(f, `PNG ${type}`, () => textePng(type, d!, f, ctx)); break;
      case 'eXIf': essayer(f, 'EXIF', () => { const t = d!.toString('latin1', 0, 6) === 'Exif\0\0' ? d!.subarray(6) : d!; lireTiff(t, f, ctx, 'EXIF', d0 + (t === d ? 0 : 6)); }); break;
      case 'tIME':
        if (d && d.length >= 7) ajouterDate(f, ctx, 'date_modification', dateDepuisParties({ a: d.readUInt16BE(0), mo: d[2], j: d[3], h: d[4], mi: d[5], s: d[6], fuseauMin: 0 }, 'modification', ctx.maintenant, 'UTC par définition'), 'PNG:tIME');
        break;
      case 'pHYs':
        if (d && d.length >= 9 && d[8] === 1) { const x = d.readUInt32BE(0); if (x) ajouterChamp(f, ctx, 'x:densite', `${Math.round(x * 0.0254)} points par pouce`, 'PNG:pHYs', { nom: 'Densité', groupe: 'technique' }); }
        break;
      case 'iCCP': remarque(f, 'profil de couleurs ICC présent'); break;
      case 'acTL': if (d && d.length >= 8) { images = d.readUInt32BE(0); boucles = d.readUInt32BE(4); } break;
      case 'fcTL': if (d && d.length >= 26) { const num = d.readUInt16BE(20), den = d.readUInt16BE(22) || 100; dureeAnim += num / den; } break;
      case 'IDAT': idat = true; break;
      default: break;
    }
    p = d0 + l + 4;
    if (type === 'IEND') break;
  }
  if (crcFaux) remarque(f, 'PNG : somme de contrôle (CRC) fausse dans au moins un morceau');
  if (images > 0) ajouterChamp(f, ctx, 'animation', `${images} images, ${decimal(dureeAnim)} s${boucles === 0 ? ', boucle' : boucles ? `, ${boucles} fois` : ''}`, 'PNG:acTL');
  if (!idat && !f.largeur) throw new ErreurFormat('PNG sans IHDR');
}

function textePng(type: string, d: Buffer, f: FicheEnCours, ctx: Contexte): void {
  const z = d.indexOf(0);
  if (z < 1 || z > 79) throw new ErreurFormat('mot-clé invalide');
  const cle = d.toString('latin1', 0, z);
  let texte: string, douteux = false, langue: string | undefined;
  if (type === 'tEXt') { const r = nettoyerTexte(d.subarray(z + 1), 'latin1'); texte = r.texte; douteux = r.encodageDouteux; }
  else if (type === 'zTXt') { texte = nettoyerTexte(gonfler(d.subarray(z + 2), 1024 * 1024), 'latin1').texte; }
  else {
    const comp = d[z + 1];
    let q = z + 3;
    const zl = d.indexOf(0, q); if (zl < 0) throw new ErreurFormat('iTXt tronqué');
    langue = d.toString('latin1', q, zl) || undefined; q = zl + 1;
    const zt = d.indexOf(0, q); if (zt < 0) throw new ErreurFormat('iTXt tronqué');
    q = zt + 1;
    const corps = comp ? gonfler(d.subarray(q), cle === 'XML:com.adobe.xmp' ? ctx.budget.bornes.xmp : 1024 * 1024) : d.subarray(q);
    texte = nettoyerTexte(corps, 'utf-8', { max: cle === 'XML:com.adobe.xmp' ? ctx.budget.bornes.xmp : undefined }).texte;
  }
  if (cle === 'XML:com.adobe.xmp') { lireXmp(texte, f, ctx); return; }
  if (cle.startsWith('Raw profile type ')) {
    // « \nexif\n   1234\n4578696600… » : hexadécimal → TIFF.
    const lignes = texte.split('\n').filter(Boolean);
    const hex = lignes.slice(2).join('').split(' ').join('');
    if (hex.length > 2 * 1024 * 1024) throw new ErreurFormat('profil brut trop long');
    const b = Buffer.from(hex, 'hex');
    const t = b.toString('latin1', 0, 6) === 'Exif\0\0' ? b.subarray(6) : b;
    if (cle.endsWith('exif') || cle.endsWith('APP1')) lireTiff(t, f, ctx, 'EXIF');
    else if (cle.endsWith('iptc')) remarque(f, 'profil IPTC brut présent');
    return;
  }
  const c = TEXTES_PNG[cle];
  const source = `PNG:${type}:${cle.slice(0, 40)}`;
  if (c === 'droits') ctx.travail.droitsBruts.push(texte);
  if (c) ajouterChamp(f, ctx, c, texte, source, { nom: c.startsWith('x:') ? c.slice(2) : undefined, groupe: c.startsWith('x:') ? 'œuvre' : undefined, encodageDouteux: douteux, langue });
  else ajouterChamp(f, ctx, `x:${cle}`, texte, source, { nom: cle, groupe: 'œuvre', encodageDouteux: douteux });
}

// ─────────────────────────────── GIF ───────────────────────────────

export function lireGif(src: Source, f: FicheEnCours, ctx: Contexte): void {
  const b = src.lire(0, Math.min(src.taille, ctx.budget.bornes.octetsLusMeta - 1024));
  if (b.length < 13) throw new ErreurFormat('GIF trop court');
  f.largeur = b.readUInt16LE(6); f.hauteur = b.readUInt16LE(8);
  const pk = b[10];
  let p = 13 + (pk & 0x80 ? 3 * 2 ** ((pk & 7) + 1) : 0);
  ajouterChamp(f, ctx, 'profondeur_couleurs', `palette de ${2 ** ((pk & 7) + 1)} couleurs`, 'GIF:LSD');
  let images = 0, delais = 0, boucle: number | undefined, blocs = 0;
  // `garder` : nombre de sous-blocs dont les octets sont gardés (0 pour les données d'une image : un GIF fait de
  // millions de sous-blocs d'un octet ne crée plus un objet par sous-bloc).
  const sousBlocs = (q: number, garder = 0): { fin: number; donnees: Buffer[] } => {
    const donnees: Buffer[] = [];
    for (;;) {
      if (q >= b.length) throw new ErreurFormat('GIF tronqué');
      if (++blocs > ctx.budget.bornes.gifSousBlocs) throw new ErreurFormat('GIF : trop de sous-blocs');
      const n = b[q++];
      if (n === 0) return { fin: q, donnees };
      if (q + n > b.length) throw new ErreurFormat('GIF : sous-bloc tronqué');
      if (donnees.length < garder) donnees.push(b.subarray(q, q + n));
      q += n;
    }
  };
  while (p < b.length) {
    ctx.budget.pas();
    const t = b[p];
    if (t === 0x3b) break;
    if (t === 0x2c) {
      if (++images > ctx.budget.bornes.gifImages) { coupure(f, 'GIF : trop d\'images'); break; }
      if (p + 10 > b.length) throw new ErreurFormat('GIF : descripteur tronqué');
      const lp = b[p + 9];
      p += 10 + (lp & 0x80 ? 3 * 2 ** ((lp & 7) + 1) : 0) + 1;
      p = sousBlocs(p).fin;
    } else if (t === 0x21) {
      const label = b[p + 1];
      if (label === 0xff && b[p + 2] === 11) {
        const app = b.toString('latin1', p + 3, p + 14);
        if (app === 'XMP DataXMP') {
          // Les octets XMP sont bruts jusqu'au premier 0x01 de la « queue magique » (258 octets).
          const debut = p + 14;
          let fin = b.indexOf('<?xpacket end', debut, 'latin1');
          if (fin >= 0) { const g = b.indexOf('>', fin); fin = g < 0 ? -1 : g + 1; }
          // Pas de fin de paquet ni de « > » : le XMP s'arrête à sa borne (jamais un retour au début du fichier).
          if (fin < debut) fin = Math.min(b.length, debut + ctx.budget.bornes.xmp);
          essayer(f, 'XMP', () => lireXmp(nettoyerTexte(b.subarray(debut, fin), 'utf-8', { max: ctx.budget.bornes.xmp }).texte, f, ctx));
          p = sousBlocs(fin).fin;
          continue;
        }
        const s = sousBlocs(p + 14, 1);
        if (app === 'NETSCAPE2.0' || app === 'ANIMEXTS1.0') { const x = s.donnees[0]; if (x && x.length >= 3 && x[0] === 1) boucle = x.readUInt16LE(1); }
        p = s.fin;
      } else if (label === 0xf9) {
        if (p + 8 <= b.length) delais += b.readUInt16LE(p + 4);
        p = sousBlocs(p + 2).fin;
      } else if (label === 0xfe) {
        const s = sousBlocs(p + 2, 1024);
        ajouterChampOctets(f, ctx, 'commentaire', Buffer.concat(s.donnees.slice(0, 1024)), 'latin1', 'GIF:commentaire');
        p = s.fin;
      } else p = sousBlocs(p + 2).fin;
    } else throw new ErreurFormat('GIF : bloc inconnu');
  }
  if (images > 1) ajouterChamp(f, ctx, 'animation', `${images} images, ${decimal(delais / 100)} s${boucle === 0 ? ', boucle' : boucle ? `, ${boucle} fois` : ''}`, 'GIF');
}

// ─────────────────────────────── WebP ───────────────────────────────

export function lireWebp(src: Source, f: FicheEnCours, ctx: Contexte): void {
  const h = src.lire(0, 12);
  const fin = Math.min(src.taille, 8 + h.readUInt32LE(4));
  if (8 + h.readUInt32LE(4) > src.taille) coupure(f, 'WebP : taille annoncée plus grande que le fichier');
  let images = 0, duree = 0, boucle: number | undefined;
  for (const m of morceauxRiff(src, 12, fin, ctx, f)) {
    const lire = (n = m.taille) => src.lire(m.donnees, Math.min(m.taille, n));
    switch (m.id) {
      case 'VP8 ': { const d = lire(10); if (d.length >= 10 && d[3] === 0x9d && d[4] === 0x01 && d[5] === 0x2a && !f.largeur) { f.largeur = d.readUInt16LE(6) & 0x3fff; f.hauteur = d.readUInt16LE(8) & 0x3fff; } break; }
      case 'VP8L': { const d = lire(5); if (d.length >= 5 && d[0] === 0x2f && !f.largeur) { const v = d.readUInt32LE(1); f.largeur = (v & 0x3fff) + 1; f.hauteur = ((v >> 14) & 0x3fff) + 1; } break; }
      case 'VP8X': { const d = lire(10); if (d.length >= 10) { f.largeur = d.readUIntLE(4, 3) + 1; f.hauteur = d.readUIntLE(7, 3) + 1; } break; }
      case 'EXIF': { const d = lire(); essayer(f, 'EXIF', () => { const t = d.toString('latin1', 0, 6) === 'Exif\0\0' ? d.subarray(6) : d; lireTiff(t, f, ctx, 'EXIF', m.donnees + (t === d ? 0 : 6)); }); break; }
      case 'XMP ': { const d = lire(ctx.budget.bornes.xmp); essayer(f, 'XMP', () => lireXmp(nettoyerTexte(d, 'utf-8', { max: ctx.budget.bornes.xmp }).texte, f, ctx)); break; }
      case 'ICCP': remarque(f, 'profil de couleurs ICC présent'); break;
      case 'ANIM': { const d = lire(6); if (d.length >= 6) boucle = d.readUInt16LE(4); break; }
      case 'ANMF': { images++; const d = lire(16); if (d.length >= 15) duree += d.readUIntLE(12, 3); break; }
      default: break;
    }
  }
  if (images > 0) ajouterChamp(f, ctx, 'animation', `${images} images, ${decimal(duree / 1000)} s${boucle === 0 ? ', boucle' : boucle ? `, ${boucle} fois` : ''}`, 'WebP:ANIM');
}

// ─────────────────────────────── BMP, ICO, JPEG XL ───────────────────────────────

export function lireBmp(src: Source, f: FicheEnCours, ctx: Contexte): void {
  const d = src.lire(0, 32);
  if (d.length < 26) throw new ErreurFormat('BMP trop court');
  const dib = d.readUInt32LE(14);
  let bits: number;
  if (dib === 12) { f.largeur = d.readUInt16LE(18); f.hauteur = d.readUInt16LE(20); bits = d.readUInt16LE(24); }
  else { if (d.length < 30) throw new ErreurFormat('BMP tronqué'); f.largeur = Math.abs(d.readInt32LE(18)); f.hauteur = Math.abs(d.readInt32LE(22)); bits = d.readUInt16LE(28); }
  ajouterChamp(f, ctx, 'profondeur_couleurs', `${bits} bits par point`, 'BMP');
}

export function lireIco(src: Source, f: FicheEnCours, _ctx: Contexte): void {
  const h = src.lire(0, 6);
  const n = h.readUInt16LE(4);
  if (n < 1 || n > 256) throw new ErreurFormat('ICO : nombre d\'images impossible');
  const t = src.lire(6, n * 16);
  if (t.length < n * 16) throw new ErreurFormat('ICO : répertoire tronqué');
  let meilleur = 0;
  for (let i = 0; i < n; i++) {
    const L = t[i * 16] || 256, H = t[i * 16 + 1] || 256;
    if (L * H > meilleur) { meilleur = L * H; f.largeur = L; f.hauteur = H; }
  }
  if (n > 1) remarque(f, `${n} tailles d'icône dans le fichier`);
}

/** TIFF et RAW : le TIFF lui-même (64 Mio lus au plus). */
export function lireTiffFichier(src: Source, f: FicheEnCours, ctx: Contexte): void {
  let b = src.lire(0, Math.min(src.taille, 64 * 1024 * 1024));
  const fmt = f.nature.format;
  if (fmt === 'orf' || fmt === 'rw2') b = Buffer.concat([Buffer.from([0x49, 0x49, 0x2a, 0x00]), b.subarray(4)]);
  const info = lireTiff(b, f, ctx, 'TIFF');
  const marque = (info.marque ?? '').toUpperCase();
  let raw: string | undefined;
  if (info.dng) raw = 'dng';
  else if (fmt === 'cr2' || fmt === 'orf' || fmt === 'rw2') raw = fmt;
  else if (marque.startsWith('NIKON')) raw = 'nef';
  else if (marque.startsWith('SONY')) raw = 'arw';
  if (raw) {
    f.nature.format = raw;
    f.nature.nom = `Photo RAW ${raw.toUpperCase()}`;
    remarque(f, 'format RAW : métadonnées lues, image non décodée');
  }
}

export function lireJxl(f: FicheEnCours): void {
  ajouterManque(f, { quoi: 'les métadonnées du JPEG XL', raison: 'format non lu', code: 'format-non-lu' });
}

export { lireHeif };
