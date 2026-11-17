// Médias reçus : les sons. MP3 (trames, Xing/Info, LAME, VBRI), AAC ADTS, FLAC (STREAMINFO, commentaires, images),
// Ogg (Vorbis, Opus, FLAC, Speex, Theora), AIFF/AIFC, AMR, MIDI, Monkey's Audio, WavPack. La durée est exacte quand le
// fichier la donne, sinon estimée et dite estimée.

import type { Contexte, FicheEnCours, Piste } from './contrat.ts';
import { ErreurFormat } from './contrat.ts';
import { ajouterChamp, ajouterManque, remarque } from './champs.ts';
import { lireId3v2, lireQueue } from './id3.ts';
import { nettoyerTexte, type Source } from './octets.ts';
import { lireBlocPicture, lireCommentaires } from './vorbis.ts';

// ─────────────────────────────── MP3 ───────────────────────────────

const DEBITS: Record<string, number[]> = {
  '1-1': [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448],
  '1-2': [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384],
  '1-3': [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
  '2-1': [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256],
  '2-2': [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
};
const FREQS: Record<string, number[]> = { 1: [44100, 48000, 32000], 2: [22050, 24000, 16000], 2.5: [11025, 12000, 8000] };

export interface TrameMp3 { version: 1 | 2 | 2.5; couche: 1 | 2 | 3; debit: number; fs: number; canaux: number; longueur: number; echantillons: number; protection: boolean }

/** En-tête de trame MPEG audio à p ; undefined s'il est invalide. Pur. */
export function trameMp3(b: Uint8Array, p: number): TrameMp3 | undefined {
  if (p + 4 > b.length || b[p] !== 0xff || (b[p + 1] & 0xe0) !== 0xe0) return undefined;
  const vb = (b[p + 1] >> 3) & 3, cb = (b[p + 1] >> 1) & 3;
  if (vb === 1 || cb === 0) return undefined;
  const bi = b[p + 2] >> 4, fi = (b[p + 2] >> 2) & 3, pad = (b[p + 2] >> 1) & 1;
  if (bi === 0 || bi === 15 || fi === 3) return undefined;
  const version = vb === 3 ? 1 : vb === 2 ? 2 : 2.5;
  const couche = (4 - cb) as 1 | 2 | 3;
  const debit = DEBITS[`${version === 1 ? 1 : 2}-${version === 1 ? couche : couche === 1 ? 1 : 2}`][bi];
  const fs = FREQS[String(version)][fi];
  const mode = b[p + 3] >> 6;
  let longueur: number, echantillons: number;
  if (couche === 1) { longueur = (Math.floor((12 * debit * 1000) / fs) + pad) * 4; echantillons = 384; }
  else if (couche === 2 || version === 1) { longueur = Math.floor((144 * debit * 1000) / fs) + pad; echantillons = 1152; }
  else { longueur = Math.floor((72 * debit * 1000) / fs) + pad; echantillons = 576; }
  if (longueur < 4) return undefined;
  return { version, couche, debit, fs, canaux: mode === 3 ? 1 : 2, longueur, echantillons, protection: !(b[p + 1] & 1) };
}

/** Trois trames qui s'enchaînent à partir de p (même version, couche, fréquence). */
export function troisTrames(b: Uint8Array, p: number, n = 3): boolean {
  let q = p, ref: TrameMp3 | undefined;
  for (let i = 0; i < n; i++) {
    const t = trameMp3(b, q);
    if (!t) return false;
    if (ref && (t.version !== ref.version || t.couche !== ref.couche || t.fs !== ref.fs)) return false;
    ref ??= t;
    q += t.longueur;
  }
  return true;
}

/** En-tête ADTS valide à p ; longueur de trame. */
export function trameAdts(b: Uint8Array, p: number): { longueur: number; profil: number; fi: number; canaux: number } | undefined {
  if (p + 7 > b.length || b[p] !== 0xff || (b[p + 1] & 0xf6) !== 0xf0) return undefined;
  const profil = b[p + 2] >> 6, fi = (b[p + 2] >> 2) & 15, canaux = ((b[p + 2] & 1) << 2) | (b[p + 3] >> 6);
  const longueur = ((b[p + 3] & 3) << 11) | (b[p + 4] << 3) | (b[p + 5] >> 5);
  if (fi > 12 || longueur < 7) return undefined;
  return { longueur, profil, fi, canaux };
}

export function lireMp3(src: Source, f: FicheEnCours, ctx: Contexte): void {
  let debut = 0;
  // Balises ID3v2 de tête (parfois plusieurs).
  for (let k = 0; k < 4; k++) { const n = lireId3v2(src, debut, f, ctx, { teteFichier: debut === 0 }); if (!n) break; debut += n; }
  const finAudio = lireQueue(src, f, ctx);
  const zone = src.lire(debut, ctx.budget.bornes.mp3Recherche + 4096);
  let p = -1;
  for (let i = 0; i + 4 <= zone.length && i <= ctx.budget.bornes.mp3Recherche; i++) if (zone[i] === 0xff && enchaine(zone, i)) { p = i; break; }
  if (p < 0) { ajouterManque(f, { quoi: 'la durée et le format audio', raison: 'aucune trame MP3 valide dans les 64 premiers Kio', code: 'illisible' }); return; }
  const t = trameMp3(zone, p)!;
  const piste: Piste = { index: 0, genre: 'son', codec: `MPEG-${t.version === 2.5 ? '2.5' : t.version} couche ${['I', 'II', 'III'][t.couche - 1]}`, codecBrut: 'mp3', frequenceHz: t.fs, canaux: t.canaux, debitKbps: t.debit };
  f.pistes.push(piste);
  // Xing / Info / VBRI.
  const lat = t.version === 1 ? (t.canaux === 1 ? 21 : 36) : (t.canaux === 1 ? 13 : 21);
  const x = p + lat;
  let trames: number | undefined, octets: number | undefined, retrait = 0;
  const tag = zone.toString('latin1', x, x + 4);
  if (tag === 'Xing' || tag === 'Info') {
    const fl = zone.readUInt32BE(x + 4);
    let q = x + 8;
    if (fl & 1) { trames = zone.readUInt32BE(q); q += 4; }
    if (fl & 2) { octets = zone.readUInt32BE(q); q += 4; }
    if (fl & 4) q += 100;
    if (fl & 8) q += 4;
    if (q + 24 <= zone.length) {
      const enc = zone.toString('latin1', q, q + 9);
      if (/^(LAME|Lavc|Lavf|GOGO)/.test(enc)) {
        ajouterChamp(f, ctx, 'encodeur_audio', nettoyerTexte(enc).texte, 'MP3:LAME');
        const d = (zone[q + 21] << 4) | (zone[q + 22] >> 4), pad = ((zone[q + 22] & 15) << 8) | zone[q + 23];
        retrait = d + pad;
      }
    }
    if (tag === 'Xing') piste.debitKbps = undefined;
  } else if (zone.toString('latin1', p + 36, p + 40) === 'VBRI') {
    octets = zone.readUInt32BE(p + 36 + 10); trames = zone.readUInt32BE(p + 36 + 14);
    piste.debitKbps = undefined;
  }
  if (trames && trames > 0) {
    f.dureeSec = Math.round(Math.max(0, (trames * t.echantillons - retrait) / t.fs) * 1000) / 1000;
    if (octets && f.dureeSec > 0) piste.debitKbps = Math.round((octets * 8) / f.dureeSec / 1000);
  } else {
    const audio = Math.max(0, finAudio - (debut + p));
    f.dureeSec = Math.round((audio * 8) / (t.debit * 1000) * 1000) / 1000;
    f.dureeEstimee = true;
  }
  piste.dureeSec = f.dureeSec;
}
/** Trois trames qui s'enchaînent, ou des trames valides jusqu'à la fin des octets lus (petit fichier). */
function enchaine(b: Uint8Array, p: number): boolean {
  let n = 0, q = p, ref: TrameMp3 | undefined;
  while (n < 3) {
    if (q >= b.length - 3) return n > 0;
    const t = trameMp3(b, q);
    if (!t || (ref && (t.version !== ref.version || t.couche !== ref.couche || t.fs !== ref.fs))) return false;
    ref ??= t; n++; q += t.longueur;
  }
  return true;
}

// ─────────────────────────────── AAC ADTS ───────────────────────────────

const OBJETS_ADTS = ['AAC Main', 'AAC-LC', 'AAC SSR', 'AAC LTP'];
const FREQ_AAC = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350];

export function lireAdts(src: Source, f: FicheEnCours, ctx: Contexte): void {
  let debut = f.nature.debut;
  if (debut === 0) { const n = lireId3v2(src, 0, f, ctx, { teteFichier: true }); debut = n; }
  const finAudio = lireQueue(src, f, ctx);
  const z = src.lire(debut, 64 * 1024);
  const a = trameAdts(z, 0);
  if (!a) throw new ErreurFormat('AAC : en-tête ADTS invalide');
  const b = trameAdts(z, a.longueur);
  const fs = FREQ_AAC[a.fi];
  const piste: Piste = { index: 0, genre: 'son', codec: OBJETS_ADTS[a.profil], codecBrut: 'adts', frequenceHz: fs, canaux: a.canaux === 7 ? 8 : a.canaux || undefined };
  const moy = b ? (a.longueur + b.longueur) / 2 : a.longueur;
  const debit = (moy * 8 * fs) / 1024;
  piste.debitKbps = Math.round(debit / 1000);
  f.dureeSec = Math.round(((finAudio - debut) * 8) / debit * 1000) / 1000;
  f.dureeEstimee = true;
  piste.dureeSec = f.dureeSec;
  f.pistes.push(piste);
}

// ─────────────────────────────── FLAC ───────────────────────────────

/** STREAMINFO (34 octets) → piste + durée. */
function streaminfo(b: Buffer, f: FicheEnCours, origine: string): Piste {
  if (b.length < 18) throw new ErreurFormat(`${origine} : STREAMINFO trop court`);
  const fs = (b[10] << 12) | (b[11] << 4) | (b[12] >> 4);
  const canaux = ((b[12] >> 1) & 7) + 1;
  const bits = (((b[12] & 1) << 4) | (b[13] >> 4)) + 1;
  const total = (b[13] & 15) * 2 ** 32 + b.readUInt32BE(14);
  if (fs === 0) throw new ErreurFormat(`${origine} : fréquence nulle`);
  const p: Piste = { index: f.pistes.length, genre: 'son', codec: 'FLAC', codecBrut: 'flac', frequenceHz: fs, canaux, bitsParEchantillon: bits };
  if (total > 0) { p.dureeSec = Math.round((total / fs) * 1000) / 1000; f.dureeSec = p.dureeSec; }
  else ajouterManque(f, { quoi: 'la durée', raison: 'nombre d\'échantillons non donné', code: 'absent' });
  return p;
}

export function lireFlac(src: Source, f: FicheEnCours, ctx: Contexte): void {
  let p = f.nature.debut;
  if (p > 0) { lireId3v2(src, 0, f, ctx, { teteFichier: true }); }
  if (src.lire(p, 4).toString('latin1') !== 'fLaC') throw new ErreurFormat('FLAC : signature absente');
  p += 4;
  let piste: Piste | undefined;
  for (let n = 0; n < ctx.budget.bornes.flacBlocs; n++) {
    ctx.budget.pas();
    const h = src.lire(p, 4);
    if (h.length < 4) throw new ErreurFormat('FLAC : bloc tronqué');
    const dernier = h[0] & 0x80, type = h[0] & 0x7f, l = h.readUIntBE(1, 3);
    if (type === 127) throw new ErreurFormat('FLAC : bloc de type 127 (invalide)');
    if (p + 4 + l > src.taille) throw new ErreurFormat('FLAC : bloc plus long que le fichier');
    if (type === 0) piste = streaminfo(src.lire(p + 4, Math.min(l, 64)), f, 'FLAC');
    else if (type === 4) lireCommentaires(src.lire(p + 4, Math.min(l, 16 * 1024 * 1024)), f, ctx, 'Vorbis', p + 4);
    else if (type === 6) { try { lireBlocPicture(src.lire(p + 4, Math.min(l, ctx.budget.bornes.imageJointe + 64 * 1024)), f, ctx, p + 4, 'FLAC'); } catch (e) { remarque(f, (e as Error).message); } }
    else if (type === 5) remarque(f, 'feuille de repères (CUESHEET) présente');
    p += 4 + l;
    if (dernier) break;
  }
  if (piste) f.pistes.push(piste);
  lireQueue(src, f, ctx);
}

// ─────────────────────────────── Ogg ───────────────────────────────

interface Page { pos: number; type: number; granule: bigint; serie: number; segments: number[]; donnees: number; fin: number }

function page(src: Source, pos: number): Page | undefined {
  const h = src.lire(pos, 27 + 255);
  if (h.length < 27 || h.toString('latin1', 0, 4) !== 'OggS') return undefined;
  if (h[4] !== 0) throw new ErreurFormat('Ogg : version inconnue');
  const n = h[26];
  if (h.length < 27 + n) throw new ErreurFormat('Ogg : table de segments tronquée');
  const segments = [...h.subarray(27, 27 + n)];
  const taille = segments.reduce((a, b) => a + b, 0);
  const donnees = pos + 27 + n;
  if (donnees + taille > src.taille) throw new ErreurFormat('Ogg : page plus longue que le fichier');
  return { pos, type: h[5], granule: h.readBigInt64LE(6), serie: h.readUInt32LE(14), segments, donnees, fin: donnees + taille };
}

export function lireOgg(src: Source, f: FicheEnCours, ctx: Contexte): void {
  const B = ctx.budget.bornes;
  let pos = 0, pages = 0;
  const paquets = new Map<number, Buffer[]>();      // paquets terminés par flux (les 3 premiers)
  const enCours = new Map<number, Buffer[]>();
  const tailles = new Map<number, number>();
  const ordre: number[] = [];
  let serieAudio: number | undefined;
  while (pos < src.taille && pages < B.oggPages) {
    ctx.budget.pas();
    const pg = page(src, pos);
    if (!pg) throw new ErreurFormat(pages ? 'Ogg : page invalide' : 'Ogg : signature absente');
    pages++;
    if (!ordre.includes(pg.serie)) { if (ordre.length >= 16) { pos = pg.fin; continue; } ordre.push(pg.serie); paquets.set(pg.serie, []); }
    const fini = paquets.get(pg.serie)!;
    if (fini.length >= 3) {
      if ([...paquets.values()].every((l) => l.length >= 3)) break;
      pos = pg.fin; continue;
    }
    let q = pg.donnees;
    for (const s of pg.segments) {
      const morceaux = enCours.get(pg.serie) ?? [];
      morceaux.push(src.lire(q, s));
      const t = (tailles.get(pg.serie) ?? 0) + s;
      if (t > B.oggPaquet) throw new ErreurFormat('Ogg : paquet de plus de 16 Mio');
      tailles.set(pg.serie, t);
      enCours.set(pg.serie, morceaux);
      q += s;
      if (s < 255) { fini.push(Buffer.concat(morceaux)); enCours.set(pg.serie, []); tailles.set(pg.serie, 0); if (fini.length >= 3) break; }
    }
    pos = pg.fin;
    if (pages > 64 && [...paquets.values()].every((l) => l.length >= 2)) break;
  }
  if (pages >= B.oggPages) remarque(f, 'Ogg : trop de pages avant les en-têtes');
  let preskip = 0, fs = 0, codec = '';
  for (const serie of ordre) {
    const pq = paquets.get(serie) ?? [];
    const id = pq[0];
    if (!id) continue;
    const p: Piste = { index: f.pistes.length, genre: 'son' };
    if (id[0] === 1 && id.toString('latin1', 1, 7) === 'vorbis' && id.length >= 30) {
      p.codec = 'Vorbis'; p.codecBrut = 'vorbis'; p.canaux = id[11]; p.frequenceHz = id.readUInt32LE(12);
      const nom = id.readInt32LE(20); if (nom > 0) p.debitKbps = Math.round(nom / 1000);
      if (pq[1]?.[0] === 3 && pq[1].toString('latin1', 1, 7) === 'vorbis' && serieAudio === undefined) lireCommentaires(pq[1].subarray(7), f, ctx, 'Vorbis');
    } else if (id.toString('latin1', 0, 8) === 'OpusHead' && id.length >= 19) {
      p.codec = 'Opus'; p.codecBrut = 'opus'; p.canaux = id[9]; p.frequenceHz = 48000;
      if (serieAudio === undefined) { preskip = id.readUInt16LE(10); remarque(f, `Opus : fréquence d'origine ${id.readUInt32LE(12)} Hz`); }
      if (pq[1]?.toString('latin1', 0, 8) === 'OpusTags' && serieAudio === undefined) lireCommentaires(pq[1].subarray(8), f, ctx, 'Vorbis');
    } else if (id[0] === 0x7f && id.toString('latin1', 1, 5) === 'FLAC' && id.length >= 13 + 38) {
      const si = streaminfo(id.subarray(13 + 4 + 4), f, 'Ogg FLAC');
      Object.assign(p, si, { index: p.index });
      if (pq[1] && (pq[1][0] & 0x7f) === 4 && serieAudio === undefined) lireCommentaires(pq[1].subarray(4), f, ctx, 'Vorbis');
    } else if (id.toString('latin1', 0, 8) === 'Speex   ' && id.length >= 52) {
      p.codec = 'Speex'; p.codecBrut = 'speex'; p.frequenceHz = id.readUInt32LE(36); p.canaux = id.readUInt32LE(48);
      if (pq[1] && serieAudio === undefined) { try { lireCommentaires(pq[1], f, ctx, 'Vorbis'); } catch { /* commentaires Speex absents */ } }
    } else if (id[0] === 0x80 && id.toString('latin1', 1, 7) === 'theora' && id.length >= 30) {
      p.genre = 'vidéo'; p.codec = 'Theora'; p.codecBrut = 'theora';
      p.largeur = id.readUIntBE(14, 3); p.hauteur = id.readUIntBE(17, 3);
      const n = id.readUInt32BE(22), d = id.readUInt32BE(26);
      if (n && d) p.imagesParSeconde = Math.round((n / d) * 100) / 100;
      if (!f.largeur) { f.largeur = p.largeur; f.hauteur = p.hauteur; }
      if (f.nature.famille === 'son') { f.nature.famille = 'video'; f.nature.nom = 'Vidéo Ogg Theora'; }
    } else { p.genre = 'autre'; p.codec = 'flux Ogg inconnu'; }
    if (p.genre === 'son' && serieAudio === undefined) { serieAudio = serie; fs = p.frequenceHz ?? 0; codec = p.codecBrut ?? ''; }
    else if (p.genre === 'son') remarque(f, 'Ogg : autre flux audio présent (non décrit)');
    f.pistes.push(p);
  }
  // Durée : granule de la dernière page du flux audio, dans les 64 derniers Kio.
  if (serieAudio !== undefined && fs > 0) {
    const debut = Math.max(0, src.taille - 64 * 1024);
    const q = src.lire(debut, src.taille - debut);
    let granule: bigint | undefined;
    for (let i = q.lastIndexOf('OggS'); i >= 0; i = i > 0 ? q.lastIndexOf('OggS', i - 1) : -1) {
      if (i + 27 <= q.length && q.readUInt32LE(i + 14) === serieAudio) { const g = q.readBigInt64LE(i + 6); if (g >= 0n) { granule = g; break; } }
    }
    if (granule !== undefined) {
      const s = codec === 'opus' ? (Number(granule) - preskip) / 48000 : Number(granule) / fs;
      if (s >= 0 && Number.isFinite(s)) { f.dureeSec = Math.round(s * 1000) / 1000; const a = f.pistes.find((x) => x.genre === 'son'); if (a) a.dureeSec = f.dureeSec; }
    }
  }
  if (!f.pistes.length) throw new ErreurFormat('Ogg : aucun flux reconnu');
}

// ─────────────────────────────── AIFF ───────────────────────────────

/** Flottant 80 bits (IEEE étendu) ; exposant borné. */
export function flottant80(b: Buffer, p: number): number {
  const exp = ((b[p] & 0x7f) << 8) | b[p + 1];
  if (exp === 0x7fff) throw new ErreurFormat('AIFF : fréquence infinie ou NaN');
  const mant = Number(b.readBigUInt64BE(p + 2));
  const v = mant * 2 ** (exp - 16383 - 63);
  return b[p] & 0x80 ? -v : v;
}

export function lireAiff(src: Source, f: FicheEnCours, ctx: Contexte): void {
  const h = src.lire(0, 12);
  const aifc = h.toString('latin1', 8, 12) === 'AIFC';
  const fin = Math.min(src.taille, 8 + h.readUInt32BE(4));
  if (8 + h.readUInt32BE(4) > src.taille) remarque(f, 'AIFF : taille annoncée plus grande que le fichier');
  let p = 12;
  const piste: Piste = { index: 0, genre: 'son', codec: aifc ? 'AIFF-C' : 'PCM (AIFF)', codecBrut: aifc ? 'aifc' : 'aiff' };
  let vu = false;
  while (p + 8 <= fin) {
    ctx.budget.pas();
    const c = src.lire(p, 8);
    const id = c.toString('latin1', 0, 4), l = c.readUInt32BE(4);
    const d = p + 8;
    if (d + l > src.taille) { if (id !== 'SSND') throw new ErreurFormat(`AIFF : bloc ${id} plus long que le fichier`); }
    switch (id) {
      case 'COMM': {
        const b = src.lire(d, Math.min(l, 64));
        if (b.length < 18) throw new ErreurFormat('AIFF : COMM trop court');
        piste.canaux = b.readUInt16BE(0); piste.bitsParEchantillon = b.readUInt16BE(6);
        const fs = flottant80(b, 8);
        if (!(fs >= 1 && fs <= 10_000_000)) throw new ErreurFormat('AIFF : fréquence impossible');
        piste.frequenceHz = Math.round(fs);
        const n = b.readUInt32BE(2);
        if (n) { f.dureeSec = Math.round((n / fs) * 1000) / 1000; piste.dureeSec = f.dureeSec; }
        if (aifc && b.length >= 22) { const t = b.toString('latin1', 18, 22); piste.codecBrut = t; piste.codec = t === 'NONE' || t === 'twos' ? 'PCM' : t === 'sowt' ? 'PCM (petit-boutiste)' : t === 'fl32' ? 'PCM flottant' : t; }
        vu = true;
        break;
      }
      case 'NAME': ajouterChamp(f, ctx, 'titre', nettoyerTexte(src.lire(d, Math.min(l, 65536)), 'latin1').texte, 'AIFF:NAME'); break;
      case 'AUTH': ajouterChamp(f, ctx, 'artiste', nettoyerTexte(src.lire(d, Math.min(l, 65536)), 'latin1').texte, 'AIFF:AUTH'); break;
      case '(c) ': { const v = nettoyerTexte(src.lire(d, Math.min(l, 65536)), 'latin1').texte; ctx.travail.droitsBruts.push(v); ajouterChamp(f, ctx, 'droits', v, 'AIFF:(c)'); break; }
      case 'ANNO': ajouterChamp(f, ctx, 'commentaire', nettoyerTexte(src.lire(d, Math.min(l, 65536)), 'latin1').texte, 'AIFF:ANNO'); break;
      case 'ID3 ': case 'id3 ': lireId3v2(src, d, f, ctx); break;
      default: break;
    }
    p = d + l + (l & 1);
  }
  if (!vu) throw new ErreurFormat('AIFF : bloc COMM absent');
  f.pistes.push(piste);
}

// ─────────────────────────────── MIDI, AMR, APE, WavPack ───────────────────────────────

export function lireMidi(src: Source, f: FicheEnCours, ctx: Contexte): void {
  const h = src.lire(0, 14);
  if (h.length < 14 || h.readUInt32BE(4) < 6) throw new ErreurFormat('MIDI : en-tête invalide');
  const format = h.readUInt16BE(8), n = h.readUInt16BE(10), div = h.readUInt16BE(12);
  ajouterChamp(f, ctx, 'x:midi_format', `format ${format} (${format === 0 ? 'une piste' : format === 1 ? 'pistes simultanées' : 'séquences indépendantes'})`, 'MIDI:MThd', { nom: 'Format MIDI', groupe: 'technique' });
  ajouterChamp(f, ctx, 'x:midi_pistes', String(n), 'MIDI:MThd', { nom: 'Pistes MIDI', groupe: 'technique' });
  ajouterChamp(f, ctx, 'x:midi_division', div & 0x8000 ? `SMPTE ${256 - (div >> 8)} i/s` : `${div} tics par noire`, 'MIDI:MThd', { nom: 'Division', groupe: 'technique' });
  ajouterManque(f, { quoi: 'les textes et la durée du MIDI', raison: 'métadonnées : format non lu', code: 'format-non-lu' });
}

/** AMR, Monkey's Audio, WavPack : reconnus ; les étiquettes APEv2 / ID3v1 de fin sont lues. */
export function lireSonNonLu(src: Source, f: FicheEnCours, ctx: Contexte): void {
  if (f.nature.format === 'ape' || f.nature.format === 'wavpack') lireQueue(src, f, ctx);
  ajouterManque(f, { quoi: 'les informations techniques', raison: 'métadonnées : format non lu', code: 'format-non-lu' });
}
