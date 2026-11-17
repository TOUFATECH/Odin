// Médias reçus : lire un fichier texte (texte simple, CSV, JSON, XML, HTML, sous-titres) avec l'encodage reconnu par
// reconnaitre.ts (BOM, UTF-8, UTF-16 sans BOM, UTF-32, windows-1252 incertain). Au plus 2 Mio décodés ; nettoyage
// imposé (contrôles retirés, NFC) sans la borne de 64 Kio des champs. Le texte rendu est un CONTENU EXTÉRIEUR, exact :
// aucune écriture, aucune langue n'est supposée, rien n'est traduit ni « corrigé ».

import { BORNES, type Nature } from './contrat.ts';
import { nettoyerTexte, type Source } from './octets.ts';

/** Décode des octets d'encodage connu (BOM sauté s'il est là). */
export function decoderAvec(b: Buffer, enc: string): string {
  const e = enc.toLowerCase();
  if (e === 'utf-32le' || e === 'utf-32be') {
    const le = e === 'utf-32le';
    let i = (le && b[0] === 0xff && b[1] === 0xfe && b[2] === 0 && b[3] === 0) || (!le && b[0] === 0 && b[1] === 0 && b[2] === 0xfe && b[3] === 0xff) ? 4 : 0;
    const morceaux: string[] = [];
    let s = '';
    for (; i + 4 <= b.length; i += 4) {
      const c = le ? b.readUInt32LE(i) : b.readUInt32BE(i);
      s += c <= 0x10ffff && !(c >= 0xd800 && c <= 0xdfff) ? String.fromCodePoint(c) : '�';
      if (s.length >= 8192) { morceaux.push(s); s = ''; }
    }
    morceaux.push(s);
    return morceaux.join('');
  }
  let debut = 0;
  if ((e === 'utf-8') && b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) debut = 3;
  else if (e === 'utf-16le' && b[0] === 0xff && b[1] === 0xfe) debut = 2;
  else if (e === 'utf-16be' && b[0] === 0xfe && b[1] === 0xff) debut = 2;
  const corps = e.startsWith('utf-16') ? b.subarray(debut, debut + ((b.length - debut) & ~1)) : b.subarray(debut);
  try { return new TextDecoder(e, { fatal: false }).decode(corps); }
  catch { return new TextDecoder('windows-1252', { fatal: false }).decode(corps); }
}

/** Décode des octets d'encodage inconnu : BOM, puis UTF-8 strict, puis UTF-16 (octets nuls alternés), puis l'encodage ancien le plus cohérent (devinerEncodage). */
export function decoderTexteInconnu(b: Buffer): { texte: string; encodage: string; sur: boolean } {
  if (b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) return { texte: decoderAvec(b, 'utf-8'), encodage: 'utf-8', sur: true };
  if (b[0] === 0xff && b[1] === 0xfe && b[2] === 0 && b[3] === 0) return { texte: decoderAvec(b, 'utf-32le'), encodage: 'utf-32le', sur: true };
  if (b[0] === 0 && b[1] === 0 && b[2] === 0xfe && b[3] === 0xff) return { texte: decoderAvec(b, 'utf-32be'), encodage: 'utf-32be', sur: true };
  if (b[0] === 0xff && b[1] === 0xfe) return { texte: decoderAvec(b, 'utf-16le'), encodage: 'utf-16le', sur: true };
  if (b[0] === 0xfe && b[1] === 0xff) return { texte: decoderAvec(b, 'utf-16be'), encodage: 'utf-16be', sur: true };
  const n = Math.min(512, b.length) & ~1;
  let pairs = 0, impairs = 0;
  for (let i = 0; i < n; i += 2) { if (b[i] === 0) pairs++; if (b[i + 1] === 0) impairs++; }
  if (n >= 4 && (impairs > (n / 2) * 0.8 || pairs > (n / 2) * 0.8)) { const e = impairs > pairs ? 'utf-16le' : 'utf-16be'; return { texte: decoderAvec(b, e), encodage: e, sur: false }; }
  for (let k = 0; k <= 3; k++) {
    try { return { texte: new TextDecoder('utf-8', { fatal: true }).decode(b.subarray(0, b.length - k)), encodage: 'utf-8', sur: true }; } catch { /* séquence coupée en fin ? */ }
  }
  const enc = devinerEncodage(b);
  return { texte: decoderAvec(b, enc), encodage: enc, sur: false };
}

/**
 * Encodages anciens essayés quand ce n'est ni de l'UTF-8 ni de l'UTF-16 (aucune langue supposée) : européens de
 * l'Ouest et de l'Est, cyrillique, grec, hébreu, arabe, turc, balte, vietnamien, thaï, japonais, chinois, coréen.
 */
export const ENCODAGES_ANCIENS = ['windows-1252', 'windows-1251', 'windows-1256', 'windows-1253', 'windows-1255', 'windows-1250', 'windows-1254',
  'windows-1257', 'windows-1258', 'windows-874', 'koi8-r', 'shift_jis', 'euc-jp', 'euc-kr', 'gb18030', 'big5'];

type Groupe = 'latin' | 'grec' | 'cyrillique' | 'hebreu' | 'arabe' | 'thai' | 'cjk' | 'hangul' | 'autre';
function groupe(c: number): Groupe | undefined {
  if ((c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a) || (c >= 0xc0 && c <= 0x24f && c !== 0xd7 && c !== 0xf7) || (c >= 0x1e00 && c <= 0x1eff)) return 'latin';
  if (c >= 0x370 && c <= 0x3ff) return 'grec';
  if (c >= 0x400 && c <= 0x52f) return 'cyrillique';
  if (c >= 0x5d0 && c <= 0x5ea) return 'hebreu';
  if ((c >= 0x620 && c <= 0x64a) || (c >= 0x66e && c <= 0x6d3) || (c >= 0x750 && c <= 0x77f)) return 'arabe';
  if (c >= 0xe01 && c <= 0xe4e) return 'thai';
  if ((c >= 0x3041 && c <= 0x30ff) || (c >= 0x3400 && c <= 0x4dbf) || (c >= 0x4e00 && c <= 0x9fff)) return 'cjk';
  if ((c >= 0xac00 && c <= 0xd7a3) || (c >= 0x1100 && c <= 0x11ff) || (c >= 0x3131 && c <= 0x318e)) return 'hangul';
  return undefined;
}
/** Caractères qu'un texte bien décodé n'a presque jamais : symboles Latin-1 rares, U+FFFD, demi-chasse, privés, contrôles. */
function bizarre(c: number): boolean {
  if (c === 0xfffd || (c >= 0xe000 && c <= 0xf8ff) || (c >= 0xff61 && c <= 0xff9f) || (c >= 0x2500 && c <= 0x257f)) return true;
  // Thaï : chiffres thaïs, lettres obsolètes (ฃ ฅ) et signes rares (ฯ ๏ ๚ ๛) — fréquents dans un chinois lu en windows-874.
  if (c === 0xe03 || c === 0xe05 || c === 0xe2f || (c >= 0xe4f && c <= 0xe5b)) return true;
  if (c < 0x20 && c !== 0x09 && c !== 0x0a && c !== 0x0d) return true;
  if (c >= 0x80 && c <= 0x9f) return true;
  if (c >= 0xa1 && c <= 0xbf) return c !== 0xab && c !== 0xbb && c !== 0xb0 && c !== 0xb7 && c !== 0xa9 && c !== 0xa3 && c !== 0xa7;
  return false;
}

/**
 * Note la cohérence d'un décodage : part des lettres de l'écriture dominante (1 = une seule écriture), moins les
 * caractères bizarres, moins un texte latin fait surtout de lettres accentuées (signe d'un cyrillique, d'un grec ou d'un
 * arabe lu en windows-1252 : « Ïðèâåò »).
 */
export function noteDecodage(t: string, enc?: string): number {
  const n: Partial<Record<Groupe, number>> = {};
  let lettres = 0, bizarres = 0, total = 0, latinAccent = 0, casseMelee = 0, precMinuscule = false, kana = 0;
  for (let i = 0; i < t.length; i++) {
    const c = t.charCodeAt(i);
    if (c === 0x20 || c === 0x0a || c === 0x0d || c === 0x09) { precMinuscule = false; continue; }
    total++;
    if (bizarre(c)) { bizarres++; precMinuscule = false; continue; }
    const g = groupe(c);
    if (!g) { precMinuscule = false; continue; }
    lettres++;
    n[g] = (n[g] ?? 0) + 1;
    if (g === 'latin' && c >= 0xc0) latinAccent++;
    if (c >= 0x3041 && c <= 0x30ff) kana++;
    // Une majuscule au milieu d'un mot (« гСНИЗ ») : signe d'un arabe ou d'un grec lu dans le mauvais alphabet.
    const ch = t[i], maj = ch !== ch.toLowerCase(), min = ch !== ch.toUpperCase();
    if (maj && precMinuscule) casseMelee++;
    precMinuscule = min;
  }
  if (!total) return 0;
  let dom: Groupe = 'autre', max = 0;
  for (const [g, v] of Object.entries(n) as Array<[Groupe, number]>) if (v > max) { max = v; dom = g; }
  const unite = lettres ? max / lettres : 0;
  const accents = dom === 'latin' && max ? latinAccent / max : 0;
  // Un « japonais » sans un seul kana sur plus de 8 caractères chinois : c'est un chinois lu en Shift-JIS ou EUC-JP.
  const sansKana = (enc === 'shift_jis' || enc === 'euc-jp') && dom === 'cjk' && kana === 0 && max >= 8 ? 0.5 : 0;
  return unite - sansKana - 3 * (bizarres / total) - (accents > 0.35 ? 0.6 : 0) - (lettres ? 2 * (casseMelee / lettres) : 0);
}

/** Le meilleur encodage ancien pour ces octets (échantillon de 16 Kio) ; à égalité, le premier de la liste. */
export function devinerEncodage(b: Buffer): string {
  const echantillon = b.subarray(0, 16 * 1024);
  let meilleur = 'windows-1252', note = -Infinity;
  for (const enc of ENCODAGES_ANCIENS) {
    let t: string;
    try { t = new TextDecoder(enc, { fatal: false }).decode(echantillon); } catch { continue; }
    const x = noteDecodage(t, enc);
    if (x > note + 1e-9) { note = x; meilleur = enc; }
  }
  return meilleur;
}

/** Le texte d'un fichier texte, ≤ 2 Mio lus, encodage de la nature (reconnu par le contenu). */
export function lireTexte(src: Source, nature: Nature): { texte: string; encodage: Nature['encodage']; partiel?: string } {
  const max = BORNES.texteLu;
  const n = Math.min(src.taille, max);
  const b = src.lire(0, n);
  let encodage = nature.encodage;
  let brut: string;
  // « windows-1252 incertain » (rien de mieux trouvé par la reconnaissance) : l'encodage est re-deviné sur le contenu.
  if (encodage && !encodage.sur && encodage.nom === 'windows-1252') { const enc = devinerEncodage(b); encodage = { ...encodage, nom: enc }; }
  if (encodage) brut = decoderAvec(b, encodage.nom);
  else { const d = decoderTexteInconnu(b); brut = d.texte; encodage = { nom: d.encodage, bom: false, sur: d.sur }; }
  const texte = nettoyerTexte(brut, 'utf-8', { max }).texte;
  const r: { texte: string; encodage: Nature['encodage']; partiel?: string } = { texte, encodage };
  if (src.taille > max) r.partiel = `texte coupé : ${Math.round(max / 1024 / 1024)} Mio lus sur ${Math.round(src.taille / 1024 / 1024 * 10) / 10} Mio`;
  return r;
}
