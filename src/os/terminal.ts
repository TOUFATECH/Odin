// Odin OS — le Terminal du bureau : une ligne de commande, lancée telle quelle par bash, avec sa sortie.
// Ouvert seulement dans une image Odin OS (ou si le propriétaire l'a décidé : `odin os terminal on`).
// Pas de programme interactif (nano, top) : chaque commande a 2 minutes, sa sortie est limitée.

import { spawn } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';

const MAX_SORTIE = 200_000, DELAI = 120_000;
/** Commandes qui peuvent faire de gros dégâts : le bureau demande « o/n » avant de les lancer. */
const SENSIBLES: Array<[RegExp, string]> = [
  [/\brm\s+(-[a-zA-Z]*\s+)*-[a-zA-Z]*[rRf]/, 'effacer des fichiers sans passer par la corbeille'],
  [/\b(mkfs(\.\w+)?|wipefs|sgdisk|sfdisk|parted|fdisk)\b/, 'modifier ou effacer un disque'],
  [/\bdd\b[^|;&]*\bof=/, 'écrire directement sur un disque ou un fichier (dd)'],
  [/\b(shutdown|reboot|poweroff|halt)\b|\bsystemctl\s+(reboot|poweroff|halt)\b/, 'éteindre ou redémarrer la machine'],
  [/\bapt(-get)?\s+(-\S+\s+)*(remove|purge|autoremove)\b|\bdpkg\s+(-\S+\s+)*(-r|-P|--remove|--purge)\b/, 'désinstaller des paquets du système'],
  [/\b(userdel|deluser|passwd|chown\s+-R|chmod\s+-R)\b/, 'changer des comptes ou des droits'],
  [/:\(\)\s*\{|>\s*\/dev\/(sd|vd|nvme|mmcblk)/, 'une commande dangereuse pour la machine'],
];
export function sensible(commande: string): string | undefined { return SENSIBLES.find(([re]) => re.test(commande))?.[1]; }

export interface SortieTerminal { ok: boolean; sortie?: string; code?: number; dossier?: string; error?: string; confirm?: string }
export async function executer(commande: string, dossier: string, o: { confirm?: boolean; delai?: number } = {}): Promise<SortieTerminal> {
  const cmd = commande.trim().slice(0, 4000); if (!cmd) return { ok: true, sortie: '', code: 0, dossier };
  const ici = dossier && existsSync(dossier) ? dossier : homedir();
  // « cd » change le dossier du terminal : bash ne le garderait pas d'une commande à l'autre.
  const cd = /^cd(?:\s+(.+))?$/.exec(cmd);
  if (cd) {
    const cible = resolve(ici, (cd[1] ?? '~').trim().replace(/^["']|["']$/g, '').replace(/^~(?=$|\/)/, homedir()));
    try { if (statSync(cible).isDirectory()) return { ok: true, sortie: '', code: 0, dossier: cible }; } catch { /* introuvable */ }
    return { ok: true, sortie: `cd : dossier introuvable : ${cd[1] ?? ''}`, code: 1, dossier: ici };
  }
  const pourquoi = sensible(cmd);
  if (pourquoi && o.confirm !== true) return { ok: false, confirm: `Cette commande peut ${pourquoi}. La lancer ?` };
  return new Promise((fin) => {
    let sortie = '', coupe = false;
    const p = spawn('/bin/bash', ['-c', cmd], { cwd: ici, env: { ...process.env, TERM: 'dumb', DEBIAN_FRONTEND: 'noninteractive', LANG: process.env.LANG ?? 'C.UTF-8', HOME: homedir(), XDG_RUNTIME_DIR: process.env.XDG_RUNTIME_DIR ?? `/run/user/${process.getuid?.() ?? 1000}` }, stdio: ['ignore', 'pipe', 'pipe'] });
    const lire = (b: Buffer) => { if (sortie.length < MAX_SORTIE) sortie += b.toString('utf8'); else coupe = true; };
    p.stdout.on('data', lire); p.stderr.on('data', lire);
    const garde = setTimeout(() => { sortie += '\n[commande arrêtée : plus de 2 minutes. Pour une longue installation, passe par Odin Store.]'; p.kill('SIGKILL'); }, o.delai ?? DELAI);
    p.on('error', (e) => { clearTimeout(garde); fin({ ok: false, error: e.message }); });
    p.on('close', (code) => { clearTimeout(garde); fin({ ok: true, sortie: sortie.slice(0, MAX_SORTIE).replace(/\u001b\[[0-9;?]*[A-Za-z]/g, '') + (coupe ? '\n[sortie coupée]' : ''), code: code ?? 1, dossier: ici }); });
  });
}
