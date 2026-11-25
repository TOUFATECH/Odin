// Vénus, la maison (lot V8, seconde part), la page : la Séance (Seance.js : rejoindre avec le code de 4 lettres), la
// Télécommande (Remote.js : l'écran choisi, lecture et pause, ±30 s, et le QR de la télécommande d'Odin pour un autre
// téléphone), les versions légères 720p et 480p sur une fiche, et la liste des téléchargements (Downloads.js). Avant
// ce lot, Séance et Télécommande disaient « Cette partie de Venus arrive dans Odin avec un prochain lot. », et les
// versions légères étaient grisées. Page sans navigateur, réponses d'Odin simulées.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const APP = new URL('../src/valhalla/venus/app/', import.meta.url);
const SRC = { planetes: readFileSync(new URL('planetes.js', APP), 'utf8'), app: readFileSync(new URL('app.js', APP), 'utf8') };
type Fn = (...a: unknown[]) => unknown;
const attendre = (ms = 60) => new Promise((r) => setTimeout(r, ms));
const BIENTOT = 'Cette partie de Venus arrive dans Odin avec un prochain lot.';

const TITRES = [
  { id: 'film:a', type: 'movie', category: 'movie', title: 'Le Phare', year: 2020, runtime: 100, genres: ['Drame'], status: 'unseen', added: 1, played: 0, inList: false, play: { id: 'film:a', position: 0 } },
  { id: 'serie:s', type: 'show', category: 'show', title: 'Les Îles', runtime: 40, genres: ['Drame'], status: 'unseen', added: 4, played: 0, inList: false, episodes: 3, seasons: 1, unseen: 3, play: { id: 'serie:s:s1e1', season: 1, episode: 1, position: 0 } },
];
const TACHES = [
  { id: 'dl-aaaaaaaaaaaa', itemId: 'film:a', title: 'Le Phare', quality: '720p', state: 'ready', progress: 100, size: 1_200_000_000, name: 'Le Phare (720p).mp4' },
  { id: 'dl-bbbbbbbbbbbb', itemId: 'serie:s:s1e1', title: 'Les Îles S01E01', quality: '480p', state: 'working', progress: 42 },
  { id: 'dl-cccccccccccc', itemId: 'film:a', title: 'Le Phare', quality: '480p', state: 'error', progress: 0, reason: 'ffmpeg', error: 'FFmpeg est introuvable pour Odin.' },
];
const ECRANS = { ecrans: [{ id: 'media_player.salon', nom: 'Télé du salon', type: 'tv', actif: true, enLecture: true }, { id: 'media_player.cuisine', nom: 'Cuisine', type: 'enceinte', actif: false, enLecture: false }] };
const QR = { jeton: 'j', id: 'x', lien: 'http://odin.test/t/abc', qr: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><path d="M0 0h1v1H0z"/></svg>', expire: Date.now() + 7_200_000 };

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
      if (chemin === '/venus/api/telechargements') return rep(a.methode === 'POST' ? { ...TACHES[0], state: 'queued', progress: 0 } : TACHES);
      if (chemin.startsWith('/venus/api/telechargements/')) return rep({ ok: true });
      if (chemin === '/venus/api/seance/KMPT') return rep({ code: 'KMPT', itemId: 'film:a', host: 'Awa', expire: Date.now() + 3600_000 });
      if (chemin.startsWith('/venus/api/seance/')) return rep({ error: 'Séance introuvable.' }, 404);
      if (chemin === '/venus/ecrans') return rep(ECRANS);
      if (/^\/venus\/ecran\/[^/]+\/commande$/.test(chemin)) return rep({ ok: true });
      if (/^\/venus\/ecran\/[^/]+\/qr$/.test(chemin)) return rep(QR);
      if (chemin.startsWith('/venus/api/titre/')) return rep({ titre: TITRES[0], tech: { taille: 1_400_000_000, fichier: 'a.mp4' }, meta: {} });
      return rep({});
    },
  };
  const ctx = vm.createContext({ ...win, window: win, document: doc, URLSearchParams, Intl, setTimeout, clearTimeout, MutationObserver: class { observe() {} disconnect() {} } });
  vm.runInContext(SRC.planetes, ctx); vm.runInContext(SRC.app, ctx);
  for (let k = 0; k < 100; k++) { await attendre(20); if (app.innerHTML && !/aria-busy="true"/.test(app.innerHTML)) break; }
  return {
    app, appels, fenetres, location,
    async aller(h: string) { location.hash = h; for (const f of ecouteurs.hashchange ?? []) f(); await attendre(150); },
    async cliquer(data: Record<string, string>) {
      const el = { dataset: data, closest: (s: string) => (s === '[data-act]' ? el : null), getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 10, right: 100, bottom: 10 }), classList: { toggle() {} }, setAttribute() {}, parentElement: { querySelector: () => null } };
      for (const f of ecouteurs.click ?? []) await f({ target: el, clientX: 80, preventDefault() {}, stopPropagation() {} });
      await attendre(120);
    },
    derniereFenetre: () => fenetres.filter((h) => /class="sheet/.test(h)).at(-1) ?? '',
  };
}

test('Téléchargements : la liste d’Odin (prêt, en préparation, échec), « Enregistrer », supprimer', async () => {
  const P = await ouvrir();
  await P.aller('#/telechargements'); await attendre(100);
  const h = P.app.innerHTML;
  assert.ok(P.appels.some((a) => a.chemin === '/venus/api/telechargements' && a.methode === 'GET'), 'la liste est lue chez Odin');
  assert.match(h, /<h1 tabindex="-1">Téléchargements<\/h1>/);
  assert.match(h, /Les versions légères restent prêtes 7 jours sur le serveur\./);
  assert.match(h, /<div class="dl-row st-ready">[^]*<b>Le Phare<\/b><small>Version légère 720p · Prêt · 1,2 Go<\/small>/);
  assert.match(h, /<a class="btn btn-small f" data-act="dlsave" data-v="dl-aaaaaaaaaaaa" href="\/venus\/api\/telechargements\/dl-aaaaaaaaaaaa\/fichier" download="Le Phare \(720p\)\.mp4">[^]*Enregistrer<\/a>/);
  assert.match(h, /<div class="dl-row st-working">[^]*Version légère 480p · Préparation[^]*<div class="meter"><i style="width:42%"><\/i><\/div>[^]*<span class="dl-pct">42 %<\/span>/);
  assert.match(h, /<div class="dl-row st-error">[^]*Échec[^]*<small class="error-text">FFmpeg est introuvable pour Odin/);
  assert.equal((h.match(/data-act="dldel"/g) ?? []).length, 3);
  assert.match(h, /aria-label="Supprimer" title="Supprimer" data-act="dldel" data-v="dl-aaaaaaaaaaaa"/);
  await P.cliquer({ act: 'dldel', v: 'dl-aaaaaaaaaaaa' });
  const d = P.appels.find((a) => a.chemin === '/venus/api/telechargements/dl-aaaaaaaaaaaa' && a.methode === 'POST');
  assert.deepEqual(d?.corps, { faire: 'supprimer' });
  await P.aller('#/'); // quitter la page arrête la relecture
});

test('Téléchargements vides : la phrase de Downloads.js', async () => {
  const P = await ouvrir({ repondre: (a) => (a.chemin === '/venus/api/telechargements' ? [] : undefined) });
  await P.aller('#/telechargements'); await attendre(100);
  assert.match(P.app.innerHTML, /Aucun téléchargement\. Sur la fiche d’un film ou d’une saison, touchez « Télécharger »\./);
});

test('« Télécharger » sur une fiche : 720p et 480p sont demandés à Odin', async () => {
  const P = await ouvrir();
  await P.aller('#/titre/film%3Aa'); await attendre(150);
  await P.cliquer({ act: 'dlsheet', v: 'film:a' });
  const f = P.derniereFenetre();
  assert.match(f, /<button class="opt f" type="button" data-act="dlprep" data-v="720p" data-id="film:a">[^]*Version légère 720p[^]*Idéale pour un téléphone ou une tablette · ≈ 1,5 Go/);
  assert.match(f, /data-act="dlprep" data-v="480p" data-id="film:a">[^]*Très légère 480p/);
  assert.match(f, /Les versions légères sont préparées par le serveur, puis disponibles dans « Téléchargements »\./);
  assert.ok(!/disabled/.test(f), 'plus rien de grisé');
  await P.cliquer({ act: 'dlprep', v: '480p', id: 'film:a' });
  const p = P.appels.find((a) => a.chemin === '/venus/api/telechargements' && a.methode === 'POST');
  assert.deepEqual(p?.corps, { itemId: 'film:a', quality: '480p' });
});

test('Séance : rejoindre avec le code de 4 lettres, comme Seance.js ; le code ouvre le titre de la séance', async () => {
  const P = await ouvrir();
  await P.aller('#/seance');
  let h = P.app.innerHTML;
  assert.ok(!h.includes(BIENTOT), 'la page existe');
  assert.match(h, /<div class="together"><form class="panel" data-form="sjoin">/);
  assert.match(h, /<h1 tabindex="-1">Rejoindre une séance<\/h1>/);
  assert.match(h, /<input id="room-code" class="input code-input" maxlength="4" placeholder="ABCD" autocomplete="off" autocapitalize="characters" aria-label="Code de la séance"/);
  assert.match(h, /<div class="together-how"><h2>Lancer votre propre séance<\/h2><ol><li>Lancez un film ou un épisode\.<\/li>/);
  await P.aller('#/seance?code=zzzz'); await attendre(100);
  assert.ok(P.appels.some((a) => a.chemin === '/venus/api/seance/ZZZZ'));
  assert.match(P.app.innerHTML, /<p class="error-text" role="alert">Séance introuvable\.<\/p>/);
  await P.aller('#/seance?code=kmpt'); await attendre(100);
  assert.ok(P.appels.some((a) => a.chemin === '/venus/api/seance/KMPT'));
  h = P.app.innerHTML;
  assert.ok(!/class="error-text" role="alert">[^<]/.test(h), 'aucune erreur');
});

test('Télécommande : choisir l’écran, lecture / pause et ±30 s ; le QR de la télécommande d’Odin pour un autre téléphone', async () => {
  const P = await ouvrir();
  await P.aller('#/telecommande'); await attendre(100);
  let h = P.app.innerHTML;
  assert.ok(!h.includes(BIENTOT), 'la page existe');
  assert.ok(P.appels.some((a) => a.chemin === '/venus/ecrans'));
  assert.match(h, /<div class="remote-page maison">/); assert.match(h, /Choisir l’écran à piloter/);
  assert.match(h, /data-act="rcpick" data-v="media_player\.salon"[^>]*>[^]*Télé du salon/);
  await P.cliquer({ act: 'rcpick', v: 'media_player.salon' });
  h = P.app.innerHTML;
  assert.match(h, /<b>Télécommande<\/b><small>Reliée à l’écran de Télé du salon<\/small>/);
  assert.match(h, /<div class="remote-row media">/); assert.match(h, /<span>−30 s<\/span>/); assert.match(h, /<span>Lecture \/ pause<\/span>/); assert.match(h, /<span>\+30 s<\/span>/);
  await P.cliquer({ act: 'rccmd', v: 'reculer' });
  let c = P.appels.filter((a) => a.chemin === '/venus/ecran/media_player.salon/commande');
  assert.deepEqual(c.at(-1)?.corps, { action: 'reculer', valeur: 30 });
  await P.cliquer({ act: 'rccmd', v: 'lecturepause' });
  c = P.appels.filter((a) => a.chemin === '/venus/ecran/media_player.salon/commande');
  assert.deepEqual(c.at(-1)?.corps, { action: 'basculer' }, 'l’écran bascule lui-même entre lecture et pause (Remote.js : « playpause »)');
  await P.cliquer({ act: 'rcqr' });
  assert.ok(P.appels.some((a) => a.chemin === '/venus/ecran/media_player.salon/qr' && a.methode === 'POST'));
  const f = P.derniereFenetre();
  assert.match(f, /<span role="img" aria-label="QR code de la télécommande"><svg/); assert.match(f, /http:\/\/odin\.test\/t\/abc/);
  await P.cliquer({ act: 'rcchange' });
  assert.match(P.app.innerHTML, /Choisir l’écran à piloter/);
});

test('Télécommande sans box domotique : la phrase d’Odin (sans nom de produit), et où la relier', async () => {
  const P = await ouvrir({ repondre: (a) => (a.chemin === '/venus/ecrans' ? { ecrans: [], message: 'Home Assistant n\'est pas relié.' } : undefined) });
  await P.aller('#/telecommande'); await attendre(100);
  assert.match(P.app.innerHTML, /Aucune box domotique n’est reliée à Odin : aucun écran à piloter\. Reliez-la dans Midgard, « Relier une box »\./);
});

test('en anglais : Séance, Télécommande et Téléchargements sont traduits', async () => {
  const P = await ouvrir({ lang: 'en' });
  await P.aller('#/seance');
  let h = P.app.innerHTML;
  assert.match(h, /Join a watch party/); assert.match(h, /Start your own watch party/);
  for (const fr of ['Rejoindre une séance', 'Lancez un film']) assert.ok(!h.includes(fr), `reste en français : ${fr}`);
  await P.aller('#/telecommande'); await attendre(100);
  h = P.app.innerHTML;
  assert.match(h, /Remote/); assert.match(h, /Choose the screen to control/);
  await P.aller('#/telechargements'); await attendre(100);
  h = P.app.innerHTML;
  assert.match(h, /Light version 720p · Ready/); assert.match(h, />Save</); assert.match(h, /Preparing/); assert.match(h, /Failed/);
  assert.match(h, /FFmpeg cannot be found/);
  for (const fr of ['Prêt', 'Préparation', 'Enregistrer', 'Échec']) assert.ok(!h.includes(fr), `reste en français : ${fr}`);
  await P.aller('#/');
});
