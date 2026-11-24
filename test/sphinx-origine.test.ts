// Sphinx · d'où vient la demande, de bout en bout. Le serveur web pose l'adresse de l'appareil qui fait la demande
// (src/web/server.ts, `origineDemande`) ; Sphinx la lit (lot R2 : « l'appareil que tu tiens », l'avertissement avant de
// bloquer, ce qu'un membre de la famille a le droit de voir). Ici un VRAI Odin d'essai (serveur web + applis) reçoit de
// vraies demandes HTTP :
//  - depuis Odin lui-même (127.0.0.1) ;
//  - depuis deux autres adresses de la machine (127.0.0.2 et 127.0.0.3), qui tiennent lieu de deux appareils de la
//    maison : Sphinx leur réserve ces adresses, donc « l'appareil que tu tiens » se vérifie pour de vrai ;
//  - derrière un proxy (accès « Internet » + `behindProxy`) : l'origine est inconnue, jamais l'adresse du proxy.
// La prise du serveur d'adresses est SIMULÉE (aucun vrai paquet, aucun port 67/68) ; les baux des autres appareils
// sont en adresses d'exemple (192.0.2.x), les adresses MAC sont celles de la documentation.
import assert from 'node:assert/strict';
import http from 'node:http';
import { createServer } from 'node:net';
import { after, test } from 'node:test';
import { T, freePort } from './banc/lib.ts';
import { vraiOdin, type VraiOdin } from './banc/odin-vrai.ts';
import { WebChannel } from '../src/web/server.ts';
import { allModules, valhallaOf } from '../src/valhalla/odin.ts';
import type { Module } from '../src/valhalla/types.ts';
import { MSG, buildPacket, parsePacket, type DhcpConfig, type Packet } from '../src/valhalla/vidarr/dhcp.ts';
import { LOCAL, depuisAdresse, origineDemande } from '../src/valhalla/vidarr/appareils.ts';
import { PRISE_DHCP, dhcpServer } from '../src/valhalla/modules/vidarr.ts';
import { lierProprietaire, persona } from '../src/valhalla/sso/etat.ts';

const BOX = '192.0.2.1', ODIN = '192.0.2.2', ICI = '127.0.0.1', PC = '127.0.0.2', TEL = '127.0.0.3';
const M = { box: '00:00:5e:00:53:01', odin: '00:00:5e:00:53:02', pc: '00:00:5e:00:53:23', tel: '00:00:5e:00:53:14', cam: '00:00:5e:00:53:77', tv: '00:00:5e:00:53:88', imp: '00:00:5e:00:53:99' };
const MDP = 'une-riviere-calme-sous-la-lune-48';
const PRISE = PRISE_DHCP.ecouter, MACS = LOCAL.macs;
after(() => { PRISE_DHCP.ecouter = PRISE; LOCAL.macs = MACS; });

// Un minuteur de fond, lancé AVANT toute demande (comme ceux d'Odin : surveillance, ping des pages ouvertes) : il note
// l'origine qu'il voit à chaque passage. Il ne doit jamais en voir une.
const fond: Array<string | undefined> = [];
const minuteurFond = setInterval(() => { fond.push(origineDemande.getStore()); }, 4);
after(() => clearInterval(minuteurFond));

/** Ce que les minuteurs lancés PENDANT une demande ont vu ensuite (ils gardent l'origine de LEUR demande, jamais celle d'une autre). */
const apres: Array<{ marque: string; vu: string }> = [];
const attendre = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

/** La fonction d'essai : une appli qui rend telle quelle l'origine que le serveur a posée pour la demande en cours. */
const sonde = {
  id: 'sonde', name: 'Sonde', family: 'Sécurité', what: 'Essai : rend l\'origine de la demande', does: [], from: [], upstream: [], words: [],
  actions: [
    { id: 'origine', label: 'Origine', what: 'L\'origine de la demande en cours', read: true, quick: false, params: [{ key: 'attente', label: 'Attente (ms)', kind: 'number', default: 0 }, { key: 'marque', label: 'Marque', kind: 'text', default: '' }],
      run: async (_ctx: unknown, i: Record<string, unknown>) => {
        const avant = depuisAdresse(), brut = origineDemande.getStore();
        const marque = String(i.marque ?? '');
        if (marque) setTimeout(() => { apres.push({ marque, vu: depuisAdresse() }); }, 15);
        // Plusieurs attentes de suite : les demandes se croisent vraiment dans la boucle d'événements.
        const ms = Number(i.attente) || 0; for (let k = 0; k < 4; k++) await attendre(ms / 4);
        return { text: 'ok', data: { origine: depuisAdresse(), avant, brut: brut === undefined ? null : brut, marque } };
      } },
  ],
  view: () => ({ title: 'Sonde', blocks: [] }),
} as unknown as Module;

type Rep = { status: number; body: Record<string, any> };
/** Une vraie demande HTTP vers Odin, depuis l'adresse choisie de la machine (`depuis`). */
function demande(port: number, chemin: string, o: { corps?: unknown; cookie?: string; depuis?: string; entetes?: Record<string, string> } = {}): Promise<Rep> {
  return new Promise((ok, ko) => {
    const corps = o.corps === undefined ? undefined : JSON.stringify(o.corps);
    const r = http.request({ host: '127.0.0.1', port, path: chemin, method: corps === undefined ? 'GET' : 'POST', localAddress: o.depuis ?? ICI, agent: false,
      headers: { host: `127.0.0.1:${port}`, ...(corps === undefined ? {} : { 'content-type': 'application/json', 'x-odin': '1', 'content-length': String(Buffer.byteLength(corps)) }), ...(o.cookie ? { cookie: o.cookie } : {}), ...o.entetes } }, (res) => {
      const morceaux: Buffer[] = []; res.on('data', (c: Buffer) => morceaux.push(c));
      res.on('end', () => { const t = Buffer.concat(morceaux).toString('utf8'); let body: Record<string, any> = {}; try { body = JSON.parse(t); } catch { body = { text: t }; } ok({ status: res.statusCode ?? 0, body }); });
    });
    r.on('error', ko); r.end(corps);
  });
}
/** Cette machine sait-elle parler depuis cette adresse (127.0.0.2…) ? Linux et Windows : oui. */
const adresseLibre = (ip: string) => new Promise<boolean>((ok) => { const s = createServer(); s.once('error', () => ok(false)); s.listen(0, ip, () => s.close(() => ok(true))); });

const cookieDe = (r: Response, nom: string) => r.headers.getSetCookie().find((c) => c.startsWith(`${nom}=`))?.split(';')[0] ?? '';
/** La connexion d'une personne de Persona à l'interface d'Odin, comme un navigateur : rend le cookie de sa session. */
async function entrer(v: VraiOdin, ident: string, mdp: string): Promise<string> {
  let r = await fetch(`${v.url}/sso/odin`, { redirect: 'manual' }); assert.equal(r.status, 303);
  r = await fetch(new URL(r.headers.get('location')!, v.url), { redirect: 'manual' }); const html = await r.text(), dem = /name="demande" value="([^"]+)"/.exec(html)![1];
  r = await fetch(`${v.url}/sso/autoriser`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded', origin: v.url }, body: new URLSearchParams({ demande: dem, identifiant: ident, motdepasse: mdp }) });
  r = await fetch(r.headers.get('location')!, { redirect: 'manual' }); assert.equal(r.status, 303, 'session ouverte');
  return cookieDe(r, 'odin_session');
}
const paquet = (mac: string, type: number, o: { nom?: string; veut?: string } = {}) => buildPacket({ op: 1, xid: 7, mac, ciaddr: '0.0.0.0', options: [[53, Buffer.from([type])], ...(o.nom !== undefined ? [[12, Buffer.from(o.nom, 'utf8')] as [number, Buffer]] : []), ...(o.veut ? [[50, Buffer.from(o.veut.split('.').map(Number))] as [number, Buffer]] : [])] });

test('Sphinx sait d\'où vient la demande : le propriétaire, le garde-fou « ici », le proxy, deux demandes à la fois, un membre', { timeout: 240_000 }, async (t) => {
  if (!(await adresseLibre(PC)) || !(await adresseLibre(TEL))) { t.skip('cette machine ne sait pas parler depuis 127.0.0.2 et 127.0.0.3'); return; }
  const tt = new T(), orig = { log: console.log, error: console.error, warn: console.warn };
  for (const k of ['log', 'error', 'warn'] as const) console[k] = () => {};
  try {
    const envois: Packet[] = [];
    PRISE_DHCP.ecouter = async (d) => { (d as unknown as { sock: unknown }).sock = { send: (b: Buffer) => { envois.push(parsePacket(b)); }, close: () => {} }; };
    LOCAL.macs = () => [M.odin];
    const v = await vraiOdin(tt, { compte: true, modules: (o) => [...allModules(o).filter((m) => ['var', 'vidarr'].includes(m.id)), sonde] }), va = valhallaOf()!;
    // Le PC du bureau et le téléphone ont chacun leur adresse réservée (celles d'où partiront leurs demandes).
    const cfg: DhcpConfig = { server: ODIN, start: '192.0.2.100', end: '192.0.2.199', mask: '255.255.255.0', router: BOX, dns: [ODIN], leaseSeconds: 12 * 3600, domain: 'maison',
      fixed: [{ mac: M.box, ip: BOX, name: 'Box internet' }, { mac: M.pc, ip: PC, name: 'PC du bureau' }, { mac: M.tel, ip: TEL, name: 'Telephone de Nour' }] };
    va.ctx('vidarr').saveSettings({ dhcp: cfg });

    const proprio = (chemin: string, corps?: unknown, depuis = ICI, port = v.port, entetes?: Record<string, string>) => demande(port, chemin, { corps, cookie: v.session, depuis, entetes });
    const acte = (action: string, input: Record<string, unknown> = {}, o: { depuis?: string; confirm?: boolean; module?: string; port?: number; cookie?: string; entetes?: Record<string, string> } = {}) =>
      demande(o.port ?? v.port, '/api/valhalla/act', { corps: { module: o.module ?? 'vidarr', action, input, ...(o.confirm ? { confirm: true } : {}) }, cookie: o.cookie ?? v.session, depuis: o.depuis, entetes: o.entetes });
    const appareils = (r: Rep) => (r.body.data?.appareils ?? []) as Array<{ mac: string; nom: string; ip: string; ici: boolean; etat: string; garde: string }>;
    const etatDe = async (mac: string) => appareils(await acte('baux_vus')).find((d) => d.mac === mac)?.etat;

    // Le propriétaire allume le DHCP d'Odin par la page (la prise est simulée) ; deux autres appareils prennent une adresse.
    let r = await acte('dhcp_demarrer', { forcer: true }, { confirm: true });
    assert.equal(r.body.ok, true, JSON.stringify(r.body));
    const prend = (mac: string, nom: string) => { const n = envois.length; dhcpServer()!.onMessage(paquet(mac, MSG.DISCOVER, { nom })); const ip = envois[n].yiaddr; dhcpServer()!.onMessage(paquet(mac, MSG.REQUEST, { nom, veut: ip })); return ip; };
    // (L'imprimante prend la première adresse de la plage : la plage, elle, n'est pas un secret ; son adresse n'est donc pas cherchée plus bas.)
    prend(M.imp, 'Imprimante-Bureau');
    const ipCam = prend(M.cam, 'Camera-Jardin'), ipTv = prend(M.tv, 'Tele-Salon');
    assert.match(ipCam, /^192\.0\.2\.1\d\d$/); assert.match(ipTv, /^192\.0\.2\.1\d\d$/);

    // ---------------------------------------------------------------- a) l'origine arrive jusqu'à Sphinx
    await t.test('a) la demande du propriétaire arrive avec son origine', async () => {
      r = await acte('origine', {}, { module: 'sonde' });
      assert.equal(r.status, 200, JSON.stringify(r.body));
      assert.equal(r.body.data.origine, ICI, 'depuis Odin lui-même');
      r = await acte('origine', {}, { module: 'sonde', depuis: PC });
      assert.equal(r.body.data.origine, PC, 'une autre adresse est transmise telle quelle');
      r = await acte('origine', {}, { module: 'sonde', depuis: TEL });
      assert.equal(r.body.data.origine, TEL);

      // Depuis Odin lui-même : l'origine est connue, aucun appareil n'est « celui que tu tiens », et tout est listé.
      r = await acte('baux_vus');
      assert.equal(r.body.data.origineConnue, true, 'depuis Odin lui-même : origine connue');
      assert.equal(r.body.data.proprietaire, true);
      assert.deepEqual(appareils(r).map((d) => d.mac).sort(), [M.box, M.pc, M.tel, M.cam, M.tv, M.imp].sort(), 'le propriétaire voit tout');
      assert.deepEqual(appareils(r).filter((d) => d.ici), [], 'personne n\'est « ici » depuis Odin lui-même');
      // Depuis le PC : c'est lui, et lui seul, que l'on tient.
      r = await acte('baux_vus', {}, { depuis: PC });
      assert.equal(r.body.data.origineConnue, true, 'depuis une adresse réservée : origine connue');
      assert.deepEqual(appareils(r).filter((d) => d.ici).map((d) => d.mac), [M.pc]);
      assert.equal(appareils(r).length, 6, 'le propriétaire voit toujours tout');
      r = await acte('baux_vus', {}, { depuis: TEL });
      assert.deepEqual(appareils(r).filter((d) => d.ici).map((d) => d.mac), [M.tel]);
      // La même chose par la page générique (GET) : l'origine passe aussi par là.
      r = await proprio('/api/valhalla/view?id=vidarr', undefined, PC);
      assert.equal(r.status, 200);
    });

    // ---------------------------------------------------------------- b) bloquer l'appareil que l'on tient
    await t.test('b) bloquer l\'appareil que l\'on tient : refusé (« ici ») tant que ce n\'est pas dit en clair', async () => {
      // La confirmation prévient déjà.
      r = await acte('dhcp_mac_etat', { mac: M.pc, etat: 'bloque' }, { depuis: PC });
      assert.equal(r.body.ok, false); assert.match(String(r.body.confirm), /ATTENTION : c'est l'appareil que tu tiens/);
      // Confirmé, mais sans « c'est le mien » : refusé, code « ici », rien n'est changé.
      r = await acte('dhcp_mac_etat', { mac: M.pc, etat: 'bloque' }, { depuis: PC, confirm: true });
      assert.equal(r.body.ok, false, JSON.stringify(r.body));
      assert.equal(r.body.data?.code, 'ici');
      assert.match(String(r.body.text), /l'appareil que tu tiens en ce moment/);
      assert.equal(await etatDe(M.pc), 'actif', 'rien n\'est fait');
      // « le_mien » faux, ou écrit autrement que vrai : toujours refusé.
      for (const le_mien of [false, 'true', 1, 'oui']) {
        r = await acte('dhcp_mac_etat', { mac: M.pc, etat: 'bloque', le_mien }, { depuis: PC, confirm: true });
        assert.equal(r.body.data?.code, 'ici', `le_mien = ${JSON.stringify(le_mien)}`);
      }
      r = await acte('dhcp_mac_etat', { mac: M.pc, etat: 'pause' }, { depuis: PC, confirm: true });
      assert.equal(r.body.data?.code, 'ici', 'mettre en pause : même garde-fou');
      assert.equal(await etatDe(M.pc), 'actif');
      // Le même geste depuis un AUTRE appareil (le téléphone) ou depuis Odin lui-même : ce n'est pas « ici », il passe.
      r = await acte('dhcp_mac_etat', { mac: M.pc, etat: 'bloque' }, { depuis: TEL });
      assert.doesNotMatch(String(r.body.confirm), /ATTENTION|ne sait pas/, 'pas d\'avertissement : ce n\'est pas l\'appareil tenu, et l\'origine est connue');
      r = await acte('dhcp_mac_etat', { mac: M.pc, etat: 'bloque' });
      assert.doesNotMatch(String(r.body.confirm), /ATTENTION|ne sait pas/, 'depuis Odin lui-même : pas d\'avertissement');
      r = await acte('dhcp_mac_etat', { mac: M.pc, etat: 'bloque' }, { depuis: TEL, confirm: true });
      assert.equal(r.body.ok, true, JSON.stringify(r.body)); assert.equal(await etatDe(M.pc), 'bloque');
      r = await acte('dhcp_mac_etat', { mac: M.pc, etat: 'actif' }, { depuis: TEL });
      assert.equal(r.body.ok, true); assert.equal(await etatDe(M.pc), 'actif');
      // Dit en clair depuis l'appareil lui-même : fait.
      r = await acte('dhcp_mac_etat', { mac: M.pc, etat: 'bloque', le_mien: true }, { depuis: PC, confirm: true });
      assert.equal(r.body.ok, true, JSON.stringify(r.body)); assert.equal(await etatDe(M.pc), 'bloque');
      // Débloquer passe toujours, même depuis l'appareil lui-même.
      r = await acte('dhcp_mac_etat', { mac: M.pc, etat: 'actif' }, { depuis: PC });
      assert.equal(r.body.ok, true); assert.equal(await etatDe(M.pc), 'actif');
    });

    // ---------------------------------------------------------------- c) derrière un proxy
    const portProxy = await freePort();
    v.o.cfg.web.behindProxy = true;
    const webProxy = new WebChannel(v.o, { scanNetwork: async () => undefined }, { port: portProxy, host: '127.0.0.1', token: v.token, access: 'wan', scryptN: 1024 });
    await webProxy.start(async () => {}); tt.onEnd(() => webProxy.stop());
    await t.test('c) derrière un proxy : origine inconnue, l\'avertissement reste', async () => {
      // Le proxy tourne sur la machine du PC (127.0.0.2) et annonce un visiteur : ni l'une ni l'autre adresse n'est prise pour « ici ».
      for (const [depuis, fwd] of [[ICI, PC], [PC, PC], [PC, ipCam], [TEL, '203.0.113.9'], [PC, '']] as const) {
        const entetes = fwd ? { 'x-forwarded-for': fwd } : undefined, cas = `proxy à ${depuis}, visiteur annoncé ${fwd || 'aucun'}`;
        r = await acte('origine', {}, { module: 'sonde', port: portProxy, depuis, entetes });
        assert.equal(r.status, 200, `${cas} : ${JSON.stringify(r.body)}`);
        assert.equal(r.body.data.origine, '', `${cas} : origine inconnue`);
        assert.equal(r.body.data.brut, '', `${cas} : posée vide (pas l'adresse du proxy)`);
        r = await acte('baux_vus', {}, { port: portProxy, depuis, entetes });
        assert.equal(r.body.data.origineConnue, false, `${cas} : Odin ne sait pas d'où l'on agit`);
        assert.deepEqual(appareils(r).filter((d) => d.ici), [], `${cas} : aucun appareil « ici »`);
        assert.equal(appareils(r).length, 6, 'le propriétaire voit toujours tout');
        r = await acte('dhcp_mac_etat', { mac: M.pc, etat: 'bloque' }, { port: portProxy, depuis, entetes });
        assert.match(String(r.body.confirm), /Odin ne sait pas depuis quel appareil tu agis/, `${cas} : l'avertissement reste`);
        assert.doesNotMatch(String(r.body.confirm), /c'est l'appareil que tu tiens/);
      }
      // La box, Odin : refusés de toute façon, sans l'avertissement (ce n'est pas l'appareil tenu).
      r = await acte('dhcp_mac_etat', { mac: M.box, etat: 'bloque' }, { port: portProxy, depuis: PC, entetes: { 'x-forwarded-for': PC } });
      assert.doesNotMatch(String(r.body.confirm), /ne sait pas/);
      // Pendant ce temps, l'interface locale connaît toujours l'origine.
      r = await acte('baux_vus', {}, { depuis: PC });
      assert.equal(r.body.data.origineConnue, true); assert.deepEqual(appareils(r).filter((d) => d.ici).map((d) => d.mac), [M.pc]);
    });

    // ---------------------------------------------------------------- d) deux demandes à la fois
    await t.test('d) des demandes simultanées de plusieurs origines ne se mélangent pas ; rien ne fuit vers le fond', async () => {
      const cas: Array<{ depuis: string; port: number; attendu: string }> = [
        { depuis: ICI, port: v.port, attendu: ICI }, { depuis: PC, port: v.port, attendu: PC }, { depuis: TEL, port: v.port, attendu: TEL }, { depuis: PC, port: portProxy, attendu: '' },
      ];
      const avantFond = fond.length; apres.length = 0;
      const lot: Array<Promise<void>> = [];
      for (let k = 0; k < 48; k++) {
        const c = cas[k % cas.length], marque = `m${k}`, attente = [40, 8, 24, 0, 60, 16][k % 6];
        lot.push(acte('origine', { attente, marque }, { module: 'sonde', depuis: c.depuis, port: c.port, entetes: c.port === portProxy ? { 'x-forwarded-for': TEL } : undefined }).then((x) => {
          assert.equal(x.status, 200, JSON.stringify(x.body));
          assert.equal(x.body.data.marque, marque);
          assert.equal(x.body.data.avant, c.attendu, `${marque} : à l'entrée`);
          assert.equal(x.body.data.origine, c.attendu, `${marque} : après les attentes, toujours la sienne`);
        }));
        // Sphinx, au même moment : « ici » suit la demande, pas la voisine.
        if (k % 4 === 1) lot.push(acte('baux_vus', {}, { depuis: PC }).then((x) => assert.deepEqual(appareils(x).filter((d) => d.ici).map((d) => d.mac), [M.pc])));
        if (k % 4 === 2) lot.push(acte('baux_vus', {}, { depuis: TEL }).then((x) => assert.deepEqual(appareils(x).filter((d) => d.ici).map((d) => d.mac), [M.tel])));
        if (k % 4 === 3) lot.push(acte('baux_vus', {}, { depuis: PC, port: portProxy }).then((x) => { assert.equal(x.body.data.origineConnue, false); assert.deepEqual(appareils(x).filter((d) => d.ici), []); }));
        if (k % 4 === 0) lot.push(acte('baux_vus').then((x) => { assert.equal(x.body.data.origineConnue, true); assert.deepEqual(appareils(x).filter((d) => d.ici), []); }));
        // Une action lancée hors de toute demande web (une automatisation, le soin) pendant que des demandes sont en cours : aucune origine.
        if (k % 8 === 5) lot.push(va.act('sonde', 'origine', { attente: 12 }).then((x) => assert.equal((x.data as { brut: unknown }).brut, null, 'hors demande web : rien n\'est posé')));
        if (k % 6 === 0) await attendre(3);
      }
      await Promise.all(lot);
      // D'affilée sur la MÊME connexion gardée ouverte (comme un navigateur) : chaque demande a bien la sienne.
      const agent = new http.Agent({ keepAlive: true, maxSockets: 1 });
      const suite = (port: number, depuis: string) => new Promise<string>((ok, ko) => {
        const corps = JSON.stringify({ module: 'sonde', action: 'origine', input: {} });
        const q = http.request({ host: '127.0.0.1', port, path: '/api/valhalla/act', method: 'POST', agent, localAddress: depuis, headers: { 'content-type': 'application/json', 'x-odin': '1', cookie: v.session, 'content-length': String(Buffer.byteLength(corps)) } }, (res) => { let s = ''; res.on('data', (c) => { s += c; }); res.on('end', () => ok(String(JSON.parse(s).data?.origine))); });
        q.on('error', ko); q.end(corps);
      });
      for (let k = 0; k < 6; k++) assert.equal(await suite(v.port, PC), PC);
      agent.destroy();
      await attendre(60);
      // Le minuteur de fond a tourné pendant tout ce temps : il n'a jamais vu d'origine.
      assert.ok(fond.length > avantFond + 5, 'le minuteur de fond a tourné pendant les demandes');
      assert.deepEqual([...new Set(fond)], [undefined], 'aucune origine n\'a fui vers un minuteur de fond');
      assert.equal(origineDemande.getStore(), undefined, 'hors du serveur : aucune origine');
      // Un minuteur lancé PENDANT une demande garde l'origine de cette demande-là, jamais celle d'une autre.
      assert.equal(apres.length, 48);
      for (const a of apres) { const k = Number(a.marque.slice(1)); assert.equal(a.vu, cas[k % cas.length].attendu, `${a.marque} : son minuteur a vu la sienne`); }
      // Et une action lancée après coup, hors demande web : toujours rien.
      const hors = await va.act('sonde', 'origine', {});
      assert.equal((hors.data as { brut: unknown }).brut, null);
    });

    // ---------------------------------------------------------------- e) un membre de la famille
    await t.test('e) un membre voit seulement l\'appareil qu\'il tient', async () => {
      assert.equal((await va.act('var', 'ajouter', { login: 'nour', nom: 'Nour', groupes: 'invite', mot_de_passe: MDP })).ok, true);
      for (const appli of ['odin', 'vidarr']) assert.equal((await va.act('var', 'donner_acces', { appli, qui: '@nour' })).ok, true);
      lierProprietaire(persona()!);
      const nour = await entrer(v, 'nour', MDP);
      assert.ok(nour, 'le membre a une session');
      const m = (action: string, input: Record<string, unknown>, depuis: string, port = v.port, entetes?: Record<string, string>) => acte(action, input, { cookie: nour, depuis, port, entetes });
      const autres = (mien: string) => [M.pc, M.tel, M.cam, M.tv, M.imp, M.box, 'PC du bureau', 'Telephone de Nour', 'Camera-Jardin', 'Tele-Salon', 'Imprimante-Bureau', ipCam, ipTv, PC, TEL].filter((x) => !mien.includes(x));

      // Depuis le téléphone : le téléphone, et rien d'autre.
      r = await m('baux_vus', {}, TEL);
      assert.equal(r.status, 200, JSON.stringify(r.body));
      assert.equal(r.body.data.proprietaire, false);
      assert.deepEqual(appareils(r).map((d) => d.mac), [M.tel]);
      assert.deepEqual(r.body.data.chiffres.connus, 1, 'les chiffres ne comptent que le sien');
      assert.match(String(r.body.data.limite), /Tu ne vois que l'appareil que tu tiens/);
      const mienTel = `${M.tel} Telephone de Nour ${TEL}`;
      for (const x of autres(mienTel)) assert.ok(!JSON.stringify(r.body).includes(x), `depuis le téléphone, la réponse ne dit rien de « ${x} »`);
      // Depuis le PC : le PC, et rien d'autre.
      r = await m('baux_vus', {}, PC);
      assert.deepEqual(appareils(r).map((d) => d.mac), [M.pc]);
      for (const x of autres(`${M.pc} PC du bureau ${PC}`)) assert.ok(!JSON.stringify(r.body).includes(x), `depuis le PC, la réponse ne dit rien de « ${x} »`);
      // Depuis Odin lui-même (aucun appareil de la liste) : rien.
      r = await m('baux_vus', {}, ICI);
      assert.deepEqual(appareils(r), []);
      assert.match(String(r.body.text), /ne reconnaît pas l'appareil que tu tiens/);
      for (const x of autres('')) assert.ok(!JSON.stringify(r.body).includes(x), `sans appareil reconnu, la réponse ne dit rien de « ${x} »`);
      // Derrière le proxy (origine inconnue) : rien non plus, même si le proxy annonce l'adresse d'un appareil.
      r = await m('baux_vus', {}, TEL, portProxy, { 'x-forwarded-for': TEL });
      assert.equal(r.status, 200, JSON.stringify(r.body));
      assert.deepEqual(appareils(r), []);
      for (const x of autres('')) assert.ok(!JSON.stringify(r.body).includes(x), `derrière le proxy, la réponse ne dit rien de « ${x} »`);

      // Les autres lectures : les baux, la fiche d'un poste, la page de Sphinx.
      r = await m('baux', {}, TEL);
      for (const x of autres(mienTel)) assert.ok(!JSON.stringify(r.body).includes(x), `les baux ne disent rien de « ${x} »`);
      r = await m('recap_machine', { mac: M.cam }, TEL);
      assert.notEqual(r.body.ok, true, 'la fiche d\'un autre appareil : refusée');
      for (const x of autres(mienTel)) assert.ok(!JSON.stringify(r.body).includes(x), `le refus de la fiche ne dit rien de « ${x} »`);
      const inconnu = await m('recap_machine', { mac: '00:00:5e:00:53:aa' }, TEL);
      assert.equal(String(inconnu.body.text ?? inconnu.body.error), String(r.body.text ?? r.body.error), 'même réponse, que l\'appareil existe ou non');
      r = await m('recap_machine', { mac: M.tel }, TEL);
      assert.equal(r.body.ok, true, `sa propre fiche : ${JSON.stringify(r.body)}`);
      r = await demande(v.port, '/api/valhalla/view?id=vidarr', { cookie: nour, depuis: TEL });
      assert.equal(r.status, 200, JSON.stringify(r.body).slice(0, 300));
      // (Les alertes jointes à la page sont regardées à part, plus bas.)
      const sansAlertes = (x: Rep) => JSON.stringify({ ...x.body, alerts: undefined });
      for (const x of autres(mienTel)) assert.ok(!sansAlertes(r).includes(x), `la page de Sphinx, pour un membre, ne dit rien de « ${x} »`);
      r = await demande(v.port, '/api/valhalla/view?id=vidarr', { cookie: nour, depuis: ICI });
      for (const x of autres('')) assert.ok(!sansAlertes(r).includes(x), `la page de Sphinx, sans appareil reconnu, ne dit rien de « ${x} »`);

      // Les gestes restent au propriétaire : ni bloquer un autre, ni le sien, ni « je le connais ».
      for (const [mac, depuis] of [[M.cam, TEL], [M.tel, TEL], [M.pc, PC]] as const) {
        r = await m('dhcp_mac_etat', { mac, etat: 'bloque', le_mien: true }, depuis);
        assert.equal(r.status, 403, JSON.stringify(r.body)); assert.equal(r.body.code, 'reserve');
      }
      r = await m('dhcp_approuver', { mac: M.cam, nom: 'A moi' }, TEL);
      assert.equal(r.status, 403);
      // Rien n'a bougé ; le propriétaire voit toujours tout.
      r = await acte('baux_vus');
      assert.deepEqual(appareils(r).map((d) => `${d.mac} ${d.etat}`).sort(), [M.box, M.pc, M.tel, M.cam, M.tv, M.imp].map((x) => `${x} actif`).sort());
      assert.equal(appareils(r).find((d) => d.mac === M.cam)?.nom, 'Camera-Jardin');
    });

    // ---------------------------------------------------------------- ce qui reste à fermer (hors de la ligne du serveur)
    // Les alertes de Sphinx (« Nouvel appareil sur le réseau : … », avec son nom, son adresse et son adresse MAC) sont
    // encore remises à un membre qui a le droit d'ouvrir Sphinx : elles nomment les appareils des autres. Ce n'est pas
    // l'origine de la demande (c'était déjà vrai avant) ; l'essai le garde en vue jusqu'à ce que ce soit fermé.
    await t.test('à fermer : les alertes de Sphinx ne nomment pas les appareils des autres à un membre', { todo: 'les alertes de Sphinx sont encore remises telles quelles à un membre' }, async () => {
      const nour = await entrer(v, 'nour', MDP);
      const secrets = [M.cam, M.tv, M.imp, 'Camera-Jardin', 'Tele-Salon', 'Imprimante-Bureau', ipCam, ipTv];
      const fuites: string[] = [];
      for (const chemin of ['/api/valhalla/view?id=vidarr', '/api/valhalla/alerts', '/api/valhalla/alerts?module=vidarr', '/api/valhalla/modules', '/api/valhalla/notices']) {
        const x = await demande(v.port, chemin, { cookie: nour, depuis: TEL }), texte = JSON.stringify(x.body);
        for (const sec of secrets) if (texte.includes(sec)) fuites.push(`${chemin} : « ${sec} »`);
      }
      assert.deepEqual(fuites, []);
    });
  } finally {
    await tt.end();
    Object.assign(console, orig);
  }
});
