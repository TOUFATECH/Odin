// Un faux navigateur pour les essais du lecteur de Venus (lot V2) : assez de DOM pour que planetes.js, lecteur.js et
// app.js tournent pour de vrai sans navigateur (éléments, texte, classes, sélecteurs simples, évènements qui remontent,
// un <video> qu'on pilote à la main). Les fetch partent vers un vrai Odin. Aucun paquet extérieur.
import vm from 'node:vm';

type Fn = (...a: unknown[]) => unknown;
export interface Ev { type: string; target: FEl; currentTarget?: FEl; key?: string; shiftKey?: boolean; ctrlKey?: boolean; metaKey?: boolean; keyCode?: number; clientX?: number; movementX?: number; movementY?: number; defaultPrevented: boolean; stop: boolean; preventDefault(): void; stopPropagation(): void }

const ech = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
export class FText { parentNode: FEl | null = null; nodeType = 3; data: string; constructor(data: string) { this.data = data; } get textContent() { return this.data; } set textContent(v: string) { this.data = v; } remove() { this.parentNode?.retirer(this); } }
type Noeud = FEl | FText;

export class FEl {
  nodeType = 1; tagName: string; attrs = new Map<string, string>(); childNodes: Noeud[] = []; parentNode: FEl | null = null;
  style: Record<string, string> & { setProperty(k: string, v: string): void } = Object.assign({}, { setProperty(this: Record<string, string>, k: string, v: string) { this[k] = v; } }) as never;
  dataset: Record<string, string> = {}; ecoute = new Map<string, Fn[]>(); brut = ''; value = ''; disabled = false; checked = false;
  doc: FDoc; constructor(doc: FDoc, tag: string) { this.doc = doc; this.tagName = tag.toUpperCase(); }
  get children() { return this.childNodes.filter((c): c is FEl => c instanceof FEl); }
  get className() { return this.attrs.get('class') ?? ''; } set className(v: string) { this.attrs.set('class', String(v)); }
  get id() { return this.attrs.get('id') ?? ''; }
  get hidden() { return this.attrs.has('hidden'); } set hidden(v: boolean) { if (v) this.attrs.set('hidden', ''); else this.attrs.delete('hidden'); }
  get classList() {
    const lire = () => this.className.split(/\s+/).filter(Boolean), poser = (l: string[]) => { this.className = [...new Set(l)].join(' '); };
    return { add: (...c: string[]) => poser([...lire(), ...c]), remove: (...c: string[]) => poser(lire().filter((x) => !c.includes(x))), contains: (c: string) => lire().includes(c),
      toggle: (c: string, f?: boolean) => { const on = f ?? !lire().includes(c); poser(on ? [...lire(), c] : lire().filter((x) => x !== c)); return on; } };
  }
  setAttribute(k: string, v: string) { this.attrs.set(k, String(v)); }
  getAttribute(k: string) { return this.attrs.has(k) ? this.attrs.get(k)! : null; }
  hasAttribute(k: string) { return this.attrs.has(k); }
  removeAttribute(k: string) { this.attrs.delete(k); }
  private poser(n: Noeud) { if (n.parentNode) n.parentNode.retirer(n); n.parentNode = this; return n; }
  retirer(n: Noeud) { this.childNodes = this.childNodes.filter((c) => c !== n); n.parentNode = null; }
  append(...k: Array<Noeud | string>) { for (const c of k) this.childNodes.push(this.poser(typeof c === 'string' ? new FText(c) : c)); }
  prepend(...k: Noeud[]) { for (const c of [...k].reverse()) this.childNodes.unshift(this.poser(c)); }
  insertBefore(n: Noeud, ref: Noeud | null) { this.poser(n); const i = ref ? this.childNodes.indexOf(ref) : -1; this.childNodes.splice(i < 0 ? this.childNodes.length : i, 0, n); return n; }
  replaceChildren(...k: Array<Noeud | string>) { for (const c of [...this.childNodes]) this.retirer(c); this.brut = ''; this.append(...k); }
  remove() { this.parentNode?.retirer(this); }
  get textContent(): string { return this.childNodes.map((c) => c.textContent).join(''); }
  set textContent(v: string) { this.replaceChildren(new FText(String(v))); }
  /** innerHTML : gardé tel quel (dessins des icônes, pages d'app.js), jamais lu comme des éléments. */
  get innerHTML(): string { return this.brut || this.childNodes.map((c) => (c instanceof FEl ? c.outerHTML : ech(c.data))).join(''); }
  set innerHTML(v: string) { for (const c of [...this.childNodes]) this.retirer(c); this.brut = String(v); }
  get outerHTML(): string { const t = this.tagName.toLowerCase(); return `<${t}${[...this.attrs].map(([k, v]) => ` ${k}="${ech(v)}"`).join('')}>${this.innerHTML}</${t}>`; }
  addEventListener(t: string, f: Fn) { this.ecoute.set(t, [...(this.ecoute.get(t) ?? []), f]); }
  removeEventListener(t: string, f: Fn) { this.ecoute.set(t, (this.ecoute.get(t) ?? []).filter((x) => x !== f)); }
  /** Un évènement qui remonte jusqu'au document (comme un clic). */
  emettre(type: string, props: Partial<Ev> = {}): Ev {
    const e: Ev = { type, target: this, defaultPrevented: false, stop: false, preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.stop = true; }, ...props } as Ev;
    for (let n: FEl | null = this; n && !e.stop; n = n.parentNode) { e.currentTarget = n; for (const f of n.ecoute.get(type) ?? []) f(e); }
    if (!e.stop) for (const f of this.doc.ecoute.get(type) ?? []) f(e);
    return e;
  }
  click() { this.emettre('click', { clientX: 0 }); }
  focus() { this.doc.activeElement = this; }
  blur() { if (this.doc.activeElement === this) this.doc.activeElement = this.doc.body; }
  contains(n: unknown): boolean { for (let x = n as FEl | null; x; x = x.parentNode) if (x === this) return true; return false; }
  getBoundingClientRect() { return { left: 0, top: 0, width: 100, height: 10, right: 100, bottom: 10 }; }
  matches(sel: string) { return correspond(this, sel); }
  closest(sel: string): FEl | null { for (let x: FEl | null = this; x; x = x.parentNode) if (correspond(x, sel)) return x; return null; }
  querySelectorAll(sel: string): FEl[] { const out: FEl[] = []; const tour = (n: FEl) => { for (const c of n.children) { if (correspond(c, sel)) out.push(c); tour(c); } }; tour(this); return out; }
  querySelector(sel: string): FEl | null { return this.querySelectorAll(sel)[0] ?? null; }
}

/** Sélecteurs simples : tag, #id, .classe, [attr], [attr="v"], combinés, séparés par des virgules ou des espaces. */
function simple(el: FEl, s: string): boolean {
  const re = /([a-z0-9-]+)|#([\w-]+)|\.([\w-]+)|\[([\w-]+)(?:="([^"]*)")?\]|(:not\([^)]*\))/gi; let m: RegExpExecArray | null, vu = 0;
  while ((m = re.exec(s))) {
    vu += m[0].length;
    if (m[1] && el.tagName !== m[1].toUpperCase()) return false;
    if (m[2] && el.id !== m[2]) return false;
    if (m[3] && !el.classList.contains(m[3])) return false;
    if (m[4] && (m[5] === undefined ? !el.hasAttribute(m[4]) : el.getAttribute(m[4]) !== m[5])) return false;
    if (m[6] && simple(el, m[6].slice(5, -1))) return false;
  }
  return vu > 0;
}
function correspond(el: FEl, sel: string): boolean {
  return (sel.match(/(?:[^,[]|\[[^\]]*\])+/g) ?? []).some((g) => {
    const parts = g.trim().match(/(?:[^\s[]|\[[^\]]*\])+/g) ?? []; if (!simple(el, parts[parts.length - 1])) return false;
    let n = el.parentNode;
    for (let i = parts.length - 2; i >= 0; i--) { while (n && !simple(n, parts[i])) n = n.parentNode; if (!n) return false; n = n.parentNode; }
    return true;
  });
}

/** Un <video> piloté par l'essai : lecture, pause, temps, durée, et les évènements que le navigateur enverrait. */
export class FVideo extends FEl {
  paused = true; currentTime = 0; duration = NaN; volume = 1; muted = false; playbackRate = 1; defaultPlaybackRate = 1; readyState = 0; seeking = false; ended = false; error = null;
  buffered = { length: 0, start: () => 0, end: () => 0 }; seekable = { length: 0, start: () => 0, end: () => 0 };
  get src() { return this.getAttribute('src') ?? ''; } set src(v: string) { this.setAttribute('src', v); }
  play() { if (this.paused) { this.paused = false; this.emettre('play'); } return Promise.resolve(); }
  pause() { if (!this.paused) { this.paused = true; this.emettre('pause'); } }
  load() { /* rien */ }
}

export class FDoc {
  ecoute = new Map<string, Fn[]>(); activeElement: FEl | null = null; title = ''; styleSheets: unknown[] = []; visibilityState = 'visible'; fullscreenElement = null; temoins = '';
  documentElement: FEl; head: FEl; body: FEl;
  constructor(lang = 'fr') {
    this.documentElement = new FEl(this, 'html'); this.documentElement.setAttribute('lang', lang);
    this.head = new FEl(this, 'head'); this.body = new FEl(this, 'body'); this.documentElement.append(this.head, this.body); this.activeElement = this.body;
  }
  get cookie() { return this.temoins; } set cookie(c: string) { const [kv] = c.split(';'); const k = kv.split('=')[0]; this.temoins = [...this.temoins.split(/;\s*/).filter((x) => x && !x.startsWith(`${k}=`)), kv].join('; '); }
  createElement(t: string) { return t.toLowerCase() === 'video' ? new FVideo(this, t) : new FEl(this, t); }
  createElementNS(_ns: string, t: string) { return new FEl(this, t); }
  createTextNode(s: string) { return new FText(s); }
  addEventListener(t: string, f: Fn) { this.ecoute.set(t, [...(this.ecoute.get(t) ?? []), f]); }
  removeEventListener(t: string, f: Fn) { this.ecoute.set(t, (this.ecoute.get(t) ?? []).filter((x) => x !== f)); }
  querySelector(s: string) { return this.documentElement.querySelector(s); }
  querySelectorAll(s: string) { return this.documentElement.querySelectorAll(s); }
  getElementById(id: string) { return this.documentElement.querySelector(`#${id}`); }
  contains(n: unknown) { return this.documentElement.contains(n); }
  /** Une touche du clavier, envoyée comme le navigateur (au document, à l'élément qui a le focus). */
  touche(key: string, o: Partial<Ev> = {}): Ev {
    const e: Ev = { type: 'keydown', key, target: this.activeElement ?? this.body, defaultPrevented: false, stop: false, preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.stop = true; }, ...o } as Ev;
    for (const f of this.ecoute.get('keydown') ?? []) { if (e.stop) break; f(e); }
    return e;
  }
}

export interface Fenetre { doc: FDoc; win: Record<string, unknown>; ctx: vm.Context; location: { hash: string; href: string }; aller(h: string): Promise<void>; app: FEl }
export const attendre = (ms = 60) => new Promise((r) => setTimeout(r, ms));

/** Lance les scripts de la page (dans l'ordre) dans un faux navigateur relié au vrai Odin `url`, avec ce témoin. */
export async function fenetre(url: string, cookie: string, scripts: string[], o: { largeur?: number } = {}): Promise<Fenetre> {
  const doc = new FDoc(); doc.temoins = cookie;
  const app = new FEl(doc, 'div'); app.setAttribute('id', 'app'); doc.body.append(app);
  const location = { hash: '#/', href: `${url}/venus/app/` };
  const ecoute = new Map<string, Fn[]>(), stock = new Map<string, string>();
  const win: Record<string, unknown> = {
    navigator: { language: 'fr-FR' }, location, scrollY: 0, innerWidth: o.largeur ?? 1280, innerHeight: 800,
    addEventListener: (t: string, f: Fn) => { ecoute.set(t, [...(ecoute.get(t) ?? []), f]); }, removeEventListener: (t: string, f: Fn) => { ecoute.set(t, (ecoute.get(t) ?? []).filter((x) => x !== f)); },
    history: { length: 1, replaceState: (_a: unknown, _b: unknown, h: string) => { location.hash = h; }, back() {} },
    scrollTo() {}, requestAnimationFrame: (f: Fn) => setTimeout(f, 0),
    matchMedia: (q: string) => ({ matches: /reduced-motion/.test(q), addEventListener() {}, removeEventListener() {} }),
    localStorage: { getItem: (k: string) => stock.get(k) ?? null, setItem: (k: string, v: string) => { stock.set(k, String(v)); }, removeItem: (k: string) => { stock.delete(k); } },
    fetch: (chemin: string, i: { headers?: Record<string, string>; method?: string; body?: string } = {}) => fetch(url + chemin, { method: i.method, body: i.body, headers: { ...(i.headers ?? {}), cookie: doc.temoins } }),
  };
  const ctx = vm.createContext({ ...win, window: win, document: doc, URLSearchParams, Intl, setTimeout, clearTimeout, setInterval, clearInterval, MutationObserver: class { observe() {} disconnect() {} } });
  for (const k of Object.keys(win)) (ctx as Record<string, unknown>)[k] = win[k];
  // window et le contexte global sont le même objet pour les scripts (window.VenusLecteur lu par app.js)
  (ctx as Record<string, unknown>).window = ctx;
  for (const s of scripts) vm.runInContext(s, ctx);
  for (let k = 0; k < 150; k++) { await attendre(30); if (app.innerHTML && !/aria-busy="true"/.test(app.innerHTML)) break; }
  await attendre(150);
  return {
    doc, win: ctx as Record<string, unknown>, ctx, location, app,
    async aller(h) { location.hash = h; for (const f of ecoute.get('hashchange') ?? []) f(); await attendre(300); },
  };
}
