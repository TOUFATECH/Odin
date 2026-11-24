// Hringhorni — le moteur de conteneurs d'Odin. Il fonctionne comme Podman, sans démon : chaque commande
// (pull, run, ps, stop, logs, exec, start, rm, images) agit directement, et chaque conteneur en marche n'a
// qu'un petit gardien à lui (journal, ports, redémarrage) qui s'arrête avec lui. Les images Docker (Docker Hub,
// GHCR, Quay…) sont récupérées et dépaquetées par Odin lui-même.
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { constants, existsSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync, mkdirSync, openSync, readSync, closeSync, lstatSync, realpathSync, renameSync, unlinkSync } from 'node:fs';
import { access, mkdir, rename, rm } from 'node:fs/promises';
import { basename, join, delimiter, dirname, resolve, sep } from 'node:path';
import { autoName, parseMounts, parsePorts } from '../parc.ts';
import { attach, attachNone, defaultRunner, ensureBridge, lease, nsName, PONT_DEFAUT, pontDe, release, removeBridge, resolvConf, sousReseauLibre, type Pont, type Runner } from './net.ts';
import { parseRef, Registry } from './registry.ts';
import { findTools, resolveIn, resolveUser, setupScript, finalExec, type Plan, type Tools } from './script.ts';
import { defaultDir, isRoot, NOM_OBJET, Store, type Image, type Mount, type Port, type Reseau, type Restart, type Spec, type State, type Status, type Volume } from './store.ts';
import { extractLayer, layerStream } from './tar.ts';
import { bytes, resizeLive } from './scale.ts';
import { Bloque, quarantaineDabord } from '../ullr/garde.ts';

export interface RunOpts {
  image: string; name?: string; cmd?: string[]; entrypoint?: string[]; env?: Record<string, string>;
  ports?: Port[] | string; mounts?: Mount[] | string; restart?: Restart; memory?: string; cpus?: string;
  user?: string; workdir?: string; hostname?: string; network?: 'pont' | 'hote' | 'aucun'; reseau?: string; rm?: boolean; labels?: Record<string, string>;
}
/** Un volume tel que l'appli le montre : sa taille (comptée sans suivre les liens, bornée) et qui s'en sert. */
export interface VolumeVu extends Volume { dossier: string; octets: number; fichiers: number; compteCoupe: boolean; utilisePar: string[] }
/** Un réseau tel que l'appli le montre (le réseau de tous d'abord, puis les réseaux à part), avec ses conteneurs. */
export interface ReseauVu { nom: string; defaut: boolean; pont: string; sousReseau: string; internet: boolean; cree?: string; conteneurs: string[] }
/** Le nom du réseau de tous les conteneurs, et les noms qu'un réseau à part ne peut pas prendre. */
export const RESEAU_DE_TOUS = 'conteneurs';
const NOMS_RESERVES = new Set([RESEAU_DE_TOUS, 'aucun', 'none', 'hote', 'host', 'pont', 'bridge', 'defaut', 'default', 'odin', 'machine']);
/** La taille d'un dossier, sans suivre les liens et sans jamais tout lire d'un grand volume (au plus `max` entrées, et
 *  jamais après `finA` : le comptage se fait sans rendre la main, il ne doit pas bloquer Odin). */
export function tailleDossier(dir: string, max = 200_000, finA = Infinity): { octets: number; fichiers: number; coupe: boolean } {
  let octets = 0, fichiers = 0, vus = 0; const pile = [dir];
  while (pile.length) {
    if (Date.now() > finA) return { octets, fichiers, coupe: true };
    const d = pile.pop()!; let l: import('node:fs').Dirent[] = [];
    try { l = readdirSync(d, { withFileTypes: true }); } catch { continue; }
    for (const e of l) {
      if (++vus > max || (vus % 512 === 0 && Date.now() > finA)) return { octets, fichiers, coupe: true };
      const f = join(d, e.name);
      if (e.isDirectory()) pile.push(f);
      else if (e.isFile()) { try { octets += lstatSync(f).size; fichiers++; } catch { /* parti entre-temps */ } }
    }
  }
  return { octets, fichiers, coupe: false };
}
const sansCasse = () => process.platform === 'win32' || process.platform === 'darwin';
const normal = (p: string) => (sansCasse() ? resolve(p).toLowerCase() : resolve(p));
const memeChemin = (a: string, b: string) => normal(a) === normal(b);
/** `p` est `racine` ou dedans (sans casse là où le système l'ignore). */
const dedansOuEgal = (p: string, racine: string) => { const a = normal(p), b = normal(racine); return a === b || a.startsWith(b.endsWith(sep) ? b : b + sep); };
/** Le vrai chemin (liens suivis) du plus proche parent qui existe, suivi du reste tel quel. */
function vraiChemin(p: string): string {
  let x = resolve(p); const reste: string[] = [];
  for (;;) {
    try { return join(realpathSync.native(x), ...reste); } catch { /* pas encore là : on remonte */ }
    const h = dirname(x); if (h === x) return resolve(p);
    reste.unshift(basename(x)); x = h;
  }
}
/** Le budget du comptage des volumes à chaque lecture (tous ensemble) : entrées lues et temps. */
export const COMPTE_VOLUMES = { entrees: 200_000, ms: 1500 };
export interface Ctr { id: string; spec: Spec; state: State }
export type Step = (t: string, note?: string) => void;
/** Où en est une installation : téléchargement (octets), montage (couches dépaquetées), démarrage. */
export interface Progress { phase: 'télécharger' | 'monter' | 'démarrer' | 'fini'; done: number; total: number; layer?: number; layers?: number }
/** Une installation suivie (image récupérée, conteneur monté puis démarré), visible dans l'interface. */
export interface Job { id: string; kind: 'installer' | 'récupérer' | 'mettre à jour'; image: string; name?: string; phase: 'attente' | Progress['phase'] | 'échec'; pct: number; done: number; total: number; note: string; error?: string; started: string; ended?: string; container?: string }
/** La part de la barre : télécharger 0 → 75 %, monter 75 → 95 %, démarrer 95 → 100 %. */
export function pctOf(p: Progress, withStart = true): number {
  const k = p.total > 0 ? Math.min(1, p.done / p.total) : 1, end = withStart ? 95 : 100;
  if (p.phase === 'télécharger') return Math.round(k * 75 * (end / 95));
  if (p.phase === 'monter') return Math.round((75 + k * 20) * (end / 95));
  if (p.phase === 'démarrer') return 97;
  return 100;
}
export const mo = (n: number) => `${(n / 1e6).toFixed(n < 1e7 ? 1 : 0)} Mo`;
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
  async pull(name: string, step: Step = () => {}, progress: (p: Progress) => void = () => {}): Promise<Image> {
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
      let done = 0; const n = manifest.layers.length;
      // déjà téléchargé (reprise) : compté tout de suite
      for (const l of manifest.layers) if (existsSync(this.store.blob(l.digest)) && statSync(this.store.blob(l.digest)).size === l.size) done += l.size;
      progress({ phase: 'télécharger', done, total, layers: n });
      for (const [i, l] of manifest.layers.entries()) {
        step(`Télécharger la couche ${i + 1}/${n}`, mo(l.size));
        const had = existsSync(this.store.blob(l.digest)) && statSync(this.store.blob(l.digest)).size === l.size;
        if (!had) await reg.blob(l, this.store.blob(l.digest), (k) => { done += k; progress({ phase: 'télécharger', done, total, layer: i + 1, layers: n }); });
      }
      // Quarantaine d'abord : chaque couche passe par l'antivirus AVANT d'être dépaquetée ; une seule dangereuse et
      // l'image est refusée (rien n'est monté ni lancé), la couche part en quarantaine dans Asclépios.
      step('Analyser l\'image (antivirus)', `${n} couche(s)`);
      for (const [i, l] of manifest.layers.entries()) {
        const p = await quarantaineDabord({ fichier: this.store.blob(l.digest), nom: `couche ${i + 1}/${n} de ${ref.name} (${l.digest.slice(7, 19)})`, origine: 'Arche · image Docker', source: ref.name, usage: 'lancer un conteneur' });
        if (p.bloque) throw new Bloque({ ...p, texte: `image ${ref.name} refusée par l'antivirus : la couche ${i + 1}/${n} contient ${p.menace ?? 'une menace'} (trouvée par ${p.par ?? 'analyse'}). Rien n'a été dépaqueté ni lancé ; la couche est en quarantaine (n° ${p.quarantaine ?? '—'}).` });
      }
      step('Dépaqueter l\'image', mo(total));
      let read = 0; progress({ phase: 'monter', done: 0, total, layer: 0, layers: n });
      const base = join(this.store.dir, 'images', id), tmp = `${base}.tmp-${process.pid}`;
      await rm(tmp, { recursive: true, force: true }); await mkdir(join(tmp, 'rootfs'), { recursive: true, mode: 0o700 });
      for (const [i, l] of manifest.layers.entries()) await extractLayer(await layerStream(this.store.blob(l.digest), l.mediaType, (k) => { read += k; progress({ phase: 'monter', done: read, total, layer: i + 1, layers: n }); }), join(tmp, 'rootfs'), { chown: !this.rootless });
      writeFileSync(join(tmp, '.complet'), new Date().toISOString());
      await rm(base, { recursive: true, force: true }); await rename(tmp, base);
    }
    const list = this.images().map((i) => ({ ...i, names: i.names.filter((n) => n !== ref.name) })).filter((i) => i.names.length || i.id === id);
    const img: Image = { id, names: [...new Set([...(list.find((i) => i.id === id)?.names ?? []), ref.name])], digest, config, configDigest: manifest.config.digest, layers: manifest.layers, size: total, pulled: new Date().toISOString() };
    this.store.saveImages([...list.filter((i) => i.id !== id), img]);
    step('Image prête', `${ref.name} (${id.slice(0, 12)})`);
    progress({ phase: 'fini', done: total, total });
    return img;
  }
  // ------------------------------------------------------------------ installations suivies (barre de progression)
  private jobFile(id: string) { return join(this.store.dir, 'taches', `${id}.json`); }
  /** Les installations des dernières 24 h (en cours d'abord). */
  jobs(): Job[] {
    let files: string[] = []; try { files = readdirSync(join(this.store.dir, 'taches')); } catch { return []; }
    const out: Job[] = [];
    for (const f of files) {
      try {
        const j = JSON.parse(readFileSync(join(this.store.dir, 'taches', f), 'utf8')) as Job;
        // une installation dont le processus a disparu (Odin redémarré) n'est plus « en cours »
        const old = Date.now() - Date.parse(j.ended ?? j.started) > 86_400_000;
        if (old) { rmSync(join(this.store.dir, 'taches', f), { force: true }); continue; }
        out.push(j);
      } catch { /* fichier en cours d'écriture */ }
    }
    return out.sort((a, b) => Number(!!a.ended) - Number(!!b.ended) || b.started.localeCompare(a.started));
  }
  /** Lance une installation en arrière-plan et la suit pas à pas (fichier relu par l'interface). */
  startJob(kind: Job['kind'], image: string, work: (report: (p: Progress, note?: string) => void, set: (patch: Partial<Job>) => void) => Promise<Partial<Job> | void>, name?: string): Job {
    this.store.ensure(); mkdirSync(join(this.store.dir, 'taches'), { recursive: true, mode: 0o700 });
    const j: Job = { id: randomBytes(6).toString('hex'), kind, image, name, phase: 'attente', pct: 0, done: 0, total: 0, note: 'en attente', started: new Date().toISOString() };
    let last = 0;
    const save = (force = false) => { const now = Date.now(); if (!force && now - last < 250) return; last = now; try { writeFileSync(this.jobFile(j.id), JSON.stringify(j), { mode: 0o600 }); } catch { /* disque plein */ } };
    const set = (patch: Partial<Job>) => { Object.assign(j, patch); save(true); };
    const report = (p: Progress, note?: string) => {
      Object.assign(j, { phase: p.phase, done: p.done, total: p.total, pct: Math.max(j.pct, pctOf(p, kind !== 'récupérer')),
        note: note ?? (p.phase === 'télécharger' ? `Téléchargement ${mo(p.done)} / ${mo(p.total)}${p.layers ? ` · couche ${p.layer ?? 1}/${p.layers}` : ''}` : p.phase === 'monter' ? `Montage de l'image${p.layers ? ` · couche ${p.layer || 1}/${p.layers}` : ''}` : p.phase === 'démarrer' ? 'Démarrage du conteneur' : 'Terminé') });
      save(p.phase !== 'télécharger' && p.phase !== 'monter');
    };
    save(true);
    void (async () => {
      try { const extra = await work(report, set); Object.assign(j, { phase: 'fini', pct: 100, note: 'Terminé', ended: new Date().toISOString() }, extra ?? {}); }
      catch (e) { Object.assign(j, { phase: 'échec', error: (e as Error).message, note: `Échec : ${(e as Error).message}`, ended: new Date().toISOString() }); }
      save(true);
    })();
    return j;
  }
  /** Installer (récupérer l'image si besoin, monter, démarrer) en arrière-plan, avec la barre de progression. */
  runJob(o: RunOpts): Job {
    return this.startJob('installer', o.image, async (report, set) => {
      if (!this.findImage(o.image)) await this.pull(o.image, () => {}, (p) => report(p));
      report({ phase: 'démarrer', done: 1, total: 1 });
      const c = await this.run(o); set({ name: c.spec.name });
      return { container: c.spec.name, name: c.spec.name, note: `${c.spec.name} en marche` };
    }, o.name);
  }
  pullJob(name: string): Job { return this.startJob('récupérer', name, async (report) => { const i = await this.pull(name, () => {}, (p) => report(p)); return { note: `Image prête (${mo(i.size)})` }; }); }

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
    const mounts = this.montages(o.mounts);
    const network0 = o.network ?? (this.rootless ? 'hote' : 'pont');
    const reseau = network0 === 'pont' && o.reseau && o.reseau !== RESEAU_DE_TOUS ? o.reseau : undefined;
    if (reseau && !this.store.reseaux().some((r) => r.nom === reseau)) throw new Error(`réseau inconnu : ${reseau.slice(0, 64)} (crée-le d'abord)`);
    if (network0 === 'aucun' && ports.length) throw new Error('réseau « aucun » : aucun port ne peut être ouvert (ni Internet ni la maison)');
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
    const id = randomBytes(32).toString('hex'), network = network0;
    if (network === 'pont' && this.rootless) throw new Error('le réseau privé des conteneurs demande Odin en administrateur : utilise --network hote');
    const spec: Spec = { id, name, image: img.names[0] ?? o.image, imageId: img.id, cmd: [...entry, ...cmd], env, workdir: o.workdir ?? cfg.WorkingDir ?? '/', user: o.user ?? cfg.User ?? '', ports, mounts, restart: o.restart ?? 'non', memory: o.memory, cpus: o.cpus, hostname: o.hostname ?? name.slice(0, 63), network, ...(reseau ? { reseau } : {}), autoRemove: !!o.rm, created: new Date().toISOString(), labels: { 'odin.moteur': 'hringhorni', ...(o.labels ?? {}) } };
    for (const m of mounts) if (!m.volume) await mkdir(m.host, { recursive: true }).catch(() => {});
    // Les volumes et la fiche d'un même trait (sans rendre la main) : un volume ne peut pas être supprimé entre les deux.
    for (const m of mounts) if (m.volume) this.createVolume(m.volume, true);
    this.store.saveSpec(spec); this.store.saveState(id, { status: 'créé' });
    return spec;
  }
  /** Les dossiers partagés : « /chemin:/dedans[:ro] » (un dossier de la machine) ou « nom:/dedans[:ro] » (un volume
   *  nommé, créé s'il n'existe pas, rangé par le moteur). */
  montages(m: Mount[] | string | undefined): Mount[] {
    const l = typeof m === 'string' ? m.split(/[,\n]+/).map((v) => v.trim()).filter(Boolean).map((v) => {
      const [host, inner, mode, ...trop] = v.split(':');
      // « c:/dossier:/dedans » (un disque Windows) ou un mode inconnu : refusé, jamais deviné
      if (trop.length || (mode !== undefined && mode !== 'ro' && mode !== 'rw')) throw new Error(`dossier invalide : ${v.slice(0, 120)} (« /chemin:/dedans[:ro] » ou « nom:/dedans[:ro] »)`);
      return { host: host ?? '', inner: inner ?? '', ro: mode === 'ro', ...(NOM_OBJET.test(host ?? '') ? { volume: host } : {}) } as Mount;
    }) : (m ?? []);
    return l.map((x) => {
      if (!x.volume) {
        const p = parseMounts(`${x.host}:${x.inner}${x.ro ? ':ro' : ''}`)[0], d = this.store.dir;
        // Jamais le dossier du moteur par son chemin (ses volumes, ses conteneurs, ses images) : un volume se donne par son nom.
        if (dedansOuEgal(p.host, d) || dedansOuEgal(vraiChemin(p.host), vraiChemin(d))) throw new Error(`dossier refusé : c'est le dossier du moteur de conteneurs (un volume se donne par son nom, « nom:${p.inner} »)`);
        return p;
      }
      if (!NOM_OBJET.test(x.volume)) throw new Error(`nom de volume invalide : ${String(x.volume).slice(0, 64)}`);
      if (!String(x.inner ?? '').startsWith('/') || /(^|\/)\.\.(\/|$)/.test(x.inner)) throw new Error(`dossier invalide dans le conteneur : ${String(x.inner).slice(0, 120)}`);
      return { host: this.store.volumeData(x.volume), inner: x.inner, ro: !!x.ro, volume: x.volume };
    });
  }

  // ------------------------------------------------------------------ volumes nommés (lot K2)
  /** Crée un volume (rien si `siAbsent` et qu'il existe). */
  createVolume(nom: string, siAbsent = false): Volume {
    if (!NOM_OBJET.test(nom)) throw new Error(`nom de volume invalide : ${nom.slice(0, 64)} (minuscules, chiffres, - _ .)`);
    const ici = this.store.volumes().find((v) => v.nom === nom);
    if (ici) { if (siAbsent) return ici; throw new Error(`le volume ${nom} existe déjà`); }
    const v: Volume = { nom, cree: new Date().toISOString() }; this.store.saveVolume(v); return v;
  }
  /** Les conteneurs (même arrêtés) qui se servent d'un volume. */
  utilisateursVolume(nom: string): string[] {
    // Dedans (un dossier du volume) ou AU-DESSUS (le dossier des volumes, ou celui du moteur, monté par son chemin) :
    // les deux s'en servent. Vérifié sur le chemin écrit et sur le vrai chemin (un lien posé sur le chemin).
    const dir = this.store.volumeDir(nom), vdir = vraiChemin(dir);
    const touche = (h: string) => { const v = vraiChemin(h); return dedansOuEgal(h, dir) || dedansOuEgal(dir, h) || dedansOuEgal(v, vdir) || dedansOuEgal(vdir, v); };
    return this.ps(true).filter((c) => c.spec.mounts.some((m) => m.volume === nom || touche(m.host))).map((c) => c.spec.name);
  }
  volumes(): VolumeVu[] {
    // Un seul budget pour tous les volumes : la lecture rend toujours la main vite, même avec beaucoup de gros volumes.
    let reste = COMPTE_VOLUMES.entrees; const finA = Date.now() + COMPTE_VOLUMES.ms;
    return this.store.volumes().map((v) => {
      const dossier = this.store.volumeData(v.nom), t = reste > 0 ? tailleDossier(dossier, reste, finA) : { octets: 0, fichiers: 0, coupe: true };
      reste -= t.fichiers + 1;
      return { ...v, dossier, octets: t.octets, fichiers: t.fichiers, compteCoupe: t.coupe, utilisePar: this.utilisateursVolume(v.nom) };
    });
  }
  /** Le vrai dossier d'un volume, vérifié : exactement « <moteur>/volumes/<nom> », sans aucun lien sur le chemin
   *  (ni le dossier des volumes, ni le volume, ni ses données). Sinon : refus, rien n'est touché. */
  dossierVerifieVolume(nom: string): string {
    const dir = this.store.volumeDir(nom), base = this.store.volumesDir();
    for (const p of [base, dir, this.store.volumeData(nom)]) { try { if (lstatSync(p).isSymbolicLink()) throw new Error(`le volume ${nom} passe par un lien vers un autre dossier : rien n'est effacé`); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; } }
    let reel: string; try { reel = realpathSync.native(dir); } catch { throw new Error(`volume introuvable sur le disque : ${nom}`); }
    if (!memeChemin(reel, join(realpathSync.native(base), nom)) || !memeChemin(reel, resolve(dir))) throw new Error(`le volume ${nom} n'est pas rangé là où le moteur range ses volumes : rien n'est effacé`);
    return reel;
  }
  /** Supprime un volume que PLUS RIEN n'utilise (aucun conteneur, même arrêté). Le nom tapé est vérifié par l'appli. */
  rmVolume(nom: string, garde: (reel: string) => string | undefined = () => undefined): Volume {
    const v = this.store.volumes().find((x) => x.nom === nom); if (!v) throw new Error(`volume inconnu : ${nom.slice(0, 64)}`);
    const u = this.utilisateursVolume(nom); if (u.length) throw new Error(`le volume ${nom} sert encore à : ${u.join(', ')} (supprime ces conteneurs d'abord)`);
    const reel = this.dossierVerifieVolume(nom), pourquoi = garde(reel);
    if (pourquoi) throw new Error(`le volume ${nom} n'est pas effacé : ${pourquoi}`);
    // D'abord mis de côté d'un seul geste (renommé dans le même dossier) : s'il a été remplacé par un lien depuis la
    // vérification, c'est le lien qui est déplacé, puis seulement retiré ; sa cible n'est jamais touchée.
    // Le chemin a été vérifié sans aucun lien : il doit l'être encore juste avant (dossier des volumes) et juste après.
    const base = dirname(reel), cote = join(base, `.efface-${randomBytes(6).toString('hex')}`);
    const horsDuMoteur = () => new Error(`le volume ${nom} n'est plus rangé chez le moteur (un lien posé entre-temps) : rien n'est effacé`);
    if (!memeChemin(realpathSync.native(base), base)) throw horsDuMoteur();
    renameSync(reel, cote);
    if (lstatSync(cote).isSymbolicLink()) { unlinkSync(cote); throw new Error(`le volume ${nom} a été remplacé par un lien pendant la suppression : seul le lien est retiré`); }
    if (!memeChemin(realpathSync.native(cote), cote)) { try { renameSync(cote, reel); } catch { /* laissé de côté, intact */ } throw horsDuMoteur(); }
    rmSync(cote, { recursive: true, force: true });
    return v;
  }

  // ------------------------------------------------------------------ réseaux (lot K2)
  /** Le réseau de tous, puis les réseaux à part, chacun avec ses conteneurs. */
  reseaux(): ReseauVu[] {
    const cts = this.ps(true).filter((c) => c.spec.network === 'pont');
    const de = (n?: string) => cts.filter((c) => (c.spec.reseau ?? '') === (n ?? '')).map((c) => c.spec.name);
    return [{ nom: RESEAU_DE_TOUS, defaut: true, ...PONT_DEFAUT, conteneurs: de() }, ...this.store.reseaux().map((r) => ({ ...r, defaut: false, conteneurs: de(r.nom) }))];
  }
  createReseau(nom: string, o: { internet?: boolean } = {}): Reseau {
    if (!NOM_OBJET.test(nom)) throw new Error(`nom de réseau invalide : ${nom.slice(0, 64)} (minuscules, chiffres, - _ .)`);
    if (NOMS_RESERVES.has(nom)) throw new Error(`« ${nom} » est un nom gardé par Odin : choisis-en un autre`);
    const l = this.store.reseaux(); if (l.some((r) => r.nom === nom)) throw new Error(`le réseau ${nom} existe déjà`);
    const sousReseau = sousReseauLibre(l.map((r) => r.sousReseau));
    const r: Reseau = { nom, pont: pontDe(sousReseau), sousReseau, internet: o.internet !== false, cree: new Date().toISOString() };
    this.store.saveReseaux([...l, r]); return r;
  }
  /** Retire un réseau à part que plus aucun conteneur (même arrêté) n'utilise : son pont et ses règles partent avec lui. */
  async rmReseau(nom: string): Promise<Reseau> {
    if (nom === RESEAU_DE_TOUS) throw new Error('le réseau de tous les conteneurs ne se retire pas');
    const l = this.store.reseaux(), r = l.find((x) => x.nom === nom); if (!r) throw new Error(`réseau inconnu : ${nom.slice(0, 64)}`);
    const u = this.reseaux().find((x) => x.nom === nom)?.conteneurs ?? []; if (u.length) throw new Error(`le réseau ${nom} sert encore à : ${u.join(', ')}`);
    if (!this.rootless) await removeBridge(this.runner(), r);
    this.store.saveReseaux(l.filter((x) => x.nom !== nom)); return r;
  }
  /** Le pont d'un conteneur : celui de son réseau à part, ou le réseau de tous. */
  pontDe(spec: Spec): Pont {
    if (!spec.reseau) return PONT_DEFAUT;
    const r = this.store.reseaux().find((x) => x.nom === spec.reseau); if (!r) throw new Error(`réseau inconnu : ${spec.reseau} (il a été retiré)`);
    return r;
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
    // les autres conteneurs en marche, et ceux à adresse fixe (la base d'Odin) même arrêtés : on les retrouve par leur nom
    // (sur un réseau à part : seulement les conteneurs du même réseau ; réseau « aucun » : personne)
    const meme = (c: Ctr) => spec.network !== 'pont' || (c.spec.network === 'pont' && (c.spec.reseau ?? '') === (spec.reseau ?? ''));
    // (dans une pile, lot K3 : un service retrouve aussi les autres par leur nom de service, « db », comme dans le fichier)
    const pile = spec.labels['odin.pile'], alias = (c: Ctr) => { const s = c.spec.labels['odin.pile.service']; return pile && c.spec.labels['odin.pile'] === pile && s && /^[a-z0-9][a-z0-9_-]{0,29}$/.test(s) ? ` ${s}` : ''; };
    const others = spec.network === 'aucun' ? [] : this.ps(true).filter((c) => c.id !== spec.id && meme(c) && (c.state.ip || c.spec.labels['odin.ip'])).map((c) => `${c.state.ip ?? c.spec.labels['odin.ip']} ${c.spec.name}${alias(c)}`);
    writeFileSync(join(ctrDir, 'hosts'), `127.0.0.1\tlocalhost\n::1\tlocalhost ip6-localhost\n${extra.ip ? `${extra.ip}\t${spec.hostname} ${spec.name}\n` : `127.0.1.1\t${spec.hostname}\n`}${others.join('\n')}${others.length ? '\n' : ''}`);
    writeFileSync(join(ctrDir, 'resolv.conf'), resolvConf(spec.network === 'pont'));
    writeFileSync(join(ctrDir, 'hostname'), `${spec.hostname}\n`);
    return { ctrDir, lower, spec, argv: spec.cmd, env, uid, gid, rootless: this.rootless, sysfs: spec.network === 'pont', cgroup: extra.cgroup, tools: await this.getTools(),
      targets: { mounts, proc: await res('/proc'), dev: await res('/dev'), sys: await res('/sys'), tmp: await res('/tmp'), hosts: await res('/etc/hosts'), resolv: await res('/etc/resolv.conf'), hostname: await res('/etc/hostname') } };
  }
  /** La commande qui crée les espaces de noms et lance le script (utilisée par le gardien). */
  outer(spec: Spec, script: string, tools: Tools): string[] {
    // réseau « aucun » : l'espace réseau préparé par Odin (en administrateur), sinon un espace réseau vide de unshare
    const vide = spec.network === 'aucun' && this.rootless;
    const ns = ['unshare', ...(this.rootless ? ['--user', '--map-root-user'] : []), ...(vide ? ['--net'] : []), '--pid', '--fork', '--mount', '--uts', '--ipc', '--kill-child=SIGKILL', '--', '/bin/sh', '-c', script];
    ns[0] = tools.unshare;
    return spec.network === 'pont' || (spec.network === 'aucun' && !this.rootless) ? [tools.ip ?? 'ip', 'netns', 'exec', nsName(spec.id), ...ns] : ns;
  }
  async startNetwork(spec: Spec): Promise<string | undefined> {
    if (spec.network === 'aucun') { if (!this.rootless) await attachNone(this.runner(), spec.id); return undefined; }
    if (spec.network !== 'pont') return undefined;
    const run = this.runner(), p = this.pontDe(spec); await ensureBridge(run, p);
    const ip = await lease(run, spec.id, undefined, spec.labels['odin.ip'], p.sousReseau);
    if (spec.labels['odin.ip'] && ip !== spec.labels['odin.ip']) { release(ip, spec.id); throw new Error(`l'adresse ${spec.labels['odin.ip']} est déjà prise`); }
    try { await attach(run, spec.id, ip, p); } catch (e) { release(ip, spec.id); throw e; }
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
  /** Change la mémoire et le processeur d'un conteneur sans l'arrêter ; `grow` « 1g-8g/1-4 » : il grandit tout seul entre ces bornes. */
  async resize(nameOrId: string, o: { memory?: string; cpus?: string; grow?: string }): Promise<Ctr> {
    const c = this.find(nameOrId), spec = { ...c.spec, labels: { ...c.spec.labels } };
    if (o.memory) { if (!/^\d+(\.\d+)?[kmg]?$/i.test(o.memory)) throw new Error('mémoire : par exemple 512m ou 4g'); spec.memory = o.memory; }
    if (o.cpus) { if (!/^\d+(\.\d+)?$/.test(o.cpus) || !(Number(o.cpus) > 0)) throw new Error('cœurs : un nombre'); spec.cpus = o.cpus; }
    if (o.grow === 'non') delete spec.labels['odin.grandir'];
    else if (o.grow) { if (!/^\d+(\.\d+)?[kmg]-\d+(\.\d+)?[kmg]\/\d+(\.\d+)?-\d+(\.\d+)?$/i.test(o.grow)) throw new Error('grandir : mémoire min-max / cœurs min-max, ex. 1g-8g/1-4'); spec.labels['odin.grandir'] = o.grow; spec.memory ??= o.grow.split('-')[0]; spec.cpus ??= o.grow.split('/')[1].split('-')[0]; }
    this.store.saveSpec(spec);
    const st = this.store.state(c.id), dir = join('/sys/fs/cgroup/odin', c.id.slice(0, 12));
    if (st.status === 'en marche' && !this.rootless && existsSync(dir)) {
      resizeLive(dir, { memory: spec.memory ? bytes(spec.memory) : undefined, cpus: spec.cpus ? Number(spec.cpus) : undefined });
    }
    return { ...c, spec };
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
