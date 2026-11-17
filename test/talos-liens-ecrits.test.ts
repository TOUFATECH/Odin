// Les liens automatiques écrits entre les applis (src/valhalla/links.ts) se voient dans la liste des automatismes de
// Talos, en LECTURE SEULE : chacun une fois et une seule, avec son état et la mention « protège » pour ceux de sécurité
// et de sauvegarde. Chaque lien dit à la main s'il protège ou non (un lien ajouté demain doit être classé). Un membre
// ou un invité ne voit pas cette liste (comme il ne voyait pas les automatismes).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { LINKS } from '../src/valhalla/links.ts';
import { SENSORS } from '../src/valhalla/ullr/incidents.ts';
import { lignesLiensEcrits, lignesTalos, contexteTalos, agendaTalos, talosGet, talosPost } from '../src/web/talos-api.ts';
import { T } from './banc/lib.ts';
import { vraiOdin } from './banc/odin-vrai.ts';
import { allModules, valhallaOf } from '../src/valhalla/odin.ts';
import { relierProprietaire } from '../src/valhalla/sso/etat.ts';
import { startDraupnir } from '../src/draupnir/odin.ts';

const lire = (f: string) => readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8');

test('chaque lien écrit dit à la main s\'il protège (genre et raison) ou non', () => {
  for (const l of LINKS) {
    const nom = `${l.from} → ${l.to} (« ${l.when} »)`;
    assert.ok(Object.hasOwn(l, 'protege'), `${nom} : ni « protège » ni « ne protège pas »`);
    if (l.protege === false) continue;
    assert.ok(l.protege && typeof l.protege === 'object', `${nom} : protege vaut false ou { genre, raison }`);
    assert.ok(['sécurité', 'sauvegarde'].includes(l.protege.genre), `${nom} : genre « sécurité » ou « sauvegarde »`);
    assert.ok(l.protege.raison.trim().length >= 10, `${nom} : une phrase de raison`);
  }
  // Garde-fou : un lien qui bannit, passe à l'antivirus, range au coffre ou sauvegarde est forcément marqué.
  for (const l of LINKS) if (/\bbanni|antivirus|coffre|sauvegard/i.test(`${l.when} ${l.does}`)) assert.ok(l.protege, `${l.from} → ${l.to} (« ${l.when} ») devrait être marqué « protège »`);
  // Les signaux envoyés à Asclépios (générés depuis SENSORS) protègent : ils servent à reconnaître une attaque.
  for (const l of LINKS.filter((x) => x.does.startsWith('le signal rejoint les incidents d\'Asclépios'))) assert.equal(l.protege && l.protege.genre, 'sécurité');
  // Un lien qui OUVRE un port n'est marqué « protège » que si sa raison le dit (pas une raison qui fait croire l'inverse).
  for (const l of LINKS) if (l.protege && /ouvre ce port|port .*est ouvert/i.test(l.does)) assert.match(l.protege.raison, /ouvr/i, `${l.from} → ${l.to} : la raison doit dire qu'il ouvre un port`);
});

test('le recompte : les liens écrits à la main et ceux tirés des capteurs d\'Asclépios', () => {
  const capteurs = SENSORS.filter((q) => !['loki', 'skogul'].includes(q.app)).length;
  const src = lire('valhalla/links.ts'), bloc = src.slice(src.indexOf('export const LINKS'), src.indexOf('/** Usages de prédilection'));
  const aLaMain = [...bloc.matchAll(/^\s+\{ from: '/gm)].length;
  assert.equal(LINKS.length, aLaMain + capteurs, 'LINKS = liens écrits à la main + un par capteur (hors Sirènes et Némésis, déjà écrits)');
});

/** Une Valhalla réduite à la liste de ses applis (seul ce que lignesLiensEcrits lit). */
const valhallaDe = (ids: string[]) => {
  const mods = ids.map((id) => ({ id, name: id.toUpperCase() }));
  return { modules: () => mods, module: (id: string) => mods.find((m) => m.id === id) } as never;
};

test('chaque lien écrit apparaît une fois et une seule, en lecture seule, avec son état « actif »', () => {
  const toutes = [...new Set(LINKS.flatMap((k) => [k.from, k.to]))];
  const l = lignesLiensEcrits(valhallaDe(toutes));
  assert.equal(l.length, LINKS.length);
  assert.equal(new Set(l.map((x) => x.id)).size, l.length, 'identifiants distincts');
  LINKS.forEach((k, i) => {
    const x = l[i];
    assert.equal(l.filter((y) => y.de === k.from && y.vers === k.to && y.quand === k.when).length, 1, `${k.from} → ${k.to} une seule fois`);
    assert.deepEqual([x.sorte, x.de, x.vers, x.quand, x.fait, x.genre, x.etat, x.pourquoi], ['lien_ecrit', k.from, k.to, k.when, k.does, k.kind, 'actif', undefined]);
    assert.deepEqual(x.protege, k.protege);
  });
});

test('un lien n\'est pas dit « actif » quand ses applis ne sont pas là', () => {
  // Les applis d'Odin ne tournent pas : aucun lien n'est branché.
  for (const x of lignesLiensEcrits(undefined)) assert.deepEqual([x.etat, x.pourquoi], ['inactif', 'les applis d\'Odin ne tournent pas']);
  // Cerbère absent : chacun de ses liens est inactif (et dit pourquoi), les autres restent actifs.
  const sans = [...new Set(LINKS.flatMap((k) => [k.from, k.to]))].filter((id) => id !== 'garmr');
  const l = lignesLiensEcrits(valhallaDe(sans));
  LINKS.forEach((k, i) => {
    const touche = k.from === 'garmr' || k.to === 'garmr';
    assert.equal(l[i].etat, touche ? 'inactif' : 'actif', `${k.from} → ${k.to}`);
    if (touche) assert.match(l[i].pourquoi ?? '', /appli absente : garmr/);
  });
  assert.ok(l.some((x) => x.etat === 'inactif') && l.some((x) => x.etat === 'actif'));
});

test('la route des automatismes porte les liens à part (ni dans les lignes, ni dans l\'agenda) ; rien ne les coupe', async () => {
  const r = await talosGet(undefined, '/api/draupnir/automatismes', new URLSearchParams()) as { ok: boolean; lignes: Array<{ sorte: string }>; liens?: Array<{ id: string; sorte: string }> };
  assert.equal(r.ok, true);
  assert.equal(r.liens?.length, LINKS.length, 'tous les liens écrits sont dans la réponse');
  assert.ok(r.liens!.every((x) => x.sorte === 'lien_ecrit'));
  const c = contexteTalos();
  assert.ok(!lignesTalos(c).some((x) => (x.sorte as string) === 'lien_ecrit'), 'pas mêlés aux lignes qui se règlent');
  assert.ok(!agendaTalos(c, new Date(), new Date(Date.now() + 7 * 86_400_000)).some((x) => (x.sorte as string) === 'lien_ecrit'), 'pas dans l\'agenda');
  // Lecture seule : aucune route ne met un lien en pause ni ne le lance.
  const id = r.liens![0].id;
  for (const route of ['/api/draupnir/automatisme/pause', '/api/draupnir/automatisme/lancer', '/api/draupnir/automatisme/supprimer']) {
    const p = await talosPost(undefined, route, { id, pause: true, confirme: true }) as { ok: boolean };
    assert.equal(p.ok, false, `${route} refuse un lien écrit`);
  }
  // La marque n'est lue par aucun réflexe : ce que les liens font ne change pas.
  const src = lire('valhalla/links.ts'), wire = src.slice(src.indexOf('export function wireReflexes'), src.indexOf('/** Modèles d\'automatisations'));
  assert.doesNotMatch(wire, /protege/);
});

test('la page : un bloc « Liens entre applis » par appli qui signale, filtre « Qui protègent », aucun bouton', () => {
  const win: Record<string, any> = {};
  const code = lire('web/pages/talos-automatismes.js');
  vm.runInNewContext(code, { window: win });
  const L = win.OdinAutomatismes.logique, liens = lignesLiensEcrits(undefined);
  assert.ok(L.FILTRES.some((f: { id: string }) => f.id === 'liens'), 'un filtre « Liens entre applis »');
  const tous = L.grouperLiens(liens, false), prot = L.grouperLiens(liens, true);
  assert.equal(tous.reduce((n: number, g: { liens: unknown[] }) => n + g.liens.length, 0), liens.length, 'chaque lien dans un seul groupe');
  assert.equal(new Set(tous.map((g: { de: string }) => g.de)).size, tous.length);
  assert.equal(prot.reduce((n: number, g: { liens: unknown[] }) => n + g.liens.length, 0), liens.filter((x) => x.protege).length);
  assert.equal(L.phraseLien(liens[0]), `Quand ${LINKS[0].when} → ${LINKS[0].does}`);
  const f = /function ligneLien\(l\) \{[\s\S]*?\n {2}\}/.exec(code)?.[0] ?? '';
  assert.ok(f.length > 50); assert.doesNotMatch(f, /'button'|\bB\(|onclick/, 'une ligne de lien n\'a aucun bouton');
});

test('un membre ou un invité ne voit pas la liste ; le propriétaire la voit', { timeout: 120_000 }, async () => {
  const tt = new T(), orig = { log: console.log, error: console.error, warn: console.warn };
  for (const k of ['log', 'error', 'warn'] as const) console[k] = () => undefined;
  try {
    const v = await vraiOdin(tt, { compte: true, modules: (o) => allModules(o).filter((m) => ['var', 'brisingamen'].includes(m.id)) }), va = valhallaOf()!;
    // Talos (les automatisations) n'est pas lancé par vraiOdin : on le démarre, comme odin-plein.ts.
    tt.onEnd(startDraupnir(v.o, async () => undefined));
    relierProprietaire(va.ctx('var'));
    const proprio = await v.json('/api/draupnir/automatismes');
    assert.equal(proprio.status, 200, JSON.stringify(proprio.body).slice(0, 300)); assert.ok(Array.isArray(proprio.body.liens), JSON.stringify(proprio.body).slice(0, 300)); assert.equal((proprio.body.liens as unknown[]).length, LINKS.length);
    // Cet Odin n'a que Persona et Thésauros : seuls les liens entre ces deux-là seraient actifs.
    for (const x of proprio.body.liens as Array<{ de: string; vers: string; etat: string }>) assert.equal(x.etat, ['var', 'brisingamen'].includes(x.de) && ['var', 'brisingamen'].includes(x.vers) ? 'actif' : 'inactif', `${x.de} → ${x.vers}`);
    for (const [login, groupe] of [['nour', 'famille'], ['lilo', 'invite']]) {
      const mdp = `${login}-ciel-de-sable-sous-la-pluie-27`;
      assert.equal((await va.act('var', 'ajouter', { login, nom: login, groupes: groupe, email: `${login}@exemple.yt`, mot_de_passe: mdp })).ok, true);
      let r = await fetch(`${v.url}/sso/odin`, { redirect: 'manual' }); r = await fetch(new URL(r.headers.get('location')!, v.url), { redirect: 'manual' });
      const demande = /name="demande" value="([^"]+)"/.exec(await r.text())![1];
      r = await fetch(`${v.url}/sso/autoriser`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded', origin: v.url }, body: new URLSearchParams({ demande, identifiant: login, motdepasse: mdp }) });
      r = await fetch(new URL(r.headers.get('location')!, v.url), { redirect: 'manual' });
      const cookie = r.headers.getSetCookie().find((c) => c.startsWith('odin_session='))?.split(';')[0] ?? '';
      // Un membre de la famille entre dans Odin ; un invité n'y entre même pas (pas le droit « odin ») : il essaie sans session.
      if (groupe === 'famille') assert.ok(cookie, `${login} a une session`);
      const m = await v.json('/api/draupnir/automatismes', undefined, { cookie });
      assert.ok(m.status === 401 || m.status === 403, `${login} (${groupe}) : refusé (${m.status})`);
      assert.equal(m.body.liens, undefined); assert.equal(m.body.lignes, undefined);
    }
  } finally { Object.assign(console, orig); await tt.end(); }
});
