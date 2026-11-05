// Garde des scripts et des compétences : analyse avant enregistrement (secrets en clair, commandes
// destructrices, envoi de données vers Internet) et signature (un fichier modifié en dehors d'Odin
// est refusé). Tout est automatique : rien à faire de ton côté.

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { hardDenied } from '../heimdall/policy.ts';

const SECRETS: Array<[RegExp, string]> = [
  [/\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{20,}/, 'clé d\'API (sk-…)'],
  [/\bAKIA[0-9A-Z]{16}\b/, 'clé AWS'],
  [/\bgh[pousr]_[A-Za-z0-9]{30,}/, 'jeton GitHub'],
  [/\bxox[abpr]-[A-Za-z0-9-]{10,}/, 'jeton Slack'],
  [/\b\d{8,10}:[A-Za-z0-9_-]{35}\b/, 'jeton de bot Telegram'],
  [/-----BEGIN (?:RSA |EC |OPENSSH |)PRIVATE KEY-----/, 'clé privée'],
  [/\b(?:password|passwd|mot_?de_?passe|secret|token|api_?key)\s*[:=]\s*["'][^"'\s$%{]{6,}["']/i, 'mot de passe ou jeton écrit en dur'],
  [/PVEAPIToken=[^\s"']+=[0-9a-f-]{30,}/i, 'jeton Proxmox'],
];
const DANGER: Array<[RegExp, string]> = [
  [/\b(curl|wget)\b[^\n|]*\|\s*(sudo\s+)?(ba|z|)sh\b/i, 'télécharge et exécute un script d\'Internet'],
  [/\bnc\b[^\n]*\s-[a-z]*e\s|\bbash\s+-i\s+>&\s*\/dev\/tcp/i, 'shell inversé'],
  [/base64\s+(-d|--decode)[^\n]*\|\s*(ba|)sh/i, 'code caché décodé puis exécuté'],
  [/\bchmod\s+(-R\s+)?777\s+\/(\s|$)/, 'droits ouverts sur tout le système'],
  [/\bcrontab\s+-r\b/, 'efface toutes les tâches planifiées'],
  [/\bhistory\s+-c\b|unset\s+HISTFILE/, 'efface les traces'],
];
const EXFIL = /\b(curl|wget)\b[^\n]*(-d|--data|-F|--upload-file|-T)\b|requests\.(post|put)\(|fetch\([^)]*method:\s*['"](POST|PUT)|urllib\.request\.urlopen\([^)]*data=|\bscp\s|\brsync\s[^\n]*::?|smtplib/i;

export interface Scan { refuse?: string; warnings: string[] }
/** Analyse un script ou une compétence avant de l'enregistrer (pur, testable). */
export function scanCode(code: string): Scan {
  const deny = hardDenied(code);
  if (deny) return { refuse: `commande destructrice interdite (règle ${deny})`, warnings: [] };
  const sec = SECRETS.find(([re]) => re.test(code));
  if (sec) return { refuse: `${sec[1]} en clair dans le code : passe-le par une variable d'environnement ou le coffre`, warnings: [] };
  const warnings = DANGER.filter(([re]) => re.test(code)).map(([, w]) => w);
  if (EXFIL.test(code)) warnings.push('envoie des données vers l\'extérieur (vérifie la destination)');
  return { warnings };
}

// ---------------- Signature ----------------

function key(home: string): Buffer {
  const f = join(home, 'script-key');
  if (!existsSync(f)) { mkdirSync(home, { recursive: true }); writeFileSync(f, randomBytes(32).toString('hex'), { mode: 0o600 }); try { chmodSync(f, 0o600); } catch { /* Windows */ } }
  return Buffer.from(readFileSync(f, 'utf8').trim(), 'hex');
}
export const sign = (home: string, content: string) => createHmac('sha256', key(home)).update(content.replace(/\r\n/g, '\n')).digest('hex');
export function verify(home: string, content: string, sig?: string): boolean {
  if (!sig || !/^[0-9a-f]{64}$/.test(sig)) return false;
  const a = Buffer.from(sign(home, content), 'hex'), b = Buffer.from(sig, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}
