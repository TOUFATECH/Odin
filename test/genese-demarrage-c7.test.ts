// Genèse · clé USB, lot C7 : le démarrage en MODE TEXTE (maquette validée, écran « Démarrage → menu texte »). On vérifie
// le menu texte généré pour le chargeur (/ventoy/ventoy_grub.cfg) : couleurs du thème texte, Odin figé (yeux seuls),
// entrées numérotées dans l'ordre choisi, barre en caractères, entrées G (mode graphique) et D (disque du PC), délai
// et entrée par défaut ; un nom piégé neutralisé ; le mode graphique par défaut ; le même ordre et les mêmes noms que
// le menu graphique. La syntaxe est relue par un petit analyseur (pas d'outil du chargeur dans le dépôt). Fonctions
// pures : rien n'est écrit sur aucun disque.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildMenuTexte, couleurGrub, couleursMenuTexte, textesMenuTexte, TEXTES_MENU_TEXTE, NOMS_COULEURS_GRUB } from '../src/valhalla/thjalfi/cle-grub.ts';
import { buildVentoyJson, entreesMenuCle, nomMenuTexte, reglagesDemarrage } from '../src/valhalla/thjalfi/cle-boot.ts';
import { buildersParDefaut } from '../src/valhalla/thjalfi/cle-ecrire.ts';
import { TEXT_THEMES, TEXT_THEME_IDS } from '../src/valhalla/thjalfi/ecran.ts';
import type { PreparationCle } from '../src/valhalla/thjalfi/cle-types.ts';
import type { Recipe } from '../src/valhalla/thjalfi/recipes.ts';

const rec = (kind: Recipe['kind'], os: Recipe['os']): Recipe => ({ kind, label: `${kind}`, auto: true, os });

function prep(p: Partial<PreparationCle> = {}): PreparationCle {
  return {
    schema: 'gpt', secureBoot: true, label: 'ODIN', theme: 'bleu', texte: 'matrix', disposition: 'eventail',
    modeDefaut: 'texte', delai: 7, langue: 'fr',
    systemes: [
      { fichier: 'windows-11.iso', nom: 'Windows 11', famille: 'Windows', mode: 'installer', recipe: rec('windows', 'windows') },
      { fichier: 'ubuntu-24.04.3-desktop-amd64.iso', nom: 'Ubuntu Desktop', famille: 'Linux', mode: 'installer', recipe: rec('ubuntu', 'linux') },
      { fichier: 'gparted.iso', nom: 'GParted (disques)', famille: 'Outils', mode: 'demarrer', recipe: rec('debian-live', 'outil') },
    ],
    images: [], vdisks: [], logiciels: [], defaut: 'ubuntu-24.04.3-desktop-amd64.iso',
    ...p,
  };
}

// ---------------- Un petit analyseur de la syntaxe du chargeur ----------------
// Il découpe chaque ligne en mots (guillemets compris), coupe aux « ; » hors guillemets, suit les blocs
// (function/menuentry { }, if/fi, for/done) et refuse : un guillemet non fermé, un bloc mal fermé, une commande
// inconnue, une variable inconnue, un caractère non ASCII. Il rend les titres des entrées du menu.
const COMMANDES = new Set(['terminal_output', 'set', 'function', 'clear', 'echo', 'loopback', 'configfile', 'export', 'sleep', 'for', 'if', 'then', 'else', 'fi', 'do', 'done', 'chainloader', 'boot', 'menuentry', '}', '[', 'odin_entete', 'odin_ecran', 'odin_demarrer', 'odin_disque']);
const VARIABLES = new Set(['odin_iso', 'vtoy_iso_part', 'd', 'p', 'f', 'vtoydev', 'grub_platform', 'odin_attente']);
function analyser(cfg: string, extraCommandes: string[] = []): { titres: string[]; commandes: string[][] } {
  const permises = new Set([...COMMANDES, ...extraCommandes]);
  assert.ok(/^[\x09\x0a\x20-\x7e]*$/.test(cfg), 'tout le fichier est en ASCII (le mode texte n\'affiche pas l\'Unicode)');
  const pile: string[] = [], titres: string[] = [], commandes: string[][] = [];
  cfg.split('\n').forEach((brute, n) => {
    const ligne = brute.trim();
    if (!ligne || ligne.startsWith('#')) return;
    // découpe en instructions et en mots
    const instr: string[][] = [[]];
    let mot = '', guil: '' | '"' | '\'' = '', dansMot = false;
    for (let i = 0; i < ligne.length; i++) {
      const c = ligne[i];
      if (guil) {
        if (c === guil) { guil = ''; continue; }
        if (guil === '"' && c === '\\') { mot += ligne[++i] ?? ''; continue; }
        if (guil === '"' && c === '$') {
          const m = /^\$\{([A-Za-z_][A-Za-z0-9_]*)\}/.exec(ligne.slice(i));
          assert.ok(m && VARIABLES.has(m[1]), `ligne ${n + 1} : variable inattendue dans « ${ligne} »`);
        }
        mot += c; continue;
      }
      if (c === '"' || c === '\'') { guil = c; dansMot = true; continue; }
      if (c === '$') { const m = /^\$\{([A-Za-z_][A-Za-z0-9_]*)\}/.exec(ligne.slice(i)); assert.ok(m && VARIABLES.has(m[1]), `ligne ${n + 1} : variable inattendue`); }
      if (c === ' ' || c === '\t') { if (dansMot) { instr[instr.length - 1].push(mot); mot = ''; dansMot = false; } continue; }
      if (c === ';') { if (dansMot) { instr[instr.length - 1].push(mot); mot = ''; dansMot = false; } instr.push([]); continue; }
      assert.ok(!'{}'.includes(c) || i === ligne.length - 1, `ligne ${n + 1} : accolade au milieu d'une ligne « ${ligne} »`);
      mot += c; dansMot = true;
    }
    assert.equal(guil, '', `ligne ${n + 1} : guillemet non fermé « ${ligne} »`);
    if (dansMot) instr[instr.length - 1].push(mot);
    for (const w of instr.filter((x) => x.length)) {
      const cmd = w[0] === 'then' || w[0] === 'do' || w[0] === 'else' ? w.slice(1) : w;
      if (w[0] === 'then' || w[0] === 'do') { if (!cmd.length) continue; }
      if (!cmd.length) continue;
      assert.ok(permises.has(cmd[0]), `ligne ${n + 1} : commande inconnue « ${cmd[0]} »`);
      commandes.push(cmd);
      if (cmd[0] === 'function') { assert.equal(cmd[cmd.length - 1], '{'); pile.push('{'); }
      else if (cmd[0] === 'menuentry') { assert.equal(cmd[cmd.length - 1], '{', `ligne ${n + 1} : entrée sans {`); titres.push(cmd[1]); pile.push('{'); }
      else if (cmd[0] === '}') assert.equal(pile.pop(), '{', `ligne ${n + 1} : } sans bloc`);
      else if (cmd[0] === 'if') pile.push('if');
      else if (cmd[0] === 'fi') assert.equal(pile.pop(), 'if', `ligne ${n + 1} : fi sans if`);
      else if (cmd[0] === 'for') pile.push('for');
      else if (cmd[0] === 'done') assert.equal(pile.pop(), 'for', `ligne ${n + 1} : done sans for`);
      else if (cmd[0] === 'menuentry' || cmd.includes('{')) assert.fail(`ligne ${n + 1} : accolade inattendue`);
    }
  });
  assert.deepEqual(pile, [], 'tous les blocs sont fermés');
  return { titres, commandes };
}

test('C7 · couleurs du thème texte et Odin figé (deux yeux blancs, rien d\'autre), pour chaque thème', () => {
  for (const th of TEXT_THEME_IDS) {
    const cfg = buildMenuTexte(prep({ texte: th }));
    analyser(cfg);
    const c = couleursMenuTexte(th);
    for (const x of [c.normal, c.choisi, c.titre, c.discret]) for (const n of x.split('/')) assert.ok(NOMS_COULEURS_GRUB.includes(n), `${th} : ${n} est une couleur du chargeur`);
    assert.ok(cfg.includes(`set menu_color_normal=${c.normal}`), `${th} : couleur du texte`);
    assert.ok(cfg.includes(`set menu_color_highlight=${c.choisi}`), `${th} : couleur de la ligne choisie`);
    if (th !== 'classique') {
      const t = TEXT_THEMES[th];
      assert.equal(c.normal, `${couleurGrub(t.fg)}/black`, `${th} : texte pris du thème`);
      assert.ok(c.choisi.endsWith(`/${couleurGrub(t.selBg)}`), `${th} : ligne choisie prise du thème`);
    }
    // Odin figé : un corps à la couleur du thème (jamais blanc) et exactement deux yeux blancs.
    assert.notEqual(c.corps, 'white');
    assert.equal((cfg.match(/set color_normal=white\/white/g) || []).length, 2, `${th} : deux yeux`);
    assert.ok(cfg.includes(`set color_normal=${c.corps}/${c.corps}`), `${th} : le corps à la couleur du thème`);
    for (const interdit of ['bouche', 'sourcil', 'joue', 'mouth', 'brow', 'cheek']) assert.ok(!cfg.toLowerCase().includes(interdit));
    assert.ok(cfg.includes('echo "    O D I N"'));
  }
  // Deux thèmes différents donnent deux menus différents.
  assert.notEqual(couleursMenuTexte('matrix').choisi, couleursMenuTexte('neon').choisi);
});

test('C7 · entrées numérotées dans l\'ordre choisi, G, D, barre en caractères, délai et entrée par défaut', () => {
  const cfg = buildMenuTexte(prep());
  const { titres, commandes } = analyser(cfg);
  assert.deepEqual(titres, [' 1  Windows 11', ' 2  Ubuntu Desktop', ' 3  GParted (disques)', ' G  Passer en mode graphique', ' D  Demarrer sur le disque du PC', 'ODIN', 'VTOY_RET']);
  assert.match(cfg, /--id odin-1 --hotkey=1/);
  assert.match(cfg, /--id odin-graphique --hotkey=g/);
  assert.match(cfg, /--id odin-disque --hotkey=d/);
  // Le délai : 7 secondes déroulées, la barre « [####....] » qui avance, Échap arrête l'attente.
  const attentes = cfg.match(/sleep --interruptible 1/g) || [];
  assert.equal(attentes.length, 7);
  assert.match(cfg, /Ubuntu Desktop demarre dans 7 s +\[\.{24}\]/);
  assert.match(cfg, /Ubuntu Desktop demarre dans 1 s +\[#{21}\.{3}\]/);
  assert.match(cfg, /Echap : choisir moi-meme/);
  assert.ok(cfg.includes('set default=odin-2'), 'le système par défaut (le 2e dans l\'ordre)');
  assert.ok(cfg.includes('if [ "${odin_attente}" = "oui" ]; then set timeout=0; else set timeout=-1; fi'));
  // Le disque du PC : le premier disque qui n'est pas la clé, sans rien y écrire.
  assert.ok(commandes.some((c) => c[0] === 'chainloader'));
  assert.ok(cfg.includes('if [ "${d}" != "${vtoydev}" ]; then'));
  // Sans système par défaut : c'est le disque du PC qui démarre seul, jamais un installateur pris au hasard.
  const sansDefaut = buildMenuTexte(prep({ defaut: undefined }));
  assert.ok(sansDefaut.includes('set default=odin-disque'));
  assert.match(sansDefaut, /Demarrer sur le disque du PC demarre dans 7 s/);
  // Délai 0 : aucune attente, on attend qu'on choisisse.
  const zero = buildMenuTexte(prep({ delai: 0 }));
  analyser(zero);
  assert.ok(!zero.includes('sleep --interruptible'));
  assert.ok(zero.includes('set timeout=-1'));
  // Un délai énorme est borné.
  assert.equal((buildMenuTexte(prep({ delai: 99999 })).match(/sleep --interruptible 1/g) || []).length, 300);
  // Le mode graphique (lot C6) : quand son image est sur la clé, G la démarre.
  const g = buildMenuTexte(prep(), { graphique: '/ecran-odin/odin-ecran.iso' });
  assert.ok(g.includes('set odin_iso="/ecran-odin/odin-ecran.iso"'));
  assert.ok(!buildMenuTexte(prep(), { graphique: '/x";reboot;"' }).includes('reboot'), 'chemin du mode graphique piégé refusé');
});

test('C7 · un nom piégé est neutralisé (guillemets, retours à la ligne, accolades, commandes du chargeur)', () => {
  const pieges = [
    'Ubuntu" ; reboot ; menuentry "x" {',
    'Win\'dows\n}\nmenuentry pirate {\nreboot\n}',
    '${prefix} $(halt) `halt` \\ ; & | > <',
    'Debian\r\nset root=(hd0)\r\nchainloader +1',
    '--hotkey=1 --id odin-disque',
  ];
  const p = prep({
    systemes: [
      ...pieges.map((nom, i) => ({ fichier: `s${i}.iso`, nom, famille: 'Linux' as const, mode: 'demarrer' as const, recipe: rec('ubuntu', 'linux') })),
      { fichier: '../../etc/x.iso', nom: 'Chemin', famille: 'Linux', mode: 'demarrer', recipe: rec('ubuntu', 'linux') },
      { fichier: 'a";reboot;".iso', nom: 'Fichier', famille: 'Linux', mode: 'demarrer', recipe: rec('ubuntu', 'linux') },
    ],
    defaut: undefined,
  });
  const cfg = buildMenuTexte(p);
  const { titres, commandes } = analyser(cfg);
  // Autant d'entrées que de systèmes (+ G, D, retour) : aucune entrée en plus, aucune commande en plus.
  assert.equal(titres.length, pieges.length + 2 + 4);
  assert.ok(!commandes.some((c) => ['reboot', 'halt'].includes(c[0])));
  assert.ok(!cfg.includes('$(') && !cfg.includes('`') && !cfg.includes('${prefix}'));
  for (const t of titres) assert.ok(!/["'{};\\$\r\n]/.test(t), `titre sûr : ${t}`);
  // Le 2e piège ne crée pas d'entrée « pirate », l'option piégée n'est pas une vraie option.
  assert.ok(!titres.some((t) => t === 'pirate'));
  // (entre guillemets, « --id odin-disque » n'est qu'un titre ; la vraie option n'existe qu'une fois)
  assert.equal((cfg.match(/^menuentry .*" --id odin-disque /gm) || []).length, 1);
  // Un fichier au nom refusé reste à sa place dans la liste, mais ne démarre rien : il renvoie à la liste complète.
  assert.ok(!cfg.includes('/ISO/../'));
  assert.equal((cfg.match(/set odin_iso=/g) || []).length, pieges.length);
  assert.match(cfg, /Le menu texte refuse le nom de ce fichier/);
  // Le nom affiché : ASCII, 60 signes au plus.
  assert.equal(nomMenuTexte('Élégant « Linux » ' + 'x'.repeat(200)).length <= 60, true);
  assert.equal(nomMenuTexte('Élégant « Linux »'), 'Elegant Linux');
});

test('C7 · rien de personnel ni de secret dans le menu', () => {
  const cfg = buildMenuTexte(prep({ motDePasse: { hash: 'a'.repeat(64), sel: 'b'.repeat(32) } as never }));
  assert.ok(!cfg.includes('a'.repeat(16)) && !cfg.includes('b'.repeat(16)), 'ni empreinte ni sel du mot de passe');
  assert.ok(!/password|passwd|mot de passe/i.test(cfg));
});

test('C7 · graphique par défaut, délai réglable ; ventoy.json ouvre le menu texte quand le texte est choisi', () => {
  assert.deepEqual(reglagesDemarrage({}), { modeDefaut: 'graphique', delai: 10 });
  assert.deepEqual(reglagesDemarrage(undefined), { modeDefaut: 'graphique', delai: 10 });
  assert.deepEqual(reglagesDemarrage({ modeDefaut: 'n importe quoi', delai: 'x' }), { modeDefaut: 'graphique', delai: 10 });
  assert.deepEqual(reglagesDemarrage({ modeDefaut: 'texte', delai: 4.6 }), { modeDefaut: 'texte', delai: 5 });
  assert.deepEqual(reglagesDemarrage({ modeDefaut: 'texte', delai: -3 }), { modeDefaut: 'texte', delai: 0 });
  assert.deepEqual(reglagesDemarrage({ delai: 1e9 }), { modeDefaut: 'graphique', delai: 300 });
  // Graphique : ventoy.json garde son menu graphique, son défaut et son délai.
  const g = JSON.parse(buildVentoyJson(prep({ modeDefaut: 'graphique' })));
  const cg = Object.assign({}, ...g.control);
  assert.equal(g.theme.display_mode, 'GUI');
  assert.equal(cg.VTOY_DEFAULT_IMAGE, '/ISO/ubuntu-24.04.3-desktop-amd64.iso');
  assert.equal(cg.VTOY_MENU_TIMEOUT, '7');
  // Texte : le mode texte du chargeur, et son menu F6 (le menu texte d'Odin) ouvert tout de suite.
  const t = JSON.parse(buildVentoyJson(prep({ modeDefaut: 'texte' })));
  const ct = Object.assign({}, ...t.control);
  assert.equal(t.theme.display_mode, 'CLI');
  // (relecture C7 : le titre FIXE de l'entrée « ODIN », qui existe bien dans le menu texte)
  assert.equal(ct.VTOY_DEFAULT_IMAGE, 'F6>ODIN');
  assert.equal(ct.VTOY_MENU_TIMEOUT, '0');
});

test('C7 · même ordre et mêmes noms que le menu graphique (écran hors ligne)', () => {
  const p = prep({ systemes: [...prep().systemes].reverse() });
  const etat = JSON.parse(buildersParDefaut.buildEcranOffline(p).fichiers['systemes.json']);
  const graphique = (etat.systemes as Array<{ title: string; id: string }>).map((s) => [s.id, s.title]);
  const texte = entreesMenuCle(p).map((e) => [e.fichier, e.nom]);
  assert.deepEqual(texte, graphique);
  const { titres } = analyser(buildMenuTexte(p));
  assert.deepEqual(titres.slice(0, 3), entreesMenuCle(p).map((e) => ` ${e.numero}  ${nomMenuTexte(e.nom)}`));
});

test('C7 · textes dans un dictionnaire, toutes les langues en ASCII ; langue inconnue : l\'anglais', () => {
  for (const l of Object.keys(TEXTES_MENU_TEXTE)) {
    const cfg = buildMenuTexte(prep({ langue: l }));
    analyser(cfg);
    const t = textesMenuTexte(l);
    assert.ok(cfg.includes(t.graphique) && cfg.includes(t.disque), l);
  }
  assert.equal(textesMenuTexte('fr').disque, 'Demarrer sur le disque du PC', 'les accents deviennent des lettres simples');
  assert.equal(textesMenuTexte('de-DE').graphique, 'In den Grafikmodus wechseln');
  assert.deepEqual(textesMenuTexte('zz'), textesMenuTexte('en'));
  assert.deepEqual(textesMenuTexte(undefined), textesMenuTexte('en'));
});
