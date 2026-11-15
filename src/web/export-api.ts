// Export de la page d'une appli · l'adresse web.
//   GET /api/valhalla/export?id=<appli>&format=docx|pdf|md|json
// Mêmes réglages que la page (`poste`, période…), et `onglet=<nom>` pour n'exporter qu'un onglet. La session du
// propriétaire (ou la clé d'API) est exigée. Le fichier part toujours comme un téléchargement, avec les mêmes
// protections que les fichiers remis par les applis (`/api/valhalla/fichier`) : jamais une page affichée par Odin.
// Nom du fichier : « <Nom de l'appli> - <date>.<ext> ».
//
// Google Docs (format=gdocs, avec l'en-tête x-odin) : la page devient un document dans le Drive du propriétaire,
// la réponse est { ok, lien, nom }. La connexion Google (voir src/valhalla/export/google.ts) :
//   GET  /api/valhalla/export/google/etat        → client enregistré ? relié ? code en attente ?
//   POST /api/valhalla/export/google/client      { id, secret } → rangés dans le coffre
//   POST /api/valhalla/export/google/connexion   → { code, adresse } : le code à saisir chez Google
//   POST /api/valhalla/export/google/deconnexion → jeton révoqué chez Google, puis oublié
// Aucun secret ne revient jamais dans une réponse.

import type { IncomingMessage, ServerResponse } from 'node:http';
import { resolve } from 'node:path';
import { odinPaths } from '../config.ts';
import { googleDe } from '../valhalla/export/google.ts';
import { FORMATS, GOOGLE_ABSENT, estFormat, estGoogle, fichier } from '../valhalla/export/fichier.ts';
import { prendre } from '../valhalla/export/page.ts';
import { valhallaOf } from '../valhalla/odin.ts';

export function json(res: ServerResponse, code: number, corps: unknown): void {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  res.end(JSON.stringify(corps));
}

/** L'export en fichier (la connexion a déjà été vérifiée). Rend false si l'adresse n'est pas la sienne. `connus` : le masqueur d'Odin. */
export async function exportApi(req: IncomingMessage, res: ServerResponse, url: URL, o: { connus?: (t: string) => string }): Promise<boolean> {
  if (url.pathname.startsWith('/api/valhalla/export/google/')) return googleApi(req, res, url);
  if (url.pathname !== '/api/valhalla/export') return false;
  if (req.method !== 'GET') { res.writeHead(405, { allow: 'GET', 'cache-control': 'no-store' }); res.end(); return true; }
  const va = valhallaOf();
  if (!va) { json(res, 503, { ok: false, error: 'Les applis d\'Odin ne sont pas démarrées.' }); return true; }
  const q = url.searchParams, format = String(q.get('format') ?? '').toLowerCase();
  if (estGoogle(format)) {
    const g = googleDe(homeDe());
    if (!g.connecte()) { json(res, 409, { ok: false, error: g.etat().coffre ?? GOOGLE_ABSENT, manque: 'google' }); return true; }
    // Une action qui crée un document chez Google : seulement depuis l'interface d'Odin (en-tête x-odin).
    if (req.headers['x-odin'] !== '1') { json(res, 403, { ok: false, error: 'en-tête x-odin manquant' }); return true; }
    const r = await prendre(va, String(q.get('id') ?? ''), q, { connus: o.connus });
    if (!r.ok) { json(res, r.code === 'inconnue' ? 404 : r.code === 'refus' ? 403 : r.code === 'onglet' ? 400 : 500, { ok: false, error: r.error, ...(r.code === 'refus' ? { refus: true } : {}) }); return true; }
    try {
      const d = await g.creerDocument(r.page);
      va.ctx(r.module.id).emit('page_exportee', { format: 'Google Docs', ...(r.page.onglet ? { onglet: r.page.onglet } : {}) });
      json(res, 200, { ok: true, lien: d.lien, nom: d.nom });
    } catch (e) { json(res, 502, { ok: false, error: (e as Error).message }); }
    return true;
  }
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

/** Le dossier d'Odin (celui des applis quand elles tournent). */
function homeDe(): string { const va = valhallaOf(); return resolve(va ? va.ctx('forseti').home : odinPaths().home); }

async function corpsJson(req: IncomingMessage, max = 8 * 1024): Promise<Record<string, unknown>> {
  const parts: Buffer[] = []; let n = 0;
  for await (const c of req) { n += (c as Buffer).length; if (n > max) throw new Error('demande trop longue'); parts.push(c as Buffer); }
  try { const j = JSON.parse(Buffer.concat(parts).toString('utf8') || '{}'); return j && typeof j === 'object' ? j as Record<string, unknown> : {}; } catch { return {}; }
}

/** La connexion Google du propriétaire (la session a déjà été vérifiée). */
async function googleApi(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
  const g = googleDe(homeDe()), quoi = url.pathname.slice('/api/valhalla/export/google/'.length);
  if (quoi === 'etat') {
    if (req.method !== 'GET') { res.writeHead(405, { allow: 'GET', 'cache-control': 'no-store' }); res.end(); return true; }
    json(res, 200, { ok: true, ...g.etat() }); return true;
  }
  if (!['client', 'connexion', 'deconnexion'].includes(quoi)) { json(res, 404, { ok: false, error: 'introuvable' }); return true; }
  if (req.method !== 'POST') { res.writeHead(405, { allow: 'POST', 'cache-control': 'no-store' }); res.end(); return true; }
  if (req.headers['x-odin'] !== '1') { json(res, 403, { ok: false, error: 'en-tête x-odin manquant' }); return true; }
  try {
    if (quoi === 'client') {
      const b = await corpsJson(req);
      g.enregistrerClient(String(b.id ?? ''), String(b.secret ?? ''));
      json(res, 200, { ok: true, text: 'Client Google enregistré dans le coffre. Clique sur « Se connecter avec un code ».', ...g.etat() }); return true;
    }
    if (quoi === 'connexion') { const c = await g.demarrer(); json(res, 200, { ok: true, ...c, text: `Ouvre ${c.adresse} et saisis le code ${c.code}.` }); return true; }
    const d = await g.deconnecter();
    json(res, 200, { ok: true, text: d.revoque ? 'Compte Google délié : l\'accès est révoqué chez Google.' : 'Compte Google délié dans Odin (Google n\'a pas confirmé la révocation : retire l\'accès sur myaccount.google.com → Sécurité si besoin).', ...g.etat() });
  } catch (e) { json(res, 200, { ok: false, error: (e as Error).message }); }
  return true;
}
