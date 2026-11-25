// Aujourd'hui en widgets (maquette validée « Accueil », lot 27, deuxième part) : les cinq chiffres cliquables
// (appareils en ligne, missions en cours, risques repérés, dépenses du mois, mode d'Odin) deviennent un widget de la page
// « Aujourd'hui ».
// Prouvé ici :
// - la sorte est posable, réservée à l'accueil du propriétaire (jamais à un membre, à une tablette, à l'écran de la
//   maison, jamais copiable) ; elle se retire et se repose ; sa donnée n'est pas relue par le serveur ;
// - la fenêtre de départ la porte EN TÊTE de la page « Aujourd'hui », comme la maquette (choix du propriétaire) ; une
//   fenêtre déjà rangée la reçoit une seule fois, en tête : ce qui y était descend d'une rangée, sans rien perdre ni rien
//   réordonner ; « Comment Odin se comporte » garde sa place, en dernier ; retirée, elle ne revient pas ; une page restée
//   ouverte depuis avant la mise à jour ne la fait pas disparaître ;
// - s'il ne reste qu'une place, « Comment Odin se comporte » arrive seul (marque 2) et les chiffres à la place suivante ;
// - à l'écran, comme la maquette : chaque chiffre a son icône, teintée par une couleur du thème d'Odin (aucune couleur
//   écrite en dur) ;
// - les chiffres sont les mêmes boutons qu'avant, qui mènent au même détail ; aucun geste neuf, aucune route neuve ;
// - dans un vrai navigateur (s'il y en a un) : les chiffres sont dans leur widget et plus dans « État détaillé » ; ils
//   mènent à leur détail à la souris, au clavier et au doigt ; le focus reste sur le chiffre quand Odin redessine ;
//   cibles de 44 px ; 1280 et 390 px ; cachés en plein écran ; inertes en mode Modifier ; ils se retirent et se
//   reposent ; un membre les garde à l'ancienne place.
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
const FE = lire('src/web/fenetre.js'), UI = lire('src/web/ui.html'), GRILLE = lire('src/web/pages/accueil-grille.js');
const K = 'chiffres_cles', ID = '0a0f0005';
const IDS = ['gladsheim', 'midgard', 'vordr', 'var'];
const sortes = (l: Layout) => l.pages.map((p) => p.widgets.map((w: any) => w.kind as string));
const copie = <X>(x: X): X => JSON.parse(JSON.stringify(x));
/** Une fenêtre rangée après la première part du lot 27 : la page « Aujourd'hui » et ses quatre widgets, la marque 2. */
const DU_27A = (): Layout => cleanLayout({ accueil: 2, pages: [
  { id: '0a0f0000', code: 'aujourdhui', name: '', widgets: [{ id: '0a0f0001', kind: 'tu_veux', c: 12 }, { id: '0a0f0002', kind: 'a_faire', c: 6 }, { id: '0a0f0003', kind: 'odin_a_fait', c: 6 }, { id: 'c2000009', kind: 'heure', w: 1 }, { id: '0a0f0004', kind: 'comportement', c: 12 }] },
  { id: 'b2000001', name: 'Maison', maison: true, widgets: [{ id: 'c2000001', kind: 'heure', w: 1 }, { id: 'c2000002', kind: 'meteo', w: 2 }] },
  { id: 'b2000002', name: 'Réseau', widgets: [{ id: 'c2000003', kind: 'chiffres', w: 1, module: 'midgard', label: 'Mes appareils' }] },
] }, IDS);
/** La même, rangée par une page d'avant la première part : ni « Comment Odin se comporte », ni marque. */
const DU_26 = (): Layout => { const l = copie(DU_27A()); delete l.accueil; l.pages[0].widgets = l.pages[0].widgets.filter((w: any) => w.kind !== 'comportement'); return cleanLayout(l, IDS); };

// ------------------------------------------------------------------ la sorte

test('les cinq chiffres : posables, réservés à l\'accueil du propriétaire, ils se retirent ; la page a les mêmes tailles', () => {
  const s = sorteDe(K)!;
  assert.equal(s.posable, true); assert.equal(s.famille, 'aujourdhui'); assert.equal(s.accueilSeul, true); assert.equal(publicDe(s), 'proprietaire');
  assert.equal(copiable(K), false, 'ne se copient pas vers l\'autre écran'); assert.equal(servieALaMaison(K), false, 'jamais à /maison');
  assert.deepEqual(s.applis, [], 'aucune appli derrière'); assert.equal(s.fixe, undefined, 'ils se retirent (seul « À faire » ne se retire pas)');
  const win: Record<string, unknown> = {}; vm.runInNewContext(GRILLE, { window: win, matchMedia: () => ({ matches: false }), crypto: globalThis.crypto });
  const G = win.OdinGrille as { MINI: Record<string, number[]>; HAUTEUR: Record<string, number> };
  assert.deepEqual([...G.MINI[K]], TAILLE_SORTE[K].mini); assert.equal(G.HAUTEUR[K], TAILLE_SORTE[K].r); assert.equal(TAILLE_SORTE[K].r, 2);
});

test('leur donnée : au propriétaire sur son accueil, « dans l\'état de sa page », sans un chiffre ; à tout autre, refusée, sans rien lire', async () => {
  const lus: string[] = [];
  const src: SourceWidget = { appli: (id) => { lus.push(id); return undefined; }, vue: async (id) => { lus.push(id); return null; }, action: () => undefined, meteo: async () => undefined, lieu: () => ({ choisi: false, nom: '', fuseau: '', heure12: false }), maintenant: () => 7 };
  const w = { id: 'e3000005', kind: K, w: 3, c: 12, r: 2 } as unknown as Widget;
  assert.deepEqual(await donneeWidget(w, { qui: 'proprietaire', ecran: 'accueil' }, src), { etat: 'ok', at: 7, donnee: { source: 'etat' } });
  const autres: Lecteur[] = [{ qui: 'membre', ecran: 'accueil', peutLire: () => true, ouverts: new Set(['e3000005@gladsheim']) }, { qui: 'maison', ecran: 'maison' }, { qui: 'proprietaire', ecran: 'maison' }, { qui: 'maison', ecran: 'accueil' }];
  for (const l of autres) assert.deepEqual(await donneeWidget(w, l, src), { etat: 'refuse', raison: 'accueil_du_proprietaire' }, `refusé à ${l.qui} sur ${l.ecran}`);
  assert.deepEqual(lus, [], 'rien n\'est lu chez une appli');
});

// ------------------------------------------------------------------ la fenêtre de départ, et celle déjà rangée

test('la fenêtre de départ : le widget est le premier de la page « Aujourd\'hui », sur toute la largeur ; la marque est 3', () => {
  const d = defaultLayout(['vidarr', 'midgard']), p = d.pages[0];
  assert.deepEqual(p.widgets.map((w: any) => [w.id, w.kind, w.c, w.r]), [[ID, K, 12, 2], ['0a0f0001', 'tu_veux', 12, 2], ['0a0f0002', 'a_faire', 6, 4], ['0a0f0003', 'odin_a_fait', 6, 4], ['0a0f0004', 'comportement', 12, 2]]);
  assert.equal(d.accueil, ACCUEIL_RECU); assert.equal(ACCUEIL_RECU, 3);
  assert.deepEqual(cleanLayout(copie(d), ['vidarr', 'midgard']), d, 'relue, elle ne change pas (la marque est gardée)');
  assert.equal(avecAujourdhui(d), d, 'rien à lui apporter');
  assert.deepEqual(PAGE_AUJOURDHUI.widgets.map((x) => [x.kind, x.depuis]), [[K, 3], ['tu_veux', 1], ['a_faire', 1], ['odin_a_fait', 1], ['comportement', 2]]);
});

test('une fenêtre rangée après « Comment Odin se comporte » reçoit les chiffres une seule fois, en tête, sans rien perdre ni rien réordonner', () => {
  const avant = DU_27A(), apres = avecAujourdhui(avant);
  assert.equal(avant.accueil, 2);
  assert.equal(apres.accueil, ACCUEIL_RECU);
  assert.deepEqual(apres.pages.slice(1), avant.pages.slice(1), 'ses autres pages : rien n\'a bougé');
  assert.deepEqual(apres.pages[0].widgets.slice(1), avant.pages[0].widgets, 'sur la page : tout ce qui y était descend d\'une place, dans le même ordre, aux mêmes tailles');
  const w = apres.pages[0].widgets[0] as any;
  assert.deepEqual([w.id, w.kind, w.c, w.r], [ID, K, 12, 2], 'en tête, toute la largeur, le même identifiant à chaque lecture');
  assert.equal(apres.pages[0].widgets.at(-1)!.kind, 'comportement', '« Comment Odin se comporte » garde sa place, en dernier');
  assert.deepEqual(avecAujourdhui(DU_27A()), apres, 'deux lectures : la même fenêtre');
  assert.equal(avecAujourdhui(apres), apres, 'déjà reçus : rien de plus');
  const rangee = cleanLayout(copie(apres), IDS);
  assert.deepEqual(rangee, apres); assert.equal(avecAujourdhui(rangee), rangee);
});

test('reçus puis retirés : ils ne reviennent pas ; rangés par une page d\'avant la mise à jour (marque 2) : ils ne sont pas perdus', () => {
  const recue = avecAujourdhui(DU_27A());
  const retire = copie(recue); retire.pages[0].widgets = retire.pages[0].widgets.filter((w: any) => w.kind !== K);
  const gardee = cleanLayout(retire, IDS);
  assert.equal(gardee.accueil, ACCUEIL_RECU); assert.ok(!sortes(gardee).flat().includes(K));
  assert.equal(avecAujourdhui(gardee), gardee, 'retirés : ils ne reviennent pas');
  assert.equal(retraitRefuse(recue, gardee), undefined, 'les retirer n\'est pas refusé');
  // Une page ouverte avant la mise à jour range ce qu'elle connaît : sans eux, avec la marque 2. Ils reviennent à la lecture.
  const vieille = cleanLayout({ ...retire, accueil: 2 }, IDS);
  assert.equal(vieille.accueil, 2);
  assert.deepEqual(sortes(avecAujourdhui(vieille))[0], [K, 'tu_veux', 'a_faire', 'odin_a_fait', 'heure', 'comportement']);
});

test('une fenêtre d\'avant le lot 27 reçoit les deux, dans l\'ordre ; « Comment Odin se comporte » retiré ne revient pas avec eux', () => {
  const l26 = DU_26(), a = avecAujourdhui(l26);
  assert.deepEqual(sortes(a)[0], [K, 'tu_veux', 'a_faire', 'odin_a_fait', 'heure', 'comportement']); assert.deepEqual(a.pages.slice(1), l26.pages.slice(1)); assert.equal(a.accueil, ACCUEIL_RECU);
  // Rangée avec la marque 2 sans « Comment Odin se comporte » (il l'avait retiré) : seuls les chiffres arrivent.
  const sansReglages = cleanLayout({ ...copie(l26), accueil: 2 }, IDS);
  assert.deepEqual(sortes(avecAujourdhui(sansReglages))[0], [K, 'tu_veux', 'a_faire', 'odin_a_fait', 'heure']);
  // Une fenêtre d'avant le lot 26 : la page entière, en premier, la même qu'au départ.
  const ancienne = cleanLayout({ pages: [{ id: 'b3000001', name: 'Maison', maison: true, widgets: [{ id: 'c3000001', kind: 'heure', w: 1 }] }] }, IDS);
  const b = avecAujourdhui(ancienne);
  assert.deepEqual(b.pages[0], defaultLayout([]).pages[0]); assert.deepEqual(b.pages.slice(1), ancienne.pages);
  // Déjà portés ailleurs (reposés à la main, sans la marque) : pas de double.
  const deja = DU_27A(); deja.pages[2].widgets.push({ id: 'c2000007', kind: K, w: 2, c: 6, r: 2 } as unknown as Widget);
  const d = avecAujourdhui(deja);
  assert.equal(sortes(d).flat().filter((k) => k === K).length, 1); assert.deepEqual(d.pages, deja.pages); assert.equal(d.accueil, ACCUEIL_RECU);
  // Leur identifiant de départ déjà pris : le suivant libre, toujours le même ; aucun identifiant en double.
  const pris = DU_27A(); (pris.pages[1].widgets[0] as { id: string }).id = ID;
  const p1 = avecAujourdhui(pris);
  assert.equal((p1.pages[0].widgets[0] as any).id, '0a0f0015'); assert.deepEqual(p1, avecAujourdhui(copie(pris)));
  const ids = p1.pages.flatMap((x) => x.widgets.map((w) => w.id)); assert.equal(new Set(ids).size, ids.length);
});

test('une seule place libre : « Comment Odin se comporte » arrive seul, la marque dit 2 ; une autre place, les chiffres arrivent', () => {
  // Une fenêtre rangée au lot 26 (sans marque), toutes ses pages pleines sauf UNE place : les deux widgets attendus ne
  // tiennent pas ensemble, mais le premier ne doit pas attendre le second.
  const plein = (n: number, id: string) => Array.from({ length: n }, (_, i) => ({ id: `${id}${i.toString(16).padStart(4, '0')}`, kind: 'heure', w: 1 }));
  const l = cleanLayout({ pages: [{ id: '0a0f0000', code: 'aujourdhui', widgets: [{ id: '0a0f0002', kind: 'a_faire' }, ...plein(MODULES_PAR_PAGE - 1, 'd100')] },
    { id: 'b2000001', name: 'Salon', widgets: plein(MODULES_PAR_PAGE - 1, 'd200') }] }, IDS);
  const a = avecAujourdhui(l);
  assert.deepEqual(sortes(a).map((ks) => ks.filter((k) => k === 'comportement' || k === K)), [[], ['comportement']], 'le premier arrive, seul, à la fin de la page qui a la place');
  assert.deepEqual(a.pages[0], l.pages[0]); assert.deepEqual(a.pages[1].widgets.slice(0, -1), l.pages[1].widgets, 'rien n\'est déplacé');
  assert.equal(a.accueil, 2, 'reçu en entier : la livraison 2, pas la 3');
  const rangee = cleanLayout(copie(a), IDS);
  assert.equal(rangee.accueil, 2); assert.equal(avecAujourdhui(rangee), rangee, 'toujours pas de place : rien de plus, rien en double');
  // Une place se libère : les chiffres arrivent, une seule fois, et la marque passe à 3.
  rangee.pages[0].widgets.pop();
  const b = avecAujourdhui(cleanLayout(copie(rangee), IDS));
  assert.equal(b.accueil, ACCUEIL_RECU); assert.equal(b.pages[0].widgets[0].kind, K, 'en tête de la page « Aujourd\'hui »');
  assert.deepEqual(b.pages[0].widgets.slice(1), rangee.pages[0].widgets, 'rien d\'autre ne bouge sur la page');
  assert.equal(sortes(b).flat().filter((k) => k === 'comportement').length, 1); assert.equal(sortes(b).flat().filter((k) => k === K).length, 1);
  // Une place sur la page « Aujourd'hui », d'autres ailleurs : le premier y va (à la fin), le second sur la page suivante
  // qui a de la place (en tête).
  const c = avecAujourdhui(cleanLayout({ pages: [{ id: '0a0f0000', code: 'aujourdhui', widgets: [{ id: '0a0f0002', kind: 'a_faire' }, ...plein(MODULES_PAR_PAGE - 2, 'd100')] },
    { id: 'b2000001', name: 'Salon', widgets: plein(2, 'd200') }] }, IDS));
  assert.deepEqual(sortes(c).map((ks) => ks.at(-1)), ['comportement', 'heure']); assert.deepEqual(sortes(c)[1], [K, 'heure', 'heure']); assert.equal(c.accueil, ACCUEIL_RECU);
});

test('en tête : sans page « Aujourd\'hui », en tête de la page qui porte « À faire », sinon de la première page qui a de la place ; jamais en double', () => {
  // « À faire » déplacé sur « Réseau », la page « Aujourd'hui » supprimée (marque 2) : en tête de « Réseau ».
  const l = DU_27A(); l.pages[2].widgets.push(l.pages[0].widgets[1]); l.pages.shift();
  const a = avecAujourdhui(l);
  assert.deepEqual(sortes(a), [['heure', 'meteo'], [K, 'chiffres', 'a_faire']]); assert.deepEqual(a.pages[0], l.pages[0]); assert.equal(a.accueil, ACCUEIL_RECU);
  // La page de « À faire » est pleine : en tête de la première page ordinaire qui a de la place (pas la page « Écran de
  // la maison », puisqu'il y en a une autre).
  const plein = (n: number, id: string) => Array.from({ length: n }, (_, i) => ({ id: `${id}${i.toString(16).padStart(4, '0')}`, kind: 'heure', w: 1 }));
  const m = cleanLayout({ accueil: 2, pages: [{ id: 'b2000001', name: 'Salon', maison: true, widgets: plein(2, 'd200') }, { id: 'b2000002', name: 'Tout', widgets: [{ id: 'c2000002', kind: 'a_faire' }, ...plein(MODULES_PAR_PAGE - 1, 'd100')] }, { id: 'b2000003', name: 'Réseau', widgets: plein(1, 'd300') }] }, IDS);
  const b = avecAujourdhui(m);
  assert.deepEqual(sortes(b).map((ks) => ks[0]), ['heure', 'a_faire', K]); assert.deepEqual(b.pages.slice(0, 2), m.pages.slice(0, 2));
  // Relue, rangée, relue : un seul, toujours en tête, la marque gardée.
  const r = cleanLayout(copie(b), IDS);
  assert.deepEqual(r, b); assert.equal(avecAujourdhui(r), r);
});

test('à l\'écran, comme la maquette : une icône par chiffre, teintée par une couleur du thème d\'Odin, jamais écrite en dur', () => {
  const i = UI.indexOf('  function renderHome('), h = UI.slice(i, UI.indexOf('\n  }\n', i));
  const k = h.slice(h.indexOf('const kpis = '), h.indexOf('// 2. À faire maintenant'));
  // Chaque chiffre dit son icône : ce sont toujours les cinq mêmes boutons, dans un seul widget.
  assert.match(h, /const kpi = \(n, label, cls, onclick, ic\) => el\('button', \{[^}]*'data-ic': ic, onclick \}, el\('i', \{ class: 'kpi-ic', 'aria-hidden': 'true' \}\)/);
  assert.deepEqual([...k.matchAll(/[)}], '([a-z]+)'\)/g)].map((x) => x[1]), ['appareils', 'missions', 'risques', 'depenses', 'mode']);
  // Le dessin, dans le widget seulement (« État détaillé » reste comme avant) : chaque teinte est une variable du thème
  // (--good, --accent…), l'icône est un masque (sa couleur est celle du texte), aucune couleur écrite en dur.
  const css = FE.slice(FE.indexOf('/* Lot 27 : les cinq chiffres.'), FE.indexOf('.fe-w[data-auj]:focus{'));
  assert.match(FE, /\.kpi-ic\{display:none\}/, 'hors du widget : pas d\'icône');
  for (const ic of ['appareils', 'missions', 'risques', 'depenses', 'mode']) assert.match(css, new RegExp(`\\.kpi\\[data-ic="${ic}"\\]\\{--kc:var\\(--[a-z-]+\\)\\}`), `${ic} : une variable du thème`);
  assert.match(css, /\.kpi\.bad\{--kc:var\(--bad\)\}/, 'un risque grave garde sa couleur');
  assert.doesNotMatch(css.replace(/url\("data:[^"]*"\)/g, ''), /#[0-9a-f]{3,8}\b|rgba?\(/i, 'aucune couleur écrite en dur');
  assert.match(css, /background:color-mix\(in srgb,var\(--kc\) 18%,transparent\)/, 'le fond de l\'icône : sa teinte à 18 %, comme la maquette');
});

test('ce que le serveur garde d\'un rangement : la marque connue (3 au plus) ; un seul widget ; rien de glissé dedans ; rien pour un autre', () => {
  const page = (ws: unknown[]) => ({ pages: [{ name: 'P', widgets: ws }] });
  for (const [envoye, garde] of [[3, 3], [2, 2], [4, 3], [99, 3], [1, undefined], [3.5, undefined], ['3', undefined]] as Array<[unknown, number | undefined]>) {
    assert.equal(cleanLayout({ ...page([{ kind: 'heure' }]), accueil: envoye }, IDS).accueil, garde, `marque ${JSON.stringify(envoye)}`);
  }
  const l = cleanLayout({ pages: [{ name: 'P', widgets: [{ id: 'd3000005', kind: K, label: 'x'.repeat(90), module: 'midgard', action: 'serrure', section: 'Sondes', input: { a: 'b' }, style: '<script>', toucher: { quoi: 'action', action: 'serrure' } }, { kind: K }] }, { name: 'Q', widgets: [{ kind: K }, { kind: 'heure' }] }] }, IDS);
  assert.deepEqual(sortes(l), [[K], ['heure']]);
  assert.deepEqual(l.pages[0].widgets[0], { id: 'd3000005', kind: K, w: 1, c: 4, r: 2, label: 'x'.repeat(40) } as unknown as Widget);
  // Un membre (et l'écran de la maison) : ni le widget, ni son identifiant, ni la marque.
  const servi = sansAccueilDuProprietaire(avecAujourdhui(DU_27A()));
  assert.ok(!JSON.stringify(servi).match(/chiffres_cles|0a0f0005|"accueil"/));
  assert.deepEqual(sortes(servi), [['heure'], ['heure', 'meteo'], ['chiffres']]);
});

// ------------------------------------------------------------------ la lecture des fichiers de la page

test('la page : titre, symbole et phrase du tiroir ; les chiffres posés dans leur widget, sinon à l\'ancienne place ; les mêmes boutons', () => {
  assert.match(FE, /chiffres_cles: 'Chiffres clés'/, 'le titre');
  assert.match(FE, /const JOUR = \['tu_veux', 'a_faire', 'odin_a_fait', 'comportement', 'chiffres_cles'\];/, 'dessinés comme les blocs du jour : la page d\'accueil pose leur contenu');
  assert.match(FE, /const LARGEUR_JOUR = \{[^}]*chiffres_cles: 12 \};/, 'reposés sur toute la largeur');
  assert.match(FE, /« Chiffres clés », « Tu veux sans doute »[^\n]*n\\'y vont jamais\./, 'le bouton « Écran de la maison » de la page le dit');
  // Les chiffres eux-mêmes : les cinq boutons d'avant, chacun mène à son détail, aucun n'appelle Odin.
  const i = UI.indexOf('  function renderHome('), h = UI.slice(i, UI.indexOf('\n  }\n', i));
  const k = h.slice(h.indexOf('const kpis = '), h.indexOf('// 2. À faire maintenant'));
  for (const [quoi, re] of [['appareils', /go\('net'\)/], ['missions', /go\('missions'\)/], ['risques', /show\('net'\); netTab\('sec'\)/], ['dépenses', /go\('settings', 'modele'\)/], ['mode', /go\('settings', 'autonomie'\)/]] as Array<[string, RegExp]>) assert.match(k, re, quoi);
  assert.equal((k.match(/\bkpi\(/g) ?? []).length, 5, 'cinq chiffres'); assert.doesNotMatch(k, /api\(/, 'aucun geste vers Odin');
  assert.match(h, /dernierChiffres = kpis;\s*const chiffresTenus = poserChiffres\(\);/);
  assert.match(h, /\.\.\.\(chiffresTenus \? \[\] : \[kpis\]\)/, 'dans « État détaillé » seulement si la fenêtre ne les tient pas');
  // En mode Modifier, ils ne répondent pas ; en plein écran, ils restent cachés, comme avant ; jamais copiés.
  assert.match(FE, /const INERTES_EN_MODIFIER = \['comportement', 'chiffres_cles'\];/);
  assert.match(FE, /if \(edit && INERTES_EN_MODIFIER\.includes\(w\.kind\)\) corps\.inert = true;/);
  assert.match(FE, /\.fe-edit \.fe-w\[data-auj="chiffres_cles"\] \.fe-auj\{pointer-events:none;opacity:\.6\}/);
  assert.match(FE, /#v-home\.pe-plein #fenetre:not\(\.fe-edit\) \.fe-w\[data-auj="chiffres_cles"\]\{display:none!important\}/);
  assert.match(FE, /if \(JOUR\.includes\(w\.kind\)\) \{ statut\.textContent = T\.copieReservee; return; \}\s*const refus = R\.copieRefusee\(/, '« Copier » refusé pour tout bloc du jour');
  assert.doesNotMatch(FE, /spentUsd|state\.autonomy/, 'le script de la fenêtre ne calcule aucun chiffre');
});

// ------------------------------------------------------------------ un vrai Odin d'essai

const tt = new Banc(), orig = { log: console.log, error: console.error, warn: console.warn };
let v: VraiOdin, membre = '';
const MDP = 'un-manguier-au-bord-du-chemin-27';
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

before(async () => {
  for (const k of ['log', 'error', 'warn'] as const) console[k] = () => {};
  v = await vraiOdin(tt, { compte: true, modules: (o) => allModules(o).filter((m) => [...IDS, 'apparence'].includes(m.id)) });
  const va = valhallaOf()!;
  assert.equal((await va.act('var', 'ajouter', { login: 'membre-d', nom: 'Membre D', groupes: 'invite', mot_de_passe: MDP })).ok, true);
  for (const appli of ['odin', 'gladsheim', 'midgard']) assert.equal((await va.act('var', 'donner_acces', { appli, qui: '@membre-d' })).ok, true);
  lierProprietaire(persona()!);
  membre = await entrer('membre-d', MDP); assert.ok(membre, 'le membre a une session');
  assert.equal((await va.act('apparence', 'theme', { theme: 'valhalla' })).ok, true);
});
after(async () => { await tt.end(); Object.assign(console, orig); });

test('Odin neuf : le propriétaire lit le widget en tête de la page « Aujourd\'hui », et la route des widgets le rend « dans l\'état », sans un chiffre', async () => {
  oublier();
  const f = await lue();
  assert.deepEqual(sortes(f.data)[0], [K, 'tu_veux', 'a_faire', 'odin_a_fait', 'comportement']); assert.equal(f.data.accueil, ACCUEIL_RECU);
  assert.match(f.text, /^- Aujourd'hui : 5 module\(s\)/);
  const r = await v.json(`/api/widgets/donnees?page=${PAGE_AUJOURDHUI.id}`);
  const w = (r.body.widgets as Array<Record<string, unknown>>).find((x) => x.kind === K)!;
  assert.deepEqual([w.id, w.etat, JSON.stringify(w.donnee)], [ID, 'ok', '{"source":"etat"}'], 'aucun chiffre dans la réponse de la route');
  assert.equal(g().settings.fenetre, undefined, 'lire ne range rien');
});

test('une fenêtre déjà rangée : ils arrivent à la lecture ; rangés, retirés, ils ne reviennent pas ; une page d\'avant la mise à jour ne les fait pas perdre', async () => {
  oublier();
  const avant = DU_27A();
  g().saveSettings({ fenetre: copie(avant) });
  const f = await lue();
  assert.deepEqual(sortes(f.data), [[K, 'tu_veux', 'a_faire', 'odin_a_fait', 'heure', 'comportement'], ['heure', 'meteo'], ['chiffres']]);
  assert.deepEqual(f.data.pages[0].widgets.slice(1), avant.pages[0].widgets, 'rien n\'a bougé : tout descend d\'une place');
  assert.deepEqual(g().settings.fenetre, avant, 'lire n\'écrit rien');
  // Une page ouverte avant la mise à jour range sa fenêtre (sans eux, marque 2) : ce n'est pas un retrait.
  const r0 = await ranger(avant); assert.equal(r0.ok, true, r0.text);
  assert.ok(sortes((await lue()).data)[0].includes(K), 'ils sont toujours là');
  // « Terminé » depuis la page d'aujourd'hui : la marque 3 ; il les retire : ils ne reviennent pas.
  assert.equal((await ranger(f.data)).ok, true); assert.equal((g().settings.fenetre as Layout).accueil, ACCUEIL_RECU);
  const sansEux = copie(f.data); sansEux.pages[0].widgets = sansEux.pages[0].widgets.filter((x: any) => x.kind !== K);
  assert.equal((await ranger(sansEux)).ok, true);
  assert.deepEqual((await lue()).data, sansEux, 'retirés : ils ne reviennent pas');
  oublier();
});

test('un membre, une tablette, la clé d\'accès : ni le widget, ni la marque ; l\'écran de la maison ne le sert à personne', async () => {
  oublier();
  const moi = await lue(), lui = await lue({ cookie: membre });
  assert.ok(sortes(moi.data).flat().includes(K));
  assert.ok(!JSON.stringify(lui).match(/chiffres_cles|0a0f000|"accueil"|Aujourd'hui/), 'un membre : ni la sorte, ni son identifiant, ni la marque, ni le nom de la page');
  const r = await v.json('/api/widgets/donnees', undefined, { cookie: membre });
  assert.equal(r.status, 200); assert.equal(r.body.qui, 'membre'); assert.ok(!JSON.stringify(r.body).match(/chiffres_cles|0a0f000/));
  assert.equal((await v.json(`/api/widgets/donnees?page=${PAGE_AUJOURDHUI.id}`, undefined, { cookie: membre })).body.widgets?.toString(), '', 'même en demandant la page par son identifiant');
  // Posé par le propriétaire sur une page « Écran de la maison » (avec des champs de bouton glissés) : servi à personne.
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
    assert.ok(!JSON.stringify(e.body.fenetre).match(/chiffres_cles|"accueil"/));
    const b = await v.json('/api/maison/fenetre', { id: sien.id }, h); assert.notEqual(b.status, 200, `le lancer par son identifiant : refusé (${b.status})`);
  }
  for (const cle of cles) assert.equal((await v.json('/api/widgets/donnees', undefined, { cookie: '', 'x-odin-maison': cle })).status, 401, 'la clé d\'une tablette n\'ouvre pas la route des widgets');
  const cle = { cookie: '', authorization: `Bearer ${v.token}` };
  assert.equal((await v.json('/api/widgets/donnees', undefined, cle)).status, 401, 'la clé d\'accès n\'ouvre pas la route des widgets');
  assert.notEqual((await v.json('/api/maison/etat', undefined, cle)).status, 200);
  // Qui range la fenêtre : un membre, la clé d'accès, une tablette, personne : refusés, rien de rangé.
  const avant = copie(g().settings.fenetre);
  for (const h of [{ cookie: membre }, cle, ...cles.map((c) => ({ cookie: '', 'x-odin-maison': c })), { cookie: '' }] as Array<Record<string, string>>) {
    const x = await v.json('/api/valhalla/act', { module: 'gladsheim', action: 'regler_fenetre', input: { fenetre: JSON.stringify({ accueil: 3, pages: [{ name: 'P', widgets: [{ kind: 'heure' }] }] }) } }, h);
    assert.ok(x.status === 401 || x.status === 403 || x.body.ok === false, `refusé (${x.status})`);
  }
  assert.deepEqual(g().settings.fenetre, avant, 'rien n\'a été rangé');
  oublier();
});

// ------------------------------------------------------------------ dans un vrai navigateur (s'il y en a un)

declare const document: any, window: any, getComputedStyle: any;
interface Page {
  goto(u: string): Promise<unknown>; waitForSelector(s: string, o?: Record<string, unknown>): Promise<unknown>; click(s: string, o?: Record<string, unknown>): Promise<void>; tap(s: string): Promise<void>; focus(s: string): Promise<void>;
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
const attendreChiffres = (p: Page) => p.waitForSelector(`${HOTE} .kpis .kpi`, { timeout: 30000 });
/** Ce que la page montre du widget. */
const vu = (p: Page) => p.evaluate((k: string) => {
  const txt = (n: any) => (n?.textContent ?? '').replace(/\s+/g, ' ').trim(), r = (n: any) => n.getBoundingClientRect();
  const c = document.querySelector(`#feGrid > .fe-w[data-auj="${k}"]`), vw = document.documentElement.clientWidth;
  const kpis = c ? [...c.querySelectorAll('.fe-auj .kpi')] : [];
  return {
    carte: c ? { titre: txt(c.querySelector('.wr-n')), sous: txt(c.querySelector('.wr-s')), plus: Boolean(c.querySelector('.wr-plus')), dedans: r(c).left >= 0 && r(c).right <= vw + 1, largeur: Math.round(r(c).width), premier: c === c.parentElement.querySelector(':scope > .fe-w') } : null,
    // Chaque icône : visible, 36 px au moins, sur un fond teinté.
    icones: kpis.map((b: any) => { const i = b.querySelector('.kpi-ic'), s = i && getComputedStyle(i); return i && r(i).width >= 36 && r(i).height >= 36 && s.backgroundColor !== 'rgba(0, 0, 0, 0)' ? 'ok' : 'manque'; }),
    libelles: kpis.map((b: any) => txt(b.querySelector('span'))), boutons: kpis.every((b: any) => b.tagName === 'BUTTON'),
    cibles: kpis.filter((n: any) => r(n).width > 0).map((n: any) => ({ t: txt(n), w: Math.round(r(n).width), h: Math.round(r(n).height), coupe: n.scrollWidth > n.clientWidth + 1 })),
    rangees: [...new Set(kpis.map((n: any) => Math.round(r(n).top)))].length,
    dedansCarte: c ? kpis.every((n: any) => r(n).bottom <= r(c).bottom + 1 && r(n).right <= r(c).right + 1) : false,
    dessous: document.querySelectorAll('#homeGrid .kpis').length,
    deborde: document.documentElement.scrollWidth > vw + 1, vw,
  };
}, K);
const vueOuverte = (p: Page) => p.evaluate(() => document.querySelector('.view.on')?.id);
/** Revenir à l'accueil par le menu (celui qui se voit). */
const revenir = async (p: Page) => { await p.evaluate(() => { ([...document.querySelectorAll('[data-view="home"]')].find((b: any) => b.offsetParent !== null)).click(); }); await p.waitForFunction(() => document.querySelector('.view.on')?.id === 'v-home'); };

test('navigateur, 1280 px : les cinq chiffres dans leur widget, plus dans « État détaillé » ; ils mènent à leur détail, à la souris et au clavier', { skip: sansNav }, async () => {
  oublier();
  const { ctx, page, erreurs } = await ouvrirPage(1280);
  try {
    await attendreChiffres(page);
    const a = await vu(page);
    assert.deepEqual(a.carte, { titre: 'Chiffres clés', sous: 'Odin', plus: true, dedans: true, largeur: a.carte!.largeur, premier: true }, 'l\'en-tête commun, « ⋯ », le premier de la page');
    assert.deepEqual(a.icones, ['ok', 'ok', 'ok', 'ok', 'ok'], 'chaque chiffre a son icône teintée, comme la maquette');
    assert.equal(a.libelles.length, 5); assert.equal(a.boutons, true, 'cinq boutons');
    assert.deepEqual(a.libelles.map((l: string) => l.replace(/^(mission|risque|appareil|dépensé|ce mois|mode).*$/, '$1')), ['appareil', 'mission', 'risque', 'dépensé', 'mode'], `les mêmes mots qu'avant (${a.libelles.join(' | ')})`);
    assert.equal(a.rangees, 1, 'côte à côte'); assert.equal(a.dedansCarte, true, 'ils tiennent dans la carte');
    assert.equal(a.dessous, 0, 'plus dans « État détaillé »');
    assert.deepEqual(a.cibles.filter((c: any) => c.h < 44 || c.w < 44 || c.coupe), [], `cibles de 44 px, aucun mot coupé : ${JSON.stringify(a.cibles)}`);
    assert.equal(a.deborde, false);
    await page.evaluate((s: string) => document.querySelector(s).scrollIntoView({ block: 'center' }), CARTE);
    await capture(page, 'chiffres-1280-clair');
    // À la souris : « missions en cours » ouvre les missions.
    await page.click(`${CARTE} .kpi:nth-child(2)`); await page.waitForFunction(() => document.querySelector('.view.on')?.id === 'v-missions');
    await revenir(page); await attendreChiffres(page);
    // Au clavier : le premier chiffre, Entrée, ouvre le réseau.
    await page.focus(`${CARTE} .kpi:nth-child(1)`); await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.querySelector('.view.on')?.id === 'v-net');
    await revenir(page); await attendreChiffres(page);
    // Odin redessine l'accueil (un nouvel état) : le chiffre qui avait le focus le garde.
    await page.focus(`${CARTE} .kpi:nth-child(3)`);
    await page.evaluate(() => { document.querySelector('#feGrid .fe-auj[data-auj="chiffres_cles"] .kpis').dataset.essai = 'ancien'; });
    assert.equal((await v.json('/api/action', { kind: 'set_control', control: 'discretion', value: 'urgent' })).body.ok, true);
    await page.waitForFunction(() => !document.querySelector('#feGrid .fe-auj[data-auj="chiffres_cles"] .kpis[data-essai]'), undefined, { timeout: 20000 });
    assert.equal(await page.evaluate(() => [...document.querySelectorAll('#feGrid .fe-auj[data-auj="chiffres_cles"] .kpi')].indexOf(document.activeElement)), 2, 'le focus n\'est pas perdu');
    await v.json('/api/action', { kind: 'set_control', control: 'discretion', value: 'essentiel' });
    // En plein écran : cachés, comme avant ; en mode Modifier, ils se voient et ne répondent pas.
    const visible = () => page.evaluate((s: string) => getComputedStyle(document.querySelector(s)).display !== 'none', CARTE);
    await page.evaluate(() => document.getElementById('v-home').classList.add('pe-plein'));
    assert.equal(await visible(), false, 'plein écran : cachés');
    await page.evaluate(() => window.OdinFenetre.edit(true)); await page.waitForSelector('#fenetre.fe-edit'); await attendreChiffres(page);
    assert.equal(await visible(), true, 'plein écran, mode Modifier : ils se voient');
    await page.evaluate(() => document.getElementById('v-home').classList.remove('pe-plein'));
    assert.equal(await page.evaluate((s: string) => document.querySelector(s).inert, HOTE), true, 'mode Modifier : inertes');
    await page.click(`${CARTE} .kpi:nth-child(2)`, { force: true, timeout: 3000 }).catch(() => undefined);
    await page.waitForTimeout(400);
    assert.equal(await vueOuverte(page), 'v-home', 'mode Modifier : un appui sur un chiffre ne quitte pas l\'accueil');
    await page.evaluate(() => window.OdinFenetre.edit(false)); await page.waitForFunction(() => !document.querySelector('#fenetre.fe-edit'));
    await attendreChiffres(page);
    assert.equal(await page.evaluate((s: string) => document.querySelector(s).inert, HOTE), false, 'hors du mode Modifier : ils répondent');
    assert.deepEqual(erreurs, [], 'aucune erreur dans la page');
  } finally { await ctx.close(); }
});

test('navigateur, 390 px, au doigt : deux par rangée, dans l\'écran, cibles de 44 px ; un appui mène au détail', { skip: sansNav }, async () => {
  oublier();
  const { ctx, page, erreurs } = await ouvrirPage(390, { sombre: true });
  try {
    await attendreChiffres(page);
    await page.evaluate((s: string) => document.querySelector(s).scrollIntoView({ block: 'center' }), CARTE);
    const a = await vu(page);
    assert.equal(a.deborde, false, 'la page ne déborde pas'); assert.equal(a.carte?.dedans, true); assert.ok(a.carte!.largeur > a.vw * 0.8, 'toute la largeur');
    assert.equal(a.rangees, 3, 'deux par rangée, le cinquième seul'); assert.equal(a.dedansCarte, true, 'ils tiennent dans la carte');
    assert.deepEqual(a.icones, ['ok', 'ok', 'ok', 'ok', 'ok'], 'au téléphone aussi, chaque chiffre a son icône');
    assert.deepEqual(a.cibles.filter((c: any) => c.h < 44 || c.w < 44 || c.coupe), [], `cibles de 44 px, aucun mot coupé : ${JSON.stringify(a.cibles)}`);
    assert.equal(a.dessous, 0);
    await capture(page, 'chiffres-390-sombre');
    await page.tap(`${CARTE} .kpi:nth-child(5)`);
    await page.waitForFunction(() => document.querySelector('.view.on')?.id === 'v-settings');
    assert.deepEqual(erreurs, [], 'aucune erreur dans la page');
  } finally { await ctx.close(); }
});

test('navigateur : ils se retirent, ne reviennent pas dans « État détaillé », et se reposent depuis le tiroir ; « Copier » est refusé', { skip: sansNav }, async () => {
  oublier();
  const { ctx, page, erreurs } = await ouvrirPage(1280, { sombre: true });
  try {
    await attendreChiffres(page);
    await page.evaluate(() => window.OdinFenetre.edit(true)); await page.waitForSelector('#fenetre.fe-edit'); await attendreChiffres(page);
    const offerts = () => page.evaluate(() => [...document.querySelectorAll('#feTiroir .fe-it b')].map((b: any) => b.textContent));
    assert.ok(!(await offerts()).includes('Chiffres clés'), 'le tiroir ne propose pas ce que la fenêtre porte déjà');
    assert.equal(await page.evaluate(() => [...document.querySelectorAll('#fenetre .fe-tools .fe-tab')].some((b: any) => /Écran de la maison/.test(b.textContent ?? '') && /« Chiffres clés »/.test(b.title ?? ''))), true, 'le bouton « Écran de la maison » de la page dit qu\'ils n\'y vont jamais');
    await page.click(`${CARTE} .wr-plus`); await page.waitForSelector('dialog.wr-regler[open]');
    const r = await page.evaluate(() => { const x = document.querySelector('dialog.wr-regler')!; ([...x.querySelectorAll('button')].find((b: any) => b.textContent?.startsWith('Copier'))).click(); return { titre: document.getElementById(x.getAttribute('aria-labelledby')!)?.textContent, retirer: [...x.querySelectorAll('button')].some((b: any) => b.textContent === 'Retirer'), statut: [...x.querySelectorAll('[role=status]')].map((n: any) => n.textContent).join('') }; });
    assert.deepEqual(r, { titre: 'Régler « Chiffres clés »', retirer: true, statut: 'Ce widget reste sur ton accueil : il ne se copie pas vers l\'autre écran.' });
    assert.equal(await page.evaluate(() => window.OdinFenetre.state().L.pages.flatMap((p: any) => p.widgets).filter((w: any) => w.kind === 'chiffres_cles').length), 1, 'aucune copie');
    await page.keyboard.press('Escape'); await page.waitForFunction(() => !document.querySelector('dialog.wr-regler'));
    await page.click(`${CARTE} [aria-label="Retirer ce module"]`);
    await page.waitForFunction((s: string) => !document.querySelector(s), CARTE);
    assert.ok((await offerts()).includes('Chiffres clés'), 'le tiroir les propose de nouveau');
    await page.evaluate(() => { ([...document.querySelectorAll('#fenetre .fe-tools .btn')].find((b: any) => b.textContent === 'Terminé')).click(); });
    await page.waitForFunction(() => !document.querySelector('#fenetre.fe-edit'), undefined, { timeout: 15000 });
    const gardee = g().settings.fenetre as Layout;
    assert.ok(!sortes(gardee).flat().includes(K)); assert.equal(gardee.accueil, ACCUEIL_RECU, 'la page a renvoyé la marque');
    await page.waitForTimeout(300);
    assert.equal((await vu(page)).dessous, 0, 'retirés : pas dans « État détaillé » non plus');
    assert.ok(!sortes((await lue()).data).flat().includes(K), 'ni à la lecture suivante');
    // Reposés depuis le tiroir : toute la largeur, remplis, et ils mènent toujours à leur détail.
    await page.evaluate(() => window.OdinFenetre.edit(true));
    await page.waitForSelector('#feTiroir', { state: 'attached' });
    await page.evaluate(() => { (document.querySelector('#feTiroir [aria-label="Ajouter Chiffres clés"]')).click(); });
    await page.waitForSelector(CARTE);
    assert.deepEqual(await page.evaluate(() => window.OdinFenetre.state().L.pages[0].widgets.filter((w: any) => w.kind === 'chiffres_cles').map((w: any) => w.c)), [12], 'un seul, sur toute la largeur');
    await page.evaluate(() => { ([...document.querySelectorAll('#fenetre .fe-tools .btn')].find((b: any) => b.textContent === 'Terminé')).click(); });
    await page.waitForFunction(() => !document.querySelector('#fenetre.fe-edit'), undefined, { timeout: 15000 });
    assert.deepEqual((g().settings.fenetre as Layout).pages[0].widgets.map((w: any) => [w.kind, w.c, w.r]).at(-1), [K, 12, 2], 'rangés en dernier, à leur taille de départ');
    await attendreChiffres(page);
    await page.click(`${CARTE} .kpi:nth-child(2)`); await page.waitForFunction(() => document.querySelector('.view.on')?.id === 'v-missions');
    assert.deepEqual(erreurs, [], 'aucune erreur dans la page');
  } finally { await ctx.close(); oublier(); }
});

test('navigateur : un membre garde les chiffres dans « État détaillé », sans widget', { skip: sansNav }, async () => {
  oublier();
  const { ctx, page, erreurs } = await ouvrirPage(1280, { cookie: membre });
  try {
    await page.waitForSelector('#homeGrid .kpis .kpi', { state: 'attached', timeout: 30000 });
    const a = await vu(page);
    assert.equal(a.carte, null, 'pas de widget pour lui'); assert.equal(a.dessous, 1, 'à l\'ancienne place, comme avant');
    assert.deepEqual(erreurs, [], 'aucune erreur dans la page');
  } finally { await ctx.close(); }
});
