// Mathésis — lot 1, le socle : réglages (interrupteur, pause, heures), budgets qui ARRÊTENT vraiment le travail,
// liste de curiosité (fusion, confiés en tête, interdits), empreintes, journal, magasin chiffré.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appelPayantPermis, dansLesHeures, elargit, garde, normaliserReglages, reglagesParDefaut } from '../src/valhalla/mathesis/reglages.ts';
import { Budget, jourDe } from '../src/valhalla/mathesis/budget.ts';
import { MagasinFichiers, MagasinMemoire, DEF_MATHESIS, nomBaseMathesis, brancherMathesis, oublierBranchementsMathesis } from '../src/valhalla/mathesis/magasin.ts';
import { Curiosite, TAILLE_MAX } from '../src/valhalla/mathesis/curiosite.ts';
import { RegistreInterdits, siteInterdit, sujetInterdit, dossierInterdit, interditsVides } from '../src/valhalla/mathesis/interdits.ts';
import { Empreintes } from '../src/valhalla/mathesis/empreintes.ts';
import { Journal } from '../src/valhalla/mathesis/journal.ts';
import { lesMigrables } from '../src/valhalla/base/index.ts';

const NUIT = new Date(2026, 10, 17, 23, 30).getTime();
const JOUR = new Date(2026, 10, 17, 14, 0).getTime();
function tmp(): string { return mkdtempSync(join(tmpdir(), 'mathesis-socle-')); }

// ------------------------------------------------------------------ Réglages
test('défaut : allumé, vitesse douce, léger toute la journée, lourd la nuit, aucun dossier ouvert, aucun appel payant', () => {
  const r = reglagesParDefaut();
  assert.equal(r.actif, true);
  assert.equal(r.vitesse, 'douce');
  assert.equal(r.budgets.appelsPayants, 0);
  assert.equal(r.modeleEnLigne, false);
  assert.deepEqual(r.dossiers, []);
  assert.equal(dansLesHeures(r.heures, NUIT), true);
  assert.equal(dansLesHeures(r.heures, JOUR), true, 'le travail léger est permis en journée');
  assert.equal(dansLesHeures(r.heuresLourd, NUIT), true);
  assert.equal(dansLesHeures(r.heuresLourd, JOUR), false, 'le travail lourd reste la nuit');
  assert.equal(appelPayantPermis(r, 10), false);
  assert.equal(elargit([{ de: 22, a: 7 }], [{ de: 0, a: 24 }]), true);
  assert.equal(elargit([{ de: 0, a: 24 }], [{ de: 22, a: 7 }]), false);
  assert.deepEqual(normaliserReglages({ dossiers: ['relatif/x', join(tmpdir(), 'a'), join(tmpdir(), 'a'), 'C:\0x'] }).dossiers, [join(tmpdir(), 'a')]);
});

test('normaliser : un budget payant sans réglage explicite reste à 0, les valeurs folles sont bornées', () => {
  const r = normaliserReglages({ budgets: { appelsPayants: 50, recherches: 1e12, pages: -4 }, robot: { delaiSiteMs: 1, profondeurMax: 99 } });
  assert.equal(r.budgets.appelsPayants, 0);
  assert.equal(r.budgets.recherches, 2000);
  assert.equal(r.budgets.pages, 0);
  assert.equal(r.robot.delaiSiteMs, 2000);
  assert.equal(r.robot.profondeurMax, 4);
  const p = normaliserReglages({ modeleEnLigne: true, budgets: { appelsPayants: 3 } });
  assert.equal(p.budgets.appelsPayants, 3);
  assert.equal(appelPayantPermis(p, 3), true);
  assert.equal(appelPayantPermis(p, 0), false);
  assert.equal(normaliserReglages({ actif: false }).actif, false);
  assert.equal(normaliserReglages('n importe quoi').actif, true);
});

test('garde : interrupteur, pause, heures, occupé, abandon, privé — chacun arrête', () => {
  const r = reglagesParDefaut();
  assert.equal(garde({ reglages: r, maintenant: NUIT }), undefined);
  assert.equal(garde({ reglages: { ...r, actif: false }, maintenant: NUIT }), 'eteint');
  assert.equal(garde({ reglages: { ...r, pause: true }, maintenant: NUIT }), 'pause');
  assert.equal(garde({ reglages: r, maintenant: JOUR }), undefined, 'léger : permis en journée');
  assert.equal(garde({ reglages: r, maintenant: JOUR, lourd: true }), 'hors_heures', 'lourd : la nuit seulement');
  assert.equal(garde({ reglages: r, maintenant: NUIT, lourd: true }), undefined);
  assert.equal(garde({ reglages: { ...r, heures: [{ de: 22, a: 7 }] }, maintenant: JOUR }), 'hors_heures');
  assert.equal(garde({ reglages: r, maintenant: NUIT, occupe: () => true }), 'occupe');
  assert.equal(garde({ reglages: r, maintenant: NUIT, occupe: () => { throw new Error('x'); } }), 'occupe');
  const ac = new AbortController(); ac.abort();
  assert.equal(garde({ reglages: r, maintenant: NUIT, signal: ac.signal }), 'abandon');
  assert.equal(garde({ reglages: r, maintenant: NUIT, prive: () => true }), 'prive');
  // L'interrupteur passe avant tout le reste.
  assert.equal(garde({ reglages: { ...r, actif: false }, maintenant: NUIT, occupe: () => true }), 'eteint');
});

// ------------------------------------------------------------------ Budget
test('budget : essayer de dépasser est refusé, rien n\'est consommé, et le compteur survit au redémarrage', () => {
  const dir = tmp();
  try {
    let now = NUIT;
    const limites = () => reglagesParDefaut().budgets;
    const b = new Budget(new MagasinFichiers(dir, dir), limites, () => now);
    for (let i = 0; i < 20; i++) assert.equal(b.prendre('recherches'), true, `recherche ${i + 1}`);
    assert.equal(b.prendre('recherches'), false, 'la 21e recherche doit être refusée');
    assert.equal(b.restant('recherches'), 0);
    assert.equal(b.prendre('pages', reglagesParDefaut().budgets.pages - 2), true);
    assert.equal(b.prendre('pages', 5), false, 'dépassement par paquet refusé');
    assert.equal(b.restant('pages'), 2, 'un refus ne consomme rien');
    assert.equal(b.prendre('appelsPayants'), false, 'zéro appel payant par défaut');
    assert.equal(b.prendre('pages', -3), false);
    assert.equal(b.prendre('pages', Number.NaN), false);
    b.noter('octets', 10 ** 12); // une dépense énorme notée reste bornée à la limite
    assert.equal(b.restant('octets'), 0);
    // Redémarrage : un NOUVEAU magasin relu depuis le disque garde la dépense du jour.
    const b2 = new Budget(new MagasinFichiers(dir, dir), limites, () => now);
    assert.equal(b2.prendre('recherches'), false);
    assert.equal(b2.restant('pages'), 2);
    // Le lendemain, tout repart.
    now += 24 * 3_600_000;
    assert.equal(b2.prendre('recherches'), true);
    assert.equal(jourDe(now), '2026-11-18');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('budget : plafond de demandes par site et par jour', () => {
  const b = new Budget(new MagasinMemoire(), () => reglagesParDefaut().budgets, () => NUIT);
  for (let i = 0; i < 3; i++) assert.equal(b.prendreSite('exemple.fr', 3), true);
  assert.equal(b.prendreSite('exemple.fr', 3), false);
  assert.equal(b.prendreSite('autre.fr', 3), true);
  assert.equal(b.demandesSite('exemple.fr'), 3);
});

// ------------------------------------------------------------------ Interdits
test('interdits : sujet (mot entier), site et sous-domaines, dossier', () => {
  const i = { ...interditsVides(), sujets: ['chat'], sites: ['https://www.Interdit.fr/x'], dossiers: [join(tmpdir(), 'prive')] };
  assert.equal(sujetInterdit(i, 'Le Chat de la voisine'), true);
  assert.equal(sujetInterdit(i, 'un achat en ligne'), false);
  const reg = new RegistreInterdits(new MagasinMemoire());
  reg.interdire('sites', 'https://www.Interdit.fr/x');
  const r = reg.lire();
  assert.deepEqual(r.sites, ['interdit.fr']);
  assert.equal(siteInterdit(r, 'https://interdit.fr/page'), true);
  assert.equal(siteInterdit(r, 'https://blog.interdit.fr/page'), true);
  assert.equal(siteInterdit(r, 'https://pasinterdit.fr/page'), false);
  assert.equal(siteInterdit(r, 'pas une adresse'), true);
  assert.equal(dossierInterdit(i, join(tmpdir(), 'prive', 'a.txt')), true);
  assert.equal(dossierInterdit(i, join(tmpdir(), 'prive-pas', 'a.txt')), false);
  assert.equal(siteInterdit(reg.permettre('sites', 'interdit.fr'), 'https://interdit.fr/'), false);
});

// ------------------------------------------------------------------ Curiosité
test('curiosité : un manque entre avec sa raison, un doublon fusionne et monte, le confié passe en tête', () => {
  const mag = new MagasinMemoire();
  const reg = new RegistreInterdits(mag);
  const c = new Curiosite(mag, () => NUIT, () => reg.lire());
  const a = c.signaler({ sujet: 'Hauteur du Mont Blanc', origine: 'question_sans_reponse' })!;
  assert.equal(a.raison, 'une question est restée sans réponse sûre');
  assert.equal(a.priorite, 70);
  c.signaler({ sujet: 'éruption du Piton de la Fournaise', origine: 'duel_perdu' });
  const fus = c.signaler({ sujet: 'hauteur du mont blanc', origine: 'sujet_recurrent' })!;
  assert.equal(fus.id, a.id);
  assert.equal(fus.vu, 2);
  assert.ok(fus.priorite > 70);
  assert.equal(c.liste().length, 2);
  const conf = c.confier('recette du rougail saucisse')!;
  assert.equal(c.prochains(5)[0].id, conf.id, 'le manque confié passe en tête');
  // Une adresse confiée devient un manque de genre « page ».
  const p = c.confier('https://exemple.fr/article https://autre.fr/b')!;
  assert.equal(p.genre, 'page');
  assert.deepEqual(p.adresses, ['https://exemple.fr/article', 'https://autre.fr/b']);
  assert.equal(c.prochains(5).slice(0, 2).every((m) => m.confie), true);
});

test('curiosité : sujet interdit refusé, site interdit filtré, genres des passages suivants mis de côté', () => {
  const mag = new MagasinMemoire();
  const reg = new RegistreInterdits(mag);
  reg.interdire('sujets', 'politique');
  reg.interdire('sites', 'interdit.fr');
  const c = new Curiosite(mag, () => NUIT, () => reg.lire());
  assert.equal(c.signaler({ sujet: 'la politique locale', origine: 'confie' }), undefined, 'confier ne lève pas un interdit');
  assert.equal(c.confier('https://interdit.fr/x'), undefined);
  const v = c.signaler({ sujet: 'https://video.exemple.fr/v.mp4', origine: 'confie', genre: 'video' })!;
  assert.equal(v.etat, 'pas_encore_traite');
  assert.equal(c.prochains(10).find((m) => m.id === v.id), undefined);
  assert.equal(c.signaler({ sujet: '   ', origine: 'a_verifier' }), undefined);
});

test('curiosité : réessai différé après un essai, et liste bornée', () => {
  let now = NUIT;
  const mag = new MagasinMemoire();
  const c = new Curiosite(mag, () => now, () => interditsVides());
  const m = c.signaler({ sujet: 'sujet A', origine: 'perime' })!;
  c.noter(m.id, 'echec', 'aucune source');
  assert.equal(c.prochains(5).length, 0, 'pas réessayé aussitôt');
  now += 7 * 3_600_000;
  assert.equal(c.prochains(5).length, 1, 'réessayé après six heures');
  for (let i = 0; i < TAILLE_MAX + 50; i++) c.signaler({ sujet: `sujet ${i}`, origine: 'nouveaute_appli' });
  assert.equal(c.liste().length, TAILLE_MAX);
});

// ------------------------------------------------------------------ Empreintes et journal
test('empreintes : déjà analysé ; journal : quoi, pourquoi, source, date, retenu, supprimé, effaçable', () => {
  const mag = new MagasinMemoire();
  const e = new Empreintes(mag, () => NUIT);
  assert.equal(e.dejaAnalyse('abc'), false);
  e.marquer('abc', 'page https://exemple.fr');
  assert.equal(e.dejaAnalyse('abc'), true);
  const j = new Journal(mag, () => NUIT);
  const x = j.noter({ genre: 'retenu', quoi: 'a retenu 1 fait', pourquoi: 'à confirmer', source: 'web:exemple.fr', retenu: [{ texte: 'fait', niveau: 'confirmé' }], supprime: ['copie de travail'] });
  const l = j.lire();
  assert.equal(l[0].at, NUIT);
  assert.equal(l[0].source, 'web:exemple.fr');
  assert.deepEqual(l[0].supprime, ['copie de travail']);
  assert.equal(j.effacer(x.id), true);
  assert.equal(j.lire().length, 0);
});

// ------------------------------------------------------------------ Magasin
test('magasin en fichiers : chiffré sur le disque, relu par une nouvelle instance, fichier abîmé = défaut', () => {
  const dir = tmp();
  try {
    const m = new MagasinFichiers(dir, dir);
    m.ecrire('curiosite', [{ sujet: 'secret-de-famille-xyz' }]);
    const brut = readFileSync(join(dir, 'donnees', 'curiosite.odc'), 'utf8');
    assert.ok(brut.startsWith('odc1:'));
    assert.equal(brut.includes('secret-de-famille-xyz'), false, 'rien en clair sur le disque');
    assert.deepEqual(new MagasinFichiers(dir, dir).lire('curiosite', []), [{ sujet: 'secret-de-famille-xyz' }]);
    assert.equal(readdirSync(join(dir, 'donnees')).some((f) => f.endsWith('.tmp')), false, 'aucun fichier temporaire laissé');
    writeFileSync(join(dir, 'donnees', 'journal.odc'), 'abîmé');
    assert.deepEqual(new MagasinFichiers(dir, dir).lire('journal', ['défaut']), ['défaut']);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('base : MATHESIS_ODIN, vues sans contenu, inscription migrable', () => {
  assert.equal(nomBaseMathesis(), 'MATHESIS_ODIN');
  assert.match(DEF_MATHESIS.migrations[0].sql, /GRANT SELECT ON v_compteurs TO odin_lecture/);
  assert.doesNotMatch(DEF_MATHESIS.migrations[0].sql, /GRANT SELECT ON documents/);
  oublierBranchementsMathesis();
  brancherMathesis(tmp());
  assert.ok(lesMigrables().some((m) => m.id === 'mathesis'));
});
