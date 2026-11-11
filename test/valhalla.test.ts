import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { connect } from 'node:net';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { encode, rsEncode } from '../src/valhalla/qr.ts';
import { MqttBroker, decLen, encLen, matches, packet } from '../src/valhalla/mqtt.ts';
import { Valhalla } from '../src/valhalla/service.ts';
import type { Module } from '../src/valhalla/types.ts';
import { allModules } from '../src/valhalla/odin.ts';
import { linkTemplates, LINKS, USAGES } from '../src/valhalla/links.ts';
import { McpClient, contentText, parseHttpReply, serverHandle, serverTools } from '../src/valhalla/mcp.ts';
import { advise } from '../src/tools/valhalla.ts';
import { freeSlots, book, frigg } from '../src/valhalla/modules/frigg.ts';
import { repoOf, match } from '../src/valhalla/modules/kvasir.ts';
import { espConfig } from '../src/valhalla/modules/brokkr.ts';
import { changed, inHours, masked } from '../src/valhalla/modules/himinbjorg.ts';
import { fromName, search } from '../src/valhalla/modules/aegir.ts';
import { failures, protectedIp } from '../src/valhalla/modules/garmr.ts';
import { parseList, inList } from '../src/valhalla/modules/geri.ts';
import { BASE_RULES, matchRules } from '../src/valhalla/modules/ullr.ts';
import { Repo, backup, restore, under, verify } from '../src/valhalla/modules/sindri.ts';
import { totp } from '../src/valhalla/modules/brisingamen.ts';
import { keypair } from '../src/valhalla/modules/gjoll.ts';
import { magicPacket } from '../src/valhalla/modules/hermod.ts';
import { memInfo } from '../src/valhalla/modules/eir.ts';
import { fromDiscovery } from '../src/valhalla/modules/appareils.ts';
import { sshdRisks } from '../src/valhalla/modules/forseti.ts';
import { judge, procs, psProcs } from '../src/valhalla/modules/skogul.ts';
import { execute } from '../src/draupnir/engine.ts';
import { CATALOG } from '../src/draupnir/nodes.ts';
import { Draupnir } from '../src/draupnir/service.ts';
import { checkFlow } from '../src/draupnir/engine.ts';
import { DEFAULT_CONFIG } from '../src/config.ts';

const home = () => mkdtempSync(join(tmpdir(), 'valhalla-'));
const fakeOdin = (h: string) => ({ paths: { home: h, workspace: join(h, 'ws') }, cfg: DEFAULT_CONFIG }) as never;

test('QR : Reed-Solomon et matrice (repères, taille par version)', () => {
  // Exemple classique (ISO 18004, annexe) : « 01234567 » version 1-M → 10 octets de correction.
  assert.deepEqual(rsEncode([32, 91, 11, 120, 209, 114, 220, 77, 67, 64, 236, 17, 236, 17, 236, 17], 10), [196, 35, 39, 119, 235, 215, 231, 226, 93, 23]);
  const m = encode('HELLO WORLD', 'M');
  assert.equal(m.length, 21);
  for (const [r, c] of [[0, 0], [0, 14], [14, 0]]) { assert.ok(m[r][c] && m[r + 6][c + 6] && m[r + 3][c + 3] && !m[r + 1][c + 1]); }
  assert.equal(encode('x'.repeat(200), 'M').length, 4 * 10 + 17);
});

test('MQTT : longueurs, jokers, publication retenue et abonnement d\'un vrai client TCP', async () => {
  assert.deepEqual([...encLen(321)], [0xc1, 0x02]); assert.deepEqual(decLen(Buffer.from([0, 0xc1, 0x02]), 1), { len: 321, used: 2 });
  assert.ok(matches('maison/+/temp', 'maison/salon/temp') && matches('maison/#', 'maison/a/b') && !matches('#', '$SYS/x') && !matches('a/+', 'a/b/c'));
  const b = new MqttBroker({ user: 'odin', pass: 'secret-123' });
  await b.listen(0, '127.0.0.1');
  const port = ((b as unknown as { srv: { address(): { port: number } } }).srv).address().port;
  const seen: string[] = []; b.on('capteurs/#', (m) => seen.push(`${m.topic}=${m.payload}`));
  b.publish('capteurs/salon', '21.5', { retain: true });
  const str = (s: string) => { const x = Buffer.from(s); const l = Buffer.alloc(2); l.writeUInt16BE(x.length); return Buffer.concat([l, x]); };
  const sock = connect(port, '127.0.0.1'); const got: Buffer[] = [];
  sock.on('data', (d) => got.push(d));
  await new Promise((r) => sock.once('connect', r));
  sock.write(packet(1, 0, Buffer.concat([str('MQTT'), Buffer.from([4, 0xc2, 0, 60]), str('test'), str('odin'), str('secret-123')])));
  sock.write(packet(8, 2, Buffer.concat([Buffer.from([0, 1]), str('capteurs/+'), Buffer.from([1])])));
  sock.write(packet(3, 0, Buffer.concat([str('capteurs/cuisine'), Buffer.from('19')])));
  await new Promise((r) => setTimeout(r, 200));
  const all = Buffer.concat(got);
  assert.equal(all[0], 0x20); assert.equal(all[3], 0, 'CONNACK accepté');
  assert.ok(all.includes(Buffer.from('capteurs/salon')) && all.includes(Buffer.from('21.5')), 'message retenu reçu à l\'abonnement');
  assert.ok(seen.includes('capteurs/cuisine=19'), 'Odin reçoit la publication du client');
  // Mauvais mot de passe → refus
  const bad = connect(port, '127.0.0.1'); const r2: Buffer[] = []; bad.on('data', (d) => r2.push(d)); await new Promise((r) => bad.once('connect', r));
  bad.write(packet(1, 0, Buffer.concat([str('MQTT'), Buffer.from([4, 0xc2, 0, 60]), str('x'), str('odin'), str('faux')])));
  await new Promise((r) => setTimeout(r, 150));
  assert.equal(Buffer.concat(r2)[3], 5);
  sock.destroy(); bad.destroy(); b.close();
});

test('Valhalla : registre complet, sans doublon, chaque appli décrite', () => {
  const mods = allModules(fakeOdin(home()));
  assert.ok(mods.length >= 25);
  assert.equal(new Set(mods.map((m) => m.id)).size, mods.length, 'identifiants uniques');
  assert.equal(new Set(mods.map((m) => m.name)).size, mods.length, 'noms uniques');
  for (const m of mods) {
    assert.ok(m.what && m.does.length && m.words.length && m.actions.length, `${m.id} décrit`);
    assert.equal(new Set(m.actions.map((a) => a.id)).size, m.actions.length, `${m.id} : actions uniques`);
  }
  // Chaque lien et chaque usage pointent vers des applis existantes.
  const ids = new Set(mods.map((m) => m.id));
  for (const l of LINKS) assert.ok(ids.has(l.from) && ids.has(l.to), `lien ${l.from}→${l.to}`);
  for (const u of USAGES) for (const c of u.chain) assert.ok(ids.has(c), `usage ${u.need} : ${c}`);
});

test('Valhalla : Odin choisit la bonne appli sans IA et explique', () => {
  const v = new Valhalla(home(), allModules(fakeOdin(home())));
  const top = (q: string) => v.find(q)[0]?.m.id;
  assert.equal(top('j\'ai besoin de sauvegarder mes photos chaque nuit'), 'sindri');
  assert.equal(top('montre la caméra du portail'), 'himinbjorg');
  assert.equal(top('prendre rendez-vous pour une coupe'), 'frigg');
  assert.equal(top('mes conteneurs docker'), 'naglfar');
  assert.equal(top('crée un accès vpn wireguard pour mon téléphone'), 'gjoll');
  assert.equal(top('analyse ce fichier avec l\'antivirus'), 'ullr');
  assert.equal(top('mets de la musique'), 'aegir');
  assert.equal(top('mes machines virtuelles proxmox'), 'ymir');
  assert.equal(top('mets un film sur la télé du salon'), 'freyja');
  assert.equal(top('branche un serveur mcp'), 'ratatoskr');
  const txt = advise(v, 'j\'ai besoin de protéger mon serveur contre les pirates');
  assert.match(txt, /➡ \*\*/); assert.match(txt, /Loki → Garmr|Garmr/);
});

test('Valhalla : alertes dédoublonnées, envoi selon le niveau, actions graves refusées en automatique', async () => {
  const sent: string[] = [];
  let ran = 0;
  const m: Module = { id: 'test', name: 'Testeur', family: 'Données', what: 'x', does: ['x'], from: [], upstream: [], words: ['test'], actions: [
    { id: 'lire', label: 'Lire', what: 'x', read: true, run: () => ({ text: 'ok' }) },
    { id: 'effacer', label: 'Effacer', what: 'x', grave: () => 'tout effacer', run: () => { ran++; return { text: 'effacé' }; } },
  ], view: () => ({ sections: [] }) };
  const v = new Valhalla(home(), [m], { notify: async (t) => { sent.push(t); } });
  v.alert('test', { level: 'info', title: 'petit' });
  v.alert('test', { level: 'critique', title: 'gros' });
  v.alert('test', { level: 'critique', title: 'gros' });
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(sent.length, 1); assert.match(sent[0], /🔴 Testeur — gros/);
  assert.equal(v.alerts().length, 2); assert.equal(v.alerts({ level: 'haute' })[0].count, 2);
  const r = await v.act('test', 'effacer', {}, { auto: true });
  assert.equal(r.ok, false); assert.equal(ran, 0);
  assert.equal((await v.act('test', 'effacer', {})).text, 'effacé');
  v.saveSettings({ alertLevel: 'info' }); v.alert('test', { level: 'info', title: 'maintenant envoyé' });
  await new Promise((r2) => setTimeout(r2, 10)); assert.equal(sent.length, 2);
});

test('Frigg : créneaux libres, réservation, conflit refusé, page publique', async () => {
  const day = '2030-03-04'; // un lundi
  const h = { 1: '9:00-10:00' };
  assert.deepEqual(freeSlots(day, 30, h, [], new Date('2030-01-01')), ['09:00', '09:15', '09:30']);
  const v = new Valhalla(home(), [frigg], { now: () => new Date('2030-01-01T10:00:00'), notify: async () => {} });
  const ctx = v.ctx('frigg'); ctx.saveSettings({ hours: h, services: [{ name: 'Coupe', minutes: 30, price: 15 }] });
  const b = book(ctx, { service: 'coupe', jour: day, heure: '9:00', nom: 'Ali', contact: '0639' }, true);
  assert.equal(b.status, 'attente'); assert.equal(b.end, `${day}T09:30`);
  assert.throws(() => book(ctx, { service: 'Coupe', jour: day, heure: '09:15', nom: 'B', contact: 'x' }), /plus libre/);
  assert.deepEqual(freeSlots(day, 30, h, ctx.settings.bookings as never, new Date('2030-01-01')), ['09:30']);
  const view = await frigg.view(ctx, new URLSearchParams()); assert.match(view.subtitle ?? '', /1 à confirmer/);
});

test('Kvasir : liens GitHub et rattachement aux applis sans IA', () => {
  assert.equal(repoOf('https://github.com/n8n-io/n8n/tree/master/packages'), 'n8n-io/n8n');
  assert.equal(repoOf('blakeblackshear/frigate'), 'blakeblackshear/frigate');
  assert.equal(repoOf('https://github.com/orgs/x'), undefined);
  const mods = allModules(fakeOdin(home()));
  assert.equal(match(mods, 'restic fast secure backup program snapshots')[0].id, 'sindri');
  assert.equal(match(mods, 'frigate nvr realtime object detection for ip cameras rtsp')[0].id, 'himinbjorg');
  assert.equal(match(mods, 'headscale open source wireguard vpn control server')[0].id, 'gjoll');
});

test('Modules : briques pures (ESP, caméra, musique, Garmr, Geri, Ullr, TOTP, WireGuard, Wake-on-LAN…)', () => {
  const y = espConfig('Salon capteur', ['température@GPIO4', 'relais@GPIO5'], { wifi: 'Maison', mqttHost: '192.168.1.2', mqttUser: 'odin' });
  assert.match(y, /name: salon-capteur/); assert.match(y, /platform: dht/); assert.match(y, /platform: gpio\n {4}pin: GPIO5/); assert.doesNotMatch(y, /password: [^!]/);
  assert.equal(changed(Buffer.alloc(100, 10), Buffer.concat([Buffer.alloc(50, 10), Buffer.alloc(50, 200)])), 0.5);
  assert.ok(inHours('22-6', new Date('2030-01-01T23:00:00')) && !inHours('22-6', new Date('2030-01-01T12:00:00')) && inHours('', new Date()));
  assert.equal(masked('rtsp://admin:pw@10.0.0.5/s'), 'rtsp://•••@10.0.0.5/s');
  assert.deepEqual(fromName('/m/03 - Daft Punk - One More Time.flac'), { artist: 'Daft Punk', title: 'One More Time' });
  assert.equal(search([{ file: 'a', title: 'One More Time', artist: 'Daft Punk', album: 'Discovery', sec: 0 }], 'daft time').length, 1);
  assert.deepEqual(failures('Nov 11 sshd[1]: Failed password for root from 203.0.113.9 port 22 ssh2').map((f) => f.ip), ['203.0.113.9']);
  assert.ok(protectedIp('192.168.1.4') && !protectedIp('203.0.113.9'));
  const l = parseList('# x\n203.0.113.0/24\n198.51.100.7\n'); assert.ok(inList('203.0.113.77', l) && inList('198.51.100.7', l) && !inList('8.8.8.8', l));
  assert.ok(matchRules('x.php', '<?php eval(base64_decode($_POST["c"])); ?>', BASE_RULES).length > 0);
  // TOTP : vecteur de la RFC 6238 (SHA-1, 8 chiffres, t = 59 s).
  assert.equal(totp('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', 59_000, 30, 8).code, '94287082');
  const k = keypair(); assert.equal(Buffer.from(k.pub, 'base64').length, 32); assert.equal(Buffer.from(k.priv, 'base64').length, 32);
  const mp = magicPacket('aa:bb:cc:dd:ee:ff'); assert.equal(mp.length, 102); assert.equal(mp.subarray(0, 6).toString('hex'), 'ffffffffffff');
  assert.deepEqual(memInfo('MemTotal: 1000 kB\nMemAvailable: 250 kB\n'), { total: 1024000, available: 256000 });
  const d = fromDiscovery('homeassistant/switch/prise1/config', JSON.stringify({ name: 'Prise', state_topic: 'p/state', command_topic: 'p/set' }));
  assert.equal(d?.kind ? true : false, true);
  assert.ok(sshdRisks('PermitRootLogin yes\nPasswordAuthentication yes').length >= 2);
  assert.ok(judge([{ pid: 9, ppid: 1, uid: 33, name: 'xmrig', exe: '/tmp/.x/xmrig', cmd: '/tmp/.x/xmrig -o pool' }]).length > 0);
  // Hors de Linux (pas de /proc) : la liste vient de « ps », et un chemin avec des espaces reste entier.
  const ps = psProcs((args) => (args[1] === 'pid=,args=' ? '  812 /Applications/Mon Appli.app/Contents/MacOS/appli --serveur\n 4242 /private/tmp/.x/xmrig -o pool\n' : '  812     1   501 /Applications/Mon Appli.app/Contents/MacOS/appli\n 4242   812   501 /private/tmp/.x/xmrig\nligne illisible\n'));
  assert.deepEqual(ps, [{ pid: 812, ppid: 1, uid: 501, name: 'appli', exe: '/Applications/Mon Appli.app/Contents/MacOS/appli', cmd: '/Applications/Mon Appli.app/Contents/MacOS/appli --serveur' }, { pid: 4242, ppid: 812, uid: 501, name: 'xmrig', exe: '/private/tmp/.x/xmrig', cmd: '/private/tmp/.x/xmrig -o pool' }]);
  assert.ok(judge(ps).some((f) => f.pid === 4242), 'un mineur est reconnu aussi par cette voie');
  assert.deepEqual(procs('/dossier/qui/n/existe/pas'), [], 'un dossier absent ne fait pas planter la page');
  assert.ok(Array.isArray(procs()), 'la liste des programmes se lit sur cette machine, quel que soit son système');
});

test('Sindri : sauvegarde chiffrée dédoublonnée, restauration et vérification', () => {
  const h = realpathSync(home()), src = join(h, 'src'); mkdirSync(join(src, 'sous'), { recursive: true });
  writeFileSync(join(src, 'a.txt'), 'bonjour '.repeat(5000)); writeFileSync(join(src, 'sous', 'b.bin'), Buffer.alloc(3 * 1024 * 1024, 7));
  const repo = new Repo(join(h, 'depot'), 'mot-de-passe-long');
  const s1 = backup(repo, { name: 'test', paths: [src] });
  const s2 = backup(repo, { name: 'test', paths: [src] });
  assert.equal(s1.files.length, 2); assert.equal(s2.added, 0, 'rien de neuf au 2e passage');
  assert.deepEqual(verify(repo, s1).bad, []);
  const out = join(h, 'restau'); assert.equal(restore(repo, s1, out), 2);
  const back = readFileSync(under(out, join(src, 'a.txt')), 'utf8'); assert.equal(back, 'bonjour '.repeat(5000));
  assert.equal(under('/cible', '/home/awa/x.txt'), join('/cible', 'home', 'awa', 'x.txt')); assert.equal(under('D:\\cible', 'C:\\Users\\awa\\x.txt'), join('D:\\cible', 'C\\Users\\awa\\x.txt'), 'une lettre de lecteur devient un dossier');
  assert.throws(() => new Repo(join(h, 'depot'), 'mauvais'), /mot/);
});

test('Draupnir ↔ applis : nœud « Action d\'une appli » et déclencheur « Quand une appli signale »', async () => {
  assert.ok(CATALOG.get('module.action') && CATALOG.get('déclencheur.module')?.trigger);
  const calls: unknown[] = [];
  const wf = { id: 'w', name: 'W', active: true, nodes: [{ name: 'Go', type: 'déclencheur.manuel', params: {} }, { name: 'Photo', type: 'module.action', params: { module: 'himinbjorg', action: 'photo', entrée: '{"camera":"{{ $json.c }}"}' } }], connections: { Go: [[{ node: 'Photo' }]] } };
  const ex = await execute(wf as never, CATALOG, { module: async (m, a, i) => { calls.push([m, a, i]); return { ok: true, text: 'fait' }; } }, { items: [{ json: { c: 'Portail' } }] });
  assert.equal(ex.status, 'succès'); assert.deepEqual(calls[0], ['himinbjorg', 'photo', { camera: 'Portail' }]);
  const refused = await execute(wf as never, CATALOG, { module: async () => ({ ok: false, text: 'action grave' }) }, { items: [{ json: { c: 'x' } }] });
  assert.equal(refused.status, 'erreur');
  // Modèles entre applis : tous valides.
  for (const t of linkTemplates()) assert.equal(checkFlow(t.flow as never, CATALOG), undefined, t.id);
  // Déclencheur
  const told: string[] = [];
  const d = new Draupnir(home(), { notify: async (t) => { told.push(t); } });
  d.save({ id: 'm', name: 'Mouvement', active: true, nodes: [{ name: 'Quand', type: 'déclencheur.module', params: { module: 'Himinbjörg', événement: 'mouvement' } }, { name: 'Dire', type: 'odin.prévenir', params: { texte: 'Mouvement {{ $json.caméra }}' } }] as never, connections: { Quand: [[{ node: 'Dire' }]] } });
  await d.onModule({ module: 'himinbjorg', name: 'Himinbjörg', type: 'autre', data: {} });
  await d.onModule({ module: 'himinbjorg', name: 'Himinbjörg', type: 'mouvement', data: { caméra: 'Portail' } });
  assert.deepEqual(told, ['Mouvement Portail']);
});

test('Ratatoskr : serveur MCP d\'Odin et client MCP (HTTP et stdio)', async () => {
  const m: Module = { id: 'meteo', name: 'Météo', family: 'Données', what: 'Le temps', does: ['x'], from: [], upstream: [], words: ['meteo'], actions: [
    { id: 'lire', label: 'Lire', what: 'temps', read: true, params: [{ key: 'ville', label: 'Ville', kind: 'text' }], run: (_c, i) => ({ text: `Beau à ${String(i.ville ?? 'Mamoudzou')}` }) },
    { id: 'tout_effacer', label: 'Effacer', what: 'x', grave: () => 'grave', run: () => ({ text: 'non' }) },
  ], view: () => ({ sections: [] }) };
  const v = new Valhalla(home(), [m]);
  const tools = serverTools(v); const t = tools.find((x) => x.name === 'odin_meteo')!;
  assert.deepEqual((t.inputSchema as { properties: { action: { enum: string[] } } }).properties.action.enum, ['lire'], 'pas d\'action grave en MCP');
  const call = await serverHandle(v, { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'odin_meteo', arguments: { action: 'lire', entree: { ville: 'Dzaoudzi' } } } }, () => '') as { result: unknown };
  assert.equal(contentText(call.result), 'Beau à Dzaoudzi');
  assert.equal(await serverHandle(v, { jsonrpc: '2.0', method: 'notifications/initialized' }, () => ''), undefined);
  // Client HTTP contre ce même serveur (réponse en SSE pour tester le décodage).
  const srv = createServer(async (req, res) => {
    let raw = ''; for await (const c of req) raw += c;
    const msg = JSON.parse(raw); const out = await serverHandle(v, msg, () => 'conseil');
    if (!out) { res.writeHead(202); res.end(); return; }
    res.writeHead(200, { 'content-type': 'text/event-stream', 'mcp-session-id': 's1' }); res.end(`event: message\ndata: ${JSON.stringify(out)}\n\n`);
  });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', () => r()));
  const port = (srv.address() as { port: number }).port;
  const c = new McpClient({ name: 'odin2', kind: 'http', url: `http://127.0.0.1:${port}/mcp`, enabled: true });
  const list = await c.connect(); assert.ok(list.some((x) => x.name === 'odin_meteo'));
  assert.equal(await c.call('odin_conseil', { besoin: 'x' }), 'conseil');
  srv.close();
  assert.deepEqual(parseHttpReply('application/json', '{"id":1,"result":{}}', 1), { id: 1, result: {} });
  // Client stdio : petit serveur MCP en Node.
  const dir = home(), script = join(dir, 'serveur.mjs');
  writeFileSync(script, `import readline from 'node:readline';const rl=readline.createInterface({input:process.stdin});const w=(o)=>process.stdout.write(JSON.stringify(o)+'\\n');rl.on('line',(l)=>{const m=JSON.parse(l);if(m.id===undefined)return;if(m.method==='initialize')w({jsonrpc:'2.0',id:m.id,result:{protocolVersion:m.params.protocolVersion,capabilities:{tools:{}},serverInfo:{name:'echo'}}});else if(m.method==='tools/list')w({jsonrpc:'2.0',id:m.id,result:{tools:[{name:'echo',description:'répète',inputSchema:{type:'object',properties:{t:{type:'string'}}}}]}});else if(m.method==='tools/call')w({jsonrpc:'2.0',id:m.id,result:{content:[{type:'text',text:'écho : '+m.params.arguments.t}]}});});`);
  const s = new McpClient({ name: 'echo', kind: 'stdio', command: process.execPath, args: [script], enabled: true });
  const st = await s.connect(); assert.equal(st[0].name, 'echo'); assert.equal(s.info?.name, 'echo');
  assert.equal(await s.call('echo', { t: 'salut' }), 'écho : salut');
  s.close();
});
