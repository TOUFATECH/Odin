// Sphinx · Appareils, lot R2 (la page) : la liste « qui a quelle adresse », la recherche et les filtres, la bannière des
// nouveaux appareils, la fiche, et « Bloquer / Mettre en pause / Débloquer » avec le garde-fou DANS la page (l'appareil
// nommé, ce qui sera fait, ce qu'Odin ne peut pas faire, l'avertissement quand c'est l'appareil que l'on tient), au
// clavier. La page est montée dans un document minimal et parle au VRAI Sphinx (Valhalla, dossiers temporaires) ; la
// prise du serveur d'adresses est SIMULÉE (aucun vrai paquet, aucun port 67/68). Les actions graves passent par la même
// règle que l'interface (pas d'accord : rien ne part). Adresses d'exemple (192.0.2.x), MAC de documentation.
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

const SOURCE = readFileSync(new URL('../src/web/pages/sphinx-appareils.js', import.meta.url), 'utf8');
const BOX = '192.0.2.1', ODIN = '192.0.2.2', H = 3600_000;
// L'horloge de l'essai part de maintenant : la page dit les heures par rapport à l'horloge de l'appareil (« à 14:02 », « demain à 02:02 »).
const T0 = Date.now(), QD = '(?:hier |demain )?à [0-9][0-9]:[0-9][0-9]';
const M = { box: '00:00:5e:00:53:01', odin: '00:00:5e:00:53:02', pc: '00:00:5e:00:53:23', tel: '02:00:5e:00:53:14', piege: '00:00:5e:00:53:77' };
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
  className = ''; texte = ''; html = ''; value = '';
  classList = {
    add: (c: string) => { if (!this.classList.contains(c)) this.className = `${this.className} ${c}`.trim(); },
    remove: (c: string) => { this.className = this.className.split(/\s+/).filter((x) => x && x !== c).join(' '); },
    contains: (c: string) => this.className.split(/\s+/).includes(c),
  };
  constructor(tag: string, type = 1) { this.tagName = tag.toUpperCase(); this.nodeType = type; if (type === 1) crees.push(this.tagName); }
  get id() { return this.attrs.id ?? ''; }
  get disabled() { return 'disabled' in this.attrs; }
  set innerHTML(h: string) { this.html = h; throw new Error('la page ne pose jamais de HTML'); }
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
  get childNodes() { return [...this.enfants]; }
  setAttribute(k: string, v: unknown) { if (k === 'class') this.className = String(v); else if (k === 'value') this.value = String(v); else this.attrs[k] = String(v); }
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
const calme = async () => { for (let k = 0; k < 25; k++) await new Promise((ok) => setTimeout(ok, 3)); };
const paquet = (mac: string, type: number, o: { nom?: string; veut?: string; tient?: string } = {}) => buildPacket({ op: 1, xid: 7, mac, ciaddr: o.tient ?? '0.0.0.0', options: [[53, Buffer.from([type])], ...(o.nom !== undefined ? [[12, Buffer.from(o.nom, 'utf8')] as [number, Buffer]] : []), ...(o.veut ? [[50, Buffer.from(o.veut.split('.').map(Number))] as [number, Buffer]] : [])] });

/** La page de Sphinx montée, reliée au vrai Sphinx ; ses demandes notées. `qui` : un membre de la famille ; `depuis` : l'adresse d'où l'on agit. */
async function page(o: { membre?: boolean; depuis?: () => string; allume?: boolean } = {}) {
  const home = mkdtempSync(join(tmpdir(), 'sphinx-r2p-')); dossiers.push(home);
  const envois: Packet[] = []; let now = T0;
  PRISE_DHCP.ecouter = async (d) => { (d as unknown as { sock: unknown }).sock = { send: (b: Buffer) => { envois.push(parsePacket(b)); }, close: () => {} }; };
  LOCAL.macs = () => [M.odin]; setVerificateur(() => undefined);
  const v = new Valhalla(home, [vidarr()], { run: async () => ({ code: 1, out: '', err: '' }), fetch: (async () => { throw new Error('aucun réseau'); }) as never, notify: async () => {}, autonomy: () => 'equilibre', now: () => new Date(now) } as never);
  const cfg: DhcpConfig = { server: ODIN, start: '192.0.2.100', end: '192.0.2.199', mask: '255.255.255.0', router: BOX, dns: [ODIN], leaseSeconds: 12 * 3600, domain: 'maison', fixed: [{ mac: M.box, ip: BOX, name: 'Box internet' }] };
  v.ctx('vidarr').saveSettings({ dhcp: cfg });
  const ips: Record<string, string> = {};
  if (o.allume !== false) {
    assert.equal((await v.act('vidarr', 'dhcp_demarrer', { forcer: true })).ok !== false, true);
    const prend = (mac: string, nom: string) => { const n = envois.length; dhcpServer()!.onMessage(paquet(mac, MSG.DISCOVER, { nom })); const ip = envois[n].yiaddr; dhcpServer()!.onMessage(paquet(mac, MSG.REQUEST, { nom, veut: ip })); ips[mac] = ip; };
    prend(M.pc, 'PC-BUREAU'); prend(M.tel, 'Telephone 1'); prend(M.piege, PIEGE);
    // Le PC est connu depuis longtemps (ni « nouveau », ni en attente).
    await v.act('vidarr', 'dhcp_approuver', { mac: M.pc, nom: 'PC du bureau' });
  }
  const mod = v.module('vidarr')!;
  racine = new Noeud('html'); actif = null; crees.length = 0;
  const tete = new Noeud('head'), corps = new Noeud('body'); racine.append(tete, corps);
  const document = { head: tete, body: corps, hidden: false, get activeElement() { return actif; }, createElement: (t: string) => new Noeud(t), createElementNS: (_n: string, t: string) => new Noeud(t), createTextNode: (t: string) => new Texte(t), getElementById: (i: string) => racine.querySelector(`#${i}`) };
  const appels: Array<{ action: string; input: Record<string, unknown>; confirm: boolean }> = [];
  const nour = { login: 'nour', name: 'Nour', groups: ['famille'] };
  // La même règle que l'interface : une action grave sans accord ne part pas, la réponse dit quoi confirmer.
  const repondre = async (b: { module: string; action: string; input: Record<string, unknown>; confirm?: boolean }) => {
    if (b.module !== 'vidarr') return { ok: false, text: 'refusé par l\'essai' };
    const a = mod.actions.find((x) => x.id === b.action);
    const lancer = async () => {
      if (o.membre && a?.proprietaireSeul) return { ok: false, text: `${mod.name} · ${a.label} : seul le propriétaire le règle lui-même.` };
      const why = a?.grave?.(b.input, v.ctx('vidarr')); if (why && !b.confirm) return { ok: false, confirm: `Confirmer : ${why} ?` };
      return v.act('vidarr', b.action, b.input);
    };
    const moi = () => (o.membre ? auNomDe(nour, lancer) : lancer());
    return o.depuis ? origineDemande.run(o.depuis(), moi) : moi();
  };
  const fetch = async (_u: string, op: { body: string }) => { const b = JSON.parse(op.body); appels.push({ action: b.action, input: b.input, confirm: Boolean(b.confirm) }); const r = await repondre(b); return { json: async () => JSON.parse(JSON.stringify(r)) }; };
  const window: Record<string, any> = {}; const rythmes: Array<() => unknown> = [];
  const ctx = { window, document, Date, setInterval: (f: () => unknown) => { rythmes.push(f); return rythmes.length; }, clearInterval: () => {}, fetch };
  vm.runInNewContext(SOURCE, ctx);
  const host = new Noeud('div'); corps.append(host);
  const generique = new Noeud('section'); generique.append(new Texte('PAGE GÉNÉRIQUE'));
  const rendu = await window.OdinPages.vidarr({ host, generic: [generique] });
  await calme();
  const qa = (s: string) => corps.querySelectorAll(s).filter((n) => n.visible), q = (s: string) => qa(s)[0] ?? null;
  const f = (cle: string) => q(`[data-f="${cle}"]`);
  const clic = async (cle: string) => { const n = f(cle); assert.ok(n, `élément « ${cle} »`); assert.equal(n.disabled, false, `« ${cle} » n'est pas grisé`); await n.emettre('click'); await calme(); };
  const saisir = async (cle: string, val: string) => { const n = f(cle)!; n.value = val; await n.emettre('input', { target: n }); await calme(); };
  const lignes = () => qa('button.sa-row').map((b) => b.attrs['data-f'].slice(4));
  const tic = async () => { for (const g of rythmes) await g(); await calme(); };
  const ecrit = () => appels.filter((a) => a.action !== 'baux_vus');
  const fin = () => { v.stop(); PRISE_DHCP.ecouter = PRISE; LOCAL.macs = MACS; };
  return { v, window, corps, rendu, q, qa, f, clic, saisir, lignes, tic, appels, ecrit, ips, fin, actif: () => actif, texte: () => corps.textContent, avance: (ms: number) => { now += ms; }, etats: () => (v.ctx('vidarr').settings.macPolicy as MacPolicy | undefined)?.etats ?? {} };
}

test('R2 · page : la liste, les chiffres, la bannière des nouveaux appareils ; un nom piégé reste du texte', async () => {
  const P = await page();
  try {
    assert.equal(P.rendu, true, 'la page de Sphinx prend la place de la page générique');
    assert.deepEqual(P.qa('[role="tab"]').map((b) => [b.textContent, b.attrs['aria-selected']]), [['Appareils (DHCP)', 'true'], ['Tout', 'false']]);
    assert.deepEqual(P.qa('.sa-stat').map((n) => n.textContent), ['Connectés maintenant3', 'Appareils connus4', 'Nouveaux, inconnus2', 'Bloqués ou en pause0']);
    assert.deepEqual(P.lignes(), [M.box, P.lignes()[1], P.lignes()[2], P.lignes()[3]]);
    assert.deepEqual(new Set(P.lignes()), new Set([M.box, M.pc, M.tel, M.piege]));
    // La bannière : les deux inconnus, avec « Je le connais », « Bloquer », « Fiche ».
    const ban = P.q('.sa-ban')!;
    assert.equal(ban.attrs.role, 'status'); assert.match(ban.textContent, /2 nouveaux appareils sur le réseau de la maison/);
    assert.match(ban.textContent, new RegExp(`Telephone 1 · 192.0.2.[0-9]+ · 02:00:5e:00:53:14— .adresse MAC privée. · arrivé ${QD}`));
    for (const mac of [M.tel, M.piege]) for (const k of ['connu', 'bbloq', 'bfiche']) assert.equal(P.f(`${k}:${mac}`)?.tagName, 'BUTTON');
    assert.equal(P.f(`connu:${M.pc}`), null, 'le PC connu n\'est pas dans la bannière');
    // Le visage d'Odin : deux yeux, rien d'autre.
    assert.deepEqual(P.q('.sa-face')!.children.map((n) => n.tagName), ['I', 'I']);
    // Le nom piégé : jamais une balise, jamais du HTML ; seulement du texte nettoyé.
    assert.ok(!crees.includes('IMG') && !crees.includes('SCRIPT') && !crees.includes('IFRAME'), 'aucune balise venue du réseau');
    assert.doesNotMatch(P.texte(), /<img|onerror=alert\(|[<>]/, 'le texte de la page n\'a aucun chevron');
    assert.match(P.f(`row:${M.piege}`)!.textContent, /img srcx onerroralert1Cam/);
    assert.doesNotMatch(SOURCE, /innerHTML|insertAdjacentHTML|outerHTML|document\.write/, 'la page n\'écrit jamais de HTML');
    // Une ligne : nom, type deviné, MAC, adresse, depuis → jusqu'à, état.
    const pc = P.f(`row:${M.pc}`)!;
    assert.equal(pc.attrs['aria-label'], 'Fiche de PC du bureau');
    assert.match(pc.textContent, new RegExp(`^PC du bureauOrdinateur · 00:00:5e:00:53:23192.0.2.[0-9]+${QD} → ${QD}connecté$`));
    assert.match(P.f(`row:${M.box}`)!.textContent, /Box internetfixeBox · 00:00:5e:00:53:01192\.0\.2\.1/);
    // Recherche, filtres, type.
    await P.saisir('q', '53:14'); assert.deepEqual(P.lignes(), [M.tel]);
    await P.saisir('q', 'rien de tel'); assert.deepEqual(P.lignes(), []); assert.match(P.texte(), /Aucun appareil ne correspond\./);
    await P.saisir('q', '');
    await P.clic('fil:neu'); assert.deepEqual(new Set(P.lignes()), new Set([M.tel, M.piege])); assert.equal(P.f('fil:neu')!.attrs['aria-pressed'], 'true'); assert.equal(P.actif(), P.f('fil:neu'), 'le clavier reste sur le filtre');
    await P.clic('fil:fixe'); assert.deepEqual(P.lignes(), [M.box]);
    await P.clic('fil:bloq'); assert.deepEqual(P.lignes(), []);
    await P.clic('fil:tout');
    const type = P.f('type')!; type.value = 'pc'; await type.emettre('change', { target: type }); await calme(); assert.deepEqual(P.lignes(), [M.pc]);
    assert.deepEqual(P.ecrit(), [], 'regarder n\'écrit rien');
    // L'onglet « Tout » garde la page générique ; les flèches passent d'un onglet à l'autre.
    await P.q('[role="tab"]')!.emettre('keydown', { key: 'ArrowRight' }); await calme();
    assert.deepEqual(P.qa('[role="tab"]').map((b) => b.attrs['aria-selected']), ['false', 'true']); assert.match(P.texte(), /PAGE GÉNÉRIQUE/); assert.equal(P.actif()?.textContent, 'Tout');
    assert.equal(P.q('.sa-stat'), null, 'l\'écran des appareils est rangé');
    // Les prochains écrans de Sphinx s'ajoutent sans toucher à cette page.
    P.window.OdinSphinx.ajouter({ id: 'fixes', titre: 'Adresses fixes', dessiner: () => ({}) });
    assert.equal(P.window.OdinSphinx.ecrans.map((e: { id: string }) => e.id).join(), 'appareils,fixes');
  } finally { P.fin(); }
});

test('R2 · page : la fiche, puis « Bloquer » avec le garde-fou dans la page, au clavier ; « Débloquer »', async () => {
  const P = await page();
  try {
    assert.match(P.texte(), /Choisis un appareil pour voir sa fiche\./);
    await P.clic(`row:${M.tel}`);
    const fiche = () => P.q('aside.sa-fiche')!;
    assert.equal(fiche().attrs['aria-label'], 'Fiche de Telephone 1');
    assert.equal(P.f(`row:${M.tel}`)!.attrs['aria-current'], 'true');
    assert.equal(P.actif(), P.f('retour'), 'le clavier arrive sur « Tous les appareils »');
    const faits = Object.fromEntries(fiche().querySelectorAll('dt').map((dt) => [dt.textContent, dt.parent!.children[1].textContent]));
    assert.deepEqual([faits['Adresse IP'], faits['Adresse MAC'], faits['Fabricant (d\'après la MAC)'], faits['Type (deviné)'], faits['Nom sur le réseau']], [P.ips[M.tel], `${M.tel} privée`, '— (adresse MAC privée)', 'Téléphone', 'telephone-1.maison']);
    assert.match(faits['Jusqu\'à (bail)'], new RegExp(`^${QD}$`));
    assert.match(fiche().textContent, new RegExp(`Nouveau : arrivé ${QD}. Donne-lui un nom si tu le connais.`));
    // « Bloquer » : le serveur nomme l'appareil ; rien n'est fait tant que le garde-fou n'est pas accepté.
    await P.clic('a-bloquer');
    assert.deepEqual(P.ecrit(), [{ action: 'dhcp_mac_etat', input: { mac: M.tel, etat: 'bloque', nom: 'Telephone 1' }, confirm: false }]);
    assert.deepEqual(P.etats()[M.tel], undefined, 'rien n\'est bloqué');
    const g = P.q('.sa-garde')!;
    assert.equal(g.attrs.role, 'alert');
    assert.match(g.textContent, /^Bloquer « Telephone 1 » \(02:00:5e:00:53:14\) : il n'obtient plus d'adresse et il est retiré du réseau/);
    assert.match(g.textContent, /Odin ne sait pas depuis quel appareil tu agis\. Si « Telephone 1 » est celui que tu tiens, tu perds Odin avec lui\./);
    assert.match(g.textContent, /Ce qui sera fait.*Le DHCP d'Odin ne lui répond plus : il n'obtient plus d'adresse\..*Il tient encore 192\.0\.2\.\d+ : à son prochain renouvellement Odin la lui refuse et il sort du réseau/);
    assert.match(g.textContent, /Ce qu'Odin ne peut pas faire.*ne peut pas lui reprendre son adresse à la seconde.*Adresse MAC privée : ce téléphone peut revenir avec une autre adresse MAC/);
    assert.match(g.textContent, /Tu peux le débloquer à tout moment/);
    assert.deepEqual(g.querySelectorAll('button').map((b) => b.textContent), ['Bloquer « Telephone 1 »', 'Plutôt en pause', 'Annuler']);
    assert.equal(P.actif(), P.f('k-non'), 'le clavier arrive sur « Annuler », pas sur « Bloquer »');
    assert.equal(P.f('a-bloquer'), null, 'un seul choix à la fois');
    // En direct : la page ne bouge pas sous un garde-fou ouvert.
    const avant = P.appels.length; await P.tic(); assert.equal(P.appels.length, avant);
    // Échap : annulé, le clavier revient sur « Bloquer ».
    await g.emettre('keydown', { key: 'Escape' }); await calme();
    assert.equal(P.q('.sa-garde'), null); assert.equal(P.actif(), P.f('a-bloquer')); assert.equal(P.etats()[M.tel], undefined);
    // « Plutôt en pause » change la question ; « Annuler » ; puis on bloque pour de bon.
    await P.clic('a-bloquer'); await P.clic('k-plutot');
    assert.match(P.q('.sa-garde')!.textContent, /^Mettre en pause « Telephone 1 »/); assert.deepEqual(P.q('.sa-garde')!.querySelectorAll('button').map((b) => b.textContent), ['Mettre en pause « Telephone 1 »', 'Annuler']);
    await P.clic('k-non'); assert.equal(P.actif(), P.f('a-pause'));
    await P.clic('a-bloquer'); await P.clic('k-ok');
    assert.deepEqual(P.ecrit().at(-1), { action: 'dhcp_mac_etat', input: { mac: M.tel, etat: 'bloque', nom: 'Telephone 1' }, confirm: true });
    assert.equal(P.etats()[M.tel], 'bloque');
    const res = P.q('.sa-res')!; assert.equal(res.attrs.role, 'status');
    assert.match(res.textContent, /^⛔ Telephone 1 bloqué\.\nCe qui est fait :\n- Le DHCP d'Odin ne lui répond plus/);
    assert.match(P.f(`row:${M.tel}`)!.textContent, new RegExp(`bloqué · lâche son adresse au plus tard ${QD}$`));
    assert.equal(P.qa('.sa-stat')[3].textContent, 'Bloqués ou en pause1');
    assert.equal(P.actif(), P.f('a-debloquer'), 'le clavier arrive sur « Débloquer »');
    assert.equal(P.f(`connu:${M.tel}`), null, 'bloqué : il n\'est plus dans la bannière');
    await P.clic('fil:bloq'); assert.deepEqual(P.lignes(), [M.tel]); await P.clic('fil:tout');
    // Débloquer : pas de question, c'est rendu tout de suite.
    await P.clic('a-debloquer');
    assert.deepEqual(P.ecrit().at(-1), { action: 'dhcp_mac_etat', input: { mac: M.tel, etat: 'actif', nom: 'Telephone 1' }, confirm: true });
    assert.equal(P.etats()[M.tel], 'actif'); assert.match(P.q('.sa-res')!.textContent, /Telephone 1 réactivé \(débloqué\)/); assert.ok(P.f('a-bloquer'));
    // La box : verrouillée, aucun bouton pour la bloquer.
    await P.clic('retour'); assert.equal(P.actif(), P.f(`row:${M.tel}`), 'retour à la liste : le clavier revient sur la ligne');
    await P.clic(`row:${M.box}`);
    assert.match(fiche().textContent, /C'est la box : la passerelle de toute la maisonIl ne peut être ni bloqué ni mis en pause : le couper priverait tout le réseau\./);
    assert.equal(P.f('a-bloquer'), null); assert.equal(P.f('a-pause'), null);
    // Tout ce qui se touche est un vrai bouton, un champ ou une liste.
    for (const n of P.qa('[data-f]')) assert.ok(['BUTTON', 'INPUT', 'SELECT'].includes(n.tagName), n.attrs['data-f']);
  } finally { P.fin(); }
});

test('R2 · page : « Je le connais », le nom de l\'appareil, et la relecture en direct', async () => {
  const P = await page();
  try {
    await P.clic(`connu:${M.piege}`);
    assert.deepEqual(P.ecrit().at(-1), { action: 'dhcp_approuver', input: { mac: M.piege, nom: '' }, confirm: false });
    assert.equal(P.f(`connu:${M.piege}`), null); assert.match(P.q('.sa-ban')!.textContent, /Un nouvel appareil sur le réseau de la maison/);
    assert.equal(P.qa('.sa-stat')[2].textContent, 'Nouveaux, inconnus1');
    // Dans la fiche : lui donner un nom.
    await P.clic(`row:${M.tel}`);
    assert.equal(P.f('nom')!.attrs['aria-label'], 'Nom de l\'appareil');
    await P.saisir('nom', 'Téléphone d\'Awa');
    const avant = P.appels.length; await P.tic(); assert.equal(P.appels.length, avant, 'en direct : rien ne bouge pendant que l\'on tape');
    await P.clic('nom-ok');
    assert.deepEqual(P.ecrit().at(-1), { action: 'dhcp_approuver', input: { mac: M.tel, nom: 'Téléphone d\'Awa' }, confirm: false });
    assert.match(P.f(`row:${M.tel}`)!.textContent, /^Téléphone d'AwaTéléphone · 02:00:5e:00:53:14/);
    assert.equal(P.q('.sa-ban'), null, 'plus aucun nouvel appareil : la bannière part');
    // En direct : 11 minutes sans signe, la page le montre toute seule.
    P.avance(11 * 60_000); await P.tic();
    assert.match(P.f(`row:${M.pc}`)!.textContent, new RegExp(`vu ${QD}$`)); assert.equal(P.qa('.sa-stat')[0].textContent, 'Connectés maintenant0');
  } finally { P.fin(); }
});

test('R2 · page : l\'appareil que l\'on tient — avertissement clair, et il faut le dire', async () => {
  let depuis = ''; const P = await page({ depuis: () => depuis });
  try {
    depuis = P.ips[M.pc]; await P.tic();
    assert.match(P.f(`row:${M.pc}`)!.textContent, /PC du bureauton appareil/);
    await P.clic(`row:${M.pc}`);
    assert.match(P.q('aside.sa-fiche')!.textContent, /C'est l'appareil que tu tiens en ce moment\./);
    await P.clic('a-bloquer');
    const g = P.q('.sa-garde')!;
    assert.match(g.textContent, /C'est l'appareil que tu tiens en ce moment : tu vas te couper d'Odin, et tu ne pourras plus revenir en arrière depuis cet appareil\./);
    assert.deepEqual(g.querySelectorAll('button').map((b) => b.textContent), ['C\'est mon appareil, bloquer quand même', 'Plutôt en pause', 'Annuler']);
    assert.equal(P.etats()[M.pc], 'actif', 'rien n\'est fait');
    await P.clic('k-ok');
    assert.deepEqual(P.ecrit().at(-1), { action: 'dhcp_mac_etat', input: { mac: M.pc, etat: 'bloque', nom: 'PC du bureau', le_mien: true }, confirm: true });
    assert.equal(P.etats()[M.pc], 'bloque');
    // Un autre appareil, depuis le PC : pas d'avertissement « Odin ne sait pas » (il sait), pas de « mon appareil ».
    await P.clic('a-debloquer'); await P.clic('retour'); await P.clic(`row:${M.tel}`); await P.clic('a-bloquer');
    assert.doesNotMatch(P.q('.sa-garde')!.textContent, /Odin ne sait pas depuis quel appareil|que tu tiens en ce moment/);
    assert.equal(P.f('k-ok')!.textContent, 'Bloquer « Telephone 1 »');
  } finally { P.fin(); }
});

test('R2 · page : un membre ne voit que son appareil et aucun geste ; la box distribue : la page le dit', async () => {
  let depuis = ''; const P = await page({ membre: true, depuis: () => depuis });
  try {
    assert.deepEqual(P.lignes(), [], 'sans origine connue : rien');
    assert.match(P.q('.sa-note')!.textContent, /Ce que tu voisOdin ne reconnaît pas l'appareil que tu tiens : il n'a rien à te montrer\./);
    depuis = P.ips[M.tel]; await P.tic();
    assert.deepEqual(P.lignes(), [M.tel]);
    assert.match(P.q('.sa-note')!.textContent, /Tu ne vois que l'appareil que tu tiens en ce moment\./);
    assert.doesNotMatch(P.texte(), /PC du bureau|00:00:5e:00:53/, 'rien des appareils des autres');
    assert.equal(P.q('.sa-ban'), null, 'pas de bannière pour un membre');
    await P.clic(`row:${M.tel}`);
    assert.match(P.q('aside.sa-fiche')!.textContent, /Bloquer, mettre en pause et débloquer : le propriétaire seul\./);
    for (const k of ['a-bloquer', 'a-pause', 'a-debloquer', 'nom', 'nom-ok']) assert.equal(P.f(k), null, k);
    assert.deepEqual(P.ecrit(), []);
  } finally { P.fin(); }
  const B = await page({ allume: false });
  try {
    assert.match(B.q('.sa-note')!.textContent, /La box distribue les adressesOdin montre ici les appareils qu'il a déjà servis\. Tant que la box distribue les adresses, il ne peut ni retirer une adresse ni sortir un appareil du réseau/);
    assert.deepEqual(B.lignes(), [M.box]);
  } finally { B.fin(); }
});

// ------------------------------------------------------------------ relecture en adversaire
test('R2 · page (relecture) : nommer un appareil bloqué ne le débloque pas ; l\'avertissement n\'est dit qu\'une fois ; le DNS de la maison est verrouillé', async () => {
  const P = await page();
  try {
    await P.clic(`row:${M.tel}`); await P.clic('a-bloquer');
    const g = P.q('.sa-garde')!;
    assert.equal(g.textContent.split('Odin ne sait pas depuis quel appareil tu agis').length - 1, 1, 'l\'avertissement une seule fois (celui de la page, en gras)');
    assert.match(g.querySelector('b.sa-gt')!.textContent, /^Bloquer « Telephone 1 » \(02:00:5e:00:53:14\) : il n'obtient plus d'adresse et il est retiré du réseau \?$/);
    await P.clic('k-ok'); assert.equal(P.etats()[M.tel], 'bloque');
    // Dans la fiche d'un appareil bloqué, « Enregistrer le nom » garde le blocage, et la page le dit.
    await P.saisir('nom', 'Intrus'); await P.clic('nom-ok');
    assert.equal(P.etats()[M.tel], 'bloque', 'toujours bloqué');
    assert.match(P.q('.sa-res')!.textContent, /Nom enregistré : Intrus\. Il reste bloqué/);
    assert.match(P.f(`row:${M.tel}`)!.textContent, /^Intrus/); assert.ok(P.f('a-debloquer'), '« Débloquer » est toujours là');
    // Le serveur DNS de la maison (une autre machine) : verrouillé comme la box.
    const c = P.v.ctx('vidarr'), macDns = '00:00:5e:00:53:c1';
    c.saveSettings({ dhcp: { ...(c.settings.dhcp as DhcpConfig), dns: ['192.0.2.53'], fixed: [{ mac: M.box, ip: BOX, name: 'Box internet' }, { mac: macDns, ip: '192.0.2.53', name: 'Pi DNS' }] } });
    await P.tic(); await P.clic('retour'); await P.clic(`row:${macDns}`);
    assert.match(P.q('aside.sa-fiche')!.textContent, /C'est le serveur DNS de la maison : celui qu'Odin donne à tous les appareilsIl ne peut être ni bloqué ni mis en pause/);
    assert.equal(P.f('a-bloquer'), null); assert.equal(P.f('a-pause'), null);
  } finally { P.fin(); }
});
