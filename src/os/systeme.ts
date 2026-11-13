// Odin OS — ce que le bureau a besoin de savoir sur la machine : où il tourne, ce qu'il peut faire ici.
// Rien n'est inventé : une capacité absente est dite absente, avec la raison quand elle aide.

import { existsSync, readFileSync, statfsSync } from 'node:fs';
import { arch, cpus, homedir, hostname, loadavg, release, uptime, userInfo } from 'node:os';
import { join } from 'node:path';
import type { OdinPaths } from '../config.ts';
import { memInfo } from '../valhalla/modules/eir.ts';
import { appVersions } from '../tools/self.ts';
import { BASE_OS, VERSION_OS } from './version.ts';

/** Où tourne Odin OS : une image (docker, lxc, pc, wsl, mobile) ou Odin installé sur sa machine (hote). */
export type Cible = 'docker' | 'lxc' | 'pc' | 'wsl' | 'mobile' | 'hote';
const CIBLES: Cible[] = ['docker', 'lxc', 'pc', 'wsl', 'mobile', 'hote'];

/** Vrai dans une image Odin OS : le système appartient à Odin (paquets, terminal, ponts). */
export function surOdinOS(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.ODIN_OS === '1') return true;
  if (env.ODIN_OS === '0') return false;
  try { return /^ID=odin-os$/m.test(readFileSync('/etc/os-release', 'utf8')); } catch { return false; }
}
export function cible(env: NodeJS.ProcessEnv = process.env): Cible {
  let c = String(env.ODIN_OS_CIBLE ?? '').trim();
  if (!c) { try { c = readFileSync('/etc/odin-os/cible', 'utf8').trim(); } catch { /* pas une image */ } }
  return (CIBLES as string[]).includes(c) && (c === 'hote' || surOdinOS(env)) ? c as Cible : 'hote';
}

/** Le terminal du bureau peut-il lancer de vraies commandes ? Oui dans une image Odin OS ; ailleurs, seulement si le propriétaire l'a ouvert depuis la ligne de commande (`odin os terminal on`). */
export const fichierTerminal = (paths: OdinPaths): string => join(paths.home, 'os', 'terminal-autorise');
export function terminalAutorise(paths: OdinPaths, env: NodeJS.ProcessEnv = process.env): boolean { return surOdinOS(env) || existsSync(fichierTerminal(paths)); }

/** Une session graphique est-elle ouverte (image PC) ? Les applis à fenêtre s'y affichent. */
export function affichage(env: NodeJS.ProcessEnv = process.env): { socket: string; dossier: string } | undefined {
  const dossier = env.XDG_RUNTIME_DIR || `/run/user/${userInfo().uid}`;
  for (const s of [env.WAYLAND_DISPLAY, 'wayland-0', 'wayland-1'].filter(Boolean) as string[]) if (existsSync(join(dossier, s))) return { socket: s, dossier };
  return undefined;
}
const a = (f: string) => existsSync(f);
export interface Pont { installe: boolean; possible: boolean; pourquoi?: string }
/** Les ponts de compatibilité : installés ? installables ici ? */
export function ponts(env: NodeJS.ProcessEnv = process.env): Record<'windows' | 'android' | 'mac', Pont> {
  const os = surOdinOS(env), c = cible(env), apt = os && a('/usr/bin/apt-get'), x64 = arch() === 'x64';
  const ailleurs = 'Ce pont s\'installe sur un Odin OS installé (Docker, LXC, PC). Ici, Odin tourne sur ta machine et ne touche pas à ses paquets.';
  return {
    windows: { installe: a('/usr/bin/wine') || a('/usr/bin/wine64'), possible: apt && x64, pourquoi: !os ? ailleurs : !x64 ? 'Wine fait tourner des applis Windows pour processeur Intel/AMD : pas sur ce processeur ARM.' : affichage(env) ? undefined : 'Installable ici. Sans écran (Docker, LXC), seuls les programmes Windows en ligne de commande tournent ; les fenêtres s\'affichent sur l\'image PC.' },
    android: { installe: a('/usr/bin/waydroid'), possible: apt && c === 'pc', pourquoi: !os ? ailleurs : c !== 'pc' ? 'Waydroid a besoin de l\'image PC d\'Odin OS (un vrai noyau Linux et un écran). Il ne tourne pas dans un conteneur.' : undefined },
    mac: { installe: a('/usr/bin/darling') || a('/usr/local/bin/darling'), possible: apt && x64 && c === 'pc', pourquoi: !os ? ailleurs : !x64 ? 'Darling n\'existe que pour processeur Intel/AMD.' : c !== 'pc' ? 'Darling a besoin de l\'image PC d\'Odin OS (un vrai noyau Linux). Il ne tourne pas dans un conteneur.' : 'Expérimental : seuls les outils Mac en ligne de commande sont installés.' },
  };
}

/** Disques où installer Odin OS depuis l'image de démarrage (seulement dans la session d'essai de l'image PC). */
export function disquesInstallables(): Array<{ nom: string; taille: number; modele: string }> {
  if (!a('/run/live/medium') || !a('/usr/local/sbin/odin-os-installer')) return [];
  const liste: Array<{ nom: string; taille: number; modele: string }> = [];
  try {
    for (const l of readFileSync('/proc/partitions', 'utf8').split('\n').slice(2)) {
      const [, , blocs, nom] = l.trim().split(/\s+/);
      if (!nom || !/^(sd[a-z]+|vd[a-z]+|nvme\d+n\d+|mmcblk\d+)$/.test(nom)) continue;
      let amovible = '0', modele = '', lecture = '0';
      try { amovible = readFileSync(`/sys/block/${nom}/removable`, 'utf8').trim(); lecture = readFileSync(`/sys/block/${nom}/ro`, 'utf8').trim(); } catch { /* inconnu */ }
      try { modele = readFileSync(`/sys/block/${nom}/device/model`, 'utf8').trim(); } catch { /* disque virtuel */ }
      const taille = Number(blocs) * 1024;
      if (lecture === '1' || taille < 6 * 2 ** 30) continue; // lecture seule (le support de démarrage) ou trop petit
      void amovible; liste.push({ nom: `/dev/${nom}`, taille, modele });
    }
  } catch { /* pas de /proc/partitions */ }
  // Le support d'où l'on a démarré n'est pas proposé.
  let support = ''; try { support = (/^(\/dev\/\S+)\s+\/run\/live\/medium\s/m.exec(readFileSync('/proc/mounts', 'utf8'))?.[1] ?? '').replace(/p?\d+$/, ''); } catch { /* inconnu */ }
  return liste.filter((d) => d.nom !== support);
}

export interface Systeme {
  ok: true; os: { version: string; base: string }; odin: { version: string }; cible: Cible; demo: boolean;
  machine: { nom: string; processeur: string; coeurs: number; memoire: { total: number; libre: number }; disque: { total: number; libre: number }; noyau: string; depuis: number; charge: number };
  capacites: { terminal: boolean; apt: boolean; affichage: boolean; ponts: ReturnType<typeof ponts>; disque?: { possible: boolean; disques: ReturnType<typeof disquesInstallables> }; clavier?: string };
  compte: { prenom: string } | null;
}
/** Tout ce que le bureau affiche sur la machine (Réglages → Système, widgets) et ce qu'il a le droit de proposer. */
export function systeme(o: { paths: OdinPaths; demo?: boolean; prenom?: string }, env: NodeJS.ProcessEnv = process.env): Systeme {
  const m = memInfo(), c = cible(env), os = surOdinOS(env);
  let disque = { total: 0, libre: 0 };
  try { const s = statfsSync(homedir()); disque = { total: s.blocks * s.bsize, libre: s.bavail * s.bsize }; } catch { /* système de fichiers illisible */ }
  const disques = c === 'pc' ? disquesInstallables() : [];
  let clavier: string | undefined; if (c === 'pc') { try { clavier = readFileSync('/etc/odin-os/clavier', 'utf8').trim() || 'fr'; } catch { clavier = 'fr'; } }
  return {
    ok: true, os: { version: VERSION_OS, base: BASE_OS.nom }, odin: { version: appVersions().running || appVersions().disk }, cible: c, demo: Boolean(o.demo),
    machine: { nom: hostname(), processeur: (cpus()[0]?.model ?? 'inconnu').replace(/\s+/g, ' ').trim(), coeurs: cpus().length || 1, memoire: { total: m.total, libre: m.available }, disque, noyau: release(), depuis: Math.round(uptime()), charge: loadavg()[0] ?? 0 },
    capacites: { terminal: terminalAutorise(o.paths, env), apt: os && a('/usr/bin/apt-get'), affichage: Boolean(affichage(env)), ponts: ponts(env), ...(disques.length ? { disque: { possible: true, disques } } : {}), ...(clavier ? { clavier } : {}) },
    compte: o.prenom ? { prenom: o.prenom } : null,
  };
}
