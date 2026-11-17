// Noûs — corrections de la deuxième relecture (relecture-nous-2.md) : modèle de départ épinglé, gabarit exact et borné,
// oubli et témoins sur un texte replié, pilote qui jette sa tranche après un oubli, export lié au corpus contrôlé, candidat
// en panne abandonné, vecteurs préparés d'un souvenir modifié écartés. Dossiers jetables, gabarit « petit ».
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as L from '../src/brain/nous/livraison.ts';
import { decoupageDe } from '../src/brain/nous/preparation.ts';
import { Reseau } from '../src/brain/nous/calcul.ts';
import { gabarit } from '../src/brain/nous/moteur.ts';
import { ecrireReprise, listerReprises } from '../src/brain/nous/reprise.ts';
import { noterOubli, lireOublis, filtreOublis, sansOublis } from '../src/brain/nous/oubli.ts';
import type { SourcesDepart } from '../src/brain/nous/corpus-depart.ts';
import type { OdinPourNous } from '../src/brain/nous/file-odin.ts';

const dossiers: string[] = [];
after(() => { for (const d of dossiers) rmSync(d, { recursive: true, force: true }); });
const jetable = (p: string) => { const d = mkdtempSync(join(tmpdir(), p)); dossiers.push(d); return d; };
const sha = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');
const odinDe = (home: string): OdinPourNous => ({ cfg: { learning: { observe: true }, nous: { actif: true }, voice: { privacy: { privateMode: false } } }, paths: { home } });
const SOURCES: SourcesDepart = { modules: Array.from({ length: 12 }, (_, k) => ({ id: `appli${k}`, name: `Appli ${k}`, what: `L'appli ${k} range les objets ${k}.`, actions: [{ id: `ouvrir_${k}`, label: `Ouvrir ${k}`, words: [`ouvre la carte ${k}`, `montre ${k}`] }] })) };

/** Un modèle exporté (petit, non entraîné) avec son épingle ; rend les chemins. */
async function exporte(version = 1) {
  const fab = jetable('nr2-fab-'), home = join(fab, 'odin'), sortie = join(fab, 'livre'), epingle = join(fab, 'epingle.json');
  const c = L.corpusLivraison(SOURCES);
  const hyper = gabarit('petit'), dec = decoupageDe(c.exemples.map((e) => e.texte), hyper.vocab, 1);
  const r = new Reseau(hyper); r.initialiser(3);
  await ecrireReprise(home, 0, { hyper, decoupage: dec, poids: r.poids, m: new Float32Array(r.poids.length), v: new Float32Array(r.poids.length), pas: 1, graine: 3, courbe: [], modeleVersion: 1 });
  L.ecrireProvenance(home, c.bilan.empreinte);
  const x = await L.exporterModeleDepart({ home, sortie, corpus: c, temoins: [], version, licence: join(process.cwd(), 'LICENSE'), epingle });
  assert.equal(x.ok, true, x.ok ? '' : x.raison);
  return { home, sortie, epingle, c };
}

test('GRAVE 1 : poids remplacés ET empreinte refaite dans le manifeste → refusé (l\'épingle du code ne correspond plus) ; sans épingle, rien', async () => {
  const { sortie, epingle } = await exporte();
  assert.equal(L.lireModeleDepart(sortie, { epingle }).ok, true);
  // L'attaque : de nouveaux poids, et leur empreinte recalculée dans le manifeste du même dossier.
  const f = join(sortie, 'soul-depart.bin'), b = readFileSync(f); for (let i = 0; i < 64; i++) b[1000 + i] ^= 0x55; writeFileSync(f, b);
  const man = JSON.parse(readFileSync(join(sortie, 'manifeste.json'), 'utf8')); man.fichiers['soul-depart.bin'] = sha(b);
  writeFileSync(join(sortie, 'manifeste.json'), JSON.stringify(man, null, 1));
  const r = L.lireModeleDepart(sortie, { epingle });
  assert.equal(r.ok, false); assert.match(r.ok ? '' : r.raison, /épingle/);
  const h = jetable('nr2-inst-');
  assert.equal((await L.installerModeleDepart(odinDe(h), { dossier: sortie, epingle })).installe, false);
  assert.deepEqual(listerReprises(h), []);
  assert.match((L.lireModeleDepart(sortie, { epingle: join(sortie, 'absente.json') }) as { raison: string }).raison, /aucune épingle/);
});

test('GRAVE 2 et MOYEN 3 : un gabarit menteur ou sans borne est refusé AVANT toute lecture des poids', async () => {
  for (const changer of [(g: Record<string, unknown>) => { g.poids = Number(g.poids) + 1000; }, (g: Record<string, unknown>) => { g.C = 4096; g.poids = 40_000_000; }, (g: Record<string, unknown>) => { g.taille = 'immense'; }]) {
    const { sortie, epingle } = await exporte();
    const man = JSON.parse(readFileSync(join(sortie, 'manifeste.json'), 'utf8'));
    changer(man.gabarit);
    const texte = JSON.stringify(man, null, 1);
    writeFileSync(join(sortie, 'manifeste.json'), texte);
    writeFileSync(epingle, JSON.stringify({ version: man.version, manifeste: sha(texte) })); // même avec une épingle complice
    const r = L.lireModeleDepart(sortie, { epingle });
    assert.equal(r.ok, false); assert.match(r.ok ? '' : r.raison, /gabarit inconnu/);
  }
  assert.equal(L.gabaritConnu(gabarit('petit')), true);
  assert.equal(L.gabaritConnu({ ...gabarit('petit'), poids: gabarit('petit').poids - 1 }), false);
});

test('MOYEN 4 : l\'oubli reconnaît la même phrase sans point final, en minuscule, ou au milieu d\'une autre ligne', () => {
  const home = jetable('nr2-oubli-');
  noterOubli(home, { texte: 'Le code du portail est rangé dans le tiroir de la cuisine.' });
  const f = filtreOublis(lireOublis(home));
  for (const v of ['le code du portail est rangé dans le tiroir de la cuisine', 'LE CODE DU PORTAIL EST RANGE DANS LE TIROIR DE LA CUISINE !', 'Note : le code du portail est rangé dans le tiroir de la cuisine.']) {
    assert.equal(sansOublis(`${v}\nUne autre ligne qui reste bien là.`, undefined, f), 'Une autre ligne qui reste bien là.', v);
  }
  assert.equal(sansOublis('Le portail est vert.', undefined, f), 'Le portail est vert.', 'une autre phrase reste');
});

test('MOYEN 6 : un témoin écrit autrement (accents, casse, tirets) est trouvé', () => {
  assert.deepEqual(L.temoinsTrouves(['elodie mbae habite là'], ['Élodie Mbaé']), ['Élodie Mbaé']);
  assert.deepEqual(L.temoinsTrouves(['jean pierre est passé'], ['Jean-Pierre']), ['Jean-Pierre']);
  assert.deepEqual(L.temoinsTrouves(['le serveur salon nas 7f3'], ['salon-nas-7f3']), ['salon-nas-7f3']);
});

test('MOYEN 7 : l\'export exige un point de reprise fait sur CE corpus, dans un dossier d\'Odin neuf', async () => {
  const fab = jetable('nr2-prov-'), home = join(fab, 'odin');
  const c = L.corpusLivraison(SOURCES);
  const hyper = gabarit('petit'), dec = decoupageDe(c.exemples.map((e) => e.texte), hyper.vocab, 1);
  const r = new Reseau(hyper); r.initialiser(3);
  await ecrireReprise(home, 0, { hyper, decoupage: dec, poids: r.poids, m: new Float32Array(r.poids.length), v: new Float32Array(r.poids.length), pas: 1, graine: 3, courbe: [], modeleVersion: 1 });
  const ex = (epingle = join(fab, 'ep.json')) => L.exporterModeleDepart({ home, sortie: join(fab, 'livre'), corpus: c, temoins: [], version: 1, licence: join(process.cwd(), 'LICENSE'), epingle });
  assert.match(((await ex()) as { raison: string }).raison, /provenance/);
  L.ecrireProvenance(home, 'un-autre-corpus');
  assert.match(((await ex()) as { raison: string }).raison, /provenance/);
  L.ecrireProvenance(home, c.bilan.empreinte);
  mkdirSync(join(home, 'cerveau-reseau', 'corpus'), { recursive: true });
  assert.match(((await ex()) as { raison: string }).raison, /neuf/);
  rmSync(join(home, 'cerveau-reseau', 'corpus'), { recursive: true });
  assert.equal((await ex()).ok, true);
});

test('MOYEN 5 : après un oubli, le pilote arrête la séance, jette sa tranche préparée et revient au point en service', async () => {
  const { PiloteNous } = await import('../src/brain/nous/entrainement-odin.ts');
  const { dossierCorpus } = await import('../src/brain/nous/file-odin.ts');
  const { lireDecoupageSerialise } = await import('../src/brain/nous/decoupage.ts');
  const home = jetable('nr2-pil-');
  mkdirSync(dossierCorpus(home), { recursive: true }); writeFileSync(join(dossierCorpus(home), 'tranche-20261117-odin.bin'), Buffer.from('ODR1'));
  const v0 = lireDecoupageSerialise({ vocab: 4096, version: 0, fusions: new Int32Array(0) }).version;
  writeFileSync(join(home, 'cerveau-reseau', 'decoupage.json'), JSON.stringify({ vocab: 4096, version: v0, fusions: [] }));
  writeFileSync(join(home, 'cerveau-reseau', 'reprise-4.bin'), 'point en service (illisible ici : le découpage vient de decoupage.json)');
  const journal: string[] = [];
  let finir: (() => void) | undefined;
  const e = {
    seance: (_l: unknown, o: { signal: AbortSignal }) => new Promise((ok) => { journal.push('seance'); const fin = () => ok({ pas: 1, morceauxVus: 1, perte: 1, tempsMs: 5, interrompue: o.signal.aborted }); finir = fin; o.signal.addEventListener('abort', fin, { once: true }); }),
    async perteSur() { return 5; }, async ecrire() { journal.push('ecrire'); return 'ok'; }, async revenirA(n: number) { journal.push(`revenir ${n}`); }, async arreter() {},
  };
  const fab = { async entraineur() { return e; }, async decoupage() { throw new Error('x'); }, async jeux() { journal.push('jeux'); return { banc: [Int32Array.of(1, 2)], entrainement: [Int32Array.of(1, 2, 3)], textes: 50, morceaux: 9 }; }, async taille() { return {}; } };
  const odin = odinDe(home); (odin.cfg.nous as Record<string, unknown>).puissance = 'douce';
  const p = new PiloteNous({ odin, fabrique: fab as never, charge: () => 0, essai: false, nCpu: 2 });
  p.tic(); await new Promise((ok) => setTimeout(ok, 100));
  assert.deepEqual(journal, ['jeux', 'seance']);
  noterOubli(home, { texte: 'Une phrase oubliée pendant la séance, assez longue pour compter.' });
  await p.attendre();
  assert.match(String(p.etat.arret), /oubli/);
  p.tic(); await new Promise((ok) => setTimeout(ok, 100));
  assert.deepEqual(journal, ['jeux', 'seance', 'revenir 4', 'jeux', 'seance'], `retour au point en service, tranche refaite (${JSON.stringify(p.etat)})`);
  finir?.(); await p.fermer();
});

test('MOYEN 8 et PETIT 9 : un candidat en panne est abandonné (la mémoire reprend ses vecteurs) ; un souvenir modifié pendant la préparation n\'emporte pas un vecteur périmé', async () => {
  const { remplirVecteurs, ECHECS_MAX } = await import('../src/brain/nous/vecteurs-fond.ts');
  const vecteurs = new Map<number, { model: string; v: Float32Array }>();
  const souvenirs = new Map<number, string>([[1, 'Le compost se retourne chaque mois.'], [2, 'La box redémarre le lundi.']]);
  const mem = {
    missingVectors: (model: string, limit = 50) => [...souvenirs].filter(([id]) => vecteurs.get(id)?.model !== model).slice(0, limit).map(([id, content]) => ({ id, content })),
    setVector: (id: number, model: string, v: Float32Array) => { vecteurs.set(id, { model, v }); },
  };
  // 8. Un candidat qui échoue toujours.
  let candidat: { model: string; embed: () => Promise<Float32Array> } | undefined = { model: 'v2', embed: async () => { throw new Error('moteur candidat en panne'); } };
  const emb = { model: 'v1', embed: async () => new Float32Array(4).fill(1), candidat: async () => candidat, basculer() {}, abandonnerCandidat() { candidat = undefined; } };
  for (let i = 0; i < ECHECS_MAX + 1; i++) await remplirVecteurs(mem, emb as never, { libre: () => true });
  assert.equal(candidat, undefined, 'abandonné');
  assert.equal(vecteurs.get(1)?.model, 'v1', 'le moteur en service a refait ses vecteurs');
  // 9. Un souvenir modifié PENDANT la préparation (juste après que son vecteur a été préparé).
  vecteurs.clear();
  let bascule = false, appels = 0;
  const cand2 = { model: 'v3', embed: async () => { appels++; if (appels === 1) souvenirs.set(1, 'Le compost se retourne chaque semaine désormais.'); return new Float32Array(4).fill(2); } };
  const emb2 = { model: 'v1', embed: async () => new Float32Array(4), candidat: async () => (bascule ? undefined : cand2), basculer() { bascule = true; }, abandonnerCandidat() {} };
  const b = await remplirVecteurs(mem, emb2 as never, { libre: () => true });
  assert.equal(b.bascule, true);
  assert.equal(vecteurs.get(1), undefined, 'pas de vecteur périmé pour le souvenir modifié (il sera refait sous la nouvelle version)');
  assert.equal(vecteurs.get(2)?.model, 'v3');
});
