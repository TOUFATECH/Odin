// Heimdall — le gardien d’Iris (les messageries). Chaque appel d'outil passe par ici AVANT d'être exécuté.
//
// Principe clé : l'autorité des outils dépend de
// l'ORIGINE du contenu présent dans la conversation (« taint tracking »). Une page web
// ou un message d'inconnu peut contenir une injection ; dès qu'il est lu, Odin perd le
// droit d'écrire, d'exécuter ou d'envoyer quoi que ce soit sans validation humaine.
// C'est vérifié par le code, pas par le prompt.

import { GRAVE_ACCEPTER, GRAVE_RESTAURER, GRAVE_NOYAU, GRAVE_SENSIBLE, estSensible, graveNoyau, integriteNoyau, nomVuParWindows, RACINE_APPLI } from './noyau.ts';
import { GRAVE_MAISON } from './maison.ts';
import { appendFileSync, lstatSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { OdinConfig, PolicyMode } from '../config.ts';
import type { Risk } from '../types.ts';
import { DEFAULT_BREAKER, effectiveAutonomy, type BreakerConfig } from '../mimir/decisions.ts';

export const RISK_ORDER: Risk[] = ['read', 'write', 'network', 'exec', 'external'];
export const riskRank = (r: Risk): number => RISK_ORDER.indexOf(r);
/** Les actions ENGAGEANTES (écrire, exécuter, envoyer) ; lire et consulter le réseau ne le sont pas. */
const ENGAGEANT = new Set<Risk>(['write', 'exec', 'external']);

export type Severity = 'routine' | 'important' | 'grave' | 'blocked';

export interface ApprovalRequest {
  id: string;
  tool: string;
  risk: Risk;
  summary: string;
  reason: string;
  sessionId: string;
  /** Gravité estimée par Mímir (si disponible). */
  severity?: Severity;
  /** L'utilisateur peut répondre « toujours » (autorisation permanente) ; jamais pour le grave. */
  grantable: boolean;
}

/** Réponse humaine : oui, non, ou oui « toujours » (autorisation permanente pour ce type d'action). */
export type ApprovalAnswer = boolean | 'always';

/** Qui valide : terminal, propriétaire sur Telegram, interface web, refus automatique (tâches planifiées)… */
export interface Approver {
  approve(req: ApprovalRequest): Promise<ApprovalAnswer>;
}

/** Autorisations permanentes données par l'utilisateur (« toujours autoriser npm test »). */
export interface GrantStore {
  find(key: string): { id: number } | undefined;
  add(key: string, tool: string, example: string): void;
  touch(id: number): void;
}

/** Confiance apprise de tes habitudes (voir learn/habits.ts). */
export interface HabitTrustStore {
  trusted(key: string): { yes: number } | undefined;
  touch(key: string): void;
  record(key: string, tool: string, example: string, yes: boolean): void;
}

export const denyAll: Approver = { approve: async () => false };
export const allowAll: Approver = { approve: async () => true };

export interface GateInput {
  tool: string;
  risk: Risk;
  summary: string;
  sessionId: string;
  tainted: boolean;
  /** Pour l'outil shell : la commande exacte, contrôlée par les règles dédiées. */
  command?: string;
  unattended?: boolean;
  /** Ce que le propriétaire a demandé dans ce tour (vide si l'auteur n'est pas le propriétaire). */
  userRequest?: string;
  /** Un contenu manipulateur a été détecté dans ce tour (Mímir ou règles). */
  suspicious?: boolean;
  /** Simple consultation du web (recherche, lecture de page) : pas de validation. */
  lookup?: boolean;
  /** Le tour de conversation (posé par l'agent) : pour compter les envois d'un même tour. */
  tour?: string;
  /** Un vrai envoi vers l'extérieur (un destinataire, une requête qui écrit) — posé par executer.ts. */
  envoi?: boolean;
  /** Le destinataire d'un envoi à un tiers (posé par executer.ts) : un destinataire jamais vu met le tour en pause. */
  destinataire?: string;
  /** Accord donné d'avance par le propriétaire (ex. le script qu'il a programmé lui-même) : vaut validation. */
  accordPrealable?: string;
  /** Tâche automatique (pas le propriétaire) : « demandé par toi » n'y vaut jamais pour une action engageante. */
  automatique?: boolean;
  /** Une commande système qui touche au code d'Odin (« code ») ou à la référence de son noyau (« reference »). */
  commandeCode?: 'reference' | 'code';
  /** Le changement du code, montré tel quel dans la demande de validation (lignes retirées / ajoutées). */
  changement?: string;
  /** Fichiers du CODE D'ODIN que cet appel va écrire (relatifs à sa racine ; posé par executer.ts). */
  cheminsCode?: string[];
  /** Clé d'autorisation permanente (ex. « shell:npm test », « fs_write:notes »). */
  grantKey?: string;
  /** Plafond d'autonomie pour ce tour (membre de la famille) : jamais au-dessus, même en Breaker. */
  maxAutonomy?: Autonomy;
  /** L'outil lui-même déclare l'action grave (ex. installer un programme malgré des alertes de sécurité) : toujours ton accord. */
  grave?: string;
}

export type Via = 'policy' | 'human' | 'mimir' | 'grant' | 'breaker';
export type GateDecision =
  | { allowed: true; via: Via; severity?: Severity; why?: string; notes?: string[] }
  | { allowed: false; reason: string; severity?: Severity; notes?: string[] };

/** Avis de Mímir sur une action : une gravité et une explication. Le code de Heimdall garde le dernier mot. */
export type Review = { severity: Severity; reason: string; flags: string[]; requested?: 'yes' | 'no' | 'unsure'; argent?: 'oui' | 'incertain' };
/** Lève une erreur si le juge est indisponible (jamais lu comme un « non »). */
export type Reviewer = (g: GateInput) => Promise<Review>;
export type Autonomy = 'prudent' | 'equilibre' | 'autonome' | 'breaker';
/** Niveaux de risque soumis à la revue (la lecture et le simple téléchargement n'en ont pas besoin). */
const REVIEWED: Risk[] = ['write', 'exec', 'external'];

// Commandes refusées dans TOUS les cas, même avec validation humaine.
const HARD_DENY: RegExp[] = [
  /\brm\s+(?:(?:-[a-z]*|--[a-z-]+)\s+)*(?:-[a-z]*(?:r[a-z]*f|f[a-z]*r)[a-z]*|--recursive\s+(?:-[a-z]*f|--force)|(?:-[a-z]*f|--force)\s+--recursive|-r\s+-f|-f\s+-r)(?:\s+(?:-[a-z]*|--[a-z-]+))*\s+["']?(?:\/\*?|~\/?|\$HOME\/?|\*|\/\w+\/?\*?)["']?(?:\s|$)/i,
  /\bmkfs(\.\w+)?\b/,
  /\bdd\s+[^|]*of=\/dev\//,
  /:\(\)\s*\{\s*:\|:&\s*\};:/,                  // fork bomb
  /\b(shutdown|reboot|halt|poweroff)\b/,
  /\bchmod\s+(-R\s+)?[0-7]*777\s+\//,
  />\s*\/dev\/sd[a-z]/,
  /\b(curl|wget)\b[^\n]*\|\s*(sudo\s+)?(ba|z)?sh\b/,
  /\bhistory\s+-c\b/,
  // Effacements massifs déguisés ou indirects
  /\bfind\s+(?:\/|~|\$HOME)(?:\s|$)[^\n]*(?:-delete\b|-exec\s+(?:sudo\s+)?rm\b)/,
  /\bbase64\s+(?:-d|--decode)\b[^\n]*\|\s*(?:sudo\s+)?(?:ba|z|da|k)?sh\b/,
  /\b(?:ba|z)?sh\s+<\(\s*(?:curl|wget)\b/,
  /\b(?:shred|wipefs|blkdiscard|sgdisk\s+(?:-Z|--zap-all)|sfdisk\s+--delete)\b[^\n]*\/dev\//,
  />\s*\/dev\/(?:sd[a-z]|nvme\d|vd[a-z]|xvd[a-z]|hd[a-z]|mmcblk\d|disk\d)/,
  /\b(?:chmod|chown|chgrp)\s+(?:-[a-zA-Z]*R[a-zA-Z]*|--recursive)\s+(?:\S+\s+)?(?:\/|\/(?:etc|usr|bin|boot|var|home|root|lib)\/?)(?:\s|$)/,
  /\bkill(?:all)?\s+(?:-\w+\s+)*(?:1|-1)(?:\s|$)/,
  /\brmtree\(\s*['"](?:\/|~|\/home|\/etc|\/root)['"]/,
  /\bmv\s+(?:-\w+\s+)*\/(?:\s|$)/,
  /\brm\s+(?:-[a-z]*\s+)*-[a-z]*r[a-z]*\b[^\n]*\.odin(?:\/|\s|$)/i,     // le cerveau d'Odin
  /\bpasswd\s+(?:-d|--delete)\s+root\b|\buserdel\s+(?:-\w+\s+)*root\b/,
  />\s*\/etc\/(?:passwd|shadow|sudoers|group)\b|\btruncate\s+[^\n]*\/etc\/(?:passwd|shadow|sudoers)\b/,
  /\bzpool\s+destroy\b|\b(?:vgremove|pvremove)\b|\blvremove\s+(?:-\w+\s+)*pve\/(?:data|root)\b/,
  // Windows
  /\bformat(\.com)?\s+[a-z]:/i,
  /\b(rd|rmdir)\s+\/s\s+(\/q\s+)?[a-z]:\\?(\s|$)/i,
  /\bRemove-Item\b[^\n]*-Recurse[^\n]*\s[a-z]:\\?(\s|$)/i,
  /\b(iwr|irm|Invoke-WebRequest|Invoke-RestMethod)\b[^\n]*\|\s*iex\b/i,
  /\bStop-Computer\b|\bRestart-Computer\b/i,
  /\bbcdedit\b|\bdiskpart\b/i,
];

// Actions qui peuvent couper l'accès à la machine ou détruire une VM : toujours validées par toi.
const LOCKOUT: Array<[RegExp, string]> = [
  [/\bsystemctl\s+(?:stop|disable|mask|kill)\b[^\n]*\b(?:ssh|sshd|odin|tailscaled?|cloudflared|networking|NetworkManager|systemd-networkd|pveproxy|pvedaemon)\b/, 'cela peut couper l\'accès à la machine'],
  [/\b(?:iptables|ip6tables)\s+(?:-\w+\s+)*(?:-P\s+(?:INPUT|OUTPUT)\s+DROP|-F\b|--flush\b)|\bnft\s+flush\s+ruleset\b|\bufw\s+(?:default\s+deny|enable)\b/, 'cela change le pare-feu et peut te couper l\'accès'],
  [/\b(?:ip\s+link\s+set\s+\S+\s+down|ifdown|nmcli\s+(?:networking\s+off|con(?:nection)?\s+down))\b/, 'cela coupe le réseau de la machine'],
  [/\bqm\s+destroy\b|\bpct\s+destroy\b|\bpvesh\s+delete\s+\/nodes\/[^\s]+\/(?:qemu|lxc)\/\d+|\bvirsh\s+undefine\b/, 'cela supprime une machine virtuelle entière'],
  [/\b(?:userdel|deluser)\b|\bpasswd\b|\bchpasswd\b|\busermod\s+[^\n]*-(?:L|-lock|s\s*\/(?:usr\/)?s?bin\/(?:nologin|false))\b/, 'cela touche un compte ou un mot de passe'],
  [/\bcrontab\s+-r\b/, 'cela efface toutes les tâches planifiées du système'],
];
export const lockoutRisk = (cmd: string): string | undefined => { const plain = cmd.replace(/["'\\]/g, ''); return LOCKOUT.find(([re]) => re.test(cmd) || re.test(plain))?.[1]; };

/** Une commande (ou un script) contient-elle une action destructrice interdite ? */
export const hardDenied = (text: string): string | undefined => {
  // On teste aussi la commande « dé-déguisée » : guillemets et antislashs retirés (r''m, r\m, "rm"),
  // $(echo x) et `echo x` remplacés par x — pour qu'un découpage ne contourne pas la liste.
  const plain = text.replace(/\$\(\s*(?:echo|printf)\s+['"]?([\w./-]+)['"]?\s*\)|`\s*(?:echo|printf)\s+['"]?([\w./-]+)['"]?\s*`/g, (_m, a, b) => a ?? b).replace(/["'\\]/g, '');
  for (const v of [text, plain, plain.replace(/[()]/g, ' ')]) { const hit = HARD_DENY.find((re) => re.test(v)); if (hit) return hit.source; }
  return undefined;
};

// Constructions qui rendent une liste blanche inefficace : toujours validation humaine.
const SHELL_META = /[;&|`$<>]|\$\(|\n/;

export class Heimdall {
  private seq = 0;
  private cfg: OdinConfig['policy'];
  private approver: Approver;
  private auditFile: string | undefined;
  constructor(cfg: OdinConfig['policy'], approver: Approver, auditFile?: string) {
    this.cfg = cfg; this.approver = approver; this.auditFile = auditFile;
  }

  private reviewer: Reviewer | undefined;
  private autonomy: Autonomy = 'prudent';
  private grants: GrantStore | undefined;

  setApprover(a: Approver): void { this.approver = a; }

  /** Branche Mímir et fixe le niveau d'autonomie (prudent, equilibre, autonome). */
  setReviewer(r: Reviewer | undefined, autonomy: Autonomy = 'equilibre'): void { this.reviewer = r; this.autonomy = autonomy; }
  setGrantStore(g: GrantStore | undefined): void { this.grants = g; }
  private habits: HabitTrustStore | undefined;
  setHabitStore(h: HabitTrustStore | undefined): void { this.habits = h; }
  setAutonomy(a: Autonomy): void { this.autonomy = a; }
  /** Le réglage « validation du code » (code.validation), lu à chaque décision : « chaque-fois » (défaut) ou « jamais ». */
  private validationCode: () => string = () => 'chaque-fois';
  setValidationCode(f: () => string | undefined): void { this.validationCode = () => f() ?? 'chaque-fois'; }
  // U5 — comportement inhabituel : plus de 3 envois vers l'extérieur dans un même tour, un destinataire jamais vu, ou
  // plus de 10 écritures en une minute → le tour s'arrête sur une validation (l'alerte), reprise seulement avec ton accord.
  // Par TOUR (relecture du lot S, constat 4) : les vrais envois (un destinataire, une requête qui écrit), et les écritures
  // de moins d'une minute ; seules les actions PERMISES sont comptées (log). Lumières, clics, lectures ne comptent pas.
  private envoisParTour = new Map<string, number>();
  private ecrituresParTour = new Map<string, number[]>();
  private cleTour = (g: GateInput): string => g.tour ?? g.sessionId;
  private compter(g: GateInput, maintenant = Date.now()): void {
    const k = this.cleTour(g);
    if (g.envoi) { this.envoisParTour.set(k, (this.envoisParTour.get(k) ?? 0) + 1); if (this.envoisParTour.size > 500) this.envoisParTour.delete(this.envoisParTour.keys().next().value!); }
    if (g.risk === 'write' && !g.lookup) {
      this.ecrituresParTour.set(k, [...(this.ecrituresParTour.get(k) ?? []).filter((t) => maintenant - t < 60_000), maintenant]);
      if (this.ecrituresParTour.size > 500) this.ecrituresParTour.delete(this.ecrituresParTour.keys().next().value!);
    }
  }
  private destinatairesConnus: Set<string> | undefined;
  private fichierDestinataires(): string | undefined { return this.auditFile ? join(dirname(this.auditFile), 'destinataires-connus.json') : undefined; }
  private connus(): Set<string> {
    if (!this.destinatairesConnus) { this.destinatairesConnus = new Set(); const f = this.fichierDestinataires(); try { if (f) for (const d of JSON.parse(readFileSync(f, 'utf8')) as string[]) this.destinatairesConnus.add(d); } catch { /* aucun encore */ } }
    return this.destinatairesConnus;
  }
  private retenirDestinataire(d: string): void {
    const s = this.connus(); if (s.has(d)) return; s.add(d);
    const f = this.fichierDestinataires(); try { if (f) { mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, JSON.stringify([...s].slice(-2000))); } } catch { /* rien */ }
  }
  private inhabituel(g: GateInput, maintenant = Date.now()): string | undefined {
    const raisons: string[] = [];
    const k = this.cleTour(g);
    if (g.envoi) { const n = (this.envoisParTour.get(k) ?? 0) + 1; if (n > 3) raisons.push(`${n}e envoi vers l'extérieur dans ce même tour`); }
    if (g.destinataire && !this.connus().has(g.destinataire)) raisons.push(`destinataire jamais vu (${g.destinataire})`);
    if (g.risk === 'write' && !g.lookup) {
      const n = (this.ecrituresParTour.get(k) ?? []).filter((t) => maintenant - t < 60_000).length + 1;
      if (n > 10) raisons.push(`${n} écritures en moins d'une minute`);
    }
    return raisons.length ? `comportement inhabituel, je mets le tour en pause : ${raisons.join(' ; ')}` : undefined;
  }

  /** L'intégrité du noyau avant chaque action engageante (branchée par le runtime ; absente dans un Heimdall d'essai). */
  private integrite: (() => { ecarts: Array<{ fichier: string }> }) | undefined;
  verifierIntegrite(racine = RACINE_APPLI): void { this.integrite = () => integriteNoyau(racine); }

  /**
   * La règle unique de la réécriture du code (self_edit, fs_write, fs_edit dans le dossier d'Odin) :
   *  - un membre ou un invité : refusé (seul le propriétaire fait réécrire le code) ;
   *  - le NOYAU : toujours ta validation (grave), quel que soit le réglage ;
   *  - contenu extérieur lu, tâche automatique, ou réglage « chaque-fois » : ta validation (grave) ;
   *  - réglage « jamais », propriétaire, conversation propre : permis, sans question (compte rendu ensuite).
   */
  private regleCode(g: GateInput): { refus: string } | { grave: string } | { libre: string } | undefined {
    // Une commande système : refaire la référence du noyau n'est JAMAIS lancé par Odin lui-même ; toucher au dossier du
    // code = code sensible (toujours ta validation, la commande montrée). Contre une commande qui ne se nomme pas, seule
    // la séparation des comptes tient (le dossier du code à un autre compte, en lecture seule pour Odin).
    if (g.commandeCode === 'reference') return { refus: 'refaire la référence de mes garde-fous n\'est jamais lancé par moi : c\'est la publication, une mise à jour, ou ton « accepter cette version »' };
    if (g.commandeCode === 'code') {
      if (g.maxAutonomy !== undefined) return { refus: 'seul le propriétaire peut faire réécrire mon code' };
      return { grave: `${GRAVE_SENSIBLE} par une commande système, montrée telle quelle :\n${g.changement ?? g.summary}` };
    }
    const fichiers = g.cheminsCode ?? [];
    if (!fichiers.length) return undefined;
    if (g.maxAutonomy !== undefined) return { refus: 'seul le propriétaire peut faire réécrire mon code' };
    const voir = g.changement ? `\nLe changement :\n${g.changement}` : '';
    const noyau = fichiers.map((x) => graveNoyau(x)).find(Boolean);
    if (noyau) return { grave: `${noyau}${voir}` };
    const liste = fichiers.slice(0, 5).join(', ');
    // Le code sensible : toujours ta validation, même avec « jamais », et tu vois le changement.
    if (fichiers.some((x) => estSensible(x))) return { grave: `${GRAVE_SENSIBLE} : ${liste}${voir}` };
    if (g.tainted) return { grave: `réécrire mon code (${liste}) après la lecture d'un contenu extérieur${voir}` };
    if (g.unattended) return { grave: `réécrire mon code (${liste}) depuis une tâche automatique${voir}` };
    if (this.validationCode() !== 'jamais') return { grave: `réécrire mon code (${liste}) — tu m'as demandé de te le demander à chaque fois${voir}` };
    return { libre: `réécriture de mon code (${liste}) sans validation : ton réglage « jamais »` };
  }
  getAutonomy(): Autonomy { return this.autonomy; }
  private breaker: BreakerConfig = DEFAULT_BREAKER;
  setBreaker(b: BreakerConfig): void { this.breaker = b; }
  getBreaker(): BreakerConfig { return this.breaker; }
  /** Niveau appliqué à l'instant (tient compte de la plage horaire de Breaker). */
  effectiveAutonomy(now = new Date()): Autonomy { return effectiveAutonomy(this.autonomy, this.breaker, now); }
  breakerActive(now = new Date()): boolean { return this.effectiveAutonomy(now) === 'breaker'; }

  /** Décide si un appel d'outil peut s'exécuter. */
  async gate(g: GateInput): Promise<GateDecision> {
    if (g.command !== undefined) {
      const hardSrc = hardDenied(g.command!); const hard = hardSrc ? { source: hardSrc } : undefined;
      if (hard) return this.log(g, { allowed: false, reason: `commande interdite (règle ${hard.source})` });
    }

    let mode: PolicyMode = this.cfg.modes[g.risk];
    const notes: string[] = [];
    // Actions qui peuvent te couper l'accès ou détruire une machine virtuelle entière : jamais seul, même
    // en Breaker, même avec une autorisation permanente — toujours ta validation explicite.
    // Intégrité : un garde-fou changé hors de la version de référence (par une commande système, à la main…) bloque
    // toute action engageante jusqu'à ta décision — sauf les deux outils qui la tranchent (toujours par ton bouton).
    if (this.integrite && ENGAGEANT.has(g.risk) && g.tool !== 'self_restore_core' && g.tool !== 'self_accept_core') {
      let ecarts: Array<{ fichier: string }> = []; try { ecarts = this.integrite().ecarts; } catch { /* rien */ }
      if (ecarts.length) return this.log(g, { allowed: false, severity: 'grave', reason: `mes garde-fous ont changé hors de la version de référence (${ecarts.map((e) => e.fichier).join(', ')}) : plus aucune action engageante avant ta décision — « restaurer le noyau » ou « accepter cette version »` });
    }
    // Changer un réglage après un contenu extérieur : refusé tout de suite (l'outil le refuserait après ta réponse).
    if (g.tool === 'settings_set' && g.tainted) return this.log(g, { allowed: false, reason: 'je ne change pas mes réglages dans une conversation qui a lu un contenu extérieur' });
    // La réécriture du code (une seule règle pour toutes les portes, lue dans le réglage code.validation).
    const code = this.regleCode(g);
    if (code && 'refus' in code) return this.log(g, { allowed: false, reason: code.refus });
    if (code && 'libre' in code && !g.grave) return this.log(g, { allowed: true, via: 'policy', why: code.libre });
    const pause = this.inhabituel(g);
    const lockBase = g.grave ?? (code && 'grave' in code ? code.grave : undefined) ?? (g.command !== undefined ? lockoutRisk(g.command) : undefined);
    const lock = lockBase && pause ? `${lockBase} ; ${pause}` : lockBase ?? pause;
    // Les garde-fous d'Odin (son noyau) : jamais depuis une conversation qui a lu du contenu extérieur — refus
    // immédiat, sans même te le demander (une page piégée ne doit pas pouvoir obtenir ton « oui » par lassitude).
    // Ouvrir ou désarmer la maison : jamais depuis une tâche automatique, un invité ou un membre, ni après un contenu extérieur.
    if (lock && lock.startsWith(GRAVE_MAISON) && (g.tainted || g.unattended || g.automatique || g.maxAutonomy !== undefined)) return this.log(g, { allowed: false, severity: 'grave', reason: `${lock} : jamais depuis une tâche automatique, un invité ou après la lecture d'un contenu extérieur` });
    // Accepter ou restaurer les garde-fous : jamais après un contenu extérieur, jamais d'une tâche automatique ou sans toi.
    if (lock && (lock.startsWith(GRAVE_ACCEPTER) || lock.startsWith(GRAVE_RESTAURER)) && (g.tainted || g.unattended || g.automatique || g.maxAutonomy !== undefined)) return this.log(g, { allowed: false, severity: 'grave', reason: `${lock.split('\n')[0]} : seulement toi, dans une conversation propre (ou le bouton des Réglages)` });
    if (lock && lock.startsWith(GRAVE_NOYAU) && g.tainted) return this.log(g, { allowed: false, severity: 'grave', reason: `${lock} : jamais après la lecture d'un contenu extérieur (recommence dans une conversation propre)` });
    if (lock) {
      if (mode === 'deny') return this.log(g, { allowed: false, reason: `niveau « ${g.risk} » interdit par la configuration` });
      // Les refus plus forts passent AVANT la question : contenu manipulateur et envoi, ou exfiltration jugée par Mímir.
      if (g.suspicious && g.risk === 'external') return this.log(g, { allowed: false, reason: 'un contenu manipulateur a été détecté dans cette conversation : envoi bloqué' });
      if (g.tainted && this.reviewer && REVIEWED.includes(g.risk)) { try { const r = await this.reviewer(g); if (r.severity === 'blocked') return this.log(g, { allowed: false, severity: 'blocked', reason: `Mímir : ${r.reason}`, notes: [`Mímir : ${r.flags.join(', ') || 'aucun constat'}`] }); } catch { /* juge indisponible : la question est posée */ } }
      // Personne pour répondre (tâche sans surveillance) : refus tout de suite, sans faire attendre la tâche.
      // (seulement pour les verrous du lot sûreté : envoi en ton nom, argent, code, maison, comportement inhabituel)
      if (g.unattended && /^(envoyer en ton nom|paiement possible|réécrire mon code|modifier un garde-fou|ouvrir ou désarmer|comportement inhabituel)|; comportement inhabituel/.test(lock)) return this.log(g, { allowed: false, severity: 'grave', reason: `${lock} : validation requise mais exécution sans surveillance` });
      const req: ApprovalRequest = { id: `a${Date.now().toString(36)}${(this.seq++).toString(36)}`, tool: g.tool, risk: g.risk, summary: g.summary, reason: `GRAVE : ${lock}, je ne le fais jamais sans ton accord`, sessionId: g.sessionId, severity: 'grave', grantable: false };
      const ok = await withTimeout<ApprovalAnswer>(this.approver.approve(req), this.cfg.approvalTimeoutSec * 1000, false);
      if (ok && g.destinataire) this.retenirDestinataire(g.destinataire);
      return this.log(g, ok ? { allowed: true, via: 'human', severity: 'grave', why: lock } : { allowed: false, severity: 'grave', reason: `${lock} : refusé ou sans réponse` });
    }
    // Recherche web et lecture de pages : jamais de validation (Odin cite ses sources), même après
    // avoir lu du contenu non fiable — sauf si le réseau est interdit ou une manipulation détectée.
    if (g.lookup && mode !== 'deny' && !g.suspicious) return this.log(g, { allowed: true, via: 'policy', why: 'consultation en lecture seule (web, agenda, réseau de la maison)' });
    let autonomy = capAutonomy(this.effectiveAutonomy(), g.maxAutonomy);
    if (g.maxAutonomy && autonomy !== this.effectiveAutonomy()) notes.push(`membre : autonomie plafonnée à ${autonomy}`);
    // Un membre de la famille (décision du propriétaire, 17/11) : ce qu'il demande LUI-MÊME et qui est dans la liste
    // (SANS_RISQUE_MEMBRE) part seul ; toute autre action engageante t'est demandée, quel que soit son niveau d'autonomie.
    // Ni une conversation marquée, ni un contenu manipulateur, ni une tâche automatique ou sans surveillance.
    if (g.maxAutonomy !== undefined && ENGAGEANT.has(g.risk)) {
      const chose = !g.tainted && !g.suspicious && !g.automatique && !g.unattended ? sansRisqueMembre(g.tool, g.summary) : undefined;
      if (chose && mode !== 'deny') { mode = 'allow'; notes.push(`membre de la famille (${g.sessionId}) : ${chose}, permis sans ta validation`); }
      else { autonomy = 'prudent'; if (mode === 'allow') { mode = 'ask'; notes.push('membre de la famille : hors de ce qu\'il fait faire seul, ta validation'); } }
    }

    // Liste blanche shell : seulement pour des commandes simples, sans métacaractères.
    if (g.command !== undefined && mode === 'ask' && g.maxAutonomy === undefined && this.isAllowlisted(g.command)) {
      mode = 'allow';
      notes.push('commande en liste blanche');
    }

    // Escalade par marquage : contenu non fiable lu → validation obligatoire.
    if (g.tainted && mode === 'allow' && riskRank(g.risk) >= riskRank(this.cfg.taintEscalatesFrom)) {
      mode = 'ask';
      notes.push('la conversation contient du contenu non fiable (web, inconnu)');
    }
    // Une tâche automatique transporte des données non fiables (noms d'appareils, messages) : même escalade, pour les
    // actions engageantes (lire et consulter restent libres).
    if (g.automatique && mode === 'allow' && ENGAGEANT.has(g.risk) && !SANS_RISQUE_AUTOMATIQUE.has(g.tool) && !PROPOSE_SEUL.has(g.tool)) { mode = 'ask'; notes.push("tâche automatique : ce n'est pas toi"); }

    if (mode === 'deny') return this.log(g, { allowed: false, reason: `niveau « ${g.risk} » interdit par la configuration` });

    // Contenu manipulateur détecté dans ce tour : aucun envoi vers l'extérieur.
    if (g.suspicious && g.risk === 'external') {
      return this.log(g, { allowed: false, reason: 'un contenu manipulateur a été détecté dans cette conversation : envoi bloqué' });
    }

    // Revue par Mímir : le juge estime la gravité, ce code décide selon le niveau d'autonomie.
    let review: Review | undefined;
    if (this.reviewer && REVIEWED.includes(g.risk)) {
      try { review = await this.reviewer(g); } catch (e) { notes.push(`Mímir indisponible (${(e as Error).message.slice(0, 80)}) : politique de base appliquée`); }
    }
    // Une tâche automatique n'est pas toi : rien n'y est « demandé par toi » quand l'action engage quelque chose.
    if (review && g.automatique && ENGAGEANT.has(g.risk) && review.requested === 'yes') { review = { ...review, requested: 'no' }; notes.push('tâche automatique : jamais « demandé par toi »'); }
    // L'argent : « dépense oui » ou « incertain » selon le juge → ta validation, quel que soit le mode (Breaker compris),
    // jamais d'autorisation « toujours ». (La garde en code, sans modèle, passe par executer.ts → paiement.ts.)
    if (review?.argent) {
      const why = review.argent === 'oui' ? 'cette action engage de l\'argent' : 'cette action pourrait engager de l\'argent';
      if (g.unattended) return this.log(g, { allowed: false, severity: 'grave', reason: `${why} : jamais depuis une tâche automatique sans toi`, notes });
      const req: ApprovalRequest = { id: `a${Date.now().toString(36)}${(this.seq++).toString(36)}`, tool: g.tool, risk: g.risk, summary: g.summary, reason: `GRAVE : ${why}, je ne le fais jamais sans ton accord`, sessionId: g.sessionId, severity: 'grave', grantable: false };
      const ok = await withTimeout<ApprovalAnswer>(this.approver.approve(req), this.cfg.approvalTimeoutSec * 1000, false);
      return this.log(g, ok ? { allowed: true, via: 'human', severity: 'grave', why, notes } : { allowed: false, severity: 'grave', reason: `${why} : refusé ou sans réponse`, notes });
    }
    if (review) {
      const sev = review.severity;
      notes.push(`Mímir : ${review.flags.join(', ') || 'aucun constat'}`);
      if (sev === 'blocked') return this.log(g, { allowed: false, severity: sev, reason: `Mímir : ${review.reason}`, notes });
      if (mode === 'allow') {
        // Action déjà permise par la politique : seule une gravité « grave » la fait remonter jusqu'à toi.
        if (sev === 'grave') mode = 'ask';
        else return this.log(g, { allowed: true, via: 'policy', severity: sev, why: review.reason, notes });
      } else if (autonomy !== 'prudent') {
        const clean = !g.tainted && !g.suspicious && !(g.automatique && ENGAGEANT.has(g.risk));
        if (sev === 'routine' && clean) return this.log(g, { allowed: true, via: 'mimir', severity: sev, why: review.reason, notes });
        if (sev === 'important' && clean) {
          // Tu l'as demandé toi-même, clairement : Odin le fait, sans te reposer la question.
          // (Le grave reste toujours soumis à ton accord ; une page ou un mail ne compte jamais comme ta demande.)
          // Sauf une suppression ou une action difficile à annuler : là, ton accord reste demandé.
          if (review.requested === 'yes' && !review.flags.some((f) => /supprime|difficile à annuler|incertain/.test(f))) return this.log(g, { allowed: true, via: 'mimir', severity: sev, why: `tu l'as demandé : ${review.reason}`, notes });
          const grant = g.grantKey ? this.grants?.find(g.grantKey) : undefined;
          if (grant) { this.grants!.touch(grant.id); return this.log(g, { allowed: true, via: 'grant', severity: sev, why: `autorisation permanente « ${g.grantKey} »`, notes }); }
          // Appris de tes habitudes : tu l'as accepté plusieurs fois de suite, jamais refusé.
          const habit = g.grantKey ? this.habits?.trusted(g.grantKey) : undefined;
          if (habit) { this.habits!.touch(g.grantKey!); return this.log(g, { allowed: true, via: 'grant', severity: sev, why: `habitude apprise : tu l'as accepté ${habit.yes} fois sans jamais refuser`, notes }); }
          if (autonomy === 'autonome' || autonomy === 'breaker') return this.log(g, { allowed: true, via: 'mimir', severity: sev, why: `${review.reason} (mode autonome)`, notes });
        }
      }
    }

    if (mode === 'allow') return this.log(g, { allowed: true, via: 'policy', ...(notes.length ? { notes } : {}) });
    // Un accord donné d'avance par le propriétaire (un script qu'il a programmé lui-même, dans une conversation propre) :
    // vaut sa validation, sauf si le juge voit quelque chose de grave (les verrous du lot sûreté restent au-dessus).
    if (g.accordPrealable && !g.tainted && !g.automatique && review?.severity !== 'grave') return this.log(g, { allowed: true, via: 'grant', severity: review?.severity, why: g.accordPrealable, notes });

    // Odin Breaker : plus aucune question, grave et tâches planifiées compris. Les seuls refus
    // restants sont plus haut : commandes destructrices connues, exfiltration, page piégée.
    if (autonomy === 'breaker') {
      const sev = review?.severity;
      // Garde-fou anti-attaque : après lecture d'un contenu non fiable, une action grave que tu
      // n'as pas demandée (ou une commande/un envoi sans juge pour le vérifier) vient sans doute
      // de la page, pas de toi : refusée, sans te déranger.
      if (g.tainted && review && sev === 'grave' && review.requested !== 'yes') {
        return this.log(g, { allowed: false, severity: sev, reason: `Odin Breaker : action grave non demandée, suggérée par un contenu non fiable (${review.reason})`, notes });
      }
      if (g.tainted && !review && (g.risk === 'exec' || g.risk === 'external')) {
        return this.log(g, { allowed: false, reason: 'Odin Breaker : commande ou envoi après lecture d\'un contenu non fiable, sans juge pour vérifier que tu l\'as demandé', notes });
      }
      // Après un contenu extérieur, rien d'engageant sans toi, même en Breaker : seule TA demande (userRequest, jugée
      // par Mímir) compte, jamais ce que la page ou le mail réclame → la validation t'est demandée (refus sans personne).
      if ((g.tainted || g.automatique) && ENGAGEANT.has(g.risk) && review?.requested !== 'yes') notes.push("Odin Breaker : contenu extérieur lu, action engageante que tu n'as pas demandée");
      else return this.log(g, { allowed: true, via: 'breaker', severity: sev, why: `Odin Breaker${sev ? ` (${sev})` : ''}${review ? ` : ${review.reason}` : ''}`, notes });
    }

    // mode 'ask' — sans humain disponible (tâche planifiée), on refuse.
    if (g.unattended) return this.log(g, { allowed: false, severity: review?.severity, reason: 'validation requise mais exécution sans surveillance', notes });
    const grantable = Boolean(g.grantKey && this.grants && review && review.severity === 'important' && !g.tainted && !g.suspicious && autonomy !== 'prudent');
    const req: ApprovalRequest = {
      id: `a${Date.now().toString(36)}${(this.seq++).toString(36)}`,
      tool: g.tool,
      risk: g.risk,
      summary: g.summary,
      reason: review ? `${review.severity === 'grave' ? 'GRAVE' : 'Important'} : ${review.reason}` : notes.join(' ; ') || `niveau « ${g.risk} » soumis à validation`,
      sessionId: g.sessionId,
      severity: review?.severity,
      grantable,
    };
    let replied = false;
    const answer = await withTimeout<ApprovalAnswer>(this.approver.approve(req).then((a) => { replied = true; return a; }), this.cfg.approvalTimeoutSec * 1000, false);
    // Ta réponse (pas un délai dépassé) nourrit la confiance apprise, pour les actions « importantes » propres.
    if (replied && g.grantKey && review?.severity === 'important' && !g.tainted && !g.suspicious) { try { this.habits?.record(g.grantKey, g.tool, g.summary, Boolean(answer)); } catch { /* jamais bloquant */ } }
    if (answer === 'always' && grantable) {
      this.grants!.add(g.grantKey!, g.tool, g.summary.slice(0, 200));
      notes.push(`autorisation permanente ajoutée : « ${g.grantKey} »`);
    }
    return this.log(g, answer ? { allowed: true, via: 'human', severity: review?.severity, why: `${answer === 'always' && grantable ? 'autorisé par toi, pour toujours' : 'autorisé par toi'} — ${req.reason}`, notes } : { allowed: false, severity: review?.severity, reason: 'refusé par l\'utilisateur (ou délai dépassé)', notes });
  }

  isAllowlisted(cmd: string): boolean {
    const c = cmd.trim();
    if (SHELL_META.test(c)) return false;
    // Jamais hors de l'espace de travail sans validation : « cat ~/.aws/credentials », « grep -r x / »…
    if (/(^|\s)["']?(\/|~|\.\.(\/|$)|[A-Za-z]:\\)/.test(c)) return false;
    return this.cfg.shellAllowlist.some((p) => c === p || c.startsWith(p + ' '));
  }

  /** Note un événement dans le journal d'audit (ex. un écart du noyau au démarrage). Ne lève jamais. */
  noter(evenement: Record<string, unknown>): void {
    if (!this.auditFile) return;
    const text = JSON.stringify({ t: new Date().toISOString(), ...evenement });
    try { appendFileSync(this.auditFile, (this.redactor ? this.redactor.redact(text) : text) + '\n'); } catch { /* jamais bloquant */ }
  }

  /** Masqueur de secrets pour le journal (posé par le runtime). */
  redactor?: { redact(t: string): string };
  private log(g: GateInput, d: GateDecision): GateDecision {
    if (d.allowed) { try { this.compter(g); } catch { /* rien */ } }
    if (this.auditFile) {
      const line = { t: new Date().toISOString(), session: g.sessionId, tool: g.tool, risk: g.risk, tainted: g.tainted, summary: g.summary.slice(0, 300), ...d };
      const text = JSON.stringify(line);
      try { appendFileSync(this.auditFile, (this.redactor ? this.redactor.redact(text) : text) + '\n'); } catch { /* le journal ne doit jamais bloquer l'agent */ }
    }
    return d;
  }
}

function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise((res) => {
    const t = setTimeout(() => res(fallback), ms);
    p.then((v) => { clearTimeout(t); res(v); }, () => { clearTimeout(t); res(fallback); });
  });
}

/**
 * Prison de chemins : renvoie un chemin absolu garanti DANS `root`, ou lève une erreur.
 * Résout les liens symboliques pour empêcher une évasion via `ln -s / sortie`.
 */
export function jailPath(root: string, p: string): string {
  const rootReal = realpathSync(root);
  const target = isAbsolute(p) ? resolve(p) : resolve(rootReal, p);
  // On résout le parent existant le plus proche (le fichier peut ne pas encore exister).
  // lstat (et non exists) : un lien symbolique « cassé » compte comme existant, sinon on
  // pourrait créer un fichier hors de l'espace de travail en écrivant à travers lui.
  const lexists = (q: string) => { try { lstatSync(q); return true; } catch { return false; } };
  let probe = target;
  while (!lexists(probe) && dirname(probe) !== probe) probe = dirname(probe);
  let resolved: string;
  try { resolved = realpathSync(probe); } catch { throw new Error(`Chemin hors de l'espace de travail refusé : ${p} (lien symbolique cassé)`); }
  const real = join(resolved, relative(probe, target));
  const rel = relative(rootReal, real);
  if (rel === '' || (!rel.startsWith('..' + sep) && rel !== '..' && !isAbsolute(rel))) return real;
  throw new Error(`Chemin hors de l'espace de travail refusé : ${p}`);
}

/** Fichiers d'Odin qui contiennent tes secrets : jamais lus ni écrits par les outils de fichiers. */
const SECRET_FILES = /(^|[\\/])\.odin[\\/](\.env|env|admin\.json|machines\.json|codex-auth\.json|web-token|compte\.json|sessions\.json|askpass[^\\/]*|id_ed25519[^\\/]*|secrets?[^\\/]*|vault\.json|backup-pass|vapid\.json|[^\\/]*\.enc)$|(^|[\\/])valhalla[\\/]ullr[\\/]signatures[\\/]cle-signatures\.json$|(^|[\\/])valhalla[\\/]valgrind[\\/](certs[\\/][^\\/]*-key\.pem|acme-compte\.pem)$|(^|[\\/])valhalla[\\/]var[\\/]r[ée]glages\.json$|(^|[\\/])valhalla[\\/]bru[\\/]jeton-tunnel$|(^|[\\/])valhalla[\\/]skidbladnir[\\/](r[ée]glages\.json|notes[\\/][^\\/]+)$|(^|[\\/])valhalla[\\/]gladsheim[\\/](r[ée]glages|positions)\.json$|(^|[\\/])valhalla[\\/](thjalfi|urdr|svalinn)[\\/]secrets\.json$|(^|[\\/])var[\\/]lib[\\/]odin-pg([\\/]|$)|(^|[\\/])valhalla[\\/]([^\\/]+[\\/])?avant-base[^\\/]*([\\/]|$)|(^|[\\/])valhalla[\\/](journaux|skuld[\\/]archives|urdr[\\/]donnees|bragi[\\/]copies|partages|hlin|gna|pegase|var[\\/]sso|[^\\/]+[\\/]sauvegardes)([\\/]|$)|(^|[\\/])memoire[\\/]audio([\\/]|$)/i;
/** Un fichier de secrets d'Odin (ou une copie de tes bases) : jamais lu par les outils de fichiers ni ouvert par Alexandrie. Sous Windows, aussi par un flux NTFS, un point ou une espace final, un nom court, une jonction ou un partage (nomsVus, comme toolPath). */
export const isSecretFile = (p: string) => SECRET_FILES.test(p) || nomsVus(p).some((x) => SECRET_FILES.test(x));

/**
 * Les noms qu'un chemin désigne vraiment, pour les règles des secrets et des données du noyau. Sous Windows : tel qu'écrit,
 * sans flux NTFS ni point ou espace final (nomVuParWindows, la règle du noyau), et le nom que rend le système pour son plus
 * proche parent existant (realpathSync.native : un nom court 8.3 « ODIN~1 », « VAULT~1.JSO » redevient le vrai nom). Le
 * chemin rendu par toolPath ne change pas. Ailleurs qu'en Windows : tel qu'écrit, rien ne change.
 */
function nomsVus(chemin: string): string[] {
  if (process.platform !== 'win32') return [chemin];
  const vu = nomVuParWindows(chemin);
  let existant = vu, reste = '';
  for (;;) {
    try { lstatSync(existant); break; } catch { /* pas encore là : on remonte */ }
    const p = dirname(existant); if (p === existant) break;
    reste = reste ? join(basename(existant), reste) : basename(existant); existant = p;
  }
  let vrai = vu;
  try { const n = realpathSync.native(existant); vrai = reste ? join(n, reste) : n; } catch { /* garde le nom vu */ }
  return [chemin, vu, vrai];
}

/**
 * Chemin pour les outils de fichiers. Avec l'accès complet (propriétaire), un chemin absolu
 * ou « ~/… » vise n'importe où sur la machine ; un chemin relatif reste dans l'espace de travail.
 * Sans accès complet : l'espace de travail seulement (jailPath).
 */
export function toolPath(ctx: { workspace: string; fullAccess?: boolean }, p: string, o: { ecriture?: boolean } = {}): string {
  let out: string;
  if (ctx.fullAccess && (isAbsolute(p) || p === '~' || p.startsWith('~/') || p.startsWith('~\\'))) {
    const home = process.env.HOME ?? process.env.USERPROFILE ?? '';
    const abs = resolve(p.startsWith('~') ? join(home, p.slice(1)) : p);
    let real = abs;
    try { real = realpathSync(abs); } catch { /* n'existe pas encore */ }
    if ([abs, real].flatMap(nomsVus).some((x) => SECRET_FILES.test(x))) throw new Error(`Fichier de secrets d'Odin : ${p} (mots de passe et clés restent hors de la conversation ; utilise Réglages ou « odin admin »)`);
    out = real;
  } else out = jailPath(ctx.workspace, p);
  // Les DONNÉES du noyau (configuration, journal d'audit) ne s'écrivent que par leurs outils (Réglages, Heimdall).
  if (o.ecriture && nomsVus(out).some((x) => DONNEES_NOYAU.test(x))) throw new Error(`Donnée des garde-fous d'Odin : ${p} (la configuration se change par les Réglages ; le journal d'audit ne se réécrit jamais)`);
  return out;
}

/**
 * Ce qu'une tâche automatique (travail continu, ronde, veille) peut faire SEULE (décision du propriétaire, 17/11 : « le
 * sans-risque seul, le reste en attente »). Liste courte, vérifiée outil par outil dans leur code, et gardée ICI (dans le
 * noyau) : un outil ne peut pas se l'accorder. Critère : n'ajoute ou ne met à jour que du contenu d'Odin, réversible,
 * n'écrase rien du propriétaire, rien ne sort de la machine, aucun changement du système, du code, des réglages, des
 * garde-fous, ni tâche planifiée ou rappel.
 *  - note_save : une fiche du Cerveau ; seul, elle est marquée « écrit par Odin seul » (fiable: false) et n'écrase
 *    jamais une fiche existante ;
 *  - net_rename : l'étiquette d'un appareil dans l'inventaire d'Odin ; seul, seulement un appareil encore sans nom.
 * (memory_save est déjà « interne » : origine « agent », jamais « propriétaire », quarantaine si la conversation est marquée.)
 * Une conversation MARQUÉE (contenu extérieur lu) garde l'escalade par marquage, plus haut.
 */
export const SANS_RISQUE_AUTOMATIQUE: ReadonlySet<string> = new Set(['note_save', 'net_rename']);
/** Seul, Odin peut PROPOSER une routine : schedule_task la range inactive (elle ne part qu'une fois activée par le
 *  propriétaire). Ni script programmé, ni rappel. */
export const PROPOSE_SEUL: ReadonlySet<string> = new Set(['schedule_task']);

/**
 * Ce qu'un MEMBRE DE LA FAMILLE fait faire à Odin sans la validation du propriétaire (décisions du propriétaire, 17/11 :
 * « une chose sans risque, comme note ça ou mets-moi un rappel → il le fait seul », puis les quatre qu'il a cochées).
 * RIEN D'AUTRE : tout le reste lui est demandé. Gardée ICI (dans le noyau) : un outil ne peut pas se l'accorder.
 *  - noter (note_save) et rappeler (reminder_set) ;
 *  - mettre de la musique : Apollon (aegir) « jouer » ;
 *  - allumer ou éteindre une lumière : ha_call, domaine light, turn_on / turn_off / toggle, sur des entités light.*
 *    nommées (ni « all », ni une prise, ni une serrure, même par le même outil) ;
 *  - convertir un document : Alchimie (dvalinn) « convertir » écrit un nouveau fichier à côté (jamais par-dessus).
 *    Sur un fichier jugé dangereux, une conversion qui ne vient pas du propriétaire est refusée : l'original reste à
 *    sa place, rien n'est mis en quarantaine, le propriétaire est prévenu (dvalinn.ts, asclepios →
 *    « isoler_avant_conversion », réservée au propriétaire). media_convert, qui peut écrire sur l'original, n'y est pas ;
 *  - faire analyser un fichier : Asclépios (ullr) « fichier » est une lecture, déjà libre (rien à ajouter ici).
 *    « analyser » un dossier n'y est PAS : sur une menace sûre, cette analyse met le fichier à l'écart d'elle-même
 *    (réflexe « isoler ») — et la mise à l'écart reste demandée au propriétaire. « reanalyser » n'y est pas non plus :
 *    il réécrit la fiche de la quarantaine et son registre, ce n'est pas une lecture.
 * Lu dans le résumé technique de l'outil (`summarize`), écrit par le code de l'outil à partir de son entrée.
 */
export const SANS_RISQUE_MEMBRE: ReadonlyArray<{ chose: string; outil: string; resume?: RegExp }> = [
  { chose: 'noter', outil: 'note_save' },
  { chose: 'un rappel', outil: 'reminder_set' },
  { chose: 'mettre de la musique', outil: 'valhalla', resume: /^applis action (?:aegir|apollon) jouer $/ },
  { chose: 'allumer ou éteindre une lumière', outil: 'ha_call', resume: /^maison : light\.(?:turn_on|turn_off|toggle) → light\.[a-z0-9_]+(?: ?, ?light\.[a-z0-9_]+)*$/ },
  { chose: 'convertir un document', outil: 'valhalla', resume: /^applis action (?:dvalinn|alchimie) convertir $/ },
];
/** La chose sans risque qu'un membre demande (voir SANS_RISQUE_MEMBRE), ou undefined. Pur. */
export function sansRisqueMembre(tool: string, summary: string): string | undefined {
  const r = summary.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  return SANS_RISQUE_MEMBRE.find((x) => x.outil === tool && (!x.resume || x.resume.test(r)))?.chose;
}

const DONNEES_NOYAU = /(^|[\\/])\.odin[\\/](config\.json|logs[\\/]audit[^\\/]*|noyau-reference-connue\.txt)$/i;

/** Bloque les adresses internes (SSRF) : localhost, réseaux privés, métadonnées cloud. */
export function assertPublicUrl(raw: string): URL {
  const u = new URL(raw);
  if (!['http:', 'https:'].includes(u.protocol)) throw new Error(`Protocole refusé : ${u.protocol}`);
  const h = u.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (isPrivateHost(h)) throw new Error(`Adresse interne refusée : ${h}`);
  return u;
}

/**
 * Une adresse IPv4 cachée dans une adresse IPv6, telle que le navigateur la réécrit en hexadécimal :
 * `[::ffff:127.0.0.1]` devient `::ffff:7f00:1` (de même `::7f00:1` et `64:ff9b::7f00:1`). Rend l'IPv4 transportée. Pur.
 */
export function hiddenV4(host: string): string {
  const h = host.toLowerCase().replace(/^\[|\]$/g, '');
  const m = /^(?:(?:0:){5}ffff:|::ffff:|::|64:ff9b::)([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(h);
  if (!m) return h;
  const a = parseInt(m[1], 16), b = parseInt(m[2], 16);
  return `${a >> 8}.${a & 255}.${b >> 8}.${b & 255}`;
}
export function isPrivateHost(host: string): boolean {
  const h = hiddenV4(host).replace(/^(?:::ffff:|(?:0:){5}ffff:)/, '').replace(/\.+$/, ''); // « localhost. » = localhost
  return h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.internal') || h.endsWith('.local') ||
    /^127\./.test(h) || /^10\./.test(h) || /^192\.168\./.test(h) || /^169\.254\./.test(h) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(h) || /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(h) ||
    /^0\./.test(h) || h === '0.0.0.0' || h === '::1' || h === '::' || /^f[cd][0-9a-f]{2}:/.test(h) || /^fe80:/.test(h);
}

const AUTONOMY_RANK: Record<Autonomy, number> = { prudent: 0, equilibre: 1, autonome: 2, breaker: 3 };
/** Le plus bas des deux niveaux. */
export function capAutonomy(a: Autonomy, cap?: Autonomy): Autonomy {
  if (!cap) return a;
  return AUTONOMY_RANK[cap] < AUTONOMY_RANK[a] ? cap : a;
}
