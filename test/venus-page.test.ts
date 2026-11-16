// La page de Vénus (src/web/pages/venus.js, venus-lecteur.js, venus-youtube.js) : elle se charge sans navigateur,
// pose ses objets, garde le lecteur de livres Odyssée (chaînage), montre ses onglets, et sa logique pure est juste
// (adresses des routes /venus/*, disposition 390 px / 1280 px, affiches locales seulement). Contrôles de sûreté :
// aucune fenêtre native (OdinDialog), aucun appel à un serveur extérieur, aucun secret, tout passe par Odin.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const lire = (f: string) => readFileSync(new URL(`../src/web/pages/${f}`, import.meta.url), 'utf8');
const FICHIERS = ['venus-lecteur.js', 'venus-telecommande.js', 'venus-youtube.js', 'venus.js'];
const SRC: Record<string, string> = Object.fromEntries(FICHIERS.map((f) => [f, lire(f)]));

interface Win {
  OdinPages: Record<string, unknown>;
  OdinVenus?: { logique: Record<string, (...a: unknown[]) => unknown>; suitePrecedente: unknown };
  OdinVenusLecteur?: { logique: Record<string, (...a: unknown[]) => unknown> };
  OdinVenusYoutube?: { logique: Record<string, (...a: unknown[]) => unknown> };
  OdinVenusTelecommande?: unknown;
}

/** Charge les quatre fichiers dans un contexte vide, avec un ancien gestionnaire « freyja » déjà posé (Odyssée). */
function charger(prev: unknown = () => 'odyssee'): Win {
  const win: Win = { OdinPages: { freyja: prev } };
  const ctx = vm.createContext({ window: win, URLSearchParams });
  // Ni document ni fetch ni location : un accès au chargement ferait échouer ces lignes.
  for (const f of FICHIERS) vm.runInContext(SRC[f], ctx, { filename: f });
  return win;
}

test('chargement : les objets de la page sont posés, et le lecteur de livres (Odyssée) est gardé par chaînage', () => {
  const sentinelle = () => 'odyssee-garde';
  const win = charger(sentinelle);
  assert.equal(typeof win.OdinPages.freyja, 'function', 'la page de Vénus prend la main sur freyja');
  assert.notEqual(win.OdinPages.freyja, sentinelle, 'un nouveau gestionnaire, pas l\'ancien');
  assert.equal(win.OdinVenus?.suitePrecedente, sentinelle, 'l\'ancien gestionnaire (Odyssée) est gardé pour être greffé');
  for (const g of ['OdinVenus', 'OdinVenusLecteur', 'OdinVenusYoutube', 'OdinVenusTelecommande'] as const) assert.ok(win[g], g);
  // La page appelle bien l'ancien gestionnaire avec un hôte (le lecteur de livres reste dans Odéon).
  assert.match(SRC['venus.js'], /suite\(\{ \.\.\.ctx, host: livres \}\)/);
});

test('onglets : Odéon, YouTube, Écrans, Acquisition, État, et la page prend toute la place', () => {
  const t = SRC['venus.js'];
  for (const lab of ['Odéon', 'YouTube', 'Écrans', 'Acquisition', 'État']) assert.ok(t.includes(`'${lab}'`), `onglet ${lab}`);
  assert.match(t, /role: 'tablist'/);
  assert.match(t, /return true;/, 'la page remplace la page générique du module');
  // Catégories d'Odéon : films, séries, musique, livres audio.
  for (const c of ['Films', 'Séries', 'Musique', 'Livres audio']) assert.ok(t.includes(`'${c}'`), `catégorie ${c}`);
});

test('disposition : « etroit » à 390 px (téléphone), « large » à 1280 px (ordinateur), et CSS responsive', () => {
  const { logique } = charger().OdinVenus!;
  assert.equal(logique.dispo(390), 'etroit');
  assert.equal(logique.dispo(1280), 'large');
  assert.equal(logique.dispo(700), 'large');
  assert.match(SRC['venus.js'], /@media \(pointer:coarse\)/, 'cibles tactiles agrandies');
  assert.match(SRC['venus.js'], /@media \(max-width:420px\)/, 'rupture pour le téléphone');
});

test('adresses des routes : tout chez Odin (/venus/*, /api/valhalla/act), jamais un serveur extérieur', () => {
  const V = charger().OdinVenus!.logique, Y = charger().OdinVenusYoutube!.logique, L = charger().OdinVenusLecteur!.logique;
  assert.equal(V.bibliothequeUrl('film', 'xmen'), '/venus/bibliotheque?type=film&q=xmen');
  assert.equal(V.bibliothequeUrl('', ''), '/venus/bibliotheque');
  assert.equal(V.ecransUrl(), '/venus/ecrans');
  assert.equal(Y.accueilUrl(), '/venus/yt/accueil');
  assert.equal(Y.segmentsUrl('abc'), '/venus/yt/segments/abc');
  assert.equal(Y.rechercheUrl('a b'), '/venus/yt/recherche?q=a%20b');
  assert.equal(L.fluxUrl({ id: '7' }), '/venus/flux/7');
  // Toute adresse renvoyée par la logique commence par une route locale d'Odin.
  for (const u of [V.bibliothequeUrl('serie'), V.detailUrl('9'), V.ecransUrl(), Y.accueilUrl(), Y.videoUrl('x'), Y.chaineUrl('c'), Y.abonnementsUrl(), Y.historiqueUrl(), Y.segmentsUrl('z'), L.fluxUrl({ id: '1' }), L.sousTitresUrl('1', 'fr'), L.vignetteUrl('1')]) assert.match(String(u), /^\/(venus|api|t)\//, String(u));
});

test('affiches de la bibliothèque : seulement locales (Odin) ; jamais une image chargée d\'un serveur tiers', () => {
  const V = charger().OdinVenus!.logique, Y = charger().OdinVenusYoutube!.logique;
  assert.equal(V.afficheLocale({ affiche: '/venus/vignette/1' }), '/venus/vignette/1');
  assert.equal(V.afficheLocale({ affiche: 'data:image/png;base64,AAAA' }), 'data:image/png;base64,AAAA');
  assert.equal(V.afficheLocale({ affiche: 'http://exemple.invalid/a.png' }), null, 'la bibliothèque ne charge aucune image extérieure');
  assert.equal(V.afficheLocale({ affiche: 'https://img.youtube.com/x.jpg' }), null);
  // YouTube : la miniature vient de l'instance choisie (le flux YouTube passe déjà par elle) ; on la rend telle quelle.
  assert.equal(Y.miniature({ miniature: '' }), null);
  assert.equal(Y.miniature({ miniature: '/venus/yt/vignette/9' }), '/venus/yt/vignette/9');
});

test('lecteur : reprise raisonnable, note de reprise sans secret, saut des segments sponsor', () => {
  const L = charger().OdinVenusLecteur!.logique;
  assert.equal(L.doitReprendre(120, 3600), true, 'bien engagé : on reprend');
  assert.equal(L.doitReprendre(5, 3600), false, 'à peine commencé : non');
  assert.equal(L.doitReprendre(3500, 3600), false, 'quasi fini : non');
  assert.deepEqual({ ...(L.corpsReprise({ id: '9', type: 'film' }, 123.7, 3600) as object) }, { cible: '9', type: 'film', position_s: 123, duree_s: 3600 });
  assert.equal(L.prochainSaut(12, [{ debut: 10, fin: 20 }]), 20, 'dans un segment : on saute à la fin');
  assert.equal(L.prochainSaut(25, [{ debut: 10, fin: 20 }]), null, 'hors segment : rien');
  assert.equal(L.prochainSaut(5, []), null);
});

test('YouTube : durées et vues lisibles, et la note dit sobrement droit d\'auteur et alternatives', () => {
  const Y = charger().OdinVenusYoutube!.logique;
  assert.equal(Y.duree(65), '1:05');
  assert.equal(Y.duree(3725), '1:02:05');
  assert.match(String(Y.vues(1_250_000)), /1,3 M vues/);
  assert.match(String(Y.vues(8_340)), /8 k vues/);
  // Lecture : on choisit un flux combiné (son + image) lisible dans le navigateur.
  assert.equal(Y.choisirFlux([{ url: 'a', type: 'video' }, { url: 'b', type: 'mixte' }]), 'b');
  assert.equal(Y.choisirFlux([{ url: 'a', type: 'video' }, { url: 'c', type: 'audio' }]), 'a');
  assert.equal(Y.choisirFlux([]), null);
  const t = SRC['venus-youtube.js'];
  assert.match(t, /droit d'auteur/i);
  for (const a of ['FreeTube', 'NewPipe', 'Invidious', 'Piped']) assert.ok(t.includes(a), `alternative ${a}`);
  assert.equal(t.match(/droit d'auteur/gi)?.length, 1, 'le droit d\'auteur est dit une seule fois');
});

test('sûreté : aucune fenêtre native, aucun secret, aucune adresse extérieure, aucun stockage navigateur', () => {
  for (const f of FICHIERS) {
    const S = SRC[f];
    assert.doesNotMatch(S, /(?<!OdinDialog\.)\b(alert|confirm|prompt)\(/, `${f} : pas de fenêtre native (OdinDialog seulement)`);
    assert.doesNotMatch(S, /x-api-key|VENUS_API_KEY|venusApi|rejectUnauthorized/, `${f} : aucun secret ni appel direct au serveur Venus`);
    assert.doesNotMatch(S, /localStorage|sessionStorage|indexedDB/i, `${f} : rien gardé dans le navigateur`);
    // Aucune adresse réseau extérieure (l'espace de noms SVG de w3.org n'est pas un appel réseau).
    for (const m of S.matchAll(/https?:\/\/[^\s'"`]*/g)) assert.equal(m[0], 'http://www.w3.org/2000/svg', `${f} : adresse extérieure ${m[0]}`);
    // Tout fetch() avec une adresse en clair vise une route locale d'Odin.
    for (const m of S.matchAll(/fetch\(\s*['"`]([^'"`]*)/g)) assert.match(m[1], /^\/(api|venus|t)\//, `${f} : fetch ${m[1]}`);
  }
  // Les confirmations existent et passent par OdinDialog (ou une confirmation intégrée sans fenêtre native).
  assert.match(SRC['venus-youtube.js'], /OdinDialog\.confirm/);
  assert.match(SRC['venus-telecommande.js'], /OdinDialog\.confirm/);
});
