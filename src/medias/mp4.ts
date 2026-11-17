// Médias reçus : MP4 / MOV / M4A / M4B / 3GP (ISO BMFF et QuickTime). Boîtes lues par positions, mdat sauté sans
// lecture (moov en fin de fichier pris en charge), chaque boîte utile lue seule et bornée. Pistes (tkhd, mdhd, hdlr,
// stsd, stts), étiquettes iTunes (ilst), QuickTime (mdta : keys + ilst indexé), udta classique (©xyz…), XMP (uuid,
// XMP_), chapitres Nero (chpl). Aucune valeur n'est inventée : une langue « und » n'est pas une langue.

import type { Contexte, FicheEnCours, Piste } from './contrat.ts';
import { ErreurFormat } from './contrat.ts';
import { ajouterChamp, ajouterDate, ajouterImage, ajouterIsrc, ajouterLangue, ajouterManque, ajouterTexteInclus, candidatPosition, candidatPrise, dimensionsImage, formatImage, remarque } from './champs.ts';
import { dateDepuis1904, instantNaif, lireDateIso } from './dates.ts';
import { boitesBuf, boitesSource, type Boite } from './isobmff.ts';
import { langueEmpaquetee, versBcp47 } from './langues-codes.ts';
import { creerPosition, lireIso6709 } from './lieux.ts';
import { nettoyerTexte, type Source } from './octets.ts';
import { GENRES_ID3 } from './id3.ts';
import { coupure } from './tiff.ts';
import { lireXmp } from './xmp.ts';

const UUID_XMP = 'be7acfcb97a942e89c71999491e3afac';
const MAX_BOITE = 16 * 1024 * 1024;

/** Lit les données d'une boîte (bornées) ; undefined si trop grande (remarque). */
function donnees(src: Source, b: Boite, f: FicheEnCours, max = MAX_BOITE): Buffer | undefined {
  const n = b.fin - b.donnees;
  if (n > max) { coupure(f, `boîte ${b.type} de ${n} octets non lue en entier`); return src.lire(b.donnees, max); }
  return src.lire(b.donnees, n);
}

interface EtatMp4 {
  echelle: number; dureeBrute: number; creation?: number;
  logiciels: string[]; mdtaCreation?: { utc?: string; naif?: number };
  chapitresTexte: boolean; pistesVideo: number;
}

const PROFILS_AVC: Record<number, string> = { 66: 'Baseline', 77: 'Main', 88: 'Extended', 100: 'High', 110: 'High 10', 122: 'High 4:2:2', 244: 'High 4:4:4' };
const CODECS_VIDEO: Record<string, string> = {
  avc1: 'H.264 (AVC)', avc3: 'H.264 (AVC)', hvc1: 'H.265 (HEVC)', hev1: 'H.265 (HEVC)', av01: 'AV1', vp09: 'VP9', vp08: 'VP8', mp4v: 'MPEG-4 Part 2',
  apch: 'Apple ProRes 422 HQ', apcn: 'Apple ProRes 422', apcs: 'Apple ProRes 422 LT', apco: 'Apple ProRes 422 Proxy', ap4h: 'Apple ProRes 4444',
  jpeg: 'Motion JPEG', mjpa: 'Motion JPEG', s263: 'H.263', dvh1: 'Dolby Vision (HEVC)', dvhe: 'Dolby Vision (HEVC)',
};
const CODECS_SON: Record<string, string> = {
  alac: 'ALAC (Apple Lossless)', Opus: 'Opus', fLaC: 'FLAC', 'ac-3': 'AC-3 (Dolby Digital)', 'ec-3': 'E-AC-3 (Dolby Digital Plus)', samr: 'AMR-NB', sawb: 'AMR-WB',
  lpcm: 'PCM', sowt: 'PCM (petit-boutiste)', twos: 'PCM (gros-boutiste)', ipcm: 'PCM entier', fpcm: 'PCM flottant', '.mp3': 'MP3', mp4a: 'AAC',
};
const CODECS_TEXTE: Record<string, string> = { tx3g: 'Texte 3GPP (tx3g)', text: 'Texte QuickTime', wvtt: 'WebVTT', stpp: 'TTML', c608: 'CEA-608', c708: 'CEA-708' };
const OBJETS_AAC: Record<number, string> = { 1: 'AAC Main', 2: 'AAC-LC', 3: 'AAC SSR', 4: 'AAC LTP', 5: 'HE-AAC', 29: 'HE-AACv2', 23: 'AAC-LD', 39: 'AAC-ELD', 42: 'xHE-AAC (USAC)' };
const FREQ_AAC = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350];

/** Point d'entrée : un fichier ISO BMFF de famille son ou vidéo. */
export function lireMp4(src: Source, f: FicheEnCours, ctx: Contexte): void {
  const e: EtatMp4 = { echelle: 0, dureeBrute: 0, logiciels: [], chapitresTexte: false, pistesVideo: 0 };
  let moov = false;
  for (const b of boitesSource(src, f.nature.debut, src.taille, ctx)) {
    if (b.type === 'moov') { moov = true; lireMoov(src, b, f, ctx, e); }
    else if (b.type === 'uuid' && b.uuid === UUID_XMP) lireXmpBoite(src, b, f, ctx);
    else if (b.type === 'meta') { const d = donnees(src, b, f, 64 * 1024 * 1024); if (d) lireMeta(d, 0, d.length, f, ctx, e, 'MP4', b.donnees); }
  }
  if (!moov) throw new ErreurFormat('aucune boîte moov (fichier incomplet ou fragmenté sans en-tête)');
  // Durée.
  if (e.echelle > 0 && e.dureeBrute > 0) f.dureeSec = Math.round((e.dureeBrute / e.echelle) * 1000) / 1000;
  else if (!f.dureeSec) {
    const pistes = f.pistes.map((p) => p.dureeSec ?? 0).filter((x) => x > 0);
    if (pistes.length) f.dureeSec = Math.max(...pistes);
    else ajouterManque(f, { quoi: 'la durée', raison: 'durée non donnée (vidéo fragmentée)', code: 'absent' });
  }
  // Date de création du conteneur.
  const lavf = e.logiciels.some((l) => l.startsWith('Lavf'));
  if (lavf) remarque(f, 'passée par FFmpeg (réencodage possible)');
  if (e.creation) {
    const d = dateDepuis1904(e.creation, 'création du fichier', ctx.maintenant);
    if (d) {
      const sensible = f.nature.famille === 'video' || f.nature.famille === 'image';
      ajouterDate(f, ctx, 'date_creation_fichier', d, 'MP4:mvhd', { sensible });
      let douteuse = lavf;
      if (e.mdtaCreation?.utc && d.utc && Math.abs(Date.parse(e.mdtaCreation.utc) - Date.parse(d.utc)) > 60_000) douteuse = true;
      if (f.nature.famille === 'video') {
        candidatPrise(ctx, { ...d, role: 'prise de vue' }, 6, 'MP4:mvhd', douteuse);
        remarque(f, 'l\'heure du conteneur peut être l\'heure locale écrite comme UTC');
      }
    }
  }
  if (e.chapitresTexte) ajouterManque(f, { quoi: 'les chapitres', raison: 'chapitres dans une piste de texte : non lus', code: 'format-non-lu' });
  // Famille : un MP4 sans piste vidéo est un son.
  if (f.nature.famille === 'video' && e.pistesVideo === 0 && f.pistes.some((p) => p.genre === 'son')) {
    f.nature.famille = 'son';
    f.nature.nom = f.nature.nom.replace('Vidéo', 'Son');
    f.nature.alertes.push(`marque ${f.nature.format} sans piste vidéo : son seul`);
  }
  const v = f.pistes.find((p) => p.genre === 'vidéo');
  if (v && !f.largeur) {
    const L = v.largeurAffichee ?? v.largeur, H = v.hauteurAffichee ?? v.hauteur;
    if (L && H) {
      const tourne = v.rotationDeg === 90 || v.rotationDeg === 270;
      f.largeur = tourne ? H : L; f.hauteur = tourne ? L : H;
      if (v.rotationDeg) f.orientation = { code: v.rotationDeg === 90 ? 6 : v.rotationDeg === 180 ? 3 : 8, texte: `tournée de ${v.rotationDeg}° (sens horaire)` };
    }
  }
}

function lireXmpBoite(src: Source, b: Boite, f: FicheEnCours, ctx: Contexte): void {
  try { const d = donnees(src, b, f, ctx.budget.bornes.xmp); if (d) lireXmp(nettoyerTexte(d, 'utf-8', { max: ctx.budget.bornes.xmp }).texte, f, ctx); }
  catch (x) { coupure(f, `XMP : ${(x as Error).message}`); }
}

function lireMoov(src: Source, moov: Boite, f: FicheEnCours, ctx: Contexte, e: EtatMp4): void {
  for (const b of boitesSource(src, moov.donnees, moov.fin, ctx)) {
    if (b.type === 'mvhd') {
      const d = donnees(src, b, f)!;
      const v = d[0];
      if (v === 1) { e.creation = Number(d.readBigUInt64BE(4)); e.echelle = d.readUInt32BE(20); e.dureeBrute = Number(d.readBigUInt64BE(24)); }
      else { e.creation = d.readUInt32BE(4); e.echelle = d.readUInt32BE(12); e.dureeBrute = d.readUInt32BE(16); }
      if (e.dureeBrute === 0xffffffff || !Number.isSafeInteger(e.dureeBrute)) e.dureeBrute = 0;
    } else if (b.type === 'trak') {
      if (f.pistes.length >= ctx.budget.bornes.pistes) { const r = `plus de ${ctx.budget.bornes.pistes} pistes : les suivantes ne sont pas lues`; if (!f.partiel) f.partiel = r; remarque(f, r); continue; }
      lirePiste(src, b, f, ctx, e);
    } else if (b.type === 'udta') { const d = donnees(src, b, f, 64 * 1024 * 1024); if (d) lireUdta(d, 0, d.length, f, ctx, e, b.donnees); }
    else if (b.type === 'meta') { const d = donnees(src, b, f, 64 * 1024 * 1024); if (d) lireMeta(d, 0, d.length, f, ctx, e, 'MP4', b.donnees); }
    else if (b.type === 'mvex' && e.dureeBrute === 0) {
      const d = donnees(src, b, f)!;
      for (const c of boitesBuf(d, 0, d.length, ctx)) if (c.type === 'mehd') { const v = d[c.donnees]; e.dureeBrute = v === 1 ? Number(d.readBigUInt64BE(c.donnees + 4)) : d.readUInt32BE(c.donnees + 4); }
    } else if (b.type === 'uuid' && b.uuid === UUID_XMP) lireXmpBoite(src, b, f, ctx);
  }
}

function lirePiste(src: Source, trak: Boite, f: FicheEnCours, ctx: Contexte, e: EtatMp4): void {
  const piste: Piste = { index: f.pistes.length, genre: 'autre' };
  let echelle = 0, handler = '';
  const visiter = (debut: number, fin: number, prof: number, parent: string) => {
    ctx.budget.profondeur(prof);
    for (const b of boitesSource(src, debut, fin, ctx)) {
      switch (b.type) {
        case 'mdia': case 'minf': case 'stbl': case 'edts': visiter(b.donnees, b.fin, prof + 1, b.type); break;
        case 'tkhd': {
          const d = donnees(src, b, f)!;
          const v = d[0], m = v === 1 ? 52 : 40, l = v === 1 ? 88 : 76;
          if (d.length >= l + 8) {
            const a = d.readInt32BE(m) / 65536, bb = d.readInt32BE(m + 4) / 65536;
            const deg = ((Math.round(Math.atan2(bb, a) * 180 / Math.PI / 90) * 90) % 360 + 360) % 360;
            if (deg) piste.rotationDeg = deg as 90 | 180 | 270;
            const L = Math.round(d.readUInt32BE(l) / 65536), H = Math.round(d.readUInt32BE(l + 4) / 65536);
            if (L && H) { piste.largeurAffichee = L; piste.hauteurAffichee = H; }
          }
          const drapeaux = d.readUIntBE(1, 3);
          if (drapeaux & 1) piste.parDefaut = true;
          break;
        }
        case 'tref': {
          const d = donnees(src, b, f)!;
          for (const c of boitesBuf(d, 0, d.length, ctx)) if (c.type === 'chap') e.chapitresTexte = true;
          break;
        }
        case 'mdhd': {
          const d = donnees(src, b, f)!;
          const v = d[0];
          let duree: number, lang: number;
          if (v === 1) { echelle = d.readUInt32BE(20); duree = Number(d.readBigUInt64BE(24)); lang = d.readUInt16BE(32); }
          else { echelle = d.readUInt32BE(12); duree = d.readUInt32BE(16); lang = d.readUInt16BE(20); }
          if (echelle > 0 && duree > 0 && duree !== 0xffffffff && Number.isSafeInteger(duree)) piste.dureeSec = Math.round((duree / echelle) * 1000) / 1000;
          const code = langueEmpaquetee(lang);
          if (code && !piste.langueDeclaree) piste.langueDeclaree = code;
          break;
        }
        case 'elng': { const d = donnees(src, b, f)!; const c = versBcp47(nettoyerTexte(d.subarray(4), 'latin1', { nul: true }).texte); if (c) piste.langueDeclaree = c; break; }
        case 'hdlr': {
          if (parent !== 'mdia') break;       // le hdlr de minf (QuickTime « dhlr ») ne dit pas le genre de la piste
          const d = donnees(src, b, f)!;
          handler = d.toString('latin1', 8, 12);
          piste.genre = handler === 'vide' ? 'vidéo' : handler === 'soun' ? 'son' : ['text', 'sbtl', 'subt', 'clcp'].includes(handler) ? 'sous-titres' : ['meta', 'tmcd'].includes(handler) ? 'données' : 'autre';
          if (handler === 'vide') e.pistesVideo++;
          let nom = d.length > 24 ? d.subarray(24) : Buffer.alloc(0);
          if (nom.length && nom[0] === nom.length - 1) nom = nom.subarray(1);     // chaîne Pascal (QuickTime)
          const t = nettoyerTexte(nom, 'utf-8', { nul: true }).texte;
          if (t) { piste.nom = t; remarque(f, `piste écrite par : ${t}`); }
          break;
        }
        case 'stsd': { const d = donnees(src, b, f)!; lireStsd(d, piste, f, ctx); break; }
        case 'stts': {
          const d = donnees(src, b, f, 8 * 1024 * 1024)!;
          const n = Math.min(d.readUInt32BE(4), Math.floor((d.length - 8) / 8), ctx.budget.bornes.mp4TableEntrees);
          let images = 0, temps = 0, delta0 = -1, variable = false;
          for (let i = 0; i < n; i++) {
            const c = d.readUInt32BE(8 + i * 8), dl = d.readUInt32BE(12 + i * 8);
            images += c; temps += c * dl;
            if (delta0 < 0) delta0 = dl; else if (dl !== delta0 && c > 0) variable = true;
          }
          if (piste.genre === 'vidéo' && temps > 0 && echelle > 0) {
            piste.imagesParSeconde = Math.round((images * echelle / temps) * 100) / 100;
            if (variable) piste.frequenceVariable = true;
          }
          break;
        }
        default: break;
      }
    }
  };
  visiter(trak.donnees, trak.fin, 1, 'trak');
  if (piste.genre === 'vidéo' && piste.largeur && piste.hauteur && piste.largeurAffichee === piste.largeur && piste.hauteurAffichee === piste.hauteur) { delete piste.largeurAffichee; delete piste.hauteurAffichee; }
  f.pistes.push(piste);
}

function lireStsd(d: Buffer, piste: Piste, f: FicheEnCours, ctx: Contexte): void {
  for (const e of boitesBuf(d, 8, d.length, ctx)) {
    const fmt = e.type;
    piste.codecBrut = fmt;
    const p = e.donnees;
    if (piste.genre === 'vidéo' || CODECS_VIDEO[fmt]) {
      if (piste.genre === 'autre') piste.genre = 'vidéo';
      piste.codec = CODECS_VIDEO[fmt] ?? fmt;
      if (p + 28 <= e.fin) { piste.largeur = d.readUInt16BE(p + 24); piste.hauteur = d.readUInt16BE(p + 26); }
      if (p + 78 <= e.fin) for (const c of boitesBuf(d, p + 78, e.fin, ctx)) {
        if (c.type === 'avcC' && c.donnees + 4 <= c.fin) {
          const prof = d[c.donnees + 1], niv = d[c.donnees + 3];
          piste.codec = `H.264 (AVC) profil ${PROFILS_AVC[prof] ?? prof} ${niv / 10}`;
        } else if (c.type === 'hvcC' && c.donnees + 13 <= c.fin) {
          const prof = d[c.donnees + 1] & 31, niv = d[c.donnees + 12];
          piste.codec = `H.265 (HEVC) profil ${prof === 1 ? 'Main' : prof === 2 ? 'Main 10' : prof === 3 ? 'Main Still Picture' : prof} ${Math.round(niv / 3) / 10}`;
        }
      }
    } else if (piste.genre === 'son' || CODECS_SON[fmt]) {
      if (piste.genre === 'autre') piste.genre = 'son';
      piste.codec = CODECS_SON[fmt] ?? fmt;
      if (p + 28 <= e.fin) {
        const version = d.readUInt16BE(p + 8);
        piste.canaux = d.readUInt16BE(p + 16) || undefined;
        piste.bitsParEchantillon = d.readUInt16BE(p + 18) || undefined;
        piste.frequenceHz = d.readUInt32BE(p + 24) >>> 16 || undefined;
        let enfants = p + 28;
        if (version === 1) enfants += 16;
        else if (version === 2) { enfants += 36; if (p + 48 <= e.fin) { const fs = d.readDoubleBE(p + 32); if (Number.isFinite(fs) && fs > 0 && fs < 1e7) piste.frequenceHz = Math.round(fs); piste.canaux = d.readUInt32BE(p + 40); } }
        if (enfants < e.fin) for (const c of boitesBuf(d, enfants, e.fin, ctx)) {
          if (c.type === 'esds') lireEsds(d.subarray(c.donnees + 4, c.fin), piste);
          else if (c.type === 'dOps' && c.donnees + 8 <= c.fin) { piste.canaux = d[c.donnees + 1]; piste.frequenceHz = 48000; remarque(f, `Opus : fréquence d'origine ${d.readUInt32LE(c.donnees + 4)} Hz`); }
          else if (c.type === 'wave') for (const w of boitesBuf(d, c.donnees, c.fin, ctx)) if (w.type === 'esds') lireEsds(d.subarray(w.donnees + 4, w.fin), piste);
        }
      }
    } else if (piste.genre === 'sous-titres' || CODECS_TEXTE[fmt]) {
      if (piste.genre === 'autre') piste.genre = 'sous-titres';
      piste.codec = CODECS_TEXTE[fmt] ?? fmt;
    } else if (fmt === 'gpmd') { piste.genre = 'données'; piste.nonLue = 'GoPro GPMF non lue'; piste.codec = 'GoPro GPMF'; }
    else if (fmt === 'mebx') { piste.genre = 'données'; piste.codec = 'métadonnées horodatées'; piste.nonLue = 'métadonnées horodatées non lues'; }
    else if (fmt === 'tmcd') { piste.genre = 'données'; piste.codec = 'code temporel'; }
    else piste.codec = fmt;
    break;      // la première entrée décrit la piste
  }
}

/** ES_Descriptor → DecoderConfig → AudioSpecificConfig. */
function lireEsds(d: Buffer, piste: Piste): void {
  let p = 0;
  const desc = (): { tag: number; len: number; debut: number } | undefined => {
    if (p + 2 > d.length) return undefined;
    const tag = d[p++];
    let len = 0;
    for (let i = 0; i < 4 && p < d.length; i++) { const o = d[p++]; len = (len << 7) | (o & 0x7f); if (!(o & 0x80)) break; }
    return { tag, len, debut: p };
  };
  const es = desc(); if (!es || es.tag !== 3) return;
  p += 2; const fl = d[p++];
  if (fl & 0x80) p += 2;
  if (fl & 0x40) p += 1 + (d[p] ?? 0);
  if (fl & 0x20) p += 2;
  const dc = desc(); if (!dc || dc.tag !== 4 || p + 13 > d.length) return;
  const oti = d[p];
  const moy = d.readUInt32BE(p + 9);
  if (moy) piste.debitKbps = Math.round(moy / 1000);
  p += 13;
  if (oti === 0x6b || oti === 0x69) { piste.codec = 'MP3'; return; }
  const ds = desc(); if (!ds || ds.tag !== 5 || p + 2 > d.length) return;
  // Bits de l'AudioSpecificConfig.
  let bit = p * 8;
  const lire = (n: number) => { let v = 0; for (let i = 0; i < n; i++) { const o = d[bit >> 3]; if (o === undefined) return -1; v = (v << 1) | ((o >> (7 - (bit & 7))) & 1); bit++; } return v; };
  let obj = lire(5); if (obj === 31) obj = 32 + lire(6);
  const fi = lire(4);
  const fs = fi === 15 ? lire(24) : FREQ_AAC[fi];
  const ch = lire(4);
  piste.codec = OBJETS_AAC[obj] ?? `AAC (objet ${obj})`;
  if (fs && fs > 0) piste.frequenceHz = obj === 5 || obj === 29 ? fs * 2 : fs;
  if (ch > 0 && ch < 8) piste.canaux = ch === 7 ? 8 : ch;
  if (obj === 29) piste.canaux = 2;
}

// ─────────────────────────────── Étiquettes ───────────────────────────────

const ATOMES: Record<string, string> = {
  '©nam': 'titre', '©ART': 'artiste', aART: 'artiste_album', '©alb': 'album', '©wrt': 'compositeur', '©gen': 'genre', '©grp': 'regroupement',
  '©cmt': 'commentaire', desc: 'description', ldes: 'description', cprt: 'droits', '©cpy': 'droits', '©too': 'logiciel', '©enc': 'logiciel', '©swr': 'logiciel',
  '©pub': 'label', tvsh: 'serie', ownr: 'proprietaire_fichier', apID: 'compte_achat', '©mak': 'appareil_marque', '©mod': 'appareil_modele',
  '©aut': 'artiste', '©dir': 'realisateur', '©prd': 'producteur', '©des': 'description', '©inf': 'commentaire', '©key': 'mots_cles', '©lnt': 'x:lien',
  '©mvn': 'x:mouvement', '©wrk': 'x:oeuvre', '©con': 'chef', '©sol': 'interprete', '©arg': 'arrangeur', '©lbl': 'label', '©dis': 'distributeur', '©ope': 'artiste_origine',
};
const LIBRES: Record<string, string> = {
  LABEL: 'label', PUBLISHER: 'label', ISRC: 'isrc', BARCODE: 'code_barres', UPC: 'code_barres', EAN: 'code_barres', CATALOGNUMBER: 'catalogue',
  DISTRIBUTOR: 'distributeur', LYRICIST: 'parolier', CONDUCTOR: 'chef', REMIXER: 'remix', PRODUCER: 'producteur', ENGINEER: 'ingenieur',
  MOOD: 'humeur', KEY: 'tonalite', INITIALKEY: 'tonalite', LANGUAGE: 'langue_declaree', ORIGINALDATE: 'date_origine', MEDIA: 'support',
  ARRANGER: 'arrangeur', SUBTITLE: 'sous_titre', COPYRIGHT: 'droits', LICENSE: 'licence', ORGANIZATION: 'label',
};

/** Contenu des boîtes « data » d'un atome. */
function datas(d: Buffer, a: Boite, ctx: Contexte): Array<{ type: number; v: Buffer; pos: number }> {
  const r: Array<{ type: number; v: Buffer; pos: number }> = [];
  for (const c of boitesBuf(d, a.donnees, a.fin, ctx)) {
    if (c.type === 'data' && c.donnees + 8 <= c.fin) r.push({ type: d.readUInt32BE(c.donnees) & 0xffffff, v: d.subarray(c.donnees + 8, c.fin), pos: c.donnees + 8 });
    if (r.length >= 64) break;
  }
  return r;
}
const texteData = (x: { type: number; v: Buffer }) => nettoyerTexte(x.v, x.type === 2 ? 'utf-16be' : 'utf-8').texte;
function entierData(v: Buffer): number | undefined {
  if (v.length === 1) return v[0];
  if (v.length === 2) return v.readInt16BE(0);
  if (v.length === 3) return v.readIntBE(0, 3);
  if (v.length === 4) return v.readInt32BE(0);
  if (v.length === 8) { const x = v.readBigInt64BE(0); return x > BigInt(Number.MAX_SAFE_INTEGER) || x < -BigInt(Number.MAX_SAFE_INTEGER) ? undefined : Number(x); }
  return undefined;
}

/** Boîte meta (iTunes ou QuickTime mdta). `debutFichier` : position de `d` dans le fichier (pour les pochettes). */
function lireMeta(d: Buffer, debut: number, fin: number, f: FicheEnCours, ctx: Contexte, e: EtatMp4, origine: string, debutFichier?: number): void {
  // FullBox si les 4 octets suivants valent 0, sinon QuickTime ancien.
  let p = debut;
  if (p + 4 <= fin && d.readUInt32BE(p) === 0) p += 4;
  let handler = '';
  const cles: string[] = [];
  let ilst: Boite | undefined;
  for (const b of boitesBuf(d, p, fin, ctx)) {
    if (b.type === 'hdlr') handler = d.toString('latin1', b.donnees + 8, b.donnees + 12);
    else if (b.type === 'keys') {
      const n = Math.min(d.readUInt32BE(b.donnees + 4), 10_000);
      let q = b.donnees + 8;
      for (let i = 0; i < n && q + 8 <= b.fin; i++) {
        const t = d.readUInt32BE(q);
        if (t < 8 || q + t > b.fin) break;
        cles.push(d.toString('utf8', q + 8, q + t));
        q += t;
      }
    } else if (b.type === 'ilst') ilst = b;
  }
  if (!ilst) return;
  for (const a of boitesBuf(d, ilst.donnees, ilst.fin, ctx)) {
    ctx.budget.pas();
    if (handler === 'mdta' || (cles.length && a.type.charCodeAt(0) === 0)) {
      const i = d.readUInt32BE(a.debut + 4) - 1;
      const cle = cles[i];
      if (cle) lireMdta(cle, datas(d, a, ctx), f, ctx, e);
      continue;
    }
    lireAtome(d, a, f, ctx, e, origine, debutFichier);
  }
}

function lireAtome(d: Buffer, a: Boite, f: FicheEnCours, ctx: Contexte, e: EtatMp4, origine: string, debutFichier?: number): void {
  const t = a.type, src = `${origine}:${t}`;
  if (t === '----') {
    let nom = '';
    for (const c of boitesBuf(d, a.donnees, a.fin, ctx)) if (c.type === 'name') nom = d.toString('utf8', c.donnees + 4, c.fin);
    const ds = datas(d, a, ctx);
    if (!nom || !ds.length) return;
    const N = nom.toUpperCase();
    const v = texteData(ds[0]);
    if (N.startsWith('ITUN')) return;        // iTunNORM, iTunSMPB… : techniques
    const cle = LIBRES[N] ?? (N.startsWith('MUSICBRAINZ') ? 'identifiant' : `x:${nom.slice(0, 64)}`);
    if (cle === 'langue_declaree') { const c = versBcp47(v); if (c) { ajouterChamp(f, ctx, cle, c, `${origine}:----:${nom}`); ajouterLangue(f, c, `${origine}:----:${nom}`); } return; }
    ajouterChamp(f, ctx, cle, v, `${origine}:----:${nom}`, { nom: cle.startsWith('x:') ? nom : undefined, groupe: cle.startsWith('x:') ? 'œuvre' : undefined, sousRang: N === 'PUBLISHER' ? 1 : N === 'ORGANIZATION' ? 2 : 0 });
    return;
  }
  const ds = datas(d, a, ctx);
  if (!ds.length) return;
  const x = ds[0];
  switch (t) {
    case 'trkn': case 'disk': {
      if (x.v.length < 6) return;
      const n = x.v.readUInt16BE(2), tot = x.v.readUInt16BE(4);
      if (n) ajouterChamp(f, ctx, t === 'trkn' ? 'piste' : 'disque', tot ? `${n}/${tot}` : String(n), src);
      return;
    }
    case 'gnre': { const g = x.v.length >= 2 ? x.v.readUInt16BE(0) - 1 : -1; if (GENRES_ID3[g]) ajouterChamp(f, ctx, 'genre', GENRES_ID3[g], src); return; }
    case 'cpil': if (x.v[0] === 1) ajouterChamp(f, ctx, 'compilation', 'oui', src); return;
    case 'tmpo': { const n = entierData(x.v); if (n) ajouterChamp(f, ctx, 'tempo', String(n), src, { brut: n }); return; }
    case 'tvsn': case 'tves': { const n = entierData(x.v); if (n !== undefined) ajouterChamp(f, ctx, t === 'tvsn' ? 'saison' : 'episode', String(n), src); return; }
    case '©day': ajouterDate(f, ctx, 'date_enregistrement', lireDateIso(texteData(x), 'enregistrement', ctx.maintenant), src); return;
    case 'rldt': ajouterDate(f, ctx, 'date_parution', lireDateIso(texteData(x), 'parution', ctx.maintenant), src); return;
    case 'purd': ajouterDate(f, ctx, 'date_achat', lireDateIso(texteData(x), 'achat', ctx.maintenant), src); return;
    case '©lyr': ajouterTexteInclus(f, { genre: 'paroles', texte: texteData(x), source: src }); return;
    case 'covr': {
      for (const c of ds) {
        if (c.v.length === 0 || c.v.length > ctx.budget.bornes.imageJointe) continue;
        const fmt = formatImage(c.v);
        ajouterImage(f, { role: 'pochette', format: fmt, mimeDeclare: c.type === 13 ? 'image/jpeg' : c.type === 14 ? 'image/png' : c.type === 27 ? 'image/bmp' : undefined, ...dimensionsImage(c.v), decalage: (debutFichier ?? 0) + c.pos, taille: c.v.length, codage: 'brut' });
      }
      return;
    }
    case 'xid ': {
      const v = texteData(x);
      const k = v.indexOf(':');
      const fournisseur = k > 0 ? v.slice(0, k) : v;
      if (fournisseur) ajouterChamp(f, ctx, 'distributeur', fournisseur, src, { fiabilite: 'probable', sousRang: 50 });
      const i = v.indexOf(':isrc:');
      if (i >= 0) ajouterIsrc(f, ctx, v.slice(i + 6), src);
      return;
    }
    case '©xyz': candidatPosition(f, ctx, lireIso6709(texteData(x), src), 4); return;
    default: break;
  }
  const cle = ATOMES[t];
  if (!cle) {
    if (x.type === 1 || x.type === 2) {
      const v = texteData(x);
      if (v && !t.startsWith('so')) ajouterChamp(f, ctx, `x:${nomAtome(t)}`, v, src, { nom: nomAtome(t), groupe: 'œuvre' });
    }
    return;
  }
  if (x.type === 21 || x.type === 22) { const n = entierData(x.v); if (n !== undefined) ajouterChamp(f, ctx, cle, String(n), src); return; }
  const v = texteData(x);
  if (cle === 'logiciel') e.logiciels.push(v);
  if (cle === 'droits') ctx.travail.droitsBruts.push(v);
  ajouterChamp(f, ctx, cle, v, src);
}
const nomAtome = (t: string) => { let r = ''; for (const c of t) r += c >= ' ' && c <= '~' || c === '©' ? c : '?'; return r.trim(); };

const MDTA: Record<string, string> = {
  'com.apple.quicktime.make': 'appareil_marque', 'com.apple.quicktime.model': 'appareil_modele', 'com.apple.quicktime.software': 'logiciel',
  'com.apple.quicktime.title': 'titre', 'com.apple.quicktime.author': 'artiste', 'com.apple.quicktime.artist': 'artiste', 'com.apple.quicktime.description': 'description',
  'com.apple.quicktime.comment': 'commentaire', 'com.apple.quicktime.displayname': 'titre', 'com.apple.quicktime.keywords': 'mots_cles',
  'com.apple.quicktime.album': 'album', 'com.apple.quicktime.copyright': 'droits', 'com.apple.quicktime.genre': 'genre', 'com.apple.quicktime.publisher': 'label',
  'com.apple.quicktime.director': 'realisateur', 'com.apple.quicktime.producer': 'producteur', 'com.apple.quicktime.location.name': 'sous_lieu',
  'com.android.manufacturer': 'appareil_marque', 'com.android.model': 'appareil_modele',
  'com.apple.quicktime.camera.lens_model': 'objectif', encoder: 'logiciel', 'com.apple.quicktime.encoder': 'logiciel',
};

function lireMdta(cle: string, ds: Array<{ type: number; v: Buffer }>, f: FicheEnCours, ctx: Contexte, e: EtatMp4): void {
  if (!ds.length) return;
  const src = `MP4:mdta:${cle.slice(0, 80)}`;
  const x = ds[0];
  const v = x.type === 1 || x.type === 2 ? texteData(x) : (x.type === 21 || x.type === 22 ? String(entierData(x.v) ?? '') : '');
  if (cle === 'com.apple.quicktime.creationdate') {
    const d = lireDateIso(v, 'prise de vue', ctx.maintenant);
    if (d) { candidatPrise(ctx, d, 5, src); e.mdtaCreation = { utc: d.utc, naif: instantNaif(d) }; }
    return;
  }
  if (cle === 'com.apple.quicktime.location.ISO6709') { candidatPosition(f, ctx, lireIso6709(v, src), 3); return; }
  if (!v) return;
  const k = MDTA[cle];
  if (k) { if (k === 'logiciel') e.logiciels.push(v); ajouterChamp(f, ctx, k, v, src); return; }
  if (cle.includes('location')) ajouterChamp(f, ctx, `x:${cle}`.slice(0, 66), v, src, { nom: cle, groupe: 'lieu', sensible: true });
  else ajouterChamp(f, ctx, `x:${cle}`.slice(0, 66), v, src, { nom: cle, groupe: 'technique' });
}

/** udta classique : ©xyz, ©nam… (chaînes QuickTime internationales), meta iTunes, chpl, XMP_. */
function lireUdta(d: Buffer, debut: number, fin: number, f: FicheEnCours, ctx: Contexte, e: EtatMp4, base: number): void {
  for (const b of boitesBuf(d, debut, fin, ctx)) {
    const t = b.type;
    if (t === 'meta') { lireMeta(d, b.donnees, b.fin, f, ctx, e, 'MP4', base); continue; }
    if (t === 'XMP_') { try { lireXmp(nettoyerTexte(d.subarray(b.donnees, b.fin), 'utf-8', { max: ctx.budget.bornes.xmp }).texte, f, ctx); } catch (x) { coupure(f, `XMP : ${(x as Error).message}`); } continue; }
    if (t === 'chpl') { lireChpl(d.subarray(b.donnees, b.fin), f); continue; }
    if (t === 'loci' || ASSETS_3GPP[t]) { lire3gpp(d, b, f, ctx); continue; }
    if (t.charCodeAt(0) !== 0xa9) continue;
    // Chaîne internationale : u16 taille, u16 langue, texte.
    if (b.donnees + 4 > b.fin) continue;
    const n = d.readUInt16BE(b.donnees), lang = d.readUInt16BE(b.donnees + 2);
    const corps = d.subarray(b.donnees + 4, Math.min(b.fin, b.donnees + 4 + n));
    let texte: string, douteux = false;
    if (lang < 0x400) { try { texte = nettoyerTexte(corps, 'macintosh').texte; } catch { texte = nettoyerTexte(corps, 'latin1').texte; douteux = true; } }
    else texte = nettoyerTexte(corps, 'utf-8').texte;
    const src = `MP4:udta:${nomAtome(t)}`;
    if (t === '©xyz') { candidatPosition(f, ctx, lireIso6709(texte, src), 4); continue; }
    if (t === '©day') { ajouterDate(f, ctx, 'date_enregistrement', lireDateIso(texte, 'enregistrement', ctx.maintenant), src); continue; }
    const cle = ATOMES[t];
    if (cle) { if (cle === 'logiciel') e.logiciels.push(texte); ajouterChamp(f, ctx, cle, texte, src, { encodageDouteux: douteux }); }
  }
}

/** Chapitres Nero (chpl) : temps en unités de 100 ns. */
function lireChpl(d: Buffer, f: FicheEnCours): void {
  if (d.length < 5) return;
  let p = 4;
  if (d[0] === 1) p += 4;
  const n = d[p++];
  for (let i = 0; i < n && p + 9 <= d.length; i++) {
    const t = Number(d.readBigUInt64BE(p)) / 1e7; p += 8;
    const l = d[p++];
    const titre = nettoyerTexte(d.subarray(p, Math.min(d.length, p + l)), 'utf-8').texte; p += l;
    f.chapitres.push({ debutSec: Math.round(t * 1000) / 1000, titre });
  }
  for (let i = 0; i < f.chapitres.length - 1; i++) f.chapitres[i].finSec = f.chapitres[i + 1].debutSec;
}

/** Boîtes « asset » 3GPP (TS 26.244) : FullBox, langue empaquetée, chaîne (UTF-8, ou UTF-16 avec BOM). */
const ASSETS_3GPP: Record<string, string> = { titl: 'titre', auth: 'artiste', perf: 'interprete', gnre: 'genre', dscp: 'description', cprt: 'droits', albm: 'album', kywd: 'mots_cles' };

function chaine3gpp(d: Buffer, p: number, fin: number): { texte: string; suite: number } {
  if (p + 2 <= fin && d[p] === 0xfe && d[p + 1] === 0xff) {
    let q = p + 2; while (q + 1 < fin && !(d[q] === 0 && d[q + 1] === 0)) q += 2;
    return { texte: nettoyerTexte(d.subarray(p + 2, q), 'utf-16be').texte, suite: Math.min(fin, q + 2) };
  }
  let q = p; while (q < fin && d[q] !== 0) q++;
  return { texte: nettoyerTexte(d.subarray(p, q), 'utf-8').texte, suite: Math.min(fin, q + 1) };
}

function lire3gpp(d: Buffer, b: Boite, f: FicheEnCours, ctx: Contexte): void {
  const p = b.donnees + 4;
  if (p + 2 > b.fin) return;
  const langue = langueEmpaquetee(d.readUInt16BE(p));
  const src = `MP4:udta:${b.type}`;
  if (b.type === 'loci') {
    const nom = chaine3gpp(d, p + 2, b.fin);
    const q = nom.suite + 1;
    if (q + 12 > b.fin) return;
    const lon = d.readInt32BE(q) / 65536, lat = d.readInt32BE(q + 4) / 65536, alt = d.readInt32BE(q + 8) / 65536;
    candidatPosition(f, ctx, creerPosition({ lat, lon, altitudeM: alt || undefined, source: src, fiabilite: 'probable' }), 4);
    if (nom.texte) ajouterChamp(f, ctx, 'sous_lieu', nom.texte, src, { langue });
    return;
  }
  if (b.type === 'kywd') return;
  const cle = ASSETS_3GPP[b.type];
  const t = chaine3gpp(d, p + 2, b.fin).texte;
  if (cle && t) { if (cle === 'droits') ctx.travail.droitsBruts.push(t); ajouterChamp(f, ctx, cle, t, src, { langue }); }
}
