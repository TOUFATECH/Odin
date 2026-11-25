// Aujourd'hui en widgets (maquette validée « Accueil », lot 27, troisième part) : les quatre tuiles d'état
// (Surveillance, Sauvegarde, Résumé du matin, Application) deviennent quatre widgets de la page « Aujourd'hui ».
// Prouvé ici :
// - les quatre sortes sont posables, réservées à l'accueil du propriétaire (jamais à un membre, à une tablette, à
//   l'écran de la maison, jamais copiables) ; elles se retirent et se reposent ; leur donnée n'est pas relue par le
//   serveur ;
// - la fenêtre de départ les porte À LA FIN de la page « Aujourd'hui », côte à côte (elles étaient sous la fenêtre) ;
//   une fenêtre déjà rangée les reçoit une seule fois, à la fin, sans rien déplacer ni rien perdre ; retirées, elles ne
//   reviennent pas ; une page restée ouverte depuis avant la mise à jour ne les fait pas disparaître ;
// - elles arrivent ensemble ou pas du tout : s'il ne reste que deux places, aucune n'arrive (la marque reste 3) ;
//   quatre places, les quatre ; une tuile arrivée puis retirée ne revient donc jamais ;
// - ce sont les mêmes cartes, les mêmes boutons, les mêmes gestes qu'avant (les réglages de la sauvegarde, la routine
//   du matin par routine_add, l'installation et les notifications) ; aucune route neuve ;
// - dans un vrai navigateur (s'il y en a un) : les tuiles sont dans leurs widgets et plus dans « État détaillé » ;
//   « Activer » mène aux réglages de la sauvegarde ; « Créer » crée la routine par le même chemin qu'avant ; 1280 et
//   390 px, cibles de 44 px ; sur une tablette (768 et 1024 px), deux par rangée, le titre entier ; l'icône en trait de
//   la tuile d'avant dans l'en-tête ; cachées en plein écran ; inertes en mode Modifier ; elles se retirent et se
//   reposent ; « Copier » est refusé ; un membre les garde à l'ancienne place.
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
const FE = lire('src/web/fenetre.js'), UI = lire('src/web/ui.html'), GRILLE = lire('src/web/pages/accueil-grille.js'), RENDU = lire('src/web/pages/widgets-rendu.js');
const KS = ['surveillance', 'sauvegarde', 'resume_matin', 'application'] as const;
const IDS4 = ['0a0f0006', '0a0f0007', '0a0f0008', '0a0f0009'];
const TITRES = ['Surveillance', 'Sauvegarde', 'Résumé du matin', 'Application'];
const IDS = ['gladsheim', 'midgard', 'vordr', 'var'];
const sortes = (l: Layout) => l.pages.map((p) => p.widgets.map((w: any) => w.kind as string));
const copie = <X>(x: X): X => JSON.parse(JSON.stringify(x));
const estTuile = (k: string) => (KS as readonly string[]).includes(k);
/** Une fenêtre rangée après l'arrivée des cinq chiffres : ils sont en tête, la marque 3. */
const RANGEE_APRES_CHIFFRES = (): Layout => cleanLayout({ accueil: 3, pages: [
  { id: '0a0f0000', code: 'aujourdhui', name: '', widgets: [{ id: '0a0f0005', kind: 'chiffres_cles', c: 12 }, { id: '0a0f0001', kind: 'tu_veux', c: 12 }, { id: '0a0f0002', kind: 'a_faire', c: 6 }, { id: '0a0f0003', kind: 'odin_a_fait', c: 6 }, { id: 'c2000009', kind: 'heure', w: 1 }, { id: '0a0f0004', kind: 'comportement', c: 12 }] },
  { id: 'b2000001', name: 'Maison', maison: true, widgets: [{ id: 'c2000001', kind: 'heure', w: 1 }, { id: 'c2000002', kind: 'meteo', w: 2 }] },
  { id: 'b2000002', name: 'Réseau', widgets: [{ id: 'c2000003', kind: 'chiffres', w: 1, module: 'midgard', label: 'Mes appareils' }] },
] }, IDS);
const plein = (n: number, id: string) => Array.from({ length: n }, (_, i) => ({ id: `${id}${i.toString(16).padStart(4, '0')}`, kind: 'heure', w: 1 }));

// ------------------------------------------------------------------ les sortes

test('les quatre tuiles : posables, réservées à l\'accueil du propriétaire, elles se retirent ; la page a les mêmes tailles', () => {
  const win: Record<string, unknown> = {}; vm.runInNewContext(GRILLE, { window: win, matchMedia: () => ({ matches: false }), crypto: globalThis.crypto });
  const G = win.OdinGrille as { MINI: Record<string, number[]>; HAUTEUR: Record<string, number> };
  for (const k of KS) {
    const s = sorteDe(k);
    assert.ok(s, `la sorte ${k} existe`);
    assert.equal(s.posable, true); assert.equal(s.famille, 'aujourdhui'); assert.equal(s.accueilSeul, true, k); assert.equal(publicDe(s), 'proprietaire');
    assert.equal(copiable(k), false, `${k} : ne se copie pas vers l'autre écran`); assert.equal(servieALaMaison(k), false, `${k} : jamais à /maison`);
    assert.deepEqual(s.applis, [], 'aucune appli derrière'); assert.equal(s.fixe, undefined, 'elle se retire (seul « À faire » ne se retire pas)');
    assert.deepEqual(TAILLE_SORTE[k], { mini: [3, 2], r: 2 });
    assert.deepEqual([...G.MINI[k]], TAILLE_SORTE[k].mini, `${k} : la même plus petite taille à l'écran`); assert.equal(G.HAUTEUR[k], TAILLE_SORTE[k].r);
  }
});

test('leur donnée : au propriétaire sur son accueil, « dans l\'état de sa page », sans rien ; à tout autre, refusée, sans rien lire', async () => {
  const lus: string[] = [];
  const src: SourceWidget = { appli: (id) => { lus.push(id); return undefined; }, vue: async (id) => { lus.push(id); return null; }, action: () => undefined, meteo: async () => undefined, lieu: () => ({ choisi: false, nom: '', fuseau: '', heure12: false }), maintenant: () => 7 };
  for (const k of KS) {
    const w = { id: 'e3000006', kind: k, w: 1, c: 3, r: 2 } as unknown as Widget;
    assert.deepEqual(await donneeWidget(w, { qui: 'proprietaire', ecran: 'accueil' }, src), { etat: 'ok', at: 7, donnee: { source: 'etat' } });
    const autres: Lecteur[] = [{ qui: 'membre', ecran: 'accueil', peutLire: () => true, ouverts: new Set(['e3000006@gladsheim']) }, { qui: 'maison', ecran: 'maison' }, { qui: 'proprietaire', ecran: 'maison' }, { qui: 'maison', ecran: 'accueil' }];
    for (const l of autres) assert.deepEqual(await donneeWidget(w, l, src), { etat: 'refuse', raison: 'accueil_du_proprietaire' }, `${k} refusé à ${l.qui} sur ${l.ecran}`);
  }
  assert.deepEqual(lus, [], 'rien n\'est lu chez une appli');
});

// ------------------------------------------------------------------ la fenêtre de départ, et celle déjà rangée

test('la fenêtre de départ : les quatre tuiles à la fin de la page « Aujourd\'hui », trois colonnes chacune ; la marque est 4', () => {
  const d = defaultLayout(['vidarr', 'midgard']), p = d.pages[0];
  assert.deepEqual(p.widgets.map((w: any) => [w.id, w.kind, w.c, w.r]), [['0a0f0005', 'chiffres_cles', 12, 2], ['0a0f0001', 'tu_veux', 12, 2], ['0a0f0002', 'a_faire', 6, 4], ['0a0f0003', 'odin_a_fait', 6, 4], ['0a0f0004', 'comportement', 12, 2],
    ...KS.map((k, i) => [IDS4[i], k, 3, 2])]);
  assert.equal(d.accueil, ACCUEIL_RECU); assert.equal(ACCUEIL_RECU, 4);
  assert.deepEqual(cleanLayout(copie(d), ['vidarr', 'midgard']), d, 'relue, elle ne change pas (la marque est gardée)');
  assert.equal(avecAujourdhui(d), d, 'rien à lui apporter');
  assert.deepEqual(PAGE_AUJOURDHUI.widgets.filter((x) => estTuile(x.kind)).map((x) => [x.kind, x.depuis, 'tete' in x]), KS.map((k) => [k, 4, false]));
});

test('une fenêtre rangée après les cinq chiffres reçoit les quatre tuiles une seule fois, à la fin, sans rien perdre ni rien déplacer', () => {
  const avant = RANGEE_APRES_CHIFFRES(), apres = avecAujourdhui(avant);
  assert.equal(avant.accueil, 3);
  assert.equal(apres.accueil, ACCUEIL_RECU);
  assert.deepEqual(apres.pages.slice(1), avant.pages.slice(1), 'ses autres pages : rien n\'a bougé');
  assert.deepEqual(apres.pages[0].widgets.slice(0, -4), avant.pages[0].widgets, 'sur la page : tout reste à sa place, aux mêmes tailles');
  assert.deepEqual(apres.pages[0].widgets.slice(-4).map((w: any) => [w.id, w.kind, w.c, w.r]), KS.map((k, i) => [IDS4[i], k, 3, 2]), 'à la fin, dans l\'ordre d\'avant');
  assert.deepEqual(avecAujourdhui(RANGEE_APRES_CHIFFRES()), apres, 'deux lectures : la même fenêtre');
  assert.equal(avecAujourdhui(apres), apres, 'déjà reçues : rien de plus');
  const rangee = cleanLayout(copie(apres), IDS);
  assert.deepEqual(rangee, apres); assert.equal(avecAujourdhui(rangee), rangee);
});

test('reçues puis retirées : elles ne reviennent pas ; rangées par une page d\'avant la mise à jour (marque 3) : elles ne sont pas perdues', () => {
  const recue = avecAujourdhui(RANGEE_APRES_CHIFFRES());
  // Il retire la seule « Sauvegarde » : les trois autres restent, elle ne revient pas.
  const une = copie(recue); une.pages[0].widgets = une.pages[0].widgets.filter((w: any) => w.kind !== 'sauvegarde');
  const g1 = cleanLayout(une, IDS);
  assert.equal(avecAujourdhui(g1), g1, 'une seule retirée : elle ne revient pas');
  assert.equal(retraitRefuse(recue, g1), undefined, 'la retirer n\'est pas refusé');
  // Il les retire toutes.
  const retire = copie(recue); retire.pages[0].widgets = retire.pages[0].widgets.filter((w: any) => !estTuile(w.kind));
  const gardee = cleanLayout(retire, IDS);
  assert.equal(gardee.accueil, ACCUEIL_RECU); assert.ok(!sortes(gardee).flat().some(estTuile));
  assert.equal(avecAujourdhui(gardee), gardee, 'retirées : elles ne reviennent pas');
  // Une page ouverte avant la mise à jour range ce qu'elle connaît : sans elles, avec la marque 3. Elles reviennent à la lecture.
  const vieille = cleanLayout({ ...retire, accueil: 3 }, IDS);
  assert.equal(vieille.accueil, 3);
  assert.deepEqual(sortes(avecAujourdhui(vieille))[0], ['chiffres_cles', 'tu_veux', 'a_faire', 'odin_a_fait', 'heure', 'comportement', ...KS]);
});

test('une fenêtre plus ancienne reçoit tout ce qui lui manque, dans l\'ordre ; rien en double, aucun identifiant repris', () => {
  // Rangée après « Comment Odin se comporte » (marque 2) : les chiffres en tête, les tuiles à la fin.
  const rangeeApresReglages = copie(RANGEE_APRES_CHIFFRES()); rangeeApresReglages.accueil = 2; rangeeApresReglages.pages[0].widgets = rangeeApresReglages.pages[0].widgets.filter((w: any) => w.kind !== 'chiffres_cles');
  const a = avecAujourdhui(cleanLayout(rangeeApresReglages, IDS));
  assert.deepEqual(sortes(a)[0], ['chiffres_cles', 'tu_veux', 'a_faire', 'odin_a_fait', 'heure', 'comportement', ...KS]); assert.equal(a.accueil, ACCUEIL_RECU);
  // Rangée au lot 26 (sans marque) : « Comment Odin se comporte », les chiffres et les tuiles.
  const l26 = copie(rangeeApresReglages); delete l26.accueil; l26.pages[0].widgets = l26.pages[0].widgets.filter((w: any) => w.kind !== 'comportement');
  const b = avecAujourdhui(cleanLayout(l26, IDS));
  assert.deepEqual(sortes(b)[0], ['chiffres_cles', 'tu_veux', 'a_faire', 'odin_a_fait', 'heure', 'comportement', ...KS]); assert.equal(b.accueil, ACCUEIL_RECU);
  // Une fenêtre d'avant le lot 26 : la page entière, en premier, la même qu'au départ.
  const ancienne = cleanLayout({ pages: [{ id: 'b3000001', name: 'Maison', maison: true, widgets: [{ id: 'c3000001', kind: 'heure', w: 1 }] }] }, IDS);
  const c = avecAujourdhui(ancienne);
  assert.deepEqual(c.pages[0], defaultLayout([]).pages[0]); assert.deepEqual(c.pages.slice(1), ancienne.pages);
  // Une tuile déjà portée ailleurs (reposée à la main, sans la marque) : pas de double, les trois autres arrivent.
  const deja = RANGEE_APRES_CHIFFRES(); deja.pages[2].widgets.push({ id: 'c2000007', kind: 'resume_matin', w: 2, c: 6, r: 2 } as unknown as Widget);
  const d = avecAujourdhui(deja);
  assert.equal(sortes(d).flat().filter((k) => k === 'resume_matin').length, 1); assert.deepEqual(d.pages[2], deja.pages[2]);
  assert.deepEqual(sortes(d)[0].slice(-3), ['surveillance', 'sauvegarde', 'application']); assert.equal(d.accueil, ACCUEIL_RECU);
  // Un identifiant de départ déjà pris : le suivant libre, toujours le même ; aucun identifiant en double.
  const pris = RANGEE_APRES_CHIFFRES(); (pris.pages[1].widgets[0] as { id: string }).id = IDS4[0];
  const p1 = avecAujourdhui(pris);
  assert.equal((p1.pages[0].widgets.find((w) => w.kind === 'surveillance') as any).id, '0a0f0016'); assert.deepEqual(p1, avecAujourdhui(copie(pris)));
  const ids = p1.pages.flatMap((x) => x.widgets.map((w) => w.id)); assert.equal(new Set(ids).size, ids.length);
});

test('elles arrivent ensemble ou pas du tout : deux places, aucune (la marque reste 3) ; quatre places, les quatre ; une retirée ne revient pas', () => {
  const l = cleanLayout({ accueil: 3, pages: [{ id: '0a0f0000', code: 'aujourdhui', widgets: [{ id: '0a0f0002', kind: 'a_faire' }, ...plein(MODULES_PAR_PAGE - 3, 'd100')] },
    { id: 'b2000001', name: 'Salon', widgets: plein(MODULES_PAR_PAGE, 'd200') }] }, IDS);
  // Deux places : si deux arrivaient avec la marque 3, l'une retirée reviendrait à la lecture suivante.
  const a = avecAujourdhui(l);
  assert.equal(a, l, 'deux places : rien n\'arrive, rien ne bouge');
  assert.ok(!sortes(a).flat().some(estTuile)); assert.equal(a.accueil, 3);
  // Deux places de plus (sur une autre page) : les quatre arrivent, chacune une fois, la marque passe à 4.
  const quatre = copie(l); quatre.pages[1].widgets.splice(0, 2);
  const b = avecAujourdhui(cleanLayout(quatre, IDS));
  assert.equal(b.accueil, ACCUEIL_RECU);
  for (const k of KS) assert.equal(sortes(b).flat().filter((x) => x === k).length, 1, `${k} : une seule`);
  assert.deepEqual(sortes(b)[0].slice(-2), ['surveillance', 'sauvegarde'], 'les deux premières à la fin de la page « Aujourd\'hui »');
  assert.deepEqual(sortes(b)[1].slice(-2), ['resume_matin', 'application'], 'les deux autres sur la page suivante qui a de la place');
  assert.deepEqual(b.pages[0].widgets.slice(0, -2), l.pages[0].widgets, 'rien n\'est déplacé');
  // Il en retire une : elle ne revient pas.
  const sans = copie(b); sans.pages[0].widgets = sans.pages[0].widgets.filter((w: any) => w.kind !== 'surveillance');
  const g1 = cleanLayout(sans, IDS);
  assert.equal(avecAujourdhui(g1), g1, 'retirée : elle ne revient pas');
  // Trois places : toujours rien (il en faut quatre).
  const trois = copie(l); trois.pages[0].widgets.splice(1, 1);
  const c = cleanLayout(trois, IDS);
  assert.equal(MODULES_PAR_PAGE - c.pages[0].widgets.length, 3);
  assert.equal(avecAujourdhui(c), c, 'trois places : rien n\'arrive');
});

test('ce que le serveur garde d\'un rangement : la marque connue (4 au plus) ; une seule de chaque ; rien de glissé dedans ; rien pour un autre', () => {
  const page = (ws: unknown[]) => ({ pages: [{ name: 'P', widgets: ws }] });
  for (const [envoye, garde] of [[4, 4], [3, 3], [5, 4], [99, 4], [1, undefined]] as Array<[unknown, number | undefined]>) {
    assert.equal(cleanLayout({ ...page([{ kind: 'heure' }]), accueil: envoye }, IDS).accueil, garde, `marque ${JSON.stringify(envoye)}`);
  }
  const l = cleanLayout({ pages: [{ name: 'P', widgets: [{ id: 'd3000006', kind: 'sauvegarde', label: 'x'.repeat(90), module: 'midgard', action: 'serrure', input: { a: 'b' }, style: '<script>', toucher: { quoi: 'action', action: 'serrure' } }, { kind: 'sauvegarde' }] }, { name: 'Q', widgets: [{ kind: 'sauvegarde' }, { kind: 'application' }] }] }, IDS);
  assert.deepEqual(sortes(l), [['sauvegarde'], ['application']]);
  assert.deepEqual(l.pages[0].widgets[0], { id: 'd3000006', kind: 'sauvegarde', w: 1, c: 4, r: 2, label: 'x'.repeat(40) } as unknown as Widget);
  // Un membre (et l'écran de la maison) : ni les widgets, ni leurs identifiants, ni la marque.
  const servi = sansAccueilDuProprietaire(avecAujourdhui(RANGEE_APRES_CHIFFRES()));
  assert.ok(!JSON.stringify(servi).match(/surveillance|sauvegarde|resume_matin|application|0a0f000[6-9]|"accueil"/));
  assert.deepEqual(sortes(servi), [['heure'], ['heure', 'meteo'], ['chiffres']]);
});

// ------------------------------------------------------------------ la lecture des fichiers de la page

test('la page : titres, symboles et phrases du tiroir ; les tuiles posées dans leur widget, sinon à l\'ancienne place ; les mêmes boutons', () => {
  for (const [i, k] of KS.entries()) assert.match(FE, new RegExp(`\\b${k}: '${TITRES[i].replace(/'/g, '\\\\\'')}'`), `le titre de ${k}`);
  assert.match(FE, /const JOUR = \['tu_veux', 'a_faire', 'odin_a_fait', 'comportement', 'chiffres_cles', 'surveillance', 'sauvegarde', 'resume_matin', 'application'\];/);
  assert.match(FE, /const LARGEUR_JOUR = \{[^}]*surveillance: 3, sauvegarde: 3, resume_matin: 3, application: 3 \};/, 'reposées sur trois colonnes');
  assert.match(FE, /w: LARGEUR_JOUR\[k\] > 8 \? 3 : LARGEUR_JOUR\[k\] > 4 \? 2 : 1, c: LARGEUR_JOUR\[k\]/, 'l\'ancienne largeur va avec la nouvelle (sinon le serveur l\'élargirait)');
  assert.match(FE, /« Surveillance », « Sauvegarde », « Résumé du matin » et « Application »[^\n]*n\\'y vont jamais\./, 'le bouton « Écran de la maison » de la page le dit');
  assert.match(RENDU, /const RESERVEES = \[[^\]]*'surveillance', 'sauvegarde', 'resume_matin', 'application'\];/, 'la page ne les copie jamais');
  // En mode Modifier, leurs boutons ne répondent pas ; en plein écran, elles restent cachées, comme avant.
  assert.match(FE, /const INERTES_EN_MODIFIER = \['comportement', 'chiffres_cles', 'surveillance', 'sauvegarde', 'resume_matin', 'application'\];/);
  for (const k of KS) {
    assert.match(FE, new RegExp(`\\.fe-edit \\.fe-w\\[data-auj="${k}"\\] \\.fe-auj[,{]`), `${k} : inerte en mode Modifier`);
    assert.match(FE, new RegExp(`#v-home\\.pe-plein #fenetre:not\\(\\.fe-edit\\) \\.fe-w\\[data-auj="${k}"\\][,{]`), `${k} : cachée en plein écran`);
  }
  // Les tuiles elles-mêmes : les mêmes cartes, dans renderHome, et les mêmes gestes.
  const i = UI.indexOf('  function renderHome('), h = UI.slice(i, UI.indexOf('\n  }\n', i));
  const t = h.slice(h.indexOf('const tuiles = {'), h.indexOf('dernierJour = [items, live];'));
  assert.match(t, /surveillance: card\('Surveillance', '🛡'/); assert.match(t, /sauvegarde: card\('Sauvegarde', '💾'/); assert.match(t, /resume_matin: card\('Résumé du matin', '⏰'/);
  assert.match(t, /application: el\('article', \{ class: 'hcard', id: 'appCard' \}\)/);
  assert.match(t, /onclick: go\('settings', 'sauvegarde'\)/, 'la sauvegarde mène à ses réglages, comme avant');
  assert.match(t, /kind: 'routine_add', cron: `0 \$\{h\} \* \* \*`, peer, prompt: 'Résumé du matin : /, 'la routine du matin : la même action, la même demande');
  assert.match(t, /const tiles = el\('div', \{ class: 'hgrid2' \}, \.\.\.Object\.values\(tuiles\)\);/);
  assert.match(h, /dernieresTuiles = tuiles;\s*const tuilesTenues = poserTuiles\(\);/);
  assert.match(h, /\.\.\.\(tuilesTenues \? \[\] : \[tiles\]\)/, 'dans « État détaillé » seulement si la fenêtre ne les tient pas');
  const j = UI.indexOf('  function poserTuiles('), p = UI.slice(j, UI.indexOf('\n  }\n', j));
  assert.match(p, /fen\?\.hote\(k\)/); assert.match(p, /h\.replaceChildren\(n\)/); assert.match(p, /renderAppCard\(\)/, 'l\'appli est redessinée là où elle est posée');
  assert.match(UI, /document\.addEventListener\('odin:fenetre', poserTuiles\);/);
  assert.doesNotMatch(p, /api\(/, 'poser n\'appelle pas Odin');
  // L'en-tête du widget reprend l'icône en trait de la tuile d'avant (SVG_ICONS), pas un émoji.
  assert.match(p, /\.hct > \.hico > svg/, 'l\'icône en trait de la carte passe dans l\'en-tête');
  // Sur une tablette (entre le téléphone et l'ordinateur), deux par rangée au moins (six colonnes sur douze).
  for (const k of KS) assert.match(FE, new RegExp(`@media \\(min-width:\\$\\{G\\.GRILLE\\.telephone \\+ 1\\}px\\) and \\(max-width:\\$\\{G\\.GRILLE\\.ordinateur - 0\\.02\\}px\\)\\{[^}]*\\.fe-grid>\\.fe-w\\[data-auj="${k}"\\]`), `${k} : six colonnes au moins sur une tablette`);
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
  assert.equal((await va.act('var', 'ajouter', { login: 'membre-t', nom: 'Membre T', groupes: 'invite', mot_de_passe: MDP })).ok, true);
  for (const appli of ['odin', 'gladsheim', 'midgard']) assert.equal((await va.act('var', 'donner_acces', { appli, qui: '@membre-t' })).ok, true);
  lierProprietaire(persona()!);
  membre = await entrer('membre-t', MDP); assert.ok(membre, 'le membre a une session');
  assert.equal((await va.act('apparence', 'theme', { theme: 'valhalla' })).ok, true);
});
after(async () => { await tt.end(); Object.assign(console, orig); });

test('Odin neuf : le propriétaire lit les quatre tuiles à la fin de la page « Aujourd\'hui », et la route des widgets les rend « dans l\'état »', async () => {
  oublier();
  const f = await lue();
  assert.deepEqual(sortes(f.data)[0], ['chiffres_cles', 'tu_veux', 'a_faire', 'odin_a_fait', 'comportement', ...KS]); assert.equal(f.data.accueil, ACCUEIL_RECU);
  assert.match(f.text, /^- Aujourd'hui : 9 module\(s\)/);
  const r = await v.json(`/api/widgets/donnees?page=${PAGE_AUJOURDHUI.id}`);
  for (const [i, k] of KS.entries()) {
    const w = (r.body.widgets as Array<Record<string, unknown>>).find((x) => x.kind === k)!;
    assert.deepEqual([w.id, w.etat, JSON.stringify(w.donnee)], [IDS4[i], 'ok', '{"source":"etat"}'], `${k} : rien d'autre dans la réponse de la route`);
  }
  assert.equal(g().settings.fenetre, undefined, 'lire ne range rien');
});

test('une fenêtre déjà rangée : elles arrivent à la lecture ; rangées, retirées, elles ne reviennent pas ; une page d\'avant la mise à jour ne les fait pas perdre', async () => {
  oublier();
  const avant = RANGEE_APRES_CHIFFRES();
  g().saveSettings({ fenetre: copie(avant) });
  const f = await lue();
  assert.deepEqual(sortes(f.data), [['chiffres_cles', 'tu_veux', 'a_faire', 'odin_a_fait', 'heure', 'comportement', ...KS], ['heure', 'meteo'], ['chiffres']]);
  assert.deepEqual(f.data.pages[0].widgets.slice(0, -4), avant.pages[0].widgets, 'rien n\'a bougé');
  assert.deepEqual(g().settings.fenetre, avant, 'lire n\'écrit rien');
  // Une page ouverte avant la mise à jour range sa fenêtre (sans elles, marque 3) : ce n'est pas un retrait.
  const r0 = await ranger(avant); assert.equal(r0.ok, true, r0.text);
  assert.deepEqual(sortes((await lue()).data)[0].slice(-4), [...KS], 'elles sont toujours là');
  // « Terminé » depuis la page d'aujourd'hui : la marque 4 ; il en retire deux : elles ne reviennent pas.
  assert.equal((await ranger(f.data)).ok, true); assert.equal((g().settings.fenetre as Layout).accueil, ACCUEIL_RECU);
  const sansDeux = copie(f.data); sansDeux.pages[0].widgets = sansDeux.pages[0].widgets.filter((x: any) => x.kind !== 'sauvegarde' && x.kind !== 'application');
  assert.equal((await ranger(sansDeux)).ok, true);
  assert.deepEqual((await lue()).data, sansDeux, 'retirées : elles ne reviennent pas');
  oublier();
});

test('un membre, une tablette, la clé d\'accès : ni les tuiles, ni la marque ; l\'écran de la maison ne les sert à personne', async () => {
  oublier();
  const moi = await lue(), lui = await lue({ cookie: membre });
  assert.ok(KS.every((k) => sortes(moi.data).flat().includes(k)));
  assert.ok(!JSON.stringify(lui).match(/surveillance|sauvegarde|resume_matin|"application"|0a0f000|"accueil"|Aujourd'hui/), 'un membre : ni les sortes, ni leurs identifiants, ni la marque, ni le nom de la page');
  const r = await v.json('/api/widgets/donnees', undefined, { cookie: membre });
  assert.equal(r.status, 200); assert.equal(r.body.qui, 'membre'); assert.ok(!JSON.stringify(r.body).match(/surveillance|sauvegarde|resume_matin|"application"|0a0f000/));
  assert.equal((await v.json(`/api/widgets/donnees?page=${PAGE_AUJOURDHUI.id}`, undefined, { cookie: membre })).body.widgets?.toString(), '', 'même en demandant la page par son identifiant');
  // Posées par le propriétaire sur une page « Écran de la maison » (avec des champs de bouton glissés) : servies à personne.
  const f = copie(moi.data), maison = f.pages.find((p) => p.maison)!, siennes = f.pages[0].widgets.filter((w: any) => estTuile(w.kind));
  f.pages[0].widgets = f.pages[0].widgets.filter((w) => !siennes.includes(w));
  maison.widgets.push(...siennes.map((w) => ({ ...w, module: 'midgard', action: 'scene', toucher: { quoi: 'action', action: 'scene' } } as unknown as Widget)));
  f.pages[0].maison = true;
  assert.equal((await ranger(f)).ok, true);
  const rangee = g().settings.fenetre as Layout;
  assert.ok(KS.every((k) => rangee.pages.some((p) => p.maison && p.widgets.some((w) => w.kind === k))), 'elles sont bien sur une page marquée');
  const cles = await Promise.all((['complet', 'maison'] as const).map(async (droits) => ((await valhallaOf()!.act('gladsheim', 'cle_tablette', { nom: `Tablette ${droits}`, droits })).data as { key: string }).key));
  for (const h of [{}, ...cles.map((cle) => ({ cookie: '', 'x-odin-maison': cle }))] as Array<Record<string, string>>) {
    const e = await v.json('/api/maison/etat', undefined, h); assert.equal(e.status, 200);
    const servis = ((e.body.fenetre as FPage[]) ?? []).flatMap((p) => p.widgets.map((w: any) => w.kind as string));
    assert.ok(servis.includes('heure'), 'la page est bien servie'); assert.ok(!servis.some(estTuile), 'sans elles');
    assert.ok(!JSON.stringify(e.body.fenetre).match(/surveillance|sauvegarde|resume_matin|"application"|"accueil"/));
    for (const w of siennes) { const b = await v.json('/api/maison/fenetre', { id: w.id }, h); assert.notEqual(b.status, 200, `la lancer par son identifiant : refusé (${b.status})`); }
  }
  for (const cle of cles) assert.equal((await v.json('/api/widgets/donnees', undefined, { cookie: '', 'x-odin-maison': cle })).status, 401, 'la clé d\'une tablette n\'ouvre pas la route des widgets');
  const cle = { cookie: '', authorization: `Bearer ${v.token}` };
  assert.equal((await v.json('/api/widgets/donnees', undefined, cle)).status, 401, 'la clé d\'accès n\'ouvre pas la route des widgets');
  assert.notEqual((await v.json('/api/maison/etat', undefined, cle)).status, 200);
  // Qui range la fenêtre : un membre, la clé d'accès, une tablette, personne : refusés, rien de rangé.
  const avant = copie(g().settings.fenetre);
  for (const h of [{ cookie: membre }, cle, ...cles.map((c) => ({ cookie: '', 'x-odin-maison': c })), { cookie: '' }] as Array<Record<string, string>>) {
    const x = await v.json('/api/valhalla/act', { module: 'gladsheim', action: 'regler_fenetre', input: { fenetre: JSON.stringify({ accueil: 4, pages: [{ name: 'P', widgets: [{ kind: 'heure' }] }] }) } }, h);
    assert.ok(x.status === 401 || x.status === 403 || x.body.ok === false, `refusé (${x.status})`);
  }
  assert.deepEqual(g().settings.fenetre, avant, 'rien n\'a été rangé');
  oublier();
});

// ------------------------------------------------------------------ dans un vrai navigateur (s'il y en a un)

declare const document: any, window: any, getComputedStyle: any;
interface Requete { url(): string; method(): string; postDataJSON(): any }
interface Page {
  goto(u: string): Promise<unknown>; waitForSelector(s: string, o?: Record<string, unknown>): Promise<unknown>; click(s: string, o?: Record<string, unknown>): Promise<void>; tap(s: string): Promise<void>; focus(s: string): Promise<void>;
  waitForFunction(f: string | ((a: any) => unknown), a?: unknown, o?: Record<string, unknown>): Promise<unknown>; evaluate<X>(f: string | ((a?: any) => X), a?: unknown): Promise<X>; selectOption(s: string, v: string): Promise<unknown>;
  keyboard: { press(k: string): Promise<void> }; waitForTimeout(ms: number): Promise<void>; on(e: string, f: (x: any) => void): void; screenshot(o: Record<string, unknown>): Promise<unknown>;
  waitForRequest(f: (r: Requete) => boolean, o?: Record<string, unknown>): Promise<Requete>;
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

async function ouvrirPage(largeur: number, o: { cookie?: string; sombre?: boolean } = {}) {
  const doigt = largeur < 500;
  const ctx = await nav!.newContext({ viewport: { width: largeur, height: doigt ? 800 : 900 }, hasTouch: doigt, isMobile: doigt, locale: 'fr-FR', colorScheme: o.sombre ? 'dark' : 'light' });
  const [n, ...x] = (o.cookie ?? v.session).split('='); await ctx.addCookies([{ name: n, value: x.join('='), url: v.url, httpOnly: true, sameSite: 'Strict' }]);
  await ctx.addInitScript(`try { localStorage.setItem('odin.tour', 'done'); ${o.sombre ? 'localStorage.setItem(\'odin.theme\', \'sombre\');' : ''} } catch { /* rien */ }`);
  const page = await ctx.newPage(), erreurs: string[] = [];
  page.on('pageerror', (e) => erreurs.push(String(e)));
  await page.goto(v.url + '/');
  await page.waitForSelector('#app:not([hidden])', { timeout: 30000 });
  await page.waitForSelector('#feGrid .fe-w', { timeout: 45000 });
  return { ctx, page, erreurs };
}
const CARTE = (k: string) => `#feGrid > .fe-w[data-auj="${k}"]`, HOTE = (k: string) => `#feGrid .fe-auj[data-auj="${k}"]`;
const attendreTuiles = (p: Page) => p.waitForFunction((ks: string[]) => ks.every((k) => document.querySelector(`#feGrid .fe-auj[data-auj="${k}"] > .hcard`)?.childElementCount > 1), [...KS], { timeout: 30000 });
/** Ce que la page montre des quatre widgets. */
const vu = (p: Page): Promise<any> => p.evaluate((ks: string[]) => {
  const txt = (n: any) => (n?.textContent ?? '').replace(/\s+/g, ' ').trim(), r = (n: any) => n.getBoundingClientRect(), vw = document.documentElement.clientWidth;
  const cartes = [...document.querySelectorAll('#feGrid > .fe-w')];
  return {
    tuiles: ks.map((k) => {
      const c = document.querySelector(`#feGrid > .fe-w[data-auj="${k}"]`); if (!c) return null;
      const corps = c.querySelector('.fe-auj > .hcard'), cibles = corps ? [...corps.querySelectorAll('button, select, summary')].filter((n: any) => r(n).width > 0) : [];
      return {
        titre: txt(c.querySelector('.wr-n')), sous: txt(c.querySelector('.wr-s')), plus: Boolean(c.querySelector('.wr-plus')), rang: cartes.indexOf(c), dedans: r(c).left >= 0 && r(c).right <= vw + 1,
        largeur: Math.round(r(c).width), haut: Math.round(r(c).top), texte: txt(corps).slice(0, 80),
        // Le titre de l'ancienne tuile ne se voit plus (l'en-tête du widget le porte), ni son cadre.
        vieuxTitre: corps ? getComputedStyle(corps.querySelector('.hct') ?? corps).display !== 'none' && Boolean(corps.querySelector('.hct')) : null,
        cadre: corps ? getComputedStyle(corps).borderTopWidth : null,
        cibles: cibles.map((n: any) => ({ t: txt(n).slice(0, 30), w: Math.round(r(n).width), h: Math.round(r(n).height) })).filter((x: any) => x.w < 44 || x.h < 44),
        // Tout ce qu'elle montre tient dans la carte, jusqu'au dernier mot (un long chemin de disque compris).
        dedansCarte: corps ? [...corps.querySelectorAll('*')].filter((n: any) => r(n).width > 0).every((n: any) => r(n).bottom <= r(c).bottom + 1 && r(n).right <= r(c).right + 1) : false,
      };
    }),
    nbCartes: cartes.length, dessous: document.querySelectorAll('#homeGrid .hcard').length, appCards: document.querySelectorAll('#appCard').length,
    deborde: document.documentElement.scrollWidth > vw + 1, vw,
  };
}, [...KS]);
const vueOuverte = (p: Page) => p.evaluate(() => document.querySelector('.view.on')?.id);
/** Revenir à l'accueil par le menu (celui qui se voit). */
const revenir = async (p: Page) => { await p.evaluate(() => { ([...document.querySelectorAll('[data-view="home"]')].find((b: any) => b.offsetParent !== null)).click(); }); await p.waitForFunction(() => document.querySelector('.view.on')?.id === 'v-home'); };

test('navigateur, 1280 px : les quatre tuiles dans leurs widgets, côte à côte, plus dans « État détaillé » ; les mêmes gestes qu\'avant', { skip: sansNav }, async () => {
  oublier();
  const { ctx, page, erreurs } = await ouvrirPage(1280);
  try {
    await attendreTuiles(page);
    const a = await vu(page);
    assert.deepEqual(a.tuiles.map((t: any) => t && [t.titre, t.sous, t.plus, t.dedans]), TITRES.map((t) => [t, 'Odin', true, true]), 'l\'en-tête commun et « ⋯ »');
    assert.deepEqual(a.tuiles.map((t: any) => t.rang), [5, 6, 7, 8].map((x) => x), 'les quatre dernières de la page, dans l\'ordre d\'avant');
    assert.equal(new Set(a.tuiles.map((t: any) => t.haut)).size, 1, 'côte à côte, sur une rangée');
    assert.deepEqual(a.tuiles.map((t: any) => [t.vieuxTitre, t.cadre]), KS.map(() => [false, '0px']), 'ni le vieux titre, ni le vieux cadre dans le widget');
    assert.match(a.tuiles[0].texte, /appareils importants|%/, 'Surveillance : ce qu\'elle montrait');
    assert.match(a.tuiles[1].texte, /Automatique : désactivée|Chaque nuit/, 'Sauvegarde : ce qu\'elle montrait');
    assert.match(a.tuiles[2].texte, /Météo, réseau, rappels du jour\./, 'Résumé du matin : ce qu\'il montrait');
    assert.match(a.tuiles[3].texte, /Odin est installé|Installer Odin|navigateur|Partager/, 'Application : remplie');
    assert.deepEqual(a.tuiles.map((t: any) => t.cibles), KS.map(() => []), 'cibles de 44 px');
    assert.deepEqual(a.tuiles.map((t: any) => t.dedansCarte), KS.map(() => true), 'tout tient dans la carte');
    assert.equal(a.dessous, 0, 'plus dans « État détaillé »'); assert.equal(a.appCards, 1, 'une seule tuile Application dans la page');
    assert.equal(a.deborde, false);
    await page.evaluate((s: string) => document.querySelector(s).scrollIntoView({ block: 'center' }), CARTE('sauvegarde'));
    await capture(page, 'tuiles-1280-clair');
    // « Activer » (ou « Réglages ») : les réglages de la sauvegarde, comme avant.
    await page.click(`${CARTE('sauvegarde')} .hcard > .btn`); await page.waitForFunction(() => document.querySelector('.view.on')?.id === 'v-settings');
    await revenir(page); await attendreTuiles(page);
    // « Créer » : la routine du matin, par la même action qu'avant (routine_add), à l'heure choisie ; la tuile le compte.
    const jobs = () => page.evaluate(() => Number(/(\d+) tâche\(s\) planifiée\(s\)/.exec(document.querySelector('#feGrid .fe-auj[data-auj="resume_matin"]').textContent)?.[1] ?? 0));
    const n0 = await jobs();
    await page.selectOption(`${CARTE('resume_matin')} #rt-hour`, '8');
    const [req] = await Promise.all([page.waitForRequest((q) => q.url().endsWith('/api/action') && q.method() === 'POST'), page.click(`${CARTE('resume_matin')} .btn.primary`)]);
    const corps = req.postDataJSON();
    assert.deepEqual([corps.kind, corps.cron], ['routine_add', '0 8 * * *']); assert.match(corps.prompt, /^Résumé du matin : /);
    await page.waitForFunction((n: number) => Number(/(\d+) tâche\(s\) planifiée\(s\)/.exec(document.querySelector('#feGrid .fe-auj[data-auj="resume_matin"]')?.textContent ?? '')?.[1] ?? 0) === n + 1, n0, { timeout: 20000 });
    // Au clavier : le focus reste sur la liste des heures quand Odin redessine l'accueil.
    await page.focus(`${CARTE('resume_matin')} #rt-hour`);
    await page.evaluate(() => { document.querySelector('#feGrid .fe-auj[data-auj="resume_matin"] > .hcard').dataset.essai = 'ancien'; });
    assert.equal((await v.json('/api/action', { kind: 'set_control', control: 'discretion', value: 'urgent' })).body.ok, true);
    await page.waitForFunction(() => !document.querySelector('#feGrid .fe-auj[data-auj="resume_matin"] > .hcard[data-essai]'), undefined, { timeout: 20000 });
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'rt-hour', 'le focus n\'est pas perdu');
    await v.json('/api/action', { kind: 'set_control', control: 'discretion', value: 'essentiel' });
    // En plein écran : cachées, comme avant ; en mode Modifier, elles se voient et ne répondent pas.
    const visibles = () => page.evaluate((ks: string[]) => ks.map((k) => getComputedStyle(document.querySelector(`#feGrid > .fe-w[data-auj="${k}"]`)).display !== 'none'), [...KS]);
    await page.evaluate(() => document.getElementById('v-home').classList.add('pe-plein'));
    assert.deepEqual(await visibles(), [false, false, false, false], 'plein écran : cachées');
    await page.evaluate(() => window.OdinFenetre.edit(true)); await page.waitForSelector('#fenetre.fe-edit'); await attendreTuiles(page);
    assert.deepEqual(await visibles(), [true, true, true, true], 'plein écran, mode Modifier : elles se voient');
    await page.evaluate(() => document.getElementById('v-home').classList.remove('pe-plein'));
    assert.deepEqual(await page.evaluate((ks: string[]) => ks.map((k) => document.querySelector(`#feGrid .fe-auj[data-auj="${k}"]`).inert), [...KS]), [true, true, true, true], 'mode Modifier : inertes');
    await page.click(`${CARTE('sauvegarde')} .hcard > .btn`, { force: true, timeout: 3000 }).catch(() => undefined);
    await page.waitForTimeout(400);
    assert.equal(await vueOuverte(page), 'v-home', 'mode Modifier : un appui sur « Activer » ne quitte pas l\'accueil');
    await page.evaluate(() => window.OdinFenetre.edit(false)); await page.waitForFunction(() => !document.querySelector('#fenetre.fe-edit'));
    await attendreTuiles(page);
    assert.deepEqual(await page.evaluate((ks: string[]) => ks.map((k) => document.querySelector(`#feGrid .fe-auj[data-auj="${k}"]`).inert), [...KS]), [false, false, false, false], 'hors du mode Modifier : elles répondent');
    assert.deepEqual(erreurs, [], 'aucune erreur dans la page');
  } finally { await ctx.close(); }
});

test('navigateur, 390 px, au doigt : chacune sur toute la largeur, dans l\'écran, cibles de 44 px ; un appui mène aux réglages', { skip: sansNav }, async () => {
  oublier();
  const { ctx, page, erreurs } = await ouvrirPage(390, { sombre: true });
  try {
    await attendreTuiles(page);
    await page.evaluate((s: string) => document.querySelector(s).scrollIntoView({ block: 'center' }), CARTE('sauvegarde'));
    const a = await vu(page);
    assert.equal(a.deborde, false, 'la page ne déborde pas');
    for (const t of a.tuiles) { assert.equal(t.dedans, true); assert.ok(t.largeur > a.vw * 0.8, `${t.titre} : toute la largeur`); }
    assert.equal(new Set(a.tuiles.map((t: any) => t.haut)).size, 4, 'l\'une sous l\'autre');
    assert.deepEqual(a.tuiles.map((t: any) => t.cibles), KS.map(() => []), 'cibles de 44 px');
    assert.deepEqual(a.tuiles.map((t: any) => t.dedansCarte), KS.map(() => true), 'tout tient dans la carte');
    assert.equal(a.dessous, 0);
    await capture(page, 'tuiles-390-sombre');
    await page.tap(`${CARTE('sauvegarde')} .hcard > .btn`);
    await page.waitForFunction(() => document.querySelector('.view.on')?.id === 'v-settings');
    assert.deepEqual(erreurs, [], 'aucune erreur dans la page');
  } finally { await ctx.close(); }
});

test('navigateur, tablette (768 et 1024 px) : deux par rangée, le titre entier et « ⋯ » à côté ; l\'icône en trait de la tuile d\'avant', { skip: sansNav }, async () => {
  oublier();
  for (const largeur of [768, 1024, 1280]) {
    const { ctx, page, erreurs } = await ouvrirPage(largeur, { sombre: largeur === 768 });
    try {
      await attendreTuiles(page);
      await page.evaluate((s: string) => document.querySelector(s).scrollIntoView({ block: 'center' }), CARTE('sauvegarde'));
      const m = await page.evaluate((ks: string[]) => {
        const r = (n: any) => n.getBoundingClientRect(), grille = r(document.querySelector('#feGrid'));
        return { grille: Math.round(grille.width), tuiles: ks.map((k) => {
          const c = document.querySelector(`#feGrid > .fe-w[data-auj="${k}"]`), n = c.querySelector('.wr-n'), plus = c.querySelector('.wr-plus'), ic = c.querySelector('.fe-h > .fe-ic');
          return { largeur: Math.round(r(c).width), haut: Math.round(r(c).top), coupe: n.scrollWidth > n.clientWidth + 1, plusACote: Math.abs((r(plus).top + r(plus).height / 2) - (r(n).top + r(n).height / 2)) < 20,
            trait: Boolean(ic?.querySelector('svg path')) && !/\p{Extended_Pictographic}/u.test(ic?.textContent ?? '') };
        }) };
      }, [...KS]);
      const tablette = largeur < 1100;
      for (const [i, t] of m.tuiles.entries()) {
        assert.equal(t.coupe, false, `${largeur} px, ${TITRES[i]} : le titre entier`);
        assert.equal(t.plusACote, true, `${largeur} px, ${TITRES[i]} : « ⋯ » à côté du titre`);
        assert.equal(t.trait, true, `${largeur} px, ${TITRES[i]} : l'icône en trait, comme la tuile d'avant`);
        if (tablette) assert.ok(t.largeur >= m.grille * 0.45, `${largeur} px, ${TITRES[i]} : la moitié de la largeur au moins (${t.largeur} sur ${m.grille})`);
      }
      assert.equal(new Set(m.tuiles.map((t: any) => t.haut)).size, tablette ? 2 : 1, tablette ? 'deux rangées de deux' : 'une rangée à l\'ordinateur, comme avant');
      await capture(page, `tuiles-${largeur}`);
      assert.deepEqual(erreurs, [], 'aucune erreur dans la page');
    } finally { await ctx.close(); }
  }
});

test('navigateur : une tuile se retire, ne revient pas dans « État détaillé », et se repose depuis le tiroir ; « Copier » est refusé', { skip: sansNav }, async () => {
  oublier();
  const { ctx, page, erreurs } = await ouvrirPage(1280, { sombre: true });
  try {
    await attendreTuiles(page);
    await page.evaluate(() => window.OdinFenetre.edit(true)); await page.waitForSelector('#fenetre.fe-edit'); await attendreTuiles(page);
    const offerts = () => page.evaluate(() => [...document.querySelectorAll('#feTiroir .fe-it b')].map((b: any) => b.textContent));
    assert.ok(!(await offerts()).some((t: string) => TITRES.includes(t)), 'le tiroir ne propose pas ce que la fenêtre porte déjà');
    assert.equal(await page.evaluate(() => [...document.querySelectorAll('#fenetre .fe-tools .fe-tab')].some((b: any) => /Écran de la maison/.test(b.textContent ?? '') && /« Application »/.test(b.title ?? ''))), true, 'le bouton « Écran de la maison » de la page dit qu\'elles n\'y vont jamais');
    await page.click(`${CARTE('application')} .wr-plus`); await page.waitForSelector('dialog.wr-regler[open]');
    const r = await page.evaluate(() => { const x = document.querySelector('dialog.wr-regler')!; ([...x.querySelectorAll('button')].find((b: any) => b.textContent?.startsWith('Copier'))).click(); return { titre: document.getElementById(x.getAttribute('aria-labelledby')!)?.textContent, retirer: [...x.querySelectorAll('button')].some((b: any) => b.textContent === 'Retirer'), statut: [...x.querySelectorAll('[role=status]')].map((n: any) => n.textContent).join('') }; });
    assert.deepEqual(r, { titre: 'Régler « Application »', retirer: true, statut: 'Ce widget reste sur ton accueil : il ne se copie pas vers l\'autre écran.' });
    assert.equal(await page.evaluate(() => window.OdinFenetre.state().L.pages.flatMap((p: any) => p.widgets).filter((w: any) => w.kind === 'application').length), 1, 'aucune copie');
    await page.keyboard.press('Escape'); await page.waitForFunction(() => !document.querySelector('dialog.wr-regler'));
    await page.click(`${CARTE('sauvegarde')} [aria-label="Retirer ce module"]`);
    await page.waitForFunction((s: string) => !document.querySelector(s), CARTE('sauvegarde'));
    assert.ok((await offerts()).includes('Sauvegarde'), 'le tiroir la propose de nouveau');
    await page.evaluate(() => { ([...document.querySelectorAll('#fenetre .fe-tools .btn')].find((b: any) => b.textContent === 'Terminé')).click(); });
    await page.waitForFunction(() => !document.querySelector('#fenetre.fe-edit'), undefined, { timeout: 15000 });
    const gardee = g().settings.fenetre as Layout;
    assert.deepEqual(sortes(gardee).flat().filter(estTuile), ['surveillance', 'resume_matin', 'application']); assert.equal(gardee.accueil, ACCUEIL_RECU, 'la page a renvoyé la marque');
    await page.waitForTimeout(300);
    assert.equal((await vu(page)).dessous, 0, 'retirée : pas dans « État détaillé » non plus');
    assert.ok(!sortes((await lue()).data).flat().includes('sauvegarde'), 'ni à la lecture suivante');
    // Reposée depuis le tiroir : trois colonnes, remplie, et elle mène toujours à ses réglages.
    await page.evaluate(() => window.OdinFenetre.edit(true));
    await page.waitForSelector('#feTiroir', { state: 'attached' });
    await page.evaluate(() => { (document.querySelector('#feTiroir [aria-label="Ajouter Sauvegarde"]')).click(); });
    await page.waitForSelector(CARTE('sauvegarde'));
    assert.deepEqual(await page.evaluate(() => window.OdinFenetre.state().L.pages[0].widgets.filter((w: any) => w.kind === 'sauvegarde').map((w: any) => w.c)), [3], 'une seule, sur trois colonnes');
    await page.evaluate(() => { ([...document.querySelectorAll('#fenetre .fe-tools .btn')].find((b: any) => b.textContent === 'Terminé')).click(); });
    await page.waitForFunction(() => !document.querySelector('#fenetre.fe-edit'), undefined, { timeout: 15000 });
    assert.deepEqual((g().settings.fenetre as Layout).pages[0].widgets.map((w: any) => [w.kind, w.c, w.r]).at(-1), ['sauvegarde', 3, 2], 'rangée en dernier, à sa taille de départ');
    await attendreTuiles(page);
    await page.click(`${CARTE('sauvegarde')} .hcard > .btn`); await page.waitForFunction(() => document.querySelector('.view.on')?.id === 'v-settings');
    assert.deepEqual(erreurs, [], 'aucune erreur dans la page');
  } finally { await ctx.close(); oublier(); }
});

test('navigateur : un membre garde les quatre tuiles dans « État détaillé », sans widget', { skip: sansNav }, async () => {
  oublier();
  const { ctx, page, erreurs } = await ouvrirPage(1280, { cookie: membre });
  try {
    await page.waitForSelector('#homeGrid .hgrid2 #appCard', { state: 'attached', timeout: 30000 });
    const a = await vu(page);
    assert.deepEqual(a.tuiles, [null, null, null, null], 'pas de widget pour lui'); assert.equal(a.dessous, 4, 'à l\'ancienne place, comme avant');
    assert.equal(a.appCards, 1);
    assert.deepEqual(erreurs, [], 'aucune erreur dans la page');
  } finally { await ctx.close(); }
});
