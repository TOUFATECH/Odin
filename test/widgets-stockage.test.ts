// Le widget « Stockage » de l'accueil (maquette validée « Accueil », la carte de Pyramide), son style de départ
// « Lignes » : la famille « stockage » (src/valhalla/widgets/stockage.ts, src/web/pages/widgets-stockage.js).
// - La machine d'Odin seulement : le remplissage et la place libre de chaque volume, ses partages, ses disques, tels que
//   Pyramide les lit ; un volume presque plein passe devant ; « et N de plus » si tout ne tient pas.
// - Jamais un zéro à la place d'une absence : sous Windows (Pyramide n'y lit pas les disques), « source_absente » avec son
//   code, aucun « 0 % » ; aucun volume lu : pareil. Aucun partage : dit simplement.
// - Qui voit quoi : le propriétaire, un membre qui a le droit sur Pyramide ; un membre sans ce droit, une tablette
//   « maison », une clé d'accès, une requête sans session : refusés, sans un nom ni une valeur.
// - Un nom piégé (du HTML, très long) reste du texte borné ; la taille s'écrit avec son unité et les nombres de la langue
//   de la page ; 390, 768 et 1280 px, clair et sombre (le thème d'Odin) ; 320 et 1920 px sans débordement ; rien coupé
//   au bord d'une carte (autant de volumes que sa hauteur réelle en tient) ; « presque plein » écrit sur sa ligne.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { after, before, test } from 'node:test';
import vm from 'node:vm';
import { TAILLE_SORTE, type Widget } from '../src/valhalla/modules/gladsheim.ts';
import { allModules, valhallaOf } from '../src/valhalla/odin.ts';
import { lierProprietaire, persona } from '../src/valhalla/sso/etat.ts';
import { donneeWidget, publicDe, sorteDe, type EtatWidget, type Lecteur, type SourceWidget } from '../src/valhalla/widgets/index.ts';
import { T as Banc } from './banc/lib.ts';
import { vraiOdin, type VraiOdin } from './banc/odin-vrai.ts';

const lire = (f: string) => { try { return readFileSync(new URL(`../${f}`, import.meta.url), 'utf8'); } catch { return ''; } };
const RENDU = lire('src/web/pages/widgets-rendu.js'), STOCK = lire('src/web/pages/widgets-stockage.js'), GRILLE = lire('src/web/pages/accueil-grille.js');
const W = (o: Record<string, unknown> = {}): Widget => ({ id: 'c8e00000', kind: 'stockage', w: 2, c: 5, r: 4, ...o }) as unknown as Widget;
const LUI: Lecteur = { qui: 'proprietaire', ecran: 'accueil' }, TABLETTE: Lecteur = { qui: 'maison', ecran: 'maison' };
const membre = (droits: string[]): Lecteur => ({ qui: 'membre', ecran: 'accueil', peutLire: (a) => droits.includes(a), ouverts: new Set() });
const MAINT = 1_800_000_000_000, Go = 1024 ** 3, To = 1024 ** 4;
type Etat = EtatWidget & { raison?: string; donnee?: Record<string, unknown>; at?: number; appli?: string };
const etat = async (w: Widget, l: Lecteur, src: SourceWidget) => (await donneeWidget(w, l, src)) as Etat;
type Lu = { systeme: string; disques?: unknown; volumes?: unknown; partages?: unknown };
const vol = (monte: string, taille: number, utilise: number, libre = taille - utilise) => ({ fs: 'ext4', taille, utilise, libre, monte });

/** Une fausse source : ce que Pyramide a lu de la machine d'Odin (null : Pyramide ne répond pas ; absente : pas lue). */
function fausse(o: { lu?: Lu | null; pyramide?: boolean; sansLecture?: boolean } = {}): SourceWidget {
  return {
    appli: (id) => (id === 'fensalir' && o.pyramide !== false ? { id, name: 'Appli stockage', family: 'Machines' } : undefined),
    vue: async () => null, action: () => undefined, meteo: async () => undefined,
    lieu: () => ({ choisi: true, nom: 'Lieu A', fuseau: 'UTC', heure12: false }), maintenant: () => MAINT,
    ...(o.sansLecture ? {} : { stockage: async () => (o.lu === null ? undefined : (o.lu ?? { systeme: 'linux', disques: [], volumes: [], partages: [] }) as never) }),
  };
}
const LINUX: Lu = {
  systeme: 'linux',
  volumes: [vol('/', 100 * Go, 50 * Go), vol('/srv/media', 4 * To, 3.8 * To, 0.15 * To), vol('/boot', Go, 0.1 * Go)],
  disques: [{ nom: 'sda', taille: 512 * Go, ssd: true, amovible: false, modele: 'Modele-secret', serie: 'SERIE-SECRETE', parts: [] }, { nom: 'sdb', taille: 4 * To, ssd: false, amovible: false, parts: [] }],
  partages: [{ nom: 'Partage A', chemin: '/srv/chemin-secret', lecture: true, invites: false, utilisateurs: 'compte-secret', type: 'samba' }, { nom: 'export-b', chemin: '/srv/export-secret', lecture: false, invites: false, type: 'nfs', clients: '192.0.2.0/24(rw)' }],
};

// ------------------------------------------------------------------ le serveur, sans Odin

test('la sorte : famille « stockage », Pyramide, tailles de la maquette (5 × 4, 3 × 2 au moins), style de départ « Lignes », suit le droit sur l\'appli, jamais à une tablette', () => {
  const s = sorteDe('stockage');
  assert.ok(s, 'déclarée'); assert.equal(s.famille, 'stockage'); assert.equal(s.posable, true);
  assert.deepEqual([[...s.taille.mini], s.taille.r, s.applis, [...s.styles]], [[3, 2], 4, ['fensalir'], ['lignes']]);
  assert.equal(publicDe(s), 'membre', 'un membre qui a le droit sur Pyramide');
  assert.deepEqual((TAILLE_SORTE as Record<string, unknown>).stockage, { mini: [3, 2], r: 4 }, 'la taille gardée par Hestia');
});

test('Windows (Pyramide n\'y lit pas les disques) : « source_absente » avec son code, aucun « 0 % », aucun disque', async () => {
  const e = await etat(W(), LUI, fausse({ lu: { systeme: 'autre', disques: [], volumes: [], partages: [] } }));
  assert.deepEqual(e, { etat: 'source_absente', raison: 'systeme_pas_encore_lu' });
  // Même si une lecture de travers rendait des volumes : rien n'est montré sur un système que Pyramide ne lit pas.
  const e2 = await etat(W(), LUI, fausse({ lu: { systeme: 'autre', volumes: [vol('C:', 100 * Go, 0)] } }));
  assert.deepEqual(e2, { etat: 'source_absente', raison: 'systeme_pas_encore_lu' });
  // Aucun volume lu sur Linux (df a échoué) : pareil, jamais un « 0 % ».
  assert.deepEqual(await etat(W(), LUI, fausse()), { etat: 'source_absente', raison: 'lecture_echouee' });
  assert.deepEqual(await etat(W(), LUI, fausse({ lu: { systeme: 'linux', volumes: [vol('/', 0, 0)] } })), { etat: 'source_absente', raison: 'lecture_echouee' }, 'une taille nulle n\'est pas une mesure');
  // Pyramide désactivée, qui ne répond pas, ou une source qui ne sait pas lire.
  assert.deepEqual(await etat(W(), LUI, fausse({ pyramide: false, lu: LINUX })), { etat: 'source_absente', raison: 'appli_absente' });
  assert.deepEqual(await etat(W(), LUI, fausse({ lu: null })), { etat: 'source_absente', raison: 'appli_muette' });
  assert.deepEqual(await etat(W(), LUI, fausse({ sansLecture: true })), { etat: 'source_absente', raison: 'pas_encore_lu' });
});

test('Linux : le remplissage et la place libre de chaque volume, le presque plein devant ; les disques et les partages, sans chemin, compte ni numéro de série', async () => {
  const e = await etat(W(), LUI, fausse({ lu: LINUX })), d = e.donnee as Record<string, any>;
  assert.equal(e.etat, 'ok'); assert.equal(e.at, MAINT);
  assert.deepEqual(d.volumes.map((v: any) => v.nom), ['/srv/media', '/', '/boot'], 'le plus rempli d\'abord');
  assert.deepEqual(d.volumes[0], { nom: '/srv/media', taille: 4 * To, utilise: 3.8 * To, libre: 0.15 * To });
  assert.deepEqual([d.taille, d.utilise, d.libre], [4 * To + 101 * Go, 3.8 * To + 50.1 * Go, 0.15 * To + 50 * Go + 0.9 * Go]);
  assert.deepEqual([d.volumesTotal, d.disquesTotal, d.partagesTotal], [3, 2, 2]);
  assert.deepEqual(d.disques, [{ nom: 'sda', taille: 512 * Go, ssd: true, amovible: false }, { nom: 'sdb', taille: 4 * To, ssd: false, amovible: false }]);
  assert.deepEqual(d.partages, [{ nom: 'Partage A', type: 'samba' }, { nom: 'export-b', type: 'nfs' }]);
  assert.ok(!/secret|SECRET|192\.0\.2/.test(JSON.stringify(e)), 'ni chemin de partage, ni compte, ni modèle, ni numéro de série');
  // Zéro partage : un vrai résultat (ok), jamais une absence.
  const z = await etat(W(), LUI, fausse({ lu: { ...LINUX, partages: [] } }));
  assert.equal(z.etat, 'ok'); assert.deepEqual([(z.donnee as any).partages, (z.donnee as any).partagesTotal], [[], 0]);
  // Un Mac (df, sans lsblk) : les volumes, aucun disque.
  const mac = await etat(W(), LUI, fausse({ lu: { systeme: 'mac', volumes: [vol('/', 500 * Go, 100 * Go)], disques: [], partages: [] } }));
  assert.equal(mac.etat, 'ok'); assert.equal((mac.donnee as any).disquesTotal, 0);
});

test('lectures de travers et trop nombreuses : bornées, jamais plus que plein ; vingt servies et le total ; un nom piégé reste du texte borné', async () => {
  const PIEGE = `<img src=x onerror="alert(1)">${'x'.repeat(500)}`;
  const e = await etat(W(), LUI, fausse({ lu: { systeme: 'linux', volumes: [vol(PIEGE, 10 * Go, 20 * Go, 30 * Go), { monte: '/x', taille: Number.NaN, utilise: 1, libre: 1 }, { monte: '/y', taille: 5, utilise: -1, libre: 1 }, 'rien', null], disques: [{ nom: 'sdz', taille: -3 }], partages: [{ nom: 'p', type: 'autre' }, { nom: 3, type: 'samba' }] } }));
  const d = e.donnee as Record<string, any>;
  assert.equal(e.etat, 'ok');
  assert.equal(d.volumes.length, 1); assert.equal(d.volumes[0].nom, PIEGE.slice(0, 200), 'coupé à 200 signes, tel quel');
  assert.deepEqual([d.volumes[0].utilise, d.volumes[0].libre], [10 * Go, 10 * Go], 'jamais plus que la taille');
  assert.deepEqual([d.disques, d.partages], [[], []]);
  const beaucoup = await etat(W(), LUI, fausse({ lu: { systeme: 'linux', volumes: Array.from({ length: 25 }, (_, i) => vol(`/v${i}`, 100 * Go, i * Go)), partages: Array.from({ length: 23 }, (_, i) => ({ nom: `p${i}`, type: 'samba' })) } }));
  const b = beaucoup.donnee as Record<string, any>;
  assert.deepEqual([b.volumes.length, b.volumesTotal, b.partages.length, b.partagesTotal], [20, 25, 20, 23]);
  assert.equal(b.volumes[0].nom, '/v24', 'le plus rempli d\'abord, même au-delà de vingt');
  assert.equal(b.taille, 25 * 100 * Go, 'le total compte tous les volumes');
});

test('qui voit quoi : un membre sans le droit sur Pyramide, une tablette (même sur l\'accueil) : refusés sans un nom ni une valeur ; un membre avec le droit : la donnée', async () => {
  const src = fausse({ lu: LINUX });
  for (const [qui, l] of [['membre sans le droit', membre(['gladsheim'])], ['tablette', TABLETTE], ['tablette sur l\'accueil', { qui: 'maison', ecran: 'accueil' } as Lecteur]] as const) {
    const r = await etat(W(), l, src);
    assert.equal(r.etat, 'refuse', qui);
    assert.ok(!/srv|sda|Partage|Go|\d{4,}/.test(JSON.stringify(r)), `${qui} : ni nom ni valeur (${JSON.stringify(r)})`);
  }
  assert.equal((await etat(W(), membre(['fensalir']), src)).etat, 'ok', 'un membre avec le droit sur Pyramide');
  // La lecture seule refuse aussi une tablette ; jamais sur l'écran de la maison pour une tablette.
  const direct = await sorteDe('stockage')!.lire!(W(), src, TABLETTE) as Etat;
  assert.equal(direct.etat, 'refuse'); assert.ok(!/srv|sda/.test(JSON.stringify(direct)));
  // L'écran de la maison (la session du propriétaire, une clé complète) : à trancher par le propriétaire, rien ne sert ce
  // widget là aujourd'hui ; cet essai ne fige donc pas la règle (une tablette reste refusée, plus haut).
});

// ------------------------------------------------------------------ la page, sans navigateur

const fenetreVm = () => {
  const win: Record<string, any> = {};
  for (const src of [STOCK, RENDU, GRILLE]) vm.runInNewContext(src, { window: win });
  return win;
};
const ici = <X>(x: X): X => JSON.parse(JSON.stringify(x));

test('la page : la famille se déclare (Pyramide, pas propriétaire seul, taille de la maquette 5 × 4) ; la grille connaît sa taille', () => {
  const win = fenetreVm(), R = win.OdinWidgetsRendu, G = win.OdinGrille;
  const x = R.rendu('stockage');
  assert.deepEqual(ici([x?.sorte, x?.titre, x?.appli, x?.proprio]), ['stockage', 'Stockage', 'fensalir', false]);
  assert.deepEqual(ici([x.w.c, x.w.r]), [5, 4], 'posé à la taille de la maquette');
  assert.deepEqual(ici(R.posables({ proprio: false, aDroit: (a: string) => a === 'fensalir' }).filter((y: any) => y.famille === 'stockage').map((y: any) => y.nom)), ['Stockage'], 'proposé à un membre qui a le droit');
  assert.deepEqual(ici(R.posables({ proprio: false, aDroit: () => false }).filter((y: any) => y.famille === 'stockage')), [], 'pas sans le droit');
  assert.deepEqual([[...G.MINI.stockage], G.HAUTEUR.stockage], [[...sorteDe('stockage')!.taille.mini], sorteDe('stockage')!.taille.r], 'les tables de la grille suivent le serveur');
  // Le texte d'une donnée : jamais par innerHTML (seules les icônes dessinées ici le sont).
  assert.deepEqual([...STOCK.matchAll(/innerHTML\s*=\s*([^;]+);/g)].map((m) => m[1].trim()), ['icone(k)']);
  // Aucune langue ni aucun fuseau écrits dans le fichier : ceux de la page.
  assert.ok(!new RegExp(`${'fr'}-FR|timeZone`).test(STOCK));
  // Aucune action : seulement « Ouvrir » (aucun appel à une route, aucun formulaire).
  assert.doesNotMatch(STOCK, /fetch\(|\/api\/|<form|ajouter_partage|retirer_partage/);
});

test('la page : une taille avec l\'unité juste et les nombres de la langue de la page ; une part en pour cent ; rien d\'inventé', () => {
  const S = fenetreVm().OdinWidgetsStockage;
  assert.equal(S.taille(1.5 * To, 'en'), '1.5 TB');
  assert.equal(S.taille(1.5 * To, 'de'), '1,5 TB');
  assert.equal(S.taille(640 * Go, 'en'), '640 GB');
  assert.equal(S.taille(200 * 1024 ** 2, 'en'), '200 MB');
  assert.equal(S.taille(Number.NaN, 'en'), '');
  assert.equal(S.taille(-1, 'en'), '');
  assert.equal(S.part(0.954, 'en'), '95%');
  assert.equal(S.part(Number.NaN, 'en'), '');
  // Jamais « 100 % » pour un volume qui n'est pas plein, jamais « 0 % » pour un volume qui ne l'est pas : une décimale.
  assert.equal(S.part(0.996, 'en'), '99.6%');
  assert.equal(S.part(0.9999, 'en'), '99.9%');
  assert.equal(S.part(0.003, 'en'), '0.3%');
  assert.equal(S.part(0.00001, 'en'), '0.1%');
  assert.deepEqual([S.part(1, 'en'), S.part(0, 'en')], ['100%', '0%']);
  assert.match(S.part(0.996, 'de'), /^99,6\s%$/u, 'les nombres de la langue');
  // Le presque plein : au-delà de 90 % (la règle de Pyramide), à surveiller au-delà de 75 %.
  assert.deepEqual([S.ton(0.95), S.ton(0.8), S.ton(0.5)], ['plein', 'attention', 'bon']);
  // Une donnée lue sans confiance.
  assert.equal(S.volumeLu({ nom: 'a', taille: 0, utilise: 0, libre: 0 }), null);
  assert.equal(S.volumeLu({ nom: 3, taille: 1, utilise: 0, libre: 1 }), null);
  assert.deepEqual(ici(S.volumeLu({ nom: '/', taille: 10, utilise: 20, libre: 0 })), { nom: '/', taille: 10, utilise: 10, libre: 0 });
});

test('la page : la carte dessinée (sans navigateur, un faux document) ne montre jamais un zéro inventé', () => {
  // Une donnée illisible (aucun volume) : rien d'affirmé, la page laisse l'hôte dire qu'elle ne sait pas.
  const win = fenetreVm(), R = win.OdinWidgetsRendu, S = win.OdinWidgetsStockage;
  const rf = R.rendu('stockage');
  assert.ok(rf && S, 'déclarée');
  assert.equal(R.dessineElleMeme(rf, { etat: 'source_absente', donnee: false }), false, 'source_absente : la phrase de l\'hôte');
  // « ok » sans volume lisible (ou avec une taille nulle) : la famille ne dessine rien (aucun document touché).
  for (const donnee of [{}, { volumes: [], taille: 0, utilise: 0, libre: 0 }, { volumes: [{ nom: '/', taille: 0, utilise: 0, libre: 0 }], taille: 0, utilise: 0, libre: 0 }])
    assert.equal(S.dessiner({ etat: 'ok', at: MAINT, donnee }, { w: { kind: 'stockage', c: 5, r: 4 }, ecran: 'accueil' }), null, JSON.stringify(donnee));
});

// ------------------------------------------------------------------ un vrai Odin d'essai

const tt = new Banc(), orig = { log: console.log, error: console.error, warn: console.warn, info: console.info };
let v: VraiOdin, avecDroit = '', sansDroit = '', cleMaison = '';
const MDP = 'une-pirogue-sur-le-lagon-calme';
const IDS = ['gladsheim', 'var', 'fensalir'];
const cookieDe = (r: Response, nom: string) => r.headers.getSetCookie().find((c) => c.startsWith(`${nom}=`))?.split(';')[0] ?? '';
async function entrer(ident: string, mdp: string): Promise<string> {
  let r = await fetch(`${v.url}/sso/odin`, { redirect: 'manual' }); assert.equal(r.status, 303);
  r = await fetch(new URL(r.headers.get('location')!, v.url), { redirect: 'manual' }); const demande = /name="demande" value="([^"]+)"/.exec(await r.text())![1];
  r = await fetch(`${v.url}/sso/autoriser`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded', origin: v.url }, body: new URLSearchParams({ demande, identifiant: ident, motdepasse: mdp }) });
  r = await fetch(r.headers.get('location')!, { redirect: 'manual' }); assert.equal(r.status, 303, 'session ouverte');
  return cookieDe(r, 'odin_session');
}
const PAGE = 'b8e00001', ID = { grand: 'c8e00001', mini: 'c8e00002', sansPartage: 'c8e00003', large: 'c8e00004', etroit: 'c8e00005', sansGrand: 'c8e00006' };
const SANS_PARTAGE = [ID.sansPartage, ID.sansGrand];
const FENETRE = () => ({ pages: [{ id: PAGE, name: 'Stockage', widgets: [
  { id: ID.grand, kind: 'stockage', w: 2, c: 5, r: 4 }, { id: ID.mini, kind: 'stockage', w: 1, c: 3, r: 2 },
  { id: ID.sansPartage, kind: 'stockage', w: 1, c: 4, r: 3 }, { id: ID.large, kind: 'stockage', w: 3, c: 12, r: 3 },
  // Une carte étroite et haute (3 × 4), et une grande carte sans partage (5 × 4 : la phrase du bas).
  { id: ID.etroit, kind: 'stockage', w: 1, c: 3, r: 4 }, { id: ID.sansGrand, kind: 'stockage', w: 2, c: 5, r: 4 },
] }] });
type Rendue = { id: string; kind: string; etat: string; raison?: string; donnee?: Record<string, unknown> };
const donnees = async (h: Record<string, string> = {}) => { const r = await v.json(`/api/widgets/donnees?page=${PAGE}`, undefined, h); return { status: r.status, corps: JSON.stringify(r.body), de: (id: string) => ((r.body.widgets as Rendue[] | undefined) ?? []).find((x) => x.id === id) }; };

before(async () => {
  for (const k of ['log', 'error', 'warn', 'info'] as const) console[k] = () => {};
  v = await vraiOdin(tt, { compte: true, modules: (o) => allModules(o).filter((m) => [...IDS, 'apparence'].includes(m.id)) });
  const va = valhallaOf()!;
  assert.ok(va.module('fensalir'), 'Pyramide est une appli de cet Odin');
  // Deux membres : l'un AVEC le droit sur Pyramide, l'autre sans.
  for (const [login, applis] of [['membre-s', ['odin', 'gladsheim', 'fensalir']], ['membre-n', ['odin', 'gladsheim']]] as const) {
    assert.equal((await va.act('var', 'ajouter', { login, nom: `Membre ${login.slice(-1)}`, groupes: 'invite', mot_de_passe: MDP })).ok, true);
    for (const appli of applis) assert.equal((await va.act('var', 'donner_acces', { appli, qui: `@${login}` })).ok, true);
  }
  lierProprietaire(persona()!);
  avecDroit = await entrer('membre-s', MDP); sansDroit = await entrer('membre-n', MDP);
  assert.ok(avecDroit && sansDroit, 'les membres ont une session');
  cleMaison = ((await va.act('gladsheim', 'cle_tablette', { nom: 'Tablette maison', droits: 'maison' })).data as { key: string }).key;
  const r = await va.act('gladsheim', 'regler_fenetre', { fenetre: JSON.stringify(FENETRE()) }); assert.equal(r.ok, true, r.text);
});
after(async () => { await tt.end(); Object.assign(console, orig); });

test('vrai Odin : la machine d\'Odin telle que Pyramide la lit ; sous Windows, « source_absente » avec son code, jamais « 0 % »', async () => {
  const d = await donnees();
  assert.equal(d.status, 200);
  const e = d.de(ID.grand)!;
  if (process.platform === 'win32') {
    assert.deepEqual([e.etat, e.raison, e.donnee], ['source_absente', 'systeme_pas_encore_lu', undefined]);
    assert.ok(!/"utilise"|"volumes"/.test(d.corps), 'aucun chiffre, aucun volume');
  } else {
    assert.ok(e.etat === 'ok' || (e.etat === 'source_absente' && e.raison === 'lecture_echouee'), JSON.stringify(e));
    if (e.etat === 'ok') assert.ok((e.donnee!.volumesTotal as number) > 0);
  }
});

test('vrai Odin : un membre sans le droit sur Pyramide, une tablette « maison », une clé d\'accès, sans session : refusés, sans une valeur ; un membre avec le droit : comme le propriétaire', async () => {
  const lui = (await donnees()).de(ID.grand)!;
  const avec = await donnees({ cookie: avecDroit });
  assert.equal(avec.status, 200);
  assert.deepEqual([avec.de(ID.grand)!.etat, avec.de(ID.grand)!.raison], [lui.etat, lui.raison], 'un membre avec le droit : la même lecture');
  const sans = await donnees({ cookie: sansDroit });
  assert.equal(sans.status, 200);
  for (const id of Object.values(ID)) { const x = sans.de(id)!; assert.deepEqual([x.etat, x.raison, x.donnee], ['refuse', 'appli_fermee', undefined], `sans le droit : ${id}`); }
  assert.ok(!/"volumes"|"utilise"|"disques"/.test(sans.corps), 'sans le droit : aucune valeur');
  for (const [qui, h] of [['tablette', { cookie: '', 'x-odin-maison': cleMaison }], ['clé d\'accès', { cookie: '', authorization: `Bearer ${v.token}` }], ['sans session', { cookie: '' }]] as const) {
    const r = await donnees(h);
    assert.equal(r.status, 401, qui); assert.ok(!/"volumes"|"utilise"|systeme_pas/.test(r.corps), `${qui} : rien`);
  }
});

// ------------------------------------------------------------------ dans un vrai navigateur (s'il y en a un)

declare const document: any, window: any, getComputedStyle: any, location: any, requestAnimationFrame: any;
interface Route { fetch(): Promise<{ json(): Promise<any> }>; fulfill(o: Record<string, unknown>): Promise<void> }
interface Page {
  goto(u: string): Promise<unknown>; waitForSelector(s: string, o?: Record<string, unknown>): Promise<unknown>; click(s: string, o?: Record<string, unknown>): Promise<void>;
  waitForFunction(f: string | ((a: any) => unknown), a?: unknown, o?: Record<string, unknown>): Promise<unknown>; evaluate<X>(f: string | ((a?: any) => X), a?: unknown): Promise<X>;
  route(u: string | RegExp, h: (r: Route) => Promise<void> | void): Promise<void>; on(e: string, f: (x: any) => void): void; screenshot(o: Record<string, unknown>): Promise<unknown>;
  keyboard: { press(k: string): Promise<void> };
}
interface Contexte { newPage(): Promise<Page>; addCookies(c: unknown[]): Promise<void>; addInitScript(f: string | (() => void)): Promise<void>; close(): Promise<void> }
interface Navigateur { newContext(o: Record<string, unknown>): Promise<Contexte>; close(): Promise<void> }
const pw = (() => { try { return createRequire(import.meta.url)('playwright') as { chromium: { launch(): Promise<Navigateur> } }; } catch { return undefined; } })();
const sansNav = pw ? false : 'Playwright n\'est pas installé sur cette machine';
let nav: Navigateur | undefined;
before(async () => { if (pw) nav = await pw.chromium.launch(); });
after(async () => { await nav?.close(); });
const CAPTURES = process.env.ODIN_CAPTURES;
const carte = (id: string) => `#feGrid > .fe-w[data-id="${id}"]`;
// Un nom piégé : du HTML et un texte très long sans espace.
const PIEGE = `<img src=x onerror="window.__piege=1">${'x'.repeat(180)}`;
/** La donnée « ok » forcée (comme si Pyramide lisait une machine Linux) : sept volumes, dont un presque plein et un piégé. */
const FORCEE = (partages: boolean) => ({
  taille: 9 * To, utilise: 6 * To, libre: 3 * To, volumesTotal: 9, disquesTotal: 3, partagesTotal: partages ? 2 : 0,
  volumes: [{ nom: '/srv/media', taille: 4 * To, utilise: 3.8 * To, libre: 0.2 * To }, { nom: PIEGE, taille: 2 * To, utilise: 1.4 * To, libre: 0.6 * To },
    ...Array.from({ length: 5 }, (_, i) => ({ nom: `/v${i}`, taille: 100 * Go, utilise: (40 - i * 5) * Go, libre: (60 + i * 5) * Go }))],
  disques: [{ nom: 'sda', taille: 512 * Go, ssd: true, amovible: false }, { nom: 'sdb', taille: 4 * To, ssd: false, amovible: false }, { nom: 'sdc', taille: 4 * To, ssd: false, amovible: true }],
  partages: partages ? [{ nom: 'Partage A', type: 'samba' }, { nom: 'export-b', type: 'nfs' }] : [],
});

async function ouvrir(largeur: number, sombre: boolean) {
  const doigt = largeur < 500;
  // Le thème vient d'Odin (Apparence), pas du navigateur : « Nuit étoilée » (sombre) ou « Glace » (clair).
  assert.equal((await valhallaOf()!.act('apparence', 'theme', { theme: sombre ? 'nuit' : 'glace' })).ok, true);
  const ctx = await nav!.newContext({ viewport: { width: largeur, height: doigt ? 800 : 900 }, hasTouch: doigt, isMobile: doigt, colorScheme: sombre ? 'dark' : 'light' });
  const [n, ...x] = v.session.split('='); await ctx.addCookies([{ name: n, value: x.join('='), url: v.url, httpOnly: true, sameSite: 'Strict' }]);
  await ctx.addInitScript(`try { localStorage.setItem('odin.tour', 'done'); localStorage.setItem('odin.fenetre.page', '1'); } catch { /* rien */ }`);
  const p = await ctx.newPage(), erreurs: string[] = [];
  p.on('pageerror', (e) => erreurs.push(String(e)));
  await p.route(/\/api\/widgets\/donnees/, async (r) => {
    const rep = await r.fetch(), j = await rep.json();
    if (Array.isArray(j?.widgets)) j.widgets = j.widgets.map((w: any) => (w.kind === 'stockage' ? { id: w.id, kind: w.kind, page: w.page, etat: 'ok', at: Date.now(), donnee: FORCEE(!SANS_PARTAGE.includes(w.id)) } : w));
    await r.fulfill({ response: rep, json: j });
  });
  await p.goto(v.url + '/');
  await p.waitForSelector('#app:not([hidden])', { timeout: 30000 });
  try { await p.waitForSelector(`${carte(ID.grand)} .ws-vol`, { timeout: 45000 }); }
  catch (e) { const vus = await p.evaluate(() => [location.hash, ...[...document.querySelectorAll('#feGrid > .fe-w')].map((c: any) => `${c.dataset.id}: ${c.textContent.slice(0, 80)}`)]); await ctx.close(); throw new Error(`${String(e).split('\n')[0]} · cartes : ${JSON.stringify(vus)} · ${erreurs.join(' | ')}`); }
  return { ctx, page: p, erreurs };
}
const vu = (p: Page) => p.evaluate(async (ids: Record<string, string>) => {
  // Les cartes se mesurent une fois posées (la hauteur réelle) : deux images plus tard, tout est en place.
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  const vw = document.documentElement.clientWidth, txt = (n: any) => (n?.textContent ?? '').replace(/\s+/g, ' ').trim();
  const out: Record<string, any> = { deborde: document.documentElement.scrollWidth > vw + 1, piege: Boolean(window.__piege) || Boolean(document.querySelector('#feGrid img[src="x"]')) };
  for (const [nom, id] of Object.entries(ids)) {
    const c = document.querySelector(`#feGrid > .fe-w[data-id="${id}"]`); if (!c) { out[nom] = null; continue; }
    const b = c.getBoundingClientRect(), dans = (n: any) => { const r = n.getBoundingClientRect(); return r.width === 0 || (r.left >= b.left - 1 && r.right <= b.right + 1); };
    out[nom] = {
      texte: txt(c), dedans: [...c.querySelectorAll('*')].every(dans), haut: Math.round(b.height),
      petits: [...c.querySelectorAll('button, a')].filter((n: any) => { const r = n.getBoundingClientRect(); return r.width && (r.width < 44 || r.height < 44); }).map((n: any) => n.getAttribute('aria-label') || txt(n)),
      vols: [...c.querySelectorAll('.ws-vol .ws-n')].map(txt), bulles: [...c.querySelectorAll('.ws-vol .ws-n')].map((n: any) => n.title), coupes: [...c.querySelectorAll('.ws-vol .ws-n')].map((n: any) => n.scrollWidth > n.clientWidth + 1),
      pleins: [...c.querySelectorAll('.ws-vol')].map((n: any) => n.classList.contains('ws-plein')), parts: [...c.querySelectorAll('.ws-vol .ws-p')].map(txt),
      partages: txt(c.querySelector('.ws-partages')), disques: txt(c.querySelector('.ws-disques')), plus: txt(c.querySelector('.ws-plus')),
      boutons: [...c.querySelectorAll('.ws-btn')].map(txt), hautEntier: [...c.querySelectorAll('.ws-haut > *, .ws-bas > *')].every((n: any) => { const r = n.getBoundingClientRect(); return r.width === 0 || (r.top >= b.top - 1 && r.bottom <= b.bottom + 1); }),
      // Une taille ne se casse jamais au milieu : une seule ligne.
      taillesEntieres: [...c.querySelectorAll('.ws-stats b, .ws-pc')].every((n: any) => { const r = n.getBoundingClientRect(); return r.width === 0 || r.height < 2 * parseFloat(getComputedStyle(n).fontSize); }),
      // Rien n'est coupé au bord de la zone qui défile : ce qui est montré tient dans la hauteur de la carte.
      defileTout: [...c.querySelectorAll('.ws-defile')].every((n: any) => n.scrollHeight <= n.clientHeight + 1),
      alertes: [...c.querySelectorAll('.ws-vol')].map((n: any) => { const a = n.querySelector('.ws-alerte'); return Boolean(a && a.getBoundingClientRect().width > 0 && /presque plein/.test(n.textContent)); }), sous: txt(c.querySelector('.wr-s')), anneau: txt(c.querySelector('.ws-pc')),
      ink: (() => { const s = document.createElement('i'); c.append(s); s.style.color = 'var(--ink)'; const k = getComputedStyle(s).color; s.remove(); return k; })(),
      nomCouleur: c.querySelector('.ws-n') ? getComputedStyle(c.querySelector('.ws-n')).color : '',
    };
  }
  return out;
}, ID);

const CARTES = ['grand', 'mini', 'sansPartage', 'large', 'etroit', 'sansGrand'];
const clarte = (rgb: string) => { const [r, g, b] = (rgb.match(/[\d.]+/g) ?? []).map(Number); return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255; };
for (const [largeur, sombre] of [[1280, false], [390, true], [768, true], [768, false]] as const) {
  test(`navigateur, ${largeur} px, ${sombre ? 'sombre' : 'clair'} : le presque plein devant, la place libre, les partages et les disques ; le nom piégé en texte borné ; « Ouvrir Pyramide » au clavier`, { skip: sansNav }, async () => {
    const { ctx, page: p, erreurs } = await ouvrir(largeur, sombre);
    try {
      const x = await vu(p);
      assert.equal(x.deborde, false, 'rien ne déborde de la page'); assert.equal(x.piege, false, 'le nom piégé n\'est jamais du code');
      assert.equal(x.grand.vols[0], '/srv/media', 'le presque plein devant'); assert.equal(x.grand.pleins[0], true, 'marqué presque plein');
      // « Presque plein » se lit sur sa ligne (un repère dessiné et ses mots), pas seulement à sa couleur ni en info-bulle.
      assert.deepEqual(x.grand.alertes, x.grand.pleins, 'un repère sur chaque ligne presque pleine, et seulement là');
      assert.ok(sombre ? clarte(x.grand.ink) > 0.5 : clarte(x.grand.ink) < 0.5, `le thème ${sombre ? 'sombre' : 'clair'} est bien appliqué (${x.grand.ink})`);
      assert.equal(x.sansGrand.partages, 'Aucun partage.', 'aucun partage, dit en bas aussi');
      assert.match(x.grand.parts[0], /95\s?%/); assert.match(x.grand.texte, /libres?/);
      // À 768 px, la carte 5 × 4 n'a la hauteur que d'un volume (chacun sur deux lignes) : le nom piégé se vérifie ailleurs.
      if (largeur === 768) assert.deepEqual([x.grand.vols.length, /\d/.test(x.grand.plus)], [1, true], `768 : un volume, et le reste dit (${x.grand.plus})`);
      else {
        assert.equal(x.grand.vols[1], PIEGE, 'le nom piégé, tel quel, en texte'); assert.equal(x.grand.bulles[1], PIEGE, 'son nom entier en info-bulle');
        assert.equal(x.grand.coupes[1], true, 'coupé à l\'écran');
      }
      assert.equal(x.grand.dedans, true, 'tout reste dans la carte');
      assert.match(x.grand.plus, /\d/, `et N de plus : ${x.grand.plus}`);
      assert.match(x.grand.partages, /Partage A/); assert.match(x.sansPartage.texte, /Aucun partage/); assert.doesNotMatch(x.sansPartage.texte, /(^|\D)0 partage/, 'jamais « 0 partage »');
      // La plus petite carte (3 × 2) : l'anneau, la place libre et « Ouvrir » (son nom en info-bulle), entiers.
      assert.match(x.mini.anneau, /67\s?%/); assert.match(x.mini.texte, /libres/); assert.equal(x.mini.boutons.length, 1);
      assert.match(x.grand.disques, /sda/); assert.match(x.grand.sous, /3 disques/);
      assert.match(x.grand.anneau, /67\s?%/, 'la part utilisée en tout'); assert.doesNotMatch(x.grand.texte, /(^|\D)0\s?%/, 'jamais un 0 %');
      assert.deepEqual(x.grand.boutons, ['Ouvrir Pyramide']);
      for (const k of CARTES) { assert.deepEqual(x[k].petits, [], `${k} : des cibles de 44 px`); assert.equal(x[k].dedans, true, `${k} : dans sa carte`); }
      for (const k of CARTES) {
        assert.equal(x[k].hautEntier, true, `${k} : l'anneau, la place libre et « Ouvrir » entiers dans la carte`);
        assert.equal(x[k].taillesEntieres, true, `${k} : une taille n'est jamais cassée au milieu`);
        assert.equal(x[k].defileTout, true, `${k} : rien de coupé au bord (${x[k].plus})`);
      }
      if (largeur > 700) { assert.ok(Math.abs(x.grand.haut - 338) <= 2, `5 × 4 : ${x.grand.haut} px pour 4 lignes, la carte ne s'étire pas`); assert.ok(Math.abs(x.mini.haut - 162) <= 2, `3 × 2 : ${x.mini.haut} px`); }
      assert.equal(x.grand.nomCouleur, x.grand.ink, 'le nom : la couleur du texte du thème');
      if (CAPTURES) await p.screenshot({ path: `${CAPTURES}/stockage-${largeur}${sombre ? '-sombre' : '-clair'}.png`, fullPage: true });
      // « Ouvrir Pyramide » au clavier : le focus se voit ; Entrée ouvre Pyramide.
      const btn = `${carte(ID.grand)} .ws-btn`;
      await p.evaluate((s: string) => document.querySelector(s).focus(), btn);
      assert.notEqual(await p.evaluate(() => getComputedStyle(document.activeElement).outlineStyle), 'none', 'le focus se voit');
      await p.keyboard.press('Enter');
      await p.waitForFunction(() => location.hash === '#app=fensalir', undefined, { timeout: 10000 });
      assert.deepEqual(erreurs, [], 'aucune erreur dans la page');
    } finally { await ctx.close(); }
  });
}

test('navigateur, 320 et 1920 px : rien ne déborde', { skip: sansNav }, async () => {
  for (const largeur of [320, 1920]) {
    const { ctx, page: p, erreurs } = await ouvrir(largeur, false);
    try {
      const x = await vu(p);
      assert.equal(x.deborde, false, `${largeur} : la page ne déborde pas`);
      for (const k of CARTES) { assert.equal(x[k].dedans, true, `${largeur} : ${k} reste dans sa carte`); assert.equal(x[k].defileTout, true, `${largeur} : ${k}, rien de coupé au bord`); }
      assert.deepEqual(erreurs, []);
    } finally { await ctx.close(); }
  }
});
