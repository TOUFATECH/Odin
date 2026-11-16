// Écho · demande 1 : corriger l'orthographe sur une transcription CONSERVÉE, chaque tour DANS SA LANGUE.
// Aucun service réel : faux modèle (il met juste une majuscule et un point, et note la consigne reçue pour vérifier
// sa langue). On couvre : la consigne écrite dans la langue du tour ; la correction du texte entendu (pas la
// traduction) ; la route qui montre l'avant/après puis garde le texte corrigé (chiffré) ; le mode démo (pas de modèle).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_CONFIG } from '../src/config.ts';
import { archiveRoute } from '../src/web/rodd-archive-api.ts';
import { historiqueDe, type TourGarde } from '../src/valhalla/rodd/conversation-historique.ts';
import { consigneCorrection, corrigerTours } from '../src/valhalla/rodd/conversation-correction.ts';
import type { ModeleTraduction } from '../src/valhalla/rodd/conversation-moteur.ts';
import type { VoiceConfig } from '../src/voice/voice.ts';

const VOIX: VoiceConfig = { ...DEFAULT_CONFIG.voice, localOnly: false };

/** Faux correcteur : met une majuscule et un point final, et note chaque consigne reçue (pour vérifier sa langue). */
function fauxCorrecteur(consignes: string[] = []): ModeleTraduction {
  return { local: false, nom: 'faux', demander: async (sys, user) => {
    consignes.push(sys);
    const t = user.replace(/<\/?\s*texte\s*>/gi, ' ').trim();
    return t ? `${t[0].toUpperCase()}${t.slice(1)}${/[.!?。]$/.test(t) ? '' : '.'}` : '';
  } };
}

test('consigne de correction : écrite dans la langue du tour, jamais toujours en français', () => {
  assert.match(consigneCorrection('fr'), /français/);
  assert.match(consigneCorrection('en'), /English/);
  assert.match(consigneCorrection('ja'), /日本語/);
  assert.doesNotMatch(consigneCorrection('en'), /français/);
  assert.doesNotMatch(consigneCorrection('ja'), /English|français/);
});

test('corrigerTours : corrige le texte entendu de chaque tour dans sa langue (consigne localisée)', async () => {
  const consignes: string[] = [];
  const tours = [
    { id: 't1', conv: 'c', at: '2026-11-16T00:00:00Z', qui: 'moi', de: 'fr', vers: 'en', entendu: 'bonjour je vais bien', traduit: 'hello' },
    { id: 't2', conv: 'c', at: '2026-11-16T00:01:00Z', qui: 'lui', de: 'ja', vers: 'fr', entendu: 'こんにちは', traduit: 'bonjour' },
    { id: 't3', conv: 'c', at: '2026-11-16T00:02:00Z', qui: 'moi', de: 'fr', vers: 'en', entendu: '', traduit: '' },
  ] as unknown as TourGarde[];
  const c = await corrigerTours(tours, fauxCorrecteur(consignes));
  assert.equal(c[0].de, 'fr'); assert.equal(c[0].apres, 'Bonjour je vais bien.'); assert.equal(c[0].change, true);
  assert.equal(c[1].de, 'ja'); assert.equal(c[1].change, true);
  assert.equal(c[2].change, false, 'un tour vide : rien à corriger');
  // La consigne du tour japonais est en japonais, celle du tour français en français : pas tout en français.
  assert.ok(consignes.some((s) => /日本語/.test(s)), 'consigne en japonais pour le tour ja');
  assert.ok(consignes.some((s) => /français/.test(s)), 'consigne en français pour le tour fr');
});

async function montage(modele?: ModeleTraduction, demo = false) {
  const home = mkdtempSync(join(tmpdir(), 'odin-corr-'));
  const ctx = { home, dir: join(home, 'rodd'), settings: { conversation: {} }, saveSettings() {} };
  const odin = { demo, cfg: { providers: demo ? [] : [{ model: 'faux' }], voice: VOIX }, agent: { ask: async () => '' }, paths: {} } as never;
  const srv = createServer((req, res) => { void archiveRoute(req, res, new URL(req.url!, 'http://x'), { odin, ctx: () => ctx as never, modele }); });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', () => r()));
  const u = `http://127.0.0.1:${(srv.address() as { port: number }).port}/api/rodd/archive`;
  const post = async (p: string, body: unknown, xodin = true) => {
    const r = await fetch(`${u}/${p}`, { method: 'POST', headers: xodin ? { 'x-odin': '1' } : {}, body: JSON.stringify(body) });
    return { status: r.status, json: (await r.json()) as Record<string, unknown> };
  };
  return { ctx, post, fin: () => { srv.close(); rmSync(home, { recursive: true, force: true }); } };
}

test('route corriger : montre avant/après, puis « garder » remplace le texte entendu (chiffré), traduction intacte', async () => {
  const m = await montage(fauxCorrecteur());
  try {
    const h = historiqueDe(m.ctx as never);
    const id = h.ajouter({ conv: 'c1', qui: 'moi', de: 'fr', vers: 'en', entendu: 'bonjour je vais bien', traduit: 'hello', at: '2026-11-16T00:00:00Z' });
    const a = await m.post('corriger', { conv: 'c1' });
    assert.equal(a.status, 200); assert.equal(a.json.ok, true);
    const t = (a.json.tours as Array<{ id: string; avant: string; apres: string; change: boolean }>).find((x) => x.id === id)!;
    assert.equal(t.avant, 'bonjour je vais bien'); assert.equal(t.apres, 'Bonjour je vais bien.'); assert.equal(t.change, true);
    // Garder le choix : le texte entendu gardé devient le texte corrigé, marqué « corrigé ».
    const g = await m.post('corriger-garder', { conv: 'c1', corrections: [{ id, apres: t.apres }] });
    assert.equal(g.json.ok, true); assert.equal(g.json.n, 1);
    const apres = h.lister(10, 'c1')[0];
    assert.equal(apres.entendu, 'Bonjour je vais bien.'); assert.equal(apres.corrige, true);
    assert.equal(apres.traduit, 'hello', 'la traduction n\'est pas touchée');
  } finally { m.fin(); }
});

test('route corriger : POST exige x-odin ; sans modèle (démo) le dit et propose de configurer', async () => {
  const m = await montage(undefined, true);
  try {
    historiqueDe(m.ctx as never).ajouter({ conv: 'c1', qui: 'moi', de: 'fr', vers: 'en', entendu: 'bonjour', traduit: 'hi', at: '2026-11-16T00:00:00Z' });
    assert.equal((await m.post('corriger', { conv: 'c1' }, false)).status, 403, 'sans x-odin : refusé');
    const a = await m.post('corriger', { conv: 'c1' });
    assert.equal(a.json.ok, false); assert.match(String(a.json.aide), /Réglages/);
  } finally { m.fin(); }
});

test('page : le bouton « Corriger l\'orthographe » appelle la route et garde ou annule le choix', () => {
  const src = readFileSync(new URL('../src/web/pages/rodd-conversation.js', import.meta.url), 'utf8');
  assert.match(src, /Corriger l'orthographe/);
  assert.match(src, /archive\('corriger', \{ conv \}\)/);
  assert.match(src, /archive\('corriger-garder'/);
  assert.match(src, /Garder les corrections/);
});
