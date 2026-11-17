// Mathésis — la trace des recherches et de ce qui a été appris page par page, pour ne JAMAIS refaire deux fois la même
// chose (demande du propriétaire, 17/11/2026) :
//  - chaque recherche (question, date, moteur, nombre de résultats, adresses trouvées, faits retenus) est gardée ; la
//    même question n'est pas reposée avant REPOSER_MS ; ses adresses resservent alors au robot (qui, lui, ne relit une
//    page que si elle est due) ;
//  - pour chaque page, les empreintes des phrases déjà lues : quand une page change, seul ce qui est NOUVEAU est appris.
import type { Magasin } from './magasin.ts';
import { empreinteContenu, plier } from './outils.ts';

/** Une même question n'est reposée qu'après 7 jours. */
export const REPOSER_MS = 7 * 86_400_000;
/** Une recherche qui n'a rien trouvé peut être reposée dès le lendemain. */
export const REPOSER_VIDE_MS = 86_400_000;
export const TRACES_MAX = 1000, PAGES_MAX = 3000, PHRASES_PAR_PAGE = 300;

export interface TraceRecherche { q: string; cle: string; at: number; moteur: string; resultats: number; urls: string[]; retenus: number; manque?: string }
export interface ApprisPage { phrases: string[]; appris: number; at: number }

/** L'empreinte courte d'une phrase (repliée : une simple mise en forme ne la change pas). */
export const clePhrase = (p: string): string => empreinteContenu(p).slice(0, 16);
/** Le délai avant de reposer une question : 7 jours, 1 seul si elle n'avait rien trouvé. */
export const delaiRepos = (t: Pick<TraceRecherche, 'resultats'>): number => (t.resultats > 0 ? REPOSER_MS : REPOSER_VIDE_MS);
const cleQuestion =(q: string): string => plier(q).replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

export class Traces {
  private readonly magasin: Magasin;
  private readonly maintenant: () => number;
  constructor(magasin: Magasin, maintenant: () => number) { this.magasin = magasin; this.maintenant = maintenant; }

  // ------------------------------------------------------------------ les recherches
  recherches(): TraceRecherche[] { return this.magasin.lire<TraceRecherche[]>('recherches', []); }
  /** La dernière fois que cette question a été posée, si son délai de repos (delaiRepos) n'est pas écoulé. */
  recente(q: string): TraceRecherche | undefined {
    const c = cleQuestion(q), n = this.maintenant();
    const t = [...this.recherches()].reverse().find((x) => x.cle === c);
    return t && n - t.at < delaiRepos(t) ? t : undefined;
  }
  noterRecherche(t: Omit<TraceRecherche, 'cle' | 'at' | 'retenus'>): void {
    const l = [...this.recherches(), { ...t, q: t.q.slice(0, 300), cle: cleQuestion(t.q), at: this.maintenant(), urls: t.urls.slice(0, 12), retenus: 0 }];
    this.magasin.ecrire('recherches', l.slice(-TRACES_MAX));
  }
  /** Ce qu'ont donné les recherches de ce manque faites à cet instant (nombre de faits retenus). */
  noterRetenus(manque: string, depuis: number, n: number): void {
    const l = this.recherches().map((t) => (t.manque === manque && t.at >= depuis ? { ...t, retenus: t.retenus + n } : t));
    this.magasin.ecrire('recherches', l);
  }

  // ------------------------------------------------------------------ ce qui a été lu, page par page
  private pages(): Record<string, ApprisPage> { return this.magasin.lire<Record<string, ApprisPage>>('apprisPages', {}); }
  /** Les empreintes des phrases déjà lues sur cette page. */
  deja(url: string): Set<string> { return new Set(this.pages()[url]?.phrases ?? []); }
  apprisDe(url: string): ApprisPage | undefined { return this.pages()[url]; }
  /** Note les phrases déjà apprises d'une page (celles des faits retenus) et le nombre de faits appris cette fois. */
  noterPage(url: string, phrases: string[], appris: number): void {
    const t = { ...this.pages() };
    const avant = t[url];
    const toutes = [...new Set([...(avant?.phrases ?? []), ...phrases])].slice(-PHRASES_PAR_PAGE);
    t[url] = { phrases: toutes, appris: (avant?.appris ?? 0) + appris, at: this.maintenant() };
    const cles = Object.keys(t);
    if (cles.length > PAGES_MAX) for (const k of cles.sort((a, b) => t[a].at - t[b].at).slice(0, cles.length - PAGES_MAX)) delete t[k];
    this.magasin.ecrire('apprisPages', t);
  }
}
