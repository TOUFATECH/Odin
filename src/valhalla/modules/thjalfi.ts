// Genèse · le déploiement par le réseau (façon iVentoy, netboot.xyz, FOG), réécrit pour Odin.
//   - Les ISO d'Andromède démarrent par le réseau (PXE, BIOS et UEFI) sans clé USB : Odin les lit directement
//     dans les fichiers .iso, sans les extraire.
//   - Une machine que tu autorises s'installe toute seule (Ubuntu, Debian, Fedora / Rocky / Alma, Windows) :
//     compte, langue, clavier, fuseau, paquets ; à la fin, les logiciels de Hermès (Windows) et les paquets
//     choisis (Linux) s'installent, puis la machine prévient Odin avec le nom qu'elle a pris sur le réseau.
//   - Tu vois les machines en cours, l'ISO de chacune et son étape, celles déjà passées, et combien de fois
//     chaque ISO a été déployée.
//   - Chaque poste est suivi jusqu'à la fin (terminée, échouée, abandonnée) ; tu peux le bloquer, annuler son
//     installation, suspendre toutes les installations, ou exiger un mot de passe sur le poste (voir thjalfi/suivi.ts
//     et thjalfi/cle.ts) ; tout reste dans l'historique, en base.
// Sécurité : une machine inconnue démarre par défaut sur son propre disque ; l'installation automatique
// (qui efface le disque) ne se fait que pour une machine autorisée par toi, une seule fois.
import { VIRTUAL_IFACE } from '../../hlidskjalf/discover.ts';
import { createHash, randomBytes } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statfsSync, statSync, writeFileSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { basename, join } from 'node:path';
import type { Action, ActionResult, Kpi, ModCtx, Module, Section } from '../types.ts';
import { journalDe } from '../base/journal.ts';
import { Iso } from '../thjalfi/iso.ts';
import { ProxyDhcp, bootFor, type Firmware } from '../thjalfi/pxe.ts';
import { debianPreseed, detect, kickstart, menu, motDePassePc, nomsDesPcs, scriptFinLinux, odinCmd, silentArgs, ubuntuMetaData, ubuntuUserData, unattend, windowsAfter, winpeshl, type Answer, type Recipe } from '../thjalfi/recipes.ts';
import { familleLogiciel, installeAuto, modeInstall, versScripts } from '../thjalfi/logiciels-cle.ts';
import { autorisationPour, autorisationValable, choixIdentiteExige, cleIdentite, identiteDifferente, identitesConnues, identitesEnConflit, MEMOIRE_IDENTITES_MS, normMac, PxeHttp, tailleDisqueVue, type AutorisationPc, type IdentiteConnue, type IdentiteNotee, type IdentiteVue } from '../thjalfi/server.ts';
import { DISPOSITIONS, TEXT_THEMES, category, TEXT_THEME_IDS, THEMES, odinSays, systems, textLook, textThemeOf, themeOf, type Disposition, type TextTheme } from '../thjalfi/ecran.ts';
import { imageKind, textBackground } from '../thjalfi/fond.ts';
import { ALPINE_MIRROR, kioskBoot, kioskOverlay, parseLatest, untar } from '../thjalfi/ecran-pc.ts';
import { gunzipSync } from 'node:zlib';
import { ecranPage } from '../thjalfi/ecran-page.ts';
import { fenetreFin } from '../thjalfi/ecrans-communs.ts';
import { TftpServer } from '../thjalfi/tftp.ts';
import { identite, suivi, type FicheFin, type Passage, type Resultat } from '../thjalfi/suivi.ts';
import { pxeHook, type DhcpConfig, type Lease, type Packet } from '../vidarr/dhcp.ts';
import { DhcpAPart, MODES_ADRESSES, RESEAU, conclure, lignesBox, modeAdresses, plageParDefaut, refusCarte, refusPartage, verifierPlage, type CarteReseau, type Garde, type PlageComplet } from '../thjalfi/reseau.ts';
import { cleUsb } from '../thjalfi/cle-ecrire.ts';
import { defautSur, idsPropres, installe, lireMenu, menuPxeCfg, ordonner, visibles, type MenuPxeCfg } from '../thjalfi/menu-pxe.ts';
import { EDITIONS, clePourImage, clesPubliques, deposerCle, editionDeImage, editionDepuisChoix, masque, supprimerCle } from '../thjalfi/cles-windows.ts';
import { apercu as apercuScripts, appliquerOptionsWindows, injecterSautExigences, nomCompteValide, optionsWindowsDe, osDuScript, scriptsRevus, type ScriptPerso } from '../thjalfi/scripts.ts';
import { phraseNormale } from '../thjalfi/cle-ecrire.ts';
import { chiffrerChamp, dechiffrerChamp } from '../../vault.ts';
import { agissant } from '../sso/acces.ts';
import { BASE_RULES, RuleSet, compileGaldr, flat as plusieursConstats, scanBuffer } from '../ullr/engine.ts';

const s = (x: unknown) => (typeof x === 'string' ? x : x === undefined || x === null ? '' : String(x));
type Step = 'démarrage réseau' | 'chargeur' | 'menu' | 'chargement' | 'installation' | 'logiciels' | 'fini' | 'sans nouvelles' | 'échec';
const FINAL: Step[] = ['fini', 'sans nouvelles', 'échec'];
export interface IsoInfo { id: string; name: string; path: string; size: number; mtime: number; recipe?: Recipe; err?: string; /** son état dans la bibliothèque commune (absent : Hydre n'est pas là) */ etat?: 'prête' | 'scannée' | 'ancienne' }
export interface Rule { mac: string; nom?: string; iso?: string; profil?: string; auto: boolean; fait?: boolean; ajoute: number }
export interface Profile { id: string; nom: string; utilisateur: string; paquets: string[]; logiciels: string[]; langue: string; clavier: string; fuseau: string; /** false : pas de compagnon d'Odin à la fin */ compagnon?: boolean }
export interface Machine extends Passage { mac: string; ip?: string; fw?: string; iso?: string; isoName?: string; step: Step; steps: Array<{ at: number; step: string; detail?: string }>; started: number; updated: number; host?: string; token?: string; profil?: string; logiciels?: Array<{ nom: string; ok: boolean }>; /** la taille de son disque (octets), quand le PC l'a dite */ disque?: number }
interface Session { token: string; mac: string; iso: string; profil: string; host: string; fw: 'uefi' | 'bios'; created: number; files?: Record<string, string>; /** l'installation est finie ou ratée depuis cette heure : le jeton ne sert plus que 10 min */ fin?: number; /** Déployer (lot S6) : l'autorisation utilisée, et l'adresse du PC vérifié (ses fichiers ne vont qu'à elle) */ autorisation?: string; from?: string }
export interface Done extends FicheFin { at: number; mac: string; host?: string; ip?: string; iso: string; isoName: string; profil?: string; ms: number; result: Resultat; logiciels?: Array<{ nom: string; ok: boolean }> }
/** Un choix fait sur l'écran d'Odin, lu une seule fois par le menu de la machine. */
/** Le choix fait sur l'écran d'Odin : un système (essai, installation), le disque du PC, ou le menu TEXTE (« T »). */
interface Choix { iso: string; mode: 'essai' | 'installer' | 'disque' | 'texte'; at: number }
/** « Installer pour moi » demandé depuis l'écran : rien ne s'efface sans ton accord. */
export interface Demande { id: string; mac: string; iso: string; isoName: string; at: number; statut: 'attente' | 'acceptee' | 'refusee' | 'sans_effacer'; decide?: number; host?: string; depuis?: string }
export interface EcranCfg { actif: boolean; parDefaut: boolean; disposition: Disposition; theme: ReturnType<typeof themeOf>; texte: TextTheme; attente: number; /** l'écran graphique sur le PC lui-même (petit système) quand il est prêt */ surPc?: boolean }
interface Ports { http: number; tftp: number; dhcp: number; pxe: number; client: number }

/** Les chargeurs officiels (iPXE, wimboot) : téléchargés depuis leurs sites, jamais modifiés, analysés par Asclépios. */
export const LOADERS: Array<{ file: string; url: string; what: string }> = [
  { file: 'undionly.kpxe', url: 'https://boot.ipxe.org/undionly.kpxe', what: 'iPXE pour les PC en BIOS (ancien démarrage)' },
  { file: 'ipxe.efi', url: 'https://boot.ipxe.org/x86_64-efi/ipxe.efi', what: 'iPXE pour les PC en UEFI 64 bits' },
  { file: 'ipxe-arm64.efi', url: 'https://boot.ipxe.org/arm64-efi/ipxe.efi', what: 'iPXE pour les machines ARM 64 bits' },
  { file: 'wimboot', url: 'https://github.com/ipxe/wimboot/releases/latest/download/wimboot', what: 'wimboot (démarrage du programme d\'installation de Windows)' },
];
/** Déployer (lot S6) : les autorisations de déploiement par le réseau (fichier protégé du dossier de Genèse). */
const FICHIER_AUTORISATIONS = 'deploiements-autorises.json';
const slug = (n: string) => n.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\.iso$/i, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'iso';
const hostOf = (mac: string) => `pc-${mac.replace(/:/g, '').slice(-6)}`;
const hostLabel = (n: string) => n.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 63);
const ago = (ms: number) => { const m = Math.round(ms / 60000); return ms < 60_000 ? (ms < 5000 ? 'à l\'instant' : `${Math.round(ms / 1000)} s`) : m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}`; };
const STEP_ICON: Record<Step, string> = { 'démarrage réseau': '🔌', chargeur: '📦', menu: '📋', chargement: '⬇', installation: '🛠', logiciels: '🧩', fini: '✅', 'sans nouvelles': '❔', 'échec': '❌' };

/** Le module : une instance par Odin (état propre). */
export function thjalfi(): Module {
  let C: ModCtx | undefined; let http: PxeHttp | undefined, tftp: TftpServer | undefined, proxy: ProxyDhcp | undefined;
  const isoCache = new Map<string, IsoInfo>(); const open = new Map<string, Iso>();
  /** La bibliothèque d'ISO commune (Hydre, Andromède), relue au plus toutes les 5 s. */
  interface Biblio { at: number; /** les fichiers vus au dernier passage (un dossier qui change est relu tout de suite) */ vu?: string; d?: { images: Array<{ chemin: string; nom: string; etat: 'prête' | 'scannée' | 'ancienne' }>; enCours: Array<{ nom: string; recu: number; total?: number; pct?: number }>; quarantaine: Array<{ nom: string; menace: string }> } }
  let biblio: Biblio = { at: 0 };
  const ports = (ctx: ModCtx): Ports => ({ http: 16000, tftp: 69, dhcp: 67, pxe: 4011, client: 68, ...(ctx.settings.ports as Partial<Ports> | undefined) });
  const rules = (ctx: ModCtx): Rule[] => (ctx.settings.machines as Rule[] | undefined) ?? [];
  const profiles = (ctx: ModCtx): Profile[] => { const p = (ctx.settings.profils as Profile[] | undefined) ?? []; return p.length ? p : [{ id: 'standard', nom: 'Standard', utilisateur: 'admin', paquets: [], logiciels: [], langue: 'fr_FR.UTF-8', clavier: 'fr', fuseau: 'Indian/Mayotte' }]; };
  const bootDir = (ctx: ModCtx) => join(ctx.dir, 'boot');
  const live = (ctx: ModCtx): Record<string, Machine> => { try { return JSON.parse(readFileSync(join(ctx.dir, 'machines-en-cours.json'), 'utf8')) as Record<string, Machine>; } catch { return {}; } };
  const saveLive = (ctx: ModCtx, m: Record<string, Machine>) => { mkdirSync(ctx.dir, { recursive: true }); const f = join(ctx.dir, 'machines-en-cours.json'); writeFileSync(`${f}.tmp`, JSON.stringify(m)); renameSync(`${f}.tmp`, f); };
  const sessions = (ctx: ModCtx): Record<string, Session> => { try { return JSON.parse(readFileSync(join(ctx.dir, 'deploiements.json'), 'utf8')) as Record<string, Session>; } catch { return {}; } };
  const saveSessions = (ctx: ModCtx, x: Record<string, Session>) => { mkdirSync(ctx.dir, { recursive: true }); writeFileSync(join(ctx.dir, 'deploiements.json'), JSON.stringify(x), { mode: 0o600 }); };
  const secrets = (ctx: ModCtx): { profils?: Record<string, string>; partage?: string } => { try { return JSON.parse(readFileSync(join(ctx.dir, 'secrets.json'), 'utf8')); } catch { return {}; } };
  const saveSecrets = (ctx: ModCtx, x: ReturnType<typeof secrets>) => { mkdirSync(ctx.dir, { recursive: true }); writeFileSync(join(ctx.dir, 'secrets.json'), JSON.stringify(x), { mode: 0o600 }); };
  const histFile = (ctx: ModCtx) => join(ctx.dir, 'historique.jsonl');
  // L'historique des installations : dans la base de l'appli (GENESE_ODIN, journal « thjalfi ») dès qu'elle est prête, sinon historique.jsonl.
  const hist = (ctx: ModCtx) => journalDe<Done>(ctx, 'thjalfi', 'historique.jsonl', { garder: 2000 });
  const history = (ctx: ModCtx, n = 300): Done[] => { try { return S.replier(hist(ctx).tout()).slice(-n).reverse(); } catch { return []; } };
  const stats = (ctx: ModCtx): Record<string, { lances: number; finis: number }> => (ctx.settings.stats as Record<string, { lances: number; finis: number }> | undefined) ?? {};
  const ecranCfg = (ctx: ModCtx): EcranCfg => { const c = { actif: true, parDefaut: false, disposition: 'eventail' as Disposition, attente: 5, ...(ctx.settings.ecran as Partial<EcranCfg> | undefined) }; return { ...c, theme: themeOf(c.theme), texte: textThemeOf(c.texte) }; };
  // Les images de fond choisies par toi (sinon : celles du thème). Texte : PNG 1024 × 768 pour iPXE ; graphique : JPEG.
  const fondDir = (ctx: ModCtx) => join(ctx.dir, 'ecran');
  const fondFile = (ctx: ModCtx, kind: 'texte' | 'graphique') => join(fondDir(ctx), kind === 'texte' ? 'fond-texte.png' : 'fond-graphique.img');
  const fondPerso = (ctx: ModCtx, kind: 'texte' | 'graphique') => existsSync(fondFile(ctx, kind));
  function fond(ctx: ModCtx, kind: 'texte' | 'graphique'): { type: string; data: Buffer } | undefined {
    try { const data = readFileSync(fondFile(ctx, kind)), k = imageKind(data); if (k) return { type: `image/${k}`, data }; } catch { /* pas d'image à toi */ }
    if (kind === 'texte') { const t = ecranCfg(ctx).texte, data = t === 'classique' ? undefined : textBackground(t); if (data) return { type: 'image/png', data }; }
    return undefined;
  }
  // L'écran graphique sur le PC lui-même (façon B) : le petit système d'Alpine, prêt quand ses trois fichiers sont là.
  const alpineDir = (ctx: ModCtx) => join(bootDir(ctx), 'alpine');
  const KIOSK_FILES = ['vmlinuz-lts', 'initramfs-lts', 'modloop-lts'];
  function kiosk(ctx: ModCtx): { branch: string; version: string } | undefined {
    const a = ctx.settings.alpine as { branch?: string; version?: string } | undefined;
    return a?.branch && a.version && ecranCfg(ctx).surPc !== false && KIOSK_FILES.every((f) => existsSync(join(alpineDir(ctx), f))) ? { branch: a.branch, version: a.version } : undefined;
  }
  /** La copie locale des paquets d'Alpine : un paquet est gardé (signé par Alpine, vérifié par apk sur le PC) ; l'index est relu toutes les 6 h. */
  async function alpineCopy(ctx: ModCtx, path: string): Promise<Buffer | undefined> {
    if (!/^v\d+\.\d+\/(main|community)\/x86_64\/[\w.+-]+$/.test(path) || path.includes('..')) return undefined;
    const f = join(ctx.dir, 'alpine-copie', path), index = /APKINDEX/.test(path);
    try { const st = statSync(f); if (!index || Date.now() - st.mtimeMs < 6 * 3600_000) return readFileSync(f); } catch { /* pas encore copié */ }
    try {
      const r = await ctx.fetch(`${ALPINE_MIRROR}/${path}`, { signal: AbortSignal.timeout(300_000), headers: { 'user-agent': 'Odin-Thjalfi/1' } });
      if (!r.ok) return existsSync(f) ? readFileSync(f) : undefined;
      const b = Buffer.from(await r.arrayBuffer()); mkdirSync(join(f, '..'), { recursive: true }); writeFileSync(`${f}.part`, b); renameSync(`${f}.part`, f); return b;
    } catch { return existsSync(f) ? readFileSync(f) : undefined; }
  }
  /** Télécharge le petit système officiel d'Alpine (archive « netboot », empreinte publiée vérifiée) et garde noyau, initramfs et modloop. */
  async function prepareKiosk(ctx: ModCtx): Promise<string> {
    let rel; try { const r = await ctx.fetch(`${ALPINE_MIRROR}/latest-stable/releases/x86_64/latest-releases.yaml`, { signal: AbortSignal.timeout(30_000) }); if (r.ok) rel = parseLatest(await r.text()); } catch { /* hors ligne */ }
    if (!rel) return 'Écran sur le PC : liste des versions d\'Alpine illisible (Internet ?)';
    const have = ctx.settings.alpine as { version?: string } | undefined;
    if (have?.version === rel.version && kiosk(ctx)) return `✅ Écran sur le PC : Alpine ${rel.version} déjà prêt`;
    const tgz = join(alpineDir(ctx), rel.file), got = await fetchTo(ctx, `${ALPINE_MIRROR}/${rel.branch}/releases/x86_64/${rel.file}`, tgz, rel.sha256, 900_000);
    if (!got.ok) return `Écran sur le PC : ${got.text}`;
    try {
      const files = untar(gunzipSync(readFileSync(tgz)));
      for (const f of KIOSK_FILES) { const b = files.get(`boot/${f}`); if (!b) throw new Error(`${f} absent de l'archive`); writeFileSync(join(alpineDir(ctx), `${f}.part`), b); renameSync(join(alpineDir(ctx), `${f}.part`), join(alpineDir(ctx), f)); }
    } catch (e) { return `Écran sur le PC : ${(e as Error).message}`; } finally { rmSync(tgz, { force: true }); }
    ctx.saveSettings({ alpine: { branch: rel.branch, version: rel.version } });
    return `✅ Écran sur le PC : Alpine ${rel.version} (noyau, initramfs, modloop ; empreinte vérifiée)`;
  }
  /** Une image envoyée par l'interface (« image:clé », déposée dans images/) devient le fond ; « effacer » remet celui du thème. */
  function setFond(ctx: ModCtx, kind: 'texte' | 'graphique', ref: unknown, reset: unknown): string {
    if (reset === true || reset === 'true') { rmSync(fondFile(ctx, kind), { force: true }); return `fond ${kind} : celui du thème`; }
    const m = /^image:([a-z0-9_-]{1,40})$/.exec(s(ref)); if (!m) return '';
    const src = [join(ctx.dir, 'images', `${m[1]}.png`), join(ctx.dir, 'images', `${m[1]}.jpg`)].find((f) => existsSync(f)); if (!src) throw new Error('image introuvable : renvoie-la');
    const data = readFileSync(src), k = imageKind(data);
    if (!k || (kind === 'texte' && k !== 'png')) throw new Error(kind === 'texte' ? 'le fond texte doit être une image PNG' : 'image PNG ou JPEG attendue');
    mkdirSync(fondDir(ctx), { recursive: true }); writeFileSync(`${fondFile(ctx, kind)}.tmp`, data); renameSync(`${fondFile(ctx, kind)}.tmp`, fondFile(ctx, kind)); rmSync(src, { force: true });
    return `fond ${kind} : ton image`;
  }
  const jsonFile = <T,>(ctx: ModCtx, name: string, fallback: T): T => { try { return JSON.parse(readFileSync(join(ctx.dir, name), 'utf8')) as T; } catch { return fallback; } };
  const saveJson = (ctx: ModCtx, name: string, x: unknown) => { mkdirSync(ctx.dir, { recursive: true }); const f = join(ctx.dir, name); writeFileSync(`${f}.tmp`, JSON.stringify(x)); renameSync(`${f}.tmp`, f); };
  const choices = (ctx: ModCtx) => jsonFile<Record<string, Choix>>(ctx, 'ecran-choix.json', {});
  /** Le délai du menu (secondes, 0 à 300 ; 10 par défaut) : celui du menu texte ET de l'attente d'un choix sur l'écran. */
  const delaiMenu = (ctx: ModCtx) => { const d = Math.round(Number(ctx.settings.delai ?? 10)); return Number.isFinite(d) ? Math.max(0, Math.min(300, d)) : 10; };
  const demandes = (ctx: ModCtx): Demande[] => jsonFile<Demande[]>(ctx, 'ecran-demandes.json', []);
  const saveDemandes = (ctx: ModCtx, l: Demande[]) => { const now = ctx.now().getTime(); saveJson(ctx, 'ecran-demandes.json', l.filter((d) => now - d.at < 7 * 864e5).slice(-100)); };
  /** Le choix encore valable (30 min) de cette machine ; « prendre » l'efface (une seule fois). */
  const choiceOf = (ctx: ModCtx, mac: string, take = false): Choix | undefined => {
    const all = choices(ctx), c = all[mac]; if (!c) return undefined;
    const ok = ctx.now().getTime() - c.at < 30 * 60_000;
    if (take || !ok) { delete all[mac]; saveJson(ctx, 'ecran-choix.json', all); }
    return ok ? c : undefined;
  };
  const bump = (ctx: ModCtx, iso: string, k: 'lances' | 'finis') => { const st = stats(ctx); st[iso] = st[iso] ?? { lances: 0, finis: 0 }; st[iso][k]++; ctx.saveSettings({ stats: st }); };
  // Le suivi des installations (suivi.ts) : identité des postes, déroulement, blocage, annulation, mot de passe, rapport.
  const S = suivi({
    live, saveLive: (c, m) => saveLive(c, m as Record<string, Machine>), rules, sessions, saveSessions: (c, x) => saveSessions(c, x as Record<string, Session>), hist,
    secrets, saveSecrets: (c, x) => saveSecrets(c, x as ReturnType<typeof secrets>), track: (c, mac, ip, step, o) => track(c, mac, ip, step as Step, o), finish: (c, m, r) => finish(c, m as Machine, r),
    isoName: (id) => isoName(id), base: (c) => base(c), couper: (ip) => { http?.couper(ip); },
    infoIso: (id) => { const i = [...isoCache.values()].find((x) => x.id === id); return i ? { recette: i.recipe?.kind, auto: i.recipe?.auto, os: i.recipe?.os, taille: i.size } : undefined; },
    look: (c) => { const t = ecranCfg(c).texte; return textLook(t, fondPerso(c, 'texte') || t !== 'classique' ? `${base(c)}/ecran/fond-texte.png` : undefined); },
    // Suivi d'un déploiement (lot S7) : les autorisations du lot S6 ; « Recommencer » repasse par « deployer » (phrase, identité, coffre).
    autorisations: (c) => autorisations(c), saveAutorisations: (c, l) => saveAutorisations(c, l as AutorisationPc[]),
    // L'appareil vu aujourd'hui avec cette adresse doit être celui de la première autorisation (série, carte mère, disque) :
    // « deployer » relit l'identité du dernier appareil vu, qui peut être celui qui recopie l'adresse. Sinon : rien.
    redeployer: async (c, a, phrase) => {
      const x = a as AutorisationPc, m = live(c)[x.mac], h = history(c, 300).find((y) => y.mac === x.mac);
      const vu: IdentiteVue = { ...(m?.serie ?? h?.serie ? { serie: m?.serie ?? h?.serie } : {}), ...(m?.uuid ?? h?.uuid ? { uuid: m?.uuid ?? h?.uuid } : {}), ...(m?.disque ? { disque: m.disque } : {}) };
      const non = x.serie || x.uuid || x.disque ? identiteDifferente({ mac: x.mac, serie: x.serie, uuid: x.uuid, disque: x.disque }, x.mac, vu) : undefined;
      if (non) return { ok: false, text: `L'appareil vu avec l'adresse ${x.mac} n'est plus celui de la première autorisation (${non}) : Odin ne recommence pas. Vérifie ce PC (numéro de série sur son étiquette), puis passe par « Déployer ». Rien n'est autorisé, rien n'est effacé.` };
      return actionDeployer.run(c, { pcs: [x.mac], prochain: false, iso: x.iso, facon: x.facon, profil: x.profil ?? '', windows: x.windows ? JSON.stringify(x.windows) : '', phrase }, x.nom);
    },
    profilNom: (c, id) => { try { return lireProfils(c).liste.find((x) => x.id === id)?.nom; } catch { return undefined; } },
  });

  /** L'adresse d'Odin sur le réseau local (réglable). */
  const serverIp = (ctx: ModCtx): string => {
    if (s(ctx.settings.ip)) return s(ctx.settings.ip);
    // La carte choisie sur la page Réseau (lot S8) : Odin répond avec son adresse sur cette carte.
    const choisie = carteChoisie(ctx); if (choisie) return choisie.ip;
    const all = Object.entries(networkInterfaces()).filter(([n]) => !VIRTUAL_IFACE.test(n)).flatMap(([, l]) => l ?? []).filter((a) => a && a.family === 'IPv4' && !a.internal).map((a) => a!.address);
    return all.find((a) => /^192\.168\./.test(a)) ?? all.find((a) => /^10\./.test(a)) ?? all.find((a) => /^172\.(1[6-9]|2\d|3[01])\./.test(a)) ?? all[0] ?? '127.0.0.1';
  };
  const base = (ctx: ModCtx) => `http://${serverIp(ctx)}:${http?.port ?? ports(ctx).http}`;

  // ---------------- Les ISO (dossier d'Andromède) ----------------
  async function isoRoot(ctx: ModCtx): Promise<string> {
    // Un seul emplacement : l'espace ISO d'Andromède, partagé avec Hydre (pas de deuxième dossier à régler ici).
    try { const r = await ctx.call('eitri', 'etat', {}, 'lister les ISO à déployer'); const d = (r.data as { dossier?: string } | undefined)?.dossier; if (d) return d; } catch { /* Andromède absent */ }
    if (s(ctx.settings.dossier)) return s(ctx.settings.dossier);
    return join(ctx.home, 'ISO');
  }
  async function isos(ctx: ModCtx): Promise<IsoInfo[]> {
    const root = await isoRoot(ctx), out: IsoInfo[] = [], ids = new Set<string>();
    const walk = (dir: string, depth: number) => {
      let names: string[] = []; try { names = readdirSync(dir); } catch { return; }
      for (const n of names.sort()) {
        if (n.startsWith('.')) continue; const p = join(dir, n); let st; try { st = statSync(p); } catch { continue; }
        if (st.isDirectory()) { if (depth < 2) walk(p, depth + 1); continue; }
        if (!/\.iso$/i.test(n)) continue;
        let id = slug(n); for (let k = 2; ids.has(id); k++) id = `${slug(n).slice(0, 44)}-${k}`; ids.add(id);
        out.push({ id, name: n.replace(/\.iso$/i, ''), path: p, size: st.size, mtime: st.mtimeMs });
      }
    };
    walk(root, 0);
    for (const i of out) {
      const key = `${i.path}|${i.size}|${i.mtime}`, c = isoCache.get(key);
      if (c) { i.recipe = c.recipe; i.err = c.err; continue; }
      try { const iso = await Iso.open(i.path); try { i.recipe = await detect(iso); } finally { await iso.close(); } } catch (e) { i.err = (e as Error).message; }
      isoCache.set(key, { ...i });
    }
    // L'état de chaque image dans la bibliothèque commune (Hydre, Andromède) : seule une image « prête » (complète
    // ET passée par l'antivirus) est démarrable. Sans Hydre, comme avant : tout ce qui est dans le dossier.
    const vu = out.map((i) => `${i.path}|${i.size}|${i.mtime}`).join('\n');
    if (Date.now() - biblio.at > 5000 || biblio.vu !== vu) biblio = { at: Date.now(), vu, d: await ctx.call('ymir', 'isos_pxe', {}, 'images démarrables par le réseau', { interne: true }).then((r) => (r.ok === false ? undefined : r.data as Biblio['d']), () => undefined) };
    if (biblio.d) { const e = new Map(biblio.d.images.map((x) => [x.chemin.replace(/\\/g, '/'), x.etat])); for (const i of out) i.etat = e.get(i.path.replace(/\\/g, '/')) ?? 'scannée'; }
    return out;
  }
  /** Démarrable par le réseau : dans la bibliothèque, complète et analysée (ni en cours, ni en quarantaine, ni ancienne). */
  const prete = (i: IsoInfo) => (i.etat ?? 'prête') === 'prête';
  async function isoById(ctx: ModCtx, id: string): Promise<{ info: IsoInfo; iso: Iso } | undefined> {
    const info = (await isos(ctx)).find((x) => x.id === id && prete(x)); if (!info) return undefined;
    let iso = open.get(info.path); if (!iso) { iso = await Iso.open(info.path); open.set(info.path, iso); }
    return { info, iso };
  }

  // ---------------- Le suivi des machines ----------------
  function track(ctx: ModCtx, mac: string | undefined, ip: string | undefined, step: Step, o: { iso?: string; isoName?: string; fw?: string; detail?: string; host?: string; token?: string; profil?: string } = {}): Machine | undefined {
    const all = live(ctx), now = ctx.now().getTime();
    let m = mac ? all[mac] : undefined;
    if (!m && !mac && ip) m = Object.values(all).filter((x) => x.ip === ip && !FINAL.includes(x.step)).sort((a, b) => b.updated - a.updated)[0];
    if (!m && !mac) m = Object.values(all).filter((x) => !FINAL.includes(x.step) && now - x.updated < 120_000 && !x.ip).sort((a, b) => b.updated - a.updated)[0];
    if (!m) { if (!mac) return undefined; m = { mac, step, steps: [], started: now, updated: now }; }
    // Une machine finie qui redémarre par le réseau : un nouveau passage commence.
    if (FINAL.includes(m.step) && (step === 'démarrage réseau' || step === 'menu')) m = { mac: m.mac, step, steps: [], started: now, updated: now, host: m.host };
    const order: Step[] = ['démarrage réseau', 'chargeur', 'menu', 'chargement', 'installation', 'logiciels', 'fini'];
    const forward = FINAL.includes(step) || order.indexOf(step) >= order.indexOf(m.step) || FINAL.includes(m.step);
    // La première étape d'un passage est notée aussi (un poste arrivé au menu a son étape « menu », avec l'heure).
    if (forward && (m.step !== step || o.detail || !m.steps.length)) m.steps.push({ at: now, step, ...(o.detail ? { detail: o.detail } : {}) });
    if (forward) m.step = step;
    // L'adresse IP d'un poste lancé ne suit pas le premier venu qui cite son adresse MAC (suivi.ts) ; l'image ne change pas quand l'étape n'avance pas.
    m.updated = now; if (ip) S.adresse(m, ip);
    for (const k of ['iso', 'isoName', 'fw', 'host', 'token', 'profil'] as const) if (o[k] && (forward || (k !== 'iso' && k !== 'isoName'))) m[k] = o[k];
    m.steps = m.steps.slice(-30);
    S.apres(ctx, m, step, o);
    all[m.mac] = m;
    // On garde les 200 plus récentes, et toujours les installations en cours (jamais chassées par des postes au menu).
    const keep = S.garder(Object.values(all));
    saveLive(ctx, Object.fromEntries(keep.map((x) => [x.mac, x])));
    ctx.emit('etape', { mac: m.mac, etape: step, ...(m.isoName ? { iso: m.isoName } : {}), ...(m.host ? { nom: m.host } : {}) });
    return m;
  }
  function finish(ctx: ModCtx, m: Machine, result: Done['result']): void {
    const iso = m.iso ?? '?', d: Done = { at: ctx.now().getTime(), mac: m.mac, host: m.host, ip: m.ip, iso, isoName: m.isoName ?? iso, profil: m.profil, ms: ctx.now().getTime() - m.started, result, ...(m.logiciels?.length ? { logiciels: m.logiciels } : {}), ...S.fiche(m) };
    try { hist(ctx).ajouter(d); } catch { /* disque plein */ }
    if (result === 'fini') bump(ctx, iso, 'finis');
  }

  // ---------------- Les sessions (installations automatiques) ----------------
  function session(ctx: ModCtx, mac: string, iso: string, profil: string, host: string, fw: string): Session {
    const all = sessions(ctx), now = ctx.now().getTime();
    for (const [t, x] of Object.entries(all)) if (now - x.created > 2 * 864e5) delete all[t];
    const have = Object.values(all).find((x) => x.mac === mac && x.iso === iso && !x.fin && now - x.created < 864e5);
    if (have) return have;
    const x: Session = { token: randomBytes(18).toString('base64url'), mac, iso, profil, host, fw: /efi/i.test(fw) ? 'uefi' : 'bios', created: now };
    all[x.token] = x; saveSessions(ctx, all); return x;
  }
  // Un jeton vaut 2 jours au plus, et 10 min seulement après la fin de son installation (finie ou ratée).
  const sessionOf = (ctx: ModCtx, token: string): Session | undefined => { const x = sessions(ctx)[token], now = ctx.now().getTime(); return x && now - x.created < 2 * 864e5 && !(x.fin && now - x.fin > 10 * 60_000) && !(x.autorisation && !autorisations(ctx).some((a) => a.id === x.autorisation && !a.annulee)) ? x : undefined; };
  /** Le mot de passe du compte créé par un profil : généré une fois, rangé dans le coffre (Thésauros) et ici (fichier protégé). */
  async function profilePassword(ctx: ModCtx, p: Profile): Promise<string> {
    const sec = secrets(ctx); const have = sec.profils?.[p.id]; if (have) return have;
    const pw = randomBytes(12).toString('base64url').replace(/[-_]/g, 'x');
    saveSecrets(ctx, { ...sec, profils: { ...sec.profils, [p.id]: pw } });
    await ctx.call('brisingamen', 'ajouter', { nom: `Déploiement · ${p.nom}`, identifiant: p.utilisateur, mot_de_passe: pw, site: 'Genèse (machines installées par le réseau)', coffre: 'TOUFATECH' }, `ranger le mot de passe du profil de déploiement ${p.nom}`).catch(() => undefined);
    return pw;
  }

  // ---------------- Déployer (lot S6) : les PC autorisés en lot, une fois chacun ----------------
  // Le fichier des autorisations (protégé) : une ligne par PC, pour ce système et ces réglages, valable un temps limité ;
  // utilisée UNE fois (jamais rejouée), annulée si le PC qui démarre n'est pas exactement celui autorisé. Le mot de passe
  // de chaque PC n'y est que CHIFFRÉ (clé de la machine) ; il est aussi rangé dans le coffre.
  const autorisations = (ctx: ModCtx): AutorisationPc[] => { const l = jsonFile<unknown>(ctx, FICHIER_AUTORISATIONS, []); return Array.isArray(l) ? l.filter((a): a is AutorisationPc => Boolean(a) && typeof a === 'object' && typeof (a as AutorisationPc).id === 'string') : []; };
  const saveAutorisations = (ctx: ModCtx, l: AutorisationPc[]) => {
    const now = ctx.now().getTime(), garde = l.filter((a) => autorisationValable(a, now) || now - Math.max(a.consommee?.at ?? 0, a.annulee?.at ?? 0, a.expire) < 7 * 864e5).slice(-500);
    mkdirSync(ctx.dir, { recursive: true });
    const f = join(ctx.dir, FICHIER_AUTORISATIONS), tmp = `${f}.${randomBytes(4).toString('hex')}.tmp`;
    writeFileSync(tmp, JSON.stringify(garde), { mode: 0o600 }); renameSync(tmp, f);
  };
  /** Une session neuve pour un PC vérifié : son jeton, l'autorisation utilisée et son adresse (ses fichiers ne vont qu'à elle). */
  function sessionDeploiement(ctx: ModCtx, mac: string, a: AutorisationPc, fw: string, from: string): Session {
    const all = sessions(ctx), now = ctx.now().getTime();
    for (const [t, x] of Object.entries(all)) if (now - x.created > 2 * 864e5) delete all[t];
    const x: Session = { token: randomBytes(18).toString('base64url'), mac, iso: a.iso, profil: a.profil ?? '', host: a.nom, fw: /efi/i.test(fw) ? 'uefi' : 'bios', created: now, autorisation: a.id, from };
    all[x.token] = x; saveSessions(ctx, all); return x;
  }
  /**
   * Au menu : ce PC a-t-il une autorisation de déploiement ? « auto » (effacer et installer) seulement si c'est EXACTEMENT
   * le PC autorisé (adresse MAC, numéro de série, identifiant de carte mère, taille du disque quand il la dit) ; sinon
   * l'autorisation est annulée, Odin te prévient, et le PC a le menu ordinaire (son disque par défaut) : rien n'est effacé.
   * Une autorisation sert UNE fois : marquée utilisée ici même, avant que le menu parte (aucun rejeu). Synchrone : rien
   * ne s'intercale entre la lecture et l'écriture du fichier.
   */
  function deploiementAuMenu(ctx: ModCtx, mac: string, fw: string, from: string, vu: IdentiteVue, list: IsoInfo[]): { auto: { id: string; token: string; host: string } } | { menu: string } | { refus: string } | undefined {
    const now = ctx.now().getTime(), l = autorisations(ctx), a = autorisationPour(l, mac, now);
    if (!a) return undefined;
    const target = list.find((i) => i.id === a.iso);
    if (!target) return undefined; // l'image n'est plus prête : rien n'est utilisé, rien n'est lancé
    if (a.facon === 'auto') {
      const non = identiteDifferente(a.mac ? { mac: a.mac, serie: a.serie, uuid: a.uuid, disque: a.disque } : { mac }, mac, vu);
      const windowsSansPartage = target.recipe?.kind === 'windows' && !(ctx.settings.partage as { unc?: string } | undefined)?.unc;
      if (non || !target.recipe?.auto || windowsSansPartage) {
        const raison = non ?? (windowsSansPartage ? 'partage Windows absent' : 'le système ne s\'installe plus tout seul');
        a.annulee = { at: now, raison: `${raison} (PC ${mac} au démarrage)`, ...(non ? { vu } : {}) }; saveAutorisations(ctx, l);
        track(ctx, mac, from, 'menu', { detail: `déploiement refusé : ${raison} — rien n'est effacé` });
        ctx.alert({ level: non ? 'haute' : 'moyenne', title: `🛑 Déploiement refusé : ${non ? 'ce n\'est pas le PC autorisé' : raison}`, detail: `Un PC (${mac}, adresse ${from}) a démarré par le réseau pour l'autorisation « ${a.nom} » : ${raison}. Rien n'a été effacé ; il a eu le menu ordinaire (son disque par défaut). L'autorisation est annulée.${non ? ' Deux appareils différents ont cité cette adresse. Odin ne l\'effacera plus sur la seule identité du dernier appareil vu : « Déployer » te montrera les deux (numéro de série, carte mère, disque, dates) et te demandera lequel est le bon (si les deux ont démarré ces dernières 24 h, attends d\'abord 24 h) ; seul celui-là pourra être effacé, l\'autre restera refusé. Vérifie le numéro de série sur son étiquette.' : ' Relance « Déployer » quand c\'est réglé.'}`, key: `thjalfi-deploiement-refus-${a.id}`, data: { mac, autorisation: a.id } });
        return { refus: raison };
      }
      const x = sessionDeploiement(ctx, mac, a, fw, from);
      a.consommee = { at: now, mac, token: x.token };
      saveAutorisations(ctx, l);
      track(ctx, mac, from, 'menu', { iso: target.id, isoName: target.name, host: a.nom, token: x.token, profil: a.profil ?? '', detail: `déploiement : ${target.name} sur ${a.nom} (identité vérifiée, une seule fois)` });
      return { auto: { id: target.id, token: x.token, host: a.nom } };
    }
    // « Le proposer au menu, sans effacer » : le système par défaut au menu, installation normale (avec ses questions).
    a.consommee = { at: now, mac };
    saveAutorisations(ctx, l);
    track(ctx, mac, from, 'menu', { iso: target.id, isoName: target.name, detail: `proposé au menu, sans effacer : ${target.name}` });
    return { menu: target.id };
  }

  // Ce que chaque adresse MAC a dit d'elle au démarrage (fichier protégé, borné, gardé 400 jours) : deux identités
  // différentes pour la même adresse ces dernières 24 h = un appareil la recopie peut-être, « deployer » refuse d'effacer ;
  // plus anciennes, « deployer » demande au propriétaire laquelle est la bonne.
  const FICHIER_IDENTITES = 'identites-vues.json';
  const identitesVues = (ctx: ModCtx): Record<string, IdentiteNotee[]> => { const x = jsonFile<unknown>(ctx, FICHIER_IDENTITES, {}); return x && typeof x === 'object' && !Array.isArray(x) ? x as Record<string, IdentiteNotee[]> : {}; };
  function noterIdentite(ctx: ModCtx, mac: string, vu: IdentiteVue): void {
    try {
      const now = ctx.now().getTime(), all = identitesVues(ctx), cle = (x: IdentiteVue) => `${x.serie ?? ''}|${x.uuid ?? ''}|${x.disque ?? ''}`;
      const avant = (Array.isArray(all[mac]) ? all[mac] : []).filter((x) => x && now - Number(x.at) < MEMOIRE_IDENTITES_MS);
      const meme = avant.find((x) => cle(x) === cle(vu)), l = avant.filter((x) => x !== meme);
      all[mac] = [...l, { ...(vu.serie ? { serie: vu.serie } : {}), ...(vu.uuid ? { uuid: vu.uuid } : {}), ...(vu.disque ? { disque: vu.disque } : {}), at: now, premiere: Math.min(now, Number(meme?.premiere ?? meme?.at ?? now)) }].slice(-8);
      ecrireIdentites(ctx, all, now);
    } catch { /* disque plein : le menu part quand même ; « deployer » relira ce qui est là */ }
  }
  /** Réécrit le fichier des identités (protégé, 1000 adresses au plus, gardées 400 jours) ; lève si le disque refuse. */
  function ecrireIdentites(ctx: ModCtx, all: Record<string, IdentiteNotee[]>, now: number): void {
    {
      const garde = Object.entries(all).filter(([, v]) => Array.isArray(v) && v.some((x) => now - Number(x?.at) < MEMOIRE_IDENTITES_MS)).sort((a, b) => Math.max(...b[1].map((x) => Number(x.at) || 0)) - Math.max(...a[1].map((x) => Number(x.at) || 0))).slice(0, 1000);
      mkdirSync(ctx.dir, { recursive: true });
      const f = join(ctx.dir, FICHIER_IDENTITES), tmp = `${f}.${randomBytes(4).toString('hex')}.tmp`;
      writeFileSync(tmp, JSON.stringify(Object.fromEntries(garde)), { mode: 0o600 }); renameSync(tmp, f);
    }
  }

  // ---------------- Le menu, les fichiers, les réponses ----------------
  function bootScript(ctx: ModCtx): string { return `#!ipxe\n# Odin · Genèse\nchain ${base(ctx)}/menu.ipxe?mac=\${netX/mac}&fw=\${platform}&serie=\${serial:uristring}&uuid=\${uuid}&marque=\${manufacturer:uristring}&modele=\${product:uristring} || shell\n`; }
  async function menuFor(ctx: ModCtx, mac: string, fw: string, from: string, q?: URLSearchParams): Promise<string> {
    const list = (await isos(ctx)).filter((i) => i.recipe && prete(i)), r = rules(ctx).find((x) => x.mac === mac);
    // Poste bloqué, installations suspendues, mot de passe pas encore donné ou pas d'adresse MAC : le poste reçoit ce script à la
    // place du menu, et aucune fiche n'est ouverte pour une demande refusée.
    const refus = S.garde(ctx, mac, fw, from); if (refus) return refus;
    track(ctx, mac || undefined, from, 'menu', { fw: fw || undefined });
    // Le défaut de tous les PC (page « Menu PXE », lot S9) : jamais une entrée qui installe ou peut effacer (relu ici, même
    // si un ancien réglage le disait) ; un PC autorisé garde son système à lui, plus bas.
    // Un système caché du menu n'est pas non plus le défaut de tous (il redevient le disque).
    const cfgMenu = menuPxe(ctx), defTous = defautSur(s(ctx.settings.defaut) || 'local', list.filter((i) => !cfgMenu.caches.includes(i.id))).def;
    let auto: { id: string; token: string; host: string } | undefined, def = defTous === 'ecran' ? 'local' : defTous, timeout = delaiMenu(ctx);
    // Déployer (lot S6) : ce que le PC dit de lui (série, carte mère, taille du disque), revérifié AVANT tout effacement.
    const vu: IdentiteVue = { ...(q ? identite(q) : {}), ...(tailleDisqueVue(q) ? { disque: tailleDisqueVue(q) } : {}) };
    if (mac && vu.disque) { const all = live(ctx); if (all[mac]) { all[mac].disque = vu.disque; saveLive(ctx, all); } }
    if (mac && (vu.serie || vu.uuid || vu.disque)) noterIdentite(ctx, mac, vu);
    const dep = mac ? deploiementAuMenu(ctx, mac, fw, from, vu, list) : undefined;
    if (dep && 'auto' in dep) { auto = dep.auto; def = dep.auto.id; timeout = 5; }
    else if (dep && 'menu' in dep) def = dep.menu;
    // Refusé (ce n'est pas le PC autorisé) : le menu ordinaire, et AUCUNE autre installation automatique pour lui ce coup-ci.
    else if (dep && 'refus' in dep) { /* rien d'automatique */ }
    else if (r?.auto && !r.fait && r.iso) {
      const target = list.find((i) => i.id === r.iso);
      if (target?.recipe?.auto) {
        const p = profiles(ctx).find((x) => x.id === r.profil) ?? profiles(ctx)[0], host = hostLabel(r.nom || hostOf(mac));
        const x = session(ctx, mac, target.id, p.id, host, fw);
        auto = { id: target.id, token: x.token, host }; def = target.id; timeout = 5;
        track(ctx, mac, from, 'menu', { iso: target.id, isoName: target.name, host, token: x.token, profil: p.id, detail: `installation automatique prévue : ${target.name}` });
      }
    } else if (r?.iso && list.some((i) => i.id === r.iso)) def = r.iso;
    const ec = ecranCfg(ctx), ch = auto || !mac ? undefined : choiceOf(ctx, mac, true);
    if (ch?.mode === 'disque') { def = 'local'; timeout = 0; }
    // « T » sur l'écran (choix du propriétaire) : le menu texte, tel quel, avec son délai ; il ne renvoie pas vers l'écran.
    else if (ch?.mode === 'texte') track(ctx, mac, from, 'menu', { detail: 'menu texte demandé sur l\'écran' });
    else if (ch && list.some((i) => i.id === ch.iso)) { const i = list.find((x) => x.id === ch.iso)!; def = i.id; timeout = 0; track(ctx, mac, from, 'menu', { iso: i.id, isoName: i.name, detail: `choisi sur l'écran : ${i.name} (${ch.mode === 'essai' ? 'essai' : 'installation'})` }); }
    if (def !== 'local' && !list.some((i) => i.id === def)) def = 'local';
    if (ec.actif && ec.parDefaut && !ch && !auto && def === 'local') def = 'ecran';
    const nb = (codename: string) => {
      const d = join(bootDir(ctx), 'debian', codename || 'x');
      return codename && existsSync(join(d, 'linux')) && existsSync(join(d, 'initrd.gz')) ? { kernel: `boot/debian/${codename}/linux`, initrd: `boot/debian/${codename}/initrd.gz` } : undefined;
    };
    // Le système à lui d'un PC autorisé (ou choisi sur l'écran) reste à SON menu, même caché pour les autres.
    return menu({ ...menuCommun(ctx, list, def === defTous ? [auto?.id] : [def, auto?.id]), mac, def, timeout, auto, netboot: nb, ecran: ec.actif && Boolean(mac), kiosk: (() => { const k = kiosk(ctx); return k && mac ? kioskBoot({ base: base(ctx), mac, branch: k.branch }) : undefined; })() });
  }
  /** Les réglages du menu PXE (lot S9) : l'ordre choisi et les systèmes cachés. */
  const menuPxe = (ctx: ModCtx): MenuPxeCfg => menuPxeCfg(ctx.settings.menuPxe);
  /**
   * Ce que tous les menus ont en commun (le vrai menu d'un PC et l'aperçu de la page) : les systèmes dans l'ordre choisi,
   * sans les cachés (sauf `garder` : le système d'un PC autorisé reste au menu de CE PC), l'habillage et les familles.
   */
  function menuCommun(ctx: ModCtx, list: IsoInfo[], garder: Array<string | undefined>, cfg: MenuPxeCfg = menuPxe(ctx)) {
    const ec = ecranCfg(ctx), fam = (i: IsoInfo) => category(i.recipe, i.name);
    const entries = visibles(ordonner(list, cfg, fam), cfg, garder).map((i) => ({ id: i.id, name: i.name, recipe: i.recipe! }));
    const look = textLook(ec.texte, fondPerso(ctx, 'texte') || ec.texte !== 'classique' ? `${base(ctx)}/ecran/fond-texte.png` : undefined);
    return { base: base(ctx), entries, look, texte: ec.texte, family: (e: { recipe: Recipe; name: string }) => category(e.recipe, e.name), libre: cfg.ordre.length > 0 };
  }

  // ---------------- L'écran d'Odin (choisir sur un téléphone ou un PC du réseau) ----------------
  async function ecranEtat(ctx: ModCtx, mac: string): Promise<Record<string, unknown>> {
    const tout = (await isos(ctx)).filter(prete), cfg = menuPxe(ctx), m = mac ? live(ctx)[mac] : undefined, fw = m?.fw ?? '', ec = ecranCfg(ctx);
    for (const i of tout) isoNames.set(i.id, i.name);
    // Le même menu que le menu texte (lot S9) : l'ordre choisi, sans les systèmes cachés ; le défaut qui démarre seul au
    // bout du délai n'est jamais une installation (l'écran ne fait d'ailleurs qu'« essayer » ou prendre le disque).
    const list = visibles(ordonner(tout, cfg, (i) => category(i.recipe, i.name)), cfg), sys = systems(list, stats(ctx)), dft = defautSur(s(ctx.settings.defaut) || 'local', list).def;
    const now = ctx.now().getTime(), d = mac ? demandes(ctx).filter((x) => x.mac === mac && (x.statut === 'attente' || now - (x.decide ?? x.at) < 10 * 60_000)).at(-1) : undefined;
    const last = mac ? history(ctx, 300).find((h) => h.mac === mac && h.result === 'fini') : undefined;
    return { mac, fw, serveur: `${serverIp(ctx)}:${http?.port ?? ports(ctx).http}`, systemes: sys, ordre: sys.map((x) => x.id), caches: [], defaut: dft === 'local' || dft === 'ecran' ? 'disque' : dft, delai: delaiMenu(ctx), disposition: ec.disposition, theme: ec.theme, fond: fondPerso(ctx, 'graphique'), relance: Boolean(mac && (choiceOf(ctx, mac) || (rules(ctx).find((x) => x.mac === mac)?.auto && !rules(ctx).find((x) => x.mac === mac)?.fait))), machine: S.publique(ctx, mac), demande: d ? { id: d.id, statut: d.statut, iso: d.iso } : null, dejaLa: last && S.publique(ctx, mac) ? `${last.isoName}${last.host ? ` (${last.host})` : ''}` : '', dit: { _: odinSays(undefined, fw), ...Object.fromEntries(sys.map((x) => [x.id, odinSays(x, fw)])) } };
  }
  async function ecranChoisir(ctx: ModCtx, mac: string, iso: string, mode: string): Promise<{ ok: boolean; texte: string }> {
    if (!mac) return { ok: false, texte: 'Il manque l\'adresse de la machine : ouvre l\'écran depuis le lien affiché par la machine.' };
    const non = S.refus(ctx, mac, mode); if (non) return { ok: false, texte: non };
    const all = choices(ctx), now = ctx.now().getTime();
    if (mode === 'disque') { all[mac] = { iso: '', mode: 'disque', at: now }; saveJson(ctx, 'ecran-choix.json', all); return { ok: true, texte: 'Le PC démarre sur son disque.' }; }
    // « T » : le PC repasse sur le menu texte (même menu, mêmes règles, son délai), sans rien installer.
    if (mode === 'texte') { all[mac] = { iso: '', mode: 'texte', at: now }; saveJson(ctx, 'ecran-choix.json', all); return { ok: true, texte: 'Le PC repasse sur le menu texte.' }; }
    const list = (await isos(ctx)).filter(prete), sys = systems(list, stats(ctx)).find((x) => x.id === iso);
    if (!sys) return { ok: false, texte: 'Ce système n\'est plus dans Odin.' };
    if (menuPxe(ctx).caches.includes(iso)) return { ok: false, texte: 'Ce système n\'est pas proposé au menu.' };
    if (!['essai', 'installer', 'auto'].includes(mode) || !sys.modes.includes(mode as 'essai')) return { ok: false, texte: `${sys.title} ne se lance pas de cette façon.` };
    if (mode === 'auto') {
      if (list.find((i) => i.id === iso)?.recipe?.kind === 'windows' && !(ctx.settings.partage as { unc?: string } | undefined)?.unc) return { ok: false, texte: 'Windows automatique : le partage réseau n\'est pas encore réglé dans Odin.' };
      const l = demandes(ctx).map((d) => (d.mac === mac && d.statut === 'attente' ? { ...d, statut: 'refusee' as const, decide: now } : d));
      const d: Demande = { id: randomBytes(6).toString('hex'), mac, iso, isoName: sys.name, at: now, statut: 'attente', host: rules(ctx).find((r) => r.mac === mac)?.nom ?? hostOf(mac) };
      saveDemandes(ctx, [...l, d]);
      track(ctx, mac, undefined, 'menu', { iso, isoName: sys.name, detail: `demande « Installer pour moi » : ${sys.title} (attend ton accord)` });
      ctx.alert({ level: 'haute', title: `🖥 ${d.host} demande « Installer pour moi » : ${sys.title} ${sys.version}`.trim(), detail: `Machine ${mac}. Son disque sera EFFACÉ puis ${sys.title} s'installera tout seul (compte, langue, logiciels). Rien ne se passe sans ton accord.`, key: `thjalfi-demande-${d.id}`, data: { demande: d.id, mac, iso }, steps: ['Vérifie que c\'est bien ce PC (son adresse est sur son écran).', 'Accepte : le disque est effacé et l\'installation démarre.', 'Ou refuse : rien n\'est touché.'], fix: { action: 'decider', label: 'Accepter (efface le disque)', input: { id: d.id, accord: 'oui' } } });
      return { ok: true, texte: 'J\'ai prévenu Odin : j\'attends ton accord sur ton téléphone ou dans l\'appli.' };
    }
    all[mac] = { iso, mode: mode as 'essai' | 'installer', at: now }; saveJson(ctx, 'ecran-choix.json', all);
    track(ctx, mac, undefined, 'menu', { iso, isoName: sys.name, detail: `choisi sur l'écran : ${sys.title} (${mode === 'essai' ? 'essai' : 'installation'})` });
    return { ok: true, texte: `C'est parti : ${sys.title} démarre dans quelques secondes.` };
  }
  /** Ce que lit la machine pendant qu'elle attend un choix (iPXE) : elle redemande toutes les 3 s, puis reprend son disque
   *  au bout du DÉLAI DU MENU (10 s par défaut, réglable ; choix du propriétaire) — plus longtemps si un accord est attendu. */
  function ecranAttente(ctx: ModCtx, mac: string, fw: string, n: number, from: string): string {
    const b = base(ctx), plat = fw ? fw.replace(/[^\w-]/g, '') : '${platform}', local = [':local', 'echo Demarrage sur le disque...', 'iseq ${platform} efi && exit 1 ||', 'sanboot --no-describe --drive 0x80 || exit 1'];
    if (!mac) return ['#!ipxe', 'goto local', ...local, ''].join('\n');
    if (S.refus(ctx, mac)) return ['#!ipxe', 'echo Odin ne propose pas d\'installation a ce poste : demarrage sur le disque.', 'goto local', ...local, ''].join('\n');
    const r = rules(ctx).find((x) => x.mac === mac), pending = demandes(ctx).some((d) => d.mac === mac && d.statut === 'attente');
    if (choiceOf(ctx, mac) || (r?.auto && !r.fait)) return ['#!ipxe', `chain ${b}/menu.ipxe?mac=${mac}&fw=${plat} || goto local`, ...local, ''].join('\n');
    if (n === 0) track(ctx, mac, from, 'menu', { fw: fw || undefined, detail: 'attend un choix sur l\'écran d\'Odin' });
    const max = pending ? 600 : Math.max(1, Math.ceil(delaiMenu(ctx) / 3));
    if (n >= max) return ['#!ipxe', 'echo Pas de choix : la machine demarre sur son disque.', 'goto local', ...local, ''].join('\n');
    return ['#!ipxe', ...(n % 10 === 0 ? [`echo Odin attend ton choix : ouvre ${b}/ecran?mac=${mac}`, `echo sur un telephone ou un PC du reseau${pending ? ' (accord demande)' : ''}.`] : []), 'sleep 3', `chain ${b}/ecran/attente.ipxe?mac=${mac}&fw=${plat}&n=${n + 1} || goto local`, ...local, ''].join('\n');
  }
  /** Accepter une demande : comme « autoriser » en installation automatique (une fois). */
  async function accept(ctx: ModCtx, d: Demande): Promise<string> {
    const iso = (await isos(ctx)).find((i) => i.id === d.iso); if (!iso?.recipe?.auto) throw new Error(`${d.isoName} ne sait plus s'installer toute seule`);
    const old = rules(ctx).find((r) => r.mac === d.mac), p = profiles(ctx).find((x) => x.id === old?.profil) ?? profiles(ctx)[0];
    const all = rules(ctx).filter((r) => r.mac !== d.mac); all.push({ mac: d.mac, nom: old?.nom ?? (d.host ? hostLabel(d.host) : undefined), iso: iso.id, profil: p.id, auto: true, ajoute: ctx.now().getTime() });
    ctx.saveSettings({ machines: all });
    return p.nom;
  }
  /** L'autorisation de déploiement d'une session (lot S6), encore là et pas annulée ; sinon rien. */
  const autorisationDe = (ctx: ModCtx, x: Session) => (x.autorisation ? autorisations(ctx).find((a) => a.id === x.autorisation && !a.annulee) : undefined);
  /** La famille de profil de logiciels (lot S4) d'une image : Windows, Ubuntu et Debian (.deb), Fedora et compatibles (.rpm). */
  const osProfilDe = (kind: string | undefined): OsProfil => (kind === 'windows' ? 'windows' : kind === 'rhel' || kind === 'fedora-live' ? 'fedora' : 'debian');
  /**
   * Déployer (lot S6) : ce qui s'installe à la fin sur CE PC, d'après le profil de logiciels choisi (lot S4), relu ICI
   * (jamais d'après la page) : les logiciels déjà téléchargés dont le mode silencieux est CONNU, servis par Odin au seul PC
   * vérifié ; tes scripts du bon système, chacun REPASSÉ par l'antivirus à cet instant (un script refusé depuis n'est pas
   * servi). Rien n'est téléchargé sur Internet par le PC.
   */
  async function finDeploiement(ctx: ModCtx, x: Session, a: AutorisationPc, kind: string | undefined): Promise<{ sw: NonNullable<Answer['software']>; paquets: NonNullable<Answer['paquetsFichiers']>; scripts: ScriptPerso[]; files: Record<string, string> }> {
    const os = osProfilDe(kind), prof = a.profil ? lireProfils(ctx).liste.find((y) => y.id === a.profil) : undefined;
    const out = { sw: [] as NonNullable<Answer['software']>, paquets: [] as NonNullable<Answer['paquetsFichiers']>, scripts: [] as ScriptPerso[], files: {} as Record<string, string> };
    if (!prof) return out;
    let found: Array<{ source: string; nom: string; version: string; chemin: string }> = [];
    try { found = ((await ctx.call('fjalar', 'etat', {}, 'logiciels à installer sur le PC déployé')).data as { fichiers?: typeof found } | undefined)?.fichiers ?? []; } catch { /* Hermès absent */ }
    for (const l of prof.systemes[os].logiciels) {
      const f = found.find((y) => basename(String(y.chemin ?? '')) === l.fichier) ?? found.filter((y) => y.source === l.id).sort((u, v) => (u.version < v.version ? 1 : -1))[0];
      if (!f?.chemin) continue;
      const file = basename(f.chemin), quoi = installeAuto(l.id, file);
      if (os === 'windows' && quoi === 'windows') { out.files[file] = f.chemin; const sa = silentArgs(l.id, file); out.sw.push({ name: f.nom || l.nom, url: `${base(ctx)}/logiciel/${x.token}/${encodeURIComponent(file)}`, args: sa.args, msi: sa.msi }); }
      else if (os !== 'windows' && quoi === 'linux') {
        const fam = familleLogiciel(file), genre = fam === 'linux-deb' ? 'deb' as const : fam === 'linux-rpm' ? 'rpm' as const : undefined;
        if (!genre || (os === 'debian') !== (genre === 'deb')) continue;
        const cle = `paquet-${out.paquets.length + 1}.${genre}`; out.files[cle] = f.chemin;
        out.paquets.push({ nom: f.nom || l.nom, url: `${base(ctx)}/logiciel/${x.token}/${cle}`, genre });
      }
    }
    out.scripts = scriptsRevus(prof.systemes[os].scripts, antivirusScript).acceptes.filter((y) => osDuScript(y.nom) === (os === 'windows' ? 'windows' : 'linux'));
    return out;
  }
  /** Le fichier de réponses Windows du déploiement : celui de Genèse (disque effacé, compte de CE PC) et les options de l'étape 5. */
  function unattendDeploiement(a: Answer, fw: 'uefi' | 'bios', w: Record<string, unknown> | undefined): string {
    const opt = optionsWindowsDe(w ?? {});
    // compte local : celui de Genèse (son mot de passe à LUI, du coffre) ; sinon Windows demande son compte.
    const x = appliquerOptionsWindows(unattend(a, fw), { ...opt, compteLocal: opt.compteLocal ? undefined : false, disqueAuChoix: false });
    return opt.retirerExigences ? injecterSautExigences(x) : x;
  }
  async function answer(ctx: ModCtx, x: Session): Promise<Answer> {
    const p = profiles(ctx).find((y) => y.id === x.profil) ?? profiles(ctx)[0];
    const dep = autorisationDe(ctx, x);
    if (dep) return answerDeploiement(ctx, x, dep, p);
    const sh = ctx.settings.partage as { unc?: string; utilisateur?: string } | undefined;
    // La clé d'activation déposée pour l'édition de cette image Windows (ou rien : installation sans activation).
    // La clé n'est lue qu'ici (au déploiement), jamais mise dans un journal ni renvoyée à la page.
    let productKey: string | undefined;
    try { const img = (await isos(ctx)).find((i) => i.id === x.iso); if (img?.recipe?.kind === 'windows') productKey = clePourImage(ctx.home, ctx.dir, img.name, img.recipe.label); } catch { /* clé indisponible : on laisse vide */ }
    return {
      host: x.host, user: p.utilisateur, password: await profilePassword(ctx, p), locale: p.langue, keymap: p.clavier, timezone: p.fuseau, packages: p.paquets,
      report: `${base(ctx)}/etat/${x.token}`, repo: `${base(ctx)}/f/${x.iso}/`, mirror: s(ctx.settings.miroir) || undefined, compagnon: p.compagnon !== false && ctx.modules().some((m) => m.id === 'hermod'),
      ...(sh?.unc ? { share: { unc: `${sh.unc.replace(/[\\/]+$/, '')}\\.thjalfi\\${x.iso}`, user: sh.utilisateur, password: secrets(ctx).partage } } : {}),
      ...(productKey ? { productKey } : {}),
    };
  }
  /**
   * Les réponses d'un PC déployé (lot S6) : SON nom, SON compte et SON mot de passe (tiré du coffre, déchiffré ici
   * seulement, jamais écrit dans un journal ni renvoyé à la page), la langue d'Odin, la clé d'activation du coffre.
   */
  async function answerDeploiement(ctx: ModCtx, x: Session, d: AutorisationPc, p: Profile): Promise<Answer> {
    const sh = ctx.settings.partage as { unc?: string; utilisateur?: string } | undefined;
    const img = (await isos(ctx)).find((i) => i.id === x.iso), w = d.windows ?? {}, windows = img?.recipe?.kind === 'windows';
    let productKey: string | undefined;
    if (windows && s(w.activation) !== 'aucune') { try { productKey = clePourImage(ctx.home, ctx.dir, img!.name, img!.recipe!.label); } catch { /* sans activation */ } }
    let password = '';
    try { password = d.mdp ? dechiffrerChamp(ctx.home, d.mdp) : ''; } catch { password = ''; }
    // Sans son mot de passe (coffre illisible), on ne pose JAMAIS un compte sans mot de passe : un neuf, jamais montré.
    if (!password) password = motDePassePc();
    const userWin = nomCompteValide(s(w.compte)) ? s(w.compte).trim() : 'odin';
    const userLinux = /^[a-z_][a-z0-9_-]{0,31}$/.test(p.utilisateur) ? p.utilisateur : 'odin';
    return {
      host: x.host, user: windows ? userWin : userLinux, password, locale: p.langue, keymap: p.clavier, timezone: p.fuseau, packages: [],
      report: `${base(ctx)}/etat/${x.token}`, repo: `${base(ctx)}/f/${x.iso}/`, mirror: s(ctx.settings.miroir) || undefined, compagnon: p.compagnon !== false && ctx.modules().some((m) => m.id === 'hermod'),
      ...(sh?.unc ? { share: { unc: `${sh.unc.replace(/[\\/]+$/, '')}\\.thjalfi\\${x.iso}`, user: sh.utilisateur, password: secrets(ctx).partage } } : {}),
      ...(productKey ? { productKey } : {}),
    };
  }
  async function seed(ctx: ModCtx, token: string, name: string, from: string): Promise<string | undefined> {
    const x = sessionOf(ctx, token); if (!x || S.coupe(ctx, x.mac, from)) return undefined;
    // Déployer (lot S6) : les fichiers d'un PC vérifié ne vont qu'à l'adresse qui a eu son menu (ni à un voisin qui
    // aurait vu passer le jeton).
    if (x.from && from !== x.from) return undefined;
    const dep = autorisationDe(ctx, x);
    if (x.autorisation && !dep) return undefined;
    // Installation finie (ou ratée) : plus aucun fichier de réponses (mot de passe du PC, scripts) ; seul le compagnon,
    // demandé après « fini » sous Linux, reste servi pendant les 10 min du jeton.
    if (dep && x.fin && name !== 'compagnon.sh' && name !== 'w:compagnon.ps1') return undefined;
    const a = await answer(ctx, x), m = live(ctx)[x.mac];
    if (dep) {
      const img = (await isos(ctx)).find((i) => i.id === x.iso), win = img?.recipe?.kind === 'windows', fin = await finDeploiement(ctx, x, dep, img?.recipe?.kind);
      const all = sessions(ctx); if (all[x.token]) { all[x.token].files = fin.files; saveSessions(ctx, all); }
      const ext = (n: string) => (/\.(cmd|bat)$/i.exec(n)?.[1] ?? 'ps1').toLowerCase();
      a.scriptsApres = fin.scripts.map((y, k) => ({ nom: y.nom, url: `${base(ctx)}/${win ? 'w' : 'seed'}/${x.token}/script-${k + 1}.${win ? ext(y.nom) : 'sh'}` }));
      a.paquetsFichiers = fin.paquets;
      const sm = /^(w:)?script-(\d{1,2})\.(ps1|cmd|bat|sh)$/.exec(name);
      if (sm) { const y = fin.scripts[Number(sm[2]) - 1]; return y && Boolean(sm[1]) === win ? y.contenu : undefined; }
      if (name === 'unattend.xml') { if (m?.step !== 'fini' && m?.step !== 'échec') track(ctx, x.mac, from, 'installation', { detail: 'fichier de réponses lu (unattend.xml)' }); return unattendDeploiement(a, x.fw, dep.windows); }
      if (name === 'w:apres.ps1') { if (m?.step !== 'fini' && m?.step !== 'échec') track(ctx, x.mac, from, 'installation', { detail: 'fichier de réponses lu (apres.ps1)' }); return windowsAfter({ ...a, software: fin.sw }); }
    }
    // Une installation finie ou ratée n'est pas rouverte par une relecture tardive de ses fichiers.
    if (!['meta-data', 'vendor-data'].includes(name) && m?.step !== 'fini' && m?.step !== 'échec') track(ctx, x.mac, from, 'installation', { detail: `fichier de réponses lu (${name.replace(/^w:/, '')})` });
    switch (name) {
      case 'user-data': return ubuntuUserData(a);
      case 'meta-data': return ubuntuMetaData(x.token);
      case 'vendor-data': return '';
      case 'preseed.cfg': return debianPreseed(a);
      case 'ks.cfg': return kickstart(a);
      case 'winpeshl.ini': return winpeshl();
      case 'odin.cmd': return a.share ? odinCmd(a) : undefined;
      case 'unattend.xml': return unattend(a, x.fw);
      // Le compagnon d'Odin de cette machine (un jeton neuf, donné par Satellites) : seulement si le profil le veut.
      case 'compagnon.sh': case 'w:compagnon.ps1': {
        if (!a.compagnon) return undefined;
        const r = await ctx.call('hermod', 'compagnon_script', { poste: x.host, systeme: name === 'compagnon.sh' ? 'linux' : 'windows' }, `compagnon d'Odin sur ${x.host}`, { interne: true }).catch(() => undefined);
        return (r?.data as { script?: string } | undefined)?.script;
      }
      case 'w:apres.ps1': {
        const p = profiles(ctx).find((y) => y.id === x.profil) ?? profiles(ctx)[0], files: Record<string, string> = {}, sw: NonNullable<Answer['software']> = [];
        let found: Array<{ source: string; nom: string; version: string; chemin: string }> = [];
        try { found = ((await ctx.call('fjalar', 'etat', {}, 'logiciels à installer sur la machine')).data as { fichiers?: typeof found } | undefined)?.fichiers ?? []; } catch { /* Hermès absent */ }
        for (const id of p.logiciels) {
          const f = found.filter((y) => y.source === id).sort((u, v) => (u.version < v.version ? 1 : -1))[0]; if (!f) continue;
          const file = basename(f.chemin);
          // On n'installe en silencieux que les installateurs Windows dont le mode est CONNU : les autres ne sont pas
          // promis en silencieux (filtrage par OS + mode d'install sûr, logiciels-cle.ts). Les paquets Linux passent, eux, par les paquets du profil.
          if (installeAuto(id, file) !== 'windows') continue;
          files[file] = f.chemin; const sa = silentArgs(id, file);
          sw.push({ name: f.nom, url: `${base(ctx)}/logiciel/${x.token}/${encodeURIComponent(file)}`, args: sa.args, msi: sa.msi });
        }
        const all = sessions(ctx); if (all[x.token]) { all[x.token].files = files; saveSessions(ctx, all); }
        return windowsAfter({ ...a, software: sw });
      }
      default: return undefined;
    }
  }
  function report(ctx: ModCtx, token: string, q: URLSearchParams, from: string): boolean {
    const x = sessionOf(ctx, token); if (!x || S.coupe(ctx, x.mac, from)) return false;
    const e = q.get('e') ?? '', nom = (q.get('nom') ?? '').replace(/[^\p{L}\p{N} ._-]/gu, '').slice(0, 63), ip = /^[\d.]{7,15}$/.test(q.get('ip') ?? '') ? q.get('ip')! : from;
    const info = isoName(x.iso);
    // Le poste a redemandé le menu après un abandon déclaré, puis continue : c'est la même installation (suivi.ts).
    S.renouer(ctx, x.mac, x.iso);
    if (e === 'installation') track(ctx, x.mac, from, 'installation', { iso: x.iso, isoName: info, detail: 'installation du système' });
    else if (e === 'logiciels') track(ctx, x.mac, from, 'logiciels', { detail: 'paquets et logiciels' });
    else if (e === 'logiciel') { const all = live(ctx), m = all[x.mac]; if (m) { m.logiciels = [...(m.logiciels ?? []), { nom: q.get('nom') ?? '?', ok: q.get('ok') === '1' }].slice(-40); all[x.mac] = m; saveLive(ctx, all); } track(ctx, x.mac, from, 'logiciels', { detail: `${q.get('nom')} ${q.get('ok') === '1' ? 'installé' : 'raté'}` }); }
    else if (e === 'fini') {
      // « fini » rejoué, ou arrivé après un échec dit par le poste : rien n'est réécrit (ni ligne, ni compteur, ni alerte).
      if (S.dejaFini(ctx, x.mac)) return true;
      const m = track(ctx, x.mac, ip, 'fini', { host: nom || x.host, detail: `installée : ${nom || x.host} (${ip})` });
      if (m) {
        finish(ctx, m, 'fini'); S.cloreJeton(ctx, x.mac);
        const bad = (m.logiciels ?? []).filter((l) => !l.ok);
        S.prevenir(ctx, 'fini', m.host ?? x.host, { level: bad.length ? 'moyenne' : 'info', title: `✅ ${m.host ?? x.host} installée (${m.isoName ?? info})`, detail: `Machine ${m.mac} · ${m.ip ?? ''} · en ${ago(m.updated - m.started)}${bad.length ? ` · logiciels ratés : ${bad.map((l) => l.nom).join(', ')}` : ''}.`, key: `thjalfi-fini-${m.mac}-${m.updated}` });
        ctx.emit('deploye', { mac: m.mac, nom: m.host ?? x.host, ip: m.ip ?? '', iso: m.isoName ?? info });
        void inventory(ctx, m);
      }
    } else if (e === 'echec') { if (!S.dejaEchec(ctx, x.mac)) { const m = track(ctx, x.mac, from, 'échec', { detail: S.raison(q.get('raison')) }); if (m) S.echec(ctx, m); } }
    else if (S.signal(ctx, x, e, q, from)) { /* signe de vie de l'installateur : pas une étape */ }
    else return false;
    return true;
  }
  const isoNames = new Map<string, string>();
  const isoName = (id: string) => isoNames.get(id) ?? id;
  /** Atlas : la machine installée a sa fiche (nom pris, MAC, adresse, système). */
  async function inventory(ctx: ModCtx, m: Machine): Promise<void> {
    const note = `Installée par Genèse : ${m.isoName ?? m.iso} (${new Date(m.updated).toLocaleDateString('fr-FR')})`;
    const r = await ctx.call('askr', 'ajouter', { nom: m.host ?? m.mac, type: 'ordinateur', mac: m.mac, ip: m.ip ?? '', notes: note }, `fiche de la machine ${m.host ?? m.mac} installée par le réseau`).catch((e) => ({ ok: false, text: (e as Error).message }));
    if (r.ok === false && /déjà dans l'inventaire/.test(r.text)) await ctx.call('askr', 'modifier', { appareil: m.mac, nom: m.host ?? '', ip: m.ip ?? '', notes: note }, `mise à jour de la fiche de ${m.host ?? m.mac}`).catch(() => undefined);
  }

  // ---------------- Démarrer / arrêter les serveurs ----------------
  /** Le serveur HTTP des PC qui démarrent (sans l'ouvrir : start() le fait écouter). */
  function creerHttp(ctx: ModCtx): PxeHttp {
    return new PxeHttp({
      bootScript: () => bootScript(ctx), menu: (mac, fw, from, q) => menuFor(ctx, mac, fw, from, q),
      overlay: (mac) => { const k = kiosk(ctx); return k && mac ? kioskOverlay({ base: base(ctx), mac, branch: k.branch }) : undefined; },
      alpine: (path) => alpineCopy(ctx, path),
      isoFile: async (id, path) => {
        const x = await isoById(ctx, id).catch(() => undefined); if (!x) return undefined; isoNames.set(id, x.info.name);
        if (path === undefined) return { size: x.info.size, open: (st, en) => import('node:fs').then((fs) => fs.createReadStream(x.info.path, { start: st, end: en })) };
        const stt = await x.iso.stat(path); if (!stt || stt.dir) return undefined;
        return { size: stt.size, open: async (st, en) => (await x.iso.stream(path, st, en + 1)).body };
      },
      bootFile: (path) => { const f = join(bootDir(ctx), path); return path.split('/').includes('..') || !existsSync(f) || statSync(f).isDirectory() ? undefined : f; },
      seed: (t, n, from) => seed(ctx, t, n, from),
      software: (t, file, from) => { const x = sessionOf(ctx, t); if (x && from && S.coupe(ctx, x.mac, from)) return undefined; if (x?.from && from !== x.from) return undefined; const f = x?.files?.[decodeURIComponent(file)]; return f && existsSync(f) ? f : undefined; },
      report: (t, q, from) => report(ctx, t, q, from),
      fetched: (mac, what, id, path, from) => {
        if (what === 'fichier') return;
        let iso = id, name = isoName(id);
        if (id === 'boot') { const r = rules(ctx).find((x) => x.mac === mac); if (!/^debian\//.test(path) && !/wimboot/.test(path)) return; iso = r?.iso ?? live(ctx)[mac ?? '']?.iso ?? 'debian'; name = isoName(iso); }
        // Un noyau rechargé en pleine installation : le poste a redémarré, l'ancien passage est clos et un nouveau commence.
        if (what === 'noyau') S.recharge(ctx, mac, from, iso);
        const m = track(ctx, mac, from, 'chargement', { iso, isoName: name, detail: what === 'iso' ? 'copie de l\'ISO en mémoire' : `démarrage de ${name}` });
        if (m && what === 'noyau') {
          bump(ctx, iso, 'lances');
          // Installation automatique : une seule fois (au prochain démarrage par le réseau, la machine reprend son disque).
          const all = rules(ctx), r = all.find((x) => x.mac === m.mac);
          if (r?.auto && !r.fait && r.iso === iso) { r.fait = true; ctx.saveSettings({ machines: all }); }
        }
      },
      ecran: { page: () => ecranPage(), etat: (mac) => ecranEtat(ctx, mac), choisir: (mac, iso, mode) => ecranChoisir(ctx, mac, iso, mode), attente: async (mac, fw, n, from) => ecranAttente(ctx, mac, fw, n, from), fond: (kind) => fond(ctx, kind), fin: () => fenetreFin({ theme: ecranCfg(ctx).theme }) },
      garde: (mac, from, quoi) => S.acces(ctx, mac, from, quoi), vu: (mac, q, from) => S.vu(ctx, mac, q, from), servi: (mac, from, id, n) => S.servi(ctx, mac, from, id, n), cle: (mac, fw, from, mdp, qui) => S.cle(ctx, mac, fw, from, mdp, qui),
      log: (t) => ctx.emit('journal', { texte: t }),
    });
  }

  // Un démarrage à la fois : deux démarrages mêlés laissaient un serveur ouvert que plus personne ne tenait (ni arrêt, ni veille).
  let fileDemarrages: Promise<unknown> = Promise.resolve();
  function startServers(ctx: ModCtx, o: { dejaVerifie?: boolean } = {}): Promise<string[]> {
    const p = fileDemarrages.then(() => startServersSeul(ctx, o)); fileDemarrages = p.catch(() => undefined); return p;
  }
  async function startServersSeul(ctx: ModCtx, o: { dejaVerifie?: boolean } = {}): Promise<string[]> {
    stopServers(); const p = ports(ctx), notes: string[] = [], mode = s(ctx.settings.mode) || 'proxy';
    http = creerHttp(ctx);
    await http.start(p.http);
    try {
      tftp = new TftpServer({ file: (name) => { const n = basename(name); const f = join(bootDir(ctx), n); return /^(undionly\.kpxe|ipxe(-arm64|-i386)?\.efi|snponly\.efi)$/.test(n) && existsSync(f) ? readFileSync(f) : undefined; }, sent: (name, from) => track(ctx, undefined, from, 'chargeur', { detail: name }) });
      await tftp.start(p.tftp);
    } catch (e) { tftp = undefined; notes.push(`TFTP (port ${p.tftp}) : ${(e as Error).message} — Odin doit pouvoir ouvrir ce port (administrateur).`); }
    if (mode === 'complet') { const n = await demarrerAPart(ctx, o.dejaVerifie === true); if (n) notes.push(n); }
    if (mode === 'proxy') {
      try { proxy = new ProxyDhcp({ server: () => serverIp(ctx), httpPort: () => http?.port ?? p.http, allowed: (mac) => s(ctx.settings.filtre) !== 'liste' || rules(ctx).some((r) => r.mac === mac), seen: (mac, fw, ipxe) => { if (!ipxe) track(ctx, mac, undefined, 'démarrage réseau', { fw }); } }); await proxy.start(p.dhcp, p.pxe, p.client); }
      catch (e) { proxy = undefined; notes.push(`proxy DHCP (ports ${p.dhcp} et ${p.pxe}) : ${(e as Error).message}`); }
    }
    // Avec le DHCP d'Odin (Sphinx) : il ajoute lui-même le démarrage par le réseau. (Le mode « complet » ajoute le sien,
    // seulement sur le réseau à part : le serveur d'adresses de la maison n'y gagne rien.)
    if (mode !== 'aucun' && mode !== 'complet') pxeHook.get = (pk) => demarragePour(ctx, pk, serverIp(ctx));
    return notes;
  }
  /** Ce qu'un PC qui démarre reçoit en plus de son adresse (chargeur, puis menu) ; rien s'il n'a pas le droit. */
  function demarragePour(ctx: ModCtx, pk: Packet, ip: string) {
    if (s(ctx.settings.filtre) === 'liste' && !rules(ctx).some((r) => r.mac === pk.mac)) return undefined;
    const b = bootFor(pk, ip, http?.port ?? ports(ctx).http); if (b && !/^http/.test(b.file)) track(ctx, pk.mac, undefined, 'démarrage réseau', { fw: firmware(pk.options.get(93)) }); return b;
  }

  // ---------------- Le réseau : carte, adresses, garde-fou (maquette « Genèse · Systèmes », lot S8) ----------------
  let aPart: DhcpAPart | undefined, aPartCarte: CarteReseau | undefined, aPartTour = 0;
  const cartesDuPc = (): CarteReseau[] => { try { return RESEAU.cartes(); } catch { return []; } };
  /** La carte réseau choisie (par son nom), si elle est toujours là. */
  function carteChoisie(ctx: ModCtx, nom?: string): CarteReseau | undefined { const n = nom ?? s(ctx.settings.carte); if (!n) return undefined; try { return RESEAU.cartes().find((c) => c.nom === n); } catch { return undefined; } }
  const gardeDe = (ctx: ModCtx): Garde => { const g = ctx.settings.garde as Garde | undefined; return g && typeof g === 'object' && typeof g.etat === 'string' ? { ...g, autres: Array.isArray(g.autres) ? g.autres : [] } : { etat: 'non_verifie', autres: [] }; };
  const plageDe = (ctx: ModCtx): PlageComplet | undefined => ctx.settings.plage as PlageComplet | undefined;
  const BAUX_A_PART = 'baux-reseau-a-part.json';
  const bauxAPart = (ctx: ModCtx): Lease[] => { try { const l = JSON.parse(readFileSync(join(ctx.dir, BAUX_A_PART), 'utf8')); return Array.isArray(l) ? l : []; } catch { return []; } };
  /** Le garde-fou : un autre serveur d'adresses répond-il sur cette carte ? (avant d'allumer, puis chaque minute) */
  async function verifierCarte(ctx: ModCtx, c: CarteReseau, enMarche: boolean): Promise<Garde> {
    const p = ports(ctx);
    const r = await RESEAU.chercher(c, { serveur: p.dhcp, client: p.client }).catch((e: Error) => ({ serveurs: [] as string[], erreur: e.message }));
    const g = conclure(r, c.nom, ctx.now().getTime(), enMarche); ctx.saveSettings({ garde: g }); return g;
  }
  // Chaque arrêt change le tour : un démarrage encore en route (vérification, écoute) se ferme lui-même en arrivant.
  function arreterAPart(): void { aPartTour++; if (aPart) { aPart.arrete = true; aPart.stop(); } aPart = undefined; aPartCarte = undefined; }
  /** Coupe tout de suite la distribution d'adresses sur le réseau à part, et le dit (alerte). */
  function couperAPart(ctx: ModCtx, raison: string, autres: string[] = []): void {
    const avait = Boolean(aPart); arreterAPart();
    const g: Garde = { etat: 'coupe', carte: s(ctx.settings.carte), autres, verifie: ctx.now().getTime(), raison: `Odin a arrêté de distribuer les adresses : ${raison.replace(/^Refusé : ça casserait le réseau de la maison\. /, '').replace(/\.$/, '')}.` };
    ctx.saveSettings({ garde: g }); ctx.emit('journal', { texte: `Réseau à part : ${g.raison}` });
    if (avait) ctx.alert({ level: 'haute', title: 'Genèse a arrêté de distribuer les adresses', detail: `${g.raison} Deux serveurs d'adresses à la fois couperaient Internet aux appareils de la maison. Les PC du réseau à part ne reçoivent plus d'adresse ; rien d'autre ne change. Vérifie la carte, puis rechoisis « Odin distribue les adresses » sur la page Réseau, ou reste « À côté de la box ».`, key: 'thjalfi-reseau-a-part-coupe', data: { carte: g.carte, autres } });
  }
  /** Tout ce qu'il faut AVANT de distribuer des adresses : la carte, la plage, et personne d'autre qui en distribue. */
  async function preparerAPart(ctx: ModCtx, entree: Record<string, unknown> | undefined, dejaVerifie: boolean, nomCarte?: string): Promise<{ refus: string; garde?: Garde } | { c: CarteReseau; p: PlageComplet }> {
    const c = carteChoisie(ctx, nomCarte), non = refusCarte(c, RESEAU.plateforme()); if (non || !c) return { refus: non ?? 'Choisis d\'abord la carte réseau du réseau à part.' };
    const p = verifierPlage(c, (entree ?? plageDe(ctx) ?? {}) as Record<string, unknown>); if ('refus' in p) return { refus: p.refus };
    const g0 = gardeDe(ctx);
    if (dejaVerifie && g0.etat === 'libre' && g0.carte === c.nom && ctx.now().getTime() - (g0.verifie ?? 0) < 15_000) { const partage = refusPartage(c, cartesDuPc()); return partage ? { refus: partage } : { c, p }; }
    const g = await verifierCarte(ctx, c, false); if (g.etat !== 'libre') return { refus: g.raison ?? 'Refusé.', garde: g };
    // Après la recherche (la box se dit d'abord) : une carte à deux adresses, ou deux cartes sur le même réseau, refusées.
    const partage = refusPartage(c, cartesDuPc()); if (partage) return { refus: partage };
    return { c, p };
  }
  /** Le serveur d'adresses du réseau à part : n'écoute QUE l'adresse de la carte choisie. Le refus en mots, ou rien. */
  async function demarrerAPart(ctx: ModCtx, dejaVerifie: boolean): Promise<string | undefined> {
    arreterAPart(); const tour = aPartTour;
    // Après une coupure du garde-fou, Odin ne redistribue pas tout seul (redémarrage d'Odin, relance) : seulement quand tu
    // le rechoisis (Allumer, ou « Odin distribue les adresses »), qui revérifie la carte.
    const g0 = gardeDe(ctx);
    if (!dejaVerifie && g0.etat === 'coupe') return `adresses : Odin s'était arrêté de distribuer sur ${g0.carte || 'la carte'} (${String(g0.raison ?? '').replace(/^Odin a arrêté de distribuer les adresses : /, '').replace(/\.$/, '')}). Il ne recommence pas tout seul : rechoisis « Odin distribue les adresses » sur la page Réseau.`;
    const x = await preparerAPart(ctx, undefined, dejaVerifie); if ('refus' in x) return `adresses : ${x.refus}`;
    if (tour !== aPartTour) return 'adresses : un autre démarrage a pris la main.';
    const { c, p } = x, pt = ports(ctx);
    const config = (): DhcpConfig => ({ server: c.ip, start: p.debut, end: p.fin, mask: p.masque, router: p.passerelle, dns: p.dns, leaseSeconds: p.bail, fixed: [],
      ...(s(ctx.settings.filtre) === 'liste' ? { macPolicy: { mode: 'liste' as const, etats: Object.fromEntries(rules(ctx).map((r) => [r.mac, 'actif' as const])), attente: [] } } : {}) });
    const srv: DhcpAPart = new DhcpAPart({ config, carte: () => c, leases: () => bauxAPart(ctx), save: (l) => saveJson(ctx, BAUX_A_PART, l), now: () => ctx.now().getTime(),
      log: (t) => ctx.emit('journal', { texte: t }), demarrage: (pk) => demarragePour(ctx, pk, c.ip),
      alerte: (raison, autre) => { if (aPart === srv) couperAPart(ctx, raison, autre ? [autre] : []); } });
    try { await RESEAU.ecouter(srv, pt.dhcp, pt.client, c.ip); } catch (e) { srv.arrete = true; srv.stop(); return `adresses (port ${pt.dhcp} sur ${c.ip}) : ${(e as Error).message}`; }
    // Arrêté (ou relancé) pendant l'écoute : ce serveur-ci ne doit pas rester ouvert sans que personne le tienne.
    if (tour !== aPartTour) { srv.arrete = true; srv.stop(); return 'adresses : un autre démarrage a pris la main.'; }
    aPart = srv; aPartCarte = c; return undefined;
  }
  function stopServers(): void { http?.stop(); tftp?.stop(); proxy?.stop(); arreterAPart(); http = undefined; tftp = undefined; proxy = undefined; pxeHook.get = undefined; for (const i of open.values()) void i.close(); open.clear(); }
  const firmware = (b: Buffer | undefined): Firmware => { const n = b && b.length >= 2 ? b.readUInt16BE(0) : 0; return n === 7 || n === 9 ? 'uefi' : n === 6 ? 'uefi32' : n === 11 ? 'arm64' : 'bios'; };

  /** Télécharge un fichier officiel, empreinte gardée ; un fichier suspect pour l'antivirus est jeté. */
  async function fetchTo(ctx: ModCtx, url: string, file: string, sha?: string, ms = 120_000): Promise<{ ok: boolean; text: string }> {
    try {
      const r = await ctx.fetch(url, { signal: AbortSignal.timeout(ms), headers: { 'user-agent': 'Odin-Thjalfi/1' } }); if (!r.ok) return { ok: false, text: `${basename(file)} : HTTP ${r.status}` };
      const b = Buffer.from(await r.arrayBuffer()); const h = createHash('sha256').update(b).digest('hex');
      if (sha && sha !== h) return { ok: false, text: `${basename(file)} : empreinte différente de celle publiée, fichier jeté` };
      mkdirSync(join(file, '..'), { recursive: true }); writeFileSync(`${file}.part`, b);
      const v = await ctx.call('ullr', 'fichier', { chemin: `${file}.part` }, `vérifier ${basename(file)} avant de le servir aux machines`).catch(() => undefined);
      const lvl = (v?.data as { level?: string } | undefined)?.level;
      if (lvl && ['moyenne', 'haute', 'critique'].includes(lvl)) { rmSync(`${file}.part`, { force: true }); ctx.alert({ level: 'haute', title: `Genèse : ${basename(file)} refusé par l'antivirus`, detail: `Téléchargé depuis ${url}, jugé ${lvl} par Asclépios : il n'est pas servi aux machines.`, key: `thjalfi-ullr-${basename(file)}` }); return { ok: false, text: `🛡 ${basename(file)} mis de côté (antivirus : ${lvl})` }; }
      renameSync(`${file}.part`, file);
      const sums = (ctx.settings.empreintes as Record<string, string> | undefined) ?? {}; sums[basename(file)] = h; ctx.saveSettings({ empreintes: sums });
      return { ok: true, text: `✅ ${basename(file)} (${Math.round(b.length / 1024)} Ko${sha ? ', empreinte vérifiée' : ''})` };
    } catch (e) { return { ok: false, text: `${basename(file)} : ${(e as Error).message}` }; }
  }

  // ---------------- Actions ----------------
  const isoParam = { key: 'iso', label: 'ISO (nom ou début du nom)', kind: 'text' as const, required: true };
  const findIso = async (ctx: ModCtx, q: unknown) => { const t = slug(s(q)), l = await isos(ctx); const x = l.find((i) => i.id === t) ?? l.find((i) => i.id.includes(t) && t.length >= 3) ?? l.find((i) => i.name.toLowerCase().includes(s(q).toLowerCase()) && s(q).length >= 3); if (!x) throw new Error(`ISO introuvable : « ${s(q)} » (voir la liste des ISO)`); return x; };
  const macParam = { key: 'mac', label: 'Adresse MAC de la machine', kind: 'text' as const, required: true };
  const actions: Action[] = [
    { id: 'etat', label: 'État', what: 'Serveur allumé ou non, ISO prêtes, machines en cours', read: true, words: ['état du pxe', 'état du démarrage réseau', 'pxe'], run: async (ctx) => {
      C = ctx; const l = await isos(ctx), m = Object.values(live(ctx)).filter((x) => !FINAL.includes(x.step)), ready = LOADERS.filter((x) => existsSync(join(bootDir(ctx), x.file)));
      return { text: `Genèse ${http ? `allumé · http://${serverIp(ctx)}:${http.port}` : 'éteint'} · ${l.filter((i) => i.recipe).length} ISO démarrable(s) (${l.filter((i) => i.recipe?.auto).length} en installation automatique) · chargeurs : ${ready.length}/${LOADERS.length} · ${m.length} machine(s) en cours${m.length ? `\n${m.map((x) => `- ${x.host ?? x.mac} : ${x.step}${x.isoName ? ` (${x.isoName})` : ''}`).join('\n')}` : ''}`, data: { allume: Boolean(http), port: http?.port, ip: serverIp(ctx), isos: l.map((i) => ({ id: i.id, nom: i.name, type: i.recipe?.kind, auto: i.recipe?.auto })), enCours: m } };
    } },
    { id: 'allumer', label: 'Allumer', what: 'Répond aux machines qui démarrent par le réseau (une machine inconnue démarre sur son disque par défaut)', words: ['allume le pxe', 'allume le démarrage réseau', 'démarre le pxe'], proprietaireSeul: true,
      // Allumer démarre des services sur le réseau de la maison : ta validation, en voyant lesquels.
      grave: (_i, ctx) => {
        const p = ctx ? ports(ctx) : { dhcp: 67, pxe: 4011, tftp: 69, http: 16000 }, mode = ctx ? modeAdresses(s(ctx.settings.mode) || 'proxy') : 'proxy';
        if (mode === 'complet' && ctx) { const pl = plageDe(ctx); return `allumer le démarrage par le réseau ET distribuer des adresses sur le réseau à part (carte ${s(ctx.settings.carte) || '?'}${pl ? `, de ${pl.debut} à ${pl.fin}` : ''}) : Odin vérifie d'abord qu'aucun autre serveur d'adresses n'y répond, puis chaque minute (DHCP ${p.dhcp}/udp sur cette carte seulement, TFTP ${p.tftp}/udp, HTTP ${p.http}/tcp)`; }
        return `allumer le démarrage par le réseau : Odin répond sur le réseau de la maison aux machines qui démarrent par le réseau (DHCP ${p.dhcp} et ${p.pxe}/udp, TFTP ${p.tftp}/udp, HTTP ${p.http}/tcp ; mode ${mode})`;
      },
      run: async (ctx) => {
      C = ctx;
      // Distribuer des adresses : la carte, la plage et le garde-fou AVANT d'allumer quoi que ce soit ; un refus n'allume rien.
      let verifie = false;
      if (modeAdresses(s(ctx.settings.mode) || 'proxy') === 'complet') {
        const x = await preparerAPart(ctx, undefined, false);
        if ('refus' in x) return { ok: false, text: `Genèse reste éteint. ${x.refus}`, data: { garde: gardeDe(ctx) } };
        verifie = true;
      }
      const notes = await startServers(ctx, { dejaVerifie: verifie }); ctx.saveSettings({ allume: true });
      const miss = LOADERS.filter((x) => x.file !== 'wimboot' && x.file !== 'ipxe-arm64.efi' && !existsSync(join(bootDir(ctx), x.file)));
      return { text: `▶ Genèse allumé : menu sur ${base(ctx)}/boot.ipxe · mode ${s(ctx.settings.mode) || 'proxy'}${notes.length ? `\n⚠ ${notes.join('\n⚠ ')}` : ''}${miss.length ? `\n⚠ Chargeurs manquants (${miss.map((x) => x.file).join(', ')}) : dis « prépare le pxe ».` : ''}` };
    }, undo: () => ({ action: 'eteindre', input: {}, label: 'Éteindre' }) },
    { id: 'eteindre', proprietaireSeul: true, label: 'Éteindre', what: 'Ne répond plus aux machines qui démarrent par le réseau', quick: false, run: (ctx) => { stopServers(); ctx.saveSettings({ allume: false }); return { text: '⏹ Genèse éteint : les machines démarrent sur leur disque.' }; }, undo: () => ({ action: 'allumer', input: {}, label: 'Rallumer' }) },
    { id: 'preparer', proprietaireSeul: true, label: 'Préparer (chargeurs officiels)', what: 'Télécharge iPXE et wimboot depuis leurs sites officiels, et le programme d\'installation réseau de Debian pour tes ISO Debian ; tout passe par l\'antivirus', words: ['chargeurs pxe', 'télécharge ipxe', 'prépare le pxe'], external: true, run: async (ctx) => {
      const out: string[] = [];
      for (const l of LOADERS) out.push((await fetchTo(ctx, l.url, join(bootDir(ctx), l.file))).text);
      for (const i of (await isos(ctx)).filter((x) => x.recipe?.kind === 'debian' && x.recipe.codename)) {
        const c = i.recipe!.codename!, root = `https://deb.debian.org/debian/dists/${c}/main/installer-amd64/current/images`;
        let sums = ''; try { const r = await ctx.fetch(`${root}/SHA256SUMS`, { signal: AbortSignal.timeout(30_000) }); if (r.ok) sums = await r.text(); } catch { /* hors ligne */ }
        for (const f of ['linux', 'initrd.gz']) { const sha = new RegExp(`^([0-9a-f]{64})\\s+\\./netboot/debian-installer/amd64/${f.replace('.', '\\.')}$`, 'm').exec(sums)?.[1]; out.push(sha ? `Debian ${c} · ${(await fetchTo(ctx, `${root}/netboot/debian-installer/amd64/${f}`, join(bootDir(ctx), 'debian', c, f), sha)).text}` : `Debian ${c} · ${f} : empreinte officielle introuvable, rien téléchargé`); }
      }
      if (ecranCfg(ctx).actif && ecranCfg(ctx).surPc !== false) out.push(await prepareKiosk(ctx));
      return { text: `Préparation :\n${out.join('\n')}`, ok: out.some((x) => x.includes('✅')) };
    } },
    { id: 'isos', label: 'ISO', what: 'Les ISO d\'Andromède, ce que Genèse en fait, et combien de fois chacune a été déployée', read: true, words: ['iso déployables', 'liste des iso du déploiement'], run: async (ctx) => {
      const l = await isos(ctx), st = stats(ctx), def = s(ctx.settings.defaut) || 'local';
      return { text: l.length ? l.map((i) => `- ${i.id === def ? '★ ' : ''}${i.name} : ${i.recipe?.label ?? `illisible (${i.err})`}${i.recipe?.needs ? ` — il faut ${i.recipe.needs}` : ''} · déployée ${st[i.id]?.lances ?? 0} fois, ${st[i.id]?.finis ?? 0} réussie(s)`).join('\n') : `Aucune ISO dans ${await isoRoot(ctx)} (Andromède).`, data: l };
    } },
    { id: 'iso_par_defaut', proprietaireSeul: true, label: 'ISO par défaut', what: 'Ce que démarre une machine qui ne choisit rien dans le menu (« disque » = son propre disque)', params: [{ key: 'iso', label: 'ISO, ou « disque »', kind: 'text', required: true }, { key: 'delai', label: 'Délai du menu (secondes)', kind: 'number', default: 10 }], words: ['iso par défaut', 'iso à déployer'], run: async (ctx, i) => {
      const d = Math.max(0, Math.min(300, Number(i.delai ?? 10)));
      if (/^(disque|local|aucune?)$/i.test(s(i.iso).trim())) { ctx.saveSettings({ defaut: 'local', delai: d }); return { text: `Par défaut : les machines démarrent sur leur propre disque (menu ${d} s).` }; }
      const x = await findIso(ctx, i.iso);
      // Lot S9 : une entrée qui installe ou peut effacer ne démarre jamais seule sur un PC non autorisé.
      if (installe(x.recipe)) return { ok: false, text: `Refusé : ${x.name} installe un système (ou peut effacer le disque) ; il ne démarre jamais tout seul sur un PC qui n'est pas autorisé. Par défaut : le disque du PC, l'écran d'Odin ou un système à essayer. Pour installer sur un PC précis : « Déployer ».` };
      ctx.saveSettings({ defaut: x.id, delai: d });
      return { text: `★ Par défaut : ${x.name} (${x.recipe?.label ?? '?'}) après ${d} s de menu : il démarre pour essayer, rien n'est installé.` };
    } },
    { id: 'autoriser', label: 'Autoriser une machine', proprietaireSeul: true, what: 'Cette machine (par son adresse MAC) démarre l\'ISO choisie ; avec « installation automatique », elle s\'installe toute seule une fois (son disque est effacé)', params: [macParam, { ...isoParam, required: false }, { key: 'nom', label: 'Nom sur le réseau (vide = pc-xxxxxx)', kind: 'text', default: '' }, { key: 'profil', label: 'Profil (compte, paquets, logiciels)', kind: 'text', default: 'standard' }, { key: 'auto', label: 'Installation automatique (efface le disque)', kind: 'boolean', default: false }],
      grave: (i) => (i.auto === true || i.auto === 'true' ? `installer automatiquement ${s(i.iso)} sur la machine ${s(i.mac)} : son disque sera EFFACÉ au prochain démarrage par le réseau` : undefined),
      words: ['autorise la machine', 'installe automatiquement', 'déploie sur la machine'], run: async (ctx, i) => {
        const mac = normMac(s(i.mac)); if (!mac) throw new Error('adresse MAC invalide (ex. 52:54:00:12:34:56)');
        const auto = i.auto === true || i.auto === 'true'; const iso = s(i.iso) ? await findIso(ctx, i.iso) : undefined;
        if (auto && !iso) throw new Error('choisis l\'ISO à installer');
        if (auto && !iso!.recipe?.auto) throw new Error(`${iso!.name} ne sait pas s'installer toute seule (${iso!.recipe?.label ?? 'ISO illisible'})`);
        if (auto && iso!.recipe?.kind === 'windows' && !(ctx.settings.partage as { unc?: string } | undefined)?.unc) throw new Error('Windows : règle d\'abord le partage réseau (« partage Windows »)');
        const p = profiles(ctx).find((x) => x.id === slug(s(i.profil) || 'standard') || x.nom.toLowerCase() === s(i.profil).toLowerCase()) ?? profiles(ctx)[0];
        const all = rules(ctx).filter((r) => r.mac !== mac); all.push({ mac, nom: s(i.nom) ? hostLabel(s(i.nom)) : undefined, iso: iso?.id, profil: p.id, auto, ajoute: ctx.now().getTime() });
        ctx.saveSettings({ machines: all });
        return { text: `${auto ? '🛠' : '✔'} ${mac}${s(i.nom) ? ` (${hostLabel(s(i.nom))})` : ''} : ${iso ? iso.name : 'menu normal'}${auto ? ` en installation automatique, profil ${p.nom}, au prochain démarrage par le réseau (une seule fois)` : ''}.` };
      }, undo: (i) => ({ action: 'retirer_machine', input: { mac: s(i.mac) }, label: 'Retirer' }) },
    { id: 'retirer_machine', label: 'Retirer une machine', what: 'Elle redevient une machine inconnue : retirée de la liste du démarrage réseau (et, sur un réseau à part, de ses adresses)', quick: false, proprietaireSeul: true, params: [macParam], run: (ctx, i) => {
      const mac = normMac(s(i.mac)); const all = rules(ctx); if (!all.some((r) => r.mac === mac)) throw new Error('machine absente de la liste'); ctx.saveSettings({ machines: all.filter((r) => r.mac !== mac) });
      // Sur un réseau à part avec la liste des PC autorisés : son bail est repris, il n'y a plus d'adresse (« supprimé du réseau »).
      const baux = bauxAPart(ctx), reste = baux.filter((l) => l.mac !== mac); if (reste.length !== baux.length) saveJson(ctx, BAUX_A_PART, reste);
      return { text: `${mac} retirée : elle ne démarre plus par le réseau d'Odin${modeAdresses(s(ctx.settings.mode) || 'proxy') === 'complet' && s(ctx.settings.filtre) === 'liste' ? ' et ne reçoit plus aucune adresse du réseau à part' : ''}.` };
    } },
    { id: 'reinstaller', proprietaireSeul: true, label: 'Réinstaller', what: 'Relance l\'installation automatique d\'une machine déjà installée (son disque sera effacé)', quick: false, params: [macParam], grave: (i) => `réinstaller la machine ${s(i.mac)} : son disque sera EFFACÉ au prochain démarrage par le réseau`, run: (ctx, i) => { const mac = normMac(s(i.mac)); const all = rules(ctx), r = all.find((x) => x.mac === mac); if (!r?.auto) throw new Error('cette machine n\'a pas d\'installation automatique'); r.fait = false; ctx.saveSettings({ machines: all }); return { text: `🛠 ${mac} se réinstallera au prochain démarrage par le réseau.` }; } },
    { id: 'profil', proprietaireSeul: true, label: 'Profil d\'installation', what: 'Compte créé, langue, clavier, fuseau, paquets Linux et logiciels Windows (Hermès) ; le mot de passe est généré et rangé dans le coffre', params: [{ key: 'nom', label: 'Nom', kind: 'text', required: true }, { key: 'utilisateur', label: 'Compte créé', kind: 'text', default: 'admin' }, { key: 'paquets', label: 'Paquets Linux (séparés par des virgules)', kind: 'text', default: '' }, { key: 'logiciels', label: 'Logiciels Windows de Hermès (ex. firefox, vlc, 7zip)', kind: 'text', default: '' }, { key: 'fuseau', label: 'Fuseau', kind: 'text', default: 'Indian/Mayotte' }, { key: 'clavier', label: 'Clavier', kind: 'text', default: 'fr' }, { key: 'langue', label: 'Langue', kind: 'text', default: 'fr_FR.UTF-8' }, { key: 'compagnon', label: 'Compagnon d\'Odin sur la machine (antivirus, mises à jour, failles)', kind: 'boolean', default: true }], quick: false, run: async (ctx, i) => {
      const nom = s(i.nom).trim(); if (!nom) throw new Error('donne un nom'); const id = slug(nom), list = (ctx.settings.profils as Profile[] | undefined) ?? profiles(ctx);
      const user = s(i.utilisateur || 'admin').toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 32) || 'admin';
      const split = (x: unknown) => s(x).split(/[,\s]+/).map((y) => y.trim()).filter((y) => /^[\w.+-]+$/.test(y));
      const p: Profile = { id, nom, utilisateur: user, paquets: split(i.paquets), logiciels: split(i.logiciels).map((x) => x.toLowerCase()), fuseau: s(i.fuseau) || 'Indian/Mayotte', clavier: s(i.clavier) || 'fr', langue: s(i.langue) || 'fr_FR.UTF-8', ...(i.compagnon === false || i.compagnon === 'false' ? { compagnon: false } : {}) };
      ctx.saveSettings({ profils: [...list.filter((x) => x.id !== id), p] }); await profilePassword(ctx, p);
      return { text: `Profil ${nom} : compte « ${user} » (mot de passe dans le coffre, Thésauros « Déploiement · ${nom} »)${p.paquets.length ? ` · paquets : ${p.paquets.join(', ')}` : ''}${p.logiciels.length ? ` · logiciels : ${p.logiciels.join(', ')}` : ''}.` };
    } },
    { id: 'partage_windows', proprietaireSeul: true, label: 'Partage Windows', what: 'Le partage réseau (SMB, ton NAS) où Odin dépose les fichiers d\'installation de Windows', params: [{ key: 'unc', label: 'Chemin réseau (ex. \\\\nas\\iso)', kind: 'text', required: true }, { key: 'dossier', label: 'Le même partage monté chez Odin (ex. /mnt/nas/iso)', kind: 'text', required: true }, { key: 'utilisateur', label: 'Utilisateur du partage', kind: 'text', default: '' }, { key: 'mot_de_passe', label: 'Mot de passe du partage', kind: 'password', default: '' }], quick: false, run: (ctx, i) => {
      const unc = s(i.unc).trim(); if (!/^\\\\[\w.-]+\\[^\\]+/.test(unc)) throw new Error('chemin réseau attendu : \\\\nas\\partage');
      ctx.saveSettings({ partage: { unc, local: s(i.dossier).trim(), utilisateur: s(i.utilisateur).trim() || undefined } });
      if (s(i.mot_de_passe)) saveSecrets(ctx, { ...secrets(ctx), partage: s(i.mot_de_passe) });
      return { text: `Partage Windows : ${unc} (monté chez Odin dans ${s(i.dossier)}). Dis « prépare Windows <ISO> » pour y déposer les fichiers d'installation.` };
    } },
    { id: 'preparer_windows', proprietaireSeul: true, label: 'Préparer Windows', what: 'Copie les fichiers d\'installation d\'une ISO Windows sur le partage (une fois par version)', params: [isoParam], quick: false, run: async (ctx, i) => {
      const x = await findIso(ctx, i.iso); if (x.recipe?.kind !== 'windows') throw new Error(`${x.name} n'est pas une ISO de Windows`);
      const sh = ctx.settings.partage as { local?: string } | undefined; if (!sh?.local) throw new Error('règle d\'abord le partage Windows');
      const dest = join(sh.local, '.thjalfi', x.id), iso = await Iso.open(x.path); let n = 0, bytes = 0;
      try {
        const copy = async (dir: string) => { for (const e of await iso.list(dir)) { const p = dir === '/' ? e.name : `${dir}/${e.name}`; if (e.dir) { mkdirSync(join(dest, p), { recursive: true }); await copy(p); continue; } const { body } = await iso.stream(p); mkdirSync(join(dest, p, '..'), { recursive: true }); const { createWriteStream } = await import('node:fs'); await new Promise<void>((ok, ko) => body.pipe(createWriteStream(join(dest, p))).on('finish', ok).on('error', ko)); n++; bytes += e.size; } };
        mkdirSync(dest, { recursive: true }); await copy('/');
      } finally { await iso.close(); }
      return { text: `✅ ${x.name} : ${n} fichiers (${(bytes / 1024 ** 3).toFixed(1).replace('.', ',')} Go) déposés dans ${dest}.` };
    } },
    { id: 'cle_windows', proprietaireSeul: true, label: 'Clé d\'activation Windows', what: 'Dépose une de TES clés Windows pour une édition (ex. Windows 11 Pro) : gardée chiffrée dans le coffre, jamais montrée en entier ; injectée toute seule à l\'installation des images de cette édition', quick: false,
      params: [{ key: 'edition', label: 'Édition de Windows', kind: 'select', options: EDITIONS.map((e) => e.label), default: EDITIONS[0].label }, { key: 'cle', label: 'Clé (XXXXX-XXXXX-XXXXX-XXXXX-XXXXX)', kind: 'password', required: true }], words: ['clé windows', 'clé d\'activation', 'clé de licence windows', 'product key'],
      run: (ctx, i) => { const ed = editionDepuisChoix(s(i.edition)); if (!ed) throw new Error('choisis une édition de Windows'); const r = deposerCle(ctx.home, ctx.dir, ed.id, s(i.cle)); return { text: `🔑 Clé rangée pour ${r.edition} (${masque(r.indice)}). Elle sera injectée toute seule à l'installation des images ${r.edition} ; sans clé, l'installation reste sans activation.` }; },
      undo: (i) => { const ed = editionDepuisChoix(s(i.edition)); return ed ? { action: 'retirer_cle_windows', input: { edition: ed.label }, label: 'Retirer la clé' } : undefined; } },
    { id: 'retirer_cle_windows', proprietaireSeul: true, label: 'Retirer une clé Windows', what: 'Supprime la clé d\'activation déposée pour une édition', quick: false, params: [{ key: 'edition', label: 'Édition', kind: 'select', options: EDITIONS.map((e) => e.label), default: EDITIONS[0].label }], run: (ctx, i) => { const ed = editionDepuisChoix(s(i.edition)); if (!ed) throw new Error('édition inconnue'); const ok = supprimerCle(ctx.dir, ed.id); return { text: ok ? `Clé retirée pour ${ed.label}.` : `Aucune clé déposée pour ${ed.label}.`, ok: ok ? undefined : false }; } },
    { id: 'mode', label: 'Mode DHCP', what: '« proxy » : à côté de la box, la box donne les adresses, Odin ajoute le démarrage réseau (rien à régler, conseillé) ; « complet » : Odin distribue les adresses, seulement sur un réseau à part (refusé si un autre serveur d\'adresses répond sur la carte) ; « odin » : le DHCP d\'Odin (Sphinx) ; « aucun » : tu règles toi-même ta box', proprietaireSeul: true,
      params: [{ key: 'mode', label: 'Mode', kind: 'select', options: [...MODES_ADRESSES], default: 'proxy' }, { key: 'filtre', label: 'Répondre à', kind: 'select', options: ['tous', 'liste'], default: 'tous' },
        { key: 'carte', label: 'Carte réseau (vide : celle d\'avant)', kind: 'text', default: '' }, { key: 'debut', label: 'Réseau à part : première adresse', kind: 'text', default: '' }, { key: 'fin', label: 'Réseau à part : dernière adresse', kind: 'text', default: '' },
        { key: 'passerelle', label: 'Réseau à part : passerelle (vide : Odin)', kind: 'text', default: '' }, { key: 'bail', label: 'Réseau à part : durée du bail (secondes)', kind: 'number', default: 7200 }], quick: false,
      grave: (i, ctx) => {
        // Le mode non redit garde celui d'avant : changer de carte ou de plage en mode complet demande aussi ton accord.
        if ((s(i.mode) || (ctx ? s(ctx.settings.mode) : '')) !== 'complet') return undefined;
        const nom = s(i.carte) || (ctx ? s(ctx.settings.carte) : '');
        return `distribuer des adresses sur la carte ${nom || '?'} (réseau à part${s(i.debut) && s(i.fin) ? `, de ${s(i.debut)} à ${s(i.fin)}` : ''}) : Odin vérifie d'abord qu'aucun autre serveur d'adresses (la box) n'y répond, refuse s'il en voit un, revérifie chaque minute et s'arrête s'il en apparaît un`;
      },
      run: async (ctx, i) => {
        const mode = s(i.mode) ? modeAdresses(s(i.mode)) : modeAdresses(s(ctx.settings.mode) || 'proxy');
        if (s(i.mode) && !MODES_ADRESSES.includes(s(i.mode) as never)) throw new Error(`mode inconnu : ${s(i.mode)} (proxy, complet, odin ou aucun)`);
        const filtre = s(i.filtre) === 'liste' ? 'liste' : s(i.filtre) === 'tous' ? 'tous' : (s(ctx.settings.filtre) === 'liste' ? 'liste' : 'tous');
        const nomCarte = s(i.carte).trim();
        if (nomCarte) { let l: CarteReseau[] = []; try { l = RESEAU.cartes(); } catch { /* aucune */ } if (!l.some((c) => c.nom === nomCarte)) throw new Error(`carte réseau introuvable : « ${nomCarte.slice(0, 60)} »`); }
        if (mode === 'complet') {
          // Rien n'est gardé tant que tout n'est pas vérifié : un refus laisse la carte et le mode d'avant.
          const x = await preparerAPart(ctx, i, false, nomCarte || undefined);
          if ('refus' in x) return { ok: false, text: x.refus, data: { garde: x.garde ?? gardeDe(ctx), refus: true } };
          ctx.saveSettings({ mode, filtre, carte: x.c.nom, plage: x.p });
          if (http) { const n = await startServers(ctx, { dejaVerifie: true }); if (n.length) return { ok: false, text: `⚠ ${n.join('\n⚠ ')}`, data: { garde: gardeDe(ctx) } }; }
          return { text: `🛡 Odin distribue les adresses sur ${x.c.nom} seulement (réseau à part) : de ${x.p.debut} à ${x.p.fin}, bail de ${Math.round(x.p.bail / 360) / 10} h. Aucun autre serveur d'adresses n'y répond ; Odin le revérifie chaque minute et s'arrête s'il en apparaît un.${http ? '' : ' Allume Genèse pour commencer.'}`, data: { garde: gardeDe(ctx) } };
        }
        ctx.saveSettings({ mode, filtre, ...(nomCarte ? { carte: nomCarte } : {}), garde: { etat: 'non_verifie', autres: [] } }); if (http) await startServers(ctx);
        const ip = serverIp(ctx), l = lignesBox(ip, http?.port ?? ports(ctx).http);
        return { text: `${mode === 'proxy' ? 'À côté de la box : la box garde les adresses, Odin ajoute seulement « où démarrer ». Rien à changer sur la box.' : mode === 'odin' ? 'Le serveur d\'adresses d\'Odin (Sphinx) ajoute le démarrage par le réseau.' : 'Ta box s\'en charge.'} · ${filtre === 'liste' ? 'seulement les machines autorisées' : 'toutes les machines qui démarrent par le réseau'}.${mode === 'aucun' ? `\nDans ta box : ${l.simple.join(' ; ')}.` : ''}` };
      } },
    { id: 'machines', label: 'Machines', what: 'En cours de déploiement, autorisées, et déjà passées', read: true, words: ['machines en cours de déploiement', 'machines déployées'], run: (ctx) => {
      const m = Object.values(live(ctx)).sort((a, b) => b.updated - a.updated), now = ctx.now().getTime();
      return { text: m.length ? m.map((x) => `- ${STEP_ICON[x.step]} ${x.host ?? x.mac} (${x.mac}${x.ip ? `, ${x.ip}` : ''}) : ${x.step}${x.isoName ? ` · ${x.isoName}` : ''} · ${ago(now - x.updated)}`).join('\n') : 'Aucune machine n\'a encore démarré par le réseau.', data: m };
    } },
    { id: 'decider', proprietaireSeul: true, label: 'Décider (Installer pour moi)', what: 'Répond à une machine qui demande « Installer pour moi » depuis l\'écran : oui (son disque est effacé), sans effacer (installation où tu choisis le disque), ou non', params: [{ key: 'id', label: 'Demande', kind: 'text', required: true }, { key: 'accord', label: 'Réponse', kind: 'select', options: ['oui', 'sans_effacer', 'non'], default: 'non' }], quick: false,
      grave: (i, ctx) => { if (s(i.accord) !== 'oui') return undefined; const d = ctx ? demandes(ctx).find((x) => x.id === s(i.id)) : undefined; return `installer automatiquement ${d?.isoName ?? 'le système'} sur la machine ${d?.host ?? ''} ${d?.mac ?? ''} : son disque sera EFFACÉ`.replace(/\s+/g, ' '); },
      words: ['accepte l\'installation', 'refuse l\'installation', 'demande d\'installation'], run: async (ctx, i) => {
        const l = demandes(ctx), d = l.find((x) => x.id === s(i.id)); if (!d) throw new Error('demande introuvable');
        if (d.statut !== 'attente') return { text: `Déjà décidé : ${d.statut === 'acceptee' ? 'acceptée' : d.statut === 'sans_effacer' ? 'installation sans effacer' : 'refusée'}.`, ok: false };
        const a = s(i.accord), now = ctx.now().getTime();
        if (a === 'oui') { const p = await accept(ctx, d); d.statut = 'acceptee'; d.decide = now; saveDemandes(ctx, l); track(ctx, d.mac, undefined, 'menu', { detail: `accord donné : ${d.isoName} s'installe (profil ${p})` }); return { text: `🛠 Accepté : ${d.host ?? d.mac} installe ${d.isoName} tout seul (profil ${p}), une fois. La machine démarre dans quelques secondes.` }; }
        if (a === 'sans_effacer') { const all = choices(ctx); all[d.mac] = { iso: d.iso, mode: 'installer', at: now }; saveJson(ctx, 'ecran-choix.json', all); d.statut = 'sans_effacer'; d.decide = now; saveDemandes(ctx, l); return { text: `✔ ${d.host ?? d.mac} lance l'installation normale de ${d.isoName} : c'est toi qui choisis le disque, rien ne s'efface tout seul.` }; }
        d.statut = 'refusee'; d.decide = now; saveDemandes(ctx, l); track(ctx, d.mac, undefined, 'menu', { detail: 'demande refusée' });
        return { text: `✋ Refusé : rien n'est touché sur ${d.host ?? d.mac}.` };
      } },
    { id: 'ecran', proprietaireSeul: true, label: 'Écran de démarrage', what: 'L\'écran d\'Odin où l\'on choisit le système (sur un téléphone ou un PC du réseau) : disposition, thème, par défaut ou non, délai sans choix', params: [{ key: 'actif', label: 'Proposer l\'écran dans le menu', kind: 'boolean', default: true }, { key: 'parDefaut', label: 'L\'écran par défaut (au lieu du disque)', kind: 'boolean', default: false }, { key: 'surPc', label: 'L\'écran graphique sur le PC lui-même (petit système Alpine, 2 Go de mémoire)', kind: 'boolean', default: true }, { key: 'disposition', label: 'Disposition', kind: 'select', options: [...DISPOSITIONS], default: 'eventail' }, { key: 'theme', label: 'Thème de l\'écran graphique', kind: 'select', options: Object.keys(THEMES), default: 'bleu', help: Object.entries(THEMES).map(([k, v]) => `${k} : ${v}`).join(' · ') }, { key: 'texte', label: 'Thème de l\'écran texte (iPXE)', kind: 'select', options: TEXT_THEME_IDS, default: 'matrix', help: `${Object.entries(TEXT_THEMES).map(([k, v]) => `${k} : ${v.label}`).join(' · ')} · classique : les couleurs d'iPXE` }, { key: 'delai', label: 'Sans choix, le disque après (secondes, le délai du menu)', kind: 'number', default: 10 },
      { key: 'fond_texte', label: 'Ton image de fond, écran texte (iPXE)', kind: 'image', image: { w: 1024, h: 768, type: 'png', voile: 0.5 }, help: 'Réduite à 1024 × 768 et assombrie pour que le menu se lise. Sans image : le fond du thème.' },
      { key: 'fond_graphique', label: 'Ton image de fond, écran graphique', kind: 'image', image: { w: 1920, h: 1080, type: 'jpeg', voile: 0.3 }, help: 'Elle remplit l\'écran, avec un voile aux couleurs du thème. Sans image : le décor du thème.' },
      { key: 'sans_fond_texte', label: 'Remettre le fond du thème (écran texte)', kind: 'boolean', default: false }, { key: 'sans_fond_graphique', label: 'Remettre le décor du thème (écran graphique)', kind: 'boolean', default: false }], quick: false, words: ['écran de démarrage', 'écran pxe', 'thème de l\'écran'], run: (ctx, i) => {
      const c = ecranCfg(ctx), b = (x: unknown, d: boolean) => (x === undefined || x === '' ? d : x === true || x === 'true');
      const n: EcranCfg = { actif: b(i.actif, c.actif), parDefaut: b(i.parDefaut, c.parDefaut), disposition: (DISPOSITIONS as readonly string[]).includes(s(i.disposition)) ? s(i.disposition) as Disposition : c.disposition, theme: s(i.theme) in THEMES ? themeOf(i.theme) : c.theme, texte: i.texte === undefined || i.texte === '' ? c.texte : textThemeOf(i.texte), surPc: b(i.surPc, c.surPc !== false), attente: Math.max(1, Math.min(60, Number(i.attente ?? c.attente) || 5)) };
      const f = [setFond(ctx, 'texte', i.fond_texte, i.sans_fond_texte), setFond(ctx, 'graphique', i.fond_graphique, i.sans_fond_graphique)].filter(Boolean);
      // Le délai sans choix est celui du menu (un seul réglage, 0 à 300 s) ; « attente » (minutes) n'est plus lu.
      const d = i.delai === undefined || i.delai === '' ? delaiMenu(ctx) : Math.max(0, Math.min(300, Math.round(Number(i.delai)) || 0));
      ctx.saveSettings({ ecran: n, delai: d });
      return { text: `Écran : ${n.actif ? `proposé${n.parDefaut ? ' et par défaut' : ''}` : 'retiré du menu'} · ${n.disposition} · graphique ${THEMES[n.theme]} · texte ${n.texte === 'classique' ? 'classique' : TEXT_THEMES[n.texte].label} · sans choix, le disque après ${d} s${f.length ? ` · ${f.join(' · ')}` : ''}${http ? ` · ${base(ctx)}/ecran` : ''}.` };
    } },
    { id: 'tableau', label: 'Tableau (Odin te prévient)', what: 'Demandes à décider, machines en direct, fil des événements, chiffres, réglages de l\'écran', read: true, run: async (ctx) => {
      const now = ctx.now().getTime(), m = Object.values(live(ctx)), h = history(ctx, 300), l = await isos(ctx);
      for (const i of l) isoNames.set(i.id, i.name);
      const fil = m.flatMap((x) => x.steps.map((st) => ({ at: st.at, mac: x.mac, nom: x.host ?? x.mac, etape: st.step, detail: st.detail ?? '' }))).sort((a, b) => b.at - a.at).slice(0, 40);
      const today = h.filter((d) => now - d.at < 864e5);
      return { text: `${demandes(ctx).filter((d) => d.statut === 'attente').length} demande(s) à décider · ${m.filter((x) => !FINAL.includes(x.step)).length} en cours`, data: {
        allume: Boolean(http), url: http ? `${base(ctx)}/ecran` : '', ecran: ecranCfg(ctx), delai: delaiMenu(ctx), themes: THEMES, dispositions: DISPOSITIONS, textes: { ...Object.fromEntries(Object.entries(TEXT_THEMES).map(([k, t]) => [k, t.label])), classique: 'Classique (sans décor)' }, fonds: { texte: fondPerso(ctx, 'texte'), graphique: fondPerso(ctx, 'graphique') },
        demandes: demandes(ctx).filter((d) => d.statut === 'attente' || now - (d.decide ?? d.at) < 864e5).reverse(),
        enCours: m.filter((x) => !FINAL.includes(x.step)).sort((a, b) => b.updated - a.updated),
        fil, chiffres: { enCours: m.filter((x) => !FINAL.includes(x.step)).length, aujourdhui: today.filter((d) => d.result === 'fini').length, echecs: today.filter((d) => S.rate(d.result)).length, total: h.filter((d) => d.result === 'fini').length, isos: l.filter((i) => i.recipe).length },
        systemes: systems(l, stats(ctx)),
      } };
    } },
    { id: 'historique', label: 'Historique', what: 'Les machines déployées : nom pris sur le réseau, ISO, durée, résultat', read: true, words: ['historique des déploiements'], run: (ctx) => { const h = history(ctx, 50); return { text: h.length ? h.map((d) => `- ${new Date(d.at).toLocaleString('fr-FR')} · ${d.host ?? d.mac} (${d.ip ?? '?'}) · ${d.isoName} · ${d.result} en ${ago(d.ms)}`).join('\n') : 'Aucun déploiement pour l\'instant.', data: h }; } },
  ];
  // Suivi, fiche d'un poste, bloquer / débloquer, annuler, suspendre / reprendre, mot de passe d'installation, rapport.
  // Ce qui change quelque chose n'est jamais fait par un membre de la famille (ni lancé, ni demandé au propriétaire).
  // Ce qui renforce la protection (bloquer, suspendre, premier mot de passe) reste possible pour une automatisation, et ce
  // qui l'affaiblit demande toujours ton accord (action grave) ; le délai d'abandon est au propriétaire seul. Les lectures
  // (suivi, fiche, rapport) restent ouvertes.
  actions.push(...S.actions.map((a) => (a.read || a.proprietaireSeul !== undefined ? a : { ...a, proprietaireSeul: a.id === 'delai_abandon' ? true : () => Boolean(agissant()) })));
  // Clé USB bootable (nouveau mode de Genèse, façon Rufus / Ventoy) : disques, plan de double démarrage, préparation.
  // Lot C4 : l'écriture retrouve chaque ISO dans la bibliothèque (images PRÊTES seulement), revérifie tes scripts par
  // l'antivirus, prend la clé d'activation du coffre (jamais rendue à la page) et le profil d'installation.
  actions.push(...cleUsb({
    bibliotheque: async (ctx) => (await isos(ctx)).filter(prete).map((i) => ({ id: i.id, nom: i.name, chemin: i.path, ...(i.recipe ? { recipe: i.recipe } : {}) })),
    antivirus: antivirusScript,
    cleActivation: (ctx, fichier, nom) => clePourImage(ctx.home, ctx.dir, fichier, nom),
    profil: (ctx) => profiles(ctx)[0],
  }).actions);
  // Clé USB, étape « Logiciels et scripts » : le script créé tout seul, montré en direct (lecture seule, rien n'est écrit).
  actions.push(apercuScriptCle(profiles));
  // Systèmes (maquette « Genèse · Systèmes », lot S1) : la bibliothèque d'Hydre et les téléchargements d'Andromède
  // réunis, carte par carte ; lecture seule, propriétaire seul comme la clé.
  actions.push(systemesAction(async (ctx) => (await isos(ctx)).map((i) => ({ id: i.id, chemin: i.path, demarre: Boolean(i.recipe) && !i.err, prete: prete(i), ...(i.recipe?.auto && !i.err ? { auto: true } : {}) }))));
  // Déployer, étapes 1 à 3 (maquette « Genèse · Systèmes », lot S5) : les PC vus au menu de démarrage réseau, d'après ce
  // que le serveur de démarrage sait déjà (fiches vivantes, historique, PC autorisés, PC bloqués) ; lecture seule,
  // propriétaire seul. Rien n'est lancé : le serveur n'est ni allumé ni réglé par cette lecture.
  // La page Réseau (lot S8) : le serveur de démarrage, ses cartes, qui donne les adresses, le garde-fou, les PC autorisés et
  // ceux qui démarrent en direct. Lecture seule ; propriétaire seul (adresses MAC, adresses du réseau).
  actions.push({
    id: 'reseau', label: 'Réseau : serveur de démarrage', read: true, quick: false, proprietaireSeul: true,
    what: 'Allumé ou non, la carte réseau, qui donne les adresses (à côté de la box, réseau à part, Sphinx, ta box), le garde-fou, les PC autorisés et ceux qui démarrent en direct',
    run: (ctx) => {
      let cartes: CarteReseau[] = []; try { cartes = RESEAU.cartes(); } catch { /* aucune carte lisible */ }
      const mode = modeAdresses(s(ctx.settings.mode) || 'proxy'), filtre = s(ctx.settings.filtre) === 'liste' ? 'liste' : 'tous', plateforme = RESEAU.plateforme();
      const regles = rules(ctx), now = ctx.now().getTime(), choisie = carteChoisie(ctx), g = gardeDe(ctx);
      const nomDe = (mac: string) => regles.find((r) => r.mac === mac)?.nom;
      const direct = Object.values(live(ctx)).flatMap((m) => (m.steps ?? []).map((st) => ({ at: st.at, mac: m.mac, nom: nomDe(m.mac) ?? m.host ?? '', connu: regles.some((r) => r.mac === m.mac), etape: st.step, detail: st.detail ?? '', fw: m.fw ?? '', ...(m.ip ? { ip: m.ip } : {}) })))
        .filter((e) => typeof e.at === 'number' && now - e.at < 6 * 3600_000).sort((a, b) => b.at - a.at).slice(0, 30);
      const ip = serverIp(ctx);
      return {
        text: `Genèse ${http ? 'allumé' : 'éteint'} · ${mode === 'proxy' ? 'à côté de la box' : mode === 'complet' ? `Odin distribue les adresses sur ${choisie?.nom ?? '?'}${aPart ? '' : ' (arrêté)'}` : mode === 'odin' ? 'adresses par Sphinx' : 'réglé dans ta box'} · ${regles.length} PC autorisé(s) · ${direct.length} événement(s) récent(s)`,
        data: {
          allume: Boolean(http), mode, filtre, ip, carte: choisie?.nom ?? '', distribue: Boolean(aPart),
          cartes: cartes.map((c) => { const non = refusCarte(c, plateforme); return { ...c, complet: !non, ...(non ? { refus: non } : {}), plage: plageParDefaut(c) }; }),
          plage: plageDe(ctx) ?? null, garde: g,
          autorises: regles.map((r) => ({ mac: r.mac, nom: r.nom ?? '', iso: r.iso ? isoName(r.iso) : '', auto: Boolean(r.auto), fait: Boolean(r.fait) })),
          direct, lignes: lignesBox(ip, http?.port ?? ports(ctx).http),
        },
      };
    },
  });
  // Le menu PXE (maquette « Genèse · Systèmes », lot S9) : ce que voit un PC qui démarre par le réseau. Lecture (avec un
  // aperçu relu dans le VRAI script écrit pour un PC inconnu) et réglage (ordre, cacher, défaut, délai, disposition) ;
  // propriétaire seul. Le défaut n'est jamais une entrée qui installe ou peut effacer.
  /** Une liste d'identifiants envoyée par la page (« ["a","b"] ») ou tapée (« a, b »). */
  const listeIds = (x: unknown): string[] => { const t = s(x).trim(); if (t.startsWith('[')) { try { return idsPropres(JSON.parse(t)); } catch { return []; } } return idsPropres(t); };
  /**
   * La vue de la page. `b` (facultatif) : un brouillon pas encore enregistré (ordre, cachés, défaut, délai) ; l'aperçu
   * est alors celui de ce brouillon, écrit par le même code que le vrai menu. Rien n'est enregistré ici.
   */
  async function menuPxeVue(ctx: ModCtx, b: Record<string, unknown> = {}) {
    const list = (await isos(ctx)).filter((i) => i.recipe && prete(i)), ec = ecranCfg(ctx), fam = (i: IsoInfo) => category(i.recipe, i.name), connus = new Set(list.map((i) => i.id));
    const garde = menuPxe(ctx), cfg: MenuPxeCfg = { ordre: s(b.ordre).trim() ? listeIds(b.ordre).filter((id) => connus.has(id)) : garde.ordre, caches: s(b.caches).trim() ? listeIds(b.caches) : garde.caches };
    for (const i of list) isoNames.set(i.id, i.name);
    const ranges = ordonner(list, cfg, fam), sys = systems(ranges, stats(ctx)), voit = visibles(ranges, cfg);
    const vb = s(b.defaut).trim().toLowerCase(), ecranDef = vb ? vb === 'ecran' && ec.actif : ec.parDefaut;
    const voulu = vb && vb !== 'ecran' ? vb : s(ctx.settings.defaut) || 'local', sur = defautSur(vb === 'ecran' ? 'local' : voulu, voit);
    const defaut = ec.actif && ecranDef && sur.def === 'local' ? 'ecran' : sur.def === 'local' || sur.def === 'ecran' ? 'disque' : sur.def;
    const delai = b.delai === undefined || b.delai === '' ? delaiMenu(ctx) : Math.max(0, Math.min(300, Math.round(Number(b.delai)) || 0));
    // L'aperçu : le menu écrit pour un PC inconnu, avec les mêmes règles que le vrai (menuFor), sans rien noter.
    const def = defaut === 'disque' ? 'local' : defaut, k = kiosk(ctx);
    const apercu = lireMenu(menu({ ...menuCommun(ctx, list, [], cfg), mac: '', def, timeout: delai, ecran: ec.actif, ...(k ? { kiosk: ['ecran'] } : {}) }));
    apercu.titre = apercu.titre.replace(/\s*\(\)\s*$/, '');
    const t = ec.texte === 'classique' ? { fg: '#c0c0c0', title: '#ffffff', gap: '#00aaaa', selBg: '#0000aa', selFg: '#ffffff' } : TEXT_THEMES[ec.texte];
    return {
      entrees: sys.map((x) => { const i = ranges.find((y) => y.id === x.id)!; return { id: x.id, nom: x.name, titre: x.title, version: x.version, famille: x.category, couleur: x.color, modes: x.modes, installe: installe(i.recipe), cache: cfg.caches.includes(x.id) }; }),
      ordreChoisi: cfg.ordre.length > 0, defaut, ...(sur.refus && voulu !== 'local' ? { defautRefuse: sur.refus } : {}),
      delai, disposition: ec.disposition, dispositions: [...DISPOSITIONS], ecran: ec.actif, apercu,
      couleurs: { fond: '#05080c', texte: t.fg, titre: t.title, trait: t.gap, choix: t.selBg, choixTexte: t.selFg },
    };
  }
  actions.push({
    id: 'menu_pxe', label: 'Menu PXE', read: true, quick: false, proprietaireSeul: true,
    what: 'Ce que voit un PC qui démarre par le réseau : les systèmes dans l\'ordre, ceux qui sont cachés, l\'entrée par défaut, le délai, la disposition, et l\'aperçu du menu',
    run: async (ctx, i) => {
      const d = await menuPxeVue(ctx, i ?? {}), nom = (id: string) => d.entrees.find((e) => e.id === id)?.nom ?? id;
      return { text: `Menu PXE : ${d.entrees.filter((e) => !e.cache).length} système(s) proposé(s)${d.entrees.some((e) => e.cache) ? `, ${d.entrees.filter((e) => e.cache).length} caché(s)` : ''} · par défaut : ${d.defaut === 'disque' ? 'le disque du PC' : d.defaut === 'ecran' ? 'l\'écran d\'Odin' : nom(d.defaut)} · ${d.delai ? `après ${d.delai} s` : 'sans délai (le PC attend)'}`, data: d };
    },
  });
  actions.push({
    id: 'menu_pxe_regler', label: 'Régler le menu PXE', quick: false, proprietaireSeul: true,
    what: 'L\'ordre des systèmes, ceux qui sont cachés, l\'entrée par défaut (le disque du PC conseillé ; jamais une entrée qui installe), le délai et la disposition du menu graphique',
    params: [{ key: 'ordre', label: 'Ordre (identifiants, du premier au dernier)', kind: 'text' }, { key: 'caches', label: 'Systèmes cachés (identifiants)', kind: 'text' },
      { key: 'defaut', label: 'Par défaut : « disque », « ecran » ou un système qui n\'installe rien', kind: 'text' }, { key: 'delai', label: 'Sans choix, démarrer le défaut après (secondes, 0 : attendre)', kind: 'number' },
      { key: 'disposition', label: 'Disposition du menu graphique', kind: 'select', options: [...DISPOSITIONS] }],
    words: ['menu pxe', 'ordre du menu de démarrage', 'cacher un système du menu'],
    run: async (ctx, i) => {
      const list = (await isos(ctx)).filter((x) => x.recipe && prete(x)), connus = new Set(list.map((x) => x.id)), cfg = menuPxe(ctx), ec = ecranCfg(ctx);
      const n: MenuPxeCfg = { ordre: cfg.ordre, caches: cfg.caches };
      if (s(i.ordre).trim()) n.ordre = listeIds(i.ordre).filter((id) => connus.has(id));
      // Un système caché absent pour l'instant (ISO déplacée, en vérification) le reste quand il revient.
      if (s(i.caches).trim()) n.caches = idsPropres([...listeIds(i.caches).filter((id) => connus.has(id)), ...cfg.caches.filter((id) => !connus.has(id))]);
      let defaut = s(ctx.settings.defaut) || 'local', parDefaut = ec.parDefaut, note = '';
      const voulu = s(i.defaut).trim().toLowerCase();
      if (voulu) {
        if (['disque', 'local'].includes(voulu)) { defaut = 'local'; parDefaut = false; }
        else if (voulu === 'ecran') { if (!ec.actif) return { ok: false, text: 'Refusé : l\'écran d\'Odin n\'est pas proposé au menu (Écran de démarrage). Rien n\'a changé.' }; defaut = 'local'; parDefaut = true; }
        else {
          const x = list.find((y) => y.id === voulu);
          if (!x) return { ok: false, text: 'Refusé : ce système n\'est pas dans la bibliothèque (prêt à démarrer). Rien n\'a changé.' };
          if (n.caches.includes(x.id)) return { ok: false, text: `Refusé : ${x.name} est caché du menu ; montre-le d'abord. Rien n'a changé.` };
          const sur = defautSur(x.id, list); if (sur.refus) return { ok: false, text: `Refusé : ${sur.refus}. Par défaut : le disque du PC (conseillé), l'écran d'Odin ou un système à essayer. Pour installer sur un PC précis : « Déployer ». Rien n'a changé.` };
          defaut = x.id; parDefaut = false;
        }
      }
      // Le défaut caché par ce réglage : le disque du PC reprend sa place.
      if (defaut !== 'local' && n.caches.includes(defaut)) { note = ` ${isoName(defaut)} est caché : par défaut, le disque du PC.`; defaut = 'local'; }
      const delai = i.delai === undefined || i.delai === '' ? delaiMenu(ctx) : Math.max(0, Math.min(300, Math.round(Number(i.delai)) || 0));
      const disposition = (DISPOSITIONS as readonly string[]).includes(s(i.disposition)) ? s(i.disposition) as Disposition : ec.disposition;
      ctx.saveSettings({ menuPxe: n, defaut, delai, ecran: { ...ec, parDefaut, disposition } });
      const d = await menuPxeVue(ctx);
      return { text: `✔ Menu PXE enregistré : ${d.entrees.filter((e) => !e.cache).length} système(s) proposé(s) · par défaut : ${d.defaut === 'disque' ? 'le disque du PC' : d.defaut === 'ecran' ? 'l\'écran d\'Odin' : isoName(d.defaut)} · ${delai ? `après ${delai} s` : 'le PC attend un choix'} · ${disposition}.${note}`, data: d };
    },
  });
  actions.push(postesVusAction((ctx) => ({ live: live(ctx), historique: history(ctx, 300), regles: rules(ctx), bloques: (ctx.settings.bloques as SourcePostes['bloques'] | undefined) ?? {}, allume: Boolean(http), mode: modeAdresses(s(ctx.settings.mode) || 'proxy') })));
  // Logiciels et profils (maquette « Genèse · Systèmes », lot S4) : les profils de logiciels communs à la clé, au réseau et
  // aux machines virtuelles, gardés par Odin ; lecture et écriture réservées au propriétaire.
  actions.push(...profilsLogicielsActions(antivirusScript));
  // Déployer, étapes 4 à 6 (maquette « Genèse · Systèmes », lot S6) : l'aperçu de ce qui s'installe à la fin (lecture), et
  // « deployer » : autoriser en lot les PC choisis, UNE fois chacun, pour ce système et ces réglages, un temps limité.
  actions.push(deployerApercuAction(async (ctx) => (await isos(ctx)).filter(prete)));
  // « Recommencer » (lot S7) passe par ce même chemin, avec le nom que le PC avait (nomGarde) : mêmes vérifications.
  const actionDeployer = {
    id: 'deployer', label: 'Déployer sur des PC du réseau', quick: false, proprietaireSeul: true,
    what: 'Autorise en lot les PC choisis (ou le prochain PC qui démarre) : chacun une seule fois, pour ce système et ces réglages, pendant un temps limité ; « effacer et installer » demande la phrase « effacer N pc », et au démarrage Odin revérifie que c\'est bien ce PC (adresse, numéro de série, taille du disque)',
    params: [{ key: 'pcs', label: 'Adresses MAC des PC', kind: 'textarea' }, { key: 'prochain', label: 'Aussi le prochain PC qui démarre (30 min)', kind: 'boolean', default: false }, { key: 'iso', label: 'Système (identifiant de l\'image)', kind: 'text' }, { key: 'facon', label: 'Façon (auto : effacer et installer ; menu : le proposer sans effacer)', kind: 'select', options: ['auto', 'menu'], default: 'auto' }, { key: 'profil', label: 'Profil de logiciels', kind: 'text', default: '' }, { key: 'windows', label: 'Options Windows', kind: 'textarea' }, { key: 'noms', label: 'Nom de chaque PC (auto : pc-01… ; vu : le nom vu au menu)', kind: 'select', options: ['auto', 'vu'], default: 'auto' }, { key: 'phrase', label: 'La phrase à taper', kind: 'text' }, { key: 'identite', label: 'La bonne identité de chaque PC, quand Odin la demande (adresse MAC → identité choisie)', kind: 'textarea' }],
    grave: (i) => {
      const d = demandeDeploiement(i);
      if ('refus' in d) return `déployer un système par le réseau (demande illisible : ${d.refus})`;
      const qui = [...d.pcs, ...(d.prochain ? ['le prochain PC qui démarre'] : [])].join(', ');
      return d.facon === 'auto' ? `EFFACER le disque de ${d.n} PC (${qui}) et y installer ${s(i.iso).slice(0, 80)} par le réseau, une fois chacun` : `proposer ${s(i.iso).slice(0, 80)} au menu de ${d.n} PC (${qui}), sans rien effacer`;
    },
    run: async (ctx: ModCtx, i: Record<string, unknown>, nomGarde?: string): Promise<ActionResult> => {
      const d = demandeDeploiement(i);
      if ('refus' in d) return { ok: false, text: `${d.refus} Rien n'est autorisé.` };
      const target = (await isos(ctx)).filter(prete).find((x) => x.id === s(i.iso));
      if (!target?.recipe) return { ok: false, text: 'Ce système n\'est pas prêt dans la bibliothèque (ou Odin ne sait pas le démarrer). Rien n\'est autorisé.' };
      const windows = target.recipe.kind === 'windows';
      if (d.facon === 'auto' && !target.recipe.auto) return { ok: false, text: `${target.name} ne s'installe pas tout seul : choisis « le proposer au menu ». Rien n'est autorisé.` };
      if (windows && d.facon === 'menu') return { ok: false, text: 'Windows par le réseau s\'installe seulement en « effacer et installer tout seul ». Rien n\'est autorisé.' };
      if (windows && !(ctx.settings.partage as { unc?: string } | undefined)?.unc) return { ok: false, text: 'Windows : règle d\'abord le partage réseau (« partage Windows »). Rien n\'est autorisé.' };
      // La phrase EXACTE, vérifiée ICI (la page ne fait que la demander, avec l'appui long).
      const attendue = phraseDeploiement(d.n);
      if (d.facon === 'auto' && phraseNormale(i.phrase) !== phraseNormale(attendue)) return { ok: false, text: `Phrase incorrecte : il faut taper exactement « ${attendue} ». Rien n'est autorisé, rien n'est effacé.`, data: { phrase: attendue } };
      const bloques = (ctx.settings.bloques as Record<string, unknown> | undefined) ?? {};
      const b = d.pcs.filter((m) => bloques[m]);
      if (b.length) return { ok: false, text: `Bloqué dans Genèse : ${b.join(', ')}. Débloque-le d'abord. Rien n'est autorisé.` };
      // Effacer : l'identité gardée pour chaque PC doit être sûre. Deux appareils différents vus avec la même adresse MAC
      // ces dernières 24 h (une adresse se recopie, et ce que le PC dit de lui aussi) : refusé, jamais « le dernier venu ».
      if (d.facon === 'auto') {
        const vues = identitesVues(ctx), t0 = ctx.now().getTime();
        for (const mac of d.pcs) {
          const c = identitesEnConflit(vues[mac], t0);
          if (c.length) return { ok: false, text: `Deux appareils différents ont démarré avec l'adresse ${mac} ces dernières 24 h (${c.join(' ; ')}) : l'un recopie peut-être l'adresse de l'autre. Vérifie ce PC (numéro de série sur son étiquette) ; après 24 h sans les deux, « Déployer » te demandera lequel est le bon. Rien n'est autorisé, rien n'est effacé.` };
        }
      }
      // Le profil de logiciels : relu ici (jamais celui que la page décrit).
      const prof = s(i.profil) ? lireProfils(ctx).liste.find((x) => x.id === s(i.profil)) : undefined;
      if (s(i.profil) && !prof) return { ok: false, text: 'Profil de logiciels introuvable (relis la liste). Rien n\'est autorisé.' };
      const w = windows ? optionsDeploiement(i.windows) : undefined;
      if (w && 'refus' in w) return { ok: false, text: `${w.refus} Rien n'est autorisé.` };
      // L'identité de chaque PC, telle qu'Odin l'a VUE (fiche vivante, sinon la dernière installation) : jamais la page.
      const vivants = live(ctx), hist = history(ctx, 300), now = ctx.now().getTime(), l = autorisations(ctx);
      const ident = (mac: string) => { const m = vivants[mac], h = hist.find((x) => x.mac === mac); const serie = m?.serie ?? h?.serie, uuid = m?.uuid ?? h?.uuid; return { ...(serie ? { serie } : {}), ...(uuid ? { uuid } : {}), ...(m?.disque ? { disque: m.disque } : {}) }; };
      // Un PC refusé au dernier essai (ce n'était pas lui), ou dont une autre identité était connue AVANT celle vue
      // maintenant (même il y a plus de 24 h) : jamais autorisé sur la seule identité du dernier appareil vu. Le
      // propriétaire choisit laquelle est la bonne (la page ne donne que son nom, relu ici) ; seule elle est autorisée.
      const choisies: Record<string, IdentiteConnue> = {};
      if (d.facon === 'auto') {
        const voulu = choixIdentites(i.identite);
        if (!voulu) return { ok: false, text: 'Le choix des identités est illisible. Rien n\'est autorisé, rien n\'est effacé.' };
        const vues = identitesVues(ctx), aChoisir: Array<{ mac: string; refusee: boolean; options: IdentiteConnue[] }> = [];
        for (const mac of d.pcs) {
          const derniere = l.filter((a) => a && a.mac && normMac(a.mac) === mac).sort((a, b) => b.cree - a.cree)[0];
          // Refusé au dernier essai : seul l'appareil que tu avais autorisé, revu tel quel, se passe du choix.
          const ici = ident(mac), refus = derniere?.annulee?.vu && identiteDifferente({ mac, serie: derniere.serie, uuid: derniere.uuid, disque: derniere.disque }, mac, ici) ? derniere : undefined;
          const connues = identitesConnues([
            ...(Array.isArray(vues[mac]) ? vues[mac] : []),
            ...hist.filter((h) => h.mac === mac).map((h) => ({ serie: h.serie, uuid: h.uuid, at: h.at })),
            ...(refus ? [{ serie: refus.serie, uuid: refus.uuid, disque: refus.disque, at: refus.cree }, { ...refus.annulee!.vu, at: refus.annulee!.at, refusee: true }] : []),
            ...(ici.serie || ici.uuid ? [{ ...ici, at: Number(vivants[mac]?.updated ?? hist.find((h) => h.mac === mac)?.at ?? now), maintenant: true }] : []),
          ]);
          if (!choixIdentiteExige(connues, Boolean(refus))) continue;
          const c = voulu[mac] ? connues.find((x) => x.cle === voulu[mac]) : undefined;
          if (c) choisies[mac] = c; else aChoisir.push({ mac, refusee: Boolean(refus), options: connues });
        }
        if (aChoisir.length) return { ok: false, text: `Avant d\'effacer ${aChoisir.map((x) => x.mac).join(', ')} : ${aChoisir.some((x) => x.refusee) ? 'le dernier essai a été refusé (ce n\'était pas le PC autorisé)' : 'un autre appareil était connu avec cette adresse avant celui vu maintenant'}. Odin ne prend pas « le dernier venu » : dis lequel est le bon (numéro de série sur son étiquette) ; seul celui-là sera autorisé, l\'autre restera refusé. Rien n\'est autorisé, rien n\'est effacé.`, data: { identites: aChoisir } };
      }
      const vusNoms = postesVus({ live: vivants, historique: hist, regles: rules(ctx), bloques: {}, now });
      const pris = l.filter((a) => autorisationValable(a, now) && !(a.mac ? d.pcs.includes(a.mac) : d.prochain)).map((a) => a.nom);
      const cibles = [...d.pcs.map((mac) => ({ mac, vu: nomGarde ?? vusNoms.find((p) => p.mac === mac)?.nom })), ...(d.prochain ? [{ mac: '', vu: '' }] : [])];
      const noms = nomsDesPcs(cibles, nomGarde || s(i.noms) === 'vu' ? 'vu' : 'auto', pris);
      const lot = randomBytes(6).toString('hex'), out: AutorisationPc[] = [];
      for (const [k, c] of cibles.entries()) {
        const a: AutorisationPc = { id: randomBytes(9).toString('hex'), lot, mac: c.mac, iso: target.id, isoNom: target.name, facon: d.facon, nom: noms[k], ...(prof ? { profil: prof.id } : {}), ...(w ? { windows: w } : {}), ...(c.mac ? (choisies[c.mac] ? identiteDe(choisies[c.mac]) : ident(c.mac)) : {}), cree: now, expire: now + (c.mac ? DUREE_PC : DUREE_PROCHAIN) };
        if (d.facon === 'auto') {
          // UN mot de passe par PC : chiffré ici (jamais en clair sur le disque), rangé dans le coffre ; jamais renvoyé.
          const pw = motDePassePc();
          try { a.mdp = chiffrerChamp(ctx.home, pw); } catch (e) { return { ok: false, text: `Le coffre d'Odin n'est pas prêt (${(e as Error).message}) : aucun mot de passe ne peut être rangé. Rien n'est autorisé.` }; }
          const quand = new Date(now).toISOString().slice(0, 16).replace('T', ' ');
          const rc = await ctx.call('brisingamen', 'ajouter', { nom: `Déploiement · ${a.nom}${c.mac ? ` (${c.mac})` : ' (prochain PC)'} · ${quand}`, identifiant: windows ? (s(w && !('refus' in w) ? w.compte : '') || 'odin') : (profiles(ctx)[0].utilisateur || 'odin'), mot_de_passe: pw, site: `Genèse : ${target.name} par le réseau`, coffre: 'TOUFATECH' }, `ranger le mot de passe du PC ${a.nom}`).catch((e: Error) => ({ ok: false, text: e.message }));
          // Sans le coffre, personne ne connaîtrait le mot de passe du PC : rien n'est autorisé.
          if (!rc || rc.ok === false) return { ok: false, text: `Le coffre n'a pas pu ranger le mot de passe de ${a.nom} (${rc?.text ?? 'coffre absent'}). Rien n'est autorisé.` };
        }
        out.push(a);
      }
      // RELU juste avant d'écrire (rien ne s'intercale d'ici à l'écriture) : pendant l'attente du coffre, un PC a pu utiliser
      // son autorisation, ou un autre onglet en créer une ; la liste lue plus haut ne réécrit jamais par-dessus (aucun rejeu).
      // Les autorisations encore valables pour ces PC (ou un « prochain » d'avant) sont remplacées, jamais cumulées.
      const frais = autorisations(ctx), alors = ctx.now().getTime();
      for (const a of frais) if (autorisationValable(a, alors) && (a.mac ? d.pcs.includes(a.mac) : d.prochain)) a.annulee = { at: alors, raison: 'remplacée par un nouveau déploiement' };
      saveAutorisations(ctx, [...frais, ...out]);
      // L'identité choisie devient la seule connue pour ce PC : un autre appareil revu avec son adresse redemandera le choix.
      if (Object.keys(choisies).length) {
        try {
          const all = identitesVues(ctx);
          for (const [mac, c] of Object.entries(choisies)) {
            const gardees = (Array.isArray(all[mac]) ? all[mac] : []).filter((x) => x && cleIdentite({ serie: x.serie, uuid: x.uuid }) === cleIdentite({ serie: c.serie, uuid: c.uuid }) && (!x.disque || !c.disque || x.disque === c.disque));
            all[mac] = gardees.length ? gardees : [{ ...identiteDe(c), at: c.derniere, premiere: c.premiere }];
          }
          ecrireIdentites(ctx, all, alors);
        } catch { /* disque plein : l'autorisation ne vaut que pour l'identité choisie ; le choix sera redemandé */ }
      }
      // Une ancienne installation automatique (« autoriser ») encore prévue pour ces PC est close : jamais deux effacements.
      const regles = rules(ctx); let vieilles = false;
      for (const r0 of regles) if (d.pcs.includes(r0.mac) && r0.auto && !r0.fait) { r0.fait = true; vieilles = true; }
      if (vieilles) ctx.saveSettings({ machines: regles });
      const liste = out.map((a) => `${a.nom}${a.mac ? ` (${a.mac})` : ' (le prochain PC qui démarre)'}`).join(', ');
      return {
        ok: true,
        text: d.facon === 'auto' ? `🛠 ${out.length} PC autorisé(s) pour ${target.name} : ${liste}. Chacun s'installe UNE fois, à son prochain démarrage par le réseau, s'il est bien celui-là (adresse, numéro de série, taille du disque). Un mot de passe par PC est rangé dans le coffre.` : `✔ ${target.name} proposé au menu de ${out.length} PC : ${liste}. Rien n'est effacé.`,
        data: { lot, facon: d.facon, iso: target.id, pcs: out.map((a) => ({ mac: a.mac, nom: a.nom, expire: a.expire, prochain: !a.mac })) },
      };
    },
  } satisfies Action;
  actions.push(actionDeployer);

  const mod: Module = {
    id: 'thjalfi', name: 'Genèse', family: 'Machines',
    what: 'Le déploiement par le réseau : les ISO d\'Andromède démarrent sur n\'importe quelle machine sans clé USB, s\'installent toutes seules sur les machines que tu autorises, avec les logiciels de Hermès ; tu suis chaque poste jusqu\'à la fin, tu peux le bloquer, annuler son installation ou exiger un mot de passe, et tout reste dans l\'historique.',
    does: ['démarrage par le réseau (PXE) en BIOS et UEFI, sans rien régler sur la box (proxy DHCP) ou avec le DHCP d\'Odin', 'les ISO d\'Andromède lues directement (ISO 9660, Joliet, Rock Ridge, UDF) sans extraction', 'installation automatique : Ubuntu (autoinstall), Debian (preseed), Fedora / Rocky / Alma (Kickstart), Windows (unattend, partage réseau)', 'profils : compte, langue, clavier, fuseau, paquets Linux, logiciels Windows de Hermès en silencieux', 'outils et systèmes live (Clonezilla, GParted, Arch, Alpine…) démarrés depuis le menu', 'suivi en direct : chaque poste reconnu (adresse MAC, nom, numéro de série, marque et modèle), ses étapes avec l\'heure, son avancement, jusqu\'à « terminée », « échouée » (avec la raison) ou « abandonnée » (plus de signe de vie)', 'bloquer un poste (son écran le dit, puis il démarre sur son disque), suspendre toutes les nouvelles installations, annuler une installation en cours (avec ton accord)', 'mot de passe d\'installation : le poste le tape avant d\'avoir le menu et les fichiers ; seule son empreinte est gardée ; 5 erreurs bloquent le poste 15 minutes', 'historique de toutes les installations dans la base de l\'appli, filtrable, avec un rapport (réussies, échecs, abandons, durée moyenne, par image) et un export pour tableur ; nombre de déploiements par ISO', 'Odin prévient : début d\'une installation, échec, abandon, réussite, poste inconnu, poste bloqué qui retente, mots de passe refusés', 'sécurité : machine inconnue = son propre disque ; installation automatique seulement si tu l\'autorises, une seule fois'],
    from: ['iVentoy', 'netboot.xyz', 'FOG Project'], upstream: ['ventoy/PXE', 'netbootxyz/netboot.xyz', 'FOGProject/fogproject', 'ipxe/ipxe', 'ipxe/wimboot'],
    words: ['déploiement réseau', 'deploiement reseau', 'pxe', 'ipxe', 'iventoy', 'démarrage réseau', 'demarrage par le reseau', 'installer par le réseau', 'installation réseau', 'netboot', 'thjalfi', 'þjálfi', 'déployer une iso', 'clé usb', 'clé bootable', 'rufus', 'ventoy', 'dual boot'],
    actions,
    async view(ctx) {
      C = ctx; const l = await isos(ctx), st = stats(ctx), def = s(ctx.settings.defaut) || 'local', now = ctx.now().getTime();
      const m = Object.values(live(ctx)), running = m.filter((x) => !FINAL.includes(x.step)).sort((a, b) => b.updated - a.updated), h = history(ctx, 100), rs = rules(ctx);
      for (const i of l) isoNames.set(i.id, i.name);
      const ready = LOADERS.filter((x) => existsSync(join(bootDir(ctx), x.file)));
      const kpis: Kpi[] = [
        { label: 'Serveur', value: http ? 'Allumé' : 'Éteint', tone: http ? 'bon' : 'neutre', hint: http ? `${serverIp(ctx)}:${http.port}` : undefined },
        { label: 'ISO démarrables', value: String(l.filter((i) => i.recipe).length), hint: `${l.filter((i) => i.recipe?.auto).length} en installation automatique` },
        { label: 'En cours', value: String(running.length), tone: running.length ? 'attention' : 'neutre' },
        { label: 'Déployées', value: String(h.filter((d) => d.result === 'fini').length), tone: 'bon' },
      ];
      const sections: Section[] = [];
      if (!http || ready.length < 2) sections.push({ kind: 'steps', title: 'Mise en route', items: [
        { title: 'Chargeurs officiels (iPXE)', detail: `${ready.length}/${LOADERS.length} prêts`, done: ready.length >= 2, action: 'preparer', button: 'Préparer' },
        { title: 'Des ISO dans Andromède', detail: `${l.length} trouvée(s)`, done: l.length > 0 },
        { title: 'Allumer Genèse', detail: 'une machine inconnue démarre sur son propre disque par défaut', done: Boolean(http), action: 'allumer', button: 'Allumer' },
        { title: 'Démarrer une machine par le réseau', detail: 'touche F12, F11 ou Échap au démarrage, choisis « réseau » ou « PXE »', done: m.length > 0 },
      ] });
      sections.push({ kind: 'table', title: 'En cours de déploiement', columns: ['Machine', 'Nom', 'Adresse', 'ISO', 'Étape', 'Depuis'], rows: running.map((x) => ({ cells: [x.mac, x.host ?? '—', x.ip ?? '—', x.isoName ?? '—', `${STEP_ICON[x.step]} ${x.step}${x.steps.at(-1)?.detail ? ` · ${x.steps.at(-1)!.detail}` : ''}`, ago(now - x.started)], tone: 'attention' as const, actions: S.boutons(x.mac) })), empty: 'Aucune machine en cours.' });
      sections.push(...S.sections(ctx));
      sections.push({ kind: 'cards', title: 'ISO (Andromède)', items: l.map((i) => ({ title: i.name, sub: i.recipe ? i.recipe.label : `Illisible : ${i.err}`, badge: !prete(i) ? (i.etat === 'ancienne' ? 'ancienne version (old)' : 'scannée · antivirus en attente') : i.id === def ? '★ par défaut' : i.recipe?.auto ? 'auto' : biblio.d ? 'prête' : undefined, tone: i.recipe ? (i.recipe.auto ? 'bon' as const : 'neutre' as const) : 'mauvais' as const, meta: `Déployée ${st[i.id]?.lances ?? 0} fois · ${st[i.id]?.finis ?? 0} réussie(s)${i.recipe?.needs ? ` · il faut ${i.recipe.needs}` : ''}`, actions: i.recipe && prete(i) && i.id !== def ? [{ action: 'iso_par_defaut', label: 'Par défaut', input: { iso: i.id } }] : [] })), empty: 'Aucune ISO : ajoute-en dans Andromède.' });
      // Les clés d'activation Windows : déposées par le propriétaire (une par édition), gardées dans le coffre,
      // injectées à l'installation de l'image de la même édition. La page ne voit jamais la clé en entier.
      const cles = clesPubliques(ctx.dir), winIsos = l.filter((i) => i.recipe?.kind === 'windows');
      sections.push({ kind: 'cards', title: 'Clés d\'activation Windows', items: cles.map((c) => ({ title: c.edition, sub: masque(c.indice), badge: 'dans le coffre', tone: 'bon' as const, meta: `Déposée le ${new Date(c.pose).toLocaleDateString('fr-FR')}`, actions: [{ action: 'retirer_cle_windows', label: 'Retirer', input: { edition: c.edition } }] })), empty: 'Aucune clé déposée : tes images Windows s\'installent sans activation (c\'est permis).' });
      sections.push({ kind: 'form', title: 'Déposer une clé Windows', action: 'cle_windows', submit: 'Déposer la clé', params: [{ key: 'edition', label: 'Édition de Windows', kind: 'select', options: EDITIONS.map((e) => e.label), default: EDITIONS[0].label }, { key: 'cle', label: 'Clé (XXXXX-XXXXX-XXXXX-XXXXX-XXXXX)', kind: 'password', required: true }], aide: 'Ta propre clé, gardée chiffrée dans le coffre (seuls les 5 derniers caractères sont montrés). À l\'installation d\'une image Windows de cette édition, Odin l\'écrit dans le fichier de réponses ; sans clé, l\'emplacement reste vide. Odin ne génère ni ne contourne aucune clé.' });
      if (winIsos.length) sections.push({ kind: 'list', title: 'Édition reconnue pour tes images Windows', items: winIsos.map((i) => { const ed = editionDeImage(i.name, i.recipe!.label), aCle = ed ? cles.some((c) => c.id === ed.id) : false; return { title: i.name, detail: ed ? `Édition reconnue : ${ed.label}${aCle ? ' · clé déposée → injectée à l\'installation' : ' · aucune clé déposée → installation sans activation'}` : 'Édition non reconnue dans le nom → aucune clé injectée (installation sans activation)', tone: ed && aCle ? 'bon' as const : 'neutre' as const }; }), aide: 'Odin fait correspondre l\'édition au nom de l\'image. Nomme l\'image avec son édition (ex. « Windows 11 Pro ») pour qu\'une clé de cette édition soit injectée ; jamais la clé d\'une autre édition.' });
      // La même bibliothèque que Hydre et Andromède : ce qui n'est pas (encore) démarrable est montré avec son état.
      if (biblio.d && (biblio.d.enCours.length || biblio.d.quarantaine.length)) sections.push({ kind: 'list', title: 'Images pas encore démarrables', items: [...biblio.d.enCours.map((x) => ({ title: x.nom, detail: `en cours de téléchargement${x.pct !== undefined ? ` · ${x.pct} %` : ` · ${Math.round(x.recu / 1024 ** 2)} Mo reçus`} : proposée au démarrage une fois complète et passée par l'antivirus`, tone: 'attention' as const })), ...biblio.d.quarantaine.map((x) => ({ title: x.nom, detail: `en quarantaine (${x.menace}) : jamais proposée ; décide dans Asclépios`, tone: 'mauvais' as const }))] });
      sections.push({ kind: 'table', title: 'Machines autorisées', columns: ['Machine', 'Nom', 'ISO', 'Profil', 'Installation auto', 'État'], rows: rs.map((r) => ({ cells: [r.mac, r.nom ?? hostOf(r.mac), l.find((i) => i.id === r.iso)?.name ?? (r.iso ?? 'menu'), profiles(ctx).find((p) => p.id === r.profil)?.nom ?? 'Standard', r.auto ? 'oui (efface le disque)' : 'non', r.auto ? (r.fait ? 'faite' : 'au prochain démarrage') : '—'], actions: [{ action: 'retirer_machine', label: 'Retirer', input: { mac: r.mac } }, ...(r.auto && r.fait ? [{ action: 'reinstaller', label: 'Réinstaller', input: { mac: r.mac } }] : [])] })), empty: 'Aucune : une machine inconnue a le menu, et démarre sur son disque si personne ne choisit.' });
      sections.push({ kind: 'table', title: 'Déjà passées', columns: ['Date', 'Nom pris sur le réseau', 'Adresse', 'Machine', 'ISO', 'Durée', 'Résultat'], rows: h.slice(0, 50).map((d) => ({ cells: [new Date(d.at).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }), d.host ?? '—', d.ip ?? '—', d.mac, d.isoName, ago(d.ms), S.libelle(d.result, d)], tone: d.result === 'fini' ? 'bon' as const : S.rate(d.result) ? 'mauvais' as const : 'neutre' as const })), empty: 'Aucun déploiement terminé.' });
      const counts = l.map((i) => ({ label: i.name, value: st[i.id]?.lances ?? 0 })).filter((x) => x.value > 0);
      if (counts.length) sections.push({ kind: 'bars', title: 'Déploiements par ISO', items: counts });
      const side: Section[] = [
        { kind: 'text', title: 'Comment ça marche', text: `1. La machine démarre par le réseau (F12 / F11 / Échap au démarrage).\n2. ${s(ctx.settings.mode) === 'aucun' ? 'Ton DHCP' : 'Odin'} lui donne le chargeur iPXE, puis le menu.\n3. Machine inconnue : menu, puis son propre disque après ${Number(ctx.settings.delai ?? 10)} s (sauf ISO par défaut).\n4. Machine autorisée en automatique : l'ISO s'installe toute seule (une fois), puis les logiciels, et elle prévient Odin avec son nom.` },
        { kind: 'text', title: 'Réglages DHCP', text: s(ctx.settings.mode) === 'aucun' ? `Dans ton DHCP : option 66 = ${serverIp(ctx)}, option 67 = undionly.kpxe (BIOS) ou ipxe.efi (UEFI).` : s(ctx.settings.mode) === 'complet' ? `Odin distribue les adresses sur le réseau à part (${s(ctx.settings.carte) || '?'}) seulement${aPart ? '' : ' : arrêté en ce moment'} ; la page Réseau montre le garde-fou.` : `Mode ${s(ctx.settings.mode) || 'proxy'} : rien à régler sur la box.` },

      ];
      return { subtitle: http ? `Allumé · ${serverIp(ctx)}` : 'Éteint', kpis, sections, side };
    },
    async start(ctx) {
      C = ctx; if (ctx.settings.allume !== true) return;
      const notes = await startServers(ctx);
      // Au démarrage d'Odin, le réseau à part est revérifié avant de distribuer : un refus est dit, jamais tu.
      if (modeAdresses(s(ctx.settings.mode) || 'proxy') === 'complet' && !aPart) ctx.alert({ level: 'moyenne', title: 'Genèse ne distribue pas les adresses du réseau à part', detail: `${notes.filter((n) => n.startsWith('adresses')).join(' ') || 'La vérification de la carte a échoué.'} Le démarrage par le réseau reste allumé, sans adresses ; vois la page Réseau de Genèse.`, key: 'thjalfi-reseau-a-part-depart' });
    },
    stop() { stopServers(); S.fermer(); },
    watch: { every: 60, async run(ctx) {
      // Chaque minute : un poste sans signe de vie depuis le délai réglé (30 min au départ) est dit « abandonné » ; un poste
      // resté au menu a repris son disque (ce n'est pas un raté) ; une installation à la main est notée « lancée ».
      S.veiller(ctx);
      void C;
      // Le garde-fou du réseau à part (lot S8) : Odin redemande chaque minute si un autre serveur d'adresses répond sur la
      // carte ; s'il en voit un (ou ne peut pas vérifier, ou si la carte a disparu), il arrête aussitôt de distribuer.
      await veillerAPart(ctx);
    } },
  };
  /** Le garde-fou, chaque minute, tant qu'Odin distribue des adresses sur le réseau à part. */
  async function veillerAPart(ctx: ModCtx): Promise<void> {
    const srv = aPart; if (!srv) return;
    const c = carteChoisie(ctx), avant = aPartCarte, non = c ? refusCarte(c, RESEAU.plateforme(), cartesDuPc()) : undefined;
    if (!c) { couperAPart(ctx, `la carte ${s(ctx.settings.carte) || '?'} n'est plus là`); return; }
    // La prise écoute l'adresse d'avant : une carte qui a changé d'adresse (ou de réseau) n'est plus celle qui a été vérifiée.
    if (avant && (c.ip !== avant.ip || c.prefixe !== avant.prefixe)) { couperAPart(ctx, `la carte ${c.nom} a changé d'adresse (${avant.ip}/${avant.prefixe} → ${c.ip}/${c.prefixe})`); return; }
    if (non) { couperAPart(ctx, non); return; }
    const g = await verifierCarte(ctx, c, true);
    if (g.etat !== 'libre' && aPart === srv) couperAPart(ctx, g.autres.length ? `un autre serveur d'adresses répond sur ${c.nom} (${g.autres.join(', ')})` : g.raison ?? 'vérification impossible', g.autres);
  }
  // Pour les essais du réseau à part : le MÊME serveur d'adresses et le même garde-fou ; l'écoute passe par RESEAU.ecouter.
  Object.defineProperty(mod, 'reseauAPart', { value: () => aPart, enumerable: false });
  // Pour les essais de sûreté : le MÊME traitement que le serveur de démarrage, sans rien écouter (aucun port, aucun PC).
  Object.defineProperty(mod, 'serveurSimule', { value: (ctx: ModCtx) => creerHttp(ctx), enumerable: false });
  return mod;
}

// ---------------- Déployer, étapes 4 à 6 (maquette « Genèse · Systèmes », lot S6) ----------------
/** Un PC autorisé l'est pour 2 h ; « le prochain PC qui démarre » pour 30 min. */
export const DUREE_PC = 2 * 3600_000, DUREE_PROCHAIN = 30 * 60_000;
/** Au plus 50 PC d'un coup. */
export const PCS_MAX = 50;
/** La phrase EXACTE à taper pour effacer le disque de N PC : « effacer 3 pc ». Pur. */
export const phraseDeploiement = (n: number) => `effacer ${Math.max(0, Math.round(Number(n) || 0))} pc`;
/** Les PC d'une demande de déploiement, revus : adresses MAC valables (sans doublon, 50 au plus), le prochain PC, la façon. Pur. */
/** Le choix d'identité envoyé par la page : { adresse MAC : nom de l'identité } (objet ou JSON) ; illisible : null. Pur. */
export function choixIdentites(v: unknown): Record<string, string> | null {
  if (v == null || v === '') return {};
  let o = v;
  if (typeof o === 'string') { if (o.length > 8000) return null; try { o = JSON.parse(o); } catch { return null; } }
  if (!o || typeof o !== 'object' || Array.isArray(o)) return null;
  const out: Record<string, string> = {};
  for (const [k, x] of Object.entries(o as Record<string, unknown>).slice(0, PCS_MAX)) { const m = normMac(k); if (!m || typeof x !== 'string' || x.length > 300) return null; out[m] = x; }
  return out;
}
/** Ce qu'une autorisation garde d'une identité choisie. Pur. */
const identiteDe = (c: IdentiteVue): IdentiteVue => ({ ...(c.serie ? { serie: c.serie } : {}), ...(c.uuid ? { uuid: c.uuid } : {}), ...(c.disque ? { disque: c.disque } : {}) });
export function demandeDeploiement(i: Record<string, unknown>): { pcs: string[]; prochain: boolean; facon: 'auto' | 'menu'; n: number } | { refus: string } {
  let brut: unknown = i.pcs;
  if (typeof brut === 'string') { const t = brut.trim(); if (t.length > 8000) return { refus: 'Trop de PC.' }; try { brut = t.startsWith('[') ? JSON.parse(t) : t.split(/[\s,;]+/).filter(Boolean); } catch { return { refus: 'Liste de PC illisible.' }; } }
  if (brut === undefined || brut === null || brut === '') brut = [];
  if (!Array.isArray(brut)) return { refus: 'Liste de PC illisible.' };
  if (brut.length > PCS_MAX) return { refus: `${PCS_MAX} PC au plus d'un coup.` };
  const pcs: string[] = [];
  for (const x of brut) { const m = macPoste(x); if (!m) return { refus: `Adresse MAC refusée : « ${String(x).slice(0, 40)} ».` }; if (!pcs.includes(m)) pcs.push(m); }
  const prochain = i.prochain === true || i.prochain === 'true';
  const f = s(i.facon) || 'auto';
  if (f !== 'auto' && f !== 'menu') return { refus: 'Façon inconnue (auto ou menu).' };
  const n = pcs.length + (prochain ? 1 : 0);
  if (!n) return { refus: 'Choisis au moins un PC (ou le prochain PC qui démarre).' };
  return { pcs, prochain, facon: f, n };
}
/** Les options Windows de l'étape 5, revues (comme pour la clé) : interrupteurs, nom du compte, clé d'activation. Pur. */
export function optionsDeploiement(w: unknown): { exigences: boolean; local: boolean; compte: string; viePrivee: boolean; langue: boolean; activation: 'auto' | 'aucune' } | { refus: string } {
  let v = w;
  if (typeof v === 'string') { if (v.length > 4000) return { refus: 'Options Windows illisibles.' }; try { v = v ? JSON.parse(v) : {}; } catch { return { refus: 'Options Windows illisibles.' }; } }
  const o = v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
  const local = o.local !== false, compte = typeof o.compte === 'string' ? o.compte.trim() : '';
  if (local && compte && !nomCompteValide(compte)) return { refus: 'Nom du compte Windows refusé (1 à 20 caractères, sans " / \\ [ ] : ; | = , + * ? < > @ %).' };
  return { exigences: o.exigences !== false, local, compte: local ? (compte || 'Utilisateur') : '', viePrivee: o.viePrivee !== false, langue: o.langue !== false, activation: o.activation === 'aucune' ? 'aucune' : 'auto' };
}
/**
 * L'aperçu de l'étape 4 « Logiciels et scripts » (et de l'étape 5) pour un déploiement PAR LE RÉSEAU : le profil de
 * logiciels relu côté serveur, la liste pour le système choisi (« tout seul » ou non), tes scripts revérifiés par
 * l'antivirus (refusés : montrés avec la raison, jamais servis), le script créé tout seul, et la clé d'activation du coffre
 * (4 derniers caractères seulement). LECTURE SEULE ; aucun mot de passe (un par PC, créé au lancement, dans le coffre).
 */
export function deployerApercuAction(bibliotheque: (ctx: ModCtx) => Promise<IsoInfo[]>): Action {
  return {
    id: 'deployer_apercu', label: 'Déployer : aperçu de la fin', read: true, quick: false, proprietaireSeul: true,
    what: 'Ce qui s\'installera tout seul à la fin sur chaque PC (logiciels du profil, tes scripts revérifiés), et le script créé tout seul ; rien n\'est lancé',
    params: [{ key: 'iso', label: 'Système', kind: 'text' }, { key: 'profil', label: 'Profil de logiciels', kind: 'text' }, { key: 'windows', label: 'Options Windows', kind: 'textarea' }],
    run: async (ctx, i) => {
      const img = (await bibliotheque(ctx)).find((x) => x.id === s(i.iso));
      if (!img?.recipe) return { ok: false, text: 'Ce système n\'est pas prêt dans la bibliothèque.' };
      const kind = img.recipe.kind, os: OsProfil = kind === 'windows' ? 'windows' : kind === 'rhel' || kind === 'fedora-live' ? 'fedora' : 'debian';
      const prof = s(i.profil) ? lireProfils(ctx).liste.find((x) => x.id === s(i.profil)) : undefined;
      const logiciels = (prof?.systemes[os].logiciels ?? []).map((l) => {
        const quoi = installeAuto(l.id, l.fichier), fam = familleLogiciel(l.fichier);
        const ok = os === 'windows' ? quoi === 'windows' : quoi === 'linux' && (os === 'debian' ? fam === 'linux-deb' : fam === 'linux-rpm');
        return { id: l.id, nom: l.nom, fichier: l.fichier, toutSeul: ok };
      });
      const { verdicts, acceptes } = scriptsRevus(prof?.systemes[os].scripts ?? [], antivirusScript);
      const scripts = acceptes.filter((y) => osDuScript(y.nom) === (os === 'windows' ? 'windows' : 'linux'));
      const b = 'http://odin', jeton = 'jeton-du-pc';
      const a: Answer = { host: 'pc-01', user: 'odin', password: '', locale: 'fr_FR.UTF-8', keymap: 'fr', timezone: 'Indian/Mayotte', packages: [], report: `${b}/etat/${jeton}`,
        software: logiciels.filter((l) => l.toutSeul && os === 'windows').map((l) => { const sa = silentArgs(l.id, l.fichier); return { name: l.nom, url: `${b}/logiciel/${jeton}/${encodeURIComponent(l.fichier)}`, args: sa.args, msi: sa.msi }; }),
        paquetsFichiers: logiciels.filter((l) => l.toutSeul && os !== 'windows').map((l, k) => ({ nom: l.nom, url: `${b}/logiciel/${jeton}/paquet-${k + 1}.${os === 'debian' ? 'deb' : 'rpm'}`, genre: os === 'debian' ? 'deb' as const : 'rpm' as const })),
        scriptsApres: scripts.map((y, k) => ({ nom: y.nom, url: os === 'windows' ? `${b}/w/${jeton}/script-${k + 1}.${(/\.(cmd|bat)$/i.exec(y.nom)?.[1] ?? 'ps1').toLowerCase()}` : `${b}/seed/${jeton}/script-${k + 1}.sh` })) };
      const script = os === 'windows' ? windowsAfter(a) : scriptFinLinux(a);
      const cles = clesPubliques(ctx.dir), ed = os === 'windows' ? editionDeImage(img.name, img.recipe.label) : undefined, cle = ed ? cles.find((c) => c.id === ed.id) : undefined;
      return { ok: true, text: `${logiciels.filter((l) => l.toutSeul).length} logiciel(s) et ${scripts.length} script(s) installés tout seuls à la fin. Rien n'est lancé.`,
        data: { os, systeme: img.name, auto: img.recipe.auto, profil: prof ? { id: prof.id, nom: prof.nom } : null, logiciels, scripts: verdicts, script, edition: ed ? { id: ed.id, label: ed.label } : null, activation: cle ? { edition: cle.edition, fin: String(cle.indice ?? '').slice(-4) } : null } };
    },
  };
}

// ---------------- Clé USB : l'aperçu des scripts (étapes « Logiciels et scripts » et « Options Windows ») ----------------
/** Les règles de base de l'antivirus d'Odin (le moteur d'Asclépios), prêtes une seule fois. */
let reglesScripts: RuleSet | undefined;
/** L'antivirus d'Odin sur un script ajouté (lu en mémoire, jamais exécuté) : rend la raison s'il est dangereux. */
function antivirusScript(nom: string, contenu: string): string | undefined {
  reglesScripts ??= new RuleSet(BASE_RULES.map(compileGaldr));
  const v = scanBuffer(nom, Buffer.from(contenu, 'utf8'), { rules: reglesScripts });
  if (!v.level) return undefined;
  const c = plusieursConstats(v)[0];
  return `L'antivirus d'Odin l'a refusé : ${c ? `${c.threat} (${c.why})` : 'contenu dangereux'}.`;
}
/** Les 4 derniers caractères d'une clé, le reste masqué : la clé n'est jamais montrée en entier. Pur. */
const cleMasquee = (indice: string) => `•••••-•••••-•••••-•••••-•${String(indice ?? '').slice(-4)}`;
/** Les empreintes de mot de passe (sha512crypt) masquées dans l'aperçu. Pur. */
const sansEmpreintes = (t: string) => t.replace(/\$6\$[^\s"'\n]+/g, '••••••••');

/**
 * L'aperçu en direct des scripts d'un système choisi pour la clé : le fichier de réponses Windows (avec les options
 * de l'étape 5) et le script de fin (logiciels puis tes scripts, dans l'ordre), ou les réponses Linux. Les scripts
 * ajoutés passent d'abord par l'antivirus d'Odin : seuls ceux acceptés entrent dans l'aperçu. LECTURE SEULE : rien
 * n'est écrit, aucun script n'est exécuté ; la clé d'activation n'est jamais lue en clair (seuls ses 4 derniers
 * caractères sont montrés), aucun mot de passe n'apparaît.
 */
export function apercuScriptCle(profiles: (ctx: ModCtx) => Profile[]): Action {
  return {
    // Propriétaire seul : elle lit le coffre des clés d'activation (éditions, 4 derniers caractères) et fait tourner
    // l'antivirus sur 20 scripts de 64 Ko ; ni un membre, ni une tablette, ni une clé d'API, ni une automatisation.
    id: 'cle_apercu_script', label: 'Clé USB : aperçu des scripts', read: true, quick: false, proprietaireSeul: true,
    what: 'Le script créé tout seul pour un système de la clé (logiciels, tes scripts, options Windows), montré avant d\'écrire ; tes scripts passent par l\'antivirus d\'Odin',
    params: [{ key: 'systeme', label: 'Système (famille, nom)', kind: 'textarea' }, { key: 'logiciels', label: 'Logiciels choisis', kind: 'textarea' }, { key: 'scripts', label: 'Tes scripts', kind: 'textarea' }, { key: 'windows', label: 'Options Windows', kind: 'textarea' }],
    words: ['script de la clé', 'aperçu du script', 'script d\'installation de la clé'],
    run: (ctx, i) => {
      const o = (x: unknown): Record<string, unknown> => (x && typeof x === 'object' && !Array.isArray(x) ? x as Record<string, unknown> : {});
      const sys = o(i.systeme), nom = s(sys.nom).slice(0, 200), fichier = s(sys.fichier).slice(0, 255);
      const fam = s(sys.famille).toLowerCase();
      const famille: 'windows' | 'ubuntu' | 'debian' | 'rhel' = fam === 'windows' ? 'windows' : /debian/i.test(`${nom} ${fichier}`) ? 'debian' : /fedora|rocky|alma|centos|rhel/i.test(`${nom} ${fichier}`) ? 'rhel' : 'ubuntu';
      // Tes scripts : au plus 20, de 64 Ko chacun ; chacun vérifié (extension, commandes qui effacent un disque, antivirus).
      // Le MÊME tri qu'à l'écriture (scripts.ts, scriptsRevus).
      const { verdicts, acceptes } = scriptsRevus(i.scripts, antivirusScript);
      const pourOs = acceptes.filter((x) => osDuScript(x.nom) === (famille === 'windows' ? 'windows' : 'linux'));
      // Les logiciels cochés : seuls ceux qui s'installent tout seuls entrent dans le script (logiciels-cle.ts).
      const choisis = (Array.isArray(i.logiciels) ? i.logiciels : []).slice(0, 200).map(o).map((x) => ({ id: s(x.id).slice(0, 120), fichier: (s(x.fichier).split(/[\\/]/).pop() ?? '').slice(0, 255) })).filter((x) => x.fichier);
      const pour = versScripts(choisis);
      const p = profiles(ctx)[0], w = o(i.windows);
      const nomCompte = s(w.compte).trim();
      // La clé d'activation : choisie par édition parmi celles du coffre (seuls leurs indices sont lus), sinon aucune.
      const cles = clesPubliques(ctx.dir).map((c) => ({ id: c.id, edition: c.edition, fin: c.indice.slice(-4) }));
      const reconnue = editionDeImage(fichier || nom, nom);
      const voulue = s(w.activation);
      const act = voulue === 'aucune' ? undefined : cles.find((c) => c.id === (voulue || reconnue?.id));
      // Le nom du compte de l'étape 5 vaut pour Windows ; un Linux garde celui du profil d'installation (minuscules exigées).
      const userLinux = /^[a-z_][a-z0-9_-]{0,31}$/.test(p.utilisateur) ? p.utilisateur : 'odin';
      const answer: Answer = { host: 'odin-pc', user: famille === 'windows' ? (nomCompteValide(nomCompte) ? nomCompte : 'odin') : userLinux, password: '', locale: p.langue, keymap: p.clavier, timezone: p.fuseau, packages: [], report: 'http://odin.local/etat/cle', ...(act ? { productKey: cleMasquee(act.fin) } : {}) };
      // Le disque du PC est TOUJOURS choisi au moment d'installer (optionsWindowsDe, le même calcul qu'à l'écriture).
      const opt = optionsWindowsDe(w);
      const fichiers = Object.fromEntries(Object.entries(apercuScripts({ famille, answer, fw: 'uefi', opt, logiciels: pour.windows, debsCle: pour.debs, token: 'cle', scripts: pourOs })).map(([k, v]) => [k, sansEmpreintes(v)]));
      const refuses = verdicts.filter((v) => !v.ok).length;
      return { ok: true, text: `${Object.keys(fichiers).length} fichier(s) pour ${nom || famille}${refuses ? ` · ${refuses} script(s) refusé(s)` : ''}. Rien n'est écrit.`,
        data: { famille, fichiers, scripts: verdicts, copies: famille === 'windows' ? pour.copieWindows : pour.copieLinux, cles, activation: act ?? null, edition: reconnue ? { id: reconnue.id, label: reconnue.label } : null, compteValide: nomCompteValide(nomCompte) } };
    },
  };
}

// ---------------- Systèmes (maquette « Genèse · Systèmes », lot S1) ----------------
/** La famille d'un système pour les filtres de l'onglet : un serveur l'est avant tout ; sinon Windows, outil ou Linux. Pur. */
export function familleSysteme(o: { systeme?: string; nom?: string; detail?: string; edition?: string }): 'windows' | 'linux' | 'outil' | 'serveur' | 'autre' {
  const t = `${o.nom ?? ''} ${o.detail ?? ''} ${o.edition ?? ''}`.toLowerCase();
  if (/server|serveur|proxmox|truenas|esxi/.test(t)) return 'serveur';
  if (o.systeme === 'Windows' || /windows|win1[01]\b|win2\d/.test(t)) return 'windows';
  if (/clonezilla|gparted|memtest|rescue|hiren|shredos|virtio|pilotes/.test(t) || o.systeme === 'Autre') return 'outil';
  if (o.systeme === 'macOS') return 'autre';
  return 'linux';
}
/** Une carte de l'onglet « Systèmes » : un système de la bibliothèque, un téléchargement en cours, ou un fichier jeté. */
export interface CarteSysteme {
  id: string; nom: string; version?: string; fichier?: string; famille: ReturnType<typeof familleSysteme>; genre?: string; taille?: number;
  /** pret : dans la bibliothèque et passé par l'antivirus ; telechargement ; verification (empreinte et antivirus en cours) ; empreinte_fausse (fichier jeté) ; bloque */
  etat: 'pret' | 'telechargement' | 'verification' | 'empreinte_fausse' | 'bloque';
  /** editeur : identique à celle publiée par l'éditeur ; calculee : notée par Odin (l'éditeur n'en publie pas) ; changee : ne correspond plus */
  empreinte?: 'editeur' | 'calculee' | 'changee';
  antivirus?: 'propre' | 'a_verifier' | 'en_cours' | 'bloque';
  maj?: { version: string; source: string };
  telechargement?: { recu: number; total?: number; pct?: number };
  /** la source d'Andromède (arrêter, retélécharger, mettre à jour) */
  source?: string;
  /** Déployer : l'identifiant de l'image pour la clé USB (étape 3), seulement si elle démarre et qu'elle est prête */
  iso?: string; deployable: boolean; raison?: 'verification' | 'inconnu' | 'bloque' | 'absent';
  /** déployable et sa recette l'installe toute seule (sinon : elle démarre seulement) */
  installe?: boolean;
  /** quand le fichier a été jeté (empreinte fausse) et pourquoi */
  le?: number; pourquoi?: string;
}
type FicheLue = { chemin: string; nom: string; taille?: number; systeme?: string; detail?: string; version?: string; edition?: string; sha256?: string; editeur?: boolean; ancienne?: boolean; antivirus?: { verdict?: string }; verifiee?: { ok?: boolean } };
type ImageGenese = { id: string; chemin: string; demarre: boolean; prete: boolean; /** sa recette l'installe toute seule */ auto?: boolean };
type Dispo = { chemin: string; etat?: string; derniere?: string; source?: string };
type Surveille = { id: string; nom: string; derniere?: string; enCours?: { recu: number; total?: number; pct?: number } };
const cheminNet = (p: string) => String(p ?? '').replace(/\\/g, '/').toLowerCase();
const sansIso = (n: string) => String(n ?? '').replace(/\.iso$/i, '');
/** Les fichiers jetés pour une empreinte fausse, lus dans l'historique d'Andromède (le plus récent d'abord ; il ne rend que du texte).
 *  Un fichier retéléchargé depuis n'est plus jeté. Pur. */
export function jetesDeLHistorique(texte: string, surveilles: Surveille[], now: number, joursMax = 14): Array<{ nom: string; version?: string; source?: string; le: number; pourquoi?: string }> {
  const vus = new Set<string>(), out: Array<{ nom: string; version?: string; source?: string; le: number; pourquoi?: string }> = [];
  const parNom = [...surveilles].sort((a, b) => b.nom.length - a.nom.length);
  for (const l of String(texte ?? '').split('\n')) {
    const m = /^- (\d{1,2})\/(\d{1,2})\/(\d{4})[\s,à]+(\d{1,2}):(\d{2})(?::(\d{2}))? · ([^·]+?) · (.+)$/.exec(l.trim()); if (!m) continue;
    const quoi = m[7].trim(), [qui, ...reste] = m[8].split(' · '), q = qui.trim();
    // Le nom de la source, puis la version (une version ne commence jamais par une parenthèse : « Windows 11 (ARM 64) » est une autre source).
    const sv = parNom.find((x) => q === x.nom || (q.startsWith(`${x.nom} `) && !q.slice(x.nom.length).trim().startsWith('(')));
    const nom = sv?.nom ?? q, cle = (sv?.id ?? q).toLowerCase();
    if (vus.has(cle)) continue;
    if (quoi === 'téléchargé') { vus.add(cle); continue; }
    if (quoi !== 'empreinte fausse') continue;
    vus.add(cle);
    const le = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]), Number(m[4]), Number(m[5]), Number(m[6] ?? 0)).getTime();
    if (!Number.isFinite(le) || now - le > joursMax * 864e5) continue;
    const version = sv && q.length > sv.nom.length ? q.slice(sv.nom.length).trim() : undefined;
    out.push({ nom, ...(version ? { version } : {}), ...(sv ? { source: sv.id } : {}), le, ...(reste.length ? { pourquoi: reste.join(' · ').slice(0, 300) } : {}) });
  }
  return out;
}
/** L'onglet « Systèmes » en données : chaque carte avec son état VRAI, les quatre chiffres et la place. Pur (aucune écriture). */
export function assemblerSystemes(e: { fiches: FicheLue[]; images: ImageGenese[]; disponibles: Dispo[]; surveilles: Surveille[]; historique: string; place?: { total?: number; libre?: number }; now: number }) {
  const img = new Map(e.images.map((i) => [cheminNet(i.chemin), i])), dispo = new Map(e.disponibles.map((d) => [cheminNet(d.chemin), d]));
  const cartes: CarteSysteme[] = [];
  const enCours = e.surveilles.filter((x) => x.enCours);
  for (const f of e.fiches) {
    if (f.ancienne) continue; // les anciennes versions restent dans « old » : pas de carte
    const v = f.antivirus?.verdict, g = img.get(cheminNet(f.chemin)), d = dispo.get(cheminNet(f.chemin));
    const etat: CarteSysteme['etat'] = v === 'bloqué' ? 'bloque' : !v || v === 'non analysé' ? 'verification' : 'pret';
    const deployable = etat === 'pret' && Boolean(g?.demarre && g.prete);
    const nom = f.detail && !/^(Système inconnu|Linux|Windows)$/.test(f.detail) ? f.detail : sansIso(f.nom);
    cartes.push({
      id: `iso:${cheminNet(f.chemin)}`, nom, ...(f.version && !nom.includes(f.version) ? { version: f.version } : {}), fichier: f.nom, famille: familleSysteme({ ...f, nom: f.nom }), ...(f.edition ? { genre: f.edition } : {}), taille: Number(f.taille) || 0, etat,
      ...(f.verifiee?.ok === false ? { empreinte: 'changee' as const } : f.editeur === true ? { empreinte: 'editeur' as const } : f.sha256 ? { empreinte: 'calculee' as const } : {}),
      antivirus: v === 'sain' ? 'propre' : v === 'à vérifier' ? 'a_verifier' : v === 'bloqué' ? 'bloque' : 'en_cours',
      ...(d?.etat === 'nouvelle version' && d.derniere && d.source ? { maj: { version: d.derniere, source: d.source }, source: d.source } : d?.source ? { source: d.source } : {}),
      ...(g ? { iso: g.id } : {}), deployable, ...(deployable && g?.auto ? { installe: true } : {}), ...(deployable ? {} : { raison: etat === 'bloque' ? 'bloque' as const : etat === 'verification' || (g?.demarre && !g.prete) ? 'verification' as const : g ? 'inconnu' as const : 'absent' as const }),
    });
  }
  for (const x of enCours) {
    // Un téléchargement en cours qui remplace une version déjà là : la carte de la version présente reste, celle-ci s'ajoute.
    cartes.unshift({ id: `dl:${x.id}`, nom: x.nom, ...(x.derniere ? { version: x.derniere } : {}), famille: familleSysteme({ nom: x.nom }), ...(x.enCours!.total ? { taille: x.enCours!.total } : {}), etat: 'telechargement', telechargement: { ...x.enCours! }, source: x.id, deployable: false, raison: 'absent' });
  }
  for (const j of jetesDeLHistorique(e.historique, e.surveilles, e.now)) {
    if (j.source && enCours.some((x) => x.id === j.source)) continue; // il se retélécharge déjà
    cartes.push({ id: `faux:${(j.source ?? j.nom).toLowerCase()}`, nom: j.nom, ...(j.version ? { version: j.version } : {}), famille: familleSysteme({ nom: j.nom }), etat: 'empreinte_fausse', ...(j.source ? { source: j.source } : {}), deployable: false, raison: 'absent', le: j.le, ...(j.pourquoi ? { pourquoi: j.pourquoi } : {}) });
  }
  const verifs = cartes.filter((c) => c.etat === 'verification'), dl = cartes.filter((c) => c.etat === 'telechargement');
  const utilise = e.fiches.reduce((n, f) => n + (Number(f.taille) || 0), 0);
  const premier = dl[0] ? { nom: dl[0].nom, ...(dl[0].telechargement?.pct !== undefined ? { pct: dl[0].telechargement.pct } : {}) } : verifs[0] ? { nom: verifs[0].nom } : undefined;
  return {
    cartes,
    chiffres: { prets: cartes.filter((c) => c.deployable).length, enCours: dl.length + verifs.length, ...(premier ? { premier } : {}), majs: cartes.filter((c) => c.maj).length },
    place: { utilise, ...(e.place?.total ? { total: e.place.total } : {}), ...(e.place?.libre !== undefined ? { libre: e.place.libre } : {}) },
  };
}
/**
 * L'action en lecture `systemes` : la bibliothèque d'ISO d'Hydre (bibliotheque_iso), ce qu'Andromède télécharge, ce qui
 * a une version plus récente et ce qu'elle a jeté (empreinte fausse), et l'image que la clé USB connaît (pour Déployer).
 * Rien n'est écrit. Propriétaire seul, comme les actions de la clé : ni un membre, ni une tablette, ni une clé d'API.
 */
export function systemesAction(images: (ctx: ModCtx) => Promise<ImageGenese[]>): Action {
  return {
    id: 'systemes', label: 'Systèmes', read: true, quick: false, proprietaireSeul: true,
    what: 'Les systèmes téléchargés : prêts à déployer, en téléchargement, en vérification, empreinte fausse, mise à jour disponible',
    run: async (ctx) => {
      const lire = async <T,>(m: string, a: string, i: Record<string, unknown>, why: string): Promise<{ data?: T; text: string } | undefined> => { try { const r = await ctx.call(m, a, i, why, { interne: true }); return r.ok === false ? undefined : { data: r.data as T, text: r.text ?? '' }; } catch { return undefined; } };
      const [b, dsp, srv, hst, g] = await Promise.all([
        lire<{ dossier?: string; isos?: FicheLue[] }>('ymir', 'bibliotheque_iso', {}, 'les systèmes de Genèse'),
        lire<{ fichiers?: Dispo[] }>('eitri', 'disponibles', {}, 'les mises à jour des systèmes de Genèse'),
        lire<{ surveilles?: Surveille[] }>('eitri', 'surveilles', {}, 'les téléchargements des systèmes de Genèse'),
        lire<unknown>('eitri', 'historique', { n: 200 }, 'les fichiers jetés (empreinte fausse)'),
        images(ctx).catch(() => [] as ImageGenese[]),
      ]);
      const dossier = s(b?.data?.dossier);
      let place: { total?: number; libre?: number } | undefined;
      if (dossier) { try { const f = statfsSync(dossier); place = { total: Number(f.blocks) * Number(f.bsize), libre: Number(f.bavail) * Number(f.bsize) }; } catch { /* dossier absent ou illisible */ } }
      const d = assemblerSystemes({ fiches: b?.data?.isos ?? [], images: g, disponibles: dsp?.data?.fichiers ?? [], surveilles: srv?.data?.surveilles ?? [], historique: hst?.text ?? '', place, now: ctx.now().getTime() });
      return { ok: true, text: `${d.chiffres.prets} système(s) prêt(s) à déployer · ${d.chiffres.enCours} en cours · ${d.chiffres.majs} mise(s) à jour disponible(s)`, data: { ...d, dossier, lu: { bibliotheque: Boolean(b), telechargements: Boolean(srv) } } };
    },
  };
}

// ---------------- Déployer, étape « Postes » (maquette « Genèse · Systèmes », lot S5) ----------------
/** Six paires écrites d'une seule façon (« : », « - » ou rien), 17 caractères au plus. */
const MAC_ECRITE = /^[0-9a-f]{2}([:-]?)[0-9a-f]{2}(?:\1[0-9a-f]{2}){4}$/i;
/**
 * L'adresse MAC d'UN PC, en minuscules avec « : », ou '' : mal écrite, nulle, de diffusion (ff:ff:…) ou de groupe (premier
 * octet impair) — aucune de celles-là ne désigne un PC. Pur.
 */
export function macPoste(x: unknown): string {
  const t = typeof x === 'string' ? x.replace(/^[ \t]+|[ \t]+$/g, '') : '';
  if (!t || t.length > 17 || !MAC_ECRITE.test(t)) return '';
  const m = normMac(t);
  if (!m || m === '00:00:00:00:00:00' || (parseInt(m.slice(0, 2), 16) & 1) === 1) return '';
  return m;
}
/** Un nom, une marque, un modèle : du texte sur une ligne, sans caractère invisible ni de contrôle, borné. Pur. */
const texteSeul = (x: unknown, max: number) => (typeof x === 'string' ? x : '').replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\s]+/gu, ' ').trim().slice(0, max).trim();
/** Ce que le serveur de démarrage sait déjà des PC. */
export interface SourcePostes {
  live: Record<string, Partial<Machine>>; historique: Array<Partial<Done>>; regles: Array<Partial<Rule>>;
  bloques: Record<string, { at?: number; raison?: string }>;
}
/** Un PC vu au menu de démarrage réseau (ou autorisé, ou bloqué), tel que la page le montre. */
export interface PosteVu {
  mac: string; nom?: string; fw?: Firmware; marque?: string; modele?: string; serie?: string;
  /** la dernière fois qu'il s'est montré (absent : jamais vu) */ vu?: number;
  /** au menu en ce moment (moins de 5 min) */ auMenu: boolean; etape?: string;
  bloque: boolean; autorise: boolean;
  /** la dernière installation réussie par Odin (tout ce qu'Odin sait de son disque) */ installe?: { image: string; le: number };
}
/** Le menu attend au plus quelques minutes : au-delà, le PC a repris son disque. */
const AU_MENU_MS = 5 * 60_000;
const ETAPES_MENU = new Set(['démarrage réseau', 'chargeur', 'menu']);
const FIRMWARES = new Set<string>(['bios', 'uefi', 'uefi32', 'arm64']);
/**
 * Les PC vus au démarrage réseau : un par adresse MAC (les fiches vivantes, puis l'historique du plus récent au plus
 * ancien, puis les PC autorisés et bloqués), au menu d'abord, puis du plus récent au plus ancien ; 200 au plus. Une
 * adresse qui n'est pas celle d'un PC est écartée ; rien n'est inventé (pas d'heure pour un PC jamais vu). Pur.
 */
export function postesVus(e: SourcePostes & { now: number }): PosteVu[] {
  const o = (x: unknown): Record<string, unknown> | undefined => (x && typeof x === 'object' && !Array.isArray(x) ? x as Record<string, unknown> : undefined);
  const par = new Map<string, PosteVu>();
  const prendre = (mac: unknown) => {
    const m = macPoste(mac); if (!m) return undefined;
    let p = par.get(m);
    if (!p) { if (par.size >= 2000) return undefined; p = { mac: m, auMenu: false, bloque: false, autorise: false }; par.set(m, p); }
    return p;
  };
  const ident = (p: PosteVu, x: Record<string, unknown>) => {
    for (const k of ['marque', 'modele', 'serie'] as const) if (!p[k]) { const v = texteSeul(x[k], k === 'serie' ? 40 : 60); if (v) p[k] = v; }
    if (!p.fw && FIRMWARES.has(String(x.fw))) p.fw = x.fw as Firmware;
    if (!p.nom) { const h = texteSeul(x.host, 63); if (h) p.nom = h; }
  };
  const vivants = Object.entries(o(e.live) ?? {}).map(([k, m]) => ({ k, m: o(m) })).filter((x): x is { k: string; m: Record<string, unknown> } => Boolean(x.m))
    .sort((a, b) => (Number(b.m.updated) || 0) - (Number(a.m.updated) || 0));
  for (const { k, m } of vivants) {
    const p = prendre(m.mac ?? k); if (!p) continue;
    const u = Number(m.updated) || 0;
    if (u > (p.vu ?? 0)) { p.vu = u; const st = texteSeul(m.step, 40); if (st) p.etape = st; }
    ident(p, m);
    if (ETAPES_MENU.has(String(m.step)) && u <= e.now + 60_000 && e.now - u < AU_MENU_MS) p.auMenu = true;
  }
  for (const d0 of Array.isArray(e.historique) ? e.historique : []) {
    const d = o(d0); if (!d) continue;
    const p = prendre(d.mac); if (!p) continue;
    const at = Number(d.at) || 0;
    if (at > (p.vu ?? 0)) p.vu = at;
    ident(p, d);
    const image = texteSeul(d.isoName, 120);
    if (!p.installe && d.result === 'fini' && image) p.installe = { image, le: at };
  }
  // Le nom donné par le propriétaire passe avant celui pris sur le réseau.
  for (const r0 of Array.isArray(e.regles) ? e.regles : []) {
    const r = o(r0); if (!r) continue;
    const p = prendre(r.mac); if (!p) continue;
    p.autorise = true; const n = texteSeul(r.nom, 63); if (n) p.nom = n;
  }
  for (const mac of Object.keys(o(e.bloques) ?? {})) { const p = prendre(mac); if (p) p.bloque = true; }
  return [...par.values()].sort((a, b) => Number(b.auMenu) - Number(a.auMenu) || Number(a.bloque) - Number(b.bloque) || (b.vu ?? 0) - (a.vu ?? 0) || a.mac.localeCompare(b.mac)).slice(0, 200);
}
/**
 * L'action en lecture `postes_vus` (étape « Postes » de Déployer) : les PC vus au menu de démarrage réseau, en direct (la
 * page la relit), si Genèse répond aux PC (allumé) et comment (mode), et si Hydre sait créer une machine virtuelle.
 * Rien n'est écrit, rien n'est lancé. Propriétaire seul : ni un membre, ni une tablette, ni une clé d'API.
 */
export function postesVusAction(source: (ctx: ModCtx) => (SourcePostes & { allume: boolean; mode: string }) | Promise<SourcePostes & { allume: boolean; mode: string }>): Action {
  return {
    id: 'postes_vus', label: 'PC vus au démarrage réseau', read: true, quick: false, proprietaireSeul: true,
    what: 'Les PC vus au menu de démarrage réseau (adresse, démarrage, modèle, vu quand, bloqué ou autorisé), pour choisir où déployer',
    run: async (ctx) => {
      const src = await source(ctx);
      const postes = postesVus({ ...src, now: ctx.now().getTime() });
      let vm = false;
      try { vm = ctx.modules().some((m) => m.id === 'ymir' && m.actions.some((a) => a.id === 'creer_machine')); } catch { vm = false; }
      const n = postes.filter((p) => p.auMenu).length;
      return { ok: true, text: `${postes.length} PC connu(s) du démarrage réseau · ${n} au menu en ce moment${src.allume ? '' : ' · Genèse est éteint'}`, data: { allume: Boolean(src.allume), mode: ['proxy', 'complet', 'odin', 'aucun'].includes(src.mode) ? src.mode : 'proxy', postes, vm } };
    },
  };
}

// ---------------- Logiciels et profils (maquette « Genèse · Systèmes », lot S4) ----------------
/** Les systèmes d'un profil de logiciels : un jeu pour Windows, un pour Ubuntu et Debian (.deb), un pour Fedora (.rpm). */
export const OS_PROFIL = ['windows', 'debian', 'fedora'] as const;
export type OsProfil = typeof OS_PROFIL[number];
/** Un logiciel d'un profil : il vient de la bibliothèque des logiciels déjà téléchargés ; « silencieux » est recalculé ici. */
export interface LogicielProfil { id: string; fichier: string; nom: string; silencieux: boolean }
/** Un profil de logiciels, COMMUN à la clé USB, au démarrage par le réseau et aux machines virtuelles. */
export interface ProfilLogiciels { id: string; nom: string; systemes: Record<OsProfil, { logiciels: LogicielProfil[]; scripts: ScriptPerso[] }>; cree: number; modifie: number }
/** Les bornes : un profil piégé (énorme, trop de lignes) est refusé, jamais tronqué en silence. */
export const BORNES_PROFILS = { profils: 30, nom: 60, logiciels: 200, scripts: 20, octetsProfil: 512 * 1024, octetsTout: 4 * 1024 * 1024 };
const FICHIER_PROFILS = 'profils-logiciels.json';
/** Caractères jamais permis dans un nom : de contrôle, invisibles, de sens d'écriture, privés, non attribués, fins de ligne
 *  et de paragraphe (U+2028, U+2029), et les « lettres » qui ne se voient pas (remplissage hangul U+115F, U+1160, U+3164,
 *  U+FFA0 ; braille vide U+2800) : un nom qui se lit autrement qu'il s'écrit. */
const INVISIBLES = /[\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Cn}\p{Zl}\p{Zp}\u{115F}\u{1160}\u{3164}\u{FFA0}\u{2800}]/u;
/** Un nom doit avoir au moins un signe qui se voit (lettre, chiffre, symbole, ponctuation) : pas seulement des accents seuls. */
const VISIBLE = /[\p{L}\p{N}\p{S}\p{P}]/u;
/** Les familles de fichiers acceptées pour chaque système d'un profil (même tri que l'onglet). */
const FAMILLES_OS: Record<OsProfil, string[]> = { windows: ['windows'], debian: ['linux-deb', 'linux-flatpak', 'linux-appimage'], fedora: ['linux-rpm', 'linux-flatpak', 'linux-appimage'] };
const osScriptDe = (os: OsProfil): 'windows' | 'linux' => (os === 'windows' ? 'windows' : 'linux');

/** Un nom de profil acceptable (1 à 60 caractères, rien d'invisible), ramené à sa forme simple ; sinon undefined. Pur. */
export function nomProfilValide(n: unknown): string | undefined {
  if (typeof n !== 'string' || INVISIBLES.test(n)) return undefined;
  // Les espaces « spéciaux » (insécable, cadratin…) deviennent des espaces simples : deux noms qui se voient pareils sont pareils.
  const t = n.normalize('NFC').replace(/\p{Zs}/gu, ' ').trim().replace(/ {2,}/g, ' ');
  return t && VISIBLE.test(t) && [...t].length <= BORNES_PROFILS.nom ? t : undefined;
}
type Revu<T> = { ok: true; valeur: T } | { ok: false; raison: string };
/** « systemes » tel qu'il arrive : un objet (la page) ou son écriture JSON (un formulaire) ; autre chose : undefined. Pur. */
export function systemesRecus(x: unknown): Record<string, unknown> | undefined {
  let v = x;
  if (typeof v === 'string') { if (v.length > BORNES_PROFILS.octetsProfil) return undefined; try { v = JSON.parse(v); } catch { return undefined; } }
  return v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : undefined;
}
/**
 * Les logiciels et les scripts d'un profil tels que la page les envoie (bruts, peut-être trafiqués), revus un par un :
 * fichier du bon système, noms sans rien d'invisible, bornes, et CHAQUE script revérifié (extension, commandes
 * dangereuses, antivirus). Tout écart REFUSE le profil (avec la raison) : rien n'est gardé à moitié. Pur (hors `scan`).
 */
export function systemesProfilRevus(brut: unknown, scan?: (nom: string, contenu: string) => string | undefined, o2: { scripts?: boolean } = {}): Revu<ProfilLogiciels['systemes']> {
  const o = (x: unknown): Record<string, unknown> => (x && typeof x === 'object' && !Array.isArray(x) ? x as Record<string, unknown> : {});
  let taille = 0;
  try { taille = JSON.stringify(brut ?? {}).length; } catch { return { ok: false, raison: 'Profil illisible.' }; }
  if (taille > BORNES_PROFILS.octetsProfil) return { ok: false, raison: 'Profil trop gros (512 Ko au plus).' };
  const b = o(brut), out = {} as ProfilLogiciels['systemes'];
  for (const os of OS_PROFIL) {
    const x = o(b[os]), ls = x.logiciels ?? [], sc = x.scripts ?? [];
    if (!Array.isArray(ls) || !Array.isArray(sc)) return { ok: false, raison: 'Profil illisible.' };
    if (ls.length > BORNES_PROFILS.logiciels) return { ok: false, raison: `Trop de logiciels (${BORNES_PROFILS.logiciels} au plus par système).` };
    if (sc.length > BORNES_PROFILS.scripts) return { ok: false, raison: `Trop de scripts (${BORNES_PROFILS.scripts} au plus par système).` };
    const logiciels: LogicielProfil[] = [], vus = new Set<string>();
    for (const l0 of ls) {
      const l = o(l0), fichier = s(l.fichier), id = s(l.id) || fichier, nom = s(l.nom) || fichier;
      if (!fichier || fichier.length > 255 || /[\\/:]/.test(fichier) || /^\.+$/.test(fichier) || INVISIBLES.test(fichier) || id.length > 120 || INVISIBLES.test(id) || [...nom].length > 120 || INVISIBLES.test(nom)) return { ok: false, raison: 'Un logiciel a un nom ou un fichier refusé.' };
      if (!FAMILLES_OS[os].includes(familleLogiciel(fichier))) return { ok: false, raison: `« ${fichier} » ne s'installe pas sur ce système.` };
      if (vus.has(fichier)) continue;
      vus.add(fichier);
      const m = modeInstall(id, fichier);
      logiciels.push({ id, fichier, nom, silencieux: m.silencieux && m.connu });
    }
    const scripts: ScriptPerso[] = [];
    for (const s0 of sc) {
      const z = o(s0), nom = s(z.nom), contenu = s(z.contenu);
      if (!nom || nom.length > 120 || /[\\/:]/.test(nom) || /^\.+$/.test(nom) || INVISIBLES.test(nom)) return { ok: false, raison: 'Un script a un nom refusé.' };
      if (osDuScript(nom) !== osScriptDe(os)) return { ok: false, raison: `« ${nom} » n'est pas un script pour ce système.` };
      scripts.push({ nom, contenu });
    }
    // Le MÊME tri que l'aperçu et l'écriture de la clé (scripts.ts) : un seul script dangereux refuse le profil.
    // (À la relecture du fichier gardé, o2.scripts = false : le verdict est rendu script par script, voir vuProfils.)
    const ko = o2.scripts === false ? undefined : scriptsRevus(scripts, scan).verdicts.find((v) => !v.ok);
    if (ko) return { ok: false, raison: `Le script « ${ko.nom} » est refusé : ${ko.raison ?? 'contenu dangereux'}` };
    out[os] = { logiciels, scripts };
  }
  return { ok: true, valeur: out };
}
/** Les profils lus, et ce qui n'a pas pu l'être : `abimes` profils laissés de côté (abîmés à la main, en double, de trop),
 *  ou tout le fichier illisible (`illisible`). Rien de cela n'est jamais écrasé en silence : voir garderProfils. */
interface LusProfils { liste: ProfilLogiciels[]; abimes: number; illisible: boolean }
/** Les profils gardés par Odin (un fichier du dossier de Genèse) ; un profil abîmé à la main est laissé de côté (et compté). */
function lireProfils(ctx: ModCtx): LusProfils {
  let texte: string;
  try { texte = readFileSync(join(ctx.dir, FICHIER_PROFILS), 'utf8'); } catch { return { liste: [], abimes: 0, illisible: false }; }
  let brut: unknown;
  try { brut = JSON.parse(texte); } catch { return { liste: [], abimes: 0, illisible: true }; }
  if (!brut || typeof brut !== 'object' || !Array.isArray((brut as { profils?: unknown }).profils)) return { liste: [], abimes: 0, illisible: true };
  const l = (brut as { profils: unknown[] }).profils, out: ProfilLogiciels[] = [], ids = new Set<string>();
  let abimes = Math.max(0, l.length - BORNES_PROFILS.profils);
  for (const p0 of l.slice(0, BORNES_PROFILS.profils)) {
    const p = p0 && typeof p0 === 'object' ? p0 as Record<string, unknown> : {};
    const nom = nomProfilValide(p.nom), id = s(p.id);
    if (!nom || !/^p-[a-f0-9]{8,32}$/.test(id) || ids.has(id)) { abimes++; continue; }
    // Relu ici pour la forme ; l'antivirus repasse sur chaque script à chaque usage (vuProfils, l'aperçu, l'écriture).
    const r = systemesProfilRevus(p.systemes, undefined, { scripts: false });
    if (!r.ok) { abimes++; continue; }
    ids.add(id);
    out.push({ id, nom, systemes: r.valeur, cree: Number(p.cree) || 0, modifie: Number(p.modifie) || 0 });
  }
  return { liste: out, abimes, illisible: false };
}
/**
 * Écrit les profils d'un coup (un fichier temporaire NEUF à côté, puis renommé : jamais un fichier à moitié écrit), dans le
 * dossier de Genèse et nulle part ailleurs. Si la lecture a laissé quelque chose de côté (fichier illisible, profil abîmé à la
 * main), le fichier d'avant est d'abord COPIÉ à part (profils-logiciels.abime-<date>.json) : rien n'est perdu en silence.
 * Rend le nom de cette copie, s'il y en a une.
 */
function garderProfils(ctx: ModCtx, l: ProfilLogiciels[], lus: LusProfils): string | undefined {
  const t = JSON.stringify({ v: 1, profils: l });
  if (t.length > BORNES_PROFILS.octetsTout) throw new Error('Plus de place pour les profils (4 Mo au plus en tout) : retire des scripts ou un profil.');
  mkdirSync(ctx.dir, { recursive: true });
  const f = join(ctx.dir, FICHIER_PROFILS);
  let copie: string | undefined;
  if (lus.illisible || lus.abimes > 0) {
    copie = `profils-logiciels.abime-${ctx.now().toISOString().replace(/[^0-9]/g, '').slice(0, 14)}-${randomBytes(2).toString('hex')}.json`;
    writeFileSync(join(ctx.dir, copie), readFileSync(f), { mode: 0o600, flag: 'wx' });
  }
  const tmp = `${f}.${randomBytes(6).toString('hex')}.tmp`;
  try { writeFileSync(tmp, t, { mode: 0o600, flag: 'wx' }); renameSync(tmp, f); } catch (x) { try { rmSync(tmp, { force: true }); } catch { /* rien */ } throw x; }
  return copie;
}
/** Les profils tels que la page les voit : chaque script REVÉRIFIÉ à chaque lecture (l'antivirus a pu apprendre depuis). */
function vuProfils(l: ProfilLogiciels[], scan: (nom: string, contenu: string) => string | undefined) {
  return {
    profils: l.map((p) => ({ id: p.id, nom: p.nom, modifie: p.modifie,
      systemes: Object.fromEntries(OS_PROFIL.map((os) => {
        const { verdicts } = scriptsRevus(p.systemes[os].scripts, scan);
        return [os, { logiciels: p.systemes[os].logiciels, scripts: p.systemes[os].scripts.map((x, k) => ({ ...x, ok: verdicts[k]?.ok === true, ...(verdicts[k]?.ok ? {} : { raison: verdicts[k]?.raison ?? 'refusé' }) })) }];
      })) })),
    bornes: BORNES_PROFILS,
  };
}
/** « Nom (copie) », « Nom (copie 2) »… un nom libre pour un profil dupliqué. Pur. */
export function nomDeCopie(nom: string, pris: string[]): string {
  const bas = new Set(pris.map((x) => x.toLowerCase()));
  for (let k = 1; k < 1000; k++) {
    const suffixe = k === 1 ? ' (copie)' : ` (copie ${k})`, base = [...nom].slice(0, BORNES_PROFILS.nom - [...suffixe].length).join('').trim();
    if (!bas.has(`${base}${suffixe}`.toLowerCase())) return `${base}${suffixe}`;
  }
  return `${[...nom].slice(0, 40).join('')} ${Date.now()}`;
}
const systemesVides = (): ProfilLogiciels['systemes'] => ({ windows: { logiciels: [], scripts: [] }, debian: { logiciels: [], scripts: [] }, fedora: { logiciels: [], scripts: [] } });
const NOM_FAUX = 'Donne un nom de 1 à 60 caractères, sans caractère invisible.';
/**
 * Les profils de logiciels de Genèse (lot S4) : la lecture (`profils_logiciels`) et l'écriture (`profil_logiciels` :
 * créer, enregistrer, renommer, dupliquer, supprimer). Gardés par Odin, côté serveur ; communs à la clé USB, au réseau et
 * aux machines virtuelles. Propriétaire seul pour les deux : ni un membre, ni une tablette, ni une clé d'API, ni une
 * automatisation. Un profil piégé est refusé ici, quoi que dise la page ; supprimer demande la confirmation.
 */
export function profilsLogicielsActions(scan: (nom: string, contenu: string) => string | undefined): Action[] {
  return [
    {
      id: 'profils_logiciels', label: 'Profils de logiciels', read: true, quick: false, proprietaireSeul: true,
      what: 'Les profils de logiciels (communs à la clé USB, au réseau et aux machines virtuelles) : logiciels par système, dans l\'ordre d\'installation, et tes scripts revérifiés par l\'antivirus',
      words: ['profils de logiciels', 'mes profils de logiciels'],
      run: (ctx) => {
        const lus = lireProfils(ctx), l = lus.liste;
        const abimes = lus.illisible ? 'Le fichier des profils est abîmé : il sera copié à part à la prochaine écriture.' : lus.abimes ? `${lus.abimes} profil(s) abîmé(s) laissé(s) de côté : ils seront copiés à part à la prochaine écriture.` : '';
        return { ok: true, text: [l.length ? l.map((p) => `- ${p.nom} : ${OS_PROFIL.map((os) => p.systemes[os].logiciels.length).reduce((a, b) => a + b, 0)} logiciel(s)`).join('\n') : 'Aucun profil de logiciels.', abimes].filter(Boolean).join('\n'), data: { ...vuProfils(l, scan), abimes: lus.illisible ? -1 : lus.abimes } };
      },
    },
    {
      id: 'profil_logiciels', label: 'Changer un profil de logiciels', quick: false, proprietaireSeul: true,
      what: 'Crée, enregistre, renomme, duplique ou supprime un profil de logiciels (commun à la clé USB, au réseau et aux machines virtuelles)',
      params: [{ key: 'op', label: 'Quoi (creer, enregistrer, renommer, dupliquer, supprimer)', kind: 'text', required: true }, { key: 'id', label: 'Profil', kind: 'text', default: '' }, { key: 'nom', label: 'Nom', kind: 'text', default: '' }, { key: 'systemes', label: 'Logiciels et scripts par système', kind: 'textarea' }],
      grave: (i, ctx) => {
        if (s(i.op) !== 'supprimer') return undefined;
        const p = ctx ? lireProfils(ctx).liste.find((x) => x.id === s(i.id)) : undefined;
        return `supprimer le profil de logiciels « ${p?.nom ?? s(i.id).slice(0, 40)} » (les clés déjà écrites ne changent pas)`;
      },
      run: (ctx, i) => {
        const op = s(i.op), lus = lireProfils(ctx), l = lus.liste, id = s(i.id), p = l.find((x) => x.id === id);
        const fini = (texte: string, liste: ProfilLogiciels[], choisi?: string) => {
          const copie = garderProfils(ctx, liste, lus);
          return { ok: true, text: copie ? `${texte} (Ce qui était abîmé dans l'ancien fichier est gardé à part : ${copie}.)` : texte, data: { ...vuProfils(liste, scan), abimes: 0, ...(choisi ? { choisi } : {}) } };
        };
        // « systemes » : un objet (ou son écriture JSON) ; enregistrer sans lui viderait le profil en silence → refusé.
        const recus = i.systemes === undefined || i.systemes === '' ? undefined : systemesRecus(i.systemes);
        if (i.systemes !== undefined && i.systemes !== '' && !recus) return { ok: false, text: 'Profil illisible : rien n\'a été changé.' };
        const nomLibre = (n: string, sauf?: string) => !l.some((x) => x.id !== sauf && x.nom.toLowerCase() === n.toLowerCase());
        const neuf = () => `p-${randomBytes(6).toString('hex')}`;
        const maintenant = ctx.now().getTime();
        if (op === 'creer') {
          const nom = nomProfilValide(i.nom);
          if (!nom) return { ok: false, text: NOM_FAUX };
          if (!nomLibre(nom)) return { ok: false, text: `Un profil s'appelle déjà « ${nom} ».` };
          if (l.length >= BORNES_PROFILS.profils) return { ok: false, text: `${BORNES_PROFILS.profils} profils au plus.` };
          const r = !recus ? { ok: true as const, valeur: systemesVides() } : systemesProfilRevus(recus, scan);
          if (!r.ok) return { ok: false, text: r.raison };
          const n: ProfilLogiciels = { id: neuf(), nom, systemes: r.valeur, cree: maintenant, modifie: maintenant };
          return fini(`Profil « ${nom} » créé.`, [...l, n], n.id);
        }
        if (!p) return { ok: false, text: 'Profil introuvable (relis la liste).' };
        if (op === 'enregistrer') {
          if (!recus) return { ok: false, text: 'Rien à enregistrer : envoie les logiciels et les scripts du profil (rien n\'a été changé).' };
          const r = systemesProfilRevus(recus, scan);
          if (!r.ok) return { ok: false, text: r.raison };
          return fini(`Profil « ${p.nom} » enregistré.`, l.map((x) => (x.id === id ? { ...x, systemes: r.valeur, modifie: maintenant } : x)), id);
        }
        if (op === 'renommer') {
          const nom = nomProfilValide(i.nom);
          if (!nom) return { ok: false, text: NOM_FAUX };
          if (!nomLibre(nom, id)) return { ok: false, text: `Un profil s'appelle déjà « ${nom} ».` };
          return fini(`Profil renommé « ${nom} ».`, l.map((x) => (x.id === id ? { ...x, nom, modifie: maintenant } : x)), id);
        }
        if (op === 'dupliquer') {
          if (l.length >= BORNES_PROFILS.profils) return { ok: false, text: `${BORNES_PROFILS.profils} profils au plus.` };
          const voulu = i.nom ? nomProfilValide(i.nom) : nomDeCopie(p.nom, l.map((x) => x.nom));
          if (!voulu) return { ok: false, text: NOM_FAUX };
          if (!nomLibre(voulu)) return { ok: false, text: `Un profil s'appelle déjà « ${voulu} ».` };
          // La copie repasse par l'antivirus : un script refusé depuis n'est pas recopié en silence.
          const r = systemesProfilRevus(p.systemes, scan);
          if (!r.ok) return { ok: false, text: r.raison };
          const n: ProfilLogiciels = { id: neuf(), nom: voulu, systemes: r.valeur, cree: maintenant, modifie: maintenant };
          return fini(`Profil « ${voulu} » créé à partir de « ${p.nom} ».`, [...l, n], n.id);
        }
        if (op === 'supprimer') return fini(`Profil « ${p.nom} » supprimé.`, l.filter((x) => x.id !== id));
        return { ok: false, text: 'Je ne sais pas faire ça avec un profil (creer, enregistrer, renommer, dupliquer, supprimer).' };
      },
    },
  ];
}
