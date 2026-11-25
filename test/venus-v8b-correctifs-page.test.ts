// Vénus, la maison (lot V8, seconde part), corrections après relecture, la page : pendant une préparation, seule la
// liste des téléchargements est repeinte (et seulement si elle a changé), le focus reste où il était (« Enregistrer »,
// le menu, le titre) ; après ✕, le focus va au ✕ suivant ; le champ du code de la Séance a le focus en arrivant (comme
// Seance.js) ; la Télécommande met le focus sur un écran une fois la liste lue (et sur le même après « Changer ») ;
// « Lecture / pause » bascule sur l'écran ; aucun nom de produit tiers à l'écran (« box domotique ») ; la note dit ce
// qui manque encore ; les tailles ne se coupent pas (« 1,4 Go ») ; le message « en préparation » a son bouton « Voir »
// (Downloads.js) ; « Télécharger la saison » (Downloads.js et la maquette). Page sans navigateur : un faux document
// qui garde le focus et sait trouver la liste, réponses d'Odin simulées, relecture de 2 s accélérée.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const APP = new URL('../src/valhalla/venus/app/', import.meta.url);
const SRC = { planetes: readFileSync(new URL('planetes.js', APP), 'utf8'), app: readFileSync(new URL('app.js', APP), 'utf8'), css: readFileSync(new URL('css/app.css', APP), 'utf8') };
type Fn = (...a: unknown[]) => unknown;
const attendre = (ms = 60) => new Promise((r) => setTimeout(r, ms));
const NB = ' ';

const TITRES = [
  { id: 'film:a', type: 'movie', category: 'movie', title: 'Le Phare', year: 2020, runtime: 100, genres: ['Drame'], status: 'unseen', added: 1, played: 0, inList: false, play: { id: 'film:a', position: 0 } },
  { id: 'serie:s', type: 'show', category: 'show', title: 'Les Îles', runtime: 40, genres: ['Drame'], status: 'unseen', added: 4, played: 0, inList: false, episodes: 2, seasons: 1, unseen: 2, play: { id: 'serie:s:s1e1', season: 1, episode: 1, position: 0 } },
];
const FICHE_SERIE = { titre: TITRES[1], meta: {}, saisons: [{ number: 1, manquants: [], episodes: [{ id: 'serie:s:s1e1', episode: 1, runtime: 23, position: 0, duration: 1380, watched: false }, { id: 'serie:s:s1e2', episode: 2, runtime: 23, position: 0, duration: 1380, watched: false }] }], tech: { taille: 300_000_000, fichier: 'e1.mkv' } };
const PRET = { id: 'dl-aaaaaaaaaaaa', itemId: 'film:a', title: 'Le Phare', quality: '720p', state: 'ready', progress: 100, size: 1_200_000_000, name: 'Le Phare (720p).mp4' };
const EN_COURS = (p: number) => ({ id: 'dl-bbbbbbbbbbbb', itemId: 'serie:s:s1e1', title: 'Les Îles S01E01', quality: '480p', state: 'working', progress: p });
const ECHEC = { id: 'dl-cccccccccccc', itemId: 'film:a', title: 'Le Phare', quality: '480p', state: 'error', progress: 0, reason: 'echec', error: 'La conversion a échoué.' };
const ECRANS = { ecrans: [{ id: 'media_player.salon', nom: 'Télé du salon', type: 'tv', actif: true, enLecture: true }, { id: 'media_player.cuisine', nom: 'Cuisine', type: 'enceinte', actif: false, enLecture: false }] };

interface Appel { chemin: string; methode: string; corps?: unknown }
/** Un élément qu'on peut focaliser : sa clé dit lequel (le sélecteur qui l'a trouvé). */
interface ElFaux { cle: string; dataset: Record<string, string>; dansListe?: boolean; focus(): void }

async function ouvrir(o: { lang?: string; profils?: Array<Record<string, unknown>>; repondre?: (a: Appel) => unknown } = {}) {
  const appels: Appel[] = [], fenetres: string[] = [], ecouteurs: Record<string, Fn[]> = {};
  const on = (k: string, f: Fn) => { (ecouteurs[k] ??= []).push(f); };
  const etat = { focus: null as ElFaux | null, ecritsApp: 0, ecritsListe: 0 };
  const el = (cle: string, dataset: Record<string, string> = {}, dansListe = false): ElFaux => { const e: ElFaux = { cle, dataset, dansListe, focus() { etat.focus = e; } }; return e; };
  let appHtml = '', listeHtml = '';
  const app = { get innerHTML() { return appHtml; }, set innerHTML(h: string) { appHtml = h; etat.ecritsApp++; etat.focus = null; listeHtml = (/<div class="dl-list"[^>]*>([^]*?)<\/div><\/div><\/main>/.exec(h) ?? [])[1] ?? ''; }, removeAttribute() {} };
  // Les boutons d'une liste peinte : « [data-act="x"][data-v="y"] » trouvés dans son HTML.
  const boutons = (html: string, act: string) => [...html.matchAll(new RegExp(`data-act="${act}" data-v="([^"]*)"`, 'g'))].map((m) => el(`${act}:${m[1]}`, { act, v: m[1] }, true));
  const liste = {
    get innerHTML() { return listeHtml; }, set innerHTML(h: string) { listeHtml = h; etat.ecritsListe++; if (etat.focus?.dansListe) etat.focus = null; },
    removeAttribute() {}, setAttribute() {}, contains: (x: unknown) => !!(x as ElFaux | null)?.dansListe,
    querySelectorAll: (s: string) => { const m = /data-act="([^"]+)"/.exec(s); return m ? boutons(listeHtml, m[1]) : []; },
    querySelector: (s: string) => { const m = /\[data-act="([^"]+)"\]\[data-v="([^"]+)"\]/.exec(s); return m ? boutons(listeHtml, m[1]).find((b) => b.dataset.v === m[2]) ?? null : null; },
  };
  const elFaux = (): Record<string, unknown> => ({ className: '', style: {}, dataset: {}, classList: { add() {}, toggle() {}, remove() {} }, setAttribute() {}, addEventListener() {}, remove() {}, append() {}, querySelector: () => ({ focus() {} }), querySelectorAll: () => [], focus() {}, set innerHTML(h: string) { fenetres.push(h); } });
  const body = elFaux();
  const root = { lang: o.lang ?? 'fr', dataset: {} as Record<string, string>, style: { setProperty() {} }, classList: { toggle() {}, add() {} } };
  const location = { hash: '#/', href: 'http://127.0.0.1/venus/app/' };
  const trouver = (s: string): unknown => {
    if (s === '#app') return app;
    if (s === '.dl-list') return appHtml.includes('class="dl-list"') ? liste : null;
    if (s === 'main [data-arrivee]') { const m = /<input id="([^"]+)"[^>]*data-arrivee/.exec(appHtml); return m ? el(`#${m[1]}`) : null; }
    if (s === 'main h1') return /<h1[\s>]/.test(appHtml) ? el('main h1') : null;
    if (s === '#room-code') return appHtml.includes('id="room-code"') ? el('#room-code') : null;
    const m = /^\[data-act="([^"]+)"\](?:\[data-v="([^"]+)"\])?$/.exec(s);
    if (m) { const b = boutons(appHtml, m[1]).find((x) => !m[2] || x.dataset.v === m[2]); return b ?? null; }
    return null;
  };
  const doc: Record<string, unknown> = {
    documentElement: root, body, title: '', styleSheets: [], cookie: '',
    getElementById: (id: string) => (id === 'app' ? app : null), querySelector: trouver, querySelectorAll: () => [],
    createElement: elFaux, addEventListener: on, contains: () => false,
    get activeElement() { return etat.focus ?? body; },
  };
  const rep = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json' } });
  const stockage = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); } }; };
  const win: Record<string, unknown> = {
    navigator: { language: o.lang ?? 'fr-FR' }, addEventListener: on, location, scrollY: 0, innerWidth: 390, innerHeight: 800, localStorage: stockage(), sessionStorage: stockage(),
    history: { length: 1, replaceState: (_a: unknown, _b: unknown, h: string) => { location.hash = h; }, back() {} },
    scrollTo() {}, requestAnimationFrame: (f: Fn) => setTimeout(f, 0), matchMedia: (q: string) => ({ matches: /reduced-motion/.test(q), addEventListener() {} }),
    fetch: async (chemin: string, x: { method?: string; body?: string } = {}) => {
      const a: Appel = { chemin, methode: x.method ?? 'GET', ...(x.body !== undefined ? { corps: JSON.parse(x.body) as unknown } : {}) };
      appels.push(a);
      const perso = o.repondre?.(a); if (perso !== undefined) return perso instanceof Response ? perso : rep(perso);
      if (chemin === '/venus/api/profils') return rep({ profils: o.profils ?? [{ id: 'moi', name: 'Awa', isAdmin: true, avatar: 0 }], actuel: 'moi', choisi: true });
      if (chemin === '/venus/api/preferences') return rep({ preferences: {} });
      if (chemin === '/venus/api/catalogue') return rep({ titres: TITRES });
      if (chemin === '/venus/api/telechargements') return rep(a.methode === 'POST' ? { ...PRET, state: 'queued', progress: 0 } : [PRET, EN_COURS(42), ECHEC]);
      if (chemin.startsWith('/venus/api/telechargements/')) return rep({ ok: true });
      if (chemin === '/venus/ecrans') return rep(ECRANS);
      if (/^\/venus\/ecran\/[^/]+\/commande$/.test(chemin)) return rep({ ok: true });
      if (chemin === '/venus/api/titre/serie%3As') return rep(FICHE_SERIE);
      if (chemin.startsWith('/venus/api/titre/')) return rep({ titre: TITRES[0], tech: { taille: 1_400_000_000, fichier: 'a.mp4' }, meta: {} });
      return rep({});
    },
  };
  // La relecture de 2 s de la liste est accélérée (25 ms) ; le reste du temps est le vrai. Les minuteries de la page ne
  // retiennent pas l'essai : un essai qui échoue en pleine relecture ne bloque jamais le fichier.
  const vite = (f: Fn, ms?: number, ...r: unknown[]) => { const x = setTimeout(f, ms === 2000 ? 25 : ms, ...r); x.unref(); return x; };
  const ctx = vm.createContext({ ...win, window: win, document: doc, URLSearchParams, Intl, setTimeout: vite, clearTimeout, MutationObserver: class { observe() {} disconnect() {} } });
  vm.runInContext(SRC.planetes, ctx); vm.runInContext(SRC.app, ctx);
  for (let k = 0; k < 100; k++) { await attendre(20); if (appHtml && !/aria-busy="true"/.test(appHtml)) break; }
  return {
    get html() { return appHtml; }, get listeHtml() { return listeHtml; }, etat, appels, fenetres, location,
    async aller(h: string) { location.hash = h; for (const f of ecouteurs.hashchange ?? []) f(); await attendre(150); },
    async cliquer(data: Record<string, string>) {
      const cible = { dataset: data, closest: (s: string) => (s === '[data-act]' ? cible : null), getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 10, right: 100, bottom: 10 }), classList: { toggle() {} }, setAttribute() {}, parentElement: { querySelector: () => null } };
      for (const f of ecouteurs.click ?? []) await f({ target: cible, clientX: 80, preventDefault() {}, stopPropagation() {} });
      await attendre(120);
    },
    derniereFenetre: () => fenetres.filter((h) => /class="sheet/.test(h)).at(-1) ?? '',
    dernierToast: () => fenetres.filter((h) => /toast-msg/.test(h)).at(-1) ?? '',
  };
}

test('Téléchargements : pendant une préparation, la relecture ne repeint que la liste, et seulement si elle a changé ; le focus reste', async () => {
  let avance = false;
  const P = await ouvrir({ repondre: (a) => (a.chemin === '/venus/api/telechargements' && a.methode === 'GET' ? [PRET, EN_COURS(avance ? 50 : 42), ECHEC] : undefined) });
  await P.aller('#/telechargements');
  const ecrits = P.etat.ecritsApp;
  assert.equal(P.etat.focus?.cle, 'main h1', 'en arrivant, le titre a le focus');
  assert.match(P.listeHtml, /data-act="dlsave" data-v="dl-aaaaaaaaaaaa"[^>]*>[^]*Enregistrer<\/a>/, '« Enregistrer » se retrouve (et retrouve son focus)');
  // « Enregistrer » a le focus ; plusieurs relectures : la liste ne bouge pas, le focus non plus
  const enr = (P as unknown as { etat: { focus: unknown } }).etat;
  enr.focus = { cle: 'dlsave:dl-aaaaaaaaaaaa', dataset: { act: 'dlsave', v: 'dl-aaaaaaaaaaaa' }, dansListe: true, focus() {} };
  const avant = P.etat.ecritsListe;
  await attendre(90);
  assert.equal(P.etat.ecritsApp, ecrits, 'jamais toute la page');
  assert.equal(P.etat.ecritsListe, avant, 'liste inchangée : rien n’est repeint');
  assert.equal(P.etat.focus?.cle, 'dlsave:dl-aaaaaaaaaaaa');
  // l'avancement change : seule la liste est repeinte, et « Enregistrer » retrouve le focus
  avance = true;
  for (let k = 0; k < 40 && !/width:50%/.test(P.listeHtml); k++) await attendre(25);
  assert.match(P.listeHtml, /<i style="width:50%"><\/i>/);
  assert.equal(P.etat.ecritsApp, ecrits, 'toujours pas toute la page');
  assert.equal(P.etat.focus?.cle, 'dlsave:dl-aaaaaaaaaaaa', 'le focus est rendu au même bouton');
  await P.aller('#/');
});

test('Téléchargements : après ✕, le focus va au ✕ de la ligne suivante (puis au titre quand la liste est vide)', async () => {
  // le faux Odin supprime vraiment : la relecture suivante ne fait pas revenir la ligne
  let serveur = [PRET, EN_COURS(42), ECHEC];
  const P = await ouvrir({ repondre: (a) => {
    if (a.chemin === '/venus/api/telechargements' && a.methode === 'GET') return serveur;
    const m = /^\/venus\/api\/telechargements\/([^/]+)$/.exec(a.chemin);
    if (m && a.methode === 'POST') { serveur = serveur.filter((x) => x.id !== m[1]); return { ok: true }; }
    return undefined;
  } });
  await P.aller('#/telechargements'); await attendre(60);
  await P.cliquer({ act: 'dldel', v: 'dl-bbbbbbbbbbbb' });
  assert.ok(P.appels.some((a) => a.chemin === '/venus/api/telechargements/dl-bbbbbbbbbbbb' && a.methode === 'POST'));
  assert.ok(!P.listeHtml.includes('dl-bbbbbbbbbbbb'));
  assert.equal(P.etat.focus?.cle, 'dldel:dl-cccccccccccc', 'le ✕ qui a pris sa place');
  await P.cliquer({ act: 'dldel', v: 'dl-cccccccccccc' });
  assert.equal(P.etat.focus?.cle, 'dldel:dl-aaaaaaaaaaaa', 'la dernière ligne partie : le ✕ d’avant');
  await P.cliquer({ act: 'dldel', v: 'dl-aaaaaaaaaaaa' });
  assert.equal(P.etat.focus?.cle, 'main h1', 'plus rien : le titre');
  assert.match(P.listeHtml, /Aucun téléchargement\. Sur la fiche d’un film ou d’une saison, touchez « Télécharger »\./, 'le texte de Downloads.js, saison comprise');
});

test('Séance : en arrivant, le champ du code a le focus, comme Seance.js', async () => {
  const P = await ouvrir();
  await P.aller('#/seance');
  assert.equal(P.etat.focus?.cle, '#room-code');
});

test('Télécommande : le focus va sur un écran quand la liste arrive, et sur le même après « Changer » ; Lecture / pause bascule sur l’écran', async () => {
  const P = await ouvrir();
  await P.aller('#/telecommande'); await attendre(60);
  assert.match(String(P.etat.focus?.cle), /^rcpick:media_player\.salon$/, 'le premier écran');
  await P.cliquer({ act: 'rcpick', v: 'media_player.cuisine' });
  await P.cliquer({ act: 'rccmd', v: 'lecturepause' });
  await P.cliquer({ act: 'rccmd', v: 'lecturepause' });
  const c = P.appels.filter((a) => a.chemin === '/venus/ecran/media_player.cuisine/commande').map((a) => a.corps);
  assert.deepEqual(c, [{ action: 'basculer' }, { action: 'basculer' }], 'l’écran bascule lui-même : son état fait foi');
  await P.cliquer({ act: 'rcchange' }); await attendre(60);
  assert.equal(P.etat.focus?.cle, 'rcpick:media_player.cuisine', 'l’écran choisi juste avant');
});

test('Télécommande : aucun nom de produit tiers à l’écran ; sans box, la page dit où la relier ; la note dit ce qui manque', async () => {
  const P = await ouvrir({ repondre: (a) => (a.chemin === '/venus/ecrans' ? { ecrans: [], message: 'Home Assistant n\'est pas relié.' } : undefined) });
  await P.aller('#/telecommande'); await attendre(60);
  assert.ok(!P.html.includes('Home Assistant'), 'pas de nom de produit (NOTES.md de la maquette)');
  assert.match(P.html, /Aucune box domotique n’est reliée à Odin : aucun écran à piloter\. Reliez-la dans Midgard, « Relier une box »\./);
  const Q = await ouvrir();
  await Q.aller('#/telecommande'); await attendre(60);
  await Q.cliquer({ act: 'rcpick', v: 'media_player.salon' });
  assert.ok(!Q.html.includes('Home Assistant'));
  assert.ok(!/les chaînes demandent un écran/.test(Q.html), 'plus de phrase fausse sur les chaînes');
  assert.match(Q.html, /Odin pilote cet écran par la box domotique : lecture, pause et ±30 s\. La croix, Retour, Accueil, la recherche, les chaînes et « Reprendre sur la TV » de Venus ne sont pas encore là\./);
  const E = await ouvrir({ lang: 'en' });
  await E.aller('#/telecommande'); await attendre(60);
  await E.cliquer({ act: 'rcpick', v: 'media_player.salon' });
  assert.match(E.html, /home automation box/); assert.ok(!E.html.includes('Home Assistant'));
});

test('la fenêtre du QR : « Valable jusqu’à » ne colle plus au lien (et le contour du focus ne le cache plus)', () => {
  assert.match(SRC.css, /\.rc-qr \.input \+ p \{[^}]*margin-top: 10px;/);
});

test('tailles insécables (« 1,4 Go » ne se coupe pas) ; « en préparation » a son bouton « Voir » qui ouvre Téléchargements', async () => {
  const P = await ouvrir();
  await P.aller('#/titre/film%3Aa'); await attendre(150);
  await P.cliquer({ act: 'dlsheet', v: 'film:a' });
  const f = P.derniereFenetre();
  assert.ok(f.includes(`Meilleure qualité · 1,4${NB}Go`), 'le poids du fichier d’origine');
  assert.ok(f.includes(`Idéale pour un téléphone ou une tablette · ≈${NB}1,5${NB}Go`), 'l’estimation');
  await P.cliquer({ act: 'dlprep', v: '720p', id: 'film:a' });
  const t = P.dernierToast();
  assert.match(t, /« Le Phare » en préparation \(720p\)/);
  assert.match(t, /<button class="toast-act f" type="button" data-act="toastgo" data-v="\/telechargements">Voir<\/button>/);
  await P.cliquer({ act: 'toastgo', v: '/telechargements' });
  assert.equal(P.location.hash, '#/telechargements');
  await P.aller('#/telechargements'); await attendre(60);
  assert.ok(P.listeHtml.includes(`Version légère 720p · Prêt · 1,2${NB}Go`));
  await P.aller('#/');
});

test('« Télécharger la saison » sur une série (Downloads.js, maquette) : 720p et 480p, sans fichier d’origine ; toute la saison demandée', async () => {
  const P = await ouvrir({ repondre: (a) => (a.chemin === '/venus/api/telechargements' && a.methode === 'POST' ? [{ ...EN_COURS(0), state: 'queued' }, { ...EN_COURS(0), id: 'dl-dddddddddddd', title: 'Les Îles S01E02', state: 'queued' }] : undefined) });
  await P.aller('#/titre/serie%3As'); await attendre(150);
  assert.match(P.html, /<div class="sh-actions"><button class="btn btn-small btn-ghost btn-icon f" aria-label="Télécharger la saison" title="Télécharger la saison" data-act="dlseason" data-v="serie:s" data-s="1">/);
  await P.cliquer({ act: 'dlseason', v: 'serie:s', s: '1' });
  const f = P.derniereFenetre();
  assert.match(f, /<h2>Télécharger la saison<\/h2>/);
  assert.ok(!f.includes('Fichier d’origine'), 'une saison n’a pas de fichier d’origine unique');
  assert.ok(f.includes(`Idéale pour un téléphone ou une tablette · ≈${NB}0,9${NB}Go par heure`) && f.includes(`Pour garder de la place · ≈${NB}0,45${NB}Go par heure`));
  assert.match(f, /data-act="dlprep" data-v="720p" data-id="serie:s" data-s="1"/);
  await P.cliquer({ act: 'dlprep', v: '720p', id: 'serie:s', s: '1' });
  const p = P.appels.find((a) => a.chemin === '/venus/api/telechargements' && a.methode === 'POST');
  assert.deepEqual(p?.corps, { itemId: 'serie:s', saison: 1, quality: '720p' });
  assert.match(P.dernierToast(), /2 épisodes en préparation \(720p\)/);
  // un profil enfant n'a pas le bouton
  const K = await ouvrir({ profils: [{ id: 'moi', name: 'Noé', isAdmin: false, isKids: true, avatar: 0 }] });
  await K.aller('#/titre/serie%3As'); await attendre(150);
  assert.ok(!K.html.includes('data-act="dlseason"'));
  // en anglais
  const E = await ouvrir({ lang: 'en' });
  await E.aller('#/titre/serie%3As'); await attendre(150);
  await E.cliquer({ act: 'dlseason', v: 'serie:s', s: '1' });
  const g = E.derniereFenetre();
  assert.match(g, /<h2>Download the season<\/h2>/); assert.ok(g.includes(`≈${NB}0.9${NB}GB per hour`));
});
