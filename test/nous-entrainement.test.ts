// Noûs, étape 4 : Odin lance lui-même l'entraînement dès qu'il est libre (jour ou nuit), à la puissance réglée ;
// arrêt immédiat quand Odin répond ; porte de qualité et retour arrière ; rien si Noûs est coupé, en mode privé ou en
// démonstration. Faux moteur (aucune charge) ; un essai court avec le vrai moteur, sur plusieurs fils.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PiloteNous, filsPour, type Fabrique, type EntraineurPilote } from '../src/brain/nous/entrainement-odin.ts';
import { debutReponse, reponsesEnCours } from '../src/brain/nous/occupation.ts';
import { dossierCorpus } from '../src/brain/nous/file-odin.ts';
import { listerReprises } from '../src/brain/nous/reprise.ts';
import type { Avancee } from '../src/brain/nous/nuit.ts';

const homes: string[] = [];
after(() => { for (const h of homes) rmSync(h, { recursive: true, force: true }); });

function faux(o: { actif?: boolean; prive?: boolean; demo?: boolean; puissance?: string } = {}) {
  const home = mkdtempSync(join(tmpdir(), 'nous-ent-')); homes.push(home);
  // un corpus non vide (le pilote ne lance rien sur un corpus vide)
  mkdirSync(dossierCorpus(home), { recursive: true }); writeFileSync(join(dossierCorpus(home), 'tranche-20261117-odin.bin'), Buffer.from('ODR1'));
  return { cfg: { learning: { observe: true }, nous: { actif: o.actif ?? true, puissance: o.puissance ?? 'pleine', disqueMaxMo: 2000 }, voice: { privacy: { privateMode: o.prive ?? false } } }, demo: o.demo ?? false, paths: { home } } as never as { cfg: { nous: Record<string, unknown> }; paths: { home: string }; demo: boolean };
}

/** Un faux entraîneur : chaque séance « apprend » (la perte du banc baisse de `gain`) jusqu'à la fin ou au signal. */
function fauxMoteur(o: { pertes: number[]; dureeSeanceMs?: number }) {
  const journal: string[] = [];
  let i = 0;
  const e: EntraineurPilote = {
    async seance(_lots, op) {
      journal.push(`seance fils=${op.fils}`);
      const t0 = performance.now();
      const d = o.dureeSeanceMs ?? 30;
      await new Promise<void>((ok) => { const t = setTimeout(ok, d); op.signal.addEventListener('abort', () => { clearTimeout(t); ok(); }, { once: true }); });
      const interrompue = op.signal.aborted;
      return { pas: interrompue ? 1 : 5, morceauxVus: 100, perte: 3, tempsMs: performance.now() - t0, interrompue } as Avancee;
    },
    async perteSur() { const p = o.pertes[Math.min(i, o.pertes.length - 1)]; i++; journal.push(`perte ${p}`); return p; },
    async ecrire(n) { journal.push(`ecrire ${n}`); mkdirSync(join(homeCourant, 'cerveau-reseau'), { recursive: true }); writeFileSync(join(homeCourant, 'cerveau-reseau', `reprise-${n}.bin`), 'x'); return 'ok'; },
    async revenirA(n) { journal.push(`revenir ${n}`); },
    async arreter() { journal.push('arreter'); },
  };
  let homeCourant = '';
  const fabrique: Fabrique = {
    async entraineur(home) { homeCourant = home; journal.push('entraineur'); return e; },
    async decoupage() { journal.push('decoupage'); return { dec: { vocab: 4096, version: 0, fusions: new Int32Array(0) }, textes: 100 }; },
    async jeux() { journal.push('jeux'); return { banc: [Int32Array.of(1, 2, 3)], entrainement: [Int32Array.of(1, 2, 3, 4)], textes: 100, morceaux: 400 }; },
    async taille() { return { taille: 'petit', C: 64, couches: 4, tetes: 2, vocab: 4096, contexte: 128, poids: 1 } as never; },
  };
  return { journal, fabrique };
}

test('puissance : douce = 1 fil, normale = la moitié, pleine = tous moins un ; « pleine » par défaut', () => {
  assert.equal(filsPour('douce', 8), 1); assert.equal(filsPour('normale', 8), 4); assert.equal(filsPour('pleine', 8), 7);
  assert.equal(filsPour(undefined, 8), 7); assert.equal(filsPour('pleine', 1), 1);
});

test('libre : apprend, puis la porte de qualité met en service un point qui fait MIEUX', async () => {
  const odin = faux(), m = fauxMoteur({ pertes: [5, 4] });
  const p = new PiloteNous({ odin: odin as never, fabrique: m.fabrique, charge: () => 0, essai: false, trancheMs: 20, seanceMs: 30, nCpu: 8 });
  p.tic(); await p.attendre();
  assert.deepEqual(m.journal, ['decoupage', 'entraineur', 'jeux', 'perte 5', 'seance fils=7', 'perte 4', 'ecrire 0']);
  assert.equal(p.etat.dernierPoint, 0); assert.equal(p.etat.derniere?.gardee, true); assert.equal(p.etat.pas, 5);
  assert.ok(existsSync(join(odin.paths.home, 'cerveau-reseau', 'decoupage.json')), 'le découpage appris est gardé');
  await p.fermer();
});

test('pas mieux sur le banc : refusé, retour au point en service ; divergence : retour arrière', async () => {
  const odin = faux();
  mkdirSync(join(odin.paths.home, 'cerveau-reseau'), { recursive: true }); writeFileSync(join(odin.paths.home, 'cerveau-reseau', 'reprise-3.bin'), 'x');
  const m = fauxMoteur({ pertes: [4, 4.02, 9] });
  const p = new PiloteNous({ odin: odin as never, fabrique: m.fabrique, charge: () => 0, essai: false, trancheMs: 20, seanceMs: 30, nCpu: 8 });
  (p as unknown as { dec: unknown }).dec = { vocab: 4096, version: 0, fusions: new Int32Array(0) };
  p.tic(); await p.attendre();
  assert.equal(p.etat.derniere?.gardee, false); assert.match(p.etat.derniere?.raison ?? '', /pas mieux/);
  assert.ok(m.journal.includes('revenir 3'));
  p.tic(); await p.attendre();
  assert.equal(p.etat.derniere?.gardee, false); assert.match(p.etat.derniere?.raison ?? '', /divergé/);
  assert.equal(m.journal.filter((x) => x === 'revenir 3').length, 2);
  assert.equal(p.etat.dernierPoint, 3, 'le point en service ne change pas');
  await p.fermer();
});

test('Odin répond : la séance s\'arrête TOUT DE SUITE (mesuré), puis reprend au moment libre suivant sans rien perdre', async () => {
  const odin = faux(), m = fauxMoteur({ pertes: [5, 4], dureeSeanceMs: 60_000 });
  const p = new PiloteNous({ odin: odin as never, fabrique: m.fabrique, charge: () => 0, essai: false, trancheMs: 120_000, nCpu: 8 });
  p.tic();
  while (!p.etat.apprend) await new Promise((ok) => setTimeout(ok, 2));
  const t0 = performance.now();
  const fin = debutReponse();
  await p.attendre();
  const arret = performance.now() - t0;
  assert.ok(arret < 50, `arrêt en ${arret.toFixed(1)} ms`);
  assert.equal(p.etat.apprend, false); assert.equal(p.etat.interruptions, 1); assert.ok(p.etat.dernierArretMs! < 50);
  console.log(`# mesuré : séance arrêtée ${arret.toFixed(1)} ms après le début de la réponse`);
  // pendant la réponse : rien ne repart
  p.tic(); assert.equal(m.journal.filter((x) => x.startsWith('seance')).length, 1); assert.equal(p.etat.arret, 'Odin répond');
  fin(); assert.equal(reponsesEnCours(), 0);
  // libre à nouveau : reprend avec le même entraîneur (pas de nouveau découpage, pas de nouvel entraîneur)
  p.tic(); while (!p.etat.apprend) await new Promise((ok) => setTimeout(ok, 2));
  p.interrompre('fin de l\'essai'); await p.attendre();
  assert.equal(m.journal.filter((x) => x === 'entraineur').length, 1);
  assert.equal(m.journal.filter((x) => x === 'decoupage').length, 1);
  assert.equal(p.etat.pas, 2, 'les pas des deux morceaux de séance s\'additionnent');
  await p.fermer();
});

test('rien si Noûs est coupé, en mode privé, en démonstration, sous le lanceur d\'essais, ou si la machine est chargée', async () => {
  for (const [nom, odin, opts] of [
    ['coupé', faux({ actif: false }), {}], ['privé', faux({ prive: true }), {}], ['démo', faux({ demo: true }), {}],
    ['lanceur d\'essais', faux(), { essai: undefined }], ['machine chargée', faux(), { charge: () => 0.9 }],
  ] as const) {
    const m = fauxMoteur({ pertes: [5, 4] });
    const p = new PiloteNous({ odin: odin as never, fabrique: m.fabrique, charge: () => 0, essai: false, trancheMs: 20, nCpu: 8, ...opts });
    p.tic(); await p.attendre();
    assert.deepEqual(m.journal, [], nom); assert.equal(p.etat.apprend, false, nom); assert.ok(p.etat.arret, nom);
    assert.equal(listerReprises(odin.paths.home).length, 0, nom);
    await p.fermer();
  }
});

test('vrai moteur, 2 fils : même lot, même résultat qu\'un seul fil ; l\'arrêt vaut pour tous les fils', async () => {
  const { nouvelEntraineur, gabarit, apprendreDecoupage } = await import('../src/brain/nous/moteur.ts');
  const textes = Array.from({ length: 40 }, (_, i) => `Phrase ${i} : le marché de Mamoudzou ouvre à ${i % 12} heures.`);
  const dec = apprendreDecoupage(textes, 4096, 7);
  const seqs = textes.map((t) => dec.encoder(t));
  const pertes: number[] = [];
  for (const fils of [1, 2]) {
    const home = mkdtempSync(join(tmpdir(), 'nous-fils-')); homes.push(home);
    const e = nouvelEntraineur(gabarit('petit'), dec, 42, home);
    const av = await e.seance([{ entrees: seqs }], { dureeMs: 60_000, fils, signal: new AbortController().signal, graine: 3 });
    assert.equal(av.pas, 5, `${fils} fil(s) : 40 séquences par lots de 8`);
    pertes.push(await e.perteSur(seqs.slice(0, 8)));
    if (fils === 2) {
      const ac = new AbortController(); const gros = Array.from({ length: 30 }, () => seqs).flat();
      const pr = e.seance([{ entrees: gros }], { dureeMs: 60_000, fils, signal: ac.signal, graine: 4 });
      await new Promise((ok) => setTimeout(ok, 800));
      const t0 = performance.now(); ac.abort(); const r = await pr;
      assert.equal(r.interrompue, true); assert.ok(performance.now() - t0 < 1500, 'arrêt rapide');
      console.log(`# mesuré : arrêt de 2 fils en ${(performance.now() - t0).toFixed(0)} ms`);
    }
    await e.arreter();
  }
  assert.ok(Math.abs(pertes[0] - pertes[1]) < 1e-3, `pertes ${pertes.join(' / ')}`);
});
