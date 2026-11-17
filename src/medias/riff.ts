// Médias reçus : RIFF / RF64 / BW64. WAV (fmt, data, fact, LIST INFO, bext, iXML, id3, ds64), AVI (avih, strl, odml,
// INFO, IDIT ; movi, idx1 et JUNK sautés sans lecture), et le parcours des morceaux d'un WebP. Une taille annoncée
// plus grande que le fichier est bornée au fichier (durée alors dite estimée) ; un morceau impair au bord arrête.

import type { Contexte, FicheEnCours, Piste } from './contrat.ts';
import { ErreurFormat } from './contrat.ts';
import { ajouterChamp, ajouterDate, ajouterLangue, ajouterManque, candidatPrise, remarque } from './champs.ts';
import { lireDateAvi, lireDateIso } from './dates.ts';
import { lireId3v2 } from './id3.ts';
import { versBcp47 } from './langues-codes.ts';
import { nettoyerTexte, type Source } from './octets.ts';
import { coupure } from './tiff.ts';
import { lireXml } from './xml.ts';

export interface Morceau { id: string; donnees: number; taille: number; tailleAnnoncee: number; fin: number }

/** Les morceaux RIFF d'un intervalle (en-têtes lus un par un). */
export function* morceauxRiff(src: Source, debut: number, fin: number, ctx: Contexte, f: FicheEnCours): Generator<Morceau> {
  let p = debut;
  const limite = Math.min(fin, src.taille);
  while (p + 8 <= limite) {
    ctx.budget.pas();
    const h = src.lire(p, 8);
    const id = h.toString('latin1', 0, 4), annoncee = h.readUInt32LE(4);
    const donnees = p + 8;
    const taille = Math.min(annoncee, limite - donnees);
    if (annoncee > limite - donnees && id !== 'data' && id !== 'movi' && id !== 'LIST') coupure(f, `morceau ${nomId(id)} plus long que son parent`);
    yield { id, donnees, taille, tailleAnnoncee: annoncee, fin: donnees + taille };
    const suivant = donnees + taille + (taille & 1);
    if (suivant <= p) return;
    if (taille & 1 && suivant > limite) return;
    p = suivant;
  }
}
const nomId = (t: string) => { let r = ''; for (const c of t) r += c >= ' ' && c <= '~' ? c : '?'; return r; };

const CODECS_WAV: Record<number, string> = { 1: 'PCM', 2: 'MS ADPCM', 3: 'PCM flottant', 6: 'A-law', 7: 'µ-law', 0x11: 'IMA ADPCM', 0x50: 'MPEG', 0x55: 'MP3', 0xff: 'AAC', 0x161: 'WMA', 0x2000: 'AC-3', 0xfffe: 'extensible' };
const INFO: Record<string, string> = {
  INAM: 'titre', IART: 'artiste', IPRD: 'album', ICMT: 'commentaire', ICOP: 'droits', IGNR: 'genre', ISFT: 'logiciel', IENG: 'ingenieur',
  IKEY: 'mots_cles', IMED: 'support', ITRK: 'piste', IPRT: 'piste', ISBJ: 'x:Sujet', ITCH: 'x:Technicien', ICMS: 'x:Commanditaire', IARL: 'x:Archive',
  ISRC: 'x:Source', ISRF: 'x:Support source', ICRP: 'x:Recadrage', IDIM: 'x:Dimensions d\'origine', IDPI: 'x:Résolution', ILGT: 'x:Luminosité',
  IPLT: 'x:Palette', ISHP: 'x:Netteté', IWRI: 'parolier', IMUS: 'compositeur', IPRO: 'producteur', ICNM: 'x:Directeur photo', ISTR: 'interprete',
  IEDT: 'x:Monteur', ICNT: 'pays', IAS1: 'x:Langue 1', TORG: 'label', TURL: 'x:Lien', TVER: 'x:Version', ILOC: 'lieu_enregistrement', ISTD: 'label',
};

/** LIST INFO : chaînes terminées par NUL, Latin-1 par défaut (encodage douteux si octets ≥ 0x80 et pas de l'UTF-8 valide). */
function lireInfo(src: Source, m: Morceau, f: FicheEnCours, ctx: Contexte, origine: string, video: boolean): void {
  for (const c of morceauxRiff(src, m.donnees + 4, m.fin, ctx, f)) {
    const b = src.lire(c.donnees, Math.min(c.taille, 65536));
    const u = nettoyerTexte(b, 'utf-8', { nul: true });
    const t = u.encodageDouteux ? nettoyerTexte(b, 'latin1', { nul: true }) : u;
    if (!t.texte) continue;
    const s = `${origine}:INFO:${nomId(c.id)}`;
    if (c.id === 'ICRD') {
      const d = lireDateIso(t.texte, 'enregistrement', ctx.maintenant);
      if (video) candidatPrise(ctx, d ? { ...d, role: 'prise de vue' } : undefined, 9, s);
      else ajouterDate(f, ctx, 'date_enregistrement', d, s);
      if (!d) ajouterChamp(f, ctx, 'x:date_brute', t.texte, s, { nom: 'Date (texte brut)', groupe: 'œuvre', fiabilite: 'douteuse' });
      continue;
    }
    if (c.id === 'ILNG') { const l = versBcp47(t.texte); if (l) { ajouterChamp(f, ctx, 'langue_declaree', l, s); ajouterLangue(f, l, s); } continue; }
    const cle = INFO[c.id];
    if (cle === 'droits') ctx.travail.droitsBruts.push(t.texte);
    if (cle) ajouterChamp(f, ctx, cle, t.texte, s, { nom: cle.startsWith('x:') ? cle.slice(2) : undefined, groupe: cle.startsWith('x:') ? 'œuvre' : undefined, encodageDouteux: u.encodageDouteux && t.encodageDouteux });
    else ajouterChamp(f, ctx, `x:${nomId(c.id)}`, t.texte, s, { nom: nomId(c.id), groupe: 'œuvre' });
  }
}

/** WAV (RIFF, RF64, BW64). */
export function lireWav(src: Source, f: FicheEnCours, ctx: Contexte): void {
  const h = src.lire(0, 12);
  const forme = h.toString('latin1', 0, 4);
  const annoncee = h.readUInt32LE(4);
  if (forme === 'RIFF' && annoncee + 8 > src.taille) coupure(f, `taille RIFF annoncée (${annoncee} octets) plus grande que le fichier`);
  const piste: Piste = { index: 0, genre: 'son' };
  let octetsAudio: number | undefined, echantillons: number | undefined, fmt = false, dataEstimee = false;
  let ds64: { data: number; echantillons: number } | undefined;
  for (const m of morceauxRiff(src, 12, src.taille, ctx, f)) {
    switch (m.id) {
      case 'ds64': {
        const b = src.lire(m.donnees, Math.min(m.taille, 28));
        if (b.length >= 24) {
          const big = (p: number) => { const v = b.readBigUInt64LE(p); return v > BigInt(src.taille) * 64n ? -1 : Number(v); };
          ds64 = { data: big(8), echantillons: big(16) };
        }
        break;
      }
      case 'fmt ': {
        const b = src.lire(m.donnees, Math.min(m.taille, 40));
        if (b.length < 16) throw new ErreurFormat('WAV : fmt trop court');
        let code = b.readUInt16LE(0);
        piste.canaux = b.readUInt16LE(2); piste.frequenceHz = b.readUInt32LE(4); piste.bitsParEchantillon = b.readUInt16LE(14) || undefined;
        piste.debitKbps = Math.round((b.readUInt32LE(8) * 8) / 1000) || undefined;
        if (code === 0xfffe && b.length >= 26) code = b.readUInt16LE(24);
        piste.codec = CODECS_WAV[code] ?? `format 0x${code.toString(16)}`; piste.codecBrut = `wav:${code}`;
        if (!(piste.frequenceHz > 0)) throw new ErreurFormat('WAV : fréquence nulle');
        fmt = true;
        break;
      }
      case 'fact': { const b = src.lire(m.donnees, 4); if (b.length === 4) echantillons = b.readUInt32LE(0); break; }
      case 'data': {
        if (m.tailleAnnoncee === 0xffffffff && ds64 && ds64.data >= 0) octetsAudio = Math.min(ds64.data, src.taille - m.donnees);
        else octetsAudio = m.taille;
        if (m.tailleAnnoncee > src.taille - m.donnees && !(ds64 && ds64.data >= 0 && ds64.data <= src.taille - m.donnees)) { dataEstimee = true; remarque(f, 'taille des données audio plus grande que le fichier : bornée'); }
        if (m.tailleAnnoncee === 0xffffffff || m.tailleAnnoncee > src.taille) {
          // Morceau data sans fin réelle : on cherche les morceaux de queue au-delà du son (rare) sans les lire en entier.
          return finirWav();
        }
        break;
      }
      case 'LIST': {
        const t = src.lire(m.donnees, 4).toString('latin1');
        if (t === 'INFO') lireInfo(src, m, f, ctx, 'RIFF', false);
        break;
      }
      case 'bext': lireBext(src.lire(m.donnees, Math.min(m.taille, 64 * 1024)), f, ctx); break;
      case 'iXML': lireIxml(src.lire(m.donnees, Math.min(m.taille, 1024 * 1024)), f, ctx); break;
      case 'id3 ': case 'ID3 ': lireId3v2(src, m.donnees, f, ctx); break;
      default: break;
    }
  }
  return finirWav();
  function finirWav(): void {
    if (!fmt) throw new ErreurFormat('WAV : morceau fmt absent');
    const fs = piste.frequenceHz!;
    if (ds64 && ds64.echantillons > 0) f.dureeSec = ds64.echantillons / fs;
    else if (echantillons && piste.codec !== 'PCM' && piste.codec !== 'PCM flottant') f.dureeSec = echantillons / fs;
    else if (octetsAudio !== undefined && piste.debitKbps) { f.dureeSec = (octetsAudio * 8) / (piste.debitKbps * 1000); if (piste.canaux && piste.bitsParEchantillon && piste.codec?.startsWith('PCM')) f.dureeSec = octetsAudio / (piste.canaux * (piste.bitsParEchantillon / 8) * fs); }
    if (f.dureeSec !== undefined) { f.dureeSec = Math.round(f.dureeSec * 1000) / 1000; piste.dureeSec = f.dureeSec; }
    if (dataEstimee) f.dureeEstimee = true;
    f.pistes.push(piste);
  }
}

/** Broadcast Wave (bext). */
function lireBext(b: Buffer, f: FicheEnCours, ctx: Contexte): void {
  if (b.length < 346) { remarque(f, 'bext trop court'); return; }
  const t = (a: number, z: number) => nettoyerTexte(b.subarray(a, z), 'latin1', { nul: true }).texte;
  const desc = t(0, 256), orig = t(256, 288), ref = t(288, 320), date = t(320, 330), heure = t(330, 338);
  if (desc) ajouterChamp(f, ctx, 'description', desc, 'RIFF:bext:Description');
  if (orig) ajouterChamp(f, ctx, 'x:bext_originator', orig, 'RIFF:bext:Originator', { nom: 'Origine (studio, appareil)', groupe: 'personnes' });
  if (ref) ajouterChamp(f, ctx, 'x:bext_reference', ref, 'RIFF:bext:OriginatorReference', { nom: 'Référence d\'origine', groupe: 'technique' });
  if (date) ajouterDate(f, ctx, 'date_enregistrement', lireDateIso(`${date}${heure ? `T${heure.split('-').join(':').split('.').join(':')}` : ''}`, 'enregistrement', ctx.maintenant), 'RIFF:bext:OriginationDate');
  const tr = b.readUInt32LE(338) + b.readUInt32LE(342) * 2 ** 32;
  if (tr) ajouterChamp(f, ctx, 'x:bext_timereference', String(tr), 'RIFF:bext:TimeReference', { nom: 'Référence de temps (échantillons)', groupe: 'technique' });
  if (b.length > 602) { const h = t(602, b.length); if (h) ajouterChamp(f, ctx, 'x:bext_historique', h, 'RIFF:bext:CodingHistory', { nom: 'Historique de codage', groupe: 'technique' }); }
}

/** iXML : PROJECT, SCENE, TAKE, NOTE (et quelques autres) en champs libres. */
function lireIxml(b: Buffer, f: FicheEnCours, ctx: Contexte): void {
  try {
    const t = nettoyerTexte(b, 'utf-8', { max: 1024 * 1024 }).texte;
    const x = lireXml(t.slice(Math.max(0, t.indexOf('<'))), { profondeur: ctx.budget.bornes.profondeurXml });
    const racine = x.enfants.find((n) => n.local === 'BWFXML');
    if (!racine) return;
    for (const n of racine.enfants) {
      const t = n.texte.trim();
      if (!t || n.enfants.length) continue;
      if (['PROJECT', 'SCENE', 'TAKE', 'NOTE', 'TAPE', 'UBITS', 'CIRCLED'].includes(n.local)) ajouterChamp(f, ctx, `x:ixml_${n.local.toLowerCase()}`, t, `RIFF:iXML:${n.local}`, { nom: `iXML ${n.local}`, groupe: 'œuvre' });
    }
  } catch (e) { coupure(f, `iXML : ${(e as Error).message}`); }
}

// ─────────────────────────────── AVI ───────────────────────────────

export function lireAvi(src: Source, f: FicheEnCours, ctx: Contexte): void {
  const h = src.lire(0, 12);
  if (h.readUInt32LE(4) + 8 > src.taille) coupure(f, 'taille RIFF annoncée plus grande que le fichier');
  let usParImage = 0, images = 0, imagesOdml = 0, flux = 0, chunks = 0;
  const visiter = (debut: number, fin: number, prof: number) => {
    ctx.budget.profondeur(prof);
    for (const m of morceauxRiff(src, debut, fin, ctx, f)) {
      if (++chunks > ctx.budget.bornes.aviChunksEntete) { coupure(f, 'AVI : trop de morceaux d\'en-tête'); return; }
      if (m.id === 'LIST') {
        const t = src.lire(m.donnees, 4).toString('latin1');
        if (t === 'movi') continue;
        if (t === 'INFO') { lireInfo(src, m, f, ctx, 'RIFF', true); continue; }
        if (t === 'strl') { if (++flux > ctx.budget.bornes.aviFlux) { coupure(f, 'AVI : trop de flux'); continue; } lireStrl(src, m, f, ctx); continue; }
        visiter(m.donnees + 4, m.fin, prof + 1);
      } else if (m.id === 'avih') {
        const b = src.lire(m.donnees, Math.min(m.taille, 56));
        if (b.length >= 40) { usParImage = b.readUInt32LE(0); images = b.readUInt32LE(16); const L = b.readUInt32LE(32), H = b.readUInt32LE(36); if (L && H && L < 100000 && H < 100000) { f.largeur = L; f.hauteur = H; } }
      } else if (m.id === 'dmlh') { const b = src.lire(m.donnees, 4); if (b.length === 4) imagesOdml = b.readUInt32LE(0); }
      else if (m.id === 'IDIT') {
        const t = nettoyerTexte(src.lire(m.donnees, Math.min(m.taille, 64)), 'latin1', { nul: true }).texte;
        const d = lireDateAvi(t, 'prise de vue', ctx.maintenant);
        if (d) candidatPrise(ctx, d, 8, 'AVI:IDIT');
        else if (t) ajouterChamp(f, ctx, 'x:idit', t, 'AVI:IDIT', { nom: 'Date d\'enregistrement (texte brut)', groupe: 'prise de vue', fiabilite: 'douteuse', sensible: true });
      }
    }
  };
  visiter(12, src.taille, 1);
  const n = imagesOdml || images;
  if (usParImage && n) f.dureeSec = Math.round((n * usParImage) / 1e6 * 1000) / 1000;
  else ajouterManque(f, { quoi: 'la durée', raison: 'absente de l\'en-tête AVI', code: 'absent' });
  if (!f.pistes.length) throw new ErreurFormat('AVI : aucun flux décrit');
}

const FCC_VIDEO: Record<string, string> = { H264: 'H.264 (AVC)', h264: 'H.264 (AVC)', avc1: 'H.264 (AVC)', XVID: 'MPEG-4 Part 2 (Xvid)', DIVX: 'MPEG-4 Part 2 (DivX)', DX50: 'MPEG-4 Part 2 (DivX 5)', MJPG: 'Motion JPEG', mjpg: 'Motion JPEG', HEVC: 'H.265 (HEVC)', FMP4: 'MPEG-4 Part 2' };

function lireStrl(src: Source, m: Morceau, f: FicheEnCours, ctx: Contexte): void {
  const piste: Piste = { index: f.pistes.length, genre: 'autre' };
  for (const c of morceauxRiff(src, m.donnees + 4, m.fin, ctx, f)) {
    const b = src.lire(c.donnees, Math.min(c.taille, 256));
    if (c.id === 'strh' && b.length >= 36) {
      const type = b.toString('latin1', 0, 4);
      piste.genre = type === 'vids' ? 'vidéo' : type === 'auds' ? 'son' : type === 'txts' ? 'sous-titres' : 'autre';
      const scale = b.readUInt32LE(20), rate = b.readUInt32LE(24), longueur = b.readUInt32LE(32);
      if (piste.genre === 'vidéo' && scale && rate) piste.imagesParSeconde = Math.round((rate / scale) * 100) / 100;
      if (scale && rate && longueur) piste.dureeSec = Math.round((longueur * scale / rate) * 1000) / 1000;
      if (piste.genre === 'vidéo') { const h = b.toString('latin1', 4, 8); piste.codecBrut = h; }
    } else if (c.id === 'strf') {
      if (piste.genre === 'vidéo' && b.length >= 20) {
        piste.largeur = Math.abs(b.readInt32LE(4)); piste.hauteur = Math.abs(b.readInt32LE(8));
        const cmp = b.toString('latin1', 16, 20);
        piste.codecBrut = cmp; piste.codec = FCC_VIDEO[cmp] ?? nomId(cmp);
      } else if (piste.genre === 'son' && b.length >= 16) {
        const code = b.readUInt16LE(0);
        piste.codec = CODECS_WAV[code] ?? `format 0x${code.toString(16)}`; piste.codecBrut = `wav:${code}`;
        piste.canaux = b.readUInt16LE(2); piste.frequenceHz = b.readUInt32LE(4); piste.debitKbps = Math.round(b.readUInt32LE(8) * 8 / 1000) || undefined;
      }
    } else if (c.id === 'strn') { const t = nettoyerTexte(b, 'latin1', { nul: true }).texte; if (t) piste.nom = t; }
  }
  f.pistes.push(piste);
}
