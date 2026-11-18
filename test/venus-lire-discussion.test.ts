// Vénus depuis la discussion : « lance-moi tel film, telle série, à tel épisode ». Quand l'action « regarder » trouve un
// fichier, sa réponse finit par une ligne qui ne porte que l'identifiant de ce titre ; la discussion (ui.html) en fait un
// bouton « Lire » (un clic, jamais une lecture toute seule) qui ouvre Vénus et démarre le lecteur sur CE fichier.
// Titres inventés, dossiers temporaires, aucun service réel.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import vm from 'node:vm';
import { dirVenus, magasinVenus, oublierMagasins } from '../src/valhalla/venus/base.ts';
import { venus, ligneLireVenus } from '../src/valhalla/modules/venus.ts';
import { tryDirect, type DirectDeps } from '../src/core/direct.ts';
import { forgetPending } from '../src/valhalla/huginn.ts';
import { allModules, setValhalla } from '../src/valhalla/odin.ts';
import { Valhalla } from '../src/valhalla/service.ts';
import { valhallaTool } from '../src/tools/valhalla.ts';

type Res = { text: string; data?: Record<string, unknown> };
const LIGNE = /\n\n\[▶ Vénus : ([^\]\n]+)\]$/;
const sansCle = async (f: () => Promise<void>) => { const cle = process.env.VENUS_API_KEY; delete process.env.VENUS_API_KEY; try { await f(); } finally { if (cle === undefined) delete process.env.VENUS_API_KEY; else process.env.VENUS_API_KEY = cle; } };

function monter() {
  oublierMagasins();
  const home = mkdtempSync(join(tmpdir(), 'venus-lire-disc-')), dir = dirVenus(home);
  const ctx = { home, dir, settings: {}, saveSettings() {}, alert() {}, emit() {}, now: () => new Date() } as never;
  const regarder = venus(() => '').actions.find((a) => a.id === 'regarder')!;
  return { home, mag: magasinVenus(home, dir), run: (i: Record<string, unknown>) => regarder.run(ctx, { ou: '', ...i }) as Promise<Res> };
}
function remplir(mag: ReturnType<typeof magasinVenus>, racine: string) {
  mag.poser('oeuvres', 'film:film-orage-2003', { type: 'film', titre: 'Film Orage', annee: 2003, fichier: join(racine, 'Film Orage 2003.mp4'), duree: 60 });
  mag.poser('oeuvres', 'serie:serie-lumen', { type: 'serie', titre: 'Serie Lumen' });
  for (const [sa, ep] of [[1, 1], [2, 4], [2, 5]]) mag.poser('episodes', `serie:serie-lumen:s${sa}e${ep}`, { oeuvre_id: 'serie:serie-lumen', saison: sa, episode: ep, titre: 'Serie Lumen', fichier: join(racine, `Serie Lumen S0${sa}E0${ep}.mp4`), duree: 60 });
  mag.poser('oeuvres', 'album:album-brise', { type: 'album', titre: 'Album Brise' });
  mag.poser('pistes', 'album:album-brise:p1:un', { oeuvre_id: 'album:album-brise', num: 1, titre: 'Un', fichier: join(racine, '01 Un.mp3'), duree: 60 });
}

// ---------------- L'action « regarder » ----------------
test('une demande réussie : la réponse finit par la ligne « Lire » avec l\'identifiant exact du fichier trouvé', async () => {
  await sansCle(async () => {
    const o = monter();
    try {
      remplir(o.mag, o.home);
      for (const [i, attendu] of [
        [{ quoi: 'Serie Lumen S02E05' }, 'serie:serie-lumen:s2e5'],
        [{ quoi: 'Serie Lumen', saison: 2, episode: 4 }, 'serie:serie-lumen:s2e4'],
        [{ quoi: 'Film Orage' }, 'film:film-orage-2003'],
        [{ quoi: 'Album Brise' }, 'album:album-brise:p1:un'],
        // une série sans numéro : l'épisode qui suit le dernier vu (rien de vu : le premier)
        [{ quoi: 'Serie Lumen' }, 'serie:serie-lumen:s1e1'],
      ] as Array<[Record<string, unknown>, string]>) {
        const r = await o.run(i);
        assert.equal(LIGNE.exec(r.text)?.[1], attendu, JSON.stringify(i));
        assert.equal(r.data?.cible, attendu, 'la même cible que la donnée « cible »');
        assert.match(r.text, /est dans ta bibliothèque de Vénus/, 'le texte d\'avant reste');
      }
    } finally { rmSync(o.home, { recursive: true, force: true }); }
  });
});

test('une série sans numéro, après un épisode vu jusqu\'au bout : la ligne « Lire » porte l\'épisode SUIVANT', async () => {
  await sansCle(async () => {
    const o = monter();
    try {
      remplir(o.mag, o.home);
      o.mag.poser('reprise', 'moi:serie:serie-lumen:s2e4', { profil: 'moi', cible_id: 'serie:serie-lumen:s2e4', position_s: 60, duree_s: 60, maj: Date.now() });
      const r = await o.run({ quoi: 'Serie Lumen' });
      assert.equal(LIGNE.exec(r.text)?.[1], 'serie:serie-lumen:s2e5', r.text);
      assert.equal(r.data?.cible, 'serie:serie-lumen:s2e5');
    } finally { rmSync(o.home, { recursive: true, force: true }); }
  });
});

test('sans résultat, sans titre, épisode absent, numéro sans saison : aucune ligne « Lire », le texte dit quoi faire', async () => {
  await sansCle(async () => {
    const o = monter();
    try {
      remplir(o.mag, o.home);
      for (const i of [{ quoi: 'Titre Absent' }, { quoi: 'S02E05' }, { quoi: 'Serie Lumen S03E01' }, { quoi: 'Serie Lumen 1071' }]) {
        const r = await o.run(i);
        assert.doesNotMatch(r.text, /\[▶ Vénus/, JSON.stringify(i));
        assert.equal(r.data?.cible, undefined, JSON.stringify(i));
      }
    } finally { rmSync(o.home, { recursive: true, force: true }); }
  });
});

test('la ligne n\'est écrite que pour un identifiant de la forme attendue (jamais une adresse)', () => {
  assert.equal(ligneLireVenus('serie:serie-lumen:s2e5'), '[▶ Vénus : serie:serie-lumen:s2e5]');
  assert.equal(ligneLireVenus('album:album-brise:p1:un'), '[▶ Vénus : album:album-brise:p1:un]');
  for (const x of ['http://exemple.invalid/x', '/venus/flux/film%3Ax', 'film:x"><img src=x>', 'film:../../etc', 'film:', 'film', '', 'film:a:b:c:d']) assert.equal(ligneLireVenus(x), '', x);
});

// ---------------- La discussion (ui.html) ----------------
type Noeud = { tag: string; attrs: Record<string, unknown>; kids: unknown[] };
function discussion() {
  const ui = readFileSync(new URL('../src/web/ui.html', import.meta.url), 'utf8');
  const debut = ui.indexOf('const LireVenus = ('), fin = ui.indexOf('// (fin lire-venus)');
  assert.ok(debut > 0 && fin > debut, 'le bloc « lire-venus » est dans ui.html');
  const win: Record<string, unknown> = {}, vus: string[] = [];
  const ctx = vm.createContext({ window: win, show: (v: string) => vus.push(`show:${v}`), setTimeout: (f: () => void) => f() });
  win.OdinApps = { app: (m: string) => vus.push(`app:${m}`) };
  vm.runInContext(`${ui.slice(debut, fin)}\nthis.LireVenus = LireVenus; this.ouvrirLecture = ouvrirLecture;`, ctx);
  const L = (ctx as unknown as { LireVenus: { extraire(t: string): { texte: string; cible: string | null }; titreDe(d: unknown, c: string): string | null; bouton(c: string, d: unknown): Promise<Noeud | null> } }).LireVenus;
  const el = (tag: string, attrs: Record<string, unknown> = {}, ...kids: unknown[]): Noeud => ({ tag, attrs, kids });
  return { L, win, vus, el, ouvrirLecture: (ctx as unknown as { ouvrirLecture(c: string): void }).ouvrirLecture, ui };
}
const reponse = (cible: string) => `Vénus · Regarder\n« Serie Lumen » S02E05 est dans ta bibliothèque de Vénus : ouvre Vénus → Odéon → « Serie Lumen » et clique « ► Lire » sur S02E05, il se lit dans le navigateur.\n\n[▶ Vénus : ${cible}]`;
const DETAIL = { oeuvre: { id: 'serie:serie-lumen', type: 'serie', titre: 'Serie Lumen' }, episodes: [{ id: 'serie:serie-lumen:s2e5', saison: 2, episode: 5, duree: 60, reprise_s: 35 }] };
const repondre = (statut: number, corps: unknown) => async () => ({ ok: statut >= 200 && statut < 300, status: statut, json: async () => corps });

test('discussion : la réponse d\'une demande réussie porte un bouton « Lire » avec le bon identifiant ; le clic ouvre Vénus sur CE fichier', async () => {
  const d = discussion();
  const x = d.L.extraire(reponse('serie:serie-lumen:s2e5'));
  assert.equal(x.cible, 'serie:serie-lumen:s2e5');
  assert.doesNotMatch(x.texte, /\[▶/, 'la ligne technique n\'est pas affichée');
  assert.match(x.texte, /il se lit dans le navigateur\.$/);
  const demandes: string[] = [], ouverts: string[] = [];
  const b = await d.L.bouton(x.cible!, { fetch: async (u: string) => { demandes.push(u); return repondre(200, DETAIL)(); }, el: d.el, ouvrir: (c: string) => ouverts.push(c) });
  assert.ok(b, 'un bouton');
  assert.equal(demandes[0], '/venus/oeuvre/serie%3Aserie-lumen', 'le titre est vérifié dans SA bibliothèque');
  assert.equal(b!.tag, 'button');
  assert.equal(b!.attrs['data-cible'], 'serie:serie-lumen:s2e5');
  assert.deepEqual(b!.kids, ['► Lire « Serie Lumen · S02E05 »'], 'le titre exact : la série et son épisode');
  assert.match(String(b!.attrs.class), /lire-venus/);
  (b!.attrs.onclick as () => void)();
  assert.deepEqual(ouverts, ['serie:serie-lumen:s2e5']);
  // ouvrirLecture : l'intention de lire CETTE cible, puis la page de Vénus
  d.ouvrirLecture('serie:serie-lumen:s2e5');
  assert.deepEqual(JSON.parse(JSON.stringify(d.win.OdinOpenWant)), { module: 'freyja', lire: 'serie:serie-lumen:s2e5' });
  assert.deepEqual(d.vus, ['show:apps', 'app:freyja']);
  // la page de Vénus comprend cette intention (pages/venus.js) : le lecteur reçoit CET épisode, à la reprise
  const w: Record<string, unknown> = { OdinPages: {} };
  const c = vm.createContext({ window: w, URLSearchParams });
  for (const f of ['venus-lecteur.js', 'venus.js']) vm.runInContext(readFileSync(new URL(`../src/web/pages/${f}`, import.meta.url), 'utf8'), c, { filename: f });
  const P = (w.OdinVenus as { logique: Record<string, (...a: unknown[]) => unknown> }).logique;
  const v = P.cibleVoulue(d.win.OdinOpenWant) as { cible: string; oeuvre: string };
  assert.deepEqual(JSON.parse(JSON.stringify(v)), { cible: 'serie:serie-lumen:s2e5', oeuvre: 'serie:serie-lumen' });
  assert.equal((P.elementLecteur(DETAIL, v.cible) as { reprise_s: number }).reprise_s, 35);
  // film, piste : le titre exact
  assert.equal(d.L.titreDe({ oeuvre: { id: 'film:film-orage-2003', titre: 'Film Orage' } }, 'film:film-orage-2003'), 'Film Orage');
  assert.equal(d.L.titreDe({ oeuvre: { id: 'album:album-brise', titre: 'Album Brise' }, pistes: [{ id: 'album:album-brise:p1:un', num: 1, titre: 'Un' }] }, 'album:album-brise:p1:un'), 'Album Brise · 1. Un');
});

test('discussion : une réponse sans ligne « Lire » n\'a pas de bouton ; plusieurs identifiants différents non plus', () => {
  const d = discussion();
  for (const t of ['« Titre Absent » n\'est pas dans ta bibliothèque de Vénus. Ajoute-le par Vénus → Odéon.', 'Quel titre veux-tu regarder en S02E05 ?', '']) assert.equal(d.L.extraire(t).cible, null, t);
  assert.equal(d.L.extraire(`${reponse('film:film-a')}\n[▶ Vénus : film:film-b]`).cible, null, 'deux titres : aucun bouton (prudence)');
  assert.equal(d.L.extraire(`${reponse('film:film-a')}\n[▶ Vénus : film:film-a]`).cible, 'film:film-a', 'la même deux fois : un bouton');
});

test('discussion : un lien ou un titre piégé dans la réponse reste du texte, jamais un bouton', async () => {
  const d = discussion();
  for (const piege of ['http://exemple.invalid/piege', '/venus/flux/film%3Ax', 'javascript:alert(1)', 'film:x"><img src=x onerror=alert(1)>', 'film:X', 'film:../..', 'film:a b']) {
    const x = d.L.extraire(reponse(piege));
    assert.equal(x.cible, null, piege);
    assert.ok(x.texte.includes(`[▶ Vénus : ${piege}]`), `${piege} : laissé tel quel, en texte`);
  }
  // un titre de la bibliothèque qui contient du HTML : le bouton le porte en texte simple (un enfant texte, pas du HTML)
  const piegeTitre = '<img src=x onerror="window.__piege=1">';
  const b = await d.L.bouton('film:film-piege', { fetch: repondre(200, { oeuvre: { id: 'film:film-piege', titre: piegeTitre } }), el: d.el, ouvrir: () => {} });
  assert.deepEqual(b!.kids, [`► Lire « ${piegeTitre} »`]);
  assert.equal(typeof b!.kids[0], 'string');
  // dans ui.html, el() met un enfant chaîne en nœud texte (createTextNode), jamais en innerHTML
  assert.match(d.ui, /n\.append\(k instanceof Node \? k : document\.createTextNode\(String\(k\)\)\)/);
});

test('discussion : un identifiant inventé, absent de la bibliothèque, ou refusé (membre, invité) n\'ouvre rien : pas de bouton', async () => {
  const d = discussion();
  let ouvert = 0; const deps = (f: () => Promise<unknown>) => ({ fetch: f, el: d.el, ouvrir: () => { ouvert++; } });
  assert.equal(await d.L.bouton('film:titre-invente', deps(repondre(404, { error: 'œuvre introuvable' }))), null, 'inventé : la bibliothèque ne le connaît pas');
  assert.equal(await d.L.bouton('serie:serie-lumen:s9e9', deps(repondre(200, DETAIL))), null, 'l\'œuvre existe mais pas cet épisode');
  assert.equal(await d.L.bouton('serie:serie-lumen:s2e5', deps(repondre(401, { error: 'Connecte-toi à Odin.' }))), null, 'membre ou invité : Vénus lui est refusé');
  assert.equal(await d.L.bouton('serie:serie-lumen:s2e5', deps(async () => { throw new Error('hors ligne'); })), null);
  assert.equal(ouvert, 0);
});

test('ui.html : la réponse est dessinée sans la ligne, le bouton est placé dans la bulle, la ligne n\'est pas dite à voix haute', () => {
  const { ui } = discussion();
  // le script de la page se lit encore (une virgule ou un commentaire de trop casserait toute l'interface)
  for (const m of ui.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)) assert.doesNotThrow(() => new Function(m[1]));
  assert.match(ui, /if \(role === 'assistant'\) \(\{ texte: text, cible: cibleVenus \} = LireVenus\.extraire\(text\)\);/);
  assert.match(ui, /LireVenus\.bouton\(cibleVenus, \{ fetch: \(u, o\) => fetch\(u, o\), el, ouvrir: ouvrirLecture \}\)/);
  assert.match(ui, /sayAloud\(LireVenus\.extraire\(d\.text\)\.texte/);
  // ni dans la notification du navigateur, ni dans la réponse transmise au guide (évènement « odin:reply ») : la ligne brute n'apparaît nulle part
  assert.match(ui, /notifyOwner\('Odin', LireVenus\.extraire\(d\.text\)\.texte\.replace\(/);
  assert.match(ui, /new CustomEvent\('odin:reply', \{ detail: \{ text: LireVenus\.extraire\(d\.text\)\.texte \} \}\)/);
  assert.doesNotMatch(ui, /notifyOwner\('Odin', d\.text/);
  // le bouton n'utilise pas api() (un refus 401 y recharge toute la page)
  assert.doesNotMatch(ui.slice(ui.indexOf('const LireVenus = ('), ui.indexOf('// (fin lire-venus)')), /\bapi\(/);
  // 44 px au doigt, un long titre passe à la ligne
  assert.match(ui, /\.msg \.lire-venus\{min-height:44px;[^}]*white-space:normal;[^}]*overflow-wrap:anywhere/);
});

// ---------------- Sans modèle de langue : la demande écrite jusqu'à la réponse ----------------
test('sans modèle de langue : « lance Serie Lumen S02E05 » arrive à « regarder » et la réponse porte la ligne « Lire »', async () => {
  await sansCle(async () => {
    oublierMagasins();
    const home = mkdtempSync(join(tmpdir(), 'venus-lire-direct-'));
    const v = new Valhalla(home, allModules({ paths: { home, workspace: home }, cfg: { venus: {}, voice: {} } } as never), {
      run: async () => ({ code: 0, out: '', err: '' }), fetch: (async () => { throw new Error('réseau coupé'); }) as unknown as typeof fetch,
      notify: async () => {}, autonomy: () => 'equilibre', now: () => new Date(),
    });
    setValhalla(v);
    try {
      const c = v.ctx('freyja') as unknown as { home: string; dir: string };
      remplir(magasinVenus(c.home, c.dir), home);
      const store = new Map<string, string>(), appels: string[] = [];
      const d: DirectDeps = {
        sessionId: 'web:essai', has: (t) => t === 'valhalla', kv: { getKv: (k) => store.get(k), setKv: (k, val) => { store.set(k, val); } },
        run: async (name, input) => { appels.push(`${name}:${String(input.appli)}.${String(input.quoi)}`); const r = await valhallaTool.run(input, { sessionId: 'web:essai' } as never); return { ok: true, content: typeof r === 'string' ? r : (r as { output: string }).output }; },
      };
      const r = await tryDirect('lance Serie Lumen S02E05', d); forgetPending(d.sessionId);
      assert.equal(r.done, true, r.why);
      assert.deepEqual(appels, ['valhalla:freyja.regarder']);
      assert.equal(LIGNE.exec((r as { text: string }).text)?.[1], 'serie:serie-lumen:s2e5');
    } finally { setValhalla(undefined); v.stop(); rmSync(home, { recursive: true, force: true }); }
  });
});
