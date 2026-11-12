// Les liens entre les applis d'Odin : chaque lien annoncé est automatique ET vérifié ici (on déclenche
// la première appli, on regarde ce que fait la seconde). Un lien ajouté à la liste sans sa vérification
// fait échouer le test : la liste ne peut pas promettre plus que le code.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { LINKS, USAGES, wireReflexes } from '../src/valhalla/links.ts';
import { parseTasmota, tasmotaDevices } from '../src/valhalla/modules/appareils.ts';
import { LokiEngine } from '../src/valhalla/modules/loki.ts';
import { allModules } from '../src/valhalla/odin.ts';
import { Valhalla } from '../src/valhalla/service.ts';

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
    if (/pirate\.exemple\/bot\.sh/.test(url)) return new Response(EICAR, { status: 200 });
    if (/firehol_level1|feodotracker/.test(url)) return new Response('203.0.113.66\n198.51.100.0/24\n', { status: 200 });
    if (/\/api\/states/.test(url)) return Response.json([{ entity_id: 'media_player.salon', state: 'idle', attributes: { friendly_name: 'Enceinte salon' } }, { entity_id: 'tts.demo', state: 'unknown', attributes: {} }]);
    if (/\/api\/services\//.test(url)) return Response.json([]);
    if (/\/cm\?cmnd=/.test(url)) return Response.json({ ok: true });
    throw new Error('réseau coupé par le test');
  }) as unknown as typeof fetch;
  const v = new Valhalla(home, allModules({ paths: { home, workspace: home }, cfg: { venus: { url: 'http://venus.test:8096' }, voice: {} } } as never), {
    run: async (cmd, args) => { ran.push(`${cmd} ${args.join(' ')}`); return { code: 0, out: /command -v/.test(args.join(' ')) ? '/usr/bin/x' : /^(docker|podman)$/.test(cmd) && args[0] === 'ps' ? DOCKER : cmd === 'ss' ? 'tcp   0 0 192.168.1.20:51000 203.0.113.66:4444 users:(("mineur",pid=4242,fd=3))\n' : '', err: '' }; },
    fetch: fakeFetch, notify: async (t) => { sent.push(t); }, autonomy: () => lvl,
  });
  v.events.on('action', (a: World['acts'][number]) => acts.push(a)); v.events.on('event', (e: World['events'][number]) => events.push(e));
  const unwire = wireReflexes(v, { retryMs: 30 });
  return { v, home, ran, sent, fetched, acts, events, level: (l) => { lvl = l; }, end: () => { unwire(); v.stop(); for (const [k, val] of Object.entries(saved)) { if (val === undefined) delete process.env[k]; else process.env[k] = val; } rmSync(home, { recursive: true, force: true }); } };
}
const did = (w: World, module: string, action: string) => w.acts.some((a) => a.module === module && a.action === action);

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
    assert.match(a?.detail ?? '', /jamais exécuté[\s\S]*Ullr : ⚠ Test antivirus EICAR/, 'le verdict d\'Ullr part avec l\'alerte');
  },
  'geri>garmr': async (w) => {
    await w.v.module('geri')!.watch!.run(w.v.ctx('geri')); // les listes publiques sont chargées, puis les connexions en cours sont comparées
    assert.ok(w.v.alerts({ module: 'geri' }).some((a) => a.level === 'critique' && /mineur parle à une adresse malveillante/.test(a.title)));
    assert.ok(w.ran.some((c) => /^nft add element inet odin garmr4 \{ 203\.0\.113\.66 timeout 86400s \}/.test(c)), 'l\'adresse malveillante est bannie 24 h');
  },
  'skogul>ullr': async (w) => {
    w.v.ctx('skogul').emit('suspect', { règle: 'mineur', pid: process.pid, détail: 'test' });
    assert.ok(await until(() => did(w, 'ullr', 'fichier')), 'le programme du processus suspect est analysé par Ullr');
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
    // Une fausse box domotique (protocole Home Assistant) : on y lit ce que Bragi demande de dire.
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
    assert.match(r.text, /🎙 « mets Inception sur la télé »\nFreyja · /, r.text);
    assert.ok(did(w, 'freyja', 'regarder'), 'Freyja reçoit l\'ordre de lancer le titre');
    const g = await w.v.act('bragi', 'ordre', { texte: 'supprime le conteneur web' });
    assert.equal(g.ok, false); assert.match(g.text, /action grave/i, 'une action grave ne part jamais d\'un ordre à la voix');
    assert.ok(!w.ran.some((c) => /docker rm/.test(c)));
  },
  'midgard>freyja': async (w) => {
    await w.v.act('midgard', 'creer_scene', { nom: 'Film', etapes: 'freyja.regarder = Inception\nnaglfar.supprimer = web' });
    const r = await w.v.act('midgard', 'scene', { scene: 'Film' });
    assert.ok(did(w, 'freyja', 'regarder'), 'la scène lance le titre sur Freyja');
    assert.match(r.text, /✗ naglfar\.supprimer : action grave : elle ne part pas d'une scène/, 'une action grave ne part jamais d\'une scène');
    assert.ok(!w.ran.some((c) => /docker rm/.test(c)));
  },
  'kvasir>runes': async (w) => {
    await w.v.ctx('kvasir').call('runes', 'evolution', { titre: 'nocodb/nocodb 0.300.0', appli: 'Runes', lien: 'https://github.com/nocodb/nocodb/releases/tag/0.300.0', resume: 'Nouvelle vue calendrier.' });
    assert.match((await w.v.act('runes', 'bases')).text, /Évolutions/, 'la base « Évolutions » reçoit la fiche');
    assert.match((await w.v.act('saga', 'chercher', { q: 'nocodb 0.300.0' })).text, /nocodb/);
  },
  'sindri>ymir': async (w) => {
    const src = join(w.home, 'a-sauver'); mkdirSync(src, { recursive: true }); writeFileSync(join(src, 'note.txt'), 'bonjour');
    await w.v.act('sindri', 'creer', { nom: 'Serveur', dossiers: src, depot: join(w.home, 'depot') });
    assert.match((await w.v.act('sindri', 'machines', { plan: 'Serveur', vms: '101, 102' })).text, /instantané des machines 101, 102/);
    const r = await w.v.act('sindri', 'sauvegarder', { plan: 'Serveur' });
    assert.match(r.text, /💾 Serveur : 1 fichiers[\s\S]*Instantanés des machines virtuelles/, r.text);
    assert.equal(w.acts.filter((a) => a.module === 'ymir' && a.action === 'instantane').length, 2, 'Ymir est appelé pour chaque machine avant la sauvegarde');
  },
  // ---- Soins : ce qu'Odin répare tout seul
  'naglfar>naglfar': async (w) => {
    w.level('prudent');
    w.v.ctx('naglfar').emit('conteneur_arrete', { conteneur: 'api' }); await wait(60);
    assert.ok(!w.ran.some((c) => /docker start api/.test(c)), 'niveau « Me demander » : Odin ne touche à rien');
    assert.ok(w.v.alerts({ module: 'naglfar' }).some((a) => /Je peux réparer : démarre le conteneur api/.test(a.title)), 'il propose seulement');
    w.level('equilibre');
    w.v.ctx('naglfar').emit('conteneur_arrete', { conteneur: 'web' });
    assert.ok(await until(() => w.ran.some((c) => /^docker start web/.test(c))), 'le conteneur arrêté tout seul est relancé');
    const m = w.v.manips()[0];
    assert.equal(m.by, 'odin'); assert.equal(m.state, 'à décider'); assert.match(m.why ?? '', /s'est arrêté tout seul/);
    assert.match(w.sent.at(-1) ?? '', new RegExp(`Manip faite de moi-même : Naglfar · Démarrer.*« garde ${m.id} » ou « annule ${m.id} »`));
    const n = w.ran.filter((c) => /docker start web/.test(c)).length;
    w.v.ctx('naglfar').emit('conteneur_arrete', { conteneur: 'web' }); await wait(60);
    assert.equal(w.ran.filter((c) => /docker start web/.test(c)).length, n, 'pas de boucle : une relance par heure au plus');
    assert.match((await w.v.decide(m.id, false)).text, /↩ Annulé : Naglfar · Démarrer \(conteneur arrêté\)/);
    assert.ok(w.ran.some((c) => /^docker stop web/.test(c)), '« annule » : le conteneur est arrêté de nouveau');
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
 * Liens vers Ullr : le signal de chaque appli rejoint les incidents. Seul, il ne dit rien ; recoupé avec
 * celui d'une autre appli, il ouvre un incident où l'appli est citée.
 */
/** Víðarr démarré pour l'essai : une liste « menaces » écrite à la main (pas de réseau), sur un port libre. */
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
  assert.match(r.text, /Il passe par le DNS d'Odin \(Víðarr\)/, r.text);
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
  assert.ok(await until(() => did(w, 'saga', 'noter')), 'note du jour dans Saga');
  assert.ok(existsSync(join(w.v.ctx('vidarr').dir, 'historique', day.slice(0, 4), day.slice(5, 7), `${day.slice(8)}.json`)), 'résumé du jour gardé dans l\'historique');
  const h = await w.v.act('vidarr', 'historique', { periode: 'jour', date: day });
  assert.match(h.text, /2 requêtes, 1 bloquées[\s\S]*Tablette \(192\.168\.1\.30\)/);
};
CHECKS['vidarr>ran'] = async (w) => {
  w.v.ctx('vidarr').saveSettings({ leases: [{ mac: '02:aa:bb:cc:dd:01', ip: '192.168.1.40', name: 'PC', expires: Date.now() + 3600_000 }] });
  const view = await w.v.module('vidarr')!.view(w.v.ctx('vidarr'), new URLSearchParams());
  const g = view.sections.find((x) => x.kind === 'graph') as { details: Record<string, { actions?: Array<{ module?: string; action: string; input: Record<string, unknown> }> }> };
  const a = g.details['p:192.168.1.40'].actions!.find((x) => x.module === 'ran');
  assert.deepEqual([a?.action, a?.input], ['lire', { ip: '192.168.1.40' }], 'la fiche du poste ouvre ses paquets dans Rán');
};
const sondes = (w: World) => (w.v.ctx('vordr').settings.monitors as Array<{ name: string; kind: string; target: string; source?: string }> | undefined) ?? [];
CHECKS['vidarr>vordr'] = async (w) => {
  await w.v.act('vordr', 'liens');
  assert.ok(sondes(w).some((m) => m.kind === 'odin' && m.target === 'vidarr' && m.source === 'Víðarr'));
  assert.match((await w.v.act('vordr', 'verifier', { nom: 'DNS d\'Odin' })).text, /❌ DNS d'Odin : le DNS d'Odin est arrêté/);
  await dnsUp(w);
  try { assert.match((await w.v.act('vordr', 'verifier', { nom: 'DNS d\'Odin' })).text, /✅ DNS d'Odin : DNS d'Odin en marche/); } finally { await w.v.act('vidarr', 'arreter'); }
};
CHECKS['gjoll>vordr'] = async (w) => {
  await w.v.act('vordr', 'liens');
  assert.ok(sondes(w).some((m) => m.kind === 'odin' && m.target === 'gjoll' && m.source === 'Gjöll'));
  assert.match((await w.v.act('vordr', 'verifier', { nom: 'VPN d\'Odin' })).text, /❌ VPN d'Odin : le tunnel VPN est éteint/);
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
  // Un site web n'a qu'un témoin (Idunn) : son DNS qui change ne dit rien seul ; avec sa page d'accueil qui change aussi, c'est un incident.
  idunn: { alone: ['dns_change', { site: 'boutique' }], with: ['idunn', 'titre_change', { site: 'boutique' }], kind: 'site détourné' },
  // Une machine de la maison qui demande un site dangereux ET tombe dans un piège : elle est sans doute infectée.
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
  // Un bannissement est une réponse, pas un témoin : il ne crée pas d'incident à lui seul, mais Ullr le sait (pas de double bannissement).
  w.v.ctx('garmr').emit('banni', { ip: '203.0.113.66', raison: 'essai', minutes: 60, source: 'toi' });
  w.v.ctx('skogul').emit('suspect', { règle: 'mineur', pid: 4242, détail: '/tmp/.x/mineur' });
  w.v.ctx('geri').emit('malveillant', { ip: '203.0.113.66', programme: 'mineur' });
  assert.ok(await until(() => incidents(w).length === 1));
  await wait(80);
  assert.ok(incidents(w)[0].apps.includes('Garmr')); assert.deepEqual(incidents(w)[0].done, [], 'adresse déjà bannie : Ullr ne la bannit pas une seconde fois');
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
  assert.match(readFileSync(note, 'utf8'), /#sécurité #incident[\s\S]*Score de risque : \d+\/100 \(critique\)[\s\S]*\[\[Ullr\]\]/);
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

/** Idunn → Forseti : un site qui ne répond pas deux fois de suite, c'est une alerte critique dans le fil commun et sur ta messagerie. */
CHECKS['idunn>forseti'] = async (w) => {
  await w.v.act('idunn', 'ajouter', { adresse: 'http://boutique.exemple', nom: 'boutique' });
  assert.ok(!w.v.alerts({ module: 'idunn' }).length, 'un seul essai raté : pas encore une panne');
  await w.v.act('idunn', 'etat', { site: 'boutique' });
  assert.match((await w.v.act('forseti', 'alertes', { gravite: 'info' })).text, /boutique : le site ne répond plus/, 'visible dans le fil commun de Forseti');
  assert.ok(await until(() => w.sent.some((s) => s.includes('boutique : le site ne répond plus'))), 'envoyée sur ta messagerie');
};
/** Idunn se surveille : chaque mise en production est essayée ; un essai raté propose le retour en arrière, sans jamais le lancer. */
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
