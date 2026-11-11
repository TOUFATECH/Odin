// Les liens entre les applis d'Odin : chaque lien annoncé est automatique ET vérifié ici (on déclenche
// la première appli, on regarde ce que fait la seconde). Un lien ajouté à la liste sans sa vérification
// fait échouer le test : la liste ne peut pas promettre plus que le code.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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
    w.v.ctx('appareils').saveSettings({ devices: { l1: { id: 'l1', name: 'Lampe salon', kind: 'light', room: 'Salon', network: 'MQTT', state: 'ON', stateTopic: 'a/b', commandTopic: 'a/c' } } });
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
/** Liens « donnée » vers Forseti : l'alerte d'une appli rejoint le fil commun et part sur ta messagerie. */
for (const from of ['ullr', 'sindri', 'eir', 'naglfar', 'ymir', 'hermod']) CHECKS[`${from}>forseti`] = async (w) => {
  w.v.alert(from, { level: 'haute', title: `Alerte de test ${from}`, detail: 'détail', key: `t:${from}` });
  assert.match((await w.v.act('forseti', 'alertes', { gravite: 'info' })).text, new RegExp(`Alerte de test ${from}`), 'visible dans le fil commun de Forseti');
  assert.ok(await until(() => w.sent.some((s) => s.includes(`Alerte de test ${from}`))), 'envoyée sur ta messagerie');
};

test('tous les liens entre applis sont automatiques, et chacun a sa vérification', () => {
  assert.ok(LINKS.length >= 23);
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
