// L'API de la page Métis : /api/metis/* — le catalogue des modèles ouverts téléchargés et leur vitesse MESURÉE, servis
// au propriétaire seul (ces informations sont privées). Même garde que le reste des routes propriétaire d'Odin.
//
// La page elle-même est produite par src/brain/metis/page.ts (un fragment HTML inséré dans OdinDialog côté interface) ;
// ici on ne fait que la servir et exposer un résumé JSON. Aucun service externe n'est contacté : Métis lit les modèles
// ouverts DANS Odin, sans serveur réglé par adresse.

import type { IncomingMessage, ServerResponse } from 'node:http';
import { listerModeles } from '../brain/metis/catalogue.ts';
import { capaciteMachine, tailleConseillee } from '../brain/metis/mesure.ts';
import { pageMetisHtml, resumeMetis } from '../brain/metis/page.ts';

export interface MetisDeps {
  home: string;
  authed: boolean;
  fail: () => void;
}

const json = (res: ServerResponse, code: number, b: unknown): void => { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }); res.end(JSON.stringify(b)); };

/** Traite une requête /api/metis/* ; rend true si c'est le cas. Propriétaire seul. */
export async function metisRoute(req: IncomingMessage, res: ServerResponse, url: URL, d: MetisDeps): Promise<boolean> {
  const p = url.pathname;
  if (!p.startsWith('/api/metis/')) return false;
  if (!d.authed) { d.fail(); json(res, 401, { ok: false, error: 'connexion requise' }); return true; }

  if (req.method === 'GET' && p === '/api/metis/page') {
    const modeles = await listerModeles(d.home).catch(() => []);
    const cap = await capaciteMachine().catch(() => undefined);
    const html = pageMetisHtml(modeles, cap, cap ? tailleConseillee(cap) : undefined);
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
    res.end(html);
    return true;
  }
  if (req.method === 'GET' && p === '/api/metis/etat') {
    const modeles = await listerModeles(d.home).catch(() => []);
    json(res, 200, { resume: resumeMetis(modeles), modeles });
    return true;
  }
  json(res, 404, { ok: false, error: 'introuvable' });
  return true;
}
