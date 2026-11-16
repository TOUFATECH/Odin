// Genèse · clé USB — l'ORCHESTRATEUR de l'écriture de la clé, et les ACTIONS de l'onglet « Clé USB » greffées
// dans Genèse (cleUsb). La clé ODIN est un NOUVEAU MODE de Genèse, pas une appli à part : même nom, mêmes
// thèmes, mêmes recettes.
//
// Décision (voir AVANCEMENT, section 6) : on installe le binaire OFFICIEL de Ventoy (téléchargé depuis le dépôt
// officiel ventoy/Ventoy, empreinte SHA-256 vérifiée, passé par Asclépios avant usage, jamais modifié, licence
// GPLv3) puis on le personnalise par ventoy.json. On N'ÉCRIT PAS de nouveau code C.
//
// Tout ce qui écrit passe par une « IO » injectable : les essais lui donnent une version simulée (image de clé
// dans un fichier temporaire, commandes simulées), et aucun vrai disque n'est touché, aucun service réel
// contacté. Le lot B fournit les constructeurs (buildVentoyJson, buildGrubTheme, buildEcranOffline) ; en leur
// absence, un constructeur minimal de secours permet de construire et d'essayer ce lot tout seul.

import { createHash } from 'node:crypto';
import type { Action, ModCtx } from '../types.ts';
import { journalDe } from '../base/journal.ts';
import type { TextTheme } from './ecran.ts';
import { apercu } from './scripts.ts';
import { installeAuto, logicielsPourSysteme, osDuSysteme, type FicheLog } from './logiciels-cle.ts';
import { classer, sourceReelle, sourceSimulee, type Disque, type Disques, type SourceDisques } from './disques.ts';
import { planDualBoot, planRetrait, type Plan } from './cle-plan.ts';
import { analyserVdisk, type AnalyseVdisk } from './vdisk.ts';
// Le CONTRAT et les VRAIS constructeurs du lot B (plus aucun stub mort) : une seule source pour PreparationCle,
// un seul descripteur de Ventoy (empreinte vérifiée), et les constructeurs réellement appelés par l'écriture.
import type { PreparationCle, SystemeCle } from './cle-types.ts';
import { FICHIERS_ODIN } from './cle-types.ts';
import { buildVentoyJson, descripteurVentoy, type DescripteurVentoy } from './cle-boot.ts';
import { planWinToGo, specPersistance, commandePersistance, planInstallLinux } from './cle-install.ts';
import { listerVms, planCopieVm } from './cle-vm.ts';
import { ciblesEcrivables, planPlace } from './cle-cible.ts';
import { classerRacine, buildScriptScan } from './cle-racine.ts';
import { buildGrubTheme } from './cle-grub.ts';
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
}
/** Les VRAIS constructeurs du lot B, câblés par défaut (importés, exercés par les essais : plus de code mort). */
export const buildersParDefaut: BuildersCle = {
  buildVentoyJson,
  buildGrubTheme,
  buildEcranOffline: (prep) => buildEcranOffline(etatFige(prep)),
};

/** L'état figé que lit l'écran hors ligne (même forme que /ecran/etat) : systèmes, thème, disposition. */
function etatFige(prep: PreparationCle) {
  return {
    systemes: prep.systemes.map((s) => ({ id: s.fichier, title: s.nom, category: s.famille, modes: [s.mode], color: '#5b8def', size: 0, version: '' })),
    disposition: String(prep.disposition), theme: String(prep.theme), dit: { _: 'Choisis un système à démarrer.' },
  };
}

// ---------------- L'IO (vraie ou simulée) ----------------
/** Ce que l'orchestrateur demande à l'IO ; la simulée ne touche à rien. */
export interface IoCle {
  /** installe ou met à jour Ventoy sur la clé (schéma GPT/MBR, support Secure Boot) ; une clé déjà ODIN est mise à jour sans tout effacer */
  installerVentoy(cible: string, desc: DescripteurVentoy, opt: { schema: 'gpt' | 'mbr'; secureBoot: boolean; miseAJour: boolean }): Promise<void>;
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
  /** lot A : fabrique un VHDX Windows To Go (DISM /Apply-Image + bcdboot, posé dans /vdisk) ; rend son empreinte */
  creerVhdxWinToGo?(destRelatif: string, commandes: string[], onProgress?: (recu: number, total: number) => void): Promise<string>;
  /** lot A : crée un fichier de persistance Linux (mkfs ext, étiquette de la distribution) ; rend son empreinte */
  creerPersistance?(destRelatif: string, commandes: string[]): Promise<string>;
  /** lot A : copie le disque d'une VM (conversion + préparation) et le pose dans /vdisk ; rend son empreinte */
  copierDisqueVm?(source: string, destRelatif: string, onProgress?: (recu: number, total: number) => void): Promise<string>;
}

/** Une IO simulée pour les essais : garde tout en mémoire, calcule de vraies empreintes, ne touche à rien. */
export function ioSimulee(sources: Record<string, string> = {}): IoCle & { fichiers: Map<string, string>; ventoy?: { schema: string; secureBoot: boolean; miseAJour: boolean } } {
  const fichiers = new Map<string, string>();
  const empreinteDe = (s: string) => createHash('sha256').update(s).digest('hex');
  const io = {
    fichiers, ventoy: undefined as { schema: string; secureBoot: boolean; miseAJour: boolean } | undefined,
    async installerVentoy(_cible: string, _d: DescripteurVentoy, opt: { schema: 'gpt' | 'mbr'; secureBoot: boolean; miseAJour: boolean }) { io.ventoy = { schema: opt.schema, secureBoot: opt.secureBoot, miseAJour: opt.miseAJour }; },
    async copier(source: string, dest: string) { const c = sources[source] ?? `copie:${source}`; fichiers.set(dest, c); return empreinteDe(c); },
    async ecrire(dest: string, contenu: string) { fichiers.set(dest, contenu); return empreinteDe(contenu); },
    // Pour un binaire, on garde l'empreinte déjà calculée, marquée « h: » (pas de collision avec un contenu texte).
    async ecrireBinaire(dest: string, contenu: Buffer) { const h = createHash('sha256').update(contenu).digest('hex'); fichiers.set(dest, `h:${h}`); return h; },
    async empreinte(dest: string) { const v = fichiers.get(dest) ?? ''; return v.startsWith('h:') ? v.slice(2) : empreinteDe(v); },
    annule: () => false,
    // Lot A : les opérations lourdes, SIMULÉES (aucun vrai disque, aucune commande lancée) — on garde une empreinte du plan.
    async creerVhdxWinToGo(dest: string, commandes: string[]) { const c = `wintogo:${commandes.join('\n')}`; fichiers.set(dest, c); return empreinteDe(c); },
    async creerPersistance(dest: string, commandes: string[]) { const c = `persistance:${commandes.join('\n')}`; fichiers.set(dest, c); return empreinteDe(c); },
    async copierDisqueVm(source: string, dest: string) { const c = `vm:${source}`; fichiers.set(dest, c); return empreinteDe(c); },
  };
  return io;
}

// ---------------- L'orchestrateur ----------------
export interface LigneJournalCle { at: number; dest: string; sha256: string; octets?: number }
export interface ResultatEcriture { ok: boolean; message: string; manifeste: LigneJournalCle[] }
export interface Avancement { etape: string; fait: number; total: number }

/** La disposition des fichiers sur la 1re partition ODIN (contrat, section 2). */
export const DOSSIER = { iso: 'ISO', vdisk: 'vdisk', persistence: 'persistence', logicielsWindows: 'logiciels/windows', logicielsLinux: 'logiciels/linux', ventoy: 'ventoy', ecran: 'ecran-odin', odin: 'odin' } as const;

/**
 * Écrit la clé : installe/met à jour Ventoy, copie les systèmes, images, disques virtuels et logiciels, pose
 * ventoy.json, le thème GRUB, l'écran hors ligne et les scripts, puis revérifie les empreintes et journalise.
 * Tout passe par l'IO : les essais lui donnent une version simulée. Annulable (io.annule).
 */
/** Les options d'écriture : la cible, le compte et le mot de passe (du coffre / du propriétaire, JAMAIS une valeur
 *  par défaut connue), la langue / le clavier / le fuseau repris d'Odin, et si la cible est déjà une clé ODIN. */
export interface OptionsEcriture {
  cible: string; sources?: Record<string, string>; token?: string;
  /** le mot de passe d'administration en clair, fourni au moment de l'écriture (coffre / propriétaire) — requis */
  motDePasse?: string;
  /** le nom du compte local (repris d'Odin) ; défaut : « odin » */
  compte?: string;
  locale?: string; keymap?: string; timezone?: string;
  /** vrai si la cible est DÉJÀ une clé ODIN (Disque.estOdin) → mise à jour non destructive ; faux → installation */
  cibleEstOdin?: boolean;
  onProgress?: (a: Avancement) => void;
}

export async function ecrireCle(
  prep: PreparationCle,
  io: IoCle,
  builders: BuildersCle,
  o: OptionsEcriture = { cible: 'ODIN' },
): Promise<ResultatEcriture> {
  const manifeste: LigneJournalCle[] = [];
  // Sécurité : jamais de mot de passe par défaut connu dans les scripts posés sur la clé (dépôt public).
  if (!o.motDePasse) return { ok: false, message: 'Écriture refusée : aucun mot de passe d\'administration fourni (il vient du coffre ou du propriétaire, jamais une valeur par défaut connue).', manifeste };
  const token = o.token ?? 'cle';
  // Les systèmes INSTALLÉS / copiés du lot A (Windows To Go, persistance, copie de VM) : une étape lourde chacun.
  const nbInstalles = prep.systemes.filter((s) => ['installe', 'persistance', 'vm'].includes(s.choix ?? 'iso')).length;
  // Le total des étapes, pour une barre de progression honnête.
  const total = 1 + prep.systemes.length + prep.images.length + prep.vdisks.length + prep.logiciels.length + nbInstalles + 4 + prep.systemes.length;
  let fait = 0;
  const avance = (etape: string) => { fait++; o.onProgress?.({ etape, fait, total }); };
  const stop = () => io.annule();
  const noter = async (dest: string, sha256: string) => { manifeste.push({ at: Date.now(), dest, sha256 }); };

  try {
    // 1) Ventoy (binaire officiel vérifié, jamais modifié) — une clé déjà ODIN est mise à jour sans tout effacer.
    await io.installerVentoy(o.cible, descripteurVentoy(), { schema: prep.schema, secureBoot: prep.secureBoot, miseAJour: o.cibleEstOdin ?? false });
    avance('Ventoy (officiel, vérifié)');
    if (stop()) return { ok: false, message: 'Écriture annulée.', manifeste };

    // 2) Les systèmes (ISO) dans /ISO/.
    for (const s of prep.systemes) {
      if (stop()) return { ok: false, message: 'Écriture annulée.', manifeste };
      const dest = `${DOSSIER.iso}/${s.fichier}`;
      await noter(dest, await io.copier(s.fichier, dest));
      avance(`Système : ${s.nom}`);
    }
    // 3) Les autres images dans /ISO/.
    for (const img of prep.images) { if (stop()) return { ok: false, message: 'Écriture annulée.', manifeste }; const dest = `${DOSSIER.iso}/${img}`; await noter(dest, await io.copier(img, dest)); avance(`Image : ${img}`); }
    // 4) Les disques virtuels dans /vdisk/.
    for (const v of prep.vdisks) { if (stop()) return { ok: false, message: 'Écriture annulée.', manifeste }; const dest = `${DOSSIER.vdisk}/${v.fichier}`; await noter(dest, await io.copier(v.fichier, dest)); avance(`Disque virtuel : ${v.fichier}`); }
    // 5) Les logiciels dans /logiciels/windows ou /logiciels/linux (selon le système choisi).
    const famillesWindows = prep.systemes.some((s) => s.recipe.os === 'windows');
    for (const l of prep.logiciels) { if (stop()) return { ok: false, message: 'Écriture annulée.', manifeste }; const dest = `${famillesWindows ? DOSSIER.logicielsWindows : DOSSIER.logicielsLinux}/${l.fichier}`; await noter(dest, await io.copier(l.fichier, dest)); avance(`Logiciel : ${l.id}`); }

    // 5b) Les VRAIS systèmes installés / copiés du lot A : Windows To Go, persistance Linux, copie d'un disque de
    //     VM. Chaque opération lourde passe DERRIÈRE l'IO injectée (simulée en test : aucun vrai disque touché).
    const grubInstalles: string[] = [];
    for (const sy of prep.systemes) {
      if (stop()) return { ok: false, message: 'Écriture annulée.', manifeste };
      const choix = sy.choix ?? 'iso';
      const base = sy.fichier.replace(/\.[^.]+$/, '').replace(/[^\w.+-]/g, '_');
      // Famille insensible à la casse : un Windows « installé » est un Windows To Go, qu'il porte ou non winToGo.
      const estWindows = String(sy.famille).toLowerCase() === 'windows';
      if (choix === 'installe' && (sy.winToGo || estWindows) && io.creerVhdxWinToGo) {
        const plan = planWinToGo(sy.fichier, sy.nom, { tailleGo: sy.winToGo?.tailleGo ?? 32 });
        const dest = `${DOSSIER.vdisk}/${plan.vhdx.replace(/^.*\//, '')}`;
        await noter(dest, await io.creerVhdxWinToGo(dest, plan.commandes));
        avance(`Windows To Go : ${sy.nom}`);
      } else if (choix === 'installe') {
        // Linux installé complet : l'entrée GRUB chainload (planInstallLinux) rejoint le menu natif de Ventoy
        // (ventoy_grub.cfg, écrit après la boucle). La création réelle de la partition dépend de l'IO réelle.
        grubInstalles.push(planInstallLinux(sy).grubEntree);
        avance(`Linux installé : ${sy.nom}`);
      } else if (choix === 'persistance' && io.creerPersistance) {
        const spec = sy.persistance ? { ...sy.persistance, conf: sy.persistance.conf ?? false } : specPersistance(sy.fichier);
        const dest = `${DOSSIER.persistence}/${base}-${spec.label}.dat`;
        await noter(dest, await io.creerPersistance(dest, commandePersistance(spec, dest)));
        avance(`Persistance : ${sy.nom}`);
      } else if (choix === 'vm' && sy.vmSource && io.copierDisqueVm) {
        const plan = planCopieVm(sy.vmSource);
        if (plan.possible && plan.destination) {
          const dest = `${DOSSIER.vdisk}/${plan.destination.replace(/^.*\//, '')}`;
          await noter(dest, await io.copierDisqueVm(sy.vmSource.disque ?? sy.vmSource.nom, dest));
          avance(`Copie VM : ${sy.vmSource.nom}`);
        }
      }
    }
    // Les systèmes Linux installés : leurs entrées GRUB chainload posées dans le menu natif de Ventoy (ventoy_grub.cfg).
    if (grubInstalles.length) {
      const cfg = `# Menu Odin — systèmes Linux installés (chainload), chargé nativement par Ventoy.\n${grubInstalles.join('\n\n')}\n`;
      await noter(`${DOSSIER.ventoy}/ventoy_grub.cfg`, await io.ecrire(`${DOSSIER.ventoy}/ventoy_grub.cfg`, cfg));
    }

    // 6) ventoy.json (greffons, thème, menu, auto-install, injection des scripts).
    await noter(`${DOSSIER.ventoy}/ventoy.json`, await io.ecrire(`${DOSSIER.ventoy}/ventoy.json`, builders.buildVentoyJson(prep)));
    avance('ventoy.json');
    // 7) Le thème GRUB aux couleurs du thème choisi.
    for (const [nom, contenu] of Object.entries(builders.buildGrubTheme(prep.texte))) await noter(`${DOSSIER.ventoy}/theme/odin/${nom}`, await io.ecrire(`${DOSSIER.ventoy}/theme/odin/${nom}`, contenu));
    avance('thème GRUB');
    // 8) L'écran d'Odin hors ligne (copie de /ecran + systemes.json figés + overlay Alpine BINAIRE).
    const eo = builders.buildEcranOffline(prep);
    for (const [nom, contenu] of Object.entries(eo.fichiers)) await noter(`${DOSSIER.ecran}/${nom}`, await io.ecrire(`${DOSSIER.ecran}/${nom}`, contenu));
    await noter(`${DOSSIER.ecran}/odin-ecran.apkovl.tar.gz`, await io.ecrireBinaire(`${DOSSIER.ecran}/odin-ecran.apkovl.tar.gz`, eo.overlay));
    avance('écran hors ligne');

    // 9) Les scripts d'installation par système (montrés avant par la page), aux NOMS que ventoy.json référence
    //    (FICHIERS_ODIN) ; et l'archive d'injection que Ventoy pose dans le système installé (apres.ps1, etc.).
    for (const s of prep.systemes) {
      if (stop()) return { ok: false, message: 'Écriture annulée.', manifeste };
      const scripts = scriptsDe(s, prep, token, o);
      for (const [nom, contenu] of Object.entries(scripts)) await noter(`${DOSSIER.odin}/${nom}`, await io.ecrire(`${DOSSIER.odin}/${nom}`, contenu));
      if (s.mode === 'installer') {
        const base = s.fichier.replace(/\.[^.]+$/, '');
        await noter(`${DOSSIER.odin}/inject-${base}.tar.gz`, await io.ecrireBinaire(`${DOSSIER.odin}/inject-${base}.tar.gz`, archiveInjection(scripts)));
      }
      avance(`Scripts : ${s.nom}`);
    }

    // 9b) L'indexeur « odin-scan » posé dans /odin : lancé au démarrage, il range au menu TOUT fichier déposé à la
    //     racine de la clé (ISO, disque de VM, image). Sans lui, un simple dépôt à la racine n'apparaîtrait pas au menu.
    await noter(`${DOSSIER.odin}/${FICHIERS_ODIN.odinScan}`, await io.ecrire(`${DOSSIER.odin}/${FICHIERS_ODIN.odinScan}`, buildScriptScan()));

    // 10) Revérification des empreintes.
    for (const m of manifeste) { const h = await io.empreinte(m.dest); if (h !== m.sha256) return { ok: false, message: `Vérification : ${m.dest} ne correspond pas à son empreinte.`, manifeste }; }
    return { ok: true, message: `Clé ODIN prête : ${prep.systemes.length} système(s), ${prep.vdisks.length} disque(s) virtuel(s), ${prep.logiciels.length} logiciel(s). Toutes les empreintes vérifiées.`, manifeste };
  } catch (e) {
    return { ok: false, message: `Écriture interrompue : ${(e as Error).message}`, manifeste };
  }
}

/** Les scripts d'un système (réutilise scripts.ts). Les noms de fichiers suivent le contrat (FICHIERS_ODIN)
 *  que ventoy.json référence (auto_install). Pur. */
function scriptsDe(s: SystemeCle, prep: PreparationCle, token: string, o: OptionsEcriture): Record<string, string> {
  const answer = answerDe(prep, o);
  // Chaque système ne reçoit que SES logiciels (filtrés par OS), et on ne lance en silencieux que ceux dont le mode
  // est connu : un installateur Windows va au script Windows, un paquet Linux (.deb) aux late-commands Linux ; les
  // autres sont copiés sur la clé mais pas promis en silencieux (logiciels-cle.ts).
  if (s.recipe.os === 'windows') return apercu({ famille: 'windows', answer, fw: prep.schema === 'mbr' ? 'bios' : 'uefi', opt: { retirerExigences: true, effacerApres: false }, logiciels: prep.logiciels.filter((l) => installeAuto(l.id, l.fichier) === 'windows') });
  const famille = s.recipe.kind === 'debian' ? 'debian' : s.recipe.kind === 'rhel' ? 'rhel' : 'ubuntu';
  const scripts = apercu({ famille, answer, token, debsCle: prep.logiciels.filter((l) => installeAuto(l.id, l.fichier) === 'linux').map((l) => l.fichier) });
  // Aligner le nom du kickstart sur le contrat (ventoy.json pointe vers FICHIERS_ODIN.kickstart).
  if (scripts['ks.cfg'] !== undefined) { scripts[FICHIERS_ODIN.kickstart] = scripts['ks.cfg']; delete scripts['ks.cfg']; }
  return scripts;
}
/** Les réponses d'installation hors ligne : compte et mot de passe fournis à l'écriture (jamais une constante),
 *  langue / clavier / fuseau repris d'Odin (modifiables avant d'écrire). Pur. */
function answerDe(prep: PreparationCle, o: OptionsEcriture): Parameters<typeof apercu>[0]['answer'] {
  const user = o.compte && o.compte.trim() ? o.compte.trim() : 'odin';
  return { host: 'odin-pc', user, password: o.motDePasse ?? '', locale: o.locale ?? 'fr_FR.UTF-8', keymap: o.keymap ?? 'fr', timezone: o.timezone ?? 'Europe/Paris', packages: [], report: 'http://127.0.0.1/etat/cle', software: prep.logiciels.map((l) => ({ name: l.id, url: l.fichier, args: l.args, msi: l.msi })) };
}
/** L'archive d'injection d'un système (ce que Ventoy pose dans le système installé) : les scripts de fin, sauf
 *  l'autounattend qui, lui, est injecté séparément comme fichier de réponses. Pur (tar déterministe). */
function archiveInjection(scripts: Record<string, string>): Buffer {
  const entrees = Object.entries(scripts)
    .filter(([n]) => n !== FICHIERS_ODIN.autounattend)
    .map(([name, data]) => ({ name: `odin/${name}`, data }));
  return tarGz(entrees.length ? entrees : [{ name: 'odin/.keep', data: '' }]);
}

// ---------------- Les actions de l'onglet « Clé USB » ----------------
/** La source des disques : réelle sur la machine, ou simulée si Genèse est en mode essai (settings.cleTest). */
function sourceDe(ctx: ModCtx): SourceDisques {
  const faux = ctx.settings.cleDisquesTest as Disque[] | undefined;
  if (Array.isArray(faux)) return sourceSimulee(faux);
  return sourceReelle(process.platform, async (cmd, args) => (await ctx.run(cmd, args, { timeoutMs: 30_000 })).out);
}

/** Les actions greffées dans Genèse pour la clé USB. L'édition de modules/thjalfi.ts fait `actions.push(...cleUsb().actions)`. */
export function cleUsb(): { actions: Action[] } {
  const journal = (ctx: ModCtx) => journalDe<LigneJournalCle & { cible: string; par?: string }>(ctx, 'thjalfi_cle', 'cle-journal.jsonl', { garder: 500 });
  const actions: Action[] = [
    {
      id: 'cle_disques', label: 'Clé USB : disques', read: true,
      what: 'Les disques branchés, séparés en externes (clés, disques externes, cartes) et internes (disques du PC)',
      words: ['clé usb', 'clé bootable', 'lister les disques', 'rufus', 'ventoy'],
      run: async (ctx) => {
        const d: Disques = classer(await sourceDe(ctx).lister());
        const nb = d.externes.length + d.internes.length;
        return { ok: true, text: `${nb} disque(s) : ${d.externes.length} externe(s), ${d.internes.length} interne(s).`, data: d };
      },
    },
    {
      id: 'cle_plan', label: 'Clé USB : plan de double démarrage', read: true,
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
      id: 'cle_vdisk', label: 'Clé USB : analyser un disque virtuel', read: true,
      what: 'Dit si un disque virtuel démarre tel quel, s\'il faut le convertir (qemu-img) ou le préparer (odin-boot)',
      params: [{ key: 'fichier', label: 'Nom du fichier', kind: 'text', required: true }],
      words: ['machine virtuelle', 'vhd', 'vhdx', 'vmdk', 'qcow2'],
      run: (_ctx, i) => { const a: AnalyseVdisk = analyserVdisk(String(i.fichier)); return { ok: true, text: a.message, data: a }; },
    },
    {
      id: 'cle_logiciels', label: 'Clé USB : logiciels pour un système', read: true,
      what: 'Les logiciels DÉJÀ TÉLÉCHARGÉS (bibliothèque d\'Hermès) qui conviennent à l\'OS choisi (Windows pour un système Windows, Linux pour un système Linux) ; chacun est marqué « installé en silencieux à la fin » ou « à installer à la main »',
      params: [{ key: 'os', label: 'OS (windows ou linux)', kind: 'text', default: '' }, { key: 'famille', label: 'Famille du système', kind: 'text', default: '' }, { key: 'nom', label: 'Nom du système', kind: 'text', default: '' }, { key: 'serveur', label: 'Système serveur', kind: 'boolean', default: false }],
      words: ['logiciels de la clé', 'logiciels à coller', 'logiciels à installer sur la clé'],
      run: async (ctx, i) => {
        const osIn = String(i.os || '').toLowerCase();
        const cible = osIn === 'windows' || osIn === 'linux'
          ? { os: osIn as 'windows' | 'linux', serveur: i.serveur === true || i.serveur === 'true' }
          : osDuSysteme({ famille: String(i.famille || ''), nom: String(i.nom || '') });
        // Les logiciels téléchargés : la bibliothèque d'Hermès (fjalar). Absent ou vide : aucune promesse, liste vide.
        let fiches: FicheLog[] = [];
        try { fiches = (((await ctx.call('fjalar', 'etat', {}, 'logiciels téléchargés à coller sur la clé', { interne: true })).data as { fichiers?: FicheLog[] } | undefined)?.fichiers) ?? []; } catch { /* Hermès absent */ }
        const dispo = logicielsPourSysteme(fiches, cible);
        const txt = dispo.length
          ? dispo.map((d) => `- ${d.nom}${d.version ? ` ${d.version}` : ''} · ${d.silencieux ? 'installé en silencieux à la fin' : `copié, à installer à la main (${d.note ?? d.methode})`}`).join('\n')
          : `Aucun logiciel ${cible.os} déjà téléchargé. Télécharge-les d'abord dans Hermès (filtre « Système » = ${cible.os === 'windows' ? 'Windows' : 'Linux'}).`;
        return { ok: true, text: txt, data: { os: cible.os, serveur: cible.serveur, logiciels: dispo } };
      },
    },
    {
      id: 'cle_retirer', label: 'Clé USB : retirer Odin d\'un disque', quick: false,
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
      id: 'cle_preparer', label: 'Clé USB : préparer', quick: false,
      what: 'Écrit la clé ODIN (Ventoy officiel vérifié, systèmes, disques virtuels, logiciels, scripts) ; une clé déjà ODIN est mise à jour sans tout effacer',
      params: [{ key: 'cible', label: 'Cible (clé ou disque)', kind: 'text' }, { key: 'systemes', label: 'Systèmes composés', kind: 'textarea' }, { key: 'racine', label: 'Fichiers déposés à la racine', kind: 'textarea' }, { key: 'effacer', label: 'Tout effacer (cible non ODIN)', kind: 'boolean', default: false }],
      grave: (i) => (i.effacer ? 'préparer une cible en effaçant tout son contenu' : 'préparer une cible ODIN'),
      words: ['préparer la clé', 'écrire la clé', 'créer une clé bootable'],
      run: async (ctx, i) => {
        // La page compose la cible et les systèmes (les TROIS choix) ; on revérifie le plan AVANT toute écriture.
        // L'écriture réelle sur le disque passe par une IoCle RÉELLE (Ventoy officiel + systèmes installés), pas
        // encore branchée : tant qu'elle n'existe pas, AUCUN disque n'est écrit — on le dit honnêtement. Les
        // fonctions pures (plan, menu, persistance, Windows To Go, indexation) sont, elles, complètes et testées.
        const cibles = ciblesEcrivables(await sourceDe(ctx).lister());
        const idCible = i.cible && typeof i.cible === 'object' ? (i.cible as { id?: string }).id : i.cible;
        const cible = cibles.find((c) => c.id === String(idCible));
        journal(ctx).ajouter({ at: Date.now(), dest: '(demande de préparation)', sha256: '', cible: 'ODIN' });
        if (!cible) return { ok: false, text: 'Choisis une clé ou un disque dans la page « Clé USB » avant d\'écrire.', data: { cibles } };
        const systemes = (Array.isArray(i.systemes) ? i.systemes : []) as SystemeCle[];
        const plan = planPlace(cible, systemes, { effacer: i.effacer === true || undefined });
        if (!plan.possible) return { ok: false, text: plan.blocage ?? 'Cible trop petite : réduis la liste.', data: plan };
        return { ok: true, text: `Plan vérifié pour ${cible.genre} (${systemes.length} système(s), reste ${plan.resteGo} Go). L'écriture réelle sur le disque n'est pas encore branchée : rien n'a été écrit. Le plan, le menu et l'indexation au démarrage sont prêts.`, data: plan };
      },
    },
    {
      id: 'cle_place', label: 'Clé USB : place et plan', read: true,
      what: 'La place d\'une cible (clé USB ou disque dur) et le plan avant d\'écrire : ce qui est effacé, ce qui reste',
      params: [{ key: 'cible', label: 'Cible (clé ou disque)', kind: 'text', required: true }, { key: 'systemes', label: 'Systèmes composés', kind: 'textarea' }],
      words: ['place sur la clé', 'plan de la clé', 'combien de systèmes'],
      run: async (ctx, i) => {
        const cibles = ciblesEcrivables(await sourceDe(ctx).lister());
        // La page envoie l'objet cible (ou, en secours, un identifiant) : on retrouve la cible réelle par son id.
        const idCible = i.cible && typeof i.cible === 'object' ? (i.cible as { id?: string }).id : (i.cible ?? i.disque);
        const cible = cibles.find((c) => c.id === String(idCible));
        if (!cible) return { ok: false, text: 'Cible introuvable (choisis une clé, un disque externe, ou un disque ODIN).', data: { cibles } };
        // Les systèmes composés dans la page : le plan réserve alors Windows To Go, Linux installé et la persistance,
        // et peut REFUSER une cible trop petite. Sans eux, le garde-fou ne se déclencherait jamais.
        const systemes = (Array.isArray(i.systemes) ? i.systemes : []) as SystemeCle[];
        const plan = planPlace(cible, systemes);
        return { ok: plan.possible, text: plan.possible ? `Cible ${cible.genre} de ${Math.round(cible.tailleOctets / 1024 ** 3)} Go · ${plan.partitions.length} partition(s), reste ${plan.resteGo} Go.` : (plan.blocage ?? 'Plan impossible : cible trop petite.'), data: plan };
      },
    },
    {
      id: 'cle_progres', label: 'Clé USB : progression de l\'écriture', read: true,
      what: 'L\'avancement d\'une écriture en cours (barre de progression) ; aucune écriture en cours = terminé',
      params: [{ key: 'cible', label: 'Cible (clé ou disque)', kind: 'text' }],
      words: ['progression de la clé', 'avancement de l\'écriture', 'où en est la clé'],
      // Aucune écriture longue n'est encore pilotée côté serveur (IoCle réelle non branchée) : la sonde reçoit une
      // réponse propre (« terminé ») au lieu d'une action inconnue, et la barre se referme sans rester bloquée.
      run: () => ({ ok: true, text: 'Aucune écriture en cours.', data: { pct: 0, etape: '', fini: true } }),
    },
    {
      id: 'cle_vms', label: 'Clé USB : machines virtuelles à copier', read: true, external: true,
      what: 'Les VM qu\'Odin peut copier sur la clé pour démarrer sur un vrai PC (VM locales d\'Hydre ; Proxmox : voie « disque exporté déposé »)',
      words: ['copier une vm', 'vm sur la clé', 'proxmox sur clé'],
      run: async (ctx) => {
        const vms = await listerVms(ctx);
        const locales = vms.filter((v) => v.origine === 'hydre-locale').length;
        return { ok: true, text: vms.length ? `${vms.length} VM : ${locales} locale(s) copiable(s) directement ; les VM Proxmox passent par un disque exporté déposé à la racine.` : 'Aucune VM vue par Hydre (Proxmox non réglé, ou aucune VM locale).', data: vms };
      },
    },
    {
      id: 'cle_racine', label: 'Clé USB : fichiers déposés à la racine', read: true,
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
