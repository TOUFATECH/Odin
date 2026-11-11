// Ratatoskr contre de VRAIS serveurs MCP tiers : les serveurs officiels du protocole (fichiers,
// mémoire, référence « everything »), en programme local et par HTTP. Leurs outils deviennent des
// outils d'Odin ; les garde-fous sont vérifiés (accord pour lancer un programme, rien de l'environnement
// d'Odin ne fuit vers le serveur, outil destructeur signalé).

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ToolRegistry } from '../../../src/tools/registry.ts';
import { ratatoskr, toolName } from '../../../src/valhalla/modules/ratatoskr.ts';
import { freePort, TOOLS, until, type Scenario } from '../lib.ts';

const BIN = join(TOOLS, 'mcp', 'node_modules', '.bin');
const text = (r: unknown) => (typeof r === 'string' ? r : (r as { output: string }).output);

export const mcp: Scenario = {
  id: 'mcp', title: 'Ratatoskr ↔ serveurs MCP officiels', mode: 'réel',
  what: 'Les serveurs MCP de référence (fichiers, mémoire, « everything ») branchés en local et par HTTP : outils importés, appels réels, garde-fous.',
  async run(t) {
    if (!existsSync(join(BIN, 'mcp-server-everything'))) t.skip('serveurs MCP officiels absents : lance « npm run banc:outils »');
    const registry = new ToolRegistry();
    const mod = ratatoskr(() => registry);
    const { v } = t.valhalla([mod]);
    t.onEnd(() => mod.stop?.());
    const act = (a: string, i: Record<string, unknown> = {}, o = {}) => v.act('ratatoskr', a, i, o);
    const call = async (name: string, input: Record<string, unknown>) => text(await registry.get(name)!.run(input, {} as never));

    // 1. Serveur de fichiers (programme local), limité à un dossier.
    const dir = t.tmp('banc-mcp-');
    const auto = await act('ajouter', { nom: 'Fichiers', source: `${join(BIN, 'mcp-server-filesystem')} ${dir}` }, { auto: true });
    t.ok(auto.ok === false && /accord/.test(auto.text) && !registry.all().length, 'lancer un programme MCP est refusé sans ton accord (automatisation)', auto.text);
    const fs = await act('ajouter', { nom: 'Fichiers', source: `${join(BIN, 'mcp-server-filesystem')} ${dir}` });
    t.ok(fs.ok && /14 outil\(s\)/.test(fs.text), 'serveur de fichiers officiel branché : 14 outils reçus', fs.text);
    const w = registry.get(toolName('Fichiers', 'write_file')), r = registry.get(toolName('Fichiers', 'read_text_file'));
    t.ok(w && r && w.risk === 'external' && w.taints === true, 'ses outils sont devenus des outils d\'Odin (risque « extérieur », contenu non fiable)');
    t.ok(Boolean(w?.grave?.({})) && !r?.grave?.({}), 'l\'outil qui écrit est signalé « peut modifier » (accord demandé), la lecture non');
    await call(toolName('Fichiers', 'write_file'), { path: join(dir, 'note.txt'), content: 'écrit par Odin via MCP' });
    t.eq(existsSync(join(dir, 'note.txt')) ? readFileSync(join(dir, 'note.txt'), 'utf8') : '', 'écrit par Odin via MCP', 'écriture réelle d\'un fichier par l\'outil MCP');
    t.match(await call(toolName('Fichiers', 'read_text_file'), { path: join(dir, 'note.txt') }), /écrit par Odin via MCP/, 'lecture du fichier par l\'outil MCP');
    t.match(await call(toolName('Fichiers', 'read_text_file'), { path: '/etc/hostname' }), /^✗ .*(denied|outside|not allowed)/i, 'hors du dossier autorisé : le serveur refuse, Odin rapporte l\'erreur');

    // 2. Serveur de référence « everything » : rien de l'environnement d'Odin ne lui est donné.
    process.env.ODIN_BANC_SECRET = 'ne-doit-pas-fuiter'; process.env.MCP_BANC = 'donnee-autorisee';
    t.onEnd(() => { delete process.env.ODIN_BANC_SECRET; delete process.env.MCP_BANC; });
    const refused = await act('ajouter', { nom: 'Tout', source: join(BIN, 'mcp-server-everything'), variables: 'ODIN_BANC_SECRET' });
    t.ok(refused.ok === false && /MCP_/.test(refused.text), 'passer une variable du coffre qui n\'est pas « MCP_… » est refusé', refused.text);
    const all = await act('ajouter', { nom: 'Tout', source: join(BIN, 'mcp-server-everything'), variables: 'MCP_BANC' });
    t.ok(all.ok && /echo/.test(all.text), 'serveur de référence branché', all.text);
    t.match(await call(toolName('Tout', 'echo'), { message: 'bonjour de Mayotte' }), /bonjour de Mayotte/, 'appel d\'outil : « echo » répond');
    t.match(await call(toolName('Tout', 'get-sum'), { a: 19, b: 23 }), /42/, 'appel d\'outil avec des nombres : 19 + 23 = 42');
    const env = await call(toolName('Tout', 'get-env'), {});
    t.ok(!env.includes('ne-doit-pas-fuiter') && env.includes('donnee-autorisee'), 'le serveur ne voit pas l\'environnement d\'Odin (seulement la variable MCP_ autorisée)', env.slice(0, 200));
    t.ok(!/TOKEN|API_KEY|PASSWORD/.test(env.replace(/MCP_BANC/g, '')), 'aucun jeton ni clé d\'Odin dans l\'environnement du serveur');

    // 3. Serveur de mémoire : un outil destructeur est bien marqué.
    const mem = await act('ajouter', { nom: 'Mémoire', source: join(BIN, 'mcp-server-memory') });
    t.ok(mem.ok && Boolean(registry.get(toolName('Mémoire', 'delete_entities'))?.grave?.({})), 'serveur de mémoire branché ; « delete_entities » demandera ton accord', mem.text);

    // 4. Le même serveur de référence par HTTP (transport « Streamable HTTP », réponses en flux).
    const port = await freePort();
    const http = t.spawn(join(BIN, 'mcp-server-everything'), ['streamableHttp'], { env: { ...process.env, PORT: String(port) } });
    const up = await until(async () => { try { await fetch(`http://127.0.0.1:${port}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: '{}' }); return true; } catch { return false; } }, 15_000, 300);
    if (!up) t.ok(false, 'le serveur HTTP de référence démarre', http.log().slice(-300));
    else {
      const webAuto = await act('ajouter', { nom: 'Tout HTTP', source: `http://127.0.0.1:${port}/mcp` }, { auto: true });
      t.ok(webAuto.ok === false && /accord/.test(webAuto.text), 'brancher un serveur distant demande aussi ton accord (ses outils s\'ajoutent à ceux d\'Odin)', webAuto.text);
      const web = await act('ajouter', { nom: 'Tout HTTP', source: `http://127.0.0.1:${port}/mcp` });
      t.ok(web.ok && /echo/.test(web.text), 'serveur MCP distant branché par HTTP', web.text);
      t.match(await call(toolName('Tout HTTP', 'echo'), { message: 'par HTTP' }), /par HTTP/, 'appel d\'outil par HTTP');
    }

    const list = (await act('serveurs')).text;
    t.ok(/Fichiers/.test(list) && /Mémoire/.test(list) && /✓ 14 outil/.test(list), 'la liste des serveurs montre leur état', list);
    const view = await mod.view(v.ctx('ratatoskr'), new URLSearchParams());
    t.ok(view.kpis?.some((k) => k.label === 'Outils' && Number(k.value) >= 36), 'la page compte les outils disponibles', JSON.stringify(view.kpis));

    // 5. Panne : le serveur s'arrête → erreur claire, pas de blocage.
    await act('retirer', { nom: 'Mémoire' });
    const dead = await registry.get(toolName('Mémoire', 'read_graph'))!.run({}, {} as never).then(text, (e: Error) => `ERREUR ${e.message}`);
    t.match(dead, /ERREUR|arrêté|✗/, 'serveur débranché : l\'appel échoue proprement');
  },
};
