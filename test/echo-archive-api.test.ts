// Écho · routes de l'archive (enregistrement, son, résumé). Aucun service réel : faux modèle, faux son (de vrais petits
// WAV). On vérifie l'enchaînement complet : voyant d'enregistrement, taille du son, flux WAV déchiffré, résumé par le
// modèle (jamais inventé ; sans modèle, c'est dit), relecture/modification, et le pointeur neutre en mémoire.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_CONFIG } from '../src/config.ts';
import { archiveRoute } from '../src/web/rodd-archive-api.ts';
import { historiqueDe } from '../src/valhalla/rodd/conversation-historique.ts';
import { enregistrementDe } from '../src/valhalla/rodd/conversation-son.ts';
import { brancherMemoireConversation } from '../src/valhalla/rodd/conversation-memoire.ts';
import type { PointeurConversation } from '../src/valhalla/rodd/conversation-memoire.ts';

function wav(octet: number, n = 32): Uint8Array {
  const b = Buffer.alloc(44 + n);
  b.write('RIFF', 0, 'ascii'); b.writeUInt32LE(36 + n, 4); b.write('WAVE', 8, 'ascii');
  b.write('fmt ', 12, 'ascii'); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(8000, 24); b.writeUInt32LE(16000, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
  b.write('data', 36, 'ascii'); b.writeUInt32LE(n, 40); Buffer.alloc(n, octet).copy(b, 44);
  return new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
}
const fauxModele = (rep: string, local = true) => ({ local, nom: 'faux', demander: async () => rep });

test('archive : enregistrement, son chiffré en flux, résumé par le modèle, pointeur en mémoire', async () => {
  const home = mkdtempSync(join(tmpdir(), 'odin-arch-'));
  const ctx = { home, dir: join(home, 'rodd'), settings: {}, saveSettings() {} } as never as { home: string; dir: string; settings: Record<string, unknown> };
  const notes: PointeurConversation[] = []; brancherMemoireConversation({ noter: (p) => notes.push(p), oublier() {} });
  const odin = { modele: { pret: () => true }, cfg: { providers: [{ model: 'faux' }], voice: DEFAULT_CONFIG.voice }, agent: { ask: async () => '' }, paths: {} } as never;
  const srv = createServer((req, res) => { void archiveRoute(req, res, new URL(req.url!, 'http://x'), { odin, ctx: () => ctx as never, modele: fauxModele('Réservation pour deux à 20 h.') }); });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', () => r()));
  const u = `http://127.0.0.1:${(srv.address() as { port: number }).port}/api/rodd/archive`;
  const post = async (p: string, body: unknown, h: Record<string, string> = { 'x-odin': '1' }) => { const r = await fetch(`${u}/${p}`, { method: 'POST', headers: h, body: typeof body === 'string' ? body : JSON.stringify(body) }); return { status: r.status, j: await r.json() as Record<string, unknown> }; };
  try {
    // x-odin obligatoire.
    assert.equal((await post('etat', { conv: 'c1' }, {})).status, 403);
    // État de départ : rien.
    let r = await post('etat', { conv: 'c1' });
    assert.equal(r.j.enregistre, false); assert.equal(r.j.sonOctets, 0);
    assert.deepEqual(r.j.resume, { existe: false, modifie: false });
    assert.ok((r.j.limite as { secondes: number }).secondes > 0);
    // Allumer l'enregistrement : voyant allumé.
    assert.equal((await post('enregistrer', { conv: 'c1', actif: true })).j.enregistre, true);
    assert.equal((await post('etat', { conv: 'c1' })).j.enregistre, true);
    // Déposer du son (comme le fait la route /tour), puis vérifier la taille.
    enregistrementDe(ctx as never).ajouter('c1', 't1', wav(0x55, 24));
    enregistrementDe(ctx as never).ajouter('c1', 't2', wav(0x66, 24));
    assert.ok(Number((await post('etat', { conv: 'c1' })).j.sonOctets) > 0);
    // Le son en flux : un WAV déchiffré, les deux morceaux dedans.
    const son = await fetch(`${u}/son?conv=c1`, { headers: { 'x-odin': '1' } });
    assert.equal(son.status, 200); assert.equal(son.headers.get('content-type'), 'audio/wav');
    const wavBuf = Buffer.from(await son.arrayBuffer());
    assert.equal(wavBuf.toString('ascii', 0, 4), 'RIFF');
    const data = wavBuf.subarray(wavBuf.indexOf(Buffer.from('data')) + 8);
    assert.ok(data.includes(Buffer.alloc(24, 0x55)) && data.includes(Buffer.alloc(24, 0x66)));
    // Pas de son pour une autre conversation : 404.
    assert.equal((await fetch(`${u}/son?conv=zz`, { headers: { 'x-odin': '1' } })).status, 404);
    // Déposer une transcription (texte chiffré), puis résumer par le modèle.
    const h = historiqueDe(ctx as never);
    h.ajouter({ conv: 'c1', qui: 'moi', de: 'fr', vers: 'ja', entendu: 'une table pour deux à 20 h', traduit: '20時に二人分', at: '2026-11-16T14:02:00' });
    h.ajouter({ conv: 'c1', qui: 'lui', de: 'ja', vers: 'fr', entendu: '承知しました', traduit: 'Entendu.', at: '2026-11-16T14:03:00' });
    r = await post('resume', { conv: 'c1' });
    assert.equal(r.j.ok, true); assert.equal(r.j.texte, 'Réservation pour deux à 20 h.'); assert.equal(r.j.modele, 'faux');
    // Le résumé est gardé, relisible, modifiable.
    assert.deepEqual((await post('resume-lire', { conv: 'c1' })).j, { ok: true, texte: 'Réservation pour deux à 20 h.', modifie: false });
    assert.equal((await post('resume-modifier', { conv: 'c1', texte: 'À la main.' })).j.ok, true);
    assert.deepEqual((await post('resume-lire', { conv: 'c1' })).j, { ok: true, texte: 'À la main.', modifie: true });
    assert.equal((await post('etat', { conv: 'c1' })).j.resume && ((await post('etat', { conv: 'c1' })).j.resume as { existe: boolean }).existe, true);
    // La mémoire a reçu un POINTEUR NEUTRE (titre + langues), jamais le texte ni le résumé.
    const p = notes.find((x) => x.conv === 'c1'); assert.ok(p);
    assert.ok(p!.langues.includes('français') && p!.langues.includes('japonais'));
    assert.doesNotMatch(JSON.stringify(notes), /承知しました|Réservation pour deux|table pour deux/, 'aucun texte de tour ni résumé en mémoire');
  } finally { srv.close(); brancherMemoireConversation(undefined); rmSync(home, { recursive: true, force: true }); }
});

test('résumé sans modèle de langue : jamais de faux texte, l\'aide est donnée', async () => {
  const home = mkdtempSync(join(tmpdir(), 'odin-arch-'));
  const ctx = { home, dir: join(home, 'rodd'), settings: {}, saveSettings() {} } as never as { home: string };
  const odin = { modele: { pret: () => false }, cfg: { providers: [{ model: 'x' }], voice: DEFAULT_CONFIG.voice }, agent: { ask: async () => 'ne doit pas servir' }, paths: {} } as never;
  const srv = createServer((req, res) => { void archiveRoute(req, res, new URL(req.url!, 'http://x'), { odin, ctx: () => ctx as never }); });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', () => r()));
  const u = `http://127.0.0.1:${(srv.address() as { port: number }).port}/api/rodd/archive`;
  try {
    const r = await (await fetch(`${u}/resume`, { method: 'POST', headers: { 'x-odin': '1' }, body: JSON.stringify({ conv: 'c1' }) })).json() as Record<string, unknown>;
    assert.equal(r.ok, false); assert.match(String(r.aide), /Réglages → Modèle/);
  } finally { srv.close(); rmSync(home, { recursive: true, force: true }); }
});
