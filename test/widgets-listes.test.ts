// Les widgets « Agenda » et « Recherche » de l'accueil (maquette validée « Accueil ») : la famille « listes »
// (src/valhalla/widgets/listes.ts, src/web/pages/widgets-listes.js).
// - L'agenda : les prochains rendez-vous de Chronos, dans l'ordre, le jour et l'heure dans la langue de la page, sur 12
//   ou 24 h et dans le fuseau d'Odin (jamais ceux de l'appareil) ; aucun rendez-vous → « vide », avec « Ouvrir Chronos ».
// - La recherche : les dernières recherches de Pythie, les plus récentes d'abord ; toucher une recherche ouvre Pythie
//   sur elle (sa page sait déjà rouvrir une recherche gardée) ; aucune recherche → « vide ». D'abord, le champ « Pose ta
//   question… » (la liste dessous à partir de trois lignes) : la question passe à Pythie par le stockage de session de
//   l'onglet, jamais par une adresse ni par une requête de l'accueil.
// - Vie privée : les deux sont au propriétaire seul. Un membre (même avec le droit sur l'appli, même « ouvert »), une
//   tablette « maison », une clé d'accès, une requête sans session : refusés, sans un titre ni une question ; rien de
//   ces données ne part dans un journal ni dans une notification.
// - Un titre ou une question piégés (du HTML, un texte très long) restent du texte et ne débordent pas ; la carte ne
//   s'étire pas avec vingt rendez-vous ; 1280 et 390 px, clair et sombre, et un thème de verre.

import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import vm from 'node:vm';
import { TAILLE_SORTE, type Widget } from '../src/valhalla/modules/gladsheim.ts';
import { allModules, valhallaOf } from '../src/valhalla/odin.ts';
import { lierProprietaire, persona } from '../src/valhalla/sso/etat.ts';
import { cleOuverture, donneeWidget, publicDe, sorteDe, type EtatWidget, type Lecteur, type SourceWidget } from '../src/valhalla/widgets/index.ts';
import { T as Banc } from './banc/lib.ts';
import { vraiOdin, type VraiOdin } from './banc/odin-vrai.ts';

const lire = (f: string) => { try { return readFileSync(new URL(`../${f}`, import.meta.url), 'utf8'); } catch { return ''; } };
const RENDU = lire('src/web/pages/widgets-rendu.js'), LISTES = lire('src/web/pages/widgets-listes.js'), GRILLE = lire('src/web/pages/accueil-grille.js');
const W = (kind: string, o: Record<string, unknown> = {}): Widget => ({ id: 'c6e00000', kind, w: 1, c: 4, r: 3, ...o }) as unknown as Widget;
const LUI: Lecteur = { qui: 'proprietaire', ecran: 'accueil' }, TABLETTE: Lecteur = { qui: 'maison', ecran: 'maison' };
const membre = (droits: string[], ouverts: string[] = []): Lecteur => ({ qui: 'membre', ecran: 'accueil', peutLire: (a) => droits.includes(a), ouverts: new Set(ouverts) });
const MAINT = 1_800_000_000_000;
type Etat = EtatWidget & { raison?: string; donnee?: Record<string, unknown>; at?: number; appli?: string };
const etat = async (w: Widget, l: Lecteur, src: SourceWidget) => (await donneeWidget(w, l, src)) as Etat;
type Rdv = { id: string; titre: string; debut: number; fin: number; attente: boolean };
type Rech = { id: string; q: string; at: number };

/** Une fausse source : les rendez-vous de Chronos (null : Chronos absente), les recherches de Pythie (null : absente). */
function fausse(o: { rdv?: Rdv[] | null; recherches?: Rech[] | null; fuseau?: string; heure12?: boolean } = {}): SourceWidget {
  const applis: Record<string, { name: string; family: string }> = { frigg: { name: 'Appli agenda', family: 'Données' }, volva: { name: 'Appli recherche', family: 'Données' } };
  return {
    appli: (id) => (applis[id] && !(id === 'frigg' && o.rdv === null) && !(id === 'volva' && o.recherches === null) ? { id, ...applis[id] } : undefined),
    vue: async () => null, action: () => undefined, meteo: async () => undefined,
    lieu: () => ({ choisi: true, nom: 'Lieu A', fuseau: o.fuseau ?? 'Asia/Tokyo', heure12: o.heure12 === true }), maintenant: () => MAINT,
    rendezVous: () => (o.rdv === null ? undefined : { fuseau: o.fuseau ?? 'Asia/Tokyo', liste: o.rdv ?? [] }),
    recherches: () => (o.recherches === null ? undefined : o.recherches ?? []),
  };
}
const rdv = (id: string, h: number, o: Partial<Rdv> = {}): Rdv => ({ id, titre: `Rendez-vous ${id}`, debut: MAINT + h * 3_600_000, fin: MAINT + (h + 1) * 3_600_000, attente: false, ...o });

// ------------------------------------------------------------------ le serveur, sans Odin

test('les deux sortes : famille « listes », tailles de la maquette (3 × 3, 3 × 2 au moins), propriétaire seul, posables', () => {
  for (const [id, applis] of [['agenda', ['frigg']], ['recherches', ['volva']]] as const) {
    const s = sorteDe(id);
    assert.ok(s, `${id} déclarée`); assert.equal(s.famille, 'listes'); assert.equal(s.posable, true); assert.equal(publicDe(s), 'proprietaire', `${id} : propriétaire seul`);
    assert.deepEqual([[...s.taille.mini], s.taille.r, s.applis], [[3, 2], 3, applis], id);
    assert.deepEqual((TAILLE_SORTE as Record<string, unknown>)[id], { mini: [3, 2], r: 3 }, `${id} : la taille gardée par Hestia`);
  }
});

test('l\'agenda : dans l\'ordre, avec le fuseau et le 12 / 24 h d\'Odin ; zéro → « vide » ; Chronos coupée → « source_absente »', async () => {
  const src = fausse({ rdv: [rdv('b', 5), rdv('a', 1, { attente: true }), rdv('c', 30)], fuseau: 'Pacific/Kiritimati', heure12: true });
  const e = await etat(W('agenda'), LUI, src), d = e.donnee as { rendezVous: Array<Record<string, unknown>>; total: number; fuseau: string; heure12: boolean };
  assert.equal(e.etat, 'ok');
  assert.deepEqual(d.rendezVous.map((x) => x.titre), ['Rendez-vous a', 'Rendez-vous b', 'Rendez-vous c'], 'le plus proche d\'abord');
  assert.deepEqual(d.rendezVous[0], { titre: 'Rendez-vous a', debut: MAINT + 3_600_000, fin: MAINT + 7_200_000, attente: true });
  assert.ok(!('attente' in d.rendezVous[1]), 'confirmé : rien de plus');
  assert.deepEqual([d.total, d.fuseau, d.heure12], [3, 'Pacific/Kiritimati', true]);
  assert.deepEqual(await etat(W('agenda'), LUI, fausse({ rdv: [] })), { etat: 'vide', raison: 'aucun_rendez_vous' });
  assert.deepEqual(await etat(W('agenda'), LUI, fausse({ rdv: null })), { etat: 'source_absente', raison: 'appli_absente' });
  // Vingt-cinq rendez-vous : vingt servis au plus, et le total (la page dit « et N de plus »).
  const beaucoup = await etat(W('agenda'), LUI, fausse({ rdv: Array.from({ length: 25 }, (_, i) => rdv(`r${i}`, 25 - i)) }));
  const bd = beaucoup.donnee as { rendezVous: Rdv[]; total: number };
  assert.deepEqual([bd.rendezVous.length, bd.total, bd.rendezVous[0].titre], [20, 25, 'Rendez-vous r24']);
});

test('la recherche : les plus récentes d\'abord ; zéro → « vide » ; Pythie coupée → « source_absente »', async () => {
  const src = fausse({ recherches: [{ id: 'a1b2c3d4e5', q: 'Question A', at: 1000 }, { id: 'f6a7b8c9d0', q: 'Question B', at: 3000 }, { id: '0a0b0c0d0e', q: 'Question C', at: 2000 }] });
  const e = await etat(W('recherches'), LUI, src), d = e.donnee as { recherches: Rech[]; total: number };
  assert.equal(e.etat, 'ok');
  assert.deepEqual(d.recherches.map((x) => x.q), ['Question B', 'Question C', 'Question A']);
  assert.deepEqual(d.recherches[0], { id: 'f6a7b8c9d0', q: 'Question B', at: 3000 }); assert.equal(d.total, 3);
  // Un identifiant qui ne ressemble pas à ceux de Pythie : la recherche est montrée, sans lien vers elle.
  const bizarre = await etat(W('recherches'), LUI, fausse({ recherches: [{ id: '"><x', q: 'Question D', at: 1 }] }));
  assert.deepEqual((bizarre.donnee as { recherches: Rech[] }).recherches, [{ q: 'Question D', at: 1 }]);
  assert.deepEqual(await etat(W('recherches'), LUI, fausse({ recherches: [] })), { etat: 'vide', raison: 'aucune_recherche' });
  assert.deepEqual(await etat(W('recherches'), LUI, fausse({ recherches: null })), { etat: 'source_absente', raison: 'appli_absente' });
});

test('vie privée : un membre (même avec le droit, même « ouvert »), une tablette : refusés, sans un titre ni une question', async () => {
  const src = fausse({ rdv: [rdv('secret', 2)], recherches: [{ id: 'a1b2c3d4e5', q: 'Question secrète', at: 1 }] });
  for (const k of ['agenda', 'recherches']) {
    const w = W(k), appli = k === 'agenda' ? 'frigg' : 'volva';
    for (const [qui, l] of [['membre avec le droit', membre(['frigg', 'volva'])], ['membre ouvert', membre(['frigg', 'volva'], [cleOuverture(w, appli)])], ['tablette', TABLETTE], ['tablette sur l\'accueil', { qui: 'maison', ecran: 'accueil' } as Lecteur]] as const) {
      const r = await etat(w, l, src);
      assert.deepEqual([r.etat, r.raison], ['refuse', 'proprietaire_seul'], `${k} · ${qui}`);
      assert.ok(!/secr/i.test(JSON.stringify(r)), `${k} · ${qui} : aucune donnée`);
    }
    // Même la lecture elle-même refuse qui n'est pas le propriétaire (si un appelant sautait le droit de voir).
    const s = sorteDe(k)!;
    const direct = await s.lire!(w, src, membre(['frigg', 'volva'])) as Etat;
    assert.equal(direct.etat, 'refuse', `${k} : la lecture seule refuse aussi`); assert.ok(!/secr/i.test(JSON.stringify(direct)));
  }
});

// ------------------------------------------------------------------ la page, sans navigateur

test('la page : la famille se déclare (deux sortes, propriétaire seul, tailles de la maquette) ; la grille connaît leurs tailles', () => {
  const win: Record<string, any> = {};
  for (const src of [LISTES, RENDU, GRILLE]) vm.runInNewContext(src, { window: win });
  const R = win.OdinWidgetsRendu, G = win.OdinGrille, ici = <X>(x: X): X => JSON.parse(JSON.stringify(x));
  const vus = ['agenda', 'recherches'].map((k) => R.rendu(k));
  assert.deepEqual(ici(vus.map((x: any) => [x?.sorte, x?.titre, x?.appli, x?.proprio, x?.vides])), [['agenda', 'Agenda', 'frigg', true, ['aucun_rendez_vous']], ['recherches', 'Recherche', 'volva', true, ['aucune_recherche']]]);
  assert.deepEqual(ici(vus.map((x: any) => [x.w.c, x.w.r])), [[3, 3], [3, 3]]);
  // Le tiroir : au propriétaire, les deux ; à un membre, aucune (même avec le droit sur les deux applis).
  assert.deepEqual(ici(R.posables({ proprio: true, aDroit: () => true }).filter((x: any) => x.famille === 'listes').map((x: any) => x.nom)), ['Agenda', 'Recherche']);
  assert.deepEqual(ici(R.posables({ proprio: false, aDroit: () => true }).filter((x: any) => x.famille === 'listes')), []);
  for (const k of ['agenda', 'recherches']) assert.deepEqual([[...G.MINI[k]], G.HAUTEUR[k]], [[...sorteDe(k)!.taille.mini], sorteDe(k)!.taille.r], `${k} : les tables de la grille suivent le serveur`);
  // Le texte d'une donnée : jamais par innerHTML (seules les icônes dessinées ici le sont).
  assert.deepEqual([...LISTES.matchAll(/innerHTML\s*=\s*([^;]+);/g)].map((m) => m[1].trim()), ['icone(k)']);
  // Aucune langue ni aucun fuseau écrits dans le fichier : ceux de la page et d'Odin.
  assert.ok(!new RegExp(`${'fr'}-FR|timeZone:\\s*'[A-Z]`).test(LISTES));
});

test('la page : le jour et l\'heure d\'un rendez-vous dans le fuseau d\'Odin, la langue donnée, 12 ou 24 h ; un fuseau illisible : rien', () => {
  const win: Record<string, any> = {};
  vm.runInNewContext(LISTES, { window: win, Intl, Date });
  const L = win.OdinWidgetsListes;
  // 2026-03-02 00:30 UTC : lundi 2 à 09:30 à Tokyo, mais dimanche 1er à 16:30 à Los Angeles.
  const debut = Date.UTC(2026, 2, 2, 0, 30), fin = debut + 3_600_000;
  const tokyo = L.quand(debut, fin, { fuseau: 'Asia/Tokyo', heure12: false }, 'en', debut - 86_400_000);
  assert.deepEqual([tokyo.num, tokyo.heures], ['2', '09:30 – 10:30']); assert.match(tokyo.jour, /^Mon/);
  const la = L.quand(debut, fin, { fuseau: 'America/Los_Angeles', heure12: true }, 'en', debut - 86_400_000);
  assert.equal(la.num, '1'); assert.match(la.jour, /^Sun/); assert.match(la.heures, /^4:30\s?PM – 5:30\s?PM$/);
  // Une autre langue : les mots de cette langue, la même heure.
  const de = L.quand(debut, fin, { fuseau: 'Asia/Tokyo', heure12: false }, 'de', debut - 86_400_000);
  assert.match(de.jour, /^Mo/); assert.equal(de.heures, '09:30 – 10:30');
  // Sur plusieurs jours : l'heure de fin dit son jour.
  const long = L.quand(debut, debut + 2 * 86_400_000, { fuseau: 'Asia/Tokyo', heure12: false }, 'en', debut - 86_400_000);
  assert.match(long.heures, /^09:30 → .*4.*09:30$/);
  // Loin (plus de six jours) : le mois aussi ; proche : pas besoin.
  assert.equal(tokyo.mois, ''); assert.notEqual(L.quand(debut, fin, { fuseau: 'Asia/Tokyo' }, 'en', debut - 30 * 86_400_000).mois, '');
  // Sans fuseau, ou un fuseau inconnu : rien (jamais celui de l'appareil).
  assert.equal(L.quand(debut, fin, { fuseau: '' }, 'en', debut), null);
  assert.equal(L.quand(debut, fin, { fuseau: 'Pas/Un_Fuseau' }, 'en', debut), null);
  // Combien de lignes selon la hauteur : une de moins que la hauteur en lignes, une au moins.
  assert.deepEqual([1, 2, 3, 5].map(L.combien), [1, 1, 2, 4]);
  // L'agenda, comme la maquette : à partir de quatre lignes, une ligne de plus (une carte de 5 lignes montre 5 rendez-vous).
  assert.deepEqual([1, 2, 3, 4, 5].map((r) => L.combienAgenda(r)), [1, 1, 2, 4, 5]);
});

test('la page : la question du champ, nettoyée comme Pythie la nettoie (contrôles, U+007F, sens d\'écriture, séparateurs de ligne)', () => {
  const win: Record<string, any> = {};
  vm.runInNewContext(LISTES, { window: win });
  const N = win.OdinWidgetsListes.questionNette, car = (...c: number[]) => String.fromCharCode(...c);
  assert.equal(N(`  a\x01b${car(0x7f)}c${car(0x202e)}d${car(0x2028)}e${car(0x2029)}f${car(0x200e, 0x200f, 0x061c)}g${car(0x202a, 0x2066, 0x2069)}h  `), 'a b c d e f g h');
  assert.deepEqual([N(''), N(' \t '), N(car(0x2028, 0x202e)), N(undefined), N({})], ['', '', '', '', '']);
});

test('la page : la question du champ, coupée à 1000 par caractères entiers (jamais une moitié d\'émoji)', () => {
  const win: Record<string, any> = {};
  vm.runInNewContext(LISTES, { window: win });
  const N = win.OdinWidgetsListes.questionNette, emoji = String.fromCodePoint(0x1f600);
  assert.equal(N(`${'x'.repeat(999)}${emoji}`), 'x'.repeat(999), 'jamais une moitié d\'émoji');
  assert.equal(N(`${'x'.repeat(998)}${emoji}z`), `${'x'.repeat(998)}${emoji}`, 'un émoji entier tient');
  assert.equal(N('x'.repeat(5000)).length, 1000);
});

// ------------------------------------------------------------------ un vrai Odin d'essai

const tt = new Banc(), orig = { log: console.log, error: console.error, warn: console.warn, info: console.info };
let v: VraiOdin, avecDroit = '', cleMaison = '', cleComplet = '';
const MDP = 'une-pirogue-sur-le-lagon-calme';
const IDS = ['gladsheim', 'frigg', 'volva', 'var'];
const FUSEAU = 'Asia/Tokyo', APPAREIL = 'America/Los_Angeles';
const cookieDe = (r: Response, nom: string) => r.headers.getSetCookie().find((c) => c.startsWith(`${nom}=`))?.split(';')[0] ?? '';
async function entrer(ident: string, mdp: string): Promise<string> {
  let r = await fetch(`${v.url}/sso/odin`, { redirect: 'manual' }); assert.equal(r.status, 303);
  r = await fetch(new URL(r.headers.get('location')!, v.url), { redirect: 'manual' }); const demande = /name="demande" value="([^"]+)"/.exec(await r.text())![1];
  r = await fetch(`${v.url}/sso/autoriser`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded', origin: v.url }, body: new URLSearchParams({ demande, identifiant: ident, motdepasse: mdp }) });
  r = await fetch(r.headers.get('location')!, { redirect: 'manual' }); assert.equal(r.status, 303, 'session ouverte');
  return cookieDe(r, 'odin_session');
}
const PAGE = 'b6e00001', ID = { agenda: 'c6e00001', recherches: 'c6e00002', agendaVide: 'c6e00003', recherchesVide: 'c6e00004', agendaHaut: 'c6e00005', recherchesBas: 'c6e00006' };
// Une seconde page, marquée « écran de la maison », qui porte les deux sortes : l'écran de la maison la lit vraiment.
const FENETRE = () => ({ pages: [{ id: PAGE, name: 'Listes', widgets: [
  { id: ID.agenda, kind: 'agenda', w: 1, c: 4, r: 3 }, { id: ID.recherches, kind: 'recherches', w: 1, c: 4, r: 3 }, { id: ID.agendaVide, kind: 'agenda', w: 1, c: 4, r: 3 },
  { id: ID.recherchesVide, kind: 'recherches', w: 1, c: 4, r: 3 }, { id: ID.agendaHaut, kind: 'agenda', w: 1, c: 4, r: 5 },
  // La recherche à deux lignes de grille (la plus petite taille) : le champ seul.
  { id: ID.recherchesBas, kind: 'recherches', w: 1, c: 4, r: 2 },
] }, { id: 'b6e00002', name: 'Salon', maison: true, widgets: [{ id: 'c6e00011', kind: 'agenda', w: 1, c: 4, r: 3 }, { id: 'c6e00012', kind: 'recherches', w: 1, c: 4, r: 3 }] }] });
// Un titre et une question piégés : du HTML, et un texte très long sans espace.
const PIEGE = `<img src=x onerror="window.__piege=1">${'x'.repeat(180)}`;
const SECRET = 'Titre-tres-prive';
/** L'heure murale d'un instant dans un fuseau : « AAAA-MM-JJTHH:MM ». */
const murale = (t: number, tz: string) => { const o: Record<string, string> = {}; for (const p of new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(new Date(t))) o[p.type] = p.value; return `${o.year}-${o.month}-${o.day}T${o.hour}:${o.minute}`; };
const aLaMinute = (t: number) => Math.floor(t / 60_000) * 60_000;
/** Les rendez-vous d'essai : un client et un à soi (avec son instant), un annulé, un fini, puis `n` de plus. */
function poserRendezVous(n = 0) {
  const base = aLaMinute(Date.now()) + 2 * 86_400_000, b = (i: number, o: Record<string, unknown>) => ({ id: `e${String(i).padStart(9, '0')}`, service: 'Coupe', name: `Client ${i}`, contact: 'contact-prive@exemple.test', status: 'confirmé', created: new Date().toISOString(), ...o });
  const t1 = base + 3 * 3_600_000, t2 = base + 3_600_000;
  const l = [
    b(1, { start: murale(t1, FUSEAU), end: murale(t1 + 3_600_000, FUSEAU), name: PIEGE, status: 'attente' }),
    b(2, { start: murale(t2, FUSEAU), end: murale(t2 + 1_800_000, FUSEAU), name: SECRET, service: 'Personnel', perso: true, debut: new Date(t2).toISOString() }),
    b(3, { start: murale(base, FUSEAU), end: murale(base + 3_600_000, FUSEAU), status: 'annulé', name: 'Annulé A' }),
    b(4, { start: murale(base - 5 * 86_400_000, FUSEAU), end: murale(base - 5 * 86_400_000 + 3_600_000, FUSEAU), name: 'Fini A' }),
    ...Array.from({ length: n }, (_, i) => { const t = base + (10 + i) * 86_400_000; return b(10 + i, { start: murale(t, FUSEAU), end: murale(t + 3_600_000, FUSEAU) }); }),
  ];
  valhallaOf()!.ctx('frigg').saveSettings({ bookings: l });
  return { t1, t2 };
}
/** Les recherches d'essai, gardées comme Pythie les garde (son historique, les plus récentes d'abord). */
function poserRecherches(l: Array<{ id: string; q: string; at: number }>) {
  const ctx = valhallaOf()!.ctx('volva'); mkdirSync(ctx.dir, { recursive: true });
  writeFileSync(join(ctx.dir, 'historique.json'), JSON.stringify(l.map((x) => ({ ...x, focus: 'tout', answer: 'Réponse', sources: [], engines: [], followups: [], apps: [], ai: false, errors: [] }))));
}
type Rendue = { id: string; kind: string; etat: string; raison?: string; appli?: string; donnee?: Record<string, unknown> };
const donnees = async (h: Record<string, string> = {}) => { const r = await v.json(`/api/widgets/donnees?page=${PAGE}`, undefined, h); return { status: r.status, corps: JSON.stringify(r.body), de: (id: string) => ((r.body.widgets as Rendue[] | undefined) ?? []).find((x) => x.id === id) }; };

before(async () => {
  for (const k of ['log', 'error', 'warn', 'info'] as const) console[k] = () => {};
  v = await vraiOdin(tt, { compte: true, modules: (o) => allModules(o).filter((m) => [...IDS, 'apparence'].includes(m.id)) });
  const va = valhallaOf()!;
  // Un membre qui entre dans Odin, AVEC le droit sur Chronos et sur Pythie.
  assert.equal((await va.act('var', 'ajouter', { login: 'membre-l', nom: 'Membre L', groupes: 'invite', mot_de_passe: MDP })).ok, true);
  for (const appli of ['odin', 'gladsheim', 'frigg', 'volva']) assert.equal((await va.act('var', 'donner_acces', { appli, qui: '@membre-l' })).ok, true);
  lierProprietaire(persona()!);
  avecDroit = await entrer('membre-l', MDP); assert.ok(avecDroit, 'le membre a une session');
  cleMaison = ((await va.act('gladsheim', 'cle_tablette', { nom: 'Tablette maison', droits: 'maison' })).data as { key: string }).key;
  cleComplet = ((await va.act('gladsheim', 'cle_tablette', { nom: 'Tablette complète', droits: 'complet' })).data as { key: string }).key;
  assert.equal((await va.act('apparence', 'theme', { theme: 'valhalla' })).ok, true);
  va.ctx('gladsheim').saveSettings({ fenetre: undefined, fuseau: FUSEAU });
  const r = await va.act('gladsheim', 'regler_fenetre', { fenetre: JSON.stringify(FENETRE()) }); assert.equal(r.ok, true, r.text);
});
after(async () => { await tt.end(); Object.assign(console, orig); });

test('vrai Odin : zéro → « vide » ; puis les rendez-vous à venir, dans l\'ordre, à l\'instant juste dans le fuseau d\'Odin ; ni annulé, ni fini, ni contact', async () => {
  valhallaOf()!.ctx('frigg').saveSettings({ bookings: [] }); poserRecherches([]);
  let d = await donnees();
  assert.equal(d.status, 200);
  assert.deepEqual([d.de(ID.agenda)!.etat, d.de(ID.agenda)!.raison], ['vide', 'aucun_rendez_vous']);
  assert.deepEqual([d.de(ID.recherches)!.etat, d.de(ID.recherches)!.raison], ['vide', 'aucune_recherche']);
  const { t1, t2 } = poserRendezVous();
  d = await donnees();
  const a = d.de(ID.agenda)!, ad = a.donnee as { rendezVous: Rdv[]; total: number; fuseau: string };
  assert.equal(a.etat, 'ok');
  assert.deepEqual(ad.rendezVous.map((x) => [x.titre, x.debut, x.fin]), [[SECRET, t2, t2 + 1_800_000], [`${PIEGE} · Coupe`, t1, t1 + 3_600_000]], 'le plus proche d\'abord ; l\'heure murale lue dans le fuseau d\'Odin');
  assert.deepEqual([ad.rendezVous[1].attente, ad.total, ad.fuseau], [true, 2, FUSEAU]);
  assert.ok(!d.corps.includes('contact-prive') && !d.corps.includes('Annulé A') && !d.corps.includes('Fini A'), 'ni contact, ni annulé, ni fini');
});

test('vrai Odin : les recherches de Pythie, les plus récentes d\'abord', async () => {
  poserRecherches([{ id: 'a1b2c3d4e5', q: 'Question récente', at: Date.now() - 60_000 }, { id: 'f6a7b8c9d0', q: PIEGE, at: Date.now() - 7_200_000 }]);
  const r = (await donnees()).de(ID.recherches)!;
  assert.equal(r.etat, 'ok');
  assert.deepEqual((r.donnee as { recherches: Rech[] }).recherches.map((x) => [x.id, x.q]), [['a1b2c3d4e5', 'Question récente'], ['f6a7b8c9d0', PIEGE]]);
});

test('vrai Odin : un membre avec le droit, une tablette « maison », une clé d\'accès, sans session : rien ; aucun journal, aucune notification', async () => {
  poserRendezVous(); poserRecherches([{ id: 'a1b2c3d4e5', q: 'Question-tres-privee', at: Date.now() }]);
  const notes: string[] = [], avant = v.notified.length;
  for (const k of ['log', 'error', 'warn', 'info'] as const) console[k] = (...a: unknown[]) => { notes.push(a.map(String).join(' ')); };
  try {
    const lui = await donnees();
    assert.equal(lui.de(ID.agenda)!.etat, 'ok'); assert.equal(lui.de(ID.recherches)!.etat, 'ok');
    const m = await donnees({ cookie: avecDroit });
    assert.equal(m.status, 200);
    for (const id of [ID.agenda, ID.recherches]) assert.deepEqual([m.de(id)!.etat, m.de(id)!.raison], ['refuse', 'proprietaire_seul'], `membre : ${id}`);
    for (const [qui, h] of [['tablette', { cookie: '', 'x-odin-maison': cleMaison }], ['clé d\'accès', { cookie: '', authorization: `Bearer ${v.token}` }], ['sans session', { cookie: '' }]] as const) {
      const r = await donnees(h);
      assert.equal(r.status, 401, qui);
      assert.ok(!r.corps.includes(SECRET) && !r.corps.includes('Question-tres-privee'), `${qui} : aucune donnée`);
    }
    assert.ok(!m.corps.includes(SECRET) && !m.corps.includes('Question-tres-privee') && !m.corps.includes('onerror'), 'membre : aucun titre, aucune question');
    // L'écran de la maison, qui sert vraiment la page « Salon » (marquée pour lui, avec les deux sortes) : ni une tablette
    // « maison » ni une clé « complet » n'y reçoivent un titre ou une question.
    for (const [qui, cle] of [['tablette', cleMaison], ['clé « complet »', cleComplet]] as const) {
      const maison = await v.json('/api/maison/etat', undefined, { cookie: '', 'x-odin-maison': cle }), corps = JSON.stringify(maison.body);
      assert.equal(maison.status, 200, qui); assert.ok(corps.includes('"Salon"'), `${qui} : la page de la maison est bien lue`);
      assert.ok(!corps.includes(SECRET) && !corps.includes('Question-tres-privee') && !corps.includes('onerror'), `${qui} : rien sur l'écran de la maison`);
    }
  } finally { for (const k of ['log', 'error', 'warn', 'info'] as const) console[k] = () => {}; }
  assert.ok(!notes.some((n) => n.includes(SECRET) || n.includes('Question-tres-privee')), 'rien dans le journal');
  assert.ok(!v.notified.slice(avant).some((n) => n.includes(SECRET) || n.includes('Question-tres-privee')), 'aucune notification');
  assert.ok(!JSON.stringify(valhallaOf()!.alerts({ limit: 5000 })).includes(SECRET), 'aucune alerte');
});

// ------------------------------------------------------------------ dans un vrai navigateur (s'il y en a un)

declare const document: any, window: any, getComputedStyle: any, location: any, KeyboardEvent: any;
interface Route { fetch(): Promise<{ json(): Promise<any> }>; fulfill(o: Record<string, unknown>): Promise<void>; request(): { postData(): string | null } }
interface Page {
  goto(u: string): Promise<unknown>; waitForSelector(s: string, o?: Record<string, unknown>): Promise<unknown>; click(s: string, o?: Record<string, unknown>): Promise<void>;
  waitForFunction(f: string | ((a: any) => unknown), a?: unknown, o?: Record<string, unknown>): Promise<unknown>; evaluate<X>(f: string | ((a?: any) => X), a?: unknown): Promise<X>;
  route(u: string | RegExp, h: (r: Route) => Promise<void> | void): Promise<void>; on(e: string, f: (x: any) => void): void; screenshot(o: Record<string, unknown>): Promise<unknown>;
  fill(s: string, v: string): Promise<void>; press(s: string, k: string): Promise<void>; reload(): Promise<unknown>; url(): string; waitForTimeout(ms: number): Promise<void>;
}
interface Contexte { newPage(): Promise<Page>; addCookies(c: unknown[]): Promise<void>; addInitScript(f: string | (() => void)): Promise<void>; close(): Promise<void> }
interface Navigateur { newContext(o: Record<string, unknown>): Promise<Contexte>; close(): Promise<void> }
const pw = (() => { try { return createRequire(import.meta.url)('playwright') as { chromium: { launch(): Promise<Navigateur> } }; } catch { return undefined; } })();
const sansNav = pw ? false : 'Playwright n\'est pas installé sur cette machine';
let nav: Navigateur | undefined;
before(async () => { if (pw) nav = await pw.chromium.launch(); });
after(async () => { await nav?.close(); });
const CAPTURES = process.env.ODIN_CAPTURES;

/** L'accueil sur la page d'essai, l'appareil dans un AUTRE fuseau que celui d'Odin ; le second agenda forcé à « vide ». */
async function ouvrir(largeur: number, sombre: boolean, avant = '') {
  const doigt = largeur < 500;
  const ctx = await nav!.newContext({ viewport: { width: largeur, height: doigt ? 800 : 900 }, hasTouch: doigt, isMobile: doigt, timezoneId: APPAREIL, colorScheme: sombre ? 'dark' : 'light' });
  const [n, ...x] = v.session.split('='); await ctx.addCookies([{ name: n, value: x.join('='), url: v.url, httpOnly: true, sameSite: 'Strict' }]);
  await ctx.addInitScript(`try { localStorage.setItem('odin.tour', 'done'); localStorage.setItem('odin.fenetre.page', '1'); ${sombre ? 'localStorage.setItem(\'odin.theme\', \'sombre\');' : ''} } catch { /* rien */ }`);
  if (avant) await ctx.addInitScript(avant);
  const p = await ctx.newPage(), erreurs: string[] = [];
  p.on('pageerror', (e) => erreurs.push(String(e)));
  await p.route(/\/api\/widgets\/donnees/, async (r) => {
    const rep = await r.fetch(), j = await rep.json();
    if (Array.isArray(j?.widgets)) j.widgets = j.widgets.map((w: any) => (w.id === ID.agendaVide ? { id: w.id, kind: w.kind, page: w.page, etat: 'vide', raison: 'aucun_rendez_vous' } : w.id === ID.recherchesVide ? { id: w.id, kind: w.kind, page: w.page, etat: 'vide', raison: 'aucune_recherche' } : w));
    await r.fulfill({ response: rep, json: j });
  });
  await p.goto(v.url + '/');
  await p.waitForSelector('#app:not([hidden])', { timeout: 30000 });
  try { await p.waitForSelector(`#feGrid .fe-w[data-id="${ID.agenda}"] .wl-rdv`, { timeout: 45000 }); }
  catch (e) { const vus = await p.evaluate(() => [location.hash, ...[...document.querySelectorAll('#feGrid > .fe-w')].map((c: any) => `${c.dataset.id}: ${c.textContent.slice(0, 80)}`)]); await ctx.close(); throw new Error(`${String(e).split('\n')[0]} · cartes : ${JSON.stringify(vus)} · ${erreurs.join(' | ')}`); }
  await p.waitForSelector(`#feGrid .fe-w[data-id="${ID.recherches}"] .wl-rech`, { timeout: 30000 });
  return { ctx, page: p, erreurs };
}
/** Ce que la page montre de chaque carte. */
const vu = (p: Page) => p.evaluate((ids: Record<string, string>) => {
  const vw = document.documentElement.clientWidth, txt = (n: any) => (n?.textContent ?? '').replace(/\s+/g, ' ').trim();
  const out: Record<string, any> = { deborde: document.documentElement.scrollWidth > vw + 1, piege: Boolean(window.__piege) || Boolean(document.querySelector('#feGrid img[src="x"]')) };
  for (const [nom, id] of Object.entries(ids)) {
    const c = document.querySelector(`#feGrid > .fe-w[data-id="${id}"]`); if (!c) { out[nom] = null; continue; }
    const b = c.getBoundingClientRect(), dans = (n: any) => { const r = n.getBoundingClientRect(); return r.width === 0 || (r.left >= b.left - 1 && r.right <= b.right + 1); };
    const sonde = document.createElement('i'); c.append(sonde); const couleur = (v: string) => { sonde.style.color = `var(${v})`; return getComputedStyle(sonde).color; };
    out[nom] = {
      texte: txt(c), dedans: [...c.querySelectorAll('*')].every(dans), haut: Math.round(b.height),
      petits: [...c.querySelectorAll('button, a')].filter((n: any) => { const r = n.getBoundingClientRect(); return r.width && (r.width < 44 || r.height < 44); }).map(txt),
      titres: [...c.querySelectorAll('.wl-t')].map(txt), jours: [...c.querySelectorAll('.wl-j')].map(txt), heures: [...c.querySelectorAll('.wl-h')].map(txt),
      liens: [...c.querySelectorAll('a.wl-rech')].map((a: any) => a.getAttribute('href')), plus: txt(c.querySelector('.wl-plus')),
      bouton: txt(c.querySelector('.wl-calme ~ .wl-btn')), lignes: c.querySelectorAll('.wl-rdv, .wl-rech').length,
      ink: couleur('--ink'), muted: couleur('--muted'), titreCouleur: c.querySelector('.wl-t') ? getComputedStyle(c.querySelector('.wl-t')).color : '',
    };
    sonde.remove();
  }
  return out;
}, ID);
/** L'heure attendue dans le fuseau d'Odin (24 h), « HH:MM ». */
const hhmm = (t: number) => new Intl.DateTimeFormat('en', { timeZone: FUSEAU, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(t));

for (const [largeur, sombre] of [[1280, false], [390, true]] as const) {
  test(`navigateur, ${largeur} px, ${sombre ? 'sombre' : 'clair'} : l'heure d'Odin et pas celle de l'appareil, le titre piégé en texte, vingt rendez-vous sans étirer la carte, « Ouvrir Chronos », la recherche qui rouvre Pythie`, { skip: sansNav }, async () => {
    const { t2 } = poserRendezVous(20);
    poserRecherches([{ id: 'a1b2c3d4e5', q: 'Question récente', at: Date.now() - 60_000 }, { id: 'f6a7b8c9d0', q: PIEGE, at: Date.now() - 7_200_000 }]);
    const { ctx, page: p, erreurs } = await ouvrir(largeur, sombre);
    try {
      const a = await vu(p);
      assert.equal(a.deborde, false, 'rien ne déborde de la page'); assert.equal(a.piege, false, 'le titre piégé n\'est jamais du code');
      // Le premier rendez-vous : à son heure dans le fuseau d'Odin (l'appareil est ailleurs).
      assert.equal(a.agenda.titres[0], SECRET); assert.ok(a.agenda.heures[0].startsWith(hhmm(t2)), `${a.agenda.heures[0]} commence par ${hhmm(t2)}`);
      assert.equal(a.agenda.titres[1], `${PIEGE} · Coupe`, 'le titre piégé, tel quel, en texte'); assert.equal(a.agenda.dedans, true, 'le titre très long reste dans sa carte');
      assert.equal(a.agenda.lignes, 2, 'trois lignes de grille : deux rendez-vous'); assert.match(a.agenda.plus, /20/, 'et 20 de plus');
      assert.match(a.agendaVide.texte, /Aucun rendez-vous/); assert.equal(a.agendaVide.bouton, 'Ouvrir Chronos');
      assert.deepEqual(a.recherches.liens, ['/recherche#r=a1b2c3d4e5', '/recherche#r=f6a7b8c9d0'], 'les plus récentes d\'abord, chacune vers sa recherche');
      assert.equal(a.recherches.titres[1], PIEGE); assert.equal(a.recherches.dedans, true);
      if (largeur > 700) for (const k of ['agenda', 'recherches', 'agendaVide']) assert.ok(Math.abs(a[k].haut - 250) <= 2, `${k} : ${a[k].haut} px pour 3 lignes`);
      for (const k of ['agenda', 'recherches', 'agendaVide']) assert.deepEqual(a[k].petits, [], `${k} : des cibles de 44 px`);
      assert.equal(a.agenda.titreCouleur, a.agenda.ink, 'le titre : la couleur du texte du thème');
      if (CAPTURES) await p.screenshot({ path: `${CAPTURES}/listes-${largeur}${sombre ? '-sombre' : ''}.png`, fullPage: true });
      // Le focus se voit (un contour), sur une recherche.
      await p.evaluate((s: string) => document.querySelector(s).focus(), `#feGrid .fe-w[data-id="${ID.recherches}"] a.wl-rech`);
      assert.notEqual(await p.evaluate(() => getComputedStyle(document.activeElement).outlineStyle), 'none', 'le focus est visible');
      // « Ouvrir Chronos » ouvre l'appli.
      await p.click(`#feGrid .fe-w[data-id="${ID.agendaVide}"] .wl-btn`);
      assert.equal(await p.evaluate(() => location.hash), '#app=frigg');
      assert.deepEqual(erreurs, [], 'aucune erreur dans la page');
    } finally { await ctx.close(); }
  });
}

test('navigateur, 768 px : « à confirmer » entier, la zone des listes sans défilement propre (pas d\'arrêt du clavier sans nom), l\'icône et la phrase d\'un état calme sur une ligne, cinq lignes de grille : cinq rendez-vous', { skip: sansNav }, async () => {
  poserRendezVous(20); poserRecherches([{ id: 'a1b2c3d4e5', q: 'Question récente', at: Date.now() - 60_000 }]);
  for (const sombre of [false, true]) {
    const { ctx, page: p, erreurs } = await ouvrir(768, sombre);
    try {
      await p.waitForSelector(`#feGrid .fe-w[data-id="${ID.recherchesVide}"] .wl-calme`, { timeout: 30000 });
      const m = await p.evaluate((ids: Record<string, string>) => {
        const carte = (id: string) => document.querySelector(`#feGrid > .fe-w[data-id="${id}"]`);
        const at = carte(ids.agenda).querySelector('.wl-at'), h = at?.closest('.wl-h');
        const a = at?.getBoundingClientRect(), b = h?.getBoundingClientRect();
        const calme = carte(ids.recherchesVide).querySelector('.wl-calme'), ic = calme.querySelector('svg').getBoundingClientRect(), tx = calme.lastElementChild.getBoundingClientRect();
        return {
          at: at ? { texte: at.textContent, entier: a.right <= b.right + 1 && a.left >= b.left - 1 && at.scrollWidth <= at.clientWidth + 1 } : null,
          corpsDefile: [...document.querySelectorAll('#feGrid .wl-corps')].filter((c: any) => c.querySelector('.wl-defile') && /auto|scroll/.test(getComputedStyle(c).overflowY) && c.scrollHeight > c.clientHeight).length,
          memeLigne: tx.left >= ic.right - 1 && tx.top < ic.bottom,
          haut: carte(ids.agendaHaut).querySelectorAll('.wl-rdv').length,
        };
      }, ID);
      assert.ok(m.at, 'le rendez-vous « à confirmer » est montré');
      // Tout d'un coup, pour voir chaque écart : « à confirmer » pas coupé ; seule la liste défile, jamais la zone qui la
      // porte ; l'icône et la phrase sur la même ligne ; cinq lignes de grille : cinq rendez-vous, comme la maquette.
      assert.deepEqual({ entier: m.at!.entier, corpsDefile: m.corpsDefile, memeLigne: m.memeLigne, haut: m.haut }, { entier: true, corpsDefile: 0, memeLigne: true, haut: 5 }, `sombre : ${sombre}`);
      const a = await vu(p);
      assert.equal(a.deborde, false); for (const k of ['agenda', 'agendaHaut', 'recherchesVide']) assert.equal(a[k].dedans, true, `${k} reste dans sa carte`);
      assert.deepEqual(erreurs, []);
    } finally { await ctx.close(); }
  }
});

test('navigateur, 320 et 1920 px : rien ne déborde', { skip: sansNav }, async () => {
  poserRendezVous(3); poserRecherches([{ id: 'f6a7b8c9d0', q: PIEGE, at: Date.now() - 60_000 }]);
  for (const largeur of [320, 1920]) {
    const { ctx, page: p, erreurs } = await ouvrir(largeur, false);
    try {
      const a = await vu(p);
      assert.equal(a.deborde, false, `${largeur} : la page ne déborde pas`);
      for (const k of ['agenda', 'recherches']) assert.equal(a[k].dedans, true, `${largeur} : ${k} reste dans sa carte`);
      assert.deepEqual(erreurs, []);
    } finally { await ctx.close(); }
  }
});

test('navigateur, un thème de verre : les listes gardent les couleurs que le thème donne à la carte, rien ne déborde', { skip: sansNav }, async (t) => {
  poserRendezVous(); poserRecherches([{ id: 'a1b2c3d4e5', q: 'Question récente', at: Date.now() - 60_000 }]);
  const va = valhallaOf()!, verre = await va.act('apparence', 'theme', { theme: 'glace' });
  if (!verre.ok) { t.skip('le thème de verre ne se pose pas sur cet Odin'); return; }
  const { ctx, page: p, erreurs } = await ouvrir(1280, false);
  try {
    assert.equal(await p.evaluate(() => document.documentElement.dataset.odinTheme), 'glace', 'le thème de verre est posé');
    const a = await vu(p);
    for (const k of ['agenda', 'recherches']) { assert.equal(a[k].titreCouleur, a[k].ink, `${k} : le texte, couleur du texte de la carte`); assert.equal(a[k].dedans, true); }
    assert.equal(a.deborde, false);
    if (CAPTURES) await p.screenshot({ path: `${CAPTURES}/listes-1280-verre.png`, fullPage: true });
    assert.deepEqual(erreurs, []);
  } finally { await ctx.close(); await va.act('apparence', 'theme', { theme: 'valhalla' }); }
});

// ------------------------------------------------------------------ le champ « Pose ta question… » (maquette validée)
// Le widget « Recherche » porte d'abord un champ et son bouton ; la liste vient dessous, à partir de trois lignes de
// grille. Valider le champ confie la question à la page de Pythie par le stockage de session de l'onglet (jamais dans
// une adresse, jamais dans l'historique), puis ouvre Pythie, qui la lit, l'efface et la cherche.

const CLE_QUESTION = 'odin.pythie.question';
/** Toutes les requêtes d'une page (adresse et corps), et ce que reçoit la recherche de Pythie (jamais une vraie). */
async function suivre(p: Page) {
  const requetes: Array<{ url: string; corps: string }> = [], cherchees: string[] = [];
  p.on('request', (r: any) => { requetes.push({ url: r.url(), corps: r.postData() ?? '' }); });
  await p.route(/\/api\/recherche\/chercher/, async (r) => { cherchees.push(JSON.parse(r.request().postData() || '{}').question); await r.fulfill({ json: { ok: false, error: 'essai' } }); });
  return { requetes, cherchees };
}
/** Une question n'est dans aucune adresse (ni écrite telle quelle, ni encodée). */
const dansUneAdresse = (requetes: Array<{ url: string }>, q: string) => requetes.some((r) => { let d = r.url; try { d = decodeURIComponent(r.url.replace(/\+/g, ' ')); } catch { /* telle quelle */ } return r.url.includes(q) || r.url.includes(encodeURIComponent(q)) || d.includes(q); });
const attendre = async (f: () => boolean, ms = 15000) => { const fin = Date.now() + ms; while (!f()) { if (Date.now() > fin) return false; await new Promise((x) => setTimeout(x, 50)); } return true; };
const champDe = (id: string) => `#feGrid .fe-w[data-id="${id}"] form.wl-srch`;

for (const [largeur, sombre] of [[1280, false], [390, true]] as const) {
  test(`navigateur, ${largeur} px, ${sombre ? 'sombre' : 'clair'} : le champ « Pose ta question… » et son bouton « Chercher » ; à 2 lignes le champ seul, à 3 lignes le champ puis la liste, qui tient dans la carte`, { skip: sansNav }, async () => {
    poserRendezVous();
    poserRecherches(Array.from({ length: 6 }, (_, i) => ({ id: `a1b2c3d4e${i}`, q: i === 1 ? PIEGE : `Question ${i}`, at: Date.now() - (i + 1) * 60_000 })));
    const { ctx, page: p, erreurs } = await ouvrir(largeur, sombre);
    try {
      await p.waitForSelector(champDe(ID.recherchesBas), { timeout: 30000 });
      const m = await p.evaluate((ids: Record<string, string>) => {
        const out: Record<string, any> = {};
        for (const [nom, id] of Object.entries(ids)) {
          const c = document.querySelector(`#feGrid > .fe-w[data-id="${id}"]`), f = c?.querySelector('form.wl-srch'), i = f?.querySelector('input'), b = f?.querySelector('button[type="submit"]');
          const liste = c?.querySelector('.wl-liste, .wl-calme'), lab = i?.labels?.[0], defile = c?.querySelector('.wl-defile'), cb = c?.getBoundingClientRect();
          const taille = (n: any) => { const r = n?.getBoundingClientRect(); return r ? [Math.round(r.width), Math.round(r.height)] : null; };
          out[nom] = {
            form: Boolean(f), label: lab ? lab.textContent : null, labelCache: lab ? lab.getBoundingClientRect().width <= 1 : null,
            placeholder: i?.getAttribute('placeholder') ?? null, bouton: b ? b.getAttribute('aria-label') : null,
            champ: taille(i), cible: taille(b), liste: Boolean(liste), avant: f && liste ? Boolean(f.compareDocumentPosition(liste) & 4) : null,
            lignes: c ? c.querySelectorAll('.wl-rech').length : 0, plus: (c?.querySelector('.wl-plus')?.textContent ?? '').trim(),
            tient: defile ? defile.scrollHeight <= defile.clientHeight + 1 : null,
            dedans: c ? [...c.querySelectorAll('*')].every((n: any) => { const r = n.getBoundingClientRect(); return r.width === 0 || (r.left >= cb.left - 1 && r.right <= cb.right + 1 && r.bottom <= cb.bottom + 1); }) : null,
            haut: cb ? Math.round(cb.height) : 0,
          };
        }
        return out;
      }, { recherches: ID.recherches, recherchesBas: ID.recherchesBas, recherchesVide: ID.recherchesVide });
      for (const k of ['recherches', 'recherchesBas', 'recherchesVide']) {
        const x = m[k];
        assert.deepEqual([x.form, x.label, x.labelCache, x.placeholder, x.bouton], [true, 'Question', true, 'Pose ta question…', 'Chercher'], `${k} : les mots de la maquette`);
        assert.ok(x.champ[1] >= 44 && x.cible[0] >= 44 && x.cible[1] >= 44, `${k} : 44 px au doigt (${x.champ} · ${x.cible})`);
        assert.equal(x.dedans, true, `${k} : tout reste dans la carte`);
      }
      assert.deepEqual([m.recherchesBas.liste, m.recherchesBas.lignes], [false, 0], 'deux lignes de grille : le champ seul');
      assert.deepEqual([m.recherches.liste, m.recherches.avant], [true, true], 'trois lignes : le champ, puis la liste');
      assert.ok(m.recherches.lignes >= 1, 'au moins une recherche'); assert.equal(m.recherches.plus, `et ${6 - m.recherches.lignes} de plus`);
      assert.equal(m.recherches.tient, true, 'la liste tient dans la carte, sans défiler');
      assert.deepEqual([m.recherchesVide.liste, m.recherchesVide.avant], [true, true], 'aucune recherche : le champ, puis l\'état calme');
      if (largeur > 700) { assert.ok(Math.abs(m.recherches.haut - 250) <= 2, `la carte ne s'étire pas (${m.recherches.haut} px)`); assert.ok(m.recherchesBas.haut < m.recherches.haut); }
      const a = await vu(p); assert.equal(a.deborde, false); assert.equal(a.piege, false);
      // Le focus se voit, sur le champ et sur le bouton.
      for (const s of ['input', 'button[type="submit"]']) {
        await p.evaluate((x: string) => document.querySelector(x).focus(), `${champDe(ID.recherches)} ${s}`);
        assert.notEqual(await p.evaluate(() => getComputedStyle(document.activeElement).outlineStyle), 'none', `le focus se voit (${s})`);
      }
      // Le texte du champ : la couleur du texte du thème.
      assert.equal(await p.evaluate((x: string) => getComputedStyle(document.querySelector(x)).color, `${champDe(ID.recherches)} input`), a.recherches.ink);
      if (CAPTURES) await p.screenshot({ path: `${CAPTURES}/listes-champ-${largeur}${sombre ? '-sombre' : ''}.png`, fullPage: true });
      assert.deepEqual(erreurs, []);
    } finally { await ctx.close(); }
  });
}

test('navigateur : Entrée et le bouton ouvrent Pythie sur la question ; la question n\'est dans aucune adresse, ni dans une requête de l\'accueil, ni dans le journal ; recharger ne relance pas ; le champ se vide', { skip: sansNav }, async () => {
  poserRendezVous(); poserRecherches([{ id: 'a1b2c3d4e5', q: 'Question récente', at: Date.now() - 60_000 }]);
  const Q1 = 'Question-du-champ-une', Q2 = 'Question-du-champ-deux';
  // Ce qui reste dans le champ quand la page de l'accueil s'en va.
  const reste = `addEventListener('pagehide', () => { try { const i = document.querySelector('${champDe(ID.recherches)} input'); if (i) sessionStorage.setItem('essai.reste', i.value); } catch { /* rien */ } });`;
  const notes: string[] = [], avant = v.notified.length;
  for (const k of ['log', 'error', 'warn', 'info'] as const) console[k] = (...a: unknown[]) => { notes.push(a.map(String).join(' ')); };
  const { ctx, page: p, erreurs } = await ouvrir(1280, false, reste);
  try {
    const { requetes, cherchees } = await suivre(p);
    // L'accueil rechargé une fois suivi : toutes ses requêtes sont vues.
    await p.goto(v.url + '/'); await p.waitForSelector(`${champDe(ID.recherches)} input`, { timeout: 45000 });
    // Entrée.
    await p.fill(`${champDe(ID.recherches)} input`, `  ${Q1}  `);
    const deLAccueil = requetes.length;
    await p.press(`${champDe(ID.recherches)} input`, 'Enter');
    assert.ok(await attendre(() => cherchees.length === 1), 'Pythie cherche');
    assert.deepEqual(cherchees, [Q1], 'la question, nettoyée');
    const u = new URL(p.url()); assert.equal(u.pathname + u.search + u.hash, '/recherche', 'l\'adresse : Pythie seule');
    assert.equal(await p.evaluate((k: string) => [sessionStorage.getItem(k), sessionStorage.getItem('essai.reste')].join('|'), CLE_QUESTION), '|', 'la question confiée est effacée ; le champ s\'est vidé');
    assert.equal(await p.evaluate(() => (performance as any).getEntriesByType('navigation').map((e: any) => e.name).join(' ')), `${v.url}/recherche`);
    // L'accueil n'a rien envoyé qui porte la question (ni adresse ni corps) : seule la page de Pythie l'a postée.
    const versPythie = requetes.findIndex((r, i) => i >= deLAccueil && new URL(r.url).pathname === '/recherche');
    assert.ok(versPythie > 0, 'Pythie est ouverte');
    assert.ok(!requetes.slice(0, versPythie).some((r) => r.url.includes(Q1) || r.corps.includes(Q1)), 'aucune requête de l\'accueil ne porte la question');
    assert.equal(dansUneAdresse(requetes, Q1), false, 'la question n\'est dans aucune adresse');
    assert.deepEqual(requetes.filter((r) => r.corps.includes(Q1)).map((r) => new URL(r.url).pathname), ['/api/recherche/chercher'], 'seule la recherche de Pythie la porte, dans son corps');
    // Recharger Pythie ne relance rien.
    const n = requetes.length; await p.reload();
    assert.ok(await attendre(() => requetes.slice(n).some((r) => r.url.includes('/api/recherche/etat'))));
    await p.waitForTimeout(800); assert.equal(cherchees.length, 1, 'un rechargement ne relance pas la recherche');
    // Le bouton.
    await p.goto(v.url + '/');
    await p.waitForSelector(champDe(ID.recherches), { timeout: 45000 });
    await p.fill(`${champDe(ID.recherches)} input`, Q2);
    await p.click(`${champDe(ID.recherches)} button[type="submit"]`);
    assert.ok(await attendre(() => cherchees.length === 2), 'le bouton lance aussi');
    assert.deepEqual(cherchees, [Q1, Q2]); assert.equal(dansUneAdresse(requetes, Q2), false);
    assert.deepEqual(erreurs, []);
  } finally { await ctx.close(); for (const k of ['log', 'error', 'warn', 'info'] as const) console[k] = () => {}; }
  assert.ok(!notes.some((x) => x.includes(Q1) || x.includes(Q2)), 'rien dans le journal');
  assert.ok(!v.notified.slice(avant).some((x) => x.includes(Q1) || x.includes(Q2)), 'aucune notification');
});

test('navigateur : un champ vide ou de blancs ne lance rien ; en mode « Modifier », ni le champ ni une recherche ne quittent la page', { skip: sansNav }, async () => {
  poserRendezVous(); poserRecherches([{ id: 'a1b2c3d4e5', q: 'Question récente', at: Date.now() - 60_000 }]);
  const { ctx, page: p, erreurs } = await ouvrir(1280, false);
  try {
    const { cherchees } = await suivre(p), ici = () => p.evaluate((k: string) => `${location.pathname}|${sessionStorage.getItem(k) ?? ''}`, CLE_QUESTION);
    await p.click(`${champDe(ID.recherches)} button[type="submit"]`);
    await p.fill(`${champDe(ID.recherches)} input`, ' \t  '); await p.press(`${champDe(ID.recherches)} input`, 'Enter');
    await p.waitForTimeout(600);
    assert.deepEqual([await ici(), cherchees.length], ['/|', 0], 'vide ou blancs : rien');
    await p.evaluate(() => window.OdinFenetre.edit(true));
    await p.waitForSelector(`#fenetre.fe-edit ${champDe(ID.recherches)}`, { timeout: 15000 });
    await p.fill(`${champDe(ID.recherches)} input`, 'Question-en-modifier');
    await p.press(`${champDe(ID.recherches)} input`, 'Enter');
    await p.click(`${champDe(ID.recherches)} button[type="submit"]`);
    await p.click(`#feGrid .fe-w[data-id="${ID.recherches}"] a.wl-rech`);
    await p.waitForTimeout(600);
    assert.deepEqual([await ici(), cherchees.length], ['/|', 0], 'en mode « Modifier », rien ne quitte la page');
    assert.deepEqual(erreurs, []);
  } finally { await ctx.close(); }
});

test('navigateur : stockage de session fermé : le champ ouvre Pythie sans question (rien n\'échoue en silence, rien ne part)', { skip: sansNav }, async () => {
  poserRendezVous(); poserRecherches([{ id: 'a1b2c3d4e5', q: 'Question récente', at: Date.now() - 60_000 }]);
  const ferme = 'Object.defineProperty(window, \'sessionStorage\', { configurable: true, get() { throw new DOMException(\'ferme\', \'SecurityError\'); } });';
  const { ctx, page: p, erreurs } = await ouvrir(390, false, ferme);
  try {
    const { requetes, cherchees } = await suivre(p);
    await p.fill(`${champDe(ID.recherches)} input`, 'Question-sans-stockage');
    await p.press(`${champDe(ID.recherches)} input`, 'Enter');
    assert.ok(await attendre(() => requetes.some((r) => r.url.includes('/api/recherche/etat'))), 'Pythie est ouverte');
    await p.waitForTimeout(600);
    const u = new URL(p.url()); assert.equal(u.pathname + u.search, '/recherche');
    assert.deepEqual(cherchees, [], 'sans question'); assert.equal(dansUneAdresse(requetes, 'Question-sans-stockage'), false);
    assert.ok(!requetes.some((r) => r.corps.includes('Question-sans-stockage')));
    assert.deepEqual(erreurs, []);
  } finally { await ctx.close(); }
});

// L'ordre des gestes sur la clé et le départ de la recherche, vus depuis la page.
const espion = `(() => { const o = (window.__ordre = []), S = Storage.prototype, g = S.getItem, x = S.removeItem, f = window.fetch;
  window.__brut = (k) => g.call(sessionStorage, k);
  S.removeItem = function (k) { if (k === '${CLE_QUESTION}') o.push('efface'); return x.call(this, k); };
  window.__lire = (fn) => { S.getItem = function (k) { return k === '${CLE_QUESTION}' ? fn(g.call(this, k)) : g.call(this, k); }; };
  window.fetch = function (u, ...r) { if (String(u).includes('/api/recherche/chercher')) { o.push('cherche'); window.__titre = document.querySelector('h1.q')?.textContent ?? ''; } return f.call(this, u, ...r); }; })();`;
// La question est posée comme le widget la pose : datée ({ q, t }), `age` ms plus tôt ; `brut` : un texte posé tel quel.
async function pythie(chemin: string, valeur: string | null, lire = '', o: { age?: number; brut?: string } = {}) {
  const ctx = await nav!.newContext({ viewport: { width: 1280, height: 900 } });
  const [n, ...x] = v.session.split('='); await ctx.addCookies([{ name: n, value: x.join('='), url: v.url, httpOnly: true, sameSite: 'Strict' }]);
  const pose = o.brut !== undefined ? JSON.stringify(o.brut) : `JSON.stringify({ q: ${JSON.stringify(valeur)}, t: Date.now() - ${o.age ?? 0} })`;
  await ctx.addInitScript(`${valeur === null && o.brut === undefined ? '' : `try { if (!localStorage.getItem('essai.pose')) { localStorage.setItem('essai.pose', '1'); sessionStorage.setItem('${CLE_QUESTION}', ${pose}); } } catch { /* rien */ }`} ${espion} ${lire ? `window.__lire(${lire});` : ''}`);
  const p = await ctx.newPage(), erreurs: string[] = []; p.on('pageerror', (e) => erreurs.push(String(e)));
  try {
    const s = await suivre(p);
    await p.goto(v.url + chemin);
    assert.ok(await attendre(() => s.requetes.some((r) => r.url.includes('/api/recherche/etat'))), `${chemin} · ${String(valeur).slice(0, 12)} · ${lire} : ${s.requetes.map((r) => r.url).join(' ')} ${erreurs.join(' | ')}`);
    await p.waitForTimeout(700);
    const fin = await p.evaluate((k: string) => ({ ordre: window.__ordre, reste: (() => { try { return window.__brut(k); } catch { return 'illisible'; } })(), titre: window.__titre ?? '', piege: Boolean(window.__piege) || Boolean(document.querySelector('img[src="x"]')) }), CLE_QUESTION);
    return { ...s, ...fin, erreurs };
  } finally { await ctx.close(); }
}
test('navigateur, la page de Pythie : la question confiée est effacée AVANT la recherche, bornée à 1000 caractères, sans caractère de contrôle, et reste du texte ; vide, blancs, autre chose qu\'un texte, lecture en échec : rien ; « ?q= » et « #r= » inchangés', { skip: sansNav }, async () => {
  poserRecherches([{ id: 'a1b2c3d4e5', q: 'Question gardée', at: Date.now() - 60_000 }]);
  // Piégée et très longue, avec des caractères de contrôle : nettoyée comme le serveur la nettoie, en texte.
  const brute = `\x01 ${PIEGE}\x02\n${'y'.repeat(5000)}`, nette = brute.replace(/[\x00-\x1f]+/g, ' ').trim().slice(0, 1000);
  const a = await pythie('/recherche', brute);
  assert.deepEqual(a.cherchees, [nette]); assert.equal(a.cherchees[0].length, 1000);
  assert.deepEqual(a.ordre, ['efface', 'cherche'], 'la clé est effacée avant la recherche'); assert.equal(a.reste, null);
  assert.ok(a.titre.startsWith('<img'), 'la question piégée est montrée en texte'); assert.equal(a.piege, false); assert.deepEqual(a.erreurs, []);
  // Rien à chercher : la clé est quand même effacée.
  for (const [quoi, valeur, lire] of [['vide', '', ''], ['blancs et contrôles', ' \x01\x02 \t \n ', ''], ['autre chose qu\'un texte', 'x', '() => ({ length: 3 })'], ['lecture en échec', 'Question-illisible', '() => { throw new Error(\'lecture\'); }']] as const) {
    const r = await pythie('/recherche', valeur, lire);
    assert.deepEqual([r.cherchees, r.ordre.includes('efface'), r.reste, r.erreurs], [[], true, null, []], quoi);
  }
  // Les chemins d'avant ne changent pas : « ?q=…&mode=pythie » cherche (sans « mode », le serveur sert sa page de
  // résultats, sans cette page), « #r= » rouvre une recherche gardée.
  const q = await pythie('/recherche?q=Question-du-moteur&mode=pythie', null);
  assert.deepEqual(q.cherchees, ['Question-du-moteur']);
  const r = await pythie('/recherche#r=a1b2c3d4e5', null);
  assert.deepEqual(r.cherchees, []); assert.ok(r.requetes.some((x) => x.url.includes('/api/recherche/entree?id=a1b2c3d4e5')), '#r= rouvre la recherche');
});

test('navigateur, la page de Pythie : une question restée dans l\'onglet ne passe jamais devant « #r= » ni « ?q= » (ignorée, effacée)', { skip: sansNav }, async () => {
  poserRecherches([{ id: 'a1b2c3d4e5', q: 'Question gardée', at: Date.now() - 60_000 }]);
  // Une question restée dans l'onglet ne passe jamais devant ce que l'adresse demande : elle est ignorée, et effacée.
  const rr = await pythie('/recherche#r=a1b2c3d4e5', 'Question-restee');
  assert.deepEqual([rr.cherchees, rr.reste, rr.ordre.includes('efface')], [[], null, true], 'clé restée puis #r= : rien n\'est cherché');
  assert.ok(rr.requetes.some((x) => x.url.includes('/api/recherche/entree?id=a1b2c3d4e5')), 'clé restée puis #r= : la recherche choisie s\'ouvre');
  const qq = await pythie('/recherche?q=Question-de-l-adresse&mode=pythie', 'Question-restee');
  assert.deepEqual([qq.cherchees, qq.reste], [['Question-de-l-adresse'], null], 'clé restée puis ?q= : la question de l\'adresse');
});

test('navigateur, la page de Pythie : la question confiée vaut 15 secondes (vieille de 16 s, future, sans heure, ancienne forme, heure illisible : rien, et effacée)', { skip: sansNav }, async () => {
  poserRecherches([{ id: 'a1b2c3d4e5', q: 'Question gardée', at: Date.now() - 60_000 }]);
  // Son heure : moins de 15 secondes ; trop vieille, future, absente ou illisible : refusée, et effacée.
  for (const [quoi, o] of [['16 secondes', { age: 16_000 }], ['dans le futur', { age: -60_000 }], ['sans heure', { brut: JSON.stringify({ q: 'Question-restee' }) }], ['ancienne forme', { brut: 'Question-restee' }], ['heure illisible', { brut: JSON.stringify({ q: 'Question-restee', t: 'hier' }) }]] as const) {
    const z = await pythie('/recherche', 'Question-restee', '', o);
    assert.deepEqual([z.cherchees, z.reste, z.ordre.includes('efface'), z.erreurs], [[], null, true, []], quoi);
  }
  const frais = await pythie('/recherche', 'Question-fraiche', '', { age: 3_000 });
  assert.deepEqual(frais.cherchees, ['Question-fraiche'], 'moins de 15 secondes : cherchée');
});

test('navigateur, la page de Pythie : la question coupée par caractères entiers, sans U+007F, sens d\'écriture ni séparateur de ligne', { skip: sansNav }, async () => {
  // Coupée par caractères entiers (jamais une moitié d'émoji) ; ni U+007F, ni sens d'écriture, ni séparateur de ligne.
  const emoji = String.fromCodePoint(0x1f600), car = (...c: number[]) => String.fromCharCode(...c);
  const e1 = await pythie('/recherche', `${'y'.repeat(999)}${emoji}zz`);
  assert.deepEqual(e1.cherchees, ['y'.repeat(999)], 'la moitié d\'émoji n\'est pas envoyée');
  const e2 = await pythie('/recherche', `a${car(0x202e)}b${car(0x2028)}c${car(0x7f)}d${car(0x200f, 0x2066)}e${car(0x2029)}`);
  assert.deepEqual(e2.cherchees, ['a b c d e']);
});

test('navigateur : le champ a 1000 caractères au plus (rien n\'est coupé sans le dire)', { skip: sansNav }, async () => {
  poserRendezVous(); poserRecherches([{ id: 'a1b2c3d4e5', q: 'Question récente', at: Date.now() - 60_000 }]);
  const { ctx, page: p } = await ouvrir(1280, false);
  try { assert.equal(await p.evaluate((x: string) => document.querySelector(x).maxLength, `${champDe(ID.recherches)} input`), 1000); } finally { await ctx.close(); }
});

test('navigateur : Entrée pendant la composition d\'un caractère (clavier japonais, accent mort) n\'envoie pas', { skip: sansNav }, async () => {
  poserRendezVous(); poserRecherches([{ id: 'a1b2c3d4e5', q: 'Question récente', at: Date.now() - 60_000 }]);
  const { ctx, page: p, erreurs } = await ouvrir(1280, false);
  try {
    const { cherchees } = await suivre(p);
    // La touche Entrée qui valide un caractère composé est retenue (isComposing, ou le code 229) ; hors composition, libre.
    const retenue = await p.evaluate((x: string) => {
      const i = document.querySelector(x); i.value = 'Question-en-composition';
      const a = new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true, cancelable: true });
      const b = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }); Object.defineProperty(b, 'keyCode', { get: () => 229 });
      const c = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
      return [i.dispatchEvent(a), i.dispatchEvent(b), i.dispatchEvent(c)];
    }, `${champDe(ID.recherches)} input`);
    assert.deepEqual(retenue, [false, false, true]);
    await p.waitForTimeout(300); assert.deepEqual([new URL(p.url()).pathname, cherchees.length], ['/', 0]);
    assert.deepEqual(erreurs, []);
  } finally { await ctx.close(); }
});

test('navigateur : Pythie ne s\'ouvre pas (Odin injoignable) : au retour sur l\'accueil, la question confiée n\'est plus là', { skip: sansNav }, async () => {
  poserRendezVous(); poserRecherches([{ id: 'a1b2c3d4e5', q: 'Question récente', at: Date.now() - 60_000 }]);
  const { ctx, page: p } = await ouvrir(1280, false);
  try {
    const { cherchees } = await suivre(p), entree = `${champDe(ID.recherches)} input`;
    await p.route(/\/recherche$/, (r: any) => r.abort());
    await p.fill(entree, 'Question-qui-reste'); await p.press(entree, 'Enter');
    await p.waitForTimeout(800);
    await p.goto(v.url + '/'); await p.waitForSelector(entree, { timeout: 45000 });
    assert.equal(await p.evaluate((k: string) => sessionStorage.getItem(k), CLE_QUESTION), null, 'aucune clé ne traîne');
    assert.equal(cherchees.length, 0);
  } finally { await ctx.close(); }
});
