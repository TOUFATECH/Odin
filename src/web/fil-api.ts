// GET /api/fil : le fil de la personne connectée, lu par pages (lecture seule). Le serveur décide à qui est le fil
// d'après la session ouverte sur ce navigateur ; aucun paramètre de la page ne choisit la personne ni la conversation.
// Le propriétaire (sa session) lit ses conversations de la Discussion ; un membre la sienne seulement (aujourd'hui la
// garde des membres lui ferme encore cette adresse) ; la clé d'API, une tablette, une visite : rien.
// Paramètres : n (1 à 200, 100 par défaut), avant (le curseur rendu par la page précédente, `suite`).
// Chaque refus porte un `code` stable (refuse, invalide, curseur) : la page le dit dans la langue de la personne.

import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Mnemosyne } from '../muninn/store.ts';
import { assembler, lirePage, PAGE_DEFAUT, PAGE_MAX, sessionsDuFil, type ElementFil, type QuiFil, type SessionFil } from '../muninn/fil.ts';
import { json } from './export-api.ts';

type Memoire = Pick<Mnemosyne, 'listSessions' | 'allMessages' | 'kvPrefix'>;
export interface DepsFil {
  /** La personne connectée sur ce navigateur (propriétaire ou membre), undefined sinon. */
  qui(): QuiFil | undefined;
  /** L'appli du port direct par lequel la requête arrive (le fil n'est lu que sur l'interface d'Odin). */
  direct?: string;
  mu: Memoire;
}

/** Le fil de cette personne, une page (fonction sans serveur, pour l'essai et pour la route). */
export function filDe(mu: Memoire, qui: QuiFil, o: { n?: number; avant?: string }): { elements: ElementFil[]; suite: string | null } {
  const toutes: SessionFil[] = mu.listSessions(Number.MAX_SAFE_INTEGER).map((s) => ({ id: s.id, channel: s.channel, title: s.title }));
  const ids = new Set(sessionsDuFil(qui, toutes));
  // Le titre d'une conversation de la Discussion : celui que le propriétaire lui a donné, sinon le sien.
  const titres = 'proprio' in qui ? mu.kvPrefix('title:') : {};
  const siennes = toutes.filter((s) => ids.has(s.id)).map((s) => ({ ...s, title: (s.id.startsWith('web:') ? titres[s.id.slice(4)] : '') || s.title || '' }));
  return lirePage(assembler(siennes, (id) => mu.allMessages(id)), o);
}

export async function filRoute(req: IncomingMessage, res: ServerResponse, url: URL, d: DepsFil): Promise<boolean> {
  if (url.pathname !== '/api/fil') return false;
  if (req.method !== 'GET') { res.writeHead(405, { allow: 'GET', 'cache-control': 'no-store' }); res.end(); return true; }
  const qui = d.direct ? undefined : d.qui();
  if (!qui) { json(res, 403, { ok: false, code: 'refuse', error: 'Le fil se lit depuis l\'interface d\'Odin, avec ta session.' }); return true; }
  const q = url.searchParams, brut = q.get('n'), avant = q.get('avant') ?? undefined;
  const n = brut === null ? PAGE_DEFAUT : Number(brut);
  if (!Number.isInteger(n) || n < 1 || n > PAGE_MAX) { json(res, 400, { ok: false, code: 'invalide', error: `n : un nombre entier de 1 à ${PAGE_MAX}.` }); return true; }
  try { json(res, 200, { ok: true, ...filDe(d.mu, qui, { n, avant }) }); }
  catch (e) { if (!/curseur/.test((e as Error).message)) throw e; json(res, 400, { ok: false, code: 'curseur', error: 'Curseur « avant » illisible.' }); }
  return true;
}
