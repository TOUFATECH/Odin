// « Régler » un widget (maquette validée « Accueil », lot 25b) : le bouton « ⋯ » ouvre la fenêtre « Régler » — titre,
// taille, style, « Quand je touche le widget » (cinq choix), « Copier vers l'autre écran », « Retirer ».
// Les règles de sûreté de la fiche, prouvées ici :
// - une adresse est nettoyée PAR LE SERVEUR : http ou https seulement, pas d'identifiants, longueur bornée ;
// - une action au toucher part par le chemin de toutes les actions : accord à CHAQUE fois si elle est grave ; un
//   membre ne lance que ce que son droit d'appli permet ; une tablette « maison » ne la reçoit ni ne la lance jamais ;
// - « Copier vers l'autre écran » est refusé pour les quatre sortes réservées et pour un widget de la vie privée qui
//   n'est ouvert à personne ; « À faire » se déplace mais ne se retire pas ;
// - changer « Quand je touche » d'un widget ouvert à quelqu'un le referme pour cette personne (le titre seul peut changer) ;
// - une fenêtre déjà rangée se relit identique.
// Puis, dans un vrai navigateur s'il y en a un : « Régler » au clavier (Échap ferme et rend le focus), au doigt à 390 px.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { after, before, test } from 'node:test';
import vm from 'node:vm';
import { cleanLayout, type FPage, type Layout, type Widget } from '../src/valhalla/modules/gladsheim.ts';
import { allModules, valhallaOf } from '../src/valhalla/odin.ts';
import { lierProprietaire, persona, personnes } from '../src/valhalla/sso/etat.ts';
import { SORTES, copiable, droitDeVoir, sorteDe } from '../src/valhalla/widgets/index.ts';
import { ouverturesDe } from '../src/valhalla/widgets/ouvertures.ts';
import { ADRESSE_MAX, ECRANS_TOUCHER, adresseNette, adressesRefusees, retraitRefuse } from '../src/valhalla/widgets/regler.ts';
import { boutonMaison, lecteurMaison } from '../src/web/widgets-api.ts';
import { T as Banc } from './banc/lib.ts';
import { vraiOdin, type VraiOdin } from './banc/odin-vrai.ts';

const lire = (f: string) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
const RENDU = lire('src/web/pages/widgets-rendu.js');
const FE = lire('src/web/fenetre.js');

interface Rendu {
  TEXTES: { reglage: Record<string, unknown> & { choix: Record<string, unknown>; ecrans: Record<string, string> }; toucher: Record<string, unknown> };
  RESERVEES: string[]; FIXES: string[]; STYLES: Record<string, unknown>; ECRANS_TOUCHER: string[]; ADRESSE_MAX: number;
  adresseNette(v: unknown): string | undefined; retirable(k: unknown): boolean;
  copieRefusee(o?: Record<string, unknown>): string; toucherDe(w: unknown): Record<string, unknown>;
}
const R = (() => { const win: Record<string, unknown> = {}; vm.runInNewContext(RENDU, { window: win, URL }); return win.OdinWidgetsRendu as Rendu; })();

const IDS = ['var', 'gladsheim', 'himinbjorg', 'midgard', 'vordr'];
const SEP = String.fromCharCode(0x2028);
/** Des adresses refusées : autre chose que http ou https, des identifiants, des espaces, trop long, mal écrites. */
const REFUSEES: unknown[] = [
  'javascript:alert(1)', 'JAVASCRIPT:alert(1)', ' javascript:alert(1)', 'java\tscript:alert(1)', 'data:text/html,<script>alert(1)</script>', 'file:///C:/Windows/win.ini',
  'ftp://example.org/', 'vbscript:msgbox(1)', 'blob:https://example.org/1', 'about:blank', 'example.org', '//example.org/', '/chemin', 'https:example.org', 'https:/example.org', 'https://', 'https:///chemin',
  'https://nom:motdepasse@example.org/', 'https://nom@example.org/', 'http://example.org/a b', 'https://example.org/\nx', `https://example.org/${String.fromCharCode(0)}`, `https://example.org/${SEP}x`, 'https://example.org\\@piege.example.org/',
  `https://example.org/${'a'.repeat(ADRESSE_MAX)}`, '', '   ', null, undefined, 42, { adresse: 'https://example.org' }, ['https://example.org'],
];
/** Des adresses gardées, et ce que le serveur en garde (la même relue rend la même). */
const GARDEES: Array<[string, string]> = [
  ['https://example.org', 'https://example.org/'], ['http://example.org/page?x=1#bas', 'http://example.org/page?x=1#bas'], ['  HTTPS://Example.ORG/Page  ', 'https://example.org/Page'],
  ['https://example.org:8443/a', 'https://example.org:8443/a'], ['http://192.0.2.7/', 'http://192.0.2.7/'], ['https://example.org/été', 'https://example.org/%C3%A9t%C3%A9'],
];

test('une adresse est nettoyée par le serveur : http ou https seulement, sans identifiants, bornée ; la page a la même règle', () => {
  for (const a of REFUSEES) {
    assert.equal(adresseNette(a), undefined, `le serveur refuse ${JSON.stringify(a)?.slice(0, 60)}`);
    assert.equal(R.adresseNette(a), undefined, `la page refuse ${JSON.stringify(a)?.slice(0, 60)}`);
  }
  for (const [a, net] of GARDEES) {
    assert.equal(adresseNette(a), net, a); assert.equal(R.adresseNette(a), net, `la page : ${a}`);
    assert.equal(adresseNette(net), net, 'relue, elle rend la même');
  }
  assert.equal(R.ADRESSE_MAX, ADRESSE_MAX, 'la même longueur des deux côtés');
  const debut = 'https://example.org/';
  assert.equal(adresseNette(debut + 'a'.repeat(ADRESSE_MAX - debut.length))!.length, ADRESSE_MAX, 'juste à la borne : gardée');
  assert.equal(adresseNette(debut + 'a'.repeat(ADRESSE_MAX - debut.length + 1)), undefined, 'un signe de plus : refusée');
  // Sans moyen de lire l'adresse (pas de URL dans la page) : refusée, jamais ouverte telle quelle.
  const sansUrl: Record<string, unknown> = {}; vm.runInNewContext(RENDU, { window: sansUrl });
  assert.equal((sansUrl.OdinWidgetsRendu as Rendu).adresseNette('https://example.org'), undefined);
});

const W = (o: Record<string, unknown>) => ({ id: 'a1b2c3d4', kind: 'chiffres', w: 1, module: 'midgard', ...o });
const net = (o: Record<string, unknown>) => cleanLayout({ pages: [{ id: 'b0000001', name: 'P', widgets: [W(o)] }] }, IDS).pages[0].widgets[0];

test('cleanLayout : « Quand je touche le widget », cinq choix, tout le reste est jeté', () => {
  assert.equal('toucher' in net({}), false, 'rien d\'écrit : ouvrir l\'appli, et rien n\'est ajouté');
  assert.deepEqual(net({ toucher: { quoi: 'rien', piege: 1 } }).toucher, { quoi: 'rien' });
  for (const e of ECRANS_TOUCHER) assert.deepEqual(net({ toucher: { quoi: 'ecran', ecran: e } }).toucher, { quoi: 'ecran', ecran: e });
  assert.equal(net({ toucher: { quoi: 'ecran', ecran: 'reglages' } }).toucher, undefined, 'un écran inconnu : jeté');
  assert.deepEqual(net({ toucher: { quoi: 'adresse', adresse: ' https://Example.org ' } }).toucher, { quoi: 'adresse', adresse: 'https://example.org/' });
  for (const a of REFUSEES) assert.equal(net({ toucher: { quoi: 'adresse', adresse: a } }).toucher, undefined, `adresse jetée : ${JSON.stringify(a)?.slice(0, 50)}`);
  // Une action : celle de l'appli du widget, son identifiant et ses réglages nettoyés.
  assert.deepEqual(net({ toucher: { quoi: 'action', action: 'commander', input: { appareil: 'Salon', valeur: 'on', 'pas bon': 'x' }, module: 'var' } }).toucher, { quoi: 'action', action: 'commander', input: { appareil: 'Salon', valeur: 'on' } });
  assert.deepEqual(net({ toucher: { quoi: 'action', action: 'scene' } }).toucher, { quoi: 'action', action: 'scene' }, 'sans réglage : rien d\'écrit');
  assert.equal(net({ toucher: { quoi: 'action', action: 'pas une action' } }).toucher, undefined, 'un identifiant d\'action mal écrit : jeté');
  assert.equal(net({ toucher: { quoi: 'action', action: '' } }).toucher, undefined);
  // Jamais pour un widget sans appli choisie (l'heure, la météo), ni pour le bouton sur mesure (il lance déjà la sienne).
  for (const kind of ['heure', 'meteo']) assert.equal(net({ kind, module: undefined, toucher: { quoi: 'action', action: 'theme' } }).toucher, undefined, kind);
  assert.equal(net({ kind: 'bouton', action: 'scene', label: 'Soir', toucher: { quoi: 'action', action: 'commander' } }).toucher, undefined, 'le bouton sur mesure');
  assert.deepEqual(net({ kind: 'bouton', action: 'scene', label: 'Soir', toucher: { quoi: 'adresse', adresse: 'https://example.org/' } }).toucher, { quoi: 'adresse', adresse: 'https://example.org/' });
  for (const t of [null, 'action', 7, [], { quoi: 'inconnu' }, { quoi: 'appli' }, {}]) assert.equal(net({ toucher: t }).toucher, undefined, JSON.stringify(t));
  // Ce que la page en lit, sans confiance : la même chose.
  assert.deepEqual({ ...R.toucherDe(net({})) }, { quoi: 'appli', appli: 'midgard' });
  assert.deepEqual({ ...R.toucherDe({ kind: 'heure' }) }, { quoi: 'rien' });
  assert.deepEqual({ ...R.toucherDe({ kind: 'chiffres', module: 'midgard', toucher: { quoi: 'adresse', adresse: 'javascript:alert(1)' } }) }, { quoi: 'appli', appli: 'midgard' }, 'une adresse abîmée n\'est jamais ouverte');
  assert.equal(R.toucherDe({ kind: 'bouton', module: 'midgard', action: 'scene', toucher: { quoi: 'action', action: 'commander' } }).quoi, 'appli');
  assert.deepEqual([...R.ECRANS_TOUCHER], [...ECRANS_TOUCHER], 'les mêmes écrans des deux côtés');
  for (const e of ECRANS_TOUCHER) assert.ok(R.TEXTES.reglage.ecrans[e], `l'écran ${e} a son nom`);
});

test('une fenêtre déjà rangée se relit identique (avec ou sans « Quand je touche »)', () => {
  const ancienne = { pages: [{ id: 'b0000001', name: 'Maison', maison: true, widgets: [
    { id: 'a0000001', kind: 'heure', w: 1 }, { id: 'a0000002', kind: 'chiffres', w: 2, module: 'midgard', label: 'Maison' },
    { id: 'a0000003', kind: 'section', w: 1, module: 'vordr', section: 'Sondes' }, { id: 'a0000004', kind: 'bouton', w: 1, module: 'midgard', action: 'scene', label: 'Soir', input: { scene: 'Soir' } },
  ] }] };
  const une = cleanLayout(ancienne, IDS), deux = cleanLayout(JSON.parse(JSON.stringify(une)), IDS);
  assert.deepEqual(deux, une);
  assert.ok(!JSON.stringify(une).includes('toucher'), 'une ancienne fenêtre ne gagne aucun réglage');
  const neuve = cleanLayout({ pages: [{ id: 'b0000001', name: 'P', widgets: [W({ toucher: { quoi: 'adresse', adresse: 'HTTPS://Example.org/été' } }), W({ id: 'a1b2c3d5', toucher: { quoi: 'action', action: 'commander', input: { appareil: 'Salon' } } })] }] }, IDS);
  assert.deepEqual(cleanLayout(JSON.parse(JSON.stringify(neuve)), IDS), neuve, 'avec ses réglages aussi');
});

test('« Copier vers l\'autre écran » : refusé pour les quatre sortes réservées et pour la vie privée non ouverte', () => {
  const reservees = SORTES.filter((s) => (s as { accueilSeul?: boolean }).accueilSeul).map((s) => s.id);
  assert.deepEqual([...R.RESERVEES].sort(), [...reservees].sort(), 'la page et le serveur nomment les mêmes quatre sortes');
  assert.equal(reservees.length, 4);
  for (const k of reservees) {
    assert.equal(copiable(k), false, `${k} : le serveur ne la dit pas copiable`);
    for (const o of [{ privee: false }, { privee: true, ouvert: true }, {}]) assert.equal(R.copieRefusee({ kind: k, ...o }), 'reservee', `${k} : jamais copiée`);
  }
  assert.equal(R.copieRefusee({ kind: 'a_faire', privee: false }), 'reservee', '« Copier » refusé pour « À faire »');
  assert.equal(R.copieRefusee({ kind: 'chiffres', privee: false }), '', 'un widget ordinaire se copie');
  assert.equal(R.copieRefusee({ kind: 'chiffres', privee: true, ouvert: false }), 'vie_privee', 'vie privée, ouvert à personne : refusé');
  assert.equal(R.copieRefusee({ kind: 'chiffres', privee: true }), 'vie_privee', 'vie privée, ouverture non vérifiée : refusé');
  assert.equal(R.copieRefusee({ kind: 'chiffres' }), 'vie_privee', 'rien de vérifié : refusé');
  assert.equal(R.copieRefusee({ kind: 'chiffres', privee: true, ouvert: true }), '', 'vie privée ouverte à quelqu\'un : permis');
  assert.equal(R.copieRefusee({}), 'reservee'); assert.equal(R.copieRefusee(), 'reservee', 'sans sorte : refusé');
  // La page s'en sert pour le bouton, et dit pourquoi.
  assert.match(FE, /const refus = R\.copieRefusee\(\{ kind: w\.kind, privee: ouv\.privee, ouvert: ouv\.connu && ouv\.noms\.length > 0 \}\);\s*if \(refus\) \{[^}]*return; \}/, 'un refus arrête la copie');
  // La copie prend un nouvel identifiant : elle n'hérite d'aucune ouverture (elle reste fermée aux autres).
  assert.match(FE, /cible\.widgets\.push\(\{ \.\.\.JSON\.parse\(JSON\.stringify\(w\)\), id: G\.nouvelId\(/);
});

test('« À faire » se déplace mais ne se retire pas : ni « Retirer », ni « ✕ », et le serveur refuse le rangement', () => {
  const fixes = SORTES.filter((s) => (s as { fixe?: boolean }).fixe).map((s) => s.id);
  assert.deepEqual(fixes, ['a_faire']); assert.deepEqual([...R.FIXES], fixes, 'la page et le serveur : la même liste');
  assert.equal(R.retirable('a_faire'), false); for (const k of ['chiffres', 'section', 'meteo', 'heure', 'site', 'bouton', 'odin_a_fait']) assert.equal(R.retirable(k), true, k);
  assert.match(FE, /const retirer = R\.retirable\(w\.kind\) \? R\.bouton\(T\.retirer,/, 'pas de « Retirer » dans « Régler »');
  assert.match(FE, /R\.retirable\(w\.kind\) \? el\('button', \{ type: 'button', title: 'Retirer'/, 'pas de « ✕ » sur sa carte');
  // Le serveur : une fenêtre rangée qui portait « À faire » ne peut pas être rangée sans lui ; il peut changer de page.
  const p = (id: string, kinds: string[]): FPage => ({ id, name: id, widgets: kinds.map((kind, i) => ({ id: `${id.slice(0, 7)}${i}`, kind, w: 1, c: 4, r: 3 }) as unknown as Widget) });
  const avant: Layout = { pages: [p('b0000001', ['heure', 'a_faire']), p('b0000002', ['meteo'])] };
  assert.equal(retraitRefuse(avant, { pages: [p('b0000001', ['heure']), p('b0000002', ['meteo'])] }), 'a_faire', 'retiré : refusé');
  assert.equal(retraitRefuse(avant, { pages: [p('b0000002', ['meteo'])] }), 'a_faire', 'sa page supprimée : refusé');
  assert.equal(retraitRefuse(avant, { pages: [p('b0000001', ['heure']), p('b0000002', ['meteo', 'a_faire'])] }), undefined, 'déplacé sur une autre page : permis');
  assert.equal(retraitRefuse(avant, avant), undefined);
  assert.equal(retraitRefuse(undefined, { pages: [p('b0000001', ['heure'])] }), undefined, 'aucune fenêtre avant : rien à garder');
  assert.equal(retraitRefuse({ pages: [p('b0000001', ['heure', 'odin_a_fait'])] }, { pages: [p('b0000001', ['heure'])] }), undefined, 'les autres sortes se retirent');
  // Lot 26 : la règle vaut pour une fenêtre RANGÉE qui portait « À faire » ; une fenêtre qui ne l'a jamais porté le reçoit à la lecture (test/accueil-aujourdhui.test.ts).
  assert.match(lire('src/valhalla/modules/gladsheim.ts'), /if \(retraitRefuse\(avant, l\)\) throw new Error\(/, 'ranger la fenêtre applique la règle');
});

test('la page : les styles d\'une sorte comme le serveur ; « Régler » remplace l\'ancien réglage de « ⋯ »', () => {
  // Par sorte, ses styles quand elle en a plus d'un : la page n'offre « Style » que pour celles-là.
  const attendu = Object.fromEntries(SORTES.filter((s) => s.styles.length > 1).map((s) => [s.id, [...s.styles]]));
  assert.deepEqual(Object.fromEntries(Object.entries(R.STYLES).map(([k, v]) => [k, (v as Array<[string, string]>).map((x) => x[0])])), attendu);
  const i = FE.indexOf('  async function regler('), regler = FE.slice(i, FE.indexOf('\n  }\n', i));
  assert.match(regler, /if \(!proprio \|\| ferme\(w\)\) return;/, 'le propriétaire seul, et jamais un widget fermé');
  assert.match(regler, /await reglerWidget\(w\);/);
  // Les cinq choix de la maquette, dans son ordre.
  assert.deepEqual(Object.keys(R.TEXTES.reglage.choix), ['appli', 'action', 'ecran', 'adresse', 'rien']);
  // Une adresse s'ouvre dans un nouvel onglet, sans donner la main à la page ouverte.
  assert.match(FE, /el\('a', \{ class: 'fe-open', href: t\.adresse, target: '_blank', rel: 'noopener noreferrer'/);
  assert.match(FE, /window\.open\(t\.adresse, '_blank', 'noopener,noreferrer'\)/);
  // Une action au toucher : le chemin de toutes les actions, l'accord demandé si elle est grave, à chaque fois.
  const j = FE.indexOf('  async function toucher('), toucher = FE.slice(j, FE.indexOf('\n  }\n', j));
  assert.match(toucher, /let r = await act\(t\.appli, t\.action, t\.input\);\s*if \(r\.confirm\) r = \(await window\.OdinDialog\.confirm\(r\.confirm, \{ danger: true \}\)\) \? await act\(t\.appli, t\.action, t\.input, true\)/);
  assert.doesNotMatch(toucher, /regler_fenetre|localStorage/, 'aucun accord n\'est retenu');
  assert.equal(FE.split('\'regler_fenetre\'').length - 1, 1, '« Régler » ne range rien lui-même : « Terminé » seul');
});

// ------------------------------------------------------------------ un vrai Odin d'essai
const MDP = 'un-sentier-de-sable-sous-les-pins-31';
const cookieDe = (r: Response, nom: string) => r.headers.getSetCookie().find((c) => c.startsWith(`${nom}=`))?.split(';')[0] ?? '';
async function entrer(v: VraiOdin, ident: string, mdp: string): Promise<string> {
  let r = await fetch(`${v.url}/sso/odin`, { redirect: 'manual' }); assert.equal(r.status, 303);
  r = await fetch(new URL(r.headers.get('location')!, v.url), { redirect: 'manual' }); const html = await r.text(), demande = /name="demande" value="([^"]+)"/.exec(html)![1];
  r = await fetch(`${v.url}/sso/autoriser`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded', origin: v.url }, body: new URLSearchParams({ demande, identifiant: ident, motdepasse: mdp }) });
  r = await fetch(r.headers.get('location')!, { redirect: 'manual' }); assert.equal(r.status, 303, 'session ouverte');
  return cookieDe(r, 'odin_session');
}

const tt = new Banc(), orig = { log: console.log, error: console.error, warn: console.warn };
let v: VraiOdin, membre = '', cleMaison = '', cleComplet = '', idMembre = '';
const ID = { midgard: 'a0000001', persona: 'a0000002', cyclope: 'a0000003', heure: 'a0000004', bouton: 'a0000005', accueil: 'a0000006' };
const MARQUE = 'MARQUE-TOUCHER-25B';
const FENETRE = () => ({ pages: [
  { id: 'b0000001', name: 'Maison', maison: true, widgets: [
    // Servi à une tablette « maison » (chiffres d'une appli de la famille Maison), avec une action au toucher.
    { id: ID.midgard, kind: 'chiffres', w: 1, module: 'midgard', toucher: { quoi: 'action', action: 'commander', input: { appareil: MARQUE, valeur: 'on' } } },
    // Une action GRAVE au toucher (retirer le compte de quelqu'un).
    { id: ID.persona, kind: 'chiffres', w: 1, module: 'var', toucher: { quoi: 'action', action: 'retirer', input: { login: 'cible-c' } } },
    { id: ID.heure, kind: 'heure', w: 1, toucher: { quoi: 'adresse', adresse: `https://example.org/${MARQUE}` } },
    { id: ID.bouton, kind: 'bouton', w: 1, module: 'gladsheim', action: 'theme', label: 'Thème', input: { theme: 'verre' } },
  ] },
  { id: 'b0000002', name: 'Accueil', widgets: [
    { id: ID.cyclope, kind: 'chiffres', w: 1, module: 'himinbjorg', label: 'Caméras' },
    { id: ID.accueil, kind: 'chiffres', w: 1, module: 'midgard' },
  ] },
] });
/**
 * Lot 26 : une fenêtre rangée porte « À faire » (il ne se retire plus). Ici, la page « Aujourd'hui » est rangée EN DERNIER,
 * avec « À faire » seul : les pages de l'essai gardent leur place (la première, la deuxième).
 */
const AUJOURDHUI = () => ({ id: '0a0f0000', name: '', code: 'aujourdhui', widgets: [{ id: '0a0f0002', kind: 'a_faire', w: 2, c: 6, r: 4 }] });
const ranger = (f: { pages: unknown[] }) => valhallaOf()!.act('gladsheim', 'regler_fenetre', { fenetre: JSON.stringify({ ...f, pages: [...f.pages.filter((p) => (p as { code?: string }).code !== 'aujourdhui'), AUJOURDHUI()] }) });
const rangee = async () => (await valhallaOf()!.act('gladsheim', 'fenetre', {})).data as Layout;
const widgetDe = (l: Layout, id: string) => l.pages.flatMap((p) => p.widgets).find((w) => w.id === id)!;

before(async () => {
  for (const k of ['log', 'error', 'warn'] as const) console[k] = () => {};
  v = await vraiOdin(tt, { compte: true, modules: (o) => allModules(o).filter((m) => IDS.includes(m.id)) });
  const va = valhallaOf()!;
  assert.equal((await va.act('var', 'ajouter', { login: 'membre-a', nom: 'Membre A', groupes: 'invite', mot_de_passe: MDP })).ok, true);
  for (const appli of ['odin', 'gladsheim', 'himinbjorg', 'midgard']) assert.equal((await va.act('var', 'donner_acces', { appli, qui: '@membre-a' })).ok, true);
  assert.equal((await va.act('var', 'ajouter', { login: 'cible-c', nom: 'Cible C', groupes: 'invite', mot_de_passe: MDP })).ok, true);
  lierProprietaire(persona()!);
  idMembre = personnes(persona()!).find((p) => p.login === 'membre-a')!.id;
  membre = await entrer(v, 'membre-a', MDP); assert.ok(membre, 'le membre a une session');
  const f = await ranger(FENETRE()); assert.equal(f.ok, true, f.text);
  cleMaison = ((await va.act('gladsheim', 'cle_tablette', { nom: 'Tablette maison', droits: 'maison' })).data as { key: string }).key;
  cleComplet = ((await va.act('gladsheim', 'cle_tablette', { nom: 'Tablette complet', droits: 'complet' })).data as { key: string }).key;
  assert.ok(cleMaison && cleComplet, 'clés de tablette créées');
});
after(async () => { await tt.end(); Object.assign(console, orig); });
const cibleLa = () => personnes(persona()!).some((p) => p.login === 'cible-c');

test('ranger la fenêtre : une adresse autre que http ou https est refusée, et rien n\'est rangé', async () => {
  const avant = JSON.stringify(await rangee());
  for (const a of ['javascript:alert(1)', 'data:text/html,x', 'file:///etc/passwd', 'https://nom:motdepasse@example.org/', 'example.org', `https://example.org/${'a'.repeat(ADRESSE_MAX)}`]) {
    const f = FENETRE(); (f.pages[0].widgets[2] as Record<string, unknown>).toucher = { quoi: 'adresse', adresse: a };
    const r = await v.json('/api/valhalla/act', { module: 'gladsheim', action: 'regler_fenetre', input: { fenetre: JSON.stringify(f) } });
    assert.equal(r.body.ok, false, `${a.slice(0, 40)} : refusée`); assert.match(String(r.body.text ?? r.body.error), /adresse refusée/);
    assert.match(String(r.body.text ?? r.body.error), /http:\/\/ ou https:\/\//, 'le refus dit quoi écrire');
    assert.equal(JSON.stringify(await rangee()), avant, 'la fenêtre rangée n\'a pas changé');
  }
  assert.deepEqual(adressesRefusees({ pages: [{ widgets: [{ toucher: { quoi: 'adresse', adresse: 'javascript:alert(1)\n' } }, { toucher: { quoi: 'adresse', adresse: 'https://example.org' } }, { toucher: { quoi: 'rien' } }] }] }), ['javascript:alert(1)']);
  for (const x of [null, 3, {}, { pages: 'x' }, { pages: [null, { widgets: [null, 4, { toucher: 'x' }] }] }]) assert.deepEqual(adressesRefusees(x), []);
  // Une adresse http ou https est gardée, nettoyée ; relue, la fenêtre est la même.
  const l = await rangee();
  assert.deepEqual(widgetDe(l, ID.heure).toucher, { quoi: 'adresse', adresse: `https://example.org/${MARQUE}` });
  assert.deepEqual(cleanLayout(JSON.parse(JSON.stringify(l)), IDS), JSON.parse(JSON.stringify({ pages: l.pages, accueil: l.accueil })), 'se relit identique (avec la marque de ce que la fenêtre a reçu, lot 27)');
  assert.deepEqual(JSON.parse(JSON.stringify(await rangee())), JSON.parse(JSON.stringify(l)));
});

test('une action grave au toucher : Odin demande l\'accord à chaque fois, rien ne part sans lui', async () => {
  const t = widgetDe(await rangee(), ID.persona).toucher as { quoi: string; action: string; input: Record<string, string> };
  assert.deepEqual(t, { quoi: 'action', action: 'retirer', input: { login: 'cible-c' } });
  // Ce que la page envoie quand on touche le widget : l'action de l'appli du widget, sans accord.
  for (let i = 0; i < 2; i++) {
    const r = await v.json('/api/valhalla/act', { module: 'var', action: t.action, input: t.input });
    assert.ok(typeof r.body.confirm === 'string' && r.body.confirm.length > 0, `l'accord est demandé (fois ${i + 1}) : ${JSON.stringify(r.body).slice(0, 120)}`);
    assert.equal(cibleLa(), true, 'rien n\'est parti');
  }
});

test('un membre ne lance au toucher que ce que son droit d\'appli permet', async () => {
  // Il n'a pas le droit sur Persona : l'action du widget lui est refusée par la garde, grave ou non.
  const r = await v.json('/api/valhalla/act', { module: 'var', action: 'retirer', input: { login: 'cible-c' }, confirm: true }, { cookie: membre });
  assert.equal(r.status, 403, JSON.stringify(r.body).slice(0, 160)); assert.equal(r.body.ok, false); assert.equal(cibleLa(), true);
  // Il a le droit sur Hestia : il lit la fenêtre, mais ne la range pas (« Régler » est au propriétaire seul).
  const f = FENETRE(); (f.pages[1].widgets[1] as Record<string, unknown>).toucher = { quoi: 'adresse', adresse: 'https://piege.example.org/' };
  const g = await v.json('/api/valhalla/act', { module: 'gladsheim', action: 'regler_fenetre', input: { fenetre: JSON.stringify(f) } }, { cookie: membre });
  assert.equal(g.body.ok, false, 'un membre ne règle pas un widget');
  assert.equal(widgetDe(await rangee(), ID.accueil).toucher, undefined);
});

test('tablette « maison » : l\'action au toucher n\'est jamais servie, ni lancée', async () => {
  const va = valhallaOf()!;
  for (const [nom, h] of [['clé « maison »', { cookie: '', 'x-odin-maison': cleMaison }], ['clé « complet »', { cookie: '', 'x-odin-maison': cleComplet }], ['ta session', {}]] as Array<[string, Record<string, string>]>) {
    const r = await v.json('/api/maison/etat', undefined, h);
    assert.equal(r.status, 200, nom);
    const texte = JSON.stringify(r.body), ws = ((r.body.fenetre as Array<{ widgets: Array<Record<string, unknown>> }>) ?? []).flatMap((p) => p.widgets);
    assert.ok(!texte.includes(MARQUE), `${nom} : ni l'action au toucher, ni ses réglages, ni l'adresse ne sont servis`);
    assert.ok(!texte.includes('"toucher"'), `${nom} : aucun réglage « Quand je touche »`);
    for (const w of ws) assert.equal('toucher' in w, false);
    if (nom === 'clé « maison »') {
      assert.equal(r.body.rights, 'maison');
      assert.ok(ws.some((w) => w.id === ID.midgard), 'contrôle : le widget de Midgard est bien servi à la tablette (sans son action)');
      assert.ok(!ws.some((w) => w.id === ID.persona), 'le widget de Persona n\'est pas servi à une tablette');
    }
  }
  // Lancer : /api/maison/fenetre ne lance que le bouton sur mesure servi à qui demande. Un widget qui porte une action
  // au toucher n'est pas un bouton : introuvable, pour une tablette « maison » comme pour une clé « complet ».
  const pages = (await rangee()).pages;
  for (const cle of [cleMaison, cleComplet]) for (const id of [ID.midgard, ID.persona, ID.heure]) {
    const r = await v.json('/api/maison/fenetre', { id, confirm: true }, { cookie: '', 'x-odin-maison': cle });
    assert.equal(r.status, 404, `${id} : ${JSON.stringify(r.body)}`); assert.equal(r.body.ok, false);
  }
  for (const full of [false, true]) for (const id of [ID.midgard, ID.persona, ID.heure]) assert.equal(await boutonMaison(va, pages, id, full), undefined, `${id} : jamais trouvé comme un bouton`);
  assert.equal((await boutonMaison(va, pages, ID.bouton, false))?.id, ID.bouton, 'contrôle : un vrai bouton sans action grave reste lançable');
  assert.equal(cibleLa(), true, 'le compte visé par l\'action grave existe encore');
  // Une tablette ne passe pas non plus par le chemin des actions d'Odin avec sa clé.
  const direct = await fetch(`${v.url}/api/valhalla/act`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-odin': '1', 'x-odin-maison': cleMaison }, body: JSON.stringify({ module: 'var', action: 'retirer', input: { login: 'cible-c' }, confirm: true }) });
  assert.ok(direct.status === 401 || direct.status === 403, `clé de tablette refusée sur /api/valhalla/act (${direct.status})`);
  assert.equal(cibleLa(), true);
  // Et l'écran de la maison ne rend d'un widget que les champs qu'il nomme : « toucher » n'en est pas.
  const api = lire('src/web/maison-api.ts');
  assert.ok(!api.includes('toucher'), 'maison-api.ts ne lit jamais « toucher »');
  assert.match(lire('src/web/widgets-api.ts'), /find\(\(x\) => x\.id === id && x\.kind === 'bouton'\)/, 'boutonMaison ne lance que la sorte « bouton »');
});

test('changer « Quand je touche » d\'un widget ouvert à quelqu\'un le referme ; son titre seul peut changer', async () => {
  const va = valhallaOf()!, g = () => va.ctx('gladsheim');
  const ouvrir = async () => { assert.equal((await va.act('gladsheim', 'ouvrir_widget', { widget: ID.cyclope, personne: 'membre-a', ouvert: 'oui' })).ok, true); assert.deepEqual(ouverturesDe(g(), idMembre), [`${ID.cyclope}@himinbjorg`]); };
  const avec = (o: Record<string, unknown>) => { const f = FENETRE(); Object.assign(f.pages[1].widgets[0], o); return f; };
  await ouvrir();
  assert.equal((await ranger(avec({ label: 'Les caméras du jardin', w: 2 }))).ok, true);
  assert.deepEqual(ouverturesDe(g(), idMembre), [`${ID.cyclope}@himinbjorg`], 'le titre et la taille changent : il reste ouvert');
  for (const toucher of [{ quoi: 'adresse', adresse: 'https://example.org/' }, { quoi: 'action', action: 'cameras' }, { quoi: 'ecran', ecran: 'maison' }, { quoi: 'rien' }]) {
    assert.equal((await ranger(avec({ toucher }))).ok, true);
    assert.deepEqual(ouverturesDe(g(), idMembre), [], `« Quand je touche » passe à ${toucher.quoi} : refermé pour lui`);
    await ouvrir();
    // Ouvert tel qu'il est maintenant : le ranger sans rien changer le laisse ouvert.
    assert.equal((await ranger(avec({ toucher }))).ok, true);
    assert.deepEqual(ouverturesDe(g(), idMembre), [`${ID.cyclope}@himinbjorg`], 'rangé à l\'identique : il reste ouvert');
    assert.equal((await ranger(avec({}))).ok, true);
    assert.deepEqual(ouverturesDe(g(), idMembre), [], 'le réglage retiré : refermé aussi');
    await ouvrir();
  }
  // La page le dit avant de valider, et ne laisse pas ouvrir un widget dont le réglage n'est pas encore rangé.
  assert.match(FE, /alerte\.textContent = !ouv\.privee \|\| sig\(lire\(\)\) === depart \? '' : !ouv\.connu \? T\.refermeInconnu : ouv\.noms\.length \? T\.referme\(/);
  assert.match(FE, /JSON\.stringify\(range\.toucher \?\? null\) !== JSON\.stringify\(w\.toucher \?\? null\)\) \{ say\(T\.dAbord\); return; \}/);
  assert.equal((await ranger(FENETRE())).ok, true);
});

// ------------------------------------------------------------------ relecture adverse (lot 25b)
const cp = (...n: number[]) => String.fromCodePoint(...n);
// Le nom d'exemple coupé en deux (pour y glisser un caractère), et l'adresse de la machine elle-même, écrite par morceaux.
const EX = 'example.org', DEB = EX.slice(0, 3), FIN = EX.slice(3), ICI = [127, 0, 0, 1].join('.');
test('relecture : les adresses piégées (majuscules, lettres trompeuses, sens d\'écriture, adresses écrites en chiffres) ; ce qui est gardé est en clair', () => {
  const refusees = [
    'JaVaScRiPt:alert(1)', 'javascript://example.org/%0Aalert(1)', 'http://javascript:alert(1)@example.org/', `https://%40${EX}/`, 'https://example.org%2F@piege.example.org/',
    `https://${DEB}${cp(0x202e)}${FIN}/`, `https://example.org${cp(0xff0f)}@piege.example.org/`, 'https://example.org:99999/', 'http://example.org:abc/', `http:${cp(0x5c, 0x5c)}example.org`, `https://example.org${cp(0x5c)}chemin`,
    `https://example.org/${cp(0x85)}`, `https://${DEB}${cp(0x9)}${FIN}/`, 'https://[::1', 'https://%/',
  ];
  for (const a of refusees) { assert.equal(adresseNette(a), undefined, `le serveur refuse ${JSON.stringify(a)}`); assert.equal(R.adresseNette(a), undefined, `la page refuse ${JSON.stringify(a)}`); }
  // Gardées, mais écrites comme le navigateur les lira : le vrai nom du site (jamais des lettres qui en imitent d'autres),
  // l'adresse en chiffres sous sa forme habituelle, et aucun caractère caché ni de sens d'écriture.
  const gardees: Array<[string, string]> = [
    [`https://${cp(0x430, 0x440, 0x440, 0x4cf, 0x435)}.example.org/`, 'https://xn--80ak6aa92e.example.org/'], [`https://${DEB}${cp(0x200b)}${FIN}/`, 'https://example.org/'], [`https://example.org${cp(0x3002)}piege.example.org/`, 'https://example.org.piege.example.org/'],
    [`https://example.org/${cp(0x202e)}gpj.exe`, 'https://example.org/%E2%80%AEgpj.exe'], ['http://0x7f.1/', `http://${ICI}/`], ['http://2130706433/', `http://${ICI}/`], ['https://@example.org/', 'https://example.org/'],
    ['https://example.org/?a=<script>', 'https://example.org/?a=%3Cscript%3E'], ['https://example.org/"x', 'https://example.org/%22x'],
  ];
  for (const [a, net] of gardees) {
    assert.equal(adresseNette(a), net, JSON.stringify(a)); assert.equal(R.adresseNette(a), net, `la page : ${JSON.stringify(a)}`);
    assert.equal(adresseNette(net), net, 'relue, la même'); assert.match(net, /^[\x21-\x7e]+$/, 'rien que des signes visibles');
  }
  // Le refus redit l'adresse sans caractère de commande ni de sens d'écriture.
  const dit = adressesRefusees({ pages: [{ widgets: [{ toucher: { quoi: 'adresse', adresse: `java${cp(0x202e)}script:alert(1)${cp(0x200f, 0x2066)}` } }] }] });
  assert.deepEqual(dit, ['java script:alert(1)']);
});

test('relecture : une fenêtre rangée se relit au signe près ; un champ inconnu ne passe jamais', () => {
  const l = cleanLayout({ pages: [{ id: 'b0000001', name: 'P', maison: true, piege: 1, widgets: [
    W({ toucher: { quoi: 'action', action: 'commander', input: { appareil: 'Salon', valeur: 'on' }, module: 'var', confirm: true }, confirm: true, grave: false }),
    W({ id: 'a1b2c3d5', label: 'Lien', toucher: { quoi: 'adresse', adresse: 'https://example.org/a?b=1#c', target: '_self', opener: true } }),
    W({ id: 'a1b2c3d6', toucher: { quoi: 'ecran', ecran: 'maison', hash: '#app=var' } }), { id: 'a1b2c3d7', kind: 'heure', w: 1, toucher: { quoi: 'rien' } },
  ] }] }, IDS);
  const texte = JSON.stringify(l);
  assert.equal(JSON.stringify(cleanLayout(JSON.parse(texte), IDS)), texte, 'au signe près');
  for (const mot of ['piege', 'confirm', 'grave', 'target', 'opener', 'hash', '"var"']) assert.ok(!texte.includes(mot), `${mot} n'est pas gardé`);
  assert.deepEqual(l.pages[0].widgets.map((w) => Object.keys(w.toucher ?? {}).join()), ['quoi,action,input', 'quoi,adresse', 'quoi,ecran', 'quoi']);
});

test('relecture : un membre ne reçoit « Quand je touche » que d\'un widget qu\'il peut voir, et jamais une action grave ou « propriétaire seul »', async () => {
  const va = valhallaOf()!, SECRET = 'JETON-25B-SECRET';
  const f = FENETRE();
  // Cyclope (vie privée, fermé au membre) avec une adresse qui porte un jeton ; Persona (aucun droit) avec une action et ses réglages.
  Object.assign(f.pages[1].widgets[0], { toucher: { quoi: 'adresse', adresse: `https://example.org/prive?jeton=${SECRET}` } });
  f.pages[1].widgets.push(...[
    { id: 'a0000011', kind: 'chiffres', w: 1, module: 'var', toucher: { quoi: 'action', action: 'retirer', input: { login: 'cible-c' } } },
    { id: 'a0000012', kind: 'chiffres', w: 1, module: 'gladsheim', toucher: { quoi: 'action', action: 'theme', input: { theme: 'braise' } } },
    { id: 'a0000013', kind: 'chiffres', w: 1, module: 'gladsheim', toucher: { quoi: 'action', action: 'regler_animation', input: { animation: 'glace' } } },
    { id: 'a0000014', kind: 'chiffres', w: 1, module: 'gladsheim', toucher: { quoi: 'action', action: 'membre', input: { nom: 'Zed' } } },
    { id: 'a0000015', kind: 'chiffres', w: 1, module: 'midgard', toucher: { quoi: 'adresse', adresse: 'https://example.org/pour-tous' } },
    { id: 'a0000016', kind: 'chiffres', w: 1, module: 'gladsheim', toucher: { quoi: 'action', action: 'action_disparue' } },
  ] as never[]);
  assert.equal((await ranger(f)).ok, true);
  try {
    const lue = async (cookie?: string) => { const r = await v.json('/api/valhalla/act', { module: 'gladsheim', action: 'fenetre', input: {} }, cookie ? { cookie } : {}); assert.equal(r.body.ok, true); return { texte: JSON.stringify(r.body), l: r.body.data as Layout, t: (id: string) => widgetDe(r.body.data as Layout, id).toucher as Record<string, unknown> | undefined }; };
    // Le propriétaire lit tout, comme avant.
    const moi = await lue();
    assert.ok(moi.texte.includes(SECRET) && moi.texte.includes('cible-c')); assert.equal(moi.t('a0000014')?.action, 'membre');
    // Le membre : rien d'un widget fermé à lui.
    let lui = await lue(membre);
    assert.ok(!lui.texte.includes(SECRET), 'vie privée fermée : l\'adresse (et son jeton) n\'est pas servie');
    assert.ok(!lui.texte.includes('cible-c'), 'appli sans droit : ni l\'action ni ses réglages ne sont servis');
    assert.equal(lui.t(ID.cyclope), undefined); assert.equal(lui.t('a0000011'), undefined);
    assert.equal(widgetDe(lui.l, ID.cyclope).label, 'Caméras', 'le widget reste à sa place, sans son réglage');
    // Ce qu'il peut voir garde son réglage ; une action grave ou « propriétaire seul » ne lui est jamais servie (comme le bouton sur mesure).
    assert.deepEqual(lui.t('a0000012'), { quoi: 'action', action: 'theme', input: { theme: 'braise' } });
    assert.deepEqual(lui.t('a0000015'), { quoi: 'adresse', adresse: 'https://example.org/pour-tous' });
    assert.equal(lui.t('a0000013'), undefined, '« propriétaire seul »'); assert.equal(lui.t('a0000014'), undefined, 'action grave'); assert.equal(lui.t('a0000016'), undefined, 'action inconnue');
    // Ouvert à lui par le propriétaire : il le reçoit ; refermé : plus rien.
    assert.equal((await va.act('gladsheim', 'ouvrir_widget', { widget: ID.cyclope, personne: 'membre-a', ouvert: 'oui' })).ok, true);
    lui = await lue(membre); assert.equal(lui.t(ID.cyclope)?.quoi, 'adresse'); assert.ok(lui.texte.includes(SECRET));
    assert.equal((await va.act('gladsheim', 'ouvrir_widget', { widget: ID.cyclope, personne: 'membre-a', ouvert: 'non' })).ok, true);
    assert.ok(!(await lue(membre)).texte.includes(SECRET));
    // La fenêtre gardée n'a pas changé : seul ce qui est servi au membre est réduit.
    assert.equal(widgetDe(await rangee(), 'a0000011').toucher?.quoi, 'action');
  } finally { assert.equal((await ranger(FENETRE())).ok, true); }
});

test('relecture : l\'écran de la maison ne sert ni un widget de la vie privée à une tablette, ni une sorte réservée à personne ; les seuls réglages d\'une action changés referment', async () => {
  const va = valhallaOf()!, g = () => va.ctx('gladsheim');
  // Posé à la main sur la page « écran de la maison » (sans passer par « Copier ») : Cyclope, avec une adresse au toucher.
  const f = FENETRE(); f.pages[0].widgets.push(...[{ id: 'a0000021', kind: 'chiffres', w: 1, module: 'himinbjorg', label: 'Caméras copiées', toucher: { quoi: 'adresse', adresse: `https://example.org/${MARQUE}` } },
    { id: 'a0000022', kind: 'a_faire', w: 1 }, { id: 'a0000023', kind: 'odin_a_fait', w: 1 }] as never[]);
  assert.equal((await ranger(f)).ok, true);
  try {
    const servis = async (h: Record<string, string>) => { const r = await v.json('/api/maison/etat', undefined, h); assert.equal(r.status, 200); return { ids: ((r.body.fenetre as Array<{ widgets: Array<{ id: string }> }>) ?? []).flatMap((p) => p.widgets.map((w) => w.id)), texte: JSON.stringify(r.body) }; };
    const tablette = await servis({ cookie: '', 'x-odin-maison': cleMaison }), complet = await servis({ cookie: '', 'x-odin-maison': cleComplet }), moi = await servis({});
    assert.ok(!tablette.ids.includes('a0000021'), 'vie privée : jamais à une tablette « maison »');
    assert.ok(moi.ids.includes('a0000021') && complet.ids.includes('a0000021'), 'ta session et une clé « complet » le voient (sans son réglage)');
    for (const x of [tablette, complet, moi]) { assert.ok(!x.texte.includes(MARQUE) && !x.texte.includes('"toucher"')); assert.ok(!x.ids.includes('a0000022') && !x.ids.includes('a0000023'), 'une sorte réservée n\'y est servie à personne'); }
    // Une copie posée à la main n'hérite d'aucune ouverture : elle porte un autre identifiant.
    assert.equal((await va.act('gladsheim', 'ouvrir_widget', { widget: ID.cyclope, personne: 'membre-a', ouvert: 'oui' })).ok, true);
    assert.deepEqual(ouverturesDe(g(), idMembre), [`${ID.cyclope}@himinbjorg`], 'l\'original seul est ouvert');
  } finally { assert.equal((await ranger(FENETRE())).ok, true); }
  // Les quatre sortes réservées : fermées sur l'écran de la maison, même pour le propriétaire (le jour où elles seront posables).
  for (const k of R.RESERVEES) for (const full of [false, true]) assert.equal(droitDeVoir({ id: 'a0000022', kind: k as never }, lecteurMaison(full), { appli: () => undefined })?.etat, 'refuse', `${k} (${full ? 'complet' : 'maison'})`);
  // Les seuls réglages de l'action changent (pas l'action) : le widget ouvert à quelqu'un est refermé aussi.
  const avec = (input: Record<string, string>) => { const x = FENETRE(); Object.assign(x.pages[1].widgets[0], { toucher: { quoi: 'action', action: 'cameras', input } }); return x; };
  assert.equal((await ranger(avec({ nom: 'Entrée' }))).ok, true);
  assert.equal((await va.act('gladsheim', 'ouvrir_widget', { widget: ID.cyclope, personne: 'membre-a', ouvert: 'oui' })).ok, true);
  assert.equal((await ranger(avec({ nom: 'Entrée' }))).ok, true); assert.deepEqual(ouverturesDe(g(), idMembre), [`${ID.cyclope}@himinbjorg`]);
  assert.equal((await ranger(avec({ nom: 'Jardin' }))).ok, true); assert.deepEqual(ouverturesDe(g(), idMembre), [], 'un réglage de l\'action changé : refermé');
  assert.equal((await ranger(FENETRE())).ok, true);
});
// ------------------------------------------------------------------ dans un vrai navigateur
/* eslint-disable @typescript-eslint/no-explicit-any */
declare const document: any, window: any;
interface Page {
  goto(u: string): Promise<unknown>; click(s: string): Promise<void>; tap(s: string): Promise<void>; waitForSelector(s: string, o?: Record<string, unknown>): Promise<unknown>;
  waitForFunction(f: string | ((a: any) => unknown), a?: unknown, o?: Record<string, unknown>): Promise<unknown>; evaluate<X>(f: string | (() => X)): Promise<X>;
  keyboard: { press(k: string): Promise<void>; type(t: string): Promise<void> }; waitForTimeout(ms: number): Promise<void>;
  selectOption(s: string, v: string): Promise<unknown>; fill(s: string, v: string): Promise<void>; on(e: string, f: (x: Error) => void): void;
}
interface Contexte { newPage(): Promise<Page>; addCookies(c: unknown[]): Promise<void>; addInitScript(f: () => void): Promise<void>; close(): Promise<void>; pages(): unknown[] }
interface Navigateur { newContext(o: Record<string, unknown>): Promise<Contexte>; close(): Promise<void> }
const pw = (() => { try { return createRequire(import.meta.url)('playwright') as { chromium: { launch(): Promise<Navigateur> } }; } catch { return undefined; } })();
const sans = pw ? false : 'Playwright n\'est pas installé sur cette machine';
let nav: Navigateur | undefined;
before(async () => { if (pw) nav = await pw.chromium.launch(); });
after(async () => { await nav?.close(); });

async function ouvrirPage(largeur: number) {
  const doigt = largeur < 500;
  const ctx = await nav!.newContext({ viewport: { width: largeur, height: doigt ? 800 : 860 }, hasTouch: doigt, isMobile: doigt, locale: 'fr-FR' });
  const [n, ...x] = v.session.split('='); await ctx.addCookies([{ name: n, value: x.join('='), url: v.url, httpOnly: true, sameSite: 'Strict' }]);
  await ctx.addInitScript(() => { try { localStorage.setItem('odin.tour', 'done'); localStorage.setItem('odin.fenetre.page', '1'); } catch { /* rien */ } });
  const page = await ctx.newPage(), erreurs: string[] = [];
  page.on('pageerror', (e) => erreurs.push(String(e)));
  await page.goto(v.url + '/');
  await page.waitForSelector('#app:not([hidden])', { timeout: 30000 });
  await page.waitForSelector('#feGrid .fe-w .wr-plus', { timeout: 30000 });
  return { ctx, page, erreurs };
}
const carte = (id: string) => `#feGrid .fe-w[data-id="${id}"]`;
const ouverte = (p: Page) => p.evaluate(() => Boolean(document.querySelector('dialog.wr-regler[open]')));

test('navigateur, 1280 px, au clavier : « ⋯ » ouvre « Régler », Échap ferme et rend le focus ; une adresse refusée, puis gardée', { skip: sans }, async () => {
  assert.equal((await ranger(FENETRE())).ok, true);
  const { ctx, page, erreurs } = await ouvrirPage(1280);
  try {
    await page.evaluate(`document.querySelector('${carte(ID.accueil)} .wr-plus').focus()`);
    await page.keyboard.press('Enter');
    await page.waitForSelector('dialog.wr-regler[open]', { timeout: 15000 });
    const d = await page.evaluate(() => { const x = document.querySelector('dialog.wr-regler'); return { titre: document.getElementById(x.getAttribute('aria-labelledby'))?.textContent, dedans: x.contains(document.activeElement), modal: x.matches(':modal'), choix: [...x.querySelectorAll('#wrRQ option')].map((o: any) => o.value), tailles: x.querySelectorAll('input[name=wrTaille]').length, retirer: [...x.querySelectorAll('button')].some((b: any) => b.textContent === 'Retirer'), copier: [...x.querySelectorAll('button')].map((b: any) => b.textContent).find((t: string) => t.startsWith('Copier')), style: Boolean(x.querySelector('input[name=wrStyle]')) }; });
    assert.equal(d.titre, 'Régler « Midgard »'); assert.equal(d.modal, true, 'une vraie fenêtre de dialogue : le clavier y reste'); assert.equal(d.dedans, true, 'le focus est dans la fenêtre');
    assert.deepEqual(d.choix, ['appli', 'action', 'ecran', 'adresse', 'rien'], 'les cinq choix de la maquette');
    assert.equal(d.tailles, 7, 'les sept tailles'); assert.equal(d.retirer, true); assert.equal(d.copier, 'Copier vers l\'écran de la maison');
    assert.equal(d.style, false, 'aucune sorte n\'a encore deux styles : pas de choix de style');
    assert.equal(await page.evaluate(() => Boolean(document.querySelector('#fenetre.fe-edit'))), true, '« Régler » se fait dans le mode Modifier');
    // Échap ferme, et le focus revient au « ⋯ » du même widget.
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('dialog.wr-regler'));
    assert.deepEqual(await page.evaluate(() => ({ plus: document.activeElement?.classList.contains('wr-plus'), id: document.activeElement?.closest('.fe-w')?.dataset.id })), { plus: true, id: ID.accueil }, 'le focus est rendu');
    // De nouveau, au clavier : une adresse qui n'est pas http ou https est refusée, la fenêtre reste ouverte.
    await page.keyboard.press('Enter'); await page.waitForSelector('dialog.wr-regler[open]');
    await page.selectOption('#wrRQ', 'adresse'); await page.fill('#wrRU', 'javascript:alert(1)');
    await page.keyboard.press('Enter');
    assert.equal(await ouverte(page), true, 'refusée : la fenêtre reste ouverte');
    assert.match(await page.evaluate(() => document.querySelector('dialog.wr-regler [role=alert]').textContent), /Adresse refusée/);
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'wrRU', 'le focus revient sur le champ');
    assert.equal(await page.evaluate(() => 'toucher' in window.OdinFenetre.state().L.pages[1].widgets[1]), false, 'rien n\'est changé');
    await page.fill('#wrRU', 'https://Example.org/page'); await page.fill('#wrRT', 'Ma maison');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => !document.querySelector('dialog.wr-regler'));
    await page.waitForSelector(`${carte(ID.accueil)} a.fe-open`);
    const lien = await page.evaluate(`(() => { const a = document.querySelector('${carte(ID.accueil)} a.fe-open'); return { href: a.href, target: a.target, rel: a.rel, nom: a.getAttribute('aria-label'), titre: a.closest('.fe-w').querySelector('.wr-n').textContent, focus: document.activeElement?.classList.contains('wr-plus') && document.activeElement.closest('.fe-w').dataset.id }; })()`) as Record<string, unknown>;
    assert.deepEqual(lien, { href: 'https://example.org/page', target: '_blank', rel: 'noopener noreferrer', nom: 'Ouvrir example.org dans un nouvel onglet', titre: 'Ma maison', focus: ID.accueil });
    // Rien n'est gardé avant « Terminé » ; après, le serveur garde l'adresse nettoyée.
    assert.equal(widgetDe(await rangee(), ID.accueil).toucher, undefined, 'pas encore rangé');
    await page.evaluate(() => [...document.querySelectorAll('#fenetre .fe-tools .btn')].find((b: any) => b.textContent === 'Terminé').click());
    await page.waitForFunction(() => !document.querySelector('#fenetre.fe-edit'), undefined, { timeout: 15000 });
    const w = widgetDe(await rangee(), ID.accueil);
    assert.deepEqual(w.toucher, { quoi: 'adresse', adresse: 'https://example.org/page' }); assert.equal(w.label, 'Ma maison');
    assert.deepEqual(erreurs, [], 'aucune erreur dans la page');
  } finally { await ctx.close(); }
});

test('navigateur : une action grave au toucher demande l\'accord ; refusé, rien ne part', { skip: sans }, async () => {
  const f = FENETRE(); f.pages[1].widgets.push({ id: 'a0000007', kind: 'chiffres', w: 1, module: 'var', toucher: { quoi: 'action', action: 'retirer', input: { login: 'cible-c' } } } as never);
  assert.equal((await ranger(f)).ok, true);
  const { ctx, page, erreurs } = await ouvrirPage(1280);
  try {
    const c = carte('a0000007');
    await page.waitForSelector(`${c} button.fe-open`);
    assert.equal(await page.evaluate(`document.querySelector('${c} button.fe-open').getAttribute('aria-label')`), 'Lancer « Retirer une personne » (Persona)');
    assert.equal(await page.evaluate(`document.querySelector('${c}').classList.contains('fe-touche')`), true);
    // Au clavier (le bouton de l'en-tête), puis en touchant la carte : l'accord est demandé à chaque fois.
    for (const geste of ['clavier', 'carte']) {
      if (geste === 'clavier') { await page.evaluate(`document.querySelector('${c} button.fe-open').focus()`); await page.keyboard.press('Enter'); }
      else await page.evaluate(`document.querySelector('${c} .wr-n').click()`);
      await page.waitForSelector('.odlg[role=alertdialog]', { timeout: 15000 });
      assert.match(await page.evaluate(() => document.querySelector('.odlg .odlg-t').textContent), /supprimer ce compte/, `${geste} : Odin dit ce qui partirait`);
      assert.equal(cibleLa(), true, 'rien n\'est parti avant l\'accord');
      await page.evaluate(() => document.querySelector('.odlg .odlg-btn.non').click());
      await page.waitForFunction(() => !document.querySelector('.odlg'));
      await page.waitForTimeout(300);
      assert.equal(cibleLa(), true, 'refusé : rien ne part');
    }
    // En mode Modifier, toucher la carte ne lance rien.
    await page.evaluate(() => window.OdinFenetre.edit(true)); await page.waitForSelector('#fenetre.fe-edit');
    await page.evaluate(`document.querySelector('${c} .wr-n').click()`); await page.waitForTimeout(400);
    assert.equal(await page.evaluate(() => Boolean(document.querySelector('.odlg'))), false);
    assert.deepEqual(erreurs, [], 'aucune erreur dans la page');
  } finally { await ctx.close(); assert.equal((await ranger(FENETRE())).ok, true); }
});

test('navigateur, 390 px, au doigt : « Régler » tient dans l\'écran ; « À faire » sans « Retirer » ni « ✕ », « Copier » refusé', { skip: sans }, async () => {
  assert.equal((await ranger(FENETRE())).ok, true);
  const ouvrirAuMembre = async (ouvert: 'oui' | 'non') => assert.equal((await valhallaOf()!.act('gladsheim', 'ouvrir_widget', { widget: ID.cyclope, personne: 'membre-a', ouvert })).ok, true);
  await ouvrirAuMembre('non');
  const { ctx, page, erreurs } = await ouvrirPage(390);
  try {
    await page.tap(`${carte(ID.accueil)} .wr-plus`);
    await page.waitForSelector('dialog.wr-regler[open]', { timeout: 15000 });
    const m = await page.evaluate(() => { const x = document.querySelector('dialog.wr-regler'), b = x.getBoundingClientRect(); return { l: b.left, r: b.right, t: b.top, bas: b.bottom, vw: window.innerWidth, vh: window.innerHeight, deborde: document.documentElement.scrollWidth > window.innerWidth, dedans: [...x.querySelectorAll('.wr-rg-c > *, .wr-rg-p > *')].every((n: any) => { const r = n.getBoundingClientRect(); return !r.width || (r.left >= b.left - 1 && r.right <= b.right + 1); }), petits: [...x.querySelectorAll('button, select, input[type=text], input[type=url], .wr-sizes label')].filter((n: any) => { const r = n.getBoundingClientRect(); return r.width && r.height < 44; }).map((n: any) => n.textContent || n.id) }; });
    assert.ok(m.l >= 0 && m.r <= m.vw && m.t >= 0 && m.bas <= m.vh, `la fenêtre tient dans l'écran : ${JSON.stringify(m)}`);
    assert.equal(m.deborde, false, 'la page ne déborde pas'); assert.equal(m.dedans, true, 'rien ne sort de la fenêtre');
    assert.deepEqual(m.petits, [], 'chaque commande fait au moins 44 px');
    // « Copier vers l'écran de la maison » : une copie, sur la page marquée, avec un nouvel identifiant.
    await page.evaluate(() => [...document.querySelectorAll('dialog.wr-regler button')].find((b: any) => b.textContent.startsWith('Copier')).click());
    const copie = await page.evaluate(() => { const L = window.OdinFenetre.state().L, s = L.pages[1].widgets[1], c = L.pages[0].widgets[L.pages[0].widgets.length - 1]; return { n: L.pages[0].widgets.length, memeSorte: c.kind === s.kind && c.module === s.module, autreId: c.id !== s.id && /^[0-9a-f]{8}$/.test(c.id), statut: [...document.querySelectorAll('dialog.wr-regler [role=status]')].map((x: any) => x.textContent).join('') }; });
    assert.deepEqual(copie, { n: 5, memeSorte: true, autreId: true, statut: 'Copié sur la page « Maison ». Rien n\'est gardé avant « Terminé ».' });
    await page.evaluate(() => [...document.querySelectorAll('dialog.wr-regler button')].find((b: any) => b.textContent === 'Annuler').click());
    await page.waitForFunction(() => !document.querySelector('dialog.wr-regler'));
    // Un widget de la vie privée ouvert à personne : « Copier » est refusé, et c'est dit.
    await page.tap(`${carte(ID.cyclope)} .wr-plus`); await page.waitForSelector('dialog.wr-regler[open]');
    await page.evaluate(() => [...document.querySelectorAll('dialog.wr-regler button')].find((b: any) => b.textContent.startsWith('Copier')).click());
    assert.match(await page.evaluate(() => [...document.querySelectorAll('dialog.wr-regler [role=status]')].map((x: any) => x.textContent).join('')), /Vie privée : ce widget n'est ouvert à personne, il ne se copie pas/);
    assert.equal(await page.evaluate(() => window.OdinFenetre.state().L.pages[0].widgets.length), 5, 'rien n\'est copié');
    assert.equal(await page.evaluate(() => [...document.querySelectorAll('dialog.wr-regler button')].some((b: any) => b.textContent === 'Ouvrir à…')), true, '« Ouvrir à… » y a sa place');
    await page.keyboard.press('Escape'); await page.waitForFunction(() => !document.querySelector('dialog.wr-regler'));
    // Ouvert à quelqu'un : c'est dit ; changer « Quand je touche » le refermerait, et c'est affiché AVANT de valider.
    await ouvrirAuMembre('oui');
    await page.tap(`${carte(ID.cyclope)} .wr-plus`); await page.waitForSelector('dialog.wr-regler[open]');
    assert.equal(await page.evaluate(() => document.querySelector('dialog.wr-regler .wr-rang .wr-aide').textContent), 'Vie privée : ouvert à Membre A.');
    assert.equal(await page.evaluate(() => document.querySelector('dialog.wr-regler .wr-att').textContent), '', 'rien de changé : rien à dire');
    await page.selectOption('#wrRQ', 'rien');
    assert.equal(await page.evaluate(() => document.querySelector('dialog.wr-regler .wr-att').textContent), 'Ce changement referme le widget pour Membre A. Tu pourras le rouvrir avec « Ouvrir à… ».');
    await page.fill('#wrRT', 'Un autre titre'); await page.selectOption('#wrRQ', 'appli');
    assert.equal(await page.evaluate(() => document.querySelector('dialog.wr-regler .wr-att').textContent), '', 'le titre seul : il reste ouvert, rien à dire');
    await page.keyboard.press('Escape'); await page.waitForFunction(() => !document.querySelector('dialog.wr-regler'));
    await ouvrirAuMembre('non');
    // « À faire » (déplacé ici à la main, de la page « Aujourd'hui », la dernière, à la page ouverte) : il se déplace, il ne se retire pas, il ne se copie pas.
    await page.evaluate(() => { const L = window.OdinFenetre.state().L; L.pages[2].widgets = []; L.pages[1].widgets.push({ id: 'f0000001', kind: 'a_faire', w: 1, c: 4, r: 3, label: 'À faire' }); return window.OdinFenetre.edit(true); });
    await page.waitForSelector(`${carte('f0000001')} .wr-plus`);
    const af = await page.evaluate(`(() => { const c = document.querySelector('${carte('f0000001')}'), autre = document.querySelector('${carte(ID.accueil)}'); return { croix: Boolean(c.querySelector('[aria-label="Retirer ce module"]')), croixAutre: Boolean(autre.querySelector('[aria-label="Retirer ce module"]')), poignee: Boolean(c.querySelector('.fe-grip')) }; })()`);
    assert.deepEqual(af, { croix: false, croixAutre: true, poignee: true }, 'pas de « ✕ » sur « À faire » ; sa poignée reste (il se déplace)');
    await page.tap(`${carte('f0000001')} .wr-plus`); await page.waitForSelector('dialog.wr-regler[open]');
    assert.equal(await page.evaluate(() => [...document.querySelectorAll('dialog.wr-regler button')].some((b: any) => b.textContent === 'Retirer')), false, 'pas de « Retirer » sur « À faire »');
    await page.evaluate(() => [...document.querySelectorAll('dialog.wr-regler button')].find((b: any) => b.textContent.startsWith('Copier')).click());
    assert.match(await page.evaluate(() => [...document.querySelectorAll('dialog.wr-regler [role=status]')].map((x: any) => x.textContent).join('')), /reste sur ton accueil : il ne se copie pas/, '« Copier » refusé pour « À faire »');
    assert.equal(await page.evaluate(() => window.OdinFenetre.state().L.pages.flatMap((p: any) => p.widgets).filter((w: any) => w.kind === 'a_faire').length), 1, 'aucune copie');
    assert.deepEqual(erreurs, [], 'aucune erreur dans la page');
  } finally { await ctx.close(); }
});

test('relecture, navigateur : deux appuis sur « ⋯ » n\'ouvrent qu\'une fenêtre ; le second clic d\'un double clic ne lance rien ; un titre piégé reste du texte', { skip: sans }, async () => {
  const f = FENETRE(); f.pages[1].widgets.push({ id: 'a0000007', kind: 'chiffres', w: 1, module: 'var', toucher: { quoi: 'action', action: 'retirer', input: { login: 'cible-c' } } } as never);
  assert.equal((await ranger(f)).ok, true);
  const { ctx, page, erreurs } = await ouvrirPage(1280);
  try {
    // Le second clic d'un double clic (sur la carte, ou sur son bouton) ne lance pas l'action une seconde fois.
    const c = carte('a0000007');
    await page.waitForSelector(`${c} button.fe-open`);
    for (const cible of ['.wr-n', 'button.fe-open']) {
      await page.evaluate(`document.querySelector('${c} ${cible}').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 2 }))`);
      await page.waitForTimeout(500);
      assert.equal(await page.evaluate(() => Boolean(document.querySelector('.odlg'))), false, `${cible} : le second clic d'un double clic ne lance rien`);
    }
    // Un vrai clic lance toujours (l'accord est demandé).
    await page.click(`${c} .wr-n`); await page.waitForSelector('.odlg[role=alertdialog]', { timeout: 15000 });
    await page.evaluate(() => document.querySelector('.odlg .odlg-btn.non').click()); await page.waitForFunction(() => !document.querySelector('.odlg'));
    // Deux appuis coup sur coup sur « ⋯ » : une seule fenêtre « Régler », aucun identifiant en double.
    await page.evaluate(`(() => { const b = document.querySelector('${carte(ID.accueil)} .wr-plus'); b.click(); b.click(); })()`);
    await page.waitForSelector('dialog.wr-regler[open]', { timeout: 15000 }); await page.waitForTimeout(800);
    assert.deepEqual(await page.evaluate(() => [document.querySelectorAll('dialog.wr-regler').length, document.querySelectorAll('#wrRT').length]), [1, 1]);
    // Un titre piégé : gardé comme un texte, dans la carte comme dans la fenêtre.
    const PIEGE = '<img src=x onerror=window.__p=1>';
    await page.fill('#wrRT', PIEGE); await page.keyboard.press('Enter');
    await page.waitForFunction(() => !document.querySelector('dialog.wr-regler'));
    await page.waitForFunction(`document.querySelector('${carte(ID.accueil)} .wr-n')?.textContent === ${JSON.stringify(PIEGE)}`);
    await page.evaluate(`document.querySelector('${carte(ID.accueil)} .wr-plus').click()`); await page.waitForSelector('dialog.wr-regler[open]');
    assert.deepEqual(await page.evaluate(() => { const x = document.querySelector('dialog.wr-regler'); return { titre: document.getElementById(x.getAttribute('aria-labelledby')).textContent, images: document.querySelectorAll('#fenetre img[src="x"], dialog img[src="x"]').length, piege: window.__p ?? null }; }), { titre: `Régler « ${PIEGE} »`, images: 0, piege: null });
    // Fermée, une nouvelle fenêtre s'ouvre de nouveau (rien n'est resté bloqué).
    await page.keyboard.press('Escape'); await page.waitForFunction(() => !document.querySelector('dialog.wr-regler'));
    await page.evaluate(`document.querySelector('${carte(ID.accueil)} .wr-plus').click()`); await page.waitForSelector('dialog.wr-regler[open]');
    await page.keyboard.press('Escape'); await page.waitForFunction(() => !document.querySelector('dialog.wr-regler'));
    // La page qui porte « À faire » (déplacé ici à la main) ne se supprime pas : il ne se retire pas par ce détour.
    await page.evaluate(() => { const L = window.OdinFenetre.state().L; L.pages[2].widgets = []; L.pages[1].widgets.push({ id: 'f0000001', kind: 'a_faire', w: 1, c: 4, r: 3, label: 'À faire' }); return window.OdinFenetre.edit(true); });
    await page.waitForSelector(carte('f0000001'));
    await page.evaluate(() => [...document.querySelectorAll('#fenetre .fe-tools .fe-tab')].find((b: any) => b.textContent === 'Supprimer la page').click());
    await page.waitForTimeout(400);
    assert.deepEqual(await page.evaluate(() => ({ demande: Boolean(document.querySelector('.odlg')), pages: window.OdinFenetre.state().L.pages.length, dit: [...document.querySelectorAll('.va-out[role=status]')].some((n: any) => /ne se retire pas/.test(n.textContent)) })), { demande: false, pages: 3, dit: true });
    assert.equal(cibleLa(), true); assert.deepEqual(erreurs, [], 'aucune erreur dans la page');
  } finally { await ctx.close(); assert.equal((await ranger(FENETRE())).ok, true); }
});
