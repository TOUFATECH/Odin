// Lecture GGUF de Métis (src/brain/metis/gguf.ts) : un faux fichier GGUF minuscule fabriqué OCTET PAR OCTET dans
// l'essai, d'après le format public de ggml ; on vérifie l'en-tête, les métadonnées, la fiche et la lecture d'un
// tenseur, l'empreinte SHA-256, et le REFUS net de valeurs hors bornes (le fichier est traité comme hostile).
// Aucun vrai modèle, aucun service.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { lireGguf } from '../src/brain/metis/gguf.ts';

// Types de valeur des métadonnées GGUF.
const MV = { UINT32: 4, FLOAT32: 6, STRING: 8, ARRAY: 9 } as const;
const GGML_F32 = 0;

/** Un écrivain d'octets petit-boutien, pour poser un fichier GGUF à la main. */
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

/** Construit un GGUF minuscule : archi llama, un tenseur token_embd.weight en F32 [emb, vocab]. */
function faireGguf(o: { tronquer?: boolean } = {}): { buf: Buffer; valeurs: number[]; emb: number; vocab: number } {
  const emb = 4, vocab = 3;
  const valeurs: number[] = [];
  for (let i = 0; i < emb * vocab; i++) valeurs.push(i - 5.5); // 12 flottants, pas tous positifs
  const w = new W();
  w.u32(0x46554747); // magic « GGUF »
  w.u32(3); // version
  w.u64(1); // nombre de tenseurs
  // métadonnées
  const metas: Array<(x: W) => void> = [
    (x) => x.kvStr('general.architecture', 'llama'),
    (x) => x.kvU32('general.alignment', 32),
    (x) => x.kvU32('llama.embedding_length', emb),
    (x) => x.kvU32('llama.block_count', 1),
    (x) => x.kvU32('llama.feed_forward_length', 8),
    (x) => x.kvU32('llama.attention.head_count', 2),
    (x) => x.kvStr('tokenizer.ggml.model', 'llama'),
    (x) => x.kvArrStr('tokenizer.ggml.tokens', ['<unk>', 'a', 'b']),
  ];
  w.u64(metas.length); // nombre de métadonnées
  for (const m of metas) m(w);
  // fiche de tenseur : nom, n_dims, dims (petit-boutien : [emb, vocab]), type, offset
  w.str('token_embd.weight').u32(2).u64(emb).u64(vocab).u32(GGML_F32).u64(0);
  // padding jusqu'au multiple de 32
  const reste = w.taille % 32;
  if (reste) w.bytes(Buffer.alloc(32 - reste));
  // données : 12 flottants F32
  const dv = Buffer.alloc(emb * vocab * 4);
  for (let i = 0; i < valeurs.length; i++) dv.writeFloatLE(valeurs[i], i * 4);
  if (!o.tronquer) w.bytes(dv);
  else w.bytes(dv.subarray(0, dv.length - 8)); // données tronquées : le tenseur déborde
  return { buf: w.fin(), valeurs, emb, vocab };
}

async function fichierTemp(buf: Buffer, nom = 'modele.gguf'): Promise<{ chemin: string; nettoyer: () => Promise<void> }> {
  const dir = await mkdtemp(join(tmpdir(), 'metis-gguf-'));
  const chemin = join(dir, nom);
  await writeFile(chemin, buf);
  return { chemin, nettoyer: () => rm(dir, { recursive: true, force: true }) };
}

test('lireGguf : en-tête, métadonnées, hyper-paramètres, fiche de tenseur et lecture d\'un tenseur', async () => {
  const { buf, valeurs, emb, vocab } = faireGguf();
  const { chemin, nettoyer } = await fichierTemp(buf);
  try {
    const m = await lireGguf(chemin);
    assert.equal(m.arch, 'llama');
    assert.equal(m.hyper.embeddingLength, emb);
    assert.equal(m.hyper.blockCount, 1);
    assert.equal(m.hyper.feedForwardLength, 8);
    assert.equal(m.hyper.headCount, 2);
    assert.equal(m.hyper.headCountKv, 2); // absent → = headCount
    assert.equal(m.hyper.vocabLength, vocab);
    assert.equal(m.hyper.ropeFreqBase, 10000); // défaut
    assert.equal(m.decoupage.vocab, vocab);
    // fiche du tenseur
    const fiche = m.tenseurs.get('token_embd.weight');
    assert.ok(fiche);
    assert.deepEqual(fiche!.dims, [emb, vocab]);
    assert.equal(fiche!.type, GGML_F32);
    assert.equal(fiche!.octets, emb * vocab * 4);
    // lecture + déquantification
    const t = await m.tenseur('token_embd.weight');
    assert.deepEqual(t.dims, [emb, vocab]);
    assert.equal(t.data.length, valeurs.length);
    for (let i = 0; i < valeurs.length; i++) assert.ok(Math.abs(t.data[i] - valeurs[i]) < 1e-6, `valeur ${i}`);
    // empreinte SHA-256 = celle du fichier
    assert.equal(m.empreinte, createHash('sha256').update(buf).digest('hex'));
    await m.fermer();
    await assert.rejects(() => m.tenseur('token_embd.weight'), /fermé/);
  } finally { await nettoyer(); }
});

test('fichier hostile : signature absente, version refusée, nombre de tenseurs démesuré, tenseur qui déborde', async () => {
  // Mauvaise signature.
  {
    const w = new W().u32(0x58585858).u32(3).u64(0).u64(0);
    const { chemin, nettoyer } = await fichierTemp(w.fin());
    try { await assert.rejects(() => lireGguf(chemin), /signature/); } finally { await nettoyer(); }
  }
  // Version non prise en charge.
  {
    const w = new W().u32(0x46554747).u32(42).u64(0).u64(0);
    const { chemin, nettoyer } = await fichierTemp(w.fin());
    try { await assert.rejects(() => lireGguf(chemin), /version/); } finally { await nettoyer(); }
  }
  // Nombre de tenseurs démesuré (borne de sûreté AVANT toute allocation).
  {
    const w = new W().u32(0x46554747).u32(3).u64(2n ** 40n).u64(0);
    const { chemin, nettoyer } = await fichierTemp(w.fin());
    try { await assert.rejects(() => lireGguf(chemin), /hors bornes/); } finally { await nettoyer(); }
  }
  // Tenseur qui déborde du fichier (données tronquées).
  {
    const { buf } = faireGguf({ tronquer: true });
    const { chemin, nettoyer } = await fichierTemp(buf);
    try { await assert.rejects(() => lireGguf(chemin), /déborde/); } finally { await nettoyer(); }
  }
});
