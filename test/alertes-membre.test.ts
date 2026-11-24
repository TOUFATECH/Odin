// Les alertes de Sphinx lues par une AUTRE appli (Forseti, Chroniques, Hydre), pour un membre de la famille.
// Règle du propriétaire (26/11) : un membre ne lit que les alertes de Sphinx de l'appareil qu'il tient ; aucun appareil
// reconnu : aucune. La garde le fait déjà pour les routes de Sphinx ; ici c'est le contexte d'une appli (`ctx.alerts`,
// src/valhalla/service.ts) : Forseti montre le fil de toutes les applis, il ne doit pas rouvrir ce que la garde ferme.
// Un VRAI Odin d'essai reçoit de vraies demandes HTTP, depuis Odin lui-même (127.0.0.1) et depuis deux autres adresses
// de la machine (127.0.0.2 et 127.0.0.3) qui tiennent lieu du PC et du téléphone. La prise du serveur d'adresses est
// SIMULÉE (aucun vrai paquet) ; les autres appareils sont en adresses d'exemple (192.0.2.x), MAC de la documentation.
import assert from 'node:assert/strict';
import http from 'node:http';
import { createServer } from 'node:net';
import { after, test } from 'node:test';
import { T } from './banc/lib.ts';
import { vraiOdin, type VraiOdin } from './banc/odin-vrai.ts';
import { allModules, valhallaOf } from '../src/valhalla/odin.ts';
import { MSG, buildPacket, parsePacket, type DhcpConfig, type Packet } from '../src/valhalla/vidarr/dhcp.ts';
import { LOCAL, origineDemande } from '../src/valhalla/vidarr/appareils.ts';
import { PRISE_DHCP, dhcpServer } from '../src/valhalla/modules/vidarr.ts';
import { auNomDe } from '../src/valhalla/sso/acces.ts';

const BOX = '192.0.2.1', ODIN = '192.0.2.2', ICI = '127.0.0.1', PC = '127.0.0.2', TEL = '127.0.0.3';
const M = { box: '00:00:5e:00:53:01', odin: '00:00:5e:00:53:02', pc: '00:00:5e:00:53:23', tel: '00:00:5e:00:53:14', cam: '00:00:5e:00:53:77', tv: '00:00:5e:00:53:88' };
const MDP = 'une-riviere-calme-sous-la-lune-48';
const PRISE = PRISE_DHCP.ecouter, MACS = LOCAL.macs;
after(() => { PRISE_DHCP.ecouter = PRISE; LOCAL.macs = MACS; });

type Rep = { status: number; body: Record<string, any> };
function demande(port: number, chemin: string, o: { corps?: unknown; cookie?: string; depuis?: string } = {}): Promise<Rep> {
  return new Promise((ok, ko) => {
    const corps = o.corps === undefined ? undefined : JSON.stringify(o.corps);
    const r = http.request({ host: '127.0.0.1', port, path: chemin, method: corps === undefined ? 'GET' : 'POST', localAddress: o.depuis ?? ICI, agent: false,
      headers: { host: `127.0.0.1:${port}`, ...(corps === undefined ? {} : { 'content-type': 'application/json', 'x-odin': '1', 'content-length': String(Buffer.byteLength(corps)) }), ...(o.cookie ? { cookie: o.cookie } : {}) } }, (res) => {
      const morceaux: Buffer[] = []; res.on('data', (c: Buffer) => morceaux.push(c));
      res.on('end', () => { const t = Buffer.concat(morceaux).toString('utf8'); let body: Record<string, any> = {}; try { body = JSON.parse(t); } catch { body = { text: t }; } ok({ status: res.statusCode ?? 0, body }); });
    });
    r.on('error', ko); r.end(corps);
  });
}
const adresseLibre = (ip: string) => new Promise<boolean>((ok) => { const s = createServer(); s.once('error', () => ok(false)); s.listen(0, ip, () => s.close(() => ok(true))); });
const cookieDe = (r: Response, nom: string) => r.headers.getSetCookie().find((c) => c.startsWith(`${nom}=`))?.split(';')[0] ?? '';
async function entrer(v: VraiOdin, ident: string, mdp: string): Promise<string> {
  let r = await fetch(`${v.url}/sso/odin`, { redirect: 'manual' }); assert.equal(r.status, 303);
  r = await fetch(new URL(r.headers.get('location')!, v.url), { redirect: 'manual' }); const html = await r.text(), dem = /name="demande" value="([^"]+)"/.exec(html)![1];
  r = await fetch(`${v.url}/sso/autoriser`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded', origin: v.url }, body: new URLSearchParams({ demande: dem, identifiant: ident, motdepasse: mdp }) });
  r = await fetch(r.headers.get('location')!, { redirect: 'manual' }); assert.equal(r.status, 303, 'session ouverte');
  return cookieDe(r, 'odin_session');
}
const paquet = (mac: string, type: number, o: { nom?: string; veut?: string } = {}) => buildPacket({ op: 1, xid: 7, mac, ciaddr: '0.0.0.0', options: [[53, Buffer.from([type])], ...(o.nom !== undefined ? [[12, Buffer.from(o.nom, 'utf8')] as [number, Buffer]] : []), ...(o.veut ? [[50, Buffer.from(o.veut.split('.').map(Number))] as [number, Buffer]] : [])] });

test('un membre ne lit pas, par Forseti, Chroniques ou Hydre, les alertes de Sphinx des autres appareils', { timeout: 240_000 }, async (t) => {
  if (!(await adresseLibre(PC)) || !(await adresseLibre(TEL))) { t.skip('cette machine ne sait pas parler depuis 127.0.0.2 et 127.0.0.3'); return; }
  const tt = new T(), orig = { log: console.log, error: console.error, warn: console.warn };
  for (const k of ['log', 'error', 'warn'] as const) console[k] = () => {};
  try {
    const envois: Packet[] = [];
    PRISE_DHCP.ecouter = async (d) => { (d as unknown as { sock: unknown }).sock = { send: (b: Buffer) => { envois.push(parsePacket(b)); }, close: () => {} }; };
    LOCAL.macs = () => [M.odin];
    const v = await vraiOdin(tt, { compte: true, modules: (o) => allModules(o).filter((m) => ['var', 'vidarr', 'forseti', 'mimisbrunnr', 'ymir'].includes(m.id)) }), va = valhallaOf()!;
    const cfg: DhcpConfig = { server: ODIN, start: '192.0.2.100', end: '192.0.2.199', mask: '255.255.255.0', router: BOX, dns: [ODIN], leaseSeconds: 12 * 3600, domain: 'maison',
      fixed: [{ mac: M.box, ip: BOX, name: 'Box internet' }, { mac: M.pc, ip: PC, name: 'PC du bureau' }, { mac: M.tel, ip: TEL, name: 'Telephone de Nour' }] };
    va.ctx('vidarr').saveSettings({ dhcp: cfg });
    const acte = (module: string, action: string, input: Record<string, unknown> = {}, o: { depuis?: string; confirm?: boolean; cookie?: string } = {}) =>
      demande(v.port, '/api/valhalla/act', { corps: { module, action, input, ...(o.confirm ? { confirm: true } : {}) }, cookie: o.cookie ?? v.session, depuis: o.depuis });
    const r = await acte('vidarr', 'dhcp_demarrer', { forcer: true }, { confirm: true });
    assert.equal(r.body.ok, true, JSON.stringify(r.body));
    const prend = (mac: string, nom: string) => { const n = envois.length; dhcpServer()!.onMessage(paquet(mac, MSG.DISCOVER, { nom })); const ip = envois[n].yiaddr; dhcpServer()!.onMessage(paquet(mac, MSG.REQUEST, { nom, veut: ip })); return ip; };
    const ipCam = prend(M.cam, 'Camera-Jardin'), ipTv = prend(M.tv, 'Tele-Salon'); prend(M.tel, 'Telephone-Nour');
    // Une alerte d'une autre appli (Forseti lui-même) : elle n'est pas de Sphinx, un membre qui a Forseti la lit toujours.
    va.alert('forseti', { level: 'moyenne', title: 'Certificat bientôt expiré : exemple.test', key: 'cert-exemple' });
    // Deux alertes de Sphinx plus graves (la phrase « les alertes » ne montre pas le niveau « info ») : une pour la caméra, une pour le téléphone.
    va.alert('vidarr', { level: 'haute', title: 'Menace bloquée pour Camera-Jardin', detail: `Adresse ${ipCam} (MAC ${M.cam}).`, key: `essai-menace-${M.cam}`, data: { ip: ipCam, mac: M.cam } });
    va.alert('vidarr', { level: 'haute', title: 'Menace bloquée pour Telephone de Nour', detail: `Adresse ${TEL} (MAC ${M.tel}).`, key: `essai-menace-${M.tel}`, data: { ip: TEL, mac: M.tel } });

    assert.equal((await va.act('var', 'ajouter', { login: 'nour', nom: 'Nour', groupes: 'invite', mot_de_passe: MDP })).ok, true);
    for (const appli of ['odin', 'vidarr', 'forseti', 'mimisbrunnr', 'ymir']) assert.equal((await va.act('var', 'donner_acces', { appli, qui: '@nour' })).ok, true, appli);
    assert.equal((await va.act('var', 'ajouter', { login: 'sam', nom: 'Sam', groupes: 'invite', mot_de_passe: MDP })).ok, true);
    for (const appli of ['odin', 'forseti']) assert.equal((await va.act('var', 'donner_acces', { appli, qui: '@sam' })).ok, true, appli);
    const nour = await entrer(v, 'nour', MDP), sam = await entrer(v, 'sam', MDP);
    assert.ok(nour && sam, 'les deux membres ont une session');

    const autres = [M.cam, M.tv, 'Camera-Jardin', 'Tele-Salon', ipCam, ipTv], mien = [M.tel, 'Telephone de Nour'];
    /** Les quatre lectures de Forseti (page, « Dernières alertes », « Chasser », la phrase) et celle de Chroniques. */
    const lectures: Array<[string, (cookie: string, depuis: string) => Promise<Rep>]> = [
      ['la page de Forseti', (cookie, depuis) => demande(v.port, '/api/valhalla/view?id=forseti', { cookie, depuis })],
      ['Forseti « Dernières alertes »', (cookie, depuis) => acte('forseti', 'alertes', { gravite: 'info' }, { cookie, depuis })],
      ['Forseti « Chasser »', (cookie, depuis) => acte('forseti', 'chercher', { q: 'appareil' }, { cookie, depuis })],
      ['la phrase « les alertes »', (cookie, depuis) => demande(v.port, '/api/valhalla/order', { corps: { text: 'les alertes' }, cookie, depuis })],
      ['Chroniques « Chercher dans les journaux »', (cookie, depuis) => acte('mimisbrunnr', 'chercher', { q: '', niveau: 'info' }, { cookie, depuis })],
    ];
    const lire = async (cookie: string, depuis: string, sauf: string[] = []) => {
      const vus: Record<string, string[]> = {}; let texte = '';
      for (const [nom, f] of lectures) {
        if (sauf.includes(nom)) continue;
        const x = await f(cookie, depuis), tx = JSON.stringify(x.body); texte += tx;
        assert.equal(x.status, 200, `${nom} : ${tx.slice(0, 300)}`);
        vus[nom] = [...autres, ...mien].filter((sec) => tx.includes(sec));
      }
      return { vus, texte };
    };
    const fuites = (x: { vus: Record<string, string[]> }) => Object.entries(x.vus).flatMap(([nom, l]) => l.filter((sec) => autres.includes(sec)).map((sec) => `${nom} : « ${sec} »`));

    await t.test('contrôle : le propriétaire lit toujours toutes les alertes, par les cinq lectures', async () => {
      const x = await lire(v.session, ICI);
      for (const [nom] of lectures) { assert.ok(x.vus[nom].includes('Camera-Jardin'), `${nom} : le propriétaire lit l'alerte de la caméra`); assert.ok(x.vus[nom].includes('Telephone de Nour'), `${nom} : et celle du téléphone`); }
      assert.match(x.texte, /Certificat bientôt expiré/);
    });

    await t.test('le membre, depuis le téléphone : seulement l\'alerte de Sphinx du téléphone', async () => {
      const x = await lire(nour, TEL);
      assert.deepEqual(fuites(x), [], 'rien des autres appareils');
      for (const [nom] of lectures) assert.ok(x.vus[nom].includes('Telephone de Nour'), `${nom} : la sienne lui est remise`);
      assert.match(x.texte, /Certificat bientôt expiré/, 'les alertes des autres applis ne changent pas');
    });

    await t.test('le membre, depuis le PC ou depuis Odin lui-même : aucune alerte de Sphinx', async () => {
      for (const depuis of [PC, ICI]) {
        const x = await lire(nour, depuis);
        assert.deepEqual(fuites(x), [], `depuis ${depuis} : rien des autres appareils`);
        assert.doesNotMatch(x.texte, /Nouvel appareil|Menace bloquée/, `depuis ${depuis} : aucune alerte de Sphinx, pas même celle du téléphone`);
        assert.match(x.texte, /Certificat bientôt expiré/, 'les alertes des autres applis ne changent pas');
      }
    });

    await t.test('un membre qui a Forseti mais pas Sphinx : aucune alerte de Sphinx, même depuis le téléphone', async () => {
      const x = await lire(sam, TEL, ['Chroniques « Chercher dans les journaux »']);
      assert.deepEqual(fuites(x), []);
      assert.doesNotMatch(x.texte, /Nouvel appareil|Menace bloquée/); assert.ok(!x.texte.includes(M.tel));
      assert.match(x.texte, /Certificat bientôt expiré/);
    });

    await t.test('le contexte de chaque appli (ce que lisent Chroniques et la fiche d\'une machine de Hydre)', async () => {
      const qui = { login: 'nour', name: 'Nour', groups: ['invite'] };
      const lu = (appli: string, depuis: string | undefined, o: { q?: string; limit?: number } = { limit: 500 }) => {
        const f = () => auNomDe(qui, () => va.ctx(appli).alerts(o));
        return (depuis === undefined ? f() : origineDemande.run(depuis, f)).filter((a) => a.module === 'vidarr').map((a) => String(a.data?.mac));
      };
      for (const appli of ['forseti', 'mimisbrunnr', 'ymir']) {
        assert.deepEqual([...new Set(lu(appli, TEL))], [M.tel], `${appli}, depuis le téléphone : la sienne seule`);
        assert.deepEqual(lu(appli, PC), [], `${appli}, depuis le PC : aucune`);
        assert.deepEqual(lu(appli, ICI), [], `${appli}, depuis Odin lui-même : aucune`);
        assert.deepEqual(lu(appli, undefined), [], `${appli}, origine inconnue : aucune`);
        // La recherche de la fiche d'une machine de Hydre (par adresse, par nom) : même règle.
        assert.deepEqual(lu(appli, PC, { q: ipCam, limit: 40 }), [], `${appli} : la recherche par adresse ne rend pas l'alerte d'un autre`);
        assert.deepEqual(lu(appli, PC, { q: 'Camera-Jardin', limit: 40 }), [], `${appli} : ni la recherche par nom`);
        // Sans personne qui agit (le propriétaire, une automatisation, Odin lui-même) : rien ne change.
        const tout = va.ctx(appli).alerts({ limit: 500 }).filter((a) => a.module === 'vidarr').map((a) => String(a.data?.mac));
        assert.ok(tout.includes(M.cam) && tout.includes(M.tv) && tout.includes(M.tel), `${appli} : le propriétaire lit tout`);
      }
      // Sphinx lui-même n'est pas touché ici (ses routes sont filtrées par la garde).
      assert.ok(origineDemande.run(PC, () => auNomDe(qui, () => va.ctx('vidarr').alerts({ limit: 500 }))).some((a) => a.data?.mac === M.cam), 'le contexte de Sphinx reste entier');
    });
  } finally { Object.assign(console, orig); await tt.end(); }
});
