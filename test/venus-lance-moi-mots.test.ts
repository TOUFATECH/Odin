// Vénus, sans modèle de langue : « lance-moi tel film, telle série, à tel épisode ». Les mots du propriétaire arrivent à
// l'action « regarder » avec le titre ENTIER et, quand ils sont dits, la saison et l'épisode en nombres ; une phrase qui
// parle d'autre chose ne part pas vers Vénus. Titres inventés, dossiers temporaires, aucun service réel.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { dirVenus, magasinVenus, oublierMagasins } from '../src/valhalla/venus/base.ts';
import { venus } from '../src/valhalla/modules/venus.ts';
import { tryDirect, type DirectDeps } from '../src/core/direct.ts';
import { forgetPending, understand } from '../src/valhalla/huginn.ts';
import { allModules, setValhalla } from '../src/valhalla/odin.ts';
import { Valhalla } from '../src/valhalla/service.ts';
import { valhallaTool } from '../src/tools/valhalla.ts';
import { auNomDe, setVerificateur } from '../src/valhalla/sso/acces.ts';

const LIGNE = /\n\n\[▶ Vénus : ([^\]\n]+)\]$/;
const sansCle = async (f: () => Promise<void>) => { const cle = process.env.VENUS_API_KEY; delete process.env.VENUS_API_KEY; try { await f(); } finally { if (cle === undefined) delete process.env.VENUS_API_KEY; else process.env.VENUS_API_KEY = cle; } };

function remplir(mag: ReturnType<typeof magasinVenus>, racine: string) {
  mag.poser('oeuvres', 'film:film-orage-2003', { type: 'film', titre: 'Film Orage', annee: 2003, fichier: join(racine, 'Film Orage 2003.mp4'), duree: 60 });
  mag.poser('oeuvres', 'serie:serie-lumen', { type: 'serie', titre: 'Serie Lumen' });
  for (const [sa, ep] of [[1, 1], [2, 4], [2, 5]]) mag.poser('episodes', `serie:serie-lumen:s${sa}e${ep}`, { oeuvre_id: 'serie:serie-lumen', saison: sa, episode: ep, titre: 'Serie Lumen', fichier: join(racine, `Serie Lumen S0${sa}E0${ep}.mp4`), duree: 60 });
}

async function avecValhalla(f: (v: Valhalla, home: string) => Promise<void>) {
  await sansCle(async () => {
    oublierMagasins();
    const home = mkdtempSync(join(tmpdir(), 'venus-lance-moi-'));
    const v = new Valhalla(home, allModules({ paths: { home, workspace: home }, cfg: { venus: {}, voice: {} } } as never), {
      run: async () => ({ code: 0, out: '', err: '' }), fetch: (async () => { throw new Error('réseau coupé'); }) as unknown as typeof fetch,
      notify: async () => {}, autonomy: () => 'equilibre', now: () => new Date(),
    });
    setValhalla(v);
    try {
      const c = v.ctx('freyja') as unknown as { home: string; dir: string };
      remplir(magasinVenus(c.home, c.dir), home);
      await f(v, home);
    } finally { setValhalla(undefined); v.stop(); rmSync(home, { recursive: true, force: true }); }
  });
}

let n = 0;
const compris = async (v: Valhalla, phrase: string) => { const s = `lance-moi-${n++}`; const u = await understand(v, phrase, s); forgetPending(s); return u; };

// ---------------- Ses mots, en français ----------------
test('ses mots arrivent à « regarder » avec le titre entier, et la saison et l\'épisode en nombres quand ils sont dits', async () => {
  await avecValhalla(async (v) => {
    for (const [phrase, quoi, saison, episode] of [
      ['lance-moi Serie Lumen', 'Serie Lumen'],
      ['lance-moi le film Film Orage', 'Film Orage'],
      ['lance Serie Lumen saison 2 épisode 5', 'Serie Lumen', 2, 5],
      ['lance-moi Serie Lumen saison 2 episode 4', 'Serie Lumen', 2, 4],
      ['mets-moi Serie Lumen S02E05', 'Serie Lumen S02E05'],
      ['lance-moi Serie Lumen S02E05', 'Serie Lumen S02E05'],
      ['lance Serie Lumen S02E05', 'Serie Lumen S02E05'],
      ['joue Film Orage', 'Film Orage'],
    ] as Array<[string, string, number?, number?]>) {
      const u = await compris(v, phrase);
      assert.equal(u?.kind, 'action', `${phrase} → ${JSON.stringify(u)}`);
      if (u?.kind !== 'action') continue;
      assert.equal(`${u.module}.${u.action}`, 'freyja.regarder', phrase);
      assert.equal(u.doubt, undefined, `${phrase} : aucun doute (${u.doubt})`);
      assert.equal(u.input.quoi, quoi, phrase);
      assert.equal(u.input.saison, saison, `${phrase} : saison`);
      assert.equal(u.input.episode, episode, `${phrase} : épisode`);
    }
  });
});

test('une phrase qui parle d\'autre chose ne part pas vers Vénus', async () => {
  await avecValhalla(async (v) => {
    for (const phrase of ['lance la sauvegarde', 'mets la lumière', 'lance-moi la sauvegarde', 'mets la lumière du salon']) {
      const u = await compris(v, phrase);
      assert.ok(!(u && (u.kind === 'action' || u.kind === 'ask') && u.module === 'freyja'), `${phrase} → ${JSON.stringify(u)}`);
    }
  });
});

// ---------------- Titres neutres (aucun mot de Vénus dedans) ----------------
// Un, deux et trois mots, avec accents, en minuscules, avec article : rien dans le titre ne dit « film » ni « série ».
function remplirNeutres(mag: ReturnType<typeof magasinVenus>, racine: string) {
  mag.poser('oeuvres', 'film:brume', { type: 'film', titre: 'Brume', fichier: join(racine, 'Brume.mp4'), duree: 60 });
  mag.poser('oeuvres', 'film:ete-glace', { type: 'film', titre: 'Été Glacé', fichier: join(racine, 'Ete Glace.mp4'), duree: 60 });
  for (const [id, titre, sa, ep] of [['les-trois-lunes', 'Les Trois Lunes', 3, 7], ['jardin-noir', 'Jardin Noir', 2, 10], ['ocean', 'Océan', 1, 2]] as Array<[string, string, number, number]>) {
    mag.poser('oeuvres', `serie:${id}`, { type: 'serie', titre });
    mag.poser('episodes', `serie:${id}:s${sa}e${ep}`, { oeuvre_id: `serie:${id}`, saison: sa, episode: ep, titre, fichier: join(racine, `${titre} S0${sa}E${ep}.mp4`), duree: 60 });
  }
}

test('titres neutres : « lance-moi <titre> » arrive à « regarder » avec le titre entier, sans doute', async () => {
  await avecValhalla(async (v, home) => {
    const c = v.ctx('freyja') as unknown as { home: string; dir: string };
    remplirNeutres(magasinVenus(c.home, c.dir), home);
    for (const [phrase, quoi, saison, episode] of [
      ['lance-moi Brume', 'Brume'],
      ['Lance-moi Brume', 'Brume'],
      ['lance moi Brume', 'Brume'],
      ['lance-moi brume', 'brume'],
      ['lance-moi Été Glacé', 'Été Glacé'],
      ['mets-moi Jardin Noir S02E10', 'Jardin Noir S02E10'],
      ['joue Brume', 'Brume'],
      ['lance-moi les trois lunes s03e07', 'les trois lunes s03e07'],
      ['regarde Océan S01E02', 'Océan S01E02'],
      ['lance-moi Les Trois Lunes', 'Les Trois Lunes'],
      ['lance-moi Les Trois Lunes saison 3 épisode 7', 'Les Trois Lunes', 3, 7],
      ['lance-moi la série Jardin Noir, saison 2, épisode 10', 'Jardin Noir', 2, 10],
    ] as Array<[string, string, number?, number?]>) {
      const u = await compris(v, phrase);
      assert.equal(u?.kind, 'action', `${phrase} → ${JSON.stringify(u)}`);
      if (u?.kind !== 'action') continue;
      assert.equal(`${u.module}.${u.action}`, 'freyja.regarder', phrase);
      assert.equal(u.doubt, undefined, `${phrase} : aucun doute (${u.doubt})`);
      assert.equal(u.input.quoi, quoi, phrase);
      assert.equal(u.input.saison, saison, `${phrase} : saison`);
      assert.equal(u.input.episode, episode, `${phrase} : épisode`);
    }
    // « à tel épisode » (ses mots) : rien ne part dans le réglage de l'écran.
    for (const phrase of ['lance-moi Les Trois Lunes à la saison 3 épisode 7', 'lance-moi Océan à l\'épisode 2 de la saison 1']) {
      const u = await compris(v, phrase);
      assert.equal(u?.kind === 'action' && `${u.module}.${u.action}`, 'freyja.regarder', `${phrase} → ${JSON.stringify(u)}`);
      if (u?.kind !== 'action') continue;
      assert.equal(u.input.ou, '', `${phrase} : écran vide (${JSON.stringify(u.input)})`);
      assert.match(String(u.input.quoi), /^(?:Les Trois Lunes|Océan)$/, phrase);
    }
    // Un titre qui n'est PAS dans la bibliothèque, ou une autre appli : rien n'est forcé vers Vénus.
    for (const phrase of ['lance-moi Spotify', 'lance-moi la sauvegarde', 'joue la playlist Calme', 'mets la lumière', 'lance le minuteur de 5 minutes', 'ouvre-moi le portail']) {
      const u = await compris(v, phrase);
      assert.ok(!(u && (u.kind === 'action' || u.kind === 'ask') && u.module === 'freyja'), `${phrase} → ${JSON.stringify(u)}`);
    }
  });
});

test('titres neutres, de la phrase au bon fichier, sans modèle de langue', async () => {
  await avecValhalla(async (v, home) => {
    const c = v.ctx('freyja') as unknown as { home: string; dir: string };
    remplirNeutres(magasinVenus(c.home, c.dir), home);
    const store = new Map<string, string>();
    const d: DirectDeps = {
      sessionId: 'web:neutres', has: (t) => t === 'valhalla', kv: { getKv: (k) => store.get(k), setKv: (k, val) => { store.set(k, val); } },
      run: async (_name, input) => { const r = await valhallaTool.run(input, { sessionId: 'web:neutres' } as never); return { ok: true, content: typeof r === 'string' ? r : (r as { output: string }).output }; },
    };
    for (const [phrase, cible] of [
      ['lance-moi Brume', 'film:brume'],
      ['lance-moi Été Glacé', 'film:ete-glace'],
      ['mets-moi Jardin Noir S02E10', 'serie:jardin-noir:s2e10'],
      ['lance-moi les trois lunes s03e07', 'serie:les-trois-lunes:s3e7'],
      ['lance-moi Océan à l\'épisode 2 de la saison 1', 'serie:ocean:s1e2'],
    ]) {
      const r = await tryDirect(phrase, d); forgetPending(d.sessionId);
      assert.equal(r.done, true, `${phrase} : ${r.why}`);
      assert.equal(LIGNE.exec((r as { text: string }).text)?.[1], cible, phrase);
    }
  });
});

// ---------------- De la phrase écrite jusqu'au bon fichier, sans modèle de langue ----------------
test('sans modèle de langue : « lance-moi … saison 2 épisode 5 » et « mets-moi … S02E05 » jouent CE fichier', async () => {
  await avecValhalla(async () => {
    const store = new Map<string, string>(), appels: string[] = [];
    const d: DirectDeps = {
      sessionId: 'web:lance-moi', has: (t) => t === 'valhalla', kv: { getKv: (k) => store.get(k), setKv: (k, val) => { store.set(k, val); } },
      run: async (name, input) => { appels.push(`${name}:${String(input.appli)}.${String(input.quoi)}`); const r = await valhallaTool.run(input, { sessionId: 'web:lance-moi' } as never); return { ok: true, content: typeof r === 'string' ? r : (r as { output: string }).output }; },
    };
    for (const [phrase, cible] of [
      ['lance-moi Serie Lumen saison 2 épisode 5', 'serie:serie-lumen:s2e5'],
      ['mets-moi Serie Lumen S02E04', 'serie:serie-lumen:s2e4'],
      ['lance-moi le film Film Orage', 'film:film-orage-2003'],
    ]) {
      appels.length = 0;
      const r = await tryDirect(phrase, d); forgetPending(d.sessionId);
      assert.equal(r.done, true, `${phrase} : ${r.why}`);
      assert.deepEqual(appels, ['valhalla:freyja.regarder'], phrase);
      assert.equal(LIGNE.exec((r as { text: string }).text)?.[1], cible, phrase);
    }
  });
});

// ---------------- Le nom d'une appli n'est jamais pris pour un titre ----------------
// « lance Dédale » (le nom de l'appli, avec sa majuscule) : avant, Odin demandait quel projet ; il ne propose pas de lancer
// un projet appelé « Dédale », ni de jouer « Apollon », ni de chercher « Vénus » dans la bibliothèque.
test('le nom d\'une appli, écrit avec sa majuscule, n\'est pas pris pour le titre ou la chose demandée', async () => {
  await avecValhalla(async (v) => {
    for (const [phrase, nom] of [['lance Dédale', 'Dédale'], ['ouvre Prónoia', 'Prónoia'], ['lance Apollon', 'Apollon'], ['ouvre Vénus', 'Vénus'], ['lance Vénus', 'Vénus']]) {
      const u = await compris(v, phrase);
      assert.ok(!(u?.kind === 'action' && Object.values(u.input).includes(nom)), `${phrase} → ${JSON.stringify(u)}`);
    }
  });
});

// ---------------- Droits : un membre sans droit sur Vénus n'apprend rien de sa bibliothèque ----------------
test('un membre sans droit sur Vénus : la réponse ne dépend pas des titres de la bibliothèque', async () => {
  await avecValhalla(async (v, home) => {
    const phrases = ['lance Brume', 'joue Brume', 'lance-moi Brume', 'mets la lumière', 'play Brume'];
    const membre = { login: 'membre-essai', name: 'Membre', groups: [] };
    const commeMembre = async () => { const r: string[] = []; for (const p of phrases) r.push(JSON.stringify(await auNomDe(membre, () => compris(v, p)) ?? null)); return r; };
    setVerificateur((id) => (id === 'freyja' ? 'pas le droit sur Vénus' : undefined));
    try {
      const sans = await commeMembre();
      const c = v.ctx('freyja') as unknown as { home: string; dir: string }, mag = magasinVenus(c.home, c.dir);
      mag.poser('oeuvres', 'film:brume', { type: 'film', titre: 'Brume', fichier: join(home, 'Brume.mp4'), duree: 60 });
      mag.poser('oeuvres', 'film:la-lumiere', { type: 'film', titre: 'La Lumière', fichier: join(home, 'La Lumiere.mp4'), duree: 60 });
      assert.deepEqual(await commeMembre(), sans);
      // Le propriétaire, lui, trouve bien le titre (l'essai regarde quelque chose).
      const u = await compris(v, 'lance Brume');
      assert.equal(u?.kind === 'action' && `${u.module}.${u.action}`, 'freyja.regarder', JSON.stringify(u));
    } finally { setVerificateur(undefined as never); }
  });
});

// ---------------- L'action : saison et épisode donnés à part ----------------
test('l\'action « regarder » : saison et épisode donnés à part ne restent pas collés au titre cherché', async () => {
  await sansCle(async () => {
    oublierMagasins();
    const home = mkdtempSync(join(tmpdir(), 'venus-lance-moi-act-'));
    try {
      const dir = dirVenus(home), mag = magasinVenus(home, dir);
      remplir(mag, home);
      const ctx = { home, dir, settings: {}, saveSettings() {}, alert() {}, emit() {}, now: () => new Date() } as never;
      const regarder = venus(() => '').actions.find((a) => a.id === 'regarder')!;
      // Ce qu'un modèle de langue (ou une ancienne demande) peut envoyer : les mots de la saison et de l'épisode restés dans le titre.
      const r = await regarder.run(ctx, { ou: '', quoi: 'Serie Lumen saison 2 episode 4', saison: 2, episode: 4 }) as { text: string };
      assert.equal(LIGNE.exec(r.text)?.[1], 'serie:serie-lumen:s2e4', r.text);
      // Sans saison ni épisode donnés à part : rien n'est retiré du titre (pas de titre inventé).
      const r2 = await regarder.run(ctx, { ou: '', quoi: 'Serie Lumen saison 2 episode 4' }) as { text: string };
      assert.doesNotMatch(r2.text, /\[▶ Vénus/, r2.text);
    } finally { rmSync(home, { recursive: true, force: true }); }
  });
});
