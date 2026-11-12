// Hringhorni — la préparation d'un conteneur, sans programme de conteneurs : seulement les outils de base
// de Linux (unshare, mount, setpriv, nsenter). Le script tourne dans les espaces de noms neufs du conteneur,
// monte sa racine (overlay sur l'image, ou une copie), ses dossiers, /proc, /dev, puis lance l'appli enfermée.
import { lstat, readFile, readlink } from 'node:fs/promises';
import { join } from 'node:path';
import type { Mount, Spec } from './store.ts';

export const q = (s: string) => `'${String(s).replace(/'/g, `'\\''`)}'`;
/** Capacités gardées pour un conteneur qui tourne en « root » (le reste est retiré, comme les moteurs connus). */
export const CAPS = ['chown', 'dac_override', 'fowner', 'fsetid', 'kill', 'setgid', 'setuid', 'setpcap', 'net_bind_service', 'net_raw', 'sys_chroot', 'mknod', 'audit_write', 'setfcap'];

/** Résout un chemin du conteneur dans ses couches (haut puis image) sans jamais sortir : les liens sont suivis DANS la racine. */
export async function resolveIn(layers: string[], inner: string, depth = 0): Promise<string> {
  if (depth > 40) throw new Error(`trop de liens pour ${inner}`);
  const out: string[] = [], todo = inner.split('/').filter((c) => c && c !== '.');
  while (todo.length) {
    const c = todo.shift()!;
    if (c === '..') { out.pop(); continue; }
    let link: string | null = null;
    for (const l of layers) { const st = await lstat(join(l, ...out, c)).catch(() => null); if (st) { if (st.isSymbolicLink()) link = await readlink(join(l, ...out, c)); break; } }
    if (link !== null) { const base = link.startsWith('/') ? [] : out.slice(); return resolveIn(layers, [...base, ...link.split('/'), ...todo].join('/'), depth + 1); }
    out.push(c);
  }
  return out.join('/');
}

/** L'utilisateur du conteneur en nombres (« nginx », « 1000:1000 », « www-data:www-data ») lus dans l'image. */
export async function resolveUser(layers: string[], user: string): Promise<{ uid: number; gid: number }> {
  if (!user) return { uid: 0, gid: 0 };
  const [u, g] = user.split(':');
  const file = async (name: string) => { for (const l of layers) { const t = await readFile(join(l, 'etc', name), 'utf8').catch(() => null); if (t !== null) return t; } return ''; };
  const passwd = (await file('passwd')).split('\n').map((l) => l.split(':')), group = (await file('group')).split('\n').map((l) => l.split(':'));
  let uid: number, gid: number | undefined;
  if (/^\d+$/.test(u)) { uid = Number(u); gid = Number(passwd.find((p) => p[2] === u)?.[3] ?? NaN); }
  else { const p = passwd.find((x) => x[0] === u); if (!p) throw new Error(`utilisateur « ${u} » absent de l'image`); uid = Number(p[2]); gid = Number(p[3]); }
  if (g !== undefined) { if (/^\d+$/.test(g)) gid = Number(g); else { const x = group.find((y) => y[0] === g); if (!x) throw new Error(`groupe « ${g} » absent de l'image`); gid = Number(x[2]); } }
  return { uid, gid: Number.isFinite(gid) ? gid! : uid };
}

export interface Tools { env: string; setpriv: string; unshare: string; nsenter: string; ip?: string }
export interface Plan {
  ctrDir: string; lower: string; spec: Spec; argv: string[]; env: Record<string, string>; uid: number; gid: number;
  targets: { mounts: Array<Mount & { rel: string }>; proc: string; dev: string; sys: string; tmp: string; hosts: string; resolv: string; hostname: string };
  rootless: boolean; sysfs: boolean; cgroup?: string; tools: Tools;
}

/** La commande finale : environnement propre, capacités réduites, enfermement dans la racine, bon utilisateur. */
export function finalExec(p: Pick<Plan, 'argv' | 'env' | 'uid' | 'gid' | 'tools' | 'rootless'>, root: string, wd: string): string[] {
  const env = Object.entries(p.env).map(([k, v]) => `${k}=${v}`);
  const user = p.rootless ? [] : ['-S', String(p.uid), '-G', String(p.gid)];
  return [p.tools.env, '-i', ...env, p.tools.setpriv, `--bounding-set=-all,${CAPS.map((c) => `+${c}`).join(',')}`, p.tools.unshare, `--root=${root}`, `--wd=${wd || '/'}`, ...user, '--', ...p.argv];
}

/** Le script de préparation (lancé dans les nouveaux espaces de noms). */
export function setupScript(p: Plan): string {
  const C = p.ctrDir, R = join(C, 'racine'), r = (rel: string) => q(join(R, rel));
  const L: string[] = [
    'set -e', 'export PATH=/usr/sbin:/usr/bin:/sbin:/bin', 'umask 022',
    'mount --make-rprivate / 2>/dev/null || true',
    `mkdir -p ${q(R)} ${q(join(C, 'haut'))} ${q(join(C, 'travail'))}`,
    // racine : overlay (l'image reste intacte), sinon une copie privée
    `if ! mount -t overlay overlay -o ${q(`lowerdir=${p.lower},upperdir=${join(C, 'haut')},workdir=${join(C, 'travail')}`)} ${q(R)} 2>/dev/null; then`,
    `  [ -e ${q(join(C, 'copie', '.odin-ok'))} ] || { rm -rf ${q(join(C, 'copie'))}; cp -a ${q(p.lower)} ${q(join(C, 'copie'))}; touch ${q(join(C, 'copie', '.odin-ok'))}; }`,
    `  mount --bind ${q(join(C, 'copie'))} ${q(R)}`, 'fi',
  ];
  if (p.cgroup) L.push(`echo 0 > ${q(join(p.cgroup, 'cgroup.procs'))} 2>/dev/null || true`);
  const t = p.targets;
  // dossiers partagés (cible résolue d'avance : jamais un lien qui sortirait)
  for (const m of t.mounts) {
    L.push(`if [ -d ${q(m.host)} ]; then mkdir -p ${r(m.rel)}; else mkdir -p "$(dirname ${r(m.rel)})"; [ -e ${r(m.rel)} ] || touch ${r(m.rel)}; fi`);
    L.push(`[ ! -L ${r(m.rel)} ] || { echo 'cible piégée : ${m.inner.replace(/'/g, '')}' >&2; exit 90; }`);
    L.push(`mount --rbind ${q(m.host)} ${r(m.rel)}`);
    if (m.ro) L.push(`mount -o remount,bind,ro ${r(m.rel)}`);
  }
  L.push(
    `mkdir -p ${r(t.proc)} ${r(t.dev)} ${r(t.sys)} ${r(t.tmp)}`,
    `mount -t proc -o nosuid,nodev,noexec proc ${r(t.proc)}`,
    `mount -t tmpfs -o nosuid,mode=755,size=65536k tmpfs ${r(t.dev)}`,
    `for d in null zero full random urandom tty; do touch ${r(t.dev)}/$d; mount --bind /dev/$d ${r(t.dev)}/$d; done`,
    `mkdir -p ${r(t.dev)}/pts ${r(t.dev)}/shm ${r(t.dev)}/mqueue`,
    `mount -t devpts -o newinstance,ptmxmode=0666,mode=0620 devpts ${r(t.dev)}/pts 2>/dev/null && ln -sf pts/ptmx ${r(t.dev)}/ptmx || true`,
    `mount -t tmpfs -o nosuid,nodev,mode=1777,size=65536k shm ${r(t.dev)}/shm`,
    `ln -sf /proc/self/fd ${r(t.dev)}/fd; ln -sf /proc/self/fd/0 ${r(t.dev)}/stdin; ln -sf /proc/self/fd/1 ${r(t.dev)}/stdout; ln -sf /proc/self/fd/2 ${r(t.dev)}/stderr`,
    p.sysfs ? `mount -t sysfs -o ro,nosuid,nodev,noexec sysfs ${r(t.sys)} 2>/dev/null || { mount --rbind /sys ${r(t.sys)} && mount -o remount,bind,ro ${r(t.sys)}; }` : `mount --rbind /sys ${r(t.sys)} && mount -o remount,bind,ro ${r(t.sys)} || true`,
    // ce qui ne doit pas se voir ni se modifier depuis le conteneur
    `for f in kcore keys timer_list sched_debug latency_stats; do [ -e ${r(t.proc)}/$f ] && mount --bind /dev/null ${r(t.proc)}/$f || true; done`,
    `for d in acpi scsi; do [ -d ${r(t.proc)}/$d ] && mount -t tmpfs -o ro tmpfs ${r(t.proc)}/$d || true; done`,
    `for d in sys irq bus fs sysrq-trigger; do [ -e ${r(t.proc)}/$d ] && { mount --bind ${r(t.proc)}/$d ${r(t.proc)}/$d && mount -o remount,bind,ro ${r(t.proc)}/$d; } || true; done`,
  );
  for (const [rel, src] of [[t.hosts, 'hosts'], [t.resolv, 'resolv.conf'], [t.hostname, 'hostname']] as const) {
    L.push(`mkdir -p "$(dirname ${r(rel)})"; [ -L ${r(rel)} ] && rm -f ${r(rel)}; [ -e ${r(rel)} ] || touch ${r(rel)}; mount --bind ${q(join(C, src))} ${r(rel)}`);
  }
  L.push(`hostname ${q(p.spec.hostname)} 2>/dev/null || true`);
  L.push(`exec ${finalExec(p, R, p.spec.workdir).map(q).join(' ')}`);
  return `${L.join('\n')}\n`;
}

/** Les outils de base nécessaires, avec leur chemin complet. */
export async function findTools(which: (c: string) => Promise<string | null>): Promise<Tools> {
  const out: Partial<Tools> = {};
  for (const k of ['env', 'setpriv', 'unshare', 'nsenter'] as const) { const p = await which(k); if (!p) throw new Error(`outil de base manquant : ${k} (paquet util-linux / coreutils)`); out[k] = p; }
  out.ip = (await which('ip')) ?? undefined;
  return out as Tools;
}
