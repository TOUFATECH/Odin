// Essais du CORRECTEUR (Archytas, la fenêtre Script) : chacun aurait attrapé un défaut corrigé. La sécurité
// d'abord. Tout en mémoire, un fichier à la fois, sans service réel.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { creerMoteur, REGLAGES_DEFAUT, type BacASable, type MoteurDeps } from '../src/valhalla/archytas/scripts.ts';
import { EntrepotFichiers } from '../src/valhalla/archytas/base.ts';
import { executerDansVm, creerBacWorker } from '../src/valhalla/archytas/bacasable.ts';
import { archytas } from '../src/valhalla/archytas/module.ts';
import { fauxNavigateur } from './archytas-fixtures.ts';

const tmp = () => mkdtempSync(join(tmpdir(), 'archytas-correctifs-'));
const LIM = { budgetMs: 500, budgetMo: 64, maxAppels: 5, maxBoucles: 100_000 };

// ---------------------------------------------------------------------------------------------------------
// #5 — SÉCURITÉ : un secret dans un message d'erreur ne doit JAMAIS finir en clair dans le journal d'exécutions.
// ---------------------------------------------------------------------------------------------------------
test('erreurMasquee : l\'erreur d\'une exécution est masquée avant d\'être rangée (pas de secret en clair)', async () => {
  const home = tmp();
  try {
    const entrepot = new EntrepotFichiers(home);
    // Un bac qui échoue en renvoyant une erreur contenant des secrets (comme ferait un `throw new Error(secret)`).
    const bac: BacASable = { async executer() { return { ok: false, texte: 'échec : mot de passe: hunter2 et jeton sk-ABCDEFGH12345ZZ' }; }, arreter() { /* rien */ } };
    const deps: MoteurDeps = { entrepot, bac, reglages: () => ({ ...REGLAGES_DEFAUT, codeLibre: true }) };
    const m = creerMoteur(deps);
    await m.creer({ nom: 'script-secret', mission: 'm', description: '', genre: 'code', code: 'throw new Error("x");', declencheurs: [{ genre: 'manuel' }] });
    const r = await m.lancer('script-secret');
    assert.equal(r.ok, false);
    const execs = await entrepot.executions('script-secret');
    assert.equal(execs.length, 1, 'l\'exécution est notée');
    const masque = execs[0].erreurMasquee ?? '';
    assert.doesNotMatch(masque, /hunter2/, 'le mot de passe ne fuite pas dans le journal');
    assert.doesNotMatch(masque, /sk-ABCDEFGH12345ZZ/, 'le jeton ne fuite pas dans le journal');
  } finally { rmSync(home, { recursive: true, force: true }); }
});

// ---------------------------------------------------------------------------------------------------------
// #2/#3 — HONNÊTETÉ : node:vm n'est PAS une prison. On DOCUMENTE l'évasion `constructor.constructor` comme
// limite connue (pour qu'aucun essai ne prétende « process bloqué » alors que l'évasion marche en une ligne).
// ---------------------------------------------------------------------------------------------------------
test('limite connue : le contexte node:vm n\'isole PAS (évasion par constructor.constructor atteint l\'hôte)', async () => {
  const appeler = async () => ({ ok: true, texte: '' });
  const r = await executerDansVm('return entree.constructor.constructor("return typeof process")();', {}, LIM, appeler);
  // Ce test ne « valide » pas une protection : il DOCUMENTE que le code libre peut atteindre l'hôte, pour rester
  // honnête. Si un jour une vraie isolation sans dépendance est possible, ce résultat changera et le test le dira.
  assert.equal(r.ok, true);
  assert.match(r.texte, /object|function/, 'process reste atteignable par la chaîne constructor — ce n\'est pas une prison');
});

// ---------------------------------------------------------------------------------------------------------
// #6 — SÉCURITÉ : une boucle de microtâches ne doit jamais geler Odin. Le code libre passe par un worker (arrêt
// dur) ; si le worker est indisponible, il est REFUSÉ (jamais de repli sur le fil principal). Dans les deux cas :
// un résultat ok:false, borné, sans blocage.
// ---------------------------------------------------------------------------------------------------------
test('boucle de microtâches : le bac à sable worker rend la main (ok:false), il ne gèle pas Odin', async () => {
  const bac = creerBacWorker(() => ({ budgetMo: 64 }));
  const t0 = Date.now();
  const r = await bac.executer('while (true) { await Promise.resolve(); }', {}, LIM, async () => ({ ok: true, texte: '' }));
  assert.equal(r.ok, false, 'une boucle de microtâches est arrêtée (ou le code libre est refusé), jamais exécutée sur le fil principal');
  assert.ok(Date.now() - t0 < 8000, 'le bac à sable rend la main sans geler');
});

// ---------------------------------------------------------------------------------------------------------
// #4 — SÉCURITÉ : un script « code » (du JS qui s'exécute) ne tourne jamais sans le propriétaire. L'action
// « lancer » est grave pour un script code (refusée depuis une automatisation), et un script code n'est pas
// transformé en tâche Talos (qui tournerait sans personne).
// ---------------------------------------------------------------------------------------------------------
test('un script « code » : « lancer » est grave (refusé en automatisation) et n\'est jamais une tâche Talos', async () => {
  const home = tmp();
  try {
    const m = creerMoteur({ entrepot: new EntrepotFichiers(home) });
    await m.creer({ nom: 'tache-code', mission: 'calcul', description: '', genre: 'code', code: 'return 1;', declencheurs: [{ genre: 'horaire', rythme: 'tous les jours à 7:00' }] });
    await m.creer({ nom: 'tache-decl', mission: 'arroser', description: '', genre: 'declaratif', etapes: [{ faire: 'action', module: 'maison', action: 'ouvrir' }], declencheurs: [{ genre: 'horaire', rythme: 'tous les jours à 8:00' }] });

    const lancer = archytas.actions.find((a) => a.id === 'lancer');
    assert.ok(lancer?.grave, 'l\'action lancer a une porte grave');
    const ctx = { home } as unknown as Parameters<NonNullable<typeof lancer.grave>>[1];
    assert.match(String(lancer!.grave!({ nom: 'tache-code' }, ctx)), /code/i, 'lancer un script code est grave');
    assert.equal(lancer!.grave!({ nom: 'tache-decl' }, ctx), undefined, 'lancer un script déclaratif n\'est pas grave');

    const taches = archytas.taches?.({ home } as unknown as Parameters<NonNullable<typeof archytas.taches>>[0]) ?? [];
    assert.ok(taches.some((t) => t.nom.includes('tache-decl')), 'un script déclaratif horaire devient une tâche Talos');
    assert.ok(!taches.some((t) => t.nom.includes('tache-code')), 'un script code horaire ne devient PAS une tâche Talos');
  } finally { rmSync(home, { recursive: true, force: true }); }
});

// ---------------------------------------------------------------------------------------------------------
// #9/#10 — PERFORMANCE : ouvrir la fenêtre Script demande lister + suivi + graphe ; le disque ne doit plus être
// balayé à chaque appel. Avec le cache, après un premier appel, lister ne relit plus les fichiers.
// ---------------------------------------------------------------------------------------------------------
test('lister : les résumés sont mis en cache (pas de relecture du disque à chaque appel), invalidé à l\'écriture', async () => {
  const home = tmp();
  try {
    const entrepot = new EntrepotFichiers(home);
    const m = creerMoteur({ entrepot });
    await m.creer({ nom: 'un', mission: 'm1', description: '', genre: 'declaratif', etapes: [], declencheurs: [{ genre: 'manuel' }] });
    const a = await entrepot.lister();
    assert.equal(a.length, 1);
    // Un second appel rend le même contenu (cache) ; une liste indépendante (copie défensive).
    const b = await entrepot.lister();
    assert.equal(b.length, 1);
    assert.notEqual(a, b, 'chaque appel rend une copie (le cache interne n\'est pas exposé)');
    // Après une écriture, le cache est invalidé : le nouveau script apparaît.
    await m.creer({ nom: 'deux', mission: 'm2', description: '', genre: 'declaratif', etapes: [], declencheurs: [{ genre: 'manuel' }] });
    assert.equal((await entrepot.lister()).length, 2, 'le cache est invalidé après une création');
    await m.supprimer('un');
    assert.equal((await entrepot.lister()).length, 1, 'le cache est invalidé après une suppression');
  } finally { rmSync(home, { recursive: true, force: true }); }
});

// ---------------------------------------------------------------------------------------------------------
// #7 — DESIGN : dans la frise « récents / anciens », le nom d'un script n'apparaît qu'UNE fois (pas de doublon).
// ---------------------------------------------------------------------------------------------------------
test('suivi : la frise n\'affiche le nom du script qu\'une seule fois (pas de doublon)', () => {
  const nav = fauxNavigateur();
  const ctx = vm.createContext(nav.sandbox);
  vm.runInContext(readFileSync(new URL('../src/web/pages/archytas-suivi.js', import.meta.url), 'utf8'), ctx);
  const Suivi = (nav.window as { OdinArchytasSuivi: { rendre: (h: unknown, s: unknown[], o?: unknown) => unknown } }).OdinArchytasSuivi;
  const t = Date.UTC(2026, 10, 1);
  const scripts = [{ nom: 'script-zzz-unique', mission: 'faire quelque chose', description: '', genre: 'declaratif', version: 1, actif: true, cree: t, modifie: t, dernierUsage: t, declencheurs: [], capacites: [], stat: { runs: 2, ok: 2, echecs: 0, msMoyen: 5 } }];
  const host = nav.make('div');
  Suivi.rendre(host, scripts, { onOuvrir: () => { /* cliquable */ } });
  const frises = (host as unknown as { querySelectorAll: (s: string) => Array<{ textContent: string }> }).querySelectorAll('.ar-tl');
  assert.ok(frises.length >= 2, 'les frises récents et anciens sont dessinées');
  let total = 0;
  for (const ul of frises) total += (ul.textContent.match(/script-zzz-unique/g) || []).length;
  assert.equal(total, frises.length, 'chaque frise montre le nom une seule fois (une occurrence par frise)');
});

// ---------------------------------------------------------------------------------------------------------
// #7/#8 — DESIGN (garde de source) : les liens cliquables du suivi sont habillés (sinon bouton natif gris) et
// la colonne du nom vise aussi le bouton, pas seulement le span.
// ---------------------------------------------------------------------------------------------------------
test('suivi : les noms cliquables sont habillés (pas de bouton natif) et gardent leur colonne', () => {
  const src = readFileSync(new URL('../src/web/pages/archytas-suivi.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /\.ar-bar>span\.ar-n\b/, 'le sélecteur ne doit pas viser que le span (le bouton resterait nu)');
  assert.match(src, /\.ar-bar>\.ar-n\b/, 'la colonne du nom vise aussi le bouton');
  assert.match(src, /\.ar-tl\s+\.ar-lien\s*\{/, 'le lien de frise est habillé (classe ar-lien stylée)');
});

// ---------------------------------------------------------------------------------------------------------
// #1 — SÉCURITÉ (garde de source) : la fenêtre Script est réservée au PROPRIÉTAIRE ; un membre de la famille
// (Persona) est exclu, comme la route de partage public.
// ---------------------------------------------------------------------------------------------------------
test('la route /api/archytas est montée propriétaire SEUL (les membres sont exclus)', () => {
  const src = readFileSync(new URL('../src/web/server.ts', import.meta.url), 'utf8');
  const ligne = src.split('\n').find((l) => l.includes('archytasRoute(')) ?? '';
  assert.match(ligne, /!estMembre\(req\)/, 'le montage d\'Archytas exclut les membres (propriétaire seul, comme partagePublic)');
});
