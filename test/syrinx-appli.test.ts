// Syrinx (lot B) — l'appli : atelier fermé, pas deux analyses d'un même fichier, mode privé sans rien ranger, contenu
// chiffré, page honnête sans modèle, vitesse mesurée affichée, purge des dérivés, téléchargement grave sans réseau réel,
// annonce unique. Tout passe par une FAUSSE oreille (aucun outil média, aucun vrai poids, aucune transcription, aucun réseau).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Valhalla } from '../src/valhalla/service.ts';
import { syrinx, oreilleEssai, oublierDerniers, type OptionsSyrinx, type Oreille } from '../src/valhalla/syrinx/index.ts';
import { oublierMagasin } from '../src/valhalla/syrinx/magasin.ts';
import { oublierBranchementsSyrinx } from '../src/valhalla/syrinx/base.ts';
import type { AnalyseSon, ModeleSons, OptionsAnalyse, SourceSon } from '../src/audio/contrat.ts';

const homes: string[] = [];
after(() => { oreilleEssai(); for (const h of homes) rmSync(h, { recursive: true, force: true }); });

/** Une fausse oreille : compte les appels, note le fichier lu, rend une analyse fabriquée. */
function fausseOreille() {
  const etat = { analyses: 0, fichiers: [] as string[], fetchs: 0 };
  const o: Oreille = {
    CATALOGUE_SONS: { taille: 22 * 1024 * 1024, licence: 'Apache-2.0' },
    async analyserSon(src: SourceSon, op: OptionsAnalyse = {}) {
      etat.analyses++;
      const octets = 'fichier' in src ? (etat.fichiers.push(src.fichier), readFileSync(src.fichier)) : Buffer.from(src.octets);
      const sha = createHash('sha256').update(octets).digest('hex');
      let sons: AnalyseSon['sons'] = { etat: 'pas_pret', etiquettes: [], moments: [] };
      if (op.modele?.pret) {
        const s = await op.modele.classer(new Float32Array(64 * 10), 10);
        sons = { etat: 'fait', etiquettes: [{ indice: 0, cle: 'sonnette', libelle: 'sonnette', famille: 'maison', p: s.probas[0], seuil: 0.5 }], moments: [{ debut: 0.3, fin: 1.1, indice: 0, cle: 'sonnette', libelle: 'sonnette', famille: 'maison', pMax: s.probas[0], pas: 5 }], plongement: [...s.plongement] };
      }
      let parole: AnalyseSon['parole'] = { etat: op.ecouter === null ? 'pas_prete' : 'non_demandee', segments: [], tours: [], texteRetire: false };
      if (op.ecouter && !op.sonsSeuls) {
        const h = await op.ecouter(new Uint8Array(4), 'audio/wav');
        parole = { etat: 'faite', texte: h.text, langue: h.language, confianceLangue: 0.9, segments: h.segments.map((x) => ({ debut: x.start, fin: x.end, texte: x.text })), tours: [{ debut: 0, fin: 2, voix: 'voix 1' }], texteRetire: false };
      }
      const analyse: AnalyseSon = {
        version: 1, duree: 2, source: { format: 'wav', fs: 16000, canaux: 1, via: 'natif' }, sha, onde: [0.1, 0.6, 0.3],
        volume: { rmsDb: -20, creteDb: -3 }, zones: [{ debut: 0, fin: 2, son: true }], changements: [1],
        musique: { probable: false, par: 'sans-modele', confiance: 0.2, parties: [] },
        sons, parole, mesures: [{ etape: 'decodage', ms: 3.2, xTempsReel: 620 }, { etape: 'total', ms: 12.5, xTempsReel: 160 }], manque: [],
      };
      const codes = Uint32Array.from(octets.subarray(0, 32)), instants = Uint32Array.from(codes.map((_, k) => k));
      return { analyse, empreinte: { sha, codes, instants } };
    },
    async ouvrirModeleSons() { return { pret: false, raison: 'pas téléchargé', classes: 0, libelles: [], classer: async () => { throw new Error('pas prêt'); } }; },
    etatModeleSons: () => ({ present: false, verifie: false, aTourne: false }),
    async telechargerModeleSons(op) { await op.fetch('https://depot.exemple.invalid/sons-petit.safetensors'); etat.fetchs++; return { ok: true, texte: 'téléchargé (faux)' }; },
    voterEmpreinte: (q, trouves) => { const n = new Map<string, number>(); for (const t of trouves) n.set(t.id, (n.get(t.id) ?? 0) + 1); return [...n].map(([id, k]) => ({ id, score: k / q.codes.length, decalageS: 0, meme: k === q.codes.length })); },
    sonFabrique: () => new Uint8Array(64).fill(7),
  };
  return { o, etat };
}

/** Un faux modèle de sons (en mémoire) qui compte ses passes. */
function fauxModele() {
  const c = { passes: 0 };
  const m: ModeleSons = { pret: true, classes: 1, libelles: ['sonnette'], empreinte: 'abc', licence: 'Apache-2.0', async classer() { c.passes++; return { probas: Float32Array.of(0.83), parPas: Float32Array.of(0.83), pas: 1, plongement: new Float32Array(192).fill(0.5) }; } };
  return { m, c };
}

function monter(opts: OptionsSyrinx, o: { now?: () => Date; fetch?: typeof fetch; home?: string } = {}) {
  oublierMagasin(); oublierDerniers(); oublierBranchementsSyrinx();
  const home = o.home ?? mkdtempSync(join(tmpdir(), 'syrinx-')); if (!o.home) homes.push(home);
  const mod = syrinx(() => opts);
  const v = new Valhalla(home, [mod], { notify: async () => {}, fetch: o.fetch ?? (async () => { throw new Error('réseau interdit dans les essais'); }), now: o.now });
  const ctx = v.ctx('syrinx');
  const deposer = (nom: string, contenu: string) => { mkdirSync(join(ctx.dir, 'atelier'), { recursive: true }); writeFileSync(join(ctx.dir, 'atelier', nom), contenu); };
  return { v, mod, ctx, home, deposer };
}
const ecouterFaux: OptionsSyrinx['ecouter'] = async () => ({ text: 'pamplemousse et rhubarbe au marché', language: 'fr', segments: [{ start: 0, end: 2, text: 'pamplemousse et rhubarbe au marché' }] });

test('« ../x » ne désigne que atelier/x', async () => {
  const { o, etat } = fausseOreille(); oreilleEssai(o);
  const { v, ctx, deposer } = monter({ ecouter: null, demander: null });
  writeFileSync(join(ctx.dir, 'x'), 'HORS ATELIER'); deposer('x', 'DANS ATELIER');
  const r = await v.act('syrinx', 'ecouter', { fichier: '../x' });
  assert.equal(r.ok, true, r.text);
  assert.equal(etat.fichiers.at(-1), join(ctx.dir, 'atelier', 'x'));
  v.stop();
});

test('un même fichier n\'est pas analysé deux fois ; le contenu rangé est chiffré', async () => {
  const { o, etat } = fausseOreille(); oreilleEssai(o);
  const { m, c } = fauxModele();
  const { v, ctx, deposer } = monter({ modele: async () => m, ecouter: ecouterFaux, demander: null });
  deposer('a.wav', 'RIFF-son-a');
  const r1 = await v.act('syrinx', 'ecouter', { fichier: 'atelier:a.wav' });
  assert.equal(r1.ok, true, r1.text);
  assert.match(r1.text, /sonnette : 83 % \(seuil 50 %\)/);
  const r2 = await v.act('syrinx', 'ecouter', { fichier: 'a.wav' });
  assert.match(r2.text, /déjà entendu le/);
  assert.equal(c.passes, 1, 'le faux modèle n\'a tourné qu\'une fois');
  assert.equal(etat.analyses, 1);
  const fichiers = readdirSync(join(ctx.dir, 'analyses'));
  assert.equal(fichiers.length, 1);
  const brut = readFileSync(join(ctx.dir, 'analyses', fichiers[0]), 'utf8');
  assert.doesNotMatch(brut, /pamplemousse|rhubarbe|sonnette/);
  assert.match(brut, /"contenu":"odc1:/);
  assert.deepEqual(Object.keys(JSON.parse(brut)).sort(), ['contenu', 'duree', 'id', 'mtime', 'quand', 'shaFichier', 'sourceRef', 'taille', 'v'].sort());
  assert.ok(existsSync(join(ctx.dir, 'empreintes', fichiers[0].replace('.json', '.bin'))));
  // Retrouver par une phrase (mots des étiquettes, déchiffrés sur place).
  const t = await v.act('syrinx', 'retrouver', { phrase: 'la sonnette' });
  assert.match(t.text, /atelier:a\.wav/);
  v.stop();
});

test('mode privé : rien n\'est rangé (analyses, empreintes, corrections, mesures)', async () => {
  const { o } = fausseOreille(); oreilleEssai(o);
  const { m } = fauxModele();
  const { v, ctx, deposer } = monter({ voice: { privacy: { privateMode: true, keepAudio: false, keepAudioDays: 7 } } as never, modele: async () => m, ecouter: ecouterFaux, demander: null });
  deposer('p.wav', 'RIFF-prive');
  const r = await v.act('syrinx', 'ecouter', { fichier: 'p.wav' });
  assert.equal(r.ok, true, r.text);
  assert.match(r.text, /mode privé/);
  await v.act('syrinx', 'mesurer', {});
  const c = await v.act('syrinx', 'corriger', { analyse: '0123456789abcdef', libelle: 'sonnette' });
  assert.match(c.text, /Mode privé/);
  for (const x of ['analyses', 'empreintes', 'corrections.json', 'mesures.json']) assert.equal(existsSync(join(ctx.dir, x)), false, x);
  v.stop();
});

test('page sans modèle : honnête, aucune confiance de sons ; puis la vitesse mesurée apparaît', async () => {
  const { o } = fausseOreille(); oreilleEssai(o);
  const { v, mod, ctx, deposer } = monter({ ecouter: null, demander: null });
  deposer('b.wav', 'RIFF-son-b');
  const r = await v.act('syrinx', 'ecouter', { fichier: 'b.wav' });
  assert.match(r.text, /parole : pas prête sur ce poste/);
  assert.match(r.text, /pas téléchargé \(22 Mo, Apache-2\.0\)/);
  const page = JSON.stringify(await mod.view(ctx, new URLSearchParams()));
  assert.match(page, /codé, pas encore essayé sur du vrai modèle|pas téléchargé/);
  assert.match(page, /parole : pas prête sur ce poste/);
  assert.doesNotMatch(page, /"kind":"bars"/, 'aucune confiance de sons sans modèle');
  assert.doesNotMatch(page, /fonctionne/);
  const mes = await v.act('syrinx', 'mesurer', {});
  assert.equal(mes.ok, true, mes.text);
  const apres = JSON.stringify(await mod.view(ctx, new URLSearchParams()));
  assert.match(apres, /total 13 ms|total 12 ms/);
  assert.match(apres, /×160 temps réel/);
  v.stop();
});

test('purger efface aussi les empreintes et les corrections liées', async () => {
  const { o } = fausseOreille(); oreilleEssai(o);
  const { m } = fauxModele();
  let maintenant = new Date('2026-01-01T10:00:00Z');
  const { v, ctx, deposer } = monter({ modele: async () => m, ecouter: null, demander: null }, { now: () => maintenant });
  deposer('c.wav', 'RIFF-son-c');
  const r = await v.act('syrinx', 'ecouter', { fichier: 'c.wav' });
  const id = (r.data as { id: string }).id;
  assert.ok(id);
  const c = await v.act('syrinx', 'corriger', { analyse: id, libelle: 'la sonnette du voisin' });
  assert.equal(c.ok, true, c.text);
  assert.equal(JSON.parse(readFileSync(join(ctx.dir, 'corrections.json'), 'utf8')).length, 1);
  maintenant = new Date('2026-03-01T10:00:00Z');
  const p = await v.act('syrinx', 'purger', {});
  assert.match(p.text, /1 son/);
  assert.deepEqual(readdirSync(join(ctx.dir, 'analyses')), []);
  assert.deepEqual(readdirSync(join(ctx.dir, 'empreintes')), []);
  assert.deepEqual(JSON.parse(readFileSync(join(ctx.dir, 'corrections.json'), 'utf8')), []);
  v.stop();
});

test('télécharger le modèle : action grave, et seul le faux fetch est appelé', async () => {
  const { o, etat } = fausseOreille(); oreilleEssai(o);
  const appels: string[] = [];
  const faux: typeof fetch = async (u) => { appels.push(String(u)); return new Response('x'); };
  const { v, mod } = monter({ ecouter: null, demander: null }, { fetch: faux });
  const a = mod.actions.find((x) => x.id === 'telecharger_modele')!;
  assert.match(a.grave?.({}) ?? '', /télécharger 22 Mo \(licence Apache-2\.0\)/);
  const auto = await v.act('syrinx', 'telecharger_modele', {}, { auto: true });
  assert.equal(auto.ok, false, 'jamais lancé par une automatisation');
  assert.equal(etat.fetchs, 0);
  const r = await v.act('syrinx', 'telecharger_modele', {});
  assert.equal(r.ok, true, r.text);
  assert.deepEqual(appels, ['https://depot.exemple.invalid/sons-petit.safetensors']);
  v.stop();
});

test('l\'annonce n\'est postée qu\'une fois sur deux démarrages', async () => {
  const { o } = fausseOreille(); oreilleEssai(o);
  const { v, home } = monter({ ecouter: null, demander: null });
  let vues = 0;
  v.events.on('alert', (a: { key?: string }) => { if (a.key === 'syrinx:syrinx:annonce') vues++; });
  await v.start(); v.stop();
  const deux = monter({ ecouter: null, demander: null }, { home });
  deux.v.events.on('alert', (a: { key?: string }) => { if (a.key === 'syrinx:syrinx:annonce') vues++; });
  await deux.v.start(); deux.v.stop();
  assert.equal(vues, 1);
  assert.equal(deux.ctx.settings.annonce, 'v1');
});

test('Logos : jamais « musique » seul, « joue », « écouter » seul ni « transcris »', () => {
  const mod = syrinx(() => ({}));
  const tous = [...mod.words, ...mod.actions.flatMap((a) => a.words ?? [])];
  for (const interdit of ['musique', 'joue', 'ecouter', 'écouter', 'transcris']) assert.ok(!tous.includes(interdit), interdit);
  assert.ok(!tous.some((w) => /transcri/.test(w)));
  assert.equal(mod.actions.find((a) => a.id === 'ecouter_clip')?.words, undefined);
  assert.deepEqual([mod.from, mod.upstream], [[], []]);
});
