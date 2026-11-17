// Le catalogue du modèle de sons : un identifiant neutre (« sons-petit »), sa taille, son empreinte, sa licence et sa
// provenance. Ce modèle a été entraîné par d'autres : depuis le 17/11/2026 (aucun modèle qui ne soit pas celui d'Odin),
// il n'est plus téléchargé. Des poids déjà présents sur le disque ne sont pas effacés sans l'accord du propriétaire.

import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { Mesure } from './contrat.ts';

export interface FicheModele {
  id: 'sons-petit';
  fichier: 'sons-petit.safetensors';
  config: 'sons-petit.config.json';
  taille: number;
  sha256: string;
  licence: string;
  /** d'où venaient les poids (provenance notée à côté d'eux ; plus rien n'y est téléchargé) */
  urlPoids: string;
}

export const CATALOGUE_SONS: FicheModele = {
  id: 'sons-petit',
  fichier: 'sons-petit.safetensors',
  config: 'sons-petit.config.json',
  taille: 22_028_820,
  sha256: '0e086f0cd62814c6def89001f3f25193f75955696f6975ef6800af31d00d6dd7',
  licence: 'Apache-2.0',
  urlPoids: 'https://huggingface.co/mispeech/ced-tiny/resolve/main/model.safetensors',
};

/** Fichier d'état écrit après la première passe réussie. */
export const FICHIER_ETAT = 'sons-petit.etat.json';
/** Note de provenance (empreinte, licence, source), écrite à côté des poids. */
export const FICHIER_LICENCE = 'sons-petit.licence.txt';
/** Taille maximale du fichier de configuration. */
export const MAX_CONFIG = 1024 * 1024;

/** Où en est le modèle de sons dans ce dossier (lecture rapide, sans recalculer l'empreinte). */
export function etatModeleSons(dossier: string): { present: boolean; verifie: boolean; aTourne: boolean; quand?: string; mesure?: Mesure } {
  const f = CATALOGUE_SONS;
  const poids = join(dossier, f.fichier);
  let present = false, verifie = false;
  try {
    const st = statSync(poids);
    present = st.isFile();
    if (present && st.size === f.taille && existsSync(join(dossier, f.config))) {
      const note = readFileSync(join(dossier, FICHIER_LICENCE), 'utf8').slice(0, 2000);
      verifie = note.includes(`sha256=${f.sha256}`);
    }
  } catch { /* absent */ }
  let aTourne = false, quand: string | undefined, mesure: Mesure | undefined;
  try {
    const e = JSON.parse(readFileSync(join(dossier, FICHIER_ETAT), 'utf8').slice(0, 10_000)) as Record<string, unknown>;
    aTourne = e.aTourne === true;
    if (typeof e.quand === 'string' && e.quand.length <= 40) quand = e.quand;
    const m = e.mesure as Record<string, unknown> | undefined;
    if (m && m.etape === 'modele_sons' && typeof m.ms === 'number' && typeof m.xTempsReel === 'number') mesure = { etape: 'modele_sons', ms: m.ms, xTempsReel: m.xTempsReel };
  } catch { /* jamais tourné */ }
  return { present, verifie, aTourne: present && aTourne, ...(quand ? { quand } : {}), ...(mesure ? { mesure } : {}) };
}
