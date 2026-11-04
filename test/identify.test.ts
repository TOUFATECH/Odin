import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { nbstatQuery, pageTitle, parseNbstat, parseUpnp, probeWeb, serviceName, SCAN_PORTS } from '../src/hlidskjalf/identify.ts';
import { linksFor } from '../src/hlidskjalf/inventory.ts';

test('identification : services par port, titres, NetBIOS, UPnP', () => {
  assert.equal(serviceName(8006), 'Proxmox');
  assert.equal(serviceName(445), 'Partage de fichiers (SMB)');
  assert.equal(serviceName(12345), 'port 12345');
  assert.ok(SCAN_PORTS.length >= 50 && SCAN_PORTS.includes(32400) && SCAN_PORTS.includes(8123));
  assert.equal(pageTitle('<html><head><title>\n  Freebox &amp; OS </title></head>'), 'Freebox & OS');
  assert.equal(pageTitle('<meta property="og:title" content="Synology DiskStation">'), 'Synology DiskStation');
  const q = nbstatQuery();
  assert.equal(q.length, 50); assert.equal(q[12], 0x20); assert.equal(q.readUInt16BE(46), 0x21);
  // Réponse NBSTAT : un nom de groupe puis le nom de la machine.
  const header = Buffer.alloc(12); const qname = Buffer.concat([Buffer.from([0x20]), Buffer.alloc(32, 0x41), Buffer.from([0])]);
  const meta = Buffer.from([0, 0x21, 0, 1, 0, 0, 0, 0, 0, 0x41]);
  const entry = (n: string, suffix: number, group: boolean) => Buffer.concat([Buffer.from(n.padEnd(15, ' '), 'latin1'), Buffer.from([suffix, group ? 0x80 : 0x00, 0])]);
  const msg = Buffer.concat([header, qname, meta, Buffer.from([2]), entry('WORKGROUP', 0x00, true), entry('PC-SALON', 0x00, false)]);
  assert.equal(parseNbstat(msg), 'PC-SALON');
  assert.deepEqual(parseUpnp('<root><device><friendlyName>TV du salon</friendlyName><manufacturer>Samsung</manufacturer><modelName>QE55</modelName></device></root>'),
    { friendlyName: 'TV du salon', manufacturer: 'Samsung', modelName: 'QE55', presentationURL: undefined });
});

test('identification : interface web détectée (http), titre et serveur, puis lien dans l\'inventaire', async () => {
  const srv = createServer((_req, res) => { res.writeHead(200, { server: 'lighttpd/1.4', 'content-type': 'text/html' }); res.end('<title>Box Internet</title>'); });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  try {
    const port = (srv.address() as AddressInfo).port;
    const w = await probeWeb('127.0.0.1', port);
    assert.deepEqual(w, { port, url: `http://127.0.0.1:${port}/`, title: 'Box Internet', server: 'lighttpd/1.4', status: 200 });
    const links = linksFor({ ip: '127.0.0.1', ports: [port], services: [], kind: 'routeur', web: [w!] });
    assert.equal(links[0].how, `http://127.0.0.1:${port}/`);
    assert.match(links[0].action, /Interface web « Box Internet »/);
  } finally { srv.close(); }
});
