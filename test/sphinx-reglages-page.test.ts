// Sphinx · Réglages DHCP, lot R4 (la page) : « La box » ou « Odin distribue les adresses », le garde-fou dans la page
// (ce qu'Odin vérifie avant d'allumer, le refus tant qu'un autre serveur d'adresses répond, « revérifier », l'heure de la
// dernière vérification, la coupure et sa raison), le filet si Odin s'éteint, les adresses données (vérifiées pendant la
// frappe : un refus ne part jamais), « seulement les machines approuvées » avec la liste de celles qui sont approuvées
// d'abord, le lien vers Genèse, au clavier. La page est montée dans un document minimal et parle au VRAI Sphinx
// (Valhalla, dossiers temporaires) ; la prise du serveur d'adresses, les cartes réseau et la recherche d'un autre serveur
// sont SIMULÉES (aucun vrai paquet, aucun port 67/68). Adresses d'exemple (10.0.0.x, comme la maquette), MAC de
// documentation.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import vm from 'node:vm';
import { MSG, buildPacket, parsePacket, type DhcpConfig, type Lease, type MacPolicy, type Packet } from '../src/valhalla/vidarr/dhcp.ts';
import { LOCAL } from '../src/valhalla/vidarr/appareils.ts';
import * as R from '../src/valhalla/thjalfi/reseau.ts';
import { PRISE_DHCP, dhcpServer, gardeDhcp, veillerDhcp, vidarr } from '../src/valhalla/modules/vidarr.ts';
import { Valhalla } from '../src/valhalla/service.ts';
import { auNomDe, setVerificateur } from '../src/valhalla/sso/acces.ts';

const lire = (n: string) => readFileSync(new URL(`../src/web/pages/${n}`, import.meta.url), 'utf8');
const SOURCE_APPAREILS = lire('sphinx-appareils.js'), SOURCE_PLAN = lire('sphinx-plan.js'), SOURCE = lire('sphinx-reglages.js');
const BOX = '10.0.0.1', ODIN = '10.0.0.2', MIN = 60_000, T0 = Date.now();
const M = { box: '00:00:5e:00:53:01', odin: '00:00:5e:00:53:02', pc: '00:00:5e:00:53:23', tel: '02:00:5e:00:53:14', cam: '00:00:5e:00:53:31', piege: '00:00:5e:00:53:77' };
const PIEGE = '<img src=x onerror=alert(1)>Cam';
const CARTE: R.CarteReseau = { nom: 'Ethernet', ip: ODIN, masque: '255.255.255.0', prefixe: 24, mac: M.odin, genre: 'cable' };
const dossiers: string[] = [], PRISE = PRISE_DHCP.ecouter, MACS = LOCAL.macs, ORIGINE = { ...R.RESEAU };
after(() => { PRISE_DHCP.ecouter = PRISE; LOCAL.macs = MACS; Object.assign(R.RESEAU, ORIGINE); for (const d of dossiers) rmSync(d, { recursive: true, force: true }); });

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

/** La page de Sphinx (ses trois fichiers) montée, reliée au vrai Sphinx ; ses demandes notées. */
async function page(o: { membre?: boolean; allume?: boolean } = {}) {
  const home = mkdtempSync(join(tmpdir(), 'sphinx-r4p-')); dossiers.push(home);
  const envois: Packet[] = [], S = { now: T0, autres: [] as string[], cartes: [CARTE] as R.CarteReseau[] };
  PRISE_DHCP.ecouter = async (d) => { (d as unknown as { sock: unknown }).sock = { send: (b: Buffer) => { envois.push(parsePacket(b)); }, close: () => {} }; };
  R.RESEAU.cartes = () => S.cartes; R.RESEAU.plateforme = () => 'win32'; R.RESEAU.chercher = async () => ({ serveurs: [...S.autres] });
  LOCAL.macs = () => [M.odin]; setVerificateur(() => undefined);
  const v = new Valhalla(home, [vidarr()], { run: async () => ({ code: 1, out: '', err: '' }), fetch: (async () => { throw new Error('aucun réseau'); }) as never, notify: async () => {}, autonomy: () => 'equilibre', now: () => new Date(S.now) } as never);
  const cfg: DhcpConfig = { server: ODIN, start: '10.0.0.100', end: '10.0.0.199', mask: '255.255.255.0', router: BOX, dns: [ODIN], leaseSeconds: 12 * 3600, domain: 'maison', fixed: [] };
  const vctx = v.ctx('vidarr'); vctx.saveSettings({ dhcp: cfg });
  const ips: Record<string, string> = {};
  const prend = (mac: string, nom: string) => { const n = envois.length; dhcpServer()!.onMessage(paquet(mac, MSG.DISCOVER, { nom })); const ip = envois[n].yiaddr; dhcpServer()!.onMessage(paquet(mac, MSG.REQUEST, { nom, veut: ip })); ips[mac] = ip; };
  if (o.allume) {
    assert.equal((await v.act('vidarr', 'dhcp_demarrer')).ok, true);
    prend(M.pc, 'PC-BUREAU'); prend(M.tel, 'Telephone 1'); prend(M.cam, 'Camera'); prend(M.piege, PIEGE);
    assert.equal((await v.act('vidarr', 'dhcp_approuver', { mac: M.pc, nom: 'PC du bureau' })).ok, true);
    assert.equal((await v.act('vidarr', 'dhcp_mac_etat', { mac: M.cam, etat: 'bloque', nom: 'Camera' })).ok, true);
  }
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
    return o.membre ? auNomDe(nour, lancer) : lancer();
  };
  const fetch = async (_u: string, op: { body: string }) => { const b = JSON.parse(op.body); appels.push({ action: b.action, input: b.input, confirm: Boolean(b.confirm) }); const r = await repondre(b); return { json: async () => JSON.parse(JSON.stringify(r)) }; };
  const window: Record<string, any> = {}; const rythmes: Array<() => unknown> = [];
  const ctx = { window, document, Date, setInterval: (f: () => unknown) => { rythmes.push(f); return rythmes.length; }, clearInterval: () => {}, fetch };
  vm.createContext(ctx);
  // Les trois fichiers, dans l'ordre où le serveur les donne (par ordre de nom).
  vm.runInContext(SOURCE_APPAREILS, ctx); vm.runInContext(SOURCE_PLAN, ctx); vm.runInContext(SOURCE, ctx);
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
  const LECTURES = new Set(['baux_vus', 'plan_adresses', 'dhcp_etat']);
  const ecrit = () => appels.filter((a) => !LECTURES.has(a.action)).map((a) => `${a.action}${a.confirm ? ' (accord)' : ''}`);
  const fin = () => { v.stop(); PRISE_DHCP.ecouter = PRISE; LOCAL.macs = MACS; Object.assign(R.RESEAU, ORIGINE); };
  await onglet('dhcp');
  return { v, vctx, S, window, corps, rendu, q, qa, f, clic, saisir, choisir, onglet, tic, appels, ecrit, ips, fin, actif: () => actif, texte: () => corps.textContent, garde: () => q('.sr-garde'), allume: () => Boolean(dhcpServer()),
    minute: async () => { S.now += MIN; await veillerDhcp(vctx); }, reglages: () => vctx.settings.dhcp as DhcpConfig, etats: () => (vctx.settings.macPolicy as MacPolicy | undefined)?.etats ?? {}, mode: () => (vctx.settings.macPolicy as MacPolicy | undefined)?.mode ?? 'ouvert' };
}
const radios = (P: Awaited<ReturnType<typeof page>>) => P.qa('[role="radio"]').map((b) => `${b.attrs['data-f']}:${b.attrs['aria-checked']}`);

test('R4 · page : l\'onglet « Réglages DHCP » ; la box distribue : rien n\'est touché ; le lien vers Genèse, le filet, les réglages, tout a son étiquette', async () => {
  const P = await page();
  try {
    assert.deepEqual(P.qa('[role="tab"]').map((b) => [b.textContent, b.attrs['aria-selected']]), [['Appareils (DHCP)', 'false'], ['Adresses fixes', 'false'], ['Réglages DHCP', 'true'], ['Tout', 'false']]);
    // Deux usages du DHCP : le lien vers Genèse est un vrai lien.
    const lien = P.f('pont')!;
    assert.deepEqual([lien.tagName, lien.attrs.href, lien.textContent], ['A', '#app=thjalfi', 'Démarrage réseau (Genèse)']);
    assert.match(P.texte(), /Deux usages du DHCP, deux réglages/); assert.match(P.texte(), /Un seul serveur d'adresses d'Odin par carte réseau/); assert.match(P.texte(), /Genèse \(démarrage par le réseau\) n'ajoute rien ici en ce moment\./);
    // Qui distribue : deux choix, un seul coché, dans un groupe nommé.
    const groupe = P.q('[role="radiogroup"]')!;
    assert.equal(groupe.attrs['aria-label'], 'Qui distribue les adresses');
    assert.deepEqual(radios(P), ['m-box:true', 'm-odin:false']);
    assert.deepEqual(P.qa('[role="radio"]').map((b) => [b.tagName, b.attrs.tabindex]), [['BUTTON', '0'], ['BUTTON', '-1']]);
    assert.match(P.f('m-box')!.textContent, /^La boxRien ne change\. Odin regarde\.Rien à réglerPas de blocage ni d'adresse fixe par Odin \(choisi\)$/);
    assert.match(P.f('m-odin')!.textContent, /^Pour bloquer et réserverOdin distribue les adresses/);
    const g = P.garde()!;
    assert.deepEqual([g.attrs.role, g.classList.contains('calme')], ['note', true]); assert.match(g.textContent, /^Le réseau de la maison n'est pas touchéLa box garde les adresses\./);
    // Le filet, dit par le serveur ; les réglages, chacun avec son étiquette.
    assert.match(P.texte(), /Si Odin s'éteintSi tu choisis « Odin distribue les adresses » : voilà ce qui se passera/); assert.match(P.texte(), /12 h au plus après leur dernier renouvellement/);
    for (const k of ['debut', 'fin', 'passerelle', 'masque', 'dns', 'heures', 'domaine']) { assert.equal(P.f(k)!.id, `sr-${k}`); assert.ok(P.q(`label[for="sr-${k}"]`), `le champ « ${k} » a son étiquette`); }
    assert.deepEqual(['debut', 'fin', 'passerelle', 'masque', 'dns', 'heures', 'domaine'].map((k) => P.f(k)!.value), ['10.0.0.100', '10.0.0.199', BOX, '255.255.255.0', '', '12', 'maison']);
    assert.equal(P.f('dns')!.attrs.placeholder, 'Odin (10.0.0.2)'); assert.deepEqual(P.f('heures')!.children.map((x) => x.textContent), ['2 h', '12 h', '1 jour', '3 jours']);
    assert.match(P.texte(), /Carte réseauEthernet · 10\.0\.0\.2\/24/);
    const sw = P.f('secours')!;
    assert.deepEqual([sw.tagName, sw.attrs.role, sw.attrs['aria-checked'], sw.attrs['aria-labelledby'], P.q('#sr-l-sec')!.textContent], ['BUTTON', 'switch', 'false', 'sr-l-sec', 'DNS de secours : la box']);
    assert.equal(P.f('r-ok')!.disabled, true); assert.match(P.q('#sr-verdict')!.textContent, /Change un réglage : Odin le vérifie avant de l'enregistrer\./);
    // Qui reçoit une adresse : toutes les machines, par défaut (sa réponse).
    assert.deepEqual(P.qa('.sa-chip').map((b) => [b.textContent, b.attrs['aria-pressed']]), [['Toutes les machines', 'true'], ['Seulement les machines approuvées', 'false']]);
    assert.match(P.texte(), /Une machine inconnue reçoit une adresse et t'est signalée tout de suite/);
    assert.deepEqual(P.ecrit(), [], 'regarder n\'écrit rien'); assert.equal(P.allume(), false);
    // Au clavier : les flèches passent d'un choix à l'autre, sans rien choisir.
    await P.f('m-box')!.emettre('keydown', { key: 'ArrowRight' }); assert.equal(P.actif()?.attrs['data-f'], 'm-odin');
    await P.actif()!.emettre('keydown', { key: 'ArrowLeft' }); assert.equal(P.actif()?.attrs['data-f'], 'm-box');
    assert.deepEqual(radios(P), ['m-box:true', 'm-odin:false']); assert.deepEqual(P.ecrit(), []);
    for (const src of [SOURCE]) { assert.doesNotMatch(src, /innerHTML|insertAdjacentHTML|outerHTML|document\.write/, 'la page n\'écrit jamais de HTML'); assert.doesNotMatch(src, /[\u2028\u2029\r]/, 'ni séparateur de ligne Unicode, ni retour chariot'); }
  } finally { P.fin(); }
});

test('R4 · page : « Odin distribue les adresses » — la question d\'abord, le REFUS tant que la box distribue, « revérifier », puis allumé avec l\'heure de la vérification', async () => {
  const P = await page();
  try {
    P.S.autres = [BOX];
    // Choisir : rien ne part. La page dit ce qu'Odin va vérifier et ce qu'il faut avoir fait.
    await P.clic('m-odin');
    assert.deepEqual(radios(P), ['m-box:false', 'm-odin:true']);
    let g = P.garde()!;
    assert.deepEqual([g.attrs.role, g.attrs['aria-live']], ['alert', 'assertive']);
    assert.match(g.textContent, /^Odin distribue les adresses de la maison \?Avant d'allumerOdin demande d'abord sur sa carte \(Ethernet, 10\.0\.0\.2\) si un autre serveur d'adresses répond\./);
    assert.match(g.textContent, /L'adresse d'Odin \(10\.0\.0\.2\) doit être réglée à la main sur sa machine/); assert.match(g.textContent, /Il ne recommence jamais tout seul après s'être arrêté\./);
    assert.match(g.textContent, /Si Odin s'éteintLes appareils déjà là gardent leur adresse jusqu'à la fin de leur bail/);
    assert.equal(P.actif()?.attrs['data-f'], 'q-non', 'le clavier arrive sur « Annuler »'); assert.deepEqual(P.ecrit(), []);
    // Échap : on revient à « La box », rien n'est parti.
    await P.actif()!.emettre('keydown', { key: 'Escape' }); await calme();
    assert.deepEqual(radios(P), ['m-box:true', 'm-odin:false']); assert.equal(P.actif()?.attrs['data-f'], 'm-odin'); assert.deepEqual(P.ecrit(), []);
    // « Vérifier, puis allumer » : la box répond → refusé, mot pour mot, avec les deux gestes.
    await P.clic('m-odin'); await P.clic('q-ok');
    assert.deepEqual(P.ecrit(), ['dhcp_demarrer (accord)']); assert.equal(P.allume(), false);
    g = P.garde()!;
    assert.equal(g.attrs.role, 'alert'); assert.equal(g.classList.contains('calme'), false);
    assert.equal(g.querySelector('.sa-gt')!.textContent, 'Refusé : ça casserait le réseau de la maison');
    assert.match(g.textContent, /La box \(10\.0\.0\.1\) distribue encore les adresses\. Deux serveurs à la fois : les téléphones, la télé et les PC n'auraient plus Internet\./);
    assert.deepEqual(g.querySelector('ol')!.children.map((li) => li.textContent), ['Ouvre la page de la box → réseau local → serveur DHCP : désactivé.', 'Reviens ici : Odin revérifie, et s\'allume seulement si plus personne d\'autre ne distribue.']);
    assert.deepEqual([P.f('g-reverif')!.textContent, P.f('g-laisser')!.textContent], ['J\'ai coupé celui de la box : revérifier', 'Laisser la box distribuer']);
    assert.deepEqual(radios(P), ['m-box:false', 'm-odin:true'], 'le choix voulu reste montré, avec son refus');
    assert.equal(P.actif()?.attrs['data-f'], 'g-reverif');
    // La page relue en direct ne fait pas disparaître le refus.
    await P.tic(); assert.equal(P.garde()!.querySelector('.sa-gt')!.textContent, 'Refusé : ça casserait le réseau de la maison');
    // Revérifier alors que la box distribue toujours : refusé encore.
    await P.clic('g-reverif'); assert.equal(P.allume(), false); assert.ok(P.f('g-reverif'));
    // « Laisser la box distribuer » : retour au calme, rien n'a été allumé.
    await P.clic('g-laisser');
    assert.deepEqual(radios(P), ['m-box:true', 'm-odin:false']); assert.match(P.garde()!.textContent, /^Le réseau de la maison n'est pas touché/);
    // La box est coupée : cette fois Odin s'allume, et dit quand il a vérifié.
    P.S.autres = [];
    await P.clic('m-odin'); await P.clic('q-ok');
    assert.equal(P.allume(), true); assert.equal(gardeDhcp(P.vctx).etat, 'libre');
    assert.deepEqual(P.ecrit(), ['dhcp_demarrer (accord)', 'dhcp_demarrer (accord)', 'dhcp_demarrer (accord)']);
    assert.deepEqual(radios(P), ['m-box:false', 'm-odin:true']);
    g = P.garde()!;
    assert.deepEqual([g.attrs.role, g.classList.contains('calme')], ['note', true]);
    assert.match(g.textContent, /^Aucun autre serveur d'adresses : Odin distribueDernière vérification à \d\d:\d\d, sur la carte Ethernet\. Odin repose la question chaque minute ; s'il voit un autre serveur d'adresses, il s'arrête et te prévient\. Il ne recommence jamais tout seul\./);
    assert.match(P.q('.sa-res')!.textContent, /DHCP d'Odin en marche : adresses 10\.0\.0\.100 → 10\.0\.0\.199/);
    assert.match(P.texte(), /Odin distribue les adresses : voilà ce qui se passe pour la maison s'il s'arrête/);
    assert.equal(P.actif()?.attrs['data-f'], 'm-odin');
  } finally { P.fin(); }
});

test('R4 · page : en marche — « revérifier maintenant », la vérification trop vieille est dite ; coupé par le garde-fou : la raison, et rien ne repart sans le propriétaire', async () => {
  const P = await page({ allume: true });
  try {
    assert.deepEqual(radios(P), ['m-box:false', 'm-odin:true']);
    // Revérifier maintenant : une lecture, Odin continue.
    await P.clic('g-verif');
    assert.deepEqual(P.ecrit(), ['dhcp_chercher']); assert.match(P.q('.sa-res')!.textContent, /Aucun autre serveur d'adresses ne répond sur Ethernet : Odin continue de distribuer\./); assert.equal(P.allume(), true);
    // La veille de chaque minute ne passe plus (en pause) : la page le dit.
    P.S.now += 5 * MIN; await P.tic();
    assert.match(P.garde()!.textContent, /La dernière vérification date de à \d\d:\d\d : la surveillance de Sphinx est peut-être en pause \(Talos\)\./);
    await P.minute(); await P.tic(); assert.doesNotMatch(P.garde()!.textContent, /peut-être en pause/);
    // La box se remet à distribuer : Odin s'arrête ; la page relue le montre, avec la raison du serveur.
    P.S.autres = [BOX]; await P.minute(); await P.tic();
    assert.equal(P.allume(), false);
    let g = P.garde()!;
    assert.equal(g.attrs.role, 'alert'); assert.equal(g.querySelector('.sa-gt')!.textContent, 'Odin ne distribue plus les adresses');
    assert.match(g.textContent, /Odin a arrêté de distribuer les adresses : un autre serveur d'adresses répond sur Ethernet \(10\.0\.0\.1\)\. Il ne recommence pas tout seul\./);
    assert.match(g.textContent, /Rien ne repart sans toi/);
    assert.deepEqual(radios(P), ['m-box:false', 'm-odin:true'], '« Odin distribue » reste le choix : c\'est lui qui est coupé');
    assert.deepEqual([P.f('g-rallumer')!.textContent, P.f('g-laisser')!.textContent], ['Revérifier et rallumer', 'Laisser la box distribuer']);
    // Le temps passe, la page se relit : rien ne repart tout seul.
    P.S.autres = []; await P.minute(); await P.minute(); await P.tic();
    assert.equal(P.allume(), false); assert.ok(P.f('g-rallumer'));
    // « Revérifier et rallumer » : la question d'abord, puis l'accord.
    await P.clic('g-rallumer');
    assert.match(P.garde()!.textContent, /^Odin distribue les adresses de la maison \?/); assert.equal(P.allume(), false);
    await P.clic('q-ok'); assert.equal(P.allume(), true); assert.match(P.garde()!.textContent, /^Aucun autre serveur d'adresses : Odin distribue/);
    // « La box » : la question dit ce qui se passe ensuite ; Annuler ne touche à rien ; l'accord arrête Odin.
    await P.clic('m-box');
    g = P.garde()!;
    assert.match(g.textContent, /^Laisser la box distribuer les adresses \?Odin arrête de donner les adresses\. Rallume d'abord le serveur d'adresses \(DHCP\) de la box : sinon plus personne ne distribue\.Ce qui se passe ensuite/);
    assert.match(g.textContent, /Si Odin s'arrêtait maintenant : le premier des 4 appareils/);
    await P.clic('q-non'); assert.equal(P.allume(), true); assert.deepEqual(radios(P), ['m-box:false', 'm-odin:true']);
    await P.clic('m-box'); await P.clic('q-ok');
    assert.equal(P.allume(), false); assert.deepEqual(radios(P), ['m-box:true', 'm-odin:false']);
    assert.match(P.q('.sa-res')!.textContent, /^⏹ DHCP d'Odin arrêté\. Rallume celui de la box\./);
    assert.deepEqual(P.ecrit(), ['dhcp_chercher', 'dhcp_demarrer (accord)', 'dhcp_arreter (accord)']);
  } finally { P.fin(); }
});

test('R4 · page : les adresses données — Odin vérifie pendant la frappe ; un refus ne part jamais ; changer la plage ne coupe personne ; la passerelle demande l\'accord', async () => {
  const P = await page({ allume: true });
  try {
    const avant = JSON.stringify(P.reglages());
    // Une adresse mal écrite : refusée, le champ est marqué, le bouton reste grisé.
    await P.saisir('fin', '10.0.0.300');
    let v = P.q('#sr-verdict')!;
    assert.deepEqual([v.attrs.role, v.attrs['aria-live']], ['status', 'polite']); assert.match(v.textContent, /La dernière adresse est mal écrite/); assert.ok(v.querySelector('.bad'));
    assert.deepEqual([P.f('fin')!.attrs['aria-invalid'], P.f('fin')!.attrs['aria-describedby'], P.f('debut')!.attrs['aria-invalid']], ['true', 'sr-verdict', undefined]);
    assert.equal(P.f('r-ok')!.disabled, true);
    await P.f('fin')!.emettre('keydown', { key: 'Enter' }); await calme();
    assert.deepEqual(P.ecrit(), [], 'Entrée sur un refus n\'envoie rien');
    // La page relue en direct pendant la frappe : le champ ne bouge pas.
    await P.tic(); assert.equal(P.f('fin')!.value, '10.0.0.300');
    // Une plage à l'envers, hors du réseau : refusée aussi.
    await P.saisir('fin', '10.0.0.50'); assert.match(P.q('#sr-verdict')!.textContent, /La première adresse doit précéder la dernière/);
    // Une plage valable : acceptée, et ce que cela fait aux appareils déjà là est dit.
    await P.saisir('debut', '10.0.0.10');
    v = P.q('#sr-verdict')!;
    assert.match(v.textContent, /^Réglages valables\.Personne n'est coupé : 4 appareils tiennent une adresse hors de cette plage\. Ils la gardent jusqu'à la fin de leur bail \(au plus tard .+\), puis reçoivent une adresse de la plage\./);
    assert.ok(v.querySelector('.ok')); assert.equal(P.f('fin')!.attrs['aria-invalid'], undefined); assert.equal(P.f('r-ok')!.disabled, false);
    assert.equal(JSON.stringify(P.reglages()), avant, 'vérifier n\'écrit rien'); assert.deepEqual(P.ecrit(), []);
    // « Annuler mes changements » : le formulaire reprend les réglages du serveur.
    await P.clic('r-non'); assert.deepEqual([P.f('debut')!.value, P.f('fin')!.value, P.f('r-ok')!.disabled], ['10.0.0.100', '10.0.0.199', true]);
    // Enregistrer la plage, le bail et le DNS de secours : pas d'accord à demander pour la plage et le bail… mais le DNS change.
    await P.saisir('debut', '10.0.0.10'); await P.saisir('fin', '10.0.0.50'); await P.choisir('heures', '24');
    await P.clic('r-ok');
    assert.deepEqual(P.ecrit(), ['dhcp_reglages']); assert.deepEqual([P.reglages().start, P.reglages().end, P.reglages().leaseSeconds], ['10.0.0.10', '10.0.0.50', 86_400]);
    assert.match(P.q('.sa-res')!.textContent, /^⚙️ DHCP : 10\.0\.0\.10 → 10\.0\.0\.50, passerelle 10\.0\.0\.1, DNS 10\.0\.0\.2, baux 24 h, domaine \.maison\.\n- Personne n'est coupé/);
    assert.equal(P.allume(), true); assert.equal(P.f('r-ok')!.disabled, true); assert.equal(P.f('heures')!.value, '24');
    // L'interrupteur « DNS de secours : la box » et la passerelle, pendant qu'Odin distribue : le serveur demande l'accord, la page le pose.
    await P.clic('secours');
    assert.equal(P.f('secours')!.attrs['aria-checked'], 'true'); assert.equal(P.actif()?.attrs['data-f'], 'secours');
    assert.match(P.q('#sr-verdict')!.textContent, /DNS de secours \(10\.0\.0\.1\) : si Odin ne répond plus, les appareils demandent là\./);
    await P.clic('r-ok');
    const qn = P.qa('.sr-garde').find((n) => /Enregistrer ces réglages/.test(n.textContent))!;
    assert.ok(qn, 'la question est dans la page'); assert.equal(qn.attrs.role, 'alert');
    assert.match(qn.textContent, /Changer le DNS donné \(10\.0\.0\.2, 10\.0\.0\.1\) pendant qu'Odin distribue les adresses : tous les appareils de la maison les recevront à leur prochain renouvellement, et une erreur leur coupe Internet\./);
    assert.deepEqual(P.reglages().dns, [ODIN], 'rien n\'est écrit avant l\'accord'); assert.equal(P.actif()?.attrs['data-f'], 'q-non');
    await P.clic('q-non'); assert.deepEqual(P.reglages().dns, [ODIN]); assert.equal(P.f('secours')!.attrs['aria-checked'], 'true', 'ce qui est tapé reste');
    await P.clic('r-ok'); await P.clic('q-ok');
    assert.deepEqual(P.reglages().dns, [ODIN, BOX]); assert.deepEqual(P.ecrit(), ['dhcp_reglages', 'dhcp_reglages', 'dhcp_reglages', 'dhcp_reglages (accord)']);
    assert.equal(P.f('secours')!.attrs['aria-checked'], 'true'); assert.equal(P.f('dns')!.value, '', 'le champ reste « Odin » : la box est le secours');
    // Odin hors du réseau pendant qu'il distribue : refusé par le serveur, pendant la frappe.
    await P.saisir('passerelle', '192.168.1.1');
    assert.match(P.q('#sr-verdict')!.textContent, /n'est pas dans le réseau de la maison|Odin distribue les adresses en ce moment/); assert.equal(P.f('r-ok')!.disabled, true);
  } finally { P.fin(); }
});

test('R4 · page : « Seulement les machines approuvées » — celles qui sont approuvées d\'abord, celles qui ne le sont PAS (les nouvelles), nom par nom (un nom piégé reste du texte), puis l\'accord', async () => {
  const P = await page({ allume: true });
  try {
    // Le téléphone est connu depuis trois jours ; la machine au nom piégé vient d'arriver (moins d'un jour).
    P.vctx.saveSettings({ leases: (P.vctx.settings.leases as Lease[]).map((l) => (l.mac === M.tel ? { ...l, first: T0 - 3 * 24 * 3600_000 } : l)) });
    await P.tic();
    await P.clic('l-liste');
    const g = P.qa('.sr-garde').find((n) => /Seulement les machines approuvées \?/.test(n.textContent))!;
    assert.ok(g); assert.equal(g.attrs.role, 'alert'); assert.deepEqual(P.ecrit(), [], 'rien ne part avant l\'accord'); assert.equal(P.mode(), 'ouvert');
    assert.match(g.textContent, /Approuvées d'abord, parce qu'elles ont une adresse en ce moment \(sinon elles perdraient le réseau à la fin de leur bail\)/);
    const [pre, aVoir, restent] = g.querySelectorAll('ul');
    assert.deepEqual(pre.children.map((li) => li.textContent), [`Telephone 1 · ${P.ips[M.tel]} · ${M.tel}`]);
    // La nouvelle n'est PAS approuvée d'avance : elle est montrée à part, avec l'heure jusqu'à laquelle elle garde son adresse.
    assert.match(g.textContent, /PAS approuvées : Odin ne les connaît que depuis moins d'un jour/);
    assert.equal(aVoir.children.length, 1); assert.ok(aVoir.children[0].textContent.startsWith(`img srcx onerroralert1Cam · ${P.ips[M.piege]} · ${M.piege} nouvelle jusqu'à `), aVoir.children[0].textContent);
    assert.match(g.textContent, /Elles gardent leur adresse jusqu'à la fin de leur bail, puis attendent ton accord\. Dans « Appareils » : « Je le connais » si tu les reconnais, sinon bloque-les\./);
    assert.match(g.textContent, /Odin ne sait pas quelle machine tu tiens en ce moment : si elle est dans cette liste, approuve-la d'abord dans « Appareils »\./);
    assert.deepEqual(restent.children.map((li) => li.textContent), [`Camera · ${M.cam} bloquée`]);
    assert.ok(!crees.includes('IMG') && !crees.includes('SCRIPT') && !crees.includes('IFRAME'), 'aucune balise venue du réseau'); assert.doesNotMatch(P.texte(), /<img|onerror=alert\(|[<>]/);
    // Annuler : rien n'a changé.
    await P.clic('q-non'); assert.equal(P.mode(), 'ouvert'); assert.equal(P.actif()?.attrs['data-f'], 'l-liste');
    // L'accord : le mode change, la machine connue qui avait une adresse est approuvée, la nouvelle attend, la caméra reste bloquée.
    await P.clic('l-liste'); await P.clic('q-ok');
    assert.deepEqual(P.ecrit(), ['dhcp_mode (accord)']); assert.equal(P.mode(), 'liste');
    assert.deepEqual(P.etats(), { [M.pc]: 'actif', [M.cam]: 'bloque', [M.tel]: 'actif' }); assert.deepEqual((P.vctx.settings.macPolicy as MacPolicy).attente, [M.piege]);
    assert.deepEqual(P.qa('.sa-chip').map((b) => b.attrs['aria-pressed']), ['false', 'true']);
    assert.match(P.q('.sa-res')!.textContent, /- Approuvés d'abord, parce qu'ils ont une adresse en ce moment \(1\) : Telephone 1\./);
    assert.match(P.q('.sa-res')!.textContent, /- PAS approuvé, parce qu'Odin ne le connaît que depuis moins d'un jour \(1\) : img srcx onerroralert1Cam\./);
    assert.match(P.texte(), /Une machine inconnue attend ton accord, sans adresse\./);
    assert.match(P.texte(), /Une machine attend ton accord\./, 'la nouvelle attend déjà');
    // Une inconnue demande une adresse : elle attend, la page le dit et mène aux appareils.
    dhcpServer()!.onMessage(paquet('00:00:5e:00:53:99', MSG.DISCOVER, { nom: 'Inconnue' })); await P.tic();
    assert.match(P.texte(), /2 machines attendent ton accord\./);
    await P.clic('l-voir'); assert.equal(P.q('#sa-tab-appareils')!.attrs['aria-selected'], 'true');
    // Retour à « Toutes les machines » : sans question (rien n'est coupé), personne n'est désapprouvé.
    await P.onglet('dhcp'); await P.clic('l-ouvert');
    assert.equal(P.mode(), 'ouvert'); assert.equal(P.etats()[M.cam], 'bloque'); assert.deepEqual(P.ecrit(), ['dhcp_mode (accord)', 'dhcp_mode']);
  } finally { P.fin(); }
});

test('R4 · page : un membre de la famille n\'a ni les réglages ni les gestes ; il apprend seulement qui distribue', async () => {
  const P = await page({ membre: true });
  try {
    assert.match(P.texte(), /Ce que tu voisLes réglages du DHCP \(qui distribue les adresses, la plage, le bail\) sont au propriétaire seul\.La box distribue les adresses de la maison\./);
    assert.equal(P.q('[role="radiogroup"]'), null); assert.equal(P.f('debut'), null); assert.equal(P.f('r-ok'), null); assert.equal(P.f('l-liste'), null); assert.equal(P.f('pont'), null);
    assert.doesNotMatch(P.texte(), /10\.0\.0\.\d+|Ethernet/, 'ni adresse du réseau, ni carte');
    await P.tic(); assert.deepEqual(P.ecrit(), []);
  } finally { P.fin(); }
});

test('R4 relecture · page : un réglage en cours de frappe ne fait pas perdre, à la relecture en direct, le bouton tenu au clavier ; Odin qui doute le dit', async () => {
  const P = await page({ allume: true });
  try {
    await P.saisir('debut', '10.0.0.50');
    P.f('l-liste')!.focus(); assert.equal(P.actif(), P.f('l-liste'));
    await P.tic();
    assert.equal(P.f('debut')!.value, '10.0.0.50', 'le formulaire n\'a pas bougé sous les doigts');
    assert.equal(P.actif(), P.f('l-liste'), 'le bouton tenu est retrouvé dans la page redessinée'); assert.equal(P.actif()?.visible, true);
    // Dans un champ : la relecture ne touche à rien.
    P.f('fin')!.focus(); const champ = P.f('fin'); await P.tic(); assert.equal(P.actif(), champ);
    // La vérification n'a pas pu se faire : Odin se tait, et la page le dit au lieu de « la surveillance est peut-être en pause ».
    R.RESEAU.chercher = async () => ({ serveurs: [], erreur: 'la question n\'a pas pu partir (ENETUNREACH)' });
    await P.minute(); await P.tic();
    assert.equal(P.allume(), true);
    assert.match(P.garde()!.textContent, /Odin n'a pas pu vérifier qu'aucun autre serveur d'adresses ne répond \(1 fois sur 3\)\. En attendant, il ne répond à aucune demande d'adresse : les machines gardent la leur\./);
  } finally { P.fin(); }
});
