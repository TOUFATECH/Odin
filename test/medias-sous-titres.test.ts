// Médias reçus : sous-titres dans toutes les écritures (largeur et vitesse propres), SRT et WebVTT sûrs, relecture
// tolérante et bornée, traduction réplique par réplique par une fonction donnée.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compterGraphemes } from '../src/medias/ecritures.ts';
import { ecrireSrt, ecrireVtt, lireSousTitres, repliquesDepuisSegments, traduireRepliques } from '../src/medias/sous-titres.ts';

const verifier = (r: ReturnType<typeof repliquesDepuisSegments>['repliques'], parLigne: number) => {
  for (const [i, x] of r.entries()) {
    const lignes = x.texte.split('\n');
    assert.ok(lignes.length <= 2, `plus de 2 lignes : ${x.texte}`);
    for (const l of lignes) assert.ok(compterGraphemes(l) <= parLigne, `ligne trop longue (${compterGraphemes(l)}) : ${l}`);
    const d = x.finMs - x.debutMs;
    assert.ok(d >= 800 && d <= 7000, `durée ${d} ms : ${x.texte}`);
    if (i > 0) assert.ok(x.debutMs >= r[i - 1].finMs + 80, 'chevauchement ou écart < 80 ms');
  }
};

test('latin : ≤ 42 graphèmes par ligne, 2 lignes au plus, 0,8–7 s, sans chevauchement', () => {
  const texte = 'Bonjour à toutes et à tous, bienvenue à Mamoudzou pour cette visite du marché couvert. Nous allons commencer par les épices, puis nous irons voir les pêcheurs sur le port avant midi.';
  const { repliques, horodatageApproximatif } = repliquesDepuisSegments([{ debut: 0, fin: 14, texte }]);
  assert.ok(repliques.length >= 3);
  assert.equal(horodatageApproximatif, true);
  verifier(repliques, 42);
  // Aucun mot coupé : le texte recollé redonne les mots d'origine.
  assert.equal(repliques.map((r) => r.texte.split('\n').join(' ')).join(' '), texte);
});

test('japonais sans espaces : ≤ 16 par ligne, coupé à une frontière de mot', () => {
  const texte = '今日はとても良い天気ですね。明日も晴れるといいですね。私は公園に散歩に行きます。';
  const { repliques } = repliquesDepuisSegments([{ debut: 0, fin: 12, texte }], { langue: 'ja' });
  verifier(repliques, 16);
  assert.equal(repliques.map((r) => r.texte.split('\n').join('')).join(''), texte);
  const seg = new Intl.Segmenter('ja', { granularity: 'word' });
  const frontieres = new Set([...seg.segment(texte)].map((s) => s.index));
  let pos = 0;
  for (const r of repliques) {
    for (const l of r.texte.split('\n')) { assert.ok(frontieres.has(pos) || pos === 0, `coupure dans un mot à ${pos}`); pos += l.length; }
  }
});

test('avec temps par mot : horodatage exact', () => {
  const mots = [['Salut', 0, 0.4], ['tout', 0.5, 0.8], ['le', 0.85, 0.95], ['monde.', 1.0, 1.5], ['Comment', 3.0, 3.4], ['ça', 3.45, 3.6], ['va', 3.65, 3.9]].map(([texte, debut, fin]) => ({ texte: texte as string, debut: debut as number, fin: fin as number }));
  const { repliques, horodatageApproximatif } = repliquesDepuisSegments([{ debut: 0, fin: 1.5, texte: 'Salut tout le monde.' }, { debut: 3, fin: 3.9, texte: 'Comment ça va' }], { mots });
  assert.equal(horodatageApproximatif, false);
  assert.equal(repliques[0].debutMs, 0);
  assert.equal(repliques[1].debutMs, 3000);
});

test('SRT : CRLF, numéroté, « --> » et « < » neutralisés ; arabe préfixé de U+200F', () => {
  const srt = ecrireSrt([
    { debutMs: 0, finMs: 1500, texte: 'a --> b <i>x</i>' },
    { debutMs: 2000, finMs: 4000, texte: 'مرحبا بكم في مامودزو.' },
  ]);
  assert.ok(srt.startsWith('1\r\n00:00:00,000 --> 00:00:01,500\r\n'));
  assert.ok(srt.includes('a → b ‹i>x‹/i>'));
  assert.ok(srt.includes('\r\n2\r\n00:00:02,000 --> 00:00:04,000\r\n‏مرحبا بكم في مامودزو.‏\r\n'));
  assert.ok(!srt.includes('‮'));
  assert.ok(ecrireSrt([{ debutMs: 0, finMs: 900, texte: 'x' }], { bom: true }).startsWith('﻿1'));
});

test('WebVTT : en-tête et langue, échappement, voix', () => {
  const vtt = ecrireVtt([{ debutMs: 1000, finMs: 2500, texte: 'Tom & Jerry <3', voix: 'Voix 1' }], { langue: 'fr' });
  assert.ok(vtt.startsWith('WEBVTT\nLanguage: fr\n\n00:00:01.000 --> 00:00:02.500\n'));
  assert.ok(vtt.includes('<v Voix 1>Tom &amp; Jerry &lt;3'));
});

test('relecture : numéros faux, point au lieu de virgule, BOM, UTF-16', () => {
  const brut = '﻿7\r\n00:00:01.000 --> 00:00:02,500\r\nPremière ligne\r\n\r\n99\r\n00:00:03,000 --> 00:00:04,000\r\nDeux\r\nlignes\r\n';
  const a = lireSousTitres(brut);
  assert.equal(a.format, 'srt');
  assert.deepEqual(a.repliques.map((r) => [r.debutMs, r.finMs, r.texte]), [[1000, 2500, 'Première ligne'], [3000, 4000, 'Deux\nlignes']]);
  const u16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(brut.slice(1), 'utf16le')]);
  assert.deepEqual(lireSousTitres(u16).repliques.map((r) => r.texte), ['Première ligne', 'Deux\nlignes']);
  const v = lireSousTitres('WEBVTT\n\nNOTE rien\n\n01:02.000 --> 01:03.500 align:start\n<v Awa>Bonjour &amp; bienvenue\n');
  assert.equal(v.format, 'vtt');
  assert.equal(v.repliques[0].debutMs, 62000);
  assert.equal(v.repliques[0].voix, 'Awa');
  assert.equal(v.repliques[0].texte, 'Bonjour & bienvenue');
});

test('SRT hostile : ligne de 5 Mio, 200 000 répliques → partiel en moins de 100 ms', () => {
  let t0 = performance.now();
  const r1 = lireSousTitres(`1\n00:00:01,000 --> 00:00:02,000\n${'x'.repeat(5 * 1024 * 1024)}\n`);
  const ms1 = performance.now() - t0;
  assert.ok(r1.partiel);
  const bloc = '1\n00:00:01,000 --> 00:00:02,000\nab\n\n';
  const enorme = bloc.repeat(200_000);
  t0 = performance.now();
  const r2 = lireSousTitres(enorme);
  const ms2 = performance.now() - t0;
  assert.ok(r2.partiel);
  assert.ok(r2.repliques.length <= 100_000);
  assert.ok(ms1 < 100 && ms2 < 100, `${Math.round(ms1)} ms et ${Math.round(ms2)} ms`);
});

test('traduction par une fausse fonction : mêmes temps, original gardé, échec → original + manque', async () => {
  const r = [
    { debutMs: 0, finMs: 2000, texte: 'Bonjour' },
    { debutMs: 3000, finMs: 5000, texte: 'ÉCHEC ici' },
    { debutMs: 6000, finMs: 8000, texte: 'Au revoir' },
  ];
  const contextes: string[][] = [];
  const t = await traduireRepliques(r, 'en', async (texte, vers, o) => { contextes.push(o.contexte ?? []); if (texte.startsWith('ÉCHEC')) throw new Error('service muet'); return `[${vers}] ${texte}`; });
  assert.deepEqual(t.repliques.map((x) => [x.debutMs, x.finMs]), [[0, 2000], [3000, 5000], [6000, 8000]]);
  assert.equal(t.repliques[0].texte, '[en] Bonjour');
  assert.equal(t.repliques[0].original, 'Bonjour');
  assert.equal(t.repliques[1].texte, 'ÉCHEC ici');
  assert.equal(t.manque.length, 1);
  assert.equal(t.manque[0].code, 'echec');
  assert.deepEqual(contextes[1], ['Bonjour', 'Au revoir']);
});
