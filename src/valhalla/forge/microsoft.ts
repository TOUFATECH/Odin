// Andromède · Windows chez Microsoft : tout se fait DIRECTEMENT avec les serveurs de Microsoft (microsoft.com et
// ses serveurs de téléchargement), aucun site tiers.
//
// Ce que fait Odin :
//   1. il lit la page officielle de téléchargement (ex. https://www.microsoft.com/fr-fr/software-download/windows11) :
//      la version actuelle (« Version 26H2 »), les éditions proposées (liste « Sélectionnez l'édition »), le tableau
//      des empreintes SHA-256 publiées par Microsoft pour chaque langue, et les liens vers les autres Windows
//      (un « windows12 » qui apparaît = un nouveau Windows) ;
//   2. au moment de télécharger seulement (Microsoft limite le nombre de demandes), il demande au service de la
//      page (« software-download-connector ») la liste des langues de l'édition, puis le lien officiel temporaire
//      de l'ISO dans la langue choisie (français par défaut) ;
//   3. si Microsoft refuse (protection « Sentinel », vérification que seul un navigateur sait faire, blocage
//      « 715-123130 », page au lieu de la réponse attendue…), Odin ne contourne RIEN : il le dit, donne la page
//      officielle, et vérifiera l'empreinte publiée par Microsoft quand tu déposeras l'ISO dans le dossier.
//
// Le déroulé des appels au service de Microsoft a été compris en lisant le script libre Fido de Pete Batard
// (https://github.com/pbatard/Fido, licence GPLv3), qui sert aussi à Rufus. Ce fichier est écrit pour Odin, sans
// reprendre son code. Odin ne fait PAS les étapes de Fido qui imitent la vérification du navigateur
// (vlscppe.microsoft.com, ov-df.microsoft.com) : ce sont des protections, Odin ne les contourne pas.
//
// Windows Server : le centre d'évaluation demande un formulaire, qu'Odin ne remplit pas à ta place ; il lit
// seulement la page publique du centre pour voir si une nouvelle version de Windows Server y apparaît.
//
// La veille (Talos) : chaque jour à 03:30 par défaut, réglable ; une nouvelle version déclenche une alerte claire ;
// selon ton réglage, Odin télécharge tout seul aux heures creuses ou te prévient seulement. Le téléchargement passe
// par la forge (empreinte de Microsoft vérifiée, antivirus d'abord, ancienne version rangée dans « old »).

import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { tacheEnPause } from '../automatismes.ts';
import { fuseauOdin, murale, prochaine, type Rythme } from '../../draupnir/rythme.ts';
import { lieuCourant, PAYS_PAR_DEFAUT } from '../lieu.ts';
import type { Action, ModCtx, Module, RythmeAppli, Section, TacheAppli } from '../types.ts';
import { scan } from './forge.ts';
import { cmpVersion, ISO, type Fetch, type Release, type Source } from './sources.ts';
import type { Vue } from './store.ts';

const MS = 'https://www.microsoft.com';
/** Le service que la page de téléchargement de Microsoft appelle elle-même. */
export const CONNECTEUR = `${MS}/software-download-connector/api/`;
/** L'identifiant de profil de la page de téléchargement de Microsoft (le même pour tous ses visiteurs). */
const PROFIL = '606624d44113';
const UA = 'Odin-Eitri/1';
export const EVALCENTER = `${MS}/fr-fr/evalcenter`;

export interface ProduitWindows { id: string; nom: string; page: string; arch: 'x64' | 'arm64' }
export const PRODUITS: ProduitWindows[] = [
  { id: 'windows11', nom: 'Windows 11', page: `${MS}/fr-fr/software-download/windows11`, arch: 'x64' },
  { id: 'windows11-arm64', nom: 'Windows 11 (ARM 64)', page: `${MS}/fr-fr/software-download/windows11arm64`, arch: 'arm64' },
  // La page « windows10 » propose l'outil de création de support ; la page « windows10ISO » propose l'ISO.
  { id: 'windows10', nom: 'Windows 10', page: `${MS}/fr-fr/software-download/windows10ISO`, arch: 'x64' },
];
/** Le type de téléchargement dans la réponse de Microsoft : 0 = 32 bits, 1 = x64, 2 = ARM 64. */
const ARCH: Record<number, string> = { 0: 'x86', 1: 'x64', 2: 'arm64' };

// ---------------------------------------------------------------- Lire les pages (pur)
const ENT: Record<string, string> = { nbsp: ' ', amp: '&', quot: '"', apos: '\'', lt: '<', gt: '>', rsquo: '’', eacute: 'é' };
/** Remplace les entités HTML (« &nbsp; », « &#xA0; », « &#39; »…). Pur. */
export function entites(t: string): string {
  return t.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, c: string) => (c[0] === '#' ? String.fromCodePoint(c[1] === 'x' || c[1] === 'X' ? parseInt(c.slice(2), 16) : Number(c.slice(1))) : ENT[c.toLowerCase()] ?? m));
}
const net = (t: string) => entites(t).replace(/[\s ‎‏]+/g, ' ').trim();
const plat = (t: string) => net(t).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export interface PageWindows {
  /** la version actuelle (« 26H2 ») */ version?: string;
  /** « Mise à jour Windows 11 2026 » */ libelle?: string;
  editions: Array<{ id: string; nom: string }>;
  /** le tableau « Valeurs de hachage des fichiers ISO pour chaque langue » */
  empreintes: Array<{ langue: string; bits: '32' | '64'; sha256: string }>;
  /** les numéros des Windows proposés par les liens de la page (10, 11… et un nouveau s'il apparaît) */
  windows: number[];
}
/** Lit une page officielle de téléchargement de Windows. Pur. */
export function lirePageWindows(html: string): PageWindows {
  const texte = net(html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' '));
  const version = /\bVersion\s+(\d{2}H\d)\b/i.exec(texte)?.[1]?.toUpperCase();
  const libelle = /Mise à jour (?:de )?Windows\s*\d+\s+\d{4}/i.exec(texte)?.[0];
  const editions = [...html.matchAll(/<option[^>]*\bvalue="(\d+)"[^>]*>([^<]+)/gi)].map((m) => ({ id: m[1], nom: net(m[2]) }));
  const empreintes: PageWindows['empreintes'] = [];
  for (const m of html.matchAll(/<td[^>]*>([^<]+)<\/td>\s*<td[^>]*>\s*([A-Fa-f0-9]{64})\s*<\/td>/g)) {
    const l = /^(.*?)\s*(32|64)\s*-?\s*bits?$/i.exec(net(m[1])); if (!l) continue;
    empreintes.push({ langue: l[1].trim(), bits: l[2] as '32' | '64', sha256: m[2].toLowerCase() });
  }
  const windows = [...new Set([...html.matchAll(/software-download\/windows([12]\d)(?!\d)/gi)].map((m) => Number(m[1])))].sort((a, b) => a - b);
  return { version, ...(libelle ? { libelle } : {}), editions, empreintes, windows };
}
/** Les versions de Windows Server proposées par la page publique du centre d'évaluation (« 2025 »…). Pur. */
export function lireEvalCenter(html: string): string[] {
  return [...new Set([...html.matchAll(/evaluate-windows-server-(\d{4})(?![\w-])/gi)].map((m) => m[1]))].sort((a, b) => cmpVersion(a, b));
}
/** L'empreinte publiée pour une langue (« Français », 64 bits). Pur. */
export function empreinteDe(p: PageWindows, langue: string): string | undefined {
  return p.empreintes.find((x) => x.bits === '64' && plat(x.langue) === plat(langue))?.sha256;
}
/** L'édition choisie (son numéro ou un bout de son nom), sinon la première qui n'est pas réservée à la Chine. Pur. */
export function choisirEdition(l: PageWindows['editions'], choix = ''): { id: string; nom: string } | undefined {
  const c = plat(choix);
  return (c ? l.find((e) => e.id === choix.trim() || plat(e.nom).includes(c)) : undefined) ?? l.find((e) => !/chin/i.test(e.nom)) ?? l[0];
}

// ---------------------------------------------------------------- Le service de Microsoft
/** Microsoft refuse : Odin ne contourne pas, il retombe sur la page officielle. */
export class RefusMicrosoft extends Error { code = 'REFUS'; }
export interface Sku { id: string; langue: string; nom: string }
/** La raison d'un refus, en clair. Pur. */
export function raisonRefus(err: Array<{ Key?: string; Value?: string; Type?: number }>): string {
  const e = err[0] ?? {};
  if (/sentinel/i.test(`${e.Key ?? ''} ${e.Value ?? ''}`)) return 'Microsoft a refusé de donner le lien : sa protection (« Sentinel ») demande une vérification que seul un navigateur fait, et Odin ne la contourne pas.';
  if (e.Type === 9 || /715-123130/.test(e.Value ?? '')) return 'Microsoft bloque pour l\'instant les téléchargements depuis cette adresse (code 715-123130 : trop de demandes, ou région non autorisée).';
  return `Microsoft a refusé la demande${e.Value ? ` : ${e.Value}` : ''}.`;
}
async function lire(f: Fetch, url: string): Promise<string> {
  const r = await f(url, { headers: { 'user-agent': UA, accept: 'text/html,*/*' }, redirect: 'follow', signal: AbortSignal.timeout(20_000) });
  if (!r.ok) throw new Error(`${new URL(url).host} répond ${r.status}`);
  return r.text();
}
/** Un appel au service de Microsoft ; tout ce qui n'est pas la réponse attendue est un refus. */
async function service(f: Fetch, quoi: string, q: Record<string, string>, referer: string): Promise<Record<string, unknown>> {
  const url = `${CONNECTEUR}${quoi}?${new URLSearchParams({ profile: PROFIL, ...q }).toString()}`;
  const r = await f(url, { headers: { 'user-agent': UA, accept: 'application/json', referer }, signal: AbortSignal.timeout(20_000) });
  if (r.status === 403 || r.status === 429) throw new RefusMicrosoft(`Microsoft refuse la demande (réponse ${r.status}).`);
  if (!r.ok) throw new Error(`le service de Microsoft répond ${r.status}`);
  const t = await r.text(); let j: Record<string, unknown>;
  // Microsoft rend parfois sa réponse JSON écrite dans une chaîne JSON : on la lit alors deux fois.
  try { const a: unknown = JSON.parse(t); j = (typeof a === 'string' ? JSON.parse(a) : a) as Record<string, unknown>; if (!j || typeof j !== 'object') throw new Error('vide'); } catch { throw new RefusMicrosoft('Microsoft a répondu par une page au lieu de la réponse attendue (vérification demandée ?) : Odin ne va pas plus loin.'); }
  const err = (j.Errors ?? (j.ValidationContainer as { Errors?: unknown } | undefined)?.Errors) as Array<{ Key?: string; Value?: string; Type?: number }> | undefined;
  if (Array.isArray(err) && err.length) throw new RefusMicrosoft(raisonRefus(err));
  return j;
}
/** Les langues d'une édition (chaque langue a son numéro « SKU »). */
export async function languesWindows(f: Fetch, edition: string, o: { session: string; referer: string; locale?: string }): Promise<Sku[]> {
  const j = await service(f, 'getskuinformationbyproductedition', { productEditionId: edition, SKU: 'undefined', friendlyFileName: 'undefined', Locale: o.locale ?? 'fr-FR', sessionID: o.session }, o.referer);
  const l = (j.Skus as Array<{ Id?: string; Language?: string; LocalizedLanguage?: string }> | undefined) ?? [];
  const out = l.filter((x) => x.Id && x.Language).map((x) => ({ id: String(x.Id), langue: String(x.Language), nom: String(x.LocalizedLanguage ?? x.Language) }));
  if (!out.length) throw new RefusMicrosoft('Microsoft n\'a donné aucune langue pour cette édition.');
  return out;
}
/** Les liens officiels temporaires d'une langue (un par architecture). Seuls les serveurs de Microsoft sont acceptés. */
export async function liensWindows(f: Fetch, sku: string, o: { session: string; referer: string; locale?: string }): Promise<Array<{ url: string; arch: string; fichier: string }>> {
  const j = await service(f, 'GetProductDownloadLinksBySku', { productEditionId: 'undefined', SKU: sku, friendlyFileName: 'undefined', Locale: o.locale ?? 'fr-FR', sessionID: o.session }, o.referer);
  const l = (j.ProductDownloadOptions as Array<{ Uri?: string; DownloadType?: number }> | undefined) ?? [];
  const out: Array<{ url: string; arch: string; fichier: string }> = [];
  for (const x of l) {
    let u: URL; try { u = new URL(String(x.Uri)); } catch { continue; }
    if (u.protocol !== 'https:' || !/(^|\.)microsoft\.com$/i.test(u.hostname)) continue; // jamais un autre serveur
    const fichier = decodeURIComponent(u.pathname.split('/').pop() ?? '');
    if (/^[\w.-]+\.iso$/i.test(fichier)) out.push({ url: u.toString(), arch: ARCH[Number(x.DownloadType)] ?? 'inconnue', fichier });
  }
  if (!out.length) throw new RefusMicrosoft('Microsoft n\'a donné aucun lien de téléchargement.');
  return out;
}

// ---------------------------------------------------------------- La langue de l'ISO : celle d'Odin
/**
 * Les langues des ISO de Windows : le code d'Odin (« fr »), les pays qui choisissent une variante, le nom que donne
 * le service de Microsoft (« French ») et le nom du tableau des empreintes de la page française (« Français »).
 */
interface LangueMs { code: string; pays?: string[]; ms: string; fr: string }
const LANGUES: LangueMs[] = [
  { code: 'fr', pays: ['CA'], ms: 'French Canadian', fr: 'Français canadien' }, { code: 'fr', ms: 'French', fr: 'Français' },
  { code: 'en', pays: ['US', 'CA'], ms: 'English', fr: 'Anglais' }, { code: 'en', ms: 'English International', fr: 'Anglais international' },
  { code: 'es', pays: ['MX'], ms: 'Spanish (Mexico)', fr: 'Espagnol (Mexique)' }, { code: 'es', ms: 'Spanish', fr: 'Espagnol' },
  { code: 'pt', pays: ['BR'], ms: 'Brazilian Portuguese', fr: 'Portugais (Brésil)' }, { code: 'pt', ms: 'Portuguese', fr: 'Portugais' },
  { code: 'zh', pays: ['TW', 'HK'], ms: 'Chinese (Traditional)', fr: 'Chinois traditionnel' }, { code: 'zh', ms: 'Chinese (Simplified)', fr: 'Chinois simplifié' },
  { code: 'de', ms: 'German', fr: 'Allemand' }, { code: 'it', ms: 'Italian', fr: 'Italien' }, { code: 'nl', ms: 'Dutch', fr: 'Néerlandais' },
  { code: 'pl', ms: 'Polish', fr: 'Polonais' }, { code: 'ru', ms: 'Russian', fr: 'Russe' }, { code: 'ja', ms: 'Japanese', fr: 'Japonais' },
  { code: 'ko', ms: 'Korean', fr: 'Coréen' }, { code: 'ar', ms: 'Arabic', fr: 'Arabe' }, { code: 'tr', ms: 'Turkish', fr: 'Turc' },
  { code: 'sv', ms: 'Swedish', fr: 'Suédois' }, { code: 'da', ms: 'Danish', fr: 'Danois' }, { code: 'fi', ms: 'Finnish', fr: 'Finnois' },
  { code: 'nb', ms: 'Norwegian', fr: 'Norvégien' }, { code: 'no', ms: 'Norwegian', fr: 'Norvégien' }, { code: 'cs', ms: 'Czech', fr: 'Tchèque' },
  { code: 'el', ms: 'Greek', fr: 'Grec' }, { code: 'he', ms: 'Hebrew', fr: 'Hébreu' }, { code: 'hu', ms: 'Hungarian', fr: 'Hongrois' },
  { code: 'ro', ms: 'Romanian', fr: 'Roumain' }, { code: 'sk', ms: 'Slovak', fr: 'Slovaque' }, { code: 'sl', ms: 'Slovenian', fr: 'Slovène' },
  { code: 'bg', ms: 'Bulgarian', fr: 'Bulgare' }, { code: 'hr', ms: 'Croatian', fr: 'Croate' }, { code: 'et', ms: 'Estonian', fr: 'Estonien' },
  { code: 'lv', ms: 'Latvian', fr: 'Letton' }, { code: 'lt', ms: 'Lithuanian', fr: 'Lituanien' }, { code: 'uk', ms: 'Ukrainian', fr: 'Ukrainien' },
  { code: 'th', ms: 'Thai', fr: 'Thaï' }, { code: 'sr', ms: 'Serbian Latin', fr: 'Serbe (latin)' },
];
/** La langue qu'on parle d'office dans un pays (quand Odin n'a pas de langue réglée). */
const LANGUE_DU_PAYS: Record<string, string> = { US: 'en', GB: 'en', IE: 'en', CA: 'en', AU: 'en', IN: 'en', ZA: 'en', KE: 'en', TZ: 'en', MU: 'en', DE: 'de', ES: 'es', MX: 'es', IT: 'it', PT: 'pt', BR: 'pt', NL: 'nl', JP: 'ja', CN: 'zh', AE: 'ar', SA: 'ar', TR: 'tr' };
/** Où lire la langue d'Odin : branché au démarrage (odin.ts) ; le pays vient du lieu d'Odin. */
let langueOdin: () => { langue?: string; pays?: string } = () => ({});
export function brancherLangueOdin(f: () => { langue?: string; pays?: string }): void { langueOdin = f; }
/** La langue d'Odin : son code (« fr », « en »…) et son pays. Pas de langue réglée (ou « auto ») : celle du pays, sinon le français. */
export function langueDOdin(): { code: string; pays: string } {
  const o = langueOdin(), pays = (o.pays || lieuCourant()?.region.pays || PAYS_PAR_DEFAUT).toUpperCase();
  const c = (o.langue ?? '').trim().toLowerCase().slice(0, 2);
  return { code: /^[a-z]{2}$/.test(c) ? c : LANGUE_DU_PAYS[pays] ?? 'fr', pays };
}
/** La langue de l'ISO pour un code et un pays (la variante du pays s'il y en a une). Pur. */
export function langueIso(code: string, pays = ''): LangueMs | undefined {
  const l = LANGUES.filter((x) => x.code === code.toLowerCase());
  return l.find((x) => x.pays?.includes(pays.toUpperCase())) ?? l.find((x) => !x.pays) ?? l[0];
}
/** L'anglais de repli, selon le pays (États-Unis et Canada : « English » ; ailleurs : « English International »). Pur. */
const anglais = (pays: string) => langueIso('en', pays)!;
/** La langue voulue : ton choix dans la page s'il y en a un, sinon celle d'Odin. */
export function langueVoulue(r: Pick<ReglagesWindows, 'langue'>): { ms: string; fr: string; pays: string; parOdin: boolean } {
  const o = langueDOdin();
  if (r.langue.trim()) { const t = plat(r.langue); const x = LANGUES.find((y) => plat(y.ms) === t || plat(y.fr) === t || y.code === t); return { ...(x ?? { ms: r.langue.trim(), fr: r.langue.trim() }), pays: o.pays, parOdin: false }; }
  return { ...(langueIso(o.code, o.pays) ?? anglais(o.pays)), pays: o.pays, parOdin: true };
}
/** La langue proposée par Microsoft qui correspond ; sinon l'anglais (et la raison). Pur. */
export function choisirSku(skus: Sku[], voulue: { ms: string; fr: string; pays: string }): { sku?: Sku; note?: string } {
  const eg = (x: Sku, n: { ms: string; fr: string }) => plat(x.langue) === plat(n.ms) || plat(x.nom) === plat(n.fr) || plat(x.nom) === plat(n.ms);
  const sku = skus.find((x) => eg(x, voulue)); if (sku) return { sku };
  const en = anglais(voulue.pays), repli = skus.find((x) => eg(x, en)) ?? skus.find((x) => /^english/i.test(x.langue));
  return repli ? { sku: repli, note: `Microsoft ne propose pas l'ISO en « ${voulue.fr} » : Odin prend l'anglais (${repli.nom}).` } : {};
}

// ---------------------------------------------------------------- Les réglages
export interface ReglagesWindows {
  /** la langue de l'ISO choisie à la main (vide : la langue d'Odin) */ langue: string;
  /** l'édition (numéro ou bout de nom) ; vide : celle proposée par défaut */ edition: string;
  /** suivre aussi Windows 11 pour ARM 64 */ arm64: boolean;
  /** télécharger tout seul (aux heures creuses) ; sinon : prévenir seulement */ auto: boolean;
  /** les heures creuses, « 01:00-06:00 » */ creuses: string;
  rythme?: RythmeAppli; dernier?: number;
  /** la dernière version déjà annoncée de chaque produit (une alerte par version) */ vus: Record<string, string>;
  /** les téléchargements qui attendent les heures creuses */ attente: string[];
}
export function reglagesWindows(settings: Record<string, unknown> = {}): ReglagesWindows {
  const w = (settings.windows ?? {}) as Partial<ReglagesWindows>;
  return { langue: w.langue ?? '', edition: w.edition ?? '', arm64: w.arm64 === true, auto: w.auto !== false, creuses: w.creuses || '01:00-06:00', ...(w.rythme ? { rythme: w.rythme } : {}), ...(w.dernier ? { dernier: w.dernier } : {}), vus: { ...(w.vus ?? {}) }, attente: [...(w.attente ?? [])] };
}
const noter = (ctx: ModCtx, patch: Partial<ReglagesWindows>) => ctx.saveSettings({ windows: { ...((ctx.settings.windows ?? {}) as object), ...patch } });
const RYTHME: RythmeAppli = { genre: 'jour', heure: '03:30' };
/** Est-on dans les heures creuses (« 01:00-06:00 », ou « 22:00-06:00 » à cheval sur minuit) ? Heure du lieu d'Odin. Pur. */
export function dansCreuses(now: Date, plage: string, fuseau?: string): boolean {
  const m = /^\s*(\d{1,2})[:h](\d{2})\s*-\s*(\d{1,2})[:h](\d{2})\s*$/.exec(plage); if (!m) return true;
  const w = murale(now.getTime(), fuseauOdin(fuseau)), t = w.h * 60 + w.mi, a = Number(m[1]) * 60 + Number(m[2]), b = Number(m[3]) * 60 + Number(m[4]);
  return a === b ? true : a < b ? t >= a && t < b : t >= a || t < b;
}

// ---------------------------------------------------------------- La dernière version (pour la forge)
/**
 * La dernière version d'un Windows : lue sur la page officielle (version et empreinte de la langue choisie). Le lien
 * de l'ISO n'est demandé qu'au moment de télécharger (`obtenir`) ; si Microsoft refuse, la version rendue dit
 * pourquoi (`manuel`) et la forge donne la page officielle au lieu de télécharger.
 */
export const derniereWindows = (p: ProduitWindows) => async (f: Fetch, settings?: Record<string, unknown>): Promise<Release> => {
  const r = reglagesWindows(settings);
  let html: string; try { html = await lire(f, p.page); } catch (e) { throw new Error(`page officielle de Microsoft injoignable (${(e as Error).message}) : ${p.page}`); }
  const pg = lirePageWindows(html); if (!pg.version) throw new Error(`version introuvable sur la page officielle (la page a peut-être changé) : ${p.page}`);
  const lv = langueVoulue(r), sha = empreinteDe(pg, lv.fr), num = p.id === 'windows10' ? '10' : '11';
  const base: Release = { version: pg.version, file: `Win${num}_${pg.version}_${lv.ms.replace(/[^A-Za-z]/g, '') || 'Langue'}_${p.arch === 'arm64' ? 'Arm64' : 'x64'}.iso`, url: p.page, page: p.page, ...(sha ? { sha256: sha } : {}) };
  const repli = (raison: string): Release => ({ ...base, manuel: `${raison} Télécharge l'ISO sur la page officielle et dépose-la dans le dossier : Odin la reconnaîtra${sha ? ' et vérifiera l\'empreinte publiée par Microsoft' : ''}.` });
  return { ...base, obtenir: async () => {
    const ed = choisirEdition(pg.editions, r.edition); if (!ed) return repli('Microsoft ne propose aucune édition sur sa page.');
    const session = randomUUID();
    try {
      const skus = await languesWindows(f, ed.id, { session, referer: p.page });
      const { sku, note } = choisirSku(skus, lv);
      if (!sku) return repli(`Ni « ${lv.fr} » ni l'anglais ne sont proposés (proposées : ${skus.map((x) => x.nom).join(', ')}).`);
      const l = (await liensWindows(f, sku.id, { session, referer: p.page })).find((x) => x.arch === p.arch);
      if (!l) return repli(`Microsoft ne donne pas de lien ${p.arch} pour cette édition.`);
      const src = ISO.find((x) => x.id === p.id), v = src?.match.exec(l.fichier)?.[1] ?? base.version;
      // L'empreinte de la langue obtenue (le tableau de la page française nomme les langues en français).
      const sha2 = empreinteDe(pg, sku.nom) ?? empreinteDe(pg, LANGUES.find((x) => plat(x.ms) === plat(sku.langue))?.fr ?? '') ?? (note ? undefined : sha);
      return { version: v, file: l.fichier, url: l.url, page: p.page, ...(sha2 ? { sha256: sha2 } : {}), ...(note ? { note } : {}) };
    } catch (e) {
      if (e instanceof RefusMicrosoft) return repli(e.message);
      return repli(`Le service de Microsoft n'a pas répondu (${(e as Error).message}).`);
    }
  } };
};

/** Branche Microsoft sur le catalogue des ISO (une seule fois) : Windows 11, Windows 11 ARM 64 et Windows 10. */
let branche = false;
export function brancherMicrosoft(): void {
  if (branche) return; branche = true;
  if (!ISO.some((x) => x.id === 'windows11-arm64')) {
    const i = ISO.findIndex((x) => x.id === 'windows11');
    const arm: Source = { id: 'windows11-arm64', name: 'Windows 11 (ARM 64)', kind: 'iso', family: 'Windows', systeme: 'Windows', type: 'bureau', arch: 'arm64', about: 'Windows 11 pour processeurs ARM 64 bits', match: /^Win11_(\d\d[HhAa]\d)_[A-Za-z]+(?:_[A-Za-z]+)*_Arm64(?:v\d)?\.iso$/i, icon: 'https://www.microsoft.com/favicon.ico', color: '#0078D4', page: `${MS}/fr-fr/software-download/windows11arm64` };
    ISO.splice(i < 0 ? ISO.length : i + 1, 0, arm);
  }
  for (const p of PRODUITS) { const s = ISO.find((x) => x.id === p.id); if (s) { s.latest = derniereWindows(p); delete s.manual; } }
}
brancherMicrosoft();

// ---------------------------------------------------------------- La veille (Talos)
const dossier = (ctx: ModCtx) => (typeof ctx.settings.dossier === 'string' && ctx.settings.dossier) || join(ctx.home, 'ISO');
/** Les versions de chaque Windows déjà dans la bibliothèque (nom du fichier, ou reconnu par son empreinte). */
function presents(ctx: ModCtx): Map<string, string[]> {
  const m = new Map<string, string[]>();
  for (const x of scan(dossier(ctx), ISO.filter((s) => s.family === 'Windows')).found) m.set(x.source.id, [...(m.get(x.source.id) ?? []), x.version]);
  for (const [id, l] of Object.entries((ctx.settings.reconnus as Record<string, string[]> | undefined) ?? {})) m.set(id, [...new Set([...(m.get(id) ?? []), ...l])]);
  return m;
}
const plusHaute = (l: string[] = []) => [...l].sort((a, b) => cmpVersion(b, a))[0];
const telecharger = async (ctx: ModCtx, mod: Module, id: string): Promise<string> => {
  const a = mod.actions.find((x) => x.id === 'telecharger'); if (!a) return `❌ ${id} : téléchargement indisponible`;
  try { const r = await a.run(ctx, { nom: id }); return r.text; } catch (e) { return `❌ ${id} : ${(e as Error).message}`; }
};

/** Un passage de la veille : chaque Windows, un nouveau Windows éventuel, Windows Server. Rend le compte rendu. */
export async function veilleWindows(ctx: ModCtx, mod: Module): Promise<string> {
  const r = reglagesWindows(ctx.settings), f = ctx.fetch as unknown as Fetch, now = ctx.now(), lignes: string[] = [], vus = { ...r.vus }, attente = new Set(r.attente);
  const la = presents(ctx), suivis = new Set((ctx.settings.suivis as string[] | undefined) ?? []);
  const vues = { ...((ctx.settings.vues as Record<string, Vue> | undefined) ?? {}) };
  let plusGrand = 0;
  for (const p of PRODUITS.filter((x) => x.id !== 'windows11-arm64' || r.arm64 || la.has(x.id) || suivis.has(x.id))) {
    let pg: PageWindows;
    try { pg = lirePageWindows(await lire(f, p.page)); } catch (e) { lignes.push(`❌ ${p.nom} : page officielle injoignable (${(e as Error).message}) — ${p.page}`); continue; }
    plusGrand = Math.max(plusGrand, ...pg.windows);
    if (!pg.version) { lignes.push(`❌ ${p.nom} : version introuvable sur la page officielle (la page a peut-être changé) — ${p.page}`); continue; }
    const sha = empreinteDe(pg, langueVoulue(r).fr), avant = vues[p.id];
    vues[p.id] = { ...(avant?.version === pg.version ? avant : {}), version: pg.version, at: now.getTime(), ...(sha ? { sha256: sha } : {}), url: p.page };
    const have = plusHaute(la.get(p.id));
    if (have && cmpVersion(pg.version, have) <= 0) { lignes.push(`✔ ${p.nom} ${have} : à jour (Microsoft propose ${pg.version})`); continue; }
    if (!have && !suivis.has(p.id)) { lignes.push(`ℹ ${p.nom} ${pg.version} chez Microsoft (pas dans la bibliothèque)`); continue; }
    if (vus[p.id] !== pg.version) {
      vus[p.id] = pg.version;
      ctx.alert({ level: 'moyenne', title: `🆕 ${p.nom} ${pg.version} est sortie`, detail: `${pg.libelle ? `${pg.libelle} (version ${pg.version}). ` : ''}${have ? `Ta bibliothèque a ${have}.` : 'Pas encore dans ta bibliothèque.'} ${r.auto ? `Odin la télécharge aux heures creuses (${r.creuses}) si Microsoft le permet.` : 'Tu as choisi d\'être seulement prévenu.'} Page officielle : ${p.page}`, key: `eitri-windows-${p.id}-${pg.version}`, fix: { action: 'telecharger', input: { nom: p.id }, label: 'Télécharger' } });
    }
    if (!r.auto) { lignes.push(`🆕 ${p.nom} ${pg.version} disponible (tu as ${have ?? 'rien'}) : je te préviens seulement`); continue; }
    if (dansCreuses(now, r.creuses)) { attente.delete(p.id); lignes.push(await telecharger(ctx, mod, p.id)); } else { attente.add(p.id); lignes.push(`🆕 ${p.nom} ${pg.version} disponible : téléchargement prévu aux heures creuses (${r.creuses})`); }
  }
  // Un nouveau Windows sur la page de Microsoft (un « windows12 » dans ses liens).
  const connu = Math.max(11, Number(vus.windows) || 0);
  if (plusGrand > connu) {
    vus.windows = String(plusGrand);
    const page = `${MS}/fr-fr/software-download/windows${plusGrand}`;
    ctx.alert({ level: 'haute', title: `🆕 Un nouveau Windows chez Microsoft : Windows ${plusGrand}`, detail: `La page officielle de téléchargement de Microsoft propose maintenant Windows ${plusGrand}. Odin ne l'a pas encore dans son catalogue : sa page officielle est ${page}`, key: `eitri-windows-nouveau-${plusGrand}` });
    lignes.push(`🆕 Nouveau : Windows ${plusGrand} apparaît chez Microsoft — ${page}`);
  }
  // Windows Server : la page publique du centre d'évaluation (le formulaire, lui, reste à remplir par toi).
  try {
    const ans = lireEvalCenter(await lire(f, EVALCENTER)), best = ans[ans.length - 1], have = plusHaute(la.get('windows-server'));
    if (!best) lignes.push(`❌ Windows Server : aucune version lue sur ${EVALCENTER} (la page a peut-être changé)`);
    else {
      const ref = [vus['windows-server'], have].filter((x): x is string => Boolean(x)).sort((a, b) => cmpVersion(b, a))[0];
      if (ref && cmpVersion(best, ref) > 0) {
        ctx.alert({ level: 'moyenne', title: `🆕 Windows Server ${best} chez Microsoft`, detail: `${have ? `Ta bibliothèque a Windows Server ${have}. ` : ''}Le centre d'évaluation de Microsoft demande un formulaire : Odin ne le remplit pas à ta place. Page officielle : ${EVALCENTER}/evaluate-windows-server-${best}`, key: `eitri-windows-server-${best}` });
        lignes.push(`🆕 Windows Server ${best} chez Microsoft (formulaire à remplir toi-même) — ${EVALCENTER}`);
      } else lignes.push(`✔ Windows Server : ${best} est la plus récente au centre d'évaluation`);
      vus['windows-server'] = best;
    }
  } catch (e) { lignes.push(`❌ Windows Server : centre d'évaluation injoignable (${(e as Error).message})`); }
  ctx.saveSettings({ vues });
  noter(ctx, { vus, attente: [...attente], dernier: now.getTime() });
  return lignes.join('\n') || 'Rien à vérifier.';
}

/** Chaque minute (avec la surveillance d'Andromède) : la veille à son heure, et les téléchargements qui attendaient les heures creuses. */
async function tic(ctx: ModCtx, mod: Module): Promise<void> {
  if (tacheEnPause(mod.id, 'veille_windows')) return;
  const r = reglagesWindows(ctx.settings), now = ctx.now();
  if (!r.dernier) { noter(ctx, { dernier: now.getTime() }); return; } // première fois : la veille commence à son prochain horaire
  const p = prochaine((r.rythme ?? RYTHME) as Rythme, new Date(r.dernier));
  if (p && p <= now) { await veilleWindows(ctx, mod); return; }
  if (r.auto && r.attente.length && dansCreuses(now, r.creuses)) {
    noter(ctx, { attente: [] });
    for (const id of r.attente) await telecharger(ctx, mod, id);
  }
}

// ---------------------------------------------------------------- Actions, tâche Talos, réglages
const s = (v: unknown) => (v === undefined || v === null ? '' : String(v));
function actions(mod: Module): Action[] {
  return [
    { id: 'veille_windows', label: 'Veille Windows (Microsoft)', what: 'Regarde maintenant sur le site de Microsoft si un Windows plus récent est sorti (et un nouveau Windows Server) ; télécharge ou prévient selon ton réglage', external: true, words: ['nouvelle version de windows', 'nouveau windows', 'veille windows'], run: async (ctx) => ({ text: await veilleWindows(ctx, mod) }) },
    { id: 'windows_microsoft', label: 'Windows chez Microsoft', what: 'La version actuelle, les éditions, les langues et l\'empreinte publiées par Microsoft (sans rien télécharger)', read: true, external: true,
      params: [{ key: 'produit', label: 'Produit', kind: 'select', options: PRODUITS.map((p) => p.id), default: 'windows11' }], words: ['éditions de windows', 'langues de windows'], run: async (ctx, i) => {
        const p = PRODUITS.find((x) => x.id === s(i.produit)) ?? PRODUITS[0], r = reglagesWindows(ctx.settings), f = ctx.fetch as unknown as Fetch;
        const pg = lirePageWindows(await lire(f, p.page).catch((e) => { throw new Error(`page officielle injoignable (${(e as Error).message}) : ${p.page}`); }));
        const ed = choisirEdition(pg.editions, r.edition);
        let langues = '';
        if (ed) { try { langues = (await languesWindows(f, ed.id, { session: randomUUID(), referer: p.page })).map((x) => x.nom).join(', '); } catch (e) { langues = `non données (${(e as Error).message})`; } }
        const lv = langueVoulue(r), sha = empreinteDe(pg, lv.fr);
        return { text: [`${p.nom} chez Microsoft : version ${pg.version ?? 'introuvable'}${pg.libelle ? ` (${pg.libelle})` : ''}`, `Éditions : ${pg.editions.map((e) => `${e.nom} [${e.id}]`).join(' ; ') || 'aucune'}`, `Langues${ed ? ` de « ${ed.nom} »` : ''} : ${langues || '—'}`, `Langue de l'ISO : ${lv.fr}${lv.parOdin ? ' (la langue d\'Odin)' : ' (ton choix)'}`, `Empreinte SHA-256 publiée (${lv.fr}, 64 bits) : ${sha ?? 'non publiée'}`, `Page officielle : ${p.page}`].join('\n'), data: { produit: p.id, ...pg, langues } };
      } },
    { id: 'reglage_windows', label: 'Réglage Windows', what: 'Langue et édition de l\'ISO, Windows 11 ARM 64, téléchargement tout seul ou seulement prévenir, heures creuses', quick: false,
      params: [{ key: 'langue', label: 'Langue de l\'ISO (vide : la langue d\'Odin)', kind: 'text', default: '' }, { key: 'edition', label: 'Édition (vide : celle par défaut)', kind: 'text', default: '' }, { key: 'arm64', label: 'Suivre aussi Windows 11 pour ARM 64', kind: 'boolean', default: false }, { key: 'auto', label: 'Télécharger tout seul (sinon : me prévenir)', kind: 'boolean', default: true }, { key: 'creuses', label: 'Heures creuses (HH:MM-HH:MM)', kind: 'text', default: '01:00-06:00' }],
      run: (ctx, i) => {
        const creuses = s(i.creuses).trim() || '01:00-06:00'; if (!/^\d{1,2}[:h]\d{2}\s*-\s*\d{1,2}[:h]\d{2}$/.test(creuses)) throw new Error('heures creuses sous la forme 01:00-06:00');
        const langue = s(i.langue).trim().slice(0, 40), edition = s(i.edition).trim().slice(0, 80), arm64 = i.arm64 === true || i.arm64 === 'true', auto = !(i.auto === false || i.auto === 'false');
        noter(ctx, { langue, edition, arm64, auto, creuses });
        const lv = langueVoulue({ langue });
        return { text: `🪟 Windows : ISO en ${lv.fr}${lv.parOdin ? ' (la langue d\'Odin)' : ''}${edition ? `, édition « ${edition} »` : ''}${arm64 ? ', ARM 64 suivi aussi' : ''} ; ${auto ? `téléchargée toute seule aux heures creuses (${creuses}) si Microsoft le permet` : 'je te préviens seulement'}.` };
      } },
  ];
}
function tache(): TacheAppli {
  return {
    id: 'veille_windows', nom: 'Veille Windows (Microsoft)', quoi: 'Regarde sur le site de Microsoft si une nouvelle version de Windows, un nouveau Windows ou un nouveau Windows Server est sorti ; prévient, et télécharge aux heures creuses si tu le veux.',
    rythme: (ctx) => reglagesWindows(ctx.settings).rythme ?? RYTHME,
    permis: ['jour', 'semaine', 'mois'],
    regler: (ctx, r) => { if (!['jour', 'semaine', 'mois'].includes(r.genre)) throw new Error('La veille Windows se règle chaque jour, chaque semaine ou chaque mois.'); noter(ctx, { rythme: r }); },
    lancer: { action: 'veille_windows' },
    dernier: (ctx) => { const d = reglagesWindows(ctx.settings).dernier; return d ? { at: new Date(d).toISOString() } : undefined; },
    prochain: (ctx, now) => { const r = reglagesWindows(ctx.settings); return prochaine((r.rythme ?? RYTHME) as Rythme, r.dernier ? new Date(Math.max(r.dernier, now.getTime() - 1)) : now); },
  };
}
function sections(ctx: ModCtx): Section[] {
  const r = reglagesWindows(ctx.settings);
  return [{ kind: 'form', onglet: 'Réglages', title: 'Windows (site de Microsoft)', action: 'reglage_windows', submit: 'Enregistrer', params: actions({} as Module).find((a) => a.id === 'reglage_windows')!.params!.map((p) => ({ ...p, default: (r as unknown as Record<string, unknown>)[p.key] ?? p.default })),
    aide: 'Odin lit la page officielle de Microsoft (version, empreintes) et demande le lien de l\'ISO au service de Microsoft. Si Microsoft refuse, Odin ne contourne rien : il te donne la page officielle et vérifie l\'empreinte quand tu déposes l\'ISO. Windows Server : le formulaire du centre d\'évaluation reste à remplir par toi.' }];
}

/** Ajoute la veille Windows à Andromède : actions, tâche Talos, passage chaque minute, réglages. */
export function installerWindows(mod: Module): void {
  mod.actions.push(...actions(mod));
  const taches = mod.taches; mod.taches = (ctx) => [...(taches?.(ctx) ?? []), tache()];
  const w = mod.watch; mod.watch = { every: w?.every ?? 60, async run(ctx) { if (w) await w.run(ctx); await tic(ctx, mod).catch(() => undefined); } };
  const v = mod.view.bind(mod); mod.view = async (ctx, q) => { const r = await v(ctx, q); return { ...r, sections: [...r.sections, ...sections(ctx)] }; };
}
