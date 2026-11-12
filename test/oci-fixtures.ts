// Fabriques pour les essais du moteur : couches tar, faux registre OCI, image busybox.
import { createHash } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';

/** Une entrée tar (ustar) pour fabriquer des couches de test. */
export function entry(name: string, o: { type?: string; data?: Buffer | string; link?: string; mode?: number } = {}): Buffer {
  const data = Buffer.isBuffer(o.data) ? o.data : Buffer.from(o.data ?? ''), h = Buffer.alloc(512);
  h.write(name, 0, 100); h.write(((o.mode ?? (o.type === '5' ? 0o755 : 0o644)).toString(8)).padStart(7, '0'), 100); h.write('0000000', 108); h.write('0000000', 116);
  h.write(data.length.toString(8).padStart(11, '0'), 124); h.write('00000000000', 136); h.fill(' ', 148, 156); h.write(o.type ?? '0', 156); if (o.link) h.write(o.link, 157, 100); h.write('ustar\0' + '00', 257);
  let sum = 0; for (const b of h) sum += b; h.write(sum.toString(8).padStart(6, '0') + '\0 ', 148);
  return Buffer.concat([h, data, Buffer.alloc((512 - (data.length % 512)) % 512)]);
}
export const tarOf = (...e: Buffer[]) => Buffer.concat([...e, Buffer.alloc(1024)]);

export function fakeRegistry(layers: Buffer[], o: { corrupt?: boolean } = {}): Promise<{ srv: Server; port: number }> {
  const sha = (b: Buffer) => `sha256:${createHash('sha256').update(b).digest('hex')}`;
  const cfg = Buffer.from(JSON.stringify({ architecture: 'amd64', os: 'linux', config: { Env: ['PATH=/bin', 'BONJOUR=odin'], Cmd: ['/bin/sh', '-c', 'echo bonjour; sleep 30'], WorkingDir: '/' } }));
  const blobs = new Map<string, Buffer>([[sha(cfg), cfg], ...layers.map((l) => [sha(l), l] as [string, Buffer])]);
  const man = Buffer.from(JSON.stringify({ schemaVersion: 2, mediaType: 'application/vnd.oci.image.manifest.v1+json', config: { mediaType: 'application/vnd.oci.image.config.v1+json', digest: sha(cfg), size: cfg.length }, layers: layers.map((l) => ({ mediaType: 'application/vnd.oci.image.layer.v1.tar+gzip', digest: sha(l), size: l.length })) }));
  const idx = Buffer.from(JSON.stringify({ schemaVersion: 2, mediaType: 'application/vnd.oci.image.index.v1+json', manifests: [{ mediaType: 'application/vnd.oci.image.manifest.v1+json', digest: sha(man), size: man.length, platform: { os: 'linux', architecture: process.arch === 'arm64' ? 'arm64' : 'amd64' } }, { mediaType: 'x', digest: `sha256:${'0'.repeat(64)}`, size: 1, platform: { os: 'unknown', architecture: 'unknown' } }] }));
  return new Promise((res) => {
    const srv = createServer((req, r) => {
      const port = (srv.address() as { port: number }).port;
      if (req.url!.startsWith('/jeton')) { r.setHeader('content-type', 'application/json'); return r.end(JSON.stringify({ token: 'ok' })); }
      if (req.headers.authorization !== 'Bearer ok') { r.statusCode = 401; r.setHeader('www-authenticate', `Bearer realm="http://127.0.0.1:${port}/jeton",service="test",scope="repository:odin/boite:pull"`); return r.end(); }
      const m = /^\/v2\/odin\/boite\/(manifests|blobs)\/(.+)$/.exec(req.url!); if (!m) { r.statusCode = 404; return r.end(); }
      if (m[1] === 'manifests') { const b = m[2] === '1' ? idx : m[2] === sha(man) ? man : null; if (!b) { r.statusCode = 404; return r.end(); } r.setHeader('content-type', b === idx ? 'application/vnd.oci.image.index.v1+json' : 'application/vnd.oci.image.manifest.v1+json'); return r.end(b); }
      const b = blobs.get(m[2]); if (!b) { r.statusCode = 404; return r.end(); }
      if (o.corrupt && b !== cfg) { const x = Buffer.from(b); x[x.length - 1] ^= 1; return r.end(x); }
      r.end(b);
    }).listen(0, '127.0.0.1', () => res({ srv, port: (srv.address() as { port: number }).port }));
  });
}
export const busyboxLayer = () => {
  const bb = readFileSync('/usr/bin/busybox'), tools = ['sh', 'echo', 'sleep', 'cat', 'ls', 'id', 'hostname', 'httpd', 'mkdir', 'ps'];
  return gzipSync(tarOf(entry('bin/', { type: '5' }), entry('bin/busybox', { data: bb, mode: 0o755 }), ...tools.map((t) => entry(`bin/${t}`, { type: '2', link: 'busybox' })),
    entry('etc/', { type: '5' }), entry('etc/passwd', { data: 'root:x:0:0:root:/root:/bin/sh\nnobody:x:65534:65534:nobody:/:/bin/sh\n' }), entry('etc/group', { data: 'root:x:0:\nnobody:x:65534:\n' }),
    entry('www/', { type: '5' }), entry('www/index.html', { data: 'salut depuis le conteneur' })));
};
