// GET /api/memoire/export : toute la mémoire d'Odin en une archive .zip (voir src/muninn/export-memoire.ts), en lecture
// seule, pour le PROPRIÉTAIRE seul, depuis son navigateur (sa session) et l'interface d'Odin (en-tête x-odin).
// Refusé (403, code « refuse ») : un membre, la clé d'API (un programme), le port direct d'une appli, une requête venue
// d'un autre site, une requête sans l'en-tête de l'interface. L'archive part en flux vers le navigateur : rien n'est
// écrit sur le disque d'Odin.

import type { IncomingMessage, ServerResponse } from 'node:http';
import { exporterMemoire, type SourcesMemoire } from '../muninn/export-memoire.ts';
import type { Odin } from '../runtime.ts';
import { brainOf } from '../tools/brain.ts';
import { json } from './export-api.ts';

/** Les sources de la mémoire d'un Odin : sa mémoire, son Cerveau, ses compétences, son masqueur. */
export function sourcesDOdin(odin: Pick<Odin, 'muninn' | 'skills' | 'redactor' | 'paths' | 'cfg'>): SourcesMemoire {
  return { mu: odin.muninn, cerveau: brainOf({ home: odin.paths.home, careCfg: odin.cfg, workspace: odin.paths.workspace }), competences: odin.skills, masquer: (t) => odin.redactor.redact(t) };
}

export interface DepsExportMemoire {
  /** La personne connectée sur ce navigateur (propriétaire ou membre), undefined sinon. */
  qui(): { proprio: true } | { login: string } | undefined;
  /** L'appli du port direct par lequel la requête arrive. */
  direct?: string;
  /** Les sources de la mémoire (lues seulement une fois la demande acceptée). */
  sources(): SourcesMemoire;
}

export async function exportMemoireRoute(req: IncomingMessage, res: ServerResponse, url: URL, d: DepsExportMemoire): Promise<boolean> {
  if (url.pathname !== '/api/memoire/export') return false;
  if (req.method !== 'GET') { res.writeHead(405, { allow: 'GET', 'cache-control': 'no-store' }); res.end(); return true; }
  const qui = d.direct || req.headers.authorization ? undefined : d.qui();
  const refus = !qui || !('proprio' in qui) || req.headers['x-odin'] !== '1' || req.headers['sec-fetch-site'] === 'cross-site';
  if (refus) { json(res, 403, { ok: false, code: 'refuse', error: 'L\'export de la mémoire se fait par le propriétaire, depuis l\'interface d\'Odin.' }); return true; }
  const jour = new Date().toISOString().slice(0, 10);
  res.writeHead(200, { 'content-type': 'application/zip', 'content-disposition': `attachment; filename="memoire-odin-${jour}.zip"`, 'x-content-type-options': 'nosniff', 'content-security-policy': 'sandbox', 'cache-control': 'no-store' });
  // Le navigateur lit moins vite qu'Odin n'écrit : on attend qu'il ait pris le morceau précédent. S'il a coupé le
  // téléchargement (fermé, même avant l'attente), l'export s'arrête au lieu d'attendre pour toujours ; chaque attente
  // retire ses deux écouteurs dès que l'un d'eux répond (aucun ne s'accumule).
  let parti = false; res.once('close', () => { parti = true; });
  const coupe = () => new Error('le navigateur a coupé le téléchargement');
  const ecrire = (b: Buffer): void | Promise<void> => {
    if (parti || res.destroyed) throw coupe();
    if (res.write(b)) return;
    return new Promise<void>((ok, ko) => {
      const fin = () => { res.off('drain', fin); res.off('close', fin); if (parti || res.destroyed) ko(coupe()); else ok(); };
      res.on('drain', fin); res.on('close', fin);
    });
  };
  try { await exporterMemoire(d.sources(), ecrire); res.end(); }
  catch (e) { if (!parti) console.error('[mémoire] export interrompu :', (e as Error).message); res.destroy(); } // jamais une archive abîmée rendue comme bonne
  return true;
}
