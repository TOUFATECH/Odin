// Export et partage des pages d'applis · la page « propre ».
// On part de ce que rend la page d'une appli (`module.view(ctx, q)`) et on en garde les données : chiffres clés,
// tableaux, listes, cartes, journaux, textes, barres, courbes, étapes, graphes. Tout ce qui sert à agir ou à
// dessiner est retiré (formulaires, boutons, icônes, couleurs, tailles). Chaque texte passe par la passe de masquage.
// Cette page propre sert à tout : fichier Markdown, JSON, Word, PDF, et copie figée d'un partage.
//
// Certaines applis ne sortent pas d'Odin (ni export, ni partage) : le coffre de mots de passe, les identités, et
// celles dont les réglages sont un fichier secret pour Heimdall (`SECRET_FILES`). D'autres sortent sans une section.
// La raison est dite telle quelle à l'utilisateur.

import { join } from 'node:path';
import { isSecretFile } from '../../heimdall/policy.ts';
import type { Valhalla } from '../service.ts';
import type { GraphDetail, Module, Section, Tone, View } from '../types.ts';
import { creerMasqueur, type Masqueur } from './masque.ts';

export interface KpiExport { label: string; value: string; pct?: number; tone?: Tone; hint?: string }
export interface DetailExport { kind: string; title: string; subtitle?: string; chips?: Array<{ label: string; tone?: Tone }>; rows?: Array<{ k: string; v: string; src?: string }>; list?: { title: string; items: Array<{ text: string; meta?: string; tone?: Tone }> } }
/** Une section de la page, sans bouton ni dessin (mêmes mots que le modèle des pages, `types.ts`). */
export type SectionExport = { /** son onglet, quand la page en a */ onglet?: string } & (
  | { kind: 'table'; title: string; columns: string[]; rows: Array<{ cells: string[]; tone?: Tone }>; empty?: string }
  | { kind: 'list'; title: string; items: Array<{ title: string; detail?: string; meta?: string; tone?: Tone }>; empty?: string }
  | { kind: 'cards'; title: string; items: Array<{ title: string; sub?: string; badge?: string; meta?: string; progress?: number; tone?: Tone }>; empty?: string }
  | { kind: 'log'; title: string; lines: string[] }
  | { kind: 'text'; title: string; text: string; tone?: Tone }
  | { kind: 'bars'; title: string; items: Array<{ label: string; value: number; display?: string }> }
  | { kind: 'courbe'; title: string; labels: string[]; series: Array<{ name: string; tone?: Tone; points: number[] }>; unit?: string; empty?: string }
  | { kind: 'steps'; title: string; items: Array<{ title: string; detail?: string; done: boolean }> }
  | { kind: 'graph'; title: string; nodes: Array<{ id: string; label: string; sub?: string; off?: boolean }>; edges: Array<{ a: string; b: string; title?: string; arrow?: 'to' | 'both' }>; details: Record<string, DetailExport>; period?: string; empty?: string }
);
/** La page d'une appli, prête à sortir d'Odin : c'est aussi le contenu du fichier JSON et de la copie figée d'un partage. */
export interface PageExport {
  /** version de ce format */
  odin: 1;
  /** quand la page a été prise (date ISO) */
  at: string;
  app: { id: string; name: string; family: string; what: string };
  subtitle?: string;
  /** l'onglet gardé (absent : toute la page) */
  onglet?: string;
  /** les onglets de la page, quand elle en a */
  onglets?: string[];
  /** le poste regardé, quand la page sait travailler sur un autre poste */
  poste?: string;
  kpis: KpiExport[];
  sections: SectionExport[];
  /** ce qui manque dans cette copie, et pourquoi (section retirée par prudence, tableau trop long coupé) */
  retire: Array<{ title: string; why: string }>;
  /** combien de valeurs ont été masquées par sécurité */
  masques: number;
}

// ---------------------------------------------------------------- Ce qui ne sort pas d'Odin

/** Les applis dont la page ne sort jamais d'Odin, et pourquoi (dit tel quel à l'utilisateur). */
const REFUS: Record<string, (nom: string) => string> = {
  brisingamen: (n) => `${n} est ton coffre de mots de passe : sa page ne s'exporte pas et ne se partage pas.`,
  var: (n) => `${n} garde les comptes des personnes, leurs sessions et le journal des connexions : sa page reste dans Odin.`,
  skidbladnir: (n) => `${n} garde tes liens de partage, les mots de passe d'appli et les notes secrètes : sa page reste dans Odin.`,
  gladsheim: (n) => `${n} garde les positions de la famille et les clés des tablettes : sa page reste dans Odin.`,
};
/** Les sections qui restent dans Odin (l'appli sort, mais pas en entier) : le titre attendu, ce que c'est, et pourquoi. */
const RETRAITS: Record<string, Array<{ titre: RegExp; quoi: string; pourquoi: string }>> = {
  valgrind: [{ titre: /^Journal/i, quoi: 'Le journal des requêtes', pourquoi: 'il montre les adresses de tes visiteurs et les liens qu\'ils demandent' }],
  urdr: [{ titre: /^Journal des requêtes/i, quoi: 'Le journal des requêtes', pourquoi: 'les requêtes peuvent contenir le contenu de tes bases' }],
  loki: [{ titre: /^Identifiants les plus essayés/i, quoi: 'Les identifiants les plus essayés', pourquoi: 'ce sont des identifiants et des mots de passe essayés par des attaquants' }],
};
/** Au-delà, un tableau, une liste ou un journal est coupé (et la copie le dit). */
export const MAX_LIGNES = 10_000;

/**
 * Pourquoi la page de cette appli ne sort pas d'Odin (rien : elle peut sortir). Vaut pour l'export comme pour le
 * partage. Une appli dont les réglages sont un fichier secret pour Heimdall est refusée d'office, même si personne
 * ne l'a ajoutée à la liste ci-dessus.
 */
export function refusDe(m: Pick<Module, 'id' | 'name'>): string | undefined {
  if (Object.hasOwn(REFUS, m.id)) return REFUS[m.id](m.name);
  if (isSecretFile(join('.odin', 'valhalla', m.id, 'réglages.json'))) return `Les réglages de ${m.name} sont rangés avec les secrets d'Odin : sa page reste dans Odin.`;
  return undefined;
}
/** Les sections de cette appli qui restent dans Odin : titre attendu et raison. */
export const retraitsDe = (id: string): Array<{ titre: RegExp; quoi: string; pourquoi: string }> => (Object.hasOwn(RETRAITS, id) ? RETRAITS[id] : []);

// ---------------------------------------------------------------- De la vue à la page propre

const TONS = new Set<string>(['bon', 'attention', 'mauvais', 'neutre']);
/** Un texte sûr à écrire partout : pas de caractère de commande, fins de ligne simples, pas de demi-caractère. */
export function propre(v: unknown): string {
  const t = (v === undefined || v === null ? '' : String(v)).replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u200B\u2028\u2029\uFEFF]/g, '');
  // Un demi-caractère isolé (donnée abîmée) casserait le XML d'un fichier Word : il est remplacé.
  const entier = (t as unknown as { toWellFormed?: () => string }).toWellFormed;
  return typeof entier === 'function' ? entier.call(t) : t;
}
const ton = (t: unknown): Tone | undefined => (typeof t === 'string' && TONS.has(t) && t !== 'neutre' ? t as Tone : undefined);
const nombre = (v: unknown): number => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const sansVide = <T extends object>(o: T): T => { for (const k of Object.keys(o) as Array<keyof T>) if (o[k] === undefined || o[k] === '') delete o[k]; return o; };
const simple = (t: string) => t.toLowerCase().normalize('NFD').replace(/[\u0300-\u036F]/g, '').trim();

function detail(d: GraphDetail, k: Masqueur): DetailExport {
  return sansVide({
    kind: propre(d.kind), title: k.texte(propre(d.title)), subtitle: d.subtitle ? k.texte(propre(d.subtitle)) : undefined,
    chips: d.chips?.length ? d.chips.map((c) => sansVide({ label: k.texte(propre(c.label)), tone: ton(c.tone) })) : undefined,
    rows: d.rows?.length ? d.rows.map((r) => sansVide({ k: propre(r.k), v: k.sous(propre(r.k), propre(r.v)), src: r.src ? k.texte(propre(r.src)) : undefined })) : undefined,
    list: d.list ? { title: propre(d.list.title), items: (d.list.items ?? []).map((i) => sansVide({ text: k.texte(propre(i.text)), meta: i.meta ? k.texte(propre(i.meta)) : undefined, tone: ton(i.tone) })) } : undefined,
  });
}

/** Une section de la vue, sans bouton ni dessin, textes masqués. Un formulaire ne donne rien (ce n'est pas une donnée). */
function section(s: Section, k: Masqueur, coupes: Array<{ title: string; why: string }>): SectionExport | undefined {
  const title = propre(s.title);
  const coupe = <T>(l: T[] | undefined, quoi: string): T[] => {
    const tout = Array.isArray(l) ? l : [];
    if (tout.length <= MAX_LIGNES) return tout;
    coupes.push({ title, why: `${quoi} coupé à ${MAX_LIGNES.toLocaleString('fr-FR')} lignes (il en a ${tout.length.toLocaleString('fr-FR')})` });
    return tout.slice(0, MAX_LIGNES);
  };
  switch (s.kind) {
    case 'form': return undefined;
    case 'table': {
      const columns = (s.columns ?? []).map(propre);
      return sansVide({ kind: 'table' as const, title, columns, rows: coupe(s.rows, 'tableau').map((r) => sansVide({ cells: columns.map((c, j) => k.sous(c, propre((r.cells ?? [])[j]))), tone: ton(r.tone) })), empty: s.empty ? propre(s.empty) : undefined });
    }
    case 'list': return sansVide({ kind: 'list' as const, title, items: coupe(s.items, 'liste').map((i) => sansVide({ title: k.texte(propre(i.title)), detail: i.detail ? k.sous(propre(i.title), propre(i.detail)) : undefined, meta: i.meta ? k.texte(propre(i.meta)) : undefined, tone: ton(i.tone) })), empty: s.empty ? propre(s.empty) : undefined });
    case 'cards': return sansVide({ kind: 'cards' as const, title, items: coupe(s.items, 'liste').map((c) => sansVide({ title: k.texte(propre(c.title)), sub: c.sub ? k.sous(propre(c.title), propre(c.sub)) : undefined, badge: c.badge ? k.texte(propre(c.badge)) : undefined, meta: c.meta ? k.texte(propre(c.meta)) : undefined, progress: typeof c.progress === 'number' && Number.isFinite(c.progress) ? Math.max(0, Math.min(1, c.progress)) : undefined, tone: ton(c.tone) })), empty: s.empty ? propre(s.empty) : undefined });
    case 'log': return { kind: 'log', title, lines: coupe(s.lines, 'journal').map((l) => k.texte(propre(l))) };
    case 'text': return sansVide({ kind: 'text' as const, title, text: k.sous(title, propre(s.text)), tone: ton(s.tone) });
    case 'bars': return { kind: 'bars', title, items: coupe(s.items, 'liste').map((i) => sansVide({ label: k.texte(propre(i.label)), value: nombre(i.value), display: i.display !== undefined ? k.texte(propre(i.display)) : undefined })) };
    case 'courbe': {
      const labels = coupe(s.labels, 'courbe').map((l) => k.texte(propre(l)));
      return sansVide({ kind: 'courbe' as const, title, labels, series: (s.series ?? []).map((x) => sansVide({ name: k.texte(propre(x.name)), tone: ton(x.tone), points: (x.points ?? []).slice(0, labels.length || MAX_LIGNES).map(nombre) })), unit: s.unit ? propre(s.unit) : undefined, empty: s.empty ? propre(s.empty) : undefined });
    }
    case 'steps': return { kind: 'steps', title, items: (s.items ?? []).map((i) => sansVide({ title: k.texte(propre(i.title)), detail: i.detail ? k.sous(propre(i.title), propre(i.detail)) : undefined, done: i.done === true })) };
    case 'graph': {
      const nodes = coupe(s.nodes, 'graphe'), ids = new Set(nodes.map((n) => String(n.id)));
      const p = s.periods, periode = p ? [p.options?.find((o) => o.id === p.current)?.label, p.when].filter(Boolean).map(propre).join(' · ') : '';
      return sansVide({
        kind: 'graph' as const, title,
        nodes: nodes.map((n) => sansVide({ id: propre(n.id), label: k.texte(propre(n.label)), sub: n.sub ? k.texte(propre(n.sub)) : undefined, off: n.off === true ? true : undefined })),
        edges: (s.edges ?? []).filter((e) => ids.has(String(e.a)) && ids.has(String(e.b))).map((e) => sansVide({ a: propre(e.a), b: propre(e.b), title: e.title ? k.texte(propre(e.title)) : undefined, arrow: e.arrow === 'to' || e.arrow === 'both' ? e.arrow : undefined })),
        details: Object.fromEntries(Object.entries(s.details ?? {}).filter(([id]) => ids.has(id)).map(([id, d]) => [propre(id), detail(d, k)])),
        period: periode || undefined, empty: s.empty ? propre(s.empty) : undefined,
      });
    }
    default: return undefined;
  }
}

/**
 * La page propre d'une appli à partir de sa vue. `onglet` : ne garder que cet onglet. `connus` : le masqueur d'Odin.
 * Rend une erreur lisible si l'onglet demandé n'existe pas. Pur.
 */
export function pageDepuisVue(m: Pick<Module, 'id' | 'name' | 'family' | 'what'>, vue: View, o: { quand: Date; onglet?: string; connus?: (t: string) => string }): PageExport | { erreur: string } {
  const k = creerMasqueur(o.connus), onglets = [...new Set((vue.onglets ?? []).map(propre).filter(Boolean))];
  const demande = propre(o.onglet).trim();
  let garde: string | undefined;
  if (demande) {
    if (!onglets.length) return { erreur: `La page de ${m.name} n'a pas d'onglets : prends-la en entier.` };
    garde = onglets.find((x) => simple(x) === simple(demande));
    if (!garde) return { erreur: `${m.name} n'a pas d'onglet « ${demande.slice(0, 40)} ». Ses onglets : ${onglets.join(', ')}.` };
  }
  const ongletDe = (s: Section): string | undefined => (onglets.length ? (s.onglet && onglets.includes(s.onglet) ? s.onglet : onglets[0]) : undefined);
  const retire: PageExport['retire'] = [], sections: SectionExport[] = [];
  for (const s of [...(vue.sections ?? []), ...(vue.side ?? [])]) {
    if (!s || typeof s !== 'object' || s.kind === 'form') continue;
    const og = ongletDe(s);
    if (garde && og !== garde) continue;
    const r = retraitsDe(m.id).find((x) => x.titre.test(String(s.title ?? '')));
    if (r) { retire.push({ title: propre(s.title), why: r.pourquoi }); continue; }
    const x = section(s, k, retire);
    if (x) sections.push(og ? { ...x, onglet: og } : x);
  }
  // Dans une page à onglets, les sections sortent rangées par onglet (dans l'ordre des onglets).
  if (onglets.length) sections.sort((a, b) => onglets.indexOf(a.onglet ?? '') - onglets.indexOf(b.onglet ?? ''));
  const kpis = (vue.kpis ?? []).map((x) => sansVide({ label: propre(x.label), value: k.sous(propre(x.label), propre(x.value)), pct: typeof x.pct === 'number' && Number.isFinite(x.pct) ? Math.max(0, Math.min(100, x.pct)) : undefined, tone: ton(x.tone), hint: x.hint ? k.texte(propre(x.hint)) : undefined }));
  const subtitle = vue.subtitle ? k.texte(propre(vue.subtitle)) : undefined;
  const poste = vue.postes ? propre(vue.postes.choix?.find((c) => c.id === vue.postes!.actuel)?.nom ?? 'Cette machine') : undefined;
  return sansVide({
    odin: 1 as const, at: o.quand.toISOString(), app: { id: m.id, name: m.name, family: m.family, what: propre(m.what) },
    subtitle, onglet: garde, onglets: onglets.length ? onglets : undefined, poste, kpis, sections, retire, masques: k.n(),
  });
}

/** Les sections rangées par onglet (un seul groupe sans nom quand la page n'a pas d'onglets, ou qu'un seul est gardé). */
export function groupes(p: PageExport): Array<{ onglet?: string; sections: SectionExport[] }> {
  if (!p.onglets?.length || p.onglet) return [{ sections: p.sections }];
  return p.onglets.map((o) => ({ onglet: o, sections: p.sections.filter((s) => s.onglet === o) })).filter((g) => g.sections.length);
}

/** Un texte « vide » qui donne une consigne propre à la page d'Odin (« ajoute… à droite ») n'a pas de sens dans une copie. */
const CONSIGNE = /à droite|à gauche|ci-dessous|ci-dessus|formulaire|bouton|\bajoute|\bclique|\bchoisis|\blance\b|\bouvre\b|\brègle\b|\bdonne\b|\btouche\b/i;
/** Rien à montrer dans cette section ? (tableau sans ligne, courbe à zéro…) : on écrit alors son texte « vide ». */
export function vide(s: SectionExport): string | undefined {
  const dit = (t: string | undefined, sinon: string) => (t && !CONSIGNE.test(t) ? t : sinon);
  switch (s.kind) {
    case 'table': return s.rows.length ? undefined : dit(s.empty, 'Rien pour l\'instant.');
    case 'list': case 'cards': return s.items.length ? undefined : dit(s.empty, 'Rien.');
    case 'log': return s.lines.length ? undefined : '—';
    case 'bars': case 'steps': return s.items.length ? undefined : 'Rien.';
    case 'courbe': return s.series.some((x) => x.points.some((v) => v > 0)) ? undefined : dit(s.empty, 'Rien pour l\'instant.');
    case 'graph': return s.nodes.length ? undefined : dit(s.empty, 'Rien pour l\'instant.');
    default: return undefined;
  }
}

const deux = (n: number) => String(n).padStart(2, '0');
/** « 13/11/2026 à 21:05 » (heure de la machine d'Odin). */
export const dateFr = (d: Date) => `${deux(d.getDate())}/${deux(d.getMonth() + 1)}/${d.getFullYear()} à ${deux(d.getHours())}:${deux(d.getMinutes())}`;
/** « 2026-11-13 » (jour de la machine d'Odin), pour les noms de fichiers. */
export const jourIso = (d: Date) => `${d.getFullYear()}-${deux(d.getMonth() + 1)}-${deux(d.getDate())}`;
/** La ligne « d'où ça vient » écrite en tête de chaque fichier et de chaque copie. */
export function provenance(p: PageExport): string {
  return [`Page ${p.app.name} d'Odin, prise le ${dateFr(new Date(p.at))}`, p.onglet ? `onglet « ${p.onglet} »` : '', p.poste ? `poste : ${p.poste}` : ''].filter(Boolean).join(' · ');
}
/** Ce que la copie dit de ce qui lui manque (sections restées dans Odin, valeurs masquées). */
export function manques(p: PageExport): string[] {
  return [...p.retire.map((r) => `« ${r.title} » n'est pas dans cette copie : ${r.why}.`), ...(p.masques ? [`${p.masques} valeur${p.masques > 1 ? 's' : ''} masquée${p.masques > 1 ? 's' : ''} par sécurité (${p.masques > 1 ? 'elles apparaissent' : 'elle apparaît'} comme « ••• »).`] : [])];
}

// ---------------------------------------------------------------- Prendre la page d'une appli

export type Prise = { ok: true; page: PageExport; module: Module } | { ok: false; code: 'inconnue' | 'refus' | 'onglet' | 'vue'; error: string };

/**
 * Prend la page d'une appli telle qu'elle est maintenant (mêmes réglages que la page : `poste`, période…, plus
 * `onglet` pour n'en garder qu'un). Refuse les applis qui ne sortent pas d'Odin, avec la raison.
 */
export async function prendre(va: Valhalla, id: string, q: URLSearchParams, o: { connus?: (t: string) => string } = {}): Promise<Prise> {
  const m = id ? va.module(id) : undefined;
  if (!m) return { ok: false, code: 'inconnue', error: 'Appli inconnue.' };
  const non = refusDe(m);
  if (non) return { ok: false, code: 'refus', error: non };
  const ctx = va.ctx(m.id);
  let vue: View;
  try { vue = await m.view(ctx, q); } catch (e) { return { ok: false, code: 'vue', error: `La page de ${m.name} ne s'est pas ouverte : ${(e as Error).message}` }; }
  const page = pageDepuisVue(m, vue, { quand: ctx.now(), onglet: q.get('onglet') ?? undefined, connus: o.connus });
  if ('erreur' in page) return { ok: false, code: 'onglet', error: page.erreur };
  return { ok: true, page, module: m };
}
