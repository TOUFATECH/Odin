// Évaluation des sources (type, fiabilité, date, auteur) et INDÉPENDANCE : trois articles qui
// reprennent le même communiqué ne font qu'une seule confirmation. Pur, testable, sans modèle.

import type { Page } from './fetch.ts';

export type Tier = 'officiel' | 'référence' | 'presse' | 'spécialisé' | 'forum / blog' | 'inconnu';
const OFFICIAL = /(\.gouv\.fr|\.gouv\.[a-z]{2}|\.gov(\.[a-z]{2})?|europa\.eu|legifrance\.fr|service-public\.fr|insee\.fr|who\.int|un\.org|oecd\.org|imf\.org|worldbank\.org|ec\.europa\.eu|senat\.fr|assemblee-nationale\.fr|conseil-constitutionnel\.fr|courdecassation\.fr|banque-france\.fr|ecb\.europa\.eu|ameli\.fr|meteofrance\.com|cnil\.fr|ars\.sante\.fr|prefectures-regions|mayotte\.gouv\.fr)$/i;
const REFERENCE = /(wikipedia\.org|britannica\.com|arxiv\.org|doi\.org|nature\.com|science\.org|sciencedirect\.com|springer\.com|pubmed\.ncbi\.nlm\.nih\.gov|ncbi\.nlm\.nih\.gov|thelancet\.com|nejm\.org|hal\.science|cairn\.info|persee\.fr|openedition\.org|\.edu|\.ac\.[a-z]{2}|cnrs\.fr|inserm\.fr|inrae\.fr|ieee\.org|acm\.org)$/i;
const PRESS = /(lemonde\.fr|lefigaro\.fr|liberation\.fr|francetvinfo\.fr|la1ere\.francetvinfo\.fr|afp\.com|reuters\.com|apnews\.com|bbc\.(co\.uk|com)|ouest-france\.fr|lesechos\.fr|latribune\.fr|leparisien\.fr|20minutes\.fr|lexpress\.fr|lepoint\.fr|nouvelobs\.com|rfi\.fr|france24\.com|radiofrance\.fr|franceinfo\.fr|tf1info\.fr|bfmtv\.com|nytimes\.com|washingtonpost\.com|theguardian\.com|ft\.com|economist\.com|bloomberg\.com|lavoixdunord\.fr|ledauphine\.com|lejdd\.fr|courrierinternational\.com|mayottehebdo\.com|linfo\.re|clicanoo\.re|zinfos974\.com|lejournaldemayotte\.yt)$/i;
const FORUM = /(reddit\.com|quora\.com|medium\.com|substack\.com|blogspot\.|wordpress\.com|over-blog|forum|jeuxvideo\.com|doctissimo\.fr|facebook\.com|x\.com|twitter\.com|tiktok\.com|instagram\.com|youtube\.com|linkedin\.com|pinterest\.)/i;
const SPECIAL = /(github\.com|docs\.|developer\.|learn\.microsoft\.com|developers\.google\.com|mozilla\.org|stackoverflow\.com|readthedocs\.io|python\.org|nodejs\.org|kernel\.org|debian\.org|ubuntu\.com|proxmox\.com|anthropic\.com|openai\.com)/i;

export const hostOf = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, '').toLowerCase(); } catch { return ''; } };
/** Domaine « enregistrable » approximatif (lemonde.fr, bbc.co.uk). */
export function siteOf(u: string): string {
  const p = hostOf(u).split('.');
  return p.length > 2 && /^(co|com|gouv|ac|org|net)$/.test(p.at(-2)!) ? p.slice(-3).join('.') : p.slice(-2).join('.');
}

export function tierOf(url: string): Tier {
  const h = hostOf(url);
  if (OFFICIAL.test(h)) return 'officiel';
  if (REFERENCE.test(h)) return 'référence';
  if (PRESS.test(h)) return 'presse';
  if (FORUM.test(h)) return 'forum / blog';
  if (SPECIAL.test(h)) return 'spécialisé';
  return 'inconnu';
}

export interface Assessed { n: number; page: Page; site: string; tier: Tier; score: number; primary: boolean; ageDays?: number; notes: string[]; cluster: number; origin?: string }

const BASE: Record<Tier, number> = { officiel: 90, référence: 80, presse: 70, spécialisé: 65, inconnu: 45, 'forum / blog': 30 };
/** Note de fiabilité (0–100) et remarques, selon le type de site, l'auteur, la date, le fait d'être une source primaire. */
export function assess(p: Page, n: number, now = Date.now()): Assessed {
  const tier = tierOf(p.finalUrl), notes: string[] = [];
  let score = BASE[tier];
  const primary = tier === 'officiel' || p.kind === 'pdf' && tier !== 'forum / blog' || /communiqu|rapport|d[ée]cret|arr[êe]t[ée]|press-release|documentation|specification/i.test(`${p.title} ${p.finalUrl}`);
  if (primary) { score += 5; notes.push('source primaire'); }
  if (p.author) score += 5; else notes.push('auteur non indiqué');
  let ageDays: number | undefined;
  if (p.published) { ageDays = Math.floor((now - Date.parse(p.published)) / 86_400_000); if (ageDays > 730) { score -= 10; notes.push(`ancienne (${Math.round(ageDays / 365)} ans)`); } }
  else { score -= 5; notes.push('date de publication inconnue'); }
  if (p.text.length < 600) { score -= 10; notes.push('peu de contenu'); }
  if (p.via === 'navigateur') notes.push('lue avec le navigateur');
  return { n, page: p, site: siteOf(p.finalUrl), tier, score: Math.max(0, Math.min(100, score)), primary, ageDays, notes, cluster: n };
}

// ---------------- Indépendance ----------------

const words = (t: string) => t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter(Boolean);
function shingles(t: string, k = 8): Set<string> { const w = words(t).slice(0, 4000), s = new Set<string>(); for (let i = 0; i + k <= w.length; i++) s.add(w.slice(i, i + k).join(' ')); return s; }
/** Part du texte de A qu'on retrouve mot pour mot dans B (0–1). */
export function overlap(a: string, b: string): number {
  const A = shingles(a), B = shingles(b);
  if (!A.size || !B.size) return 0;
  let c = 0; for (const x of A) if (B.has(x)) c++;
  return c / Math.min(A.size, B.size);
}
const REPRISE = /(selon (l'|le |la |les )?(afp|reuters|ap|agence|communiqu)|d'apr[eè]s (l'|le |la )?(afp|reuters|communiqu)|(avec|source) ?:? ?afp|according to (a |the )?(reuters|ap|press release|statement)|dans un communiqu[ée]|a annonc[ée] dans un communiqu)/i;
/** Agence ou communiqué d'origine cité dans le texte (pur). */
export function citedOrigin(text: string): string | undefined {
  const m = REPRISE.exec(text);
  if (!m) return undefined;
  const s = m[0].toLowerCase();
  return /afp/.test(s) ? 'AFP' : /reuters/.test(s) ? 'Reuters' : /\bap\b/.test(s) ? 'AP' : 'communiqué';
}

/**
 * Regroupe les sources qui ne sont pas indépendantes : même site, texte largement repris, lien
 * vers la même source primaire, ou même agence / communiqué cité. Modifie `cluster` et `origin`.
 */
export function clusterSources(list: Assessed[]): Assessed[] {
  const parent = list.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const join = (a: number, b: number) => { parent[find(a)] = find(b); };
  for (let i = 0; i < list.length; i++) {
    const A = list[i];
    A.origin = citedOrigin(A.page.text.slice(0, 20_000));
    for (let j = 0; j < i; j++) {
      const B = list[j];
      if (A.site === B.site) { join(i, j); continue; }
      if (A.origin && A.origin === B.origin) { join(i, j); continue; }
      // L'une renvoie à l'autre (reprise).
      if (A.page.links.some((l) => siteOf(l) === B.site && hostOf(l) && l.includes(new URL(B.page.finalUrl).pathname.slice(0, 40))) || B.page.links.some((l) => siteOf(l) === A.site && l.includes(new URL(A.page.finalUrl).pathname.slice(0, 40)))) { join(i, j); continue; }
      if (overlap(A.page.text, B.page.text) > 0.35) join(i, j);
    }
  }
  const ids = new Map<number, number>();
  for (let i = 0; i < list.length; i++) { const r = find(i); if (!ids.has(r)) ids.set(r, ids.size + 1); list[i].cluster = ids.get(r)!; }
  return list;
}
