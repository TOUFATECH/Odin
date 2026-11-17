// Tâches de tous les jours dans d'autres langues, SANS MODÈLE (passage 3 de la campagne `test/taches/`, note « toutes les
// langues », étapes 2 et 9) :
//  - un seul reconnaisseur de langue, qui dit quand il ne sait pas (jamais « français » par défaut) ;
//  - Logos comprend les demandes courantes en anglais, espagnol, allemand et japonais (tournures rangées en données, un
//    fichier par langue : `src/langue/langues/<code>.json`) ;
//  - Odin répond dans la langue de la demande (refus francs, questions) ; une langue reconnue qu'il ne parle pas encore
//    reçoit une réponse en français ET en anglais ;
//  - aucune validation perdue, aucune action sans rapport.
process.env.ODIN_ESSAI = '1';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ouvrir, type Session } from './controle/banc.ts';
import { fakeEngine } from './helpers.ts';
import { useEngine } from '../src/valhalla/modules/naglfar.ts';
import { valhallaOf } from '../src/valhalla/odin.ts';
import { understand } from '../src/valhalla/huginn.ts';
import { languesReconnues, reconnaitre } from '../src/langue/reconnaitre.ts';
import { langues } from '../src/langue/tables.ts';
import { keywords } from '../src/valhalla/besoin.ts';

test('le reconnaisseur de langue : la langue et une confiance, « je ne sais pas » sinon', () => {
  const vu = (t: string) => reconnaitre(t).langue ?? 'incertain';
  assert.equal(vu('quel temps fait-il ?'), 'fr');
  assert.equal(vu('what\'s the weather like today?'), 'en');
  assert.equal(vu('apaga la máquina virtual del servidor Samba'), 'es');
  assert.equal(vu('Wie ist das Wetter heute?'), 'de');
  assert.equal(vu('今日の天気は？'), 'ja');
  assert.match(vu('tafuta habari za leo'), /^sw/); // swahili (« swh » ou sa variété « swc » : un même groupe)
  assert.equal(vu('какая сегодня погода?'), 'rus');
  assert.equal(vu('今天天气怎么样？'), 'cmn');
  assert.equal(vu('qual é a previsão do tempo para amanhã?'), 'por');
  // Des centaines de langues, toutes écritures : ce sont des données (profils), pas une liste dans le code.
  assert.ok(languesReconnues() >= 200, `${languesReconnues()} langues`);
  // Jamais le français par défaut : un nom seul, ou un mélange à égalité, c'est « je ne sais pas ».
  assert.equal(vu('Mamoudzou'), 'incertain');
  assert.equal(vu('ok'), 'incertain');
  assert.ok(reconnaitre('Mamoudzou').confiance < 0.6);
});

test('les tables de langues ne parlent que d\'applis et d\'actions qui existent', { timeout: 120_000 }, async () => {
  const s = await ouvrir({ applis: true });
  try {
    const v = valhallaOf()!;
    for (const t of langues().values()) for (const cle of Object.keys(t.applis)) {
      const [m, a] = cle.split('.');
      assert.ok(v.module(m), `${t.code} : appli inconnue « ${m} »`);
      if (a) assert.ok(v.action(m, a), `${t.code} : action inconnue « ${cle} »`);
    }
  } finally { s.fermer(); }
});

test('Logos, sans modèle, en anglais, espagnol, allemand et japonais', { timeout: 120_000 }, async () => {
  const s = await ouvrir({ applis: true });
  try {
    const v = valhallaOf()!;
    let n = 0;
    const vu = async (p: string) => { const u = await understand(v, p, `lg-${n++}`); return !u ? 'rien' : u.kind === 'action' ? `${u.module}.${u.action}` : u.kind === 'ask' ? `${u.module}.${u.action} (demande)` : u.kind; };
    assert.equal(await vu('what\'s the weather like today?'), 'gladsheim.meteo');
    assert.equal(await vu('Wie ist das Wetter heute?'), 'gladsheim.meteo');
    assert.equal(await vu('今日の天気は？'), 'gladsheim.meteo');
    assert.match(await vu('shut down the VM'), /^ymir\.arreter/);
    assert.match(await vu('apaga la máquina virtual del servidor Samba'), /^ymir\.arreter/);
    assert.equal(await vu('scan my computer for malware'), 'ullr.analyser');
    assert.equal(await vu('Prüfe meinen Computer auf Viren'), 'ullr.analyser');
    assert.equal(await vu('convert this file to PDF: report.docx'), 'dvalinn.convertir');
    assert.equal(await vu('busca en internet el precio del petróleo'), 'volva.chercher');
    // Le français ne change pas.
    assert.equal(await vu('quel temps fait-il ?'), 'gladsheim.meteo');
    assert.equal(await vu('mets à jour les signatures'), 'ullr.mettre_a_jour');
  } finally { s.fermer(); }
});

test('les mots du besoin, dans toutes les écritures', () => {
  assert.deepEqual(keywords('今日の天気は？').includes('天気'), true);
  assert.deepEqual(keywords('книга про погоду'), ['книга', 'про', 'погоду']);
  assert.deepEqual(keywords('what is the weather'), ['weather']);
});

const PROPRIOS = Array.from({ length: 30 }, (_, i) => `q${i}`);
async function sansModele(): Promise<Session> {
  useEngine(() => fakeEngine([{ Names: 'web', Image: 'nginx:1.27', State: 'running' }, { Names: 'samba', Image: 'dperson/samba', State: 'running' }]));
  const s = await ouvrir({ applis: true, proprietaires: PROPRIOS });
  s.o.agent.deps.offlineOnly = true;
  // Le dépôt de travail a des garde-fous en cours de modification : l'intégrité est coupée dans cet Odin jetable seulement.
  (s.o.heimdall as unknown as { integrite?: unknown }).integrite = undefined;
  return s;
}
let k = 0;
const dire = async (s: Session, phrase: string) => {
  (s.o.heimdall as unknown as { ecrituresRecentes?: number[] }).ecrituresRecentes = [];
  const v0 = s.validations.length;
  const r = await s.dire(phrase, PROPRIOS[k++ % PROPRIOS.length]);
  await new Promise((ok) => setTimeout(ok, 30));
  return { texte: r.texte, validations: s.validations.slice(v0).map((x) => x.texte) };
};

test('sans modèle : la réponse dans la langue de la demande, les validations gardées', { timeout: 120_000 }, async () => {
  const s = await sansModele();
  try {
    let r = await dire(s, 'book me a table for two tomorrow at 8pm');
    assert.match(r.texte, /^I can't book anything with someone else/); assert.equal(r.validations.length, 0); assert.doesNotMatch(r.texte, /Alexandrie/);
    r = await dire(s, 'resérvame un hotel en Madrid para el sábado');
    assert.match(r.texte, /^Todavía no sé reservar/);
    r = await dire(s, 'Buch mir einen Zug nach Berlin');
    assert.match(r.texte, /^Ich kann noch nicht/);
    r = await dire(s, 'shut down the VM');
    assert.match(r.texte, /Hydre · Arrêt propre: I need « Numéro »/); assert.equal(r.validations.length, 0);
    // Avec un conteneur « samba » connu, Logos devinait « Hydre · Cloner » : une action dont le verbe n'est pas dit n'est jamais proposée.
    r = await dire(s, 'apaga la máquina virtual del servidor Samba');
    assert.equal(r.validations.length, 0); assert.doesNotMatch(r.texte, /Cloner/);
    // Une langue reconnue qu'il ne parle pas encore : en français ET en anglais, rien de fait.
    r = await dire(s, 'tafuta habari za leo');
    assert.match(r.texte, /je reconnais la langue de ta demande \(swahili/); assert.match(r.texte, /il me faut un modèle de langue/); assert.match(r.texte, /I need a language model/); assert.equal(r.validations.length, 0);
    r = await dire(s, 'какая сегодня погода?');
    assert.match(r.texte, /\(russe\)/); assert.equal(r.validations.length, 0);
    // L'heure.
    r = await dire(s, 'what time is it');
    assert.match(r.texte, /^It's \d/);
    // Une action qui change quelque chose demande toujours la validation, quelle que soit la langue.
    r = await dire(s, 'convert this file to PDF: report.docx');
    assert.equal(r.validations.length, 1); assert.match(r.validations[0], /dvalinn convertir/);
    r = await dire(s, 'scan my computer for malware');
    assert.equal(r.validations.length, 1);
  } finally { s.fermer(); }
});
