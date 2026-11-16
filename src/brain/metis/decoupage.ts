// Le découpage LU DANS le fichier GGUF — reconstruit le vocabulaire rangé dans le modèle et sait couper un texte en
// identifiants, puis les recoller. Trois façons, choisies par tokenizer.ggml.model (fonctionnement public, aucun
// code recopié) :
//   « llama » : SentencePiece à scores — on fusionne les symboles voisins par meilleur score, repli octet par octet.
//   « gpt2 »  : BPE au niveau des octets — table octet→caractère de GPT-2, fusions par rang.
//   repli     : octet par octet (quand le modèle n'annonce rien d'exploitable).
// L'interface rendue (DecoupageGguf) est compatible avec le découpage de Noûs : encoder/decoder, plus morceau(id)
// pour diffuser la réponse un identifiant à la fois.

import type { DecoupageGguf, MetaValeur } from './types.ts';

const enc = new TextEncoder();
const dec = new TextDecoder();
const SPM_ESPACE = '▁'; // ▁ : l'espace de SentencePiece

// ---- Lecture des champs du tokeniseur dans les métadonnées --------------------------------------------------------
function chaine(meta: Record<string, MetaValeur>, cle: string): string | undefined {
  const v = meta[cle];
  return typeof v === 'string' ? v : undefined;
}
function nombre(meta: Record<string, MetaValeur>, cle: string): number | undefined {
  const v = meta[cle];
  if (typeof v === 'number') return v;
  if (typeof v === 'bigint') return Number(v);
  return undefined;
}
function booleen(meta: Record<string, MetaValeur>, cle: string, defaut: boolean): boolean {
  const v = meta[cle];
  return typeof v === 'boolean' ? v : defaut;
}
function tableauChaines(v: MetaValeur | undefined): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => (typeof x === 'string' ? x : ''));
}
function tableauNombres(v: MetaValeur | undefined): number[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => (typeof x === 'number' ? x : typeof x === 'bigint' ? Number(x) : 0));
}

/** Longueur du vocabulaire d'après le fichier : la liste des morceaux (repli : clé [arch].vocab_size). */
export function longueurVocab(meta: Record<string, MetaValeur>, arch: string): number {
  const toks = tableauChaines(meta['tokenizer.ggml.tokens']);
  if (toks.length) return toks.length;
  return nombre(meta, `${arch}.vocab_size`) ?? 0;
}

// ---- Table octet⇄caractère de GPT-2 (fonctionnement public) -------------------------------------------------------
function tableOctetsGpt2(): { versUni: string[]; versOctet: Map<string, number> } {
  const versUni: string[] = new Array(256);
  const visibles: number[] = [];
  for (let i = 33; i <= 126; i++) visibles.push(i);
  for (let i = 161; i <= 172; i++) visibles.push(i);
  for (let i = 174; i <= 255; i++) visibles.push(i);
  const set = new Set(visibles);
  let n = 0;
  for (let b = 0; b < 256; b++) {
    if (set.has(b)) versUni[b] = String.fromCodePoint(b);
    else { versUni[b] = String.fromCodePoint(256 + n); n++; }
  }
  const versOctet = new Map<string, number>();
  for (let b = 0; b < 256; b++) versOctet.set(versUni[b], b);
  return { versUni, versOctet };
}

// ---- Hachage de version -------------------------------------------------------------------------------------------
function hacher(tokens: string[]): number {
  let h = 2166136261 ^ tokens.length;
  for (let i = 0; i < tokens.length; i += Math.max(1, tokens.length >> 12)) {
    const t = tokens[i];
    for (let j = 0; j < t.length; j++) { h ^= t.charCodeAt(j); h = Math.imul(h, 16777619); }
  }
  return h >>> 0;
}

// ---- Repli octet par octet ----------------------------------------------------------------------------------------
/** Reconnaît un morceau « octet brut » <0xNN> et rend sa valeur, ou -1. */
function octetDe(piece: string): number {
  const m = /^<0x([0-9A-Fa-f]{2})>$/.exec(piece);
  return m ? parseInt(m[1], 16) : -1;
}

// ------------------------------------------------------------------------------------------------------------------
// Construction du découpage à partir des métadonnées du fichier.
// ------------------------------------------------------------------------------------------------------------------
export function construireDecoupage(meta: Record<string, MetaValeur>, arch: string): DecoupageGguf {
  const modele = chaine(meta, 'tokenizer.ggml.model') ?? '';
  const tokens = tableauChaines(meta['tokenizer.ggml.tokens']);
  const scores = tableauNombres(meta['tokenizer.ggml.scores']);
  const merges = tableauChaines(meta['tokenizer.ggml.merges']);
  const vocab = longueurVocab(meta, arch);
  const bos = nombre(meta, 'tokenizer.ggml.bos_token_id') ?? -1;
  const eos = nombre(meta, 'tokenizer.ggml.eos_token_id') ?? -1;
  const version = hacher(tokens);

  // morceau → identifiant (pour l'encodage) et identifiant → morceau (pour le décodage).
  const idDe = new Map<string, number>();
  for (let i = 0; i < tokens.length; i++) if (!idDe.has(tokens[i])) idDe.set(tokens[i], i);
  const octetVersId = new Map<number, number>(); // valeur d'octet → identifiant <0xNN>
  for (let i = 0; i < tokens.length; i++) { const b = octetDe(tokens[i]); if (b >= 0) octetVersId.set(b, i); }

  const morceau = (id: number): string => decoder([id]);

  // Décodage commun : on reconstruit un tampon d'octets, puis UTF-8. En SentencePiece, l'espace est ▁ (qu'il vienne
  // d'un morceau textuel ou du repli octet) ; on le rend en espace à la toute fin, à la manière publique de SPM.
  function decoder(ids: ArrayLike<number>): string {
    if (modele === 'gpt2') return decoderGpt2(ids);
    const morceaux: Uint8Array[] = [];
    let total = 0;
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i] | 0;
      const p = tokens[id];
      if (p === undefined) continue;
      const b = octetDe(p);
      const u = b >= 0 ? Uint8Array.of(b) : enc.encode(p);
      morceaux.push(u); total += u.length;
    }
    const buf = new Uint8Array(total); let o = 0;
    for (const u of morceaux) { buf.set(u, o); o += u.length; }
    const s = dec.decode(buf);
    return modele === 'llama' ? s.replace(new RegExp(SPM_ESPACE, 'g'), ' ') : s;
  }

  // ---- Encodage SentencePiece (llama) : fusions par meilleur score, repli octet ----
  const prefixeEspace = booleen(meta, 'tokenizer.ggml.add_space_prefix', true);
  function encoderSpm(texte: string): Int32Array {
    let t = texte.replace(/ /g, SPM_ESPACE);
    if (prefixeEspace) t = SPM_ESPACE + t;
    // symboles = caractères (points de code) du texte.
    let syms = [...t];
    for (;;) {
      let meilleur = -Infinity, pos = -1;
      for (let i = 0; i + 1 < syms.length; i++) {
        const fusion = syms[i] + syms[i + 1];
        const id = idDe.get(fusion);
        if (id !== undefined && scores[id] !== undefined && scores[id] > meilleur) { meilleur = scores[id]; pos = i; }
      }
      if (pos < 0) break;
      syms[pos] = syms[pos] + syms[pos + 1];
      syms.splice(pos + 1, 1);
    }
    const out: number[] = [];
    for (const s of syms) {
      const id = idDe.get(s);
      if (id !== undefined) { out.push(id); continue; }
      // repli : chaque octet UTF-8 du symbole.
      for (const b of enc.encode(s)) { const bid = octetVersId.get(b); out.push(bid !== undefined ? bid : 0); }
    }
    return Int32Array.from(out);
  }

  // ---- Encodage BPE au niveau des octets (gpt2) ----
  const gpt2 = modele === 'gpt2' ? tableOctetsGpt2() : undefined;
  const rang = new Map<string, number>();
  if (modele === 'gpt2') for (let i = 0; i < merges.length; i++) { const sp = merges[i].split(' '); if (sp.length === 2) rang.set(merges[i], i); }
  const PRE = /'s|'t|'re|'ve|'m|'ll|'d| ?\p{L}+| ?\p{N}+| ?[^\s\p{L}\p{N}]+|\s+/gu;
  function encoderGpt2(texte: string): Int32Array {
    const { versUni } = gpt2!;
    const out: number[] = [];
    for (const mot of texte.match(PRE) ?? [texte]) {
      // chaque octet du morceau → un caractère de la table.
      let pieces = [...enc.encode(mot)].map((b) => versUni[b]);
      for (;;) {
        let meilleurRang = Infinity, pos = -1;
        for (let i = 0; i + 1 < pieces.length; i++) {
          const r = rang.get(pieces[i] + ' ' + pieces[i + 1]);
          if (r !== undefined && r < meilleurRang) { meilleurRang = r; pos = i; }
        }
        if (pos < 0) break;
        pieces[pos] = pieces[pos] + pieces[pos + 1];
        pieces.splice(pos + 1, 1);
      }
      for (const p of pieces) { const id = idDe.get(p); if (id !== undefined) out.push(id); else for (const c of p) { const id2 = idDe.get(c); if (id2 !== undefined) out.push(id2); } }
    }
    return Int32Array.from(out);
  }
  function decoderGpt2(ids: ArrayLike<number>): string {
    const { versOctet } = gpt2 ?? tableOctetsGpt2();
    const octets: number[] = [];
    for (let i = 0; i < ids.length; i++) {
      const p = tokens[ids[i] | 0];
      if (p === undefined) continue;
      for (const c of p) { const b = versOctet.get(c); if (b !== undefined) octets.push(b); }
    }
    return dec.decode(Uint8Array.from(octets));
  }

  // ---- Repli pur octet ----
  function encoderOctet(texte: string): Int32Array {
    const out: number[] = [];
    for (const b of enc.encode(texte)) { const id = octetVersId.get(b); out.push(id !== undefined ? id : b & 0xff); }
    return Int32Array.from(out);
  }

  const encoder = (texte: string): Int32Array => {
    if (modele === 'llama') return encoderSpm(texte);
    if (modele === 'gpt2') return encoderGpt2(texte);
    return encoderOctet(texte);
  };

  return { vocab, version, bos, eos, encoder, decoder, morceau };
}
