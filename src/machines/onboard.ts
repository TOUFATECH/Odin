// Prise en main d'une machine à partir d'un mot de passe donné dans la discussion.
//
// 1. Le mot de passe est retiré du message AVANT le modèle (il ne le voit jamais) et gardé à part,
//    chiffré avec le coffre, pendant une heure : le modèle n'a qu'une référence (« secret:dernier »).
// 2. machine_onboard : Odin se connecte, installe SA clé SSH, vérifie qu'elle marche, crée un jeton
//    d'API s'il s'agit d'un Proxmox, puis (si demandé) change le mot de passe — seulement une fois la
//    clé vérifiée, pour ne jamais se retrouver enfermé dehors.
// 3. Le nouveau mot de passe part directement au propriétaire (message éphémère), jamais au modèle.

import { randomInt } from 'node:crypto';
import { existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { readSecretFile, writeSecretFile } from '../vault.ts';
import { listMachines, runOnMachine, saveMachine, testMachine, type Machine } from './access.ts';

const pendingFile = (home: string) => join(home, 'pending-secret.json');
const TTL = 3600_000;

/** Mots qui suivent souvent « mot de passe » sans en être un. */
const NOT_A_SECRET = /^(est|sera|serait|de|du|des|le|la|les|pour|sur|root|admin|administrateur|proxmox|du serveur|oublié|perdu|changé|incorrect|faux|bon|correct|svp|stp|merci|ici|ça|ca|pas|aussi|même|que|qui)$/i;

/**
 * Retire un mot de passe d'un message (« le mot de passe root est X », « mdp : X », « password=X »).
 * Rend le texte nettoyé et le secret trouvé.
 */
export function extractSecret(text: string): { text: string; secret?: string; label?: string } {
  const re = /\b(mot de passe|mdp|password|passwd|pwd|pass)\b([^:=\n]{0,48}?)\s*(?:est|c'est|=|:)\s*[«"'`]?\s*([^\s«»"'`]{4,128})\s*[»"'`]?/i;
  const m = re.exec(text);
  if (!m) return { text };
  const value = m[3].replace(/[.,;]+$/, ''); // « ! » et « ? » peuvent faire partie du mot de passe
  if (NOT_A_SECRET.test(value) || value.length < 4) return { text };
  // Un vrai mot de passe a rarement l'air d'un mot français tout simple : on exige un chiffre, un symbole,
  // une majuscule au milieu, ou au moins 10 caractères.
  if (!/[\d\W_]|.[A-Z]/.test(value) && value.length < 10) return { text };
  const label = `${m[1]}${m[2]}`.trim().replace(/\s+/g, ' ');
  return { text: text.slice(0, m.index) + `${m[1]}${m[2]} : [mot de passe reçu — gardé à part, référence secret:dernier]` + text.slice(m.index + m[0].length), secret: value, label };
}

export function keepSecret(home: string, value: string, label = '', now = Date.now()): void {
  writeSecretFile(pendingFile(home), JSON.stringify({ value, label, at: now }));
}
export function takeSecret(home: string, now = Date.now()): string | undefined {
  try {
    const p = JSON.parse(readSecretFile(pendingFile(home)) ?? 'null') as { value: string; at: number } | null;
    if (!p || now - p.at > TTL) { forgetSecret(home); return undefined; }
    return p.value;
  } catch { return undefined; }
}
export function pendingSecretLabel(home: string, now = Date.now()): string | undefined {
  try { const p = JSON.parse(readSecretFile(pendingFile(home)) ?? 'null') as { label: string; at: number } | null; return p && now - p.at <= TTL ? p.label || 'mot de passe' : undefined; } catch { return undefined; }
}
export function forgetSecret(home: string): void { try { if (existsSync(pendingFile(home))) unlinkSync(pendingFile(home)); } catch { /* rien */ } }

/** Mot de passe fort mais lisible : 4 groupes de 5 caractères, sans caractères ambigus. */
export function newPassword(): string {
  const A = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const g = () => Array.from({ length: 5 }, () => A[randomInt(A.length)]).join('');
  let p = ''; do p = [g(), g(), g(), g()].join('-'); while (!/\d/.test(p) || !/[A-Z]/.test(p) || !/[a-z]/.test(p));
  return p;
}

export interface OnboardResult { ok: boolean; steps: string[]; machine?: Machine; newPassword?: string; proxmox?: { url: string; token: string } }

/**
 * Prend la main sur une machine : clé SSH d'Odin, jeton Proxmox, changement du mot de passe.
 * Ne renvoie jamais un mot de passe dans `steps` (ce texte va au modèle).
 */
export async function onboardMachine(home: string, o: { host: string; port?: number; user?: string; password: string; label?: string; changePassword?: boolean; signal?: AbortSignal }): Promise<OnboardResult> {
  const steps: string[] = [], user = o.user || 'root';
  let m = saveMachine(home, { host: o.host, port: o.port, user, password: o.password, label: o.label || o.host });
  const t = await testMachine(home, m, true);
  if (!t.ok) return { ok: false, steps: [`Connexion à ${user}@${o.host} impossible : ${t.message}`] };
  steps.push(`Connecté à ${user}@${o.host}.`);
  m = listMachines(home).find((x) => x.id === m.id) ?? m;
  // La clé seule doit marcher avant de toucher au mot de passe (sinon Odin pourrait s'enfermer dehors).
  const keyOnly = await runOnMachine(home, { ...m, password: undefined }, 'echo cle-ok', { timeoutMs: 20_000, signal: o.signal }).catch(() => ({ code: 1, out: '' }));
  const keyOk = keyOnly.code === 0 && /cle-ok/.test(keyOnly.out);
  steps.push(keyOk ? 'Clé SSH d\'Odin installée et vérifiée : il se connecte désormais sans mot de passe.' : 'La clé SSH n\'a pas pu être vérifiée : je garde le mot de passe et je ne le change pas.');
  // Proxmox : jeton d'API dédié à Odin.
  let proxmox: OnboardResult['proxmox'];
  const pve = await runOnMachine(home, m, 'command -v pveum >/dev/null && pveversion 2>/dev/null | head -1', { timeoutMs: 20_000, signal: o.signal }).catch(() => ({ code: 1, out: '' }));
  if (pve.code === 0 && /pve-manager/i.test(pve.out)) {
    const realm = user === 'root' ? 'root@pam' : `${user}@pam`;
    const r = await runOnMachine(home, m, `pveum user token remove ${realm} odin >/dev/null 2>&1; pveum user token add ${realm} odin --privsep 0 --output-format json`, { timeoutMs: 30_000, signal: o.signal }).catch((e) => ({ code: 1, out: String((e as Error).message) }));
    const value = r.out.match(/"value"\s*:\s*"([0-9a-f-]{36})"/i)?.[1];
    if (value) { proxmox = { url: `https://${o.host}:8006`, token: `${realm}!odin=${value}` }; steps.push(`Proxmox détecté (${pve.out.trim().split(' ')[0]}) : jeton d'API « odin » créé et enregistré.`); }
    else steps.push(`Proxmox détecté, mais la création du jeton a échoué : ${r.out.slice(0, 200)}`);
  }
  // Nouveau mot de passe, une fois la clé vérifiée.
  let fresh: string | undefined;
  if (o.changePassword !== false && keyOk) {
    fresh = newPassword();
    const cmd = user === 'root' ? 'chpasswd' : 'sudo -S -p "" chpasswd';
    const stdin = user === 'root' ? `${user}:${fresh}\n` : `${o.password}\n${user}:${fresh}\n`;
    const r = await runOnMachine(home, { ...m, password: undefined }, cmd, { stdin, timeoutMs: 20_000, signal: o.signal }).catch((e) => ({ code: 1, out: String((e as Error).message) }));
    if (r.code === 0) { m = saveMachine(home, { id: m.id, host: m.host, port: m.port, user, label: m.label, password: fresh }); steps.push('Mot de passe changé ; le nouveau t\'est envoyé en message privé et gardé chiffré dans le coffre.'); }
    else { fresh = undefined; steps.push(`Le changement de mot de passe a échoué (${r.out.replace(/\s+/g, ' ').slice(0, 160)}) : l'ancien reste valable.`); }
  }
  return { ok: true, steps, machine: m, newPassword: fresh, proxmox };
}
