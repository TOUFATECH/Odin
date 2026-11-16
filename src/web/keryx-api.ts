// L'API de la page Kéryx : /api/keryx/* (état, réglages, code secret, historique, essayer). Calquée sur maison-api.ts.
// Réservée au propriétaire (session Odin ou clé d'API, même garde que le reste). Le code secret n'arrive EN CLAIR qu'ici
// (POST secret) et n'est jamais relu ni renvoyé : seule son empreinte scrypt est gardée.

import type { IncomingMessage, ServerResponse } from 'node:http';
import { effacerSecret, poserSecret, secretPose } from '../valhalla/keryx/auth.ts';
import { lireReglages, ecrireReglages } from '../valhalla/keryx/reglages.ts';
import { configurerTrace, effacer, lire } from '../valhalla/keryx/trace.ts';
import { fauxModem, fauxSip } from '../valhalla/keryx/faux.ts';
import { type EtatKeryx, type ReglagesKeryx } from '../valhalla/keryx/types.ts';

export interface KeryxDeps {
  home: string;
  authed: boolean;
  fail: () => void;
  /** Ce que l'API ne peut pas savoir seule (canaux réellement actifs, mail et agenda branchés). */
  etatSup?: () => { canauxActifs: string[]; mailBranche: boolean; agendaBranche: boolean };
}

const json = (res: ServerResponse, code: number, b: unknown): void => { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }); res.end(JSON.stringify(b)); };

async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const parts: Buffer[] = []; let n = 0;
  for await (const c of req) { n += (c as Buffer).length; if (n > 65_536) throw new Error('trop long'); parts.push(c as Buffer); }
  try { const j = JSON.parse(Buffer.concat(parts).toString('utf8') || '{}') as unknown; return j && typeof j === 'object' ? j as Record<string, unknown> : {}; } catch { return {}; }
}

function etatDe(d: KeryxDeps, r: ReglagesKeryx): EtatKeryx {
  const sup = d.etatSup?.() ?? { canauxActifs: [], mailBranche: false, agendaBranche: false };
  return {
    ligne: r.ligne,
    canauxActifs: sup.canauxActifs,
    mailBranche: sup.mailBranche,
    agendaBranche: sup.agendaBranche,
    viePrivee: { captureEcran: false, pistageLieu: false },
    telephonieEssayee: false,
  };
}

/** Traite une requête /api/keryx/* ; rend true si c'est le cas. */
export async function keryxRoute(req: IncomingMessage, res: ServerResponse, url: URL, d: KeryxDeps): Promise<boolean> {
  const p = url.pathname;
  if (!p.startsWith('/api/keryx/')) return false;
  if (!d.authed) { d.fail(); json(res, 401, { ok: false, error: 'connexion requise' }); return true; }
  // En-tête x-odin obligatoire sur toute écriture (défense de profondeur contre les requêtes intersites), comme les
  // routes sœurs (maison-api, plume-api). POST /secret et POST /historique/effacer sont ainsi protégés.
  if (req.method !== 'GET' && req.headers['x-odin'] !== '1') { json(res, 403, { ok: false, error: 'en-tête x-odin manquant' }); return true; }
  configurerTrace(d.home);
  const s = (v: unknown): string => String(v ?? '');

  // Lectures
  if (req.method === 'GET' && p === '/api/keryx/etat') { json(res, 200, etatDe(d, lireReglages(d.home))); return true; }
  if (req.method === 'GET' && p === '/api/keryx/reglages') { json(res, 200, lireReglages(d.home)); return true; }
  if (req.method === 'GET' && p === '/api/keryx/historique') {
    const avant = s(url.searchParams.get('avant')) || undefined, n = Math.min(Number(url.searchParams.get('n')) || 50, 200);
    const entrees = await lire({ avant, n });
    json(res, 200, { entrees, ...(entrees.length === n ? { suite: entrees[entrees.length - 1].quand } : {}) });
    return true;
  }

  // Écritures
  if (req.method === 'PUT' && p === '/api/keryx/reglages') {
    let b: Record<string, unknown>; try { b = await readBody(req); } catch { json(res, 413, { ok: false, error: 'trop long' }); return true; }
    json(res, 200, ecrireReglages(d.home, b as Partial<ReglagesKeryx>));
    return true;
  }
  if (p === '/api/keryx/secret') {
    if (req.method === 'POST') {
      let b: Record<string, unknown>; try { b = await readBody(req); } catch { json(res, 413, { ok: false, error: 'trop long' }); return true; }
      const code = s(b.code);
      try { poserSecret(d.home, code); json(res, 200, { pose: true }); } catch (e) { json(res, 400, { ok: false, error: (e as Error).message }); }
      return true;
    }
    if (req.method === 'DELETE') { effacerSecret(d.home); json(res, 200, { pose: false }); return true; }
  }
  if (req.method === 'GET' && p === '/api/keryx/secret') { json(res, 200, { pose: secretPose(d.home) }); return true; }
  if (req.method === 'POST' && p === '/api/keryx/historique/effacer') {
    let b: Record<string, unknown>; try { b = await readBody(req); } catch { json(res, 413, { ok: false, error: 'trop long' }); return true; }
    const efface = await effacer({ id: b.id ? s(b.id) : undefined, tout: b.tout === true });
    json(res, 200, { efface });
    return true;
  }
  if (req.method === 'POST' && p === '/api/keryx/essayer') {
    let b: Record<string, unknown>; try { b = await readBody(req); } catch { json(res, 413, { ok: false, error: 'trop long' }); return true; }
    const quoi = s(b.quoi);
    if (quoi !== 'sip' && quoi !== 'modem') { json(res, 400, { ok: false, error: 'quoi doit valoir « sip » ou « modem »' }); return true; }
    json(res, 200, quoi === 'sip' ? await fauxSip() : await fauxModem());
    return true;
  }
  json(res, 404, { ok: false, error: 'introuvable' });
  return true;
}
