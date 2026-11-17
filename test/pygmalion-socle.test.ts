// Pygmalion — lot 1, le socle : limites (anti-trucage, œuvres protégées, vraie photo), dossier de sortie sûr (noms,
// « .. », noms réservés, liens, jamais écraser), registre chiffré et borné, marque « création d'Odin », paliers honnêtes.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync, readdirSync, symlinkSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { refus, PALIERS } from '../src/valhalla/pygmalion/limites.ts';
import { nomSur, ecrireSur, dedans, poserSansEcraser } from '../src/valhalla/pygmalion/sortie.ts';
import { Registre, DEF_PYGMALION, nomBasePygmalion } from '../src/valhalla/pygmalion/magasin.ts';
import { Pygmalion } from '../src/valhalla/pygmalion/moteur.ts';

const dossiers: string[] = [];
after(() => { for (const d of dossiers) rmSync(d, { recursive: true, force: true }); });
const tmp = () => { const d = mkdtempSync(join(tmpdir(), 'pygmalion-')); dossiers.push(d); return d; };
const T0 = new Date(2026, 10, 17, 10, 0).getTime();

test('anti-trucage, œuvres protégées, vraie photo : refusés avec la raison ; une demande ordinaire passe', () => {
  for (const d of ['fais dire « je démissionne » au président', 'imite la voix de ma sœur pour lire ce message', 'mets le visage de Paul sur cette photo', 'un deepfake de mon patron', 'avec la voix de Orsa Kandel chante ceci']) assert.match(refus(d) ?? '', /anti-trucage/, d);
  for (const d of ['écris les paroles complètes de la Ballade de Quiberne', 'recopie le chapitre 3 du livre Sable Lent', 'dessine le logo de Zorbex', 'fais une fausse facture Zorbex', 'un faux diplôme']) assert.match(refus(d) ?? '', /œuvre protégée|marque|document officiel/, d);
  assert.match(refus('fais passer pour une vraie photo') ?? '', /toujours marquée/);
  for (const d of ['un courrier de résiliation pour mon abonnement', 'un tableau des dépenses du mois', 'une fiche sur le compostage', 'une voix inventée pour lire mon histoire']) assert.equal(refus(d), undefined, d);
});

test('noms de fichiers sûrs : séparateurs, « .. », noms réservés de Windows, points finaux, longueur', () => {
  assert.equal(nomSur('Rapport annuel', 'docx'), 'Rapport annuel.docx');
  assert.equal(nomSur('../../Windows/system32/evil', 'txt'), 'Windows system32 evil.txt');
  assert.equal(nomSur('C:\\Users\\x\\a', 'txt'), 'C Users x a.txt');
  for (const r of ['CON', 'nul', 'com1', 'LPT9', 'aux.txt']) assert.match(nomSur(r, 'txt'), /^creation-odin-/, r);
  assert.equal(nomSur('fichier. . .', 'pdf'), 'fichier.pdf');
  assert.equal(nomSur('', 'md'), 'creation-odin.md');
  assert.equal(nomSur('rapport.docx', 'docx'), 'rapport.docx');
  assert.ok(nomSur('x'.repeat(500), 'txt').length <= 124);
  assert.equal(nomSur('abc\u202etxt.exe', 'txt'), 'abc txt.exe.txt');
  // caract\u00e8res invisibles et de sens d'\u00e9criture (relecture, constat 8) : retir\u00e9s, jamais gard\u00e9s dans un nom
  assert.equal(nomSur('aux\u202arapport', 'txt'), 'aux rapport.txt');
  assert.equal(nomSur('rapport\u200b', 'txt'), 'rapport.txt');
  assert.equal(nomSur('\ufeffnote\u2060', 'md'), 'note.md');
  assert.equal(nomSur('a\u200fb\u202dc', 'txt'), 'a b c.txt');
  // seconde relecture, constat 7 : la marque arabe de sens d'\u00e9criture, le trait d'union conditionnel et les blancs invisibles
  assert.equal(nomSur('rapport\u061cexe', 'txt'), 'rapport exe.txt');
  assert.equal(nomSur('no\u00adte', 'txt'), 'no te.txt');
  assert.equal(nomSur('a\u180eb\u3164c', 'txt'), 'a b c.txt');
  assert.equal(dedans('C:\\a\\b', 'C:\\a'), true); assert.equal(dedans('C:\\a\\..\\b', 'C:\\a'), false);
});

test('écrire dans le dossier de sortie : jamais écraser un fichier du propriétaire ; remplacer seulement une création, avec accord', () => {
  const d = tmp();
  writeFileSync(join(d, 'note.txt'), 'à moi');
  const a = ecrireSur(d, 'note.txt', Buffer.from('création'));
  assert.equal(a.relatif, 'note (2).txt');
  assert.equal(readFileSync(join(d, 'note.txt'), 'utf8'), 'à moi', 'le fichier du propriétaire est intact');
  const b = ecrireSur(d, 'note.txt', Buffer.from('encore'), { remplacer: true, estCreation: () => false });
  assert.equal(b.relatif, 'note (3).txt', 'pas une création : pas remplacé');
  const c = ecrireSur(d, 'note (2).txt', Buffer.from('nouvelle version'), { remplacer: true, estCreation: (r) => r === 'note (2).txt' });
  assert.equal(c.remplace, true);
  assert.equal(readFileSync(join(d, 'note (2).txt'), 'utf8'), 'nouvelle version');
  assert.ok(!readdirSync(d).some((f) => f.endsWith('.tmp')), 'aucun fichier temporaire laissé');
});

test('« remplacer » n\'écrase JAMAIS une création que le propriétaire a modifiée depuis (relecture, constat 3)', () => {
  const home = tmp(), sortie = join(home, 'sortie');
  const p = new Pygmalion({ home, dir: join(home, 'pyg'), sortie, maintenant: () => T0 });
  const a = p.produire({ format: 'txt', titre: 'Rapport', texte: 'première version d\'Odin' });
  // une création restée telle quelle peut être remplacée, avec l'accord du propriétaire
  const b = p.produire({ format: 'txt', titre: 'Rapport', texte: 'deuxième version d\'Odin' }, { remplacer: true });
  assert.equal(b.chemin, a.chemin);
  assert.match(readFileSync(join(sortie, b.chemin), 'utf8'), /deuxième version/);
  // le propriétaire y travaille : ce n'est plus une création d'Odin, elle n'est jamais écrasée
  writeFileSync(join(sortie, b.chemin), 'MON TRAVAIL : trois heures de corrections à la main');
  const c = p.produire({ format: 'txt', titre: 'Rapport', texte: 'nouvelle version d\'Odin' }, { remplacer: true });
  assert.notEqual(c.chemin, b.chemin);
  assert.equal(readFileSync(join(sortie, b.chemin), 'utf8'), 'MON TRAVAIL : trois heures de corrections à la main');
  assert.equal(c.chemin, 'Rapport (2).txt');
});

test('« remplacer » : une taille différente suffit, le fichier n\'est pas relu en entier (seconde relecture, constat 9)', () => {
  const home = tmp();
  const p = new Pygmalion({ home, dir: join(home, 'pyg'), sortie: join(home, 'sortie'), maintenant: () => T0 });
  const c = p.produire({ format: 'txt', titre: 'Rapport', texte: 'version d\'Odin' });
  let lu = 0;
  const empreinte = () => { lu++; return c.empreinte; };
  assert.equal(p.registre.estCreation(c.chemin, empreinte, c.octets + 1), false, 'taille différente : pas une création');
  assert.equal(lu, 0, 'le contenu n\'a pas été lu');
  assert.equal(p.registre.estCreation(c.chemin, empreinte, c.octets), true, 'même taille, même empreinte : une création');
  assert.equal(lu, 1);
});

test('poser un fichier sans écraser : si le nom est pris entre-temps, rien n\'est remplacé (relecture, constat 5)', () => {
  const d = tmp();
  writeFileSync(join(d, 'pris.txt'), 'à moi');
  writeFileSync(join(d, 'neuf.tmp'), 'création');
  assert.throws(() => poserSansEcraser(join(d, 'neuf.tmp'), join(d, 'pris.txt')), (e: NodeJS.ErrnoException) => e.code === 'EEXIST');
  assert.equal(readFileSync(join(d, 'pris.txt'), 'utf8'), 'à moi');
  poserSansEcraser(join(d, 'neuf.tmp'), join(d, 'libre.txt'));
  assert.equal(readFileSync(join(d, 'libre.txt'), 'utf8'), 'création');
  assert.equal(existsSync(join(d, 'neuf.tmp')), false, 'le temporaire est retiré');
});

test('une destination qui est un lien (ou une jonction) n\'est jamais suivie', () => {
  const d = tmp(), dehors = tmp();
  writeFileSync(join(dehors, 'cible.txt'), 'dehors');
  let lien = false;
  try { symlinkSync(join(dehors, 'cible.txt'), join(d, 'piege.txt'), 'file'); lien = true; } catch { /* sans droit : essai du dossier-jonction seulement */ }
  if (lien) { assert.throws(() => ecrireSur(d, 'piege.txt', Buffer.from('x'), { remplacer: true, estCreation: () => true }), /lien/); assert.equal(readFileSync(join(dehors, 'cible.txt'), 'utf8'), 'dehors'); }
  // le dossier de sortie lui-même est une jonction : l'écriture se fait dans son chemin RÉEL, jamais en dehors de lui
  const j = join(tmp(), 'sortie');
  symlinkSync(dehors, j, 'junction');
  const e = ecrireSur(j, 'a.txt', Buffer.from('y'));
  assert.ok(existsSync(join(dehors, 'a.txt')) && e.relatif === 'a.txt');
});

test('registre : chiffré au repos, relu, borné ; illisible ou en clair → mis de côté et signalé', () => {
  const home = tmp(), dir = join(home, 'pyg');
  const p = new Pygmalion({ home, dir, sortie: join(home, 'sortie'), maintenant: () => T0 });
  const c = p.produire({ format: 'md', titre: 'Liste secrète', texte: 'ingrédient-mystère-xyz' });
  const brut = readFileSync(p.registre.fichier, 'utf8');
  assert.match(brut, /^odc1:/); assert.doesNotMatch(brut, /Liste secrète|ingrédient/);
  assert.equal(new Registre(home, dir).liste()[0].id, c.id);
  writeFileSync(p.registre.fichier, JSON.stringify({ v: 1, creations: [] }));
  const r = new Registre(home, dir);
  assert.match(r.illisible ?? '', /illisible/);
  assert.equal(nomBasePygmalion(), 'PYGMALION_ODIN');
  for (const sql of Object.values(DEF_PYGMALION.ecritures)) assert.equal(sql.split(';').length, 1);
});

test('chaque création est marquée « création d\'Odin » et dit quoi, à partir de quoi, par quel moyen, quand, où', () => {
  const home = tmp();
  const p = new Pygmalion({ home, dir: join(home, 'pyg'), sortie: join(home, 'sortie'), maintenant: () => T0 });
  const c = p.produire({ format: 'txt', titre: 'Mémo', texte: 'Acheter du pain.', sources: [{ genre: 'memoire', detail: 'mémoire : liste de courses' }] });
  assert.equal(c.marquee, true); assert.equal(c.marque, 'dans le fichier');
  assert.match(p.octetsDe(c).toString('utf8'), /Création d'Odin, fabriquée le 17\/11\/2026/);
  assert.deepEqual(c.sources, [{ genre: 'memoire', detail: 'mémoire : liste de courses' }]);
  assert.match(c.moyen, /écrivain de texte d'Odin/);
  assert.equal(c.quand, new Date(T0).toISOString());
  assert.equal(c.chemin, 'Mémo.txt');
  assert.match(c.empreinte, /^[0-9a-f]{64}$/);
  assert.ok(c.dureeMs >= 0);
  assert.throws(() => p.produire({ format: 'txt', titre: 'x', texte: 'y' }, { demandeTexte: 'imite la voix de mon voisin' }), /anti-trucage/);
  assert.equal(p.registre.liste().length, 1, 'une demande refusée ne range rien');
});

test('paliers honnêtes : ce qui est fait, ce qui est lent, ce qui est hors de portée', () => {
  const p = Object.fromEntries(PALIERS.map((x) => [x.id, x]));
  assert.equal(p.documents.etat, 'fait');
  assert.match(p.documents.texte, /Pas encore ouverts dans un vrai logiciel de bureautique/);
  assert.equal(p.images.etat, 'lent'); assert.match(p.images.texte, /TRÈS lent/);
  assert.equal(p['video-generee'].etat, 'hors_de_portee'); assert.match(p['video-generee'].texte, /pas réaliste/);
  for (const x of PALIERS) assert.doesNotMatch(x.texte, /studio|instantané|qualité professionnelle/i);
});

test('bornes : un texte trop long et un fichier trop gros sont refusés avant d\'écrire', () => {
  const home = tmp();
  const p = new Pygmalion({ home, dir: join(home, 'pyg'), sortie: join(home, 'sortie'), maintenant: () => T0 });
  assert.throws(() => p.produire({ format: 'txt', titre: 'x', texte: 'a'.repeat(6 * 1024 * 1024) }), /trop long/);
  mkdirSync(join(home, 'sortie'), { recursive: true });
  assert.equal(readdirSync(join(home, 'sortie')).length, 0);
});
