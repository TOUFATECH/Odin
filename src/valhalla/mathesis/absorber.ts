// Mathésis — absorber un site (demande du propriétaire, 17/11/2026) : une liste de sites à lire EN ENTIER, en priorité,
// que le propriétaire remplit dans la page ou en le disant (« absorbe ce site … »). Pour chaque site : où il en est
// (pages connues, lues, restantes, dernière visite) et « déjà absorbé » quand c'est fait ; ensuite il est SUIVI (ses
// nouveautés seulement).
//
// Découverte des pages, dans cet ordre : le plan du site (lignes « Sitemap: » de ses consignes, sinon /sitemap.xml),
// ses fils d'actualité (RSS, Atom, annoncés par sa page d'accueil), puis les liens DU MÊME SITE des pages lues. Une file
// par site, sans doublon (adresse normalisée, sans paramètres de suivi), bornée ; les articles avant les pages de liste,
// les plus récents d'abord.
//
// Les bornes restent celles de Mathésis : lecture seule, consignes des robots (une adresse interdite n'entre même pas
// dans la file), délai entre deux pages, plafond de pages par site et par jour, budgets du jour, heures, pause,
// interrupteur, aucune adresse privée, aucun compte, aucun contournement. Un site qui interdit tout aux robots est
// refusé, et le propriétaire le sait. Les sites absorbés passent AVANT la curiosité ordinaire, dans le même budget.
// Aucun site n'est écrit ici par défaut : la liste est un réglage du propriétaire.
import type { Lecteur } from './lecteur.ts';
import type { Robot } from './robot.ts';
import type { Collection, Magasin } from './magasin.ts';
import type { Journal } from './journal.ts';
import { controlerForme } from './adresses.ts';
import { permis, type ReglesSite } from './robots.ts';
import { siteInterdit } from './interdits.ts';
import { court, dateCourte } from './outils.ts';
import type { Fraicheur, Interdits, PageLue, RaisonArret, Reglages } from './types.ts';

const JOUR = 86_400_000;
/**
 * Bornes : adresses en file par site, adresses connues gardées par site, sites dans la liste, plans lus par découverte.
 * La BORNE DE PLACE (dite au propriétaire dans la page) : au plus 100 000 adresses en file par site et 500 000 en tout
 * (environ 60 Mo), 200 000 adresses connues par site (en empreintes de 11 caractères, environ 3 Mo). Un site plus grand,
 * ou hostile (plan sans fin), ne remplit pas le disque : ce qui dépasse n'est pas noté, il revient au plan suivant.
 */
export const FILE_MAX = 100_000, FILE_TOTAL_MAX = 500_000, CONNUES_MAX = 200_000, SITES_MAX = 100, PLANS_PAR_DECOUVERTE = 4, FILS_PAR_DECOUVERTE = 2;
/** Un passage d'absorption dure au plus 14 minutes (les passages viennent toutes les 15 minutes). */
export const PASSAGE_MS = 14 * 60_000;
/** Le plus haut plafond de pages par jour qu'un site peut recevoir. */
export const PAGES_SITE_MAX = 10_000_000;
/** Un site suivi : son plan et ses fils sont relus une fois par jour (demandes conditionnelles). */
export const SUIVI_MS = JOUR;

export type EtatAbsorption = 'a-explorer' | 'en-cours' | 'en-suivi' | 'en-pause' | 'refuse';
export interface AdresseEnFile { url: string; date?: number; article: boolean }
export interface SiteAbsorbe {
  /** Clé : le nom du site sans « www. ». */
  id: string;
  /** L'adresse de départ (origine, et éventuellement un chemin). */
  racine: string;
  ajoute: number;
  par: 'page' | 'discussion';
  etat: EtatAbsorption;
  raison?: string;
  avantPause?: EtatAbsorption;
  /** Ce que disent ses consignes des robots, en clair. */
  consignes?: string;
  plans: string[];
  /** Plans annoncés mais pas encore lus (un index en annonce souvent des dizaines) : lus aux découvertes suivantes. */
  plansAVoir?: string[];
  /** Quand chaque plan ou fil a été demandé pour la dernière fois. */
  xmlLuA?: Record<string, number>;
  fils: string[];
  fraicheurs: Record<string, Fraicheur>;
  file: AdresseEnFile[];
  /** Le nombre de pages restant à lire (la file elle-même vit dans la collection du site). */
  restantes?: number;
  connues: number;
  /** Pages réellement lues (téléchargées) pour ce site. */
  lues: number;
  /** Pages de la file déjà connues du robot et pas dues (ou inchangées) : vues, pas relues. */
  dejaVues?: number;
  refusees: number;
  erreurs: number;
  faits: number;
  decouvert: boolean;
  prochaineDecouverte?: number;
  derniereVisite?: number;
  absorbeLe?: number;
  derniereNouveaute?: number;
  /** Son propre plafond de pages par jour (sinon celui des réglages de Mathésis, 1 000 000 par défaut). */
  pagesParJour?: number;
  /** Le délai entre deux pages que demandent ses consignes (« Crawl-delay »), en secondes. */
  delaiS?: number;
}

// ------------------------------------------------------------------ aides pures

/** La clé d'un site : son nom, sans « www. », en minuscules. */
export const cleSite = (hote: string): string => String(hote ?? '').toLowerCase().replace(/^www\./, '');

const SUIVI = /^(utm_[a-z]+|fbclid|gclid|dclid|msclkid|mc_cid|mc_eid|ref|ref_src|igshid|_hsenc|_hsmi|amp)$/i;
/** Une adresse comparable : sans fragment, sans paramètres de suivi, nom du site en minuscules. Pur. */
export function normaliserAdresse(brut: string): string | undefined {
  let u: URL;
  try { u = new URL(String(brut ?? '').trim()); } catch { return undefined; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return undefined;
  u.hash = '';
  for (const k of [...u.searchParams.keys()]) if (SUIVI.test(k)) u.searchParams.delete(k);
  u.hostname = u.hostname.toLowerCase();
  const s = u.toString();
  return s.length <= 2000 ? s : undefined;
}

const LISTE = /\/(tag|tags|category|categorie|categories|rubrique|author|auteur|page|feed|rss|search|recherche|wp-json|wp-admin|wp-login|login|connexion|panier|cart|compte|account)(\/|$)/i;
/** Une page d'article (plutôt qu'une page de liste, d'accueil ou de service) ? Pur. */
export function estArticle(url: string): boolean {
  let u: URL;
  try { u = new URL(url); } catch { return false; }
  const p = u.pathname;
  // Une page de commentaires n'est pas un article (vu sur un vrai site : « …/comment-page-1/ » venues de son fil des commentaires).
  if (/\/comment-page-\d+\/?$|\/comments?\/feed\/?$|\/amp\/?$/i.test(p)) return false;
  if (p === '/' || p === '' || LISTE.test(p) ||/\.(xml|rss|atom|json|jpg|jpeg|png|gif|webp|svg|pdf|zip|mp3|mp4)$/i.test(p)) return false;
  if (/[?&](p|page|s|q)=/i.test(u.search)) return false;
  return p.replace(/\/+$/, '').length > 1;
}

const entite = (t: string): string => t.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, '\'').trim();
const dateDe = (t: string | undefined): number | undefined => { if (!t) return undefined; const d = Date.parse(entite(t)); return Number.isFinite(d) ? d : undefined; };

/**
 * Les éléments <nom> … </nom> d'un document, en UNE passe : les fermetures sont repérées une fois (positions triées), et
 * chaque ouverture va à la première fermeture qui la suit (recherche dichotomique). Un document piégé (ouvertures sans
 * fermeture, des millions de balises) reste linéaire : rien n'est re-balayé. Un élément plus long que `fenetre` est
 * laissé. Rend [nom, corps] dans l'ordre. Pur.
 */
export function elements(texte: string, noms: string[], fenetre: number, max: number): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  const alt = noms.join('|');
  const fermetures = new Map<string, number[]>();
  for (const n of noms) fermetures.set(n, []);
  const reF = new RegExp(`<\\/(${alt})\\s*>`, 'gi');
  let f: RegExpExecArray | null;
  while ((f = reF.exec(texte))) fermetures.get(f[1].toLowerCase())!.push(f.index);
  const reO = new RegExp(`<(${alt})\\b[^>]{0,300}>`, 'gi');
  let o: RegExpExecArray | null, apres = 0;
  while ((o = reO.exec(texte)) && out.length < max) {
    if (o.index < apres) continue;
    const nom = o[1].toLowerCase(), debut = o.index + o[0].length, fs = fermetures.get(nom)!;
    let lo = 0, hi = fs.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (fs[mid] < debut) lo = mid + 1; else hi = mid; }
    if (lo >= fs.length) continue; // plus aucune fermeture de ce nom après elle
    const fin = fs[lo];
    if (fin - debut > fenetre) continue;
    out.push([nom, texte.slice(debut, fin)]);
    apres = fin; reO.lastIndex = Math.max(reO.lastIndex, fin);
  }
  return out;
}

/** Un plan de site (sitemap) : ses pages (adresse, date) et les plans qu'il annonce (index). Linéaire, borné. Pur. */
export function lirePlan(xml: string, max = 50_000): { pages: Array<{ url: string; date?: number }>; plans: string[] } {
  const pages: Array<{ url: string; date?: number }> = [], plans: string[] = [];
  for (const [nom, corps] of elements(String(xml ?? ''), ['sitemap', 'url'], 4000, max)) {
    const loc = /<loc\b[^>]{0,100}>([^<]{1,2100})<\/loc>/i.exec(corps)?.[1] ?? /<loc\b[^>]{0,100}>\s*<!\[CDATA\[([\s\S]{1,2100}?)\]\]>\s*<\/loc>/i.exec(corps)?.[1];
    if (!loc) continue;
    const url = entite(loc);
    if (nom === 'sitemap') { if (plans.length < 200) plans.push(url); continue; }
    const date = dateDe(/<lastmod\b[^>]{0,100}>([^<]{1,60})<\/lastmod>/i.exec(corps)?.[1]);
    pages.push({ url, ...(date ? { date } : {}) });
  }
  return { pages, plans };
}

/** Un fil d'actualité (RSS ou Atom) : ses articles (adresse, date). Linéaire, borné. Pur. */
export function lireFil(xml: string, max = 500): Array<{ url: string; date?: number }> {
  const out: Array<{ url: string; date?: number }> = [];
  for (const [nom, corps] of elements(String(xml ?? ''), ['item', 'entry'], 20_000, max)) {
    if (out.length >= max) break;
    let url: string | undefined;
    if (nom === 'item') url = /<link\b[^>]{0,100}>([^<]{1,2100})<\/link>/i.exec(corps)?.[1] ?? /<link\b[^>]{0,100}>\s*<!\[CDATA\[([\s\S]{1,2100}?)\]\]>\s*<\/link>/i.exec(corps)?.[1];
    else {
      const liens = corps.match(/<link\b[^>]{0,2200}>/gi) ?? [];
      const l = liens.find((x) => /rel\s*=\s*["']alternate["']/i.test(x)) ?? liens.find((x) => !/rel\s*=/i.test(x)) ?? liens[0];
      url = l ? /href\s*=\s*["']([^"']{1,2100})["']/i.exec(l)?.[1] : undefined;
    }
    if (!url) continue;
    const date = dateDe(/<(pubDate|published|updated|dc:date)\b[^>]{0,100}>([^<]{1,60})<\//i.exec(corps)?.[2]);
    out.push({ url: entite(url), ...(date ? { date } : {}) });
  }
  return out;
}

/** Ce que disent les consignes des robots d'un site, en clair. Pur. */
export function resumerConsignes(r: ReglesSite): string {
  const delai = r.delaiS ? ` ; il demande ${r.delaiS} s entre deux pages` : '';
  if (r.tout === 'permis') return `aucune interdiction pour les robots${delai}`;
  if (r.tout === 'interdit') return 'le site interdit tout aux robots (ou ses consignes sont illisibles)';
  const interdits = r.regles.filter((x) => !x.permis).map((x) => x.chemin);
  if (!interdits.length) return `aucune interdiction pour les robots${delai}`;
  return `le site interdit aux robots ${interdits.slice(0, 6).join(', ')}${interdits.length > 6 ? ` et ${interdits.length - 6} autre(s)` : ''}${delai}`;
}

/** Les adresses en file, rangées : les articles d'abord, les plus récents d'abord. Pur. */
export const ranger = (f: AdresseEnFile[]): AdresseEnFile[] => [...f].sort((a, b) => Number(b.article) - Number(a.article) || (b.date ?? 0) - (a.date ?? 0));

// ------------------------------------------------------------------ le registre et le travail

export interface DepsAbsorbeur {
  magasin: Magasin;
  lecteur: Pick<Lecteur, 'lire' | 'consignes'>;
  robot: Pick<Robot, 'visiter' | 'etats'>;
  journal: Journal;
  reglages: () => Reglages;
  interdits: () => Interdits;
  maintenant: () => number;
  garde: () => RaisonArret | undefined;
  /** Apprendre d'une page lue (recoupement, mémoire, journal). Rend le nombre de faits retenus. */
  apprendre: (page: PageLue) => number;
}

export interface BilanAbsorption { pages: number; faits: number; decouvertes: number; arret?: RaisonArret }

export class Absorbeur {
  private readonly d: DepsAbsorbeur;
  constructor(d: DepsAbsorbeur) { this.d = d; }

  // -------------------------------------------------------------- registre
  // Le registre (« absorber ») ne garde que la fiche de chaque site, petite ; sa FILE et ses adresses connues vont dans
  // une collection À LUI (« site:<nom> »). Écrire le travail d'un site ne réécrit donc jamais les autres (constat 4).
  private registre(): Record<string, SiteAbsorbe> {
    const r = this.d.magasin.lire<Record<string, SiteAbsorbe>>('absorber', {});
    // Ancienne forme (file dans le registre, adresses connues dans « absorberConnues ») : déplacée une fois.
    if (Object.values(r).some((x) => Array.isArray((x as { file?: unknown }).file) && (x.file as AdresseEnFile[]).length >= 0 && x.restantes === undefined)) {
      const anciennes = this.d.magasin.lire<Record<string, string[]>>('absorberConnues', {});
      const neuf: Record<string, SiteAbsorbe> = {};
      for (const [id, x] of Object.entries(r)) {
        const file = Array.isArray(x.file) ? x.file : [];
        this.d.magasin.ecrire(collSite(id), { file, connues: (anciennes[id] ?? []).map((u) => (u.length > 12 ? empreinteAdresse(u) : u)) } satisfies DocSite);
        neuf[id] = fiche({ ...x, file });
      }
      this.d.magasin.ecrire('absorber', neuf);
      if (Object.keys(anciennes).length) this.d.magasin.ecrire('absorberConnues', {});
      return neuf;
    }
    return r;
  }
  private doc(id: string): DocSite { return this.d.magasin.lire<DocSite>(collSite(id), { file: [], connues: [] }); }
  /** Les sites, avec leur file (lue dans leur collection). */
  private tous(): Record<string, SiteAbsorbe> {
    const out: Record<string, SiteAbsorbe> = {};
    for (const [id, x] of Object.entries(this.registre())) out[id] = { ...x, file: this.doc(id).file };
    return out;
  }
  /** Écrit la FICHE d'un site (jamais sa file : elle vit dans sa propre collection). */
  private ecrire(s: SiteAbsorbe): void { this.d.magasin.ecrire('absorber', { ...this.registre(), [s.id]: fiche(s) }); }
  /** Les adresses connues d'un site, en empreintes courtes (11 caractères au lieu de l'adresse entière). */
  private connues(id: string): Connues { return new Connues(this.doc(id).connues); }
  /**
   * Écrit le travail d'un passage SANS écraser ce que le propriétaire a décidé pendant ce temps : un site retiré n'est
   * pas réécrit ; une pause (ou une reprise), son plafond et son état « refusé » sont gardés. La file et les adresses
   * connues du site sont écrites une fois, dans SA collection.
   */
  private fusionner(s: SiteAbsorbe, connues?: Connues): boolean {
    const cur = this.registre()[s.id];
    if (!cur) return false;
    const pause = cur.etat === 'en-pause';
    this.ecrire({ ...s, pagesParJour: cur.pagesParJour, ...(pause ? { etat: 'en-pause', avantPause: s.etat === 'en-pause' ? cur.avantPause : s.etat } : {}) });
    this.d.magasin.ecrire(collSite(s.id), { file: s.file, connues: (connues ? connues.liste() : this.doc(s.id).connues).slice(-CONNUES_MAX) } satisfies DocSite);
    if (connues) connues.change = false;
    return true;
  }
  /** Le site est-il encore à lire (pas retiré, pas mis en pause entre-temps) ? */
  private toujoursActif(id: string): boolean { const c = this.tous()[id]; return Boolean(c && c.etat !== 'en-pause' && c.etat !== 'refuse'); }
  liste(): SiteAbsorbe[] { return Object.values(this.tous()).sort((a, b) => a.ajoute - b.ajoute); }
  /** Le site d'une adresse ou d'un nom (« exemple.org », « https://www.exemple.net/… »). */
  trouver(adresse: string): SiteAbsorbe | undefined {
    const brut = String(adresse ?? '').trim();
    let hote = brut;
    try { hote = new URL(/^https?:\/\//i.test(brut) ? brut : `https://${brut}`).hostname; } catch { /* nom brut */ }
    return this.tous()[cleSite(hote)];
  }
  /** Les pages restant à lire (file). */
  restantes(s: SiteAbsorbe): number { return s.file.length; }
  /** Le plafond de pages par jour d'un site (le sien, sinon celui des réglages). */
  plafond(s: SiteAbsorbe): number { return s.pagesParJour ?? this.d.reglages().robot.pagesParSiteAbsorber; }
  /** L'attente réelle entre deux pages de ce site (ms) : le réglage, jamais moins que ce que le site demande. */
  attente(s: SiteAbsorbe): number { return Math.max(this.d.reglages().robot.delaiSiteMs, Math.min(86_400, s.delaiS ?? 0) * 1000); }
  /** Les pages lues au plus par passage (le passage tient dans ses 14 minutes, au rythme du réglage). */
  pagesParPassage(): number { return Math.max(10, Math.floor(PASSAGE_MS / this.d.reglages().robot.delaiSiteMs)); }
  /** Les adresses en file, tous sites confondus (la borne de place). */
  enFileTotal(): number { return Object.values(this.registre()).reduce((n, x) => n + (x.restantes ?? 0), 0); }
  /**
   * L'estimation à jour : le temps pour lire ce qui reste, à ce rythme (attente du site, plafond du jour du site, pages
   * du jour de Mathésis, un passage de 14 minutes toutes les 15). En heures tant que c'est moins de deux jours.
   */
  estimation(s: SiteAbsorbe): { heures: number; texte: string } | undefined {
    const reste = s.file.length; if (!reste) return undefined;
    const parHeure = Math.max(1, Math.floor((3_600_000 / this.attente(s)) * (PASSAGE_MS / 900_000)));
    const parJour = Math.max(1, Math.min(this.plafond(s), this.d.reglages().budgets.pages, parHeure * 24));
    // Le plafond du jour plus bas que ce que les heures permettent : on lit `parJour` pages, puis on attend le lendemain.
    const heures = parJour >= parHeure * 24 ? reste / parHeure : Math.floor((reste - 1) / parJour) * 24 + (((reste - 1) % parJour) + 1) / parHeure;
    const texte = heures < 1 ? 'moins d\'une heure' : heures < 48 ? `environ ${Math.ceil(heures)} heure(s)` : `environ ${Math.ceil(heures / 24)} jour(s)`;
    return { heures, texte };
  }

  /** Où en est un site, en une phrase. */
  phrase(s: SiteAbsorbe): string {
    const reste = s.file.length, est = this.estimation(s);
    if (s.etat === 'refuse') return `${s.id} : refusé — ${s.raison ?? 'le site interdit les robots'}.`;
    if (s.etat === 'en-pause') return `${s.id} : en pause (${s.lues} page(s) lue(s), ${reste} restante(s)).`;
    if (s.absorbeLe) return `${s.id} : déjà absorbé le ${dateCourte(s.absorbeLe)} (${s.lues} page(s) lue(s), ${s.faits} fait(s) appris) ; je suis ses nouveautés${reste ? ` (${reste} nouvelle(s) page(s) à lire)` : ''}.`;
    if (!s.decouvert && !reste) return `${s.id} : ajouté, pas encore exploré (je commence au prochain passage).`;
    return `${s.id} : en cours — ${s.lues} lue(s) sur ${s.lues + reste} connue(s), ${reste} restante(s) ; à ce rythme, ${est?.texte ?? 'presque fini'}.`;
  }

  /**
   * Ajoute un site à absorber (ou dit où il en est s'il est déjà dans la liste). Contrôle la forme de l'adresse (publique,
   * sans identifiants, port usuel) et les interdits du propriétaire. Ne lit rien : la découverte vient ensuite.
   */
  ajouter(adresse: string, par: 'page' | 'discussion'): { ok: true; site: SiteAbsorbe; deja: boolean } | { ok: false; raison: string } {
    const brut = String(adresse ?? '').trim().replace(/[.,;:!?»)]+$/, '');
    if (!brut) return { ok: false, raison: 'quelle adresse ?' };
    const ctl = controlerForme(/^https?:\/\//i.test(brut) ? brut : `https://${brut}`);
    if (!ctl.ok) return { ok: false, raison: ctl.raison };
    if (siteInterdit(this.d.interdits(), ctl.url.toString())) return { ok: false, raison: 'ce site est dans tes interdits' };
    const id = cleSite(ctl.url.hostname);
    const tous = this.tous();
    if (tous[id]) return { ok: true, site: tous[id], deja: true };
    if (Object.keys(tous).length >= SITES_MAX) return { ok: false, raison: `${SITES_MAX} sites au plus dans la liste` };
    const chemin = ctl.url.pathname.replace(/\/+$/, '');
    const s: SiteAbsorbe = {
      id, racine: `${ctl.url.origin}${chemin}`, ajoute: this.d.maintenant(), par, etat: 'a-explorer', plans: [], fils: [], fraicheurs: {},
      file: [], connues: 0, lues: 0, refusees: 0, erreurs: 0, faits: 0, decouvert: false,
    };
    this.ecrire(s);
    this.d.journal.noter({ genre: 'recherche', quoi: `site à absorber ajouté : ${id} (${par === 'discussion' ? 'dit dans la discussion' : 'depuis la page'})`, source: id });
    return { ok: true, site: s, deja: false };
  }
  pause(id: string): boolean { const s = this.tous()[id]; if (!s || s.etat === 'en-pause') return false; this.ecrire({ ...s, avantPause: s.etat, etat: 'en-pause' }); return true; }
  reprendre(id: string): boolean { const s = this.tous()[id]; if (!s || s.etat !== 'en-pause') return false; this.ecrire({ ...s, etat: s.avantPause ?? 'a-explorer', avantPause: undefined }); return true; }
  retirer(id: string): boolean {
    const t = { ...this.registre() }; if (!t[id]) return false; delete t[id]; this.d.magasin.ecrire('absorber', t);
    this.d.magasin.ecrire(collSite(id), { file: [], connues: [] } satisfies DocSite);
    return true;
  }
  /** Le plafond de pages par jour d'un site, ramené dans les bornes (1 à 10 000 000). */
  regler(id: string, pagesParJour: number): SiteAbsorbe | undefined {
    const s = this.tous()[id]; if (!s) return undefined;
    const n = Math.max(1, Math.min(PAGES_SITE_MAX, Math.floor(Number(pagesParJour) || 0)));
    const x = { ...s, pagesParJour: n }; this.ecrire(x); return x;
  }

  /**
   * L'aperçu à l'ajout : les consignes du site (refus net s'il interdit tout aux robots) et son premier plan (combien de
   * pages). Deux ou trois demandes au plus, avec le délai normal ; rien si la garde ne le permet pas (coupé, pause,
   * occupé, privé) — la découverte se fera alors au prochain passage.
   */
  async apercu(id: string, signal?: AbortSignal): Promise<{ lu: boolean; refuse?: string }> {
    const s0 = this.tous()[id]; if (!s0) return { lu: false };
    if (this.d.garde()) return { lu: false };
    const s: SiteAbsorbe = { ...s0, file: [...s0.file], fraicheurs: { ...s0.fraicheurs } };
    const racine = new URL(s.racine);
    const regles = await this.d.lecteur.consignes(racine.origin, signal);
    if (typeof regles === 'string') return { lu: false };
    s.consignes = resumerConsignes(regles); s.delaiS = regles.delaiS;
    if (regles.tout === 'interdit' || !permis(regles, racine.pathname || '/')) {
      const raison = 'le site interdit les robots (ses consignes, robots.txt) ; tu peux le lire toi-même';
      this.ecrire({ ...s, etat: 'refuse', raison, decouvert: true });
      this.d.journal.noter({ genre: 'refus', quoi: `site à absorber refusé : ${id}`, pourquoi: raison, source: id });
      return { lu: true, refuse: raison };
    }
    const connues = this.connues(id);
    const plans = (regles.plans ?? []).filter((p) => { try { return cleSite(new URL(p).hostname) === id; } catch { return false; } });
    const aLire = plans.length ? [plans[0]] : [`${racine.origin}/sitemap.xml`];
    for (let k = 0; k < 2 && aLire.length; k++) {
      const p = aLire.shift()!;
      const x = await this.lireXml(s, p, signal);
      if (typeof x !== 'string') break;
      if (!s.plans.includes(p)) s.plans = [...s.plans, p].slice(-200);
      const lu = lirePlan(x);
      this.verser(s, connues, lu.pages, regles);
      // Un index de plans : on lit le premier plan qu'il annonce (souvent le plus utile) pour donner un ordre d'idée.
      if (!lu.pages.length && lu.plans.length) aLire.push(lu.plans[0]);
      // Les autres plans de l'index attendent la découverte (pas redemandés : l'index vient d'être lu).
      const autres = lu.plans.filter((q) => { try { return cleSite(new URL(q).hostname) === id; } catch { return false; } }).slice(1, 201);
      if (autres.length) s.plansAVoir = [...new Set([...(s.plansAVoir ?? []), ...autres])].slice(0, 200);
    }
    s.plansAVoir = (s.plansAVoir ?? []).filter((q) => !s.plans.includes(q));
    s.file = ranger(s.file);
    this.fusionner(s, connues);
    return { lu: true };
  }

  // -------------------------------------------------------------- découverte
  /** Ajoute des adresses à la file d'un site : même site, sous la racine, permises par les consignes, jamais deux fois. */
  private verser(s: SiteAbsorbe, connues: Connues, items: Array<{ url: string; date?: number }>, regles: ReglesSite | undefined): number {
    const racine = new URL(s.racine);
    const etats = this.d.robot.etats();
    const enFile = new Set(s.file.map((x) => x.url));
    let n = 0;
    // La borne de place, tous sites confondus (ce site compté avec sa file en cours, pas avec celle enregistrée).
    let place = FILE_TOTAL_MAX - (this.enFileTotal() - (this.registre()[s.id]?.restantes ?? 0)) - s.file.length;
    for (const it of items) {
      const url = normaliserAdresse(it.url);
      if (!url) continue;
      const u = new URL(url);
      if (cleSite(u.hostname) !== s.id || !u.pathname.startsWith(racine.pathname || '/')) continue;
      if (u.protocol === 'http:' && racine.protocol === 'https:') continue;
      // Les pages de commentaires d'un article ne sont pas lues (l'article l'est).
      if (/\/comment-page-\d+\/?$/i.test(u.pathname)) continue;
      if (siteInterdit(this.d.interdits(), url)) continue;
      if (regles && !permis(regles, u.pathname + u.search)) { if (!connues.has(url)) { connues.add(url); s.refusees++; } continue; }
      if (connues.has(url)) {
        // Déjà connue : relue seulement si sa date (plan, fil) est plus récente que notre dernière visite.
        const e = etats[url];
        if (s.file.length < FILE_MAX && place > 0 && it.date && e && it.date > e.derniereVisiteMs && !enFile.has(url)) { s.file.push({ url, date: it.date, article: estArticle(url) }); enFile.add(url); n++; place--; }
        continue;
      }
      // Plus de place : l'adresse n'est pas notée comme connue, elle revient au plan suivant (rien n'est perdu).
      if (s.file.length >= FILE_MAX || place <= 0) break;
      connues.add(url);
      s.file.push({ url, ...(it.date ? { date: it.date } : {}), article: estArticle(url) });
      enFile.add(url);
      n++; place--;
    }
    s.connues = connues.size;
    return n;
  }

  /** Lit un document XML (plan, fil) poliment ; rend son texte, ou rien (inchangé, refusé), ou un arrêt. */
  private async lireXml(s: SiteAbsorbe, url: string, signal?: AbortSignal): Promise<string | undefined | { arret: RaisonArret }> {
    // Un plan ou un fil lu il y a moins d'une heure (à l'aperçu, par exemple) n'est pas redemandé (vu sur un vrai site).
    const vu = s.xmlLuA?.[url];
    if (vu && this.d.maintenant() - vu < 3_600_000) return undefined;
    s.xmlLuA = { ...(s.xmlLuA ?? {}), [url]: this.d.maintenant() };
    const vus = Object.keys(s.xmlLuA); if (vus.length > 250) for (const k of vus.slice(0, vus.length - 250)) delete s.xmlLuA[k];
    const r = await this.d.lecteur.lire(url, { xml: true, conditionnel: s.fraicheurs[url], signal, plafondSite: this.plafond(s) });
    if (r.genre === 'arret') return { arret: r.raison as RaisonArret };
    if (r.genre === 'inchange') return undefined;
    if (r.genre !== 'lu') return undefined;
    s.fraicheurs[url] = r.page.fraicheur;
    const cles = Object.keys(s.fraicheurs); if (cles.length > 50) for (const k of cles.slice(0, cles.length - 50)) delete s.fraicheurs[k];
    return r.page.texte;
  }

  /** Découvre (ou redécouvre, en suivi) les pages d'un site : consignes, plan, page d'accueil, fils. */
  async decouvrir(id: string, signal?: AbortSignal): Promise<{ nouvelles: number; arret?: RaisonArret; refuse?: string }> {
    const s0 = this.tous()[id]; if (!s0) return { nouvelles: 0 };
    const s: SiteAbsorbe = { ...s0, file: [...s0.file], fraicheurs: { ...s0.fraicheurs } };
    const racine = new URL(s.racine);
    const regles = await this.d.lecteur.consignes(racine.origin, signal);
    if (typeof regles === 'string') return { nouvelles: 0, arret: regles as RaisonArret };
    s.consignes = resumerConsignes(regles); s.delaiS = regles.delaiS;
    if (regles.tout === 'interdit' || !permis(regles, racine.pathname || '/')) {
      const raison = 'le site interdit les robots (ses consignes, robots.txt) : je ne peux pas l\'absorber ; tu peux le lire toi-même';
      this.ecrire({ ...s, etat: 'refuse', raison, decouvert: true });
      this.d.journal.noter({ genre: 'refus', quoi: `site à absorber refusé : ${id}`, pourquoi: raison, source: id });
      return { nouvelles: 0, refuse: raison };
    }
    const connues = this.connues(id);
    let nouvelles = 0, arret: RaisonArret | undefined;
    // 1. Le plan du site (annoncé dans les consignes, sinon à la racine), en suivant un index de plans.
    const plans = (regles.plans ?? []).filter((p) => { try { return cleSite(new URL(p).hostname) === id; } catch { return false; } });
    // D'abord les plans pas encore lus (annoncés par un index à une découverte précédente), puis ceux des consignes.
    const aLire = [...(s.plansAVoir ?? []), ...(plans.length ? plans : [`${racine.origin}/sitemap.xml`])];
    const vus = new Set<string>();
    let lus = 0, joint = false; // joint : au moins un document du site a été lu à cette découverte
    while (aLire.length && lus < PLANS_PAR_DECOUVERTE && !arret) {
      const p = aLire.shift()!;
      if (vus.has(p)) continue; vus.add(p); lus++;
      const x = await this.lireXml(s, p, signal);
      if (x && typeof x === 'object') { arret = x.arret; break; }
      if (typeof x !== 'string') continue;
      joint = true;
      if (!s.plans.includes(p)) s.plans = [...s.plans, p].slice(-200);
      const lu = lirePlan(x);
      // Les plans les plus récents d'abord (souvent les articles) : on ne lit que les premiers à chaque découverte.
      for (const q of lu.plans.filter((q) => { try { return cleSite(new URL(q).hostname) === id; } catch { return false; } }).slice(0, 50)) if (!vus.has(q)) aLire.push(q);
      nouvelles += this.verser(s, connues, lu.pages, regles);
    }
    // Les plans annoncés pas encore lus attendent la découverte suivante (dans une heure).
    s.plansAVoir = [...new Set(aLire.filter((q) => !vus.has(q) && !plans.includes(q) && !s.plans.includes(q)))].slice(0, 200);
    // 2. La page d'accueil (ou de départ) : ses fils d'actualité et ses liens du même site.
    if (!arret && (!s.decouvert || !s.fils.length)) {
      const r = await this.d.robot.visiter(s.racine, s.racine, { signal, plafondSite: this.plafond(s) });
      if (r.genre === 'arret') arret = r.raison;
      else if (r.genre === 'lu') {
        joint = true;
        // Le fil des COMMENTAIRES n'est pas un fil d'articles (vu sur un vrai site) : laissé.
        s.fils = [...new Set([...s.fils, ...(r.page.fils ?? []).filter((f) => { try { const u = new URL(f); return cleSite(u.hostname) === id && !/\/comments?\//i.test(u.pathname); } catch { return false; } })])].slice(0, 5);
        if (!r.page.nofollow) nouvelles += this.verser(s, connues, r.page.liens.map((l) => ({ url: l.url })), regles);
      }
    }
    // 3. Les fils d'actualité (les nouveautés, datées).
    for (const f of s.fils.filter((x) => !/\/comments?\//i.test(x)).slice(0, FILS_PAR_DECOUVERTE)) {
      if (arret) break;
      const x = await this.lireXml(s, f, signal);
      if (x && typeof x === 'object') { arret = x.arret; break; }
      if (typeof x === 'string') { joint = true; nouvelles += this.verser(s, connues, lireFil(x), regles); }
    }
    // Rien de lu (site en panne, plan et accueil indisponibles) à la PREMIÈRE découverte : pas « découvert », on réessaie
    // dans une heure (sinon une file vide le ferait passer pour « déjà absorbé »).
    if (!arret && !s.decouvert && !joint) {
      s.erreurs++; s.prochaineDecouverte = this.d.maintenant() + 3_600_000; s.derniereVisite = this.d.maintenant();
      this.d.journal.noter({ genre: 'recherche', quoi: `${id} injoignable pour l'instant (ni plan, ni page d'accueil) : nouvel essai dans une heure`, source: id });
      this.fusionner(s, connues);
      return { nouvelles: 0 };
    }
    if (!arret) {
      const premier = !s.decouvert;
      s.decouvert = true;
      s.prochaineDecouverte = this.d.maintenant() + (s.plansAVoir?.length ? 3_600_000 : SUIVI_MS);
      if (s.etat === 'a-explorer') s.etat = 'en-cours';
      if (nouvelles && s.absorbeLe) { s.etat = 'en-suivi'; s.derniereNouveaute = this.d.maintenant(); }
      s.file = ranger(s.file);
      this.d.journal.noter({ genre: 'recherche', quoi: premier
        ? `a exploré ${id} : ${s.connues} page(s) connue(s) (plan du site : ${s.plans.length ? 'oui' : 'non'} ; fil d'actualité : ${s.fils.length ? 'oui' : 'non'}) ; ${s.consignes}`
        : `a revu le plan et les fils de ${id} : ${nouvelles} page(s) nouvelle(s) ou changée(s)`, source: id });
    }
    s.derniereVisite = this.d.maintenant();
    this.fusionner(s, connues);
    return { nouvelles, ...(arret ? { arret } : {}) };
  }

  // -------------------------------------------------------------- lecture
  /** Lit jusqu'à `n` pages des sites à absorber (les sites dans l'ordre d'ajout). Ne lève jamais. */
  async passer(n: number, signal?: AbortSignal): Promise<BilanAbsorption> {
    const bilan: BilanAbsorption = { pages: 0, faits: 0, decouvertes: 0 };
    try {
      for (const s0 of this.liste()) {
        if (bilan.pages >= n || bilan.arret) break;
        if (s0.etat === 'en-pause' || s0.etat === 'refuse') continue;
        const g = this.d.garde(); if (g) { bilan.arret = g; break; }
        if (!s0.decouvert && (s0.prochaineDecouverte ?? 0) > this.d.maintenant()) continue; // injoignable : plus tard
        if (!s0.decouvert || (s0.prochaineDecouverte ?? 0) <= this.d.maintenant()) {
          const dcv = await this.decouvrir(s0.id, signal);
          bilan.decouvertes++;
          if (dcv.arret) { bilan.arret = dcv.arret; break; }
          if (dcv.refuse) continue;
        }
        await this.lireSite(s0.id, n - bilan.pages, bilan, signal);
      }
    } catch { /* jamais bloquant : le bilan dit ce qui a été fait */ }
    return bilan;
  }

  private async lireSite(id: string, n: number, bilan: BilanAbsorption, signal?: AbortSignal): Promise<void> {
    const s0 = this.tous()[id]; if (!s0) return;
    const s: SiteAbsorbe = { ...s0, file: [...s0.file] };
    const connues = this.connues(id);
    let lus = 0;
    while (s.file.length && lus < n) {
      if (!this.toujoursActif(id)) break; // retiré ou mis en pause pendant le passage
      const x = s.file.shift()!;
      const r = await this.d.robot.visiter(x.url, x.url, { signal, plafondSite: this.plafond(s) });
      if (r.genre === 'arret') { s.file.unshift(x); bilan.arret = r.raison; break; }
      if (r.genre === 'saute' && /plafond du jour/.test(r.raison)) { s.file.unshift(x); break; } // demain
      if (r.genre === 'saute' && /site en pause/.test(r.raison)) { s.file.unshift(x); break; }   // le site a demandé de ralentir
      lus++;
      if (r.genre === 'lu') {
        s.lues++; bilan.pages++;
        if (r.neuf) { const f = this.d.apprendre(r.page); s.faits += f; bilan.faits += f; if (s.absorbeLe) s.derniereNouveaute = this.d.maintenant(); }
        if (!r.page.nofollow) this.verser(s, connues, r.page.liens.map((l) => ({ url: l.url })), undefined);
      } else if (r.genre === 'inchange' || r.genre === 'pas-due') s.dejaVues = (s.dejaVues ?? 0) + 1; // déjà lue (pas relue) : comptée à part
      else if (r.genre === 'refus' || (r.genre === 'saute' && /consignes des robots/.test(r.raison))) s.refusees++;
      else s.erreurs++;
      s.derniereVisite = this.d.maintenant();
    }
    if (!s.file.length && s.decouvert && !s.absorbeLe && s.lues + (s.dejaVues ?? 0) > 0 && s.etat !== 'en-pause' && s.etat !== 'refuse' && this.toujoursActif(id)) {
      s.absorbeLe = this.d.maintenant(); s.etat = 'en-suivi';
      this.d.journal.noter({ genre: 'retenu', quoi: `a absorbé ${id} : ${s.lues} page(s) lue(s), ${s.faits} fait(s) appris ; je suis maintenant ses nouveautés`, source: id });
    }
    s.file = ranger(s.file);
    this.fusionner(s, connues);
  }

  /** En une ligne, pour le journal ou la discussion. */
  static resume(b: BilanAbsorption): string { return `${b.pages} page(s) de sites à absorber lue(s), ${b.faits} fait(s) appris`; }
}

/** La collection d'un site (sa file et ses adresses connues). */
const collSite = (id: string): Collection => `site:${id}` as Collection;
/** Ce que la collection d'un site garde. */
interface DocSite { file: AdresseEnFile[]; connues: string[] }
/** La fiche d'un site dans le registre : tout SAUF sa file (remplacée par le nombre de pages restantes). */
function fiche(s: SiteAbsorbe): SiteAbsorbe { const { file, ...reste } = s; return { ...reste, restantes: file?.length ?? reste.restantes ?? 0 } as SiteAbsorbe; }

/** L'empreinte courte d'une adresse (FNV-1a 64 bits, en base 36). Pur. */
export function empreinteAdresse(url: string): string {
  let h = 0xcbf29ce484222325n;
  for (let i = 0; i < url.length; i++) { h ^= BigInt(url.charCodeAt(i)); h = (h * 0x100000001b3n) & 0xffffffffffffffffn; }
  return h.toString(36).padStart(11, '0').slice(-11);
}
/** Les adresses connues d'un site (empreintes) : on sait si quelque chose a changé, pour n'écrire qu'alors. */
export class Connues {
  private s: Set<string>;
  change = false;
  constructor(e: string[]) { this.s = new Set(e); }
  has(url: string): boolean { return this.s.has(empreinteAdresse(url)); }
  add(url: string): void { const k = empreinteAdresse(url); if (!this.s.has(k)) { this.s.add(k); this.change = true; } }
  get size(): number { return this.s.size; }
  liste(): string[] { return [...this.s]; }
}

/** Le texte d'une adresse pour un tableau étroit (sans « https:// », coupé au milieu). */
export const adresseCourte = (u: string, max = 40): string => court(u.replace(/^https?:\/\//, ''), max);
