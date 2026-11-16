// Sûreté de Métis : le fichier GGUF est traité comme HOSTILE. Un hyper-paramètre démesuré (block_count,
// embedding_length…) ne doit PAS pouvoir faire allouer des tableaux géants et épuiser la mémoire du processus : il est
// refusé à la lecture. Et un modèle dont la GÉOMÉTRIE (pas la taille du fichier) demande trop de mémoire est refusé
// poliment AVANT toute allocation. Aucun vrai modèle, aucun service.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { lireGguf } from '../src/brain/metis/gguf.ts';
import { creerEtat } from '../src/brain/metis/avant.ts';
import type { ModeleGguf, InfoTenseur } from '../src/brain/metis/types.ts';

const MV = { UINT32: 4, STRING: 8, ARRAY: 9 } as const;
const GGML_F32 = 0;

class W {
  private parts: Buffer[] = [];
  private push(b: Buffer): this { this.parts.push(b); return this; }
  u32(n: number): this { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0); return this.push(b); }
  u64(n: number | bigint): this { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); return this.push(b); }
  f32(n: number): this { const b = Buffer.alloc(4); b.writeFloatLE(n); return this.push(b); }
  bytes(b: Buffer | Uint8Array): this { return this.push(Buffer.from(b)); }
  str(s: string): this { const u = Buffer.from(s, 'utf8'); return this.u64(u.length).bytes(u); }
  kvStr(k: string, v: string): this { return this.str(k).u32(MV.STRING).str(v); }
  kvU32(k: string, v: number): this { return this.str(k).u32(MV.UINT32).u32(v); }
  kvArrStr(k: string, arr: string[]): this { this.str(k).u32(MV.ARRAY).u32(MV.STRING).u64(arr.length); for (const a of arr) this.str(a); return this; }
  get taille(): number { return this.parts.reduce((n, p) => n + p.length, 0); }
  fin(): Buffer { return Buffer.concat(this.parts); }
}

/** Un GGUF llama minuscule (1 tenseur token_embd.weight F32), avec un block_count paramétrable (pour l'attaque). */
function gguf(blockCount: number): Buffer {
  const emb = 4, vocab = 3;
  const w = new W();
  w.u32(0x46554747).u32(3).u64(1); // magic, version, 1 tenseur
  const metas: Array<(x: W) => void> = [
    (x) => x.kvStr('general.architecture', 'llama'),
    (x) => x.kvU32('general.alignment', 32),
    (x) => x.kvU32('llama.embedding_length', emb),
    (x) => x.kvU32('llama.block_count', blockCount),
    (x) => x.kvU32('llama.feed_forward_length', 8),
    (x) => x.kvU32('llama.attention.head_count', 2),
    (x) => x.kvArrStr('tokenizer.ggml.tokens', ['<unk>', 'a', 'b']),
  ];
  w.u64(metas.length);
  for (const m of metas) m(w);
  w.str('token_embd.weight').u32(2).u64(emb).u64(vocab).u32(GGML_F32).u64(0);
  const reste = w.taille % 32;
  if (reste) w.bytes(Buffer.alloc(32 - reste));
  const dv = Buffer.alloc(emb * vocab * 4);
  for (let i = 0; i < emb * vocab; i++) dv.writeFloatLE(i - 5.5, i * 4);
  w.bytes(dv);
  return w.fin();
}

async function fichier(buf: Buffer): Promise<{ chemin: string; nettoyer: () => Promise<void> }> {
  const dir = await mkdtemp(join(tmpdir(), 'metis-sec-'));
  const chemin = join(dir, 'modele.gguf');
  await writeFile(chemin, buf);
  return { chemin, nettoyer: () => rm(dir, { recursive: true, force: true }) };
}

test('GGUF hostile : block_count démesuré est REFUSÉ à la lecture (pas d\'allocation géante)', async () => {
  // Reproduction du PoC : un petit fichier déclare 2 milliards de couches. Doit être refusé net, sans planter.
  const { chemin, nettoyer } = await fichier(gguf(2_000_000_000));
  try { await assert.rejects(() => lireGguf(chemin), /hors bornes/); } finally { await nettoyer(); }
});

test('GGUF hostile : block_count supérieur au nombre de tenseurs présents est refusé', async () => {
  // 5 couches annoncées mais 1 seul tenseur dans le fichier : incohérent → refusé.
  const { chemin, nettoyer } = await fichier(gguf(5));
  try { await assert.rejects(() => lireGguf(chemin), /dépasse le nombre de tenseurs/); } finally { await nettoyer(); }
});

test('GGUF sain : block_count=1 avec son tenseur est accepté (la borne ne gêne pas un vrai petit modèle)', async () => {
  const { chemin, nettoyer } = await fichier(gguf(1));
  try {
    const m = await lireGguf(chemin);
    assert.equal(m.hyper.blockCount, 1);
    await m.fermer();
  } finally { await nettoyer(); }
});

test('creerEtat : un modèle à GÉOMÉTRIE démesurée (petit fichier, poids énormes) est refusé poliment avant toute allocation', async () => {
  // tailleOctets minuscule mais la géométrie déclarée demande des dizaines de Go en flottants : refus net, et tenseur()
  // n'est JAMAIS appelé (aucun tableau géant alloué).
  const dims = [100_000, 100_000]; // 1e10 paramètres → ~40 Go en F32
  const tenseurs = new Map<string, InfoTenseur>([
    ['token_embd.weight', { nom: 'token_embd.weight', dims, type: GGML_F32, offset: 0, octets: 0 }],
  ]);
  const modele: ModeleGguf = {
    arch: 'llama',
    meta: {},
    hyper: { embeddingLength: 8, blockCount: 2, feedForwardLength: 12, headCount: 4, headCountKv: 2, ropeDimensionCount: 2, ropeFreqBase: 10000, rmsEps: 1e-5, contextLength: 32, vocabLength: 10 },
    tenseurs,
    decoupage: { vocab: 10, version: 1, bos: 1, eos: -1, encoder: () => new Int32Array(), decoder: () => '', morceau: () => '' },
    tenseur: async () => { throw new Error('tenseur() ne doit PAS être appelé : le refus doit précéder toute allocation'); },
    tailleOctets: 4096,
    empreinte: 'x',
    fermer: async () => {},
  };
  await assert.rejects(() => creerEtat(modele), /mémoire/);
});
