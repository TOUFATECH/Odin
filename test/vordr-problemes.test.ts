// Vörðr façon Zabbix / Centreon : SNMP (faux appareil), scénario web en plusieurs pages, greffons Nagios,
// déclencheurs sur les mesures d'Odin, problèmes (prise en main, commentaires, escalade), dépendances
// (symptômes sans alerte en double), engagement de disponibilité (SLA).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import dgram from 'node:dgram';
import { Valhalla } from '../src/valhalla/service.ts';
import { allModules } from '../src/valhalla/odin.ts';
import { DEFAULT_CONFIG } from '../src/config.ts';
import { evalTriggers, problems, resetVordr } from '../src/valhalla/modules/vordr.ts';
import { getRequest, int, oid, parseResponse, seq, snmpGet, str } from '../src/valhalla/vordr/snmp.ts';
import { describe, evaluate, sla, toEscalate, type Problem, type Trigger } from '../src/valhalla/vordr/problems.ts';

async function refused(p: Promise<{ ok?: boolean; text: string }>, re: RegExp) { const r = await p; assert.equal(r.ok, false, r.text); assert.match(r.text, re); }

function world() {
  const home = mkdtempSync(join(tmpdir(), 'vordr-p-'));
  const alerts: Array<{ level: string; title: string }> = [];
  const v = new Valhalla(home, allModules({ paths: { home, workspace: home }, cfg: DEFAULT_CONFIG } as never), { run: async () => ({ code: 1, out: '', err: '' }), fetch, notify: async () => {}, autonomy: () => 'equilibre' });
  v.events.on('alert', (a: { level: string; title: string }) => alerts.push(a));
  v.ctx('vordr').saveSettings({ monitors: [], triggers: [], problems: [] });
  resetVordr();
  return { v, alerts, ctx: () => v.ctx('vordr'), act: (a: string, i: Record<string, unknown> = {}) => v.act('vordr', a, i), end: () => { v.stop(); rmSync(home, { recursive: true, force: true }); } };
}

/** Un faux appareil SNMP : répond aux GET connus, avec la bonne communauté seulement. */
async function fakeAgent(values: Record<string, Buffer>, community = 'maison') {
  const sock = dgram.createSocket('udp4');
  sock.on('message', (b, rinfo) => {
    // On relit la demande comme une réponse (même forme, autre étiquette).
    const copy = Buffer.from(b); const at = copy.indexOf(0xa0, 5); copy[at] = 0xa2;
    const req = parseResponse(copy);
    if (!b.includes(Buffer.from(community))) return; // mauvaise communauté : silence, comme un vrai
    const vbs = req.values.map((x) => seq(oid(x.oid), values[x.oid] ?? Buffer.from([0x81, 0x00])));
    const pdu = seq(int(req.id), int(0), int(0), seq(...vbs)); pdu[0] = 0xa2;
    sock.send(seq(int(1), str(community), pdu), rinfo.port, rinfo.address);
  });
  await new Promise<void>((ok) => sock.bind(0, '127.0.0.1', () => ok()));
  return { port: sock.address().port, close: () => sock.close() };
}

test('SNMP : codage, lecture sur un faux appareil, communauté fausse', async () => {
  const r = getRequest('public', ['1.3.6.1.2.1.1.5.0'], 2, 42);
  assert.equal(r[0], 0x30); assert.ok(r.includes(Buffer.from('public')));
  const a = await fakeAgent({ '1.3.6.1.2.1.1.5.0': str('box-salon'), '1.3.6.1.2.1.33.1.2.4.0': int(87), '1.3.6.1.2.1.1.3.0': Buffer.concat([Buffer.from([0x43, 0x03]), Buffer.from([0x01, 0x86, 0xa0])]) });
  try {
    const v = await snmpGet('127.0.0.1', ['1.3.6.1.2.1.1.5.0', '1.3.6.1.2.1.33.1.2.4.0', '1.3.6.1.2.1.1.3.0'], { community: 'maison', port: a.port, timeoutMs: 1500 });
    assert.deepEqual(v.map((x) => x.value), ['box-salon', 87, 100000]);
    await assert.rejects(snmpGet('127.0.0.1', ['1.3.6.1.2.1.1.5.0'], { community: 'faux', port: a.port, timeoutMs: 300 }), /pas de réponse SNMP/);
    // Dans Vörðr : sonde SNMP sur l'onduleur, valeur rangée dans les mesures.
    const w = world();
    try {
      const t = await w.act('ajouter', { nom: 'Onduleur', genre: 'snmp', cible: `127.0.0.1:${a.port}`, oid: 'onduleur.batterie', communaute: 'maison' });
      assert.match(t.text, /Premier essai : OK — onduleur\.batterie = 87/);
      const id = (t.data as { id: string }).id; w.v.metrics.flush();
      assert.equal(w.v.metrics.fn(`vordr.snmp.${id}`, 'last', 600_000), 87);
      assert.equal(w.v.metrics.fn(`vordr.up.${id}`, 'last', 600_000), 1);
      const bad = await w.act('ajouter', { nom: 'Imprimante', genre: 'snmp', cible: `127.0.0.1:${a.port}`, oid: '1.3.6.1.2.1.43.11.1.1.9.1.1', communaute: 'maison' });
      assert.match(bad.text, /échec — OID .* inconnu/);
      await refused(w.act('ajouter', { nom: 'X', genre: 'snmp', cible: 'a b' }), /appareil invalide/);
    } finally { w.end(); }
  } finally { a.close(); }
});

test('scénario web : connexion puis page du compte (cookies gardés), étape ratée nommée', async () => {
  const http = createServer((q, r) => {
    if (q.url === '/connexion' && q.method === 'POST') { r.writeHead(302, { 'set-cookie': 'sid=abc; Path=/; HttpOnly', location: '/compte' }); r.end(); return; }
    if (q.url === '/compte') { r.writeHead(q.headers.cookie?.includes('sid=abc') ? 200 : 403); r.end(q.headers.cookie?.includes('sid=abc') ? 'Bonjour Awa' : 'interdit'); return; }
    r.writeHead(200); r.end('<form>Connexion</form>');
  });
  await new Promise<void>((ok) => http.listen(0, '127.0.0.1', () => ok()));
  const base = `http://127.0.0.1:${(http.address() as { port: number }).port}`, w = world();
  try {
    const ok = await w.act('ajouter', { nom: 'Parcours client', genre: 'scenario', etapes: `${base}/ | Connexion\n${base}/connexion | | nom=awa&mdp=x\n${base}/compte | Bonjour` });
    assert.match(ok.text, /OK — 3 étape\(s\) réussie\(s\)/);
    const ko = await w.act('ajouter', { nom: 'Compte sans connexion', genre: 'scenario', etapes: `${base}/compte | Bonjour` });
    assert.match(ko.text, /échec — étape 1 : code 403/);
    await refused(w.act('ajouter', { nom: 'Vide', genre: 'scenario', etapes: '' }), /au moins une page/);
    await refused(w.act('ajouter', { nom: 'Mauvais', genre: 'scenario', etapes: 'file:///etc/passwd' }), /adresse invalide/);
  } finally { w.end(); http.close(); }
});

test('greffons Nagios : seulement check_*, rien d\'autre', async () => {
  const w = world();
  try {
    await refused(w.act('ajouter', { nom: 'Danger', genre: 'commande', cible: 'rm -rf /' }), /greffon Nagios attendu/);
    await refused(w.act('ajouter', { nom: 'Danger2', genre: 'commande', cible: '../../bin/sh -c id' }), /greffon Nagios attendu/);
    const t = await w.act('ajouter', { nom: 'Disque', genre: 'commande', cible: 'check_inexistant_odin -w 20%' });
    assert.match(t.text, /échec — .*introuvable/);
  } finally { w.end(); }
});

test('déclencheurs (pur) : phrase, ouverture, retour avec hystérésis, pas de données, escalade, SLA', () => {
  const tr: Trigger = { id: 't1', name: 'Mémoire pleine', serie: 'eir.mem', fn: 'avg', windowMin: 5, op: '>', value: 80, recovery: 70, severity: 'haut', enabled: true };
  assert.equal(describe(tr), 'Si la moyenne de « eir.mem » sur 5 min dépasse 80, problème Haut ; fini quand elle repasse sous 70.');
  let v = 85; const m = { fn: () => v };
  const a = evaluate(m, [tr], [], 1000); assert.equal(a.opened.length, 1); assert.equal(a.opened[0].value, 85);
  v = 75; assert.equal(evaluate(m, [tr], a.opened, 2000).closed.length, 0, 'entre 70 et 80 : toujours en problème');
  v = 60; assert.equal(evaluate(m, [tr], a.opened, 3000).closed.length, 1);
  const nd = evaluate({ fn: () => undefined }, [{ ...tr, nodata: 1 }], [], 1); assert.match(nd.opened[0].name, /Plus aucune valeur/);
  assert.equal(evaluate({ fn: () => undefined }, [tr], [], 1).opened.length, 0);
  const p: Problem = { ...a.opened[0], start: 0 };
  assert.deepEqual(toEscalate([p], 14 * 60_000).length, 0); assert.equal(toEscalate([p], 16 * 60_000)[0].step, 1);
  assert.equal(toEscalate([{ ...p, ack: { by: 'awa', at: 1 } }], 99 * 60_000).length, 0, 'pris en main : plus d\'escalade');
  assert.equal(toEscalate([{ ...p, severity: 'avertissement' }], 99 * 60_000).length, 0, 'avertissement : pas d\'escalade');
  assert.deepEqual(sla([{ up: 1430, down: 10 }], 99.9), { pct: 99.31, ok: false, downMin: 10, budgetMin: 1 });
  assert.deepEqual(sla([], 99), { downMin: 0 });
});

test('dans Odin : déclencheur sur une mesure, problème, prise en main, escalade, commentaires, dépendances, SLA, vue', async () => {
  const w = world();
  const http = createServer((_q, r) => { r.writeHead(down ? 500 : 200); r.end('ok'); });
  let down = false;
  await new Promise<void>((ok) => http.listen(0, '127.0.0.1', () => ok()));
  const url = `http://127.0.0.1:${(http.address() as { port: number }).port}/`;
  try {
    const t = await w.act('declencheur', { nom: 'Mémoire presque pleine', serie: 'eir.mem', fonction: 'avg', minutes: 5, operateur: '>', valeur: 80, retour: '70', gravite: 'haut', conseils: 'Regarde les processus dans Eir\nRedémarre le plus gourmand' });
    assert.match(t.text, /Si la moyenne de « eir\.mem » sur 5 min dépasse 80, problème Haut ; fini quand elle repasse sous 70\./);
    await refused(w.act('declencheur', { nom: 'X', serie: 'eir mem', valeur: 1 }), /mesure invalide/);
    w.v.metrics.put({ 'eir.mem': 91 });
    const now = Date.now();
    assert.deepEqual(evalTriggers(w.ctx(), now), { opened: 1, closed: 0 });
    assert.ok(w.alerts.some((a) => a.level === 'haute' && a.title === 'Mémoire presque pleine'));
    assert.equal(evalTriggers(w.ctx(), now + 1000).opened, 0, 'pas deux fois le même problème');
    assert.match((await w.act('problemes')).text, /\[Haut\] Mémoire presque pleine \(91\) · depuis/);
    // Personne ne s'en occupe : escalade à 15 min puis à 60 min (la dernière en critique).
    evalTriggers(w.ctx(), now + 16 * 60_000); assert.ok(w.alerts.some((a) => a.level === 'haute' && /Toujours pas pris en main/.test(a.title)));
    evalTriggers(w.ctx(), now + 61 * 60_000); assert.ok(w.alerts.some((a) => a.level === 'critique' && /Toujours pas pris en main/.test(a.title)));
    const n = w.alerts.length; evalTriggers(w.ctx(), now + 120 * 60_000); assert.equal(w.alerts.length, n, 'pas d\'escalade de plus');
    await w.act('prendre_en_main', { id: 'mémoire', mot: 'Je regarde Jellyfin', par: 'Awa' });
    await w.act('commenter', { id: 'mémoire', texte: 'Transcodage arrêté' });
    const pr = problems(w.ctx()).find((p) => !p.end)!;
    assert.equal(pr.ack?.by, 'Awa'); assert.deepEqual(pr.comments.map((c) => c.text), ['Je regarde Jellyfin', 'Transcodage arrêté']);
    // La mémoire redescend sous le seuil de retour (les anciennes valeurs sortent de la fenêtre).
    w.v.metrics.put({ 'eir.mem': 40 }, now + 60_000); w.v.metrics.flush();
    const r = evalTriggers(w.ctx(), now + 2 * 60_000); assert.equal(r.closed, 0, 'moyenne (91+40)/2 encore > 70');
    for (let k = 2; k < 7; k++) w.v.metrics.put({ 'eir.mem': 40 }, now + k * 60_000);
    // Dépendances : le site dépend d'Internet ; Internet tombe d'abord → le site est un symptôme, sans alerte.
    await w.act('ajouter', { nom: 'Internet', genre: 'http', cible: url, essais: 1 });
    await w.act('ajouter', { nom: 'Boutique', genre: 'http', cible: url, essais: 1, depend_de: 'Internet' });
    await refused(w.act('dependance', { nom: 'Internet', depend_de: 'Internet' }), /elle-même/);
    down = true; const before = w.alerts.length;
    await w.act('verifier', { nom: 'Internet' }); await w.act('verifier', { nom: 'Boutique' });
    const fresh = w.alerts.slice(before).map((a) => a.title);
    assert.ok(fresh.some((x) => /Internet est en panne/.test(x)) && !fresh.some((x) => /Boutique est en panne/.test(x)), fresh.join(' | '));
    const open = problems(w.ctx()).filter((p) => !p.end), net = open.find((p) => p.name === 'Internet est en panne')!, shop = open.find((p) => p.name === 'Boutique est en panne')!;
    assert.equal(shop.symptomOf, net.id);
    const view = await w.v.module('vordr')!.view(w.ctx(), new URLSearchParams());
    const tables = Object.fromEntries(view.sections.filter((s) => s.kind === 'table').map((s) => [s.title, s as { rows: Array<{ cells: string[] }> }]));
    assert.ok(tables['Problèmes'].rows.some((x) => x.cells[1] === 'Boutique est en panne (symptôme)'));
    assert.ok(tables['Déclencheurs'].rows[0].cells[1].startsWith('Si la moyenne'));
    assert.ok(Object.keys(tables).some((k) => k.startsWith('Engagement de disponibilité')));
    assert.ok(view.kpis!.some((k) => k.label === 'Problèmes' && k.value === '2'), 'le symptôme ne compte pas');
    // Retour : les problèmes des sondes se ferment.
    down = false; await w.act('verifier', { nom: '' });
    assert.equal(problems(w.ctx()).filter((p) => !p.end && p.source === 'sonde').length, 0);
    assert.match((await w.act('sla', { objectif: 99.9 })).text, /Objectif 99\.9 % sur 30 j :\n.*Internet : \d/);
    // Coupé puis retiré.
    await w.act('activer_declencheur', { nom: 'Mémoire presque pleine', actif: false });
    assert.equal(problems(w.ctx()).filter((p) => !p.end).length, 0);
    assert.match((await w.act('retirer_declencheur', { nom: 'Mémoire presque pleine' })).text, /retiré/);
  } finally { w.end(); http.close(); }
});
