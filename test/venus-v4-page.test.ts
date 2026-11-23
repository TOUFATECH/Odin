// Vénus, lots V4-V6 : les écrans de l'interface (app.js), rendus sans navigateur ; chaque clic est vérifié par le corps
// EXACT envoyé à Odin (/api/valhalla/act). Les réponses d'Odin sont simulées ici (aucun réseau, aucun Odin lancé) :
//   ⬇ sur « À venir » → hnoss_obtenir avec confirm: true ; ♡ → hnoss_envie ; « Nouveau » : la file relue toutes les 2 s
//   tant qu'un téléchargement avance, puis plus ; pause, annuler ; fichier mis à part : accepter (confirm) ou jeter ;
//   Réglages → Demandes : la clé jamais remise dans la page, « Demandes au nom de chacun » ; catalogue non réglé : le dire.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const APP = new URL('../src/valhalla/venus/app/', import.meta.url);
const SRC = { planetes: readFileSync(new URL('planetes.js', APP), 'utf8'), app: readFileSync(new URL('app.js', APP), 'utf8') };
type Fn = (...a: unknown[]) => unknown;
type Corps = { module?: string; action: string; input: Record<string, unknown>; confirm?: boolean };
const attendre = (ms = 60) => new Promise((r) => setTimeout(r, ms));
const jour = (d: number) => { const x = new Date(Date.now() + d * 864e5); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };

/** La page dans un faux navigateur ; `repondre` joue Odin pour chaque action. */
async function ouvrir(repondre: (c: Corps) => unknown, champs: Record<string, { value?: string; checked?: boolean; type?: string }> = {}) {
  const envoyes: Corps[] = [];
  const ecouteurs: Record<string, Fn[]> = {};
  const on = (k: string, f: Fn) => { (ecouteurs[k] ??= []).push(f); };
  const app = { innerHTML: '', removeAttribute() {} };
  const elFaux = (): Record<string, unknown> => ({ className: '', style: {}, dataset: {}, classList: { add() {}, toggle() {}, remove() {} }, setAttribute() {}, addEventListener() {}, remove() {}, append() {}, querySelector: () => null, querySelectorAll: () => [], focus() {}, set innerHTML(h: string) { feuille.html = h; } });
  const feuille = { html: '' };
  const root = { lang: 'fr', dataset: {} as Record<string, string>, style: { setProperty() {} }, classList: { toggle() {}, add() {} } };
  const location = { hash: '#/', href: 'http://127.0.0.1/venus/app/' };
  const doc: Record<string, unknown> = {
    documentElement: root, body: elFaux(), title: '', styleSheets: [], cookie: '',
    getElementById: (id: string) => (id === 'app' ? app : null),
    querySelector: (s: string) => (s === '#app' ? app : champs[s] ?? null), querySelectorAll: () => [],
    createElement: elFaux, addEventListener: on, contains: () => false, activeElement: null,
  };
  const rep = (v: unknown) => new Response(JSON.stringify(v), { status: 200, headers: { 'content-type': 'application/json' } });
  const win: Record<string, unknown> = {
    navigator: { language: 'fr-FR' }, addEventListener: on, location, scrollY: 0, innerWidth: 1280, innerHeight: 900,
    history: { replaceState: (_a: unknown, _b: unknown, h: string) => { location.hash = h; } },
    scrollTo() {}, requestAnimationFrame: (f: Fn) => setTimeout(f, 0),
    matchMedia: (q: string) => ({ matches: /reduced-motion/.test(q), addEventListener() {} }),
    fetch: async (chemin: string, o: { body?: string } = {}) => {
      if (chemin === '/venus/api/profils') return rep({ profils: [{ id: 'moi', name: 'Awa', isAdmin: true, avatar: 0 }], actuel: 'moi', choisi: true });
      if (chemin === '/venus/api/preferences') return rep({ preferences: {} });
      if (chemin === '/venus/api/catalogue') return rep({ titres: [] });
      if (chemin === '/venus/dossiers') return rep({ dossiers: [{ chemin: 'D:\\Films', categorie: 'films' }] });
      if (chemin === '/api/valhalla/act') { const c = JSON.parse(o.body ?? '{}') as Corps; envoyes.push(c); return rep(repondre(c) ?? { ok: true, text: 'ok', data: {} }); }
      return rep({});
    },
  };
  const ctx = vm.createContext({ ...win, window: win, document: doc, URLSearchParams, Intl, setTimeout, clearTimeout, MutationObserver: class { observe() {} disconnect() {} } });
  vm.runInContext(SRC.planetes, ctx); vm.runInContext(SRC.app, ctx);
  for (let k = 0; k < 100; k++) { await attendre(20); if (app.innerHTML && !/aria-busy="true"/.test(app.innerHTML)) break; }
  return {
    app, envoyes, feuille,
    async aller(h: string) { location.hash = h; for (const f of ecouteurs.hashchange ?? []) f(); await attendre(120); },
    async cliquer(data: Record<string, string>) { const el = { dataset: data, closest: (s: string) => (s === '[data-act]' ? el : null), getBoundingClientRect: () => ({ left: 0, top: 0, width: 10, height: 10, right: 10, bottom: 10 }), classList: { toggle() {} }, setAttribute() {}, parentElement: { querySelector: () => null } }; for (const f of ecouteurs.click ?? []) await f({ target: el, preventDefault() {}, stopPropagation() {} }); await attendre(120); },
    async changer(data: Record<string, string>, value: string) { const el = { dataset: data, value, closest: (s: string) => (s === `[data-act="${data.act}"]` ? el : null) }; for (const f of ecouteurs.change ?? []) await f({ target: el }); await attendre(80); },
    /** L'indice `data-i` du premier bouton d'une action dans la page. */
    indice(act: string, html = app.innerHTML) { const m = new RegExp(`data-act="${act}" data-i="(\\d+)"`).exec(html); assert.ok(m, `bouton ${act} absent`); return m[1]; },
  };
}

const SORTIE = { key: 'serie:77', kind: 'show', title: 'Station <b>Polaire</b>', date: jour(1), season: 2, episode: 8, epTitle: 'Le signal', pop: 95 };
const avenir = (source: boolean) => ({ ok: true, text: '', data: source ? { regle: true, source: true, kind: 'show', texte: '1 épisode(s)', entries: [SORTIE, { ...SORTIE, key: 'serie:5', title: 'Déjà Là', nas: 'serie:deja-la' }], suggestions: [SORTIE], erreurs: [] } : { regle: false, source: false, kind: 'show', texte: 'Aucun programme des séries n\'est réglé : « À venir » ne lit rien sur Internet tant que tu ne l\'as pas activé (Réglages → Demandes).', entries: [], suggestions: [], erreurs: [] } });

test('« À venir » : ⬇ envoie hnoss_obtenir avec confirm: true, ♡ envoie hnoss_envie ; les titres restent du texte', async () => {
  const P = await ouvrir((c) => (c.action === 'a_venir' ? avenir(true) : c.action === 'hnoss_obtenir' ? { ok: true, text: '✓', data: { demande: { etat: 'en téléchargement' } } } : c.action === 'hnoss_envie' ? { ok: true, text: '✓', data: { demande: { etat: 'en téléchargement' } } } : undefined));
  await P.aller('#/series?vue=avenir'); await attendre(150);
  const h = P.app.innerHTML;
  assert.ok(P.envoyes.some((c) => c.action === 'a_venir' && c.input.genre === 'série'));
  assert.match(h, /class="up-card out"/); assert.match(h, /Favori = téléchargé automatiquement par Pléiades/);
  assert.match(h, /Station &lt;b&gt;Polaire&lt;\/b&gt;/, 'un titre venu du catalogue est écrit comme du texte'); assert.doesNotMatch(h, /<b>Polaire/);
  assert.match(h, /Disponible/); assert.match(h, /Séries à découvrir/);
  assert.doesNotMatch(h, /<img/, 'aucune image extérieure');
  await P.cliquer({ act: 'grab', i: P.indice('grab') });
  const g = P.envoyes.find((c) => c.action === 'hnoss_obtenir')!;
  assert.equal(g.confirm, true, 'le clic est la confirmation'); assert.equal(g.module, 'freyja');
  assert.deepEqual({ ...g.input }, { titre: 'Station <b>Polaire</b>', genre: 'série', saisons: '2', episode: '8' });
  assert.match(P.app.innerHTML, /up-act dl f done/, 'après le clic : « déjà suivi »');
  await P.cliquer({ act: 'fav', i: P.indice('fav') });
  const f = P.envoyes.find((c) => c.action === 'hnoss_envie')!;
  assert.equal(f.confirm, true); assert.equal(f.input.cle, 'serie:77'); assert.equal(f.input.retirer, undefined);
  assert.match(P.app.innerHTML, /up-act fav f on/, 'le ♡ s\'allume');
  await P.cliquer({ act: 'fav', i: P.indice('fav') });
  const off = P.envoyes.filter((c) => c.action === 'hnoss_envie')[1];
  assert.equal(off.input.retirer, true); assert.equal(off.confirm, undefined, 'retirer ne télécharge rien');
});

test('catalogue non réglé : « À venir » le dit et mène aux réglages ; Nouveautés aussi', async () => {
  const P = await ouvrir((c) => (c.action === 'a_venir' ? avenir(false) : c.action === 'sorties_nouveautes' ? { ok: true, data: { regle: false, source: false, sections: [], texte: 'Les nouveautés des films et des séries viennent du grand catalogue : ajoute sa clé (gratuite) dans Réglages → Demandes. Les animés marchent sans clé.' } } : undefined));
  await P.aller('#/series?vue=avenir'); await attendre(150);
  assert.match(P.app.innerHTML, /ne lit rien sur Internet/); assert.match(P.app.innerHTML, /data-act="godemandes"/);
  await P.aller('#/nouveautes'); await attendre(150);
  assert.match(P.app.innerHTML, /Nouveautés indisponibles/); assert.match(P.app.innerHTML, /grand catalogue/);
  assert.doesNotMatch(P.app.innerHTML, /TMDB|Seerr|Radarr|Sonarr|qBittorrent|TVmaze|AniList|Cinemeta/i, 'aucun nom de produit tiers à l\'écran');
});

test('« Nouveau » : la file relue toutes les 2 s tant qu\'un téléchargement avance ; pause, annuler, accepter, jeter', { timeout: 30_000 }, async () => {
  let etat = 'en_cours';
  const file = () => ({ ok: true, data: { telechargements: [
    { id: 't1', titre: 'Station Polaire', cible: { genre: 'episode', titre: 'Station Polaire', saison: 2, episode: 8 }, etat, fait: 640, total: 1000, vitesse: 10 },
    { id: 't2', titre: 'Doute', cible: { genre: 'film', titre: 'Doute' }, etat: 'a_part', fait: 10, total: 10, vitesse: 0, texte: 'l\'antivirus a un doute' },
  ] } });
  const P = await ouvrir((c) => (c.action === 'comete_file' ? file() : c.action === 'hnoss_demandes' ? { ok: true, data: { demandes: [] } } : undefined));
  await P.aller('#/nouveau'); await attendre(200);
  const h = P.app.innerHTML;
  assert.match(h, /En téléchargement/); assert.match(h, /S2:É8/); assert.match(h, /width:64%/); assert.match(h, /reste 00:36/);
  assert.match(h, /data-act="qpause" data-v="t1"/); assert.match(h, /data-act="qaccept" data-v="t2"/); assert.match(h, /data-act="qdrop" data-v="t2"/);
  const n0 = P.envoyes.filter((c) => c.action === 'comete_file').length;
  await attendre(2300);
  assert.ok(P.envoyes.filter((c) => c.action === 'comete_file').length > n0, 'relue au bout de 2 s');
  await P.cliquer({ act: 'qpause', v: 't1' }); assert.deepEqual({ ...P.envoyes.find((c) => c.action === 'comete_pause')!.input }, { id: 't1' });
  await P.cliquer({ act: 'qcancel', v: 't1' }); assert.ok(P.envoyes.some((c) => c.action === 'comete_annuler' && c.input.id === 't1'));
  await P.cliquer({ act: 'qaccept', v: 't2' }); const acc = P.envoyes.find((c) => c.action === 'comete_accepter')!; assert.equal(acc.confirm, true, 'accepter malgré le doute : le clic confirme');
  await P.cliquer({ act: 'qdrop', v: 't2' }); const je = P.envoyes.find((c) => c.action === 'comete_jeter')!; assert.equal(je.input.id, 't2'); assert.equal(je.confirm, undefined);
  // Plus rien ne bouge : la relecture s'arrête.
  etat = 'termine'; await attendre(2300);
  const n1 = P.envoyes.filter((c) => c.action === 'comete_file').length; await attendre(2400);
  assert.equal(P.envoyes.filter((c) => c.action === 'comete_file').length, n1, 'plus relue quand rien n\'avance');
  assert.match(P.app.innerHTML, /Importé/); assert.match(P.app.innerHTML, /data-act="qremove" data-v="t1"/);
  await P.aller('#/'); // le minuteur est coupé en quittant
});

test('« Nouveau » : chercher puis « Ajouter » lance la chaîne (confirm: true)', async () => {
  const P = await ouvrir((c) => (c.action === 'comete_file' ? { ok: true, data: { telechargements: [] } } : c.action === 'hnoss_demandes' ? { ok: true, data: { demandes: [] } } : c.action === 'hnoss_obtenir' ? { ok: true, text: 'ok', data: { demande: { etat: 'en téléchargement' } } } : undefined));
  await P.aller('#/nouveau?q=Les%20Voiles%20(2026)'); await attendre(600); // (relecture) la recherche part 350 ms après la dernière lettre, comme Request.js
  assert.match(P.app.innerHTML, /data-act="reqadd"/);
  await P.cliquer({ act: 'reqadd' });
  const o = P.envoyes.find((c) => c.action === 'hnoss_obtenir')!;
  assert.equal(o.confirm, true); assert.deepEqual({ ...o.input }, { titre: 'Les Voiles', genre: 'film', annee: '2026' });
  assert.match(P.app.innerHTML, /Ajouté/);
});

test('Réglages → Demandes : la clé n\'est jamais remise dans la page ; sources, catalogue, « Demandes au nom de chacun », à valider', async () => {
  const CLE = 'cle-tres-secrete-0123456789';
  const champs = { '#s-nom': { value: 'Mon indexeur' }, '#s-type': { value: 'torznab' }, '#s-adr': { value: 'https://indexeur.exemple.test/api' }, '#s-cle': { value: CLE, type: 'password' }, '#cat-series': { type: 'checkbox', checked: true }, '#cat-animes': { type: 'checkbox', checked: false }, '#cat-films': { value: 'cle' }, '#cat-cle': { value: CLE, type: 'password' } };
  const P = await ouvrir((c) => {
    if (c.action === 'acquisition') return { ok: true, data: { sirius: { qualite: '1080p', dossier: '', langue: 'vf' }, pleiades: { qualite: '1080p', dossier: '', langue: 'vf' }, comete: { tailleMaxGo: 60, simultanes: 2, debitMo: 0 } } };
    if (c.action === 'delta_sources') return { ok: true, data: { sources: [{ id: 'mon-indexeur', nom: 'Mon indexeur', type: 'torznab', actif: true, priorite: 25, aCle: true, recherches: 0, trouves: 0 }] } };
    if (c.action === 'catalogue_etat') return { ok: true, data: { reglages: { series: false, animes: false, films: 'aucun', aCle: true } } };
    if (c.action === 'hnoss_reglages') return { ok: true, data: { libres: [], membres: [{ login: 'lina', nom: 'Lina' }, { login: 'omar', nom: 'Omar' }] } };
    if (c.action === 'hnoss_demandes') return { ok: true, data: { demandes: [{ id: 'h-1', titre: 'Doute', genre: 'film', etat: 'à valider', qui: { login: 'omar', nom: 'Omar' } }] } };
    if (c.action === 'hnoss_regler_libres') return { ok: true, text: 'Demandes libres : Lina.', data: { libres: String(c.input.libres).split(',').filter(Boolean) } };
    return { ok: true, text: 'ok', data: {} };
  }, champs);
  await P.aller('#/reglages?tab=demandes'); await attendre(200);
  const h = P.app.innerHTML;
  for (const x of ['Sirius et Pléiades', 'Comète : téléchargements', 'Sources de téléchargement (Delta)', 'Sorties à venir et nouveautés', 'Demandes au nom de chacun', 'À valider']) assert.ok(h.includes(x), x);
  assert.match(h, /id="s-cle" type="password" autocomplete="new-password" value=""/); assert.match(h, /id="cat-cle" type="password" autocomplete="new-password" value=""/);
  assert.match(h, /clé gardée/); assert.match(h, /Une clé est gardée \(chiffrée\)/);
  await P.cliquer({ act: 'srcadd' });
  const a = P.envoyes.find((c) => c.action === 'delta_ajouter')!;
  assert.deepEqual({ ...a.input }, { nom: 'Mon indexeur', type: 'torznab', adresse: 'https://indexeur.exemple.test/api', cle: CLE });
  assert.equal(champs['#s-cle'].value, '', 'la clé ne reste pas dans le champ');
  await P.cliquer({ act: 'catsave' });
  const k = P.envoyes.find((c) => c.action === 'catalogue_regler')!; assert.deepEqual({ ...k.input }, { series: true, animes: false, films: 'cle', cle: CLE });
  await attendre(150);
  assert.ok(!P.app.innerHTML.includes(CLE), 'la clé n\'est jamais remise dans la page');
  await P.cliquer({ act: 'srctest', v: 'mon-indexeur' }); assert.ok(P.envoyes.some((c) => c.action === 'delta_tester' && c.input.id === 'mon-indexeur'));
  await P.cliquer({ act: 'srcdel', v: 'mon-indexeur' }); assert.ok(P.envoyes.some((c) => c.action === 'delta_retirer'));
  await attendre(150);
  assert.match(P.app.innerHTML, /data-act="hlibre" data-v="lina"/);
  await P.changer({ act: 'hlibre', v: 'lina' }, 'libre');
  assert.equal(P.envoyes.find((c) => c.action === 'hnoss_regler_libres')!.input.libres, 'lina');
  await P.cliquer({ act: 'hvalider', v: 'h-1' }); const val = P.envoyes.find((c) => c.action === 'hnoss_valider')!; assert.equal(val.confirm, true); assert.equal(val.input.demande, 'h-1');
  await P.cliquer({ act: 'hrefuser', v: 'h-1' }); assert.ok(P.envoyes.some((c) => c.action === 'hnoss_refuser' && c.confirm === undefined));
});

test('Mes envies : la liste de Hnoss, et ✕ retire l\'envie', async () => {
  const P = await ouvrir((c) => (c.action === 'hnoss_envies' ? { ok: true, data: { envies: [{ id: 'h-9', titre: 'Les Voiles', genre: 'film', annee: 2026, etat: 'en téléchargement', envie: true, cle: 'film:900' }] } } : undefined));
  await P.aller('#/liste?vue=envies'); await attendre(150);
  assert.match(P.app.innerHTML, /class="wish"/); assert.match(P.app.innerHTML, /Téléchargement en cours/); assert.match(P.app.innerHTML, /1 envie/);
  await P.cliquer({ act: 'wishrm', v: 'film:900', t: 'Les Voiles' });
  const r = P.envoyes.find((c) => c.action === 'hnoss_envie')!; assert.equal(r.input.retirer, true); assert.equal(r.input.cle, 'film:900');
});

// ---------------------------------------------------------------- relecture des lots V4-V6
test('(relecture) revenir sur « Nouveau » relit la file et relance sa relecture toutes les 2 s', { timeout: 20_000 }, async () => {
  const P = await ouvrir((c) => (c.action === 'comete_file' ? { ok: true, data: { telechargements: [{ id: 't1', titre: 'Station Polaire', cible: { genre: 'film', titre: 'Station Polaire' }, etat: 'en_cours', fait: 1, total: 10, vitesse: 1 }] } } : c.action === 'hnoss_demandes' ? { ok: true, data: { demandes: [] } } : undefined));
  const n = () => P.envoyes.filter((c) => c.action === 'comete_file').length;
  await P.aller('#/nouveau'); await attendre(200); assert.equal(n(), 1);
  await P.aller('#/'); await attendre(2300); assert.equal(n(), 1, 'quitter la page coupe la relecture');
  await P.aller('#/nouveau'); await attendre(200); assert.equal(n(), 2, 'en revenant, la file est relue');
  await attendre(2300); assert.equal(n(), 3, 'et relue de nouveau 2 s plus tard (un seul minuteur)');
  await P.aller('#/');
});

test('(relecture) ♡ cliqué deux fois très vite : une seule envie envoyée', async () => {
  let fini: () => void = () => {}; const lent = new Promise<void>((ok) => { fini = ok; });
  const P = await ouvrir((c) => (c.action === 'a_venir' ? avenir(true) : c.action === 'hnoss_envie' ? lent.then(() => ({ ok: true, text: '✓', data: { demande: { etat: 'en attente' } } })) : undefined));
  await P.aller('#/series?vue=avenir'); await attendre(150);
  const i = P.indice('fav');
  const a = P.cliquer({ act: 'fav', i }), b = P.cliquer({ act: 'fav', i });
  await attendre(50); fini(); await Promise.all([a, b]);
  assert.equal(P.envoyes.filter((c) => c.action === 'hnoss_envie').length, 1);
});

test('(relecture) « À venir » : une série déjà dans Vénus dont l’épisode n’est pas là n’est pas « Disponible » (Upcoming.js)', async () => {
  const P = await ouvrir((c) => (c.action === 'a_venir' ? avenir(true) : undefined));
  await P.aller('#/series?vue=avenir'); await attendre(150);
  const carte = /<div class="up-card"><button[^>]*data-v="serie:deja-la"[^>]*>[\s\S]*?<\/button>/.exec(P.app.innerHTML)?.[0] ?? '';
  assert.ok(carte, 'la carte du titre déjà dans Vénus'); assert.match(carte, /up-badge out">Pas disponible/);
});

test('(réponse du propriétaire) « Nouveau » avec la clé : les résultats du grand catalogue (année, résumé, affiche dessinée), « Ajouter » envoie l’année', async () => {
  const P = await ouvrir((c) => (c.action === 'comete_file' ? { ok: true, data: { telechargements: [] } } : c.action === 'hnoss_demandes' ? { ok: true, data: { demandes: [] } }
    : c.action === 'sorties_chercher' ? { ok: true, data: { source: true, texte: '2 résultats', items: [{ key: 'film:31', kind: 'movie', title: 'Les Voiles', year: 2025, overview: 'Un <i>film</i>.' }, { key: 'film:32', kind: 'movie', title: 'Les Voiles', year: 1999 }] } }
      : c.action === 'hnoss_obtenir' ? { ok: true, text: 'ok', data: { demande: { etat: 'en téléchargement' } } } : undefined));
  await P.aller('#/nouveau?q=Les%20Voiles'); await attendre(600);
  const ch = P.envoyes.filter((c) => c.action === 'sorties_chercher'); assert.equal(ch.length, 1); assert.deepEqual({ ...ch[0].input }, { q: 'Les Voiles', genre: 'film' });
  const h = P.app.innerHTML;
  assert.match(h, /2 résultats/); assert.match(h, /2025/); assert.match(h, /1999/); assert.match(h, /Un &lt;i&gt;film&lt;\/i&gt;\./);
  assert.doesNotMatch(h, /<img/, 'l’affiche est dessinée, aucune image extérieure');
  await P.cliquer({ act: 'reqadd', v: '1' });
  const o = P.envoyes.find((c) => c.action === 'hnoss_obtenir')!;
  assert.equal(o.confirm, true); assert.deepEqual({ ...o.input }, { titre: 'Les Voiles', genre: 'film', annee: '1999' });
});
