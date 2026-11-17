// Écho · corrections de l'archive (enregistrement, son, mémoire). Aucun service réel : faux Whisper, faux modèle, faux
// son (de vrais petits WAV). On couvre les défauts corrigés :
//  1. le GET 'son' est joignable par le navigateur (sans x-odin, cookie de session) ;
//  2 & 4. une copie sonore SANS texte reste listée et vraiment effacée par « tout supprimer » ;
//  3. une conversation gardée entre dans la mémoire d'Odin sans attendre le résumé ;
//  5. en mode privé, le son n'est pas gardé même si l'enregistrement est allumé.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_CONFIG } from '../src/config.ts';
import { archiveRoute } from '../src/web/rodd-archive-api.ts';
import { conversationRoute } from '../src/web/conversation-api.ts';
import { enregistrementDe } from '../src/valhalla/rodd/conversation-son.ts';
import { brancherMemoireConversation, type PointeurConversation } from '../src/valhalla/rodd/conversation-memoire.ts';
import { Valhalla } from '../src/valhalla/service.ts';
import { rodd } from '../src/valhalla/modules/rodd.ts';
import { valhallaOf } from '../src/valhalla/odin.ts';
import type { Deps } from '../src/valhalla/rodd/conversation-moteur.ts';
import type { Heard } from '../src/voice/local.ts';
import type { VoiceConfig } from '../src/voice/voice.ts';
import { T } from './banc/lib.ts';
import { vraiOdin } from './banc/odin-vrai.ts';

const VOIX: VoiceConfig = { ...DEFAULT_CONFIG.voice, localOnly: false };
function wav(octet: number, n = 32): Uint8Array {
  const b = Buffer.alloc(44 + n);
  b.write('RIFF', 0, 'ascii'); b.writeUInt32LE(36 + n, 4); b.write('WAVE', 8, 'ascii');
  b.write('fmt ', 12, 'ascii'); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(8000, 24); b.writeUInt32LE(16000, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
  b.write('data', 36, 'ascii'); b.writeUInt32LE(n, 40); Buffer.alloc(n, octet).copy(b, 44);
  return new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
}
const son = (x: Record<string, unknown>) => new Uint8Array(Buffer.from(JSON.stringify(x)));
const fauxWhisper = (): NonNullable<Deps['entendre']> => async (audio, _mime, v) => {
  const x = JSON.parse(Buffer.from(audio).toString('utf8')) as { text: string; language: string };
  const l = v.stt.language.replace(/!$/, '');
  return { text: x.text, language: l === 'auto' ? x.language : l, segments: [] } as Heard;
};
const fauxModele = (rep: string): Deps['modele'] => ({ local: false, nom: 'faux', demander: async () => rep });

test('défaut 1 (unité) : le GET « son » ne réclame pas x-odin ; les POST le réclament toujours', async () => {
  const home = mkdtempSync(join(tmpdir(), 'odin-arch-'));
  const ctx = { home, dir: join(home, 'rodd'), settings: {}, saveSettings() {} } as never as { home: string; dir: string };
  const odin = { modele: { pret: () => true }, cfg: { providers: [{ model: 'faux' }], voice: VOIX }, agent: { ask: async () => '' }, paths: {} } as never;
  const srv = createServer((req, res) => { void archiveRoute(req, res, new URL(req.url!, 'http://x'), { odin, ctx: () => ctx as never }); });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', () => r()));
  const u = `http://127.0.0.1:${(srv.address() as { port: number }).port}/api/rodd/archive`;
  try {
    enregistrementDe(ctx as never).activer('c1', true);
    enregistrementDe(ctx as never).ajouter('c1', 't1', wav(0x55, 24));
    // Le navigateur (<audio>, lien de téléchargement) ne peut pas poser x-odin : le GET « son » marche quand même.
    const r = await fetch(`${u}/son?conv=c1`, { headers: {} });
    assert.equal(r.status, 200); assert.equal(r.headers.get('content-type'), 'audio/wav');
    assert.equal(Buffer.from(await r.arrayBuffer()).toString('ascii', 0, 4), 'RIFF');
    // Les POST gardent l'exigence x-odin.
    assert.equal((await fetch(`${u}/etat`, { method: 'POST', body: JSON.stringify({ conv: 'c1' }) })).status, 403);
    assert.equal((await fetch(`${u}/etat`, { method: 'POST', headers: { 'x-odin': '1' }, body: JSON.stringify({ conv: 'c1' }) })).status, 200);
  } finally { srv.close(); rmSync(home, { recursive: true, force: true }); }
});

test('défaut 1 (bout en bout) : le navigateur écoute la copie sonore via le vrai serveur (GET sans x-odin, cookie de session)', async () => {
  const tt = new T();
  try {
    const vo = await vraiOdin(tt, { compte: true, modules: () => [rodd] });
    const ctx = valhallaOf()!.ctx('rodd');
    enregistrementDe(ctx).activer('c1', true);
    enregistrementDe(ctx).ajouter('c1', 't1', wav(0x55, 24));
    // Comme un <audio src="/api/rodd/archive/son?conv=..."> : GET, cookie de session, AUCUN x-odin.
    const r = await fetch(`${vo.url}/api/rodd/archive/son?conv=c1`, { headers: { cookie: vo.session } });
    assert.equal(r.status, 200); assert.equal(r.headers.get('content-type'), 'audio/wav');
    assert.equal(Buffer.from(await r.arrayBuffer()).toString('ascii', 0, 4), 'RIFF');
    // Sans session, rien : la barrière de connexion protège le flux.
    assert.equal((await fetch(`${vo.url}/api/rodd/archive/son?conv=c1`)).status, 401);
  } finally { await tt.end(); }
});

/** Monte conversationRoute sur un petit serveur et rend une fonction pour poser un tour (son → traduction). */
async function montageTour(ctx: { home: string; dir: string; settings: Record<string, unknown> }, voix: VoiceConfig) {
  const odin = { modele: { pret: () => true }, cfg: { providers: [{ model: 'faux' }], voice: voix }, agent: { ask: async () => '' }, paths: {} } as never;
  const srv = createServer((req, res) => { void conversationRoute(req, res, new URL(req.url!, 'http://x'), { odin, voix: () => voix, ctx: () => ctx as never, deps: { entendre: fauxWhisper(), modele: fauxModele('I would like a coffee') } }); });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', () => r()));
  const base = `http://127.0.0.1:${(srv.address() as { port: number }).port}/api/rodd/conversation`;
  const tour = (q: string, texte = 'je voudrais un café', langue = 'fr') => fetch(`${base}/tour?conv=${q}`, { method: 'POST', headers: { 'x-odin': '1' }, body: son({ text: texte, language: langue }) });
  return { srv, tour };
}

test('défaut 5 : en mode privé, le son n\'est pas gardé même si l\'enregistrement est allumé', async () => {
  for (const privateMode of [false, true]) {
    const home = mkdtempSync(join(tmpdir(), 'odin-arch-')), ctx = { home, dir: join(home, 'rodd'), settings: { conversation: {} }, saveSettings() {} };
    const voix = { ...VOIX, privacy: { ...VOIX.privacy, privateMode } };
    enregistrementDe(ctx as never).activer('c', true); // l'enregistrement est bien allumé dans les deux cas
    const { srv, tour } = await montageTour(ctx, voix);
    try {
      assert.equal((await tour('c')).status, 200);
      // Mode privé : rien gardé (ni texte, ni son) ; mode normal : la copie sonore existe.
      assert.equal(enregistrementDe(ctx as never).existe('c'), !privateMode, privateMode ? 'mode privé : pas de son' : 'mode normal : son gardé');
    } finally { srv.close(); rmSync(home, { recursive: true, force: true }); }
  }
});

test('défaut 3 : une conversation gardée entre dans la mémoire d\'Odin dès le premier tour, sans attendre le résumé', async () => {
  const home = mkdtempSync(join(tmpdir(), 'odin-arch-')), ctx = { home, dir: join(home, 'rodd'), settings: { conversation: {} }, saveSettings() {} };
  const notes: PointeurConversation[] = []; brancherMemoireConversation({ noter: (p) => notes.push(p), oublier() {} });
  const { srv, tour } = await montageTour(ctx, VOIX);
  try {
    assert.equal((await tour('cx')).status, 200);
    // Le pointeur neutre est déjà là : aucun résumé n'a été demandé.
    const p = notes.find((x) => x.conv === 'cx'); assert.ok(p, 'pointeur noté dès le premier tour gardé');
    assert.ok(p!.langues.includes('français') && p!.langues.includes('anglais'));
    assert.doesNotMatch(JSON.stringify(notes), /café|coffee/, 'aucun texte de tour en mémoire');
    // Un deuxième tour de la même conversation ne crée pas de doublon (noté seulement au premier tour gardé).
    await tour('cx', 'bonjour');
    assert.equal(notes.filter((x) => x.conv === 'cx').length, 1, 'pas de doublon');
  } finally { srv.close(); brancherMemoireConversation(undefined); rmSync(home, { recursive: true, force: true }); }
});

test('défauts 2 et 4 : une copie sonore sans texte reste listée et vraiment effacée par « tout supprimer »', async () => {
  const home = mkdtempSync(join(tmpdir(), 'odin-arch-'));
  try {
    const v = new Valhalla(home, [rodd]);
    const ctx = v.ctx('rodd');
    // Une conversation enregistrée (son chiffré) mais SANS texte gardé (mode privé / « garder » décoché).
    enregistrementDe(ctx).activer('seul', true);
    enregistrementDe(ctx).ajouter('seul', 't1', wav(0x7a, 24));
    const dossierSon = join(ctx.dir, 'enregistrements', 'seul');
    assert.ok(existsSync(dossierSon), 'la copie sonore est sur le disque');
    // Elle apparaît dans la liste (son seul), donc reste supprimable.
    const liste = await v.act('rodd', 'conv_historique', {});
    const convs = (liste.data as { conversations: Array<{ conv: string; son: { existe: boolean } }> }).conversations;
    const vue = convs.find((c) => c.conv === 'seul'); assert.ok(vue && vue.son.existe, 'la conversation « son seul » est listée');
    // « Tout supprimer » balaie vraiment le son (le dossier chiffré disparaît).
    await v.act('rodd', 'conv_effacer', {});
    assert.ok(!existsSync(dossierSon), 'le son est vraiment effacé par « tout supprimer »');
    assert.equal(enregistrementDe(ctx).existe('seul'), false);
  } finally { rmSync(home, { recursive: true, force: true }); }
});
