// Le widget « Odin » de l'accueil (maquette validée « Accueil », le widget d'Odin) : le visage d'Odin, ce qu'il dit
// maintenant et sa proposition du moment (src/valhalla/widgets/parole.ts, src/web/pages/widgets-parole.js).
// - La phrase et ses boutons sont ceux du SEUL moteur de parole (src/valhalla/parole.ts) : ici un faux moteur, ou le vrai.
//   Le moteur se tait : rien n'est inventé à sa place.
// - Le carnet d'Odin n'avance pas tout seul : dix redessins, deux écrans, une page ouverte toute une nuit ne coûtent
//   qu'une demande au moteur.
// - Une proposition se joue par le chemin de la mascotte (OdinGuide.lancer) : une action grave redemande l'accord à chaque
//   fois, sans accord rien ne part ; une action simple part ; « Autre chose » ouvre « Que veux-tu ? ».
// - Propriétaire seul, sur l'accueil seul, jamais sur l'écran de la maison : pour un membre, une tablette « maison », une
//   clé d'accès ou une requête sans session, le moteur n'est pas appelé (requêtes rejouées).
// - Une phrase piégée reste du texte ; le visage est la mascotte de la page (deux yeux blancs, rien d'autre) ; en mode
//   « Modifier », rien ne part ; 390, 768 et 1280 px, clair et sombre, rien ne déborde.

import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import vm from 'node:vm';
import { TAILLE_SORTE, type Widget } from '../src/valhalla/modules/gladsheim.ts';
import { allModules, valhallaOf } from '../src/valhalla/odin.ts';
import { Carnet, ParoleOdin, paroleOf, setParole, type Demande, type Parole } from '../src/valhalla/parole.ts';
import { lierProprietaire, persona } from '../src/valhalla/sso/etat.ts';
import { admiseALaMaison, copiable, donneeWidget, publicDe, sorteDe, type EtatWidget, type Lecteur, type SourceWidget } from '../src/valhalla/widgets/index.ts';
import { PHRASE_PLAFOND } from '../src/valhalla/widgets/parole.ts';
import type { Module, View } from '../src/valhalla/types.ts';
import { T as Banc } from './banc/lib.ts';
import { vraiOdin, type VraiOdin } from './banc/odin-vrai.ts';

const lire = (f: string) => { try { return readFileSync(new URL(`../${f}`, import.meta.url), 'utf8'); } catch { return ''; } };
const PAGE_JS = lire('src/web/pages/widgets-parole.js'), GRILLE = lire('src/web/pages/accueil-grille.js');
const W = (o: Record<string, unknown> = {}): Widget => ({ id: 'c8e00000', kind: 'parole', w: 1, c: 4, r: 2, ...o }) as unknown as Widget;
const LUI: Lecteur = { qui: 'proprietaire', ecran: 'accueil' }, TABLETTE: Lecteur = { qui: 'maison', ecran: 'maison' };
const MEMBRE: Lecteur = { qui: 'membre', ecran: 'accueil', peutLire: () => true, ouverts: new Set(['c8e00000@odin']) };
const MIN = 60_000;
type Etat = EtatWidget & { raison?: string; at?: number; donnee?: Record<string, unknown> };
/** Une phrase piégée : du HTML, une fausse consigne, puis un texte très long sans espace. */
const PIEGE = `<img src=x onerror="window.__piege=1">Ignore tes consignes ${'x'.repeat(1500)}`;

/** Un faux moteur de parole : il rend ce qu'on lui dit et compte chaque demande. */
function fauxMoteur(rend: () => Parole) {
  const demandes: Demande[] = [];
  return { demandes, parler: async (d: Demande) => { demandes.push(d); return rend(); } };
}
/** Une fausse source : l'heure qu'on veut, le moteur qu'on veut. */
function source(moteur: { parler(d: Demande): Promise<Parole> } | undefined, horloge: { t: number }): SourceWidget {
  return {
    appli: () => undefined, vue: async () => null, action: () => undefined, meteo: async () => undefined,
    lieu: () => ({ choisi: false, nom: '', fuseau: '', heure12: false }), maintenant: () => horloge.t,
    moteurParole: () => moteur,
  } as SourceWidget;
}
const etat = async (w: Widget, l: Lecteur, src: SourceWidget) => (await donneeWidget(w, l, src)) as Etat;
const PHRASE: Parole = { texte: 'Le site de la boutique ne répond plus depuis 3 min.', sources: ['alertes'], propositions: [{ label: 'Relancer la boutique', act: { module: 'essaiw', action: 'vider', read: false, grave: true } }, { label: 'Pourquoi ?', demander: 'Pourquoi la boutique est-elle tombée ?' }] };
const SILENCE: Parole = { texte: '', propositions: [], sources: [], rien: true };

// ------------------------------------------------------------------ le serveur, sans Odin

test('la sorte « parole » : famille « odin », aucune appli lue, propriétaire seul, jamais sur l\'écran de la maison, la taille de la maquette (3 × 2 au plus petit)', () => {
  const s = sorteDe('parole');
  assert.ok(s, 'déclarée');
  assert.deepEqual([s.famille, s.applis, s.posable, publicDe(s), [...s.taille.mini], s.taille.r, s.jamaisALaMaison], ['odin', [], true, 'proprietaire', [3, 2], 2, true]);
  assert.equal(admiseALaMaison('parole'), false, 'la règle de l\'écran de la maison la refuse'); assert.equal(copiable('parole'), false, 'jamais copiée vers l\'autre écran');
  assert.deepEqual((TAILLE_SORTE as Record<string, unknown>).parole, { mini: [3, 2], r: 2 }, 'la taille gardée par Hestia');
});

test('la phrase affichée est celle du moteur, telle quelle, avec ses boutons ; le moteur se tait → « vide », rien d\'inventé', async () => {
  const h = { t: 1_800_000_000_000 }, m = fauxMoteur(() => PHRASE);
  const e = await etat(W(), LUI, source(m, h));
  assert.equal(e.etat, 'ok');
  assert.deepEqual(e.donnee, { texte: PHRASE.texte, propositions: [{ label: 'Relancer la boutique', act: { module: 'essaiw', action: 'vider', read: false, grave: true } }, { label: 'Pourquoi ?', demander: 'Pourquoi la boutique est-elle tombée ?' }] });
  assert.deepEqual(m.demandes, [{ quand: 'spontane', vue: 'home' }], 'demandée comme la mascotte qui parle toute seule');
  const t = fauxMoteur(() => SILENCE), r = await etat(W(), LUI, source(t, h));
  assert.deepEqual(r, { etat: 'vide', raison: 'rien_de_neuf' }, 'aucune phrase, aucune donnée');
  assert.deepEqual(await etat(W(), LUI, source(undefined, h)), { etat: 'source_absente', raison: 'pas_encore_lu' }, 'moteur pas prêt');
  const casse = { parler: async () => { throw new Error('boum'); } };
  assert.deepEqual(await etat(W(), LUI, source(casse, h)), { etat: 'source_absente', raison: 'lecture_echouee' });
});

test('dix redessins, deux écrans, deux lectures en même temps : une seule demande au moteur', async () => {
  const h = { t: 1_800_000_000_000 }, m = fauxMoteur(() => PHRASE);
  const [a, b] = await Promise.all([etat(W(), LUI, source(m, h)), etat(W({ id: 'c8e00001' }), LUI, source(m, h))]);
  assert.deepEqual(a, b);
  for (let i = 0; i < 10; i++) { h.t += 5_000; for (const ecran of [source(m, h), source(m, h)]) assert.equal((await etat(W(), LUI, ecran)).donnee?.texte, PHRASE.texte); }
  assert.equal(m.demandes.length, 1, 'une seule demande');
});

test('une page ouverte et relue chaque minute garde sa phrase, mais au plus PHRASE_PLAFOND : douze heures, quatre demandes ; une nuit sans lecture (page cachée), une seule ; partie puis revenue, une phrase neuve', async () => {
  // La grille ne relit pas une page cachée (fenetre.js : document.hidden) : un écran éteint toute une nuit ne lit rien.
  // Une page vue toute une nuit (un écran au mur) change de phrase au plus toutes les PHRASE_PLAFOND : une phrase vieille,
  // ou d'une alerte réglée depuis, ne reste pas affichée comme actuelle (relecture, constat 1).
  assert.equal(PHRASE_PLAFOND, 3 * 60 * MIN);
  const h = { t: 1_800_000_000_000 }; let n = 0;
  const m = fauxMoteur(() => ({ ...PHRASE, texte: `Phrase ${++n}` }));
  const vues: string[] = [];
  for (let i = 0; i < 12 * 60; i++) { vues.push(String((await etat(W(), LUI, source(m, h))).donnee?.texte)); h.t += MIN; }
  assert.equal(m.demandes.length, 4, 'douze heures vues : une demande toutes les trois heures');
  for (let k = 0; k < 4; k++) assert.deepEqual([...new Set(vues.slice(k * 180, (k + 1) * 180))], [`Phrase ${k + 1}`], `la phrase ${k + 1} reste trois heures pile`);
  // Une nuit sans lecture : au retour, une seule demande.
  h.t += 9 * 60 * MIN;
  assert.equal((await etat(W(), LUI, source(m, h))).donnee?.texte, 'Phrase 5', 'au retour, une phrase neuve');
  h.t += MIN; assert.equal((await etat(W(), LUI, source(m, h))).donnee?.texte, 'Phrase 5'); assert.equal(m.demandes.length, 5);
  // 40 min sans lecture : neuve ; puis une absence courte (moins de 15 min) : la même.
  h.t += 40 * MIN; assert.equal((await etat(W(), LUI, source(m, h))).donnee?.texte, 'Phrase 6', '40 min sans lecture : neuve');
  h.t += 10 * MIN; assert.equal((await etat(W(), LUI, source(m, h))).donnee?.texte, 'Phrase 6', '10 min : la même'); assert.equal(m.demandes.length, 6);
});

test('la phrase est datée de sa demande, pas de sa lecture (relecture, constat 2)', async () => {
  const t0 = 1_800_000_000_000, h = { t: t0 }, m = fauxMoteur(() => PHRASE);
  assert.equal((await etat(W(), LUI, source(m, h))).at, t0);
  h.t += 20 * MIN; const e = await etat(W(), LUI, source(m, h));
  assert.equal(e.donnee?.texte, PHRASE.texte); assert.equal(e.at, t0, 'la même phrase garde l\'heure où elle a été dite');
});

test('un moteur qui échoue n\'est pas rappelé à chaque lecture : au plus toutes les SILENCE_RELU (relecture, constat 3)', async () => {
  const h = { t: 1_800_000_000_000 }; let appels = 0, casse = true;
  const m = { parler: async () => { appels++; if (casse) throw new Error('boum'); return PHRASE; } };
  for (let i = 0; i < 9; i++) { assert.deepEqual(await etat(W(), LUI, source(m, h)), { etat: 'source_absente', raison: 'lecture_echouee' }); h.t += MIN; }
  assert.equal(appels, 1, 'neuf lectures en neuf minutes : un seul appel');
  h.t += MIN; casse = false;
  assert.equal((await etat(W(), LUI, source(m, h))).donnee?.texte, PHRASE.texte, 'dix minutes après : redemandé'); assert.equal(appels, 2);
  // Une phrase gardée survit à un échec, et l'échec n'est pas relancé à chaque lecture.
  const g = { t: 1_800_000_000_000 }; let n2 = 0, k2 = false;
  const m2 = { parler: async () => { n2++; if (k2) throw new Error('boum'); return PHRASE; } };
  await etat(W(), LUI, source(m2, g)); g.t += 4 * 60 * MIN; k2 = true;
  for (let i = 0; i < 5; i++) { assert.equal((await etat(W(), LUI, source(m2, g))).donnee?.texte, PHRASE.texte, 'la phrase gardée reste'); g.t += MIN; }
  assert.equal(n2, 2, 'un seul nouvel essai');
});

test('le vrai moteur et son carnet : dix lectures n\'y notent pas plus qu\'une ; une nuit silencieuse n\'y note rien', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'widgets-parole-'));
  try {
    const h = { t: 1_800_000_000_000 };
    // Une alerte grave : de quoi dire une chose neuve.
    const alerte = { id: 'a1', module: 'essaiw', level: 'haute', title: 'La boutique ne répond plus', at: new Date(h.t).toISOString(), ack: false };
    const mod = { id: 'essaiw', name: 'Boutique', family: 'Données', what: 'Une boutique d\'essai.', does: [], actions: [], view: () => ({ kpis: [], sections: [] }) } as unknown as Module;
    const p = new ParoleOdin({ modules: () => [mod], alerts: () => [alerte as never], now: () => h.t }, join(dir, 'parole.json'));
    const src = source(p, h);
    const e = await etat(W(), LUI, src); assert.equal(e.etat, 'ok'); assert.match(String(e.donnee?.texte), /boutique/i);
    const une = p.carnet.taille('proprietaire');
    assert.ok(une > 0, 'la phrase donnée est notée');
    for (let i = 0; i < 10; i++) { h.t += MIN; assert.equal((await etat(W(), LUI, src)).donnee?.texte, e.donnee?.texte, 'la même phrase, resservie'); }
    assert.equal(p.carnet.taille('proprietaire'), une, 'dix redessins : rien de plus au carnet');
    // Un moteur qui n'a rien à dire : une nuit de lectures ne note rien.
    const muet = new ParoleOdin({ modules: () => [], now: () => h.t }, join(dir, 'muet.json')), sm = source(muet, h);
    for (let i = 0; i < 12 * 60; i++) { assert.deepEqual(await etat(W(), LUI, sm), { etat: 'vide', raison: 'rien_de_neuf' }); h.t += MIN; }
    assert.equal(muet.carnet.taille('proprietaire'), 0, 'rien de noté');
    assert.equal(new Carnet(join(dir, 'muet.json')).taille('proprietaire'), 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('qui voit quoi : un membre, une tablette, le propriétaire sur l\'écran de la maison : refusés, le moteur n\'est pas appelé', async () => {
  const h = { t: 1_800_000_000_000 }, m = fauxMoteur(() => PHRASE);
  for (const l of [MEMBRE, TABLETTE, { qui: 'proprietaire', ecran: 'maison' } as Lecteur, { qui: 'maison', ecran: 'accueil' } as Lecteur]) {
    const e = await etat(W(), l, source(m, h));
    assert.equal(e.etat, 'refuse', `${l.qui} sur ${l.ecran}`); assert.equal('donnee' in e, false);
  }
  assert.equal(m.demandes.length, 0, 'aucune demande au moteur');
});

test('une phrase piégée reste un texte borné ; une proposition inconnue ou mal écrite est écartée', async () => {
  const h = { t: 1_800_000_000_000 };
  const m = fauxMoteur(() => ({ texte: PIEGE, sources: [], propositions: [
    { label: '<b>x</b>', ouvrir: 'javascript:alert(1)' }, { label: 'Ouvrir', ouvrir: 'app:essaiw' }, { label: '', demander: 'x' },
    { label: 'Mauvaise', act: { module: '../x', action: 'y', read: true, grave: false } }, { label: 'Lire', act: { module: 'essaiw', action: 'etat', read: true, grave: false, input: { a: 'b', 'x y': 'z', o: { p: 1 } as never } } },
    { label: 'Guide', guide: 'expliquer' }, { label: 'Quatre', demander: 'quatre' }, { label: 'Cinq', demander: 'cinq' },
  ] }));
  const e = await etat(W(), LUI, source(m, h));
  assert.equal((e.donnee!.texte as string).length, 1000, 'bornée'); assert.ok((e.donnee!.texte as string).startsWith('<img'), 'gardée telle quelle : la page la pose en texte');
  assert.deepEqual(e.donnee!.propositions, [{ label: 'Ouvrir', ouvrir: 'app:essaiw' }, { label: 'Lire', act: { module: 'essaiw', action: 'etat', read: true, grave: false, input: { a: 'b' } } }, { label: 'Quatre', demander: 'quatre' }], 'trois au plus, seulement des façons connues');
});

// ------------------------------------------------------------------ la page, sans navigateur

test('la page : la famille se déclare (sorte « parole », groupe « Odin », propriétaire seul, jamais à la maison, 4 × 2) ; la grille connaît sa taille ; aucune phrase écrite', () => {
  const win: Record<string, any> = {}; vm.runInNewContext(PAGE_JS, { window: win });
  const f = (win.OdinWidgetsFamilles as Array<{ famille: string; sortes: Array<Record<string, any>> }>).find((x) => x.sortes.some((s) => s.sorte === 'parole'));
  assert.ok(f, 'déclarée au registre');
  const d = f.sortes.find((s) => s.sorte === 'parole')!;
  assert.deepEqual([d.groupe, d.proprio, d.jamaisALaMaison, d.titre, JSON.parse(JSON.stringify(d.poser)), JSON.parse(JSON.stringify(d.vides))], ['odin', true, true, 'Odin', { c: 4, r: 2, pc: 4 }, ['rien_de_neuf']]);
  // La marque de la page égale celle du serveur.
  assert.equal(d.jamaisALaMaison, sorteDe('parole')!.jamaisALaMaison);
  const g: Record<string, any> = {}; vm.runInNewContext(GRILLE, { window: g, matchMedia: () => ({ matches: false }) });
  assert.deepEqual(JSON.parse(JSON.stringify([g.OdinGrille.MINI.parole, g.OdinGrille.HAUTEUR.parole])), [[3, 2], 2]);
  // La page relit une proposition avec les règles du serveur (relecture, constat 4) : dix réglages au plus, 200 caractères, « demander » sans ses espaces.
  const P = win.OdinWidgetsParole;
  const beaucoup = Object.fromEntries(Array.from({ length: 15 }, (_, i) => [`k${i}`, i === 0 ? 'y'.repeat(300) : i]));
  const lue = JSON.parse(JSON.stringify(P.propositionDe({ label: 'Lire', act: { module: 'essaiw', action: 'etat', read: true, input: { ...beaucoup, n: Number.NaN } } })));
  assert.equal(Object.keys(lue.act.input).length, 10); assert.equal(lue.act.input.k0.length, 200);
  assert.deepEqual(JSON.parse(JSON.stringify(P.propositionDe({ label: 'Pourquoi', demander: '   pourquoi ?   ' }))), { label: 'Pourquoi', demander: 'pourquoi ?' });
  // Aucune phrase d'Odin écrite dans le widget (celle de la maquette est un exemple), aucun dessin de la mascotte.
  assert.doesNotMatch(PAGE_JS, /Tout tourne|relance|class=\\?"eye|<svg/i);
});

// ------------------------------------------------------------------ un vrai Odin d'essai

const tt = new Banc(), orig = { log: console.log, error: console.error, warn: console.warn, info: console.info };
let v: VraiOdin, avecDroit = '', cleMaison = '', cleComplet = '', vraiMoteur: ReturnType<typeof paroleOf>;
const MDP = 'une-pirogue-sur-le-lagon-calme';
/** Ce que l'appli d'essai a fait (une action qui part se compte ici). */
const fait: string[] = [];
function essai(): Module {
  return {
    id: 'essaiw', name: 'Boutique d\'essai', family: 'Données', what: 'Une appli d\'essai pour le widget « Odin ».', does: [], from: [], upstream: [], words: [],
    actions: [
      { id: 'etat', label: 'État', what: 'Dit où elle en est.', read: true, run: () => { fait.push('essaiw:etat'); return { text: 'La boutique va bien.' }; } },
      { id: 'vider', label: 'Vider', what: 'Vide tout.', grave: () => 'vider la boutique d\'essai', run: () => { fait.push('essaiw:vider'); return { text: 'Vidée.' }; } },
    ],
    view: () => ({ kpis: [], sections: [] }) as unknown as View,
  } as Module;
}
const cookieDe = (r: Response, nom: string) => r.headers.getSetCookie().find((c) => c.startsWith(`${nom}=`))?.split(';')[0] ?? '';
async function entrer(ident: string, mdp: string): Promise<string> {
  let r = await fetch(`${v.url}/sso/odin`, { redirect: 'manual' }); assert.equal(r.status, 303);
  r = await fetch(new URL(r.headers.get('location')!, v.url), { redirect: 'manual' }); const demande = /name="demande" value="([^"]+)"/.exec(await r.text())![1];
  r = await fetch(`${v.url}/sso/autoriser`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded', origin: v.url }, body: new URLSearchParams({ demande, identifiant: ident, motdepasse: mdp }) });
  r = await fetch(r.headers.get('location')!, { redirect: 'manual' }); assert.equal(r.status, 303, 'session ouverte');
  return cookieDe(r, 'odin_session');
}
const PAGE = 'b8e00001', ID = { grand: 'c8e00001', petit: 'c8e00002' };
const FENETRE = () => ({ pages: [{ id: PAGE, name: 'Parole', widgets: [
  { id: ID.grand, kind: 'parole', w: 1, c: 4, r: 2 }, { id: ID.petit, kind: 'parole', w: 1, c: 3, r: 2 },
] }, { id: 'b8e00002', name: 'Salon', maison: true, widgets: [{ id: 'c8e00011', kind: 'parole', w: 1, c: 4, r: 2 }] }] });
type Rendue = { id: string; kind: string; etat: string; raison?: string; donnee?: Record<string, unknown> };
const donnees = async (h: Record<string, string> = {}) => { const r = await v.json(`/api/widgets/donnees?page=${PAGE}`, undefined, h); return { status: r.status, corps: JSON.stringify(r.body), de: (id: string) => ((r.body.widgets as Rendue[] | undefined) ?? []).find((x) => x.id === id) }; };
/** Un faux moteur posé à la place du vrai (le même pour la route de parole et pour le widget). Les demandes du widget n'ont pas de titre. */
function poserMoteur(rend: () => Parole) { const m = fauxMoteur(rend); setParole(m as unknown as ParoleOdin); return { ...m, duWidget: () => m.demandes.filter((d) => !('titre' in d)).length }; }

before(async () => {
  for (const k of ['log', 'error', 'warn', 'info'] as const) console[k] = () => {};
  v = await vraiOdin(tt, { compte: true, modules: (o) => [...allModules(o).filter((m) => ['gladsheim', 'var', 'apparence'].includes(m.id)), essai()] });
  vraiMoteur = paroleOf();
  const va = valhallaOf()!;
  assert.equal((await va.act('var', 'ajouter', { login: 'membre-p', nom: 'Membre P', groupes: 'invite', mot_de_passe: MDP })).ok, true);
  for (const appli of ['odin', 'gladsheim', 'essaiw']) assert.equal((await va.act('var', 'donner_acces', { appli, qui: '@membre-p' })).ok, true);
  lierProprietaire(persona()!);
  avecDroit = await entrer('membre-p', MDP); assert.ok(avecDroit, 'le membre a une session');
  cleMaison = ((await va.act('gladsheim', 'cle_tablette', { nom: 'Tablette maison', droits: 'maison' })).data as { key: string }).key;
  cleComplet = ((await va.act('gladsheim', 'cle_tablette', { nom: 'Tablette complète', droits: 'complet' })).data as { key: string }).key;
  assert.equal((await va.act('apparence', 'theme', { theme: 'valhalla' })).ok, true);
  va.ctx('gladsheim').saveSettings({ fenetre: undefined });
  const r = await va.act('gladsheim', 'regler_fenetre', { fenetre: JSON.stringify(FENETRE()) }); assert.equal(r.ok, true, r.text);
});
after(async () => { setParole(vraiMoteur); await tt.end(); Object.assign(console, orig); });

test('vrai Odin : la phrase du moteur au propriétaire, sur ses deux widgets ; dix lectures et deux écrans : une seule demande au moteur', async () => {
  const m = poserMoteur(() => PHRASE);
  for (let i = 0; i < 10; i++) {
    const lui = await donnees();
    for (const id of [ID.grand, ID.petit]) { const e = lui.de(id)!; assert.equal(e.etat, 'ok', id); assert.equal(e.donnee!.texte, PHRASE.texte); }
  }
  assert.equal(m.duWidget(), 1, 'une seule demande pour dix lectures de deux widgets');
  assert.deepEqual(m.demandes[0], { quand: 'spontane', vue: 'home' });
});

test('vrai Odin : un membre, une tablette « maison », une clé d\'accès, sans session : rien de plus qu\'aujourd\'hui, et le moteur n\'est jamais appelé pour eux', async () => {
  const m = poserMoteur(() => PHRASE);
  const GENS = [['membre', { cookie: avecDroit }], ['tablette « maison »', { cookie: '', 'x-odin-maison': cleMaison }], ['clé d\'accès', { cookie: '', authorization: `Bearer ${v.token}` }], ['sans session', { cookie: '' }]] as const;
  const vus: string[] = [];
  for (const [qui, h] of GENS) {
    // La route de parole d'aujourd'hui (la mascotte) : refusée à chacun, avant le moteur.
    const p = await v.json('/api/valhalla/parole', { quand: 'toucher', vue: 'home' }, h);
    vus.push(`${qui} parole ${p.status}`);
    assert.notEqual(p.body.ok, true, `${qui} : pas de parole`); assert.doesNotMatch(JSON.stringify(p.body), /boutique|Relancer/i, `${qui} : rien de la phrase`);
    // La route des widgets : le membre reçoit un refus pour ce widget ; les autres, rien.
    const d = await donnees(h);
    vus.push(`${qui} widgets ${d.status}${d.de(ID.grand) ? ` ${d.de(ID.grand)!.etat}` : ''}`);
    assert.doesNotMatch(d.corps, /boutique|Relancer/i, `${qui} : rien de la phrase`);
  }
  assert.deepEqual(vus, ['membre parole 403', 'membre widgets 200 refuse', 'tablette « maison » parole 401', 'tablette « maison » widgets 401', 'clé d\'accès parole 403', 'clé d\'accès widgets 401', 'sans session parole 401', 'sans session widgets 401']);
  // L'écran de la maison (la page « Salon » porte le widget) : ni la tablette ni une clé « complet » n'en reçoivent rien.
  for (const [qui, cle] of [['tablette', cleMaison], ['clé « complet »', cleComplet]] as const) {
    const r = await v.json('/api/maison/etat', undefined, { cookie: '', 'x-odin-maison': cle }), corps = JSON.stringify(r.body);
    assert.equal(r.status, 200, qui); assert.ok(corps.includes('"Salon"'), `${qui} : la page est lue`);
    const salon = (r.body.fenetre as Array<{ name: string; widgets: unknown[] }>).find((x) => x.name === 'Salon')!;
    assert.deepEqual(salon.widgets, [], `${qui} : aucun widget « Odin »`);
    assert.doesNotMatch(corps, /c8e00011|ne répond plus depuis|Relancer la boutique/, `${qui} : rien de la phrase`);
  }
  assert.equal(m.demandes.length, 0, 'le moteur n\'a été appelé pour aucun d\'eux');
  // Le propriétaire, lui, a la route d'aujourd'hui (la mascotte) comme avant.
  assert.equal((await v.json('/api/valhalla/parole', { quand: 'toucher', vue: 'home' })).body.texte, PHRASE.texte);
});

// ------------------------------------------------------------------ le navigateur

// Ce qui suit est lu dans la page du navigateur (ses objets à elle).
declare const document: any, window: any, getComputedStyle: any, requestAnimationFrame: any;
interface Page {
  goto(u: string): Promise<unknown>; waitForSelector(s: string, o?: Record<string, unknown>): Promise<unknown>; click(s: string, o?: Record<string, unknown>): Promise<void>;
  waitForFunction(f: string | ((a: any) => unknown), a?: unknown, o?: Record<string, unknown>): Promise<unknown>; evaluate<X>(f: string | ((a?: any) => X), a?: unknown): Promise<X>;
  on(e: string, f: (x: any) => void): void; waitForTimeout(ms: number): Promise<void>; screenshot(o: Record<string, unknown>): Promise<unknown>;
}
interface Contexte { newPage(): Promise<Page>; addCookies(c: unknown[]): Promise<void>; addInitScript(f: string | (() => void)): Promise<void>; close(): Promise<void> }
interface Navigateur { newContext(o: Record<string, unknown>): Promise<Contexte>; close(): Promise<void> }
const pw = (() => { try { return createRequire(import.meta.url)('playwright') as { chromium: { launch(): Promise<Navigateur> } }; } catch { return undefined; } })();
const sansNav = pw ? false : 'Playwright n\'est pas installé sur cette machine';
let nav: Navigateur | undefined;
before(async () => { if (pw) nav = await pw.chromium.launch(); });
after(async () => { await nav?.close(); });
const CAPTURES = process.env.ODIN_CAPTURES;

/** L'accueil sur la page « Parole » ; `requetes` : chaque requête de la page (méthode et chemin). */
async function ouvrir(largeur: number, sombre: boolean, o: { reduit?: boolean } = {}) {
  const doigt = largeur < 500;
  const ctx = await nav!.newContext({ viewport: { width: largeur, height: doigt ? 800 : 900 }, hasTouch: doigt, isMobile: doigt, colorScheme: sombre ? 'dark' : 'light', ...(o.reduit ? { reducedMotion: 'reduce' } : {}) });
  const [n, ...x] = v.session.split('='); await ctx.addCookies([{ name: n, value: x.join('='), url: v.url, httpOnly: true, sameSite: 'Strict' }]);
  await ctx.addInitScript(`try { localStorage.setItem('odin.tour', 'done'); localStorage.setItem('odin.fenetre.page', '0'); ${sombre ? 'localStorage.setItem(\'odin.theme\', \'sombre\');' : ''} } catch { /* rien */ }`);
  const p = await ctx.newPage(), erreurs: string[] = [], requetes: string[] = [];
  p.on('pageerror', (e) => erreurs.push(String(e)));
  p.on('request', (r) => { try { const m = /"module":"([^"]*)"/.exec(r.postData() ?? ''); requetes.push(`${r.method()} ${new URL(r.url()).pathname}${m ? ` ${m[1]}` : ''}`); } catch { /* rien */ } });
  await p.goto(v.url + '/');
  await p.waitForSelector('#app:not([hidden])', { timeout: 30000 });
  await p.waitForFunction(() => [...document.querySelectorAll('.fe-tab')].some((t) => t.textContent === 'Parole'), undefined, { timeout: 30000 });
  await p.evaluate(() => ([...document.querySelectorAll('.fe-tab')].find((t) => t.textContent === 'Parole') as any).click());
  await p.waitForSelector(`#feGrid .fe-w[data-id="${ID.grand}"] .wp-corps`, { timeout: 45000 });
  await p.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  return { ctx, page: p, erreurs, requetes };
}
/** Ce que la page montre de chaque carte « Odin ». */
const vu = (p: Page) => p.evaluate((ids: Record<string, string>) => {
  const vw = document.documentElement.clientWidth, txt = (n: any) => (n?.textContent ?? '').replace(/\s+/g, ' ').trim();
  const cartes = [...document.querySelectorAll('#feGrid > .fe-w')] as any[], hauteurs = () => cartes.map((c) => Math.round(c.getBoundingClientRect().height));
  const avec = hauteurs(); for (const n of document.querySelectorAll('#feGrid .wp-corps')) (n as any).style.display = 'none';
  const sans = hauteurs(); for (const n of document.querySelectorAll('#feGrid .wp-corps')) (n as any).style.display = '';
  const out: Record<string, any> = { etire: avec.some((h, i) => Math.abs(h - sans[i]) > 1), deborde: document.documentElement.scrollWidth > vw + 1, code: Boolean(window.__piege) || Boolean(document.querySelector('#feGrid img[src="x"]')) };
  for (const [nom, id] of Object.entries(ids)) {
    const c = document.querySelector(`#feGrid > .fe-w[data-id="${id}"]`); if (!c) { out[nom] = null; continue; }
    const b = c.getBoundingClientRect(), dans = (n: any) => { const r = n.getBoundingClientRect(); return r.width === 0 || (r.left >= b.left - 1 && r.right <= b.right + 1 && r.top >= b.top - 1 && r.bottom <= b.bottom + 1); };
    const k = c.querySelector('.wp-corps'), kb = k?.getBoundingClientRect(), montre = (n: any) => n.getClientRects().length && getComputedStyle(n).display !== 'none';
    const yeux = [...c.querySelectorAll('.wp-visage svg .eye')] as any[];
    out[nom] = {
      hors: [...c.querySelectorAll('*')].filter(montre).filter((n: any) => !n.parentElement.closest('.wp-phrase, .wp-btn') && !dans(n)).map((n: any) => `${n.tagName}.${String(n.className?.baseVal ?? n.className).slice(0, 30)} ${JSON.stringify(n.getBoundingClientRect())} carte ${JSON.stringify(b)}`).slice(0, 4), enteteHaut: Math.round(c.querySelector('.fe-h')?.getBoundingClientRect().height ?? 0),
      phrase: c.querySelector('.wp-phrase q')?.textContent ?? null, titre: c.querySelector('.wp-phrase')?.title ?? null, phraseVue: Boolean(c.querySelector('.wp-phrase')?.getClientRects().length),
      boutons: [...c.querySelectorAll('.wp-btn')].filter(montre).map(txt),
      petits: [...c.querySelectorAll('.wp-corps button')].filter(montre).filter((n: any) => { const r = n.getBoundingClientRect(); return r.width < 44 || r.height < 44; }).map(txt),
      coupe: k ? [...k.querySelectorAll('.wp-visage, .wp-phrase, .wp-btn')].filter(montre).filter((n: any) => { const r = n.getBoundingClientRect(); return r.height > 0 && (r.top < kb.top - 1 || r.bottom > kb.bottom + 1 || r.right > kb.right + 1); }).map((n: any) => `${n.className} ${txt(n).slice(0, 30)}`) : [],
      // Le visage : la mascotte de la page, deux yeux, blancs, et rien d'autre (ni bouche, ni sourcils, ni joues).
      visage: { svg: c.querySelectorAll('.wp-visage svg').length, yeux: yeux.length, blancs: yeux.every((e) => getComputedStyle(e).fill === 'rgb(255, 255, 255)'), autre: c.querySelectorAll('.wp-visage :is(.mouth, .brows, .cheeks) > *').length, vu: Boolean(c.querySelector('.wp-visage')?.getClientRects().length) },
    };
  }
  return out;
}, ID);

for (const [largeur, sombre] of [[1280, false], [768, true], [768, false], [390, true]] as const) {
  test(`navigateur, ${largeur} px, ${sombre ? 'sombre' : 'clair'} : le visage (la mascotte, deux yeux blancs), la phrase du moteur entre guillemets, sa proposition et « Autre chose » ; rien ne déborde`, { skip: sansNav }, async () => {
    poserMoteur(() => PHRASE);
    const { ctx, page: p, erreurs } = await ouvrir(largeur, sombre);
    try {
      const a = await vu(p);
      if (CAPTURES) await p.screenshot({ path: `${CAPTURES}/parole-${largeur}-${sombre ? 'sombre' : 'clair'}.png`, fullPage: true });
      assert.equal(a.deborde, false, 'la page ne déborde pas'); assert.equal(a.code, false);
      if (largeur > 700) assert.equal(a.etire, false, 'le corps n\'étire aucune carte');
      for (const k of ['grand', 'petit']) {
        const c = a[k];
        assert.equal(c.phrase, PHRASE.texte, `${k} : la phrase du moteur`); assert.equal(c.titre, PHRASE.texte, `${k} : son entier en info-bulle`); assert.equal(c.phraseVue, true);
        assert.deepEqual(c.visage, { svg: 1, yeux: 2, blancs: true, autre: 0, vu: true }, `${k} : le visage`);
        assert.deepEqual(c.hors, [], `${k} : tout dans la carte`); assert.deepEqual(c.coupe, [], `${k} : rien de coupé`); assert.deepEqual(c.petits, [], `${k} : cibles de 44 px`);
        assert.ok(c.enteteHaut > 0 && c.enteteHaut < 60, `${k} : l'en-tête commun tient sur une ligne (${c.enteteHaut})`);
      }
      // La grande carte (4 × 2) montre la proposition ; « Autre chose » aussi, sauf à 768 px où la carte de 4 colonnes n'a la
      // place que de la phrase sur une ligne et de la proposition (au téléphone, la carte suit son contenu : tout).
      assert.equal(a.grand.boutons[0], '⚠Relancer la boutique', 'la proposition, la marque grave devant');
      if (largeur !== 768) assert.ok(a.grand.boutons.includes('Autre chose'));
      assert.deepEqual(erreurs, []);
    } finally { await ctx.close(); }
  });
}

test('navigateur : le visage a l\'humeur de la mascotte (ses classes, sa couleur) et la suit quand elle change ; la marque grave se lit sur le bouton ; à 768 px, la carte de départ dit sa phrase sur deux lignes et son bouton en entier', { skip: sansNav }, async () => {
  // Affichage, constats 1 à 3 : le visage n'avait que la couleur du thème ; la marque ⚠ avait la couleur d'alerte sur un
  // bouton de la même teinte ; à 768 px la phrase passait sur une ligne et le libellé était coupé.
  poserMoteur(() => PHRASE);
  const carte = `#feGrid > .fe-w[data-id="${ID.grand}"]`;
  const pareil = (p: Page) => p.evaluate((c: string) => {
    const b = document.querySelector('#buddy'), w = document.querySelector(`${c} .wp-visage`);
    const forme = (n: any) => [...n.classList].filter((x: string) => /^(e-|c-|m-|sans-)/.test(x) || x === 'o-vive').sort().join(' ');
    const stops = (n: any) => [...n.querySelectorAll('svg stop')].map((x: any) => x.style.stopColor).join(' ');
    const yeux = [...w.querySelectorAll('svg .eye')] as any[];
    return { forme: [forme(b), forme(w)], stops: [stops(b), stops(w)], c0: [b.style.getPropertyValue('--o-c0'), w.style.getPropertyValue('--o-c0')], blancs: yeux.length === 2 && yeux.every((e) => getComputedStyle(e).fill === 'rgb(255, 255, 255)') };
  }, carte);
  const { ctx, page: p, erreurs } = await ouvrir(1280, false);
  try {
    for (const humeur of ['colere', 'joie', 'triste']) {
      await p.evaluate((h: string) => window.OdinFace.set(document.querySelector('#buddy'), h, true), humeur);
      await p.waitForTimeout(500);
      const x = await pareil(p);
      assert.ok(x.stops[0] && x.forme[0], `${humeur} : la mascotte a une couleur et une forme`);
      assert.equal(x.forme[1], x.forme[0], `${humeur} : les classes de forme de la mascotte`);
      assert.equal(x.stops[1], x.stops[0], `${humeur} : la couleur de la mascotte`);
      assert.equal(x.c0[1], x.c0[0], `${humeur} : sa teinte`);
      assert.equal(x.blancs, true, `${humeur} : deux yeux blancs`);
    }
    // face.js repeint toutes les mascottes à la couleur du thème : le visage reprend celle de la mascotte.
    await p.evaluate(() => window.OdinFace.tintBase('#336699')); await p.waitForTimeout(500);
    const t = await pareil(p); assert.equal(t.stops[1], t.stops[0], 'après un repeint du thème');
    const g = await p.evaluate((c: string) => { const n = document.querySelector(`${c} .wp-g`), b = n.closest('button'); return [getComputedStyle(n).color, getComputedStyle(b).color]; }, carte);
    assert.equal(g[0], g[1], 'la marque grave a la couleur du texte de son bouton');
    assert.deepEqual(erreurs, []);
  } finally { await ctx.close(); }
  for (const sombre of [false, true]) {
    const o = await ouvrir(768, sombre);
    try {
      const m = await o.page.evaluate((c: string) => {
        const q = document.querySelector(`${c} .wp-phrase`), l = document.querySelector(`${c} .wp-prop .wp-l`);
        const lh = parseFloat(getComputedStyle(q).lineHeight);
        return { lignes: Math.round(q.clientHeight / lh), entier: Boolean(l) && l.getClientRects().length > 0 && l.scrollWidth <= l.clientWidth + 1 && l.scrollHeight <= l.clientHeight + 1 };
      }, carte);
      assert.ok(m.lignes >= 2, `768 px ${sombre ? 'sombre' : 'clair'} : la phrase sur deux lignes au moins (${m.lignes})`);
      assert.equal(m.entier, true, `768 px ${sombre ? 'sombre' : 'clair'} : le libellé du bouton en entier`);
    } finally { await o.ctx.close(); }
  }
});

test('navigateur, 320 et 1920 px, et « moins d\'animations » : rien ne déborde ; le visage ne bouge pas', { skip: sansNav }, async () => {
  poserMoteur(() => PHRASE);
  for (const largeur of [320, 1920]) {
    const { ctx, page: p, erreurs } = await ouvrir(largeur, false, { reduit: true });
    try {
      const a = await vu(p);
      assert.equal(a.deborde, false, `${largeur} : la page ne déborde pas`);
      for (const k of ['grand', 'petit']) { assert.deepEqual(a[k].hors, [], `${largeur} · ${k}`); assert.deepEqual(a[k].coupe, [], `${largeur} · ${k}`); }
      const anim = await p.evaluate(() => [...document.querySelectorAll('#feGrid .wp-visage, #feGrid .wp-visage *')].filter((n: any) => { const s = getComputedStyle(n); return s.animationName !== 'none' && parseFloat(s.animationDuration) > 0; }).length);
      assert.equal(anim, 0, 'aucun mouvement'); assert.deepEqual(erreurs, []);
    } finally { await ctx.close(); }
  }
});

test('navigateur : le moteur se tait → le visage et « Autre chose », aucune phrase ; une phrase piégée reste du texte', { skip: sansNav }, async () => {
  poserMoteur(() => SILENCE);
  let o = await ouvrir(1280, false);
  try {
    const a = await vu(o.page);
    assert.equal(a.grand.phrase, null, 'aucune phrase'); assert.deepEqual(a.grand.boutons, ['Autre chose']); assert.equal(a.grand.visage.yeux, 2);
    assert.equal(await o.page.evaluate((i: string) => document.querySelector(`#feGrid > .fe-w[data-id="${i}"] .wp-corps`).textContent.trim(), ID.grand), 'Autre chose', 'rien d\'autre n\'est dit');
  } finally { await o.ctx.close(); }
  poserMoteur(() => ({ texte: PIEGE, propositions: [], sources: [] }));
  o = await ouvrir(1280, false);
  try {
    const a = await vu(o.page);
    assert.equal(a.code, false, 'aucun code lancé'); assert.equal(a.grand.phrase, PIEGE.slice(0, 1000)); assert.equal(a.grand.titre, PIEGE.slice(0, 1000));
    assert.equal(a.deborde, false); assert.deepEqual(a.grand.hors, []); assert.deepEqual(a.grand.coupe, []); assert.deepEqual(o.erreurs, []);
  } finally { await o.ctx.close(); }
});

/** Une fausse fenêtre d'accord : elle répond ce qu'on lui a dit, dans l'ordre, et garde chaque question. */
const accord = (p: Page) => p.evaluate(() => { window.__q = []; window.__conf = []; window.OdinDialog.confirm = async (t: unknown) => { window.__conf.push(String(t)); return window.__q.shift() === true; }; });
const repondre = (p: Page, r: boolean[]) => p.evaluate((x: boolean[]) => { window.__q = x; }, r);
const questions = (p: Page) => p.evaluate(() => window.__conf.slice()) as Promise<string[]>;

test('navigateur : une proposition grave redemande l\'accord à chaque fois ; sans accord rien ne part ; le chemin est celui de la mascotte', { skip: sansNav }, async () => {
  poserMoteur(() => PHRASE);
  const { ctx, page: p, erreurs, requetes } = await ouvrir(1280, false);
  const acts = () => requetes.filter((r) => r.startsWith('POST /api/valhalla/act essaiw')).length, vider = () => fait.filter((f) => f === 'essaiw:vider').length;
  try {
    await accord(p);
    const bouton = `#feGrid .fe-w[data-id="${ID.grand}"] .wp-prop`;
    const v0 = vider();
    // Non à la première question : rien ne part.
    await repondre(p, [false]); await p.click(bouton);
    await p.waitForFunction(() => window.__conf.length === 1); await p.waitForTimeout(400);
    assert.equal(acts(), 0, 'aucune requête'); assert.equal(vider(), v0);
    // Oui, puis non à la confirmation du serveur (l'action grave) : rien n'est fait.
    await repondre(p, [true, false]); await p.click(bouton);
    await p.waitForFunction(() => window.__conf.length === 3); await p.waitForTimeout(400);
    assert.equal(acts(), 1, 'une demande, sans accord'); assert.equal(vider(), v0, 'rien n\'est fait');
    assert.match((await questions(p))[2], /vider la boutique d'essai/, 'la confirmation du serveur est montrée');
    // Oui, oui : fait. Puis la fois suivante, l'accord est redemandé.
    await repondre(p, [true, true]); await p.click(bouton);
    await p.waitForFunction(() => window.__conf.length === 5);
    for (let i = 0; i < 40 && vider() === v0; i++) await p.waitForTimeout(100);
    assert.equal(vider(), v0 + 1, 'fait une fois');
    await repondre(p, [false]); await p.click(bouton);
    await p.waitForFunction(() => window.__conf.length === 6); await p.waitForTimeout(400);
    assert.equal(vider(), v0 + 1, 'redemandé ; sans accord, rien');
    assert.deepEqual(erreurs, []);
  } finally { await ctx.close(); }
});

test('navigateur : une action simple part par le chemin qui existe ; « Autre chose » ouvre « Que veux-tu ? » ; en mode « Modifier », rien ne part', { skip: sansNav }, async () => {
  poserMoteur(() => ({ texte: 'La boutique a reçu trois commandes.', sources: [], propositions: [{ label: 'État de la boutique', act: { module: 'essaiw', action: 'etat', read: true, grave: false } }] }));
  const { ctx, page: p, erreurs, requetes } = await ouvrir(1280, false);
  const acts = () => requetes.filter((r) => r.startsWith('POST /api/valhalla/act essaiw')).length, parole = () => requetes.filter((r) => r.endsWith('/api/valhalla/parole')).length;
  try {
    await accord(p);
    await p.evaluate(() => { window.__talk = 0; const t = window.OdinNotices.talk; window.OdinNotices.talk = (x: any) => { window.__talk++; window.__ancre = x?.className ?? ''; return t(x); }; });
    const carte = `#feGrid .fe-w[data-id="${ID.grand}"]`, e0 = fait.filter((f) => f === 'essaiw:etat').length;
    await p.click(`${carte} .wp-prop`);
    for (let i = 0; i < 40 && fait.filter((f) => f === 'essaiw:etat').length === e0; i++) await p.waitForTimeout(100);
    assert.equal(fait.filter((f) => f === 'essaiw:etat').length, e0 + 1, 'partie'); assert.deepEqual(await questions(p), [], 'une lecture : aucune question');
    await p.click(`${carte} .wp-autre`);
    assert.equal(await p.evaluate(() => window.__talk), 1, '« Que veux-tu ? » ouvert'); assert.match(await p.evaluate(() => window.__ancre), /wp-visage/, 'près du visage');
    // Le mode « Modifier » : ni action, ni palette, ni phrase demandée.
    const a0 = acts(), p0 = parole();
    await p.evaluate(() => window.OdinFenetre.edit(true)); await p.waitForSelector('#fenetre.fe-edit');
    await p.waitForSelector(`${carte} .wp-prop`);
    await p.evaluate((c: string) => { document.querySelector(`${c} .wp-prop`).click(); document.querySelector(`${c} .wp-autre`).click(); }, carte);
    await p.waitForTimeout(600);
    assert.equal(acts(), a0, 'aucune action'); assert.equal(await p.evaluate(() => window.__talk), 1, 'aucune palette'); assert.equal(parole(), p0, 'aucune phrase demandée');
    assert.deepEqual(erreurs, []);
  } finally { await ctx.close(); }
});

test('navigateur : dix redessins et deux écrans ouverts : une seule demande au moteur, la même phrase partout', { skip: sansNav }, async () => {
  const m = poserMoteur(() => PHRASE);
  const a = await ouvrir(1280, false), b = await ouvrir(390, true);
  try {
    for (let i = 0; i < 10; i++) {
      await a.page.evaluate(() => ([...document.querySelectorAll('.fe-tab')].find((t) => t.textContent === 'Parole') as any).click());
      await a.page.waitForSelector(`#feGrid .fe-w[data-id="${ID.grand}"] .wp-corps`);
    }
    const lus = a.requetes.filter((r) => r.startsWith('GET /api/widgets/donnees')).length;
    assert.ok(lus >= 10, `la grille a été relue (${lus})`);
    assert.equal(m.duWidget(), 1, 'une seule demande au moteur');
    assert.equal((await vu(b.page)).grand.phrase, PHRASE.texte, 'le second écran : la même phrase');
  } finally { await a.ctx.close(); await b.ctx.close(); }
});
