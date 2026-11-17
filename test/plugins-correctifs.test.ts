// Plugins des compétences : les correctifs de la relecture (jeton, préfixes, trois états d'un outil, identifiants,
// constats, Soul, membres, programme introuvable). Odin jetable, faux serveurs MCP sur 127.0.0.1 : aucun vrai service.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { odinPaths, type OdinConfig } from '../src/config.ts';
import { ToolRegistry } from '../src/tools/registry.ts';
import { Athena } from '../src/yggdrasil/skills.ts';
import type { Mnemosyne } from '../src/muninn/store.ts';
import { pluginsRoute, type DepsPluginsRoute } from '../src/web/plugins-api.ts';
import { construireEtat, constatsVides, indexerNote, outilsDuConnecteur, panneLisible, recolter } from '../src/plugins/graphe.ts';
import { enregistrerPlugin, lirePlugins } from '../src/plugins/magasin.ts';
import { lireSoul, oublierCaches, sourceSoulCompetences } from '../src/plugins/sources.ts';
import type { Connecteur, SourcesEtat } from '../src/plugins/types.ts';
import { Valhalla } from '../src/valhalla/service.ts';
import { ratatoskr } from '../src/valhalla/modules/ratatoskr.ts';
import { McpClient } from '../src/valhalla/mcp.ts';

const JETON = 'jeton-de-A-tres-secret';

function makeOdin() {
  const paths = odinPaths(mkdtempSync(join(tmpdir(), 'odin-plugins-corr-')));
  const muninn = { kvPrefix: () => ({}), skillStats: () => [] } as unknown as Mnemosyne;
  const tools = new ToolRegistry();
  return { paths, skills: new Athena(paths.skills, paths.drafts), muninn, tools, cfg: {} as OdinConfig, cleanup: () => rmSync(paths.home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }) };
}

/** Un faux serveur MCP : il note l'en-tête Authorization de chaque requête et les outils appelés. */
async function fauxMcp(): Promise<{ url: string; auth: string[]; appels: string[]; arreter(): void }> {
  const auth: string[] = [], appels: string[] = [];
  const srv = createServer(async (req, res) => {
    let raw = ''; for await (const c of req) raw += c;
    auth.push(String(req.headers.authorization ?? ''));
    const m = JSON.parse(raw) as { id?: number; method: string; params?: { protocolVersion?: string; name?: string } };
    if (m.id === undefined) { res.writeHead(202); res.end(); return; }
    if (m.method === 'tools/call') appels.push(String(m.params?.name));
    const result = m.method === 'initialize' ? { protocolVersion: m.params?.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'faux' } }
      : m.method === 'tools/list' ? { tools: [
        { name: 'lire', description: 'lit', inputSchema: { type: 'object' }, annotations: { readOnlyHint: true, title: 'Lire un fichier' } },
        { name: 'effacer', description: 'efface', inputSchema: { type: 'object' }, annotations: { destructiveHint: true } },
        { name: 'faire', description: 'fait quelque chose', inputSchema: { type: 'object' } },
      ] }
        : { content: [{ type: 'text', text: 'fait' }] };
    res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ jsonrpc: '2.0', id: m.id, result }));
  });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', () => r()));
  return { url: `http://127.0.0.1:${(srv.address() as { port: number }).port}/mcp`, auth, appels, arreter: () => { srv.closeAllConnections(); srv.close(); } };
}

async function monter(deps: DepsPluginsRoute) {
  const srv = createServer(async (req, res) => { if (!(await pluginsRoute(req, res, new URL(req.url ?? '/', 'http://127.0.0.1'), deps))) { res.writeHead(418); res.end('{}'); } });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', () => r()));
  const base = `http://127.0.0.1:${(srv.address() as { port: number }).port}`, reponses: string[] = [];
  return {
    reponses,
    fermer: () => { srv.closeAllConnections(); srv.close(); },
    async appel(chemin: string, corps?: unknown): Promise<{ code: number; b: Record<string, unknown> }> {
      const r = await fetch(base + chemin, corps === undefined ? { headers: { 'x-odin': '1' } } : { method: 'POST', headers: { 'content-type': 'application/json', 'x-odin': '1' }, body: JSON.stringify(corps) });
      const t = await r.text(); reponses.push(t);
      return { code: r.status, b: JSON.parse(t) as Record<string, unknown> };
    },
  };
}
const nettoyerEnv = () => { for (const k of Object.keys(process.env)) if (/^MCP_(ESSAI|CAFE|AUTRE|MAJ)$/.test(k)) delete process.env[k]; };

test('G1. le jeton d\'un connecteur ne part jamais vers une autre adresse', async () => {
  oublierCaches(); nettoyerEnv();
  const odin = makeOdin(), v = new Valhalla(odin.paths.home, [ratatoskr(() => odin.tools)]);
  const A = await fauxMcp(), B = await fauxMcp();
  const r = await monter({ proprietaire: () => true, odin, fail: () => {}, valhalla: () => v });
  try {
    let x = await r.appel('/api/plugins/connecteur/ajouter', { nom: 'Essai', source: A.url, jeton: JETON, confirme: true });
    assert.equal(x.code, 200, JSON.stringify(x.b));
    assert.ok(A.auth.includes(`Bearer ${JETON}`), 'le serveur A reçoit bien le jeton');
    // un autre nom au même slug : refusé tant que « Essai » existe
    x = await r.appel('/api/plugins/connecteur/ajouter', { nom: 'ESSAI', source: B.url, confirme: true });
    assert.equal(x.code, 400); assert.match(String(x.b.error), /Essai/);
    // ré-ajout sous le même nom vers une autre adresse : la confirmation le dit, et l'ancien jeton est effacé
    x = await r.appel('/api/plugins/connecteur/ajouter', { nom: 'Essai', source: B.url });
    assert.equal(x.code, 409);
    assert.match(String(x.b.confirmer), /remplace le connecteur « Essai »/);
    assert.match(String(x.b.confirmer), /effacé du coffre/);
    x = await r.appel('/api/plugins/connecteur/ajouter', { nom: 'Essai', source: B.url, confirme: true });
    assert.equal(x.code, 200, JSON.stringify(x.b));
    assert.equal(process.env.MCP_ESSAI, undefined, 'l\'ancien jeton est effacé');
    assert.ok(B.auth.length > 0 && B.auth.every((h) => h === ''), `B ne reçoit aucun jeton : ${B.auth.join(',')}`);
    // même adresse : la confirmation dit que le jeton déjà au coffre sera envoyé
    x = await r.appel('/api/plugins/connecteur/jeton', { nom: 'Essai', jeton: 'jeton-B-123456' }); assert.equal(x.b.jeton, true);
    x = await r.appel('/api/plugins/connecteur/ajouter', { nom: 'Essai', source: B.url });
    assert.match(String(x.b.confirmer), /jeton déjà au coffre pour ce connecteur sera envoyé à http:\/\/127\.0\.0\.1/);
    // retrait : le jeton est effacé du coffre, et la confirmation le dit
    x = await r.appel('/api/plugins/connecteur/retirer', { nom: 'Essai' });
    assert.match(String(x.b.confirmer), /coupés tout de suite et son jeton est effacé/);
    x = await r.appel('/api/plugins/connecteur/retirer', { nom: 'Essai', confirme: true }); assert.equal(x.code, 200);
    assert.equal(process.env.MCP_ESSAI, undefined);
    // rebranché sous un nom au même slug, vers une autre adresse : aucun jeton ne part
    const avant = A.auth.length;
    x = await r.appel('/api/plugins/connecteur/ajouter', { nom: 'ESSAI', source: A.url, confirme: true }); assert.equal(x.code, 200);
    assert.ok(A.auth.slice(avant).every((h) => h === ''), 'aucun ancien jeton envoyé');
    for (const t of r.reponses) { assert.equal(t.includes(JETON), false); assert.equal(t.includes('jeton-B-123456'), false); }
  } finally { r.fermer(); A.arreter(); B.arreter(); v.stop(); nettoyerEnv(); odin.cleanup(); }
});

test('S1 + M2. débrancher coupe les outils tout de suite ; trois états d\'un outil', async () => {
  oublierCaches(); nettoyerEnv();
  const odin = makeOdin(), v = new Valhalla(odin.paths.home, [ratatoskr(() => odin.tools)]), A = await fauxMcp();
  const r = await monter({ proprietaire: () => true, odin, fail: () => {}, valhalla: () => v });
  try {
    assert.equal((await r.appel('/api/plugins/connecteur/ajouter', { nom: 'Essai', source: A.url, confirme: true })).code, 200);
    const e = await r.appel('/api/plugins/etat');
    const c = (e.b.connecteurs as Connecteur[]).find((y) => y.nom === 'Essai')!;
    const acces = Object.fromEntries(c.outils.map((o) => [o.nom, [o.acces, o.peutModifier]]));
    assert.deepEqual(acces, { effacer: ['modification', true], faire: ['non-declare', true], lire: ['lecture', false] });
    assert.equal(c.outils.find((o) => o.nom === 'lire')?.description, 'Lire un fichier — lit', 'le titre utile est gardé, le nom n\'est pas répété');
    assert.equal(c.outils.find((o) => o.nom === 'faire')?.description, 'fait quelque chose');
    // l'outil marche, puis le connecteur est débranché : l'outil refuse, sans rien envoyer au serveur
    assert.equal(await odin.tools.get('mcp_essai_lire')!.run({}, {} as never), 'fait');
    assert.equal((await r.appel('/api/plugins/connecteur/retirer', { nom: 'Essai', confirme: true })).code, 200);
    const n = A.appels.length;
    assert.match(String(await odin.tools.get('mcp_essai_lire')!.run({}, {} as never)), /débranché/);
    assert.equal(A.appels.length, n, 'rien n\'est parti vers le serveur');
    // rebranché : les vrais outils reviennent, les outils coupés ne sont jamais montrés
    assert.equal((await r.appel('/api/plugins/connecteur/ajouter', { nom: 'Essai', source: A.url, confirme: true })).code, 200);
    assert.equal(await odin.tools.get('mcp_essai_lire')!.run({}, {} as never), 'fait');
  } finally { r.fermer(); A.arreter(); v.stop(); nettoyerEnv(); odin.cleanup(); }
});

test('P-a, P-b, P-c. jeton en clair, schéma en majuscules, lien local, noms non latins', async () => {
  oublierCaches(); nettoyerEnv();
  const odin = makeOdin(), v = new Valhalla(odin.paths.home, [ratatoskr(() => odin.tools)]), A = await fauxMcp();
  const r = await monter({ proprietaire: () => true, odin, fail: () => {}, valhalla: () => v });
  try {
    let x = await r.appel('/api/plugins/connecteur/ajouter', { nom: 'Autre', source: 'http://h.example.org/mcp', jeton: 'jeton-123456', confirme: true });
    assert.equal(x.code, 400); assert.match(String(x.b.error), /chiffrée/); assert.equal(process.env.MCP_AUTRE, undefined);
    x = await r.appel('/api/plugins/connecteur/ajouter', { nom: 'Autre', source: 'https://169.254.169.254/latest', confirme: true });
    assert.equal(x.code, 400); assert.match(String(x.b.error), /lien local/);
    x = await r.appel('/api/plugins/connecteur/ajouter', { nom: 'Maj', source: A.url.replace('http://', 'HTTP://'), confirme: true });
    assert.equal(x.code, 200, JSON.stringify(x.b));
    const conf = (v.ctx('ratatoskr').settings.servers as Array<{ name: string; kind: string; url?: string }>).find((s) => s.name === 'Maj')!;
    assert.equal(conf.kind, 'http'); assert.ok(conf.url!.startsWith('http://127.0.0.1'));
    x = await r.appel('/api/plugins/connecteur/ajouter', { nom: 'Café', source: A.url, confirme: true });
    assert.equal(x.code, 200, JSON.stringify(x.b));
    x = await r.appel('/api/plugins/connecteur/ajouter', { nom: '日本の天気', source: A.url });
    assert.equal(x.code, 409, 'un nom non latin est accepté (confirmation demandée)');
  } finally { r.fermer(); A.arreter(); v.stop(); nettoyerEnv(); odin.cleanup(); }
});

test('P-g. un membre de la maison est refusé sans compter d\'essai raté', async () => {
  const odin = makeOdin(); let fails = 0;
  const r = await monter({ proprietaire: () => false, membre: () => true, odin, fail: () => { fails++; }, valhalla: () => undefined });
  try {
    for (let i = 0; i < 12; i++) assert.equal((await r.appel('/api/plugins/etat')).code, 403);
    assert.equal(fails, 0);
  } finally { r.fermer(); odin.cleanup(); }
});

const conn = (nom: string): Connecteur => ({ nom, sorte: 'http', adresse: 'https://h.example.org', etat: 'relie', jeton: false, outils: [] });
const src = (o: Partial<SourcesEtat>): SourcesEtat => ({ competences: [], brouillons: 0, stats: [], connecteurs: [], fichier: { version: 1, plugins: [], liens: [] }, abime: false, constats: constatsVides(), notes: [], soul: { etat: 'connu', extraitsCompetences: 0 }, ...o });

test('M1. un outil va au connecteur au préfixe le plus long (« git » et « git hub »)', () => {
  const outils = [{ name: 'mcp_git_hub_creer_issue', description: 'x' }, { name: 'mcp_git_log', description: 'y' }];
  const tous = ['git', 'git hub'];
  assert.deepEqual(outilsDuConnecteur('git', outils, { tous }).map((o) => o.nom), ['log']);
  assert.deepEqual(outilsDuConnecteur('git hub', outils, { tous }).map((o) => o.nom), ['creer_issue']);
  const e = construireEtat(src({ competences: [{ nom: 'tickets', description: '', body: 'appelle mcp_git_hub_creer_issue' }], connecteurs: [conn('git'), conn('git hub')], notes: [indexerNote('voir mcp_git_hub_creer_issue')] }));
  const liens = e.liens.map((l) => `${l.a}>${l.b}`).sort();
  assert.deepEqual(liens, ['brain>mcp:git hub', 'skill:tickets>mcp:git hub']);
});

test('P-d. [[courses]] vers une NOTE « courses » ne cite pas la compétence ; [[skill:courses]] si', () => {
  const competences = [{ nom: 'courses', description: '', body: '' }];
  let e = construireEtat(src({ competences, notes: [indexerNote('voir [[courses]]')], titresNotes: new Set(['courses']) }));
  assert.equal(e.liens.length, 0);
  e = construireEtat(src({ competences, notes: [indexerNote('voir [[skill:courses]]')], titresNotes: new Set(['courses']) }));
  assert.equal(e.liens.length, 1);
  e = construireEtat(src({ competences, notes: [indexerNote('voir [[courses]]')], titresNotes: new Set() }));
  assert.equal(e.liens.length, 1, 'sans note de ce nom, [[courses]] désigne la compétence');
});

test('M3. 101 plugins au même nom long : tous gardés, identifiants valides ; un plugin fautif n\'emporte pas les autres', () => {
  const h = mkdtempSync(join(tmpdir(), 'odin-plugins-corr-'));
  try {
    const nom = 'Un nom de plugin vraiment très très long pour voir';
    for (let i = 0; i < 101; i++) enregistrerPlugin(h, { nom, skills: [], mcp: [] }, { skills: new Set(), mcp: new Set() }, new Date());
    const r = lirePlugins(h);
    assert.equal(r.abime, false); assert.equal(r.fichier.plugins.length, 101);
    for (const p of r.fichier.plugins) assert.ok(p.id.length <= 41 && /^[a-z0-9][a-z0-9-]{1,40}$/.test(p.id), p.id);
    assert.equal(new Set(r.fichier.plugins.map((p) => p.id)).size, 101);
    assert.deepEqual(readdirSync(join(h, 'competences')).filter((f) => f.includes('abime')), []);
    // un plugin à l'identifiant hors règle : écarté seul, les autres restent ; l'original sera mis de côté
    const f = { version: 1, plugins: [{ id: 'bon', nom: 'Bon', description: '', skills: [], mcp: [] }, { id: 'X!', nom: 'Mauvais', description: '', skills: [], mcp: [] }], liens: [] };
    const h2 = join(h, 'deux'); mkdirSync(join(h2, 'competences'), { recursive: true }); writeFileSync(join(h2, 'competences', 'plugins.json'), JSON.stringify(f));
    const r2 = lirePlugins(h2);
    assert.deepEqual(r2.fichier.plugins.map((p) => p.id), ['bon']); assert.equal(r2.abime, true); assert.equal(r2.ecartes, 1);
    enregistrerPlugin(h2, { nom: 'Trois', skills: [], mcp: [] }, { skills: new Set(), mcp: new Set() }, new Date());
    assert.ok(readdirSync(join(h2, 'competences')).some((x) => x.startsWith('plugins.json.abime-')), 'l\'original est gardé de côté');
    assert.deepEqual(lirePlugins(h2).fichier.plugins.map((p) => p.id), ['bon', 'trois']);
  } finally { rmSync(h, { recursive: true, force: true }); }
});

test('M4. plus de 2 000 traces : le compte « vus ensemble » ne gonfle plus', () => {
  const traces: Record<string, string> = {};
  for (let i = 0; i < 2001; i++) traces[`s${i}`] = JSON.stringify({ at: 1000 + i, tools: [{ name: 'skill_read', input: { name: 'a' } }, { name: 'mcp_depot_lire', input: {} }] });
  let c = recolter(constatsVides(), traces, ['Depot']).constats;
  assert.equal(c.skillMcp['a|Depot'].n, 2001);
  for (let k = 0; k < 5; k++) { const r = recolter(c, traces, ['Depot']); assert.equal(r.change, false); c = r.constats; }
  assert.equal(c.skillMcp['a|Depot'].n, 2001);
  assert.equal(c.mcpTours.Depot, 2001);
  // une session qui a un nouveau tour compte une fois de plus, et seulement une
  traces.s5 = JSON.stringify({ at: 99999, tools: [{ name: 'skill_read', input: { name: 'a' } }, { name: 'mcp_depot_lire', input: {} }] });
  c = recolter(c, traces, ['Depot']).constats; c = recolter(c, traces, ['Depot']).constats;
  assert.equal(c.skillMcp['a|Depot'].n, 2002);
  assert.equal(c.vus.length, 2001, 'une clé par trace encore gardée');
});

test('M5. Soul : le compte lu dans un vrai corpus jetable', async () => {
  const h = mkdtempSync(join(tmpdir(), 'odin-plugins-soul-'));
  try {
    assert.equal(await sourceSoulCompetences(), 'odin-competences');
    const { Corpus } = await import('../src/brain/nous/corpus.ts');
    const { magasinDisque, scellageMachine, dossierCorpus } = await import('../src/brain/nous/file-odin.ts');
    const scel = scellageMachine(h); assert.ok(scel, 'clé de la machine du dossier jetable');
    new Corpus(magasinDisque(dossierCorpus(h)), scel).ajouter('20261117', 'odin:competences', [1, 2, 3].map((k) => ({ morceaux: Int32Array.from([k, k + 1, k + 2]), sorte: 'note' as const, fiable: true })));
    oublierCaches();
    const s = await lireSoul(h, Date.now());
    assert.deepEqual(s, { etat: 'connu', extraitsCompetences: 3 });
    const e = construireEtat(src({ soul: s }));
    assert.equal(e.noeuds.find((n) => n.id === 'soul')?.sous, '3 extrait(s) des compétences dans son corpus');
    assert.equal(construireEtat(src({})).noeuds.find((n) => n.id === 'soul')?.sous, 'aucun extrait des compétences dans son corpus');
  } finally { oublierCaches(); rmSync(h, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
});

test('P-f. une commande introuvable échoue tout de suite, sans tuer Odin', async () => {
  const c = new McpClient({ name: 'Nulle', kind: 'stdio', command: 'commande-introuvable-odin-essai', args: [], enabled: true });
  const t0 = Date.now();
  await assert.rejects(c.connect(), /programme impossible à lancer|arrêté/);
  assert.ok(Date.now() - t0 < 10_000, 'pas d\'attente du délai de 30 s');
  c.close();
});

test('P1, A4. états et pannes dits honnêtement', () => {
  const e = construireEtat(src({ connecteurs: [conn('Depot'), { ...conn('Eteint'), etat: 'panne', detail: panneLisible('fetch failed') }] }));
  assert.equal(e.noeuds.find((n) => n.id === 'mcp:Depot')?.sous, 'relié au dernier contact · 0 outil(s)');
  assert.equal(panneLisible('fetch failed'), 'serveur injoignable (fetch failed)');
  assert.equal(panneLisible('getaddrinfo ENOTFOUND h.example.org'), 'adresse introuvable (getaddrinfo ENOTFOUND h.example.org)');
  assert.equal(panneLisible('Depot : HTTP 500'), 'Depot : HTTP 500');
});
