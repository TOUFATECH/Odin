// Découpage en sous-mots de Noûs — « BPE » au niveau des octets (fonctionnement public, aucun code recopié).
//
// Pourquoi au niveau des octets : le français d'abord, mais aussi l'anglais, le code, les accents et les émojis.
// Chaque caractère est d'abord ramené à ses octets UTF-8 ; toute entrée est donc représentable et
// decoder(encoder(x)) rend exactement x. On apprend ensuite des fusions de paires fréquentes sur le corpus d'Odin
// pour raccourcir les suites. Le vocabulaire (4096) est figé tôt et sa version est scellée avec les poids.
//
// Identifiants : 8 « jetons spéciaux » d'abord (dont EOS = fin), puis les 256 octets de base, puis les fusions.
// Avant la fusion, on pré-découpe le texte en « morceaux » (lettres, chiffres, ponctuation, espaces) à la manière
// publique de GPT-2 : les fusions ne traversent jamais ces frontières, ce qui borne le coût et garde le sens.

import type { Decoupage } from './moteur.ts';

export const SPECIAUX = { PAD: 0, BOS: 1, EOS: 2, USER: 3, ASSISTANT: 4, SYS: 5, SEP: 6, LIBRE: 7 } as const;
const NSPEC = 8;
const BASE = NSPEC;          // premier identifiant d'octet
const DEBUT_FUSIONS = NSPEC + 256; // premier identifiant de fusion

// Pré-découpage : suites de lettres, de chiffres, de ponctuation, d'espaces. UN espace de tête reste collé au morceau
// qui le suit (« le chat » → « le », « ·chat ») : sinon chaque espace coûte un morceau à lui seul, soit près de deux
// morceaux sur cinq d'un texte courant. Toute suite d'espaces qui précède un mot lui laisse donc son dernier espace.
const PRE = / ?\p{L}+| ?\p{N}+| ?[^\s\p{L}\p{N}]+|\s+(?!\S)|\s+/gu;
/** Numéro de la règle de pré-découpage, mêlé à la version : un découpage appris sous une autre règle n'a pas la même. */
const REGLE_PRE = 2;
function morceaux(texte: string): string[] { return texte.match(PRE) ?? []; }

const enc = new TextEncoder();
const dec = new TextDecoder('utf-8', { ignoreBOM: true }); // la marque d'ordre des octets en tête d'un texte n'est pas avalée

/** Fabrique une instance de découpage à partir de la liste des fusions (paires d'identifiants, par priorité). */
function fabriquer(fusions: Int32Array, vocab: number): DecoupageConcret {
  const nFus = fusions.length / 2;
  // rang d'une paire -> identifiant de fusion (priorité = indice)
  const rang = new Map<number, number>();
  const cle = (a: number, b: number): number => a * 0x4000000 + b; // a,b < 2^26
  for (let i = 0; i < nFus; i++) rang.set(cle(fusions[i * 2], fusions[i * 2 + 1]), i);
  // octets de chaque identifiant (pour decoder), construits une fois.
  const octetsDe: Uint8Array[] = new Array(vocab);
  for (let s = 0; s < NSPEC; s++) octetsDe[s] = new Uint8Array(0);
  for (let b = 0; b < 256; b++) octetsDe[BASE + b] = Uint8Array.of(b);
  for (let i = 0; i < nFus; i++) {
    const a = fusions[i * 2], bb = fusions[i * 2 + 1];
    const oa = octetsDe[a] ?? new Uint8Array(0), ob = octetsDe[bb] ?? new Uint8Array(0);
    const u = new Uint8Array(oa.length + ob.length); u.set(oa, 0); u.set(ob, oa.length);
    octetsDe[DEBUT_FUSIONS + i] = u;
  }

  const fusionnerMorceau = (ids: number[]): void => {
    // applique répétitivement la fusion de meilleur rang présente dans la suite.
    for (;;) {
      let meilleurRang = Infinity, pos = -1;
      for (let i = 0; i + 1 < ids.length; i++) {
        const rk = rang.get(cle(ids[i], ids[i + 1]));
        if (rk !== undefined && rk < meilleurRang) { meilleurRang = rk; pos = i; }
      }
      if (pos < 0) break;
      ids[pos] = DEBUT_FUSIONS + meilleurRang;
      ids.splice(pos + 1, 1);
    }
  };

  const encoder = (texte: string): Int32Array => {
    const out: number[] = [];
    for (const mo of morceaux(texte)) {
      const octets = enc.encode(mo);
      const ids: number[] = new Array(octets.length);
      for (let i = 0; i < octets.length; i++) ids[i] = BASE + octets[i];
      fusionnerMorceau(ids);
      for (const x of ids) out.push(x);
    }
    return Int32Array.from(out);
  };
  const decoder = (ids: ArrayLike<number>): string => {
    let total = 0; for (let i = 0; i < ids.length; i++) { const u = octetsDe[ids[i] | 0]; if (u) total += u.length; }
    const buf = new Uint8Array(total); let p = 0;
    for (let i = 0; i < ids.length; i++) { const u = octetsDe[ids[i] | 0]; if (u) { buf.set(u, p); p += u.length; } }
    return dec.decode(buf);
  };
  const version = hachage(fusions, vocab);
  return { vocab, version, encoder, decoder, fusions, arretId: SPECIAUX.EOS };
}

export interface DecoupageConcret extends Decoupage {
  readonly fusions: Int32Array;
  readonly arretId: number;
}

/** Hachage 32 bits des fusions + vocab : la « version » scellée avec les poids. */
function hachage(fusions: Int32Array, vocab: number): number {
  let h = 2166136261 ^ vocab ^ Math.imul(REGLE_PRE, 0x9e3779b1);
  for (let i = 0; i < fusions.length; i++) { h ^= fusions[i]; h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/**
 * Apprend le découpage sur un corpus. Les fusions sont choisies par fréquence ; une égalité est tranchée par un
 * hachage à graine (reproductible). Le vocabulaire cible fixe le nombre de fusions (vocab − 8 − 256).
 */
export function apprendreDecoupage(textes: Iterable<string>, vocab: number, graine: number): DecoupageConcret {
  const cibleFusions = Math.max(0, vocab - DEBUT_FUSIONS);
  // morceaux uniques et leur fréquence, chacun en suite d'identifiants d'octets.
  const freq = new Map<string, number>();
  for (const t of textes) for (const mo of morceaux(t)) freq.set(mo, (freq.get(mo) ?? 0) + 1);
  const pieces: Array<{ seq: number[]; f: number }> = [];
  for (const [mo, f] of freq) { const oc = enc.encode(mo); const seq: number[] = new Array(oc.length); for (let i = 0; i < oc.length; i++) seq[i] = BASE + oc[i]; pieces.push({ seq, f }); }

  const cle = (a: number, b: number): number => a * 0x4000000 + b;
  const compte = new Map<number, number>();
  const ou = new Map<number, Set<number>>();
  const ajouterPaire = (k: number, f: number, pi: number): void => {
    compte.set(k, (compte.get(k) ?? 0) + f);
    let s = ou.get(k); if (!s) { s = new Set(); ou.set(k, s); } s.add(pi);
  };
  // La pièce n'est PAS retirée de `ou` : elle peut contenir la même paire ailleurs, et l'en retirer laissait un compte
  // positif que plus aucune pièce ne portait (la même fusion était alors rechoisie sans fin). `ou` reste un
  // sur-ensemble sans danger : la boucle de fusion relit la suite réelle de chaque pièce.
  const retirerPaire = (k: number, f: number): void => {
    const c = (compte.get(k) ?? 0) - f; if (c <= 0) compte.delete(k); else compte.set(k, c);
  };
  for (let pi = 0; pi < pieces.length; pi++) { const { seq, f } = pieces[pi]; for (let i = 0; i + 1 < seq.length; i++) ajouterPaire(cle(seq[i], seq[i + 1]), f, pi); }

  const fus: number[] = [];
  while (fus.length / 2 < cibleFusions) {
    // meilleure paire : fréquence max, égalité tranchée par un hachage à graine.
    let bestK = -1, bestC = 0, bestTie = -1;
    for (const [k, c] of compte) {
      if (c > bestC) { bestK = k; bestC = c; bestTie = tie(k, graine); }
      else if (c === bestC) { const t = tie(k, graine); if (t > bestTie) { bestK = k; bestTie = t; } }
    }
    if (bestK < 0 || bestC < 2) break;
    const a = Math.floor(bestK / 0x4000000), b = bestK % 0x4000000;
    // L'identifiant de la fusion est son RANG — `fus` range DEUX nombres par fusion — : c'est celui que fabriquer()
    // lui donnera. (Compté en nombres rangés, il valait le double, et toute fusion bâtie sur une autre visait un
    // mauvais morceau.)
    const nouv = DEBUT_FUSIONS + fus.length / 2;
    let faites = 0;
    // applique la fusion (a,b)->nouv dans chaque pièce concernée, en mettant à jour les compteurs.
    for (const pi of [...(ou.get(bestK) ?? [])]) {
      const p = pieces[pi]; const seq = p.seq, f = p.f;
      let i = 0;
      while (i + 1 < seq.length) {
        if (seq[i] === a && seq[i + 1] === b) {
          // retire les paires (gauche,a),(a,b),(b,droite)
          if (i > 0) retirerPaire(cle(seq[i - 1], a), f);
          retirerPaire(cle(a, b), f);
          if (i + 2 < seq.length) retirerPaire(cle(b, seq[i + 2]), f);
          seq[i] = nouv; seq.splice(i + 1, 1); faites++;
          // ajoute les nouvelles paires (gauche,nouv),(nouv,droite)
          if (i > 0) ajouterPaire(cle(seq[i - 1], nouv), f, pi);
          if (i + 1 < seq.length) ajouterPaire(cle(nouv, seq[i + 1]), f, pi);
        } else i++;
      }
    }
    // La paire n'existe plus nulle part : jamais rechoisie, quoi qu'il reste dans les comptes. Une fusion qui n'a rien
    // fusionné n'est pas gardée (elle ne prend pas de place dans le vocabulaire).
    compte.delete(bestK); ou.delete(bestK);
    if (faites > 0) fus.push(a, b);
  }
  return fabriquer(Int32Array.from(fus), vocab);
}

/** Tranche-égalité déterministe : un hachage de la paire mêlé à la graine. */
function tie(k: number, graine: number): number {
  let x = (k ^ graine) >>> 0; x = Math.imul(x ^ (x >>> 16), 0x85ebca6b) >>> 0; x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35) >>> 0; return (x ^ (x >>> 16)) >>> 0;
}

// ----------------------------------------------------------------------------------------------------------------
// Sérialisation (pour les points de reprise).
// ----------------------------------------------------------------------------------------------------------------

export interface DecoupageSerialise { vocab: number; version: number; fusions: Int32Array }
export function serialiserDecoupage(d: DecoupageConcret): DecoupageSerialise { return { vocab: d.vocab, version: d.version, fusions: Int32Array.from(d.fusions) }; }
export function lireDecoupageSerialise(s: DecoupageSerialise): DecoupageConcret { return fabriquer(Int32Array.from(s.fusions), s.vocab); }
/** Un découpage rangé est-il de la règle d'aujourd'hui ? (sa version rangée = celle qu'on recalcule ; sinon il a été
 *  appris avec une ancienne règle de pré-découpage ou un ancien algorithme). Pur. */
export function decoupageAJour(s: DecoupageSerialise): boolean { try { return lireDecoupageSerialise(s).version === s.version; } catch { return false; } }
