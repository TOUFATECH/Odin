// Syrinx — le modèle de sons ouvert (lot A). Un MINI modèle (mêmes noms de tenseurs, D 8, 2 blocs, 2 têtes, 5 classes,
// poids à graine) est chargé, vérifié nom par nom et forme par forme, et calculé ; le téléchargement est essayé contre
// un FAUX fetch (aucun réseau) ; enfin une passe de la VRAIE forme (poids aléatoires) est chronométrée.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

import { ouvrirModeleSons, etatModeleSons, analyserSon, sonFabrique, CATALOGUE_SONS, telechargerModeleSons } from '../src/audio/index.ts';
import { telechargerSelon, type FicheModele } from '../src/audio/catalogue.ts';
import { logMel } from '../src/audio/spectre.ts';
import type { ModeleSonsOuvert } from '../src/audio/modele-sons.ts';
import { ecrireMiniModele, ecrireModele, fauxFetch, sinus, LIBELLES_MINI, hasard } from './syrinx-outils-essai.ts';

const dossierEssai = (nom: string) => mkdtempSync(join(tmpdir(), `syrinx-${nom}-`));

test('le mini modèle se charge : dimension, blocs et têtes déduits, étiquettes lues', async () => {
  const d = dossierEssai('mini');
  try {
    const { sha256 } = await ecrireMiniModele(d);
    const m = await ouvrirModeleSons({ dossier: d, attendu: { sha256 } }) as ModeleSonsOuvert;
    assert.equal(m.pret, true, m.raison);
    assert.equal(m.classes, 5);
    assert.deepEqual(m.libelles, LIBELLES_MINI);
    assert.equal(m.dimension, 8);
    assert.equal(m.blocs, 2);
    assert.equal(m.tetes, 2);
    assert.equal(m.empreinte, sha256);
    assert.equal(m.licence, 'Apache-2.0');
    // La provenance est notée à côté.
    assert.match(readFileSync(join(d, 'sons-petit.licence.txt'), 'utf8'), new RegExp(`sha256=${sha256}`));
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('un tenseur manquant ou une forme fausse donnent pret:false avec la raison, sans lever', async () => {
  const d = dossierEssai('manque');
  try {
    let { sha256 } = await ecrireMiniModele(d, { sans: 'blocks.1.mlp.fc2.bias' });
    let m = await ouvrirModeleSons({ dossier: d, attendu: { sha256 } });
    assert.equal(m.pret, false);
    assert.match(m.raison ?? '', /blocks\.1\.mlp\.fc2\.bias/);
    ({ sha256 } = await ecrireMiniModele(d, { formeFausse: { nom: 'blocks.0.attn.proj.weight', dims: [8, 7] } }));
    m = await ouvrirModeleSons({ dossier: d, attendu: { sha256 } });
    assert.equal(m.pret, false);
    assert.match(m.raison ?? '', /forme de « blocks\.0\.attn\.proj\.weight »/);
    ({ sha256 } = await ecrireMiniModele(d, { sans: 'outputlayer.1.weight' }));
    m = await ouvrirModeleSons({ dossier: d, attendu: { sha256 } });
    assert.equal(m.pret, false);
    await assert.rejects(m.classer(new Float32Array(64), 1));
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('une empreinte fausse est refusée AVANT la lecture des tenseurs ; dossier vide : pas prêt', async () => {
  const d = dossierEssai('sha');
  try {
    let m = await ouvrirModeleSons({ dossier: d });
    assert.equal(m.pret, false);
    assert.match(m.raison ?? '', /pas téléchargé \(22 Mo, Apache-2\.0\)/);
    // Un fichier illisible : s'il était lu, on aurait « illisible » ; on doit avoir « empreinte ».
    writeFileSync(join(d, 'sons-petit.safetensors'), Buffer.from('n\'importe quoi, pas des poids'));
    m = await ouvrirModeleSons({ dossier: d });
    assert.equal(m.pret, false);
    assert.match(m.raison ?? '', /empreinte non conforme/);
    // Un vrai mini modèle, mais sans empreinte attendue donnée : c'est celle du catalogue qui compte → refusé.
    await ecrireMiniModele(d);
    m = await ouvrirModeleSons({ dossier: d });
    assert.equal(m.pret, false);
    assert.match(m.raison ?? '', /empreinte/);
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('sortie déterministe, dans [0, 1], parPas T×C, plongement de longueur D ; état écrit après la 1re passe', async () => {
  const d = dossierEssai('sortie');
  try {
    const { sha256 } = await ecrireMiniModele(d);
    assert.equal(etatModeleSons(d).aTourne, false);
    const m = await ouvrirModeleSons({ dossier: d, attendu: { sha256 } });
    const mel = logMel(sinus(440, 3, 16000, 0.3));
    const a = await m.classer(mel.data, mel.trames);
    const b = await m.classer(mel.data, mel.trames);
    assert.deepEqual(Array.from(a.probas), Array.from(b.probas));
    assert.equal(a.probas.length, 5);
    for (const v of a.probas) assert.ok(v >= 0 && v <= 1 && Number.isFinite(v));
    assert.equal(a.pas, Math.floor(mel.trames / 16));
    assert.equal(a.parPas.length, a.pas * 5);
    for (const v of a.parPas) assert.ok(v >= 0 && v <= 1);
    assert.equal(a.plongement.length, 8);
    // Plus de 1012 trames : plusieurs fenêtres, la dernière complétée par des zéros.
    const long = logMel(sinus(440, 25, 16000, 0.3));
    const c = await m.classer(long.data, long.trames);
    assert.equal(c.pas, 63 + 63 + Math.floor((long.trames - 2024) / 16));
    const e = etatModeleSons(d);
    assert.equal(e.present, true);
    assert.equal(e.aTourne, true);
    assert.ok(e.quand && e.mesure && e.mesure.ms > 0);
    assert.equal(e.verifie, false, 'le mini modèle n\'est pas celui du catalogue');
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('analyse complète avec le mini modèle : sons faits, étiquettes, moments, plongement, musique par le modèle', async () => {
  const d = dossierEssai('analyse');
  try {
    const { sha256 } = await ecrireMiniModele(d);
    const modele = await ouvrirModeleSons({ dossier: d, attendu: { sha256 } });
    const { analyse } = await analyserSon({ octets: sonFabrique('accordDo', 14) }, { modele, ecouter: null });
    assert.equal(analyse.sons.etat, 'fait');
    assert.ok(analyse.sons.etiquettes.length >= 3 && analyse.sons.etiquettes.length <= 5);
    for (const e of analyse.sons.etiquettes) { assert.ok(e.p >= 0 && e.p <= 1); assert.ok(e.seuil > 0); assert.ok(e.libelle); }
    const verre = analyse.sons.etiquettes.find((e) => e.cle === 'Glass');
    if (verre) assert.equal(verre.famille, 'alerte');
    assert.equal(analyse.sons.plongement?.length, 8);
    assert.equal(analyse.musique.par, 'modele');
    assert.ok(Array.isArray(analyse.sons.moments));
    assert.ok(analyse.mesures.some((x) => x.etape === 'modele_sons' && x.ms > 0));
    assert.ok(analyse.manque.some((x) => /par tranche de 10 s/.test(x)), 'l\'écart du niveau de référence est dit');
    // Sans modèle fourni : pas prêt, avec le texte honnête ; modèle refusé explicitement : non demandé.
    const sans = await analyserSon({ octets: sonFabrique('accordDo', 2) }, { ecouter: null });
    assert.equal(sans.analyse.sons.etat, 'pas_pret');
    assert.match(sans.analyse.sons.raison ?? '', /pas téléchargé \(22 Mo, Apache-2\.0\)/);
    const non = await analyserSon({ octets: sonFabrique('accordDo', 2) }, { ecouter: null, modele: null });
    assert.equal(non.analyse.sons.etat, 'non_demande');
  } finally { rmSync(d, { recursive: true, force: true }); }
});

function ficheEssai(octets: Uint8Array): FicheModele {
  return {
    ...CATALOGUE_SONS,
    taille: octets.length,
    sha256: createHash('sha256').update(octets).digest('hex'),
    urlPoids: 'https://essai.invalid/poids',
    urlConfig: 'https://essai.invalid/config',
  };
}

test('téléchargement contre un FAUX fetch : bon fichier accepté, mauvais sha refusé et .part effacé, taille démesurée coupée', async () => {
  const d = dossierEssai('telechargement');
  try {
    const h = hasard(77);
    const octets = Uint8Array.from({ length: 300_000 }, () => Math.floor(h() * 256));
    const config = JSON.stringify({ id2label: { 0: 'Speech', 1: 'Glass' } });
    const fiche = ficheEssai(octets);
    // Bon fichier.
    let r = await telechargerSelon(fiche, { dossier: d, fetch: fauxFetch({ [fiche.urlPoids]: octets, [fiche.urlConfig]: config }) });
    assert.equal(r.ok, true, r.texte);
    assert.ok(existsSync(join(d, 'sons-petit.safetensors')));
    assert.ok(existsSync(join(d, 'sons-petit.config.json')));
    assert.match(readFileSync(join(d, 'sons-petit.licence.txt'), 'utf8'), /licence=Apache-2\.0 ; source=https:\/\/essai\.invalid\/poids/);
    assert.ok(!existsSync(join(d, 'sons-petit.safetensors.part')));
    // Mauvais sha.
    const d2 = dossierEssai('telechargement2');
    try {
      r = await telechargerSelon({ ...fiche, sha256: '0'.repeat(64) }, { dossier: d2, fetch: fauxFetch({ [fiche.urlPoids]: octets, [fiche.urlConfig]: config }) });
      assert.equal(r.ok, false);
      assert.match(r.texte, /empreinte non conforme/);
      assert.deepEqual(readdirSync(d2), [], 'le .part est effacé');
      // Taille démesurée : coupée.
      const gros = new Uint8Array(octets.length + 100_000);
      r = await telechargerSelon(fiche, { dossier: d2, fetch: fauxFetch({ [fiche.urlPoids]: gros, [fiche.urlConfig]: config }) });
      assert.equal(r.ok, false);
      assert.match(r.texte, /coupé/);
      assert.deepEqual(readdirSync(d2), []);
      // Taille annoncée démesurée : refusée avant d'écrire.
      r = await telechargerSelon(fiche, { dossier: d2, fetch: fauxFetch({ [fiche.urlPoids]: octets, [fiche.urlConfig]: config }, { annonce: 10 ** 10 }) });
      assert.equal(r.ok, false);
      assert.deepEqual(readdirSync(d2), []);
      // Configuration illisible : refusée, rien ne reste.
      r = await telechargerSelon(fiche, { dossier: d2, fetch: fauxFetch({ [fiche.urlPoids]: octets, [fiche.urlConfig]: '{pas du json' }) });
      assert.equal(r.ok, false);
      assert.deepEqual(readdirSync(d2), []);
      // Le vrai catalogue avec un faux fetch qui ne sert rien : refus propre, aucune exception.
      r = await telechargerModeleSons({ dossier: d2, fetch: fauxFetch({}) });
      assert.equal(r.ok, false);
    } finally { rmSync(d2, { recursive: true, force: true }); }
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('mesure : une passe de la VRAIE forme (poids aléatoires) sur 10 s', async (t) => {
  const d = dossierEssai('vraie-forme');
  try {
    const libelles = Array.from({ length: 527 }, (_, i) => (i === 0 ? 'Speech' : i === 137 ? 'Music' : `classe ${i}`));
    const { sha256 } = await ecrireModele(d, { D: 192, blocs: 12, tetes: 3, libelles });
    const m = await ouvrirModeleSons({ dossier: d, attendu: { sha256 } }) as ModeleSonsOuvert;
    assert.equal(m.pret, true, m.raison);
    assert.equal(m.dimension, 192); assert.equal(m.blocs, 12); assert.equal(m.tetes, 3);
    const mel = logMel(sinus(440, 10, 16000, 0.3));
    const t0 = performance.now();
    const s = await m.classer(mel.data, mel.trames);
    const ms = performance.now() - t0;
    assert.equal(s.plongement.length, 192);
    assert.equal(s.probas.length, 527);
    t.diagnostic(`vraie forme (poids aléatoires), 10 s : ${ms.toFixed(0)} ms, ×${(10_000 / ms).toFixed(1)} temps réel${m.notes.length ? ` — ${m.notes.join(' ; ')}` : ''}`);
  } finally { rmSync(d, { recursive: true, force: true }); }
});
