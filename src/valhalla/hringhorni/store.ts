// Hringhorni — où tout est rangé : morceaux d'images, images dépaquetées, conteneurs (fiche, état, journal).
// Tout est privé (droits 0700) : les fichiers d'une image ne sont jamais à la portée des autres comptes de la machine.
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { ImageConfig, Descriptor } from './registry.ts';
import { dossierOdinParDefaut, processusJetable } from '../../vault.ts';

export const isRoot = () => typeof process.getuid === 'function' && process.getuid() === 0;
/** Le dossier du moteur : /var/lib/odin/hringhorni en administrateur, sinon dans le compte. Sous un essai ou un banc :
 *  dans le dossier d'Odin jetable (ODIN_HOME), jamais dans le compte de la personne (refus franc sinon). */
export function defaultDir(): string {
  if (process.env.ODIN_HRINGHORNI) return process.env.ODIN_HRINGHORNI;
  if (processusJetable()) return join(dossierOdinParDefaut('Hringhorni'), 'hringhorni');
  return isRoot() ? '/var/lib/odin/hringhorni' : join(process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share'), 'odin', 'hringhorni');
}

export interface Image { id: string; names: string[]; digest: string; config: ImageConfig; configDigest: string; layers: Descriptor[]; size: number; pulled: string }
export interface Port { host: number; inner: number; proto: 'tcp' | 'udp' }
/** Un dossier partagé : un dossier de la machine, ou un volume nommé d'Arche (`volume` : son nom ; `host` : son dossier). */
export interface Mount { host: string; inner: string; ro: boolean; volume?: string }
export type Restart = 'non' | 'toujours' | 'si-erreur' | 'sauf-arret';
export interface Spec {
  id: string; name: string; image: string; imageId: string;
  cmd: string[]; env: Record<string, string>; workdir: string; user: string;
  ports: Port[]; mounts: Mount[]; restart: Restart; memory?: string; cpus?: string; hostname: string;
  /** pont : un réseau des conteneurs (`reseau` : son nom, vide = celui de tous) ; hote : celui de la machine ; aucun : ni Internet ni la maison. */
  network: 'pont' | 'hote' | 'aucun'; reseau?: string; autoRemove: boolean; created: string; labels: Record<string, string>;
}
/** Un volume nommé : un dossier rangé par le moteur (volumes/<nom>/donnees), qui reste quand le conteneur part. */
export interface Volume { nom: string; cree: string }
/** Un réseau à part : son pont, son sous-réseau (10.89.N), et s'il sort vers Internet. Isolé des autres réseaux. */
export interface Reseau { nom: string; pont: string; sousReseau: string; internet: boolean; cree: string }
/** Un nom de volume ou de réseau : minuscules, chiffres, « - », « _ », « . » ; jamais de « / » (ce n'est pas un chemin). */
// (ni un nom gardé par Windows — con, nul, com1… —, ni un point final : deux noms qui y seraient le même dossier)
export const NOM_OBJET = /^(?!(con|prn|aux|nul|com\d|lpt\d)(\.|$))[a-z0-9][a-z0-9_.-]{0,62}(?<!\.)$/;
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
  // ---- volumes nommés (lot K2)
  volumesDir() { return join(this.dir, 'volumes'); }
  volumeDir(nom: string) { if (!NOM_OBJET.test(nom)) throw new Error(`nom de volume invalide : ${nom.slice(0, 64)}`); return join(this.volumesDir(), nom); }
  volumeData(nom: string) { return join(this.volumeDir(nom), 'donnees'); }
  volumes(): Volume[] {
    let l: string[] = []; try { l = readdirSync(this.volumesDir()); } catch { return []; }
    return l.filter((n) => NOM_OBJET.test(n)).map((n) => this.read<Volume | null>(join(this.volumesDir(), n, 'fiche.json'), null)).filter((v): v is Volume => !!v && NOM_OBJET.test(v.nom)).sort((a, b) => a.nom.localeCompare(b.nom));
  }
  saveVolume(v: Volume) { this.ensure(); mkdirSync(this.volumeData(v.nom), { recursive: true, mode: 0o700 }); this.write(join(this.volumeDir(v.nom), 'fiche.json'), v); }
  // ---- réseaux à part (lot K2) : le réseau de tous les conteneurs (odin0) n'est pas dans la liste, il est toujours là
  reseaux(): Reseau[] { return this.read<Reseau[]>(join(this.dir, 'reseaux.json'), []).filter((r) => NOM_OBJET.test(r?.nom ?? '')); }
  saveReseaux(l: Reseau[]) { this.ensure(); this.write(join(this.dir, 'reseaux.json'), l); }
}
