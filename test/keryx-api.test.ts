// Kéryx — la route /api/keryx/* (src/web/keryx-api.ts) pilotée avec de FAUX req/res (aucun serveur). On vérifie la
// garde d'écriture : l'en-tête x-odin est obligatoire sur toute écriture (défense de profondeur contre les requêtes
// intersites), comme les routes sœurs. Régression du défaut : POST /secret et /historique/effacer passaient sans.
// UN FICHIER À LA FOIS.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable, Writable } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { keryxRoute } from '../src/web/keryx-api.ts';
import { secretPose } from '../src/valhalla/keryx/auth.ts';

function fakeReq(method: string, headers: Record<string, string>, body?: unknown): IncomingMessage {
  const r = Readable.from(body !== undefined ? [Buffer.from(JSON.stringify(body))] : []) as unknown as IncomingMessage;
  (r as unknown as { method: string }).method = method;
  (r as unknown as { headers: Record<string, string> }).headers = headers;
  return r;
}
class FakeRes extends Writable {
  code?: number; body = '';
  writeHead(code: number): this { this.code = code; return this; }
  _write(chunk: Buffer, _enc: string, cb: () => void): void { this.body += chunk.toString(); cb(); }
}
async function appel(home: string, method: string, path: string, headers: Record<string, string>, body?: unknown): Promise<{ code?: number; json: Record<string, unknown> }> {
  const res = new FakeRes();
  const d = { home, authed: true, fail: () => undefined };
  await keryxRoute(fakeReq(method, headers, body), res as unknown as ServerResponse, new URL(`http://x${path}`), d);
  let json: Record<string, unknown> = {};
  try { json = res.body ? JSON.parse(res.body) as Record<string, unknown> : {}; } catch { /* non-JSON */ }
  return { code: res.code, json };
}

test('écriture sans x-odin → 403 ; le secret n\'est PAS posé (défense de profondeur)', async () => {
  const home = mkdtempSync(join(tmpdir(), 'keryx-api-'));
  try {
    const r = await appel(home, 'POST', '/api/keryx/secret', {}, { code: 'mon-code-1' });
    assert.equal(r.code, 403);
    assert.match(String(r.json.error), /x-odin/);
    assert.equal(secretPose(home), false, 'le code secret n\'a pas été posé sans x-odin');
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test('écriture avec x-odin:1 → acceptée (le secret est posé)', async () => {
  const home = mkdtempSync(join(tmpdir(), 'keryx-api-'));
  try {
    const r = await appel(home, 'POST', '/api/keryx/secret', { 'x-odin': '1' }, { code: 'mon-code-1' });
    assert.equal(r.code, 200);
    assert.equal(r.json.pose, true);
    assert.equal(secretPose(home), true);
    // L'effacement de l'historique aussi exige x-odin.
    const e = await appel(home, 'POST', '/api/keryx/historique/effacer', {}, { tout: true });
    assert.equal(e.code, 403);
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test('lecture (GET /etat) : pas d\'x-odin exigé, répond 200', async () => {
  const home = mkdtempSync(join(tmpdir(), 'keryx-api-'));
  try {
    const r = await appel(home, 'GET', '/api/keryx/etat', {});
    assert.equal(r.code, 200);
    assert.equal(r.json.telephonieEssayee, false);
  } finally { rmSync(home, { recursive: true, force: true }); }
});
