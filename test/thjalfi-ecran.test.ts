// Genèse · après les éditions courtes : la page /ecran montre Odin animé + 3 points au premier chargement, la barre
// au thème et la ligne serveur/clé dans la vue chargement, et bascule sur « Installation clé USB » quand le drapeau
// clé est mis. On vérifie aussi qu'Odin reste YEUX SEULS. La page est un texte statique : on l'inspecte.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ecranPage } from '../src/valhalla/thjalfi/ecran-page.ts';

test('premier chargement : Odin animé + 3 points dans la page', () => {
  const p = ecranPage();
  assert.match(p, /class="premier"/, 'le bloc premier chargement');
  assert.match(p, /<svg class="odin-fige anime"/, 'Odin animé (dessin officiel)');
  assert.match(p, /class="od-points"><i><\/i><i><\/i><i><\/i>/, 'trois points');
  // Yeux seuls : deux pastilles blanches dans l'Odin de la page, aucune bouche/sourcil.
  const odin = /<svg class="odin-fige anime"[\s\S]*?<\/svg>/.exec(p)![0];
  assert.equal((odin.match(/rx="4\.5" fill="#fff"/g) || []).length, 2, 'deux yeux en pastille');
  for (const interdit of ['bouche', 'mouth', 'brow', 'sourcil', 'joue']) assert.ok(!odin.toLowerCase().includes(interdit), interdit);
});

test('vue chargement : barre au thème (accent) + ligne serveur/clé + 3 points', () => {
  const p = ecranPage();
  assert.match(p, /\.pg i\{background:linear-gradient\(90deg,var\(--acc\),#fff\)!important\}/, 'la barre prend l\'accent du thème');
  assert.match(p, /class:'od3'/, 'les 3 points de la vue chargement');
  assert.match(p, /ligneSrc\(\)/, 'la ligne serveur/clé est posée dans le chargement');
});

test('drapeau clé : la page sait afficher « Installation clé USB » et lire S.serveur', () => {
  const p = ecranPage();
  assert.match(p, /CLE=qs\.has\('cle'\)/, 'le drapeau clé vient de l\'URL');
  assert.match(p, /Installation clé USB/, 'le libellé clé');
  assert.match(p, /Serveur Odin '\+S\.serveur|Serveur Odin \+S\.serveur|Serveur Odin '\+ ?S\.serveur/, 'la ligne serveur lit S.serveur');
});

test('premier écran en mode clé : « Installation clé USB » dès le chargement (sans attendre /ecran/etat)', () => {
  const p = ecranPage();
  // Au chargement du script, si CLE, on pose tout de suite la ligne et le sous-titre (c'est l'écran qu'on voit
  // le plus longtemps au démarrage). Sinon, « Odin démarre… » / « démarrage par le réseau » restent le défaut réseau.
  assert.match(p, /if\(CLE\)\{[^}]*premierSrv[^}]*ligneSrc\(\)/, 'premierSrv posé depuis ligneSrc() en mode clé');
  assert.match(p, /if\(CLE\)\{[^}]*logoSub[^}]*Installation clé USB/, 'le sous-titre bascule sur « Installation clé USB »');
});
