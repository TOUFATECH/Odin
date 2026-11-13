// Ouverture de ports sur la box (UPnP IGD) face à un faux routeur : recherche SSDP, description, ouverture
// permanente ou d'une journée, adresse Internet, CGNAT détecté, liste, fermeture ; actions du VPN et du proxy.
// Et le trafic du VPN : service, destination, historique de la journée.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import dgram from 'node:dgram';
import http from 'node:http';
import net from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { behindCgnat, parseDescription, setDiscoveryTarget } from '../src/valhalla/upnp.ts';
import { Valhalla } from '../src/valhalla/service.ts';
import { allModules } from '../src/valhalla/odin.ts';
import { DEFAULT_CONFIG } from '../src/config.ts';
import { readTraffic, saveTraffic, serviceOf, whereTo } from '../src/valhalla/modules/gjoll.ts';

const DESC = (port: number) => `<?xml version="1.0"?><root xmlns="urn:schemas-upnp-org:device-1-0"><device><deviceType>urn:schemas-upnp-org:device:InternetGatewayDevice:1</deviceType><friendlyName>Livebox d'essai</friendlyName><deviceList><device><deviceType>urn:schemas-upnp-org:device:WANDevice:1</deviceType><deviceList><device><serviceList>
<service><serviceType>urn:schemas-upnp-org:service:WANCommonInterfaceConfig:1</serviceType><controlURL>/autre</controlURL></service>
<service><serviceType>urn:schemas-upnp-org:service:WANIPConnection:1</serviceType><serviceId>urn:upnp-org:serviceId:WANIPConn1</serviceId><controlURL>/ctl/IPConn</controlURL></service>
</serviceList></device></deviceList></device></deviceList></device><URLBase>http://127.0.0.1:${port}/</URLBase></root>`;

test('description de la box, CGNAT', () => {
  const d = parseDescription(DESC(5000), 'http://127.0.0.1:5000/rootDesc.xml');
  assert.deepEqual(d, { control: 'http://127.0.0.1:5000/ctl/IPConn', service: 'urn:schemas-upnp-org:service:WANIPConnection:1', name: 'Livebox d\'essai' });
  assert.equal(parseDescription('<root><serviceType>autre</serviceType></root>', 'http://x/'), undefined);
  assert.ok(behindCgnat('100.72.1.5') && behindCgnat('192.168.1.254') && behindCgnat('10.0.0.1') && !behindCgnat('41.213.10.2') && !behindCgnat('100.128.0.1'));
});

/** Un faux routeur : répond au SSDP, sert sa description et le service SOAP d'ouverture de ports. */
async function router(o: { external?: string; noPermanent?: boolean } = {}) {
  const maps = new Map<string, { ext: number; proto: string; int: number; client: string; desc: string; lease: number }>(), soap: string[] = [];
  const web = http.createServer((q, r) => {
    let b = ''; q.on('data', (c) => { b += c; }); q.on('end', () => {
      if (q.url === '/rootDesc.xml') { r.end(DESC((web.address() as net.AddressInfo).port)); return; }
      const action = /#(\w+)"/.exec(String(q.headers.soapaction))?.[1] ?? '', v = (k: string) => new RegExp(`<${k}>([^<]*)</${k}>`).exec(b)?.[1] ?? '';
      soap.push(action);
      const ok = (inner = '') => { r.writeHead(200, { 'content-type': 'text/xml' }); r.end(`<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body><u:${action}Response xmlns:u="urn:schemas-upnp-org:service:WANIPConnection:1">${inner}</u:${action}Response></s:Body></s:Envelope>`); };
      const fail = (code: number, d: string) => { r.writeHead(500, { 'content-type': 'text/xml' }); r.end(`<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body><s:Fault><detail><UPnPError xmlns="urn:schemas-upnp-org:control-1-0"><errorCode>${code}</errorCode><errorDescription>${d}</errorDescription></UPnPError></detail></s:Fault></s:Body></s:Envelope>`); };
      if (action === 'AddPortMapping') {
        if (o.noPermanent && v('NewLeaseDuration') === '0') return fail(402, 'Invalid Args');
        maps.set(`${v('NewExternalPort')}/${v('NewProtocol')}`, { ext: Number(v('NewExternalPort')), proto: v('NewProtocol'), int: Number(v('NewInternalPort')), client: v('NewInternalClient'), desc: v('NewPortMappingDescription'), lease: Number(v('NewLeaseDuration')) }); return ok();
      }
      if (action === 'DeletePortMapping') { return maps.delete(`${v('NewExternalPort')}/${v('NewProtocol')}`) ? ok() : fail(714, 'NoSuchEntryInArray'); }
      if (action === 'GetExternalIPAddress') return ok(`<NewExternalIPAddress>${o.external ?? '41.213.10.2'}</NewExternalIPAddress>`);
      if (action === 'GetGenericPortMappingEntry') { const m = [...maps.values()][Number(v('NewPortMappingIndex'))]; return m ? ok(`<NewRemoteHost></NewRemoteHost><NewExternalPort>${m.ext}</NewExternalPort><NewProtocol>${m.proto}</NewProtocol><NewInternalPort>${m.int}</NewInternalPort><NewInternalClient>${m.client}</NewInternalClient><NewEnabled>1</NewEnabled><NewPortMappingDescription>${m.desc}</NewPortMappingDescription><NewLeaseDuration>${m.lease}</NewLeaseDuration>`) : fail(713, 'SpecifiedArrayIndexInvalid'); }
      fail(401, 'Invalid Action');
    });
  });
  await new Promise<void>((ok) => web.listen(0, '127.0.0.1', () => ok()));
  const ssdp = dgram.createSocket('udp4'), searches: string[] = [];
  ssdp.on('message', (m, from) => { searches.push(m.toString()); if (/M-SEARCH/.test(m.toString())) ssdp.send(Buffer.from(`HTTP/1.1 200 OK\r\nCACHE-CONTROL: max-age=120\r\nST: urn:schemas-upnp-org:device:InternetGatewayDevice:1\r\nLOCATION: http://127.0.0.1:${(web.address() as net.AddressInfo).port}/rootDesc.xml\r\n\r\n`), from.port, from.address); });
  await new Promise<void>((ok) => ssdp.bind(0, '127.0.0.1', () => ok()));
  setDiscoveryTarget({ host: '127.0.0.1', port: ssdp.address().port, timeoutMs: 200 });
  return { maps, soap, searches, end: () => { setDiscoveryTarget(undefined); web.close(); web.closeAllConnections(); ssdp.close(); } };
}
const odin = () => { const home = mkdtempSync(join(tmpdir(), 'upnp-')); return { home, v: new Valhalla(home, allModules({ paths: { home, workspace: home }, cfg: DEFAULT_CONFIG } as never), { run: async () => ({ code: 0, out: '', err: '' }), fetch, notify: async () => {}, autonomy: () => 'equilibre' }) }; };

test('VPN : Odin ouvre lui-même le port de la box, le liste, le referme ; adresse publique retenue', async () => {
  const r = await router(), { home, v } = odin();
  try {
    const o = await v.act('gjoll', 'ouvrir_port');
    assert.ok(o.ok, o.text); assert.match(o.text, /Livebox d'essai.*51820\/UDP ouvert vers Odin \(127\.0\.0\.1\)/); assert.match(o.text, /41\.213\.10\.2/); assert.match(o.text, /Un seul port suffit/);
    assert.ok(r.searches.some((s) => /M-SEARCH/.test(s) && /InternetGatewayDevice/.test(s)));
    assert.deepEqual(r.maps.get('51820/UDP'), { ext: 51820, proto: 'UDP', int: 51820, client: '127.0.0.1', desc: 'Odin · VPN Vortex', lease: 0 });
    assert.equal((v.ctx('gjoll').settings.server as { endpoint: string }).endpoint, '41.213.10.2', 'adresse publique retenue pour les QR codes');
    assert.match((await v.act('gjoll', 'ports_box')).text, /51820\/UDP → 127\.0\.0\.1:51820 · Odin · VPN Vortex \(Odin\)/);
    assert.match((await v.act('gjoll', 'fermer_port')).text, /51820\/UDP refermé/);
    assert.equal(r.maps.size, 0);
    assert.match((await v.act('gjoll', 'fermer_port')).text, /Rien à refermer/);
    assert.match((await v.act('gjoll', 'fermer_port', {}, { auto: true })).text, /action grave/, 'jamais refermé par une automatisation');
  } finally { v.stop(); r.end(); rmSync(home, { recursive: true, force: true }); }
});

test('box sans ouverture permanente : une journée, renouvelée ; CGNAT (Starlink, 4G) signalé ; proxy 80/443', async () => {
  const r = await router({ noPermanent: true, external: '100.72.1.5' }), { home, v } = odin();
  try {
    const o = await v.act('gjoll', 'ouvrir_port');
    assert.ok(o.ok, o.text); assert.match(o.text, /renouvelé chaque jour/); assert.match(o.text, /pas d'adresse Internet à elle.*Starlink/);
    assert.equal(r.maps.get('51820/UDP')?.lease, 86400);
    assert.ok(!(v.ctx('gjoll').settings.server as { endpoint: string }).endpoint.startsWith('100.'), 'une adresse partagée n\'est pas retenue');
    // Renouvellement : la journée est presque finie.
    v.ctx('gjoll').saveSettings({ upnp: { ...(v.ctx('gjoll').settings.upnp as object), at: Date.now() - 13 * 3600_000 } });
    const before = r.soap.filter((x) => x === 'AddPortMapping').length;
    await v.module('gjoll')!.watch!.run(v.ctx('gjoll'));
    assert.ok(r.soap.filter((x) => x === 'AddPortMapping').length > before, 'renouvelé');
    // Proxy : 80 et 443 (action grave : jamais sans toi).
    assert.match((await v.act('valgrind', 'ouvrir_ports', {}, { auto: true })).text, /action grave/);
    const p = await v.act('valgrind', 'ouvrir_ports');
    assert.ok(p.ok, p.text); assert.match(p.text, /80\/TCP, 443\/TCP ouverts vers Odin/);
    assert.ok(r.maps.has('80/TCP') && r.maps.has('443/TCP'));
    assert.match((await v.act('valgrind', 'fermer_ports')).text, /80\/TCP, 443\/TCP refermés/);
  } finally { v.stop(); r.end(); rmSync(home, { recursive: true, force: true }); }
});

test('pas de box UPnP : message clair', async () => {
  const s = dgram.createSocket('udp4'); await new Promise<void>((ok) => s.bind(0, '127.0.0.1', () => ok()));
  setDiscoveryTarget({ host: '127.0.0.1', port: s.address().port, timeoutMs: 150 });
  const { home, v } = odin();
  try {
    assert.match((await v.act('gjoll', 'ouvrir_port')).text, /aucune box ne répond en UPnP.*à la main/);
    const view = await v.module('gjoll')!.view(v.ctx('gjoll'), new URLSearchParams());
    const st = view.sections.find((x) => x.kind === 'steps') as { items: Array<{ action?: string; button?: string }> };
    assert.deepEqual([st.items[2].action, st.items[2].button], ['port', 'C\'est fait'], 'réglage à la main proposé');
  }
  finally { setDiscoveryTarget(undefined); s.close(); v.stop(); rmSync(home, { recursive: true, force: true }); }
});

test('trafic du VPN : services, destinations, historique de la journée sans double compte', () => {
  assert.equal(serviceOf('TCP', 443), 'Web (HTTPS) · TCP 443'); assert.equal(serviceOf('UDP', 443), 'Web (QUIC)'); assert.equal(serviceOf('UDP', 53), 'DNS · UDP 53'); assert.equal(serviceOf('TCP', 6000), 'TCP 6000'); assert.equal(serviceOf('ICMP', 0), 'Ping');
  const sv = { net: '10.8.0' };
  assert.deepEqual(['10.8.0.1', '10.8.0.7', '192.168.1.20', '8.8.8.8'].map((ip) => whereTo(ip, sv)), ['Odin', 'VPN', 'maison', 'Internet']);
  const { home, v } = odin();
  try {
    const ctx = v.ctx('gjoll'), now = Date.now();
    const f = { device: 'Téléphone', deviceIp: '10.8.0.2', proto: 'TCP', remote: '93.184.216.34', port: 443, up: 1000, down: 5000, pkUp: 10, pkDown: 20, first: now, last: now };
    assert.equal(saveTraffic(ctx, now, [f]), 1);
    assert.equal(saveTraffic(ctx, now, [f]), 0, 'rien de nouveau : rien d\'ajouté');
    saveTraffic(ctx, now, [{ ...f, up: 1500, down: 9000, pkUp: 15 }]);
    saveTraffic(ctx, now, [{ ...f, up: 200, down: 100, pkUp: 2, pkDown: 1 }]); // tunnel redémarré : compteurs repartis de zéro
    const day = readTraffic(ctx, new Date(now).toLocaleDateString('sv-SE'));
    assert.equal(day.length, 1); assert.deepEqual([day[0].up, day[0].down], [1700, 9100]);
  } finally { v.stop(); rmSync(home, { recursive: true, force: true }); }
});
