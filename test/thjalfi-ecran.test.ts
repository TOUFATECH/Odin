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
  // Lot C6 : les textes de l'écran sont dans son dictionnaire (toutes les langues) ; « Serveur Odin » en est un mot.
  assert.match(p, /"ligne\.serveur":"Serveur Odin"/, 'le mot « Serveur Odin »');
  assert.match(p, /M\('ligne\.serveur'\)\+' '\+S\.serveur/, 'la ligne serveur lit S.serveur');
});

test('premier écran en mode clé : la ligne de la clé dès le chargement (sans attendre /ecran/etat)', () => {
  const p = ecranPage();
  // Maquette validée (lot C6) : dès le chargement, l'arrivée dit « Clé USB ODIN · préparation du menu » (ou
  // « Démarrage par le réseau · préparation du menu »), et la barre du menu « démarrage depuis la clé » (ou « par
  // le réseau ») : la seule ligne qui change entre la clé et le réseau.
  assert.match(p, /\$\('#premierSrv'\)\.textContent = M\(CLE \? 'arrivee\.cle' : 'arrivee\.reseau'\)/, 'la ligne d\'arrivée, clé ou réseau');
  assert.match(p, /\$\('#logoSub'\)\.textContent = M\(CLE \? 'barre\.cle' : 'barre\.reseau'\)/, 'la barre dit « depuis la clé » ou « par le réseau »');
  assert.match(p, /"arrivee\.cle":"Clé USB ODIN · préparation du menu"/);
  assert.match(p, /"barre\.cle":"démarrage depuis la clé"/);
});
