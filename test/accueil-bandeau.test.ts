// Le bandeau du haut de l'accueil (maquette validée « Accueil », lot 19) : le salut selon l'heure et la phrase vraie
// d'aujourd'hui, la recherche (la barre de commande, Ctrl K), le plein écran, une cloche avec le vrai nombre
// (validations en attente et problèmes graves) qui mène à « À faire », et « Vérifier » qui reste. Visible sur
// téléphone ; sans rien à voir, ni nombre ni point rouge ; pas de pastille avec une lettre à ce lot.
//
// ui.html est lu comme du texte ; les deux fonctions de la cloche sont extraites et exécutées avec un état d'essai.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const UI = readFileSync(new URL('../src/web/ui.html', import.meta.url), 'utf8');

/** Le texte entier de la fonction `nom` (définie une seule fois dans ui.html). */
function fonction(nom: string): string {
  const t = [...UI.matchAll(new RegExp(`function\\s+${nom}\\s*\\(`, 'g'))];
  assert.equal(t.length, 1, `la fonction ${nom} existe, une seule fois`);
  const debut = t[0].index ?? 0;
  let i = UI.indexOf('{', UI.indexOf(')', debut)), n = 0;
  for (let j = i; j < UI.length; j++) {
    const c = UI[j];
    if (c === '{') n++;
    else if (c === '}' && --n === 0) return UI.slice(debut, j + 1);
  }
  throw new Error(`${nom} jamais fermée`);
}

/** La tête de la vue d'accueil : de son ouverture à la fin de sa ligne de boutons. */
function bandeau(): string {
  const i = UI.indexOf('id="homeBandeau"');
  assert.ok(i > 0, 'le bandeau (#homeBandeau) existe');
  const debut = UI.lastIndexOf('<div', i), fin = UI.indexOf('<div class="body">', i);
  assert.ok(fin > i, 'le bandeau se termine avant le corps de la vue');
  return UI.slice(debut, fin);
}

/** La vue d'accueil entière (<section id="v-home">). */
function vueAccueil(): string {
  const id = UI.indexOf('id="v-home"'), debut = UI.lastIndexOf('<section', id);
  return UI.slice(debut, UI.indexOf('</section>', id));
}

// Un élément d'essai : ce que cloche() touche (hidden, textContent, une classe, des attributs).
function elementEssai() {
  const classes = new Set<string>(), attrs: Record<string, string> = {};
  return {
    hidden: false, textContent: '', title: '', attrs, classes,
    classList: { toggle: (c: string, on: boolean) => { if (on) classes.add(c); else classes.delete(c); } },
    setAttribute: (k: string, v: string) => { attrs[k] = v; },
  };
}
/** Lance cloche() de ui.html avec un état et des validations en attente ; rend la cloche et son nombre. */
function sonner(state: unknown, enAttente: number) {
  const bell = elementEssai(), nombre = elementEssai();
  const dom: Record<string, unknown> = { '#homeBell': bell, '#homeBellN': nombre };
  const pending = new Set(Array.from({ length: enAttente }, (_, k) => `v${k}`));
  const cloche = new Function('state', 'pending', '$', `${fonction('compteCloche')}\n${fonction('cloche')}\nreturn cloche;`)(state, pending, (q: string) => dom[q]);
  cloche();
  return { bell, nombre };
}

test('bandeau : un seul, en haut de l\'accueil, et seulement là (ni la maison ni Vénus ne l\'ont)', () => {
  assert.equal(UI.split('id="homeBandeau"').length - 1, 1, 'un seul bandeau');
  assert.ok(vueAccueil().includes('id="homeBandeau"'), 'il est dans la vue d\'accueil');
  const v = vueAccueil();
  assert.ok(v.indexOf('id="homeBandeau"') < v.indexOf('id="todayBox"'), 'au-dessus des blocs du jour');
  for (const vue of ['v-maison', 'v-venus']) assert.match(UI, new RegExp(`<section class="view" id="${vue}"[^>]*></section>`), `la vue ${vue} reste vide : le bandeau n'y est pas`);
});

test('bandeau : « Vérifier » est encore là, et lance toujours la vérification (watch_now)', () => {
  assert.match(bandeau(), /<button[^>]*type="button"[^>]*id="homeCheck"[^>]*>[\s\S]*?Vérifier<\/span><\/button>/, '« Vérifier » est dans le bandeau, avec son mot');
  assert.match(UI, /\$\('#homeCheck'\)\.addEventListener\('click', async \(\) => \{[^\n]*kind: 'watch_now'/, 'son clic lance watch_now');
});

test('bandeau : le salut selon l\'heure et la phrase vraie d\'aujourd\'hui y sont posés', () => {
  assert.match(bandeau(), /<div class="hello" id="homeHello"><h1>[^<]+<\/h1>/, 'la place du salut, avec un titre avant le premier dessin');
  const t = fonction('renderToday');
  assert.match(t, /\$\('#homeHello'\)\.replaceChildren\(hello\)/, 'renderToday pose le salut dans le bandeau');
  assert.match(t, /el\('h1', \{ class: 'greet-t' \}, `\$\{hi\}/, 'le salut est le titre du bandeau');
  assert.match(t, /hi = h < 5 \? 'Bonne nuit' : h < 12 \? 'Bonjour' : h < 18 \? 'Bon après-midi' : 'Bonsoir'/, 'selon l\'heure');
  assert.match(t, /id: 'homePhrase' \}, grave \?/, 'la phrase vraie (problèmes graves, attente, tâches, calme) suit la date');
  assert.doesNotMatch(t.slice(t.indexOf('box.replaceChildren(')), /\bhello\b/, 'le salut n\'est plus posé une seconde fois plus bas');
});

test('bandeau : la recherche est la barre de commande d\'aujourd\'hui (Ctrl K)', () => {
  const b = bandeau();
  assert.match(b, /<button[^>]*type="button"[^>]*id="homeSearch"[^>]*aria-haspopup="dialog"/, 'un bouton qui ouvre une boîte');
  assert.match(b, /id="homeSearch"[^>]*aria-keyshortcuts="Control\+K"/, 'son raccourci est annoncé');
  assert.match(b, /<kbd>Ctrl K<\/kbd>/, 'et montré');
  assert.match(UI, /\$\('#homeSearch'\)\.addEventListener\('click', \(\) => palOpen\(true\)\)/, 'il ouvre la barre de commande');
  assert.match(UI, /\(e\.key === 'k' \|\| e\.key === 'K'\) && \(e\.ctrlKey \|\| e\.metaKey\)/, 'Ctrl K l\'ouvre aussi au clavier');
});

test('bandeau : le plein écran de l\'accueil, par le module commun', () => {
  const b = fonction('bandeau');
  assert.match(b, /window\.OdinPleinEcran\.bouton\(\$\('#v-home'\)\)/, 'le bouton commun, pour la vue d\'accueil');
  assert.match(b, /pe\.id = 'homeFull'; \$\('#homeBell'\)\.before\(pe\)/, 'posé une fois, avant la cloche');
  assert.match(fonction('renderHome'), /\bbandeau\(\);/, 'au dessin de l\'accueil (le module est chargé après ce script)');
});

test('bandeau : le nombre de la cloche vient de l\'état (validations en attente + problèmes graves)', () => {
  const etat = (niveaux: string[]) => ({ watch: { findings: niveaux.map((level) => ({ level })) } });
  const c = new Function(`${fonction('compteCloche')}\nreturn compteCloche;`)();
  assert.deepEqual(c(etat([]), 0), { validations: 0, graves: 0, total: 0 });
  assert.deepEqual(c(etat(['grave', 'attention', 'grave']), 3), { validations: 3, graves: 2, total: 5 }, 'seuls les problèmes graves comptent');
  assert.deepEqual(c(null, 2), { validations: 2, graves: 0, total: 2 }, 'sans état encore lu : les validations seules');
  assert.deepEqual(c(etat(['attention']), -4), { validations: 0, graves: 0, total: 0 }, 'jamais négatif');
  for (const [niveaux, attente] of [[['grave'], 0], [[], 7], [['grave', 'grave', 'grave', 'attention'], 11]] as [string[], number][]) {
    const { nombre, bell } = sonner(etat(niveaux), attente), total = niveaux.filter((x) => x === 'grave').length + attente;
    assert.equal(nombre.hidden, false, 'le nombre se montre');
    assert.equal(nombre.textContent, String(total), 'c\'est le vrai total');
    assert.match(bell.attrs['aria-label'], /^À faire : /, 'la cloche dit où elle mène');
  }
  assert.match(fonction('cloche'), /compteCloche\(state, pending\.size\)/, 'cloche() lit l\'état et les validations en attente');
  assert.match(fonction('badges'), /\bcloche\(\)/, 'une validation qui arrive en direct met la cloche à jour');
});

test('bandeau : zéro alerte, pas de point rouge ; le rouge seulement pour un problème grave', () => {
  const vide = sonner({ watch: { findings: [{ level: 'attention' }] } }, 0);
  assert.equal(vide.nombre.hidden, true, 'rien à voir : le nombre est caché');
  assert.equal(vide.nombre.textContent, '', 'et vide');
  assert.equal(vide.nombre.classes.has('grave'), false, 'pas de rouge');
  assert.equal(vide.bell.attrs['aria-label'], 'À faire : aucune validation ni problème grave');
  assert.equal(sonner({}, 2).nombre.classes.has('grave'), false, 'des validations seules : pas de rouge');
  assert.equal(sonner({ watch: { findings: [{ level: 'grave' }] } }, 0).nombre.classes.has('grave'), true, 'un problème grave : rouge');
  assert.match(bandeau(), /<span class="bd-n" id="homeBellN"[^>]*\bhidden><\/span>/, 'au départ, le nombre est caché et vide');
  assert.doesNotMatch(bandeau(), /class="dot"/, 'aucun point écrit dans la page');
});

test('bandeau : aucun chiffre fixe (ni dans le texte du bandeau, ni dans la cloche), pas de pastille avec une lettre', () => {
  const texte = bandeau().replace(/<svg[\s\S]*?<\/svg>/g, '').replace(/<[^>]*>/g, ' ');
  assert.doesNotMatch(texte, /\d/, 'le texte du bandeau n\'a aucun chiffre');
  for (const nom of ['compteCloche', 'cloche']) {
    const corps = fonction(nom).replace(/\/\/[^\n]*/g, '');
    assert.doesNotMatch(corps, /(?<![\w.])[1-9]\d*(?![\w])/, `${nom} n'écrit aucun nombre en dur`);
  }
  assert.doesNotMatch(bandeau(), /class="me"/, 'la pastille avec une lettre n\'est pas posée à ce lot');
});

test('bandeau : la cloche mène à « À faire » (l\'écran y descend, le focus s\'y pose)', () => {
  assert.match(bandeau(), /<button[^>]*type="button"[^>]*id="homeBell"[^>]*aria-label="À faire"/, 'un bouton, nommé');
  const t = fonction('renderToday');
  assert.match(t, /const todo = el\('section', \{ class: 'hpanel', id: 'homeAFaire', tabindex: '-1' \}, el\('h2', \{\}, 'À faire'\)/, '« À faire » peut recevoir le focus');
  const i = UI.indexOf('$(\'#homeBell\').addEventListener(\'click\'');
  assert.ok(i > 0, 'la cloche réagit au clic (et donc à Entrée et Espace)');
  const geste = UI.slice(i, UI.indexOf('\n  });', i));
  assert.match(geste, /\$\('#homeAFaire'\)/, 'vers « À faire »');
  assert.match(geste, /scrollIntoView\(/, 'l\'écran y descend');
  assert.match(geste, /prefers-reduced-motion: reduce/, 'sans glisser si on a demandé moins d\'animations');
  assert.match(geste, /\.focus\(\{ preventScroll: true \}\)/, 'le focus s\'y pose');
});

test('bandeau : au clavier, tout est un bouton, et Échap rend le focus à la recherche', () => {
  const b = bandeau();
  const boutons = [...b.matchAll(/<button\b[^>]*>/g)].map((m) => m[0]);
  assert.equal(boutons.length, 3, 'recherche, cloche, Vérifier (le plein écran est ajouté par le module commun)');
  for (const x of boutons) assert.match(x, /type="button"/, 'de vrais boutons, atteints par Tab');
  assert.doesNotMatch(b, /tabindex="-1"/, 'aucun n\'est retiré du clavier');
  const p = fonction('palOpen');
  assert.match(p, /palAvant = document\.activeElement/, 'la barre retient d\'où elle est ouverte');
  assert.match(p, /a\.focus\(\{ preventScroll: true \}\)/, 'et y rend le focus à la fermeture');
});

test('bandeau : visible sur téléphone (la tête de l\'accueil n\'est plus cachée)', () => {
  assert.doesNotMatch(UI, /#v-home\s*>\s*\.head\s*\{\s*display:\s*none/, 'plus de règle qui cache la tête de l\'accueil');
  const tel = UI.slice(UI.indexOf('#v-home>.bandeau{'));
  assert.match(tel, /#v-home>\.bandeau>\.hello\{display:block/, 'le salut se montre (les autres têtes le cachent au téléphone)');
  assert.match(tel, /#v-home>\.bandeau \.sub\{display:block/, 'la phrase aussi');
  assert.match(tel, /@media \(max-width:860px\)\{\s*#v-home>\.bandeau\{flex-wrap:wrap\}/, 'au téléphone, le bandeau passe sur deux lignes');
  assert.match(tel, /#v-home>\.bandeau \.hbtn\{height:44px\}/, 'des boutons de 44 px au doigt');
});

test('bandeau : la visite guidée le montre, sans chiffre écrit', () => {
  const d = UI.indexOf('const CHAPTERS = [');
  assert.ok(d > 0, 'la visite guidée existe');
  const pas = /\{ v: 'home', q: '#homeBandeau', t: '((?:[^'\\]|\\.)*)' \}/.exec(UI.slice(d));
  assert.ok(pas, 'une étape vise le bandeau');
  assert.match(pas[1], /Ctrl K/, 'elle dit la recherche');
  assert.match(pas[1], /cloche/, 'la cloche');
  assert.match(pas[1], /Vérifier/, 'et « Vérifier »');
  assert.doesNotMatch(pas[1], /\d/, 'sans aucun nombre');
});

// ------------------------------------------------------------------ relecture du lot 19 : ce qui était faux

test('bandeau : la phrase compte les validations une seule fois (elles ont déjà leur ligne dans « À faire »)', () => {
  const t = fonction('renderToday');
  const m = /const waiting = ([^;]+);/.exec(t);
  assert.ok(m, 'renderToday compte ce qui attend');
  const compter = new Function('pending', 'todoItems', `return ${m[1]};`);
  // Deux validations (une seule ligne « 2 validation(s) t'attendent ») et la sauvegarde à activer : trois choses.
  assert.equal(compter(new Set(['a', 'b']), ['2 validations', 'sauvegarde']), 3, 'deux validations et une chose à faire : trois, pas quatre');
  assert.equal(compter(new Set(), ['sauvegarde']), 1, 'sans validation : les lignes d\'« À faire »');
  assert.equal(compter(new Set(['a']), ['1 validation']), 1, 'une validation seule : une chose');
  assert.equal(compter(new Set(), []), 0, 'rien : zéro');
});

test('bandeau : sans validation ni problème grave, la cloche ne dit pas « rien ne t\'attend » (« À faire » peut avoir d\'autres lignes)', () => {
  const vide = sonner({ watch: { findings: [] } }, 0);
  assert.doesNotMatch(vide.bell.attrs['aria-label'], /rien ne t'attend/, 'la cloche ne contredit pas « À faire » ni la phrase');
  assert.match(vide.bell.attrs['aria-label'], /^À faire : aucune validation ni problème grave$/, 'elle dit ce qu\'elle compte');
});

test('bandeau : la barre de commande ne rend le focus qu\'à un élément encore visible après l\'action choisie', () => {
  // L'ouvreur d'essai compte les fois où il reçoit le focus ; visible ou non selon `vu`. palOpen et palRun sont
  // ceux de ui.html, avec un document, une barre et une zone de saisie d'essai.
  let n = 0;
  const corps = {};
  const doc: { activeElement: unknown; body: unknown } = { activeElement: null, body: corps };
  const a = { vu: true, isConnected: true, getClientRects() { return this.vu ? [1] : []; }, focus() { n++; doc.activeElement = a; } };
  doc.activeElement = a;
  const palette = { hidden: true, contains: (x: unknown) => x === 'palIn' };
  const fab = new Function('document', 'palette', 'palIn', 'palRender', 'setTimeout', 'palItems', `let palSel = 0, palAvant = null;\n${fonction('palOpen')}\n${fonction('palRun')}\nreturn { palOpen, palRun };`);
  const items = [{ run: () => { a.vu = false; doc.activeElement = corps; } }, { run: () => { doc.activeElement = corps; } }];
  const { palOpen, palRun } = fab(doc, palette, { value: '', focus() { doc.activeElement = 'palIn'; } }, () => {}, () => 0, items);
  // 1. L'action change d'écran : l'ouvreur est caché, il ne reçoit pas le focus.
  palOpen(true); doc.activeElement = 'palIn'; palRun(0);
  assert.equal(n, 0, 'pas de focus rendu à un élément caché par l\'action');
  // 2. L'action laisse l'écran (un thème, une vérification) : le focus revient à l'ouvreur.
  a.vu = true; doc.activeElement = a; palOpen(true); doc.activeElement = 'palIn'; palRun(1);
  assert.equal(n, 1, 'le focus revient à l\'ouvreur encore visible');
  // 3. Échap : le focus revient tout de suite à l'ouvreur.
  doc.activeElement = a; palOpen(true); doc.activeElement = 'palIn'; palOpen(false);
  assert.equal(n, 2, 'Échap rend le focus');
});

test('bandeau : au téléphone, la recherche garde un texte entier (« ou tape / » et Ctrl K seulement au clavier)', () => {
  assert.match(bandeau(), /<span class="hl">Demande à Odin<span class="bd-tape">, ou tape \/<\/span><\/span>/, 'la fin du texte est à part');
  const css = UI.slice(UI.indexOf('#v-home>.bandeau{'), UI.indexOf('.snavrow{'));
  assert.match(css, /@media \(max-width:860px\)\{[\s\S]*#v-home>\.bandeau \.bd-tape\{display:none\}/, 'elle se cache au téléphone');
  assert.match(css, /@media \(max-width:860px\)\{[\s\S]*#v-home>\.bandeau \.sub\{white-space:normal\}/, 'et la phrase vraie passe à la ligne au lieu d\'être coupée');
  assert.match(css, /@media \(max-width:480px\)\{[\s\S]*#v-home>\.bandeau \.bd-search\{flex:1 1 100%\}/, 'au téléphone étroit, la recherche a sa ligne entière');
});
