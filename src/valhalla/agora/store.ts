// Agora, le store d'Odin : ce qu'il garde, côté Odin.
//
// - Zéro base de données : quatre fichiers JSON dans le dossier de l'appli (catalogue, appareils, ordres, journal),
//   écrits d'un coup (fichier temporaire puis renommage : jamais à moitié écrits), droits 600.
// - Les installateurs envoyés à Odin sont rangés par leur empreinte SHA-256 dans fichiers/ (jamais exécutés par Odin).
// - QUI a droit à un élément n'est PAS ici : c'est le droit de la connexion unique (`ssoDroits` de Persona, voir
//   src/valhalla/sso/etat.ts). Ici, seulement le MODE de chaque groupe (proposée, installée d'office, retirée) et qui l'a choisi.
// - Les appareils (ordinateurs, téléphones) et leurs applis installées, la file des ordres imposés, le journal.

import { createHash, randomBytes } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export type Plateforme = 'windows' | 'mac' | 'linux' | 'android';
export const PLATEFORMES: Plateforme[] = ['windows', 'mac', 'linux', 'android'];
export type Format = 'appimage' | 'deb' | 'exe' | 'msi' | 'dmg' | 'apk';
/** Le format d'un installateur d'après son nom de fichier, et la plateforme qui va avec. */
export const FORMATS: Record<Format, { ext: RegExp; plateforme: Plateforme; nom: string }> = {
  appimage: { ext: /\.appimage$/i, plateforme: 'linux', nom: 'AppImage' },
  deb: { ext: /\.deb$/i, plateforme: 'linux', nom: 'paquet .deb' },
  exe: { ext: /\.exe$/i, plateforme: 'windows', nom: 'installateur .exe' },
  msi: { ext: /\.msi$/i, plateforme: 'windows', nom: 'installateur .msi' },
  dmg: { ext: /\.dmg$/i, plateforme: 'mac', nom: 'image .dmg' },
  apk: { ext: /\.apk$/i, plateforme: 'android', nom: 'APK' },
};
export const formatDe = (nom: string): Format | undefined => (Object.keys(FORMATS) as Format[]).find((f) => FORMATS[f].ext.test(nom));

/** Un installateur d'un élément du store, pour une plateforme. */
export interface Paquet {
  plateforme: Plateforme; format: Format; version: string;
  /** SHA-256 (hexadécimal) : le client le vérifie AVANT d'installer */ sha256: string;
  taille: number; nomFichier: string;
  /** rangé sur Odin (fichiers/<sha256>) */ fichier?: string;
  /** ou téléchargé ailleurs (adresse https) */ lien?: string;
  /** pour désinstaller : nom du paquet .deb, identifiant Android (com.exemple.appli), nom affiché sous Windows, nom de l'appli Mac */
  ident?: string;
  /** avis d'Asclépios à l'ajout */ avis?: string;
  ajoute: number;
}
export type Mode = 'proposee' | 'office' | 'retiree';
export const MODES: Record<Mode, string> = { proposee: 'Proposée', office: 'Installée d\'office', retiree: 'Retirée' };
export interface ModeGroupe { mode: Mode; /** l'admin qui l'a choisi */ par: string; at: number }
/** Un élément du store : une appli d'Odin (web), et/ou des installateurs d'ordinateur et de téléphone. */
export interface Element {
  id: string; nom: string; desc: string;
  /** la clé du droit dans la connexion unique (`ssoDroits`) : l'appli d'Odin, l'appli cliente (pegase, venus) ou « agora-<id> » */
  droit: string;
  /** l'appli d'Odin à ouvrir dans le navigateur (l'élément est alors aussi « Odin (web) ») */ web?: string;
  paquets: Paquet[];
  /** mode de chaque groupe (et « @identifiant » pour une personne) */ modes: Record<string, ModeGroupe>;
  ajoute: number;
}
export type EtatInstall = 'absente' | 'installation' | 'installee' | 'desinstallation' | 'erreur';
export interface EtatAppli { etat: EtatInstall; version?: string; progression?: number; erreur?: string; /** installée par la personne, ou imposée */ par?: 'personne' | 'impose'; maj: number }
export interface Appareil {
  id: string; nom: string; plateforme: Plateforme | 'ios' | 'autre'; systeme: string;
  /** la personne (Persona) qui s'en sert */ sub: string; login: string; nomPersonne: string;
  cree: number; vu: number; ip?: string;
  /** version du store sur l'appareil */ version?: string;
  /** Android : l'appli est « propriétaire de l'appareil » (Android Enterprise) : installe sans toucher */ gere?: boolean;
  applis: Record<string, EtatAppli>;
  /** ce que l'admin a forcé sur CET appareil (prime sur le mode du groupe) */ forces: Record<string, 'installee' | 'absente'>;
  retire?: number;
}
export type Action = 'installer' | 'desinstaller' | 'mettre_a_jour';
export type EtatOrdre = 'attente' | 'envoye' | 'en_cours' | 'fait' | 'echec' | 'annule';
export const OUVERT: EtatOrdre[] = ['attente', 'envoye', 'en_cours'];
/** Un ordre imposé à un appareil : il part par le flux à la seconde, l'appareil rend compte. */
export interface Ordre { id: string; appareil: string; element: string; action: Action; version?: string; par: 'mode' | 'force'; qui: string; cree: number; etat: EtatOrdre; progression?: number; erreur?: string; maj: number; envoye?: number; tentative: number }
export interface Ligne { t: number; qui: string; quoi: string; grave?: boolean }

export const sha256 = (x: string | Buffer) => createHash('sha256').update(x).digest('hex');
export const nouvelId = (n = 5) => randomBytes(n).toString('hex');
function ecrire(f: string, x: unknown): void { const tmp = `${f}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`; writeFileSync(tmp, JSON.stringify(x, null, 1), { mode: 0o600 }); renameSync(tmp, f); }
const lire = <T>(f: string, defaut: T): T => { try { return JSON.parse(readFileSync(f, 'utf8')) as T; } catch { return defaut; } };

/** Les données d'Agora (une instance par dossier, partagée par l'appli et les routes /api/agora/*). */
export class Depot {
  readonly dir: string; readonly fichiers: string;
  /** « ordre » (appareil, ordre), « annule » (appareil, id), « store » (appareil ou « * ») : pour les flux ouverts */
  readonly bus = new EventEmitter();
  /** appareils dont le flux est ouvert en ce moment (nombre de flux) */
  readonly enLigne = new Map<string, number>();
  elements: Element[]; appareils: Appareil[]; ordres: Ordre[]; journal: Ligne[];
  constructor(dir: string) {
    this.dir = dir; this.fichiers = join(dir, 'fichiers'); mkdirSync(this.fichiers, { recursive: true, mode: 0o700 });
    this.bus.setMaxListeners(1000);
    this.elements = lire(join(dir, 'catalogue.json'), [] as Element[]);
    this.appareils = lire(join(dir, 'appareils.json'), [] as Appareil[]);
    this.ordres = lire(join(dir, 'ordres.json'), [] as Ordre[]);
    this.journal = lire(join(dir, 'journal.json'), [] as Ligne[]);
  }
  sauverCatalogue(): void { ecrire(join(this.dir, 'catalogue.json'), this.elements); }
  sauverAppareils(): void { ecrire(join(this.dir, 'appareils.json'), this.appareils); }
  sauverOrdres(): void {
    // On garde les ordres ouverts et les 500 derniers terminés.
    const ouverts = this.ordres.filter((o) => OUVERT.includes(o.etat)), finis = this.ordres.filter((o) => !OUVERT.includes(o.etat)).slice(-500);
    this.ordres = [...finis, ...ouverts].sort((a, b) => a.cree - b.cree); ecrire(join(this.dir, 'ordres.json'), this.ordres);
  }
  noter(t: number, qui: string, quoi: string, grave = false): void { this.journal = [...this.journal, { t, qui: qui.slice(0, 60), quoi: quoi.slice(0, 300), ...(grave ? { grave } : {}) }].slice(-1000); ecrire(join(this.dir, 'journal.json'), this.journal); }
  element(x: string): Element | undefined { const t = x.trim().toLowerCase(); return this.elements.find((e) => e.id === t) ?? this.elements.find((e) => e.nom.toLowerCase() === t); }
  appareil(id: string): Appareil | undefined { const t = id.trim().toLowerCase(); return this.appareils.find((a) => a.id === id) ?? this.appareils.find((a) => !a.retire && a.nom.toLowerCase() === t); }
  ouvert(appareil: string, element: string): Ordre | undefined { return this.ordres.find((o) => o.appareil === appareil && o.element === element && OUVERT.includes(o.etat)); }
}
const depots = new Map<string, Depot>();
export const depotDe = (dir: string): Depot => { let d = depots.get(dir); if (!d) { d = new Depot(dir); depots.set(dir, d); } return d; };
/** Oublie le dépôt d'un dossier (arrêt de l'appli : les essais repartent d'un dossier neuf). */
export const oublier = (dir: string) => { const d = depots.get(dir); if (d) { d.bus.emit('fin'); d.bus.removeAllListeners(); } depots.delete(dir); };

/** Le paquet d'un élément pour une plateforme (le plus récent ; sous Linux, l'AppImage d'abord : elle s'installe sans mot de passe d'administrateur). */
export function paquetPour(e: Element, pf: string): Paquet | undefined {
  const l = e.paquets.filter((p) => p.plateforme === pf);
  return l.sort((a, b) => (a.format === 'appimage' ? -1 : 0) - (b.format === 'appimage' ? -1 : 0) || compareVersions(b.version, a.version))[0];
}
/** Compare deux versions « 1.2.10 » et « 1.2.9 » (chiffres par morceaux, le reste en texte). */
export function compareVersions(a: string, b: string): number {
  const pa = String(a).replace(/^v/i, '').split(/[.+-]/), pb = String(b).replace(/^v/i, '').split(/[.+-]/);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? '0', y = pb[i] ?? '0', nx = Number(x), ny = Number(y);
    const c = Number.isFinite(nx) && Number.isFinite(ny) ? nx - ny : x.localeCompare(y);
    if (c) return c < 0 ? -1 : 1;
  }
  return 0;
}
