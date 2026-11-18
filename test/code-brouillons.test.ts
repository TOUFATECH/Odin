// Les brouillons de réécriture, gardés hors du code : différence complète et numérotée, empreintes, plafonds, état
// « périmé », et ce qu'un membre ne peut jamais demander (noyau, code sensible, et tout ce qu'ils chargent, calculé).
// Dossiers jetables, prénoms inventés ; le vrai dossier du code n'est que LU (pour la fermeture des imports).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { difference, compteDifference, finsDeLigneChangees, texteApres, texteAvant, texteDifference } from '../src/code/difference.ts';
import { fermeture, fichiersGardes, importsRelatifs, lecteurDisque } from '../src/code/fermeture.ts';
import { creerBrouillon, lireBrouillon, listerBrouillons, refuserBrouillon, revoirBrouillon, DOSSIER_BROUILLONS, PLAFONDS, TAILLE_MAX, type Demandeur } from '../src/code/brouillons.ts';
import { RACINE_APPLI, fichiersNoyau } from '../src/heimdall/noyau.ts';

const dossiers: string[] = [];
after(() => { for (const d of dossiers) rmSync(d, { recursive: true, force: true }); });
const tmp = (p: string) => { const d = mkdtempSync(join(tmpdir(), p)); dossiers.push(d); return d; };
const sha = (t: string) => createHash('sha256').update(t.replace(/\r\n/g, '\n')).digest('hex');

const PROPRIO: Demandeur = { role: 'proprietaire', nom: 'Alix', canal: 'web' };
const MEMBRE: Demandeur = { role: 'membre', nom: 'Noa', canal: 'telegram' };
const AUTRE_MEMBRE: Demandeur = { role: 'membre', nom: 'Sami', canal: 'web' };

/** Un petit dossier de code d'essai : un noyau, du code sensible, des fichiers qu'ils chargent, des fichiers libres. */
function codeEssai(): string {
  const r = tmp('odin-code-');
  const f = (rel: string, t: string) => { mkdirSync(dirname(join(r, rel)), { recursive: true }); writeFileSync(join(r, rel), t); };
  f('src/heimdall/policy.ts', "import { regle } from '../aide/statique.ts';\nexport const p = regle;\n");
  f('src/aide/statique.ts', 'export const regle = 1;\n');
  // chargé SEULEMENT à la demande par un fichier du noyau, puis ce qu'il charge lui-même
  f('src/vault.ts', "export async function ouvrir() { const m = await import('./aide/demande.ts'); return m.d; }\n");
  f('src/aide/demande.ts', "import { profond } from './profond.ts';\nexport const d = profond;\n");
  f('src/aide/profond.ts', 'export const profond = 2;\n');
  // le cas de self.ts → builtin.ts : à la demande, et builtin.ts charge un fichier hors du code sensible
  f('src/tools/self.ts', "export async function lancer() { const { shell } = await import('./builtin.ts'); return shell; }\n");
  f('src/tools/builtin.ts', "import { garde } from '../scripts/garde.ts';\nexport const shell = garde;\n");
  f('src/tools/outil.ts', 'export const outil = 3;\n');
  f('src/scripts/garde.ts', 'export const garde = 4;\n');
  // lancé par son chemin (processus, Worker) : chargé aussi ; un nom calculé (`${n}`) ou un dossier ne sont pas suivis
  f('src/core/agent.ts', "const g = new URL('../lanceur/gardien.ts', import.meta.url);\nconst p = new URL(`../pages/${'accueil.js'}`, import.meta.url);\nconst d = new URL('../pages/', import.meta.url);\nexport const agent = 5;\n");
  f('src/lanceur/gardien.ts', 'export const gardien = 6;\n');
  f('src/mimir/decisions.ts', 'export const decisions = 7;\n');
  // libres : chargés par personne du noyau ni du code sensible
  f('src/pages/accueil.js', "export const titre = 'Bonjour';\nexport const sousTitre = 'Bienvenue';\n");
  f('textes/aide.md', '# Aide\n');
  f('.git/config', '[core]\n');
  f('node_modules/paquet/index.js', 'module.exports = 1;\n');
  return r;
}
const brouillonsSurDisque = (home: string) => { try { return readdirSync(join(home, DOSSIER_BROUILLONS)); } catch { return []; } };

test('la différence est complète, numérotée, et refait les deux textes', () => {
  const avant = Array.from({ length: 3000 }, (_, i) => `ligne ${i + 1}`);
  const apres = [...avant];
  apres[9] = 'ligne 10 changée';
  apres[1499] = 'ligne 1500 changée';
  apres.splice(2000, 0, 'ligne insérée');
  apres.splice(2501, 1);
  const a = avant.join('\n'), b = apres.join('\n');
  const d = difference(a, b);
  assert.equal(texteApres(d), b);
  assert.equal(texteAvant(d), a);
  assert.deepEqual(compteDifference(d), { retirees: 3, ajoutees: 3 });
  assert.deepEqual(d.find((l) => l.genre === '-' && l.texte === 'ligne 10'), { genre: '-', avant: 10, texte: 'ligne 10' });
  assert.deepEqual(d.find((l) => l.genre === '+' && l.texte === 'ligne 10 changée'), { genre: '+', apres: 10, texte: 'ligne 10 changée' });
  assert.deepEqual(d.find((l) => l.texte === 'ligne insérée'), { genre: '+', apres: 2001, texte: 'ligne insérée' });
  // le texte à lire : une ligne par ligne, toutes, rien coupé
  const t = texteDifference(d);
  assert.equal(t.split('\n').length, d.length);
  assert.ok(d.length >= 3003);
  assert.match(t, /^ *10 +− ligne 10$/m);
  assert.match(t, /^ +10 \+ ligne 10 changée$/m);
  assert.ok(!/non montr|tronqu|…/.test(t));
});

test('la différence à lire montre ce qui ne se voit pas : retour chariot isolé, sens d\'écriture, contrôles ; fins de ligne changées', () => {
  const avant = 'const role = "membre";\nfin', apres = 'const role = "membre\u202E \u2066";\r// note\u0007\nfin';
  const d = difference(avant, apres);
  assert.equal(texteApres(d), apres);
  const t = texteDifference(d);
  for (const c of ['\u202E', '\u2066', '\r', '\u0007']) assert.ok(!t.includes(c), JSON.stringify(c));
  assert.match(t, /U\+202E/);
  assert.match(t, /U\+2066/);
  assert.match(t, /U\+000D/);
  // des lettres de toutes les langues restent telles quelles
  assert.ok(texteDifference(difference('', 'مرحبا — Habari — नमस्ते')).includes('مرحبا — Habari — नमस्ते'));
  // seules les fins de ligne changent : aucune ligne ne diffère, mais c'est dit
  assert.deepEqual(compteDifference(difference('a\r\nb\r\n', 'a\nb\n')), { retirees: 0, ajoutees: 0 });
  assert.equal(finsDeLigneChangees('a\r\nb\r\n', 'a\nb\n'), true);
  assert.equal(finsDeLigneChangees('a\nb\n', 'a\nc\nd\n'), false);
  assert.equal(finsDeLigneChangees('a\r\nb', 'a\r\nc\r\nd'), false);
});

test('fichier réécrit en entier : ce qui disparaît est montré, en entier, même très long', () => {
  const a = Array.from({ length: 5000 }, (_, i) => `ancien ${i}`).join('\r\n');
  const b = Array.from({ length: 5000 }, (_, i) => `nouveau ${i}`).join('\n');
  const d = difference(a, b);
  assert.deepEqual(compteDifference(d), { retirees: 5000, ajoutees: 5000 });
  assert.equal(texteApres(d), b);
  assert.equal(texteAvant(d), a.replace(/\r\n/g, '\n'));
  assert.equal(texteDifference(d).split('\n').length, 10_000);
});

test('fermeture : suit les import() à la demande (self.ts → builtin.ts) et retrouve les fichiers nommés par la relecture', () => {
  const lire = lecteurDisque(RACINE_APPLI);
  const self = lire('src/tools/self.ts')!;
  // builtin.ts n'est chargé par self.ts QUE par un import() à la demande
  assert.ok(!/from\s*['"]\.\/builtin\.ts['"]/.test(self));
  assert.ok(importsRelatifs(self).includes('./builtin.ts'));
  assert.ok(fermeture(['src/tools/self.ts'], lire).has('src/tools/builtin.ts'));
  // depuis le noyau seul : les fichiers ni noyau ni sensibles que la relecture de l'étude a comptés
  const duNoyau = fermeture(fichiersNoyau(RACINE_APPLI), lire);
  const nommes = ['src/core/genre.ts', 'src/cron/cron.ts', 'src/cron/reminders.ts', 'src/hlidskjalf/deep.ts', 'src/hlidskjalf/discover.ts',
    'src/hlidskjalf/identify.ts', 'src/hlidskjalf/inventory.ts', 'src/hlidskjalf/vendors.ts', 'src/langue/pas-entraine.ts', 'src/langue/tables.ts',
    'src/machines/access.ts', 'src/machines/admin.ts', 'src/muninn/fulltext.ts', 'src/muninn/migrate.ts', 'src/muninn/tables.ts',
    'src/muninn/vecteurs-ram.ts', 'src/net/etat-internet.ts', 'src/net/fetch-propre.ts', 'src/prive.ts', 'src/prive-migration.ts',
    'src/providers/journal.ts', 'src/reglages-note.ts', 'src/research/fetch.ts', 'src/scripts/guard.ts', 'src/undo.ts', 'src/yggdrasil/skills.ts'];
  for (const n of nommes) if (existsSync(join(RACINE_APPLI, n))) assert.ok(duNoyau.has(process.platform === 'linux' ? n : n.toLowerCase()), n);
});

test('fermeture : un import sur plusieurs lignes, avec une apostrophe ou un « ; » dans un commentaire, est lu', () => {
  const t = "import {\n  a, // l'aide ; la suite\n  b,\n} from './x.ts';\nexport {\n  c, /* d'abord */\n} from '../y.ts';\n";
  assert.deepEqual(importsRelatifs(t).sort(), ['../y.ts', './x.ts']);
});

test('fermeture sur le vrai code : ce que le code sensible lance par son chemin (processus, Worker, interface) est gardé', () => {
  const g = fichiersGardes(RACINE_APPLI);
  const k = (n: string) => process.platform === 'linux' ? n : n.toLowerCase();
  for (const n of ['src/valhalla/hringhorni/gardien.ts', 'src/valhalla/hringhorni/repartiteur.ts', 'src/valhalla/archytas/bacasable-worker.ts', 'src/web/ui.html'])
    if (existsSync(join(RACINE_APPLI, n))) assert.ok(g.tous.has(k(n)), n);
});

test('fermeture sur un code d\'essai : statique, à la demande, en chaîne ; les fichiers libres restent libres', () => {
  const r = codeEssai();
  const g = fichiersGardes(r);
  for (const f of ['src/aide/statique.ts', 'src/aide/demande.ts', 'src/aide/profond.ts', 'src/tools/builtin.ts', 'src/scripts/garde.ts']) assert.ok(g.tous.has(f), f);
  assert.deepEqual(g.charges, ['src/aide/demande.ts', 'src/aide/profond.ts', 'src/aide/statique.ts', 'src/lanceur/gardien.ts', 'src/scripts/garde.ts']);
  assert.ok(g.tous.has('src/lanceur/gardien.ts'));
  assert.ok(!g.tous.has('src/pages/accueil.js'));
  assert.ok(!g.tous.has('textes/aide.md'));
});

test('un membre : refus du noyau, du code sensible, de ce qu\'ils chargent (même à la demande), et hors du code', () => {
  const r = codeEssai(), home = tmp('odin-home-');
  const demander = (fichier: string) => creerBrouillon(home, { fichier, apres: 'export const x = 1;\n', demandePar: MEMBRE, demande: 'change ce fichier' }, { racine: r });
  const refus: Array<[string, RegExp]> = [
    ['src/heimdall/policy.ts', /noyau/],
    ['src/vault.ts', /noyau/],
    ['src/tools/outil.ts', /code sensible/],
    ['src/core/agent.ts', /code sensible/],
    ['src/aide/demande.ts', /chargé par le noyau ou le code sensible/],
    ['src/aide/profond.ts', /chargé par le noyau ou le code sensible/],
    ['src/aide/statique.ts', /chargé par le noyau ou le code sensible/],
    ['src/scripts/garde.ts', /chargé par le noyau ou le code sensible/],
    ['../dehors.txt', /Hors du code/],
    [join(tmpdir(), 'ailleurs.ts'), /Hors du code/],
    ['.git/config', /interdit/],
    ['node_modules/paquet/index.js', /interdit/],
    ['src/pages/nouveau.js', /n'existe pas/],
    // un autre nom pour le même fichier (flux NTFS, nom court, point ou espace final, caractère de contrôle)
    ['src/heimdall:$I30:$INDEX_ALLOCATION/policy.ts', /Nom refusé/],
    ['src/core:$I30:$INDEX_ALLOCATION/agent.ts', /Nom refusé/],
    ['src/aide/demande.ts::$DATA', /Nom refusé/],
    ['SRC/Vault.TS::$data', /Nom refusé/],
    ['src/vault.ts.', /Nom refusé/],
    ['src/vault.ts ', /Nom refusé/],
    ['src/heimdall./policy.ts', /Nom refusé/],
    ['src/pages/accueil.js\u0000', /Nom refusé/],
    ['src/pages/accueil.js::$DATA', /Nom refusé/],
  ];
  // le nom court d'un fichier du noyau (là où le système en fabrique, comme souvent sur le disque de Windows)
  for (const c of ['src/mimir/DECISI~1.TS', 'src/mimir/decisi~1.ts']) if (existsSync(join(r, c))) refus.push([c, /Nom refusé/]);
  for (const [f, raison] of refus) { const x = demander(f); assert.equal(x.ok, false, f); if (!x.ok) assert.match(x.raison, raison, f); }
  assert.deepEqual(brouillonsSurDisque(home), []);
  // un fichier libre : accepté pour un membre aussi
  assert.equal(demander('src/pages/accueil.js').ok, true);
});

test('un membre, sur le vrai code d\'Odin : un fichier chargé par le noyau est refusé (calculé à la demande)', () => {
  const home = tmp('odin-home-');
  const x = creerBrouillon(home, { fichier: 'src/scripts/guard.ts', apres: 'export {};\n', demandePar: MEMBRE, demande: 'simplifie' });
  assert.equal(x.ok, false);
  if (!x.ok) assert.match(x.raison, /chargé par le noyau ou le code sensible/);
  assert.deepEqual(brouillonsSurDisque(home), []);
});

test('le propriétaire : un fichier hors noyau est accepté en brouillon ; empreintes ; rien écrit dans le code ; chiffré', () => {
  const r = codeEssai(), home = tmp('odin-home-');
  const avant = readFileSync(join(r, 'src/pages/accueil.js'), 'utf8');
  const apres = "export const titre = 'Salut';\nexport const sousTitre = 'Bienvenue';\n";
  const x = creerBrouillon(home, { fichier: 'src/pages/accueil.js', apres, demandePar: PROPRIO, demande: 'dis « Salut »' }, { racine: r });
  assert.equal(x.ok, true);
  if (!x.ok) return;
  const b = x.brouillon;
  assert.equal(b.fichier, 'src/pages/accueil.js');
  assert.equal(b.empreinteAvant, sha(avant));
  assert.equal(b.empreinteApres, sha(apres));
  assert.equal(b.apres, apres);
  assert.deepEqual(b.demandePar, PROPRIO);
  assert.deepEqual(b.demande, { texte: 'dis « Salut »', nonVerifie: true });
  assert.equal(b.etat, 'proposé');
  assert.equal(readFileSync(join(r, 'src/pages/accueil.js'), 'utf8'), avant);
  // rangé hors du code, chiffré : le texte n'y est pas en clair
  const brut = readFileSync(join(home, DOSSIER_BROUILLONS, `${b.id}.json`), 'utf8');
  assert.ok(!brut.includes('Salut'));
  assert.deepEqual(lireBrouillon(home, b.id), b);
  assert.equal(lireBrouillon(home, '../x'), undefined);
  // la différence de ce brouillon, complète
  assert.deepEqual(compteDifference(difference(avant, b.apres)), { retirees: 1, ajoutees: 1 });
  // un autre nom pour le même fichier : refusé pour lui aussi (le brouillon garde toujours le vrai nom)
  for (const f of ['src/pages/accueil.js::$DATA', 'src/vault.ts::$DATA', 'src/heimdall:$I30:$INDEX_ALLOCATION/policy.ts']) {
    const z = creerBrouillon(home, { fichier: f, apres: 'export {};\n', demandePar: PROPRIO, demande: '' }, { racine: r });
    assert.equal(z.ok, false, f);
    if (!z.ok) assert.match(z.raison, /Nom refusé/, f);
  }
  // le propriétaire peut aussi faire un brouillon du noyau (il le verra ; rien n'est appliqué ici)
  assert.equal(creerBrouillon(home, { fichier: 'src/heimdall/policy.ts', apres: 'export const p = 2;\n', demandePar: PROPRIO, demande: '' }, { racine: r }).ok, true);
});

test('le fichier a changé depuis le brouillon : « périmé » ; refuser ; rien n\'est écrit dans le code', () => {
  const r = codeEssai(), home = tmp('odin-home-');
  const x = creerBrouillon(home, { fichier: 'src/pages/accueil.js', apres: 'export const titre = 1;\n', demandePar: MEMBRE, demande: 'change le titre' }, { racine: r });
  assert.ok(x.ok);
  if (!x.ok) return;
  assert.equal(revoirBrouillon(home, x.brouillon.id, r)?.etat, 'proposé');
  writeFileSync(join(r, 'src/pages/accueil.js'), "export const titre = 'Autre';\n");
  const p = revoirBrouillon(home, x.brouillon.id, r);
  assert.equal(p?.etat, 'périmé');
  assert.equal(lireBrouillon(home, x.brouillon.id)?.etat, 'périmé');
  assert.equal(readFileSync(join(r, 'src/pages/accueil.js'), 'utf8'), "export const titre = 'Autre';\n");
  const y = creerBrouillon(home, { fichier: 'textes/aide.md', apres: '# Aide !\n', demandePar: MEMBRE, demande: '' }, { racine: r });
  assert.ok(y.ok);
  if (!y.ok) return;
  assert.equal(refuserBrouillon(home, y.brouillon.id, 'non merci')?.etat, 'refusé');
  assert.equal(revoirBrouillon(home, y.brouillon.id, r)?.etat, 'refusé');
  assert.equal(readFileSync(join(r, 'textes/aide.md'), 'utf8'), '# Aide\n');
});

test('les brouillons ne sont jamais rangés dans le dossier du code', () => {
  const r = codeEssai();
  for (const home of [r, join(r, 'src'), join(r, 'textes')]) {
    const x = creerBrouillon(home, { fichier: 'textes/aide.md', apres: '# Aide !\n', demandePar: PROPRIO, demande: '' }, { racine: r });
    assert.equal(x.ok, false, home);
    if (!x.ok) assert.match(x.raison, /dossier du code/, home);
    assert.equal(existsSync(join(home, DOSSIER_BROUILLONS)), false, home);
  }
});

test('plafonds par personne : en attente et sur 24 heures', () => {
  const r = codeEssai(), home = tmp('odin-home-');
  const t0 = Date.parse('2026-01-05T10:00:00Z');
  const o = { racine: r, plafonds: { enAttente: 2, parJour: 3 } };
  const demander = (qui: Demandeur, maintenant: number) => creerBrouillon(home, { fichier: 'textes/aide.md', apres: '# Aide\n\nUne ligne.\n', demandePar: qui, demande: 'ajoute une ligne' }, { ...o, maintenant });
  const a = demander(MEMBRE, t0), b = demander(MEMBRE, t0 + 1);
  assert.ok(a.ok && b.ok);
  const c = demander(MEMBRE, t0 + 2);
  assert.equal(c.ok, false);
  if (!c.ok) assert.match(c.raison, /en attente/);
  assert.equal(demander(AUTRE_MEMBRE, t0 + 3).ok, true);
  if (a.ok) refuserBrouillon(home, a.brouillon.id);
  assert.equal(demander(MEMBRE, t0 + 4).ok, true);
  if (b.ok) refuserBrouillon(home, b.brouillon.id);
  const d = demander(MEMBRE, t0 + 5);
  assert.equal(d.ok, false);
  if (!d.ok) assert.match(d.raison, /24 heures/);
  assert.equal(demander(MEMBRE, t0 + 25 * 3600_000).ok, true);
  // les plafonds par défaut existent et sont bas
  assert.ok(PLAFONDS.enAttente > 0 && PLAFONDS.enAttente <= 10 && PLAFONDS.parJour <= 50);
});

test('jamais un secret ni un texte démesuré dans un brouillon', () => {
  const r = codeEssai(), home = tmp('odin-home-');
  const demander = (apres: string, demande = 'change') => creerBrouillon(home, { fichier: 'src/pages/accueil.js', apres, demandePar: PROPRIO, demande }, { racine: r });
  const jeton = 'gh' + 'p_' + 'a1B2'.repeat(9);
  for (const x of [demander(`export const cle = '${jeton}';\n`), demander('// password = Zebre-Orange-42\n'), demander('export {};\n', `mets ce jeton : ${jeton}`)]) {
    assert.equal(x.ok, false);
    if (!x.ok) assert.match(x.raison, /clé, un mot de passe ou un jeton/);
  }
  const long = demander('x'.repeat(TAILLE_MAX + 1));
  assert.equal(long.ok, false);
  if (!long.ok) assert.match(long.raison, /trop long/);
  // le « pourquoi » d'un refus passe aussi par le masquage
  const ok = creerBrouillon(home, { fichier: 'src/pages/accueil.js', apres: 'export {};\n', demandePar: PROPRIO, demande: '' }, { racine: r });
  assert.ok(ok.ok);
  if (ok.ok) {
    const refuse = refuserBrouillon(home, ok.brouillon.id, `non : ${jeton}`);
    assert.equal(refuse?.etat, 'refusé');
    assert.ok(!refuse?.change?.pourquoi.includes(jeton));
    assert.ok(!lireBrouillon(home, ok.brouillon.id)?.change?.pourquoi.includes(jeton));
    for (const f of brouillonsSurDisque(home)) rmSync(join(home, DOSSIER_BROUILLONS, f));
  }
  const qui = creerBrouillon(home, { fichier: 'src/pages/accueil.js', apres: 'export {};\n', demandePar: { role: 'invite', nom: 'Lou', canal: 'web' } as unknown as Demandeur, demande: '' }, { racine: r });
  assert.equal(qui.ok, false);
  assert.deepEqual(listerBrouillons(home), []);
  assert.deepEqual(brouillonsSurDisque(home), []);
});
