// Le widget « Réseau » de l'accueil (maquette validée « Accueil », la carte « Réseau » d'Horus), son style de départ
// « Liste » : la famille « reseau » (src/valhalla/widgets/reseau.ts, src/web/pages/widgets-reseau.js).
// - Les appareils du réseau tels que le registre d'Odin les connaît : combien en ligne sur combien de connus, puis la
//   liste (le nom tel qu'Odin le connaît, en ligne ou non, depuis quand) ; « et N de plus ».
// - Le débit seulement quand Ariane lit les paquets : sinon aucune ligne de débit (ni 0, ni tiret). Jamais de test de
//   débit par appareil.
// - Au propriétaire seul : un membre (même avec tous les droits), une tablette « maison », l'écran de la maison, une clé
//   d'accès, une requête sans session : refusés sans un nom ni une adresse, et la lecture des appareils n'est même pas
//   appelée. Marqué « jamais sur l'écran de la maison », lu par la règle.
// - Aucun appareil connu : « vide », qui mène à la page Réseau d'Odin. Le registre pas branché : dit.
// - Un nom piégé (du HTML, très long) reste du texte borné ; 390, 768 et 1280 px, clair et sombre ; 320 et 1920 px sans
//   débordement. Les adresses des essais sont de la plage de documentation (192.0.2.x).

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { after, before, test } from 'node:test';
import vm from 'node:vm';
import { TAILLE_SORTE, type Widget } from '../src/valhalla/modules/gladsheim.ts';
import { allModules, valhallaOf } from '../src/valhalla/odin.ts';
import { lierProprietaire, persona } from '../src/valhalla/sso/etat.ts';
import { admiseALaMaison, copiable, donneeWidget, publicDe, sorteDe, type EtatWidget, type Lecteur, type SourceWidget } from '../src/valhalla/widgets/index.ts';
import { appareilsReseauBranches, brancherAppareilsReseau, reseauEntierLu } from '../src/valhalla/widgets/reseau.ts';
import { T as Banc } from './banc/lib.ts';
import { vraiOdin, type VraiOdin } from './banc/odin-vrai.ts';

const lire = (f: string) => { try { return readFileSync(new URL(`../${f}`, import.meta.url), 'utf8'); } catch { return ''; } };
const RENDU = lire('src/web/pages/widgets-rendu.js'), RESEAU = lire('src/web/pages/widgets-reseau.js'), GRILLE = lire('src/web/pages/accueil-grille.js');
const W = (o: Record<string, unknown> = {}): Widget => ({ id: 'c9e00000', kind: 'reseau', w: 1, c: 4, r: 4, ...o }) as unknown as Widget;
const LUI: Lecteur = { qui: 'proprietaire', ecran: 'accueil' }, TABLETTE: Lecteur = { qui: 'maison', ecran: 'maison' };
const MAINT = 1_800_000_000_000, MIN = 60_000;
type Etat = EtatWidget & { raison?: string; donnee?: Record<string, any>; at?: number };
const etat = async (w: Widget, l: Lecteur, src: SourceWidget) => (await donneeWidget(w, l, src)) as Etat;
type Lu = ReturnType<NonNullable<SourceWidget['appareilsReseau']>>;
type Debit = ReturnType<NonNullable<SourceWidget['debitReseau']>>;
const ap = (nom: string, ip: string, enLigne: boolean, vuA = MAINT - 5 * MIN) => ({ nom, ip, enLigne, depuis: MAINT - 30 * 24 * 60 * MIN, vuA });
/** Trois appareils connus : deux en ligne, un hors ligne. */
const TROIS = (): Lu => ({ at: MAINT - 2 * MIN, appareils: [ap('Poste A', '192.0.2.10', true), ap('Imprimante B', '192.0.2.60', false, MAINT - 3 * 60 * MIN), ap('Téléphone C', '192.0.2.52', true)] });

/** Une fausse source qui compte ses lectures des appareils (null : le registre n'est pas branché ; absente : pas lue). */
function fausse(o: { lu?: Lu | null; debit?: Debit | null; sansLecture?: boolean; sansDebit?: boolean } = {}) {
  const lus = { appareils: 0, debit: 0 };
  const src: SourceWidget = {
    appli: () => undefined, vue: async () => null, action: () => undefined, meteo: async () => undefined,
    lieu: () => ({ choisi: true, nom: 'Lieu A', fuseau: 'UTC', heure12: false }), maintenant: () => MAINT,
    ...(o.sansLecture ? {} : { appareilsReseau: () => { lus.appareils++; return o.lu === null ? undefined : (o.lu ?? TROIS()); } }),
    ...(o.sansDebit ? {} : { debitReseau: () => { lus.debit++; return o.debit ?? undefined; } }),
  };
  return { src, lus };
}

// ------------------------------------------------------------------ le serveur, sans Odin

test('la sorte : famille « reseau », sans appli de Valhalla, tailles de la maquette (4 × 4, 3 × 2 au moins), style de départ « Liste », propriétaire seul, jamais sur l\'écran de la maison', () => {
  const s = sorteDe('reseau');
  assert.ok(s, 'déclarée'); assert.equal(s.famille, 'reseau'); assert.equal(s.posable, true);
  assert.deepEqual([[...s.taille.mini], s.taille.r, [...(s.applis as readonly string[])], [...s.styles]], [[3, 2], 4, [], ['liste']]);
  assert.equal(publicDe(s), 'proprietaire', 'propriétaire seul');
  assert.equal(s.jamaisALaMaison, true, 'la marque');
  // La marque est lue par la règle de l'écran de la maison et par « Copier vers l'autre écran ».
  assert.equal(admiseALaMaison('reseau'), false); assert.equal(copiable('reseau'), false);
  assert.deepEqual((TAILLE_SORTE as Record<string, unknown>).reseau, { mini: [3, 2], r: 4 }, 'la taille gardée par Hestia');
});

test('le bon compte : en ligne et hors ligne, en ligne d\'abord ; l\'heure du dernier balayage ; le nom et l\'adresse, sans débit quand Ariane ne lit pas', async () => {
  const { src } = fausse();
  const e = await etat(W(), LUI, src), d = e.donnee!;
  assert.equal(e.etat, 'ok'); assert.equal(e.at, MAINT - 2 * MIN, 'l\'heure du dernier balayage');
  assert.deepEqual([d.total, d.enLigne], [3, 2]);
  assert.deepEqual(d.appareils.map((a: any) => [a.nom, a.enLigne]), [['Poste A', true], ['Téléphone C', true], ['Imprimante B', false]]);
  // « depuis » (la première fois vue) n'est affiché nulle part : il n'est pas servi.
  assert.deepEqual(d.appareils[2], { nom: 'Imprimante B', ip: '192.0.2.60', enLigne: false, vuA: MAINT - 3 * 60 * MIN });
  assert.equal(d.balayeA, MAINT - 2 * MIN);
  assert.equal('debit' in d, false, 'aucun débit servi');
  // Sans balayage gardé : l'heure de la dernière nouvelle d'un appareil, jamais une heure inventée ; pas de « balayé à ».
  const sans = await etat(W(), LUI, fausse({ lu: { appareils: TROIS()!.appareils } }).src);
  assert.equal(sans.at, MAINT - 5 * MIN); assert.equal('balayeA' in sans.donnee!, false);
  // Hors ligne : le plus récemment vu d'abord.
  const h = await etat(W(), LUI, fausse({ lu: { at: MAINT, appareils: [ap('Vieux', '192.0.2.1', false, MAINT - 900 * MIN), ap('Récent', '192.0.2.2', false, MAINT - 9 * MIN)] } }).src);
  assert.deepEqual(h.donnee!.appareils.map((a: any) => a.nom), ['Récent', 'Vieux']); assert.equal(h.donnee!.enLigne, 0);
});

test('aucun appareil connu : « vide » ; le registre pas branché ou absent : « source_absente » ; aucun chiffre', async () => {
  assert.deepEqual(await etat(W(), LUI, fausse({ lu: { at: MAINT, appareils: [] } }).src), { etat: 'vide', raison: 'aucun_appareil' });
  assert.deepEqual(await etat(W(), LUI, fausse({ lu: { at: MAINT, appareils: [{ nom: '', ip: '192.0.2.3', enLigne: true }] } }).src), { etat: 'vide', raison: 'aucun_appareil' }, 'un appareil sans nom n\'est pas servi');
  // Le registre pas branché : Odin ne sait pas le lire (ce n'est pas une appli de Valhalla qui se tairait).
  assert.deepEqual(await etat(W(), LUI, fausse({ lu: null }).src), { etat: 'source_absente', raison: 'pas_encore_lu' });
  assert.deepEqual(await etat(W(), LUI, fausse({ sansLecture: true }).src), { etat: 'source_absente', raison: 'pas_encore_lu' });
  const { src } = fausse(); src.appareilsReseau = () => { throw new Error('registre fermé'); };
  assert.deepEqual(await etat(W(), LUI, src), { etat: 'source_absente', raison: 'lecture_echouee' });
});

test('le débit : seulement quand Ariane le mesure ; sans Ariane, en pause ou sans paquets lus, aucune ligne (ni 0, ni tiret) ; une valeur de travers n\'est pas servie', async () => {
  for (const [quoi, o] of [['sans lecture du débit', { sansDebit: true }], ['Ariane ne lit pas', { debit: null }]] as const) {
    const e = await etat(W(), LUI, fausse(o).src);
    assert.equal(e.etat, 'ok', quoi); assert.equal('debit' in e.donnee!, false, quoi);
  }
  for (const debit of [{ recu: Number.NaN, envoye: 1, at: MAINT }, { recu: -1, envoye: 1, at: MAINT }, { recu: 1, envoye: 1, at: 0 }, { recu: 1, at: MAINT } as never]) {
    const e = await etat(W(), LUI, fausse({ debit }).src);
    assert.equal('debit' in e.donnee!, false, JSON.stringify(debit));
  }
  const e = await etat(W(), LUI, fausse({ debit: { recu: 8_300_000, envoye: 1_200_000, at: MAINT - 10_000 } }).src);
  assert.deepEqual(e.donnee!.debit, { recu: 8_300_000, envoye: 1_200_000, at: MAINT - 10_000 });
  // Un vrai zéro mesuré pendant qu'Ariane lit : c'est une mesure, elle est servie.
  assert.deepEqual((await etat(W(), LUI, fausse({ debit: { recu: 0, envoye: 0, at: MAINT } }).src)).donnee!.debit, { recu: 0, envoye: 0, at: MAINT });
  // Le serveur ne sert jamais un débit par appareil.
  assert.ok(e.donnee!.appareils.every((a: any) => Object.keys(a).every((k) => ['nom', 'ip', 'enLigne', 'vuA'].includes(k))));
});

test('le débit servi est celui de tout le réseau : Ariane lit « tout le réseau », et aucune machine lue en plus (ses paquets compteraient deux fois)', () => {
  const TOUT = 'tout', on = (...l: string[]) => (sc: string) => l.includes(sc);
  assert.equal(reseauEntierLu(['192.0.2.10'], TOUT, on('192.0.2.10')), false, 'une seule machine suivie : ce n\'est pas le débit du réseau');
  assert.equal(reseauEntierLu([TOUT], TOUT, on()), false, 'suivi mais pas en marche');
  assert.equal(reseauEntierLu([], TOUT, on(TOUT)), false, 'en marche mais pas suivi');
  assert.equal(reseauEntierLu([TOUT, '192.0.2.10'], TOUT, on(TOUT, '192.0.2.10')), false, 'une machine lue en plus : compté deux fois');
  assert.equal(reseauEntierLu([TOUT, '192.0.2.10'], TOUT, on(TOUT)), true, 'la machine suivie mais arrêtée : rien en double');
  assert.equal(reseauEntierLu([TOUT], TOUT, on(TOUT)), true);
  // La source des widgets s'en sert, avec la portée « tout le réseau » d'Ariane.
  assert.match(lire('src/valhalla/widgets/source.ts'), /reseauEntierLu\(suivis, NETWORK,/);
});

test('qui voit quoi : un membre (même avec tous les droits), une tablette, l\'écran de la maison (lui compris) : refusés AVANT la lecture, sans un nom ni une adresse', async () => {
  const tout = new Set(['c9e00000@ran', 'c9e00000@hlidskjalf', 'c9e00000']);
  const membreTout: Lecteur = { qui: 'membre', ecran: 'accueil', peutLire: () => true, ouverts: tout };
  for (const [qui, l] of [['membre avec tous les droits', membreTout], ['tablette', TABLETTE], ['tablette sur l\'accueil', { qui: 'maison', ecran: 'accueil' } as Lecteur],
    ['lui, sur l\'écran de la maison', { qui: 'proprietaire', ecran: 'maison' } as Lecteur], ['membre sur l\'écran de la maison', { ...membreTout, ecran: 'maison' } as Lecteur]] as const) {
    const { src, lus } = fausse({ debit: { recu: 5, envoye: 5, at: MAINT } });
    const r = await etat(W(), l, src);
    assert.equal(r.etat, 'refuse', qui);
    assert.deepEqual(lus, { appareils: 0, debit: 0 }, `${qui} : la lecture n'est même pas appelée`);
    assert.ok(!/192\.0\.2|Poste|Imprimante|Téléphone/.test(JSON.stringify(r)), `${qui} : ni nom ni adresse (${JSON.stringify(r)})`);
  }
  // La lecture seule le redit : appelée directement pour un autre que lui, elle refuse sans rien lire.
  for (const l of [membreTout, TABLETTE, { qui: 'proprietaire', ecran: 'maison' } as Lecteur]) {
    const { src, lus } = fausse();
    const direct = await sorteDe('reseau')!.lire!(W(), src, l) as Etat;
    assert.equal(direct.etat, 'refuse'); assert.equal(lus.appareils, 0);
  }
});

test('un nom piégé (du HTML, très long) reste du texte borné ; une adresse de travers n\'est pas servie ; vingt appareils servis et le total', async () => {
  const PIEGE = `<img src=x onerror="alert(1)">${'x'.repeat(500)}`;
  const e = await etat(W(), LUI, fausse({ lu: { at: MAINT, appareils: [{ nom: PIEGE, ip: 'pas-une-adresse', enLigne: true }, { nom: 3, ip: '192.0.2.9', enLigne: true } as never, null as never, 'rien' as never] } }).src);
  assert.equal(e.etat, 'ok'); assert.equal(e.donnee!.total, 1);
  assert.deepEqual(e.donnee!.appareils, [{ nom: PIEGE.slice(0, 200), enLigne: true }], 'coupé à 200 signes, tel quel, sans adresse');
  const beaucoup = await etat(W(), LUI, fausse({ lu: { at: MAINT, appareils: Array.from({ length: 27 }, (_, i) => ap(`Appareil ${i}`, `192.0.2.${i + 1}`, i % 3 !== 0)) } }).src);
  const b = beaucoup.donnee!;
  assert.deepEqual([b.appareils.length, b.total, b.enLigne], [20, 27, 18]);
  assert.ok(b.appareils.slice(0, 18).every((a: any) => a.enLigne), 'en ligne d\'abord, même au-delà de vingt');
});

// ------------------------------------------------------------------ la page, sans navigateur

const fenetreVm = () => {
  const win: Record<string, any> = {};
  for (const src of [RESEAU, RENDU, GRILLE]) vm.runInNewContext(src, { window: win });
  return win;
};
const ici = <X>(x: X): X => JSON.parse(JSON.stringify(x));

test('la page : la famille se déclare (propriétaire seul, groupe « Odin », jamais sur l\'écran de la maison, taille de la maquette 4 × 4) ; la grille connaît sa taille', () => {
  const win = fenetreVm(), R = win.OdinWidgetsRendu, G = win.OdinGrille;
  const x = R.rendu('reseau');
  assert.deepEqual(ici([x?.sorte, x?.titre, x?.appli, x?.proprio, x?.groupe, x?.jamaisALaMaison]), ['reseau', 'Réseau', '', true, 'odin', true]);
  assert.deepEqual(ici([x.w.c, x.w.r]), [4, 4], 'posé à la taille de la maquette');
  assert.deepEqual(ici(R.posables({ proprio: true, aDroit: () => true }).filter((y: any) => y.famille === 'reseau').map((y: any) => y.nom)), ['Réseau'], 'proposé au propriétaire');
  assert.deepEqual(ici(R.posables({ proprio: false, aDroit: () => true }).filter((y: any) => y.famille === 'reseau')), [], 'jamais à un membre, même avec tous les droits');
  assert.equal(R.copieRefusee({ kind: 'reseau', versMaison: true, privee: false }), 'maison', 'jamais copié vers l\'écran de la maison');
  assert.deepEqual([[...G.MINI.reseau], G.HAUTEUR.reseau], [[...sorteDe('reseau')!.taille.mini], sorteDe('reseau')!.taille.r], 'les tables de la grille suivent le serveur');
  // Le texte d'une donnée : jamais par innerHTML (seules les icônes dessinées ici le sont).
  assert.deepEqual([...RESEAU.matchAll(/innerHTML\s*=\s*([^;]+);/g)].map((m) => m[1].trim()), ['icone(k)']);
  // Aucune langue ni aucun fuseau écrits dans le fichier : ceux de la page. Aucune adresse écrite.
  assert.ok(!new RegExp(`${'fr'}-FR|timeZone|\\d+\\.\\d+\\.\\d+\\.\\d+`).test(RESEAU));
  // Aucune action : aucun appel à une route, aucun balayage, aucun test de débit.
  assert.doesNotMatch(RESEAU, /fetch\(|\/api\/|<form|scan|speed|Tester/i);
});

test('la page : un débit avec son unité et les nombres de la langue de la page ; « il y a » dans la langue ; rien d\'inventé', () => {
  const N = fenetreVm().OdinWidgetsReseau;
  assert.equal(N.debit(8_300_000, 'en'), '8.3 MB/s');
  assert.match(N.debit(8_300_000, 'de'), /^8,3\sMB\/s$/u);
  assert.equal(N.debit(310_000, 'en'), '310 kB/s');
  assert.equal(N.debit(45, 'en'), '45 byte/s');
  assert.equal(N.debit(0, 'en'), '0 byte/s', 'un zéro mesuré reste un zéro');
  for (const x of [Number.NaN, -1, undefined, '3']) assert.equal(N.debit(x, 'en'), '', String(x));
  assert.equal(N.ilYa(MAINT - 3 * 60 * MIN, MAINT, 'en'), '3 hours ago');
  assert.equal(N.ilYa(MAINT - 30_000, MAINT, 'en'), 'now');
  for (const x of [0, Number.NaN, MAINT + 5 * MIN, undefined]) assert.equal(N.ilYa(x, MAINT, 'en'), '', String(x));
  // Une donnée lue sans confiance.
  assert.equal(N.appareilLu({ nom: '', enLigne: true }), null);
  assert.equal(N.appareilLu({ nom: 3, enLigne: true }), null);
  assert.deepEqual(ici(N.appareilLu({ nom: 'Poste A', ip: 7, enLigne: 'oui' })), { nom: 'Poste A', ip: '', enLigne: false, vuA: 0 });
});

test('la page : la carte (sans navigateur) ne dessine rien d\'une donnée illisible', () => {
  const win = fenetreVm(), R = win.OdinWidgetsRendu, N = win.OdinWidgetsReseau;
  assert.ok(R.rendu('reseau') && N, 'déclarée');
  assert.equal(R.dessineElleMeme(R.rendu('reseau'), { etat: 'source_absente', donnee: false }), false, 'source_absente : la phrase de l\'hôte');
  assert.equal(R.dessineElleMeme(R.rendu('reseau'), { etat: 'vide', raison: 'aucun_appareil', donnee: false }), true, 'aucun appareil : la famille le dit');
  for (const donnee of [{}, { appareils: [], total: 0, enLigne: 0 }, { appareils: [{ nom: '' }], total: 1, enLigne: 0 }])
    assert.equal(N.dessiner({ etat: 'ok', at: MAINT, donnee }, { w: { kind: 'reseau', c: 4, r: 4 }, ecran: 'accueil' }), null, JSON.stringify(donnee));
  assert.equal(N.sous({ etat: 'ok', donnee: { total: 3, enLigne: 2 } }), '2 en ligne sur 3');
  assert.equal(N.sous({ etat: 'ok', donnee: {} }), '');
});

// ------------------------------------------------------------------ un vrai Odin d'essai

const tt = new Banc(), orig = { log: console.log, error: console.error, warn: console.warn, info: console.info };
let v: VraiOdin, membreTout = '', cleMaison = '';
const MDP = 'une-pirogue-sur-le-lagon-calme';
const IDS = ['gladsheim', 'var', 'ran'];
const cookieDe = (r: Response, nom: string) => r.headers.getSetCookie().find((c) => c.startsWith(`${nom}=`))?.split(';')[0] ?? '';
async function entrer(ident: string, mdp: string): Promise<string> {
  let r = await fetch(`${v.url}/sso/odin`, { redirect: 'manual' }); assert.equal(r.status, 303);
  r = await fetch(new URL(r.headers.get('location')!, v.url), { redirect: 'manual' }); const demande = /name="demande" value="([^"]+)"/.exec(await r.text())![1];
  r = await fetch(`${v.url}/sso/autoriser`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded', origin: v.url }, body: new URLSearchParams({ demande, identifiant: ident, motdepasse: mdp }) });
  r = await fetch(r.headers.get('location')!, { redirect: 'manual' }); assert.equal(r.status, 303, 'session ouverte');
  return cookieDe(r, 'odin_session');
}
const PAGE = 'b9e00001', ID = { grand: 'c9e00001', mini: 'c9e00002', large: 'c9e00003', vide: 'c9e00004', haut: 'c9e00005' };
const FENETRE = () => ({ pages: [{ id: PAGE, name: 'Réseau', widgets: [
  { id: ID.grand, kind: 'reseau', w: 1, c: 4, r: 4 }, { id: ID.mini, kind: 'reseau', w: 1, c: 3, r: 2 },
  { id: ID.large, kind: 'reseau', w: 3, c: 12, r: 6 }, { id: ID.vide, kind: 'reseau', w: 1, c: 4, r: 3 }, { id: ID.haut, kind: 'reseau', w: 1, c: 3, r: 4 },
] }] });
type Rendue = { id: string; kind: string; etat: string; raison?: string; donnee?: Record<string, any> };
const donnees = async (h: Record<string, string> = {}) => { const r = await v.json(`/api/widgets/donnees?page=${PAGE}`, undefined, h); return { status: r.status, corps: JSON.stringify(r.body), de: (id: string) => ((r.body.widgets as Rendue[] | undefined) ?? []).find((x) => x.id === id) }; };

before(async () => {
  for (const k of ['log', 'error', 'warn', 'info'] as const) console[k] = () => {};
  v = await vraiOdin(tt, { compte: true, modules: (o) => allModules(o).filter((m) => [...IDS, 'apparence'].includes(m.id)) });
  const va = valhallaOf()!;
  // Le registre de cet Odin d'essai : trois appareils vus par un balayage, puis l'un d'eux absent au suivant.
  const net = '192.0.2.0/24', d = (ip: string, mac: string, hostname: string) => ({ ip, mac, hostname, ports: [], services: [], network: net });
  v.o.inventory.applyScan([d('192.0.2.10', '02:00:00:00:00:10', 'poste-essai-a'), d('192.0.2.11', '02:00:00:00:00:11', 'poste-essai-b'), d('192.0.2.12', '02:00:00:00:00:12', 'poste-essai-c')], [net], Date.now() - 60 * MIN);
  v.o.inventory.applyScan([d('192.0.2.10', '02:00:00:00:00:10', 'poste-essai-a'), d('192.0.2.11', '02:00:00:00:00:11', 'poste-essai-b')], [net], Date.now() - 2 * MIN);
  // Un membre avec le droit sur chaque appli de cet Odin, Ariane comprise.
  assert.equal((await va.act('var', 'ajouter', { login: 'membre-t', nom: 'Membre T', groupes: 'invite', mot_de_passe: MDP })).ok, true);
  for (const appli of ['odin', 'gladsheim', 'ran']) assert.equal((await va.act('var', 'donner_acces', { appli, qui: '@membre-t' })).ok, true);
  lierProprietaire(persona()!);
  membreTout = await entrer('membre-t', MDP); assert.ok(membreTout, 'le membre a une session');
  cleMaison = ((await va.act('gladsheim', 'cle_tablette', { nom: 'Tablette maison', droits: 'maison' })).data as { key: string }).key;
  const r = await va.act('gladsheim', 'regler_fenetre', { fenetre: JSON.stringify(FENETRE()) }); assert.equal(r.ok, true, r.text);
});
after(async () => { await tt.end(); Object.assign(console, orig); });

test('vrai Odin : le registre est branché ; le propriétaire voit ses appareils, en ligne et hors ligne ; Ariane ne lit pas : aucun débit', async () => {
  assert.equal(typeof appareilsReseauBranches(), 'function', 'branché par allModules');
  const d = await donnees();
  assert.equal(d.status, 200);
  const e = d.de(ID.grand)!;
  assert.equal(e.etat, 'ok', JSON.stringify(e));
  assert.deepEqual([e.donnee!.total, e.donnee!.enLigne], [3, 2]);
  assert.deepEqual(e.donnee!.appareils.map((a: any) => [a.nom, a.ip, a.enLigne]), [['poste-essai-a', '192.0.2.10', true], ['poste-essai-b', '192.0.2.11', true], ['poste-essai-c', '192.0.2.12', false]]);
  assert.equal('debit' in e.donnee!, false, 'Ariane est là mais ne lit pas les paquets : aucun débit');
});

test('vrai Odin : un membre avec tous les droits, une tablette « maison », une clé d\'accès, sans session : refusés sans un nom ni une adresse, et la lecture n\'est même pas appelée', async () => {
  const vraie = appareilsReseauBranches()!; let appels = 0;
  brancherAppareilsReseau(() => { appels++; return vraie(); });
  try {
    const m = await donnees({ cookie: membreTout });
    assert.equal(m.status, 200);
    for (const id of Object.values(ID)) { const x = m.de(id)!; assert.deepEqual([x.etat, x.donnee], ['refuse', undefined], `membre : ${id}`); }
    assert.ok(!/192\.0\.2|poste-essai/.test(m.corps), 'membre : ni nom ni adresse');
    for (const [qui, h] of [['tablette', { cookie: '', 'x-odin-maison': cleMaison }], ['clé d\'accès', { cookie: '', authorization: `Bearer ${v.token}` }], ['sans session', { cookie: '' }]] as const) {
      const r = await donnees(h);
      assert.equal(r.status, 401, qui); assert.ok(!/192\.0\.2|poste-essai/.test(r.corps), `${qui} : rien`);
    }
    assert.equal(appels, 0, 'la lecture des appareils n\'a pas été appelée');
    assert.equal((await donnees()).de(ID.grand)!.etat, 'ok'); assert.ok(appels > 0, 'pour lui, elle l\'est');
  } finally { brancherAppareilsReseau(vraie); }
});

// ------------------------------------------------------------------ dans un vrai navigateur (s'il y en a un)

declare const document: any, window: any, getComputedStyle: any, location: any, requestAnimationFrame: any;
interface Route { fetch(): Promise<{ json(): Promise<any> }>; fulfill(o: Record<string, unknown>): Promise<void> }
interface Page {
  goto(u: string): Promise<unknown>; waitForSelector(s: string, o?: Record<string, unknown>): Promise<unknown>;
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
/** La donnée « ok » forcée : neuf appareils, dont un piégé et deux hors ligne ; le débit sur la grande carte seulement. */
const FORCEE = (debit: boolean) => {
  const t = Date.now();
  return {
    total: 11, enLigne: 8, balayeA: t - 4 * MIN,
    appareils: [{ nom: 'Poste A', ip: '192.0.2.10', enLigne: true, depuis: t - 9e9, vuA: t - 4 * MIN }, { nom: PIEGE, ip: '192.0.2.21', enLigne: true, vuA: t - 4 * MIN },
      ...Array.from({ length: 5 }, (_, i) => ({ nom: `Appareil ${i}`, ip: `192.0.2.${30 + i}`, enLigne: true, vuA: t - 4 * MIN })),
      { nom: 'Imprimante B', ip: '192.0.2.60', enLigne: false, vuA: t - 3 * 60 * MIN }, { nom: '192.0.2.77', ip: '192.0.2.77', enLigne: false, vuA: t - 2 * 24 * 60 * MIN }],
    ...(debit ? { debit: { recu: 8_300_000, envoye: 1_200_000, at: t - 5000 } } : {}),
  };
};

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
    if (Array.isArray(j?.widgets)) j.widgets = j.widgets.map((w: any) => (w.kind !== 'reseau' ? w : w.id === ID.vide ? { id: w.id, kind: w.kind, page: w.page, etat: 'vide', raison: 'aucun_appareil' }
      : { id: w.id, kind: w.kind, page: w.page, etat: 'ok', at: Date.now() - 4 * MIN, donnee: FORCEE(w.id === ID.grand || w.id === ID.mini) }));
    await r.fulfill({ response: rep, json: j });
  });
  await p.goto(v.url + '/');
  await p.waitForSelector('#app:not([hidden])', { timeout: 30000 });
  try { await p.waitForSelector(`${carte(ID.grand)} .wn-app`, { timeout: 45000 }); }
  catch (e) { const vus = await p.evaluate(() => [location.hash, ...[...document.querySelectorAll('#feGrid > .fe-w')].map((c: any) => `${c.dataset.id}: ${c.textContent.slice(0, 80)}`)]); await ctx.close(); throw new Error(`${String(e).split('\n')[0]} · cartes : ${JSON.stringify(vus)} · ${erreurs.join(' | ')}`); }
  return { ctx, page: p, erreurs };
}
const vu = (p: Page) => p.evaluate(async (ids: Record<string, string>) => {
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  const vw = document.documentElement.clientWidth, txt = (n: any) => (n?.textContent ?? '').replace(/\s+/g, ' ').trim();
  const out: Record<string, any> = { deborde: document.documentElement.scrollWidth > vw + 1, piege: Boolean(window.__piege) || Boolean(document.querySelector('#feGrid img[src="x"]')) };
  for (const [nom, id] of Object.entries(ids)) {
    const c = document.querySelector(`#feGrid > .fe-w[data-id="${id}"]`); if (!c) { out[nom] = null; continue; }
    const b = c.getBoundingClientRect(), dans = (n: any) => { const r = n.getBoundingClientRect(); return r.width === 0 || (r.left >= b.left - 1 && r.right <= b.right + 1 && r.top >= b.top - 1 && r.bottom <= b.bottom + 1); };
    out[nom] = {
      texte: txt(c), dedans: [...c.querySelectorAll('*')].every(dans), haut: Math.round(b.height),
      petits: [...c.querySelectorAll('button, a')].filter((n: any) => { const r = n.getBoundingClientRect(); return r.width && (r.width < 44 || r.height < 44); }).map((n: any) => n.getAttribute('aria-label') || txt(n)),
      noms: [...c.querySelectorAll('.wn-app .wn-n')].map(txt), bulles: [...c.querySelectorAll('.wn-app .wn-n')].map((n: any) => n.title), coupes: [...c.querySelectorAll('.wn-app .wn-n')].map((n: any) => n.scrollWidth > n.clientWidth + 1),
      etats: [...c.querySelectorAll('.wn-app')].map((n: any) => (n.classList.contains('wn-off') ? 'off' : 'on')), metas: [...c.querySelectorAll('.wn-app .wn-m')].map(txt),
      debit: txt(c.querySelector('.wn-debit')), debitVu: (() => { const n = c.querySelector('.wn-debit'); if (!n || !n.checkVisibility() || !n.getBoundingClientRect().height) return false; const r = n.getBoundingClientRect(), f = n.closest('.wn-defile').getBoundingClientRect(); return r.top >= f.top - 1 && r.bottom <= f.bottom + 1; })(),
      // Les mesures du corps (pour comprendre un échec) : largeur, hauteur de la zone qui défile, de son contenu, du débit, du compte.
      mesure: (() => { const f = c.querySelector('.wn-defile'), h = (s: string) => Math.round(c.querySelector(s)?.getBoundingClientRect().height ?? -1); return f ? [Math.round(f.getBoundingClientRect().width), f.clientHeight, f.scrollHeight, h('.wn-debit'), h('.wn-compte')] : []; })(),
      montres: [...c.querySelectorAll('.wn-app')].filter((n: any) => n.checkVisibility() && n.getBoundingClientRect().height > 0).length, plus: txt(c.querySelector('.wn-plus')), sous: txt(c.querySelector('.wr-s')),
      // Le compte « N en ligne sur M » : coupé dans le sous-titre de l'en-tête ? redit dans le corps, et coupé là ?
      sousCoupe: (() => { const n = c.querySelector('.wr-s'); return Boolean(n && n.scrollWidth > n.clientWidth + 1); })(),
      compte: (() => { const n = c.querySelector('.wn-compte'); return n && getComputedStyle(n).display !== 'none' ? { t: txt(n), coupe: n.scrollWidth > n.clientWidth + 1 || n.getBoundingClientRect().width === 0 } : null; })(),
      boutons: [...c.querySelectorAll('.wn-btn')].map(txt), defileTout: [...c.querySelectorAll('.wn-defile')].every((n: any) => n.scrollHeight <= n.clientHeight + 1),
      ink: (() => { const s = document.createElement('i'); c.append(s); s.style.color = 'var(--ink)'; const k = getComputedStyle(s).color; s.remove(); return k; })(),
      nomCouleur: c.querySelector('.wn-n') ? getComputedStyle(c.querySelector('.wn-n')).color : '',
    };
  }
  return out;
}, ID);

const CARTES = ['grand', 'mini', 'large', 'vide', 'haut'];
const clarte = (rgb: string) => { const [r, g, b] = (rgb.match(/[\d.]+/g) ?? []).map(Number); return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255; };
for (const [largeur, sombre] of [[1280, false], [390, true], [768, true], [768, false]] as const) {
  test(`navigateur, ${largeur} px, ${sombre ? 'sombre' : 'clair'} : en ligne d'abord, le débit seulement s'il est mesuré, le nom piégé en texte borné, « et N de plus » ; « Ouvrir le réseau » au clavier`, { skip: sansNav }, async () => {
    const { ctx, page: p, erreurs } = await ouvrir(largeur, sombre);
    try {
      const x = await vu(p);
      assert.equal(x.deborde, false, 'rien ne déborde de la page'); assert.equal(x.piege, false, 'le nom piégé n\'est jamais du code');
      assert.equal(x.grand.noms[0], 'Poste A', 'en ligne d\'abord'); assert.equal(x.grand.etats[0], 'on');
      assert.match(x.grand.sous, /8 en ligne sur 11/);
      assert.match(x.grand.debit, /8[.,]3\s?MB\/s|8[.,]3\s?Mo\/s/, `le débit mesuré (${x.grand.debit})`); assert.match(x.grand.debit, /1[.,]2/);
      assert.equal(x.large.debit, '', 'sans débit mesuré : aucune ligne de débit'); assert.doesNotMatch(x.large.texte, /Réception|Envoi|\/s\b/, 'ni 0 ni tiret');
      assert.match(x.grand.plus, /\d/, `et N de plus : ${x.grand.plus}`);
      if (x.grand.noms.length > 1) {
        assert.equal(x.grand.noms[1], PIEGE, 'le nom piégé, tel quel, en texte'); assert.equal(x.grand.bulles[1], PIEGE, 'son nom entier en info-bulle');
        assert.equal(x.grand.coupes[1], true, 'coupé à l\'écran');
      }
      // La grande carte large (hors téléphone ; au téléphone elle montre r − 2 appareils, vérifié plus bas) : tous les
      // appareils servis, les hors ligne le disent en mots, avec depuis quand.
      if (largeur > 700) {
        assert.equal(x.large.etats.at(-1), 'off'); assert.match(x.large.metas.at(-2), /hors ligne/); assert.match(x.large.metas.at(-2), /3/);
        assert.equal(x.large.noms.at(-1), '192.0.2.77', 'un appareil connu par son adresse seule'); assert.equal(x.large.metas.at(-1).match(/192\.0\.2\.77/g)?.length ?? 0, 0, 'l\'adresse n\'est pas écrite deux fois');
      }
      assert.match(x.vide.texte, /Aucun appareil/); assert.deepEqual(x.vide.boutons, ['Ouvrir le réseau']);
      for (const k of CARTES) {
        assert.deepEqual(x[k].petits, [], `${k} : des cibles de 44 px`); assert.equal(x[k].dedans, true, `${k} : dans sa carte`);
        assert.equal(x[k].defileTout, true, `${k} : rien de coupé au bord (${x[k].plus})`);
        assert.doesNotMatch(x[k].texte, /Tester/, `${k} : aucun test de débit`);
        // « et N de plus » ne se dit qu'après au moins un appareil montré (le compte dit déjà le total).
        if (k !== 'vide' && !x[k].noms.length) assert.equal(x[k].plus, '', `${k} : pas de « et N de plus » sans appareil montré`);
        // Le compte se lit toujours en entier : dans l'en-tête, ou redit dans le corps quand l'en-tête le coupe.
        if (k !== 'vide' && x[k].sousCoupe) { assert.ok(x[k].compte, `${k} : le compte coupé dans l'en-tête est redit dans le corps`); assert.deepEqual([x[k].compte.t, x[k].compte.coupe], ['8 en ligne sur 11', false], `${k} : entier`); }
      }
      // La plus petite carte (3 × 2) garde le débit, comme la maquette ; la liste vient après.
      // Vu à l'écran, pas seulement dans le texte (un bloc caché garde son texte).
      if (largeur > 700) { assert.match(x.mini.debit, /8[.,]3/, `3 × 2 : le débit (${x.mini.texte})`); assert.equal(x.mini.debitVu, true, `3 × 2 : le débit se voit (${x.mini.texte} ; ${JSON.stringify(x.mini.mesure)})`); }
      assert.equal(x.grand.debitVu, true, '4 × 4 : le débit se voit');
      // Au téléphone, la carte suit son contenu : pas plus d'appareils que la maquette n'en met à sa hauteur (r − 2, un au moins).
      if (largeur < 700) for (const [k, r] of [['grand', 4], ['large', 6], ['haut', 4], ['mini', 2]] as const) {
        assert.ok(x[k].montres >= 1 && x[k].montres <= Math.max(1, r - 2), `${k} au téléphone : ${x[k].montres} appareils`);
        assert.match(x[k].plus, /\d/, `${k} au téléphone : et N de plus`);
      }
      if (largeur > 700) { assert.ok(Math.abs(x.grand.haut - 338) <= 2, `4 × 4 : ${x.grand.haut} px pour 4 lignes, la carte ne s'étire pas`); assert.ok(Math.abs(x.mini.haut - 162) <= 2, `3 × 2 : ${x.mini.haut} px`); }
      assert.ok(sombre ? clarte(x.grand.ink) > 0.5 : clarte(x.grand.ink) < 0.5, `le thème ${sombre ? 'sombre' : 'clair'} est bien appliqué (${x.grand.ink})`);
      assert.equal(x.grand.nomCouleur, x.grand.ink, 'le nom : la couleur du texte du thème');
      if (CAPTURES) await p.screenshot({ path: `${CAPTURES}/reseau-${largeur}${sombre ? '-sombre' : '-clair'}.png`, fullPage: true });
      // « Ouvrir le réseau » au clavier : le focus se voit ; Entrée ouvre la page Réseau d'Odin.
      const btn = `${carte(ID.grand)} .wn-btn`;
      await p.evaluate((s: string) => document.querySelector(s).focus(), btn);
      assert.notEqual(await p.evaluate(() => getComputedStyle(document.activeElement).outlineStyle), 'none', 'le focus se voit');
      await p.keyboard.press('Enter');
      await p.waitForFunction(() => location.hash === '#net', undefined, { timeout: 10000 });
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
