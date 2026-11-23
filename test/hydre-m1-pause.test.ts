// Hydre, lot M1 (maquette « Arche et Hydre » validée le 23/11) : mettre en pause et reprendre une machine virtuelle.
// AUCUNE vraie VM n'est lancée : le canal de contrôle QMP est un faux (il répond comme QEMU à « stop », « cont » et
// « query-status »), le processus de la VM est simulé, et le serveur de virtualisation relié est une fausse interface.
// - le protocole QMP d'Odin (salut, « qmp_capabilities », puis la commande) contre un faux QEMU qui écoute vraiment ;
// - VM de ce PC : pause puis reprise, l'état « en pause » gardé et relu (un nouvel Odin le voit), pause d'une VM
//   éteinte refusée, arrêt d'une VM en pause (elle repart d'abord pour lire le bouton d'arrêt) ;
// - VM d'un serveur relié : suspend puis resume, état gardé, une VM éteinte refusée ;
// - propriétaire seul : membre, tablette « maison », clé d'API, automatisation refusés ; chaque essai noté dans
//   « qui a fait quoi » ; la parole « mets en pause la VM … » arrive sur la même action ;
// - Windows : refusé proprement, avec la raison ; « vm-pause » n'est plus dans ce qu'Odin ne sait pas faire.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer as serveurHttp } from 'node:http';
import { createServer, type Socket } from 'node:net';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Local, qmp, systemeVm, type Machine } from '../src/valhalla/ymir/local.ts';
import { pve } from '../src/valhalla/modules/ymir.ts';
import { Valhalla } from '../src/valhalla/service.ts';
import { allModules, moduleDep, setValhalla } from '../src/valhalla/odin.ts';
import { serverHandle } from '../src/valhalla/mcp.ts';
import { valhallaTool } from '../src/tools/valhalla.ts';
import { DEFAULT_CONFIG } from '../src/config.ts';
import { valhallaPost } from '../src/web/valhalla-api.ts';
import { maisonRoute } from '../src/web/maison-api.ts';
import { resetGladsheim } from '../src/valhalla/modules/gladsheim.ts';
import { pasEncore, PAS_ENCORE } from '../src/core/offline.ts';

const dossiers: string[] = [];
const neuf = (p: string) => { const d = mkdtempSync(join(tmpdir(), p)); dossiers.push(d); return d; };
const origine = { ...systemeVm }, apiOrigine = pve.api;
after(() => { Object.assign(systemeVm, origine); pve.api = apiOrigine; for (const d of dossiers) rmSync(d, { recursive: true, force: true }); });

/** Un faux QEMU : il tient l'état de la VM (en marche ou figée) et note chaque commande QMP reçue. */
function fauxQemu() {
  const f = { enMarche: true, vivant: true, commandes: [] as string[] };
  systemeVm.plateforme = () => 'linux';
  systemeVm.enVie = () => f.vivant;
  systemeVm.qmp = async (_sock: string, execute: string) => {
    f.commandes.push(execute);
    if (!f.vivant) throw new Error('la VM ne répond pas (QMP)');
    if (execute === 'stop') { f.enMarche = false; return {}; }
    if (execute === 'cont') { f.enMarche = true; return {}; }
    if (execute === 'query-status') return { running: f.enMarche, status: f.enMarche ? 'running' : 'paused' };
    if (execute === 'system_powerdown' || execute === 'quit') { if (execute === 'quit' || f.enMarche) f.vivant = false; return {}; }
    throw new Error(`commande QMP inattendue : ${execute}`);
  };
  return f;
}

const VM = (o: Partial<Machine> = {}): Machine => ({ id: 'b1c2d3e4f5a6', nom: 'debian-13-20261123-web', genre: 'vm', systeme: 'Debian', version: '13', famille: 'Linux', cpu: 2, ram: 2048, disque: 32, ip: '10.0.3.70', mac: '02:0d:1e:00:00:07', cree: 0, apps: [], paquets: [], ...o });

/** Un Odin d'essai (aucune commande système, aucune sortie réseau) avec une VM de ce PC déjà créée (« allumée »). */
function monde(home = neuf('hydre-m1-')) {
  const sock = join(home, 'qmp'); mkdirSync(sock, { recursive: true, mode: 0o700 });
  systemeVm.dossiersQmp = () => [sock];
  const v = new Valhalla(home, allModules({ paths: { home, workspace: home }, cfg: DEFAULT_CONFIG } as never), {
    run: async () => ({ code: 1, out: '', err: 'essai : aucune commande' }),
    fetch: (async () => { throw new Error('essai : aucune sortie réseau'); }) as never, notify: async () => {}, autonomy: () => 'equilibre',
  });
  const d = join(home, 'valhalla', 'ymir', 'machines'); mkdirSync(join(d, 'vm', VM().nom), { recursive: true });
  if (!dossiersPrets.has(home)) { writeFileSync(join(d, 'machines.json'), JSON.stringify([VM(), VM({ id: 'c0ffee000001', nom: 'debian-13-20261123-lxc', genre: 'lxc', ip: '10.0.3.71' })])); writeFileSync(join(d, 'vm', VM().nom, 'pid'), '4242'); writeFileSync(join(sock, `${VM().id}.qmp`), ''); dossiersPrets.add(home); }
  return { v, home, fin: () => v.stop() };
}
const dossiersPrets = new Set<string>();
const etatDe = async (v: Valhalla, nom: string) => ((await v.act('ymir', 'tableau_machines')).data as { machines: Array<{ nom: string; etat: { state: string } }> }).machines.find((m) => m.nom === nom)?.etat.state;

test('QMP : Odin salue QEMU (« qmp_capabilities »), puis envoie « stop » et lit la réponse', async () => {
  const recu: string[] = [];
  const srv = createServer((c: Socket) => {
    c.write(`${JSON.stringify({ QMP: { version: { qemu: { major: 9 } }, capabilities: [] } })}\n`);
    let buf = '';
    c.on('data', (d) => { buf += d.toString(); let i; while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 1); const m = JSON.parse(l) as { execute: string }; recu.push(m.execute); c.write(`${JSON.stringify(m.execute === 'query-status' ? { return: { running: false, status: 'paused' } } : { return: {} })}\n`); } });
  });
  const chemin = process.platform === 'win32' ? `\\\\.\\pipe\\odin-essai-qmp-${process.pid}-${Date.now()}` : join(neuf('hydre-m1-qmp-'), 'q.sock');
  await new Promise<void>((ok) => srv.listen(chemin, () => ok()));
  try {
    assert.deepEqual(await qmp(chemin, 'stop'), {});
    assert.deepEqual(await qmp(chemin, 'query-status'), { running: false, status: 'paused' });
    assert.deepEqual(recu, ['qmp_capabilities', 'stop', 'qmp_capabilities', 'query-status']);
  } finally { await new Promise((ok) => srv.close(ok)); }
});

test('VM de ce PC : pause puis reprise par QMP, état « en pause » gardé et relu par un nouvel Odin', async () => {
  const f = fauxQemu(), w = monde(), nom = VM().nom;
  try {
    assert.equal(await etatDe(w.v, nom), 'en marche');
    const p = await w.v.act('ymir', 'pause_machine', { machine: nom });
    assert.equal(p.ok, true, p.text); assert.match(p.text, /⏸ debian-13-20261123-web en pause/);
    assert.deepEqual(f.commandes, ['stop', 'query-status']); assert.equal(f.enMarche, false);
    assert.equal(await etatDe(w.v, nom), 'en pause');
    assert.match((await w.v.act('ymir', 'locales')).text, /debian-13-20261123-web .*· en pause ·/);
    assert.match((await w.v.act('ymir', 'pause_machine', { machine: nom })).text, /déjà en pause/);
  } finally { w.fin(); }
  // Un nouvel Odin (redémarrage) : l'état est relu, la VM est toujours en pause.
  const w2 = monde(w.home);
  try {
    assert.equal(await etatDe(w2.v, nom), 'en pause', 'gardé et relu');
    assert.match((await w2.v.act('ymir', 'demarrer_machine', { machine: nom })).text, /est en pause : reprends-la/, 'pas une deuxième VM sur le même disque');
    assert.match((await w2.v.act('ymir', 'disque_machine', { machine: nom, disque: 64 }, {})).text, /arrête d'abord/, 'une VM en pause compte comme allumée');
    const r = await w2.v.act('ymir', 'reprendre_machine', { machine: nom });
    assert.equal(r.ok, true, r.text); assert.match(r.text, /▶ debian-13-20261123-web reprend où elle en était/);
    assert.deepEqual(f.commandes.slice(-2), ['cont', 'query-status'], 'cont, puis vérification'); assert.equal(f.enMarche, true);
    assert.equal(await etatDe(w2.v, nom), 'en marche');
    assert.match((await w2.v.act('ymir', 'reprendre_machine', { machine: nom })).text, /n'est pas en pause/);
    // « qui a fait quoi » : la pause et la reprise, au nom du propriétaire, sans rien de secret.
    const j = await w2.v.act('ymir', 'qui_a_fait');
    assert.match(j.text, /propriétaire · Reprendre \(machine : debian-13-20261123-web\) · fait/);
    assert.match(j.text, /propriétaire · Mettre en pause \(machine : debian-13-20261123-web\) · fait/);
    // Arrêter une VM en pause : elle repart d'abord (une VM figée ne lit pas le bouton d'arrêt), puis s'éteint.
    await w2.v.act('ymir', 'pause_machine', { machine: nom }); f.commandes.length = 0;
    assert.equal((await w2.v.act('ymir', 'arreter_machine', { machine: nom })).ok, true);
    assert.deepEqual(f.commandes, ['cont', 'system_powerdown']); assert.equal(f.vivant, false);
    assert.equal(await etatDe(w2.v, nom), 'éteinte');
  } finally { w2.fin(); }
});

test('pause refusée : VM éteinte, LXC, machine inconnue ; reprise d\'une VM éteinte refusée', async () => {
  const f = fauxQemu(), w = monde(); f.vivant = false;
  try {
    const p = await w.v.act('ymir', 'pause_machine', { machine: VM().nom });
    assert.equal(p.ok, false); assert.match(p.text, /est éteinte : rien à mettre en pause/);
    assert.match((await w.v.act('ymir', 'reprendre_machine', { machine: VM().nom })).text, /est éteinte : démarre-la plutôt/);
    assert.deepEqual(f.commandes, [], 'aucune commande envoyée à une VM éteinte');
    assert.match((await w.v.act('ymir', 'pause_machine', { machine: 'debian-13-20261123-lxc' })).text, /est un LXC/);
    assert.match((await w.v.act('ymir', 'pause_machine', { machine: 'aucune-machine' })).text, /machine introuvable/);
    assert.match((await w.v.act('ymir', 'qui_a_fait')).text, /Mettre en pause .* · pas fait : .*éteinte/, 'un refus est noté aussi');
  } finally { w.fin(); }
});

test('Windows : la pause d\'une VM de ce PC est refusée proprement, avec la raison', async () => {
  const f = fauxQemu(), w = monde(); systemeVm.plateforme = () => 'win32';
  try {
    const p = await w.v.act('ymir', 'pause_machine', { machine: VM().nom });
    assert.equal(p.ok, false); assert.match(p.text, /Sous Windows, les VM de ce PC ne tournent pas encore dans Hydre/); assert.match(p.text, /serveurs de virtualisation reliés/);
    assert.match((await w.v.act('ymir', 'reprendre_machine', { machine: VM().nom })).text, /Sous Windows/);
    assert.deepEqual(f.commandes, []);
  } finally { w.fin(); }
});

test('propriétaire seul : membre, tablette « maison », clé d\'API, automatisation refusés ; la parole passe par la même action', async () => {
  const f = fauxQemu(), w = monde(), nom = VM().nom;
  setValhalla(w.v); resetGladsheim();
  const srv = serveurHttp((req, res) => { void maisonRoute(req, res, new URL(req.url!, 'http://x'), { authed: false, name: '', mascot: '<svg></svg>', fail: () => {}, ask: async () => '' }).then((fait) => { if (!fait) { res.writeHead(404); res.end(); } }); });
  try {
    for (const id of ['pause_machine', 'reprendre_machine']) assert.equal(w.v.action('ymir', id)?.a.proprietaireSeul, true, id);
    const refus = /seul le propriétaire/;
    assert.match((await w.v.act('ymir', 'pause_machine', { machine: nom }, { qui: 'member' })).text, refus, 'un membre');
    assert.match((await w.v.act('ymir', 'pause_machine', { machine: nom }, { auto: true, by: 'automatisation' })).text, refus, 'une automatisation');
    assert.match((await w.v.act('ymir', 'pause_machine', { machine: nom }, { by: 'assistant', auto: true })).text, refus, 'un autre assistant');
    const cle = await valhallaPost('/api/valhalla/act', { module: 'ymir', action: 'pause_machine', input: { machine: nom }, confirm: true }) as { ok: boolean; text: string };
    assert.equal(cle.ok, false); assert.match(cle.text, /pas avec la clé d'API/, 'la clé d\'API');
    // Une tablette « maison » : un bouton vers l'action, sur l'écran de la maison.
    for (const action of ['pause_machine', 'reprendre_machine']) assert.notEqual((await w.v.act('gladsheim', 'bouton', { appli: 'ymir', action, reglages: `machine=${nom}`, nom: action })).ok, false);
    const tab = { 'x-odin-maison': ((await w.v.act('gladsheim', 'cle_tablette', { nom: 'Tablette', droits: 'maison' })).data as { key: string }).key, 'x-odin': '1', 'content-type': 'application/json' };
    await new Promise<void>((ok) => srv.listen(0, '127.0.0.1', () => ok()));
    const base = `http://127.0.0.1:${(srv.address() as { port: number }).port}`;
    const tuiles = (w.v.ctx('gladsheim').settings.tiles as Array<{ id: string; module: string; action: string }>).filter((t) => t.module === 'ymir');
    assert.equal(tuiles.length, 2);
    for (const t of tuiles) {
      const r = await (await fetch(`${base}/api/maison/bouton`, { method: 'POST', headers: tab, body: JSON.stringify({ id: t.id, confirm: true }) })).json() as { ok: boolean; text: string };
      assert.equal(r.ok, false, `tablette : ${t.action}`); assert.match(r.text, /droits « maison »/);
    }
    assert.deepEqual(f.commandes, [], 'aucun refusé n\'a touché la VM'); assert.equal(await etatDe(w.v, nom), 'en marche');
    // La parole : « mets en pause la VM … » arrive sur la même action (grave : Odin demande de confirmer, puis la fait).
    const q = await w.v.order(`mets en pause la vm ${nom}`);
    assert.equal(q.understood?.kind === 'action' && `${q.understood.module}.${q.understood.action}`, 'ymir.pause_machine'); assert.ok(q.confirm, 'confirmation demandée');
    const membre = await w.v.order(`mets en pause la vm ${nom}`, 'principal', { confirm: true, qui: 'member' });
    assert.equal(membre.ok, false); assert.match(membre.text, refus);
    const ok = await w.v.order(`mets en pause la vm ${nom}`, 'principal', { confirm: true });
    assert.equal(ok.ok, true, ok.text); assert.equal(await etatDe(w.v, nom), 'en pause');
    const rep = await w.v.order(`reprends la vm ${nom}`, 'principal', {});
    assert.equal(rep.ok, true, rep.text); assert.equal(await etatDe(w.v, nom), 'en marche');
  } finally { srv.close(); setValhalla(undefined); w.fin(); }
});

test('VM d\'un serveur relié : suspend puis resume par son interface, état gardé ; VM éteinte et conteneur refusés', async () => {
  fauxQemu();
  const w = monde(), appels: string[] = [];
  const res = [{ type: 'node', node: 'pve1', status: 'online', mem: 1, maxmem: 10 }, { type: 'qemu', node: 'pve1', vmid: 101, name: 'nas', status: 'running' }, { type: 'qemu', node: 'pve1', vmid: 102, name: 'jeux', status: 'stopped' }, { type: 'lxc', node: 'pve1', vmid: 103, name: 'dns', status: 'running' }];
  pve.api = (async (_u: string, _t: string, m: string, p: string) => { appels.push(`${m} ${p}`); return m === 'GET' ? res : 'UPID:pve1:0001:essai'; }) as typeof pve.api;
  w.v.ctx('ymir').saveSettings({ servers: [{ name: 'labo', url: 'https://pve.essai.invalid:8006', token: 'essai@pve!odin=jeton-essai' }] });
  try {
    const p = await w.v.act('ymir', 'pause_machine', { machine: '101' });
    assert.equal(p.ok, true, p.text); assert.match(p.text, /⏸ nas \(labo\) : mise en pause demandée/);
    assert.ok(appels.includes('POST /nodes/pve1/qemu/101/status/suspend'), appels.join('\n'));
    assert.match((await w.v.act('ymir', 'machines')).text, /101 nas .*· en pause ·/);
    assert.equal(((await w.v.act('ymir', 'parc')).data as { units: Array<{ name: string; state: string }> }).units.find((u) => u.name === 'nas')?.state, 'en pause');
    assert.match((await w.v.act('ymir', 'pause_machine', { machine: 'nas' })).text, /déjà en pause/);
    assert.deepEqual((w.v.ctx('ymir').settings.pauses as Array<{ server: string; vmid: number }>).map((x) => `${x.server}:${x.vmid}`), ['labo:101'], 'gardé dans les réglages d\'Hydre');
    const r = await w.v.act('ymir', 'reprendre_machine', { machine: 'nas' });
    assert.equal(r.ok, true, r.text); assert.match(r.text, /▶ nas \(labo\) : reprise demandée/); assert.ok(appels.includes('POST /nodes/pve1/qemu/101/status/resume'));
    assert.deepEqual(w.v.ctx('ymir').settings.pauses, []);
    assert.match((await w.v.act('ymir', 'pause_machine', { machine: '102' })).text, /jeux est éteinte/);
    assert.match((await w.v.act('ymir', 'pause_machine', { machine: '103' })).text, /dns est un conteneur/);
    assert.equal(appels.filter((x) => x.startsWith('POST')).length, 2, 'rien envoyé pour les refus');
    // Membre et clé d'API : refusés aussi pour un serveur relié.
    assert.match((await w.v.act('ymir', 'pause_machine', { machine: '101' }, { qui: 'member' })).text, /seul le propriétaire/);
  } finally { w.fin(); }
});

test('« vm-pause » n\'est plus dans ce qu\'Odin ne sait pas encore faire', () => {
  assert.ok(!PAS_ENCORE.some((x) => x.id === 'vm-pause'));
  for (const p of ['mets en pause la vm web', 'pause my vm', 'pon en pausa la máquina']) assert.notEqual(pasEncore(p)?.id, 'vm-pause', p);
});

// ---- Relecture du lot M1 (23/11) : chaque essai ci-dessous échouait avant sa correction. ----

test('relecture : la parole d\'une autre appli ne part jamais vers la pause ou la reprise, dans les quatre langues ; les phrases d\'une VM y arrivent', async () => {
  fauxQemu(); const w = monde();
  try {
    const vers = async (p: string) => { const q = await w.v.order(p); const u = q.understood as { kind?: string; module?: string; action?: string } | undefined; return u?.kind === 'action' ? `${u.module}.${u.action}` : (u?.kind ?? '-'); };
    const PAUSE = /^ymir\.(?:pause_machine|reprendre_machine)$/, HYDRE_GRAVE = /^ymir\.(?!machines$|parc$|locales$)/;
    for (const p of ['reprends la lecture', 'reprends le film', 'reprends la musique', 'reprends la série', 'reprends le travail', 'mettre en pause la lecture', 'mettre en pause le film', 'mettre en pause mon abonnement',
      'mets en pause la musique', 'mets la musique en pause', 'mets en pause les notifications', 'mets en pause la machine à laver', 'reprends la machine à laver', 'mets la machine à laver en pause', 'sors de pause', 'suspends la lecture',
      'resume playback', 'resume the movie', 'pause the music', 'pause the music on the tv', 'reanuda la reproducción', 'reanuda la película', 'pon en pausa la música', 'pausa la música',
      'setze die wiedergabe fort', 'setze den film fort', 'pausiere die musik', 'pausiere den film', 'halte die musik an']) {
      const a = await vers(p); assert.doesNotMatch(a, PAUSE, p); assert.doesNotMatch(a, HYDRE_GRAVE, p);
    }
    for (const [p, a] of [['mets en pause la vm web', 'pause_machine'], ['mettre en pause la vm web', 'pause_machine'], ['reprends la vm web', 'reprendre_machine'],
      ['pause my vm web', 'pause_machine'], ['resume the vm web', 'reprendre_machine'], ['unpause the vm web', 'reprendre_machine'],
      ['pon en pausa la vm web', 'pause_machine'], ['reanuda la vm web', 'reprendre_machine'], ['pausiere die vm web', 'pause_machine']] as const) assert.equal(await vers(p), `ymir.${a}`, p);
  } finally { w.fin(); }
});

test('relecture : la confirmation nomme la VM (pas son identifiant interne)', () => {
  fauxQemu(); const w = monde();
  try {
    const why = w.v.action('ymir', 'pause_machine')?.a.grave?.({ machine: VM().id }, w.v.ctx('ymir')) ?? '';
    assert.match(why, /debian-13-20261123-web/); assert.doesNotMatch(why, /b1c2d3e4f5a6/);
  } finally { w.fin(); }
});

test('relecture : canal QMP perdu juste après « stop » — la VM est vue en pause et « Reprendre » la relance ; « Arrêter » relance d\'abord une VM figée sans marque', async () => {
  const f = fauxQemu(), w = monde(), nom = VM().nom, qmpDe = systemeVm.qmp;
  try {
    let coupe = true;
    systemeVm.qmp = async (s: string, ex: string, a?: Record<string, unknown>) => { if (ex === 'query-status' && coupe) { f.commandes.push(ex); throw new Error('canal fermé'); } return qmpDe(s, ex, a); };
    const p = await w.v.act('ymir', 'pause_machine', { machine: nom });
    assert.equal(p.ok, false); assert.match(p.text, /pause demandée/); assert.equal(f.enMarche, false, 'la VM est bien figée');
    assert.equal(await etatDe(w.v, nom), 'en pause', 'figée : vue en pause (le bouton « Reprendre » est là)');
    coupe = false;
    const r = await w.v.act('ymir', 'reprendre_machine', { machine: nom });
    assert.equal(r.ok, true, r.text); assert.equal(f.enMarche, true); assert.equal(await etatDe(w.v, nom), 'en marche');
    // Figée par ailleurs (aucune marque chez Odin) : l'arrêt propre la relance d'abord, sinon elle ignorerait le bouton d'arrêt.
    systemeVm.qmp = qmpDe; f.enMarche = false; f.commandes.length = 0;
    assert.equal((await w.v.act('ymir', 'arreter_machine', { machine: nom })).ok, true);
    assert.deepEqual(f.commandes, ['cont', 'system_powerdown']); assert.equal(f.vivant, false, 'éteinte, pas figée pour toujours');
  } finally { w.fin(); }
});

test('relecture : le dossier du canal QMP n\'est pris que s\'il est à Odin seul', () => {
  fauxQemu(); const w = monde(), sv = systemeVm as unknown as { uid?: () => number | undefined }, uid = sv.uid;
  try {
    const L = new Local(w.v.ctx('ymir'));
    assert.match(L.qmpSock(VM()), /qmp[\\/]b1c2d3e4f5a6\.qmp$/, 'le dossier d\'essai (à Odin) est pris');
    // Un dossier qui appartient à un autre compte (ou ouvert aux autres) : jamais pris, le socket reste dans le dossier de la VM.
    sv.uid = () => 4242;
    assert.equal(L.qmpSock(VM()), join(L.vmDir(VM()), 'qmp.sock'));
  } finally { sv.uid = uid; w.fin(); }
});

test('relecture : serveur relié — l\'état réel prime sur la marque gardée, la bonne machine est visée, un numéro porté par deux serveurs est refusé', async () => {
  fauxQemu();
  const w = monde(), appels: string[] = [], reel: Record<string, string> = { 'pve1:101': 'paused', 'pve2:101': 'running', 'pve1:105': 'running' };
  let res: Array<Record<string, unknown>> = [{ type: 'qemu', node: 'pve1', vmid: 101, name: 'nas', status: 'running' }, { type: 'qemu', node: 'pve1', vmid: 105, name: 'jeux', status: 'running' }];
  pve.api = (async (u: string, _t: string, m: string, p: string) => {
    appels.push(`${u} ${m} ${p}`);
    if (p === '/cluster/resources') return res.filter((r) => (r.node === 'pve2') === u.includes('atelier'));
    const st = /\/nodes\/(\w+)\/qemu\/(\d+)\/status\/current$/.exec(p); if (st) return { status: 'running', qmpstatus: reel[`${st[1]}:${st[2]}`] };
    return 'UPID:essai';
  }) as typeof pve.api;
  const cx = w.v.ctx('ymir'); cx.saveSettings({ servers: [{ name: 'labo', url: 'https://labo.essai.invalid:8006', token: 'essai@pve!odin=jeton-essai' }] });
  try {
    // Figée sur son serveur, sans marque chez Odin (réglages perdus, coupure, pause faite ailleurs) : la reprise passe.
    const r = await w.v.act('ymir', 'reprendre_machine', { machine: 'nas' });
    assert.equal(r.ok, true, r.text); assert.ok(appels.some((x) => x.endsWith('POST /nodes/pve1/qemu/101/status/resume')));
    // Marque gardée mais la VM tourne (reprise faite ailleurs) : la pause passe quand même.
    cx.saveSettings({ pauses: [{ server: 'labo', vmid: 105, depuis: 0 }] });
    const p = await w.v.act('ymir', 'pause_machine', { machine: 'jeux' });
    assert.equal(p.ok, true, p.text); assert.ok(appels.some((x) => x.endsWith('POST /nodes/pve1/qemu/105/status/suspend')));
    // Deux serveurs portent le n° 101 : aucune des deux n'est touchée.
    res = [...res, { type: 'qemu', node: 'pve2', vmid: 101, name: 'nas', status: 'running' }];
    cx.saveSettings({ servers: [...(cx.settings.servers as unknown[]), { name: 'atelier', url: 'https://atelier.essai.invalid:8006', token: 'essai@pve!odin=jeton-essai-2' }] });
    appels.length = 0;
    const d = await w.v.act('ymir', 'reprendre_machine', { machine: '101' });
    assert.equal(d.ok, false); assert.match(d.text, /plusieurs machines/); assert.equal(appels.filter((x) => x.includes(' POST ')).length, 0, 'rien envoyé');
    // Le journal ne garde jamais le jeton d'un serveur.
    const j = await w.v.act('ymir', 'qui_a_fait');
    assert.doesNotMatch(JSON.stringify(j.data ?? '') + j.text, /jeton-essai/);
  } finally { w.fin(); }
});

test('relecture : l\'outil de l\'IA (membre sur Telegram, conversation marquée), un autre assistant (MCP), Talos et un lien entre applis sont refusés', async () => {
  const f = fauxQemu(), w = monde(), nom = VM().nom; setValhalla(w.v);
  try {
    const passe: string[] = [], REFUS = /seul le propriétaire/;
    for (const id of ['pause_machine', 'reprendre_machine']) {
      for (const [qui, role, marque] of [['membre (Telegram)', 'member', false], ['conversation marquée', 'owner', true]] as const) {
        const t = String(await valhallaTool.run({ action: 'action', appli: 'ymir', quoi: id, entree: { machine: nom } }, { auteur: { role }, isTainted: () => marque, sessionId: 'telegram:essai' } as never));
        if (!REFUS.test(t)) passe.push(`outil de l'IA, ${qui} · ${id} : ${t.slice(0, 80)}`);
      }
      const mcp = await serverHandle(w.v, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'odin_ymir', arguments: { action: id, entree: { machine: nom } } } } as never, () => '') as { result?: { content: Array<{ text: string }> } };
      if (!REFUS.test(mcp.result?.content[0]?.text ?? '')) passe.push(`MCP · ${id}`);
      const d = await moduleDep('ymir', id, { machine: nom }); if (!REFUS.test(d.text)) passe.push(`Talos · ${id} : ${d.text.slice(0, 80)}`);
      const l = await w.v.ctx('vidarr').call('ymir', id, { machine: nom }, 'lien d\'essai'); if (!REFUS.test(l.text)) passe.push(`lien entre applis · ${id} : ${l.text.slice(0, 80)}`);
    }
    assert.deepEqual(passe, []); assert.deepEqual(f.commandes, [], 'la VM n\'a rien reçu');
  } finally { setValhalla(undefined); w.fin(); }
});
