// Vénus, la maison (lot V8), après relecture : « Terminées cette année » ne compte une série que l'année où elle a
// été finie ; les textes du lot ont leur anglais ; la fenêtre du vote s'ouvre par son haut ; le bouton
// « Supprimer » d'une confirmation se lit en clair ; les cibles et vignettes des collections, des listes et de la
// fenêtre « Télécharger » tiennent à 390 px. Aucun réseau, aucun serveur : magasin de Vénus en fichiers, page en vm.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import vm from 'node:vm';
import { dirVenus, magasinVenus, oublierMagasins } from '../src/valhalla/venus/base.ts';
import { statistiques } from '../src/valhalla/venus/stats.ts';

const APP = new URL('../src/valhalla/venus/app/', import.meta.url);
const JS = readFileSync(new URL('app.js', APP), 'utf8');
const CSS = readFileSync(new URL('css/app.css', APP), 'utf8');
const quand = (an: number, mois: number, jour: number) => new Date(an, mois, jour, 21, 0, 0).getTime();

/** Les déclarations d'une règle de la feuille qui vise exactement `sel` (dans sa liste de sélecteurs), mises bout à bout. */
function regle(sel: string): string {
  const plat = CSS.replace(/\/\*[\s\S]*?\*\//g, '');
  const out: string[] = [];
  for (const m of plat.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (m[1].split(',').map((x) => x.trim().replace(/\s+/g, ' ')).includes(sel)) out.push(m[2]);
  }
  return out.join(';').replace(/\s+/g, ' ');
}

test('statistiques : une série finie l’année d’après n’est pas « terminée » l’année où elle a été commencée', () => {
  const home = mkdtempSync(join(tmpdir(), 'venus-v8r-'));
  try {
    oublierMagasins(); const m = magasinVenus(home, dirVenus(home));
    m.poser('oeuvres', 'serie:s', { type: 'serie', titre: 'Les Îles', fiche: { source: 'films', genres: ['Drame'], distribution: [], equipe: [], quand: 1 } });
    for (let e = 1; e <= 3; e++) m.poser('episodes', `serie:s:s1e${e}`, { oeuvre_id: 'serie:s', saison: 1, episode: e, titre: 'Les Îles', fichier: `s${e}.mp4`, duree: 2700 });
    const lu = (cible: string, maj: number) => m.poser('reprise', `moi:${cible}`, { profil: 'moi', cible_id: cible, type: 'video', position_s: 2700, duree_s: 2700, maj });
    lu('serie:s:s1e1', quand(2025, 10, 2)); lu('serie:s:s1e2', quand(2025, 10, 3)); // commencée en 2025
    lu('serie:s:s1e3', quand(2026, 0, 4));                                          // finie en 2026
    assert.deepEqual(statistiques(m, 'moi', 2025).completedShows.map((x) => x.id), [], 'pas finie en 2025');
    assert.deepEqual(statistiques(m, 'moi', 2026).completedShows.map((x) => x.id), ['serie:s'], 'finie en 2026');
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test('anglais : les textes du lot restés en français ont leur traduction', () => {
  const win: Record<string, unknown> = { navigator: { language: 'en-US' }, addEventListener() {}, location: { hash: '#/' } };
  const doc = { documentElement: { lang: 'en', dataset: {}, style: { setProperty() {} }, classList: { toggle() {}, add() {} } }, getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], addEventListener() {} };
  const ctx = vm.createContext({ ...win, window: win, document: doc, URLSearchParams, Intl, setTimeout, clearTimeout });
  vm.runInContext(readFileSync(new URL('planetes.js', APP), 'utf8'), ctx); vm.runInContext(JS, ctx);
  const t = (win as { VenusApp: { t: (k: string, v?: Record<string, unknown>) => string } }).VenusApp.t;
  assert.equal(t('Suivant'), 'Next');
  assert.equal(t('Ajouté récemment'), 'Recently added');
  assert.equal(t('{n} ép.', { n: '12' }), '12 ep.');
  assert.equal(t('Type'), 'Type');
  assert.ok(/'Type': 'Type'/.test(JS), '« Type » est dans le dictionnaire anglais (pas un repli sur la clé)');
});

test('la ligne de la langue de la page est celle d’avant le lot (aucune retouche gratuite)', () => {
  assert.match(JS, /\n {2}const LANG = String\(\(D && D\.documentElement\.lang\)/);
});

test('fenêtre du vote : elle s’ouvre par son haut (titre et QR visibles au téléphone)', () => {
  const corps = JS.slice(JS.indexOf('async function startVote'), JS.indexOf('function suivreVoteTel'));
  assert.match(corps, /\.focus\(\{ preventScroll: true \}\)/, 'le focus va sur la fenêtre sans la faire défiler');
  assert.match(corps, /scrollTop = 0/, 'la fenêtre revient en haut');
});

test('confirmation « Supprimer » : le bouton plein (lisible en clair), pas le texte saumon', () => {
  const corps = JS.slice(JS.indexOf('function confirmer('), JS.indexOf('async function ajouterA'));
  assert.match(corps, /btn btn-danger-solid f" data-act="confok"/);
  assert.match(regle('.btn-danger-solid'), /background: ?#d93a3d; ?color: ?#fff/);
});

test('affichage à 390 px : « Retirer » 44 px, vignettes des listes, ligne 720p à gauche, « Ajouter à… » lisible, titres sans « ? » seul', () => {
  assert.match(regle('.maison .coll-x'), /width: ?44px; ?height: ?44px/);
  const ph = regle('.pl-thumb .ph');
  for (const d of ['align-items: center', 'justify-content: center', 'overflow: hidden', 'overflow-wrap: break-word']) assert.ok(ph.includes(d), d);
  assert.match(regle('.sheet .dl-choices .opt small'), /margin-left: ?0; ?text-align: ?left/, 'plus précis que « .sheet .opt small » d’odin.css (à droite)');
  assert.match(regle('.pl-thumb .ph span'), /-webkit-line-clamp: ?3/);
  assert.match(JS, /const ph = \(title\) => `<div class="ph" style="--h:\$\{hueOf\(title\)\}"><span>/);
  assert.match(JS, /openSheet\(t\('Ajouter « \{t\} »', \{ t: item\.title \}\), `<div class="add-to">/);
  assert.match(regle('.add-to .opt small'), /color: ?var\(--haze\)/);
  assert.match(regle('.vote-intro h1'), /text-wrap: ?balance/);
  assert.match(regle('.together .section-title'), /text-wrap: ?balance/);
});
