// Juge LOCAL de Mímir : sans clé, sans réseau, sans dépendance.
//
// Même principe que Jev : il reçoit les mêmes questions typées sur le même état et
// renvoie des probabilités ; les tables de vérité de decisions.ts décident. Il repose sur
// des indices explicites (commandes, verbes français/anglais, motifs de secrets), donc il
// est rapide (< 1 ms), gratuit et lisible, mais moins fin qu'un vrai modèle : quand il ne
// sait pas, il répond une probabilité au milieu (« incertain »), et les tables de vérité
// ne durcissent ni n'assouplissent rien sur un « incertain ».
//
// Une question inconnue reçoit 0,5 (noul) ou une répartition uniforme (choice).

import type { Answers, Judge, Question } from './client.ts';

const STRONG = 0.93, LIKELY = 0.8, UNSURE = 0.5, UNLIKELY = 0.2, NONE = 0.05;

/** Minuscules, sans accents, apostrophes unifiées. */
export const norm = (s: unknown): string => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[’`]/g, "'");
const any = (t: string, res: RegExp[]) => res.some((r) => r.test(t));

// ---------- Actions ----------

interface ActionState { tool: string; text: string; cmd: string }
const actionOf = (state: Record<string, unknown>): ActionState => {
  const a = (state.action ?? {}) as Record<string, unknown>;
  const cmd = norm(a.command ?? '');
  return { tool: String(a.tool ?? ''), cmd, text: `${norm(a.description)} ${cmd}` };
};

const DELETE_CMD = [
  /(^|[\s;&|$])rm\s/, /\brmdir\b/, /\bunlink\b/, /\bshred\b/, /(^|\s)del\s/, /\berase\b/, /\bremove-item\b/, /\b(rd|rmdir)\s+\/s\b/,
  /\bgit\s+(reset\s+--hard|clean\s+-\w*f|branch\s+-d)/, /\bgit\s+push\b[^\n]*(--force|-f\b)/, /\s-delete\b/, /\brsync\b[^\n]*--delete/,
  /\bdrop\s+(table|database|schema)\b/, /\bdelete\s+from\b/, /\btruncate\b/, /\bmkfs/, /\bdd\b[^\n]*\bof=/, /\bcrontab\s+-r\b/,
  /\bdocker\s+(rm|rmi|volume\s+rm|system\s+prune)\b/, /\bkubectl\s+delete\b/, /\b(npm|pip)\s+uninstall\b/,
];
// Programmes dont l'effet est connu et local. Pour tout autre programme, le juge ne prétend
// pas savoir : il répond « incertain » sur l'envoi et le changement système.
const KNOWN_LOCAL = new Set(['ls', 'dir', 'cat', 'type', 'head', 'tail', 'less', 'grep', 'rg', 'find', 'du', 'df', 'wc', 'echo', 'printf', 'pwd', 'cd', 'date',
  'stat', 'file', 'which', 'where', 'uname', 'whoami', 'ps', 'top', 'free', 'uptime', 'mkdir', 'cp', 'mv', 'rm', 'touch', 'tar', 'zip', 'unzip', 'gzip', 'sort',
  'uniq', 'cut', 'awk', 'sed', 'diff', 'tree', 'ping', 'git', 'tsc', 'jq', 'get-childitem', 'get-content', 'remove-item',
  'copy-item', 'move-item', 'new-item', 'select-string', 'crontab', 'sudo', 'apt', 'apt-get', 'brew', 'winget', 'systemctl', 'curl', 'wget', 'scp', 'ssh', 'rsync']);
const head = (cmd: string) => (cmd.trim().split(/\s+/)[0] ?? '').replace(/^.*[\\/]/, '');
const unknownProgram = (a: ActionState) => a.tool === 'shell' && a.cmd !== '' && !KNOWN_LOCAL.has(head(a.cmd));

const DELETE_WORDS = /\b(supprim\w*|effac\w*|vider|vide|delete|remove|erase|wipe|purge)\b/;
const OVERWRITE_REDIRECT = /(^|[^>&\d])>\s*[^\s>&|]/; // « > fichier » écrase, « >> » ajoute

function deletes(a: ActionState): number {
  if (a.tool === 'schedule_cancel') return STRONG;
  if (any(a.cmd, DELETE_CMD)) return STRONG;
  if (a.cmd && OVERWRITE_REDIRECT.test(a.cmd)) return LIKELY;
  if (a.tool === 'send_message' || a.tool === 'schedule_task') return NONE;
  if (a.tool === 'system_update_apply') return UNLIKELY;
  if (a.tool === 'fs_write') return 0.45; // écrase seulement si le fichier existe déjà
  if (a.tool === 'fs_edit' || /\b(sed\s+-i|mv)\b/.test(a.cmd)) return 0.4;
  if (!a.cmd && DELETE_WORDS.test(a.text)) return LIKELY;
  if (unknownProgram(a)) return 0.4; // programme qui exécute du code arbitraire (npm, make, python…)
  return NONE;
}

const SEND_CMD = [
  /\b(curl|wget|http|https?ie)\b[^\n]*(\s-d\b|--data|\s-f\b|--form|\s-t\b|--upload-file|-x\s*(post|put|patch)|--json|--post-(data|file))/,
  /\b(scp|sftp|ftp|lftp)\b/, /\brsync\b[^\n]*\S+:\S*/, /\b(nc|ncat|netcat|socat)\b/, /\bssh\s+\S+@?\S+/, /\bgit\s+push\b/,
  /\b(mail|mailx|sendmail|mutt|msmtp)\b/, /\b(invoke-webrequest|invoke-restmethod|iwr|irm)\b[^\n]*(-method\s+(post|put)|-body|-infile)/,
  /\b(npm|cargo|twine)\s+publish\b/, /\baws\s+s3\s+(cp|sync|mv)\b[^\n]*s3:\/\//, /\bgh\s+(issue|pr|gist|release)\s+create\b/, /\bdocker\s+push\b/,
];
const URL_WITH_VARS = /\b(curl|wget|iwr|invoke-webrequest)\b[^\n]*https?:\/\/[^\s]*(\$\(|\$\{?\w|`)/;

function sendsOut(a: ActionState): number {
  if (a.tool === 'send_message') return 0.97;
  if (any(a.cmd, SEND_CMD) || URL_WITH_VARS.test(a.cmd)) return STRONG;
  if (/\b(curl|wget|iwr|invoke-webrequest)\b/.test(a.cmd)) return 0.4; // simple lecture d'une page : incertain
  if (a.tool === 'system_update_apply') return UNLIKELY;
  if (unknownProgram(a)) return 0.45;
  return NONE;
}

const SYSTEM_CMD = [
  /\bsudo\b/, /\b(apt|apt-get|dnf|yum|pacman|zypper|apk|snap)\s+(install|remove|purge|upgrade|update|dist-upgrade|-s)/, /\bbrew\s+(install|upgrade|uninstall|reinstall|tap)\b/,
  /\b(winget|choco|scoop)\s+(install|upgrade|uninstall)\b/, /\bnpm\s+(i|install)\s+(-g|--global)\b/, /\bsystemctl\s+(enable|disable|start|stop|restart|mask|unmask)\b/,
  /\blaunchctl\s+(load|unload|bootstrap|bootout)\b/, /\bcrontab\b/, /\b(chmod|chown)\b[^\n]*\s\/(etc|usr|bin|sbin|var|system|library|opt)\b/, /(>|tee\s+)\s*\/etc\//,
  /\breg\s+(add|delete)\b/, /\bset-itemproperty\b[^\n]*hklm/, /\b(new-service|set-service|sc\s+config)\b/, /\bdefaults\s+write\b/, /\bsysctl\s+-w\b/,
  /\b(useradd|usermod|userdel|passwd|visudo)\b/, /\b(shutdown|reboot|halt|poweroff|restart-computer|stop-computer|init\s+[06])\b/, /\b(ufw|iptables|nft|netsh|firewall-cmd)\b/, /\bpip3?\s+install\b(?![^\n]*--user)/, /\bmodprobe\b/,
];

function systemChange(a: ActionState): number {
  if (a.tool === 'system_update_apply') return 0.97;
  if (any(a.cmd, SYSTEM_CMD)) return /\bpip3?\s+install\b/.test(a.cmd) && !/\bsudo\b/.test(a.cmd) ? 0.6 : STRONG;
  if (unknownProgram(a)) return 0.45;
  return NONE;
}

const MONEY = /\b(achet\w*|acheter|pay\w*|paie\w*|paiement|virement|commande[rz]?|abonne\w*|souscri\w*|facture\w*|buy|purchase|order|checkout|subscribe|payment|transfer\s+\d|stripe|paypal|lydia|wise)\b|\d+([.,]\d+)?\s?(€|eur|euros|\$|usd)\b/;
function money(a: ActionState): number {
  if (MONEY.test(a.text)) return LIKELY;
  return NONE;
}

const PRIVATE = /\b(passeport|carte d'identite|carte vitale|identite|permis|iban|rib|releve|salaire|fiche de paie|bulletin|impots?|declaration|medical|medicale|ordonnance|sante|diagnostic|contrat|contacts?|carnet d'adresses|photos?|selfie|adresse (perso|du domicile)|numero de telephone|telephone|date de naissance|mot de passe|password|identifiants|credentials|\.env|id_rsa|\.ssh|\.aws|\.kube|cookies?|historique|passport|payslip|tax|health|contacts?\.vcf)\b/;
const EMAIL_OR_PHONE = /\b[\w.+-]+@[\w-]+\.[\w.]+\b|\b(?:\+?\d[\s.-]?){9,14}\b/;
function privateData(a: ActionState): number {
  const shares = a.tool === 'send_message' || sendsOut(a) >= 0.7;
  if (!shares) return NONE;
  if (PRIVATE.test(a.text) || EMAIL_OR_PHONE.test(a.text.replace(/telegram:\d+/g, ''))) return LIKELY;
  return a.tool === 'send_message' ? 0.15 : UNLIKELY;
}

const IRREVERSIBLE_CMD = [/\brm\s+-\w*r\w*f|\brm\s+-\w*f\w*r/, /\bshred\b/, /\s-delete\b/, /\bgit\s+(push\b[^\n]*(--force|-f\b)|reset\s+--hard|clean\s+-\w*f)/,
  /\bdrop\s+(table|database)\b/, /\bdelete\s+from\b/, /\btruncate\b/, /\bmkfs/, /\bdd\b[^\n]*\bof=/, /\bcrontab\s+-r\b/, /\bdocker\s+(system\s+prune|volume\s+rm)\b/, /\bremove-item\b[^\n]*-recurse/];
function irreversible(a: ActionState): number {
  if (a.tool === 'send_message') return LIKELY; // un message envoyé ne se reprend pas
  if (any(a.cmd, IRREVERSIBLE_CMD)) return STRONG;
  if (sendsOut(a) >= 0.7) return LIKELY;
  if (/(^|[\s;&|])rm\s/.test(a.cmd) || /(^|\s)del\s/.test(a.cmd)) return 0.6; // sans -r/-f : souvent récupérable… ou pas
  if (a.tool === 'system_update_apply' || systemChange(a) >= 0.7) return 0.45;
  if (a.tool === 'fs_write' || a.tool === 'fs_edit' || /\b(mv|sed\s+-i)\b/.test(a.cmd)) return 0.35;
  if (a.tool === 'schedule_task' || a.tool === 'schedule_cancel') return 0.1;
  if (unknownProgram(a)) return 0.45;
  return NONE;
}

// Intentions : verbes français et anglais (sans accents) → catégorie d'action.
const INTENT: Record<string, RegExp> = {
  delete: /\b(supprim\w*|effac\w*|vid(e|er|ez)|nettoi\w*|nettoy\w*|menage|purg\w*|desinstall\w*|retir\w*|arrete\w*|annul\w*|enleve\w*|delete|remove|erase|wipe|clean\w*|uninstall|cancel|stop)\b/,
  send: /\b(envoi\w*|envoy\w*|transmet\w*|partag\w*|previen\w*|prevenir|dis[- ](a|lui|leur)|ecris[- ]a|reponds? a|repondre a|publi\w*|pousse|televers\w*|send|share|tell|notify|email|mail|post|push|upload|forward|reply to)\b|\bcopi\w*\b[^.]{0,40}\b(sur|vers|chez|to)\b/,
  write: /\b(ecri\w*|cree\w*|creer|enregistr\w*|sauvegard\w*|not(e|er)|ajout\w*|modifi\w*|corrig\w*|mets|mettre|remplac\w*|renomm\w*|rang\w*|deplac\w*|organis\w*|gener\w*|redig\w*|complete\w*|write|create|save|edit|add|change|rename|move|fix|update)\b/,
  run: /\b(lanc\w*|execut\w*|demarr\w*|compil\w*|test\w*|construi\w*|analys\w*|convert\w*|install\w*|verifi\w*|fais|faire|ouvr\w*|ferm\w*|activ\w*|desactiv\w*|configur\w*|autoris\w*|bloqu\w*|redemarr\w*|run|start|build|check|exec\w*|convert|open|close|enable|disable|configure|allow|block|restart)\b/,
  schedule: /\b(planifi\w*|programm\w*|rappel\w*|chaque|tous les|toutes les|schedule|every|daily|weekly|remind)\b/,
  update: /\b(mets? a jour|met a jour|mettre a jour|fai(s|re) (les |la )?mises? a jour|applique\w*|installe\w*|update|upgrade|install)\b/,
};
const READ_ONLY = /\b(liste\w*|montr\w*|affich\w*|lis|lire|resum\w*|expliqu\w*|cherch\w*|trouv\w*|combien|quel\w*|quoi|ou (est|en est)|regarde\w*|consult\w*|etat|show|list|read|summar\w*|explain|find|search|what|which|how many|status)\b/;
const NEGATED = /\b(ne\s+\w+\s+(pas|rien|jamais)|ne touche|sans\s+(rien\s+)?(supprim|modifi|touch|envoy|chang)|n'\w+\s+(pas|rien)|don't|do not|never|without)\b/;

function actionIntents(a: ActionState, d: number, s: number, c: number): string[] {
  const out = new Set<string>();
  if (d >= 0.7) out.add('delete');
  if (s >= 0.7) out.add('send');
  if (a.tool === 'system_update_apply') out.add('update');
  else if (c >= 0.7) out.add('run');
  if (a.tool === 'fs_write' || a.tool === 'fs_edit') out.add('write');
  if (a.tool === 'shell' && !out.size) out.add('run');
  if (a.tool === 'schedule_task') out.add('schedule');
  if (a.tool === 'schedule_cancel') out.add('delete');
  return [...out];
}

/** Mots porteurs d'une action (fichiers, commandes, destinataires) retrouvés dans la demande. */
function overlap(a: ActionState, req: string): number {
  const stop = new Set(['les', 'des', 'une', 'pour', 'dans', 'avec', 'sur', 'the', 'and', 'with', 'from', 'ecrire', 'envoyer', 'caracteres', 'installer', 'mises', 'jour', 'sudo', 'shell', 'apt']);
  const words = (a.text.match(/[a-z0-9_.\-/]{3,}/g) ?? []).flatMap((w) => w.split(/[/.]/)).filter((w) => w.length >= 3 && !stop.has(w) && !/^\d+$/.test(w));
  return [...new Set(words)].filter((w) => req.includes(w)).length;
}

function requested(a: ActionState, reqRaw: unknown, d: number, s: number, c: number): number {
  const req = norm(reqRaw);
  if (!req.trim() || req.includes('(aucune demande')) return 0.03;
  const intents = actionIntents(a, d, s, c);
  const cmdWords = a.cmd.split(/\s+/).slice(0, 2).map((w) => w.replace(/[^a-z0-9-]/g, '')).filter((w) => w.length >= 3);
  const matched = intents.filter((i) => INTENT[i].test(req) || (i === 'run' && cmdWords.some((w) => new RegExp(`\\b${w}`).test(req))) || (i === 'write' && INTENT.update.test(req)));
  const ov = overlap(a, req);
  const risky = intents.some((i) => i === 'delete' || i === 'send' || i === 'update') || c >= 0.7;
  if (NEGATED.test(req) && !matched.length) return 0.05;
  if (NEGATED.test(req) && intents.some((i) => i === 'write' || i === 'delete')) return 0.1;
  if (matched.length === intents.length && intents.length) return ov ? STRONG : LIKELY;
  if (risky && READ_ONLY.test(req) && !matched.some((m) => m !== 'run')) return 0.06;
  // Une action sans effet risqué qui sert une simple question (« combien… ? » → du -sh) est demandée.
  if (!risky && (READ_ONLY.test(req) || /\?\s*$/.test(req)) && intents.every((i) => i === 'run')) return 0.75;
  if (matched.length) return ov ? 0.75 : UNSURE;
  if (ov >= 2) return 0.6;
  return risky ? 0.1 : 0.35;
}

// ---------- Contenu non fiable ----------

const AI_DIRECT = [
  /\b(ignore|disregard|forget|oublie|ignorez|oubliez)\b[^.\n]{0,40}\b(previous|prior|above|earlier|all|tes|vos|les|toutes?)\b[^.\n]{0,30}\b(instructions?|prompts?|rules|consignes|regles|directives)\b/,
  /\b(you are|tu es|vous etes|you're)\s+(now\s+)?(an?\s+|une?\s+|en\s+)?(ai|ia|assistant|chatbot|language model|llm|agent|developer mode|mode developpeur|dan)\b/,
  /\b(note|message|instructions?)\s+(to|for|pour|a|aux?)\s+(the\s+|les\s+|l')?(ai|ia|assistants?|agents?|llms?|models?|modeles?|bots?)\b/,
  /\b(if|si)\s+(you are|tu es|vous etes)\s+(an?\s+|une?\s+)?(ai|ia|assistant|llm|agent|bot|modele|model)\b/,
  /\b(assistant|agent|ia|ai|llm|chatbot|gpt|chatgpt|claude|gemini|copilot)\s*(ia\s*)?[:,]\s*(please\s+|stp\s+|merci de\s+)?(ignore|send|envoie|envoyez|execute|run|lance|forget|oublie|reveal|revele|print|affiche|reply|repond|stop)/,
  /\b(system prompt|prompt systeme|invite systeme|developer mode|jailbreak|do anything now|nouvelles instructions|new instructions)\b/,
  /<\|im_start\|>|\[inst\]|###\s*(instruction|system)|<\/?system>/,
  /(^|\n)\s*(system|systeme)\s*:/, /\b(no longer apply|ne s'appliquent plus|new task|nouvelle tache|from now on|desormais tu)\b/,
  /\b(dear|cher|chere|hey|hello|salut|bonjour)\s+(language model|ai|ia|assistant|bot|llm|agent|robot)\b/,
  /\b(forget|oublie\w*|ignore\w*)\b[^.\n]{0,40}\b(told|said|dit|instructions|rules|consignes|owner|proprietaire|maitre|user|utilisateur)\b/,
];
const AI_WORDS = /\b(ai|ia|assistant|agent|llm|chatbot|gpt|chatgpt|claude|gemini|modele de langage|language model)\b/;
const DISCLOSE = /\b(send|envoi\w*|envoy\w*|share|partag\w*|reveal|revel\w*|copi\w*|copy|paste|coll\w*|give|donn\w*|transmet\w*|forward|transfer\w*|print|affich\w*|show|leak|expose|email|communiqu\w*|reply with|repond\w* avec|saisi\w*|entr\w*|tap\w*|fourni\w*|provide|enter|type)\b/;
const SECRET_NOUN = /(\bcode\s+(recu|envoye|sms|par sms|de confirmation|a usage unique|otp)\b|\bone[- ]time (code|password)\b|\bsms code\b|\b(password|passwords|passwd|mot de passe|mots de passe|mdp|passphrase|api keys?|cles? (d'?)?api|access keys?|tokens?|jetons?|secrets?|credentials|identifiants|seed phrase|phrase de recuperation|private keys?|cles? privees?|ssh keys?|cles? ssh|carte bancaire|card number|numero de carte|cvv|cvc|code pin|pin code|codes? de verification|verification code|2fa|otp|cookies?)\b|\.env\b|id_rsa|id_ed25519|\.ssh\b)/;
const IMPERATIVE_ACT = /\b(run|execute|lance[zr]?|execut\w*|tape[zr]?|type|copy and paste|copiez|download|telecharg\w*|install\w*|click|cliqu\w*|call|appel\w*|contact\w*|scan\w*|ouvr\w*|open|visit\w*|rendez-vous)\b/;
const COMMAND_LIKE = /(\|\s*(ba|z)?sh\b|\bcurl\s|\bwget\s|\bpowershell\b|\bsudo\s|```|\biex\b|\bnpm\s+i|\bpip\s+install)/;

function addressesAi(c: string): number {
  if (any(c, AI_DIRECT)) return STRONG;
  if (AI_WORDS.test(c) && /\b(ignore|oublie|must|dois|devez|you must|instead|a la place|do it|fais-le|without asking|sans demander|secretly|en secret)\b/.test(c)) return 0.75;
  if (AI_WORDS.test(c)) return UNLIKELY;
  return NONE;
}

function asksSecrets(c: string): number {
  const sentences = c.split(/(?<=[.!?\n])\s+/);
  if (sentences.some((s) => DISCLOSE.test(s) && SECRET_NOUN.test(s) && !/\b(change|changer|modifi\w*|reset|reinitialis\w*|oubli\w* (votre|ton|son) mot)\b/.test(s))) return 0.9;
  if (SECRET_NOUN.test(c)) return UNLIKELY;
  return NONE;
}

function asksAction(c: string): number {
  if (IMPERATIVE_ACT.test(c) && COMMAND_LIKE.test(c)) return 0.88;
  if (/\b(cliquez|clique|click)\s+(ici|here|sur ce lien|this link)\b/.test(c)) return 0.85;
  if (/\b(envoie|envoyez|send|email|mail|transfer\w*|forward)\b[^\n]{0,60}\b(a|to)\s+\S+@\S+/.test(c)) return 0.85;
  if (/\b(post|upload|publie\w*|poste\w*|televers\w*|envoie|send)\b[^\n]{0,40}\b(to|sur|vers)\s+(pastebin|paste|gist|discord|telegram|http|un site|a site|the web)/.test(c)) return 0.85;
  if (/\b(do it now|fais-le|sans demander|without asking|immediately|immediatement)\b/.test(c) && /\b(you|tu|vous)\b/.test(c)) return 0.8;
  if (IMPERATIVE_ACT.test(c)) return 0.45;
  return 0.08;
}

// ---------- Mémoire ----------

const SECRET_PATTERNS = [/sk-(ant-|proj-|or-v1-)?[a-z0-9_-]{16,}/i, /gh[pousr]_[a-z0-9]{20,}/i, /akia[0-9a-z]{16}/i, /xox[abprs]-[a-z0-9-]{10,}/i, /-----begin [a-z ]*private key/i];
const SECRET_LABEL = /\b(mot de passe|mdp|password|passcode|passphrase|cle (d'?)?api|api key|token|jeton|secret|seed|pin|code (pin|d'acces|de l'alarme|de la porte|du portail|du coffre|secret|de deverrouillage|wi-?fi|du digicode|digicode|confidentiel)|digicode)\b[^.]{0,25}?(\best\b|\bis\b|=|:)\s*\S+/;
const CODE_DIGITS = /\b(code|pin)\b(?!\s+(postal|source|promo|couleur|vestimentaire|de la route|civil|penal))[^.\d]{0,25}\b\d{4,8}\b/;
const luhn = (digits: string) => {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) { let n = Number(digits[digits.length - 1 - i]); if (i % 2) { n *= 2; if (n > 9) n -= 9; } sum += n; }
  return sum % 10 === 0;
};

function secret(raw: string): number {
  const f = norm(raw);
  if (SECRET_PATTERNS.some((r) => r.test(raw))) return 0.97;
  const cards = raw.match(/\b(?:\d[ -]?){13,19}\b/g) ?? [];
  if (cards.some((c) => luhn(c.replace(/\D/g, '')))) return 0.95;
  if (/\bcarte bancaire|card number|numero de carte\b/.test(f) && /\d{4}[ -]?\d{4}/.test(f)) return 0.9;
  if (/\b[a-z]{2}\d{2}(?:\s?[a-z0-9]{4}){3,7}\b/i.test(raw) && /\biban\b/.test(f)) return 0.9;
  if (SECRET_LABEL.test(f)) return STRONG;
  if (CODE_DIGITS.test(f)) return 0.85;
  if (/\b(mot de passe|password|mdp|cle|token|code)\b/.test(f)) return 0.15;
  return 0.04;
}

const EPHEMERAL = /\b(aujourd'hui|ce soir|ce matin|cet apres-midi|cette nuit|demain|hier|maintenant|en ce moment|tout a l'heure|tantot|cette semaine|ce week-?end|jusqu'a \d|dans (une|\d+) (heure|minute)s?|today|tonight|tomorrow|yesterday|right now|this (week|morning|evening|afternoon)|in an hour)\b/;
const DURABLE = /\b(prefer\w*|aim\w*|adore\w*|detest\w*|toujours|jamais|habitude|habituellement|chaque|tous les|s'appelle|m'appelle|appelle|mon nom|ma femme|mon mari|ses enfants|mes enfants|sa fille|son fils|ma fille|mon fils|habit\w*|vit a|travaill\w*|projet|anniversaire|ne[e]? le|allergi\w*|langue|fuseau|adresse|serveur|nas|routeur|imprimante|code postal|prefers|likes|always|never|lives|works|name is|birthday|allergic|project|address|server)\b/;

function durable(raw: string): number {
  const f = norm(raw);
  if (EPHEMERAL.test(f)) return 0.12;
  if (DURABLE.test(f)) return 0.88;
  return 0.6;
}

// ---------- Réflexion ----------

function succeeded(transcript: string): number {
  const t = norm(transcript);
  const last = t.split('\n').reverse().find((l) => l.startsWith('odin :') && l.replace(/→.*/, '').trim().length > 7) ?? '';
  if (/\b(impossible|echec|echoue|erreur|n'ai pas pu|je n'arrive pas|pas reussi|bloque|refuse|failed|could not|couldn't|unable|error)\b/.test(last)) return 0.12;
  if (/\b(fait|termine|cree|ecrit|enregistre|reussi|voila|c'est bon|en ligne|range|installe|deploye|corrige|done|created|finished|success\w*|completed)\b/.test(last)) return 0.86;
  return 0.5;
}

function reusable(transcript: string): number {
  const calls = transcript.match(/→\s*([a-z_]+)\(/g) ?? [];
  const distinct = new Set(calls.map((c) => c.replace(/[→\s(]/g, ''))).size;
  if (calls.length >= 3 && distinct >= 2) return 0.82;
  if (calls.length >= 4) return 0.78;
  if (calls.length === 2) return 0.5;
  return 0.08;
}

// ---------- Routage ----------

const GREETING = /^(salut|bonjour|bonsoir|coucou|hello|hi|hey|merci|thanks|thank you|ok|okay|d'accord|super|parfait|top|cool|bravo|genial|bien recu|au revoir|bye|bonne (nuit|journee|soiree))\b/;
const TASK_EXTRA = /\b(reseau|appareils?|fichiers?|dossiers?|telecharg\w*|retiens|souviens|rappelle-moi|scann?\w*|range\w*|envoie|sauvegarde|imprime|imprimante|printer|nas|camera|routeur|router|wi-?fi|online|en ligne|connecte\w*|network|device|disque|serveur|server)\b/;
const REASONING = /\b(expliqu\w*|pourquoi|difference|lequel|laquelle|choisir|vaut-il mieux|which one|difference between|comment (fonctionne|marche|faire|puis-je)|compar\w*|analys\w*|avantages|inconvenients|strategie|plan\b|conseil\w*|ecris (un|une) (programme|script|fonction|code)|code|algorithme|architecture|explain|why|how does|compare|pros and cons|design|should i)\b/;

function route(message: string, options: string[]): Record<string, number> {
  const m = norm(message).trim();
  const score: Record<string, number> = { quick_reply: 0.2, task: 0.3, complex: 0.5 };
  const taskish = Object.values(INTENT).some((r) => r.test(m)) || TASK_EXTRA.test(m);
  if (GREETING.test(m) && m.length < 80) Object.assign(score, { quick_reply: 0.9, task: 0.05, complex: 0.05 });
  else if (REASONING.test(m) && !(/^(supprim|lance|cree|envoi|install|planifi|rang)/.test(m))) Object.assign(score, { quick_reply: 0.08, task: 0.17, complex: 0.75 });
  else if (taskish) Object.assign(score, { quick_reply: 0.08, task: 0.82, complex: 0.1 });
  else if (m.length < 70 && m.endsWith('?')) Object.assign(score, { quick_reply: 0.75, task: 0.1, complex: 0.15 });
  const out: Record<string, number> = {};
  for (const o of options) out[o] = score[o] ?? 0.1;
  const total = Object.values(out).reduce((a, b) => a + b, 0) || 1;
  for (const o of options) out[o] = Math.round((out[o] / total) * 1000) / 1000;
  return out;
}

// ---------- Le juge ----------

export function localJudge(): Judge {
  return async (state, questions) => {
    const a = actionOf(state);
    const d = deletes(a), s = sendsOut(a), c = systemChange(a);
    const content = norm(state.content);
    const nouls: Record<string, () => number> = {
      deletes: () => d,
      sends_out: () => s,
      system_change: () => c,
      requested: () => requested(a, state.user_request, d, s, c),
      money: () => money(a),
      private_data: () => privateData(a),
      irreversible: () => irreversible(a),
      addresses_ai: () => addressesAi(content),
      asks_secrets: () => asksSecrets(content),
      asks_action: () => asksAction(content),
      secret: () => secret(String(state.fact ?? '')),
      durable: () => durable(String(state.fact ?? '')),
      succeeded: () => succeeded(String(state.transcript ?? '')),
      reusable: () => reusable(String(state.transcript ?? '')),
    };
    const answers: Answers = {};
    for (const [name, q] of Object.entries(questions) as Array<[string, Question]>) {
      if (q.type === 'noul') answers[name] = { type: 'noul', noul: nouls[name]?.() ?? UNSURE };
      else if (q.type === 'choice') {
        const options = Object.keys(q.criteria);
        const probabilities = name === 'kind' ? route(String(state.message ?? ''), options) : Object.fromEntries(options.map((o) => [o, 1 / options.length]));
        const top = options.reduce((b, o) => (probabilities[o] > probabilities[b] ? o : b), options[0]);
        answers[name] = { type: 'choice', choice: top, probabilities, confidence: probabilities[top] };
      } else {
        const probabilities = Object.fromEntries(q.criteria.map((_, i) => [String(i), 1 / q.criteria.length]));
        answers[name] = { type: 'score', score: (q.criteria.length - 1) / 2, probabilities };
      }
    }
    return answers;
  };
}
