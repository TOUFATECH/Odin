// Vénus, sans modèle de langue : « lance-moi tel film, telle série, à tel épisode » dans les autres langues que Logos
// comprend déjà (anglais, espagnol, allemand, japonais ; leurs mots sont dans src/langue/langues/*.json). La demande arrive
// à l'action « regarder » avec le titre EXACT de la bibliothèque, et la saison et l'épisode en nombres ; une phrase d'une
// autre appli qui commence par le même verbe donne le même résultat qu'avant ; un titre absent de la bibliothèque ne part
// pas vers Vénus. Titres inventés, dossiers temporaires, aucun service réel.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { magasinVenus, oublierMagasins } from '../src/valhalla/venus/base.ts';
import { tryDirect, type DirectDeps } from '../src/core/direct.ts';
import { forgetPending, understand } from '../src/valhalla/huginn.ts';
import { allModules, setValhalla } from '../src/valhalla/odin.ts';
import { Valhalla } from '../src/valhalla/service.ts';
import { valhallaTool } from '../src/tools/valhalla.ts';

const LIGNE = /\n\n\[▶ Vénus : ([^\]\n]+)\]$/;

async function avecValhalla(f: (v: Valhalla) => Promise<void>, autres: string[] = []) {
  const cle = process.env.VENUS_API_KEY; delete process.env.VENUS_API_KEY;
  oublierMagasins();
  const home = mkdtempSync(join(tmpdir(), 'venus-langues-'));
  const v = new Valhalla(home, allModules({ paths: { home, workspace: home }, cfg: { venus: {}, voice: {} } } as never), {
    run: async () => ({ code: 0, out: '', err: '' }), fetch: (async () => { throw new Error('réseau coupé'); }) as unknown as typeof fetch,
    notify: async () => {}, autonomy: () => 'equilibre', now: () => new Date(),
  });
  setValhalla(v);
  try {
    const c = v.ctx('freyja') as unknown as { home: string; dir: string }, mag = magasinVenus(c.home, c.dir);
    // Des titres français (un, deux et trois mots, avec accents) : rien dans le titre ne dit « film » ni « série ».
    mag.poser('oeuvres', 'film:brume', { type: 'film', titre: 'Brume', fichier: join(home, 'Brume.mp4'), duree: 60 });
    mag.poser('oeuvres', 'film:ete-glace', { type: 'film', titre: 'Été Glacé', fichier: join(home, 'Ete Glace.mp4'), duree: 60 });
    for (const [id, titre, sa, ep] of [['les-trois-lunes', 'Les Trois Lunes', 3, 7], ['jardin-noir', 'Jardin Noir', 2, 10], ['ocean', 'Océan', 1, 2]] as Array<[string, string, number, number]>) {
      mag.poser('oeuvres', `serie:${id}`, { type: 'serie', titre });
      mag.poser('episodes', `serie:${id}:s${sa}e${ep}`, { oeuvre_id: `serie:${id}`, saison: sa, episode: ep, titre, fichier: join(home, `${titre} S0${sa}E${ep}.mp4`), duree: 60 });
    }
    autres.forEach((titre, k) => mag.poser('oeuvres', `film:autre-${k}`, { type: 'film', titre, fichier: join(home, `autre-${k}.mp4`), duree: 60 }));
    await f(v);
  } finally {
    setValhalla(undefined); v.stop(); rmSync(home, { recursive: true, force: true });
    if (cle !== undefined) process.env.VENUS_API_KEY = cle;
  }
}

let n = 0;
const compris = async (v: Valhalla, phrase: string) => { const s = `langues-${n++}`; const u = await understand(v, phrase, s); forgetPending(s); return u; };
/** Ce que Logos en fait, en court : « rien », « appli.action », « … (demande) », « … ?doute ». */
const resume = async (v: Valhalla, phrase: string) => {
  const u = await compris(v, phrase);
  return !u ? 'rien' : u.kind === 'action' ? `${u.module}.${u.action}${u.doubt ? ' ?doute' : ''}` : u.kind === 'ask' ? `${u.module}.${u.action} (demande)` : u.kind;
};

// [phrase, titre attendu dans « quoi », saison, épisode]
type Cas = [string, string, number?, number?];
const LANGUES: Record<string, Cas[]> = {
  anglais: [
    ['play Brume', 'Brume'],
    ['put on Brume', 'Brume'],
    ['play the movie Été Glacé', 'Été Glacé'],
    ['play Jardin Noir season 2 episode 10', 'Jardin Noir', 2, 10],
    ['put on Les Trois Lunes, season 3, episode 7', 'Les Trois Lunes', 3, 7],
    ['play season 2 episode 10 of Jardin Noir', 'Jardin Noir', 2, 10],
    ['play Jardin Noir series 2 episode 10', 'Jardin Noir', 2, 10],
    ['play Océan S01E02', 'Océan S01E02'],
  ],
  espagnol: [
    ['ponme Brume', 'Brume'],
    ['reproduce Brume', 'Brume'],
    ['pon la película Été Glacé', 'Été Glacé'],
    ['pon Jardin Noir temporada 2 episodio 10', 'Jardin Noir', 2, 10],
    ['ponme Les Trois Lunes, temporada 3, capítulo 7', 'Les Trois Lunes', 3, 7],
    ['reproduce Océan S01E02', 'Océan S01E02'],
  ],
  allemand: [
    ['Spiel Brume', 'Brume'],
    ['Spiele Brume', 'Brume'],
    ['Spiel den Film Été Glacé', 'Été Glacé'],
    ['Spiel Jardin Noir Staffel 2 Folge 10', 'Jardin Noir', 2, 10],
    ['Spiel Océan S01E02', 'Océan S01E02'],
  ],
  // Le verbe vient à la fin, et l'écriture n'a pas d'espaces : la phrase est lue depuis la fin (verbe, petits mots collés).
  japonais: [
    ['Brumeを再生して', 'Brume'],
    ['映画「Été Glacé」を再生して', 'Été Glacé'],
    ['Jardin Noirのシーズン2第10話を再生して', 'Jardin Noir', 2, 10],
    ['Les Trois Lunesのシーズン3、7話を流して', 'Les Trois Lunes', 3, 7],
    ['Océan S01E02を再生して', 'Océan S01E02'],
  ],
};

test('quatre langues : la demande arrive à « regarder » avec le titre exact, et la saison et l\'épisode en nombres', async () => {
  await avecValhalla(async (v) => {
    for (const [langue, cas] of Object.entries(LANGUES)) for (const [phrase, quoi, saison, episode] of cas) {
      const u = await compris(v, phrase);
      assert.equal(u?.kind === 'action' && `${u.module}.${u.action}`, 'freyja.regarder', `${langue} : ${phrase} → ${JSON.stringify(u)}`);
      if (u?.kind !== 'action') continue;
      assert.equal(u.doubt, undefined, `${langue} : ${phrase} : aucun doute (${u.doubt})`);
      assert.equal(u.input.quoi, quoi, `${langue} : ${phrase}`);
      assert.equal(u.input.saison, saison, `${langue} : ${phrase} : saison`);
      assert.equal(u.input.episode, episode, `${langue} : ${phrase} : épisode`);
    }
  });
});

test('quatre langues, de la phrase au bon fichier, sans modèle de langue', async () => {
  await avecValhalla(async (v) => {
    void v;
    const store = new Map<string, string>(), appels: string[] = [];
    const d: DirectDeps = {
      sessionId: 'web:langues', has: (t) => t === 'valhalla', kv: { getKv: (k) => store.get(k), setKv: (k, val) => { store.set(k, val); } },
      run: async (name, input) => { appels.push(`${name}:${String(input.appli)}.${String(input.quoi)}`); const r = await valhallaTool.run(input, { sessionId: 'web:langues' } as never); return { ok: true, content: typeof r === 'string' ? r : (r as { output: string }).output }; },
    };
    for (const [phrase, cible] of [
      ['play Brume', 'film:brume'],
      ['put on Les Trois Lunes, season 3, episode 7', 'serie:les-trois-lunes:s3e7'],
      ['pon Jardin Noir temporada 2 episodio 10', 'serie:jardin-noir:s2e10'],
      ['ponme Les Trois Lunes, temporada 3, capítulo 7', 'serie:les-trois-lunes:s3e7'],
      ['Spiel Jardin Noir Staffel 2 Folge 10', 'serie:jardin-noir:s2e10'],
      ['Spiel den Film Été Glacé', 'film:ete-glace'],
      ['Jardin Noirのシーズン2第10話を再生して', 'serie:jardin-noir:s2e10'],
      ['Océan S01E02を再生して', 'serie:ocean:s1e2'],
    ]) {
      appels.length = 0;
      const r = await tryDirect(phrase, d); forgetPending(d.sessionId);
      assert.equal(r.done, true, `${phrase} : ${r.why}`);
      assert.deepEqual(appels, ['valhalla:freyja.regarder'], phrase);
      assert.equal(LIGNE.exec((r as { text: string }).text)?.[1], cible, phrase);
    }
  });
});

// Ce que donnaient ces phrases AVANT ce lot (rejouées sur une copie du code d'avant) : rien ne doit changer.
const AUTRES: Record<string, Array<[string, string]>> = {
  anglais: [
    ['play some jazz', 'rien'],
    ['play my Calme playlist', 'aegir.indexer ?doute'],
    ['play the radio', 'aegir.indexer ?doute'],
    ['put on some music', 'rien'],
    ['put on the heating', 'rien'],
    ['play a sound on my phone', 'rien'],
  ],
  espagnol: [
    ['pon música relajante', 'rien'],
    ['ponme la radio', 'aegir.indexer ?doute'],
    ['pon la calefacción a 21 grados', 'rien'],
    ['pon una alarma a las 7', 'rien'],
    ['reproduce mi lista Calme', 'rien'],
  ],
  allemand: [
    ['Spiel entspannte Musik', 'rien'],
    ['Spiel meine Playlist Calme', 'aegir.indexer ?doute'],
    ['Spiel das Radio', 'aegir.indexer ?doute'],
    ['Spiele ein Geräusch auf meinem Handy', 'rien'],
    ['Spiel die Nachrichten', 'rien'],
  ],
  japonais: [
    ['音楽を再生して', 'rien'],
    ['ラジオを再生して', 'rien'],
    ['ジャズを流して', 'rien'],
    ['プレイリストCalmeを再生して', 'rien'],
    ['ニュースを再生して', 'rien'],
    ['YouTubeで音楽を流して', 'rien'],
  ],
};

test('quatre langues : les phrases d\'autres applis qui commencent (ou finissent) par les mêmes verbes ne changent pas', async () => {
  await avecValhalla(async (v) => {
    for (const [langue, cas] of Object.entries(AUTRES)) for (const [phrase, avant] of cas) {
      const r = await resume(v, phrase);
      assert.ok(!r.startsWith('freyja.'), `${langue} : ${phrase} ne part pas vers Vénus (${r})`);
      assert.equal(r, avant, `${langue} : ${phrase} : même résultat qu'avant`);
    }
  });
});

test('un titre absent de la bibliothèque ne part pas vers Vénus, quelle que soit la langue', async () => {
  await avecValhalla(async (v) => {
    for (const phrase of [
      'play Nuit Rouge', 'put on Nuit Rouge', 'play the movie Nuit Rouge', 'play Nuit Rouge S02E03',
      'ponme Nuit Rouge', 'pon la película Nuit Rouge', 'reproduce Nuit Rouge S02E03',
      'Spiel Nuit Rouge', 'Spiele Nuit Rouge S02E03',
      'Nuit Rougeを再生して', '映画「Nuit Rouge」を再生して', 'Nuit Rougeのシーズン2第3話を再生して',
      // Un mot d'une autre écriture devant un titre connu : ce n'est pas ce titre.
      'joue 霧 Brume', 'play 霧 Brume', 'プレイリストBrumeを再生して',
      // Un titre absent que la recherche de Vénus ne trouve pas non plus, entouré de mots qu'elle ne lit pas (relecture).
      'Spiel den Film Nuit Rouge', 'pon la película Nuit Rouge en la tele', 'pon Nuit Rouge en la tele del salón',
      'play Nuit Rouge season two episode five', 'put on Nuit Rouge season 2 episode 3',
      // Un titre présent, mais des mots que rien ne lit (« en la tele del salón », des nombres en lettres) : Vénus aurait
      // cherché toute la phrase et répondu, à tort, que le titre n'est pas dans la bibliothèque.
      'Pon Brume en la tele del salón', 'play Jardin Noir season two episode five',
    ]) {
      const u = await compris(v, phrase);
      assert.ok(!(u && (u.kind === 'action' || u.kind === 'ask') && u.module === 'freyja'), `${phrase} → ${JSON.stringify(u)}`);
    }
    // Les phrases françaises d'avant ce lot ne changent pas : Vénus y répond elle-même que le titre manque, et comment l'ajouter.
    assert.equal(await resume(v, 'lance le film Nuit Rouge'), 'freyja.regarder');
  });
});

test('le titre exact est retrouvé quelle que soit la langue de la phrase (titres français demandés dans les quatre langues)', async () => {
  await avecValhalla(async (v) => {
    for (const phrase of ['play Été Glacé', 'ponme Été Glacé', 'Spiel Été Glacé', 'Été Glacéを再生して', 'lance-moi Été Glacé']) {
      const u = await compris(v, phrase);
      assert.equal(u?.kind === 'action' && `${u.module}.${u.action}:${String(u.input.quoi)}`, 'freyja.regarder:Été Glacé', `${phrase} → ${JSON.stringify(u)}`);
    }
  });
});

// Des titres de la bibliothèque qui portent un nom courant : la demande d'une autre appli n'est jamais détournée vers Vénus.
const COURANTS = ['La Lumière', 'Sauvegarde', 'Portail', 'Radio'];

test('un titre au nom courant ne détourne pas en silence la demande d\'une autre appli : je propose les deux', async () => {
  await avecValhalla(async (v) => {
    for (const [phrase, autre, titre] of [
      ['mets la lumière', 'Constellation', 'la lumière'],
      ['lance la sauvegarde', 'Phénix', 'sauvegarde'],
      ['ouvre le portail', 'Constellation', 'portail'],
      ['mets la radio', 'Apollon', 'radio'],
      ['play the radio', 'Apollon', 'radio'],
      ['put on the radio', 'Apollon', 'radio'],
      ['ponme la radio', 'Apollon', 'radio'],
      ['Spiel das Radio', 'Apollon', 'Radio'],
    ]) {
      const u = await compris(v, phrase);
      assert.equal(u?.kind, 'say', `${phrase} → ${JSON.stringify(u)}`);
      if (u?.kind !== 'say') continue;
      assert.equal(u.unsure, true, phrase);
      assert.ok(u.text.includes(autre) && u.text.includes(`« ${titre} »`) && u.text.includes('Vénus'), `${phrase} : les deux choix (${u.text})`);
    }
    // Ce qui était compris sûrement, ou par une autre appli avec ses mots à elle, ne change pas.
    assert.equal(await resume(v, 'mets la lumière du salon'), 'appareils.commander (demande)');
    assert.equal(await resume(v, 'allume la lumière'), 'appareils.commander ?doute');
    // La phrase proposée pour Vénus lève le doute.
    const q = await compris(v, 'mets la lumière');
    const dit = q?.kind === 'say' ? /« (regarde le film [^»]+) »/.exec(q.text)?.[1] : undefined;
    assert.equal(dit, 'regarde le film la lumière', JSON.stringify(q));
    const u = await compris(v, dit!);
    assert.equal(u?.kind === 'action' && `${u.module}.${u.action}:${String(u.input.quoi)}`, 'freyja.regarder:la lumière', JSON.stringify(u));
    // Une autre appli devinée loin alors qu'aucun mot de la phrase n'est à elle : le titre exact passe (toutes langues).
    for (const phrase of ['play Les Trois Lunes', 'Les Trois Lunesを再生して']) {
      const r = await compris(v, phrase);
      assert.equal(r?.kind === 'action' && `${r.module}.${r.action}:${String(r.input.quoi)}`, 'freyja.regarder:Les Trois Lunes', `${phrase} → ${JSON.stringify(r)}`);
    }
  }, COURANTS);
});

test('de bout en bout, sans modèle de langue : « mets la lumière » ne lance pas le film « La Lumière »', async () => {
  await avecValhalla(async () => {
    const store = new Map<string, string>(), appels: string[] = [];
    const d: DirectDeps = {
      sessionId: 'web:courants', has: (t) => t === 'valhalla', kv: { getKv: (k) => store.get(k), setKv: (k, val) => { store.set(k, val); } },
      run: async (name, input) => { appels.push(`${name}:${String(input.appli)}.${String(input.quoi)}`); const r = await valhallaTool.run(input, { sessionId: 'web:courants' } as never); return { ok: true, content: typeof r === 'string' ? r : (r as { output: string }).output }; },
    };
    for (const phrase of ['mets la lumière', 'lance la sauvegarde']) {
      appels.length = 0;
      const r = await tryDirect(phrase, d); forgetPending(d.sessionId);
      assert.ok(!appels.some((x) => x.startsWith('valhalla:freyja.')), `${phrase} : ${appels.join(', ')}`);
      if (r.done) assert.match((r as { text: string }).text, /Tu parles de .+ ou de regarder/, phrase);
    }
  }, COURANTS);
});

test('« Spiel ein Spiel » (jouer à un jeu) ne pose pas à Vénus la question « quel titre ? » ; « mets un film » la pose toujours', async () => {
  await avecValhalla(async (v) => {
    assert.equal(await resume(v, 'Spiel ein Spiel'), 'rien');
    assert.equal(await resume(v, 'mets un film'), 'freyja.regarder (demande)');
  });
});
