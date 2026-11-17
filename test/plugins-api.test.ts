// Plugins des compétences : la route /api/plugins/*, avec un vrai Valhalla (l'Interprète) et un faux serveur MCP local.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { odinPaths, type OdinConfig } from '../src/config.ts';
import { ToolRegistry } from '../src/tools/registry.ts';
import { Athena } from '../src/yggdrasil/skills.ts';
import type { Mnemosyne } from '../src/muninn/store.ts';
import { pluginsRoute, type DepsPluginsRoute } from '../src/web/plugins-api.ts';
import { oublierCaches } from '../src/plugins/sources.ts';
import { Valhalla } from '../src/valhalla/service.ts';
import { ratatoskr } from '../src/valhalla/modules/ratatoskr.ts';

const JETON = 'jeton-secret-123456';

/** Un Odin jetable réduit à ce que lit la route (dossier temporaire, fausse mémoire vide) : rien hors de tmpdir(). */
function makeOdin(_script: unknown[]) {
  const paths = odinPaths(mkdtempSync(join(tmpdir(), 'odin-plugins-api-')));
  const muninn = { kvPrefix: () => ({}), skillStats: () => [] } as unknown as Mnemosyne;
  return { paths, skills: new Athena(paths.skills, paths.drafts), muninn, tools: new ToolRegistry(), cfg: {} as OdinConfig, cleanup: () => rmSync(paths.home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }) };
}

/** Un faux serveur MCP HTTP : deux outils, « lire » (lecture) et « effacer » (destructif). */
async function fauxMcp(): Promise<{ url: string; arreter(): void }> {
  const srv = createServer(async (req, res) => {
    let raw = ''; for await (const c of req) raw += c;
    const m = JSON.parse(raw) as { id?: number; method: string; params?: { protocolVersion?: string } };
    if (m.id === undefined) { res.writeHead(202); res.end(); return; }
    const result = m.method === 'initialize' ? { protocolVersion: m.params?.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'faux' } }
      : m.method === 'tools/list' ? { tools: [{ name: 'lire', description: 'lit', inputSchema: { type: 'object' }, annotations: { readOnlyHint: true } }, { name: 'effacer', description: 'efface', inputSchema: { type: 'object' }, annotations: { destructiveHint: true } }] }
        : { content: [{ type: 'text', text: 'fait' }] };
    res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ jsonrpc: '2.0', id: m.id, result }));
  });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', () => r()));
  return { url: `http://127.0.0.1:${(srv.address() as { port: number }).port}/mcp`, arreter: () => { srv.closeAllConnections(); srv.close(); } };
}

/** Monte la route sur un petit serveur local ; rend un appel et la liste de toutes les réponses lues. */
async function monter(deps: DepsPluginsRoute): Promise<{ appel(m: string, chemin: string, corps?: unknown, entetes?: Record<string, string>): Promise<{ code: number; b: Record<string, unknown> }>; reponses: string[]; fermer(): void }> {
  const srv: Server = createServer(async (req, res) => { if (!(await pluginsRoute(req, res, new URL(req.url ?? '/', 'http://127.0.0.1'), deps))) { res.writeHead(418); res.end('{}'); } });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', () => r()));
  const base = `http://127.0.0.1:${(srv.address() as { port: number }).port}`, reponses: string[] = [];
  return {
    reponses,
    fermer: () => { srv.closeAllConnections(); srv.close(); },
    async appel(m, chemin, corps, entetes = { 'x-odin': '1' }) {
      const r = await fetch(base + chemin, { method: m, headers: { 'content-type': 'application/json', ...entetes }, body: corps === undefined ? undefined : typeof corps === 'string' ? corps : JSON.stringify(corps) });
      const t = await r.text(); reponses.push(t);
      assert.equal(r.headers.get('cache-control'), 'no-store'); assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
      return { code: r.status, b: JSON.parse(t) as Record<string, unknown> };
    },
  };
}

test('14-15. propriétaire seul, en-tête x-odin, corps borné, route inconnue', async () => {
  const odin = makeOdin([]); let fails = 0;
  const r = await monter({ proprietaire: () => false, odin, fail: () => { fails++; }, valhalla: () => undefined });
  try {
    for (const [m, c] of [['GET', '/api/plugins/etat'], ['POST', '/api/plugins/connecteur/ajouter']] as const) {
      const x = await r.appel(m, c, m === 'POST' ? { nom: 'X1', source: 'https://h.example.org' } : undefined);
      assert.equal(x.code, 401); assert.equal(x.b.error, 'Réservé au propriétaire d\'Odin.');
    }
    assert.equal(fails, 2, 'chaque refus compte un essai raté');
  } finally { r.fermer(); }
  const p = await monter({ proprietaire: () => true, odin, fail: () => { fails++; }, valhalla: () => undefined });
  try {
    assert.equal((await p.appel('POST', '/api/plugins/plugin', { nom: 'X1', skills: [], mcp: [] }, {})).code, 403);
    assert.equal((await p.appel('POST', '/api/plugins/plugin', 'x'.repeat(70 * 1024))).code, 413);
    assert.equal((await p.appel('POST', '/api/plugins/plugin', '[1]')).code, 400);
    assert.equal((await p.appel('POST', '/api/plugins/plugin', '{oups')).code, 400);
    assert.equal((await p.appel('GET', '/api/plugins/zz')).code, 404);
    assert.equal((await p.appel('POST', '/api/plugins/zz', {})).code, 404);
    assert.equal(fails, 2);
  } finally { p.fermer(); odin.cleanup(); }
});

test('16-19. connecteurs : confirmation, jeton au coffre jamais rendu, panne, débranchement', async () => {
  oublierCaches();
  const odin = makeOdin([]), v = new Valhalla(odin.paths.home, [ratatoskr(() => odin.tools)]), mcp = await fauxMcp();
  const r = await monter({ proprietaire: () => true, odin, fail: () => {}, valhalla: () => v });
  const cle = 'MCP_ESSAI';
  try {
    // 16. sans confirmation : 409, rien d'écrit
    let x = await r.appel('POST', '/api/plugins/connecteur/ajouter', { nom: 'Essai', source: mcp.url, jeton: JETON });
    assert.equal(x.code, 409); assert.match(String(x.b.confirmer), /127\.0\.0\.1/);
    assert.equal((v.ctx('ratatoskr').settings.servers as unknown[] | undefined)?.length ?? 0, 0);
    assert.equal(process.env[cle], undefined);
    // contrôles des entrées
    assert.equal((await r.appel('POST', '/api/plugins/connecteur/ajouter', { nom: 'É', source: mcp.url, confirme: true })).code, 400);
    assert.equal((await r.appel('POST', '/api/plugins/connecteur/ajouter', { nom: 'Local', source: 'node serveur.mjs', jeton: JETON, confirme: true })).code, 400);
    // 17. avec confirmation et jeton
    x = await r.appel('POST', '/api/plugins/connecteur/ajouter', { nom: 'Essai', source: mcp.url, jeton: JETON, confirme: true });
    assert.equal(x.code, 200, JSON.stringify(x.b)); assert.equal(x.b.ok, true);
    let e = await r.appel('GET', '/api/plugins/etat');
    let c = (e.b.connecteurs as Array<{ nom: string; etat: string; jeton?: boolean; adresse: string; outils: Array<{ nom: string; peutModifier: boolean }> }>).find((y) => y.nom === 'Essai')!;
    assert.equal(c.etat, 'relie'); assert.equal(c.outils.length, 2); assert.equal(c.jeton, true);
    assert.equal(c.outils.find((o) => o.nom === 'effacer')?.peutModifier, true);
    assert.equal(c.outils.find((o) => o.nom === 'lire')?.peutModifier, false);
    assert.equal((e.b.resume as { mcpDisponible: boolean }).mcpDisponible, true);
    assert.ok((e.b.noeuds as Array<{ id: string }>).some((n) => n.id === 'mcp:Essai'));
    // le jeton : réglé (vrai), puis effacé, puis remis ; jamais rendu
    x = await r.appel('POST', '/api/plugins/connecteur/jeton', { nom: 'Essai', jeton: '' }); assert.equal(x.b.jeton, false);
    x = await r.appel('POST', '/api/plugins/connecteur/jeton', { nom: 'Essai', jeton: JETON }); assert.equal(x.b.jeton, true);
    assert.equal((await r.appel('POST', '/api/plugins/connecteur/jeton', { nom: 'Inconnu', jeton: JETON })).code, 404);
    // 18. serveur arrêté : la reconnexion échoue, l'état le dit
    mcp.arreter();
    x = await r.appel('POST', '/api/plugins/connecteur/reconnecter', { nom: 'Essai' });
    assert.equal(x.code, 502);
    e = await r.appel('GET', '/api/plugins/etat');
    c = (e.b.connecteurs as typeof c[]).find((y) => y.nom === 'Essai')!;
    assert.equal(c.etat, 'panne'); assert.ok((c as { detail?: string }).detail);
    // 19. débrancher : confirmation, puis le connecteur disparaît
    assert.equal((await r.appel('POST', '/api/plugins/connecteur/retirer', { nom: 'Essai' })).code, 409);
    assert.equal((await r.appel('POST', '/api/plugins/connecteur/retirer', { nom: 'Fantôme', confirme: true })).code, 404);
    x = await r.appel('POST', '/api/plugins/connecteur/retirer', { nom: 'Essai', confirme: true }); assert.equal(x.code, 200);
    e = await r.appel('GET', '/api/plugins/etat');
    assert.equal((e.b.connecteurs as unknown[]).length, 0);
    // aucun secret dans les réponses, ni dans les fichiers des plugins
    for (const t of r.reponses) assert.equal(t.includes(JETON), false, `jeton rendu : ${t.slice(0, 120)}`);
    for (const f of ['plugins.json', 'constats.json']) { const p = join(odin.paths.home, 'competences', f); if (existsSync(p)) assert.equal(readFileSync(p, 'utf8').includes(JETON), false); }
  } finally {
    r.fermer(); mcp.arreter(); v.stop();
    delete process.env[cle]; rmSync(join(odin.paths.home, 'env'), { force: true });
    odin.cleanup();
  }
});

test('20. plugins et liens par la route', async () => {
  oublierCaches();
  const odin = makeOdin([]), v = new Valhalla(odin.paths.home, [ratatoskr(() => odin.tools)]);
  // un connecteur réglé (non relié) et deux compétences actives
  v.ctx('ratatoskr').saveSettings({ servers: [{ name: 'GitHub', kind: 'http', url: 'https://h.example.org/mcp', enabled: false }] });
  for (const n of ['revue-code', 'seule']) { odin.skills.propose({ name: n, description: `compétence ${n}`, body: 'étapes', reason: 'essai' }); odin.skills.approve(n); }
  const r = await monter({ proprietaire: () => true, odin, fail: () => {}, valhalla: () => v });
  try {
    let x = await r.appel('POST', '/api/plugins/plugin', { nom: 'Développement', skills: ['revue-code'], mcp: ['GitHub'] });
    assert.equal(x.code, 200); const id = (x.b.plugin as { id: string }).id; assert.equal(id, 'developpement');
    assert.equal((await r.appel('POST', '/api/plugins/plugin', { nom: 'Y1', skills: ['inconnue'], mcp: [] })).code, 400);
    assert.equal((await r.appel('POST', '/api/plugins/plugin', { id: 'zz', nom: 'Y1', skills: [], mcp: [] })).code, 404);
    assert.equal((await r.appel('POST', '/api/plugins/lien', { skill: 'seule', mcp: 'GitHub', relie: true })).code, 200);
    let e = await r.appel('GET', '/api/plugins/etat');
    const liens = e.b.liens as Array<{ a: string; b: string; provenances: string[] }>;
    assert.ok(liens.some((l) => l.a === `plugin:${id}` && l.b === 'skill:revue-code'));
    assert.ok(liens.some((l) => l.a === `plugin:${id}` && l.b === 'mcp:GitHub'));
    assert.ok(liens.some((l) => l.a === 'skill:seule' && l.b === 'mcp:GitHub' && l.provenances.includes('declare')));
    const c = (e.b.connecteurs as Array<{ nom: string; etat: string; adresse: string }>)[0];
    assert.equal(c.etat, 'a-relier'); assert.equal(c.adresse, 'https://h.example.org/mcp');
    assert.equal((await r.appel('POST', '/api/plugins/lien', { skill: 'seule', mcp: 'GitHub', relie: false })).code, 200);
    assert.equal((await r.appel('POST', '/api/plugins/plugin/supprimer', { id })).code, 200);
    assert.equal((await r.appel('POST', '/api/plugins/plugin/supprimer', { id })).code, 404);
    e = await r.appel('GET', '/api/plugins/etat');
    assert.equal((e.b.plugins as unknown[]).length, 0);
    assert.equal((e.b.liensDeclares as unknown[]).length, 0);
    assert.equal((e.b.noeuds as Array<{ id: string; seul: boolean }>).find((n) => n.id === 'skill:seule')?.seul, true);
  } finally { r.fermer(); v.stop(); odin.cleanup(); }
});

test('21. sans Valhalla : connecteurs illisibles, branchement impossible', async () => {
  oublierCaches();
  const odin = makeOdin([]);
  const r = await monter({ proprietaire: () => true, odin, fail: () => {}, valhalla: () => undefined });
  try {
    const e = await r.appel('GET', '/api/plugins/etat');
    assert.equal((e.b.resume as { mcpDisponible: boolean }).mcpDisponible, false);
    assert.deepEqual(e.b.connecteurs, []);
    assert.equal((e.b.noeuds as unknown[]).length, 3);
    assert.equal((await r.appel('POST', '/api/plugins/connecteur/ajouter', { nom: 'Essai', source: 'https://h.example.org/mcp', confirme: true })).code, 503);
  } finally { r.fermer(); odin.cleanup(); }
});

test('22. server.ts confie /api/plugins/ à la route, propriétaire seul', () => {
  const src = readFileSync(join(import.meta.dirname, '..', 'src', 'web', 'server.ts'), 'utf8');
  assert.equal(src.split('\n').filter((l) => l.includes('pluginsRoute(') && l.includes('!estMembre(req)')).length, 1);
  assert.match(src, /import \{ pluginsRoute \} from '\.\/plugins-api\.ts';/);
});
