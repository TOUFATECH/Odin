// Syrinx — les corrections de la relecture : chaque essai attrape un défaut relevé (zones, musique sans modèle, paroles
// d'une chanson, 🎵 placé là où est la musique, texte honnête du modèle absent, rien vers le modèle de texte sans accord,
// tours de parole bornés, mode privé qui efface le son déposé, réglages graves, transcription locale seule, modèle qui
// rend la main, corrections chiffrées, index des empreintes tenu à jour, voie des clips de caméra, page lisible).
// Aucun outil média, aucune transcription réelle, aucun vrai poids, aucun réseau.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { analyserSon, ecrireWav16k, ErreurSon, ouvrirModeleSons, sonFabrique } from '../src/audio/index.ts';
import { zonesDe } from '../src/audio/sansmodele.ts';
import { analyserParole, sonEnMemoire, tours } from '../src/audio/parole.ts';
import type { ModeleSonsOuvert } from '../src/audio/modele-sons.ts';
import type { AnalyseSon, OptionsAnalyse, SourceSon } from '../src/audio/contrat.ts';
import { Valhalla } from '../src/valhalla/service.ts';
import { syrinx, oreilleEssai, oublierDerniers, type OptionsSyrinx, type Oreille } from '../src/valhalla/syrinx/index.ts';
import { indexEmpreintes, lireCorrections, oublierMagasin, rangerAnalyse } from '../src/valhalla/syrinx/magasin.ts';
import { DEF_SYRINX, oublierBranchementsSyrinx } from '../src/valhalla/syrinx/base.ts';
import { transcriptionLocalePrete } from '../src/valhalla/syrinx/bande-son.ts';
import { ligneDeTemps, quandLocal, rapportSon, texteLigne, texteModeleAbsent } from '../src/valhalla/syrinx/ligne-de-temps.ts';
import { DEFAULT_CONFIG } from '../src/config.ts';
import { chanson, ecrireMiniModele, melodie, parle, voix } from './syrinx-outils-essai.ts';

const FS = 16_000;
const dossiers: string[] = [];
const tmp = (p: string) => { const d = mkdtempSync(join(tmpdir(), p)); dossiers.push(d); return d; };
after(() => { oreilleEssai(); for (const d of dossiers) rmSync(d, { recursive: true, force: true }); });
const partSon = (a: AnalyseSon) => a.zones.filter((z) => z.son).reduce((s, z) => s + z.fin - z.debut, 0) / a.duree;

// ------------------------------------------------------------------ 1. Zones de son et de silence
test('zones : une musique forte et continue est du son (> 90 %), la parole aussi, le motif alterné ne s\'émiette pas', async () => {
  const x = chanson(12, 1);
  const { analyse } = await analyserSon({ octets: ecrireWav16k(x) }, { ecouter: null, modele: null });
  assert.ok(analyse.volume.rmsDb > -25, `volume ${analyse.volume.rmsDb}`);
  assert.ok(partSon(analyse) > 0.9, `part de son ${partSon(analyse)}`);
  const p = await analyserSon({ octets: ecrireWav16k(parle(20, 7)) }, { ecouter: null, modele: null });
  assert.ok(partSon(p.analyse) > 0.6, `parole : part de son ${partSon(p.analyse)}`);
  // Motif alterné −20 / −31 dBFS : tout est du son, en UNE zone (plus d'oscillation à 120 zones).
  const alterne = Array.from({ length: 120 }, (_, i) => (i % 2 ? -31 : -20));
  assert.deepEqual(zonesDe(alterne), [{ debut: 0, fin: 12, son: true }]);
  // Un silence vrai reste un silence ; un trou de 100 ms entre deux sons est comblé ; un son bref reste un son.
  const z = zonesDe([-100, -100, -100, -20, -100, -20, -20, -100, -100, -100, -15, -100, -100, -100]);
  assert.deepEqual(z.map((q) => [q.debut, q.fin, q.son]), [[0, 0.3, false], [0.3, 0.7, true], [0.7, 1, false], [1, 1.1, true], [1.1, 1.4, false]]);
});

// ------------------------------------------------------------------ 2. Musique probable sans modèle
test('musique sans modèle : chansons, mélodie et accord passent ; parole, deux voix, bruit et clics non', async () => {
  const bruit = (() => { let s = 5; return Float32Array.from({ length: 20 * FS }, () => { s = (s * 1103515245 + 12345) >>> 0; return (s / 2 ** 32 - 0.5) * 0.6; }); })();
  const deuxVoix = new Float32Array(30 * FS); deuxVoix.set(parle(15, 3, 110, 600)); deuxVoix.set(parle(15, 9, 210, 1100), 15 * FS);
  const cas: Array<[string, Uint8Array, boolean]> = [
    ['chanson', ecrireWav16k(chanson(30, 1)), true],
    ['chanson à 96 BPM', ecrireWav16k(chanson(30, 4, 96)), true],
    ['mélodie', ecrireWav16k(melodie(20, 3)), true],
    ['accord tenu', sonFabrique('accordDo', 15), true],
    ['parole', ecrireWav16k(parle(30, 7)), false],
    ['deux voix', ecrireWav16k(deuxVoix), false],
    ['bruit', ecrireWav16k(bruit), false],
    ['clics', sonFabrique('clics120', 30), false],
  ];
  for (const [nom, octets, attendu] of cas) {
    const { analyse } = await analyserSon({ octets }, { ecouter: null, modele: null });
    assert.equal(analyse.musique.probable, attendu, `${nom} : confiance ${analyse.musique.confiance}`);
    assert.equal(analyse.musique.par, 'sans-modele');
  }
});

// ------------------------------------------------------------------ 3. Paroles d'une chanson, sans modèle de sons
test('sans modèle de sons : les paroles d\'une chanson ne sont ni montrées, ni envoyées ; le modèle de texte absent n\'est jamais appelé', async () => {
  const paroles = 'les vagues reviennent toujours sur la plage où tu dansais encore';
  const ecouter: OptionsAnalyse['ecouter'] = async () => ({ text: paroles, language: 'fr', segments: [{ start: 1, end: 9, text: paroles }] });
  const { analyse } = await analyserSon({ octets: ecrireWav16k(chanson(12, 2)) }, { ecouter, modele: undefined, demander: null });
  assert.equal(analyse.parole.texteRetire, true);
  const vu = `${rapportSon(analyse)}\n${texteLigne(ligneDeTemps(analyse))}\n${JSON.stringify(analyse)}`;
  assert.doesNotMatch(vu, /vagues/);
  assert.match(texteLigne(ligneDeTemps(analyse)), /🎵/, '🎵 apparaît sans modèle quand la musique est probable');
});

// ------------------------------------------------------------------ 4. 🎵 et texte retiré seulement là où est la musique
test('le modèle n\'entend la musique que de 10 à 30 s : 🎵 n\'est que là, et la conversation de 0 à 10 s garde son texte', async () => {
  const zones = [{ debut: 10, fin: 30 }];
  const son = sonEnMemoire(new Float32Array(40 * FS));
  const p = await analyserParole(son, {
    ecouter: async () => ({ text: 'on se voit demain chante la mer', language: 'fr', segments: [{ start: 1, end: 6, text: 'on se voit demain' }, { start: 12, end: 20, text: 'chante la mer' }] }),
    musiqueProbable: true, zonesMusique: zones,
  });
  assert.equal(p.texteRetire, true);
  assert.equal(p.segments[0].texte, 'on se voit demain');
  assert.equal(p.segments[1].texte, undefined);
  assert.equal(p.texte, 'on se voit demain');
  const a: AnalyseSon = {
    version: 1, duree: 40, source: { format: 'wav', fs: FS, canaux: 1, via: 'natif' }, sha: 'x', onde: [], volume: { rmsDb: -20, creteDb: -3 },
    zones: [{ debut: 0, fin: 30, son: true }, { debut: 30, fin: 40, son: false }], changements: [],
    musique: { probable: true, par: 'modele', confiance: 0.9, parties: [{ debut: 0, fin: 10, groupe: 'A', refrainProbable: false }, { debut: 10, fin: 30, groupe: 'B', refrainProbable: false }, { debut: 30, fin: 40, groupe: 'C', refrainProbable: false }] },
    sons: { etat: 'fait', etiquettes: [], moments: [{ debut: 10, fin: 30, indice: 1, cle: 'Music', libelle: 'musique', famille: 'musique', pMax: 0.9, pas: 120 }] },
    parole: { ...p, tours: [] }, mesures: [], manque: [],
  };
  const ev = ligneDeTemps(a);
  const musique = ev.filter((e) => e.type === 'musique');
  assert.deepEqual(musique.map((e) => [e.debut, e.fin]), [[10, 30]], JSON.stringify(musique));
  const t = texteLigne(ev);
  assert.match(t, /\[00:01\] 🎙 on se voit demain/);
  assert.match(t, /\[00:12\] 🎙 voix chantée/);
  assert.doesNotMatch(t, /chante la mer/);
});

// ------------------------------------------------------------------ Une fausse oreille pour l'appli
function fausseOreille() {
  const etat = { options: [] as OptionsAnalyse[] };
  const o: Oreille = {
    CATALOGUE_SONS: { taille: 22 * 1024 * 1024, licence: 'Apache-2.0' },
    async analyserSon(src: SourceSon, op: OptionsAnalyse = {}) {
      etat.options.push(op);
      const octets = 'fichier' in src ? readFileSync(src.fichier) : Buffer.from(src.octets);
      const sha = createHash('sha256').update(octets).digest('hex');
      const sons: AnalyseSon['sons'] = op.modele === null ? { etat: 'non_demande', etiquettes: [], moments: [] } : { etat: 'pas_pret', raison: 'modèle de sons : pas téléchargé (22 Mo, Apache-2.0)', etiquettes: [], moments: [] };
      let parole: AnalyseSon['parole'] = { etat: 'pas_prete', segments: [], tours: [], texteRetire: false };
      if (op.ecouter) {
        const h = await op.ecouter(new Uint8Array(4), 'audio/wav');
        parole = { etat: 'faite', texte: h.text, langue: 'fr', segments: h.segments.map((x) => ({ debut: x.start, fin: x.end, texte: x.text })), tours: [], texteRetire: false };
      }
      const analyse: AnalyseSon = {
        version: 1, duree: 2, source: { format: 'wav', fs: FS, canaux: 1, via: 'natif' }, sha, onde: [0.1, 0.74, 0.3],
        volume: { rmsDb: -20, creteDb: -3 }, zones: [{ debut: 0, fin: 2, son: true }], changements: [],
        musique: { probable: false, par: 'sans-modele', confiance: 0.2, parties: [] }, sons, parole,
        mesures: [{ etape: 'decodage', ms: 3.2, xTempsReel: 620 }, { etape: 'sans_modele', ms: 800, xTempsReel: 2.5 }], manque: [],
      };
      return { analyse, empreinte: { sha, codes: Uint32Array.from(octets.subarray(0, 16)), instants: Uint32Array.from({ length: Math.min(16, octets.length) }, (_, k) => k) } };
    },
    async ouvrirModeleSons() { return { pret: false, raison: 'pas téléchargé', classes: 0, libelles: [], classer: async () => { throw new Error('pas prêt'); } }; },
    etatModeleSons: () => ({ present: false, verifie: false, aTourne: false }),
    async telechargerModeleSons() { return { ok: false, texte: 'non' }; },
    voterEmpreinte: () => [],
    sonFabrique: () => new Uint8Array(64).fill(7),
  };
  return { o, etat };
}

function monter(opts: OptionsSyrinx, ask?: (t: string) => Promise<string>) {
  oublierMagasin(); oublierDerniers(); oublierBranchementsSyrinx();
  const home = tmp('syrinx-corr-');
  const mod = syrinx(() => opts);
  const v = new Valhalla(home, [mod], { notify: async () => {}, fetch: async () => { throw new Error('réseau interdit dans les essais'); }, ask });
  const ctx = v.ctx('syrinx');
  const deposer = (nom: string, contenu: string) => { mkdirSync(join(ctx.dir, 'atelier'), { recursive: true }); writeFileSync(join(ctx.dir, 'atelier', nom), contenu); };
  return { v, mod, ctx, home, deposer };
}

// ------------------------------------------------------------------ 5. Modèle absent : le texte honnête, pas « non demandés »
test('modèle de sons absent : « pas téléchargé (22 Mo, Apache-2.0) », jamais « sons : non demandés », sans préfixe doublé', async () => {
  const { o, etat } = fausseOreille(); oreilleEssai(o);
  const { v, deposer } = monter({ ecouter: null, demander: null, modele: async () => undefined });
  deposer('a.wav', 'AAAA');
  const r = await v.act('syrinx', 'ecouter', { fichier: 'atelier:a.wav' });
  assert.equal(etat.options.at(-1)?.modele, undefined, 'le modèle absent n\'est pas passé comme « non demandé » (null)');
  assert.match(r.text, /modèle de sons : pas téléchargé \(22 Mo, Apache-2\.0\)/);
  assert.doesNotMatch(r.text, /non demandés|modèle de sons : modèle de sons/);
  deposer('b.wav', 'BBBB');
  await v.act('syrinx', 'parole', { fichier: 'atelier:b.wav' });
  assert.equal(etat.options.at(-1)?.modele, null, 'la parole seule ne demande pas le modèle');
  assert.equal(texteModeleAbsent('modèle de sons en échec : x'), 'modèle de sons en échec : x');
  assert.equal(texteModeleAbsent('pas de fichier'), 'modèle de sons : pas de fichier');
});

// ------------------------------------------------------------------ 6. Rien vers le modèle de texte sans accord, jamais en mode privé
test('le modèle de texte d\'Odin n\'est appelé que si le propriétaire l\'allume (accord demandé), et jamais en mode privé', async () => {
  const { o } = fausseOreille(); oreilleEssai(o);
  const demandes: string[] = [];
  const ask = async (t: string) => { demandes.push(t); return '{"resume":"r","moments":[],"ambiance":"calme"}'; };
  const ecouter: OptionsSyrinx['ecouter'] = async () => ({ text: 'mon code de carte est 4242', language: 'fr', segments: [{ start: 0, end: 2, text: 'mon code de carte est 4242' }] });
  const opts: OptionsSyrinx = { ecouter, modele: async () => undefined, voice: { ...DEFAULT_CONFIG.voice } };
  const { v, ctx, deposer } = monter(opts, ask);
  deposer('a.wav', 'AAAA');
  await v.act('syrinx', 'ecouter', { fichier: 'atelier:a.wav' });
  assert.equal(demandes.length, 0, 'éteint par défaut : rien n\'est envoyé');
  // L'allumer est grave : refusé à une automatisation.
  const auto = await v.act('syrinx', 'regler', { resumeModele: true }, { auto: true });
  assert.equal(auto.ok, false);
  assert.match(auto.text, /grave/);
  await v.act('syrinx', 'regler', { resumeModele: true });
  assert.equal(ctx.settings.resumeModele, true);
  deposer('b.wav', 'BBBB');
  await v.act('syrinx', 'ecouter', { fichier: 'atelier:b.wav' });
  assert.equal(demandes.length, 1, 'allumé : le résumé passe par le modèle de texte');
  opts.voice = { ...DEFAULT_CONFIG.voice, privacy: { privateMode: true, keepAudio: false, keepAudioDays: 7 } };
  deposer('c.wav', 'CCCC');
  await v.act('syrinx', 'ecouter', { fichier: 'atelier:c.wav' });
  assert.equal(demandes.length, 1, 'mode privé : rien n\'est envoyé, même allumé');
});

// ------------------------------------------------------------------ 7. Tours de parole bornés
test('tours de parole : 5 000 segments en moins d\'une seconde, sans figer le serveur, et l\'arrêt est entendu', async () => {
  const segs = Array.from({ length: 5000 }, (_, i) => ({ debut: i, fin: i + 0.9 }));
  const a = Array.from({ length: 38 }, (_, d) => (d % 2 ? 1 : 0.2)), b = Array.from({ length: 38 }, (_, d) => (d % 3 ? 0.1 : 1));
  let ticks = 0; const minuteur = setInterval(() => { ticks++; }, 1);
  const t0 = performance.now();
  const t = await tours(segs, () => new Float32Array(0), { timbreDe: (d) => (Math.floor(d / 50) % 2 ? a : b) });
  const ms = performance.now() - t0;
  clearInterval(minuteur);
  assert.ok(ms < 1000, `${Math.round(ms)} ms`);
  assert.ok(ticks > 0, 'le minuteur a tourné pendant le regroupement');
  assert.deepEqual([...new Set(t.map((x) => x.voix))], ['voix 1', 'voix 2']);
  const arret = new AbortController(); arret.abort();
  await assert.rejects(tours(segs, () => new Float32Array(0), { signal: arret.signal, timbreDe: () => a }), (e) => e instanceof ErreurSon && e.code === 'arrete');
  // Deux vraies voix fabriquées, timbre calculé sur l'extrait : toujours séparées.
  const x = new Float32Array(8 * FS); x.set(voix(110, 500, 4, 1)); x.set(voix(230, 1500, 4, 2), 4 * FS);
  const s = sonEnMemoire(x);
  const v2 = await tours([{ debut: 0, fin: 2 }, { debut: 2, fin: 4 }, { debut: 4, fin: 6 }, { debut: 6, fin: 8 }], s.extrait);
  assert.deepEqual(v2.map((q) => q.voix), ['voix 1', 'voix 2']);
});

// ------------------------------------------------------------------ 8. Mode privé : le son déposé est effacé
test('mode privé : après « écouter », l\'atelier est vide ; hors mode privé, le son reste (conservation)', async () => {
  const { o } = fausseOreille(); oreilleEssai(o);
  const opts: OptionsSyrinx = { ecouter: null, demander: null, modele: async () => undefined, voice: { ...DEFAULT_CONFIG.voice, privacy: { privateMode: true, keepAudio: false, keepAudioDays: 7 } } };
  const { v, ctx, deposer } = monter(opts);
  deposer('secret.wav', 'SECRET');
  const r = await v.act('syrinx', 'ecouter', { fichier: 'atelier:secret.wav' });
  assert.equal(r.ok, true, r.text);
  assert.deepEqual(readdirSync(join(ctx.dir, 'atelier')), []);
  opts.voice = { ...DEFAULT_CONFIG.voice };
  deposer('garde.wav', 'GARDE');
  await v.act('syrinx', 'ecouter', { fichier: 'atelier:garde.wav' });
  assert.deepEqual(readdirSync(join(ctx.dir, 'atelier')), ['garde.wav']);
  // Au démarrage, les fichiers de travail laissés par un arrêt brutal sont effacés.
  mkdirSync(join(ctx.dir, 'tmp'), { recursive: true }); writeFileSync(join(ctx.dir, 'tmp', 'parole-x.wav'), 'x');
  await v.module('syrinx')!.start!(ctx);
  assert.throws(() => readdirSync(join(ctx.dir, 'tmp')));
});

// ------------------------------------------------------------------ 9. Réglages graves
test('baisser la conservation, éteindre l\'écoute d\'une caméra : graves (refusés à une automatisation) ; écouter un clip n\'est plus « lecture »', async () => {
  const { v, mod, ctx } = monter({ ecouter: null, demander: null });
  ctx.saveSettings({ camerasEcoutees: ['Entrée', 'Garage'], conserverJours: 30 });
  for (const entree of [{ conserverJours: 1 }, { cameras: 'Entrée' }, { cameras: '' }]) {
    const r = await v.act('syrinx', 'regler', entree, { auto: true });
    assert.equal(r.ok, false, JSON.stringify(entree));
    assert.match(r.text, /grave/);
  }
  assert.deepEqual(ctx.settings.camerasEcoutees, ['Entrée', 'Garage']);
  assert.equal(ctx.settings.conserverJours, 30);
  // Le formulaire renvoyé tel quel (rien ne change) n'est pas grave ; garder plus longtemps non plus.
  const meme = await v.act('syrinx', 'regler', { cameras: 'Entrée, Garage', conserverJours: 60, antiRafaleMin: 10 }, { auto: true });
  assert.equal(meme.ok, true, meme.text);
  assert.notEqual(mod.actions.find((a) => a.id === 'ecouter_clip')?.read, true);
});

// ------------------------------------------------------------------ 10. Transcription locale seule
test('transcription : jamais par un service en ligne, même si une clé est réglée ; seulement la transcription locale installée', async (t) => {
  if (await transcriptionLocalePrete()) { t.skip('la transcription locale est installée sur ce poste'); return; }
  const { o, etat } = fausseOreille(); oreilleEssai(o);
  const avant = process.env.OPENAI_API_KEY; process.env.OPENAI_API_KEY = 'cle-factice-essai';
  try {
    const { v, deposer } = monter({ voice: { ...DEFAULT_CONFIG.voice, localOnly: false, enabled: true }, modele: async () => undefined });
    deposer('a.wav', 'AAAA');
    const r = await v.act('syrinx', 'ecouter', { fichier: 'atelier:a.wav' });
    assert.equal(etat.options.at(-1)?.ecouter, null, 'aucune transcription confiée à un service en ligne');
    assert.match(r.text, /parole : pas prête sur ce poste/);
  } finally { if (avant === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = avant; }
});

// ------------------------------------------------------------------ 11. Le modèle de sons rend la main entre ses blocs
test('le modèle de sons rend la main au serveur entre chaque bloc, et entend l\'arrêt en cours de passe', async () => {
  const d = tmp('syrinx-mini-');
  const { sha256 } = await ecrireMiniModele(d);
  const m = await ouvrirModeleSons({ dossier: d, attendu: { sha256 } }) as ModeleSonsOuvert;
  assert.equal(m.pret, true, m.raison);
  const trames = 1000, mel = new Float32Array(64 * trames).fill(-5);
  let tours = 0; let encore = true;
  const tic = () => { if (!encore) return; tours++; setImmediate(tic); };
  setImmediate(tic);
  await m.classer(mel, trames);
  encore = false;
  assert.ok(tours >= m.blocs, `${tours} tours de boucle pour ${m.blocs} blocs`);
  const arret = new AbortController();
  setImmediate(() => arret.abort());
  await assert.rejects(m.classer(mel, trames, arret.signal), (e) => e instanceof ErreurSon && e.code === 'arrete');
});

// ------------------------------------------------------------------ 12. Corrections chiffrées ; index et base
test('corrections : libellé et plongement chiffrés sur le disque ; l\'index des empreintes est complété, pas jeté ; une seule écriture d\'empreinte', async () => {
  const { o } = fausseOreille(); oreilleEssai(o);
  const { v, ctx, home, deposer } = monter({ ecouter: null, demander: null, modele: async () => undefined });
  deposer('a.wav', 'AAAAAAAAAAAAAAAA');
  const r = await v.act('syrinx', 'ecouter', { fichier: 'atelier:a.wav' });
  const id = (r.data as { id: string }).id;
  await v.act('syrinx', 'corriger', { analyse: id, libelle: 'la sonnette de mamie' });
  const brut = readFileSync(join(ctx.dir, 'corrections.json'), 'utf8');
  assert.doesNotMatch(brut, /sonnette|mamie/);
  assert.equal(lireCorrections(ctx.dir, home)[0].libelle, 'la sonnette de mamie');
  const page = JSON.stringify(await v.module('syrinx')!.view!(ctx, new URLSearchParams()));
  assert.match(page, /la sonnette de mamie/);
  const ix = indexEmpreintes(ctx.dir), n = ix.ids.length;
  const a = (await o.analyserSon({ octets: new Uint8Array(16).fill(9) })).analyse;
  const neuf = rangerAnalyse(ctx, home, { sourceRef: 'atelier:b', shaFichier: 'b', taille: 1, mtime: 1, analyse: a, empreinte: { sha: 'b', codes: Uint32Array.of(1, 2, 3), instants: Uint32Array.of(0, 1, 2) }, prive: false });
  assert.equal(indexEmpreintes(ctx.dir), ix, 'le même index, complété');
  assert.equal(ix.ids.length, n + 1);
  assert.ok(neuf.range && ix.ids.includes(neuf.valeur));
  assert.ok(DEF_SYRINX.ecritures.empreintes_pose && !('empreinte_pose' in DEF_SYRINX.ecritures));
});

// ------------------------------------------------------------------ 13. La voie des clips de caméra
test('un clip de caméra n\'attend pas derrière un long son, et n\'est pas refusé quand la file normale est pleine', async () => {
  const long = sonFabrique('accordDo', 240), clip = sonFabrique('silencePuisBruit', 6);
  const ordre: string[] = [];
  const pLong = analyserSon({ octets: long }, { ecouter: null, modele: null }).then(() => ordre.push('long'));
  const pleins = Array.from({ length: 5 }, () => analyserSon({ octets: clip }, { ecouter: null, modele: null }).catch((e) => e));
  const opts: OptionsAnalyse & { priorite: 'clip' } = { sonsSeuls: true, ecouter: null, modele: null, priorite: 'clip' };
  const pClip = analyserSon({ octets: clip }, opts).then(() => ordre.push('clip'));
  await Promise.all([pLong, pClip, ...pleins]);
  assert.equal(ordre[0], 'clip', ordre.join(' → '));
  const refus = (await Promise.all(pleins)).filter((x) => x instanceof ErreurSon && x.code === 'occupe');
  assert.ok(refus.length >= 1, 'la file normale reste bornée');
});

// ------------------------------------------------------------------ 14. La page lisible
test('page : journaux à la place des textes multilignes, nom court, onde en %, sons en tableau, étapes en toutes lettres, heure locale', async () => {
  const { o } = fausseOreille(); oreilleEssai(o);
  const { v, ctx, deposer } = monter({ ecouter: null, demander: null, modele: async () => undefined });
  const nom = 'Enregistrement_du_salon_pendant_la_fete_d_anniversaire_de_mamie_2026-11-15_version_finale_definitive.wav';
  deposer(nom, 'XYZ');
  await v.act('syrinx', 'ecouter', { fichier: `atelier:${nom}` });
  const vue = await v.module('syrinx')!.view!(ctx, new URLSearchParams());
  const sections = vue.sections as unknown as Array<Record<string, unknown>>;
  for (const sct of sections) assert.ok(String(sct.title).length <= 60, `titre trop long : ${sct.title}`);
  for (const sct of sections) if (sct.kind === 'text') assert.doesNotMatch(String(sct.text), /\n/, `${sct.title} : retours à la ligne perdus dans un texte`);
  const dernier = sections.find((x) => x.title === 'Dernier son') as { kind: string; lines: string[] };
  assert.equal(dernier.kind, 'log');
  assert.ok(dernier.lines[0].length <= 48 && dernier.lines[0].includes('…'), dernier.lines[0]);
  const onde = sections.find((x) => x.kind === 'courbe') as { unit: string; series: Array<{ points: number[] }> };
  assert.equal(onde.unit, '%');
  assert.deepEqual(onde.series[0].points, [10, 74, 30]);
  assert.equal(sections.some((x) => x.kind === 'bars'), false);
  const mesures = sections.find((x) => x.title === 'Temps mesuré par étape') as { rows: Array<{ cells: string[] }> };
  assert.deepEqual(mesures.rows.map((r) => r.cells[0]), ['lecture du son', 'calculs sans modèle']);
  assert.deepEqual(mesures.rows.map((r) => r.cells[2]), ['×620', '×2,5']);
  const iso = '2026-11-17T00:33:00.000Z', d = new Date(iso);
  assert.match(quandLocal(iso), new RegExp(`${String(d.getHours()).padStart(2, '0')}:33`));
  ctx.saveSettings({ camerasEcoutees: ['Caméra_du_portail_principal_côté_rue_avec_vision_nocturne_infrarouge_modèle_2026', 'garage'] });
  const vue2 = await v.module('syrinx')!.view!(ctx, new URLSearchParams());
  const aide = String((vue2.sections as unknown as Array<Record<string, unknown>>).find((x) => x.title === 'Réglages')?.aide);
  assert.doesNotMatch(aide, /vision_nocturne_infrarouge/);
  assert.match(aide, /2 caméra/);
});
