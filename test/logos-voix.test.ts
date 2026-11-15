// Logos pour la voix : clé phonétique, corrections par la prononciation (avec le contexte de la phrase), lexique
// appris (partagé avec Écho), prononciations lues à l'envers, et aucune correction intempestive des phrases d'exemple
// des applis. Sans IA, sans réseau.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { apprendreVoix, cle, correctionDite, corrigerVoix, ecart, memeMot, vocabulaire } from '../src/valhalla/huginn-voix.ts';
import { examples } from '../src/valhalla/huginn.ts';
import { allModules } from '../src/valhalla/odin.ts';
import { mots } from '../src/voice/mots.ts';
import { makeOdin } from './helpers.ts';

test('clé phonétique : ce qui se prononce pareil a la même clé', () => {
  assert.equal(cle('nase'), cle('NAS'));
  assert.equal(cle('naze'), cle('NAS'));
  assert.equal(cle('Hringhorni'), cle('ring horni'));
  assert.equal(cle('Mnémosyne'), cle('mné mo zine'));
  assert.equal(cle('photo'), cle('foto'));
  assert.notEqual(cle('maison'), cle('raison'));
  assert.equal(ecart('seo', 'sio'), 1);
  assert.ok(memeMot('iso', 'isos') && memeMot('récupère', 'recuperer') && !memeMot('NAS', 'nase'));
});

test('corrections : « nase » → NAS seulement quand la phrase parle de disques ; « SIO » → SEO (dit en une ligne)', () => {
  const voc = vocabulaire({ appris: [] });
  let r = corrigerVoix('mon nase est plein', voc);
  assert.equal(r.texte, 'mon NAS est plein'); assert.equal(r.corrections[0].entendu, 'nase'); assert.equal(r.doute, undefined, 'sûr : pas besoin de le dire');
  r = corrigerVoix('il est nase aujourd\'hui', voc);
  assert.equal(r.texte, 'il est nase aujourd\'hui', 'sans contexte, un mot de deux sons reste tel quel');
  r = corrigerVoix('le SIO de mon site est mauvais', voc);
  assert.equal(r.texte, 'le SEO de mon site est mauvais');
  assert.match(r.doute ?? '', /J'ai compris « SEO » \(j'ai entendu « SIO »\)/);
  // Une phrase ordinaire n'est jamais touchée.
  for (const t of ['allume la lumière du salon', 'quelle est la météo demain', 'mets Inception sur la télé']) assert.equal(corrigerVoix(t, voc).texte, t);
});

test('lexique appris (avec Écho) et prononciations du réglage de la voix lues à l\'envers', () => {
  const home = mkdtempSync(join(tmpdir(), 'logos-'));
  try {
    assert.ok(apprendreVoix('ring horni', 'Hringhorni', home));
    assert.ok(!apprendreVoix('ring horni', 'Hringhorni', home), 'déjà su');
    assert.deepEqual(mots(home).find((m) => m.mot === 'Hringhorni')?.entendus, ['ring horni'], 'rangé dans les mots d\'Écho (dictée et Whisper)');
    const voc = vocabulaire({ home, prononciations: { Mnémosyne: 'Mné-mo-zine' } });
    let r = corrigerVoix('lance ring horni', voc);
    assert.equal(r.texte, 'lance Hringhorni'); assert.equal(r.corrections[0].sur, 'appris');
    r = corrigerVoix('ouvre mné mo zine', voc);
    assert.equal(r.texte, 'ouvre Mnémosyne'); assert.equal(r.corrections[0].sur, 'prononciation');
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test('« non, je voulais dire … » : la correction dite est reconnue', () => {
  assert.deepEqual(correctionDite('non, je voulais dire NAS'), { voulu: 'NAS' });
  assert.deepEqual(correctionDite('pas nase, NAS'), { entendu: 'nase', voulu: 'NAS' });
  assert.deepEqual(correctionDite('j\'ai dit « SEO »'), { voulu: 'SEO' });
  assert.equal(correctionDite('allume la lumière'), undefined);
});

test('les phrases d\'exemple de toutes les applis passent sans être corrigées de travers', () => {
  const o = makeOdin([{ text: 'ok' }]);
  try {
    const mods = allModules(o as never), voc = vocabulaire({ modules: mods, appris: [] });
    assert.ok(voc.some((t) => t.mot === 'Orphée') && voc.some((t) => t.mot === 'NAS'));
    const changes: string[] = [];
    for (const m of mods) for (const e of examples(m)) { const r = corrigerVoix(e, voc); if (r.texte !== e) changes.push(`${m.id} : « ${e} » → « ${r.texte} »`); }
    assert.deepEqual(changes, []);
  } finally { o.cleanup(); }
});
