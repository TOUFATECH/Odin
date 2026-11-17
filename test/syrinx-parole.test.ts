// Syrinx — la parole (lot A). La transcription locale est remplacée par un FAUX Ecouter : on vérifie les tours de
// parole anonymes (« voix 1 », « voix 2 », estimation), la langue reprise, la garde du texte d'une chanson (sujet en une
// phrase, refusé s'il reprend 8 mots de suite), les cas sans parole, et la file d'analyse (au plus 1 + 4).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { analyserSon, ecrireWav16k, sonFabrique, ErreurSon, type Ecouter, type Ecoute } from '../src/audio/index.ts';
import { analyserParole, reprendSuite, sonEnMemoire, QUESTION_SUJET } from '../src/audio/parole.ts';
import { voix, FS } from './syrinx-outils-essai.ts';

const deuxVoix = (): Float32Array => {
  const x = new Float32Array(6 * FS);
  x.set(voix(120, 500, 3, 1), 0);
  x.set(voix(220, 2000, 3, 2), 3 * FS);
  return x;
};

const fauxEcouter = (r: Ecoute, appels = { n: 0, octets: 0 }): Ecouter => async (audio, mime) => {
  appels.n++;
  assert.equal(mime, 'audio/wav');
  if (audio instanceof Uint8Array) appels.octets = audio.length;
  return r;
};

const PAROLES = 'le vent souffle sur la mer grise et les bateaux rentrent au port avant la nuit tombée sur la ville endormie';

test('deux voix fabriquées : deux tours, « voix 1 » puis « voix 2 » ; langue et confiance reprises', async () => {
  const appels = { n: 0, octets: 0 };
  const ecouter = fauxEcouter({ text: 'bonjour. salut.', language: 'fr', confiance: 0.93, segments: [{ start: 0, end: 3, text: 'bonjour.' }, { start: 3, end: 6, text: 'salut.' }] }, appels);
  const p = await analyserParole(sonEnMemoire(deuxVoix()), { ecouter });
  assert.equal(p.etat, 'faite');
  assert.equal(p.langue, 'fr');
  assert.equal(p.confianceLangue, 0.93);
  assert.equal(p.texte, 'bonjour. salut.');
  assert.deepEqual(p.tours.map((t) => t.voix), ['voix 1', 'voix 2']);
  assert.equal(p.texteRetire, false);
  assert.equal(appels.n, 1);
  assert.equal(appels.octets, 44 + 6 * FS * 2, 'un WAV 16 kHz 16 bits');
  // Une voix qui revient garde son numéro.
  const x = new Float32Array(9 * FS);
  x.set(deuxVoix(), 0); x.set(voix(125, 520, 3, 3), 6 * FS);
  const p2 = await analyserParole(sonEnMemoire(x), { ecouter: fauxEcouter({ text: 'a b c', language: 'fr', segments: [{ start: 0, end: 3, text: 'a' }, { start: 3, end: 6, text: 'b' }, { start: 6, end: 9, text: 'c' }] }) });
  assert.deepEqual(p2.tours.map((t) => t.voix), ['voix 1', 'voix 2', 'voix 1']);
});

test('musique avec paroles : le sujet est rendu, le texte est retiré ; un sujet qui reprend 8 mots est refusé', async () => {
  const ecoute: Ecoute = { text: PAROLES, language: 'fr', segments: [{ start: 0, end: 3, text: PAROLES.slice(0, 50) }, { start: 3, end: 6, text: PAROLES.slice(50) }] };
  const questions: string[] = [];
  const p = await analyserParole(sonEnMemoire(deuxVoix()), {
    ecouter: fauxEcouter(ecoute), musiqueProbable: true,
    demander: async (s, u) => { questions.push(s); assert.ok(u.length <= 4000); return 'Une chanson sur le retour des marins avant la nuit.'; },
  });
  assert.deepEqual(questions, [QUESTION_SUJET]);
  assert.equal(p.sujet, 'Une chanson sur le retour des marins avant la nuit.');
  assert.equal(p.texte, undefined);
  assert.ok(p.segments.every((s) => s.texte === undefined));
  assert.equal(p.texteRetire, true);
  // Sujet qui reprend 8 mots de suite : refusé, et le texte reste retiré.
  const p2 = await analyserParole(sonEnMemoire(deuxVoix()), {
    ecouter: fauxEcouter(ecoute), musiqueProbable: true,
    demander: async () => 'Elle dit : le vent souffle sur la mer grise et les bateaux.',
  });
  assert.equal(p2.sujet, undefined);
  assert.equal(p2.texte, undefined);
  assert.equal(p2.texteRetire, true);
  // Sans demander : texte retiré quand même, aucun sujet.
  const p3 = await analyserParole(sonEnMemoire(deuxVoix()), { ecouter: fauxEcouter(ecoute), musiqueProbable: true });
  assert.equal(p3.texte, undefined);
  assert.equal(p3.texteRetire, true);
  assert.equal(reprendSuite('Le Vent souffle, sur la MER grise et les', PAROLES), true);
  assert.equal(reprendSuite('le vent souffle sur la mer', PAROLES), false);
});

test('sans parole : ecouter null → pas_prete ; sonsSeuls → non_demandee sans aucun appel ; erreur → echec', async () => {
  const appels = { n: 0, octets: 0 };
  const ecouter = fauxEcouter({ text: 'x', language: 'fr', segments: [] }, appels);
  const a = await analyserSon({ octets: ecrireWav16k(deuxVoix()) }, { ecouter: null, modele: null });
  assert.equal(a.analyse.parole.etat, 'pas_prete');
  assert.ok(a.analyse.manque.includes('parole : pas prête sur ce poste'));
  const b = await analyserSon({ octets: ecrireWav16k(deuxVoix()) }, { ecouter, sonsSeuls: true, modele: null });
  assert.equal(b.analyse.parole.etat, 'non_demandee');
  assert.equal(appels.n, 0, 'le faux Ecouter n\'est jamais appelé');
  const c = await analyserParole(sonEnMemoire(deuxVoix()), { ecouter: async () => { throw new Error('rien de chargé'); } });
  assert.equal(c.etat, 'echec');
  assert.match(c.raison ?? '', /rien de chargé/);
  // Par l'analyse complète : la parole est faite en fin de passe, chronométrée.
  const d = await analyserSon({ octets: ecrireWav16k(deuxVoix()) }, { ecouter: fauxEcouter({ text: 'bonjour', language: 'fr', segments: [{ start: 0, end: 3, text: 'a' }, { start: 3, end: 6, text: 'b' }] }), modele: null });
  assert.equal(d.analyse.parole.etat, 'faite');
  assert.equal(d.analyse.parole.tours.length, 2);
  assert.ok(d.analyse.mesures.some((m) => m.etape === 'parole'));
  // Avec un dossier de travail : le son passe par un fichier, effacé après.
  const { mkdtempSync, readdirSync, rmSync, existsSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dossier = mkdtempSync(join(tmpdir(), 'syrinx-parole-'));
  try {
    let vu: string | undefined;
    const parFichier: Ecouter = async (audio) => { assert.ok(!(audio instanceof Uint8Array)); vu = audio.file; assert.ok(existsSync(audio.file)); return { text: 'a', language: 'fr', segments: [{ start: 0, end: 3, text: 'a' }, { start: 3, end: 6, text: 'b' }] }; };
    const e = await analyserSon({ octets: ecrireWav16k(deuxVoix()) }, { ecouter: parFichier, modele: null, dossierTemp: dossier });
    assert.ok(vu && vu.startsWith(dossier));
    assert.deepEqual(e.analyse.parole.tours.map((t) => t.voix), ['voix 1', 'voix 2']);
    assert.deepEqual(readdirSync(dossier), [], 'le fichier de travail est effacé');
  } finally { rmSync(dossier, { recursive: true, force: true }); }
});

test('file d\'analyse : 6 analyses en même temps donnent au moins une ErreurSon « occupe »', async () => {
  const son = sonFabrique('accordDo', 4);
  const r = await Promise.allSettled(Array.from({ length: 6 }, () => analyserSon({ octets: son }, { ecouter: null, modele: null })));
  const occupe = r.filter((x) => x.status === 'rejected' && x.reason instanceof ErreurSon && x.reason.code === 'occupe');
  assert.ok(occupe.length >= 1, `${occupe.length} refus`);
  assert.equal(r.filter((x) => x.status === 'fulfilled').length, 5);
  // Un arrêt demandé : ErreurSon « arrete ».
  const ac = new AbortController();
  ac.abort();
  await assert.rejects(analyserSon({ octets: son }, { signal: ac.signal, ecouter: null, modele: null }), (e: unknown) => e instanceof ErreurSon && e.code === 'arrete');
  // La file est libre à nouveau.
  const ok = await analyserSon({ octets: son }, { ecouter: null, modele: null });
  assert.ok(ok.analyse.duree > 3.9);
});
