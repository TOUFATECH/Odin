// Outils des essais de la fenêtre Script (Archytas), lot B : un faux moteur conforme au CONTRAT partagé (le vrai est
// posé par le lot A), un faux serveur qui répond comme les routes /api/archytas/*, et un tout petit faux navigateur
// (sans dépendance) pour charger les pages JS et vérifier ce qu'elles dessinent. Rien d'extérieur, tout en mémoire.

// ---------------- Types du contrat (décrits ici pour les essais ; le lot A les tient en TypeScript)
export type Declencheur = { genre: 'manuel' } | { genre: 'horaire'; rythme: string } | { genre: 'evenement'; module: string; type: string };
export type Etape = { faire: 'action'; module: string; action: string; entree?: Record<string, unknown> } | { faire: 'si'; cond: string; alors: Etape[]; sinon?: Etape[] } | { faire: 'poser'; variable: string; valeur: string };
export type Genre = 'declaratif' | 'code';
export interface EntreeScript { nom: string; mission: string; description: string; genre: Genre; etapes?: Etape[]; code?: string; declencheurs: Declencheur[]; capacites?: string[] }
export interface Stat { runs: number; ok: number; echecs: number; msMoyen: number; dernier?: number }
export interface ScriptResume { nom: string; mission: string; description: string; genre: Genre; version: number; actif: boolean; cree: number; modifie: number; dernierUsage?: number; declencheurs: Declencheur[]; stat: Stat; capacites: string[] }
export interface ScriptDetail extends ScriptResume { etapes?: Etape[]; code?: string }
export interface NoeudScript { id: string; label: string; sub: string; usage: number; frais: number; size?: number; color?: string }
export interface Suivi { plusUtilises: ScriptResume[]; recents: ScriptResume[]; anciens: ScriptResume[]; jamais: ScriptResume[] }
export interface Resultat { ok: boolean; texte: string; ms?: number }

interface Dossier extends EntreeScript { cree: number; modifie: number; dernierUsage?: number; version: number; actif: boolean; stat: Stat; capacites: string[] }

const JOUR = 864e5;
const T0 = Date.UTC(2026, 10, 1); // 1er novembre 2026, repère stable

function depart(): Dossier[] {
  return [
    { nom: 'arroser-les-plantes', mission: 'arroser le balcon chaque matin', description: 'Ouvre la vanne 20 s si la terre est sèche.', genre: 'declaratif', declencheurs: [{ genre: 'horaire', rythme: 'tous les jours à 7:00' }], etapes: [{ faire: 'si', cond: 'humidite < 30', alors: [{ faire: 'action', module: 'maison', action: 'ouvrir', entree: { vanne: 'balcon', secondes: 20 } }] }], capacites: [], cree: T0, modifie: T0 + 2 * JOUR, dernierUsage: T0 + 9 * JOUR, version: 3, actif: true, stat: { runs: 9, ok: 8, echecs: 1, msMoyen: 42 } },
    { nom: 'ranger-les-photos', mission: 'ranger les photos du téléphone par mois', description: 'Classe les nouvelles photos dans des dossiers par mois.', genre: 'code', declencheurs: [{ genre: 'manuel' }], code: 'for (const p of entree.photos) { appeler("venus", "ranger", { photo: p.id, dossier: p.mois }); }', capacites: [], cree: T0 + 1 * JOUR, modifie: T0 + 5 * JOUR, dernierUsage: T0 + 6 * JOUR, version: 2, actif: true, stat: { runs: 3, ok: 3, echecs: 0, msMoyen: 110 } },
    { nom: 'sauvegarde-du-soir', mission: 'sauvegarder les documents chaque soir', description: 'Copie le dossier Documents vers le disque de sauvegarde.', genre: 'declaratif', declencheurs: [{ genre: 'horaire', rythme: 'tous les jours à 22:00' }], etapes: [{ faire: 'action', module: 'phenix', action: 'sauvegarder', entree: { dossier: 'Documents' } }], capacites: [], cree: T0 + 3 * JOUR, modifie: T0 + 3 * JOUR, version: 1, actif: true, stat: { runs: 0, ok: 0, echecs: 0, msMoyen: 0 } },
  ];
}

const resume = (d: Dossier): ScriptResume => ({ nom: d.nom, mission: d.mission, description: d.description, genre: d.genre, version: d.version, actif: d.actif, cree: d.cree, modifie: d.modifie, dernierUsage: d.dernierUsage, declencheurs: d.declencheurs, stat: d.stat, capacites: d.capacites });
const detail = (d: Dossier): ScriptDetail => ({ ...resume(d), etapes: d.etapes, code: d.code });

/** Un faux moteur qui respecte MoteurArchytas (assez pour les essais du lot B et l'essai d'intégration). */
export function fauxMoteur(now: () => number = () => T0 + 10 * JOUR) {
  const base = depart();
  const trouver = (nom: string) => base.find((d) => d.nom === nom);
  return {
    data: base,
    async lister(): Promise<ScriptResume[]> { return base.map(resume); },
    async voir(nom: string): Promise<ScriptDetail | undefined> { const d = trouver(nom); return d ? detail(d) : undefined; },
    async creer(e: EntreeScript): Promise<ScriptResume> {
      if (trouver(e.nom)) throw new Error('un script porte déjà ce nom');
      const d: Dossier = { ...e, capacites: e.capacites || [], cree: now(), modifie: now(), version: 1, actif: true, stat: { runs: 0, ok: 0, echecs: 0, msMoyen: 0 } };
      base.push(d); return resume(d);
    },
    async editer(nom: string, patch: Partial<EntreeScript>): Promise<ScriptResume> {
      const d = trouver(nom); if (!d) throw new Error('script inconnu');
      Object.assign(d, patch); d.modifie = now(); d.version += 1; return resume(d);
    },
    async supprimer(nom: string): Promise<void> { const i = base.findIndex((d) => d.nom === nom); if (i >= 0) base.splice(i, 1); },
    async lancer(nom: string): Promise<Resultat> {
      const d = trouver(nom); if (!d) return { ok: false, texte: 'script inconnu' };
      d.stat = { ...d.stat, runs: d.stat.runs + 1, ok: d.stat.ok + 1, msMoyen: 50 }; d.dernierUsage = now();
      return { ok: true, texte: `« ${nom} » a tourné`, ms: 50 };
    },
    async versions(nom: string) { const d = trouver(nom); return d ? [{ version: d.version, change: 'version courante', at: d.modifie }] : []; },
    async revenir(nom: string, _version?: number): Promise<ScriptResume> { const d = trouver(nom); if (!d) throw new Error('script inconnu'); return resume(d); },
    async proposerAmelioration(nom: string) { const d = trouver(nom); return d ? { nom: `${nom} (plus rapide)`, pourquoi: 'Deux étapes fusionnées.', apercuChange: '- deux appels\n+ un seul appel' } : undefined; },
    async appliquerAmelioration(nom: string): Promise<ScriptResume> { const d = trouver(nom); if (!d) throw new Error('script inconnu'); d.modifie = now(); d.version += 1; return resume(d); },
    async graphe(): Promise<{ nodes: NoeudScript[]; edges: [string, string][] }> {
      const nodes = base.map((d) => ({ id: d.nom, label: d.nom, sub: d.mission, usage: Math.min(1, d.stat.runs / 20), frais: Math.max(0, 1 - (now() - (d.dernierUsage || d.modifie)) / (90 * JOUR)) }));
      return { nodes, edges: [] };
    },
    async suivi(): Promise<Suivi> {
      const arr = base.map(resume);
      return {
        plusUtilises: arr.filter((s) => s.stat.runs > 0).sort((a, b) => b.stat.runs - a.stat.runs),
        recents: arr.slice().sort((a, b) => (b.dernierUsage || b.modifie) - (a.dernierUsage || a.modifie)),
        anciens: arr.slice().sort((a, b) => (a.dernierUsage || a.modifie) - (b.dernierUsage || b.modifie)),
        jamais: arr.filter((s) => s.stat.runs === 0),
      };
    },
  };
}
export type FauxMoteur = ReturnType<typeof fauxMoteur>;

/** Un faux fetch qui répond comme les routes /api/archytas/*. `proprietaire:false` masque code et étapes et refuse les écritures. */
export function fauxServeur(moteur: FauxMoteur, opts: { proprietaire?: boolean } = {}) {
  const proprietaire = opts.proprietaire !== false;
  const journal: Array<{ chemin: string; corps: unknown }> = [];
  const rep = (status: number, j: unknown) => ({ status, ok: status >= 200 && status < 300, async json() { return j; } });
  const masque = (d: ScriptDetail | undefined) => { if (!d) return undefined; if (proprietaire) return d; const { etapes, code, ...reste } = d; void etapes; void code; return reste; };
  async function fetch(url: string, init?: unknown) {
    const i = init as { method?: string; body?: string } | undefined;
    const u = new URL(url, 'http://x');
    const chemin = u.pathname.replace('/api/archytas', '');
    const corps = i && i.body ? JSON.parse(i.body) : null;
    if (i && i.method === 'POST') journal.push({ chemin, corps });
    try {
      if (chemin === '/scripts') return rep(200, { scripts: await moteur.lister() });
      if (chemin === '/script') return rep(200, masque(await moteur.voir(u.searchParams.get('nom') || '')));
      if (chemin === '/graphe') return rep(200, await moteur.graphe());
      if (chemin === '/suivi') return rep(200, await moteur.suivi());
      if (chemin === '/versions') return rep(200, { versions: await moteur.versions(u.searchParams.get('nom') || '') });
      if (chemin === '/amelioration' && (!i || i.method !== 'POST')) return rep(200, (await moteur.proposerAmelioration(u.searchParams.get('nom') || '')) || {});
      if (!proprietaire && ['/editer', '/creer', '/supprimer', '/amelioration', '/revenir'].includes(chemin)) return rep(403, { error: 'Réservé au propriétaire.' });
      if (chemin === '/creer') return rep(200, await moteur.creer(corps));
      if (chemin === '/editer') return rep(200, await moteur.editer(corps.nom, corps.patch));
      if (chemin === '/supprimer') { await moteur.supprimer(corps.nom); return rep(200, { ok: true }); }
      if (chemin === '/lancer') return rep(200, await moteur.lancer(corps.nom));
      if (chemin === '/revenir') return rep(200, await moteur.revenir(corps.nom, corps.version));
      if (chemin === '/amelioration') return rep(200, await moteur.appliquerAmelioration(corps.nom));
      return rep(404, { error: 'inconnu' });
    } catch (e) { return rep(400, { error: (e as Error).message }); }
  }
  return { fetch, journal };
}

// ---------------- Un tout petit faux navigateur (sans jsdom ni dépendance)
class FauxNode {
  nodeType = 1; childNodes: FauxNode[] = []; parent: FauxNode | null = null;
  append(...ks: unknown[]) { for (const k of ks) { if (k == null || k === false) continue; const n = k instanceof FauxNode ? k : new FauxText(String(k)); n.parent = this; this.childNodes.push(n); } }
  prepend(...ks: unknown[]) { const n = this.childNodes; this.childNodes = []; this.append(...ks); this.childNodes.push(...n); }
  replaceChildren(...ks: unknown[]) { this.childNodes = []; this.append(...ks); }
  remove() { if (this.parent) this.parent.childNodes = this.parent.childNodes.filter((c) => c !== this); }
  get textContent(): string { return this.childNodes.map((c) => c.textContent).join(''); }
  set textContent(v: string) { this.childNodes = []; if (v !== '' && v != null) this.append(String(v)); }
}
class FauxText extends FauxNode { nodeType = 3; _t: string; constructor(t: string) { super(); this._t = t; } get textContent() { return this._t; } set textContent(v: string) { this._t = v; } }
class FauxEl extends FauxNode {
  tagName: string; localName: string; attributes: Record<string, string> = {}; dataset: Record<string, string> = {}; listeners: Record<string, Array<(e: unknown) => void>> = {};
  style = { cssText: '', setProperty() {} }; _cls = ''; _value: string | undefined;
  constructor(tag: string) { super(); this.localName = tag; this.tagName = tag.toUpperCase(); }
  get className() { return this._cls; } set className(v: string) { this._cls = String(v || ''); }
  get classList() { const self = this; return { add(c: string) { if (!self._cls.split(/\s+/).includes(c)) self._cls = (self._cls + ' ' + c).trim(); }, remove(c: string) { self._cls = self._cls.split(/\s+/).filter((x) => x && x !== c).join(' '); }, contains(c: string) { return self._cls.split(/\s+/).includes(c); }, toggle(c: string, on?: boolean) { const has = this.contains(c); if (on === undefined ? has : !on) this.remove(c); else this.add(c); } }; }
  setAttribute(k: string, v: string) { this.attributes[k] = v; if (k === 'value') this._value = v; if (k.startsWith('data-')) this.dataset[k.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = v; }
  getAttribute(k: string) { return k in this.attributes ? this.attributes[k] : null; }
  removeAttribute(k: string) { delete this.attributes[k]; }
  get value() { return this._value !== undefined ? this._value : (this.localName === 'textarea' ? this.textContent : (this.attributes.value || '')); }
  set value(v: string) { this._value = v; }
  addEventListener(t: string, fn: (e: unknown) => void) { (this.listeners[t] = this.listeners[t] || []).push(fn); }
  removeEventListener() {}
  dispatch(t: string, e: unknown = {}) { for (const fn of this.listeners[t] || []) fn(e); }
  click() { this.dispatch('click', { target: this }); }
  focus() {}
  getContext() { return null; } // pas de WebGL ni de 2D dans le faux navigateur
  getBoundingClientRect() { return { left: 0, top: 0, width: 300, height: 360, right: 300, bottom: 360 }; }
  setPointerCapture() {}
  querySelectorAll(sel: string): FauxEl[] { const out: FauxEl[] = []; const cls = sel.startsWith('.') ? sel.slice(1) : null; const walk = (n: FauxNode) => { for (const c of n.childNodes) { if (c instanceof FauxEl) { if (cls ? c.classList.contains(cls) : c.localName === sel) out.push(c); walk(c); } } }; walk(this); return out; }
  querySelector(sel: string): FauxEl | null { return this.querySelectorAll(sel)[0] || null; }
}

/** Monte un faux navigateur partagé et renvoie de quoi charger les pages et piloter le fetch. */
export function fauxNavigateur() {
  const document = {
    createElement: (t: string) => new FauxEl(t),
    createElementNS: (_ns: string, t: string) => new FauxEl(t),
    createTextNode: (t: string) => new FauxText(String(t)),
    getElementById: () => null,
    head: new FauxEl('head'),
    body: new FauxEl('body'),
    addEventListener() {}, removeEventListener() {}, dispatchEvent() {},
    hidden: false, readyState: 'complete', activeElement: null,
  };
  const window: Record<string, unknown> = {};
  let courant: ((u: string, i?: unknown) => unknown) | null = null;
  const sandbox: Record<string, unknown> = {
    window, document, Node: FauxNode,
    fetch: (u: string, i?: unknown) => (courant ? courant(u, i) : Promise.reject(new Error('aucun serveur'))),
    setTimeout: () => 0, clearTimeout: () => {}, performance: { now: () => 0 },
    matchMedia: () => ({ matches: false }), getComputedStyle: () => ({ getPropertyValue: () => '' }),
    URL, Blob: class {}, CustomEvent: class { type: string; detail: unknown; constructor(t: string, o?: { detail?: unknown }) { this.type = t; this.detail = o && o.detail; } },
    console,
  };
  (window as { matchMedia?: unknown }).matchMedia = sandbox.matchMedia;
  return {
    window, document, sandbox,
    brancherServeur(fetch: (u: string, i?: unknown) => unknown) { courant = fetch; },
    make(tag: string) { return new FauxEl(tag); },
  };
}
export { FauxEl };
