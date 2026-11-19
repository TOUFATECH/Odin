// GET /api/fil : le fil de la personne connectée, lu par pages (lecture seule). Le serveur décide à qui est le fil
// d'après la session ouverte sur ce navigateur ; aucun paramètre de la page ne choisit la personne ni la conversation.
// Le propriétaire (sa session) lit ses conversations de la Discussion ; un membre la sienne seulement (aujourd'hui la
// garde des membres lui ferme encore cette adresse) ; la clé d'API, une tablette, une visite : rien.
// Paramètres : n (1 à 200, 100 par défaut), avant (le curseur rendu par la page précédente, `suite`), tout=1 (lire
// aussi ce que « Masquer » cache : l'Historique qui saute à un jour ; la marque n'est pas retirée).
// La réponse dit `masque` : le fil est masqué (la page propose « Réafficher l'historique »).
// Chaque refus porte un `code` stable (refuse, invalide, curseur) : la page le dit dans la langue de la personne.

import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Mnemosyne } from '../muninn/store.ts';
import { apresMasque, assembler, cleMasque, lirePage, masquerFil, PAGE_DEFAUT, PAGE_MAX, reafficherFil, sessionsDuFil, type ElementFil, type MemoireMasque, type QuiFil, type SessionFil } from '../muninn/fil.ts';
import { json } from './export-api.ts';

type Memoire = Pick<Mnemosyne, 'listSessions' | 'allMessages' | 'kvPrefix' | 'getKv'>;
export interface DepsFil {
  /** La personne connectée sur ce navigateur (propriétaire ou membre), undefined sinon. */
  qui(): QuiFil | undefined;
  /** L'appli du port direct par lequel la requête arrive (le fil n'est lu que sur l'interface d'Odin). */
  direct?: string;
  mu: Memoire;
}

/** Le fil de cette personne, une page (fonction sans serveur, pour l'essai et pour la route). */
export function filDe(mu: Memoire, qui: QuiFil, o: { n?: number; avant?: string; tout?: boolean }): { elements: ElementFil[]; suite: string | null; masque: boolean } {
  const toutes: SessionFil[] = mu.listSessions(Number.MAX_SAFE_INTEGER).map((s) => ({ id: s.id, channel: s.channel, title: s.title, ...(s.tainted === 1 ? { marquee: true } : {}) }));
  const ids = new Set(sessionsDuFil(qui, toutes, { ecrans: true }));
  // Masqué : seulement ce qui est arrivé après « Masquer », sauf quand la page demande tout (rien n'est effacé).
  const cle = cleMasque(qui), masque = cle ? mu.getKv(cle) : undefined, cache = masque && !o.tout ? masque : '';
  const lus = new Map<string, ReturnType<Memoire['allMessages']>>();
  const messages = (id: string) => { let l = lus.get(id); if (!l) lus.set(id, l = mu.allMessages(id)); return l; };
  // La marque « contenu non fiable » d'une conversation (le ⚠ de l'ancienne liste) passe au séparateur : celle de la
  // session (pour la suite : « Masquer » la remet à zéro), ou celle d'un de ses messages montrés (jamais remise à zéro :
  // ce qui a déjà été lu garde son ⚠ dans l'historique).
  const marquee = (id: string) => (cache ? apresMasque(messages(id).map((m) => ({ m, date: m.created_at, id: m.id })), cache).map((x) => x.m) : messages(id)).some((m) => m.tainted === 1);
  // Le titre d'une conversation de la Discussion : celui que le propriétaire lui a donné, sinon le sien.
  const titres = 'proprio' in qui ? mu.kvPrefix('title:') : {};
  const siennes = toutes.filter((s) => ids.has(s.id)).map((s) => ({ ...s, title: (s.id.startsWith('web:') ? titres[s.id.slice(4)] : '') || s.title || '', ...(s.marquee || marquee(s.id) ? { marquee: true } : {}) }));
  const bulles = assembler(siennes, messages);
  return { ...lirePage(cache ? apresMasque(bulles, cache) : bulles, o), masque: Boolean(masque) };
}

/**
 * Les actions « fil_masquer » et « fil_reafficher » (POST /api/action) : chacun pour son fil, la personne étant celle de
 * la session ouverte sur ce navigateur (jamais un paramètre de la page) ; la clé d'API ou le port direct d'une appli :
 * refusé. undefined : ce n'est pas une de ces actions.
 */
export function filAction(kind: unknown, qui: QuiFil | undefined, mu: MemoireMasque): { ok: boolean; code?: string; error?: string } | undefined {
  if (kind !== 'fil_masquer' && kind !== 'fil_reafficher') return undefined;
  if (!qui) return { ok: false, code: 'refuse', error: 'Le fil se masque depuis l\'interface d\'Odin, avec ta session.' };
  return (kind === 'fil_masquer' ? masquerFil(mu, qui) : reafficherFil(mu, qui)) ? { ok: true } : { ok: false, code: 'refuse', error: 'Pas de conversation à masquer.' };
}

export async function filRoute(req: IncomingMessage, res: ServerResponse, url: URL, d: DepsFil): Promise<boolean> {
  if (url.pathname !== '/api/fil') return false;
  if (req.method !== 'GET') { res.writeHead(405, { allow: 'GET', 'cache-control': 'no-store' }); res.end(); return true; }
  const qui = d.direct ? undefined : d.qui();
  if (!qui) { json(res, 403, { ok: false, code: 'refuse', error: 'Le fil se lit depuis l\'interface d\'Odin, avec ta session.' }); return true; }
  const q = url.searchParams, brut = q.get('n'), avant = q.get('avant') ?? undefined;
  const n = brut === null ? PAGE_DEFAUT : Number(brut);
  if (!Number.isInteger(n) || n < 1 || n > PAGE_MAX) { json(res, 400, { ok: false, code: 'invalide', error: `n : un nombre entier de 1 à ${PAGE_MAX}.` }); return true; }
  try { json(res, 200, { ok: true, ...filDe(d.mu, qui, { n, avant, tout: q.get('tout') === '1' }) }); }
  catch (e) { if (!/curseur/.test((e as Error).message)) throw e; json(res, 400, { ok: false, code: 'curseur', error: 'Curseur « avant » illisible.' }); }
  return true;
}
