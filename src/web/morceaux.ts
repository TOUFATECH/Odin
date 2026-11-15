// Envoi d'un gros fichier (une ISO…) depuis le navigateur, en morceaux reprenables : chaque morceau s'ajoute au
// fichier entamé de l'appli (« .morceaux/<envoi>.part » dans son dossier d'arrivée). Après une coupure, le
// navigateur demande où en est l'envoi et reprend là. Le fichier fini passe ensuite par l'antivirus (l'appli
// l'importe : voir Hydre, action « importer_iso »).
import { createWriteStream, existsSync, mkdirSync, statSync } from 'node:fs';
import type { IncomingMessage } from 'node:http';
import { join } from 'node:path';

export interface Morceau { ok: boolean; /** octets déjà reçus pour cet envoi */ recu: number; error?: string }
/** Le fichier entamé d'un envoi (ou rien si l'identifiant n'a pas la bonne forme). */
export const fichierEnvoi = (dossier: string, envoi: string): string | undefined => (/^[a-f0-9]{24}$/.test(envoi) ? join(dossier, '.morceaux', `${envoi}.part`) : undefined);

/**
 * Reçoit un morceau. `debut` doit être la taille déjà reçue (sinon rien n'est écrit, et la réponse dit où reprendre).
 * `maxTotal` : taille maximale du fichier entier (64 Go).
 */
export async function recevoirMorceau(req: IncomingMessage, dossier: string, envoi: string, debut: number, maxTotal = 64 * 1024 ** 3): Promise<Morceau> {
  const f = fichierEnvoi(dossier, envoi);
  if (!f) { req.resume(); return { ok: false, recu: 0, error: 'envoi inconnu' }; }
  mkdirSync(join(dossier, '.morceaux'), { recursive: true, mode: 0o700 });
  const recu = existsSync(f) ? statSync(f).size : 0;
  if (!Number.isFinite(debut) || debut !== recu) { req.resume(); return { ok: false, recu, error: `reprise : ${recu} octet(s) déjà reçus, envoie la suite à partir de là` }; }
  try {
    const n = await new Promise<number>((ok, ko) => {
      let k = 0; const out = createWriteStream(f, { flags: 'a', mode: 0o600 });
      out.on('error', ko);
      // Si le disque est plus lent que le réseau, l'envoi attend : rien ne s'entasse en mémoire.
      req.on('data', (c: Buffer) => { k += c.byteLength; if (recu + k > maxTotal) { req.destroy(); out.destroy(); ko(new Error('fichier trop lourd (64 Go au plus)')); } else if (!out.write(c)) { req.pause(); out.once('drain', () => req.resume()); } });
      req.on('end', () => out.end(() => ok(k))); req.on('error', (e) => { out.end(); ko(e); });
    });
    return { ok: true, recu: recu + n };
  } catch (e) { return { ok: false, recu: existsSync(f) ? statSync(f).size : 0, error: (e as Error).message }; }
}
