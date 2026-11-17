// Relecture du lot S, constats GRAVES 2 et 3 : le code sensible toujours validé (et le changement montré), et
// l'intégrité qui ne se défait plus par une commande.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Heimdall, type ApprovalRequest } from '../src/heimdall/policy.ts';
import { deciderPuisLancer } from '../src/heimdall/executer.ts';
import { ecrireReference, estSensible, figerReference, verifierNoyau, FICHIER_EMPREINTES, RACINE_APPLI } from '../src/heimdall/noyau.ts';
import { selfEdit } from '../src/tools/self.ts';
import { DEFAULT_CONFIG } from '../src/config.ts';

const dossiers: string[] = [];
after(() => { for (const d of dossiers) rmSync(d, { recursive: true, force: true }); });
const ctx = { workspace: tmpdir(), fullAccess: true, sessionId: 's', channel: 'web', peer: 'p', isTainted: () => false } as never;
function odin(validation = 'jamais') {
  const demandes: ApprovalRequest[] = [];
  const h = new Heimdall({ ...DEFAULT_CONFIG.policy, approvalTimeoutSec: 1 }, { approve: (r) => { demandes.push(r); return new Promise(() => { /* pas de réponse */ }); } });
  h.setAutonomy('breaker'); h.setValidationCode(() => validation);
  return { h, demandes };
}
const outil = (name: string, risk: 'exec' = 'exec') => ({ name, description: '', risk, schema: { type: 'object', properties: {} }, summarize: (i: Record<string, unknown>) => `${name} ${String(i.command ?? i.task ?? i.code ?? '')}`, async run() { throw new Error('ne doit pas tourner'); } }) as never;

test('constat 2 : avec « jamais », réécrire la boucle, la passerelle, le runtime ou un outil demande ta validation, et MONTRE le changement', async () => {
  for (const f of ['src/core/agent.ts', 'src/bifrost/gateway.ts', 'src/runtime.ts', 'src/tools/homeassistant.ts', 'src/config.ts', 'src/web/server.ts']) assert.ok(estSensible(f), f);
  assert.equal(estSensible('src/web/pages/nous.js'), false);
  const { h, demandes } = odin('jamais');
  const r = await deciderPuisLancer(h, selfEdit, { path: 'src/runtime.ts', old: '  heimdall.verifierIntegrite();', new: '' }, ctx, { sessionId: 's', tainted: false });
  assert.equal(r.decision.allowed, false); assert.equal(r.lancer, undefined);
  assert.match(demandes[0].reason, /code sensible d'Odin.*src[\\/]runtime\.ts/s);
  assert.match(demandes[0].reason, /Le changement :\n− {3}heimdall\.verifierIntegrite\(\);\n\+ /, 'les lignes retirées et ajoutées sont montrées');
  // ce qui n'est pas visé : une page de l'interface, « jamais », propriétaire → sans question
  const r2 = await deciderPuisLancer(h, selfEdit, { path: 'src/web/pages/__essai__.js', content: 'x' }, ctx, { sessionId: 's', tainted: false });
  assert.equal(r2.decision.allowed, true);
});

test('constat 3 : une commande qui refait la référence est refusée sans question ; une commande sur le dossier du code est validée (montrée)', async () => {
  const { h, demandes } = odin('jamais');
  const ref = await deciderPuisLancer(h, outil('shell'), { command: 'npm run noyau:empreintes' }, ctx, { sessionId: 's', tainted: false });
  assert.equal(ref.decision.allowed, false); assert.equal(demandes.length, 0);
  assert.match(String((ref.decision as { reason?: string }).reason), /jamais lancé par moi/);
  const ecrit = await deciderPuisLancer(h, outil('shell'), { command: `echo x >> ${join(RACINE_APPLI, 'src', 'heimdall', 'injection.ts')}` }, ctx, { sessionId: 's', tainted: false });
  assert.equal(ecrit.decision.allowed, false); assert.equal(demandes.length, 1); assert.match(demandes[0].reason, /commande système, montrée telle quelle :\n\(la commande entière, shell\)\necho x >>/);
  const codex = await deciderPuisLancer(h, outil('codex_run'), { task: 'améliore', dir: RACINE_APPLI }, ctx, { sessionId: 's', tainted: false });
  assert.equal(codex.decision.allowed, false); assert.equal(demandes.length, 2);
  const py = await deciderPuisLancer(h, outil('python_run'), { code: 'open("src/tools/x.ts","w").write("x")' }, ctx, { sessionId: 's', tainted: false });
  assert.equal(py.decision.allowed, false); assert.equal(demandes.length, 3);
  // ce qui n'est pas visé : une commande ordinaire dans l'espace de travail
  const ls = await deciderPuisLancer(h, { ...(outil('shell') as object), async run() { return 'ok'; } } as never, { command: 'ls -la' }, ctx, { sessionId: 's', tainted: false });
  assert.equal(ls.decision.allowed, true);
});

test('constat 3 : la référence figée au démarrage ; la refaire par une commande en service est un écart', () => {
  const racine = mkdtempSync(join(tmpdir(), 'ref-figee-')); dossiers.push(racine);
  mkdirSync(join(racine, 'src', 'heimdall'), { recursive: true });
  writeFileSync(join(racine, 'src', 'vault.ts'), 'coffre\n'); writeFileSync(join(racine, 'src', 'heimdall', 'policy.ts'), 'règles\n');
  ecrireReference(racine); figerReference(racine);
  assert.deepEqual(verifierNoyau(racine).ecarts, []);
  writeFileSync(join(racine, 'src', 'vault.ts'), 'coffre piégé\n');
  // la commande refait la référence pour « couvrir » le changement
  const fichiers = { 'src/heimdall/policy.ts': 'x', 'src/vault.ts': 'y' };
  writeFileSync(join(racine, FICHIER_EMPREINTES), JSON.stringify({ fichiers }));
  const v = verifierNoyau(racine);
  assert.ok(v.ecarts.some((e) => e.fichier === 'src/vault.ts'), 'le changement reste un écart (référence figée)');
  assert.ok(v.ecarts.some((e) => e.fichier === FICHIER_EMPREINTES), 'la référence refaite en service est un écart');
});
