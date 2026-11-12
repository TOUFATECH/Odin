// Hringhorni — le moteur de conteneurs d'Odin. Il fonctionne comme Podman, sans démon : chaque commande
// (pull, run, ps, stop, logs, exec, start, rm, images) agit directement, et chaque conteneur en marche n'a
// qu'un petit gardien à lui (journal, ports, redémarrage) qui s'arrête avec lui. Les images Docker (Docker Hub,
// GHCR, Quay…) sont récupérées et dépaquetées par Odin lui-même.
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { constants, existsSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync, mkdirSync, openSync, readSync, closeSync } from 'node:fs';
import { access, mkdir, rename, rm } from 'node:fs/promises';
import { join, delimiter } from 'node:path';
import { autoName, parseMounts, parsePorts } from '../parc.ts';
import { attach, defaultRunner, ensureBridge, lease, nsName, release, resolvConf, type Runner } from './net.ts';
import { parseRef, Registry } from './registry.ts';
import { findTools, resolveIn, resolveUser, setupScript, finalExec, type Plan, type Tools } from './script.ts';
import { defaultDir, isRoot, Store, type Image, type Mount, type Port, type Restart, type Spec, type State, type Status } from './store.ts';
import { extractLayer, layerStream } from './tar.ts';

export interface RunOpts {
  image: string; name?: string; cmd?: string[]; entrypoint?: string[]; env?: Record<string, string>;
  ports?: Port[] | string; mounts?: Mount[] | string; restart?: Restart; memory?: string; cpus?: string;
  user?: string; workdir?: string; hostname?: string; network?: 'pont' | 'hote'; rm?: boolean; labels?: Record<string, string>;
}
export interface Ctr { id: string; spec: Spec; state: State }
export type Step = (t: string, note?: string) => void;
const RESTART: Record<string, Restart> = { no: 'non', non: 'non', always: 'toujours', toujours: 'toujours', 'on-failure': 'si-erreur', 'si-erreur': 'si-erreur', 'unless-stopped': 'sauf-arret', 'sauf-arret': 'sauf-arret' };
export const restartOf = (s?: string): Restart => { const r = RESTART[String(s ?? 'non').replace(/:\d+$/, '')]; if (!r) throw new Error(`redémarrage inconnu : ${s} (no, always, on-failure, unless-stopped)`); return r; };
const alive = (pid?: number) => { if (!pid) return false; try { process.kill(pid, 0); return true; } catch { return false; } };

/** Cherche un programme dans le PATH (et les dossiers système). */
export async function which(cmd: string): Promise<string | null> {
  const dirs = [...(process.env.PATH ?? '').split(delimiter), '/usr/sbin', '/usr/bin', '/sbin', '/bin'];
  for (const d of dirs) { if (!d) continue; const p = join(d, cmd); try { await access(p, constants.X_OK); return p; } catch { /* suivant */ } }
  return null;
}

export class Engine {
  readonly store: Store;
  private tools?: Tools;
  private o: { fetch?: typeof fetch; run?: Runner; rootless?: boolean };
  constructor(dir = defaultDir(), o: { fetch?: typeof fetch; run?: Runner; rootless?: boolean } = {}) { this.store = new Store(dir); this.o = o; }
  get rootless(): boolean { return this.o.rootless ?? !isRoot(); }
  async getTools(): Promise<Tools> { return (this.tools ??= await findTools(which)); }
  private runner(): Runner { return this.o.run ?? defaultRunner; }

  // ------------------------------------------------------------------ images
  images(): Image[] { return this.store.images(); }
  findImage(name: string): Image | undefined {
    const l = this.images(), n = name.trim();
    let full = ''; try { full = parseRef(n).name; } catch { /* un identifiant */ }
    return l.find((i) => i.names.includes(n) || (full && i.names.includes(full))) ?? (/^[a-f0-9]{4,64}$/.test(n) ? l.find((i) => i.id.startsWith(n)) : undefined);
  }
  /** Récupère une image et la dépaquette (rien n'est gardé si un morceau est faux). */
  async pull(name: string, step: Step = () => {}): Promise<Image> {
    const ref = parseRef(name), reg = new Registry(ref, this.o.fetch ?? fetch);
    this.store.ensure();
    step('Lire le manifeste', ref.name);
    const { digest, manifest } = await reg.manifest();
    const cfgFile = this.store.blob(manifest.config.digest);
    await reg.blob(manifest.config, cfgFile);
    const config = JSON.parse(readFileSync(cfgFile, 'utf8'));
    const id = manifest.config.digest.slice(7), total = manifest.layers.reduce((a, l) => a + l.size, 0);
    const existing = this.images().find((i) => i.id === id);
    if (!existing || !existsSync(join(this.store.rootfs(id), '..', '.complet'))) {
      let done = 0;
      for (const [i, l] of manifest.layers.entries()) { step(`Télécharger la couche ${i + 1}/${manifest.layers.length}`, `${(l.size / 1e6).toFixed(1)} Mo`); await reg.blob(l, this.store.blob(l.digest), (n) => { done += n; }); }
      step('Dépaqueter l\'image', `${(total / 1e6).toFixed(1)} Mo`);
      const base = join(this.store.dir, 'images', id), tmp = `${base}.tmp-${process.pid}`;
      await rm(tmp, { recursive: true, force: true }); await mkdir(join(tmp, 'rootfs'), { recursive: true, mode: 0o700 });
      for (const l of manifest.layers) await extractLayer(await layerStream(this.store.blob(l.digest), l.mediaType), join(tmp, 'rootfs'), { chown: !this.rootless });
      writeFileSync(join(tmp, '.complet'), new Date().toISOString());
      await rm(base, { recursive: true, force: true }); await rename(tmp, base);
    }
    const list = this.images().map((i) => ({ ...i, names: i.names.filter((n) => n !== ref.name) })).filter((i) => i.names.length || i.id === id);
    const img: Image = { id, names: [...new Set([...(list.find((i) => i.id === id)?.names ?? []), ref.name])], digest, config, configDigest: manifest.config.digest, layers: manifest.layers, size: total, pulled: new Date().toISOString() };
    this.store.saveImages([...list.filter((i) => i.id !== id), img]);
    step('Image prête', `${ref.name} (${id.slice(0, 12)})`);
    return img;
  }
  async rmi(name: string, force = false): Promise<Image> {
    const img = this.findImage(name); if (!img) throw new Error(`image inconnue : ${name}`);
    const users = this.ps(true).filter((c) => c.spec.imageId === img.id);
    if (users.length && !force) throw new Error(`image utilisée par : ${users.map((c) => c.spec.name).join(', ')} (supprime-les d'abord)`);
    await rm(join(this.store.dir, 'images', img.id), { recursive: true, force: true });
    const rest = this.images().filter((i) => i.id !== img.id); this.store.saveImages(rest);
    const keep = new Set(rest.flatMap((i) => [i.configDigest, ...i.layers.map((l) => l.digest)]));
    for (const d of [img.configDigest, ...img.layers.map((l) => l.digest)]) if (!keep.has(d)) await rm(this.store.blob(d), { force: true });
    return img;
  }

  // ------------------------------------------------------------------ conteneurs
  ps(all = false): Ctr[] {
    const dir = join(this.store.dir, 'containers'); let ids: string[] = [];
    try { ids = readdirSync(dir); } catch { /* vide */ }
    const out: Ctr[] = [];
    for (const id of ids) {
      const spec = this.store.spec(id); if (!spec) continue;
      let state = this.store.state(id);
      if ((state.status === 'en marche' || state.status === 'redémarre') && !alive(state.gardien)) { state = { ...state, status: 'arrêté', error: state.error ?? 'arrêté sans prévenir (machine redémarrée ?)' }; this.store.saveState(id, state); }
      if (all || state.status === 'en marche' || state.status === 'redémarre') out.push({ id, spec, state });
    }
    return out.sort((a, b) => b.spec.created.localeCompare(a.spec.created));
  }
  find(nameOrId: string): Ctr {
    const n = nameOrId.trim(), all = this.ps(true);
    const c = all.find((x) => x.spec.name === n) ?? (/^[a-f0-9]{3,64}$/.test(n) ? all.filter((x) => x.id.startsWith(n)) : []).at(0);
    if (!c) throw new Error(`conteneur inconnu : ${nameOrId}`);
    return c;
  }
  /** Prépare un conteneur (il ne démarre pas). */
  async create(o: RunOpts): Promise<Spec> {
    let img = this.findImage(o.image); if (!img) img = await this.pull(o.image);
    const taken = this.ps(true).map((c) => c.spec.name);
    const name = (o.name ?? '').trim() || autoName('Docker', img.names[0] ?? o.image, taken);
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,62}$/.test(name)) throw new Error(`nom invalide : ${name}`);
    if (taken.includes(name)) throw new Error(`le nom ${name} est déjà pris`);
    const ports = typeof o.ports === 'string' ? parsePorts(o.ports) : (o.ports ?? []);
    const mounts = typeof o.mounts === 'string' ? parseMounts(o.mounts) : parseMounts((o.mounts ?? []).map((m) => `${m.host}:${m.inner}${m.ro ? ':ro' : ''}`).join(','));
    const busy = new Map(this.ps().flatMap((c) => c.spec.ports.map((p) => [`${p.host}/${p.proto}`, c.spec.name] as const)));
    for (const p of ports) { const who = busy.get(`${p.host}/${p.proto}`); if (who) throw new Error(`le port ${p.host} est déjà pris par ${who}`); }
    const cfg = img.config.config ?? {}, env: Record<string, string> = {};
    for (const e of cfg.Env ?? []) { const i = e.indexOf('='); if (i > 0) env[e.slice(0, i)] = e.slice(i + 1); }
    for (const [k, v] of Object.entries(o.env ?? {})) { if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(k)) throw new Error(`variable invalide : ${k}`); env[k] = String(v); }
    env.PATH ??= '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin';
    const entry = o.entrypoint ?? cfg.Entrypoint ?? [], cmd = o.cmd?.length ? o.cmd : o.entrypoint ? [] : (cfg.Cmd ?? []);
    if (!entry.length && !cmd.length) throw new Error('l\'image ne dit pas quoi lancer : donne une commande');
    if (o.memory && !/^\d+(\.\d+)?[kmg]?$/i.test(o.memory)) throw new Error('mémoire : par exemple 512m ou 4g');
    if (o.cpus && !/^\d+(\.\d+)?$/.test(o.cpus)) throw new Error('cœurs : un nombre');
    const id = randomBytes(32).toString('hex'), network = o.network ?? (this.rootless ? 'hote' : 'pont');
    if (network === 'pont' && this.rootless) throw new Error('le réseau privé des conteneurs demande Odin en administrateur : utilise --network hote');
    const spec: Spec = { id, name, image: img.names[0] ?? o.image, imageId: img.id, cmd: [...entry, ...cmd], env, workdir: o.workdir ?? cfg.WorkingDir ?? '/', user: o.user ?? cfg.User ?? '', ports, mounts, restart: o.restart ?? 'non', memory: o.memory, cpus: o.cpus, hostname: o.hostname ?? name.slice(0, 63), network, autoRemove: !!o.rm, created: new Date().toISOString(), labels: { 'odin.moteur': 'hringhorni', ...(o.labels ?? {}) } };
    for (const m of mounts) await mkdir(m.host, { recursive: true }).catch(() => {});
    this.store.saveSpec(spec); this.store.saveState(id, { status: 'créé' });
    return spec;
  }
  /** Tout ce qu'il faut pour lancer : cibles des montages (résolues sans sortir de la racine), utilisateur, commande. */
  async plan(spec: Spec, extra: { ip?: string; cgroup?: string } = {}): Promise<Plan> {
    const lower = this.store.rootfs(spec.imageId), ctrDir = this.store.ctr(spec.id), layers = [join(ctrDir, 'haut'), lower];
    if (!existsSync(lower)) throw new Error(`image absente (${spec.image}) : refais « pull »`);
    const res = (p: string) => resolveIn(layers, p);
    const mounts = [] as Plan['targets']['mounts'];
    for (const m of spec.mounts) mounts.push({ ...m, rel: await res(m.inner) });
    const { uid, gid } = this.rootless ? { uid: 0, gid: 0 } : await resolveUser(layers, spec.user);
    const env = { ...spec.env, HOSTNAME: spec.hostname };
    // fichiers réseau du conteneur
    const others = this.ps().filter((c) => c.id !== spec.id && c.state.ip).map((c) => `${c.state.ip} ${c.spec.name}`);
    writeFileSync(join(ctrDir, 'hosts'), `127.0.0.1\tlocalhost\n::1\tlocalhost ip6-localhost\n${extra.ip ? `${extra.ip}\t${spec.hostname} ${spec.name}\n` : `127.0.1.1\t${spec.hostname}\n`}${others.join('\n')}${others.length ? '\n' : ''}`);
    writeFileSync(join(ctrDir, 'resolv.conf'), resolvConf(spec.network === 'pont'));
    writeFileSync(join(ctrDir, 'hostname'), `${spec.hostname}\n`);
    return { ctrDir, lower, spec, argv: spec.cmd, env, uid, gid, rootless: this.rootless, sysfs: spec.network === 'pont', cgroup: extra.cgroup, tools: await this.getTools(),
      targets: { mounts, proc: await res('/proc'), dev: await res('/dev'), sys: await res('/sys'), tmp: await res('/tmp'), hosts: await res('/etc/hosts'), resolv: await res('/etc/resolv.conf'), hostname: await res('/etc/hostname') } };
  }
  /** La commande qui crée les espaces de noms et lance le script (utilisée par le gardien). */
  outer(spec: Spec, script: string, tools: Tools): string[] {
    const ns = ['unshare', ...(this.rootless ? ['--user', '--map-root-user'] : []), '--pid', '--fork', '--mount', '--uts', '--ipc', '--kill-child=SIGKILL', '--', '/bin/sh', '-c', script];
    ns[0] = tools.unshare;
    return spec.network === 'pont' ? [tools.ip ?? 'ip', 'netns', 'exec', nsName(spec.id), ...ns] : ns;
  }
  async startNetwork(spec: Spec): Promise<string | undefined> {
    if (spec.network !== 'pont') return undefined;
    const run = this.runner(); await ensureBridge(run);
    const ip = await lease(run, spec.id);
    try { await attach(run, spec.id, ip); } catch (e) { release(ip, spec.id); throw e; }
    return ip;
  }
  /** Limites mémoire et processeur (cgroup v2, en administrateur). */
  cgroup(spec: Spec): string | undefined {
    if (this.rootless || !existsSync('/sys/fs/cgroup/cgroup.controllers')) return undefined;
    try {
      const base = '/sys/fs/cgroup/odin', dir = join(base, spec.id.slice(0, 12));
      mkdirSync(dir, { recursive: true });
      try { writeFileSync('/sys/fs/cgroup/cgroup.subtree_control', '+memory +cpu +pids'); writeFileSync(join(base, 'cgroup.subtree_control'), '+memory +cpu +pids'); } catch { /* déjà actif ou refusé */ }
      if (spec.memory) { const m = /^(\d+(?:\.\d+)?)([kmg]?)$/i.exec(spec.memory)!; writeFileSync(join(dir, 'memory.max'), String(Math.round(Number(m[1]) * ({ '': 1, k: 1024, m: 1024 ** 2, g: 1024 ** 3 }[m[2].toLowerCase()] ?? 1)))); }
      if (spec.cpus) writeFileSync(join(dir, 'cpu.max'), `${Math.round(Number(spec.cpus) * 100000)} 100000`);
      writeFileSync(join(dir, 'pids.max'), '4096');
      return dir;
    } catch { return undefined; }
  }
  /** Démarre : lance le gardien du conteneur (détaché) et attend qu'il tourne vraiment. */
  async start(nameOrId: string): Promise<Ctr> {
    const c = this.find(nameOrId);
    if (c.state.status === 'en marche' && alive(c.state.gardien)) return c;
    await this.getTools();
    rmFlag(this.store.ctr(c.id));
    this.store.saveState(c.id, { status: 'redémarre', restarts: 0 });
    const g = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', new URL('./gardien.ts', import.meta.url).pathname, this.store.dir, c.id, this.rootless ? 'sans-admin' : 'admin'], { detached: true, stdio: 'ignore', env: { PATH: process.env.PATH ?? '/usr/sbin:/usr/bin:/sbin:/bin' } });
    g.unref();
    this.store.patchState(c.id, { gardien: g.pid });
    for (let i = 0; i < 100; i++) {
      await new Promise((r) => setTimeout(r, 100));
      const st = this.store.state(c.id);
      if (st.status === 'en marche' && st.pid) return { ...c, state: st };
      if (st.status === 'sorti' || st.status === 'arrêté') { const tail = this.logs(c.id, 5).map((l) => l.text).join(' / '); throw new Error(`${c.spec.name} s'est arrêté au démarrage${st.error ? ` : ${st.error}` : ''}${tail ? ` — ${tail}` : ''}`); }
    }
    return this.find(c.id);
  }
  async run(o: RunOpts): Promise<Ctr> { const s = await this.create(o); return this.start(s.id); }
  /** Arrêt propre : le gardien prévient l'appli, attend, puis force si besoin. */
  async stop(nameOrId: string, timeout = 10): Promise<Ctr> {
    const c = this.find(nameOrId);
    writeFileSync(join(this.store.ctr(c.id), 'arret'), String(timeout));
    if (alive(c.state.gardien)) process.kill(c.state.gardien!, 'SIGTERM');
    for (let i = 0; i < (timeout + 5) * 10; i++) { if (!alive(this.store.state(c.id).gardien)) break; await new Promise((r) => setTimeout(r, 100)); }
    const st = this.store.state(c.id); if (st.status === 'en marche' || st.status === 'redémarre') this.store.patchState(c.id, { status: 'arrêté', finishedAt: new Date().toISOString() });
    return existsSync(this.store.ctr(c.id)) ? this.find(c.id) : c;
  }
  async restart(nameOrId: string): Promise<Ctr> { await this.stop(nameOrId); return this.start(nameOrId); }
  async rm(nameOrId: string, force = false): Promise<Spec> {
    const c = this.find(nameOrId);
    if ((c.state.status === 'en marche' || c.state.status === 'redémarre') && !force) throw new Error(`${c.spec.name} tourne : arrête-le d'abord (ou force)`);
    if (alive(c.state.gardien)) await this.stop(c.id, 3);
    await this.runner()('umount', ['-R', join(this.store.ctr(c.id), 'racine')]).catch(() => {});
    await rm(this.store.ctr(c.id), { recursive: true, force: true });
    return c.spec;
  }
  /** Les dernières lignes du journal. */
  logs(nameOrId: string, tail = 200): Array<{ at: string; stream: 'o' | 'e'; text: string }> {
    const c = this.find(nameOrId), f = this.store.log(c.id); let txt = '';
    try { const size = statSync(f).size, n = Math.min(size, 2_000_000), fd = openSync(f, 'r'), b = Buffer.alloc(n); readSync(fd, b, 0, n, size - n); closeSync(fd); txt = b.toString('utf8'); } catch { return []; }
    return txt.split('\n').filter(Boolean).slice(-tail).map((l) => { const m = /^(\S+) ([oe]) (.*)$/s.exec(l); return m ? { at: m[1], stream: m[2] as 'o' | 'e', text: m[3] } : { at: '', stream: 'o' as const, text: l }; });
  }
  /** Lance une commande dans un conteneur en marche (mêmes espaces de noms, même racine, mêmes limites de droits). */
  async execArgs(nameOrId: string, argv: string[], o: { user?: string; workdir?: string; env?: Record<string, string> } = {}): Promise<{ cmd: string; args: string[]; env: Record<string, string> }> {
    const c = this.find(nameOrId);
    if (c.state.status !== 'en marche' || !c.state.pid || !alive(c.state.pid)) throw new Error(`${c.spec.name} ne tourne pas`);
    if (!argv.length) throw new Error('quelle commande ?');
    const t = await this.getTools(), layers = [join(this.store.ctr(c.id), 'haut'), this.store.rootfs(c.spec.imageId)];
    const { uid, gid } = this.rootless ? { uid: 0, gid: 0 } : await resolveUser(layers, o.user ?? c.spec.user);
    const env = { ...c.spec.env, HOSTNAME: c.spec.hostname, ...(o.env ?? {}) };
    const inner = finalExec({ argv, env, uid, gid, tools: t, rootless: this.rootless }, join(this.store.ctr(c.id), 'racine'), o.workdir ?? c.spec.workdir);
    return { cmd: t.nsenter, args: ['-t', String(c.state.pid), '-m', '-u', '-i', '-n', '-p', ...(this.rootless ? ['-U', '--preserve-credentials'] : []), '--', ...inner], env: { PATH: '/usr/sbin:/usr/bin:/sbin:/bin' } };
  }
  inspect(nameOrId: string): Record<string, unknown> {
    try { const c = this.find(nameOrId); return { genre: 'conteneur', ...c.spec, etat: c.state }; }
    catch { const i = this.findImage(nameOrId); if (!i) throw new Error(`inconnu : ${nameOrId}`); return { genre: 'image', ...i }; }
  }
  /** Le script de préparation (exposé pour le gardien et les tests). */
  script(p: Plan): string { return setupScript(p); }
}
export function rmFlag(dir: string) { rmSync(join(dir, 'arret'), { force: true }); }
export type { Status };
