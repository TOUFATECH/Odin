// Genèse · clés USB, lot C5 « Mes clés » (maquette validée « Clés USB ») : gérer une clé ODIN déjà faite, SANS l'effacer.
//
//  - Les clés ODIN connues : un registre rangé par Odin (fichier cles-odin.json du dossier de Genèse, recopié dans la base
//    de l'appli GENESE_ODIN, schéma « cles ») ; pour chacune : son contenu (systèmes, logiciels), l'ordre du menu, l'entrée
//    par défaut, ses changements en attente et sa dernière relecture.
//  - Une clé est RECONNUE par son numéro de série ET par l'identifiant ODIN écrit sur elle (odin/cle-odin.json). Une autre
//    clé, même du même modèle, même copiée octet par octet (même identifiant, autre numéro), n'est jamais touchée. Une clé
//    dont le numéro de série est illisible est seulement montrée.
//  - Changer une clé : ajouter ou retirer un système, ranger le menu, choisir l'entrée par défaut. Rien n'est effacé :
//    Odin n'écrit que SES fichiers (les systèmes ajoutés, le réglage du menu) et ne retire que les fichiers des systèmes
//    retirés. Une clé pas branchée garde les changements pour plus tard ; « appliquer dès qu'elle est branchée » les
//    applique au prochain branchement de CETTE clé.
//  - Garde-fous : jamais un disque interne ni le disque du système (même règle que l'étape « Clé ») ; jamais une clé qui
//    n'est pas ODIN ; le numéro de série et l'identifiant revérifiés juste avant chaque écriture ; seulement les dossiers
//    d'Odin sur la clé, jamais un raccourci suivi ; la place vérifiée avant ; chaque fichier écrit à côté puis mis en place
//    d'un seul geste (une coupure en pleine écriture laisse la clé démarrable : l'ancien menu ou le nouveau, jamais un
//    menu qui cite un fichier absent) ; jamais une installation automatique comme entrée par défaut (même règle que le
//    menu PXE). Toutes les actions sont réservées au propriétaire.
//  - Les mises à jour sont PROPOSÉES (une ISO plus récente dans la bibliothèque, un menu à réécrire), jamais faites seules.
//  - « Relire la clé » relit chaque fichier d'Odin et le compare à son empreinte connue.
//
// Tout ce qui touche la clé passe par une IO injectable (IoGerer) : les essais lui donnent une version en mémoire ou un
// dossier temporaire qui joue la partition ODIN d'un faux disque ; aucun vrai disque n'est lu ni écrit pendant les essais.

import { createHash, randomBytes } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, renameSync, statfsSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve, sep } from 'node:path';
import type { Action, ModCtx } from '../types.ts';
import { BaseAttente, quandBase, type AppliBase, type DefAppli } from '../base/index.ts';
import { journalDe } from '../base/journal.ts';
import { choisissable, memeDisque, raisonNonChoisissable, serieLisible, sourceReelle, sourceSimulee, type Disque, type SourceDisques } from './disques.ts';
import { buildersParDefaut, CLES_OCCUPEES, cleUsb, MARQUE, nomAffiche, nomFichierSur, type IsoBiblio, type LigneJournalCle } from './cle-ecrire.ts';
import { buildMenuTexte } from './cle-grub.ts';
import { buildVentoyJson, classeIcone, reglagesDemarrage, TITRE_ENTREE_ODIN } from './cle-boot.ts';
import { DISPOSITION_CLE, type ModeDefaut, type PreparationCle, type SystemeCle } from './cle-types.ts';
import { DISPOSITIONS, textThemeOf, themeOf, type Disposition, type TextTheme, type Theme } from './ecran.ts';
import { installe } from './menu-pxe.ts';
import type { Kind, Recipe } from './recipes.ts';

// ------------------------------------------------------------------------------------------------ le contrat sur la clé
/** Le fichier d'identité posé par Odin sur la clé : son identifiant et la description de son menu. */
export const FICHIER_ID = 'odin/cle-odin.json';
/** Les seuls dossiers de la clé où Odin écrit (jamais ailleurs, jamais la racine). */
const RACINES = ['ISO', 'vdisk', 'persistence', 'ventoy', 'ecran-odin', 'odin', 'logiciels'];
/** La marge gardée libre sur la clé après un ajout. */
const MARGE = 512 * 1024 ** 2;
/** Les suffixes des fichiers écrits « à côté » avant d'être mis en place. */
const PART = '.odin-part', NEUF = '.odin-neuf';
const ID_CLE = /^[0-9a-f]{32}$/;
const KINDS: Kind[] = ['ubuntu', 'casper', 'debian', 'rhel', 'fedora-live', 'arch', 'alpine', 'debian-live', 'windows', 'iso'];

export type Famille = 'Windows' | 'Linux' | 'Outil';
/** Une entrée du menu de la clé (un fichier de /ISO). */
export interface EntreeCle {
  fichier: string; nom: string; famille: Famille;
  /** installer : fichier de réponses injecté ; essai / demarrer : rien n'est installé tout seul */
  mode: 'installer' | 'essai' | 'demarrer';
  kind: Kind; auto: boolean; os: 'windows' | 'linux' | 'outil';
  choix: 'iso' | 'installe' | 'persistance' | 'vm';
}
/** Ce qu'Odin écrit dans odin/cle-odin.json. */
export interface Manifeste {
  odin: 1; id: string; cree: number; maj: number;
  systemes: EntreeCle[]; defaut?: string;
  modeDefaut: ModeDefaut; delai: number; langue?: string;
  theme: Theme; texte: TextTheme; disposition: Disposition;
}
/** Un fichier vu sur la clé. */
export interface Fich { nom: string; taille: number }
/** Ce qu'Odin lit sur une clé (rien n'est écrit pour le lire). */
export interface ContenuCle {
  id?: string;
  /** vrai : la marque « écriture incomplète » est sur la clé (elle ne démarre peut-être pas : à refaire depuis Déployer) */
  incomplete: boolean;
  /** le menu, dans l'ordre (les fichiers présents dans /ISO) */
  systemes: Array<EntreeCle & { taille: number }>;
  defaut?: string;
  vdisk: Fich[]; persistance: Fich[]; logiciels: { windows: string[]; linux: string[] };
  occupation: { iso: number; installes: number; logiciels: number; memoire: number };
  reglages: { modeDefaut: ModeDefaut; delai: number; langue?: string; theme: Theme; texte: TextTheme; disposition: Disposition };
  /** les textes actuels du menu (pour le patcher sans perdre ce qu'Odin n'a pas écrit lui-même) */
  ventoyJson?: string; grubCfg?: string;
}

// ------------------------------------------------------------------------------------------------ l'IO de la clé
export interface EntreeDossier { nom: string; taille: number; genre: 'fichier' | 'dossier' | 'lien' | 'autre' }
/** Ce que « Mes clés » demande à la clé. Tous les chemins sont relatifs à la partition ODIN. */
export interface IoGerer {
  /** les entrées d'un dossier (vide s'il n'existe pas) ; un raccourci est rendu comme « lien », jamais suivi */
  lister(rel: string): Promise<EntreeDossier[]>;
  /** un petit fichier en texte (rien s'il est absent, trop gros, ou si c'est un raccourci) */
  lire(rel: string, max: number): Promise<string | undefined>;
  existe(rel: string): Promise<boolean>;
  /** écrit à côté (« .odin-neuf ») puis met en place d'un seul geste ; rend l'empreinte */
  ecrireAtomique(rel: string, contenu: string): Promise<string>;
  /** copie à côté (« .odin-part ») puis met en place d'un seul geste ; rend l'empreinte */
  /** `avantMiseEnPlace` : appelé une fois la copie finie, juste avant de la mettre en place (la clé y est revérifiée :
   *  une copie dure des minutes) ; s'il lève une erreur, rien n'est mis en place */
  copierAtomique(source: string, rel: string, onProgress?: (recu: number, total: number) => void, avantMiseEnPlace?: () => Promise<void>): Promise<string>;
  /** retire UN fichier (jamais un dossier ni un raccourci) */
  retirer(rel: string): Promise<void>;
  /** l'empreinte d'un fichier ('' s'il est absent) ; `onOctets` compte ce qui est lu (débit) */
  empreinte(rel: string, onOctets?: (n: number) => void): Promise<string>;
  /** la place libre (octets), si l'IO la connaît */
  libre?(): Promise<number | undefined>;
}

const RESERVES = /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³]|conin\$|conout\$)(\.|$)/i;
// eslint-disable-next-line no-control-regex
const morceauSur = (m: string) => !RESERVES.test(m) && !/[<>:"|?*\u0000-\u001f]/.test(m) && !/[. ]$/.test(m);
/** Un chemin relatif sûr, dans un des dossiers d'Odin. Pur. */
export function relSur(rel: unknown): string | undefined {
  const r = String(rel ?? '').replace(/\\/g, '/');
  const m = r.split('/');
  if (!r || isAbsolute(r) || /^[a-z]:/i.test(r) || m.some((x) => x === '..' || x === '.' || x === '' || !morceauSur(x))) return undefined;
  if (!RACINES.includes(m[0])) return undefined;
  return r;
}
const sha = (d: string | Buffer) => createHash('sha256').update(d).digest('hex');

/**
 * L'IO en mémoire pour les essais : `fichiers` joue la partition ODIN. `couper(op, rel)` simule une coupure de courant
 * (l'opération lève une erreur AVANT d'agir). Les écritures « à côté » restent visibles comme le ferait un vrai disque.
 */
export function ioGererSimulee(initial: Record<string, string> = {}, o: { libre?: number; sources?: Record<string, string>; couper?: (op: string, rel: string) => boolean; liens?: string[] } = {}): IoGerer & { fichiers: Map<string, string>; ops: string[] } {
  const fichiers = new Map(Object.entries(initial));
  const liens = new Set(o.liens ?? []);
  const ops: string[] = [];
  const coupe = (op: string, rel: string) => { ops.push(`${op} ${rel}`); if (o.couper?.(op, rel)) throw new Error('coupure de courant (essai)'); };
  const sur = (rel: string) => { const r = relSur(rel); if (!r) throw new Error(`chemin refusé sur la clé : ${String(rel).slice(0, 120)}`); const m = r.split('/'); for (let i = 1; i <= m.length; i++) if (liens.has(m.slice(0, i).join('/'))) throw new Error(`chemin refusé sur la clé : ${r} (un lien mène ailleurs)`); return r; };
  return {
    fichiers, ops,
    async lister(rel) {
      const p = `${rel.replace(/\/$/, '')}/`, vus = new Map<string, EntreeDossier>();
      for (const l of liens) if (l.startsWith(p) && !l.slice(p.length).includes('/')) vus.set(l.slice(p.length), { nom: l.slice(p.length), taille: 0, genre: 'lien' });
      for (const [k, v] of fichiers) {
        if (!k.startsWith(p)) continue;
        const reste = k.slice(p.length), i = reste.indexOf('/');
        if (i < 0) { if (!vus.has(reste)) vus.set(reste, { nom: reste, taille: Buffer.byteLength(v), genre: 'fichier' }); } else if (!vus.has(reste.slice(0, i))) vus.set(reste.slice(0, i), { nom: reste.slice(0, i), taille: 0, genre: 'dossier' });
      }
      return [...vus.values()].sort((a, b) => a.nom.localeCompare(b.nom));
    },
    async lire(rel, max) { try { const r = sur(rel); const v = fichiers.get(r); return v !== undefined && Buffer.byteLength(v) <= max ? v : undefined; } catch { return undefined; } },
    async existe(rel) { try { return fichiers.has(sur(rel)); } catch { return false; } },
    async ecrireAtomique(rel, contenu) { const r = sur(rel); coupe('ecrire-a-cote', r); fichiers.set(r + NEUF, contenu); coupe('mettre-en-place', r); fichiers.delete(r + NEUF); fichiers.set(r, contenu); return sha(contenu); },
    async copierAtomique(source, rel, _onProgress, avantMiseEnPlace) { const r = sur(rel); const c = o.sources?.[source] ?? `copie:${source}`; coupe('copier-a-cote', r); fichiers.set(r + PART, c); await avantMiseEnPlace?.(); coupe('mettre-en-place', r); fichiers.delete(r + PART); fichiers.set(r, c); return sha(c); },
    async retirer(rel) { const r = sur(rel); coupe('retirer', r); fichiers.delete(r); },
    async empreinte(rel, onOctets) { try { const r = sur(rel); const v = fichiers.get(r); if (v === undefined) return ''; onOctets?.(Buffer.byteLength(v)); return sha(v); } catch { return ''; } },
    async libre() { return o.libre; },
  };
}

/**
 * L'IO sur un DOSSIER : la partition ODIN montée d'une clé déjà ODIN, ou, pour les essais, un dossier temporaire qui joue
 * cette partition sur un faux disque. Seulement des fichiers sous `racine`, dans les dossiers d'Odin, jamais à travers un
 * raccourci (jonction ou lien symbolique posé sur la clé : refusé), jamais un formatage ni une commande du système.
 */
export function ioGererDossier(racine: string): IoGerer & { racine: string } {
  const base = resolve(racine);
  const dedans = base.endsWith(sep) ? base : base + sep;
  /** Le chemin absolu d'un chemin relatif sûr ; chaque morceau existant est lu SANS le suivre (aucun lien). */
  const ici = (rel: string): string => {
    const r = relSur(rel);
    if (!r) throw new Error(`chemin refusé sur la clé : ${String(rel).slice(0, 120)}`);
    const p = resolve(base, r);
    if (!p.startsWith(dedans)) throw new Error(`chemin refusé sur la clé : ${r}`);
    let q = base;
    for (const m of r.split('/')) {
      q = join(q, m);
      let l; try { l = lstatSync(q); } catch { break; }
      if (l.isSymbolicLink()) throw new Error(`chemin refusé sur la clé : ${r} (un lien mène ailleurs)`);
    }
    return p;
  };
  /** Le fichier « à côté » : un ancien reste (même un lien posé là) est retiré sans être suivi, puis créé neuf (wx). */
  const aCote = (p: string, suffixe: string) => {
    const t = p + suffixe;
    try { const l = lstatSync(t); if (l.isDirectory()) throw new Error('un dossier occupe la place du fichier provisoire'); unlinkSync(t); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
    return t;
  };
  return {
    racine: base,
    async lister(rel) {
      let p: string; try { p = ici(rel); } catch { return []; }
      let l; try { l = lstatSync(p); } catch { return []; }
      if (!l.isDirectory()) return [];
      return readdirSync(p, { withFileTypes: true }).map((e) => {
        let taille = 0; try { taille = e.isFile() ? lstatSync(join(p, e.name)).size : 0; } catch { /* disparu */ }
        return { nom: e.name, taille, genre: e.isSymbolicLink() ? 'lien' as const : e.isFile() ? 'fichier' as const : e.isDirectory() ? 'dossier' as const : 'autre' as const };
      }).sort((a, b) => a.nom.localeCompare(b.nom));
    },
    async lire(rel, max) { try { const p = ici(rel); const l = lstatSync(p); if (!l.isFile() || l.size > max) return undefined; return readFileSync(p, 'utf8'); } catch { return undefined; } },
    async existe(rel) { try { const p = ici(rel); return lstatSync(p).isFile(); } catch { return false; } },
    async ecrireAtomique(rel, contenu) {
      const p = ici(rel); mkdirSync(dirname(p), { recursive: true }); ici(rel);
      const t = aCote(p, NEUF);
      writeFileSync(t, contenu, { flag: 'wx' });
      ici(rel); renameSync(t, p);
      return sha(contenu);
    },
    copierAtomique(source, rel, onProgress, avantMiseEnPlace) {
      return new Promise((ok, ko) => {
        let p: string, t: string;
        try {
          if (!isAbsolute(source) || !existsSync(source) || !statSync(source).isFile()) throw new Error('fichier source introuvable');
          p = ici(rel); mkdirSync(dirname(p), { recursive: true }); ici(rel); t = aCote(p, PART);
        } catch (e) { ko(e as Error); return; }
        const total = statSync(source).size, h = createHash('sha256'); let recu = 0;
        const r = createReadStream(source), w = createWriteStream(t, { flags: 'wx' });
        r.on('data', (b) => { h.update(b); recu += b.length; onProgress?.(recu, total); });
        r.on('error', (e) => { w.destroy(); ko(e); }); w.on('error', (e) => { r.destroy(); ko(e); });
        w.on('finish', () => { void (async () => { try { await avantMiseEnPlace?.(); ici(rel); renameSync(t, p); ok(h.digest('hex')); } catch (e) { ko(e as Error); } })(); });
        r.pipe(w);
      });
    },
    async retirer(rel) {
      const p = ici(rel);
      let l; try { l = lstatSync(p); } catch { return; }
      if (!l.isFile()) throw new Error(`« ${rel} » n'est pas un simple fichier : Odin ne le retire pas`);
      unlinkSync(p);
    },
    empreinte(rel, onOctets) {
      return new Promise((ok) => {
        let p: string; try { p = ici(rel); if (!lstatSync(p).isFile()) { ok(''); return; } } catch { ok(''); return; }
        const h = createHash('sha256'); const r = createReadStream(p);
        r.on('data', (b) => { h.update(b); onOctets?.(b.length); }); r.on('end', () => ok(h.digest('hex'))); r.on('error', () => ok(''));
      });
    },
    async libre() { try { const s = statfsSync(base); return Number(s.bavail) * Number(s.bsize); } catch { return undefined; } },
  };
}

// ------------------------------------------------------------------------------------------------ lire une clé (pur + IO)
const ISO_EXT = /\.(iso|img|wim|vhd|vhdx|efi|raw|vtoy)$/i;
const o = (x: unknown): Record<string, unknown> => (x && typeof x === 'object' && !Array.isArray(x) ? x as Record<string, unknown> : {});
const st = (x: unknown) => (typeof x === 'string' ? x : '');
/** La famille d'un système, d'après son nom et sa recette. Pur. */
export function familleDe(nom: string, kind: string, os?: string): Famille {
  if (kind === 'windows' || os === 'windows' || /windows|win1[01]|\.wim$/i.test(nom)) return 'Windows';
  if (os === 'outil' || /gparted|clonezilla|memtest|hiren|rescue|shredos|ventoy|tails|boot-?repair/i.test(nom)) return 'Outil';
  return 'Linux';
}
/** Une entrée lue sur la clé (donc pas sûre) rendue propre, ou rien. Pur. */
export function entreePropre(x: unknown): EntreeCle | undefined {
  const e = o(x);
  const fichier = st(e.fichier);
  if (!nomFichierSur(fichier) || !ISO_EXT.test(fichier)) return undefined;
  const kind = (KINDS as string[]).includes(st(e.kind)) ? st(e.kind) as Kind : 'iso';
  const os = e.os === 'windows' ? 'windows' : e.os === 'outil' ? 'outil' : kind === 'windows' ? 'windows' : 'linux';
  const nom = nomAffiche(e.nom) || fichier.replace(/\.[^.]+$/, '');
  const famille = (['Windows', 'Linux', 'Outil'] as string[]).includes(st(e.famille)) ? e.famille as Famille : familleDe(nom, kind, os);
  return {
    fichier, nom, famille, kind, os, auto: e.auto === true,
    mode: e.mode === 'installer' ? 'installer' : e.mode === 'essai' ? 'essai' : 'demarrer',
    choix: e.choix === 'installe' || e.choix === 'persistance' || e.choix === 'vm' ? e.choix : 'iso',
  };
}
/** La recette (même forme que la bibliothèque) d'une entrée. Pur. */
const recetteDe = (e: Pick<EntreeCle, 'kind' | 'auto' | 'os' | 'nom'>): Recipe => ({ kind: e.kind, label: e.nom, auto: e.auto, os: e.os });
/**
 * Cette entrée peut-elle démarrer TOUTE SEULE au bout du délai ? Un système installé sur la clé (il démarre, n'installe
 * rien), un système « live » ou un outil reconnu : oui. Tout ce qui installe (fichier de réponses) ou peut effacer, et
 * toute image inconnue : non — même règle que le menu PXE (lot S9). Pur.
 */
export function defautPermis(e: Pick<EntreeCle, 'mode' | 'choix' | 'kind' | 'auto' | 'os' | 'nom'> | undefined): boolean {
  if (!e || e.mode === 'installer') return false;
  if (e.choix === 'installe' || e.choix === 'vm') return true;
  return !installe(recetteDe(e));
}
/** Pourquoi cette entrée ne peut pas être celle par défaut (rien : elle le peut). Pur. */
export const raisonPasDefaut = (e: Pick<EntreeCle, 'mode' | 'choix' | 'kind' | 'auto' | 'os' | 'nom'> | undefined): string | undefined =>
  (!e ? 'ce système n\'est plus sur la clé' : defautPermis(e) ? undefined : `${e.nom} installe un système (ou peut effacer un disque) : il ne démarre jamais tout seul`);

/** Le modèle de fichier de réponses → la famille d'installation (clé écrite avant le lot C5, sans fichier d'identité). */
const KIND_DE_GABARIT: Array<[RegExp, Kind, 'windows' | 'linux']> = [[/autounattend/i, 'windows', 'windows'], [/user-data/i, 'ubuntu', 'linux'], [/preseed/i, 'debian', 'linux'], [/kickstart|ks\.cfg/i, 'rhel', 'linux']];
const isoDe = (img: unknown) => { const m = /^\/?ISO\/([^/]+)$/i.exec(st(img).replace(/\\/g, '/')); return m ? m[1] : ''; };
/** Ventoy lit aussi chaque greffon sous un nom « par démarrage » (control_uefi, auto_install_legacy…), qui PASSE DEVANT le
 *  nom simple : Odin les regarde tous, sinon un réglage caché là ferait démarrer seule une installation. */
const VARIANTES = ['', '_legacy', '_uefi', '_ia32', '_aa64', '_mips'];
const tableaux = (doc: Record<string, unknown>, cle: string): unknown[] => VARIANTES.flatMap((v) => (Array.isArray(doc[cle + v]) ? doc[cle + v] as unknown[] : []));
/** Le ventoy.json lu sur la clé, en objet (la marque d'ordre des octets en tête est tolérée) ; rien s'il est illisible. Pur. */
export function docVentoy(texte: string | undefined): Record<string, unknown> | undefined {
  try { const j = JSON.parse((texte ?? '').replace(/^﻿/, '')); return j && typeof j === 'object' && !Array.isArray(j) ? j as Record<string, unknown> : undefined; } catch { return undefined; }
}
/** Ce fichier de /ISO est-il visé par ce chemin d'image de ventoy.json ? (sans tenir compte des majuscules, « * » permis). Pur. */
function viseImage(img: unknown, fichier: string): boolean {
  const f = isoDe(img);
  if (!f) return false;
  if (!f.includes('*')) return f.toLowerCase() === fichier.toLowerCase();
  return new RegExp(`^${f.split('*').map((x) => x.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`, 'i').test(fichier);
}
/**
 * La famille d'installation automatique que ventoy.json donne à ce fichier de /ISO, ou rien. Une règle par DOSSIER
 * (« parent ») ou sans image lisible vaut pour toutes les images : dans le doute, c'est une installation. Pur.
 */
export function installeurDe(doc: Record<string, unknown>, fichier: string): Kind | undefined {
  for (const a of tableaux(doc, 'auto_install')) {
    const x = o(a);
    const large = !st(x.image) || (typeof x.parent === 'string' && x.parent !== '');
    if (!large && !viseImage(x.image, fichier)) continue;
    const g = KIND_DE_GABARIT.find(([re]) => re.test(typeof x.template === 'string' ? x.template : JSON.stringify(x.template ?? '')));
    return g ? g[1] : 'iso';
  }
  return undefined;
}

/** Le fichier d'identité (odin/cle-odin.json) lu et rendu propre, ou rien. Pur. */
export function manifesteDe(texte: string | undefined): Manifeste | undefined {
  if (!texte) return undefined;
  let j: Record<string, unknown>; try { j = o(JSON.parse(texte)); } catch { return undefined; }
  if (j.odin !== 1 || !ID_CLE.test(st(j.id))) return undefined;
  const systemes: EntreeCle[] = [];
  for (const x of (Array.isArray(j.systemes) ? j.systemes : []).slice(0, 100)) { const e = entreePropre(x); if (e && !systemes.some((s) => s.fichier === e.fichier)) systemes.push(e); }
  const r = reglagesDemarrage(j);
  const def = st(j.defaut);
  return {
    odin: 1, id: st(j.id), cree: Number(j.cree) || 0, maj: Number(j.maj) || 0, systemes,
    ...(def && systemes.some((s) => s.fichier === def) ? { defaut: def } : {}),
    modeDefaut: r.modeDefaut, delai: r.delai, ...(r.langue ? { langue: r.langue } : {}),
    theme: themeOf(j.theme), texte: textThemeOf(j.texte), disposition: (DISPOSITIONS as readonly string[]).includes(st(j.disposition)) ? j.disposition as Disposition : 'eventail',
  };
}

/**
 * Lit une clé ODIN : son identifiant, son menu (dans l'ordre), ses logiciels et sa place. Rien n'est écrit. Une clé écrite
 * avant ce lot (sans fichier d'identité) est décrite d'après son ventoy.json et le dossier /ISO. `biblio` : la bibliothèque
 * d'Odin, pour reconnaître la recette d'une ISO déposée.
 */
export async function lireCle(io: IoGerer, biblio: IsoBiblio[] = []): Promise<ContenuCle> {
  const [id, vj, grub, isos, vdisk, pers, lw, ll, marque] = await Promise.all([
    io.lire(FICHIER_ID, 256 * 1024), io.lire('ventoy/ventoy.json', 2 * 1024 * 1024), io.lire('ventoy/ventoy_grub.cfg', 2 * 1024 * 1024),
    io.lister('ISO'), io.lister('vdisk'), io.lister('persistence'), io.lister('logiciels/windows'), io.lister('logiciels/linux'), io.existe(MARQUE),
  ]);
  const man = manifesteDe(id);
  const doc: Record<string, unknown> = docVentoy(vj) ?? {}; // illisible : décrit d'après /ISO
  const fichiers = isos.filter((f) => f.genre === 'fichier' && nomFichierSur(f.nom) && ISO_EXT.test(f.nom));
  const taille = new Map(fichiers.map((f) => [f.nom, f.taille]));
  // Ce que dit ventoy.json (noms lisibles, installations automatiques, persistance), pour une clé sans identité.
  const alias = new Map<string, string>(), avecPers = new Set<string>();
  for (const a of Array.isArray(doc.menu_alias) ? doc.menu_alias : []) { const f = isoDe(o(a).image); if (f) alias.set(f, nomAffiche(o(a).alias)); }
  for (const a of tableaux(doc, 'persistence')) { const f = isoDe(o(a).image); if (f) avecPers.add(f); }
  const entrees: EntreeCle[] = [];
  const deManifeste = new Map((man?.systemes ?? []).map((e) => [e.fichier, e]));
  const ordre = [...(man?.systemes ?? []).map((e) => e.fichier), ...[...alias.keys()], ...fichiers.map((f) => f.nom)];
  for (const f of ordre) {
    if (!taille.has(f) || entrees.some((e) => e.fichier === f)) continue;
    const m = deManifeste.get(f);
    const k = installeurDe(doc, f);
    // Le fichier d'identité décrit le menu, mais c'est ventoy.json qui démarre : s'il injecte un fichier de réponses pour
    // cette image (clé refaite depuis « Déployer », réglage changé à la main, clé préparée ailleurs), elle INSTALLE.
    if (m) { entrees.push(k ? { ...m, mode: 'installer', auto: true } : m); continue; }
    const b = biblio.find((x) => `${x.nom}.iso`.replace(/[^\w.+-]/g, '_') === f);
    const kind: Kind = k ?? b?.recipe?.kind ?? 'iso';
    const os = kind === 'windows' || b?.recipe?.os === 'windows' ? 'windows' : b?.recipe?.os === 'outil' ? 'outil' : 'linux';
    const nom = alias.get(f) || nomAffiche(b?.nom) || f.replace(/\.[^.]+$/, '');
    entrees.push({ fichier: f, nom, famille: familleDe(nom, kind, os), kind, os, auto: k ? true : Boolean(b?.recipe?.auto), mode: k ? 'installer' : 'demarrer', choix: avecPers.has(f) ? 'persistance' : 'iso' });
  }
  const r = reglagesDemarrage({ modeDefaut: man?.modeDefaut ?? (o(doc.theme).display_mode === 'CLI' ? 'texte' : 'graphique'), delai: man?.delai ?? delaiDe(doc), langue: man?.langue });
  const defaut = man?.defaut ?? defautDe(doc);
  const propres = (l: EntreeDossier[]) => l.filter((f) => f.genre === 'fichier' && !f.nom.endsWith(PART) && !f.nom.endsWith(NEUF)).map((f) => ({ nom: f.nom, taille: f.taille }));
  const vd = propres(vdisk), pe = propres(pers);
  const logW = propres(lw), logL = propres(ll);
  const somme = (l: Fich[]) => l.reduce((n, f) => n + f.taille, 0);
  return {
    ...(man ? { id: man.id } : {}),
    incomplete: marque,
    systemes: entrees.map((e) => ({ ...e, taille: taille.get(e.fichier) ?? 0 })),
    ...(defaut && entrees.some((e) => e.fichier === defaut) ? { defaut } : {}),
    vdisk: vd, persistance: pe, logiciels: { windows: logW.map((f) => f.nom), linux: logL.map((f) => f.nom) },
    occupation: { iso: somme(fichiers), installes: somme(vd), logiciels: somme(logW) + somme(logL), memoire: somme(pe) },
    reglages: { modeDefaut: r.modeDefaut, delai: r.delai, ...(r.langue ? { langue: r.langue } : {}), theme: man?.theme ?? 'bleu', texte: man?.texte ?? 'matrix', disposition: man?.disposition ?? 'eventail' },
    ...(vj !== undefined ? { ventoyJson: vj } : {}), ...(grub !== undefined ? { grubCfg: grub } : {}),
  };
}
const controle = (doc: Record<string, unknown>, cle: string) => (Array.isArray(doc.control) ? doc.control : []).map(o).find((c) => cle in c)?.[cle];
const delaiDe = (doc: Record<string, unknown>) => { const t = controle(doc, 'VTOY_MENU_TIMEOUT'); return t === undefined ? 10 : Number(t); };
const defautDe = (doc: Record<string, unknown>) => isoDe(controle(doc, 'VTOY_DEFAULT_IMAGE'));

// ------------------------------------------------------------------------------------------------ les changements en attente
/** Un changement à faire sur une clé (gardé par Odin tant qu'il n'est pas appliqué). */
export interface Attente {
  /** l'ordre voulu du menu (les fichiers, ceux à ajouter compris) */
  ordre?: string[];
  /** l'entrée par défaut voulue ('' : aucune, le menu attend qu'on choisisse) */
  defaut?: string;
  retirer: string[];
  /** famille et defautPermis : pour la page (la ★ éteinte pour une image qui installe) */
  ajouter: Array<{ iso: string; fichier: string; nom: string; taille: number; famille?: Famille; defautPermis?: boolean }>;
  remplacer: Array<{ ancien: string; iso: string; fichier: string; nom: string; taille: number; famille?: Famille; defautPermis?: boolean }>;
  /** réécrire le réglage du menu même sans autre changement (proposé par « Mises à jour ») */
  menu?: boolean;
  /** vrai : appliquer tout seul au prochain branchement de CETTE clé (choisi par le propriétaire) */
  arme: boolean;
  /** quand le propriétaire a donné cet accord (posé par le SERVEUR, jamais repris de la page) : il vaut pour CES
   *  changements-là (le moindre changement le retire) et pendant VALIDITE_ARME seulement */
  armeLe?: number;
  /** les retraits (fichiers) pour lesquels le propriétaire a donné l'accord d'Odin en même temps que « au prochain
   *  branchement » (posé par le SERVEUR, jamais repris de la page) : un retrait qui n'y est pas ne part jamais tout seul */
  accordRetraits?: string[];
  /** les images déjà copiées par Odin pour CETTE attente (fichier → empreinte), quand une application a été coupée :
   *  à la reprise, elles ne sont pas « déjà sur la clé », elles sont vérifiées et reprises */
  copies?: Record<string, string>;
  depuis: number;
}
/**
 * Les systèmes d'une clé SANS les images qu'Odin a déjà copiées pour l'attente en cours (application coupée) : pour
 * l'attente, ce sont toujours des ajouts à finir, pas des systèmes déjà là. Pur.
 */
export function sansReprises<T extends { systemes: Array<{ fichier: string }> }>(c: T, a: Attente | undefined): T {
  const faites = a?.copies ?? {};
  const reprise = new Set([...(a?.ajouter ?? []), ...(a?.remplacer ?? [])].map((x) => x.fichier).filter((f) => Object.hasOwn(faites, f)));
  return reprise.size ? { ...c, systemes: c.systemes.filter((x) => !reprise.has(x.fichier)) } : c;
}
/** Combien de temps vaut « appliquer dès qu'elle est branchée » (24 heures, décision du propriétaire) : passé ce délai, Odin
 *  redemande (rien ne part par surprise). */
export const VALIDITE_ARME = 24 * 3600 * 1000;
/** Cette durée, dite en clair (« 24 heures »). */
export const DUREE_ARME = `${Math.round(VALIDITE_ARME / 3_600_000)} heures`;
/** Les fichiers des systèmes qui QUITTENT la clé avec ces changements : ceux retirés, et l'ancienne version de ceux
 *  remplacés (son fichier est effacé aussi). Pur. */
export const retraitsDe = (a: Pick<Attente, 'retirer' | 'remplacer'> | undefined): string[] =>
  (a ? [...new Set([...a.retirer, ...a.remplacer.map((r) => r.ancien)])] : []);
/** La liste de fichiers d'un accord (un tableau, ou son texte JSON depuis un formulaire) ; tout le reste : vide. Pur. */
export function listeAccord(x: unknown): string[] {
  let l: unknown = x;
  if (typeof x === 'string' && x.trim().startsWith('[')) { try { l = JSON.parse(x); } catch { l = []; } }
  return Array.isArray(l) ? [...new Set(l.filter((f): f is string => typeof f === 'string' && f.length > 0 && f.length <= 300))].slice(0, 200) : [];
}
/** L'accord donné (une liste de fichiers) couvre-t-il CHAQUE retrait de ces changements ? Sans retrait : oui. Pur. */
export function retraitsCouverts(a: Pick<Attente, 'retirer' | 'remplacer'> | undefined, accord: unknown): boolean {
  const l = listeAccord(accord);
  return retraitsDe(a).every((f) => l.includes(f));
}
/** Les noms des systèmes qui partent, avec « et sa mémoire » quand elle part avec lui. Pur. */
export function nomsRetraits(a: Pick<Attente, 'retirer' | 'remplacer'> | undefined, systemes: Array<Pick<EntreeCle, 'fichier' | 'nom' | 'choix'>> = []): string[] {
  return retraitsDe(a).map((f) => {
    const e = systemes.find((x) => x.fichier === f);
    const nom = nomAffiche(e?.nom) || nomAffiche(f) || 'un système';
    return e?.choix === 'persistance' ? `${nom} (avec sa mémoire : ce qui y est enregistré est effacé aussi)` : nom;
  });
}
/**
 * Ce qu'Odin demande de confirmer avant un retrait (l'accord habituel des gestes graves) : la clé, chaque système retiré,
 * la mémoire qui part avec lui. Rien à retirer : rien à demander. Pur.
 */
export function phraseRetraits(nomCle: string, a: Pick<Attente, 'retirer' | 'remplacer'> | undefined, systemes: Array<Pick<EntreeCle, 'fichier' | 'nom' | 'choix'>> = [], auBranchement = false): string | undefined {
  const noms = nomsRetraits(a, systemes);
  if (!noms.length) return undefined;
  return `${auBranchement ? 'dès que la clé sera branchée, ' : ''}retirer de la clé « ${nomAffiche(nomCle) || 'ODIN'} » : ${noms.join(', ')} (seuls leurs fichiers sont effacés, le reste de la clé ne change pas)`;
}
/** L'accord « au prochain branchement » vaut-il encore ? Il ne vaut jamais pour un retrait qui n'a pas eu son accord. Pur. */
export const armeValide = (a: Attente | undefined, maintenant: number): boolean =>
  Boolean(a && a.arme && typeof a.armeLe === 'number' && a.armeLe > 0 && maintenant >= a.armeLe - 60_000 && maintenant - a.armeLe <= VALIDITE_ARME && retraitsCouverts(a, a.accordRetraits));
/** Le nombre de changements d'une attente (ce que montre le bandeau). Pur. */
export function nbChangements(a: Attente | undefined, actuel?: Pick<ContenuCle, 'systemes' | 'defaut'>): number {
  if (!a) return 0;
  // L'ordre compte s'il diffère de l'ordre « naturel » : ceux d'avant à leur place, les ajoutés à la fin.
  const naturel = actuel ? [...actuel.systemes.map((s) => s.fichier).filter((f) => !a.retirer.includes(f)).map((f) => a.remplacer.find((r) => r.ancien === f)?.fichier ?? f), ...a.ajouter.map((x) => x.fichier)] : [];
  const ordreChange = a.ordre && actuel ? a.ordre.join('/') !== naturel.join('/') : Boolean(a.ordre);
  const defChange = a.defaut !== undefined && a.defaut !== (actuel?.defaut ?? '');
  return a.retirer.length + a.ajouter.length + a.remplacer.length + (ordreChange ? 1 : 0) + (defChange ? 1 : 0) + (a.menu ? 1 : 0);
}
/** Le nom de fichier d'une image de la bibliothèque sur la clé (le même que l'écriture, lot C4). Pur. */
export const fichierDeBiblio = (i: Pick<IsoBiblio, 'nom'>) => `${i.nom}.iso`.replace(/[^\w.+-]/g, '_');

/**
 * Une demande de changement (venue de la page : pas sûre) rendue propre, d'après ce qui est sur la clé et la bibliothèque
 * d'Odin. Rend l'attente, ou la raison d'un refus. Pur (à part `taille`, qui lit la taille d'un fichier de la bibliothèque).
 */
export function attenteDe(brut: unknown, c: Pick<ContenuCle, 'systemes' | 'defaut'>, biblio: IsoBiblio[], taille: (chemin: string) => number = (p) => { try { return statSync(p).size; } catch { return 0; } }, maintenant = Date.now()): { attente?: Attente; refus?: string } {
  const b = o(brut);
  const sur = new Set(c.systemes.map((s) => s.fichier));
  const retirer = [...new Set((Array.isArray(b.retirer) ? b.retirer : []).map(st).filter((f) => sur.has(f)))];
  const ajouter: Attente['ajouter'] = [];
  for (const x of (Array.isArray(b.ajouter) ? b.ajouter : []).slice(0, 20)) {
    const id = st(o(x).iso).replace(/^iso:/, '');
    const i = biblio.find((y) => y.id === id);
    if (!i || !i.recipe) return { refus: `« ${nomAffiche(o(x).nom) || id.slice(0, 60)} » n'est pas une image prête de la bibliothèque d'Odin.` };
    const fichier = fichierDeBiblio(i);
    if (!nomFichierSur(fichier)) return { refus: `« ${nomAffiche(i.nom)} » n'a pas un nom de fichier sûr.` };
    if (sur.has(fichier)) return { refus: `« ${nomAffiche(i.nom)} » est déjà sur cette clé.` };
    if (ajouter.some((a) => a.fichier === fichier)) continue;
    ajouter.push({ iso: i.id, fichier, nom: nomAffiche(i.nom) || fichier, taille: taille(i.chemin) });
  }
  const remplacer: Attente['remplacer'] = [];
  for (const x of (Array.isArray(b.remplacer) ? b.remplacer : []).slice(0, 20)) {
    const ancien = st(o(x).ancien), id = st(o(x).iso).replace(/^iso:/, '');
    const i = biblio.find((y) => y.id === id);
    if (!sur.has(ancien)) return { refus: 'Le système à remplacer n\'est plus sur cette clé.' };
    if (retirer.includes(ancien)) continue;
    if (!i || !i.recipe) return { refus: 'La nouvelle version n\'est pas une image prête de la bibliothèque d\'Odin.' };
    const fichier = fichierDeBiblio(i);
    if (!nomFichierSur(fichier) || fichier === ancien || sur.has(fichier) || ajouter.some((a) => a.fichier === fichier)) return { refus: `« ${nomAffiche(i.nom)} » est déjà sur cette clé, ou porte le même nom que l'ancien.` };
    if (remplacer.some((r) => r.ancien === ancien || r.fichier === fichier)) continue;
    remplacer.push({ ancien, iso: i.id, fichier, nom: nomAffiche(i.nom) || fichier, taille: taille(i.chemin) });
  }
  for (const x of [...ajouter, ...remplacer]) { const e = entreeAjoutee(x.fichier, ajouter, remplacer, biblio); if (e) { x.famille = e.famille; x.defautPermis = defautPermis(e); } }
  // L'ordre : seulement des fichiers qui seront sur la clé ; ceux qui manquent gardent leur place relative, à la fin.
  const finals = [...c.systemes.map((s) => s.fichier).filter((f) => !retirer.includes(f)).map((f) => remplacer.find((r) => r.ancien === f)?.fichier ?? f), ...ajouter.map((a) => a.fichier)];
  let ordre: string[] | undefined;
  if (Array.isArray(b.ordre)) {
    const voulu = [...new Set(b.ordre.map(st).map((f) => remplacer.find((r) => r.ancien === f)?.fichier ?? f).filter((f) => finals.includes(f)))];
    ordre = [...voulu, ...finals.filter((f) => !voulu.includes(f))];
  }
  // L'entrée par défaut : seulement une entrée qui n'installe rien (sinon refus, avec la raison).
  let defaut: string | undefined;
  if (b.defaut !== undefined && b.defaut !== null) {
    const d = st(b.defaut);
    if (d) {
      if (!finals.includes(d)) return { refus: 'L\'entrée par défaut n\'est pas dans le menu de cette clé.' };
      const ent = c.systemes.find((s) => s.fichier === d) ?? entreeAjoutee(d, ajouter, remplacer, biblio);
      const r = raisonPasDefaut(ent);
      if (r) return { refus: `Pas par défaut : ${r}.` };
    }
    defaut = d;
  }
  // L'accord « au prochain branchement » et les copies déjà faites ne sont repris que d'une attente gardée par Odin
  // (cle_changer les retire de ce qui vient de la page et les repose lui-même).
  const copies: Record<string, string> = {};
  for (const x of [...ajouter, ...remplacer]) { const h = o(b.copies)[x.fichier]; if (Object.hasOwn(o(b.copies), x.fichier) && typeof h === 'string' && /^[0-9a-f]{64}$/.test(h)) copies[x.fichier] = h; }
  const armeLe = Number(b.armeLe);
  const accordes = b.arme === true ? listeAccord(b.accordRetraits).filter((f) => retirer.includes(f) || remplacer.some((r) => r.ancien === f)) : [];
  const attente: Attente = { retirer, ajouter, remplacer, ...(ordre ? { ordre } : {}), ...(defaut !== undefined ? { defaut } : {}), ...(b.menu === true ? { menu: true } : {}), arme: b.arme === true, ...(b.arme === true && armeLe > 0 ? { armeLe } : {}), ...(accordes.length ? { accordRetraits: accordes } : {}), ...(Object.keys(copies).length ? { copies } : {}), depuis: Number(b.depuis) > 0 ? Number(b.depuis) : maintenant };
  return { attente };
}
/** L'entrée de menu d'une image ajoutée : TOUJOURS « démarrer » (rien ne s'installe tout seul ; pour une installation
 *  automatique, l'étape « Déployer » refait les scripts). Pur. */
function entreeAjoutee(fichier: string, ajouter: Attente['ajouter'], remplacer: Attente['remplacer'], biblio: IsoBiblio[]): EntreeCle | undefined {
  const a = ajouter.find((x) => x.fichier === fichier) ?? remplacer.find((x) => x.fichier === fichier);
  if (!a) return undefined;
  const r = biblio.find((x) => x.id === a.iso)?.recipe;
  const kind: Kind = r?.kind ?? 'iso';
  const os = r?.os ?? 'linux';
  return { fichier, nom: a.nom, famille: familleDe(a.nom, kind, os), kind, os, auto: Boolean(r?.auto), mode: 'demarrer', choix: 'iso' };
}

/** Le menu final (ordre, défaut sûr) une fois l'attente appliquée. Pur. */
export function menuFinal(c: Pick<ContenuCle, 'systemes' | 'defaut'>, a: Attente, biblio: IsoBiblio[]): { systemes: EntreeCle[]; defaut?: string; retires: string[] } {
  const retires = [...a.retirer, ...a.remplacer.map((r) => r.ancien)];
  const garde: EntreeCle[] = c.systemes.filter((s) => !a.retirer.includes(s.fichier)).map((s) => {
    const r = a.remplacer.find((x) => x.ancien === s.fichier);
    return r ? entreeAjoutee(r.fichier, a.ajouter, a.remplacer, biblio)! : { fichier: s.fichier, nom: s.nom, famille: s.famille, mode: s.mode, kind: s.kind, auto: s.auto, os: s.os, choix: s.choix };
  });
  const tous = [...garde, ...a.ajouter.map((x) => entreeAjoutee(x.fichier, a.ajouter, a.remplacer, biblio)!)];
  const ordre = a.ordre ?? tous.map((e) => e.fichier);
  const rang = (f: string) => { const i = ordre.indexOf(f); return i < 0 ? ordre.length : i; };
  const systemes = tous.map((e, i) => ({ e, i })).sort((x, y) => rang(x.e.fichier) - rang(y.e.fichier) || x.i - y.i).map((x) => x.e);
  // Le défaut : celui demandé, sinon celui d'avant ; seulement s'il est encore là et n'installe rien.
  const remplace = a.remplacer.find((x) => x.ancien === c.defaut)?.fichier;
  const voulu = a.defaut !== undefined ? a.defaut : (remplace ?? c.defaut ?? '');
  const ent = systemes.find((s) => s.fichier === voulu);
  return { systemes, ...(ent && defautPermis(ent) ? { defaut: ent.fichier } : {}), retires };
}

// ------------------------------------------------------------------------------------------------ réécrire le menu (pur)
/** La préparation (même forme que l'écriture) qui décrit un menu de clé, pour les constructeurs du menu. Pur. */
export function prepDuMenu(m: Pick<Manifeste, 'systemes' | 'defaut' | 'modeDefaut' | 'delai' | 'langue' | 'theme' | 'texte' | 'disposition'>): PreparationCle {
  const systemes: SystemeCle[] = m.systemes.map((e) => ({ fichier: e.fichier, nom: e.nom, famille: e.famille === 'Windows' ? 'Windows' : 'Linux', mode: e.mode, recipe: recetteDe(e), choix: e.choix }));
  return { schema: 'gpt', secureBoot: true, label: 'ODIN', theme: m.theme, texte: m.texte, disposition: m.disposition, modeDefaut: m.modeDefaut, delai: m.delai, ...(m.langue ? { langue: m.langue } : {}), systemes, images: [], vdisks: [], logiciels: [], ...(m.defaut ? { defaut: m.defaut } : {}) };
}
const cheminIso = (f: string) => `${DISPOSITION_CLE.iso}/${f}`;

/**
 * Le ventoy.json de la clé, PATCHÉ : seuls le système par défaut, le délai, le mode et les entrées des systèmes ajoutés,
 * retirés ou rangés changent ; tout le reste (mot de passe, persistance, disques virtuels, injections des autres) est
 * gardé. Illisible : refait en entier d'après le menu. Pur.
 */
export function patchVentoyJson(ancien: string | undefined, m: Manifeste, retires: string[]): string {
  const doc = docVentoy(ancien);
  if (!doc) return buildVentoyJson(prepDuMenu(m));
  const parti = (img: unknown) => { const f = isoDe(img); return Boolean(f) && retires.includes(f); };
  const sansDefaut = (l: unknown) => (Array.isArray(l) ? l : []).filter((c) => { const x = o(c); return !Object.hasOwn(x, 'VTOY_DEFAULT_IMAGE') && !Object.hasOwn(x, 'VTOY_MENU_TIMEOUT') && !Object.hasOwn(x, 'VTOY_DEFAULT_MENU_MODE'); });
  const control = sansDefaut(doc.control);
  const tete: Array<Record<string, string>> = [];
  // La même règle que l'écriture (cle-boot.ts) : en mode texte, le menu texte d'Odin compte lui-même ; un délai seulement
  // avec un système par défaut (sans lui, Ventoy démarrerait au délai la 1re image de sa liste : un installateur).
  if (m.modeDefaut === 'texte') tete.push({ VTOY_DEFAULT_IMAGE: `F6>${TITRE_ENTREE_ODIN}` }, { VTOY_MENU_TIMEOUT: '0' });
  else if (m.defaut) { tete.push({ VTOY_DEFAULT_IMAGE: cheminIso(m.defaut) }); if (m.delai > 0) tete.push({ VTOY_MENU_TIMEOUT: String(m.delai) }); }
  tete.push({ VTOY_DEFAULT_MENU_MODE: '0' });
  doc.control = [...tete, ...control];
  // Les réglages « par démarrage » (control_uefi…) passent devant « control » : le même défaut sûr y est posé.
  for (const v of VARIANTES.slice(1)) if (Array.isArray(doc[`control${v}`])) doc[`control${v}`] = [...tete, ...sansDefaut(doc[`control${v}`])];
  if (doc.theme && typeof doc.theme === 'object') o(doc.theme).display_mode = m.modeDefaut === 'texte' ? 'CLI' : 'GUI';
  const dansMenu = new Set(m.systemes.map((e) => e.fichier));
  const autresAlias = (Array.isArray(doc.menu_alias) ? doc.menu_alias : []).filter((a) => !parti(o(a).image) && !dansMenu.has(isoDe(o(a).image)));
  doc.menu_alias = [...m.systemes.map((e) => ({ image: cheminIso(e.fichier), alias: e.nom })), ...autresAlias];
  const classes = (Array.isArray(doc.menu_class) ? doc.menu_class : []).filter((c) => !retires.includes(st(o(c).key)));
  for (const e of m.systemes) if (!classes.some((c) => st(o(c).key) === e.fichier)) classes.push({ key: e.fichier, class: classeIcone(e.fichier) });
  doc.menu_class = classes;
  for (const v of VARIANTES.slice(1)) for (const k of [`menu_alias${v}`, `menu_class${v}`]) if (Array.isArray(doc[k])) doc[k] = (doc[k] as unknown[]).filter((x) => !parti(o(x).image) && !retires.includes(st(o(x).key)));
  for (const k of VARIANTES.flatMap((v) => ['auto_install', 'injection', 'persistence', 'conf_replace', 'dud'].map((x) => x + v))) if (Array.isArray(doc[k])) { doc[k] = (doc[k] as unknown[]).filter((x) => !parti(o(x).image)); if (!(doc[k] as unknown[]).length) delete doc[k]; }
  return `${JSON.stringify(doc, null, 2)}\n`;
}
/** Les entrées GRUB ajoutées APRÈS la liste de Ventoy (Linux installés), reprises telles quelles du menu texte actuel. Pur. */
export function queueGrub(ancien: string | undefined): string[] {
  if (!ancien) return [];
  const l = ancien.split('\n'), i = l.findIndex((x) => x.startsWith('menuentry "VTOY_RET"'));
  if (i < 0) return [];
  const fin = l.findIndex((x, j) => j > i && x.trim() === '}');
  const reste = l.slice(fin + 1).join('\n').trim();
  return reste ? [reste] : [];
}
/** Le manifeste (fichier d'identité) d'une clé après changement. Pur. */
export function nouveauManifeste(id: string, c: ContenuCle, f: ReturnType<typeof menuFinal>, cree: number, maintenant = Date.now()): Manifeste {
  return { odin: 1, id, cree: cree || maintenant, maj: maintenant, systemes: f.systemes, ...(f.defaut ? { defaut: f.defaut } : {}), modeDefaut: c.reglages.modeDefaut, delai: c.reglages.delai, ...(c.reglages.langue ? { langue: c.reglages.langue } : {}), theme: c.reglages.theme, texte: c.reglages.texte, disposition: c.reglages.disposition };
}
/** Les fichiers du réglage du menu à écrire sur la clé (chemin → contenu), dans l'ordre où ils sont mis en place. Pur. */
export function fichiersDuMenu(m: Manifeste, c: Pick<ContenuCle, 'ventoyJson' | 'grubCfg'>, retires: string[], avecEcran: boolean): Array<[string, string]> {
  const prep = prepDuMenu(m);
  const l: Array<[string, string]> = [
    ['ventoy/ventoy.json', patchVentoyJson(c.ventoyJson, m, retires)],
    ['ventoy/ventoy_grub.cfg', buildMenuTexte(prep, { installes: queueGrub(c.grubCfg) })],
  ];
  if (avecEcran) {
    const j = buildersParDefaut.buildEcranOffline(prep).fichiers['systemes.json'];
    if (j !== undefined) l.push(['ecran-odin/systemes.json', j], ['ecran-odin/ecran/etat', j]);
  }
  l.push([FICHIER_ID, `${JSON.stringify(m, null, 2)}\n`]);
  return l;
}

// ------------------------------------------------------------------------------------------------ appliquer (IO)
export interface ResultatGerer { ok: boolean; message: string; ecrits: Array<{ dest: string; sha256: string }>; touchee: boolean }
export interface OptionsAppliquer {
  /** revérifie la clé (même numéro de série, même identifiant, toujours choisissable) ; rend la raison d'un refus */
  verifier: () => Promise<string | undefined>;
  /** le fichier source d'une image de la bibliothèque (par son identifiant), retrouvé par le SERVEUR */
  source: (iso: string) => string | undefined;
  /** la place libre connue par la liste des disques (sinon : celle de l'IO) */
  libre?: number;
  onProgress?: (fait: number, total: number, etape: string) => void;
  annule?: () => boolean;
  maintenant?: number;
  /** les images déjà copiées par Odin lors d'une application coupée (fichier → empreinte) : relues, pas recopiées */
  dejaCopies?: Record<string, string>;
}
const go = (n: number) => `${(n / 1024 ** 3).toFixed(1).replace('.', ',')} Go`;

/**
 * Applique une attente sur une clé ODIN, sans l'effacer : 1) la clé revérifiée ; 2) la place vérifiée ; 3) chaque image
 * ajoutée copiée à côté puis mise en place ; 4) le réglage du menu réécrit (chaque fichier à côté puis mis en place) ;
 * 5) seulement alors, les fichiers des systèmes retirés ; 6) tout relu. À chaque instant, le menu sur la clé ne cite que
 * des fichiers présents : une coupure laisse la clé démarrable (l'ancien menu, ou le nouveau).
 */
export async function appliquerAttente(io: IoGerer, c: ContenuCle, a: Attente, biblio: IsoBiblio[], opt: OptionsAppliquer): Promise<ResultatGerer> {
  const ecrits: ResultatGerer['ecrits'] = [];
  let touchee = false;
  const refus = (message: string): ResultatGerer => ({ ok: false, message, ecrits, touchee });
  if (!c.id || !ID_CLE.test(c.id)) return refus('Cette clé n\'a pas d\'identifiant ODIN : reconnais-la d\'abord. Rien n\'a été écrit.');
  if (c.incomplete) return refus('Cette clé porte la marque d\'une écriture interrompue : refais-la depuis « Déployer ». Rien n\'a été écrit.');
  // Le réglage du menu déjà sur la clé : s'il est là mais illisible (abîmé, trop gros pour être lu), Odin ne le remplace
  // pas — il effacerait ce que d'autres y ont mis (mot de passe de démarrage, mémoire, installations).
  if (c.ventoyJson === undefined ? await io.existe('ventoy/ventoy.json') : (c.ventoyJson.trim() !== '' && !docVentoy(c.ventoyJson)))
    return refus('Le réglage du menu de cette clé (ventoy/ventoy.json) est illisible ou trop gros : Odin ne le remplace pas, il effacerait un mot de passe ou des réglages. Refais la clé depuis « Déployer ». Rien n\'a été écrit.');
  const f = menuFinal(c, a, biblio);
  const copies = [...a.ajouter, ...a.remplacer].map((x) => ({ ...x, source: opt.source(x.iso) }));
  const sans = copies.find((x) => !x.source);
  if (sans) return refus(`« ${sans.nom} » n'est plus dans la bibliothèque d'Odin. Rien n'a été écrit.`);
  const total = 2 + copies.length + 4 + f.retires.length;
  let fait = 0;
  const pas = (etape: string) => { fait++; opt.onProgress?.(fait, total, etape); };
  const garde = async () => { const r = await opt.verifier(); if (r) throw new Error(r); if (opt.annule?.()) throw new Error('annulé'); };
  /** Retire les restes d'une écriture coupée (fichiers « à côté », au suffixe d'Odin) ; rend la place rendue. */
  const nettoyer = async (): Promise<number> => {
    let rendu = 0;
    for (const d of ['ISO', 'ventoy', 'ecran-odin', 'ecran-odin/ecran', 'odin']) for (const e of await io.lister(d)) if (e.genre === 'fichier' && (e.nom.endsWith(PART) || e.nom.endsWith(NEUF))) { touchee = true; await io.retirer(`${d}/${e.nom}`); rendu += e.taille; }
    return rendu;
  };
  try {
    // 1) La clé, juste avant le premier octet.
    const r0 = await opt.verifier();
    if (r0) return refus(`${r0} Rien n'a été écrit.`);
    pas('clé revérifiée');
    // Les restes d'une écriture coupée sont retirés d'abord : jamais cités par le menu, et leur place compte de nouveau.
    const rendu = await nettoyer();
    // Une image déjà copiée par Odin pour CES changements (application coupée) : relue, pas recopiée ; toute autre image
    // du même nom déjà sur la clé : refus, rien n'est remplacé.
    const reprises = new Set<string>();
    for (const x of copies) {
      const dest = `ISO/${x.fichier}`;
      if (!(await io.existe(dest))) continue;
      const h = opt.dejaCopies?.[x.fichier];
      if (!h || (await io.empreinte(dest)) !== h) return refus(`« ${x.fichier} » est déjà sur la clé : rien n'a été remplacé.${touchee ? '' : ' Rien n\'a été écrit.'}`);
      reprises.add(x.fichier);
    }
    // 2) La place : les images ajoutées tiennent, avec une marge (les retraits ne comptent pas : ils viennent après).
    const besoin = copies.filter((x) => !reprises.has(x.fichier)).reduce((n, x) => n + x.taille, 0);
    if (besoin > 0) {
      const connu = opt.libre ?? await io.libre?.();
      if (connu === undefined) return refus('Odin ne connaît pas la place libre sur cette clé : rien n\'a été ajouté.');
      const libre = connu + (opt.libre !== undefined ? rendu : 0);
      if (besoin + MARGE > libre) return refus(`Pas assez de place : il faut ${go(besoin + MARGE)} (marge comprise), il reste ${go(libre)}. Retire un système d'abord, applique, puis ajoute.${touchee ? '' : ' Rien n\'a été écrit.'}`);
    }
    pas('place vérifiée');
    // 3) Les images ajoutées, à côté puis mises en place (Ventoy ne liste pas un « .odin-part »). La clé est revérifiée
    //    avant la copie ET juste avant la mise en place : une grosse image met des minutes à se copier.
    for (const x of copies) {
      await garde();
      const dest = `ISO/${x.fichier}`;
      if (reprises.has(x.fichier)) { ecrits.push({ dest, sha256: opt.dejaCopies![x.fichier] }); pas(`déjà copié : ${x.nom}`); continue; }
      touchee = true;
      ecrits.push({ dest, sha256: await io.copierAtomique(x.source!, dest, undefined, garde) });
      pas(`copié : ${x.nom}`);
    }
    // 4) Le réglage du menu : chaque fichier à côté puis mis en place ; le fichier d'identité en dernier.
    await garde();
    const ancien = manifesteDe(await io.lire(FICHIER_ID, 256 * 1024));
    const m = nouveauManifeste(c.id, c, f, ancien?.cree ?? 0, opt.maintenant);
    const avecEcran = await io.existe('ecran-odin/systemes.json');
    const menu = fichiersDuMenu(m, c, f.retires, avecEcran);
    for (const [dest, contenu] of menu) { await garde(); touchee = true; ecrits.push({ dest, sha256: await io.ecrireAtomique(dest, contenu) }); }
    pas('menu réécrit');
    // 5) Les fichiers des systèmes retirés, une fois que le menu ne les cite plus : l'image, sa mémoire, son archive.
    //    La mémoire n'est retirée que si elle est à ce système SEUL (un fichier partagé avec un système gardé reste).
    const persDe = (fichier: string) => {
      const l: string[] = [];
      for (const p of tableaux(docVentoy(c.ventoyJson) ?? {}, 'persistence')) {
        if (!viseImage(o(p).image, fichier)) continue;
        for (const brut of Array.isArray(o(p).backend) ? o(p).backend as unknown[] : [o(p).backend]) { const b = st(brut).replace(/\\/g, '/').replace(/^\//, ''); if (relSur(b) && b.startsWith('persistence/')) l.push(b); }
      }
      return l;
    };
    const restants = new Set(m.systemes.map((e) => e.fichier));
    const memoireGardee = new Set([...restants].flatMap(persDe).map((b) => b.toLowerCase()));
    for (const fi of f.retires) {
      if (restants.has(fi)) continue;
      await garde();
      await io.retirer(`ISO/${fi}`);
      for (const p of persDe(fi)) if (!memoireGardee.has(p.toLowerCase())) await io.retirer(p);
      const base = fi.replace(/\.[^.]+$/, '');
      if (![...restants].some((x) => x.replace(/\.[^.]+$/, '') === base)) await io.retirer(`odin/inject-${base}.tar.gz`);
      pas(`retiré : ${fi}`);
    }
    // 6) Tout ce qui vient d'être écrit est relu.
    for (const e of ecrits) if ((await io.empreinte(e.dest)) !== e.sha256) return refus(`Relecture : ${e.dest} ne correspond pas à ce qu'Odin a écrit. La clé démarre encore, mais relis-la.`);
    pas('tout est relu');
    const n = nbChangements(a, c);
    return { ok: true, message: `Clé mise à jour sans rien effacer d'autre : ${n} changement${n > 1 ? 's' : ''} appliqué${n > 1 ? 's' : ''}, ${m.systemes.length} système${m.systemes.length > 1 ? 's' : ''} au menu.`, ecrits, touchee };
  } catch (e) {
    const msg = (e as Error).message;
    // Un reste de copie (place prise pour rien) n'est retiré que si c'est TOUJOURS la même clé ; sinon on ne touche à rien.
    try { if (touchee && !(await opt.verifier())) await nettoyer(); } catch { /* la clé n'est plus là : au prochain passage */ }
    return refus(`${/annul/i.test(msg) ? 'Arrêté' : `Interrompu : ${msg}`}. ${touchee ? 'La clé démarre toujours (l\'ancien menu ou le nouveau) ; les changements restent en attente.' : 'Rien n\'a été écrit.'}`);
  }
}

/** Relit chaque fichier d'Odin sur la clé et le compare à son empreinte connue ; mesure le débit de lecture. */
export async function relireCle(io: IoGerer, connues: Map<string, string>, exiges: Set<string> = new Set(connues.keys()), horloge: () => number = Date.now): Promise<{ fichiers: number; conformes: number; differents: string[]; manquants: string[]; inconnus: number; octets: number; debitMo: number }> {
  const debut = horloge();
  let octets = 0, conformes = 0, inconnus = 0, fichiers = 0;
  const differents: string[] = [], manquants: string[] = [];
  const vus = new Set<string>();
  const parcourir = async (d: string, prof: number): Promise<void> => {
    if (prof > 4) return;
    for (const e of await io.lister(d)) {
      const rel = `${d}/${e.nom}`;
      if (e.genre === 'dossier') { await parcourir(rel, prof + 1); continue; }
      if (e.genre !== 'fichier' || e.nom.endsWith(PART) || e.nom.endsWith(NEUF)) continue;
      fichiers++; vus.add(rel);
      const h = await io.empreinte(rel, (n) => { octets += n; });
      const attendu = connues.get(rel);
      if (!attendu) inconnus++; else if (attendu === h) conformes++; else differents.push(rel);
    }
  };
  for (const d of ['ISO', 'vdisk', 'persistence', 'logiciels', 'ventoy', 'ecran-odin', 'odin']) await parcourir(d, 0);
  // « Manquant » : seulement un fichier qu'Odin sait avoir écrit et laissé (le journal garde aussi d'anciennes écritures).
  for (const k of exiges) if (!vus.has(k) && relSur(k)) manquants.push(k);
  const ms = Math.max(1, horloge() - debut);
  return { fichiers, conformes, differents: differents.slice(0, 50), manquants: manquants.slice(0, 50), inconnus, octets, debitMo: Math.round((octets / 1024 ** 2) / (ms / 1000) * 10) / 10 };
}

/** La « souche » d'un nom de système (sans ses numéros de version), pour reconnaître une version plus récente. Pur. */
export const souche = (n: string) => n.toLowerCase().replace(/\.[a-z0-9]+$/, '').replace(/[\d]+/g, '#').replace(/[^a-z#]+/g, ' ').replace(/(# ?)+/g, '#').trim();
/** Le premier numéro de version d'un nom (« 24.04.2 » dans « ubuntu-24.04.2-desktop-amd64 ») : jamais « amd64 ». Pur. */
const versionDe = (n: string) => (/\d+(?:\.\d+)*/.exec(n)?.[0] ?? '').split('.').filter(Boolean).map(Number);
/** a est-elle une version plus récente que b ? Pur. */
export function plusRecente(a: string, b: string): boolean {
  const x = versionDe(a), y = versionDe(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) { const p = x[i] ?? -1, q = y[i] ?? -1; if (p !== q) return p > q; }
  return false;
}
/** Les mises à jour PROPOSÉES pour une clé (jamais faites seules) : une ISO plus récente de la même souche. Pur. */
export function propositions(c: Pick<ContenuCle, 'systemes'>, biblio: IsoBiblio[]): Array<{ ancien: string; nomAncien: string; iso: string; nom: string; fichier: string }> {
  const l: Array<{ ancien: string; nomAncien: string; iso: string; nom: string; fichier: string }> = [];
  for (const s of c.systemes) {
    const sou = souche(s.fichier);
    const cand = biblio.filter((b) => b.recipe && souche(fichierDeBiblio(b)) === sou && fichierDeBiblio(b) !== s.fichier && plusRecente(fichierDeBiblio(b), s.fichier) && !c.systemes.some((x) => x.fichier === fichierDeBiblio(b)))
      .sort((p, q) => (plusRecente(fichierDeBiblio(p), fichierDeBiblio(q)) ? -1 : 1));
    if (cand[0]) l.push({ ancien: s.fichier, nomAncien: s.nom, iso: cand[0].id, nom: nomAffiche(cand[0].nom), fichier: fichierDeBiblio(cand[0]) });
  }
  return l;
}

// ------------------------------------------------------------------------------------------------ le registre (Odin)
/** Ce qu'Odin garde d'une clé ODIN connue (jamais un secret ; le numéro de série n'est montré qu'en ses 4 derniers signes). */
export interface FicheCle {
  id: string; serie: string; modele: string; tailleOctets: number; nom: string;
  premiere: number; derniere: number;
  contenu?: { systemes: Array<EntreeCle & { taille: number; defautPermis: boolean }>; defaut?: string; logiciels: { windows: string[]; linux: string[] }; occupation: ContenuCle['occupation']; delai: number; modeDefaut: ModeDefaut; libre?: number; partition?: number };
  attente?: Attente;
  /** le dernier résultat d'une application ou d'une relecture */
  dernier?: { at: number; ok: boolean; message: string };
  releve?: { at: number; fichiers: number; conformes: number; differents: string[]; manquants: string[]; inconnus: number; debitMo: number };
  /** les empreintes connues des fichiers d'Odin sur cette clé (écrits par lui) */
  empreintes?: Record<string, string>;
  /** les fichiers qu'Odin a retirés de cette clé (leurs anciennes lignes du journal ne comptent plus à la relecture) */
  retires?: string[];
}
interface Registre { cles: Record<string, FicheCle> }

/** La base de l'appli (GENESE_ODIN), schéma « cles » : une ligne par clé connue. */
export const DEF_CLES: DefAppli = {
  id: 'thjalfi_cles', schema: 'cles', appli: 'thjalfi',
  migrations: [{
    v: 1, nom: 'clés ODIN connues de Genèse (contenu, ordre du menu, changements en attente, relecture)',
    sql: `
CREATE TABLE cles (id text PRIMARY KEY, data jsonb NOT NULL, maj bigint NOT NULL);
-- Ce qu'Odin (compte odin_lecture) peut lire : le nom, la dernière fois vue, le nombre de systèmes ; jamais le numéro de série.
CREATE VIEW v_cles AS SELECT id, data->>'nom' AS nom, to_timestamp((data->>'derniere')::double precision / 1000) AS vue, jsonb_array_length(COALESCE(data->'contenu'->'systemes', '[]'::jsonb)) AS systemes, (data->'attente') IS NOT NULL AS en_attente FROM cles;
GRANT SELECT ON v_cles TO odin_lecture`,
  }],
  ecritures: {
    cle_pose: 'INSERT INTO cles (id, data, maj) VALUES ($1, $2::jsonb, $3) ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, maj = EXCLUDED.maj',
    cle_retire: 'DELETE FROM cles WHERE id = $1',
  },
};
const bases = new Map<string, AppliBase>();
const branches = new Set<string>();
/** Range le registre dans la base GENESE_ODIN dès qu'elle est prête (idempotent par dossier) ; rien de perdu sans base. */
function brancherBase(dir: string, lire: () => Registre, ecrire: (r: Registre) => void): void {
  if (branches.has(dir)) return;
  branches.add(dir);
  quandBase((b) => {
    const a = b.appli(DEF_CLES, join(dir, 'base-cles'));
    bases.set(dir, a);
    const pret = async () => {
      const r = lire();
      // Le fichier perdu mais la base pleine : le registre revient de la base ; sinon la base reçoit tout (rejouable).
      if (!Object.keys(r.cles).length) {
        try { const q = await a.q('SELECT data::text FROM cles'); for (const [d] of q.rows) { const f = o(JSON.parse(d ?? '{}')) as unknown as FicheCle; if (ID_CLE.test(st(f.id))) r.cles[f.id] = f; } if (Object.keys(r.cles).length) ecrire(r); } catch (e) { if (!(e instanceof BaseAttente)) console.error(`[genese] clés : ${(e as Error).message}`); }
        return;
      }
      for (const f of Object.values(r.cles)) a.ecrire(['cle_pose', f.id, JSON.stringify(f), f.derniere || Date.now()]);
    };
    a.on('prete', () => void pret()); if (a.prete) void pret();
  });
}
/** (essais) oublie les branchements à la base. */
export function oublierBaseCles(): void { branches.clear(); bases.clear(); }

function registre(ctx: ModCtx) {
  const f = join(ctx.dir, 'cles-odin.json');
  const lire = (): Registre => { try { const j = o(JSON.parse(readFileSync(f, 'utf8'))); const cles: Record<string, FicheCle> = {}; for (const [k, v] of Object.entries(o(j.cles))) if (ID_CLE.test(k) && o(v).id === k) cles[k] = v as FicheCle; return { cles }; } catch { return { cles: {} }; } };
  const ecrire = (r: Registre) => { mkdirSync(ctx.dir, { recursive: true, mode: 0o700 }); const t = `${f}.tmp`; writeFileSync(t, `${JSON.stringify(r, null, 1)}\n`, { mode: 0o600 }); renameSync(t, f); };
  brancherBase(ctx.dir, lire, ecrire);
  return {
    lire,
    /** change une fiche et la range (fichier puis base) */
    poser(fiche: FicheCle) { const r = lire(); r.cles[fiche.id] = fiche; ecrire(r); bases.get(ctx.dir)?.ecrire(['cle_pose', fiche.id, JSON.stringify(fiche), Date.now()]); },
  };
}

// ------------------------------------------------------------------------------------------------ les actions
/** Ce que Genèse donne aux actions de « Mes clés ». */
export interface DepsGerer {
  /** les images PRÊTES de la bibliothèque */
  bibliotheque?: (ctx: ModCtx) => Promise<IsoBiblio[]>;
  /** pour les essais : l'IO d'une clé (sinon : la partition ODIN montée, ou le faux disque en mode essai) */
  io?: (ctx: ModCtx, d: Disque) => IoGerer | undefined;
}
const modeEssai = (ctx: ModCtx) => Array.isArray(ctx.settings.cleDisquesTest);
function sourceDe(ctx: ModCtx): SourceDisques {
  const faux = ctx.settings.cleDisquesTest as Disque[] | undefined;
  if (Array.isArray(faux)) return sourceSimulee(faux);
  return sourceReelle(process.platform, async (cmd, args) => (await ctx.run(cmd, args, { timeoutMs: 30_000 })).out);
}
const partitionOdin = (d: Disque) => d.partitions.find((p) => p.label?.toUpperCase() === 'ODIN');
/** L'IO d'une clé ODIN branchée : sa partition ODIN montée (vraie clé), ou le faux disque (mode essai), ou rien. */
function ioDe(ctx: ModCtx, d: Disque, deps: DepsGerer): IoGerer | undefined {
  if (deps.io) return deps.io(ctx, d);
  if (modeEssai(ctx)) return ioGererDossier(st(ctx.settings.cleImageTest) || join(ctx.dir, 'cle-essai', d.id.replace(/[^\w-]/g, '_')));
  const m = partitionOdin(d)?.montage;
  if (!m) return undefined;
  return ioGererDossier(/^[a-z]:$/i.test(m) ? `${m}/` : m);
}
/** Une clé ODIN branchée qu'Odin peut regarder : externe, retirable, pas le disque du système, avec sa partition ODIN. Pur. */
export const cleOdinBranchee = (d: Disque) => choisissable(d) && d.estOdin === true && Boolean(partitionOdin(d));
const finSerie = (s: string) => (s ? `…${s.slice(-4)}` : '');
const nomCle = (d: Disque) => nomAffiche(d.modele) || `Clé ODIN ${Math.round(d.tailleOctets / 1024 ** 3)} Go`;

/**
 * Un numéro de série « de série » que des milliers de clés partagent (0123456789, 1234567890AB, AAAAAAAA, 000000000001…) :
 * il ne distingue pas deux clés du même modèle. Odin montre une telle clé, il ne la change jamais. Pur.
 */
export function serieGenerique(serie: string): boolean {
  const u = serie.toUpperCase().replace(/[^0-9A-Z]/g, '');
  if (u.length < 6 || new Set(u).size <= 2) return true;
  if (/^0+[0-9A-F]$/.test(u)) return true;
  const suites = ['0123456789ABCDEF'.repeat(5), '0123456789'.repeat(7), '1234567890'.repeat(7), '123456789'.repeat(8), '1234567890ABCDEF'.repeat(4), '123456789ABCDEF'.repeat(4), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.repeat(3)];
  return suites.some((x) => x.includes(u) || [...x].reverse().join('').includes(u));
}
/** Le numéro de série d'une clé, s'il est lisible ET propre à elle (ni vide, ni générique). Pur. */
export const serieSure = (brut: unknown): string | undefined => { const x = serieLisible(brut); return x && !serieGenerique(x) ? x : undefined; };
/** L'état d'une clé branchée vis-à-vis du registre. Pur. */
export function etatDe(d: Disque, id: string | undefined, fiches: Record<string, FicheCle>): 'connue' | 'a-reconnaitre' | 'copie' | 'serie-illisible' {
  const s = serieSure(d.serie);
  if (!s) return 'serie-illisible';
  if (!id) return 'a-reconnaitre';
  const f = fiches[id];
  if (!f) return 'a-reconnaitre';
  return f.serie.toUpperCase() === s.toUpperCase() && f.tailleOctets === d.tailleOctets ? 'connue' : 'copie';
}

/** Les travaux en cours (un par clé) : application des changements, relecture. */
interface Travail { cle: string; disque: string; sorte: 'appliquer' | 'relire'; debut: number; fait: number; total: number; etape: string; fini: boolean; ok?: boolean; message?: string }
const TRAVAUX = new Map<string, Travail>();
const PROMESSES = new Map<string, Promise<unknown>>();
/** Pour les essais : attend la fin d'un travail lancé en arrière-plan sur une clé. */
export function attendreTravail(cle: string): Promise<unknown> { return PROMESSES.get(cle) ?? Promise.resolve(undefined); }
const occupe = (cle: string, disque: string) => [...TRAVAUX.values()].some((t) => !t.fini && (t.cle === cle || t.disque === disque));

export function cleGerer(deps: DepsGerer = {}): { actions: Action[] } {
  const journal = (ctx: ModCtx) => journalDe<LigneJournalCle & { cible: string; par?: string }>(ctx, 'thjalfi_cle', 'cle-journal.jsonl', { garder: 500 });
  // Une écriture de « Déployer » (lot C4) sur ce disque : on n'y touche pas en même temps.
  const progres = cleUsb().actions.find((a) => a.id === 'cle_progres')!;
  const ecritureC4 = async (ctx: ModCtx, disque: string) => { try { const r = await progres.run(ctx, { cible: disque }); const d = o(r.data); return d.aucune !== true && d.fini !== true; } catch { return false; } };
  const biblioDe = async (ctx: ModCtx) => { try { return deps.bibliotheque ? await deps.bibliotheque(ctx) : []; } catch { return []; } };

  /** Les disques, et pour chaque clé ODIN branchée : son IO et ce qu'elle contient (rien n'est écrit). */
  async function branchees(ctx: ModCtx, biblio: IsoBiblio[]) {
    const liste = await sourceDe(ctx).lister();
    const l: Array<{ d: Disque; io?: IoGerer; c?: ContenuCle }> = [];
    for (const d of liste.filter(cleOdinBranchee)) {
      const io = ioDe(ctx, d, deps);
      let c: ContenuCle | undefined; try { c = io ? await lireCle(io, biblio) : undefined; } catch { c = undefined; }
      l.push({ d, ...(io ? { io } : {}), ...(c ? { c } : {}) });
    }
    return { liste, l };
  }
  /** La fiche d'une clé, mise à jour d'après ce qu'Odin vient d'y lire. */
  const ficheDe = (f: FicheCle, d: Disque, c: ContenuCle, now: number): FicheCle => {
    const p = partitionOdin(d);
    const libre = p && Number.isFinite(p.utiliseOctets) ? Math.max(0, p.tailleOctets - (p.utiliseOctets ?? 0)) : undefined;
    return {
      ...f, modele: nomAffiche(d.modele), tailleOctets: d.tailleOctets, derniere: now,
      contenu: { systemes: c.systemes.map((s) => ({ ...s, defautPermis: defautPermis(s) })), ...(c.defaut ? { defaut: c.defaut } : {}), logiciels: c.logiciels, occupation: c.occupation, delai: c.reglages.delai, modeDefaut: c.reglages.modeDefaut, ...(libre !== undefined ? { libre } : {}), ...(p ? { partition: p.tailleOctets } : {}) },
    };
  };
  /** Retrouve une clé connue BRANCHÉE, reconnue par son numéro de série ET son identifiant ODIN (même taille), ou la raison. */
  async function retrouver(ctx: ModCtx, id: string, biblio: IsoBiblio[]): Promise<{ d: Disque; io: IoGerer; c: ContenuCle; f: FicheCle } | { refus: string; pasBranchee?: boolean }> {
    const f = registre(ctx).lire().cles[id];
    if (!f) return { refus: 'Cette clé n\'est pas (ou plus) connue d\'Odin.' };
    const { l } = await branchees(ctx, biblio);
    const memes = l.filter((y) => y.c?.id === id && etatDe(y.d, y.c.id, { [id]: f }) === 'connue');
    if (memes.length > 1) return { refus: `Deux clés branchées se présentent comme « ${f.nom} » (même numéro de série, même identifiant ODIN) : Odin ne sait pas laquelle est la bonne, il ne touche à aucune. Débranche l'autre.` };
    const x = memes[0];
    if (!x || !x.io || !x.c) return { refus: `« ${f.nom} » n'est pas branchée : les changements restent en attente.`, pasBranchee: true };
    return { d: x.d, io: x.io, c: x.c, f };
  }
  /** La revérification juste avant d'écrire : la liste RELUE, le même disque (série, taille), toujours une clé ODIN
   *  choisissable, au même endroit, avec le même identifiant écrit dessus. */
  const verificateur = (ctx: ModCtx, d: Disque, io: IoGerer, id: string, f: FicheCle) => async (): Promise<string | undefined> => {
    const n = (await sourceDe(ctx).lister()).find((x) => x.id === d.id);
    const r = raisonNonChoisissable(n);
    if (r || !n) return r ?? 'La clé n\'est plus branchée.';
    if (!cleOdinBranchee(n)) return 'Ce n\'est plus une clé ODIN.';
    if (!memeDisque({ serie: f.serie, tailleOctets: f.tailleOctets, modele: d.modele }, n) || !serieSure(n.serie)) return 'Ce n\'est plus la même clé (numéro de série ou taille différents).';
    if (partitionOdin(n)?.montage !== partitionOdin(d)?.montage) return 'La partition ODIN de la clé n\'est plus au même endroit (lettre de lecteur ou point de montage changés).';
    if (manifesteDe(await io.lire(FICHIER_ID, 256 * 1024))?.id !== id) return 'L\'identifiant ODIN écrit sur la clé a changé.';
    if (await ecritureC4(ctx, d.id)) return 'Une écriture « Déployer » est en cours sur cette clé.';
    return undefined;
  };

  const actions: Action[] = [
    {
      id: 'cle_mes_cles', label: 'Mes clés : les clés ODIN connues', read: true, quick: false, proprietaireSeul: true, external: true,
      what: 'Les clés ODIN connues d\'Odin et celles branchées : contenu, ordre du menu, entrée par défaut, changements en attente, dernière relecture (rien n\'est écrit sur une clé)',
      words: ['mes clés', 'mes clés odin', 'clés usb odin'],
      run: async (ctx) => {
        const now = ctx.now().getTime();
        const biblio = await biblioDe(ctx);
        const { l } = await branchees(ctx, biblio);
        const reg = registre(ctx);
        const fiches = reg.lire().cles;
        const vues: Array<Record<string, unknown>> = [];
        const branche = new Map<string, { d: Disque; c: ContenuCle }>();
        for (const x of l) {
          if (!x.c) { vues.push({ etat: 'illisible', disque: x.d.id, nom: nomCle(x.d), tailleOctets: x.d.tailleOctets, serieFin: finSerie(serieLisible(x.d.serie) ?? ''), branchee: true }); continue; }
          const e = etatDe(x.d, x.c.id, fiches);
          if (e === 'connue') {
            // Odin note ce qu'il voit (dans SON registre, jamais sur la clé) : la clé est « vue », son contenu à jour.
            const avant = fiches[x.c.id!], f = ficheDe(avant, x.d, x.c, now);
            if (JSON.stringify(f.contenu) !== JSON.stringify(avant.contenu) || f.modele !== avant.modele || now - (avant.derniere || 0) > 60_000) reg.poser(f);
            else f.derniere = avant.derniere;
            fiches[f.id] = f; branche.set(f.id, { d: x.d, c: x.c });
            continue;
          }
          vues.push({ etat: e, disque: x.d.id, nom: nomCle(x.d), tailleOctets: x.d.tailleOctets, serieFin: finSerie(serieLisible(x.d.serie) ?? ''), branchee: true, incomplete: x.c.incomplete,
            systemes: x.c.systemes.map((s) => ({ fichier: s.fichier, nom: s.nom, famille: s.famille, mode: s.mode, choix: s.choix, taille: s.taille })), cible: { id: x.d.id, serie: x.d.serie ?? '', tailleOctets: x.d.tailleOctets, modele: x.d.modele ?? '' } });
        }
        const connues = Object.values(fiches).sort((a, b) => b.derniere - a.derniere).map((f) => {
          const b = branche.get(f.id);
          const t = TRAVAUX.get(f.id);
          return {
            etat: 'connue', id: f.id, nom: f.nom, modele: f.modele, tailleOctets: f.tailleOctets, serieFin: finSerie(f.serie), branchee: Boolean(b), ...(b ? { disque: b.d.id, incomplete: b.c.incomplete } : {}),
            derniere: f.derniere, contenu: f.contenu ? sansReprises(f.contenu, f.attente) : f.contenu, attente: f.attente ?? null, changements: nbChangements(f.attente, f.contenu ? sansReprises(f.contenu, f.attente) : undefined), armeValide: armeValide(f.attente, now),
            dernier: f.dernier ?? null, releve: f.releve ?? null, ...(t ? { travail: { sorte: t.sorte, fait: t.fait, total: t.total, etape: t.etape, fini: t.fini, ok: t.ok, message: t.message ?? '' } } : {}),
          };
        });
        const cles = [...connues, ...vues];
        const nb = connues.length;
        return { ok: true, text: `${nb} clé${nb > 1 ? 's' : ''} ODIN connue${nb > 1 ? 's' : ''}, ${l.length} branchée${l.length > 1 ? 's' : ''}.`, data: { cles, maintenant: now } };
      },
    },
    {
      id: 'cle_reconnaitre', label: 'Mes clés : reconnaître une clé ODIN', quick: false, proprietaireSeul: true, external: true,
      what: 'Retient une clé ODIN branchée (numéro de série + identifiant ODIN) ; une clé écrite avant reçoit son identifiant (un petit fichier dans le dossier d\'Odin sur la clé, rien d\'autre)',
      params: [{ key: 'cible', label: 'Clé (identifiant, numéro de série, taille)', kind: 'text', required: true }],
      run: async (ctx, i) => {
        const ci = o(i.cible);
        const biblio = await biblioDe(ctx);
        const { liste, l } = await branchees(ctx, biblio);
        const d0 = liste.find((x) => x.id === st(ci.id));
        const r = raisonNonChoisissable(d0);
        if (r || !d0) return { ok: false, text: `${r ?? 'Clé introuvable.'} Rien n'a été écrit.` };
        if (!cleOdinBranchee(d0)) return { ok: false, text: 'Ce n\'est pas une clé ODIN : Odin ne la retient pas. Pour en faire une, passe par « Déployer ». Rien n\'a été écrit.' };
        if (!memeDisque(ci, d0)) return { ok: false, text: 'Ce n\'est plus la même clé (numéro de série ou taille différents). Rien n\'a été écrit.' };
        const serie = serieSure(d0.serie);
        if (!serie) return { ok: false, text: 'Le numéro de série de cette clé est illisible, ou c\'est un numéro que beaucoup de clés partagent : Odin ne pourrait pas la reconnaître à coup sûr, il ne la change pas. Rien n\'a été écrit.' };
        const x = l.find((y) => y.d.id === d0.id);
        if (!x?.io || !x.c) return { ok: false, text: 'La partition ODIN de cette clé n\'est pas lisible (pas ouverte ?). Rien n\'a été écrit.' };
        if (x.c.incomplete) return { ok: false, text: 'Cette clé porte la marque d\'une écriture interrompue : refais-la depuis « Déployer ». Rien n\'a été écrit.' };
        // Le nom « ODIN » d'une partition ne suffit pas (n'importe quel disque peut le porter) : il faut le menu qu'Odin écrit.
        if (!x.c.id && !(docVentoy(x.c.ventoyJson) && (x.c.grubCfg !== undefined || await x.io.existe('ecran-odin/systemes.json') || await x.io.existe('odin/odin-scan')))) return { ok: false, text: 'Ce disque porte le nom ODIN, mais Odin n\'y retrouve pas son menu : ce n\'est pas une clé faite par lui, il n\'y écrit pas. Pour en faire une clé ODIN, passe par « Déployer ». Rien n\'a été écrit.' };
        if (occupe('', d0.id)) return { ok: false, text: 'Odin travaille déjà sur cette clé. Rien n\'a été écrit.' };
        if (await ecritureC4(ctx, d0.id)) return { ok: false, text: 'Une écriture est en cours sur cette clé. Rien n\'a été écrit.' };
        const reg = registre(ctx), fiches = reg.lire().cles, now = ctx.now().getTime();
        let id = x.c.id;
        if (id && fiches[id] && etatDe(d0, id, fiches) === 'copie') return { ok: false, text: 'Cette clé porte l\'identifiant d\'une AUTRE clé connue (une copie ?) : Odin ne la touche pas. Rien n\'a été écrit.' };
        let ecrit = false;
        if (!id) {
          // Une clé écrite avant ce lot : son identifiant, et la description de son menu tel qu'il est, dans le dossier d'Odin.
          id = randomBytes(16).toString('hex');
          const f = { systemes: x.c.systemes, defaut: x.c.defaut, retires: [] as string[] };
          const m = nouveauManifeste(id, x.c, f, now, now);
          const d1 = (await sourceDe(ctx).lister()).find((y) => y.id === d0.id);
          if (!d1 || !cleOdinBranchee(d1) || !memeDisque({ serie, tailleOctets: d0.tailleOctets }, d1) || partitionOdin(d1)?.montage !== partitionOdin(d0)?.montage) return { ok: false, text: 'La clé a changé juste avant d\'écrire : rien n\'a été écrit.' };
          if (await x.io.existe(FICHIER_ID)) return { ok: false, text: 'Un fichier d\'identité est apparu sur la clé entre-temps : relis la liste. Rien n\'a été écrit.' };
          const h = await x.io.ecrireAtomique(FICHIER_ID, `${JSON.stringify(m, null, 2)}\n`);
          journal(ctx).ajouter({ at: now, dest: FICHIER_ID, sha256: h, cible: d0.id });
          ecrit = true;
          x.c = { ...x.c, id };
        }
        const base: FicheCle = fiches[id] ?? { id, serie, modele: nomAffiche(d0.modele), tailleOctets: d0.tailleOctets, nom: nomCle(d0), premiere: now, derniere: now };
        reg.poser(ficheDe(base, d0, x.c, now));
        return { ok: true, text: ecrit ? `« ${base.nom} » est reconnue : Odin a posé son identifiant dans le dossier d'Odin de la clé (rien d'autre n'a changé).` : `« ${base.nom} » est reconnue.`, data: { id } };
      },
    },
    {
      id: 'cle_changer', label: 'Mes clés : préparer des changements', quick: false, proprietaireSeul: true, external: true,
      what: 'Range les changements voulus pour une clé connue (ordre du menu, entrée par défaut, ajouter ou retirer un système, réécrire le menu) ; RIEN n\'est écrit sur la clé ; « arme » : les appliquer au prochain branchement de cette clé (un retrait demande alors ton accord, pour ces retraits-là)',
      params: [{ key: 'cle', label: 'Identifiant ODIN de la clé', kind: 'text', required: true }, { key: 'attente', label: 'Changements', kind: 'textarea' }, { key: 'vider', label: 'Tout annuler', kind: 'boolean', default: false }, { key: 'armer', label: 'Appliquer ces changements-là dès que la clé est branchée', kind: 'boolean', default: false }, { key: 'retraits', label: 'Les fichiers des systèmes que tu acceptes de voir retirés', kind: 'textarea' }],
      // Seulement « au prochain branchement » avec un retrait : c'est là que l'accord est donné (ranger sans armer n'écrit
      // et ne promet rien). La phrase part de ce qui est DEMANDÉ (jamais moins que ce que le geste gardera).
      grave: (i, ctx) => {
        if (i.armer !== true || i.vider === true) return undefined;
        const b = o(i.attente);
        const voulu = { retirer: (Array.isArray(b.retirer) ? b.retirer : []).map(st).filter(Boolean), remplacer: (Array.isArray(b.remplacer) ? b.remplacer : []).map((x) => ({ ancien: st(o(x).ancien) })).filter((x) => x.ancien) as Attente['remplacer'] };
        if (!retraitsDe(voulu).length) return undefined;
        let f: FicheCle | undefined;
        try { f = ctx ? registre(ctx).lire().cles[st(i.cle)] : undefined; } catch { f = undefined; }
        return phraseRetraits(f?.nom ?? '', voulu, f?.contenu?.systemes ?? [], true);
      },
      run: async (ctx, i) => {
        const id = st(i.cle);
        const reg = registre(ctx), f = reg.lire().cles[id];
        if (!f) return { ok: false, text: 'Cette clé n\'est pas connue d\'Odin.' };
        if (TRAVAUX.get(id) && !TRAVAUX.get(id)!.fini) return { ok: false, text: 'Odin est en train d\'écrire sur cette clé : attends la fin.' };
        if (i.vider === true) { const g = { ...f }; delete g.attente; reg.poser(g); return { ok: true, text: 'Changements annulés : rien n\'a été écrit sur la clé.', data: { attente: null } }; }
        if (!f.contenu) return { ok: false, text: 'Odin ne connaît pas encore le contenu de cette clé : branche-la une fois.' };
        const c = sansReprises(f.contenu, f.attente);
        // De la page : seulement les changements. L'accord « au prochain branchement » (armer) vaut pour CE qui est envoyé
        // avec lui, à l'heure du serveur ; changer quoi que ce soit ensuite le retire. Les copies déjà faites : celles d'Odin.
        const now = ctx.now().getTime();
        const armer = i.armer === true;
        const brut = { ...o(i.attente), arme: armer, armeLe: armer ? now : 0, copies: f.attente?.copies ?? {}, depuis: f.attente?.depuis ?? now };
        const r = attenteDe(brut, c, await biblioDe(ctx), undefined, now);
        if (r.refus || !r.attente) return { ok: false, text: `${r.refus ?? 'Changement refusé.'} Rien n'a été gardé.` };
        const n = nbChangements(r.attente, c);
        // « Au prochain branchement » avec un retrait : l'accord doit nommer CES retraits-là (les fichiers), sinon rien n'est
        // gardé. Il est noté par Odin avec l'attente : au branchement, un retrait qui n'y est pas ne part pas.
        if (armer && retraitsDe(r.attente).length) {
          if (!retraitsCouverts(r.attente, i.retraits)) return { ok: false, text: `Retirer ${nomsRetraits(r.attente, c.systemes).join(', ')} de « ${f.nom} » demande ton accord pour ces retraits-là : Odin ne les promet pas au prochain branchement sans lui. Rien n'a été gardé.`, data: { accord: true, retraits: retraitsDe(r.attente) } };
          r.attente.accordRetraits = retraitsDe(r.attente);
        } else delete r.attente.accordRetraits;
        const g: FicheCle = { ...f };
        if (n) g.attente = r.attente; else delete g.attente;
        reg.poser(g);
        // Place : un avertissement tout de suite (la vraie vérification est refaite juste avant d'écrire).
        const besoin = [...r.attente.ajouter, ...r.attente.remplacer].reduce((s, x) => s + x.taille, 0);
        const avert = f.contenu.libre !== undefined && besoin + MARGE > f.contenu.libre ? ` Attention : il faut ${go(besoin + MARGE)}, la clé n'a que ${go(f.contenu.libre)} de libre.` : '';
        return { ok: true, text: `${n} changement${n > 1 ? 's' : ''} en attente${r.attente.arme && n ? ', appliqué' + (n > 1 ? 's' : '') + ' au prochain branchement de cette clé (accord valable ' + DUREE_ARME + ')' : ''} ; rien n'est écrit pour l'instant.${avert}`, data: { attente: n ? r.attente : null, changements: n } };
      },
    },
    {
      id: 'cle_appliquer', label: 'Mes clés : appliquer les changements', quick: false, proprietaireSeul: true, external: true,
      what: 'Applique les changements en attente sur la clé connue BRANCHÉE (même numéro de série et même identifiant ODIN), sans l\'effacer : seulement ses fichiers ajoutés ou retirés et le réglage du menu ; retirer un système demande ton accord, pour ces retraits-là',
      params: [{ key: 'cle', label: 'Identifiant ODIN de la clé', kind: 'text', required: true }, { key: 'auto', label: 'Au branchement (seulement si tu l\'as demandé pour ces changements, il y a moins de 24 heures)', kind: 'boolean', default: false }, { key: 'retraits', label: 'Les fichiers des systèmes que tu acceptes de voir retirés', kind: 'textarea' }],
      // Un retrait dans les changements : l'accord habituel d'Odin, avec la clé et chaque système nommés. « Au branchement »
      // (auto) ne pose pas de question : il n'applique un retrait que si cet accord a DÉJÀ été donné pour lui (voir run).
      grave: (i, ctx) => {
        if (i.auto === true) return undefined;
        if (!ctx) return 'appliquer les changements d\'une clé ODIN (des systèmes peuvent en être retirés)';
        try {
          const f = registre(ctx).lire().cles[st(i.cle)];
          return f ? phraseRetraits(f.nom, f.attente, f.contenu?.systemes ?? []) : undefined;
        } catch { return 'appliquer les changements d\'une clé ODIN (des systèmes peuvent en être retirés)'; }
      },
      run: async (ctx, i) => {
        const id = st(i.cle);
        const f0 = registre(ctx).lire().cles[id];
        if (!f0) return { ok: false, text: 'Cette clé n\'est pas connue d\'Odin.' };
        if (!f0.attente || !nbChangements(f0.attente, f0.contenu ? sansReprises(f0.contenu, f0.attente) : undefined)) return { ok: false, text: 'Aucun changement en attente pour cette clé.' };
        // « Au branchement » (la page ouverte qui voit la clé arriver) : seulement avec l'accord du propriétaire pour CES
        // changements, et encore valable. Sinon rien ne part : il appuie lui-même sur « Appliquer ».
        // Un retrait ne part JAMAIS tout seul sans l'accord donné pour lui (noté par Odin avec ces changements-là).
        if (i.auto === true && !armeValide(f0.attente, ctx.now().getTime())) {
          if (!f0.attente.arme) return { ok: false, text: 'Ces changements n\'ont pas ton accord pour partir au branchement : appuie sur « Appliquer ». Rien n\'a été écrit.', data: { perime: false } };
          if (armeValide({ ...f0.attente, retirer: [], remplacer: [] }, ctx.now().getTime())) return { ok: false, text: `Ces changements retirent ${nomsRetraits(f0.attente, f0.contenu?.systemes ?? []).join(', ')} : Odin n'a pas ton accord pour ces retraits-là, il ne les fait pas tout seul. Relis-les, puis appuie sur « Appliquer ». Rien n'a été écrit.`, data: { perime: true, accord: true } };
          return { ok: false, text: `Ces changements attendent depuis plus de ${DUREE_ARME} : Odin ne les applique plus tout seul. Relis-les, puis appuie sur « Appliquer ». Rien n'a été écrit.`, data: { perime: true } };
        }
        const biblio = await biblioDe(ctx);
        const x = await retrouver(ctx, id, biblio);
        if ('refus' in x) {
          // Pas branchée : on garde, et on dit que ça partira au prochain branchement si c'est armé.
          return { ok: false, text: x.refus, data: { pasBranchee: Boolean(x.pasBranchee) } };
        }
        if (occupe(id, x.d.id)) return { ok: false, text: 'Odin travaille déjà sur cette clé.' };
        // L'attente est REFAITE d'après ce qui est VRAIMENT sur la clé maintenant (elle a pu changer ailleurs).
        // Une image déjà copiée par Odin pour ces changements (application coupée) n'est pas « un système de la clé » : elle
        // est reprise (relue, pas recopiée).
        const dejaCopies = f0.attente.copies ?? {};
        x.c = sansReprises(x.c, f0.attente);
        const r = attenteDe(f0.attente, x.c, biblio, undefined, f0.attente.depuis);
        if (r.refus || !r.attente) return { ok: false, text: `${r.refus ?? 'Changement refusé.'} Rien n'a été écrit ; les changements restent en attente.` };
        const a = r.attente;
        // RETIRER un système : seulement avec l'accord donné pour CES retraits-là — celui qui accompagne cette demande (la
        // liste des fichiers que le propriétaire a eue sous les yeux), ou, au branchement, celui noté avec l'attente. Une
        // demande venue d'ailleurs que la page (sans cette liste) ne retire donc rien, même après un « oui » général.
        if (!retraitsCouverts(a, i.auto === true ? f0.attente.accordRetraits : i.retraits)) return { ok: false, text: `Retirer ${nomsRetraits(a, x.c.systemes).join(', ')} de « ${x.f.nom} » demande ton accord pour ces retraits-là. Rien n'a été écrit ; les changements restent en attente.`, data: { accord: true, retraits: retraitsDe(a) } };
        const t: Travail = { cle: id, disque: x.d.id, sorte: 'appliquer', debut: Date.now(), fait: 0, total: 1, etape: 'revérification', fini: false };
        TRAVAUX.set(id, t); CLES_OCCUPEES.add(x.d.id);
        // La place : celle que dit la liste des disques pour la partition ODIN quand elle la connaît, sinon celle de l'IO.
        const p = partitionOdin(x.d);
        const libre = p && Number.isFinite(p.utiliseOctets) ? Math.max(0, p.tailleOctets - (p.utiliseOctets ?? 0)) : undefined;
        const promesse = appliquerAttente(x.io, x.c, a, biblio, {
          verifier: verificateur(ctx, x.d, x.io, id, x.f),
          source: (iso) => biblio.find((b) => b.id === iso)?.chemin,
          ...(libre !== undefined ? { libre } : {}),
          onProgress: (fait, total, etape) => { Object.assign(t, { fait, total, etape }); },
          maintenant: ctx.now().getTime(),
          dejaCopies,
        }).then(async (res) => {
          const reg = registre(ctx), f = reg.lire().cles[id] ?? x.f;
          for (const e of res.ecrits) journal(ctx).ajouter({ at: Date.now(), dest: e.dest, sha256: e.sha256, cible: x.d.id });
          const empreintes = { ...(f.empreintes ?? {}) };
          for (const e of res.ecrits) empreintes[e.dest] = e.sha256;
          let g: FicheCle = { ...f, empreintes, dernier: { at: Date.now(), ok: res.ok, message: res.message } };
          if (res.ok) {
            delete g.attente;
            const partis = [...a.retirer, ...a.remplacer.map((y) => y.ancien)].map((fi) => `ISO/${fi}`);
            for (const k of partis) delete g.empreintes![k];
            g.retires = [...new Set([...(g.retires ?? []).filter((k) => !res.ecrits.some((e) => e.dest === k)), ...partis])].slice(-200);
            try { g = ficheDe(g, x.d, await lireCle(x.io, biblio), Date.now()); } catch { /* relue au prochain passage */ }
          } else if (g.attente) {
            // Coupé : les images qu'Odin a déjà copiées pour ces changements sont notées (reprises à la prochaine fois).
            const faites = { ...(g.attente.copies ?? {}) };
            for (const e of res.ecrits) { const fi = e.dest.startsWith('ISO/') ? e.dest.slice(4) : ''; if (fi && [...a.ajouter, ...a.remplacer].some((y) => y.fichier === fi)) faites[fi] = e.sha256; }
            if (Object.keys(faites).length) g.attente = { ...g.attente, copies: faites };
          }
          reg.poser(g);
          Object.assign(t, { fini: true, ok: res.ok, message: res.message });
          return res;
        }, (e: Error) => { Object.assign(t, { fini: true, ok: false, message: `Interrompu : ${e.message}` }); }).finally(() => { CLES_OCCUPEES.delete(x.d.id); });
        PROMESSES.set(id, promesse);
        return { ok: true, text: `Odin applique ${nbChangements(a, x.c)} changement(s) sur « ${x.f.nom} » : rien d'autre n'est effacé.`, data: { cle: id } };
      },
    },
    {
      id: 'cle_relire', label: 'Mes clés : relire toute la clé', read: true, quick: false, proprietaireSeul: true, external: true,
      what: 'Relit chaque fichier d\'Odin sur la clé connue branchée, le compare à son empreinte connue, et mesure la vitesse de lecture (rien n\'est écrit sur la clé)',
      params: [{ key: 'cle', label: 'Identifiant ODIN de la clé', kind: 'text', required: true }],
      run: async (ctx, i) => {
        const id = st(i.cle);
        const x = await retrouver(ctx, id, []);
        if ('refus' in x) return { ok: false, text: x.pasBranchee ? 'Branche la clé pour la relire.' : x.refus };
        if (occupe(id, x.d.id)) return { ok: false, text: 'Odin travaille déjà sur cette clé.' };
        // Les empreintes connues : celles qu'Odin a écrites (registre), puis le journal des écritures (lot C4) pour ce disque.
        const connues = new Map<string, string>();
        for (const l of journal(ctx).tout()) if (l && l.cible === x.d.id && typeof l.dest === 'string' && relSur(l.dest) && typeof l.sha256 === 'string' && l.sha256) connues.set(l.dest, l.sha256);
        for (const k of x.f.retires ?? []) connues.delete(k);
        for (const [k, v] of Object.entries(x.f.empreintes ?? {})) connues.set(k, v);
        const t: Travail = { cle: id, disque: x.d.id, sorte: 'relire', debut: Date.now(), fait: 0, total: 1, etape: 'relecture', fini: false };
        TRAVAUX.set(id, t); CLES_OCCUPEES.add(x.d.id);
        const promesse = relireCle(x.io, connues, new Set(Object.keys(x.f.empreintes ?? {}))).then((r) => {
          const reg = registre(ctx), f = reg.lire().cles[id] ?? x.f;
          const ok = !r.differents.length && !r.manquants.length;
          const message = ok ? `${r.fichiers} fichier(s) relu(s) : aucune erreur${r.inconnus ? ` (${r.inconnus} sans empreinte connue)` : ''} · ${String(r.debitMo).replace('.', ',')} Mo/s en lecture.` : `${r.differents.length} fichier(s) différent(s), ${r.manquants.length} manquant(s) : refais ces systèmes depuis « Déployer ».`;
          reg.poser({ ...f, releve: { at: Date.now(), fichiers: r.fichiers, conformes: r.conformes, differents: r.differents, manquants: r.manquants, inconnus: r.inconnus, debitMo: r.debitMo }, dernier: { at: Date.now(), ok, message } });
          Object.assign(t, { fini: true, ok, message, fait: 1 });
          return r;
        }, (e: Error) => { Object.assign(t, { fini: true, ok: false, message: `Relecture interrompue : ${e.message}` }); }).finally(() => { CLES_OCCUPEES.delete(x.d.id); });
        PROMESSES.set(id, promesse);
        return { ok: true, text: `Odin relit « ${x.f.nom} » : rien n'est écrit.`, data: { cle: id } };
      },
    },
    {
      id: 'cle_mises_a_jour', label: 'Mes clés : mises à jour proposées', read: true, quick: false, proprietaireSeul: true, external: true,
      what: 'Ce qu\'Odin propose pour une clé connue (une ISO plus récente dans la bibliothèque, le menu à réécrire) et les images prêtes à ajouter ; rien n\'est fait tout seul',
      params: [{ key: 'cle', label: 'Identifiant ODIN de la clé', kind: 'text', required: true }],
      run: async (ctx, i) => {
        const id = st(i.cle);
        const f = registre(ctx).lire().cles[id];
        if (!f) return { ok: false, text: 'Cette clé n\'est pas connue d\'Odin.' };
        const biblio = await biblioDe(ctx);
        const sur = f.contenu?.systemes ?? [];
        const props = propositions({ systemes: sur as unknown as ContenuCle['systemes'] }, biblio);
        // Le menu : réécrit-on la même chose ? (seulement si la clé est branchée : on compare à ce qui est dessus)
        let menu: 'a-jour' | 'a-reecrire' | 'inconnu' = 'inconnu';
        const x = await retrouver(ctx, id, biblio);
        if (!('refus' in x) && x.c.id) {
          const fm = menuFinal(x.c, { retirer: [], ajouter: [], remplacer: [], arme: false, depuis: 0 }, biblio);
          const m = nouveauManifeste(x.c.id, x.c, fm, 0, 0);
          const voulu = buildMenuTexte(prepDuMenu(m), { installes: queueGrub(x.c.grubCfg) });
          menu = voulu === x.c.grubCfg ? 'a-jour' : 'a-reecrire';
        }
        const ajoutables = biblio.filter((b) => b.recipe && !sur.some((s) => s.fichier === fichierDeBiblio(b))).map((b) => {
          const e = entreeAjoutee(fichierDeBiblio(b), [{ iso: b.id, fichier: fichierDeBiblio(b), nom: nomAffiche(b.nom), taille: 0 }], [], biblio)!;
          let taille = 0; try { taille = statSync(b.chemin).size; } catch { /* inconnue */ }
          return { iso: b.id, nom: nomAffiche(b.nom), fichier: fichierDeBiblio(b), famille: e.famille, taille, defautPermis: defautPermis(e) };
        });
        return { ok: true, text: props.length ? props.map((p) => `- ${p.nomAncien} → ${p.nom} : une version plus récente est dans la bibliothèque`).join('\n') : 'Aucune mise à jour proposée pour cette clé.', data: { propositions: props, menu, ajoutables } };
      },
    },
  ];
  return { actions };
}
