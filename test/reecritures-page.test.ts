// La page « Réécritures proposées » : le propriétaire voit chaque brouillon de réécriture EN ENTIER (le fichier, la
// différence complète avec numéros d'avant et d'après, qui l'a demandé, ses mots à part marqués « non vérifié »), avec un
// seul bouton : « Refuser ». Rien ne s'applique depuis cette page ; un brouillon refusé ne change aucun fichier.
// Seul le propriétaire, dans son navigateur, lit et refuse : ni un membre, ni une personne sans session, ni la clé d'API.
// Le texte d'un brouillon n'est jamais lu comme du HTML ; ce qui ne se voit pas (sens d'écriture, contrôles) est écrit en
// clair, et une fin de ligne qui change est dite.
// Un vrai Odin d'essai (serveur web + applis), dans un dossier temporaire, sur un port libre ; les brouillons visent des
// fichiers du code, qui ne sont que LUS.

import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { T } from './banc/lib.ts';
import { vraiOdin, type VraiOdin } from './banc/odin-vrai.ts';
import { allModules, valhallaOf } from '../src/valhalla/odin.ts';
import { lierProprietaire, persona } from '../src/valhalla/sso/etat.ts';
import { DOSSIER_BROUILLONS, creerBrouillon, lireBrouillon, type Brouillon, type Demandeur } from '../src/code/brouillons.ts';
import { directs, holderOf } from '../src/valhalla/directports.ts';
import { ecrireFichierPrive, lireFichierPrive } from '../src/prive.ts';
import { RACINE_APPLI } from '../src/heimdall/noyau.ts';

const PHRASE_R = 'une-barque-verte-sous-le-pont-de-bois-41';
const PROPRIO: Demandeur = { role: 'proprietaire', nom: 'Alix', canal: 'web' };
const MEMBRE: Demandeur = { role: 'membre', nom: 'Noa', canal: 'telegram' };
const cookieDe = (r: Response, nom: string) => r.headers.getSetCookie().find((c) => c.startsWith(`${nom}=`))?.split(';')[0] ?? '';

/** La connexion d'une personne de Persona à l'interface d'Odin, comme un navigateur : rend le cookie de sa session. */
async function entrer(v: VraiOdin, ident: string, phrase: string): Promise<string> {
  let r = await fetch(`${v.url}/sso/odin`, { redirect: 'manual' }); assert.equal(r.status, 303);
  r = await fetch(new URL(r.headers.get('location')!, v.url), { redirect: 'manual' }); const html = await r.text(), demande = /name="demande" value="([^"]+)"/.exec(html)![1];
  r = await fetch(`${v.url}/sso/autoriser`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded', origin: v.url }, body: new URLSearchParams({ demande, identifiant: ident, motdepasse: phrase }) });
  r = await fetch(r.headers.get('location')!, { redirect: 'manual' }); assert.equal(r.status, 303, 'session ouverte');
  return cookieDe(r, 'odin_session');
}

// Les fichiers visés : ce fichier d'essai (stable pendant l'essai), un fichier du noyau, un fichier du code sensible.
const CIBLE = 'test/reecritures-page.test.ts', NOYAU = 'src/mimir/questions.ts', SENSIBLE = 'src/web/valhalla-api.ts';
const lire = (rel: string) => readFileSync(join(RACINE_APPLI, rel), 'utf8');
/** Un texte d'après piégé : sens d'écriture inversé, isolement, contrôle, retour chariot isolé, balises, fins de ligne CRLF. */
const PIEGE = (t: string) => `${t.replace(/\r\n/g, '\n').split('\n').slice(0, 3).join('\r\n')}\r\nconst role = "membre\u202E \u2066";\u0007\r\n<img src=x onerror="alert(1)">\r\n${t.replace(/\r\n/g, '\n').split('\n').slice(3).join('\r\n')}`;
const DEMANDE = 'Change le titre <b>vite</b> \u202Eesrever\u202C\nLe changement : − rien + tout';

const tt = new T(), orig = { log: console.log, error: console.error, warn: console.warn };
let v: VraiOdin, membre = '';
const b: Record<string, Brouillon> = {};
type Ligne = [string, number | null, number | null, string];
type Vue = { id: string; fichier: string; etat: string; demandePar: { role: string; nom: string; canal: string }; demande: { texte: string; nonVerifie: boolean }; etiquettes: string[]; lignes?: Ligne[] | null; compte?: { retirees: number; ajoutees: number }; fins?: { avant: string; apres: string; changees: boolean } };
const liste = async (headers: Record<string, string> = {}) => { const r = await v.json('/api/reecritures', undefined, headers); return { status: r.status, list: (r.body.list ?? []) as Vue[], body: r.body }; };
async function poster(chemin: string, corps: unknown, headers: Record<string, string>): Promise<{ status: number; body: Record<string, unknown> }> {
  const r = await fetch(v.url + chemin, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(corps), redirect: 'manual' });
  const t = await r.text(); let body: Record<string, unknown> = {}; try { body = JSON.parse(t) as Record<string, unknown>; } catch { body = { text: t }; }
  return { status: r.status, body };
}
const empreinte = (rel: string) => { const s = statSync(join(RACINE_APPLI, rel)); return `${s.size}:${s.mtimeMs}:${lire(rel)}`; };

before(async () => {
  for (const k of ['log', 'error', 'warn'] as const) console[k] = () => {};
  v = await vraiOdin(tt, { compte: true, modules: (o) => allModules(o).filter((m) => m.id === 'var') });
  v.o.cfg.web.portsParAppli = false;
  const va = valhallaOf()!;
  assert.equal((await va.act('var', 'ajouter', { login: 'membre-r', nom: 'Membre R', groupes: 'invite', mot_de_passe: PHRASE_R })).ok, true);
  assert.equal((await va.act('var', 'donner_acces', { appli: 'odin', qui: '@membre-r' })).ok, true);
  lierProprietaire(persona()!);
  membre = await entrer(v, 'membre-r', PHRASE_R); assert.ok(membre);
  const home = v.o.paths.home;
  const faire = (cle: string, fichier: string, apres: string, qui: Demandeur, demande: string) => {
    const r = creerBrouillon(home, { fichier, apres, demandePar: qui, demande });
    assert.ok(r.ok, `brouillon ${cle} : ${JSON.stringify(r)}`); b[cle] = r.brouillon;
  };
  faire('piege', CIBLE, PIEGE(lire(CIBLE)), PROPRIO, DEMANDE);
  faire('noyau', NOYAU, `${lire(NOYAU)}\n// une ligne de plus\n`, PROPRIO, 'ajoute une ligne');
  faire('sensible', SENSIBLE, `// une ligne de moins\n${lire(SENSIBLE)}`, PROPRIO, 'ajoute un commentaire');
  faire('membre', CIBLE, `${lire(CIBLE)}// demandé par un membre\n`, MEMBRE, 'mets un commentaire à la fin');
});
after(async () => { await tt.end(); Object.assign(console, orig); });

// ---------------------------------------------------------------- la route : tout le texte, au propriétaire seul
test('la route rend chaque brouillon proposé EN ENTIER : différence complète et numérotée, qui l\'a demandé, ses mots marqués « non vérifié »', async () => {
  const r = await liste();
  assert.equal(r.status, 200, JSON.stringify(r.body).slice(0, 300));
  const x = r.list.find((y) => y.id === b.piege.id)!;
  assert.ok(x, 'le brouillon est listé');
  assert.equal(x.etat, 'proposé'); assert.equal(x.fichier, CIBLE);
  assert.deepEqual(x.demandePar, { role: 'proprietaire', nom: 'Alix', canal: 'web' });
  assert.equal(x.demande.nonVerifie, true);
  assert.ok(Array.isArray(x.lignes));
  const L = x.lignes!;
  // Rien n'est coupé : les lignes gardées et ajoutées refont tout le texte d'après, les gardées et retirées tout celui d'avant.
  const visible = (t: string) => t.replace(/[\u0000-\u0008\u000B-\u001F\u007F-\u009F\u061C\u200B-\u200F\u2028-\u202E\u2060\u2066-\u2069\uFEFF]/g, (c) => `⟦U+${c.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')}⟧`);
  const apres = b.piege.apres.replace(/\r\n/g, '\n').split('\n'), avant = lire(CIBLE).replace(/\r\n/g, '\n').split('\n');
  assert.deepEqual(L.filter((l) => l[0] !== '-').map((l) => l[3]), apres.map(visible), 'tout le texte d\'après');
  assert.deepEqual(L.filter((l) => l[0] !== '+').map((l) => l[3]), avant.map(visible), 'tout le texte d\'avant');
  // Numéros d'avant et d'après, de 1 à la fin, sans trou.
  assert.deepEqual(L.filter((l) => l[2] !== null).map((l) => l[2]), apres.map((_, i) => i + 1));
  assert.deepEqual(L.filter((l) => l[1] !== null).map((l) => l[1]), avant.map((_, i) => i + 1));
  assert.ok(L.some((l) => l[0] === '+' && /^<img src=x onerror="alert\(1\)">$/.test(l[3])), 'une balise reste un texte');
  // Ce qui ne se voit pas est écrit en clair ; plus aucun caractère de sens d'écriture ni de contrôle dans la réponse.
  assert.ok(L.some((l) => l[3] === 'const role = "membre⟦U+202E⟧ ⟦U+2066⟧";⟦U+0007⟧'), JSON.stringify(L.filter((l) => l[0] === '+')));
  assert.match(x.demande.texte, /⟦U\+202E⟧esrever⟦U\+202C⟧/); assert.match(x.demande.texte, /<b>vite<\/b>/);
  const brut = JSON.stringify(r.body);
  assert.doesNotMatch(brut, /[\u202A-\u202E\u2066-\u2069\u0007]/, 'aucun caractère invisible brut');
  assert.ok(!L.some((l) => l[3].includes('\r')) && !x.demande.texte.includes('\r'), 'aucun retour chariot brut');
  // La fin de ligne qui change est dite (la différence ligne à ligne ne la montre pas).
  assert.equal(x.fins?.changees, true); assert.equal(x.fins?.avant === 'crlf', false); assert.equal(x.fins?.apres, 'crlf');
  assert.deepEqual(x.compte, { retirees: 0, ajoutees: 2 });
});

test('pour les brouillons du propriétaire, une étiquette « noyau » ou « code sensible » ; jamais pour celui d\'un membre', async () => {
  const r = await liste(), de = (id: string) => r.list.find((y) => y.id === id)!;
  assert.deepEqual(de(b.noyau.id).etiquettes, ['noyau']);
  assert.deepEqual(de(b.sensible.id).etiquettes, ['code sensible']);
  assert.deepEqual(de(b.piege.id).etiquettes, []);
  const m = de(b.membre.id);
  assert.deepEqual(m.etiquettes, []); assert.deepEqual(m.demandePar, { role: 'membre', nom: 'Noa', canal: 'telegram' });
  assert.equal(m.demande.texte, 'mets un commentaire à la fin'); assert.equal(m.demande.nonVerifie, true);
  // Le compte pour l'accueil : les seuls brouillons proposés.
  const c = await v.json('/api/reecritures?compte=1');
  assert.equal(c.status, 200); assert.equal(c.body.proposes, r.list.filter((y) => y.etat === 'proposé').length);
  assert.equal(c.body.list, undefined, 'le compte ne porte aucun texte');
});

test('une session de membre reçoit 403, sans aucun texte ; sans session : 401 ; la clé d\'API : 403', async () => {
  for (const chemin of ['/api/reecritures', '/api/reecritures?compte=1']) {
    const m = await fetch(v.url + chemin, { headers: { cookie: membre } });
    const t = await m.text();
    assert.equal(m.status, 403, `membre ${chemin} : ${m.status}`); assert.doesNotMatch(t, /questions|onerror|Alix|Noa/);
    const nul = await fetch(v.url + chemin);
    assert.equal(nul.status, 401); assert.doesNotMatch(await nul.text(), /questions|onerror|Alix|Noa/);
    const cle = await fetch(v.url + chemin, { headers: { authorization: `Bearer ${v.token}` } });
    assert.equal(cle.status, 403, `clé d'API ${chemin} : ${cle.status}`); assert.doesNotMatch(await cle.text(), /questions|onerror|Alix|Noa/);
  }
  // Un membre ne refuse pas non plus (et rien ne change).
  const p = await poster('/api/reecritures/refuser', { id: b.membre.id }, { cookie: membre, 'x-odin': '1' });
  assert.equal(p.status, 403);
  const q = await poster('/api/reecritures/refuser', { id: b.membre.id }, { authorization: `Bearer ${v.token}`, 'x-odin': '1' });
  assert.equal(q.status, 403);
  assert.equal(lireBrouillon(v.o.paths.home, b.membre.id)?.etat, 'proposé');
});

test('« Refuser » : le brouillon passe à « refusé » et aucun fichier ne change ; sans l\'en-tête x-odin, rien', async () => {
  const avant = [CIBLE, NOYAU, SENSIBLE].map(empreinte);
  const sans = await poster('/api/reecritures/refuser', { id: b.noyau.id }, { cookie: v.session });
  assert.equal(sans.status, 403); assert.equal(lireBrouillon(v.o.paths.home, b.noyau.id)?.etat, 'proposé');
  for (const cle of ['noyau', 'piege'] as const) {
    const r = await poster('/api/reecritures/refuser', { id: b[cle].id }, { cookie: v.session, 'x-odin': '1' });
    assert.equal(r.status, 200, JSON.stringify(r.body)); assert.equal(r.body.etat, 'refusé');
    assert.equal(lireBrouillon(v.o.paths.home, b[cle].id)?.etat, 'refusé');
  }
  assert.deepEqual([CIBLE, NOYAU, SENSIBLE].map(empreinte), avant, 'aucun fichier du code n\'a changé');
  // Un brouillon déjà refusé ne se refuse pas deux fois ; un identifiant inconnu : 404.
  assert.equal((await poster('/api/reecritures/refuser', { id: b.noyau.id }, { cookie: v.session, 'x-odin': '1' })).status, 409);
  assert.equal((await poster('/api/reecritures/refuser', { id: '0'.repeat(32) }, { cookie: v.session, 'x-odin': '1' })).status, 404);
  assert.equal((await poster('/api/reecritures/refuser', { id: '../x' }, { cookie: v.session, 'x-odin': '1' })).status, 404);
  // Sur la page : il n'est plus compté, il ne porte plus de texte.
  const r = await liste(), x = r.list.find((y) => y.id === b.noyau.id)!;
  assert.equal(x.etat, 'refusé'); assert.equal(x.lignes ?? null, null);
  assert.equal((await v.json('/api/reecritures?compte=1')).body.proposes, r.list.filter((y) => y.etat === 'proposé').length);
  // Il n'existe aucune route pour appliquer.
  for (const chemin of ['/api/reecritures/appliquer', '/api/reecritures/accepter']) assert.notEqual((await poster(chemin, { id: b.sensible.id }, { cookie: v.session, 'x-odin': '1' })).status, 200);
  assert.equal(lireBrouillon(v.o.paths.home, b.sensible.id)?.etat, 'proposé');
});

// ---------------------------------------------------------------- la page (pages/reecritures.js), sans navigateur
type Ev = { key?: string; shiftKey?: boolean; target?: unknown; currentTarget?: unknown; preventDefault(): void; stopPropagation(): void };
type Noeud = { nodeType: number; tag?: string; data?: string; attrs: Record<string, string>; kids: Noeud[]; on: Record<string, (e: Ev) => unknown>; parent?: Noeud | null; disabled?: boolean;
  focus?(): void; append?(...x: Noeud[]): void; remove?(): void; querySelector?(s: string): Noeud | null; querySelectorAll?(s: string): Noeud[]; getAttribute?(k: string): string | null; contains?(x: unknown): boolean; closest?(s: string): Noeud | null };
/**
 * Un document minimal : innerHTML, outerHTML, insertAdjacentHTML et document.write font échouer l'essai. Il garde le
 * focus (document.activeElement), les écouteurs du document, et trouve des éléments par des sélecteurs simples
 * (« button », « .classe », « [attr] », « [attr]:not([attr="v"]) », séparés par des virgules).
 */
function documentFaux() {
  const interdit = () => { throw new Error('du HTML est écrit dans la page'); };
  const texte = (n: Noeud): string => n.nodeType === 3 ? n.data ?? '' : n.kids.map(texte).join('');
  const un = (n: Noeud, s: string): boolean => {
    let m: RegExpExecArray | null;
    if (n.nodeType !== 1) return false;
    if (/^[a-z]+$/.test(s)) return n.tag === s;
    if ((m = /^\.([\w-]+)$/.exec(s))) return (n.attrs.class ?? '').split(/\s+/).includes(m[1]);
    if ((m = /^\[([\w-]+)\]$/.exec(s))) return m[1] in n.attrs;
    if ((m = /^\[([\w-]+)\]:not\(\[([\w-]+)="([^"]*)"\]\)$/.exec(s))) return m[1] in n.attrs && n.attrs[m[2]] !== m[3];
    if ((m = /^([a-z]+)\[([\w-]+)\]$/.exec(s))) return n.tag === m[1] && m[2] in n.attrs;
    throw new Error(`sélecteur non pris en charge par l'essai : ${s}`);
  };
  const va = (n: Noeud, sel: string) => sel.split(',').map((s) => s.trim()).some((s) => un(n, s));
  const sous = (n: Noeud): Noeud[] => n.kids.flatMap((k) => [k, ...sous(k)]);
  const ecoute: Record<string, Array<(e: Ev) => unknown>> = {};
  const doc = {
    activeElement: null as Noeud | null, write: interdit, texte, getElementById: () => null,
    addEventListener(k: string, f: (e: Ev) => unknown) { (ecoute[k] ??= []).push(f); },
    removeEventListener(k: string, f: (e: Ev) => unknown) { ecoute[k] = (ecoute[k] ?? []).filter((g) => g !== f); },
    ecoutes: (k: string) => (ecoute[k] ?? []).length,
    /** Le focus arrive sur `n` : comme un navigateur, l'événement focusin passe d'abord par les écouteurs du document. */
    focusSur(n: Noeud) { doc.activeElement = n; for (const f of [...(ecoute.focusin ?? [])]) f({ target: n, preventDefault() {}, stopPropagation() {} }); },
    createTextNode: (d: unknown): Noeud => ({ nodeType: 3, data: String(d), attrs: {}, kids: [], on: {} }),
    createElement: (tag: string): Noeud => mk(tag),
    head: null as unknown as Noeud, body: null as unknown as Noeud,
  };
  const mk = (tag: string): Noeud => {
    const n: Noeud & Record<string, unknown> = { nodeType: 1, tag, attrs: {} as Record<string, string>, kids: [] as Noeud[], on: {}, disabled: false, parent: null,
      setAttribute(k: string, val: unknown) { n.attrs[k] = String(val); }, getAttribute(k: string) { return n.attrs[k] ?? null; },
      addEventListener(k: string, f: (e: Ev) => unknown) { n.on[k] = f; },
      append(...x: Noeud[]) { for (const k of x) k.parent = n; n.kids.push(...x); },
      prepend(...x: Noeud[]) { for (const k of x) k.parent = n; n.kids.unshift(...x); },
      replaceChildren(...x: Noeud[]) { for (const k of n.kids) k.parent = null; for (const k of x) k.parent = n; n.kids = [...x]; if (doc.activeElement && !doc.body.contains!(doc.activeElement)) doc.activeElement = doc.body; },
      remove() { if (n.parent) { n.parent.kids = n.parent.kids.filter((k) => k !== n); n.parent = null; } if (doc.activeElement && !doc.body.contains!(doc.activeElement)) doc.activeElement = doc.body; },
      focus() { doc.focusSur(n); },
      contains(x: unknown) { for (let p = x as Noeud | null | undefined; p; p = p.parent) if (p === n) return true; return false; },
      closest(s: string) { for (let p: Noeud | null | undefined = n; p; p = p.parent) if (va(p, s)) return p; return null; },
      querySelector(s: string) { return sous(n).find((k) => va(k, s)) ?? null; },
      querySelectorAll(s: string) { return sous(n).filter((k) => va(k, s)); },
      insertAdjacentHTML: interdit };
    for (const p of ['innerHTML', 'outerHTML']) Object.defineProperty(n, p, { get: interdit, set: interdit });
    Object.defineProperty(n, 'textContent', { get() { return texte(n); }, set(t: unknown) { n.kids = [{ nodeType: 3, data: String(t), attrs: {}, kids: [], on: {} }]; } });
    Object.defineProperty(n, 'parentNode', { get() { return n.parent ?? null; } });
    return n;
  };
  doc.head = mk('head'); doc.body = mk('body');
  return doc;
}
const ev = (o: Partial<Ev> = {}): Ev & { empeche: boolean } => { const e = { empeche: false, ...o, preventDefault() { e.empeche = true; }, stopPropagation() {} }; return e; };
/** Une vue de brouillon proposée, pour la page seule (aucun Odin). */
const vueFaite = (id: string, fichier: string, lignesVue: Ligne[]): Vue => ({ id, fichier, etat: 'proposé', demandePar: { role: 'proprietaire', nom: 'Alix', canal: 'web' }, demande: { texte: 'une demande', nonVerifie: true }, etiquettes: [], lignes: lignesVue, compte: { retirees: 0, ajoutees: 1 }, fins: { avant: 'lf', apres: 'lf', changees: false } });
/** La page chargée dans le document minimal, avec un faux « fetch » qui répond par `repondre`. */
function pageFaite(repondre: (chemin: string, init?: { method?: string; body?: string }) => unknown, confirmer = true) {
  const doc = documentFaux(), win: Record<string, unknown> = { OdinDialog: { confirm: async () => confirmer } };
  const appels: Array<{ chemin: string; method: string; body?: string }> = [];
  const fetchFaux = async (chemin: string, init?: { method?: string; body?: string }) => { appels.push({ chemin, method: init?.method ?? 'GET', body: init?.body }); const d = repondre(chemin, init); return { ok: true, json: async () => d }; };
  new Function('window', 'document', 'fetch', lirePage())(win, doc, fetchFaux);
  return { doc, appels, R: win.OdinReecritures as { ouvrir(f?: () => void): Promise<void>; fermer(): void; carte(b: Vue): Noeud } };
}
const racineDe = (doc: ReturnType<typeof documentFaux>) => doc.body.querySelector!('.rw')!;
const boutonsRefuser = (racine: Noeud) => racine.querySelectorAll!('button').filter((x) => x.kids.some((k) => k.data === 'Refuser'));
const lirePage = () => readFileSync(new URL('../src/web/pages/reecritures.js', import.meta.url), 'utf8');

test('la page montre tout le brouillon comme du texte (jamais du HTML), ses mots à part marqués « texte de la demande, non vérifié », et un seul bouton : « Refuser »', async () => {
  const PAGE = lirePage(), doc = documentFaux(), win: Record<string, unknown> = {};
  new Function('window', 'document', 'fetch', PAGE)(win, doc, async () => { throw new Error('pas de réseau ici'); });
  const R = win.OdinReecritures as { carte(b: Vue): Noeud };
  assert.ok(R && typeof R.carte === 'function', 'window.OdinReecritures.carte');
  const x = (await liste()).list.find((y) => y.id === b.sensible.id)!;
  const piege: Vue = { ...x, demande: { texte: '<img src=x onerror="alert(1)"> \u202Eabc', nonVerifie: true }, demandePar: { role: 'membre', nom: '<b>Noa</b>', canal: 'telegram' }, etiquettes: [],
    fins: { avant: 'lf', apres: 'crlf', changees: true }, lignes: [[' ', 1, 1, 'a'], ['-', 2, null, '<script>x</script>'], ['+', null, 2, 'b\u202E\u0007']] };
  const n = R.carte(piege), t = doc.texte(n);
  assert.match(t, /<script>x<\/script>/); assert.match(t, /<img src=x onerror="alert\(1\)">/); assert.match(t, /<b>Noa<\/b>/);
  assert.match(t, /texte de la demande, non vérifié/i);
  assert.match(t, /⟦U\+202E⟧abc/); assert.match(t, /b⟦U\+202E⟧⟦U\+0007⟧/); assert.doesNotMatch(t, /[\u202E\u0007]/);
  assert.match(t, /CRLF/, 'la fin de ligne qui change est dite');
  assert.match(t, src(SENSIBLE)); assert.match(t, /membre de la famille/);
  const boutons: Noeud[] = []; const tous = (m: Noeud) => { if (m.tag === 'button') boutons.push(m); m.kids.forEach(tous); }; tous(n);
  assert.deepEqual(boutons.map((y) => doc.texte(y)), ['Refuser'], 'un seul bouton');
  // Un brouillon du propriétaire : son étiquette.
  const p = R.carte({ ...x }); assert.match(doc.texte(p), /code sensible/);
  // Un brouillon déjà décidé : pas de bouton.
  const d = R.carte({ ...x, etat: 'refusé', lignes: null }); const bd: Noeud[] = []; const t2 = (m: Noeud) => { if (m.tag === 'button') bd.push(m); m.kids.forEach(t2); }; t2(d);
  assert.equal(bd.length, 0);
  // Le texte du fichier : aucune écriture de HTML, aucun bouton pour appliquer.
  assert.doesNotMatch(PAGE, /innerHTML|outerHTML|insertAdjacentHTML|document\.write/);
  assert.doesNotMatch(PAGE, /Appliquer|appliquer'/);
});
function src(f: string) { return new RegExp(f.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')); }

test('l\'accueil : « N réécriture(s) proposée(s) », pour le propriétaire seul, ouvre la page', () => {
  const UI = readFileSync(new URL('../src/web/ui.html', import.meta.url), 'utf8');
  const i = UI.indexOf('function renderHome()'), fin = UI.indexOf('function renderToday(', i);
  const home = UI.slice(i, fin);
  assert.match(home, /réécriture\(s\) proposée\(s\)/);
  assert.match(home, /state\.membre \? 0 : window\.OdinReecritures\?\.compte\(renderHome\)/);
  assert.match(home, /window\.OdinReecritures\?\.ouvrir\(renderHome\)/);
});

// ---------------------------------------------------------------- ce que la relecture a demandé de plus
test('la page rend visibles TOUS les caractères qui ne se voient pas (remplissages coréens, trait d\'union conditionnel, sélecteurs de variante, étiquettes, opérateurs invisibles), et laisse les lettres de toutes les langues', () => {
  const { doc, R } = pageFaite(() => ({ ok: true, list: [] }));
  // Chacun de ces caractères peut cacher un nom ou un bout de code dans une ligne qui a l'air propre (« exec(U+3164) »).
  const caches = ['\u3164', '\u115F', '\u1160', '\uFFA0', '\u00AD', '\u034F', '\u17B4', '\u180E', '\u2061', '\u2064', '\u206A', '\uFE0F', '\u{E0041}', '\u{E0001}', '\u{1D173}', '\uFFF9', '\u202E', '\u2066', '\u0007', '\r'];
  const ligne = `exec(${caches.join('|')})`;
  const n = R.carte({ ...vueFaite('a'.repeat(32), 'src/x.ts', [['+', null, 1, ligne]]), demande: { texte: `fais ça ${caches.join('')}`, nonVerifie: true }, demandePar: { role: 'membre', nom: 'Noa\u3164\u{E0041}', canal: 'web' } });
  const t = doc.texte(n);
  for (const c of caches) {
    const code = `⟦U+${c.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}⟧`;
    assert.ok(t.includes(code), `${code} est écrit en clair`);
    assert.ok(!t.includes(c), `${code} n'est plus dans la page tel quel`);
  }
  assert.match(t, /Noa⟦U\+3164⟧⟦U\+E0041⟧/);
  // Les lettres, les accents et les tabulations restent tels quels, dans toutes les langues.
  const langues = 'Mwana wa hazi · Marahaba · سلام · 한국어 · Ελληνικά · ñ ẽ ŋ ʼ · 中文 · हिन्दी\tfin';
  assert.equal(doc.texte(R.carte(vueFaite('b'.repeat(32), 'src/y.ts', [[' ', 1, 1, langues]]))).includes(langues), true);
});

test('un refus qui échoue : le message reste affiché, à côté du brouillon, et le focus revient sur son bouton', async () => {
  const id = 'c'.repeat(32), vue = vueFaite(id, 'src/z.ts', [['+', null, 1, 'x']]);
  const { doc, R, appels } = pageFaite((chemin) => (chemin === '/api/reecritures/refuser' ? { ok: false, error: 'Refus impossible pour l\'essai' } : { ok: true, list: [vue] }));
  await R.ouvrir();
  const racine = racineDe(doc), [bouton] = boutonsRefuser(racine);
  assert.ok(bouton, 'le bouton « Refuser »');
  await bouton.on.click(ev({ currentTarget: bouton }));
  assert.deepEqual(appels.map((a) => `${a.method} ${a.chemin}`), ['GET /api/reecritures', 'POST /api/reecritures/refuser', 'GET /api/reecritures']);
  const alerte = racine.querySelectorAll!('.rw-alerte').find((x) => doc.texte(x).includes('Refus impossible pour l\'essai'));
  assert.ok(alerte, `le message d'échec est encore là : ${doc.texte(racine)}`);
  assert.equal(alerte.getAttribute!('role'), 'alert');
  assert.equal(alerte.closest!('.rw-c')?.getAttribute!('data-id'), id, 'dans la carte du brouillon');
  assert.ok(racine.contains!(doc.activeElement), 'le focus reste dans la page');
  assert.equal(doc.activeElement, boutonsRefuser(racine)[0], 'sur le bouton de ce brouillon');
  R.fermer();
});

test('un refus réussi : le focus va au « Refuser » suivant, puis à la croix quand il n\'y en a plus (jamais sur le fond de la page)', async () => {
  const v1 = vueFaite('d'.repeat(32), 'src/a.ts', [['+', null, 1, 'x']]), v2 = vueFaite('e'.repeat(32), 'src/b.ts', [['+', null, 1, 'y']]);
  let actuelles = [v1, v2];
  const { doc, R } = pageFaite((chemin, init) => {
    if (chemin === '/api/reecritures/refuser') { const { id } = JSON.parse(init!.body!) as { id: string }; actuelles = actuelles.map((x) => (x.id === id ? { ...x, etat: 'refusé', lignes: null } : x)); return { ok: true, etat: 'refusé' }; }
    return { ok: true, list: actuelles };
  });
  await R.ouvrir();
  const racine = racineDe(doc);
  let [b1] = boutonsRefuser(racine);
  await b1.on.click(ev({ currentTarget: b1 }));
  const reste = boutonsRefuser(racine);
  assert.equal(reste.length, 1);
  assert.equal(doc.activeElement, reste[0], 'sur le « Refuser » du brouillon suivant');
  [b1] = reste;
  await b1.on.click(ev({ currentTarget: b1 }));
  assert.equal(boutonsRefuser(racine).length, 0);
  assert.equal(doc.activeElement, racine.querySelector!('.rw-x'), 'sur la croix');
  R.fermer();
});

test('la page garde le focus clavier : Tab et Maj+Tab bouclent dedans, un focus qui s\'échappe y revient, sauf vers la fenêtre de confirmation ; fermée, elle le rend', async () => {
  const { doc, R } = pageFaite(() => ({ ok: true, list: [vueFaite('f'.repeat(32), 'src/c.ts', [['+', null, 1, 'x']])] }));
  const lien = doc.createElement('a'); doc.body.append!(lien); lien.focus!();
  await R.ouvrir();
  const racine = racineDe(doc), croix = racine.querySelector!('.rw-x')!;
  assert.equal(doc.activeElement, croix, 'la croix a le focus à l\'ouverture');
  const pris = racine.querySelectorAll!('button,summary,[tabindex]:not([tabindex="-1"])').filter((x) => !x.disabled);
  const premier = pris[0], dernier = pris[pris.length - 1];
  assert.notEqual(premier, dernier);
  dernier.focus!(); let e = ev({ key: 'Tab', target: dernier }); racine.on.keydown(e);
  assert.equal(e.empeche, true); assert.equal(doc.activeElement, premier, 'Tab après le dernier : le premier');
  e = ev({ key: 'Tab', shiftKey: true, target: premier }); racine.on.keydown(e);
  assert.equal(e.empeche, true); assert.equal(doc.activeElement, dernier, 'Maj+Tab avant le premier : le dernier');
  // Un focus qui part sous la page (l'interface cachée) revient dedans.
  const dessous = doc.createElement('button'); doc.body.append!(dessous);
  dessous.focus!();
  assert.ok(racine.contains!(doc.activeElement), 'le focus est ramené dans la page');
  // La fenêtre de confirmation, par-dessus, garde le sien.
  const fond = doc.createElement('div'); fond.attrs.class = 'odlg-bg'; const ok = doc.createElement('button'); fond.append!(ok); doc.body.append!(fond);
  ok.focus!();
  assert.equal(doc.activeElement, ok, 'la confirmation garde son focus');
  fond.remove!();
  // Fermée : le focus revient au lien, et la page ne surveille plus rien.
  R.fermer();
  assert.equal(doc.activeElement, lien);
  assert.equal(doc.ecoutes('focusin'), 0, 'plus aucun écouteur sur le document');
  dessous.focus!(); assert.equal(doc.activeElement, dessous);
});

test('l\'affichage : numéros et signes restent en place quand le code défile, le fond d\'une ligne va jusqu\'au bout, numéros lisibles, « Déjà décidées » de 44 px', async () => {
  const { doc, R } = pageFaite(() => ({ ok: true, list: [] }));
  const n = R.carte(vueFaite('1'.repeat(32), 'src/d.ts', [...Array.from({ length: 120 }, (_, i): Ligne => [' ', i + 1, i + 1, 'x'.repeat(300)]), ['+', null, 121, 'y']]));
  await R.ouvrir(); R.fermer();
  const css = doc.texte(doc.head);
  const regle = (sel: string) => { const k = css.indexOf(`${sel}{`); assert.ok(k >= 0 && (k === 0 || /[\s}]/.test(css[k - 1])), `règle ${sel}`); return css.slice(k + sel.length + 1, css.indexOf('}', k)); };
  // La gouttière (numéros d'avant, d'après, signe) colle au bord gauche, sur un fond opaque.
  assert.match(regle('.rw-g'), /position:sticky/); assert.match(regle('.rw-g'), /left:0/); assert.match(regle('.rw-g'), /background:var\(--bg/);
  assert.match(regle('.rw-m .rw-g'), /background:linear-gradient\([^;]*var\(--bg/); assert.match(regle('.rw-p .rw-g'), /background:linear-gradient\([^;]*var\(--bg/);
  // Toutes les lignes ont la largeur de la plus longue : le fond rouge ou vert va jusqu'au bout.
  assert.match(regle('.rw-in'), /width:max-content/); assert.match(regle('.rw-in'), /min-width:100%/);
  // Les numéros : la couleur secondaire lisible (« muted »), et une largeur fixe d'après le plus grand numéro.
  assert.match(regle('.rw-n'), /color:var\(--muted/); assert.match(regle('.rw-n'), /width:calc\(var\(--rw-w/);
  assert.match(regle('.rw-autres summary'), /min-height:44px/);
  const diff = n.querySelector!('.rw-diff')!;
  assert.equal(diff.getAttribute!('style'), '--rw-w:3ch');
  const premiere = diff.querySelector!('.rw-in')!.kids[0];
  assert.equal(premiere.kids[0].attrs.class, 'rw-g', 'la gouttière ouvre chaque ligne');
  assert.deepEqual(premiere.kids[0].kids.map((k) => k.attrs.class), ['rw-n', 'rw-n', 'rw-s']);
});

// ---------------------------------------------------------------- la route : le port direct d'une appli, et un fichier qui change
test('le port direct d\'une appli : même avec la session du propriétaire, ni lecture ni refus (403), rien ne change', async () => {
  const d = directs(); assert.ok(d, 'le gardien des ports directs tourne');
  let port = 0;
  for (let i = 0; i < 20 && !port; i++) {
    const p = await d.suggest('var'); if (!p || p === 8888 || await holderOf(p)) continue;
    try { await d.set('var', p); port = p; } catch { /* pris entre-temps : un autre */ }
  }
  assert.ok(port, 'port direct de Var ouvert');
  try {
    const base = `http://127.0.0.1:${port}`;
    for (const chemin of ['/api/reecritures', '/api/reecritures?compte=1']) {
      const r = await fetch(base + chemin, { headers: { cookie: v.session, 'x-odin': '1' } });
      assert.equal(r.status, 403, `${chemin} sur le port direct : ${r.status}`); assert.doesNotMatch(await r.text(), /questions|onerror|Alix|Noa/);
    }
    const r = await fetch(`${base}/api/reecritures/refuser`, { method: 'POST', headers: { 'content-type': 'application/json', cookie: v.session, 'x-odin': '1' }, body: JSON.stringify({ id: b.sensible.id }), redirect: 'manual' });
    assert.equal(r.status, 403);
    assert.equal(lireBrouillon(v.o.paths.home, b.sensible.id)?.etat, 'proposé');
    // Sur l'interface d'Odin, la même session lit bien : le refus vient du port, pas de la session.
    assert.equal((await liste()).status, 200);
  } finally { await d.remove('var').catch(() => {}); }
});

test('un fichier qui a changé depuis le brouillon : à la lecture, le brouillon devient « périmé », sans texte, et n\'est plus compté', async () => {
  const home = v.o.paths.home, r0 = creerBrouillon(home, { fichier: CIBLE, apres: `${lire(CIBLE)}// encore une ligne\n`, demandePar: { role: 'proprietaire', nom: 'Alix', canal: 'telegram' }, demande: 'une ligne à la fin' });
  assert.ok(r0.ok, JSON.stringify(r0));
  const id = r0.brouillon.id, f = join(home, DOSSIER_BROUILLONS, `${id}.json`);
  const avantCompte = (await v.json('/api/reecritures?compte=1')).body.proposes as number;
  // Le fichier « a changé » : l'empreinte gardée n'est plus celle du fichier (le code, lui, n'est pas touché).
  const brut = lireFichierPrive<Brouillon>(home, f)!; ecrireFichierPrive(home, f, { ...brut, empreinteAvant: '0'.repeat(64) });
  const x = (await liste()).list.find((y) => y.id === id)!;
  assert.equal(x.etat, 'périmé'); assert.equal(x.lignes ?? null, null);
  assert.equal(lireBrouillon(home, id)?.etat, 'périmé', 'rangé « périmé »');
  assert.equal((await v.json('/api/reecritures?compte=1')).body.proposes, avantCompte - 1);
  assert.equal((await poster('/api/reecritures/refuser', { id }, { cookie: v.session, 'x-odin': '1' })).status, 409, 'un périmé ne se refuse plus');
});

