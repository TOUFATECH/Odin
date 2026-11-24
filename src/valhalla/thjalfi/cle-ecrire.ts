// Genèse · clé USB — l'ORCHESTRATEUR de l'écriture de la clé, et les ACTIONS de l'onglet « Clé USB » greffées
// dans Genèse (cleUsb). La clé ODIN est un NOUVEAU MODE de Genèse, pas une appli à part : même nom, mêmes
// thèmes, mêmes recettes.
//
// Décision (voir AVANCEMENT, section 6) : on installe le binaire OFFICIEL de Ventoy (téléchargé depuis le dépôt
// officiel ventoy/Ventoy, empreinte SHA-256 vérifiée, passé par Asclépios avant usage, jamais modifié, licence
// GPLv3) puis on le personnalise par ventoy.json. On N'ÉCRIT PAS de nouveau code C.
//
// Tout ce qui écrit passe par une « IO » injectable : les essais lui donnent une version simulée (en mémoire, ou un
// dossier temporaire qui joue la partition ODIN d'un faux disque), et aucun vrai disque n'est touché, aucun service
// réel contacté. Lot C4 (la clé s'écrit de bout en bout) :
//  - le serveur n'écrit QUE sur un disque « choisissable » (disques.ts), dont le numéro de série et la taille sont
//    revérifiés JUSTE AVANT la première écriture ; la phrase tapée est vérifiée ici, jamais seulement dans la page ;
//  - chaque ISO est retrouvée par l'identifiant de SA bibliothèque, chaque logiciel dans celle d'Hermès : aucun chemin
//    venu de la page n'est lu ;
//  - les options Windows de l'étape 5 et tes scripts de l'étape 4 entrent dans les fichiers écrits, revérifiés ici
//    (analyse + antivirus), le disque du PC toujours choisi au moment d'installer ;
//  - l'écriture se suit par étapes nommées (cle_progres), s'annule (cle_annuler), et la clé s'éjecte (cle_ejecter).

import { createHash, randomBytes } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync, lstatSync, mkdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve, sep } from 'node:path';
import type { Action, ModCtx } from '../types.ts';
import { journalDe } from '../base/journal.ts';
import type { TextTheme } from './ecran.ts';
import { apercu, nomLogicielSur, optionsWindowsDe, osDuScript, scriptsRevus, nomCompteValide } from './scripts.ts';
import { familleLogiciel, installeAuto, logicielsPourSysteme, osDuSysteme, versScripts, type FicheLog } from './logiciels-cle.ts';
import { choisissable, classer, memeDisque, raisonNonChoisissable, sourceReelle, sourceSimulee, type Disque, type Disques, type SourceDisques } from './disques.ts';
import { planDualBoot, planRetrait, type Plan } from './cle-plan.ts';
import { analyserVdisk, type AnalyseVdisk } from './vdisk.ts';
// Le CONTRAT et les VRAIS constructeurs du lot B (plus aucun stub mort) : une seule source pour PreparationCle,
// un seul descripteur de Ventoy (empreinte vérifiée), et les constructeurs réellement appelés par l'écriture.
import type { LogicielCle, PlanPlace, PreparationCle, SourceVm, SystemeCle } from './cle-types.ts';
import { FICHIERS_ODIN } from './cle-types.ts';
import type { Recipe } from './recipes.ts';
import { buildVentoyJson, descripteurVentoy, reglagesDemarrage, type DescripteurVentoy } from './cle-boot.ts';
import { planWinToGo, specPersistance, commandePersistance, planInstallLinux } from './cle-install.ts';
import { listerVms, planCopieVm } from './cle-vm.ts';
import { cibleDepuisDisque, ciblesEcrivables, placeInstalle, planPlace, reserveGo } from './cle-cible.ts';
import { classerRacine, buildScriptScan } from './cle-racine.ts';
import { buildGrubTheme, buildMenuTexte } from './cle-grub.ts';
import { buildEcranOffline } from './ecran-offline.ts';
import { tarGz } from './ecran-pc.ts';

// On réexporte le contrat et le descripteur (une seule source), pour les appelants et les essais.
export type { PreparationCle, SystemeCle } from './cle-types.ts';
export { descripteurVentoy };
export type { DescripteurVentoy };

/** Les constructeurs fournis par le lot B (ventoy.json, thème GRUB, écran hors ligne). */
export interface BuildersCle {
  buildVentoyJson(prep: PreparationCle): string;
  buildGrubTheme(texte: TextTheme): Record<string, string>;
  buildEcranOffline(prep: PreparationCle): { fichiers: Record<string, string>; overlay: Buffer };
  /** lot C7 : le menu texte (/ventoy/ventoy_grub.cfg) ; absent : celui de cle-grub.ts */
  buildMenuTexte?(prep: PreparationCle, o: { installes?: string[] }): string;
}
/** Les VRAIS constructeurs du lot B, câblés par défaut (importés, exercés par les essais : plus de code mort). */
export const buildersParDefaut: BuildersCle = {
  buildVentoyJson,
  buildGrubTheme,
  buildMenuTexte,
  buildEcranOffline: (prep) => buildEcranOffline(etatFige(prep)),
};

/** L'état figé que lit l'écran hors ligne (même forme que /ecran/etat) : systèmes, thème, disposition. */
function etatFige(prep: PreparationCle) {
  return {
    systemes: prep.systemes.filter((s) => s.fichier).map((s) => ({ id: s.fichier, title: s.nom, category: s.famille, modes: [s.mode], color: '#5b8def', size: 0, version: '' })),
    disposition: String(prep.disposition), theme: String(prep.theme), dit: { _: 'Choisis un système à démarrer.' },
  };
}

// ---------------- L'IO (vraie ou simulée) ----------------
/** Ce que l'orchestrateur demande à l'IO ; la simulée ne touche à rien. */
export interface IoCle {
  /** installe ou met à jour Ventoy sur la clé (schéma GPT/MBR, support Secure Boot, place réservée aux Linux installés) ;
   *  une clé déjà ODIN est mise à jour sans tout effacer */
  installerVentoy(cible: string, desc: DescripteurVentoy, opt: { schema: 'gpt' | 'mbr'; secureBoot: boolean; miseAJour: boolean; reserveGo?: number }): Promise<void>;
  /** copie un fichier source dans la clé (chemin relatif à la 1re partition ODIN) ; rend son empreinte */
  copier(source: string, destRelatif: string, onProgress?: (recu: number, total: number) => void): Promise<string>;
  /** écrit un fichier généré (contenu en mémoire) sur la clé ; rend son empreinte */
  ecrire(destRelatif: string, contenu: string): Promise<string>;
  /** écrit un fichier BINAIRE généré (overlay Alpine, archive d'injection…) sur la clé ; rend son empreinte */
  ecrireBinaire(destRelatif: string, contenu: Buffer): Promise<string>;
  /** relit une empreinte déjà écrite (revérification) */
  empreinte(destRelatif: string): Promise<string>;
  /** l'écriture a-t-elle été annulée ? */
  annule(): boolean;
  /** lit un petit fichier source (un paquet .deb à glisser dans l'archive d'injection) ; absent : on ne l'y met pas */
  lire?(source: string, max: number): Promise<Buffer | undefined>;
  /** relecture C4 : pose sur la clé la marque « écriture en cours », relue avant chaque fichier (absente : IO simulée) */
  marquer?(): Promise<void>;
  /** relecture C4 : efface cette marque à la fin d'une écriture réussie */
  finir?(): Promise<void>;
  /** ce que cette IO sait faire ; absent : tout (IO simulée) */
  peut?: { installerChargeur: boolean; reserverPartitions: boolean };
  /** lot A : fabrique un VHDX Windows To Go (DISM /Apply-Image + bcdboot, posé dans /vdisk) ; rend son empreinte */
  creerVhdxWinToGo?(destRelatif: string, commandes: string[], onProgress?: (recu: number, total: number) => void): Promise<string>;
  /** lot A : crée un fichier de persistance Linux (mkfs ext, étiquette de la distribution) ; rend son empreinte */
  creerPersistance?(destRelatif: string, commandes: string[]): Promise<string>;
  /** lot A : copie le disque d'une VM (conversion + préparation) et le pose dans /vdisk ; rend son empreinte */
  copierDisqueVm?(source: string, destRelatif: string, onProgress?: (recu: number, total: number) => void): Promise<string>;
}

/** Une IO simulée pour les essais : garde tout en mémoire, calcule de vraies empreintes, ne touche à rien. */
export function ioSimulee(sources: Record<string, string> = {}): IoCle & { fichiers: Map<string, string>; ventoy?: { schema: string; secureBoot: boolean; miseAJour: boolean; reserveGo?: number } } {
  const fichiers = new Map<string, string>();
  const empreinteDe = (s: string) => createHash('sha256').update(s).digest('hex');
  const io = {
    fichiers, ventoy: undefined as { schema: string; secureBoot: boolean; miseAJour: boolean; reserveGo?: number } | undefined,
    async installerVentoy(_cible: string, _d: DescripteurVentoy, opt: { schema: 'gpt' | 'mbr'; secureBoot: boolean; miseAJour: boolean; reserveGo?: number }) { io.ventoy = { schema: opt.schema, secureBoot: opt.secureBoot, miseAJour: opt.miseAJour, reserveGo: opt.reserveGo ?? 0 }; },
    async copier(source: string, dest: string) { const c = sources[source] ?? `copie:${source}`; fichiers.set(dest, c); return empreinteDe(c); },
    async ecrire(dest: string, contenu: string) { fichiers.set(dest, contenu); return empreinteDe(contenu); },
    // Pour un binaire, on garde l'empreinte déjà calculée, marquée « h: » (pas de collision avec un contenu texte).
    async ecrireBinaire(dest: string, contenu: Buffer) { const h = createHash('sha256').update(contenu).digest('hex'); fichiers.set(dest, `h:${h}`); return h; },
    async empreinte(dest: string) { const v = fichiers.get(dest) ?? ''; return v.startsWith('h:') ? v.slice(2) : empreinteDe(v); },
    async lire(source: string) { return Buffer.from(sources[source] ?? `copie:${source}`, 'utf8'); },
    annule: () => false,
    // Lot A : les opérations lourdes, SIMULÉES (aucun vrai disque, aucune commande lancée) — on garde une empreinte du plan.
    async creerVhdxWinToGo(dest: string, commandes: string[]) { const c = `wintogo:${commandes.join('\n')}`; fichiers.set(dest, c); return empreinteDe(c); },
    async creerPersistance(dest: string, commandes: string[]) { const c = `persistance:${commandes.join('\n')}`; fichiers.set(dest, c); return empreinteDe(c); },
    async copierDisqueVm(source: string, dest: string) { const c = `vm:${source}`; fichiers.set(dest, c); return empreinteDe(c); },
  };
  return io;
}

/** L'empreinte SHA-256 d'un fichier, lue par morceaux ('' s'il n'existe pas). */
function empreinteFichier(chemin: string): Promise<string> {
  return new Promise((ok) => {
    if (!existsSync(chemin)) { ok(''); return; }
    const h = createHash('sha256'); const r = createReadStream(chemin);
    r.on('data', (b) => h.update(b)); r.on('end', () => ok(h.digest('hex'))); r.on('error', () => ok(''));
  });
}

/** La marque « écriture en cours » posée sur la clé (relecture C4). */
export const MARQUE = 'odin/ECRITURE-INCOMPLETE.txt';
/** Les noms que Windows réserve (CON, NUL, COM1…), même suivis d'une extension. */
const RESERVES = /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³]|conin\$|conout\$)(\.|$)/i;
/** Un morceau de chemin sûr sur la clé : ni nom réservé, ni « : » (flux caché), ni caractère interdit, ni point ou espace
 *  à la fin (Windows les retire sans rien dire). Pur. */
// eslint-disable-next-line no-control-regex
const morceauSur = (m: string) => !RESERVES.test(m) && !/[<>:"|?*\u0000-\u001f]/.test(m) && !/[. ]$/.test(m);

/**
 * Une IO qui écrit dans un DOSSIER : la 1re partition ODIN déjà montée (une clé déjà ODIN, mise à jour), ou, pour les
 * essais et l'aperçu, un dossier temporaire qui joue cette partition sur un faux disque. Aucune commande système, aucun
 * formatage, aucun accès brut à un disque : seulement des fichiers sous `racine`, jamais au-dessus.
 *  - chargeur « garder » : le chargeur déjà sur la clé est gardé ; installer sur une clé NEUVE est refusé (pas branché) ;
 *  - chargeur « simule » : faux disque d'essai — le chargeur est noté dans un fichier, les opérations lourdes aussi.
 */
export function ioDossier(racine: string, o: { chargeur: 'garder' | 'simule'; annule?: () => boolean }): IoCle & { racine: string } {
  const base = resolve(racine);
  const dedans = base.endsWith(sep) ? base : base + sep;
  const ici = (dest: string): string => {
    const r = String(dest ?? '').replace(/\\/g, '/');
    const morceaux = r.split('/');
    if (!r || isAbsolute(r) || /^[a-z]:/i.test(r) || morceaux.some((x) => x === '..' || x === '' || !morceauSur(x))) throw new Error(`chemin refusé sur la clé : ${r.slice(0, 120)}`);
    const p = resolve(base, r);
    if (!p.startsWith(dedans)) throw new Error(`chemin refusé sur la clé : ${r.slice(0, 120)}`);
    // Relecture C4 : aucun LIEN n'est suivi (jonction ou lien symbolique posés sur la clé, qui mèneraient hors de la
    // partition ODIN, vers le disque du système par exemple). Chaque morceau qui existe est lu SANS le suivre.
    let q = base;
    for (const m of morceaux) {
      q = join(q, m);
      let l; try { l = lstatSync(q); } catch { break; }
      if (l.isSymbolicLink()) throw new Error(`chemin refusé sur la clé : ${r.slice(0, 120)} (un lien mène ailleurs)`);
    }
    return p;
  };
  // Relecture C4 : la MARQUE d'écriture. Posée juste après la revérification de la clé, elle est relue avant CHAQUE
  // fichier : si la lettre de lecteur ou le point de montage désignent soudain un autre disque (clé débranchée, autre
  // disque branché à sa place), elle n'y est pas, et plus rien n'est écrit. Elle reste sur une clé annulée ou
  // interrompue (la clé dit elle-même qu'elle est incomplète) et s'efface à la fin d'une écriture réussie.
  let jeton = '';
  const garde = () => {
    if (!jeton) return;
    let lu = ''; try { lu = readFileSync(join(base, MARQUE), 'utf8'); } catch { /* absente */ }
    if (!lu.includes(jeton)) throw new Error('ce n\'est plus la même clé à cet endroit (débranchée, ou un autre disque a pris sa place) : Odin s\'arrête');
  };
  // ici() deux fois : avant de créer les dossiers (aucun dossier créé à travers un lien) et juste avant d'écrire.
  const poser = (dest: string, data: string | Buffer) => { garde(); const p = ici(dest); mkdirSync(dirname(p), { recursive: true }); ici(dest); writeFileSync(p, data); return createHash('sha256').update(data).digest('hex'); };
  const simule = o.chargeur === 'simule';
  const io: IoCle & { racine: string } = {
    racine: base,
    async marquer() {
      const id = randomBytes(16).toString('hex');
      jeton = '';
      poser(MARQUE, `Écriture d'Odin en cours ou interrompue : cette clé est INCOMPLÈTE. Recommence l'écriture depuis Odin.\n${id}\n`);
      jeton = id;
    },
    async finir() { garde(); jeton = ''; try { unlinkSync(ici(MARQUE)); } catch { /* déjà absente */ } },
    peut: { installerChargeur: simule, reserverPartitions: simule },
    async installerVentoy(cible, desc, opt) {
      if (!simule) {
        if (!opt.miseAJour) throw new Error('installer le chargeur sur une clé neuve n\'est pas encore branché ici');
        return; // clé déjà ODIN : son chargeur est gardé tel quel, seuls les fichiers changent
      }
      mkdirSync(base, { recursive: true });
      poser('ventoy/odin-chargeur-essai.json', `${JSON.stringify({ essai: true, note: 'faux disque : aucun vrai chargeur installé', cible, version: desc.version, schema: opt.schema, secureBoot: opt.secureBoot, miseAJour: opt.miseAJour, reserveGo: opt.reserveGo ?? 0 }, null, 2)}\n`);
    },
    copier(source, dest, onProgress) {
      return new Promise((ok, ko) => {
        if (!isAbsolute(source) || !existsSync(source) || !statSync(source).isFile()) { ko(new Error('fichier source introuvable')); return; }
        let p: string;
        try { garde(); p = ici(dest); mkdirSync(dirname(p), { recursive: true }); ici(dest); } catch (e) { ko(e as Error); return; }
        const total = statSync(source).size, h = createHash('sha256'); let recu = 0;
        const r = createReadStream(source), w = createWriteStream(p);
        r.on('data', (b) => { h.update(b); recu += b.length; onProgress?.(recu, total); if (o.annule?.()) r.destroy(new Error('annulée')); });
        r.on('error', (e) => { w.destroy(); ko(e); }); w.on('error', ko);
        w.on('finish', () => ok(h.digest('hex')));
        r.pipe(w);
      });
    },
    async ecrire(dest, contenu) { return poser(dest, contenu); },
    async ecrireBinaire(dest, contenu) { return poser(dest, contenu); },
    async empreinte(dest) { return empreinteFichier(ici(dest)); },
    async lire(source, max) { try { if (!isAbsolute(source) || statSync(source).size > max) return undefined; return readFileSync(source); } catch { return undefined; } },
    annule: () => Boolean(o.annule?.()),
    ...(simule ? {
      async creerVhdxWinToGo(dest: string, commandes: string[]) { return poser(dest, `essai : disque Windows installé NON fabriqué (faux disque)\n${commandes.join('\n')}\n`); },
      async creerPersistance(dest: string, commandes: string[]) { return poser(dest, `essai : fichier de persistance NON formaté (faux disque)\n${commandes.join('\n')}\n`); },
      async copierDisqueVm(source: string, dest: string) { return poser(dest, `essai : disque de VM NON copié (faux disque) depuis ${source}\n`); },
    } : {}),
  };
  return io;
}

// ---------------- L'orchestrateur ----------------
export interface LigneJournalCle { at: number; dest: string; sha256: string; octets?: number }
export interface ResultatEcriture { ok: boolean; message: string; manifeste: LigneJournalCle[]; /** vrai : au moins un octet a été écrit sur la clé */ touchee?: boolean }
/** Les ÉTAPES NOMMÉES de l'écriture (les mots sont dans la page) ; cle_progres dit laquelle est en cours. */
export const PHASES = ['verifier', 'chargeur', 'systemes', 'logiciels', 'installes', 'menu', 'scripts', 'controle'] as const;
export type Phase = typeof PHASES[number];
export interface Avancement { etape: string; fait: number; total: number; phase?: Phase }

/** La disposition des fichiers sur la 1re partition ODIN (contrat, section 2). */
export const DOSSIER = { iso: 'ISO', vdisk: 'vdisk', persistence: 'persistence', logicielsWindows: 'logiciels/windows', logicielsLinux: 'logiciels/linux', ventoy: 'ventoy', ecran: 'ecran-odin', odin: 'odin' } as const;

/** Un nom de fichier SANS chemin, sûr sur la clé et dans ventoy.json (lettres, chiffres, . _ + -). Pur. */
export const nomFichierSur = (n: unknown): boolean => typeof n === 'string' && /^[\w+-][\w.+-]{0,199}$/.test(n) && !n.includes('..');
/** Le plus gros paquet .deb glissé dans l'archive d'injection (un plus gros reste copié, à installer à la main). */
const MAX_DEB = 64 * 1024 * 1024;

/**
 * Écrit la clé : installe/met à jour Ventoy, copie les systèmes, images, disques virtuels et logiciels, pose
 * ventoy.json, le thème GRUB, l'écran hors ligne et les scripts, puis revérifie les empreintes et journalise.
 * Tout passe par l'IO : les essais lui donnent une version simulée. Annulable (io.annule).
 */
/** Les options d'écriture : la cible, le compte, la langue / le clavier / le fuseau repris d'Odin, et si la cible est
 *  déjà une clé ODIN ; et (lot C4) la revérification de la clé, les sources retrouvées côté serveur, les options des
 *  étapes 4 et 5, l'antivirus, la clé d'activation du coffre. */
export interface OptionsEcriture {
  cible: string; sources?: Record<string, string>; token?: string;
  /** un mot de passe d'administration (jamais une valeur par défaut connue) — requis, mais JAMAIS écrit sur la clé :
   *  Windows et Linux demandent le leur à la première ouverture de session (scripts.ts) */
  motDePasse?: string;
  /** le nom du compte Linux (repris d'Odin) ; défaut : « odin » */
  compte?: string;
  locale?: string; keymap?: string; timezone?: string;
  /** vrai si la cible est DÉJÀ une clé ODIN (Disque.estOdin) → mise à jour non destructive ; faux → installation */
  cibleEstOdin?: boolean;
  onProgress?: (a: Avancement) => void;
  /** C4 : revérifie la clé JUSTE AVANT la première écriture (rend la raison d'un refus, ou rien) */
  verifierCible?: () => Promise<string | undefined>;
  /** C4 : appelé une fois, juste avant le premier octet écrit */
  onTouche?: () => void;
  /** C4 : le fichier source d'un système, retrouvé dans la bibliothèque du SERVEUR (jamais un chemin de la page) */
  sourceIso?: (s: SystemeCle) => string | undefined;
  /** C4 : le fichier source d'un logiciel, retrouvé dans la bibliothèque d'Hermès */
  sourceLogiciel?: (l: LogicielCle) => string | undefined;
  /** C4 : les options de l'étape 5 (brutes : revues ici, le disque toujours choisi au moment d'installer) */
  windows?: unknown;
  /** C4 : tes scripts de l'étape 4 (bruts : revérifiés ici, antivirus compris) */
  scripts?: unknown;
  /** C4 : l'antivirus d'Odin sur un script (rend une raison s'il est dangereux) ; requis s'il y a des scripts */
  antivirus?: (nom: string, contenu: string) => string | undefined;
  /** C4 : la clé d'activation du coffre pour une image Windows (jamais rendue à la page) */
  cleActivation?: (s: SystemeCle) => string | undefined;
  /** C4 : le plan de place calculé avant d'écrire (la place réservée aux Linux installés en vient) */
  plan?: PlanPlace;
}

/** Ce qu'il faut savoir faire pour écrire ce choix, et que cette IO ne sait pas faire : rien = tout est possible. Pur. */
function manques(prep: PreparationCle, io: IoCle, o: OptionsEcriture): string[] {
  const m: string[] = [];
  if (io.peut && !io.peut.installerChargeur && !o.cibleEstOdin) m.push('installer le chargeur de démarrage sur une clé neuve');
  for (const s of prep.systemes) {
    const p = placeInstalle(s);
    if (p?.role === 'WinToGo' && !io.creerVhdxWinToGo) m.push(`fabriquer le Windows installé « ${s.nom} »`);
    if (p?.role === 'Linux installé' && io.peut && !io.peut.reserverPartitions) m.push(`réserver la partition du Linux installé « ${s.nom} »`);
    if (p?.role === 'persistance' && !io.creerPersistance) m.push(`créer la mémoire de « ${s.nom} »`);
    if ((s.choix ?? 'iso') === 'vm' && !io.copierDisqueVm) m.push(`copier la machine virtuelle « ${s.nom} »`);
  }
  return m;
}

export async function ecrireCle(
  prep: PreparationCle,
  io: IoCle,
  builders: BuildersCle,
  o: OptionsEcriture = { cible: 'ODIN' },
): Promise<ResultatEcriture> {
  const manifeste: LigneJournalCle[] = [];
  let touchee = false;
  const refus = (message: string): ResultatEcriture => ({ ok: false, message, manifeste, touchee });
  // Sécurité : jamais de mot de passe par défaut connu (dépôt public). Il n'est de toute façon jamais écrit sur la clé.
  if (!o.motDePasse) return refus('Écriture refusée : aucun mot de passe d\'administration fourni (il vient du coffre ou du propriétaire, jamais une valeur par défaut connue).');
  const token = o.token ?? 'cle';
  // Les noms posés sur la clé et dans ventoy.json : des noms de fichier SANS chemin (jamais « .. », « / », « C: »).
  const noms = [...prep.systemes.filter((s) => (s.choix ?? 'iso') !== 'vm').map((s) => s.fichier), ...prep.images, ...prep.vdisks.map((v) => v.fichier)];
  const mauvais = noms.find((n) => !nomFichierSur(n));
  if (mauvais !== undefined) return refus(`Écriture refusée : « ${String(mauvais).slice(0, 80)} » n'est pas un nom de fichier sûr. Rien n'a été écrit.`);
  // Chaque source est retrouvée par le serveur AVANT d'écrire quoi que ce soit.
  const sourceDe = (s: SystemeCle) => (o.sourceIso ? o.sourceIso(s) : s.fichier);
  const sansSource = prep.systemes.find((s) => (s.choix ?? 'iso') !== 'vm' && !sourceDe(s));
  if (sansSource) return refus(`Écriture refusée : « ${sansSource.nom} » n'est pas dans la bibliothèque d'Odin. Rien n'a été écrit.`);
  const sourceLog = (l: LogicielCle) => (o.sourceLogiciel ? o.sourceLogiciel(l) : l.fichier);
  const logSans = prep.logiciels.find((l) => !sourceLog(l));
  if (logSans) return refus(`Écriture refusée : le logiciel « ${logSans.id} » n'est pas dans la bibliothèque d'Hermès. Rien n'a été écrit.`);
  // Tes scripts : revérifiés ICI (la page peut avoir été trafiquée) ; sans antivirus, aucun script n'est écrit.
  const bruts = Array.isArray(o.scripts) ? o.scripts : [];
  if (bruts.length && !o.antivirus) return refus('Écriture refusée : l\'antivirus d\'Odin n\'est pas là pour revérifier tes scripts. Rien n\'a été écrit.');
  const revus = scriptsRevus(bruts, o.antivirus);
  const refuses = revus.verdicts.filter((v) => !v.ok);
  if (refuses.length) return refus(`Écriture refusée : ${refuses.map((v) => `« ${v.nom} » (${v.raison ?? 'refusé'})`).join(', ')}. Retire-le à l'étape « Logiciels et scripts ». Rien n'a été écrit.`);
  const manque = manques(prep, io, o);
  if (manque.length) return refus(`Pas encore possible ici : ${manque.join(', ')}. Rien n'a été écrit.`);

  // Les systèmes INSTALLÉS / copiés du lot A (Windows To Go, persistance, copie de VM) : une étape lourde chacun.
  const nbInstalles = prep.systemes.filter((s) => ['installe', 'persistance', 'vm'].includes(s.choix ?? 'iso')).length;
  const aCopier = prep.systemes.filter((s) => (s.choix ?? 'iso') !== 'vm');
  // Le total des étapes, pour une barre de progression honnête.
  const total = 2 + aCopier.length + prep.images.length + prep.vdisks.length + prep.logiciels.length + nbInstalles + 4 + prep.systemes.length;
  let fait = 0;
  const avance = (phase: Phase, etape: string) => { fait++; o.onProgress?.({ etape, fait, total, phase }); };
  const annulee = () => io.annule();
  const ANNULEE_RIEN = 'Écriture annulée : rien n\'avait encore été écrit sur la clé.';
  const ANNULEE_TOUCHEE = 'Écriture annulée : la clé est en partie écrite (incomplète) et ne démarrera pas tant que tu ne recommences pas.';
  let ANNULEE = ANNULEE_RIEN;
  // Relecture C4 : la clé est REVÉRIFIÉE (toujours branchée, même numéro de série, même taille, toujours choisissable)
  // avant chaque système et chaque logiciel copiés et avant chaque étape : la vérification d'avant le premier octet ne
  // suffit pas pour une écriture de plusieurs minutes. (La marque d'écriture, elle, est relue avant chaque fichier.)
  const garde = async () => {
    const r = o.verifierCible ? await o.verifierCible() : undefined;
    if (r) throw new Error(`${r} Odin s'arrête`);
  };
  const noter = async (dest: string, sha256: string) => { manifeste.push({ at: Date.now(), dest, sha256 }); };

  try {
    // 0) La clé est revérifiée JUSTE AVANT d'écrire : toujours là, toujours choisissable, même numéro de série, même taille.
    o.onProgress?.({ etape: 'revérification de la clé', fait, total, phase: 'verifier' });
    const r0 = o.verifierCible ? await o.verifierCible() : undefined;
    if (r0) return refus(`Écriture refusée : ${r0} Rien n'a été écrit.`);
    if (annulee()) return refus(ANNULEE);
    avance('verifier', 'clé revérifiée');

    // 1) Ventoy (binaire officiel vérifié, jamais modifié) — une clé déjà ODIN est mise à jour sans tout effacer. La place
    //    des Linux installés est réservée à part (un seul calcul : planPlace / placeInstalle).
    o.onTouche?.(); touchee = true; ANNULEE = ANNULEE_TOUCHEE;
    await io.marquer?.();
    const reserve = o.plan ? reserveGo(o.plan) : prep.systemes.map(placeInstalle).filter((p) => p?.lieu === 'partition').reduce((n, p) => n + (p?.tailleGo ?? 0), 0);
    await io.installerVentoy(o.cible, descripteurVentoy(), { schema: prep.schema, secureBoot: prep.secureBoot, miseAJour: o.cibleEstOdin ?? false, reserveGo: reserve });
    avance('chargeur', 'chargeur de démarrage');
    if (annulee()) return refus(ANNULEE);

    // 2) Les systèmes (ISO) dans /ISO/, lus depuis la bibliothèque du serveur.
    for (const s of aCopier) {
      if (annulee()) return refus(ANNULEE);
      await garde();
      const dest = `${DOSSIER.iso}/${s.fichier}`;
      await noter(dest, await io.copier(sourceDe(s)!, dest));
      avance('systemes', `Système : ${s.nom}`);
    }
    // 3) Les autres images dans /ISO/.
    for (const img of prep.images) { if (annulee()) return refus(ANNULEE); const dest = `${DOSSIER.iso}/${img}`; await noter(dest, await io.copier(img, dest)); avance('systemes', `Image : ${img}`); }
    // 4) Les disques virtuels dans /vdisk/.
    for (const v of prep.vdisks) { if (annulee()) return refus(ANNULEE); const dest = `${DOSSIER.vdisk}/${v.fichier}`; await noter(dest, await io.copier(v.fichier, dest)); avance('systemes', `Disque virtuel : ${v.fichier}`); }
    // 5) Les logiciels dans /logiciels/windows ou /logiciels/linux (selon LEUR système), sous le MÊME nom assaini que
    //    celui que lance le script de fin (nomLogicielSur).
    for (const l of prep.logiciels) {
      if (annulee()) return refus(ANNULEE);
      await garde();
      const linux = /^linux/.test(familleLogiciel(l.fichier));
      const dest = `${linux ? DOSSIER.logicielsLinux : DOSSIER.logicielsWindows}/${nomLogicielSur(l.fichier)}`;
      await noter(dest, await io.copier(sourceLog(l)!, dest));
      avance('logiciels', `Logiciel : ${l.id}`);
    }

    // 5b) Les VRAIS systèmes installés / copiés du lot A : Windows To Go, persistance Linux, copie d'un disque de
    //     VM. Chaque opération lourde passe DERRIÈRE l'IO injectée (simulée en test : aucun vrai disque touché). Le
    //     chemin de chaque fichier vient de placeInstalle : le même que celui du plan.
    const grubInstalles: string[] = [];
    for (const sy of prep.systemes) {
      if (annulee()) return refus(ANNULEE);
      if (['installe', 'persistance', 'vm'].includes(sy.choix ?? 'iso')) await garde();
      const choix = sy.choix ?? 'iso';
      const p = placeInstalle(sy);
      if (p?.role === 'WinToGo' && io.creerVhdxWinToGo) {
        const plan = planWinToGo(sy.fichier, sy.nom, { tailleGo: p.tailleGo });
        await noter(p.fichier!, await io.creerVhdxWinToGo(p.fichier!, plan.commandes));
        avance('installes', `Windows installé : ${sy.nom}`);
      } else if (p?.role === 'Linux installé') {
        // Linux installé complet : l'entrée GRUB chainload (planInstallLinux) rejoint le menu natif de Ventoy
        // (ventoy_grub.cfg, écrit après la boucle), dans la place réservée par le chargeur.
        grubInstalles.push(planInstallLinux(sy).grubEntree);
        avance('installes', `Linux installé : ${sy.nom}`);
      } else if (p?.role === 'persistance' && io.creerPersistance) {
        const spec = sy.persistance ? { ...sy.persistance, conf: sy.persistance.conf ?? false } : specPersistance(sy.fichier);
        await noter(p.fichier!, await io.creerPersistance(p.fichier!, commandePersistance(spec, p.fichier!)));
        avance('installes', `Mémoire : ${sy.nom}`);
      } else if (choix === 'vm' && sy.vmSource && io.copierDisqueVm) {
        const plan = planCopieVm(sy.vmSource);
        if (plan.possible && plan.destination) {
          const dest = `${DOSSIER.vdisk}/${plan.destination.replace(/^.*\//, '')}`;
          await noter(dest, await io.copierDisqueVm(sy.vmSource.disque ?? sy.vmSource.nom, dest));
          avance('installes', `Copie VM : ${sy.vmSource.nom}`);
        }
      }
    }
    // Lot C7 : le menu TEXTE d'Odin (touche F6 de Ventoy, ouvert tout seul en mode texte), TOUJOURS écrit : sans lui, le
    // mode texte renverrait vers un menu absent. Les entrées chainload des Linux installés y sont gardées, à la fin.
    if (annulee()) return refus(ANNULEE);
    await garde();
    const menuTexte = (builders.buildMenuTexte ?? buildMenuTexte)(prep, { installes: grubInstalles });
    await noter(`${DOSSIER.ventoy}/ventoy_grub.cfg`, await io.ecrire(`${DOSSIER.ventoy}/ventoy_grub.cfg`, menuTexte));

    // 6) ventoy.json (greffons, thème, menu, auto-install, injection des scripts).
    if (annulee()) return refus(ANNULEE);
    await garde();
    await noter(`${DOSSIER.ventoy}/ventoy.json`, await io.ecrire(`${DOSSIER.ventoy}/ventoy.json`, builders.buildVentoyJson(prep)));
    avance('menu', 'menu de démarrage');
    // 7) Le thème GRUB aux couleurs du thème choisi.
    for (const [nom, contenu] of Object.entries(builders.buildGrubTheme(prep.texte))) await noter(`${DOSSIER.ventoy}/theme/odin/${nom}`, await io.ecrire(`${DOSSIER.ventoy}/theme/odin/${nom}`, contenu));
    avance('menu', 'thème du menu');
    // 8) L'écran d'Odin hors ligne (copie de /ecran + systemes.json figés + overlay Alpine BINAIRE).
    const eo = builders.buildEcranOffline(prep);
    for (const [nom, contenu] of Object.entries(eo.fichiers)) await noter(`${DOSSIER.ecran}/${nom}`, await io.ecrire(`${DOSSIER.ecran}/${nom}`, contenu));
    await noter(`${DOSSIER.ecran}/odin-ecran.apkovl.tar.gz`, await io.ecrireBinaire(`${DOSSIER.ecran}/odin-ecran.apkovl.tar.gz`, eo.overlay));
    avance('menu', 'écran d\'Odin hors ligne');

    // 9) Les scripts d'installation par système (montrés avant par la page), aux NOMS que ventoy.json référence
    //    (FICHIERS_ODIN) ; et l'archive d'injection que Ventoy pose dans le système d'installation : tes scripts et les
    //    paquets .deb y sont, à l'endroit exact que lisent les commandes de fin (scripts.ts, RACINE_INJECTEE).
    await garde();
    for (const s of prep.systemes) {
      if (annulee()) return refus(ANNULEE);
      if (!s.fichier) { avance('scripts', `Scripts : ${s.nom}`); continue; }
      const scripts = scriptsDe(s, prep, token, o, revus.acceptes);
      for (const [nom, contenu] of Object.entries(scripts)) await noter(`${DOSSIER.odin}/${nom}`, await io.ecrire(`${DOSSIER.odin}/${nom}`, contenu));
      if (s.mode === 'installer') {
        const base = s.fichier.replace(/\.[^.]+$/, '');
        const debs: Array<{ nom: string; data: Buffer }> = [];
        if (s.recipe.os !== 'windows' && io.lire) {
          for (const l of prep.logiciels.filter((x) => installeAuto(x.id, x.fichier) === 'linux' && familleLogiciel(x.fichier) === 'linux-deb')) {
            const b = await io.lire(sourceLog(l)!, MAX_DEB);
            if (b) debs.push({ nom: l.fichier, data: b });
          }
        }
        await noter(`${DOSSIER.odin}/inject-${base}.tar.gz`, await io.ecrireBinaire(`${DOSSIER.odin}/inject-${base}.tar.gz`, archiveInjection(scripts, debs)));
      }
      avance('scripts', `Scripts : ${s.nom}`);
    }

    // 9b) L'indexeur « odin-scan » posé dans /odin : lancé au démarrage, il range au menu TOUT fichier déposé à la
    //     racine de la clé (ISO, disque de VM, image). Sans lui, un simple dépôt à la racine n'apparaîtrait pas au menu.
    await noter(`${DOSSIER.odin}/${FICHIERS_ODIN.odinScan}`, await io.ecrire(`${DOSSIER.odin}/${FICHIERS_ODIN.odinScan}`, buildScriptScan()));

    // 10) Revérification des empreintes.
    o.onProgress?.({ etape: 'relecture de tout ce qui est écrit', fait, total, phase: 'controle' });
    if (annulee()) return refus(ANNULEE);
    await garde();
    for (const m of manifeste) { const h = await io.empreinte(m.dest); if (h !== m.sha256) return refus(`Vérification : ${m.dest} ne correspond pas à son empreinte. La clé est en partie écrite (incomplète).`); }
    // Tout est relu : la marque « écriture incomplète » est retirée de la clé.
    await io.finir?.();
    avance('controle', 'tout est relu');
    return { ok: true, message: `Clé ODIN prête : ${prep.systemes.length} système(s), ${prep.vdisks.length} disque(s) virtuel(s), ${prep.logiciels.length} logiciel(s). Toutes les empreintes vérifiées.`, manifeste, touchee };
  } catch (e) {
    const msg = (e as Error).message;
    if (/annul/i.test(msg)) return refus(ANNULEE);
    return refus(`Écriture interrompue : ${msg}.${touchee ? ' La clé est en partie écrite (incomplète) : elle ne démarrera pas tant que tu ne recommences pas.' : ' Rien n\'a été écrit.'}`);
  }
}

/** Les scripts d'un système (réutilise scripts.ts) avec les options de l'étape 5 et tes scripts revus de l'étape 4.
 *  Les noms de fichiers suivent le contrat (FICHIERS_ODIN) que ventoy.json référence (auto_install). Pur. */
function scriptsDe(s: SystemeCle, prep: PreparationCle, token: string, o: OptionsEcriture, mesScripts: Array<{ nom: string; contenu: string }>): Record<string, string> {
  // Chaque système ne reçoit que SES logiciels (filtrés par OS), et on ne lance en silencieux que ceux dont le mode
  // est connu : un installateur Windows va au script Windows, un paquet Linux (.deb) aux commandes de fin Linux ; les
  // autres sont copiés sur la clé mais pas promis en silencieux (logiciels-cle.ts).
  const pour = versScripts(prep.logiciels.map((l) => ({ id: l.id, fichier: l.fichier })));
  if (s.recipe.os === 'windows') {
    // Les options de l'étape 5, le disque TOUJOURS choisi au moment d'installer (forcé dans optionsWindowsDe).
    const opt = optionsWindowsDe(o.windows);
    const cle = o.cleActivation?.(s);
    const user = nomCompteValide(opt.nomCompte ?? '') ? String(opt.nomCompte) : 'Odin';
    return apercu({ famille: 'windows', answer: { ...answerDe(prep, o, user), ...(cle ? { productKey: cle } : {}) }, fw: prep.schema === 'mbr' ? 'bios' : 'uefi', opt, logiciels: pour.windows, scripts: mesScripts.filter((x) => osDuScript(x.nom) === 'windows') });
  }
  const famille = s.recipe.kind === 'debian' ? 'debian' : s.recipe.kind === 'rhel' ? 'rhel' : 'ubuntu';
  const scripts = apercu({ famille, answer: answerDe(prep, o), token, debsCle: pour.debs, scripts: mesScripts.filter((x) => osDuScript(x.nom) === 'linux') });
  // Aligner le nom du kickstart sur le contrat (ventoy.json pointe vers FICHIERS_ODIN.kickstart).
  if (scripts['ks.cfg'] !== undefined) { scripts[FICHIERS_ODIN.kickstart] = scripts['ks.cfg']; delete scripts['ks.cfg']; }
  return scripts;
}
/** Les réponses d'installation hors ligne : le compte (le mot de passe n'est JAMAIS écrit : il est choisi à la première
 *  ouverture de session), langue / clavier / fuseau repris d'Odin. Pur. */
function answerDe(prep: PreparationCle, o: OptionsEcriture, user?: string): Parameters<typeof apercu>[0]['answer'] {
  const u = user ?? (o.compte && o.compte.trim() ? o.compte.trim() : 'odin');
  return { host: 'odin-pc', user: u, password: '', locale: o.locale ?? 'fr_FR.UTF-8', keymap: o.keymap ?? 'fr', timezone: o.timezone ?? 'Europe/Paris', packages: [], report: 'http://127.0.0.1/etat/cle', software: prep.logiciels.map((l) => ({ name: l.id, url: l.fichier, args: l.args, msi: l.msi })) };
}
/** L'archive d'injection d'un système (ce que Ventoy pose dans le système d'installation, sous /odin) : les scripts de
 *  fin et tes scripts, et les paquets .deb, sauf l'autounattend qui, lui, est injecté séparément comme fichier de
 *  réponses. Pur (tar déterministe). */
function archiveInjection(scripts: Record<string, string>, debs: Array<{ nom: string; data: Buffer }> = []): Buffer {
  const entrees: Array<{ name: string; data: string | Buffer }> = Object.entries(scripts)
    .filter(([n]) => n !== FICHIERS_ODIN.autounattend)
    .map(([name, data]) => ({ name: `odin/${name}`, data }));
  for (const d of debs) if (/^[\w.+-]{1,200}\.deb$/.test(d.nom)) entrees.push({ name: `odin/logiciels/${d.nom}`, data: d.data });
  return tarGz(entrees.length ? entrees : [{ name: 'odin/.keep', data: '' }]);
}

// ---------------- La phrase à taper ----------------
const GIO = 1024 ** 3;
/** Le texte comparé : sans accents, minuscules, espaces simples. Pur. */
export const phraseNormale = (x: unknown) => String(x ?? '').normalize('NFD').replace(/\p{M}+/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();
/**
 * La PHRASE EXACTE à taper avant d'écrire (vérifiée ICI, côté serveur) : « effacer la clé 58 go » quand tout est
 * effacé, « écrire sur la clé 58 go » pour une mise à jour d'une clé déjà ODIN. Le nombre est celui que montre la page
 * (Go arrondis). Pur.
 */
export function phraseAttendue(d: Pick<Disque, 'genre' | 'tailleOctets'>, efface: boolean): string {
  const quoi = d.genre === 'cle' ? 'la clé' : 'le disque';
  const n = Math.max(1, Math.round((Number(d.tailleOctets) || 0) / GIO));
  return efface ? `effacer ${quoi} ${n} go` : `écrire sur ${quoi} ${n} go`;
}

// ---------------- Les écritures en cours (suivi, annulation) ----------------
export interface EtatEcriture {
  cible: string; debut: number; phase: Phase; etape: string; fait: number; total: number;
  /** vrai : au moins un octet a été écrit sur la clé (l'annuler la laisse alors incomplète) */
  touchee: boolean; annuler: boolean; fini: boolean; ok?: boolean; message?: string; serie?: string;
}
const ECRITURES = new Map<string, EtatEcriture>();
const PROMESSES = new Map<string, Promise<ResultatEcriture>>();
/** Pour les essais : attend la fin d'une écriture lancée en arrière-plan (rien si aucune). */
export function attendreEcriture(id: string): Promise<ResultatEcriture | undefined> { return PROMESSES.get(id) ?? Promise.resolve(undefined); }
const enCours = (id: string) => { const e = ECRITURES.get(id); return Boolean(e && !e.fini); };
/** Les clés éjectées en mode essai (faux disques) : aucune commande n'est lancée. */
const EJECTEES_ESSAI = new Set<string>();

// ---------------- Les actions de l'onglet « Clé USB » ----------------
/** Mode essai : la liste des disques est fausse (settings.cleDisquesTest) ; rien ne touche un vrai disque. */
const modeEssai = (ctx: ModCtx) => Array.isArray(ctx.settings.cleDisquesTest);
/** La source des disques : réelle sur la machine, ou simulée si Genèse est en mode essai (settings.cleDisquesTest). */
function sourceDe(ctx: ModCtx): SourceDisques {
  const faux = ctx.settings.cleDisquesTest as Disque[] | undefined;
  if (Array.isArray(faux)) return sourceSimulee(faux);
  return sourceReelle(process.platform, async (cmd, args) => (await ctx.run(cmd, args, { timeoutMs: 30_000 })).out);
}

/** Une image de la bibliothèque d'Odin (le serveur la connaît ; la page n'en envoie que l'identifiant). */
export interface IsoBiblio { id: string; nom: string; chemin: string; recipe?: Recipe }
/** Ce que Genèse donne aux actions de la clé (absent dans les essais qui n'en ont pas besoin). */
export interface DepsCle {
  /** les images PRÊTES de la bibliothèque (complètes, passées par l'antivirus) */
  bibliotheque?: (ctx: ModCtx) => Promise<IsoBiblio[]>;
  /** l'antivirus d'Odin sur un script */
  antivirus?: (nom: string, contenu: string) => string | undefined;
  /** la clé d'activation du coffre pour une image Windows (jamais rendue à la page) */
  cleActivation?: (ctx: ModCtx, fichier: string, nom: string) => string | undefined;
  /** le profil d'installation (compte Linux, langue, clavier, fuseau) */
  profil?: (ctx: ModCtx) => { utilisateur: string; langue: string; clavier: string; fuseau: string } | undefined;
}

const o = (x: unknown): Record<string, unknown> => (x && typeof x === 'object' && !Array.isArray(x) ? x as Record<string, unknown> : {});
const st = (x: unknown) => (typeof x === 'string' ? x : x === undefined || x === null ? '' : String(x));
/** Relecture C4 : le NOM d'un système tel qu'il entre au menu de démarrage (GRUB, ventoy.json) et dans les commandes :
 *  sans retour à la ligne, guillemet, antislash, $, accolade ni caractère de commande (la page peut avoir été trafiquée,
 *  un nom de VM peut être n'importe quoi). Lettres de toutes les langues gardées. Pur. */
export const nomAffiche = (x: unknown) => st(x).normalize('NFC').replace(/[^\p{L}\p{N} ._+()-]+/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
/** L'identifiant de la cible envoyé par la page (objet { id, serie, tailleOctets } ou, en secours, un texte). */
const idDeCible = (c: unknown) => st(c && typeof c === 'object' ? (c as { id?: unknown }).id : c).slice(0, 120);

/** Les logiciels téléchargés (bibliothèque d'Hermès) ; absente : liste vide, aucune promesse. */
async function fichesHermes(ctx: ModCtx): Promise<FicheLog[]> {
  try { return (((await ctx.call('fjalar', 'etat', {}, 'logiciels téléchargés à coller sur la clé', { interne: true })).data as { fichiers?: FicheLog[] } | undefined)?.fichiers) ?? []; } catch { return []; }
}
const fichierFiche = (f: FicheLog) => f.fichier ?? (f.chemin ?? '').replace(/\\/g, '/').split('/').pop() ?? '';

/**
 * Ce que la page a composé, REFAIT côté serveur : chaque ISO retrouvée dans la bibliothèque par son identifiant (ou son
 * nom exact), chaque logiciel dans celle d'Hermès, chaque VM dans la liste d'Hydre ; la recette vient de l'ISO, jamais
 * de la page. Rend la préparation et les sources, ou la raison d'un refus.
 */
async function refaireChoix(ctx: ModCtx, deps: DepsCle, brut: unknown): Promise<{ systemes: SystemeCle[]; sources: Map<SystemeCle, string>; logiciels: LogicielCle[]; sourcesLog: Map<string, string> } | { refus: string }> {
  const liste = (Array.isArray(brut) ? brut : []).slice(0, 40).map(o);
  if (!liste.length) return { refus: 'Choisis au moins un système (étape « Systèmes »).' };
  const biblio = deps.bibliotheque ? await deps.bibliotheque(ctx) : [];
  const fiches = liste.some((x) => Array.isArray(x.logiciels) && x.logiciels.length) ? await fichesHermes(ctx) : [];
  const vms = liste.some((x) => x.choix === 'vm') ? await listerVms(ctx).catch(() => [] as SourceVm[]) : [];
  const systemes: SystemeCle[] = [], sources = new Map<SystemeCle, string>(), logiciels: LogicielCle[] = [], sourcesLog = new Map<string, string>();
  for (const x of liste) {
    const choix = (['iso', 'installe', 'persistance', 'vm'] as const).find((c) => c === x.choix) ?? 'iso';
    if (choix === 'vm') {
      const v = o(x.vmSource);
      const vm = vms.find((m) => m.origine === v.origine && st(m.vmid) === st(v.vmid) && st(m.serveur) === st(v.serveur));
      if (!vm || !vm.disque) return { refus: `La machine virtuelle « ${st(v.nom || x.nom).slice(0, 80)} » n'est pas (ou plus) lisible par Odin.` };
      systemes.push({ fichier: '', nom: nomAffiche(vm.nom) || 'Machine virtuelle', famille: vm.famille === 'windows' ? 'Windows' : 'Linux', mode: 'demarrer', recipe: { kind: 'iso', label: nomAffiche(vm.nom) || 'Machine virtuelle', auto: false, os: vm.famille === 'windows' ? 'windows' : 'linux' }, choix: 'vm', vmSource: vm });
      continue;
    }
    const idIso = st(x.iso).replace(/^iso:/, ''), nomFichier = st(x.fichier);
    const i = biblio.find((b) => (idIso && b.id === idIso) || (!idIso && nomFichier && `${b.nom}.iso` === nomFichier));
    if (!i || !i.recipe) return { refus: `« ${st(x.nom || nomFichier).slice(0, 80)} » n'est pas une image prête de la bibliothèque d'Odin.` };
    const fichier = `${i.nom}.iso`.replace(/[^\w.+-]/g, '_');
    const windows = i.recipe.os === 'windows';
    const installable = ['windows', 'ubuntu', 'debian', 'rhel'].includes(i.recipe.kind);
    const sy: SystemeCle = { fichier, nom: nomAffiche(x.nom) || nomAffiche(i.nom) || 'Système', famille: windows ? 'Windows' : 'Linux', mode: choix === 'persistance' ? 'demarrer' : installable ? 'installer' : 'demarrer', recipe: i.recipe, choix };
    const w = o(x.winToGo), pz = o(x.installPartition), pe = o(x.persistance);
    if (choix === 'installe' && windows && Number(w.tailleGo) > 0) sy.winToGo = { tailleGo: Math.min(512, Math.max(16, Math.round(Number(w.tailleGo)))) };
    if (choix === 'installe' && !windows && Number(pz.tailleGo) > 0) sy.installPartition = { tailleGo: Math.min(512, Math.max(8, Math.round(Number(pz.tailleGo)))) };
    if (choix === 'persistance') { const sp = specPersistance(fichier, Number(pe.tailleMo) > 0 ? Math.min(64 * 1024, Number(pe.tailleMo)) : 4096); sy.persistance = { label: sp.label, tailleMo: sp.tailleMo, fs: sp.fs, conf: sp.conf }; }
    systemes.push(sy); sources.set(sy, i.chemin);
    // Les logiciels cochés pour CE système : retrouvés dans la bibliothèque d'Hermès (id ET nom de fichier).
    for (const l of (Array.isArray(x.logiciels) ? x.logiciels : []).slice(0, 200).map(o)) {
      const f = fiches.find((fi) => fichierFiche(fi) === st(l.fichier) && (fi.source ?? fi.id ?? fichierFiche(fi)) === st(l.id));
      if (!f || !f.chemin) return { refus: `Le logiciel « ${st(l.nom || l.fichier).slice(0, 80)} » n'est pas dans la bibliothèque d'Hermès.` };
      const fichierL = fichierFiche(f), id = f.source ?? f.id ?? fichierL;
      if (sourcesLog.has(fichierL)) continue;
      const v = versScripts([{ id, fichier: fichierL }]).windows[0];
      logiciels.push({ id, fichier: fichierL, args: v?.args ?? '', msi: v?.msi ?? false });
      sourcesLog.set(fichierL, f.chemin);
    }
  }
  return { systemes, sources, logiciels, sourcesLog };
}

/** Le disque qu'on peut écrire, retrouvé dans la liste RÉELLE (ou fausse en essai) avec la même empreinte, ou la raison. */
async function disqueVerifie(ctx: ModCtx, cible: unknown): Promise<{ d: Disque } | { refus: string }> {
  const id = idDeCible(cible);
  const d = (await sourceDe(ctx).lister()).find((x) => x.id === id);
  const r = raisonNonChoisissable(d);
  if (r || !d || !choisissable(d)) return { refus: r ?? 'Ce disque ne peut pas devenir une clé ODIN.' };
  if (!memeDisque(o(cible), d)) return { refus: 'Ce n\'est plus la même clé (numéro de série ou taille différents) : rebranche la bonne, ou choisis-la de nouveau.' };
  return { d };
}

/** Le point de montage de la partition ODIN d'une clé déjà ODIN (le seul endroit où une vraie IO écrit), ou rien. */
const montageOdin = (d: Disque) => d.partitions.find((p) => p.label?.toUpperCase() === 'ODIN' && p.montage)?.montage;

/** Les actions greffées dans Genèse pour la clé USB. L'édition de modules/thjalfi.ts fait `actions.push(...cleUsb(deps).actions)`. */
export function cleUsb(deps: DepsCle = {}): { actions: Action[] } {
  const journal = (ctx: ModCtx) => journalDe<LigneJournalCle & { cible: string; par?: string }>(ctx, 'thjalfi_cle', 'cle-journal.jsonl', { garder: 500 });
  // Lot C4 : TOUTES les actions de la clé (même en lecture : elles lancent des commandes du système et montrent les
  // disques de la machine) sont réservées au propriétaire, depuis sa session : ni un membre, ni une tablette, ni une
  // clé d'API, ni une automatisation.
  const actions: Action[] = [
    {
      // Lot S3 (« où sert un système ») : ce qui a été copié sur quelle clé, lu là où le journal est rangé (fichier ou base
      // d'Odin). Lecture seule, rien n'est lancé ; seulement les 2 000 dernières lignes, sans le détail des demandes.
      id: 'cle_journal', label: 'Clé USB : journal des clés écrites', read: true, quick: false, proprietaireSeul: true,
      what: 'Les fichiers copiés sur chaque clé ODIN écrite (quand, où sur la clé, empreinte, quelle clé)',
      run: (ctx) => {
        const lignes = journal(ctx).tout().filter((x) => x && typeof x.dest === 'string' && !x.dest.startsWith('(') && typeof x.cible === 'string').slice(-2000)
          .map((x) => ({ at: Number(x.at) || 0, dest: x.dest, sha256: typeof x.sha256 === 'string' ? x.sha256 : '', cible: x.cible }));
        return { ok: true, text: `${lignes.length} fichier(s) copié(s) sur des clés ODIN.`, data: { lignes } };
      },
    },
    {
      id: 'cle_disques', label: 'Clé USB : disques', read: true, proprietaireSeul: true,
      what: 'Les disques branchés, séparés en externes (clés, disques externes, cartes) et internes (disques du PC)',
      words: ['clé usb', 'clé bootable', 'lister les disques', 'rufus', 'ventoy'],
      run: async (ctx) => {
        const d: Disques = classer(await sourceDe(ctx).lister());
        const nb = d.externes.length + d.internes.length;
        return { ok: true, text: `${nb} disque(s) : ${d.externes.length} externe(s), ${d.internes.length} interne(s).`, data: d };
      },
    },
    {
      id: 'cle_plan', label: 'Clé USB : plan de double démarrage', read: true, proprietaireSeul: true,
      what: 'Ce qu\'Odin ferait pour installer à côté de l\'existant sur un disque interne (rien n\'est écrit)',
      params: [{ key: 'disque', label: 'Identifiant du disque', kind: 'text', required: true }, { key: 'taille', label: 'Taille pour Odin (Go)', kind: 'number', default: 60 }],
      words: ['dual boot', 'double démarrage', 'installer sur un disque'],
      run: async (ctx, i) => {
        const dsq = (await sourceDe(ctx).lister()).find((x) => x.id === String(i.disque));
        if (!dsq) return { ok: false, text: 'Disque introuvable (rebranche-le, ou relis la liste).' };
        const plan: Plan = planDualBoot(dsq, Number(i.taille) || 60);
        return { ok: plan.possible, text: plan.possible ? plan.etapes.map((e) => `- ${e.texte}`).join('\n') : (plan.blocage ?? 'Impossible.'), data: plan };
      },
    },
    {
      id: 'cle_vdisk', label: 'Clé USB : analyser un disque virtuel', read: true, proprietaireSeul: true,
      what: 'Dit si un disque virtuel démarre tel quel, s\'il faut le convertir (qemu-img) ou le préparer (odin-boot)',
      params: [{ key: 'fichier', label: 'Nom du fichier', kind: 'text', required: true }],
      words: ['machine virtuelle', 'vhd', 'vhdx', 'vmdk', 'qcow2'],
      run: (_ctx, i) => { const a: AnalyseVdisk = analyserVdisk(String(i.fichier)); return { ok: true, text: a.message, data: a }; },
    },
    {
      id: 'cle_logiciels', label: 'Clé USB : logiciels pour un système', read: true, proprietaireSeul: true,
      what: 'Les logiciels DÉJÀ TÉLÉCHARGÉS (bibliothèque d\'Hermès) qui conviennent à l\'OS choisi (Windows pour un système Windows, Linux pour un système Linux) ; chacun est marqué « installé en silencieux à la fin » ou « à installer à la main »',
      params: [{ key: 'os', label: 'OS (windows ou linux)', kind: 'text', default: '' }, { key: 'famille', label: 'Famille du système', kind: 'text', default: '' }, { key: 'nom', label: 'Nom du système', kind: 'text', default: '' }, { key: 'serveur', label: 'Système serveur', kind: 'boolean', default: false }],
      words: ['logiciels de la clé', 'logiciels à coller', 'logiciels à installer sur la clé'],
      run: async (ctx, i) => {
        const osIn = String(i.os || '').toLowerCase();
        const cible = osIn === 'windows' || osIn === 'linux'
          ? { os: osIn as 'windows' | 'linux', serveur: i.serveur === true || i.serveur === 'true' }
          : osDuSysteme({ famille: String(i.famille || ''), nom: String(i.nom || '') });
        const dispo = logicielsPourSysteme(await fichesHermes(ctx), cible);
        const txt = dispo.length
          ? dispo.map((d) => `- ${d.nom}${d.version ? ` ${d.version}` : ''} · ${d.silencieux ? 'installé en silencieux à la fin' : `copié, à installer à la main (${d.note ?? d.methode})`}`).join('\n')
          : `Aucun logiciel ${cible.os} déjà téléchargé. Télécharge-les d'abord dans Hermès (filtre « Système » = ${cible.os === 'windows' ? 'Windows' : 'Linux'}).`;
        return { ok: true, text: txt, data: { os: cible.os, serveur: cible.serveur, logiciels: dispo } };
      },
    },
    {
      id: 'cle_retirer', label: 'Clé USB : retirer Odin d\'un disque', quick: false, proprietaireSeul: true,
      what: 'Défait un double démarrage : enlève l\'entrée de menu et la partition ODIN (jamais les autres partitions)',
      params: [{ key: 'disque', label: 'Identifiant du disque', kind: 'text', required: true }],
      grave: () => 'retirer Odin d\'un disque (supprime la partition ODIN)',
      words: ['retirer odin', 'enlever le dual boot'],
      run: async (ctx, i) => {
        const dsq = (await sourceDe(ctx).lister()).find((x) => x.id === String(i.disque));
        if (!dsq) return { ok: false, text: 'Disque introuvable.' };
        const plan = planRetrait(dsq);
        return { ok: plan.possible, text: plan.possible ? `Plan de retrait :\n${plan.etapes.map((e) => `- ${e.texte}`).join('\n')}` : (plan.blocage ?? 'Rien à retirer.'), data: plan };
      },
    },
    {
      id: 'cle_preparer', label: 'Clé USB : écrire la clé', quick: false, proprietaireSeul: true,
      what: 'Écrit la clé ODIN choisie (systèmes de la bibliothèque, logiciels d\'Hermès, tes scripts, options Windows) ; la phrase tapée, le numéro de série et la taille sont revérifiés ici juste avant d\'écrire',
      params: [{ key: 'cible', label: 'Cible (clé ou disque)', kind: 'text' }, { key: 'systemes', label: 'Systèmes composés', kind: 'textarea' }, { key: 'phrase', label: 'La phrase à taper', kind: 'text' }, { key: 'windows', label: 'Options Windows', kind: 'textarea' }, { key: 'scripts', label: 'Tes scripts', kind: 'textarea' }, { key: 'modeDefaut', label: 'Mode au démarrage (graphique ou texte)', kind: 'text' }, { key: 'delai', label: 'Délai avant de démarrer seul (s)', kind: 'number' }, { key: 'langue', label: 'Langue du menu de démarrage', kind: 'text' }],
      grave: () => 'écrire sur une clé USB (ce qui est dessus peut être effacé)',
      words: ['préparer la clé', 'écrire la clé', 'créer une clé bootable'],
      run: async (ctx, i) => {
        journal(ctx).ajouter({ at: Date.now(), dest: '(demande d\'écriture)', sha256: '', cible: idDeCible(i.cible) });
        // 1) La cible : un disque CHOISISSABLE (même règle que l'étape « Clé »), le même qu'au moment du choix.
        const v = await disqueVerifie(ctx, i.cible);
        if ('refus' in v) return { ok: false, text: `${v.refus} Rien n'a été écrit.` };
        const d = v.d;
        if (enCours(d.id)) return { ok: false, text: 'Une écriture est déjà en cours sur cette clé.' };
        // 2) Le choix refait côté serveur (bibliothèque, Hermès, Hydre) et le plan de place.
        const c = await refaireChoix(ctx, deps, i.systemes);
        if ('refus' in c) return { ok: false, text: `${c.refus} Rien n'a été écrit.` };
        const cible = cibleDepuisDisque(d);
        const plan = planPlace(cible, c.systemes);
        if (!plan.possible) return { ok: false, text: `${plan.blocage ?? 'Ça ne tient pas sur la clé.'} Rien n'a été écrit.`, data: plan };
        // 3) La phrase EXACTE, vérifiée ici (la page ne fait que l'afficher et la demander).
        const efface = !cible.estOdin;
        const attendue = phraseAttendue(d, efface);
        if (phraseNormale(i.phrase) !== phraseNormale(attendue)) return { ok: false, text: `Phrase incorrecte : il faut taper exactement « ${attendue} ». Rien n'a été écrit.`, data: { phrase: attendue } };
        // 4) L'IO : un faux disque (dossier temporaire) en essai ; sinon, la partition ODIN montée d'une clé déjà ODIN.
        //    Installer le chargeur sur une clé NEUVE (formater) n'est pas branché : refusé avant d'écrire quoi que ce soit.
        const etat: EtatEcriture = { cible: d.id, debut: Date.now(), phase: 'verifier', etape: '', fait: 0, total: 1, touchee: false, annuler: false, fini: false, ...(d.serie ? { serie: d.serie } : {}) };
        let io: IoCle;
        let montage: string | undefined;
        if (modeEssai(ctx)) io = ioDossier(st(ctx.settings.cleImageTest) || join(ctx.dir, 'cle-essai', d.id.replace(/[^\w-]/g, '_')), { chargeur: 'simule', annule: () => etat.annuler });
        else {
          const m = montageOdin(d);
          if (!d.estOdin || !m) return { ok: false, text: 'Écrire une clé neuve (installer son démarrage) n\'est pas encore branché dans Odin : rien n\'a été écrit. Une clé déjà ODIN, branchée et ouverte, peut être mise à jour.' };
          montage = m;
          // « E: » seul désigne le dossier courant du lecteur : on vise sa RACINE (E:/).
          io = ioDossier(/^[a-z]:$/i.test(m) ? `${m}/` : m, { chargeur: 'garder', annule: () => etat.annuler });
        }
        // Relecture C4 : deux demandes arrivées en même temps ont toutes deux passé le premier contrôle (le serveur attend
        // la bibliothèque entre-temps) : on revérifie ICI, sans plus rien attendre jusqu'à la réservation de la clé.
        if (enCours(d.id)) return { ok: false, text: 'Une écriture est déjà en cours sur cette clé.' };
        const p = deps.profil?.(ctx);
        // Lot C7 : le mode montré au démarrage, le délai et la langue du menu, venus de la demande (donc pas sûrs) : tous
        // passent par reglagesDemarrage (graphique et 10 s si rien n'est dit ; la langue d'Odin si la page n'en dit pas).
        const rd = reglagesDemarrage({ modeDefaut: i.modeDefaut, delai: i.delai, langue: typeof i.langue === 'string' && i.langue ? i.langue : p?.langue });
        const prep: PreparationCle = { schema: 'gpt', secureBoot: true, label: 'ODIN', cible, theme: 'bleu', texte: 'matrix', disposition: 'eventail', modeDefaut: rd.modeDefaut, delai: rd.delai, ...(rd.langue ? { langue: rd.langue } : {}), systemes: c.systemes, images: [], vdisks: [], logiciels: c.logiciels };
        ECRITURES.set(d.id, etat);
        const promesse = ecrireCle(prep, io, buildersParDefaut, {
          cible: d.id, cibleEstOdin: cible.estOdin, plan,
          // Un mot de passe jetable, tiré au hasard et oublié : il n'est écrit nulle part (choisi au premier démarrage).
          motDePasse: randomBytes(18).toString('base64url'),
          compte: p && /^[a-z_][a-z0-9_-]{0,31}$/.test(p.utilisateur) ? p.utilisateur : 'odin',
          ...(p ? { locale: p.langue, keymap: p.clavier, timezone: p.fuseau } : {}),
          sourceIso: (s) => c.sources.get(s), sourceLogiciel: (l) => c.sourcesLog.get(l.fichier),
          windows: i.windows, scripts: i.scripts, antivirus: deps.antivirus,
          cleActivation: (s) => deps.cleActivation?.(ctx, s.fichier, s.nom),
          onTouche: () => { etat.touchee = true; },
          onProgress: (a) => { etat.fait = a.fait; etat.total = a.total; etat.etape = a.etape; if (a.phase) etat.phase = a.phase; },
          // Juste avant le premier octet : la liste est RELUE, et la clé doit être la même, toujours choisissable.
          // (relecture C4 : aussi avant chaque système, chaque logiciel et chaque étape ; et, sur une vraie clé, la partition
          // ODIN doit toujours être montée AU MÊME ENDROIT : une lettre réattribuée n'est jamais suivie.)
          verifierCible: async () => {
            const r = await disqueVerifie(ctx, { id: d.id, serie: d.serie, tailleOctets: d.tailleOctets, modele: d.modele });
            if ('refus' in r) return r.refus;
            if (montage !== undefined && montageOdin(r.d) !== montage) return 'La partition ODIN de la clé n\'est plus au même endroit (lettre de lecteur ou point de montage changés).';
            return undefined;
          },
        }).then((r) => {
          Object.assign(etat, { fini: true, ok: r.ok, message: r.message, touchee: Boolean(r.touchee) });
          for (const m of r.manifeste) journal(ctx).ajouter({ ...m, cible: d.id });
          return r;
        }, (e: Error) => { Object.assign(etat, { fini: true, ok: false, message: `Écriture interrompue : ${e.message}` }); return { ok: false, message: etat.message!, manifeste: [] }; });
        PROMESSES.set(d.id, promesse);
        return { ok: true, text: `Écriture commencée sur ${d.modele ?? d.id} : suis-la étape par étape.`, data: { cible: d.id, plan } };
      },
    },
    {
      id: 'cle_place', label: 'Clé USB : place et plan', read: true, proprietaireSeul: true,
      what: 'La place d\'une cible (clé USB ou disque externe) et le plan avant d\'écrire : ce qui est effacé, ce qui reste, et la phrase à taper',
      params: [{ key: 'cible', label: 'Cible (clé ou disque)', kind: 'text', required: true }, { key: 'systemes', label: 'Systèmes composés', kind: 'textarea' }],
      words: ['place sur la clé', 'plan de la clé', 'combien de systèmes'],
      run: async (ctx, i) => {
        const liste = await sourceDe(ctx).lister();
        const cibles = ciblesEcrivables(liste);
        // La page envoie l'objet cible (ou, en secours, un identifiant) : on retrouve la cible réelle par son id.
        const idCible = i.cible && typeof i.cible === 'object' ? (i.cible as { id?: string }).id : (i.cible ?? i.disque);
        const cible = cibles.find((c) => c.id === String(idCible));
        if (!cible) return { ok: false, text: 'Cible introuvable (choisis une clé ou un disque externe).', data: { cibles } };
        // Les systèmes composés dans la page : le plan réserve alors Windows To Go, Linux installé et la persistance,
        // et peut REFUSER une cible trop petite. Sans eux, le garde-fou ne se déclencherait jamais.
        const systemes = (Array.isArray(i.systemes) ? i.systemes : []) as SystemeCle[];
        const plan = planPlace(cible, systemes);
        const d = liste.find((x) => x.id === cible.id)!;
        return { ok: plan.possible, text: plan.possible ? `Cible ${cible.genre} de ${Math.round(cible.tailleOctets / 1024 ** 3)} Go · ${plan.partitions.length} partition(s), reste ${plan.resteGo} Go.` : (plan.blocage ?? 'Plan impossible : cible trop petite.'), data: { ...plan, efface: !cible.estOdin, phrase: phraseAttendue(d, !cible.estOdin) } };
      },
    },
    {
      id: 'cle_progres', label: 'Clé USB : progression de l\'écriture', read: true, proprietaireSeul: true,
      what: 'L\'avancement d\'une écriture : l\'étape en cours (nommée), le pourcentage, si la clé est déjà touchée, et la fin',
      params: [{ key: 'cible', label: 'Cible (clé ou disque)', kind: 'text' }],
      words: ['progression de la clé', 'avancement de l\'écriture', 'où en est la clé'],
      run: (_ctx, i) => {
        const e = ECRITURES.get(idDeCible(i.cible));
        if (!e) return { ok: true, text: 'Aucune écriture en cours.', data: { pct: 0, etape: '', phase: '', fini: true, aucune: true, phases: PHASES } };
        const pct = e.fini && e.ok ? 100 : Math.min(99, Math.round((e.fait / Math.max(1, e.total)) * 100));
        return { ok: true, text: e.fini ? (e.message ?? 'Fini.') : `${pct} % · ${e.etape}`, data: { pct, etape: e.etape, phase: e.phase, phases: PHASES, fini: e.fini, reussi: e.fini ? e.ok === true : undefined, message: e.message ?? '', touchee: e.touchee, annulee: e.annuler, depuis: e.debut } };
      },
    },
    {
      id: 'cle_annuler', label: 'Clé USB : annuler l\'écriture', quick: false, proprietaireSeul: true,
      what: 'Arrête l\'écriture en cours au prochain fichier ; dit si la clé était déjà touchée (elle reste alors incomplète)',
      params: [{ key: 'cible', label: 'Cible (clé ou disque)', kind: 'text' }],
      words: ['annuler la clé', 'arrêter l\'écriture'],
      run: (_ctx, i) => {
        const e = ECRITURES.get(idDeCible(i.cible));
        if (!e || e.fini) return { ok: false, text: 'Aucune écriture en cours.' };
        e.annuler = true;
        return { ok: true, text: e.touchee ? 'Arrêt demandé : la clé est déjà en partie écrite, elle ne démarrera pas tant que tu ne recommences pas.' : 'Arrêt demandé : rien n\'avait encore été écrit sur la clé.', data: { touchee: e.touchee } };
      },
    },
    {
      id: 'cle_ejecter', label: 'Clé USB : éjecter la clé', quick: false, proprietaireSeul: true,
      what: 'Éjecte proprement la clé écrite (plus aucune écriture en attente) pour la retirer sans risque',
      params: [{ key: 'cible', label: 'Cible (clé ou disque)', kind: 'text' }],
      words: ['éjecter la clé', 'retirer la clé'],
      run: async (ctx, i) => {
        const v = await disqueVerifie(ctx, i.cible);
        if ('refus' in v) return { ok: false, text: v.refus };
        const d = v.d;
        if (enCours(d.id)) return { ok: false, text: 'L\'écriture n\'est pas finie : attends-la, ou annule-la, avant d\'éjecter.' };
        // Essai (faux disques) : rien n'est lancé, la clé est notée éjectée.
        if (modeEssai(ctx)) { EJECTEES_ESSAI.add(d.id); return { ok: true, text: 'Clé éjectée : tu peux la retirer.', data: { ejectee: true, essai: true } }; }
        try {
          if (process.platform === 'win32') {
            const lettre = d.partitions.map((p) => p.montage ?? '').find((m) => /^[A-Z]:$/i.test(m));
            if (!lettre) return { ok: false, text: 'La clé n\'a pas de lettre de lecteur : retire-la depuis l\'icône « Retirer le périphérique ».' };
            await ctx.run('powershell', ['-NoProfile', '-NonInteractive', '-Command', `(New-Object -ComObject Shell.Application).Namespace(17).ParseName('${lettre.toUpperCase()}').InvokeVerb('Eject')`], { timeoutMs: 30_000 });
          } else {
            if (!/^\/dev\/[a-z0-9]+$/.test(d.chemin)) return { ok: false, text: 'Chemin de la clé inattendu : rien n\'a été fait.' };
            for (const p of d.partitions) if (p.montage && /^[a-z0-9]+$/.test(p.nom)) await ctx.run('udisksctl', ['unmount', '-b', `/dev/${p.nom}`], { timeoutMs: 30_000 }).catch(() => undefined);
            await ctx.run('udisksctl', ['power-off', '-b', d.chemin], { timeoutMs: 30_000 });
          }
        } catch (e) { return { ok: false, text: `Éjection impossible : ${(e as Error).message}` }; }
        return { ok: true, text: 'Clé éjectée : tu peux la retirer.', data: { ejectee: true } };
      },
    },
    {
      id: 'cle_vms', label: 'Clé USB : machines virtuelles à copier', read: true, external: true, proprietaireSeul: true,
      what: 'Les VM qu\'Odin peut copier sur la clé pour démarrer sur un vrai PC (VM locales d\'Hydre ; Proxmox : voie « disque exporté déposé »)',
      words: ['copier une vm', 'vm sur la clé', 'proxmox sur clé'],
      run: async (ctx) => {
        const vms = await listerVms(ctx);
        const locales = vms.filter((v) => v.origine === 'hydre-locale').length;
        return { ok: true, text: vms.length ? `${vms.length} VM : ${locales} locale(s) copiable(s) directement ; les VM Proxmox passent par un disque exporté déposé à la racine.` : 'Aucune VM vue par Hydre (Proxmox non réglé, ou aucune VM locale).', data: vms };
      },
    },
    {
      id: 'cle_racine', label: 'Clé USB : fichiers déposés à la racine', read: true, proprietaireSeul: true,
      what: 'Classe les fichiers posés à la racine (ISO, disque de VM, image) : démarrables, à préparer, ou non démarrables (jamais exécutés)',
      params: [{ key: 'cible', label: 'Cible (clé ou disque)', kind: 'text' }, { key: 'fichiers', label: 'Noms des fichiers déposés (virgules ou retours)', kind: 'textarea', default: '' }],
      words: ['fichiers à la racine', 'déposer un fichier', 'scanner la clé'],
      run: (_ctx, i) => {
        // Les noms viennent d'une liste (page / test) ou d'un texte. La lecture du VRAI contenu de la racine d'une
        // cible branchée se fait au DÉMARRAGE (odin-scan posé sur la clé) ; ici, on classe les noms donnés pour l'aperçu.
        const brut = Array.isArray(i.fichiers) ? i.fichiers.join('\n') : String(i.fichiers ?? '');
        const noms = brut.split(/[,\n]+/).map((x) => x.trim()).filter(Boolean);
        const entrees = classerRacine(noms);
        const demarrables = entrees.filter((e) => e.genre !== 'non-demarrable').length;
        return { ok: true, text: noms.length ? `${entrees.length} fichier(s) : ${demarrables} démarrable(s) / à préparer, ${entrees.length - demarrables} non démarrable(s).` : 'Dépose un fichier (ISO, .img, .raw, .vhd, .vhdx, .vmdk, .qcow2, .vdi) sur la partition ODIN : il est reconnu tout seul au démarrage (odin-scan) et rangé au menu. Pour un aperçu ici, donne leurs noms.', data: entrees };
      },
    },
  ];
  return { actions };
}
