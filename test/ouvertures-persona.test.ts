// Suite des ouvertures : Persona (réglages du portail, libérer un site), le portail du proxy (Valgrind) et le VPN
// (Vortex). Seul, Odin ne fait que le sans-risque : publier le portail, ôter la connexion unique d'un site, servir le
// portail sous un nom, changer l'adresse publique du VPN ou envoyer ses demandes de noms à un DNS hors de la maison
// attendent la validation du propriétaire, et cette validation dit ce qui change. Ce qui ne change rien, ou qui
// ferme, reste libre. Pour chaque action : la demande au propriétaire dit ce qui change ; une automatisation est
// refusée ; le chemin voulu marche avec sa validation.
// Rien ne sort : le réseau est coupé, les commandes sont imitées et notées.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Valhalla } from '../src/valhalla/service.ts';
import { allModules, setValhalla } from '../src/valhalla/odin.ts';
import { type Answers, type Judge } from '../src/mimir/client.ts';
import { call, makeOdin } from './helpers.ts';

/** Un monde d'Odin : toutes les applis, réseau coupé, commandes imitées, messages au propriétaire notés. */
function monde(route = '') {
  const home = mkdtempSync(join(tmpdir(), 'odin-ouvertures-persona-')), ran: string[] = [], dits: string[] = [];
  const v = new Valhalla(home, allModules({ paths: { home, workspace: home }, cfg: { venus: {}, voice: {}, web: { port: 8888, tls: { enabled: false } }, mail: {} } } as never), {
    // `route` : ce que répond « ip route show default » (vide = la box n'est pas trouvée, comme sur Windows).
    run: async (cmd, args) => { ran.push(`${cmd} ${args.join(' ')}`); return { code: 0, out: /command -v/.test(args.join(' ')) ? '/usr/bin/x' : cmd === 'ip' && args[0] === 'route' ? route : '', err: '' }; },
    fetch: (async () => { throw new Error('réseau coupé'); }) as unknown as typeof fetch,
    notify: async (t) => { dits.push(t); }, autonomy: () => 'equilibre',
  });
  setValhalla(v);
  // Les actions vraiment lancées (une action refusée n'est jamais lancée).
  const lancees: string[] = []; v.events.on('action', (e: { module: string; action: string }) => lancees.push(`${e.module}.${e.action}`));
  return { v, ran, dits, lancees, fin: () => { setValhalla(undefined); v.stop(); rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } };
}
type Monde = ReturnType<typeof monde>;
/** Un tunnel de Bifröst existe (rien n'y est encore publié, sauf ce qui est donné). */
const tunnel = (w: Monde, publies: string[] = []) => w.v.ctx('bru').saveSettings({ tunnel: { id: 't1', name: 'odin', account: 'acc' }, published: publies.map((h) => ({ hostname: h, service: 'https://localhost:443', zone: 'exemple.fr', zoneId: 'z1', at: 0 })) });
/** Un site du proxy qui demande la connexion d'Odin, sans règle de Persona. */
const siteProtege = (w: Monde) => w.v.ctx('valgrind').saveSettings({ hosts: [{ id: 'h1', domains: ['nas.exemple.fr'], target: 'http://192.168.1.10:5000', enabled: true, tls: 'aucun', sso: true }] });
const grave = (w: Monde, m: string, a: string, i: Record<string, unknown>) => w.v.action(m, a)!.a.grave?.(i, w.v.ctx(m));
const REGLAGES = { portail: 'connexion.exemple.fr', domaine: 'exemple.fr', heures: 12, double_auth: '' };

/** Un juge qui dit : demandé clairement par le propriétaire, rien de risqué. */
const juge: Judge = async (_s, questions) => {
  const r: Answers = {};
  for (const [name, q] of Object.entries(questions)) {
    if (q.type === 'noul') r[name] = { type: 'noul', noul: name === 'requested' ? 0.97 : 0.05 };
    else if (q.type === 'choice') { const top = Object.keys(q.criteria)[0]; r[name] = { type: 'choice', choice: top, probabilities: { [top]: 0.9 } }; }
  }
  return r;
};
/** Demandé au chat : la demande de validation qu'il reçoit (rien n'est lancé sans sa réponse). */
async function demande(w: Monde, m: string, a: string, entree: Record<string, unknown>): Promise<string> {
  const o = makeOdin([call('valhalla', { action: 'action', appli: m, quoi: a, entree: JSON.stringify(entree) }), { text: 'Voilà.' }], { judge: juge });
  try {
    const avant = w.lancees.length;
    await o.agent.run(`Lance ${a} sur ${m}`, { sessionId: 'web:principal', channel: 'web' });
    assert.equal(o.approvals.length, 1, `${m}.${a} : une demande de validation`);
    assert.deepEqual(w.lancees.slice(avant), [], `${m}.${a} : rien n'est lancé sans sa réponse`);
    return o.approvals[0].reason;
  } finally { o.cleanup(); }
}

// ---------------- Persona · Réglages : publier le portail
test('Persona · Réglages : publier le portail sur Internet — la demande dit quoi, à quelle adresse, joignable par qui', async () => {
  const w = monde();
  try {
    tunnel(w);
    const g = grave(w, 'var', 'reglages', REGLAGES) ?? '';
    assert.match(g, /connexion\.exemple\.fr/); assert.match(g, /Internet/); assert.match(g, /n'importe qui/);
    const r = await demande(w, 'var', 'reglages', REGLAGES);
    assert.match(r, /connexion\.exemple\.fr/); assert.match(r, /Internet/);
  } finally { w.fin(); }
});

test('Persona · Réglages : une automatisation est refusée, rien n\'est servi ni publié', async () => {
  const w = monde();
  try {
    tunnel(w);
    const r = await w.v.act('var', 'reglages', REGLAGES, { auto: true });
    assert.equal(r.ok, false, r.text);
    assert.deepEqual(w.lancees, [], 'aucune action lancée');
  } finally { w.fin(); }
});

test('Persona · Réglages : avec sa validation, le portail est servi et sa publication part ; sans rien de nouveau, rien n\'est redemandé', async () => {
  const w = monde();
  try {
    tunnel(w);
    const r = await w.v.act('var', 'reglages', REGLAGES);
    assert.notEqual(r.ok, false, r.text);
    assert.ok(w.lancees.includes('valgrind.portail'), `le portail est servi (${w.lancees.join(', ')})`);
    assert.ok(w.lancees.includes('bru.publier'), `la publication part (${w.lancees.join(', ')})`);
    assert.ok(!w.v.alerts().some((a) => /sans ta validation/.test(a.title)), 'aucun refus');
    // Même nom, déjà publié : changer la durée des sessions ne publie rien de nouveau, sans validation, sans refus.
    tunnel(w, ['connexion.exemple.fr']); w.lancees.length = 0;
    assert.equal(grave(w, 'var', 'reglages', { ...REGLAGES, heures: 8 }), undefined);
    const r2 = await w.v.act('var', 'reglages', { ...REGLAGES, heures: 8 });
    assert.notEqual(r2.ok, false, r2.text); assert.deepEqual(w.lancees, ['var.reglages']);
    assert.ok(!w.v.alerts().some((a) => /sans ta validation/.test(a.title)), 'aucune alerte de refus');
  } finally { w.fin(); }
});

// ---------------- Persona · Libérer un site
test('Persona · Libérer un site : la demande dit quel site perd la connexion unique et ce que cela ouvre', async () => {
  const w = monde();
  try {
    siteProtege(w);
    const g = grave(w, 'var', 'liberer_site', { domaine: 'nas.exemple.fr' }) ?? '';
    assert.match(g, /nas\.exemple\.fr/); assert.match(g, /192\.168\.1\.10:5000/); assert.match(g, /sans se connecter/);
    assert.match(await demande(w, 'var', 'liberer_site', { domaine: 'nas.exemple.fr' }), /nas\.exemple\.fr/);
  } finally { w.fin(); }
});

test('Persona · Libérer un site : une automatisation est refusée, le site reste protégé', async () => {
  const w = monde();
  try {
    siteProtege(w);
    assert.equal((await w.v.act('var', 'liberer_site', { domaine: 'nas.exemple.fr' }, { auto: true })).ok, false);
    assert.equal((w.v.ctx('valgrind').settings.hosts as Array<{ sso?: boolean }>)[0].sso, true);
  } finally { w.fin(); }
});

test('Persona · Libérer un site : avec sa validation, le site ne demande plus la connexion d\'Odin', async () => {
  const w = monde();
  try {
    siteProtege(w);
    const r = await w.v.act('var', 'liberer_site', { domaine: 'nas.exemple.fr' });
    assert.notEqual(r.ok, false, r.text);
    assert.equal((w.v.ctx('valgrind').settings.hosts as Array<{ sso?: boolean }>)[0].sso, false, r.text);
  } finally { w.fin(); }
});

// ---------------- Valgrind · Servir le portail
test('Valgrind · Servir le portail : la demande dit sous quel nom, et ce que cela fait (DNS de la maison, certificat)', async () => {
  const w = monde();
  try {
    const g = grave(w, 'valgrind', 'portail', { domaine: 'connexion.exemple.fr' }) ?? '';
    assert.match(g, /connexion\.exemple\.fr/); assert.match(g, /DNS de la maison/); assert.match(g, /certificat/);
    assert.match(await demande(w, 'valgrind', 'portail', { domaine: 'connexion.exemple.fr' }), /connexion\.exemple\.fr/);
  } finally { w.fin(); }
});

test('Valgrind · Servir le portail : une automatisation est refusée', async () => {
  const w = monde();
  try {
    const r = await w.v.act('valgrind', 'portail', { domaine: 'connexion.exemple.fr' }, { auto: true });
    assert.equal(r.ok, false); assert.match(r.text, /action grave/); assert.deepEqual(w.lancees, []);
  } finally { w.fin(); }
});

test('Valgrind · Servir le portail : avec sa validation, le portail est servi', async () => {
  const w = monde();
  try {
    const r = await w.v.act('valgrind', 'portail', { domaine: 'connexion.exemple.fr' });
    assert.notEqual(r.ok, false, r.text); assert.match(r.text, /Portail connexion\.exemple\.fr servi/);
  } finally { w.fin(); }
});

// ---------------- Vortex · Adresse publique
test('Vortex · Adresse publique : la demande dit l\'avant et l\'après ; la même adresse ne redemande rien', async () => {
  const w = monde();
  try {
    assert.equal((await w.v.act('gjoll', 'adresse', { adresse: 'maison.exemple.fr', port: 51820 })).ok, true);
    const g = grave(w, 'gjoll', 'adresse', { adresse: 'vpn.exemple.fr', port: 51999 }) ?? '';
    assert.match(g, /maison\.exemple\.fr:51820/); assert.match(g, /vpn\.exemple\.fr:51999/);
    assert.match(await demande(w, 'gjoll', 'adresse', { adresse: 'vpn.exemple.fr', port: 51999 }), /vpn\.exemple\.fr:51999/);
    assert.equal(grave(w, 'gjoll', 'adresse', { adresse: 'maison.exemple.fr', port: 51820 }), undefined);
  } finally { w.fin(); }
});

test('Vortex · Adresse publique : une automatisation est refusée, l\'adresse ne change pas', async () => {
  const w = monde();
  try {
    const r = await w.v.act('gjoll', 'adresse', { adresse: 'vpn.exemple.fr', port: 51999 }, { auto: true });
    assert.equal(r.ok, false); assert.match(r.text, /action grave|seul le propriétaire/);
    assert.notEqual((w.v.ctx('gjoll').settings.server as { endpoint?: string } | undefined)?.endpoint, 'vpn.exemple.fr');
  } finally { w.fin(); }
});

test('Vortex · Adresse publique : avec sa validation, l\'adresse change', async () => {
  const w = monde();
  try {
    const r = await w.v.act('gjoll', 'adresse', { adresse: 'vpn.exemple.fr', port: 51999 });
    assert.notEqual(r.ok, false, r.text);
    const sv = w.v.ctx('gjoll').settings.server as { endpoint: string; port: number };
    assert.equal(sv.endpoint, 'vpn.exemple.fr'); assert.equal(sv.port, 51999);
  } finally { w.fin(); }
});

// ---------------- Vortex · DNS donné aux appareils
test('Vortex · DNS hors de la maison : la demande dit que leurs demandes partiront vers ce serveur ; celui de la maison ou d\'Odin, non', async () => {
  const w = monde();
  try {
    w.v.ctx('gjoll').saveSettings({ server: { priv: 'p', pub: 'q', net: '10.8.0', port: 51820, endpoint: 'maison.exemple.fr', dns: '192.168.1.1', iface: 'wg0', lan: ['192.168.1.0/24'], nat: 'aucun' } });
    const g = grave(w, 'gjoll', 'reseaux', { reseaux: '', dns: '203.0.113.53' }) ?? '';
    assert.match(g, /203\.0\.113\.53/); assert.match(g, /extérieur/); assert.match(g, /192\.168\.1\.1/);
    assert.match(await demande(w, 'gjoll', 'reseaux', { reseaux: '', dns: '203.0.113.53' }), /203\.0\.113\.53/);
    assert.equal(grave(w, 'gjoll', 'reseaux', { reseaux: '', dns: '192.168.1.254' }), undefined, 'DNS de la maison');
    assert.equal(grave(w, 'gjoll', 'reseaux', { reseaux: '', dns: '10.8.0.1' }), undefined, 'DNS d\'Odin');
    assert.equal(grave(w, 'gjoll', 'reseaux', { reseaux: '', dns: '' }), undefined, 'DNS inchangé');
  } finally { w.fin(); }
});

test('Vortex · DNS hors de la maison : une automatisation est refusée, le DNS ne change pas', async () => {
  const w = monde();
  try {
    w.v.ctx('gjoll').saveSettings({ server: { priv: 'p', pub: 'q', net: '10.8.0', port: 51820, endpoint: 'maison.exemple.fr', dns: '192.168.1.1', iface: 'wg0', lan: ['192.168.1.0/24'], nat: 'aucun' } });
    const r = await w.v.act('gjoll', 'reseaux', { reseaux: '', dns: '203.0.113.53' }, { auto: true });
    assert.equal(r.ok, false); assert.match(r.text, /action grave|seul le propriétaire/);
    assert.equal((w.v.ctx('gjoll').settings.server as { dns: string }).dns, '192.168.1.1');
  } finally { w.fin(); }
});

test('Vortex · DNS hors de la maison : avec sa validation, le DNS change', async () => {
  const w = monde();
  try {
    w.v.ctx('gjoll').saveSettings({ server: { priv: 'p', pub: 'q', net: '10.8.0', port: 51820, endpoint: 'maison.exemple.fr', dns: '192.168.1.1', iface: 'wg0', lan: ['192.168.1.0/24'], nat: 'aucun' } });
    const r = await w.v.act('gjoll', 'reseaux', { reseaux: '', dns: '203.0.113.53' });
    assert.notEqual(r.ok, false, r.text);
    assert.equal((w.v.ctx('gjoll').settings.server as { dns: string }).dns, '203.0.113.53');
  } finally { w.fin(); }
});

test('Vortex · sans la box, Odin ne choisit jamais seul un DNS hors de la maison (ni par « Réseaux », ni par « Adresse »)', async () => {
  const w = monde();
  const SV = { priv: 'p', pub: 'q', net: '10.8.0', port: 51820, endpoint: 'maison.exemple.fr', iface: 'wg0', lan: ['192.168.1.0/24'], nat: 'aucun' };
  const dns = () => (w.v.ctx('gjoll').settings.server as { dns?: string }).dns ?? '';
  const dehors = (x: string) => x.split(',').map((y) => y.trim()).filter(Boolean).some((y) => !/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(y));
  try {
    for (const [nom, depart] of [['DNS d\'Odin', '10.8.0.1'], ['DNS absent', '']] as const) {
      w.v.ctx('gjoll').saveSettings({ server: { ...SV, dns: depart } });
      const r = await w.v.act('gjoll', 'reseaux', { reseaux: '', dns: '' }); // lot R1 : lancé par le propriétaire (une automatisation est refusée)
      assert.notEqual(r.ok, false, r.text);
      assert.equal(dehors(dns()), false, `${nom} · Réseaux : DNS posé = ${dns()}`);
      w.v.ctx('gjoll').saveSettings({ server: { ...SV, dns: depart } });
      await w.v.act('gjoll', 'adresse', { adresse: 'maison.exemple.fr', port: 51820 });
      assert.equal(dehors(dns()), false, `${nom} · Adresse : DNS posé = ${dns()}`);
    }
  } finally { w.fin(); }
});

test('Vortex · la box trouvée, son DNS est toujours donné aux appareils (inchangé)', async () => {
  const w = monde('default via 192.168.1.1 dev eth0');
  try {
    w.v.ctx('gjoll').saveSettings({ server: { priv: 'p', pub: 'q', net: '10.8.0', port: 51820, endpoint: 'maison.exemple.fr', dns: '', iface: 'wg0', lan: ['192.168.1.0/24'], nat: 'aucun' } });
    assert.notEqual((await w.v.act('gjoll', 'reseaux', { reseaux: '', dns: '' })).ok, false); // lot R1 : par le propriétaire
    assert.equal((w.v.ctx('gjoll').settings.server as { dns: string }).dns, '192.168.1.1');
  } finally { w.fin(); }
});
