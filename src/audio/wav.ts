// Lecture et écriture du format WAV (RIFF/WAVE, petit-boutien), écrites dans Odin d'après la description publique du
// format. Lecture STRICTE : un fichier venu de l'extérieur est hostile. Toutes les bornes sont vérifiées AVANT toute
// allocation (canaux, fréquence, bits, alignement de bloc, taille des données), 64 blocs au plus, octet de bourrage
// respecté. Formats lus : entier 8 bits non signé, 16/24/32 bits signés ; flottant 32 et 64 bits ; A-law et µ-law
// (téléphonie, table de 256 valeurs) ; la forme « extensible » (le vrai format est lu dans l'identifiant du sous-format).

import { ErreurSon, maxSecEffectif } from './bornes.ts';
import { FS, MAX_SEC } from './contrat.ts';

/** Le format d'un fichier son, reconnu à ses premiers octets. */
export type FormatSon = 'wav' | 'flac' | 'mp3' | 'ogg' | 'mp4' | 'webm' | 'aiff' | 'inconnu';

const ascii = (o: Uint8Array, i: number, s: string): boolean => {
  if (o.length < i + s.length) return false;
  for (let k = 0; k < s.length; k++) if (o[i + k] !== s.charCodeAt(k)) return false;
  return true;
};

/** Reconnaît le format par ses octets magiques (les 12 premiers suffisent). */
export function formatSon(debut: Uint8Array): FormatSon {
  if (ascii(debut, 0, 'RIFF') && ascii(debut, 8, 'WAVE')) return 'wav';
  if (ascii(debut, 0, 'fLaC')) return 'flac';
  if (ascii(debut, 0, 'OggS')) return 'ogg';
  if (ascii(debut, 4, 'ftyp')) return 'mp4';
  if (debut.length >= 4 && debut[0] === 0x1a && debut[1] === 0x45 && debut[2] === 0xdf && debut[3] === 0xa3) return 'webm';
  if (ascii(debut, 0, 'FORM') && (ascii(debut, 8, 'AIFF') || ascii(debut, 8, 'AIFC'))) return 'aiff';
  if (ascii(debut, 0, 'ID3')) return 'mp3';
  if (debut.length >= 2 && debut[0] === 0xff && (debut[1] & 0xe0) === 0xe0) return 'mp3';
  return 'inconnu';
}

// ---------------------------------------------------------------------------------------------------------------
// Tables A-law et µ-law (norme publique de la téléphonie, décodage vers 16 bits puis vers [-1, 1]).
// ---------------------------------------------------------------------------------------------------------------

function alawVers16(a: number): number {
  a ^= 0x55;
  let t = (a & 0x0f) << 4;
  const seg = (a & 0x70) >> 4;
  if (seg === 0) t += 8;
  else if (seg === 1) t += 0x108;
  else { t += 0x108; t <<= seg - 1; }
  return (a & 0x80) ? t : -t;
}

function mulawVers16(u: number): number {
  u = ~u & 0xff;
  const signe = u & 0x80;
  const exposant = (u >> 4) & 0x07;
  const mantisse = u & 0x0f;
  let s = ((mantisse << 3) + 0x84) << exposant;
  s -= 0x84;
  return signe ? -s : s;
}

const TABLE_ALAW = new Float32Array(256);
const TABLE_MULAW = new Float32Array(256);
for (let i = 0; i < 256; i++) { TABLE_ALAW[i] = alawVers16(i) / 32768; TABLE_MULAW[i] = mulawVers16(i) / 32768; }

// ---------------------------------------------------------------------------------------------------------------
// En-tête : parcours des blocs.
// ---------------------------------------------------------------------------------------------------------------

/** Code du format des échantillons, après lecture de la forme « extensible ». */
export type CodageWav = 'entier' | 'flottant' | 'alaw' | 'mulaw';

export interface EnteteWav {
  fs: number;
  canaux: number;
  bits: number;
  bloc: number;
  codage: CodageWav;
  /** Position du premier octet des données. */
  debutData: number;
  /** Nombre d'octets de données lisibles (borné au fichier, multiple du bloc). */
  tailleData: number;
  /** Nombre de trames (une trame = un échantillon par canal). */
  trames: number;
  duree: number;
}

/** Lecteur d'octets à une position (mémoire ou fichier). Rend au plus `n` octets. */
export type LireA = (pos: number, n: number) => Uint8Array;

const MAX_BLOCS = 64;
const BITS_PERMIS = new Set([8, 16, 24, 32, 64]);

const refus = (raison: string): never => { throw new ErreurSon('refuse', `WAV refusé : ${raison}`); };

/** Lit l'en-tête d'un WAV sans rien allouer de grand. `taille` = taille totale du fichier. */
export function lireEnteteWav(lire: LireA, taille: number, o: { maxSec?: number } = {}): EnteteWav {
  if (taille < 12) refus('fichier trop court');
  const tete = lire(0, 12);
  if (!(ascii(tete, 0, 'RIFF') && ascii(tete, 8, 'WAVE'))) refus('ce n\'est pas un fichier RIFF/WAVE');
  let pos = 12;
  let fmt: Uint8Array | undefined;
  let blocs = 0;
  while (pos + 8 <= taille) {
    if (++blocs > MAX_BLOCS) refus(`plus de ${MAX_BLOCS} blocs`);
    const h = lire(pos, 8);
    if (h.length < 8) refus('bloc tronqué');
    for (let k = 0; k < 4; k++) if (h[k] < 0x20 || h[k] > 0x7e) refus('bloc illisible (octet de bourrage manquant ?)');
    const id = String.fromCharCode(h[0], h[1], h[2], h[3]);
    const dv = new DataView(h.buffer, h.byteOffset, 8);
    const brut = dv.getUint32(4, true);
    const debut = pos + 8;
    const reste = taille - debut;
    if (id === 'fmt ') {
      if (fmt) refus('deux blocs « fmt »');
      if (brut < 16 || brut > 64) refus('bloc « fmt » de taille anormale');
      if (brut > reste) refus('bloc « fmt » plus grand que le fichier');
      fmt = lire(debut, brut);
      if (fmt.length < brut) refus('bloc « fmt » tronqué');
    } else if (id === 'data') {
      if (!fmt) return refus('données avant le bloc « fmt »');
      const e = decrireFmt(fmt);
      let tailleData: number;
      if (brut === 0 || brut === 0xffffffff) tailleData = reste;
      else if (brut > reste) return refus('bloc de données plus grand que le fichier');
      else tailleData = brut;
      tailleData -= tailleData % e.bloc;
      const trames = tailleData / e.bloc;
      const duree = trames / e.fs;
      const max = maxSecEffectif(o.maxSec, MAX_SEC);
      if (duree > max) throw new ErreurSon('trop_long', `son trop long : ${Math.round(duree)} s (au plus ${Math.round(max)} s)`);
      return { ...e, debutData: debut, tailleData, trames, duree };
    }
    if (brut > reste) refus(`bloc « ${id.trim()} » plus grand que le fichier`);
    pos = debut + brut + (brut & 1);
  }
  return refus('aucun bloc de données');
}

const GUID_FIN = [0x00, 0x00, 0x00, 0x00, 0x10, 0x00, 0x80, 0x00, 0x00, 0xaa, 0x00, 0x38, 0x9b, 0x71];

function decrireFmt(f: Uint8Array): { fs: number; canaux: number; bits: number; bloc: number; codage: CodageWav } {
  const dv = new DataView(f.buffer, f.byteOffset, f.byteLength);
  let code = dv.getUint16(0, true);
  const canaux = dv.getUint16(2, true);
  const fs = dv.getUint32(4, true);
  const bloc = dv.getUint16(12, true);
  const bits = dv.getUint16(14, true);
  if (canaux < 1 || canaux > 8) refus(`${canaux} canaux (de 1 à 8)`);
  if (fs < 8000 || fs > 192_000) refus(`fréquence ${fs} Hz (de 8 000 à 192 000)`);
  if (!BITS_PERMIS.has(bits)) refus(`${bits} bits par échantillon`);
  if (code === 0xfffe) {
    if (f.length < 40) refus('forme extensible tronquée');
    const cb = dv.getUint16(16, true);
    if (cb < 22) refus('forme extensible incomplète');
    code = dv.getUint16(24, true);
    for (let k = 0; k < GUID_FIN.length; k++) if (f[26 + k] !== GUID_FIN[k]) refus('sous-format inconnu');
  }
  let codage: CodageWav;
  if (code === 1) { if (bits === 64) refus('entier 64 bits'); codage = 'entier'; }
  else if (code === 3) { if (bits !== 32 && bits !== 64) refus(`flottant ${bits} bits`); codage = 'flottant'; }
  else if (code === 6) { if (bits !== 8) refus('A-law hors 8 bits'); codage = 'alaw'; }
  else if (code === 7) { if (bits !== 8) refus('µ-law hors 8 bits'); codage = 'mulaw'; }
  else return refus(`codage ${code} non lu par Odin seul`);
  if (bloc !== canaux * (bits / 8)) refus('alignement de bloc incohérent');
  return { fs, canaux, bits, bloc, codage };
}

/** Convertit des octets de données (un nombre entier de trames) en échantillons mono (moyenne des canaux). */
export function versMono(octets: Uint8Array, e: Pick<EnteteWav, 'canaux' | 'bits' | 'bloc' | 'codage'>): Float32Array {
  const n = Math.floor(octets.length / e.bloc);
  const out = new Float32Array(n);
  const dv = new DataView(octets.buffer, octets.byteOffset, octets.byteLength);
  const c = e.canaux, oct = e.bits / 8, inv = 1 / c;
  for (let i = 0; i < n; i++) {
    let s = 0;
    const base = i * e.bloc;
    for (let k = 0; k < c; k++) {
      const p = base + k * oct;
      let v: number;
      if (e.codage === 'alaw') v = TABLE_ALAW[octets[p]];
      else if (e.codage === 'mulaw') v = TABLE_MULAW[octets[p]];
      else if (e.codage === 'flottant') v = e.bits === 32 ? dv.getFloat32(p, true) : dv.getFloat64(p, true);
      else if (e.bits === 8) v = (octets[p] - 128) / 128;
      else if (e.bits === 16) v = dv.getInt16(p, true) / 32768;
      else if (e.bits === 24) v = (((octets[p + 2] << 24) | (octets[p + 1] << 16) | (octets[p] << 8)) >> 8) / 8388608;
      else v = dv.getInt32(p, true) / 2147483648;
      if (!Number.isFinite(v)) v = 0;
      s += v;
    }
    out[i] = s * inv;
  }
  return out;
}

/** Lit un WAV entier en mémoire : fréquence, canaux, son ramené en mono (à sa fréquence d'origine), durée. */
export function lireWav(octets: Uint8Array, o: { maxSec?: number } = {}): { fs: number; canaux: number; mono: Float32Array; duree: number } {
  const e = lireEnteteWav((pos, n) => octets.subarray(pos, Math.min(octets.length, pos + n)), octets.length, o);
  const mono = versMono(octets.subarray(e.debutData, e.debutData + e.tailleData), e);
  return { fs: e.fs, canaux: e.canaux, mono, duree: e.duree };
}

/** En-tête WAV de 44 octets (mono, 16 bits, 16 kHz) pour `n` échantillons. */
export function enteteWav16k(n: number): Uint8Array {
  const h = new Uint8Array(44);
  const dv = new DataView(h.buffer);
  const data = n * 2;
  h.set([0x52, 0x49, 0x46, 0x46], 0); dv.setUint32(4, 36 + data, true);
  h.set([0x57, 0x41, 0x56, 0x45, 0x66, 0x6d, 0x74, 0x20], 8);
  dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
  dv.setUint32(24, FS, true); dv.setUint32(28, FS * 2, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true);
  h.set([0x64, 0x61, 0x74, 0x61], 36); dv.setUint32(40, data, true);
  return h;
}

/** Échantillons [-1, 1] → entiers 16 bits petit-boutiens, écrêtés. */
export function versS16(x: Float32Array): Uint8Array {
  const out = new Uint8Array(x.length * 2);
  const dv = new DataView(out.buffer);
  for (let i = 0; i < x.length; i++) {
    const v = x[i];
    const s = v >= 1 ? 32767 : v <= -1 ? -32768 : Math.round(v * 32767);
    dv.setInt16(i * 2, Number.isFinite(s) ? s : 0, true);
  }
  return out;
}

/** Écrit un WAV mono 16 bits à 16 kHz, écrêté. */
export function ecrireWav16k(mono16k: Float32Array): Uint8Array {
  const out = new Uint8Array(44 + mono16k.length * 2);
  out.set(enteteWav16k(mono16k.length), 0);
  out.set(versS16(mono16k), 44);
  return out;
}

/** Petit générateur à graine (reproductible), pour les sons fabriqués. */
export function hasardGraine(graine: number): () => number {
  let s = graine >>> 0 || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}

/** Sons fabriqués (aucun son privé n'est utilisé pour mesurer) : clics à 120 BPM, accord do-mi-sol, silence puis bruit. */
export function sonFabrique(genre: 'clics120' | 'accordDo' | 'silencePuisBruit', sec: number): Uint8Array {
  const n = Math.max(0, Math.round(Math.min(Math.max(sec, 0), 3600) * FS));
  const x = new Float32Array(n);
  if (genre === 'clics120') {
    const periode = FS / 2; // 120 battements par minute = un toutes les 0,5 s
    const hasard = hasardGraine(7);
    for (let debut = 0; debut < n; debut += periode) {
      for (let i = 0; i < 400 && debut + i < n; i++) {
        const env = Math.exp(-i / 60);
        x[debut + i] = 0.8 * env * (Math.sin(2 * Math.PI * 1500 * i / FS) * 0.6 + (hasard() * 2 - 1) * 0.4);
      }
    }
  } else if (genre === 'accordDo') {
    // do grave (130,81 Hz) doublé à l'octave, mi et sol : un accord de do majeur, avec deux harmoniques par note.
    const notes = [130.81, 261.63, 329.63, 392.0];
    for (let i = 0; i < n; i++) {
      const t = i / FS;
      let s = 0;
      for (const f of notes) s += Math.sin(2 * Math.PI * f * t) + 0.3 * Math.sin(4 * Math.PI * f * t);
      x[i] = 0.15 * s;
    }
  } else {
    const hasard = hasardGraine(42);
    for (let i = Math.floor(n / 2); i < n; i++) x[i] = (hasard() * 2 - 1) * 0.4;
  }
  return ecrireWav16k(x);
}
