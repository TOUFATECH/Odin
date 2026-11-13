// Profil de la machine : Odin sait où il vit (système, ressources, outils installés).
// Rafraîchi une fois par jour au démarrage de la passerelle, gardé épinglé en mémoire.

import { spawnSync } from 'node:child_process';
import { arch, cpus, hostname, platform, release, totalmem } from 'node:os';
import type { Mnemosyne } from '../muninn/store.ts';

const TOOLS = ['git', 'docker', 'ffmpeg', 'ffprobe', 'python3', 'pdftotext', 'soffice', 'magick', 'tesseract', 'brew', 'apt', 'winget', 'ollama', 'ssh'];

export function hasCommand(cmd: string): boolean {
  const probe = process.platform === 'win32' ? spawnSync('where', [cmd], { stdio: 'ignore', windowsHide: true }) : spawnSync('sh', ['-c', `command -v ${cmd}`], { stdio: 'ignore' });
  return probe.status === 0;
}

export function environmentProfile(): string {
  const os = { darwin: 'macOS', linux: 'Linux', win32: 'Windows' }[platform() as string] ?? platform();
  const tools = TOOLS.filter(hasCommand);
  const ram = Math.round(totalmem() / 1024 ** 3);
  return `Environnement de la machine « ${hostname()} » : ${os} ${release()} (${arch()}), ${cpus().length} cœurs, ${ram} Go de mémoire, Node ${process.versions.node}. Outils disponibles : ${tools.join(', ') || 'aucun des outils courants'}.`;
}

/** Remplace l'ancien profil (épinglé) par le profil actuel. */
export function refreshEnvironment(muninn: Mnemosyne, profile = environmentProfile()): number {
  for (const m of muninn.listMemories(500)) if (m.kind === 'environment' && m.content.startsWith('Environnement de la machine')) muninn.forget(m.id);
  const { id } = muninn.remember(profile, 'agent', 'environment');
  muninn.pin(id, true);
  return id;
}
