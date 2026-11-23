// Filet de l'accueil : tout ce que l'accueil sait faire aujourd'hui (la vue de départ de ui.html et la fenêtre
// d'Odin, src/web/fenetre.js) est tenu par un essai, une chose gardée par essai. L'accueil va être redessiné d'après
// la maquette validée ; ce qui existe déjà est gardé. Si un changement retire une de ces choses, l'essai qui la
// nomme devient rouge.
//
// Les deux fichiers sont lus comme du texte, sans navigateur. On cherche par identifiant (#homeCheck), par nom
// d'action (watch_now, regler_fenetre…) ou par nom de fonction (renderHome, startDrag…), jamais par numéro de
// ligne, et le plus souvent DANS la fonction qui porte la chose : un mot qui revient partout (« Annuler ») ne
// prouve rien tout seul. Rien n'est figé de ce qui doit pouvoir changer : ni le titre de la vue ni son entrée
// de menu, ni une couleur, ni une taille, ni un texte affiché quand le code dit déjà la chose.
//
// Un lot qui DÉPLACE une chose (par exemple un bloc fixe qui devient un widget) met à jour son ancre ci-dessous,
// dans le même lot, et le dit ; il ne retire pas l'essai.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const lire = (chemin: string) => readFileSync(new URL(`../${chemin}`, import.meta.url), 'utf8');
const UI = lire('src/web/ui.html');
const FE = lire('src/web/fenetre.js');

// ------------------------------------------------------------------ lecture du code, sans l'exécuter

/** Saute une chaîne ('…', "…" ou `…` avec ses ${…}) qui commence en i ; rend l'indice juste après. */
function sauterChaine(s: string, i: number): number {
  const q = s[i];
  for (let j = i + 1; j < s.length;) {
    const c = s[j];
    if (c === '\\') { j += 2; continue; }
    if (c === q) return j + 1;
    if (q === '`' && c === '$' && s[j + 1] === '{') { j = fermer(s, j + 1) + 1; continue; }
    if (q !== '`' && c === '\n') return j;
    j++;
  }
  return s.length;
}

/** Indice de ce qui ferme la parenthèse, l'accolade ou le crochet ouvert en i (chaînes et commentaires sautés). */
function fermer(s: string, i: number): number {
  const ouvre = s[i], ferme = ({ '(': ')', '{': '}', '[': ']' } as Record<string, string>)[ouvre];
  assert.ok(ferme, `pas d'ouverture en ${i}`);
  let n = 0;
  for (let j = i; j < s.length;) {
    const c = s[j];
    if (c === '\'' || c === '"' || c === '`') { j = sauterChaine(s, j); continue; }
    if (c === '/' && s[j + 1] === '/') { const k = s.indexOf('\n', j); if (k < 0) break; j = k; continue; }
    if (c === '/' && s[j + 1] === '*') { const k = s.indexOf('*/', j); if (k < 0) break; j = k + 2; continue; }
    if (c === ouvre) n++;
    else if (c === ferme && --n === 0) return j;
    j++;
  }
  throw new Error(`« ${ouvre} » ouvert en ${i} jamais fermé`);
}

/** Le texte entier de la fonction `nom` (définie une seule fois) : de « function » à son accolade fermante. */
function fonction(src: string, nom: string, fichier: string): string {
  const trouves = [...src.matchAll(new RegExp(`(?:async\\s+)?function\\s+${nom}\\s*\\(`, 'g'))];
  assert.equal(trouves.length, 1, `${fichier} : la fonction ${nom} existe, une seule fois`);
  const debut = trouves[0].index ?? 0;
  const params = fermer(src, src.indexOf('(', debut));
  const corps = src.indexOf('{', params);
  return src.slice(debut, fermer(src, corps) + 1);
}

/** Le morceau qui commence à `marque` (unique) et finit à ce qui ferme son dernier caractère (« ( », « { » ou « [ »). */
function apres(src: string, marque: string, ou: string): string {
  const i = src.indexOf(marque);
  assert.ok(i >= 0, `${ou} : « ${marque} » est présent`);
  assert.equal(src.indexOf(marque, i + 1), -1, `${ou} : « ${marque} » n'est présent qu'une fois`);
  const o = i + marque.length - 1;
  return src.slice(i, fermer(src, o) + 1);
}

/** La balise <section> de la vue de départ (id="v-home") et tout ce qu'elle contient. */
function vueDeDepart(): string {
  const id = UI.indexOf('id="v-home"');
  assert.ok(id > 0, 'ui.html : la vue de départ (id="v-home") existe');
  const debut = UI.lastIndexOf('<section', id), fin = UI.indexOf('</section>', id);
  assert.ok(debut >= 0 && fin > id, 'ui.html : la vue de départ est une <section> fermée');
  return UI.slice(debut, fin);
}

const avant = (s: string, a: string, b: string, quoi: string) => {
  const i = s.indexOf(a), j = s.indexOf(b, i < 0 ? 0 : i);
  assert.ok(i >= 0 && j > i, quoi);
};

// Les fonctions qui portent l'accueil aujourd'hui (les ancres : un lot qui les déplace les met à jour ici).
const home = () => fonction(UI, 'renderHome', 'ui.html');
const today = () => fonction(UI, 'renderToday', 'ui.html');
const fe = (nom: string) => fonction(FE, nom, 'fenetre.js');
/** Une branche d'un module de la fenêtre, par sa sorte (meteo, site, bouton…). */
const sorte = (k: string) => apres(fe('widget'), `if (w.kind === '${k}') {`, `fenetre.js, module « ${k} »`);

// Écrire une chose ne suffit pas : elle doit être POSÉE à l'écran. Ces trois appels sont les mises en place.
/** renderToday : l'appel qui pose les blocs du jour dans #todayBox. */
const poseDuJour = () => apres(today(), 'box.replaceChildren(', 'ui.html, renderToday, mise en place');
/** fenetre.js, widget : l'appel qui pose la poignée et les boutons sur la carte d'un module. */
const poseDuModule = () => {
  const w = fe('widget');
  const pose = [...w.matchAll(/box\.append\(/g)].map((m) => w.slice(m.index ?? 0, fermer(w, (m.index ?? 0) + 'box.append'.length) + 1)).filter((x) => /\bgrip\b/.test(x));
  assert.equal(pose.length, 1, 'fenetre.js, widget : un seul appel box.append(…) pose la poignée');
  return pose[0];
};
/** fenetre.js, draw : l'appel qui pose la barre et la grille des modules. */
const poseDeLaPage = () => apres(fe('draw'), 'h.replaceChildren(', 'fenetre.js, draw, mise en place');
/** Un bloc `const nom = …` de renderToday, défini une seule fois, et posé à l'écran par renderToday. */
function blocDuJour(nom: string): string {
  const t = today();
  assert.equal(t.split(`const ${nom} = `).length - 1, 1, `renderToday définit ${nom}, une seule fois`);
  assert.match(poseDuJour(), new RegExp(`\\b${nom}\\b`), `renderToday pose ${nom} à l'écran`);
  const i = t.indexOf(`const ${nom} = `);
  const fin = t.slice(i).search(/;\r?\n/);
  assert.ok(fin > 0, `renderToday : la définition de ${nom} se termine`);
  return t.slice(i, i + fin + 1);
}
/** Un message non vide : une chaîne qui contient quelque chose, ou un appel (une traduction, par exemple). */
const MESSAGE = String.raw`(?:'(?:[^'\\\n]|\\.)+'|"(?:[^"\\\n]|\\.)+"|\`(?:[^\`\\]|\\.)+\`|[A-Za-z_$][\w$.]*\()`;

// ================================================================== ui.html : la vue de départ

test('accueil gardé : la tête, sa date, et le bouton « Vérifier » (#homeCheck) qui lance la vérification watch_now', () => {
  const v = vueDeDepart();
  // Lot 19 : la tête devient le bandeau du haut (classe « head bandeau ») ; la date est écrite par renderToday, avec le salut.
  assert.match(v, /class="head(?: [^"]*)?"/, 'la vue a sa tête');
  assert.match(v, /<h1>[^<]+<\/h1>/, 'la tête a un titre (son mot n\'est pas figé)');
  assert.match(v, /id="homeSub"/, 'la ligne sous le titre existe');
  assert.match(today(), /const jour = new Date\(\)\.toLocaleDateString\(/, 'renderToday lit la date du jour');
  assert.match(today(), /el\('span', \{ id: 'homeSub' \}, jour\b/, 'et l\'écrit sous le salut (#homeSub)');
  assert.match(v, /<button[^>]*type="button"[^>]*id="homeCheck"/, 'le bouton « Vérifier » est dans la tête de la vue');
  const geste = apres(UI, '$(\'#homeCheck\').addEventListener(', 'ui.html, geste de « Vérifier »');
  assert.match(geste, /^\$\('#homeCheck'\)\.addEventListener\('click'/, 'il réagit au clic');
  assert.match(geste, /api\('\/api\/action', \{ kind: 'watch_now' \}\)/, 'le clic lance la vérification (action watch_now)');
  assert.match(geste, /\bsay\(/, 'et dit le résultat');
});

test('accueil gardé : le bandeau de mise à jour (#updBanner), au-dessus de tout, montré seulement quand il y a une mise à jour', () => {
  assert.match(UI, /<div id="updBanner"[^>]*\bhidden\b/, 'le bandeau existe, caché au départ');
  avant(UI, 'id="updBanner"', 'id="v-home"', 'il est posé au-dessus de la vue de départ');
  const app = fonction(UI, 'renderApp', 'ui.html');
  const i = app.indexOf('$(\'#updBanner\')');
  assert.ok(i >= 0, 'renderApp remplit le bandeau');
  const suite = app.slice(i);
  assert.match(suite, /\.hidden = false/, 'il se montre quand une version est là');
  assert.match(suite, /runUpdate\(/, 'avec le bouton qui met à jour');
  assert.match(suite, /\.hidden = true/, 'et se cache sinon');
});

test('accueil gardé : le bandeau du coffre verrouillé (#vaultBanner) dans la vue de départ, avec son déverrouillage', () => {
  assert.match(vueDeDepart(), /id="vaultBanner"/, 'le bandeau du coffre est dans la vue de départ');
  const vault = fonction(UI, 'renderVault', 'ui.html');
  const b = apres(vault, '$(\'#vaultBanner\').replaceChildren(', 'ui.html, renderVault');
  assert.match(b, /V === 'locked'/, 'il ne se montre que si le coffre est verrouillé');
  assert.match(b, /type: 'password'|pw\(/, 'il demande le mot de passe du coffre');
  assert.match(b, /'vault_unlock'/, 'et le déverrouille (action vault_unlock)');
  assert.match(UI, /\brenderVault\(\);/, 'renderVault est appelé au rafraîchissement');
});

test('accueil gardé : le salut selon l\'heure, avec la mascotte, et sa phrase vraie (problèmes graves, choses en attente, tâches en cours, calme)', () => {
  assert.match(vueDeDepart(), /id="todayBox"/, 'la place des blocs du jour est dans la vue');
  const t = today();
  assert.match(t, /\$\('#todayBox'\)/, 'renderToday dessine dans #todayBox');
  assert.match(t, /new Date\(\)\.getHours\(\)/, 'le salut dépend de l\'heure');
  assert.match(t, /class: 'greet'/, 'le salut est dessiné');
  // Lot 19 : le salut n'est plus posé dans #todayBox mais dans le bandeau du haut (#homeHello, dans la tête de la vue).
  assert.match(vueDeDepart(), /<div class="head[^"]*"[^>]*><div class="hello" id="homeHello">/, 'la place du salut est dans la tête de la vue');
  assert.equal(t.split('const hello = ').length - 1, 1, 'renderToday définit hello, une seule fois');
  assert.match(t, /\$\('#homeHello'\)\.replaceChildren\(hello\)/, 'renderToday pose le salut dans le bandeau');
  const hello = t.slice(t.indexOf('const hello = '), t.indexOf('$(\'#homeHello\').replaceChildren(hello)'));
  assert.match(hello, /^const hello = el\('div', \{ class: 'greet' \}/, 'le bloc posé est bien le salut');
  assert.match(hello, /buddyClone\(/, 'avec la mascotte');
  const phrase = hello.slice(hello.indexOf('class: \'greet\''));
  avant(phrase, 'grave ?', 'waiting ?', 'la phrase dit d\'abord les problèmes graves, puis ce qui attend');
  avant(phrase, 'waiting ?', 'live.length ?', 'puis les tâches en cours, sinon le calme');
  // Relecture du lot 19 : les validations ont déjà leur ligne dans « À faire » ; elles ne sont plus comptées deux fois.
  assert.match(t, /const waiting = pending\.size \+ Math\.max\(0, todoItems\.length - \(pending\.size \? 1 : 0\)\)/, 'ce qui attend : validations et choses à faire, comptées pour de vrai (une seule fois)');
  assert.match(UI, /\brenderToday\(items, live\)/, 'renderHome passe les choses à faire et les tâches en cours au salut');
});

test('accueil gardé : « Tu veux sans doute » — les validations d\'abord, chaque proposition se lance ou s\'écarte (guess_dismiss)', () => {
  const t = today();
  assert.match(t, /T\.guesses/, 'les propositions viennent de l\'état du jour');
  avant(t, 'id: \'approvals\'', 'T.guesses', 'une validation en attente passe avant les propositions');
  const guesses = blocDuJour('guesses');
  assert.match(guesses, /^const guesses = G\.length \?/, 'le bloc posé montre les propositions G (validations, puis T.guesses)');
  assert.match(t, /const G = [^\n]*T\.guesses/, 'G vient des validations et de l\'état du jour');
  assert.match(guesses, /onclick: \(\) => runGuess\(g\)/, 'une proposition se lance d\'un clic');
  assert.match(guesses, /kind: 'guess_dismiss', id: g\.id/, 'une proposition s\'écarte (action guess_dismiss)');
  const run = fonction(UI, 'runGuess', 'ui.html');
  assert.match(run, /g\.prompt/, 'une proposition peut demander quelque chose à Odin');
  assert.match(run, /g\.view/, 'ou ouvrir une page');
});

test('accueil gardé : « Comment Odin se comporte » et ses trois réglages — autonomie, disponibilité, discrétion', () => {
  const ctrl = apres(UI, 'const CTRL = {', 'ui.html, CTRL');
  for (const k of ['autonomy', 'mode', 'discretion']) assert.match(ctrl, new RegExp(`\\b${k}: \\{`), `le réglage ${k} est décrit`);
  const t = today();
  const ctrls = blocDuJour('ctrls');
  for (const k of ['autonomy', 'mode', 'discretion']) assert.match(ctrls, new RegExp(`seg\\('${k}'`), `le réglage ${k} est dessiné dans le bloc posé`);
  assert.match(ctrls, /kind: 'set_autonomy'/, 'l\'autonomie se change (action set_autonomy)');
  assert.match(ctrls, /kind: 'set_control', control: 'mode'/, 'la disponibilité se change (set_control, mode)');
  assert.match(ctrls, /kind: 'set_control', control: 'discretion'/, 'la discrétion se change (set_control, discretion)');
  assert.match(t, /aria-pressed/, 'le choix en cours est annoncé');
});

test('accueil gardé : « À faire » — demandes d\'accès avec « Autoriser » et « Refuser » (pair_decide), validations, compétences, problèmes graves, sauvegarde', () => {
  const h = home();
  const acces = apres(h, 'for (const pr of state.pairRequests || []) todo.push(', 'ui.html, renderHome, demandes d\'accès');
  assert.match(acces, /kind: 'pair_decide', id: pr\.id, ok: true/, '« Autoriser » accepte la demande d\'accès');
  assert.match(acces, /kind: 'pair_decide', id: pr\.id, ok: false/, '« Refuser » la refuse');
  assert.match(acces, /pr\.code/, 'le code à comparer avec l\'appareil est montré');
  assert.match(h, /if \(pending\.size\) todo\.push\(/, 'les validations en attente y sont');
  assert.match(h, /if \(state\.drafts\?\.length\) todo\.push\(/, 'les compétences à relire y sont');
  assert.match(h, /if \(grave\) todo\.push\(/, 'les problèmes de sécurité graves y sont');
  assert.match(h, /if \(!state\.autoBackup\?\.enabled\) todo\.push\(/, 'la sauvegarde à activer y est');
  assert.match(h, /todo\.map\(/, 'la liste passe dans les choses à faire');
  const todoDuJour = blocDuJour('todo');
  assert.match(todoDuJour, /todoItems\.length \? [^\n]*\.\.\.todoItems/, 'le bloc posé montre la liste, ou un message quand rien n\'attend');
});

test('accueil gardé : « Ce qu\'Odin a fait » — le fil du jour, ses filtres (tout, seul, refusé) et son « Annuler » (undo)', () => {
  const t = today();
  assert.match(t, /T\.feed/, 'le fil vient de l\'état du jour');
  const feed = blocDuJour('feed');
  for (const f of ['tout', 'seul', 'refuse']) assert.match(feed, new RegExp(`fbtn\\('${f}'`), `le filtre « ${f} » est dans le bloc posé`);
  assert.match(t, /localStorage\.setItem\('odin\.feed'/, 'le filtre choisi est gardé');
  assert.ok(feed.includes('x.undoId && !x.undone'), '« Annuler » n\'est offert que sur ce qui peut l\'être, et pas deux fois');
  const annuler = feed.slice(feed.indexOf('x.undoId && !x.undone'));
  assert.match(annuler, /kind: 'undo', id: x\.undoId/, '« Annuler » défait l\'action (action undo)');
});

test('accueil gardé : les cinq chiffres cliquables (appareils, missions, risques, dépenses, mode d\'Odin)', () => {
  const h = home();
  assert.match(h, /const kpi = \([^)]*\) => el\('button', \{[^}]*onclick \}/, 'un chiffre est un bouton qui mène à son détail');
  const appels: string[] = [];
  for (const m of h.matchAll(/\bkpi\(/g)) appels.push(h.slice(m.index ?? 0, fermer(h, (m.index ?? 0) + 3) + 1));
  assert.ok(appels.length >= 5, `cinq chiffres au moins (${appels.length})`);
  const sources: [string, RegExp][] = [['appareils en ligne', /\bonline\b/], ['missions en cours', /live\.length/], ['risques', /grave \+ warn/], ['dépenses', /spentUsd/], ['mode d\'Odin', /state\.autonomy/]];
  for (const [quoi, re] of sources) {
    const a = appels.find((x) => re.test(x));
    assert.ok(a, `le chiffre « ${quoi} » existe`);
    assert.match(a, /go\(|show\(/, `le chiffre « ${quoi} » est cliquable`);
  }
});

test('accueil gardé : la tuile Surveillance (disques et appareils importants)', () => {
  const h = home();
  assert.match(h, /state\.watch\?\.disks/, 'elle montre l\'espace des disques');
  assert.match(h, /watched\.length \?/, 'et les appareils importants, ou comment les marquer');
});

test('accueil gardé : la tuile Sauvegarde (état, dernière sauvegarde, réglages)', () => {
  const h = home();
  assert.match(h, /state\.autoBackup\?\.enabled \?/, 'elle dit si la sauvegarde automatique marche');
  assert.match(h, /state\.autoBackup\?\.files\?\.\[0\]/, 'elle nomme la dernière');
  assert.match(h, /onclick: go\('settings', 'sauvegarde'\)/, 'elle mène à ses réglages');
});

test('accueil gardé : la tuile Résumé du matin (choisir l\'heure, créer la routine routine_add)', () => {
  const h = home();
  assert.match(h, /id: 'rt-hour'/, 'l\'heure se choisit');
  assert.match(h, /kind: 'routine_add'/, 'la routine se crée (action routine_add)');
});

test('accueil gardé : la tuile Application (#appCard : installer Odin, notifications)', () => {
  assert.match(home(), /id: 'appCard'/, 'la tuile est posée dans l\'accueil');
  assert.match(home(), /renderAppCard\(\)/, 'et remplie');
  const a = fonction(UI, 'renderAppCard', 'ui.html');
  assert.match(a, /\$\('#appCard'\)/, 'renderAppCard dessine dans #appCard');
  assert.match(a, /installEvt\.prompt\(\)/, 'installer Odin sur l\'appareil');
  assert.match(a, /Notification\.requestPermission\(\)/, 'activer les notifications');
  assert.match(a, /kind: 'push_test'/, 'essayer une notification');
});

test('accueil gardé : « État détaillé », replié, qui garde les chiffres, « Ce qu\'Odin a fait » avec « Tout voir », et les tuiles', () => {
  const h = home();
  const g = apres(h, 'grid.replaceChildren(', 'ui.html, renderHome, grille');
  assert.match(g, /el\('details'/, 'le bloc est repliable');
  assert.match(g, /el\('summary'/, 'avec son titre');
  for (const k of ['kpis', 'doneBox', 'tiles']) assert.match(g, new RegExp(`\\b${k}\\b`), `il contient ${k}`);
  assert.match(apres(h, 'const doneBox = el(', 'ui.html, renderHome, doneBox'), /onclick: go\('missions'\)/, '« Tout voir » mène aux missions');
  assert.match(vueDeDepart(), /id="homeGrid"/, 'sa place est dans la vue de départ');
});

// ================================================================== fenetre.js : la fenêtre d'Odin

test('fenêtre gardée : les pages et leurs onglets, la page ouverte gardée dans le navigateur', () => {
  const d = fe('draw');
  const tabs = apres(d, 'const tabs = L.pages.map(', 'fenetre.js, draw, onglets');
  assert.match(tabs, /el\('button'/, 'un onglet par page');
  assert.match(tabs, /'aria-pressed': String\(i === cur\)/, 'la page ouverte est annoncée');
  assert.match(tabs, /localStorage\.setItem\('odin\.fenetre\.page'/, 'la page ouverte est gardée');
  assert.match(tabs, /p\.name/, 'l\'onglet porte le nom de la page');
  assert.match(d, /class: 'fe-tabs'[^\n]*?\}, \.\.\.tabs\)/, 'les onglets sont posés dans la barre normale');
  assert.match(d, /class: 'fe-tools'[^\n]*?, \.\.\.tabs,/, 'et dans la barre du mode Modifier');
  assert.match(poseDeLaPage(), /^h\.replaceChildren\(bar,/, 'la barre des onglets est posée à l\'écran');
  assert.match(fe('load'), /localStorage\.getItem\('odin\.fenetre\.page'/, 'et relue au chargement');
  assert.match(fe('load'), /act\('gladsheim', 'fenetre'\)/, 'la fenêtre est lue chez Hestia (action fenetre)');
});

test('fenêtre gardée : ajouter une page', () => {
  assert.match(fe('draw'), /OdinDialog\.prompt\([^)]*\); if \(n\) \{ L\.pages\.push\(/, 'une page neuve, nommée, s\'ajoute');
});

test('fenêtre gardée : renommer une page (bouton, et double-clic sur l\'onglet en mode Modifier)', () => {
  const r = fe('rename');
  assert.match(r, /OdinDialog\.prompt\(/, 'le nom est demandé');
  assert.match(r, /L\.pages\[i\]\.name = /, 'et posé');
  const d = fe('draw');
  assert.match(d, /onclick: \(\) => rename\(cur\)/, 'un bouton renomme la page ouverte');
  assert.match(d, /ondblclick: \(\) => edit && rename\(i\)/, 'un double-clic sur l\'onglet aussi, en mode Modifier seulement');
});

test('fenêtre gardée : supprimer une page, avec une question, jamais la dernière', () => {
  const d = fe('draw');
  const i = d.indexOf('L.pages.splice(cur, 1)');
  assert.ok(i > 0, 'une page se supprime');
  const ligne = d.slice(d.lastIndexOf('\n', i), i);
  assert.match(ligne, /L\.pages\.length > 1 \?/, 'jamais la dernière page');
  assert.match(ligne, /OdinDialog\.confirm\([\s\S]*?\{ danger: true \}\)/, 'après une question');
  assert.match(ligne, /if \(await window\.OdinDialog\.confirm\([^\n]*?\{ danger: true \}\)\) \{ $/, 'et seulement si la réponse est oui (la réponse attendue commande la suppression)');
});

test('fenêtre gardée : marquer une page « Écran de la maison »', () => {
  const d = fe('draw');
  assert.match(d, /page\(\)\.maison = !page\(\)\.maison/, 'le marquage se fait et se défait');
  assert.match(d, /'aria-pressed': String\(Boolean\(page\(\)\.maison\)\)/, 'son état est annoncé');
  assert.match(d, /p\.maison \?/, 'l\'onglet d\'une page marquée le montre');
});

test('fenêtre gardée : le mode Modifier, « Annuler » qui remet tout comme avant, « Terminé » qui seul range la fenêtre (regler_fenetre)', () => {
  const d = fe('draw');
  assert.match(d, /onclick: \(\) => \{ edit = true; draw\(\); \}/, 'un bouton ouvre le mode Modifier');
  assert.match(d, /onclick: async \(\) => \{ L = JSON\.parse\(saved\); edit = false;/, '« Annuler » remet la fenêtre gardée et quitte le mode Modifier');
  assert.match(d, /onclick: save \}/, '« Terminé » range la fenêtre');
  assert.match(poseDeLaPage(), /^h\.replaceChildren\(bar,/, 'la barre du mode Modifier est posée à l\'écran');
  const s = fe('save');
  assert.match(s, /act\('gladsheim', 'regler_fenetre'/, 'ranger, c\'est l\'action regler_fenetre de Hestia');
  avant(s, 'if (!r.ok)', 'edit = false', 'le mode Modifier ne se ferme que si Hestia a rangé');
  assert.equal(FE.split('\'regler_fenetre\'').length - 1, 1, 'rien n\'est rangé ailleurs qu\'à « Terminé »');
});

test('fenêtre gardée : le choix du thème en mode Modifier (apparence, theme)', () => {
  const t = fe('themeBtn');
  assert.match(t, /el\('select'/, 'une liste de thèmes');
  assert.match(t, /value: 'automatique'/, 'avec « Automatique »');
  assert.match(t, /window\.OdinThemes\?\.ORDER/, 'et tous les thèmes connus');
  assert.match(t, /act\('apparence', 'theme', \{ theme: e\.target\.value \}\)/, 'le choix est appliqué par Apparence (action theme)');
  const d = fe('draw');
  avant(d, 'const bar = edit', 'themeBtn()', 'la liste est dans la barre du mode Modifier');
  assert.match(d, /class: 'fe-tools'[\s\S]*?themeBtn\(\)[\s\S]*?: el\('div', \{ class: 'fe-bar' \}/, 'dans la branche du mode Modifier');
  assert.match(poseDeLaPage(), /^h\.replaceChildren\(bar,/, 'et cette barre est posée à l\'écran');
});

test('fenêtre gardée : la poignée de chaque module et les flèches du clavier', () => {
  const w = fe('widget');
  const grip = apres(w, 'const grip = el(', 'fenetre.js, poignée');
  assert.match(grip, /class: 'fe-grip'/, 'chaque module a sa poignée');
  assert.match(grip, /'aria-label': /, 'nommée pour les lecteurs d\'écran');
  assert.match(grip, /e\.key === 'ArrowLeft' \|\| e\.key === 'ArrowUp'\) \{ move\(w\.id, -1\)/, '← et ↑ reculent le module');
  assert.match(grip, /e\.key === 'ArrowRight' \|\| e\.key === 'ArrowDown'\) \{ move\(w\.id, 1\)/, '→ et ↓ l\'avancent');
  const m = fe('move');
  assert.match(m, /\[l\[i\], l\[j\]\] = \[l\[j\], l\[i\]\]/, 'le module change de place avec son voisin');
  assert.match(m, /\.fe-grip`\)\?\.focus\(\)/, 'et la poignée garde le focus');
  assert.match(poseDuModule(), /^box\.append\(grip\b/, 'la poignée est posée sur la carte du module');
});

test('fenêtre gardée : glisser un module (souris et doigt) depuis sa poignée', () => {
  assert.match(fe('widget'), /grip\.addEventListener\('pointerdown', \(e\) => startDrag\(e, box, w\.id\)\)/, 'la poignée attrape le module (souris et doigt : pointerdown)');
  const s = fe('startDrag');
  assert.match(s, /addEventListener\('pointermove', mv\)/, 'le module suit le pointeur');
  assert.match(s, /addEventListener\('pointerup', up\)/, 'et se pose au relâché');
  assert.match(s, /document\.elementFromPoint\(/, 'sur le module visé');
  assert.match(s, /page\(\)\.widgets\.sort\(/, 'l\'ordre de la page suit');
  assert.match(poseDuModule(), /^box\.append\(grip\b/, 'la poignée qu\'on attrape est posée sur la carte');
});

test('fenêtre gardée : changer la taille d\'un module', () => {
  const chrome = apres(fe('widget'), 'const chrome = el(', 'fenetre.js, boutons du module');
  assert.match(chrome, /onclick: \(\) => \{ w\.w = [^;]+; draw\(\); \}/, 'un bouton change la taille du module');
  assert.match(poseDuModule(), /\bchrome\b/, 'les boutons du module sont posés sur sa carte');
});

test('fenêtre gardée : choisir une partie de la page d\'une appli (configure)', () => {
  const chrome = apres(fe('widget'), 'const chrome = el(', 'fenetre.js, boutons du module');
  assert.match(chrome, /w\.kind === 'section' \|\| w\.kind === 'chiffres' \?[^\n]*onclick: \(\) => configure\(w\)/, 'le réglage est offert aux modules d\'une appli');
  assert.match(poseDuModule(), /\bchrome\b/, 'les boutons du module sont posés sur sa carte');
  const c = fe('configure');
  assert.match(c, /\/api\/valhalla\/view\?id=/, 'les parties viennent de la page de l\'appli');
  assert.match(c, /w\.kind = 'section'; w\.section = sel\.value/, 'une partie se choisit');
  assert.match(c, /w\.kind = 'chiffres'/, 'ou les chiffres clés');
  assert.match(fe('widget'), /window\.OdinApps\?\.section/, 'la partie choisie est dessinée comme sur la page de l\'appli');
});

test('fenêtre gardée : retirer un module', () => {
  const chrome = apres(fe('widget'), 'const chrome = el(', 'fenetre.js, boutons du module');
  assert.match(chrome, /page\(\)\.widgets = page\(\)\.widgets\.filter\(\(x\) => x\.id !== w\.id\)/, 'un bouton retire le module de la page');
  assert.match(poseDuModule(), /\bchrome\b/, 'les boutons du module sont posés sur sa carte');
});

test('fenêtre gardée : « Ouvrir › » mène à l\'appli du module', () => {
  assert.match(fe('widget'), /w\.module \? el\('button', \{[^}]*onclick: \(\) => \{ location\.hash = `#app=\$\{w\.module\}`; \} \}/, 'le bouton ouvre la page de l\'appli');
  assert.match(UI, /const hashView = [^\n]*\^app=/, 'ui.html sait ouvrir une appli par #app=');
});

test('fenêtre gardée : le catalogue des modules en mode Modifier (recherche, familles, heure, météo, glisser ou cliquer)', () => {
  const c = fe('catalogue');
  assert.match(c, /type: 'search'/, 'une recherche');
  assert.match(c, /oninput: \(\) => fill\(q\.value\)/, 'qui filtre en tapant');
  assert.match(c, /cat\?\.modules/, 'toutes les applis du catalogue');
  assert.match(c, /m\.family/, 'rangées par famille');
  assert.match(c, /item\(\{ kind: 'heure' \}/, 'l\'heure et le lieu');
  assert.match(c, /item\(\{ kind: 'meteo' \}/, 'la météo');
  assert.match(c, /onclick: \(\) => add\(w\)/, 'un clic ajoute le module');
  assert.match(c, /setData\('text\/odin-module'/, 'on peut aussi le glisser');
  const d = fe('draw');
  assert.match(d, /getData\('text\/odin-module'\)/, 'et la page le reçoit');
  assert.match(d, /edit \? catalogue\(\) : null/, 'le catalogue est là en mode Modifier');
  assert.match(fe('load'), /'\/api\/valhalla\/catalog'/, 'il vient du catalogue d\'Odin');
});

test('fenêtre gardée : le site surveillé — une sonde de Pulsar, ou un nouveau site créé (vordr, ajouter)', () => {
  assert.match(fe('catalogue'), /onclick: siteSurveille/, 'le catalogue l\'offre');
  const s = fe('siteSurveille');
  assert.match(s, /\/api\/valhalla\/view\?id=vordr/, 'les sondes existantes sont proposées');
  assert.match(s, /add\(\{ kind: 'site', module: 'vordr', label: sel\.value \}\)/, 'une sonde existante se pose');
  assert.match(s, /\/\^https\?:/, 'une adresse neuve doit commencer par http:// ou https://');
  assert.match(s, /act\('vordr', 'ajouter', \{ nom: n, genre: 'http', cible: u \}\)/, 'le site neuf est créé dans Pulsar (action ajouter)');
  assert.match(sorte('site'), /views\.get\('vordr'\)/, 'le module montre l\'état de la sonde');
});

test('fenêtre gardée : le bouton sur mesure, et l\'accord redemandé à chaque clic pour une action grave', () => {
  assert.match(fe('catalogue'), /onclick: ownButton/, 'le catalogue l\'offre');
  const o = fe('ownButton');
  assert.match(o, /a\.grave \?/, 'une action grave est signalée dans la liste');
  assert.match(o, /filter\(\(p\) => p\.kind !== 'password'\)/, 'aucun mot de passe n\'est rangé dans un bouton');
  assert.match(o, /add\(\{ kind: 'bouton', module: ms\.value, action: as\.value, input,/, 'le bouton est posé avec son appli, son action et ses réglages');
  const b = sorte('bouton');
  assert.match(b, /let r = await act\(w\.module, w\.action, w\.input \|\| \{\}\);/, 'le clic demande l\'action sans accord');
  avant(b, 'if (r.confirm)', 'window.OdinDialog.confirm(r.confirm', 'si Odin demande l\'accord, il est demandé');
  avant(b, 'window.OdinDialog.confirm(r.confirm', 'act(w.module, w.action, w.input || {}, true)', 'et l\'action n\'est confirmée qu\'après le oui');
  assert.match(b, /if \(r\.confirm\) r = \(await window\.OdinDialog\.confirm\(r\.confirm[^)]*\)\) \? await act\(w\.module, w\.action, w\.input \|\| \{\}, true\) : /,
    'la réponse attendue du dialogue commande l\'envoi : oui, l\'action part confirmée ; sinon, rien ne part');
  assert.match(FE, /const act = \(module, action, input = \{\}, confirm\) => api\('\/api\/valhalla\/act', \{ module, action, input, \.\.\.\(confirm \? \{ confirm: true \} : \{\}\) \}\)/, 'l\'accord n\'est envoyé que quand il est donné');
});

test('fenêtre gardée : le rafraîchissement toutes les 60 secondes, arrêté en mode Modifier', () => {
  const m = fe('mount');
  const t = apres(m, 'timer = setInterval(', 'fenetre.js, mount, rafraîchissement');
  assert.match(t, /,\s*(60_000|60000|60 \* 1000)\)$/, 'toutes les 60 secondes');
  assert.match(t, /if \(edit \|\|/, 'jamais en mode Modifier');
  assert.match(m, /clearInterval\(timer\)/, 'un seul minuteur à la fois');
});

test('fenêtre gardée, état vide ou panne : le chargement, puis « fenêtre indisponible »', () => {
  const m = fe('mount');
  avant(m, 'class: \'fe-err\'', 'await load()', 'un message de chargement est montré avant la lecture');
  assert.match(m.slice(0, m.indexOf('await load()')), /class: 'fe-err' \}, (?!''|""|``)\S/, 'et il dit quelque chose');
  assert.match(m, /catch \(e\) \{ host\(\)\.replaceChildren\(el\('p', \{ class: 'fe-err' \}, (?!''|""|``)\S/, 'une panne de lecture est dite');
});

test('fenêtre gardée, état vide ou panne : la page vide', () => {
  assert.match(fe('draw'), new RegExp(String.raw`if \(!page\(\)\.widgets\.length\) grid\.append\(el\('div', \{ class: 'fe-drop'[^\n]*?edit \? ${MESSAGE}[^\n]*? : ${MESSAGE}`),
    'une page vide le dit, avec un message non vide en mode Modifier comme hors de lui');
  assert.match(poseDeLaPage(), /class: 'fe-wrap' \}, grid\b/, 'la grille (et son message de page vide) est posée à l\'écran');
});

test('fenêtre gardée, état vide ou panne : l\'appli indisponible, pas de chiffres, une partie de page disparue', () => {
  const w = fe('widget');
  assert.match(w, /if \(!v\) \{ box\.append\(el\('p', \{ class: 'fe-err' \}, (?!''|""|``)\S/, 'appli indisponible');
  assert.match(w, /v\.kpis\?\.length \?[\s\S]*?: el\('p', \{ class: 'fe-err' \}, (?!''|""|``)\S/, 'pas de chiffres pour cette appli');
  assert.match(w, /\.find\(\(x\) => x\.title === w\.section\);[\s\S]*?: el\('p', \{ class: 'fe-err' \}, (?!''|""|``)\S/, 'la partie choisie n\'est plus sur la page');
});

test('fenêtre gardée, état vide ou panne : la sonde disparue', () => {
  assert.match(sorte('site'), /: el\('p', \{ class: 'fe-err' \}, (?!''|""|``)\S/, 'une sonde qui n\'existe plus le dit');
});

test('fenêtre gardée, état vide ou panne : la météo hors ligne (dernière valeur connue) ou sans ville', () => {
  assert.match(sorte('meteo'), /meteoRepli\(\)/, 'sans météo, le module passe au repli');
  const r = fe('meteoRepli');
  assert.match(r, /window\.OdinReseau\.enLigne\(\)/, 'il distingue « pas d\'Internet »');
  assert.match(r, /window\.OdinHorsLigne\.message\(/, 'et le dit comme ailleurs dans Odin');
  assert.match(r, /ancien: v \?/, 'avec la dernière valeur connue');
  assert.match(r, /return el\('p', \{ class: 'fe-err' \}, (?!''|""|``)\S/, 'sinon : la ville n\'est pas réglée');
});

test('fenêtre gardée : la fenêtre est posée au-dessus des blocs fixes de la vue de départ', () => {
  assert.match(UI, /<script nonce="__NONCE__" src="\/fenetre\.js"><\/script>/, 'ui.html charge la fenêtre');
  const v = vueDeDepart();
  const corps = v.slice(v.indexOf('class="body"'));
  assert.ok(v.includes('class="body"'), 'la vue de départ a son corps');
  assert.match(corps, /id="todayBox"/, 'les blocs fixes sont dans ce corps');
  const m = fe('mount');
  assert.match(m, /const body = \$\('#v-home \.body'\)/, 'la fenêtre se monte dans ce corps');
  assert.match(m, /body\.prepend\(el\('div', \{ id: 'fenetre'/, 'en premier, donc au-dessus des blocs fixes');
  assert.match(m, /\$\('#fenetre'\)\) return/, 'une seule fois');
  assert.match(FE, /const tryMount = \(\) => \{[^\n]*\bmount\(\)/, 'tryMount monte la fenêtre une fois l\'appli ouverte');
  assert.match(FE, /if \(document\.readyState === 'loading'\) document\.addEventListener\('DOMContentLoaded', tryMount\); else tryMount\(\);/, 'et tryMount est bien lancé au chargement de la page');
});

test('fenêtre gardée : chaque module est une carte de classe .fe-w (d\'autres lots l\'habillent)', () => {
  assert.match(fe('widget'), /const box = el\('article', \{ class: 'fe-w', 'data-id': w\.id/, 'la carte d\'un module porte la classe fe-w et son identifiant');
  assert.match(FE, /\.fe-w\{/, 'la classe a son style');
  assert.match(fe('startDrag'), /closest\('\.fe-w'\)/, 'le glisser vise les cartes .fe-w');
  assert.match(fe('move'), /\.fe-w\[data-id=/, 'les flèches retrouvent la carte .fe-w');
  assert.match(fe('draw'), /for \(const w of page\(\)\.widgets\) grid\.append\(await widget\(w\)\)/, 'chaque module de la page est mis dans la grille');
  assert.match(poseDeLaPage(), /class: 'fe-wrap' \}, grid\b/, 'et la grille est posée à l\'écran');
});
