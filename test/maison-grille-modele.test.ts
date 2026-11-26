// L'écran de la maison a sa grille, la même que l'accueil (maquette validée « Accueil et Home Assistant ») : ici le
// MODÈLE seul, côté serveur ; rien ne change à l'écran (la page /maison reçoit exactement ce qu'elle recevait).
// - La règle « quelle sorte peut aller sur l'écran de la maison » (widgets/index.ts, admiseALaMaison) : jamais une sorte
//   réservée à l'accueil du propriétaire, jamais une sorte « propriétaire seul » (un écran au mur se lit par toute la
//   maison : même pour sa session, même pour une clé « complet »), jamais une sorte qui lit toujours une appli de la vie
//   privée (« ses alertes »), jamais une sorte inconnue ; les autres selon leur public. Elle est appliquée par droitDeVoir,
//   que l'écran de la maison passe déjà (widgets-api.ts, pagesMaisonPermises) : maison-api.ts ne change pas.
// - Le modèle (gladsheim.ts, grilleMaison) : les cartes d'aujourd'hui (météo, heure, scènes, appareils, dernières
//   nouvelles) deviennent des widgets de la grille, chacun avec toutes ses commandes ; l'écran de départ est calculé
//   d'après ce qui existe : rien d'inventé (ni appareil, ni scène, ni pièce).
// Les appareils sont simulés (des identifiants de box d'essai) : le modèle les lit dans l'état que la page reçoit.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { T } from './banc/lib.ts';
import { vraiOdin, type VraiOdin } from './banc/odin-vrai.ts';
import { allModules, valhallaOf } from '../src/valhalla/odin.ts';
import { lierProprietaire, persona } from '../src/valhalla/sso/etat.ts';
import { GRILLE, TAILLE_SORTE, gladsheim, grilleMaison, type CarteMaison } from '../src/valhalla/modules/gladsheim.ts';
import { haCommand, sensitive } from '../src/valhalla/modules/midgard.ts';
import { APPLIS_VIE_PRIVEE, SORTES, admiseALaMaison, donneeWidget, droitDeVoir, publicDe, sortesPosables, type Lecteur, type SourceWidget } from '../src/valhalla/widgets/index.ts';
import { lecteurMaison, pagesPermises } from '../src/web/widgets-api.ts';

const MAISON_JS = readFileSync(new URL('../src/web/maison.js', import.meta.url), 'utf8');
/** Les sortes « propriétaire seul » qui ne sont pas réservées à l'accueil (agenda, recherches, sauvegardes, pubs bloquées…). */
const SEUL = SORTES.filter((s) => publicDe(s) === 'proprietaire' && !('accueilSeul' in s && s.accueilSeul)).map((s) => s.id as string);
const ACCUEIL = SORTES.filter((s) => 'accueilSeul' in s && s.accueilSeul).map((s) => s.id as string);
/** Les sortes qui lisent toujours une appli de la vie privée (sa question 15) : « ses alertes » (Forseti), son agenda… */
const PRIVEES = SORTES.filter((s) => s.applis !== 'choisie' && s.applis.some((a) => APPLIS_VIE_PRIVEE.includes(a))).map((s) => s.id as string);
/**
 * Les sortes marquées « jamais sur l'écran de la maison », nommées ICI en toutes lettres (pas lues sur la marque, sinon
 * l'essai se vérifierait lui-même) : les raccourcis d'applis (ils ne valent que sur l'accueil), et, par prudence, la
 * santé des disques et le stockage (un écran au mur montrerait les noms de ses disques et de ses partages).
 */
const MARQUEES = ['raccourcis', 'sante_disques', 'stockage'];
/** Tout ce qui ne va jamais sur l'écran de la maison, à personne. */
const JAMAIS = [...new Set([...ACCUEIL, ...SEUL, ...PRIVEES, ...MARQUEES])];

// ---------- La règle ----------
test('la règle : une seule fonction dit quelle sorte peut aller sur l\'écran de la maison', () => {
  assert.ok(SEUL.includes('agenda') && SEUL.includes('recherches'), 'les sortes « propriétaire seul » sont bien lues');
  for (const s of SORTES) {
    const attendu = !JAMAIS.includes(s.id);
    assert.equal(admiseALaMaison(s.id), attendu, s.id);
  }
  for (const k of ['heure', 'meteo', 'chiffres', 'section', 'bouton']) assert.equal(admiseALaMaison(k), true, k);
  for (const k of ['a_faire', 'odin_a_fait', 'tu_veux', 'comportement', ...SEUL]) assert.equal(admiseALaMaison(k), false, k);
  // « Ses alertes » : la liste et le petit chiffre lisent Forseti (vie privée) ; un écran au mur se lit par toute la
  // maison, même ouvert par sa session ou une clé « complet ». Leur public « membre » ne change rien ici.
  assert.ok(PRIVEES.includes('alertes_liste') && PRIVEES.includes('alertes'), `les sortes de la vie privée sont lues : ${PRIVEES}`);
  for (const k of ['alertes', 'alertes_liste']) assert.equal(admiseALaMaison(k), false, k);
  for (const k of ['sites', 'sites_petit']) assert.equal(admiseALaMaison(k), true, `${k} : une appli hors vie privée, selon son public`);
  // Une sorte inconnue : ni exception, ni place.
  for (const k of ['inventee', '', '__proto__', 'constructor', undefined, null, 42, {}]) assert.equal(admiseALaMaison(k), false, String(k));
});

const SRC: Pick<SourceWidget, 'appli'> = { appli: (id) => ({ id, name: id, family: 'Odin' }) };
test('« propriétaire seul » : refusé sur l\'écran de la maison à tout le monde, lui compris ; sur l\'accueil, rien ne change', async () => {
  const lecteurs: Lecteur[] = [{ qui: 'proprietaire', ecran: 'maison' }, lecteurMaison(true), lecteurMaison(false), { qui: 'membre', ecran: 'maison', peutLire: () => true }];
  for (const k of [...SEUL, 'alertes', 'alertes_liste']) {
    const w = { id: 'e4500001', kind: k as never, w: 1 as const, c: 4, r: 3 };
    for (const l of lecteurs) assert.equal(droitDeVoir(w, l, SRC)?.etat, 'refuse', `${k} à ${l.qui} sur ${l.ecran}`);
    if (SEUL.includes(k)) for (const l of lecteurs) assert.deepEqual(droitDeVoir(w, l, SRC), { etat: 'refuse', raison: 'proprietaire_seul' }, `${k} à ${l.qui} sur ${l.ecran}`);
    assert.equal(droitDeVoir(w, { qui: 'proprietaire', ecran: 'accueil' }, SRC), undefined, `${k} : toujours à lui sur l'accueil`);
    // Rien n'est lu : la source plante si on la touche.
    const piege = new Proxy({}, { get: () => { throw new Error(`${k} : lu sur l'écran de la maison`); } }) as SourceWidget;
    assert.deepEqual(await donneeWidget(w, { qui: 'proprietaire', ecran: 'maison' }, piege), { etat: 'refuse', raison: 'proprietaire_seul' }, k);
  }
  // Le filet des pages de l'écran de la maison (pagesPermises) : ni à sa session, ni à une clé « complet », ni à une tablette.
  const page = { id: 'b4500001', name: 'P', maison: true, widgets: [...SEUL, 'alertes', 'alertes_liste'].map((k, i) => ({ id: (0xe4500010 + i).toString(16), kind: k as never, w: 1 as const, c: 4, r: 3 })) };
  const faux = { module: () => undefined, estActive: () => false } as never;
  for (const full of [true, false]) assert.deepEqual((await pagesPermises(faux, [page], lecteurMaison(full), SRC as SourceWidget))[0].widgets, [], `clé ${full ? 'complet' : 'maison'}`);
});

// ---------- Le modèle ----------
test('un Odin neuf : l\'écran de départ n\'a ni appareil, ni scène, ni pièce, ni nouvelle, ni météo inventés', () => {
  for (const e of [{ rooms: [], scenes: [], notices: [], fenetre: [] }, {}, { rooms: null, scenes: 'x', notices: 3, fenetre: {} }] as never[]) {
    const g = grilleMaison(e);
    assert.deepEqual(g.depart.map((c) => c.carte), ['heure'], 'seule l\'heure d\'Odin, qui a toujours sa source');
    assert.deepEqual(g.pages, []);
    assert.deepEqual(g.grille, GRILLE, 'la même grille que l\'accueil');
  }
});

// Des appareils simulés, un de chaque sorte que le pont connaît (midgard.ts), dans deux pièces.
const DOMAINE: Record<string, string> = { 'lumière': 'light', prise: 'switch', capteur: 'sensor', 'détecteur': 'binary_sensor', volet: 'cover', clim: 'climate', lecteur: 'media_player', serrure: 'lock', ventilateur: 'fan', aspirateur: 'vacuum' };
const APPAREILS = Object.entries(DOMAINE).map(([kind, d], i) => ({ id: `ha:${d}.essai_${i}`, name: `Appareil ${i}`, kind, state: '', unit: '' }));
const ETAT = {
  weather: { temp: 1, code: 0 }, scenes: ['Scène 1', 'Scène 2'], notices: [{ id: 'n1', level: 'ok', title: 'Nouvelle 1' }],
  rooms: [{ name: 'Pièce 1', devices: APPAREILS.slice(0, 5) }, { name: 'Pièce 2', devices: APPAREILS.slice(5) }],
  fenetre: [],
};
/** Les commandes de chaque carte d'appareil, telles que l'écran d'aujourd'hui les dessine (maison.js, devCard). */
const ATTENDU: Record<string, string[]> = {
  'lumière': ['interrupteur:on,off', 'intensite:'], prise: ['interrupteur:on,off'], ventilateur: ['interrupteur:on,off'],
  volet: ['monter:ouvre', 'arreter:stop', 'descendre:ferme'], clim: ['consigne:', 'marche_arret:on,off'],
  lecteur: ['precedent:precedent', 'lecture_pause:lecture,pause', 'suivant:suivant'], aspirateur: ['nettoyer:on', 'base:off'],
  serrure: ['ouvrir:deverrouille', 'verrouiller:verrouille'], capteur: [], 'détecteur': [],
};
test('des appareils simulés : chaque carte d\'aujourd\'hui a son widget dans le modèle, avec toutes ses commandes', () => {
  const g = grilleMaison(ETAT as never);
  assert.deepEqual(g.depart.map((c) => c.carte), ['meteo', 'heure', 'scenes', ...APPAREILS.map(() => 'appareil'), 'nouvelles'], 'l\'ordre de l\'écran d\'aujourd\'hui');
  const parId = new Map(g.depart.map((c) => [c.id, c]));
  assert.equal(parId.size, g.depart.length, 'un identifiant par widget');
  for (const [i, d] of APPAREILS.entries()) {
    const c = g.depart.find((x) => x.appareil === d.id) as CarteMaison;
    assert.ok(c, `${d.kind} : son widget`);
    assert.equal(c.piece, i < 5 ? 'Pièce 1' : 'Pièce 2');
    assert.equal(c.route, 'appareil');
    assert.deepEqual(c.commandes.map((x) => `${x.code}:${x.ordres.join(',')}`), ATTENDU[d.kind], `${d.kind} : ses commandes`);
    // Chaque ordre est compris par le pont vers la box (haCommand), y compris un nombre au bout d'un curseur.
    for (const x of c.commandes) {
      for (const o of x.ordres) assert.doesNotThrow(() => haCommand(d.id.slice(3), o), `${d.kind} : « ${o} »`);
      if (x.nombre) { const n = x.nombre.min ?? 1; assert.doesNotThrow(() => haCommand(d.id.slice(3), x.nombre!.ordre.replace('{n}', String(n))), `${d.kind} : ${x.nombre.ordre}`); }
    }
  }
  // La serrure : ouvrir demande toujours l'accord d'Odin (le serveur le redit à chaque ordre) ; verrouiller, non.
  const serrure = g.depart.find((x) => x.appareil === 'ha:lock.essai_7')!;
  assert.equal(serrure.commandes.find((x) => x.code === 'ouvrir')?.accord, true); assert.ok(sensitive('ha:lock.essai_7', 'deverrouille'));
  assert.equal(serrure.commandes.find((x) => x.code === 'verrouiller')?.accord, undefined); assert.equal(sensitive('ha:lock.essai_7', 'verrouille'), undefined);
  // Aucun nombre de départ inventé : un curseur n'a pas de valeur, seulement ses bornes.
  assert.ok(!JSON.stringify(g).includes('"valeur"'), 'pas de valeur de départ');
  // La météo : sans droits « complet » dans l'état, aucune commande (l'écran d'aujourd'hui ne montre rien d'autre).
  assert.deepEqual(g.depart.find((x) => x.carte === 'meteo')!.commandes, []);
  // Les scènes : celles de son Odin, lancées d'un appui ; rien d'autre.
  const sc = g.depart.find((x) => x.carte === 'scenes')!;
  assert.equal(sc.route, 'scene'); assert.deepEqual(sc.commandes, [{ code: 'lancer', ordres: ['Scène 1', 'Scène 2'] }]);
  // Toute commande d'une carte d'appareil de l'écran d'aujourd'hui est dans le modèle (lu dans maison.js, devCard).
  const dessin = MAISON_JS.slice(MAISON_JS.indexOf('function devCard'), MAISON_JS.indexOf('function home()'));
  const ordres = new Set(g.depart.flatMap((c) => c.commandes.flatMap((x) => x.ordres)));
  const litteraux = [...dessin.matchAll(/toggle\(([^)]*)\)/g)].flatMap((m) => [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]));
  assert.ok(new Set(litteraux).size >= 11, `la lecture de maison.js a trouvé les commandes : ${litteraux}`);
  for (const o of litteraux) assert.ok(ordres.has(o), `« ${o} » (maison.js) est dans le modèle`);
  // Les tailles : dans la grille de 12 colonnes ; les cartes larges d'aujourd'hui (w2) en prennent 8, les autres 4.
  for (const c of g.depart) { assert.ok(Number.isInteger(c.c) && c.c >= 1 && c.c <= GRILLE.colonnes, c.id); assert.ok(Number.isInteger(c.r) && c.r >= 1 && c.r <= GRILLE.lignesMax, c.id); }
  const large = (c: CarteMaison) => c.carte === 'scenes' || c.carte === 'nouvelles' || c.appareil === 'ha:lock.essai_7' || c.appareil === 'ha:media_player.essai_6';
  for (const c of g.depart.filter((x) => x.carte === 'appareil' || x.carte === 'scenes' || x.carte === 'nouvelles')) assert.equal(c.c, large(c) ? 8 : 4, c.id);
  assert.equal(g.depart[0].r, TAILLE_SORTE.meteo.r); assert.equal(g.depart[1].r, TAILLE_SORTE.heure.r);
  // Rien d'inventé : chaque pièce et chaque appareil viennent de l'état reçu.
  assert.deepEqual([...new Set(g.depart.flatMap((c) => (c.piece ? [c.piece] : [])))], ['Pièce 1', 'Pièce 2']);
  assert.equal(g.depart.filter((c) => c.carte === 'appareil').length, APPAREILS.length);
});

test('la carte météo : « Changer de lieu » et « Me localiser », seulement pour qui a tous les droits (maison.js, lieuBar)', () => {
  const lieu = [{ code: 'lieu', ordres: [], acte: { module: 'gladsheim', action: 'lieu', saisie: 'ville' } }, { code: 'me_localiser', ordres: [], acte: { module: 'gladsheim', action: 'lieu_position' } }];
  assert.deepEqual(grilleMaison({ ...ETAT, rights: 'complet' } as never).depart.find((x) => x.carte === 'meteo')!.commandes, lieu);
  for (const rights of ['maison', undefined, 'COMPLET', 1]) assert.deepEqual(grilleMaison({ ...ETAT, rights } as never).depart.find((x) => x.carte === 'meteo')!.commandes, [], String(rights));
  // Les actions nommées existent dans Hestia, et l'écran d'aujourd'hui les appelle avec ces mêmes mots.
  for (const c of lieu) assert.ok(gladsheim.actions.some((a) => a.id === c.acte.action), c.acte.action);
  const dessin = MAISON_JS.slice(MAISON_JS.indexOf('function lieuBar'), MAISON_JS.indexOf('function weatherCard'));
  for (const a of ["dire('lieu',", "dire('lieu_position',", "'complet'"]) assert.ok(dessin.includes(a), a);
  // Sans météo lue : pas de carte météo, donc pas de commande.
  assert.ok(!grilleMaison({ rights: 'complet' } as never).depart.some((x) => x.carte === 'meteo'));
});

test('les pages « écran de la maison » dans le modèle : jamais une sorte réservée, « propriétaire seul » ou inconnue', () => {
  const ws = ['heure', 'a_faire', ...SEUL, 'alertes', 'alertes_liste', 'inventee', 'bouton'].map((k, i) => ({ id: (0xe4500100 + i).toString(16), kind: k, w: 1, c: 4, r: 2, title: `MARQUE-${k}` }));
  const g = grilleMaison({ fenetre: [{ id: 'b4500002', name: 'Maison', widgets: ws }, 'abîmée', { id: 'b4500003' }] } as never);
  assert.deepEqual(g.pages.map((p) => p.widgets.map((w) => w.kind)), [['heure', 'bouton'], []]);
  const corps = JSON.stringify(g);
  for (const k of ['a_faire', ...SEUL, 'alertes', 'alertes_liste', 'inventee']) assert.ok(!corps.includes(`MARQUE-${k}`), `${k} : ni titre, ni donnée`);
});

// ---------- La route /api/maison/etat, avec un vrai Odin d'essai ----------
const tt = new T(), orig = { log: console.log, error: console.error, warn: console.warn };
const MDP = 'une-barque-lente-au-bord-du-lac-62';
let v: VraiOdin, membre = '', cleMaison = '', cleComplet = '';
const brut = async (h: Record<string, string>) => { const r = await fetch(`${v.url}/api/maison/etat`, { headers: h }); return { status: r.status, text: await r.text() }; };
const publics = () => ({ proprietaire: { cookie: v.session }, complet: { 'x-odin-maison': cleComplet }, maison: { 'x-odin-maison': cleMaison }, membre: { cookie: membre } }) as Record<string, Record<string, string>>;
before(async () => {
  for (const k of ['log', 'error', 'warn'] as const) console[k] = () => {};
  v = await vraiOdin(tt, { compte: true, modules: (o) => allModules(o).filter((m) => ['var', 'gladsheim', 'midgard'].includes(m.id)) });
  const va = valhallaOf()!;
  assert.equal((await va.act('var', 'ajouter', { login: 'membre-b', nom: 'Membre B', groupes: 'invite', mot_de_passe: MDP })).ok, true);
  for (const appli of ['odin', 'gladsheim']) assert.equal((await va.act('var', 'donner_acces', { appli, qui: '@membre-b' })).ok, true);
  lierProprietaire(persona()!);
  let r = await fetch(`${v.url}/sso/odin`, { redirect: 'manual' });
  r = await fetch(new URL(r.headers.get('location')!, v.url), { redirect: 'manual' }); const demande = /name="demande" value="([^"]+)"/.exec(await r.text())![1];
  r = await fetch(`${v.url}/sso/autoriser`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded', origin: v.url }, body: new URLSearchParams({ demande, identifiant: 'membre-b', motdepasse: MDP }) });
  r = await fetch(r.headers.get('location')!, { redirect: 'manual' });
  membre = r.headers.getSetCookie().find((c) => c.startsWith('odin_session='))?.split(';')[0] ?? ''; assert.ok(membre, 'session du membre');
  cleMaison = ((await va.act('gladsheim', 'cle_tablette', { nom: 'Tablette maison', droits: 'maison' })).data as { key: string }).key;
  cleComplet = ((await va.act('gladsheim', 'cle_tablette', { nom: 'Tablette complet', droits: 'complet' })).data as { key: string }).key;
  assert.ok(cleMaison && cleComplet);
});
after(async () => { await tt.end(); Object.assign(console, orig); });

test('un vrai Odin neuf : le modèle tiré de l\'état n\'a ni appareil ni scène, pour aucun public', async () => {
  for (const [qui, h] of Object.entries(publics())) {
    const r = await brut(h); if (qui === 'membre') { assert.ok(r.status === 401 || r.status === 403, `membre : ${r.status}`); continue; }
    assert.equal(r.status, 200, qui);
    const g = grilleMaison(JSON.parse(r.text));
    assert.ok(!g.depart.some((c) => c.carte === 'appareil' || c.carte === 'scenes'), `${qui} : ${g.depart.map((c) => c.carte)}`);
  }
});

test('une page « écran de la maison » avec toutes les sortes : chaque public reçoit ce qu\'il recevait, et jamais une sorte « propriétaire seul »', async () => {
  const va = valhallaOf()!;
  assert.equal((await va.act('midgard', 'creer_scene', { nom: 'Scène essai', etapes: 'Appareil essai = on' })).ok, true);
  const widgets = sortesPosables().map((s, i) => ({ id: (0xc4500000 + i).toString(16), kind: s.id, w: 1, label: `MARQUE-${s.id}`, ...(s.applis === 'choisie' ? { module: 'midgard' } : {}), ...(s.id === 'section' ? { section: 'Scènes' } : {}), ...(s.id === 'bouton' ? { action: 'scene', input: { scene: 'Scène essai' } } : {}) }));
  const f = await va.act('gladsheim', 'regler_fenetre', { fenetre: JSON.stringify({ pages: [{ id: 'b4500004', name: 'Maison', maison: true, widgets }] }) });
  assert.equal(f.ok, true, f.text);
  const servies = (t: string) => (JSON.parse(t).fenetre as Array<{ widgets: Array<{ kind: string }> }>).flatMap((p) => p.widgets.map((w) => w.kind));
  const avant: Record<string, { status: number; text: string }> = {};
  for (const [qui, h] of Object.entries(publics())) {
    const r = avant[qui] = await brut(h);
    if (qui === 'membre') { assert.ok(r.status === 401 || r.status === 403, `membre : ${r.status}`); continue; }
    assert.equal(r.status, 200, qui);
    // Ce que l'écran d'aujourd'hui sait dessiner, et rien de plus (le même pour les trois : la règle d'aujourd'hui).
    assert.deepEqual(servies(r.text), ['heure', 'meteo', 'chiffres', 'section', 'bouton'], qui);
    for (const k of JAMAIS) assert.ok(!r.text.includes(`MARQUE-${k}`), `${qui} : rien de « ${k} »`);
    const g = grilleMaison(JSON.parse(r.text));
    assert.ok(g.pages.flatMap((p) => p.widgets).every((w) => admiseALaMaison(w.kind)), qui);
    assert.deepEqual(g.depart.filter((c) => c.carte === 'scenes').map((c) => c.commandes[0].ordres), [['Scène essai']], `${qui} : la vraie scène, rien d'autre`);
  }
  // Une sorte inconnue écrite dans la fenêtre rangée (une donnée abîmée) : rien ne casse, et la réponse ne change pas.
  const g = va.ctx('gladsheim'), fen = g.settings.fenetre as { pages: Array<{ widgets: unknown[] }> };
  g.saveSettings({ fenetre: { ...fen, pages: fen.pages.map((p) => ({ ...p, widgets: [...p.widgets, { id: 'c45000ff', kind: 'inventee', w: 1, c: 4, r: 2, label: 'MARQUE-inventee' }] })) } });
  const sansAt = (t: string) => t.replace(/"at":\d+/g, '"at":0');
  for (const [qui, h] of Object.entries(publics())) {
    const r = await brut(h);
    assert.equal(r.status, avant[qui].status, qui); assert.equal(sansAt(r.text), sansAt(avant[qui].text), `${qui} : la même réponse`);
    assert.ok(!r.text.includes('MARQUE-inventee'));
  }
});
