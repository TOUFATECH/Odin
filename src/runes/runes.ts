// Papyrus — l'écriture d'Odin : pages et bases de données, dans le même coffre que Thot.
// Une base = un dossier de notes (une note par fiche, ses propriétés dans l'en-tête) + un schéma
// (propriétés typées, vues, modèles, automatisations) rangé dans .runes/ (invisible pour Obsidian).
// Vues : table, tableau (colonnes), calendrier, galerie, liste, chronologie, formulaire.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { safeName, TYPES, type NoteMeta, type Vault } from '../brain/vault.ts';
import { test as cond } from '../draupnir/nodes.ts';
import { formula, type FormulaValue } from './formula.ts';

export type PropType = 'texte' | 'nombre' | 'sélection' | 'multi' | 'statut' | 'date' | 'case' | 'lien' | 'email' | 'téléphone' | 'personne' | 'fichier' | 'relation' | 'agrégation' | 'formule' | 'créé' | 'modifié' | 'id';
export const PROP_TYPES: PropType[] = ['texte', 'nombre', 'sélection', 'multi', 'statut', 'date', 'case', 'lien', 'email', 'téléphone', 'personne', 'fichier', 'relation', 'agrégation', 'formule', 'créé', 'modifié', 'id'];
export interface Opt { name: string; color?: string; group?: 'à faire' | 'en cours' | 'terminé' }
export interface Prop {
  key: string; label: string; type: PropType; options?: Opt[];
  relation?: string; rollup?: { relation: string; prop: string; calc: 'compter' | 'somme' | 'moyenne' | 'min' | 'max' | 'liste' | 'pourcentage coché' };
  formula?: string; format?: 'nombre' | 'euro' | 'pourcent'; prefix?: string;
}
export interface Filter { prop: string; op: string; value?: string }
export interface View {
  id: string; name: string; type: 'table' | 'tableau' | 'calendrier' | 'galerie' | 'liste' | 'chronologie' | 'formulaire';
  groupBy?: string; date?: string; dateEnd?: string; filters?: Filter[]; any?: boolean; sorts?: Array<{ prop: string; dir: 'asc' | 'desc' }>; visible?: string[]; cover?: string;
}
export interface BaseAutomation { id: string; when: { prop: string; to?: string }; then: { kind: 'définir'; prop: string; value: string } | { kind: 'prévenir'; text: string } | { kind: 'draupnir'; flow: string } }
export interface Base { id: string; name: string; folder: string; icon?: string; type?: string; props: Prop[]; views: View[]; templates?: Array<{ name: string; body: string; props?: NoteMeta }>; automations?: BaseAutomation[]; nextId?: number }
export interface Row { path: string; title: string; meta: NoteMeta; values: Record<string, unknown>; mtime: number }

const COLORS = ['gris', 'marron', 'orange', 'jaune', 'vert', 'bleu', 'violet', 'rose', 'rouge'];
const opts = (names: string[]): Opt[] => names.map((name, i) => ({ name, color: COLORS[(i + 3) % COLORS.length] }));
const STATUS_GROUP = (n: string): Opt['group'] => /fait|termin|retenu|livr|ok|gagn/i.test(n) ? 'terminé' : /cours|creuser|attente|pause/i.test(n) ? 'en cours' : 'à faire';
const rid = () => Math.random().toString(36).slice(2, 9);
const today = () => new Date().toISOString().slice(0, 10);

/** Bases par défaut (les types de Thot), avec un schéma typé et des vues prêtes. */
function builtIn(type: string): Base {
  const t = TYPES[type];
  const props: Prop[] = t.props.map((k) => {
    if (k === 'statut') return { key: k, label: 'Statut', type: 'statut', options: (t.statuses ?? ['à faire', 'en cours', 'fait']).map((n, i) => ({ name: n, color: COLORS[(i + 4) % COLORS.length], group: STATUS_GROUP(n) })) };
    if (k === 'échéance' || k === 'date') return { key: k, label: k[0].toUpperCase() + k.slice(1), type: 'date' };
    if (k === 'priorité') return { key: k, label: 'Priorité', type: 'sélection', options: opts(['haute', 'moyenne', 'basse']) };
    if (k === 'email') return { key: k, label: 'Email', type: 'email' };
    if (k === 'téléphone') return { key: k, label: 'Téléphone', type: 'téléphone' };
    if (k === 'lien' || k === 'source') return { key: k, label: k[0].toUpperCase() + k.slice(1), type: 'lien' };
    if (k === 'projet') return { key: k, label: 'Projet', type: 'relation', relation: 'projet' };
    if (k === 'participants') return { key: k, label: 'Participants', type: 'personne' };
    return { key: k, label: k[0].toUpperCase() + k.slice(1), type: 'texte' };
  });
  props.push({ key: 'créé', label: 'Créé le', type: 'créé' });
  const views: View[] = [{ id: 'table', name: 'Table', type: 'table' }];
  if (props.some((p) => p.type === 'statut')) views.unshift({ id: 'tableau', name: 'Tableau', type: 'tableau', groupBy: 'statut' });
  const d = props.find((p) => p.type === 'date');
  if (d) views.push({ id: 'calendrier', name: 'Calendrier', type: 'calendrier', date: d.key });
  views.push({ id: 'galerie', name: 'Galerie', type: 'galerie' }, { id: 'liste', name: 'Liste', type: 'liste' });
  return { id: type, name: t.label, folder: t.folder, type, props, views };
}

export class Papyrus {
  private dir: string;
  private vault: Vault;
  constructor(vault: Vault) {
    this.vault = vault;
    this.dir = join(vault.root, '.runes');
    for (const d of ['bases', 'historique', 'commentaires']) mkdirSync(join(this.dir, d), { recursive: true });
  }

  // ---------------- Bases
  bases(): Base[] {
    const own = readdirSync(join(this.dir, 'bases')).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(readFileSync(join(this.dir, 'bases', f), 'utf8')) as Base);
    const ids = new Set(own.map((b) => b.id));
    return [...Object.keys(TYPES).filter((t) => t !== 'note' && t !== 'journal' && !ids.has(t)).map(builtIn), ...own];
  }
  base(id: string): Base {
    const f = join(this.dir, 'bases', `${id.replace(/[^\p{L}\p{N}_-]/gu, '')}.json`);
    if (existsSync(f)) return JSON.parse(readFileSync(f, 'utf8')) as Base;
    if (TYPES[id] && id !== 'note') return builtIn(id);
    const b = this.bases().find((x) => x.name.toLowerCase() === id.toLowerCase() || x.folder === id);
    if (!b) throw new Error(`base introuvable : ${id}`);
    return b;
  }
  saveBase(b: Base): Base {
    for (const p of b.props) if (!PROP_TYPES.includes(p.type)) throw new Error(`type de propriété inconnu : ${p.type}`);
    if (new Set(b.props.map((p) => p.key)).size !== b.props.length) throw new Error('deux propriétés ont la même clé');
    writeFileSync(join(this.dir, 'bases', `${b.id.replace(/[^\p{L}\p{N}_-]/gu, '')}.json`), JSON.stringify(b, null, 2));
    return b;
  }
  createBase(name: string, props: Array<Partial<Prop> & { label: string }> = [], folder?: string): Base {
    const id = safeName(name).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w]+/g, '-').replace(/^-|-$/g, '') || rid();
    if (this.bases().some((b) => b.id === id)) throw new Error(`une base « ${name} » existe déjà`);
    const ps: Prop[] = props.length ? props.map((p) => this.prop(p)) : [{ key: 'statut', label: 'Statut', type: 'statut', options: [{ name: 'à faire', color: 'gris', group: 'à faire' }, { name: 'en cours', color: 'bleu', group: 'en cours' }, { name: 'fait', color: 'vert', group: 'terminé' }] }, { key: 'date', label: 'Date', type: 'date' }];
    const views: View[] = [{ id: 'table', name: 'Table', type: 'table' }];
    const g = ps.find((p) => p.type === 'statut' || p.type === 'sélection'), d = ps.find((p) => p.type === 'date');
    if (g) views.push({ id: 'tableau', name: 'Tableau', type: 'tableau', groupBy: g.key });
    if (d) views.push({ id: 'calendrier', name: 'Calendrier', type: 'calendrier', date: d.key });
    views.push({ id: 'galerie', name: 'Galerie', type: 'galerie' });
    return this.saveBase({ id, name, folder: folder ?? `Bases/${safeName(name)}`, props: ps, views, nextId: 1 });
  }
  private prop(p: Partial<Prop> & { label: string }): Prop {
    const key = p.key ?? p.label.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w]+/g, '_').replace(/^_|_$/g, '');
    const type = (p.type ?? 'texte') as PropType;
    const options = p.options ?? (type === 'statut' ? [{ name: 'à faire', group: 'à faire' as const }, { name: 'en cours', group: 'en cours' as const }, { name: 'fait', group: 'terminé' as const }] : undefined);
    return { ...p, key, label: p.label, type, ...(options ? { options } : {}) } as Prop;
  }
  updateBase(id: string, patch: Partial<Base>): Base { return this.saveBase({ ...this.base(id), ...patch, id }); }
  addProp(id: string, p: Partial<Prop> & { label: string }): Base { const b = this.base(id); const np = this.prop(p); if (b.props.some((x) => x.key === np.key)) throw new Error('propriété déjà présente'); return this.saveBase({ ...b, props: [...b.props, np] }); }
  /** Renommer une propriété renomme aussi la clé dans toutes les fiches. */
  renameProp(id: string, key: string, label: string): Base {
    const b = this.base(id), p = b.props.find((x) => x.key === key); if (!p) throw new Error('propriété introuvable');
    const nk = this.prop({ label }).key;
    if (nk !== key) for (const r of this.rawRows(b)) if (key in r.meta) { const m = { ...r.meta, [nk]: r.meta[key] }; delete m[key]; const n = this.vault.find(r.path)!; this.vault.write(r.path, m, n.body); }
    return this.saveBase({ ...b, props: b.props.map((x) => (x.key === key ? { ...x, key: nk, label } : x)), views: b.views.map((v) => ({ ...v, groupBy: v.groupBy === key ? nk : v.groupBy, date: v.date === key ? nk : v.date })) });
  }
  removeProp(id: string, key: string): Base { const b = this.base(id); return this.saveBase({ ...b, props: b.props.filter((x) => x.key !== key) }); }
  saveView(id: string, v: Partial<View> & { name: string; type: View['type'] }): Base {
    const b = this.base(id), view = { ...v, id: v.id ?? rid() } as View;
    return this.saveBase({ ...b, views: b.views.some((x) => x.id === view.id) ? b.views.map((x) => (x.id === view.id ? view : x)) : [...b.views, view] });
  }
  removeView(id: string, viewId: string): Base { const b = this.base(id); if (b.views.length <= 1) throw new Error('il faut garder une vue'); return this.saveBase({ ...b, views: b.views.filter((v) => v.id !== viewId) }); }

  // ---------------- Fiches
  private rawRows(b: Base): Array<{ path: string; title: string; meta: NoteMeta; mtime: number }> {
    if (b.type) return this.vault.database(b.type);
    const pre = `${b.folder.replace(/\/$/, '')}/`;
    return this.vault.all().filter((n) => n.path.startsWith(pre) && !n.path.slice(pre.length).includes('/')).map((n) => ({ path: n.path, title: n.title, meta: n.meta, mtime: n.mtime }));
  }
  rows(id: string, now = new Date()): Row[] {
    const b = this.base(id), raw = this.rawRows(b);
    const relCache = new Map<string, Row[]>();
    const relRows = (baseId: string) => { if (!relCache.has(baseId)) { try { relCache.set(baseId, baseId === b.id ? [] : this.rows(baseId, now)); } catch { relCache.set(baseId, []); } } return relCache.get(baseId)!; };
    return raw.map((r) => {
      const values: Record<string, unknown> = {};
      for (const p of b.props) values[p.key] = p.type === 'créé' ? r.meta.créé ?? '' : p.type === 'modifié' ? new Date(r.mtime).toISOString().slice(0, 10) : r.meta[p.key];
      for (const p of b.props.filter((x) => x.type === 'agrégation' && x.rollup)) {
        const rel = b.props.find((x) => x.key === p.rollup!.relation);
        const linked = ([] as unknown[]).concat(values[p.rollup!.relation] ?? []).map((x) => String(x).replace(/^\[\[|\]\]$/g, '').toLowerCase());
        const targets = rel?.relation ? relRows(rel.relation).filter((t) => linked.includes(t.title.toLowerCase()) || linked.includes(t.path.replace(/\.md$/, '').toLowerCase())) : [];
        const vals = targets.map((t) => t.values[p.rollup!.prop] ?? t.meta[p.rollup!.prop]), nums = vals.map(Number).filter(Number.isFinite);
        const c = p.rollup!.calc;
        values[p.key] = c === 'compter' ? targets.length : c === 'somme' ? nums.reduce((a, x) => a + x, 0) : c === 'moyenne' ? (nums.length ? nums.reduce((a, x) => a + x, 0) / nums.length : 0) : c === 'min' ? (nums.length ? Math.min(...nums) : null) : c === 'max' ? (nums.length ? Math.max(...nums) : null) : c === 'pourcentage coché' ? (vals.length ? vals.filter((v) => v === true || v === 'true').length / vals.length : 0) : vals;
      }
      for (const p of b.props.filter((x) => x.type === 'formule' && x.formula)) {
        values[p.key] = formula(p.formula!, (name) => {
          const q = b.props.find((x) => x.label.toLowerCase() === name.toLowerCase() || x.key === name);
          if (name.toLowerCase() === 'nom' || name.toLowerCase() === 'titre') return r.title;
          const v = q ? values[q.key] : r.meta[name];
          return (v === undefined ? null : v) as FormulaValue;
        }, now);
      }
      return { path: r.path, title: r.title, meta: r.meta, values, mtime: r.mtime };
    });
  }
  /** Une vue appliquée : filtres, tris, groupes (tableau), jours (calendrier), barres (chronologie). */
  query(id: string, viewId?: string, extra: { q?: string } = {}, now = new Date()): { base: Base; view: View; rows: Row[]; groups?: Array<{ name: string; color?: string; rows: Row[] }>; days?: Record<string, Row[]> } {
    const base = this.base(id), view = base.views.find((v) => v.id === viewId) ?? base.views[0];
    let rows = this.rows(id, now);
    const q = extra.q?.trim().toLowerCase();
    if (q) rows = rows.filter((r) => r.title.toLowerCase().includes(q) || Object.values(r.values).some((v) => String(v ?? '').toLowerCase().includes(q)));
    const match = (r: Row, f: Filter) => {
      const v = f.prop === 'titre' ? r.title : r.values[f.prop], d = typeof v === 'string' ? new Date(v) : undefined, t0 = new Date(now.toISOString().slice(0, 10));
      switch (f.op) {
        case 'avant': return Boolean(d && f.value && d < new Date(f.value));
        case 'après': return Boolean(d && f.value && d > new Date(f.value));
        case 'en retard': return Boolean(d && !Number.isNaN(d.getTime()) && d < t0);
        case 'cette semaine': { if (!d) return false; const diff = (d.getTime() - t0.getTime()) / 86_400_000; return diff >= 0 && diff < 7; }
        case 'coché': return v === true || v === 'true';
        case 'non coché': return !(v === true || v === 'true');
        case 'parmi': return String(f.value ?? '').split(',').map((x) => x.trim()).includes(String(v ?? ''));
        default: return cond(Array.isArray(v) ? v.join(', ') : v, f.op, f.value ?? '');
      }
    };
    if (view.filters?.length) rows = rows.filter((r) => (view.any ? view.filters!.some((f) => match(r, f)) : view.filters!.every((f) => match(r, f))));
    const sorts = view.sorts?.length ? view.sorts : [{ prop: '$mtime', dir: 'desc' as const }];
    rows.sort((a, b) => {
      for (const s of sorts) {
        const x = s.prop === '$mtime' ? a.mtime : s.prop === 'titre' ? a.title : a.values[s.prop], y = s.prop === '$mtime' ? b.mtime : s.prop === 'titre' ? b.title : b.values[s.prop];
        const c = typeof x === 'number' && typeof y === 'number' ? x - y : String(x ?? '').localeCompare(String(y ?? ''), 'fr', { numeric: true });
        if (c) return s.dir === 'desc' ? -c : c;
      }
      return 0;
    });
    const out: ReturnType<Papyrus['query']> = { base, view, rows };
    if (view.type === 'tableau' && view.groupBy) {
      const p = base.props.find((x) => x.key === view.groupBy);
      const names = p?.options?.map((o) => o.name) ?? [...new Set(rows.map((r) => String(r.values[view.groupBy!] ?? '')))];
      const groups = names.map((name) => ({ name, color: p?.options?.find((o) => o.name === name)?.color, rows: rows.filter((r) => ([] as unknown[]).concat(r.values[view.groupBy!] ?? []).map(String).includes(name)) }));
      const none = rows.filter((r) => !names.some((n) => ([] as unknown[]).concat(r.values[view.groupBy!] ?? []).map(String).includes(n)));
      out.groups = none.length ? [{ name: 'Sans valeur', rows: none }, ...groups] : groups;
    }
    if ((view.type === 'calendrier' || view.type === 'chronologie') && view.date) {
      const days: Record<string, Row[]> = {};
      for (const r of rows) { const d = String(r.values[view.date] ?? '').slice(0, 10); if (/^\d{4}-\d{2}-\d{2}$/.test(d)) (days[d] ??= []).push(r); }
      out.days = days;
    }
    return out;
  }
  /** Nouvelle fiche (avec modèle éventuel). Les propriétés inconnues de la base sont gardées telles quelles. */
  addRow(id: string, title: string, props: NoteMeta = {}, body = '', template?: string): string {
    const b = this.base(id);
    const tpl = template ? b.templates?.find((t) => t.name === template) : undefined;
    const meta: NoteMeta = { ...(b.type && b.type !== 'note' ? { type: b.type } : {}), créé: today(), ...(tpl?.props ?? {}) };
    for (const p of b.props) if (p.type === 'statut' && p.options?.length && meta[p.key] === undefined) meta[p.key] = p.options[0].name;
    const idProp = b.props.find((p) => p.type === 'id');
    if (idProp && !b.type) { meta[idProp.key] = `${idProp.prefix ?? ''}${b.nextId ?? 1}`; this.saveBase({ ...b, nextId: (b.nextId ?? 1) + 1 }); }
    Object.assign(meta, this.clean(b, props));
    let name = safeName(title), k = 2;
    while (this.vault.find(`${b.folder}/${name}`)?.path.startsWith(b.folder)) name = `${safeName(title)} ${k++}`;
    return this.vault.write(`${b.folder}/${name}`, meta, body || tpl?.body || '');
  }
  private clean(b: Base, props: NoteMeta): NoteMeta {
    const out: NoteMeta = {};
    for (const [k, v] of Object.entries(props)) {
      const p = b.props.find((x) => x.key === k || x.label.toLowerCase() === k.toLowerCase());
      if (!p) { out[k] = v; continue; }
      if (['formule', 'agrégation', 'créé', 'modifié', 'id'].includes(p.type)) continue; // calculées
      if (p.type === 'nombre') { const n = Number(String(v).replace(',', '.')); if (v !== '' && !Number.isFinite(n)) throw new Error(`« ${p.label} » doit être un nombre`); out[p.key] = v === '' ? '' : n as unknown as string; continue; }
      if (p.type === 'case') { out[p.key] = (v === true || v === 'true' || v === 'oui') as unknown as string; continue; }
      if (p.type === 'date' && v && !/^\d{4}-\d{2}-\d{2}/.test(String(v))) throw new Error(`« ${p.label} » : date au format AAAA-MM-JJ`);
      if ((p.type === 'sélection' || p.type === 'statut') && v && p.options && !p.options.some((o) => o.name === v)) { p.options.push({ name: String(v), color: COLORS[p.options.length % COLORS.length] }); this.saveBase(b); }
      if (p.type === 'multi' || p.type === 'personne' || p.type === 'relation' || p.type === 'fichier') { out[p.key] = (Array.isArray(v) ? v : String(v).split(',').map((x) => x.trim()).filter(Boolean)) as string[]; continue; }
      out[p.key] = v;
    }
    return out;
  }
  /** Modifie des propriétés ; renvoie les automatisations de la base déclenchées (statut passé à « fait »…). */
  updateRow(path: string, props: NoteMeta, baseId?: string): { path: string; fired: BaseAutomation[] } {
    const n = this.vault.find(path); if (!n) throw new Error(`fiche introuvable : ${path}`);
    const b = baseId ? this.base(baseId) : this.baseOf(n.path);
    const clean = b ? this.clean(b, props) : props;
    const fired = (b?.automations ?? []).filter((a) => a.when.prop in clean && String(n.meta[a.when.prop] ?? '') !== String(clean[a.when.prop] ?? '') && (a.when.to === undefined || String(clean[a.when.prop]) === a.when.to));
    const meta = { ...n.meta, ...clean };
    for (const a of fired) if (a.then.kind === 'définir') meta[a.then.prop] = a.then.value === '{{aujourdhui}}' ? today() : a.then.value;
    this.snapshot(n.path, n.meta, n.body);
    return { path: this.vault.write(n.path, meta, n.body), fired };
  }
  baseOf(path: string): Base | undefined {
    const n = this.vault.find(path); if (!n) return undefined;
    return this.bases().find((b) => (b.type ? String(n.meta.type ?? '') === b.type : n.path.startsWith(`${b.folder}/`) && !n.path.slice(b.folder.length + 1).includes('/')));
  }

  // ---------------- Pages
  /** Sous-page : rangée dans un dossier qui porte le nom de la page parente. */
  childPage(parent: string, title: string, body = ''): string {
    const p = this.vault.find(parent); if (!p) throw new Error('page parente introuvable');
    const dir = p.path.replace(/\.md$/, '');
    let name = safeName(title), k = 2;
    while (this.vault.find(`${dir}/${name}`)?.path === `${dir}/${name}.md`) name = `${safeName(title)} ${k++}`;
    return this.vault.write(`${dir}/${name}`, { créé: today(), parent: `[[${p.title}]]` }, body);
  }
  children(parent: string): Array<{ path: string; title: string }> {
    const p = this.vault.find(parent); if (!p) return [];
    const dir = `${p.path.replace(/\.md$/, '')}/`;
    return this.vault.all().filter((n) => n.path.startsWith(dir) && !n.path.slice(dir.length).includes('/')).map((n) => ({ path: n.path, title: n.title }));
  }
  /** Sommaire d'une page (titres). */
  outline(body: string): Array<{ level: number; text: string }> { return [...body.matchAll(/^(#{1,4})\s+(.+)$/gm)].map((m) => ({ level: m[1].length, text: m[2].trim() })); }

  // ---------------- Historique et commentaires
  private key(path: string) { return createHash('sha1').update(path).digest('hex').slice(0, 16); }
  snapshot(path: string, meta: NoteMeta, body: string): void {
    const d = join(this.dir, 'historique', this.key(path)); mkdirSync(d, { recursive: true });
    // Deux modifications dans la même milliseconde ne doivent pas s'écraser : chaque version a son instant à elle.
    let at = Date.now(); while (existsSync(join(d, `${at}.json`))) at++;
    writeFileSync(join(d, `${at}.json`), JSON.stringify({ path, meta, body }));
    const all = readdirSync(d).sort(); for (const f of all.slice(0, Math.max(0, all.length - 30))) writeFileSync(join(d, f), ''); // vidé, pas supprimé
  }
  history(path: string): Array<{ at: number; size: number }> {
    const d = join(this.dir, 'historique', this.key(path)); if (!existsSync(d)) return [];
    return readdirSync(d).map((f) => ({ at: Number(f.replace('.json', '')), size: readFileSync(join(d, f), 'utf8').length })).filter((x) => x.size).sort((a, b) => b.at - a.at);
  }
  restoreVersion(path: string, at: number): string {
    const f = join(this.dir, 'historique', this.key(path), `${at}.json`); if (!existsSync(f)) throw new Error('version introuvable');
    const v = JSON.parse(readFileSync(f, 'utf8')) as { meta: NoteMeta; body: string };
    const n = this.vault.find(path); if (n) this.snapshot(n.path, n.meta, n.body);
    return this.vault.write(path, v.meta, v.body);
  }
  comments(path: string): Array<{ id: string; at: string; by: string; text: string; done?: boolean }> {
    try { return JSON.parse(readFileSync(join(this.dir, 'commentaires', `${this.key(path)}.json`), 'utf8')); } catch { return []; }
  }
  comment(path: string, by: string, text: string): ReturnType<Papyrus['comments']> {
    if (!text.trim()) throw new Error('commentaire vide');
    const list = [...this.comments(path), { id: rid(), at: new Date().toISOString(), by, text: text.slice(0, 4000) }];
    writeFileSync(join(this.dir, 'commentaires', `${this.key(path)}.json`), JSON.stringify(list));
    return list;
  }
  resolveComment(path: string, id: string): ReturnType<Papyrus['comments']> {
    const list = this.comments(path).map((c) => (c.id === id ? { ...c, done: true } : c));
    writeFileSync(join(this.dir, 'commentaires', `${this.key(path)}.json`), JSON.stringify(list));
    return list;
  }

  // ---------------- Import / export
  exportCsv(id: string): string {
    const b = this.base(id), rows = this.rows(id);
    const esc = (v: unknown) => { const s = Array.isArray(v) ? v.join(', ') : v === undefined || v === null ? '' : String(v); return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    return [['Nom', ...b.props.map((p) => p.label)].map(esc).join(','), ...rows.map((r) => [r.title, ...b.props.map((p) => r.values[p.key])].map(esc).join(','))].join('\n');
  }
  importCsv(id: string, csv: string): number {
    const lines: string[][] = []; let cur: string[] = [], cell = '', q = false;
    const sep = (csv.split('\n')[0].match(/;/g)?.length ?? 0) > (csv.split('\n')[0].match(/,/g)?.length ?? 0) ? ';' : ',';
    for (let i = 0; i < csv.length; i++) {
      const c = csv[i];
      if (q) { if (c === '"' && csv[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c; continue; }
      if (c === '"') q = true; else if (c === sep) { cur.push(cell); cell = ''; } else if (c === '\n') { cur.push(cell.replace(/\r$/, '')); lines.push(cur); cur = []; cell = ''; } else cell += c;
    }
    if (cell || cur.length) { cur.push(cell); lines.push(cur); }
    const [head, ...data] = lines.filter((l) => l.some((x) => x.trim()));
    if (!head) return 0;
    const b = this.base(id);
    for (const h of head.slice(1)) if (!b.props.some((p) => p.label.toLowerCase() === h.toLowerCase() || p.key === h)) this.addProp(id, { label: h });
    let n = 0;
    for (const l of data) { const props: NoteMeta = {}; head.slice(1).forEach((h, k) => { if (l[k + 1]?.trim()) props[this.base(id).props.find((p) => p.label.toLowerCase() === h.toLowerCase() || p.key === h)!.key] = l[k + 1].trim(); }); this.addRow(id, l[0] || 'Sans titre', props); n++; }
    return n;
  }
}
