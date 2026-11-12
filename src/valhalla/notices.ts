// Les bulles de la mascotte : tout ce qu'Odin doit te dire, d'où que ça vienne (alertes des applis,
// décisions qu'il a prises seul, mises à jour, tunnel…), avec un niveau de couleur :
//   vert  « ok »    : tout va bien, c'est fait (mise à jour installée, site publié, décision réversible) ;
//   orange « souci » : quelque chose à surveiller ou à régler ;
//   rouge « grave »  : à regarder maintenant.
// Chaque bulle dit quoi faire (procédure) et propose les manips utiles ; cliquer ramène à la page.
import { EventEmitter } from 'node:events';
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Action, Alert, Level, Manip, Module } from './types.ts';

export type NoticeLevel = 'ok' | 'souci' | 'grave';
export interface NoticeAction { module: string; action: string; input: Record<string, unknown>; label: string; /** demande ton accord avant de partir */ grave?: string; primary?: boolean }
export interface Notice {
  id: string; at: string; level: NoticeLevel; kind: string; module: string; app: string; title: string; detail?: string;
  steps: string[]; actions: NoticeAction[];
  /** où aller : l'appli (id de module) ou une page d'Odin (« chat », « reglages »…) */
  page?: { app?: string; view?: string };
  source: 'alerte' | 'decision' | 'maj' | 'info'; ref?: string;
}
export const KIND: Record<NoticeLevel, string> = { ok: 'Tout va bien', souci: 'Un souci', grave: 'Grave' };
/** Le niveau d'une alerte d'appli. Pur. */
export function levelOf(l: Level): NoticeLevel { return l === 'critique' ? 'grave' : l === 'haute' || l === 'moyenne' ? 'souci' : 'ok'; }

/** Les bulles passent aussi aux pages ouvertes (le serveur web les relaie en direct). */
export const noticeBus = new EventEmitter();
noticeBus.setMaxListeners(50);

interface Host { dir: string; modules(): Module[]; module(id: string): Module | undefined; events: EventEmitter }
const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Les manips de l'appli qui collent à ce qui se passe (mots de l'alerte), sans réglage à donner. Pur. */
export function suggest(m: Module | undefined, text: string, max = 2): NoticeAction[] {
  if (!m) return [];
  const t = ` ${norm(text).replace(/[^\w\s-]/g, ' ')} `;
  const hit = (w: string) => { const n = norm(w); return n.length > 2 && (n.includes(' ') ? t.includes(n) : new RegExp(`\\b${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(t)); };
  const free = (a: Action) => !a.read && !(a.params ?? []).some((p) => p.required);
  return m.actions.filter(free).map((a) => ({ a, s: (a.words ?? []).filter(hit).length * 2 + a.label.split(/\s+/).filter((w) => w.length > 4 && hit(w)).length }))
    .filter((x) => x.s > 0).sort((x, y) => y.s - x.s).slice(0, max)
    .map(({ a }) => ({ module: m.id, action: a.id, input: {}, label: a.label, ...(a.grave ? { grave: 'cette action demande ton accord' } : {}) }));
}

/** Procédure par défaut selon le niveau, quand l'appli n'en donne pas. Pur. */
export function defaultSteps(level: NoticeLevel, app: string): string[] {
  if (level === 'grave') return [`Ouvre ${app} pour voir ce qui se passe (bouton « Aller sur la page »).`, 'Fais la manip proposée si elle correspond ; Odin te demande ton accord avant toute action risquée.', 'Si tu ne comprends pas, demande-moi conseil : je t\'explique pas à pas.'];
  if (level === 'souci') return [`Regarde le détail dans ${app}.`, 'Règle-le quand tu as un moment, ou demande-moi conseil.'];
  return ['Rien à faire.'];
}

export class Notices {
  private list: Notice[] = [];
  private file: string;
  private off: Array<() => void> = [];
  private v: Host;
  constructor(v: Host) {
    this.v = v;
    this.file = join(v.dir, 'bulles.jsonl');
    try { if (existsSync(this.file)) this.list = readFileSync(this.file, 'utf8').split('\n').filter(Boolean).slice(-300).map((l) => JSON.parse(l) as Notice); } catch { this.list = []; }
    const onAlert = (a: Alert) => this.fromAlert(a), onManip = (m: Manip) => this.fromManip(m);
    v.events.on('alert', onAlert); v.events.on('manip', onManip);
    this.off.push(() => v.events.off('alert', onAlert), () => v.events.off('manip', onManip));
    current = this;
  }
  stop(): void { for (const f of this.off) f(); if (current === this) current = undefined; }
  recent(n = 30): Notice[] { return this.list.slice(-n).reverse(); }
  get(id: string): Notice | undefined { return this.list.find((x) => x.id === id); }

  add(n: Omit<Notice, 'id' | 'at' | 'kind' | 'steps' | 'actions' | 'app'> & Partial<Pick<Notice, 'kind' | 'steps' | 'actions' | 'app'>>): Notice {
    const app = n.app ?? this.v.module(n.module)?.name ?? n.module;
    const full: Notice = { ...n, id: Math.random().toString(36).slice(2, 10), at: new Date().toISOString(), app, kind: n.kind ?? KIND[n.level], steps: n.steps?.length ? n.steps : defaultSteps(n.level, app), actions: n.actions ?? [] };
    this.list.push(full);
    try {
      appendFileSync(this.file, `${JSON.stringify(full)}\n`);
      if (this.list.length > 600) { this.list = this.list.slice(-300); writeFileSync(this.file, `${this.list.map((x) => JSON.stringify(x)).join('\n')}\n`); }
    } catch { /* dossier disparu : la bulle part quand même */ }
    noticeBus.emit('notice', full);
    return full;
  }

  /** Une alerte d'appli devient une bulle (avec sa procédure et ses manips). */
  fromAlert(a: Alert): Notice {
    const m = this.v.module(a.module), level = levelOf(a.level);
    const fix = a.fix ? [{ module: a.fix.module ?? a.module, action: a.fix.action, input: a.fix.input ?? {}, label: a.fix.label, primary: true, ...(this.v.module(a.fix.module ?? a.module)?.actions.find((x) => x.id === a.fix!.action)?.grave ? { grave: 'cette action demande ton accord' } : {}) }] : [];
    const more = suggest(m, `${a.title} ${a.detail ?? ''}`).filter((x) => !fix.some((f) => f.module === x.module && f.action === x.action));
    return this.add({ level, module: a.module, title: a.title, detail: a.detail, steps: a.steps, actions: [...fix, ...more].slice(0, 3), page: { app: a.module }, source: 'alerte', ref: a.id });
  }

  /** Une décision prise seul par Odin (manip à garder ou annuler) devient une bulle verte. */
  fromManip(x: Manip): Notice | undefined {
    if (x.state !== 'à décider') return undefined;
    const qui = x.by === 'réflexe' ? 'par réflexe entre applis' : x.by === 'automatisation' ? 'par une automatisation' : 'de lui-même';
    return this.add({
      level: 'ok', kind: 'Décision d\'Odin', module: x.module, title: x.text || x.label, detail: `${x.label} — fait ${qui}${x.why ? ` (${x.why})` : ''}.`,
      steps: x.undo ? ['Si ça te va, rien à faire (ou « Garder »).', `Sinon, « ${x.undo.label} » : Odin remet tout comme avant.`] : ['Si ça te va, rien à faire.', 'Sinon, dis-le à Odin : il te dira comment revenir en arrière.'],
      actions: [{ module: '_manip', action: 'garder', input: { id: x.id }, label: 'Garder' }, ...(x.undo ? [{ module: '_manip', action: 'annuler', input: { id: x.id }, label: x.undo.label, primary: true }] : [])],
      page: { app: x.module }, source: 'decision', ref: x.id,
    });
  }
}
let current: Notices | undefined;
export const noticesOf = () => current;
/** Une bulle depuis n'importe où dans Odin (mise à jour, tunnel…) ; sans applis démarrées, rien. */
export function postNotice(n: Parameters<Notices['add']>[0]): Notice | undefined { return current?.add(n); }
