// Page générique des applis (onglet « Tout », src/web/valhalla.js) · décision du propriétaire (26/11), « voile-le » :
// la fenêtre qui s'ouvre quand une réponse porte un QR code ou un fichier SECRETS (marqués `secret: true`, ou une
// configuration qui porte une clé privée : ceux d'un appareil du VPN) cache le QR code derrière « Montrer », se ferme seule au bout de 2 minutes et dès
// que la page passe à l'arrière-plan, et ne garde rien une fois fermée. Une réponse non marquée (étiquette
// d'inventaire, export…) s'affiche comme avant.
// Le vrai script valhalla.js tourne dans une page minimale (sans navigateur) ; Odin est simulé par des réponses fixes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

type Ecoute = (e: Record<string, unknown>) => unknown;
type N = {
  tag: string; attrs: Record<string, string>; childNodes: N[]; parentNode: N | null; className: string; hidden: boolean; open: boolean; disabled?: boolean;
  textContent: string; style: { cssText: string }; nodeType: number; ecoutes: Record<string, Ecoute[]>; append: (...k: N[]) => void; [k: string]: unknown;
};
const CONF = '[Interface]\nPrivateKey = AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=\nAddress = 10.8.0.2/32\n';
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 3 3"><path d="M0 0h1v1H0z"/></svg>';

/** Une page minimale qui garde les écoutes et les minuteries, pour les déclencher à la main. */
function page(reponse: Record<string, unknown>) {
  const make = (tag: string): N => {
    const n: N = {
      tag, attrs: {}, childNodes: [], parentNode: null, className: '', hidden: false, open: false, textContent: '', style: { cssText: '' }, nodeType: 1, ecoutes: {},
      get children() { return n.childNodes.filter((c) => c.nodeType === 1); },
      get firstChild() { return n.childNodes[0] ?? null; },
      get lastChild() { return n.childNodes.at(-1) ?? null; },
      classList: { add: (c: string) => { n.className = `${n.className} ${c}`.trim(); }, remove() {}, toggle() {}, contains: (c: string) => n.className.split(/\s+/).includes(c) },
      setAttribute: (k: string, v: string) => { n.attrs[k] = String(v); if (k === 'hidden') n.hidden = true; },
      getAttribute: (k: string) => n.attrs[k] ?? null, removeAttribute: (k: string) => { delete n.attrs[k]; },
      addEventListener: (t: string, f: Ecoute) => { (n.ecoutes[t] ??= []).push(f); },
      removeEventListener: (t: string, f: Ecoute) => { n.ecoutes[t] = (n.ecoutes[t] ?? []).filter((x) => x !== f); },
      focus() {}, scrollIntoView() {}, click() {},
      // Comme le navigateur : ce qui n'est pas un élément est écrit en texte (« null » compris).
      append: (...k: N[]) => { for (let c of k) { if (c === null || typeof c !== 'object') c = { ...make('#text'), nodeType: 3, textContent: String(c) }; if (c.parentNode) c.parentNode.childNodes = c.parentNode.childNodes.filter((x) => x !== c); c.parentNode = n; n.childNodes.push(c); } },
      replaceChildren: (...k: N[]) => { for (const c of n.childNodes) c.parentNode = null; n.childNodes = []; (n.append as (...x: N[]) => void)(...k); },
      insertBefore: (c: N, ref: N | null) => { (n.append as (...x: N[]) => void)(c); if (ref) { n.childNodes.pop(); n.childNodes.splice(n.childNodes.indexOf(ref), 0, c); } return c; },
      remove: () => { if (n.parentNode) n.parentNode.childNodes = n.parentNode.childNodes.filter((x) => x !== n); n.parentNode = null; },
      querySelector: () => null, querySelectorAll: () => [],
      set innerHTML(_v: string) { /* icônes : sans importance ici */ },
      // Une fenêtre (<dialog>) : ouverte par showModal, fermée par close (qui prévient les écoutes « close », comme le navigateur).
      showModal: () => { n.open = true; },
      close: () => { if (!n.open) return; n.open = false; for (const f of [...(n.ecoutes.close ?? [])]) f({ target: n }); },
    };
    return n;
  };
  const body = make('div'), app = make('div'), corps = make('body');
  const ecoutes: Record<string, Ecoute[]> = {}, minuteries: Array<{ id: number; f: () => void; ms: number; vivante: boolean }> = [], demandes: Array<Record<string, unknown>> = [];
  const document = {
    readyState: 'complete', head: make('head'), body: corps, activeElement: null, hidden: false,
    createElement: make, createElementNS: (_ns: string, t: string) => make(t),
    createTextNode: (t: string) => ({ ...make('#text'), nodeType: 3, textContent: t }),
    addEventListener: (t: string, f: Ecoute) => { (ecoutes[t] ??= []).push(f); },
    removeEventListener: (t: string, f: Ecoute) => { ecoutes[t] = (ecoutes[t] ?? []).filter((x) => x !== f); },
    dispatchEvent() { return true; }, getElementById: () => null,
    querySelector: (s: string) => (s === '#v-app .body' ? body : s === '#app' ? app : null), querySelectorAll: () => [],
  };
  const vue = {
    ok: true, name: 'gjoll', what: 'Le VPN.', does: ['une chose'], similaires: [], alerts: [], links: [], actions: [],
    view: { subtitle: 'état', kpis: [], sections: [{ kind: 'table', title: 'Appareils', columns: ['Nom'], rows: [{ cells: ['Téléphone 1'], actions: [{ action: 'qr', label: 'Demander', input: { nom: 'Téléphone 1' } }] }] }] },
  };
  const ctx: Record<string, unknown> = {
    document, console, URLSearchParams, btoa, navigator: {}, CustomEvent: class { type: string; constructor(type: string) { this.type = type; } },
    location: { reload() {}, hostname: 'localhost' }, localStorage: { getItem: () => null, setItem() {} },
    OdinDialog: { confirm: async () => true },
    fetch: async (u: string, o?: { body?: string }) => ({ status: 200, json: async () => {
      if (u.startsWith('/api/valhalla/view')) return vue;
      if (u !== '/api/valhalla/act') return { ok: false };
      const b = JSON.parse(String(o?.body)) as Record<string, unknown>; demandes.push(b);
      return reponse.secret && b.confirm !== true ? { ok: false, confirm: 'Confirmer : remontrer le QR code de « Téléphone 1 » ?' } : { ok: true, text: 'QR code de « Téléphone 1 ».', data: JSON.parse(JSON.stringify(reponse)) };
    } }),
    setTimeout: (f: () => void, ms: number) => { minuteries.push({ id: minuteries.length + 1, f, ms, vivante: true }); return minuteries.length; },
    clearTimeout: (id: number) => { const m = minuteries.find((x) => x.id === id); if (m) m.vivante = false; },
    setInterval: () => 0, clearInterval() {},
  };
  ctx.window = ctx;
  vm.runInNewContext(readFileSync(new URL('../src/web/valhalla.js', import.meta.url), 'utf8'), ctx);
  const tous = (r: N, out: N[] = []): N[] => { for (const c of r.childNodes) { if (c.nodeType === 1) { out.push(c); tous(c, out); } } return out; };
  const texte = (n: N): string => (n.nodeType === 3 ? n.textContent : n.childNodes.map(texte).join(''));
  const bouton = (r: N, mot: RegExp) => tous(r).find((n) => n.tag === 'button' && mot.test(texte(n)));
  const cliquer = async (n: N) => { for (const f of n.ecoutes.click ?? []) await f({ target: n, currentTarget: n, preventDefault() {} }); };
  return {
    document, corps, ecoutes, minuteries, demandes, tous, texte, bouton, cliquer,
    /** Ouvre l'appli et appuie sur le bouton de la ligne : la réponse d'Odin arrive, la fenêtre s'ouvre. */
    async demander() { await (ctx.OdinApps as { app: (i: string) => Promise<void> }).app('gjoll'); const b = bouton(body, /^Demander$/); assert.ok(b, 'le bouton de la ligne est dessiné'); await cliquer(b); },
    fenetre: () => corps.childNodes.find((n) => n.tag === 'dialog'),
    deuxMinutes: () => minuteries.filter((m) => m.vivante && m.ms === 120000),
  };
}
const images = (p: ReturnType<typeof page>, r: N) => p.tous(r).filter((n) => n.tag === 'img');
const garde = (p: ReturnType<typeof page>, r: N) => JSON.stringify(p.tous(r).map((n) => [n.attrs, p.texte(n)]));

test('une réponse secrète (QR code d\'un appareil du VPN) : la fenêtre s\'ouvre, le QR code est caché derrière « Montrer »', async () => {
  const p = page({ svg: SVG, conf: CONF, filename: 'telephone-1.conf', secret: true });
  await p.demander();
  assert.deepEqual(p.demandes.map((d) => d.confirm), [false, true], 'la page générique pose la question d\'Odin, puis passe l\'accord');
  const d = p.fenetre(); assert.ok(d && d.open, 'la fenêtre est ouverte');
  assert.equal(images(p, d).length, 0, 'aucune image tant que « Montrer » n\'est pas demandé');
  assert.doesNotMatch(JSON.stringify(p.tous(d).map((n) => n.attrs)), /data:image/, 'le tracé n\'est dans aucun attribut');
  const m = p.bouton(d, /^Montrer le QR code$/); assert.ok(m, 'le bouton « Montrer » est là');
  assert.match(p.texte(d), /caché/);
  await p.cliquer(m);
  assert.equal(images(p, d).length, 1, 'montré sur un geste'); assert.match(String(images(p, d)[0].attrs.src), /^data:image\/svg\+xml;base64,/);
  assert.equal(p.bouton(d, /^Montrer le QR code$/), undefined, 'le voile est parti');
});

test('une réponse secrète : la fenêtre se ferme seule au bout de 2 minutes, et ne garde rien', async () => {
  const p = page({ svg: SVG, conf: CONF, filename: 'telephone-1.conf', secret: true });
  await p.demander();
  const d = p.fenetre()!; assert.equal(p.deuxMinutes().length, 1, 'une minuterie de 2 minutes dès l\'ouverture');
  await p.cliquer(p.bouton(d, /^Montrer le QR code$/)!);
  assert.equal(p.deuxMinutes().length, 1, 'repartie de zéro au moment où le QR code est montré (jamais deux)');
  assert.equal((p.ecoutes.visibilitychange ?? []).length, 1);
  p.deuxMinutes()[0].f();
  assert.equal(p.fenetre(), undefined, 'la fenêtre n\'est plus dans la page'); assert.equal(d.open, false);
  assert.equal(d.childNodes.length, 0, 'vidée : ni image, ni configuration');
  assert.doesNotMatch(garde(p, p.corps) + garde(p, d), /PrivateKey|data:image/);
  assert.equal(p.deuxMinutes().length, 0, 'plus de minuterie'); assert.equal((p.ecoutes.visibilitychange ?? []).length, 0, 'plus d\'écoute');
});

test('une réponse secrète : la page passe à l\'arrière-plan → la fenêtre se ferme ; Échap ou « Fermer » : rien n\'est gardé non plus', async () => {
  const p = page({ svg: SVG, conf: CONF, filename: 'telephone-1.conf', secret: true });
  await p.demander();
  let d = p.fenetre()!; await p.cliquer(p.bouton(d, /^Montrer le QR code$/)!);
  // Un changement de visibilité alors que la page est toujours devant : rien ne se ferme.
  for (const f of [...(p.ecoutes.visibilitychange ?? [])]) f({});
  assert.ok(p.fenetre(), 'toujours ouverte au premier plan');
  p.document.hidden = true; for (const f of [...(p.ecoutes.visibilitychange ?? [])]) f({});
  assert.equal(p.fenetre(), undefined, 'fermée à l\'arrière-plan'); assert.equal(d.childNodes.length, 0); assert.equal(p.deuxMinutes().length, 0); assert.equal((p.ecoutes.visibilitychange ?? []).length, 0);
  // Échap (le navigateur ferme la fenêtre lui-même) puis « Fermer ».
  for (const fermer of ['echap', 'bouton']) {
    const q = page({ svg: SVG, conf: CONF, filename: 'telephone-1.conf', secret: true });
    await q.demander(); d = q.fenetre()!; await q.cliquer(q.bouton(d, /^Montrer le QR code$/)!);
    if (fermer === 'echap') (d.close as () => void)(); else await q.cliquer(q.bouton(d, /^Fermer$/)!);
    assert.equal(q.fenetre(), undefined, fermer); assert.equal(d.childNodes.length, 0, `${fermer} : vidée`);
    assert.equal(q.deuxMinutes().length, 0, `${fermer} : plus de minuterie`); assert.equal((q.ecoutes.visibilitychange ?? []).length, 0, `${fermer} : plus d'écoute`);
  }
});

test('un fichier secret sans QR code (« Fichier de configuration ») : replié comme avant, et fermé seul lui aussi', async () => {
  // Pas de marque ici : la configuration est reconnue à sa clé privée.
  const p = page({ conf: CONF, filename: 'telephone-1.conf' });
  await p.demander();
  const d = p.fenetre()!; assert.ok(d.open);
  const det = p.tous(d).find((n) => n.tag === 'details'); assert.ok(det, 'la configuration est sous « Voir la configuration »'); assert.equal(det.attrs.open, undefined, 'repliée');
  assert.doesNotMatch(p.texte(d), /null|undefined/, 'aucun mot parasite à la place du QR code absent');
  assert.equal(p.deuxMinutes().length, 1); p.deuxMinutes()[0].f();
  assert.equal(p.fenetre(), undefined); assert.equal(d.childNodes.length, 0);
});

test('une réponse non marquée secrète (étiquette d\'inventaire, export) : affichée comme avant, sans voile ni fermeture seule', async () => {
  const p = page({ svg: SVG, alt: 'QR code de l\'étiquette INV-0001', conf: 'INV-0001\nImprimante', label: 'Texte de l\'étiquette' });
  await p.demander();
  assert.deepEqual(p.demandes.map((d) => d.confirm), [false]);
  const d = p.fenetre()!; assert.ok(d.open);
  assert.equal(images(p, d).length, 1, 'le QR code non secret est montré tout de suite'); assert.equal(p.bouton(d, /^Montrer/), undefined);
  assert.equal(p.deuxMinutes().length, 0, 'pas de minuterie'); assert.equal((p.ecoutes.visibilitychange ?? []).length, 0, 'pas d\'écoute');
  p.document.hidden = true; assert.ok(p.fenetre(), 'reste ouverte');
  await p.cliquer(p.bouton(d, /^Fermer$/)!); assert.equal(p.fenetre(), undefined);
});
