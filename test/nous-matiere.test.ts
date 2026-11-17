// La matière par langue de l'aiguilleur (src/brain/nous/matiere/<code>.json) et son chargeur (src/brain/nous/matiere.ts) :
//   1. chaque fichier présent dans le dépôt est un JSON de la bonne forme, nommé d'après sa langue, sans appli ni action
//      inconnue, et couvre les 75 applis quand il se dit complet ;
//   2. le chargeur refuse proprement un fichier abîmé ou un identifiant inconnu, sans jamais planter l'aiguilleur.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DOSSIER_MATIERE, PHRASE_MAX, lireFichierMatiere, lireMatiere } from '../src/brain/nous/matiere.ts';
import { creerAiguilleurSync, type ModuleMatiere } from '../src/brain/nous/aiguilleur.ts';

const dossier = () => mkdtempSync(join(tmpdir(), 'odin-matiere-essai-'));

/** Les applis du produit, sur un Odin vide dans un dossier jetable. */
async function applisDuProduit(): Promise<Map<string, Set<string>>> {
  const home = dossier();
  process.env.ODIN_HOME = home; process.env.ODIN_CLE_DIR = join(home, 'cles'); process.env.ODIN_ESSAI = '1'; process.env.ODIN_NO_VOICE_INSTALL = '1';
  const { allModules } = await import('../src/valhalla/odin.ts');
  const mods = allModules({ paths: { home, workspace: home }, cfg: { venus: {}, voice: {} } } as never);
  return new Map(mods.map((m) => [m.id, new Set(m.actions.map((a) => a.id))]));
}

test('matière du dépôt : chaque fichier est lisible, bien formé, sans identifiant inconnu', async () => {
  let noms: string[] = [];
  try { noms = readdirSync(DOSSIER_MATIERE).filter((n) => n.endsWith('.json')).sort(); } catch { /* pas encore de matière */ }
  const applis = await applisDuProduit();
  assert.equal(applis.size, 75, 'le produit a 75 applis');
  for (const nom of noms) {
    const brut = readFileSync(join(DOSSIER_MATIERE, nom), 'utf8');
    let x: unknown;
    assert.doesNotThrow(() => { x = JSON.parse(brut); }, `${nom} : JSON lisible`);
    const { bilan, paires } = lireFichierMatiere(x, applis, nom);
    assert.equal(bilan.refus, undefined, `${nom} : ${bilan.refus}`);
    assert.equal(`${bilan.langue}.json`, nom, `${nom} : nommé d'après sa langue`);
    assert.deepEqual(bilan.inconnus, [], `${nom} : identifiants inconnus`);
    assert.ok(paires.length > 0, `${nom} : au moins une phrase`);
    const f = x as { complet?: boolean; applis: Record<string, unknown> };
    if (f.complet === true) {
      const manquantes = [...applis.keys()].filter((id) => !(id in f.applis));
      assert.deepEqual(manquantes, [], `${nom} se dit complet : les 75 applis`);
    }
  }
  // Le chargeur lit tout le dossier sans rien refuser.
  const lu = lireMatiere(applis);
  assert.equal(lu.bilan.refuses, 0, JSON.stringify(lu.bilan.fichiers.filter((b) => b.refus)));
  assert.equal(lu.bilan.inconnus, 0);
  assert.equal(lu.bilan.fichiers.length, noms.length);
});

const APPLIS = new Map([['lyre_t', new Set(['jouer', 'pause'])], ['ciel_t', new Set(['prevoir'])]]);
const BON = { langue: 'fr', ecriture: 'latin', origine: 'essai', aRelire: false, applis: { lyre_t: { '*': ['mets du son'], jouer: ['lance la playlist'] } }, horsChamp: ['commande une pizza'] };

test('chargeur : un fichier juste devient des paires « demande »', () => {
  const r = lireFichierMatiere(BON, APPLIS, 'fr.json');
  assert.equal(r.bilan.refus, undefined);
  assert.deepEqual(r.paires.map((p) => [p.texte, p.appli, p.action, p.source, p.demande]), [
    ['mets du son', 'lyre_t', null, 'matiere:fr', true], ['lance la playlist', 'lyre_t', 'jouer', 'matiere:fr', true], ['commande une pizza', null, null, 'matiere:fr', true],
  ]);
  assert.equal(r.bilan.horsChamp, 1); assert.equal(r.bilan.applis, 1);
});

test('chargeur : formes fausses refusées en entier, avec la raison', () => {
  const cas: Array<[unknown, RegExp]> = [
    [null, /objet/], [[], /objet/], ['texte', /objet/],
    [{ ...BON, langue: 'FR' }, /langue/], [{ ...BON, langue: 'français' }, /langue/], [{ ...BON, langue: 'f' }, /langue/], [{ ...BON, langue: 'fr_FR' }, /langue/], [{ ...BON, langue: undefined }, /langue/],
    [{ ...BON, ecriture: '' }, /ecriture/], [{ ...BON, origine: 3 }, /origine/], [{ ...BON, aRelire: 'oui' }, /aRelire/],
    [{ ...BON, complet: 1 }, /complet/], [{ ...BON, applis: [] }, /applis/], [{ ...BON, horsChamp: 'x' }, /horsChamp/],
    [{ ...BON, applis: { lyre_t: ['x'] } }, /applis\.lyre_t/], [{ ...BON, applis: { lyre_t: { jouer: 'x' } } }, /applis\.lyre_t\.jouer/],
  ];
  for (const [x, raison] of cas) {
    const r = lireFichierMatiere(x, APPLIS, 'fr.json');
    assert.match(r.bilan.refus ?? '', raison, JSON.stringify(x));
    assert.deepEqual(r.paires, []);
  }
});

test('chargeur : appli ou action inconnue écartée (le reste gardé), phrases vides, trop longues ou en double écartées', () => {
  const x = {
    ...BON,
    applis: { lyre_t: { '*': ['mets du son', 'Mets  du son !', '', '   ', 42, 'x'.repeat(PHRASE_MAX + 1)], inventee: ['a'] }, fantome_t: { '*': ['boo'] }, ciel_t: { prevoir: ['la météo de demain'] } },
  };
  const r = lireFichierMatiere(x, APPLIS, 'fr.json');
  assert.equal(r.bilan.refus, undefined);
  assert.deepEqual(r.bilan.inconnus.sort(), ['fantome_t', 'lyre_t.inventee']);
  assert.equal(r.bilan.ecartees, 5, 'doublon, deux vides, un nombre, une trop longue');
  assert.deepEqual(r.paires.map((p) => p.texte), ['la météo de demain', 'mets du son', 'commande une pizza']);
});

test('chargeur : un dossier avec des fichiers abîmés ne plante ni le chargeur ni l\'aiguilleur', () => {
  const dir = dossier();
  try {
    writeFileSync(join(dir, 'fr.json'), JSON.stringify(BON));
    writeFileSync(join(dir, 'de.json'), '{ "langue": "de", ');
    writeFileSync(join(dir, 'es.json'), JSON.stringify({ ...BON, langue: 'it' }));
    writeFileSync(join(dir, 'pt.json'), JSON.stringify({ ...BON, langue: 'pt', applis: 'non' }));
    writeFileSync(join(dir, 'ja.json'), '﻿' + JSON.stringify({ ...BON, langue: 'ja', ecriture: 'kana', applis: { ciel_t: { prevoir: ['明日の天気'] } }, horsChamp: [] }));
    writeFileSync(join(dir, 'lisez-moi.txt'), 'pas de la matière');
    const r = lireMatiere(APPLIS, dir);
    assert.deepEqual(r.bilan.fichiers.map((b) => [b.fichier, Boolean(b.refus)]), [['de.json', true], ['es.json', true], ['fr.json', false], ['ja.json', false], ['pt.json', true]]);
    assert.equal(r.bilan.refuses, 3); assert.equal(r.bilan.paires, 4);
    assert.match(r.bilan.fichiers[0].refus ?? '', /JSON illisible/);
    assert.match(r.bilan.fichiers[1].refus ?? '', /nom du fichier/);
    // Dossier absent : aucune matière, sans erreur.
    assert.deepEqual(lireMatiere(APPLIS, join(dir, 'absent')).bilan.fichiers, []);
    // L'aiguilleur se construit avec ce dossier et s'en sert.
    const mods: ModuleMatiere[] = [
      { id: 'lyre_t', name: 'Lyre', what: 'écouter de la musique', words: ['musique'], actions: [{ id: 'jouer', label: 'Jouer', words: ['joue'] }, { id: 'pause', label: 'Pause' }] },
      { id: 'ciel_t', name: 'Ciel', what: 'la météo', words: ['météo'], actions: [{ id: 'prevoir', label: 'Prévisions' }] },
    ];
    const a = creerAiguilleurSync({ modules: mods, matiere: dir, reglages: { rapportHorsChamp: 1 } });
    assert.equal(a.bilan.matiere?.refuses, 3); assert.equal(a.bilan.matiere?.paires, 4);
    assert.equal(a.aiguiller('lance la playlist du soir').choix[0]?.appli, 'lyre_t');
    assert.equal(a.aiguiller('明日の天気は').choix[0]?.appli, 'ciel_t');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ------------------------------------------------------------------------------------------------ relecture du tour 2
test('langues à code de trois lettres (M2) : le shimaoré, le kibushi, l\'arabe marocain et une variante sont lus', () => {
  const dir = dossier();
  try {
    for (const code of ['swb', 'buc', 'ary', 'pt-br']) writeFileSync(join(dir, `${code}.json`), JSON.stringify({ ...BON, langue: code, applis: { lyre_t: { '*': [`son ${code}`] } }, horsChamp: [] }));
    const r = lireMatiere(APPLIS, dir);
    assert.equal(r.bilan.refuses, 0, JSON.stringify(r.bilan.fichiers.map((b) => b.refus)));
    assert.deepEqual(r.bilan.fichiers.map((b) => b.langue), ['ary', 'buc', 'pt-br', 'swb']);
    assert.deepEqual(r.paires.map((p) => p.source).sort(), ['matiere:ary', 'matiere:buc', 'matiere:pt-br', 'matiere:swb']);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('listes alignées (M1) : null garde la place d\'une phrase retirée ; les sœurs ont le même groupe', () => {
  const fr = lireFichierMatiere({ ...BON, applis: { lyre_t: { jouer: ['lance la playlist', null, 'remets la chanson'] } }, horsChamp: [null, 'commande une pizza'] }, APPLIS, 'fr.json');
  const en = lireFichierMatiere({ ...BON, langue: 'en', applis: { lyre_t: { jouer: [null, 'play it again', 'replay the song'] } }, horsChamp: ['order a pizza', 'book a taxi'] }, APPLIS, 'en.json');
  assert.equal(fr.bilan.ecartees, 0, 'une place vide n\'est pas une phrase écartée');
  assert.deepEqual(fr.paires.map((p) => p.groupe), ['lyre_t.jouer#0', 'lyre_t.jouer#2', 'horsChamp#1']);
  assert.deepEqual(en.paires.map((p) => p.groupe), ['lyre_t.jouer#1', 'lyre_t.jouer#2', 'horsChamp#0', 'horsChamp#1']);
  assert.equal(fr.paires[1].groupe, en.paires[1].groupe, '« remets la chanson » et « replay the song » sont sœurs');
});

test('fichiers trop gros (P6) : 1 Mio au plus par fichier, et un plafond pour toute la matière', () => {
  const dir = dossier();
  try {
    const gros = (code: string, n: number) => JSON.stringify({ ...BON, langue: code, applis: { lyre_t: { '*': Array.from({ length: n }, (_, i) => `phrase ${code} numéro ${i} ${'x'.repeat(400)}`) } }, horsChamp: [] });
    writeFileSync(join(dir, 'aa.json'), gros('aa', 2700)); // plus de 1 Mio
    for (const c of ['ba', 'bb', 'bc', 'bd', 'be']) writeFileSync(join(dir, `${c}.json`), gros(c, 2300)); // un peu moins de 1 Mio chacun
    const r = lireMatiere(APPLIS, dir);
    assert.match(r.bilan.fichiers[0].refus ?? '', /trop gros/);
    assert.equal(r.bilan.fichiers.filter((b) => !b.refus).length, 4, 'quatre fichiers de près de 1 Mio tiennent sous le plafond, pas cinq');
    assert.match(r.bilan.fichiers[5].refus ?? '', /dépasserait/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('matière du dépôt (M4, P2, P3, P4) : ni logiciel copié, ni nom de sa propre appli, origine honnête', async () => {
  const home = dossier();
  process.env.ODIN_HOME = home; process.env.ODIN_CLE_DIR = join(home, 'cles'); process.env.ODIN_ESSAI = '1'; process.env.ODIN_NO_VOICE_INSTALL = '1';
  const { allModules } = await import('../src/valhalla/odin.ts');
  const mods = allModules({ paths: { home, workspace: home }, cfg: { venus: {}, voice: {} } } as never);
  const norm = (t: string) => t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').normalize('NFC').replace(/[^\p{L}\p{N}\p{M}]+/gu, ' ').trim();
  const contient = (t: string, w: string) => ` ${t} `.includes(` ${w} `) || (/[^\x00-\x7f]/.test(t) && t.includes(w));
  const copies = [...new Set(mods.flatMap((m) => (m.from ?? []).map(norm).filter((x) => x.length >= 4)))];
  // Des noms d'applis qui sont aussi des mots courants : permis dans une phrase en lettres latines.
  const courants = new Set(['plume', 'aurore', 'echo', 'interprete', 'satellites', 'constellation', 'pyramide', 'arche', 'atlas', 'agora', 'persona', 'glyphes', 'hydre']);
  const fautes: string[] = [];
  for (const nom of readdirSync(DOSSIER_MATIERE).filter((n) => n.endsWith('.json'))) {
    const x = JSON.parse(readFileSync(join(DOSSIER_MATIERE, nom), 'utf8'));
    assert.doesNotMatch(x.origine, /écrit par/i, `${nom} : l'origine ne nomme pas qui l'a écrite`);
    if (/non relu/.test(x.origine)) assert.equal(x.aRelire, true, `${nom} : non relu, donc à relire`);
    for (const [id, acts] of Object.entries<Record<string, Array<string | null>>>(x.applis)) {
      const m = mods.find((y) => y.id === id); const n = m ? norm(m.name) : '';
      for (const s of Object.values(acts).flat()) {
        if (typeof s !== 'string') continue;
        const t = norm(s);
        const c = copies.find((w) => contient(t, w)); if (c) fautes.push(`${nom} ${id} : logiciel copié « ${c} »`);
        if (n.length >= 3 && (x.ecriture !== 'latin' || !courants.has(n)) && contient(t, n)) fautes.push(`${nom} ${id} : nomme son appli`);
      }
    }
  }
  assert.deepEqual(fautes.slice(0, 10), [], `${fautes.length} phrases fautives`);
});

test('l\'aiguilleur du produit avec la matière du dépôt (G1, M3) : il agit seul sur l\'appli, et une langue inconnue n\'a pas de choix', { timeout: 120_000 }, async () => {
  const home = dossier();
  try {
    process.env.ODIN_HOME = home; process.env.ODIN_CLE_DIR = join(home, 'cles'); process.env.ODIN_ESSAI = '1'; process.env.ODIN_NO_VOICE_INSTALL = '1';
    const { methodeBanc } = await import('../src/brain/nous/aiguilleur.ts');
    const a = await methodeBanc({ home });
    const c = a.bilan.calibration;
    assert.ok(c.seuilSeul < 1.01, `seuil « seul » ${c.seuilSeul} : l'aiguilleur n'agirait jamais seul`);
    assert.ok(c.seuilTrois <= c.seuilSeul);
    // Vietnamien (« mets de la musique dans le salon ») : la matière n'a pas cette langue.
    const vi = a.repondre('mở nhạc trong phòng khách');
    assert.equal(vi.decision, 'main', `vietnamien : ${vi.decision} (couverture ${vi.couverture})`);
    // Une écriture inconnue : la main, sans liste.
    assert.deepEqual(a.repondre('βάλε μουσική στο σαλόνι').choix, []);
  } finally { rmSync(home, { recursive: true, force: true }); }
});

// ------------------------------------------------------------------------------------------------ tour 5 (Soul v3)
test('matière du dépôt (tour 5) : chaque phrase est dans l\'écriture de sa langue', () => {
  // Une adresse, un sigle ou un nom de fichier en lettres latines est permis dans une phrase en arabe, en russe… ; une
  // phrase SANS l'écriture de sa langue ne l'est pas, ni une écriture étrangère dans une langue en lettres latines.
  // Le japonais a des kana (sinon ce serait du chinois) ; le chinois n'en a pas.
  const AUTRE = /[Ѐ-ӿ؀-ۿऀ-ॿ぀-ヿ㐀-鿿가-힯]/u;
  const REGLES: Record<string, (p: string) => boolean> = {
    ar: (p) => /[؀-ۿ]/u.test(p), ru: (p) => /[Ѐ-ӿ]/u.test(p), hi: (p) => /[ऀ-ॿ]/u.test(p), ko: (p) => /[가-힯]/u.test(p),
    ja: (p) => /[぀-ヿ]/u.test(p), zh: (p) => /[㐀-鿿]/u.test(p) && !/[぀-ヿ]/u.test(p),
  };
  const fautes: string[] = [];
  for (const nom of readdirSync(DOSSIER_MATIERE).filter((n) => n.endsWith('.json'))) {
    const x = JSON.parse(readFileSync(join(DOSSIER_MATIERE, nom), 'utf8')) as { langue: string; ecriture: string; applis: Record<string, Record<string, Array<string | null>>>; horsChamp?: Array<string | null> };
    const ok = REGLES[x.langue] ?? (x.ecriture === 'latin' ? (p: string) => !AUTRE.test(p) : () => true);
    for (const [id, acts] of Object.entries(x.applis)) for (const [act, l] of Object.entries(acts)) l.forEach((p, n) => { if (typeof p === 'string' && !ok(p)) fautes.push(`${nom} ${id}.${act}#${n}`); });
    (x.horsChamp ?? []).forEach((p, n) => { if (typeof p === 'string' && !ok(p)) fautes.push(`${nom} horsChamp#${n}`); });
  }
  assert.deepEqual(fautes.slice(0, 10), [], `${fautes.length} phrases dans une autre écriture`);
});
