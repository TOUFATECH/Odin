// Page générique des applis (src/web/valhalla.js) : le voile des réponses secrètes vaut pour TOUS les QR codes secrets
// (appareil du VPN, Wi-Fi invités, invitation, double authentification), pas seulement pour celui d'un appareil.
//  - la phrase du voile ne parle plus de « la clé secrète de l'appareil » ;
//  - le lien d'une invitation n'est écrit nulle part (titre, nom de la fenêtre, résultat sous le bouton) tant que le
//    voile n'est pas levé ; « Montrer le QR code » le montre avec le QR code.
// Le vrai script tourne dans une page minimale (sans navigateur) ; Odin est simulé par une réponse fixe.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

type Ecoute = (e: Record<string, unknown>) => unknown;
type N = { tag: string; attrs: Record<string, string>; childNodes: N[]; parentNode: N | null; className: string; hidden: boolean; open: boolean; textContent: string; style: { cssText: string }; nodeType: number; ecoutes: Record<string, Ecoute[]>; append: (...k: N[]) => void; [k: string]: unknown };
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 3 3"><path d="M0 0h1v1H0z"/></svg>';
const LIEN = 'https://odin.example.org/sso/invitation?jeton=JETON-A-USAGE-UNIQUE-5f2c9a';

/** Une page minimale : l'appli a une ligne avec un bouton « Demander » ; la réponse d'Odin est celle qu'on donne. */
function page(reponse: { text: string; data: Record<string, unknown> }) {
  const make = (tag: string): N => {
    const n: N = {
      tag, attrs: {}, childNodes: [], parentNode: null, className: '', hidden: false, open: false, textContent: '', style: { cssText: '' }, nodeType: 1, ecoutes: {},
      get children() { return n.childNodes.filter((c) => c.nodeType === 1); }, get firstChild() { return n.childNodes[0] ?? null; }, get lastChild() { return n.childNodes.at(-1) ?? null; },
      classList: { add: (c: string) => { n.className = `${n.className} ${c}`.trim(); }, remove() {}, toggle() {}, contains: (c: string) => n.className.split(/\s+/).includes(c) },
      setAttribute: (k: string, v: string) => { n.attrs[k] = String(v); if (k === 'hidden') n.hidden = true; }, getAttribute: (k: string) => n.attrs[k] ?? null, removeAttribute: (k: string) => { delete n.attrs[k]; },
      addEventListener: (t: string, f: Ecoute) => { (n.ecoutes[t] ??= []).push(f); }, removeEventListener: (t: string, f: Ecoute) => { n.ecoutes[t] = (n.ecoutes[t] ?? []).filter((x) => x !== f); },
      focus() {}, scrollIntoView() {}, click() {},
      append: (...k: N[]) => { for (let c of k) { if (c === null || typeof c !== 'object') c = { ...make('#text'), nodeType: 3, textContent: String(c) }; if (c.parentNode) c.parentNode.childNodes = c.parentNode.childNodes.filter((x) => x !== c); c.parentNode = n; n.childNodes.push(c); } },
      replaceChildren: (...k: N[]) => { for (const c of n.childNodes) c.parentNode = null; n.childNodes = []; (n.append as (...x: N[]) => void)(...k); },
      insertBefore: (c: N, ref: N | null) => { (n.append as (...x: N[]) => void)(c); if (ref) { n.childNodes.pop(); n.childNodes.splice(n.childNodes.indexOf(ref), 0, c); } return c; },
      remove: () => { if (n.parentNode) n.parentNode.childNodes = n.parentNode.childNodes.filter((x) => x !== n); n.parentNode = null; },
      querySelector: () => null, querySelectorAll: () => [], set innerHTML(_v: string) { /* icônes : sans importance ici */ },
      showModal: () => { n.open = true; }, close: () => { if (!n.open) return; n.open = false; for (const f of [...(n.ecoutes.close ?? [])]) f({ target: n }); },
    };
    return n;
  };
  const body = make('div'), app = make('div'), corps = make('body'), ecoutes: Record<string, Ecoute[]> = {};
  const document = {
    readyState: 'complete', head: make('head'), body: corps, activeElement: null, hidden: false,
    createElement: make, createElementNS: (_ns: string, t: string) => make(t), createTextNode: (t: string) => ({ ...make('#text'), nodeType: 3, textContent: t }),
    addEventListener: (t: string, f: Ecoute) => { (ecoutes[t] ??= []).push(f); }, removeEventListener: (t: string, f: Ecoute) => { ecoutes[t] = (ecoutes[t] ?? []).filter((x) => x !== f); },
    dispatchEvent() { return true; }, getElementById: () => null, querySelector: (s: string) => (s === '#v-app .body' ? body : s === '#app' ? app : null), querySelectorAll: () => [],
  };
  const vue = { ok: true, name: 'var', what: 'Les comptes.', does: ['une chose'], similaires: [], alerts: [], links: [], actions: [],
    view: { subtitle: 'état', kpis: [], sections: [{ kind: 'table', title: 'Personnes', columns: ['Nom'], rows: [{ cells: ['Proche A'], actions: [{ action: 'inviter', label: 'Demander', input: { nom: 'Proche A' } }] }] }] } };
  const ctx: Record<string, unknown> = {
    document, console, URLSearchParams, btoa, navigator: {}, CustomEvent: class { type: string; constructor(type: string) { this.type = type; } },
    location: { reload() {}, hostname: 'localhost' }, localStorage: { getItem: () => null, setItem() {} }, OdinDialog: { confirm: async () => true },
    fetch: async (u: string) => ({ status: 200, json: async () => (u.startsWith('/api/valhalla/view') ? vue : u === '/api/valhalla/act' ? { ok: true, text: reponse.text, data: JSON.parse(JSON.stringify(reponse.data)) } : { ok: false }) }),
    setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {},
  };
  ctx.window = ctx;
  vm.runInNewContext(readFileSync(new URL('../src/web/valhalla.js', import.meta.url), 'utf8'), ctx);
  const tous = (r: N, out: N[] = []): N[] => { for (const c of r.childNodes) { if (c.nodeType === 1) { out.push(c); tous(c, out); } } return out; };
  const texte = (n: N): string => (n.nodeType === 3 ? n.textContent : n.childNodes.map(texte).join(''));
  const bouton = (r: N, mot: RegExp) => tous(r).find((n) => n.tag === 'button' && mot.test(texte(n)));
  const cliquer = async (n: N) => { for (const f of n.ecoutes.click ?? []) await f({ target: n, currentTarget: n, preventDefault() {} }); };
  /** Tout ce qui est écrit dans un morceau de page : les textes et les attributs. */
  const ecrit = (r: N) => `${texte(r)} ${JSON.stringify([r.attrs, ...tous(r).map((n) => n.attrs)])}`;
  return {
    body, corps, tous, texte, bouton, cliquer, ecrit,
    async demander() { await (ctx.OdinApps as { app: (i: string) => Promise<void> }).app('var'); const b = bouton(body, /^Demander$/); assert.ok(b, 'le bouton de la ligne est dessiné'); await cliquer(b); },
    fenetre: () => corps.childNodes.find((n) => n.tag === 'dialog'),
  };
}
const invitation = () => ({ text: `✉ Invitation pour Proche A (groupes famille, valable 3 jour(s)).\nLien (à usage unique) : ${LIEN}`, data: { svg: SVG, alt: 'QR code de l\'invitation', lien: LIEN, id: 'inv-1', secret: true } });

test('le voile : une phrase qui vaut pour tous les QR codes secrets (plus « la clé secrète de l\'appareil »)', async () => {
  for (const data of [invitation().data, { svg: SVG, alt: 'QR code du Wi-Fi invités', secret: true }, { svg: SVG, alt: 'QR code de double authentification', conf: 'ABCD EFGH', secret: true }]) {
    const p = page({ text: 'Voici le QR code.', data }); await p.demander();
    const d = p.fenetre(); assert.ok(d && d.open, 'la fenêtre est ouverte');
    const voile = p.tous(d).find((n) => n.className === 'va-voile'); assert.ok(voile, 'le voile est là');
    assert.match(p.texte(voile), /secret : ne le montre qu'à la bonne personne/); assert.match(p.texte(voile), /caché/); assert.match(p.texte(voile), /2 minutes/);
    assert.doesNotMatch(p.texte(voile), /appareil|clé secrète/, 'la phrase ne parle plus d\'un appareil');
    assert.equal(p.tous(d).filter((n) => n.tag === 'img').length, 0, 'aucune image avant « Montrer »');
  }
});

test('une invitation : son lien n\'est écrit nulle part tant que le voile n\'est pas levé ; « Montrer » le montre avec le QR code', async () => {
  const p = page(invitation()); await p.demander();
  const d = p.fenetre()!; assert.ok(d.open);
  assert.doesNotMatch(p.ecrit(d), /JETON-A-USAGE-UNIQUE|odin\.example\.org/, 'ni le titre, ni le nom de la fenêtre, ni son texte ne portent le lien');
  assert.doesNotMatch(p.ecrit(p.body), /JETON-A-USAGE-UNIQUE|odin\.example\.org/, 'le résultat écrit sous le bouton ne le porte pas non plus');
  assert.match(p.texte(d), /Invitation pour Proche A/, 'le reste du message est gardé'); assert.match(p.texte(d), /Lien \(à usage unique\) : caché/);
  await p.cliquer(p.bouton(d, /^Montrer le QR code$/)!);
  assert.equal(p.tous(d).filter((n) => n.tag === 'img').length, 1, 'le QR code est montré'); assert.ok(p.texte(d).includes(LIEN), 'et le lien avec lui');
  assert.doesNotMatch(p.ecrit(p.body), /JETON-A-USAGE-UNIQUE/, 'toujours pas dans la page derrière la fenêtre');
});

test('contrôle : une réponse qui n\'est pas secrète garde son texte et son image, comme avant', async () => {
  const p = page({ text: `Étiquette prête : ${LIEN}`, data: { svg: SVG, lien: LIEN } }); await p.demander();
  const d = p.fenetre()!;
  assert.equal(p.tous(d).filter((n) => n.tag === 'img').length, 1, 'l\'image est là tout de suite'); assert.ok(p.texte(d).includes(LIEN), 'le texte n\'est pas touché');
  assert.equal(p.bouton(d, /^Montrer le QR code$/), undefined);
});
