// Le découpage de Métis lu dans le fichier (src/brain/metis/decoupage.ts) : aller-retour reproductible pour les
// trois façons — SentencePiece à scores (llama), BPE au niveau des octets (gpt2) et repli pur octet — sur un
// mini-vocabulaire fabriqué dans l'essai. Aucun vrai modèle.
import assert from 'node:assert/strict';
import test from 'node:test';
import { construireDecoupage } from '../src/brain/metis/decoupage.ts';
import type { MetaValeur } from '../src/brain/metis/types.ts';

const hex = (b: number): string => b.toString(16).padStart(2, '0');

/** Les 256 morceaux « octet brut » <0xNN>. Garantissent que tout texte est représentable (repli). */
function tokensOctets(): string[] {
  const t: string[] = [];
  for (let b = 0; b < 256; b++) t.push(`<0x${hex(b).toUpperCase()}>`);
  return t;
}

/** Table octet→caractère de GPT-2 (répliquée ici pour fabriquer le vocabulaire de base). */
function byteVersUni(): string[] {
  const v: string[] = new Array(256);
  const visibles = new Set<number>();
  for (let i = 33; i <= 126; i++) visibles.add(i);
  for (let i = 161; i <= 172; i++) visibles.add(i);
  for (let i = 174; i <= 255; i++) visibles.add(i);
  let n = 0;
  for (let b = 0; b < 256; b++) { if (visibles.has(b)) v[b] = String.fromCodePoint(b); else v[b] = String.fromCodePoint(256 + n++); }
  return v;
}

test('repli pur octet : decoder(encoder(x)) rend exactement x pour FR, accents, émojis', () => {
  const tokens = tokensOctets();
  const meta: Record<string, MetaValeur> = { 'tokenizer.ggml.tokens': tokens as MetaValeur };
  const d = construireDecoupage(meta, 'llama');
  for (const s of ['bonjour', 'héllo Ôdin', '😀🚀', 'a b\tc', '']) assert.equal(d.decoder(d.encoder(s)), s, JSON.stringify(s));
  assert.equal(d.vocab, 256);
});

test('SentencePiece (llama) : fusions par meilleur score, repli octet, aller-retour exact', () => {
  const tokens = [...tokensOctets(), 'h', 'e', 'l', 'o', 'he', 'll', 'hello'];
  // scores : byte tokens bas, singles plus bas, fusions plus hautes (on veut qu'elles gagnent).
  const scores: number[] = [];
  for (let b = 0; b < 256; b++) scores.push(-20);
  scores.push(-10, -10, -10, -10, -5, -4, -1); // h,e,l,o,he,ll,hello
  const meta: Record<string, MetaValeur> = {
    'tokenizer.ggml.model': 'llama',
    'tokenizer.ggml.tokens': tokens as MetaValeur,
    'tokenizer.ggml.scores': scores as MetaValeur,
    'tokenizer.ggml.add_space_prefix': false,
    'tokenizer.ggml.bos_token_id': 1,
    'tokenizer.ggml.eos_token_id': 2,
  };
  const d = construireDecoupage(meta, 'llama');
  // « hello » doit se fusionner (moins de morceaux que de lettres) et se décoder exactement.
  const ids = d.encoder('hello');
  assert.ok(ids.length < 5, `fusion attendue, ${ids.length} morceaux`);
  assert.equal(d.decoder(ids), 'hello');
  // Mélange fusion + repli octet (le « x » et « é » tombent sur les octets).
  for (const s of ['hello', 'hellox', 'héllo', 'hello world']) assert.equal(d.decoder(d.encoder(s)), s, JSON.stringify(s));
  // morceau(id) décode un seul identifiant (pour la diffusion).
  assert.equal(d.morceau(ids[0] as number) + d.morceau(ids[1] as number) + d.morceau(ids[2] as number), 'hello');
  assert.equal(d.bos, 1);
  assert.equal(d.eos, 2);
});

test('BPE au niveau des octets (gpt2) : table octet→caractère, fusions par rang, aller-retour exact', () => {
  const base = byteVersUni(); // 256 caractères de base
  const tokens = [...base, 'he', 'll', 'hell', 'hello'];
  const merges = ['h e', 'l l', 'he ll', 'hell o']; // construit « hello » de proche en proche
  const meta: Record<string, MetaValeur> = {
    'tokenizer.ggml.model': 'gpt2',
    'tokenizer.ggml.tokens': tokens as MetaValeur,
    'tokenizer.ggml.merges': merges as MetaValeur,
  };
  const d = construireDecoupage(meta, 'gpt2');
  const ids = d.encoder('hello');
  assert.equal(ids.length, 1, 'tout « hello » fusionné en un morceau');
  assert.equal(d.decoder(ids), 'hello');
  for (const s of ['hello', 'hello world', 'héllo 😀', 'abc']) assert.equal(d.decoder(d.encoder(s)), s, JSON.stringify(s));
});

test('la version du découpage dépend du vocabulaire (sceau reproductible)', () => {
  const m1: Record<string, MetaValeur> = { 'tokenizer.ggml.tokens': ['a', 'b', 'c'] as MetaValeur };
  const m2: Record<string, MetaValeur> = { 'tokenizer.ggml.tokens': ['a', 'b', 'd'] as MetaValeur };
  const v1 = construireDecoupage(m1, 'llama').version;
  assert.equal(v1, construireDecoupage(m1, 'llama').version, 'même vocabulaire → même version');
  assert.notEqual(v1, construireDecoupage(m2, 'llama').version, 'vocabulaire différent → version différente');
});
