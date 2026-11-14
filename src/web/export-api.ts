// Export de la page d'une appli · l'adresse web.
//   GET /api/valhalla/export?id=<appli>&format=docx|pdf|md|json
// Mêmes réglages que la page (`poste`, période…), et `onglet=<nom>` pour n'exporter qu'un onglet. La session du
// propriétaire (ou la clé d'API) est exigée. Le fichier part toujours comme un téléchargement, avec les mêmes
// protections que les fichiers remis par les applis (`/api/valhalla/fichier`) : jamais une page affichée par Odin.
// Nom du fichier : « <Nom de l'appli> - <date>.<ext> ».

import type { IncomingMessage, ServerResponse } from 'node:http';
import { FORMATS, GOOGLE_ABSENT, estFormat, estGoogle, fichier } from '../valhalla/export/fichier.ts';
import { prendre } from '../valhalla/export/page.ts';
import { valhallaOf } from '../valhalla/odin.ts';

export function json(res: ServerResponse, code: number, corps: unknown): void {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  res.end(JSON.stringify(corps));
}

/** L'export en fichier (la connexion a déjà été vérifiée). Rend false si l'adresse n'est pas la sienne. `connus` : le masqueur d'Odin. */
export async function exportApi(req: IncomingMessage, res: ServerResponse, url: URL, o: { connus?: (t: string) => string }): Promise<boolean> {
  if (url.pathname !== '/api/valhalla/export') return false;
  if (req.method !== 'GET') { res.writeHead(405, { allow: 'GET', 'cache-control': 'no-store' }); res.end(); return true; }
  const va = valhallaOf();
  if (!va) { json(res, 503, { ok: false, error: 'Les applis d\'Odin ne sont pas démarrées.' }); return true; }
  const q = url.searchParams, format = String(q.get('format') ?? '').toLowerCase();
  if (estGoogle(format)) { json(res, 409, { ok: false, error: GOOGLE_ABSENT, manque: 'google' }); return true; }
  if (!estFormat(format)) { json(res, 400, { ok: false, error: 'Format inconnu : choisis Word (docx), PDF (pdf), Markdown (md) ou JSON (json).' }); return true; }
  const r = await prendre(va, String(q.get('id') ?? ''), q, { connus: o.connus });
  if (!r.ok) { json(res, r.code === 'inconnue' ? 404 : r.code === 'refus' ? 403 : r.code === 'onglet' ? 400 : 500, { ok: false, error: r.error, ...(r.code === 'refus' ? { refus: true } : {}) }); return true; }
  let f: { nom: string; data: Buffer };
  try { f = fichier(r.page, format); } catch (e) { json(res, 500, { ok: false, error: `Le fichier n'a pas pu être écrit : ${(e as Error).message}` }); return true; }
  // Le vrai nom (accents gardés) ; seuls les caractères qui casseraient l'en-tête sont remplacés.
  const nom = f.nom.replace(/[\u0000-\u001f\u007f"]/g, '_'), ascii = nom.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': String(f.data.length), 'content-disposition': `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(nom).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)}`, 'x-content-type-options': 'nosniff', 'content-security-policy': 'sandbox', 'cache-control': 'no-store' });
  res.end(f.data);
  // Une trace dans le journal des applis (le Cerveau) : quelle page est sortie, dans quel format.
  va.ctx(r.module.id).emit('page_exportee', { format: FORMATS.find((x) => x.id === format)?.nom ?? format, ...(r.page.onglet ? { onglet: r.page.onglet } : {}) });
  return true;
}
