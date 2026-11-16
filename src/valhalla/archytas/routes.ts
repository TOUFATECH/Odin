// Les routes /api/archytas/* : la fenêtre Script parle au moteur. Tout est PRIVÉ (scripts et historique sont
// des données privées) : connexion exigée, propriétaire seul pour éditer/supprimer/améliorer/lancer, et le
// CODE (détail d'un script) n'est servi qu'au propriétaire. En-tête x-odin obligatoire sur chaque POST.

import type { IncomingMessage, ServerResponse } from 'node:http';
import { moteurPour } from './module.ts';
import type { Declencheur, EntreeScript, Etape } from './scripts.ts';

export interface DepsArchytasRoutes { /** la requête vient-elle du propriétaire (session ou clé d'API) ? */ proprietaire(): boolean; /** dossier d'Odin */ home: string; /** un essai raté */ fail(): void }

function json(res: ServerResponse, code: number, body: unknown): void {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  res.end(JSON.stringify(body));
}
async function corps(req: IncomingMessage): Promise<Record<string, unknown> | undefined> {
  const parts: Buffer[] = []; let n = 0;
  for await (const c of req) { n += (c as Buffer).length; if (n > 256 * 1024) return undefined; parts.push(c as Buffer); }
  try { const j = JSON.parse(Buffer.concat(parts).toString('utf8') || '{}') as unknown; return j && typeof j === 'object' && !Array.isArray(j) ? j as Record<string, unknown> : undefined; } catch { return undefined; }
}
const s = (v: unknown): string => (v === undefined || v === null ? '' : String(v));

/** Nettoie une entrée de script venue du réseau (données non fiables : on ne garde que les formes connues). */
function entreeScript(b: Record<string, unknown>): EntreeScript {
  const genre = b.genre === 'code' ? 'code' : 'declaratif';
  const declencheurs = Array.isArray(b.declencheurs) ? (b.declencheurs as Declencheur[]) : [{ genre: 'manuel' as const }];
  return {
    nom: s(b.nom), mission: s(b.mission), description: s(b.description), genre,
    etapes: genre === 'declaratif' && Array.isArray(b.etapes) ? (b.etapes as Etape[]) : genre === 'declaratif' ? [] : undefined,
    code: genre === 'code' ? s(b.code) : undefined,
    declencheurs: declencheurs.length ? declencheurs : [{ genre: 'manuel' }],
  };
}

/** GET et POST /api/archytas/*. Rend true si la requête est servie ici. */
export async function archytasRoute(req: IncomingMessage, res: ServerResponse, url: URL, d: DepsArchytasRoutes): Promise<boolean> {
  if (!url.pathname.startsWith('/api/archytas/')) return false;
  const meth = req.method ?? 'GET';
  // Tout est privé : propriétaire seul (le code ne sort jamais à quelqu'un d'autre).
  if (!d.proprietaire()) { d.fail(); json(res, 401, { ok: false, error: 'Connecte-toi à Odin (scripts privés).' }); return true; }
  if (meth === 'POST' && req.headers['x-odin'] !== '1') { json(res, 403, { ok: false, error: 'En-tête x-odin manquant.' }); return true; }
  const m = moteurPour(d.home);
  const route = url.pathname.slice('/api/archytas/'.length);
  try {
    if (meth === 'GET') {
      switch (route) {
        case 'scripts': return void json(res, 200, { scripts: await m.lister() }), true;
        case 'script': { const x = await m.voir(s(url.searchParams.get('nom'))); return x ? void json(res, 200, x) : void json(res, 404, { ok: false, error: 'Script introuvable.' }), true; }
        case 'versions': return void json(res, 200, { versions: await m.versions(s(url.searchParams.get('nom'))) }), true;
        case 'amelioration': { const p = await m.proposerAmelioration(s(url.searchParams.get('nom'))); return void json(res, 200, p ?? {}), true; }
        case 'graphe': return void json(res, 200, await m.graphe()), true;
        case 'suivi': return void json(res, 200, await m.suivi()), true;
        default: return void json(res, 404, { ok: false, error: 'Route Archytas inconnue.' }), true;
      }
    }
    if (meth === 'POST') {
      const b = await corps(req); if (!b) { json(res, 400, { ok: false, error: 'Corps JSON attendu.' }); return true; }
      switch (route) {
        case 'creer': return void json(res, 200, await m.creer(entreeScript(b))), true;
        case 'editer': return void json(res, 200, await m.editer(s(b.nom), (b.patch && typeof b.patch === 'object' ? b.patch : b) as Partial<EntreeScript>)), true;
        case 'supprimer': return await m.supprimer(s(b.nom)), void json(res, 200, { ok: true }), true;
        case 'lancer': return void json(res, 200, await m.lancer(s(b.nom), (b.entree && typeof b.entree === 'object' ? b.entree : {}) as Record<string, unknown>)), true;
        case 'revenir': return void json(res, 200, await m.revenir(s(b.nom), Number(b.version))), true;
        case 'amelioration': return void json(res, 200, await m.appliquerAmelioration(s(b.nom), b.accord !== false)), true;
        default: return void json(res, 404, { ok: false, error: 'Route Archytas inconnue.' }), true;
      }
    }
    json(res, 405, { ok: false, error: 'GET ou POST.' }); return true;
  } catch (e) {
    json(res, 400, { ok: false, error: (e as Error).message }); return true;
  }
}
