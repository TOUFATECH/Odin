// Sphinx · Adresses fixes et plan, lot R3 (la page) : le plan de tout le réseau et sa légende en mots, la liste des
// adresses fixes, « Réserver » avec la vérification pendant la frappe (refus : rien ne part), changer, retirer (avec la
// question dans la page), les appareils verrouillés, au clavier. La page est montée dans un document minimal et parle
// au VRAI Sphinx (Valhalla, dossiers temporaires) ; la prise du serveur d'adresses est SIMULÉE (aucun vrai paquet,
// aucun port 67/68). Adresses d'exemple (192.0.2.x), MAC de documentation.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import vm from 'node:vm';
import { MSG, buildPacket, parsePacket, type DhcpConfig, type MacPolicy, type Packet } from '../src/valhalla/vidarr/dhcp.ts';
import { LOCAL, origineDemande } from '../src/valhalla/vidarr/appareils.ts';
import { PRISE_DHCP, dhcpServer, vidarr } from '../src/valhalla/modules/vidarr.ts';
import { Valhalla } from '../src/valhalla/service.ts';
import { auNomDe, setVerificateur } from '../src/valhalla/sso/acces.ts';

const lire = (n: string) => readFileSync(new URL(`../src/web/pages/${n}`, import.meta.url), 'utf8');
const SOURCE_APPAREILS = lire('sphinx-appareils.js'), SOURCE = lire('sphinx-plan.js');
const BOX = '192.0.2.1', ODIN = '192.0.2.2', H = 3600_000, T0 = Date.now();
const M = { box: '00:00:5e:00:53:01', odin: '00:00:5e:00:53:02', pc: '00:00:5e:00:53:23', imp: '00:00:5e:00:53:30', tel: '02:00:5e:00:53:14', piege: '00:00:5e:00:53:77' };
const PIEGE = '<img src=x onerror=alert(1)>Cam';
const dossiers: string[] = [], PRISE = PRISE_DHCP.ecouter, MACS = LOCAL.macs;
after(() => { PRISE_DHCP.ecouter = PRISE; LOCAL.macs = MACS; for (const d of dossiers) rmSync(d, { recursive: true, force: true }); });

// ------------------------------------------------------------------ un document minimal
type Ecoute = (e: Record<string, unknown>) => unknown;
let racine: Noeud;
let actif: Noeud | null = null;
const crees: string[] = [];
class Noeud {
  nodeType: number; tagName: string; parent: Noeud | null = null; enfants: Noeud[] = [];
  attrs: Record<string, string> = {}; ecoutes: Record<string, Ecoute[]> = {}; style: Record<string, string> = {};
  className = ''; texte = ''; value = '';
  classList = {
    add: (c: string) => { if (!this.classList.contains(c)) this.className = `${this.className} ${c}`.trim(); },
    remove: (c: string) => { this.className = this.className.split(/\s+/).filter((x) => x && x !== c).join(' '); },
    contains: (c: string) => this.className.split(/\s+/).includes(c),
  };
  constructor(tag: string, type = 1) { this.tagName = tag.toUpperCase(); this.nodeType = type; if (type === 1) crees.push(this.tagName); }
  get id() { return this.attrs.id ?? ''; }
  get disabled() { return 'disabled' in this.attrs; }
  set innerHTML(_h: string) { throw new Error('la page ne pose jamais de HTML'); }
  set hidden(v: boolean) { if (v) this.attrs.hidden = ''; else delete this.attrs.hidden; }
  get hidden() { return 'hidden' in this.attrs; }
  get children() { return this.enfants.filter((x) => x.nodeType === 1); }
  get textContent(): string { return this.nodeType === 3 ? this.texte : this.enfants.map((x) => x.textContent).join(''); }
  get isConnected() { let n: Noeud | null = this; while (n.parent) n = n.parent; return n === racine; }
  get visible() { for (let n: Noeud | null = this; n; n = n.parent) if (n.hidden) return false; return this.isConnected; }
  private ajouter(k: Noeud | string) { const n = typeof k === 'object' ? k : new Texte(String(k)); n.parent?.retirer(n); n.parent = this; this.enfants.push(n); }
  retirer(n: Noeud) { this.enfants = this.enfants.filter((x) => x !== n); n.parent = null; }
  append(...ks: Array<Noeud | string>) { for (const k of ks) this.ajouter(k); }
  replaceChildren(...ks: Array<Noeud | string>) { for (const e of this.enfants) e.parent = null; this.enfants = []; this.append(...ks); }
  setAttribute(k: string, v: unknown) { if (k === 'class') this.className = String(v); else if (k === 'value') this.value = String(v); else this.attrs[k] = String(v); }
  removeAttribute(k: string) { delete this.attrs[k]; }
  getAttribute(k: string) { return k === 'class' ? this.className : this.attrs[k] ?? null; }
  addEventListener(t: string, f: Ecoute) { (this.ecoutes[t] ??= []).push(f); }
  async emettre(t: string, plus: Record<string, unknown> = {}) {
    const e = { type: t, target: this, preventDefault() {}, stopPropagation() {}, ...plus };
    for (let n: Noeud | null = this; n; n = n.parent) for (const f of [...(n.ecoutes[t] ?? [])]) await f({ ...e, currentTarget: n });
  }
  focus() { actif = this; }
  tous(): Noeud[] { return this.children.flatMap((c) => [c, ...c.tous()]); }
  /** Les sélecteurs dont la page et l'essai ont besoin : « [attribut] », « [attribut="valeur"] », « .classe », « balise », « #id ». */
  querySelectorAll(s: string): Noeud[] {
    const m = /^([a-z0-9]*)(?:#([\w-]+))?(?:\.([\w-]+))?(?:\[([\w-]+)(?:="([^"]*)")?\])?$/i.exec(s.trim()); if (!m) throw new Error(`sélecteur non prévu : ${s}`);
    return this.tous().filter((n) => (!m[1] || m[1].toUpperCase() === n.tagName) && (!m[2] || n.id === m[2]) && (!m[3] || n.classList.contains(m[3])) && (!m[4] || (m[5] === undefined ? m[4] in n.attrs : n.getAttribute(m[4]) === m[5])));
  }
  querySelector(s: string) { return this.querySelectorAll(s)[0] ?? null; }
}
class Texte extends Noeud { constructor(t: string) { super('#text', 3); this.texte = t; } }
const calme = async () => { for (let k = 0; k < 30; k++) await new Promise((ok) => setTimeout(ok, 3)); };
const paquet = (mac: string, type: number, o: { nom?: string; veut?: string } = {}) => buildPacket({ op: 1, xid: 7, mac, options: [[53, Buffer.from([type])], ...(o.nom !== undefined ? [[12, Buffer.from(o.nom, 'utf8')] as [number, Buffer]] : []), ...(o.veut ? [[50, Buffer.from(o.veut.split('.').map(Number))] as [number, Buffer]] : [])] });

/** La page de Sphinx (ses deux fichiers) montée, reliée au vrai Sphinx ; ses demandes notées. */
async function page(o: { membre?: boolean; depuis?: () => string; allume?: boolean } = {}) {
  const home = mkdtempSync(join(tmpdir(), 'sphinx-r3p-')); dossiers.push(home);
  const envois: Packet[] = []; let now = T0;
  PRISE_DHCP.ecouter = async (d) => { (d as unknown as { sock: unknown }).sock = { send: (b: Buffer) => { envois.push(parsePacket(b)); }, close: () => {} }; };
  LOCAL.macs = () => [M.odin]; setVerificateur(() => undefined);
  const v = new Valhalla(home, [vidarr()], { run: async () => ({ code: 1, out: '', err: '' }), fetch: (async () => { throw new Error('aucun réseau'); }) as never, notify: async () => {}, autonomy: () => 'equilibre', now: () => new Date(now) } as never);
  const cfg: DhcpConfig = { server: ODIN, start: '192.0.2.100', end: '192.0.2.199', mask: '255.255.255.0', router: BOX, dns: [ODIN], leaseSeconds: 12 * 3600, domain: 'maison', fixed: [{ mac: M.box, ip: BOX, name: 'Box internet' }] };
  v.ctx('vidarr').saveSettings({ dhcp: cfg });
  const ips: Record<string, string> = {};
  assert.equal((await v.act('vidarr', 'dhcp_demarrer', { forcer: true })).ok !== false, true);
  const prend = (mac: string, nom: string) => { const n = envois.length; dhcpServer()!.onMessage(paquet(mac, MSG.DISCOVER, { nom })); const ip = envois[n].yiaddr; dhcpServer()!.onMessage(paquet(mac, MSG.REQUEST, { nom, veut: ip })); ips[mac] = ip; };
  prend(M.pc, 'PC-BUREAU'); prend(M.tel, 'Telephone 1'); prend(M.piege, PIEGE);
  await v.act('vidarr', 'dhcp_approuver', { mac: M.pc, nom: 'PC du bureau' });
  assert.equal((await v.act('vidarr', 'dhcp_fixe', { mac: M.imp, ip: '192.0.2.30', nom: 'Imprimante' })).ok, true);
  if (o.membre) assert.equal((await v.act('vidarr', 'dhcp_fixe', { mac: M.tel, ip: ips[M.tel], nom: 'Telephone de Nour' })).ok, true);
  if (o.allume === false) assert.equal((await v.act('vidarr', 'dhcp_arreter')).ok, true);
  const mod = v.module('vidarr')!;
  racine = new Noeud('html'); actif = null; crees.length = 0;
  const tete = new Noeud('head'), corps = new Noeud('body'); racine.append(tete, corps);
  const document = { head: tete, body: corps, hidden: false, get activeElement() { return actif; }, createElement: (t: string) => new Noeud(t), createElementNS: (_n: string, t: string) => new Noeud(t), createTextNode: (t: string) => new Texte(t), getElementById: (i: string) => racine.querySelector(`#${i}`) };
  const appels: Array<{ action: string; input: Record<string, unknown>; confirm: boolean }> = [];
  const nour = { login: 'nour', name: 'Nour', groups: ['famille'] };
  const repondre = async (b: { module: string; action: string; input: Record<string, unknown>; confirm?: boolean }) => {
    if (b.module !== 'vidarr') return { ok: false, text: 'refusé par l\'essai' };
    const a = mod.actions.find((x) => x.id === b.action);
    const lancer = async () => {
      // Comme la porte des membres (sso/garde.ts) : la règle est demandée au nom de la personne.
      const regle = a?.proprietaireSeul, seul = typeof regle === 'function' ? regle(b.input, v.ctx('vidarr')) : regle === true;
      if (o.membre && seul) return { ok: false, text: `${mod.name} · ${a?.label} : seul le propriétaire le règle lui-même.` };
      const why = a?.grave?.(b.input, v.ctx('vidarr')); if (why && !b.confirm) return { ok: false, confirm: `Confirmer : ${why} ?` };
      return v.act('vidarr', b.action, b.input);
    };
    const moi = () => (o.membre ? auNomDe(nour, lancer) : lancer());
    return o.depuis ? origineDemande.run(o.depuis(), moi) : moi();
  };
  const fetch = async (_u: string, op: { body: string }) => { const b = JSON.parse(op.body); appels.push({ action: b.action, input: b.input, confirm: Boolean(b.confirm) }); const r = await repondre(b); return { json: async () => JSON.parse(JSON.stringify(r)) }; };
  const window: Record<string, any> = {}; const rythmes: Array<() => unknown> = [];
  const ctx = { window, document, Date, setInterval: (f: () => unknown) => { rythmes.push(f); return rythmes.length; }, clearInterval: () => {}, fetch };
  vm.createContext(ctx);
  vm.runInContext(SOURCE_APPAREILS, ctx); vm.runInContext(SOURCE, ctx);
  const host = new Noeud('div'); corps.append(host);
  const generique = new Noeud('section'); generique.append(new Texte('PAGE GÉNÉRIQUE'));
  const rendu = await window.OdinPages.vidarr({ host, generic: [generique] });
  await calme();
  const qa = (s: string) => corps.querySelectorAll(s).filter((n) => n.visible), q = (s: string) => qa(s)[0] ?? null;
  const f = (cle: string) => q(`[data-f="${cle}"]`);
  const clic = async (cle: string) => { const n = f(cle); assert.ok(n, `élément « ${cle} »`); assert.equal(n.disabled, false, `« ${cle} » n'est pas grisé`); await n.emettre('click'); await calme(); };
  const saisir = async (cle: string, val: string) => { const n = f(cle)!; assert.ok(n, `champ « ${cle} »`); n.value = val; await n.emettre('input', { target: n }); await calme(); };
  const choisir = async (cle: string, val: string) => { const n = f(cle)!; n.value = val; await n.emettre('change', { target: n }); await calme(); };
  const onglet = async (id: string) => { const n = q(`#sa-tab-${id}`)!; assert.ok(n, `onglet ${id}`); await n.emettre('click'); await calme(); };
  const tic = async () => { for (const g of rythmes) await g(); await calme(); };
  const ecrit = () => appels.filter((a) => a.action !== 'baux_vus' && a.action !== 'plan_adresses');
  const fixes = () => ((v.ctx('vidarr').settings.dhcp as DhcpConfig).fixed ?? []).map((x) => `${x.mac} ${x.ip}${x.name ? ` ${x.name}` : ''}`);
  const fin = () => { v.stop(); PRISE_DHCP.ecouter = PRISE; LOCAL.macs = MACS; };
  return { v, window, corps, rendu, q, qa, f, clic, saisir, choisir, onglet, tic, appels, ecrit, fixes, ips, fin, actif: () => actif, texte: () => corps.textContent, verdict: () => q('.sp-v'), avance: (ms: number) => { now += ms; }, etats: () => (v.ctx('vidarr').settings.macPolicy as MacPolicy | undefined)?.etats ?? {} };
}

test('R3 · page : l\'onglet « Adresses fixes », le plan de tout le réseau et sa légende en mots, la liste ; un nom piégé reste du texte', async () => {
  const P = await page();
  try {
    assert.deepEqual(P.qa('[role="tab"]').map((b) => [b.textContent, b.attrs['aria-selected']]), [['Appareils (DHCP)', 'true'], ['Adresses fixes', 'false'], ['Tout', 'false']]);
    await P.onglet('fixes');
    assert.equal(P.q('#sa-tab-fixes')!.attrs['aria-selected'], 'true'); assert.equal(P.q('.sa-stat'), null, 'l\'écran des appareils est rangé');
    // Le plan : une image décrite, toutes les adresses, et une légende en mots (la couleur ne dit rien toute seule).
    const plan = P.q('.sp-plan')!;
    assert.deepEqual([plan.attrs.role, plan.attrs['aria-label']], ['img', 'Plan des adresses, de 192.0.2.1 à 192.0.2.254']);
    const segs = plan.children;
    assert.deepEqual(segs.map((s) => `${s.className.replace('sp-seg sp-', '')}:${s.style.flexGrow}`), ['box:1', 'odin:1', 'libre:27', 'fixe:1', 'libre:69', 'bail:3', 'plage:97', 'libre:55']);
    assert.equal(segs.reduce((n, s) => n + Number(s.style.flexGrow), 0), 254, 'aucune adresse oubliée');
    assert.equal(segs[3].attrs.title, '192.0.2.30 · Adresses fixes'); assert.equal(segs[6].attrs.title, '192.0.2.103 à 192.0.2.199 · Libres dans la plage distribuée');
    assert.deepEqual(P.qa('ul.sp-leg')[0].children.map((li) => li.textContent), ['La box · 192.0.2.1', 'Odin · 192.0.2.2', 'Adresses fixes · 192.0.2.30', 'Distribuées en ce moment · 192.0.2.100 à 192.0.2.102', 'Libres dans la plage distribuée · 192.0.2.103 à 192.0.2.199', 'Libres hors de la plage · 151']);
    assert.match(P.texte(), /Le réseau de la maison, de 192\.0\.2\.1 à 192\.0\.2\.254 : qui prend quoi\./); assert.match(P.texte(), /Plage distribuée : 192\.0\.2\.100 à 192\.0\.2\.199\./);
    // La liste des adresses fixes : la box est verrouillée (aucun bouton), l'imprimante se change et se retire.
    const lignes = P.qa('li.sp-ent');
    assert.deepEqual(lignes.map((l) => l.textContent), ['Box internet · 192.0.2.1verrouillée00:00:5e:00:53:01', 'Imprimante · 192.0.2.3000:00:5e:00:53:30']);
    assert.equal(P.f(`mod:${M.box}`), null); assert.equal(P.f(`ret:${M.box}`), null);
    assert.deepEqual([P.f(`mod:${M.imp}`)!.tagName, P.f(`mod:${M.imp}`)!.attrs['aria-label'], P.f(`ret:${M.imp}`)!.attrs['aria-label']], ['BUTTON', 'Changer l\'adresse fixe de Imprimante', 'Retirer l\'adresse fixe de Imprimante']);
    // « Réserver » : les appareils sans adresse fixe ; rien n'est choisi d'avance, le bouton est grisé.
    const dev = P.f('dev')!;
    assert.deepEqual(dev.children.map((x) => x.textContent), ['Choisis un appareil…', `PC du bureau · ${P.ips[M.pc]}`, `Telephone 1 · ${P.ips[M.tel]}`, `img srcx onerroralert1Cam · ${P.ips[M.piege]}`]);
    assert.equal(P.f('r-ok')!.disabled, true); assert.match(P.verdict()!.textContent, /Choisis un appareil et une adresse/);
    for (const [champ, id] of [['dev', 'sp-dev'], ['ip', 'sp-ip'], ['nom', 'sp-nom']]) { assert.equal(P.f(champ)!.id, id); assert.ok(P.q(`label[for="${id}"]`), `le champ « ${champ} » a son étiquette`); }
    // Le nom piégé : jamais une balise, jamais du HTML.
    assert.ok(!crees.includes('IMG') && !crees.includes('SCRIPT') && !crees.includes('IFRAME'), 'aucune balise venue du réseau');
    assert.doesNotMatch(P.texte(), /<img|onerror=alert\(|[<>]/);
    for (const src of [SOURCE, SOURCE_APPAREILS]) { assert.doesNotMatch(src, /innerHTML|insertAdjacentHTML|outerHTML|document\.write/, 'la page n\'écrit jamais de HTML'); assert.doesNotMatch(src, /[\u2028\u2029\r]/, 'ni séparateur de ligne Unicode, ni retour chariot'); }
    assert.deepEqual(P.ecrit(), [], 'regarder n\'écrit rien');
    // Au clavier : la flèche passe d'un onglet à l'autre.
    await P.q('#sa-tab-fixes')!.emettre('keydown', { key: 'ArrowRight' }); await calme();
    assert.equal(P.actif()?.textContent, 'Tout'); assert.match(P.texte(), /PAGE GÉNÉRIQUE/);
    await P.actif()!.emettre('keydown', { key: 'ArrowLeft' }); await calme();
    assert.equal(P.actif()?.textContent, 'Adresses fixes'); assert.ok(P.q('.sp-plan'));
  } finally { P.fin(); }
});

test('R3 · page : réserver — Odin propose une adresse libre et vérifie celle que l\'on tape ; un refus ne part jamais', async () => {
  const P = await page();
  try {
    await P.onglet('fixes');
    await P.choisir('dev', M.pc);
    assert.equal(P.f('ip')!.value, '192.0.2.3', 'la première adresse libre hors de la plage est proposée'); assert.equal(P.f('nom')!.value, 'PC du bureau');
    assert.equal(P.actif(), P.f('dev'), 'le clavier reste sur la liste');
    assert.deepEqual([P.verdict()!.className, P.verdict()!.textContent], ['sp-v ok', 'Libre.']);
    assert.match(P.q('ul.sp-avis')!.textContent, new RegExp(`Il tient encore ${P.ips[M.pc].replace(/\./g, '\\.')} : il passera à 192\\.0\\.2\\.3 à son prochain renouvellement`));
    assert.equal(P.f('r-ok')!.disabled, false);
    // Les refus : le message du serveur, le bouton grisé, rien ne part.
    const refus: Array<[string, RegExp]> = [
      [P.ips[M.tel], /^Refusé : 192\.0\.2\.101 est déjà à « Telephone 1 »/], ['192.0.2.30', /^Refusé : 192\.0\.2\.30 est déjà réservée à « Imprimante »/], [ODIN, /Odin lui-même/], [BOX, /la box/],
      ['198.51.100.7', /^Adresse hors du réseau de la maison \(192\.0\.2\.1 à 192\.0\.2\.254\)/], ['192.0.2.255', /diffusion/], ['0.0.0.0', /aucune adresse/], ['2001:db8::7', /IPv6/], ['192.0.2', /Adresse mal écrite/], ['<b>x</b>', /Adresse mal écrite/],
    ];
    for (const [ip, mots] of refus) {
      await P.saisir('ip', ip);
      assert.equal(P.verdict()!.className, 'sp-v bad', ip); assert.match(P.verdict()!.textContent, mots); assert.equal(P.f('r-ok')!.disabled, true, `${ip} : « Réserver » est grisé`);
      await P.f('r-ok')!.emettre('click'); await P.f('ip')!.emettre('keydown', { key: 'Enter' }); await calme();
    }
    assert.deepEqual(P.ecrit(), [], 'aucun refus ne part vers Sphinx');
    // « Prendre l'adresse proposée » remet une adresse libre, le clavier revient dans le champ.
    await P.saisir('ip', P.ips[M.tel]);
    assert.equal(P.f('propose')!.textContent, 'Prendre 192.0.2.3 (proposée par Odin)');
    await P.clic('propose');
    assert.equal(P.f('ip')!.value, '192.0.2.3'); assert.equal(P.actif(), P.f('ip')); assert.equal(P.verdict()!.textContent, 'Libre.'); assert.equal(P.f('propose'), null);
    // Dans la plage distribuée : accepté, et dit (elle sort de la plage).
    await P.saisir('ip', '192.0.2.150');
    assert.deepEqual([P.verdict()!.className, P.verdict()!.textContent], ['sp-v warn', 'Dans la plage distribuée : Odin la retire de la plage pour qu\'aucun autre appareil ne la reçoive.']);
    assert.equal(P.f('r-ok')!.disabled, false);
    // Réserver (touche Entrée dans le champ).
    await P.saisir('ip', '192.0.2.23');
    await P.f('ip')!.emettre('keydown', { key: 'Enter' }); await calme();
    assert.deepEqual(P.ecrit(), [{ action: 'dhcp_fixe', input: { mac: M.pc, ip: '192.0.2.23', nom: 'PC du bureau' }, confirm: false }]);
    assert.deepEqual(P.fixes(), [`${M.box} ${BOX} Box internet`, `${M.imp} 192.0.2.30 Imprimante`, `${M.pc} 192.0.2.23 PC du bureau`]);
    assert.match(P.q('.sa-res')!.textContent, /^📌 PC du bureau aura toujours 192\.0\.2\.23 \(et le nom pc-du-bureau\.maison\)\./); assert.equal(P.q('.sa-res')!.attrs.role, 'status');
    assert.match(P.qa('li.sp-ent')[1].textContent, new RegExp(`^PC du bureau · 192\\.0\\.2\\.23tient encore ${P.ips[M.pc].replace(/\./g, '\\.')}00:00:5e:00:53:23 · pc-du-bureau\\.maison$`));
    assert.equal(P.actif(), P.f(`mod:${M.pc}`), 'le clavier va sur la nouvelle ligne');
    assert.deepEqual(P.f('dev')!.children.map((x) => x.textContent.split(' · ')[0]), ['Choisis un appareil…', 'Telephone 1', 'img srcx onerroralert1Cam'], 'le PC n\'est plus à réserver');
    assert.equal(P.f('ip')!.value, '', 'le formulaire repart de zéro');
  } finally { P.fin(); }
});

test('R3 · page : pendant la frappe rien ne bouge sous les doigts ; une adresse prise entre-temps est refusée à la relecture', async () => {
  const P = await page();
  try {
    await P.onglet('fixes'); await P.choisir('dev', M.pc); await P.saisir('ip', '192.0.2.24');
    const champ = P.f('ip')!; champ.focus();
    assert.equal(P.verdict()!.textContent, 'Libre.');
    // Pendant ce temps, l'adresse est réservée ailleurs (une autre fenêtre du propriétaire).
    assert.equal((await P.v.act('vidarr', 'dhcp_fixe', { mac: M.tel, ip: '192.0.2.24', nom: 'Telephone 1' })).ok, true);
    await P.tic();
    assert.equal(P.f('ip'), champ, 'le champ n\'a pas été redessiné'); assert.equal(champ.value, '192.0.2.24'); assert.equal(P.actif(), champ);
    assert.equal(P.verdict()!.className, 'sp-v bad'); assert.match(P.verdict()!.textContent, /192\.0\.2\.24 est déjà réservée à « Telephone 1 »/);
    assert.equal(P.f('r-ok')!.disabled, true);
    assert.equal(P.qa('li.sp-ent').length, 3, 'la liste, elle, est à jour');
    // Même si la page croyait encore l'adresse libre, le serveur refuse : la règle n'est pas dans la page.
    const r = await P.v.act('vidarr', 'dhcp_fixe', { mac: M.pc, ip: '192.0.2.24' });
    assert.equal(r.ok, false); assert.match(r.text, /déjà réservée/);
  } finally { P.fin(); }
});

test('R3 · page : changer puis retirer une adresse fixe ; la question est dans la page, Échap annule, le clavier revient où il était', async () => {
  const P = await page();
  try {
    await P.onglet('fixes');
    // Changer.
    await P.clic(`mod:${M.imp}`);
    assert.match(P.texte(), /Changer l'adresse fixe de « Imprimante »/); assert.equal(P.f('dev'), null, 'l\'appareil ne se change pas, seulement son adresse');
    assert.deepEqual([P.f('ip')!.value, P.f('nom')!.value], ['192.0.2.30', 'Imprimante']); assert.equal(P.actif(), P.f('ip'));
    assert.deepEqual([P.verdict()!.className, P.verdict()!.textContent], ['sp-v ok', 'C\'est déjà son adresse fixe.']);
    await P.saisir('ip', '192.0.2.31');
    assert.match(P.q('ul.sp-avis')!.textContent, /Son ancienne adresse fixe 192\.0\.2\.30 redevient libre\./);
    assert.equal(P.f('r-ok')!.textContent, 'Enregistrer');
    await P.clic('r-ok');
    assert.deepEqual(P.ecrit(), [{ action: 'dhcp_fixe', input: { mac: M.imp, ip: '192.0.2.31', nom: 'Imprimante' }, confirm: false }]);
    assert.deepEqual(P.fixes(), [`${M.box} ${BOX} Box internet`, `${M.imp} 192.0.2.31 Imprimante`]);
    // « Annuler » pendant un changement : rien ne part.
    await P.clic(`mod:${M.imp}`); await P.saisir('ip', '192.0.2.99'); await P.clic('r-non');
    assert.equal(P.actif(), P.f(`mod:${M.imp}`)); assert.ok(P.f('dev'), 'retour à « Réserver une adresse »'); assert.equal(P.ecrit().length, 1);
    // Retirer : une question dans la page, le clavier sur « Annuler ».
    await P.clic(`ret:${M.imp}`);
    const k = P.q('.sa-garde')!;
    assert.deepEqual([k.attrs.role, k.attrs['aria-live']], ['alert', 'assertive']);
    assert.match(k.textContent, /^Retirer l'adresse fixe de « Imprimante » \?Il reprendra une adresse de la plage distribuée, et 192\.0\.2\.31 redeviendra libre\. S'il est bloqué ou en pause, il le reste\./);
    assert.equal(P.actif(), P.f('k-non')); assert.equal(P.ecrit().length, 1, 'rien n\'est encore parti');
    // La relecture « en direct » ne ferme pas la question.
    await P.tic(); assert.ok(P.q('.sa-garde'));
    await k.emettre('keydown', { key: 'Escape' }); await calme();
    assert.equal(P.q('.sa-garde'), null); assert.equal(P.actif(), P.f(`ret:${M.imp}`), 'Échap : le clavier revient sur le bouton'); assert.equal(P.fixes().length, 2);
    await P.clic(`ret:${M.imp}`); await P.clic('k-ok');
    assert.deepEqual(P.ecrit()[1], { action: 'dhcp_retirer_fixe', input: { mac: M.imp }, confirm: false });
    assert.deepEqual(P.fixes(), [`${M.box} ${BOX} Box internet`]);
    assert.match(P.q('.sa-res')!.textContent, /^🗑 Adresse fixe retirée : Imprimante n'a plus 192\.0\.2\.31 en réserve\./);
    assert.equal(P.qa('li.sp-ent').length, 1); assert.equal(P.actif(), P.f('dev'));
  } finally { P.fin(); }
});

test('R3 · page : depuis la fiche d\'un appareil, « Réserver cette adresse » ouvre l\'écran avec lui ; un appareil bloqué reste bloqué', async () => {
  const P = await page();
  try {
    // La fiche du téléphone (écran « Appareils ») porte le bouton vers les adresses fixes.
    await P.clic(`row:${M.tel}`);
    assert.equal(P.f('a-fixe')!.textContent, 'Réserver cette adresse');
    await P.clic('a-fixe');
    assert.equal(P.q('#sa-tab-fixes')!.attrs['aria-selected'], 'true');
    assert.deepEqual([P.f('dev')!.value, P.f('ip')!.value, P.f('nom')!.value], [M.tel, P.ips[M.tel], 'Telephone 1'], 'l\'appareil et l\'adresse qu\'il tient');
    assert.equal(P.actif(), P.f('ip'));
    assert.equal(P.verdict()!.className, 'sp-v warn'); assert.match(P.q('ul.sp-avis')!.textContent, /Il tient déjà cette adresse : rien ne change pour lui[\s\S]*Adresse MAC privée/);
    // Il est bloqué entre-temps : la vérification le dit, la réservation ne le débloque pas.
    assert.equal((await P.v.act('vidarr', 'dhcp_mac_etat', { mac: M.tel, etat: 'bloque' })).ok, true);
    await P.saisir('ip', '192.0.2.14');
    assert.match(P.q('ul.sp-avis')!.textContent, /Il est bloqué, et il le reste : une adresse fixe ne débloque rien/);
    await P.clic('r-ok');
    assert.equal(P.etats()[M.tel], 'bloque'); assert.match(P.q('.sa-res')!.textContent, /Il est bloqué, et il le reste/);
    assert.match(P.qa('li.sp-ent').map((l) => l.textContent).join('\n'), /Telephone 1 · 192\.0\.2\.14bloqué/);
    // De retour sur sa fiche : l'adresse fixe est dite ; le bouton ouvre le changement.
    await P.onglet('appareils'); await P.clic(`row:${M.tel}`);
    assert.equal(P.f('a-fixe')!.textContent, 'Adresse fixe 192.0.2.14');
    assert.match(P.q('dl.sa-faits')!.textContent, /Adresse fixe \(à son prochain renouvellement\)192\.0\.2\.14/, 'il tient encore une autre adresse : la fiche dit les deux');
    await P.clic('a-fixe');
    assert.match(P.texte(), /Changer l'adresse fixe de « Telephone 1 »/); assert.equal(P.f('ip')!.value, '192.0.2.14');
    // La box : sa fiche n'a pas ce bouton.
    await P.onglet('appareils'); await P.clic(`row:${M.box}`); assert.equal(P.f('a-fixe'), null);
  } finally { P.fin(); }
});

test('R3 · page : un membre ne voit que l\'adresse fixe de son appareil — ni le plan, ni les autres, ni aucun geste', async () => {
  let depuis = '';
  const P = await page({ membre: true, depuis: () => depuis });
  try {
    depuis = P.ips[M.tel];
    await P.onglet('fixes');
    assert.equal(P.q('.sp-plan'), null, 'pas de plan'); assert.equal(P.f('dev'), null); assert.equal(P.f('r-ok'), null, 'pas de formulaire');
    assert.match(P.q('.sa-note')!.textContent, /Ce que tu voisLe plan des adresses de la maison et les adresses fixes sont au propriétaire seul/);
    assert.deepEqual(P.qa('li.sp-ent').map((l) => l.textContent), [`Telephone de Nour · ${P.ips[M.tel]}ton appareil02:00:5e:00:53:14 · telephone-de-nour.maison`]);
    assert.equal(P.f(`mod:${M.tel}`), null); assert.equal(P.f(`ret:${M.tel}`), null);
    assert.match(P.texte(), /Réserver, changer et retirer une adresse fixe : le propriétaire seul\./);
    for (const secret of ['Imprimante', 'PC du bureau', 'Box internet', M.pc, M.imp, M.box, '192.0.2.30']) assert.ok(!P.texte().includes(secret), `rien sur « ${secret} »`);
    // Depuis un appareil qu'Odin ne reconnaît pas : plus rien.
    depuis = '203.0.113.9'; await P.tic();
    assert.equal(P.qa('li.sp-ent').length, 0);
    assert.deepEqual(P.ecrit(), []);
  } finally { P.fin(); }
});

test('R3 · page : quand la box distribue les adresses, c\'est dit ; sans l\'écran « Appareils » le fichier ne fait rien', async () => {
  const P = await page({ allume: false });
  try {
    await P.onglet('fixes');
    assert.match(P.q('.sa-note')!.textContent, /La box distribue les adressesUne adresse fixe est seulement notée/);
    await P.choisir('dev', M.pc);
    assert.match(P.q('ul.sp-avis')!.textContent, /Aujourd'hui la box distribue les adresses : c'est noté/);
  } finally { P.fin(); }
  // Chargé seul (sans sphinx-appareils.js) : aucune erreur, rien n'est posé.
  const seul: Record<string, unknown> = {}; vm.runInNewContext(SOURCE, { window: seul });
  assert.deepEqual(Object.keys(seul), []);
});
