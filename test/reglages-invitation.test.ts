// Réglages → Personnes : « Inviter quelqu'un de la famille ». Le lien d'invitation de Persona (action « inviter »,
// propriétaire seul, validée par lui) est proposé depuis les Réglages : rien de neuf côté serveur, même action, même
// garde, même validation. Deux parties :
// - la page, lue sans navigateur (comme test/menu-replie.test.ts) : le bouton est dans la carte « Personnes », caché
//   d'avance et caché à un membre, il passe par la validation, ne propose jamais « admin », ne garde le lien nulle part ;
//   ses petites fonctions pures (groupes, lecture de la page de Persona, lien « à la maison ») sont rejouées à part ;
// - un vrai Odin d'essai (dossier temporaire, port libre) : le propriétaire reçoit la demande de validation puis le lien
//   et le QR code, la liste des invitations en cours se lit dans la page de Persona, « Annuler » coupe le lien ; un
//   membre reçoit le refus qui existe déjà et aucune invitation n'est créée.

import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { T } from './banc/lib.ts';
import { vraiOdin, type VraiOdin } from './banc/odin-vrai.ts';
import { allModules, valhallaOf } from '../src/valhalla/odin.ts';
import { lierProprietaire, persona } from '../src/valhalla/sso/etat.ts';

const UI = readFileSync(new URL('../src/web/ui.html', import.meta.url), 'utf8');
const GUIDE = readFileSync(new URL('../src/web/guide.js', import.meta.url), 'utf8');

/** La carte « Personnes » des Réglages (de son <article> à sa fermeture). */
function carte(): string {
  const d = UI.indexOf('<article class="card" data-sec="personnes">');
  assert.ok(d > 0, 'carte « Personnes » des Réglages trouvée');
  return UI.slice(d, UI.indexOf('</article>', d));
}
/** Le script du bloc d'invitation (de son titre au bloc suivant). */
function script(): string {
  const d = UI.indexOf('// ---------- Personnes : inviter quelqu\'un de la famille ----------');
  assert.ok(d > 0, 'le script du bloc d\'invitation est dans la page');
  return UI.slice(d, UI.indexOf('// ---------- Sauvegarde ----------', d));
}
interface Fonctions {
  invMaisonSeule: (lien: string) => boolean;
  invGroupes: (ids: unknown[]) => { liste: string[]; defaut: string };
  invLire: (vue: unknown) => { groupes: string[]; enCours: Array<{ id: string; nom: string; groupes: string; jusqu: string }> };
}
/** Les fonctions pures du bloc, rejouées hors de la page (chacune tient sur une ligne). */
function fonctions(): Fonctions {
  const src = script(), out: Record<string, unknown> = {};
  for (const nom of ['invMaisonSeule', 'invGroupes', 'invLire']) {
    const l = new RegExp(`^\\s*const ${nom} = .*;$`, 'm').exec(src);
    assert.ok(l, `fonction ${nom} trouvée sur une ligne`);
    const f = vm.runInNewContext(`${l[0].trim().replace(/^const \w+ = /, '(').replace(/;$/, ')')}`, { URL }) as (x: unknown) => unknown;
    // Rendu recopié en JSON : les tableaux faits dans l'autre contexte n'ont pas le même prototype.
    out[nom] = (x: unknown) => JSON.parse(JSON.stringify(f(x)));
  }
  return out as unknown as Fonctions;
}

// ---------------------------------------------------------------- la page, sans navigateur
test('la carte « Personnes » des Réglages a le bouton « Inviter quelqu\'un de la famille », caché d\'avance', () => {
  const c = carte();
  const bloc = /<details class="field" id="p-inv"( hidden)?>[\s\S]*?<\/details>/.exec(c);
  assert.ok(bloc, 'le bloc d\'invitation est dans la carte « Personnes »');
  assert.ok(bloc[1], 'caché tant que l\'état ne dit pas que c\'est le propriétaire');
  assert.match(bloc[0], /<summary[^>]*>(?:<span[^>]*>▸<\/span>)?Inviter quelqu'un de la famille<\/summary>/);
  for (const id of ['p-inv-nom', 'p-inv-email', 'p-inv-jours', 'p-inv-groupe']) assert.match(bloc[0], new RegExp(`<label for="${id}">`), `champ ${id} avec son libellé`);
  assert.match(bloc[0], /id="p-inv-jours" type="number" min="1" max="30" value="7"/, 'durée : 1 à 30 jours, 7 d\'avance (comme Persona)');
  assert.match(bloc[0], /id="p-inv-go"/);
  assert.match(bloc[0], /id="p-inv-liste"/, 'la liste des invitations en cours');
  assert.match(bloc[0], /id="p-inv-persona"[^>]*>Ouvrir Persona</, 'un lien vers Persona, où arrive la personne');
  assert.match(bloc[0], /Persona/); assert.match(bloc[0], /Profil/);
  assert.doesNotMatch(bloc[0], /value="admin"|>admin</, 'jamais « admin » écrit d\'avance');
});

test('le bloc passe par l\'action existante de Persona et par la validation du propriétaire', () => {
  const s = script();
  assert.match(s, /api\('\/api\/valhalla\/act', \{ module: 'var', action, input/, 'l\'action de Persona, par /api/valhalla/act');
  assert.match(s, /invAct\('inviter', input\)/, 'd\'abord sans confirmation');
  assert.match(s, /if \(r\.confirm\) \{ if \(!\(await OdinDialog\.confirm\(r\.confirm\)\)\)/, 'la demande de validation est montrée');
  assert.match(s, /invAct\('inviter', input, true\)/, 'puis renvoyée confirmée');
  assert.match(s, /invAct\('annuler_invitation', \{ id: x\.id \}\)/, '« Annuler » d\'une invitation en cours');
  assert.match(s, /api\('\/api\/valhalla\/view\?id=var'\)/, 'les invitations sont lues dans la page de Persona (pas de seconde liste)');
  assert.match(s, /data:image\/svg\+xml;base64,/, 'le QR code en image (pas de HTML brut)');
  assert.match(UI, /inv\.hidden = !state \|\| Boolean\(state\.membre\)/, 'caché à un membre');
  // Le lien n'est montré qu'ici : jamais gardé dans le navigateur, ni écrit dans la console, ni en HTML brut.
  assert.doesNotMatch(s, /localStorage|sessionStorage|console\.|innerHTML|insertAdjacentHTML|notify|OdinNotices/);
  assert.match(GUIDE, /Inviter quelqu\\'un de la famille/, 'le guide de la mascotte le dit');
});

test('groupes proposés : jamais « admin » ; « famille » d\'avance s\'il existe, sinon le plus prudent', () => {
  const { invGroupes } = fonctions();
  assert.deepEqual(invGroupes(['famille', 'invite', 'bureau']), { liste: ['famille', 'invite', 'bureau'], defaut: 'famille' });
  assert.deepEqual(invGroupes(['admin', 'bureau', 'invite']), { liste: ['bureau', 'invite'], defaut: 'invite' });
  assert.deepEqual(invGroupes(['bureau']), { liste: ['bureau'], defaut: '' }, 'ni « famille » ni « invite » : rien d\'avance, le propriétaire choisit');
  assert.deepEqual(invGroupes(['admin']), { liste: ['famille'], defaut: 'famille' }, 'aucun autre groupe : « famille », que l\'invitation accepte toujours');
  assert.deepEqual(invGroupes([]), { liste: ['famille'], defaut: 'famille' });
  for (const l of [['admin'], ['admin', 'famille'], ['bureau', 'admin']]) assert.ok(!invGroupes(l).liste.includes('admin'));
});

test('une phrase dit si le lien ne s\'ouvrira qu\'à la maison', () => {
  const { invMaisonSeule } = fonctions();
  for (const l of ['http://192.168.1.20:8888/sso/invitation?j=x', 'https://10.0.0.5:8888/sso/invitation?j=x', 'http://172.20.3.4:8888/x', 'http://127.0.0.1:8888/x', 'http://localhost:8888/x', 'http://odin.local:8888/x', 'http://[fd00::5]:8888/x', 'http://odin:8888/x', 'pas une adresse'])
    assert.equal(invMaisonSeule(l), true, l);
  for (const l of ['https://odin.example.org/sso/invitation?j=x', 'https://198.51.100.7/sso/invitation?j=x'])
    assert.equal(invMaisonSeule(l), false, l);
  const s = script();
  assert.match(s, /invMaisonSeule\(lien\) \? INV_T\.maison : INV_T\.partout/);
});

// ---------------------------------------------------------------- le script du bloc, joué dans une page simulée
// Le script du bloc tourne tel quel dans un contexte à part, avec une petite page de remplacement : chaque élément
// qu'il cherche par son id, « el » qui fabrique des nœuds inspectables, et une fausse API qui répond comme Odin.
interface Noeud {
  tag: string; attrs: Record<string, unknown>; children: unknown[]; value: string; textContent: string;
  disabled: boolean; open: boolean; hidden: boolean; ecoute: Record<string, (e?: unknown) => unknown>;
  replaceChildren: (...c: unknown[]) => void; addEventListener: (t: string, f: (e?: unknown) => unknown) => void; select: () => void;
}
function noeud(tag: string, attrs: Record<string, unknown> = {}, enfants: unknown[] = []): Noeud {
  const n: Noeud = {
    tag, attrs, children: enfants.flat().filter((c) => c != null), value: String(attrs.value ?? ''), textContent: '', disabled: false, open: false, hidden: false, ecoute: {},
    replaceChildren: (...c) => { n.children = c.flat().filter((x) => x != null); }, addEventListener: (t, f) => { n.ecoute[t] = f; }, select: () => {},
  };
  return n;
}
/** Tous les nœuds sous un nœud (lui compris). */
const sous = (n: unknown): Noeud[] => (n && typeof n === 'object' && 'children' in n ? [n as Noeud, ...(n as Noeud).children.flatMap(sous)] : []);
const vide = (n: Noeud) => n.children.length === 0;
const flush = async () => { for (let k = 0; k < 8; k++) await new Promise((r) => setImmediate(r)); };
const LIEN = 'http://192.168.1.20:8888/sso/invitation?j=AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-AbCd';
/** La page de Persona, comme /api/valhalla/view?id=var la rend : des groupes et des invitations en cours. */
const vuePersona = (groupes: string[], invit: Array<{ id: string; nom: string }>) => ({
  ok: true, view: { sections: [
    { kind: 'table', rows: groupes.map((g) => ({ cells: [g], actions: g === 'admin' ? [] : [{ action: 'supprimer_groupe', input: { groupe: g } }] })) },
    { kind: 'table', rows: invit.map((x) => ({ cells: [x.nom, 'famille', '—', '25/11/2026', 'envoyée'], actions: [{ action: 'annuler_invitation', input: { id: x.id } }] })) },
  ] },
});
interface Banc {
  n: Record<string, Noeud>; statuts: Array<{ text: string; ok: unknown }>; appels: Array<{ action?: string; confirm?: boolean; input?: Record<string, unknown> }>;
  dialogues: string[]; etat: { groupes: string[]; invit: Array<{ id: string; nom: string }>; texte: string; panne: string };
  ouvrir: () => Promise<void>; fermer: () => Promise<void>; creer: (nom: string) => Promise<void>;
}
function banc(): Banc {
  const ids = ['p-inv', 'p-inv-fl', 'p-inv-nom', 'p-inv-email', 'p-inv-jours', 'p-inv-groupe', 'p-inv-go', 'p-inv-lien', 'p-inv-status', 'p-inv-liste', 'p-inv-persona'];
  const n: Record<string, Noeud> = {}; for (const id of ids) n[id] = noeud(id === 'p-inv' ? 'details' : 'div', {}, []);
  n['p-inv-jours'].value = '7'; n['p-inv-fl'].textContent = '▸';
  const b: Banc = {
    n, statuts: [], appels: [], dialogues: [], etat: { groupes: ['admin', 'famille', 'invite'], invit: [], texte: '✉ Invitation pour Nour (groupes famille, valable 7 jour(s)).', panne: '' },
    ouvrir: async () => { n['p-inv'].open = true; n['p-inv'].ecoute.toggle(); await flush(); },
    fermer: async () => { n['p-inv'].open = false; n['p-inv'].ecoute.toggle(); await flush(); },
    creer: async (nom) => { n['p-inv-nom'].value = nom; await n['p-inv-go'].ecoute.click(); await flush(); },
  };
  const api = async (chemin: string, corps?: { action?: string; confirm?: boolean; input?: Record<string, unknown> }) => {
    await new Promise((r) => setImmediate(r));
    if (chemin.startsWith('/api/valhalla/view')) return vuePersona(b.etat.groupes, b.etat.invit);
    b.appels.push(corps!);
    if (b.etat.panne === corps!.action) throw new Error('réseau coupé');
    if (corps!.action === 'annuler_invitation') { b.etat.invit = b.etat.invit.filter((x) => x.id !== corps!.input!.id); return { ok: true, text: '🚫 annulée' }; }
    if (!corps!.confirm) return { ok: false, confirm: `inviter ${String(corps!.input!.nom)}` };
    const id = `inv${b.appels.length}`; b.etat.invit.push({ id, nom: String(corps!.input!.nom) });
    return { ok: true, text: `${b.etat.texte}\nLien (à usage unique) : ${LIEN}`, data: { lien: LIEN, svg: '<svg/>', id } };
  };
  const $ = (sel: string) => { const k = sel.replace(/^#/, ''); assert.ok(n[k], `élément ${sel} attendu par le banc`); return n[k]; };
  vm.runInNewContext(script(), {
    $, el: (tag: string, attrs?: Record<string, unknown>, ...kids: unknown[]) => noeud(tag, attrs ?? {}, kids), api,
    st: (_id: string, text: string, ok?: boolean) => { b.statuts.push({ text, ok }); },
    OdinDialog: { confirm: async (m: string) => { b.dialogues.push(m); await new Promise((r) => setImmediate(r)); return true; } },
    show: () => {}, window: {}, setTimeout, URL, btoa, navigator: {},
  });
  n['p-inv'].hidden = false;
  return b;
}
const montre = (b: Banc) => JSON.stringify(b.n['p-inv-lien']).includes(LIEN);
/** Le bouton « Annuler » de l'invitation dont le nom est donné, dans la liste en cours. */
function annuler(b: Banc, nom: string): Noeud {
  const ligne = b.n['p-inv-liste'].children.find((c) => JSON.stringify(c).includes(nom)) as Noeud | undefined;
  assert.ok(ligne, `ligne de ${nom} dans la liste`);
  const bouton = sous(ligne).find((x) => x.tag === 'button'); assert.ok(bouton, 'bouton « Annuler »');
  return bouton;
}

test('le lien quitte la page quand le bloc se ferme et quand son invitation est annulée', async () => {
  const b = banc();
  await b.ouvrir(); await b.creer('Nour');
  assert.ok(montre(b), 'le lien est montré après la validation');
  await b.fermer();
  assert.ok(vide(b.n['p-inv-lien']), 'bloc fermé : le lien et le QR code ne restent pas dans la page');
  // Annuler une autre invitation ne retire pas le lien affiché ; annuler la sienne, si.
  await b.ouvrir(); await b.creer('Nour'); await b.creer('Sami');
  assert.ok(montre(b));
  const bN = annuler(b, 'Nour'); await (bN.attrs.onclick as (e: unknown) => Promise<void>)({ currentTarget: bN, target: bN }); await flush();
  assert.ok(montre(b), 'l\'invitation de Nour annulée : le lien de Sami reste');
  const bS = annuler(b, 'Sami'); await (bS.attrs.onclick as (e: unknown) => Promise<void>)({ currentTarget: bS, target: bS }); await flush();
  assert.ok(vide(b.n['p-inv-lien']), 'l\'invitation affichée annulée : son lien et son QR code disparaissent');
});

test('un double clic ne crée qu\'une invitation ; une panne de réseau est dite et rend le bouton', async () => {
  const b = banc(); await b.ouvrir();
  b.n['p-inv-nom'].value = 'Nour';
  await Promise.all([b.n['p-inv-go'].ecoute.click(), b.n['p-inv-go'].ecoute.click()]); await flush();
  assert.equal(b.dialogues.length, 1, 'une seule validation');
  assert.equal(b.appels.filter((a) => a.action === 'inviter' && a.confirm).length, 1, 'une seule invitation confirmée');
  assert.equal(b.n['p-inv-go'].disabled, false, 'le bouton revient');
  // Création : le réseau coupe.
  b.etat.panne = 'inviter'; await b.creer('Sami');
  const fin = b.statuts.at(-1)!;
  assert.equal(fin.ok, false, `la panne est dite (${fin.text})`); assert.notEqual(fin.text, 'Création du lien…');
  assert.equal(b.n['p-inv-go'].disabled, false, 'le bouton revient après la panne');
  // Annulation : le réseau coupe.
  b.etat.panne = 'annuler_invitation';
  const bN = annuler(b, 'Nour'); await (bN.attrs.onclick as (e: unknown) => Promise<void>)({ currentTarget: bN, target: bN }); await flush();
  assert.equal(b.statuts.at(-1)!.ok, false, 'la panne d\'annulation est dite');
  assert.equal(bN.disabled, false, 'le bouton « Annuler » revient');
});

test('l\'e-mail qui n\'a pas pu partir n\'est pas affiché comme une réussite', async () => {
  const b = banc(); await b.ouvrir();
  b.etat.texte = '✉ Invitation pour Nour (groupes famille, valable 7 jour(s)). ⚠ L\'e-mail n\'a pas pu partir (boîte absente) : donne le lien toi-même.';
  await b.creer('Nour');
  assert.ok(montre(b), 'le lien est là pour être donné à la main');
  assert.notEqual(b.statuts.at(-1)!.ok, true);
  b.etat.texte = '✉ Invitation pour Ilan (groupes famille, valable 7 jour(s)). Envoyée à ilan@example.org.';
  await b.creer('Ilan');
  assert.equal(b.statuts.at(-1)!.ok, true, 'e-mail parti : réussite');
});

test('sans « famille » ni « invite », aucun groupe n\'est choisi d\'avance et il faut en choisir un', async () => {
  const b = banc(); b.etat.groupes = ['admin', 'bureau', 'voisins']; await b.ouvrir();
  const opts = b.n['p-inv-groupe'].children as Noeud[];
  assert.deepEqual(opts.map((o) => o.attrs.value), ['', 'bureau', 'voisins'], 'un choix vide en tête, jamais « admin »');
  assert.equal(b.n['p-inv-groupe'].value, '');
  await b.creer('Nour');
  assert.equal(b.appels.length, 0, 'rien n\'est envoyé sans groupe');
  assert.equal(b.statuts.at(-1)!.ok, false);
  b.n['p-inv-groupe'].value = 'voisins'; await b.creer('Nour');
  assert.equal(b.appels[0].input!.groupes, 'voisins');
});

test('l\'entrée « Inviter quelqu\'un de la famille » se montre comme un bloc qui s\'ouvre (▸ / ▾) et se touche bien', async () => {
  const s = /<summary([^>]*)>([\s\S]*?)<\/summary>/.exec(/<details class="field" id="p-inv"[\s\S]*?<\/details>/.exec(carte())![0])!;
  assert.match(s[1], /min-height:44px/, 'cible tactile de 44 px');
  assert.match(s[2], /<span id="p-inv-fl" aria-hidden="true"[^>]*>▸<\/span>/, 'une flèche, tue aux lecteurs d\'écran');
  const b = banc();
  await b.ouvrir(); assert.equal(b.n['p-inv-fl'].textContent, '▾');
  await b.fermer(); assert.equal(b.n['p-inv-fl'].textContent, '▸');
});

// ---------------------------------------------------------------- un vrai Odin d'essai
const MDP_A = 'un-sentier-de-sable-sous-les-pins-31';
const MDP_B = 'une-barque-lente-au-bord-du-lac-62';
const cookieDe = (r: Response, nom: string) => r.headers.getSetCookie().find((c) => c.startsWith(`${nom}=`))?.split(';')[0] ?? '';
/** La connexion d'une personne de Persona à l'interface d'Odin, comme un navigateur : rend le cookie de sa session. */
async function entrer(v: VraiOdin, ident: string, mdp: string): Promise<string> {
  let r = await fetch(`${v.url}/sso/odin`, { redirect: 'manual' }); assert.equal(r.status, 303);
  r = await fetch(new URL(r.headers.get('location')!, v.url), { redirect: 'manual' }); const html = await r.text(), demande = /name="demande" value="([^"]+)"/.exec(html)![1];
  r = await fetch(`${v.url}/sso/autoriser`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded', origin: v.url }, body: new URLSearchParams({ demande, identifiant: ident, motdepasse: mdp }) });
  r = await fetch(r.headers.get('location')!, { redirect: 'manual' }); assert.equal(r.status, 303, 'session ouverte');
  return cookieDe(r, 'odin_session');
}
const tt = new T(), orig = { log: console.log, error: console.error, warn: console.warn };
let v: VraiOdin, sansDroit = '', avecDroit = '';
const nbInvitations = () => ((valhallaOf()!.ctx('var').settings.invitations as unknown[] | undefined) ?? []).length;
const inviter = (nom: string, confirm?: boolean) => ({ module: 'var', action: 'inviter', input: { nom, groupes: 'famille', email: '', jours: 3 }, ...(confirm === undefined ? {} : { confirm }) });

before(async () => {
  for (const k of ['log', 'error', 'warn'] as const) console[k] = () => {};
  v = await vraiOdin(tt, { compte: true, modules: (o) => allModules(o).filter((m) => m.id === 'var') });
  v.o.cfg.web.portsParAppli = false;
  const va = valhallaOf()!;
  assert.equal((await va.act('var', 'ajouter', { login: 'membre-a', nom: 'Membre A', groupes: 'famille', mot_de_passe: MDP_A })).ok, true);
  assert.equal((await va.act('var', 'ajouter', { login: 'membre-b', nom: 'Membre B', groupes: 'famille', mot_de_passe: MDP_B })).ok, true);
  // Le membre B a aussi le droit d'ouvrir Persona : il reçoit alors « réservé au propriétaire ».
  assert.equal((await va.act('var', 'donner_acces', { appli: 'var', qui: '@membre-b' })).ok, true);
  lierProprietaire(persona()!);
  sansDroit = await entrer(v, 'membre-a', MDP_A); avecDroit = await entrer(v, 'membre-b', MDP_B);
  assert.ok(sansDroit && avecDroit, 'les deux membres ont une session');
});
after(async () => { await tt.end(); Object.assign(console, orig); });

test('propriétaire : la validation d\'abord, puis le lien à usage unique et son QR code ; la liste et « Annuler »', async () => {
  const avant = nbInvitations();
  const sans = await v.json('/api/valhalla/act', inviter('Nour'));
  assert.notEqual(sans.body.ok, true);
  assert.match(String(sans.body.confirm), /inviter Nour/, `la validation est demandée (${JSON.stringify(sans.body)})`);
  assert.equal(nbInvitations(), avant, 'rien n\'est créé sans la validation');
  const avec = await v.json('/api/valhalla/act', inviter('Nour', true));
  assert.equal(avec.status, 200); assert.equal(avec.body.ok, true, JSON.stringify(avec.body));
  const d = avec.body.data as { lien: string; svg: string; id: string };
  assert.match(d.lien, /\/sso\/invitation\?j=[A-Za-z0-9_-]{43}$/); assert.match(d.svg, /^<svg/);
  assert.equal(String(avec.body.text).split('\n')[0].includes(d.lien), false, 'la première ligne (montrée en statut) ne contient pas le lien');
  assert.equal(nbInvitations(), avant + 1);
  // La page de Persona, lue comme le fait le bloc : l'invitation est en cours, les groupes n'ont pas « admin ».
  const { invLire, invGroupes } = fonctions();
  const vue = await v.json('/api/valhalla/view?id=var');
  const lu = invLire(vue.body);
  const x = lu.enCours.find((y) => y.id === d.id);
  assert.ok(x, `invitation en cours lue (${JSON.stringify(lu.enCours)})`);
  assert.equal(x.nom, 'Nour'); assert.equal(x.groupes, 'famille');
  assert.ok(!lu.groupes.includes('admin'));
  assert.equal(invGroupes(lu.groupes).defaut, 'famille', `groupes lus : ${JSON.stringify(lu.groupes)}`);
  assert.doesNotMatch(JSON.stringify(vue.body), new RegExp(d.lien.split('j=')[1]), 'le jeton n\'est pas dans la page de Persona');
  // « Annuler » : le lien ne marche plus.
  const an = await v.json('/api/valhalla/act', { module: 'var', action: 'annuler_invitation', input: { id: d.id } });
  assert.equal(an.body.ok, true, JSON.stringify(an.body));
  assert.equal(invLire((await v.json('/api/valhalla/view?id=var')).body).enCours.some((y) => y.id === d.id), false);
  const page = await fetch(d.lien.replace(/^https?:\/\/[^/]+/, v.url));
  assert.equal(page.status, 410, 'le lien annulé ne s\'ouvre plus');
});

test('propriétaire : « admin » est refusé par l\'invitation (même garde qu\'avant)', async () => {
  const avant = nbInvitations();
  const r = await v.json('/api/valhalla/act', { module: 'var', action: 'inviter', input: { nom: 'Sami', groupes: 'admin' }, confirm: true });
  assert.notEqual(r.body.ok, true); assert.match(String(r.body.text ?? r.body.error), /admin/);
  assert.equal(nbInvitations(), avant);
});

test('membre : l\'état le dit (le bouton est caché), et l\'action lui est refusée, confirmée ou non', async () => {
  for (const cookie of [sansDroit, avecDroit]) {
    const e = await v.json('/api/state', undefined, { cookie });
    assert.equal(e.status, 200); assert.ok(e.body.membre, 'l\'état d\'un membre porte « membre »');
  }
  const avant = nbInvitations();
  for (const confirm of [undefined, true]) {
    const a = await v.json('/api/valhalla/act', inviter('Ilan', confirm), { cookie: sansDroit });
    assert.equal(a.status, 403); assert.equal(a.body.code, 'refuse', JSON.stringify(a.body)); assert.equal(a.body.confirm, undefined);
    const b = await v.json('/api/valhalla/act', inviter('Ilan', confirm), { cookie: avecDroit });
    assert.equal(b.status, 403); assert.equal(b.body.code, 'reserve', JSON.stringify(b.body)); assert.equal(b.body.confirm, undefined);
    assert.match(String(b.body.text), /seul le propriétaire/);
  }
  assert.equal(nbInvitations(), avant, 'aucune invitation créée par un membre');
});
