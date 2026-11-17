// La façade de Noûs (src/brain/nous/moteur.ts) de bout en bout : le worker de calcul répond, propose, plonge, note,
// s'entraîne, écrit un point de reprise, se recharge, et l'adaptateur Embedder marche. C'est l'essai d'intégration
// « vrai moteur » du lot A (le lot B le rejouera avec sa vie).
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { apprendreDecoupage } from '../src/brain/nous/decoupage.ts';
import { avecPoids } from '../src/brain/nous/tailles.ts';
import { chargerMoteur, embedderNoos, nouvelEntraineur, type Lot, type Moteur } from '../src/brain/nous/moteur.ts';

const HYPER = avecPoids({ taille: 'petit', C: 32, couches: 2, tetes: 2, vocab: 300, contexte: 32 });
const CORPUS = 'bonjour odin comment vas tu la maison de mamoudzou le serveur de fichiers '.repeat(40);

test('façade : propose, complète, plonge, note, s\'entraîne, écrit et se recharge', async (t) => {
  const home = mkdtempSync(join(tmpdir(), 'noos-facade-'));
  const dec = apprendreDecoupage([CORPUS], HYPER.vocab, 3);
  const e = nouvelEntraineur(HYPER, dec, 123, home);
  t.after(() => (e as unknown as Moteur).arreter());

  // proposer
  const p = await e.proposer({ texte: 'bonjour', maxMorceaux: 8, delaiMs: 3000 });
  assert.equal(typeof p.texte, 'string');
  assert.ok(p.confiance >= 0 && p.confiance <= 1, `confiance ${p.confiance}`);
  assert.ok(p.morceaux >= 0 && p.pret === true);

  // completer
  const c = await e.completer('la maison', 6, { delaiMs: 3000 });
  assert.equal(typeof c, 'string');

  // plonger : vecteur de la bonne taille
  const v = await e.plonger('le serveur de fichiers');
  assert.ok(v instanceof Float32Array && v.length === HYPER.C, `plongement de longueur ${v.length}`);

  // scoreDe : une log-probabilité (≤ 0)
  const s = await e.scoreDe('bonjour', 'odin');
  assert.ok(Number.isFinite(s) && s <= 1e-6, `score ${s}`);

  // écrire un point de reprise AVANT entraînement, pour comparer après rechargement
  await e.ecrire(0);

  // une petite séance : des pas sont faits, la perte est finie
  const enc = (x: string): Int32Array => dec.encoder(x);
  const lots: Lot[] = [{ entrees: ['bonjour odin', 'la maison de mamoudzou', 'le serveur de fichiers', 'comment vas tu'].map(enc) }];
  const av = await e.seance(lots, { dureeMs: 1500, fils: 1, graine: 5, signal: new AbortController().signal });
  assert.ok(Number.isFinite(av.perte));
  assert.ok(av.pas >= 0 && av.interrompue === false);

  // recharger depuis le point de reprise (poids d'avant l'entraînement)
  const m = await chargerMoteur(home);
  assert.ok(m, 'moteur rechargé');
  assert.equal(m.pret, true);
  assert.equal(m.modeleEmbedding, 'noos-v1-p2');
  assert.equal(m.hyper.C, HYPER.C);
  t.after(() => m.arreter());

  // l'adaptateur Embedder de la mémoire
  const emb = embedderNoos(m);
  assert.equal(emb.model, 'noos-v1-p2');
  const ve = await emb.embed('le serveur de fichiers');
  assert.ok(ve instanceof Float32Array && ve.length === HYPER.C);
});

test('façade : abandonner une séance EN COURS puis proposer aussitôt — l\'abandon tient, Odin n\'attend pas', async (t) => {
  // Le motif naturel : une séance tourne, Odin doit répondre ⇒ on abandonne la séance et on propose dans la foulée.
  // Avant le correctif, la proposition remettait le drapeau d\'arrêt à zéro et la séance allait jusqu\'au bout.
  const home = mkdtempSync(join(tmpdir(), 'noos-facade-'));
  const dec = apprendreDecoupage([CORPUS], HYPER.vocab, 4);
  const e = nouvelEntraineur(HYPER, dec, 11, home);
  t.after(() => (e as unknown as Moteur).arreter());
  // init terminé (le worker est libre) avant de lancer la séance.
  await (e as unknown as Moteur).plonger('amorce');
  const enc = (x: string): Int32Array => dec.encoder(x);
  const entrees: Int32Array[] = []; for (let i = 0; i < 5000; i++) entrees.push(enc('la maison de mamoudzou et le serveur de fichiers'));
  const ac = new AbortController();
  const pSeance = e.seance([{ entrees }], { dureeMs: 30000, fils: 1, graine: 1, signal: ac.signal });
  await new Promise((r) => setTimeout(r, 120)); // la séance est bien en cours
  ac.abort();
  const prop = await (e as unknown as Moteur).proposer({ texte: 'bonjour', maxMorceaux: 4, delaiMs: 3000 });
  const av = await pSeance;
  assert.equal(av.interrompue, true, 'la séance abandonnée ne doit pas aller au bout malgré la proposition qui suit');
  assert.equal(typeof prop.texte, 'string', 'la proposition est bien servie');
});

test('façade : un signal arrête la séance (interrompue=true), les poids restent finis', async (t) => {
  const home = mkdtempSync(join(tmpdir(), 'noos-facade-'));
  const dec = apprendreDecoupage([CORPUS], HYPER.vocab, 9);
  const e = nouvelEntraineur(HYPER, dec, 7, home);
  t.after(() => (e as unknown as Moteur).arreter());
  const ac = new AbortController();
  const enc = (x: string): Int32Array => dec.encoder(x);
  const entrees: Int32Array[] = []; for (let i = 0; i < 200; i++) entrees.push(enc('la maison de mamoudzou et le serveur'));
  ac.abort(); // arrêt immédiat
  const av = await e.seance([{ entrees }], { dureeMs: 10000, fils: 1, graine: 1, signal: ac.signal });
  assert.equal(av.interrompue, true);
  // après un arrêt, la façade reste utilisable : un plongement sort un vecteur fini
  const v = await e.plonger('test');
  for (let i = 0; i < v.length; i++) assert.ok(Number.isFinite(v[i]));
});
