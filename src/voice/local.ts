// La voix « sur la machine » : ce qui reste après le retrait des modèles d'autrui (décision du 17/11/2026).
//
// Odin n'utilise plus Whisper (écoute) ni Piper (voix) : ce sont des modèles entraînés par d'autres, même quand ils
// tournent sur la machine. Rien n'est plus installé, téléchargé ni lancé ici ; un Whisper ou un Piper déjà présent sur
// le disque est ignoré (il n'est pas effacé : c'est au propriétaire d'en décider). Chaque fonction répond « pas
// encore » tant que le modèle d'écoute ou de voix d'Odin n'est pas entraîné. Ce qui n'avait plus d'appelant (installer,
// lancer Piper, l'outil d'installation) est supprimé ; les noms qui restent ont encore des appelants.

import { existsSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { ModelePasEntraine, pasEntraine } from '../langue/pas-entraine.ts';

const voiceHome = (home = process.env.ODIN_HOME ?? join(homedir(), '.odin')) => join(home, 'voice');
/** Whisper n'est plus utilisé, même installé sur la machine : jamais de programme d'écoute d'autrui. */
export function localWhisper(_home?: string): { bin: string; model: string } | undefined { return undefined; }

export interface Segment { start: number; end: number; text: string }
/** `confiance` : probabilité de la langue reconnue (0 à 1), quand un modèle d'écoute la donne. */
export interface Heard { text: string; language: string; segments: Segment[]; confiance?: number }

/** Audio → texte : pas encore (le modèle d'écoute d'Odin n'est pas entraîné). */
export async function hearLocal(_audio: Uint8Array | { file: string }, language = 'auto', _home?: string, _timeoutMs = 0, _hint = ''): Promise<Heard> {
  throw new ModelePasEntraine('ecouter', language);
}

/** L'écoute ne peut pas tourner : la phrase « pas encore », à dire telle quelle. */
export function voiceBlocked(_home?: string): string { return pasEntraine('ecouter'); }

/** Une ancienne installation attendait les droits administrateur (marque laissée sur le disque). */
const waitFile = (home?: string) => join(voiceHome(home), 'attend-les-droits');
export const voiceWaitsAdmin = (home?: string) => existsSync(waitFile(home));
/** Plus rien à relancer : l'ancienne marque d'attente est effacée, et rien ne repart. */
export function resumeVoiceInstall(_notify?: (msg: string) => void, home?: string): boolean {
  try { if (existsSync(waitFile(home))) rmSync(waitFile(home)); } catch { /* facultatif */ }
  return false;
}
