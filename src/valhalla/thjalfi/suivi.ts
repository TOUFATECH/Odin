// Genèse · le suivi des installations par le réseau (PXE), du premier signe du poste jusqu'à la fin :
//   - chaque poste est reconnu (adresse MAC, nom s'il est connu, numéro de série, marque et modèle dits par iPXE) ;
//   - son déroulement est gardé étape par étape, avec l'heure, un avancement et un résultat final : terminée,
//     échouée (avec la raison), abandonnée (plus de signe de vie), annulée, bloquée, ou lancée à la main ;
//   - un poste peut être bloqué (il ne reçoit plus ni menu ni fichiers, avec un message clair sur son écran et
//     toujours son propre disque), toutes les nouvelles installations peuvent être suspendues, une installation en
//     cours peut être annulée ;
//   - un mot de passe d'installation peut être demandé au poste (voir cle.ts) ;
//   - tout va dans la base de l'appli (GENESE_ODIN) : une ligne par installation finie (journal « thjalfi ») et le
//     fil des événements (journal « thjalfi_etapes » : étapes, blocages, annulations, mots de passe refusés) ;
//   - Odin prévient : début, échec, abandon, poste inconnu, poste bloqué qui retente, mot de passe refusé 5 fois ;
//     ce qui arrive en nombre au même moment est regroupé en une seule notification (voir lots.ts).
// Le blocage par adresse MAC est un outil de gestion (un poste peut mentir sur son adresse) ; la vraie barrière
// contre quelqu'un de malveillant sur le réseau local est le mot de passe.
// Qui parle ? Chaque fiche garde les adresses IP d'où son poste a parlé (« ips ») : avant le chargement, celles qui
// ont reçu le menu ; une fois le noyau chargé, celle-là seulement. Un retour d'avancement, un fichier de réponses
// ou un fichier demandé sans adresse MAC n'est accepté que depuis ces adresses.
import { randomBytes } from 'node:crypto';
import type { Action, AlertIn, ModCtx, Section } from '../types.ts';
import { journalDe } from '../base/journal.ts';
import { ESSAIS_MAX, ESSAIS_MAX_IP, Essais, LONGUEUR_MIN, Passes, RALENTI, empreinte, menuFerme, refusMotDePasse, scriptAccepte, scriptRefus, scriptRefuse, tapeEnAzerty, verifier, type CleSecret, type Pour } from './cle.ts';
import { Lots, type Genre } from './lots.ts';
import { normMac } from './server.ts';

export type Resultat = 'fini' | 'échec' | 'sans nouvelles' | 'annulée' | 'bloquée' | 'lancée';
/** Ce que le suivi ajoute à la fiche vivante d'un poste (machines-en-cours.json). */
export interface Passage {
  /** l'identifiant de cette installation (un par passage du poste) */
  id?: string;
  serie?: string; uuid?: string; marque?: string; modele?: string;
  /** le nom du poste dans l'inventaire d'Odin (Atlas), s'il y est */
  nomConnu?: string;
  /** le nom saisi avec le mot de passe d'installation */
  installateur?: string;
  lancePar?: 'autorisation' | 'demande acceptée' | 'choix sur l\'écran' | 'menu';
  mode?: 'auto' | 'manuelle' | 'essai' | 'outil';
  recette?: string;
  /** octets de l'image envoyés au poste, et taille de l'image */
  octets?: number; taille?: number;
  /** dernier signe de vie (étape, fichier chargé, battement de l'installateur) */
  vie?: number;
  raison?: string; arretePar?: string;
  /** le début a été signalé */
  debutDit?: boolean;
  /** le résultat final quand il est plus précis que l'étape (annulée, bloquée, lancée à la main) */
  fin?: Resultat;
  /** les adresses IP d'où ce poste a parlé pendant ce passage ; « fige » : le noyau est chargé, elles ne changent plus */
  ips?: string[]; fige?: boolean;
  /** droit acquis au début (mot de passe donné, ou poste autorisé) : il tient jusqu'à la fin du passage, même si Odin redémarre */
  passe?: boolean;
  /** poste qui tourne en boucle (démarre, rate, redémarre) : nombre d'essais de cette installation */
  tours?: number;
  /** boucle : les étapes de ce tour ne vont pas dans le fil durable */
  muet?: boolean;
}
export interface Poste extends Passage { mac: string; ip?: string; fw?: string; iso?: string; isoName?: string; step: string; steps: Array<{ at: number; step: string; detail?: string }>; started: number; updated: number; host?: string; token?: string; profil?: string; logiciels?: Array<{ nom: string; ok: boolean }> }
/** Ce que le suivi ajoute à une ligne d'historique. */
export interface FicheFin { id?: string; debut?: number; etapes?: Array<{ at: number; etape: string; detail?: string }>; recette?: string; mode?: string; lancePar?: string; installateur?: string; serie?: string; uuid?: string; marque?: string; modele?: string; fw?: string; raison?: string; arretePar?: string; octets?: number; /** essais ratés à la suite (poste qui tourne en boucle) : une seule ligne pour tous */ tours?: number }
export interface Ligne extends FicheFin { at: number; mac: string; host?: string; ip?: string; iso: string; isoName: string; profil?: string; ms: number; result: Resultat; logiciels?: Array<{ nom: string; ok: boolean }> }
/** Une entrée du fil durable (journal « thjalfi_etapes »). */
export interface Evenement { at: number; quoi: 'étape' | 'début' | 'fin' | 'blocage' | 'déblocage' | 'annulation' | 'refus' | 'mot de passe refusé' | 'mot de passe accepté' | 'verrou' | 'suspension' | 'reprise' | 'poste inconnu' | 'réglage' | 'adresse'; mac?: string; id?: string; nom?: string; etape?: string; detail?: string }
interface Blocage { at: number; raison?: string; /** les adresses IP d'où ce poste a parlé (et quand) : refusées aussi tant qu'il est bloqué */ ips?: Record<string, number> }
interface Regle { mac: string; nom?: string; iso?: string; auto: boolean; fait?: boolean }

const FINALES = ['fini', 'sans nouvelles', 'échec'];
const LANCEES = ['chargement', 'installation', 'logiciels'];
/** Un poste qui change d'adresse IP en pleine installation n'est cru que si l'ancienne adresse se tait depuis ce délai. */
export const CHANGEMENT_MS = 3 * 60_000;
/** Un même poste qui rate au chargement de la même image, encore et encore : une seule installation tant que les essais se suivent à moins de 15 min. */
export const BOUCLE_MS = 15 * 60_000;
/** En boucle, la ligne d'historique est réécrite au plus toutes les 10 min (et une dernière fois quand la boucle s'arrête). */
const BOUCLE_ECRIT_MS = 10 * 60_000;
/** Au plus tant d'adresses MAC jamais vues par adresse IP et par heure : au-delà, ni menu ni fiche. */
export const NOUVEAUX_MAX = 10;
/** Mots de passe refusés en une heure, tous postes confondus, avant qu'Odin prévienne et ralentisse. */
export const REFUS_MAX = 10;
const s = (x: unknown) => (typeof x === 'string' ? x : x === undefined || x === null ? '' : String(x));
const vrai = (x: unknown) => x === true || x === 'true';
const pl = (n: number, mot: string, pluriel = `${mot}s`) => `${n} ${n > 1 ? pluriel : mot}`;
const minutes = (ms: number) => Math.max(0, Math.round(ms / 60_000));
const duree = (ms: number) => { const m = minutes(ms); return m < 1 ? 'moins d\'une minute' : m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}`; };
export const LIBELLE: Record<Resultat, string> = { fini: 'terminée', 'échec': 'échouée', 'sans nouvelles': 'abandonnée', 'annulée': 'annulée', 'bloquée': 'bloquée', 'lancée': 'lancée à la main' };
const ICONE: Record<Resultat, string> = { fini: '✅', 'échec': '❌', 'sans nouvelles': '❔', 'annulée': '✋', 'bloquée': '🚫', 'lancée': '▶' };
/** Le texte d'un résultat dans un tableau. Pur. */
export const libelle = (r: string, l?: { logiciels?: Array<{ ok: boolean }>; tours?: number }) => `${ICONE[r as Resultat] ?? '❔'} ${LIBELLE[r as Resultat] ?? r}${r === 'fini' && l?.logiciels?.some((x) => !x.ok) ? ' (logiciels ratés)' : ''}${r === 'échec' && (l?.tours ?? 1) > 1 ? ` (${l!.tours} essais)` : ''}`;
/** Un résultat qui compte comme un raté (une installation lancée à la main, annulée ou bloquée n'en est pas un). Pur. */
export const rate = (r: string) => r === 'échec' || r === 'sans nouvelles';

// ---------------- Ce que dit le poste : à nettoyer, jamais recopié dans un script ----------------
/** Un texte venu du poste : caractères simples seulement, longueur bornée. Pur. */
export function nettoyer(x: unknown, max = 64): string {
  return s(x).normalize('NFC').replace(/[^\p{L}\p{N} ._()/+#:,'-]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}
const RAISONS: Record<string, string> = { ubuntu: 'l\'installateur d\'Ubuntu a signalé une erreur (elle est affichée sur l\'écran du poste)', kickstart: 'l\'installateur (Anaconda) a signalé une erreur (elle est affichée sur l\'écran du poste)', partage: 'le partage réseau des fichiers de Windows ne répond pas', setup: 'l\'installateur de Windows (setup.exe) s\'est arrêté sur une erreur' };
/** La raison d'un échec dite par le poste : un code connu devient une phrase, tout autre texte est nettoyé et borné. Pur. */
export const raisonLisible = (x: unknown) => { const v = s(x).trim(); return RAISONS[v] ?? (nettoyer(v, 200) || 'échec signalé par le poste'); };
const BIDON =/^(to be filled by o\.?e\.?m\.?|default string|system serial number|system product name|system manufacturer|system version|chassis serial number|base board serial number|not specified|not applicable|not available|none|null|n\/a|na|unknown|inconnu|invalid|empty|oem|o\.e\.m\.|serial|[0x.\- ]+|0?123456789|1234567890)$/i;
const UUID_BIDON = /^(0{8}-0{4}-0{4}-0{4}-0{12}|f{8}-f{4}-f{4}-f{4}-f{12}|03000200-0400-0500-0006-000700080009)$/i;
/** Série, UUID, marque et modèle dits par iPXE dans l'adresse du menu ; les valeurs bidon des cartes mères sont ignorées. Pur. */
export function identite(q: URLSearchParams): { serie?: string; uuid?: string; marque?: string; modele?: string } {
  const out: { serie?: string; uuid?: string; marque?: string; modele?: string } = {};
  for (const k of ['serie', 'marque', 'modele'] as const) { const v = nettoyer(q.get(k), k === 'serie' ? 40 : 60); if (v && !BIDON.test(v) && !/\$\{/.test(q.get(k) ?? '')) out[k] = v; }
  const u = s(q.get('uuid')).trim().toLowerCase(); if (/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(u) && !UUID_BIDON.test(u)) out.uuid = u;
  return out;
}

// ---------------- Avancement ----------------
const RANG: Record<string, number> = { 'démarrage réseau': 2, chargeur: 5, menu: 8, chargement: 10, installation: 50, logiciels: 85, fini: 100 };
/** Où en est le poste : un pourcentage qui ne recule pas, et la part réelle de l'image déjà envoyée quand elle est calculable. Pur. */
export function avancement(m: Poste): { pct: number; reel: boolean; image?: { octets: number; taille: number; pct: number } } {
  const dernier = FINALES.includes(m.step) ? [...m.steps].reverse().find((x) => !FINALES.includes(x.step))?.step ?? m.step : m.step;
  const image = m.taille && m.taille > 0 && m.octets !== undefined ? { octets: m.octets, taille: m.taille, pct: Math.min(100, Math.round((m.octets / m.taille) * 100)) } : undefined;
  let pct = RANG[dernier] ?? 0;
  if (dernier === 'chargement' && image) pct = 10 + Math.round(Math.min(1, image.octets / image.taille) * 30);
  return { pct: m.step === 'fini' ? 100 : pct, reel: dernier === 'chargement' && Boolean(image), ...(image ? { image } : {}) };
}
/** L'état d'un poste, en clair. Pur. */
export function etatDe(m: Poste): string {
  if (!FINALES.includes(m.step)) return LANCEES.includes(m.step) ? 'en cours' : 'au menu';
  // « fini » l'emporte toujours (un « fini » arrivé après un abandon déclaré : l'installation a réussi).
  if (m.step === 'fini') return LIBELLE.fini;
  if (m.fin) return LIBELLE[m.fin];
  if (m.step === 'échec') return LIBELLE['échec'];
  return 'repartie sur son disque';
}

// ---------------- Historique : repli, filtres, rapport, CSV ----------------
/** Une installation = une ligne : si elle en a écrit deux (un « fini » arrivé après un abandon), la dernière gagne. Pur. */
export function replier<T extends { id?: string }>(l: T[]): T[] {
  const dernier = new Map<string, number>(); l.forEach((x, i) => { if (x.id) dernier.set(x.id, i); });
  return l.filter((x, i) => !x.id || dernier.get(x.id) === i);
}
export const PERIODES: Record<string, number> = { '7 jours': 7, '30 jours': 30, '90 jours': 90, tout: 0 };
export const RESULTATS: Record<string, Resultat | undefined> = { tous: undefined, 'réussies': 'fini', 'échecs': 'échec', abandons: 'sans nouvelles', 'annulées': 'annulée', 'bloquées': 'bloquée', 'lancées à la main': 'lancée' };
export interface Rapport { periode: string; total: number; reussies: number; echecs: number; abandons: number; annulees: number; bloquees: number; lancees: number; /** part de réussite parmi les installations suivies jusqu'au bout (réussies, échouées, abandonnées) */ taux?: number; dureeMoyenneMs?: number; parImage: Array<{ image: string; total: number; reussies: number }>; lignes: Ligne[]; texte: string }
/** Le rapport d'une période : totaux, taux de réussite, durée moyenne, par image, et une phrase lisible à voix haute. Pur. */
export function rapport(toutes: Ligne[], o: { now: number; periode?: string; resultat?: string; q?: string }): Rapport {
  const periode = o.periode && o.periode in PERIODES ? o.periode : '30 jours', jours = PERIODES[periode], voulu = RESULTATS[o.resultat ?? 'tous'], q = s(o.q).trim().toLowerCase();
  const nom = (l: Ligne) => l.host || l.mac;
  let l = replier(toutes).filter((x) => !jours || o.now - x.at < jours * 864e5);
  if (q) l = l.filter((x) => [x.mac, x.host, x.ip, x.isoName, x.iso, x.serie, x.modele, x.marque, x.installateur].some((v) => v?.toLowerCase().includes(q)));
  const n = (r: Resultat) => l.filter((x) => x.result === r).length;
  const reussies = n('fini'), echecs = n('échec'), abandons = n('sans nouvelles'), annulees = n('annulée'), bloquees = n('bloquée'), lancees = n('lancée'), suivies = reussies + echecs + abandons;
  const finies = l.filter((x) => x.result === 'fini'), parImage = new Map<string, { image: string; total: number; reussies: number }>();
  for (const x of l) { const p = parImage.get(x.isoName) ?? { image: x.isoName, total: 0, reussies: 0 }; p.total++; if (x.result === 'fini') p.reussies++; parImage.set(x.isoName, p); }
  const postes = (r: Resultat) => { const p = [...new Set(l.filter((x) => x.result === r).map(nom))]; return p.length <= 3 ? p.join(', ') : `${p.slice(0, 3).join(', ')} et ${p.length - 3} autre(s)`; };
  const quand = jours ? `sur les ${jours} derniers jours` : 'en tout';
  const parts = [`${pl(reussies, 'réussie')}`, ...(echecs ? [`${pl(echecs, 'échec')} sur ${echecs > 1 ? 'les postes' : 'le poste'} ${postes('échec')}`] : []), ...(abandons ? [`${pl(abandons, 'abandonnée')} (${postes('sans nouvelles')})`] : []), ...(annulees ? [`${pl(annulees, 'annulée')}`] : []), ...(bloquees ? [`${pl(bloquees, 'bloquée')}`] : []), ...(lancees ? [`${lancees} lancée(s) à la main (suite inconnue)`] : [])];
  const moy = finies.length ? Math.round(finies.reduce((a, x) => a + x.ms, 0) / finies.length) : undefined;
  const texte = l.length ? `${pl(l.length, 'installation')} ${quand} : ${parts.join(', ')}.${suivies ? ` Réussite : ${Math.round((reussies / suivies) * 100)} %.` : ''}${moy !== undefined ? ` Durée moyenne d'une installation réussie : ${duree(moy)}.` : ''}` : `Aucune installation ${quand}${q ? ` pour « ${q} »` : ''}.`;
  return { periode, total: l.length, reussies, echecs, abandons, annulees, bloquees, lancees, ...(suivies ? { taux: Math.round((reussies / suivies) * 100) } : {}), ...(moy !== undefined ? { dureeMoyenneMs: moy } : {}), parImage: [...parImage.values()].sort((a, b) => b.total - a.total), lignes: (voulu ? l.filter((x) => x.result === voulu) : l).slice().reverse(), texte };
}
/** L'historique pour un tableur (séparateur « ; »). Une cellule qui commencerait par = + - @ est neutralisée. Pur. */
export function csv(l: Ligne[]): string {
  const c = (v: unknown) => { let t = s(v).replace(/[\r\n]+/g, ' '); if (/^[=+\-@\t]/.test(t)) t = `'${t}`; return /[";]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
  const d = (t?: number) => (t ? new Date(t).toISOString().replace('T', ' ').slice(0, 19) : '');
  const tete = ['Fin (UTC)', 'Début (UTC)', 'Poste', 'Adresse MAC', 'Adresse IP', 'Numéro de série', 'Marque', 'Modèle', 'Image', 'Recette', 'Mode', 'Lancée par', 'Installateur', 'Durée (min)', 'Résultat', 'Raison', 'Arrêtée par'];
  return `${[tete, ...l.map((x) => [d(x.at), d(x.debut), x.host ?? '', x.mac, x.ip ?? '', x.serie ?? '', x.marque ?? '', x.modele ?? '', x.isoName, x.recette ?? '', x.mode ?? '', x.lancePar ?? '', x.installateur ?? '', String(minutes(x.ms)), LIBELLE[x.result] ?? x.result, x.raison ?? '', x.arretePar ?? ''])].map((r) => r.map(c).join(';')).join('\r\n')}\r\n`;
}

// ---------------- La fabrique : branchée sur le module par ses accès ----------------
export interface SuiviDeps {
  live(ctx: ModCtx): Record<string, Poste>;
  saveLive(ctx: ModCtx, m: Record<string, Poste>): void;
  rules(ctx: ModCtx): Regle[];
  sessions(ctx: ModCtx): Record<string, { mac: string; iso: string; fin?: number }>;
  saveSessions(ctx: ModCtx, x: Record<string, { mac: string; iso: string; fin?: number }>): void;
  hist(ctx: ModCtx): { tout(): Ligne[] };
  secrets(ctx: ModCtx): Record<string, unknown>;
  saveSecrets(ctx: ModCtx, x: Record<string, unknown>): void;
  /** note une étape (celle du module : fiche vivante, événement « etape ») */
  track(ctx: ModCtx, mac: string | undefined, ip: string | undefined, step: string, o?: { detail?: string }): Poste | undefined;
  /** écrit la ligne d'historique d'un passage terminé */
  finish(ctx: ModCtx, m: Poste, result: Resultat): void;
  isoName(id: string): string;
  /** ce qu'on sait d'une image : sa recette, si elle s'installe seule, sa famille, sa taille */
  infoIso?(id: string): { recette?: string; auto?: boolean; os?: string; taille?: number } | undefined;
  /** l'adresse du serveur des postes (http://ip:port) */
  base(ctx: ModCtx): string;
  /** l'habillage du menu texte (lignes iPXE déjà prêtes) */
  look?(ctx: ModCtx): string[] | undefined;
  /** coupe les connexions HTTP ouvertes par cette adresse */
  couper?(ip: string): void;
}

export function suivi(d: SuiviDeps) {
  const essais = new Essais(), passes = new Passes();
  /** ce que les postes ont dit d'eux en demandant le menu (posé sur la fiche à l'étape suivante) */
  const dits = new Map<string, ReturnType<typeof identite>>();
  /** les noms trouvés dans l'inventaire d'Odin (relus au plus toutes les 10 min) */
  const noms = new Map<string, { nom?: string; at: number }>();
  /** les adresses dont l'installation a été arrêtée : plus rien ne leur est servi (30 min, ou jusqu'au redémarrage du poste) */
  const coupees = new Map<string, { mac: string; jusqua: number }>();
  const dejaNote = new Map<string, string>(), refusNote = new Map<string, number>();
  /** les débuts récents de chaque poste : un poste qui tourne en boucle (démarre, rate, redémarre) n'est pas annoncé à chaque tour */
  const debuts = new Map<string, number[]>();
  const fil = (ctx: ModCtx) => journalDe<Evenement>(ctx, 'thjalfi_etapes', 'etapes.jsonl', { garder: 3000 });
  const noter = (ctx: ModCtx, e: Omit<Evenement, 'at'>) => { try { fil(ctx).ajouter({ at: ctx.now().getTime(), ...e }); } catch { /* disque plein : le suivi continue */ } };
  /** l'heure où ce suivi a commencé (démarrage d'Odin) : le silence d'un poste ne se compte pas pendant qu'Odin était arrêté */
  let depart: number | undefined;
  const t = (ctx: ModCtx) => { const n = ctx.now().getTime(); depart ??= n; return n; };
  /** les notifications regroupées (lots.ts) */
  let dernierCtx: ModCtx | undefined;
  // Tout ce qui passe ici (début, fin, échec, abandon, poste inconnu, et leurs lots) relève du lien écrit de Genèse.
  const lots = new Lots((a) => { dernierCtx?.alert({ ...a, lien: 'thjalfi-alerte-installation' }); });
  const prevenir = (ctx: ModCtx, genre: Genre, nom: string, a: AlertIn) => { dernierCtx = ctx; lots.dire(genre, nom, a, t(ctx)); };
  /** « postes non autorisés seulement » : l'adresse IP d'où chaque poste autorisé passe sans mot de passe (une seule, 12 h) */
  const exemptes = new Map<string, { ip: string; at: number }>();
  /** les adresses MAC jamais vues, par adresse IP (une heure) */
  const nouveaux = new Map<string, Map<string, number>>();
  /** les mots de passe refusés : l'heure de chacun (tous postes), et les adresses MAC essayées par chaque adresse IP */
  let refusCle: number[] = []; const macsEssayees = new Map<string, Map<string, number>>();
  let fileRalentie: Promise<void> = Promise.resolve();
  /** les postes qui tournent en boucle (même image qui ne démarre pas) : une seule installation, un compte d'essais */
  const boucles = new Map<string, { id: string; iso: string; debut: number; tours: number; dernier: number; ecritA: number; attend?: Poste }>();
  const adressesDe = (m: Poste | undefined): string[] => (m ? m.ips ?? (m.ip ? [m.ip] : []) : []);

  const bloques = (ctx: ModCtx) => (ctx.settings.bloques as Record<string, Blocage> | undefined) ?? {};
  const suspendu = (ctx: ModCtx) => { const x = ctx.settings.suspendu as { at?: number } | undefined | false; return x && typeof x === 'object' ? { at: Number(x.at) || 0 } : undefined; };
  /** Le mot de passe d'installation est-il demandé ? (le réglage ne contient jamais le mot de passe ni son empreinte) */
  const cleCfg = (ctx: ModCtx): { pour: Pour; depuis: number } | undefined => { const c = ctx.settings.cle as { actif?: boolean; pour?: string; depuis?: number } | undefined | false; return c && c.actif ? { pour: c.pour === 'inconnus' ? 'inconnus' : 'toutes', depuis: Number(c.depuis) || 0 } : undefined; };
  /** Sans signe de vie depuis ce délai (réglable, 30 min au départ), une installation est dite abandonnée. */
  const abandonMs = (ctx: ModCtx) => Math.max(5, Math.min(720, Number(ctx.settings.abandon) || 30)) * 60_000;
  const regle = (ctx: ModCtx, mac: string) => d.rules(ctx).find((r) => r.mac === mac);
  const nomDe = (ctx: ModCtx, mac: string, m?: Poste) => regle(ctx, mac)?.nom ?? m?.host ?? m?.nomConnu ?? noms.get(mac)?.nom;
  const titre = (ctx: ModCtx, mac: string, m?: Poste) => nomDe(ctx, mac, m) ?? `poste inconnu ${mac}`;
  const lance = (m: Poste | undefined) => Boolean(m && LANCEES.includes(m.step));
  /** Change la fiche vivante d'un poste (si elle existe) et l'enregistre. */
  const maj = (ctx: ModCtx, mac: string, f: (m: Poste) => void): Poste | undefined => { const all = d.live(ctx), m = all[mac]; if (!m) return undefined; f(m); d.saveLive(ctx, all); return m; };
  /** Ajoute un détail à l'étape en cours, sans le répéter. */
  // (L'adresse du demandeur n'est pas posée sur la fiche : un refus, ou un détail, ne fait pas de lui « le poste ».)
  const dire = (ctx: ModCtx, mac: string, _from: string | undefined, detail: string) => { const m = d.live(ctx)[mac]; if (m && !FINALES.includes(m.step) && m.steps.at(-1)?.detail !== detail) d.track(ctx, mac, undefined, m.step, { detail }); };
  /** Ratés (échec ou abandon) de ce poste dans les dernières 24 h, sans compter l'installation `sauf` (celle dont on parle). */
  const ratesRecents = (ctx: ModCtx, mac: string, sauf?: string) => { const now = t(ctx); try { return replier(d.hist(ctx).tout()).filter((h) => h.mac === mac && rate(h.result) && now - h.at < 864e5 && (!sauf || h.id !== sauf)).length; } catch { return 0; } };
  /** Une fiche encore utile à son poste : en cours, ou close par la surveillance après son lancement (le poste peut vivre encore), 6 h au plus. */
  const tardive = (m: Poste, now: number) => FINALES.includes(m.step) && (m.fin === 'sans nouvelles' || m.fin === 'lancée') && now - Math.max(m.updated, m.vie ?? 0) < 6 * 3600_000;
  /** L'adresse IP à garder sur une fiche (appelé par le module à chaque étape) : une fois le noyau chargé, elle ne suit plus le premier venu qui cite l'adresse MAC. */
  function adresse(m: Poste, ip: string): void {
    if (m.fige) { if (m.step === 'fini' || m.ips?.includes(ip)) m.ip = ip; return; }
    m.ip = ip;
    if (LANCEES.includes(m.step)) { m.ips = [ip]; m.fige = true; } else m.ips = [...(m.ips ?? []).filter((x) => x !== ip), ip].slice(-4);
  }
  /** Les fiches à garder (200 au plus) : jamais une installation en cours n'est chassée par des postes qui ne font que demander le menu. */
  function garder<T extends Poste>(l: T[]): T[] {
    const recent = (a: T, b: T) => Math.max(b.updated, b.vie ?? 0) - Math.max(a.updated, a.vie ?? 0);
    const enCours = l.filter((m) => lance(m)).sort(recent).slice(0, 400);
    return [...enCours, ...l.filter((m) => !lance(m)).sort(recent).slice(0, Math.max(0, 200 - enCours.length))];
  }
  /** Trop d'adresses MAC jamais vues depuis la même adresse IP en une heure (quelqu'un en change à chaque demande) : les suivantes n'ont ni menu ni fiche. */
  function tropDeNouveaux(ctx: ModCtx, mac: string, from: string, now: number): boolean {
    if (!from || regle(ctx, mac) || noms.get(mac)?.nom || d.live(ctx)[mac]) return false;
    let l = nouveaux.get(from); if (!l) { l = new Map(); if (nouveaux.size > 500) nouveaux.clear(); nouveaux.set(from, l); }
    for (const [k, at] of l) if (now - at > 3600_000) l.delete(k);
    if (l.has(mac)) return false;
    if (l.size < NOUVEAUX_MAX) { l.set(mac, now); return false; }
    ctx.alert({ level: 'haute', title: `🚧 Trop de postes inconnus depuis l'adresse ${from}`, detail: `Plus de ${NOUVEAUX_MAX} adresses MAC jamais vues en une heure depuis ${from} : quelqu'un change d'adresse MAC à chaque demande (ou plusieurs postes passent par la même adresse). Odin ne répond plus aux nouvelles adresses MAC de cette adresse pendant une heure : ni menu, ni fiche, ni notification par poste.`, key: `thjalfi-flot-${from}`, data: { ip: from }, steps: ['Cherche l\'appareil qui a cette adresse IP (Atlas, ou ta box).', 'Si ce sont de vrais postes derrière un routeur : autorise-les dans Genèse, ils ne sont alors plus comptés.'] });
    return true;
  }
  /** L'adresse d'un poste bloqué (il y a moins de 24 h) : refusée aussi quand la demande ne donne pas d'adresse MAC, ou en donne une jamais vue avant le blocage. */
  function bloqueParIp(ctx: ModCtx, from: string, now: number, mac?: string): string | undefined {
    if (!from) return undefined;
    const b = Object.entries(bloques(ctx)).find(([, x]) => now - (x.ips?.[from] ?? 0) < 864e5); if (!b) return undefined;
    if (mac && mac !== b[0]) { const vu = (ctx.settings.vus as Record<string, number> | undefined)?.[mac]; if (regle(ctx, mac) || (vu && vu < b[1].at)) return undefined; }
    return b[0];
  }
  /** Garde l'adresse IP d'où un poste bloqué parle (réécrit au plus toutes les 10 min, 8 adresses au plus). */
  function adresseBloquee(ctx: ModCtx, mac: string, ips: string[], now: number): void {
    const all = bloques(ctx), b = all[mac]; if (!b) return;
    const neuves = ips.filter((ip) => ip && now - (b.ips?.[ip] ?? 0) > 600_000); if (!neuves.length) return;
    const l = Object.entries({ ...b.ips, ...Object.fromEntries(neuves.map((ip) => [ip, now])) }).sort((x, y) => y[1] - x[1]).slice(0, 8);
    ctx.saveSettings({ bloques: { ...all, [mac]: { ...b, ips: Object.fromEntries(l) } } });
  }
  /** Des fichiers d'installation demandés sans adresse MAC depuis une adresse qu'Odin ne connaît pas : refusé, noté (au plus toutes les 10 min) et signalé. */
  function sansAdresse(ctx: ModCtx, from: string, quoi: string): void {
    const now = t(ctx); if (now - (refusNote.get(`ip:${from}`) ?? 0) < 600_000) return;
    if (refusNote.size > 500) refusNote.clear(); refusNote.set(`ip:${from}`, now);
    noter(ctx, { quoi: 'refus', detail: `${quoi} demandé sans adresse MAC depuis ${from} (aucun poste connu à cette adresse)` });
    ctx.alert({ level: 'moyenne', title: `🚫 Demande sans adresse MAC refusée (${from})`, detail: `${quoi} demandé depuis ${from} sans dire quel poste c'est, et aucun poste en cours n'a cette adresse. Odin n'a rien servi : une installation ne part jamais hors du suivi.`, key: `thjalfi-sans-adresse-${from}`, data: { ip: from } });
  }

  /** Le nom du poste dans l'inventaire d'Odin (Atlas), cherché une fois de temps en temps, sans jamais bloquer le menu. */
  async function chercherNom(ctx: ModCtx, mac: string): Promise<void> {
    const now = t(ctx), c = noms.get(mac); if (c && now - c.at < 600_000) return;
    noms.set(mac, { nom: c?.nom, at: now }); if (noms.size > 1000) noms.delete(noms.keys().next().value!);
    try {
      const r = await ctx.call('askr', 'chercher', { q: mac }, 'reconnaître le poste qui démarre par le réseau', { interne: true });
      const n = r.ok === false ? '' : nettoyer((r.data as Array<{ nom?: string }> | undefined)?.[0]?.nom, 63);
      if (n) { noms.set(mac, { nom: n, at: now }); maj(ctx, mac, (m) => { m.nomConnu = n; }); }
    } catch { /* Atlas absent : le poste reste « inconnu » */ }
  }
  /** Un poste jamais vu qui demande le menu : Odin le dit une seule fois. */
  function premiereFois(ctx: ModCtx, mac: string, from: string): void {
    const vus = { ...((ctx.settings.vus as Record<string, number> | undefined) ?? {}) }; if (vus[mac]) return;
    const now = t(ctx); vus[mac] = now;
    ctx.saveSettings({ vus: Object.fromEntries(Object.entries(vus).sort((a, b) => b[1] - a[1]).slice(0, 1000)) });
    let passe = false; try { passe = d.hist(ctx).tout().some((h) => h.mac === mac); } catch { /* historique illisible */ }
    if (regle(ctx, mac) || noms.get(mac)?.nom || passe) return;
    const i = dits.get(mac), quoi = [i?.marque, i?.modele].filter(Boolean).join(' '), cle = cleCfg(ctx);
    noter(ctx, { quoi: 'poste inconnu', mac, detail: `adresse ${from}${quoi ? ` · ${quoi}` : ''}${i?.serie ? ` · série ${i.serie}` : ''}` });
    prevenir(ctx, 'inconnu', mac, { level: 'info', title: `🆕 Poste inconnu au démarrage réseau : ${mac}`, detail: `Adresse ${from}${quoi ? ` · ${quoi}` : ''}${i?.serie ? ` · série ${i.serie}` : ''}. ${bloques(ctx)[mac] ? 'Il est bloqué : il démarre sur son disque.' : cle ? 'Il doit donner le mot de passe d\'installation pour installer un système.' : 'Il a le menu, et démarre sur son disque si personne ne choisit.'}`, key: `thjalfi-inconnu-${mac}`, data: { mac }, steps: ['Si c\'est un de tes postes : rien à faire, ou autorise-le dans Genèse.', 'Sinon : bloque-le dans Genèse (onglet Installations).'] });
  }

  /** Le poste demande le menu : ce qu'il dit de lui est gardé ; « echec=1 » : l'image choisie n'a pas démarré. */
  function vu(ctx: ModCtx, mac: string, q: URLSearchParams, from: string): void {
    if (!mac || tropDeNouveaux(ctx, mac, from, t(ctx))) return;
    const i = identite(q); if (Object.keys(i).length) { dits.set(mac, i); if (dits.size > 1000) dits.delete(dits.keys().next().value!); }
    void chercherNom(ctx, mac).then(() => premiereFois(ctx, mac, from)).catch(() => undefined);
    const m = d.live(ctx)[mac]; if (!m || FINALES.includes(m.step)) return;
    // Seul le poste lui-même (l'adresse d'où il a chargé) est cru : un autre qui cite son adresse MAC ne marque rien.
    if (!adressesDe(m).includes(from)) return;
    if (q.get('echec') !== '1') {
      // En pleine installation, le poste redemande le menu (Windows redémarre plusieurs fois) : noté avec l'heure, rien n'est clos.
      if (lance(m)) dire(ctx, mac, from, 'le poste a redemandé le menu');
      return;
    }
    if (m.step === 'chargement') { const x = d.track(ctx, mac, from, 'échec', { detail: 'l\'image n\'a pas pu démarrer sur le poste (signalé par iPXE)' }); if (x) echec(ctx, x); }
    else dire(ctx, mac, from, 'l\'image choisie n\'a pas démarré : retour au menu');
  }

  /** Appelé par le module à chaque étape, juste avant d'enregistrer la fiche : identité, début, fil durable. */
  function apres(ctx: ModCtx, m: Poste, step: string, o: { detail?: string } = {}): void {
    const now = t(ctx);
    const id = (m.id ??= `${m.mac.replace(/:/g, '')}-${m.started.toString(36)}-${randomBytes(2).toString('hex')}`);
    m.vie = now;
    // La même étape deux fois au même instant (« menu », puis « menu · installation automatique prévue ») : une seule ligne, avec le détail.
    if (m.steps.length >= 2) { const e1 = m.steps.at(-2)!, e2 = m.steps.at(-1)!; if (e1.step === e2.step && !e1.detail && e2.detail && e2.at - e1.at < 2000) m.steps.splice(-2, 1); }
    // Une étape arrive sur un passage que la surveillance (ou un arrêt) avait clos : il n'est plus clos. « fini » : l'installation a réussi.
    if (!FINALES.includes(m.step)) { if (m.fin) { delete m.fin; delete m.raison; delete m.arretePar; } }
    else if (m.step === 'fini') { m.fin = 'fini'; delete m.raison; delete m.arretePar; }
    const i = dits.get(m.mac); if (i) Object.assign(m, i);
    const n = noms.get(m.mac)?.nom; if (n) m.nomConnu = n;
    const p = passes.de(m.mac, now); if (p?.qui) m.installateur = p.qui;
    if (p && m.ip && p.ips.includes(m.ip) && step === 'menu' && m.steps.length === 1 && !m.steps[0].detail) m.steps[0].detail = `mot de passe accepté${p.qui ? ` (${p.qui})` : ''}`;
    // Le droit d'installer (mot de passe donné depuis cette adresse, ou poste autorisé) est posé sur la fiche : il tient jusqu'à
    // la fin de CE passage, même si le laissez-passer tombe (20 min sans rien charger) ou si Odin redémarre.
    if (!m.passe && cleCfg(ctx) && m.ip && !FINALES.includes(m.step) && (p?.ips.includes(m.ip) || exemptes.get(m.mac)?.ip === m.ip)) m.passe = true;
    // Poste qui tourne en boucle (déjà deux essais ratés à la suite) : ce tour ne remplit pas le fil durable.
    const b = boucles.get(m.mac), boucle = Boolean(b && now - b.dernier < BOUCLE_MS && b.tours >= 2);
    if (boucle && !LANCEES.includes(step) && !FINALES.includes(step) && m.steps.length <= 1) m.muet = true;
    if (m.muet && (!boucle || (m.iso && m.iso !== b!.iso) || ['installation', 'logiciels', 'fini'].includes(step))) {
      delete m.muet;
      if (m.debutDit) noter(ctx, { quoi: 'début', mac: m.mac, id, nom: nomDe(ctx, m.mac, m), detail: `${m.isoName ?? m.iso ?? '?'} · après ${pl(b?.tours ?? 2, 'essai raté', 'essais ratés')} à la suite` });
    }
    const det = o.detail ?? '';
    if (/^installation automatique prévue/.test(det)) { if (m.lancePar !== 'demande acceptée') m.lancePar = 'autorisation'; }
    else if (/^accord donné/.test(det)) m.lancePar = 'demande acceptée';
    else if (/^choisi sur l'écran/.test(det)) { m.lancePar = 'choix sur l\'écran'; if (/\(essai\)$/.test(det)) m.mode = 'essai'; }
    if (step === 'chargement' && !m.debutDit && m.iso) {
      m.debutDit = true;
      const info = d.infoIso?.(m.iso), r = regle(ctx, m.mac);
      let auto = false; try { auto = Boolean(m.token) && Object.entries(d.sessions(ctx)).some(([jeton, x]) => jeton === m.token && x.iso === m.iso); } catch { /* fichier illisible */ }
      if (info?.recette) m.recette = info.recette; if (info?.taille) m.taille = info.taille;
      m.mode = auto ? 'auto' : m.mode === 'essai' ? 'essai' : info?.os === 'outil' ? 'outil' : info && !info.auto ? 'essai' : 'manuelle';
      if (auto) { if (m.lancePar !== 'demande acceptée') m.lancePar = 'autorisation'; } else if (m.lancePar !== 'choix sur l\'écran') m.lancePar = 'menu';
      const inconnu = !r && !m.nomConnu, image = m.isoName ?? d.isoName(m.iso), qui = m.installateur ? ` · par ${m.installateur}` : '';
      const facon = m.mode === 'auto' ? 'installation automatique (le disque est effacé)' : m.mode === 'manuelle' ? 'installation à la main (Odin ne saura pas quand elle finit)' : m.mode === 'essai' ? 'système démarré pour un essai' : 'outil démarré';
      if (!m.muet) noter(ctx, { quoi: 'début', mac: m.mac, id: m.id, nom: nomDe(ctx, m.mac, m), detail: `${image} · ${m.mode} · lancée par : ${m.lancePar}${qui}` });
      const recents = [...(debuts.get(m.mac) ?? []).filter((x) => now - x < 15 * 60_000), now]; if (debuts.size > 500) debuts.clear(); debuts.set(m.mac, recents);
      if (recents.length <= 2) prevenir(ctx, 'début', inconnu ? m.mac : titre(ctx, m.mac, m), { level: inconnu ? 'moyenne' : 'info', title: `▶ ${inconnu ? `Un poste inconnu (${m.mac})` : titre(ctx, m.mac, m)} démarre ${image}`, detail: `Poste ${m.mac}${m.ip ? ` · ${m.ip}` : ''}${m.modele ? ` · ${[m.marque, m.modele].filter(Boolean).join(' ')}` : ''} · ${facon} · lancée par : ${m.lancePar}${qui}.`, key: `thjalfi-debut-${m.id}`, data: { mac: m.mac, id: m.id }, ...(inconnu ? { steps: ['Si ce n\'est pas toi : annule ou bloque ce poste dans Genèse (onglet Installations).', 'Pour qu\'un poste doive donner un mot de passe avant d\'installer : onglet Protection.'] } : {}) });
    }
    const last = m.steps.at(-1);
    if (last && !m.muet) {
      const sig = `${last.at}|${last.step}|${last.detail ?? ''}`;
      if (dejaNote.get(id) !== sig) { if (dejaNote.size > 500) dejaNote.clear(); dejaNote.set(id, sig); noter(ctx, { quoi: FINALES.includes(last.step) ? 'fin' : 'étape', mac: m.mac, id, nom: nomDe(ctx, m.mac, m), etape: last.step, ...(last.detail ? { detail: last.detail } : {}) }); }
    }
  }
  /** Ce qu'une fiche vivante apporte à sa ligne d'historique. */
  function fiche(m: Poste): FicheFin {
    const x: FicheFin = { id: m.id, debut: m.started, etapes: m.steps.map((e) => ({ at: e.at, etape: e.step, ...(e.detail ? { detail: e.detail } : {}) })), recette: m.recette, mode: m.mode, lancePar: m.lancePar, installateur: m.installateur, serie: m.serie, uuid: m.uuid, marque: m.marque, modele: m.modele, fw: m.fw, raison: m.raison, arretePar: m.arretePar, octets: m.octets, tours: (m.tours ?? 1) > 1 ? m.tours : undefined };
    return Object.fromEntries(Object.entries(x).filter(([, v]) => v !== undefined && v !== '')) as FicheFin;
  }

  /**
   * Une installation a raté (signalé par le poste) : historique, et Odin prévient avec la vraie raison. Le premier raté
   * d'un poste est un souci, le deuxième en 24 h est grave ; les suivants (poste qui tourne en boucle) s'ajoutent au même
   * avertissement au lieu d'en ouvrir un à chaque tour.
   */
  function echec(ctx: ModCtx, m: Poste): void {
    // Ce passage a déjà dit son échec (le poste le redit, ou quelqu'un rejoue son retour) : ni deuxième ligne, ni deuxième alerte.
    if (m.fin === 'échec') return;
    const now = t(ctx), raison = nettoyer(m.steps.at(-1)?.detail, 200) || 'la machine a signalé un échec', idAvant = m.id;
    const avant = [...m.steps].reverse().find((x) => !FINALES.includes(x.step))?.step;
    // Boucle : la même image qui ne démarre pas, encore et encore, sur le même poste = UNE installation (même identifiant) et un compte d'essais.
    let b = boucles.get(m.mac); const suite = Boolean(b && avant === 'chargement' && b.iso === (m.iso ?? '') && now - b.dernier < BOUCLE_MS);
    if (suite && b) { b.tours++; b.dernier = now; m.id = b.id; m.started = b.debut; m.tours = b.tours; }
    else if (avant === 'chargement' && m.id) { b = { id: m.id, iso: m.iso ?? '', debut: m.started, tours: 1, dernier: now, ecritA: 0 }; if (boucles.size > 500) boucles.clear(); boucles.set(m.mac, b); }
    else { b = undefined; boucles.delete(m.mac); }
    const deja = ratesRecents(ctx, m.mac, m.id);
    m.raison = raison; m.fin = 'échec'; delete m.muet; maj(ctx, m.mac, (x) => { if (x.id === idAvant) { x.id = m.id; x.started = m.started; if (m.tours) x.tours = m.tours; x.raison = raison; x.fin = 'échec'; delete x.muet; } });
    // Le jeton de cette installation ne sert plus (10 min de marge pour les scripts déjà lancés).
    cloreJeton(ctx, m.mac);
    // Historique : la ligne est écrite tout de suite ; en boucle, au plus toutes les 10 min (la surveillance écrit le dernier compte).
    if (!suite || !b || b.tours <= 2 || now - b.ecritA >= BOUCLE_ECRIT_MS) { d.finish(ctx, m, 'échec'); if (b) { b.ecritA = now; delete b.attend; } } else b.attend = { ...m };
    prevenir(ctx, 'échec', titre(ctx, m.mac, m), { level: deja ? 'critique' : 'haute', title: `❌ Installation ratée sur ${titre(ctx, m.mac, m)}`, detail: `${raison}. Poste ${m.mac}${m.ip ? ` · ${m.ip}` : ''}${m.isoName ? ` · ${m.isoName}` : ''}${avant ? ` · étape : ${avant}` : ''}${(m.tours ?? 1) > 1 ? ` · ${m.tours} essais à la suite` : ''}${deja ? ` · déjà ${pl(deja, 'raté')} sur ce poste depuis 24 h` : ''}.`, key: `thjalfi-echec-${m.mac}-${Math.min(deja, 2)}`, data: { mac: m.mac, id: m.id }, steps: ['Regarde l\'écran du poste : l\'installateur y affiche l\'erreur.', 'Vérifie le câble réseau et le disque du poste.', 'Relance : « réinstaller » dans Genèse, puis démarre le poste par le réseau.'] });
  }
  /** Le poste envoie un signe de vie pendant l'installation (pas une étape). */
  function signal(ctx: ModCtx, x: { mac: string }, e: string, _q: URLSearchParams, from: string): boolean {
    if (e !== 'vie') return false;
    const now = t(ctx), all = d.live(ctx), m = all[x.mac]; if (!m) return true;
    if (!FINALES.includes(m.step)) m.vie = now;
    else if (m.step === 'sans nouvelles' && m.fin === 'sans nouvelles') {
      // La surveillance l'avait dit abandonné (poste lent, ou Odin resté arrêté) : il vit, son installation reprend où elle en était.
      const etape = [...m.steps].reverse().find((s0) => !FINALES.includes(s0.step))?.step ?? 'installation';
      m.step = etape; m.steps = [...m.steps, { at: now, step: etape, detail: 'le poste redonne signe de vie' }].slice(-30); delete m.fin; delete m.raison; m.vie = now; m.updated = now;
      noter(ctx, { quoi: 'étape', mac: m.mac, id: m.id, nom: nomDe(ctx, m.mac, m), etape, detail: 'le poste redonne signe de vie : son installation n\'était pas abandonnée' });
    } else return true;
    d.saveLive(ctx, all);
    const p = passes.de(x.mac, now); if (p && p.ips.includes(from)) passes.prolonger(p, now);
    return true;
  }
  /** Le jeton d'une installation finie ou ratée : il ne sert plus (10 min de marge, voir le module). */
  function cloreJeton(ctx: ModCtx, mac: string): void {
    try { const ss = d.sessions(ctx), now = t(ctx); let n = 0; for (const x of Object.values(ss)) if (x.mac === mac && !x.fin) { x.fin = now; n++; } if (n) d.saveSessions(ctx, ss); } catch { /* fichier illisible */ }
  }
  /**
   * Un retour « fini » arrive (avec le jeton, depuis l'adresse du poste). Vrai : il ne faut rien refaire. Le passage est déjà
   * fini (retour rejoué : ni deuxième ligne, ni compteur, ni alerte), ou le poste avait lui-même dit son échec (un « fini »
   * après coup ne réécrit pas l'historique en silence : il est noté et signalé).
   */
  function dejaFini(ctx: ModCtx, mac: string): boolean {
    const m = d.live(ctx)[mac]; if (!m) return false;
    if (m.step === 'fini') return true;
    if (m.step !== 'échec') return false;
    if (m.fin === 'échec' && m.steps.at(-1)?.detail !== '« terminée » reçu après l\'échec : pas pris en compte') {
      maj(ctx, mac, (x) => { x.steps = [...x.steps, { at: t(ctx), step: 'échec', detail: '« terminée » reçu après l\'échec : pas pris en compte' }].slice(-30); });
      noter(ctx, { quoi: 'refus', mac, id: m.id, nom: nomDe(ctx, mac, m), detail: '« terminée » reçu après un échec dit par le poste : l\'historique garde « échouée »' });
      ctx.alert({ level: 'moyenne', title: `❓ ${titre(ctx, mac, m)} dit « terminée » après avoir dit « échouée »`, detail: `Poste ${mac}${m.ip ? ` · ${m.ip}` : ''}${m.isoName ? ` · ${m.isoName}` : ''}. L'historique garde « échouée »${m.raison ? ` (${m.raison})` : ''}. Regarde le poste : s'il marche vraiment, relance son installation pour avoir un résultat sûr.`, key: `thjalfi-fini-apres-echec-${m.id ?? mac}`, data: { mac, id: m.id } });
    }
    return true;
  }
  /** Le poste redit son échec : vrai si ce passage l'a déjà dit (rien à refaire). */
  const dejaEchec = (ctx: ModCtx, mac: string) => { const m = d.live(ctx)[mac]; return Boolean(m && m.step === 'échec' && m.fin === 'échec'); };
  /**
   * Un noyau est chargé alors que la fiche du poste est en pleine installation (ou à une autre image, ou déjà finie) : le
   * poste a redémarré et relance un système. L'ancien passage est clos avec son résultat (une ligne d'historique), et un
   * nouveau passage commence : nouvel identifiant, nouveau début, début signalé.
   */
  function recharge(ctx: ModCtx, mac: string | undefined, from: string, iso: string): void {
    if (!mac) return;
    const now = t(ctx), all = d.live(ctx), m = all[mac]; if (!m) return;
    const enCours = m.step === 'installation' || m.step === 'logiciels' || (m.step === 'chargement' && Boolean(m.iso) && m.iso !== iso);
    if (!enCours && !FINALES.includes(m.step)) return;
    // Une autre adresse que celle du poste, alors qu'il vient de parler : quelqu'un cite son adresse MAC, son installation n'est pas close pour autant.
    if (enCours && adressesDe(m).length && !adressesDe(m).includes(from) && now - Math.max(m.updated, m.vie ?? 0) < CHANGEMENT_MS) return;
    if (enCours) {
      const was = m.step, nom = titre(ctx, mac, m);
      m.steps = [...m.steps, { at: now, step: 'sans nouvelles', detail: 'le poste a redémarré et relance un système' }].slice(-30); m.step = 'sans nouvelles'; m.fin = 'sans nouvelles';
      m.raison = `le poste a redémarré et relance un système (dernière étape : ${was})`;
      d.finish(ctx, m, 'sans nouvelles');
      noter(ctx, { quoi: 'fin', mac, id: m.id, nom: nomDe(ctx, mac, m), etape: 'sans nouvelles', detail: m.raison });
      prevenir(ctx, 'abandon', nom, { level: 'moyenne', title: `❔ ${nom} : installation interrompue (le poste a redémarré)`, detail: `${m.isoName ?? 'Son installation'} en était à l'étape « ${was} » quand le poste a redémarré par le réseau et relancé un système. Poste ${mac}${m.ip ? ` · ${m.ip}` : ''}.`, key: `thjalfi-relance-${m.id ?? mac}`, data: { mac, id: m.id } });
    }
    const neuf: Poste = { mac, step: 'menu', steps: [{ at: now, step: 'menu', detail: enCours ? 'le poste a redémarré : nouvelle installation' : 'le poste relance un système' }], started: now, updated: now };
    for (const k of ['host', 'fw', 'token', 'profil', 'passe', 'nomConnu'] as const) if (m[k] !== undefined) (neuf as unknown as Record<string, unknown>)[k] = m[k];
    all[mac] = neuf; d.saveLive(ctx, all);
  }
  /**
   * Un retour à jeton arrive alors que la fiche du poste est un nouveau passage vide : après un abandon déclaré, le poste a
   * redemandé le menu (poste réglé « réseau d'abord ») puis continue. L'installation close par la surveillance reprend :
   * même identifiant, même début, même image, même déroulement. Une seule installation au rapport.
   */
  function renouer(ctx: ModCtx, mac: string, iso: string): void {
    const now = t(ctx), all = d.live(ctx), m = all[mac]; if (!m || FINALES.includes(m.step) || lance(m) || m.debutDit) return;
    let h: Ligne | undefined; try { h = replier(d.hist(ctx).tout()).filter((x) => x.mac === mac).at(-1); } catch { /* historique illisible */ }
    if (!h || !h.id || h.result !== 'sans nouvelles' || h.iso !== iso || now - h.at > 864e5) return;
    const suite = m.steps.map((e) => (e.step === 'menu' && !e.detail ? { ...e, detail: 'le poste a redémarré par le réseau' } : e));
    m.id = h.id; m.started = h.debut ?? m.started; m.iso = h.iso; m.isoName = h.isoName; m.debutDit = true;
    m.steps = [...(h.etapes ?? []).filter((e) => !FINALES.includes(e.etape)).map((e) => ({ at: e.at, step: e.etape, ...(e.detail ? { detail: e.detail } : {}) })), ...suite].slice(-30);
    if (h.host && !m.host) m.host = h.host; if (h.profil) m.profil = h.profil;
    for (const k of ['recette', 'mode', 'lancePar', 'installateur', 'octets'] as const) if (h[k] !== undefined) (m as unknown as Record<string, unknown>)[k] = h[k];
    d.saveLive(ctx, all);
  }

  /** Arrête un passage en cours : plus de jeton, plus de fichiers, connexions coupées, ligne d'historique. */
  function arreter(ctx: ModCtx, mac: string, result: 'annulée' | 'bloquée', detail: string, par: string): Poste | undefined {
    const now = t(ctx), all = d.live(ctx), m = all[mac]; if (!m || FINALES.includes(m.step)) return undefined;
    const etait = lance(m);
    m.step = 'échec'; m.steps = [...m.steps, { at: now, step: 'échec', detail }].slice(-30); m.fin = result; m.raison = detail; m.arretePar = par; m.updated = now;
    d.saveLive(ctx, all);
    const ss = d.sessions(ctx); let n = 0; for (const [jeton, x] of Object.entries(ss)) if (x.mac === mac) { delete ss[jeton]; n++; } if (n) d.saveSessions(ctx, ss);
    // L'installation automatique prévue ne repart pas toute seule au prochain démarrage.
    const rs = d.rules(ctx), r = rs.find((x) => x.mac === mac); if (r?.auto && !r.fait) { r.fait = true; ctx.saveSettings({ machines: rs }); }
    passes.retirer(mac);
    // Toutes les adresses d'où ce poste a chargé sont coupées ; une adresse seulement si elle ne désigne que ce poste (deux postes derrière la même adresse : on ne coupe pas l'autre).
    for (const ip of adressesDe(m)) if (!Object.values(all).some((o) => o.mac !== mac && adressesDe(o).includes(ip) && !FINALES.includes(o.step))) { coupees.set(ip, { mac, jusqua: now + 30 * 60_000 }); try { d.couper?.(ip); } catch { /* déjà fermées */ } }
    if (etait || result === 'annulée') d.finish(ctx, m, result);
    noter(ctx, { quoi: result === 'annulée' ? 'annulation' : 'blocage', mac, id: m.id, nom: nomDe(ctx, mac, m), detail });
    ctx.emit('etape', { mac, etape: result, ...(m.isoName ? { iso: m.isoName } : {}), ...(m.host ? { nom: m.host } : {}) });
    return m;
  }

  /** Surveillance (toutes les minutes) : un poste qui ne donne plus signe de vie. */
  function veiller(ctx: ModCtx): void {
    const all = d.live(ctx), now = t(ctx), ab = abandonMs(ctx), fins: Array<() => void> = []; let change = false;
    for (const [ip, c] of coupees) if (c.jusqua <= now) coupees.delete(ip);
    dernierCtx = ctx; lots.vider(now);
    // Boucles : le dernier compte d'essais est écrit quand la boucle s'arrête (2 min sans essai), ou toutes les 10 min.
    for (const [mac, b] of boucles) {
      if (b.attend && (now - b.dernier > 2 * 60_000 || now - b.ecritA >= BOUCLE_ECRIT_MS)) { const f = b.attend; delete b.attend; b.ecritA = now; d.finish(ctx, f, 'échec'); noter(ctx, { quoi: 'fin', mac, id: b.id, nom: nomDe(ctx, mac, f), etape: 'échec', detail: `${pl(b.tours, 'essai raté', 'essais ratés')} à la suite : ${f.raison ?? 'l\'image ne démarre pas'}` }); }
      if (!b.attend && now - b.dernier > BOUCLE_MS) boucles.delete(mac);
    }
    for (const m of Object.values(all)) {
      if (FINALES.includes(m.step)) continue;
      // Le silence se compte depuis le démarrage d'Odin au plus tôt : après un arrêt, chaque poste a de nouveau le délai entier pour se manifester.
      const silence = now - Math.max(m.updated, m.vie ?? 0), calme = Math.min(silence, now - (depart ?? now)), was = m.step;
      const clore = (detail: string) => { m.step = 'sans nouvelles'; m.steps = [...m.steps, { at: now, step: 'sans nouvelles', detail }].slice(-30); change = true; };
      // Avant tout chargement : le poste a pris son disque (ou a été éteint). Ce n'est pas une installation ratée.
      if (!LANCEES.includes(was)) { if (calme > Math.max(ab, 30 * 60_000)) clore('aucune installation lancée : le poste a repris son disque'); continue; }
      // Windows ne donne pas de signe de vie pendant la copie (installateur de Microsoft) : on patiente plus longtemps.
      const limite = m.recette === 'windows' && was !== 'chargement' ? Math.max(ab, 120 * 60_000) : ab;
      if (calme <= limite) continue;
      clore(`dernière étape : ${was}`);
      // Lancée à la main (questions posées sur le poste), essai ou outil : Odin ne peut pas savoir la suite. Pas un échec.
      if (was === 'chargement' && m.mode && m.mode !== 'auto') { m.fin = 'lancée'; fins.push(() => d.finish(ctx, m, 'lancée')); continue; }
      m.fin = 'sans nouvelles'; m.raison = `plus de signe de vie depuis ${duree(silence)} (dernière étape : ${was})`;
      fins.push(() => {
        const deja = ratesRecents(ctx, m.mac, m.id); d.finish(ctx, m, 'sans nouvelles');
        prevenir(ctx, 'abandon', titre(ctx, m.mac, m), { level: deja ? 'haute' : 'moyenne', title: `❔ ${titre(ctx, m.mac, m)} : installation abandonnée (plus de signe de vie)`, detail: `Dernière étape : ${was}${m.isoName ? ` (${m.isoName})` : ''}, il y a ${duree(silence)}. Poste ${m.mac}${m.ip ? ` · ${m.ip}` : ''}${deja ? ` · déjà ${pl(deja, 'raté')} sur ce poste depuis 24 h` : ''}.`, steps: ['Regarde l\'écran du poste.', 'S\'il attend une réponse, le fichier de réponses n\'a pas été lu.', 'S\'il est éteint ou a redémarré sur son disque : relance-le par le réseau.'], key: `thjalfi-silence-${m.mac}-${Math.min(deja, 2)}`, data: { mac: m.mac, id: m.id } });
      });
    }
    if (change) d.saveLive(ctx, all);
    for (const f of fins) f();
  }

  // ---------------- Les refus ----------------
  const refusBloque = (mac: string) => scriptRefus([`Ce poste (${mac}) est bloque dans Odin : pas d'installation par le reseau.`, 'Demande au proprietaire d\'Odin de le debloquer (appli Genese).', 'Le poste demarre sur son disque.']);
  const refusSuspendu = () => scriptRefus(['Les installations par le reseau sont suspendues dans Odin.', 'Le poste demarre sur son disque.']);
  /** Un poste bloqué retente : noté (au plus toutes les 10 min) et signalé (une alerte par poste, pas de doublon). */
  function tentative(ctx: ModCtx, mac: string, from: string): void {
    const now = t(ctx), m = d.live(ctx)[mac];
    dire(ctx, mac, from, 'refusé : poste bloqué');
    // Son adresse IP est gardée : sans adresse MAC (ou avec une autre, jamais vue), il reste refusé.
    adresseBloquee(ctx, mac, [from], now);
    if (now - (refusNote.get(mac) ?? 0) > 600_000) { if (refusNote.size > 500) refusNote.clear(); refusNote.set(mac, now); noter(ctx, { quoi: 'refus', mac, nom: nomDe(ctx, mac, m), detail: `poste bloqué, adresse ${from}` }); }
    ctx.alert({ level: 'moyenne', title: `🚫 Poste bloqué : ${titre(ctx, mac, m)} a retenté de démarrer par le réseau`, detail: `Poste ${mac} · adresse ${from}. Il n'a reçu ni menu ni fichier : il démarre sur son disque.${bloques(ctx)[mac]?.raison ? ` Raison du blocage : ${bloques(ctx)[mac].raison}.` : ''}`, key: `thjalfi-bloque-${mac}`, data: { mac }, fix: { action: 'debloquer', label: 'Débloquer ce poste', input: { mac } }, lien: 'thjalfi-alerte-installation' });
  }
  /** Avant le menu : rien (le menu normal part), ou le script à envoyer à la place (refus, ou menu fermé par le mot de passe). */
  function garde(ctx: ModCtx, mac: string, _fw: string, from: string): string | undefined {
    const now = t(ctx), cle = cleCfg(ctx);
    // Sans adresse MAC valable : jamais de menu (une installation ne part pas hors du suivi), avec ou sans mot de passe.
    if (!mac) { const b = bloqueParIp(ctx, from, now); if (b) { tentative(ctx, b, from); return refusBloque(b); } if (suspendu(ctx)) return refusSuspendu(); sansAdresse(ctx, from, 'Le menu a été'); return scriptRefus(['Ce poste n\'a pas donne son adresse : pas d\'installation par le reseau.', 'Le poste demarre sur son disque.']); }
    if (bloques(ctx)[mac]) { tentative(ctx, mac, from); return refusBloque(mac); }
    // L'adresse IP d'un poste bloqué, avec une adresse MAC jamais vue avant : c'est lui, refusé pareil.
    const autre = bloqueParIp(ctx, from, now, mac); if (autre) { tentative(ctx, autre, from); return refusBloque(autre); }
    // Le poste a redémarré : ce qui restait coupé pour son ancienne installation ne l'est plus, seulement si c'est bien lui qui redemande (l'adresse coupée elle-même).
    const c = coupees.get(from); if (c && c.mac === mac) coupees.delete(from);
    else if (c && c.jusqua > now) return scriptRefus(['Une installation a ete arretee depuis Odin a cette adresse : rien ne lui est servi pour l\'instant.', 'Le poste demarre sur son disque.']);
    if (suspendu(ctx)) { dire(ctx, mac, from, 'refusé : installations suspendues'); return refusSuspendu(); }
    if (tropDeNouveaux(ctx, mac, from, now)) return scriptRefus(['Trop de postes inconnus depuis cette adresse : Odin ne leur repond plus pendant une heure.', 'Le poste demarre sur son disque.']);
    if (cle && !exempte(ctx, mac, from, now, true)) {
      const p = passes.de(mac, now);
      if (!p || !p.ips.includes(from)) { dire(ctx, mac, from, 'attend le mot de passe d\'installation'); return menuFerme({ base: d.base(ctx), mac, delai: Math.max(0, Math.min(300, Number(ctx.settings.delai ?? 10))), look: d.look?.(ctx) }); }
      passes.prolonger(p, now);
    }
    return undefined;
  }
  /** Un fichier est demandé (noyau, image, fichier de réponses…) : la raison du refus, ou rien. */
  function acces(ctx: ModCtx, mac: string | undefined, from: string, quoi: 'fichier' | 'jeton'): string | undefined {
    const non = interdit(ctx, mac || undefined, from, quoi);
    if (non) constater(ctx, mac || undefined, from, non);
    return non;
  }
  /**
   * « Postes non autorisés seulement » : un poste que tu as autorisé passe sans mot de passe, depuis UNE adresse IP (la
   * première qui demande le menu, gardée 12 h). Une autre adresse qui cite la même adresse MAC n'est pas crue : elle
   * doit donner le mot de passe, et Odin prévient. `lier` : seul le menu choisit l'adresse.
   */
  function exempte(ctx: ModCtx, mac: string, from: string, now: number, lier = false): boolean {
    const c = cleCfg(ctx); if (!c || c.pour !== 'inconnus' || !from || !regle(ctx, mac)) return false;
    const e = exemptes.get(mac);
    if (e && now - e.at < 12 * 3600_000) {
      if (e.ip === from) { e.at = now; return true; }
      ctx.alert({ level: 'haute', title: `🎭 Deux adresses pour le poste autorisé ${titre(ctx, mac, d.live(ctx)[mac])}`, detail: `L'adresse ${from} se présente avec l'adresse MAC ${mac}, déjà utilisée depuis ${e.ip}. Un poste autorisé passe sans mot de passe depuis une seule adresse : ${from} doit donner le mot de passe d'installation. Si ce n'est pas ton poste, quelqu'un prend son adresse MAC.`, key: `thjalfi-double-${mac}-${from}`, data: { mac, ip: from }, steps: ['Si ton poste a seulement changé d\'adresse IP : donne le mot de passe sur son écran, ou attends 12 h.', 'Sinon : cherche l\'appareil qui a cette adresse IP, et demande le mot de passe à tous les postes (onglet Protection).'] });
      return false;
    }
    if (!lier) return false;
    if (exemptes.size > 1000) exemptes.clear(); exemptes.set(mac, { ip: from, at: now }); return true;
  }
  /** La raison du refus d'un fichier, ou rien. */
  function interdit(ctx: ModCtx, mac: string | undefined, from: string, quoi: 'fichier' | 'jeton'): string | undefined {
    const now = t(ctx);
    // (Une demande à jeton sans adresse MAC : le jeton dira de quel poste il s'agit, voir « coupe ».)
    if ((mac && bloques(ctx)[mac]) || ((mac || quoi !== 'jeton') && bloqueParIp(ctx, from, now, mac))) return 'poste bloqué dans Odin';
    // Une adresse coupée (installation annulée, poste bloqué en pleine installation) est refusée quelle que soit l'adresse MAC citée.
    const c = coupees.get(from); if (c && c.jusqua > now) return 'installation arrêtée depuis Odin';
    if (quoi === 'jeton') return undefined;
    const all = d.live(ctx), sus = suspendu(ctx), cle = cleCfg(ctx), m = mac ? all[mac] : undefined;
    // Une adresse MAC jamais vue qui demande un fichier sans être passée par le menu : comptée comme les autres (10 nouvelles par heure et par adresse IP).
    if (mac && !m && tropDeNouveaux(ctx, mac, from, now)) return 'trop de postes inconnus depuis cette adresse';
    // « suit » : une installation lancée ; ou, pour les fichiers demandés sans adresse MAC (les paquets d'un installateur resté
    // longtemps sur ses questions), un passage que la surveillance a clos. Un noyau (demandé avec l'adresse MAC) n'en profite pas.
    const sien = (x: Poste) => adressesDe(x).includes(from), suit = (x: Poste) => lance(x) || (!mac && tardive(x, now));
    // Sans adresse MAC (fichiers demandés par l'installateur) : seulement depuis l'adresse d'un poste qu'Odin suit.
    const siens = mac ? (m && sien(m) ? [m] : []) : Object.values(all).filter((x) => sien(x) && (!FINALES.includes(x.step) || tardive(x, now)));
    if (!mac && !siens.length) { if (!cle && !sus) sansAdresse(ctx, from, 'Un fichier d\'installation a été'); return cle ? 'mot de passe d\'installation demandé' : sus ? 'installations suspendues dans Odin' : 'poste inconnu d\'Odin : aucun menu n\'a été demandé depuis cette adresse'; }
    // Suspendu : les installations déjà lancées finissent (pour leur poste seulement), rien de nouveau ne part.
    if (sus && !siens.some(suit)) return 'installations suspendues dans Odin';
    if (!cle) return undefined;
    // Le droit acquis au début du passage (mot de passe donné, poste autorisé) vaut jusqu'à sa fin, même après un redémarrage d'Odin.
    if (siens.some((x) => x.passe && suit(x))) { const p = mac ? passes.de(mac, now) : passes.parIp(from, now); if (p && p.ips.includes(from)) passes.prolonger(p, now); return undefined; }
    if (mac) {
      if (exempte(ctx, mac, from, now)) return undefined;
      const p = passes.de(mac, now); if (!p || !p.ips.includes(from)) return 'mot de passe d\'installation demandé';
      passes.prolonger(p, now); return undefined;
    }
    const p = passes.parIp(from, now); if (p) { passes.prolonger(p, now); return undefined; }
    if (siens.some((x) => !FINALES.includes(x.step) && exempte(ctx, x.mac, from, now))) return undefined;
    return 'mot de passe d\'installation demandé';
  }
  /** Un refus de fichier qui touche un poste connu apparaît dans son déroulement (une fois par raison) ; un poste bloqué qui retente est signalé. */
  function constater(ctx: ModCtx, mac: string | undefined, from: string, raison: string): void {
    const all = d.live(ctx), now = t(ctx);
    const bloque = mac && bloques(ctx)[mac] ? mac : /bloqué/.test(raison) ? bloqueParIp(ctx, from, now, mac) : undefined;
    if (bloque) { if (now - (refusNote.get(`f:${bloque}`) ?? 0) > 60_000) { refusNote.set(`f:${bloque}`, now); tentative(ctx, bloque, from); } return; }
    let m = mac ? all[mac] : undefined;
    if (!m && !mac) { const l = Object.values(all).filter((x) => adressesDe(x).includes(from) && !FINALES.includes(x.step)); if (l.length === 1) m = l[0]; }
    if (!m || FINALES.includes(m.step) || !adressesDe(m).includes(from)) return;
    const detail = `refusé : ${raison}`; if (m.steps.some((e) => e.detail === detail && now - e.at < 3600_000)) return;
    d.track(ctx, m.mac, undefined, m.step, { detail });
  }
  /**
   * Une demande avec un jeton d'installation (fichier de réponses, retour d'avancement) : refusée si le poste est coupé, ou si
   * elle ne vient pas de l'adresse du poste. Le jeton seul ne prouve rien (il peut être lu sur le réseau) : il ne fait
   * jamais entrer une adresse dans un laissez-passer. Un poste qui a vraiment changé d'adresse (bail DHCP) est accepté
   * quand l'ancienne adresse se tait depuis 3 min, et c'est noté et signalé.
   */
  function coupe(ctx: ModCtx, mac: string, from: string): boolean {
    if (acces(ctx, mac, from, 'jeton')) return true;
    const now = t(ctx), all = d.live(ctx), m = all[mac], p = passes.de(mac, now);
    if (!m) return Boolean(cleCfg(ctx)) && !exempte(ctx, mac, from, now) && !(p && p.ips.includes(from));
    const connues = adressesDe(m);
    if (from && connues.length && !connues.includes(from)) {
      // Avec le mot de passe demandé, la nouvelle adresse doit l'avoir donné elle-même.
      if (now - Math.max(m.updated, m.vie ?? 0) < CHANGEMENT_MS || (cleCfg(ctx) && !exempte(ctx, mac, from, now) && !(p && p.ips.includes(from)))) {
        if (now - (refusNote.get(`j:${mac}:${from}`) ?? 0) > 600_000) { if (refusNote.size > 500) refusNote.clear(); refusNote.set(`j:${mac}:${from}`, now); noter(ctx, { quoi: 'refus', mac, id: m.id, nom: nomDe(ctx, mac, m), detail: `jeton d'installation présenté depuis ${from}, qui n'est pas l'adresse du poste (${connues.join(', ')})` }); ctx.alert({ level: 'haute', title: `🎭 Le jeton d'installation de ${titre(ctx, mac, m)} est présenté depuis une autre adresse`, detail: `Adresse ${from}, alors que le poste ${mac} parle depuis ${connues.join(', ')}. Odin a refusé : ni fichier de réponses, ni retour d'avancement.`, key: `thjalfi-jeton-${mac}-${from}`, data: { mac, ip: from } }); }
        return true;
      }
      m.ips = [from]; m.ip = from; m.fige = true; d.saveLive(ctx, all);
      noter(ctx, { quoi: 'adresse', mac, id: m.id, nom: nomDe(ctx, mac, m), detail: `le poste parle maintenant depuis ${from} (avant : ${connues.join(', ')})` });
      ctx.alert({ level: 'moyenne', title: `🔀 ${titre(ctx, mac, m)} a changé d'adresse pendant son installation`, detail: `Poste ${mac} : ${connues.join(', ')} ne parlait plus depuis ${duree(now - Math.max(m.updated, m.vie ?? 0))}, la suite arrive de ${from} avec le jeton de l'installation. Odin l'accepte (bail d'adresse renouvelé, sans doute).`, key: `thjalfi-adresse-${mac}-${from}`, data: { mac, ip: from } });
    }
    if (p && p.ips.includes(from)) passes.prolonger(p, now);
    return false;
  }
  /** Ce que l'écran d'Odin (ouvert sur un téléphone, sans session) peut montrer d'un poste : l'étape, l'image, le nom. Jamais le jeton, l'installateur, la série ni les étapes ; rien du tout si le mot de passe est demandé et que ce poste ne l'a pas donné. */
  function publique(ctx: ModCtx, mac: string): { step: string; iso?: string; isoName?: string; host?: string; updated: number } | null {
    const m = mac ? d.live(ctx)[mac] : undefined; if (!m) return null;
    const c = cleCfg(ctx), now = t(ctx);
    if (c && !(c.pour === 'inconnus' && regle(ctx, mac)) && !passes.de(mac, now) && !(m.passe && !FINALES.includes(m.step))) return null;
    return { step: m.step, ...(m.iso ? { iso: m.iso } : {}), ...(m.isoName ? { isoName: m.isoName } : {}), ...(m.host ? { host: m.host } : {}), updated: m.updated };
  }
  /** L'écran d'Odin (choix fait sur un téléphone) : mêmes règles que le menu, sinon il servirait de contournement. */
  function refus(ctx: ModCtx, mac: string, mode?: string): string | undefined {
    if (!mac) return undefined;
    if (bloques(ctx)[mac]) return 'Ce poste est bloqué dans Odin.';
    if (mode === 'disque') return undefined;
    if (suspendu(ctx)) return 'Les installations par le réseau sont suspendues dans Odin.';
    const cle = cleCfg(ctx);
    if (cle && !(cle.pour === 'inconnus' && regle(ctx, mac)) && !passes.de(mac, t(ctx))) return 'Ce poste doit d\'abord donner le mot de passe d\'installation (sur son écran, « Installer un système »).';
    return undefined;
  }

  /** Le poste donne le mot de passe d'installation : la suite, en script iPXE. Le mot de passe n'est jamais gardé ni noté. */
  async function cle(ctx: ModCtx, mac: string, fw: string, from: string, mdp: string, qui: string): Promise<string> {
    const base = d.base(ctx);
    if (!mac) return scriptRefus(['Ce poste n\'a pas donne son adresse.', 'Le poste demarre sur son disque.']);
    if (bloques(ctx)[mac]) { tentative(ctx, mac, from); return refusBloque(mac); }
    if (!cleCfg(ctx)) return scriptAccepte({ base, mac, fw });
    // Le compte « par poste » suit l'adresse MAC ET l'adresse IP : personne ne bloque le poste d'un autre en citant son adresse MAC.
    const cm = `m:${mac}@${from}`, ci = `i:${from}`, v = essais.verrou(cm, t(ctx)) ?? essais.verrou(ci, t(ctx));
    if (v) return scriptRefuse({ base, mac, fw, minutes: (v - t(ctx)) / 60_000 });
    // L'essai est compté AVANT le calcul : des demandes envoyées en rafale ne dépassent pas la limite. Un bon mot de passe remet le compte à zéro.
    // Par adresse IP, le compte ne retombe qu'après une heure sans erreur (changer d'adresse MAC ou attendre un quart d'heure ne sert à rien).
    const r = essais.rate(cm, t(ctx)), ri = essais.rate(ci, t(ctx), ESSAIS_MAX_IP, 3600_000);
    // Beaucoup de refus en une heure, tous postes confondus : chaque essai attend son tour (un toutes les 3 s).
    if (refusCle.filter((x) => t(ctx) - x < 3600_000).length >= REFUS_MAX && RALENTI.ms > 0) { const tour = fileRalentie.then(() => new Promise<void>((ok0) => { setTimeout(ok0, RALENTI.ms).unref?.(); })); fileRalentie = tour; await tour; }
    const ok = mdp.length > 0 && await verifier(mdp, (d.secrets(ctx).cle as CleSecret | undefined)?.e);
    const now = t(ctx), m = d.live(ctx)[mac], nom = nomDe(ctx, mac, m);
    if (ok) {
      const par = nettoyer(qui, 40);
      essais.bon(cm); essais.bon(ci); passes.donner(mac, from, par || undefined, now);
      if (par) maj(ctx, mac, (x) => { if (!FINALES.includes(x.step)) x.installateur = par; });
      dire(ctx, mac, from, `mot de passe accepté${par ? ` (${par})` : ''}`);
      noter(ctx, { quoi: 'mot de passe accepté', mac, nom, ...(par ? { detail: `saisi par ${par}` } : {}) });
      return scriptAccepte({ base, mac, fw });
    }
    dire(ctx, mac, from, `mot de passe refusé (essai ${Math.min(r.n, ESSAIS_MAX)} sur ${ESSAIS_MAX})`);
    noter(ctx, { quoi: 'mot de passe refusé', mac, nom, detail: `essai ${Math.min(r.n, ESSAIS_MAX)} sur ${ESSAIS_MAX}, adresse ${from}` });
    // Le compte global (toutes adresses IP, toutes adresses MAC) : une force brute lente ou éparpillée est signalée aussi.
    refusCle = [...refusCle.filter((x) => now - x < 3600_000), now].slice(-500);
    if (refusCle.length >= REFUS_MAX) ctx.alert({ level: 'haute', title: `🔒 ${refusCle.length} mots de passe d'installation refusés en une heure`, detail: `Dernier essai : poste ${mac} · adresse ${from}. Quelqu'un cherche le mot de passe d'installation. Odin ralentit maintenant tous les essais (un toutes les ${Math.round(RALENTI.ms / 1000)} s) ; chaque adresse est bloquée après ${ESSAIS_MAX_IP} erreurs (15 min, puis 1 h, puis 24 h).`, key: 'thjalfi-cle-force', data: { ip: from }, steps: ['Si c\'est toi ou quelqu\'un de chez toi : rien à faire, le bon mot de passe passe toujours.', 'Sinon : cherche l\'appareil qui a cette adresse IP et bloque-le (pare-feu, ou « Suspendre les installations » le temps de voir).'], fix: { action: 'suspendre', label: 'Suspendre les installations' } });
    // La même adresse IP qui essaie sous plusieurs adresses MAC : ce n'est pas un poste qui se trompe.
    let lm = macsEssayees.get(from); if (!lm) { lm = new Map(); if (macsEssayees.size > 500) macsEssayees.clear(); macsEssayees.set(from, lm); }
    for (const [k, at] of lm) if (now - at > 3600_000) lm.delete(k); lm.set(mac, now);
    if (lm.size >= 3) ctx.alert({ level: 'haute', title: `🎭 L'adresse ${from} essaie le mot de passe sous ${lm.size} adresses MAC`, detail: `Mots de passe refusés depuis ${from} pour ${[...lm.keys()].slice(0, 5).join(', ')}${lm.size > 5 ? '…' : ''} en moins d'une heure : un seul appareil change d'adresse MAC pour contourner la limite d'essais. La limite par adresse IP (${ESSAIS_MAX_IP} erreurs) le bloque quand même.`, key: `thjalfi-cle-macs-${from}`, data: { ip: from } });
    const verrou = r.verrou ?? ri.verrou;
    if (verrou) {
      const combien = duree(verrou - now);
      noter(ctx, { quoi: 'verrou', mac, nom, detail: `bloqué ${combien} après ${r.verrou ? `${ESSAIS_MAX} mots de passe refusés` : `${ESSAIS_MAX_IP} mots de passe refusés depuis ${from}`}` });
      ctx.alert({ level: 'haute', title: `🔒 ${r.verrou ? ESSAIS_MAX : ESSAIS_MAX_IP} mots de passe refusés : ${r.verrou ? titre(ctx, mac, m) : `l'adresse ${from}`} est bloqué${r.verrou ? '' : 'e'} ${combien}`, detail: `Poste ${mac} · adresse ${from}. Quelqu'un essaie de lancer une installation sans connaître le mot de passe ; aucun fichier ne lui est servi. Le blocage s'allonge s'il recommence (15 min, 1 h, puis 24 h).`, key: `thjalfi-cle-${mac}-${verrou}`, data: { mac }, steps: [`Si c'est toi : attends ${combien}, puis retape le mot de passe (clavier lu comme un clavier américain).`, 'Sinon : bloque ce poste dans Genèse (onglet Installations).'], fix: { action: 'bloquer', label: 'Bloquer ce poste', input: { mac, raison: 'mots de passe refusés' } } });
      return scriptRefuse({ base, mac, fw, minutes: (verrou - now) / 60_000 });
    }
    return scriptRefuse({ base, mac, fw, essai: r.n });
  }
  /** Des octets d'une image viennent de partir vers un poste : avancement réel et signe de vie. */
  function servi(ctx: ModCtx, mac: string | undefined, from: string, id: string, octets: number): void {
    if (!(octets > 0)) return;
    const all = d.live(ctx), now = t(ctx);
    let m = mac ? all[mac] : undefined;
    // Sans adresse MAC (fichiers demandés par l'installateur) : seulement si cette adresse IP ne désigne qu'un poste en train de charger.
    if (!m) { const l = Object.values(all).filter((x) => adressesDe(x).includes(from) && lance(x)); if (l.length === 1) m = l[0]; }
    if (!m || FINALES.includes(m.step) || (m.iso && m.iso !== id) || (adressesDe(m).length && !adressesDe(m).includes(from))) return;
    m.octets = (m.octets ?? 0) + octets; m.vie = now;
    if (!m.taille) { const taille = d.infoIso?.(m.iso ?? id)?.taille; if (taille) m.taille = taille; }
    d.saveLive(ctx, all);
  }

  // ---------------- Ce que la page affiche ----------------
  function vue(ctx: ModCtx, m: Poste) {
    const a = avancement(m), nom = nomDe(ctx, m.mac, m), r = regle(ctx, m.mac);
    return {
      mac: m.mac, id: m.id, nom: nom ?? null, connu: Boolean(r || m.nomConnu), autorise: Boolean(r), ip: m.ip ?? '', fw: m.fw ?? '', serie: m.serie ?? '', uuid: m.uuid ?? '', marque: m.marque ?? '', modele: m.modele ?? '',
      image: m.isoName ?? '', recette: m.recette ?? '', mode: m.mode ?? '', lancePar: m.lancePar ?? '', installateur: m.installateur ?? '',
      etape: m.step, etat: etatDe(m), enCours: !FINALES.includes(m.step), lancee: lance(m), annulable: lance(m) || (!FINALES.includes(m.step) && Boolean(m.token)), detail: m.steps.at(-1)?.detail ?? '', raison: m.raison ?? '', arretePar: m.arretePar ?? '',
      debut: m.started, maj: Math.max(m.updated, m.vie ?? 0), pct: a.pct, reel: a.reel, envoye: a.image ?? null,
      etapes: m.steps.map((e) => ({ at: e.at, etape: e.step, detail: e.detail ?? '' })), bloque: Boolean(bloques(ctx)[m.mac]), logiciels: m.logiciels ?? [],
    };
  }
  const listeBloques = (ctx: ModCtx) => { const all = d.live(ctx); return Object.entries(bloques(ctx)).map(([mac, b]) => ({ mac, nom: nomDe(ctx, mac, all[mac]) ?? null, at: b.at, raison: b.raison ?? '' })).sort((x, y) => y.at - x.at); };
  const protection = (ctx: ModCtx) => {
    const now = t(ctx), c = cleCfg(ctx);
    return { actif: Boolean(c), pour: c?.pour ?? 'toutes', depuis: c?.depuis ?? 0, essaisMax: ESSAIS_MAX, verrous: essais.verrous(now).filter((x) => x.cle.startsWith('m:')).map((x) => ({ mac: x.cle.slice(2).split('@')[0], ip: x.cle.split('@')[1] ?? '', jusqua: x.jusqua })).filter((x, i, l) => l.findIndex((y) => y.mac === x.mac) === i), passes: passes.liste(now).map((p) => ({ mac: p.mac, qui: p.qui ?? '', jusqua: p.jusqua })) };
  };
  const histo = (ctx: ModCtx): Ligne[] => { try { return d.hist(ctx).tout(); } catch { return []; } };
  const evenements = (ctx: ModCtx, n: number, f?: (e: Evenement) => boolean) => { try { const l = fil(ctx).tout(); return (f ? l.filter(f) : l).slice(-n).reverse(); } catch { return []; } };
  const macDe = (i: Record<string, unknown>) => { const mac = normMac(s(i.mac)); if (!mac) throw new Error('adresse MAC invalide (ex. 52:54:00:12:34:56)'); return mac; };
  const macParam = { key: 'mac', label: 'Adresse MAC du poste', kind: 'text' as const, required: true };
  const SANS_CHANGER = 'ne change pas';
  const GRAVE_RETIRER = 'retirer le mot de passe d\'installation : n\'importe quel poste du réseau local pourra de nouveau lancer une installation';
  const retirer = (ctx: ModCtx) => {
    if (!cleCfg(ctx)) return { text: 'Aucun mot de passe d\'installation n\'est réglé.', ok: false };
    const sec = { ...d.secrets(ctx) }; delete sec.cle; d.saveSecrets(ctx, sec); ctx.saveSettings({ cle: false }); passes.vider(); exemptes.clear();
    noter(ctx, { quoi: 'réglage', detail: 'mot de passe d\'installation retiré' });
    return { text: '🔓 Mot de passe d\'installation retiré : les postes ont de nouveau le menu sans rien taper.' };
  };
  const LIMITE_AUTORISES = 'un poste autorisé est reconnu à son adresse MAC, que tout le réseau local peut lire ; un appareil qui prend cette adresse passe sans mot de passe (Odin n\'accepte qu\'une adresse IP par poste autorisé et prévient si une deuxième se présente)';
  const TEXTE_ANNULER = 'les fichiers ne lui sont plus servis et son disque peut rester à moitié écrit ; un installateur déjà chargé en mémoire (Ubuntu) ou Windows (qui lit le partage réseau) peut continuer seul : éteins alors le poste';

  const actions: Action[] = [
    { id: 'suivi', label: 'Suivi des installations', what: 'Chaque poste qui démarre par le réseau : qui il est, son étape, son avancement, son état ; postes bloqués ; protection', read: true, words: ['suivi des installations', 'installations en cours', 'où en est l\'installation'], run: (ctx) => {
      const now = t(ctx), l = Object.values(d.live(ctx)).sort((a, b) => Math.max(b.updated, b.vie ?? 0) - Math.max(a.updated, a.vie ?? 0)), enCours = l.filter((m) => !FINALES.includes(m.step)), h = replier(histo(ctx)).filter((x) => now - x.at < 864e5);
      const txt = enCours.filter(lance).map((m) => `- ${titre(ctx, m.mac, m)} : ${m.isoName ?? '?'} · ${m.step} · ${avancement(m).pct} %`);
      return { text: `${pl(enCours.filter(lance).length, 'installation')} en cours${suspendu(ctx) ? ' · nouvelles installations suspendues' : ''}${cleCfg(ctx) ? ' · mot de passe demandé' : ''}${Object.keys(bloques(ctx)).length ? ` · ${pl(Object.keys(bloques(ctx)).length, 'poste bloqué', 'postes bloqués')}` : ''}${txt.length ? `\n${txt.join('\n')}` : ''}`, data: {
        maintenant: now, suspendu: suspendu(ctx) ?? null, protection: protection(ctx), abandon: Math.round(abandonMs(ctx) / 60_000),
        postes: [...enCours, ...l.filter((m) => FINALES.includes(m.step)).slice(0, 30)].map((m) => vue(ctx, m)), bloques: listeBloques(ctx),
        chiffres: { enCours: enCours.filter(lance).length, auMenu: enCours.filter((m) => !lance(m)).length, reussies: h.filter((x) => x.result === 'fini').length, rates: h.filter((x) => rate(x.result)).length, bloques: Object.keys(bloques(ctx)).length },
      } };
    } },
    { id: 'poste', label: 'Fiche d\'un poste', what: 'Tout ce qu\'Odin sait d\'un poste : identité, installation en cours étape par étape, installations passées, événements', read: true, quick: false, params: [macParam], run: (ctx, i) => {
      const mac = macDe(i), m = d.live(ctx)[mac], passees = replier(histo(ctx)).filter((x) => x.mac === mac).reverse().slice(0, 30), r = regle(ctx, mac);
      const nom = nomDe(ctx, mac, m) ?? passees.find((x) => x.host)?.host;
      return { text: `${nom ?? `Poste inconnu ${mac}`}${m ? ` : ${etatDe(m)}${m.isoName ? ` (${m.isoName}, ${m.step})` : ''}` : ' : pas vu récemment'} · ${pl(passees.length, 'installation passée', 'installations passées')}${bloques(ctx)[mac] ? ' · bloqué' : ''}`, data: { mac, nom: nom ?? null, poste: m ? vue(ctx, m) : null, bloque: bloques(ctx)[mac] ?? null, autorise: r ? { iso: r.iso ?? '', auto: r.auto, fait: Boolean(r.fait) } : null, passees, evenements: evenements(ctx, 80, (e) => e.mac === mac) } };
    } },
    { id: 'bloquer', label: 'Bloquer un poste', what: 'Ce poste ne reçoit plus ni menu ni fichiers d\'installation : son écran le dit, puis il démarre sur son disque ; une installation en cours sur ce poste est arrêtée', params: [macParam, { key: 'raison', label: 'Raison (pour s\'en souvenir)', kind: 'text', default: '' }], quick: false,
      grave: (i, ctx) => { const mac = normMac(s(i.mac)), m = ctx && mac ? d.live(ctx)[mac] : undefined; return lance(m) ? `bloquer le poste ${mac} pendant son installation (${m!.isoName ?? 'système'}) : ${TEXTE_ANNULER}` : undefined; },
      words: ['bloque le poste', 'bloquer le poste'], run: (ctx, i) => {
        const mac = macDe(i), raison = nettoyer(i.raison, 120), now = t(ctx), m = d.live(ctx)[mac], nom = titre(ctx, mac, m);
        // Les adresses IP d'où il a parlé sont gardées avec le blocage : sans adresse MAC, ou avec une autre jamais vue, il reste refusé.
        ctx.saveSettings({ bloques: { ...bloques(ctx), [mac]: { at: now, ...(raison ? { raison } : {}), ...(adressesDe(m).length ? { ips: Object.fromEntries(adressesDe(m).map((ip) => [ip, now])) } : {}) } } });
        passes.retirer(mac);
        const arrete = lance(m) ? arreter(ctx, mac, 'bloquée', `poste bloqué depuis Odin${raison ? ` : ${raison}` : ''}`, 'Odin (action « Bloquer un poste »)') : undefined;
        if (!arrete) noter(ctx, { quoi: 'blocage', mac, nom: nomDe(ctx, mac, m), ...(raison ? { detail: raison } : {}) });
        ctx.alert({ level: 'info', title: `🚫 Poste bloqué : ${nom}`, detail: `Poste ${mac}${raison ? ` · ${raison}` : ''}. Il ne reçoit plus ni menu ni fichiers d'installation.${arrete ? ` Son installation (${arrete.isoName ?? 'système'}) a été arrêtée.` : ''}`, key: `thjalfi-blocage-${mac}-${now}`, data: { mac } });
        return { text: `🚫 ${nom} (${mac}) est bloqué : plus de menu ni de fichiers d'installation, il démarre sur son disque.${arrete ? ` Son installation en cours (${arrete.isoName ?? 'système'}) est arrêtée : éteins le poste s'il continue seul.` : ''}` };
      }, undo: (i) => ({ action: 'debloquer', input: { mac: s(i.mac) }, label: 'Débloquer' }) },
    { id: 'debloquer', label: 'Débloquer un poste', what: 'Le poste retrouve le menu et les fichiers d\'installation', params: [macParam], quick: false, words: ['débloque le poste', 'débloquer le poste'],
      // Tout ce qui affaiblit la protection demande ton accord : jamais depuis une automatisation ni un autre assistant.
      grave: (i) => `débloquer le poste ${s(i.mac)} : il retrouve le menu et les fichiers d'installation`, run: (ctx, i) => {
      const mac = macDe(i), b = { ...bloques(ctx) }; if (!b[mac]) throw new Error('ce poste n\'est pas bloqué');
      delete b[mac]; ctx.saveSettings({ bloques: b }); for (const [ip, c] of coupees) if (c.mac === mac) coupees.delete(ip);
      noter(ctx, { quoi: 'déblocage', mac, nom: nomDe(ctx, mac, d.live(ctx)[mac]) });
      return { text: `✔ ${titre(ctx, mac, d.live(ctx)[mac])} (${mac}) est débloqué : il retrouve le menu au prochain démarrage par le réseau.` };
    }, undo: (i) => ({ action: 'bloquer', input: { mac: s(i.mac) }, label: 'Bloquer de nouveau' }) },
    { id: 'annuler', label: 'Annuler l\'installation en cours', what: 'Arrête l\'installation d\'un poste : plus de fichiers, plus de jeton, l\'installation automatique ne repart pas ; le poste n\'est pas bloqué', params: [macParam], quick: false,
      grave: (i) => `annuler l'installation en cours sur le poste ${s(i.mac)} : ${TEXTE_ANNULER}`,
      words: ['annule l\'installation'], run: (ctx, i) => {
        const mac = macDe(i), avant = d.live(ctx)[mac]; if (!avant || FINALES.includes(avant.step)) throw new Error('aucune installation en cours sur ce poste');
        if (!lance(avant) && !avant.token) throw new Error('ce poste est au menu : aucune installation n\'est lancée ni prévue (tu peux le bloquer)');
        const etait = lance(avant), m = arreter(ctx, mac, 'annulée', 'installation annulée depuis Odin', 'Odin (action « Annuler l\'installation »)')!, nom = titre(ctx, mac, m);
        ctx.alert({ level: 'info', title: `✋ Installation annulée sur ${nom}`, detail: `Poste ${mac}${m.ip ? ` · ${m.ip}` : ''}${m.isoName ? ` · ${m.isoName}` : ''}. Plus aucun fichier ne lui est servi.`, key: `thjalfi-annulee-${m.id ?? mac}`, data: { mac, id: m.id } });
        return { text: `✋ Installation annulée sur ${nom} (${mac})${m.isoName ? ` : ${m.isoName}` : ''}. ${etait ? 'Plus aucun fichier ne lui est servi ; éteins le poste s\'il continue seul (installateur déjà en mémoire, ou Windows).' : 'Elle n\'avait pas commencé : rien n\'a été écrit sur son disque.'}` };
      } },
    { id: 'suspendre', label: 'Suspendre les installations', what: 'Plus aucune nouvelle installation par le réseau : chaque poste voit le message et démarre sur son disque ; celles déjà lancées finissent', quick: false, words: ['suspends les installations', 'bloque toutes les installations'], run: (ctx) => {
      if (suspendu(ctx)) return { text: 'Les installations sont déjà suspendues.', ok: false };
      ctx.saveSettings({ suspendu: { at: t(ctx) } }); noter(ctx, { quoi: 'suspension' });
      return { text: '⏸ Nouvelles installations suspendues : chaque poste qui démarre par le réseau voit le message et reprend son disque. Les installations déjà lancées finissent.' };
    }, undo: () => ({ action: 'reprendre', input: {}, label: 'Reprendre' }) },
    { id: 'reprendre', label: 'Reprendre les installations', what: 'Les postes retrouvent le menu de démarrage par le réseau', quick: false, words: ['reprends les installations'],
      grave: (_i, ctx) => (!ctx || suspendu(ctx) ? 'reprendre les installations : tout poste du réseau local peut de nouveau en lancer une' : undefined), run: (ctx) => {
      if (!suspendu(ctx)) return { text: 'Les installations ne sont pas suspendues.', ok: false };
      ctx.saveSettings({ suspendu: false }); noter(ctx, { quoi: 'reprise' });
      return { text: '▶ Installations de nouveau possibles.' };
    } },
    { id: 'mot_de_passe', label: 'Mot de passe d\'installation', what: 'Le poste doit le taper avant d\'avoir le menu des systèmes et les fichiers d\'installation ; Odin ne garde que son empreinte ; 5 erreurs bloquent le poste 15 minutes', quick: false,
      // Pas de valeur par défaut qui change un réglage : sans mot de passe ni portée donnés, l'action dit seulement où on en est.
      params: [{ key: 'mot_de_passe', label: `Mot de passe (${LONGUEUR_MIN} caractères au moins ; vide : ne change pas)`, kind: 'password', default: '' }, { key: 'pour', label: 'Demandé pour', kind: 'select', options: [SANS_CHANGER, 'tous les postes', 'postes non autorisés seulement'], default: SANS_CHANGER, help: `« Postes non autorisés seulement » : ${LIMITE_AUTORISES}` }],
      // Changer un mot de passe déjà réglé (l'ancien ne vaut plus, celui qui le change entre) ou le demander à moins de postes : ton accord.
      grave: (i, ctx) => { if (vrai(i.retirer)) return GRAVE_RETIRER; const avant = ctx ? cleCfg(ctx) : undefined; if (!avant) return undefined; if (s(i.mot_de_passe)) return 'changer le mot de passe d\'installation : l\'ancien ne marchera plus, et qui connaît le nouveau peut lancer une installation'; return avant.pour === 'toutes' && /non autoris|inconnus/.test(s(i.pour)) ? `ne plus demander le mot de passe d'installation aux postes autorisés : ${LIMITE_AUTORISES}` : undefined; },
      words: ['mot de passe d\'installation', 'mot de passe du pxe'], run: async (ctx, i) => {
        // (Avant, le retrait passait par ici avec « retirer » : une automatisation qui le fait encore tombe sur la même action grave.)
        if (vrai(i.retirer)) return retirer(ctx);
        const now = t(ctx), avant = cleCfg(ctx), voulu = s(i.pour);
        const mdp = s(i.mot_de_passe), pour: Pour = /non autoris|inconnus/.test(voulu) ? 'inconnus' : /^(toutes|tous)\b/.test(voulu) ? 'toutes' : avant?.pour ?? 'toutes', quoi = pour === 'inconnus' ? 'aux postes non autorisés seulement' : 'à tous les postes';
        const limite = pour === 'inconnus' ? ` Attention : ${LIMITE_AUTORISES}.` : '';
        if (!mdp) {
          if (!avant) return { text: `🔓 Aucun mot de passe d'installation : tout poste du réseau local a le menu des systèmes. Pour en mettre un : donne-le (${LONGUEUR_MIN} caractères au moins).` };
          // Rien n'est demandé (phrase dite sans réglage, formulaire laissé tel quel) : l'état, sans rien enregistrer.
          if (pour === avant.pour) return { text: `🔑 Le mot de passe d'installation est demandé ${quoi}.${limite} Rien n'est changé.` };
          ctx.saveSettings({ cle: { actif: true, pour, depuis: avant.depuis } }); noter(ctx, { quoi: 'réglage', detail: `mot de passe d'installation demandé ${quoi}` });
          return { text: `🔑 Le mot de passe d'installation (inchangé) est demandé ${quoi}.${limite}` };
        }
        const non = refusMotDePasse(mdp); if (non) throw new Error(non);
        const e = await empreinte(mdp);
        d.saveSecrets(ctx, { ...d.secrets(ctx), cle: { e, depuis: now } satisfies CleSecret });
        ctx.saveSettings({ cle: { actif: true, pour, depuis: now } }); passes.vider();
        // Premier mot de passe : les installations déjà lancées gardent le droit de finir (leurs fichiers ne sont pas coupés).
        if (!avant) { const all = d.live(ctx); let n = 0; for (const m of Object.values(all)) if (lance(m) && !m.passe) { m.passe = true; n++; } if (n) d.saveLive(ctx, all); }
        noter(ctx, { quoi: 'réglage', detail: `mot de passe d'installation ${avant ? 'changé' : 'réglé'}, demandé ${quoi}` });
        const clavier = /[^\x20-\x7e]/.test(mdp) ? ' Attention : il contient des caractères qu\'un clavier américain n\'a pas ; il ne pourra être tapé que sur un clavier AZERTY.' : tapeEnAzerty(mdp) !== mdp ? ' Sur le poste, tape-le normalement : iPXE lit le clavier comme un clavier américain, Odin reconnaît aussi la forme tapée sur un AZERTY.' : '';
        return { text: `🔑 Mot de passe d'installation ${avant ? 'changé' : 'réglé'} : demandé ${quoi}, avant le menu des systèmes. Odin ne garde que son empreinte ; ${ESSAIS_MAX} erreurs bloquent le poste 15 minutes (puis 1 h, puis 24 h s'il recommence).${clavier}${limite} Il voyage en clair sur le réseau local (iPXE n'a pas de chiffrement) : ne reprends pas un mot de passe qui sert ailleurs.` };
      } },
    { id: 'retirer_mot_de_passe', label: 'Retirer le mot de passe d\'installation', what: 'Les postes ont de nouveau le menu des systèmes sans rien taper', quick: false,
      grave: () => GRAVE_RETIRER,
      words: ['retire le mot de passe d\'installation', 'enlève le mot de passe d\'installation', 'retire le mot de passe du pxe'], run: (ctx) => retirer(ctx) },
    { id: 'delai_abandon', label: 'Délai d\'abandon', what: 'Sans signe de vie d\'un poste pendant ce temps, son installation est dite abandonnée et Odin prévient', quick: false, params: [{ key: 'minutes', label: 'Minutes sans signe de vie (5 à 720)', kind: 'number', default: 30, required: true }], run: (ctx, i) => {
      const n = Math.round(Number(i.minutes)); if (!(n >= 5 && n <= 720)) throw new Error('entre 5 et 720 minutes');
      ctx.saveSettings({ abandon: n });
      return { text: `⏱ Une installation sans signe de vie depuis ${n} min est dite abandonnée (Windows : 2 h au moins pendant la copie, son installateur ne dit rien).` };
    } },
    { id: 'rapport', label: 'Rapport des installations', what: 'Combien d\'installations sur la période, réussies, échouées, abandonnées, annulées ; par image ; durée moyenne ; export pour un tableur', read: true, quick: false,
      params: [{ key: 'periode', label: 'Période', kind: 'select', options: Object.keys(PERIODES), default: '30 jours' }, { key: 'resultat', label: 'Résultat', kind: 'select', options: Object.keys(RESULTATS), default: 'tous' }, { key: 'q', label: 'Poste, image, numéro de série…', kind: 'text', default: '' }],
      // (« rapport des installations » tout court n'est pas compris directement : trop proche d'autres applis. Seuls les mots qui marchent seuls sont déclarés.)
      words: ['rapport des installations pxe', 'bilan des installations', 'combien d\'installations', 'échecs d\'installation'], run: (ctx, i) => {
        const now = t(ctx), r = rapport(histo(ctx), { now, periode: s(i.periode) || undefined, resultat: s(i.resultat) || undefined, q: s(i.q) }), jours = PERIODES[r.periode], q = s(i.q).trim().toLowerCase();
        const ev = evenements(ctx, 150, (e) => e.quoi !== 'étape' && e.quoi !== 'fin' && (!jours || now - e.at < jours * 864e5) && (!q || [e.mac, e.nom, e.detail].some((v) => v?.toLowerCase().includes(q))));
        return { text: r.texte, data: { ...r, lignes: r.lignes.slice(0, 500), csv: csv(r.lignes), fichier: `installations-genese-${new Date(now).toISOString().slice(0, 10)}.csv`, evenements: ev, alertes: ctx.alerts({ module: 'thjalfi', limit: 60 }).map((a) => ({ at: a.at, niveau: a.level, titre: a.title, detail: a.detail ?? '', fois: a.count })) } };
      } },
  ];

  /** Pour la vue générique (onglet « Tout ») : la protection en place et les postes bloqués. */
  function sections(ctx: ModCtx): Section[] {
    const c = cleCfg(ctx), sus = suspendu(ctx), b = listeBloques(ctx), jour = (x: number) => new Date(x).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    return [
      { kind: 'text', title: 'Protection des installations', tone: sus ? 'attention' : c ? 'bon' : 'neutre', text: `${sus ? `⏸ Nouvelles installations suspendues depuis le ${jour(sus.at)}.` : '▶ Installations possibles.'}\n${c ? `🔑 Mot de passe d'installation demandé ${c.pour === 'inconnus' ? 'aux postes non autorisés' : 'à tous les postes'} (${ESSAIS_MAX} erreurs : poste bloqué 15 min, puis 1 h, puis 24 h).${c.pour === 'inconnus' ? ` Attention : ${LIMITE_AUTORISES}.` : ''}` : '🔓 Pas de mot de passe d\'installation : tout poste du réseau local a le menu.'}\nUn poste bloqué l'est par son adresse MAC (et l'adresse IP d'où il a parlé) : cela arrête un poste qui ne triche pas ; contre quelqu'un qui change d'adresse, c'est le mot de passe qui protège.\nUne installation sans signe de vie depuis ${Math.round(abandonMs(ctx) / 60_000)} min est dite abandonnée.` },
      { kind: 'table', title: 'Postes bloqués', columns: ['Poste', 'Nom', 'Bloqué le', 'Raison'], rows: b.map((x) => ({ cells: [x.mac, x.nom ?? 'poste inconnu', jour(x.at), x.raison || '—'], tone: 'mauvais' as const, actions: [{ action: 'debloquer', label: 'Débloquer', input: { mac: x.mac } }] })), empty: 'Aucun poste bloqué.' },
    ];
  }
  /** Les boutons d'une ligne « en cours » de la vue générique. */
  const boutons = (mac: string) => [{ action: 'annuler', label: 'Annuler', input: { mac } }, { action: 'bloquer', label: 'Bloquer', input: { mac } }];
  return { actions, garde, acces, coupe, refus, cle, vu, servi, apres, fiche, echec, signal, veiller, sections, boutons, raison: raisonLisible, libelle, rate, replier, adresse, garder, recharge, renouer, dejaFini, dejaEchec, cloreJeton, publique, prevenir, fermer: () => lots.fermer(), bloque: (ctx: ModCtx, mac: string) => Boolean(bloques(ctx)[mac]) };
}
