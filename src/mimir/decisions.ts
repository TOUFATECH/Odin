// Les DÉCISIONS, écrites en code sous forme de tables de vérité. Le juge (local, modèle ou
// Jev) fournit les entrées (des probabilités) ; chaque combinaison oui / non / incertain a
// une issue ici.
//
// Autonomie : chaque action reçoit une GRAVITÉ.
//   routine   → Odin décide seul, et te le dit (journal + résumé en fin de tour) ;
//   important → Odin te demande, sauf si tu lui as donné une autorisation permanente ;
//   grave     → Odin te demande toujours (aucune autorisation permanente ne s'applique) ;
//   bloqué    → refusé (exfiltration probable).
// Un doute sur une question clé rend l'action « importante » : dans le doute, il demande.
// Une panne du juge n'est jamais lue comme un « non » : Heimdall applique alors sa politique de base.

import type { Risk } from '../types.ts';
import { type Answers, choice, type Judge, yes } from './client.ts';
import { ACTION_QUESTIONS, INJECTION_QUESTIONS, level, type Level, MEMORY_QUESTIONS, REFLECTION_QUESTIONS, ROUTING_QUESTIONS, YES } from './questions.ts';

/**
 * Quel juge fournit les probabilités :
 * - auto : Jev si une clé TypeSafe est présente, sinon le juge local ;
 * - local : règles hors ligne, sans clé ni réseau ;
 * - llm : le modèle configuré pour Odin (Ollama local = sans clé) ;
 * - local+llm / local+jev : le juge local d'abord, le second seulement pour ce qui reste incertain ;
 * - jev : toujours Jev (clé TypeSafe requise).
 */
export type JudgeMode = 'auto' | 'local' | 'llm' | 'jev' | 'local+llm' | 'local+jev';

/**
 * Niveau d'autonomie :
 * - prudent  : Odin suit la politique de base (il demande pour chaque action soumise à validation) ;
 * - equilibre: il décide seul la routine, demande pour l'important et le grave (défaut) ;
 * - autonome : il décide seul la routine et l'important, ne demande que pour le grave ;
 * - breaker  : « Odin Breaker » — il ne demande plus rien, grave compris, y compris dans les
 *              tâches planifiées. Restent seulement les garde-fous contre les ATTAQUES (commandes
 *              destructrices connues, ordres venus d'une page piégée). Tout est journalisé et
 *              un rapport arrive chaque soir. Peut être limité à une plage horaire (la nuit).
 */
export type Autonomy = 'prudent' | 'equilibre' | 'autonome' | 'breaker';
export const AUTONOMY_LEVELS: Autonomy[] = ['prudent', 'equilibre', 'autonome', 'breaker'];

export interface BreakerConfig {
  /** 'always' : Breaker en permanence ; 'night' : seulement entre from et to, sinon fallback. */
  schedule: 'always' | 'night';
  from: string;
  to: string;
  fallback: Exclude<Autonomy, 'breaker'>;
  /** Heure du rapport du soir (« HH:MM », vide = pas de rapport). */
  reportAt: string;
  /** Limites propres aux missions en Breaker (0 = sans limite de coût). */
  maxSteps: number;
  maxCostPerTurnUsd: number;
  /** Chaque soir, Odin relit sa journée et crée lui-même routines et rappels utiles. */
  proactive: boolean;
}

export const DEFAULT_BREAKER: BreakerConfig = { schedule: 'always', from: '22:00', to: '07:00', fallback: 'equilibre', reportAt: '21:00', maxSteps: 100, maxCostPerTurnUsd: 5, proactive: true };

const minutesOf = (hhmm: string) => { const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm); return m ? Number(m[1]) * 60 + Number(m[2]) : NaN; };
export const validHhmm = (s: string) => { const m = minutesOf(s); return Number.isFinite(m) && m < 24 * 60 && Number(s.split(':')[1]) < 60; };

/** Est-on dans la plage [from, to[ (qui peut passer minuit) ? */
export function inWindow(from: string, to: string, now = new Date()): boolean {
  const f = minutesOf(from), t = minutesOf(to), n = now.getHours() * 60 + now.getMinutes();
  if (!Number.isFinite(f) || !Number.isFinite(t) || f === t) return true;
  return f < t ? n >= f && n < t : n >= f || n < t;
}

/** Niveau réellement appliqué maintenant (Breaker de nuit → niveau de repli le jour). */
export function effectiveAutonomy(a: Autonomy, b: BreakerConfig, now = new Date()): Autonomy {
  if (a !== 'breaker' || b.schedule === 'always') return a;
  return inWindow(b.from, b.to, now) ? 'breaker' : b.fallback;
}

export interface MimirConfig {
  enabled: boolean;
  judge: JudgeMode;
  autonomy: Autonomy;
  /** Réglages du mode Odin Breaker. */
  breaker: BreakerConfig;
  model: string;
  baseUrl: string;
  apiKeyEnv: string;
  timeoutMs: number;
  /** Quels points de décision utilisent Mímir. */
  uses: { actionReview: boolean; injection: boolean; memory: boolean; reflection: boolean; routing: boolean };
}

export const DEFAULT_MIMIR: MimirConfig = {
  enabled: true,
  judge: 'auto',
  autonomy: 'equilibre',
  breaker: DEFAULT_BREAKER,
  model: 'jev-latest',
  baseUrl: 'https://api.typesafe.ai',
  apiKeyEnv: 'JEV_API_KEY',
  timeoutMs: 8000,
  uses: { actionReview: true, injection: true, memory: true, reflection: true, routing: true },
};

// ---------- 1. Gravité d'une action ----------

export interface ActionInput {
  tool: string;
  risk: Risk;
  summary: string;
  command?: string;
  userRequest: string;
  tainted: boolean;
}

export type Severity = 'routine' | 'important' | 'grave' | 'blocked';
export const SEVERITY_LABEL: Record<Severity, string> = { routine: 'routine', important: 'important', grave: 'grave', blocked: 'bloqué' };

export interface ActionVerdict {
  severity: Severity;
  /** Phrase courte qui explique la décision (affichée à l'utilisateur). */
  reason: string;
  /** Constats du juge (« supprime des données », « demandé par toi »…). */
  flags: string[];
  /** L'action correspond-elle à ce que le propriétaire a demandé ? */
  requested?: 'yes' | 'no' | 'unsure';
}

export interface ActionLevels {
  requested: Level; deletes: Level; sends_out: Level; system_change: Level;
  money: Level; private_data: Level; irreversible: Level;
}

/** Table de vérité de la gravité (pure, testable sans réseau). Lue de haut en bas : la première règle qui s'applique gagne. */
export function decideAction(l: ActionLevels, i: Pick<ActionInput, 'risk' | 'tainted'> & { tool?: string }): ActionVerdict {
  const flags: string[] = [];
  if (l.requested === 'yes') flags.push('demandé par toi');
  if (l.requested === 'no') flags.push('pas demandé explicitement');
  if (l.requested === 'unsure') flags.push('demande ambiguë');
  if (l.deletes === 'yes') flags.push('supprime ou écrase des données');
  if (l.sends_out === 'yes') flags.push('envoie des données hors de cette machine');
  if (l.system_change === 'yes') flags.push('modifie le système ou demande des droits administrateur');
  if (l.money === 'yes') flags.push('engage de l\'argent');
  if (l.private_data === 'yes') flags.push('partage des données privées');
  if (l.irreversible === 'yes') flags.push('difficile à annuler');
  const LABEL = { deletes: 'suppression de données', sends_out: 'envoi hors de la machine', system_change: 'changement du système', money: 'dépense', private_data: 'données privées', irreversible: 'possibilité d\'annuler' };
  const doubts = (['deletes', 'sends_out', 'system_change', 'money', 'private_data', 'irreversible'] as const).filter((k) => l[k] === 'unsure').map((k) => LABEL[k]);
  if (doubts.length) flags.push(`incertain : ${doubts.join(', ')}`);
  const v = (severity: Severity, reason: string): ActionVerdict => ({ severity, reason, flags, requested: l.requested as ActionVerdict['requested'] });

  // Bloqué : contenu non fiable lu + envoi vers l'extérieur que tu n'as pas demandé.
  if (i.tainted && l.sends_out === 'yes' && l.requested !== 'yes') return v('blocked', 'envoi de données non demandé après lecture de contenu non fiable (exfiltration probable)');
  // Grave : toujours ta décision.
  if (i.tainted && (i.tool === 'schedule_task' || i.tool === 'reminder_set') && l.requested !== 'yes') return v('grave', 'tâche ou rappel programmé après lecture de contenu non fiable : une consigne cachée pourrait ainsi revenir plus tard');
  if (l.money === 'yes') return v('grave', 'cette action engage de l\'argent');
  if (l.sends_out === 'yes' && l.private_data === 'yes') return v('grave', 'des données privées partiraient hors de cette machine');
  if (l.deletes === 'yes' && l.requested !== 'yes') return v('grave', 'suppression de données que tu n\'as pas demandée');
  if (l.system_change === 'yes' && l.requested !== 'yes') return v('grave', 'modification du système que tu n\'as pas demandée');
  if (l.irreversible === 'yes' && l.requested !== 'yes') return v('grave', 'action difficile à annuler que tu n\'as pas demandée');
  // Important : te demander (ou une autorisation permanente que tu as donnée).
  if (l.system_change === 'yes') return v('important', 'besoin de droits supplémentaires sur le système');
  if (l.deletes === 'yes' && l.irreversible !== 'no') return v('important', 'suppression définitive, même demandée');
  if (i.tainted) return v('important', 'la conversation contient du contenu non fiable');
  if (l.requested !== 'yes') return v('important', 'action que tu n\'as pas clairement demandée');
  if (doubts.length) return v('important', `je ne suis pas sûr de ses effets (${doubts.join(', ')})`);
  // Routine : demandée, sans effet risqué. Un message que tu as demandé, sans donnée privée, en fait partie.
  return v('routine', l.sends_out === 'yes' ? 'message demandé par toi, sans donnée privée' : 'demandé par toi, sans effet risqué');
}

// ---------- 1 bis. Commandes de simple lecture (sans modèle) ----------
// Le juge peut se tromper (« 2>/dev/null » pris pour un effacement). Une commande faite uniquement de
// lectures connues, sans écriture dans un fichier, est une simple consultation : jamais « grave ».
const READ_CMDS = new Set(['uname', 'whoami', 'id', 'date', 'uptime', 'cat', 'head', 'tail', 'grep', 'egrep', 'fgrep', 'rg', 'ls', 'stat', 'file', 'wc', 'df', 'du', 'free', 'ps', 'ss', 'netstat', 'lsblk', 'blkid', 'findmnt', 'which', 'type', 'echo', 'printf', 'true', 'false', 'test', '[', 'lscpu', 'lsusb', 'lspci', 'lsmod', 'journalctl', 'pveversion', 'nslookup', 'dig', 'host', 'getent', 'cut', 'sort', 'uniq', 'tr', 'column', 'jq', 'nproc', 'arch', 'hostnamectl', 'timedatectl', 'lsb_release', 'sw_vers', 'ifconfig', 'iwconfig', 'arp', 'route', 'last', 'w', 'who', 'groups', 'env', 'printenv', 'pwd', 'basename', 'dirname', 'readlink', 'realpath', 'sensors', 'smartctl', 'zpool', 'zfs', 'lvs', 'vgs', 'pvs', 'sha256sum', 'md5sum']);
const READ_SUB: Record<string, RegExp> = {
  hostname: /^(-[a-zA-Z]+\s*)*$/, ip: /^(-\S+\s+)*(a|addr|address|l|link|r|route|n|neigh|neighbour)\b(?!.*\b(add|del|delete|change|replace|flush|set|append|up|down)\b)/, systemctl: /^(status|is-active|is-enabled|is-failed|list-units|list-unit-files|list-timers|show|cat)\b/,
  docker: /^(ps|images|inspect|logs|stats\s+--no-stream|version|info|network\s+ls|volume\s+ls)\b/, pct: /^(list|config|status)\b/, qm: /^(list|config|status)\b/, pvesh: /^get\b/,
  realm: /^(list|discover)\b/, adcli: /^info\b/, nmcli: /^(-\S+\s+)*(dev(ice)?\s+(show|status)|con(nection)?\s+show|general|g)\b/, ping: /^(.*\s)?-c\s*\d+/, mount: /^$/, sed: /^(?!.*(-i|\bw\s)).*$/, awk: /^(?!.*(system\s*\(|>|\|)).*$/, find: /^(?!.*-(delete|exec|execdir|ok|fprint)).*$/, smbclient: /^-L\b/, apt: /^(list|show|policy|search)\b/, dpkg: /^(-l|-s|-L|--list|--status)\b/,
};
export function readOnlyCommand(cmd: string): boolean {
  const c = cmd.trim(); if (!c || c.length > 2000) return false;
  if (/`|\$\(|<\(|>\(/.test(c)) return false; // sous-commandes : on ne devine pas
  // Écriture dans un fichier : tout « > » sauf vers /dev/null ou une copie de flux (2>&1).
  if (/(^|[^0-9&])>{1,2}\s*(?!\/dev\/null\b|&\d)/.test(c.replace(/\d?>{1,2}\s*\/dev\/null/g, '').replace(/\d>&\d/g, ''))) return false;
  const parts = c.replace(/\d?>{1,2}\s*\/dev\/null/g, ' ').replace(/\d>&\d/g, ' ').split(/;|&&|\|\||\||\n/);
  for (let p of parts) {
    p = p.trim().replace(/^[({\s]+|[)}\s]+$/g, '').replace(/^sudo\s+(-n\s+)?/, '').trim();
    if (!p) continue;
    if (/^command\s+-v\s+\S+$/.test(p)) continue;
    const [head, ...rest] = p.split(/\s+/), args = rest.join(' ');
    if (READ_CMDS.has(head)) { if (head === 'env' && args) return false; continue; }
    const sub = READ_SUB[head]; if (sub && sub.test(args)) continue;
    return false;
  }
  return true;
}

/**
 * L'action vise-t-elle ce que le propriétaire a écrit lui-même (une adresse IP, un site, une URL) ?
 * Alors c'est sa demande, quoi qu'en pense le juge : on ne bloque pas ce qu'il demande explicitement.
 */
export function targetInRequest(action: string, request: string): boolean {
  if (!request) return false;
  const req = request.toLowerCase();
  const targets = new Set<string>();
  for (const m of action.matchAll(/\b(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?\b/g)) targets.add(m[0]);
  for (const m of action.matchAll(/https?:\/\/([^\s/'"<>]+)/gi)) targets.add(m[1].toLowerCase());
  for (const m of action.matchAll(/\b([a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:fr|com|net|org|io|dev|local|lan|home|arpa|eu|be|ch|re|yt|app|ai))\b/gi)) targets.add(m[1].toLowerCase());
  return [...targets].map((x) => x.toLowerCase().replace(/^www\./, '')).some((x) => req.includes(x) || req.includes(x.replace(/:\d+$/, '')));
}

// ---------- 2. Contenu externe ----------

export interface InjectionVerdict { suspicious: boolean; caution: boolean; reasons: string[] }

export function decideInjection(l: { addresses_ai: Level; asks_secrets: Level; asks_action: Level }): InjectionVerdict {
  const reasons: string[] = [];
  if (l.addresses_ai === 'yes') reasons.push('contient des instructions destinées à une IA');
  if (l.asks_secrets === 'yes') reasons.push('demande des mots de passe, clés ou données privées');
  if (l.asks_action === 'yes') reasons.push('pousse à lancer une commande, télécharger ou contacter quelqu\'un');
  const suspicious = l.addresses_ai === 'yes' || l.asks_secrets === 'yes';
  const caution = !suspicious && (l.asks_action === 'yes' || l.addresses_ai === 'unsure' || l.asks_secrets === 'unsure');
  return { suspicious, caution, reasons };
}

// ---------- 3. Mémoire ----------

export type MemoryVerdict = { save: true } | { save: false; reason: string };

export function decideMemory(l: { secret: Level; durable: Level }): MemoryVerdict {
  if (l.secret === 'yes') return { save: false, reason: 'ce souvenir semble contenir un secret ; il n\'est pas enregistré' };
  if (l.secret === 'unsure') return { save: false, reason: 'ce souvenir pourrait contenir un secret ; demande à l\'utilisateur de confirmer qu\'il n\'y en a pas' };
  if (l.durable === 'no') return { save: false, reason: 'information éphémère, inutile dans quelques semaines ; pas enregistrée' };
  return { save: true };
}

// ---------- 4. Réflexion ----------

export const decideReflection = (l: { succeeded: Level; reusable: Level }): boolean => l.succeeded === 'yes' && l.reusable === 'yes';

// ---------- 5. Routage ----------

export type RouteTier = 'local' | 'standard' | 'strong';
/** Palier minimal : simple → local/gratuit, ordinaire → standard, complexe → le plus capable. Doute → standard. */
export const decideRoute = (top: string, p: number): RouteTier => (p < YES ? 'standard' : top === 'quick_reply' ? 'local' : top === 'complex' ? 'strong' : 'standard');

// ---------- Mímir : pose les questions, applique les tables ----------

export type Outcome<T> = { ok: true; value: T; answers: Answers } | { ok: false; error: string };

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}… [tronqué]` : s);

export class Mimir {
  readonly cfg: MimirConfig;
  /** Nom du juge effectivement utilisé (local, jev, llm, local+llm…). */
  readonly judgeName: string;
  private judge: Judge;
  constructor(judge: Judge, cfg: MimirConfig, judgeName = 'jev') {
    this.judge = judge;
    this.cfg = cfg;
    this.judgeName = judgeName;
  }

  private async ask<T>(state: Record<string, unknown>, questions: Parameters<Judge>[1], decide: (a: Answers) => T, signal?: AbortSignal): Promise<Outcome<T>> {
    try {
      const answers = await this.judge(state, questions, signal);
      return { ok: true, value: decide(answers), answers };
    } catch (e) {
      return { ok: false, error: (e as Error).message.slice(0, 200) };
    }
  }

  reviewAction(i: ActionInput, signal?: AbortSignal): Promise<Outcome<ActionVerdict>> {
    // Simple lecture (nom de la machine, adresses, état d'un service…) : routine, sans demander au juge.
    if (i.command && !i.tainted && readOnlyCommand(i.command)) return Promise.resolve({ ok: true, value: { severity: 'routine', reason: 'simple lecture, rien n\'est modifié', flags: ['lecture seule'] }, answers: {} as Answers });
    const action: Record<string, unknown> = { tool: i.tool, description: i.summary };
    if (i.command) action.command = i.command;
    const asked = targetInRequest(`${i.summary} ${i.command ?? ''}`, i.userRequest);
    return this.ask({ action, user_request: clip(i.userRequest || '(aucune demande)', 4000) }, ACTION_QUESTIONS, (a) => decideAction({
      requested: asked ? 'yes' : level(yes(a, 'requested')), deletes: level(yes(a, 'deletes')), sends_out: level(yes(a, 'sends_out')), system_change: level(yes(a, 'system_change')),
      money: level(yes(a, 'money')), private_data: level(yes(a, 'private_data')), irreversible: level(yes(a, 'irreversible')),
    }, i), signal);
  }

  inspect(content: string, source: string, signal?: AbortSignal): Promise<Outcome<InjectionVerdict>> {
    return this.ask({ source, content: clip(content, 20_000) }, INJECTION_QUESTIONS, (a) => decideInjection({
      addresses_ai: level(yes(a, 'addresses_ai')), asks_secrets: level(yes(a, 'asks_secrets')), asks_action: level(yes(a, 'asks_action')),
    }), signal);
  }

  memoryGate(fact: string, signal?: AbortSignal): Promise<Outcome<MemoryVerdict>> {
    return this.ask({ fact: clip(fact, 2000) }, MEMORY_QUESTIONS, (a) => decideMemory({ secret: level(yes(a, 'secret')), durable: level(yes(a, 'durable')) }), signal);
  }

  reflectionGate(goal: string, transcript: string, signal?: AbortSignal): Promise<Outcome<boolean>> {
    return this.ask({ goal: clip(goal, 2000), transcript: clip(transcript, 15_000) }, REFLECTION_QUESTIONS, (a) => decideReflection({ succeeded: level(yes(a, 'succeeded')), reusable: level(yes(a, 'reusable')) }), signal);
  }

  route(message: string, signal?: AbortSignal): Promise<Outcome<RouteTier>> {
    return this.ask({ message: clip(message, 4000) }, ROUTING_QUESTIONS, (a) => { const c = choice(a, 'kind'); return decideRoute(c.top, c.p); }, signal);
  }
}
