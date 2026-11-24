// Mise à jour et garde-fous (noyau) : une nouvelle version des garde-fous qui vient de la VRAIE mise à jour (le dépôt
// officiel, empreintes vérifiées) est acceptée par le seul clic « Mettre à jour » du propriétaire, sans second clic ;
// seule (mode « auto » sans son clic), jamais : il faudrait sa signature (son choix « Signée par ma clé », pas encore
// construite) ; en mode « ne pas vérifier », jamais. Toute autre modification (à la main, un commit local non publié,
// une autre adresse de dépôt, une copie sans git, sans réseau, un remplacement d'objet, un crochet git, un fichier écrit
// pendant l'acceptation) garde l'alerte jusqu'au clic.
// Tout se passe sur des dépôts git JETABLES : un faux dépôt « officiel » local, cloné dans un dossier temporaire ; son
// adresse est donnée par un paramètre d'essai (jamais le vrai dépôt en ligne).
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { accepterMiseAJourOfficielle, calculerEmpreintes, codeMajNoyau, memeDepot, DEPOT_OFFICIEL, FICHIER_EMPREINTES, ecrireReference, figerReference, noterReferenceConnue, verifierNoyau, versionOfficielle, RACINE_APPLI, type TraceMaj } from '../src/heimdall/noyau.ts';
import { applyUpdate, checkForUpdate } from '../src/tools/update.ts';
import { T } from './banc/lib.ts';
import { vraiOdin, type VraiOdin } from './banc/odin-vrai.ts';
import { allModules, valhallaOf } from '../src/valhalla/odin.ts';
import { lierProprietaire, persona } from '../src/valhalla/sso/etat.ts';

const ENV = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };
const g = (cwd: string, ...a: string[]) => execFileSync('git', a, { cwd, encoding: 'utf8', env: ENV }).trim();
const dossiers: string[] = [];
after(() => { for (const d of dossiers) rmSync(d, { recursive: true, force: true }); });

/** Une version publiable : un garde-fou, le coffre, de quoi se charger, et la référence d'empreintes. */
function version(dir: string, n: number): void {
  mkdirSync(join(dir, 'src/heimdall'), { recursive: true }); mkdirSync(join(dir, 'src/web'), { recursive: true });
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'odin', version: `1.${n}.0` }));
  writeFileSync(join(dir, 'src/runtime.ts'), 'export const ok = 1;\n');
  writeFileSync(join(dir, 'src/web/server.ts'), 'export const web = 1;\n');
  writeFileSync(join(dir, 'src/heimdall/garde.ts'), `export const garde = ${n};\n`);
  writeFileSync(join(dir, 'src/vault.ts'), 'export const coffre = 1;\n');
  ecrireReference(dir);
  g(dir, 'add', '-A'); g(dir, 'commit', '-qm', `v1.${n}.0 : garde-fou ${n}`);
}

interface Scene { base: string; officiel: string; dev: string; app: string; home: string; de: string; vers: string }
/**
 * Odin installé par un clone du faux dépôt officiel, en v1.1 ; la v1.2 (qui change un garde-fou) est publiée ; Odin
 * tourne encore sur sa référence d'avant (figée), puis récupère la nouvelle version. `maj: false` : publiée, pas récupérée.
 */
function scene(o: { maj?: boolean; depuis?: 'officiel' | 'autre' } = {}): Scene {
  const base = mkdtempSync(join(tmpdir(), 'maj-noyau-')); dossiers.push(base);
  const officiel = join(base, 'officiel.git'), dev = join(base, 'dev'), app = join(base, 'app'), home = join(base, 'home');
  mkdirSync(home);
  g(base, 'init', '-q', '--bare', '-b', 'main', officiel);
  g(base, 'clone', '-q', officiel, dev); g(dev, 'checkout', '-qb', 'main');
  version(dev, 1); g(dev, 'push', '-q', 'origin', 'main');
  let source = officiel;
  if (o.depuis === 'autre') { source = join(base, 'autre.git'); g(base, 'clone', '-q', '--bare', officiel, source); }
  g(base, 'clone', '-q', source, app);
  const de = g(app, 'rev-parse', 'HEAD');
  version(dev, 2); g(dev, 'push', '-q', 'origin', 'main');
  if (o.depuis === 'autre') g(dev, 'push', '-q', source, 'main');
  figerReference(app); // Odin tourne sur la v1.1 : sa référence est celle-là
  if (o.maj !== false) g(app, 'pull', '-q', '--ff-only');
  return { base, officiel, dev, app, home, de, vers: g(app, 'rev-parse', 'HEAD') };
}

/**
 * La décision au démarrage, avec la fonction d'acceptation du clic (référence refaite, « dernière connue » notée). Par
 * défaut, la mise à jour a été lancée par SON clic « Mettre à jour » (trace de v1.1 à v1.2) ; `trace` la remplace.
 */
async function decider(s: Scene, mode: string, extra: { trace?: TraceMaj; officiel?: string; racine?: string } = {}) {
  const journal: Array<Record<string, unknown>> = []; let acceptations = 0;
  const racine = extra.racine ?? s.app;
  const r = await accepterMiseAJourOfficielle({
    mode, trace: 'trace' in extra ? extra.trace : { de: s.de, vers: s.vers, parClic: true }, racine, officiel: extra.officiel ?? s.officiel, delaiMs: 20_000,
    accepter: () => { acceptations++; ecrireReference(racine); noterReferenceConnue(s.home, racine); },
    noter: (e) => journal.push(e),
  });
  return { r, journal, acceptations, ecarts: verifierNoyau(racine).ecarts };
}

test('(a) son clic « Mettre à jour », clone propre, commit officiel : accepté sans second clic, le journal le dit, et le code se montre', async () => {
  const s = scene();
  assert.ok(verifierNoyau(s.app).ecarts.length, 'l\'alerte est levée après la mise à jour');
  const v = await versionOfficielle(s.app, { officiel: s.officiel });
  assert.equal(v.ok, true, v.raison); assert.equal(v.commit, s.vers);
  // L'adresse officielle : exactement celle du code, avec ou sans « .git » final, rien d'autre.
  for (const a of ['https://github.com/TOUFATECH/Odin.git', 'https://github.com/TOUFATECH/Odin', ' https://github.com/TOUFATECH/Odin.git\n']) assert.equal(memeDepot(a), true, a);
  for (const a of ['', 'https://github.com/TOUFATECH/Odin.git/', 'https://github.com/toufatech/Odin.git', 'git@github.com:TOUFATECH/Odin.git', 'https://github.com/TOUFATECH/Odin.git.autre', 'https://github.com/TOUFATECH/Odin-copie.git', 'http://github.com/TOUFATECH/Odin.git', 'https://exemple.org/TOUFATECH/Odin.git']) assert.equal(memeDepot(a), false, a);
  assert.equal(DEPOT_OFFICIEL, 'https://github.com/TOUFATECH/Odin.git');
  const d = await decider(s, 'auto');
  assert.equal(d.r.accepte, true, d.r.raison); assert.equal(d.acceptations, 1);
  assert.deepEqual(d.ecarts, [], 'plus d\'alerte');
  assert.equal(d.journal.length, 1);
  assert.equal(d.journal[0].evenement, 'noyau-accepte-maj');
  assert.equal(d.journal[0].texte, `garde-fous acceptés : mise à jour officielle, de ${s.de.slice(0, 12)} à ${s.vers.slice(0, 12)}`);
  assert.deepEqual(d.r.fichiers, ['src/heimdall/garde.ts', 'src/heimdall/noyau-empreintes.json']);
  const c = await codeMajNoyau(s.de, s.vers, s.app);
  assert.equal(c.ok, true); assert.match(c.texte, /^-export const garde = 1;$/m); assert.match(c.texte, /^\+export const garde = 2;$/m);
  assert.doesNotMatch(c.texte, /package\.json|runtime\.ts/, 'seulement les fichiers du noyau');
  assert.equal((await codeMajNoyau('HEAD', s.vers, s.app)).ok, false, 'seulement des empreintes de commit');
});

test('(b) auto, un fichier du noyau modifié à la main après la mise à jour : PAS accepté (aussi caché à git)', async () => {
  const s = scene();
  writeFileSync(join(s.app, 'src/heimdall/garde.ts'), 'export const garde = 99;\n');
  const d = await decider(s, 'auto');
  assert.equal(d.r.accepte, false); assert.match(d.r.raison, /modifié par rapport au commit installé/); assert.equal(d.acceptations, 0);
  assert.ok(d.ecarts.length, 'l\'alerte reste');
  // Le même fichier « mis de côté » pour git (assume-unchanged) : git status ne le voit plus, les empreintes si.
  g(s.app, 'update-index', '--assume-unchanged', 'src/heimdall/garde.ts');
  const d2 = await decider(s, 'auto');
  assert.equal(d2.r.accepte, false); assert.match(d2.r.raison, /garde\.ts ne correspond pas aux empreintes/); assert.equal(d2.acceptations, 0);
  // Un fichier ajouté dans le noyau, non suivi : pas accepté non plus.
  const s3 = scene(); writeFileSync(join(s3.app, 'src/heimdall/ajout.ts'), 'export {};\n');
  const d3 = await decider(s3, 'auto');
  assert.equal(d3.r.accepte, false); assert.equal(d3.acceptations, 0);
});

test('(c) auto, commit local non publié (empreintes refaites dans la copie) : pas accepté', async () => {
  const s = scene();
  writeFileSync(join(s.app, 'src/heimdall/garde.ts'), 'export const garde = 3;\n');
  // la référence refaite dans la copie (sans toucher à celle qu'Odin a figée au démarrage)
  writeFileSync(join(s.app, FICHIER_EMPREINTES), JSON.stringify({ note: 'locale', fichiers: calculerEmpreintes(s.app) }, null, 2) + '\n');
  g(s.app, 'add', '-A'); g(s.app, 'commit', '-qm', 'retouche locale');
  assert.equal((await versionOfficielle(s.app, { officiel: s.officiel })).ok, false);
  // même avec une trace de « clic » qui mène à ce commit local
  const d = await decider(s, 'auto', { trace: { de: s.de, vers: g(s.app, 'rev-parse', 'HEAD'), parClic: true } });
  assert.equal(d.r.accepte, false); assert.match(d.r.raison, /pas publié sur la branche officielle/); assert.equal(d.acceptations, 0);
});

test('(d) auto, adresse de dépôt différente, ou adresse officielle réécrite par git : pas accepté', async () => {
  const s = scene({ depuis: 'autre' });
  const d = await decider(s, 'auto');
  assert.equal(d.r.accepte, false); assert.match(d.r.raison, /adresse du dépôt suivi/); assert.equal(d.acceptations, 0);
  const s2 = scene();
  const autre = join(s2.base, 'piege.git'); g(s2.base, 'clone', '-q', '--bare', s2.officiel, autre);
  g(s2.app, 'config', `url.${autre}.insteadOf`, s2.officiel);
  const d2 = await decider(s2, 'auto');
  assert.equal(d2.r.accepte, false); assert.match(d2.r.raison, /adresse/); assert.equal(d2.acceptations, 0);
});

test('(e) auto, copie sans git : pas accepté', async () => {
  const s = scene();
  const copie = join(s.base, 'copie');
  cpSync(s.app, copie, { recursive: true, filter: (p) => !/[\\/]\.git([\\/]|$)/.test(p) });
  figerReference(copie); writeFileSync(join(copie, 'src/heimdall/garde.ts'), 'export const garde = 2; \n');
  const d = await decider(s, 'auto', { racine: copie });
  assert.equal(d.r.accepte, false); assert.match(d.r.raison, /sans git/); assert.equal(d.acceptations, 0);
});

test('(f) « me prévient » : dit avant le clic que les garde-fous changent ; sans clic pas accepté, avec son clic accepté', async () => {
  const s0 = scene({ maj: false });
  const info = await checkForUpdate(s0.app);
  assert.equal(info.available, true);
  assert.deepEqual(info.noyau, ['src/heimdall/garde.ts', 'src/heimdall/noyau-empreintes.json'], 'la carte le dit avant le clic');
  // La mise à jour d'Odin rend les deux commits (la trace de son clic les garde).
  const u = applyUpdate(s0.app, s0.home);
  assert.equal(u.ok, true, u.message); assert.equal(u.de, s0.de); assert.equal(u.vers, g(s0.app, 'rev-parse', 'HEAD'));
  assert.deepEqual((await checkForUpdate(s0.app)).noyau, [], 'à jour : plus rien à dire');

  const s = scene();
  const sans = await decider(s, 'notify', { trace: undefined });
  assert.equal(sans.r.accepte, false); assert.match(sans.r.raison, /clic/); assert.equal(sans.acceptations, 0);
  const pasLui = await decider(s, 'notify', { trace: { de: s.de, vers: s.vers, parClic: false } });
  assert.equal(pasLui.r.accepte, false); assert.equal(pasLui.acceptations, 0);
  const autreVersion = await decider(s, 'notify', { trace: { de: s.de, vers: s.de, parClic: true } });
  assert.equal(autreVersion.r.accepte, false, 'un clic sur une autre version ne vaut pas'); assert.equal(autreVersion.acceptations, 0);
  const avec = await decider(s, 'notify', { trace: { de: s.de, vers: s.vers, parClic: true } });
  assert.equal(avec.r.accepte, true, avec.r.raison); assert.equal(avec.acceptations, 1); assert.deepEqual(avec.ecarts, []);
  assert.match(String(avec.journal[0].texte), /^garde-fous acceptés : mise à jour officielle, de /);
});

test('(g) « ne pas vérifier » : jamais, même avec une trace de clic', async () => {
  const s = scene();
  const d = await decider(s, 'off', { trace: { de: s.de, vers: s.vers, parClic: true } });
  assert.equal(d.r.accepte, false); assert.equal(d.acceptations, 0); assert.ok(d.ecarts.length);
  const inconnu = await decider(s, 'n-importe', { trace: { de: s.de, vers: s.vers, parClic: true } });
  assert.equal(inconnu.r.accepte, false); assert.equal(inconnu.acceptations, 0);
});

test('(h) sans réseau (dépôt officiel injoignable) : pas accepté, on attend', async () => {
  const s = scene();
  renameSync(s.officiel, `${s.officiel}-injoignable`);
  const d = await decider(s, 'auto');
  assert.equal(d.r.accepte, false); assert.match(d.r.raison, /injoignable/); assert.equal(d.acceptations, 0);
  // Sans trace de son clic (rien pour montrer ce qui a changé) : pas accepté non plus.
  renameSync(`${s.officiel}-injoignable`, s.officiel);
  const d2 = await decider(s, 'auto', { trace: undefined });
  assert.equal(d2.r.accepte, false); assert.equal(d2.acceptations, 0);
  // Pas une mise à jour vers une version plus récente (l'ancien commit est le commit installé) : pas accepté.
  const d3 = await decider(s, 'auto', { trace: { de: s.vers, vers: s.vers, parClic: true } });
  assert.equal(d3.r.accepte, false); assert.equal(d3.acceptations, 0);
});

test('(p) « auto » sans son clic : jamais accepté seul, même la vraie mise à jour (il faudrait sa signature)', async () => {
  const s = scene();
  assert.equal((await versionOfficielle(s.app, { officiel: s.officiel })).ok, true, 'c\'est bien la vraie mise à jour');
  for (const trace of [undefined, { de: s.de, vers: s.vers, parClic: false }]) {
    const d = await decider(s, 'auto', { trace });
    assert.equal(d.r.accepte, false); assert.match(d.r.raison, /signature/); assert.equal(d.acceptations, 0);
    assert.ok(d.ecarts.length, 'l\'alerte reste jusqu\'à son clic');
  }
});

// ---------------------------------------------------------------- « Voir le code » : la route, propriétaire seul
const MDP = 'une-barque-rouge-sous-le-pont-de-pierre-63';
const cookieDe = (r: Response, nom: string) => r.headers.getSetCookie().find((c) => c.startsWith(`${nom}=`))?.split(';')[0] ?? '';
async function entrer(v: VraiOdin, ident: string, mdp: string): Promise<string> {
  let r = await fetch(`${v.url}/sso/odin`, { redirect: 'manual' }); assert.equal(r.status, 303);
  r = await fetch(new URL(r.headers.get('location')!, v.url), { redirect: 'manual' }); const html = await r.text(), demande = /name="demande" value="([^"]+)"/.exec(html)![1];
  r = await fetch(`${v.url}/sso/autoriser`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded', origin: v.url }, body: new URLSearchParams({ demande, identifiant: ident, motdepasse: mdp }) });
  r = await fetch(r.headers.get('location')!, { redirect: 'manual' }); assert.equal(r.status, 303, 'session ouverte');
  return cookieDe(r, 'odin_session');
}
const tt = new T(), orig = { log: console.log, error: console.error, warn: console.warn };
let v: VraiOdin, membre = '';
before(async () => {
  for (const k of ['log', 'error', 'warn'] as const) console[k] = () => {};
  v = await vraiOdin(tt, { compte: true, modules: (o) => allModules(o).filter((m) => m.id === 'var') });
  v.o.cfg.web.portsParAppli = false;
  const va = valhallaOf()!;
  assert.equal((await va.act('var', 'ajouter', { login: 'membre-d', nom: 'Membre D', groupes: 'invite', mot_de_passe: MDP })).ok, true);
  assert.equal((await va.act('var', 'donner_acces', { appli: 'odin', qui: '@membre-d' })).ok, true);
  lierProprietaire(persona()!);
  membre = await entrer(v, 'membre-d', MDP);
});
after(async () => { await tt.end(); Object.assign(console, orig); });

test('(i) « Voir le code » : 403 pour un membre, le texte rendu en entier pour le propriétaire', async (t) => {
  // Deux vrais commits du dépôt d'Odin qui touchent ses garde-fous (lecture seule) ; sans historique : rien à essayer.
  let l: string[] = [];
  try { l = execFileSync('git', ['-C', RACINE_APPLI, 'log', '-2', '--format=%H', '--', 'src/heimdall/noyau.ts'], { encoding: 'utf8' }).trim().split('\n').filter(Boolean); } catch { /* pas de git */ }
  if (l.length < 2) { t.skip('pas d\'historique git ici'); return; }
  const [vers, de] = l;
  v.o.muninn.setKv('noyau-maj-vue', JSON.stringify({ de, vers, quand: new Date().toISOString(), fichiers: ['src/heimdall/noyau.ts'] }));
  const m = await v.json('/api/noyau/maj?code=1', undefined, { cookie: membre });
  assert.equal(m.status, 403, 'un membre ne voit pas le code des garde-fous'); assert.equal(m.body.texte, undefined);
  const m2 = await v.json('/api/noyau/maj', undefined, { cookie: membre });
  assert.equal(m2.status, 403);
  const p = await v.json('/api/noyau/maj?code=1');
  assert.equal(p.status, 200, JSON.stringify(p.body).slice(0, 300));
  const attendu = await codeMajNoyau(de, vers);
  assert.ok(attendu.texte.length > 0);
  assert.equal(p.body.texte, attendu.texte, 'le texte entier, sans coupure');
  assert.deepEqual((p.body.maj as { de: string }).de, de);
  const resume = await v.json('/api/noyau/maj');
  assert.equal(resume.status, 200); assert.equal(resume.body.texte, undefined, 'sans « code=1 », seulement le message');
  v.o.muninn.setKv('noyau-maj-vue', '');
  const rien = await v.json('/api/noyau/maj?code=1');
  assert.equal(rien.status, 200); assert.equal(rien.body.maj, null);
});

// ---------------------------------------------------------------- relecture : ce qu'un programme pourrait tenter
test('(j) un objet de remplacement (git replace) ou une greffe ne fait pas passer un garde-fou affaibli', async () => {
  const s = scene();
  writeFileSync(join(s.app, 'src/heimdall/garde.ts'), 'export const garde = 666; // affaibli\n');
  writeFileSync(join(s.app, FICHIER_EMPREINTES), JSON.stringify({ note: 'refaite', fichiers: calculerEmpreintes(s.app) }, null, 2) + '\n');
  g(s.app, 'add', '-A');
  const faux = g(s.app, 'commit-tree', g(s.app, 'write-tree'), '-p', s.de, '-m', 'v1.2.0 : garde-fou 2');
  g(s.app, 'replace', s.vers, faux);
  assert.equal(g(s.app, 'rev-parse', 'HEAD'), s.vers, 'HEAD reste le vrai commit officiel');
  assert.equal(g(s.app, 'status', '--porcelain'), '', 'git (qui suit le remplacement) ne voit rien');
  assert.equal((await versionOfficielle(s.app, { officiel: s.officiel })).ok, false);
  const d = await decider(s, 'auto');
  assert.equal(d.r.accepte, false, 'pas accepté'); assert.equal(d.acceptations, 0); assert.ok(d.ecarts.length, 'l\'alerte reste');
  // La même chose par une greffe (info/grafts) au lieu d'un remplacement : pas accepté non plus.
  const s2 = scene();
  writeFileSync(join(s2.app, '.git/info/grafts'), `${s2.vers} ${s2.de}\n`);
  const d2 = await decider(s2, 'auto');
  assert.equal(d2.r.accepte, false); assert.match(d2.r.raison, /greffe|remplacement/); assert.equal(d2.acceptations, 0);
});

test('(k) un garde-fou modifié pendant l\'acceptation : refusé, et l\'alerte revient après un redémarrage', async () => {
  const s = scene();
  const journal: Array<Record<string, unknown>> = [];
  const r = await accepterMiseAJourOfficielle({
    mode: 'auto', trace: { de: s.de, vers: s.vers, parClic: true }, racine: s.app, officiel: s.officiel, delaiMs: 20_000,
    // un programme écrit dans le garde-fou entre la vérification et l'écriture de la référence
    accepter: () => { writeFileSync(join(s.app, 'src/heimdall/garde.ts'), 'export const garde = 666;\n'); ecrireReference(s.app); noterReferenceConnue(s.home, s.app); },
    noter: (e) => journal.push(e),
  });
  assert.equal(r.accepte, false); assert.equal(journal[0]?.evenement, 'noyau-maj-refusee');
  assert.ok(verifierNoyau(s.app).ecarts.length, 'écart tout de suite');
  // Redémarrage : la référence est relue sur le disque (comme au démarrage d'Odin).
  figerReference(s.app);
  assert.ok(verifierNoyau(s.app).ecarts.some((e) => e.fichier === 'src/heimdall/garde.ts'), 'l\'écart survit au redémarrage');
});

test('(l) un crochet git du dépôt installé ne s\'exécute pas pendant la vérification', async () => {
  const s = scene();
  const enSlash = (p: string) => p.split(String.fromCharCode(92)).join('/');
  const crochets = join(s.base, 'crochets'), trace = enSlash(join(s.base, 'crochet.txt'));
  mkdirSync(crochets);
  for (const n of ['reference-transaction', 'post-checkout', 'post-merge', 'fsmonitor-watchman']) writeFileSync(join(crochets, n), `#!/bin/sh\necho ${n} >> "${trace}"\n`, { mode: 0o755 });
  g(s.app, 'config', 'core.hooksPath', enSlash(crochets));
  const d = await decider(s, 'auto');
  assert.equal(d.r.accepte, true, d.r.raison);
  assert.equal(existsSync(trace), false, 'aucun crochet lancé');
});

test('(m) « Voir le code » : le texte reste montré même si le dépôt le marque comme binaire, et suit les vrais objets', async () => {
  const s = scene();
  writeFileSync(join(s.app, '.git/info/attributes'), '* -diff\n');
  const c = await codeMajNoyau(s.de, s.vers, s.app);
  assert.equal(c.ok, true); assert.match(c.texte, /^\+export const garde = 2;$/m);
  // un remplacement du nouveau commit ne change pas le code montré
  const faux = g(s.app, 'commit-tree', g(s.app, 'rev-parse', `${s.de}^{tree}`), '-p', s.de, '-m', 'faux');
  g(s.app, 'replace', s.vers, faux);
  assert.match((await codeMajNoyau(s.de, s.vers, s.app)).texte, /^\+export const garde = 2;$/m);
});

test('(n) « Mettre à jour » : seul le clic du propriétaire dans son navigateur compte comme son clic', async () => {
  const appels: unknown[] = [];
  const hooks = (v.web as unknown as { hooks: { updateNow?: (c?: boolean) => Promise<string> } }).hooks;
  const avant = hooks.updateNow;
  hooks.updateNow = async (c?: boolean) => { appels.push(c); return '✅ Odin est déjà à jour.'; };
  try {
    const p = await v.json('/api/action', { kind: 'update_apply' });
    assert.equal(p.status, 200, JSON.stringify(p.body));
    const k = await v.json('/api/action', { kind: 'update_apply' }, { authorization: `Bearer ${v.token}` });
    // Depuis le 24/11, la clé d'accès lit et parle seulement : ce geste lui est refusé (avant, il partait sans valoir « son clic »).
    assert.equal(k.status, 403, JSON.stringify(k.body));
    assert.deepEqual(appels, [true], 'la clé d\'API ne lance plus la mise à jour : seul le clic du propriétaire est parti');
  } finally { hooks.updateNow = avant; }
});

test('(o) la fenêtre « Voir le code » : focus gardé dedans, le code se rouvre depuis la carte, cibles de 44 px, icône collée', () => {
  const ui = readFileSync(join(RACINE_APPLI, 'src/web/ui.html'), 'utf8');
  const fenetre = ui.slice(ui.indexOf('async function voirCodeNoyau'), ui.indexOf('function renderHome()'));
  assert.match(fenetre, /\.inert = true/, 'la page derrière est inerte tant que la fenêtre est ouverte');
  assert.match(fenetre, /\.inert = false/, 'et redevient active à la fermeture');
  assert.match(fenetre, /\.focus\(\)/);
  const carte = ui.slice(ui.indexOf('function renderMaj('), ui.indexOf('function renderMaj(') + 4000);
  assert.match(carte, /Voir le code des garde-fous/, 'le code se rouvre depuis la carte des mises à jour');
  assert.match(ui, /\[data-noyau-btn\][^{]*\{[^}]*min-height:44px/, 'cibles tactiles de 44 px');
  assert.ok(ui.includes(`🛡${String.fromCharCode(160)}Cette mise à jour change les garde-fous`), "l'icône ne reste pas seule en fin de ligne (espace insécable)");
});
