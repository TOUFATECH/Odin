// Phénix · la porte des agents de sauvegarde (PC du foyer) : /api/sindri/agent/…, avec le jeton de l'agent
// (« Authorization: Bearer … »), sans session. Seulement depuis le réseau de la maison.
//
//   POST debut                 → { session, sorte, restauration? }
//   POST manque?session=       { sha: [...] } → { manque: [...] }
//   POST morceau?session=      corps = le morceau (1 Mo au plus), en-tête x-sha256
//   POST fin?session=          { fichiers, present, racines, vss, sautes, ouverts } → { instantane }
//   GET  restauration?tache=   → { vers, fichiers: [{ path, size, mtime, mode, morceaux: [{ id, sha }] }] }
//   GET  morceau?tache=&id=    → le morceau (déchiffré)
//   POST restauration?tache=   { fait, erreurs } (fin de la restauration)
// Jeton inconnu : 401 et un essai raté compté (même limite que les autres jetons d'Odin).

import type { IncomingMessage, ServerResponse } from 'node:http';
import { agentDuJeton, debut, fichiersRestauration, fin, finRestauration, manque, morceau, morceauRestauration, RefusAgent } from '../valhalla/sindri/agent.ts';
import { valhallaOf } from '../valhalla/odin.ts';
import { adresseMaison } from './capsule-api.ts';

const json = (res: ServerResponse, code: number, corps: unknown) => { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }); res.end(JSON.stringify(corps)); };
async function lire(req: IncomingMessage, max: number): Promise<Buffer | undefined> {
  const parts: Buffer[] = []; let n = 0;
  for await (const c of req) { n += (c as Buffer).length; if (n > max) return undefined; parts.push(c as Buffer); }
  return Buffer.concat(parts);
}
async function lireJson(req: IncomingMessage, max: number): Promise<Record<string, unknown>> {
  const b = await lire(req, max); if (!b) throw new RefusAgent(413, 'envoi trop gros');
  try { const j = JSON.parse(b.toString('utf8') || '{}') as unknown; return j && typeof j === 'object' && !Array.isArray(j) ? j as Record<string, unknown> : {}; } catch { throw new RefusAgent(400, 'JSON illisible'); }
}

export interface OptionsAgent { ip: string; home: string; echec: () => void }

export async function agentRoute(req: IncomingMessage, res: ServerResponse, url: URL, o: OptionsAgent): Promise<boolean> {
  if (!url.pathname.startsWith('/api/sindri/agent/')) return false;
  const quoi = url.pathname.slice('/api/sindri/agent/'.length);
  const jeton = /^Bearer\s+([a-f0-9]{64})$/i.exec(String(req.headers.authorization ?? ''))?.[1]?.toLowerCase() ?? '';
  const a = jeton ? agentDuJeton(o.home, jeton) : undefined;
  if (!a) { o.echec(); json(res, 401, { ok: false, error: 'agent inconnu : réinstalle-le depuis Satellites' }); return true; }
  if (!adresseMaison(o.ip)) { json(res, 403, { ok: false, error: 'les sauvegardes des PC ne passent que par le réseau de la maison' }); return true; }
  const va = valhallaOf(); if (!va) { json(res, 503, { ok: false, error: 'applis non démarrées' }); return true; }
  const ctx = va.ctx('sindri'), session = url.searchParams.get('session') ?? '', tache = url.searchParams.get('tache') ?? '';
  try {
    if (req.method === 'POST' && quoi === 'debut') return json(res, 200, { ok: true, ...(await debut(ctx, a, await lireJson(req, 64 * 1024))) }), true;
    if (req.method === 'POST' && quoi === 'manque') return json(res, 200, { ok: true, manque: await manque(ctx, a, session, (await lireJson(req, 2 * 1024 * 1024)).sha) }), true;
    if (req.method === 'POST' && quoi === 'morceau') {
      const b = await lire(req, 1024 * 1024); if (!b) throw new RefusAgent(413, 'morceau trop gros (1 Mo au plus)');
      await morceau(ctx, a, session, String(req.headers['x-sha256'] ?? '').toLowerCase(), b); return json(res, 200, { ok: true }), true;
    }
    if (req.method === 'POST' && quoi === 'fin') return json(res, 200, { ok: true, ...(await fin(ctx, a, session, await lireJson(req, 256 * 1024 * 1024))) }), true;
    if (req.method === 'GET' && quoi === 'restauration') return json(res, 200, { ok: true, ...(await fichiersRestauration(ctx, a, tache)) }), true;
    if (req.method === 'POST' && quoi === 'restauration') { finRestauration(ctx, a, tache, await lireJson(req, 1024 * 1024)); return json(res, 200, { ok: true }), true; }
    if (req.method === 'GET' && quoi === 'morceau') {
      const b = morceauRestauration(tache, url.searchParams.get('id') ?? '');
      res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': String(b.length), 'cache-control': 'no-store' }); res.end(b); return true;
    }
    json(res, 404, { ok: false, error: 'inconnu' });
  } catch (e) {
    const st = e instanceof RefusAgent ? e.status : 500;
    json(res, st, { ok: false, error: (e as Error).message.slice(0, 300) });
  }
  return true;
}
