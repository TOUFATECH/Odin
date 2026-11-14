// Les liens entre les applis d'Odin : chaque lien annoncé est automatique ET vérifié ici (on déclenche
// la première appli, on regarde ce que fait la seconde). Un lien ajouté à la liste sans sa vérification
// fait échouer le test : la liste ne peut pas promettre plus que le code.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { saveMachine } from '../src/machines/access.ts';
import test from 'node:test';
import { LINKS, USAGES, wireReflexes } from '../src/valhalla/links.ts';
import { parseTasmota, tasmotaDevices } from '../src/valhalla/modules/appareils.ts';
import { LokiEngine } from '../src/valhalla/modules/loki.ts';
import { santeText } from '../src/valhalla/modules/venus.ts';
import { allModules } from '../src/valhalla/odin.ts';
import { Valhalla } from '../src/valhalla/service.ts';
import { useEngine } from '../src/valhalla/modules/naglfar.ts';
import { rythme } from '../src/valhalla/modules/hlin.ts';
import { fakeEngine } from './helpers.ts';
import { attendreHel } from '../src/valhalla/modules/hel.ts';
import { gunzipSync } from 'node:zlib';
import { buildPacket, DhcpServer, MSG, parsePacket } from '../src/valhalla/vidarr/dhcp.ts';
import { fakeLivebox } from './fake-livebox.ts';
import { analyserFichier, magOf, nouvelAppareil, verifierAdresse } from '../src/valhalla/modules/pegase.ts';
const LIVEBOX = fakeLivebox();

const EICAR = 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';
const DOCKER = [{ ID: 'abc', Names: 'web', Image: 'nginx', State: 'exited', Status: 'Exited (137) 5 seconds ago', Ports: '', Labels: '' }].map((x) => JSON.stringify(x)).join('\n');
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(fn: () => unknown, ms = 3000): Promise<boolean> { const end = Date.now() + ms; for (;;) { if (await fn()) return true; if (Date.now() > end) return false; await wait(20); } }

interface World { v: Valhalla; home: string; ran: string[]; sent: string[]; fetched: Array<{ url: string; body?: string }>; acts: Array<{ module: string; action: string; ok: boolean; by: string }>; events: Array<{ module: string; type: string; data: Record<string, unknown> }>; level: (l: 'prudent' | 'equilibre' | 'autonome' | 'breaker') => void; end(): void }
function world(): World {
  const home = mkdtempSync(join(tmpdir(), 'odin-liens-')), ran: string[] = [], sent: string[] = [], fetched: World['fetched'] = [], acts: World['acts'] = [], events: World['events'] = [];
  const saved = { SINDRI_PASSWORD: process.env.SINDRI_PASSWORD, BRISINGAMEN_KEY: process.env.BRISINGAMEN_KEY, HA_TOKEN: process.env.HA_TOKEN, MQTT_PASSWORD: process.env.MQTT_PASSWORD };
  Object.assign(process.env, { SINDRI_PASSWORD: 'mot-de-passe-de-test', BRISINGAMEN_KEY: 'ab'.repeat(32), HA_TOKEN: 'jeton-ha-de-test', MQTT_PASSWORD: 'relais-de-test' });
  let lvl: 'prudent' | 'equilibre' | 'autonome' | 'breaker' = 'equilibre';
  const fakeFetch = (async (input: string | URL, init?: RequestInit) => {
    const url = String(input); fetched.push({ url, body: typeof init?.body === 'string' ? init.body : undefined });
    if (/^http:\/\/box\.test\//.test(url)) { const r = LIVEBOX.handle(url, init); if (r) return r; }
    if (/pirate\.exemple\/bot\.sh/.test(url)) return new Response(EICAR, { status: 200 });
    if (url === 'https://api.github.com/repos/odin-test/piege/releases/latest') return Response.json({ tag_name: 'v1.0', html_url: 'h', assets: [{ name: 'piege-1.0.exe', browser_download_url: 'https://github.com/odin-test/piege/releases/download/v1.0/piege-1.0.exe', size: EICAR.length }] });
    if (url === 'https://github.com/odin-test/piege/releases/download/v1.0/piege-1.0.exe') return new Response(EICAR, { status: 200 });
    if (/boot\.ipxe\.org|ipxe\/wimboot/.test(url)) return new Response(EICAR, { status: 200 });
    if (/firehol_level1|feodotracker/.test(url)) return new Response('203.0.113.66\n198.51.100.0/24\n', { status: 200 });
    if (/\/api\/states/.test(url)) return Response.json([{ entity_id: 'media_player.salon', state: 'idle', attributes: { friendly_name: 'Enceinte salon' } }, { entity_id: 'tts.demo', state: 'unknown', attributes: {} }]);
    if (/\/api\/services\//.test(url)) return Response.json([]);
    if (/\/cm\?cmnd=/.test(url)) return Response.json({ ok: true });
    // Une fausse API Cloudflare (Bifröst) : zones, DNS, règles et santé du tunnel.
    if (/^http:\/\/cf\.test\//.test(url)) {
      const u = new URL(url), m = init?.method ?? 'GET', ok = (result: unknown) => Response.json({ success: true, result });
      if (u.pathname === '/zones') return ok(u.searchParams.get('name') === 'exemple.fr' ? [{ id: 'z1', name: 'exemple.fr', account: { id: 'acc' } }] : []);
      if (u.pathname === '/zones/z1/dns_records') return ok(m === 'POST' ? { id: 'r1' } : []);
      if (/\/configurations$/.test(u.pathname)) return ok(m === 'PUT' ? {} : { config: { ingress: [] } });
      if (u.pathname === '/accounts/acc/cfd_tunnel/t1') return ok({ status: 'down', connections: [] });
    }
    throw new Error('réseau coupé par le test');
  }) as unknown as typeof fetch;
  useEngine(() => fakeEngine(String(DOCKER).split('\n').filter(Boolean).map((l) => JSON.parse(l)), (c) => { ran.push(c); }));
  const v = new Valhalla(home, allModules({ paths: { home, workspace: home }, cfg: { venus: { url: 'http://venus.test:8096' }, voice: {} } } as never), {
    run: async (cmd, args) => { ran.push(`${cmd} ${args.join(' ')}`); return { code: 0, out: /command -v/.test(args.join(' ')) ? '/usr/bin/x' : /^(docker|podman)$/.test(cmd) && args[0] === 'ps' ? DOCKER : cmd === 'ss' ? 'tcp   0 0 192.168.1.20:51000 203.0.113.66:4444 users:(("mineur",pid=4242,fd=3))\n' : '', err: '' }; },
    fetch: fakeFetch, notify: async (t) => { sent.push(t); }, autonomy: () => lvl,
  });
  v.events.on('action', (a: World['acts'][number]) => acts.push(a)); v.events.on('event', (e: World['events'][number]) => events.push(e));
  const unwire = wireReflexes(v, { retryMs: 30 });
  return { v, home, ran, sent, fetched, acts, events, level: (l) => { lvl = l; }, end: () => { unwire(); v.stop(); for (const [k, val] of Object.entries(saved)) { if (val === undefined) delete process.env[k]; else process.env[k] = val; } rmSync(home, { recursive: true, force: true }); } };
}
const did = (w: World, module: string, action: string) => w.acts.some((a) => a.module === module && a.action === action);
const skuldWatch = async (w: World) => { const m = w.v.module('skuld')!; await m.watch!.run(w.v.ctx('skuld')); };

/** Une vérification par lien : « de>vers ». */
const CHECKS: Record<string, (w: World) => Promise<void>> = {
  'loki>garmr': async (w) => {
    new LokiEngine(w.v.ctx('loki')).record({ trap: 'narfi', ip: '203.0.113.9', port: 22, kind: 'identifiants', detail: 'root / 123456' });
    assert.ok(await until(() => w.ran.some((c) => /^nft add element inet odin garmr4 \{ 203\.0\.113\.9 timeout 86400s \}/.test(c))), 'le pirate est banni 24 h au pare-feu');
    const m = w.v.manips()[0];
    assert.equal(m.by, 'réflexe'); assert.equal(m.undo?.action, 'debannir', 'manip annulable');
    w.ran.length = 0;
    new LokiEngine(w.v.ctx('loki')).record({ trap: 'narfi', ip: '192.168.1.50', port: 22, kind: 'identifiants', detail: 'root / 123456' }); await wait(60);
    assert.ok(!w.ran.some((c) => /192\.168\.1\.50/.test(c)), 'une adresse du réseau local n\'est jamais bannie');
  },
  'loki>ullr': async (w) => {
    await new LokiEngine(w.v.ctx('loki')).capture('narfi', '203.0.113.9', 'http://pirate.exemple/bot.sh');
    const a = w.v.alerts({ module: 'loki' }).find((x) => /capturé/.test(x.title));
    assert.match(a?.detail ?? '', /jamais exécuté[\s\S]*Asclépios : ⚠ Test antivirus EICAR/, 'le verdict d\'Asclépios part avec l\'alerte');
  },
  'geri>garmr': async (w) => {
    await w.v.module('geri')!.watch!.run(w.v.ctx('geri')); // les listes publiques sont chargées, puis les connexions en cours sont comparées
    assert.ok(w.v.alerts({ module: 'geri' }).some((a) => a.level === 'critique' && /mineur parle à une adresse malveillante/.test(a.title)));
    assert.ok(w.ran.some((c) => /^nft add element inet odin garmr4 \{ 203\.0\.113\.66 timeout 86400s \}/.test(c)), 'l\'adresse malveillante est bannie 24 h');
  },
  'skogul>ullr': async (w) => {
    w.v.ctx('skogul').emit('suspect', { règle: 'mineur', pid: process.pid, détail: 'test' });
    assert.ok(await until(() => did(w, 'ullr', 'fichier')), 'le programme du processus suspect est analysé par Asclépios');
    w.v.ctx('eir').emit('mesure', { cpu: 99, mem: 40, disque: 30 });
    assert.ok(await until(() => ((w.v.ctx('ullr').settings.incidents as Array<{ kind: string }> | undefined) ?? [])[0]?.kind === 'programme suspect'), 'et le signal rejoint les incidents');
  },
  'himinbjorg>midgard': async (w) => {
    w.v.ctx('midgard').saveSettings({ scenes: [{ name: 'Alerte intrusion', steps: [] }] });
    w.v.ctx('himinbjorg').emit('mouvement', { caméra: 'Entrée', part: 12, surveillé: true });
    assert.ok(await until(() => w.events.some((e) => e.module === 'midgard' && e.type === 'scene' && e.data['scène'] === 'Alerte intrusion')), 'la scène « Alerte intrusion » est lancée');
    w.events.length = 0;
    w.v.ctx('himinbjorg').emit('mouvement', { caméra: 'Entrée', part: 12, surveillé: false }); await wait(60);
    assert.ok(!w.events.some((e) => e.module === 'midgard'), 'hors des heures surveillées : rien');
  },
  'forseti>bragi': async (w) => {
    // Une fausse box domotique (protocole Home Assistant) : on y lit ce que Orphée demande de dire.
    const said: string[] = [];
    const ha = createServer((req, res) => { let b = ''; req.on('data', (c: Buffer) => { b += c; }); req.on('end', () => {
      if (req.url === '/api/states') { res.setHeader('content-type', 'application/json'); return void res.end(JSON.stringify([{ entity_id: 'media_player.salon', state: 'idle', attributes: { friendly_name: 'Enceinte salon' } }, { entity_id: 'tts.demo', state: 'unknown', attributes: {} }])); }
      if (/^\/api\/services\/tts\//.test(req.url ?? '')) said.push(b);
      res.setHeader('content-type', 'application/json'); res.end('[]');
    }); });
    await new Promise<void>((r) => ha.listen(0, '127.0.0.1', r));
    try {
      w.v.ctx('bragi').saveSettings({ horn: true, hornHours: '0-24', hornWhere: 'salon', haUrl: `http://127.0.0.1:${(ha.address() as { port: number }).port}` });
      w.v.alert('eir', { level: 'critique', title: 'Disque plein', key: 'k1' });
      assert.ok(await until(() => said.some((x) => /Alerte : Disque plein/.test(x) && /media_player\.salon/.test(x))), `l'alerte critique est dite sur l'enceinte du salon (${said.join(' | ').slice(0, 200)})`);
      const n = said.length; w.v.alert('eir', { level: 'haute', title: 'Mémoire haute', key: 'k2' }); await wait(80);
      assert.equal(said.length, n, 'une alerte non critique n\'est pas dite à voix haute');
    } finally { ha.close(); }
  },
  'appareils>midgard': async (w) => {
    // Port libre pris au hasard : un autre fichier de tests peut avoir son relais en marche au même moment
    w.v.ctx('appareils').saveSettings({ port: 0, devices: { l1: { id: 'l1', name: 'Lampe salon', kind: 'light', room: 'Salon', network: 'MQTT', state: 'ON', stateTopic: 'a/b', commandTopic: 'a/c' } } });
    await w.v.module('appareils')!.start?.(w.v.ctx('appareils'));
    try { assert.match((await w.v.act('midgard', 'maison')).text, /Salon : .*Lampe salon ON/, 'l\'appareil et son état sont dans le tableau de bord de la maison'); }
    finally { w.v.module('appareils')!.stop?.(); }
  },
  'brokkr>appareils': async (w) => {
    await w.v.act('brokkr', 'brancher', { ip: '192.168.1.60', odin: '192.168.1.20' });
    const cmd = decodeURIComponent(w.fetched.find((f) => /192\.168\.1\.60\/cm\?cmnd=/.test(f.url))?.url ?? '');
    assert.match(cmd, /Backlog MqttHost 192\.168\.1\.20; MqttPort 1883; MqttUser odin; MqttPassword relais-de-test; SetOption19 0/, 'le module reçoit l\'adresse et le mot de passe du relais d\'Odin');
    // Son annonce (format Tasmota) est comprise par Appareils.
    const d = tasmotaDevices(parseTasmota(JSON.stringify({ ip: '192.168.1.60', dn: 'Prise bureau', fn: ['Prise bureau'], hn: 'prise', mac: 'AABBCCDDEEFF', md: 'Sonoff', t: 'prise_bureau', ft: '%prefix%/%topic%/', tp: ['cmnd', 'stat', 'tele'], rl: [1], ofln: 'Offline', onln: 'Online', state: ['OFF', 'ON', 'TOGGLE', 'HOLD'] }))!);
    assert.equal(d[0]?.name, 'Prise bureau'); assert.equal(d[0]?.kind, 'prise');
  },
  'frigg>runes': async (w) => {
    await w.v.act('frigg', 'prestation', { nom: 'Coupe', minutes: 30 });
    await w.v.act('frigg', 'horaires', { horaires: ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'].map((d) => `${d} 08:00-18:00`).join('\n') });
    const day = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
    const r = await w.v.act('frigg', 'reserver', { service: 'Coupe', jour: day, heure: '10:00', nom: 'Ali Madi', contact: '0639123456' });
    assert.equal(r.ok, true, r.text);
    assert.ok(await until(() => did(w, 'runes', 'client')), 'la fiche client est créée par réflexe');
    assert.match((await w.v.act('saga', 'chercher', { q: 'Ali Madi' })).text, /Ali Madi/, 'la fiche est dans le Cerveau (base Clients)');
    await w.v.act('frigg', 'reserver', { service: 'Coupe', jour: day, heure: '11:00', nom: 'Ali Madi', contact: '0639123456' });
    assert.ok(await until(() => w.acts.filter((a) => a.module === 'runes' && a.action === 'client' && a.ok).length === 2), 'deuxième visite : la fiche est mise à jour, pas doublée');
  },
  'gjoll>brisingamen': async (w) => {
    const r = await w.v.act('gjoll', 'ajouter', { nom: 'Téléphone de Sara' });
    assert.match(r.text, /Sa configuration est rangée dans le coffre/, r.text);
    assert.match((await w.v.act('brisingamen', 'chercher', { q: 'VPN Téléphone' })).text, /VPN Téléphone de Sara/);
    assert.equal(JSON.stringify(w.v.manips({ limit: 50 })).includes('PrivateKey'), false, 'la clé privée n\'est jamais recopiée dans le journal des manips');
  },
  'bragi>freyja': async (w) => {
    const r = await w.v.act('bragi', 'ordre', { texte: 'mets Inception sur la télé' });
    assert.match(r.text, /🎙 « mets Inception sur la télé »\nVénus · /, r.text);
    assert.ok(did(w, 'freyja', 'regarder'), 'Vénus reçoit l\'ordre de lancer le titre');
    const g = await w.v.act('bragi', 'ordre', { texte: 'supprime le conteneur web' });
    assert.equal(g.ok, false); assert.match(g.text, /action grave/i, 'une action grave ne part jamais d\'un ordre à la voix');
    assert.ok(!w.ran.some((c) => /docker rm/.test(c)));
  },
  'midgard>freyja': async (w) => {
    await w.v.act('midgard', 'creer_scene', { nom: 'Film', etapes: 'freyja.regarder = Inception\nnaglfar.supprimer = web' });
    const r = await w.v.act('midgard', 'scene', { scene: 'Film' });
    assert.ok(did(w, 'freyja', 'regarder'), 'la scène lance le titre sur Vénus');
    assert.match(r.text, /✗ naglfar\.supprimer : action grave : elle ne part pas d'une scène/, 'une action grave ne part jamais d\'une scène');
    assert.ok(!w.ran.some((c) => /docker rm/.test(c)));
  },
  'kvasir>runes': async (w) => {
    await w.v.ctx('kvasir').call('runes', 'evolution', { titre: 'nocodb/nocodb 0.300.0', appli: 'Papyrus', lien: 'https://github.com/nocodb/nocodb/releases/tag/0.300.0', resume: 'Nouvelle vue calendrier.' });
    assert.match((await w.v.act('runes', 'bases')).text, /Évolutions/, 'la base « Évolutions » reçoit la fiche');
    assert.match((await w.v.act('saga', 'chercher', { q: 'nocodb 0.300.0' })).text, /nocodb/);
  },
  'sindri>ymir': async (w) => {
    const src = join(w.home, 'a-sauver'); mkdirSync(src, { recursive: true }); writeFileSync(join(src, 'note.txt'), 'bonjour');
    await w.v.act('sindri', 'creer', { nom: 'Serveur', dossiers: src, depot: join(w.home, 'depot') });
    assert.match((await w.v.act('sindri', 'machines', { plan: 'Serveur', vms: '101, 102' })).text, /instantané des machines 101, 102/);
    const r = await w.v.act('sindri', 'sauvegarder', { plan: 'Serveur' });
    assert.match(r.text, /💾 Serveur : 1 fichiers[\s\S]*Instantanés des machines virtuelles/, r.text);
    assert.equal(w.acts.filter((a) => a.module === 'ymir' && a.action === 'instantane').length, 2, 'Hydre est appelé pour chaque machine avant la sauvegarde');
  },
  // ---- Soins : ce qu'Odin répare tout seul
  'naglfar>urdr': async (w) => {
    const { envFor, needsDb } = await import('../src/valhalla/urdr/serveur.ts');
    const lancer = w.v.action('naglfar', 'lancer')!.a;
    assert.match(lancer.grave!({ image: 'n8nio/n8n:1.120' })!, /avec sa base dans la base de données d'Odin/, 'une appli qui a besoin d\'une base la reçoit d\'office');
    assert.doesNotMatch(lancer.grave!({ image: 'nginx' })!, /base/, 'les autres : pas de base');
    assert.doesNotMatch(lancer.grave!({ image: 'n8nio/n8n', base: 'aucune' })!, /base/, 'sauf si tu dis « aucune »');
    assert.ok(needsDb('vaultwarden/server') && w.v.action('ymir', 'installer_docker')!.a.params!.some((p) => p.key === 'base'), 'Hydre aussi');
    const env = envFor('n8nio/n8n', { host: 'odin-pg', ip: '10.89.0.250', port: 5432, database: 'app_n8n', user: 'app_n8n', password: 'x', url: 'postgresql://app_n8n:x@odin-pg:5432/app_n8n' });
    assert.equal(env.DB_TYPE, 'postgresdb'); assert.equal(env.DB_POSTGRESDB_HOST, 'odin-pg'); assert.ok(!Object.keys(env).some((k) => /SQLITE/i.test(k)), 'jamais de fichier SQLite');
  },
  'urdr>brisingamen': async (w) => {
    const r = await w.v.act('urdr', 'relier', { nom: 'Boutique', type: 'mysql', hote: '192.168.1.30', port: 3306, utilisateur: 'shop', mot_de_passe: 'secret-de-test', base: 'shop' });
    assert.match(r.text, /Mot de passe rangé dans le coffre/); assert.ok(did(w, 'brisingamen', 'ajouter'), 'coffre appelé');
    assert.doesNotMatch(JSON.stringify(await w.v.act('urdr', 'bases')), /secret-de-test/, 'jamais affiché');
  },
  'urdr>skuld': async (w) => {
    // Une base hébergée par Odin (fausse base en mémoire, fausse archive pg_dump) : zéro SQLite.
    const { saveBases, useOpener } = await import('../src/valhalla/urdr/bases.ts'); const { useTools } = await import('../src/valhalla/modules/skuld.ts'); const { FakeDriver } = await import('./fake-driver.ts');
    saveBases(w.home, [{ id: 'notes', nom: 'Notes', type: 'postgres', utilisateur: 'app_notes', base: 'app_notes', conteneur: 'odin-pg', ajoutee: new Date().toISOString() }]);
    const d = new FakeDriver({ n: { columns: [{ name: 'id', type: 'int8', nullable: false, pk: true }, { name: 't', type: 'text', nullable: true, pk: false }], rows: [{ id: '1', t: 'a' }, { id: '2', t: 'b' }] } });
    useOpener(() => d); useTools(() => ({ has: async () => false, inContainer: async () => ({ cmd: 'sh', args: ['-c', 'printf PGDMP-archive-de-test'], env: {} }) }));
    try {
      const r = await w.v.act('urdr', 'sql', { base: 'notes', requete: "delete from n where t = 'a'" });
      assert.match(r.text, /sauvegarde faite juste avant/); assert.equal(readdirSync(join(w.home, 'valhalla', 'skuld', 'archives', 'notes')).length, 1);
      assert.deepEqual(d.sqls.at(-1), { text: "delete from n where t = 'a'", write: true });
    } finally { useOpener(undefined); useTools(); }
  },
  'skuld>forseti': async (w) => {
    await w.v.act('urdr', 'relier', { nom: 'Compta', type: 'mysql', hote: '127.0.0.1', port: 3306, utilisateur: 'c', base: 'compta' });
    await w.v.act('skuld', 'plan', { base: 'compta', toutes: 'heure' });
    await skuldWatch(w);
    assert.ok(w.v.alerts({ module: 'skuld' }).some((a) => /Sauvegarde de Compta ratée/.test(a.title) && a.fix?.action === 'sauvegarder'), 'alerte avec « Réessayer »');
  },
  'svalinn>brisingamen': async (w) => {
    const r = await w.v.act('svalinn', 'relier_box', { adresse: 'box.test', marque: 'livebox', utilisateur: 'admin', mot_de_passe: 'mot-de-passe-box' });
    assert.match(r.text, /mot de passe rangé dans le coffre/); assert.ok(did(w, 'brisingamen', 'ajouter'), 'coffre appelé');
    assert.match((await w.v.act('brisingamen', 'chercher', { q: 'Box internet' })).text, /Box internet \(Zéphyr\)/);
  },
  'svalinn>forseti': async (w) => {
    await w.v.act('svalinn', 'relier_box', { adresse: 'box.test', marque: 'livebox', utilisateur: 'admin', mot_de_passe: 'mot-de-passe-box' });
    await w.v.act('svalinn', 'etat');
    assert.ok(w.v.alerts({ module: 'svalinn' }).some((a) => /Wi-Fi : WPS activé/.test(a.title)), 'alerte dans le fil commun');
  },
  'rodd>bragi': async (w) => {
    await w.v.act('rodd', 'ajouter_mot', { mot: 'Hringhorni', entendus: 'ring horni, ringorni' });
    const { applyMots, mots } = await import('../src/voice/mots.ts');
    assert.equal(applyMots('démarre ring horni et le reste', mots(w.home)), 'démarre Hringhorni et le reste', 'la voix d\'Odin lit les mêmes mots');
    const r = await w.v.act('rodd', 'dicter', { texte: 'lance ringorni', mode: 'tel quel' }); assert.equal(r.text, 'lance Hringhorni');
  },
  'volva>bragi': async () => {
    // Une vraie voix pour cet essai : un faux serveur Piper (protocole actuel, POST /synthesize) qui rend un petit WAV.
    const wav = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WAVEfmt '), Buffer.alloc(40)]), dit: string[] = [];
    const srv = createServer((req, res) => { let b = ''; req.on('data', (d) => { b += d; }); req.on('end', () => { if (req.method === 'POST' && req.url === '/synthesize') { dit.push((JSON.parse(b) as { text: string }).text); res.end(wav); } else { res.writeHead(404); res.end(); } }); });
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
    const home = mkdtempSync(join(tmpdir(), 'odin-liens-voix-')), { DEFAULT_CONFIG } = await import('../src/config.ts');
    const voice = { ...DEFAULT_CONFIG.voice, localOnly: false, gender: 'femme', tts: { ...DEFAULT_CONFIG.voice.tts, provider: 'piper', baseUrl: `http://127.0.0.1:${(srv.address() as { port: number }).port}` } };
    const v = new Valhalla(home, allModules({ paths: { home, workspace: home }, cfg: { venus: { url: '' }, voice, profiles: DEFAULT_CONFIG.profiles } } as never), {}), faits: string[] = [];
    v.events.on('action', (a: { module: string; action: string }) => faits.push(`${a.module}.${a.action}`));
    try {
      const vide = await v.act('volva', 'ecouter', {}); assert.equal(vide.ok, false); assert.match(vide.text, /aucune recherche à lire/);
      writeFileSync(join(v.ctx('volva').dir, 'historique.json'), JSON.stringify([{ id: 'abc123', at: 1, q: 'Quel est le chef-lieu de Mayotte ?', focus: 'tout', answer: '**Mamoudzou** est le chef-lieu de Mayotte [1].', sources: [], engines: [], followups: [], apps: [], ai: false, errors: [] }]));
      const r = await v.act('volva', 'ecouter', {});
      assert.equal(r.ok, true, r.text); assert.ok(faits.includes('bragi.dire'), 'c\'est Orphée qui lit');
      assert.deepEqual(dit, ['Mamoudzou est le chef-lieu de Mayotte.'], 'la réponse est dite sans ses renvois ni ses étoiles');
      const son = v.module('volva')!.retrait!(v.ctx('volva'), r.fichiers![0].ref)!;
      assert.match(son, /bragi[\\/]audio[\\/]odin-\d+\.wav$/); assert.deepEqual(readFileSync(son), wav, 'le son d\'Orphée est remis par la page de Pythie');
      assert.equal(v.module('volva')!.retrait!(v.ctx('volva'), '../réglages.json'), undefined, 'rien d\'autre ne sort par là');
      const u = (await v.order('lis la dernière recherche')).understood as { kind: string; module?: string; action?: string } | undefined;
      assert.deepEqual([u?.kind, u?.module, u?.action], ['action', 'volva', 'ecouter'], '« lis la dernière recherche » arrive chez Pythie, sans IA');
    } finally { v.stop(); await new Promise((r) => srv.close(r)); rmSync(home, { recursive: true, force: true }); }
  },
  'naglfar>naglfar': async (w) => {
    w.level('prudent');
    w.v.ctx('naglfar').emit('conteneur_arrete', { conteneur: 'api' }); await wait(60);
    assert.ok(!w.ran.some((c) => /odin start api/.test(c)), 'niveau « Me demander » : Odin ne touche à rien');
    assert.ok(w.v.alerts({ module: 'naglfar' }).some((a) => /Je peux réparer : démarre le conteneur api/.test(a.title)), 'il propose seulement');
    w.level('equilibre');
    w.v.ctx('naglfar').emit('conteneur_arrete', { conteneur: 'web' });
    assert.ok(await until(() => w.ran.some((c) => /^odin start web/.test(c))), 'le conteneur arrêté tout seul est relancé');
    const m = w.v.manips()[0];
    assert.equal(m.by, 'odin'); assert.equal(m.state, 'à décider'); assert.match(m.why ?? '', /s'est arrêté tout seul/);
    assert.match(w.sent.at(-1) ?? '', new RegExp(`Manip faite de moi-même : Argo · Démarrer.*« garde ${m.id} » ou « annule ${m.id} »`));
    const n = w.ran.filter((c) => /odin start web/.test(c)).length;
    w.v.ctx('naglfar').emit('conteneur_arrete', { conteneur: 'web' }); await wait(60);
    assert.equal(w.ran.filter((c) => /odin start web/.test(c)).length, n, 'pas de boucle : une relance par heure au plus');
    assert.match((await w.v.decide(m.id, false)).text, /↩ Annulé : Argo · Démarrer \(conteneur arrêté\)/);
    assert.ok(w.ran.some((c) => /^odin stop web/.test(c)), '« annule » : le conteneur est arrêté de nouveau');
  },
  'ymir>ymir': async (w) => {
    w.v.ctx('ymir').emit('vm_arretee', { vmid: 101, nom: 'serveur-web' });
    assert.ok(await until(() => did(w, 'ymir', 'demarrer')), 'la machine virtuelle arrêtée toute seule est relancée');
  },
  'sindri>sindri': async (w) => {
    w.v.ctx('sindri').emit('sauvegarde_echec', { plan: 'Serveur', erreur: 'disque absent' });
    assert.ok(await until(() => did(w, 'sindri', 'sauvegarder')), 'la sauvegarde échouée est relancée une fois');
    const n = w.acts.filter((a) => a.module === 'sindri' && a.action === 'sauvegarder').length;
    w.v.ctx('sindri').emit('sauvegarde_echec', { plan: 'Serveur', erreur: 'disque absent' }); await wait(120);
    assert.equal(w.acts.filter((a) => a.module === 'sindri' && a.action === 'sauvegarder').length, n, 'une seule relance : pas de boucle');
  },
};
/**
 * Liens vers Asclépios : le signal de chaque appli rejoint les incidents. Seul, il ne dit rien ; recoupé avec
 * celui d'une autre appli, il ouvre un incident où l'appli est citée.
 */
/** Sphinx démarré pour l'essai : une liste « menaces » écrite à la main (pas de réseau), sur un port libre. */
async function dnsUp(w: World): Promise<number> {
  const dir = join(w.v.ctx('vidarr').dir, 'listes'); mkdirSync(dir, { recursive: true }); writeFileSync(join(dir, 'menaces.txt'), '0.0.0.0 c2.virus.example\n');
  w.v.ctx('vidarr').saveSettings({ lists: [{ id: 'menaces', name: 'Sites dangereux', url: 'https://exemple.invalid/l.txt', kind: 'menace', enabled: true }], dns: { upstreams: ['udp://127.0.0.1:9'], fallback: [], rateLimit: 5 } });
  const r = await w.v.act('vidarr', 'demarrer', { port: 0 }); assert.match(r.text, /répond sur le port/, r.text);
  return Number(/port (\d+)/.exec(r.text)![1]);
}
async function dnsAsk(port: number, name: string): Promise<void> {
  const { query } = await import('../src/valhalla/vidarr/wire.ts'); const dgram = await import('node:dgram');
  await new Promise<void>((ok) => { const c = dgram.createSocket('udp4'); const t = setTimeout(() => { c.close(); ok(); }, 300); c.on('message', () => { clearTimeout(t); c.close(); ok(); }); c.send(query(name, 1), port, '127.0.0.1'); });
}
CHECKS['gjoll>vidarr'] = async (w) => {
  const r = await w.v.act('gjoll', 'ajouter', { nom: 'Téléphone de Sara', dns_odin: true });
  assert.match(r.text, /Il passe par le DNS d'Odin \(Sphinx\)/, r.text);
  const clients = (w.v.ctx('vidarr').settings.dns as { clients: Array<{ name: string; ids: string[] }> }).clients;
  assert.deepEqual(clients.map((c) => [c.name, c.ids]), [['VPN · Téléphone de Sara', ['10.8.0.2']]]);
};
CHECKS['vidarr>forseti'] = async (w) => {
  const port = await dnsUp(w);
  try {
    await dnsAsk(port, 'c2.virus.example');
    assert.ok(await until(() => w.v.alerts({ module: 'vidarr' }).some((a) => /a voulu joindre un site dangereux/.test(a.title) && a.level === 'haute')), 'alerte haute dans le fil commun');
    await Promise.all(Array.from({ length: 12 }, (_x, i) => dnsAsk(port, `n${i}.exemple.fr`)));
    assert.ok(await until(() => w.v.alerts({ module: 'vidarr' }).some((a) => /inonde le DNS/.test(a.title))), 'machine qui inonde : signalée');
    // Internet coupé (le serveur amont de l'essai ne répond jamais) : la surveillance le voit dans les réponses.
    await wait(1200);
    for (let i = 0; i < 12; i++) await dnsAsk(port, `p${i}.exemple.fr`);
    await wait(2500); await w.v.module('vidarr')!.watch!.run(w.v.ctx('vidarr'));
    assert.ok(w.v.alerts({ module: 'vidarr' }).some((a) => /n'arrive plus à joindre Internet/.test(a.title) && a.level === 'haute'), 'panne d\'Internet signalée');
  } finally { await w.v.act('vidarr', 'arreter'); }
};
CHECKS['vidarr>saga'] = async (w) => {
  // Le journal d'hier (écrit à la main) : au passage de la surveillance, son résumé part dans le Cerveau.
  const d = new Date(Date.now() - 86400_000), day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const dir = join(w.v.ctx('vidarr').dir, 'journal'); mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${day}.jsonl`), [{ t: d.getTime(), client: '192.168.1.30', clientName: 'Tablette', name: 'pub.exemple', type: 'A', status: 'bloqué', list: 'Pubs', ms: 1, rcode: 'NOERROR' }, { t: d.getTime() + 1, client: '192.168.1.30', name: 'exemple.fr', type: 'A', status: 'ok', ms: 3, rcode: 'NOERROR' }].map((x) => JSON.stringify(x)).join('\n') + '\n');
  await w.v.module('vidarr')!.watch!.run(w.v.ctx('vidarr'));
  assert.ok(await until(() => did(w, 'saga', 'noter')), 'note du jour dans Thot');
  assert.ok(existsSync(join(w.v.ctx('vidarr').dir, 'historique', day.slice(0, 4), day.slice(5, 7), `${day.slice(8)}.json`)), 'résumé du jour gardé dans l\'historique');
  const h = await w.v.act('vidarr', 'historique', { periode: 'jour', date: day });
  assert.match(h.text, /2 requêtes, 1 bloquées[\s\S]*Tablette \(192\.168\.1\.30\)/);
};
CHECKS['vidarr>ran'] = async (w) => {
  w.v.ctx('vidarr').saveSettings({ leases: [{ mac: '02:aa:bb:cc:dd:01', ip: '192.168.1.40', name: 'PC', expires: Date.now() + 3600_000 }] });
  const view = await w.v.module('vidarr')!.view(w.v.ctx('vidarr'), new URLSearchParams());
  const g = view.sections.find((x) => x.kind === 'graph') as { details: Record<string, { actions?: Array<{ module?: string; action: string; input: Record<string, unknown> }> }> };
  const a = g.details['p:192.168.1.40'].actions!.find((x) => x.module === 'ran');
  assert.deepEqual([a?.action, a?.input], ['lire', { ip: '192.168.1.40' }], 'la fiche du poste ouvre ses paquets dans Ariane');
};
const sondes = (w: World) => (w.v.ctx('vordr').settings.monitors as Array<{ name: string; kind: string; target: string; source?: string }> | undefined) ?? [];
CHECKS['vidarr>vordr'] = async (w) => {
  // Tant que tu n'as pas allumé le DNS d'Odin, Pulsar ne le surveille pas (pas de fausse panne).
  await w.v.act('vordr', 'liens');
  assert.ok(!sondes(w).some((m) => m.target === 'vidarr'), 'DNS jamais allumé : pas de sonde');
  w.v.ctx('vidarr').saveSettings({ on: true });
  await w.v.act('vordr', 'liens');
  assert.ok(sondes(w).some((m) => m.kind === 'odin' && m.target === 'vidarr' && m.source === 'Sphinx'));
  assert.match((await w.v.act('vordr', 'verifier', { nom: 'DNS d\'Odin' })).text, /❌ DNS d'Odin : le DNS d'Odin est arrêté/);
  await dnsUp(w);
  try { assert.match((await w.v.act('vordr', 'verifier', { nom: 'DNS d\'Odin' })).text, /✅ DNS d'Odin : DNS d'Odin en marche/); } finally { await w.v.act('vidarr', 'arreter'); }
};
CHECKS['gjoll>vordr'] = async (w) => {
  await w.v.act('vordr', 'liens');
  assert.ok(!sondes(w).some((m) => m.target === 'gjoll'), 'VPN jamais allumé : pas de sonde');
  w.v.ctx('gjoll').saveSettings({ on: true });
  await w.v.act('vordr', 'liens');
  assert.ok(sondes(w).some((m) => m.kind === 'odin' && m.target === 'gjoll' && m.source === 'Vortex'));
  assert.match((await w.v.act('vordr', 'verifier', { nom: 'VPN d\'Odin' })).text, /❌ VPN d'Odin : le tunnel VPN est éteint/);
};
// Les postes du parc (le coffre des machines) sont proposés par les applis qui savent lire un autre poste.
const parc = (w: World) => { saveMachine(w.home, { label: 'serveur-essai', host: '192.168.1.5', user: 'root', via: 'ssh' }); saveMachine(w.home, { label: 'PC-ESSAI', host: '192.168.1.20', user: 'Fatima', password: 'x', via: 'smb' }); };
/** « Sur quel poste ? » en haut de la page : la machine d'Odin, puis les postes du parc que l'appli sait lire. */
const propose = async (w: World, id: string) => {
  const avant = await w.v.module(id)!.view(w.v.ctx(id), new URLSearchParams());
  assert.deepEqual(avant.postes?.choix.map((c) => c.nom), ['Cette machine'], 'sans poste dans le parc, seule la machine d\'Odin est proposée');
  assert.equal(avant.postes?.ajouter, true, 'la page propose d\'ajouter un poste');
  parc(w);
  const v = await w.v.module(id)!.view(w.v.ctx(id), new URLSearchParams());
  assert.deepEqual(v.postes?.choix.map((c) => c.nom), ['Cette machine', 'serveur-essai'], 'le poste Linux du parc est proposé ; le PC Windows ne l\'est pas (cette appli lit par SSH)');
  assert.equal(v.postes?.actuel, '', 'sans choix, la page montre la machine d\'Odin');
  assert.ok(![...v.sections, ...(v.side ?? [])].some((x) => x.kind === 'form' && /autre poste/.test(x.title ?? '')), 'plus de formulaire « autre poste » dans la page : le choix se fait en haut, une fois');
};
CHECKS['hermod>ullr'] = async (w) => {
  parc(w);
  const v = await w.v.module('ullr')!.view(w.v.ctx('ullr'), new URLSearchParams());
  assert.deepEqual(v.postes?.choix.map((c) => `${c.nom}${c.sys ? ` (${c.sys})` : ''}`), ['Cette machine', 'serveur-essai', 'PC-ESSAI (Windows)'], 'Windows et Linux : l\'antivirus sait lire les deux');
  assert.equal(v.postes?.ensuite?.action, 'analyser_poste', 'après l\'ajout d\'un poste : « Quoi analyser ? », puis l\'analyse');
  // Un poste choisi : sa carte propose l'analyse rapide et l'analyse complète de ce poste.
  const pc = v.postes!.choix.find((c) => c.nom === 'PC-ESSAI')!, sur = await w.v.module('ullr')!.view(w.v.ctx('ullr'), new URLSearchParams({ poste: pc.id }));
  const carte = sur.sections.find((x) => x.kind === 'actions' && x.title === 'PC-ESSAI') as { boutons: Array<{ action: string; input?: Record<string, unknown> }> } | undefined;
  assert.deepEqual(carte?.boutons.map((b) => `${b.action}:${String(b.input?.quoi)}`), ['analyser_poste:rapide', 'analyser_poste:tout']); assert.equal(sur.postes?.actuel, pc.id);
};
CHECKS['hermod>eir'] = (w) => propose(w, 'eir');
CHECKS['hermod>fensalir'] = (w) => propose(w, 'fensalir');
CHECKS['hermod>hlid'] = (w) => propose(w, 'hlid');
CHECKS['hermod>mimisbrunnr'] = (w) => propose(w, 'mimisbrunnr');
CHECKS['hermod>skogul'] = (w) => propose(w, 'skogul');
CHECKS['heidrun>vidarr'] = async (w) => {
  const r = await w.v.act('heidrun', 'profil', { nom: 'Sami', age: 'enfant', appareils: '192.168.1.77' });
  assert.equal(r.ok, true, r.text);
  const regle = ((w.v.ctx('vidarr').settings.dns as { clients: Array<{ name: string; ids: string[]; parental?: boolean; safeSearch?: boolean; services?: string[]; cut?: boolean }> }).clients).find((c) => c.name === 'Héra · Sami');
  assert.ok(regle, 'Sphinx a reçu la règle de l\'enfant'); assert.deepEqual(regle!.ids, ['192.168.1.77']);
  assert.ok(regle!.parental && regle!.safeSearch && regle!.services!.includes('tiktok') && regle!.cut, 'filtrage, recherche sécurisée, réseaux sociaux coupés, coucher');
  assert.ok(!w.v.manips({ limit: 20 }).some((m) => m.module === 'vidarr'), 'pas de « manip » en double : c\'est toi qui as demandé le profil');
};
// Ulysse (trajets) : une position reçue par Hestia n'est gardée que si le membre a allumé son historique ; elle ne passe
// ni par le journal des actions, ni par les événements, ni par une alerte.
const membreNour = async (w: World) => { await w.v.act('gladsheim', 'membre', { nom: 'Nour' }); return (w.v.ctx('gladsheim').settings.members as Array<{ id: string; name: string; user: string; hash: string; tid: string; at: number }>)[0]; };
CHECKS['gladsheim>gna'] = async (w) => {
  const { recordFix } = await import('../src/valhalla/modules/gladsheim.ts'), { compter } = await import('../src/valhalla/gna/historique.ts');
  const nour = await membreNour(w), g = w.v.ctx('gladsheim'), dir = w.v.ctx('gna').dir;
  const envoi = (lat: number, lon: number) => recordFix(g, nour, { _type: 'location', lat, lon, acc: 10, tst: Math.floor(Date.now() / 1000) });
  envoi(-12.7806, 45.2278);
  assert.ok(!existsSync(join(dir, 'positions')), 'historique éteint : rien n\'est gardé');
  assert.match((await w.v.act('gna', 'allumer', { membre: 'Nour', accord: true })).text, /Historique de Nour allumé/);
  w.acts.length = 0;
  envoi(-12.7806, 45.2278); envoi(-12.7851, 45.2301);
  assert.equal(compter(dir, nour.id), 2, 'historique allumé : chaque position reçue est gardée');
  assert.deepEqual(w.acts, [], 'aucune action lancée : la position ne laisse pas de trace dans le journal des applis');
  assert.doesNotMatch(JSON.stringify([w.v.manips({ limit: 50 }), w.events, w.v.alerts(), w.sent]), /12\.78|45\.2[23]/, 'aucune coordonnée dans les manips, les événements, les alertes ou les messages');
  await w.v.act('gna', 'pause', { membre: 'Nour' }); envoi(-12.79, 45.24);
  assert.equal(compter(dir, nour.id), 2, 'en pause : plus rien n\'est gardé');
  await w.v.act('gladsheim', 'retirer_membre', { nom: 'Nour' });
  assert.ok(!existsSync(join(dir, 'positions', nour.id)), 'membre retiré de Hestia : son historique est effacé');
};
CHECKS['gna>forseti'] = async (w) => {
  const { recordFix } = await import('../src/valhalla/modules/gladsheim.ts');
  const nour = await membreNour(w), dir = w.v.ctx('gna').dir;
  await w.v.act('gna', 'allumer', { membre: 'Nour', accord: true });
  // Le dossier des positions ne peut plus être écrit (ici : un fichier a pris la place du dossier du membre).
  mkdirSync(join(dir, 'positions'), { recursive: true }); writeFileSync(join(dir, 'positions', nour.id), 'pas un dossier');
  recordFix(w.v.ctx('gladsheim'), nour, { _type: 'location', lat: -12.7806, lon: 45.2278, tst: Math.floor(Date.now() / 1000) });
  await w.v.module('gna')!.watch!.run(w.v.ctx('gna'));
  const a = w.v.alerts({ module: 'gna' })[0];
  assert.ok(a && a.level === 'haute' && /l'historique n'est plus gardé comme prévu/.test(a.title), 'alerte haute dans le fil commun');
  assert.doesNotMatch(JSON.stringify(a), /12\.78|45\.22/, 'aucune position dans l\'alerte');
  assert.match((await w.v.act('forseti', 'alertes', { gravite: 'info' })).text, /Trajets : l'historique n'est plus gardé comme prévu/, 'visible dans Forseti');
};
CHECKS['mimisbrunnr>forseti'] = async (w) => {
  const log = join(w.home, 'boutique.log'), il_y_a = (s: number) => new Date(Date.now() - s * 1000).toISOString();
  writeFileSync(log, [il_y_a(40), il_y_a(20)].map((d) => `${d} caisse ERREUR-CAISSE-77 tiroir bloqué`).join('\n') + '\n');
  w.v.ctx('mimisbrunnr').saveSettings({ journald: false });
  await w.v.act('mimisbrunnr', 'fichier', { chemin: log });
  await w.v.act('mimisbrunnr', 'regle', { motif: 'ERREUR-CAISSE-77', fois: 2, minutes: 5, niveau: 'haute' });
  await w.v.module('mimisbrunnr')!.watch!.run(w.v.ctx('mimisbrunnr'));
  const a = w.v.alerts({ module: 'mimisbrunnr' }).find((x) => /ERREUR-CAISSE-77/.test(x.title));
  assert.ok(a, 'la règle déclenche une alerte dans le fil commun'); assert.equal(a!.level, 'haute'); assert.match(a!.title, /2 fois en 5 min/);
};
CHECKS['freyja>vordr'] = async (w) => {
  await w.v.act('vordr', 'liens');
  assert.ok(sondes(w).some((m) => m.name === 'Venus' && m.kind === 'http' && m.target === 'http://venus.test:8096/api/health' && m.source === 'Vénus'), JSON.stringify(sondes(w)));
  assert.match((await w.v.act('vordr', 'liens')).text, /Rien de nouveau/, 'pas de doublon');
};
CHECKS['idunn>vordr'] = async (w) => {
  w.v.ctx('idunn').saveSettings({ sites: [{ name: 'boutique', url: 'https://boutique.exemple', pages: ['/'] }] });
  await w.v.act('vordr', 'liens');
  assert.ok(sondes(w).some((m) => m.name === 'Site boutique' && m.target === 'https://boutique.exemple' && m.source === 'Iðunn'), JSON.stringify(sondes(w)));
  assert.match((await w.v.act('vordr', 'liens')).text, /Rien de nouveau/, 'pas de doublon');
};
CHECKS['vordr>forseti'] = async (w) => {
  const net = await import('node:net');
  const probe = net.createServer(); await new Promise<void>((ok) => probe.listen(0, '127.0.0.1', () => ok())); const port = (probe.address() as { port: number }).port; probe.close(); await wait(30);
  await w.v.act('vordr', 'ajouter', { nom: 'NAS', genre: 'tcp', cible: `127.0.0.1:${port}`, essais: 1, secondes: 60 });
  assert.ok(w.v.alerts({ module: 'vordr' }).some((a) => /❌ NAS est en panne/.test(a.title) && a.level === 'haute'), 'panne signalée');
  const srv = net.createServer((c) => c.end()); await new Promise<void>((ok) => srv.listen(port, '127.0.0.1', () => ok()));
  try {
    await w.v.act('vordr', 'verifier', { nom: 'NAS' });
    assert.ok(w.v.alerts({ module: 'vordr' }).some((a) => /✅ NAS répond de nouveau/.test(a.title)), 'retour signalé');
  } finally { srv.close(); }
};
CHECKS['vidarr>askr'] = async (w) => {
  // Un bail du DHCP d'Odin (posé à la main) : l'inventaire crée la fiche, fabricant compris.
  w.v.ctx('vidarr').saveSettings({ leases: [{ mac: 'b8:27:eb:12:34:56', ip: '192.168.1.60', name: 'Lecteur salon', expires: Date.now() + 3600_000, first: Date.now() }] });
  await dnsUp(w); await w.v.act('vidarr', 'arreter');
  const r = await w.v.act('askr', 'synchroniser');
  assert.match(r.text, /1 appareil\(s\) ajouté\(s\) : Lecteur salon \(ODN-0001\)/, r.text);
  assert.match((await w.v.act('askr', 'chercher', { q: '192.168.1.60' })).text, /ODN-0001 · Lecteur salon/);
};
CHECKS['askr>vordr'] = async (w) => {
  await w.v.act('askr', 'ajouter', { nom: 'NAS', type: 'serveur', ip: '192.168.1.10', piece: 'Bureau' });
  const r = await w.v.act('askr', 'surveiller', { appareil: 'NAS' });
  assert.match(r.text, /NAS surveillé \(ping 192\.168\.1\.10/, r.text);
  assert.ok(sondes(w).some((m) => m.name === 'NAS' && m.kind === 'ping'));
};
CHECKS['askr>brisingamen'] = async (w) => {
  const r = await w.v.act('askr', 'licence', { nom: 'Office 2024', postes: 3, cle: 'ABCDE-12345-FGHIJ' });
  assert.match(r.text, /clé rangée dans le coffre/, r.text);
  assert.ok(did(w, 'brisingamen', 'ajouter'), 'la clé est partie dans le coffre');
  assert.doesNotMatch(JSON.stringify(w.v.ctx('askr').settings), /ABCDE-12345/, 'jamais en clair dans l\'inventaire');
};
CHECKS['askr>forseti'] = async (w) => {
  const soon = new Date(Date.now() + 5 * 86400_000).toISOString().slice(0, 10);
  await w.v.act('askr', 'ajouter', { nom: 'PC portable', type: 'portable', garantie: soon, serie: 'SN123' });
  await w.v.module('askr')!.watch!.run(w.v.ctx('askr'));
  assert.ok(w.v.alerts({ module: 'askr' }).some((a) => /Garantie de PC portable : plus que [45] jour/.test(a.title) && a.level === 'haute'));
};
/** Le proxy Valgrind démarré pour l'essai (ports au hasard) et un service de la maison factice. */
async function proxyUp(w: World): Promise<{ port: number; svc: import('node:http').Server; svcUrl: string; end: () => void }> {
  const http = await import('node:http');
  const svc = http.createServer((_q, r) => { r.writeHead(200); r.end('ok'); }); await new Promise<void>((ok) => svc.listen(0, '127.0.0.1', () => ok()));
  w.v.ctx('valgrind').saveSettings({ lanIp: '192.168.1.2' });
  const r = await w.v.act('valgrind', 'demarrer', { http: 0, https: 0 }); assert.match(r.text, /Proxy en marche/, r.text);
  const port = Number(/HTTP sur le port (\d+)/.exec(r.text)![1]);
  return { port, svc, svcUrl: `http://127.0.0.1:${(svc.address() as { port: number }).port}`, end: () => { svc.close(); svc.closeAllConnections(); void w.v.act('valgrind', 'arreter'); } };
}
const httpGet = async (port: number, host: string, headers: Record<string, string> = {}) => { const http = await import('node:http'); return new Promise<number>((ok, ko) => { const q = http.request({ host: '127.0.0.1', port, path: '/', headers: { host, ...headers, connection: 'close' } }, (r) => { r.resume(); r.on('end', () => ok(r.statusCode!)); }); q.on('error', ko); q.end(); }); };
CHECKS['valgrind>vidarr'] = async (w) => {
  const p = await proxyUp(w);
  try {
    const r = await w.v.act('valgrind', 'ajouter', { domaines: 'photos.maison', cible: p.svcUrl, https: 'aucun', surveiller: false });
    assert.match(r.text, /À la maison, photos\.maison mène directement à Odin \(192\.168\.1\.2\)/, r.text);
    assert.deepEqual((w.v.ctx('vidarr').settings.dns as { rewrites: Record<string, string[]> }).rewrites['photos.maison'], ['192.168.1.2']);
  } finally { p.end(); }
};
CHECKS['valgrind>vordr'] = async (w) => {
  const p = await proxyUp(w);
  try { await w.v.act('valgrind', 'ajouter', { domaines: 'nas.maison', cible: p.svcUrl, https: 'aucun', dns_maison: false }); assert.ok(sondes(w).some((m) => m.name === 'Service nas.maison' && m.target === p.svcUrl)); }
  finally { p.end(); }
};
CHECKS['valgrind>brisingamen'] = async (w) => {
  const p = await proxyUp(w);
  try {
    await w.v.act('valgrind', 'ajouter', { domaines: 'nas.maison', cible: p.svcUrl, https: 'aucun', dns_maison: false, surveiller: false });
    const r = await w.v.act('valgrind', 'proteger', { domaine: 'nas.maison', utilisateur: 'awa', mot_de_passe: 'une phrase assez longue' });
    assert.match(r.text, /Le mot de passe est dans le coffre/, r.text); assert.ok(did(w, 'brisingamen', 'ajouter'));
    assert.equal(await httpGet(p.port, 'nas.maison'), 401);
    assert.equal(await httpGet(p.port, 'nas.maison', { authorization: `Basic ${Buffer.from('awa:une phrase assez longue').toString('base64')}` }), 200);
  } finally { p.end(); }
};
CHECKS['valgrind>garmr'] = async (w) => {
  const p = await proxyUp(w);
  try {
    await w.v.act('valgrind', 'ajouter', { domaines: 'nas.maison', cible: p.svcUrl, https: 'aucun', dns_maison: false, surveiller: false });
    await w.v.act('valgrind', 'proteger', { domaine: 'nas.maison', utilisateur: 'awa', mot_de_passe: 'une phrase assez longue' });
    for (let k = 0; k < 5; k++) assert.equal(await httpGet(p.port, 'nas.maison', { authorization: `Basic ${Buffer.from('awa:faux').toString('base64')}` }), 401);
    assert.ok(await until(() => did(w, 'garmr', 'bannir')), 'Cerbère est appelé au 5e essai');
    assert.ok(!w.ran.some((c) => /nft add element .*127\.0\.0\.1/.test(c)), 'une adresse de la maison n\'est jamais bannie');
  } finally { p.end(); }
};
CHECKS['garmr>valgrind'] = async (w) => {
  const p = await proxyUp(w);
  try {
    await w.v.act('valgrind', 'ajouter', { domaines: 'nas.maison', cible: p.svcUrl, https: 'aucun', dns_maison: false, surveiller: false });
    assert.equal(await httpGet(p.port, 'nas.maison'), 200);
    w.v.ctx('garmr').saveSettings({ bans: [{ ip: '127.0.0.1', until: Date.now() + 3600_000, reason: 'essai', count: 1, source: 'essai' }] });
    await w.v.module('valgrind')!.watch!.run(w.v.ctx('valgrind'));
    assert.equal(await httpGet(p.port, 'nas.maison'), 403, 'adresse bannie refusée par le proxy');
    w.v.ctx('garmr').saveSettings({ bans: [] }); await w.v.module('valgrind')!.watch!.run(w.v.ctx('valgrind'));
    assert.equal(await httpGet(p.port, 'nas.maison'), 200);
  } finally { p.end(); }
};
CHECKS['valgrind>forseti'] = async (w) => {
  const p = await proxyUp(w);
  try {
    await w.v.act('valgrind', 'ajouter', { domaines: 'panne.maison', cible: 'http://127.0.0.1:9', https: 'aucun', dns_maison: false, surveiller: false });
    for (let k = 0; k < 10; k++) assert.equal(await httpGet(p.port, 'panne.maison'), 502);
    await w.v.module('valgrind')!.watch!.run(w.v.ctx('valgrind'));
    assert.ok(w.v.alerts({ module: 'valgrind' }).some((a) => /Le service derrière panne\.maison ne répond plus/.test(a.title) && a.level === 'haute'));
  } finally { p.end(); }
};
CHECKS['valgrind>ran'] = async (w) => {
  w.v.ctx('valgrind').saveSettings({ hosts: [{ id: 'x', domains: ['nas.maison'], target: 'http://192.168.1.10:5000', enabled: true, tls: 'aucun' }] });
  const view = await w.v.module('valgrind')!.view(w.v.ctx('valgrind'), new URLSearchParams());
  const g = view.sections.find((x) => x.kind === 'graph') as { details: Record<string, { actions?: Array<{ module?: string; action: string; input: Record<string, unknown> }> }> };
  assert.deepEqual(g.details['m:192.168.1.10:5000'].actions?.find((a) => a.module === 'ran')?.input, { ip: '192.168.1.10' });
};
/** Persona prêt : portail réglé, une personne, un site du proxy réservé. Rend le port HTTPS. */
async function varUp(w: World, body = 'login=awa&password=faux'): Promise<{ port: number; end: () => void; post: (b?: string) => Promise<number> }> {
  const p = await proxyUp(w); const https = await import('node:https');
  await w.v.act('var', 'reglages', { portail: 'connexion.exemple.fr', domaine: 'exemple.fr', double_auth: '' });
  await w.v.act('var', 'ajouter', { login: 'awa', nom: 'Awa', groupes: 'famille', mot_de_passe: 'une phrase assez longue' });
  const port = (await import('../src/valhalla/modules/valgrind.ts')).proxyServer()!.httpsPort;
  const post = (b = body) => new Promise<number>((ok, ko) => { const q = https.request({ host: '127.0.0.1', port, path: '/connexion', method: 'POST', servername: 'connexion.exemple.fr', rejectUnauthorized: false, headers: { host: 'connexion.exemple.fr', 'content-type': 'application/x-www-form-urlencoded', connection: 'close' } }, (r) => { r.resume(); r.on('end', () => ok(r.statusCode!)); }); q.on('error', ko); q.end(b); });
  return { port, end: p.end, post };
}
CHECKS['var>valgrind'] = async (w) => {
  const u = await varUp(w);
  try {
    await w.v.act('valgrind', 'ajouter', { domaines: 'nas.exemple.fr', cible: 'http://127.0.0.1:9', https: 'auto-signé', dns_maison: false, surveiller: false });
    assert.match((await w.v.act('var', 'proteger_site', { domaine: 'nas.exemple.fr', groupes: 'famille' })).text, /demande maintenant la connexion d'Odin/);
    assert.equal((w.v.ctx('valgrind').settings.hosts as Array<{ sso?: boolean }>)[0].sso, true);
    const https = await import('node:https');
    const st = await new Promise<number>((ok) => https.get({ host: '127.0.0.1', port: u.port, servername: 'nas.exemple.fr', rejectUnauthorized: false, headers: { host: 'nas.exemple.fr', connection: 'close' } }, (r) => { r.resume(); ok(r.statusCode!); }));
    assert.equal(st, 302, 'renvoyé au portail');
  } finally { u.end(); }
};
/** Bifröst prêt : clé, tunnel déjà créé, fausse API Cloudflare. */
function bruUp(w: World): () => void {
  const saved = process.env.CLOUDFLARE_API_TOKEN; process.env.CLOUDFLARE_API_TOKEN = 'cle-de-test-cloudflare-123456';
  w.v.ctx('bru').saveSettings({ apiBase: 'http://cf.test', tunnel: { id: 't1', name: 'odin', account: 'acc' }, bin: join(w.home, 'absent') });
  return () => { if (saved === undefined) delete process.env.CLOUDFLARE_API_TOKEN; else process.env.CLOUDFLARE_API_TOKEN = saved; };
}
const cfPosted = (w: World, name: string) => w.fetched.some((f) => f.url === 'http://cf.test/zones/z1/dns_records' && f.body && JSON.parse(f.body).name === name && JSON.parse(f.body).content === 't1.cfargotunnel.com');
CHECKS['valgrind>bru'] = async (w) => {
  const end = bruUp(w), p = await proxyUp(w);
  try {
    const r = await w.v.act('valgrind', 'ajouter', { domaines: 'nas.exemple.fr', cible: p.svcUrl, https: 'aucun', dns_maison: false, surveiller: false });
    assert.match(r.text, /publié sur Internet/, r.text); assert.ok(cfPosted(w, 'nas.exemple.fr'));
    assert.deepEqual((w.v.ctx('bru').settings.published as Array<{ hostname: string }>).map((x) => x.hostname), ['nas.exemple.fr']);
  } finally { p.end(); end(); }
};
CHECKS['var>bru'] = async (w) => {
  const end = bruUp(w);
  try { await w.v.act('var', 'reglages', { portail: 'connexion.exemple.fr', domaine: 'exemple.fr', double_auth: '' }); assert.ok(cfPosted(w, 'connexion.exemple.fr'), 'portail publié'); }
  finally { end(); }
};
CHECKS['bru>forseti'] = async (w) => {
  const end = bruUp(w);
  try {
    w.v.ctx('bru').saveSettings({ on: true });
    await w.v.module('bru')!.watch!.run(w.v.ctx('bru'));
    assert.ok(w.v.alerts({ module: 'bru' }).some((a) => /Le tunnel Cloudflare est coupé/.test(a.title) && a.level === 'haute'));
  } finally { end(); }
};
/** Nébuleuse prêt : un espace « Famille » et le serveur des fichiers (port au hasard). */
async function skidUp(w: World): Promise<{ port: number; send: (path: string, o?: { body?: string; headers?: Record<string, string>; method?: string }) => Promise<{ status: number; text: string }> }> {
  await w.v.act('skidbladnir', 'espace', { nom: 'Famille', lecture: 'famille', ecriture: 'famille', quota_go: 1 });
  await w.v.act('skidbladnir', 'demarrer', { port: 0 });
  const port = (await import('../src/valhalla/modules/skidbladnir.ts')).filesServer()!.port, http = await import('node:http');
  const send = (path: string, o: { body?: string; headers?: Record<string, string>; method?: string } = {}) => new Promise<{ status: number; text: string }>((ok, ko) => { const q = http.request({ host: '127.0.0.1', port, path, method: o.method ?? 'GET', headers: { host: 'fichiers.exemple.fr', connection: 'close', ...o.headers } }, (r) => { let b = ''; r.on('data', (c) => { b += c; }); r.on('end', () => ok({ status: r.statusCode!, text: b })); }); q.on('error', ko); q.end(o.body); });
  return { port, send };
}
const skidDown = (w: World) => w.v.act('skidbladnir', 'arreter');
CHECKS['vidarr>garmr'] = async (w) => {
  await dnsUp(w);
  try { assert.ok(did(w, 'garmr', 'ouvrir_port')); assert.match((await w.v.act('garmr', 'ports_ouverts')).text, /\/udp · DNS de la maison/); }
  finally { await w.v.act('vidarr', 'arreter', {}, { by: 'toi' }); }
};
CHECKS['gjoll>garmr'] = async (w) => {
  const { setTunFactory } = await import('../src/valhalla/modules/gjoll.ts');
  setTunFactory(async () => ({ write: () => {}, onPacket: () => {}, close: () => {} }));
  const r = await w.v.act('gjoll', 'allumer'); assert.ok(r.ok, r.text);
  try { assert.ok(did(w, 'garmr', 'ouvrir_port')); assert.match((await w.v.act('garmr', 'ports_ouverts')).text, /\/udp · VPN Vortex/); }
  finally { await w.v.act('gjoll', 'eteindre'); }
};
CHECKS['hlid>garmr'] = async (w) => {
  // Le port direct d'une appli : le donner n'ouvre rien ; l'ouvrir sur le réseau passe par Cerbère ; le refermer retire la règle.
  const { DirectPorts } = await import('../src/valhalla/directports.ts');
  const port = await new Promise<number>((ok) => { const x = createServer().listen(0, '127.0.0.1', () => { const p = (x.address() as { port: number }).port; x.close(() => ok(p)); }); });
  const g = new DirectPorts({ home: w.home, web: 7777, host: '127.0.0.1', access: 'lan', attach: (sock) => sock.destroy() }); await g.start();
  try {
    let r = await w.v.act('hlid', 'port_direct', { appli: 'Vénus', port }); assert.ok(r.ok, r.text);
    assert.ok(!did(w, 'garmr', 'ouvrir_port'), 'donner un port n\'ouvre rien dans le pare-feu');
    r = await w.v.act('hlid', 'ouvrir_port_direct', { appli: 'Vénus' }); assert.ok(r.ok, r.text);
    assert.ok(did(w, 'garmr', 'ouvrir_port')); assert.match((await w.v.act('garmr', 'ports_ouverts')).text, new RegExp(`${port}/tcp · page directe de Vénus`));
    assert.equal(w.v.manips({ module: 'garmr' }).length, 0, 'étape de ton action : pas de manip à part');
    r = await w.v.act('hlid', 'fermer_port_direct', { appli: 'Vénus' }); assert.ok(r.ok, r.text);
    assert.ok(did(w, 'garmr', 'fermer_port')); assert.doesNotMatch((await w.v.act('garmr', 'ports_ouverts')).text, new RegExp(`${port}/tcp`));
  } finally { g.stop(); }
};
CHECKS['fjalar>ullr'] = async (w) => {
  await w.v.act('fjalar', 'dossier', { chemin: join(w.home, 'logiciels') });
  await w.v.act('fjalar', 'ajouter_source', { nom: 'Piège', depot: 'odin-test/piege', motif: 'piege-{version}.exe' });
  assert.match((await w.v.act('fjalar', 'telecharger', { nom: 'Piège' })).text, /🛡 Piège 1\.0 mis de côté/);
  assert.ok(w.acts.some((a) => a.module === 'ullr' && a.action === 'fichier' && a.by === 'réflexe'));
};
CHECKS['var>skidbladnir'] = async (w) => {
  await w.v.act('var', 'ajouter', { login: 'awa', nom: 'Awa', groupes: 'famille', mot_de_passe: 'une phrase assez longue' });
  assert.match((await w.v.act('skidbladnir', 'mot_de_passe_appli', { login: 'awa', nom: 'PC' })).text, /Mot de passe d'appli pour awa/);
  assert.match((await w.v.act('skidbladnir', 'mot_de_passe_appli', { login: 'personne', nom: 'PC' })).text, /pas de compte actif dans Persona/);
};
CHECKS['skidbladnir>valgrind'] = async (w) => {
  const p = await proxyUp(w);
  try {
    await w.v.act('skidbladnir', 'espace', { nom: 'Famille' });
    const r = await w.v.act('skidbladnir', 'publier', { fichiers: 'fichiers.exemple.fr', partage: 'partage.exemple.fr', https: 'aucun' });
    assert.match(r.text, /✓ fichiers\.exemple\.fr dans le proxy[\s\S]*✓ partage\.exemple\.fr dans le proxy/, r.text);
    const hs = (w.v.ctx('valgrind').settings.hosts as Array<{ domains: string[]; target: string }>);
    assert.ok(hs.some((h) => h.domains.includes('partage.exemple.fr') && /^http:\/\/127\.0\.0\.1:\d+$/.test(h.target)));
  } finally { p.end(); await skidDown(w); }
};
CHECKS['skidbladnir>var'] = async (w) => {
  const u = await varUp(w);
  try {
    const r = await w.v.act('skidbladnir', 'publier', { fichiers: 'fichiers.exemple.fr', partage: 'partage.exemple.fr', https: 'auto-signé' });
    assert.match(r.text, /fichiers\.exemple\.fr demande la connexion d'Odin/, r.text);
    assert.equal((w.v.ctx('valgrind').settings.hosts as Array<{ domains: string[]; sso?: boolean }>).find((h) => h.domains.includes('fichiers.exemple.fr'))?.sso, true);
    assert.ok(!(w.v.ctx('valgrind').settings.hosts as Array<{ domains: string[]; sso?: boolean }>).find((h) => h.domains.includes('partage.exemple.fr'))?.sso, 'les liens publics restent publics');
  } finally { u.end(); await skidDown(w); }
};
CHECKS['skidbladnir>ullr'] = async (w) => {
  const k = await skidUp(w);
  try {
    const r = await k.send('/api/televerser?e=famille&p=', { method: 'POST', body: EICAR, headers: { 'remote-user': 'awa', 'remote-groups': 'famille', 'x-skid': '1', 'x-nom': 'facture.com' } });
    assert.equal(r.status, 202, r.text); assert.ok(did(w, 'ullr', 'fichier'));
  } finally { await skidDown(w); }
};
CHECKS['skidbladnir>forseti'] = async (w) => {
  const k = await skidUp(w);
  try {
    await k.send('/api/televerser?e=famille&p=', { method: 'POST', body: EICAR, headers: { 'remote-user': 'awa', 'remote-groups': 'famille', 'x-skid': '1', 'x-nom': 'facture.com' } });
    const a = w.v.alerts({ module: 'skidbladnir' }).find((x) => /Fichier (suspect|dangereux) reçu dans « Famille »/.test(x.title)); assert.ok(a);
  } finally { await skidDown(w); }
};
CHECKS['skidbladnir>garmr'] = async (w) => {
  const k = await skidUp(w);
  try {
    const lk = JSON.parse((await k.send('/api/lien', { method: 'POST', body: JSON.stringify({ e: 'famille', p: '', motdepasse: 'abc' }), headers: { 'remote-user': 'awa', 'remote-groups': 'famille', 'x-skid': '1' } })).text);
    const token = /\/p\/([\w-]+)$/.exec(lk.url)![1];
    for (let i = 0; i < 5; i++) await k.send(`/p/${token}/mot-de-passe`, { method: 'POST', body: 'mot_de_passe=x', headers: { host: 'partage.exemple.fr', 'x-real-ip': '203.0.113.50' } });
    assert.ok(await until(() => did(w, 'garmr', 'bannir')), 'Cerbère appelé au 5e essai');
  } finally { await skidDown(w); }
};
CHECKS['var>brisingamen'] = async (w) => {
  const r = await w.v.act('var', 'ajouter', { login: 'sara', nom: 'Sara', groupes: 'famille' });
  assert.match(r.text, /Son mot de passe est dans le coffre/, r.text); assert.ok(did(w, 'brisingamen', 'ajouter'));
};
CHECKS['var>garmr'] = async (w) => {
  const u = await varUp(w);
  try { for (let k = 0; k < 5; k++) await u.post(); assert.ok(await until(() => did(w, 'garmr', 'bannir')), 'Cerbère appelé au verrouillage'); }
  finally { u.end(); }
};
CHECKS['var>forseti'] = async (w) => {
  const u = await varUp(w);
  try { for (let k = 0; k < 5; k++) await u.post(); assert.equal(await u.post('login=awa&password=une+phrase+assez+longue'), 423); assert.ok(w.v.alerts({ module: 'var' }).some((a) => /Compte « awa » verrouillé/.test(a.title) && a.level === 'haute')); }
  finally { u.end(); }
};
CHECKS['gjoll>forseti'] = async (w) => {
  await w.v.act('gjoll', 'ajouter', { nom: 'Invité', fin: '2020-01-01' }).catch(() => undefined);
  const peers = (w.v.ctx('gjoll').settings.peers as Array<{ name: string; expires?: string }> | undefined) ?? [];
  if (!peers.some((p) => p.name === 'Invité')) w.v.ctx('gjoll').saveSettings({ peers: [...peers, { name: 'Invité', pub: 'x', ip: '10.8.0.9', enabled: true, expires: '2020-01-01' }] });
  await w.v.module('gjoll')!.watch!.run(w.v.ctx('gjoll'));
  assert.ok(w.v.alerts({ module: 'gjoll' }).some((a) => /Accès VPN de « Invité » terminé/.test(a.title)), 'fin d\'accès signalée');
  assert.equal(((w.v.ctx('gjoll').settings.peers as Array<{ name: string; enabled: boolean }>).find((p) => p.name === 'Invité'))?.enabled, false, 'coupé tout seul');
};
const incidents = (w: World) => (w.v.ctx('ullr').settings.incidents as Array<{ title: string; kind: string; apps: string[]; score: number; level: string; done: string[] }> | undefined) ?? [];
const nameOf = (w: World, id: string) => w.v.modules().find((m) => m.id === id)!.name;
const SIGNALS: Record<string, { alone: [string, Record<string, unknown>]; with: [string, string, Record<string, unknown>]; kind: string }> = {
  geri: { alone: ['malveillant', { ip: '203.0.113.66', programme: 'mineur' }], with: ['skogul', 'suspect', { règle: 'mineur', pid: 4242, détail: '/tmp/.x/mineur' }], kind: 'compromission' },
  forseti: { alone: ['fichier_modifie', { fichier: '/etc/passwd' }], with: ['skogul', 'port_ouvert', { port: 4444 }], kind: 'installation furtive' },
  eir: { alone: ['mesure', { cpu: 99, mem: 40, disque: 30 }], with: ['skogul', 'suspect', { règle: 'mineur', pid: 4242, détail: '/tmp/.x/mineur' }], kind: 'programme suspect' },
  naglfar: { alone: ['conteneur_arrete', { conteneur: 'web' }], with: ['skogul', 'suspect', { règle: 'mineur', pid: 4242, détail: '/tmp/.x/mineur' }], kind: 'activité anormale' },
  hermod: { alone: ['machine_hors_ligne', { machine: 'NAS' }], with: ['ullr', 'sentinelle', { fichier: '/srv/docs/!000-ne-pas-toucher.docx', action: 'modifié' }], kind: 'rançongiciel' },
  himinbjorg: { alone: ['mouvement', { caméra: 'Bureau', part: 14, surveillé: true }], with: ['ullr', 'support_branche', { dossier: '/media/cle' }], kind: 'intrusion physique' },
  // Un site web n'a qu'un témoin (Arachné) : son DNS qui change ne dit rien seul ; avec sa page d'accueil qui change aussi, c'est un incident.
  idunn: { alone: ['dns_change', { site: 'boutique' }], with: ['idunn', 'titre_change', { site: 'boutique' }], kind: 'site détourné' },
  // Une machine de la maison qui demande un site dangereux ET tombe dans un piège : elle est sans doute infectée.
  var: { alone: ['verrouillage', { login: 'awa', ip: '203.0.113.90' }], with: ['loki', 'piege', { ip: '203.0.113.90', type: 'identifiants', 'piège': 'ssh', 'détail': 'root/123456' }], kind: 'attaque' },
  valgrind: { alone: ['scan', { ip: '203.0.113.88', chemin: '/.env', site: 'nas.exemple.fr' }], with: ['loki', 'piege', { ip: '203.0.113.88', type: 'identifiants', 'piège': 'ssh', 'détail': 'root/123456' }], kind: 'attaque' },
  vidarr: { alone: ['dns_menace', { ip: '192.168.1.40', domaine: 'c2.virus.example', liste: 'Sites dangereux' }], with: ['loki', 'piege', { ip: '192.168.1.40', type: 'identifiants', 'piège': 'ssh', 'détail': 'root/123456' }], kind: 'attaque' },
};
for (const [from, sc] of Object.entries(SIGNALS)) CHECKS[`${from}>ullr`] = async (w) => {
  w.v.ctx(from).emit(sc.alone[0], sc.alone[1]); await wait(40);
  assert.equal(incidents(w).length, 0, 'un signal seul n\'ouvre pas d\'incident');
  w.v.ctx(sc.with[0]).emit(sc.with[1], sc.with[2]);
  assert.ok(await until(() => incidents(w).length === 1), 'recoupé avec une autre appli : un incident est ouvert');
  const i = incidents(w)[0];
  assert.equal(i.kind, sc.kind); assert.ok(i.apps.includes(nameOf(w, from)), `l'incident cite ${nameOf(w, from)} (${i.apps.join(', ')})`);
  assert.ok(w.v.alerts({ module: 'ullr' }).some((a) => a.title.startsWith('Incident : ')), 'annoncé une fois, avec sa chronologie');
};
CHECKS['garmr>ullr'] = async (w) => {
  // Un bannissement est une réponse, pas un témoin : il ne crée pas d'incident à lui seul, mais Asclépios le sait (pas de double bannissement).
  w.v.ctx('garmr').emit('banni', { ip: '203.0.113.66', raison: 'essai', minutes: 60, source: 'toi' });
  w.v.ctx('skogul').emit('suspect', { règle: 'mineur', pid: 4242, détail: '/tmp/.x/mineur' });
  w.v.ctx('geri').emit('malveillant', { ip: '203.0.113.66', programme: 'mineur' });
  assert.ok(await until(() => incidents(w).length === 1));
  await wait(80);
  assert.ok(incidents(w)[0].apps.includes('Cerbère')); assert.deepEqual(incidents(w)[0].done, [], 'adresse déjà bannie : Asclépios ne la bannit pas une seconde fois');
  assert.ok(!w.ran.some((c) => /nft add element/.test(c)));
};
CHECKS['ullr>garmr'] = async (w) => {
  w.v.ctx('skogul').emit('suspect', { règle: 'mineur', pid: 4242, détail: '/tmp/.x/mineur' });
  w.v.ctx('geri').emit('malveillant', { ip: '203.0.113.66', programme: 'mineur' });
  assert.ok(await until(() => w.ran.some((c) => /^nft add element inet odin garmr4 \{ 203\.0\.113\.66 timeout 86400s \}/.test(c))), 'l\'adresse extérieure de l\'incident est bannie 24 h');
  const m = w.v.manips({ module: 'garmr' })[0];
  assert.equal(m.by, 'réflexe'); assert.equal(m.undo?.action, 'debannir', 'manip annulable'); assert.match(m.why ?? '', /incident « Cette machine communique avec un attaquant »/);
  assert.deepEqual(incidents(w)[0].done, ['bannir 203.0.113.66']);
};
CHECKS['ullr>saga'] = async (w) => {
  w.v.ctx('ullr').emit('sentinelle', { fichier: '/srv/docs/!000-ne-pas-toucher.docx', action: 'modifié' });
  const dir = join(w.home, 'cerveau');
  assert.ok(await until(() => existsSync(dir) && readdirSync(dir).some((f) => /^Incident .*rançongiciel/.test(f))), 'une note datée raconte l\'incident dans le Cerveau');
  const note = join(dir, readdirSync(dir).find((f) => /^Incident /.test(f))!);
  assert.match(readFileSync(note, 'utf8'), /#sécurité #incident[\s\S]*Score de risque : \d+\/100 \(critique\)[\s\S]*\[\[Asclépios\]\]/);
  const id = (w.v.ctx('ullr').settings.incidents as Array<{ id: string }>)[0].id;
  await w.v.act('ullr', 'incident', { incident: id, etat: 'traité' });
  assert.ok(await until(() => /Incident classé : traité/.test(readFileSync(note, 'utf8'))), 'la note est complétée quand l\'incident est classé');
};

/** Liens « donnée » vers Forseti : l'alerte d'une appli rejoint le fil commun et part sur ta messagerie. */
for (const from of ['ullr', 'sindri', 'eir', 'naglfar', 'ymir', 'hermod']) CHECKS[`${from}>forseti`] = async (w) => {
  w.v.alert(from, { level: 'haute', title: `Alerte de test ${from}`, detail: 'détail', key: `t:${from}` });
  assert.match((await w.v.act('forseti', 'alertes', { gravite: 'info' })).text, new RegExp(`Alerte de test ${from}`), 'visible dans le fil commun de Forseti');
  assert.ok(await until(() => w.sent.some((s) => s.includes(`Alerte de test ${from}`))), 'envoyée sur ta messagerie');
};

/** Arachné → Forseti : un site qui ne répond pas deux fois de suite, c'est une alerte critique dans le fil commun et sur ta messagerie. */
CHECKS['idunn>forseti'] = async (w) => {
  await w.v.act('idunn', 'ajouter', { adresse: 'http://boutique.exemple', nom: 'boutique' });
  assert.ok(!w.v.alerts({ module: 'idunn' }).length, 'un seul essai raté : pas encore une panne');
  await w.v.act('idunn', 'etat', { site: 'boutique' });
  assert.match((await w.v.act('forseti', 'alertes', { gravite: 'info' })).text, /boutique : le site ne répond plus/, 'visible dans le fil commun de Forseti');
  assert.ok(await until(() => w.sent.some((s) => s.includes('boutique : le site ne répond plus'))), 'envoyée sur ta messagerie');
};
/** Arachné se surveille : chaque mise en production est essayée ; un essai raté propose le retour en arrière, sans jamais le lancer. */
CHECKS['idunn>idunn'] = async (w) => {
  await w.v.act('idunn', 'ajouter', { adresse: 'http://boutique.exemple', nom: 'boutique' }); w.acts.length = 0;
  w.v.ctx('idunn').emit('deploiement_ok', { site: 'boutique', production: false }); await wait(80);
  assert.ok(!did(w, 'idunn', 'tester'), 'un déploiement d\'aperçu ne déclenche rien');
  w.v.ctx('idunn').emit('deploiement_ok', { site: 'boutique', production: true });
  assert.ok(await until(() => did(w, 'idunn', 'tester')), 'une mise en production : le site est essayé');
  assert.ok(await until(() => w.v.alerts({ module: 'idunn' }).some((a) => /le nouveau déploiement casse quelque chose/.test(a.title) && /reviens à la version précédente du site boutique/.test(a.detail ?? ''))), 'essai raté : tu es prévenu, et le retour en arrière est proposé');
  assert.ok(!did(w, 'idunn', 'revenir') && !did(w, 'idunn', 'deployer'), 'rien de grave n\'est lancé seul');
  assert.equal(w.v.manips({ module: 'idunn' }).length, 0, 'un essai n\'est pas une manip : rien à garder ni à annuler');
};

// ---------------- Genèse (déploiement par le réseau) ----------------
const ISOS = join(import.meta.dirname, 'fixtures', 'thjalfi');
async function thj(w: World): Promise<{ base: string; get: (p: string) => Promise<string> }> {
  const dir = join(w.home, 'iso'); mkdirSync(dir, { recursive: true });
  for (const f of readdirSync(ISOS)) writeFileSync(join(dir, f.replace(/\.gz$/, '')), gunzipSync(readFileSync(join(ISOS, f))));
  await w.v.act('eitri', 'dossier', { chemin: dir });
  w.v.ctx('thjalfi').saveSettings({ ports: { http: 0, tftp: 0, dhcp: 0, pxe: 0, client: 0 }, ip: '127.0.0.1', mode: 'aucun' });
  const base = /http:\/\/127\.0\.0\.1:\d+/.exec((await w.v.act('thjalfi', 'allumer')).text)![0];
  return { base, get: async (p) => (await fetch(`${base}${p}`)).text() };
}
CHECKS['eitri>thjalfi'] = async (w) => {
  const t = await thj(w);
  assert.match((await w.v.act('thjalfi', 'isos')).text, /ubuntu-24\.04\.3-live-server-amd64 : Ubuntu Server \(installation automatique\)/, 'l\'ISO d\'Andromède est reconnue');
  assert.match(await t.get('/menu.ipxe?mac=52:54:00:00:10:01'), /item e-ubuntu-24-04-3-live-server-amd64 /, 'elle est dans le menu de démarrage');
};
CHECKS['fjalar>thjalfi'] = async (w) => {
  const t = await thj(w);
  await w.v.act('fjalar', 'dossier', { chemin: join(w.home, 'logiciels') }); mkdirSync(join(w.home, 'logiciels', 'VLC'), { recursive: true }); writeFileSync(join(w.home, 'logiciels', 'VLC', 'vlc-3.0.21-win64.exe'), 'MZ-VLC');
  await w.v.act('thjalfi', 'partage_windows', { unc: '\\\\nas\\iso', dossier: join(w.home, 'nas') });
  await w.v.act('thjalfi', 'profil', { nom: 'Bureau', logiciels: 'vlc' });
  await w.v.act('thjalfi', 'autoriser', { mac: '52:54:00:00:10:02', iso: 'win11', profil: 'Bureau', auto: true });
  const tok = /seed\/([\w-]+)\//.exec(await t.get('/menu.ipxe?mac=52:54:00:00:10:02&fw=efi'))![1];
  const ps = await t.get(`/w/${tok}/apres.ps1`);
  assert.match(ps, /\/logiciel\/[\w-]+\/vlc-3\.0\.21-win64\.exe/, 'l\'installateur de Hermès est servi'); assert.match(ps, /'\/L=1036 \/S'/, 'en silencieux');
  assert.equal(await t.get(`/logiciel/${tok}/vlc-3.0.21-win64.exe`), 'MZ-VLC');
};
async function installOne(w: World): Promise<void> {
  const t = await thj(w);
  await w.v.act('thjalfi', 'autoriser', { mac: '52:54:00:00:10:03', iso: 'ubuntu', nom: 'bureau-1', auto: true });
  const tok = /seed\/([\w-]+)\//.exec(await t.get('/menu.ipxe?mac=52:54:00:00:10:03'))![1];
  await t.get('/f/ubuntu-24-04-3-live-server-amd64/casper/vmlinuz?m=52:54:00:00:10:03');
  assert.equal(await t.get(`/etat/${tok}?e=fini&nom=bureau-1&ip=192.168.1.50`), 'ok');
}
CHECKS['thjalfi>askr'] = async (w) => {
  await installOne(w);
  assert.ok(await until(async () => /bureau-1/.test((await w.v.act('askr', 'chercher', { q: '52:54:00:00:10:03' })).text)), 'la machine installée a sa fiche');
  assert.match((await w.v.act('askr', 'chercher', { q: 'bureau-1' })).text, /192\.168\.1\.50/);
};
CHECKS['thjalfi>forseti'] = async (w) => {
  await installOne(w);
  assert.match((await w.v.act('forseti', 'alertes', { gravite: 'info' })).text, /bureau-1 installée \(ubuntu-24\.04\.3-live-server-amd64\)/);
};
CHECKS['thjalfi>brisingamen'] = async (w) => {
  await w.v.act('thjalfi', 'profil', { nom: 'Atelier', utilisateur: 'tech' });
  assert.match((await w.v.act('brisingamen', 'chercher', { q: 'Déploiement' })).text, /Déploiement · Atelier · tech/, 'le mot de passe est dans le coffre');
};
CHECKS['thjalfi>ullr'] = async (w) => {
  const t = (await w.v.act('thjalfi', 'preparer')).text;
  assert.match(t, /🛡 undionly\.kpxe mis de côté/, 'un chargeur suspect est refusé');
  assert.ok(!existsSync(join(w.home, 'valhalla', 'thjalfi', 'boot', 'undionly.kpxe')), 'il n\'est jamais servi');
};
CHECKS['thjalfi>vidarr'] = async (w) => {
  await thj(w); await w.v.act('thjalfi', 'mode', { mode: 'odin', filtre: 'tous' });
  const out: Buffer[] = [], d = new DhcpServer({ config: () => ({ server: '192.168.1.2', start: '192.168.1.100', end: '192.168.1.150', mask: '255.255.255.0', router: '192.168.1.1', dns: ['192.168.1.2'], leaseSeconds: 3600, fixed: [] }), leases: () => [], save: () => {} });
  (d as unknown as { sock: { send: (b: Buffer) => void } }).sock = { send: (b: Buffer) => out.push(b) };
  const arch = Buffer.alloc(2); arch.writeUInt16BE(7);
  d.onMessage(buildPacket({ op: 1, xid: 7, mac: '52:54:00:00:10:04', options: [[53, Buffer.from([MSG.DISCOVER])], [60, Buffer.from('PXEClient:Arch:00007')], [93, arch]] }));
  d.onMessage(buildPacket({ op: 1, xid: 8, mac: '52:54:00:00:10:05', options: [[53, Buffer.from([MSG.DISCOVER])]] }));
  assert.equal(out.length, 2);
  assert.equal(out[0].subarray(108, 236).toString('latin1').replace(/\0+$/, ''), 'ipxe.efi', 'la machine PXE reçoit son chargeur dans la réponse du DHCP d\'Odin');
  assert.equal(parsePacket(out[0]).siaddr, '127.0.0.1');
  assert.equal(out[1].subarray(108, 236).toString('latin1').replace(/\0+$/, ''), '', 'un appareil ordinaire : rien de plus');
};

CHECKS['eir>syn'] = async (w) => {
  await w.v.module('eir')!.watch!.run(w.v.ctx('eir')); w.v.metrics.flush();
  await w.v.act('syn', 'modele', { modele: 'machine' });
  assert.match((await w.v.act('syn', 'voir', { tableau: 'machine', periode: '1h' })).text, /Processeur \(moyenne\) : \S+ eir\.cpu \d/, 'les mesures d\'Hygie arrivent dans le tableau Machine');
};
CHECKS['vordr>syn'] = async (w) => {
  w.v.metrics.put({ 'vordr.up.site': 1, 'vordr.temps.site': 230 }); w.v.metrics.flush();
  await w.v.act('syn', 'modele', { modele: 'sites' });
  assert.match((await w.v.act('syn', 'voir', { tableau: 'sites-et-appareils', periode: '1h' })).text, /Temps de réponse \(moyenne\) : 🟢 site 230 ms[\s\S]*Disponibilité \(moyenne\) : 🟢 site 100 %/);
};
CHECKS['syn>forseti'] = async (w) => {
  w.v.metrics.put({ 'eir.mem': 97 }); w.v.metrics.flush();
  await w.v.act('syn', 'modele', { modele: 'machine' });
  await w.v.module('syn')!.watch!.run(w.v.ctx('syn'));
  const a = w.v.alerts({ module: 'syn' }).find((x) => /Mémoire : eir\.mem 97 %/.test(x.title));
  assert.ok(a, 'seuil rouge dépassé : alerte dans Forseti'); assert.equal(a!.level, 'haute');
};

CHECKS['hlin>volva'] = async (w) => {
  rythme(0);
  await w.v.act('hlin', 'moi', { prenom: 'Awa', nom: 'Saïd', villes: 'Mamoudzou' });
  const r = await w.v.act('hlin', 'chercher', { quoi: 'web' });
  assert.equal(r.ok, true, r.text);
  assert.ok(w.acts.some((a) => a.module === 'volva' && a.action === 'brut' && a.by === 'réflexe'), 'la recherche passe par Pythie');
  assert.ok(!existsSync(join(w.v.ctx('volva').dir, 'historique.json')), 'rien dans l\'historique de Pythie');
  assert.match((await w.v.act('hlin', 'chercher', { fiche: 'Jean Dupont' })).text, /aucune fiche/, 'jamais un nom libre');
};
CHECKS['hlin>brisingamen'] = async (w) => {
  rythme(0);
  await w.v.act('hlin', 'moi', { prenom: 'Awa', nom: 'Saïd', emails: 'awa.said@exemple.yt' });
  const cle = '0123456789abcdef0123456789abcdef';
  assert.equal((await w.v.act('hlin', 'cle_fuites', { cle })).ok, true);
  assert.ok(did(w, 'brisingamen', 'ajouter'), 'la clé va dans le coffre');
  assert.match((await w.v.act('brisingamen', 'chercher', { q: 'pwned' })).text, /Have I Been Pwned/); assert.doesNotMatch(JSON.stringify(w.v.manips()), new RegExp(cle), 'la clé n\'est jamais dans le journal');
  await w.v.act('hlin', 'chercher', { quoi: 'fuites' });
  assert.ok(w.fetched.some((f) => f.url.startsWith('https://haveibeenpwned.com/api/v3/breachedAccount/awa.said%40exemple.yt')), 'Gygès relit la clé dans le coffre');
};
CHECKS['hlin>forseti'] = async (w) => {
  await w.v.act('hlin', 'moi', { prenom: 'Awa', nom: 'Saïd', emails: 'awa.said@exemple.yt' });
  const d = new Date(Date.now() - 40 * 864e5), jour = `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
  assert.equal((await w.v.act('hlin', 'noter_demande', { site: 'annuaire.exemple', date: jour })).ok, true);
  await w.v.module('hlin')!.watch!.run(w.v.ctx('hlin'));
  const a = w.v.alerts({ module: 'hlin' }).find((x) => /annuaire\.exemple : délai dépassé/.test(x.title));
  assert.ok(a, 'délai dépassé : alerte dans Forseti'); assert.equal(a!.fix?.action, 'relancer');
};

/**
 * Tirésias lit les disques avec smartctl ; la machine d'essai n'a pas de SMART : un faux smartctl rend les exemples
 * de test/fixtures/durinn (au format JSON de smartmontools), dont un disque en échec (sdd).
 */
const tiresias = (w: World) => {
  const dir = join(import.meta.dirname, 'fixtures', 'durinn'), lire = (n: string) => readFileSync(join(dir, `${n}.json`), 'utf8');
  return Object.assign(Object.create(w.v.ctx('durinn')) as ReturnType<Valhalla['ctx']>, { run: async (cmd: string, args: string[]) => {
    if (cmd === 'sh') return { code: 0, out: 'smartctl\n', err: '' };
    if (cmd !== 'smartctl') return { code: 1, out: '', err: '' };
    if (args.includes('--scan')) return { code: 0, out: lire('scan'), err: '' };
    const dev = String(args.at(-1)).replace('/dev/', ''), t = args.includes('-d') ? args[args.indexOf('-d') + 1] : '';
    return { code: 0, out: t && existsSync(join(dir, `${dev}.${t}.json`)) ? lire(`${dev}.${t}`) : lire(dev), err: '' };
  } });
};
CHECKS['durinn>forseti'] = async (w) => {
  await w.v.module('durinn')!.watch!.run(tiresias(w));
  const a = w.v.alerts({ module: 'durinn' }).find((x) => /^Disque sdd .* : état Mauvais$/.test(x.title));
  assert.ok(a, 'le disque en échec lève une alerte'); assert.equal(a!.level, 'critique');
  assert.match(a!.detail ?? '', /Sauvegarde d'abord ce qui compte, remplace le disque ensuite\./); assert.ok((a!.steps ?? []).length >= 3, 'l\'alerte dit quoi faire, pas à pas');
  assert.ok(w.v.alerts().some((x) => x.title === a!.title), 'elle est dans le fil commun');
};
CHECKS['durinn>sindri'] = async (w) => {
  w.v.ctx('sindri').saveSettings({ plans: [{ name: 'Serveur', paths: [w.home], repo: join(w.home, 'depot'), at: '02:00', keep: { last: 3, daily: 7, weekly: 4, monthly: 6 } }] });
  await w.v.module('durinn')!.watch!.run(tiresias(w));
  const a = w.v.alerts({ module: 'durinn' }).find((x) => /^Disque sdd .* : état Mauvais$/.test(x.title));
  assert.deepEqual(a?.fix, { module: 'sindri', action: 'sauvegarder', label: 'Sauvegarder maintenant', input: { plan: 'Serveur' } }, 'le bouton lance le plan de sauvegarde');
  assert.match(a!.steps![0], /Phénix : « Sauvegarder maintenant », plan « Serveur »/);
  await w.v.act(a!.fix!.module!, a!.fix!.action, a!.fix!.input);
  assert.ok(did(w, 'sindri', 'sauvegarder'), 'la sauvegarde part');
};
CHECKS['durinn>askr'] = async (w) => {
  await w.v.module('durinn')!.watch!.run(tiresias(w));
  assert.ok(await until(async () => /Disque WDC WD40EFRX-68N32N0 4 To/.test((await w.v.act('askr', 'chercher', { q: 'WD-WCC7K0XXXXXA' })).text)), 'la fiche du disque est dans l\'inventaire');
  assert.match((await w.v.act('askr', 'chercher', { q: 'S4EWNX0XXXXXXXK' })).text, /Samsung SSD 970 EVO Plus 1TB/);
  assert.doesNotMatch((await w.v.act('askr', 'chercher', { q: 'Cruzer' })).text, /Disque SanDisk/, 'pas de fiche pour une clé USB');
  // Une seule fois : relu, rien de plus ; supprimée, jamais recréée.
  const n = (await w.v.act('askr', 'chercher', { q: 'Disque' })).text;
  await w.v.module('durinn')!.watch!.run(tiresias(w)); await wait(100);
  assert.equal((await w.v.act('askr', 'chercher', { q: 'Disque' })).text, n);
};
CHECKS['eir>durinn'] = async (w) => {
  // Hygie : chaque disque de son tableau de débit a son bouton vers Tirésias.
  const v = await w.v.module('eir')!.view(w.v.ctx('eir'), new URLSearchParams());
  const t = v.sections.find((x) => x.kind === 'table' && x.title === 'Disques (débit)') as Extract<(typeof v.sections)[number], { kind: 'table' }> | undefined;
  assert.ok(t, 'Hygie montre les disques');
  if (!t!.rows.length) return; // machine sans disque lisible (rare) : rien à relier
  const b = t!.rows[0].actions?.find((x) => x.module === 'durinn');
  assert.deepEqual(b && { module: b.module, action: b.action, label: b.label }, { module: 'durinn', action: 'ouvrir', label: 'Santé (Tirésias)' });
  const r = await w.v.act('durinn', b!.action, b!.input); assert.ok(r.text.length > 0);
  assert.ok(did(w, 'durinn', 'ouvrir'), 'le bouton ouvre le disque dans Tirésias');
};
CHECKS['hermod>durinn'] = (w) => propose(w, 'durinn');
CHECKS['pegase>ullr'] = async (w) => {
  const r = await analyserFichier(w.v.ctx('pegase'), 'facture.pdf.exe', Buffer.from(EICAR));
  assert.equal(r.verdict, 'bloque'); assert.ok(did(w, 'ullr', 'fichier'), 'Asclépios a analysé le fichier');
  assert.deepEqual(readdirSync(join(w.v.ctx('ullr').dir, 'depots')), [], 'la copie envoyée est effacée');
};
CHECKS['pegase>vidarr'] = async (w) => {
  await w.v.act('vidarr', 'bloquer', { domaine: 'piege.exemple' });
  const r = await verifierAdresse(w.v.ctx('pegase'), 'https://www.piege.exemple/connexion');
  assert.ok(did(w, 'vidarr', 'tester'), 'Sphinx est interrogé'); assert.match(r.texte, /Sphinx : 🚫 bloqué/); assert.notEqual(r.verdict, 'sur');
  assert.equal((await verifierAdresse(w.v.ctx('pegase'), 'https://mayotte.fr/')).verdict, 'sur');
};
CHECKS['pegase>saga'] = async (w) => {
  const ctx = w.v.ctx('pegase'), m = magOf(ctx), hier = Date.now() - 86400_000;
  m.setPrefs('p_test', { voir: 'tout' });
  m.appliquer('p_test', 'a_test', [{ id: 'h1', col: 'historique', data: { url: 'https://www.google.com/search?q=billet+avion+dzaoudzi', titre: 'Recherche', date: hier }, maj: hier }, { id: 'h2', col: 'historique', data: { url: 'https://ewa.yt/vols', titre: 'Vols', date: hier }, maj: hier }]);
  m.appliquer('p_prive', 'a_test', [{ id: 'h1', col: 'historique', data: { url: 'https://secret.yt', titre: 'Privé', date: hier }, maj: hier }]);
  await w.v.module('pegase')!.watch!.run(ctx);
  assert.ok(await until(() => did(w, 'saga', 'noter')), 'résumé noté dans Thot');
  const e = w.events.filter((x) => x.module === 'pegase' && x.type === 'navigation_du_jour');
  assert.equal(e.length, 1, 'une ligne pour le profil qui le permet, rien pour l\'historique privé'); assert.match(String(e[0].data.recherches), /billet avion dzaoudzi/);
  assert.ok(m.copies('p_test').some((c) => c.raison === 'quotidienne'), 'et la copie du jour est faite');
};
CHECKS['pegase>forseti'] = async (w) => {
  const ctx = w.v.ctx('pegase');
  nouvelAppareil(ctx, { id: 'p_test', name: 'Nour' }, { nom: 'Téléphone de Nour', plateforme: 'android', ip: '192.168.1.42' });
  assert.ok(w.v.alerts({ module: 'pegase' }).some((a) => /nouvel appareil pour Nour/.test(a.title) && a.fix?.action === 'revoquer'));
  await analyserFichier(ctx, 'virus.exe', Buffer.from(EICAR));
  assert.ok(w.v.alerts({ module: 'pegase' }).some((a) => /fichier bloqué/.test(a.title) && a.level === 'haute'));
};

/** Perséphone : une petite image (du bruit, une vraie photo JPEG), récupérée vers un autre dossier ; on attend la fin. */
async function persephone(w: World): Promise<string> {
  const img = join(w.home, 'carte.img'), dest = join(w.home, 'autre-disque'); mkdirSync(dest, { recursive: true });
  const jpg = readFileSync(join(import.meta.dirname, 'fixtures', 'hel', 'fichiers', 'photo.jpg'));
  writeFileSync(img, Buffer.concat([Buffer.alloc(8192, 7), jpg, Buffer.alloc(8192)]));
  const r = await w.v.act('hel', 'recuperer', { source: img, destination: dest }); assert.notEqual(r.ok, false, r.text);
  await attendreHel(w.v.ctx('hel').dir);
  return join(dest, 'recuperes');
}
CHECKS['hel>ullr'] = async (w) => {
  const dossier = await persephone(w);
  const a = w.v.alerts({ module: 'hel' }).find((x) => /fichier\(s\) retrouvé\(s\)/.test(x.title));
  assert.equal(a?.fix?.action, 'analyser', 'l\'alerte propose l\'analyse');
  const r = await w.v.act('hel', a!.fix!.action, a!.fix!.input ?? {});
  assert.ok(did(w, 'ullr', 'analyser'), 'Asclépios analyse le dossier'); assert.match(r.text, /fichiers analysés/);
  assert.ok(existsSync(join(dossier, 'photos')), 'la photo est retrouvée');
};
CHECKS['hel>forseti'] = async (w) => {
  await persephone(w);
  const a = w.v.alerts().find((x) => x.module === 'hel' && /Perséphone : 1 fichier\(s\) retrouvé\(s\)/.test(x.title));
  assert.ok(a, 'le résumé est dans le fil commun'); assert.match(a!.detail ?? '', /1 entier\(s\) vérifié\(s\), 0 abîmé/); assert.ok((a!.steps ?? []).length >= 2);
};
CHECKS['durinn>hel'] = async (w) => {
  const ctx = tiresias(w); await w.v.module('durinn')!.watch!.run(ctx);
  const v = await w.v.module('durinn')!.view(ctx, new URLSearchParams());
  const cartes = v.sections.find((x) => x.kind === 'cards') as Extract<(typeof v.sections)[number], { kind: 'cards' }>;
  const b = cartes.items.flatMap((x) => x.actions ?? []).find((x) => x.module === 'hel');
  assert.deepEqual(b && { action: b.action, label: b.label }, { action: 'ouvrir', label: 'Récupérer les fichiers (Perséphone)' }, 'le disque mauvais a son bouton');
  const r = await w.v.act('hel', b!.action, b!.input);
  assert.ok(did(w, 'hel', 'ouvrir'), 'le disque est ouvert dans Perséphone'); assert.match(r.text, /\/dev\/sdd/);
};

test('tous les liens entre applis sont automatiques, et chacun a sa vérification', () => {
  assert.ok(LINKS.length >= 32);
  assert.deepEqual(LINKS.filter((l) => l.auto !== true).map((l) => `${l.from}>${l.to}`), [], 'aucun lien « à activer »');
  assert.deepEqual(LINKS.map((l) => `${l.from}>${l.to}`).filter((k) => !CHECKS[k]), [], 'chaque lien annoncé est vérifié');
  assert.deepEqual(Object.keys(CHECKS).filter((k) => !LINKS.some((l) => `${l.from}>${l.to}` === k)), [], 'pas de vérification orpheline');
  const w = world();
  try {
    const ids = new Set(w.v.modules().map((m) => m.id));
    for (const l of LINKS) assert.ok(ids.has(l.from) && ids.has(l.to), `applis du lien ${l.from}>${l.to} connues`);
    for (const u of USAGES) for (const c of u.chain) assert.ok(ids.has(c), `usage « ${u.need} » : appli ${c} connue`);
  } finally { w.end(); }
});

for (const l of LINKS) {
  test(`lien ${l.from} → ${l.to} (${l.kind}) : quand ${l.when}, ${l.does}`, async () => {
    const w = world();
    try { await CHECKS[`${l.from}>${l.to}`](w); } finally { w.end(); }
  });
}

test('Vénus : santé de Venus (en marche, lectures, disque presque plein)', () => {
  const t = santeText({ ok: true, name: 'Venus', version: '3.2', uptime: 3 * 86400, scanning: true, playing: 2, disk: { free: 40e9, total: 1e12 } });
  assert.match(t, /Venus 3\.2 en marche depuis 3 j/); assert.match(t, /2 lecture/); assert.match(t, /analyse/); assert.match(t, /40\.0 Go libres sur 1000 Go ⚠️ presque plein/);
  assert.doesNotMatch(santeText({ ok: true, uptime: 7200, disk: { free: 5e11, total: 1e12 } }), /presque plein/);
});
