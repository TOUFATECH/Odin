// Hringhorni — où tout est rangé : morceaux d'images, images dépaquetées, conteneurs (fiche, état, journal).
// Tout est privé (droits 0700) : les fichiers d'une image ne sont jamais à la portée des autres comptes de la machine.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { ImageConfig, Descriptor } from './registry.ts';

export const isRoot = () => typeof process.getuid === 'function' && process.getuid() === 0;
/** Le dossier du moteur : /var/lib/odin/hringhorni en administrateur, sinon dans le compte. */
export function defaultDir(): string {
  if (process.env.ODIN_HRINGHORNI) return process.env.ODIN_HRINGHORNI;
  return isRoot() ? '/var/lib/odin/hringhorni' : join(process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share'), 'odin', 'hringhorni');
}

export interface Image { id: string; names: string[]; digest: string; config: ImageConfig; configDigest: string; layers: Descriptor[]; size: number; pulled: string }
export interface Port { host: number; inner: number; proto: 'tcp' | 'udp' }
export interface Mount { host: string; inner: string; ro: boolean }
export type Restart = 'non' | 'toujours' | 'si-erreur' | 'sauf-arret';
export interface Spec {
  id: string; name: string; image: string; imageId: string;
  cmd: string[]; env: Record<string, string>; workdir: string; user: string;
  ports: Port[]; mounts: Mount[]; restart: Restart; memory?: string; cpus?: string; hostname: string;
  network: 'pont' | 'hote'; autoRemove: boolean; created: string; labels: Record<string, string>;
}
export type Status = 'créé' | 'en marche' | 'arrêté' | 'sorti' | 'redémarre';
export interface State { status: Status; gardien?: number; pid?: number; ip?: string; startedAt?: string; finishedAt?: string; exitCode?: number; error?: string; restarts?: number; rootless?: boolean }

export class Store {
  readonly dir: string;
  constructor(dir: string) { this.dir = dir; }
  /** Crée les dossiers au premier besoin (lire un moteur vide ne laisse aucune trace). */
  ensure() { for (const d of ['', 'blobs/sha256', 'images', 'containers']) mkdirSync(join(this.dir, d), { recursive: true, mode: 0o700 }); }
  blob(digest: string) { return join(this.dir, 'blobs', 'sha256', digest.replace(/^sha256:/, '')); }
  rootfs(imageId: string) { return join(this.dir, 'images', imageId, 'rootfs'); }
  ctr(id: string) { return join(this.dir, 'containers', id); }
  private read<T>(f: string, d: T): T { try { return JSON.parse(readFileSync(f, 'utf8')) as T; } catch { return d; } }
  private write(f: string, v: unknown) { const t = `${f}.${process.pid}.tmp`; writeFileSync(t, JSON.stringify(v, null, 1), { mode: 0o600 }); renameSync(t, f); }
  images(): Image[] { return this.read<Image[]>(join(this.dir, 'images.json'), []); }
  saveImages(l: Image[]) { this.ensure(); this.write(join(this.dir, 'images.json'), l); }
  spec(id: string): Spec | null { return this.read<Spec | null>(join(this.ctr(id), 'fiche.json'), null); }
  saveSpec(s: Spec) { this.ensure(); mkdirSync(this.ctr(s.id), { recursive: true, mode: 0o700 }); this.write(join(this.ctr(s.id), 'fiche.json'), s); }
  state(id: string): State { return this.read<State>(join(this.ctr(id), 'etat.json'), { status: 'créé' }); }
  saveState(id: string, s: State) { if (existsSync(this.ctr(id))) this.write(join(this.ctr(id), 'etat.json'), s); }
  patchState(id: string, p: Partial<State>) { this.saveState(id, { ...this.state(id), ...p }); }
  log(id: string) { return join(this.ctr(id), 'journal.log'); }
}
