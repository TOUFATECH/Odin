// Archytas — l'interpréteur déclaratif avec un FAUX Valhalla (le pont `appeler` imite v.act({auto:true}) :
// il refuse une action grave et une action inconnue). On vérifie : la liste blanche est respectée (seules les
// actions connues et non graves passent), une action grave est refusée en automatisation, les conditions et
// les variables marchent, et le script ne peut atteindre que les applis (jamais le disque, le réseau, etc.).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { creerMoteur, type Appeler } from '../src/valhalla/archytas/scripts.ts';
import { EntrepotFichiers } from '../src/valhalla/archytas/base.ts';
import { interpreter, evaluerCondition } from '../src/valhalla/archytas/moteur-declaratif.ts';

const tmp = () => mkdtempSync(join(tmpdir(), 'archytas-moteur-'));
const LIM = { budgetMs: 1000, budgetMo: 64, maxAppels: 50, maxBoucles: 100_000 };

/** Un faux Valhalla : liste blanche d'actions connues, dont certaines graves (refusées en automatisation). */
function fauxValhalla() {
  const journal: Array<{ cle: string; entree: Record<string, unknown> }> = [];
  const connues = new Set(['notes.ecrire', 'notes.lire', 'danger.supprimer_tout']);
  const graves = new Set(['danger.supprimer_tout']);
  const appeler: Appeler = async (module, action, entree) => {
    const cle = `${module}.${action}`;
    if (!connues.has(cle)) return { ok: false, texte: `Action inconnue : ${cle}` };
    // Comme service.ts avec {auto:true} : une action grave est refusée et ne part pas d'une automatisation.
    if (graves.has(cle)) return { ok: false, texte: `action grave, elle demande ton accord et ne part pas d'une automatisation.` };
    journal.push({ cle, entree: entree ?? {} });
    return { ok: true, texte: `fait ${cle}` };
  };
  return { appeler, journal };
}

test('liste blanche + variable + condition : seule l\'action connue passe, avec la variable substituée', async () => {
  const { appeler, journal } = fauxValhalla();
  const r = await interpreter([
    { faire: 'poser', variable: 'qui', valeur: 'monde' },
    { faire: 'si', cond: '{{qui}} == monde', alors: [{ faire: 'action', module: 'notes', action: 'ecrire', entree: { texte: 'bonjour {{qui}}' } }], sinon: [{ faire: 'action', module: 'notes', action: 'lire' }] },
  ], appeler, { limites: LIM });
  assert.equal(r.ok, true);
  assert.equal(journal.length, 1);
  assert.deepEqual(journal[0], { cle: 'notes.ecrire', entree: { texte: 'bonjour monde' } });
});

test('action grave refusée en automatisation : le script s\'arrête proprement (ok:false)', async () => {
  const { appeler, journal } = fauxValhalla();
  const r = await interpreter([
    { faire: 'action', module: 'notes', action: 'ecrire', entree: { texte: 'avant' } },
    { faire: 'action', module: 'danger', action: 'supprimer_tout' },
    { faire: 'action', module: 'notes', action: 'ecrire', entree: { texte: 'après' } },
  ], appeler, { limites: LIM });
  assert.equal(r.ok, false);
  assert.match(r.texte, /grave/);
  // L'action d'avant a bien eu lieu ; celle d'après non (le script s'est arrêté sur le refus).
  assert.deepEqual(journal.map((x) => x.cle), ['notes.ecrire']);
});

test('action inconnue (hors liste blanche) : refusée', async () => {
  const { appeler } = fauxValhalla();
  const r = await interpreter([{ faire: 'action', module: 'systeme', action: 'rm_rf' }], appeler, { limites: LIM });
  assert.equal(r.ok, false);
  assert.match(r.texte, /inconnue/i);
});

test('bornes : trop d\'appels d\'applis est coupé', async () => {
  const { appeler } = fauxValhalla();
  const etapes = Array.from({ length: 5 }, () => ({ faire: 'action' as const, module: 'notes', action: 'lire' }));
  const r = await interpreter(etapes, appeler, { limites: { ...LIM, maxAppels: 2 } });
  assert.equal(r.ok, false);
  assert.match(r.texte, /trop d'appels/);
});

test('un script passe par le moteur complet et mesure son exécution', async () => {
  const home = tmp();
  try {
    const { appeler, journal } = fauxValhalla();
    const m = creerMoteur({ entrepot: new EntrepotFichiers(home), appeler });
    await m.creer({ nom: 'Ecrire une note', mission: 'écrire', description: '', genre: 'declaratif', etapes: [{ faire: 'action', module: 'notes', action: 'ecrire', entree: { texte: 'coucou' } }], declencheurs: [{ genre: 'manuel' }] });
    const r = await m.lancer('Ecrire une note');
    assert.equal(r.ok, true);
    assert.equal(journal.length, 1);
    const detail = await m.voir('Ecrire une note');
    assert.equal(detail!.stat.runs, 1);
    assert.equal(detail!.stat.ok, 1);
    assert.ok(detail!.dernierUsage, 'le dernier usage est daté');
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test('évaluateur de condition : sans eval, formes de base', () => {
  const etat = { variables: { n: '5', mot: 'bonjour' }, appels: 0, etapesLues: 0, journal: [] };
  assert.equal(evaluerCondition('{{n}} > 3', etat), true);
  assert.equal(evaluerCondition('{{n}} < 3', etat), false);
  assert.equal(evaluerCondition('{{mot}} contient jour', etat), true);
  assert.equal(evaluerCondition('{{mot}} == bonjour', etat), true);
  assert.equal(evaluerCondition('{{inconnu}} vide', etat), true);
  assert.equal(evaluerCondition('{{mot}} plein', etat), true);
});
