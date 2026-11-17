// Mathésis — le lecteur poli du robot : la SEULE porte par laquelle Mathésis lit le web.
//
// LECTURE SEULE, par construction :
//  - deux méthodes seulement, GET et HEAD (aucun corps envoyé, aucun formulaire, aucune connexion) ;
//  - un nom de robot fixe et honnête, aucun cookie envoyé ni gardé, aucun référent, aucune session ;
//  - chaque adresse ET chaque redirection repasse tous les contrôles (adresse publique, site interdit, site en pause,
//    consignes des robots, plafond du site, budget, délai poli) ;
//  - une page qui refuse (401, 403, 407, 429, 451, vérification anti-robot, redirection vers une connexion) est
//    laissée et notée, et le site est mis en PAUSE : on n'insiste pas, on ne contourne rien ;
//  - tout est borné : taille (et budget d'octets du jour), délai, redirections ; seul du texte ou du HTML est lu.
// Le texte d'une page est une DONNÉE : le lecteur ne l'exécute, ne l'interprète ni ne le suit jamais comme une consigne.
import http from 'node:http';
import https from 'node:https';
import { Readable } from 'node:stream';
import type { LookupFunction } from 'node:net';
import { normalizeDate } from '../../research/fetch.ts';
import { siteOf } from '../../research/sources.ts';
import { controlerAdresse, lookupGarde } from './adresses.ts';
import { AGENT_ROBOT, consignesDeStatut, permis, TOUT_INTERDIT, type ReglesSite } from './robots.ts';
import type { Budget } from './budget.ts';
import type { Magasin } from './magasin.ts';
import { siteInterdit } from './interdits.ts';
import { empreinteContenu } from './outils.ts';
import type { Fraicheur, Interdits, PageLue, RaisonArret, Reglages, Resolveur, ResultatLecture, Temps, Transport } from './types.ts';

/** Les seules méthodes que le robot connaît. */
export const METHODES = ['GET', 'HEAD'] as const;

/** Le transport système : node:http(s), connexion revérifiée au moment même (lookupGarde), sans réutilisation. */
export const transportSysteme: Transport = (url, init) => new Promise<Response>((ok, ko) => {
  if (!(METHODES as readonly string[]).includes(init.method)) { ko(new Error(`méthode refusée : ${String(init.method)}`)); return; }
  let u: URL;
  try { u = new URL(url); } catch { ko(new Error('adresse illisible')); return; }
  const mod = u.protocol === 'https:' ? https : u.protocol === 'http:' ? http : undefined;
  if (!mod) { ko(new Error('schéma refusé')); return; }
  const req = mod.request(u, { method: init.method, headers: init.headers, agent: false, lookup: lookupGarde() as unknown as LookupFunction, signal: init.signal }, (res) => {
    const h = new Headers();
    for (const [k, v] of Object.entries(res.headers)) {
      if (v === undefined || k === 'set-cookie') continue; // jamais de cookie gardé
      try { h.set(k, Array.isArray(v) ? v.join(', ') : String(v)); } catch { /* en-tête illisible : ignoré */ }
    }
    const st = res.statusCode ?? 0;
    try {
      if (init.method === 'HEAD' || st === 204 || st === 304 || (st >= 300 && st < 400)) { res.resume(); ok(new Response(null, { status: st, headers: h })); return; }
      ok(new Response(Readable.toWeb(res) as unknown as ReadableStream, { status: st, headers: h }));
    } catch (e) { res.destroy(); ko(e as Error); }
  });
  req.on('error', ko);
  req.end();
});

/** Les marques d'une vérification anti-robot ou d'un blocage : la page est laissée, le site mis en pause. */
const DEFI = /captcha|cf-chl|challenge-platform|verify (that )?you are (a )?human|v[ée]rifi(ez|cation) que vous [êe]tes (un )?humain|just a moment\.\.\.|attention required|are you a robot|[êe]tes-vous un robot|unusual traffic|trafic inhabituel|enable javascript and cookies to continue/i;
/** Une redirection vers une page de connexion : refus (on ne se connecte jamais). */
const CONNEXION = /\/(login|log-in|signin|sign-in|sign_in|connexion|se-connecter|identification|auth|oauth|sso|account\/login|compte\/connexion|session\/new)(\/|\?|$|\.)/i;
const TYPES_TEXTE = /^(text\/html|application\/xhtml\+xml|text\/plain)\b/i;

export const PAUSES = { refus: 24 * 3_600_000, limite: 3_600_000, panne: 3_600_000, maxi: 7 * 86_400_000 } as const;

export interface EtatSite { jusqua: number; raison: string; refus: number }

export interface OptionsLecteur {
  transport: Transport;
  resoudre: Resolveur;
  temps: Temps;
  budget: Budget;
  magasin: Magasin;
  reglages: () => Reglages;
  interdits: () => Interdits;
  /** La garde (interrupteur, pause, heures, occupé, abandon, privé), consultée avant CHAQUE demande. */
  garde: () => RaisonArret | undefined;
  /** Prévenu de chaque refus (journal). */
  surRefus?: (url: string, raison: string) => void;
}

/** Les indications de fraîcheur d'une réponse. */
export function fraicheurDe(h: Headers): Fraicheur {
  const f: Fraicheur = {};
  const etag = h.get('etag'); if (etag && etag.length <= 200) f.etag = etag;
  const lm = h.get('last-modified'); if (lm && !Number.isNaN(Date.parse(lm))) f.derniereModif = new Date(Date.parse(lm)).toUTCString();
  const cc = h.get('cache-control'); const m = cc ? /max-age=(\d+)/i.exec(cc) : null; if (m) f.maxAgeS = Math.min(Number(m[1]), 365 * 86_400);
  const ex = h.get('expires'); if (ex && !Number.isNaN(Date.parse(ex))) f.expire = new Date(Date.parse(ex)).toUTCString();
  return f;
}

const ent = (t: string) => t.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, '\'').replace(/&nbsp;/g, ' ');

/**
 * Les liens d'une page, avec leur texte, hors « nofollow ». Pur et LINÉAIRE : chaque balise est trouvée par indexOf
 * (jamais une recherche qui reparcourt tout le reste du document) ; le texte d'un lien est borné à 2 000 caractères et
 * s'arrête au lien suivant quand la balise n'est pas fermée ; le nombre de balises examinées est borné.
 */
export function liensDe(html: string, base: string, max: number): Array<{ url: string; texte: string }> {
  const out: Array<{ url: string; texte: string }> = [];
  const vus = new Set<string>();
  const bas = html.toLowerCase();
  let pos = 0, examinees = 0;
  while (out.length < max && examinees < Math.max(100, max * 20)) {
    const i = bas.indexOf('<a', pos);
    if (i < 0) break;
    pos = i + 2;
    const c = bas.charCodeAt(i + 2);
    if (!(c === 32 || c === 9 || c === 10 || c === 13 || c === 62)) continue; // <abbr>, <area>… : pas un lien
    examinees++;
    const fb = bas.slice(pos, pos + 4000).indexOf('>');
    if (fb < 0) continue; // balise démesurée ou jamais fermée : ignorée (fenêtre bornée, jamais tout le document)
    const finBalise = pos + fb;
    const attrs = html.slice(i + 2, finBalise);
    pos = finBalise + 1;
    if (/\brel\s*=\s*["'][^"']*nofollow/i.test(attrs)) continue;
    // href entre guillemets doubles ou simples, ou sans guillemets (jusqu'à l'espace ou la fin de la balise).
    const mh = /\bhref\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s"'>]+))/i.exec(attrs);
    const href = mh?.[1] ?? mh?.[2] ?? mh?.[3];
    if (!href) continue;
    // La fin du texte du lien est cherchée dans une fenêtre de 2 000 caractères seulement (jamais jusqu'au bout du document).
    const fenetre = bas.slice(pos, pos + 2000);
    const ferme = fenetre.indexOf('</a'), suivant = fenetre.indexOf('<a');
    const finTexte = pos + Math.min(ferme < 0 ? fenetre.length : ferme, suivant < 0 ? fenetre.length : suivant);
    let u: URL;
    try { u = new URL(ent(href.trim()), base); } catch { continue; }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') continue;
    u.hash = '';
    const s = u.toString();
    if (vus.has(s)) continue;
    vus.add(s);
    out.push({ url: s, texte: ent(html.slice(pos, finTexte).replace(/<[^>]{0,500}>/g, ' ')).replace(/\s+/g, ' ').trim().slice(0, 200) });
  }
  return out;
}

const SAUTER = ['title', 'script', 'style', 'noscript', 'template', 'svg', 'nav', 'header', 'footer', 'aside', 'form', 'iframe', 'select', 'button'];
const BLOCS = /^(p|br|li|div|tr|h[1-6]|section|article|blockquote|pre|td|dd|dt)\b/;
const entites = (t: string) => ent(t).replace(/&#(\d{1,7});/g, (_, n) => { const c = Number(n); return c > 0 && c <= 0x10ffff && !(c >= 0xd800 && c <= 0xdfff) ? String.fromCodePoint(c) : ' '; });

/**
 * Le titre, la date de publication et le texte d'une page HTML. Pur et LINÉAIRE (le texte d'une page est une donnée
 * hostile : jamais une expression qui reparcourt le reste du document pour chaque balise ouverte) : chaque balise est
 * trouvée par indexOf, les blocs à ignorer (scripts, menus, formulaires…) sautés jusqu'à leur fermeture ; l'en-tête
 * (titre, dates) n'est cherché que dans les 64 premiers Kio, avec des motifs bornés.
 */
export function texteDePage(html: string): { title: string; text: string; published?: string } {
  const tete = html.slice(0, 64 * 1024);
  const titre = entites(/<title[^>]{0,200}>([^<]{0,500})/i.exec(tete)?.[1] ?? '').replace(/\s+/g, ' ').trim();
  const date = /<meta[^>]{0,300}(?:article:published_time|datePublished|dc\.date)["'][^>]{0,300}content=["']([^"']{4,40})["']/i.exec(tete)?.[1]
    ?? /<meta[^>]{0,300}content=["']([^"']{4,40})["'][^>]{0,300}(?:article:published_time|datePublished)/i.exec(tete)?.[1]
    ?? /<time[^>]{0,200}datetime=["']([^"']{4,40})["']/i.exec(tete)?.[1];
  const bas = html.toLowerCase();
  const morceaux: string[] = [];
  let pos = 0, taille = 0;
  while (pos < html.length && taille < 400_000) {
    const lt = html.indexOf('<', pos);
    const bout = html.slice(pos, lt < 0 ? html.length : lt);
    morceaux.push(bout); taille += bout.length;
    if (lt < 0) break;
    const gt = html.indexOf('>', lt);
    if (gt < 0) break;
    const nom = /^\/?([a-z][a-z0-9]{0,15})/.exec(bas.slice(lt + 1, lt + 18))?.[1] ?? '';
    if (bas.charCodeAt(lt + 1) !== 47 && SAUTER.includes(nom)) {
      const fin = bas.indexOf(`</${nom}`, gt);
      if (fin < 0) break; // bloc jamais fermé : le reste n'est pas du texte lisible
      const finGt = html.indexOf('>', fin);
      pos = finGt < 0 ? html.length : finGt + 1;
      continue;
    }
    if (BLOCS.test(nom)) morceaux.push('\n');
    pos = gt + 1;
  }
  const text = entites(morceaux.join(' ')).replace(/[ \t ]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{2,}/g, '\n').trim().slice(0, 200_000);
  return { title: titre.slice(0, 300), text, ...(normalizeDate(date) ? { published: normalizeDate(date) } : {}) };
}

/** Les consignes de la page elle-même (balise meta robots et en-tête X-Robots-Tag). Pur. */
export function consignesPage(html: string, entete: string | null): { noindex: boolean; nofollow: boolean } {
  // Les balises meta sont dans l'en-tête : seuls les 64 premiers Kio sont regardés, chaque balise bornée (linéaire).
  const metas = [...html.slice(0, 64 * 1024).matchAll(/<meta\b[^>]{0,1000}>/gi)].map((m) => m[0]).filter((t) => /name\s*=\s*["'](robots|odinmathesis)["']/i.test(t)).map((t) => /content\s*=\s*["']([^"']*)["']/i.exec(t)?.[1] ?? '').join(',');
  const tout = `${metas},${entete ?? ''}`.toLowerCase();
  return { noindex: /\b(noindex|none)\b/.test(tout), nofollow: /\b(nofollow|none)\b/.test(tout) };
}

async function lireCorps(res: Response, max: number): Promise<{ octets: Buffer; n: number; depasse: boolean }> {
  if (!res.body) return { octets: Buffer.alloc(0), n: 0, depasse: false };
  const lecteur = res.body.getReader();
  const morceaux: Uint8Array[] = [];
  let n = 0;
  for (;;) {
    const { done, value } = await lecteur.read();
    if (done) break;
    n += value.byteLength;
    if (n > max) {
      // On garde ce qui tient dans la borne (les consignes des robots se lisent sur leurs 512 premiers Kio).
      morceaux.push(value.subarray(0, Math.max(0, max - (n - value.byteLength))));
      await lecteur.cancel().catch(() => undefined);
      return { octets: Buffer.concat(morceaux), n, depasse: true };
    }
    morceaux.push(value);
  }
  return { octets: Buffer.concat(morceaux), n, depasse: false };
}

/**
 * Le texte des consignes : en entier, ou ses 512 premiers Kio sans la dernière ligne coupée (une ligne coupée pourrait
 * raccourcir une règle Allow). Jamais un texte vide par accident ; une seule ligne démesurée = illisible = tout interdit.
 */
function texteConsignes(corps: { octets: Buffer; depasse: boolean }): string {
  const t = corps.octets.toString('utf8');
  if (!corps.depasse) return t;
  const coupe = t.lastIndexOf('\n');
  return coupe > 0 ? t.slice(0, coupe) : '\u0000';
}

function decoder(octets: Buffer, type: string): string {
  const cs = /charset=([\w-]+)/i.exec(type)?.[1] ?? /<meta[^>]+charset=["']?([\w-]+)/i.exec(octets.subarray(0, 2048).toString('latin1'))?.[1] ?? 'utf-8';
  try { return new TextDecoder(cs.toLowerCase()).decode(octets); } catch { return new TextDecoder('utf-8').decode(octets); }
}

export class Lecteur {
  private readonly o: OptionsLecteur;
  /** Prochain instant permis par hôte (délai poli). */
  private readonly prochain = new Map<string, number>();
  /** Demandes réellement envoyées (pour le journal et les essais). */
  readonly envoyees: Array<{ url: string; methode: 'GET' | 'HEAD'; at: number }> = [];
  constructor(o: OptionsLecteur) { this.o = o; }

  // ------------------------------------------------------------------ sites en pause
  private sites(): Record<string, EtatSite> { return this.o.magasin.lire<Record<string, EtatSite>>('sites', {}); }
  enPause(hote: string): EtatSite | undefined {
    const e = this.sites()[hote];
    return e && e.jusqua > this.o.temps.maintenant() ? e : undefined;
  }
  /** Met un site en pause (on n'insiste pas). Les refus répétés allongent la pause. */
  mettreEnPause(hote: string, raison: string, dureeMs: number): void {
    const s = { ...this.sites() };
    const avant = s[hote];
    const refus = (avant?.refus ?? 0) + 1;
    const duree = Math.min(PAUSES.maxi, dureeMs * Math.min(8, 2 ** (refus - 1)));
    s[hote] = { jusqua: this.o.temps.maintenant() + duree, raison: raison.slice(0, 200), refus };
    const cles = Object.keys(s); if (cles.length > 3000) for (const k of cles.slice(0, cles.length - 3000)) delete s[k];
    this.o.magasin.ecrire('sites', s);
    this.o.surRefus?.(hote, raison);
  }

  // ------------------------------------------------------------------ délai poli
  private async tour(hote: string, delaiS: number | undefined, signal?: AbortSignal): Promise<void> {
    const r = this.o.reglages().robot;
    const delai = Math.max(r.delaiSiteMs, Math.min(120, delaiS ?? 0) * 1000);
    // Le créneau est RÉSERVÉ avant d'attendre (deux lectures croisées ne prennent jamais le même) et gardé dans le
    // magasin : après un redémarrage, le délai est encore tenu.
    const now = this.o.temps.maintenant();
    const prochains = this.o.magasin.lire<Record<string, number>>('prochains', {});
    const creneau = Math.max(now, this.prochain.get(hote) ?? 0, prochains[hote] ?? 0);
    this.prochain.set(hote, creneau + delai);
    const neuf: Record<string, number> = { [hote]: creneau + delai };
    for (const [k, v] of Object.entries(prochains)) if (k !== hote && v > now) neuf[k] = v;
    this.o.magasin.ecrire('prochains', neuf);
    if (creneau > now) await this.o.temps.attendre(creneau - now, signal);
  }

  /** Une demande GET/HEAD, avec un délai maximal. Jamais de cookie. */
  private async demander(url: string, methode: 'GET' | 'HEAD', entetes: Record<string, string>, signal?: AbortSignal): Promise<Response> {
    if (!(METHODES as readonly string[]).includes(methode)) throw new Error('méthode refusée');
    const r = this.o.reglages().robot;
    const sig = signal ? AbortSignal.any([signal, AbortSignal.timeout(r.delaiDemandeMs)]) : AbortSignal.timeout(r.delaiDemandeMs);
    const headers: Record<string, string> = { 'user-agent': AGENT_ROBOT, accept: 'text/html,application/xhtml+xml,text/plain;q=0.9', 'accept-language': 'fr-FR,fr;q=0.9,en;q=0.5', ...entetes };
    delete headers.cookie; delete headers.authorization;
    this.envoyees.push({ url, methode, at: this.o.temps.maintenant() });
    return this.o.transport(url, { method: methode, headers, redirect: 'manual', signal: sig });
  }

  // ------------------------------------------------------------------ consignes des robots (cache 24 h)
  /** Les consignes d'un site (origine), lues au besoin. Rend « tout interdit » si elles ne peuvent pas être lues. */
  async consignes(origine: string, signal?: AbortSignal): Promise<ReglesSite | RaisonArret> {
    const now = this.o.temps.maintenant();
    const cache = this.o.magasin.lire<Record<string, { at: number; jusqua: number; regles: ReglesSite }>>('robots', {});
    const c = cache[origine];
    if (c && c.jusqua > now) return c.regles;
    const hote = new URL(origine).hostname;
    const g = this.o.garde(); if (g) return g;
    if (!this.o.budget.prendreSite(hote, this.o.reglages().robot.pagesParSiteJour)) return TOUT_INTERDIT;
    try { await this.tour(hote, undefined, signal); } catch { return 'abandon'; }
    const g2 = this.o.garde(); if (g2) return g2;
    let regles: ReglesSite = TOUT_INTERDIT, duree: number = PAUSES.panne;
    try {
      const res = await this.demander(`${origine}/robots.txt`, 'GET', {}, signal);
      if (res.status >= 300 && res.status < 400) {
        // Une redirection des consignes : on reste prudent (tout interdit), sauf vers le même site.
        const loc = res.headers.get('location');
        const cible = loc ? new URL(loc, origine) : undefined;
        if (cible && cible.hostname === hote && cible.pathname === '/robots.txt' && cible.protocol === 'https:') {
          const ctl = await controlerAdresse(cible.toString(), this.o.resoudre);
          if (ctl.ok) {
            const r2 = await this.demander(ctl.url.toString(), 'GET', {}, signal);
            const corps = await lireCorps(r2, 512 * 1024);
            this.o.budget.noter('octets', corps.n);
            ({ regles, dureeMs: duree } = consignesDeStatut(r2.status, texteConsignes(corps)));
          }
        }
      } else {
        const corps = await lireCorps(res, 512 * 1024);
        this.o.budget.noter('octets', corps.n);
        ({ regles, dureeMs: duree } = consignesDeStatut(res.status, texteConsignes(corps)));
      }
    } catch { regles = TOUT_INTERDIT; duree = PAUSES.panne; }
    const neuf = { ...cache, [origine]: { at: now, jusqua: now + duree, regles } };
    const cles = Object.keys(neuf); if (cles.length > 3000) for (const k of cles.slice(0, cles.length - 3000)) delete neuf[k];
    this.o.magasin.ecrire('robots', neuf);
    return regles;
  }

  /**
   * Lit une page publique. `conditionnel` = ce qu'on sait de la dernière visite (demande conditionnelle).
   * Ne lève jamais : rend « lu », « inchangé », « refus », « sauté » ou « arrêt ».
   */
  async lire(brut: string, o: { conditionnel?: Fraicheur; signal?: AbortSignal } = {}): Promise<ResultatLecture> {
    try { return await this.lireSansFilet(brut, o); }
    catch (e) { return o.signal?.aborted ? { genre: 'arret', raison: 'abandon' } : { genre: 'saute', url: brut, raison: `panne de lecture : ${String((e as Error)?.message ?? e).slice(0, 120)}` }; }
  }

  private async lireSansFilet(brut: string, o: { conditionnel?: Fraicheur; signal?: AbortSignal }): Promise<ResultatLecture> {
    const r = this.o.reglages().robot;
    let url = brut;
    for (let saut = 0; saut <= r.redirectionsMax; saut++) {
      const g = this.o.garde(); if (g) return { genre: 'arret', raison: g };
      const ctl = await controlerAdresse(url, this.o.resoudre);
      if (!ctl.ok) return { genre: 'saute', url, raison: ctl.raison };
      const u = ctl.url;
      url = u.toString();
      if (siteInterdit(this.o.interdits(), url)) return { genre: 'saute', url, raison: 'site interdit par toi' };
      const pause = this.enPause(u.hostname);
      if (pause) return { genre: 'saute', url, raison: `site en pause (${pause.raison})` };
      const regles = await this.consignes(u.origin, o.signal);
      if (typeof regles === 'string') return { genre: 'arret', raison: regles };
      if (!permis(regles, u.pathname + u.search)) return { genre: 'saute', url, raison: 'interdit par les consignes des robots du site' };
      const g2 = this.o.garde(); if (g2) return { genre: 'arret', raison: g2 };
      if (this.o.budget.restant('octets') <= 0) return { genre: 'arret', raison: 'budget' };
      // Le plafond du site d'abord : une page refusée par lui ne coûte rien au budget du jour.
      if (this.o.budget.restant('pages') < 1) return { genre: 'arret', raison: 'budget' };
      if (!this.o.budget.prendreSite(u.hostname, r.pagesParSiteJour)) return { genre: 'saute', url, raison: 'plafond du jour atteint pour ce site' };
      if (!this.o.budget.prendre('pages')) return { genre: 'arret', raison: 'budget' };
      try { await this.tour(u.hostname, regles.delaiS, o.signal); } catch { return { genre: 'arret', raison: 'abandon' }; }
      const g3 = this.o.garde(); if (g3) return { genre: 'arret', raison: g3 };

      const entetes: Record<string, string> = {};
      if (saut === 0 && o.conditionnel?.etag) entetes['if-none-match'] = o.conditionnel.etag;
      if (saut === 0 && o.conditionnel?.derniereModif) entetes['if-modified-since'] = o.conditionnel.derniereModif;
      let res: Response;
      try { res = await this.demander(url, 'GET', entetes, o.signal); }
      catch (e) {
        if (o.signal?.aborted) return { genre: 'arret', raison: 'abandon' };
        const prive = (e as NodeJS.ErrnoException)?.code === 'EODINPRIVE' || /adresse privée/.test(String((e as Error)?.message));
        if (prive) return { genre: 'saute', url, raison: 'le nom mène à une adresse privée (vérifié à la connexion)' };
        return { genre: 'saute', url, raison: 'site injoignable ou trop lent' };
      }
      const st = res.status;
      if (st >= 300 && st < 400 && st !== 304) {
        await res.body?.cancel().catch(() => undefined);
        const loc = res.headers.get('location');
        if (!loc) return { genre: 'saute', url, raison: 'redirection sans destination' };
        let cible: URL;
        try { cible = new URL(loc, url); } catch { return { genre: 'saute', url, raison: 'redirection illisible' }; }
        if (CONNEXION.test(cible.pathname + cible.search)) {
          this.mettreEnPause(u.hostname, 'demande une connexion', PAUSES.refus);
          return { genre: 'refus', url, raison: 'la page demande une connexion (jamais faite)', site: u.hostname };
        }
        if (u.protocol === 'https:' && cible.protocol === 'http:') return { genre: 'saute', url, raison: 'redirection de https vers http refusée (descente en clair)' };
        url = cible.toString();
        continue; // la redirection repasse TOUS les contrôles
      }
      if (st === 304) return { genre: 'inchange', url, fraicheur: { ...o.conditionnel, ...fraicheurDe(res.headers) } };
      if (st === 401 || st === 403 || st === 407 || st === 451) {
        await res.body?.cancel().catch(() => undefined);
        this.mettreEnPause(u.hostname, `refus (HTTP ${st})`, PAUSES.refus);
        return { genre: 'refus', url, raison: `le site refuse (HTTP ${st}) : laissé, sans insister`, site: u.hostname };
      }
      if (st === 429) {
        await res.body?.cancel().catch(() => undefined);
        const ra = Number(res.headers.get('retry-after'));
        this.mettreEnPause(u.hostname, 'trop de demandes (HTTP 429)', Math.max(PAUSES.limite, Number.isFinite(ra) ? ra * 1000 : 0));
        return { genre: 'refus', url, raison: 'le site demande de ralentir (HTTP 429) : mis en pause', site: u.hostname };
      }
      if (st >= 500) {
        const corps = await lireCorps(res, 64 * 1024).catch(() => ({ octets: Buffer.alloc(0), n: 0, depasse: false }));
        this.o.budget.noter('octets', corps.n);
        const defi = DEFI.test(corps.octets.toString('utf8'));
        this.mettreEnPause(u.hostname, defi ? 'vérification anti-robot' : `panne (HTTP ${st})`, defi ? PAUSES.refus : PAUSES.panne);
        return defi ? { genre: 'refus', url, raison: 'vérification anti-robot : laissée, jamais passée', site: u.hostname } : { genre: 'saute', url, raison: `site en panne (HTTP ${st})` };
      }
      if (st < 200 || st >= 300) { await res.body?.cancel().catch(() => undefined); return { genre: 'saute', url, raison: `page indisponible (HTTP ${st})` }; }

      const type = res.headers.get('content-type') ?? '';
      if (!TYPES_TEXTE.test(type)) { await res.body?.cancel().catch(() => undefined); return { genre: 'saute', url, raison: `pas du texte (${type.split(';')[0] || 'type inconnu'}) : pas lu à ce passage` }; }
      const max = Math.min(r.tailleMaxPage, this.o.budget.restant('octets'));
      const annonce = Number(res.headers.get('content-length'));
      if (Number.isFinite(annonce) && annonce > max) { await res.body?.cancel().catch(() => undefined); return { genre: 'saute', url, raison: 'page trop grosse (ou budget d\'octets du jour atteint)' }; }
      let corps: { octets: Buffer; n: number; depasse: boolean };
      try { corps = await lireCorps(res, max); } catch { return o.signal?.aborted ? { genre: 'arret', raison: 'abandon' } : { genre: 'saute', url, raison: 'lecture interrompue (délai dépassé)' }; }
      this.o.budget.noter('octets', corps.n);
      if (corps.depasse) return { genre: 'saute', url, raison: 'page trop grosse (ou budget d\'octets du jour atteint)' };
      const brutTexte = decoder(corps.octets, type);
      if (brutTexte.length < 30_000 && DEFI.test(brutTexte)) {
        this.mettreEnPause(u.hostname, 'vérification anti-robot', PAUSES.refus);
        return { genre: 'refus', url, raison: 'vérification anti-robot : laissée, jamais passée', site: u.hostname };
      }
      const html = /html/i.test(type);
      const consignes = html ? consignesPage(brutTexte, res.headers.get('x-robots-tag')) : consignesPage('', res.headers.get('x-robots-tag'));
      const art = html ? texteDePage(brutTexte) : { title: u.pathname, text: brutTexte.slice(0, 200_000), published: undefined };
      const page: PageLue = {
        url: brut, urlFinale: url, site: siteOf(url), titre: art.title ?? '', texte: art.text ?? '',
        liens: html && !consignes.nofollow ? liensDe(brutTexte, url, r.liensParPage * 3) : [],
        ...(art.published ? { publie: art.published } : {}),
        octets: corps.n, empreinte: empreinteContenu(art.text ?? ''),
        fraicheur: { ...fraicheurDe(res.headers), ...(art.published ? { publie: art.published } : {}) },
        nofollow: consignes.nofollow, noindex: consignes.noindex,
      };
      return { genre: 'lu', page };
    }
    return { genre: 'saute', url, raison: 'trop de redirections' };
  }
}
