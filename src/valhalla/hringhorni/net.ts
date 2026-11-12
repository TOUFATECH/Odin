// Hringhorni — le réseau des conteneurs, sans service qui tourne : un pont « odin0 » (10.89.0.0/24) créé à la
// demande, un espace réseau par conteneur relié au pont, la sortie vers Internet par traduction d'adresses.
// Les ports publiés sont relayés par le gardien du conteneur (pas de règle de pare-feu à nettoyer).
import { execFile } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';

const exec = promisify(execFile);
export const BRIDGE = 'odin0', SUBNET = '10.89.0', GW = `${SUBNET}.1`;
export type Runner = (cmd: string, args: string[]) => Promise<{ code: number; out: string; err: string }>;
export const defaultRunner: Runner = async (cmd, args) => {
  try { const r = await exec(cmd, args, { timeout: 20_000 }); return { code: 0, out: r.stdout, err: r.stderr }; }
  catch (e) { const x = e as { code?: number; stdout?: string; stderr?: string; message: string }; return { code: typeof x.code === 'number' ? x.code : 1, out: x.stdout ?? '', err: x.stderr ?? x.message }; }
};
export const nsName = (id: string) => `odin-${id.slice(0, 12)}`;
const veth = (id: string) => [`od${id.slice(0, 10)}h`, `od${id.slice(0, 10)}c`];

/** Le pont et la sortie Internet (idempotent). */
export async function ensureBridge(run: Runner): Promise<void> {
  if ((await run('ip', ['link', 'show', BRIDGE])).code !== 0) {
    for (const a of [['link', 'add', BRIDGE, 'type', 'bridge'], ['addr', 'add', `${GW}/24`, 'dev', BRIDGE], ['link', 'set', BRIDGE, 'up']]) {
      const r = await run('ip', a); if (r.code !== 0 && !/exists/i.test(r.err)) throw new Error(`réseau : ${r.err.trim()}`);
    }
  }
  try { writeFileSync('/proc/sys/net/ipv4/ip_forward', '1'); } catch { /* lecture seule : la sortie Internet peut manquer */ }
  // traduction d'adresses pour la sortie : nftables, sinon iptables
  const has = await run('nft', ['list', 'table', 'ip', 'odin']);
  if (has.code !== 0) {
    const a = await run('nft', ['add', 'table', 'ip', 'odin']);
    if (a.code === 0) {
      await run('nft', ['add', 'chain', 'ip', 'odin', 'sortie', '{ type nat hook postrouting priority 100 ; }']);
      await run('nft', ['add', 'rule', 'ip', 'odin', 'sortie', 'ip', 'saddr', `${SUBNET}.0/24`, 'oifname', '!=', BRIDGE, 'masquerade']);
    } else {
      const chk = await run('iptables', ['-t', 'nat', '-C', 'POSTROUTING', '-s', `${SUBNET}.0/24`, '!', '-o', BRIDGE, '-j', 'MASQUERADE']);
      if (chk.code !== 0) await run('iptables', ['-t', 'nat', '-A', 'POSTROUTING', '-s', `${SUBNET}.0/24`, '!', '-o', BRIDGE, '-j', 'MASQUERADE']);
    }
  }
}
/** Les adresses prises, pour toute la machine (plusieurs dossiers de moteur partagent le même pont). */
export const LEASES = process.env.ODIN_HRINGHORNI_BAUX ?? '/run/odin/hringhorni-adresses';
/** Réserve une adresse libre sur le pont (réservation atomique ; une réservation dont l'espace réseau a disparu est reprise). */
export async function lease(run: Runner, id: string, dir = LEASES): Promise<string> {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const live = new Set((await run('ip', ['netns', 'list'])).out.split('\n').map((l) => l.split(' ')[0]).filter(Boolean));
  for (let i = 2; i < 255; i++) {
    const ip = `${SUBNET}.${i}`, f = join(dir, ip);
    try { writeFileSync(f, nsName(id), { flag: 'wx', mode: 0o600 }); return ip; } catch { /* prise */ }
    try { const owner = readFileSync(f, 'utf8').trim(); if (owner === nsName(id) || !live.has(owner)) { writeFileSync(f, nsName(id), { mode: 0o600 }); return ip; } } catch { /* concurrence : suivante */ }
  }
  throw new Error('plus d\'adresse libre sur le réseau des conteneurs (253 au plus)');
}
export function release(ip: string | undefined, id: string, dir = LEASES): void {
  if (!ip) return; const f = join(dir, ip);
  try { if (readFileSync(f, 'utf8').trim() === nsName(id)) rmSync(f, { force: true }); } catch { /* déjà libre */ }
}
/** Première adresse libre (2 à 254). */
export function pickIp(used: Iterable<string>): string {
  const u = new Set(used); for (let i = 2; i < 255; i++) { const ip = `${SUBNET}.${i}`; if (!u.has(ip)) return ip; }
  throw new Error('plus d\'adresse libre sur le réseau des conteneurs (253 au plus)');
}
/** Un espace réseau pour le conteneur, relié au pont, avec son adresse. */
export async function attach(run: Runner, id: string, ip: string): Promise<void> {
  const ns = nsName(id), [h, c] = veth(id);
  await detach(run, id);
  const steps: string[][] = [['netns', 'add', ns], ['link', 'add', h, 'type', 'veth', 'peer', 'name', c], ['link', 'set', c, 'netns', ns], ['link', 'set', h, 'master', BRIDGE], ['link', 'set', h, 'up'],
    ['-n', ns, 'link', 'set', c, 'name', 'eth0'], ['-n', ns, 'addr', 'add', `${ip}/24`, 'dev', 'eth0'], ['-n', ns, 'link', 'set', 'eth0', 'up'], ['-n', ns, 'link', 'set', 'lo', 'up'], ['-n', ns, 'route', 'add', 'default', 'via', GW]];
  for (const s of steps) { const r = await run('ip', s); if (r.code !== 0) { await detach(run, id); throw new Error(`réseau du conteneur : ${r.err.trim() || s.join(' ')}`); } }
}
export async function detach(run: Runner, id: string): Promise<void> {
  await run('ip', ['netns', 'del', nsName(id)]);
  await run('ip', ['link', 'del', veth(id)[0]]);
}
/** Les serveurs DNS pour un conteneur : ceux de la machine, sauf une adresse locale (127.x), remplacée par la vraie. */
export function resolvConf(bridged: boolean, read = (f: string) => { try { return readFileSync(f, 'utf8'); } catch { return ''; } }): string {
  let txt = read('/etc/resolv.conf');
  const local = (t: string) => t.split('\n').filter((l) => /^nameserver\s/.test(l)).every((l) => /\s(127\.|::1)/.test(l));
  if (bridged && (!txt.trim() || local(txt))) { const alt = read('/run/systemd/resolve/resolv.conf'); txt = alt && !local(alt) ? alt : 'nameserver 9.9.9.9\nnameserver 149.112.112.112\n'; }
  return txt.split('\n').filter((l) => /^(nameserver|search|options)\s/.test(l)).join('\n') + '\n';
}
