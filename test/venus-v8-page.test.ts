// Vénus, la maison (lot V8), la page : « Ce soir » (trois questions, trois idées, « Qui regarde ce soir ? »), le vote en
// famille (fenêtre de l'écran principal et écran du téléphone), « Mes statistiques », la rétrospective, les
// collections et listes de lecture, « Ajouter à une liste » et « Télécharger » sur une fiche, comme Tonight.js,
// Vote.js, Stats.js, Recap.js, Collections.js et Downloads.js du dépôt Venus. Avant ce lot, ces adresses disaient
// « Cette partie de Venus arrive dans Odin avec un prochain lot. ». Page sans navigateur, réponses d'Odin simulées.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const APP = new URL('../src/valhalla/venus/app/', import.meta.url);
const SRC = { planetes: readFileSync(new URL('planetes.js', APP), 'utf8'), app: readFileSync(new URL('app.js', APP), 'utf8') };
type Fn = (...a: unknown[]) => unknown;
const attendre = (ms = 60) => new Promise((r) => setTimeout(r, ms));
const AN = new Date().getFullYear();
const BIENTOT = 'Cette partie de Venus arrive dans Odin avec un prochain lot.';

// Une petite bibliothèque (titres inventés) : trois films, une série.
const TITRES = [
  { id: 'film:a', type: 'movie', category: 'movie', title: 'Le Phare', year: 2020, runtime: 100, genres: ['Drame'], status: 'unseen', added: 1, played: 0, inList: false, play: { id: 'film:a', position: 0 } },
  { id: 'film:b', type: 'movie', category: 'movie', title: 'La Course', year: 2021, runtime: 90, genres: ['Comédie'], status: 'unseen', added: 2, played: 0, inList: false, play: { id: 'film:b', position: 0 } },
  { id: 'film:c', type: 'movie', category: 'movie', title: 'Nuit Claire', year: 2022, runtime: 80, genres: ['Comedy'], vote: 8.1, status: 'progress', added: 3, played: 5, inList: false, play: { id: 'film:c', position: 60 } },
  { id: 'serie:s', type: 'show', category: 'show', title: 'Les Îles', runtime: 40, genres: ['Drame'], status: 'unseen', added: 4, played: 0, inList: false, episodes: 3, seasons: 1, unseen: 3, play: { id: 'serie:s:s1e1', season: 1, episode: 1, position: 0 } },
];
const STATS = {
  year: AN, years: [AN], totalHours: 30.5, allTimeHours: 40, movies: 3, episodes: 12, days: 9, streak: 4,
  genres: [{ name: 'Drame', hours: 20 }, { name: 'Comédie', hours: 8 }, { name: 'Action', hours: 2 }], topShows: [{ id: 'serie:s', title: 'Les Îles', hours: 9, eps: 12 }], topAnime: [],
  lastMovies: [{ id: 'film:a', title: 'Le Phare', at: Date.now() }], completedShows: [{ id: 'serie:s', title: 'Les Îles' }],
  months: Array.from({ length: 12 }, (_, m) => ({ m, hours: m === 2 ? 12 : 1 })), weekdays: Array.from({ length: 7 }, (_, w) => ({ w, hours: w })), hoursOfDay: Array.from({ length: 24 }, (_, h) => ({ h, hours: h === 21 ? 5 : 0 })),
  byKind: [{ kind: 'movie', hours: 5 }, { kind: 'show', hours: 25 }, { kind: 'anime', hours: 0 }, { kind: 'clip', hours: 0 }], calendar: { [`${AN}-01-05`]: 120, [`${AN}-01-06`]: 30 }, bestMonth: { m: 2, hours: 12 }, person: 'Lina Moreau',
};
const VOTE = { code: 'KMPT', host: 'Maison', voters: 0, done: false, winner: null, link: 'http://odin.test/venus/app/#/vote?code=KMPT', qr: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><path d="M0 0h1v1H0z"/></svg>',
  items: [{ id: 'film:b', title: 'La Course', votes: 0, voters: [] }, { id: 'film:c', title: 'Nuit Claire', votes: 0, voters: [] }] };

interface Appel { chemin: string; methode: string; corps?: Record<string, unknown> }
async function ouvrir(o: { lang?: string; profils?: Array<Record<string, unknown>>; repondre?: (a: Appel) => unknown } = {}) {
  const appels: Appel[] = [], fenetres: string[] = [], ecouteurs: Record<string, Fn[]> = {};
  const on = (k: string, f: Fn) => { (ecouteurs[k] ??= []).push(f); };
  const app = { innerHTML: '', removeAttribute() {} };
  const elFaux = (): Record<string, unknown> => ({ className: '', style: {}, dataset: {}, classList: { add() {}, toggle() {}, remove() {} }, setAttribute() {}, addEventListener() {}, remove() {}, append() {}, querySelector: () => ({ focus() {} }), querySelectorAll: () => [], focus() {}, set innerHTML(h: string) { fenetres.push(h); } });
  const root = { lang: o.lang ?? 'fr', dataset: {} as Record<string, string>, style: { setProperty() {} }, classList: { toggle() {}, add() {} } };
  const location = { hash: '#/', href: 'http://127.0.0.1/venus/app/' };
  const doc: Record<string, unknown> = {
    documentElement: root, body: elFaux(), title: '', styleSheets: [], cookie: '',
    getElementById: (id: string) => (id === 'app' ? app : null), querySelector: (s: string) => (s === '#app' ? app : null), querySelectorAll: () => [],
    createElement: elFaux, addEventListener: on, contains: () => false, activeElement: null,
  };
  const rep = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json' } });
  const stockage = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); } }; };
  const win: Record<string, unknown> = {
    navigator: { language: o.lang ?? 'fr-FR' }, addEventListener: on, location, scrollY: 0, innerWidth: 390, innerHeight: 800, localStorage: stockage(), sessionStorage: stockage(),
    history: { length: 1, replaceState: (_a: unknown, _b: unknown, h: string) => { location.hash = h; }, back() {} },
    scrollTo() {}, requestAnimationFrame: (f: Fn) => setTimeout(f, 0), matchMedia: (q: string) => ({ matches: /reduced-motion/.test(q), addEventListener() {} }),
    fetch: async (chemin: string, x: { method?: string; body?: string } = {}) => {
      const a: Appel = { chemin, methode: x.method ?? 'GET', ...(x.body !== undefined ? { corps: JSON.parse(x.body) as Record<string, unknown> } : {}) };
      appels.push(a);
      const perso = o.repondre?.(a); if (perso !== undefined) return perso instanceof Response ? perso : rep(perso);
      if (chemin === '/venus/api/profils') return rep({ profils: o.profils ?? [{ id: 'moi', name: 'Awa', isAdmin: true, avatar: 0 }], actuel: 'moi', choisi: true });
      if (chemin === '/venus/api/preferences') return rep({ preferences: {} });
      if (chemin === '/venus/api/catalogue') return rep({ titres: TITRES });
      if (chemin.startsWith('/venus/api/stats')) return rep(STATS);
      if (chemin.startsWith('/venus/api/ensemble')) return rep({ results: [{ item: TITRES[1], why: ['Comédie'] }], kids: false, kidsSansAge: false });
      if (chemin === '/venus/api/vote') return rep(VOTE);
      if (chemin.startsWith('/venus/api/vote/')) return rep(a.methode === 'POST' ? { ...VOTE, voters: 1, items: [{ ...VOTE.items[0], votes: 1, voters: ['Awa'] }, VOTE.items[1]] } : VOTE);
      if (chemin === '/venus/api/collections') return rep({ collections: [{ id: 'c-aaaaaaaaaaaa', name: 'Soirées', count: 2, posters: [], auto: false }], playlists: [{ id: 'l-bbbbbbbbbbbb', name: 'À voir', count: 3, posters: [], duration: 8100, auto: false }] });
      if (chemin.startsWith('/venus/api/listes/')) return rep(a.methode === 'POST' ? { ok: true } : { id: 'l-bbbbbbbbbbbb', name: 'À voir', duration: 5400, items: [{ id: 'serie:s:s1e1', title: 'Les Îles', showTitle: 'Les Îles', season: 1, episode: 1, duration: 2700, progress: { position: 2700, watched: true } }, { id: 'film:b', title: 'La Course', year: 2021, duration: 5400 }] });
      if (chemin.startsWith('/venus/api/collections/')) return rep({ id: 'c-aaaaaaaaaaaa', name: 'Soirées', items: [TITRES[0]], editable: true, auto: false });
      if (chemin.startsWith('/venus/api/titre/')) return rep({ titre: TITRES[0], tech: { taille: 1_400_000_000, fichier: 'a.mp4' }, meta: {} });
      return rep({});
    },
  };
  const ctx = vm.createContext({ ...win, window: win, document: doc, URLSearchParams, Intl, setTimeout, clearTimeout, MutationObserver: class { observe() {} disconnect() {} } });
  vm.runInContext(SRC.planetes, ctx); vm.runInContext(SRC.app, ctx);
  for (let k = 0; k < 100; k++) { await attendre(20); if (app.innerHTML && !/aria-busy="true"/.test(app.innerHTML)) break; }
  const VA = (win as { VenusApp?: { L: Record<string, Fn> } }).VenusApp!;
  return {
    app, appels, fenetres, L: VA.L,
    async aller(h: string) { location.hash = h; for (const f of ecouteurs.hashchange ?? []) f(); await attendre(150); },
    async cliquer(data: Record<string, string>) {
      const el = { dataset: data, closest: (s: string) => (s === '[data-act]' ? el : null), getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 10, right: 100, bottom: 10 }), classList: { toggle() {} }, setAttribute() {}, parentElement: { querySelector: () => null } };
      for (const f of ecouteurs.click ?? []) await f({ target: el, clientX: 80, preventDefault() {}, stopPropagation() {} });
      await attendre(120);
    },
    derniereFenetre: () => fenetres.filter((h) => /class="sheet/.test(h)).at(-1) ?? '',
  };
}

test('logique de « Ce soir » : envie, temps, avec qui ; un clip seulement pour moins de 45 min ; « en famille » sans âge connu : rien', async () => {
  const { L } = await ouvrir();
  const sc = L.tonightScore as (i: unknown, a: unknown, soir: boolean, now?: number, alea?: () => number) => { reasons: string[]; score: number } | null;
  const zero = () => 0;
  assert.equal(sc(TITRES[1], { mood: 'frissons', time: '120', who: 'seul' }, true, 0, zero), null, 'une comédie ne fait pas frissonner');
  const r = sc(TITRES[2], { mood: 'rire', time: '90', who: 'duo' }, true, 0, zero);
  assert.ok(r, 'un genre en anglais (« Comedy ») compte aussi'); assert.equal(r!.reasons[0], 'Comedy'); assert.ok(r!.reasons.includes('Déjà commencé')); assert.ok(r!.reasons.includes('8,1/10'));
  assert.equal(sc(TITRES[0], { mood: 'emotion', time: '30', who: 'seul' }, true, 0, zero), null, 'un film de 1 h 40 ne tient pas en 45 min');
  assert.equal(sc({ ...TITRES[1], type: 'clip', category: 'clip', runtime: 4 }, { mood: 'surprise', time: '90', who: 'seul' }, true, 0, zero), null);
  assert.equal(sc(TITRES[1], { mood: 'rire', time: '120', who: 'famille' }, true, 0, zero), null, 'âge inconnu : jamais proposé en famille');
  assert.ok(sc({ ...TITRES[1], age: 6 }, { mood: 'rire', time: '120', who: 'famille' }, true, 0, zero)!.reasons.includes('Dès 6 ans'));
  const picks = (L.tonightPicks as (...a: unknown[]) => Array<{ item: { id: string } }>)(TITRES, { mood: 'surprise', time: '120', who: 'seul' }, true, new Set(['film:a']), 0, zero);
  assert.equal(picks.length, 3); assert.ok(!picks.some((p) => p.item.id === 'film:a'), 'une idée déjà montrée laisse la place tant qu’il en reste trois');
  assert.deepEqual([...(L.bouger as (l: number[], n: number, d: number) => number[])([1, 2, 3], 0, 1)], [2, 1, 3]);
  assert.deepEqual([...(L.bouger as (l: number[], n: number, d: number) => number[])([1, 2, 3], 0, -1)], [1, 2, 3]);
  const nv = (L.niveaux as (d: Record<string, number>) => (v: number) => number)({ a: 10, b: 20, c: 30, d: 40 });
  assert.deepEqual([0, 10, 20, 30, 40, 99].map(nv), [0, 1, 1, 2, 3, 4], 'quartiles des jours avec une lecture, comme Stats.js');
  assert.equal((L.heures as (x: number) => string)(0.5), '30 min'); assert.equal((L.heures as (x: number) => string)(1.25), '1,3 h'); assert.equal((L.heures as (x: number) => string)(150.4), '150 h');
});

test('« Ce soir » : trois questions puis trois idées, « Voter en famille » ouvre le vote (code et QR) ; avant : « arrive avec un prochain lot »', async () => {
  const P = await ouvrir();
  await P.aller('#/cesoir');
  let h = P.app.innerHTML;
  assert.ok(!h.includes(BIENTOT), 'la page existe');
  assert.match(h, /<h1 class="tonight-q" tabindex="-1">Quelle envie (ce soir|aujourd’hui) \?<\/h1>/);
  assert.equal((h.match(/class="choice f"/g) ?? []).length, 6); assert.match(h, /aria-label="Question 1 sur 3"/);
  await P.cliquer({ act: 'tanswer', k: 'mood', v: 'surprise' });
  assert.match(P.app.innerHTML, /Combien de temps devant vous \?/); assert.match(P.app.innerHTML, /data-act="tprev"/);
  await P.cliquer({ act: 'tanswer', k: 'time', v: '120' });
  await P.cliquer({ act: 'tanswer', k: 'who', v: 'seul' });
  h = P.app.innerHTML;
  assert.match(h, /Voici nos idées pour (ce soir|aujourd’hui)/); assert.equal((h.match(/<article class="pick"/g) ?? []).length, 3);
  assert.match(h, /<span class="pick-rank">Notre choix<\/span>/); assert.match(h, /<span class="pick-rank">Idée 2<\/span>/);
  assert.match(h, /data-act="tmore"/); assert.match(h, /data-act="tvote"/);
  assert.ok(!/Qui regarde ce soir/.test(h), 'un seul profil : pas de « Qui regarde ce soir ? »');
  await P.cliquer({ act: 'tvote' });
  const v = P.appels.find((a) => a.chemin === '/venus/api/vote');
  assert.ok(v && v.methode === 'POST' && (v.corps!.itemIds as string[]).length === 3);
  const f = P.derniereFenetre();
  assert.match(f, /<h2>Vote en famille<\/h2>/); assert.match(f, /<b class="big-code">K M P T<\/b>/); assert.match(f, /<span role="img" aria-label="QR code du vote"><svg/);
  assert.match(f, /Pas encore de voix/); assert.match(f, /data-act="vend"/);
  await P.cliquer({ act: 'vend' });
  assert.ok(P.appels.some((a) => a.chemin === '/venus/api/vote/KMPT/clore' && a.methode === 'POST'));
});

test('« Qui regarde ce soir ? » avec deux profils : les personnes cochées, Films ou Séries, d’après Odin', async () => {
  const P = await ouvrir({ profils: [{ id: 'moi', name: 'Awa', isAdmin: true, avatar: 0 }, { id: 'p:noe', name: 'Noé', avatar: 2, isKids: true }] });
  await P.aller('#/cesoir'); await attendre(100);
  const h = P.app.innerHTML;
  assert.match(h, /<h2 class="section-title">Qui regarde ce soir \?<\/h2>/);
  assert.match(h, /class="together-p f on" aria-pressed="true" data-act="tgwho" data-v="moi"/); assert.match(h, /Noé<\/span><small>enfant<\/small>/);
  assert.ok(P.appels.some((a) => a.chemin === '/venus/api/ensemble?profils=moi&kind=movie'));
  assert.match(h, /<div class="together-grid">[^]*La Course[^]*<span>Comédie<\/span>/);
  await P.cliquer({ act: 'tgkind', v: 'show' });
  assert.ok(P.appels.some((a) => a.chemin === '/venus/api/ensemble?profils=moi&kind=show'));
});

test('le vote sur le téléphone : rejoindre avec le code, toucher son choix (une voix par appareil)', async () => {
  const P = await ouvrir();
  await P.aller('#/vote');
  assert.match(P.app.innerHTML, /<h1 tabindex="-1">Rejoindre le vote<\/h1>/); assert.match(P.app.innerHTML, /id="vote-code"/);
  await P.aller('#/vote?code=kmpt'); await attendre(100);
  let h = P.app.innerHTML;
  assert.match(h, /Que regarder ce soir \?/); assert.match(h, /Proposé par Maison\. Touchez votre choix\./); assert.equal((h.match(/class="vote-card f/g) ?? []).length, 2);
  await P.cliquer({ act: 'vpick', v: 'film:b' });
  const p = P.appels.find((a) => a.chemin === '/venus/api/vote/KMPT' && a.methode === 'POST');
  assert.ok(p); assert.equal(p!.corps!.itemId, 'film:b'); assert.match(String(p!.corps!.client), /^[a-z0-9]+$/);
  h = P.app.innerHTML;
  assert.match(h, /A voté !/); assert.match(h, /class="vote-card f on" aria-pressed="true" data-act="vpick" data-v="film:b"/); assert.match(h, /1 voix/);
  await P.aller('#/'); // quitter la page arrête la relecture du vote
});

test('« Mes statistiques » et la rétrospective : les chiffres d’Odin, le calendrier jour par jour, les écrans qui avancent', async () => {
  const P = await ouvrir();
  await P.aller('#/stats'); await attendre(100);
  let h = P.app.innerHTML;
  assert.ok(!h.includes(BIENTOT));
  assert.ok(P.appels.some((a) => a.chemin === `/venus/api/stats?annee=${AN}`));
  assert.match(h, /<h1 tabindex="-1">Mes statistiques<\/h1>/); assert.match(h, /<b>30,5 h<\/b><span>regardées en \d{4} · plus de 1 jour entier<\/span>/);
  assert.match(h, /Genre préféré : <strong>Drame<\/strong>/); assert.match(h, /Vous avez beaucoup vu <strong>Lina Moreau<\/strong>/);
  assert.match(h, /<div class="st-kpi"><b>3<\/b><span>films vus<\/span><\/div>/); assert.match(h, /<b>4 j<\/b><span>plus longue série de jours<\/span>/);
  assert.match(h, /2 jours avec une lecture/); assert.match(h, /class="cal-c l\d"/);
  assert.match(h, /href="#\/retrospective\?annee=\d{4}">Ma rétrospective \d{4}<\/a>/);
  assert.match(h, /D’après la progression gardée par Odin/);
  await P.aller(`#/retrospective?annee=${AN}`); await attendre(100);
  h = P.app.innerHTML;
  assert.match(h, /class="recap tone-1"/); assert.match(h, /aria-roledescription="diaporama"/); assert.match(h, /<h2 class="rc-big">31 h<\/h2>/);
  assert.match(h, /<span>1 \/ 8<\/span>/);
  await P.cliquer({ act: 'rcnext' });
  assert.match(P.app.innerHTML, /<span>2 \/ 8<\/span>/); assert.match(P.app.innerHTML, /films vus jusqu’au bout\./);
  for (let i = 0; i < 8; i++) await P.cliquer({ act: 'rcnext' });
  assert.match(P.app.innerHTML, /Merci, Awa !/); assert.match(P.app.innerHTML, /data-act="rcagain"/);
});

test('Collections et listes de lecture : onglets, liste dans l’ordre, monter une vidéo, ajouter depuis une fiche', async () => {
  const P = await ouvrir();
  await P.aller('#/collections'); await attendre(100);
  let h = P.app.innerHTML;
  assert.ok(!h.includes(BIENTOT));
  assert.match(h, /Collections \(1\)/); assert.match(h, /Listes de lecture \(1\)/); assert.match(h, /href="#\/collection\/c-aaaaaaaaaaaa"/); assert.match(h, /data-act="colnew"/);
  await P.cliquer({ act: 'colltab', v: 'playlists' });
  h = P.app.innerHTML;
  assert.match(h, /href="#\/liste-lecture\/l-bbbbbbbbbbbb"/); assert.match(h, /3 titres · 2 h 15/);
  await P.aller('#/liste-lecture/l-bbbbbbbbbbbb'); await attendre(100);
  h = P.app.innerHTML;
  assert.match(h, /<h1 tabindex="-1">À voir<\/h1>/); assert.match(h, /2 vidéos · 1 h 30/); assert.match(h, /Les Îles · S1 É1/); assert.match(h, />Continuer</);
  assert.match(h, /class="pl-row seen"/);
  await P.cliquer({ act: 'plmove', v: '1', d: '-1', c: 'l-bbbbbbbbbbbb' });
  const o = P.appels.find((a) => a.chemin === '/venus/api/listes/l-bbbbbbbbbbbb' && a.methode === 'POST');
  assert.deepEqual(o?.corps, { faire: 'ordre', order: ['film:b', 'serie:s:s1e1'] });
  await P.aller('#/titre/film%3Aa'); await attendre(150);
  h = P.app.innerHTML;
  assert.match(h, /aria-label="Ajouter à une liste"[^>]*data-act="addto" data-v="film:a"/); assert.match(h, /aria-label="Télécharger"[^>]*data-act="dlsheet" data-v="film:a"/);
  await P.cliquer({ act: 'addto', v: 'film:a' });
  const f = P.derniereFenetre();
  assert.match(f, /<h2>Ajouter « Le Phare »<\/h2>/); assert.match(f, /data-act="addpl" data-v="l-bbbbbbbbbbbb"/); assert.match(f, /data-act="addcol" data-v="c-aaaaaaaaaaaa"/);
  await P.cliquer({ act: 'addpl', v: 'l-bbbbbbbbbbbb', n: 'À voir' });
  assert.ok(P.appels.some((a) => a.chemin === '/venus/api/listes/l-bbbbbbbbbbbb' && (a.corps as { faire?: string } | undefined)?.faire === 'ajouter'));
});

test('« Télécharger » sur une fiche : le fichier d’origine tout de suite, les versions légères demandées à Odin', async () => {
  const P = await ouvrir();
  await P.aller('#/titre/film%3Aa'); await attendre(150);
  await P.cliquer({ act: 'dlsheet', v: 'film:a' });
  const f = P.derniereFenetre();
  assert.match(f, /<h2>Télécharger « Le Phare »<\/h2>/);
  assert.match(f, /<a class="opt f" href="\/venus\/api\/telecharger\/film%3Aa" download="" data-act="dlorig">[^]*Fichier d’origine[^]*Meilleure qualité · 1,4 Go/);
  assert.match(f, /<button class="opt f" type="button" data-act="dlprep" data-v="720p" data-id="film:a">[^]*Version légère 720p[^]*≈ 1,5 Go/);
  await P.aller('#/telechargements');
  assert.ok(!P.app.innerHTML.includes(BIENTOT)); assert.match(P.app.innerHTML, /<h1 tabindex="-1">Téléchargements<\/h1>/);
});

test('en anglais : les écrans de la maison sont traduits', async () => {
  const P = await ouvrir({ lang: 'en' });
  await P.aller('#/cesoir');
  let h = P.app.innerHTML;
  assert.match(h, /What are you in the mood for (tonight|today)\?/); assert.match(h, /<b>Laugh<\/b><small>A comedy, something light<\/small>/);
  for (const fr of ['Quelle envie', 'Une comédie', 'Surprends-moi']) assert.ok(!h.includes(fr), `reste en français : ${fr}`);
  await P.aller('#/stats'); await attendre(100);
  h = P.app.innerHTML;
  assert.match(h, /My statistics/); assert.match(h, /movies watched/); assert.match(h, /Day by day/);
  for (const fr of ['Mes statistiques', 'films vus', 'Jour par jour', 'Mois par mois']) assert.ok(!h.includes(fr), `reste en français : ${fr}`);
  await P.aller('#/collections'); await attendre(100);
  assert.match(P.app.innerHTML, /Playlists \(1\)/); assert.match(P.app.innerHTML, /New collection/);
});
