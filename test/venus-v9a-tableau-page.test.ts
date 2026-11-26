// Vénus, l'administration, première part : la page du tableau de bord (pages/Dashboard.js du dépôt Venus), sans
// navigateur. Les données servies à la page sont celles qu'un Odin jetable calcule (entretien.ts) à partir d'une
// bibliothèque d'essai, d'une lecture en cours et d'un téléchargement rangé. Avant ce lot, « Tableau de bord »
// disait « Cette partie de Venus arrive dans Odin avec un prochain lot. ».
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import vm from 'node:vm';
import { dirVenus, magasinVenus, oublierMagasins } from '../src/valhalla/venus/base.ts';
import { ajouterDossier, noterReprise } from '../src/valhalla/venus/bibliotheque.ts';
import { noter } from '../src/valhalla/venus/comete/index.ts';
import * as E from '../src/valhalla/venus/entretien.ts';

const APP = new URL('../src/valhalla/venus/app/', import.meta.url);
const SRC = { planetes: readFileSync(new URL('planetes.js', APP), 'utf8'), app: readFileSync(new URL('app.js', APP), 'utf8') };
type Fn = (...a: unknown[]) => unknown;
const attendre = (ms = 60) => new Promise((r) => setTimeout(r, ms));
const BIENTOT = 'Cette partie de Venus arrive dans Odin avec un prochain lot.';
const ADMIN = { id: 'moi', name: 'Maison', isAdmin: true, avatar: 0 };
const TITRES = [{ id: 'film:a', type: 'movie', category: 'movie', title: 'Le Phare', year: 2020, status: 'unseen', added: 1, played: 0, inList: false, play: { id: 'film:a', position: 0 } }];

/** Les données d'un Odin jetable : un film, une série, une lecture en cours, un téléchargement rangé, deux dossiers. */
function donnees(vide = false): { d: E.Tableau; media: string } {
  const home = mkdtempSync(join(tmpdir(), 'venus-v9a-page-')), media = mkdtempSync(join(tmpdir(), 'venus-v9a-media-'));
  try {
    oublierMagasins(); E.reglerSourcesSante({ cpus: () => [], memTotale: () => 8e9, memLibre: () => 6e9, place: () => undefined });
    const m = magasinVenus(home, dirVenus(home));
    if (!vide) {
      const films = join(media, 'films'); mkdirSync(films);
      const f = join(films, 'Le Phare (2020).mkv'); writeFileSync(f, 'x');
      m.poser('fichiers', f.replace(/[^A-Za-z0-9_.:-]/g, '_').slice(-199), { chemin: f, taille: 2_000_000_000, mtime: 1 });
      m.poser('oeuvres', 'film:a', { type: 'film', titre: 'Le Phare', annee: 2020, duree: 6000, fichier: f });
      ajouterDossier(m, films, 'films'); ajouterDossier(m, join(media, 'debranche'), 'series');
      noterReprise(m, 'moi', 'film:a', 600, 6000);
      noter(m, 'terminé', { id: 't1', titre: 'Les Îles S01E02' }, '1 octets');
      m.poser('ecrans', 'media_player.salon', { nom: 'Télé de la véranda', type: 'tv', vu: Date.now() - 60_000 });
    }
    return { d: E.tableau(m, home), media };
  } finally { E.reglerSourcesSante(); oublierMagasins(); rmSync(home, { recursive: true, force: true }); }
}

interface Appel { chemin: string; methode: string; xodin?: string }
// Le tableau de bord se relit toutes les 4 s tant qu'il est à l'écran : à la fin, chaque page ouverte le quitte.
const quitter: Array<() => void> = [];
after(() => { for (const q of quitter) q(); });
async function ouvrir(o: { lang?: string; hash?: string; profils?: Array<Record<string, unknown>>; tableau?: unknown } = {}) {
  const appels: Appel[] = [], ecouteurs: Record<string, Fn[]> = {};
  const on = (k: string, f: Fn) => { (ecouteurs[k] ??= []).push(f); };
  const app = { innerHTML: '', removeAttribute() {} };
  const elFaux = (): Record<string, unknown> => ({ className: '', style: {}, dataset: {}, classList: { add() {}, toggle() {}, remove() {} }, setAttribute() {}, addEventListener() {}, remove() {}, append() {}, querySelector: () => ({ focus() {} }), querySelectorAll: () => [], focus() {}, innerHTML: '' });
  const root = { lang: o.lang ?? 'fr', dataset: {} as Record<string, string>, style: { setProperty() {} }, classList: { toggle() {}, add() {} } };
  const location = { hash: o.hash ?? '#/', href: 'http://127.0.0.1/venus/app/' };
  const doc: Record<string, unknown> = {
    documentElement: root, body: elFaux(), title: '', styleSheets: [], cookie: '', hidden: false,
    getElementById: (id: string) => (id === 'app' ? app : null), querySelector: (s: string) => (s === '#app' ? app : null), querySelectorAll: () => [],
    createElement: elFaux, addEventListener: on, contains: () => false, activeElement: null,
  };
  const rep = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json' } });
  const win: Record<string, unknown> = {
    navigator: { language: o.lang ?? 'fr-FR' }, addEventListener: on, location, scrollY: 0, innerWidth: 1280, innerHeight: 800,
    history: { length: 1, replaceState: (_a: unknown, _b: unknown, h: string) => { location.hash = h; }, back() {} },
    scrollTo() {}, requestAnimationFrame: (f: Fn) => setTimeout(f, 0), matchMedia: (q: string) => ({ matches: /reduced-motion/.test(q), addEventListener() {} }),
    fetch: async (chemin: string, x: { method?: string; headers?: Record<string, string> } = {}) => {
      appels.push({ chemin, methode: x.method ?? 'GET', xodin: x.headers?.['x-odin'] });
      if (chemin === '/venus/api/profils') return rep({ profils: o.profils ?? [ADMIN], actuel: String((o.profils ?? [ADMIN])[0].id), choisi: true });
      if (chemin === '/venus/api/preferences') return rep({ preferences: {} });
      if (chemin === '/venus/api/catalogue') return rep({ titres: TITRES });
      if (chemin === '/venus/api/tableau') return rep(o.tableau ?? {}, o.tableau ? 200 : 403);
      if (chemin === '/venus/scan') return rep({ bilan: { oeuvres: 0 } });
      return rep({});
    },
  };
  const ctx = vm.createContext({ ...win, window: win, document: doc, URLSearchParams, Intl, setTimeout, clearTimeout, MutationObserver: class { observe() {} disconnect() {} } });
  vm.runInContext(SRC.planetes, ctx); vm.runInContext(SRC.app, ctx);
  quitter.push(() => { location.hash = '#/'; for (const f of ecouteurs.hashchange ?? []) f(); });
  for (let k = 0; k < 100; k++) { await attendre(20); if (app.innerHTML && !/aria-busy="true"/.test(app.innerHTML)) break; }
  return {
    app, appels, location,
    async aller(h: string) { location.hash = h; for (const f of ecouteurs.hashchange ?? []) f(); for (let k = 0; k < 50; k++) { await attendre(20); if (!/aria-busy="true"/.test(app.innerHTML)) break; } },
    async cliquer(data: Record<string, string>) {
      const el = { dataset: data, closest: (s: string) => (s === '[data-act]' ? el : null), getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 10, right: 100, bottom: 10 }), classList: { toggle() {} }, setAttribute() {}, parentElement: { querySelector: () => null } };
      for (const f of ecouteurs.click ?? []) await f({ target: el, clientX: 80, preventDefault() {}, stopPropagation() {} });
      await attendre(120);
    },
  };
}
const texte = (h: string) => h.replace(/<[^>]+>/g, ' ').replace(/&nbsp;|\s+/g, ' ');

test('le tableau de bord est construit : rubriques de Dashboard.js, mêmes classes, même ordre ; les outils dont la page existe', async () => {
  const { d } = donnees();
  const p = await ouvrir({ hash: '#/dashboard', tableau: d });
  const h = p.app.innerHTML;
  assert.ok(!h.includes(BIENTOT), 'la page existe');
  assert.match(h, /<div class="page dash">/); assert.match(h, /class="dash-head"/); assert.match(h, /class="set-layout dash-layout"/);
  const t = texte(h);
  const ordre = ['Tableau de bord', 'Suivi', 'Aperçu', 'En ce moment', 'Appareils', 'Activité', 'Serveur', 'Santé', 'Tâches de fond', 'Médiathèques', 'Outils', 'Statistiques', 'Réglages'];
  let i = 0; for (const x of ordre) { const j = t.indexOf(x, i); assert.ok(j >= 0, `« ${x} » à sa place`); i = j; }
  // (deuxième part du lot V9) La page Qualité existe : son lien « Qualité » est apparu en tête des outils, comme dans
  // Dashboard.js ; les autres restent absents tant que leur page n'existe pas.
  for (const absent of ['Sécurité', 'Mises à jour et journaux', 'Code de connexion', 'Déconnecter cet appareil', 'Redémarrer', 'Message à tous']) assert.ok(!t.includes(absent), `pas de « ${absent} » (pas encore dans Odin)`);
  assert.match(h, /href="#\/qualite"/); assert.match(h, /href="#\/stats"/); assert.match(h, /href="#\/reglages"/);
  assert.match(h, /data-act="dashscan"/, '« Analyser »');
  assert.ok(p.appels.some((a) => a.chemin === '/venus/api/tableau'));
});

test('Aperçu : les vrais comptes, la lecture en cours ; aucune adresse IP', async () => {
  const { d } = donnees();
  const p = await ouvrir({ hash: '#/dashboard', tableau: d });
  const h = p.app.innerHTML, t = texte(h);
  assert.match(h, /<a class="kpi k-blue f" href="#\/films"><span class="kpi-ic">.*?<\/span><b>1<\/b><span>Films<\/span><\/a>/);
  assert.match(h, /<b>0<\/b><span>Séries<\/span>/, 'un compte à zéro s’affiche zéro');
  assert.match(t, /Stockage/); assert.match(t, /0 épisode/);
  assert.match(h, /class="np-title f" href="#\/titre\/film%3Aa">Le Phare</);
  assert.match(t, /Maison/); assert.match(t, /10:00 \/ 1:40:00/);
  assert.ok(!/\b\d{1,3}(?:\.\d{1,3}){3}\b/.test(h), 'jamais une adresse IP');
});

test('chaque rubrique rend ses données ; la rubrique tient dans l’adresse et au rechargement', async () => {
  const { d, media } = donnees();
  const p = await ouvrir({ hash: '#/dashboard', tableau: d });
  await p.cliquer({ act: 'dashtab', v: 'activite' });
  assert.equal(p.location.hash, '#/dashboard?tab=activite');
  let t = texte(p.app.innerHTML);
  assert.match(t, /Activité récente/); assert.match(t, /Comète : « Les Îles S01E02 » téléchargé et rangé/);
  await p.cliquer({ act: 'dashtab', v: 'appareils' }); t = texte(p.app.innerHTML);
  assert.match(t, /Télé de la véranda/); assert.ok(!/Code de connexion/.test(t));
  await p.cliquer({ act: 'dashtab', v: 'taches' }); t = texte(p.app.innerHTML);
  assert.match(t, /Tâches de fond/);
  await p.cliquer({ act: 'dashtab', v: 'medias' });
  const hm = p.app.innerHTML; t = texte(hm);
  assert.match(hm, /href="#\/reglages\?tab=medias"/, '« Gérer » mène aux Réglages → Médiathèques');
  assert.ok(t.includes(join(media, 'films')), 'le dossier, pour l’administrateur'); assert.match(hm, /dev-dot bad/);
  await p.cliquer({ act: 'dashtab', v: 'sante' }); t = texte(p.app.innerHTML);
  assert.match(t, /Santé du serveur/); assert.match(t, /Processeur.*Source absente/);
  assert.ok(!/>0 %</.test(p.app.innerHTML), 'jamais 0 % sans source');
  assert.match(t, /Mémoire/); assert.match(p.app.innerHTML, /--p:25/);
  await p.cliquer({ act: 'dashtab', v: 'apercu' }); assert.equal(p.location.hash, '#/dashboard');
  // Rechargement sur une rubrique : elle est choisie.
  const q = await ouvrir({ hash: '#/dashboard?tab=lectures', tableau: d });
  assert.match(q.app.innerHTML, /class="set-tab f on" aria-current="page" data-act="dashtab" data-v="lectures"/);
  rmSync(media, { recursive: true, force: true });
});

test('une bibliothèque vide : zéro, « Personne ne regarde en ce moment. », rien d’inventé', async () => {
  const { d } = donnees(true);
  const p = await ouvrir({ hash: '#/dashboard', tableau: d });
  const t = texte(p.app.innerHTML);
  assert.match(p.app.innerHTML, /<b>0<\/b><span>Films<\/span>/);
  assert.match(t, /Personne ne regarde en ce moment\./);
  await p.cliquer({ act: 'dashtab', v: 'activite' });
  assert.match(texte(p.app.innerHTML), /Rien pour l’instant/);
});

test('un profil enfant n’a ni l’entrée ni la page ; un autre profil voit « Réservé à l’administrateur » sans rien lire', async () => {
  let p = await ouvrir({ hash: '#/dashboard', profils: [{ id: 'p:noe', name: 'Noé', avatar: 2, isKids: true }] });
  assert.ok(!p.app.innerHTML.includes('#/dashboard'), 'aucune entrée');
  assert.ok(!texte(p.app.innerHTML).includes('Tableau de bord'));
  assert.ok(!p.appels.some((a) => a.chemin === '/venus/api/tableau'));
  p = await ouvrir({ hash: '#/dashboard', profils: [{ id: 'p:lou', name: 'Lou', avatar: 1 }] });
  assert.match(texte(p.app.innerHTML), /Réservé à l’administrateur/);
  assert.ok(!p.appels.some((a) => a.chemin === '/venus/api/tableau'), 'rien n’est demandé à Odin');
});

test('en anglais : les rubriques et les textes du tableau de bord', async () => {
  const { d } = donnees();
  const p = await ouvrir({ hash: '#/dashboard', tableau: d, lang: 'en' });
  const t = texte(p.app.innerHTML);
  for (const x of ['Dashboard', 'Monitoring', 'Overview', 'Now playing', 'Devices', 'Activity', 'Server', 'Health', 'Background tasks', 'Libraries', 'Tools', 'Statistics', 'Settings', 'Scan', 'Movies', 'Storage']) assert.ok(t.includes(x), x);
  for (const x of ['Tableau de bord', 'Aperçu', 'Tâches de fond', 'Personne ne regarde', 'Stockage', 'en ligne depuis']) assert.ok(!t.includes(x), `pas de français : ${x}`);
});

test('« Analyser » lance l’analyse qui existe (POST /venus/scan), avec l’en-tête x-odin', async () => {
  const { d } = donnees();
  const p = await ouvrir({ hash: '#/dashboard', tableau: d });
  await p.cliquer({ act: 'dashscan' });
  assert.ok(p.appels.some((a) => a.chemin === '/venus/scan' && a.methode === 'POST' && a.xodin === '1'));
});

test('la pastille de l’en-tête n’affirme rien qu’Odin n’a pas mesuré', async () => {
  const { d } = donnees();
  // Ici le processeur et les disques sont « source absente », et aucun souci connu : ni « Tout va bien », ni pastille verte.
  let p = await ouvrir({ hash: '#/dashboard', tableau: { ...d, libraries: d.libraries.filter((l) => l.exists) } });
  assert.ok(!/status-chip good/.test(p.app.innerHTML), 'pas de pastille verte sans mesure');
  assert.ok(!texte(p.app.innerHTML).includes('Tout va bien'));
  // Toutes les mesures connues et rien à signaler : « Tout va bien ».
  const mesure = { ...d, libraries: d.libraries.filter((l) => l.exists), system: { cpu: { pct: 10, cores: 2, model: 'Processeur d’essai' }, mem: { total: 8e9, free: 6e9 }, disks: [{ total: 1e12, free: 5e11, categories: ['films'] }] } };
  p = await ouvrir({ hash: '#/dashboard', tableau: mesure });
  assert.match(p.app.innerHTML, /status-chip good/); assert.ok(texte(p.app.innerHTML).includes('Tout va bien'));
  // Un souci connu (un dossier introuvable) se dit même si une mesure manque.
  const souci = { ...d, system: { ...d.system, cpu: { absent: 'aucune' } } };
  p = await ouvrir({ hash: '#/dashboard', tableau: souci });
  assert.match(p.app.innerHTML, /status-chip bad/); assert.match(texte(p.app.innerHTML), /1 médiathèque introuvable/);
});

test('en anglais : la conversion d’une lecture et la durée en ligne ont leur traduction', async () => {
  const { d } = donnees();
  const conv = { ...d, server: { ...d.server, uptime: 3 * 3600 + 5 * 60 }, playing: d.playing.map((x) => ({ ...x, mode: 'transcode' })), transcodes: 1 };
  const p = await ouvrir({ hash: '#/dashboard?tab=lectures', tableau: conv, lang: 'en' });
  const t = texte(p.app.innerHTML);
  assert.match(t, /Transcoding/); assert.match(t, /1 transcode\b/); assert.match(t, /up for 3 h 5 min/);
  assert.ok(!/[Cc]onversion/.test(t), 'pas de français : conversion');
});
