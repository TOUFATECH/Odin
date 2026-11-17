// Médias reçus : le registre des fichiers qu'Odin a TÉLÉCHARGÉS lui-même (une vidéo d'un lien, une image d'une page).
// Seul un fichier inscrit ici, avec la MÊME empreinte SHA-256, peut être supprimé après avoir été compris et rangé :
// la décision ne repose jamais sur le dossier ni sur la seule « provenance » donnée par l'appelant. Un fichier du
// propriétaire (joint, caméra, messagerie, bibliothèque, ou écrit par media_convert là où il l'a demandé) n'y est
// jamais inscrit, donc jamais supprimé.
//
// Le registre est un petit JSON dans <workspace>/medias/telecharges.json (mode 600), borné (10 000 entrées, 2 Mio lus).
// Un registre abîmé ou trop gros est traité comme vide : rien n'est supprimé.

import { createHash } from 'node:crypto';
import { createReadStream, existsSync, mkdirSync, readFileSync, realpathSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const MAX_ENTREES = 10_000;
const MAX_OCTETS = 2 * 1024 * 1024;

export function cheminRegistre(workspace: string): string { return join(workspace, 'medias', 'telecharges.json'); }

/** Clé d'un chemin : chemin réel, en minuscules sous Windows (le système ne distingue pas la casse). */
function cle(chemin: string): string | undefined {
  try { const r = realpathSync(chemin); return process.platform === 'win32' ? r.toLowerCase() : r; } catch { return undefined; }
}

function lire(workspace: string): Record<string, string> {
  const p = cheminRegistre(workspace);
  try {
    if (!existsSync(p) || statSync(p).size > MAX_OCTETS) return {};
    const j = JSON.parse(readFileSync(p, 'utf8')) as { fichiers?: unknown };
    if (!j || typeof j.fichiers !== 'object' || j.fichiers === null) return {};
    const r: Record<string, string> = {};
    let n = 0;
    for (const [k, v] of Object.entries(j.fichiers as Record<string, unknown>)) {
      if (typeof v === 'string' && v.length === 64 && /^[0-9a-f]+$/.test(v)) { r[k] = v; if (++n >= MAX_ENTREES) break; }
    }
    return r;
  } catch { return {}; }
}

function ecrire(workspace: string, fichiers: Record<string, string>): void {
  const p = cheminRegistre(workspace);
  mkdirSync(dirname(p), { recursive: true });
  const tmp = `${p}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify({ version: 1, fichiers }), { mode: 0o600 });
  renameSync(tmp, p);
}

/** Empreinte SHA-256 d'un fichier, lue en flux. */
export async function empreinteFichier(chemin: string): Promise<string> {
  const h = createHash('sha256');
  for await (const m of createReadStream(chemin, { highWaterMark: 1024 * 1024 })) h.update(m as Buffer);
  return h.digest('hex');
}

/** À appeler par le code qui TÉLÉCHARGE (fetchVideo, image d'une page) juste après l'écriture du fichier. */
export async function inscrireTelechargement(workspace: string, chemin: string, empreinte?: string): Promise<void> {
  const k = cle(chemin);
  if (!k) return;
  const e = empreinte ?? await empreinteFichier(chemin);
  const f = lire(workspace);
  // Plus de 10 000 entrées : les plus anciennes partent (l'ordre d'insertion des objets JSON est gardé).
  const cles = Object.keys(f);
  for (const x of cles.slice(0, Math.max(0, cles.length - MAX_ENTREES + 1))) delete f[x];
  f[k] = e;
  ecrire(workspace, f);
}

/** Vrai seulement si le fichier est inscrit ET que son empreinte n'a pas changé. */
export function estTelechargementInscrit(workspace: string, chemin: string, empreinte: string | undefined): boolean {
  if (!empreinte || empreinte.length !== 64) return false;
  const k = cle(chemin);
  return !!k && lire(workspace)[k] === empreinte;
}

/** Retire une inscription : à appeler JUSTE AVANT de supprimer le fichier (son chemin réel doit encore exister). */
export function retirerTelechargement(workspace: string, chemin: string): void {
  const f = lire(workspace);
  const k = cle(chemin) ?? (process.platform === 'win32' ? chemin.toLowerCase() : chemin);
  if (k in f) { delete f[k]; try { ecrire(workspace, f); } catch { /* registre en lecture seule : sans effet sur la sûreté */ } }
}
