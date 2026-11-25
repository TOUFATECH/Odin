// Sphinx · Noms et enregistrements (la page) : l'onglet « Noms (DNS) » à sa place, « Les machines » (noms ↔ adresses :
// automatiques depuis le DHCP, adresse fixe, à la main, Odin ; recherche), « Enregistrements » (les sortes dites en mots,
// les noms ajoutés à la main, « Ajouter un nom » vérifié pendant la frappe), changer et retirer avec la question dans la
// page (son texte vient du serveur), au clavier ; un membre ne voit que ses noms. La page est montée dans un document
// minimal et parle au VRAI Sphinx (Valhalla, dossiers temporaires) ; la prise du serveur d'adresses est SIMULÉE (aucun
// vrai paquet, aucun port). Adresses d'exemple (192.0.2.x), MAC de documentation.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import vm from 'node:vm';
import { MSG, buildPacket, parsePacket, type DhcpConfig, type Packet } from '../src/valhalla/vidarr/dhcp.ts';
import { LOCAL, origineDemande } from '../src/valhalla/vidarr/appareils.ts';
import { PRISE_DHCP, dhcpServer, vidarr } from '../src/valhalla/modules/vidarr.ts';
import { Valhalla } from '../src/valhalla/service.ts';
import { auNomDe, setVerificateur } from '../src/valhalla/sso/acces.ts';

const lire = (n: string) => readFileSync(new URL(`../src/web/pages/${n}`, import.meta.url), 'utf8');
// Comme le serveur d'Odin : les fichiers des pages chargés dans l'ordre de leur nom.
const FICHIERS = ['sphinx-appareils.js', 'sphinx-noms.js', 'sphinx-plan.js', 'sphinx-reglages.js'];
const BOX = '192.0.2.1', ODIN = '192.0.2.2', T0 = Date.now();
const M = { odin: '00:00:5e:00:53:02', pc: '00:00:5e:00:53:23', tel: '02:00:5e:00:53:14', piege: '00:00:5e:00:53:77' };
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

/** La page de Sphinx (ses quatre fichiers) montée, reliée au vrai Sphinx ; ses demandes notées. */
async function page(o: { membre?: boolean; depuis?: () => string } = {}) {
  const home = mkdtempSync(join(tmpdir(), 'sphinx-noms-p-')); dossiers.push(home);
  const envois: Packet[] = []; const now = T0;
  PRISE_DHCP.ecouter = async (d) => { (d as unknown as { sock: unknown }).sock = { send: (b: Buffer) => { envois.push(parsePacket(b)); }, close: () => {} }; };
  LOCAL.macs = () => [M.odin]; setVerificateur(() => undefined);
  const v = new Valhalla(home, [vidarr()], { run: async () => ({ code: 1, out: '', err: '' }), fetch: (async () => { throw new Error('aucun réseau'); }) as never, notify: async () => {}, autonomy: () => 'equilibre', now: () => new Date(now) } as never);
  const cfg: DhcpConfig = { server: ODIN, start: '192.0.2.100', end: '192.0.2.199', mask: '255.255.255.0', router: BOX, dns: [ODIN], leaseSeconds: 12 * 3600, domain: 'maison', fixed: [] };
  v.ctx('vidarr').saveSettings({ dhcp: cfg });
  const ips: Record<string, string> = {};
  assert.equal((await v.act('vidarr', 'dhcp_demarrer', { forcer: true })).ok !== false, true);
  const prend = (mac: string, nom: string) => { const n = envois.length; dhcpServer()!.onMessage(paquet(mac, MSG.DISCOVER, { nom })); const ip = envois[n].yiaddr; dhcpServer()!.onMessage(paquet(mac, MSG.REQUEST, { nom, veut: ip })); ips[mac] = ip; };
  prend(M.pc, 'PC-SALLE'); prend(M.tel, 'Telephone-Nour'); prend(M.piege, PIEGE);
  assert.equal((await v.act('vidarr', 'nom_local', { nom: 'disque.maison', valeur: '192.0.2.40', sorte: 'a' })).ok, true);
  assert.equal((await v.act('vidarr', 'nom_local', { nom: 'galerie.maison', valeur: 'disque.maison', sorte: 'alias' })).ok, true);
  assert.equal((await v.act('vidarr', 'nom_local', { nom: 'mon-tel.maison', valeur: ips[M.tel], sorte: 'a' })).ok, true);
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
      // Comme la porte des membres et la route des actions (src/web/valhalla-api.ts) : la règle, puis la question.
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
  for (const n of FICHIERS) vm.runInContext(lire(n), ctx);
  const host = new Noeud('div'); corps.append(host);
  const generique = new Noeud('section'); generique.append(new Texte('PAGE GÉNÉRIQUE'));
  const rendu = await window.OdinPages.vidarr({ host, generic: [generique] });
  await calme();
  const qa = (s: string) => corps.querySelectorAll(s).filter((n) => n.visible), q = (s: string) => qa(s)[0] ?? null;
  const f = (cle: string) => q(`[data-f="${cle}"]`);
  const clic = async (cle: string) => { const n = f(cle); assert.ok(n, `élément « ${cle} »`); assert.equal(n.disabled, false, `« ${cle} » n'est pas grisé`); await n.emettre('click'); await calme(); };
  const saisir = async (cle: string, val: string) => { const n = f(cle)!; assert.ok(n, `champ « ${cle} »`); n.value = val; await n.emettre('input', { target: n }); await calme(); };
  const onglet = async (id: string) => { const n = q(`#sa-tab-${id}`)!; assert.ok(n, `onglet ${id}`); await n.emettre('click'); await calme(); };
  const tic = async () => { for (const g of rythmes) await g(); await calme(); };
  const ecrit = () => appels.filter((a) => !['baux_vus', 'plan_adresses', 'dhcp_etat', 'noms_vus'].includes(a.action));
  const reecritures = () => (v.ctx('vidarr').settings.dns as { rewrites?: Record<string, string[]> } | undefined)?.rewrites ?? {};
  const fin = () => { v.stop(); PRISE_DHCP.ecouter = PRISE; LOCAL.macs = MACS; };
  return { v, window, corps, rendu, q, qa, f, clic, saisir, onglet, tic, appels, ecrit, reecritures, ips, fin, actif: () => actif, texte: () => corps.textContent, verdict: () => q('.sn-v') };
}

test('Noms · page : l\'onglet « Noms (DNS) » à sa place ; « Les machines » : automatiques, à la main, Odin ; un nom piégé reste du texte', async () => {
  const P = await page();
  try {
    assert.deepEqual(P.qa('[role="tab"]').filter((b) => b.id.startsWith('sa-tab-')).map((b) => b.textContent), ['Appareils (DHCP)', 'Adresses fixes', 'Réglages DHCP', 'Noms (DNS)', 'Tout']);
    await P.onglet('noms');
    assert.equal(P.q('#sa-tab-noms')!.attrs['aria-selected'], 'true');
    // Les deux sous-onglets : « Les machines » d'abord.
    assert.deepEqual([P.f('st:machines')!.attrs['aria-selected'], P.f('st:enreg')!.attrs['aria-selected'], P.f('st:machines')!.attrs.role], ['true', 'false', 'tab']);
    const lignes = P.qa('li.sn-ligne').map((l) => l.textContent);
    assert.ok(lignes.some((t) => t.startsWith('odin.maison') && t.includes(ODIN) && t.includes('Odin')), lignes.join(' | '));
    assert.ok(lignes.some((t) => t.startsWith('disque.maison') && t.includes('192.0.2.40') && t.includes('à la main')), lignes.join(' | '));
    assert.ok(lignes.some((t) => t.startsWith('pc-salle.maison') && t.includes(P.ips[M.pc]) && t.includes('DHCP')), lignes.join(' | '));
    assert.ok(!lignes.some((t) => t.startsWith('galerie.maison')), 'un alias n\'est pas une adresse : il est dans « Enregistrements »');
    assert.match(P.texte(), /Les noms des machines/);
    // Chercher.
    await P.saisir('nq', '192.0.2.40'); assert.deepEqual(P.qa('li.sn-ligne').map((l) => l.textContent.slice(0, 13)), ['disque.maison']);
    await P.saisir('nq', 'aucun-nom-pareil'); assert.equal(P.qa('li.sn-ligne').length, 0); assert.match(P.texte(), /Aucun nom ne correspond/);
    await P.saisir('nq', '');
    // Le nom piégé annoncé par un appareil : jamais une balise.
    assert.ok(!crees.includes('IMG') && !crees.includes('SCRIPT'), 'aucune balise venue du réseau');
    assert.doesNotMatch(P.texte(), /<img|onerror=alert\(/);
    const src = lire('sphinx-noms.js');
    assert.doesNotMatch(src, /innerHTML|insertAdjacentHTML|outerHTML|document\.write/); assert.doesNotMatch(src, /[\u2028\u2029\r]/);
    assert.deepEqual(P.ecrit(), [], 'regarder n\'écrit rien');
    // Au clavier : la flèche passe d'un sous-onglet à l'autre.
    P.f('st:machines')!.focus(); await P.f('st:machines')!.emettre('keydown', { key: 'ArrowRight' }); await calme();
    assert.equal(P.actif()?.getAttribute('data-f'), 'st:enreg'); assert.equal(P.f('st:enreg')!.attrs['aria-selected'], 'true');
  } finally { P.fin(); }
});

test('Noms · page : « Enregistrements » — les sortes en mots, les noms à la main (celui d\'Odin verrouillé), « Ajouter un nom » vérifié pendant la frappe', async () => {
  const P = await page();
  try {
    await P.onglet('noms'); await P.clic('aller-ajout');
    assert.equal(P.f('st:enreg')!.attrs['aria-selected'], 'true'); assert.equal(P.actif()?.getAttribute('data-f'), 'n-nom', 'le curseur va au nom');
    const sortes = P.qa('li.sn-sorte').map((s) => s.textContent);
    for (const [mots, code] of [['Nom → adresse', 'A'], ['Nom → adresse longue (IPv6)', 'AAAA'], ['Autre nom (alias)', 'CNAME'], ['Tous les noms d\'un groupe', 'joker'], ['Adresse → nom (inverse)', 'PTR'], ['Texte', 'TXT']]) assert.ok(sortes.some((t) => t.startsWith(mots) && t.includes(code)), `${mots} : ${sortes.join(' | ')}`);
    const main = P.qa('li.sn-main').map((l) => l.textContent);
    assert.ok(main.some((t) => t.startsWith('galerie.maison') && t.includes('disque.maison')), main.join(' | '));
    assert.ok(main.some((t) => t.startsWith('odin.maison') && t.includes('verrouillé')), main.join(' | '));
    assert.equal(P.f('ret:odin.maison'), null); assert.ok(P.f('ret:disque.maison')); assert.ok(P.f('mod:disque.maison'));
    // La sorte : un groupe de boutons (un seul choisi).
    assert.deepEqual(['a', 'alias', 'joker', 'texte'].map((k) => P.f(`so:${k}`)!.attrs['aria-pressed']), ['true', 'false', 'false', 'false']);
    for (const [champ, id] of [['n-nom', 'sn-nom'], ['n-val', 'sn-val']]) { assert.equal(P.f(champ)!.id, id); assert.ok(P.q(`label[for="${id}"]`), `« ${champ} » a son étiquette`); }
    assert.equal(P.f('n-ok')!.disabled, true);
    // Vérifié pendant la frappe : refus (nom automatique), puis accepté ; le bouton suit.
    await P.saisir('n-nom', 'pc-salle.maison'); await P.saisir('n-val', '192.0.2.44');
    assert.match(P.verdict()!.textContent, /nom automatique/); assert.equal(P.f('n-ok')!.disabled, true);
    await P.saisir('n-nom', 'café.maison');
    assert.match(P.verdict()!.textContent, /café\.maison/); assert.equal(P.f('n-ok')!.disabled, false);
    await P.clic('n-ok');
    assert.deepEqual(P.reecritures()['xn--caf-dma.maison'], ['192.0.2.44']);
    assert.match(P.texte(), /café\.maison → 192\.0\.2\.44/);
    assert.ok(P.qa('li.sn-main').some((l) => l.textContent.startsWith('café.maison')));
    // Une autre sorte : le texte ; l'étiquette du champ suit.
    await P.clic('so:texte'); assert.equal(P.f('so:texte')!.attrs['aria-pressed'], 'true'); assert.equal(P.q('label[for="sn-val"]')!.textContent, 'Texte');
    await P.saisir('n-nom', 'note.maison'); await P.saisir('n-val', 'bonjour'); await P.clic('n-ok');
    assert.deepEqual(P.reecritures()['note.maison'], ['TXT bonjour']);
    // Un refus ne part jamais : le bouton reste grisé, rien n'est écrit, même avec Entrée.
    const avant = JSON.stringify(P.reecritures());
    await P.clic('so:a'); await P.saisir('n-nom', 'x.maison'); await P.saisir('n-val', '127.0.0.1');
    assert.equal(P.f('n-ok')!.disabled, true); assert.match(P.verdict()!.textContent, /Refusé/);
    await P.f('n-val')!.emettre('keydown', { key: 'Enter' }); await P.tic();
    assert.equal(JSON.stringify(P.reecritures()), avant);
  } finally { P.fin(); }
});

test('Noms · page : un nom d\'Internet, changer, retirer — la question dans la page vient du serveur ; « Annuler » ne fait rien', async () => {
  const P = await page();
  try {
    await P.onglet('noms'); await P.clic('st:enreg');
    // Un nom d'Internet : Odin le dit avant (question), rien n'est écrit tant qu'on n'a pas dit oui.
    await P.saisir('n-nom', 'banque.example.com'); await P.saisir('n-val', '192.0.2.66');
    assert.match(P.verdict()!.textContent, /Internet/);
    await P.clic('n-ok');
    assert.match(P.q('.sa-garde')!.textContent, /banque\.example\.com.*Internet/);
    assert.equal(P.reecritures()['banque.example.com'], undefined);
    await P.clic('q-non'); assert.equal(P.q('.sa-garde'), null); assert.equal(P.reecritures()['banque.example.com'], undefined);
    await P.clic('n-ok'); await P.clic('q-ok');
    assert.deepEqual(P.reecritures()['banque.example.com'], ['192.0.2.66']);
    assert.deepEqual(P.appels.filter((a) => a.action === 'nom_local').map((a) => a.confirm), [false, false, true]);
    // Changer : le nom ne bouge pas, la valeur est reprise ; la question dit avant → après.
    await P.clic('mod:disque.maison');
    assert.equal(P.f('n-nom'), null, 'le nom ne se change pas, il est montré'); assert.match(P.texte(), /Changer « disque\.maison »/);
    assert.equal(P.f('n-val')!.value, '192.0.2.40'); assert.equal(P.actif()?.getAttribute('data-f'), 'n-val');
    await P.saisir('n-val', '192.0.2.41'); await P.clic('n-ok');
    assert.match(P.q('.sa-garde')!.textContent, /disque\.maison.*192\.0\.2\.40.*192\.0\.2\.41/);
    await P.clic('q-ok');
    assert.deepEqual(P.reecritures()['disque.maison'], ['192.0.2.41']);
    // Retirer : la question nomme le nom ; « Annuler » ne fait rien ; « Retirer » le retire.
    await P.clic('ret:galerie.maison');
    assert.match(P.q('.sa-garde')!.textContent, /galerie\.maison/); assert.equal(P.actif()?.getAttribute('data-f'), 'q-non', 'le curseur va sur « Annuler »');
    await P.tic(); assert.ok(P.q('.sa-garde'), 'la relecture en direct ne ferme pas la question');
    await P.clic('q-non'); assert.ok(P.reecritures()['galerie.maison']); assert.equal(P.actif()?.getAttribute('data-f'), 'ret:galerie.maison');
    await P.clic('ret:galerie.maison'); await P.clic('q-ok');
    assert.equal(P.reecritures()['galerie.maison'], undefined);
    assert.ok(!P.qa('li.sn-main').some((l) => l.textContent.startsWith('galerie.maison')));
    // Échap ferme la question.
    await P.clic('ret:disque.maison'); await P.q('.sa-garde')!.emettre('keydown', { key: 'Escape' }); await calme();
    assert.equal(P.q('.sa-garde'), null); assert.ok(P.reecritures()['disque.maison']);
  } finally { P.fin(); }
});

test('Noms · page : un membre ne voit que les noms de l\'appareil qu\'il tient, sans formulaire ni bouton', async () => {
  let ici = '';
  const P = await page({ membre: true, depuis: () => ici });
  try {
    ici = P.ips[M.tel];
    await P.onglet('noms'); await P.tic();
    assert.match(P.texte(), /au propriétaire seul/);
    const lignes = P.qa('li.sn-ligne').map((l) => l.textContent);
    assert.equal(lignes.length, 2, lignes.join(' | '));
    assert.ok(lignes.some((t) => t.startsWith('mon-tel.maison')) && lignes.some((t) => t.startsWith('telephone-nour.maison')), lignes.join(' | '));
    assert.doesNotMatch(P.texte(), /disque\.maison|pc-salle|odin\.maison/);
    assert.equal(P.f('aller-ajout'), null);
    await P.clic('st:enreg');
    assert.equal(P.f('n-nom'), null); assert.equal(P.f('ret:mon-tel.maison'), null); assert.equal(P.f('mod:mon-tel.maison'), null);
    assert.deepEqual(P.ecrit(), []);
  } finally { P.fin(); }
});

// ------------------------------------------------------------------ après relecture (affichage)
test('Noms · page : un nom ajouté à la main dans une autre écriture montre aussi sa forme écrite pour le DNS (un sosie se voit)', async () => {
  const P = await page();
  try {
    assert.equal((await P.v.act('vidarr', 'nom_local', { nom: '\u043edin.maison', valeur: '192.0.2.45', sorte: 'a' })).ok, true);
    await P.onglet('noms'); await P.clic('st:enreg');
    const l = P.qa('li.sn-main').find((x) => x.textContent.startsWith('\u043edin.maison'));
    assert.ok(l, P.qa('li.sn-main').map((x) => x.textContent).join(' | '));
    assert.match(l!.textContent, /écrit pour le DNS : xn--/);
    // Un nom déjà en lettres simples ne répète rien.
    assert.doesNotMatch(P.qa('li.sn-main').find((x) => x.textContent.startsWith('disque.maison'))!.textContent, /écrit pour le DNS/);
  } finally { P.fin(); }
});

test('Noms · page : sur un téléphone, une « Dernière question » vide ne laisse pas un tiret seul, et une remplie dit ce qu\'elle est ; les cartes des sortes gardent le compte à droite', async () => {
  const P = await page();
  try {
    await P.onglet('noms');
    const l = P.qa('li.sn-ligne').find((x) => x.textContent.startsWith('disque.maison'))!;
    const qd = l.querySelector('.sn-q')!;
    assert.ok(qd.classList.contains('vide'), 'une question jamais posée : marquée vide');
    assert.ok(qd.querySelector('.sn-lq'), 'le libellé pour l\'écran étroit');
    const css = String(P.corps.parent!.querySelector('#sn-css')!.textContent);
    assert.match(css, /\.sn-ligne \.sn-q\.vide\{display:none\}/);
    assert.match(css, /\.sn-nm b\{[^}]*gap:0 6px/);
    await P.clic('st:enreg');
    for (const s of P.qa('li.sn-sorte')) { const b = s.children[0]; assert.deepEqual(b.children.map((c) => c.className), ['sn-tt', 'sa-cnt'], s.textContent); }
  } finally { P.fin(); }
});
