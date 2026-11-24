// Hringhorni, lot K3 (maquette « Conteneurs et machines » validée le 23/11) : la composition et les piles.
// - le lecteur YAML strict et borné : ancres, alias, fusions, étiquettes, plusieurs documents, clés « __proto__ »,
//   tabulations, profondeur, taille… refusés (pas de « bombe » de YAML) ;
// - l'analyse d'un fichier de composition : ce qui ouvre la machine est refusé (tous les droits, disque entier,
//   dossiers du système / personnels / d'Odin, socket du moteur, réseau et processus de la machine, capacités
//   dangereuses, périphériques, variables prises sur ce PC…), l'ordre de démarrage suit les dépendances, un cycle
//   est refusé ;
// - les piles chez le moteur : déployer (réseau à part, volumes, conteneurs dans l'ordre), démarrer, arrêter dans
//   l'ordre inverse, supprimer en gardant les volumes, ou en n'effaçant que ses dossiers à elle.
// AUCUN conteneur n'est lancé : le moteur est le vrai, rangé dans un dossier jetable, mais démarrer et arrêter ne
// font que noter l'état (le « gardien » noté est le processus de l'essai, jamais tué : arrêter est remplacé aussi),
// et chaque commande système passe par un faux lanceur.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { analyserComposition, arreterPile, BORNES, demarrerPile, deployerPile, lireYamlStrict, ordreDemarrage, pile, piles, pourquoiRefuserDossier, RefusYaml, supprimerPile, type Garde } from '../src/valhalla/hringhorni/composition.ts';
import { Engine } from '../src/valhalla/hringhorni/engine.ts';
import type { Image } from '../src/valhalla/hringhorni/store.ts';

const dossiers: string[] = [];
const neuf = (p: string) => { const d = mkdtempSync(join(tmpdir(), p)); dossiers.push(d); return d; };
process.env.ODIN_HRINGHORNI_BAUX = neuf('hh-k3-baux-');
after(() => { for (const d of dossiers) rmSync(d, { recursive: true, force: true }); });

const JEUX = `# Composition : plusieurs conteneurs ensemble (une pile)
services:
  monde:
    image: registre.example.org/serveur-jeu:1.21.4
    ports: ["25565:25565"]
    volumes: ["jeu-monde:/monde"]
    environment:
      MEMOIRE: 2G
      MOT_DE_PASSE: "tres-secret-42"
    restart: unless-stopped
    mem_limit: 3g
  carte:
    image: registre.example.org/carte-web:3.0.2
    ports:
      - "8123:80"
    volumes:
      - jeu-monde:/monde:ro
    depends_on: [monde]
volumes:
  jeu-monde: {}
`;
const G: Garde = { maison: '/home/proprio', odin: '/home/proprio/.odin', moteur: '/var/lib/odin/hringhorni', autres: ['/srv/cle-odin'] };
const refusDe = (texte: string, garde: Garde = G, nom = 'essai') => analyserComposition(texte, { nom, garde }).refus.join('\n');
const leve = (f: () => unknown, motif: RegExp) => assert.throws(f, (e: unknown) => e instanceof RefusYaml && motif.test((e as Error).message), String(motif));

// ------------------------------------------------------------------ le lecteur
test('lecteur : le sous-ensemble utile (dictionnaires, listes en bloc et en ligne, guillemets, blocs de texte, commentaires)', () => {
  const v = lireYamlStrict(`---
services: # les services
  a:
    image: "registre.example.org/a:1"   # commentaire
    command: |
      echo "un # qui reste"
      ls -la
    environment:
      - CLE=valeur avec espace
      - 'AUTRE=l''apostrophe'
    ports: ["80:80", '443:443']
    labels: {}
    vide:
    nul: ~
  b: { image: x }
...
`) as Record<string, any>;
  assert.equal(Object.getPrototypeOf(v), null, 'aucun prototype : aucune clé ne touche aux objets');
  assert.equal(v.services.a.image, 'registre.example.org/a:1');
  assert.equal(v.services.a.command, 'echo "un # qui reste"\nls -la\n');
  assert.deepEqual(v.services.a.environment, ['CLE=valeur avec espace', 'AUTRE=l\'apostrophe']);
  assert.deepEqual(v.services.a.ports, ['80:80', '443:443']);
  assert.deepEqual({ ...v.services.a.labels }, {}); assert.equal(v.services.a.vide, null); assert.equal(v.services.a.nul, null);
  assert.equal(v.services.b.image, 'x');
  // la liste au même retrait que sa clé (écriture courante)
  assert.deepEqual((lireYamlStrict('l:\n- a\n- b: 1\n  c: 2\n') as any).l.map((x: unknown) => (typeof x === 'string' ? x : { ...(x as object) })), ['a', { b: '1', c: '2' }]);
});

test('lecteur : pas de « bombe » de YAML — ancres, alias, fusions, étiquettes, directives, plusieurs documents refusés', () => {
  const bombe = ['a: &a ["x","x","x","x","x","x","x","x","x"]', 'b: &b [*a,*a,*a,*a,*a,*a,*a,*a,*a]', 'c: &c [*b,*b,*b,*b,*b,*b,*b,*b,*b]', 'd: [*c,*c,*c,*c,*c,*c,*c,*c,*c]'].join('\n');
  const t0 = Date.now(); leve(() => lireYamlStrict(bombe), /ancre « & » refusée/); assert.ok(Date.now() - t0 < 200, 'refusé tout de suite');
  leve(() => lireYamlStrict('a:\n  b: *x\n'), /alias « \* » refusé/);
  leve(() => lireYamlStrict('a:\n  - *x\n'), /alias « \* » refusé/);
  leve(() => lireYamlStrict('base: &b\n  image: x\n'), /ancre « & » refusée/);
  leve(() => lireYamlStrict('s:\n  <<: {image: x}\n'), /fusion « << » refusée/);
  leve(() => lireYamlStrict('a: !!python/object:os.system x\n'), /étiquette « ! » refusée/);
  leve(() => lireYamlStrict('a: [!!str x]\n'), /étiquette « ! » refusée/);
  leve(() => lireYamlStrict('%YAML 1.2\n---\na: b\n'), /directive « % » refusée/);
  leve(() => lireYamlStrict('a: b\n---\nc: d\n'), /un seul document/);
  leve(() => lireYamlStrict('? [a, b]\n: c\n'), /clé complexe « \? » refusée/);
});

test('lecteur : clés dangereuses ou en double, tabulations, guillemets ouverts, listes imbriquées en ligne : refusés', () => {
  leve(() => lireYamlStrict('__proto__:\n  pollue: oui\n'), /clé « __proto__ » refusée/);
  leve(() => lireYamlStrict('a: {constructor: x}\n'), /clé « constructor » refusée/);
  assert.equal(({} as Record<string, unknown>).pollue, undefined);
  leve(() => lireYamlStrict('a: 1\na: 2\n'), /en double/);
  leve(() => lireYamlStrict('a:\n\tb: 1\n'), /tabulation dans le retrait/);
  leve(() => lireYamlStrict('a: "pas fermé\n  suite"\n'), /guillemets non fermé/);
  leve(() => lireYamlStrict('a: [[1, 2], [3]]\n'), /liste dans une liste en ligne refusée/);
  leve(() => lireYamlStrict('a: {b: {c: d}}\n'), /liste dans une liste en ligne refusée/);
  leve(() => lireYamlStrict('a: b: c\n'), /« : » de trop/);
  leve(() => lireYamlStrict('a: "\\x41"\n'), /échappement/);
  leve(() => lireYamlStrict('a: b\n   c: d\n'), /retrait inattendu/);
  leve(() => lireYamlStrict('a: x\0y\n'), /caractère de contrôle/);
  leve(() => lireYamlStrict(''), /fichier vide/);
});

test('lecteur : borné — taille, lignes, profondeur, éléments, longueur d\'une liste', () => {
  leve(() => lireYamlStrict(`a: "${'x'.repeat(BORNES.octets)}"\n`), /trop gros/);
  leve(() => lireYamlStrict('a: 1\n'.repeat(1) + '#\n'.repeat(BORNES.lignes + 1)), /trop long/);
  let prof = ''; for (let k = 0; k < BORNES.profondeur + 2; k++) prof += `${'  '.repeat(k)}n${k}:\n`; prof += `${'  '.repeat(BORNES.profondeur + 2)}x: 1\n`;
  leve(() => lireYamlStrict(prof), /trop imbriqué/);
  leve(() => lireYamlStrict(`l: [${Array.from({ length: BORNES.liste + 1 }, (_x, k) => `v${k}`).join(', ')}]\n`), /liste trop longue/);
  leve(() => lireYamlStrict(`l:\n${Array.from({ length: BORNES.liste + 1 }, (_x, k) => `  - v${k}\n`).join('')}`), /liste trop longue/);
  const beaucoup = Array.from({ length: 30 }, (_x, k) => `k${k}: [${Array.from({ length: 150 }, (_y, j) => `v${j}`).join(', ')}]\n`).join('');
  leve(() => lireYamlStrict(beaucoup), /trop chargé/);
  leve(() => lireYamlStrict(`a: ${'y'.repeat(BORNES.texte + 1)}\n`), /trop longue|trop long/);
});

// ------------------------------------------------------------------ l'analyse
test('analyse : le fichier de la maquette est accepté — 2 conteneurs dans l\'ordre, 1 volume créé, ports, réseau à part', () => {
  const a = analyserComposition(JEUX, { nom: 'serveur-de-jeux', garde: G });
  assert.equal(a.ok, true, a.refus.join('\n'));
  assert.deepEqual(a.ordre, ['monde', 'carte']);
  assert.deepEqual(a.services.map((s) => [s.conteneur, s.image, s.memory, s.restart, s.reseau]), [['serveur-de-jeux-monde', 'registre.example.org/serveur-jeu:1.21.4', '3g', 'sauf-arret', 'pile-serveur-de-jeux'], ['serveur-de-jeux-carte', 'registre.example.org/carte-web:3.0.2', '512m', 'non', 'pile-serveur-de-jeux']]);
  assert.deepEqual(a.services[1].montages, [{ volume: 'serveur-de-jeux_jeu-monde', inner: '/monde', ro: true }]);
  assert.deepEqual(a.services[0].ports, [{ host: 25565, inner: 25565, proto: 'tcp' }]);
  assert.deepEqual(a.volumes, [{ nom: 'serveur-de-jeux_jeu-monde', externe: false }]);
  assert.deepEqual(a.reseaux, [{ nom: 'pile-serveur-de-jeux', internet: true, externe: false }]);
  assert.deepEqual(a.constats.filter((c) => c.ton === 'ok').map((c) => c.quoi), ['2 conteneurs', '1 volume', 'Ports 25565, 8123', 'Réseau']);
  assert.match(a.constats[0].texte, /monde, puis carte \(attend monde\)/);
  assert.ok(a.constats.some((c) => c.ton === 'change' && /carte · mémoire/.test(c.quoi) && /512 Mo/.test(c.texte)));
  // le nom vient du fichier si on n'en donne pas
  assert.equal(analyserComposition(`name: ma-pile\n${JEUX}`, { garde: G }).nom, 'ma-pile');
});

test('analyse : tout ce qui ouvre la machine est refusé, avec une phrase simple', () => {
  const svc = (lignes: string) => `services:\n  s:\n    image: registre.example.org/a:1\n${lignes.split('\n').map((l) => `    ${l}`).join('\n')}\n`;
  const cas: Array<[string, string, RegExp]> = [
    ['privileged', svc('privileged: true'), /privileged: true : un conteneur n'a jamais tous les droits/],
    ['disque entier', svc('volumes: ["/:/hote"]'), /disque entier du PC/],
    ['disque Windows vu de Linux', svc('volumes: ["/mnt/c:/c"]'), /disque entier/],
    ['système', svc('volumes: ["/etc:/etc-hote:ro"]'), /dossier du système/],
    ['système plus bas', svc('volumes: ["/usr/lib:/x"]'), /dossier du système/],
    ['socket du moteur', svc('volumes: ["/var/run/docker.sock:/var/run/docker.sock"]'), /socket d'un moteur|dossier du système/],
    ['socket ailleurs', svc('volumes: ["/srv/podman/podman.sock:/s"]'), /socket d'un moteur/],
    ['dossier personnel', svc('volumes: ["/home/proprio:/maison"]'), /ton dossier personnel/],
    ['tous les comptes', svc('volumes: ["/home:/h"]'), /ton dossier personnel/],
    ['dossier à toi', svc('volumes: ["/srv/partage/Documents:/docs:ro"]'), /ton dossier personnel/],
    ['dossier caché', svc('volumes: ["/srv/proprio/.ssh:/cles"]'), /dossier caché/],
    ['Odin', svc('volumes: ["/home/proprio/.odin:/o"]'), /ton dossier personnel|données d'Odin/],
    ['coffre d\'Odin', svc('volumes: ["/srv/cle-odin:/c"]'), /données d'Odin/],
    ['moteur', svc('volumes: ["/var/lib/odin/hringhorni/volumes:/v"]'), /dossier du système|dossier du moteur/],
    ['relatif', svc('volumes: ["./donnees:/d"]'), /chemin relatif/],
    ['Windows', svc('volumes: ["C:\\\\Users:/u"]'), /chemin de Windows/],
    ['remonter', svc('volumes: ["/srv/a/../../etc:/e"]'), /« \.\. »/],
    ['réseau de la machine', svc('network_mode: host'), /network_mode: host : le réseau de la machine/],
    ['processus de la machine', svc('pid: host'), /pid: host : les processus de la machine/],
    ['ipc', svc('ipc: host'), /ipc: host : cet espace de la machine/],
    ['userns', svc('userns_mode: host'), /cet espace de la machine/],
    ['capacité', svc('cap_add: [SYS_ADMIN]'), /cap_add: SYS_ADMIN : cette capacité/],
    ['toutes les capacités', svc('cap_add:\n  - ALL'), /cap_add: ALL/],
    ['capacité réseau', svc('cap_add: ["NET_ADMIN"]'), /cap_add: NET_ADMIN/],
    ['périphérique', svc('devices: ["/dev/sda:/dev/sda"]'), /aucun périphérique/],
    ['cartes graphiques', svc('gpus: all'), /aucun périphérique/],
    ['protection retirée', svc('security_opt: ["seccomp:unconfined"]'), /retirer une protection/],
    ['noyau', svc('sysctls:\n  net.ipv4.ip_forward: "1"'), /réglages du noyau/],
    ['autre conteneur', svc('volumes_from: [autre]'), /prendre les dossiers d'un autre conteneur/],
    ['construire', 'services:\n  s:\n    build: .\n', /construire une image n'est pas encore possible/],
    ['fichier du PC', svc('env_file: .env'), /lirait un fichier de ce PC/],
    ['variable du PC', svc('environment:\n  CHEMIN: ${HOME}'), /ne prend pas les variables de ce PC/],
    ['variable du PC sans accolades', svc('environment: ["A=$SECRET"]'), /ne prend pas les variables de ce PC/],
    ['variable du PC vide', svc('environment: [CLE_API]'), /ne prend pas les variables de ce PC/],
    ['variable dans l\'image', 'services:\n  s:\n    image: registre.example.org/a:${TAG}\n', /ne prend pas les variables de ce PC/],
    ['adresse d\'écoute', svc('ports: ["127.0.0.1:8080:80"]'), /adresse d'écoute/],
    ['port seul', svc('ports: ["80"]'), /donne le port de ce PC/],
    ['plage', svc('ports: ["8000-8010:8000-8010"]'), /port illisible/],
    ['inconnu', svc('runtime: autre'), /runtime : pas compris/],
    ['pilote de volume', 'services:\n  s:\n    image: a\n    volumes: [v:/v]\nvolumes:\n  v:\n    driver_opts:\n      type: none\n      device: /\n      o: bind\n', /driver_opts.*monter n'importe quel dossier/],
    ['volume non déclaré', svc('volumes: ["inconnu:/x"]'), /volume non déclaré/],
    ['volume externe absent', 'services:\n  s:\n    image: a\n    volumes: [v:/v]\nvolumes:\n  v:\n    external: true\n', /n'existe pas : crée-le d'abord/],
    ['volume sans nom', svc('volumes: ["/donnees"]'), /un volume sans nom/],
    ['deux réseaux', 'services:\n  s:\n    image: a\n    networks: [x, y]\nnetworks:\n  x: {}\n  y: {}\n', /un seul réseau par conteneur/],
    ['secrets', `${svc('')}secrets:\n  s:\n    file: /etc/shadow\n`, /« secrets » : pas encore/],
    ['inclure', `include:\n  - autre.yaml\n${svc('')}`, /lirait d'autres fichiers/],
    ['nom de pile', svc(''), /Nom de la pile/],
  ];
  for (const [quoi, texte, motif] of cas) {
    const a = analyserComposition(texte, { nom: quoi === 'nom de pile' ? 'Pas Bon!' : 'essai', garde: G });
    assert.equal(a.ok, false, quoi);
    assert.match(a.refus.join('\n'), motif, quoi);
  }
});

test('analyse : ce qui reste sûr est accepté (ou seulement noté) ; « $$ » donne un « $ »', () => {
  const a = analyserComposition(`services:
  web:
    image: registre.example.org/web:2
    container_name: mon-web
    environment:
      MOT: "pa$$word"
    cap_add: [NET_BIND_SERVICE]
    privileged: false
    volumes:
      - type: bind
        source: /srv/medias
        target: /medias
        read_only: true
    healthcheck:
      test: ["CMD", "true"]
    network_mode: none
`, { nom: 'sur', garde: G });
  assert.equal(a.ok, true, a.refus.join('\n'));
  assert.equal(a.services[0].env.MOT, 'pa$word');
  assert.deepEqual(a.services[0].montages, [{ host: '/srv/medias', inner: '/medias', ro: true }]);
  assert.equal(a.services[0].reseau, '', 'network_mode: none → le réseau « aucun »');
  assert.deepEqual(a.reseaux, [], 'aucun réseau créé pour un service sans réseau');
  const notes = a.constats.filter((c) => c.ton === 'change').map((c) => `${c.quoi} : ${c.texte}`).join('\n');
  assert.match(notes, /container_name : Odin le nomme « sur-web »/);
  assert.match(notes, /cap_add: NET_BIND_SERVICE : pas prise en compte/);
  assert.match(notes, /healthcheck : pas pris en compte/);
  assert.match(notes, /« \/srv\/medias » : un dossier de ce PC, que le conteneur lit seulement ; il n'est jamais effacé avec la pile/);
});

test('analyse : un lien posé sur le chemin est vérifié jusqu\'au vrai dossier ; les ports déjà pris et les noms déjà pris sont refusés', () => {
  assert.match(pourquoiRefuserDossier('/srv/joli-nom', { ...G, vraiChemin: (p) => (p === '/srv/joli-nom' ? '/etc' : undefined) }) ?? '', /dossier du système.*\(par un lien\)/);
  assert.equal(pourquoiRefuserDossier('/srv/medias', G), undefined);
  const g: Garde = { ...G, portsPris: new Map([[8123, 'galerie-photos']]), conteneurs: ['serveur-de-jeux-monde'], piles: ['autre'], volumes: [], reseaux: [] };
  const r = refusDe(JEUX, g, 'serveur-de-jeux');
  assert.match(r, /ports · 8123 : déjà pris sur ce PC \(galerie-photos\)/);
  assert.match(r, /un conteneur « serveur-de-jeux-monde » existe déjà/);
  assert.match(refusDe(JEUX, g, 'autre'), /une pile « autre » existe déjà/);
  assert.match(refusDe(JEUX.replace('"8123:80"', '"25565:80"'), G), /déjà demandé par monde/);
});

test('ordre de démarrage : les dépendances d\'abord ; un cycle est refusé avec son chemin', () => {
  assert.deepEqual(ordreDemarrage(new Map([['web', ['api', 'cache']], ['api', ['db']], ['cache', []], ['db', []]])), ['db', 'api', 'cache', 'web']);
  assert.throws(() => ordreDemarrage(new Map([['a', ['b']], ['b', ['c']], ['c', ['a']]])), /tournent en rond : a → b → c → a/);
  assert.throws(() => ordreDemarrage(new Map([['a', ['a']]])), /a → a/);
  const cycle = analyserComposition('services:\n  a:\n    image: x\n    depends_on: [b]\n  b:\n    image: y\n    depends_on:\n      a:\n        condition: service_healthy\n', { nom: 'c', garde: G });
  assert.equal(cycle.ok, false); assert.match(cycle.refus.join('\n'), /Dépendances : les dépendances tournent en rond : a → b → a/);
  assert.match(refusDe('services:\n  a:\n    image: x\n    depends_on: [fantome]\n'), /depends_on · fantome : ce service n'est pas dans le fichier/);
  assert.match(refusDe(`services:\n${Array.from({ length: BORNES.services + 1 }, (_x, k) => `  s${k}:\n    image: x\n`).join('')}`), /trop de services/);
});

// ------------------------------------------------------------------ les piles chez le moteur (aucun conteneur lancé)
class MoteurEssai extends Engine {
  journal: string[] = [];
  override async start(n: string) { const c = this.find(n); this.journal.push(`start ${c.spec.name}`); this.store.saveState(c.id, { status: 'en marche', pid: process.pid, gardien: process.pid, startedAt: new Date().toISOString() }); return this.find(n); }
  override async stop(n: string) { const c = this.find(n); this.journal.push(`stop ${c.spec.name}`); this.store.saveState(c.id, { status: 'arrêté', finishedAt: new Date().toISOString() }); return this.find(n); }
}
function moteur() {
  const dir = neuf('hh-k3-moteur-'), cmds: string[] = [];
  const e = new MoteurEssai(dir, { rootless: false, run: async (c, a) => { cmds.push(`${c} ${a.join(' ')}`); return { code: 0, out: '', err: '' }; }, fetch: (async () => { throw new Error('essai : aucune sortie réseau'); }) as never });
  const img = (n: string, id: string): Image => ({ id, names: [n], digest: `sha256:${id}`, config: { config: { Cmd: ['/bin/appli'] } } as never, configDigest: `sha256:${id}`, layers: [], size: 1000, pulled: new Date().toISOString() });
  e.store.saveImages([img('registre.example.org/serveur-jeu:1.21.4', 'a'.repeat(64)), img('registre.example.org/carte-web:3.0.2', 'b'.repeat(64))]);
  return { e, cmds, dir };
}

test('déployer une pile : réseau à part et volume créés, conteneurs créés puis démarrés dans l\'ordre, pile notée', async () => {
  const { e } = moteur();
  const a = analyserComposition(JEUX, { nom: 'serveur-de-jeux', garde: G });
  const etapes: string[] = [];
  const p = await deployerPile(e, a, JEUX, (t) => etapes.push(t));
  assert.deepEqual(e.journal, ['start serveur-de-jeux-monde', 'start serveur-de-jeux-carte']);
  assert.deepEqual(e.store.reseaux().map((r) => [r.nom, r.internet]), [['pile-serveur-de-jeux', true]]);
  assert.deepEqual(e.store.volumes().map((v) => v.nom), ['serveur-de-jeux_jeu-monde']);
  const c = e.find('serveur-de-jeux-carte').spec;
  assert.deepEqual([c.network, c.reseau, c.labels['odin.pile'], c.labels['odin.pile.service'], c.memory, c.hostname], ['pont', 'pile-serveur-de-jeux', 'serveur-de-jeux', 'carte', '512m', 'carte']);
  assert.deepEqual(c.mounts, [{ host: e.store.volumeData('serveur-de-jeux_jeu-monde'), inner: '/monde', ro: true, volume: 'serveur-de-jeux_jeu-monde' }]);
  assert.equal(e.find('serveur-de-jeux-monde').spec.env.MOT_DE_PASSE, 'tres-secret-42');
  assert.deepEqual([p.volumesPropres, p.reseauxPropres, p.ordre], [['serveur-de-jeux_jeu-monde'], ['pile-serveur-de-jeux'], ['monde', 'carte']]);
  assert.deepEqual(piles(e).map((x) => x.nom), ['serveur-de-jeux']);
  assert.ok(etapes.some((t) => /serveur-de-jeux-monde en marche/.test(t)));
  // une seconde fois : refusé (la pile existe), rien n'est recréé
  await assert.rejects(deployerPile(e, a, JEUX), /existe déjà/);
  // une analyse refusée ne se déploie jamais
  await assert.rejects(deployerPile(e, analyserComposition('services:\n  s:\n    image: a\n    privileged: true\n', { nom: 'x', garde: G }), ''), /pile refusée/);
  assert.equal(pile(e, 'x'), undefined);
});

test('démarrer et arrêter une pile : dans l\'ordre, puis dans l\'ordre inverse ; seulement ce qu\'il faut', async () => {
  const { e } = moteur();
  await deployerPile(e, analyserComposition(JEUX, { nom: 'jeux', garde: G }), JEUX);
  e.journal = [];
  assert.deepEqual(await arreterPile(e, 'jeux'), ['jeux-carte', 'jeux-monde']);
  assert.deepEqual(await arreterPile(e, 'jeux'), [], 'déjà arrêtée');
  assert.deepEqual(await demarrerPile(e, 'jeux'), ['jeux-monde', 'jeux-carte']);
  assert.deepEqual(e.journal, ['stop jeux-carte', 'stop jeux-monde', 'start jeux-monde', 'start jeux-carte']);
  await assert.rejects(demarrerPile(e, 'inconnue'), /pile inconnue/);
});

test('un service retrouve les autres de sa pile par leur nom de service (« monde »), seulement dans sa pile', async () => {
  const { e } = moteur();
  await deployerPile(e, analyserComposition(JEUX, { nom: 'jeux', garde: G }), JEUX);
  const monde = e.find('jeux-monde'); e.store.patchState(monde.id, { ip: '10.89.1.2' });
  // un conteneur d'ailleurs, sur le même réseau, qui porte le même nom de service : pas d'alias pour lui
  await e.create({ image: 'registre.example.org/carte-web:3.0.2', name: 'intrus', network: 'pont', reseau: 'pile-jeux', labels: { 'odin.pile': 'autre', 'odin.pile.service': 'monde' } });
  e.store.patchState(e.find('intrus').id, { status: 'en marche', ip: '10.89.1.9' });
  const carte = e.find('jeux-carte');
  mkdirSync(e.store.rootfs(carte.spec.imageId), { recursive: true });
  (e as unknown as { tools: unknown }).tools = { env: '/usr/bin/env', setpriv: '/usr/bin/setpriv', unshare: '/usr/bin/unshare', nsenter: '/usr/bin/nsenter' };
  await e.plan(carte.spec, { ip: '10.89.1.3' });
  const hosts = readFileSync(join(e.store.ctr(carte.id), 'hosts'), 'utf8');
  assert.match(hosts, /^10\.89\.1\.2 jeux-monde monde$/m);
  assert.match(hosts, /^10\.89\.1\.9 intrus$/m);
});

test('supprimer une pile : ses volumes GARDÉS par défaut ; « effacer » ne prend que ses dossiers à elle', async () => {
  const { e } = moteur();
  // un volume qui existait avant la pile (déclaré « external ») ne part jamais
  e.createVolume('monde-partage'); writeFileSync(join(e.store.volumeData('monde-partage'), 'f'), 'à moi');
  const f = `${JEUX.replace('volumes: ["jeu-monde:/monde"]', 'volumes: ["jeu-monde:/monde", "partage:/partage"]')}  partage:\n    external: true\n    name: monde-partage\n`;
  const a = analyserComposition(f, { nom: 'jeux', garde: { ...G, volumes: ['monde-partage'] } });
  assert.equal(a.ok, true, a.refus.join('\n'));
  await deployerPile(e, a, f);
  writeFileSync(join(e.store.volumeData('jeux_jeu-monde'), 'monde.dat'), 'sauvegarde du monde');
  // 1. par défaut : tout est gardé
  const r1 = await supprimerPile(e, 'jeux');
  assert.deepEqual(r1.conteneurs, ['jeux-carte', 'jeux-monde']);
  assert.deepEqual(r1.volumesEffaces, []); assert.deepEqual(r1.reseauxRetires, ['pile-jeux']);
  assert.ok(existsSync(join(e.store.volumeData('jeux_jeu-monde'), 'monde.dat')));
  assert.deepEqual(e.ps(true), []); assert.equal(pile(e, 'jeux'), undefined);
  // 2. effacer : seulement le volume qu'elle a créé et dont plus rien ne se sert
  const a2 = analyserComposition(f, { nom: 'jeux2', garde: { ...G, volumes: ['monde-partage'] } });
  await deployerPile(e, a2, f);
  await e.create({ image: 'registre.example.org/carte-web:3.0.2', name: 'lecteur', network: 'aucun', mounts: [{ host: 'jeux2_jeu-monde', inner: '/m', ro: true, volume: 'jeux2_jeu-monde' }] });
  const vus: string[] = [];
  const r2 = await supprimerPile(e, 'jeux2', { effacerVolumes: true, garde: (reel) => { vus.push(reel); return undefined; } });
  assert.deepEqual(r2.volumesEffaces, []);
  assert.deepEqual(r2.volumesGardes.map((v) => [v.nom, v.raison]), [['jeux2_jeu-monde', 'sert encore à lecteur'], ['monde-partage', 'il était là avant la pile']]);
  // 3. sans autre conteneur : effacé, la garde l'a vu
  await e.rm('lecteur', true);
  const a3 = analyserComposition(f, { nom: 'jeux3', garde: { ...G, volumes: ['monde-partage', 'jeux2_jeu-monde'] } });
  await deployerPile(e, a3, f);
  const r3 = await supprimerPile(e, 'jeux3', { effacerVolumes: true, garde: (reel) => { vus.push(reel); return undefined; } });
  assert.deepEqual(r3.volumesEffaces, ['jeux3_jeu-monde']);
  assert.equal(existsSync(e.store.volumeDir('jeux3_jeu-monde')), false);
  assert.ok(existsSync(join(e.store.volumeData('monde-partage'), 'f')), 'le volume d\'avant reste');
  assert.ok(vus.length >= 1);
  // 4. une garde qui refuse : rien n'est effacé
  const a4 = analyserComposition(f, { nom: 'jeux4', garde: { ...G, volumes: ['monde-partage'] } });
  await deployerPile(e, a4, f);
  const r4 = await supprimerPile(e, 'jeux4', { effacerVolumes: true, garde: () => 'les données d\'Odin' });
  assert.deepEqual(r4.volumesEffaces, []); assert.match(r4.volumesGardes[0].raison, /données d'Odin/);
  assert.ok(existsSync(e.store.volumeDir('jeux4_jeu-monde')));
});

// ------------------------------------------------------------------ relecture (contournements trouvés, corrigés)
test('relecture : le dossier personnel de quiconque (et « /mnt/c/Users/… ») est refusé, à toute profondeur', () => {
  for (const d of ['/home/autre/projet', '/home/autre/a/b/c', '/mnt/c/Users/proprio/AppData', '/media/disque/home/x', '/srv/Users/x']) assert.equal(pourquoiRefuserDossier(d, G), 'ton dossier personnel et tes dossiers à toi ne sont pas donnés par un fichier de composition', d);
  assert.equal(pourquoiRefuserDossier('/srv/medias', G), undefined);
  assert.match(refusDe('services:\n  a:\n    image: x\n    volumes: ["/home/autre/projet:/p"]\n'), /dossier personnel/);
});

test('relecture : « read_only » qui n\'est ni true ni false est refusé (jamais un dossier donné en écriture par erreur)', () => {
  const f = (v: string) => `services:\n  a:\n    image: x\n    volumes:\n      - type: bind\n        source: /srv/x\n        target: /h\n        read_only: ${v}\n`;
  for (const v of ['1', 'oui', '"vrai"']) assert.match(refusDe(f(v)), /read_only.*écris « true » ou « false »/, v);
  assert.deepEqual(analyserComposition(f('true'), { nom: 'e', garde: G }).services[0].montages, [{ host: '/srv/x', inner: '/h', ro: true }]);
  assert.deepEqual(analyserComposition(f('false'), { nom: 'e', garde: G }).services[0].montages, [{ host: '/srv/x', inner: '/h', ro: false }]);
});

test('relecture : une pile ne rejoint jamais en silence le réseau d\'une autre (« name: ») ; un volume déjà là est dit', () => {
  const g: Garde = { ...G, reseaux: ['pile-autre'], volumes: ['autre_data'] };
  const net = 'services:\n  a:\n    image: x\n    networks: [n]\nnetworks:\n  n:\n    name: pile-autre\n';
  assert.match(refusDe(net, g), /un réseau « pile-autre » existe déjà .*external: true/);
  const ext = analyserComposition(net.replace('name: pile-autre', 'name: pile-autre\n    external: true'), { nom: 'e', garde: g });
  assert.equal(ext.ok, true, ext.refus.join('\n'));
  assert.ok(ext.constats.some((c) => c.ton === 'change' && /rejoint le réseau « pile-autre »/.test(c.texte)));
  const vol = analyserComposition('services:\n  a:\n    image: x\n    volumes: ["d:/d"]\nvolumes:\n  d:\n    name: autre_data\n', { nom: 'e', garde: g });
  assert.equal(vol.ok, true); assert.ok(vol.constats.some((c) => c.ton === 'change' && /« autre_data » existe déjà : la pile pourra lire et changer/.test(c.texte)));
});

test('relecture : réseau « aucun » avec des ports, ou un service nommé « localhost » : refusés avant le déploiement', () => {
  assert.match(refusDe('services:\n  a:\n    image: x\n    network_mode: none\n    ports: ["8080:80"]\n'), /a · ports : réseau « aucun »/);
  assert.match(refusDe('services:\n  localhost:\n    image: x\n'), /localhost : ce nom désigne la machine elle-même/);
});

test('relecture : un conteneur créé à part avec le nom d\'un conteneur de la pile n\'est ni démarré ni supprimé avec elle', async () => {
  const { e } = moteur();
  await deployerPile(e, analyserComposition(JEUX, { nom: 'jeux', garde: G }), JEUX);
  await e.rm('jeux-carte', true);
  await e.create({ image: 'registre.example.org/carte-web:3.0.2', name: 'jeux-carte', network: 'aucun' });
  e.journal = [];
  await arreterPile(e, 'jeux');
  assert.deepEqual(await demarrerPile(e, 'jeux'), ['jeux-monde']);
  const r = await supprimerPile(e, 'jeux');
  assert.deepEqual(r.conteneurs, ['jeux-monde']);
  assert.equal(e.find('jeux-carte').spec.labels['odin.pile'], undefined, 'le conteneur d\'à côté est toujours là');
});
