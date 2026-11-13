// Sýn — les tableaux de bord d'Odin (comme Grafana), sur les mesures qu'Odin garde déjà (Eir : machine,
// Vörðr : sites et appareils, Gjöll, Rán…). Un tableau = des panneaux ; un panneau = une ou plusieurs mesures
// (« eir.fs.* » prend toutes les mesures qui commencent par eir.fs.), affichées en courbe, en valeur ou en barres,
// avec un calcul (moyenne, maximum, minimum, dernière valeur) et des seuils orange / rouge qui préviennent.
// Modèles prêts : Machine, Réseau, Sites et appareils. Rien n'est envoyé hors de la machine d'Odin.
import { metrics, okName } from '../metrics.ts';
import type { Kpi, ModCtx, Module, Section, Tone } from '../types.ts';

const s = (v: unknown) => String(v ?? '').trim();
export type Kind = 'courbe' | 'valeur' | 'barres';
export type Calc = 'moyenne' | 'max' | 'min' | 'derniere';
export interface Panel { id: string; titre: string; series: string[]; type: Kind; calcul: Calc; unite?: string; attention?: number; grave?: number; /** seuils dans l'autre sens (signal Wi-Fi, disponibilité : plus bas = pire) */ bas?: boolean }
export interface Board { id: string; nom: string; periode: string; panneaux: Panel[] }

export const PERIODS: Record<string, number> = { '1h': 3600e3, '6h': 6 * 3600e3, '24h': 864e5, '7j': 7 * 864e5, '30j': 30 * 864e5, '1an': 365 * 864e5 };
const slug = (t: string) => t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'tableau';

/** Les modèles prêts à l'emploi. */
export const MODELES: Record<string, Omit<Board, 'id'>> = {
  machine: { nom: 'Machine', periode: '24h', panneaux: [
    { id: 'cpu', titre: 'Processeur', series: ['eir.cpu'], type: 'courbe', calcul: 'moyenne', unite: '%', attention: 75, grave: 90 },
    { id: 'mem', titre: 'Mémoire', series: ['eir.mem'], type: 'courbe', calcul: 'moyenne', unite: '%', attention: 85, grave: 95 },
    { id: 'disques', titre: 'Disques remplis', series: ['eir.fs.*'], type: 'barres', calcul: 'derniere', unite: '%', attention: 85, grave: 95 },
    { id: 'temp', titre: 'Températures', series: ['eir.temp.*'], type: 'courbe', calcul: 'max', unite: '°C', attention: 75, grave: 90 },
    { id: 'charge', titre: 'Charge', series: ['eir.load1', 'eir.load5', 'eir.load15'], type: 'courbe', calcul: 'moyenne' },
  ] },
  reseau: { nom: 'Réseau', periode: '24h', panneaux: [
    { id: 'debit', titre: 'Débit (octets / s)', series: ['eir.net.rx', 'eir.net.tx'], type: 'courbe', calcul: 'moyenne', unite: 'o/s' },
    { id: 'wifi', titre: 'Signal Wi-Fi', series: ['eir.wifi.*'], type: 'valeur', calcul: 'derniere', unite: 'dBm', attention: -70, grave: -80, bas: true },
    { id: 'tcp', titre: 'Connexions établies', series: ['eir.tcp'], type: 'courbe', calcul: 'moyenne' },
  ] },
  sites: { nom: 'Sites et appareils', periode: '24h', panneaux: [
    { id: 'temps', titre: 'Temps de réponse', series: ['vordr.temps.*'], type: 'courbe', calcul: 'moyenne', unite: 'ms', attention: 1500, grave: 5000 },
    { id: 'dispo', titre: 'Disponibilité', series: ['vordr.up.*'], type: 'barres', calcul: 'moyenne', unite: '%', attention: 99, grave: 95, bas: true },
  ] },
};

const boards = (ctx: ModCtx): Board[] => (ctx.settings.tableaux as Board[] | undefined) ?? [];
const saveBoards = (ctx: ModCtx, l: Board[]) => ctx.saveSettings({ tableaux: l });
const findBoard = (ctx: ModCtx, q: string) => { const l = boards(ctx), k = slug(q); const b = l.find((x) => x.id === k || slug(x.nom) === k) ?? (q ? undefined : l[0]); if (!b) throw new Error(`tableau introuvable : ${q || '(aucun)'}${l.length ? ` — tableaux : ${l.map((x) => x.nom).join(', ')}` : ' — crée-en un ou ajoute un modèle'}`); return b; };

/** Les mesures que vise une liste (« eir.fs.* » → toutes les mesures qui commencent par eir.fs.). Pur. */
export function expand(patterns: string[], known: string[]): string[] {
  const out = new Set<string>();
  for (const p of patterns) { if (p.endsWith('*')) { const pre = p.slice(0, -1); for (const n of known) if (n.startsWith(pre)) out.add(n); } else out.add(p); }
  return [...out].slice(0, 12);
}
/** Le calcul d'un panneau sur une suite de valeurs. Pur. */
export function compute(vals: number[], c: Calc): number | undefined {
  if (!vals.length) return undefined;
  return c === 'max' ? Math.max(...vals) : c === 'min' ? Math.min(...vals) : c === 'derniere' ? vals[vals.length - 1] : vals.reduce((a, b) => a + b, 0) / vals.length;
}
/** La couleur d'une valeur selon les seuils du panneau. Pur. */
export function toneOf(p: Panel, v: number | undefined): Tone {
  if (v === undefined) return 'neutre';
  const worse = (x: number, lim: number) => (p.bas ? x <= lim : x >= lim);
  if (p.grave !== undefined && worse(v, p.grave)) return 'mauvais';
  if (p.attention !== undefined && worse(v, p.attention)) return 'attention';
  return p.attention !== undefined || p.grave !== undefined ? 'bon' : 'neutre';
}
const short = (n: string, p: Panel) => { const pre = p.series.find((x) => x.endsWith('*') && n.startsWith(x.slice(0, -1))); return pre ? n.slice(pre.length - 1) || n : n; };
const fmt = (v: number | undefined, p: Panel) => (v === undefined ? '—' : `${Math.abs(v) >= 100 ? Math.round(v) : Math.round(v * 10) / 10}${p.unite ? ` ${p.unite}` : ''}`);
/** Disponibilité : 0 / 1 → pourcentage. */
const scale = (n: string, v: number) => (n.startsWith('vordr.up.') ? v * 100 : v);

interface Lu { name: string; label: string; value?: number; points: Array<[number, number]> }
function read(p: Panel, span: number, now: number): Lu[] {
  const m = metrics(); if (!m) return [];
  return expand(p.series, m.names()).map((name) => {
    const agg = m.series(name, now - span, now, 60);
    const pts = agg.map((a) => [a.t, scale(name, p.calcul === 'max' ? a.max : p.calcul === 'min' ? a.min : p.calcul === 'derniere' ? a.last : a.avg)] as [number, number]);
    const raw = m.points(name, now - span, now).map((x) => scale(name, x[1]));
    return { name, label: short(name, p), value: compute(raw, p.calcul), points: pts };
  });
}
function panelSection(p: Panel, l: Lu[], span: number): Section {
  if (!l.length || l.every((x) => !x.points.length)) return { kind: 'text', title: p.titre, text: `Pas encore de valeurs pour ${p.series.join(', ')}.`, tone: 'neutre' };
  if (p.type === 'barres') return { kind: 'bars', title: `${p.titre} (${CALC_LABEL[p.calcul]})`, items: l.filter((x) => x.value !== undefined).map((x) => ({ label: x.label, value: Math.round((x.value ?? 0) * 10) / 10, display: fmt(x.value, p) })) };
  if (p.type === 'valeur') return { kind: 'list', title: `${p.titre} (${CALC_LABEL[p.calcul]})`, items: l.map((x) => ({ title: x.label, meta: fmt(x.value, p), tone: toneOf(p, x.value) })) };
  const times = [...new Set(l.flatMap((x) => x.points.map((q) => q[0])))].sort((a, b) => a - b);
  const label = (t: number) => (span > 2 * 864e5 ? new Date(t).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' }) : new Date(t).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }));
  return { kind: 'courbe', title: p.titre, unit: p.unite, labels: times.map(label), series: l.map((x) => { const m = new Map(x.points); let last = 0; return { name: x.label, tone: toneOf(p, x.value), points: times.map((t) => (last = m.get(t) ?? last)) }; }) };
}
const CALC_LABEL: Record<Calc, string> = { moyenne: 'moyenne', max: 'maximum', min: 'minimum', derniere: 'dernière valeur' };

/** Un tableau en texte (pour Odin et le mode sans IA). */
export function boardText(b: Board, span: number, now: number): string {
  return [`${b.nom} · ${Object.entries(PERIODS).find(([, v]) => v === span)?.[0] ?? b.periode}`, ...b.panneaux.map((p) => {
    const l = read(p, span, now).filter((x) => x.value !== undefined); if (!l.length) return `- ${p.titre} : pas encore de valeurs`;
    const ic: Record<Tone, string> = { bon: '🟢', attention: '🟠', mauvais: '🔴', neutre: '•' };
    return `- ${p.titre} (${CALC_LABEL[p.calcul]}) : ${l.map((x) => `${ic[toneOf(p, x.value)]} ${x.label} ${fmt(x.value, p)}`).join(' · ')}`;
  })].join('\n');
}

const PANEL_PARAMS = [
  { key: 'tableau', label: 'Tableau', kind: 'text' as const, required: true },
  { key: 'titre', label: 'Titre du panneau', kind: 'text' as const, required: true },
  { key: 'mesures', label: 'Mesures (ex. eir.cpu, vordr.temps.* )', kind: 'text' as const, required: true },
  { key: 'type', label: 'Affichage', kind: 'select' as const, options: ['courbe', 'valeur', 'barres'], default: 'courbe' },
  { key: 'calcul', label: 'Calcul', kind: 'select' as const, options: ['moyenne', 'max', 'min', 'derniere'], default: 'moyenne' },
  { key: 'unite', label: 'Unité', kind: 'text' as const, default: '' },
  { key: 'attention', label: 'Orange à partir de', kind: 'text' as const, default: '' },
  { key: 'grave', label: 'Rouge à partir de', kind: 'text' as const, default: '' },
  { key: 'bas', label: 'Plus bas = pire (signal, disponibilité)', kind: 'boolean' as const, default: false },
];
const num = (v: unknown) => (s(v) === '' || !Number.isFinite(Number(v)) ? undefined : Number(v));

export const syn: Module = {
  id: 'syn', name: 'Sýn', family: 'Données',
  what: 'Tes tableaux de bord (comme Grafana) : courbes, valeurs et barres sur les mesures d\'Odin, avec des seuils qui préviennent.',
  does: ['tableaux de bord : panneaux en courbe, valeur ou barres', 'mesures d\'Odin : machine (Eir), sites et appareils (Vörðr), réseau', 'plusieurs mesures d\'un coup (eir.fs.* = tous les disques)', 'calcul : moyenne, maximum, minimum, dernière valeur', 'périodes : 1 h, 6 h, 24 h, 7 j, 30 j, 1 an', 'seuils orange / rouge par panneau, alerte quand ils sont dépassés', 'modèles prêts : Machine, Réseau, Sites et appareils', 'export Prometheus des mesures (pour un autre outil)'],
  from: ['Grafana'], upstream: ['grafana/grafana'],
  words: ['tableau de bord', 'tableaux de bord', 'dashboard', 'grafana', 'graphique', 'graphiques', 'syn', 'sýn'],
  actions: [
    { id: 'tableaux', label: 'Tableaux de bord', what: 'La liste des tableaux et leurs panneaux', read: true, words: ['mes tableaux de bord', 'liste des tableaux'], run: (ctx) => {
      const l = boards(ctx);
      return { text: l.length ? l.map((b) => `${b.nom} (${b.periode}) : ${b.panneaux.map((p) => p.titre).join(', ') || 'vide'}`).join('\n') : `Aucun tableau. Modèles prêts : ${Object.values(MODELES).map((m) => m.nom).join(', ')} (« ajoute le modèle Machine »).`, data: l };
    } },
    { id: 'voir', label: 'Voir un tableau', what: 'Les valeurs de chaque panneau sur une période', read: true, words: ['montre le tableau de bord', 'ouvre le tableau de bord'], params: [{ key: 'tableau', label: 'Tableau (vide = le premier)', kind: 'text', default: '' }, { key: 'periode', label: 'Période', kind: 'select', options: Object.keys(PERIODS), default: '' }], run: (ctx, i) => {
      const b = findBoard(ctx, s(i.tableau)), span = PERIODS[s(i.periode) || b.periode] ?? 864e5;
      return { text: boardText(b, span, ctx.now().getTime()) };
    } },
    { id: 'modele', label: 'Ajouter un modèle', what: 'Un tableau prêt : Machine, Réseau, Sites et appareils', params: [{ key: 'modele', label: 'Modèle', kind: 'select', options: Object.keys(MODELES), default: 'machine' }], words: ['ajoute le modele', 'ajoute le modèle'], run: (ctx, i) => {
      const m = MODELES[slug(s(i.modele))] ?? MODELES[s(i.modele)]; if (!m) throw new Error(`modèle inconnu (${Object.keys(MODELES).join(', ')})`);
      const l = boards(ctx), id = slug(m.nom); if (l.some((b) => b.id === id)) return { text: `Le tableau ${m.nom} existe déjà.` };
      saveBoards(ctx, [...l, { id, ...structuredClone(m) }]);
      return { text: `Tableau « ${m.nom} » ajouté (${m.panneaux.length} panneaux).` };
    }, undo: (i) => ({ action: 'supprimer', input: { tableau: s((MODELES[s(i.modele)] ?? { nom: '' }).nom) }, label: 'Retirer le tableau' }) },
    { id: 'creer', label: 'Créer un tableau', what: 'Un tableau vide, avec sa période par défaut', params: [{ key: 'nom', label: 'Nom', kind: 'text', required: true }, { key: 'periode', label: 'Période', kind: 'select', options: Object.keys(PERIODS), default: '24h' }], run: (ctx, i) => {
      const nom = s(i.nom).slice(0, 60); if (!nom) throw new Error('nom manquant');
      const l = boards(ctx), id = slug(nom); if (l.some((b) => b.id === id)) throw new Error(`le tableau ${nom} existe déjà`);
      saveBoards(ctx, [...l, { id, nom, periode: PERIODS[s(i.periode)] ? s(i.periode) : '24h', panneaux: [] }]);
      return { text: `Tableau « ${nom} » créé. Ajoute des panneaux (« ajoute un panneau »).` };
    }, undo: (i) => ({ action: 'supprimer', input: { tableau: s(i.nom) }, label: 'Retirer le tableau' }) },
    { id: 'panneau', label: 'Ajouter un panneau', what: 'Une ou plusieurs mesures en courbe, valeur ou barres, avec calcul et seuils', params: PANEL_PARAMS, run: (ctx, i) => {
      const l = boards(ctx), b = findBoard(ctx, s(i.tableau));
      const series = s(i.mesures).split(/[,\s]+/).filter(Boolean);
      if (!series.length) throw new Error('aucune mesure');
      for (const x of series) if (!okName(x.replace(/\*$/, 'x'))) throw new Error(`nom de mesure invalide : ${x}`);
      const type = (['courbe', 'valeur', 'barres'].includes(s(i.type)) ? s(i.type) : 'courbe') as Kind, calcul = (['moyenne', 'max', 'min', 'derniere'].includes(s(i.calcul)) ? s(i.calcul) : 'moyenne') as Calc;
      const titre = s(i.titre).slice(0, 60) || series[0];
      let id = slug(titre); while (b.panneaux.some((p) => p.id === id)) id += '-2';
      const p: Panel = { id, titre, series, type, calcul, ...(s(i.unite) ? { unite: s(i.unite).slice(0, 10) } : {}), ...(num(i.attention) !== undefined ? { attention: num(i.attention) } : {}), ...(num(i.grave) !== undefined ? { grave: num(i.grave) } : {}), ...(i.bas === true || i.bas === 'true' ? { bas: true } : {}) };
      saveBoards(ctx, l.map((x) => (x.id === b.id ? { ...x, panneaux: [...x.panneaux, p] } : x)));
      const known = metrics()?.names() ?? [], found = expand(series, known).filter((n) => known.includes(n));
      return { text: `Panneau « ${titre} » ajouté à ${b.nom}${found.length ? ` (${found.length} mesure(s) trouvée(s))` : ' — aucune valeur pour l\'instant : vérifie les noms (« mesures connues »)'}.` };
    } },
    { id: 'retirer_panneau', label: 'Retirer un panneau', what: 'Retire un panneau d\'un tableau', quick: false, params: [{ key: 'tableau', label: 'Tableau', kind: 'text', required: true }, { key: 'panneau', label: 'Titre du panneau', kind: 'text', required: true }], run: (ctx, i) => {
      const l = boards(ctx), b = findBoard(ctx, s(i.tableau)), k = slug(s(i.panneau)), p = b.panneaux.find((x) => x.id === k || slug(x.titre) === k);
      if (!p) throw new Error(`panneau introuvable dans ${b.nom}`);
      saveBoards(ctx, l.map((x) => (x.id === b.id ? { ...x, panneaux: x.panneaux.filter((y) => y !== p && y.id !== p.id) } : x)));
      return { text: `Panneau « ${p.titre} » retiré de ${b.nom}.` };
    } },
    { id: 'supprimer', label: 'Supprimer un tableau', what: 'Retire un tableau (les mesures, elles, restent)', quick: false, params: [{ key: 'tableau', label: 'Tableau', kind: 'text', required: true }], run: (ctx, i) => {
      const b = findBoard(ctx, s(i.tableau)); saveBoards(ctx, boards(ctx).filter((x) => x.id !== b.id));
      return { text: `Tableau « ${b.nom} » retiré (les mesures restent).` };
    } },
    { id: 'mesures_connues', label: 'Mesures connues', what: 'Les noms de mesures qu\'Odin garde (pour composer un panneau)', read: true, words: ['mesures connues', 'quelles mesures'], params: [{ key: 'debut', label: 'Commence par (ex. eir.)', kind: 'text', default: '' }], run: (_c, i) => {
      const l = metrics()?.names(s(i.debut)) ?? [];
      return { text: l.length ? `${l.length} mesure(s) :\n${l.slice(0, 120).join('\n')}` : 'Aucune mesure pour l\'instant.', data: l };
    } },
  ],
  view(ctx, q) {
    const l = boards(ctx);
    if (!l.length) return { subtitle: 'Aucun tableau', sections: [{ kind: 'cards', title: 'Modèles prêts', items: Object.entries(MODELES).map(([k, m]) => ({ title: m.nom, sub: m.panneaux.map((p) => p.titre).join(' · '), actions: [{ action: 'modele', label: 'Ajouter', input: { modele: k } }] })) }, { kind: 'form', title: 'Ou un tableau vide', action: 'creer', params: [{ key: 'nom', label: 'Nom', kind: 'text', required: true }, { key: 'periode', label: 'Période', kind: 'select', options: Object.keys(PERIODS), default: '24h' }], submit: 'Créer' }] };
    const b = l.find((x) => x.id === q.get('tab') || x.nom === q.get('tab')) ?? l[0], per = PERIODS[q.get('periode') ?? ''] ? q.get('periode')! : b.periode, span = PERIODS[per] ?? 864e5, now = ctx.now().getTime();
    const kpis: Kpi[] = [], sections: Section[] = [];
    for (const p of b.panneaux) {
      const lu = read(p, span, now);
      if (p.type === 'valeur' && lu.length <= 2) for (const x of lu) kpis.push({ label: lu.length > 1 ? `${p.titre} · ${x.label}` : p.titre, value: fmt(x.value, p), tone: toneOf(p, x.value), hint: CALC_LABEL[p.calcul] });
      else sections.push(panelSection(p, lu, span));
    }
    return { subtitle: `${b.nom} · ${per}`, tabs: l.map((x) => x.nom), kpis, refreshMs: span <= 6 * 3600e3 ? 60_000 : undefined, sections: sections.length || kpis.length ? sections : [{ kind: 'text', title: b.nom, text: 'Tableau vide : ajoute un panneau.' }], side: [{ kind: 'form', title: 'Ajouter un panneau', action: 'panneau', params: PANEL_PARAMS.map((x) => (x.key === 'tableau' ? { ...x, default: b.nom } : x)), submit: 'Ajouter' }] };
  },
  /** Seuils dépassés → alerte (une par panneau et par mesure, pas de répétition tant que ça dure). */
  watch: { every: 300, run(ctx) {
    const now = ctx.now().getTime();
    for (const b of boards(ctx)) for (const p of b.panneaux) {
      if (p.attention === undefined && p.grave === undefined) continue;
      for (const x of read(p, 15 * 60e3, now)) {
        const t = toneOf(p, x.value); if (t !== 'mauvais' && t !== 'attention') continue;
        ctx.alert({ level: t === 'mauvais' ? 'haute' : 'moyenne', title: `${b.nom} · ${p.titre} : ${x.label} ${fmt(x.value, p)}`, detail: `Seuil ${t === 'mauvais' ? 'rouge' : 'orange'} dépassé (${CALC_LABEL[p.calcul]} sur 15 min).`, key: `syn:${b.id}:${p.id}:${x.name}:${t}` });
      }
    }
  } },
};
