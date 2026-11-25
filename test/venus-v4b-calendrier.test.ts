// Vénus · Hnoss, « Ajouter à mon calendrier » branché et visible (suite du lot V4) ; Nouveautés, Mes envies et À venir
// remis d'aplomb au téléphone. Comme Upcoming.js du dépôt Venus (subscribe()) : le bouton de la barre d'« À venir »
// demande le lien personnel (ici en POST, jamais en GET : le lien est un secret), puis une fenêtre « S'abonner » (lien
// webcal pour le téléphone) et « Copier le lien ». « À venir » garde ses sorties, que le calendrier lit ensuite.
// Aucun réseau : le catalogue est simulé par une fonction (aucun serveur), les réponses d'Odin aussi (page sans navigateur).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import vm from 'node:vm';
import { actionsAcquisition } from '../src/valhalla/venus/actions.ts';
import { magasinVenus } from '../src/valhalla/venus/base.ts';
import { reglerCatalogue, viderCacheCatalogue } from '../src/valhalla/venus/catalogue/index.ts';
import { reglerOutilsComete } from '../src/valhalla/venus/comete/index.ts';
import { sortiesGardees } from '../src/valhalla/venus/hnoss/calendrier.ts';
import type { ModCtx } from '../src/valhalla/types.ts';

const APP = new URL('../src/valhalla/venus/app/', import.meta.url);
const SRC = { planetes: readFileSync(new URL('planetes.js', APP), 'utf8'), app: readFileSync(new URL('app.js', APP), 'utf8') };
const CSS = readFileSync(new URL('css/app.css', APP), 'utf8');
type Fn = (...a: unknown[]) => unknown;
type Corps = { module?: string; action: string; input: Record<string, unknown>; confirm?: boolean };
const attendre = (ms = 60) => new Promise((r) => setTimeout(r, ms));
const jour = (d: number) => { const x = new Date(Date.now() + d * 864e5); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };
const LIEN = 'http://192.0.2.10:8888/venus/calendrier/AbCdEfGhIjKlMnOpQrStUvWxYz012345.ics';

/** La page dans un faux navigateur ; `repondre` joue Odin pour chaque action, `calendrier` pour le lien du calendrier. */
async function ouvrir(repondre: (c: Corps) => unknown, o: { lang?: string; calendrier?: () => { status: number; corps: unknown } } = {}) {
  const envoyes: Corps[] = [], appels: Array<{ chemin: string; methode: string; corps?: unknown }> = [], copies: string[] = [], fenetres: string[] = [];
  const ecouteurs: Record<string, Fn[]> = {};
  const on = (k: string, f: Fn) => { (ecouteurs[k] ??= []).push(f); };
  const app = { innerHTML: '', removeAttribute() {} };
  const elFaux = (): Record<string, unknown> => ({ className: '', style: {}, dataset: {}, classList: { add() {}, toggle() {}, remove() {} }, setAttribute() {}, addEventListener() {}, remove() {}, append() {}, querySelector: () => ({ focus() {} }), querySelectorAll: () => [], focus() {}, set innerHTML(h: string) { fenetres.push(h); } });
  const root = { lang: o.lang ?? 'fr', dataset: {} as Record<string, string>, style: { setProperty() {} }, classList: { toggle() {}, add() {} } };
  const location = { hash: '#/', href: 'http://127.0.0.1/venus/app/' };
  const doc: Record<string, unknown> = {
    documentElement: root, body: elFaux(), title: '', styleSheets: [], cookie: '',
    getElementById: (id: string) => (id === 'app' ? app : null),
    querySelector: (s: string) => (s === '#app' ? app : null), querySelectorAll: () => [],
    createElement: elFaux, addEventListener: on, contains: () => false, activeElement: null,
  };
  const rep = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json' } });
  const win: Record<string, unknown> = {
    navigator: { language: o.lang ?? 'fr-FR', clipboard: { writeText: async (x: string) => { copies.push(x); } } }, addEventListener: on, location, scrollY: 0, innerWidth: 390, innerHeight: 800,
    history: { replaceState: (_a: unknown, _b: unknown, h: string) => { location.hash = h; } },
    scrollTo() {}, requestAnimationFrame: (f: Fn) => setTimeout(f, 0),
    matchMedia: (q: string) => ({ matches: /reduced-motion/.test(q), addEventListener() {} }),
    fetch: async (chemin: string, x: { method?: string; body?: string } = {}) => {
      appels.push({ chemin, methode: x.method ?? 'GET', ...(x.body !== undefined ? { corps: JSON.parse(x.body) } : {}) });
      if (chemin === '/venus/api/profils') return rep({ profils: [{ id: 'moi', name: 'Awa', isAdmin: true, avatar: 0 }], actuel: 'moi', choisi: true });
      if (chemin === '/venus/api/preferences') return rep({ preferences: {} });
      if (chemin === '/venus/api/catalogue') return rep({ titres: [] });
      if (chemin === '/venus/hnoss/calendrier') { const r = o.calendrier ? o.calendrier() : { status: 200, corps: { url: LIEN, webcal: LIEN.replace(/^http:/, 'webcal:') } }; return rep(r.corps, r.status); }
      if (chemin === '/api/valhalla/act') { const c = JSON.parse(x.body ?? '{}') as Corps; envoyes.push(c); return rep(repondre(c) ?? { ok: true, text: 'ok', data: {} }); }
      return rep({});
    },
  };
  const ctx = vm.createContext({ ...win, window: win, document: doc, URLSearchParams, Intl, setTimeout, clearTimeout, MutationObserver: class { observe() {} disconnect() {} } });
  vm.runInContext(SRC.planetes, ctx); vm.runInContext(SRC.app, ctx);
  for (let k = 0; k < 100; k++) { await attendre(20); if (app.innerHTML && !/aria-busy="true"/.test(app.innerHTML)) break; }
  return {
    app, envoyes, appels, copies, fenetres,
    async aller(h: string) { location.hash = h; for (const f of ecouteurs.hashchange ?? []) f(); await attendre(150); },
    async cliquer(data: Record<string, string>) { const el = { dataset: data, closest: (s: string) => (s === '[data-act]' ? el : null), getBoundingClientRect: () => ({ left: 0, top: 0, width: 10, height: 10, right: 10, bottom: 10 }), classList: { toggle() {} }, setAttribute() {}, parentElement: { querySelector: () => null } }; for (const f of ecouteurs.click ?? []) await f({ target: el, preventDefault() {}, stopPropagation() {} }); await attendre(120); },
  };
}

const SORTIE = { key: 'serie:77', kind: 'show', title: 'Station Polaire', date: jour(1), season: 2, episode: 8, epTitle: 'Le signal', pop: 95 };
const avenir = () => ({ ok: true, text: '', data: { regle: true, source: true, kind: 'show', texte: '1 épisode(s)', entries: [SORTIE], suggestions: [SORTIE], erreurs: [] } });
const calendrierDe = (P: { appels: Array<{ chemin: string; methode: string; corps?: unknown }> }) => P.appels.filter((a) => a.chemin === '/venus/hnoss/calendrier');
const derniereFenetre = (P: { fenetres: string[] }) => P.fenetres.filter((h) => /class="sheet/.test(h)).at(-1) ?? '';

test('« À venir » : le bouton « Ajouter à mon calendrier » est dans la barre, comme Upcoming.js (titre, icône, texte)', async () => {
  const P = await ouvrir((c) => (c.action === 'a_venir' ? avenir() : undefined));
  await P.aller('#/series?vue=avenir');
  const h = P.app.innerHTML;
  assert.match(h, /<button class="btn btn-small btn-ghost f" title="Les sorties de vos séries, films et favoris dans le calendrier de votre téléphone" data-act="ical">/);
  assert.match(h, /data-act="ical">[^]*?Ajouter à mon calendrier<\/button>/);
  assert.equal(calendrierDe(P).length, 0, 'rien n\'est demandé avant le clic : le lien ne se crée pas tout seul');
});

test('le clic demande le lien en POST (jamais en GET), puis la fenêtre : S’abonner (webcal), Copier le lien, le lien, Google Agenda', async () => {
  const P = await ouvrir((c) => (c.action === 'a_venir' ? avenir() : undefined));
  await P.aller('#/films?vue=avenir');
  await P.cliquer({ act: 'ical' });
  const c = calendrierDe(P);
  assert.equal(c.length, 1); assert.equal(c[0].methode, 'POST'); assert.deepEqual(c[0].corps, {}, 'le même lien remontré : jamais « nouveau » depuis ce bouton');
  const f = derniereFenetre(P);
  assert.match(f, /aria-label="Ajouter à mon calendrier"/); assert.match(f, /<h2>Ajouter à mon calendrier<\/h2>/);
  assert.match(f, /Les épisodes de vos séries, les sorties de films demandées et vos favoris apparaissent dans le calendrier de votre téléphone ou de votre ordinateur, mis à jour tout seuls\./);
  assert.match(f, new RegExp(`<a class="btn btn-play f" href="webcal://192\\.0\\.2\\.10:8888/venus/calendrier/AbCdEfGhIjKlMnOpQrStUvWxYz012345\\.ics">[^]*S’abonner \\(iPhone, Mac, Outlook\\)</a>`));
  assert.match(f, /data-act="calcopy"[^>]*>[^]*Copier le lien<\/button>/);
  assert.match(f, new RegExp(`<input class="input cal-link" readonly value="${LIEN.replace(/[.?]/g, '\\$&')}"`));
  assert.match(f, /Google Agenda : Paramètres → Ajouter un agenda → À partir de l’URL, puis collez le lien\. Ce lien est personnel : ne le partagez pas\./);
  const copie = /data-act="calcopy" data-v="([^"]*)"/.exec(f); assert.ok(copie, 'le bouton porte le lien à copier');
  await P.cliquer({ act: 'calcopy', v: copie[1] });
  assert.deepEqual(P.copies, [LIEN], '« Copier le lien » copie le lien http(s), comme le dépôt');
  // Un second clic : un second POST, et le lien que rend Odin (le même, tant qu'on n'en demande pas un neuf).
  await P.cliquer({ act: 'ical' });
  assert.equal(calendrierDe(P).length, 2); assert.ok(calendrierDe(P).every((x) => x.methode === 'POST'));
  assert.match(derniereFenetre(P), /AbCdEfGhIjKlMnOpQrStUvWxYz012345\.ics/);
});

test('un refus d\'Odin (clé d\'accès, tablette, session perdue) : aucune fenêtre, aucun lien montré', async () => {
  const P = await ouvrir((c) => (c.action === 'a_venir' ? avenir() : undefined), { calendrier: () => ({ status: 403, corps: { ok: false, code: 'session', error: 'Ce geste demande la session du propriétaire.' } }) });
  await P.aller('#/series?vue=avenir');
  const avant = P.fenetres.length;
  await P.cliquer({ act: 'ical' });
  assert.equal(calendrierDe(P).length, 1);
  assert.ok(!P.fenetres.slice(avant).some((h) => /class="sheet/.test(h)), 'pas de fenêtre');
  assert.ok(!P.fenetres.some((h) => /webcal:|\/venus\/calendrier\//.test(h)), 'aucun lien à l\'écran');
});

test('Nouveautés : une seule entrée du menu choisie (« Nouveau » n\'est plus marqué sur « Nouveautés »)', async () => {
  const P = await ouvrir(() => ({ ok: true, text: '', data: { regle: false, source: false, sections: [], texte: 'Le programme des animés n\'est pas activé (Réglages → Demandes).' } }));
  await P.aller('#/nouveautes');
  const h = P.app.innerHTML;
  assert.match(h, /href="#\/nouveautes" class="[^"]*active"[^>]*aria-current="page"/);
  assert.doesNotMatch(h, /href="#\/nouveau" class="[^"]*active/, '« Nouveau » n\'est pas choisi sur la page « Nouveautés »');
  await P.aller('#/nouveau');
  assert.match(P.app.innerHTML, /href="#\/nouveau" class="[^"]*active"/);
  assert.doesNotMatch(P.app.innerHTML, /href="#\/nouveautes" class="[^"]*active/);
});

test('Mes envies : l\'image d\'une envie est un carré de couleur plein avec son titre (plus une bande sur une case grise)', async () => {
  const P = await ouvrir((c) => (c.action === 'hnoss_envies' ? { ok: true, text: '', data: { envies: [{ id: 'e1', cle: 'film:9', titre: 'Les Voiles', genre: 'film', annee: 2026, etat: 'en attente' }] } } : undefined));
  await P.aller('#/liste?vue=envies'); await attendre(100);
  const h = P.app.innerHTML;
  assert.match(h, /<div class="wish-pic" aria-hidden="true"><div class="ph" style="--h:\d+"><span>Les Voiles<\/span><\/div><\/div>/);
  assert.doesNotMatch(h, /<div class="wish-pic"><span>/);
});

test('en anglais : les textes de V4 (À venir, Mes envies, Nouveautés, le calendrier) sont traduits', async () => {
  const P = await ouvrir((c) => (c.action === 'a_venir' ? avenir() : c.action === 'hnoss_envies' ? { ok: true, text: '', data: { envies: [{ id: 'e1', cle: 'film:9', titre: 'Les Voiles', genre: 'film', etat: 'en attente' }, { id: 'e2', titre: 'Tard', genre: 'film', etat: 'échec' }] } }
    : c.action === 'sorties_nouveautes' ? { ok: true, text: '', data: { regle: true, source: true, sections: [{ title: 'Bientôt au cinéma', items: [{ key: 'film:9', kind: 'movie', type: 'movie', title: 'Les Voiles', date: jour(20) }] }], texte: '' } } : undefined), { lang: 'en' });
  await P.aller('#/series?vue=avenir');
  let h = P.app.innerHTML;
  for (const fr of ['Séries à découvrir', 'pas encore disponibles', 'Favori = téléchargé', 'Ajouter à mon calendrier', 'Les sorties de vos séries', '1 épisode<']) assert.ok(!h.includes(fr), `reste en français : ${fr}`);
  assert.match(h, /TV shows to discover/); assert.match(h, /Add to my calendar/); assert.match(h, /1 episode</);
  await P.cliquer({ act: 'ical' });
  const f = derniereFenetre(P);
  for (const fr of ['S’abonner', 'Copier le lien', 'Ce lien est personnel', 'mis à jour tout seuls']) assert.ok(!f.includes(fr), `fenêtre en français : ${fr}`);
  assert.match(f, /Subscribe \(iPhone, Mac, Outlook\)/); assert.match(f, /Copy link/);
  await P.aller('#/liste?vue=envies'); await attendre(100);
  h = P.app.innerHTML;
  for (const fr of ['2 envies', 'Chaque envie est demandée', 'Demandé : téléchargé dès sa sortie', 'Pas trouvé', '>Film<']) assert.ok(!h.includes(fr), `reste en français : ${fr}`);
  assert.match(h, /2 wishes/); assert.match(h, /Requested: downloaded as soon as it is out/); assert.match(h, /Not found/);
  await P.aller('#/nouveautes'); await attendre(100);
  h = P.app.innerHTML;
  for (const fr of ['Hnoss actif', 'Bientôt au cinéma', '>Demander<', 'Ajouter à mes envies', 'Sortie le ']) assert.ok(!h.includes(fr), `reste en français : ${fr}`);
  assert.match(h, /Coming soon to cinemas/); assert.match(h, /Hnoss is on/);
});

test('feuille de style : la pastille Hnoss passe à la ligne, cibles de 44 px, contrastes en clair, focus du filtre visible', () => {
  const fin = CSS.slice(CSS.lastIndexOf('/* Odin : Nouveautés, Mes envies, À venir'));
  assert.ok(fin.length > 50, 'la section des retouches est à la fin de la feuille');
  assert.match(fin, /\.new-head \.auto-pill \{[^}]*white-space: normal;[^}]*max-width: 100%/);
  assert.match(fin, /\.up-filter \.seg-b, \.view-tabs \.vt, \.new-tabs \.chip \{ min-height: 44px; min-width: 44px; \}/);
  assert.match(fin, /\.wish \.btn-mini \{ width: 44px; min-height: 44px; \}/);
  assert.match(fin, /\.up-bar-right \.btn-small \{ min-height: 44px; \}/);
  // ♡ et ⬇ (36 px, 32 px au téléphone, bordure de 1 px) : zone de toucher de 44 px, voisins écartés pour ne pas se chevaucher.
  assert.match(fin, /\.up-act:not\(\.wide\)::after \{[^}]*inset: -5px/); assert.match(fin, /\.up-acts \{ gap: 8px; \}/);
  assert.match(fin, /@media \(max-width: 760px\) \{ \.up-act:not\(\.wide\)::after \{ inset: -7px; \} \.up-acts \{ gap: 12px; \} \}/);
  assert.match(fin, /\.cal-sheet \.btn-row \.btn \{ max-width: 100%; white-space: normal;/, 'le bouton « S’abonner » passe à la ligne au téléphone');
  assert.match(fin, /\.up-filter \.seg-b:focus-visible \{ outline-offset: -3px; \}/);
  assert.match(fin, /html\[data-tone="light"\] \.wish-state\.st-available/);
  assert.match(fin, /html\[data-tone="light"\] \.new-head \.auto-pill/);
});

// ---------------------------------------------------------------- « À venir » garde ses sorties (actions.ts)
const home = mkdtempSync(join(tmpdir(), 'venus-v4b-'));
after(() => { reglerOutilsComete(); rmSync(home, { recursive: true, force: true }); });
const ctx = { home, dir: join(home, 'freyja') } as unknown as ModCtx;
const mag = () => magasinVenus(home, ctx.dir);
const aVenirAct = actionsAcquisition.find((a) => a.id === 'a_venir')!;
let panne = false;
const catalogueSimule: typeof fetch = async (u) => {
  if (panne) throw new Error('hors ligne');
  const url = String(u);
  const corps = url.includes(`/schedule?country=US&date=${jour(1)}`) ? [{ airdate: jour(1), airstamp: `${jour(1)}T20:00:00Z`, season: 2, number: 8, name: 'Le signal', show: { id: 77, name: 'Station Polaire', type: 'Scripted', weight: 95, premiered: '2024-01-01' } }] : [];
  return new Response(JSON.stringify(corps), { status: 200, headers: { 'content-type': 'application/json' } });
};

test('a_venir garde ses sorties pour le calendrier ; catalogue non réglé ou en panne : rien d\'effacé', async () => {
  reglerOutilsComete({ reseauEssai: catalogueSimule });
  // Catalogue non réglé : rien n'est lu, rien n'est gardé.
  await aVenirAct.run(ctx, { genre: 'série' });
  assert.equal(sortiesGardees(mag(), 'show').length, 0);
  reglerCatalogue(mag(), { series: true }); viderCacheCatalogue();
  const r = await aVenirAct.run(ctx, { genre: 'série' });
  assert.equal((r.data as { source: boolean }).source, true);
  const g = sortiesGardees(mag(), 'show');
  assert.equal(g.length, 1); assert.equal(g[0].title, 'Station Polaire'); assert.equal(g[0].season, 2); assert.equal(g[0].episode, 8); assert.equal(g[0].date, jour(1));
  // Une panne du catalogue (aucune sortie, une erreur) n'efface pas le dernier relevé.
  panne = true; viderCacheCatalogue();
  const p = await aVenirAct.run(ctx, { genre: 'série' });
  assert.ok(((p.data as { erreurs: string[] }).erreurs ?? []).length > 0);
  assert.equal(sortiesGardees(mag(), 'show').length, 1, 'le relevé d\'avant reste');
  panne = false;
});

test('a_venir : le catalogue passé à « Aucun » vide le relevé gardé (le calendrier ne sert plus des sorties qui vieillissent)', async () => {
  reglerOutilsComete({ reseauEssai: catalogueSimule });
  reglerCatalogue(mag(), { series: true }); viderCacheCatalogue();
  await aVenirAct.run(ctx, { genre: 'série' });
  assert.equal(sortiesGardees(mag(), 'show').length, 1);
  reglerCatalogue(mag(), { series: false }); viderCacheCatalogue();
  const r = await aVenirAct.run(ctx, { genre: 'série' });
  assert.equal((r.data as { source: boolean }).source, false);
  assert.equal(sortiesGardees(mag(), 'show').length, 0, 'plus de source : plus de sorties gardées pour ce genre');
});
