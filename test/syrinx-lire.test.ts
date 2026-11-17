// Syrinx — lire le son (lot A). Le WAV sous toutes ses formes, relu juste ; des WAV hostiles refusés sans allocation
// géante ; le rééchantillonnage vers 16 kHz (un sinus de 10 kHz disparaît) ; les octets magiques ; et le décodeur sans
// l'outil média (un faux lanceur qui ne trouve rien : 'outil_absent', aucun processus lancé).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { lireWav, formatSon, ecrireWav16k, ErreurSon, sonFabrique } from '../src/audio/index.ts';
import { reechantillonner, Reechantillonneur } from '../src/audio/reech.ts';
import { lireSon } from '../src/audio/decoder.ts';
import type { Lanceur } from '../src/audio/contrat.ts';
import { sinus, wavDe, type Codage } from './syrinx-outils-essai.ts';

const ecartMax = (a: Float32Array, b: Float32Array): number => { let m = 0; for (let i = 0; i < Math.min(a.length, b.length); i++) m = Math.max(m, Math.abs(a[i] - b[i])); return m; };

test('un sinus de 440 Hz est relu juste dans tous les codages, et en forme extensible', () => {
  const s = sinus(440, 0.25, 16000, 0.5);
  const tolerance: Record<Codage, number> = { u8: 0.01, s16: 1e-4, s24: 1e-6, s32: 1e-6, f32: 1e-7, f64: 1e-7, alaw: 0.02, mulaw: 0.02 };
  for (const c of Object.keys(tolerance) as Codage[]) {
    for (const extensible of [false, true]) {
      const r = lireWav(wavDe([s], 16000, c, { extensible }));
      assert.equal(r.fs, 16000, c);
      assert.equal(r.canaux, 1);
      assert.equal(r.mono.length, s.length, c);
      assert.ok(ecartMax(r.mono, s) <= tolerance[c], `${c}${extensible ? ' extensible' : ''} : écart ${ecartMax(r.mono, s)}`);
    }
  }
});

test('la stéréo est moyennée en mono', () => {
  const g = sinus(440, 0.1, 16000, 0.5), d = new Float32Array(g.length).fill(0.25);
  const r = lireWav(wavDe([g, d], 22050, 's16'));
  assert.equal(r.canaux, 2);
  assert.equal(r.fs, 22050);
  for (let i = 0; i < 50; i++) assert.ok(Math.abs(r.mono[i] - (g[i] + 0.25) / 2) < 1e-4);
});

/** Modifie un WAV fabriqué. */
function retouche(w: Uint8Array, f: (dv: DataView, o: Uint8Array) => void): Uint8Array {
  const c = w.slice();
  f(new DataView(c.buffer), c);
  return c;
}

function refuse(w: Uint8Array, codes: string[] = ['refuse']): void {
  assert.throws(() => lireWav(w), (e: unknown) => e instanceof ErreurSon && codes.includes(e.code), 'devait être refusé');
}

test('des WAV hostiles sont refusés, sans allocation géante', () => {
  const base = wavDe([sinus(440, 0.1)], 16000, 's16');
  // data plus grand que le fichier (et démesuré : aucune allocation n'est faite avant le refus)
  refuse(retouche(base, (dv) => dv.setUint32(40, 0x7ffffff0, true)));
  // 0 canal, 9 canaux
  refuse(retouche(base, (dv) => dv.setUint16(22, 0, true)));
  refuse(retouche(base, (dv) => dv.setUint16(22, 9, true)));
  // fréquence 0 et 10^7
  refuse(retouche(base, (dv) => dv.setUint32(24, 0, true)));
  refuse(retouche(base, (dv) => dv.setUint32(24, 10_000_000, true)));
  // 12 bits
  refuse(retouche(base, (dv) => dv.setUint16(34, 12, true)));
  // alignement de bloc incohérent
  refuse(retouche(base, (dv) => dv.setUint16(32, 3, true)));
  // durée au-delà du plafond
  assert.throws(() => lireWav(wavDe([sinus(440, 2)], 16000, 's16'), { maxSec: 1 }), (e: unknown) => e instanceof ErreurSon && e.code === 'trop_long');
  // 65 blocs inconnus avant les données
  {
    const blocs = new Uint8Array(65 * 8);
    for (let i = 0; i < 65; i++) blocs.set([0x6a, 0x75, 0x6e, 0x6b, 0, 0, 0, 0], i * 8); // « junk » de taille 0
    const w = new Uint8Array(12 + blocs.length + base.length - 12);
    w.set(base.subarray(0, 12), 0); w.set(blocs, 12); w.set(base.subarray(12), 12 + blocs.length);
    refuse(w);
  }
  // octet de bourrage manquant : un bloc de taille impaire sans son octet de bourrage décale tout
  {
    const bloc = new Uint8Array([0x6a, 0x75, 0x6e, 0x6b, 3, 0, 0, 0, 1, 2, 3]); // 3 octets, pas de bourrage
    const w = new Uint8Array(base.length + bloc.length);
    w.set(base.subarray(0, 36), 0); w.set(bloc, 36); w.set(base.subarray(36), 36 + bloc.length);
    refuse(w);
    // Avec l'octet de bourrage, le même fichier est lu.
    const bon = new Uint8Array(base.length + bloc.length + 1);
    bon.set(base.subarray(0, 36), 0); bon.set(bloc, 36); bon.set(base.subarray(36), 36 + bloc.length + 1);
    assert.equal(lireWav(bon).mono.length, 1600);
  }
  // pas un WAV
  refuse(new Uint8Array(100));
});

test('rééchantillonnage : un sinus de 10 kHz à 44,1 kHz disparaît sous −90 dB à 16 kHz ; un 1 kHz passe', () => {
  const x = sinus(10_000, 2, 44_100, 1);
  const y = reechantillonner(x, 44_100);
  assert.ok(Math.abs(y.length - 32_000) <= 1, `longueur ${y.length}`);
  let e = 0; for (let i = 2000; i < y.length - 2000; i++) e += y[i] * y[i];
  const db = 10 * Math.log10(e / (y.length - 4000) / 0.5);
  assert.ok(db < -90, `résidu ${db.toFixed(1)} dB`);
  const z = reechantillonner(sinus(1000, 1, 44_100, 0.5), 44_100);
  let p = 0; for (let i = 1000; i < z.length - 1000; i++) p += z[i] * z[i];
  const gain = 10 * Math.log10(p / (z.length - 2000) / 0.125);
  assert.ok(Math.abs(gain) < 0.1, `gain ${gain.toFixed(3)} dB`);
});

test('rééchantillonnage en flux : par morceaux, le même résultat que d\'un coup', () => {
  const x = sinus(700, 1, 48_000, 0.5);
  const tout = reechantillonner(x, 48_000);
  const r = new Reechantillonneur(48_000);
  const parts: Float32Array[] = [];
  for (let i = 0; i < x.length; i += 7777) parts.push(r.pousser(x.subarray(i, i + 7777)));
  parts.push(r.finir());
  const flux = new Float32Array(parts.reduce((a, p) => a + p.length, 0));
  let o = 0; for (const p of parts) { flux.set(p, o); o += p.length; }
  assert.equal(flux.length, tout.length);
  assert.ok(ecartMax(flux, tout) < 1e-6);
});

test('formatSon reconnaît les 7 octets magiques', () => {
  const b = (...v: Array<number | string>) => { const o: number[] = []; for (const x of v) if (typeof x === 'string') for (const c of x) o.push(c.charCodeAt(0)); else o.push(x); while (o.length < 12) o.push(0); return Uint8Array.from(o); };
  assert.equal(formatSon(b('RIFF', 0, 0, 0, 0, 'WAVE')), 'wav');
  assert.equal(formatSon(b('fLaC')), 'flac');
  assert.equal(formatSon(b('ID3')), 'mp3');
  assert.equal(formatSon(b(0xff, 0xfb, 0x90)), 'mp3');
  assert.equal(formatSon(b('OggS')), 'ogg');
  assert.equal(formatSon(b(0, 0, 0, 0x20, 'ftyp')), 'mp4');
  assert.equal(formatSon(b(0x1a, 0x45, 0xdf, 0xa3)), 'webm');
  assert.equal(formatSon(b('FORM', 0, 0, 0, 0, 'AIFF')), 'aiff');
  assert.equal(formatSon(b('bonjour')), 'inconnu');
});

test('ecrireWav16k écrête et se relit ; sonFabrique rend des WAV 16 kHz', () => {
  const w = ecrireWav16k(Float32Array.from([0, 0.5, 2, -3]));
  const r = lireWav(w);
  assert.equal(r.fs, 16000);
  assert.ok(Math.abs(r.mono[1] - 0.5) < 1e-4);
  assert.ok(r.mono[2] > 0.999 && r.mono[3] <= -0.999);
  for (const g of ['clics120', 'accordDo', 'silencePuisBruit'] as const) assert.equal(lireWav(sonFabrique(g, 2)).mono.length, 32000);
});

test('décodeur : un WAV en tranches de 10 s à 16 kHz ; un autre format sans l\'outil média → outil_absent, rien lancé', async () => {
  const dossier = mkdtempSync(join(tmpdir(), 'syrinx-lire-'));
  try {
    const f = join(dossier, 'long.wav');
    writeFileSync(f, wavDe([sinus(440, 23, 44_100, 0.3)], 44_100, 's16'));
    const tailles: number[] = [];
    for await (const { tranche, info } of lireSon({ fichier: f })) { tailles.push(tranche.length); assert.equal(info.via, 'natif'); assert.equal(info.fs, 44_100); }
    assert.deepEqual(tailles.slice(0, 2), [160_000, 160_000]);
    assert.ok(Math.abs(tailles[2] - 48_000) <= 1);

    let appels = 0;
    const lanceur: Lanceur = (_cmd, args) => {
      appels++;
      // Jamais de shell : un tableau ; le fichier en chemin absolu préfixé de « file: », juste après « -i ».
      assert.ok(Array.isArray(args));
      assert.match(args[args.indexOf('-i') + 1], /^file:/);
      // Lecture bornée aux fichiers locaux, et la borne est posée AVANT la source (elle ne vaut que pour ce qui la suit).
      const borne = args.indexOf('-protocol_whitelist');
      assert.ok(borne >= 0 && borne < args.indexOf('-i'), 'la borne des protocoles précède la source');
      assert.equal(args[borne + 1], 'file,pipe');
      return undefined;
    };
    const ogg = new Uint8Array(64); ogg.set([0x4f, 0x67, 0x67, 0x53]);
    const fOgg = join(dossier, 'son.ogg');
    writeFileSync(fOgg, ogg);
    await assert.rejects(async () => { for await (const _ of lireSon({ fichier: fOgg }, { lancer: lanceur })) { /* rien */ } }, (e: unknown) => e instanceof ErreurSon && e.code === 'outil_absent' && /outil média local/.test(e.message));
    assert.equal(appels, 1, 'le lanceur injecté est seul consulté');
    // En octets : écrit dans le dossier de travail puis effacé.
    const travail = join(dossier, 'travail');
    await assert.rejects(async () => { for await (const _ of lireSon({ octets: ogg }, { lancer: lanceur, dossierTemp: travail })) { /* rien */ } }, (e: unknown) => e instanceof ErreurSon && e.code === 'outil_absent');
    const { readdirSync } = await import('node:fs');
    assert.deepEqual(readdirSync(travail), [], 'le fichier de travail est effacé');
    // Un faux outil qui rend des flottants : lus et découpés.
    const pcm = sinus(440, 12, 16000, 0.3);
    const faux: Lanceur = () => ({
      stdout: (async function* () { const b = new Uint8Array(pcm.buffer.slice(0)); for (let i = 0; i < b.length; i += 4099) yield b.subarray(i, i + 4099); })(),
      fin: Promise.resolve({ code: 0, err: '' }),
    });
    const t2: number[] = [];
    for await (const { tranche, info } of lireSon({ fichier: fOgg }, { lancer: faux })) { t2.push(tranche.length); assert.equal(info.via, 'outil-media'); assert.equal(info.format, 'ogg'); }
    assert.deepEqual(t2, [160_000, 32_000]);
    // Fichier absent.
    await assert.rejects(async () => { for await (const _ of lireSon({ fichier: join(dossier, 'nulle-part.wav') })) { /* rien */ } }, (e: unknown) => e instanceof ErreurSon && e.code === 'introuvable');
  } finally {
    rmSync(dossier, { recursive: true, force: true });
  }
});
