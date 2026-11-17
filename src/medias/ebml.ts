// Médias reçus : Matroska / WebM (EBML). En-tête EBML vérifié ; Segment parcouru par SeekHead (positions relatives au
// début des données du Segment, chaque position visitée une fois) et linéairement (Clusters sautés par leur taille ;
// un Cluster de taille inconnue arrête : lecture partielle). Info, Tracks, Tags (SimpleTag imbriqués bornés), Chapters,
// Attachments (octets non lus). Une piste sans Language n'a PAS de langue : le défaut « eng » n'est pas une déclaration.

import type { Contexte, FicheEnCours, Piste } from './contrat.ts';
import { ErreurFormat } from './contrat.ts';
import { ajouterChamp, ajouterDate, ajouterImage, ajouterIsrc, ajouterLangue, candidatPosition, candidatPrise, formatImage, remarque } from './champs.ts';
import { dateDepuis2001, lireDateIso } from './dates.ts';
import { versBcp47 } from './langues-codes.ts';
import { lireIso6709 } from './lieux.ts';
import { nettoyerTexte, Vue, type Source } from './octets.ts';
import { coupure } from './tiff.ts';

const ID = {
  EBML: 0x1a45dfa3, DocType: 0x4282, MaxIdLen: 0x42f2, MaxSizeLen: 0x42f3, Segment: 0x18538067, SeekHead: 0x114d9b74, Seek: 0x4dbb, SeekID: 0x53ab, SeekPos: 0x53ac,
  Info: 0x1549a966, Scale: 0x2ad7b1, Duration: 0x4489, DateUTC: 0x4461, Title: 0x7ba9, MuxingApp: 0x4d80, WritingApp: 0x5741,
  Tracks: 0x1654ae6b, TrackEntry: 0xae, TrackNumber: 0xd7, TrackUID: 0x73c5, TrackType: 0x83, FlagDefault: 0x88, FlagForced: 0x55aa, Name: 0x536e,
  Language: 0x22b59c, LanguageBCP47: 0x22b59d, CodecID: 0x86, CodecName: 0x258688, DefaultDuration: 0x23e383, Video: 0xe0, PixelWidth: 0xb0,
  PixelHeight: 0xba, DisplayWidth: 0x54b0, DisplayHeight: 0x54ba, Audio: 0xe1, Sampling: 0xb5, OutSampling: 0x78b5, Channels: 0x9f, BitDepth: 0x6264,
  Cluster: 0x1f43b675, Tags: 0x1254c367, Tag: 0x7373, Targets: 0x63c0, TargetTypeValue: 0x68ca, TagTrackUID: 0x63c5, SimpleTag: 0x67c8, TagName: 0x45a3,
  TagLanguage: 0x447a, TagLanguageBCP47: 0x447b, TagString: 0x4487, Chapters: 0x1043a770, Edition: 0x45b9, ChapterAtom: 0xb6, ChapStart: 0x91, ChapEnd: 0x92,
  ChapDisplay: 0x80, ChapString: 0x85, ChapLanguage: 0x437c, ChapLanguageBCP47: 0x437d, Attachments: 0x1941a469, AttachedFile: 0x61a7, FileName: 0x466e,
  FileMediaType: 0x4660, FileData: 0x465c, FileDescription: 0x467e,
};

interface El { id: number; debut: number; donnees: number; fin: number; inconnu: boolean }

/** En-tête d'élément lu dans un tampon `h` à `o` ; `pos` = position réelle. */
function entete(h: Buffer, o: number, pos: number, limite: number): El {
  const v = new Vue(h);
  const i = v.vint(o, true);
  if (i.longueur > 4) throw new ErreurFormat('EBML : identifiant de plus de 4 octets');
  const t = v.vint(o + i.longueur);
  const donnees = pos + i.longueur + t.longueur;
  if (t.inconnu) return { id: i.valeur, debut: pos, donnees, fin: limite, inconnu: true };
  if (t.grand || donnees + t.valeur > limite) throw new ErreurFormat(`EBML : élément 0x${i.valeur.toString(16)} plus long que son parent`);
  return { id: i.valeur, debut: pos, donnees, fin: donnees + t.valeur, inconnu: false };
}

function* elementsBuf(b: Buffer, debut: number, fin: number, ctx: Contexte): Generator<El> {
  let p = debut;
  while (p < fin) {
    ctx.budget.pas();
    if (b[p] === 0) throw new ErreurFormat('EBML : entier invalide (octet 0x00)');
    const e = entete(b, p, p, fin);
    if (e.inconnu) throw new ErreurFormat('EBML : taille inconnue dans un élément lu en entier');
    yield e;
    p = e.fin;
  }
}
function* elementsSource(src: Source, debut: number, fin: number, ctx: Contexte): Generator<El> {
  let p = debut;
  while (p + 2 <= fin) {
    ctx.budget.pas();
    const h = src.lire(p, 12);
    const e = entete(h, 0, p, fin);
    yield e;
    if (e.inconnu || e.fin <= p) return;
    p = e.fin;
  }
}

const uint = (b: Buffer, e: El) => { const n = e.fin - e.donnees; if (n === 0) return 0; if (n > 8) throw new ErreurFormat('EBML : entier trop long'); let v = 0n; for (let i = e.donnees; i < e.fin; i++) v = (v << 8n) | BigInt(b[i]); return v > BigInt(Number.MAX_SAFE_INTEGER) ? Number.MAX_SAFE_INTEGER : Number(v); };
const bigint = (b: Buffer, e: El) => { let v = 0n; for (let i = e.donnees; i < Math.min(e.fin, e.donnees + 8); i++) v = (v << 8n) | BigInt(b[i]); const n = e.fin - e.donnees; return n === 8 && v >= 1n << 63n ? v - (1n << 64n) : v; };
const ubig = (b: Buffer, e: El) => { let v = 0n; for (let i = e.donnees; i < Math.min(e.fin, e.donnees + 8); i++) v = (v << 8n) | BigInt(b[i]); return v.toString(); };
const texte = (b: Buffer, e: El) => nettoyerTexte(b.subarray(e.donnees, e.fin), 'utf-8', { nul: true }).texte;
function flottant(b: Buffer, e: El, f: FicheEnCours): number | undefined {
  const n = e.fin - e.donnees;
  if (n === 4) return b.readFloatBE(e.donnees);
  if (n === 8) return b.readDoubleBE(e.donnees);
  if (n === 10) remarque(f, 'flottant de 10 octets ignoré');
  return undefined;
}

const CODECS: Record<string, string> = {
  'V_MPEG4/ISO/AVC': 'H.264 (AVC)', 'V_MPEGH/ISO/HEVC': 'H.265 (HEVC)', V_AV1: 'AV1', V_VP8: 'VP8', V_VP9: 'VP9', 'V_MPEG4/ISO/ASP': 'MPEG-4 Part 2',
  V_THEORA: 'Theora', V_MPEG2: 'MPEG-2', 'V_MS/VFW/FOURCC': 'Vidéo Windows (FourCC)', V_PRORES: 'Apple ProRes', V_FFV1: 'FFV1',
  A_OPUS: 'Opus', A_VORBIS: 'Vorbis', A_AAC: 'AAC', 'A_AAC/MPEG4/LC': 'AAC-LC', 'A_AAC/MPEG4/LC/SBR': 'HE-AAC', 'A_MPEG/L3': 'MP3', 'A_MPEG/L2': 'MP2',
  A_AC3: 'AC-3 (Dolby Digital)', A_EAC3: 'E-AC-3 (Dolby Digital Plus)', A_DTS: 'DTS', A_FLAC: 'FLAC', A_TRUEHD: 'Dolby TrueHD', 'A_PCM/INT/LIT': 'PCM', 'A_PCM/FLOAT/IEEE': 'PCM flottant', A_ALAC: 'ALAC',
  'S_TEXT/UTF8': 'SRT (texte)', 'S_TEXT/ASS': 'ASS (texte)', 'S_TEXT/SSA': 'SSA (texte)', 'S_TEXT/WEBVTT': 'WebVTT (texte)', 'S_TEXT/USF': 'USF (texte)',
  'S_HDMV/PGS': 'PGS (images)', S_VOBSUB: 'VobSub (images)', S_DVBSUB: 'DVB (images)', 'S_HDMV/TEXTST': 'Texte HDMV',
};

const TAGS: Record<string, [string, number?]> = {
  ARTIST: ['artiste'], LEAD_PERFORMER: ['artiste', 1], COMPOSER: ['compositeur'], LYRICIST: ['parolier'], WRITTEN_BY: ['parolier', 1], DIRECTOR: ['realisateur'],
  PRODUCER: ['producteur'], GENRE: ['genre'], LABEL: ['label'], PUBLISHER: ['label', 1], DISTRIBUTED_BY: ['distributeur'], COPYRIGHT: ['droits'],
  PRODUCTION_COPYRIGHT: ['production_droits'], LICENSE: ['licence'], BARCODE: ['code_barres'], CATALOG_NUMBER: ['catalogue'], DESCRIPTION: ['description'],
  SUMMARY: ['description', 1], SYNOPSIS: ['description', 2], COMMENT: ['commentaire'], ENCODER: ['logiciel', 2], ORIGINAL_MEDIA_TYPE: ['support'],
  SUBTITLE: ['sous_titre'], KEYWORDS: ['mots_cles'], BPM: ['tempo'], MOOD: ['humeur'], CONDUCTOR: ['chef'], ARRANGER: ['arrangeur'], REMIXED_BY: ['remix'],
  MIXED_BY: ['ingenieur'], RECORDING_LOCATION: ['lieu_enregistrement'], ENCODED_BY: ['logiciel', 3], ACCOMPANIMENT: ['interprete'],
};
const STATS = new Set(['BPS', 'DURATION', 'NUMBER_OF_FRAMES', 'NUMBER_OF_BYTES', '_STATISTICS_WRITING_APP', '_STATISTICS_WRITING_DATE_UTC', '_STATISTICS_TAGS']);

interface EtatMkv { echelle: number; duree?: number; pistesParUid: Map<string, Piste>; titres: Array<{ cible: number; v: string }> }

export function lireMkv(src: Source, f: FicheEnCours, ctx: Contexte): void {
  // En-tête EBML.
  const h0 = src.lire(0, 12);
  const eb = entete(h0, 0, 0, src.taille);
  if (eb.id !== ID.EBML || eb.inconnu || eb.fin - eb.donnees > 4096) throw new ErreurFormat('EBML : en-tête invalide');
  const hb = src.lire(0, eb.fin);
  let docType = '';
  for (const e of elementsBuf(hb, eb.donnees, eb.fin, ctx)) {
    if (e.id === ID.DocType) docType = texte(hb, e);
    else if (e.id === ID.MaxIdLen && uint(hb, e) > 4) throw new ErreurFormat('EBML : EBMLMaxIDLength > 4');
    else if (e.id === ID.MaxSizeLen && uint(hb, e) > 8) throw new ErreurFormat('EBML : EBMLMaxSizeLength > 8');
  }
  if (docType && docType !== 'webm' && docType !== 'matroska') remarque(f, `type de document EBML : ${docType}`);
  // Segment.
  let seg: El | undefined;
  for (const e of elementsSource(src, eb.fin, src.taille, ctx)) { if (e.id === ID.Segment) { seg = e; break; } }
  if (!seg) throw new ErreurFormat('Matroska : aucun Segment');
  if (seg.fin > src.taille) seg.fin = src.taille;
  const etat: EtatMkv = { echelle: 1_000_000, pistesParUid: new Map(), titres: [] };
  const vus = new Set<number>();
  const aVoir: number[] = [];
  const seekHeads = new Set<number>();
  let partielCluster = false;
  const traiter = (e: El, prof: number) => {
    if (vus.has(e.debut)) return;
    vus.add(e.debut);
    switch (e.id) {
      case ID.SeekHead: seekHeads.add(e.debut); if (prof <= ctx.budget.bornes.mkvSeekProfondeur) lireSeekHead(lireTout(src, e, f), seg!, aVoir, ctx); break;
      case ID.Info: lireInfo(lireTout(src, e, f), e, f, ctx, etat); break;
      case ID.Tracks: lireTracks(lireTout(src, e, f), e, f, ctx, etat); break;
      case ID.Tags: lireTags(lireTout(src, e, f), e, f, ctx, etat); break;
      case ID.Chapters: lireChapitres(lireTout(src, e, f), e, f, ctx); break;
      case ID.Attachments: lirePiecesJointes(src, e, f, ctx); break;
      default: break;
    }
  };
  for (const e of elementsSource(src, seg.donnees, seg.fin, ctx)) {
    if (e.id === ID.Cluster) {
      if (e.inconnu) { partielCluster = true; break; }
      continue;
    }
    if (e.inconnu) { coupure(f, 'élément de taille inconnue hors d\'un Cluster'); break; }
    traiter(e, 1);
  }
  // Positions données par le SeekHead (y compris un SeekHead second, profondeur 2).
  for (let i = 0; i < aVoir.length && i < 64; i++) {
    const p = aVoir[i];
    if (vus.has(p)) { if (seekHeads.has(p)) coupure(f, 'SeekHead qui se cite lui-même : boucle évitée'); continue; }
    if (p >= seg.fin) continue;
    try {
      const h = src.lire(p, 12);
      const e = entete(h, 0, p, seg.fin);
      if (e.inconnu) continue;
      traiter(e, e.id === ID.SeekHead ? 2 : 1);
    } catch (x) { coupure(f, `SeekHead : position invalide (${(x as Error).message})`); }
  }
  if (partielCluster && aVoir.length === 0) coupure(f, 'Cluster de taille inconnue : Tags et chapitres peut-être en fin de fichier, non atteints');
  // Titres : cible 30 = titre (et cible 50 = album), sinon cible 50 = titre.
  const t30 = etat.titres.find((t) => t.cible === 30), t50 = etat.titres.find((t) => t.cible === 50 || t.cible === 0);
  if (t30) { ajouterChamp(f, ctx, 'titre', t30.v, 'MKV:Tags:TITLE'); if (t50) ajouterChamp(f, ctx, 'album', t50.v, 'MKV:Tags:TITLE(50)'); }
  else if (t50) ajouterChamp(f, ctx, 'titre', t50.v, 'MKV:Tags:TITLE');
  if (etat.duree !== undefined) f.dureeSec = Math.round((etat.duree * etat.echelle) / 1e9 * 1000) / 1000;
  const v = f.pistes.find((p) => p.genre === 'vidéo');
  if (v && !f.largeur) { f.largeur = v.largeurAffichee ?? v.largeur; f.hauteur = v.hauteurAffichee ?? v.hauteur; }
  if (f.nature.famille === 'video' && !v && f.pistes.some((p) => p.genre === 'son')) { f.nature.famille = 'son'; f.nature.alertes.push('aucune piste vidéo : son seul'); f.nature.nom = f.nature.format === 'webm' ? 'Son WebM' : 'Son Matroska'; }
}

function lireTout(src: Source, e: El, f: FicheEnCours): Buffer {
  const n = e.fin - e.debut;
  if (n > 16 * 1024 * 1024) { coupure(f, `élément 0x${e.id.toString(16)} de ${n} octets non lu`); return Buffer.alloc(0); }
  return src.lire(e.debut, n);
}

function lireSeekHead(b: Buffer, seg: El, aVoir: number[], ctx: Contexte): void {
  if (!b.length) return;
  const e0 = entete(b, 0, 0, b.length);
  for (const s of elementsBuf(b, e0.donnees, e0.fin, ctx)) {
    if (s.id !== ID.Seek) continue;
    let pos: number | undefined;
    for (const c of elementsBuf(b, s.donnees, s.fin, ctx)) if (c.id === ID.SeekPos) pos = uint(b, c);
    if (pos !== undefined && aVoir.length < 256) aVoir.push(seg.donnees + pos);
  }
}

function lireInfo(b: Buffer, _e: El, f: FicheEnCours, ctx: Contexte, etat: EtatMkv): void {
  if (!b.length) return;
  const e0 = entete(b, 0, 0, b.length);
  for (const e of elementsBuf(b, e0.donnees, e0.fin, ctx)) {
    switch (e.id) {
      case ID.Scale: { const s = uint(b, e); if (s > 0) etat.echelle = s; break; }
      case ID.Duration: { const d = flottant(b, e, f); if (d !== undefined && Number.isFinite(d) && d >= 0) etat.duree = d; else if (d !== undefined) remarque(f, 'durée Matroska invalide ignorée'); break; }
      case ID.DateUTC: {
        const d = dateDepuis2001(bigint(b, e), 'création du fichier', ctx.maintenant);
        if (d) { ajouterDate(f, ctx, 'date_creation_fichier', d, 'MKV:Info:DateUTC', { sensible: true }); candidatPrise(ctx, { ...d, role: 'prise de vue' }, 7, 'MKV:Info:DateUTC', true); }
        break;
      }
      case ID.Title: etat.titres.push({ cible: 0, v: texte(b, e) }); break;
      case ID.MuxingApp: case ID.WritingApp: { const t = texte(b, e); if (t) { ajouterChamp(f, ctx, 'logiciel', t, e.id === ID.MuxingApp ? 'MKV:Info:MuxingApp' : 'MKV:Info:WritingApp', { sousRang: e.id === ID.MuxingApp ? 1 : 0 }); if (t.startsWith('Lavf')) remarque(f, 'passée par FFmpeg (réencodage possible)'); } break; }
      default: break;
    }
  }
}

function lireTracks(b: Buffer, _e: El, f: FicheEnCours, ctx: Contexte, etat: EtatMkv): void {
  if (!b.length) return;
  const e0 = entete(b, 0, 0, b.length);
  for (const t of elementsBuf(b, e0.donnees, e0.fin, ctx)) {
    if (t.id !== ID.TrackEntry) continue;
    if (f.pistes.length >= ctx.budget.bornes.pistes) {
      // Les pistes au-delà de la borne ne sont pas lues : la fiche est dite partielle, pas « lue ».
      const r = `plus de ${ctx.budget.bornes.pistes} pistes : les suivantes ne sont pas lues`;
      if (!f.partiel) f.partiel = r;
      remarque(f, r);
      break;
    }
    const p: Piste = { index: f.pistes.length, genre: 'autre' };
    let uid = '', langue: string | undefined, bcp: string | undefined;
    for (const c of elementsBuf(b, t.donnees, t.fin, ctx)) {
      switch (c.id) {
        case ID.TrackUID: uid = ubig(b, c); break;
        case ID.TrackType: { const v = uint(b, c); p.genre = v === 1 ? 'vidéo' : v === 2 ? 'son' : v === 0x11 ? 'sous-titres' : v === 0x21 || v === 0x20 ? 'données' : 'autre'; break; }
        case ID.FlagDefault: p.parDefaut = uint(b, c) === 1; break;
        case ID.FlagForced: if (uint(b, c) === 1) p.forcee = true; break;
        case ID.Name: p.nom = texte(b, c) || undefined; break;
        case ID.Language: langue = texte(b, c); break;
        case ID.LanguageBCP47: bcp = texte(b, c); break;
        case ID.CodecID: { const id = texte(b, c); p.codecBrut = id; p.codec = CODECS[id] ?? id; if (id === 'S_HDMV/PGS' || id === 'S_VOBSUB' || id === 'S_DVBSUB') p.texteEnImages = true; break; }
        case ID.DefaultDuration: { const ns = uint(b, c); if (ns > 0) p.imagesParSeconde = Math.round((1e9 / ns) * 1000) / 1000; break; }
        case ID.Video:
          for (const v of elementsBuf(b, c.donnees, c.fin, ctx)) {
            if (v.id === ID.PixelWidth) p.largeur = uint(b, v); else if (v.id === ID.PixelHeight) p.hauteur = uint(b, v);
            else if (v.id === ID.DisplayWidth) p.largeurAffichee = uint(b, v); else if (v.id === ID.DisplayHeight) p.hauteurAffichee = uint(b, v);
          }
          break;
        case ID.Audio:
          for (const a of elementsBuf(b, c.donnees, c.fin, ctx)) {
            if (a.id === ID.Sampling || a.id === ID.OutSampling) { const fs = flottant(b, a, f); if (fs && Number.isFinite(fs) && fs > 0 && fs < 1e7) p.frequenceHz = Math.round(fs); }
            else if (a.id === ID.Channels) p.canaux = uint(b, a); else if (a.id === ID.BitDepth) p.bitsParEchantillon = uint(b, a);
          }
          break;
        default: break;
      }
    }
    // Langue : absente → non déclarée (jamais « eng ») ; LanguageBCP47 l'emporte.
    const l = versBcp47(bcp) ?? versBcp47(langue);
    if (l) { p.langueDeclaree = l; ajouterLangue(f, l, `MKV:Tracks:${p.index}`); }
    if (p.genre === 'vidéo' && p.largeurAffichee === p.largeur && p.hauteurAffichee === p.hauteur) { delete p.largeurAffichee; delete p.hauteurAffichee; }
    if (p.genre === 'vidéo' && p.imagesParSeconde === undefined) delete p.imagesParSeconde;
    if (p.genre !== 'vidéo') delete p.imagesParSeconde;
    if (uid) etat.pistesParUid.set(uid, p);
    f.pistes.push(p);
  }
}

function lireTags(b: Buffer, _e: El, f: FicheEnCours, ctx: Contexte, etat: EtatMkv): void {
  if (!b.length) return;
  const e0 = entete(b, 0, 0, b.length);
  for (const tag of elementsBuf(b, e0.donnees, e0.fin, ctx)) {
    if (tag.id !== ID.Tag) continue;
    let cible = 50;
    const pistes: string[] = [];
    const simples: El[] = [];
    for (const c of elementsBuf(b, tag.donnees, tag.fin, ctx)) {
      if (c.id === ID.Targets) for (const t of elementsBuf(b, c.donnees, c.fin, ctx)) { if (t.id === ID.TargetTypeValue) cible = uint(b, t); else if (t.id === ID.TagTrackUID) pistes.push(ubig(b, t)); }
      else if (c.id === ID.SimpleTag) simples.push(c);
    }
    const piste = pistes.length ? etat.pistesParUid.get(pistes[0]) : undefined;
    for (const s of simples) lireSimpleTag(b, s, f, ctx, etat, cible, piste, 1, '');
  }
}

function lireSimpleTag(b: Buffer, s: El, f: FicheEnCours, ctx: Contexte, etat: EtatMkv, cible: number, piste: Piste | undefined, prof: number, parent: string): void {
  if (prof > ctx.budget.bornes.mkvSimpleTag) { coupure(f, `SimpleTag imbriqués au-delà de ${ctx.budget.bornes.mkvSimpleTag}`); return; }
  let nom = '', valeur = '', langue: string | undefined;
  const enfants: El[] = [];
  for (const c of elementsBuf(b, s.donnees, s.fin, ctx)) {
    if (c.id === ID.TagName) nom = texte(b, c).toUpperCase();
    else if (c.id === ID.TagString) valeur = texte(b, c);
    else if (c.id === ID.TagLanguage) langue = versBcp47(texte(b, c));
    else if (c.id === ID.TagLanguageBCP47) langue = versBcp47(texte(b, c)) ?? langue;
    else if (c.id === ID.SimpleTag) enfants.push(c);
  }
  const plein = parent ? `${parent}/${nom}` : nom;
  const src = `MKV:Tags:${plein.slice(0, 60)}`;
  if (nom && valeur) {
    if (piste && (STATS.has(nom) || nom.startsWith('_STATISTICS'))) {
      if (nom === 'BPS') { const n = Number(valeur); if (Number.isFinite(n) && n > 0) piste.debitKbps = Math.round(n / 1000); }
      else if (nom === 'DURATION') { const d = dureeTexte(valeur); if (d !== undefined) piste.dureeSec = d; }
    } else if (piste && nom === 'TITLE') { piste.nom ??= valeur; }
    else if (piste) ajouterChamp(f, ctx, `x:piste${piste.index + 1}:${plein.slice(0, 48)}`, valeur, src, { nom: `Piste ${piste.index + 1} · ${plein.slice(0, 48)}`, groupe: 'pistes', langue });
    else if (nom === 'TITLE' && !parent) etat.titres.push({ cible, v: valeur });
    else if (nom === 'PART_NUMBER' && cible === 30) ajouterChamp(f, ctx, 'piste', valeur, src);
    else if (nom === 'TOTAL_PARTS') { const p = f.champs.find((c) => c.cle === 'piste' && !c.valeur.includes('/')); if (p) p.valeur += `/${valeur}`; }
    else if (nom === 'ISRC') ajouterIsrc(f, ctx, valeur, src);
    else if (nom === 'DATE_RECORDED') ajouterDate(f, ctx, 'date_enregistrement', lireDateIso(valeur, 'enregistrement', ctx.maintenant), src);
    else if (nom === 'DATE_RELEASED') ajouterDate(f, ctx, 'date_parution', lireDateIso(valeur, 'parution', ctx.maintenant), src);
    else if (nom === 'DATE_DIGITIZED' || nom === 'DATE_ENCODED' || nom === 'DATE_TAGGED' || nom === 'DATE_WRITTEN') ajouterDate(f, ctx, `x:${nom.toLowerCase()}`, lireDateIso(valeur, 'encodage', ctx.maintenant), src, { nom: nom, groupe: 'logiciel' });
    else if (nom === 'RECORDING_LOCATION') {
      ajouterChamp(f, ctx, 'lieu_enregistrement', valeur, src);
      const p = lireIso6709(valeur, src);
      if (typeof p !== 'string') candidatPosition(f, ctx, p, 5);
    } else {
      const t = TAGS[nom];
      if (t) { if (t[0] === 'droits' || t[0] === 'production_droits') ctx.travail.droitsBruts.push(valeur); ajouterChamp(f, ctx, t[0], valeur, src, { langue, sousRang: t[1] ?? 0, fiabilite: 'sure' }); }
      else if (STATS.has(nom) || nom.startsWith('_STATISTICS')) ajouterChamp(f, ctx, `x:${nom.toLowerCase()}`, valeur, src, { nom, groupe: 'technique', fiabilite: 'probable' });
      else ajouterChamp(f, ctx, `x:${plein.slice(0, 64)}`, valeur, src, { nom: plein.slice(0, 64), groupe: 'œuvre', langue });
    }
  }
  for (const c of enfants) lireSimpleTag(b, c, f, ctx, etat, cible, piste, prof + 1, plein);
}

/** « 00:01:02.500000000 » → secondes. */
function dureeTexte(s: string): number | undefined {
  const p = s.split(':');
  if (p.length !== 3) return undefined;
  const v = Number(p[0]) * 3600 + Number(p[1]) * 60 + Number(p[2]);
  return Number.isFinite(v) && v >= 0 ? Math.round(v * 1000) / 1000 : undefined;
}

function lireChapitres(b: Buffer, _e: El, f: FicheEnCours, ctx: Contexte): void {
  if (!b.length) return;
  const e0 = entete(b, 0, 0, b.length);
  const atome = (a: El, prof: number) => {
    if (prof > 4 || f.chapitres.length >= 1000) return;
    let debut = 0, fin: number | undefined, titre = '', langue: string | undefined;
    for (const c of elementsBuf(b, a.donnees, a.fin, ctx)) {
      if (c.id === ID.ChapStart) debut = uint(b, c) / 1e9;
      else if (c.id === ID.ChapEnd) fin = uint(b, c) / 1e9;
      else if (c.id === ID.ChapDisplay && !titre) for (const d of elementsBuf(b, c.donnees, c.fin, ctx)) {
        if (d.id === ID.ChapString) titre = texte(b, d);
        else if (d.id === ID.ChapLanguage) langue ??= versBcp47(texte(b, d));
        else if (d.id === ID.ChapLanguageBCP47) langue = versBcp47(texte(b, d)) ?? langue;
      } else if (c.id === ID.ChapterAtom) atome(c, prof + 1);
    }
    f.chapitres.push({ debutSec: Math.round(debut * 1000) / 1000, finSec: fin !== undefined ? Math.round(fin * 1000) / 1000 : undefined, titre: titre || `Chapitre ${f.chapitres.length + 1}`, langue });
  };
  for (const ed of elementsBuf(b, e0.donnees, e0.fin, ctx)) {
    if (ed.id !== ID.Edition) continue;
    for (const a of elementsBuf(b, ed.donnees, ed.fin, ctx)) if (a.id === ID.ChapterAtom) atome(a, 1);
  }
  f.chapitres.sort((a, b2) => a.debutSec - b2.debutSec);
}

function lirePiecesJointes(src: Source, e: El, f: FicheEnCours, ctx: Contexte): void {
  for (const a of elementsSource(src, e.donnees, e.fin, ctx)) {
    if (a.id !== ID.AttachedFile || a.inconnu) continue;
    let nom = '', type = '', desc = '', data: El | undefined;
    for (const c of elementsSource(src, a.donnees, a.fin, ctx)) {
      if (c.id === ID.FileData) { data = c; continue; }
      if (c.fin - c.donnees > 65536) continue;
      const b = src.lire(c.donnees, c.fin - c.donnees);
      const t = nettoyerTexte(b, 'utf-8', { nul: true }).texte;
      if (c.id === ID.FileName) nom = t; else if (c.id === ID.FileMediaType) type = t; else if (c.id === ID.FileDescription) desc = t;
    }
    if (type.startsWith('image/') && data) {
      const n = data.fin - data.donnees;
      const tete = src.lire(data.donnees, Math.min(n, 64));
      const role = nom.toLowerCase().includes('cover') ? 'pochette' : 'autre';
      if (n <= ctx.budget.bornes.imageJointe) ajouterImage(f, { role, format: formatImage(tete), mimeDeclare: type, description: desc || nom || undefined, decalage: data.donnees, taille: n, codage: 'brut' });
      else remarque(f, `pièce jointe trop grosse : ${nom} (${type})`);
    } else remarque(f, `pièce jointe : ${nom || 'sans nom'} (${type || 'type inconnu'})`);
  }
}
