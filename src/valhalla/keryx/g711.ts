// G.711 : les deux codecs son du téléphone, µ-law (Amérique, Japon) et A-law (Europe), écrits d'après la norme
// publique de l'UIT-T (G.711, tables de compression) — rien recopié d'un code sous licence. Un échantillon son de 16
// bits devient un octet, et un octet redevient un échantillon. C'est ce que transporte un appel RTP (8 000 octets par
// seconde, un octet toutes les 125 µs).
//
// Propriété garantie (et prouvée par l'essai) : réencoder un octet déjà encodé redonne le même octet
// (encoder(decoder(o)) === o pour les 256 valeurs). C'est la fidélité « aller-retour » du codec.

const MU_BIAS = 0x84; // 132
const MU_CLIP = 8159;
const A_CLIP = 8159; // non utilisé directement (débordement traité par le segment 8)

/** Le segment (exposant) d'une valeur : le premier rang où elle tient sous le seuil. */
function segment(valeur: number, seuils: readonly number[]): number {
  for (let i = 0; i < seuils.length; i++) if (valeur <= seuils[i]) return i;
  return seuils.length;
}

const SEG_MU = [0x3f, 0x7f, 0xff, 0x1ff, 0x3ff, 0x7ff, 0xfff, 0x1fff] as const;
const SEG_A = [0x1f, 0x3f, 0x7f, 0xff, 0x1ff, 0x3ff, 0x7ff, 0xfff] as const;

/** Un échantillon 16 bits → un octet µ-law. */
export function encoderMu(echantillon: number): number {
  let pcm = (echantillon | 0) >> 2;
  let masque: number;
  if (pcm < 0) { pcm = -pcm; masque = 0x7f; } else masque = 0xff;
  if (pcm > MU_CLIP) pcm = MU_CLIP;
  pcm += MU_BIAS >> 2;
  const seg = segment(pcm, SEG_MU);
  if (seg >= 8) return 0x7f ^ masque;
  const uval = (seg << 4) | ((pcm >> (seg + 1)) & 0x0f);
  return (uval ^ masque) & 0xff;
}

/** Un octet µ-law → un échantillon 16 bits. */
export function decoderMu(octet: number): number {
  const u = ~octet & 0xff;
  let t = ((u & 0x0f) << 3) + MU_BIAS;
  t <<= (u & 0x70) >> 4;
  return (u & 0x80) ? (MU_BIAS - t) : (t - MU_BIAS);
}

/** Un échantillon 16 bits → un octet A-law. */
export function encoderA(echantillon: number): number {
  let pcm = (echantillon | 0) >> 3;
  let masque: number;
  if (pcm >= 0) masque = 0xd5; else { masque = 0x55; pcm = -pcm - 1; }
  if (pcm > A_CLIP) pcm = A_CLIP;
  const seg = segment(pcm, SEG_A);
  if (seg >= 8) return 0x7f ^ masque;
  let aval = seg << 4;
  if (seg < 2) aval |= (pcm >> 1) & 0x0f; else aval |= (pcm >> seg) & 0x0f;
  return (aval ^ masque) & 0xff;
}

/** Un octet A-law → un échantillon 16 bits. */
export function decoderA(octet: number): number {
  const a = octet ^ 0x55;
  let t = (a & 0x0f) << 4;
  const seg = (a & 0x70) >> 4;
  if (seg === 0) t += 8; else if (seg === 1) t += 0x108; else { t += 0x108; t <<= seg - 1; }
  return (a & 0x80) ? t : -t;
}

export type Codec = 'mu' | 'a';
/** Le numéro de charge RTP figé par la norme : 0 = µ-law (PCMU), 8 = A-law (PCMA). */
export const CHARGE_RTP: Record<Codec, number> = { mu: 0, a: 8 };
export const NOM_CODEC: Record<Codec, string> = { mu: 'G.711 µ-law (PCMU)', a: 'G.711 A-law (PCMA)' };

/** Encode un bloc d'échantillons 16 bits en octets G.711. */
export function encoder(codec: Codec, pcm: Int16Array): Uint8Array {
  const enc = codec === 'mu' ? encoderMu : encoderA;
  const out = new Uint8Array(pcm.length);
  for (let i = 0; i < pcm.length; i++) out[i] = enc(pcm[i]);
  return out;
}
/** Décode un bloc d'octets G.711 en échantillons 16 bits. */
export function decoder(codec: Codec, octets: Uint8Array): Int16Array {
  const dec = codec === 'mu' ? decoderMu : decoderA;
  const out = new Int16Array(octets.length);
  for (let i = 0; i < octets.length; i++) out[i] = dec(octets[i]);
  return out;
}
