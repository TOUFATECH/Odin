// Les sortes de widgets de la fenêtre d'Odin (maquette validée « Accueil », lot 23) : la liste des sortes vit dans les
// fichiers de famille (src/valhalla/widgets/), et plus en dur dans Hestia (constat M14). Une fenêtre enregistrée avant
// ce changement se relit et se réenregistre à l'octet près ; une sorte inconnue (ou pas encore posable) est jetée ; un
// réglage trop long est coupé ; chaque sorte a un public, et sans public écrit c'est « propriétaire seul » (constat
// M12) ; les cinq sortes de l'accueil ne vont jamais à l'écran de la maison ni ne se copient (constat G4).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Valhalla } from '../src/valhalla/service.ts';
import { allModules, setValhalla } from '../src/valhalla/odin.ts';
import { DEFAULT_CONFIG } from '../src/config.ts';
import { TAILLE_SORTE, cleanLayout, resetGladsheim, type Widget } from '../src/valhalla/modules/gladsheim.ts';
import { SORTES, accueilSeulement, copiable, publicDe, servieALaMaison, sorteDe, sortesPosables, type SorteWidget } from '../src/valhalla/widgets/index.ts';
import { SORTES_INFOS } from '../src/valhalla/widgets/infos.ts';
import { SORTES_ODIN } from '../src/valhalla/widgets/odin.ts';
import { SORTES_MAISON } from '../src/valhalla/widgets/maison.ts';
import { SORTES_AUJOURDHUI } from '../src/valhalla/widgets/aujourdhui.ts';
import { SORTES_VEILLE } from '../src/valhalla/widgets/veille.ts';
import { SORTES_LISTES } from '../src/valhalla/widgets/listes.ts';

const IDS = ['midgard', 'vidarr', 'vordr', 'gjoll', 'ran'];
const un = (w: Record<string, unknown>) => cleanLayout({ pages: [{ name: 'P', widgets: [w] }] }, IDS).pages[0].widgets[0] as Widget | undefined;

/**
 * Le fichier de réglages de Hestia (valhalla/gladsheim/réglages.json) tel que l'écrivait Odin AVANT ce lot : produit par
 * « Ranger ma fenêtre » (regler_fenetre) avec le code du dépôt d'avant, puis recopié ici tel quel. Les six sortes y sont,
 * avec des tailles d'ordinateur et de téléphone, un libellé, des réglages de bouton et une page « écran de la maison ».
 */
const FICHIER_AVANT = `{
  "fenetre": {
    "pages": [
      {
        "id": "a1b2c3d4",
        "name": "Maison",
        "maison": true,
        "widgets": [
          {
            "id": "b0000001",
            "kind": "heure",
            "w": 1,
            "c": 3,
            "r": 2
          },
          {
            "id": "b0000002",
            "kind": "meteo",
            "w": 2,
            "c": 8,
            "r": 3,
            "pc": 4,
            "pr": 3,
            "label": "Dehors"
          },
          {
            "id": "b0000003",
            "kind": "chiffres",
            "w": 2,
            "c": 6,
            "r": 2,
            "module": "midgard"
          },
          {
            "id": "b0000004",
            "kind": "bouton",
            "w": 1,
            "c": 3,
            "r": 2,
            "module": "gjoll",
            "action": "allumer",
            "label": "VPN",
            "input": {
              "mode": "auto"
            }
          },
          {
            "id": "b0000005",
            "kind": "section",
            "w": 3,
            "c": 12,
            "r": 4,
            "module": "vordr",
            "section": "Sondes",
            "label": "Mes sondes"
          },
          {
            "id": "b0000006",
            "kind": "site",
            "w": 1,
            "c": 4,
            "r": 2,
            "pc": 2,
            "pr": 1,
            "module": "vordr",
            "label": "Mon site"
          }
        ]
      },
      {
        "id": "a1b2c3d5",
        "name": "Réseau",
        "widgets": [
          {
            "id": "b0000009",
            "kind": "chiffres",
            "w": 3,
            "c": 12,
            "r": 2,
            "module": "vidarr"
          }
        ]
      }
    ]
  }
}`;

function odinAvecFichier(texte: string) {
  const home = mkdtempSync(join(tmpdir(), 'widgets-modele-'));
  const dir = join(home, 'valhalla', 'gladsheim'); mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'réglages.json'), texte);
  const v = new Valhalla(home, allModules({ paths: { home, workspace: home }, cfg: DEFAULT_CONFIG } as never), { run: async () => ({ code: 1, out: '', err: '' }), fetch: (async () => { throw new Error('réseau coupé par le test'); }) as typeof fetch, notify: async () => {}, autonomy: () => 'equilibre' });
  setValhalla(v); resetGladsheim();
  return { v, fichier: join(dir, 'réglages.json'), end: () => { setValhalla(undefined); v.stop(); rmSync(home, { recursive: true, force: true }); } };
}

test('une fenêtre enregistrée avant ce lot se relit identique, et se réenregistre à l\'octet près', async () => {
  const o = odinAvecFichier(FICHIER_AVANT);
  try {
    const avant = (JSON.parse(FICHIER_AVANT) as { fenetre: unknown }).fenetre;
    const lu = await o.v.act('gladsheim', 'fenetre', {});
    assert.equal(lu.ok, true);
    // Lot 26 : la page « Aujourd'hui » arrive en premier à la lecture ; le fichier, lui, n'est pas touché.
    const lue = lu.data as { pages: Array<{ code?: string }> };
    assert.equal(lue.pages[0].code, 'aujourdhui'); assert.equal(readFileSync(o.fichier, 'utf8'), FICHIER_AVANT, 'lire ne réécrit rien');
    // Mêmes pages, mêmes modules, mêmes champs, dans le même ordre (aucune animation choisie : rien d'ajouté).
    // Lot 27 : la fenêtre lue porte la marque de ce qu'elle a reçu ; une page ouverte avant la mise à jour ne la renvoie pas.
    const { accueil, ...sansMarque } = lue as { pages: Array<{ code?: string }>; accueil?: number };
    // Lot 27, troisième part : 4 depuis les quatre tuiles d'état.
    assert.equal(accueil, 4, 'lot 27, troisième part : 4 depuis les quatre tuiles d\'état');
    const pagesDAvant = { ...sansMarque, pages: lue.pages.slice(1) };
    assert.equal(JSON.stringify(pagesDAvant), JSON.stringify(avant), 'la fenêtre relue est celle du fichier, champ pour champ');
    // Rangée telle qu'avant (une page ouverte avant la mise à jour) : le fichier réécrit est le même, octet pour octet.
    const r = await o.v.act('gladsheim', 'regler_fenetre', { fenetre: JSON.stringify(pagesDAvant) });
    assert.equal(r.ok, true, r.text);
    assert.equal(readFileSync(o.fichier, 'utf8'), FICHIER_AVANT, 'réglages.json inchangé');
  } finally { o.end(); }
});

test('cleanLayout lit les sortes dans les fichiers de famille : plus de liste écrite en dur dans Hestia', () => {
  const src = readFileSync(new URL('../src/valhalla/modules/gladsheim.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /\['chiffres', 'section'/, 'la liste des sortes acceptées n\'est plus dans gladsheim.ts');
  assert.doesNotMatch(src, /chiffres: \{ mini:/, 'les tailles des sortes ne sont plus dans gladsheim.ts');
  // Les six sortes posables d'avant et leurs tailles, plus les trois blocs du jour (lot 26), « Comment Odin se comporte »
  // et le widget des cinq chiffres, « chiffres_cles » (lot 27), puis les quatre tuiles d'état (lot 27, troisième part).
  // Puis les trois petits chiffres de la famille « Infos » de la maquette : l'heure, la météo, les alertes pas encore
  // vues (2 × 1 ; l'horloge, elle, est un style de « heure », pas une sorte). Puis la famille « veille » : la liste des
  // alertes, les sites d'Arachné et leur petit chiffre. Puis la famille « listes » : l'agenda de Chronos et les
  // recherches de Pythie (propriétaire seul), puis les sauvegardes de Phénix et les pubs bloquées par Sphinx (seconde part,
  // propriétaire seul).
  assert.deepEqual(sortesPosables().map((x) => x.id).sort(), ['a_faire', 'alertes', 'application', 'bouton', 'chiffres', 'chiffres_cles', 'comportement','heure', 'heure_petite', 'meteo', 'meteo_petite', 'odin_a_fait', 'resume_matin', 'sauvegarde', 'section', 'site', 'surveillance', 'tu_veux', 'alertes_liste', 'sites', 'sites_petit', 'agenda', 'recherches', 'sauvegardes', 'pubs_bloquees',
    // puis le widget de n'importe quelle appli (famille « applis »), dont l'appli se choisit
    'appli',
    // et ses raccourcis : les applis épinglées de qui regarde (famille « applis », seconde sorte)
    'raccourcis',
    // puis la famille « automatisations » : ses automatisations de Talos et ce qui part aujourd'hui (propriétaire seul)
    'automatisations', 'taches_planifiees',
    // puis « Stockage » : les volumes, partages et disques de la machine d'Odin, lus par Pyramide (famille « stockage »)
    'stockage',
    // puis « Réseau » : les appareils du réseau, lus dans le registre d'Odin, et le débit d'Ariane (famille « reseau », propriétaire seul)
    'reseau',
    // puis « Santé » : la santé de la machine d'Odin (Hygie) et de ses disques (Tirésias), à qui a le droit sur l'appli lue
    'sante_machine', 'sante_disques',
    // puis les six petits chiffres de la maison (famille « maison ») : allumés, lumières, serrures, température, humidité, watts des prises
    'maison_allumes', 'maison_lumieres', 'maison_serrures', 'maison_temperature', 'maison_humidite', 'maison_watts',
    // puis les appareils de la maison (famille « maison », son propre fichier) : un appareil, une lumière, un capteur, les pièces
    'maison_appareil', 'maison_lumiere', 'maison_capteur', 'maison_pieces',
    // puis la maison d'un coup d'œil (famille « maison », son propre fichier) : ses scènes, le bandeau d'état, « Ma maison »
    'maison_scenes', 'maison_bandeau', 'ma_maison',
    // puis la sécurité de la maison (famille « maison », son propre fichier, propriétaire seul) : « Sécurité » et « Caméra »
    // (suit sa pose : son choix est gardé à l'enregistrement s'il désigne une de ses caméras ; avant : pas encore posable)
    'maison_securite', 'maison_camera',
    // puis le widget « Odin » (famille « odin », son propre fichier, propriétaire seul) : sa phrase du moment, son visage, sa proposition
    'parole',
    // puis la famille « medias » (son propre fichier, propriétaire seul) : « Lecteur » (ses radios et ses listes d'Apollon) et « Messages » (ses conversations récentes)
    'lecteur', 'messages',
    // puis la présence (famille « maison », son propre fichier, propriétaire seul) : « À la maison » (le petit chiffre) et « Famille »
    'maison_presence', 'maison_famille',
    // puis les courbes (famille « maison », son propre fichier, propriétaire seul) : « Consommation du jour » et « Énergie de la semaine »
    'maison_conso_jour', 'maison_energie_semaine'].sort());
  assert.deepEqual(TAILLE_SORTE, {
    heure_petite: { mini: [2, 1], r: 1 }, meteo_petite: { mini: [2, 1], r: 1 }, alertes: { mini: [2, 1], r: 1 }, // les petits chiffres « Infos » de la maquette
    alertes_liste: { mini: [3, 2], r: 3 }, sites: { mini: [3, 2], r: 5 }, sites_petit: { mini: [2, 1], r: 1 }, // la famille « veille »
    agenda: { mini: [3, 2], r: 3 }, recherches: { mini: [3, 2], r: 3 }, // la famille « listes »
    sauvegardes: { mini: [3, 2], r: 2 }, pubs_bloquees: { mini: [3, 2], r: 2 }, // sa seconde part
    appli: { mini: [3, 2], r: 2 }, // le widget de n'importe quelle appli (famille « applis »)
    raccourcis: { mini: [3, 2], r: 2 }, // ses raccourcis d'applis épinglées (famille « applis »)
    automatisations: { mini: [4, 2], r: 3 }, taches_planifiees: { mini: [3, 2], r: 3 }, // la famille « automatisations »
    stockage: { mini: [3, 2], r: 4 }, // la famille « stockage » (la maquette : 5 × 4, 3 × 2 au moins)
    reseau: { mini: [3, 2], r: 4 }, // la famille « reseau » (la maquette : 4 × 4, 3 × 2 au moins)
    sante_machine: { mini: [3, 2], r: 2 }, sante_disques: { mini: [3, 2], r: 4 }, // la famille « sante » (la maquette : 4 × 2 et 3 × 4)
    // les petits chiffres de la maison (famille « maison », la maquette : 2 × 1)
    maison_allumes: { mini: [2, 1], r: 1 }, maison_lumieres: { mini: [2, 1], r: 1 }, maison_serrures: { mini: [2, 1], r: 1 },
    maison_temperature: { mini: [2, 1], r: 1 }, maison_humidite: { mini: [2, 1], r: 1 }, maison_watts: { mini: [2, 1], r: 1 },
    // les appareils de la maison (la maquette : la tuile 3 × 1 et la lumière 2 × 1 au plus petit ; ici 3 × 2, pour que
    // toutes les commandes d'un appareil tiennent ; le capteur 3 × 2 ; les pièces 3 × 4, 3 × 3 au plus petit)
    maison_appareil: { mini: [3, 2], r: 2 }, maison_lumiere: { mini: [3, 2], r: 2 }, maison_capteur: { mini: [3, 2], r: 2 }, maison_pieces: { mini: [3, 3], r: 4 },
    // la maison d'un coup d'œil (la maquette : Scènes 4 × 3, Bandeau 12 × 1, Ma maison 6 × 4)
    maison_scenes: { mini: [3, 2], r: 3 }, maison_bandeau: { mini: [4, 1], r: 1 }, ma_maison: { mini: [4, 3], r: 4 },
    // la sécurité de la maison (la maquette : 4 × 3, 3 × 3 au moins ; « Caméra » 4 × 3, 3 × 2 au moins)
    maison_securite: { mini: [3, 3], r: 3 }, maison_camera: { mini: [3, 2], r: 3 },
    // le widget « Odin » (la maquette : 4 × 2, 3 × 2 au moins)
    parole: { mini: [3, 2], r: 2 },
    // la famille « medias » (la maquette : « Lecteur » et « Messages », 4 × 2, 3 × 2 au moins)
    lecteur: { mini: [3, 2], r: 2 }, messages: { mini: [3, 2], r: 2 },
    // la présence (la maquette : « À la maison » 2 × 1 ; « Famille » 3 × 2)
    maison_presence: { mini: [2, 1], r: 1 }, maison_famille: { mini: [3, 2], r: 2 },
    // les courbes (la maquette : « Consommation du jour » 4 × 3, 3 × 2 au moins ; « Énergie de la semaine » 5 × 3, 4 × 3 au moins)
    maison_conso_jour: { mini: [3, 2], r: 3 }, maison_energie_semaine: { mini: [4, 3], r: 3 },
    chiffres: { mini: [2, 1], r: 2 }, section: { mini: [3, 2], r: 3 }, meteo: { mini: [3, 2], r: 3 },
    bouton: { mini: [2, 1], r: 2 }, heure: { mini: [2, 1], r: 2 }, site: { mini: [2, 1], r: 2 },
    a_faire: { mini: [3, 2], r: 4 }, odin_a_fait: { mini: [3, 2], r: 4 }, tu_veux: { mini: [3, 2], r: 2 }, comportement: { mini: [3, 2], r: 2 },
    chiffres_cles: { mini: [3, 2], r: 2 }, // le widget des cinq chiffres (lot 27, deuxième part)
    // les quatre tuiles d'état (lot 27, troisième part)
    surveillance: { mini: [3, 2], r: 2 }, sauvegarde: { mini: [3, 2], r: 2 }, resume_matin: { mini: [3, 2], r: 2 }, application: { mini: [3, 2], r: 2 },
  });
});

test('une famille par fichier, des identifiants uniques', () => {
  const parFichier: Array<[string, readonly SorteWidget[]]> = [['infos', SORTES_INFOS], ['odin', SORTES_ODIN], ['maison', SORTES_MAISON], ['aujourdhui', SORTES_AUJOURDHUI], ['veille', SORTES_VEILLE], ['listes', SORTES_LISTES]];
  for (const [f, l] of parFichier) for (const x of l) assert.equal(x.famille, f, `${x.id} est rangée dans le fichier de sa famille`);
  const ids = SORTES.map((x) => x.id);
  assert.equal(new Set(ids).size, ids.length, 'pas deux sortes du même nom');
  for (const x of SORTES as readonly SorteWidget[]) {
    assert.ok(x.styles.length >= 1, `${x.id} : au moins un style`);
    assert.ok(x.taille.mini[0] >= 1 && x.taille.mini[0] <= 4 && x.taille.mini[1] >= 1 && x.taille.mini[1] <= x.taille.r && x.taille.r <= 7, `${x.id} : tailles dans la grille`);
    assert.ok(x.applis === 'choisie' || Array.isArray(x.applis), `${x.id} : dit ce qu'il lit`);
  }
});

test('une sorte inconnue, ou déclarée mais pas encore posable, est jetée', () => {
  // Lots 26 et 27 : « À faire », « Ce qu'Odin a fait », « Tu veux sans doute » et « Comment Odin se comporte » sont
  // posables ; il ne reste aucune sorte déclarée sans être posable.
  for (const kind of ['inventee', 'script', '', undefined, 'constructor', '__proto__', 'toString', 'Comportement', 'comportement ']) {
    assert.equal(un({ kind, module: 'midgard', section: 'x', action: 'y', label: 'z' }), undefined, `sorte « ${String(kind)} » jetée`);
  }
  // Une appli inventée, ou un site hors de Pulsar : jetés comme avant.
  assert.equal(un({ kind: 'chiffres', module: 'inventee' }), undefined);
  assert.equal(un({ kind: 'site', module: 'vidarr', label: 'Faux' }), undefined);
  assert.equal(un({ kind: 'site', module: 'vordr' }), undefined, 'un site sans nom');
  assert.equal(un({ kind: 'section', module: 'ran' }), undefined, 'une partie de page sans partie');
  assert.equal(un({ kind: 'bouton', module: 'vidarr' }), undefined, 'un bouton sans action');
  // La météo et l'heure ne gardent aucune appli, même si on leur en donne une.
  assert.equal(un({ kind: 'meteo', module: 'midgard' })?.module, undefined);
  assert.equal(un({ kind: 'heure', module: 'midgard' })?.module, undefined);
});

test('un réglage trop long est coupé, les caractères de contrôle retirés', () => {
  const long = 'x'.repeat(500);
  assert.equal(un({ kind: 'heure', label: long })?.label?.length, 40);
  assert.equal(un({ kind: 'meteo', label: `a\u0000b${long}` })?.label, `a b${'x'.repeat(37)}`);
  assert.equal(un({ kind: 'site', module: 'vordr', label: long })?.label?.length, 60);
  assert.equal(un({ kind: 'chiffres', module: 'midgard', label: long })?.label?.length, 40);
  const s = un({ kind: 'section', module: 'ran', section: long, label: long });
  assert.equal(s?.section?.length, 80); assert.equal(s?.label?.length, 40);
  const b = un({ kind: 'bouton', module: 'vidarr', action: long, input: Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`k${i}`, long])) });
  assert.equal(b?.action?.length, 40); assert.equal(b?.label, b?.action, 'sans texte : le nom de l\'action');
  assert.equal(Object.keys(b?.input ?? {}).length, 12); assert.ok(Object.values(b?.input ?? {}).every((v) => v.length === 300));
  const p = cleanLayout({ pages: [{ name: long, widgets: Array.from({ length: 60 }, () => ({ kind: 'heure' })) }] }, IDS).pages[0];
  assert.equal(p.name.length, 24); assert.equal(p.widgets.length, 48);
});

test('un style : seulement l\'un de ceux de la sorte, et rien d\'écrit pour le style de départ', () => {
  for (const x of sortesPosables()) {
    const w = un({ kind: x.id, module: x.id === 'site' || x.id === 'section' ? 'vordr' : 'midgard', section: 'Sondes', label: 'Mon site', action: 'scene', style: x.styles[0] });
    assert.ok(w, x.id); assert.equal('style' in w!, false, `${x.id} : style de départ, rien d'écrit`);
    assert.equal('style' in un({ kind: x.id, module: x.id === 'site' || x.id === 'section' ? 'vordr' : 'midgard', section: 'Sondes', label: 'Mon site', action: 'scene', style: '<script>' })!, false, `${x.id} : style inconnu jeté`);
  }
});

test('chaque sorte a un public ; sans public écrit, c\'est « propriétaire seul »', () => {
  for (const x of SORTES as readonly SorteWidget[]) assert.ok(['proprietaire', 'membre', 'maison'].includes(publicDe(x)), `${x.id} : un public`);
  const sansPublic: SorteWidget = { id: 'essai', famille: 'odin', applis: [], taille: { mini: [2, 1], r: 2 }, styles: ['simple'], posable: false };
  assert.equal(publicDe(sansPublic), 'proprietaire');
  // Une tablette « maison » : seulement les familles « infos » et « maison ».
  for (const x of SORTES as readonly SorteWidget[]) if (publicDe(x) === 'maison') assert.ok(x.famille === 'infos' || x.famille === 'maison', `${x.id} : tablette seulement pour infos et maison`);
});

test('les cinq sortes de l\'accueil du propriétaire : jamais à l\'écran de la maison, jamais copiables', () => {
  // La cinquième : le widget des cinq chiffres, « chiffres_cles » (lot 27, deuxième part) ; puis les quatre tuiles d'état
  // (lot 27, troisième part) : neuf en tout. Le nom de la liste est resté.
  const cinq = ['a_faire', 'odin_a_fait', 'tu_veux', 'comportement', 'chiffres_cles', 'surveillance', 'sauvegarde', 'resume_matin', 'application'];
  for (const k of cinq) {
    const x = sorteDe(k)!;
    assert.ok(x, `${k} déclarée`); assert.equal(x.famille, 'aujourdhui'); assert.equal(x.accueilSeul, true); assert.equal(publicDe(x), 'proprietaire');
    assert.equal(servieALaMaison(k), false, `${k} jamais servie à /maison`); assert.equal(copiable(k), false, `${k} jamais copiable`);
  }
  assert.deepEqual((SORTES as readonly SorteWidget[]).filter((x) => x.accueilSeul).map((x) => x.id).sort(), [...cinq].sort(), 'ces cinq-là, et elles seules');
  // Toute autre sorte posable se copie et peut aller sur l'écran de la maison ; les posables de l'accueil (lot 26), jamais.
  // Suit la marque « jamais sur l'écran de la maison » (raccourcis, liste des alertes, santé des disques, stockage) :
  // une sorte marquée ne se copie pas non plus vers l'autre écran ; toute autre, comme avant.
  for (const x of sortesPosables()) { const reservee = cinq.includes(x.id); assert.equal(copiable(x.id), !reservee && x.jamaisALaMaison !== true, x.id); assert.equal(servieALaMaison(x.id), !reservee, x.id); }
  // Une sorte inconnue : traitée comme réservée, par prudence.
  assert.equal(accueilSeulement('inventee'), true); assert.equal(copiable(undefined), false);
});
