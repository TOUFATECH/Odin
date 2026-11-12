// Heimdall — le gardien du Bifröst. Chaque appel d'outil passe par ici AVANT d'être exécuté.
//
// Principe clé : l'autorité des outils dépend de
// l'ORIGINE du contenu présent dans la conversation (« taint tracking »). Une page web
// ou un message d'inconnu peut contenir une injection ; dès qu'il est lu, Odin perd le
// droit d'écrire, d'exécuter ou d'envoyer quoi que ce soit sans validation humaine.
// C'est vérifié par le code, pas par le prompt.

import { appendFileSync, lstatSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { OdinConfig, PolicyMode } from '../config.ts';
import type { Risk } from '../types.ts';
import { DEFAULT_BREAKER, effectiveAutonomy, type BreakerConfig } from '../mimir/decisions.ts';

export const RISK_ORDER: Risk[] = ['read', 'write', 'network', 'exec', 'external'];
export const riskRank = (r: Risk): number => RISK_ORDER.indexOf(r);

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
export type Review = { severity: Severity; reason: string; flags: string[]; requested?: 'yes' | 'no' | 'unsure' };
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
    const lock = g.grave ?? (g.command !== undefined ? lockoutRisk(g.command) : undefined);
    if (lock) {
      if (mode === 'deny') return this.log(g, { allowed: false, reason: `niveau « ${g.risk} » interdit par la configuration` });
      const req: ApprovalRequest = { id: `a${Date.now().toString(36)}${(this.seq++).toString(36)}`, tool: g.tool, risk: g.risk, summary: g.summary, reason: `GRAVE : ${lock}, je ne le fais jamais sans ton accord`, sessionId: g.sessionId, severity: 'grave', grantable: false };
      const ok = await withTimeout<ApprovalAnswer>(this.approver.approve(req), this.cfg.approvalTimeoutSec * 1000, false);
      return this.log(g, ok ? { allowed: true, via: 'human', severity: 'grave', why: lock } : { allowed: false, severity: 'grave', reason: `${lock} : refusé ou sans réponse` });
    }
    // Recherche web et lecture de pages : jamais de validation (Odin cite ses sources), même après
    // avoir lu du contenu non fiable — sauf si le réseau est interdit ou une manipulation détectée.
    if (g.lookup && mode !== 'deny' && !g.suspicious) return this.log(g, { allowed: true, via: 'policy', why: 'consultation du web (sources citées)' });
    const autonomy = capAutonomy(this.effectiveAutonomy(), g.maxAutonomy);
    if (g.maxAutonomy && autonomy !== this.effectiveAutonomy()) notes.push(`membre : autonomie plafonnée à ${autonomy}`);

    // Liste blanche shell : seulement pour des commandes simples, sans métacaractères.
    if (g.command !== undefined && mode === 'ask' && this.isAllowlisted(g.command)) {
      mode = 'allow';
      notes.push('commande en liste blanche');
    }

    // Escalade par marquage : contenu non fiable lu → validation obligatoire.
    if (g.tainted && mode === 'allow' && riskRank(g.risk) >= riskRank(this.cfg.taintEscalatesFrom)) {
      mode = 'ask';
      notes.push('la conversation contient du contenu non fiable (web, inconnu)');
    }

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
    if (review) {
      const sev = review.severity;
      notes.push(`Mímir : ${review.flags.join(', ') || 'aucun constat'}`);
      if (sev === 'blocked') return this.log(g, { allowed: false, severity: sev, reason: `Mímir : ${review.reason}`, notes });
      if (mode === 'allow') {
        // Action déjà permise par la politique : seule une gravité « grave » la fait remonter jusqu'à toi.
        if (sev === 'grave') mode = 'ask';
        else return this.log(g, { allowed: true, via: 'policy', severity: sev, why: review.reason, notes });
      } else if (autonomy !== 'prudent') {
        const clean = !g.tainted && !g.suspicious;
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
      return this.log(g, { allowed: true, via: 'breaker', severity: sev, why: `Odin Breaker${sev ? ` (${sev})` : ''}${review ? ` : ${review.reason}` : ''}`, notes });
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

  /** Masqueur de secrets pour le journal (posé par le runtime). */
  redactor?: { redact(t: string): string };
  private log(g: GateInput, d: GateDecision): GateDecision {
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
const SECRET_FILES = /(^|[\\/])\.odin[\\/](\.env|env|admin\.json|machines\.json|codex-auth\.json|web-token|compte\.json|sessions\.json|askpass[^\\/]*|id_ed25519[^\\/]*|secrets?[^\\/]*|vault\.json|backup-pass|vapid\.json|[^\\/]*\.enc)$|(^|[\\/])valhalla[\\/]ullr[\\/]signatures[\\/]cle-signatures\.json$|(^|[\\/])valhalla[\\/]valgrind[\\/](certs[\\/][^\\/]*-key\.pem|acme-compte\.pem)$|(^|[\\/])valhalla[\\/]var[\\/]r[ée]glages\.json$|(^|[\\/])valhalla[\\/]bru[\\/]jeton-tunnel$|(^|[\\/])valhalla[\\/]skidbladnir[\\/](r[ée]glages\.json|notes[\\/][^\\/]+)$|(^|[\\/])valhalla[\\/]gladsheim[\\/](r[ée]glages|positions)\.json$|(^|[\\/])valhalla[\\/](thjalfi|urdr)[\\/]secrets\.json$|(^|[\\/])valhalla[\\/](skuld[\\/]archives|urdr[\\/]donnees)([\\/]|$)/i;
/** Un fichier de secrets d'Odin (ou une copie de tes bases) : jamais lu par les outils de fichiers ni ouvert par Urðr. */
export const isSecretFile = (p: string) => SECRET_FILES.test(p);

/**
 * Chemin pour les outils de fichiers. Avec l'accès complet (propriétaire), un chemin absolu
 * ou « ~/… » vise n'importe où sur la machine ; un chemin relatif reste dans l'espace de travail.
 * Sans accès complet : l'espace de travail seulement (jailPath).
 */
export function toolPath(ctx: { workspace: string; fullAccess?: boolean }, p: string): string {
  if (ctx.fullAccess && (isAbsolute(p) || p === '~' || p.startsWith('~/') || p.startsWith('~\\'))) {
    const home = process.env.HOME ?? process.env.USERPROFILE ?? '';
    const abs = resolve(p.startsWith('~') ? join(home, p.slice(1)) : p);
    let real = abs;
    try { real = realpathSync(abs); } catch { /* n'existe pas encore */ }
    if (SECRET_FILES.test(abs) || SECRET_FILES.test(real)) throw new Error(`Fichier de secrets d'Odin : ${p} (mots de passe et clés restent hors de la conversation ; utilise Réglages ou « odin admin »)`);
    return real;
  }
  return jailPath(ctx.workspace, p);
}

/** Bloque les adresses internes (SSRF) : localhost, réseaux privés, métadonnées cloud. */
export function assertPublicUrl(raw: string): URL {
  const u = new URL(raw);
  if (!['http:', 'https:'].includes(u.protocol)) throw new Error(`Protocole refusé : ${u.protocol}`);
  const h = u.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (isPrivateHost(h)) throw new Error(`Adresse interne refusée : ${h}`);
  return u;
}

export function isPrivateHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^::ffff:/, '').replace(/\.+$/, ''); // « localhost. » = localhost
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
