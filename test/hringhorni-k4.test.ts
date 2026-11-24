// Hringhorni, lot K4 (maquette « Conteneurs et machines » validée le 23/11) : le catalogue, sans navigateur, sans
// moteur, sans réseau. Ce qui est vérifié :
// - la liste est écrite dans le code (8 à 12 applis), chaque image épinglée (nom + étiquette précise, jamais « latest ») ;
// - chaque appli est une composition qui passe par TOUTE l'analyse du lot K3, sans aucun refus ni réserve, même avec
//   la garde de ce PC (dossiers d'Odin, personnels, du moteur) : volumes nommés seulement, mémoire au plus partout ;
// - une appli qui demanderait un droit refusé passerait par les mêmes refus (aucune exception pour le catalogue) ;
// - ports proposés vérifiés libres (le suivant libre sinon, dit), nom de pile libre, mots de passe internes neufs ;
// - les noms d'autres produits ne sont que dans « alternativeA » ;
// - aucun service tiers consulté : le module n'appelle ni le réseau ni un programme.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CATALOGUE, decouperImage, entreeCatalogue, marques, nomLibre, octetsMemoire, placerPorts, preparer, remplirComposition, secretNeuf, servicesDe, type EntreeCatalogue } from '../src/valhalla/hringhorni/catalogue.ts';
import { NOM_PILE } from '../src/valhalla/hringhorni/composition.ts';
import { parseRef } from '../src/valhalla/hringhorni/registry.ts';
import { APPS_RANGE, ODIN_PORTS, WEB } from '../src/valhalla/ports.ts';

const GARDE = { maison: '/home/moi', odin: '/home/moi/.odin', moteur: '/var/lib/odin/hringhorni', autres: ['/home/moi/.odin-cle'] };

test('la liste : 8 à 12 applis écrites dans Odin, noms uniques et valides, chacune décrite', () => {
  assert.ok(CATALOGUE.length >= 8 && CATALOGUE.length <= 12, String(CATALOGUE.length));
  assert.equal(new Set(CATALOGUE.map((e) => e.id)).size, CATALOGUE.length);
  for (const e of CATALOGUE) {
    assert.match(e.id, NOM_PILE, e.id);
    for (const k of ['nom', 'categorie', 'quoi', 'premiere'] as const) assert.ok(e[k].trim().length > 2, `${e.id}.${k}`);
    assert.ok(e.alternativeA.length >= 1, e.id);
    assert.ok(e.ports.length >= 1 && e.ports.some((p) => p.web), e.id);
    assert.equal(entreeCatalogue(e.id), e);
  }
  assert.equal(entreeCatalogue('inconnue'), undefined);
  assert.equal(entreeCatalogue('__proto__'), undefined);
});

test('chaque image est épinglée : nom et étiquette précise (jamais « latest » ni une étiquette qui bouge)', () => {
  for (const e of CATALOGUE) {
    const p = preparer(e);
    assert.ok(p.images.length >= 1, e.id);
    for (const i of p.images) {
      const r = parseRef(i), d = decouperImage(i);
      assert.notEqual(r.tag, 'latest', i);
      assert.equal(d.etiquette, r.tag, i);
      assert.match(r.tag, /\d+\.\d+|pg\d+-v\d/, `${i} : une version précise`);
      assert.doesNotMatch(r.tag, /^(stable|release|edge|main|master|nightly|develop|dev|lts|current)$/i, i);
    }
  }
});

test('chaque appli passe TOUTE l\'analyse du lot K3 sans refus ni réserve, même avec la garde de ce PC', () => {
  for (const e of CATALOGUE) {
    for (const garde of [{}, GARDE]) {
      const p = preparer(e, { garde });
      assert.equal(p.analyse.ok, true, `${e.id} : ${p.analyse.refus.join(' | ')}`);
      assert.deepEqual(p.analyse.constats.filter((c) => c.ton !== 'ok'), [], e.id);
      for (const s of p.analyse.services) {
        // des volumes nommés seulement, jamais un dossier de ce PC ; une mémoire au plus ; jamais le réseau « aucun » par erreur
        assert.ok(s.montages.every((m) => m.volume && !m.host), `${e.id}/${s.service} : volumes nommés seulement`);
        assert.ok(octetsMemoire(s.memory) > 0, `${e.id}/${s.service} : mémoire`);
        assert.equal(s.reseau, `pile-${p.nom}`, `${e.id}/${s.service} : le réseau à part de la pile`);
      }
      // ses volumes à elle (préfixés par le nom de la pile) : les seuls que l'effacement pourra toucher
      assert.ok(p.volumes.length >= 1 && p.volumes.every((v) => v.startsWith(`${p.nom}_`)), e.id);
      assert.ok(p.memoire > 0);
    }
  }
});

test('aucune exception : une appli qui demanderait un droit refusé serait refusée par les mêmes règles', () => {
  const base = CATALOGUE.find((e) => e.id === 'site')!;
  const pieges: Array<[string, RegExp]> = [
    [base.composition.replace('    mem_limit: 128m\n', '    mem_limit: 128m\n    privileged: true\n'), /tous les droits/],
    [base.composition.replace('["pages:/usr/share/nginx/html:ro"]', '["/:/hote"]'), /disque entier/],
    [base.composition.replace('["pages:/usr/share/nginx/html:ro"]', '["/home/moi/Images:/photos"]'), /dossier personnel/],
    [base.composition.replace('["pages:/usr/share/nginx/html:ro"]', '["/var/run/docker.sock:/s"]'), /socket/],
    [base.composition.replace('    mem_limit: 128m\n', '    mem_limit: 128m\n    network_mode: host\n').replace('    ports: ["{{port:web}}:80"]\n', ''), /réseau de la machine/],
    [base.composition.replace('    mem_limit: 128m\n', '    mem_limit: 128m\n    devices: ["/dev/sda:/dev/sda"]\n'), /périphérique/],
  ];
  for (const [composition, raison] of pieges) {
    const e: EntreeCatalogue = { ...base, composition };
    const p = preparer(e, { garde: GARDE });
    assert.equal(p.analyse.ok, false, composition);
    assert.match(p.analyse.refus.join('\n'), raison);
  }
});

test('ports : celui proposé s\'il est libre, sinon le suivant libre (et c\'est dit) ; jamais un port d\'Odin', () => {
  const tous = CATALOGUE.flatMap((e) => e.ports.map((p) => p.propose));
  assert.equal(new Set(tous).size, tous.length, 'deux applis ne proposent pas le même port');
  for (const p of tous) {
    assert.ok(p >= APPS_RANGE[0] && p <= APPS_RANGE[1], `${p} dans la plage des applis`);
    assert.notEqual(p, WEB); assert.ok(!ODIN_PORTS.some((x) => x.port === p), String(p));
  }
  const notes = entreeCatalogue('notes')!;
  assert.deepEqual(placerPorts(notes, new Map()), { ports: { web: 20300 }, deplaces: [] });
  const r = placerPorts(notes, new Map([[20300, 'un programme de ce PC l\'écoute déjà'], [20301, 'galerie']]));
  assert.deepEqual(r.ports, { web: 20302 });
  assert.deepEqual(r.deplaces, [{ cle: 'web', voulu: 20300, donne: 20302, raison: 'un programme de ce PC l\'écoute déjà' }]);
  // la préparation le reprend, et l'analyse dit le port libre
  const p = preparer(notes, { garde: { portsPris: new Map([[20300, 'x']]) } });
  assert.equal(p.ports[0].hote, 20301); assert.equal(p.analyse.ok, true);
  // des ports confirmés déjà pris : refusés par l'analyse (rien n'est deviné)
  const q = preparer(notes, { garde: { portsPris: new Map([[20300, 'galerie']]) }, ports: { web: 20300 } });
  assert.equal(q.analyse.ok, false); assert.match(q.analyse.refus.join('\n'), /20300 : déjà pris sur ce PC \(galerie\)/);
});

test('nom de pile libre : « photos », puis « photos-2 » ; ni une pile, ni un conteneur, ni un réseau qui porte déjà ce nom', () => {
  const e = entreeCatalogue('photos')!;
  assert.deepEqual(servicesDe(e), ['serveur', 'cache', 'base']);
  assert.equal(nomLibre(e), 'photos');
  assert.equal(nomLibre(e, { piles: ['photos'] }), 'photos-2');
  assert.equal(nomLibre(e, { piles: ['photos'], conteneurs: ['photos-2-base'] }), 'photos-3');
  assert.equal(nomLibre(e, { reseaux: ['pile-photos'] }), 'photos-2');
  const p = preparer(e, { garde: { piles: ['photos'] } });
  assert.equal(p.nom, 'photos-2'); assert.deepEqual(p.volumes, ['photos-2_bibliotheque', 'photos-2_base']);
  assert.deepEqual(p.analyse.ordre, ['base', 'cache', 'serveur']);
});

test('mots de passe internes : tirés au hasard à chaque préparation, jamais écrits dans le code ; une marque oubliée est refusée', () => {
  const e = entreeCatalogue('photos')!;
  assert.deepEqual(marques(e), { ports: ['web'], secrets: ['base'] });
  const a = preparer(e), b = preparer(e);
  const mdp = (t: string) => /POSTGRES_PASSWORD: "([^"]+)"/.exec(t)![1];
  assert.notEqual(mdp(a.texte), mdp(b.texte));
  assert.match(mdp(a.texte), /^[A-Za-z0-9_-]{32}$/);
  // l'appli et sa base reçoivent le même
  assert.equal(/DB_PASSWORD: "([^"]+)"/.exec(a.texte)![1], mdp(a.texte));
  const srv = a.analyse.services.find((s) => s.service === 'serveur')!, db = a.analyse.services.find((s) => s.service === 'base')!;
  assert.equal(srv.env.DB_PASSWORD, db.env.POSTGRES_PASSWORD);
  // la commande de la base garde son « $user » (écrit « $$user » : jamais une variable de ce PC)
  assert.ok(db.cmd?.includes('search_path="$user", public, vectors'), JSON.stringify(db.cmd));
  for (const c of CATALOGUE) assert.doesNotMatch(c.composition, /PASSWORD: "(?!\{\{secret:)/, c.id);
  assert.throws(() => remplirComposition(e, {}, { base: secretNeuf() }), /port « web » manquant/);
  assert.throws(() => remplirComposition(e, { web: 20070 }, { base: 'court' }), /secret « base »/);
  assert.throws(() => remplirComposition(e, { web: 20070 }, { base: 'a$b'.repeat(8) }), /secret « base »/);
  assert.throws(() => remplirComposition({ ...e, composition: `${e.composition}# {{autre}}\n` }, { web: 1 }, { base: secretNeuf() }), /marque inconnue/);
});

test('les noms d\'autres produits ne sont que dans « alternativeA »', () => {
  const produits = [...new Set(CATALOGUE.flatMap((e) => e.alternativeA))];
  for (const e of CATALOGUE) {
    const texte = [e.nom, e.categorie, e.quoi, e.premiere, e.note ?? '', ...e.ports.map((p) => p.quoi)].join(' ').toLowerCase();
    for (const p of produits) assert.ok(!texte.includes(p.toLowerCase()), `${e.id} : « ${p} » hors de « Alternative à »`);
    assert.doesNotMatch(texte, /docker|podman|portainer|kubernetes|compose\b/i, e.id);
    // les services de sa pile ont des noms ordinaires (ils deviennent les noms des conteneurs)
    for (const s of servicesDe(e)) assert.match(s, /^(serveur|cache|base)$/, `${e.id}/${s}`);
  }
});

test('aucun service tiers consulté pour le catalogue : rien n\'appelle le réseau ni un programme', () => {
  const src = readFileSync(new URL('../src/valhalla/hringhorni/catalogue.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /\bfetch\(|node:https?|node:net|node:dgram|node:child_process|\bspawn|(?<!\.)\bexec\(/);
  const avant = globalThis.fetch;
  globalThis.fetch = (() => { throw new Error('le catalogue ne doit pas sortir'); }) as never;
  try { for (const e of CATALOGUE) preparer(e, { garde: GARDE }); } finally { globalThis.fetch = avant; }
});
