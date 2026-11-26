// Les appareils de la maison en widgets (maquette validée « Accueil ») : la tuile d'un appareil, la lumière, le capteur,
// les pièces (src/valhalla/widgets/maison-appareils.ts, src/web/pages/widgets-maison-appareils.js), lus sur les appareils
// que l'écran de la maison reçoit déjà, commandés par la route qui existe (POST /api/maison/appareil).
// - Chaque commande de la carte d'aujourd'hui (le modèle COMMANDES_APPAREIL) est dans le widget et arrive au bon appareil.
// - Une serrure demande l'accord, à chaque fois ; sans accord, rien ne part ; une tablette « maison » ne l'ouvre pas.
// - Aucune valeur inventée : un curseur sans mesure n'a pas de nombre de départ ; une clim sans consigne lue n'a pas de
//   degré ; un appareil hors ligne n'a pas de commande.
// - Le choix (l'appareil, la pièce, le capteur) est gardé et nettoyé ; un identifiant piégé ne casse rien.
// - Qui voit quoi : le propriétaire ; une tablette « maison » (sans ce qui ouvre la maison) ; jamais un membre, ni une
//   clé d'accès, ni une requête sans session : rien de plus qu'aujourd'hui.
// - Le navigateur : 390, 768 et 1280 px, clair et sombre : tout tient, cibles de 44 px, clavier, rien ne part en « Modifier ».

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { after, before, test } from 'node:test';
import vm from 'node:vm';
import { COMMANDES_APPAREIL, TAILLE_SORTE, cleanLayout, type Widget } from '../src/valhalla/modules/gladsheim.ts';
import * as A from '../src/valhalla/modules/appareils.ts';
import { allModules, valhallaOf } from '../src/valhalla/odin.ts';
import { homeDevices } from '../src/valhalla/modules/midgard.ts';
import { lierProprietaire, persona } from '../src/valhalla/sso/etat.ts';
import type { ModCtx } from '../src/valhalla/types.ts';
import { admiseALaMaison, donneeWidget, publicDe, sorteDe, type EtatWidget, type Lecteur, type SourceWidget } from '../src/valhalla/widgets/index.ts';
import { calculAllumes } from '../src/valhalla/widgets/maison.ts';
import { T as Banc } from './banc/lib.ts';
import { vraiOdin, type VraiOdin } from './banc/odin-vrai.ts';

const lire = (f: string) => { try { return readFileSync(new URL(`../${f}`, import.meta.url), 'utf8'); } catch { return ''; } };
const RENDU = lire('src/web/pages/widgets-rendu.js'), PAGE_JS = lire('src/web/pages/widgets-maison-appareils.js'), SERVEUR_TS = lire('src/valhalla/widgets/maison-appareils.ts'), GRILLE = lire('src/web/pages/accueil-grille.js');
const SORTES = ['maison_appareil', 'maison_lumiere', 'maison_capteur', 'maison_pieces'] as const;
const W = (kind: string, o: Record<string, unknown> = {}): Widget => ({ id: 'd3800000', kind, w: 1, c: 3, r: 2, ...o }) as unknown as Widget;
const LUI: Lecteur = { qui: 'proprietaire', ecran: 'accueil' }, TABLETTE: Lecteur = { qui: 'maison', ecran: 'maison' };
const membre = (droits: string[]): Lecteur => ({ qui: 'membre', ecran: 'accueil', peutLire: (a) => droits.includes(a), ouverts: new Set() });
const MAINT = 1_800_000_000_000, MIN = 60_000, H = 3_600_000;
type Etat = EtatWidget & { raison?: string; donnee?: Record<string, any>; at?: number };
const etat = async (w: Widget, l: Lecteur, src: SourceWidget) => (await donneeWidget(w, l, src)) as Etat;

type Ap = { id?: string; nom?: string; commandable?: boolean; ids: string; piece: string; sorte: string; etat: string; unite: string; marche: string; arret: string; enLigne?: boolean; vuA?: number };
const ap = (id: string, sorte: string, etat: string, o: Partial<Ap> = {}): Ap => ({ id, nom: `Appareil ${id}`, commandable: sorte !== 'capteur' && sorte !== 'détecteur', ids: id, piece: 'Pièce A', sorte, etat, unite: '', marche: '', arret: '', vuA: MAINT - 2 * MIN, ...o });
function fausse(appareils: Ap[] | undefined, espions?: string[]): SourceWidget {
  return {
    appli: (id) => (id === 'midgard' ? { id, name: 'Appli maison', family: 'Maison' } : undefined),
    vue: async () => null, action: () => undefined, meteo: async () => undefined,
    lieu: () => ({ choisi: true, nom: 'Lieu A', fuseau: 'UTC', heure12: false }), maintenant: () => MAINT,
    appareilsMaison: async () => { espions?.push('appareils'); return appareils ? { unites: 'metrique', appareils } : undefined; },
  } as SourceWidget;
}
const SORTES_APPAREIL = Object.keys(COMMANDES_APPAREIL);
const JEU = (): Ap[] => [
  ...SORTES_APPAREIL.map((k, i) => ap(`a${i}`, k, k === 'serrure' ? 'locked' : 'on', { piece: i % 2 ? 'Pièce B' : 'Pièce A' })),
  ap('hors', 'lumière', 'on', { enLigne: false }), ap('muet', 'prise', 'on', { vuA: MAINT - 25 * H }),
  ap('clim21', 'clim', '21'), ap('t1', 'capteur', '21.5', { unite: '°C', piece: 'Salon', ids: 't1_temperature' }), ap('h1', 'capteur', '40', { unite: '%', piece: 'Salon', ids: 'h1_humidity' }),
  ap('t2', 'capteur', '-18', { unite: '°C', piece: 'Congélateur', ids: 't2_temperature' }), ap('h2', 'capteur', '80', { unite: '%', piece: 'Dehors', ids: 'h2_humidity' }),
  ap('d1', 'détecteur', 'off'),
];

// ------------------------------------------------------------------ le serveur, avec une fausse source

test('les quatre sortes : famille « maison », Midgard lue, public « maison », leurs tailles, posables, admises à l\'écran de la maison', () => {
  const tailles: Record<string, [number[], number, string[]]> = { maison_appareil: [[3, 2], 2, ['simple']], maison_lumiere: [[3, 2], 2, ['simple']], maison_capteur: [[3, 2], 2, ['simple']], maison_pieces: [[3, 3], 4, ['liste']] };
  for (const k of SORTES) {
    const s = sorteDe(k);
    assert.ok(s, k); assert.equal(s!.famille, 'maison', k); assert.deepEqual(s!.applis, ['midgard'], k); assert.equal(publicDe(s!), 'maison', k); assert.equal(s!.posable, true, k);
    assert.deepEqual([[...s!.taille.mini], s!.taille.r, [...s!.styles]], tailles[k], k);
    assert.deepEqual(TAILLE_SORTE[k as keyof typeof TAILLE_SORTE], { mini: tailles[k][0], r: tailles[k][1] }, k);
    assert.equal(admiseALaMaison(k), true, k); assert.notEqual(s!.jamaisALaMaison, true, k);
  }
});

test('chaque commande de la carte d\'aujourd\'hui est dans le widget, pour chaque sorte d\'appareil (le modèle COMMANDES_APPAREIL)', async () => {
  const src = fausse(JEU());
  for (const [i, k] of SORTES_APPAREIL.entries()) {
    const e = await etat(W('maison_appareil', { cible: `appareil:a${i}` }), LUI, src);
    assert.equal(e.etat, 'ok', `${k} : ${JSON.stringify(e)}`);
    assert.deepEqual(e.donnee!.commandes.map((c: any) => [c.code, c.ordres, c.nombre ?? null, c.geste ?? null]), COMMANDES_APPAREIL[k].map((c) => [c.code, [...c.ordres], c.nombre ?? null, c.geste ?? null]), k);
    assert.deepEqual([e.donnee!.id, e.donnee!.nom, e.donnee!.piece, e.donnee!.sorte], [`a${i}`, `Appareil a${i}`, i % 2 ? 'Pièce B' : 'Pièce A', k], k);
  }
  // La lumière, par sa propre sorte : interrupteur et intensité ; AUCUN nombre de départ (Odin ne lit pas l'intensité).
  const l = await etat(W('maison_lumiere', { cible: `appareil:a${SORTES_APPAREIL.indexOf('lumière')}` }), LUI, src);
  assert.deepEqual(l.donnee!.commandes.map((c: any) => c.code), ['interrupteur', 'intensite']); assert.equal(l.donnee!.allume, true);
  for (const k of ['niveau', 'intensite', 'valeur', 'consigne']) assert.ok(!(k in l.donnee!), `aucune valeur inventée : ${k}`);
  // Une clim : sa consigne seulement si son état est un nombre lu.
  const clim = SORTES_APPAREIL.indexOf('clim');
  assert.ok(!('consigne' in (await etat(W('maison_appareil', { cible: `appareil:a${clim}` }), LUI, src)).donnee!), 'clim « on » : aucun degré');
  assert.equal((await etat(W('maison_appareil', { cible: 'appareil:clim21' }), LUI, src)).donnee!.consigne, 21);
});

test('une serrure : « ouvrir » demande l\'accord (pour lui) ; à une tablette « maison », « ouvrir » n\'est pas servi, « verrouiller » oui', async () => {
  const src = fausse(JEU()), w = W('maison_appareil', { cible: `appareil:a${SORTES_APPAREIL.indexOf('serrure')}` });
  const lui = await etat(w, LUI, src), tab = await etat(w, TABLETTE, src);
  assert.deepEqual(lui.donnee!.commandes.map((c: any) => [c.code, c.accord ?? false]), [['ouvrir', true], ['verrouiller', false]]);
  assert.deepEqual(tab.donnee!.commandes.map((c: any) => c.code), ['verrouiller']);
});

test('hors ligne : dit, aucune commande, aucun état ; sans nouvelles depuis 24 h : dit, état non affirmé', async () => {
  const src = fausse(JEU());
  const h = await etat(W('maison_lumiere', { cible: 'appareil:hors' }), LUI, src);
  assert.equal(h.donnee!.horsLigne, true); assert.deepEqual(h.donnee!.commandes, []); assert.ok(!('allume' in h.donnee!) && !('etat' in h.donnee!));
  const m = await etat(W('maison_appareil', { cible: 'appareil:muet' }), LUI, src);
  assert.equal(m.donnee!.muet, true); assert.ok(!('allume' in m.donnee!) && !('etat' in m.donnee!)); assert.equal(m.at, MAINT - 25 * H, 'l\'âge vrai');
});

test('le choix : pas choisi, disparu, d\'une autre sorte → « vide » ; gardé et nettoyé par la fenêtre ; un identifiant piégé ne casse rien', async () => {
  // Lus par une tablette « maison » : l'état seul. Le propriétaire reçoit en plus la liste des choix de « Régler »
  // (essai « Régler, la liste des choix » ci-dessus) ; les états attendus sont les mêmes.
  const src = fausse(JEU()), LUI = TABLETTE;
  assert.deepEqual(await etat(W('maison_appareil'), LUI, src), { etat: 'vide', raison: 'appareil_non_choisi' });
  assert.deepEqual(await etat(W('maison_appareil', { cible: 'appareil:inconnu' }), LUI, src), { etat: 'vide', raison: 'appareil_absent' });
  // Un appareil relié, mais d'une autre sorte : dit tel quel (jamais « n'est plus relié », ce serait faux).
  assert.deepEqual(await etat(W('maison_lumiere', { cible: 'appareil:t1' }), LUI, src), { etat: 'vide', raison: 'appareil_autre_sorte' }, 'un capteur n\'est pas une lumière');
  assert.deepEqual(await etat(W('maison_capteur', { cible: `appareil:a${SORTES_APPAREIL.indexOf('lumière')}` }), LUI, src), { etat: 'vide', raison: 'appareil_autre_sorte' }, 'une lumière n\'est pas un capteur');
  assert.deepEqual(await etat(W('maison_capteur', { cible: 'piece:Salon' }), LUI, src), { etat: 'vide', raison: 'appareil_non_choisi' }, 'un capteur se choisit par son identifiant');
  const c = (await etat(W('maison_capteur', { cible: 'appareil:t1' }), LUI, src)).donnee!;
  assert.deepEqual([c.valeur, c.unite, c.piece, c.commandes], [21.5, '°C', 'Salon', []]);
  // La fenêtre garde le choix, nettoyé ; le reste est jeté.
  const PIEGE = 'appareil:<img src=x onerror=alert(1)>';
  const garde = (kind: string, cible: unknown) => cleanLayout({ pages: [{ id: 'aaaaaaaa', name: 'P', widgets: [{ id: 'bbbbbbbb', kind, cible }] }] }, ['midgard']).pages[0].widgets[0]?.cible;
  assert.equal(garde('maison_appareil', 'appareil:essai_l1'), 'appareil:essai_l1');
  assert.equal(garde('maison_appareil', PIEGE), PIEGE, 'gardé tel quel : ce n\'est qu\'une donnée, comparée, jamais exécutée');
  assert.equal(garde('maison_appareil', 'appareil:a\u0000b\u001fc'), 'appareil:a b c', 'aucun caractère de contrôle');
  for (const mauvais of ['piece:Salon', 'appareil:', 'appareil:   ', 'autre:x', `appareil:${'x'.repeat(300)}`, 42, { a: 1 }, ['appareil:x']]) assert.equal(garde('maison_appareil', mauvais), undefined, JSON.stringify(mauvais));
  assert.equal(garde('maison_temperature', 'piece:Salon'), 'piece:Salon'); assert.equal(garde('maison_humidite', 'appareil:h1'), 'appareil:h1');
  assert.equal(garde('maison_pieces', 'appareil:x'), undefined, 'les pièces n\'ont pas de choix'); assert.equal(garde('maison_watts', 'piece:Salon'), undefined, 'les watts n\'ont pas de choix');
  assert.equal((await etat(W('maison_appareil', { cible: PIEGE }), LUI, src)).raison, 'appareil_absent');
});

test('un nom vide n\'est jamais remplacé par l\'identifiant brut ; « allumé » se lit comme les petits chiffres ; un garage ou un portail demande l\'accord', async () => {
  // Un nom vide : la donnée garde un nom vide (la page écrit la sorte), et la pièce le compte sans le nommer.
  const src = fausse([ap('ha:light.x_9f3', 'lumière', 'on', { nom: '' }), ap('l2', 'lumière', 'on')]);
  assert.equal((await etat(W('maison_lumiere', { cible: 'appareil:ha:light.x_9f3' }), LUI, src)).donnee!.nom, '');
  const pa = ((await etat(W('maison_pieces'), LUI, src)).donnee!.pieces as any[])[0];
  assert.deepEqual([pa.allumes, pa.enPlus], [['Appareil l2'], 1]);
  assert.ok(!JSON.stringify(pa.allumes).includes('ha:light'), 'aucun identifiant brut à la place d\'un nom');
  // « Allumé » : la même règle que les petits chiffres de la maison (maison.ts), pour chaque état.
  for (const e of ['on', 'off', 'true', 'playing', 'paused', 'heat', 'cool', 'cleaning', 'docked', 'open', 'closed', 'locked', 'unlocked', 'idle', 'standby', 'bizarre', '']) {
    const a = ap('p9', 'prise', e), compte = (calculAllumes(() => true)([a], MAINT) as { donnee?: { n?: number } }).donnee?.n;
    const tuile = (await etat(W('maison_appareil', { cible: 'appareil:p9' }), LUI, fausse([a]))).donnee!.allume;
    assert.equal(tuile === true, compte === 1, `« ${e} » : la tuile (${tuile}) et le petit chiffre (${compte}) disent la même chose`);
  }
  // Un volet de garage ou un portail (la règle de Midgard) : « monter » demande l'accord ; à une tablette, il n'est pas servi.
  for (const id of ['ha:cover.porte_garage', 'ha:cover.portail_entree']) {
    const s2 = fausse([ap(id, 'volet', 'closed')]), w = W('maison_appareil', { cible: `appareil:${id}` });
    assert.deepEqual((await etat(w, LUI, s2)).donnee!.commandes.map((c: any) => [c.code, c.accord ?? false]), [['monter', true], ['arreter', false], ['descendre', false]], id);
    assert.deepEqual((await etat(w, TABLETTE, s2)).donnee!.commandes.map((c: any) => c.code), ['arreter', 'descendre'], `${id} : la tablette ne l'ouvre pas`);
  }
});

test('« Température » et « Humidité » : une pièce ou un capteur choisi (sans choix : la moyenne, comme avant)', async () => {
  const src = fausse(JEU()), d = async (kind: string, cible?: string) => (await etat(W(kind, cible ? { cible } : {}), LUI, src)).donnee!;
  // Sans choix : la moyenne de tous, congélateur et dehors compris (ce que le lot d'avant disait déjà).
  assert.deepEqual(await d('maison_temperature'), { valeur: 1.8, unite: 'C', n: 2, ecartes: 0 });
  assert.deepEqual(await d('maison_temperature', 'piece:Salon'), { valeur: 21.5, unite: 'C', n: 1, ecartes: 0, piece: 'Salon' });
  assert.deepEqual(await d('maison_temperature', 'appareil:t2'), { valeur: -18, unite: 'C', n: 1, ecartes: 0, piece: 'Congélateur' });
  assert.deepEqual(await d('maison_humidite', 'piece:Salon'), { valeur: 40, n: 1, ecartes: 0, piece: 'Salon' });
  // Lu par une tablette : l'état seul (le propriétaire reçoit en plus la liste des choix de « Régler »). Une pièce qui
  // n'a plus aucun appareil est dite telle quelle (« piece_absente ») : avant, « aucun capteur dans la maison », faux
  // puisque d'autres capteurs existent (relecture du complément, constat 4).
  assert.deepEqual(await etat(W('maison_humidite', { cible: 'piece:Nulle part' }), TABLETTE, src), { etat: 'vide', raison: 'piece_absente' });
  assert.deepEqual((await etat(W('maison_humidite', { cible: 'piece:Nulle part' }), LUI, src) as AvecChoix).raison, 'piece_absente');
  // Un capteur choisi puis retiré d'Odin : « cet appareil n'existe plus », jamais « aucun capteur » ; la liste reste servie
  // au propriétaire (il peut en choisir un autre), jamais à la tablette.
  const parti = await etat(W('maison_temperature', { cible: 'appareil:t_retire' }), LUI, src) as AvecChoix;
  assert.deepEqual([parti.etat, parti.raison, Array.isArray(parti.choix) && parti.choix.length > 0], ['vide', 'appareil_absent', true]);
  assert.deepEqual(await etat(W('maison_temperature', { cible: 'appareil:t_retire' }), TABLETTE, src), { etat: 'vide', raison: 'appareil_absent' });
  // Une pièce qui existe mais sans capteur de cette mesure (Pièce A) : rien à y mesurer, comme avant.
  assert.deepEqual(await etat(W('maison_temperature', { cible: 'piece:Pièce A' }), TABLETTE, src), { etat: 'vide', raison: 'aucun_appareil' });
  // Un appareil qui existe mais n'est pas un capteur de cette mesure (la lampe a0) : rien à y mesurer, jamais « n'existe plus ».
  assert.deepEqual(await etat(W('maison_temperature', { cible: 'appareil:a0' }), TABLETTE, src), { etat: 'vide', raison: 'aucun_appareil' });
});

test('les pièces : chacune, ses appareils, ce qui y est allumé, ses lumières ; aucun appareil : « vide »', async () => {
  const e = await etat(W('maison_pieces'), LUI, fausse(JEU()));
  const p = e.donnee!.pieces as Array<Record<string, any>>;
  assert.deepEqual(p.map((x) => x.nom), ['Pièce A', 'Pièce B', 'Salon', 'Congélateur', 'Dehors']);
  const a = p[0], lum = SORTES_APPAREIL.indexOf('lumière');
  assert.ok(a.lumieres.some((x: any) => x.id === `a${lum}` && x.allume === true) || p[1].lumieres.some((x: any) => x.id === `a${lum}` && x.allume === true));
  assert.ok(a.lumieres.some((x: any) => x.id === 'hors' && x.horsLigne === true && !('allume' in x)), 'une lumière hors ligne : son état n\'est pas affirmé');
  assert.ok(!p.flatMap((x) => x.allumes).includes('Appareil muet'), 'muet : pas dit allumé');
  assert.deepEqual(await etat(W('maison_pieces'), LUI, fausse([])), { etat: 'vide', raison: 'aucun_appareil' });
});

test('qui voit quoi : lui et une tablette oui ; un membre jamais (même avec le droit), sans une lecture ; Midgard muette : rien', async () => {
  for (const k of SORTES) {
    const espions: string[] = [], w = W(k, k === 'maison_pieces' ? {} : { cible: k === 'maison_capteur' ? 'appareil:t1' : `appareil:a${SORTES_APPAREIL.indexOf('lumière')}` }), src = fausse(JEU(), espions);
    for (const l of [LUI, TABLETTE]) assert.equal((await etat(w, l, src)).etat, 'ok', `${k} : ${l.qui}`);
    espions.length = 0;
    assert.deepEqual(await etat(w, membre(['midgard', 'gladsheim']), src), { etat: 'refuse', raison: 'proprietaire_seul' }, k);
    assert.deepEqual(await etat(w, membre(['gladsheim']), src), { etat: 'refuse', raison: 'appli_fermee', appli: 'midgard' }, k);
    assert.deepEqual(espions, [], `${k} : rien n'est lu pour un membre`);
    assert.deepEqual(await etat(w, LUI, fausse(undefined)), { etat: 'source_absente', raison: 'appli_muette' }, k);
  }
});

// « Régler » : le choix de l'appareil montré. La liste vient du serveur, avec l'état du widget, au propriétaire seul et
// sur l'accueil seul (une clé « complet » sur l'écran de la maison n'est pas « Régler »).
type AvecChoix = Etat & { choix?: Array<Record<string, unknown>> };
const LUI_MAISON: Lecteur = { qui: 'proprietaire', ecran: 'maison' };
test('« Régler », la liste des choix : au propriétaire sur l\'accueil seul ; du bon genre, par nom et pièce, hors ligne compris ; aucun du genre : « vide » qui le dit', async () => {
  const src = fausse(JEU()), jeu = JEU(), lumieres = jeu.filter((a) => a.sorte === 'lumière').map((a) => `appareil:${a.id}`);
  const l = (await etat(W('maison_lumiere'), LUI, src)) as AvecChoix;
  assert.deepEqual([l.etat, l.raison], ['vide', 'appareil_non_choisi']);
  assert.deepEqual(l.choix!.map((c) => c.cible), lumieres, 'les lumières seulement, dans l\'ordre de l\'écran de la maison');
  for (const c of l.choix!) assert.deepEqual(Object.keys(c).filter((k) => !['cible', 'nom', 'piece', 'sorte', 'horsLigne'].includes(k)), [], 'rien d\'autre que le nom, la pièce, la sorte, hors ligne');
  assert.deepEqual(l.choix!.find((c) => c.cible === 'appareil:hors'), { cible: 'appareil:hors', nom: 'Appareil hors', piece: 'Pièce A', sorte: 'lumière', horsLigne: true }, 'hors ligne : dans la liste, et dit');
  const cap = (await etat(W('maison_capteur'), LUI, src)) as AvecChoix;
  assert.deepEqual(cap.choix!.map((c) => c.sorte).sort(), jeu.filter((a) => a.sorte === 'capteur' || a.sorte === 'détecteur').map((a) => a.sorte).sort());
  assert.equal(((await etat(W('maison_appareil'), LUI, src)) as AvecChoix).choix!.length, jeu.length, 'la tuile : tout appareil');
  // Déjà choisi : la liste reste (pour changer), avec l'état.
  const ok = (await etat(W('maison_lumiere', { cible: 'appareil:hors' }), LUI, src)) as AvecChoix;
  assert.equal(ok.etat, 'ok'); assert.deepEqual(ok.choix!.map((c) => c.cible), lumieres);
  // Un appareil retiré d'Odin : le widget le dit ; la liste ne l'invente pas.
  const parti = (await etat(W('maison_lumiere', { cible: 'appareil:retire_depuis' }), LUI, src)) as AvecChoix;
  assert.deepEqual([parti.etat, parti.raison], ['vide', 'appareil_absent']); assert.ok(!parti.choix!.some((c) => c.cible === 'appareil:retire_depuis'));
  // Un nom vide reste vide (la page écrit la sorte) : jamais l'identifiant brut à sa place.
  const sansNom = (await etat(W('maison_lumiere'), LUI, fausse([ap('ha:light.x_9f3', 'lumière', 'on', { nom: '' })]))) as AvecChoix;
  assert.deepEqual(sansNom.choix, [{ cible: 'appareil:ha:light.x_9f3', nom: '', piece: 'Pièce A', sorte: 'lumière' }]);
  // À personne d'autre : ni une tablette, ni une clé « complet » sur l'écran de la maison, ni un membre.
  for (const k of ['maison_appareil', 'maison_lumiere', 'maison_capteur', 'maison_temperature', 'maison_humidite']) {
    for (const [qui, lec] of [['tablette', TABLETTE], ['écran de la maison', LUI_MAISON], ['membre', membre(['midgard', 'gladsheim'])]] as const) {
      const e = (await etat(W(k), lec, src)) as AvecChoix;
      assert.ok(!('choix' in e), `${k}, ${qui} : aucune liste`); assert.ok(!/appareil:|Pièce A|Salon/.test(JSON.stringify(e)) || e.etat === 'ok', `${k}, ${qui} : ni identifiant ni pièce`);
    }
  }
  // Aucun appareil du genre dans la maison : « vide » le dit (jamais « choisis »), pour tous ; la liste vide, pour lui seul.
  const rien = fausse([ap('t9', 'capteur', '20', { unite: '°C' })]);
  assert.deepEqual(await etat(W('maison_lumiere'), TABLETTE, rien), { etat: 'vide', raison: 'aucun_appareil' });
  const r = (await etat(W('maison_lumiere'), LUI, rien)) as AvecChoix;
  assert.deepEqual([r.etat, r.raison, r.choix], ['vide', 'aucun_appareil', []]);
  assert.equal(((await etat(W('maison_capteur'), LUI, rien)) as AvecChoix).raison, 'appareil_non_choisi', 'un capteur existe : à choisir');
});

test('« Régler », la cible à l\'enregistrement : la bonne forme, bornée ; « __proto__ », 10 000 signes ou un genre interdit refusés sans rien casser', async () => {
  const garde = (kind: string, cible: unknown) => cleanLayout({ pages: [{ id: 'aaaaaaaa', name: 'P', widgets: [{ id: 'bbbbbbbb', kind, cible }] }] }, ['midgard']).pages[0].widgets[0];
  for (const piege of ['appareil:__proto__', 'appareil:constructor', 'appareil:prototype', 'piece:__proto__', ` appareil:${'x'.repeat(10_000)}`, `piece:${'x'.repeat(10_000)}`]) {
    for (const k of ['maison_lumiere', 'maison_temperature']) {
      const w = garde(k, piege);
      assert.ok(w, `${k} : le widget reste`); assert.equal(w.cible, undefined, `${k} : ${piege.slice(0, 30)} refusé`);
    }
  }
  assert.equal(garde('maison_lumiere', 'appareil:essai_proto').cible, 'appareil:essai_proto', 'un identifiant ordinaire passe');
  // L'appareil d'un autre (inconnu ici) : à la lecture, « vide » et jamais un autre appareil.
  assert.deepEqual([(await etat(W('maison_lumiere', { cible: 'appareil:__proto__' }), LUI, fausse(JEU()))).raison], ['appareil_non_choisi']);
});

// ------------------------------------------------------------------ la page, sans navigateur

test('la page : la famille se déclare (appareil, lumière, capteur, pièces en liste et en tuiles) ; la grille connaît leurs tailles', () => {
  const win: Record<string, any> = { document: { documentElement: { lang: 'fr' } } };
  for (const src of [PAGE_JS, RENDU, GRILLE]) vm.runInNewContext(src, { window: win, document: win.document, Intl });
  const R = win.OdinWidgetsRendu, G = win.OdinGrille, M = win.OdinWidgetsMaisonAppareils;
  assert.ok(M, 'window.OdinWidgetsMaisonAppareils');
  for (const k of SORTES) {
    const x = R.rendu(k, k === 'maison_pieces' ? 'liste' : undefined) ?? R.rendu(k);
    assert.ok(x, k); assert.deepEqual([x.famille, x.appli, x.petit, x.jamaisALaMaison], ['maison', 'midgard', false, false], k);
    assert.deepEqual([[...G.MINI[k]], G.HAUTEUR[k]], [[...sorteDe(k)!.taille.mini], sorteDe(k)!.taille.r], `${k} : les tables de la grille suivent le serveur`);
  }
  // Le style « Tuiles » est dessiné, mais le serveur ne le garde pas encore : « Régler » n'a pas sa ligne (widgets-rendu.js).
  assert.ok(R.rendu('maison_pieces', 'tuiles'), 'le style « Tuiles »');
  assert.equal(cleanLayout({ pages: [{ id: 'aaaaaaaa', name: 'P', widgets: [{ id: 'bbbbbbbb', kind: 'maison_pieces', style: 'tuiles' }] }] }, ['midgard']).pages[0].widgets[0].style, undefined);
  // Dans le tiroir : les quatre (le style « Tuiles » non). Suit la pose depuis le tiroir : un appareil, une lumière, un
  // capteur y sont, l'unique appareil du genre pris d'office, sinon « Régler » aussitôt ; aucun : rien n'est posé (avant :
  // « Pièces » seulement, tant qu'ils auraient été posés vides). Rangés par la famille de Midgard (la maquette : « Maison »).
  const posees = R.posables({ proprio: true, aDroit: () => true }).filter((x: any) => SORTES.includes(x.sorte));
  assert.deepEqual(JSON.parse(JSON.stringify(posees.map((x: any) => [x.sorte, x.style]))), [['maison_appareil', ''], ['maison_lumiere', ''], ['maison_capteur', ''], ['maison_pieces', '']]);
  for (const x of posees) assert.equal(R.groupeTiroir(x, 'Maison'), 'Maison', `${x.sorte} : le groupe de la famille de Midgard`);
  assert.equal(R.posables({ proprio: true, aDroit: () => false }).some((x: any) => SORTES.includes(x.sorte)), false, 'sans le droit sur Midgard : aucune');
  // Les commandes connues de la page : exactement celles du modèle.
  assert.deepEqual([...M.CODES].sort(), [...new Set(Object.values(COMMANDES_APPAREIL).flat().map((c) => c.code))].sort());
  // Le texte d'une donnée : jamais par innerHTML (seules les icônes dessinées ici) ; ni langue ni fuseau écrits.
  assert.deepEqual([...PAGE_JS.matchAll(/innerHTML\s*=\s*([^;]+);/g)].map((m) => m[1].trim()), ['icone(k)']);
  assert.ok(!new RegExp(`${'fr'}-FR|timeZone`).test(PAGE_JS), 'aucune langue ni aucun fuseau écrits');
  // Aucun caractère invisible écrit tel quel (une espace insécable s'écrit \u00a0).
  for (const [f, t] of [['page', PAGE_JS], ['serveur', SERVEUR_TS]]) assert.ok(!/[\u00a0\u200b-\u200f\u2028\u2029\u202f\ufeff]/.test(t), `${f} : aucun caractère invisible tel quel`);
  // « Pièces » : le sous-titre dit combien de pièces (la maquette : « N pièces »).
  const pi = R.rendu('maison_pieces', 'liste') ?? R.rendu('maison_pieces');
  assert.equal(pi.sous({ etat: 'ok', donnee: { pieces: [{ nom: 'A' }, { nom: 'B' }] } }), '2 pièces'); assert.equal(pi.sous({ etat: 'ok', donnee: { pieces: [{ nom: 'A' }] } }), '1 pièce');
  // Un appareil d'une autre sorte : dit tel quel ; un nom vide : la sorte, jamais l'identifiant.
  assert.ok(M.TEXTES.vides.appareil_autre_sorte && !/plus relié/.test(M.TEXTES.vides.appareil_autre_sorte));
  assert.equal(R.rendu('maison_lumiere').vides.includes('appareil_autre_sorte'), true);
  // Le curseur d'intensité sans mesure : ni pouce ni remplissage (la règle de style), aucune position de départ.
  assert.match(M.CSS, /\.wma-r:not\(\[data-pose\]\)::-webkit-slider-thumb\{[^}]*opacity:0/); assert.match(M.CSS, /\.wma-r:not\(\[data-pose\]\)::-moz-range-thumb\{[^}]*opacity:0/);
  // L'état relu après un ordre ne passe jamais devant une lecture plus récente.
  M.garderFrais('w1', { etat: 'ok', at: 100, donnee: { x: 'relu' } });
  assert.equal(M.fraisDe('w1', { etat: 'ok', at: 50, donnee: { x: 'page' } }).donnee.x, 'relu', 'plus ancien que l\'état relu : l\'état relu');
  assert.equal(M.fraisDe('w1', { etat: 'ok', at: 200, donnee: { x: 'page' } }).donnee.x, 'page', 'plus récent : la lecture de la page');
});

test('la page, le champ du choix de « Régler » : par nom et pièce, jamais un identifiant ; le déjà choisi reste, retiré sous un mot neutre ; sans liste : rien à choisir', () => {
  const win: Record<string, any> = { document: { documentElement: { lang: 'fr' } } };
  for (const src of [PAGE_JS, RENDU]) vm.runInNewContext(src, { window: win, document: win.document, Intl });
  const M = win.OdinWidgetsMaisonAppareils, w = (kind: string, cible?: string) => ({ id: 'w1', kind, ...(cible ? { cible } : {}) });
  const choix = [{ cible: 'appareil:ha:light.k_9f3', nom: 'Lampe', piece: 'Salon', sorte: 'lumière' }, { cible: 'appareil:id_brut_77', nom: '', piece: 'Bureau', sorte: 'lumière', horsLigne: true }];
  const etatLu = { etat: 'vide', raison: 'appareil_non_choisi', choix };
  // Pas de champ pour une sorte sans choix.
  for (const k of ['maison_pieces', 'maison_watts', 'chiffres', 'heure']) assert.equal(M.champChoix(w(k), etatLu), null, k);
  const c = M.champChoix(w('maison_lumiere'), etatLu);
  assert.equal(c.libelle, M.TEXTES.regler.libelles.lumiere);
  const vus = JSON.parse(JSON.stringify(c.options));
  assert.deepEqual(vus.map((o: any) => o.v), ['', 'appareil:ha:light.k_9f3', 'appareil:id_brut_77'], 'd\'abord « choisir », puis la liste');
  assert.ok(vus.every((o: any) => !/ha:light|id_brut/.test(o.texte)), `jamais un identifiant à l'écran : ${JSON.stringify(vus.map((o: any) => o.texte))}`);
  assert.match(vus[1].texte, /Lampe.*Salon/); assert.match(vus[2].texte, new RegExp(`${M.TEXTES.lumiere.titre}.*Bureau.*${M.TEXTES.horsLigne}`, 'i'), 'sans nom : sa sorte, sa pièce ; hors ligne : dit');
  assert.equal(c.titre('appareil:ha:light.k_9f3'), 'Lampe', 'le titre proposé suit le choix'); assert.equal(c.titre(''), '');
  // Un nom long : le titre proposé finit par « … », jamais coupé net au milieu d'un mot (troisième regard, constat 3).
  const long = M.champChoix(w('maison_lumiere'), { ...etatLu, choix: [{ cible: 'appareil:x1', nom: 'Lampe de la cuisine avec un nom vraiment très long', piece: 'Cuisine', sorte: 'lumière' }] });
  const tl = long.titre('appareil:x1'); assert.ok(tl.length <= 40 && tl.endsWith('…'), tl);
  // La carte « vide » d'un appareil retiré : « Choisir » s'il reste des appareils du genre ; aucun : « Ajouter un appareil »
  // (« Choisir » n'offrirait que l'appareil retiré : troisième regard, constat 6). Un faux document, juste ce qu'il faut.
  const faux = (): any => { const n: any = { dataset: {}, enfants: [] as any[], className: '', textContent: '', append(...c: any[]) { n.enfants.push(...c); }, addEventListener() {}, setAttribute() {} }; return n; };
  const doc: any = { documentElement: { lang: 'fr' }, createElement: faux, getElementById: () => ({}), head: { append() {} } };
  const w2: Record<string, any> = { document: doc };
  for (const src of [PAGE_JS, RENDU]) vm.runInNewContext(src, { window: w2, document: doc, Intl });
  const dessiner = w2.OdinWidgetsFamilles.flatMap((f: any) => f.sortes).find((x: any) => x.sorte === 'maison_lumiere').dessiner;
  const boutonDe = (choixLus: unknown[]) => dessiner({ etat: 'vide', raison: 'appareil_absent', choix: choixLus }, { w: { id: 'w9', kind: 'maison_lumiere', cible: 'appareil:parti' } }).enfants.find((x: any) => x.dataset.action)?.dataset.action;
  assert.equal(boutonDe(choix), 'choisir', 'd\'autres lumières : « Choisir »');
  assert.equal(boutonDe([]), 'ajouter', 'plus aucune lumière : « Ajouter un appareil »');
  // Déjà choisi, retiré d'Odin : en tête, sous un mot neutre, choisi.
  const r = M.champChoix(w('maison_lumiere', 'appareil:parti_42'), { etat: 'vide', raison: 'appareil_absent', choix });
  assert.deepEqual([r.depart, r.options[0].v, r.options[0].texte], ['appareil:parti_42', 'appareil:parti_42', M.TEXTES.regler.retire]); assert.equal(r.titre('appareil:parti_42'), '');
  assert.ok(!r.options.some((o: any) => o.v === ''), 'déjà choisi : plus de ligne « choisir »');
  // Sans liste (pas encore rangé, ou pas le propriétaire) : le choix actuel seul, et la phrase qui dit quoi faire.
  const sans = M.champChoix(w('maison_lumiere'), undefined);
  assert.equal(sans.sansListe, true); assert.equal(sans.aide, M.TEXTES.regler.aRanger);
  // Aucun du genre : la phrase le dit.
  assert.equal(M.champChoix(w('maison_capteur'), { etat: 'vide', raison: 'aucun_appareil', choix: [] }).aide, M.TEXTES.regler.aucun.capteur);
  // Une mesure : « tous » (la moyenne) d'abord, puis les pièces et les capteurs, en deux groupes.
  const t = M.champChoix(w('maison_temperature', 'piece:Salon'), { etat: 'ok', at: 1, donnee: {}, choix: [{ cible: 'piece:Salon', nom: 'Salon' }, { cible: 'appareil:zb_t1', nom: 'Sonde', piece: 'Salon', sorte: 'capteur' }] });
  assert.deepEqual(JSON.parse(JSON.stringify(t.options)).map((o: any) => [o.v, o.groupe ?? '']), [['', ''], ['piece:Salon', M.TEXTES.regler.groupes.pieces], ['appareil:zb_t1', M.TEXTES.regler.groupes.capteurs]]);
  assert.equal(t.options[0].texte, M.TEXTES.regler.tous); assert.equal(t.depart, 'piece:Salon');
  assert.match(t.titre('piece:Salon'), /Salon/); assert.equal(t.titre(''), '');
  // Une liste abîmée ou piégée : jetée ligne à ligne, jamais une exception.
  const abime = M.champChoix(w('maison_lumiere'), { etat: 'vide', raison: 'appareil_non_choisi', choix: [null, 3, { cible: 'autre:x', nom: 'X' }, { cible: 'appareil:ok', nom: '<b>Lampe</b>', piece: 'P' }] });
  assert.deepEqual(JSON.parse(JSON.stringify(abime.options.map((o: any) => o.v))), ['', 'appareil:ok']); assert.match(abime.options[1].texte, /<b>Lampe<\/b>/, 'gardé en texte (posé par textContent)');
  // Les textes de l'état « pas encore choisi » et d'un appareil retiré.
  assert.equal(M.TEXTES.vides.appareil_absent, 'Cet appareil n\'existe plus.');
  for (const k of ['appareil', 'lumiere', 'capteur']) assert.ok(M.TEXTES.nonChoisi[k] && M.TEXTES.aucun[k], k);
  for (const k of ['maison_appareil', 'maison_lumiere', 'maison_capteur']) assert.ok(win.OdinWidgetsRendu.rendu(k).vides.includes('aucun_appareil'), `${k} dessine « aucun appareil » lui-même`);
});

test('la pose depuis le tiroir : les appareils du genre, tirés des pièces de l\'écran de la maison, sous la forme des choix du serveur ; jamais un identifiant piégé ; « Choisir une lumière »', () => {
  const win: Record<string, any> = { document: { documentElement: { lang: 'fr' } } };
  for (const src of [PAGE_JS, RENDU]) vm.runInNewContext(src, { window: win, document: win.document, Intl });
  const M = win.OdinWidgetsMaisonAppareils;
  assert.equal(typeof M.choixDePose, 'function'); assert.equal(typeof M.genrePose, 'function');
  assert.deepEqual(['maison_appareil', 'maison_lumiere', 'maison_capteur', 'maison_temperature', 'maison_pieces', 'heure', undefined].map((k) => M.genrePose(k)), ['appareil', 'lumiere', 'capteur', '', '', '', ''], 'seules les trois sortes qui montrent UN appareil');
  const rooms = [{ name: 'Salon', devices: [{ id: 'a', name: 'Lampe', kind: 'lumière' }, { id: '__proto__', kind: 'lumière' }, { id: ' ', kind: 'lumière' }, { id: 'x'.repeat(192), kind: 'lumière' }, { id: 'x'.repeat(191), kind: 'lumière' }, { id: 's', name: '', kind: 'détecteur' }, { id: 'p', name: 'Prise', kind: 'prise' }, { id: 7, kind: 'lumière' }] },
    { name: PIEGE, devices: [{ id: 'b', name: 'Lampe 2', kind: 'lumière' }, { id: 't', name: 'Sonde', kind: 'capteur' }] }, null, { name: 'X', devices: 'non' }];
  const cibles = (k: string) => JSON.parse(JSON.stringify(M.choixDePose(k, rooms))).map((c: any) => c.cible);
  assert.deepEqual(cibles('maison_lumiere'), ['appareil:a', `appareil:${'x'.repeat(191)}`, 'appareil:b'], 'un identifiant vide, réservé ou de plus de 200 signes avec « appareil: » n\'est pas un choix (comme cibleNette)');
  assert.deepEqual(cibles('maison_capteur'), ['appareil:s', 'appareil:t']);
  assert.deepEqual(cibles('maison_appareil'), ['appareil:a', `appareil:${'x'.repeat(191)}`, 'appareil:s', 'appareil:p', 'appareil:b', 'appareil:t']);
  assert.deepEqual(JSON.parse(JSON.stringify(M.choixDePose('maison_lumiere', rooms)[2])), { cible: 'appareil:b', nom: 'Lampe 2', piece: PIEGE, sorte: 'lumière' });
  for (const [k, r] of [['maison_temperature', rooms], ['maison_pieces', rooms], ['maison_lumiere', undefined], ['maison_lumiere', { rooms }]] as const) assert.equal(M.choixDePose(k, r), null, `${k} : rien à choisir à la pose`);
  assert.deepEqual(JSON.parse(JSON.stringify(M.choixDePose('maison_lumiere', []))), [], 'aucune pièce : aucun choix');
  // Ses textes sont les choix que « Régler » sait écrire (le même champ).
  const c = M.champChoix({ id: 'w', kind: 'maison_lumiere' }, { etat: 'vide', raison: 'appareil_non_choisi', choix: M.choixDePose('maison_lumiere', rooms) });
  assert.equal(c.sansListe, false); assert.deepEqual(JSON.parse(JSON.stringify(c.options.map((o: any) => o.v))), ['', ...cibles('maison_lumiere')]);
  // Pas encore choisi : le bouton dit ce qu'il fait choisir (la pose annulée : la carte dit quoi faire).
  const faux = (): any => { const n: any = { dataset: {}, enfants: [] as any[], className: '', textContent: '', append(...k: any[]) { n.enfants.push(...k); }, addEventListener() {}, setAttribute() {} }; return n; };
  const doc: any = { documentElement: { lang: 'fr' }, createElement: faux, getElementById: () => ({}), head: { append() {} } };
  const w2: Record<string, any> = { document: doc };
  for (const src of [PAGE_JS, RENDU]) vm.runInNewContext(src, { window: w2, document: doc, Intl });
  const decl = (k: string) => w2.OdinWidgetsFamilles.flatMap((f: any) => f.sortes).find((x: any) => x.sorte === k && !x.style);
  for (const [k, t] of [['maison_lumiere', 'Choisir une lumière'], ['maison_appareil', 'Choisir un appareil'], ['maison_capteur', 'Choisir un capteur']]) {
    const b = decl(k).dessiner({ etat: 'vide', raison: 'appareil_non_choisi', choix: [{ cible: 'appareil:a', nom: 'A', piece: 'P', sorte: 'lumière' }] }, { w: { id: 'w8', kind: k } }).enfants.find((x: any) => x.dataset.action === 'choisir');
    assert.ok(b, k); assert.equal(b.textContent, t, k);
  }
});

// ------------------------------------------------------------------ un vrai Odin d'essai, de faux appareils sur le relais

const tt = new Banc(), orig = { log: console.log, error: console.error, warn: console.warn, info: console.info };
let v: VraiOdin, avecDroit = '', cleMaison = '';
const MDP = 'une-pirogue-sur-le-lagon-calme-48';
const PAGE = 'b3800001';
/** Les ordres reçus par le relais : [objet, valeur]. */
const recus: Array<[string, string]> = [];
const OBJ = { lumiere: 'l1', eteinte: 'l2', horsLigne: 'l3', prise: 'p1', ventilo: 'f1', volet: 'v1', clim: 'c1', aspirateur: 'a1', serrure: 'k1', capteur: 't1' } as const;
const ID: Record<string, string> = { lumiere: 'd3800001', eteinte: 'd3800002', horsLigne: 'd3800003', prise: 'd3800004', ventilo: 'd3800005', volet: 'd3800006', clim: 'd3800007', aspirateur: 'd3800008', serrure: 'd3800009', capteur: 'd380000a', pieces: 'd380000b', lecteur: 'd380000d', climLue: 'd380000e' };
const KIND: Record<string, string> = { lumiere: 'maison_lumiere', eteinte: 'maison_lumiere', horsLigne: 'maison_lumiere', capteur: 'maison_capteur', pieces: 'maison_pieces' };
const PIEGE = '<img src=x onerror="window.__pirate=1">';
const FENETRE = () => ({ pages: [{ id: PAGE, name: 'Maison', widgets: Object.entries(ID).map(([k, id]) => ({ id, kind: KIND[k] ?? 'maison_appareil', w: 1, c: 3, r: k === 'pieces' ? 4 : 2,
  ...(k in OBJ ? { cible: `appareil:essai_${OBJ[k as keyof typeof OBJ]}` } : k === 'lecteur' || k === 'climLue' ? { cible: `appareil:essai_${k}` } : {}) })) }] });
const cookieDe = (r: Response, nom: string) => r.headers.getSetCookie().find((c) => c.startsWith(`${nom}=`))?.split(';')[0] ?? '';
async function entrer(ident: string, mdp: string): Promise<string> {
  let r = await fetch(`${v.url}/sso/odin`, { redirect: 'manual' }); assert.equal(r.status, 303);
  r = await fetch(new URL(r.headers.get('location')!, v.url), { redirect: 'manual' }); const demande = /name="demande" value="([^"]+)"/.exec(await r.text())![1];
  r = await fetch(`${v.url}/sso/autoriser`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded', origin: v.url }, body: new URLSearchParams({ demande, identifiant: ident, motdepasse: mdp }) });
  r = await fetch(r.headers.get('location')!, { redirect: 'manual' }); assert.equal(r.status, 303, 'session ouverte');
  return cookieDe(r, 'odin_session');
}
type Rendue = { id: string; kind: string; etat: string; raison?: string; donnee?: Record<string, any> };
const donnees = async (h: Record<string, string> = {}) => { const r = await v.json(`/api/widgets/donnees?page=${PAGE}`, undefined, h); return { status: r.status, corps: JSON.stringify(r.body), de: (id: string) => ((r.body.widgets as Rendue[] | undefined) ?? []).find((x) => x.id === id) }; };
const commander = (appareil: string, valeur: string, h: Record<string, string> = {}, confirm = false) => v.json('/api/maison/appareil', { appareil, valeur, ...(confirm ? { confirm: true } : {}) }, h);

const horloge = { t: Date.now() }, reglages: Record<string, unknown> = { port: 0 };
const ctxRelais = { home: '', dir: '', settings: reglages, saveSettings: (p: Record<string, unknown>) => Object.assign(reglages, p), alert: () => {}, emit: () => {}, now: () => new Date(horloge.t) } as unknown as ModCtx;
const annonce = (type: string, obj: string, c: Record<string, unknown> = {}) => A.brokerOf()!.publish(`decouverte/${type}/essai/${obj}/config`, JSON.stringify({ unique_id: `essai_${obj}`, name: `Appareil ${obj}`, state_topic: `essai/${obj}/etat`, command_topic: `essai/${obj}/cmd`, device: { suggested_area: 'Salon' }, ...c }));
const etatDe = (obj: string, x: string) => A.brokerOf()!.publish(`essai/${obj}/etat`, x);
/** Attend que Midgard connaisse ces appareils (le relais les annonce sans attendre). */
const connus = async (ids: string[]) => { for (let i = 0; i < 200; i++) { const l = (await homeDevices(valhallaOf()!.ctx('midgard')).catch(() => [])).map((x) => x.id); if (ids.every((id) => l.includes(id))) return; await new Promise((ok) => setTimeout(ok, 50)); } throw new Error(`appareils inconnus de Midgard : ${ids.join(', ')}`); };

before(async () => {
  for (const k of ['log', 'error', 'warn', 'info'] as const) console[k] = () => {};
  v = await vraiOdin(tt, { compte: true, modules: (o) => allModules(o).filter((m) => ['gladsheim', 'midgard', 'var', 'apparence'].includes(m.id)) });
  const va = valhallaOf()!;
  assert.equal((await va.act('var', 'ajouter', { login: 'membre-m', nom: 'Membre M', groupes: 'invite', mot_de_passe: MDP })).ok, true);
  for (const appli of ['odin', 'gladsheim', 'midgard']) assert.equal((await va.act('var', 'donner_acces', { appli, qui: '@membre-m' })).ok, true);
  lierProprietaire(persona()!);
  avecDroit = await entrer('membre-m', MDP); assert.ok(avecDroit);
  cleMaison = ((await va.act('gladsheim', 'cle_tablette', { nom: 'Tablette maison', droits: 'maison' })).data as { key: string }).key;
  assert.equal((await va.act('apparence', 'theme', { theme: 'valhalla' })).ok, true);
  process.env.MQTT_PASSWORD = 'relais-de-test';
  await A.appareils.start!(ctxRelais);
  A.brokerOf()!.on('essai/+/cmd', (m: { topic: string; payload: Buffer }) => { recus.push([m.topic.split('/')[1], m.payload.toString()]); });
  annonce('light', 'l1'); annonce('light', 'l2', { device: { suggested_area: PIEGE } }); annonce('light', 'l3', { availability_topic: 'essai/l3/dispo', payload_available: 'online' });
  annonce('switch', 'p1'); annonce('fan', 'f1'); annonce('cover', 'v1'); annonce('climate', 'c1'); annonce('vacuum', 'a1'); annonce('lock', 'k1');
  annonce('sensor', 't1', { unit_of_measurement: '°C', command_topic: undefined });
  etatDe('l1', 'ON'); etatDe('l2', 'OFF'); etatDe('l3', 'ON'); A.brokerOf()!.publish('essai/l3/dispo', 'offline');
  etatDe('p1', 'OFF'); etatDe('f1', 'ON'); etatDe('v1', 'open'); etatDe('c1', 'cool'); etatDe('a1', 'docked'); etatDe('k1', 'LOCKED'); etatDe('t1', '21.5');
  // Suit la vérification à l'enregistrement (une cible qui ne désigne aucun appareil de la maison est retirée) : la fenêtre
  // n'est rangée qu'une fois les appareils annoncés connus de Midgard (sinon leur choix serait retiré).
  await connus(['essai_l1', 'essai_l2', 'essai_l3', 'essai_p1', 'essai_f1', 'essai_v1', 'essai_c1', 'essai_a1', 'essai_k1', 'essai_t1']);
  const r = await va.act('gladsheim', 'regler_fenetre', { fenetre: JSON.stringify(FENETRE()) }); assert.equal(r.ok, true, r.text);
});
after(async () => { A.appareils.stop!(); delete process.env.MQTT_PASSWORD; await tt.end(); Object.assign(console, orig); });

test('vrai Odin : chaque commande que le widget donne arrive au bon appareil, par la route d\'aujourd\'hui', async () => {
  const lui = await donnees(); assert.equal(lui.status, 200);
  const attendu: Record<string, string> = { on: 'ON', off: 'OFF', ouvre: 'ON', ferme: 'OFF' };
  for (const k of ['lumiere', 'prise', 'ventilo', 'volet', 'clim', 'aspirateur'] as const) {
    const e = lui.de(ID[k])!; assert.equal(e.etat, 'ok', `${k} : ${JSON.stringify(e)}`);
    const obj = OBJ[k], d = e.donnee!;
    assert.equal(d.id, `essai_${obj}`); assert.equal(d.nom, `Appareil ${obj}`); assert.equal(d.piece, 'Salon');
    assert.deepEqual(d.commandes.map((c: any) => c.code), COMMANDES_APPAREIL[d.sorte].map((c) => c.code), k);
    for (const c of d.commandes) {
      const ordres: string[] = c.nombre ? [c.nombre.ordre.replace('{n}', '40')] : c.ordres;
      for (const o of ordres) {
        recus.length = 0;
        const r = await commander(d.id, o); assert.equal(r.status, 200); assert.equal(r.body.ok, true, `${k} ${o} : ${JSON.stringify(r.body)}`);
        assert.deepEqual(recus, [[obj, attendu[o] ?? o]], `${k} : « ${o} » arrive à ${obj}`);
      }
    }
  }
  // Le capteur n'a aucune commande ; la lumière hors ligne non plus.
  assert.deepEqual(lui.de(ID.capteur)!.donnee!.commandes, []); assert.equal(lui.de(ID.capteur)!.donnee!.valeur, 21.5);
  assert.deepEqual(lui.de(ID.horsLigne)!.donnee!.commandes, []); assert.equal(lui.de(ID.horsLigne)!.donnee!.horsLigne, true);
  // Allumer une pièce : chacune de ses lumières, par la même route.
  const salon = (lui.de(ID.pieces)!.donnee!.pieces as any[]).find((p) => p.nom === 'Salon');
  assert.deepEqual(salon.lumieres.map((x: any) => x.id).sort(), ['essai_l1', 'essai_l3']);
  assert.ok(salon.allumes.includes('Appareil l1'));
  assert.ok(!lui.corps.includes('onerror="window') || lui.corps.includes('\\"window'), 'une pièce piégée n\'est qu\'une donnée');
});

test('vrai Odin : la serrure demande l\'accord à chaque fois ; sans accord rien ne part ; une tablette « maison » ne l\'ouvre jamais', async () => {
  const k = (await donnees()).de(ID.serrure)!.donnee!;
  assert.deepEqual(k.commandes.map((c: any) => [c.code, c.accord ?? false]), [['ouvrir', true], ['verrouiller', false]]);
  for (let i = 0; i < 2; i++) {
    recus.length = 0;
    const r = await commander('essai_k1', 'deverrouille');
    assert.equal(r.body.ok, false); assert.match(String(r.body.confirm), /déverrouiller/); assert.deepEqual(recus, [], 'sans accord, rien ne part');
  }
  recus.length = 0; assert.equal((await commander('essai_k1', 'deverrouille', {}, true)).body.ok, true); assert.deepEqual(recus, [['k1', 'deverrouille']]);
  // La tablette « maison » : la commande n'est pas dans son widget, et la requête rejouée est refusée, même avec « confirm ».
  recus.length = 0;
  const tab = await commander('essai_k1', 'deverrouille', { cookie: '', 'x-odin-maison': cleMaison }, true);
  assert.equal(tab.status, 200); assert.equal(tab.body.ok, false); assert.match(String(tab.body.text), /grave/); assert.deepEqual(recus, [], 'la tablette n\'ouvre pas');
  assert.equal((await commander('essai_k1', 'verrouille', { cookie: '', 'x-odin-maison': cleMaison })).body.ok, true, 'verrouiller reste permis à la tablette, comme aujourd\'hui');
});

test('vrai Odin : un membre, une clé d\'accès, sans session : rien de plus qu\'aujourd\'hui (ni donnée, ni commande)', async () => {
  const m = await donnees({ cookie: avecDroit });
  assert.equal(m.status, 200);
  for (const id of Object.values(ID)) { const e = m.de(id)!; assert.deepEqual([e.etat, e.raison, 'donnee' in e], ['refuse', 'proprietaire_seul', false], id); }
  assert.ok(!/essai_|Appareil |Salon/.test(m.corps), 'ni identifiant, ni nom, ni pièce');
  for (const [qui, h] of [['tablette', { cookie: '', 'x-odin-maison': cleMaison }], ['clé d\'accès', { cookie: '', authorization: `Bearer ${v.token}` }], ['sans session', { cookie: '' }]] as const) {
    const r = await donnees(h); assert.equal(r.status, 401, qui); assert.ok(!/essai_/.test(r.corps), qui);
  }
  for (const [qui, h] of [['membre', { cookie: avecDroit }], ['clé d\'accès', { cookie: '', authorization: `Bearer ${v.token}` }], ['sans session', { cookie: '' }]] as const) {
    recus.length = 0; const r = await commander('essai_l1', 'off', h); assert.equal(r.status, 401, qui); assert.deepEqual(recus, [], `${qui} : rien ne part`);
  }
});

test('vrai Odin : à l\'enregistrement, une cible qui ne désigne ni un appareil ni une pièce de la maison est retirée ; celle déjà rangée reste (l\'appareil retiré plus tard)', async () => {
  const va = valhallaOf()!, g = va.ctx('gladsheim');
  const de = (id: string) => ((g.settings.fenetre as { pages: Array<{ widgets: Widget[] }> }).pages.flatMap((p) => p.widgets)).find((w) => w.id === id);
  const f = FENETRE();
  f.pages[0].widgets.push(...[
    { id: 'd38000a1', kind: 'maison_lumiere', w: 1, c: 3, r: 2, cible: 'appareil:essai_l2' },
    { id: 'd38000a2', kind: 'maison_lumiere', w: 1, c: 3, r: 2, cible: 'appareil:essai_rien_9' },
    { id: 'd38000a3', kind: 'maison_temperature', w: 1, c: 2, r: 1, cible: 'piece:Salon' },
    { id: 'd38000a4', kind: 'maison_humidite', w: 1, c: 2, r: 1, cible: 'piece:Nulle-part' },
    { id: 'd38000a5', kind: 'maison_capteur', w: 1, c: 3, r: 2, cible: 'appareil:essai_t1' },
  ] as never[]);
  try {
    await rangerRg(f);
    assert.equal(de('d38000a1')?.cible, 'appareil:essai_l2', 'un appareil de la maison : gardé');
    assert.equal(de('d38000a3')?.cible, 'piece:Salon', 'une pièce de la maison : gardée');
    assert.equal(de('d38000a5')?.cible, 'appareil:essai_t1');
    for (const id of ['d38000a2', 'd38000a4']) { assert.ok(de(id), `${id} reste`); assert.equal(de(id)!.cible, undefined, `${id} : ne désigne rien, retirée (« pas encore choisi »)`); }
    // Rangée quand l'appareil existait, puis l'appareil retiré d'Odin : la fenêtre rangée de nouveau la garde, et la carte
    // dit « cet appareil n'existe plus ».
    const l = JSON.parse(JSON.stringify(g.settings.fenetre)); l.pages.flatMap((p: { widgets: Widget[] }) => p.widgets).find((w: Widget) => w.id === 'd38000a2').cible = 'appareil:essai_parti_43'; g.saveSettings({ fenetre: l });
    const lue = (await va.act('gladsheim', 'fenetre', {})).data as { pages: unknown[] };
    assert.equal((await va.act('gladsheim', 'regler_fenetre', { fenetre: JSON.stringify(lue) })).ok, true);
    assert.equal(de('d38000a2')?.cible, 'appareil:essai_parti_43', 'déjà rangée : gardée');
    assert.equal((await donnees()).de('d38000a2')?.raison, 'appareil_absent');
    // Changée pour une autre qui ne désigne rien : retirée.
    const l2 = (await va.act('gladsheim', 'fenetre', {})).data as { pages: Array<{ widgets: Widget[] }> };
    l2.pages.flatMap((p) => p.widgets).find((w) => w.id === 'd38000a2')!.cible = 'appareil:essai_rien_10';
    assert.equal((await va.act('gladsheim', 'regler_fenetre', { fenetre: JSON.stringify(l2) })).ok, true);
    assert.equal(de('d38000a2')?.cible, undefined);
  } finally { await rangerRg(FENETRE()); }
});

test('vrai Odin : la pose et « Régler » proposent les mêmes appareils (la règle de la page, choixDePose, suit celle du serveur)', async () => {
  const win: Record<string, any> = { document: { documentElement: { lang: 'fr' } } };
  for (const src of [PAGE_JS, RENDU]) vm.runInNewContext(src, { window: win, document: win.document, Intl });
  const M = win.OdinWidgetsMaisonAppareils, e = await v.json('/api/maison/etat');
  assert.equal(e.status, 200); assert.ok(Array.isArray(e.body.rooms));
  const lui = await donnees();
  for (const [k, id] of [['maison_lumiere', ID.lumiere], ['maison_capteur', ID.capteur], ['maison_appareil', ID.prise]] as const) {
    const serveur = ((lui.de(id) as unknown as { choix?: Array<{ cible: string }> }).choix ?? []).map((c) => c.cible), cotePage: string[] = (M.choixDePose(k, e.body.rooms) ?? []).map((c: { cible: string }) => c.cible);
    assert.ok(serveur.length >= 1, k); assert.deepEqual([...cotePage].sort(), [...serveur].sort(), `${k} : les mêmes appareils`);
  }
});

// ------------------------------------------------------------------ dans un vrai navigateur (s'il y en a un)

declare const document: any, window: any, getComputedStyle: any, DataTransfer: any, DragEvent: any, NodeFilter: any;
type DOMRect = { left: number; right: number; top: number; bottom: number; width: number; height: number };
interface Requete { method(): string; postDataJSON(): any }
interface Route { fetch(): Promise<{ json(): Promise<any> }>; fulfill(o: Record<string, unknown>): Promise<void>; continue(): Promise<void>; request(): Requete }
interface Page {
  goto(u: string): Promise<unknown>; waitForSelector(s: string, o?: Record<string, unknown>): Promise<unknown>;
  evaluate<X>(f: string | ((a?: any) => X), a?: unknown): Promise<X>; route(u: string | RegExp, h: (r: Route) => Promise<void> | void): Promise<void>;
  on(e: string, f: (x: any) => void): void; screenshot(o: Record<string, unknown>): Promise<unknown>; click(s: string, o?: Record<string, unknown>): Promise<void>; dblclick(s: string): Promise<void>; focus(s: string): Promise<void>;
  keyboard: { press(k: string): Promise<void> }; waitForTimeout(ms: number): Promise<void>;
}
interface Contexte { newPage(): Promise<Page>; addCookies(c: unknown[]): Promise<void>; addInitScript(f: string): Promise<void>; close(): Promise<void> }
interface Navigateur { newContext(o: Record<string, unknown>): Promise<Contexte>; close(): Promise<void> }
const pw = (() => { try { return createRequire(import.meta.url)('playwright') as { chromium: { launch(): Promise<Navigateur> } }; } catch { return undefined; } })();
const sansNav = pw ? false : 'Playwright n\'est pas installé sur cette machine';
let nav: Navigateur | undefined;
before(async () => { if (pw) nav = await pw.chromium.launch(); });
after(async () => { await nav?.close(); });
const CAPTURES = process.env.ODIN_CAPTURES;
// Forcés dans la réponse : un lecteur (le relais d'essai n'en a pas : ils viennent d'une box reliée) et une clim dont la
// consigne est lue ; leurs ordres partent vers un appareil inconnu du relais (Odin le dit).
const FORCES: Record<string, () => Record<string, unknown>> = {
  [ID.lecteur]: () => ({ etat: 'ok', at: Date.now(), donnee: { id: 'essai_lecteur', nom: 'Lecteur du salon', piece: 'Salon', sorte: 'lecteur', etat: 'playing', unite: '', allume: true, commandes: COMMANDES_APPAREIL.lecteur.map((c) => ({ code: c.code, ordres: [...c.ordres] })) } }),
  [ID.climLue]: () => ({ etat: 'ok', at: Date.now(), donnee: { id: 'essai_climLue', nom: 'Clim du bureau', piece: PIEGE, sorte: 'clim', etat: '21', unite: '', consigne: 21, commandes: COMMANDES_APPAREIL.clim.map((c) => ({ code: c.code, ordres: [...c.ordres], ...(c.nombre ? { nombre: { ...c.nombre } } : {}) })) } }),
};
async function ouvrir(largeur: number, sombre: boolean) {
  const doigt = largeur < 500;
  const ctx = await nav!.newContext({ viewport: { width: largeur, height: doigt ? 800 : 900 }, hasTouch: doigt, isMobile: doigt, colorScheme: sombre ? 'dark' : 'light' });
  const [n, ...x] = v.session.split('='); await ctx.addCookies([{ name: n, value: x.join('='), url: v.url, httpOnly: true, sameSite: 'Strict' }]);
  await ctx.addInitScript(`try { localStorage.setItem('odin.tour', 'done'); localStorage.setItem('odin.fenetre.page', '1'); ${sombre ? 'localStorage.setItem(\'odin.theme\', \'sombre\');' : ''} } catch { /* rien */ }`);
  const p = await ctx.newPage(), erreurs: string[] = [], envois: any[] = [];
  p.on('pageerror', (e) => erreurs.push(String(e)));
  await p.route(/\/api\/widgets\/donnees/, async (r) => {
    const rep = await r.fetch(), j = await rep.json();
    if (Array.isArray(j?.widgets)) j.widgets = j.widgets.map((w: any) => (Object.hasOwn(FORCES, w.id) ? { id: w.id, kind: w.kind, page: w.page, ...FORCES[w.id]() } : w));
    await r.fulfill({ response: rep, json: j });
  });
  await p.route(/\/api\/maison\/appareil/, async (r) => { envois.push(r.request().postDataJSON()); await r.continue(); });
  await p.goto(v.url + '/');
  await p.waitForSelector('#app:not([hidden])', { timeout: 30000 });
  try { for (const id of Object.values(ID)) await p.waitForSelector(`#feGrid .fe-w[data-id="${id}"] .wma`, { timeout: 45000 }); }
  catch (e) { const vus = await p.evaluate(() => [...document.querySelectorAll('#feGrid > .fe-w')].map((c: any) => `${c.dataset.id}: ${c.textContent.slice(0, 80)}`)); await ctx.close(); throw new Error(`${String(e).split('\n')[0]} · cartes : ${JSON.stringify(vus)} · ${erreurs.join(' | ')}`); }
  return { ctx, page: p, erreurs, envois };
}
/** Ce que la page montre de chaque carte : ses commandes, leur taille, et ce qui serait coupé ou dehors. */
const vu = (p: Page) => p.evaluate((ids: Record<string, string>) => {
  const txt = (n: any) => (n?.textContent ?? '').replace(/\s+/g, ' ').trim(), out: Record<string, any> = { deborde: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1, pirate: Boolean(window.__pirate) };
  for (const [nom, id] of Object.entries(ids)) {
    const c = document.querySelector(`#feGrid > .fe-w[data-id="${id}"]`); if (!c) { out[nom] = null; continue; }
    const b = c.getBoundingClientRect(), vis = (n: any) => n.getClientRects().length > 0 && getComputedStyle(n).visibility !== 'hidden';
    const corps = c.querySelector('.wma');
    out[nom] = {
      texte: txt(corps), codes: [...c.querySelectorAll('[data-code]')].filter(vis).map((n: any) => n.dataset.code),
      petits: [...c.querySelectorAll('.wma button, .wma input')].filter(vis).filter((n: any) => { const r = n.getBoundingClientRect(); return r.height < 44 - 0.5 || r.width < 44 - 0.5; }).map((n: any) => `${n.dataset.code || n.className} ${Math.round(n.getBoundingClientRect().width)}×${Math.round(n.getBoundingClientRect().height)}`),
      dehors: [...corps.querySelectorAll('*')].filter(vis).filter((n: any) => { const r = n.getBoundingClientRect(); return r.width > 0 && r.height > 0 && (r.left < b.left - 1 || r.right > b.right + 1 || r.top < b.top - 1 || r.bottom > b.bottom + 1); }).map((n: any) => `${n.tagName}.${n.className} « ${txt(n).slice(0, 20)} »`),
      curseur: (() => { const r = c.querySelector('input[type=range][data-code=intensite]'); return r ? { dit: r.getAttribute('aria-valuetext'), sortie: txt(c.querySelector('.wma-n')), pose: r.hasAttribute('data-pose') } : null; })(),
      entete: txt(c.querySelector('.fe-h')),
      // Un nom court (12 signes au plus) coupé : il devrait tenir.
      coupes: [...c.querySelectorAll('.wma-nom')].filter(vis).filter((n: any) => txt(n).length <= 12 && n.scrollWidth > n.clientWidth + 1).map((n: any) => `${txt(n)} ${n.clientWidth}px`),
      interrupteur: c.querySelector('[data-code=interrupteur]')?.getAttribute('aria-checked') ?? null,
    };
  }
  return out;
}, ID);

for (const [largeur, sombre] of [[1280, false], [390, true], [768, false], [1280, true], [390, false]] as const) {
  test(`navigateur, ${largeur} px, ${sombre ? 'sombre' : 'clair'} : chaque commande est là, de 44 px, dans sa carte ; aucune valeur inventée ; une pièce piégée reste du texte`, { skip: sansNav }, async () => {
    const { ctx, page: p, erreurs } = await ouvrir(largeur, sombre);
    try {
      const a = await vu(p);
      assert.equal(a.deborde, false, 'rien ne déborde de la page'); assert.equal(a.pirate, false, 'aucun script injecté');
      const attendus: Record<string, string> = { lumiere: 'lumière', prise: 'prise', ventilo: 'ventilateur', volet: 'volet', clim: 'clim', aspirateur: 'aspirateur', serrure: 'serrure', lecteur: 'lecteur', climLue: 'clim' };
      for (const [k, sorte] of Object.entries(attendus)) {
        assert.ok(a[k], k);
        assert.deepEqual([...new Set(a[k].codes)], COMMANDES_APPAREIL[sorte].map((c) => c.code), `${k} : toutes les commandes de la carte d'aujourd'hui`);
        assert.deepEqual(a[k].petits, [], `${k} : cibles de 44 px`); assert.deepEqual(a[k].dehors, [], `${k} : tout tient dans la carte`);
      }
      for (const k of ['pieces', 'capteur', 'horsLigne', 'eteinte']) { assert.deepEqual(a[k].petits, [], `${k} : 44 px`); assert.deepEqual(a[k].dehors, [], `${k} : dans la carte`); }
      // La lumière : le curseur n'a pas de nombre de départ ; l'interrupteur dit l'état vrai.
      assert.deepEqual(a.lumiere.curseur, { dit: 'Intensité non mesurée', sortie: '', pose: false }); assert.equal(a.lumiere.interrupteur, 'true'); assert.equal(a.eteinte.interrupteur, 'false');
      // La clim sans consigne lue : aucun degré, « moins » et « plus » ne peuvent rien envoyer ; avec consigne : 21 °.
      assert.doesNotMatch(a.clim.texte, /\d\s*°/); assert.match(a.climLue.texte, /21\s*°/);
      // Hors ligne : dit, aucune commande. Le capteur : sa valeur dans la langue de la page, sa pièce.
      assert.deepEqual(a.horsLigne.codes, []); assert.match(a.horsLigne.texte, /[Hh]ors ligne/);
      assert.match(a.capteur.texte, /21,5\s*°C/);
      // Sa pièce : une seule fois, dans le corps (l'en-tête ne la redit pas).
      assert.match(a.capteur.texte, /Salon/); assert.doesNotMatch(a.capteur.entete, /Salon/);
      assert.match(a.pieces.texte, /Salon/); assert.ok(a.pieces.texte.includes('<img'), 'la pièce piégée : du texte');
      // La serrure : « Glisser pour ouvrir » se lit dans sa piste (comme la carte d'aujourd'hui), pas seulement à l'oreille.
      assert.match(a.serrure.texte, /Glisser pour ouvrir/);
      // La pièce n'est écrite qu'une fois : dans le corps, avec l'état ; l'en-tête ne la redit pas (à 768 px il la couperait).
      assert.match(a.lumiere.texte, /Salon/); assert.doesNotMatch(a.lumiere.entete, /Salon/);
      // « Pièces » : un nom court tient en entier, 768 px compris.
      assert.deepEqual(a.pieces.coupes, [], 'pièces : un nom court n\'est pas coupé');
      if (CAPTURES) await p.screenshot({ path: `${CAPTURES}/maison-appareils-${largeur}${sombre ? '-sombre' : ''}.png`, fullPage: true });
      assert.deepEqual(erreurs, [], 'aucune erreur dans la page');
    } finally { await ctx.close(); }
  });
}

test('navigateur : un appui commande le bon appareil ; la serrure glissée demande l\'accord, refusé : rien ne part ; « Modifier » : rien ne part ; le clavier', { skip: sansNav }, async () => {
  const { ctx, page: p, erreurs, envois } = await ouvrir(1280, false);
  const carte = (k: string) => `#feGrid .fe-w[data-id="${ID[k]}"]`;
  const attendre = async (n: number) => { for (let i = 0; i < 50 && envois.length < n; i++) await p.waitForTimeout(100); };
  try {
    // Chaque bouton envoie son ordre au bon appareil.
    for (const [k, code, attendu] of [['prise', 'interrupteur', 'on'], ['ventilo', 'interrupteur', 'off'], ['volet', 'monter', 'ouvre'], ['volet', 'arreter', 'stop'], ['volet', 'descendre', 'ferme'], ['aspirateur', 'nettoyer', 'on'], ['aspirateur', 'base', 'off'], ['lecteur', 'precedent', 'precedent'], ['lecteur', 'lecture_pause', 'pause'], ['lecteur', 'suivant', 'suivant'], ['climLue', 'consigne-', '20'], ['climLue', 'consigne+', '22'], ['clim', 'marche_arret', 'off']] as const) {
      envois.length = 0; recus.length = 0;
      await p.click(`${carte(k)} [data-code="${code.replace(/[+-]$/, '')}"]${code.endsWith('-') ? '[data-pas="-1"]' : code.endsWith('+') ? '[data-pas="1"]' : ''}`);
      await attendre(1);
      const obj = k === 'lecteur' || k === 'climLue' ? k : OBJ[k as keyof typeof OBJ];
      assert.deepEqual(envois, [{ appareil: `essai_${obj}`, valeur: attendu }], `${k} ${code}`);
    }
    // La clim sans consigne lue : « moins » et « plus » ne partent pas (aucun degré inventé).
    assert.equal(await p.evaluate((s: string) => [...document.querySelectorAll(`${s} [data-code="consigne"]`)].every((b: any) => b.disabled), carte('clim')), true);
    // Le curseur sans mesure : une flèche ne part de nulle part (aucun pas depuis une valeur inventée) : rien ne part.
    envois.length = 0; await p.focus(`${carte('lumiere')} input[data-code=intensite]`); await p.keyboard.press('ArrowRight'); await p.waitForTimeout(400);
    assert.deepEqual(envois, [], 'sans mesure, une flèche n\'envoie rien');
    // Une valeur choisie en absolu (Fin : le maximum) part ; ensuite, les flèches partent de la valeur demandée.
    await p.keyboard.press('End'); await attendre(1);
    assert.deepEqual(envois, [{ appareil: 'essai_l1', valeur: '100 %' }]);
    for (let i = 0; i < 30 && !recus.some(([o]) => o === 'l1'); i++) await p.waitForTimeout(100);
    for (let i = 0; i < 30 && !(await p.evaluate((s: string) => document.querySelector(`${s} input[data-code=intensite]`)?.hasAttribute('data-pose'), carte('lumiere'))); i++) await p.waitForTimeout(100);
    recus.length = 0; envois.length = 0; await p.focus(`${carte('lumiere')} input[data-code=intensite]`); await p.keyboard.press('ArrowLeft'); await attendre(1);
    assert.deepEqual(envois, [{ appareil: 'essai_l1', valeur: '99 %' }]);
    // (l'ordre arrive au relais : attendu avant la suite, pour ne pas le compter plus bas)
    for (let i = 0; i < 30 && !recus.some(([o]) => o === 'l1'); i++) await p.waitForTimeout(100);
    // La serrure glissée : l'accord est demandé ; « Annuler » : rien ne part au relais.
    const glisser = () => p.evaluate((s: string) => { const r = document.querySelector(`${s} input[data-code=ouvrir]`); r.value = '100'; r.dispatchEvent(new Event('input', { bubbles: true })); r.dispatchEvent(new Event('change', { bubbles: true })); }, carte('serrure'));
    envois.length = 0; recus.length = 0; await glisser(); await p.waitForSelector('dialog.wma-accord[open]');
    assert.equal(await p.evaluate(() => document.querySelector('dialog.wma-accord [data-choix=oui]').classList.contains('wma-grave')), true, '« Confirmer » porte la marque d\'un geste grave');
    await p.click('dialog.wma-accord [data-choix=non]'); await p.waitForTimeout(400);
    assert.deepEqual(envois, [{ appareil: 'essai_k1', valeur: 'deverrouille' }], 'une seule demande, sans « confirm »'); assert.deepEqual(recus, [], 'sans accord, rien ne part');
    // Après « Annuler » : l'état vrai reste écrit, le message est à part.
    const apres = await p.evaluate((s: string) => document.querySelector(`${s} .wma`).textContent, carte('serrure'));
    assert.match(apres, /Verrouillée/); assert.match(apres, /pas d'accord/);
    // Accordé : la demande repart avec « confirm », et la serrure s'ouvre.
    envois.length = 0; await glisser(); await p.waitForSelector('dialog.wma-accord[open]'); await p.click('dialog.wma-accord [data-choix=oui]'); await attendre(2);
    assert.deepEqual(envois, [{ appareil: 'essai_k1', valeur: 'deverrouille' }, { appareil: 'essai_k1', valeur: 'deverrouille', confirm: true }]);
    for (let i = 0; i < 20 && !recus.length; i++) await p.waitForTimeout(100);
    assert.deepEqual(recus, [['k1', 'deverrouille']]);
    // Le résultat est écrit sous les commandes ; le focus reste sur la commande quand la page se redessine.
    await p.focus(`${carte('prise')} [data-code=interrupteur]`);
    await p.evaluate(() => window.OdinFenetre.edit(false));
    assert.equal(await p.evaluate((s: string) => document.activeElement?.closest?.(s) !== null && document.activeElement?.dataset?.code, carte('prise')), 'interrupteur');
    // « Modifier » : rien ne part.
    await p.evaluate(() => window.OdinFenetre.edit(true)); envois.length = 0;
    await p.evaluate((s: string) => document.querySelector(`${s} [data-code=interrupteur]`)?.click(), carte('prise')); await p.waitForTimeout(400);
    assert.deepEqual(envois, [], 'en mode « Modifier », rien ne part');
    await p.evaluate(() => window.OdinFenetre.edit(false));
    // Une pièce : allumer ou éteindre toutes ses lumières (ici le salon a une lumière allumée : tout s'éteint ; la
    // lumière hors ligne n'est pas commandée).
    envois.length = 0; await p.click(`${carte('pieces')} [data-piece="Salon"]`); await attendre(1); await p.waitForTimeout(300);
    assert.deepEqual(envois, [{ appareil: 'essai_l1', valeur: 'off' }]);
    assert.deepEqual(erreurs, []);
  } finally { await ctx.close(); }
});

// ------------------------------------------------------------------ « Régler » : le choix de ce que le widget montre (navigateur)

/** Deux widgets de plus sur la page : une lumière pas encore choisie, une lumière dont l'appareil a été retiré d'Odin. */
const ID_RG = { sansChoix: 'd38000f0', parti: 'd38000f1' };
const FENETRE_RG = () => { const f = FENETRE(); f.pages[0].widgets.push({ id: ID_RG.sansChoix, kind: 'maison_lumiere', w: 1, c: 3, r: 2 } as never, { id: ID_RG.parti, kind: 'maison_lumiere', w: 1, c: 3, r: 2, cible: 'appareil:essai_parti_42' } as never); return f; };
/** Range la fenêtre `f`, en gardant les pages sous un code déjà rangées (« Aujourd'hui » et son « À faire », qui ne se retire pas). */
const rangerRg = async (f: { pages: unknown[] }) => {
  const va = valhallaOf()!, l = (await va.act('gladsheim', 'fenetre', {})).data as { pages: Array<{ code?: string }> };
  const r = await va.act('gladsheim', 'regler_fenetre', { fenetre: JSON.stringify({ ...f, pages: [...l.pages.filter((p) => p.code), ...f.pages] }) }); assert.equal(r.ok, true, r.text);
};
/** Ce que montre la fenêtre « Régler » ouverte : le champ du choix, ses lignes, le titre proposé, l'en-tête, ce qui déborde. */
const regard = (p: Page) => p.evaluate(() => {
  const d = document.querySelector('dialog.wr-regler[open]'), s = d?.querySelector('#wrRCi');
  if (!d || !s) return null;
  const r = s.getBoundingClientRect(), b = d.getBoundingClientRect();
  return { options: [...s.options].map((o: any) => o.textContent), valeurs: [...s.options].map((o: any) => o.value), valeur: s.value, haut: r.height, dedans: r.left >= b.left - 1 && r.right <= b.right + 1,
    titre: d.querySelector('h2')?.textContent ?? '', propose: d.querySelector('#wrRT')?.placeholder ?? '', ecrit: d.querySelector('#wrRT')?.value ?? '',
    deborde: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1 || d.scrollWidth > d.clientWidth + 1, label: d.querySelector('label[for="wrRCi"]')?.textContent ?? '' };
});
const choisir = (p: Page, v: string) => p.evaluate((x: string) => { const s = document.querySelector('#wrRCi'); s.value = x; s.dispatchEvent(new Event('change', { bubbles: true })); }, v);
const cliquerTexte = (p: Page, sel: string, t: string) => p.evaluate((a: string[]) => { const b = [...document.querySelectorAll(a[0])].find((n: any) => n.textContent.trim() === a[1]); if (!b) throw new Error(`pas de bouton « ${a[1]} »`); b.click(); }, [sel, t]);
const carteRg = (id: string) => `#feGrid .fe-w[data-id="${id}"]`;
const attendreQue = async (p: Page, f: (s: string) => boolean, s: string) => { for (let i = 0; i < 300; i++) { if (await p.evaluate(f, s)) return; await p.waitForTimeout(100); } throw new Error(`attendu en vain : ${String(f).slice(0, 120)}`); };

for (const largeur of [1280, 390] as const) {
  test(`navigateur, ${largeur} px : « Régler » choisit la lumière par son nom et sa pièce (jamais un identifiant) ; le titre proposé et l'en-tête suivent ; la carte montre le bon appareil et ses commandes ; changer de choix`, { skip: sansNav }, async () => {
    await rangerRg(FENETRE_RG());
    const { ctx, page: p, erreurs } = await ouvrir(largeur, false);
    try {
      // Pas encore choisie : la carte le dit, et « Choisir » ouvre « Régler » sur ce choix.
      await p.waitForSelector(`${carteRg(ID_RG.sansChoix)} .wma [data-action=choisir]`, { timeout: 30000 });
      assert.match(await p.evaluate((s: string) => document.querySelector(`${s} .wma`).textContent, carteRg(ID_RG.sansChoix)), /Aucune lumière choisie/);
      await p.click(`${carteRg(ID_RG.sansChoix)} .wma [data-action=choisir]`);
      await p.waitForSelector('dialog.wr-regler[open] #wrRCi');
      let a = (await regard(p))!;
      assert.equal(a.label, 'La lumière montrée');
      assert.deepEqual(a.valeurs, ['', 'appareil:essai_l1', 'appareil:essai_l2', 'appareil:essai_l3'], 'les lumières seulement');
      assert.ok(a.options.every((t: string) => !/essai_/.test(t)), `jamais un identifiant : ${JSON.stringify(a.options)}`);
      assert.match(a.options[1], /Appareil l1.*Salon/); assert.match(a.options[3], /Appareil l3.*Salon.*hors ligne/i, 'hors ligne : dans la liste, et dit');
      assert.ok(a.options[2].includes('<img'), 'une pièce piégée reste du texte');
      assert.ok(a.haut >= 44 - 0.5, `44 px (${a.haut})`); assert.equal(a.dedans, true); assert.equal(a.deborde, false, 'rien ne déborde');
      // Changer de choix : le titre proposé et l'en-tête suivent ; puis un autre : ils suivent encore.
      await choisir(p, 'appareil:essai_l2'); a = (await regard(p))!;
      assert.equal(a.propose, 'Appareil l2'); assert.match(a.titre, /Appareil l2/);
      await choisir(p, 'appareil:essai_l1'); a = (await regard(p))!;
      assert.equal(a.propose, 'Appareil l1'); assert.match(a.titre, /Appareil l1/); assert.doesNotMatch(a.titre, /l2/);
      // Valider : la fenêtre se ferme, le focus revient sur la carte ; « Terminé » range ; la carte montre l1 et ses commandes.
      await cliquerTexte(p, 'dialog.wr-regler button', 'Valider');
      await attendreQue(p, () => !document.querySelector('dialog.wr-regler[open]'), '');
      await attendreQue(p, (s: string) => Boolean(document.activeElement?.closest?.(s)), carteRg(ID_RG.sansChoix));
      await cliquerTexte(p, '#fenetre button', 'Terminé');
      await attendreQue(p, (s: string) => /Appareil l1/.test(document.querySelector(`${s} .wma`)?.textContent ?? '') && Boolean(document.querySelector(`${s} [data-code=interrupteur]`)), carteRg(ID_RG.sansChoix));
      const range = () => (((valhallaOf()!.ctx('gladsheim').settings.fenetre ?? { pages: [] }) as { pages: Array<{ widgets: Widget[] }> }).pages.flatMap((x) => x.widgets)).find((w) => w.id === ID_RG.sansChoix)!;
      // Le titre proposé n'est jamais rangé (il serait servi à un membre avec la fenêtre : relecture du complément, constat 1) :
      // la carte lit le nom dans son état, servi au propriétaire seul. Avant : le titre rangé valait « Appareil l1 ».
      assert.deepEqual([range().cible, range().label], ['appareil:essai_l1', undefined], 'rangé : l\'appareil choisi, sans titre');
      const vu = await v.json('/api/valhalla/act', { module: 'gladsheim', action: 'fenetre' }, { cookie: avecDroit });
      assert.equal(vu.status, 200); assert.ok(JSON.stringify(vu.body).includes(ID_RG.sansChoix), 'le membre reçoit bien la fenêtre');
      assert.ok(!/Appareil l|essai_|Salon/.test(JSON.stringify(vu.body)), `le membre ne reçoit ni le nom, ni la pièce, ni l'identifiant : ${JSON.stringify(vu.body).slice(0, 300)}`);
      // Rouvrir « Régler » et changer de lumière : l2 ; le titre écrit d'office suit (il n'a pas été changé à la main).
      await p.click(`${carteRg(ID_RG.sansChoix)} .wr-plus`); await p.waitForSelector('dialog.wr-regler[open] #wrRCi');
      a = (await regard(p))!; assert.equal(a.valeur, 'appareil:essai_l1'); assert.ok(!a.valeurs.includes(''), 'déjà choisie : plus de ligne « choisir »');
      await choisir(p, 'appareil:essai_l2'); a = (await regard(p))!; assert.equal(a.ecrit, '', 'le titre proposé d\'office laisse la place au nouveau'); assert.equal(a.propose, 'Appareil l2');
      await cliquerTexte(p, 'dialog.wr-regler button', 'Valider'); await attendreQue(p, () => !document.querySelector('dialog.wr-regler[open]'), '');
      await cliquerTexte(p, '#fenetre button', 'Terminé');
      await attendreQue(p, (s: string) => /Appareil l2/.test(document.querySelector(`${s} .wma`)?.textContent ?? ''), carteRg(ID_RG.sansChoix));
      assert.deepEqual([range().cible, range().label], ['appareil:essai_l2', undefined]);
      if (CAPTURES) await p.screenshot({ path: `${CAPTURES}/regler-choix-${largeur}.png`, fullPage: true });
      assert.deepEqual(erreurs, [], 'aucune erreur dans la page');
    } finally { await ctx.close(); await rangerRg(FENETRE()); }
  });
}

test('navigateur, 390 px : un appareil choisi puis retiré d\'Odin — la carte dit « Cet appareil n\'existe plus » ; « Régler » le montre sous un mot neutre, jamais son identifiant', { skip: sansNav }, async () => {
  await rangerRg(FENETRE_RG());
  // Suit la vérification à l'enregistrement (une cible neuve qui ne désigne rien est retirée) : la cible de l'appareil
  // retiré est posée comme rangée quand il existait encore.
  { const g = valhallaOf()!.ctx('gladsheim'), l = JSON.parse(JSON.stringify(g.settings.fenetre)); l.pages.flatMap((p: { widgets: Widget[] }) => p.widgets).find((w: Widget) => w.id === ID_RG.parti).cible = 'appareil:essai_parti_42'; g.saveSettings({ fenetre: l }); }
  const { ctx, page: p, erreurs } = await ouvrir(390, true);
  try {
    await p.waitForSelector(`${carteRg(ID_RG.parti)} .wma [data-action=choisir]`, { timeout: 30000 });
    const texte = await p.evaluate((s: string) => document.querySelector(`${s} .wma`).textContent, carteRg(ID_RG.parti));
    assert.match(texte, /Cet appareil n'existe plus/); assert.doesNotMatch(texte, /parti_42/);
    const btn = await p.evaluate((s: string) => { const b = document.querySelector(`${s} .wma [data-action=choisir]`); const r = b?.getBoundingClientRect(); return r ? [r.width, r.height] : null; }, carteRg(ID_RG.parti));
    assert.ok(btn && btn[0] >= 44 - 0.5 && btn[1] >= 44 - 0.5, `« Choisir » : 44 px (${btn})`);
    await p.click(`${carteRg(ID_RG.parti)} .wma [data-action=choisir]`); await p.waitForSelector('dialog.wr-regler[open] #wrRCi');
    const a = (await regard(p))!;
    assert.equal(a.valeur, 'appareil:essai_parti_42', 'le choix d\'avant reste choisi'); assert.equal(a.options[0], 'Appareil retiré');
    assert.ok(a.options.every((t: string) => !/essai_|parti_42/.test(t)), JSON.stringify(a.options)); assert.equal(a.deborde, false);
    // Annuler : rien ne change, la fenêtre se ferme.
    await cliquerTexte(p, 'dialog.wr-regler button', 'Annuler'); await attendreQue(p, () => !document.querySelector('dialog.wr-regler[open]'), '');
    assert.deepEqual(erreurs, []);
  } finally { await ctx.close(); await rangerRg(FENETRE()); }
});

// ------------------------------------------------------------------ la pose depuis le tiroir ; « Régler » d'un petit chiffre (navigateur)

/** Ce que l'écran de la maison reçoit, réduit pour la page seule (une seule lumière, aucune) : la vérification au rangement lit toujours les vrais. */
const reduire = (p: Page, garder: (d: { id: string; kind: string }) => boolean) => p.route(/\/api\/maison\/etat/, async (r) => {
  const rep = await r.fetch(), j = await rep.json(); j.rooms = (j.rooms ?? []).map((x: any) => ({ ...x, devices: (x.devices ?? []).filter(garder) })); await r.fulfill({ response: rep, json: j });
});
const modifierP = async (p: Page) => { await p.click('#fenetre .fe-mod'); await p.waitForSelector('#fenetre .fe-ajout'); };
const tiroirP = async (p: Page) => { await p.click('#fenetre .fe-ajout'); await p.waitForSelector('#feTiroir.open'); await p.waitForTimeout(350); };
const cartes = (p: Page) => p.evaluate(() => [...document.querySelectorAll('#feGrid > .fe-w')].map((c: any) => c.dataset.id as string));
const rangees = () => ((valhallaOf()!.ctx('gladsheim').settings.fenetre ?? { pages: [] }) as { pages: Array<{ widgets: Widget[] }> }).pages.flatMap((x) => x.widgets);
const taille44 = (p: Page, sel: string) => p.evaluate((s: string) => { const n = document.querySelector(s); if (!n || !n.getClientRects().length) return null; return [n.offsetWidth, n.offsetHeight]; }, sel); // la taille posée (pas celle d'une animation en cours)

for (const largeur of [1280, 390] as const) {
  test(`navigateur, ${largeur} px : poser « Lumière » avec trois lumières — « Régler » s'ouvre aussitôt sur le choix ; choisir ; annuler laisse « Choisir une lumière », qui rouvre « Régler »`, { skip: sansNav }, async () => {
    await rangerRg(FENETRE());
    const { ctx, page: p, erreurs } = await ouvrir(largeur, false);
    try {
      const avant = await cartes(p);
      await modifierP(p); await tiroirP(p);
      await p.click('#feTiroir button[aria-label="Ajouter Lumière"]');
      await p.waitForSelector('dialog.wr-regler[open] #wrRCi', { timeout: 15000 });
      let a = (await regard(p))!;
      assert.equal(a.label, 'La lumière montrée');
      // Ouverte par la pose : le focus est sur le choix demandé (pas sur « Titre affiché »).
      await attendreQue(p, () => document.activeElement?.id === 'wrRCi', '');
      // Rangées par pièce, comme l'écran de la maison les reçoit (« Régler » d'un widget déjà rangé : l'ordre de Midgard).
      assert.equal(a.valeurs[0], ''); assert.deepEqual([...a.valeurs].sort(), ['', 'appareil:essai_l1', 'appareil:essai_l2', 'appareil:essai_l3'], 'les trois lumières, rien d\'autre');
      assert.ok(a.options.every((t: string) => !/essai_/.test(t)), `jamais un identifiant : ${JSON.stringify(a.options)}`);
      assert.equal(a.deborde, false); assert.ok(a.haut >= 44 - 0.5);
      const apres = await cartes(p); assert.deepEqual(apres.slice(0, -1), avant, 'posée à la fin'); const une = apres[apres.length - 1];
      await choisir(p, 'appareil:essai_l2'); a = (await regard(p))!; assert.equal(a.propose, 'Appareil l2');
      await cliquerTexte(p, 'dialog.wr-regler button', 'Valider'); await attendreQue(p, () => !document.querySelector('dialog.wr-regler[open]'), '');
      // Une seconde, et « Annuler » : la carte dit quoi faire, son bouton rouvre « Régler ».
      await tiroirP(p); await p.click('#feTiroir button[aria-label="Ajouter Lumière"]');
      await p.waitForSelector('dialog.wr-regler[open] #wrRCi', { timeout: 15000 });
      const deux = (await cartes(p)).slice(-1)[0]; assert.notEqual(deux, une);
      await cliquerTexte(p, 'dialog.wr-regler button', 'Annuler'); await attendreQue(p, () => !document.querySelector('dialog.wr-regler[open]'), '');
      const choisirSel = `${carteRg(deux)} .wma [data-action=choisir]`;
      await p.waitForSelector(choisirSel, { timeout: 10000 });
      assert.equal(await p.evaluate((s: string) => document.querySelector(s).textContent, choisirSel), 'Choisir une lumière');
      assert.match(await p.evaluate((s: string) => document.querySelector(`${s} .wma`).textContent, carteRg(deux)), /Aucune lumière choisie/);
      const t = await taille44(p, choisirSel); assert.ok(t && t[0] >= 44 && t[1] >= 44, `44 px (${t})`);
      assert.equal(await p.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1), false, 'rien ne déborde');
      // Un vrai appui, au point du bouton (souris ou doigt) : en mode « Modifier », les commandes de la carte ne
      // réagissent pas, mais « Choisir » n'envoie aucune commande et doit répondre. L'animation de la pose finie d'abord.
      await attendreQue(p, (s: string) => !document.querySelector(s)?.closest('.fe-w')?.classList.contains('fe-pop'), choisirSel);
      await p.evaluate((s: string) => document.querySelector(s).scrollIntoView({ block: 'center' }), choisirSel); await p.waitForTimeout(300);
      assert.equal(await p.evaluate((s: string) => { const b = document.querySelector(s), r = b.getBoundingClientRect(), n = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return n === b ? '' : String(n?.className ?? n); }, choisirSel), '', "« Choisir une lumière » reçoit l'appui à son point");
      await p.click(choisirSel, { timeout: 5000 }); await p.waitForSelector('dialog.wr-regler[open] #wrRCi');
      a = (await regard(p))!; assert.deepEqual([...a.valeurs].sort(), ['', 'appareil:essai_l1', 'appareil:essai_l2', 'appareil:essai_l3'], 'la même liste');
      await cliquerTexte(p, 'dialog.wr-regler button', 'Annuler'); await attendreQue(p, () => !document.querySelector('dialog.wr-regler[open]'), '');
      // « Terminé » : la première montre la lampe choisie et ses commandes ; la seconde reste « pas encore choisie ».
      await cliquerTexte(p, '#fenetre button', 'Terminé');
      await attendreQue(p, (s: string) => /Appareil l2/.test(document.querySelector(`${s} .wma`)?.textContent ?? '') && Boolean(document.querySelector(`${s} [data-code=interrupteur]`)), carteRg(une));
      await p.waitForSelector(`${carteRg(deux)} .wma [data-action=choisir]`);
      assert.deepEqual([rangees().find((w) => w.id === une)?.cible, rangees().find((w) => w.id === deux)?.cible], ['appareil:essai_l2', undefined]);
      if (CAPTURES) await p.screenshot({ path: `${CAPTURES}/pose-trois-${largeur}.png`, fullPage: true });
      assert.deepEqual(erreurs, [], 'aucune erreur dans la page');
    } finally { await ctx.close(); await rangerRg(FENETRE()); }
  });

  test(`navigateur, ${largeur} px : poser « Lumière » avec une seule lumière — prise d'office (au bouton comme au glisser) ; sans aucune lumière, rien n'est posé et le tiroir le dit`, { skip: sansNav }, async () => {
    await rangerRg(FENETRE());
    const { ctx, page: p, erreurs } = await ouvrir(largeur, false);
    try {
      let seule = true;
      await reduire(p, (d) => d.kind !== 'lumière' || (seule && d.id === 'essai_l1'));
      const avant = await cartes(p);
      await modifierP(p); await tiroirP(p);
      // Deux appuis coup sur coup (pendant la lecture des appareils) : un seul widget est posé.
      await p.dblclick('#feTiroir button[aria-label="Ajouter Lumière"]');
      await attendreQue(p, (n: any) => document.querySelectorAll('#feGrid > .fe-w').length === Number(n), String(avant.length + 1));
      await p.waitForTimeout(600);
      assert.equal((await cartes(p)).length, avant.length + 1, 'deux appuis rapides : un seul widget');
      assert.equal(await p.evaluate(() => Boolean(document.querySelector('dialog.wr-regler[open]'))), false, 'aucun choix à faire : « Régler » ne s\'ouvre pas');
      const une = (await cartes(p)).slice(-1)[0];
      // Au glisser : la ligne refaite d'après sa déclaration (une cible glissée d'ailleurs n'est jamais reprise).
      await p.evaluate(() => { const dt = new DataTransfer(); dt.setData('text/odin-module', JSON.stringify({ kind: 'maison_lumiere', cible: 'appareil:essai_l3', c: 12 })); document.querySelector('#feGrid').dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true })); });
      await attendreQue(p, (n: any) => document.querySelectorAll('#feGrid > .fe-w').length === Number(n), String(avant.length + 2));
      const glissee = (await cartes(p)).slice(-1)[0];
      // Aucune lumière : rien n'est posé, la ligne du tiroir le dit.
      seule = false;
      await tiroirP(p); await p.click('#feTiroir button[aria-label="Ajouter Lumière"]');
      await attendreQue(p, () => /Aucune lumière dans la maison/.test([...document.querySelectorAll('#feTiroir .fe-it')].find((n: any) => n.querySelector('b')?.textContent === 'Lumière')?.textContent ?? ''), '');
      assert.equal((await cartes(p)).length, avant.length + 2, 'rien de posé');
      assert.equal(await p.evaluate(() => Boolean(document.querySelector('#feTiroir.open'))), true, 'le tiroir reste ouvert');
      assert.equal(await p.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1 || document.querySelector('#feTiroir').scrollWidth > document.querySelector('#feTiroir').clientWidth + 1), false, 'rien ne déborde');
      if (CAPTURES) await p.screenshot({ path: `${CAPTURES}/pose-aucune-${largeur}.png` });
      await p.keyboard.press('Escape');
      await cliquerTexte(p, '#fenetre button', 'Terminé');
      await attendreQue(p, (s: string) => /Appareil l1/.test(document.querySelector(`${s} .wma`)?.textContent ?? '') && Boolean(document.querySelector(`${s} [data-code=interrupteur]`)), carteRg(une));
      assert.deepEqual([une, glissee].map((id) => rangees().find((w) => w.id === id)?.cible), ['appareil:essai_l1', 'appareil:essai_l1'], 'l\'unique lumière, prise d\'office');
      assert.deepEqual(erreurs, [], 'aucune erreur dans la page');
    } finally { await ctx.close(); await rangerRg(FENETRE()); }
  });
}

test("navigateur, 1280 px : une autre page ouverte pendant la lecture des appareils — rien n'est posé sur elle", { skip: sansNav }, async () => {
  const f = FENETRE(); f.pages.push({ id: 'b3800002', name: 'Deux', widgets: [] } as never); await rangerRg(f);
  const { ctx, page: p, erreurs } = await ouvrir(1280, false);
  try {
    // Une seule lumière, lue lentement (la box sur le réseau) : le temps de changer de page.
    await p.route(/\/api\/maison\/etat/, async (r) => {
      const rep = await r.fetch(), j = await rep.json(); j.rooms = (j.rooms ?? []).map((x: any) => ({ ...x, devices: (x.devices ?? []).filter((d: any) => d.kind !== 'lumière' || d.id === 'essai_l1') }));
      await new Promise((ok) => setTimeout(ok, 1500)); await r.fulfill({ response: rep, json: j });
    });
    const avant = await cartes(p);
    await modifierP(p); await tiroirP(p);
    await p.click('#feTiroir button[aria-label="Ajouter Lumière"]');
    await p.keyboard.press('Escape'); await attendreQue(p, () => !document.querySelector('#feTiroir.open'), '');
    await cliquerTexte(p, '#fenetre .fe-tools .fe-tab', 'Deux');
    await attendreQue(p, () => document.querySelector('#fenetre .fe-tools .fe-tab[aria-pressed="true"]')?.textContent?.trim() === 'Deux', '');
    await p.waitForTimeout(2500);
    assert.deepEqual(await cartes(p), [], 'rien de posé sur la page ouverte entre-temps');
    await cliquerTexte(p, '#fenetre .fe-tools .fe-tab', 'Maison'); await p.waitForTimeout(500);
    assert.deepEqual(await cartes(p), avant, 'ni sur la page de départ');
    assert.deepEqual(erreurs, [], 'aucune erreur dans la page');
  } finally { await ctx.close(); await rangerRg(FENETRE()); }
});

/** Deux petits chiffres de plus sur la page : la température, les appareils allumés. */
const ID_PC = { temp: 'd38000c1', allumes: 'd38000c2' };
const FENETRE_PC = () => { const f = FENETRE(); f.pages[0].widgets.unshift({ id: ID_PC.temp, kind: 'maison_temperature', w: 1, c: 2, r: 1, pr: 1 } as never, { id: ID_PC.allumes, kind: 'maison_allumes', w: 1, c: 2, r: 1, pr: 1 } as never); return f; };
for (const largeur of [390, 1280, 320, 1920, 768] as const) {
  test(`navigateur, ${largeur} px : en mode « Modifier », un petit chiffre a son « ⋯ » (44 px, nommé, au clavier et au doigt) qui ouvre « Régler » ; « Température » choisit sa pièce, le chiffre suit ; sa taille ne change pas`, { skip: sansNav }, async () => {
    // Un second capteur de température, dans une autre pièce (la moyenne n'est plus celle d'une seule pièce).
    annonce('sensor', 't2', { unit_of_measurement: '°C', command_topic: undefined, device: { suggested_area: 'Chambre' } }); await connus(['essai_t2']); etatDe('t2', '18');
    await rangerRg(FENETRE_PC());
    const { ctx, page: p, erreurs } = await ouvrir(largeur, false);
    try {
      const temp = carteRg(ID_PC.temp), allumes = carteRg(ID_PC.allumes), boite = (s: string) => p.evaluate((x: string) => { const r = document.querySelector(x).getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; }, s);
      await attendreQue(p, (s: string) => /Moyenne de 2/.test(document.querySelector(s)?.textContent ?? ''), temp);
      const tailles = [await boite(temp), await boite(allumes)];
      assert.equal(await taille44(p, `${temp} .fe-regp`), null, 'hors du mode « Modifier » : rien de plus');
      await modifierP(p);
      assert.deepEqual([await boite(temp), await boite(allumes)], tailles, 'la taille de la maquette ne change pas');
      for (const s of [temp, allumes]) { const t = await taille44(p, `${s} .fe-regp`); assert.ok(t && t[0] >= 44 && t[1] >= 44, `${s} : 44 px (${t})`); }
      // Il ne couvre ni la poignée ni les autres boutons du mode.
      const chevauche = await p.evaluate((x: string) => { const c = document.querySelector(x), r = c.querySelector('.fe-regp').getBoundingClientRect(); return [...c.querySelectorAll('.fe-grip, .fe-chrome button:not(.fe-regp)')].filter((n: any) => { const q = n.getBoundingClientRect(); return q.width && r.left < q.right - 0.5 && q.left < r.right - 0.5 && r.top < q.bottom - 0.5 && q.top < r.bottom - 0.5; }).map((n: any) => n.className || n.getAttribute('aria-label')); }, temp);
      assert.deepEqual(chevauche, [], 'rien ne se chevauche');
      // Ni l'icône de la carte (ces cartes n'ont pas de titre : l'icône les distingue) ni son texte ne sont couverts.
      for (const s of [temp, allumes]) {
        const couvert = await p.evaluate((x: string) => {
          const c = document.querySelector(x), r = c.querySelector('.fe-regp').getBoundingClientRect(), out: string[] = [];
          const touche = (q: DOMRect) => q.width > 0 && q.height > 0 && r.left < q.right - 0.5 && q.left < r.right - 0.5 && r.top < q.bottom - 0.5 && q.top < r.bottom - 0.5;
          for (const n of c.querySelectorAll('.wmc-ic, .wmc-go')) if (touche(n.getBoundingClientRect())) out.push(n.className);
          const it = document.createTreeWalker(c.querySelector('.wmc') ?? c, NodeFilter.SHOW_TEXT);
          for (let t = it.nextNode(); t; t = it.nextNode()) {
            if (!t.textContent.trim() || t.parentElement.closest('.wr-sr, .fe-chrome')) continue;
            const g = document.createRange(); g.selectNodeContents(t);
            if ([...g.getClientRects()].some(touche)) out.push(t.textContent.trim());
          }
          return out;
        }, s);
        assert.deepEqual(couvert, [], `${s} : le « ⋯ » ne couvre ni l'icône ni le texte`);
      }
      if (CAPTURES) await p.screenshot({ path: `${CAPTURES}/petit-modifier-${largeur}.png` });
      assert.match(await p.evaluate((s: string) => document.querySelector(`${s} .fe-regp`).getAttribute('aria-label'), temp), /Température/, 'son nom est dit aux lecteurs d\'écran');
      assert.equal(await p.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1), false, 'rien ne déborde');
      // Au clavier : Entrée l'ouvre ; « Annuler » rend le focus au même bouton.
      await p.focus(`${temp} .fe-regp`); await p.keyboard.press('Enter');
      await p.waitForSelector('dialog.wr-regler[open] #wrRCi');
      let a = (await regard(p))!;
      assert.equal(a.label, 'Ce qu\'il mesure'); assert.ok(a.valeurs.includes('piece:Chambre') && a.valeurs.includes('piece:Salon'), JSON.stringify(a.valeurs));
      await cliquerTexte(p, 'dialog.wr-regler button', 'Annuler'); await attendreQue(p, () => !document.querySelector('dialog.wr-regler[open]'), '');
      await attendreQue(p, (s: string) => document.activeElement === document.querySelector(`${s} .fe-regp`), temp);
      // Au doigt (ou à la souris) : choisir « Chambre », Valider, Terminé : le chiffre est celui de la Chambre.
      await p.click(`${temp} .fe-regp`); await p.waitForSelector('dialog.wr-regler[open] #wrRCi');
      await choisir(p, 'piece:Chambre'); a = (await regard(p))!; assert.equal(a.deborde, false);
      await cliquerTexte(p, 'dialog.wr-regler button', 'Valider'); await attendreQue(p, () => !document.querySelector('dialog.wr-regler[open]'), '');
      await attendreQue(p, (s: string) => document.activeElement === document.querySelector(`${s} .fe-regp`), temp);
      await cliquerTexte(p, '#fenetre button', 'Terminé');
      await attendreQue(p, (s: string) => /18\s*°C/.test(document.querySelector(s)?.textContent ?? '') && /Chambre/.test(document.querySelector(s)?.textContent ?? ''), temp);
      assert.equal(rangees().find((w) => w.id === ID_PC.temp)?.cible, 'piece:Chambre');
      assert.deepEqual([await boite(temp), await boite(allumes)], tailles, 'toujours la même taille');
      if (CAPTURES) await p.screenshot({ path: `${CAPTURES}/petit-regler-${largeur}.png`, fullPage: true });
      assert.deepEqual(erreurs, [], 'aucune erreur dans la page');
    } finally { await ctx.close(); await rangerRg(FENETRE()); }
  });
}
