// Plume partout : le correcteur pendant qu'on écrit, dans l'interface d'Odin, ses applis et Pégase, et pour l'IA.
//   - le réglage de chaque personne (Persona ; le propriétaire a le sien) : activé, où, grammaire, langue, son
//     dictionnaire, ce qu'elle a ignoré — rangé dans les données de Plume (`partout.json`) ;
//   - la correction « en direct » (rapide : dictionnaire français, fautes d'usage, quelques règles de grammaire sûres,
//     et le correcteur de base ; LanguageTool s'il est relié) avec un petit cache en mémoire (2 minutes) ;
//   - l'aide à l'IA : quand le propriétaire demande de corriger un texte ou un fichier, Plume le relit d'abord
//     (seulement si Plume est activé avec « Odin se sert de Plume »).
// Contrat : docs/plume-protocole.md. Le texte ne part jamais sur Internet (LanguageTool est installé à côté d'Odin).

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { basename, join, resolve, sep } from 'node:path';
import type { ModCtx } from '../types.ts';
import { corrigerLanguageTool, corrigerMaison, type Faute } from './correcteur.ts';
import { dicoFrancais, motJuste, propositions } from './orthographe.ts';

export type GenreFaute = 'orthographe' | 'frappe' | 'grammaire';
export interface FautePlume { id: string; debut: number; fin: number; genre: GenreFaute; avant: string; propositions: string[]; raison: string; regle: string }
export interface Ignore { avant: string; regle: string }
export interface ReglagePlume { actif: boolean; odin: boolean; pegase: boolean; ia: boolean; grammaire: boolean; langue: string; dico: string[]; ignores: Ignore[]; depuis: number | null; maj: number }
export type Champ = 'texte' | 'ligne' | 'recherche';

export const PROPRIETAIRE = '@proprietaire';
export const LANGUES = ['fr', 'en-US', 'en-GB', 'de-DE', 'es', 'it', 'pt-PT'];
export const MAX_TEXTE_VIF = 20_000;
const MAX_LISTE = 2000;
const defaut = (): ReglagePlume => ({ actif: true, odin: true, pegase: true, ia: true, grammaire: true, langue: 'fr', dico: [], ignores: [], depuis: null, maj: 0 });
const s = (x: unknown) => (typeof x === 'string' ? x : x === undefined || x === null ? '' : String(x));

// ---------------- Le contexte de Plume (branché quand l'appli démarre) ----------------
let ctxP: ModCtx | undefined;
export function brancherPlume(ctx: ModCtx | undefined): void { ctxP = ctx; memoire = undefined; }
/** Le contexte de Plume ; `v` (Valhalla) le retrouve si l'appli n'a pas encore fini de démarrer. */
export function plumeCtx(v?: { module(id: string): unknown; ctx(id: string): ModCtx }): ModCtx | undefined {
  if (!ctxP && v?.module('snotra')) ctxP = v.ctx('snotra');
  return ctxP;
}

// ---------------- Les réglages, par personne ----------------
interface Fichier { v: 1; personnes: Record<string, ReglagePlume> }
let memoire: { dir: string; f: Fichier } | undefined;
function fichier(ctx: ModCtx): Fichier {
  if (memoire?.dir === ctx.dir) return memoire.f;
  let f: Fichier = { v: 1, personnes: {} };
  try { const j = JSON.parse(readFileSync(join(ctx.dir, 'partout.json'), 'utf8')) as Fichier; if (j && typeof j.personnes === 'object') f = { v: 1, personnes: j.personnes }; } catch { /* premier lancement */ }
  memoire = { dir: ctx.dir, f }; return f;
}
function ecrire(ctx: ModCtx, f: Fichier): void {
  mkdirSync(ctx.dir, { recursive: true });
  const p = join(ctx.dir, 'partout.json'), tmp = `${p}.tmp`;
  writeFileSync(tmp, JSON.stringify(f), { mode: 0o600 }); renameSync(tmp, p); memoire = { dir: ctx.dir, f };
}
/** Le réglage d'une personne (celui par défaut si elle n'a encore rien changé : Plume activé partout). */
export function reglage(ctx: ModCtx, cle: string): ReglagePlume { return { ...defaut(), ...(fichier(ctx).personnes[cle] ?? {}) }; }
/** Change le réglage d'une personne (les champs inconnus ou mal formés sont laissés de côté). */
export function changer(ctx: ModCtx, cle: string, patch: Record<string, unknown>): ReglagePlume {
  const f = fichier(ctx), avant = reglage(ctx, cle), r: ReglagePlume = { ...avant };
  for (const k of ['actif', 'odin', 'pegase', 'ia', 'grammaire'] as const) if (typeof patch[k] === 'boolean') r[k] = patch[k] as boolean;
  if (typeof patch.langue === 'string' && LANGUES.includes(patch.langue)) r.langue = patch.langue;
  if (Array.isArray(patch.dico)) r.dico = (patch.dico as unknown[]).map(s).filter(motPermis).slice(0, MAX_LISTE);
  if (Array.isArray(patch.ignores)) r.ignores = (patch.ignores as Ignore[]).filter((x) => x && typeof x.avant === 'string').map((x) => ({ avant: x.avant.slice(0, 200), regle: s(x.regle).slice(0, 80) })).slice(-MAX_LISTE);
  if (r.actif !== avant.actif) r.depuis = r.actif ? null : ctx.now().getTime();
  r.maj = Math.max(ctx.now().getTime(), avant.maj + 1);
  ecrire(ctx, { ...f, personnes: { ...f.personnes, [cle]: r } }); cache.clear();
  return r;
}
const motPermis = (m: string) => m.length >= 1 && m.length <= 60 && !/\s/.test(m);
export function ajouterMot(ctx: ModCtx, cle: string, mot: string): ReglagePlume | string {
  const m = mot.trim(); if (!motPermis(m)) return 'Un mot : 1 à 60 caractères, sans espace.';
  const r = reglage(ctx, cle); if (r.dico.includes(m)) return r; if (r.dico.length >= MAX_LISTE) return `Ton dictionnaire est plein (${MAX_LISTE} mots) : retires-en quelques-uns.`;
  return changer(ctx, cle, { dico: [...r.dico, m] });
}
export const retirerMot = (ctx: ModCtx, cle: string, mot: string) => changer(ctx, cle, { dico: reglage(ctx, cle).dico.filter((x) => x !== mot.trim()) });
export function ignorer(ctx: ModCtx, cle: string, x: Ignore): ReglagePlume {
  const r = reglage(ctx, cle), i = { avant: s(x.avant).slice(0, 200), regle: s(x.regle).slice(0, 80) };
  if (!i.avant || r.ignores.some((y) => y.avant === i.avant && y.regle === i.regle)) return r;
  return changer(ctx, cle, { ignores: [...r.ignores, i] });
}
export const plusIgnorer = (ctx: ModCtx, cle: string, x: Ignore) => changer(ctx, cle, { ignores: reglage(ctx, cle).ignores.filter((y) => !(y.avant === s(x.avant) && y.regle === s(x.regle))) });

/** L'état rendu aux clients (sans les listes : seulement leur taille). */
export function etatPublic(ctx: ModCtx, cle: string, personne = '') {
  const r = reglage(ctx, cle);
  return { ok: true, actif: r.actif, odin: r.odin, pegase: r.pegase, ia: r.ia, grammaire: r.grammaire, langue: r.langue, correcteur: s(ctx.settings.languagetool) ? 'LanguageTool' : 'maison', dictionnaire: r.dico.length, ignores: r.ignores.length, depuis: r.depuis, maj: r.maj, personne };
}

// ---------------- L'IA d'Odin ----------------
let appelsIA = 0;
/** Combien de fois l'IA s'est servie de Plume (pour les essais : rien quand Plume est coupé). */
export const appelsDeLIA = () => appelsIA;
/** L'IA d'Odin (celle du propriétaire) peut-elle se servir de Plume ? Plume activé, avec « Odin se sert de Plume ». */
export function plumePourIA(v?: { module(id: string): unknown; ctx(id: string): ModCtx }): boolean { const c = plumeCtx(v); if (!c) return false; const r = reglage(c, PROPRIETAIRE); return r.actif && r.ia; }
export const REFUS_IA = 'Plume est désactivé (Réglages → Plume) : je ne m\'en sers pas. Rallume-le dans Réglages → Plume si tu veux que je relise avec lui.';

// ---------------- La correction en direct ----------------
const id = (d: number, avant: string, regle: string) => createHash('sha1').update(`${d}:${avant}:${regle}`).digest('hex').slice(0, 8);
/** Mots composés souvent écrits sans trait d'union (on n'y met que des cas sûrs). */
const COMPOSES: Array<[RegExp, string, GenreFaute, string]> = [
  [/(?<!vous )rendez vous/giu, 'rendez-vous', 'orthographe', 'Le nom « rendez-vous » s\'écrit avec un trait d\'union.'],
  [/est ce qu(e|')/giu, 'est-ce qu$1', 'grammaire', 'Dans une question, « est-ce » prend un trait d\'union.'],
  [/c'est à dire/giu, 'c\'est-à-dire', 'orthographe', '« c\'est-à-dire » prend deux traits d\'union.'],
  [/au dess(us|ous)/giu, 'au-dess$1', 'orthographe', '« au-dessus », « au-dessous » prennent un trait d\'union.'],
  [/ci (joint|jointe|joints|jointes|dessous|dessus|contre)/giu, 'ci-$1', 'orthographe', 'Avec « ci- », un trait d\'union.'],
  [/(celui|celle|ceux|celles) (ci|là)/giu, '$1-$2', 'orthographe', 'Avec « -ci » et « -là », un trait d\'union.'],
  [/là (bas|dessus|dessous|dedans|haut)/giu, 'là-$1', 'orthographe', 'Avec « là- », un trait d\'union.'],
  [/week end/giu, 'week-end', 'orthographe', '« week-end » s\'écrit avec un trait d\'union.'],
  [/après midi/giu, 'après-midi', 'orthographe', 'Le nom « après-midi » s\'écrit avec un trait d\'union.'],
  [/vis à vis/giu, 'vis-à-vis', 'orthographe', '« vis-à-vis » prend deux traits d\'union.'],
  [/grand (mère|père|mères|pères|parents)/giu, 'grand-$1', 'orthographe', 'Un trait d\'union : « grand-mère », « grand-père ».'],
  [/a peu près/giu, 'à peu près', 'orthographe', '« à peu près » : « à » prend un accent.'],
];
/** Impératif + pronom : « rappelle moi » → « rappelle-moi » (seulement au début d'une phrase ou après « et », « puis », « mais », une virgule). */
const IMPERATIFS = 'dis|dites|donne|donnez|rappelle|rappelez|appelle|appelez|envoie|envoyez|montre|montrez|écris|écrivez|explique|expliquez|aide|aidez|laisse|laissez|préviens|prévenez|excuse|excusez|attends|attendez|regarde|regardez|écoute|écoutez|fais|faites|prête|prêtez|passe|passez|réveille|réveillez|tiens|tenez|apporte|apportez|indique|indiquez|corrige|corrigez|lis|lisez|trouve|trouvez|garde|gardez|mets|mettez|réponds|répondez|rejoins|rejoignez|suis|suivez|crois|croyez|souviens|souvenez|dépêche|dépêchez|occupe|occupez|calme|calmez|tais|taisez|sers|servez|ramène|ramenez|amène|amenez|emmène|emmenez|réserve|réservez|achète|achetez|parle|parlez|raconte|racontez|demande|demandez|pardonne|pardonnez|écrivons|allons';
const RE_IMPERATIF = new RegExp(`(^|[.!?;,:]\\s*|\\n\\s*|(?<![\\p{L}])(?:et|puis|mais|alors|ensuite|stp|svp)\\s+)((?:${IMPERATIFS}|\\p{L}{3,}ez) (?:moi|toi|lui|nous|leur))(?=[\\s.,!?;:]|$)`, 'giu');

/** Les zones qu'on ne corrige pas : adresses web, e-mails, @noms, #mots, `code`, chemins, mots avec des chiffres. */
const PROTEGE = /(?:https?:\/\/|www\.)\S+|\S+@\S+\.\S+|[@#][\p{L}\d_.-]+|`[^`\n]*`|\S*[\\/]\S*|\S*\d\S*|\S*_\S*/gu;
const MOT = /\p{L}[\p{L}\p{M}'’-]*/gu;
/** Les mots inconnus déjà vus et leurs propositions (la frappe redemande souvent les mêmes). */
const memo = new Map<string, Array<{ mot: string; genre: 'orthographe' | 'frappe' }>>();

interface OptionsVif { grammaire: boolean; champ: Champ; langue: string; dico: string[]; ignores: Ignore[] }
const cache = new Map<string, { at: number; r: { fautes: FautePlume[]; moteur: 'maison' | 'LanguageTool' } }>();
const CACHE_MS = 120_000;

/** Les fautes d'un texte, pour les soulignements. Rapide : quelques millisecondes avec le correcteur de base. */
export async function corrigerVif(ctx: ModCtx | undefined, texte: string, o: OptionsVif): Promise<{ fautes: FautePlume[]; moteur: 'maison' | 'LanguageTool'; ms: number }> {
  const t0 = performance.now(), lt = ctx ? s(ctx.settings.languagetool) : '';
  const cle = createHash('sha1').update(JSON.stringify([texte, o.grammaire, o.champ, o.langue, o.dico.length, o.ignores.length, lt])).digest('hex');
  const vu = cache.get(cle);
  if (vu && Date.now() - vu.at < CACHE_MS) return { ...vu.r, ms: Math.round(performance.now() - t0) };
  let fautes: FautePlume[] | undefined, moteur: 'maison' | 'LanguageTool' = 'maison';
  if (lt && ctx) {
    try { fautes = depuisLanguageTool(texte, await corrigerLanguageTool((u, i) => ctx.fetch(u, { ...i, signal: AbortSignal.timeout(3000) }), lt, texte, o.langue), o.champ); moteur = 'LanguageTool'; } catch { fautes = undefined; }
  }
  if (!fautes) fautes = o.langue.startsWith('fr') ? fautesFrancais(texte, o.champ) : [];
  const dico = new Set(o.dico.map((m) => m.toLowerCase()));
  fautes = fautes.filter((f) => (o.grammaire || f.genre !== 'grammaire') && !dico.has(f.avant.toLowerCase()) && !o.ignores.some((i) => i.avant === f.avant && (!i.regle || i.regle === f.regle)));
  const r = { fautes, moteur };
  if (cache.size > 300) for (const [k, v] of cache) if (Date.now() - v.at > CACHE_MS || cache.size > 250) cache.delete(k);
  cache.set(cle, { at: Date.now(), r });
  return { ...r, ms: Math.round(performance.now() - t0) };
}
/** Vide le cache (essais). */
export const viderCache = () => cache.clear();

/** Le correcteur français en direct : sûr plutôt que bavard. Pur (en dehors du dictionnaire chargé une fois). */
export function fautesFrancais(texte: string, champ: Champ = 'texte'): FautePlume[] {
  const out: Array<FautePlume & { rang: number }> = [];
  const f = (debut: number, fin: number, genre: GenreFaute, props: string[], raison: string, regle: string, rang: number) => { const avant = texte.slice(debut, fin); out.push({ id: id(debut, avant, regle), debut, fin, genre, avant, propositions: props.filter((p) => p !== avant).slice(0, 3), raison, regle, rang }); };
  const garde = (avant: string, p: string) => (avant[0] && avant[0] !== avant[0].toLowerCase() ? p[0].toUpperCase() + p.slice(1) : p);
  let m: RegExpExecArray | null;
  // 1) Mots composés et impératifs (règles maison sûres).
  for (const [re0, vers, genre, raison] of COMPOSES) {
    const re = new RegExp(`(?<![\\p{L}'’-])${re0.source}(?![\\p{L}-])`, 'giu');
    while ((m = re.exec(texte))) f(m.index, m.index + m[0].length, genre, [garde(m[0], m[0].replace(new RegExp(re0.source, 'iu'), vers))], raison, genre === 'grammaire' ? 'EST_CE_QUE' : 'MOT_COMPOSE', 0);
  }
  for (RE_IMPERATIF.lastIndex = 0; (m = RE_IMPERATIF.exec(texte));) {
    const d = m.index + m[1].length, x = m[2];
    f(d, d + x.length, 'grammaire', [x.replace(' ', '-')], 'Impératif suivi d\'un pronom : un trait d\'union.', 'IMPERATIF_PRONOM', 0);
  }
  // 2) Le correcteur de base (usages, accords, espaces, majuscules) : sans les espaces insécables (invisibles à l'écran).
  for (const x of corrigerMaison(texte)) {
    if (x.regle === 'ESPACE_PONCTUATION') continue;
    if (champ !== 'texte' && (x.regle === 'MAJUSCULE_PHRASE' || x.regle === 'ESPACE_AVANT_VIRGULE')) continue;
    const genre: GenreFaute = x.regle === 'USAGE' ? 'orthographe' : x.regle === 'MOT_REPETE' ? 'frappe' : 'grammaire';
    // « l » → « L » se lit mal : la majuscule porte sur le mot entier (« les » → « Les »).
    const n = x.regle === 'MAJUSCULE_PHRASE' ? (/^\p{L}+/u.exec(texte.slice(x.debut))?.[0].length ?? 1) : x.longueur;
    const sug = x.regle === 'MAJUSCULE_PHRASE' ? x.suggestions.map((y) => y + texte.slice(x.debut + 1, x.debut + n)) : x.suggestions;
    f(x.debut, x.debut + n, genre, sug, raisonMaison(x), x.regle, x.regle === 'USAGE' ? 1 : 3);
  }
  // 3) L'orthographe, mot à mot (dictionnaire français).
  const t0 = performance.now(), d = dicoFrancais(), proteges: Array<[number, number]> = [];
  for (const re = new RegExp(PROTEGE.source, 'gu'); (m = re.exec(texte));) proteges.push([m.index, m.index + m[0].length]);
  for (const re = new RegExp(MOT.source, 'gu'); (m = re.exec(texte));) {
    const brut = m[0].replace(/['’-]+$/, ''), debut = m.index, fin = debut + brut.length;
    if (brut.length < 2 || proteges.some(([a, b]) => debut < b && a < fin)) continue;
    if (brut[0] !== brut[0].toLowerCase() || /\p{Lu}/u.test(brut.slice(1))) continue; // noms propres, sigles, CamelCase : on n'y touche pas
    let p = memo.get(brut);
    if (!p) {
      if (motJuste(d, brut)) continue;
      if (performance.now() - t0 > 110) continue; // trop de mots inconnus d'un coup : la suite au prochain appel (rester sous 150 ms)
      p = propositions(d, brut, 3); if (memo.size > 5000) memo.clear(); memo.set(brut, p);
    }
    if (!p.length) continue;
    const accent = p[0].mot.normalize('NFD').replace(/[̀-ͯ]/g, '') === brut.normalize('NFD').replace(/[̀-ͯ]/g, '');
    f(debut, fin, p[0].genre, p.map((x) => x.mot), p[0].genre === 'frappe' ? 'Faute de frappe probable.' : accent ? `Un accent manque ou n'est pas le bon : « ${p[0].mot} ».` : `Ce mot s'écrit « ${p[0].mot} ».`, p[0].genre === 'frappe' ? 'FRAPPE' : 'ORTHOGRAPHE', 2);
  }
  // Une faute dans une autre : on garde la plus sûre (règles maison, puis usages, puis orthographe, puis le reste).
  out.sort((a, b) => a.rang - b.rang || a.debut - b.debut);
  const garde2: Array<FautePlume & { rang: number }> = [];
  for (const x of out) if (!garde2.some((y) => x.debut < y.fin && y.debut < x.fin)) garde2.push(x);
  return garde2.sort((a, b) => a.debut - b.debut).map(({ rang: _r, ...x }) => x as FautePlume);
}
function raisonMaison(x: Faute): string {
  const m = x.message.replace(/\s+/g, ' ').trim();
  return /[.!?]$/.test(m) ? m : `${m}.`;
}
/** Les fautes de LanguageTool → les nôtres (sans les espaces insécables, invisibles à l'écran). */
function depuisLanguageTool(texte: string, l: Faute[], champ: Champ): FautePlume[] {
  return l.filter((x) => x.longueur > 0 && !/WHITESPACE|ESPACE|NBSP|APOS_TYP|GUILLEMETS/i.test(x.regle) && !(champ !== 'texte' && /UPPERCASE|MAJUSCULE/i.test(x.regle))).map((x) => {
    const avant = texte.slice(x.debut, x.debut + x.longueur), cat = s((x as Faute & { categorie?: string }).categorie);
    const genre: GenreFaute = /misspelling|TYPOS/i.test(cat) ? (/TYPO/i.test(x.regle) ? 'frappe' : 'orthographe') : 'grammaire';
    return { id: id(x.debut, avant, x.regle), debut: x.debut, fin: x.debut + x.longueur, genre, avant, propositions: x.suggestions.slice(0, 3), raison: x.message, regle: x.regle };
  });
}

// ---------------- L'aide à l'IA ----------------
const DEMANDE = /(?<![\p{L}])(corrig\p{L}*|correction|relis|relire|relecture|orthographe|fautes?|grammaire|conjugu\p{L}*|conjugaison|accorde?|accords|ponctuation|s['’][eé]cri\p{L}*|comment (?:on |ça |ca )?[eé]cri\p{L}*|bien [eé]crit|mal [eé]crit)(?![\p{L}])/iu;
/**
 * Ce que Plume ajoute au message du propriétaire pour l'IA (vide si ce n'est pas une demande sur l'écriture, ou si
 * Plume est coupé : alors Plume n'est même pas appelé). `workspace` : le dossier où arrivent les fichiers joints.
 */
export async function indiceIA(message: string, workspace = ''): Promise<string> {
  if (!DEMANDE.test(message)) return '';
  if (!ctxP) { const { valhallaOf } = await import('../odin.ts'); plumeCtx(valhallaOf()); }
  if (!plumePourIA()) return '';
  const ctx = ctxP!, r = reglage(ctx, PROPRIETAIRE);
  let texte = '', quoi = 'le texte du message';
  // Un document joint (inbox/…) ou nommé (« corrige le fichier devis.docx »).
  const joint = /(?:^|[\s(\[])(inbox\/[^\s\])]+)/.exec(message)?.[1], nomme = /([\p{L}\d_.-]{1,80}\.(?:docx|odt|md|txt|rtf|html))(?![\p{L}\d])/iu.exec(message)?.[1]?.trim();
  if (workspace && (joint || nomme)) {
    const chemin = trouverFichier(workspace, joint, nomme);
    if (chemin) {
      try { const { texteDe } = await import('../modules/snotra.ts'); texte = texteDe(chemin, readFileSync(chemin)).slice(0, MAX_TEXTE_VIF); quoi = `le document ${basename(chemin)}`; } catch { texte = ''; }
    }
  }
  if (!texte) {
    const cite = /«\s*([\s\S]{3,}?)\s*»|"([^"]{3,})"|“([^”]{3,})”/.exec(message), apres = /:\s*\n?([\s\S]{3,})$/.exec(message.split('\n\n[')[0]);
    texte = (cite ? (cite[1] ?? cite[2] ?? cite[3]) : apres ? apres[1] : message.split('\n\n[')[0]).slice(0, MAX_TEXTE_VIF);
    if (cite || apres) quoi = 'le texte à corriger';
  }
  if (!texte.trim()) return '';
  appelsIA++;
  const c = await corrigerVif(ctx, texte, { grammaire: r.grammaire, champ: 'texte', langue: r.langue, dico: r.dico, ignores: [] });
  const liste = c.fautes.slice(0, 15).map((f) => `« ${f.avant} » → ${f.propositions.length ? f.propositions.map((p) => `« ${p} »`).join(' ou ') : '(à revoir)'} (${f.genre} : ${f.raison})`).join(' ; ');
  return `\n\n[Plume, le correcteur d'Odin, est activé et a relu ${quoi} (correcteur ${c.moteur === 'maison' ? 'de base' : 'LanguageTool'}) : ${c.fautes.length ? `${c.fautes.length} faute(s) — ${liste}${c.fautes.length > 15 ? ' ; …' : ''}` : 'aucune faute trouvée (il ne voit pas tout)'}. Sers-t'en dans ta réponse et commence-la par « Odin, avec Plume : ».]`;
}
function trouverFichier(workspace: string, joint?: string, nomme?: string): string | undefined {
  const racine = resolve(workspace), dans = (p: string) => p.startsWith(racine + sep) && existsSync(p) && statSync(p).isFile();
  if (joint) { const p = resolve(racine, joint); if (dans(p)) return p; }
  if (nomme) for (const dir of [join(racine, 'inbox'), racine]) {
    try { const n = readdirSync(dir).find((x) => x.toLowerCase() === basename(nomme).toLowerCase()); if (n && dans(join(dir, n))) return join(dir, n); } catch { /* pas de dossier */ }
  }
  return undefined;
}
