// Faux serveur Proxmox VE : la même API (HTTPS avec certificat auto-signé, jeton « PVEAPIToken »,
// /api2/json/cluster/resources, démarrage, arrêt, redémarrage, instantanés, retour en arrière) et le
// même comportement visible (une machine arrêtée passe « stopped », un instantané est gardé…).
// Un vrai Proxmox demande une machine entière avec la virtualisation : impossible sur un banc.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:https';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface PveGuest { vmid: number; name: string; type: 'qemu' | 'lxc'; node: string; status: 'running' | 'stopped'; maxmem: number; mem: number; cpu: number; maxdisk: number; disk: number; snapshots: string[] }
export interface PveNode { node: string; status: 'online' | 'offline'; maxmem: number; mem: number; cpu: number; maxcpu: number }
export interface PveSim { url: string; token: string; nodes: PveNode[]; guests: PveGuest[]; calls: Array<{ method: string; path: string; body: Record<string, string> }>; close(): Promise<void> }

/** Certificat auto-signé jetable (comme celui d'un Proxmox neuf). */
export function selfSigned(): { key: string; cert: string } {
  const d = mkdtempSync(join(tmpdir(), 'banc-cert-'));
  try {
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', join(d, 'k.pem'), '-out', join(d, 'c.pem'), '-days', '2', '-subj', '/CN=pve.banc'], { stdio: 'ignore' });
    return { key: readFileSync(join(d, 'k.pem'), 'utf8'), cert: readFileSync(join(d, 'c.pem'), 'utf8') };
  } finally { rmSync(d, { recursive: true, force: true }); }
}

const GB = 1024 ** 3;
export async function proxmoxSim(o: { token?: string } = {}): Promise<PveSim> {
  const token = o.token ?? 'odin@pve!banc=3f1c9a52-7d0e-4b6f-9a11-banc00000001';
  const nodes: PveNode[] = [{ node: 'pve1', status: 'online', maxmem: 64 * GB, mem: 21 * GB, cpu: 0.18, maxcpu: 16 }, { node: 'pve2', status: 'online', maxmem: 32 * GB, mem: 9 * GB, cpu: 0.07, maxcpu: 8 }];
  const guests: PveGuest[] = [
    { vmid: 100, name: 'nas', type: 'qemu', node: 'pve1', status: 'running', maxmem: 8 * GB, mem: 5.2 * GB, cpu: 0.12, maxdisk: 500 * GB, disk: 310 * GB, snapshots: [] },
    { vmid: 101, name: 'odin', type: 'lxc', node: 'pve1', status: 'running', maxmem: 4 * GB, mem: 1.1 * GB, cpu: 0.04, maxdisk: 32 * GB, disk: 9 * GB, snapshots: ['avant-maj'] },
    { vmid: 102, name: 'venus', type: 'qemu', node: 'pve2', status: 'running', maxmem: 8 * GB, mem: 3.4 * GB, cpu: 0.21, maxdisk: 200 * GB, disk: 120 * GB, snapshots: [] },
    { vmid: 110, name: 'bac-a-sable', type: 'lxc', node: 'pve2', status: 'stopped', maxmem: 2 * GB, mem: 0, cpu: 0, maxdisk: 16 * GB, disk: 2 * GB, snapshots: [] },
  ];
  const calls: PveSim['calls'] = []; let upid = 1;
  const { key, cert } = selfSigned();
  const srv: Server = createServer({ key, cert }, (req, res) => {
    const parts: Buffer[] = [];
    req.on('data', (d) => parts.push(d));
    req.on('end', () => {
      const u = new URL(req.url ?? '/', 'https://x'), body = Object.fromEntries(new URLSearchParams(Buffer.concat(parts).toString('utf8')));
      const send = (code: number, data: unknown, msg = '') => { res.writeHead(code, msg || undefined, { 'content-type': 'application/json' }); res.end(JSON.stringify({ data })); };
      if (!u.pathname.startsWith('/api2/json/')) return send(404, null, 'Not Found');
      if (req.headers.authorization !== `PVEAPIToken=${token}`) return send(401, null, 'No ticket');
      const path = u.pathname.slice('/api2/json'.length), method = req.method ?? 'GET';
      calls.push({ method, path, body });
      const task = (node: string, kind: string, id: number) => `UPID:${node}:${String(upid++).padStart(8, '0')}:00000000:${Math.floor(Date.now() / 1000).toString(16)}:${kind}:${id}:odin@pve!banc:`;
      if (method === 'GET' && path === '/cluster/resources') {
        return send(200, [
          ...nodes.map((n) => ({ type: 'node', id: `node/${n.node}`, node: n.node, status: n.status, maxmem: n.maxmem, mem: n.mem, cpu: n.cpu, maxcpu: n.maxcpu })),
          ...guests.map((g) => ({ type: g.type, id: `${g.type}/${g.vmid}`, vmid: g.vmid, name: g.name, node: g.node, status: g.status, maxmem: g.maxmem, mem: g.status === 'running' ? g.mem : 0, cpu: g.status === 'running' ? g.cpu : 0, maxdisk: g.maxdisk, disk: g.disk })),
        ]);
      }
      const m = /^\/nodes\/([^/]+)\/(qemu|lxc)\/(\d+)\/(status\/(start|stop|shutdown|reboot|current)|snapshot(?:\/([^/]+)\/rollback)?)$/.exec(path);
      if (m) {
        const g = guests.find((x) => x.vmid === Number(m[3]) && x.node === m[1] && x.type === m[2]);
        if (!g) return send(500, null, `Configuration file 'nodes/${m[1]}/${m[2] === 'qemu' ? 'qemu-server' : 'lxc'}/${m[3]}.conf' does not exist`);
        if (m[5] === 'current' && method === 'GET') return send(200, { status: g.status, vmid: g.vmid, name: g.name });
        if (method !== 'POST') return send(501, null, 'Method not implemented');
        if (m[5] === 'start') { if (g.status === 'running') return send(500, null, `${g.type === 'qemu' ? 'VM' : 'CT'} ${g.vmid} already running`); g.status = 'running'; return send(200, task(g.node, `${g.type === 'qemu' ? 'qm' : 'vz'}start`, g.vmid)); }
        if (m[5] === 'stop' || m[5] === 'shutdown') { if (g.status !== 'running') return send(500, null, `${g.type === 'qemu' ? 'VM' : 'CT'} ${g.vmid} not running`); g.status = 'stopped'; return send(200, task(g.node, `${g.type === 'qemu' ? 'qm' : 'vz'}${m[5]}`, g.vmid)); }
        if (m[5] === 'reboot') { if (g.status !== 'running') return send(500, null, `${g.type === 'qemu' ? 'VM' : 'CT'} ${g.vmid} not running`); return send(200, task(g.node, `${g.type === 'qemu' ? 'qm' : 'vz'}reboot`, g.vmid)); }
        if (m[4] === 'snapshot') { const name = body.snapname ?? ''; if (!/^[A-Za-z][\w-]{1,39}$/.test(name)) return send(400, null, 'Parameter verification failed. (snapname: invalid format)'); if (g.snapshots.includes(name)) return send(500, null, `snapshot name '${name}' already used`); g.snapshots.push(name); return send(200, task(g.node, `${g.type === 'qemu' ? 'qm' : 'vz'}snapshot`, g.vmid)); }
        if (m[6]) { if (!g.snapshots.includes(decodeURIComponent(m[6]))) return send(500, null, `snapshot '${decodeURIComponent(m[6])}' does not exist`); return send(200, task(g.node, `${g.type === 'qemu' ? 'qm' : 'vz'}rollback`, g.vmid)); }
      }
      return send(501, null, `Method '${method} ${path}' not implemented`);
    });
  });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  return { url: `https://127.0.0.1:${(srv.address() as AddressInfo).port}`, token, nodes, guests, calls, close: () => new Promise<void>((r) => { srv.closeAllConnections?.(); srv.close(() => r()); }) };
}
