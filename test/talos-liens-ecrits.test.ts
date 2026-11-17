// Les liens automatiques écrits entre les applis (src/valhalla/links.ts) se voient dans la liste des automatismes de
// Talos : chacun une fois et une seule (seuls les 21 liens à point unique se coupent d'ici : liens-coupes.test.ts), avec son état et la mention « protège » pour ceux de sécurité
// et de sauvegarde. Chaque lien dit à la main s'il protège ou non (un lien ajouté demain doit être classé). Un membre
// ou un invité ne voit pas cette liste (comme il ne voyait pas les automatismes).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { LINKS } from '../src/valhalla/links.ts';
import { SENSORS } from '../src/valhalla/ullr/incidents.ts';
import { lignesLiensEcrits, lignesTalos, contexteTalos, agendaTalos, talosGet, talosPost } from '../src/web/talos-api.ts';
import { T } from './banc/lib.ts';
import { vraiOdin } from './banc/odin-vrai.ts';
import { allModules, valhallaOf } from '../src/valhalla/odin.ts';
import { relierProprietaire } from '../src/valhalla/sso/etat.ts';
import { startDraupnir } from '../src/draupnir/odin.ts';

const lire = (f: string) => readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8');

test('chaque lien écrit dit à la main s\'il protège (genre et raison) ou non', () => {
  for (const l of LINKS) {
    const nom = `${l.from} → ${l.to} (« ${l.when} »)`;
    assert.ok(Object.hasOwn(l, 'protege'), `${nom} : ni « protège » ni « ne protège pas »`);
    if (l.protege === false) continue;
    assert.ok(l.protege && typeof l.protege === 'object', `${nom} : protege vaut false ou { genre, raison }`);
    assert.ok(['sécurité', 'sauvegarde'].includes(l.protege.genre), `${nom} : genre « sécurité » ou « sauvegarde »`);
    assert.ok(l.protege.raison.trim().length >= 10, `${nom} : une phrase de raison`);
  }
  // Garde-fou : un lien qui bannit, passe à l'antivirus, range au coffre ou sauvegarde est forcément marqué.
  for (const l of LINKS) if (/\bbanni|antivirus|coffre|sauvegard/i.test(`${l.when} ${l.does}`)) assert.ok(l.protege, `${l.from} → ${l.to} (« ${l.when} ») devrait être marqué « protège »`);
  // Les signaux envoyés à Asclépios (générés depuis SENSORS) protègent : ils servent à reconnaître une attaque.
  for (const l of LINKS.filter((x) => x.does.startsWith('le signal rejoint les incidents d\'Asclépios'))) assert.equal(l.protege && l.protege.genre, 'sécurité');
  // Un lien qui OUVRE un port n'est marqué « protège » que si sa raison le dit (pas une raison qui fait croire l'inverse).
  for (const l of LINKS) if (l.protege && /ouvre ce port|port .*est ouvert/i.test(l.does)) assert.match(l.protege.raison, /ouvr/i, `${l.from} → ${l.to} : la raison doit dire qu'il ouvre un port`);
});

test('le recompte : les liens écrits à la main et ceux tirés des capteurs d\'Asclépios', () => {
  const capteurs = SENSORS.filter((q) => !['loki', 'skogul'].includes(q.app)).length;
  const src = lire('valhalla/links.ts'), bloc = src.slice(src.indexOf('export const LINKS'), src.indexOf('/** Usages de prédilection'));
  const aLaMain = [...bloc.matchAll(/^\s+\{ from: '/gm)].length;
  assert.equal(LINKS.length, aLaMain + capteurs, 'LINKS = liens écrits à la main + un par capteur (hors Sirènes et Némésis, déjà écrits)');
});

// La liste FIGÉE des identifiants écrits à la main, dans l'ordre de LINKS. Un identifiant qui change ou disparaît fait
// échouer l'essai : une coupure enregistrée demain sous cet identifiant resterait sans lien.
const IDENTIFIANTS = [
  'loki-garmr-bannir-pirate', 'loki-ullr-fichier-piege', 'geri-garmr-bannir-malveillant',
  'skogul-ullr-processus-suspect', 'ullr-alerte-menace', 'sindri-alerte-sauvegarde', 'eir-alerte-saturation',
  'naglfar-alerte-conteneur', 'ymir-alerte-machine-virtuelle', 'hermod-alerte-machine-disparue',
  'himinbjorg-midgard-scene-intrusion', 'appareils-midgard-etat', 'brokkr-appareils-module', 'rodd-bragi-mots',
  'volva-bragi-ecouter', 'naglfar-urdr-base', 'svalinn-coffre-box', 'svalinn-alerte-wifi',
  'urdr-coffre-mot-de-passe', 'urdr-skuld-sauvegarde-base', 'skuld-alerte-sauvegarde-base',
  'frigg-runes-fiche-client', 'gjoll-coffre-acces-vpn', 'gjoll-vidarr-dns-vpn', 'vidarr-alerte-site-dangereux',
  'vidarr-alerte-inondation-dns', 'vidarr-alerte-dns-amont', 'vidarr-alerte-appareil-inconnu',
  'vidarr-saga-resume-reseau', 'vidarr-ran-paquets', 'vidarr-vordr-sonde-dns', 'gjoll-vordr-sonde-vpn',
  'hermod-ullr-analyse-poste', 'hermod-eir-etat-poste', 'hermod-fensalir-disques-poste',
  'hermod-hlid-pare-feu-poste', 'hermod-mimisbrunnr-journaux-poste', 'hermod-skogul-programmes-poste',
  'heidrun-vidarr-profil-enfant', 'mimisbrunnr-alerte-message-repete', 'gladsheim-gna-position',
  'gna-alerte-historique', 'freyja-vordr-sonde-venus', 'idunn-vordr-sonde-site', 'vordr-alerte-sonde',
  'vidarr-askr-fiche-dhcp', 'askr-vordr-surveiller', 'askr-coffre-licence', 'askr-alerte-garantie',
  'valgrind-vidarr-nom-local', 'valgrind-vordr-sonde-service', 'valgrind-coffre-mot-de-passe-site',
  'valgrind-garmr-bannir', 'garmr-valgrind-bannis', 'valgrind-alerte-service', 'var-valgrind-site-reserve',
  'var-coffre-mot-de-passe', 'var-garmr-bannir', 'var-alerte-compte-verrouille', 'var-ullr-connexions-refusees',
  'var-bru-publier-portail', 'valgrind-bru-publier-site', 'bru-alerte-tunnel', 'vidarr-garmr-port-dns',
  'gjoll-garmr-port-vpn', 'hlid-garmr-port-direct', 'var-skidbladnir-droits-groupe',
  'skidbladnir-valgrind-mise-en-ligne', 'skidbladnir-var-connexion', 'fjalar-ullr-installateur', 'eitri-thjalfi-iso',
  'fjalar-thjalfi-logiciels', 'thjalfi-askr-fiche-machine', 'thjalfi-alerte-installation',
  'thjalfi-coffre-compte-machines', 'thjalfi-ullr-chargeur', 'thjalfi-vidarr-demarrage-reseau',
  'skidbladnir-ullr-fichier-arrive', 'skidbladnir-alerte-fichiers', 'skidbladnir-garmr-bannir',
  'valgrind-ullr-recherche-failles', 'valgrind-ran-paquets', 'gjoll-alerte-fin-acces', 'bragi-freyja-ordre-voix',
  'midgard-freyja-scene', 'kvasir-runes-evolution', 'sindri-ymir-instantane', 'naglfar-soin-relance-conteneur',
  'ymir-soin-relance-machine', 'sindri-soin-relance-sauvegarde', 'himinbjorg-syrinx-ecoute-clip',
  'syrinx-theia-sons-video', 'capteur-geri', 'capteur-garmr', 'capteur-forseti', 'capteur-eir', 'capteur-naglfar',
  'capteur-hermod', 'capteur-himinbjorg', 'capteur-vidarr', 'capteur-var', 'capteur-valgrind', 'capteur-idunn',
  'idunn-alerte-site', 'idunn-soin-essai-deploiement', 'ullr-garmr-bannir-incident', 'ullr-saga-note-incident',
  'eir-syn-mesures', 'vordr-syn-mesures', 'syn-alerte-seuil', 'hlin-volva-verifier', 'hlin-coffre-cle-fuites',
  'hlin-alerte-donnees-perso', 'durinn-alerte-disque', 'durinn-sindri-sauvegarder', 'durinn-askr-fiche-disque',
  'eir-durinn-bouton-disque', 'hermod-durinn-sante-disques-poste', 'pegase-ullr-fichier',
  'pegase-vidarr-verifier-lien', 'pegase-saga-resume-navigation', 'pegase-alerte-telechargement',
  'hel-ullr-analyser-retrouves', 'hel-alerte-recuperation', 'durinn-hel-recuperer', 'hermod-ivaldi-terminal-poste',
  'snotra-askr-schema-reseau', 'var-agora-groupes-store', 'agora-ullr-installateur', 'agora-pegase-versions',
  'agora-alerte-store', 'archytas-draupnir-script-horaire', 'archytas-saga-resume-script', 'frigg-keryx-rappel-rdv',
  'theia-champollion-documents', 'mathesis-saga-apprendre', 'eir-pronoia-disque-plein',
];

/** Ce qui manque à un lien pour être classé : un identifiant écrit à la main et une déclaration « coupure ». */
function defautsDuLien(l: Record<string, unknown>, ids: ReadonlySet<string>): string[] {
  const out: string[] = [];
  if (typeof l.id !== 'string' || !/^[a-z0-9]+(-[a-z0-9]+)+$/.test(l.id) || l.id.length > 48) out.push('identifiant absent ou mal formé (minuscules, chiffres et tirets, 48 signes au plus)');
  const c = l.coupure as Record<string, unknown> | undefined;
  if (!c || typeof c !== 'object') return [...out, 'pas de déclaration « coupure »'];
  const cles = Object.keys(c).sort().join(',');
  if ('par' in c) {
    if (c.par === 'sonde') { if (cles !== 'ou,par' || typeof c.ou !== 'string' || !c.ou) out.push('une sonde dit où elle est posée'); }
    else if (['reflexe', 'alerte', 'appel', 'alimentation'].includes(String(c.par))) {
      if (cles !== 'par' && cles !== 'memePointQue,par') out.push(`champs inattendus : ${cles}`);
      if ('memePointQue' in c && !ids.has(String(c.memePointQue))) out.push(`memePointQue vise un lien inconnu : ${String(c.memePointQue)}`);
    } else out.push(`coupure « par » inconnue : ${String(c.par)}`);
  } else if (cles === 'pas_encore' || cles === 'jamais') {
    const raison = String(c[cles]);
    if (raison.trim().length < 20) out.push(`« ${cles} » sans phrase de raison`);
  } else out.push(`déclaration « coupure » inconnue : ${cles}`);
  return out;
}

test('chaque lien a un identifiant écrit à la main, court, unique, et la liste est figée', () => {
  assert.deepEqual(LINKS.map((l) => l.id), IDENTIFIANTS, 'un identifiant a changé, disparu ou été ajouté : mettre à jour la liste figée en sachant ce que cela casse');
  assert.equal(new Set(LINKS.map((l) => l.id)).size, LINKS.length, 'identifiants distincts');
  // Écrits à la main : chaque ligne du fichier porte son identifiant en clair ; les capteurs, le nom du capteur.
  const src = lire('valhalla/links.ts'), bloc = src.slice(src.indexOf('export const LINKS'), src.indexOf('/** Usages de prédilection'));
  for (const ligne of bloc.split('\n').filter((x) => /^\s+\{ from: '/.test(x))) assert.match(ligne, /, id: '[a-z0-9-]+', coupure: \{/, ligne.slice(0, 80));
  assert.match(bloc, /\.\.\.SENSORS\.filter[^\n]*id: `capteur-\$\{q\.app\}`/, 'les capteurs : un identifiant tiré du nom du capteur');
  for (const q of SENSORS.filter((x) => !['loki', 'skogul'].includes(x.app))) assert.equal(LINKS.filter((l) => l.id === `capteur-${q.app}`).length, 1, q.app);
});

test('chaque lien dit comment il pourra se couper (ou pourquoi pas) ; un lien ajouté demain sans le dire fait échouer', () => {
  const ids = new Set(LINKS.map((l) => l.id));
  for (const l of LINKS) assert.deepEqual(defautsDuLien(l as never, ids), [], `${l.id ?? `${l.from} → ${l.to}`}`);
  // Le garde-fou attrape bien un lien ajouté sans identifiant, sans déclaration, ou avec une déclaration vide.
  const neuf = { from: 'loki', to: 'garmr', when: 'demain', does: 'quelque chose', auto: true, kind: 'réflexe', protege: false };
  assert.equal(defautsDuLien(neuf, ids).length, 2);
  assert.ok(defautsDuLien({ ...neuf, id: 'Lien Neuf', coupure: { par: 'appel' } }, ids).length > 0, 'identifiant mal formé');
  assert.ok(defautsDuLien({ ...neuf, id: 'lien-neuf', coupure: { jamais: '' } }, ids).length > 0, 'jamais sans raison');
  assert.ok(defautsDuLien({ ...neuf, id: 'lien-neuf', coupure: { par: 'interrupteur' } }, ids).length > 0, 'manière inconnue');
  assert.ok(defautsDuLien({ ...neuf, id: 'lien-neuf', coupure: { par: 'reflexe', memePointQue: 'capteur-loki' } }, ids).length > 0, 'même point qu\'un lien inconnu');
  assert.deepEqual(defautsDuLien({ ...neuf, id: 'lien-neuf', coupure: { par: 'appel' } }, ids), []);
  // Les deux doublons des capteurs se couperont au même point que leur capteur.
  assert.deepEqual(LINKS.filter((l) => 'par' in l.coupure && 'memePointQue' in l.coupure).map((l) => [l.id, (l.coupure as { memePointQue: string }).memePointQue]), [['var-ullr-connexions-refusees', 'capteur-var'], ['valgrind-ullr-recherche-failles', 'capteur-valgrind']]);
  // Ce que les couper voudrait dire n'est pas tranché : la page ne dit pas « pourra se couper ». Les six liens qui
  // ouvrent un port ou publient sur Internet (Q3 de la conception), et les deux qui font suivre les droits d'accès aux
  // groupes (couper laisserait un accès retiré en place).
  for (const id of ['var-bru-publier-portail', 'valgrind-bru-publier-site', 'vidarr-garmr-port-dns', 'gjoll-garmr-port-vpn',
    'hlid-garmr-port-direct', 'skidbladnir-valgrind-mise-en-ligne', 'var-skidbladnir-droits-groupe', 'var-agora-groupes-store']) {
    const l = LINKS.find((x) => x.id === id);
    assert.ok(l && 'pas_encore' in l.coupure, `${id} : « pas encore », tant que ce que voudrait dire le couper n'est pas tranché`);
  }
  // Le compte par déclaration (L0) : 21 point unique, 29 alertes, 34 appels, 4 sondes, 16 alimentations, 33 pas encore.
  const compte: Record<string, number> = {};
  for (const l of LINKS) { const k = 'par' in l.coupure ? l.coupure.par : Object.keys(l.coupure)[0]; compte[k] = (compte[k] ?? 0) + 1; }
  assert.deepEqual(compte, { appel: 34, reflexe: 21, alerte: 29, alimentation: 16, pas_encore: 33, sonde: 4 });
  // Toutes les alertes vont à Forseti, et tout ce qui va à Forseti est une alerte.
  for (const l of LINKS) assert.equal(l.to === 'forseti' && l.from !== 'forseti', 'par' in l.coupure && l.coupure.par === 'alerte', l.id);
});

/** Une Valhalla réduite à la liste de ses applis (seul ce que lignesLiensEcrits lit). */
const valhallaDe = (ids: string[]) => {
  const mods = ids.map((id) => ({ id, name: id.toUpperCase() }));
  return { modules: () => mods, module: (id: string) => mods.find((m) => m.id === id) } as never;
};

test('chaque lien écrit apparaît une fois et une seule, en lecture seule, avec son état « actif »', () => {
  const toutes = [...new Set(LINKS.flatMap((k) => [k.from, k.to]))];
  const l = lignesLiensEcrits(valhallaDe(toutes));
  assert.equal(l.length, LINKS.length);
  assert.equal(new Set(l.map((x) => x.id)).size, l.length, 'identifiants distincts');
  LINKS.forEach((k, i) => {
    const x = l[i];
    assert.equal(l.filter((y) => y.de === k.from && y.vers === k.to && y.quand === k.when).length, 1, `${k.from} → ${k.to} une seule fois`);
    assert.deepEqual([x.sorte, x.de, x.vers, x.quand, x.fait, x.genre, x.etat, x.pourquoi], ['lien_ecrit', k.from, k.to, k.when, k.does, k.kind, 'actif', undefined]);
    assert.deepEqual(x.protege, k.protege);
    // L'identifiant montré est celui écrit à la main (plus tiré du texte « quand ») ; la déclaration suit le lien.
    assert.equal(x.id, `lien:${k.id}`);
    assert.deepEqual(x.coupure, k.coupure);
  });
});

test('un lien n\'est pas dit « actif » quand ses applis ne sont pas là', () => {
  // Les applis d'Odin ne tournent pas : aucun lien n'est branché.
  for (const x of lignesLiensEcrits(undefined)) assert.deepEqual([x.etat, x.pourquoi], ['inactif', 'les applis d\'Odin ne tournent pas']);
  // Cerbère absent : chacun de ses liens est inactif (et dit pourquoi), les autres restent actifs.
  const sans = [...new Set(LINKS.flatMap((k) => [k.from, k.to]))].filter((id) => id !== 'garmr');
  const l = lignesLiensEcrits(valhallaDe(sans));
  LINKS.forEach((k, i) => {
    const touche = k.from === 'garmr' || k.to === 'garmr';
    assert.equal(l[i].etat, touche ? 'inactif' : 'actif', `${k.from} → ${k.to}`);
    if (touche) assert.match(l[i].pourquoi ?? '', /appli absente : garmr/);
  });
  assert.ok(l.some((x) => x.etat === 'inactif') && l.some((x) => x.etat === 'actif'));
});

test('la route des automatismes porte les liens à part (ni dans les lignes, ni dans l\'agenda) ; seuls les 21 liens à point unique se coupent', async () => {
  const r = await talosGet(undefined, '/api/draupnir/automatismes', new URLSearchParams()) as { ok: boolean; lignes: Array<{ sorte: string }>; liens?: Array<{ id: string; sorte: string }> };
  assert.equal(r.ok, true);
  assert.equal(r.liens?.length, LINKS.length, 'tous les liens écrits sont dans la réponse');
  assert.ok(r.liens!.every((x) => x.sorte === 'lien_ecrit'));
  const c = contexteTalos();
  assert.ok(!lignesTalos(c).some((x) => (x.sorte as string) === 'lien_ecrit'), 'pas mêlés aux lignes qui se règlent');
  assert.ok(!agendaTalos(c, new Date(), new Date(Date.now() + 7 * 86_400_000)).some((x) => (x.sorte as string) === 'lien_ecrit'), 'pas dans l\'agenda');
  // Un lien qui n'est pas à point unique : aucune route ne le met en pause ni ne le lance (la coupure des 21 :
  // liens-coupes.test.ts).
  const id = r.liens![0].id;
  assert.deepEqual(LINKS[0].coupure, { par: 'appel' });
  for (const route of ['/api/draupnir/automatisme/pause', '/api/draupnir/automatisme/lancer', '/api/draupnir/automatisme/supprimer']) {
    const p = await talosPost(undefined, route, { id, pause: true, confirme: true }) as { ok: boolean };
    assert.equal(p.ok, false, `${route} refuse un lien écrit`);
  }
  // La marque n'est lue par aucun réflexe : ce que les liens font ne change pas.
  const src = lire('valhalla/links.ts'), wire = src.slice(src.indexOf('export function wireReflexes'), src.indexOf('/** Modèles d\'automatisations'));
  assert.doesNotMatch(wire, /protege/);
  // La déclaration « coupure » non plus : wireReflexes demande seulement, lien par lien, s'il est coupé (lienCoupe).
  assert.doesNotMatch(wire, /coupure|LINKS/);
  // Seuls les 21 liens à point unique se coupent d'ici ; aucun n'est coupé dans cet essai.
  const coupables = r.liens!.filter((x) => (x as { coupable?: boolean }).coupable).map((x) => x.id.slice(5));
  assert.deepEqual(coupables, LINKS.filter((l) => 'par' in l.coupure && l.coupure.par === 'reflexe').map((l) => l.id));
  assert.equal(coupables.length, 21);
  assert.ok(r.liens!.every((x) => !('coupe' in x) && !('etatCoupure' in x)), 'aucun état « coupé »');
});

test('la page : un bloc « Liens entre applis » par appli qui signale, filtre « Qui protègent », un interrupteur seulement sur les liens à point unique', () => {
  const win: Record<string, any> = {};
  const code = lire('web/pages/talos-automatismes.js');
  vm.runInNewContext(code, { window: win });
  const L = win.OdinAutomatismes.logique, liens = lignesLiensEcrits(undefined);
  assert.ok(L.FILTRES.some((f: { id: string }) => f.id === 'liens'), 'un filtre « Liens entre applis »');
  const tous = L.grouperLiens(liens, false), prot = L.grouperLiens(liens, true);
  assert.equal(tous.reduce((n: number, g: { liens: unknown[] }) => n + g.liens.length, 0), liens.length, 'chaque lien dans un seul groupe');
  assert.equal(new Set(tous.map((g: { de: string }) => g.de)).size, tous.length);
  assert.equal(prot.reduce((n: number, g: { liens: unknown[] }) => n + g.liens.length, 0), liens.filter((x) => x.protege).length);
  assert.equal(L.phraseLien(liens[0]), `Quand ${LINKS[0].when} → ${LINKS[0].does}`);
  const f = /function ligneLien\(l\) \{[\s\S]*?\n {2}\}/.exec(code)?.[0] ?? '';
  // La ligne elle-même n'a aucun bouton : seul l'interrupteur, posé sur un lien « coupable », en a (liens-coupes.test.ts).
  assert.ok(f.length > 50); assert.doesNotMatch(f, /'button'|\bB\(|onclick|input|checkbox/, 'une ligne de lien n\'a aucun bouton hors de l\'interrupteur');
  assert.match(f, /l\.coupable \? interrupteur\(l\)/, 'l\'interrupteur seulement sur un lien coupable');
  assert.match(f, /phraseCoupure\(l\.coupure\)/, 'les autres liens montrent la déclaration « coupure »');
  // La déclaration, en lecture : « pourra se couper », ou « ne se coupe pas (encore) : » avec sa raison.
  assert.equal(L.phraseCoupure({ par: 'appel' }), 'Pourra se couper.');
  assert.equal(L.phraseCoupure({ par: 'sonde', ou: 'vordr.autoMonitors' }), 'Pourra se couper.');
  assert.equal(L.phraseCoupure({ pas_encore: 'une raison assez longue' }), 'Ne se coupe pas encore : une raison assez longue.');
  assert.equal(L.phraseCoupure({ jamais: 'une raison assez longue' }), 'Ne se coupe pas : une raison assez longue.');
  assert.equal(L.phraseCoupure(undefined), '');
  for (const x of liens) assert.ok(L.phraseCoupure(x.coupure).length > 10, x.id);
});

test('un membre ou un invité ne voit pas la liste ; le propriétaire la voit', { timeout: 120_000 }, async () => {
  const tt = new T(), orig = { log: console.log, error: console.error, warn: console.warn };
  for (const k of ['log', 'error', 'warn'] as const) console[k] = () => undefined;
  try {
    const v = await vraiOdin(tt, { compte: true, modules: (o) => allModules(o).filter((m) => ['var', 'brisingamen'].includes(m.id)) }), va = valhallaOf()!;
    // Talos (les automatisations) n'est pas lancé par vraiOdin : on le démarre, comme odin-plein.ts.
    tt.onEnd(startDraupnir(v.o, async () => undefined));
    relierProprietaire(va.ctx('var'));
    const proprio = await v.json('/api/draupnir/automatismes');
    assert.equal(proprio.status, 200, JSON.stringify(proprio.body).slice(0, 300)); assert.ok(Array.isArray(proprio.body.liens), JSON.stringify(proprio.body).slice(0, 300)); assert.equal((proprio.body.liens as unknown[]).length, LINKS.length);
    // Cet Odin n'a que Persona et Thésauros : seuls les liens entre ces deux-là seraient actifs.
    for (const x of proprio.body.liens as Array<{ de: string; vers: string; etat: string }>) assert.equal(x.etat, ['var', 'brisingamen'].includes(x.de) && ['var', 'brisingamen'].includes(x.vers) ? 'actif' : 'inactif', `${x.de} → ${x.vers}`);
    for (const [login, groupe] of [['nour', 'famille'], ['lilo', 'invite']]) {
      const mdp = `${login}-ciel-de-sable-sous-la-pluie-27`;
      assert.equal((await va.act('var', 'ajouter', { login, nom: login, groupes: groupe, email: `${login}@exemple.yt`, mot_de_passe: mdp })).ok, true);
      let r = await fetch(`${v.url}/sso/odin`, { redirect: 'manual' }); r = await fetch(new URL(r.headers.get('location')!, v.url), { redirect: 'manual' });
      const demande = /name="demande" value="([^"]+)"/.exec(await r.text())![1];
      r = await fetch(`${v.url}/sso/autoriser`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded', origin: v.url }, body: new URLSearchParams({ demande, identifiant: login, motdepasse: mdp }) });
      r = await fetch(new URL(r.headers.get('location')!, v.url), { redirect: 'manual' });
      const cookie = r.headers.getSetCookie().find((c) => c.startsWith('odin_session='))?.split(';')[0] ?? '';
      // Un membre de la famille entre dans Odin ; un invité n'y entre même pas (pas le droit « odin ») : il essaie sans session.
      if (groupe === 'famille') assert.ok(cookie, `${login} a une session`);
      const m = await v.json('/api/draupnir/automatismes', undefined, { cookie });
      assert.ok(m.status === 401 || m.status === 403, `${login} (${groupe}) : refusé (${m.status})`);
      assert.equal(m.body.liens, undefined); assert.equal(m.body.lignes, undefined);
    }
  } finally { Object.assign(console, orig); await tt.end(); }
});
