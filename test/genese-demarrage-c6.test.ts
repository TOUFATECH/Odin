// Genèse · lots C6 et S10 (maquettes validées « Clés USB · Démarrage » et « Systèmes · Démarrage ») : l'écran de
// démarrage GRAPHIQUE, le même pour la clé ODIN et pour le démarrage par le réseau. On vérifie : l'arrivée d'Odin
// (il dort, sursaute, se déplace, est content) avec les formes EXACTES de face.js ; les systèmes dans l'ordre
// choisi ; la seule ligne qui change (« depuis la clé » / « par le réseau ») ; « Installer pour moi » seulement par
// le réseau ; un même thème pour les deux ; aucune donnée personnelle dans ce qui est servi ; le clavier.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { ecranPage } from '../src/valhalla/thjalfi/ecran-page.ts';
import { buildEcranOffline, etatPourCle } from '../src/valhalla/thjalfi/ecran-offline.ts';
import { apparencePour, ecranDemarrage, ligneBarre, modesPour, ordonnerSystemes, sequenceArrivee } from '../src/valhalla/thjalfi/ecrans-communs.ts';

const lire = (chemin: string) => readFileSync(new URL(`../${chemin}`, import.meta.url), 'utf8');

test('arrivée d\'Odin : il dort (zzz), sursaute (!), se déplace par petits sauts, puis il est content (♥)', () => {
  const s = sequenceArrivee();
  assert.deepEqual(s.map((e) => [e.pose, e.marque]), [['sommeil', 'zzz'], ['surprise', '!'], ['neutre', ''], ['amour', '♥'], ['joie', '']]);
  assert.equal(s.filter((e) => e.marche).length, 1, 'une seule mise en marche');
  assert.equal(s.find((e) => e.marche)!.pose, 'neutre', 'il se déplace après s\'être réveillé');
  for (let i = 1; i < s.length; i++) assert.ok(s[i].a > s[i - 1].a, 'les étapes se suivent dans le temps');
  assert.ok(ecranDemarrage().DUREE > s.at(-1)!.a, 'le menu vient après la dernière émotion');
  const p = ecranPage();
  // Le décor de l'arrivée : la marque ODIN, Odin (toutes ses émotions dessinées), les 3 points, la ligne sur un panneau.
  assert.match(p, /<span class="mark">ODIN<\/span>/);
  assert.match(p, /<div class="oa-walker" id="walker" data-pose="sommeil" data-marque="zzz">/);
  for (const g of ['oa-y-neutre', 'oa-y-ferme', 'oa-y-sourit', 'oa-m-zzz', 'oa-m-ex', 'oa-m-coeur']) assert.ok(p.includes(`class="oa-y ${g}"`) || p.includes(`class="oa-m ${g}"`), g);
  assert.match(p, /class="od-points"><i><\/i><i><\/i><i><\/i>/, 'les trois points de chargement');
  assert.match(p, /\.premier \.line\{[^}]*background:var\(--p\)/, 'la ligne est posée sur un panneau, pas sur le décor');
  assert.match(p, /oa-walker\.marche\{animation:oa-marche/, 'il se déplace');
  // « Moins d'animations » : aucune animation dans l'écran, et Odin posé directement, content.
  assert.match(p, /@media \(prefers-reduced-motion:reduce\)\{\.oe \*,\.oe \*::before,\.oe \*::after\{animation:none!important;transition:none!important\}/);
  assert.match(p, /if \(reduit\(\)\) \{ w\.className = 'oa-walker'; w\.dataset\.pose = 'joie';/);
});

test('arrivée d\'Odin : ses yeux et ses marques sont EXACTEMENT ceux de face.js (yeux seuls, blancs)', () => {
  const window: { OdinFace?: { dessin(id: string): { yeux: string[]; extras: string; bouche: string; sourcils: string; joues: string } } } = {};
  runInNewContext(lire('src/web/face.js'), { window, setTimeout, clearTimeout });
  const F = window.OdinFace!;
  const E = ecranDemarrage();
  const ici = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
  assert.deepEqual(ici(E.FORMES.neutre), ici(F.dessin('neutre').yeux), 'pastilles');
  assert.deepEqual(ici(E.FORMES.ferme), ici(F.dessin('sommeil').yeux), 'yeux fermés du sommeil');
  assert.deepEqual(ici(E.FORMES.sourit), ici(F.dessin('joie').yeux), 'yeux qui sourient (joie)');
  assert.deepEqual(ici(E.FORMES.sourit), ici(F.dessin('amour').yeux), 'yeux qui sourient (amour)');
  assert.equal(E.FORMES.zzz.join(''), F.dessin('sommeil').extras, 'zzz');
  assert.equal(E.FORMES.ex.join(''), F.dessin('surprise').extras, '!');
  assert.equal(E.FORMES.coeurs.join(''), F.dessin('amour').extras, 'cœurs');
  for (const id of ['sommeil', 'surprise', 'joie', 'amour']) { const d = F.dessin(id); assert.equal(`${d.bouche}${d.sourcils}${d.joues}`, '', `${id} : face.js ne dessine ni bouche, ni sourcils, ni joues`); }
  const odin = /<svg class="odin-fige anime"[\s\S]*?<\/svg>/.exec(ecranPage())![0];
  for (const interdit of ['bouche', 'mouth', 'brow', 'sourcil', 'joue', 'cheek']) assert.ok(!odin.toLowerCase().includes(interdit), interdit);
  for (const y of odin.matchAll(/<(rect|path)\b[^>]*class="(?:eye|plein ferme)[^"]*"[^>]*\/>/g)) assert.match(y[0], /fill="#fff"/, 'œil blanc');
});

test('menu : les systèmes dans l\'ordre choisi, sans les cachés ; le défaut démarre seul (jamais une installation)', () => {
  const sys = [{ id: 'a', modes: ['essai'] }, { id: 'b', modes: ['installer'] }, { id: 'c', modes: ['essai', 'installer'] }, { id: 'd', modes: ['essai'] }];
  assert.deepEqual(ordonnerSystemes(sys, ['c', 'a', 'd']).map((x) => x.id), ['c', 'a', 'd', 'b']);
  assert.deepEqual(ordonnerSystemes(sys, ['d', 'b'], ['b']).map((x) => x.id), ['d', 'a', 'c']);
  assert.deepEqual(ordonnerSystemes(sys).map((x) => x.id), ['a', 'b', 'c', 'd'], 'sans ordre : tel quel');
  const L = ecranDemarrage().logique;
  assert.deepEqual(JSON.parse(JSON.stringify(L.cibleDefaut(sys, 'reseau', undefined))), { id: 'disque', mode: 'disque' }, 'réseau : le disque du PC par défaut');
  assert.deepEqual(JSON.parse(JSON.stringify(L.cibleDefaut(sys, 'cle', undefined))), { id: 'a', mode: 'essai' }, 'clé : le premier système');
  assert.deepEqual(JSON.parse(JSON.stringify(L.cibleDefaut(sys, 'cle', 'd'))), { id: 'd', mode: 'essai' });
  assert.equal(L.cibleDefaut(sys, 'cle', 'b'), null, 'un système qui ne fait qu\'installer ne démarre jamais tout seul');
  const p = ecranPage();
  assert.match(p, /L\.ordonner\(S\.systemes, S\.ordre, S\.caches\)/, 'la page range les systèmes dans l\'ordre choisi');
  assert.match(p, /\{nom\} dans \{n\} s/, 'le compte à rebours');
});

test('une seule ligne change : « démarrage depuis la clé » / « démarrage par le réseau » (toutes les langues)', () => {
  assert.equal(ligneBarre('cle'), 'démarrage depuis la clé');
  assert.equal(ligneBarre('reseau'), 'démarrage par le réseau');
  assert.equal(ligneBarre('cle', 'en'), 'startup from the key');
  assert.equal(ligneBarre('reseau', 'es-ES'), 'arranque por la red');
  const M = ecranDemarrage().MOTS;
  for (const l of ['en', 'es', 'de', 'ja']) for (const k of Object.keys(M.fr)) assert.ok(M[l][k], `${l} : « ${k} » traduit`);
  assert.equal(ecranDemarrage().logique.mot(M, 'xx', 'barre.cle'), 'démarrage depuis la clé', 'langue inconnue : le français');
});

test('« Installer pour moi » seulement par le réseau (écran, clavier et clé)', () => {
  assert.deepEqual(modesPour('reseau', ['essai', 'installer', 'auto']), ['essai', 'installer', 'auto']);
  assert.deepEqual(modesPour('cle', ['essai', 'installer', 'auto']), ['essai', 'installer']);
  assert.deepEqual(modesPour('cle', ['demarrer']), ['essai'], 'la clé dit « démarrer » : l\'écran propose « Essayer »');
  assert.deepEqual(modesPour('reseau', ['rm -rf', 'auto', 'auto']), ['auto'], 'rien d\'inconnu, pas de doublon');
  const L = ecranDemarrage().logique;
  assert.equal(L.clavier('a', { vue: 'choix', sel: 0, n: 3, cle: true }), null, 'A ne fait rien sur la clé');
  assert.deepEqual(JSON.parse(JSON.stringify(L.clavier('A', { vue: 'choix', sel: 0, n: 3, cle: false }))), { lancer: 'auto' });
  assert.match(ecranPage(), /if \(!mode \|\| \(mode === 'auto' && CLE\)\) return;/, 'la page refuse « pour moi » sur la clé');
  const b = buildEcranOffline({ systemes: [{ id: 'ubuntu.iso', title: 'Ubuntu', modes: ['essai', 'installer', 'auto'] }], disposition: 'affiches', theme: 'bleu', dit: {} });
  assert.deepEqual(JSON.parse(b.fichiers['ecran/etat']).systemes[0].modes, ['essai', 'installer']);
  assert.match(b.fichiers['cgi-bin/choisir'], /case "\$MODE" in essai\|installer\|texte\) ;; \*\)/, 'le script de la clé refuse toute autre façon');
});

test('un même thème pour la clé et le réseau (« Mêmes thèmes que mes clés ODIN »)', () => {
  const r = { commun: { theme: 'galaxie', texte: 'lune', delai: 7 } };
  assert.deepEqual(apparencePour('cle', r), apparencePour('reseau', r), 'interrupteur allumé par défaut : identique');
  assert.equal(apparencePour('reseau', r).theme, 'galaxie');
  assert.equal(apparencePour('cle', r).mode, 'graphique', 'le graphique par défaut ; T pour le texte');
  const coupe = { ...r, memes: false, reseau: { theme: 'matrix' } };
  assert.equal(apparencePour('cle', coupe).theme, 'galaxie');
  assert.equal(apparencePour('reseau', coupe).theme, 'matrix', 'coupé : le réseau garde son propre thème');
  assert.equal(apparencePour('cle', {}).theme, 'bleu');
  // La page servie est la même pour les deux : seule l'adresse (« cle=1 ») change la source.
  const b = buildEcranOffline({ systemes: [], disposition: 'liste', theme: 'galaxie', dit: {} });
  assert.equal(b.fichiers['index.html'], ecranPage());
  assert.equal(JSON.parse(b.fichiers['ecran/etat']).theme, 'galaxie');
  assert.match(ecranPage(), /\.oe\.galaxie,body\.galaxie\{/, 'les 9 thèmes dans la page');
});

test('aucune donnée personnelle, aucun secret, aucun chemin dans ce qui est servi ; aucun nom de produit à l\'écran', () => {
  const p = ecranPage();
  assert.doesNotMatch(p, /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/, 'aucune adresse IP');
  assert.doesNotMatch(p, /\b[0-9a-f]{2}(:[0-9a-f]{2}){5}\b/i, 'aucune adresse de machine');
  assert.doesNotMatch(p, /[A-Za-z]:\\\\|\/home\/|\/Users\/|[\\/]\.odin\b|AppData/, 'aucun chemin');
  assert.doesNotMatch(p, /ventoy|ipxe|grub|syslinux/i, 'aucun nom de produit tiers');
  assert.doesNotMatch(p, /innerHTML\s*=\s*(?!['"\s])/, 'aucun HTML fabriqué à partir d\'une donnée (seulement des dessins écrits en dur)');
  // La clé : on ne garde que ce que l'écran montre ; un chemin devient un nom de fichier, un chemin piégé disparaît.
  const sale = { systemes: [{ id: 'C:\\Users\\moi\\ISO\\ubuntu-24.04.iso', title: 'Ubuntu', modes: ['essai'], chemin: '/home/moi/ISO' }, { id: '../../etc/shadow', title: 'X', modes: ['essai'] }, { id: 'a;reboot', title: 'Y', modes: ['essai'] }], disposition: 'affiches', theme: 'bleu', dit: { _: 'Choisis.' }, serveur: '192.168.1.20:16000', mac: '52:54:00:aa:bb:cc', machine: { host: 'pc-de-moi' }, motDePasse: 'secret' };
  const propre = etatPourCle(sale as never);
  assert.deepEqual((propre.systemes as Array<{ id: string }>).map((x) => x.id), ['ubuntu-24.04.iso']);
  const b = buildEcranOffline(sale as never);
  for (const f of ['ecran/etat', 'systemes.json']) for (const mauvais of ['192.168', '52:54:00', 'pc-de-moi', 'secret', 'Users', '/home/', 'shadow', 'reboot']) assert.ok(!b.fichiers[f].includes(mauvais), `${f} : ${mauvais}`);
  assert.match(b.fichiers['cgi-bin/choisir'], /case "\$ISO" in 'ubuntu-24\.04\.iso'\)/, 'le script de la clé n\'accepte que les systèmes de la clé');
});

test('clavier : flèches, Entrée, T (mode texte), Tab, D ; toute touche passe l\'arrivée', () => {
  const k = (t: string, s: Record<string, unknown>) => JSON.parse(JSON.stringify(ecranDemarrage().logique.clavier(t, { vue: 'choix', sel: 2, n: 7, pas: 4, ...s }) ?? null));
  assert.deepEqual(k('ArrowRight', {}), { sel: 3 });
  assert.deepEqual(k('ArrowLeft', {}), { sel: 1 });
  assert.deepEqual(k('ArrowDown', {}), { sel: 6 }, '↓ descend d\'une rangée (4 affiches)');
  assert.deepEqual(k('ArrowUp', {}), { sel: 0 });
  assert.deepEqual(k('ArrowRight', { sel: 6 }), { sel: 6 }, 'on ne sort pas de la liste');
  assert.deepEqual(k('Enter', {}), { lancer: 'principal' });
  assert.deepEqual(k('t', {}), { texte: true });
  assert.deepEqual(k('T', {}), { texte: true });
  assert.deepEqual(k('Tab', { shift: true }), { cat: -1 });
  assert.deepEqual(k('d', {}), { disp: true });
  assert.deepEqual(k('Escape', {}), { stop: true });
  assert.deepEqual(k('x', {}), null);
  assert.deepEqual(k('x', { vue: 'arrivee' }), { passer: true });
  assert.deepEqual(k('Escape', { vue: 'go' }), { vue: 'choix' });
  assert.deepEqual(k('t', { vue: 'load' }), null, 'pendant une installation, les touches ne lancent rien');
  const p = ecranPage();
  assert.match(p, /L\.clavier\(e\.key/, 'la page passe par ce clavier');
  assert.match(p, /kb\('T'\), M\('pied\.texte'\)/, 'le pied du menu rappelle T pour le mode texte');
  assert.match(p, /choose\('texte'\)/, 'T demande le mode texte (le serveur, ou le script de la clé, décide)');
});

test('relecture : le compte à rebours ne tourne qu\'au menu (jamais pendant une installation, un accord ou « C\'est parti »)', () => {
  const p = ecranPage();
  assert.match(p, /const auMenu = \(\) => R\.dataset\.vue === 'choix';/);
  assert.match(p, /if \(!c \|\| !\(d > 0\) \|\| !auMenu\(\)\) \{ reboursFin = true; return; \}/, 'il ne démarre pas hors du menu');
  assert.match(p, /if \(!auMenu\(\)\) \{ arreterRebours\(\); return; \}/, 'il s\'arrête si l\'écran quitte le menu');
  assert.match(p, /if \(rebours && vue !== 'choix'\) arreterRebours\(\);/, 'changer de vue l\'arrête');
  assert.match(p, /f\.hidden = !auMenu\(\);/, 'hors du menu, le pied ne rappelle aucune touche');
  assert.match(p, /\.gfoot\[hidden\]\{display:none\}/);
  assert.match(p, /const vue = view === 'arrivee' \? 'arrivee' : \(R\.dataset\.vue \|\| view\);/, 'le clavier suit la vue affichée');
  // Installation, accord, « C'est parti » : le panneau prend toute la largeur (pas une colonne de carte), sans onglets.
  assert.match(p, /m\.className = 'glist pleine';/);
  assert.match(p, /\.glist\.pleine\{display:block;overflow:auto\}/);
  assert.match(p, /\.oe:not\(\[data-vue=choix\]\) \.gbar \.cats\{display:none\}/);
});

test('relecture : dans l\'aperçu, Tab sort de l\'écran (pas de piège au clavier) ; la page servie garde Tab pour les familles', () => {
  assert.match(ecranPage(), /if \(e\.key === 'Tab' && !SEUL\) return;/);
});

test('relecture : les yeux blancs restent lisibles sur le corps d\'Odin dans les 9 thèmes (au moins 3 pour 1)', () => {
  const E = ecranDemarrage() as unknown as { donnees(): { TEINTES: Record<string, string[]> }; THEMES: string[] };
  const lum = (h: string) => { const c = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
  const T = E.donnees().TEINTES;
  for (const t of ecranDemarrage().THEMES) {
    // Autour des yeux, le corps va de sa teinte du centre (0) à sa teinte principale (1) : les deux comptent.
    for (const c of T[t].slice(0, 2)) assert.ok(1.05 / (lum(c) + 0.05) >= 3, `${t} : yeux blancs sur ${c} = ${(1.05 / (lum(c) + 0.05)).toFixed(2)}`);
  }
});

test('relecture : textes de l\'écran dans la langue (unités, langue de la page) ; un thème inconnu redevient bleu', () => {
  const p = ecranPage();
  assert.doesNotMatch(p, /' Go'|' Mo'/, 'les unités viennent du dictionnaire');
  assert.match(p, /M\('unite\.go'\)/);
  assert.match(p, /doc\.documentElement\.lang = /, 'la langue de la page suit celle de l\'écran');
  assert.equal(apparencePour('cle', { commun: { theme: 'pas-un-theme' } }).theme, 'bleu');
  assert.equal(apparencePour('cle', { commun: { theme: 'lune' } }).theme, 'lune');
});
