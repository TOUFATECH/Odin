// Odin — fetch propre.
//
// Un fetch qui ne jette JAMAIS d'erreur brute (« fetch failed », « ENOTFOUND ») : il rend un
// résultat typé, classe la panne en un message français simple, alimente le registre des services
// (etat-internet.ts) et applique une attente croissante plafonnée entre les essais.
//
// Toute requête porte un délai maximal. Un flux (téléchargement, long-poll) porte en plus un délai
// d'INACTIVITÉ : si plus rien n'arrive pendant ce temps, on coupe au lieu d'attendre sans fin.

import { marquerService } from './etat-internet.ts';
import type { EtatService } from './etat-internet.ts';

export interface OptionsFetch {
  /** Délai maximal de la requête (ms). Défaut : 15 s. */
  timeoutMs?: number;
  /** Flux : délai sans aucun octet reçu avant de couper (ms). Si absent, pas de surveillance d'inactivité. */
  inactiviteMs?: number;
  /** Nom lisible de ce qu'on va chercher (pour le message : « La météo n'a pas pu… »). */
  label?: string;
  /** Hôte à marquer dans le registre (sinon déduit de l'URL). */
  hote?: string;
  /** Nombre d'essais en plus du premier (attente croissante entre eux). Défaut : 0. */
  essais?: number;
  /** Options passées à fetch (méthode, en-têtes, corps…). */
  init?: RequestInit;
  /** fetch à utiliser (injectable pour les essais). */
  fetch?: typeof fetch;
  /** Horloge, injectable pour les essais. */
  sleep?: (ms: number) => Promise<void>;
}

export interface ResultatFetch {
  ok: boolean;
  /** Code HTTP si une réponse est arrivée. */
  statut?: number;
  /** Corps texte (lu proprement) si demandé par le code appelant via .texte(). */
  reponse?: Response;
  /** Message français clair en cas d'échec (jamais une erreur brute). */
  erreur?: string;
  /** Classement du service pour le registre. */
  etatService?: EtatService;
}

const dort = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function hoteDe(url: string, donne?: string): string {
  if (donne) return donne;
  try { return new URL(url).host; } catch { return url; }
}

/** Traduit une erreur de fetch (ou un code HTTP) en message français + état de service. */
export function classerErreur(e: unknown, hote: string, statut?: number): { message: string; etat: EtatService } {
  if (statut !== undefined) {
    if (statut === 429) return { message: `${hote} limite le débit (trop de requêtes)`, etat: 'limite' };
    if (statut === 403 || statut === 401) return { message: `${hote} a refusé l'accès (${statut})`, etat: 'refus' };
    return { message: `${hote} a répondu ${statut}`, etat: statut >= 500 ? 'muet' : 'refus' };
  }
  const err = e as { name?: string; code?: string; message?: string; cause?: { code?: string; message?: string } };
  const code = err?.code ?? err?.cause?.code ?? '';
  const txt = `${err?.message ?? ''} ${err?.cause?.message ?? ''}`;
  if (err?.name === 'TimeoutError' || /timed? ?out|inactivité|inactivite/i.test(txt)) return { message: `${hote} ne répond pas (délai dépassé)`, etat: 'muet' };
  if (err?.name === 'AbortError') return { message: `${hote} ne répond pas (délai dépassé)`, etat: 'muet' };
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN' || /ENOTFOUND|EAI_AGAIN|getaddrinfo/i.test(txt)) return { message: `nom introuvable (DNS en panne ?) pour ${hote}`, etat: 'muet' };
  if (code === 'ECONNREFUSED' || /ECONNREFUSED/i.test(txt)) return { message: `${hote} refuse la connexion`, etat: 'refus' };
  if (code === 'ENETUNREACH' || code === 'EHOSTUNREACH' || /ENETUNREACH|EHOSTUNREACH|network/i.test(txt)) return { message: `pas de connexion Internet (réseau coupé)`, etat: 'muet' };
  if (code === 'ECONNRESET' || /ECONNRESET|socket hang up/i.test(txt)) return { message: `la connexion à ${hote} a été coupée`, etat: 'muet' };
  if (code === 'ERR_TLS_CERT_ALTNAME_INVALID' || /certificate|CERT_/i.test(txt)) return { message: `certificat invalide pour ${hote}`, etat: 'refus' };
  if (/redirect/i.test(txt)) return { message: `trop de redirections depuis ${hote}`, etat: 'refus' };
  return { message: `${hote} ne répond pas`, etat: 'muet' };
}

/**
 * Enveloppe `response.body` d'un délai d'inactivité : si plus aucun octet n'arrive pendant `inactiviteMs`,
 * le flux est coupé proprement (on ne reste pas bloqué sur un téléchargement qui gèle).
 */
export function fluxAvecInactivite(reponse: Response, inactiviteMs: number): Response {
  if (!reponse.body) return reponse;
  const source = reponse.body.getReader();
  let minuterie: ReturnType<typeof setTimeout>;
  const flux = new ReadableStream<Uint8Array>({
    start(controleur) {
      const relancer = () => { clearTimeout(minuterie); minuterie = setTimeout(() => { source.cancel().catch(() => {}); controleur.error(new Error(`inactivité : plus rien reçu depuis ${Math.round(inactiviteMs / 1000)} s`)); }, inactiviteMs); };
      const pomper = (): void => {
        source.read().then(({ done, value }) => {
          if (done) { clearTimeout(minuterie); controleur.close(); return; }
          relancer(); controleur.enqueue(value); pomper();
        }).catch((err) => { clearTimeout(minuterie); controleur.error(err); });
      };
      relancer(); pomper();
    },
    cancel() { clearTimeout(minuterie); source.cancel().catch(() => {}); },
  });
  return new Response(flux, { status: reponse.status, statusText: reponse.statusText, headers: reponse.headers });
}

/**
 * fetch robuste. Ne jette jamais : rend `{ ok, statut, reponse?, erreur?, etatService? }`.
 * En cas d'échec réseau, réessaie `essais` fois avec une attente croissante plafonnée à 60 s.
 */
export async function fetchPropre(url: string, opts: OptionsFetch = {}): Promise<ResultatFetch> {
  const f = opts.fetch ?? fetch;
  const sleep = opts.sleep ?? dort;
  const timeoutMs = opts.timeoutMs ?? 15_000;
  const essais = Math.max(0, Math.min(8, opts.essais ?? 0));
  const hote = hoteDe(url, opts.hote);
  let dernier: ResultatFetch = { ok: false, erreur: `${hote} ne répond pas`, etatService: 'muet' };

  for (let k = 0; k <= essais; k++) {
    if (k > 0) await sleep(Math.min(60_000, 1_000 * 2 ** (k - 1)));
    try {
      const init: RequestInit = { ...opts.init, signal: opts.init?.signal ?? AbortSignal.timeout(timeoutMs) };
      let reponse = await f(url, init);
      if (!reponse.ok) {
        const { message, etat } = classerErreur(undefined, hote, reponse.status);
        marquerService(hote, etat, message);
        dernier = { ok: false, statut: reponse.status, reponse, erreur: message, etatService: etat };
        // 429 / 5xx : ça peut repasser, on réessaie ; 4xx définitif : inutile d'insister.
        if (reponse.status === 429 || reponse.status >= 500) continue;
        return dernier;
      }
      if (opts.inactiviteMs && reponse.body) reponse = fluxAvecInactivite(reponse, opts.inactiviteMs);
      marquerService(hote, 'ok');
      return { ok: true, statut: reponse.status, reponse };
    } catch (e) {
      const { message, etat } = classerErreur(e, hote);
      marquerService(hote, etat, message);
      dernier = { ok: false, erreur: message, etatService: etat };
    }
  }
  return dernier;
}

/** Comme fetchPropre, mais rend directement le texte (ou undefined + message d'erreur). */
export async function texteePropre(url: string, opts: OptionsFetch = {}): Promise<{ texte?: string; erreur?: string }> {
  const r = await fetchPropre(url, opts);
  if (!r.ok || !r.reponse) return { erreur: r.erreur };
  try { return { texte: await r.reponse.text() }; }
  catch (e) { return { erreur: classerErreur(e, hoteDe(url, opts.hote)).message }; }
}
