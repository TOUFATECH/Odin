// Syrinx — entendre sans modèle (lot A). Le spectre (pic à la bonne case, forme, Parseval), puis les calculs écrits
// dans Odin : frontière silence/bruit, volume, tempo, tonalité, parties, empreinte (même son décalé et réécrit en
// 8 bits reconnu, son différent non reconnu), et les vraies durées mesurées sur 60 s fabriquées.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { analyserSon, sonFabrique, voterEmpreinte, ecrireWav16k, type EmpreinteSon } from '../src/audio/index.ts';
import { logMel, mfcc, chroma, spectrePuissance, bancMel, nbTrames, BANDES } from '../src/audio/spectre.ts';
import { EcouteSansModele } from '../src/audio/sansmodele.ts';
import { sinus, melodie, wavDe, hasard, FS } from './syrinx-outils-essai.ts';

test('spectre : un sinus de 440 Hz a son pic à la bonne case et dans la bonne bande mel ; forme 64 × (1 + n/160)', () => {
  const x = sinus(440, 1.003, FS, 0.5);
  const mel = logMel(x);
  assert.equal(mel.trames, 1 + Math.floor(x.length / 160));
  assert.equal(mel.data.length, BANDES * nbTrames(x.length));
  // Case FFT : 440 / 31,25 = 14,08 → case 14.
  const p = spectrePuissance(Array.from(x.subarray(4000, 4512), (v, i) => v * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / 512))));
  let kMax = 0; for (let k = 1; k < p.length; k++) if (p[k] > p[kMax]) kMax = k;
  assert.equal(kMax, 14);
  // Bande mel : celle qui pèse le plus sur la case 14.
  const banc = bancMel();
  let attendue = 0, poids = -1;
  banc.forEach((f, m) => { const w = 14 >= f.debut && 14 < f.debut + f.poids.length ? f.poids[14 - f.debut] : 0; if (w > poids) { poids = w; attendue = m; } });
  const t = 50, T = mel.trames;
  let mMax = 0; for (let m = 0; m < BANDES; m++) if (mel.data[m * T + t] > mel.data[mMax * T + t]) mMax = m;
  assert.equal(mMax, attendue);
  // Écrêtage à max − 120 dB.
  let min = Infinity; for (const v of mel.data) min = Math.min(min, v);
  assert.ok(min >= mel.max - 120 - 1e-3);
});

test('Parseval sur une trame : énergie du temps = énergie du spectre / N', () => {
  const h = hasard(3);
  const x = Array.from({ length: 512 }, () => h() * 2 - 1);
  const p = spectrePuissance(x);
  let et = 0; for (const v of x) et += v * v;
  let ef = p[0] + p[256]; for (let k = 1; k < 256; k++) ef += 2 * p[k];
  assert.ok(Math.abs(et - ef / 512) / et < 1e-9);
});

test('MFCC et chroma ont la bonne forme', () => {
  const x = sinus(261.63, 2, FS, 0.5);
  const mel = logMel(x);
  assert.equal(mfcc(mel).length, mel.trames * 20);
  const c = chroma(x);
  assert.equal(c.trames, 1 + Math.floor(x.length / 1600));
  let kMax = 0; for (let k = 0; k < 12; k++) if (c.data[5 * 12 + k] > c.data[5 * 12 + kMax]) kMax = k;
  assert.equal(kMax, 0, 'un do donne la note do');
});

test('silence puis bruit : frontière trouvée à ±200 ms', async () => {
  const { analyse } = await analyserSon({ octets: sonFabrique('silencePuisBruit', 10) }, { ecouter: null, modele: null });
  const z = analyse.zones;
  assert.ok(z.length >= 2, JSON.stringify(z));
  assert.equal(z[0].son, false);
  const frontiere = z.find((q) => q.son)!.debut;
  assert.ok(Math.abs(frontiere - 5) <= 0.2, `frontière ${frontiere}`);
  assert.ok(analyse.changements.some((c) => Math.abs(c - 5) <= 0.3), `changements ${analyse.changements}`);
});

test('un sinus à −6 dBFS de crête est mesuré à ±0,2 dB (efficace −9,03 dB)', async () => {
  const amp = 10 ** (-6 / 20);
  const { analyse } = await analyserSon({ octets: ecrireWav16k(sinus(1000, 3, FS, amp)) }, { ecouter: null, modele: null });
  assert.ok(Math.abs(analyse.volume.creteDb + 6) <= 0.2, `crête ${analyse.volume.creteDb}`);
  assert.ok(Math.abs(analyse.volume.rmsDb + 9.03) <= 0.2, `efficace ${analyse.volume.rmsDb}`);
  assert.equal(analyse.onde.length, 30);
});

test('clics à 120 BPM : 120 ± 2, et un second choix', async () => {
  const { analyse } = await analyserSon({ octets: sonFabrique('clics120', 20) }, { ecouter: null, modele: null });
  const t = analyse.musique.tempo!;
  assert.ok(t, 'un tempo');
  assert.ok(Math.abs(t.bpm - 120) <= 2, `tempo ${t.bpm}`);
  assert.ok(t.second > 0 && Math.abs(t.second - t.bpm) / t.bpm > 0.05, `second ${t.second}`);
  assert.ok(t.confiance >= 0 && t.confiance <= 1);
});

test('accord do-mi-sol : « do majeur »', async () => {
  const { analyse } = await analyserSon({ octets: sonFabrique('accordDo', 6) }, { ecouter: null, modele: null });
  const k = analyse.musique.tonalite!;
  assert.equal(k.nom, 'do majeur');
  assert.equal(k.tonique, 0);
  assert.equal(k.mode, 'majeur');
  assert.ok(k.confiance > 0);
  assert.equal(analyse.musique.par, 'sans-modele');
});

/** Une partie : accord (fréquences) avec harmoniques, à un niveau donné. */
function accord(freqs: number[], sec: number, niveau: number, dents = false): Float32Array {
  const n = Math.round(sec * FS), x = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / FS;
    let s = 0;
    for (const f of freqs) for (let h = 1; h <= (dents ? 8 : 2); h++) s += Math.sin(2 * Math.PI * f * h * t) / (dents ? h : h * 3);
    x[i] = niveau * s / freqs.length;
  }
  return x;
}

test('motif A-B-A-B : le groupe A revient, il est marqué répété', async () => {
  // A est plus fort que B (B, en dents de scie, a beaucoup d'harmoniques : on le baisse nettement).
  const A = accord([261.63, 329.63, 392], 8, 0.9), B = accord([185, 220, 277.18], 8, 0.08, true);
  const x = new Float32Array(32 * FS);
  x.set(A, 0); x.set(B, 8 * FS); x.set(A, 16 * FS); x.set(B, 24 * FS);
  // Par le calcul sans modèle directement (tranches de 10 s comme l'analyse).
  const sm = new EcouteSansModele();
  for (let d = 0; d < x.length; d += 10 * FS) {
    const tr = x.subarray(d, d + 10 * FS);
    const mel = logMel(tr);
    sm.ajouter(tr, mel, mfcc(mel), chroma(tr), d / FS);
  }
  const p = sm.parties();
  const groupeA = p.find((q) => q.debut <= 2 && q.fin > 2)!.groupe;
  const groupeA2 = p.find((q) => q.debut <= 18 && q.fin > 18)!.groupe;
  const groupeB = p.find((q) => q.debut <= 10 && q.fin > 10)!.groupe;
  assert.equal(groupeA, groupeA2, JSON.stringify(p));
  assert.notEqual(groupeA, groupeB);
  assert.ok(p.filter((q) => q.groupe === groupeA).length >= 2, 'A est répété');
  assert.ok(p.some((q) => q.groupe === groupeA && q.refrainProbable), `le plus fort des groupes répétés est le refrain probable : ${JSON.stringify(p)}`);
  // Et par l'analyse complète : les mêmes groupes.
  const { analyse } = await analyserSon({ octets: ecrireWav16k(x) }, { ecouter: null, modele: null });
  const pa = analyse.musique.parties;
  assert.equal(pa.find((q) => q.debut <= 2 && q.fin > 2)!.groupe, pa.find((q) => q.debut <= 18 && q.fin > 18)!.groupe);
});

test('empreinte : même son décalé de 3 s et réécrit en 8 bits reconnu ; son différent non ; doublon exact = même sha', async () => {
  const orig = melodie(40, 5);
  const r1 = await analyserSon({ octets: ecrireWav16k(orig) }, { ecouter: null, modele: null });
  const rangés = (e: EmpreinteSon, id: string) => Array.from(e.codes, (c, i) => ({ id, code: c, t: e.instants[i] }));
  const base = rangés(r1.empreinte, 'original');
  assert.ok(r1.empreinte.codes.length > 500, `${r1.empreinte.codes.length} codes`);
  // Le même son, pris à partir de 3 s, réécrit en 8 bits.
  const extrait = orig.slice(3 * FS, 33 * FS);
  const r2 = await analyserSon({ octets: wavDe([extrait], FS, 'u8') }, { ecouter: null, modele: null });
  const v = voterEmpreinte(r2.empreinte, base);
  assert.equal(v[0]?.id, 'original');
  assert.equal(v[0].meme, true, JSON.stringify(v[0]));
  assert.ok(Math.abs(v[0].decalageS - 3) <= 0.02, `décalage ${v[0].decalageS}`);
  // Un son différent.
  const r3 = await analyserSon({ octets: ecrireWav16k(melodie(30, 9)) }, { ecouter: null, modele: null });
  const v3 = voterEmpreinte(r3.empreinte, base);
  assert.ok(!v3[0] || !v3[0].meme, JSON.stringify(v3[0]));
  // Doublon exact.
  const r4 = await analyserSon({ octets: ecrireWav16k(orig) }, { ecouter: null, modele: null });
  assert.equal(r4.analyse.sha, r1.analyse.sha);
  assert.notEqual(r3.analyse.sha, r1.analyse.sha);
});

test('mesures : les vraies durées sur 60 s fabriquées', async (t) => {
  for (const g of ['accordDo', 'clics120'] as const) {
    const { analyse } = await analyserSon({ octets: sonFabrique(g, 60) }, { ecouter: null, modele: null });
    assert.ok(Math.abs(analyse.duree - 60) < 0.01);
    const etapes = analyse.mesures.map((m) => m.etape);
    for (const e of ['decodage', 'spectre', 'sans_modele', 'empreinte', 'total']) assert.ok(etapes.includes(e as never), e);
    assert.ok(!etapes.includes('modele_sons') && !etapes.includes('parole'));
    for (const m of analyse.mesures) t.diagnostic(`${g} ${m.etape} : ${m.ms} ms, ×${m.xTempsReel} temps réel`);
  }
});
