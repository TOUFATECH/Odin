// Utiliser Odin sur autre chose que sa propre machine : un poste de la maison, une adresse d'Internet, un lien.
// Et ne plus refuser une simple consultation (balayer SON réseau, identifier un appareil, lire SON agenda)
// parce qu'une page web a été lue avant, ou parce que c'est une tâche planifiée.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Tool } from '../src/tools/registry.ts';
import { call, makeOdin } from './helpers.ts';
import { Valhalla } from '../src/valhalla/service.ts';
import { allModules } from '../src/valhalla/odin.ts';
import { DEFAULT_CONFIG } from '../src/config.ts';
import { cibleDe, deLaMaison } from '../src/valhalla/modules/geri.ts';
import { isolatedContainerNote } from '../src/hlidskjalf/discover.ts';

/** Les réponses d'outils du tour (l'appel au modèle qui en a vu le plus). */
const toolMsgs = (o: ReturnType<typeof makeOdin>) => o.provider.calls.map((c) => c.messages.filter((m) => m.role === 'tool')).sort((a, b) => b.length - a.length)[0];
const fakeWeb: Tool = { name: 'fake_web', description: 'page web factice', risk: 'network', taints: true, schema: { type: 'object', properties: {} }, run: async () => '<untrusted>page lue</untrusted>' };

test('après une page web, lire SON agenda et balayer SON réseau ne demandent pas de validation (consultation)', async () => {
  const o = makeOdin([call('fake_web', {}), call('calendar_list', { days: 1 }), call('net_scan', {}), { text: 'ok' }]);
  o.tools.register(fakeWeb);
  const r = await o.agent.run('Fais mon point du matin', { sessionId: 's' });
  assert.equal(r.tainted, true, 'la conversation est bien marquée (une page a été lue)');
  assert.equal(o.approvals.length, 0, 'aucune validation demandée');
  const tools = toolMsgs(o).map((m) => m.content).join('\n');
  assert.doesNotMatch(tools, /refusée par Heimdall/);
  assert.match(tools, /agenda n'est pas relié|Agenda/i);
  o.cleanup();
});

test('tâche planifiée (sans personne) : l\'agenda et le balayage passent ; écrire un fichier après une page web reste refusé', async () => {
  const o = makeOdin([call('fake_web', {}), call('calendar_list', {}), call('net_identify', { ip: '192.168.77.250' }), call('fs_write', { path: 'pwn.txt', content: 'x' }), { text: 'ok' }]);
  o.tools.register(fakeWeb);
  await o.agent.run('point du matin', { sessionId: 'cron:matin', unattended: true });
  const msgs = toolMsgs(o);
  assert.doesNotMatch(msgs[1].content, /refusée par Heimdall/, 'agenda lu');
  assert.doesNotMatch(msgs[2].content, /refusée par Heimdall/, 'appareil regardé');
  assert.match(msgs[3].content, /refusée par Heimdall/, 'la protection contre les pages piégées est intacte pour ce qui modifie');
  o.cleanup();
});

test('ce qu\'on analyse : adresse, nom ou lien ; maison ou Internet', () => {
  assert.deepEqual(cibleDe(' 192.168.1.20 '), { hote: '192.168.1.20' });
  assert.equal(cibleDe('nas.maison:8080').hote, 'nas.maison');
  assert.equal(cibleDe('https://exemple.fr/page?x=1').hote, 'exemple.fr');
  assert.equal(cibleDe('2001:db8::1').hote, '2001:db8::1');
  assert.throws(() => cibleDe('https://moi:secret@exemple.fr/'), /identifiant/);
  assert.throws(() => cibleDe('a b'), /adresse IP/); assert.throws(() => cibleDe('$(rm -rf /)'), /invalide|adresse/);
  assert.ok(deLaMaison('192.168.1.1') && deLaMaison('10.0.0.5') && deLaMaison('127.0.0.1') && deLaMaison('fe80::1'));
  assert.ok(!deLaMaison('8.8.8.8') && !deLaMaison('93.184.216.34'));
});

test('Méduse analyse une adresse d\'Internet (sans balayage) et un lien (page sans ses paramètres)', async () => {
  const home = mkdtempSync(join(tmpdir(), 'usage-'));
  const seen: string[] = [];
  const v = new Valhalla(home, allModules({ paths: { home, workspace: home }, cfg: DEFAULT_CONFIG } as never), {
    run: async () => ({ code: 1, out: '', err: '' }), notify: async () => {},
    fetch: (async (u: string | URL) => { seen.push(String(u)); return new Response('<html><head><title>Boutique de test</title></head></html>', { status: 200, headers: { 'content-type': 'text/html', server: 'nginx' } }); }) as never,
  });
  try {
    const a = await v.act('geri', 'analyser', { cible: '203.0.113.9' });
    assert.match(a.text, /203\.0\.113\.9 est une adresse d'Internet/); assert.match(a.text, /Je ne balaye pas les ports/); assert.match(a.text, /aucune liste|malveillantes/);
    assert.equal(seen.length, 0, 'une adresse nue : aucune page demandée');
    const l = await v.act('geri', 'analyser', { cible: 'https://203.0.113.9/promo?jeton=abcdef' });
    assert.match(l.text, /titre « Boutique de test »/); assert.match(l.text, /serveur nginx/); assert.match(l.text, /paramètres du lien ne sont pas envoyés/);
    assert.ok(seen.some((u) => u === 'https://203.0.113.9/promo'), `page demandée sans ses paramètres : ${seen.join(' ')}`);
    assert.ok(!seen.some((u) => u.includes('jeton')), 'les paramètres ne partent jamais');
    const m = await v.act('geri', 'analyser', { cible: '127.0.0.1' });
    assert.match(m.text, /adresse de la maison/);
    assert.equal((await v.act('geri', 'analyser', { cible: 'pas une adresse' })).ok, false);
  } finally { v.stop(); rmSync(home, { recursive: true, force: true }); }
});

test('Odin en conteneur isolé : il dit qu\'il ne voit pas la maison', () => {
  const sub = (address: string, cidr: string) => ({ iface: 'eth0', address, cidr, prefix: 24, hosts: [] });
  assert.match(isolatedContainerNote([sub('172.18.0.2', '172.18.0.0/24')], (p) => p === '/.dockerenv', {})!, /conteneur isolé[\s\S]*172\.18\.0\.0\/24[\s\S]*--network host/);
  assert.equal(isolatedContainerNote([sub('192.168.1.144', '192.168.1.0/24')], (p) => p === '/.dockerenv', {}), undefined, 'conteneur sur le réseau de la machine : rien à dire');
  assert.equal(isolatedContainerNote([sub('172.18.0.2', '172.18.0.0/24')], () => false, {}), undefined, 'pas un conteneur');
});
