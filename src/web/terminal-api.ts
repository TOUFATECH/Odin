// Les routes des terminaux de Dédale (session du propriétaire seulement : le serveur a déjà vérifié la connexion, et
// la garde de la connexion unique ferme ces routes à toute autre personne) :
//   GET  /api/terminal/lire?id=…&depuis=…&attendre=1   ce qui est sorti depuis un octet donné (attente jusqu'à 20 s)
//   POST /api/terminal/ecrire { id, data }             ce qui est tapé (Heimdall regarde chaque ligne)
//   POST /api/terminal/taille { id, cols, rows }       la taille de l'écran
//   *    /api/terminal/apercu/<id>/…                   l'aperçu web d'un projet lancé, à travers Odin
// L'aperçu est servi avec « Content-Security-Policy: sandbox » : la page du projet tourne dans une origine à part et
// ne peut ni lire les cookies d'Odin ni appeler ses routes.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { request } from 'node:http';
import { ecrire, lire, taille, trouver } from '../valhalla/ivaldi/terminaux.ts';
import { apercus } from '../valhalla/ivaldi/projets.ts';

const json = (res: ServerResponse, code: number, b: unknown) => { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(b)); };
async function corps(req: IncomingMessage, max = 256 * 1024): Promise<Record<string, unknown> | undefined> {
  const parts: Buffer[] = []; let n = 0;
  for await (const c of req) { n += (c as Buffer).length; if (n > max) return undefined; parts.push(c as Buffer); }
  try { const o = JSON.parse(Buffer.concat(parts).toString('utf8') || '{}') as unknown; return o && typeof o === 'object' ? o as Record<string, unknown> : {}; } catch { return undefined; }
}

export async function terminalApi(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
  const p = url.pathname; if (!p.startsWith('/api/terminal/')) return false;
  const ap = /^\/api\/terminal\/apercu\/(s[0-9a-f]{8})(\/.*)?$/.exec(p);
  if (ap) {
    const port = apercus.get(ap[1]), x = trouver(ap[1]);
    if (!port || !x || x.ferme) { res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }); res.end('Ce projet ne tourne plus : relance-le depuis Dédale.'); return true; }
    if (!ap[2]) { res.writeHead(302, { location: `${p}/` }); res.end(); return true; }
    const h: Record<string, string | string[] | undefined> = { ...req.headers, host: `127.0.0.1:${port}` };
    delete h.cookie; delete h.authorization; delete h['x-odin'];
    const amont = request({ host: '127.0.0.1', port, method: req.method, path: `${ap[2]}${url.search}`, headers: h }, (r) => {
      const out: Record<string, string | string[] | number | undefined> = { ...r.headers, 'content-security-policy': 'sandbox allow-scripts allow-forms allow-modals allow-popups', 'x-content-type-options': 'nosniff', 'cache-control': 'no-store' };
      delete out['set-cookie'];
      if (typeof r.headers.location === 'string' && r.headers.location.startsWith('/')) out.location = `/api/terminal/apercu/${ap[1]}${r.headers.location}`;
      res.writeHead(r.statusCode ?? 502, out as Record<string, string>); r.pipe(res);
    });
    amont.on('error', () => { if (!res.headersSent) { res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' }); res.end('Le projet ne répond pas (encore) : regarde son terminal dans Dédale.'); } });
    req.pipe(amont);
    return true;
  }
  if (req.method === 'GET' && p === '/api/terminal/lire') {
    const id = url.searchParams.get('id') ?? '', depuis = Number(url.searchParams.get('depuis') ?? 0) || 0;
    const r = await lire(id, depuis, url.searchParams.get('attendre') === '1' ? 20_000 : 0);
    if (!r) return json(res, 404, { ok: false, error: 'Ce terminal n\'existe plus.' }), true;
    json(res, 200, { ok: true, debut: r.debut, fin: r.fin, data: r.data.toString('base64'), reprise: r.reprise, ...(r.ferme ? { ferme: r.ferme } : {}) }); return true;
  }
  if (req.method === 'POST' && (p === '/api/terminal/ecrire' || p === '/api/terminal/taille')) {
    if (req.headers['x-odin'] !== '1') return json(res, 403, { ok: false, error: 'en-tête x-odin manquant' }), true;
    const b = await corps(req); if (!b) return json(res, 400, { ok: false, error: 'demande illisible ou trop longue' }), true;
    const id = typeof b.id === 'string' ? b.id : '';
    if (p.endsWith('taille')) return json(res, 200, { ok: taille(id, Number(b.cols), Number(b.rows)) }), true;
    const r = ecrire(id, typeof b.data === 'string' ? b.data.slice(0, 64 * 1024) : '');
    json(res, r.ok ? 200 : 404, r); return true;
  }
  json(res, 404, { ok: false, error: 'inconnu' }); return true;
}
