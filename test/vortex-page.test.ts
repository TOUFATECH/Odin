// Vortex · Appareils et tunnel, lot R7 (la page) : les appareils du VPN en cartes (nom, dernière connexion, depuis où,
// trafic), « Couper » / « Rouvrir l'accès », « Retirer » avec le garde-fou DANS la carte (« Seulement couper », l'appareil
// que tu tiens, l'origine inconnue), le tunnel (allumé, port, adresse de la maison), l'adresse relue sur la box ou écrite
// à la main (un refus ne part jamais), au clavier. La page est montée dans un document minimal et parle au VRAI Vortex
// (Valhalla, dossiers temporaires) ; le moteur du tunnel, la box (UPnP), les commandes et Internet sont SIMULÉS : aucune
// commande wg, ip ou nft, aucun paquet. Adresses d'exemple : 198.51.100.x, 203.0.113.x ; maison en 10.0.0.x.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import vm from 'node:vm';
import { BOX, VU, gjoll, keypair, type Peer, type Server } from '../src/valhalla/modules/gjoll.ts';
import type { EnDirect } from '../src/valhalla/gjoll/vue.ts';
import type { Flow } from '../src/valhalla/wireguard/engine.ts';
import { Valhalla } from '../src/valhalla/service.ts';
import { auNomDe, setVerificateur } from '../src/valhalla/sso/acces.ts';
import { origineDemande } from '../src/valhalla/vidarr/appareils.ts';

const SOURCE = readFileSync(new URL('../src/web/pages/vortex.js', import.meta.url), 'utf8');
const MIN = 60_000, T0 = Date.now(), MAISON = '10.0.0.50', DEHORS = '198.51.100.23', PIEGE = '<img src=x onerror=alert(1)>Tel';
const ORIGINE = { ...VU }, BOITE = { ...BOX }, dossiers: string[] = [];
after(() => { Object.assign(VU, ORIGINE); Object.assign(BOX, BOITE); for (const d of dossiers) rmSync(d, { recursive: true, force: true }); });

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
const flux = (device: string, up: number, down: number): Flow => ({ device, deviceIp: '10.8.0.2', proto: 'TCP', remote: '203.0.113.80', port: 443, up, down, pkUp: 1, pkDown: 1, first: T0, last: T0 });

/** La page de Vortex montée, reliée au vrai Vortex ; ses demandes notées. `origine` : d'où vient le navigateur (« '' » : inconnue). */
async function page(o: { membre?: boolean; origine?: string; piege?: boolean } = {}) {
  const home = mkdtempSync(join(tmpdir(), 'vortex-r7p-')); dossiers.push(home);
  const S = { now: T0, allume: true, origine: o.origine ?? MAISON, direct: new Map<string, EnDirect>(), flux: [] as Flow[], box: (async () => { throw new Error('aucune box ne répond en UPnP'); }) as () => Promise<{ ip: string; nom: string }>, appelsBox: 0, sorties: [] as string[], commandes: [] as string[], portes: [] as string[], passerelle: '10.0.0.1', repondeur: '10.0.0.1' };
  VU.allume = () => S.allume; VU.direct = () => S.direct; VU.flux = () => S.flux;
  // La passerelle connue de la machine, et l'appareil qui répond à la place de la box (le même : c'est bien la box).
  BOX.passerelle = async () => S.passerelle;
  BOX.adresse = async () => { S.appelsBox++; return { hote: S.repondeur, ...(await S.box()) }; };
  BOX.ouvrir = (async (ports: Array<{ port: number; proto: string }>) => { S.portes.push(`ouvrir ${ports.map((p) => `${p.port}/${p.proto}`).join(',')}`); return { gw: { host: S.repondeur }, ip: '203.0.113.7', cgnat: false, lease: 0, text: 'Box : port ouvert vers Odin (essai).' }; }) as never;
  BOX.fermer = (async (ports: Array<{ port: number; proto: string }>) => { S.portes.push(`fermer ${ports.map((p) => `${p.port}/${p.proto}`).join(',')}`); return 'Box : port refermé (essai).'; }) as never;
  setVerificateur(() => undefined);
  const v = new Valhalla(home, [gjoll], {
    run: async (c: string, a: string[]) => { S.commandes.push(`${c} ${a.join(' ')}`); return { code: 1, out: '', err: '' }; },
    fetch: (async (u: unknown) => { S.sorties.push(String(u)); throw new Error('aucun réseau dans les essais'); }) as never,
    notify: async () => {}, autonomy: () => 'equilibre', now: () => new Date(S.now),
  } as never);
  const g = v.ctx('gjoll');
  g.saveSettings({ on: false, server: { ...keypair(), net: '10.8.0', port: 51820, endpoint: '[ADRESSE PUBLIQUE OU DOMAINE]', dns: '10.0.0.2', iface: 'wg-essai', lan: ['10.0.0.0/24'], nat: 'aucun' } });
  const pairs = () => (g.settings.peers as Peer[] | undefined) ?? [], pair = (nom: string) => pairs().find((p) => p.name === nom)!;
  for (const [nom, plus] of [['Téléphone 1', {}], ['Portable 1', { tout: false }], ['Invité', { tout: false, fin: '2099-12-31' }]] as Array<[string, Record<string, unknown>]>) assert.equal((await v.act('gjoll', 'ajouter', { nom, dns_odin: false, ...plus })).ok, true);
  if (o.piege) g.saveSettings({ peers: [...pairs(), { name: PIEGE, ...keypair(), psk: pair('Invité').psk, ip: '10.8.0.9', created: '', enabled: true, full: true }] });
  if (o.membre) g.saveSettings({ peers: pairs().map((p) => (p.name === 'Portable 1' ? { ...p, compte: 'nour' } : p)), server: { ...(g.settings.server as Server), endpoint: '203.0.113.7' }, adresseSource: 'box' });
  S.direct.set(pair('Téléphone 1').pub, { handshake: S.now - 12_000, rx: 1, tx: 2, endpoint: `${DEHORS}:40123` });
  S.direct.set(pair('Portable 1').pub, { handshake: S.now - 3 * 24 * 60 * MIN, rx: 0, tx: 0, endpoint: '10.0.0.77:5' });
  S.flux = [flux('Téléphone 1', 180 * 1024 * 1024, 1288490188), flux('Portable 1', 42, 310)];
  const mod = v.module('gjoll')!;
  racine = new Noeud('html'); actif = null; crees.length = 0;
  const tete = new Noeud('head'), corps = new Noeud('body'); racine.append(tete, corps);
  const document = { head: tete, body: corps, hidden: false, get activeElement() { return actif; }, createElement: (t: string) => new Noeud(t), createElementNS: (_n: string, t: string) => new Noeud(t), createTextNode: (t: string) => new Texte(t), getElementById: (i: string) => racine.querySelector(`#${i}`) };
  const appels: Array<{ action: string; input: Record<string, unknown>; confirm: boolean }> = [];
  const nour = { login: 'nour', name: 'Nour', groups: ['famille'] };
  const repondre = async (b: { module: string; action: string; input: Record<string, unknown>; confirm?: boolean }) => {
    if (b.module !== 'gjoll') return { ok: false, text: 'refusé par l\'essai' };
    const a = mod.actions.find((x) => x.id === b.action);
    // Comme la porte web : d'où vient la demande, la règle « propriétaire seul », puis la confirmation des actions graves.
    const lancer = () => origineDemande.run(S.origine, async () => {
      const regle = a?.proprietaireSeul, seul = typeof regle === 'function' ? regle(b.input, v.ctx('gjoll')) : regle === true;
      if (o.membre && seul) return { ok: false, text: `${mod.name} · ${a?.label} : seul le propriétaire le règle lui-même.` };
      const why = a?.grave?.(b.input, v.ctx('gjoll')); if (why && !b.confirm) return { ok: false, confirm: `Confirmer : ${why} ?` };
      return v.act('gjoll', b.action, b.input);
    });
    return o.membre ? auNomDe(nour, lancer) : lancer();
  };
  const fetch = async (_u: string, op: { body: string }) => { const b = JSON.parse(op.body); appels.push({ action: b.action, input: b.input, confirm: Boolean(b.confirm) }); const r = await repondre(b); return { json: async () => JSON.parse(JSON.stringify(r)) }; };
  const window: Record<string, any> = {}; const rythmes: Array<() => unknown> = [];
  const ctx = { window, document, Date, setInterval: (f: () => unknown) => { rythmes.push(f); return rythmes.length; }, clearInterval: () => {}, fetch };
  vm.createContext(ctx); vm.runInContext(SOURCE, ctx);
  const host = new Noeud('div'); corps.append(host);
  const generique = new Noeud('section'); generique.append(new Texte('PAGE GÉNÉRIQUE'));
  const rendu = await window.OdinPages.gjoll({ host, generic: [generique] });
  await calme();
  const qa = (s: string) => corps.querySelectorAll(s).filter((n) => n.visible), q = (s: string) => qa(s)[0] ?? null;
  const f = (cle: string) => q(`[data-f="${cle}"]`);
  const clic = async (cle: string) => { const n = f(cle); assert.ok(n, `élément « ${cle} »`); assert.equal(n.disabled, false, `« ${cle} » n'est pas grisé`); await n.emettre('click'); await calme(); };
  const saisir = async (cle: string, val: string) => { const n = f(cle)!; assert.ok(n, `champ « ${cle} »`); n.value = val; await n.emettre('input', { target: n }); await calme(); };
  const onglet = async (id: string) => { const n = q(`#vx-tab-${id}`)!; assert.ok(n, `onglet ${id}`); await n.emettre('click'); await calme(); };
  const tic = async () => { for (const r of rythmes) await r(); await calme(); };
  const ecrit = () => appels.filter((a) => a.action !== 'appareils_vus').map((a) => `${a.action}${a.confirm ? ' (accord)' : ''}`);
  const cartes = () => qa('article').map((c) => c.textContent);
  const carte = (nom: string) => qa('article').find((c) => c.attrs['aria-label'] === `Appareil ${nom}`)!;
  const secrets = () => [...pairs().flatMap((p) => [p.priv ?? '', p.psk, p.pub]), (g.settings.server as Server).priv].filter((x) => x.length > 20);
  const fin = () => { v.stop(); Object.assign(VU, ORIGINE); Object.assign(BOX, BOITE); };
  return { v, g, S, window, corps, rendu, q, qa, f, clic, saisir, onglet, tic, appels, ecrit, cartes, carte, pairs, pair, secrets, fin, actif: () => actif, texte: () => corps.textContent, garde: () => q('.vx-garde'), ips: () => Object.fromEntries(pairs().map((p) => [p.name, p.ip])) };
}

test('R7 · page : les onglets ; chaque appareil en carte (dernière connexion, depuis où, trafic) ; aucune clé ; un nom est du texte, jamais du HTML', async () => {
  const P = await page({ piege: true });
  try {
    assert.equal(P.rendu, true);
    assert.deepEqual(P.qa('[role="tab"]').map((b) => [b.textContent, b.attrs['aria-selected'], b.attrs.tabindex]), [['Appareils', 'true', '0'], ['Tunnel', 'false', '-1'], ['Tout', 'false', '-1']]);
    assert.equal(P.q('[role="tablist"]')!.attrs['aria-label'], 'Écrans de Vortex'); assert.equal(P.q('[role="tabpanel"]')!.attrs['aria-labelledby'], 'vx-tab-appareils');
    // Le tunnel : allumé, mais l'adresse de la maison n'est pas encore connue.
    const sw = P.f('tunnel')!;
    assert.deepEqual([sw.tagName, sw.attrs.role, sw.attrs['aria-checked'], sw.attrs['aria-label']], ['BUTTON', 'switch', 'true', 'Tunnel allumé']);
    assert.match(P.texte(), /Tunnel alluméL'adresse de la maison n'est pas encore connue : va dans « Tunnel »\./);
    assert.deepEqual(P.qa('.vx-stat').map((n) => n.textContent), ['Connectés maintenant1', 'Appareils4', 'Accès coupés0', 'Trafic aujourd\'hui1,4 Go']);
    assert.match(P.texte(), /Toi seul \(propriétaire\) peux couper, rouvrir ou retirer un appareil\. Les clés des appareils ne sont jamais montrées ici\./);
    // Les cartes.
    const c = P.cartes();
    assert.equal(c.length, 4);
    assert.match(c[0], /^Téléphone 1connecté maintenantAdresse dans le VPN10\.8\.0\.2Dernière connexionmaintenantDepuis198\.51\.100\.23 \(hors de la maison\)Trafic aujourd'huireçu 1,2 Go · envoyé 180 MoAccèstout passe par la maisonFin de l'accèsjamaisCouperRetirer$/);
    assert.match(c[1], /^Portable 1pas connectéAdresse dans le VPN10\.8\.0\.3Dernière connexionil y a 3 joursDepuis10\.0\.0\.77 \(réseau de la maison\)Trafic aujourd'huireçu 310 o · envoyé 42 oAccèsla maison seulementFin de l'accèsjamaisCouperRetirer$/);
    assert.match(c[2], /^Invitéjamais connectéAdresse dans le VPN10\.8\.0\.4Dernière connexionjamaisDepuis—.*Accèsla maison seulementFin de l'accèsle 31\/12\/2099CouperRetirer$/);
    assert.match(c[3], /^img src=x onerror=alert\(1\)Teljamais connecté/);
    assert.equal(P.q('[role="tabpanel"]')!.querySelector('ul')!.attrs['aria-label'], 'Les appareils du VPN');
    assert.deepEqual(P.qa('article').map((a) => a.querySelector('h3')!.textContent), ['Téléphone 1', 'Portable 1', 'Invité', 'img src=x onerror=alert(1)Tel']);
    // Chaque bouton nomme son appareil (au lecteur d'écran aussi).
    assert.deepEqual([P.f('couper:10.8.0.2')!.attrs['aria-label'], P.f('retirer:10.8.0.3')!.attrs['aria-label']], ['Couper : Téléphone 1', 'Retirer : Portable 1']);
    // Un nom venu d'ailleurs ne devient jamais une balise ; aucune clé nulle part dans la page.
    assert.equal(crees.some((t) => ['IMG', 'SCRIPT', 'IFRAME'].includes(t)), false); assert.doesNotMatch(P.texte(), /[<>]/);
    for (const s of P.secrets()) assert.equal(P.texte().includes(s), false, 'aucune clé à l\'écran');
    for (const a of P.appels) assert.equal(a.action, 'appareils_vus', 'regarder ne demande que la lecture');
    assert.doesNotMatch(SOURCE, /innerHTML|insertAdjacentHTML|outerHTML|document\.write/, 'la page n\'écrit jamais de HTML');
    assert.doesNotMatch(SOURCE, new RegExp(`[${String.fromCharCode(0x2028, 0x2029, 13)}]`), 'ni séparateur de ligne Unicode, ni retour chariot');
    assert.doesNotMatch(SOURCE, /https?:\/\/(?!www\.w3\.org\/2000\/svg)/, 'la page ne parle à aucun site');
    // En direct : relu toutes les 5 secondes ; si rien n'a changé la page n'est pas redessinée, un changement se voit.
    { const avant = P.q('article'), n = P.appels.length; await P.tic(); assert.equal(P.appels.length, n + 1); assert.equal(P.q('article'), avant, 'rien de nouveau : pas redessinée');
      P.S.direct.delete(P.pair('Téléphone 1').pub); await P.tic(); assert.notEqual(P.q('article'), avant); assert.match(P.cartes()[0], /^Téléphone 1jamais connecté/); }
    // « Tout » : la page générique reste là ; au clavier, les flèches passent d'un onglet à l'autre.
    await P.q('#vx-tab-appareils')!.emettre('keydown', { key: 'ArrowLeft' }); await calme();
    assert.equal(P.actif()?.id, 'vx-tab-tout'); assert.match(P.texte(), /PAGE GÉNÉRIQUE/); assert.equal(P.qa('article').length, 0);
    await P.actif()!.emettre('keydown', { key: 'Home' }); await calme(); assert.equal(P.actif()?.id, 'vx-tab-appareils'); assert.equal(P.qa('article').length, 4);
    // « Ajouter un appareil » : tant que l'écran du lot suivant n'est pas là, il mène à la page complète (son formulaire y est).
    await P.clic('ajouter'); assert.equal(P.q('#vx-tab-tout')!.attrs['aria-selected'], 'true');
    assert.deepEqual(P.ecrit(), []); assert.deepEqual([P.S.sorties, P.S.appelsBox], [[], 0]);
  } finally { P.fin(); }
});

test('R7 · page : « Couper » d\'un clic depuis la maison (réversible), « Rouvrir l\'accès » ; rien d\'autre ne bouge', async () => {
  const P = await page();
  try {
    await P.clic('couper:10.8.0.3');
    assert.deepEqual(P.ecrit(), ['activer']); assert.deepEqual(P.appels.find((a) => a.action === 'activer')!.input, { nom: 'Portable 1', actif: false });
    assert.deepEqual(P.pairs().map((p) => [p.name, p.enabled]), [['Téléphone 1', true], ['Portable 1', false], ['Invité', true]]);
    const c = P.carte('Portable 1');
    assert.match(c.textContent, /^Portable 1accès coupé/); assert.equal(c.classList.contains('coupe'), true); assert.match(c.textContent, /Rouvrir l'accèsRetirer⏸ Désactivé : Portable 1/);
    assert.equal(c.querySelector('.vx-res')!.attrs.role, 'status'); assert.equal(P.actif()?.attrs['data-f'], 'rouvrir:10.8.0.3', 'le clavier arrive sur « Rouvrir l\'accès »');
    assert.equal(P.f('couper:10.8.0.3'), null); assert.deepEqual(P.qa('.vx-stat').map((n) => n.textContent)[2], 'Accès coupés1');
    await P.clic('rouvrir:10.8.0.3');
    assert.deepEqual(P.ecrit(), ['activer', 'activer (accord)']); assert.equal(P.pair('Portable 1').enabled, true);
    assert.match(P.carte('Portable 1').textContent, /^Portable 1pas connecté.*CouperRetirer✅ Réactivé : Portable 1/); assert.equal(P.actif()?.attrs['data-f'], 'couper:10.8.0.3');
    assert.equal(P.pair('Portable 1').priv!.length > 20, true, 'sa clé n\'a jamais bougé');
  } finally { P.fin(); }
});

test('R7 · page : « Retirer » — le garde-fou dans la carte nomme l\'appareil ; Échap et « Annuler » ne font rien ; « Seulement couper » ; « Retirer pour toujours »', async () => {
  const P = await page();
  try {
    await P.clic('retirer:10.8.0.3');
    let g = P.garde()!;
    assert.deepEqual([g.attrs.role, g.attrs['aria-live']], ['alert', 'assertive']);
    assert.equal(g.textContent, 'Retirer « Portable 1 » du VPN ?Sa clé ne vaudra plus rien : il ne pourra plus jamais se connecter avec son QR code ni son fichier. Pour revenir, il faudra l\'ajouter de nouveau.Retirer pour toujoursSeulement couperAnnuler');
    assert.equal(P.carte('Portable 1').querySelector('.vx-garde'), g, 'le garde-fou est dans la carte de l\'appareil');
    assert.equal(P.actif()?.attrs['data-f'], 'k-non', 'le clavier arrive sur « Annuler »');
    assert.deepEqual(P.ecrit(), ['revoquer'], 'la question est posée, rien n\'est parti avec ton accord'); assert.equal(P.pairs().length, 3);
    // En direct : la page ne bouge pas sous le garde-fou.
    const avant = P.appels.length; await P.tic(); assert.equal(P.appels.length, avant); assert.ok(P.garde());
    // Échap : fermé, le clavier revient sur « Retirer ».
    await P.actif()!.emettre('keydown', { key: 'Escape' }); await calme();
    assert.equal(P.garde(), null); assert.equal(P.actif()?.attrs['data-f'], 'retirer:10.8.0.3'); assert.equal(P.pairs().length, 3);
    // « Seulement couper » : coupé, pas retiré.
    await P.clic('retirer:10.8.0.3'); await P.clic('k-plutot');
    assert.deepEqual(P.pairs().map((p) => [p.name, p.enabled]), [['Téléphone 1', true], ['Portable 1', false], ['Invité', true]]); assert.equal(P.garde(), null);
    assert.deepEqual(P.ecrit(), ['revoquer', 'revoquer', 'activer (accord)']);
    // Déjà coupé : « Seulement couper » n'est plus proposé. « Retirer pour toujours » : parti avec ton accord, la carte disparaît.
    await P.clic('retirer:10.8.0.3'); g = P.garde()!;
    assert.equal(P.f('k-plutot'), null); assert.match(g.textContent, /Retirer pour toujoursAnnuler$/);
    const cle = P.pair('Portable 1').pub;
    await P.clic('k-ok');
    assert.deepEqual(P.ecrit().slice(-2), ['revoquer', 'revoquer (accord)']); assert.deepEqual(P.appels.at(-2)!.input, { nom: 'Portable 1' });
    assert.deepEqual(P.pairs().map((p) => p.name), ['Téléphone 1', 'Invité']); assert.equal(JSON.stringify(P.g.settings).includes(cle), false);
    assert.equal(P.qa('article').length, 2); assert.match(P.texte(), /🗝 Accès de Portable 1 révoqué : sa clé ne vaut plus rien\./);
    assert.equal(P.actif()?.attrs['data-f'], 'ajouter', 'sa carte n\'existe plus : le clavier va sur « Ajouter un appareil »');
    assert.equal(P.S.commandes.some((x) => /^(wg|nft|iptables)\b/.test(x)), false); assert.deepEqual(P.S.sorties, []);
  } finally { P.fin(); }
});

test('R7 · page : l\'appareil que tu tiens — marqué « ton appareil » ; le couper ou le retirer demande de le dire en clair', async () => {
  const P = await page({ origine: '10.8.0.2' });
  try {
    assert.match(P.carte('Téléphone 1').textContent, /^Téléphone 1ton appareilconnecté maintenant/); assert.doesNotMatch(P.carte('Portable 1').textContent, /ton appareil/);
    await P.clic('couper:10.8.0.2');
    let g = P.garde()!;
    assert.equal(g.attrs.role, 'alert');
    assert.equal(g.textContent, 'Couper « Téléphone 1 » ?C\'est l\'appareil que tu tiens en ce moment : tu vas te couper d\'Odin, et tu ne pourras pas revenir en arrière depuis cet appareil.Il ne pourra plus se connecter à la maison. Tu pourras rouvrir son accès à tout moment : sa clé est gardée.C\'est mon appareil, couper quand mêmeAnnuler');
    assert.equal(g.querySelector('.vx-fort')!.textContent.startsWith('C\'est l\'appareil que tu tiens'), true);
    assert.deepEqual(P.ecrit(), ['activer']); assert.equal(P.pair('Téléphone 1').enabled, true, 'rien n\'est coupé');
    await P.clic('k-non'); assert.equal(P.garde(), null); assert.equal(P.actif()?.attrs['data-f'], 'couper:10.8.0.2');
    // Retirer : même avertissement ; « Seulement couper » repasse par la question du « couper ».
    await P.clic('retirer:10.8.0.2'); g = P.garde()!;
    assert.match(g.textContent, /^Retirer « Téléphone 1 » du VPN \?C'est l'appareil que tu tiens en ce moment.*C'est mon appareil, retirer quand mêmeSeulement couperAnnuler$/);
    await P.clic('k-plutot'); g = P.garde()!;
    assert.match(g.textContent, /^Couper « Téléphone 1 » \?C'est l'appareil que tu tiens/); assert.equal(P.pair('Téléphone 1').enabled, true);
    // Dit en clair : c'est fait, et le serveur l'a reçu tel quel.
    await P.clic('k-ok');
    assert.deepEqual(P.appels.at(-2)!, { action: 'activer', input: { nom: 'Téléphone 1', actif: false, le_mien: true }, confirm: true });
    assert.equal(P.pair('Téléphone 1').enabled, false); assert.equal(P.pairs().length, 3);
    // L'autre appareil se coupe sans histoire : ce n'est pas celui que tu tiens.
    await P.clic('couper:10.8.0.3'); assert.equal(P.garde(), null); assert.equal(P.pair('Portable 1').enabled, false);
  } finally { P.fin(); }
});

test('R7 · page : origine inconnue (derrière un proxy) — couper ou retirer prévient toujours ; éteindre le tunnel aussi', async () => {
  const P = await page({ origine: '' });
  try {
    await P.clic('couper:10.8.0.3');
    let g = P.garde()!;
    assert.equal(g.textContent, 'Couper « Portable 1 » ?Odin ne sait pas depuis quel appareil tu agis. Si « Portable 1 » est celui que tu tiens, tu perds Odin avec lui.Il ne pourra plus se connecter à la maison. Tu pourras rouvrir son accès à tout moment : sa clé est gardée.Couper « Portable 1 »Annuler');
    assert.equal(P.pair('Portable 1').enabled, true);
    await P.clic('k-ok'); assert.equal(P.pair('Portable 1').enabled, false); assert.deepEqual(P.ecrit(), ['activer', 'activer (accord)']); assert.equal('le_mien' in P.appels.at(-2)!.input, false);
    await P.clic('retirer:10.8.0.4'); g = P.garde()!;
    assert.match(g.textContent, /^Retirer « Invité » du VPN \?Odin ne sait pas depuis quel appareil tu agis\. Si « Invité » est celui que tu tiens, tu perds Odin avec lui\./);
    // « Seulement couper », origine inconnue : la question du « couper » d'abord.
    await P.clic('k-plutot'); assert.match(P.garde()!.textContent, /^Couper « Invité » \?Odin ne sait pas/); assert.equal(P.pair('Invité').enabled, true);
    await P.clic('k-non');
    // Éteindre le tunnel : redemandé, avec l'avertissement ; « Annuler » ne coupe rien.
    await P.clic('tunnel'); g = P.garde()!;
    assert.deepEqual([g.attrs.role, g.classList.contains('calme')], ['alert', false]);
    assert.equal(g.textContent, 'Éteindre le tunnel ?Le VPN est coupé pour tous les appareils, jusqu\'à ce que tu le rallumes.Odin ne sait pas depuis quel appareil tu agis : si tu passes par le VPN, tu perds Odin avec lui.Ce qu\'Odin va faireCouper le VPN pour tous les appareils.Éteindre le tunnelAnnuler');
    assert.equal(P.actif()?.attrs['data-f'], 'q-non'); assert.equal(P.f('tunnel')!.disabled, true, 'l\'interrupteur attend ta réponse');
    await P.actif()!.emettre('keydown', { key: 'Escape' }); await calme();
    assert.equal(P.garde(), null); assert.equal(P.actif()?.attrs['data-f'], 'tunnel'); assert.deepEqual(P.ecrit().slice(-1), ['eteindre'], 'jamais parti avec ton accord');
  } finally { P.fin(); }
});

test('R7 · page : « Tunnel » — l\'état, l\'adresse relue sur la box (muette : c\'est dit), écrite à la main (un refus ne part jamais), puis lue sur la box ; le port', async () => {
  const P = await page();
  try {
    await P.onglet('tunnel');
    assert.equal(P.q('[role="tabpanel"]')!.attrs['aria-labelledby'], 'vx-tab-tunnel');
    assert.match(P.texte(), /Le tunnelalluméL'éteindre coupe le VPN pour tous les appareils : Odin te le redemande\./);
    const faits = () => Object.fromEntries(P.q('dl')!.children.map((d) => [d.children[0].textContent, d.children[1].textContent]));
    assert.deepEqual(faits(), { 'Adresse de la maison sur Internet': 'pas encore connue', 'Dernière lecture sur la box': 'jamais faite', Port: '51820 (UDP)', 'Sur la box': 'pas ouvert par Odin', 'Adresses du VPN': '10.8.0.0/24', 'Réseau de la maison ouvert': '10.0.0.0/24', 'DNS donné aux appareils': '10.0.0.2' });
    assert.match(P.texte(), /Adresse de la maisonOdin la lit sur la box \(UPnP\)\. Aucun site extérieur n'est interrogé\. Si la box ne répond pas, écris l'adresse à la main, ou un nom de domaine\./);
    assert.match(P.texte(), /Comment c'est protégé, en mots simples/); assert.match(P.texte(), /La clé d'un appareil ne se voit qu'une fois, quand tu l'ajoutes\. Cette page ne la montre jamais\./); assert.match(P.texte(), /L'interface web du VPNC'est cette page\./);
    for (const s of P.secrets()) assert.equal(P.texte().includes(s), false, 'aucune clé à l\'écran');
    // La box ne répond pas : c'est dit, l'adresse reste à écrire à la main, et RIEN n'est demandé à Internet.
    await P.clic('lire');
    assert.deepEqual(P.ecrit(), ['detecter (accord)']); assert.equal(P.S.appelsBox, 1); assert.deepEqual(P.S.sorties, []);
    const res = P.q('.vx-res')!;
    assert.deepEqual([res.attrs.role, res.classList.contains('non')], ['status', true]);
    assert.match(res.textContent, /La box ne répond pas \(aucune box ne répond en UPnP\)\. Odin ne demande cette adresse à aucun site extérieur : écris-la à la main/);
    assert.match(faits()['Dernière lecture sur la box'], /^à \d\d:\d\d · La box ne répond pas/); assert.equal(faits()['Adresse de la maison sur Internet'], 'pas encore connue'); assert.equal(P.actif()?.attrs['data-f'], 'lire');
    // À la main : vérifié pendant la frappe ; mal écrit, « Enregistrer » est grisé et rien ne part.
    await P.clic('ecrire');
    const champ = P.f('adresse')!;
    assert.deepEqual([champ.tagName, champ.id, champ.attrs['aria-describedby'], P.q('label[for="vx-adresse"]')!.textContent], ['INPUT', 'vx-adresse', 'vx-verdict', 'Adresse ou nom de domaine']);
    assert.equal(P.actif(), champ); assert.equal(P.f('d-ok')!.disabled, true); assert.equal(P.q('#vx-verdict')!.textContent, 'Écris une adresse (203.0.113.7) ou un nom de domaine.');
    for (const faux of ['maison example', 'http://maison.example.org', '<b>', '198.51.100.20:51820', '...']) {
      await P.saisir('adresse', faux);
      assert.equal(P.f('d-ok')!.disabled, true, faux); assert.equal(P.q('#vx-verdict')!.textContent, 'Seulement des lettres, des chiffres, des points et des tirets, sans espace.'); assert.equal(P.q('#vx-verdict')!.classList.contains('bad'), true);
      await champ.emettre('keydown', { key: 'Enter' }); await calme();
    }
    assert.deepEqual(P.ecrit(), ['detecter (accord)'], 'un refus ne part jamais');
    const n = P.appels.length; await P.tic(); assert.equal(P.appels.length, n, 'rien ne bouge pendant que tu tapes');
    await P.saisir('adresse', ' 198.51.100.20 ');
    assert.equal(P.f('d-ok')!.disabled, false); assert.equal(P.q('#vx-verdict')!.textContent, 'Les appareils joindront 198.51.100.20, port 51820.');
    // « Enregistrer » : le serveur redemande (avant → après), dans la page.
    await P.clic('d-ok');
    let g = P.garde()!;
    assert.deepEqual([g.attrs.role, g.classList.contains('calme')], ['alert', true]);
    assert.equal(g.textContent, 'Changer l\'adresse de la maison ?Ce qu\'Odin va faireChanger l\'adresse publique du VPN de la maison : pas encore connue → 198.51.100.20:51820 (les appareils joindront la maison par 198.51.100.20:51820).Enregistrer cette adresseAnnuler');
    assert.equal((P.g.settings.server as Server).endpoint, '[ADRESSE PUBLIQUE OU DOMAINE]', 'rien n\'est changé avant ton accord');
    await P.clic('q-ok');
    assert.deepEqual(P.appels.at(-2)!, { action: 'adresse', input: { adresse: '198.51.100.20', port: 51820 }, confirm: true });
    assert.equal((P.g.settings.server as Server).endpoint, '198.51.100.20');
    assert.deepEqual([faits()['Adresse de la maison sur Internet'], faits()['Trouvée par']], ['198.51.100.20', 'toi (écrite à la main)']); assert.equal(P.actif()?.attrs['data-f'], 'ecrire');
    // Un autre appareil de la maison répond à la place de la box : rien n'est changé ; son adresse est seulement proposée
    // dans le champ, et l'enregistrer redemande (avant → après). Échap : rien n'est parti.
    P.S.repondeur = '10.0.0.66'; P.S.box = async () => ({ ip: '203.0.113.66', nom: '<b>Box</b>' });
    await P.clic('lire');
    assert.match(P.q('.vx-res')!.textContent, /^L'appareil 10\.0\.0\.66 du réseau \(« bBox\/b »\) dit que l'adresse de la maison est 203\.0\.113\.66, mais Odin ne peut pas vérifier que c'est bien ta box \(ta box est à 10\.0\.0\.1\)\. Rien n'est changé\./); assert.equal(P.q('.vx-res')!.classList.contains('non'), true);
    assert.equal((P.g.settings.server as Server).endpoint, '198.51.100.20', 'l\'adresse n\'a pas bougé');
    assert.deepEqual([faits()['Adresse de la maison sur Internet'], faits()['Trouvée par']], ['198.51.100.20', 'toi (écrite à la main)']); assert.match(faits()['Dernière lecture sur la box'], /ne peut pas vérifier que c'est bien ta box/);
    assert.equal(P.f('adresse')!.value, '203.0.113.66', 'proposée dans le champ, pas enregistrée'); assert.equal(P.actif(), P.f('adresse')); assert.equal(P.f('d-ok')!.disabled, false);
    await P.clic('d-ok');
    assert.match(P.garde()!.textContent, /Changer l'adresse publique du VPN de la maison : 198\.51\.100\.20:51820 → 203\.0\.113\.66:51820/); assert.equal((P.g.settings.server as Server).endpoint, '198.51.100.20', 'toujours rien sans ton accord');
    await P.clic('q-non'); assert.equal((P.g.settings.server as Server).endpoint, '198.51.100.20'); assert.deepEqual(P.ecrit().slice(-2), ['detecter (accord)', 'adresse']);
    // La box répond : l'adresse est lue sur elle (toujours sans Internet), et c'est dit.
    P.S.repondeur = '10.0.0.1'; P.S.box = async () => ({ ip: '203.0.113.7', nom: '<b>Box</b>' });
    await P.clic('lire');
    assert.match(P.q('.vx-res')!.textContent, /^🌍 Adresse de la maison lue sur la box « bBox\/b » : 203\.0\.113\.7 \(aucun site extérieur interrogé\)\..*Elle a changé \(avant : 198\.51\.100\.20\)/); assert.equal(P.q('.vx-res')!.classList.contains('non'), false);
    assert.deepEqual([faits()['Adresse de la maison sur Internet'], faits()['Trouvée par']], ['203.0.113.7', 'la box (sans service extérieur)']); assert.match(faits()['Dernière lecture sur la box'], /· Lue sur la box « bBox\/b » : 203\.0\.113\.7\.$/);
    assert.equal(crees.some((t) => ['IMG', 'SCRIPT', 'IFRAME'].includes(t)), false); assert.doesNotMatch(P.texte(), /[<>]/, 'ce que dit la box reste du texte, sans balise'); assert.deepEqual(P.S.sorties, []);
    // Échap dans le champ : fermé sans rien envoyer.
    await P.clic('ecrire'); assert.equal(P.f('adresse')!.value, '203.0.113.7'); await P.f('adresse')!.emettre('keydown', { key: 'Escape' }); await calme(); assert.equal(P.f('adresse'), null); assert.equal(P.actif()?.attrs['data-f'], 'ecrire');
    // Le port sur la box : redemandé (la box simulée), puis l'état le dit.
    await P.clic('port'); g = P.garde()!;
    assert.match(g.textContent, /^Ouvrir le port sur la box \?Ce qu'Odin va faireOuvrir le port 51820\/udp de la box vers cette machine \(UPnP\)/); assert.deepEqual(P.S.portes, []);
    await P.clic('q-ok'); assert.deepEqual(P.S.portes, ['ouvrir 51820/UDP']); assert.equal(faits()['Sur la box'], 'ouvert par Odin'); assert.equal(P.f('port')!.textContent, 'Fermer le port sur la box');
    await P.clic('port'); assert.deepEqual([P.garde()!.classList.contains('calme'), P.garde()!.textContent.startsWith('Fermer le port sur la box ?')], [false, true]); await P.clic('q-non'); assert.deepEqual(P.S.portes, ['ouvrir 51820/UDP']);
    assert.equal(P.S.commandes.some((x) => /^(wg|nft|iptables)\b/.test(x)), false);
  } finally { P.fin(); }
});

test('R7 · page : depuis la maison, éteindre le tunnel est redemandé sans alarme inutile ; par le VPN, l\'alarme est là', async () => {
  const P = await page();
  try {
    await P.onglet('tunnel'); await P.clic('tunnel');
    assert.equal(P.garde()!.textContent, 'Éteindre le tunnel ?Le VPN est coupé pour tous les appareils, jusqu\'à ce que tu le rallumes.Ce qu\'Odin va faireCouper le VPN pour tous les appareils.Éteindre le tunnelAnnuler');
    await P.clic('q-non');
    P.S.origine = '10.8.0.2'; await P.clic('tunnel');
    assert.match(P.garde()!.querySelector('.vx-fort')!.textContent, /^ATTENTION : tu passes par le VPN en ce moment, tu vas te couper d'Odin et tu ne pourras pas le rallumer de dehors\.$/);
    // Dit oui : le tunnel est éteint (le moteur simulé suit), la dernière connexion est gardée.
    await P.clic('q-ok'); P.S.allume = false; P.S.direct = new Map(); await P.tic();
    assert.deepEqual(P.ecrit(), ['eteindre', 'eteindre', 'eteindre (accord)']); assert.equal(P.g.settings.on, false);
    assert.equal(P.f('tunnel')!.attrs['aria-checked'], 'false'); assert.match(P.texte(), /Le tunneléteint/); assert.match(P.q('.vx-res')!.textContent, /Tunnel coupé/);
    await P.onglet('appareils');
    assert.match(P.texte(), /Tunnel éteint/); assert.match(P.carte('Téléphone 1').textContent, /^Téléphone 1ton appareilpas connectéAdresse dans le VPN10\.8\.0\.2Dernière connexion(à|hier à) \d\d:\d\dDepuis198\.51\.100\.23 \(hors de la maison\)/);
  } finally { P.fin(); }
});

test('R7 · page : un membre de la famille ne voit que ses appareils, aucun geste, rien du tunnel ni de l\'adresse de la maison', async () => {
  const P = await page({ membre: true });
  try {
    assert.match(P.texte(), /Ce que tu voisTu ne vois que les appareils du VPN rattachés à ton compte\./);
    assert.deepEqual(P.qa('article').map((a) => a.querySelector('h3')!.textContent), ['Portable 1']);
    assert.equal(P.qa('button').filter((b) => b.attrs.role !== 'tab').length, 0, 'aucun bouton de geste'); assert.equal(P.f('tunnel'), null);
    assert.match(P.texte(), /Tunnel allumé/); assert.doesNotMatch(P.texte(), /203\.0\.113\.7|Téléphone 1|Toi seul/);
    await P.onglet('tunnel');
    assert.match(P.texte(), /Ce que tu voisTu ne vois que les appareils du VPN rattachés à ton compte\./); assert.equal(P.q('dl'), null); assert.equal(P.qa('button').filter((b) => b.attrs.role !== 'tab').length, 0);
    assert.doesNotMatch(P.texte(), /203\.0\.113\.7|51820|10\.0\.0\.0/);
    assert.deepEqual(P.ecrit(), []);
  } finally { P.fin(); }
});
