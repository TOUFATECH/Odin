// Vörðr, la télésurveillance : sondes HTTP (codes, mot attendu), port, DNS, signe de vie, applis d'Odin,
// échecs avant alerte, maintenance, pause, certificat, disponibilité gardée jour par jour, graphe, page publique.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createServer as tlsServer } from 'node:tls';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import dgram from 'node:dgram';
import { Valhalla } from '../src/valhalla/service.ts';
import { allModules } from '../src/valhalla/odin.ts';
import { DEFAULT_CONFIG } from '../src/config.ts';
import { certDaysLeft, push, resetVordr, statusOk, statusPage, uptime } from '../src/valhalla/modules/vordr.ts';
import { parse, respond, rdata, TYPE } from '../src/valhalla/vidarr/wire.ts';

function world() {
  const home = mkdtempSync(join(tmpdir(), 'vordr-'));
  const v = new Valhalla(home, allModules({ paths: { home, workspace: home }, cfg: DEFAULT_CONFIG } as never), {
    run: async (cmd, args) => (cmd === 'ping' ? (args.at(-1) === '192.168.1.1' ? { code: 0, out: '64 bytes from 192.168.1.1: icmp_seq=1 ttl=64 time=1.84 ms', err: '' } : { code: 1, out: '', err: '' }) : cmd === 'ip' ? { code: 0, out: 'default via 192.168.1.1 dev eth0', err: '' } : { code: 0, out: '', err: '' }),
    fetch, notify: async () => {}, autonomy: () => 'equilibre',
  });
  v.ctx('vordr').saveSettings({ monitors: [] });
  resetVordr();
  return { v, home, act: (a: string, i: Record<string, unknown> = {}) => v.act('vordr', a, i), end: () => { v.stop(); rmSync(home, { recursive: true, force: true }); } };
}

test('codes HTTP acceptés', () => {
  assert.ok(statusOk(200) && statusOk(301) && !statusOk(404) && !statusOk(500));
  assert.ok(statusOk(204, '204') && !statusOk(200, '204') && statusOk(503, '2xx,503') && statusOk(201, '2xx'));
});

test('sondes HTTP, port, ping, DNS ; échecs avant alerte, retour, maintenance, pause ; disponibilité gardée', async () => {
  const w = world();
  let mode: 'ok' | 'mot' | '500' = 'ok';
  const http = createServer((_q, r) => { if (mode === '500') { r.writeHead(500); r.end('erreur'); } else { r.writeHead(200); r.end(mode === 'ok' ? '<h1>Boutique ouverte</h1>' : '<h1>Maintenance</h1>'); } });
  await new Promise<void>((ok) => http.listen(0, '127.0.0.1', () => ok()));
  const url = `http://127.0.0.1:${(http.address() as { port: number }).port}/`;
  const dns = dgram.createSocket('udp4');
  dns.on('message', (m, r) => { const q = parse(m); dns.send(respond(q, { an: [{ name: q.qd[0].name, type: TYPE.A, ttl: 60, data: rdata.a('192.168.1.10') }] }), r.port, r.address); });
  await new Promise<void>((ok) => dns.bind(0, '127.0.0.1', () => ok()));
  try {
    assert.match((await w.act('ajouter', { nom: 'Boutique', genre: 'http', cible: url, mot: 'ouverte', essais: 2, secondes: 30 })).text, /Boutique surveillé \(http .*, toutes les 30 s, alerte après 2 échec\(s\)\)\. Premier essai : OK — code 200/);
    assert.equal((await w.act('ajouter', { nom: 'boutique', genre: 'http', cible: url })).ok, false, 'pas deux fois le même nom');
    mode = 'mot';
    assert.match((await w.act('verifier', { nom: 'Boutique' })).text, /❌ Boutique : « ouverte » absent de la page/);
    assert.ok(!w.v.alerts({ module: 'vordr' }).some((a) => /en panne/.test(a.title)), 'un seul échec : pas encore d\'alerte');
    mode = '500';
    assert.match((await w.act('verifier', { nom: 'Boutique' })).text, /code 500/);
    const down = w.v.alerts({ module: 'vordr' }).find((a) => /❌ Boutique est en panne/.test(a.title));
    assert.ok(down); assert.match(down.detail ?? '', /code 500 \(2 essai\(s\) d'affilée\)/);
    mode = 'ok';
    await w.act('verifier', { nom: 'Boutique' });
    assert.ok(w.v.alerts({ module: 'vordr' }).some((a) => /✅ Boutique répond de nouveau/.test(a.title)));
    const u = uptime(w.v.ctx('vordr').dir, (w.v.ctx('vordr').settings.monitors as Array<{ id: string }>)[0].id, 1);
    assert.equal(u.pct, 50); assert.equal(u.downs, 1); assert.deepEqual(u.events.map((e) => e.status), ['retour', 'panne', 'en ligne']);
    assert.match((await w.act('historique', { nom: 'Boutique' })).text, /24 h 50 %[\s\S]*panne : code 500/);
    // Mot interdit.
    await w.act('ajouter', { nom: 'Pas de maintenance', genre: 'http', cible: url, mot: '!Maintenance', essais: 1 });
    mode = 'mot'; assert.match((await w.act('verifier', { nom: 'Pas de maintenance' })).text, /« Maintenance » est apparu/); mode = 'ok';
    // Port, ping, DNS.
    const port = (http.address() as { port: number }).port;
    assert.match((await w.act('ajouter', { nom: 'Port web', genre: 'tcp', cible: `127.0.0.1:${port}` })).text, /OK — port \d+ ouvert/);
    assert.equal((await w.act('ajouter', { nom: 'Mauvais', genre: 'tcp', cible: '127.0.0.1' })).ok, false);
    assert.match((await w.act('ajouter', { nom: 'Box', genre: 'ping', cible: '192.168.1.1' })).text, /OK — répond au ping/);
    assert.match((await w.act('ajouter', { nom: 'NAS', genre: 'dns', cible: 'nas.maison', attendu: '192.168.1.10' })).text, /OK|échec/);
    const ms = w.v.ctx('vordr').settings.monitors as Array<{ name: string; server?: string }>;
    w.v.ctx('vordr').saveSettings({ monitors: ms.map((m) => (m.name === 'NAS' ? { ...m, server: `127.0.0.1:${(dns.address() as { port: number }).port}` } : m)) });
    assert.match((await w.act('verifier', { nom: 'NAS' })).text, /✅ NAS : 192\.168\.1\.10/);
    w.v.ctx('vordr').saveSettings({ monitors: (w.v.ctx('vordr').settings.monitors as Array<{ name: string }>).map((m) => (m.name === 'NAS' ? { ...m, expect: '192.168.1.99' } : m)) });
    assert.match((await w.act('verifier', { nom: 'NAS' })).text, /répond 192\.168\.1\.10 au lieu de 192\.168\.1\.99/);
    // Maintenance : pas d'alerte pendant ces heures.
    await w.act('maintenance', { nom: 'Port web', jours: 'tous', de: '00:00', a: '00:00' });
    http.close(); await new Promise((ok) => setTimeout(ok, 30));
    const before = w.v.alerts({ module: 'vordr' }).length;
    await w.act('verifier', { nom: 'Port web' }); await w.act('verifier', { nom: 'Port web' }); await w.act('verifier', { nom: 'Port web' });
    assert.equal(w.v.alerts({ module: 'vordr' }).length, before, 'en maintenance : silence');
    // Pause.
    assert.match((await w.act('pause', { nom: 'Box' })).text, /en pause/);
    assert.match((await w.act('verifier', { nom: 'Box' })).text, /en pause/);
    assert.match((await w.act('reprendre', { nom: 'Box' })).text, /reprend : OK/);
    // Le graphe : Odin, les groupes, les sondes avec leur fiche.
    const view = await w.v.module('vordr')!.view(w.v.ctx('vordr'), new URLSearchParams());
    const g = view.sections.find((s) => s.kind === 'graph') as { nodes: Array<{ id: string; label: string; color?: string }>; edges: unknown[]; details: Record<string, { rows?: Array<{ k: string; v: string }> }> };
    assert.ok(g.nodes.some((n) => n.id === 'odin') && g.nodes.some((n) => n.id === 'g:Sites') && g.nodes.some((n) => n.id === 'g:Maison'));
    const b = g.nodes.find((n) => n.label === 'Boutique')!;
    assert.equal(b.color, '#57C98A');
    assert.match(g.details[b.id].rows!.find((r) => r.k === 'Disponibilité')!.v, /24 h : 50 %/);
    assert.ok(g.nodes.some((n) => n.id === 'h:127.0.0.1'), 'une machine surveillée de plusieurs façons a son point');
  } finally { http.close(); dns.close(); w.end(); }
});

test('signe de vie (push), applis d\'Odin, sondes automatiques, page publique sans adresses', async () => {
  const w = world();
  try {
    const r = await w.act('ajouter', { nom: 'Sauvegarde nocturne', genre: 'push', secondes: 60, essais: 1 });
    const token = (r.data as { token: string }).token;
    assert.match(r.text, new RegExp(`/v/${token}`));
    assert.match((await w.act('verifier', { nom: 'Sauvegarde' })).text, /❌ Sauvegarde nocturne : jamais reçu de signe de vie/);
    assert.equal(push('0'.repeat(32)), undefined, 'jeton inconnu');
    assert.equal(push(token), 'Sauvegarde nocturne');
    assert.match((await w.act('verifier', { nom: 'Sauvegarde' })).text, /✅ Sauvegarde nocturne : signe de vie il y a \d+ s/);
    // Sondes apportées par les autres applis.
    const l = await w.act('liens');
    assert.match(l.text, /Box \(Odin\)[\s\S]*Internet \(Odin\)[\s\S]*DNS d'Odin \(Víðarr\)[\s\S]*VPN d'Odin \(Gjöll\)/);
    // Page publique : seulement les sondes cochées, jamais leur adresse.
    await w.act('ajouter', { nom: 'Site vitrine', genre: 'http', cible: 'http://127.0.0.1:9/', public: true, essais: 1 });
    assert.match((await w.act('page_publique', { titre: 'TOUFATECH · état' })).text, /\/etat\/[a-f0-9]{18}/);
    const slug = String(w.v.ctx('vordr').settings.publicSlug);
    assert.equal(statusPage('mauvaise'), undefined);
    const html = statusPage(slug)!;
    assert.match(html, /TOUFATECH · état[\s\S]*Site vitrine[\s\S]*En panne/); assert.doesNotMatch(html, /127\.0\.0\.1|Sauvegarde nocturne/);
  } finally { w.end(); }
});

test('certificat HTTPS : jours restants', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'vordr-tls-'));
  try { execFileSync('openssl', ['req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:P-256', '-nodes', '-keyout', join(dir, 'k.pem'), '-out', join(dir, 'c.pem'), '-days', '10', '-subj', '/CN=localhost'], { stdio: 'ignore' }); }
  catch { t.diagnostic('openssl absent'); rmSync(dir, { recursive: true, force: true }); return; }
  const s = tlsServer({ key: readFileSync(join(dir, 'k.pem')), cert: readFileSync(join(dir, 'c.pem')) }, (c) => c.end());
  await new Promise<void>((ok) => s.listen(0, '127.0.0.1', () => ok()));
  try { const d = await certDaysLeft('127.0.0.1', (s.address() as { port: number }).port); assert.ok(d >= 9 && d <= 10, String(d)); }
  finally { s.close(); rmSync(dir, { recursive: true, force: true }); }
});
