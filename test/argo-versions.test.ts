// Argo · nouvelles versions des images (comme What's Up Docker) : un vrai registre OCI d'essai (serveur HTTP local
// qui suit le protocole de distribution, avec jeton anonyme comme Docker Hub) ; l'image du conteneur est comparée à
// l'étiquette du registre. Rien n'est téléchargé ni changé ; l'alerte propose « Mettre à jour ».
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Valhalla } from '../src/valhalla/service.ts';
import { naglfar, useEngine } from '../src/valhalla/modules/naglfar.ts';
import { verifierVersions } from '../src/valhalla/hringhorni/versions.ts';
import type { Image } from '../src/valhalla/hringhorni/store.ts';
import { fakeEngine } from './helpers.ts';

const manifeste = (n: number) => Buffer.from(JSON.stringify({ schemaVersion: 2, mediaType: 'application/vnd.docker.distribution.manifest.v2+json', config: { mediaType: 'application/vnd.docker.container.image.v1+json', digest: `sha256:${String(n).repeat(64).slice(0, 64)}`, size: 10 }, layers: [] }));
const empreinte = (b: Buffer) => `sha256:${createHash('sha256').update(b).digest('hex')}`;
const image = (nom: string, digest: string): Image => ({ id: 'a'.repeat(64), names: [nom], digest, config: {}, configDigest: '', layers: [], size: 1, pulled: '' } as unknown as Image);

test('Argo : une nouvelle version sur le registre est vue (jeton anonyme comme Docker Hub), rien n\'est téléchargé, l\'alerte propose la mise à jour', { timeout: 60_000 }, async () => {
  let courant = manifeste(1); const demandes: string[] = [];
  const srv = createServer((req, res) => {
    demandes.push(`${req.method} ${req.url}`);
    if (req.url?.startsWith('/jeton')) { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ token: 'jeton-anonyme' })); return; }
    if (req.headers.authorization !== 'Bearer jeton-anonyme') { res.writeHead(401, { 'www-authenticate': `Bearer realm="http://127.0.0.1:${(srv.address() as { port: number }).port}/jeton",service="essai",scope="repository:outils/web:pull"` }); res.end(); return; }
    if (req.url === '/v2/outils/web/manifests/1.0') { res.writeHead(200, { 'content-type': 'application/vnd.docker.distribution.manifest.v2+json' }); res.end(courant); return; }
    res.writeHead(404); res.end();
  });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r)); const port = (srv.address() as { port: number }).port, nom = `127.0.0.1:${port}/outils/web:1.0`;
  const home = mkdtempSync(join(tmpdir(), 'argo-versions-'));
  try {
    // Pur : à jour, puis nouvelle version, puis image figée par empreinte, puis registre muet.
    let l = await verifierVersions([image(nom, empreinte(courant))], [{ nom: 'web', image: nom }], { fetch, quand: 'x' });
    assert.deepEqual(l.map((v) => [v.nouvelle, v.erreur]), [[false, undefined]]);
    courant = manifeste(2);
    l = await verifierVersions([image(nom, empreinte(manifeste(1)))], [{ nom: 'web', image: nom }, { nom: 'web2', image: nom }], { fetch, quand: 'x' });
    assert.equal(l.length, 1); assert.equal(l[0].nouvelle, true); assert.deepEqual(l[0].conteneurs, ['web', 'web2']); assert.equal(l[0].distante, empreinte(courant));
    assert.ok(demandes.every((d) => !/blobs/.test(d)), 'aucune couche téléchargée');
    l = await verifierVersions([], [{ nom: 'x', image: `nginx@sha256:${'b'.repeat(64)}` }], { fetch, quand: 'x' }); assert.equal(l[0].nouvelle, false);
    l = await verifierVersions([image(`127.0.0.1:${port}/outils/absent:1`, 'sha256:x')], [{ nom: 'y', image: `127.0.0.1:${port}/outils/absent:1` }], { fetch, quand: 'x' }); assert.match(l[0].erreur ?? '', /introuvable sur le registre/);
    // Dans Argo : l'action, la surveillance (toutes les 6 heures), l'alerte avec le bouton « Mettre à jour ».
    const base = fakeEngine([{ Names: 'web', Image: nom, State: 'running' }]);
    useEngine(() => ({ ...base, images: () => [image(nom, empreinte(manifeste(1)))] }) as typeof base);
    const v = new Valhalla(home, [naglfar], { fetch, notify: async () => {}, autonomy: () => 'equilibre' } as never);
    try {
      const r = await v.act('naglfar', 'nouvelles_versions'); assert.match(r.text, /⬆ 1 image\(s\) avec une nouvelle version/); assert.match(r.text, /outils\/web:1\.0 \(web\) : nouvelle version disponible/);
      const a = v.alerts({ module: 'naglfar' }).find((x) => /Nouvelle version de .*outils\/web:1\.0/.test(x.title));
      assert.deepEqual(a?.fix, { module: 'naglfar', action: 'mettre_a_jour', label: 'Mettre à jour web', input: { conteneur: 'web' } });
      const vue = await naglfar.view(v.ctx('naglfar'), new URLSearchParams());
      const t = vue.sections.find((x) => x.kind === 'table' && x.title === 'Nouvelles versions') as Extract<(typeof vue.sections)[number], { kind: 'table' }>;
      assert.equal(t.rows[0].cells[2], 'nouvelle version'); assert.equal(t.rows[0].actions?.[0].action, 'mettre_a_jour');
      const n = demandes.length; await naglfar.watch!.run(v.ctx('naglfar')); assert.equal(demandes.length, n, 'pas de nouvelle question au registre avant 6 heures');
    } finally { v.stop(); }
  } finally { srv.close(); rmSync(home, { recursive: true, force: true }); }
});
