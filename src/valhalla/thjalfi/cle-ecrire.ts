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
import { classer, sourceReelle, sourceSimulee, type Disque, type Disques, type SourceDisques } from './disques.ts';
import { planDualBoot, planRetrait, type Plan } from './cle-plan.ts';
import { analyserVdisk, type AnalyseVdisk } from './vdisk.ts';
// Le CONTRAT et les VRAIS constructeurs du lot B (plus aucun stub mort) : une seule source pour PreparationCle,
// un seul descripteur de Ventoy (empreinte vérifiée), et les constructeurs réellement appelés par l'écriture.
import type { PreparationCle, SystemeCle } from './cle-types.ts';
import { FICHIERS_ODIN } from './cle-types.ts';
import { buildVentoyJson, descripteurVentoy, type DescripteurVentoy } from './cle-boot.ts';
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
  };
  return io;
}

// ---------------- L'orchestrateur ----------------
export interface LigneJournalCle { at: number; dest: string; sha256: string; octets?: number }
export interface ResultatEcriture { ok: boolean; message: string; manifeste: LigneJournalCle[] }
export interface Avancement { etape: string; fait: number; total: number }

/** La disposition des fichiers sur la 1re partition ODIN (contrat, section 2). */
export const DOSSIER = { iso: 'ISO', vdisk: 'vdisk', logicielsWindows: 'logiciels/windows', logicielsLinux: 'logiciels/linux', ventoy: 'ventoy', ecran: 'ecran-odin', odin: 'odin' } as const;

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
  // Le total des étapes, pour une barre de progression honnête.
  const total = 1 + prep.systemes.length + prep.images.length + prep.vdisks.length + prep.logiciels.length + 4 + prep.systemes.length;
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
  if (s.recipe.os === 'windows') return apercu({ famille: 'windows', answer, fw: prep.schema === 'mbr' ? 'bios' : 'uefi', opt: { retirerExigences: true, effacerApres: false }, logiciels: prep.logiciels });
  const famille = s.recipe.kind === 'debian' ? 'debian' : s.recipe.kind === 'rhel' ? 'rhel' : 'ubuntu';
  const scripts = apercu({ famille, answer, token, debsCle: prep.logiciels.map((l) => l.fichier).filter((f) => /\.deb$/i.test(f)) });
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
      params: [{ key: 'disque', label: 'Identifiant de la clé', kind: 'text', required: true }, { key: 'effacer', label: 'Tout effacer (clé non ODIN)', kind: 'boolean', default: false }],
      grave: (i) => (i.effacer ? 'préparer une clé USB en effaçant tout son contenu' : 'préparer une clé USB ODIN'),
      words: ['préparer la clé', 'écrire la clé', 'créer une clé bootable'],
      run: async (ctx) => {
        // La préparation réelle est pilotée par la page (choix des systèmes, thème…), puis exécutée ici avec une
        // IO réelle. Tant que la page n'a pas composé une PreparationCle complète, on renvoie l'état des disques.
        const d = classer(await sourceDe(ctx).lister());
        journal(ctx).ajouter({ at: Date.now(), dest: '(demande de préparation)', sha256: '', cible: 'ODIN' });
        return { ok: true, text: 'Choisis une clé et les systèmes dans la page « Clé USB », puis valide : Odin affiche le plan et demande ton accord avant d\'écrire.', data: d };
      },
    },
  ];
  return { actions };
}
