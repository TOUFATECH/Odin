// Les widgets de l'accueil (maquette validée « Accueil ») : ce qui restait ouvert après les familles de widgets.
// - L'en-tête d'une petite carte, comme la maquette : la tuile, le titre et « ⋯ » sur une seule ligne (le titre fini par
//   « … », son entier en info-bulle), pour chaque sorte du tiroir à sa taille la plus petite, à 768 px en clair et en
//   sombre, à 1024 et à 320 px ; le corps garde sa hauteur.
// - « Odin ne sait pas lire cette machine » : une phrase propre à la raison que le serveur donne (Windows, un système
//   non lu, l'outil qui lit la santé des disques absent, trop ancien ou muet), jamais un chiffre ; « Ouvrir <l'appli> »
//   quand cela aide ; une raison inconnue garde la phrase générale. Les phrases vivent à un seul endroit (l'hôte commun).
// - Le tiroir « Ajouter un widget » range chaque widget dans le groupe où la maquette le range (logique.js) : une sorte
//   dit elle-même son groupe, le tiroir la suit.
// - L'écran de la maison : une sorte peut porter la marque « jamais sur l'écran de la maison » ; la règle unique
//   (admiseALaMaison) la lit, et « Copier vers l'autre écran » aussi. La marque ne fait que refuser.
// - La phrase d'aide du tiroir dit ce que fait l'écran (« ⋯ » ouvre « Régler »).
// - La fiche d'une appli : « Posé » dit une seule fois ; « Actions rapides » avant « Mettre en widget » (maquette).
// - Les actions rapides : le widget d'une appli, sa fiche et sa page choisissent les mêmes, par une seule règle,
//   prouvé sur toutes les applis réelles du catalogue.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { after, before, test } from 'node:test';
import vm from 'node:vm';
import type { Widget } from '../src/valhalla/modules/gladsheim.ts';
import { allModules, valhallaOf } from '../src/valhalla/odin.ts';
import { sourceOdin } from '../src/valhalla/widgets/source.ts';
import { admiseALaMaison, copiable, droitDeVoir, SORTES, sorteDe, type Lecteur, type SorteWidget } from '../src/valhalla/widgets/index.ts';
import { T as Banc } from './banc/lib.ts';
import { vraiOdin, type VraiOdin } from './banc/odin-vrai.ts';

const lire = (f: string) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
const RENDU = lire('src/web/pages/widgets-rendu.js'), TIROIR = lire('src/web/pages/accueil-tiroir.js'), FENETRE = lire('src/web/fenetre.js'), FICHE = lire('src/web/pages/fiche-appli.js');
const FAMILLES = readdirSync(new URL('../src/web/pages/', import.meta.url)).filter((f) => /^widgets-[a-z-]+\.js$/.test(f) && f !== 'widgets-rendu.js').sort();
const ici = <X>(x: X): X => (x && typeof x === 'object' ? JSON.parse(JSON.stringify(x)) : x);

/** Les scripts de la page, chargés sans document : les fichiers de famille, puis l'hôte commun, puis le tiroir. */
function page() {
  const window: Record<string, any> = {};
  for (const f of FAMILLES) vm.runInNewContext(lire(`src/web/pages/${f}`), { window });
  vm.runInNewContext(RENDU, { window });
  vm.runInNewContext(TIROIR, { window });
  return window;
}
const W = page(), R = W.OdinWidgetsRendu, OT = W.OdinTiroir;

// ------------------------------------------------------------------ « Odin ne sait pas lire cette machine »

const GENERALE = 'Odin ne sait pas encore lire cela.';
test('source absente : une phrase propre à chaque raison donnée par le serveur, jamais un chiffre ; « Ouvrir <l\'appli> » quand cela aide ; une raison inconnue garde la phrase générale', () => {
  const o = { appli: 'Tirésias', proprio: true, peutAgir: () => true };
  const raisons = ['windows_non_lu', 'systeme_non_lu', 'systeme_pas_encore_lu', 'smartctl_absent', 'smartctl_ancien', 'smartctl_muet'];
  const textes = new Set<string>();
  for (const raison of raisons) {
    const d = ici(R.decrire({ etat: 'source_absente', raison }, o));
    assert.notEqual(d.texte, GENERALE, `${raison} : pas la phrase générale`);
    assert.doesNotMatch(d.texte, /\d|%/, `${raison} : aucun chiffre`);
    textes.add(d.texte);
    if (raison.startsWith('smartctl_')) assert.equal(d.bouton?.texte, 'Ouvrir Tirésias', `${raison} : l'appli qui explique quoi faire`);
    else assert.equal(d.bouton, null, `${raison} : rien à faire depuis la carte, aucun bouton`);
  }
  assert.ok(textes.size >= 5, 'chaque cas a sa phrase (le système non lu, en deux codes, peut partager la sienne)');
  // Le bouton reste au propriétaire, et seulement si l'hôte sait le faire (jamais un bouton mort).
  assert.equal(ici(R.decrire({ etat: 'source_absente', raison: 'smartctl_absent' }, { ...o, proprio: false })).bouton, null);
  assert.equal(ici(R.decrire({ etat: 'source_absente', raison: 'smartctl_absent' }, { ...o, peutAgir: () => false })).bouton, null);
  // Sans nom d'appli connu : jamais « Ouvrir Cette appli ».
  assert.doesNotMatch(String(ici(R.decrire({ etat: 'source_absente', raison: 'smartctl_absent' }, { proprio: true, peutAgir: () => true })).bouton?.texte), /Cette appli/);
  assert.equal(ici(R.decrire({ etat: 'source_absente', raison: 'une_raison_de_demain' }, o)).texte, GENERALE, 'une raison inconnue : la phrase générale');
  // L'hôte de l'accueil sait ouvrir l'appli pour ces raisons (sinon, pas de bouton).
  for (const r of ['smartctl_absent', 'smartctl_ancien', 'smartctl_muet']) assert.match(FENETRE, new RegExp(`\\b${r}: \\(w\\) =>`), `fenetre.js sait faire « Ouvrir » pour ${r}`);
});

// ------------------------------------------------------------------ le tiroir range comme la maquette

/**
 * Le groupe de chaque sorte du tiroir dans la maquette (file-attente/maquette-accueil/logique.js, paintLib) : une sorte
 * de la maquette qui n'est pas le widget d'une appli va dans « Infos et repères » (fam « Infos ») ou « Odin » ; celle qui
 * est le widget d'une appli (clé = identifiant d'appli : écartée de `ext` par `!APP[id]`) va dans le groupe de la famille
 * de cette appli (« Applis · <famille> »). « appli » : le groupe de la famille de son appli.
 */
const MAQUETTE: Record<string, 'infos' | 'odin' | 'appli'> = {
  heure_petite: 'infos', // k-time
  'heure/horloge': 'infos', // clock
  meteo_petite: 'infos', // k-wx
  alertes: 'infos', // k-alerts
  sites_petit: 'infos', // k-sites
  raccourcis: 'odin', // launcher
  automatisations: 'odin', // autos
  taches_planifiees: 'appli', // draupnir
  agenda: 'appli', // frigg
  recherches: 'appli', // volva
  sauvegardes: 'appli', // sindri
  pubs_bloquees: 'appli', // vidarr
  alertes_liste: 'appli', // forseti
  sites: 'appli', // idunn
  sante_machine: 'appli', // eir
  sante_disques: 'appli', // durinn
  stockage: 'appli', // fensalir
};
test('le tiroir : chaque sorte dit elle-même son groupe, celui de la maquette ; le tiroir la suit, rien n\'est écrit par widget dans le tiroir', () => {
  const posables = ici(R.posables({ proprio: true, aDroit: () => true })) as Array<{ sorte: string; style: string; appli: string; groupe?: string }>;
  const vus = new Set<string>();
  for (const d of posables) {
    const cle = d.style ? `${d.sorte}/${d.style}` : d.sorte;
    if (!Object.hasOwn(MAQUETTE, cle)) continue;
    vus.add(cle);
    const attendu = MAQUETTE[cle];
    // Le groupe que le tiroir donne, pour une appli de la famille « Machines ».
    const g = R.groupeTiroir(d, d.appli ? 'Machines' : '');
    assert.equal(g, attendu === 'appli' ? 'Machines' : attendu, `${cle} : le groupe de la maquette`);
  }
  assert.deepEqual([...vus].sort(), Object.keys(MAQUETTE).sort(), 'chaque sorte du tableau est proposée');
  // Une sorte sans marque et sans appli : « Infos » ; une marque inconnue n'invente pas de groupe.
  assert.equal(R.groupeTiroir({ sorte: 'x', appli: '' }, ''), 'infos');
  assert.equal(R.groupeTiroir({ sorte: 'x', appli: 'y', groupe: 'nimporte' }, 'Données'), 'Données');
  // Le tiroir suit la marque : aucun identifiant de sorte écrit dans son code.
  const c = FENETRE.slice(FENETRE.indexOf('function catalogue()'), FENETRE.indexOf('function catalogue()') + 6000);
  assert.match(c, /R\.groupeTiroir\(/);
  for (const k of ['raccourcis', 'automatisations', 'sites_petit', 'stockage', 'sante_']) assert.doesNotMatch(c, new RegExp(k), `le tiroir n'écrit pas « ${k} »`);
});

// ------------------------------------------------------------------ l'écran de la maison, à un seul endroit

const MARQUEES = ['raccourcis', 'alertes_liste', 'sante_disques', 'stockage'];
/** La règle d'avant, sans la marque : ce qu'elle admettait, pour prouver que la marque ne fait que refuser. */
const avantMarque = (s: SorteWidget) => !s.accueilSeul && (s.public ?? 'proprietaire') !== 'proprietaire';
test('l\'écran de la maison : la marque « jamais sur l\'écran de la maison » est lue par la règle unique ; elle ne fait que refuser', () => {
  for (const k of MARQUEES) {
    const s = sorteDe(k)!;
    assert.equal(s.jamaisALaMaison, true, `${k} porte la marque`);
    assert.equal(admiseALaMaison(k), false, `${k} : jamais sur l'écran de la maison`);
    assert.equal(copiable(k), false, `${k} : ne se copie pas vers l'autre écran`);
    // Le propriétaire lui-même, sur l'écran de la maison : refusé, sans rien lire.
    const l: Lecteur = { qui: 'proprietaire', ecran: 'maison' }, w = { id: 'c9e00001', kind: k } as unknown as Widget;
    assert.equal(droitDeVoir(w, l, { appli: () => undefined })?.etat, 'refuse', `${k} : refusé au propriétaire sur l'écran de la maison`);
    // Sur son accueil : rien ne change.
    assert.equal(droitDeVoir(w, { qui: 'proprietaire', ecran: 'accueil' }, { appli: () => undefined }), undefined, `${k} : vu sur son accueil`);
  }
  // Aucune autre sorte ne change : celles qui n'ont pas la marque gardent la réponse d'avant, ou un refus.
  for (const s of SORTES as readonly SorteWidget[]) {
    if (s.jamaisALaMaison) { assert.ok(MARQUEES.includes(s.id), `${s.id} : marquée sans être dans la liste de l'essai`); continue; }
    if (!avantMarque(s)) assert.equal(admiseALaMaison(s.id), false, `${s.id} : refusée avant, refusée encore`);
  }
});

test('« Copier vers l\'autre écran » lit la marque de la sorte : refusé vers l\'écran de la maison, permis vers l\'accueil ; la page et le serveur portent la même marque', () => {
  const decl = ici(R.posables({ proprio: true, aDroit: () => true })) as Array<{ sorte: string; jamaisALaMaison?: boolean }>;
  const toutes = new Map<string, boolean>();
  for (const f of W.OdinWidgetsFamilles as Array<{ sortes: Array<{ sorte: string; jamaisALaMaison?: boolean }> }>) for (const d of f.sortes) toutes.set(d.sorte, toutes.get(d.sorte) || d.jamaisALaMaison === true);
  assert.ok(decl.length > 0);
  for (const [sorte, marque] of toutes) assert.equal(marque, sorteDe(sorte)?.jamaisALaMaison === true, `${sorte} : la même marque côté page et côté serveur`);
  for (const k of MARQUEES) {
    assert.equal(R.copieRefusee({ kind: k, privee: false, versMaison: true }), 'maison', `${k} : pas vers l'écran de la maison`);
    assert.equal(R.copieRefusee({ kind: k, privee: false, versMaison: false }), '', `${k} : vers l'accueil, permis`);
  }
  assert.equal(R.copieRefusee({ kind: 'sauvegardes', privee: false, versMaison: true }), '', 'une sorte sans marque : comme avant');
  assert.equal(R.copieRefusee({ kind: 'a_faire', privee: false, versMaison: true }), 'reservee', 'une sorte réservée : comme avant');
  // L'hôte passe la direction et a une phrase pour ce refus.
  assert.match(FENETRE, /R\.copieRefusee\(\{[^}]*versMaison/);
  assert.match(FENETRE, /refus === 'maison'/);
});

test('la fiche d\'une appli : l\'écran de la maison n\'y est pas encore offert ; le jour où il le sera, la marque est lue par le serveur (la grille de cet écran et le droit de voir passent par admiseALaMaison)', () => {
  assert.doesNotMatch(FICHE, /(['"`])[^'"`\n]*maison[^'"`\n]*\1/i, 'aucun choix « écran de la maison » dans la fiche (seuls ses commentaires en parlent)');
  const G = lire('src/valhalla/modules/gladsheim.ts');
  assert.match(G, /admiseALaMaison\(w!\.kind\)/, 'la grille de l\'écran de la maison ne garde que ce que la règle admet');
  assert.equal(admiseALaMaison('appli'), true, 'la sorte que pose la fiche n\'a pas la marque : le choix pourra être offert');
});

// ------------------------------------------------------------------ la phrase d'aide du tiroir

test('la phrase d\'aide du tiroir dit ce que fait l\'écran : « ⋯ » ouvre « Régler » (le bouton « ⚙ » n\'existe plus)', () => {
  const aide = String(OT.TEXTES.aide);
  assert.doesNotMatch(aide, /⚙/);
  assert.match(aide, /«\u00a0⋯\u00a0»/); assert.match(aide, /«\u00a0Régler\u00a0»/);
  // Un guillemet ne reste jamais seul en fin de ligne (regard d'écran à 390 px) : des espaces insécables à l'intérieur.
  assert.doesNotMatch(aide, /« | »/);
  assert.match(FENETRE, /T\.aide/, 'le tiroir l\'affiche');
});

// ------------------------------------------------------------------ la fiche d'une appli : l'ordre de ses blocs

test('la fiche d\'une appli : « Actions rapides » vient avant « Mettre en widget » (maquette, la fiche d\'une appli)', () => {
  const i = FICHE.indexOf('actionsRapides(m),'), j = FICHE.indexOf('mettreEnWidget(m)))');
  assert.ok(i > 0 && j > 0 && i < j, '« Actions rapides » d\'abord, puis « Mettre en widget »');
});

// ------------------------------------------------------------------ un vrai Odin, toutes ses applis réelles

const tt = new Banc(), orig = { log: console.log, error: console.error, warn: console.warn, info: console.info };
let v: VraiOdin;
const PAGE = 'b9e00001', APPLIS = ['b9e00002', 'b9e00003'];
/** Chaque sorte du tiroir à sa taille la plus petite (une carte par sorte), et le widget d'une appli. */
const PETITES = () => {
  const l: Array<Record<string, unknown>> = [];
  let n = 1;
  for (const s of SORTES as readonly SorteWidget[]) {
    if (!s.posable || s.accueilSeul || ['bouton', 'site', 'chiffres', 'section', 'heure'].includes(s.id)) continue;
    l.push({ id: `c9e${String(n++).padStart(5, '0')}`, kind: s.id, ...(s.id === 'appli' ? { module: 'gladsheim' } : {}), w: 1, c: s.taille.mini[0], r: s.taille.mini[1] });
  }
  l.push({ id: `c9e${String(n++).padStart(5, '0')}`, kind: 'heure', style: 'horloge', w: 1, c: 3, r: 2 });
  // Les chiffres d'une appli à leur largeur la plus petite (2 colonnes : 111 px à 768 px, regard d'écran).
  l.push({ id: `c9e${String(n++).padStart(5, '0')}`, kind: 'chiffres', module: 'midgard', w: 1, c: (sorteDe('chiffres') as SorteWidget).taille.mini[0], r: 2 });
  return l;
};
let ids: string[] = [];

before(async () => {
  for (const k of ['log', 'error', 'warn', 'info'] as const) console[k] = () => {};
  v = await vraiOdin(tt, { compte: true, modules: (o) => allModules(o) });
  const va = valhallaOf()!;
  ids = va.modules().map((m) => m.id);
  const parPage = (i: number) => ids.slice(i * 40, (i + 1) * 40).map((id, k) => ({ id: `ca${i}${String(k).padStart(5, '0')}`, kind: 'appli', module: id, w: 1, c: 3, r: 2 }));
  va.ctx('gladsheim').saveSettings({ fenetre: undefined });
  const r = await va.act('gladsheim', 'regler_fenetre', { fenetre: JSON.stringify({ pages: [{ id: PAGE, name: 'Petites', widgets: PETITES() }, ...APPLIS.map((p, i) => ({ id: p, name: `Applis ${i + 1}`, widgets: parPage(i) }))] }) });
  assert.equal(r.ok, true, r.text);
});
after(async () => { await tt.end(); Object.assign(console, orig); });

test('les actions rapides : le widget d\'une appli, sa fiche et sa page choisissent les mêmes, par une seule règle — appli par appli, sur toutes les applis réelles du catalogue', { timeout: 600_000 }, async () => {
  // La page de l'appli et la fiche : la règle de la page (valhalla.js), chargée sans document.
  const win: Record<string, any> = {};
  const doc = { readyState: 'loading', addEventListener() {}, createElementNS() { return { setAttribute() {} }; }, querySelector() { return null; }, getElementById() { return null; } };
  vm.runInNewContext(lire('src/web/valhalla.js'), { window: win, document: doc, localStorage: { getItem() { return null; }, setItem() {} }, addEventListener() {}, setTimeout, setInterval, location: { hash: '' }, navigator: {}, console: orig });
  const regle = win.OdinApps.actionsRapides as (actions: unknown, vue?: unknown) => Array<{ id: string }>;
  assert.equal(typeof regle, 'function');
  const cat = (await v.json('/api/valhalla/catalog')).body as { modules: Array<{ id: string; active: boolean; actions: unknown[] }> };
  const widgets = new Map<string, { etat: string; donnee?: { actions?: Array<{ id: string }> } }>();
  for (const p of APPLIS) {
    const r = await v.json(`/api/widgets/donnees?page=${p}`);
    assert.equal(r.status, 200);
    for (const w of (r.body.widgets as Array<{ id: string; etat: string; donnee?: { appli?: string; actions?: Array<{ id: string }> } }>)) if (w.donnee?.appli) widgets.set(w.donnee.appli, w);
  }
  let comparees = 0;
  const ecarts: string[] = [];
  for (const m of cat.modules) {
    if (!m.active) continue;
    const w = widgets.get(m.id);
    if (!w || w.etat !== 'ok') continue; // une appli qui ne répond pas : son widget n'a pas d'actions à comparer
    const vue = (await v.json(`/api/valhalla/view?id=${m.id}`)).body as { ok: boolean; view?: unknown; actions?: unknown[] };
    if (!vue.ok) continue;
    const surPage = regle(vue.actions, vue.view).map((a) => a.id).slice(0, 3);
    const fiche = regle(m.actions).map((a) => a.id).slice(0, 3);
    const widget = (w.donnee?.actions ?? []).map((a) => a.id);
    comparees++;
    if (JSON.stringify(widget) !== JSON.stringify(surPage) || JSON.stringify(fiche) !== JSON.stringify(surPage)) ecarts.push(`${m.id} : page ${surPage.join(',')} · fiche ${fiche.join(',')} · widget ${widget.join(',')}`);
  }
  assert.ok(comparees >= 40, `assez d'applis comparées (${comparees})`);
  assert.deepEqual(ecarts, [], 'le widget, la fiche et la page offrent les mêmes actions rapides');
});

test('les actions rapides : une seule règle dans la page — elle la donne à la fiche ; avec la vue de l\'appli, le réglage « poste » est rempli par la page et l\'action réservée à « Sur quel poste ? » n\'est pas offerte', () => {
  const VA = lire('src/web/valhalla.js');
  assert.equal((VA.match(/a\.quick !== false/g) ?? []).length, 1, 'écrite une fois dans la page');
  assert.match(VA, /const quick = actionsRapides\(r\.actions, v\)/, 'la barre de la page');
  assert.match(VA, /actionsRapides: \(actions, vue\) => actionsRapides\(actions, vue\)/, 'la fiche reçoit la même');
  const win: Record<string, any> = {};
  vm.runInNewContext(VA, { window: win, document: { readyState: 'loading', addEventListener() {}, createElementNS() { return { setAttribute() {} }; } }, localStorage: { getItem() { return null; } }, addEventListener() {}, setTimeout, setInterval, location: { hash: '' }, navigator: {}, console: orig });
  const A = [
    { id: 'pas_rapide', quick: false }, { id: 'requis', params: [{ key: 'q', required: true }] }, { id: 'au_poste', params: [{ key: 'poste', required: true }] },
    { id: 'reservee', params: [] }, { id: 'simple' },
  ];
  const ids = (vue?: unknown) => (win.OdinApps.actionsRapides(A, vue) as Array<{ id: string }>).map((a) => a.id);
  assert.deepEqual(ids(), ['au_poste', 'reservee', 'simple'].filter((x) => x !== 'au_poste'), 'sans vue : le réglage « poste » est à remplir');
  assert.deepEqual(ids({ postes: { actuel: '', choix: [], ensuite: { action: 'reservee' } } }), ['au_poste', 'simple'], 'avec « Sur quel poste ? » : le poste est rempli par la page, l\'action réservée n\'est pas offerte');
});

test('les actions rapides du widget d\'une appli : jamais une action au poste obligatoire (le widget n\'a pas de choix du poste et lance sans rien remplir : ce serait un bouton mort), même quand la vue de l\'appli a « Sur quel poste ? » ; jamais l\'action réservée à cet écran', async () => {
  const A = [
    { id: 'pas_rapide', label: 'Pas rapide', quick: false }, { id: 'requis', label: 'Requis', params: [{ key: 'q', required: true }] },
    { id: 'au_poste', label: 'Au poste', params: [{ key: 'poste', required: true }] }, { id: 'reservee', label: 'Réservée', params: [] }, { id: 'simple', label: 'Simple' },
  ];
  const faux = { module: (id: string) => (id === 'essai' ? { id: 'essai', name: 'Essai', family: 'Machines', what: 'Une appli d\'essai.', actions: A } : undefined), estActive: () => true, ctx: () => ({}) };
  const src = { ...sourceOdin(faux as never), alertesAVoir: undefined, vue: async () => ({ kpis: [], postes: { actuel: '', choix: [], ensuite: { action: 'reservee' } } }) } as never;
  const e = await sorteDe('appli')!.lire!({ id: 'c9e09001', kind: 'appli', module: 'essai' } as unknown as Widget, src, { qui: 'proprietaire', ecran: 'accueil' } as Lecteur);
  assert.equal(e.etat, 'ok');
  assert.deepEqual(((e as { donnee?: { actions?: Array<{ id: string }> } }).donnee?.actions ?? []).map((a) => a.id), ['simple']);
});

// ------------------------------------------------------------------ dans un vrai navigateur (s'il y en a un)

declare const document: any, window: any, MutationObserver: any, getComputedStyle: any;
interface Page {
  goto(u: string): Promise<unknown>; waitForSelector(s: string, o?: Record<string, unknown>): Promise<unknown>; click(s: string, o?: Record<string, unknown>): Promise<void>;
  waitForFunction(f: string | ((a: any) => unknown), a?: unknown, o?: Record<string, unknown>): Promise<unknown>; evaluate<X>(f: string | ((a?: any) => X), a?: unknown): Promise<X>;
  on(e: string, f: (x: any) => void): void; keyboard: { press(k: string): Promise<void> }; waitForTimeout(ms: number): Promise<void>;
}
interface Contexte { newPage(): Promise<Page>; addCookies(c: unknown[]): Promise<void>; addInitScript(f: string): Promise<void>; close(): Promise<void> }
interface Navigateur { newContext(o: Record<string, unknown>): Promise<Contexte>; close(): Promise<void> }
const pw = (() => { try { return createRequire(import.meta.url)('playwright') as { chromium: { launch(): Promise<Navigateur> } }; } catch { return undefined; } })();
const sansNav = pw ? false : 'Playwright n\'est pas installé sur cette machine';
let nav: Navigateur | undefined;
before(async () => { if (pw) nav = await pw.chromium.launch(); });
after(async () => { await nav?.close(); });

async function ouvrir(largeur: number, hash = '') {
  const ctx = await nav!.newContext({ viewport: { width: largeur, height: 900 } });
  const [n, ...x] = v.session.split('='); await ctx.addCookies([{ name: n, value: x.join('='), url: v.url, httpOnly: true, sameSite: 'Strict' }]);
  await ctx.addInitScript(`try { localStorage.setItem('odin.tour', 'done'); localStorage.setItem('odin.fenetre.page', '1'); localStorage.setItem('odin.applis.vue', 'applis'); } catch { /* rien */ }`);
  const p = await ctx.newPage(), erreurs: string[] = [];
  p.on('pageerror', (e) => erreurs.push(String(e)));
  await p.goto(`${v.url}/${hash}`);
  await p.waitForSelector('#app:not([hidden])', { timeout: 30000 });
  await p.waitForFunction(() => Boolean(window.OdinFenetre?.state?.().L), undefined, { timeout: 30000 });
  return { ctx, page: p, erreurs };
}

// L'en-tête d'une carte étroite, comme la maquette (logique.js, l'en-tête d'une carte ; style.css .wh) : la tuile, le
// titre et « ⋯ » sur une ligne ; le titre finit par « … » (son entier en info-bulle) ; « ⋯ » reste dans la carte ;
// « Ouvrir › » se pose sur la tuile au lieu de manger la place du titre. À 768 px (3 colonnes et 2 colonnes), 1024 et 320 px.
for (const [theme, largeur] of [['valhalla', 768], ['nuit', 768], ['valhalla', 1024], ['valhalla', 320]] as const) {
  test(`navigateur, ${largeur} px, thème ${theme} : chaque sorte du tiroir à sa taille la plus petite — l'en-tête sur une ligne (la tuile, le titre et « ⋯ » dans la carte), le titre fini par « … » avec son entier en info-bulle, le corps garde sa hauteur`, { skip: sansNav, timeout: 300_000 }, async () => {
    assert.equal((await valhallaOf()!.act('apparence', 'theme', { theme })).ok, true);
    const { ctx, page: p, erreurs } = await ouvrir(largeur);
    try {
      await p.waitForSelector('#feGrid > .fe-w .wr-h', { timeout: 60000 });
      await p.waitForTimeout(2500);
      const a = await p.evaluate(() => [...document.querySelectorAll('#feGrid > .fe-w')].map((c: any) => {
        const h = c.querySelector('.wr-h'), b = c.getBoundingClientRect(); if (!h) return { id: c.dataset.id, sansEntete: true };
        const cs = getComputedStyle(c), contenu = c.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
        const hr = h.getBoundingClientRect(), n = h.querySelector('.wr-n'), plus = h.querySelector('.wr-plus'), ic = h.querySelector(':scope > .wr-ic'), ouv = h.querySelector(':scope > .fe-open');
        const nr = n.getBoundingClientRect(), pr = plus?.getBoundingClientRect(), ns = getComputedStyle(n), orr = ouv?.getBoundingClientRect();
        return { id: c.dataset.id, large: Math.round(b.width), contenu: Math.round(contenu), haut: Math.round(hr.height), titre: n.textContent, bulle: n.title, titreLarge: Math.round(nr.width),
          points: ns.whiteSpace === 'nowrap' && ns.textOverflow === 'ellipsis',
          memeLigne: pr ? Math.abs((pr.top + pr.bottom) / 2 - (nr.top + nr.bottom) / 2) < 14 : null,
          plusDedans: pr ? pr.left >= b.left - 1 && pr.right <= b.right + 1 : null,
          tuile: ic ? ic.getBoundingClientRect().width > 0 : null,
          ouvrirAGauche: ouv && ouv.querySelector('.fe-open-mot') ? orr.left < nr.left + 10 : null,
          corps: Math.round(b.bottom - hr.bottom) };
      }));
      if (largeur === 768) { const etroites = a.filter((x: any) => !x.sansEntete && x.large < 200); assert.ok(etroites.length >= 8, `des cartes étroites (${etroites.length}) : ${JSON.stringify(a.map((x: any) => [x.id, x.large]))}`); }
      const fautes: string[] = [];
      for (const x of a as any[]) {
        if (x.sansEntete) continue;
        const qui = `${x.id} (${x.titre}, ${x.large} px)`;
        if (x.haut > 46) fautes.push(`${qui} : l'en-tête sur plus d'une ligne (${x.haut} px)`);
        if (x.memeLigne === false) fautes.push(`${qui} : « ⋯ » n'est pas sur la ligne du titre`);
        if (x.plusDedans === false) fautes.push(`${qui} : « ⋯ » sort de la carte`);
        if (!x.points) fautes.push(`${qui} : le titre ne finit pas par « … » sur une ligne`);
        if (x.titre && x.titreLarge < 24) fautes.push(`${qui} : le titre disparaît (${x.titreLarge} px)`);
        if (x.bulle !== x.titre) fautes.push(`${qui} : le titre entier n'est pas en info-bulle`);
        if (x.tuile === false && x.contenu > 130) fautes.push(`${qui} : la tuile a disparu (${x.contenu} px de contenu)`);
        if (x.contenu <= 220 && x.ouvrirAGauche === false) fautes.push(`${qui} : « Ouvrir › » prend la place du titre`);
        if (x.corps < 60) fautes.push(`${qui} : le corps perd sa hauteur (${x.corps} px)`);
      }
      assert.deepEqual(fautes, []);
      assert.deepEqual(erreurs, []);
    } finally { await ctx.close(); }
  });
}

test('navigateur : le tiroir range comme la maquette — « Raccourcis d\'applis » et « Automatisations » dans « Odin », « Sites en ligne » dans « Infos et repères », la santé et le stockage avec leur appli', { skip: sansNav, timeout: 120_000 }, async () => {
  const { ctx, page: p, erreurs } = await ouvrir(1280);
  try {
    await p.click('#fenetre .fe-mod'); await p.waitForSelector('#fenetre .fe-ajout');
    await p.click('#fenetre .fe-ajout'); await p.waitForFunction(() => document.querySelector('#feTiroir.open'));
    const groupes = await p.evaluate(() => { const o: Record<string, string> = {}; let g = ''; for (const n of document.querySelectorAll('#feTiroir .fe-tiroir-corps > *')) { if (n.tagName === 'H3') g = n.textContent.replace(/ · \d+$/, ''); else { const b = n.querySelector('b'); if (b) o[b.textContent] = g; } } return o; }) as Record<string, string>;
    assert.equal(groupes['Raccourcis d\'applis'], 'Odin'); assert.equal(groupes.Automatisations, 'Odin');
    assert.equal(groupes['Sites en ligne'], 'Infos et repères');
    for (const k of ['Santé de la machine', 'Santé des disques', 'Stockage']) assert.equal(groupes[k], 'Machines', k);
    // La puce « Odin » montre ce groupe seul.
    await p.click('#feTiroir .fe-chips button[data-f="odin"]');
    const seuls = await p.evaluate(() => [...document.querySelectorAll('#feTiroir .fe-it b')].map((b: any) => b.textContent)) as string[];
    assert.deepEqual(seuls.sort(), ['Automatisations', 'Raccourcis d\'applis']);
    assert.deepEqual(erreurs, []);
  } finally { await ctx.close(); }
});

test('navigateur : la fiche d\'une appli — « Actions rapides » avant « Mettre en widget » ; « Posé » est dit une seule fois', { skip: sansNav, timeout: 120_000 }, async () => {
  // Un accueil sans le widget de l'appli choisie (Hestia : une action rapide, activée).
  const va = valhallaOf()!; va.ctx('gladsheim').saveSettings({ fenetre: undefined });
  assert.equal((await va.act('gladsheim', 'regler_fenetre', { fenetre: JSON.stringify({ pages: [{ id: PAGE, name: 'Petites', widgets: [{ id: 'c9f00001', kind: 'heure', w: 1 }] }] }) })).ok, true);
  const nom = va.module('gladsheim')!.name;
  const { ctx, page: p, erreurs } = await ouvrir(1280, '#apps');
  try {
    await p.waitForSelector('#v-apps .va-appbtn', { timeout: 30000 });
    await p.waitForFunction(() => window.OdinFenetre?.peutPoser?.('gladsheim') === true, undefined, { timeout: 30000 });
    await p.keyboard.press('Shift');
    await p.evaluate((n: string) => ([...document.querySelectorAll('#v-apps .va-appbtn')].find((b: any) => [...b.querySelectorAll(':scope > span')].some((s: any) => s.textContent === n)) as any).focus(), nom);
    await p.waitForSelector('#odinFiche:not([hidden]) .fa-poser', { timeout: 10000 });
    const ordre = await p.evaluate(() => [...document.querySelectorAll('#odinFiche .fa-rapides-t, #odinFiche .fa-mettre h4')].map((n: any) => (n.classList.contains('fa-rapides-t') ? 'rapides' : 'mettre')));
    if (ordre.includes('rapides')) assert.deepEqual(ordre, ['rapides', 'mettre'], 'les actions rapides d\'abord');
    // Les annonces : chaque zone « status » de la page, relevée à chaque changement.
    await p.evaluate(() => { window.__dits = []; new MutationObserver(() => { for (const n of document.querySelectorAll('[role=status], [aria-live]')) { const t = n.textContent.trim(); if (/(^|[^a-zà-ÿ])posé/i.test(t) && !window.__dits.includes(`${n.id || n.className}|${t}`)) window.__dits.push(`${n.id || n.className}|${t}`); } }).observe(document.body, { subtree: true, childList: true, characterData: true }); });
    await p.click('#odinFiche .fa-poser');
    await p.waitForFunction(() => /Posé/.test(document.querySelector('#odinFiche .fa-mettre .fa-dit')?.textContent ?? ''), undefined, { timeout: 20000 });
    await p.waitForTimeout(2500);
    const dits = await p.evaluate(() => window.__dits) as string[];
    assert.equal(dits.length, 1, `« Posé » dit une fois : ${JSON.stringify(dits)}`);
    assert.deepEqual(erreurs, []);
  } finally { await ctx.close(); }
});
