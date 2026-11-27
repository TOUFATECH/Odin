// Les widgets « Lecteur » et « Messages » de l'accueil (maquette validée « Accueil », les cartes « media » et
// « bifrost ») : la famille « medias » (src/valhalla/widgets/medias.ts, src/web/pages/widgets-medias.js).
// - « Lecteur » : SES radios et SES listes d'Apollon, chacune lancée d'un appui par l'action qui existe (« jouer ») ;
//   « Arrêter » par l'action qui existe (« stop »). Ce qui a été lancé : Apollon le garde (quoi, où, depuis quand) et
//   l'oublie à l'arrêt et à la fin de la lecture ; rien n'est écrit sur le disque (un redémarrage l'oublie). Le widget le
//   dit (« lancé à … »), jamais « en cours ». Aucune barre, aucune durée, ni précédent, ni suivant, ni pause.
// - « Messages » : ses conversations récentes, par titre et par âge ; aucun compteur de « non lus ».
// - Au propriétaire seul, tous les deux : un membre, une tablette « maison », une clé d'accès, une requête sans session :
//   refusés sans un titre, et la lecture n'est même pas appelée. Marqués « jamais sur l'écran de la maison ».
// - Un faux lecteur partout : aucune vraie commande ne part, aucun son. Les adresses sont de la plage de documentation.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createRequire } from 'node:module';
import { after, before, test } from 'node:test';
import vm from 'node:vm';
import { TAILLE_SORTE, type Widget } from '../src/valhalla/modules/gladsheim.ts';
import { aegir, aEcouter, enCours } from '../src/valhalla/modules/aegir.ts';
import { allModules, valhallaOf } from '../src/valhalla/odin.ts';
import { lierProprietaire, persona } from '../src/valhalla/sso/etat.ts';
import type { ModCtx } from '../src/valhalla/types.ts';
import { admiseALaMaison, copiable, donneeWidget, publicDe, sorteDe, type EtatWidget, type Lecteur, type SourceWidget } from '../src/valhalla/widgets/index.ts';
import { brancherConversations, conversationsBranchees } from '../src/valhalla/widgets/medias.ts';
import { T as Banc } from './banc/lib.ts';
import { vraiOdin, type VraiOdin } from './banc/odin-vrai.ts';

const lire = (f: string) => { try { return readFileSync(new URL(`../${f}`, import.meta.url), 'utf8'); } catch { return ''; } };
const RENDU = lire('src/web/pages/widgets-rendu.js'), MEDIAS = lire('src/web/pages/widgets-medias.js'), GRILLE = lire('src/web/pages/accueil-grille.js');
const MAINT = 1_800_000_000_000, MIN = 60_000;
const W = (kind: string, o: Record<string, unknown> = {}): Widget => ({ id: 'c5300000', kind, w: 1, c: 4, r: 2, ...o }) as unknown as Widget;
const LUI: Lecteur = { qui: 'proprietaire', ecran: 'accueil' }, TABLETTE: Lecteur = { qui: 'maison', ecran: 'maison' };
type Etat = EtatWidget & { raison?: string; donnee?: Record<string, any>; at?: number };
const etat = async (w: Widget, l: Lecteur, src: SourceWidget) => (await donneeWidget(w, l, src)) as Etat;

// ------------------------------------------------------------------ Apollon garde ce qu'il lance (un faux lecteur)

const URL_A = 'http://192.0.2.40/flux-a', URL_B = 'http://192.0.2.41/flux-b';
let numeroFaux = 0;
/** Un faux contexte d'Apollon : chaque lecteur lancé attend `finir()` ; aucune commande ne part vraiment. */
function fauxApollon(o: { lecteur?: boolean; settings?: Record<string, unknown> } = {}) {
  const appels: Array<[string, string[]]> = [], fins: Array<() => void> = [], ecrits: unknown[] = [];
  let t = MAINT;
  const settings: Record<string, unknown> = {
    radios: [{ name: 'Radio A', url: URL_A }, { name: 'Radio B', url: URL_B }],
    playlists: { 'Liste A': ['/essai/a.mp3', '/essai/b.mp3'] },
    library: [{ file: '/essai/c.mp3', title: 'Titre C', artist: 'Artiste C', album: 'Album C', sec: 200 }],
    ...o.settings,
  };
  const ctx = {
    home: 'essai', dir: `apollon-essai-${++numeroFaux}`, settings,
    saveSettings: (p: Record<string, unknown>) => { ecrits.push(p); Object.assign(settings, p); },
    run: (cmd: string, args: string[]) => { appels.push([cmd, args]); if (cmd === 'pkill') return Promise.resolve({ code: 0, out: '', err: '' }); return new Promise((r) => { fins.push(() => r({ code: 0, out: '', err: '' })); }); },
    has: async (c: string) => o.lecteur !== false && c === 'mpv',
    now: () => new Date(t),
  } as unknown as ModCtx;
  return { ctx, appels, ecrits, finir: async () => { fins.shift()?.(); await new Promise((r) => setImmediate(r)); }, avancer: (ms: number) => { t += ms; } };
}
const agir = async (ctx: ModCtx, id: string, input: Record<string, unknown> = {}) => (await aegir.actions.find((a) => a.id === id)!.run(ctx, input)) as { text: string };

test('Apollon : jouer une radio, une liste ou un morceau — mêmes commandes, mêmes messages ; ce qui est lancé est gardé (quoi, où, depuis quand)', async () => {
  const f = fauxApollon();
  assert.equal(enCours(f.ctx), undefined, 'rien de lancé : rien');
  assert.equal((await agir(f.ctx, 'jouer', { quoi: 'radio a' })).text, '▶ Lecture sur cette machine.');
  assert.deepEqual(f.appels, [['mpv', ['--no-video', '--really-quiet', '--', URL_A]]], 'la même commande qu\'avant');
  assert.deepEqual(enCours(f.ctx), { quoi: 'Radio A', sorte: 'radio', depuis: MAINT }, 'le nom de la radio, ici, à cette heure');
  f.avancer(5 * MIN);
  assert.equal((await agir(f.ctx, 'jouer', { quoi: 'Liste A' })).text, '▶ Lecture sur cette machine. (liste « Liste A », 2 morceaux)');
  assert.deepEqual(enCours(f.ctx), { quoi: 'Liste A', sorte: 'liste', depuis: MAINT + 5 * MIN }, 'le dernier lancé');
  assert.equal((await agir(f.ctx, 'jouer', { quoi: 'titre c' })).text, '▶ Lecture sur cette machine. Artiste C — Titre C');
  assert.deepEqual(enCours(f.ctx)?.quoi, 'Artiste C — Titre C'); assert.equal(enCours(f.ctx)?.sorte, 'morceau');
  // Rien n'est écrit dans ses réglages : un redémarrage d'Odin repart sans rien affirmer.
  assert.deepEqual(f.ecrits, [], 'jouer n\'écrit rien sur le disque');
  // L'annulation de « jouer » est toujours « stop ».
  assert.deepEqual(aegir.actions.find((a) => a.id === 'jouer')!.undo!({}, { text: '' }, f.ctx), { action: 'stop', input: {}, label: 'lecture arrêtée' });
});

test('Apollon : oublié à « Arrêter », et quand la lecture finit toute seule (ou que le lecteur est tué de dehors) ; un lecteur plus ancien qui finit n\'efface pas le dernier', async () => {
  const f = fauxApollon();
  await agir(f.ctx, 'jouer', { quoi: 'Radio A' });
  await f.finir();
  assert.equal(enCours(f.ctx), undefined, 'le lecteur s\'est arrêté (fin, ou tué de dehors) : oublié');
  await agir(f.ctx, 'jouer', { quoi: 'Radio A' }); await agir(f.ctx, 'jouer', { quoi: 'Radio B' });
  await f.finir();
  assert.equal(enCours(f.ctx)?.quoi, 'Radio B', 'le premier lecteur finit : le dernier lancé reste');
  assert.equal((await agir(f.ctx, 'stop')).text, '⏹ Arrêté.');
  assert.deepEqual(f.appels.at(-1), ['pkill', ['-f', '^(mpv --no-video|ffplay -nodisp)']], 'la même commande qu\'avant');
  assert.equal(enCours(f.ctx), undefined, 'oublié à l\'arrêt');
  await f.finir();
  assert.equal(enCours(f.ctx), undefined, 'rien ne revient');
  // Un autre Odin (un autre dossier d'Apollon) n'est pas touché.
  const g = fauxApollon(); await agir(g.ctx, 'jouer', { quoi: 'Radio A' });
  assert.equal(enCours(f.ctx), undefined); assert.equal(enCours(g.ctx)?.quoi, 'Radio A');
  // Sans lecteur sur la machine : la même erreur qu'avant, et rien de gardé.
  const h = fauxApollon({ lecteur: false });
  await assert.rejects(() => agir(h.ctx, 'jouer', { quoi: 'Radio A' }), /ni mpv ni ffplay/);
  assert.equal(enCours(h.ctx), undefined);
  await assert.rejects(() => agir(h.ctx, 'jouer', { quoi: 'rien de tel' }), /rien trouvé/);
});

test('Apollon : après un redémarrage d\'Odin (un Apollon tout neuf, mêmes réglages, même dossier), rien n\'est affirmé', async () => {
  const f = fauxApollon();
  await agir(f.ctx, 'jouer', { quoi: 'Radio A' });
  assert.equal(enCours(f.ctx)?.quoi, 'Radio A', 'avant : gardé');
  // Le même fichier chargé une seconde fois : un module neuf, comme au démarrage d'un nouveau processus.
  const neuf = (await import(`../src/valhalla/modules/aegir.ts?redemarrage=${Date.now()}`)) as { enCours: typeof enCours };
  assert.notEqual(neuf.enCours, enCours, 'un module neuf');
  assert.equal(neuf.enCours(f.ctx), undefined, 'après le redémarrage : rien de lancé n\'est dit');
});

test('Apollon : un nom venu de dehors (retour à la ligne, très long) est gardé borné, sur une ligne', async () => {
  const long = `Radio\nà la ligne ${'x'.repeat(400)}`;
  const f = fauxApollon({ settings: { radios: [{ name: long, url: URL_A }] } });
  await agir(f.ctx, 'jouer', { quoi: long });
  const q = enCours(f.ctx)!.quoi;
  assert.ok(!/[\n\r]/.test(q), 'sans retour à la ligne'); assert.ok([...q].length <= 120, `borné (${[...q].length})`); assert.match(q, /^Radio à la ligne x+$/);
});

test('Apollon : sur une enceinte de la box, son nom est gardé ; « Arrêter » l\'oublie (la box n\'est pas suivie)', async () => {
  const recus: string[] = [];
  const box = createServer((req, res) => {
    recus.push(`${req.method} ${req.url}`);
    res.setHeader('content-type', 'application/json');
    if (req.url === '/api/states') return void res.end(JSON.stringify([{ entity_id: 'media_player.essai', state: 'idle', attributes: { friendly_name: 'Enceinte essai' } }]));
    res.end('[]');
  });
  await new Promise<void>((r) => box.listen(0, 'localhost', r));
  const avant = process.env.HA_TOKEN; process.env.HA_TOKEN = 'jeton-essai';
  try {
    const f = fauxApollon({ settings: { haUrl: `http://localhost:${(box.address() as AddressInfo).port}` } });
    assert.equal((await agir(f.ctx, 'jouer', { quoi: 'Radio A', ou: 'enceinte essai' })).text, '▶ Sur Enceinte essai.');
    assert.deepEqual(recus, ['GET /api/states', 'POST /api/services/media_player/play_media']);
    assert.deepEqual(enCours(f.ctx), { quoi: 'Radio A', sorte: 'radio', enceinte: 'Enceinte essai', depuis: MAINT });
    await agir(f.ctx, 'stop');
    assert.equal(enCours(f.ctx), undefined);
  } finally { if (avant === undefined) delete process.env.HA_TOKEN; else process.env.HA_TOKEN = avant; await new Promise((r) => box.close(r)); }
});

test('Apollon : ses radios et ses listes, sans adresse ; seulement ce qu\'un appui lancerait vraiment', () => {
  const f = fauxApollon({ settings: {
    radios: [{ name: 'Radio A', url: URL_A }, { name: 'radio a', url: URL_B }, { name: 'Radio\nB', url: URL_B }, { name: 'Même nom', url: URL_B }, { name: '', url: URL_B }],
    playlists: { 'Liste A': ['/essai/a.mp3'], 'Liste vide': [], 'même nom': ['/essai/b.mp3'], ' Liste C': ['/essai/c.mp3'] },
  } });
  const a = aEcouter(f.ctx);
  // Une radio au même nom qu'une autre (« jouer » prendrait la première), un nom sur deux lignes ou vide : pas proposés.
  assert.deepEqual(a.radios, ['Radio A', 'Même nom']);
  // Une liste vide (« jouer » chercherait alors un morceau), au nom d'une radio (la radio passerait), au nom qui ne se
  // retrouverait pas tel quel : pas proposées.
  assert.deepEqual(a.listes, [{ nom: 'Liste A', morceaux: 1 }]);
  assert.doesNotMatch(JSON.stringify(a), /192\.0\.2|http|essai\//, 'ni adresse, ni chemin de fichier');
});

// ------------------------------------------------------------------ les sortes, sans Odin

type Apo = NonNullable<ReturnType<NonNullable<SourceWidget['apollon']>>>;
type Convs = ReturnType<NonNullable<SourceWidget['conversationsRecentes']>>;
const APO = (): Apo => ({ radios: ['Radio A', 'Radio B'], listes: [{ nom: 'Liste A', morceaux: 2 }] });
const CONVS = (): Convs => [
  { peer: 'c-essai1', titre: 'Titre un', at: MAINT - 3 * MIN },
  { peer: 'principal', titre: 'Titre de la principale', at: MAINT - 60 * MIN },
  { peer: 'maison', titre: 'Titre maison', at: MAINT - 30 * MIN },
  // Hors de la Discussion (un appui n'y mènerait pas) : pas servies.
  { peer: 'membre-essai', titre: 'Titre membre', at: MAINT - MIN },
  { peer: 'c-PAS BON', titre: 'Titre de travers', at: MAINT - MIN },
];
/** Une fausse source qui compte ses lectures (null : rien ; absente : pas lue). */
function fausse(o: { apo?: Apo | null; convs?: Convs | null; sansApollon?: boolean; sansConvs?: boolean; actions?: boolean } = {}) {
  const lus = { apollon: 0, conversations: 0 };
  const src: SourceWidget = {
    appli: (id) => (id === 'aegir' ? { id, name: 'Apollon', family: 'Maison' } : undefined), vue: async () => null,
    action: (appli, action) => (o.actions === false || appli !== 'aegir' || !['jouer', 'stop'].includes(action) ? undefined : { label: action, grave: false, proprietaireSeul: false }),
    meteo: async () => undefined, lieu: () => ({ choisi: true, nom: 'Lieu A', fuseau: 'UTC', heure12: false }), maintenant: () => MAINT,
    ...(o.sansApollon ? {} : { apollon: () => { lus.apollon++; return o.apo === null ? undefined : (o.apo ?? APO()); } }),
    ...(o.sansConvs ? {} : { conversationsRecentes: () => { lus.conversations++; return o.convs === null ? undefined : (o.convs ?? CONVS()); } }),
  };
  return { src, lus };
}

test('les sortes : famille « medias », tailles de la maquette (4 × 2, 3 × 2 au moins), propriétaire seul, jamais sur l\'écran de la maison', () => {
  for (const [id, applis] of [['lecteur', ['aegir']], ['messages', []]] as const) {
    const s = sorteDe(id);
    assert.ok(s, `${id} déclarée`); assert.equal(s.famille, 'medias'); assert.equal(s.posable, true);
    assert.deepEqual([[...s.taille.mini], s.taille.r, [...(s.applis as readonly string[])]], [[3, 2], 2, applis], id);
    assert.equal(publicDe(s), 'proprietaire', `${id} : propriétaire seul`);
    assert.equal(s.jamaisALaMaison, true, `${id} : la marque`);
    assert.equal(admiseALaMaison(id), false, `${id} : la règle de l'écran de la maison lit la marque`); assert.equal(copiable(id), false);
    assert.deepEqual((TAILLE_SORTE as Record<string, unknown>)[id], { mini: [3, 2], r: 2 }, `${id} : la taille gardée par Hestia`);
  }
});

test('« Lecteur » : ses radios et ses listes, ce qui a été lancé, les deux actions qui existent ; ni barre, ni durée, ni précédent, ni suivant, ni pause', async () => {
  const e = await etat(W('lecteur'), LUI, fausse({ apo: { ...APO(), joue: { quoi: 'Radio A', sorte: 'radio', depuis: MAINT - 4 * MIN } } }).src);
  assert.equal(e.etat, 'ok', JSON.stringify(e));
  assert.deepEqual(e.donnee, { radios: ['Radio A', 'Radio B'], listes: [{ nom: 'Liste A', morceaux: 2 }], joue: { quoi: 'Radio A', sorte: 'radio', depuis: MAINT - 4 * MIN }, jouer: true, arreter: true });
  assert.doesNotMatch(JSON.stringify(e), /duree|position|progres|precedent|suivant|pause|url|http/i);
  // Rien de lancé : rien n'est servi (ni « à l'arrêt », ni « en cours »).
  const sans = await etat(W('lecteur'), LUI, fausse().src);
  assert.equal('joue' in sans.donnee!, false);
  // Sur une enceinte : son nom.
  const enc = await etat(W('lecteur'), LUI, fausse({ apo: { ...APO(), joue: { quoi: 'Liste A', sorte: 'liste', enceinte: 'Enceinte essai', depuis: MAINT } } }).src);
  assert.deepEqual(enc.donnee!.joue, { quoi: 'Liste A', sorte: 'liste', enceinte: 'Enceinte essai', depuis: MAINT });
  // Une action qui n'existe plus : pas de bouton.
  const x = await etat(W('lecteur'), LUI, fausse({ actions: false }).src);
  assert.deepEqual([x.donnee!.jouer, x.donnee!.arreter], [false, false]);
  // Une valeur de travers n'est pas servie.
  const t = await etat(W('lecteur'), LUI, fausse({ apo: { radios: ['Radio A', 3 as never, ''], listes: [{ nom: 'Liste A', morceaux: -1 }, null as never], joue: { quoi: '', sorte: 'radio', depuis: MAINT } } }).src);
  assert.deepEqual([t.donnee!.radios, t.donnee!.listes, 'joue' in t.donnee!], [['Radio A'], [], false]);
});

test('« Lecteur » : aucune radio ni liste → « vide » ; Apollon coupé → « source_absente » ; jamais un chiffre', async () => {
  assert.deepEqual(await etat(W('lecteur'), LUI, fausse({ apo: { radios: [], listes: [] } }).src), { etat: 'vide', raison: 'rien_a_ecouter' });
  // Rien à proposer, mais une lecture lancée d'ailleurs (la Discussion) : elle est dite, avec « Arrêter ».
  const l = await etat(W('lecteur'), LUI, fausse({ apo: { radios: [], listes: [], joue: { quoi: 'Titre C', sorte: 'morceau', depuis: MAINT } } }).src);
  assert.equal(l.etat, 'ok'); assert.equal(l.donnee!.joue.quoi, 'Titre C');
  assert.deepEqual(await etat(W('lecteur'), LUI, fausse({ apo: null }).src), { etat: 'source_absente', raison: 'appli_absente' });
  assert.deepEqual(await etat(W('lecteur'), LUI, fausse({ sansApollon: true }).src), { etat: 'source_absente', raison: 'pas_encore_lu' });
  // Apollon désactivée : la règle commune le dit, sans rien lire.
  const { src, lus } = fausse(); src.appli = () => undefined;
  assert.deepEqual(await etat(W('lecteur'), LUI, src), { etat: 'source_absente', raison: 'appli_absente' }); assert.equal(lus.apollon, 0);
});

test('« Messages » : ses conversations récentes, par titre et par âge, la plus récente d\'abord ; d\'où elles viennent quand Odin le sait ; aucun « non lus »', async () => {
  const e = await etat(W('messages'), LUI, fausse().src);
  assert.equal(e.etat, 'ok', JSON.stringify(e)); assert.equal(e.at, MAINT);
  assert.deepEqual(e.donnee, { total: 3, conversations: [
    { titre: 'Titre un', at: MAINT - 3 * MIN },
    { titre: 'Titre maison', at: MAINT - 30 * MIN, origine: 'maison' },
    { titre: 'Titre de la principale', at: MAINT - 60 * MIN, origine: 'principal' },
  ] });
  assert.doesNotMatch(JSON.stringify(e), /non_?lus|nonLus|unread|texte|message|peer|membre/i, 'ni compteur, ni texte de message, ni identifiant');
  // Douze servies au plus ; le total dit le reste.
  const beaucoup = await etat(W('messages'), LUI, fausse({ convs: Array.from({ length: 30 }, (_, i) => ({ peer: `c-essai${i}`, titre: `Titre ${i}`, at: MAINT - i * MIN })) }).src);
  assert.deepEqual([beaucoup.donnee!.conversations.length, beaucoup.donnee!.total], [12, 30]);
  // Un âge de travers n'est pas servi (la page ne montre alors pas d'âge).
  const t = await etat(W('messages'), LUI, fausse({ convs: [{ peer: 'c-essai1', titre: 'Titre un', at: Number.NaN }, { peer: 'c-essai2', titre: 7 as never, at: MAINT }] }).src);
  assert.deepEqual(t.donnee!.conversations, [{ titre: '', at: MAINT }, { titre: 'Titre un' }]);
});

test('« Messages » : aucune conversation → « vide » ; la lecture pas branchée → « source_absente »', async () => {
  assert.deepEqual(await etat(W('messages'), LUI, fausse({ convs: [] }).src), { etat: 'vide', raison: 'aucune_conversation' });
  assert.deepEqual(await etat(W('messages'), LUI, fausse({ convs: [{ peer: 'membre-essai', titre: 'x', at: MAINT }] }).src), { etat: 'vide', raison: 'aucune_conversation' });
  assert.deepEqual(await etat(W('messages'), LUI, fausse({ convs: null }).src), { etat: 'source_absente', raison: 'pas_encore_lu' });
  assert.deepEqual(await etat(W('messages'), LUI, fausse({ sansConvs: true }).src), { etat: 'source_absente', raison: 'pas_encore_lu' });
});

test('qui voit quoi : un membre (même avec tous les droits), une tablette, l\'écran de la maison (lui compris) : refusés AVANT la lecture, sans un titre', async () => {
  const membreTout: Lecteur = { qui: 'membre', ecran: 'accueil', peutLire: () => true, ouverts: new Set(['c5300000@aegir', 'c5300000']) };
  for (const kind of ['lecteur', 'messages']) {
    for (const [qui, l] of [['membre avec tous les droits', membreTout], ['tablette', TABLETTE], ['tablette sur l\'accueil', { qui: 'maison', ecran: 'accueil' } as Lecteur],
      ['lui, sur l\'écran de la maison', { qui: 'proprietaire', ecran: 'maison' } as Lecteur]] as const) {
      const { src, lus } = fausse({ apo: { ...APO(), joue: { quoi: 'Radio A', sorte: 'radio', depuis: MAINT } } });
      const r = await etat(W(kind), l, src);
      assert.equal(r.etat, 'refuse', `${kind}, ${qui}`);
      assert.deepEqual(lus, { apollon: 0, conversations: 0 }, `${kind}, ${qui} : la lecture n'est même pas appelée`);
      assert.doesNotMatch(JSON.stringify(r), /Titre|Radio|Liste/, `${kind}, ${qui} : rien`);
    }
    // La lecture seule le redit : appelée directement pour un autre que lui, elle refuse sans rien lire.
    for (const l of [membreTout, TABLETTE, { qui: 'proprietaire', ecran: 'maison' } as Lecteur]) {
      const { src, lus } = fausse();
      assert.equal(((await sorteDe(kind)!.lire!(W(kind), src, l)) as Etat).etat, 'refuse'); assert.deepEqual(lus, { apollon: 0, conversations: 0 });
    }
  }
});

test('un titre piégé (du HTML, très long) reste du texte borné ; un nom de radio aussi', async () => {
  const PIEGE = `<img src=x onerror="alert(1)">${'x'.repeat(500)}`;
  const e = await etat(W('messages'), LUI, fausse({ convs: [{ peer: 'c-essai1', titre: PIEGE, at: MAINT }] }).src);
  assert.deepEqual(e.donnee!.conversations, [{ titre: PIEGE.slice(0, 200), at: MAINT }]);
  const r = await etat(W('lecteur'), LUI, fausse({ apo: { radios: [PIEGE], listes: [] } }).src);
  assert.deepEqual(r.donnee!.radios, [PIEGE.slice(0, 200)]);
});

// ------------------------------------------------------------------ la page, sans navigateur

const fenetreVm = () => { const win: Record<string, any> = {}; for (const s of [MEDIAS, RENDU, GRILLE]) vm.runInNewContext(s, { window: win }); return win; };
const ici = <X>(x: X): X => JSON.parse(JSON.stringify(x));

test('la page : la famille se déclare (propriétaire seul, jamais sur l\'écran de la maison, taille de la maquette 4 × 2) ; la grille connaît leurs tailles', () => {
  const win = fenetreVm(), R = win.OdinWidgetsRendu, G = win.OdinGrille;
  const l = R.rendu('lecteur'), m = R.rendu('messages');
  assert.deepEqual(ici([l?.titre, l?.appli, l?.proprio, l?.jamaisALaMaison]), ['Lecteur', 'aegir', true, true]);
  assert.deepEqual(ici([m?.titre, m?.appli, m?.proprio, m?.groupe, m?.jamaisALaMaison]), ['Messages', '', true, 'odin', true]);
  for (const x of [l, m]) assert.deepEqual(ici([x.w.c, x.w.r]), [4, 2], 'posé à la taille de la maquette');
  assert.equal(R.groupeTiroir(l, 'Maison'), 'Maison', 'le lecteur va avec la famille d\'Apollon, comme la maquette');
  assert.deepEqual(ici(R.posables({ proprio: false, aDroit: () => true }).filter((y: any) => y.famille === 'medias')), [], 'jamais à un membre');
  for (const k of ['lecteur', 'messages']) {
    assert.equal(R.copieRefusee({ kind: k, versMaison: true, privee: false }), 'maison');
    assert.deepEqual([[...G.MINI[k]], G.HAUTEUR[k]], [[...sorteDe(k)!.taille.mini], sorteDe(k)!.taille.r], `${k} : les tables de la grille suivent le serveur`);
  }
  // Le texte d'une donnée : jamais par innerHTML (seules les icônes dessinées ici le sont).
  assert.deepEqual([...MEDIAS.matchAll(/innerHTML\s*=\s*([^;]+);/g)].map((x) => x[1].trim()), ['icone(k)']);
  assert.ok(!new RegExp(`${'fr'}-FR|timeZone|\\d+\\.\\d+\\.\\d+\\.\\d+`).test(MEDIAS));
  // Ce qu'Apollon ne sait pas faire n'est pas dessiné ; aucun compteur de non lus ; aucune autre route que l'action d'une appli.
  const code = MEDIAS.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/ .*$/gm, '');
  assert.doesNotMatch(code, /Précédent|Suivant|Pause|progress|non lus|unread|<audio|<video|@keyframes|animation/i);
  assert.deepEqual([...new Set([...MEDIAS.matchAll(/'(\/api\/[^']*)'/g)].map((x) => x[1]))], ['/api/valhalla/act']);
  assert.match(MEDIAS, /action: 'jouer'/); assert.match(MEDIAS, /action: 'stop'/);
});

test('la page : l\'heure d\'un lancement et l\'âge d\'une conversation dans la langue de la page ; rien d\'inventé d\'une donnée illisible', () => {
  const win = fenetreVm(), R = win.OdinWidgetsRendu, M = win.OdinWidgetsMedias;
  assert.equal(M.ilYa(MAINT - 3 * 60 * MIN, MAINT, 'en'), '3 hours ago');
  for (const x of [0, Number.NaN, MAINT + 5 * MIN, undefined]) assert.equal(M.ilYa(x, MAINT, 'en'), '', String(x));
  assert.equal(M.titreConv({ titre: '[web] Un  titre ', origine: '' }), 'Un titre', 'comme la Discussion le montre');
  assert.equal(M.titreConv({ titre: 'peu importe', origine: 'principal' }), 'Discussion');
  assert.equal(M.titreConv({ titre: '', origine: '' }), 'sans titre');
  assert.equal(R.dessineElleMeme(R.rendu('lecteur'), { etat: 'vide', raison: 'rien_a_ecouter', donnee: false }), true);
  assert.equal(R.dessineElleMeme(R.rendu('messages'), { etat: 'vide', raison: 'aucune_conversation', donnee: false }), true);
  for (const donnee of [{}, { radios: 'x' }, { radios: [], listes: [] }]) assert.equal(M.lecteur({ etat: 'ok', at: MAINT, donnee }, { w: { kind: 'lecteur', c: 4, r: 2 }, ecran: 'accueil' }), null, JSON.stringify(donnee));
  for (const donnee of [{}, { conversations: [] }, { conversations: [{ at: 3 }] }]) assert.equal(M.messages({ etat: 'ok', at: MAINT, donnee }, { w: { kind: 'messages', c: 4, r: 2 }, ecran: 'accueil' }), null, JSON.stringify(donnee));
});

// ------------------------------------------------------------------ un vrai Odin d'essai

const tt = new Banc(), orig = { log: console.log, error: console.error, warn: console.warn, info: console.info };
let v: VraiOdin, membreTout = '', cleMaison = '';
const MDP = 'une-pirogue-sur-le-lagon-calme';
const cookieDe = (r: Response, nom: string) => r.headers.getSetCookie().find((c) => c.startsWith(`${nom}=`))?.split(';')[0] ?? '';
async function entrer(ident: string, mdp: string): Promise<string> {
  let r = await fetch(`${v.url}/sso/odin`, { redirect: 'manual' }); assert.equal(r.status, 303);
  r = await fetch(new URL(r.headers.get('location')!, v.url), { redirect: 'manual' }); const demande = /name="demande" value="([^"]+)"/.exec(await r.text())![1];
  r = await fetch(`${v.url}/sso/autoriser`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded', origin: v.url }, body: new URLSearchParams({ demande, identifiant: ident, motdepasse: mdp }) });
  r = await fetch(r.headers.get('location')!, { redirect: 'manual' }); assert.equal(r.status, 303, 'session ouverte');
  return cookieDe(r, 'odin_session');
}
const PAGE = 'b5300001', ID = { lecteur: 'c5300001', messages: 'c5300002', lecteurMini: 'c5300003', messagesMini: 'c5300004', lecteurVide: 'c5300005', messagesVide: 'c5300006', lecteurLarge: 'c5300007', lecteurVideMini: 'c5300008' };
const FENETRE = () => ({ pages: [{ id: PAGE, name: 'Médias', widgets: [
  { id: ID.lecteur, kind: 'lecteur', w: 1, c: 4, r: 2 }, { id: ID.messages, kind: 'messages', w: 1, c: 4, r: 2 },
  { id: ID.lecteurMini, kind: 'lecteur', w: 1, c: 3, r: 2 }, { id: ID.messagesMini, kind: 'messages', w: 1, c: 3, r: 2 },
  { id: ID.lecteurVide, kind: 'lecteur', w: 1, c: 4, r: 2 }, { id: ID.messagesVide, kind: 'messages', w: 1, c: 4, r: 2 },
  { id: ID.lecteurLarge, kind: 'lecteur', w: 3, c: 12, r: 3 },
  // La phrase « vide » dans la plus petite carte (3 × 2) : elle doit tenir en entier au-dessus de son bouton.
  { id: ID.lecteurVideMini, kind: 'lecteur', w: 1, c: 3, r: 2 },
] }] });
type Rendue = { id: string; kind: string; etat: string; raison?: string; donnee?: Record<string, any> };
const donnees = async (h: Record<string, string> = {}) => { const r = await v.json(`/api/widgets/donnees?page=${PAGE}`, undefined, h); return { status: r.status, corps: JSON.stringify(r.body), de: (id: string) => ((r.body.widgets as Rendue[] | undefined) ?? []).find((x) => x.id === id) }; };

before(async () => {
  for (const k of ['log', 'error', 'warn', 'info'] as const) console[k] = () => {};
  v = await vraiOdin(tt, { compte: true, modules: (o) => allModules(o).filter((m) => ['gladsheim', 'var', 'aegir', 'apparence'].includes(m.id)) });
  const va = valhallaOf()!;
  // Ses conversations : deux de la Discussion, une d'une autre sorte (hors de la Discussion).
  const mu = v.o.muninn;
  for (const [id, titre] of [['web:c-essai1', 'Conversation essai un'], ['web:c-essai2', 'Conversation essai deux'], ['web:membre-essai', 'Conversation hors fil']]) { mu.ensureSession(id, 'web', id.slice(4)); mu.setSessionTitle(id, titre); }
  assert.equal((await va.act('aegir', 'radio', { nom: 'Radio essai', adresse: 'http://192.0.2.40/flux' })).ok, true);
  assert.equal((await va.act('var', 'ajouter', { login: 'membre-t', nom: 'Membre T', groupes: 'invite', mot_de_passe: MDP })).ok, true);
  for (const appli of ['odin', 'gladsheim', 'aegir']) assert.equal((await va.act('var', 'donner_acces', { appli, qui: '@membre-t' })).ok, true);
  lierProprietaire(persona()!);
  membreTout = await entrer('membre-t', MDP); assert.ok(membreTout, 'le membre a une session');
  cleMaison = ((await va.act('gladsheim', 'cle_tablette', { nom: 'Tablette maison', droits: 'maison' })).data as { key: string }).key;
  const r = await va.act('gladsheim', 'regler_fenetre', { fenetre: JSON.stringify(FENETRE()) }); assert.equal(r.ok, true, r.text);
});
after(async () => { await tt.end(); Object.assign(console, orig); });

test('vrai Odin : les conversations sont branchées ; il voit les siennes de la Discussion, et ses radios d\'Apollon, sans adresse', async () => {
  assert.equal(typeof conversationsBranchees(), 'function', 'branché par allModules');
  const d = await donnees();
  assert.equal(d.status, 200);
  const m = d.de(ID.messages)!;
  assert.equal(m.etat, 'ok', JSON.stringify(m));
  assert.deepEqual(m.donnee!.conversations.map((c: any) => c.titre).sort(), ['Conversation essai deux', 'Conversation essai un']);
  assert.ok(m.donnee!.conversations.every((c: any) => typeof c.at === 'number' && c.at <= Date.now()), 'l\'âge vrai');
  const l = d.de(ID.lecteur)!;
  assert.equal(l.etat, 'ok', JSON.stringify(l));
  assert.deepEqual([l.donnee!.radios, l.donnee!.listes, 'joue' in l.donnee!, l.donnee!.jouer, l.donnee!.arreter], [['Radio essai'], [], false, true, true]);
  assert.doesNotMatch(d.corps, /192\.0\.2|flux|hors fil/, 'ni adresse de radio, ni conversation hors de la Discussion');
});

test('vrai Odin : un membre avec tous les droits, une tablette « maison », une clé d\'accès, sans session : refusés sans un titre, et la lecture n\'est même pas appelée', async () => {
  const vraie = conversationsBranchees()!; let appels = 0;
  brancherConversations(() => { appels++; return vraie(); });
  try {
    const m = await donnees({ cookie: membreTout });
    assert.equal(m.status, 200);
    for (const id of Object.values(ID)) { const x = m.de(id)!; assert.deepEqual([x.etat, x.donnee], ['refuse', undefined], `membre : ${id}`); }
    assert.doesNotMatch(m.corps, /Conversation essai|Radio essai/, 'membre : rien');
    for (const [qui, h] of [['tablette', { cookie: '', 'x-odin-maison': cleMaison }], ['clé d\'accès', { cookie: '', authorization: `Bearer ${v.token}` }], ['sans session', { cookie: '' }]] as const) {
      const r = await donnees(h);
      assert.equal(r.status, 401, qui); assert.doesNotMatch(r.corps, /Conversation essai|Radio essai/, `${qui} : rien`);
    }
    assert.equal(appels, 0, 'la lecture des conversations n\'a pas été appelée');
    assert.equal((await donnees()).de(ID.messages)!.etat, 'ok'); assert.ok(appels > 0, 'pour lui, elle l\'est');
  } finally { brancherConversations(vraie); }
});

// ------------------------------------------------------------------ dans un vrai navigateur (s'il y en a un)

declare const document: any, window: any, getComputedStyle: any, location: any, requestAnimationFrame: any;
interface Route { fetch(): Promise<{ json(): Promise<any> }>; fulfill(o: Record<string, unknown>): Promise<void>; continue(): Promise<void>; request(): { postDataJSON(): any } }
interface Page {
  goto(u: string): Promise<unknown>; waitForSelector(s: string, o?: Record<string, unknown>): Promise<unknown>; click(s: string): Promise<void>;
  waitForFunction(f: string | ((a: any) => unknown), a?: unknown, o?: Record<string, unknown>): Promise<unknown>; evaluate<X>(f: string | ((a?: any) => X), a?: unknown): Promise<X>;
  route(u: string | RegExp, h: (r: Route) => Promise<void> | void): Promise<void>; on(e: string, f: (x: any) => void): void; screenshot(o: Record<string, unknown>): Promise<unknown>;
  keyboard: { press(k: string): Promise<void> }; emulateMedia(o: Record<string, unknown>): Promise<void>;
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
const PIEGE = `<img src=x onerror="window.__piege=1">${'x'.repeat(180)}`;
/** Les données forcées : des radios et des listes (dont un nom piégé), un lancement ; des conversations (dont un titre piégé). */
const LECTEUR = () => ({ radios: ['Radio A', PIEGE, 'Radio C', 'Radio D', 'Radio E', 'Radio F'], listes: [{ nom: 'Liste A', morceaux: 3 }, { nom: 'Liste B', morceaux: 1 }], joue: { quoi: 'Radio A', sorte: 'radio', depuis: Date.now() - 4 * MIN }, jouer: true, arreter: true });
const MESSAGES = () => { const t = Date.now(); return { total: 9, conversations: [{ titre: PIEGE, at: t - 3 * MIN }, { titre: 'Conversation B', at: t - 50 * MIN, origine: 'maison' }, { titre: '', at: t - 5 * 60 * MIN, origine: 'principal' }, { titre: 'Conversation D', at: t - 2 * 24 * 60 * MIN }, { titre: 'Conversation E' }] }; };

async function ouvrir(largeur: number, sombre: boolean) {
  const doigt = largeur < 500;
  assert.equal((await valhallaOf()!.act('apparence', 'theme', { theme: sombre ? 'nuit' : 'glace' })).ok, true);
  const ctx = await nav!.newContext({ viewport: { width: largeur, height: doigt ? 800 : 900 }, hasTouch: doigt, isMobile: doigt, colorScheme: sombre ? 'dark' : 'light', reducedMotion: 'reduce' });
  const [n, ...x] = v.session.split('='); await ctx.addCookies([{ name: n, value: x.join('='), url: v.url, httpOnly: true, sameSite: 'Strict' }]);
  await ctx.addInitScript(`try { localStorage.setItem('odin.tour', 'done'); localStorage.setItem('odin.fenetre.page', '1'); } catch { /* rien */ }`);
  const p = await ctx.newPage(), erreurs: string[] = [], envois: any[] = [];
  p.on('pageerror', (e) => erreurs.push(String(e)));
  await p.route(/\/api\/widgets\/donnees/, async (r) => {
    const rep = await r.fetch(), j = await rep.json();
    if (Array.isArray(j?.widgets)) j.widgets = j.widgets.map((w: any) => (w.kind !== 'lecteur' && w.kind !== 'messages' ? w
      : w.id === ID.lecteurVide || w.id === ID.lecteurVideMini ? { id: w.id, kind: w.kind, page: w.page, etat: 'vide', raison: 'rien_a_ecouter' }
        : w.id === ID.messagesVide ? { id: w.id, kind: w.kind, page: w.page, etat: 'vide', raison: 'aucune_conversation' }
          : { id: w.id, kind: w.kind, page: w.page, etat: 'ok', at: Date.now(), donnee: w.kind === 'lecteur' ? LECTEUR() : MESSAGES() }));
    await r.fulfill({ response: rep, json: j });
  });
  // Le faux lecteur : l'action d'Apollon n'atteint jamais le serveur (aucune commande, aucun son).
  // Les autres actions (la fenêtre d'Hestia…) vont au serveur d'essai.
  await p.route(/\/api\/valhalla\/act/, async (r) => { const b = r.request().postDataJSON(); if (b?.module !== 'aegir') return r.continue(); envois.push(b); await r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, text: 'Réponse essai.' }) }); });
  await p.goto(v.url + '/');
  await p.waitForSelector('#app:not([hidden])', { timeout: 30000 });
  try { await p.waitForSelector(`${carte(ID.lecteur)} .wd-choix`, { timeout: 45000 }); await p.waitForSelector(`${carte(ID.messages)} .wd-conv`, { timeout: 45000 }); }
  catch (e) { const vus = await p.evaluate(() => [location.hash, String(document.querySelector('#fenetre')?.textContent ?? 'pas de fenêtre').slice(0, 300), ...[...document.querySelectorAll('#feGrid > .fe-w')].map((c: any) => `${c.dataset.id}: ${c.textContent.slice(0, 80)}`)]); await ctx.close(); throw new Error(`${String(e).split('\n')[0]} · cartes : ${JSON.stringify(vus)} · ${erreurs.join(' | ')}`); }
  return { ctx, page: p, erreurs, envois };
}
const vu = (p: Page) => p.evaluate(async (ids: Record<string, string>) => {
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  const vw = document.documentElement.clientWidth, txt = (n: any) => (n?.textContent ?? '').replace(/\s+/g, ' ').trim();
  const out: Record<string, any> = { deborde: document.documentElement.scrollWidth > vw + 1, piege: Boolean(window.__piege) || Boolean(document.querySelector('#feGrid img[src="x"]')) };
  for (const [nom, id] of Object.entries(ids)) {
    const c = document.querySelector(`#feGrid > .fe-w[data-id="${id}"]`); if (!c) { out[nom] = null; continue; }
    const b = c.getBoundingClientRect(), visible = (n: any) => n.checkVisibility() && n.getBoundingClientRect().height > 0;
    const dans = (n: any) => { const r = n.getBoundingClientRect(); return r.width === 0 || (r.left >= b.left - 1 && r.right <= b.right + 1 && r.top >= b.top - 1 && r.bottom <= b.bottom + 1); };
    out[nom] = {
      texte: txt(c), larg: Math.round(b.width), corps: Math.round(c.querySelector('.wd-corps')?.getBoundingClientRect().height ?? 0), dedans: [...c.querySelectorAll('*')].filter(visible).every(dans), haut: Math.round(b.height),
      petits: [...c.querySelectorAll('button, a')].filter((n: any) => { const r = n.getBoundingClientRect(); return r.width && (r.width < 44 || r.height < 44); }).map((n: any) => n.getAttribute('aria-label') || txt(n)),
      choix: [...c.querySelectorAll('.wd-choix')].filter(visible).map((n: any) => txt(n.querySelector('.wd-n'))), bullesChoix: [...c.querySelectorAll('.wd-choix .wd-n')].map((n: any) => n.title),
      convs: [...c.querySelectorAll('.wd-conv')].filter(visible).map((n: any) => txt(n.querySelector('.wd-n'))), bullesConvs: [...c.querySelectorAll('.wd-conv .wd-n')].map((n: any) => n.title),
      metas: [...c.querySelectorAll('.wd-conv .wd-m')].filter(visible).map(txt), coupesCourts: [...c.querySelectorAll('.wd-choix .wd-n')].filter(visible).filter((n: any) => n.textContent.length <= 12 && n.scrollWidth > n.clientWidth + 1).map(txt), coupes: [...c.querySelectorAll('.wd-n')].filter(visible).map((n: any) => n.scrollWidth > n.clientWidth + 1),
      joue: txt(c.querySelector('.wd-joue')), joueBulle: c.querySelector('.wd-joue')?.title ?? '', plus: txt(c.querySelector('.wd-plus')), arreter: Boolean(c.querySelector('.wd-stop')),
      defileTout: [...c.querySelectorAll('.wd-defile')].every((n: any) => n.scrollHeight <= n.clientHeight + 1),
      // La phrase calme se lit en entier : aucune ligne coupée au bas de sa zone (ni sous le bouton qui la suit).
      calmeEntier: [...c.querySelectorAll('.wd-calme')].filter(visible).every((n: any) => { const r = n.getBoundingClientRect(), z = n.parentElement.getBoundingClientRect(); return r.bottom <= z.bottom + 1 && n.scrollHeight <= n.clientHeight + 1; }),
      // Ce qui a été lancé se lit en entier (le nom, « lancé … », où) : rien de coupé, ni en largeur ni en hauteur.
      joueEntier: [...c.querySelectorAll('.wd-joue')].filter(visible).every((n: any) => n.scrollWidth <= n.clientWidth + 1 && n.scrollHeight <= n.clientHeight + 1),
      // La première conversation : la largeur rendue de son titre et de son âge.
      larg0: (() => { const b0 = c.querySelector('.wd-conv'); if (!b0) return null; const t = b0.querySelector('.wd-n'), m = b0.querySelector('.wd-m'); return { titre: t ? t.getBoundingClientRect().width : 0, titreCoupe: t ? t.scrollWidth > t.clientWidth + 1 : false, meta: m ? m.getBoundingClientRect().width : 0, metaCoupe: m ? m.scrollWidth > m.clientWidth + 1 : false }; })(),
      anime: [...c.querySelectorAll('*')].some((n: any) => getComputedStyle(n).animationName !== 'none'),
      ink: (() => { const s = document.createElement('i'); c.append(s); s.style.color = 'var(--ink)'; const k = getComputedStyle(s).color; s.remove(); return k; })(),
      nomCouleur: c.querySelector('.wd-n') ? getComputedStyle(c.querySelector('.wd-n')).color : '',
    };
  }
  return out;
}, ID);
const clarte = (rgb: string) => { const [r, g, b] = (rgb.match(/[\d.]+/g) ?? []).map(Number); return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255; };
const CARTES = Object.keys(ID);

for (const [largeur, sombre] of [[1280, false], [390, true], [768, true], [768, false], [1280, true], [390, false]] as const) {
  test(`navigateur, ${largeur} px, ${sombre ? 'sombre' : 'clair'} : ses radios, ses listes, « lancé à », « Arrêter » ; ses conversations ; les noms piégés en texte borné ; tout au clavier`, { skip: sansNav, timeout: 180_000 }, async () => {
    const { ctx, page: p, erreurs, envois } = await ouvrir(largeur, sombre);
    try {
      const x = await vu(p);
      assert.equal(x.deborde, false, 'rien ne déborde de la page'); assert.equal(x.piege, false, 'un nom piégé n\'est jamais du code');
      // « Lecteur »
      assert.equal(x.lecteur.choix[0], 'Radio A'); assert.match(x.lecteur.joue, /Radio A/); assert.match(x.lecteur.joue, /\d/, `l'heure du lancement : ${x.lecteur.joue}`);
      assert.doesNotMatch(x.lecteur.joue, /en cours|joue en ce moment/i, 'jamais « en cours »');
      assert.equal(x.lecteur.arreter, true);
      assert.doesNotMatch(x.lecteur.texte + x.messages.texte, /Précédent|Suivant|Pause|non lus|\d:\d\d \/ /, 'ni ce qu\'Apollon ne sait pas faire, ni compteur');
      if (x.lecteurLarge.choix.length > 1) { assert.equal(x.lecteurLarge.choix[1], PIEGE, 'le nom piégé, tel quel'); assert.equal(x.lecteurLarge.bullesChoix[1], PIEGE, 'en entier dans l\'info-bulle'); }
      // Hors téléphone, la grande carte montre aussi ses listes ; au téléphone, deux choix par ligne de grille, puis « et N de plus ».
      assert.ok(x.lecteurLarge.coupesCourts.length === 0, `la grande carte : un nom court se lit en entier (${x.lecteurLarge.coupesCourts})`);
      if (largeur > 700) assert.ok(x.lecteurLarge.choix.includes('Liste A'), `la grande carte montre aussi ses listes (${x.lecteurLarge.choix})`);
      else { assert.equal(x.lecteurLarge.choix.length, 6); assert.match(x.lecteurLarge.plus, /2/); }
      assert.match(x.lecteur.plus, /\d/, `et N de plus (${x.lecteur.texte})`);
      assert.match(x.lecteurVide.texte, /Aucune radio/);
      // Hors téléphone (hauteur tenue), une petite carte (4 × 2 comme 3 × 2) montre toujours au moins une radio à lancer :
      // « et N de plus » n'est pas un bouton, une carte qui n'aurait que lui ne lancerait rien.
      if (largeur > 700) for (const k of ['lecteur', 'lecteurMini']) assert.ok(x[k].choix.length >= 1, `${largeur} px, ${k} : au moins une radio à lancer (${x[k].texte})`);
      if (largeur >= 1280) assert.ok(x.lecteur.choix.length >= 2, `1280 px, 4 × 2 : la place se remplit (${x.lecteur.choix})`);
      // La phrase « vide », en 4 × 2 comme en 3 × 2 : en entier.
      for (const k of ['lecteurVide', 'lecteurVideMini', 'messagesVide']) assert.equal(x[k].calmeEntier, true, `${k} : la phrase vide se lit en entier`);
      // Ce qui a été lancé : le nom, « lancé … » et où, jamais coupés (au doigt, pas d'info-bulle). Seule exception : les petites
      // cartes (4 × 2, 3 × 2) à 768 px, où une radio à lancer passe d'abord : la ligne y est coupée, entière dans l'info-bulle.
      for (const k of ['lecteur', 'lecteurMini', 'lecteurLarge']) if (largeur === 768 && k !== 'lecteurLarge' && !x[k].joueEntier) assert.equal(x[k].joueBulle, x[k].joue, `${k} : coupé, entier dans l'info-bulle`); else assert.equal(x[k].joueEntier, true, `${k} : « ${x[k].joue} » se lit en entier (carte ${x[k].larg} px, corps ${x[k].corps} px, ${x[k].choix.length} choix)`);
      // Une conversation : le titre passe avant l'âge ; tant que le titre est coupé, l'âge en prend nettement moins (×1,4).
      for (const k of ['messages', 'messagesMini']) { const l = x[k].larg0; if (l && l.titreCoupe) assert.ok(l.titre >= 1.4 * l.meta, `${k} : le titre (${Math.round(l.titre)} px) passe avant l'âge (${Math.round(l.meta)} px)`); }
      // « Messages »
      assert.equal(x.messages.convs[0], PIEGE); assert.equal(x.messages.bullesConvs[0], PIEGE);
      assert.ok(x.messages.convs.includes('Conversation B') || x.messagesMini.convs.length >= 1, 'les suivantes si elles tiennent');
      if (x.messages.convs.length > 1) assert.match(x.messages.metas[1], /maison/, 'd\'où elle vient');
      assert.match(x.messages.plus, /\d/); assert.match(x.messagesVide.texte, /Aucune conversation/);
      for (const k of CARTES) {
        assert.deepEqual(x[k].petits, [], `${k} : des cibles de 44 px`); assert.equal(x[k].dedans, true, `${k} : dans sa carte`);
        assert.equal(x[k].defileTout, true, `${k} : rien de coupé au bord`); assert.equal(x[k].anime, false, `${k} : aucun mouvement`);
      }
      if (largeur > 700) assert.ok(Math.abs(x.lecteur.haut - 162) <= 2, `4 × 2 : ${x.lecteur.haut} px, la carte ne s'étire pas`);
      assert.ok(sombre ? clarte(x.lecteur.ink) > 0.5 : clarte(x.lecteur.ink) < 0.5, `le thème ${sombre ? 'sombre' : 'clair'} (${x.lecteur.ink})`);
      assert.equal(x.messages.nomCouleur, x.messages.ink, 'la couleur du texte du thème');
      if (CAPTURES) await p.screenshot({ path: `${CAPTURES}/medias-${largeur}${sombre ? '-sombre' : '-clair'}.png`, fullPage: true });
      // Au clavier : une radio lance « jouer », « Arrêter » lance « stop » (le faux lecteur répond) ; le focus se voit.
      await p.evaluate((s: string) => document.querySelector(s).focus(), `${carte(ID.lecteur)} .wd-choix`);
      assert.notEqual(await p.evaluate(() => getComputedStyle(document.activeElement).outlineStyle), 'none', 'le focus se voit');
      await p.keyboard.press('Enter');
      await p.waitForFunction((s: string) => /Réponse essai/.test(document.querySelector(s)?.textContent ?? ''), `${carte(ID.lecteur)} .wd-dit`, { timeout: 10000 });
      await p.evaluate((s: string) => document.querySelector(s).focus(), `${carte(ID.lecteur)} .wd-stop`);
      await p.keyboard.press('Enter');
      await p.waitForFunction(() => true);
      await new Promise((r) => setTimeout(r, 300));
      assert.deepEqual(envois, [{ module: 'aegir', action: 'jouer', input: { quoi: 'Radio A' } }, { module: 'aegir', action: 'stop', input: {} }]);
      // Une conversation ouvre la Discussion.
      await p.evaluate((s: string) => document.querySelector(s).focus(), `${carte(ID.messages)} .wd-conv`);
      await p.keyboard.press('Enter');
      await p.waitForFunction(() => location.hash === '#chat', undefined, { timeout: 10000 });
      assert.deepEqual(erreurs, [], 'aucune erreur dans la page');
    } finally { await ctx.close(); }
  });
}

test('navigateur : en mode « Modifier », rien ne part', { skip: sansNav, timeout: 120_000 }, async () => {
  const { ctx, page: p, erreurs, envois } = await ouvrir(1280, false);
  try {
    await p.click('#fenetre .fe-mod'); await p.waitForSelector('#fenetre .fe-edit, #fenetre.fe-edit, .fe-edit');
    await p.evaluate((s: string[]) => { for (const q of s) document.querySelector(q)?.click(); }, [`${carte(ID.lecteur)} .wd-choix`, `${carte(ID.lecteur)} .wd-stop`, `${carte(ID.messages)} .wd-conv`]);
    await new Promise((r) => setTimeout(r, 400));
    assert.deepEqual(envois, [], 'aucune action envoyée'); assert.notEqual(await p.evaluate(() => location.hash), '#chat', 'la Discussion ne s\'ouvre pas');
    assert.deepEqual(erreurs, []);
  } finally { await ctx.close(); }
});

test('navigateur, 320 et 1920 px : rien ne déborde', { skip: sansNav, timeout: 180_000 }, async () => {
  for (const largeur of [320, 1920]) {
    const { ctx, page: p, erreurs } = await ouvrir(largeur, false);
    try {
      const x = await vu(p);
      assert.equal(x.deborde, false, `${largeur} : la page ne déborde pas`);
      for (const k of CARTES) { assert.equal(x[k].dedans, true, `${largeur} : ${k} reste dans sa carte`); assert.equal(x[k].defileTout, true, `${largeur} : ${k}, rien de coupé`); }
      assert.deepEqual(erreurs, []);
    } finally { await ctx.close(); }
  }
});
