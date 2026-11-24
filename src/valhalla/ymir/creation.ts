// Hydre, lot M4 (maquette « Conteneurs et machines » validée le 23/11, écrans 12 à 12e) : créer une VM de ce PC en
// quatre étapes, branchée sur la bibliothèque des systèmes et les profils de Genèse.
//   1. Système : seulement un système PRÊT de la bibliothèque (empreinte vérifiée — celle de l'éditeur, ou revérifiée par
//      Odin —, antivirus passé, pas une ancienne version) ; « l'installer tout seul » quand Hydre sait le faire dans une
//      VM (Ubuntu, Debian) : ton compte, ta langue, ton clavier, ton fuseau ; le profil de logiciels de Genèse est noté.
//   2. Machine : nom, processeurs, mémoire, disque, avec le BUDGET de ce PC : refus si c'est plus que ce qu'il peut donner
//      en gardant de quoi faire tourner Odin (les chiffres sont dits) ; au-delà de ton budget sans accord (4 Go de
//      mémoire et 50 Go de disque pour toutes les machines créées par Odin), le bouton « Créer » vaut accord.
//   3. Réseau et options : le réseau des machines, ou aucun réseau ; les applis d'Odin branchées dessus.
//   4. Vérifier et créer, puis le compte rendu commun (cahier « machines et conteneurs » § 3.6) : où, comment entrer, ce
//      qui a été fait et essayé (avec la preuve), ce qui reste.
// Garde-fous :
//   - au propriétaire seul (noté dans « qui a fait quoi ») ; refusé tout net hors Linux (sous Windows, la page dit ce qui
//     viendra) ;
//   - le disque n'est créé QUE dans le dossier des VM : nom sûr, dossier neuf (jamais un dossier qui existe déjà), aucun
//     raccourci au-dessus ni à la place, chemin réel revérifié avant et après ; un raté efface seulement ce dossier neuf ;
//   - le mot de passe de la session (installation toute seule) est créé par Odin et rangé au coffre, jamais montré ni
//     rendu ; les fichiers de réponses qui le contiennent (sous forme chiffrée pour Linux) restent dans le dossier de la
//     VM le temps de l'installation, puis sont effacés.
// Comment la VM s'installe toute seule (rien d'autre que QEMU, déjà l'outil des VM de ce PC) :
//   - Ubuntu : son noyau et son initrd lus dans l'ISO (Genèse sait lire une ISO sans la monter), démarrés avec
//     « autoinstall », et les réponses sur un petit disque en lecture seule nommé CIDATA (un dossier montré par QEMU) ;
//   - Debian : les réponses (preseed) ajoutées à son initrd ;
//   - le premier redémarrage arrête la VM (installation finie) : la veille d'Hydre la relance sur son disque, sans ISO
//     ni réponses, et efface les réponses.
// Windows, Fedora, Rocky, AlmaLinux et les autres : installés à la main, par leur écran (à venir : tout seuls).
import { randomBytes } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, rmdirSync, rmSync, statfsSync, statSync, writeFileSync } from 'node:fs';
import { createConnection } from 'node:net';
import { cpus, totalmem } from 'node:os';
import { dirname, join } from 'node:path';
import { gzipSync } from 'node:zlib';
import type { Action, ActionResult, ModCtx } from '../types.ts';
import { avecJournal } from '../vidarr/qui-a-fait.ts';
import { Iso } from '../thjalfi/iso.ts';
import { debianPreseed, detect, motDePassePc, ubuntuMetaData, ubuntuUserData, type Answer, type Recipe } from '../thjalfi/recipes.ts';
import { allumee, famille, Local, newMac, systemeVm, VM_WINDOWS, type Machine } from './local.ts';
import { bibliotheque, pilotesVirtio, profilVm, trouverIso, type FicheIso } from './isos.ts';
import { synchroEspace } from './bibliotheque.ts';
import { trouverExact } from './dependances.ts';
import { effacerArbre, enRetrait, memeChemin, NOM_SUR, raccourciAuDessus } from './retrait.ts';

const s = (v: unknown) => (v === undefined || v === null ? '' : String(v));
const oui = (v: unknown) => v === true || v === 'true' || v === 'on' || v === 1 || v === '1';
const GO = 1024 ** 3;
const go = (n: number) => `${Math.round(n * 10) / 10}`.replace('.', ',');

// ---------------------------------------------------------------- 1. Le système
/** L'état d'un système de la bibliothèque pour une VM. Seul « pret » se choisit. */
export type EtatSysteme = 'pret' | 'verification' | 'empreinte' | 'bloque' | 'ancienne' | 'pilotes' | 'mac';
/** Pourquoi un système n'est pas prêt, dit simplement. */
export const RAISONS: Record<Exclude<EtatSysteme, 'pret'>, string> = {
  verification: 'l\'antivirus ne l\'a pas encore vu (ou a un doute) : pas encore prêt',
  empreinte: 'son empreinte n\'est pas encore vérifiée (ni celle de l\'éditeur, ni une revérification d\'Odin)',
  bloque: 'bloqué par l\'antivirus ou empreinte changée depuis son arrivée : jamais utilisé',
  ancienne: 'ancienne version rangée dans « old »',
  pilotes: 'ce sont des pilotes, pas un système',
  mac: 'macOS ne se met pas dans une VM de ce PC (licence d\'Apple)',
};
/** Un système est prêt : empreinte vérifiée, antivirus passé, ni ancien, ni pilotes, ni macOS. Pur. */
export function etatSysteme(f: Pick<FicheIso, 'sha256' | 'editeur' | 'verifiee' | 'antivirus' | 'ancienne' | 'pilotes' | 'systeme'>): EtatSysteme {
  if (f.pilotes) return 'pilotes';
  if (f.ancienne) return 'ancienne';
  if (f.antivirus?.verdict === 'bloqué' || f.verifiee?.ok === false) return 'bloque';
  if (f.systeme === 'macOS') return 'mac';
  if (f.antivirus?.verdict !== 'sain') return 'verification';
  if (!f.sha256 || !(f.editeur === true || f.verifiee?.ok === true)) return 'empreinte';
  return 'pret';
}
/** Ce qu'Odin propose pour un système (« ce qu'il demande au minimum, un peu plus »). Pur. */
export function proposition(f: { systeme?: string; detail?: string; edition?: string }): { cpu: number; memoire: number; disque: number } {
  const d = `${f.detail ?? ''} ${f.edition ?? ''}`.toLowerCase();
  if (f.systeme === 'Windows') return /server/.test(d) ? { cpu: 2, memoire: 4, disque: 40 } : { cpu: 2, memoire: 4, disque: 64 };
  if (f.systeme === 'Linux') return /serveur|server|réseau|minimale|netinst/.test(d) ? { cpu: 2, memoire: 2, disque: 20 } : { cpu: 2, memoire: 4, disque: 25 };
  return { cpu: 1, memoire: 2, disque: 15 };
}
/** Les genres d'installation qu'Hydre sait faire tout seuls dans une VM de ce PC. */
export const AUTO_VM = new Set<Recipe['kind']>(['ubuntu', 'debian']);
/** Ce que dit la page pour l'installation toute seule, selon le genre de l'ISO. Pur. */
export function autoDe(kind: Recipe['kind'] | undefined): { auto: boolean; texte: string } {
  if (kind === 'ubuntu') return { auto: true, texte: 'Ubuntu s\'installe tout seul (son installateur automatique).' };
  if (kind === 'debian') return { auto: true, texte: 'Debian s\'installe tout seul (réponses préparées par Odin) ; il lui faut Internet.' };
  if (kind === 'windows') return { auto: false, texte: 'Windows : à installer par son écran pour l\'instant (tout seul dans une VM : à venir).' };
  if (kind === 'rhel') return { auto: false, texte: 'Fedora, Rocky, AlmaLinux : à installer par leur écran pour l\'instant (tout seul : à venir).' };
  return { auto: false, texte: 'Ce système s\'installe (ou démarre) par son écran.' };
}
/** Le genre de chaque ISO (lu une fois par fichier, tant qu'il ne change pas). */
const GENRES = new Map<string, Recipe['kind']>();
export async function genreIso(chemin: string, taille: number): Promise<Recipe['kind'] | undefined> {
  const k = `${chemin}\n${taille}`; if (GENRES.has(k)) return GENRES.get(k);
  let iso: Iso | undefined, r: Recipe['kind'] | undefined;
  try { iso = await Iso.open(chemin); r = (await detect(iso)).kind; } catch { r = undefined; } finally { await iso?.close(); }
  if (r) GENRES.set(k, r); return r;
}

// ---------------------------------------------------------------- 2. Le budget
/** Ce que ce PC sait de lui-même (les essais le remplacent : aucune vraie mesure). */
export const hoteVm = {
  coeurs: (): number => cpus().length,
  memoire: (): number => totalmem(),
  /** la place du disque où sont rangées les VM (le dossier, ou le plus proche qui existe) */
  disque: (dir: string): { total: number; libre: number } | undefined => {
    for (let d = dir, k = 0; k < 12; k++, d = dirname(d)) { if (existsSync(d)) { try { const f = statfsSync(d); return { total: Number(f.blocks) * Number(f.bsize), libre: Number(f.bavail) * Number(f.bsize) }; } catch { return undefined; } } if (dirname(d) === d) break; }
    return undefined;
  },
};
export interface Budget {
  coeurs: number; coeursMax: number;
  memoireGo: number; reserveGo: number; machinesGo: number; memoireMaxGo: number;
  disqueLibreGo?: number; reserveDisqueGo?: number; disqueMaxGo?: number;
  /** ton budget sans accord, pour toutes les machines créées par Odin */
  accord: { memoireGo: number; disqueGo: number; odinMemoireGo: number; odinDisqueGo: number };
}
/**
 * Ce que ce PC peut donner à une nouvelle VM, en gardant de quoi faire tourner Odin. Pur.
 *   - processeurs : au plus tous sauf un (un cœur reste à Odin) ;
 *   - mémoire : le total, moins ce qu'Odin garde (6 Go, ou plus du tiers sur un gros PC), moins la mémoire de TOUTES les
 *     machines de ce PC (allumées ou non : elles peuvent toutes tourner en même temps) ;
 *   - disque : la place libre du disque des VM, moins une réserve (20 Go, ou 10 % du disque) ; le disque d'une VM ne
 *     prend au début que ce qui est écrit dedans, mais il peut grandir jusqu'à sa taille : elle est comptée en entier.
 */
export function budgetVm(h: { coeurs: number; memoire: number; disque?: { total: number; libre: number } }, machines: Array<Pick<Machine, 'ram' | 'disque' | 'estModele'>>, reglage?: { memoireGo?: number; disqueGo?: number }): Budget {
  const memoireGo = Math.floor(h.memoire / GO), reserveGo = Math.max(6, Math.ceil(memoireGo * 0.35));
  const vivantes = machines.filter((m) => !m.estModele), machinesGo = Math.ceil(vivantes.reduce((a, m) => a + (Number(m.ram) || 0), 0) / 1024);
  const b: Budget = { coeurs: h.coeurs, coeursMax: Math.max(1, h.coeurs - 1), memoireGo, reserveGo, machinesGo, memoireMaxGo: Math.max(0, memoireGo - reserveGo - machinesGo),
    accord: { memoireGo: Number(reglage?.memoireGo) > 0 ? Number(reglage!.memoireGo) : 4, disqueGo: Number(reglage?.disqueGo) > 0 ? Number(reglage!.disqueGo) : 50, odinMemoireGo: machinesGo, odinDisqueGo: vivantes.reduce((a, m) => a + (Number(m.disque) || 0), 0) } };
  if (h.disque && h.disque.total > 0) {
    const libre = Math.floor(h.disque.libre / GO), total = Math.floor(h.disque.total / GO), reserve = Math.max(20, Math.ceil(total * 0.1));
    Object.assign(b, { disqueLibreGo: libre, reserveDisqueGo: reserve, disqueMaxGo: Math.max(0, libre - reserve) });
  }
  return b;
}
/** Le verdict pour une demande : les refus (avec les chiffres), et ce qui demande ton accord. Pur. */
export function verdictBudget(b: Budget, d: { cpu: number; memoire: number; disque: number }): { refus: string[]; accord?: string } {
  const refus: string[] = [];
  if (!(d.cpu >= 1)) refus.push('Processeurs : au moins 1.');
  else if (d.cpu > b.coeursMax) refus.push(`Processeurs : ${d.cpu} demandés, ${b.coeursMax} au plus (ce PC en a ${b.coeurs} ; un reste à Odin).`);
  if (!(d.memoire >= 1)) refus.push('Mémoire : au moins 1 Go.');
  else if (d.memoire > b.memoireMaxGo) refus.push(`Mémoire : ${d.memoire} Go demandés, ${b.memoireMaxGo} Go au plus (ce PC a ${b.memoireGo} Go ; ${b.reserveGo} Go gardés pour Odin ; ${b.machinesGo} Go déjà donnés à tes machines).`);
  if (!(d.disque >= 8)) refus.push('Disque : au moins 8 Go.');
  else if (b.disqueMaxGo === undefined) refus.push('Disque : Odin ne sait pas lire la place libre du disque des machines ; rien n\'est créé.');
  else if (d.disque > b.disqueMaxGo) refus.push(`Disque : ${d.disque} Go demandés, ${b.disqueMaxGo} Go au plus (${b.disqueLibreGo} Go libres ; ${b.reserveDisqueGo} Go gardés pour Odin et tes fichiers).`);
  const mem = b.accord.odinMemoireGo + (d.memoire || 0), dk = b.accord.odinDisqueGo + (d.disque || 0);
  const au = [mem > b.accord.memoireGo ? `${mem} Go de mémoire` : '', dk > b.accord.disqueGo ? `${dk} Go de disque` : ''].filter(Boolean);
  return { refus, ...(au.length ? { accord: `avec elle, les machines créées par Odin prendraient ${au.join(' et ')} : au-delà de ton budget sans accord (${b.accord.memoireGo} Go de mémoire et ${b.accord.disqueGo} Go de disque)` } : {}) };
}
/** Le budget de ce PC maintenant. */
export function budgetIci(ctx: ModCtx, L = new Local(ctx)): Budget {
  return budgetVm({ coeurs: hoteVm.coeurs(), memoire: hoteVm.memoire(), disque: hoteVm.disque(join(L.dir, 'vm')) }, L.list(), ctx.settings.budgetVm as { memoireGo?: number; disqueGo?: number } | undefined);
}

// ---------------------------------------------------------------- Le dossier neuf de la VM
/**
 * Crée le dossier d'une nouvelle VM dans le dossier des VM, et seulement là : nom sûr, aucun raccourci (ni le dossier des
 * VM, ni celui des machines au-dessus), un dossier NEUF (un dossier qui existe déjà n'est jamais repris), chemin réel
 * relu après la création. Rend son chemin réel.
 */
export function creerDossierVm(base: string, nom: string): string {
  if (!NOM_SUR.test(nom)) throw new Error('nom refusé : des lettres minuscules sans accent, des chiffres et des tirets (63 au plus), en commençant par une lettre ou un chiffre');
  const raccourci = () => new Error('le dossier des machines virtuelles est un raccourci vers un autre endroit : Odin ne suit aucun raccourci, rien n\'est créé');
  if (raccourciAuDessus(base)) throw raccourci();
  mkdirSync(base, { recursive: true });
  if (raccourciAuDessus(base)) throw raccourci();
  const reelle = realpathSync.native(base), p = join(reelle, nom);
  let deja = true; try { lstatSync(p); } catch { deja = false; }
  if (deja) throw new Error(`un dossier « ${nom} » existe déjà dans le dossier des machines : il n'est jamais repris, rien n'est créé`);
  // Pas « recursive » : échoue s'il vient d'apparaître (une autre création au même instant).
  try { mkdirSync(p, { mode: 0o700 }); } catch (e) { throw new Error((e as NodeJS.ErrnoException).code === 'EEXIST' ? `un dossier « ${nom} » vient d'apparaître dans le dossier des machines : il n'est jamais repris, rien n'est créé` : 'le système refuse de créer le dossier de la machine : rien n\'est créé'); }
  const st = lstatSync(p);
  if (st.isSymbolicLink() || !st.isDirectory() || !memeChemin(realpathSync.native(p), p) || !memeChemin(realpathSync.native(base), reelle)) throw new Error('le dossier de la machine a changé pendant sa création : rien n\'est créé');
  return p;
}
/** Efface un dossier de VM créé par cette action (seulement s'il est toujours un vrai dossier, sans raccourci). */
function defaire(p: string): void {
  try { const st = lstatSync(p); if (st.isSymbolicLink() || !st.isDirectory() || !memeChemin(realpathSync.native(p), p)) return; effacerArbre(p); rmdirSync(p); } catch { /* laissé tel quel : rien d'autre n'est touché */ }
}
/** Un sous-dossier de la VM (réponses, fichiers d'installation), vérifié : un vrai dossier, dans le sien. */
function sousDossier(p: string, nom: string): string {
  const d = join(p, nom); mkdirSync(d, { mode: 0o700 });
  const st = lstatSync(d); if (st.isSymbolicLink() || !st.isDirectory()) throw new Error('le dossier de la machine a changé pendant sa création : rien n\'est créé');
  return d;
}

// ---------------------------------------------------------------- L'installation toute seule
/** Une archive « newc » (le format des initrd) avec quelques fichiers à la racine. Pur. */
export function cpioNewc(fichiers: Array<{ nom: string; donnees: Buffer; mode?: number }>): Buffer {
  const parts: Buffer[] = []; let ino = 1;
  const pad = (n: number) => Buffer.alloc((4 - (n % 4)) % 4);
  const ent = (nom: string, d: Buffer, mode: number, nlink: number) => {
    const name = Buffer.from(`${nom}\0`, 'utf8');
    const h = `070701${[ino++, mode, 0, 0, nlink, 0, d.length, 0, 0, 0, 0, name.length, 0].map((v) => v.toString(16).padStart(8, '0').toUpperCase()).join('')}`;
    parts.push(Buffer.from(h, 'latin1'), name, pad(110 + name.length), d, pad(d.length));
  };
  for (const f of fichiers) { if (!/^[\w.-]{1,64}$/.test(f.nom)) throw new Error(`nom de fichier refusé dans l'archive : ${f.nom}`); ent(f.nom, f.donnees, 0o100000 | (f.mode ?? 0o600), 1); }
  ino = 0; ent('TRAILER!!!', Buffer.alloc(0), 0, 1);
  return Buffer.concat(parts);
}
/** L'adresse de suivi des réponses de Genèse : dans une VM de ce PC, personne n'y répond (le suivi se fait par Hydre). */
export const SUIVI_INERTE = 'http://127.0.0.1:9/hydre/etat/vm';
/** Langue, clavier, fuseau : vérifiés, car ils sont écrits tels quels dans les réponses. Purs. */
export const LANGUE = /^[a-z]{2,3}_[A-Z]{2}(\.UTF-8)?$/, CLAVIER = /^[a-z]{2,8}(-[a-z0-9]{1,12})?$/, FUSEAU = /^(UTC|[A-Z][A-Za-z_]+(\/[A-Z][A-Za-z0-9_+-]+){1,2})$/;
/** Un compte Linux : minuscules, chiffres, tiret, souligné ; pas « root » ni un compte du système. */
export const COMPTE = /^[a-z_][a-z0-9_-]{0,30}$/;
const COMPTES_PRIS = new Set(['root', 'daemon', 'bin', 'sys', 'sync', 'games', 'man', 'lp', 'mail', 'news', 'uucp', 'proxy', 'www-data', 'backup', 'list', 'irc', 'nobody', 'systemd-network', 'messagebus', 'sshd', 'ubuntu', 'debian']);
/** La langue, le clavier et le fuseau de ce PC (pour proposer). Pur sur ses entrées. */
export function reglagesLocaux(o: { locale?: string; timeZone?: string } = Intl.DateTimeFormat().resolvedOptions()): { langue: string; clavier: string; fuseau: string } {
  const m = /^([a-z]{2,3})(?:-([A-Z]{2}))?/.exec(o.locale ?? ''), l = m?.[1] ?? 'en', p = m?.[2] ?? (l === 'en' ? 'US' : l.toUpperCase());
  const clavier = ({ en: 'us', fr: 'fr', de: 'de', es: 'es', it: 'it', pt: 'pt', nl: 'us', ar: 'ara', sw: 'us' } as Record<string, string>)[l] ?? 'us';
  const tz = o.timeZone && FUSEAU.test(o.timeZone) ? o.timeZone : 'UTC';
  const langue = `${l}_${p}.UTF-8`;
  return { langue: LANGUE.test(langue) ? langue : 'en_US.UTF-8', clavier, fuseau: tz };
}
/** Ce qu'il faut pour installer tout seul : les fichiers à écrire et la ligne de démarrage. Pur. */
export interface PlanAuto { kind: 'ubuntu' | 'debian'; reponses: Record<string, string>; noyau: string; initrd: string; ajout: string; preseed?: string }
export function planAuto(kind: Recipe['kind'], a: Answer, instance: string): PlanAuto {
  if (kind === 'ubuntu') return { kind, reponses: { 'user-data': ubuntuUserData(a), 'meta-data': ubuntuMetaData(instance) }, noyau: 'casper/vmlinuz', initrd: 'casper/initrd', ajout: 'autoinstall ds=nocloud ---' };
  if (kind === 'debian') return { kind, reponses: {}, preseed: debianPreseed(a), noyau: 'install.amd/vmlinuz', initrd: 'install.amd/initrd.gz', ajout: 'auto=true priority=critical ---' };
  throw new Error('ce système ne s\'installe pas encore tout seul dans une VM de ce PC');
}
/** Les options de QEMU pour le démarrage d'installation (noyau de l'ISO, réponses en lecture seule, arrêt au redémarrage). Pur. */
export function argsInstallation(p: { kind: 'ubuntu' | 'debian'; noyau: string; initrd: string; ajout: string; reponses?: string }): string[] {
  const a = ['-kernel', p.noyau, '-initrd', p.initrd, '-append', p.ajout, '-no-reboot'];
  // Une virgule dans le chemin se double (sinon QEMU la lirait comme une autre option).
  if (p.reponses) a.push('-drive', `file.driver=vvfat,file.dir=${p.reponses.replace(/,/g, ',,')},file.label=CIDATA,format=raw,if=none,id=reponses,readonly=on`, '-device', 'virtio-blk-pci,drive=reponses');
  return a;
}

// ---------------------------------------------------------------- Le compte rendu commun (§ 3.6)
export interface Essai { quoi: string; ok: boolean | null; preuve: string }
export interface CompteRendu {
  nom: string;
  ou: Array<[string, string]>; entrer: Array<[string, string]>; fait: Array<[string, string]>;
  essaye: Essai[]; reste: string[];
}
/** Le compte rendu d'une machine créée par Hydre : où, comment entrer, fait, essayé (avec la preuve), reste. Pur. */
export function compteRendu(m: Machine, e: { etat: string; essais?: Essai[]; reseau: { pont: string; prefixe: string } }): CompteRendu {
  const c = m.creation, win = m.famille === 'Windows', sansReseau = Boolean(m.sansReseau || m.quarantaine);
  const ou: Array<[string, string]> = [['Nom', m.nom], ['Adresse', sansReseau ? `${m.ip} (réservée ; ${m.quarantaine ? 'en quarantaine' : 'aucun réseau'})` : m.ip]];
  if (!sansReseau && m.apps.includes('vidarr')) ou.push(['Nom sur le réseau', `${m.nom}.maison`]);
  ou.push(['Réseau', sansReseau ? 'aucun' : e.reseau.pont === 'lxcbr0' ? `à part, derrière Odin (${e.reseau.prefixe}.0/24)` : `le réseau de la maison (pont ${e.reseau.pont})`], ['Sur', 'ce PC']);
  const compte = c?.compte;
  const entrer: Array<[string, string]> = [
    ['Compte', compte ?? 'celui que tu crées pendant l\'installation'],
    ['Mot de passe', compte && c?.coffre ? `au coffre (« ${c.coffre} »), jamais montré ici` : 'celui que tu choisis pendant l\'installation'],
    ['Par l\'écran', 'Machines → sa carte → son écran et son clavier'],
  ];
  if (!win && !sansReseau && compte) entrer.push(['Commande', `ssh ${compte}@${m.apps.includes('vidarr') ? `${m.nom}.maison` : m.ip}`]);
  if (win && !sansReseau) entrer.push(['Bureau à distance', `${m.ip} (une fois activé dans Windows)`]);
  const dur = c?.fin && c.at ? Math.max(1, Math.round((c.fin - c.at) / 60_000)) : undefined;
  const fait: Array<[string, string]> = [
    ['Système', `${m.systeme}${m.version ? ` ${m.version}` : ''}`],
    ['Image', c ? `${c.iso.nom}${c.iso.sha256 ? ` · empreinte ${c.iso.sha256.slice(0, 16)}…${c.iso.editeur ? ' (celle de l\'éditeur ✓)' : ' (revérifiée par Odin ✓)'}` : ''}` : 'inconnue (machine d\'avant ce compte rendu)'],
    ['Ressources', `${m.cpu} cœur${m.cpu > 1 ? 's' : ''} · ${Math.round(m.ram / 1024)} Go de mémoire · disque de ${m.disque} Go`],
    ['Installation', !c ? '—' : c.auto ? `toute seule (${c.auto === 'ubuntu' ? 'installateur automatique d\'Ubuntu' : 'réponses Debian'}) · ${c.installation === 'en cours' ? 'en cours' : c.installation === 'finie' ? `finie${dur ? ` en ${dur} min` : ''}` : 'interrompue'}` : 'à la main, par son écran'],
  ];
  if (c?.auto) fait.push(['Langue, clavier, fuseau', `${c.langue ?? ''} · ${c.clavier ?? ''} · ${c.fuseau ?? ''}`]);
  if (c?.profil) fait.push(['Profil de logiciels (Genèse)', c.profil.nom]);
  const reste: string[] = [];
  if (c?.installation === 'en cours') reste.push('Attendre la fin de l\'installation (elle redémarre seule sur son disque ; Odin te prévient).');
  if (c?.installation === 'à la main') reste.push('Installer le système par son écran (Machines → sa carte), si ce n\'est pas déjà fait.');
  if (c?.installation === 'interrompue') reste.push('L\'installation a été arrêtée avant la fin : recommence-la, ou supprime la machine.');
  if (c?.profil) reste.push(`Poser les logiciels du profil « ${c.profil.nom} » : Hydre ne le fait pas encore tout seul dans une VM.`);
  if (!c?.auto && c) reste.push('Note le compte et le mot de passe choisis à l\'installation dans le coffre.');
  reste.push('Décider : la garder, la ranger dans une catégorie, ou la supprimer (Machines).');
  return { nom: m.nom, ou, entrer, fait, essaye: e.essais ?? [], reste };
}
/** Le compte rendu en texte (conversation, notification). Pur. */
export function texteCompteRendu(r: CompteRendu): string {
  const l = (t: Array<[string, string]>) => t.map(([k, v]) => `  ${k} : ${v}`).join('\n');
  return [`Où :\n${l(r.ou)}`, `Comment entrer :\n${l(r.entrer)}`, `Fait :\n${l(r.fait)}`, `Essayé :\n${r.essaye.map((x) => `  ${x.ok === true ? '✓' : x.ok === false ? '✗' : '…'} ${x.quoi} — ${x.preuve}`).join('\n') || '  —'}`, `Reste :\n${r.reste.map((x) => `  · ${x}`).join('\n')}`].join('\n');
}
/** Les essais faits de l'extérieur de la VM (les essais les remplacent : aucun réseau). */
export const essaisVm = {
  ping: async (ctx: ModCtx, ip: string): Promise<boolean> => { const r = await ctx.run('ping', ['-c', '1', '-W', '1', ip], { timeoutMs: 4000 }).catch(() => ({ code: 1 })); return r.code === 0; },
  port: (ip: string, port: number, ms = 2000): Promise<boolean> => new Promise((ok) => { const c = createConnection({ host: ip, port }); const t = setTimeout(() => { c.destroy(); ok(false); }, ms); c.on('connect', () => { clearTimeout(t); c.end(); ok(true); }); c.on('error', () => { clearTimeout(t); ok(false); }); }),
};
/** La VM tourne-t-elle ? Son numéro de processus est vivant (c'est bien QEMU). */
function pidVivant(L: Local, m: Machine): number | undefined {
  try { const pid = Number(readFileSync(join(L.vmDir(m), 'pid'), 'utf8').trim()); return pid > 0 && systemeVm.enVie(pid) ? pid : undefined; } catch { return undefined; }
}
/** Les essais d'une machine maintenant : démarrée, répond au réseau, accès à distance (après l'installation). */
async function essayer(ctx: ModCtx, L: Local, m: Machine, o: { creation?: boolean } = {}): Promise<{ etat: string; essais: Essai[] }> {
  const e = await L.etat(m).catch(() => ({ state: 'inconnue' as const })), c = m.creation, essais: Essai[] = [];
  const taille = c ? (c.iso.taille >= GO ? `${go(c.iso.taille / GO)} Go` : `${Math.max(1, Math.round(c.iso.taille / 1024 ** 2))} Mo`) : '';
  if (c) essais.push({ quoi: 'Image vérifiée avant l\'emploi', ok: true, preuve: `${c.iso.editeur ? 'empreinte de l\'éditeur' : 'empreinte revérifiée par Odin'}, antivirus : sain, taille relue (${taille})` });
  if (c) essais.push({ quoi: 'Disque créé dans le dossier des VM', ok: existsSync(join(L.vmDir(m), 'disque.qcow2')), preuve: existsSync(join(L.vmDir(m), 'disque.qcow2')) ? `disque.qcow2, ${m.disque} Go au plus` : 'disque.qcow2 introuvable' });
  const pid = pidVivant(L, m);
  essais.push(allumee(e) ? { quoi: 'Démarre', ok: true, preuve: `${e.state}${pid ? ` (processus ${pid})` : ''}` } : { quoi: 'Démarre', ok: c?.installation === 'en cours' ? false : null, preuve: e.state === 'inconnue' ? 'état illisible' : 'éteinte en ce moment' });
  // Juste créée et à installer à la main : le système n'est pas encore là, rien à essayer sur le réseau.
  const reseau = !m.sansReseau && !m.quarantaine, fini = !c || c.installation === 'finie' || (c.installation === 'à la main' && !o.creation);
  if (!reseau) essais.push({ quoi: 'Réseau', ok: null, preuve: m.quarantaine ? 'en quarantaine : aucun réseau' : 'aucun réseau choisi' });
  else if (!fini || !allumee(e)) essais.push({ quoi: 'Répond sur le réseau', ok: null, preuve: !allumee(e) ? 'éteinte' : c?.installation === 'à la main' ? 'pas encore : le système s\'installe par son écran' : c?.installation === 'interrompue' ? 'installation interrompue' : 'pas encore : installation en cours' });
  else {
    const p = await essaisVm.ping(ctx, m.ip).catch(() => false);
    essais.push({ quoi: 'Répond sur le réseau', ok: p, preuve: p ? `ping ${m.ip} : répond` : `ping ${m.ip} : pas de réponse (adresse fixe à régler dans le système de la VM ?)` });
    const port = m.famille === 'Windows' ? 3389 : 22, o = await essaisVm.port(m.ip, port).catch(() => false);
    essais.push({ quoi: m.famille === 'Windows' ? 'Bureau à distance' : 'Connexion à distance (SSH)', ok: o, preuve: `port ${port} de ${m.ip} : ${o ? 'répond' : 'fermé ou muet'}` });
  }
  return { etat: e.state, essais };
}

// ---------------------------------------------------------------- Lire (étapes de la page) et créer
const AVENIR_WIN = (): string[] => [
  'À venir : Hydre pilotera l\'hyperviseur livré avec Windows (éditions Pro, Entreprise, Éducation) : créer, démarrer, mettre en pause, instantanés, écran dans le navigateur.',
  'Sur Windows Famille, qui n\'a pas cet hyperviseur : l\'outil de machines virtuelles libre (QEMU), installé sur ce PC comme outil local.',
];
/** Hors Linux, rien n'est créé : la raison, et ce qui viendra. */
export function horsLinuxVm(): string | undefined { return horsLinux(); }
function horsLinux(): string | undefined {
  const p = systemeVm.plateforme(); if (p === 'linux') return undefined;
  return p === 'win32' ? `Refusé, rien n'est créé. ${VM_WINDOWS} ${AVENIR_WIN().join(' ')}` : 'Refusé, rien n\'est créé : les VM de ce PC ne tournent pour l\'instant que sous Linux.';
}
/** Les profils de logiciels de Genèse (lecture ; refusée ou absente : aucun). */
async function profilsGenese(ctx: ModCtx): Promise<{ lu: boolean; profils: Array<{ id: string; nom: string; logiciels: Record<string, number> }> }> {
  try {
    const r = await ctx.call('thjalfi', 'profils_logiciels', {}, 'les profils de logiciels pour une nouvelle VM', { interne: true });
    if (r.ok === false) return { lu: false, profils: [] };
    const l = ((r.data as { profils?: Array<{ id?: unknown; nom?: unknown; systemes?: Record<string, { logiciels?: unknown[] }> }> } | undefined)?.profils ?? []);
    return { lu: true, profils: l.filter((p) => typeof p.id === 'string' && typeof p.nom === 'string').slice(0, 30).map((p) => ({ id: String(p.id).slice(0, 80), nom: String(p.nom).slice(0, 60), logiciels: Object.fromEntries(Object.entries(p.systemes ?? {}).map(([k, v]) => [k, Array.isArray(v?.logiciels) ? v.logiciels.length : 0])) })) };
  } catch { return { lu: false, profils: [] }; }
}
/** Un nom proposé : « vm-ubuntu-1 », « vm-debian-2 »… (le premier libre). Pur. */
export function nomPropose(f: { distribution?: string; systeme?: string; detail?: string }, pris: string[]): string {
  const b = (f.distribution || (f.systeme === 'Windows' ? (/server/i.test(f.detail ?? '') ? 'windows-server' : 'windows') : f.systeme) || 'machine').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'machine';
  for (let k = 1; k < 1000; k++) { const n = `vm-${b}-${k}`; if (!pris.includes(n)) return n; }
  return `vm-${b}-${randomBytes(3).toString('hex')}`;
}
/** Les ISO de la bibliothèque, telles que l'étape 1 les montre (et telles que la création les revérifie). */
async function systemesVm(ctx: ModCtx, L: Local): Promise<Array<Record<string, unknown>>> {
  await synchroEspace(ctx);
  const l = await bibliotheque(ctx), pris = L.list().map((m) => m.nom), out: Array<Record<string, unknown>> = [];
  for (const f of l) {
    const etat = etatSysteme(f); if (etat === 'ancienne' || etat === 'pilotes') continue;
    const kind = etat === 'pret' ? await genreIso(f.chemin, f.taille) : undefined, a = autoDe(kind);
    out.push({ id: f.id, nom: f.nom, detail: f.detail || f.nom, systeme: f.systeme, famille: famille(`${f.systeme} ${f.distribution ?? ''} ${f.detail ?? ''}`), version: f.version ?? '', edition: f.edition ?? '', taille: f.taille, sha256: f.sha256 ? `${f.sha256.slice(0, 16)}…` : '', editeur: f.editeur === true, verifieLe: f.verifiee?.at ?? f.antivirus?.at ?? f.ajoute, etat, ...(etat === 'pret' ? {} : { raison: RAISONS[etat] }), auto: a.auto, autoTexte: a.texte, proposition: proposition(f), nomPropose: nomPropose(f, pris) });
  }
  return out.sort((a, b) => Number(b.etat === 'pret') - Number(a.etat === 'pret') || String(a.detail).localeCompare(String(b.detail)));
}

export function creationActions(): Action[] {
  return [
    {
      id: 'creation_vm', label: 'Créer une VM : ce qu\'il faut', read: true, quick: false, proprietaireSeul: true,
      what: 'Pour les quatre étapes de « Créer une VM » : les systèmes prêts de la bibliothèque, les profils de logiciels de Genèse, le budget de ce PC, le réseau ; rien n\'est écrit',
      run: async (ctx) => {
        const L = new Local(ctx), b = budgetIci(ctx, L), win = systemeVm.plateforme() === 'win32', r = L.reseau();
        const [systemes, pg, manque] = await Promise.all([systemesVm(ctx, L), profilsGenese(ctx), L.manque('vm')]);
        const prets = systemes.filter((x) => x.etat === 'pret').length;
        return { text: `${prets} système(s) prêt(s) · mémoire : ${b.memoireMaxGo} Go au plus pour une nouvelle VM · ${b.coeursMax} cœur(s) au plus${b.disqueMaxGo !== undefined ? ` · disque : ${b.disqueMaxGo} Go au plus` : ''}`,
          data: { plateforme: systemeVm.plateforme(), ...(win ? { windows: { maintenant: VM_WINDOWS, avenir: AVENIR_WIN() } } : {}), refus: horsLinux() ?? '', manque, kvm: L.kvm(), systemes, profils: pg.profils, profilsLus: pg.lu, budget: b,
            reseau: { pont: r.pont, prefixe: r.prefixe, maison: r.pont !== 'lxcbr0' }, apps: [{ id: 'vordr', nom: 'Pulsar', quoi: 'surveillance (prévient si elle ne répond plus)' }, { id: 'vidarr', nom: 'Sphinx', quoi: 'son nom sur le réseau (.maison)' }], reglages: { ...reglagesLocaux(), compte: 'odin' } } };
      },
    },
    ...avecJournal('ymir_actes', [{
      id: 'creer_vm', label: 'Créer une VM', proprietaireSeul: true, quick: false, external: true,
      what: 'Crée une VM de ce PC depuis un système prêt de la bibliothèque (empreinte vérifiée), dans le budget de ce PC ; l\'installe toute seule quand c\'est possible, puis rend compte (où, comment entrer, fait, essayé, reste)',
      params: [{ key: 'iso', label: 'Système (bibliothèque)', kind: 'text', required: true }, { key: 'nom', label: 'Nom', kind: 'text', required: true }, { key: 'coeurs', label: 'Processeurs', kind: 'number', default: 2 }, { key: 'memoire', label: 'Mémoire (Go)', kind: 'number', default: 2 }, { key: 'disque', label: 'Disque (Go)', kind: 'number', default: 20 },
        { key: 'reseau', label: 'Réseau (machines, aucun)', kind: 'select', options: ['machines', 'aucun'], default: 'machines' }, { key: 'auto', label: 'L\'installer tout seul', kind: 'boolean', default: false }, { key: 'compte', label: 'Compte (installation toute seule)', kind: 'text', default: 'odin' },
        { key: 'langue', label: 'Langue (ex. fr_FR.UTF-8)', kind: 'text', default: '' }, { key: 'clavier', label: 'Clavier (ex. fr)', kind: 'text', default: '' }, { key: 'fuseau', label: 'Fuseau (ex. Europe/Paris)', kind: 'text', default: '' },
        { key: 'profil', label: 'Profil de logiciels (Genèse)', kind: 'text', default: '' }, { key: 'apps', label: 'Applis d\'Odin (vordr, vidarr)', kind: 'text', default: 'vordr, vidarr' }, { key: 'categorie', label: 'Catégorie', kind: 'text', default: '' }],
      grave: (i, ctx) => graveVm(ctx, i.nom, { cpu: Number(i.coeurs) || 0, memoire: Number(i.memoire) || 0, disque: Number(i.disque) || 0 }),
      run: creerVm,
    }]),
    {
      id: 'compte_rendu_machine', label: 'Compte rendu', read: true, quick: false, proprietaireSeul: true,
      what: 'Le compte rendu d\'une machine de ce PC : où, comment entrer (le mot de passe reste au coffre), ce qui a été fait, ce qui a été essayé (essais refaits maintenant), ce qui reste',
      params: [{ key: 'machine', label: 'Machine (nom exact)', kind: 'text', required: true }],
      run: async (ctx, i) => {
        const L = new Local(ctx), m = trouverExact(L, i.machine), x = await essayer(ctx, L, m), r = compteRendu(m, { etat: x.etat, essais: x.essais, reseau: L.reseau() });
        return { text: `${m.nom}\n${texteCompteRendu(r)}`, data: { compteRendu: r } };
      },
    },
  ];
}

/** Lit un nombre entier (ou rien). */
const entier = (v: unknown): number => { const x = Number(v); return Number.isFinite(x) ? Math.round(x) : NaN; };

/**
 * Une seule création de VM à la fois dans ce processus : deux créations lancées ensemble liraient le même budget (chacune
 * « tient », les deux ensemble non) et la même première adresse libre. La deuxième est refusée, rien n'est créé.
 */
let creationEnCours: string | undefined;
/** Les VM en train d'être créées (de leur fiche à leur démarrage) : la veille ne les touche pas. */
const EN_CREATION = new Set<string>();
const nonCree = (t: string): ActionResult => ({ ok: false, text: /^Refusé/.test(t) ? t : `Refusé, rien n'est créé : ${t}` });

/** Hors Linux, puis une seule création de VM à la fois (le même verrou pour « creer_vm » et « creer_machine » genre vm). */
async function verrouVm(nom: unknown, faire: () => Promise<ActionResult>): Promise<ActionResult> {
  const hors = horsLinux(); if (hors) return { ok: false, text: hors };
  if (creationEnCours !== undefined) return nonCree(`une autre VM (« ${creationEnCours} ») est en train d'être créée : attends la fin, puis recommence (le budget de ce PC est relu à chaque création).`);
  creationEnCours = s(nom).trim().slice(0, 63) || 'sans nom';
  try { return await faire(); } finally { creationEnCours = undefined; }
}
/** Le refus du budget de ce PC (avec les chiffres), ou rien. */
function refusBudget(ctx: ModCtx, L: Local, d: { cpu: number; memoire: number; disque: number }): ActionResult | undefined {
  const v = verdictBudget(budgetIci(ctx, L), d);
  return v.refus.length ? { ok: false, text: `Refusé, rien n'est créé : ce PC ne peut pas le donner en gardant de quoi faire tourner Odin.\n${v.refus.map((x) => `· ${x}`).join('\n')}`, data: { refus: v.refus } } : undefined;
}
/** Ce que dit la validation d'une création de VM (au-delà de ton budget sans accord), ou rien. */
export function graveVm(ctx: ModCtx | undefined, nom: unknown, d: { cpu: number; memoire: number; disque: number }): string | undefined {
  // Sans Odin pour relire le budget (liste des liens, graphe) : comptée grave, par prudence.
  if (!ctx) return `créer la VM ${s(nom).slice(0, 63)} : le budget de ce PC est relu au moment de créer (au-delà, ton accord)`;
  try { const v = verdictBudget(budgetIci(ctx), d); return v.refus.length ? undefined : v.accord ? `créer la VM ${s(nom).slice(0, 63)} : ${v.accord}` : undefined; } catch { return undefined; }
}

/**
 * Les garde-fous de « creer_vm », pour l'ancienne création d'une VM (« creer_machine » genre vm, appelée par Genèse et par
 * la conversation) : hors Linux refusé, une seule création à la fois, le budget de ce PC, un nom libre, un dossier NEUF
 * dans le dossier des VM (aucun raccourci). « faire » crée la machine dans ce dossier ; s'il échoue avant que la machine
 * soit notée, le dossier neuf est retiré (rien d'autre n'est touché). Ton accord : la fonction « grave » (graveVm).
 */
export function avecGardeFousVm(ctx: ModCtx, nom: string, d: { cpu: number; memoire: number; disque: number }, faire: (L: Local) => Promise<ActionResult>): Promise<ActionResult> {
  return verrouVm(nom, async () => {
    const L = new Local(ctx);
    const b = refusBudget(ctx, L, d); if (b) return b;
    if (L.list().some((m) => m.nom === nom)) return nonCree(`le nom « ${nom} » est déjà pris.`);
    let p: string; try { p = creerDossierVm(join(L.dir, 'vm'), nom); } catch (e) { return nonCree(`${(e as Error).message}.`); }
    try { return await faire(L); } catch (e) { if (!L.list().some((m) => m.nom === nom)) defaire(p); throw e; }
  });
}

async function creerVm(ctx: ModCtx, i: Record<string, unknown>): Promise<ActionResult> {
  return verrouVm(i.nom, () => creerVmSeule(ctx, i));
}

async function creerVmSeule(ctx: ModCtx, i: Record<string, unknown>): Promise<ActionResult> {
  const non = nonCree;
  const L = new Local(ctx), now = ctx.now().getTime();
  // Le système : relu ici (jamais ce que la page décrit), prêt, et toujours le même fichier.
  await synchroEspace(ctx);
  let f: FicheIso; try { f = await trouverIso(ctx, i.iso); } catch (e) { return non((e as Error).message); }
  if (!(s(i.iso) === f.id || s(i.iso) === f.chemin || s(i.iso) === f.nom)) return non(`choisis le système exact dans la bibliothèque (« ${s(i.iso).slice(0, 80)} » n'en désigne aucun à coup sûr).`);
  const etat = etatSysteme(f); if (etat !== 'pret') return non(`${f.nom} : ${RAISONS[etat]}.`);
  try { if (statSync(f.chemin).size !== Number(f.taille)) return non(`${f.nom} a changé depuis sa vérification : Odin la revérifie avant de s'en servir.`); } catch { return non(`${f.nom} est introuvable sur le disque.`); }
  const miss = await L.manque('vm'); if (miss.length) return non(`il manque sur ce PC : ${miss.join(', ')} (paquets « qemu-system-x86 » et « qemu-utils »).`);
  // La machine : nom sûr, libre ; ressources dans le budget de ce PC.
  const nom = s(i.nom).trim();
  if (!NOM_SUR.test(nom)) return non('nom : des lettres minuscules sans accent, des chiffres et des tirets (63 au plus), en commençant par une lettre ou un chiffre.');
  if (L.list().some((m) => m.nom === nom)) return non(`le nom « ${nom} » est déjà pris.`);
  const d = { cpu: entier(i.coeurs), memoire: entier(i.memoire), disque: entier(i.disque) };
  const refus = refusBudget(ctx, L, d); if (refus) return refus;
  // Réseau et options.
  const sansReseau = s(i.reseau) === 'aucun';
  if (s(i.reseau) && !['machines', 'aucun'].includes(s(i.reseau))) return non('réseau : « machines » ou « aucun » (la cage d\'essai viendra plus tard).');
  const apps = sansReseau ? [] : s(i.apps).split(/[,\s]+/).map((x) => x.trim().toLowerCase()).filter((x) => x === 'vordr' || x === 'vidarr');
  // Installation toute seule : seulement là où Hydre sait le faire ; compte, langue, clavier, fuseau vérifiés.
  const auto = oui(i.auto), kind = await genreIso(f.chemin, f.taille), loc = reglagesLocaux();
  const compte = s(i.compte).trim() || 'odin', langue = s(i.langue).trim() || loc.langue, clavier = s(i.clavier).trim() || loc.clavier, fuseau = s(i.fuseau).trim() || loc.fuseau;
  if (auto) {
    if (!kind || !AUTO_VM.has(kind)) return non(autoDe(kind).texte);
    if (kind === 'debian' && sansReseau) return non('Debian s\'installe par Internet : choisis le réseau des machines, ou installe-la à la main.');
    if (!COMPTE.test(compte) || COMPTES_PRIS.has(compte)) return non('compte : des minuscules, des chiffres, « - » ou « _ » (31 au plus), et pas un compte du système (root…).');
    if (!LANGUE.test(langue)) return non('langue : par exemple fr_FR.UTF-8.');
    if (!CLAVIER.test(clavier)) return non('clavier : par exemple fr, us, de.');
    if (!FUSEAU.test(fuseau)) return non('fuseau : par exemple Europe/Paris, Indian/Mayotte ou UTC.');
  }
  // Le profil de logiciels de Genèse : relu chez Genèse (jamais celui que la page décrit).
  let profil: { id: string; nom: string } | undefined;
  if (s(i.profil)) { const pg = await profilsGenese(ctx); const p = pg.profils.find((x) => x.id === s(i.profil)); if (!p) return non('profil de logiciels introuvable chez Genèse (relis la liste).'); profil = { id: p.id, nom: p.nom }; }
  const ip = await L.prochaineIp(); if (!ip) return non('plus d\'adresse libre sur le réseau des machines.');
  const prof = profilVm(f, { ovmf: Boolean(L.ovmf()), swtpm: await ctx.has('swtpm'), kvm: L.kvm() }, pilotesVirtio(await bibliotheque(ctx)));
  const systeme = f.systeme === 'Linux' ? (f.distribution ?? 'Linux') : f.systeme === 'Windows' ? (f.detail || 'Windows') : (f.detail || 'Système');
  const version = /^Windows /.test(systeme) ? '' : f.version ?? /(\d+(?:\.\d+){0,2})/.exec(f.detail)?.[1] ?? '';
  const m: Machine = { id: randomBytes(6).toString('hex'), nom, genre: 'vm', systeme, version, famille: famille(systeme), ...(s(i.categorie).trim() ? { categorie: s(i.categorie).trim().slice(0, 40) } : {}),
    cpu: d.cpu, ram: d.memoire * 1024, disque: d.disque, ip, mac: newMac(), cree: now, iso: f.chemin, uefi: prof.uefi, profil: { disque: prof.disque, reseau: prof.reseau, tpm: prof.tpm, ...(prof.pilotes ? { pilotes: prof.pilotes } : {}) }, apps, paquets: [],
    ...(sansReseau ? { sansReseau: true } : {}),
    creation: { at: now, iso: { nom: f.nom, sha256: f.sha256 ?? '', editeur: f.editeur === true, taille: Number(f.taille) }, auto: auto ? kind as 'ubuntu' | 'debian' : false, installation: auto ? 'en cours' : 'à la main', ...(auto ? { compte, langue, clavier, fuseau } : {}), ...(profil ? { profil } : {}) } };
  // Le dossier neuf, dans le dossier des VM seulement.
  let p: string; try { p = creerDossierVm(join(L.dir, 'vm'), nom); } catch (e) { return non(`${(e as Error).message}.`); }
  EN_CREATION.add(m.id);
  try { return await creerVmDans(ctx, L, m, p, { f, d, auto, kind, compte, langue, clavier, fuseau, ip, apps }); } finally { EN_CREATION.delete(m.id); }
}

async function creerVmDans(ctx: ModCtx, L: Local, m: Machine, p: string, o: { f: FicheIso; d: { cpu: number; memoire: number; disque: number }; auto: boolean; kind: Recipe['kind'] | undefined; compte: string; langue: string; clavier: string; fuseau: string; ip: string; apps: string[] }): Promise<ActionResult> {
  const { f, d, auto, kind, compte, langue, clavier, fuseau, ip, apps } = o, nom = m.nom, non = nonCree;
  const extra: string[] = [];
  try {
    if (auto && kind) {
      // Le mot de passe de la session : créé ici, rangé au coffre, écrit (chiffré pour Linux) dans les réponses, jamais rendu.
      const mdp = motDePassePc(), plan = planAuto(kind, { host: nom, user: compte, password: mdp, locale: langue, keymap: clavier, timezone: fuseau, packages: [], report: SUIVI_INERTE }, m.id);
      const inst = sousDossier(p, 'installation');
      let iso: Iso | undefined;
      try {
        iso = await Iso.open(f.chemin);
        writeFileSync(join(inst, 'noyau'), await iso.file(plan.noyau, 64 * 1024 * 1024), { mode: 0o600 });
        const initrd = await iso.file(plan.initrd, 1024 * 1024 * 1024);
        writeFileSync(join(inst, 'initrd'), plan.preseed !== undefined ? Buffer.concat([initrd, gzipSync(cpioNewc([{ nom: 'preseed.cfg', donnees: Buffer.from(plan.preseed) }]))]) : initrd, { mode: 0o600 });
      } finally { await iso?.close(); }
      let rep: string | undefined;
      if (Object.keys(plan.reponses).length) { rep = sousDossier(p, 'reponses'); for (const [n, c] of Object.entries(plan.reponses)) writeFileSync(join(rep, n), c, { mode: 0o600 }); }
      extra.push(...argsInstallation({ kind: plan.kind, noyau: join(inst, 'noyau'), initrd: join(inst, 'initrd'), ajout: plan.ajout, ...(rep ? { reponses: rep } : {}) }));
      const coffre = `Machine ${nom} · compte ${compte}`;
      const rc = await ctx.call('brisingamen', 'ajouter', { nom: coffre, identifiant: compte, mot_de_passe: mdp, site: `Hydre · VM ${nom} (${ip})`, coffre: 'TOUFATECH' }, `ranger le mot de passe de la VM ${nom}`, { interne: true }).catch((e: Error) => ({ ok: false, text: e.message }));
      if (rc.ok === false) throw new Error(`le coffre n'a pas pu ranger son mot de passe (${s(rc.text).split('\n')[0].slice(0, 160)}) : rien n'est créé (installe-la à la main, ou ouvre le coffre)`);
      m.creation!.coffre = coffre;
    }
    // Le disque, dans le dossier neuf ; relu ensuite : un vrai fichier, dans ce dossier.
    const r = await ctx.run('qemu-img', ['create', '-f', 'qcow2', join(p, 'disque.qcow2'), `${d.disque}G`], { timeoutMs: 120_000, sudo: true });
    if (r.code !== 0) throw new Error(`disque de la VM : ${(r.err || r.out).trim().split('\n').at(-1)?.slice(0, 200) || `code ${r.code}`}`);
    const st = lstatSync(join(p, 'disque.qcow2')); if (st.isSymbolicLink() || !st.isFile()) throw new Error('le disque n\'est pas là où il devait être créé');
    if (!memeChemin(realpathSync.native(p), join(realpathSync.native(join(L.dir, 'vm')), nom))) throw new Error('le dossier de la machine a changé pendant sa création');
    writeFileSync(join(p, 'vm.json'), JSON.stringify(m, null, 1));
    L.save([...L.list(), m]);
  } catch (e) {
    defaire(p);
    return non(`${(e as Error).message}${m.creation?.coffre ? ` (l'entrée « ${m.creation.coffre} » du coffre peut être retirée)` : ''}.`);
  }
  // Démarrer : installation toute seule (noyau de l'ISO, réponses, arrêt au premier redémarrage), ou ISO à l'écran.
  const notes: string[] = [];
  try { await L.demarrer(m, f.chemin, { extra }); } catch (e) {
    notes.push(`⚠ Démarrage : ${(e as Error).message}`);
    // Elle n'a jamais tourné : l'installation n'a pas eu lieu. Notée « interrompue » et ses réponses effacées tout de suite
    // (sinon la veille la croirait installée et la relancerait sur un disque vide).
    if (auto) { effacerReponses(L, m); const x = L.list().find((y) => y.id === m.id); if (x?.creation) { x.creation.installation = 'interrompue'; x.creation.fin = ctx.now().getTime(); L.update(x); } }
  }
  if (!L.kvm()) notes.push('Ce PC n\'a pas KVM : la VM tourne en émulation, beaucoup plus lentement.');
  const { brancher } = await import('./machines.ts');
  if (apps.length) notes.push(...await brancher(ctx, L, m));
  ctx.emit('machine_creee', { nom: m.nom, genre: 'vm', ip: m.ip });
  const mm = L.list().find((x) => x.id === m.id) ?? m, x = await essayer(ctx, L, mm, { creation: true }), cr = compteRendu(mm, { etat: x.etat, essais: x.essais, reseau: L.reseau() });
  return { text: `✅ ${m.nom} créée (${m.systeme}${m.version ? ` ${m.version}` : ''}, ${m.cpu} cœur(s), ${d.memoire} Go, ${m.disque} Go) · ${m.ip} · ${auto ? 'elle s\'installe toute seule' : 'installe-la par son écran'}${notes.length ? `\n${notes.join('\n')}` : ''}\n${texteCompteRendu(cr)}`,
    data: { machine: { id: m.id, nom: m.nom, ip: m.ip }, compteRendu: cr } };
}

/**
 * La veille : une VM qui s'installait toute seule et qui s'est arrêtée (son premier redémarrage arrête QEMU) : ses
 * réponses sont effacées (le mot de passe n'y reste pas) ; arrêtée par Odin seul, elle est relancée sur son disque, sans
 * ISO ni réponses, et tu es prévenu ; arrêtée par toi, l'installation est notée « interrompue ».
 */
/** Efface les réponses d'installation d'une VM (et le noyau copié) : seulement ses deux sous-dossiers, jamais un raccourci suivi. */
function effacerReponses(L: Local, m: Machine): void {
  const p = L.vmDir(m);
  for (const sd of ['reponses', 'installation']) {
    const d = join(p, sd);
    try { const st = lstatSync(d); if (st.isSymbolicLink()) { rmSync(d, { force: true }); continue; } if (st.isDirectory() && memeChemin(realpathSync.native(d), d)) { effacerArbre(d); rmdirSync(d); } } catch { /* déjà parti */ }
  }
}

export async function finInstallations(ctx: ModCtx): Promise<void> {
  const L = new Local(ctx);
  // Pas une VM en train d'être créée (elle n'a pas encore démarré), ni une VM en train d'être supprimée.
  for (const m of L.list().filter((x) => x.genre === 'vm' && x.creation?.installation === 'en cours' && x.creation.auto && !EN_CREATION.has(x.id) && !enRetrait(x.id))) {
    const e = await L.etat(m).catch(() => ({ state: 'inconnue' as const }));
    if (e.state !== 'éteinte') continue;
    if (EN_CREATION.has(m.id) || enRetrait(m.id)) continue;
    effacerReponses(L, m);
    const x = L.list().find((y) => y.id === m.id); if (!x?.creation || x.creation.installation !== 'en cours') continue;
    const parToi = Boolean(x.arretVoulu);
    x.creation.installation = parToi ? 'interrompue' : 'finie'; x.creation.fin = ctx.now().getTime(); L.update(x);
    if (parToi) continue;
    try {
      await L.demarrer(x);
      ctx.alert({ level: 'info', title: `${x.nom} est installée`, detail: `Elle redémarre sur son disque (sans ISO ni réponses, effacées). Compte : ${x.creation.compte ?? '—'} ; mot de passe au coffre. Le compte rendu est dans Hydre (Machines → ${x.nom}).`, key: `ymir-installee-${x.id}`, fix: { action: 'compte_rendu_machine', input: { machine: x.id }, label: 'Compte rendu' } });
    } catch (err) {
      ctx.alert({ level: 'moyenne', title: `${x.nom} : installée, mais ne redémarre pas`, detail: (err as Error).message.slice(0, 300), key: `ymir-installee-${x.id}`, fix: { action: 'demarrer_machine', input: { machine: x.id }, label: 'Démarrer' } });
    }
  }
}
