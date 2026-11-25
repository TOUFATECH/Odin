// Sphinx · Journal, Blocage, Serveurs DNS (la page) : les trois onglets à leur place après « Noms (DNS) » ; le journal en
// direct (chiffres, filtres, une machine), toucher une ligne → le geste proposé par le serveur (bloquer, autoriser ; pour un
// site dangereux « Voir la machine » d'abord et la question du serveur dans la page) ; tester un nom ; les listes en
// interrupteurs ; tes règles ; les serveurs (« Tout seul, depuis la racine » conseillé, choisi en un geste) ; au clavier ;
// un membre ne voit que ses lignes, sans geste. La page est montée dans un document minimal et parle au VRAI Sphinx
// (Valhalla, dossiers temporaires) ; le DNS d'essai n'écoute que sur 127.0.0.1 ; Internet (racine, domaines) est SIMULÉ
// en mémoire, le secours aussi (aucune question vers un serveur public), et la prise du serveur d'adresses aussi : aucun
// paquet ne sort. Adresses et noms de documentation.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import vm from 'node:vm';
import { MSG, buildPacket, parsePacket, type DhcpConfig, type Packet } from '../src/valhalla/vidarr/dhcp.ts';
import { LOCAL, origineDemande } from '../src/valhalla/vidarr/appareils.ts';
import { AMONT_RACINE, AMONT_SECOURS, PRISE_DHCP, dhcpServer, dnsServer, vidarr } from '../src/valhalla/modules/vidarr.ts';
import { RCODE, TYPE, parse, query, rdata, respond, type Answer, type Message } from '../src/valhalla/vidarr/wire.ts';
import { Valhalla } from '../src/valhalla/service.ts';
import { auNomDe, setVerificateur } from '../src/valhalla/sso/acces.ts';

const lire = (n: string) => readFileSync(new URL(`../src/web/pages/${n}`, import.meta.url), 'utf8');
// Comme le serveur d'Odin : les fichiers des pages chargés dans l'ordre de leur nom.
const FICHIERS = ['sphinx-appareils.js', 'sphinx-dns.js', 'sphinx-noms.js', 'sphinx-plan.js', 'sphinx-reglages.js'];
const BOX = '192.0.2.1', ODIN = '192.0.2.2';
const M = { odin: '00:00:5e:00:53:02', pc: '00:00:5e:00:53:23', tel: '02:00:5e:00:53:14' };
const dossiers: string[] = [], PRISE = PRISE_DHCP.ecouter, MACS = LOCAL.macs;
const odins: Valhalla[] = [];
after(() => { for (const v of odins) v.stop(); PRISE_DHCP.ecouter = PRISE; LOCAL.macs = MACS; AMONT_RACINE.essai = undefined; AMONT_SECOURS.essai = undefined; for (const d of dossiers) rmSync(d, { recursive: true, force: true }); });

// ------------------------------------------------------------------ Internet simulé (racine → .test → site.test)
const A = (n: string, ip: string): Answer => ({ name: n, type: TYPE.A, ttl: 300, data: rdata.a(ip) });
const renvoi = (q: Message, z: string, ns: string, ip: string) => respond(q, { ns: [{ name: z, type: TYPE.NS, ttl: 3600, data: rdata.name(ns) }], ar: [A(ns, ip)], ra: false });
const ZONES: Record<string, (q: Message) => Buffer> = {
  '192.0.2.250': (q) => (q.qd[0].name.endsWith('.test') ? renvoi(q, 'test', 'ns.nic.test', '198.51.100.1') : respond(q, { rcode: RCODE.NXDOMAIN, aa: true, ra: false })),
  // « muet.test » : délégué à un serveur que personne ne fait répondre (la racine ne mène à personne : le secours répond).
  '198.51.100.1': (q) => (q.qd[0].name.endsWith('site.test') ? renvoi(q, 'site.test', 'ns1.site.test', '198.51.100.2') : q.qd[0].name.endsWith('muet.test') ? renvoi(q, 'muet.test', 'ns.muet.test', '198.51.100.7') : respond(q, { rcode: RCODE.NXDOMAIN, aa: true, ra: false })),
  '198.51.100.2': (q) => (q.qd[0].type === TYPE.A ? respond(q, { an: [A(q.qd[0].name, '198.51.100.61')], aa: true, ra: false }) : respond(q, { aa: true, ra: false })),
};
const RACINE = { roots: [{ host: '192.0.2.250', port: 53 }], ask: async (b: Buffer, h: string) => { const f = ZONES[h]; if (!f) throw new Error('aucun réseau'); return f(parse(b)); } };
/** Le secours simulé : il répond à tout (une adresse de documentation). Aucun paquet. */
const SECOURS = async (_raw: Buffer, q: Message, serveurs: string[]) => ({ raw: respond(q, { an: [A(q.qd[0].name, '198.51.100.81')], ra: true }), upstream: serveurs[0] });

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
  click() { return this.emettre('click'); }
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
const calme = async () => { for (let k = 0; k < 40; k++) await new Promise((ok) => setTimeout(ok, 3)); };
const paquet = (mac: string, type: number, o: { nom?: string; veut?: string } = {}) => buildPacket({ op: 1, xid: 7, mac, options: [[53, Buffer.from([type])], ...(o.nom !== undefined ? [[12, Buffer.from(o.nom, 'utf8')] as [number, Buffer]] : []), ...(o.veut ? [[50, Buffer.from(o.veut.split('.').map(Number))] as [number, Buffer]] : [])] });

/** La page de Sphinx (ses fichiers) montée, reliée au vrai Sphinx ; ses demandes notées ; quelques questions déjà posées au DNS. */
async function page(o: { membre?: boolean; depuis?: () => string } = {}) {
  const home = mkdtempSync(join(tmpdir(), 'sphinx-dns-p-')); dossiers.push(home);
  const envois: Packet[] = []; const now = Date.now();
  PRISE_DHCP.ecouter = async (d) => { (d as unknown as { sock: unknown }).sock = { send: (b: Buffer) => { envois.push(parsePacket(b)); }, close: () => {} }; };
  LOCAL.macs = () => [M.odin]; setVerificateur(() => undefined); AMONT_RACINE.essai = RACINE; AMONT_SECOURS.essai = SECOURS;
  const v = new Valhalla(home, [vidarr()], { run: async () => ({ code: 1, out: '', err: '' }), fetch: (async () => { throw new Error('aucun réseau'); }) as never, notify: async () => {}, autonomy: () => 'equilibre', now: () => new Date(now) } as never);
  odins.push(v); const ctx = v.ctx('vidarr');
  const cfg: DhcpConfig = { server: ODIN, start: '192.0.2.100', end: '192.0.2.199', mask: '255.255.255.0', router: BOX, dns: [ODIN], leaseSeconds: 12 * 3600, domain: 'maison', fixed: [] };
  ctx.saveSettings({ dhcp: cfg, listen: ['127.0.0.1'] });
  mkdirSync(join(ctx.dir, 'listes'), { recursive: true });
  writeFileSync(join(ctx.dir, 'listes', 'pubs.txt'), '||annonces.example^\n'); writeFileSync(join(ctx.dir, 'listes', 'menaces.txt'), '0.0.0.0 hamecon.example\n');
  const ips: Record<string, string> = {};
  assert.equal((await v.act('vidarr', 'dhcp_demarrer', { forcer: true })).ok !== false, true);
  const prend = (mac: string, nom: string) => { const n = envois.length; dhcpServer()!.onMessage(paquet(mac, MSG.DISCOVER, { nom })); const ip = envois[n].yiaddr; dhcpServer()!.onMessage(paquet(mac, MSG.REQUEST, { nom, veut: ip })); ips[mac] = ip; };
  prend(M.pc, 'PC-SALLE'); prend(M.tel, 'Telephone-Nour');
  assert.equal((await v.act('vidarr', 'demarrer', { port: 0 })).ok, true);
  assert.equal((await v.act('vidarr', 'nom_local', { nom: 'disque.maison', valeur: '192.0.2.40', sorte: 'a' })).ok, true);
  const demande = (nom: string, ip: string) => dnsServer()!.handle(query(nom, TYPE.A, { id: 9 }), ip);
  for (const n of ['www.site.test', 'annonces.example', 'hamecon.example', 'disque.maison']) await demande(n, ips[M.pc]);
  await demande('autre.site.test', ips[M.tel]);
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
  const vctx = { window, document, Date, setInterval: (f: () => unknown) => { rythmes.push(f); return rythmes.length; }, clearInterval: () => {}, fetch };
  vm.createContext(vctx);
  for (const n of FICHIERS) vm.runInContext(lire(n), vctx);
  const host = new Noeud('div'); corps.append(host);
  const generique = new Noeud('section'); generique.append(new Texte('PAGE GÉNÉRIQUE'));
  await window.OdinPages.vidarr({ host, generic: [generique] });
  await calme();
  const qa = (s: string) => corps.querySelectorAll(s).filter((n) => n.visible), q = (s: string) => qa(s)[0] ?? null;
  const f = (cle: string) => q(`[data-f="${cle}"]`);
  const clic = async (cle: string) => { const n = f(cle); assert.ok(n, `élément « ${cle} »`); assert.equal(n.disabled, false, `« ${cle} » n'est pas grisé`); await n.emettre('click'); await calme(); };
  const saisir = async (cle: string, val: string) => { const n = f(cle)!; assert.ok(n, `champ « ${cle} »`); n.value = val; await n.emettre('input', { target: n }); await calme(); };
  const touche = async (cle: string, key: string) => { const n = f(cle)!; n.focus(); await n.emettre('keydown', { key }); await calme(); };
  const onglet = async (id: string) => { const n = q(`#sa-tab-${id}`)!; assert.ok(n, `onglet ${id}`); await n.emettre('click'); await calme(); };
  const tic = async () => { for (const g of rythmes) await g(); await calme(); };
  const lignes = () => qa('button.sd-row');
  const ligne = (nom: string) => lignes().find((b) => b.textContent.includes(nom)) ?? null;
  const ecrit = () => appels.filter((a) => !['baux_vus', 'plan_adresses', 'dhcp_etat', 'noms_vus', 'dns_vu', 'tester'].includes(a.action));
  const dns = () => v.ctx('vidarr').settings.dns as Record<string, any>;
  const fin = () => { v.stop(); PRISE_DHCP.ecouter = PRISE; LOCAL.macs = MACS; AMONT_RACINE.essai = undefined; AMONT_SECOURS.essai = undefined; };
  return { v, corps, q, qa, f, clic, saisir, touche, onglet, tic, lignes, ligne, appels, ecrit, dns, ips, demande, fin, actif: () => actif, texte: () => corps.textContent };
}

test('Journal · page : les trois onglets après « Noms (DNS) » ; les chiffres, qui demande quoi, la réponse, le temps ; filtres ; une machine', async () => {
  const P = await page();
  try {
    assert.deepEqual(P.qa('[role="tab"]').filter((b) => b.id.startsWith('sa-tab-')).map((b) => b.textContent), ['Appareils (DHCP)', 'Adresses fixes', 'Réglages DHCP', 'Noms (DNS)', 'Journal', 'Blocage', 'Serveurs DNS', 'Tout']);
    await P.onglet('journal');
    assert.equal(P.q('#sa-tab-journal')!.attrs['aria-selected'], 'true');
    const stats = P.qa('.sa-stat').map((s) => s.textContent);
    assert.ok(stats[0].startsWith('Questions aujourd\'hui') && stats[1].startsWith('Bloquées') && stats[2].startsWith('Machines qui demandent') && stats[3].startsWith('Réponse moyenne'), stats.join(' | '));
    assert.match(P.texte(), /Qui demande quoien direct/);
    const www = P.ligne('www.site.test')!, pub = P.ligne('annonces.example')!, piege = P.ligne('hamecon.example')!, disque = P.ligne('disque.maison')!;
    assert.ok(www && pub && piege && disque, P.lignes().map((l) => l.textContent).join(' | '));
    assert.match(www.textContent, /PC-SALLE/); assert.match(www.textContent, /198\.51\.100\.61/); assert.match(www.textContent, /\d+ ms$/);
    assert.match(pub.textContent, /bloqué · Pubs et pisteurs/); assert.match(piege.textContent, /bloqué · Sites dangereux/);
    assert.match(disque.textContent, /192\.0\.2\.40maison$/, 'un nom de la maison : « maison » au lieu du temps');
    assert.equal(www.attrs['aria-expanded'], 'false');
    // Filtres : « Bloqués », puis « Noms de la maison », puis une machine.
    await P.clic('f:bloque'); assert.equal(P.f('f:bloque')!.attrs['aria-pressed'], 'true');
    assert.ok(P.lignes().length >= 2 && P.lignes().every((l) => /bloqué/.test(l.textContent)));
    await P.clic('f:maison'); assert.ok(P.lignes().length >= 1 && P.lignes().every((l) => /maison/.test(l.textContent)));
    await P.clic('f:tout');
    const choix = P.f('j-machine')!; choix.value = P.ips[M.tel]; await choix.emettre('change', { target: choix }); await P.tic();
    assert.ok(P.lignes().length >= 1 && P.lignes().every((l) => /Telephone-Nour/.test(l.textContent)), P.lignes().map((l) => l.textContent).join(' | '));
    assert.equal(P.appels.filter((a) => a.action === 'dns_vu').at(-1)!.input.machine, P.ips[M.tel]);
    // En direct : une nouvelle question arrive à la relecture.
    await P.demande('neuf.site.test', P.ips[M.tel]); await P.tic();
    assert.ok(P.ligne('neuf.site.test'), 'la nouvelle question apparaît');
    assert.deepEqual(P.ecrit(), [], 'regarder n\'écrit rien');
    assert.ok(!crees.includes('SCRIPT') && !crees.includes('IMG'));
    const src = lire('sphinx-dns.js');
    assert.doesNotMatch(src, /innerHTML|insertAdjacentHTML|outerHTML|document\.write/); assert.doesNotMatch(src, /[\u2028\u2029\r]/);
  } finally { P.fin(); }
});

test('Journal · page : toucher une ligne → le geste du serveur ; un site dangereux : « Voir la machine » d\'abord, et la question dans la page', async () => {
  const P = await page();
  try {
    await P.onglet('journal');
    // Une ligne qui passe : « Bloquer ce nom ».
    await P.ligne('www.site.test')!.emettre('click'); await new Promise((ok) => setTimeout(ok, 20));
    assert.equal(P.ligne('www.site.test')!.attrs['aria-expanded'], 'true');
    assert.ok(P.f('a-bloquer') && P.f('a-voir') && !P.f('a-autoriser'));
    await P.clic('a-bloquer');
    assert.deepEqual(P.appels.filter((a) => a.action === 'bloquer').map((a) => [a.input.domaine, a.confirm]), [['www.site.test', false]]);
    assert.deepEqual(P.dns().custom, ['||www.site.test^']);
    assert.match(P.texte(), /www\.site\.test et ses sous-domaines sont bloqués/);
    // Une pub bloquée : « Autoriser ce nom » (sans question).
    await P.ligne('annonces.example')!.emettre('click'); await new Promise((ok) => setTimeout(ok, 20));
    assert.ok(P.f('a-autoriser')); assert.equal(P.f('a-autoriser')!.className.includes('pri'), true);
    await P.clic('a-autoriser'); assert.ok(P.dns().custom.includes('@@||annonces.example^'));
    // Un site dangereux : le premier bouton est « Voir la machine » (mis en avant), puis « Autoriser quand même ».
    await P.ligne('hamecon.example')!.emettre('click'); await new Promise((ok) => setTimeout(ok, 20));
    const acts = P.q('.sd-act')!.tous().filter((b) => b.classList.contains('sa-btn')).map((b) => b.getAttribute('data-f'));
    assert.deepEqual(acts.slice(0, 2), ['a-voir', 'a-autoriser']); assert.ok(P.f('a-voir')!.className.includes('pri'));
    assert.match(P.texte(), /Site dangereux : la liste « Sites dangereux \(virus, hameçonnage\) » le bloque/);
    assert.match(P.f('a-autoriser')!.textContent, /Autoriser quand même/);
    await P.clic('a-autoriser');
    const alerte = P.q('[role="alert"]')!; assert.ok(alerte, 'la question du serveur'); assert.match(alerte.textContent, /dangereux/);
    assert.equal(P.dns().custom.includes('@@||hamecon.example^'), false, 'rien sans « oui »');
    assert.equal(P.actif()?.getAttribute('data-f'), 'q-non', 'le curseur va sur « Annuler »');
    await P.clic('q-non'); assert.equal(P.q('[role="alert"]'), null);
    await P.clic('a-autoriser'); await P.clic('q-ok');
    assert.deepEqual(P.appels.filter((a) => a.action === 'autoriser' && a.input.domaine === 'hamecon.example').map((a) => a.confirm), [false, false, true]);
    assert.ok(P.dns().custom.includes('@@||hamecon.example^'));
    // « Voir la machine » : l'écran Appareils s'ouvre sur la fiche de la machine.
    await P.ligne('disque.maison')!.emettre('click'); await new Promise((ok) => setTimeout(ok, 20));
    assert.match(P.texte(), /Nom de la maison : il se change dans « Noms \(DNS\) »/);
    await P.clic('a-voir');
    assert.equal(P.q('#sa-tab-appareils')!.attrs['aria-selected'], 'true');
    assert.equal(P.q(`[data-f="row:${M.pc}"]`)!.attrs['aria-current'], 'true', 'la fiche de PC-SALLE est ouverte');
  } finally { P.fin(); }
});

test('Blocage · page : tester un nom (la raison, la réponse, le geste) ; les listes en interrupteurs ; la pause ; tes règles', async () => {
  const P = await page();
  try {
    await P.onglet('blocage');
    await P.saisir('t-nom', 'annonces.example'); await P.touche('t-nom', 'Enter');
    assert.deepEqual(P.appels.filter((a) => a.action === 'tester').map((a) => a.input.domaine), ['annonces.example']);
    const r = P.q('.sd-teste')!; assert.ok(r); assert.match(r.textContent, /annonces\.example est bloqué/); assert.match(r.textContent, /Pubs et pisteurs/); assert.match(r.textContent, /Odin répond : 0\.0\.0\.0/);
    await P.clic('t-autoriser'); assert.ok(P.dns().custom.includes('@@||annonces.example^'));
    assert.match(P.q('.sd-teste')!.textContent, /annonces\.example passe/, 'testé de nouveau après le geste');
    await P.saisir('t-nom', 'café.example'); await P.clic('t-ok');
    assert.match(P.q('.sd-teste')!.textContent, /café\.example passe/); assert.match(P.q('.sd-teste')!.textContent, /xn--caf-dma\.example/);
    // Les listes : de vrais interrupteurs.
    const sw = P.f('sw:pubs')!; assert.deepEqual([sw.attrs.role, sw.attrs['aria-checked'], sw.attrs['aria-labelledby']], ['switch', 'true', 'sd-l-pubs']);
    await P.clic('sw:pubs');
    assert.deepEqual(P.appels.filter((a) => a.action === 'activer_liste').map((a) => a.input), [{ id: 'pubs', active: false }]);
    assert.equal(P.f('sw:pubs')!.attrs['aria-checked'], 'false');
    // La pause : 5 minutes, puis reprendre.
    await P.clic('l-pause'); assert.match(P.texte(), /Blocage en pause jusqu'à \d\d:\d\d\. Les sites dangereux restent bloqués\./);
    await P.clic('l-pause'); assert.deepEqual(P.appels.filter((a) => a.action === 'pause' || a.action === 'reprendre').map((a) => a.action), ['pause', 'reprendre']);
    // Tes règles : bloquer, autoriser, retirer.
    await P.saisir('g-nom', 'arcade.example'); await P.clic('g-bloquer');
    assert.ok(P.dns().custom.includes('||arcade.example^')); assert.equal(P.f('g-nom')!.value, '', 'le champ se vide');
    assert.ok(P.qa('li.sd-regle').some((l) => l.textContent.startsWith('arcade.example')));
    await P.clic('r:||arcade.example^'); assert.equal(P.dns().custom.includes('||arcade.example^'), false);
    assert.deepEqual(P.appels.filter((a) => a.action === 'retirer_regle').map((a) => a.input.regle), ['||arcade.example^']);
  } finally { P.fin(); }
});

test('Serveurs · page : « Tout seul, depuis la racine » conseillé et choisi ; la box ; des serveurs chiffrés ; au clavier ; le DNS chiffré, le cache', async () => {
  const P = await page();
  try {
    await P.onglet('amont');
    const carte = (id: string) => P.f(`c:${id}`)!;
    assert.deepEqual(['racine', 'chiffre', 'box'].map((k) => carte(k).attrs['aria-checked']), ['true', 'false', 'false']);
    assert.equal(carte('racine').attrs.role, 'radio'); assert.match(carte('racine').textContent, /^Conseillé/);
    assert.equal(P.q('[role="radiogroup"]')!.attrs['aria-label'], 'Serveurs en amont');
    // Au clavier : la flèche passe d'une carte à l'autre sans rien changer.
    await P.touche('c:racine', 'ArrowRight'); assert.equal(P.actif()?.getAttribute('data-f'), 'c:chiffre'); assert.deepEqual(P.ecrit(), []);
    await P.clic('c:box');
    assert.deepEqual(P.appels.filter((a) => a.action === 'reglages').map((a) => a.input), [{ amont: BOX }]);
    assert.equal(carte('box').attrs['aria-checked'], 'true'); assert.deepEqual(P.dns().upstreams, [BOX]);
    await P.clic('c:chiffre'); assert.equal(P.actif()?.getAttribute('data-f'), 's-liste');
    await P.saisir('s-liste', 'pas un serveur !'); await P.clic('s-ok');
    assert.ok(P.qa('.sa-res').some((n) => n.classList.contains('non')), 'refusé, dit en clair'); assert.deepEqual(P.dns().upstreams, [BOX]);
    await P.saisir('s-liste', 'https://dns.example/dns-query, tls://198.51.100.71'); await P.clic('s-ok');
    assert.equal(carte('chiffre').attrs['aria-checked'], 'true'); assert.deepEqual(P.dns().upstreams, ['https://dns.example/dns-query', 'tls://198.51.100.71']);
    await P.clic('st:ordre'); assert.equal(P.dns().strategy, 'ordre');
    await P.clic('c:racine'); assert.deepEqual([P.dns().upstreams, P.dns().fallback], [['récursif'], ['9.9.9.9', '1.1.1.1']], 'choisir la racine garde le secours');
    assert.equal(carte('racine').attrs['aria-checked'], 'true');
    // Temps de réponse, DNS chiffré (impossible sans le HTTPS de l'interface), cache, noms de la maison.
    assert.match(P.texte(), /Temps de réponse/); assert.match(P.texte(), /Racine d'Internet/);
    assert.equal(P.f('sw:dot')!.disabled, true); assert.match(P.texte(), /Il faut d'abord le HTTPS de l'interface/);
    await P.clic('rg-vider'); assert.ok(P.appels.some((a) => a.action === 'vider_cache'));
    assert.match(P.texte(), /Les noms « \.maison » ne sortent jamais/);
  } finally { P.fin(); }
});

test('Membre · page : seulement les questions de son appareil, sans geste ; Blocage : tester seulement ; Serveurs : la limite', async () => {
  let ici = '';
  const P = await page({ membre: true, depuis: () => ici });
  try {
    ici = P.ips[M.tel];
    await P.onglet('journal');
    assert.match(P.texte(), /Tu ne vois que les questions posées par l'appareil que tu tiens/);
    assert.ok(P.lignes().length >= 1 && P.lignes().every((l) => /Telephone-Nour/.test(l.textContent)), P.lignes().map((l) => l.textContent).join(' | '));
    await P.lignes()[0].emettre('click'); await new Promise((ok) => setTimeout(ok, 20));
    assert.equal(P.f('a-bloquer'), null); assert.equal(P.f('a-autoriser'), null); assert.equal(P.f('a-voir'), null);
    await P.onglet('blocage'); assert.match(P.texte(), /Le blocage \(listes, règles, pause\) et les serveurs du DNS sont au propriétaire seul/);
    assert.equal(P.f('sw:pubs'), null); assert.equal(P.f('g-nom'), null); assert.ok(P.f('t-nom'), 'tester reste possible');
    await P.saisir('t-nom', 'annonces.example'); await P.clic('t-ok'); assert.match(P.q('.sd-teste')!.textContent, /est bloqué/); assert.equal(P.f('t-autoriser'), null);
    await P.onglet('amont'); assert.equal(P.f('c:racine'), null); assert.match(P.texte(), /au propriétaire seul/);
    assert.deepEqual(P.ecrit(), [], 'un membre n\'a rien écrit');
  } finally { P.fin(); }
});

// ------------------------------------------------------------------ après relecture (affichage)
test('Page · après relecture : un site dangereux n\'est jamais le bouton mis en avant ; machine inconnue dite ; « cache » ; « 1 nom » ; listes', async () => {
  const P = await page();
  try {
    // Une machine qu'Odin ne connaît pas (aucune fiche) demande un site dangereux ; le PC repose une question (servie par le cache).
    await P.demande('hamecon.example', '192.0.2.170'); await P.demande('www.site.test', P.ips[M.pc]);
    await P.onglet('journal');
    assert.match(P.ligne('www.site.test')!.textContent, /cache$/, 'une réponse gardée en mémoire : « cache » dans la colonne Temps');
    const inconnue = P.lignes().find((l) => l.textContent.includes('hamecon.example') && l.textContent.includes('192.0.2.170'))!;
    assert.ok(inconnue); await inconnue.emettre('click'); await new Promise((ok) => setTimeout(ok, 20));
    assert.equal(P.f('a-voir'), null, 'pas de fiche à ouvrir');
    assert.match(P.q('.sd-act')!.textContent, /Odin ne connaît pas cette machine \(192\.0\.2\.170\)/);
    assert.equal(P.f('a-autoriser')!.className.includes('pri'), false);
    // Tester un site dangereux : « L'autoriser quand même » n'est pas mis en avant.
    await P.onglet('blocage');
    await P.saisir('t-nom', 'hamecon.example'); await P.clic('t-ok');
    assert.match(P.f('t-autoriser')!.textContent, /quand même/); assert.equal(P.f('t-autoriser')!.className.includes('pri'), false);
    // Les listes : « 1 nom » au singulier ; une erreur de téléchargement dite en mots, pas brute.
    assert.match(P.texte(), /Pubs et pisteurs(?:(?!Sites).)*\b1 nom\b(?!s)/);
    await P.clic('l-maj'); if (P.f('q-ok')) await P.clic('q-ok');
    assert.match(P.texte(), /Le dernier téléchargement n'a pas abouti/); assert.ok(P.qa('.sd-opt').every((o) => !/aucun réseau/.test(o.textContent)), 'sous les listes : pas l\'erreur brute');
    // Les pubs des réseaux : un interrupteur (les plateformes laissées de côté sont gardées).
    const sw = P.f('sw:pubs-reseaux')!; assert.ok(sw); assert.equal(sw.attrs['aria-checked'], 'true');
    await P.clic('sw:pubs-reseaux');
    assert.deepEqual(P.appels.filter((a) => a.action === 'pubs_reseaux').map((a) => a.input), [{ actif: false, sauf: '' }]);
    assert.equal(P.f('sw:pubs-reseaux')!.attrs['aria-checked'], 'false');
    // Un nom autorisé dit quelle liste le bloquait.
    await P.saisir('g-nom', 'annonces.example'); await P.clic('g-autoriser');
    assert.match(P.qa('li.sd-regle').find((l) => l.textContent.startsWith('annonces.example'))!.textContent, /était dans « Pubs et pisteurs »/);
    // La source : pas de langue écrite en dur, pas de raccourci « font » invalide, « Conseillé » à la couleur d'accent.
    const src = lire('sphinx-dns.js');
    assert.doesNotMatch(src, /fr-FR/);
    assert.doesNotMatch(src, /font:\s*(?:\d{3}\s+)?[\d.]+px\s+inherit/);
    assert.match(src, /\.sd-conseil\{[^}]*background:var\(--accent\)/);
  } finally { P.fin(); }
});

// ------------------------------------------------------------------ le secours (choix du propriétaire, 25/11)
test('Serveurs · page : « La racine d\'abord ; si elle ne répond pas, Odin demande à … » ; « Racine seule (sans secours) » ; le compte du jour', async () => {
  const P = await page();
  try {
    await P.onglet('amont');
    assert.match(P.texte(), /La racine d'abord ; si elle ne répond pas, Odin demande à 9\.9\.9\.9, 1\.1\.1\.1\./);
    assert.match(P.texte(), /Le secours n'a pas servi aujourd'hui\./);
    assert.match(P.f('s-seule')!.textContent, /^Racine seule \(sans secours\)$/);
    // La racine ne mène à personne pour ce nom : le secours répond, et l'onglet le compte.
    await P.demande('www.muet.test', P.ips[M.pc]); await P.tic();
    assert.match(P.texte(), /Le secours a servi 1 fois aujourd'hui \(à \d\d:\d\d\)\./);
    // « Racine seule » : plus de secours, dit en clair, et de quoi le remettre.
    await P.clic('s-seule');
    assert.deepEqual(P.appels.filter((a) => a.action === 'reglages').map((a) => a.input), [{ secours: false }]);
    assert.deepEqual([P.dns().upstreams, P.dns().fallback], [['récursif'], []]);
    assert.match(P.texte(), /Racine seule : si la racine ne répond pas, la maison n'a plus Internet jusqu'à son retour\./);
    assert.equal(P.f('s-seule'), null);
    assert.match(P.f('s-secours')!.textContent, /^Remettre le secours \(9\.9\.9\.9, 1\.1\.1\.1\)$/);
    await P.clic('s-secours'); assert.deepEqual(P.dns().fallback, ['9.9.9.9', '1.1.1.1']);
    assert.ok(P.f('s-seule'));
  } finally { P.fin(); }
});
