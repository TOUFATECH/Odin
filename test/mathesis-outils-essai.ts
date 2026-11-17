// Mathésis — aides d'essai : fausse horloge, faux site (faux transport), faux résolveur, faux moteur de recherche,
// et un montage complet du moteur avec une vraie mémoire (en mémoire vive) et une vraie file de Noûs. Aucun réseau.
import { creerMathesis } from '../src/valhalla/mathesis/moteur.ts';
import { MagasinMemoire } from '../src/valhalla/mathesis/magasin.ts';
import type { Reglages, ResultatRecherche, Transport } from '../src/valhalla/mathesis/types.ts';
import { Mnemosyne } from '../src/muninn/store.ts';
import { fileBornee, type FileApprentissage, type NoosDeps } from '../src/brain/nous/deps.ts';

/** 17 novembre 2026, 23 h 30 (heure locale) : dans les heures permises par défaut. */
export const NUIT = new Date(2026, 10, 17, 23, 30).getTime();
export const JOUR_PLEIN = new Date(2026, 10, 17, 14, 0).getTime();

export function fausseHorloge(debut = NUIT) {
  const h = { t: debut, maintenant: () => h.t, attendre: async (ms: number, signal?: AbortSignal) => { if (signal?.aborted) throw new Error('abandon'); h.t += Math.max(0, ms); }, avancer: (ms: number) => { h.t += ms; } };
  return h;
}

export interface FaussePage { statut?: number; corps?: string; type?: string; entetes?: Record<string, string>; etag?: string; derniereModif?: string }
export interface Demande { url: string; methode: string; entetes: Record<string, string>; at: number }

/** Un faux site : des pages par adresse complète, le journal de TOUTES les demandes reçues. Gère ETag / 304. */
export function fauxSite(pages: Record<string, FaussePage>, horloge: { maintenant: () => number }) {
  const demandes: Demande[] = [];
  const transport: Transport = async (url, init) => {
    demandes.push({ url, methode: init.method, entetes: { ...init.headers }, at: horloge.maintenant() });
    const p = pages[url];
    if (!p) return new Response('introuvable', { status: 404, headers: { 'content-type': 'text/plain' } });
    const h: Record<string, string> = { 'content-type': p.type ?? 'text/html; charset=utf-8', ...(p.entetes ?? {}) };
    if (p.etag) h.etag = p.etag;
    if (p.derniereModif) h['last-modified'] = p.derniereModif;
    if (p.etag && init.headers['if-none-match'] === p.etag) return new Response(null, { status: 304, headers: h });
    const st = p.statut ?? 200;
    const sansCorps = st === 204 || st === 304 || (st >= 300 && st < 400);
    return new Response(sansCorps ? null : (p.corps ?? ''), { status: st, headers: h });
  };
  return { pages, demandes, transport, demandesVers: (motif: RegExp) => demandes.filter((d) => motif.test(d.url)) };
}

/** Un faux résolveur : par défaut, une adresse publique. */
export function fauxResolveur(carte: Record<string, string[]> = {}) {
  return async (hote: string) => carte[hote] ?? ['93.184.216.34'];
}

/** Une page HTML d'essai. */
export function html(titre: string, paragraphes: string[], liens: Array<{ href: string; texte: string; rel?: string }> = [], tete = ''): string {
  return `<!doctype html><html><head><title>${titre}</title>${tete}</head><body><main><h1>${titre}</h1>${paragraphes.map((p) => `<p>${p}</p>`).join('')}` +
    `${liens.map((l) => `<a href="${l.href}"${l.rel ? ` rel="${l.rel}"` : ''}>${l.texte}</a>`).join(' ')}</main></body></html>`;
}

/** Un faux moteur de recherche : des résultats par question, et le journal des questions. */
export function fauxMoteur(resultats: Record<string, string[]> | ((q: string) => string[])) {
  const questions: string[] = [];
  const chercher = async (q: string): Promise<ResultatRecherche[]> => {
    questions.push(q);
    const urls = typeof resultats === 'function' ? resultats(q) : (resultats[q] ?? Object.values(resultats)[0] ?? []);
    return urls.map((url) => ({ url, titre: url, extrait: '' }));
  };
  return { chercher, questions };
}

/** Le montage complet : moteur + vraie mémoire + vraie file de Noûs (essai forcé à faux pour qu'elle reçoive). */
export function monter(o: { pages?: Record<string, FaussePage>; resultats?: Record<string, string[]> | ((q: string) => string[]); reglages?: Partial<Reglages>; resolveur?: Record<string, string[]>; occupe?: () => boolean; prive?: () => boolean; debut?: number } = {}) {
  const horloge = fausseHorloge(o.debut ?? NUIT);
  const site = fauxSite(o.pages ?? {}, horloge);
  const moteurRecherche = fauxMoteur(o.resultats ?? {});
  const muninn = new Mnemosyne(':memory:');
  const file: FileApprentissage = fileBornee();
  const nous: NoosDeps = { cfg: { learning: { observe: true }, nous: { actif: true } }, privateMode: () => muninn.privateMode, essai: false, file, maintenant: horloge.maintenant };
  const magasin = new MagasinMemoire();
  const m = creerMathesis({
    dossier: 'inutile-en-memoire', home: 'inutile-en-memoire', magasin, transport: site.transport, resoudre: fauxResolveur(o.resolveur),
    temps: { maintenant: horloge.maintenant, attendre: horloge.attendre }, chercher: moteurRecherche.chercher,
    apprentissage: { memoire: muninn, nous, maintenant: horloge.maintenant }, occupe: o.occupe, prive: o.prive,
  });
  if (o.reglages) m.regler(o.reglages);
  return { m, horloge, site, moteurRecherche, muninn, file, magasin };
}
