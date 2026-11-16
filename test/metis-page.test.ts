// Page Métis : le tableau des modèles doit porter des data-label (sinon, sur mobile, les colonnes empilées n'ont plus
// de nom — la mise en page d'Odin repose dessus), et la page doit être SERVIE par une route propriétaire du serveur web
// (sinon le propriétaire ne voit jamais le catalogue ni la vitesse mesurée). Aucun service réel.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { pageMetisHtml, ligneModele } from '../src/brain/metis/page.ts';
import { metisRoute } from '../src/web/metis-api.ts';
import type { ModeleCatalogue } from '../src/brain/metis/types.ts';

const MODELE: ModeleCatalogue = {
  id: 'qwen', nom: 'Qwen2.5 3B Instruct', chemin: '/x.gguf', arch: 'qwen2',
  tailleOctets: 2 * 1024 * 1024 * 1024, empreinte: 'abc', quant: 'Q4_K', type: 'chat',
};

test('ligneModele : chaque cellule porte son data-label (colonnes nommées sur mobile)', () => {
  const html = ligneModele(MODELE);
  for (const label of ['Modèle', 'Famille', 'Quantification', 'Taille', 'Type', 'Vitesse mesurée']) {
    assert.ok(html.includes(`data-label="${label}"`), `data-label manquant : ${label}`);
  }
});

test('pageMetisHtml : fragment de section avec le tableau et les en-têtes', () => {
  const html = pageMetisHtml([MODELE]);
  assert.ok(html.includes('<section class="metis">'));
  assert.ok(html.includes('data-label="Famille"'));
  // Ligne vide : colspan conservé et classe « empty ».
  const vide = pageMetisHtml([]);
  assert.ok(vide.includes('colspan="6"') && vide.includes('class="empty'));
});

function fauxRes(): ServerResponse & { statusCode: number; corps: string; entetes: Record<string, string> } {
  const r = {
    statusCode: 0, corps: '', entetes: {} as Record<string, string>,
    writeHead(code: number, headers?: Record<string, string>) { this.statusCode = code; this.entetes = headers ?? {}; return this; },
    end(b?: string) { this.corps = b ?? ''; },
  };
  return r as unknown as ServerResponse & { statusCode: number; corps: string; entetes: Record<string, string> };
}

test('metisRoute : GET /api/metis/page (propriétaire) sert le HTML de la page', async () => {
  const home = await mkdtemp(join(tmpdir(), 'metis-page-'));
  try {
    const res = fauxRes();
    const req = { method: 'GET' } as IncomingMessage;
    const url = new URL('http://127.0.0.1/api/metis/page');
    const pris = await metisRoute(req, res, url, { home, authed: true, fail: () => {} });
    assert.equal(pris, true);
    assert.equal(res.statusCode, 200);
    assert.ok(/text\/html/.test(res.entetes['content-type'] ?? ''));
    assert.ok(res.corps.includes('<section class="metis">'));
  } finally { await rm(home, { recursive: true, force: true }); }
});

test('metisRoute : refus 401 si pas le propriétaire, et appelle fail()', async () => {
  const res = fauxRes();
  let echoue = false;
  const req = { method: 'GET' } as IncomingMessage;
  const url = new URL('http://127.0.0.1/api/metis/page');
  const pris = await metisRoute(req, res, url, { home: '/x', authed: false, fail: () => { echoue = true; } });
  assert.equal(pris, true);
  assert.equal(res.statusCode, 401);
  assert.ok(echoue, 'fail() doit être appelé pour limiter les tentatives');
});

test('metisRoute : ne prend pas les chemins qui ne sont pas les siens', async () => {
  const res = fauxRes();
  const req = { method: 'GET' } as IncomingMessage;
  const url = new URL('http://127.0.0.1/api/keryx/etat');
  const pris = await metisRoute(req, res, url, { home: '/x', authed: true, fail: () => {} });
  assert.equal(pris, false);
});
