// Aujourd'hui en widgets (maquette validée « Accueil », lot 27, première part) : « Comment Odin se comporte » — ses
// trois réglages du moment (autonomie, disponibilité, discrétion) — devient un widget de la page « Aujourd'hui ».
// Prouvé ici :
// - la sorte est posable, réservée à l'accueil du propriétaire (jamais à un membre, à une tablette, à l'écran de la
//   maison, jamais copiable) ; elle se retire et se repose ; sa donnée n'est pas relue par le serveur ;
// - la fenêtre de départ la porte en dernier sur la page « Aujourd'hui » ; une fenêtre déjà rangée la reçoit une seule
//   fois, à la fin, sans rien déplacer ni rien perdre ; retirée, elle ne revient pas ; une page restée ouverte depuis
//   avant la mise à jour ne la fait pas disparaître ;
// - les gestes qui changent un réglage sont ceux d'avant, avec les mêmes refus (un membre, la clé d'accès) ;
// - dans un vrai navigateur (s'il y en a un) : le bloc est dans son widget et plus dessous, les trois réglages marchent
//   à la souris, au clavier (le focus reste sur le bouton) et au doigt ; cibles de 44 px ; 1280 et 390 px ; clair,
//   sombre et verre ; il se retire et se repose depuis le tiroir ; un membre garde son bloc à l'ancienne place.
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { after, before, test } from 'node:test';
import vm from 'node:vm';
import { MODULES_PAR_PAGE, TAILLE_SORTE, avecAujourdhui, cleanLayout, defaultLayout, sansAccueilDuProprietaire, type FPage, type Layout, type Widget } from '../src/valhalla/modules/gladsheim.ts';
import { allModules, valhallaOf } from '../src/valhalla/odin.ts';
import { lierProprietaire, persona } from '../src/valhalla/sso/etat.ts';
import { ACCUEIL_RECU, PAGE_AUJOURDHUI } from '../src/valhalla/widgets/aujourdhui.ts';
import { copiable, donneeWidget, publicDe, servieALaMaison, sorteDe, type Lecteur, type SourceWidget } from '../src/valhalla/widgets/index.ts';
import { retraitRefuse } from '../src/valhalla/widgets/regler.ts';
import { T as Banc } from './banc/lib.ts';
import { vraiOdin, type VraiOdin } from './banc/odin-vrai.ts';

const lire = (f: string) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
const FE = lire('src/web/fenetre.js'), UI = lire('src/web/ui.html'), RENDU = lire('src/web/pages/widgets-rendu.js'), GRILLE = lire('src/web/pages/accueil-grille.js');
const K = 'comportement';
const IDS = ['gladsheim', 'midgard', 'vordr', 'var'];
const sortes = (l: Layout) => l.pages.map((p) => p.widgets.map((w: any) => w.kind as string));
const copie = <X>(x: X): X => JSON.parse(JSON.stringify(x));
const sans = <X extends Layout>(l: X): Layout => { const { accueil: _a, ...r } = copie(l); return r; };
/** Une fenêtre rangée après le lot 26 et avant celui-ci : la page « Aujourd'hui » et ses trois widgets, deux pages à lui, aucune marque. */
const DU_LOT_26 = (): Layout => cleanLayout({ pages: [
  { id: '0a0f0000', code: 'aujourdhui', name: '', widgets: [{ id: '0a0f0001', kind: 'tu_veux', c: 12 }, { id: '0a0f0002', kind: 'a_faire', c: 6 }, { id: '0a0f0003', kind: 'odin_a_fait', c: 6 }, { id: 'c2000009', kind: 'heure', w: 1 }] },
  { id: 'b2000001', name: 'Maison', maison: true, widgets: [{ id: 'c2000001', kind: 'heure', w: 1 }, { id: 'c2000002', kind: 'meteo', w: 2 }] },
  { id: 'b2000002', name: 'Réseau', widgets: [{ id: 'c2000003', kind: 'chiffres', w: 1, module: 'midgard', label: 'Mes appareils' }] },
] }, IDS);

// ------------------------------------------------------------------ la sorte

test('« Comment Odin se comporte » est posable, réservé à l\'accueil du propriétaire, et se retire', () => {
  const s = sorteDe(K)!;
  assert.equal(s.posable, true); assert.equal(s.famille, 'aujourdhui'); assert.equal(s.accueilSeul, true); assert.equal(publicDe(s), 'proprietaire');
  assert.equal(copiable(K), false, 'ne se copie pas vers l\'autre écran'); assert.equal(servieALaMaison(K), false, 'jamais à /maison');
  assert.deepEqual(s.applis, [], 'aucune appli derrière'); assert.equal(s.fixe, undefined, 'il se retire (seul « À faire » ne se retire pas)');
  // La page a les mêmes tailles que le serveur (pages/accueil-grille.js), et le connaît parmi les sortes réservées.
  const win: Record<string, unknown> = {}; vm.runInNewContext(GRILLE, { window: win, matchMedia: () => ({ matches: false }), crypto: globalThis.crypto });
  const G = win.OdinGrille as { MINI: Record<string, number[]>; HAUTEUR: Record<string, number> };
  assert.deepEqual([...G.MINI[K]], TAILLE_SORTE[K].mini); assert.equal(G.HAUTEUR[K], TAILLE_SORTE[K].r); assert.equal(TAILLE_SORTE[K].r, 2);
  // Et le widget des cinq chiffres, « chiffres_cles » (lot 27, deuxième part).
  assert.match(RENDU, /const RESERVEES = \['a_faire', 'odin_a_fait', 'tu_veux', 'comportement', 'chiffres_cles'\];/);
  assert.match(RENDU, /const FIXES = \['a_faire'\];/);
});

test('sa donnée : au propriétaire sur son accueil, « dans l\'état de sa page », sans un réglage ; à tout autre, refusée, sans rien lire', async () => {
  const lus: string[] = [];
  const src: SourceWidget = { appli: (id) => { lus.push(id); return undefined; }, vue: async (id) => { lus.push(id); return null; }, action: () => undefined, meteo: async () => undefined, lieu: () => ({ choisi: false, nom: '', fuseau: '', heure12: false }), maintenant: () => 7 };
  const w = { id: 'e3000001', kind: K, w: 3, c: 12, r: 2 } as unknown as Widget;
  assert.deepEqual(await donneeWidget(w, { qui: 'proprietaire', ecran: 'accueil' }, src), { etat: 'ok', at: 7, donnee: { source: 'etat' } });
  const autres: Lecteur[] = [{ qui: 'membre', ecran: 'accueil', peutLire: () => true, ouverts: new Set(['e3000001@gladsheim']) }, { qui: 'maison', ecran: 'maison' }, { qui: 'proprietaire', ecran: 'maison' }, { qui: 'maison', ecran: 'accueil' }];
  for (const l of autres) assert.deepEqual(await donneeWidget(w, l, src), { etat: 'refuse', raison: 'accueil_du_proprietaire' }, `refusé à ${l.qui} sur ${l.ecran}`);
  assert.deepEqual(lus, [], 'rien n\'est lu chez une appli');
});

// ------------------------------------------------------------------ la fenêtre de départ, et celle déjà rangée

test('la fenêtre de départ : le widget est le dernier de la page « Aujourd\'hui », sur toute la largeur ; la fenêtre porte la marque', () => {
  const d = defaultLayout(['vidarr', 'midgard']), p = d.pages[0];
  // Le widget des cinq chiffres (lot 27, deuxième part) en tête, comme la maquette ; lui reste le dernier.
  assert.deepEqual(p.widgets.map((w: any) => [w.id, w.kind, w.c, w.r]), [['0a0f0005', 'chiffres_cles', 12, 2], ['0a0f0001', 'tu_veux', 12, 2], ['0a0f0002', 'a_faire', 6, 4], ['0a0f0003', 'odin_a_fait', 6, 4],
    ['0a0f0004', K, 12, 2]]);
  // Marque 3 depuis le widget des cinq chiffres (lot 27, deuxième part).
  assert.equal(d.accueil, ACCUEIL_RECU); assert.equal(ACCUEIL_RECU, 3);
  assert.deepEqual(cleanLayout(copie(d), ['vidarr', 'midgard']), d, 'relue, elle ne change pas (la marque est gardée)');
  assert.equal(avecAujourdhui(d), d, 'rien à lui apporter');
  assert.deepEqual(PAGE_AUJOURDHUI.widgets.map((x) => [x.kind, x.depuis]), [['chiffres_cles', 3], ['tu_veux', 1], ['a_faire', 1], ['odin_a_fait', 1], [K, 2]]);
});

test('une fenêtre déjà rangée le reçoit une seule fois, à la fin de la page « Aujourd\'hui », sans rien déplacer ni rien perdre', () => {
  const avant = DU_LOT_26(), apres = avecAujourdhui(avant);
  assert.equal('accueil' in avant, false, 'rangée avant ce lot : pas de marque');
  assert.equal(apres.accueil, ACCUEIL_RECU);
  assert.deepEqual(apres.pages.slice(1), avant.pages.slice(1), 'ses autres pages : rien n\'a bougé');
  // Le widget des cinq chiffres (lot 27, deuxième part) arrive avec lui, en tête : d'où slice(1, -1).
  assert.deepEqual(apres.pages[0].widgets.slice(1, -1), avant.pages[0].widgets, 'sur la page : tout ce qui y était, dans le même ordre, aux mêmes tailles');
  assert.deepEqual({ ...apres.pages[0], widgets: [] }, { ...avant.pages[0], widgets: [] }, 'la page garde son identifiant, son code, son nom');
  const w = apres.pages[0].widgets.at(-1) as any, c = apres.pages[0].widgets[0] as any;
  assert.deepEqual([w.id, w.kind, w.c, w.r], ['0a0f0004', K, 12, 2], 'à la fin, toute la largeur, le même identifiant à chaque lecture');
  assert.deepEqual([c.id, c.kind, c.c, c.r], ['0a0f0005', 'chiffres_cles', 12, 2], 'et le widget des cinq chiffres, en tête');
  assert.deepEqual(avecAujourdhui(DU_LOT_26()), apres, 'deux lectures : la même fenêtre');
  assert.equal(avecAujourdhui(apres), apres, 'déjà reçu : rien de plus');
  assert.equal(avant.pages[0].widgets.length, 4, 'la fenêtre gardée n\'est pas touchée');
  // Reçu puis rangé par la page (elle renvoie la marque) : relu, rien ne change.
  const rangee = cleanLayout(copie(apres), IDS);
  assert.deepEqual(rangee, apres); assert.equal(avecAujourdhui(rangee), rangee);
});

test('reçu puis retiré : il ne revient pas ; rangé par une page d\'avant la mise à jour (sans la marque) : il n\'est pas perdu', () => {
  const recue = avecAujourdhui(DU_LOT_26());
  // Le propriétaire le retire et range : la page renvoie la marque, sans le widget.
  const retire = copie(recue); retire.pages[0].widgets = retire.pages[0].widgets.filter((w: any) => w.kind !== K);
  const gardee = cleanLayout(retire, IDS);
  assert.equal(gardee.accueil, ACCUEIL_RECU); assert.ok(!sortes(gardee).flat().includes(K));
  assert.equal(avecAujourdhui(gardee), gardee, 'retiré : il ne revient pas');
  assert.equal(retraitRefuse(recue, gardee), undefined, 'le retirer n\'est pas refusé');
  // Une page ouverte avant la mise à jour range ce qu'elle connaît : ni le widget, ni la marque. Il revient à la lecture.
  const vieille = cleanLayout(sans(retire), IDS);
  assert.equal('accueil' in vieille, false);
  // (Le widget des cinq chiffres, reçu avec lui, est resté en tête : lot 27, deuxième part.)
  assert.deepEqual(sortes(avecAujourdhui(vieille))[0], ['chiffres_cles', 'tu_veux', 'a_faire', 'odin_a_fait', 'heure', K]);
});

test('où il arrive : la page « Aujourd\'hui », sinon la page de « À faire », sinon la première qui a de la place ; jamais en double', () => {
  // « À faire » déplacé sur « Maison », la page « Aujourd'hui » supprimée : il arrive à la fin de la page de « À faire ».
  const l = DU_LOT_26(); const aFaire = l.pages[0].widgets[1]; l.pages[1].widgets.push(aFaire); l.pages.shift();
  const a = avecAujourdhui(l);
  // Le widget des cinq chiffres (lot 27, deuxième part) arrive avec lui, sur la même page, en tête.
  assert.deepEqual(sortes(a), [['chiffres_cles', 'heure', 'meteo', 'a_faire', K], ['chiffres']]); assert.deepEqual(a.pages[1], l.pages[1]);
  // La page « Aujourd'hui » existe encore, mais « À faire » est ailleurs : la page « Aujourd'hui » d'abord.
  const m = DU_LOT_26(); m.pages[1].widgets.push(...m.pages[0].widgets.splice(1, 1));
  assert.deepEqual(sortes(avecAujourdhui(m)), [['chiffres_cles', 'tu_veux', 'odin_a_fait', 'heure', K], ['heure', 'meteo', 'a_faire'], ['chiffres']]);
  // Déjà porté, sans la marque (rangé à la main, une donnée abîmée) : pas de double, la marque est posée.
  const deja = DU_LOT_26(); deja.pages[2].widgets.unshift({ id: 'c2000007', kind: K, w: 2, c: 6, r: 3 } as unknown as Widget);
  const d = avecAujourdhui(deja);
  // Seul le widget des cinq chiffres (lot 27, deuxième part), pas encore porté, arrive : en tête de la page « Aujourd'hui ».
  assert.equal(sortes(d).flat().filter((k) => k === K).length, 1); assert.deepEqual(d.pages.slice(1), deja.pages.slice(1)); assert.equal(d.accueil, ACCUEIL_RECU);
  assert.deepEqual(d.pages[0].widgets.slice(1), deja.pages[0].widgets); assert.equal(d.pages[0].widgets[0].kind, 'chiffres_cles');
  // Les deux déjà portés : rien ne change.
  const lesDeux = copie(deja); lesDeux.pages[2].widgets.unshift({ id: 'c2000008', kind: 'chiffres_cles', w: 2, c: 6, r: 2 } as unknown as Widget);
  const d2 = avecAujourdhui(lesDeux);
  assert.deepEqual(d2.pages, lesDeux.pages); assert.equal(d2.accueil, ACCUEIL_RECU);
  // Son identifiant de départ est déjà pris par un autre widget : le suivant libre, toujours le même.
  const pris = DU_LOT_26(); (pris.pages[1].widgets[0] as { id: string }).id = '0a0f0004';
  const p1 = avecAujourdhui(pris), p2 = avecAujourdhui(copie(pris));
  assert.equal((p1.pages[0].widgets.at(-1) as any).id, '0a0f0014'); assert.deepEqual(p1, p2);
  // Le widget des cinq chiffres (lot 27, deuxième part) arrive en tête, sous son propre identifiant, libre.
  assert.deepEqual([(p1.pages[0].widgets[0] as any).id, p1.pages[0].widgets[0].kind], ['0a0f0005', 'chiffres_cles']);
  const ids = p1.pages.flatMap((x) => x.widgets.map((w) => w.id)); assert.equal(new Set(ids).size, ids.length, 'aucun identifiant en double');
  // La page « Aujourd'hui » est pleine : la page suivante qui a de la place ; toutes pleines : rien n'arrive, rien ne casse.
  const plein = (n: number, id: string) => Array.from({ length: n }, (_, i) => ({ id: `${id}${i.toString(16).padStart(4, '0')}`, kind: 'heure', w: 1 }));
  const pleine = cleanLayout({ pages: [{ id: '0a0f0000', code: 'aujourdhui', widgets: [{ id: '0a0f0002', kind: 'a_faire' }, ...plein(MODULES_PAR_PAGE - 1, 'd100')] }, { id: 'b2000001', name: 'Maison', widgets: plein(3, 'd200') }] }, IDS);
  assert.equal(pleine.pages[0].widgets.length, MODULES_PAR_PAGE);
  const q = avecAujourdhui(pleine);
  // Et le widget des cinq chiffres (lot 27, deuxième part), sur la même page, en tête.
  assert.deepEqual(q.pages[0], pleine.pages[0]); assert.deepEqual(sortes(q)[1], ['chiffres_cles', 'heure', 'heure', 'heure', K]);
  const toutes = cleanLayout({ pages: [{ id: '0a0f0000', code: 'aujourdhui', widgets: [{ id: '0a0f0002', kind: 'a_faire' }, ...plein(MODULES_PAR_PAGE - 1, 'd100')] }] }, IDS);
  assert.deepEqual(avecAujourdhui(toutes).pages, toutes.pages);
  assert.deepEqual(cleanLayout(copie(avecAujourdhui(pleine)), IDS).pages, q.pages, 'rangée : rien n\'est coupé');
});

test('une fenêtre d\'avant le lot 26 reçoit la page entière, en premier, avec le widget en dernier', () => {
  const ancienne = cleanLayout({ pages: [{ id: 'b3000001', name: 'Maison', maison: true, widgets: [{ id: 'c3000001', kind: 'heure', w: 1 }] }] }, IDS);
  const a = avecAujourdhui(ancienne);
  // Et le widget des cinq chiffres (lot 27, deuxième part), en tête.
  assert.deepEqual(sortes(a), [['chiffres_cles', 'tu_veux', 'a_faire', 'odin_a_fait', K], ['heure']]); assert.deepEqual(a.pages.slice(1), ancienne.pages); assert.equal(a.accueil, ACCUEIL_RECU);
  assert.deepEqual(a.pages[0], defaultLayout([]).pages[0], 'la même page qu\'au départ, mêmes identifiants');
  // Une page sous le code, sans « À faire », qui porte autre chose : les blocs du lot 26 en tête, celui-ci à la fin, rien de perdu.
  const abimee = avecAujourdhui({ pages: [{ id: 'b3000009', name: 'Ma journée', code: 'aujourdhui', widgets: [ancienne.pages[0].widgets[0]] }, ...ancienne.pages] });
  assert.deepEqual(sortes(abimee)[0], ['chiffres_cles', 'tu_veux', 'a_faire', 'odin_a_fait', 'heure', K]); assert.equal(abimee.pages[0].name, 'Ma journée'); assert.equal(abimee.pages[0].id, 'b3000009');
  // La marque déjà là mais « À faire » absent (une donnée abîmée) : les trois du lot 26 reviennent, pas celui-ci.
  // La marque 2 ne dit pas reçu le widget des cinq chiffres (lot 27, deuxième part, marque 3) : il arrive, lui.
  assert.deepEqual(sortes(avecAujourdhui({ ...ancienne, accueil: 2 }))[0], ['chiffres_cles', 'tu_veux', 'a_faire', 'odin_a_fait']);
  assert.deepEqual(sortes(avecAujourdhui({ ...ancienne, accueil: 3 }))[0], ['tu_veux', 'a_faire', 'odin_a_fait']);
});

test('ce que le serveur garde d\'un rangement : la marque seulement si elle est connue ; un seul widget ; rien de glissé dedans', () => {
  const page = (ws: unknown[]) => ({ pages: [{ name: 'P', widgets: ws }] });
  // Marque 3 depuis le widget des cinq chiffres (lot 27, deuxième part) ; 2, une livraison connue, est gardée telle quelle.
  for (const [envoye, garde] of [[2, 2], [99, 3], [3, 3], [4, 3], [1, undefined], [0, undefined], [-2, undefined], [2.5, undefined], ['2', undefined], [true, undefined], [null, undefined], [{}, undefined], [[2], undefined]] as Array<[unknown, number | undefined]>) {
    assert.equal(cleanLayout({ ...page([{ kind: 'heure' }]), accueil: envoye }, IDS).accueil, garde, `marque ${JSON.stringify(envoye)}`);
  }
  assert.equal('accueil' in cleanLayout(page([{ kind: 'heure' }]), IDS), false, 'pas de marque : rien d\'écrit');
  // Un seul dans toute la fenêtre (le premier est gardé) ; son titre est coupé ; tout le reste est jeté.
  const l = cleanLayout({ pages: [{ name: 'P', widgets: [{ id: 'd3000001', kind: K, label: 'x'.repeat(90), module: 'midgard', action: 'serrure', section: 'Sondes', input: { a: 'b' }, style: '<script>', toucher: { quoi: 'action', action: 'serrure' } }, { kind: K }] }, { name: 'Q', widgets: [{ kind: K }, { kind: 'heure' }] }] }, IDS);
  assert.deepEqual(sortes(l), [[K], ['heure']]);
  assert.deepEqual(l.pages[0].widgets[0], { id: 'd3000001', kind: K, w: 1, c: 4, r: 2, label: 'x'.repeat(40) } as unknown as Widget);
  assert.deepEqual(cleanLayout(page([{ kind: K, toucher: { quoi: 'adresse', adresse: 'javascript:alert(1)' } }]), IDS).pages[0].widgets[0].toucher, undefined, 'une adresse qui n\'est pas une adresse web : jetée');
  // Plus petit que sa plus petite taille : remis à sa plus petite taille.
  assert.deepEqual(((x) => [x.c, x.r])(cleanLayout(page([{ kind: K, c: 1, r: 1 }]), IDS).pages[0].widgets[0]), [3, 2]);
});

test('un autre que le propriétaire ne reçoit ni le widget, ni la marque', () => {
  const l = avecAujourdhui(DU_LOT_26()), servi = sansAccueilDuProprietaire(l);
  assert.ok(!JSON.stringify(servi).match(/comportement|0a0f0004|"accueil"/));
  assert.deepEqual(sortes(servi), [['heure'], ['heure', 'meteo'], ['chiffres']]);
  assert.equal(l.accueil, ACCUEIL_RECU, 'la fenêtre gardée n\'est pas touchée'); assert.ok(sortes(l).flat().includes(K));
  // Seul sur la page « Aujourd'hui » : il reste une page ordinaire, qui ne dit rien.
  const seule = sansAccueilDuProprietaire({ pages: [{ id: '0a0f0000', name: '', code: 'aujourdhui', widgets: [l.pages[0].widgets.at(-1)!] }], accueil: 2 });
  assert.deepEqual(seule, { pages: [{ id: '00000000', name: 'Page 1', widgets: [] }] });
});

// ------------------------------------------------------------------ la lecture des fichiers de la page

test('la page : le titre et le symbole dans le dictionnaire ; le bloc posé dans son widget, sinon à son ancienne place ; les mêmes gestes', () => {
  assert.match(FE, /comportement: 'Comment Odin se comporte'/, 'le titre');
  // Avec le widget des cinq chiffres, « chiffres_cles » (lot 27, deuxième part).
  assert.match(FE, /const JOUR = \['tu_veux', 'a_faire', 'odin_a_fait', 'comportement', 'chiffres_cles'\];/, 'dessiné comme les blocs du jour : la page d\'accueil pose son contenu');
  assert.match(FE, /« Ce qu\\'Odin a fait » et « Comment Odin se comporte » n\\'y vont jamais\./, 'le bouton « Écran de la maison » de la page le dit');
  const i = UI.indexOf('  function renderToday('), t = UI.slice(i, UI.indexOf('\n  }\n', i));
  assert.match(t, /if \(fen\) \{ const h = fen\.hote\('comportement'\); if \(h\) poserReglages\(h, sansTitre\(ctrls\)\); \}/, 'dans son widget, sans second titre');
  assert.match(t, /box\.replaceChildren\(\.\.\.\(fen \? \[\] : \[guesses \|\| '', ctrls, el\('div', \{ class: 'today-cols' \}, todo, feed\)\]\)\);/, 'pour le propriétaire, plus rien dessous ; sinon, comme avant');
  // Les gestes n'ont pas changé : les mêmes actions, envoyées par les mêmes boutons.
  const c = t.slice(t.indexOf('const ctrls = '), t.indexOf('// À faire + fil'));
  assert.match(c, /seg\('autonomy', auto, \(v\) => api\('\/api\/action', \{ kind: 'set_autonomy', autonomy: v \}\)\)/);
  assert.match(c, /api\('\/api\/action', \{ kind: 'set_control', control: 'mode', value: v \}\)/);
  assert.match(c, /api\('\/api\/action', \{ kind: 'set_control', control: 'discretion', value: v \}\)/);
  assert.equal((c.match(/api\(/g) ?? []).length, 3, 'trois gestes, pas un de plus');
  // En plein écran (un écran au mur), il reste caché, comme le bloc d'avant ; en mode Modifier, il se voit.
  assert.match(FE, /#v-home\.pe-plein #fenetre:not\(\.fe-edit\) \.fe-w\[data-auj="comportement"\]\{display:none!important\}/);
  // Rien dans le script de la fenêtre ne change un réglage d'Odin.
  assert.doesNotMatch(FE, /set_autonomy|set_control/);
});

// ------------------------------------------------------------------ un vrai Odin d'essai

const tt = new Banc(), orig = { log: console.log, error: console.error, warn: console.warn };
let v: VraiOdin, membre = '';
const MDP = 'un-badamier-au-bord-du-lagon-27';
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
const lue = async (h: Record<string, string> = {}) => { const r = await v.json('/api/valhalla/act', { module: 'gladsheim', action: 'fenetre', input: {} }, h); assert.equal(r.body.ok, true, JSON.stringify(r.body)); return r.body as unknown as { text: string; data: Layout }; };
const oublier = () => g().saveSettings({ fenetre: undefined });
/** Les trois réglages, tels que la page du propriétaire les reçoit. */
const reglages = async () => { const s = (await v.json('/api/state')).body as { autonomy?: string; today?: { controls?: Record<string, unknown> } }; return { autonomie: s.autonomy, mode: s.today?.controls?.mode, discretion: s.today?.controls?.discretion }; };
const geste = (corps: Record<string, unknown>, h: Record<string, string> = {}) => v.json('/api/action', corps, h);
const remettre = async () => { await geste({ kind: 'set_autonomy', autonomy: 'equilibre' }); await geste({ kind: 'set_control', control: 'mode', value: 'disponible' }); await geste({ kind: 'set_control', control: 'discretion', value: 'essentiel' }); };

before(async () => {
  for (const k of ['log', 'error', 'warn'] as const) console[k] = () => {};
  v = await vraiOdin(tt, { compte: true, modules: (o) => allModules(o).filter((m) => [...IDS, 'apparence'].includes(m.id)) });
  const va = valhallaOf()!;
  assert.equal((await va.act('var', 'ajouter', { login: 'membre-c', nom: 'Membre C', groupes: 'invite', mot_de_passe: MDP })).ok, true);
  for (const appli of ['odin', 'gladsheim', 'midgard']) assert.equal((await va.act('var', 'donner_acces', { appli, qui: '@membre-c' })).ok, true);
  lierProprietaire(persona()!);
  membre = await entrer('membre-c', MDP); assert.ok(membre, 'le membre a une session');
  // Le thème d'origine (clair ou sombre selon la page), pas celui de l'heure : les captures disent ce qu'elles montrent.
  assert.equal((await va.act('apparence', 'theme', { theme: 'valhalla' })).ok, true);
  await remettre();
});
after(async () => { await tt.end(); Object.assign(console, orig); });

test('Odin neuf : le propriétaire lit le widget en dernier sur la page « Aujourd\'hui », et la route des widgets le rend « dans l\'état »', async () => {
  oublier();
  const f = await lue();
  // Et le widget des cinq chiffres (lot 27, deuxième part), en tête : cinq widgets.
  assert.deepEqual(sortes(f.data)[0], ['chiffres_cles', 'tu_veux', 'a_faire', 'odin_a_fait', K]); assert.equal(f.data.accueil, ACCUEIL_RECU);
  assert.match(f.text, /^- Aujourd'hui : 5 module\(s\)/);
  const r = await v.json(`/api/widgets/donnees?page=${PAGE_AUJOURDHUI.id}`);
  const w = (r.body.widgets as Array<Record<string, unknown>>).find((x) => x.kind === K)!;
  assert.deepEqual([w.id, w.etat, JSON.stringify(w.donnee)], ['0a0f0004', 'ok', '{"source":"etat"}'], 'aucun réglage dans la réponse de la route');
  assert.ok(!JSON.stringify(r.body).match(/equilibre|prudent|autonome|disponible|essentiel/), 'la route ne dit rien des réglages');
  assert.equal(g().settings.fenetre, undefined, 'lire ne range rien');
});

test('une fenêtre déjà rangée : il arrive à la lecture ; rangé, retiré, il ne revient pas ; une page d\'avant la mise à jour ne le fait pas perdre', async () => {
  oublier();
  const avant = DU_LOT_26();
  g().saveSettings({ fenetre: copie(avant) }); // ce que le lot 26 a laissé sur le disque : aucune marque
  const f = await lue();
  // Le widget des cinq chiffres (lot 27, deuxième part) arrive avec lui, en tête : d'où slice(1, -1).
  assert.deepEqual(sortes(f.data), [['chiffres_cles', 'tu_veux', 'a_faire', 'odin_a_fait', 'heure', K], ['heure', 'meteo'], ['chiffres']]);
  assert.deepEqual(f.data.pages.slice(1), avant.pages.slice(1)); assert.deepEqual(f.data.pages[0].widgets.slice(1, -1), avant.pages[0].widgets, 'rien n\'a bougé');
  assert.deepEqual(g().settings.fenetre, avant, 'lire n\'écrit rien');
  assert.deepEqual((await lue()).data, f.data, 'relue : la même, le même identifiant');
  const w = ((await v.json(`/api/widgets/donnees?page=${f.data.pages[0].id}`)).body.widgets as Array<Record<string, unknown>>).find((x) => x.kind === K)!;
  assert.equal(w.id, f.data.pages[0].widgets.at(-1)!.id, 'la route des widgets parle du même widget');
  // Une page ouverte avant la mise à jour range sa fenêtre (sans le widget, sans la marque) : ce n'est pas un retrait.
  const r0 = await ranger(avant); assert.equal(r0.ok, true, r0.text);
  // « Aujourd'hui (6) » : les quatre d'avant, lui, et le widget des cinq chiffres.
  assert.match(r0.text, /^✓ Fenêtre rangée : Aujourd'hui \(6\), Maison \(2\), Réseau \(1\)\.$/);
  assert.ok(sortes((await lue()).data)[0].includes(K), 'il est toujours là');
  // « Terminé » depuis la page d'aujourd'hui : elle renvoie ce qu'elle a lu, avec la marque.
  const r1 = await ranger(f.data); assert.equal(r1.ok, true, r1.text);
  assert.equal((g().settings.fenetre as Layout).accueil, ACCUEIL_RECU); assert.deepEqual(g().settings.fenetre, f.data);
  // Il le retire (« ✕ », puis « Terminé ») : rangé sans lui, il ne revient pas, et rien d'autre ne bouge.
  const sansLui = copie(f.data); sansLui.pages[0].widgets = sansLui.pages[0].widgets.filter((x: any) => x.kind !== K);
  const r2 = await ranger(sansLui); assert.equal(r2.ok, true, r2.text);
  assert.deepEqual((await lue()).data, sansLui, 'retiré : il ne revient pas');
  assert.deepEqual(sortes((r2.data as Layout)), sortes(sansLui));
  // Reposé depuis le tiroir, sur une autre page : gardé où il l'a mis, un seul.
  const repose = copie(sansLui); repose.pages[2].widgets.push({ id: 'c2000011', kind: K, w: 3, c: 12, r: 2 } as unknown as Widget);
  assert.equal((await ranger(repose)).ok, true);
  // (Le widget des cinq chiffres, lot 27, deuxième part, reste à sa place, en tête.)
  assert.deepEqual(sortes((await lue()).data), [['chiffres_cles', 'tu_veux', 'a_faire', 'odin_a_fait', 'heure'], ['heure', 'meteo'], ['chiffres', K]]);
  oublier();
});

test('un membre, une tablette, la clé d\'accès : ni le widget, ni la marque ; l\'écran de la maison ne le sert à personne', async () => {
  oublier();
  const moi = await lue(), lui = await lue({ cookie: membre });
  assert.ok(sortes(moi.data).flat().includes(K));
  assert.ok(!JSON.stringify(lui).match(/comportement|0a0f000|"accueil"|Aujourd'hui/), 'un membre : ni la sorte, ni son identifiant, ni la marque, ni le nom de la page');
  const r = await v.json('/api/widgets/donnees', undefined, { cookie: membre });
  assert.equal(r.status, 200); assert.equal(r.body.qui, 'membre'); assert.ok(!JSON.stringify(r.body).match(/comportement|0a0f000/));
  assert.equal((await v.json(`/api/widgets/donnees?page=${PAGE_AUJOURDHUI.id}`, undefined, { cookie: membre })).body.widgets?.toString(), '', 'même en demandant la page par son identifiant');
  // Posé par le propriétaire sur une page « Écran de la maison » : /api/maison/etat ne le rend à personne.
  const f = copie(moi.data), maison = f.pages.find((p) => p.maison)!, sien = f.pages[0].widgets.find((w: any) => w.kind === K)!;
  f.pages[0].widgets = f.pages[0].widgets.filter((w) => w !== sien); maison.widgets.push({ ...sien, module: 'midgard', action: 'scene', toucher: { quoi: 'action', action: 'scene' } } as unknown as Widget);
  f.pages[0].maison = true;
  assert.equal((await ranger(f)).ok, true);
  assert.ok(sortes(g().settings.fenetre as Layout).some((ks, i) => ks.includes(K) && (g().settings.fenetre as Layout).pages[i].maison), 'il est bien sur une page marquée');
  const cles = await Promise.all((['complet', 'maison'] as const).map(async (droits) => ((await valhallaOf()!.act('gladsheim', 'cle_tablette', { nom: `Tablette ${droits}`, droits })).data as { key: string }).key));
  for (const h of [{}, ...cles.map((cle) => ({ cookie: '', 'x-odin-maison': cle }))] as Array<Record<string, string>>) {
    const e = await v.json('/api/maison/etat', undefined, h); assert.equal(e.status, 200);
    const servis = ((e.body.fenetre as FPage[]) ?? []).flatMap((p) => p.widgets.map((w: any) => w.kind as string));
    assert.ok(servis.includes('heure'), 'la page est bien servie'); assert.ok(!servis.includes(K), 'sans lui');
    assert.ok(!JSON.stringify(e.body.fenetre).match(/comportement|"accueil"/));
    // Et il ne se lance pas comme un bouton de l'écran de la maison.
    const b = await v.json('/api/maison/fenetre', { id: sien.id }, h); assert.notEqual(b.status, 200, `le lancer par son identifiant : refusé (${b.status})`);
  }
  for (const cle of cles) assert.equal((await v.json('/api/widgets/donnees', undefined, { cookie: '', 'x-odin-maison': cle })).status, 401, 'la clé d\'une tablette n\'ouvre pas la route des widgets');
  // La clé d'accès : pas la route des widgets, pas l'écran de la maison.
  const cle = { cookie: '', authorization: `Bearer ${v.token}` };
  assert.equal((await v.json('/api/widgets/donnees', undefined, cle)).status, 401);
  assert.notEqual((await v.json('/api/maison/etat', undefined, cle)).status, 200);
  oublier();
});

test('changer un réglage : les mêmes gestes qu\'avant, les mêmes refus (un membre, la clé d\'accès, une valeur inconnue)', async () => {
  await remettre();
  const depart = await reglages();
  assert.deepEqual(depart, { autonomie: 'equilibre', mode: 'disponible', discretion: 'essentiel' });
  // Le propriétaire, par sa session : les trois gestes des boutons du widget.
  assert.equal((await geste({ kind: 'set_autonomy', autonomy: 'prudent' })).body.ok, true);
  assert.equal((await geste({ kind: 'set_control', control: 'mode', value: 'occupe' })).body.ok, true);
  assert.equal((await geste({ kind: 'set_control', control: 'discretion', value: 'urgent' })).body.ok, true);
  assert.deepEqual(await reglages(), { autonomie: 'prudent', mode: 'occupe', discretion: 'urgent' });
  const pose = await reglages();
  // Une valeur inconnue : refusée, rien ne change.
  assert.equal((await geste({ kind: 'set_autonomy', autonomy: 'tout-permis' })).body.ok, false);
  assert.equal((await geste({ kind: 'set_control', control: 'mode', value: 'ailleurs' })).body.ok, false);
  assert.equal((await geste({ kind: 'set_control', control: 'discretion', value: 'rien' })).body.ok, false);
  assert.equal((await geste({ kind: 'set_control', control: 'autre', value: 'tout' })).body.ok, false);
  // Un membre, la clé d'accès, la clé d'une tablette, personne : refusés, rien ne change.
  const cleTablette = ((await valhallaOf()!.act('gladsheim', 'cle_tablette', { nom: 'Tablette du salon', droits: 'complet' })).data as { key: string }).key;
  const autres: Array<[string, Record<string, string>]> = [['un membre', { cookie: membre }], ['la clé d\'accès', { cookie: '', authorization: `Bearer ${v.token}` }], ['la clé d\'une tablette', { cookie: '', 'x-odin-maison': cleTablette }], ['personne', { cookie: '' }]];
  for (const [qui, h] of autres) {
    for (const corps of [{ kind: 'set_autonomy', autonomy: 'autonome' }, { kind: 'set_autonomy', autonomy: 'breaker' }, { kind: 'set_control', control: 'mode', value: 'sommeil' }, { kind: 'set_control', control: 'discretion', value: 'tout' }]) {
      const r = await geste(corps, h);
      assert.ok(r.status === 401 || r.status === 403, `${qui}, ${JSON.stringify(corps)} : refusé (${r.status} ${JSON.stringify(r.body).slice(0, 120)})`);
    }
    assert.deepEqual(await reglages(), pose, `${qui} : rien n'a changé`);
  }
  await remettre();
});

// ------------------------------------------------------------------ dans un vrai navigateur (s'il y en a un)

declare const document: any, window: any, getComputedStyle: any;
interface Page {
  goto(u: string): Promise<unknown>; waitForSelector(s: string, o?: Record<string, unknown>): Promise<unknown>; click(s: string): Promise<void>; tap(s: string): Promise<void>; focus(s: string): Promise<void>;
  waitForFunction(f: string | ((a: any) => unknown), a?: unknown, o?: Record<string, unknown>): Promise<unknown>; evaluate<X>(f: string | ((a?: any) => X), a?: unknown): Promise<X>;
  keyboard: { press(k: string): Promise<void> }; waitForTimeout(ms: number): Promise<void>; on(e: string, f: (x: Error) => void): void; screenshot(o: Record<string, unknown>): Promise<unknown>;
}
interface Contexte { newPage(): Promise<Page>; addCookies(c: unknown[]): Promise<void>; addInitScript(f: string | (() => void)): Promise<void>; close(): Promise<void> }
interface Navigateur { newContext(o: Record<string, unknown>): Promise<Contexte>; close(): Promise<void> }
const pw = (() => { try { return createRequire(import.meta.url)('playwright') as { chromium: { launch(): Promise<Navigateur> } }; } catch { return undefined; } })();
const sansNav = pw ? false : 'Playwright n\'est pas installé sur cette machine';
let nav: Navigateur | undefined;
before(async () => { if (pw) nav = await pw.chromium.launch(); });
after(async () => { await nav?.close(); });
// Captures facultatives (ODIN_CAPTURES=<dossier>) : pour regarder l'écran, jamais exigées par l'essai.
const CAPTURES = process.env.ODIN_CAPTURES;
const capture = async (p: Page, nom: string) => { if (!CAPTURES) return; mkdirSync(CAPTURES, { recursive: true }); await p.screenshot({ path: `${CAPTURES}/${nom}.png`, fullPage: true }); };

async function ouvrirPage(largeur: number, o: { cookie?: string; sombre?: boolean; attendre?: string } = {}) {
  const doigt = largeur < 500;
  const ctx = await nav!.newContext({ viewport: { width: largeur, height: doigt ? 800 : 900 }, hasTouch: doigt, isMobile: doigt, locale: 'fr-FR', colorScheme: o.sombre ? 'dark' : 'light' });
  const [n, ...x] = (o.cookie ?? v.session).split('='); await ctx.addCookies([{ name: n, value: x.join('='), url: v.url, httpOnly: true, sameSite: 'Strict' }]);
  await ctx.addInitScript(`try { localStorage.setItem('odin.tour', 'done'); ${o.sombre ? 'localStorage.setItem(\'odin.theme\', \'sombre\');' : ''} } catch { /* rien */ }`);
  const page = await ctx.newPage(), erreurs: string[] = [];
  page.on('pageerror', (e) => erreurs.push(String(e)));
  await page.goto(v.url + '/');
  await page.waitForSelector('#app:not([hidden])', { timeout: 30000 });
  await page.waitForSelector(o.attendre ?? '#feGrid .fe-w', { timeout: 45000 });
  return { ctx, page, erreurs };
}
const CARTE = `#feGrid > .fe-w[data-auj="${K}"]`, HOTE = `#feGrid .fe-auj[data-auj="${K}"]`;
const bouton = (groupe: string, nom: string) => `${HOTE} [role=group][aria-label="${groupe}"] button[title="${nom}"]`;
const attendreReglages = (p: Page) => p.waitForSelector(`${HOTE} .ctrls .seg button`, { timeout: 30000 });
/** Ce que la page montre du widget. */
const vu = (p: Page) => p.evaluate((k: string) => {
  const txt = (n: any) => (n?.textContent ?? '').replace(/\s+/g, ' ').trim(), r = (n: any) => n.getBoundingClientRect();
  const c = document.querySelector(`#feGrid > .fe-w[data-auj="${k}"]`), vw = document.documentElement.clientWidth;
  const groupes = c ? [...c.querySelectorAll('.fe-auj [role=group]')].map((gr: any) => ({ nom: gr.getAttribute('aria-label'), choix: [...gr.querySelectorAll('button')].map((b: any) => `${txt(b)}${b.getAttribute('aria-pressed') === 'true' ? '*' : ''}`) })) : [];
  const cibles = c ? [...c.querySelectorAll('.fe-auj button, .wr-plus')].filter((n: any) => r(n).width > 0).map((n: any) => ({ t: txt(n) || n.getAttribute('aria-label'), w: Math.round(r(n).width), h: Math.round(r(n).height), coupe: n.scrollWidth > n.clientWidth + 1 })) : [];
  const cadres = c ? [...c.querySelectorAll('.fe-auj .ctrl')].map((n: any) => r(n)) : [];
  return {
    onglets: [...document.querySelectorAll('#fenetre .fe-tab')].map((b: any) => `${txt(b)}${b.getAttribute('aria-pressed') === 'true' ? '*' : ''}`),
    carte: c ? { titre: txt(c.querySelector('.wr-n')), sous: txt(c.querySelector('.wr-s')), h2: c.querySelectorAll('h2').length, plus: Boolean(c.querySelector('.wr-plus')), dedans: r(c).left >= 0 && r(c).right <= vw + 1, largeur: Math.round(r(c).width), dernier: c === c.parentElement.querySelector(':scope > .fe-w:last-of-type'),
      // Ce qui vient après lui sur la page (rien : le widget des cinq chiffres, lot 27, deuxième part, est en tête).
      puis: [...c.parentElement.querySelectorAll(':scope > .fe-w')].filter((n: any) => c.compareDocumentPosition(n) & 4).map((n: any) => n.getAttribute('data-auj')) } : null,
    groupes, cibles, titres: c ? [...c.querySelectorAll('.fe-auj .ctrl-t')].map(txt) : [],
    enLigne: cadres.length === 3 && Math.abs(cadres[0].top - cadres[2].top) < 2, empiles: cadres.length === 3 && cadres[0].bottom <= cadres[1].top + 1 && cadres[1].bottom <= cadres[2].top + 1,
    dessous: [...document.querySelectorAll('#todayBox h2')].map((h: any) => txt(h.firstChild) || txt(h)), dessousVide: document.getElementById('todayBox').childElementCount === 0,
    deborde: document.documentElement.scrollWidth > vw + 1, vw,
  };
}, K);
/** Les textes du widget qui se détachent mal de leur fond (rapport de contraste sous 3) ; `lus` : combien ont été mesurés. */
const lisible = (p: Page) => p.evaluate((s: string) => {
  const r = (n: any) => n.getBoundingClientRect();
  const lum = (c: string) => { const x = (c.match(/[\d.]+/g) ?? []).map(Number); const f = (u: number) => { u /= 255; return u <= 0.03928 ? u / 12.92 : ((u + 0.055) / 1.055) ** 2.4; }; return { l: 0.2126 * f(x[0]) + 0.7152 * f(x[1]) + 0.0722 * f(x[2]), a: x.length > 3 ? x[3] : 1 }; };
  const fondDe = (n: any) => { for (let e = n; e; e = e.parentElement) { const b = lum(getComputedStyle(e).backgroundColor); if (b.a > 0.5) return b.l; } return lum(getComputedStyle(document.body).backgroundColor).l; };
  const textes = [...document.querySelector(s)!.querySelectorAll('.wr-n, .wr-s, .fe-auj .ctrl-t span, .fe-auj button')].filter((n: any) => r(n).width > 0 && (n.textContent ?? '').trim());
  return { lus: textes.length, faibles: textes.map((n: any) => { const t = lum(getComputedStyle(n).color).l, f = fondDe(n), c = (Math.max(t, f) + 0.05) / (Math.min(t, f) + 0.05); return { t: (n.textContent ?? '').trim().slice(0, 30), c: Math.round(c * 10) / 10 }; }).filter((x: any) => x.c < 3) };
}, CARTE);
const presse = (p: Page, groupe: string, nom: string) => p.waitForFunction(([s]: string[]) => document.querySelector(s)?.getAttribute('aria-pressed') === 'true', [bouton(groupe, nom)], { timeout: 20000 });

test('navigateur, 1280 px : le bloc est dans son widget, plus dessous ; les trois réglages changent, à la souris et au clavier (le focus reste)', { skip: sansNav }, async () => {
  oublier(); await remettre();
  const { ctx, page, erreurs } = await ouvrirPage(1280);
  try {
    await attendreReglages(page);
    const a = await vu(page);
    assert.equal(a.onglets[0], 'Aujourd\'hui*');
    // Toujours le dernier de la page : le widget des cinq chiffres (lot 27, deuxième part) est en tête.
    assert.deepEqual(a.carte, { titre: 'Comment Odin se comporte', sous: 'Odin', h2: 0, plus: true, dedans: true, largeur: a.carte!.largeur, dernier: true, puis: [] }, 'l\'en-tête commun, pas de second titre, « ⋯ », le dernier de la page');
    assert.deepEqual(a.groupes, [
      { nom: 'Autonomie', choix: ['Me demander', 'Équilibré*', 'Autonome'] },
      { nom: 'Disponibilité', choix: ['Libre*', 'Occupé', 'En route', 'Je dors'] },
      { nom: 'Discrétion', choix: ['Tout', 'L\'essentiel*', 'L\'urgent'] },
    ], 'les mêmes mots et les mêmes choix qu\'avant');
    assert.deepEqual(a.titres, ['Autonomie', 'Disponibilité', 'Discrétion']);
    assert.equal(a.enLigne, true, 'les trois côte à côte'); assert.equal(a.dessousVide, true, 'plus rien dessous'); assert.deepEqual(a.dessous, []);
    assert.deepEqual(a.cibles.filter((c: any) => c.h < 44 || c.w < 44 || c.coupe), [], `cibles de 44 px, aucun mot coupé : ${JSON.stringify(a.cibles)}`);
    assert.equal(a.deborde, false);
    assert.deepEqual((await lisible(page)).faibles, [], 'clair : chaque texte se détache de son fond');
    await page.evaluate((s: string) => document.querySelector(s).scrollIntoView({ block: 'center' }), CARTE);
    await capture(page, 'comportement-1280-clair');
    // À la souris : l'autonomie.
    await page.click(bouton('Autonomie', 'Autonome')); await presse(page, 'Autonomie', 'Autonome');
    assert.equal((await reglages()).autonomie, 'autonome', 'changé pour de vrai');
    // Au clavier : la discrétion, puis la disponibilité ; après le nouveau dessin, le focus est sur le même bouton.
    await page.focus(bouton('Discrétion', 'L\'urgent')); await page.keyboard.press('Enter'); await presse(page, 'Discrétion', 'L\'urgent');
    assert.equal(await page.evaluate(() => `${document.activeElement?.closest('[role=group]')?.getAttribute('aria-label')}/${document.activeElement?.title}`), 'Discrétion/L\'urgent', 'le focus n\'est pas perdu');
    await page.keyboard.press('Shift+Tab'); await page.keyboard.press('Shift+Tab'); await page.keyboard.press('Shift+Tab');
    assert.equal(await page.evaluate(() => `${document.activeElement?.closest('[role=group]')?.getAttribute('aria-label')}/${document.activeElement?.title}`), 'Disponibilité/Je dors', 'Maj + Tab remonte de bouton en bouton');
    await page.keyboard.press('Space'); await presse(page, 'Disponibilité', 'Je dors');
    assert.equal(await page.evaluate(() => `${document.activeElement?.closest('[role=group]')?.getAttribute('aria-label')}/${document.activeElement?.title}`), 'Disponibilité/Je dors');
    assert.deepEqual(await reglages(), { autonomie: 'autonome', mode: 'sommeil', discretion: 'urgent' });
    assert.match((await vu(page)).titres[1], /^Disponibilité · jusqu'à \d\d:\d\d$/, 'l\'heure de fin est dite, comme avant');
    // Redessinée (un autre onglet, puis retour) : le widget est rempli de nouveau, pareil ; sur l'autre page, rien dessous.
    await page.evaluate(() => { (document.querySelectorAll('#fenetre .fe-tab')[1]).click(); });
    await page.waitForFunction(() => !document.querySelector('#feGrid .fe-w[data-auj]'));
    assert.equal((await vu(page)).dessousVide, true, 'sur une autre page : il ne revient pas dessous');
    await page.evaluate(() => { (document.querySelectorAll('#fenetre .fe-tab')[0]).click(); });
    await attendreReglages(page);
    assert.deepEqual((await vu(page)).groupes.map((x: any) => x.choix.find((c: string) => c.endsWith('*'))), ['Autonome*', 'Je dors*', 'L\'urgent*']);
    // En plein écran (un écran au mur) : il ne se voit pas, comme avant ; « À faire » reste ; en mode Modifier, il se voit.
    const vus = () => page.evaluate(() => ['comportement', 'a_faire'].map((k) => getComputedStyle(document.querySelector(`#feGrid > .fe-w[data-auj="${k}"]`)).display !== 'none'));
    await page.evaluate(() => document.getElementById('v-home').classList.add('pe-plein'));
    assert.deepEqual(await vus(), [false, true], 'plein écran : caché');
    await page.evaluate(() => window.OdinFenetre.edit(true)); await page.waitForSelector('#fenetre.fe-edit'); await attendreReglages(page);
    assert.deepEqual(await vus(), [true, true], 'plein écran, mode Modifier : il se voit');
    await page.evaluate(() => window.OdinFenetre.edit(false)); await page.waitForFunction(() => !document.querySelector('#fenetre.fe-edit'));
    await page.evaluate(() => document.getElementById('v-home').classList.remove('pe-plein'));
    assert.deepEqual(await vus(), [true, true], 'sorti du plein écran : il revient');
    assert.deepEqual(erreurs, [], 'aucune erreur dans la page');
  } finally { await ctx.close(); await remettre(); }
});

test('navigateur, 390 px, au doigt : les trois réglages l\'un sous l\'autre, dans l\'écran, cibles de 44 px ; un appui change le réglage', { skip: sansNav }, async () => {
  oublier(); await remettre();
  const { ctx, page, erreurs } = await ouvrirPage(390, { sombre: true });
  try {
    await attendreReglages(page);
    await page.evaluate((s: string) => document.querySelector(s).scrollIntoView({ block: 'center' }), CARTE);
    const a = await vu(page);
    assert.equal(a.deborde, false, 'la page ne déborde pas'); assert.equal(a.carte?.dedans, true); assert.ok(a.carte!.largeur > a.vw * 0.8, 'toute la largeur');
    assert.equal(a.empiles, true, 'l\'un sous l\'autre');
    assert.deepEqual(a.cibles.filter((c: any) => c.h < 44 || c.w < 44 || c.coupe), [], `cibles de 44 px, aucun mot coupé : ${JSON.stringify(a.cibles)}`);
    assert.equal(a.dessousVide, true);
    assert.equal(await page.evaluate(() => { const x = (getComputedStyle(document.querySelector('#feGrid > .fe-w')).backgroundColor.match(/[.0-9]+/g) || []).map(Number); return document.documentElement.dataset.theme === 'dark' && x[0] + x[1] + x[2] < 300; }), true, 'la page est bien en sombre (le fond des cartes aussi)');
    assert.deepEqual((await lisible(page)).faibles, [], 'sombre : chaque texte se détache de son fond');
    await capture(page, 'comportement-390-sombre');
    await page.tap(bouton('Disponibilité', 'Occupé')); await presse(page, 'Disponibilité', 'Occupé');
    await page.tap(bouton('Autonomie', 'Me demander')); await presse(page, 'Autonomie', 'Me demander');
    assert.deepEqual(await reglages(), { autonomie: 'prudent', mode: 'occupe', discretion: 'essentiel' });
    const b = await vu(page);
    assert.equal(b.deborde, false); assert.deepEqual(b.cibles.filter((c: any) => c.h < 44 || c.w < 44 || c.coupe), [], 'avec « jusqu\'à … » aussi');
    assert.deepEqual(erreurs, [], 'aucune erreur dans la page');
  } finally { await ctx.close(); await remettre(); }
});

test('navigateur : il se retire, ne revient pas dessous, et se repose depuis le tiroir ; « Régler » le garde sur l\'accueil', { skip: sansNav }, async () => {
  oublier(); await remettre();
  const { ctx, page, erreurs } = await ouvrirPage(1280, { sombre: true });
  try {
    await attendreReglages(page);
    await page.evaluate(() => window.OdinFenetre.edit(true));
    await page.waitForSelector('#fenetre.fe-edit');
    await attendreReglages(page);
    const offerts = () => page.evaluate(() => [...document.querySelectorAll('#feTiroir .fe-it b')].map((b: any) => b.textContent));
    assert.ok(!(await offerts()).includes('Comment Odin se comporte'), 'le tiroir ne propose pas ce que la fenêtre porte déjà');
    assert.equal(await page.evaluate(() => [...document.querySelectorAll('#fenetre .fe-tools .fe-tab')].some((b: any) => /Écran de la maison/.test(b.textContent ?? '') && /« Comment Odin se comporte » n'y vont jamais/.test(b.title ?? ''))), true, 'le bouton « Écran de la maison » de la page dit qu\'il n\'y va jamais');
    await capture(page, 'comportement-1280-sombre-modifier');
    // « ⋯ » : « Régler », avec « Retirer » ; « Copier vers l'autre écran » est refusé.
    await page.click(`${CARTE} .wr-plus`); await page.waitForSelector('dialog.wr-regler[open]');
    await capture(page, 'comportement-1280-sombre-regler');
    const r = await page.evaluate(() => { const x = document.querySelector('dialog.wr-regler')!; ([...x.querySelectorAll('button')].find((b: any) => b.textContent?.startsWith('Copier'))).click(); return { titre: document.getElementById(x.getAttribute('aria-labelledby')!)?.textContent, retirer: [...x.querySelectorAll('button')].some((b: any) => b.textContent === 'Retirer'), statut: [...x.querySelectorAll('[role=status]')].map((n: any) => n.textContent).join(''), choix: [...x.querySelectorAll('#wrRQ option')].map((o: any) => o.value) }; });
    assert.deepEqual(r, { titre: 'Régler « Comment Odin se comporte »', retirer: true, statut: 'Ce widget reste sur ton accueil : il ne se copie pas vers l\'autre écran.', choix: ['ecran', 'adresse', 'rien'] });
    await page.keyboard.press('Escape'); await page.waitForFunction(() => !document.querySelector('dialog.wr-regler'));
    // « ✕ », puis « Terminé ».
    await page.click(`${CARTE} [aria-label="Retirer ce module"]`);
    await page.waitForFunction((s: string) => !document.querySelector(s), CARTE);
    assert.ok((await offerts()).includes('Comment Odin se comporte'), 'le tiroir le propose de nouveau');
    await page.evaluate(() => { ([...document.querySelectorAll('#fenetre .fe-tools .btn')].find((b: any) => b.textContent === 'Terminé')).click(); });
    await page.waitForFunction(() => !document.querySelector('#fenetre.fe-edit'), undefined, { timeout: 15000 });
    const gardee = g().settings.fenetre as Layout;
    // Le widget des cinq chiffres (lot 27, deuxième part) reste, en tête.
    assert.deepEqual(sortes(gardee)[0], ['chiffres_cles', 'tu_veux', 'a_faire', 'odin_a_fait']); assert.equal(gardee.accueil, ACCUEIL_RECU, 'la page a renvoyé la marque');
    const a = await vu(page);
    assert.equal(a.carte, null); assert.equal(a.dessousVide, true, 'retiré : il ne revient pas dessous');
    assert.ok(!sortes((await lue()).data).flat().includes(K), 'ni à la lecture suivante');
    // Reposé depuis le tiroir « Ajouter un widget » : toute la largeur, rempli, et ses boutons marchent.
    await page.evaluate(() => window.OdinFenetre.edit(true));
    await page.waitForSelector('#feTiroir', { state: 'attached' });
    await page.evaluate(() => { (document.querySelector('#feTiroir [aria-label="Ajouter Comment Odin se comporte"]')).click(); });
    await attendreReglages(page);
    assert.deepEqual(await page.evaluate(() => window.OdinFenetre.state().L.pages[0].widgets.filter((w: any) => w.kind === 'comportement').map((w: any) => w.c)), [12], 'un seul, sur toute la largeur');
    assert.ok(!(await offerts()).includes('Comment Odin se comporte'));
    await page.evaluate(() => { ([...document.querySelectorAll('#fenetre .fe-tools .btn')].find((b: any) => b.textContent === 'Terminé')).click(); });
    await page.waitForFunction(() => !document.querySelector('#fenetre.fe-edit'), undefined, { timeout: 15000 });
    assert.deepEqual((g().settings.fenetre as Layout).pages[0].widgets.map((w: any) => [w.kind, w.c, w.r]).at(-1), [K, 12, 2], 'rangé en dernier, à sa taille de départ');
    await attendreReglages(page);
    await page.click(bouton('Discrétion', 'Tout')); await presse(page, 'Discrétion', 'Tout');
    assert.equal((await reglages()).discretion, 'tout');
    assert.deepEqual(erreurs, [], 'aucune erreur dans la page');
  } finally { await ctx.close(); oublier(); await remettre(); }
});

test('navigateur : un membre garde le bloc à son ancienne place, sans widget ; ses boutons ne changent rien chez Odin', { skip: sansNav }, async () => {
  oublier(); await remettre();
  const { ctx, page, erreurs } = await ouvrirPage(1280, { cookie: membre });
  try {
    await page.waitForSelector('#todayBox .ctrls .seg button', { timeout: 30000 });
    const a = await vu(page);
    assert.equal(a.carte, null, 'pas de widget pour lui'); assert.ok(a.dessous.includes('Comment Odin se comporte'), `dessous, comme avant (${a.dessous.join(', ')})`);
    await page.evaluate(() => { ([...document.querySelectorAll('#todayBox .ctrls [role=group][aria-label="Autonomie"] button')].find((b: any) => b.title === 'Autonome')).click(); });
    await page.waitForTimeout(800);
    assert.deepEqual(await reglages(), { autonomie: 'equilibre', mode: 'disponible', discretion: 'essentiel' }, 'le serveur refuse, comme avant');
    assert.deepEqual(erreurs, [], 'aucune erreur dans la page');
  } finally { await ctx.close(); }
});

test('navigateur : le thème en verre, à 1280 et 390 px : le widget se lit et tient dans l\'écran', { skip: sansNav }, async () => {
  oublier(); await remettre();
  assert.equal((await valhallaOf()!.act('apparence', 'theme', { theme: 'h-verre' })).ok, true);
  try {
    for (const largeur of [1280, 390]) {
      const { ctx, page, erreurs } = await ouvrirPage(largeur, { sombre: true });
      try {
        await attendreReglages(page);
        await page.waitForFunction(() => (document.documentElement.dataset.odinTheme || '') === 'h-verre', undefined, { timeout: 15000 });
        await page.evaluate((s: string) => document.querySelector(s).scrollIntoView({ block: 'center' }), CARTE);
        const m = await lisible(page);
        const a = await vu(page);
        assert.equal(a.deborde, false, `${largeur} : la page ne déborde pas`); assert.equal(a.carte?.dedans, true, `${largeur} : la carte tient`);
        assert.ok(m.lus >= 15, `${largeur} : le titre, « Odin », trois noms, dix choix (${m.lus})`); assert.deepEqual(m.faibles, [], `${largeur} : chaque texte se détache de son fond`);
        assert.deepEqual(a.cibles.filter((c: any) => c.h < 44 || c.w < 44 || c.coupe), [], `${largeur} : cibles de 44 px`);
        await capture(page, `comportement-verre-${largeur}`);
        assert.deepEqual(erreurs, [], 'aucune erreur dans la page');
      } finally { await ctx.close(); }
    }
  } finally { await valhallaOf()!.act('apparence', 'theme', { theme: 'valhalla' }); oublier(); }
});
