// Mathésis — lot 3 : le robot de lecture des pages PUBLIQUES. Il part des sujets de la liste de curiosité et suit
// les liens PERTINENTS (le texte du lien ou son adresse parle du sujet), à profondeur bornée : il ne lit que ce que la
// curiosité demande, dans les budgets — jamais « tout Internet ». Il ne sonde rien : il ne fait que suivre des liens.
//
// Pour chaque page : date de visite (jour, mois, année), empreinte du contenu, indications de fraîcheur du site.
// Une page qui n'est pas encore à revisiter n'est PAS demandée ; à sa date, demande conditionnelle (ETag /
// Last-Modified), puis comparaison d'empreinte : une page inchangée n'est pas relue (ni réanalysée), une page
// modifiée l'est. La date de revisite s'adapte à la fréquence de changement observée.
import type { Lecteur } from './lecteur.ts';
import type { Magasin } from './magasin.ts';
import type { Journal } from './journal.ts';
import { siteInterdit } from './interdits.ts';
import { court, dateCourte, motsUtiles, plier } from './outils.ts';
import type { EtatPage, Fraicheur, Interdits, Manque, PageLue, RaisonArret, Reglages, SourceCarte } from './types.ts';

const JOUR = 86_400_000;
export const REVISITE = { defaut: 7 * JOUR, min: JOUR, max: 60 * JOUR } as const;
export const PAGES_MAX = 5000;

/** Le premier intervalle de revisite, d'après les indications de fraîcheur du site (borné 1 à 30 jours). Pur. */
export function intervalleInitial(f: Fraicheur): number {
  if (f.maxAgeS !== undefined) return Math.max(REVISITE.min, Math.min(30 * JOUR, f.maxAgeS * 1000));
  return REVISITE.defaut;
}
/** L'intervalle suivant : plus court si la page a changé, plus long sinon. Pur. */
export function intervalleSuivant(avant: number, change: boolean): number {
  return change ? Math.max(REVISITE.min, Math.floor(avant / 2)) : Math.min(REVISITE.max, Math.floor(avant * 1.5));
}

/** Un lien parle-t-il du sujet ? (texte du lien ou adresse) Pur. */
export function lienPertinent(lien: { url: string; texte: string }, mots: string[]): boolean {
  if (!mots.length) return false;
  let chemin = '';
  try { const u = new URL(lien.url); chemin = decodeURIComponent(u.pathname).replace(/[-_/.]+/g, ' '); } catch { return false; }
  const ici = new Set(motsUtiles(`${lien.texte} ${chemin}`));
  const n = mots.filter((m) => ici.has(m)).length;
  return n >= Math.min(2, mots.length);
}

export interface BilanExploration { pages: PageLue[]; lues: number; inchangees: number; pasDues: number; sautees: Array<{ url: string; raison: string }>; refus: Array<{ url: string; raison: string }>; arret?: RaisonArret }

export interface OptionsRobot {
  lecteur: Pick<Lecteur, 'lire'>;
  magasin: Magasin;
  journal: Journal;
  reglages: () => Reglages;
  interdits: () => Interdits;
  maintenant: () => number;
}

export class Robot {
  private readonly o: OptionsRobot;
  constructor(o: OptionsRobot) { this.o = o; }

  etats(): Record<string, EtatPage> { return this.o.magasin.lire<Record<string, EtatPage>>('pages', {}); }
  private ranger(e: Record<string, EtatPage>): void {
    const cles = Object.keys(e);
    if (cles.length > PAGES_MAX) for (const k of cles.sort((a, b) => e[a].derniereVisiteMs - e[b].derniereVisiteMs).slice(0, cles.length - PAGES_MAX)) delete e[k];
    this.o.magasin.ecrire('pages', e);
  }

  /** Met à jour l'état d'une page après une visite. Rend vrai si son contenu est NOUVEAU ou a CHANGÉ. */
  private noterVisite(url: string, sujet: string, profondeur: number, r: { genre: 'lu'; page: PageLue } | { genre: 'inchange'; fraicheur: Fraicheur } | { genre: 'refus' | 'erreur'; raison: string }): boolean {
    // « Ne pas garder » : aucune adresse ni empreinte de page n'est rangée (la page lue est rendue, rien n'est gardé).
    if (this.o.reglages().nePasGarder) return r.genre === 'lu';
    const now = this.o.maintenant();
    const e = { ...this.etats() };
    const avant = e[url];
    const base: EtatPage = avant ?? {
      url, site: (() => { try { return new URL(url).hostname; } catch { return ''; } })(), sujet, premiereVisite: dateCourte(now), derniereVisite: dateCourte(now),
      derniereVisiteMs: now, fraicheur: {}, visites: 0, changements: 0, intervalleMs: REVISITE.defaut, prochaineVisite: now, statut: 'lu', profondeur,
    };
    const x: EtatPage = { ...base, derniereVisite: dateCourte(now), derniereVisiteMs: now, visites: base.visites + 1, profondeur: Math.min(base.profondeur, profondeur) };
    let neuf = false;
    if (r.genre === 'lu') {
      const change = !avant || avant.empreinte !== r.page.empreinte;
      x.fraicheur = r.page.fraicheur;
      if (!avant) { x.intervalleMs = intervalleInitial(r.page.fraicheur); x.statut = 'lu'; neuf = true; }
      else if (change) { x.changements += 1; x.intervalleMs = intervalleSuivant(avant.intervalleMs, true); x.statut = 'lu'; neuf = true; }
      else { x.intervalleMs = intervalleSuivant(avant.intervalleMs, false); x.statut = 'inchange'; }
      x.empreinte = r.page.empreinte;
      x.raison = undefined;
    } else if (r.genre === 'inchange') {
      x.fraicheur = { ...x.fraicheur, ...r.fraicheur };
      x.intervalleMs = intervalleSuivant(x.intervalleMs, false);
      x.statut = 'inchange';
      x.raison = undefined;
    } else {
      x.statut = r.genre; x.raison = r.raison.slice(0, 200);
      x.intervalleMs = Math.min(REVISITE.max, Math.max(REVISITE.defaut, x.intervalleMs * 2));
    }
    x.prochaineVisite = now + x.intervalleMs;
    e[url] = x;
    this.ranger(e);
    return neuf;
  }

  /**
   * Explore pour un manque à partir de graines (résultats du moteur ou adresses confiées), en suivant les liens
   * pertinents. Rend les pages NOUVELLES ou CHANGÉES (les inchangées ne sont ni relues ni rendues).
   */
  async explorer(m: Pick<Manque, 'id' | 'sujet' | 'raison'>, graines: string[], signal?: AbortSignal): Promise<BilanExploration> {
    const r = this.o.reglages().robot;
    const mots = motsUtiles(m.sujet);
    const bilan: BilanExploration = { pages: [], lues: 0, inchangees: 0, pasDues: 0, sautees: [], refus: [] };
    const file: Array<{ url: string; profondeur: number }> = [];
    const vus = new Set<string>();
    const ajouter = (url: string, profondeur: number) => { if (vus.has(url) || file.length >= 200) return; vus.add(url); file.push({ url, profondeur }); };
    for (const g of graines) ajouter(g, 0);
    let demandes = 0;
    while (file.length && demandes < r.pagesParManque) {
      const { url, profondeur } = file.shift()!;
      if (siteInterdit(this.o.interdits(), url)) { bilan.sautees.push({ url, raison: 'site interdit par toi' }); continue; }
      const connu = this.etats()[url];
      if (connu && connu.prochaineVisite > this.o.maintenant() && (connu.statut === 'lu' || connu.statut === 'inchange')) { bilan.pasDues++; continue; }
      if (connu && connu.prochaineVisite > this.o.maintenant()) { bilan.sautees.push({ url, raison: `pas avant le ${dateCourte(connu.prochaineVisite)} (${connu.raison ?? connu.statut})` }); continue; }
      demandes++;
      const res = await this.o.lecteur.lire(url, { conditionnel: connu?.fraicheur, signal });
      if (res.genre === 'arret') { bilan.arret = res.raison as RaisonArret; break; }
      if (res.genre === 'saute') { bilan.sautees.push({ url, raison: res.raison }); continue; }
      if (res.genre === 'refus') {
        bilan.refus.push({ url, raison: res.raison });
        this.noterVisite(url, m.sujet, profondeur, { genre: 'refus', raison: res.raison });
        if (this.o.reglages().nePasGarder) this.o.journal.noter({ genre: 'refus', quoi: 'une page laissée (adresse non gardée)', pourquoi: res.raison });
        else this.o.journal.noter({ genre: 'refus', manque: m.id, quoi: `page laissée : ${court(url, 160)}`, pourquoi: res.raison, source: res.site });
        continue;
      }
      if (res.genre === 'inchange') {
        bilan.inchangees++;
        this.noterVisite(url, m.sujet, profondeur, res);
        continue;
      }
      bilan.lues++;
      const neuf = this.noterVisite(url, m.sujet, profondeur, res);
      if (res.page.urlFinale !== url) this.noterVisite(res.page.urlFinale, m.sujet, profondeur, res);
      if (!neuf) { bilan.inchangees++; continue; }
      bilan.pages.push(res.page);
      if (!this.o.reglages().nePasGarder) this.o.journal.noter({ genre: 'lecture', manque: m.id, quoi: `a lu « ${court(res.page.titre || url, 120)} »`, pourquoi: m.raison, source: res.page.urlFinale });
      if (profondeur < r.profondeurMax && !res.page.nofollow) {
        let n = 0;
        for (const l of res.page.liens) {
          if (n >= r.liensParPage) break;
          if (lienPertinent(l, mots)) { ajouter(l.url, profondeur + 1); n++; }
        }
      }
    }
    return bilan;
  }

  /**
   * Visite UNE page (pour un site à absorber) : une page connue qui n'est pas encore due n'est pas demandée ; à sa date,
   * demande conditionnelle. L'état de la page est noté comme pour l'exploration. Ne lève jamais.
   */
  async visiter(url: string, sujet: string, o: { signal?: AbortSignal; plafondSite?: number } = {}): Promise<
    { genre: 'lu'; page: PageLue; neuf: boolean } | { genre: 'inchange' | 'pas-due' } | { genre: 'refus' | 'saute'; raison: string } | { genre: 'arret'; raison: RaisonArret }> {
    if (siteInterdit(this.o.interdits(), url)) return { genre: 'saute', raison: 'site interdit par toi' };
    const connu = this.etats()[url];
    if (connu && connu.prochaineVisite > this.o.maintenant()) return connu.statut === 'refus' || connu.statut === 'erreur' ? { genre: 'saute', raison: connu.raison ?? connu.statut } : { genre: 'pas-due' };
    const res = await this.o.lecteur.lire(url, { conditionnel: connu?.fraicheur, signal: o.signal, ...(o.plafondSite ? { plafondSite: o.plafondSite } : {}) });
    if (res.genre === 'arret') return { genre: 'arret', raison: res.raison as RaisonArret };
    if (res.genre === 'saute') return { genre: 'saute', raison: res.raison };
    if (res.genre === 'refus') { this.noterVisite(url, sujet, 0, { genre: 'refus', raison: res.raison }); return { genre: 'refus', raison: res.raison }; }
    if (res.genre === 'inchange') { this.noterVisite(url, sujet, 0, res); return { genre: 'inchange' }; }
    const neuf = this.noterVisite(url, sujet, 0, res);
    if (res.page.urlFinale !== url) this.noterVisite(res.page.urlFinale, sujet, 0, res);
    return { genre: 'lu', page: res.page, neuf };
  }

  /** Les pages dont la date de revisite est arrivée (les plus en retard d'abord). */
  aRevisiter(n: number): EtatPage[] {
    const now = this.o.maintenant();
    return Object.values(this.etats()).filter((e) => e.prochaineVisite <= now && e.statut !== 'refus').sort((a, b) => a.prochaineVisite - b.prochaineVisite).slice(0, Math.max(0, n));
  }

  /** Revisite les pages dues. Rend les pages modifiées, groupées par sujet. */
  async revisiter(n: number, signal?: AbortSignal): Promise<{ parSujet: Map<string, PageLue[]>; inchangees: number; arret?: RaisonArret }> {
    const parSujet = new Map<string, PageLue[]>();
    let inchangees = 0;
    for (const e of this.aRevisiter(n)) {
      const res = await this.o.lecteur.lire(e.url, { conditionnel: e.fraicheur, signal });
      if (res.genre === 'arret') return { parSujet, inchangees, arret: res.raison as RaisonArret };
      if (res.genre === 'saute') continue;
      if (res.genre === 'refus') { this.noterVisite(e.url, e.sujet, e.profondeur, { genre: 'refus', raison: res.raison }); continue; }
      if (res.genre === 'inchange') { inchangees++; this.noterVisite(e.url, e.sujet, e.profondeur, res); continue; }
      if (this.noterVisite(e.url, e.sujet, e.profondeur, res)) {
        const l = parSujet.get(e.sujet) ?? [];
        l.push(res.page);
        parSujet.set(e.sujet, l);
      } else inchangees++;
    }
    if (inchangees) this.o.journal.noter({ genre: 'inchange', quoi: `${inchangees} page(s) revisitée(s) sans changement : pas relues` });
    return { parSujet, inchangees };
  }

  /** (point de branchement de la carte) Un point par site lu, sa dernière lecture et les sites vers lesquels il mène. */
  carte(): ReturnType<SourceCarte['sites']> {
    const parSite = new Map<string, { pages: number; derniere: number }>();
    for (const e of Object.values(this.etats())) {
      if (e.statut === 'refus' || e.statut === 'erreur') continue;
      const s = parSite.get(e.site) ?? { pages: 0, derniere: 0 };
      s.pages++; s.derniere = Math.max(s.derniere, e.derniereVisiteMs);
      parSite.set(e.site, s);
    }
    return [...parSite.entries()].map(([site, s]) => ({ site, pages: s.pages, derniereLecture: dateCourte(s.derniere), liensVers: [] }));
  }
}

/** Un sujet replié (pour regrouper les pages revisitées). */
export const cleSujet = (s: string): string => plier(s);
