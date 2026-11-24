// Aujourd'hui en widgets (maquette validée « Accueil », lot 26) : « Tu veux sans doute », « À faire » et « Ce qu'Odin a
// fait » sont trois widgets d'une première page de la fenêtre, rangée sous un code (son nom vient de l'interface).
// Prouvé ici :
// - les trois sortes sont posables, toujours réservées à l'accueil du propriétaire ; « Comment Odin se comporte » les
//   rejoint au lot 27 (test/accueil-comportement.test.ts) ; leur donnée n'est pas relue par le serveur (elle est dans l'état de la page du propriétaire) ;
// - la fenêtre de départ commence par la page « Aujourd'hui » ; une fenêtre rangée avant ce lot la reçoit une seule
//   fois, en premier, sans rien déplacer du reste ; « À faire » rangé ne se retire plus ;
// - une page sous un code : nom vide dans la donnée, ne compte pas dans les huit pages ; elle peut être marquée
//   « Écran de la maison » (validé le 24/11), ses trois widgets n'y vont jamais ;
// - un membre ne reçoit ni ces widgets ni cette page ; l'écran de la maison ne les sert à personne ;
// - dans un vrai navigateur (s'il y en a un) : chaque bloc est dans son widget, plus dans l'ancienne colonne ; la cloche
//   mène à « À faire » depuis une autre page ; une demande d'accès en attente ouvre la page qui porte « À faire » ; un
//   widget retiré ne revient pas dessous, il se repose depuis le tiroir ; un membre garde ses blocs d'avant ; 390 px.
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { after, before, test } from 'node:test';
import vm from 'node:vm';
import { PAGES_MAX, TAILLE_SORTE, avecAujourdhui, cleanLayout, defaultLayout, nomPage, sansAccueilDuProprietaire, type FPage, type Layout, type Widget } from '../src/valhalla/modules/gladsheim.ts';
import { allModules, valhallaOf } from '../src/valhalla/odin.ts';
import { lierProprietaire, persona } from '../src/valhalla/sso/etat.ts';
import { CODES_PAGES, PAGE_AUJOURDHUI } from '../src/valhalla/widgets/aujourdhui.ts';
import { copiable, donneeWidget, publicDe, servieALaMaison, sorteDe, sortesPosables, type Lecteur, type SourceWidget } from '../src/valhalla/widgets/index.ts';
import { T as Banc } from './banc/lib.ts';
import { vraiOdin, type VraiOdin } from './banc/odin-vrai.ts';

const lire = (f: string) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
const FE = lire('src/web/fenetre.js'), UI = lire('src/web/ui.html'), RENDU = lire('src/web/pages/widgets-rendu.js'), GRILLE = lire('src/web/pages/accueil-grille.js');
const TROIS = ['tu_veux', 'a_faire', 'odin_a_fait'] as const;
const IDS = ['gladsheim', 'midgard', 'vordr', 'var'];
const sortes = (l: Layout) => l.pages.map((p) => p.widgets.map((w: any) => w.kind));
/** Une fenêtre rangée avant ce lot : deux pages, sans rien du jour. */
const ANCIENNE = (): Layout => cleanLayout({ pages: [
  { id: 'b1000001', name: 'Maison', maison: true, widgets: [{ id: 'c1000001', kind: 'heure', w: 1 }, { id: 'c1000002', kind: 'meteo', w: 2 }] },
  { id: 'b1000002', name: 'Réseau', widgets: [{ id: 'c1000003', kind: 'chiffres', w: 1, module: 'midgard', label: 'Mes appareils' }] },
] }, IDS);

// ------------------------------------------------------------------ les sortes

test('les trois blocs du jour sont posables, toujours réservés à l\'accueil du propriétaire ; « Comment Odin se comporte » les rejoint au lot 27', () => {
  for (const k of TROIS) {
    const s = sorteDe(k)!;
    assert.equal(s.posable, true, `${k} posable`); assert.equal(s.famille, 'aujourdhui'); assert.equal(s.accueilSeul, true); assert.equal(publicDe(s), 'proprietaire');
    assert.equal(copiable(k), false, `${k} ne se copie pas vers l'autre écran`); assert.equal(servieALaMaison(k), false, `${k} jamais à /maison`);
    assert.deepEqual(s.applis, [], 'aucune appli derrière');
  }
  assert.equal(sorteDe('a_faire')!.fixe, true, '« À faire » se déplace mais ne se retire pas');
  assert.equal(sorteDe('odin_a_fait')!.fixe, undefined); assert.equal(sorteDe('tu_veux')!.fixe, undefined);
  assert.equal(sorteDe('comportement')!.posable, true, 'lot 27 : posable lui aussi (test/accueil-comportement.test.ts)');
  assert.deepEqual(sortesPosables().filter((x) => x.famille === 'aujourdhui').map((x: any) => x.id).sort(), [...TROIS, 'comportement'].sort());
  // La page a les mêmes tailles que le serveur (pages/accueil-grille.js).
  const win: Record<string, unknown> = {}; vm.runInNewContext(GRILLE, { window: win, matchMedia: () => ({ matches: false }), crypto: globalThis.crypto });
  const G = win.OdinGrille as { MINI: Record<string, number[]>; HAUTEUR: Record<string, number> };
  for (const k of TROIS) { assert.deepEqual([...G.MINI[k]], TAILLE_SORTE[k].mini, `${k} : même mini`); assert.equal(G.HAUTEUR[k], TAILLE_SORTE[k].r, `${k} : même hauteur de départ`); }
});

test('leur donnée : au propriétaire sur son accueil, « dans l\'état de sa page », sans un chiffre ; à tout autre, refusée, sans rien lire', async () => {
  const lus: string[] = [];
  const src: SourceWidget = { appli: (id) => { lus.push(id); return undefined; }, vue: async (id) => { lus.push(id); return null; }, action: () => undefined, meteo: async () => undefined, lieu: () => ({ choisi: false, nom: '', fuseau: '', heure12: false }), maintenant: () => 5 };
  const W = (kind: string) => ({ id: 'e2000001', kind, w: 1, c: 6, r: 4 }) as unknown as Widget;
  for (const k of TROIS) {
    assert.deepEqual(await donneeWidget(W(k), { qui: 'proprietaire', ecran: 'accueil' }, src), { etat: 'ok', at: 5, donnee: { source: 'etat' } }, k);
    const autres: Lecteur[] = [{ qui: 'membre', ecran: 'accueil', peutLire: () => true, ouverts: new Set(['e2000001@gladsheim']) }, { qui: 'maison', ecran: 'maison' }, { qui: 'proprietaire', ecran: 'maison' }, { qui: 'maison', ecran: 'accueil' }];
    for (const l of autres) assert.deepEqual(await donneeWidget(W(k), l, src), { etat: 'refuse', raison: 'accueil_du_proprietaire' }, `${k} refusé à ${l.qui} sur ${l.ecran}`);
  }
  assert.deepEqual(await donneeWidget(W('comportement'), { qui: 'proprietaire', ecran: 'accueil' }, src), { etat: 'ok', at: 5, donnee: { source: 'etat' } }, 'lot 27 : comme les trois autres');
  assert.deepEqual(lus, [], 'rien n\'est lu chez une appli');
});

// ------------------------------------------------------------------ la page « Aujourd'hui »

test('la fenêtre de départ commence par la page « Aujourd\'hui » : rangée sous un code, sans nom dans la donnée, avec ses widgets', () => {
  const d = defaultLayout(['vidarr', 'midgard', 'ymir']), p = d.pages[0];
  assert.equal(p.code, 'aujourdhui'); assert.equal(p.name, '', 'son nom n\'est pas dans la donnée'); assert.equal(p.maison, undefined); assert.equal(p.id, PAGE_AUJOURDHUI.id);
  assert.deepEqual(p.widgets.map((w: any) => [w.id, w.kind, w.c, w.r]), [['0a0f0001', 'tu_veux', 12, 2], ['0a0f0002', 'a_faire', 6, 4], ['0a0f0003', 'odin_a_fait', 6, 4], ['0a0f0004', 'comportement', 12, 2]]);
  assert.deepEqual(d.pages.slice(1).map((x: any) => x.name), ['Maison', 'Réseau', 'Machines'], 'les pages d\'avant suivent, dans le même ordre');
  assert.ok(d.pages.slice(1).every((x: any) => !x.code));
  // Deux lectures de la fenêtre de départ : les mêmes identifiants pour cette page (la page et la route des widgets s'y retrouvent).
  assert.deepEqual(defaultLayout([]).pages[0], p);
  assert.deepEqual(cleanLayout(JSON.parse(JSON.stringify(d)), ['vidarr', 'midgard', 'ymir']), d, 'relue, elle ne change pas');
  assert.equal(nomPage(p), 'Aujourd\'hui'); assert.equal(nomPage({ name: 'Ma journée', code: 'aujourdhui' }), 'Ma journée'); assert.equal(nomPage({ name: 'Réseau' }), 'Réseau');
  assert.deepEqual([...CODES_PAGES], ['aujourdhui']);
});

test('une fenêtre rangée avant ce lot reçoit la page une seule fois, en premier, sans rien déplacer', () => {
  const avant = ANCIENNE(), apres = avecAujourdhui(avant);
  assert.equal(apres.pages.length, 3); assert.equal(apres.pages[0].code, 'aujourdhui');
  assert.deepEqual(apres.pages.slice(1), avant.pages, 'ses pages, ses widgets, leurs tailles : rien n\'a bougé');
  assert.deepEqual(sortes(apres)[0], [...TROIS, 'comportement'], 'et, depuis le lot 27, « Comment Odin se comporte » en dernier');
  assert.equal(avecAujourdhui(apres), apres, 'déjà reçue : rien de plus');
  // Les deux autres widgets retirés, « À faire » déplacé, la page supprimée : la fenêtre porte « À faire », rien ne revient.
  // (Rangée par la page d'aujourd'hui, elle porte la marque de ce qu'elle a reçu : lot 27.)
  const rangee: Layout = { accueil: apres.accueil, pages: [{ ...avant.pages[0], widgets: [...avant.pages[0].widgets, apres.pages[0].widgets[1]] }, avant.pages[1]] };
  assert.equal(avecAujourdhui(rangee), rangee);
  assert.deepEqual(sortes(avecAujourdhui(cleanLayout(JSON.parse(JSON.stringify(rangee)), IDS))), [['heure', 'meteo', 'a_faire'], ['chiffres']]);
  // Une page sous le code, mais sans « À faire » (une donnée abîmée) : elle est remplacée, pas doublée.
  const abimee = avecAujourdhui({ pages: [{ id: 'b1000009', name: '', code: 'aujourdhui', widgets: [] }, ...avant.pages] });
  assert.deepEqual(abimee.pages.map((p) => p.code ?? ''), ['aujourdhui', '', '']); assert.deepEqual(sortes(abimee)[0], [...TROIS, 'comportement']);
});

test('une page sous un code : gardée par cleanLayout, « Écran de la maison » si le propriétaire l\'a marquée, hors des huit pages ; un seul widget de chaque sorte réservée', () => {
  const page = (o: Record<string, unknown>) => ({ name: 'P', widgets: [{ kind: 'heure' }], ...o });
  const l = cleanLayout({ pages: [page({ code: 'aujourdhui', name: '', maison: true, widgets: [{ kind: 'a_faire', label: 'x'.repeat(90) }] }), page({ code: 'inventee' }), page({ code: 'aujourdhui' }), page({ code: 'constructor' })] }, IDS);
  assert.deepEqual(l.pages.map((p) => [p.code, p.name, p.maison]), [['aujourdhui', '', true], [undefined, 'P', undefined], [undefined, 'P', undefined], [undefined, 'P', undefined]], 'un code inconnu, ou le même code deux fois : une page ordinaire');
  assert.equal(l.pages[0].widgets[0].label?.length, 40, 'un titre coupé à 40 signes');
  assert.equal(cleanLayout({ pages: [page({ code: 'aujourdhui', name: 'Ma journée' })] }, IDS).pages[0].name, 'Ma journée', 'renommée par le propriétaire : son nom est gardé');
  assert.equal(cleanLayout({ pages: [page({ name: '' })] }, IDS).pages[0].name, 'Page 1', 'une page ordinaire a toujours un nom');
  // Huit pages du propriétaire, plus la page sous un code, où qu'elle soit dans la liste.
  const neuf = cleanLayout({ pages: [...Array.from({ length: 12 }, (_, i) => page({ name: `P${i}` })), page({ code: 'aujourdhui', widgets: [{ kind: 'a_faire' }] })] }, IDS);
  assert.equal(PAGES_MAX, 8); assert.equal(neuf.pages.length, 9); assert.equal(neuf.pages[8].code, 'aujourdhui'); assert.deepEqual(neuf.pages.slice(0, 8).map((p) => p.name), ['P0', 'P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7']);
  assert.equal(cleanLayout({ pages: Array.from({ length: 200 }, () => page({})) }, IDS).pages.length, 8);
  // Une seule de chaque sorte réservée dans toute la fenêtre (la première est gardée).
  const d = cleanLayout({ pages: [page({ widgets: [{ id: 'd1000001', kind: 'a_faire' }, { kind: 'a_faire' }, { kind: 'tu_veux' }] }), page({ widgets: [{ kind: 'a_faire' }, { kind: 'tu_veux' }, { kind: 'odin_a_fait' }, { kind: 'heure' }, { kind: 'heure' }] })] }, IDS);
  assert.deepEqual(sortes(d), [['a_faire', 'tu_veux'], ['odin_a_fait', 'heure', 'heure']]); assert.equal(d.pages[0].widgets[0].id, 'd1000001');
  assert.equal(cleanLayout({ pages: [page({ widgets: [{ kind: 'comportement' }] })] }, IDS).pages[0].widgets.length, 1, '« Comment Odin se comporte » : posable depuis le lot 27');
});

test('un autre que le propriétaire ne reçoit ni ces widgets, ni la page qu\'ils laissent vide', () => {
  const l = avecAujourdhui(ANCIENNE()), servi = sansAccueilDuProprietaire(l);
  assert.deepEqual(servi.pages, ANCIENNE().pages, 'ses pages d\'avant, rien d\'autre');
  assert.equal(l.pages.length, 3, 'la fenêtre gardée n\'est pas touchée');
  // « À faire » déplacé sur une autre page : il en est retiré, la page reste ; un widget ordinaire posé sur « Aujourd'hui » la garde.
  const melee: Layout = { pages: [{ ...l.pages[0], widgets: [l.pages[0].widgets[0], ANCIENNE().pages[0].widgets[0]] }, { ...l.pages[1], widgets: [...l.pages[1].widgets, l.pages[0].widgets[1]] }] };
  assert.deepEqual(sortes(sansAccueilDuProprietaire(melee)), [['heure'], ['heure', 'meteo']]);
  // Il reste toujours une page.
  const seule = sansAccueilDuProprietaire({ pages: [l.pages[0]] });
  assert.equal(seule.pages.length, 1); assert.deepEqual(seule.pages[0].widgets, []);
});

// ------------------------------------------------------------------ la lecture des fichiers de la page

test('la page : les titres et le nom de la page dans le dictionnaire ; chaque bloc posé dans son widget, sinon à son ancienne place', () => {
  assert.match(FE, /a_faire: 'À faire', odin_a_fait: 'Ce qu\\'Odin a fait', tu_veux: 'Tu veux sans doute'/, 'les trois titres');
  assert.match(FE, /pages: \{ aujourdhui: 'Aujourd\\'hui' \}/, 'le nom de la page vient de l\'interface');
  assert.match(FE, /const nomDe = \(p\) => p\?\.name \|\| TXT\.pages\[p\?\.code\] \|\| '';/);
  assert.match(FE, /document\.dispatchEvent\(new CustomEvent\('odin:fenetre'\)\)/, 'la fenêtre prévient après chaque dessin');
  assert.doesNotMatch(FE, /page\(\)\.code \? null : el\('button'/, '« Écran de la maison » est offert aussi pour la page sous un code (validé le 24/11)');
  assert.match(FE, /title: page\(\)\.code \? TXT\.maisonJour : /, 'et son bouton dit que les trois widgets du jour n\'y vont jamais');
  // ui.html : les trois blocs vont dans leur widget quand la fenêtre les tient ; sinon ils restent dans #todayBox.
  const i = UI.indexOf('  function renderToday('), t = UI.slice(i, UI.indexOf('\n  }\n', i));
  assert.match(t, /const fen = window\.OdinFenetre\?\.aujourdhui\?\.\(\) \?\? null;/);
  assert.match(t, /for \(const \[k, bloc\] of \[\['tu_veux', guesses\], \['a_faire', todo\], \['odin_a_fait', feed\]\]\) fen\.hote\(k\)\?\.replaceChildren\(/);
  assert.match(t, /box\.replaceChildren\(\.\.\.\(fen \? \[\] : \[guesses \|\| '', ctrls, el\('div', \{ class: 'today-cols' \}, todo, feed\)\]\)\);/, 'pour le propriétaire, plus rien dessous : « Comment Odin se comporte » est un widget lui aussi (lot 27)');
  assert.match(UI, /document\.addEventListener\('odin:fenetre', \(\) => \{ if \(dernierJour\) renderToday\(\.\.\.dernierJour\); ouvrirSurAFaire\(\); \}\);/);
  // Le texte de « rien à proposer » est avec ceux des autres états, au seul endroit.
  assert.match(RENDU, /rien_propose: \['Rien à proposer pour l\\'instant\.', ''\]/);
  assert.doesNotMatch(UI, /Rien à proposer/);
});

// ------------------------------------------------------------------ un vrai Odin d'essai

const tt = new Banc(), orig = { log: console.log, error: console.error, warn: console.warn };
let v: VraiOdin, membre = '';
const MDP = 'un-manguier-au-bord-du-chemin-64';
const cookieDe = (r: Response, nom: string) => r.headers.getSetCookie().find((c) => c.startsWith(`${nom}=`))?.split(';')[0] ?? '';
async function entrer(ident: string, mdp: string): Promise<string> {
  let r = await fetch(`${v.url}/sso/odin`, { redirect: 'manual' }); assert.equal(r.status, 303);
  r = await fetch(new URL(r.headers.get('location')!, v.url), { redirect: 'manual' }); const demande = /name="demande" value="([^"]+)"/.exec(await r.text())![1];
  r = await fetch(`${v.url}/sso/autoriser`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded', origin: v.url }, body: new URLSearchParams({ demande, identifiant: ident, motdepasse: mdp }) });
  r = await fetch(r.headers.get('location')!, { redirect: 'manual' }); assert.equal(r.status, 303, 'session ouverte');
  return cookieDe(r, 'odin_session');
}
const g = () => valhallaOf()!.ctx('gladsheim');
const ranger = (f: unknown) => valhallaOf()!.act('gladsheim', 'regler_fenetre', { fenetre: JSON.stringify(f) });
const lue = async (cookie?: string) => { const r = await v.json('/api/valhalla/act', { module: 'gladsheim', action: 'fenetre', input: {} }, cookie ? { cookie } : {}); assert.equal(r.body.ok, true, JSON.stringify(r.body)); return r.body as unknown as { text: string; data: Layout }; };
/** Remet l'Odin d'essai comme au premier jour : aucune fenêtre rangée. */
const oublier = () => g().saveSettings({ fenetre: undefined });

before(async () => {
  for (const k of ['log', 'error', 'warn'] as const) console[k] = () => {};
  v = await vraiOdin(tt, { compte: true, modules: (o) => allModules(o).filter((m) => IDS.includes(m.id)) });
  const va = valhallaOf()!;
  assert.equal((await va.act('var', 'ajouter', { login: 'membre-j', nom: 'Membre J', groupes: 'invite', mot_de_passe: MDP })).ok, true);
  for (const appli of ['odin', 'gladsheim', 'midgard']) assert.equal((await va.act('var', 'donner_acces', { appli, qui: '@membre-j' })).ok, true);
  lierProprietaire(persona()!);
  membre = await entrer('membre-j', MDP); assert.ok(membre, 'le membre a une session');
});
after(async () => { await tt.end(); Object.assign(console, orig); });

test('Odin neuf : le propriétaire lit la page « Aujourd\'hui » en premier, et la route des widgets parle des mêmes widgets', async () => {
  oublier();
  const f = await lue();
  assert.equal(f.data.pages[0].code, 'aujourdhui'); assert.deepEqual(sortes(f.data)[0], [...TROIS, 'comportement']);
  assert.match(f.text, /^- Aujourd'hui : 4 module\(s\)/, 'Odin dit le nom de la page');
  const r = await v.json(`/api/widgets/donnees?page=${PAGE_AUJOURDHUI.id}`);
  assert.equal(r.status, 200); assert.equal(r.body.qui, 'proprietaire');
  const ws = r.body.widgets as Array<Record<string, unknown>>;
  assert.deepEqual(ws.map((x: any) => [x.id, x.kind, x.etat, JSON.stringify(x.donnee)]), f.data.pages[0].widgets.map((w: any) => [w.id, w.kind, 'ok', '{"source":"etat"}']));
  assert.equal(g().settings.fenetre, undefined, 'lire ne range rien');
});

test('une fenêtre rangée avant ce lot : la page arrive à la lecture ; rangée telle qu\'avant, elle n\'est pas refusée ; rangée avec « À faire », il ne se retire plus', async () => {
  oublier();
  const ancienne = ANCIENNE();
  // Comme une page ouverte avant la mise à jour : elle range sa fenêtre sans « À faire ». Ce n'est pas un retrait.
  const r1 = await ranger(ancienne); assert.equal(r1.ok, true, r1.text);
  assert.match(r1.text, /^✓ Fenêtre rangée : Aujourd'hui \(4\), Maison \(2\), Réseau \(1\)\.$/);
  assert.deepEqual((r1.data as Layout).pages.slice(1), ancienne.pages); assert.equal((r1.data as Layout).pages[0].code, 'aujourdhui');
  assert.deepEqual((g().settings.fenetre as Layout).pages, ancienne.pages, 'ce qui est gardé est ce qui a été envoyé');
  const f = await lue();
  assert.deepEqual(f.data.pages.slice(1), ancienne.pages, 'rien n\'a bougé'); assert.deepEqual(f.data.pages[0], defaultLayout([]).pages[0], 'la même page qu\'au départ, mêmes identifiants');
  assert.equal((await ranger(ancienne)).ok, true, 'encore une fois : toujours pas un retrait');
  // « Terminé » depuis la page d'aujourd'hui : la fenêtre lue, avec « À faire » déplacé sur « Maison » et « Tu veux sans doute » retiré.
  const mienne: Layout = JSON.parse(JSON.stringify(f.data));
  const aFaire = mienne.pages[0].widgets.find((w) => w.kind === 'a_faire')!;
  mienne.pages[0].widgets = mienne.pages[0].widgets.filter((w: any) => w.kind === 'odin_a_fait'); mienne.pages[1].widgets.push(aFaire);
  const r2 = await ranger(mienne); assert.equal(r2.ok, true, r2.text);
  const gardee = g().settings.fenetre as Layout;
  assert.deepEqual(sortes(gardee), [['odin_a_fait'], ['heure', 'meteo', 'a_faire'], ['chiffres']]); assert.equal(gardee.pages[0].code, 'aujourdhui'); assert.equal(gardee.pages[0].name, '');
  assert.deepEqual(sortes((await lue()).data), sortes(gardee), 'relue : rien ne revient (ni la page, ni « Tu veux sans doute »)');
  // Maintenant qu'il est rangé, le retirer est refusé (constat M11), d'où que vienne la demande.
  const r3 = await ranger(ancienne); assert.equal(r3.ok, false); assert.match(String(r3.text ?? (r3 as { error?: string }).error), /« À faire » se déplace mais ne se retire pas/);
  const sansPage = JSON.parse(JSON.stringify(gardee)) as Layout; sansPage.pages[1].widgets = sansPage.pages[1].widgets.filter((w: any) => w.kind !== 'a_faire');
  assert.equal((await ranger(sansPage)).ok, false, 'retiré de sa page : refusé');
  assert.deepEqual(sortes(g().settings.fenetre as Layout), sortes(gardee), 'rien n\'a changé');
  // La page sous un code se supprime si « À faire » n'y est plus ; elle ne revient pas.
  const sansAuj = JSON.parse(JSON.stringify(gardee)) as Layout; sansAuj.pages.shift();
  assert.equal((await ranger(sansAuj)).ok, true);
  assert.deepEqual((await lue()).data.pages.map((p) => p.code ?? p.name), ['Maison', 'Réseau']);
});

test('un membre : ni les trois widgets ni leur page dans sa fenêtre, rien d\'eux par la route des widgets ; l\'écran de la maison ne les sert à personne', async () => {
  oublier();
  const moi = await lue(), lui = await lue(membre);
  assert.equal(moi.data.pages[0].code, 'aujourdhui');
  assert.ok(lui.data.pages.length >= 1); assert.ok(lui.data.pages.every((p) => !p.code), 'pas de page « Aujourd\'hui » pour lui');
  assert.ok(!JSON.stringify(lui).match(/a_faire|odin_a_fait|tu_veux|0a0f000|Aujourd'hui/), 'ni les sortes, ni leurs identifiants, ni le nom de la page');
  assert.deepEqual(lui.data.pages.map((p) => [p.name, p.widgets.length]), moi.data.pages.slice(1).map((p) => [p.name, p.widgets.length]), 'ses pages sont celles du propriétaire, sans celle-là');
  const r = await v.json('/api/widgets/donnees', undefined, { cookie: membre });
  assert.equal(r.status, 200); assert.equal(r.body.qui, 'membre');
  assert.ok(!JSON.stringify(r.body).match(/a_faire|odin_a_fait|tu_veux|0a0f000/));
  assert.equal((await v.json(`/api/widgets/donnees?page=${PAGE_AUJOURDHUI.id}`, undefined, { cookie: membre })).body.widgets?.toString(), '', 'même en demandant la page par son identifiant');
  // « À faire » déplacé par le propriétaire sur une page « Écran de la maison » : /api/maison/etat ne le rend à personne.
  const f: Layout = JSON.parse(JSON.stringify(moi.data)); const maison = f.pages.find((p) => p.maison)!;
  maison.widgets.push(...f.pages[0].widgets.splice(0)); f.pages.shift();
  assert.equal((await ranger(f)).ok, true);
  const cle = ((await valhallaOf()!.act('gladsheim', 'cle_tablette', { nom: 'Tablette du jour', droits: 'complet' })).data as { key: string }).key;
  for (const h of [{}, { cookie: '', 'x-odin-maison': cle }] as Array<Record<string, string>>) {
    const e = await v.json('/api/maison/etat', undefined, h); assert.equal(e.status, 200);
    const servis = ((e.body.fenetre as FPage[]) ?? []).flatMap((p) => p.widgets.map((w: any) => w.kind as string));
    assert.ok(servis.includes('heure'), 'la page est bien servie'); assert.ok(!servis.some((k: any) => (TROIS as readonly string[]).includes(k)), 'sans les blocs du jour');
  }
  oublier();
});

// ------------------------------------------------------------------ dans un vrai navigateur (s'il y en a un)

declare const document: any, window: any, innerHeight: number, getComputedStyle: any;
interface Page {
  goto(u: string): Promise<unknown>; waitForSelector(s: string, o?: Record<string, unknown>): Promise<unknown>; click(s: string): Promise<void>; tap(s: string): Promise<void>; focus(s: string): Promise<void>;
  waitForFunction(f: string | ((a: any) => unknown), a?: unknown, o?: Record<string, unknown>): Promise<unknown>; evaluate<X>(f: string | (() => X)): Promise<X>;
  keyboard: { press(k: string): Promise<void> }; waitForTimeout(ms: number): Promise<void>; on(e: string, f: (x: Error) => void): void; screenshot(o: Record<string, unknown>): Promise<unknown>;
}
interface Contexte { newPage(): Promise<Page>; addCookies(c: unknown[]): Promise<void>; addInitScript(f: string | (() => void)): Promise<void>; close(): Promise<void> }
interface Navigateur { newContext(o: Record<string, unknown>): Promise<Contexte>; close(): Promise<void> }
const pw = (() => { try { return createRequire(import.meta.url)('playwright') as { chromium: { launch(): Promise<Navigateur> } }; } catch { return undefined; } })();
const sans = pw ? false : 'Playwright n\'est pas installé sur cette machine';
let nav: Navigateur | undefined;
before(async () => { if (pw) nav = await pw.chromium.launch(); });
after(async () => { await nav?.close(); });
// Captures facultatives (ODIN_CAPTURES=<dossier>) : pour regarder l'écran, jamais exigées par l'essai.
const CAPTURES = process.env.ODIN_CAPTURES;
const capture = async (p: Page, nom: string) => { if (!CAPTURES) return; mkdirSync(CAPTURES, { recursive: true }); await p.screenshot({ path: `${CAPTURES}/${nom}.png`, fullPage: true }); };

async function ouvrirPage(largeur: number, o: { cookie?: string; onglet?: number; sombre?: boolean; attendre?: string } = {}) {
  const doigt = largeur < 500;
  const ctx = await nav!.newContext({ viewport: { width: largeur, height: doigt ? 800 : 900 }, hasTouch: doigt, isMobile: doigt, locale: 'fr-FR', colorScheme: o.sombre ? 'dark' : 'light' });
  const [n, ...x] = (o.cookie ?? v.session).split('='); await ctx.addCookies([{ name: n, value: x.join('='), url: v.url, httpOnly: true, sameSite: 'Strict' }]);
  await ctx.addInitScript(`try { localStorage.setItem('odin.tour', 'done'); ${o.onglet === undefined ? '' : `localStorage.setItem('odin.fenetre.page', '${o.onglet}');`} ${o.sombre ? 'localStorage.setItem(\'odin.theme\', \'sombre\');' : ''} } catch { /* rien */ }`);
  const page = await ctx.newPage(), erreurs: string[] = [];
  page.on('pageerror', (e) => erreurs.push(String(e)));
  await page.goto(v.url + '/');
  await page.waitForSelector('#app:not([hidden])', { timeout: 30000 });
  try { await page.waitForSelector(o.attendre ?? '#feGrid .fe-w', { timeout: 45000 }); } catch (e) {
    // Ce que la page montrait à la place (pour comprendre un échec sous forte charge).
    const etat = await page.evaluate(() => { const f = document.getElementById('fenetre'), r = (n: any) => { const b = n?.getBoundingClientRect?.(); return b ? [Math.round(b.width), Math.round(b.height)] : null; }; return JSON.stringify({ vue: document.querySelector('.view.on, section.on')?.id, fenetre: r(f), grille: r(document.getElementById('feGrid')), style: f ? getComputedStyle(f).display : '', parents: (() => { const l = []; for (let n = f; n && n !== document.body; n = n.parentElement) l.push(`${n.tagName}#${n.id}.${n.className}:${getComputedStyle(n).display}`); return l; })(), html: f?.outerHTML.slice(0, 600) }); }).catch((x: unknown) => String(x));
    throw new Error(`${String(e).split(String.fromCharCode(10))[0]} — ${etat} — erreurs : ${erreurs.join(' | ')}`);
  }
  return { ctx, page, erreurs };
}
/** Ce que la page montre des blocs du jour. */
const vu = (p: Page) => p.evaluate(() => {
  const txt = (n: any) => (n?.textContent ?? '').replace(/\s+/g, ' ').trim();
  const carte = (k: string) => document.querySelector(`#feGrid > .fe-w[data-auj="${k}"]`);
  const bloc = (k: string) => { const c = carte(k); return c ? { titre: txt(c.querySelector('.wr-n')), sous: txt(c.querySelector('.wr-s')), corps: txt(c.querySelector('.fe-auj')), h2: c.querySelectorAll('h2').length, plus: Boolean(c.querySelector('.wr-plus')) } : null; };
  return {
    onglets: [...document.querySelectorAll('#fenetre .fe-tab')].map((b: any) => `${txt(b)}${b.getAttribute('aria-pressed') === 'true' ? '*' : ''}`),
    tu_veux: bloc('tu_veux'), a_faire: bloc('a_faire'), odin_a_fait: bloc('odin_a_fait'),
    dessous: [...document.querySelectorAll('#todayBox h2')].map((h: any) => txt(h.firstChild) || txt(h)),
    aFaireDessous: Boolean(document.querySelector('#todayBox #homeAFaire')),
  };
});
const attendreBlocs = (p: Page) => p.waitForFunction(() => { const h = document.querySelector('#feGrid .fe-auj[data-auj="a_faire"]'); return Boolean(h && h.childNodes.length); }, undefined, { timeout: 30000 });

test('navigateur, 1280 px : chaque bloc est dans son widget de la page « Aujourd\'hui », plus dans la colonne ; les filtres y marchent ; la cloche y mène au clavier', { skip: sans }, async () => {
  oublier();
  const { ctx, page, erreurs } = await ouvrirPage(1280);
  try {
    await attendreBlocs(page);
    const a = await vu(page);
    assert.equal(a.onglets[0], 'Aujourd\'hui*', 'la première page, ouverte, nommée par l\'interface');
    assert.deepEqual([a.tu_veux?.titre, a.a_faire?.titre, a.odin_a_fait?.titre], ['Tu veux sans doute', 'À faire', 'Ce qu\'Odin a fait']);
    for (const k of TROIS) { assert.equal(a[k]?.sous, 'Odin'); assert.equal(a[k]?.h2, 0, `${k} : pas de second titre dans le widget`); assert.equal(a[k]?.plus, true, `${k} : « ⋯ » pour le propriétaire`); assert.ok(a[k]?.corps, `${k} : rempli`); }
    assert.match(a.a_faire!.corps, /Activer la sauvegarde automatique/, 'ce qui attend sur un Odin neuf');
    assert.match(a.odin_a_fait!.corps, /^Tout ?Seul ?Refusé/, 'ses filtres, puis le fil');
    assert.deepEqual(a.dessous, [], 'plus rien dessous : le dernier bloc est un widget lui aussi (lot 27)'); assert.equal(a.aFaireDessous, false);
    await capture(page, 'aujourdhui-1280-clair');
    // La fenêtre est posée dans le corps de l'accueil (pas dans le dessin de la mascotte du salut, qui a aussi un « .body »).
    assert.deepEqual(await page.evaluate(() => { const p = document.getElementById('fenetre').parentElement; return [p.tagName, p.className, p.parentElement.id]; }), ['DIV', 'body', 'v-home']);
    // Un filtre du fil : il change, et reste après un nouveau dessin de la fenêtre.
    await page.evaluate(() => { ([...document.querySelectorAll('#feGrid .fe-auj[data-auj="odin_a_fait"] .ffilter button')].find((b: any) => b.textContent === 'Seul')).click(); });
    const filtre = () => page.evaluate(() => [...document.querySelectorAll('#feGrid .fe-auj[data-auj="odin_a_fait"] .ffilter button')].map((b: any) => `${b.textContent}:${b.getAttribute('aria-pressed')}`).join(' '));
    assert.equal(await filtre(), 'Tout:false Seul:true Refusé:false');
    assert.match((await vu(page)).odin_a_fait!.corps, /Rien dans ce filtre\./);
    await page.evaluate(() => window.OdinFenetre.edit(false));
    assert.equal(await filtre(), 'Tout:false Seul:true Refusé:false', 'redessinée : le widget est rempli de nouveau, pareil');
    await page.evaluate(() => { ([...document.querySelectorAll('#feGrid .fe-auj[data-auj="odin_a_fait"] .ffilter button')].find((b: any) => b.textContent === 'Tout')).click(); });
    // Sur une autre page : les blocs ne reviennent pas dessous ; la cloche (au clavier) rouvre la page et pose le focus sur « À faire ».
    await page.evaluate(() => { (document.querySelectorAll('#fenetre .fe-tab')[1]).click(); });
    await page.waitForFunction(() => !document.querySelector('#feGrid .fe-w[data-auj]') && document.querySelectorAll('#fenetre .fe-tab')[1]?.getAttribute('aria-pressed') === 'true');
    const b = await vu(page);
    assert.equal(b.a_faire, null); assert.deepEqual(b.dessous, [], 'rien ne revient dessous'); assert.equal(b.aFaireDessous, false);
    await page.focus('#homeBell'); await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.activeElement?.getAttribute('data-auj') === 'a_faire', undefined, { timeout: 15000 });
    const c = await vu(page);
    assert.equal(c.onglets[0], 'Aujourd\'hui*'); assert.match(c.a_faire!.corps, /Activer la sauvegarde automatique/);
    assert.deepEqual(erreurs, [], 'aucune erreur dans la page');
  } finally { await ctx.close(); }
});

test('navigateur : une demande d\'accès en attente ouvre la page qui porte « À faire », avec « Autoriser » et « Refuser » ; sans rien en attente, la page gardée reste', { skip: sans }, async () => {
  oublier();
  // Sans rien en attente : la page gardée dans le navigateur (la deuxième) reste ouverte.
  const calme = await ouvrirPage(1280, { onglet: 1 });
  try {
    await calme.page.waitForTimeout(1500);
    assert.equal((await vu(calme.page)).onglets[1].endsWith('*'), true, 'rien n\'attend : sa page reste');
  } finally { await calme.ctx.close(); }
  // Une demande d'accès d'un appareil (ses « Autoriser » et « Refuser » sont dans « À faire »).
  const web = v.web as unknown as { pairing: { request(ua: string, ip: string): { id: string } | undefined; pending(): unknown[] }; notify(t: string): void };
  const d = web.pairing.request('Mozilla/5.0 (Linux; Android 14) Chrome/120', '192.0.2.44'); assert.ok(d, 'demande créée'); web.notify('state');
  const { ctx, page, erreurs } = await ouvrirPage(1280, { onglet: 1 });
  try {
    await page.waitForFunction(() => /demande l'accès/.test(document.querySelector('#feGrid .fe-auj[data-auj="a_faire"]')?.textContent ?? ''), undefined, { timeout: 30000 });
    const a = await vu(page);
    assert.equal(a.onglets[0], 'Aujourd\'hui*', 'la page qui porte « À faire » s\'est ouverte toute seule');
    const boutons = await page.evaluate(() => [...document.querySelectorAll('#feGrid .fe-auj[data-auj="a_faire"] button')].map((x: any) => ({ t: x.textContent, h: Math.round(x.getBoundingClientRect().height) })));
    assert.deepEqual(boutons.map((x: any) => x.t), ['Autoriser', 'Refuser'], 'ses validations restent dans le widget');
    assert.ok(boutons.every((x: any) => x.h >= 44), `cibles de 44 px : ${JSON.stringify(boutons)}`);
    await capture(page, 'aujourdhui-1280-demande');
    // « Refuser », au clavier : la demande quitte « À faire ».
    await page.evaluate(() => { ([...document.querySelectorAll('#feGrid .fe-auj[data-auj="a_faire"] button')].find((x: any) => x.textContent === 'Refuser')).focus(); });
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => !/demande l'accès/.test(document.querySelector('#feGrid .fe-auj[data-auj="a_faire"]')?.textContent ?? 'demande l\'accès'), undefined, { timeout: 15000 });
    assert.equal(web.pairing.pending().length, 0, 'refusée pour de vrai');
    // Ensuite, changer de page reste possible : l'ouverture ne se rejoue pas.
    await page.evaluate(() => { (document.querySelectorAll('#fenetre .fe-tab')[1]).click(); });
    await page.waitForTimeout(1200);
    assert.equal((await vu(page)).onglets[1].endsWith('*'), true);
    assert.deepEqual(erreurs, [], 'aucune erreur dans la page');
  } finally { await ctx.close(); for (const x of web.pairing.pending() as Array<{ id: string }>) (web as unknown as { pairing: { decide(id: string, ok: boolean): unknown } }).pairing.decide(x.id, false); }
});

test('navigateur : « À faire » ne se retire pas ; « Ce qu\'Odin a fait » se retire, ne revient pas dessous, et se repose depuis le tiroir', { skip: sans }, async () => {
  oublier();
  const { ctx, page, erreurs } = await ouvrirPage(1280, { sombre: true });
  try {
    await attendreBlocs(page);
    await page.evaluate(() => window.OdinFenetre.edit(true));
    await page.waitForSelector('#fenetre.fe-edit');
    const croix = await page.evaluate(() => Object.fromEntries(['tu_veux', 'a_faire', 'odin_a_fait'].map((k) => [k, Boolean(document.querySelector(`#feGrid > .fe-w[data-auj="${k}"] [aria-label="Retirer ce module"]`))])));
    assert.deepEqual(croix, { tu_veux: true, a_faire: false, odin_a_fait: true });
    assert.equal(await page.evaluate(() => [...document.querySelectorAll('#fenetre .fe-tools .fe-tab')].some((b: any) => /Écran de la maison/.test(b.textContent ?? '') && /n'y vont jamais/.test(b.title ?? ''))), true, 'la page « Aujourd\'hui » se marque « Écran de la maison » (validé le 24/11), et son bouton dit ce qui n\'y va jamais');
    // Le tiroir ne propose pas un bloc que la fenêtre porte déjà.
    const offerts = () => page.evaluate(() => [...document.querySelectorAll('#feTiroir .fe-it b')].map((b: any) => b.textContent));
    assert.ok(!(await offerts()).some((t: any) => ['À faire', 'Ce qu\'Odin a fait', 'Tu veux sans doute'].includes(t ?? '')));
    // « ⋯ » de « À faire » : « Régler » sans « Retirer », « Copier » refusé.
    await capture(page, 'aujourdhui-1280-sombre-modifier');
    await page.click('#feGrid > .fe-w[data-auj="a_faire"] .wr-plus'); await page.waitForSelector('dialog.wr-regler[open]');
    await capture(page, 'aujourdhui-1280-sombre-regler');
    const r = await page.evaluate(() => { const x = document.querySelector('dialog.wr-regler')!; ([...x.querySelectorAll('button')].find((b: any) => b.textContent?.startsWith('Copier'))).click(); return { titre: document.getElementById(x.getAttribute('aria-labelledby')!)?.textContent, retirer: [...x.querySelectorAll('button')].some((b: any) => b.textContent === 'Retirer'), statut: [...x.querySelectorAll('[role=status]')].map((n: any) => n.textContent).join(''), choix: [...x.querySelectorAll('#wrRQ option')].map((o: any) => o.value) }; });
    assert.deepEqual(r, { titre: 'Régler « À faire »', retirer: false, statut: 'Ce widget reste sur ton accueil : il ne se copie pas vers l\'autre écran.', choix: ['ecran', 'adresse', 'rien'] });
    await page.keyboard.press('Escape'); await page.waitForFunction(() => !document.querySelector('dialog.wr-regler'));
    // « ✕ » sur « Ce qu'Odin a fait », puis « Terminé ».
    await page.click('#feGrid > .fe-w[data-auj="odin_a_fait"] [aria-label="Retirer ce module"]');
    await page.waitForFunction(() => !document.querySelector('#feGrid > .fe-w[data-auj="odin_a_fait"]'));
    assert.ok((await offerts()).includes('Ce qu\'Odin a fait'), 'le tiroir le propose de nouveau');
    await page.evaluate(() => { ([...document.querySelectorAll('#fenetre .fe-tools .btn')].find((b: any) => b.textContent === 'Terminé')).click(); });
    await page.waitForFunction(() => !document.querySelector('#fenetre.fe-edit'), undefined, { timeout: 15000 });
    assert.deepEqual(sortes(g().settings.fenetre as Layout)[0], ['tu_veux', 'a_faire', 'comportement'], 'rangé chez Hestia, avec la page sous son code');
    assert.equal((g().settings.fenetre as Layout).pages[0].code, 'aujourdhui');
    const a = await vu(page);
    assert.equal(a.odin_a_fait, null); assert.deepEqual(a.dessous, [], 'retiré : il ne revient pas dessous');
    assert.match(a.a_faire!.corps, /Activer la sauvegarde automatique/, '« À faire » est toujours rempli');
    // Reposé depuis le tiroir « Ajouter un widget ».
    await page.evaluate(() => window.OdinFenetre.edit(true));
    await page.waitForSelector('#feTiroir', { state: 'attached' });
    await page.evaluate(() => { (document.querySelector('#feTiroir [aria-label="Ajouter Ce qu\'Odin a fait"]')).click(); });
    await page.waitForSelector('#feGrid > .fe-w[data-auj="odin_a_fait"] .fe-auj .ffilter', { timeout: 15000 });
    assert.equal(await page.evaluate(() => window.OdinFenetre.state().L.pages[0].widgets.filter((w: any) => w.kind === 'odin_a_fait').length), 1);
    assert.ok(!(await offerts()).includes('Ce qu\'Odin a fait'), 'posé : le tiroir ne le propose plus');
    assert.deepEqual(erreurs, [], 'aucune erreur dans la page');
  } finally { await ctx.close(); oublier(); }
});

test('navigateur : un membre garde ses blocs à leur ancienne place, sans page « Aujourd\'hui » ni widget du jour', { skip: sans }, async () => {
  oublier();
  const { ctx, page, erreurs } = await ouvrirPage(1280, { cookie: membre });
  try {
    await page.waitForSelector('#todayBox #homeAFaire', { timeout: 30000 });
    const a = await vu(page);
    assert.ok(a.onglets.length >= 1 && !a.onglets.some((t: any) => t.startsWith('Aujourd\'hui')), `ses onglets : ${a.onglets.join(', ')}`);
    assert.equal(a.a_faire, null); assert.equal(a.odin_a_fait, null); assert.equal(a.tu_veux, null);
    assert.equal(a.aFaireDessous, true, '« À faire » est resté à sa place d\'avant');
    for (const t of ['Comment Odin se comporte', 'À faire', 'Ce qu\'Odin a fait']) assert.ok(a.dessous.includes(t), `${t} dessous, comme avant (${a.dessous.join(', ')})`);
    assert.deepEqual(erreurs, [], 'aucune erreur dans la page');
  } finally { await ctx.close(); }
});

test('navigateur, 390 px, sombre : les trois widgets tiennent dans l\'écran, l\'un sous l\'autre ; au doigt, la cloche mène à « À faire »', { skip: sans }, async () => {
  oublier();
  const web = v.web as unknown as { pairing: { request(ua: string, ip: string): { id: string } | undefined; pending(): Array<{ id: string }>; decide(id: string, ok: boolean): unknown }; notify(t: string): void };
  assert.ok(web.pairing.request('Mozilla/5.0 (Linux; Android 14) Chrome/120', '192.0.2.45')); web.notify('state');
  const { ctx, page, erreurs } = await ouvrirPage(390, { sombre: true });
  try {
    await page.waitForFunction(() => /demande l'accès/.test(document.querySelector('#feGrid .fe-auj[data-auj="a_faire"]')?.textContent ?? ''), undefined, { timeout: 30000 });
    const m = await page.evaluate(() => {
      const vw = document.documentElement.clientWidth, r = (n: any) => n.getBoundingClientRect();
      const cartes = ['tu_veux', 'a_faire', 'odin_a_fait'].map((k) => r(document.querySelector(`#feGrid > .fe-w[data-auj="${k}"]`)!));
      const cibles = [...document.querySelectorAll('#feGrid .fe-w[data-auj] .fe-auj button, #feGrid .fe-w[data-auj] .fe-auj a, #feGrid .fe-w[data-auj] .wr-plus')].filter((n: any) => r(n).width > 0).map((n: any) => ({ t: (n.textContent ?? '').trim().slice(0, 24) || n.getAttribute('aria-label'), w: Math.round(r(n).width), h: Math.round(r(n).height) }));
      return { vw, deborde: document.documentElement.scrollWidth > vw + 1, dedans: cartes.every((c: any) => c.left >= 0 && c.right <= vw + 1), empiles: cartes[0].bottom <= cartes[1].top + 1 && cartes[1].bottom <= cartes[2].top + 1, larges: cartes.every((c: any) => c.width > vw * 0.8), petites: cibles.filter((c: any) => c.h < 44 || c.w < 44) };
    });
    assert.equal(m.deborde, false, 'la page ne déborde pas'); assert.equal(m.dedans, true); assert.equal(m.empiles, true, 'l\'un sous l\'autre'); assert.equal(m.larges, true, 'toute la largeur');
    assert.deepEqual(m.petites, [], 'chaque commande des trois widgets fait au moins 44 px');
    await capture(page, 'aujourdhui-390-sombre');
    if (CAPTURES) { const clair = await ouvrirPage(390); try { await attendreBlocs(clair.page); await capture(clair.page, 'aujourdhui-390-clair'); await clair.page.evaluate(() => document.querySelector('#feGrid > .fe-w[data-auj="odin_a_fait"]').scrollIntoView()); await capture(clair.page, 'aujourdhui-390-clair-bas'); } finally { await clair.ctx.close(); } }
    // Sur une autre page, au doigt : la cloche rouvre la page et y mène.
    await page.evaluate(() => { (document.querySelectorAll('#fenetre .fe-tab')[1]).click(); });
    await page.waitForFunction(() => !document.querySelector('#feGrid .fe-w[data-auj]'));
    await page.tap('#homeBell');
    await page.waitForFunction(() => document.activeElement?.getAttribute('data-auj') === 'a_faire', undefined, { timeout: 15000 });
    const vue = await page.evaluate(() => { const c = document.querySelector('#feGrid > .fe-w[data-auj="a_faire"]')!.getBoundingClientRect(); return c.top < innerHeight && c.bottom > 0; });
    assert.equal(vue, true, '« À faire » est à l\'écran');
    assert.deepEqual(erreurs, [], 'aucune erreur dans la page');
  } finally { await ctx.close(); for (const x of web.pairing.pending()) web.pairing.decide(x.id, false); }
});
