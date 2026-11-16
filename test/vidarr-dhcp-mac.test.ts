// Sphinx — contrôle d'accès du DHCP par adresse MAC (ouvert / liste d'autorisation, pause, blocage), récap par
// machine (bail + sites visités), et historique durable relié DHCP ↔ DNS (quelle machine tenait une IP à quel moment).
// Aucun vrai réseau : faux paquets DHCP construits/parsés en mémoire, base absente (repli fichier), comme les essais existants.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import dgram from 'node:dgram';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DhcpServer, MSG, buildPacket, parsePacket, macDecision, randomMac, type DhcpConfig, type Lease, type MacPolicy } from '../src/valhalla/vidarr/dhcp.ts';
import { machineAt, filtrerPeriode, requetesDeMachine, resumerRequetes, noterRequete, noterBail, histTout, type EvtBail, type EvtDns } from '../src/valhalla/vidarr/historique-base.ts';
import { Valhalla } from '../src/valhalla/service.ts';
import { allModules } from '../src/valhalla/odin.ts';
import { vidarr } from '../src/valhalla/modules/vidarr.ts';
import { DEFAULT_CONFIG } from '../src/config.ts';
import type { ModCtx } from '../src/valhalla/types.ts';
import type { LogEntry } from '../src/valhalla/vidarr/server.ts';

const ip4 = (s: string) => Buffer.from(s.split('.').map(Number));

/** Un appareil DHCP simulé (ports de test, réponses ramenées en direct sur 127.0.0.1). */
async function device(serverPort: number) {
  const s = dgram.createSocket({ type: 'udp4', reuseAddr: true }), inbox: ReturnType<typeof parsePacket>[] = [];
  s.on('message', (m) => inbox.push(parsePacket(m)));
  await new Promise<void>((ok) => s.bind(0, '127.0.0.1', () => ok()));
  const port = (s.address() as { port: number }).port;
  const send = async (mac: string, type: number, opts: Array<[number, Buffer]> = [], ciaddr = '0.0.0.0') => {
    const xid = Math.floor(Math.random() * 1e9), before = inbox.length;
    s.send(buildPacket({ op: 1, xid, mac, ciaddr, options: [[53, Buffer.from([type])], ...opts] }), serverPort, '127.0.0.1');
    const until = Date.now() + 700;
    while (Date.now() < until) { const r = inbox.slice(before).find((p) => p.xid === xid); if (r) return r; await new Promise((ok) => setTimeout(ok, 10)); }
    return undefined;
  };
  return { port, send, close: () => s.close() };
}

test('macDecision : ouvert, pause, bloqué, liste d\'autorisation, adresse fixe', () => {
  const ouvert: MacPolicy = { mode: 'ouvert', etats: {}, attente: [] };
  assert.equal(macDecision(undefined, '02:00:00:00:00:01', false), 'ok', 'sans politique : tout passe');
  assert.equal(macDecision(ouvert, '02:00:00:00:00:01', false), 'ok', 'ouvert : inconnu passe');
  assert.equal(macDecision({ ...ouvert, etats: { '02:00:00:00:00:01': 'pause' } }, '02:00:00:00:00:01', false), 'pause');
  assert.equal(macDecision({ ...ouvert, etats: { '02:00:00:00:00:01': 'bloque' } }, '02:00:00:00:00:01', false), 'bloque');
  const liste: MacPolicy = { mode: 'liste', etats: {}, attente: [] };
  assert.equal(macDecision(liste, '02:00:00:00:00:02', false), 'attente', 'liste : inconnu en attente');
  assert.equal(macDecision(liste, '02:00:00:00:00:02', true), 'ok', 'liste : adresse fixe passe toujours');
  assert.equal(macDecision({ ...liste, etats: { '02:00:00:00:00:02': 'actif' } }, '02:00:00:00:00:02', false), 'ok', 'liste : approuvé passe');
  assert.equal(macDecision({ ...liste, etats: { '02:00:00:00:00:02': 'bloque' } }, '02:00:00:00:00:02', true), 'bloque', 'bloqué prime même sur une adresse fixe');
  assert.equal(randomMac('02:aa:bb:cc:dd:ee'), true); assert.equal(randomMac('a4:aa:bb:cc:dd:ee'), false);
});

test('DHCP : MAC bloquée → aucune réponse ; en pause → NAK au REQUEST et pas d\'OFFER ; liste → inconnue ignorée + en attente, puis approuvée → bail', async () => {
  let leases: Lease[] = []; const pending: string[] = [];
  const cfg: DhcpConfig = { server: '127.0.0.1', start: '192.168.60.100', end: '192.168.60.110', mask: '255.255.255.0', router: '192.168.60.1', dns: ['192.168.60.2'], leaseSeconds: 3600, domain: 'maison', fixed: [], macPolicy: { mode: 'ouvert', etats: {}, attente: [] } };
  const srv = new DhcpServer({ config: () => cfg, leases: () => leases, save: (l) => { leases = l; }, onPending: (mac) => { if (!pending.includes(mac)) pending.push(mac); } });
  const dev0 = await device(0); await srv.start(0, dev0.port, '127.0.0.1');
  const sp = (srv.sock!.address() as { port: number }).port; const dev = await device(sp); dev0.close(); srv.clientPort = dev.port;
  (srv as unknown as { sock: dgram.Socket }).sock.send = ((orig) => function (this: dgram.Socket, b: Buffer, p: number, _h: string) { return (orig as (...a: unknown[]) => unknown).call(this, b, p, '127.0.0.1'); })(srv.sock!.send) as never;
  try {
    const bloque = '02:00:00:00:00:0b';
    // Mode ouvert mais MAC bloquée : ni OFFER ni ACK, rien ne revient.
    cfg.macPolicy = { mode: 'ouvert', etats: { [bloque]: 'bloque' }, attente: [] };
    assert.equal(await dev.send(bloque, MSG.DISCOVER), undefined, 'bloqué : pas d\'OFFER');
    assert.equal(await dev.send(bloque, MSG.REQUEST, [[50, ip4('192.168.60.100')]]), undefined, 'bloqué : pas de réponse au REQUEST');
    assert.equal(leases.length, 0, 'bloqué : aucun bail');
    // En pause : pas d'OFFER, et NAK au REQUEST (pour qu'il tombe vite).
    const pause = '02:00:00:00:00:0c';
    cfg.macPolicy = { mode: 'ouvert', etats: { [pause]: 'pause' }, attente: [] };
    assert.equal(await dev.send(pause, MSG.DISCOVER), undefined, 'en pause : pas d\'OFFER');
    assert.equal((await dev.send(pause, MSG.REQUEST, [[50, ip4('192.168.60.100')]]))?.options.get(53)?.[0], MSG.NAK, 'en pause : NAK');
    // Liste d'autorisation : une MAC inconnue est ignorée et notée en attente.
    const inconnue = '02:00:00:00:00:0d';
    cfg.macPolicy = { mode: 'liste', etats: {}, attente: [] };
    assert.equal(await dev.send(inconnue, MSG.DISCOVER), undefined, 'liste : inconnue ignorée');
    assert.deepEqual(pending, [inconnue], 'liste : inconnue mise en attente d\'approbation');
    // Une fois approuvée (état actif), elle reçoit un OFFER puis un bail.
    cfg.macPolicy = { mode: 'liste', etats: { [inconnue]: 'actif' }, attente: [] };
    const offer = await dev.send(inconnue, MSG.DISCOVER); assert.equal(offer?.options.get(53)?.[0], MSG.OFFER, 'approuvée : OFFER');
    const ack = await dev.send(inconnue, MSG.REQUEST, [[50, ip4(offer!.yiaddr)]]); assert.equal(ack?.options.get(53)?.[0], MSG.ACK, 'approuvée : ACK');
    assert.equal(leases.find((l) => l.mac === inconnue)?.ip, offer!.yiaddr, 'approuvée : bail enregistré');
  } finally { srv.stop(); dev.close(); }
});

test('historique : une requête DNS est reliée à la BONNE machine selon l\'heure du bail (IP réattribuée)', () => {
  const T = 1_700_000_000_000;
  // L'IP .50 est à MAC-A à T, puis redonnée à MAC-B à T+10 min.
  const baux: EvtBail[] = [
    { k: 'bail', t: T, mac: 'aa:aa:aa:aa:aa:aa', ip: '192.168.1.50', nom: 'PC d\'Awa', action: 'donne' },
    { k: 'bail', t: T + 600_000, mac: 'bb:bb:bb:bb:bb:bb', ip: '192.168.1.50', nom: 'Tablette d\'Ali', action: 'donne' },
  ];
  assert.equal(machineAt(baux, '192.168.1.50', T + 60_000)?.mac, 'aa:aa:aa:aa:aa:aa', 'à T+1min : MAC-A');
  assert.equal(machineAt(baux, '192.168.1.50', T + 700_000)?.mac, 'bb:bb:bb:bb:bb:bb', 'à T+11min : MAC-B');
  assert.equal(machineAt(baux, '192.168.1.50', T - 1)?.mac, undefined, 'avant tout bail : inconnu');
  const dns: EvtDns[] = [
    { k: 'dns', t: T + 60_000, ip: '192.168.1.50', nom: 'awa-site.fr', statut: 'ok' },
    { k: 'dns', t: T + 700_000, ip: '192.168.1.50', nom: 'ali-jeux.fr', statut: 'ok' },
  ];
  const now = T + 800_000;
  const aA = requetesDeMachine(dns, baux, 'aa:aa:aa:aa:aa:aa', 'jour', now).map((e) => e.nom);
  const aB = requetesDeMachine(dns, baux, 'bb:bb:bb:bb:bb:bb', 'jour', now).map((e) => e.nom);
  assert.deepEqual(aA, ['awa-site.fr'], 'la requête de T+1min va à MAC-A, pas à MAC-B');
  assert.deepEqual(aB, ['ali-jeux.fr'], 'la requête de T+11min va à MAC-B');
});

test('historique : filtrage par période (heure / jour / semaine / mois / année)', () => {
  const now = 1_700_000_000_000;
  const quand = (x: { t: number }) => x.t;
  const items = [{ t: now - 30 * 60_000 }, { t: now - 5 * 86400_000 }, { t: now - 20 * 86400_000 }, { t: now - 200 * 86400_000 }];
  assert.equal(filtrerPeriode(items, quand, 'heure', now).length, 1);
  assert.equal(filtrerPeriode(items, quand, 'semaine', now).length, 2);
  assert.equal(filtrerPeriode(items, quand, 'mois', now).length, 3);
  assert.equal(filtrerPeriode(items, quand, 'annee', now).length, 4);
});

test('historique durable : rien perdu au redémarrage (relu depuis le repli fichier quand la base n\'est pas là)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'vidarr-hist-'));
  try {
    const ctx1 = { dir } as unknown as ModCtx;
    noterRequete(ctx1, { t: 1, client: '192.168.1.50', name: 'exemple.fr', type: 'A', status: 'ok', ms: 1, rcode: 'NOERROR' } as LogEntry);
    noterRequete(ctx1, { t: 2, client: '192.168.1.50', name: 'pub.fr', type: 'A', status: 'bloqué', list: 'Pubs et pisteurs', ms: 1, rcode: 'NOERROR' } as LogEntry);
    noterBail(ctx1, { t: 1, mac: 'aa:aa:aa:aa:aa:aa', ip: '192.168.1.50', nom: 'PC d\'Awa', action: 'donne' });
    // « Redémarrage » : un nouveau contexte (le cache par contexte est vidé) relit le fichier.
    const ctx2 = { dir } as unknown as ModCtx;
    const { dns, baux } = histTout(ctx2);
    assert.equal(dns.length, 2, 'les 2 requêtes DNS sont relues');
    assert.equal(baux.length, 1, 'l\'événement de bail est relu');
    const reqs = requetesDeMachine(dns, baux, 'aa:aa:aa:aa:aa:aa', 'annee', 2);
    const r = resumerRequetes(reqs);
    assert.equal(r.total, 2); assert.equal(r.bloquees, 1);
    assert.deepEqual(r.parListe, [['Pubs et pisteurs', 1]]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('appli Sphinx : modes et états DHCP par MAC, garde-fou passerelle, et récap d\'une machine (bail + sites + blocages)', async () => {
  const home = mkdtempSync(join(tmpdir(), 'vidarr-mac-'));
  const v = new Valhalla(home, allModules({ paths: { home, workspace: home }, cfg: DEFAULT_CONFIG } as never), {
    run: async () => ({ code: 0, out: '', err: '' }), fetch: (async () => new Response('')) as unknown as typeof fetch, notify: async () => {}, autonomy: () => 'equilibre',
  });
  const act = (a: string, i: Record<string, unknown> = {}) => v.act('vidarr', a, i);
  try {
    // Mode : liste d'autorisation.
    assert.match((await act('dhcp_mode', { mode: 'liste' })).text, /Liste d'autorisation/);
    assert.equal((v.ctx('vidarr').settings.macPolicy as MacPolicy).mode, 'liste');
    // Bloquer et mettre en pause.
    assert.match((await act('dhcp_mac_etat', { mac: 'AA-BB-CC-DD-EE-01', etat: 'bloque' })).text, /bloqué/);
    assert.match((await act('dhcp_mac_etat', { mac: 'aa:bb:cc:dd:ee:02', etat: 'pause' })).text, /pause/);
    const pol = v.ctx('vidarr').settings.macPolicy as MacPolicy;
    assert.equal(pol.etats['aa:bb:cc:dd:ee:01'], 'bloque'); assert.equal(pol.etats['aa:bb:cc:dd:ee:02'], 'pause');
    // Adresse MAC invalide refusée.
    assert.equal((await act('dhcp_mac_etat', { mac: 'pas-une-mac', etat: 'bloque' })).ok, false);
    // Garde-fou : on ne peut pas bloquer la passerelle (la box).
    await act('dhcp_reglages', { debut: '192.168.1.100', fin: '192.168.1.199', passerelle: '192.168.1.1' });
    v.ctx('vidarr').saveSettings({ leases: [{ mac: '00:11:22:33:44:55', ip: '192.168.1.1', name: 'Box', expires: Date.now() + 3600_000 }] });
    assert.equal((await act('dhcp_mac_etat', { mac: '00:11:22:33:44:55', etat: 'bloque' })).ok, false, 'la passerelle ne peut pas être bloquée');
    // Approuver un appareil en attente.
    v.ctx('vidarr').saveSettings({ macPolicy: { ...(v.ctx('vidarr').settings.macPolicy as MacPolicy), attente: ['02:aa:bb:cc:dd:ee'] } });
    assert.match((await act('dhcp_approuver', { mac: '02:aa:bb:cc:dd:ee', nom: 'Portable' })).text, /approuvé/);
    const pol2 = v.ctx('vidarr').settings.macPolicy as MacPolicy;
    assert.equal(pol2.etats['02:aa:bb:cc:dd:ee'], 'actif'); assert.equal(pol2.attente.includes('02:aa:bb:cc:dd:ee'), false);
    // Récap d'une machine : bail + sites visités + blocages réunis.
    const ctx = v.ctx('vidarr'), now = ctx.now().getTime();
    noterBail(ctx, { t: now - 60_000, mac: '02:11:22:33:44:55', ip: '192.168.1.80', nom: 'Téléphone d\'Awa', action: 'donne' });
    noterRequete(ctx, { t: now - 30_000, client: '192.168.1.80', name: 'exemple.fr', type: 'A', status: 'ok', ms: 2, rcode: 'NOERROR' } as LogEntry);
    noterRequete(ctx, { t: now - 20_000, client: '192.168.1.80', name: 'pub.fr', type: 'A', status: 'bloqué', list: 'Pubs et pisteurs', ms: 1, rcode: 'NOERROR' } as LogEntry);
    v.ctx('vidarr').saveSettings({ leases: [{ mac: '02:11:22:33:44:55', ip: '192.168.1.80', name: 'Téléphone d\'Awa', expires: now + 3600_000, first: now - 60_000 }] });
    const recap = await act('recap_machine', { mac: '02:11:22:33:44:55', periode: 'heure' });
    assert.match(recap.text, /Téléphone d'Awa/, 'le nom du bail'); assert.match(recap.text, /192\.168\.1\.80/, 'son adresse');
    assert.match(recap.text, /exemple\.fr/, 'un site visité'); assert.match(recap.text, /1 bloquée/, 'une requête bloquée');
    assert.match(recap.text, /Pubs et pisteurs/, 'la liste qui a bloqué');
    // La page montre la section récap et l'état par MAC.
    const view = await vidarr().view(ctx, new URLSearchParams());
    assert.ok(view.sections.some((sec) => sec.kind === 'cards' && /Récap par appareil/.test(sec.title)), 'section récap présente');
    assert.ok(view.sections.some((sec) => sec.kind === 'text' && /Accès au réseau par adresse MAC/.test(sec.title)), 'bloc contrôle d\'accès présent');
  } finally { v.stop(); rmSync(home, { recursive: true, force: true }); }
});
