// Lyncée, le moteur de recherche d'Odin (le moteur de Pythie). Odin interroge LUI-MÊME plusieurs moteurs en même
// temps, sans clé et sans instance externe, puis filtre, fusionne, dédoublonne et classe : une page vue par plusieurs
// moteurs passe devant, 3 pages au plus par site (6 pour les images et les vidéos), publicités retirées.
// Seule la question part (pas de cookie, pas de référent, agent banal) ; un moteur qui bloque est mis en pause.
import { join } from 'node:path';
import { classerErreur } from '../../../net/fetch-propre.ts';
import { marquerService } from '../../../net/etat-internet.ts';
import { fuse, normUrl, type Focus, type Source } from '../engine.ts';
import { ADAPTATEURS, HOTES_MOTEURS } from './adaptateurs.ts';
import { Cache } from './cache.ts';
import { Debit } from './debit.ts';
import { nettoyer } from './filtre.ts';
import { Sante, type GenreEchec } from './sante.ts';
import { CATEGORIES, entetes, type Adaptateur, type Categorie, type Lecture, type ResultatMoteur } from './types.ts';

export interface EtatMoteur { id: string; etiquette: string; categories: Categorie[]; etat: 'pret' | 'pause' | 'coupe'; jusqua?: number; raison?: string; echecs: number; dernierSucces?: number }
export interface OptionsLyncee { categorie?: Categorie; page?: number; n?: number; fetcher: typeof fetch; signal?: AbortSignal; delai?: number; sans?: string[] }
export interface ReponseLyncee { q: string; categorie: Categorie; page: number; resultats: Source[]; moteurs: string[]; erreurs: string[]; pauses: EtatMoteur[]; duCache: boolean; suivante: boolean }

/** Le focus de Pythie en catégorie de Lyncée. Pur. */
export function categorieDe(f: Focus): Categorie {
  return ({ tout: 'web', actualites: 'actualites', images: 'images', videos: 'videos', wikipedia: 'savoir', science: 'savoir', sons: 'videos' } as Record<Focus, Categorie>)[f] ?? 'web';
}
const heure = (t: number) => new Date(t).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
/** « Bing en pause jusqu'à 14:20 : contrôle anti-robot » */
export const phrasePause = (e: Pick<EtatMoteur, 'etiquette' | 'jusqua' | 'raison'>) => `${e.etiquette} en pause${e.jusqua ? ` jusqu'à ${heure(e.jusqua)}` : ''}${e.raison ? ` : ${e.raison}` : ''}`;

class Panne extends Error { statut?: number; constructor(message: string, statut?: number) { super(message); this.statut = statut; } }

/** La santé est tenue par service : un refus de Brave (ou de DuckDuckGo, de Bing) met en pause toutes ses portes. */
const cleSante = (a: Adaptateur) => a.famille ?? a.id;
/** Le débit est tenu par hôte : une seule requête à la fois vers un même hôte, avec l'intervalle le plus long. */
const HOTE = new Map(ADAPTATEURS.map((a) => [a.id, new URL(a.requete('x', a.categories[0], 1).url).hostname]));
const INTERVALLE = new Map<string, number>();
for (const a of ADAPTATEURS) { const h = HOTE.get(a.id)!; INTERVALLE.set(h, Math.max(INTERVALLE.get(h) ?? 0, a.intervalle)); }
/** Les moteurs de pages web ouverts à tous (pas une encyclopédie). */
const SAVOIR = new Set(['Wikipédia', 'Wikidata']);

export function creerLyncee(o: { maintenant?: () => number; dossier?: string } = {}) {
  const maintenant = o.maintenant ?? Date.now;
  const sante = new Sante(maintenant, o.dossier ? join(o.dossier, 'lyncee-sante.json') : undefined);
  const debit = new Debit(maintenant), cache = new Cache<ReponseLyncee>(maintenant);
  let coupes = new Set<string>();

  const etatDe = (a: Adaptateur): EtatMoteur => {
    const s = sante.etat(cleSante(a)), pause = Boolean(s.jusqua && s.jusqua > maintenant());
    return { id: a.id, etiquette: a.etiquette, categories: [...a.categories], etat: coupes.has(a.id) ? 'coupe' : pause ? 'pause' : 'pret', ...(pause ? { jusqua: s.jusqua } : {}), ...(s.raison && (pause || s.echecs) ? { raison: s.raison } : {}), echecs: s.echecs, ...(s.dernierSucces ? { dernierSucces: s.dernierSucces } : {}) };
  };

  /** Une requête vers un moteur : en-têtes neutres, aucune donnée de session, une redirection au plus (même hôte). */
  async function appeler(a: Adaptateur, q: string, c: Categorie, page: number, f: typeof fetch, signal: AbortSignal): Promise<Lecture> {
    const req = a.requete(q, c, page);
    let url = req.url;
    if (!url.startsWith('https://') || !HOTES_MOTEURS.has(new URL(url).hostname)) throw new Panne(`${a.etiquette} : adresse refusée`);
    const init = (m: 'GET' | 'POST', body?: string): RequestInit => ({ method: m, ...(body !== undefined ? { body } : {}), headers: { ...entetes(req.genre), ...(body !== undefined ? { 'content-type': 'application/x-www-form-urlencoded' } : {}) }, credentials: 'omit', redirect: 'manual', referrerPolicy: 'no-referrer', signal });
    let r = await f(url, init(req.method ?? 'GET', req.body));
    if (r.status >= 300 && r.status < 400) {
      const loc = r.headers.get('location') ?? '';
      let cible: URL | undefined; try { cible = new URL(loc, url); } catch { /* illisible */ }
      if (/captcha|challenge|consent|showcaptcha/i.test(loc)) { void r.body?.cancel().catch(() => {}); return a.lire('', r.status, url, loc); }
      if (!cible || cible.protocol !== 'https:' || cible.hostname !== new URL(url).hostname) { void r.body?.cancel().catch(() => {}); throw new Panne(`${a.etiquette} : redirection inattendue`, r.status); }
      void r.body?.cancel().catch(() => {});
      url = cible.toString();
      r = await f(url, init('GET'));
      if (r.status >= 300 && r.status < 400) { const l2 = r.headers.get('location') ?? ''; void r.body?.cancel().catch(() => {}); if (/captcha|challenge|consent|showcaptcha/i.test(l2)) return a.lire('', r.status, url, l2); throw new Panne(`${a.etiquette} : trop de redirections`, r.status); }
    }
    if (r.status >= 500 || (r.status >= 400 && r.status !== 403 && r.status !== 429)) { void r.body?.cancel().catch(() => {}); throw new Panne(classerErreur(undefined, a.etiquette, r.status).message, r.status); }
    const texte = (await r.text()).slice(0, 4_000_000);
    return a.lire(texte, r.status, r.url || url);
  }

  /** Un échec : santé mise à jour, état du service noté, message en clair. */
  function echouer(a: Adaptateur, raison: string, genre: GenreEchec, etat: Parameters<typeof marquerService>[1]): string {
    const jusqua = sante.echec(cleSante(a), raison, genre);
    marquerService(a.etiquette, etat, raison);
    return jusqua ? phrasePause({ etiquette: a.etiquette, jusqua, raison }) : `${a.etiquette} : ${raison}`;
  }

  async function chercher(question: string, op: OptionsLyncee, interne: { sansCache?: boolean } = {}): Promise<ReponseLyncee> {
    const q = String(question ?? '').replace(/[\u0000-\u001f]+/g, ' ').trim().slice(0, 400);
    const categorie: Categorie = op.categorie ?? 'web', page = Math.max(1, Math.min(10, Math.floor(Number(op.page) || 1)));
    const n = Math.max(1, Math.min(50, Math.floor(Number(op.n) || 20))), delai = Math.max(100, Number(op.delai) || 3500), sans = new Set(op.sans ?? []);
    const cle = `${categorie}|${page}|${[...sans].sort().join(',')}|${q.toLowerCase()}`;
    const vide = (): ReponseLyncee => ({ q, categorie, page, resultats: [], moteurs: [], erreurs: [], pauses: [], duCache: false, suivante: false });
    if (!q) return vide();
    // Le cache garde la liste la plus large (50) : chaque appel la découpe à son n.
    const deja = interne.sansCache ? undefined : cache.lire(cle); if (deja) return { ...deja, resultats: deja.resultats.slice(0, n), duCache: true };

    const choisis = ADAPTATEURS.filter((a) => a.categories.includes(categorie) && !coupes.has(a.id) && !sans.has(a.id) && (page === 1 || a.pagine !== false));
    // Une famille = un service : le premier adaptateur libre répond ; les suivants servent de repli en cas de PANNE
    // seulement. Après un blocage ou une limite, la famille entière est en pause : aucun nouvel essai par une autre porte.
    const familles = new Map<string, Adaptateur[]>();
    for (const a of choisis) { const k = a.famille ?? a.id; familles.set(k, [...(familles.get(k) ?? []), a]); }
    const erreurs: string[] = [], lists: Array<{ engine: string; results: Array<ResultatMoteur & { engines: string[] }> }> = [], moteurs: string[] = [];
    let suivante = false;
    await Promise.all([...familles.values()].map(async (membres) => {
      const signal = op.signal ? AbortSignal.any([op.signal, AbortSignal.timeout(delai)]) : AbortSignal.timeout(delai);
      for (const a of membres) {
        if (!sante.libre(cleSante(a)) || signal.aborted) continue;
        const hote = HOTE.get(a.id)!, rendre = await debit.prendre(hote, INTERVALLE.get(hote)!, delai, signal);
        // Occupé : le même moteur (repli compris) n'est pas interrogé une deuxième fois tout de suite.
        if (!rendre) { if (!signal.aborted) erreurs.push(`${a.etiquette} occupé (déjà interrogé à l'instant)`); break; }
        try {
          const l = await appeler(a, q, categorie, page, op.fetcher, signal);
          if ('bloque' in l) { erreurs.push(echouer(a, l.bloque, l.genre, l.genre === 'limite' ? 'limite' : 'refus')); return; }
          sante.reussite(cleSante(a)); marquerService(a.etiquette, 'ok');
          const propres = l.resultats.map(nettoyer).filter((x): x is ResultatMoteur => Boolean(x)).map((x) => ({ ...x, engines: [a.etiquette] }));
          lists.push({ engine: a.etiquette, results: propres }); moteurs.push(a.etiquette);
          if (l.suivante && a.pagine !== false) suivante = true;
          return;
        } catch (err) {
          const { message, etat } = err instanceof Panne ? { message: err.message, etat: classerErreur(undefined, a.etiquette, err.statut ?? 500).etat } : classerErreur(err, a.etiquette);
          const raison = message.startsWith(`${a.etiquette} `) ? message.slice(a.etiquette.length + 1).replace(/^:\s*/, '') : message;
          erreurs.push(echouer(a, raison, 'panne', etat));
        } finally { rendre(); }
      }
    }));

    // 3 pages par site (6 en images et vidéos) ; en Savoir, ou quand un seul moteur de pages a répondu, pas de coupe :
    // dix résultats de Wikipédia ne deviennent pas trois.
    const unSeul = lists.filter((l) => l.results.length).length <= 1;
    const parSite = categorie === 'images' || categorie === 'videos' ? 6 : categorie === 'savoir' || unSeul ? 50 : 3;
    if (categorie === 'web' && choisis.length && !moteurs.some((m) => !SAVOIR.has(m))) erreurs.unshift('Web : aucun grand moteur ne répond (au mieux Wikipédia)');
    // Toujours le même ordre de moteurs (celui de la liste), quel que soit celui qui a répondu le premier.
    const rang = (e: string) => ADAPTATEURS.findIndex((a) => a.etiquette === e);
    lists.sort((a, b) => rang(a.engine) - rang(b.engine)); moteurs.sort((a, b) => rang(a) - rang(b));
    const resultats = fuse(lists, 50, 60, parSite);
    const dates = new Map<string, string>();
    for (const l of lists) for (const r of l.results) if (r.published && !dates.has(normUrl(r.url))) dates.set(normUrl(r.url), r.published);
    for (const s of resultats) { const d = dates.get(normUrl(s.url)); if (d) s.published = d; }
    const pauses = choisis.map(etatDe).filter((x) => x.etat === 'pause');
    const rep: ReponseLyncee = { q, categorie, page, resultats, moteurs: [...new Set(moteurs)], erreurs: [...new Set(erreurs)], pauses, duCache: false, suivante };
    if (rep.moteurs.length && !interne.sansCache) cache.garder(cle, rep);
    return { ...rep, resultats: resultats.slice(0, n) };
  }

  /** Vérification à la main : une question neutre par catégorie, vers chaque moteur prêt ; la santé est mise à jour. */
  async function verifier(fetcher: typeof fetch, signal?: AbortSignal): Promise<EtatMoteur[]> {
    for (const c of Object.keys(CATEGORIES) as Categorie[]) await chercher('hauteur tour Eiffel', { categorie: c, n: 5, fetcher, signal, delai: 8000 }, { sansCache: true });
    return ADAPTATEURS.map(etatDe);
  }

  return {
    chercher: (q: string, op: OptionsLyncee) => chercher(q, op),
    verifier,
    etats: (): EtatMoteur[] => ADAPTATEURS.map(etatDe),
    reprendre: (id: string): boolean => { const a = ADAPTATEURS.find((x) => x.id === id); if (!a) return false; sante.reprendre(cleSante(a)); return true; },
    regler: (r: { dossier?: string; coupes?: string[] }) => { if (r.dossier) sante.relier(join(r.dossier, 'lyncee-sante.json')); if (r.coupes) coupes = new Set(r.coupes.filter((x) => typeof x === 'string')); },
  };
}

// L'instance du processus (celle de Pythie et de l'outil de recherche d'Odin).
const defaut = creerLyncee();
export const chercherLyncee = (q: string, o: OptionsLyncee): Promise<ReponseLyncee> => defaut.chercher(q, o);
export const etatsLyncee = (): EtatMoteur[] => defaut.etats();
export const reprendreMoteur = (id: string): boolean => defaut.reprendre(id);
export function reglerLyncee(o: { dossier?: string; coupes?: string[] }): void { defaut.regler(o); }
/** Une question neutre vers chaque moteur prêt (action manuelle « Vérifier les moteurs » de Pythie). */
export const verifierLyncee = (fetcher: typeof fetch, signal?: AbortSignal): Promise<EtatMoteur[]> => defaut.verifier(fetcher, signal);
