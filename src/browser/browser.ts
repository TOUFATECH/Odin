// Le navigateur d'Odin : il ouvre des pages, regarde, clique, remplit des formulaires.
//
// Odin pilote le Chrome / Chromium / Edge déjà installé sur la machine, par le protocole DevTools
// (WebSocket intégré à Node) : aucune dépendance. Sans écran (serveur, LXC), le navigateur est
// invisible ; sur un ordinateur avec écran, on peut le voir travailler (browser.visible).
// Son profil (connexions, cookies) est gardé dans ~/.odin/browser : il reste connecté à tes sites.
//
// « Regarder » numérote les éléments visibles avec lesquels on peut agir (liens, boutons, champs,
// listes) ; Odin agit ensuite sur un numéro, comme une personne qui voit la page.

import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

// ---------------- Trouver le navigateur ----------------

/** Chemins habituels de Chrome / Chromium / Edge, selon le système. */
export function findBrowser(env = process.env): string | undefined {
  if (env.ODIN_BROWSER && existsSync(env.ODIN_BROWSER)) return env.ODIN_BROWSER;
  const candidates: string[] = [];
  if (process.platform === 'darwin') {
    candidates.push('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser');
  } else if (process.platform === 'win32') {
    for (const base of [env.PROGRAMFILES, env['PROGRAMFILES(X86)'], env.LOCALAPPDATA].filter(Boolean) as string[]) {
      candidates.push(join(base, 'Google/Chrome/Application/chrome.exe'), join(base, 'Microsoft/Edge/Application/msedge.exe'), join(base, 'Chromium/Application/chrome.exe'));
    }
  } else {
    for (const name of ['chromium', 'chromium-browser', 'google-chrome', 'google-chrome-stable', 'microsoft-edge', 'brave-browser']) {
      const r = spawnSync('sh', ['-c', `command -v ${name}`], { encoding: 'utf8' });
      if (r.status === 0 && r.stdout.trim()) candidates.push(r.stdout.trim());
    }
    candidates.push('/snap/bin/chromium');
  }
  // Chromium installé par Playwright (npx playwright install chromium)
  for (const dir of [env.PLAYWRIGHT_BROWSERS_PATH, join(homedir(), '.cache/ms-playwright'), join(homedir(), 'Library/Caches/ms-playwright'), env.LOCALAPPDATA && join(env.LOCALAPPDATA, 'ms-playwright')].filter(Boolean) as string[]) {
    try {
      for (const d of readdirSync(dir).filter((x) => /^chromium-\d+$/.test(x)).sort().reverse()) {
        for (const sub of ['chrome-linux64/chrome', 'chrome-linux/chrome', 'chrome-mac/Chromium.app/Contents/MacOS/Chromium', 'chrome-win/chrome.exe', 'chrome-win64/chrome.exe']) candidates.push(join(dir, d, sub));
      }
    } catch { /* dossier absent */ }
  }
  return candidates.find((c) => existsSync(c));
}

export const BROWSER_HINT = 'Aucun navigateur Chrome/Chromium/Edge trouvé. Installe-en un : Linux « sudo apt install chromium » (ou « npx playwright install chromium »), macOS/Windows : Google Chrome ou Edge. Tu peux aussi indiquer son chemin dans ODIN_BROWSER.';

// ---------------- Protocole DevTools ----------------

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void };

class Cdp {
  private ws: WebSocket;
  private seq = 0;
  private pending = new Map<number, Pending>();
  private listeners = new Set<(method: string, params: Record<string, unknown>, sessionId?: string) => void>();
  constructor(ws: WebSocket) {
    this.ws = ws;
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(String(ev.data)) as { id?: number; result?: unknown; error?: { message: string }; method?: string; params?: Record<string, unknown>; sessionId?: string };
      if (msg.id !== undefined) {
        const p = this.pending.get(msg.id); this.pending.delete(msg.id);
        if (msg.error) p?.reject(new Error(msg.error.message)); else p?.resolve(msg.result);
      } else if (msg.method) for (const l of this.listeners) l(msg.method, msg.params ?? {}, msg.sessionId);
    });
    ws.addEventListener('close', () => { for (const p of this.pending.values()) p.reject(new Error('navigateur fermé')); this.pending.clear(); });
  }
  static async connect(url: string): Promise<Cdp> {
    const ws = new WebSocket(url);
    await new Promise<void>((res, rej) => { ws.addEventListener('open', () => res(), { once: true }); ws.addEventListener('error', () => rej(new Error('connexion au navigateur impossible')), { once: true }); });
    return new Cdp(ws);
  }
  send<T = Record<string, unknown>>(method: string, params: Record<string, unknown> = {}, sessionId?: string, timeoutMs = 30_000): Promise<T> {
    const id = ++this.seq;
    return new Promise<T>((resolve, reject) => {
      const t = setTimeout(() => { this.pending.delete(id); reject(new Error(`le navigateur ne répond pas (${method})`)); }, timeoutMs);
      this.pending.set(id, { resolve: (v) => { clearTimeout(t); resolve(v as T); }, reject: (e) => { clearTimeout(t); reject(e); } });
      this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }
  on(fn: (method: string, params: Record<string, unknown>, sessionId?: string) => void): () => void { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  close(): void { try { this.ws.close(); } catch { /* déjà fermé */ } }
}

// ---------------- Script injecté : ce qu'Odin « voit » ----------------

/** Numérote les éléments visibles avec lesquels on peut agir ; renvoie leur description. */
const LOOK_JS = `(() => {
  const sel = 'a[href],button,input:not([type=hidden]),textarea,select,[role=button],[role=link],[role=checkbox],[role=radio],[role=tab],[role=menuitem],[role=option],[contenteditable=""],[contenteditable=true],summary,label[for],[onclick]';
  document.querySelectorAll('[data-odin-n]').forEach((e) => e.removeAttribute('data-odin-n'));
  const out = []; let n = 0;
  const vis = (e) => { const r = e.getBoundingClientRect(); if (r.width < 2 || r.height < 2) return null; if (r.bottom < 0 || r.right < 0 || r.top > innerHeight || r.left > innerWidth) return null; const st = getComputedStyle(e); if (st.visibility === 'hidden' || st.display === 'none' || +st.opacity === 0) return null; return r; };
  const txt = (s) => (s || '').replace(/\\s+/g, ' ').trim().slice(0, 80);
  for (const e of document.querySelectorAll(sel)) {
    const r = vis(e); if (!r) continue;
    const tag = e.tagName.toLowerCase(), type = (e.getAttribute('type') || '').toLowerCase();
    const lbl = e.labels && e.labels[0] ? e.labels[0].innerText : '';
    const name = txt(e.getAttribute('aria-label') || lbl || e.innerText || e.value || e.getAttribute('placeholder') || e.getAttribute('title') || e.getAttribute('alt') || e.getAttribute('name') || '');
    const kind = tag === 'a' ? 'lien' : tag === 'select' ? 'liste' : tag === 'textarea' ? 'zone de texte' : tag === 'input' ? (['checkbox','radio'].includes(type) ? (type === 'checkbox' ? 'case' : 'option') : ['submit','button','reset','image'].includes(type) ? 'bouton' : 'champ' + (type && type !== 'text' ? ' ' + type : '')) : (e.getAttribute('role') || (tag === 'button' ? 'bouton' : tag));
    n++; e.setAttribute('data-odin-n', String(n));
    const item = { n, kind, name };
    if ((tag === 'input' && !['checkbox','radio'].includes(type)) || tag === 'textarea') { item.value = type === 'password' ? (e.value ? '••••' : '') : txt(e.value); if (e.getAttribute('placeholder')) item.placeholder = txt(e.getAttribute('placeholder')); }
    if (type === 'checkbox' || type === 'radio') item.checked = e.checked;
    if (tag === 'select') { item.value = txt(e.options[e.selectedIndex] ? e.options[e.selectedIndex].text : ''); item.options = [...e.options].slice(0, 30).map((o) => txt(o.text)); }
    if (tag === 'a') item.href = (e.getAttribute('href') || '').slice(0, 120);
    if (e.disabled) item.disabled = true;
    out.push(item);
    if (n >= 150) break;
  }
  const text = (document.body ? document.body.innerText : '').replace(/\\n{3,}/g, '\\n\\n').slice(0, 8000);
  return JSON.stringify({ url: location.href, title: document.title, items: out, text, scroll: { y: Math.round(scrollY), max: Math.round(document.documentElement.scrollHeight - innerHeight) } });
})()`;

/** Pastilles numérotées dessinées sur la page le temps d'une capture (pour la vision). */
const BADGES_JS = (on: boolean) => on ? `(() => {
  const box = document.createElement('div'); box.id = '__odin_badges'; box.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483647';
  for (const e of document.querySelectorAll('[data-odin-n]')) { const r = e.getBoundingClientRect(); const b = document.createElement('div'); b.textContent = e.getAttribute('data-odin-n');
    b.style.cssText = 'position:fixed;left:' + Math.max(0, r.left - 2) + 'px;top:' + Math.max(0, r.top - 2) + 'px;background:#E2A93B;color:#14100A;font:bold 11px/14px sans-serif;padding:0 4px;border-radius:7px;outline:2px solid #fff;';
    const o = document.createElement('div'); o.style.cssText = 'position:fixed;left:' + r.left + 'px;top:' + r.top + 'px;width:' + r.width + 'px;height:' + r.height + 'px;outline:2px solid rgba(226,169,59,.8);border-radius:4px';
    box.append(o, b); }
  document.documentElement.append(box); })()` : `document.getElementById('__odin_badges')?.remove()`;

export interface LookItem { n: number; kind: string; name: string; value?: string; placeholder?: string; checked?: boolean; options?: string[]; href?: string; disabled?: boolean }
export interface Look { url: string; title: string; items: LookItem[]; text: string; scroll: { y: number; max: number } }

/** Description lisible de ce que voit Odin (pur, testable). */
export function describeLook(l: Look, withText = true): string {
  const items = l.items.map((i) => `[${i.n}] ${i.kind}${i.name ? ` « ${i.name} »` : ''}${i.value !== undefined && i.value !== '' ? ` = « ${i.value} »` : ''}${i.placeholder && !i.name ? ` (${i.placeholder})` : ''}${i.checked !== undefined ? (i.checked ? ' ☑' : ' ☐') : ''}${i.options ? ` choix : ${i.options.join(' | ')}` : ''}${i.disabled ? ' (désactivé)' : ''}`).join('\n');
  const pos = l.scroll.max > 0 ? `Défilement : ${Math.round((l.scroll.y / l.scroll.max) * 100)} % (fais défiler pour voir le reste).` : 'Toute la page est visible.';
  return `Page : ${l.title || '(sans titre)'} — ${l.url}\n${pos}\n\nÉléments visibles (agis avec leur numéro) :\n${items || '(aucun élément interactif visible)'}${withText ? `\n\nTexte visible :\n${l.text}` : ''}`;
}

// ---------------- Session de navigation ----------------

export interface BrowserOptions { home: string; visible?: boolean; executable?: string; idleMs?: number }

export class OdinBrowser {
  private proc?: ChildProcess;
  private cdp?: Cdp;
  private session?: string;
  private idle?: NodeJS.Timeout;
  private opts: BrowserOptions;
  private starting?: Promise<void>;
  constructor(opts: BrowserOptions) { this.opts = opts; }

  get running(): boolean { return Boolean(this.cdp); }

  private async start(): Promise<void> {
    const exe = this.opts.executable ?? findBrowser();
    if (!exe) throw new Error(BROWSER_HINT);
    const profile = join(this.opts.home, 'browser');
    mkdirSync(profile, { recursive: true });
    const headless = !this.opts.visible || (process.platform === 'linux' && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY);
    const args = [`--user-data-dir=${profile}`, '--remote-debugging-port=0', '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-sync', '--password-store=basic', '--window-size=1280,900', ...(headless ? ['--headless=new'] : []), ...(typeof process.getuid === 'function' && process.getuid() === 0 ? ['--no-sandbox'] : []), 'about:blank'];
    const proc = spawn(exe, args, { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
    this.proc = proc;
    const wsUrl = await new Promise<string>((resolve, reject) => {
      let buf = '';
      const t = setTimeout(() => reject(new Error('le navigateur ne démarre pas (30 s)')), 30_000);
      proc.stderr!.on('data', (d: Buffer) => { buf += d.toString(); const m = buf.match(/DevTools listening on (ws:\/\/\S+)/); if (m) { clearTimeout(t); resolve(m[1]); } });
      proc.on('exit', (code) => { clearTimeout(t); reject(new Error(`le navigateur s'est arrêté (code ${code}) : ${buf.slice(-300)}`)); });
    });
    this.cdp = await Cdp.connect(wsUrl);
    const { targetId } = await this.cdp.send<{ targetId: string }>('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await this.cdp.send<{ sessionId: string }>('Target.attachToTarget', { targetId, flatten: true });
    this.session = sessionId;
    await this.cdp.send('Page.enable', {}, sessionId);
    await this.cdp.send('Runtime.enable', {}, sessionId);
    await this.cdp.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false }, sessionId);
    // Boîtes de dialogue (alert/confirm) : acceptées pour ne jamais bloquer la page.
    this.cdp.on((method, _p, sid) => { if (method === 'Page.javascriptDialogOpening' && sid === this.session) void this.cdp?.send('Page.handleJavaScriptDialog', { accept: true }, sid).catch(() => {}); });
    proc.on('exit', () => { this.cdp?.close(); this.cdp = undefined; this.session = undefined; });
  }

  private async page(): Promise<{ cdp: Cdp; sid: string }> {
    if (!this.cdp) { this.starting ??= this.start().finally(() => { this.starting = undefined; }); await this.starting; }
    clearTimeout(this.idle);
    this.idle = setTimeout(() => this.close(), this.opts.idleMs ?? 10 * 60_000);
    this.idle.unref?.();
    return { cdp: this.cdp!, sid: this.session! };
  }

  private async eval<T>(expr: string): Promise<T> {
    const { cdp, sid } = await this.page();
    const r = await cdp.send<{ result: { value?: T }; exceptionDetails?: { text: string } }>('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, sid);
    if (r.exceptionDetails) throw new Error(`erreur dans la page : ${r.exceptionDetails.text}`);
    return r.result.value as T;
  }

  /** Attend que la page ait fini de charger (ou 15 s), puis un court moment pour les scripts. */
  private async settle(ms = 15_000): Promise<void> {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      const st = await this.eval<string>('document.readyState').catch(() => 'loading');
      if (st === 'complete') break;
      await new Promise((r) => setTimeout(r, 250));
    }
    await new Promise((r) => setTimeout(r, 400));
  }

  async open(url: string): Promise<Look> {
    const { cdp, sid } = await this.page();
    const r = await cdp.send<{ errorText?: string }>('Page.navigate', { url }, sid);
    if (r.errorText) throw new Error(`page inaccessible : ${r.errorText}`);
    await this.settle();
    return this.look();
  }

  async look(): Promise<Look> { return JSON.parse(await this.eval<string>(LOOK_JS)) as Look; }

  /** Capture d'écran (PNG), avec les numéros des éléments si demandé. */
  async screenshot(badges = false): Promise<Buffer> {
    const { cdp, sid } = await this.page();
    if (badges) { await this.look(); await this.eval(BADGES_JS(true)); }
    try {
      const r = await cdp.send<{ data: string }>('Page.captureScreenshot', { format: 'png' }, sid);
      return Buffer.from(r.data, 'base64');
    } finally { if (badges) await this.eval(BADGES_JS(false)).catch(() => {}); }
  }

  private async center(n: number): Promise<{ x: number; y: number }> {
    const c = await this.eval<{ x: number; y: number } | null>(`(() => { const e = document.querySelector('[data-odin-n="${Number(n)}"]'); if (!e) return null; e.scrollIntoView({ block: 'center', inline: 'center' }); const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
    if (!c) throw new Error(`élément ${n} introuvable : regarde la page à nouveau (les numéros changent quand la page change)`);
    return c;
  }

  /** Clic réel (souris) sur un élément numéroté, ou à des coordonnées. */
  async click(target: { n?: number; x?: number; y?: number }): Promise<Look> {
    const { cdp, sid } = await this.page();
    const p = target.n !== undefined ? await this.center(target.n) : { x: Number(target.x), y: Number(target.y) };
    for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) {
      await cdp.send('Input.dispatchMouseEvent', { type, x: p.x, y: p.y, button: 'left', clickCount: 1 }, sid);
    }
    await this.settle(8_000);
    return this.look();
  }

  /** Écrit dans un champ (clic dedans, efface si demandé, puis tape le texte). */
  async type(n: number, text: string, opts: { clear?: boolean; submit?: boolean } = {}): Promise<Look> {
    const { cdp, sid } = await this.page();
    await this.click({ n });
    if (opts.clear !== false) await this.eval(`(() => { const e = document.querySelector('[data-odin-n="${Number(n)}"]') || document.activeElement; if (e && 'value' in e) { e.select?.(); } else if (e?.isContentEditable) { document.getSelection().selectAllChildren(e); } })()`);
    await cdp.send('Input.insertText', { text }, sid);
    if (opts.submit) await this.key('Enter');
    else await new Promise((r) => setTimeout(r, 200));
    return this.look();
  }

  async select(n: number, choice: string): Promise<Look> {
    const ok = await this.eval<boolean>(`(() => { const e = document.querySelector('[data-odin-n="${Number(n)}"]'); if (!e || e.tagName !== 'SELECT') return false; const want = ${JSON.stringify(choice)}.toLowerCase(); const o = [...e.options].find((o) => o.text.trim().toLowerCase() === want || o.value.toLowerCase() === want) || [...e.options].find((o) => o.text.toLowerCase().includes(want)); if (!o) return false; e.value = o.value; e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
    if (!ok) throw new Error(`choix « ${choice} » introuvable dans la liste ${n}`);
    await new Promise((r) => setTimeout(r, 300));
    return this.look();
  }

  async key(key: string): Promise<Look> {
    const { cdp, sid } = await this.page();
    const KEYS: Record<string, { code: string; keyCode: number; text?: string }> = { Enter: { code: 'Enter', keyCode: 13, text: '\r' }, Tab: { code: 'Tab', keyCode: 9 }, Escape: { code: 'Escape', keyCode: 27 }, Backspace: { code: 'Backspace', keyCode: 8 }, ArrowDown: { code: 'ArrowDown', keyCode: 40 }, ArrowUp: { code: 'ArrowUp', keyCode: 38 }, PageDown: { code: 'PageDown', keyCode: 34 }, PageUp: { code: 'PageUp', keyCode: 33 }, Space: { code: 'Space', keyCode: 32, text: ' ' } };
    const k = KEYS[key]; if (!k) throw new Error(`touche inconnue : ${key} (${Object.keys(KEYS).join(', ')})`);
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: key === 'Space' ? ' ' : key, code: k.code, windowsVirtualKeyCode: k.keyCode, ...(k.text ? { text: k.text } : {}) }, sid);
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: key === 'Space' ? ' ' : key, code: k.code, windowsVirtualKeyCode: k.keyCode }, sid);
    await this.settle(8_000);
    return this.look();
  }

  async scroll(direction: 'down' | 'up', amount = 0.8): Promise<Look> {
    await this.eval(`scrollBy({ top: ${direction === 'up' ? -1 : 1} * innerHeight * ${Math.min(5, Math.max(0.1, amount))}, behavior: 'instant' })`);
    await new Promise((r) => setTimeout(r, 300));
    return this.look();
  }

  async back(): Promise<Look> { await this.eval('history.back()'); await this.settle(8_000); return this.look(); }

  close(): void {
    clearTimeout(this.idle);
    this.cdp?.close(); this.cdp = undefined; this.session = undefined;
    try { this.proc?.kill(); } catch { /* déjà arrêté */ }
    this.proc = undefined;
  }
}
