// Syrinx (lot B) — les branchements : réflexe des caméras (jugerAlerte, ecouter_clip), outil audio_analyze du cœur,
// indice des pièces jointes audio, lignes 🎵 et 🔊 dans la ligne de temps d'une vidéo. Fausse oreille, aucun réseau.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Valhalla } from '../src/valhalla/service.ts';
import { syrinx, oreilleEssai } from '../src/valhalla/syrinx/index.ts';
import { jugerAlerte, oublierAntiRafale } from '../src/valhalla/syrinx/cameras.ts';
import { lignesBandeSon, ligneDeTemps, texteLigne } from '../src/valhalla/syrinx/ligne-de-temps.ts';
import { audioAnalyze, AUDIO_TOOLS } from '../src/tools/audio.ts';
import { attachmentHint } from '../src/files/attach.ts';
import { timeline, type Line } from '../src/video/video.ts';
import { DEFAULT_CONFIG } from '../src/config.ts';
import type { ToolContext } from '../src/tools/registry.ts';
import { analyseEssai, fausseOreille, momentEssai } from './syrinx-outils-essai.ts';

const dossiers: string[] = [];
const tmp = (p: string) => { const d = mkdtempSync(join(tmpdir(), p)); dossiers.push(d); return d; };
after(() => { oreilleEssai(); for (const d of dossiers) rmSync(d, { recursive: true, force: true }); });

// La fausse oreille et son analyse fabriquée sont partagées avec l'essai des liens (test/liens.test.ts).
const moment = momentEssai, analyse = analyseEssai, fausse = fausseOreille;

// ------------------------------------------------------------------ Réflexe des caméras
test('jugerAlerte : verre cassé sur 3 pas → alerte ; 1 pas → rien ; deuxième alerte avant 10 min → rien', () => {
  const dix = 10 * 60_000;
  assert.equal(jugerAlerte([moment('verre', 'alerte', 3)], { minPas: 3, maintenant: 1_000_000, antiRafaleMs: dix })?.cle, 'verre');
  assert.equal(jugerAlerte([moment('verre', 'alerte', 1)], { minPas: 3, maintenant: 1_000_000, antiRafaleMs: dix }), undefined);
  assert.equal(jugerAlerte([moment('verre', 'alerte', 3)], { minPas: 3, dernier: 1_000_000 - 5 * 60_000, maintenant: 1_000_000, antiRafaleMs: dix }), undefined);
  assert.equal(jugerAlerte([moment('sonnette', 'maison', 9)], { minPas: 3, maintenant: 1_000_000, antiRafaleMs: dix }), undefined, 'seule la famille « alerte » prévient');
});

test('ecouter_clip : caméra non écoutée → rien ; hors des clips → refus ; clip écouté → une alerte honnête, puis anti-rafale', async () => {
  oublierAntiRafale();
  const { o, appels } = fausse(() => analyse({ parole: { etat: 'non_demandee', segments: [], tours: [], texteRetire: false } }));
  oreilleEssai(o);
  const home = tmp('syrinx-cam-');
  const v = new Valhalla(home, [syrinx(() => ({ ecouter: null, demander: null }))], { notify: async () => {}, fetch: async () => { throw new Error('réseau interdit'); } });
  const ctx = v.ctx('syrinx');
  const clips = join(home, 'valhalla', 'himinbjorg', 'clips', 'entree'); mkdirSync(clips, { recursive: true });
  const clip = join(clips, 'c1.mp4'); writeFileSync(clip, 'clip');
  const ailleurs = join(home, 'ailleurs.mp4'); writeFileSync(ailleurs, 'x');
  const eteinte = await v.act('syrinx', 'ecouter_clip', { camera: 'Entrée', fichier: clip });
  assert.match(eteinte.text, /écoute de cette caméra éteinte/);
  assert.equal(appels.length, 0);
  ctx.saveSettings({ camerasEcoutees: ['Entrée'] });
  const refus = await v.act('syrinx', 'ecouter_clip', { camera: 'Entrée', fichier: ailleurs });
  assert.equal(refus.ok, false); assert.match(refus.text, /refus/);
  const piege = await v.act('syrinx', 'ecouter_clip', { camera: 'Entrée', fichier: join(clips, '..', '..', '..', '..', 'ailleurs.mp4') });
  assert.equal(piege.ok, false);
  const alertes: Array<{ title: string; detail?: string; level: string }> = [];
  v.events.on('alert', (a) => alertes.push(a));
  const r = await v.act('syrinx', 'ecouter_clip', { camera: 'Entrée', fichier: clip });
  assert.equal(r.ok, true, r.text);
  assert.equal(alertes.length, 1);
  assert.equal(alertes[0].title, 'verre cassé : Entrée');
  assert.equal(alertes[0].level, 'haute');
  assert.match(alertes[0].detail ?? '', /probabilité 88 % \(seuil 40 %\) sur 3 pas de 160 ms — codé, pas encore essayé sur du vrai matériel/);
  assert.equal(appels.at(-1)?.op.sonsSeuls, true); assert.equal(appels.at(-1)?.op.ecouter, null, 'rien n\'est transcrit');
  const encore = await v.act('syrinx', 'ecouter_clip', { camera: 'Entrée', fichier: clip });
  assert.equal((encore.data as { alerte: boolean }).alerte, false, 'anti-rafale');
  v.stop();
});

// ------------------------------------------------------------------ Outil du cœur
function ctxOutil(workspace: string, home: string): ToolContext {
  return { sessionId: 's', channel: 'web', peer: 'moi', workspace, home, signal: new AbortController().signal, voice: { ...DEFAULT_CONFIG.voice, localOnly: true }, isTainted: () => false } as unknown as ToolContext;
}

test('audio_analyze : un WAV de l\'espace de travail est décrit, entouré et marqué ; hors de l\'espace refusé ; aucun réseau', async () => {
  const { o, appels } = fausse(() => analyse({ musique: { probable: false, par: 'sans-modele', confiance: 0.1, parties: [] } }));
  oreilleEssai(o);
  const ws = tmp('syrinx-ws-'), home = tmp('syrinx-home-');
  writeFileSync(join(ws, 'memo.wav'), 'RIFF....WAVE');
  const vraiFetch = globalThis.fetch; let reseau = 0;
  globalThis.fetch = (async () => { reseau++; throw new Error('réseau interdit'); }) as typeof fetch;
  try {
    assert.equal(audioAnalyze.risk, 'read'); assert.equal(audioAnalyze.taints, true); assert.deepEqual(AUDIO_TOOLS, [audioAnalyze]);
    const r = await audioAnalyze.run({ path: 'memo.wav' }, ctxOutil(ws, home));
    assert.equal(typeof r, 'object');
    const { output, tainted } = r as { output: string; tainted: boolean };
    assert.equal(tainted, true);
    assert.match(output, /^<untrusted source="son memo\.wav">/);
    assert.match(output, /langue : fr \(confiance 93 %\)/);
    assert.match(output, /voix 1 \(estimation, personne n'est reconnu par sa voix\)/);
    assert.match(output, /verre cassé : 88 % \(seuil 40 %\)/);
    assert.match(output, /Temps mesuré : total 40 ms/);
    assert.match(output, /Ce qui manque : instruments/);
    await assert.rejects(() => audioAnalyze.run({ path: '../ailleurs.wav' }, ctxOutil(ws, home)));
    assert.equal(reseau, 0, 'aucun appel réseau');
    assert.equal(appels.length, 1);
  } finally { globalThis.fetch = vraiFetch; }
});

test('pièces jointes : un .m4a cite audio_analyze', () => {
  assert.match(attachmentHint('inbox/s.m4a', '', 10), /Audio joint.*audio_analyze/);
});

// ------------------------------------------------------------------ Vidéo : la bande son
test('timeline : 🎙 et 💬 inchangés ; 🎵 et 🔊 ajoutés quand la musique et les sons sont donnés', () => {
  const avant: Line[] = [{ t: 1, text: 'bonjour', src: 'paroles' }, { t: 3, text: 'sous-titre', src: 'sous-titres' }];
  const seul = timeline({ lines: avant, frames: [] });
  assert.equal(seul, '[0:01] 🎙 bonjour\n[0:03] 💬 sous-titre');
  const son = lignesBandeSon(analyse());
  assert.ok(son.some((l) => l.src === 'musique') && son.some((l) => l.src === 'sons'));
  const tout = timeline({ lines: [...avant, ...son], frames: [] });
  assert.ok(tout.includes('[0:01] 🎙 bonjour') && tout.includes('[0:03] 💬 sous-titre'));
  assert.match(tout, /🎵 musique, partie A · 120 BPM, do majeur \(71 %\)/);
  assert.match(tout, /🔊 verre cassé \(88 %\)/);
  assert.match(tout, /refrain probable \(estimation\)/);
});

test('ligne de temps d\'un son : une chanson ne montre jamais son texte', () => {
  // Telle que l'oreille la rend : le texte chanté est retiré (texteRetire), le passage reste sans texte.
  const a = analyse({ parole: { etat: 'faite', langue: 'fr', confianceLangue: 0.93, segments: [{ debut: 2, fin: 4 }], tours: [{ debut: 0, fin: 5, voix: 'voix 1' }], texteRetire: true } });
  const ev = ligneDeTemps(a);
  assert.match(texteLigne(ev), /\[00:02\] 🎙 voix 1 : voix chantée \(93 %\)/);
  assert.doesNotMatch(texteLigne(ev), /bonjour/);
});
