// Hringhorni, lot K2 (maquette « Arche et Hydre » validée le 23/11) : les volumes nommés et les réseaux, dans le moteur.
// AUCUN vrai conteneur, AUCUNE vraie commande réseau : le moteur range ses fichiers dans un dossier jetable, et chaque
// commande (ip, nft, iptables) passe par un faux lanceur qui la note et répond ce que l'essai décide.
// - volumes : « nom:/dedans » donne un volume (créé tout seul) ; taille comptée sans suivre les liens ; qui s'en sert,
//   même arrêté ; supprimé seulement s'il ne sert plus, et jamais s'il passe par un lien ou n'est pas rangé chez le moteur ;
// - réseaux : chacun son pont et son sous-réseau, des noms gardés refusés, isolés les uns des autres (règles posées),
//   sans Internet : aucune sortie ; retirés seulement sans conteneur (pont et règles partent) ; le réseau « aucun ».
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Ctr } from '../src/valhalla/hringhorni/engine.ts';
import type { Spec } from '../src/valhalla/hringhorni/store.ts';

const dossiers: string[] = [];
const neuf = (p: string) => { const d = mkdtempSync(join(tmpdir(), p)); dossiers.push(d); return d; };
// Les adresses prises sont notées dans un dossier jetable (jamais /run de la machine) : lu au chargement du module.
process.env.ODIN_HRINGHORNI_BAUX = neuf('hr-k2-baux-');
let H: typeof import('../src/valhalla/hringhorni/engine.ts');
let N: typeof import('../src/valhalla/hringhorni/net.ts');
before(async () => { H = await import('../src/valhalla/hringhorni/engine.ts'); N = await import('../src/valhalla/hringhorni/net.ts'); });
after(() => { for (const d of dossiers) rmSync(d, { recursive: true, force: true }); });

type Cmd = { cmd: string; args: string[] };
/** Un faux lanceur : il note chaque commande ; `repond` décide du code rendu (0 par défaut). */
function lanceur(repond: (c: Cmd) => number = () => 0) {
  const vus: Cmd[] = [];
  const run = async (cmd: string, args: string[]) => { const c = { cmd, args }; vus.push(c); const code = repond(c); return { code, out: '', err: code ? 'non' : '' }; };
  return { vus, run, texte: () => vus.map((c) => `${c.cmd} ${c.args.join(' ')}`) };
}
function moteur(o: { rootless?: boolean; repond?: (c: Cmd) => number } = {}) {
  const dir = neuf('hr-k2-moteur-'), l = lanceur(o.repond);
  const e = new H.Engine(dir, { run: l.run, rootless: o.rootless ?? false, fetch: (async () => { throw new Error('essai : aucune sortie réseau'); }) as never });
  // une image déjà là (aucun téléchargement) : « create » ne lit que sa fiche
  e.store.saveImages([{ id: 'img1', names: ['registre.example.org/appli:1.0'], digest: 'sha256:x', config: { config: { Cmd: ['/bin/appli'] } } as never, configDigest: 'sha256:c', layers: [], size: 1, pulled: '' }]);
  return { e, l, dir };
}
/** Un conteneur posé directement (aucun lancement). */
function poser(e: InstanceType<typeof H.Engine>, nom: string, o: Partial<Spec> = {}, etat: Ctr['state']['status'] = 'arrêté'): Spec {
  const id = `${nom.replace(/[^a-f0-9]/g, 'a').padEnd(12, 'b')}${'c'.repeat(52)}`.slice(0, 64);
  const sp: Spec = { id, name: nom, image: 'registre.example.org/appli:1.0', imageId: 'img1', cmd: ['/bin/appli'], env: {}, workdir: '/', user: '', ports: [], mounts: [], restart: 'non', hostname: nom, network: 'pont', autoRemove: false, created: new Date().toISOString(), labels: {}, ...o };
  e.store.saveSpec(sp); e.store.saveState(id, { status: etat });
  return sp;
}

test('volumes : « nom:/dedans » donne un volume rangé par le moteur, créé tout seul ; un nom faux ou un chemin qui remonte est refusé', async () => {
  const { e } = moteur();
  const m = e.montages('photos-donnees:/donnees, /srv/partage:/partage:ro');
  assert.deepEqual(m[0], { host: e.store.volumeData('photos-donnees'), inner: '/donnees', ro: false, volume: 'photos-donnees' });
  assert.deepEqual(m[1], { host: '/srv/partage', inner: '/partage', ro: true });
  for (const x of ['Photos:/donnees', 'photos:../etc', 'photos:/a/../../etc', '../x:/y', 'a b:/c']) assert.throws(() => e.montages(x), /invalide/, x);
  // Un conteneur créé avec un volume : le volume existe aussitôt, vide, et le conteneur s'en sert.
  const sp = await e.create({ image: 'registre.example.org/appli:1.0', name: 'galerie', mounts: 'photos-donnees:/donnees', network: 'pont' });
  assert.equal(sp.mounts[0].volume, 'photos-donnees');
  assert.ok(existsSync(e.store.volumeData('photos-donnees')));
  assert.deepEqual(e.volumes().map((v) => [v.nom, v.utilisePar]), [['photos-donnees', ['galerie']]]);
  // Déjà là : réutilisé, pas recréé ; créer à la main un volume qui existe est refusé.
  await e.create({ image: 'registre.example.org/appli:1.0', name: 'galerie2', mounts: 'photos-donnees:/donnees:ro' });
  assert.deepEqual(e.volumes()[0].utilisePar.sort(), ['galerie', 'galerie2']);
  assert.throws(() => e.createVolume('photos-donnees'), /existe déjà/);
  for (const n of ['', 'A', '-x', 'a/b', '..', 'x'.repeat(64)]) assert.throws(() => e.createVolume(n), /invalide/, n);
});

test('volumes : la taille est comptée sans suivre les liens, bornée ; qui s\'en sert, même arrêté', () => {
  const { e } = moteur();
  e.createVolume('wiki-pages');
  const d = e.store.volumeData('wiki-pages');
  mkdirSync(join(d, 'sous'), { recursive: true });
  writeFileSync(join(d, 'a.txt'), 'x'.repeat(1000)); writeFileSync(join(d, 'sous', 'b.txt'), 'y'.repeat(500));
  // un lien vers un grand dossier ailleurs : jamais compté (ni suivi)
  const ailleurs = neuf('hr-k2-ailleurs-'); writeFileSync(join(ailleurs, 'gros'), 'z'.repeat(100_000));
  try { symlinkSync(ailleurs, join(d, 'lien'), 'junction'); } catch { /* pas de lien possible ici : le compte reste juste */ }
  const v = e.volumes()[0];
  assert.equal(v.octets, 1500); assert.equal(v.fichiers, 2); assert.equal(v.compteCoupe, false);
  assert.deepEqual(H.tailleDossier(d, 2).coupe, true, 'borné : au-delà, le compte s\'arrête et le dit');
  poser(e, 'notes', { mounts: [{ host: d, inner: '/pages', ro: false }] }, 'arrêté');
  assert.deepEqual(e.volumes()[0].utilisePar, ['notes'], 'un conteneur arrêté s\'en sert encore');
});

test('supprimer un volume : seulement s\'il ne sert plus ; jamais par un lien ; la garde de l\'appli peut refuser ; rien n\'est touché sinon', () => {
  const { e } = moteur();
  e.createVolume('jeu-monde'); e.createVolume('ancien-essai');
  writeFileSync(join(e.store.volumeData('ancien-essai'), 'f'), 'données');
  poser(e, 'jeu', { mounts: [{ host: e.store.volumeData('jeu-monde'), inner: '/monde', ro: false, volume: 'jeu-monde' }] });
  assert.throws(() => e.rmVolume('jeu-monde'), /sert encore à : jeu/);
  assert.ok(existsSync(e.store.volumeData('jeu-monde')));
  assert.throws(() => e.rmVolume('inconnu'), /volume inconnu/);
  // la garde de l'appli dit non : rien n'est effacé
  assert.throws(() => e.rmVolume('ancien-essai', () => 'un dossier du système'), /pas effacé : un dossier du système/);
  assert.ok(existsSync(join(e.store.volumeData('ancien-essai'), 'f')));
  e.rmVolume('ancien-essai');
  assert.equal(existsSync(e.store.volumeDir('ancien-essai')), false);
  assert.deepEqual(e.volumes().map((v) => v.nom), ['jeu-monde']);
});

test('supprimer un volume qui passe par un lien : refusé, et la cible du lien reste intacte', (t) => {
  const { e } = moteur();
  const cible = neuf('hr-k2-cible-'); writeFileSync(join(cible, 'precieux'), 'à garder');
  e.store.ensure(); mkdirSync(e.store.volumesDir(), { recursive: true });
  try { symlinkSync(cible, e.store.volumeDir('piege'), 'junction'); } catch { t.skip('pas de lien possible sur ce PC'); return; }
  writeFileSync(join(cible, 'fiche.json'), JSON.stringify({ nom: 'piege', cree: '' }));
  mkdirSync(join(cible, 'donnees'), { recursive: true });
  assert.deepEqual(e.volumes().map((v) => v.nom), ['piege']);
  assert.throws(() => e.rmVolume('piege'), /lien|pas rangé/);
  assert.ok(existsSync(join(cible, 'precieux')), 'la cible du lien n\'est jamais touchée');
});

test('réseaux : chacun son pont et son sous-réseau ; noms gardés refusés ; le réseau de tous toujours là', () => {
  const { e } = moteur();
  const a = e.createReseau('serveur-de-jeux'), b = e.createReseau('cage', { internet: false });
  assert.deepEqual([a.pont, a.sousReseau, a.internet], ['odin1', '10.89.1', true]);
  assert.deepEqual([b.pont, b.sousReseau, b.internet], ['odin2', '10.89.2', false]);
  for (const n of ['conteneurs', 'aucun', 'none', 'host', 'hote', 'bridge', 'pont', 'odin']) assert.throws(() => e.createReseau(n), /nom gardé/, n);
  assert.throws(() => e.createReseau('cage'), /existe déjà/);
  assert.throws(() => e.createReseau('Pas Bon'), /invalide/);
  const l = e.reseaux();
  assert.deepEqual(l.map((r) => [r.nom, r.defaut, r.pont]), [['conteneurs', true, 'odin0'], ['serveur-de-jeux', false, 'odin1'], ['cage', false, 'odin2']]);
  assert.equal(N.sousReseauLibre(['10.89.1', '10.89.3']), '10.89.2');
});

test('créer un conteneur : réseau à part connu seulement ; « aucun » sans port ; le réseau gardé dans sa fiche', async () => {
  const { e } = moteur();
  await assert.rejects(e.create({ image: 'registre.example.org/appli:1.0', name: 'x', reseau: 'inconnu' }), /réseau inconnu/);
  await assert.rejects(e.create({ image: 'registre.example.org/appli:1.0', name: 'y', network: 'aucun', ports: '8080:80' }), /aucun port/);
  e.createReseau('jeux');
  const sp = await e.create({ image: 'registre.example.org/appli:1.0', name: 'monde', reseau: 'jeux' });
  assert.deepEqual([sp.network, sp.reseau], ['pont', 'jeux']);
  const tous = await e.create({ image: 'registre.example.org/appli:1.0', name: 'web', reseau: 'conteneurs' });
  assert.equal(tous.reseau, undefined, 'le réseau de tous n\'est pas un réseau à part');
  const seul = await e.create({ image: 'registre.example.org/appli:1.0', name: 'seul', network: 'aucun' });
  assert.equal(seul.network, 'aucun');
  assert.deepEqual(e.reseaux().map((r) => [r.nom, r.conteneurs]), [['conteneurs', ['web']], ['jeux', ['monde']]]);
});

test('un réseau à part monté : son pont, isolé des autres ponts d\'Odin dans les deux sens, Internet seulement s\'il est permis', async () => {
  // aucun pont ni table au départ : le faux lanceur répond « absent » aux lectures
  const repond = (c: Cmd) => ((c.cmd === 'ip' && c.args[0] === 'link' && c.args[1] === 'show') || (c.cmd === 'nft' && c.args[0] === 'list') ? 1 : 0);
  const avec = lanceur(repond);
  await N.ensureBridge(avec.run, { pont: 'odin1', sousReseau: '10.89.1', internet: true });
  const t1 = avec.texte();
  assert.ok(t1.includes('ip link add odin1 type bridge')); assert.ok(t1.includes('ip addr add 10.89.1.1/24 dev odin1'));
  assert.ok(t1.includes('nft add rule ip odin1 isoler iifname odin1 oifname "odin*" oifname != odin1 drop'), 'rien vers un autre pont');
  assert.ok(t1.includes('nft add rule ip odin1 isoler oifname odin1 iifname "odin*" iifname != odin1 drop'), 'rien depuis un autre pont');
  assert.ok(t1.includes('nft add rule ip odin1 sortie ip saddr 10.89.1.0/24 oifname != odin1 masquerade'), 'Internet');
  const sans = lanceur(repond);
  await N.ensureBridge(sans.run, { pont: 'odin2', sousReseau: '10.89.2', internet: false });
  const t2 = sans.texte();
  assert.ok(t2.includes('nft add rule ip odin2 isoler iifname odin2 oifname != odin2 drop'), 'sans Internet : rien ne sort');
  assert.ok(!t2.some((x) => /masquerade/.test(x)), 'sans Internet : pas de sortie');
  // sans nftables : les mêmes règles en iptables
  const ipt = lanceur((c) => (repond(c) || (c.cmd === 'nft') ? 1 : 0) || (c.cmd === 'iptables' && c.args.includes('-C') ? 1 : 0));
  await N.ensureBridge(ipt.run, { pont: 'odin3', sousReseau: '10.89.3', internet: false });
  const t3 = ipt.texte();
  assert.ok(t3.includes('iptables -I FORWARD -i odin3 -o odin+ -j DROP')); assert.ok(t3.includes('iptables -I FORWARD -i odin+ -o odin3 -j DROP'));
  assert.ok(t3.includes('iptables -I FORWARD -i odin3 ! -o odin3 -j DROP'));
  // un pont ou un sous-réseau faux n'est jamais monté
  for (const p of [{ pont: 'eth0', sousReseau: '10.89.4', internet: true }, { pont: 'odin5', sousReseau: '192.168.1', internet: true }, { pont: 'odin250', sousReseau: '10.89.250', internet: true }]) await assert.rejects(N.ensureBridge(lanceur().run, p), /invalide/);
  // le réseau de tous : comme avant (sa table « odin »)
  const tous = lanceur(repond); await N.ensureBridge(tous.run);
  assert.ok(tous.texte().includes('ip link add odin0 type bridge'));
});

test('démarrer sur un réseau à part : adresse dans son sous-réseau, carte branchée sur son pont ; « aucun » : un espace réseau vide', async () => {
  const { e, l } = moteur({ repond: (c) => ((c.cmd === 'ip' && c.args[0] === 'link' && c.args[1] === 'show') || (c.cmd === 'nft' && c.args[0] === 'list') ? 1 : 0) });
  e.createReseau('jeux');
  const sp = await e.create({ image: 'registre.example.org/appli:1.0', name: 'monde', reseau: 'jeux' });
  const ip = await e.startNetwork(sp);
  assert.match(ip ?? '', /^10\.89\.1\.\d+$/);
  const t = l.texte();
  assert.ok(t.some((x) => /^ip link set od\w+h master odin1$/.test(x)), 'branché sur le pont du réseau');
  assert.ok(t.some((x) => x.endsWith('route add default via 10.89.1.1')));
  N.release(ip, sp.id);
  // « aucun » en administrateur : un espace réseau avec seulement sa boucle, et le conteneur y est lancé
  l.vus.length = 0;
  const seul = await e.create({ image: 'registre.example.org/appli:1.0', name: 'seul', network: 'aucun' });
  assert.equal(await e.startNetwork(seul), undefined);
  assert.deepEqual(l.texte().filter((x) => /netns add|lo up/.test(x)), [`ip netns add ${N.nsName(seul.id)}`, `ip -n ${N.nsName(seul.id)} link set lo up`]);
  assert.ok(!l.texte().some((x) => /veth|master/.test(x)), 'aucune carte vers un pont');
  const tools = { unshare: 'unshare', ip: 'ip' } as never;
  assert.deepEqual(e.outer(seul, 'x', tools).slice(0, 4), ['ip', 'netns', 'exec', N.nsName(seul.id)]);
  // sans administrateur : unshare --net (un espace réseau vide), aucune commande ip
  const r = moteur({ rootless: true });
  const seul2 = await r.e.create({ image: 'registre.example.org/appli:1.0', name: 'seul', network: 'aucun' });
  assert.equal(await r.e.startNetwork(seul2), undefined); assert.equal(r.l.vus.length, 0);
  assert.ok(r.e.outer(seul2, 'x', tools).includes('--net'));
});

test('retirer un réseau : jamais celui de tous, jamais s\'il sert (même arrêté) ; sinon son pont et sa table partent', async () => {
  const { e, l } = moteur();
  e.createReseau('jeux'); e.createReseau('vide');
  poser(e, 'monde', { reseau: 'jeux' }, 'arrêté');
  await assert.rejects(e.rmReseau('conteneurs'), /ne se retire pas/);
  await assert.rejects(e.rmReseau('jeux'), /sert encore à : monde/);
  await assert.rejects(e.rmReseau('inconnu'), /réseau inconnu/);
  l.vus.length = 0;
  await e.rmReseau('vide');
  assert.deepEqual(l.texte(), ['ip link del odin2', 'nft delete table ip odin2']);
  assert.deepEqual(e.reseaux().map((r) => r.nom), ['conteneurs', 'jeux']);
  await assert.rejects(N.removeBridge(lanceur().run, N.PONT_DEFAUT), /ne se retire pas/);
});

// ---- Relecture du lot K2 (sûreté d'abord) : chaque trou trouvé a son essai, qui échouait avant la correction ----
import { renameSync as renommer } from 'node:fs';

test('relecture : un conteneur qui monte le dossier des volumes (au-dessus du volume) s\'en sert : le volume n\'est pas supprimé', () => {
  const { e } = moteur();
  e.createVolume('jeu-monde'); writeFileSync(join(e.store.volumeData('jeu-monde'), 'monde.dat'), 'précieux');
  poser(e, 'curieux', { mounts: [{ host: e.store.volumesDir(), inner: '/tout', ro: false }] });
  assert.deepEqual(e.volumes()[0].utilisePar, ['curieux']);
  assert.throws(() => e.rmVolume('jeu-monde'), /sert encore à : curieux/);
  assert.ok(existsSync(join(e.store.volumeData('jeu-monde'), 'monde.dat')));
});

test('relecture : un dossier partagé n\'est jamais le dossier du moteur ; « c:/… » ou un mode inconnu sont refusés, jamais devinés', () => {
  const e = new H.Engine('/hr-k2-relecture-moteur', { run: lanceur().run, rootless: false });
  for (const x of ['/hr-k2-relecture-moteur/volumes/jeu/donnees:/d', '/hr-k2-relecture-moteur:/d', '/hr-k2-relecture-moteur/containers:/d:ro']) assert.throws(() => e.montages(x), /moteur/, x);
  for (const x of ['c:/Users/moi:/d', '/srv/a:/b:rx', 'photos:/d:rx', 'photos:/d:ro:x']) assert.throws(() => e.montages(x), /invalide/, x);
  assert.deepEqual(e.montages('/srv/a:/b:rw'), [{ host: '/srv/a', inner: '/b', ro: false }]);
});

test('relecture : noms gardés par Windows et point final refusés ; « machine » est gardé pour les réseaux', async () => {
  const S = await import('../src/valhalla/hringhorni/store.ts');
  for (const n of ['con', 'nul', 'com1', 'lpt9', 'aux.txt', 'abc.']) assert.equal(S.NOM_OBJET.test(n), false, n);
  for (const n of ['console', 'nuls', 'a.b', 'com', 'photos-donnees']) assert.equal(S.NOM_OBJET.test(n), true, n);
  const { e } = moteur();
  assert.throws(() => e.createVolume('abc.'), /invalide/);
  assert.throws(() => e.createReseau('machine'), /nom gardé/);
});

test('relecture : compter les volumes a un seul budget pour tous (entrées et temps) : Odin n\'est jamais bloqué', () => {
  const { e } = moteur();
  for (const n of ['a1', 'a2', 'a3']) { e.createVolume(n); for (let i = 0; i < 10; i++) writeFileSync(join(e.store.volumeData(n), `f${i}`), 'x'); }
  const avant = { ...H.COMPTE_VOLUMES };
  try {
    H.COMPTE_VOLUMES.entrees = 15;
    const l = e.volumes();
    assert.ok(l.reduce((a, v) => a + v.fichiers, 0) <= 15);
    assert.deepEqual(l.map((v) => v.compteCoupe), [false, true, true]);
    H.COMPTE_VOLUMES.entrees = 1e6; H.COMPTE_VOLUMES.ms = -1;
    assert.ok(e.volumes().every((v) => v.compteCoupe), 'temps écoulé : le compte s\'arrête et le dit');
  } finally { Object.assign(H.COMPTE_VOLUMES, avant); }
});

test('relecture : le dossier des volumes remplacé par un lien PENDANT la suppression : rien n\'est effacé, ni ici ni au bout du lien', (t) => {
  const { e, dir } = moteur();
  e.createVolume('vieux'); writeFileSync(join(e.store.volumeData('vieux'), 'f'), 'à moi');
  const ailleurs = neuf('hr-k2-ailleurs2-'); mkdirSync(join(ailleurs, 'vieux', 'donnees'), { recursive: true }); writeFileSync(join(ailleurs, 'vieux', 'donnees', 'precieux'), 'à garder');
  let lien = false;
  // la garde de l'appli est appelée après la vérification : c'est là que le lien est posé (la course)
  const essai = () => e.rmVolume('vieux', () => {
    renommer(e.store.volumesDir(), join(dir, 'volumes-vrai'));
    try { symlinkSync(ailleurs, e.store.volumesDir(), 'junction'); lien = true; } catch { /* pas de lien possible */ }
    return undefined;
  });
  let erreur: unknown; try { essai(); } catch (x) { erreur = x; }
  if (!lien) { t.skip('pas de lien possible sur ce PC'); return; }
  assert.ok(existsSync(join(ailleurs, 'vieux', 'donnees', 'precieux')), 'la cible du lien n\'est jamais touchée');
  assert.match(String((erreur as Error | undefined)?.message), /lien|moteur/);
  assert.ok(existsSync(join(dir, 'volumes-vrai', 'vieux', 'donnees', 'f')));
});

test('relecture : une table restée d\'un réseau retiré n\'est jamais reprise telle quelle ; « sans Internet » ne joint pas non plus ce PC', async () => {
  // une table « odin2 » est déjà là, avec la sortie Internet d'un ancien réseau : le nouveau réseau sans Internet la refait
  const vieille = lanceur((c) => (c.cmd === 'ip' && c.args[1] === 'show' ? 1 : 0));
  const run = async (cmd: string, args: string[]) => { const r = await vieille.run(cmd, args); return cmd === 'nft' && args[0] === 'list' ? { ...r, out: 'table ip odin2 {\n chain sortie {\n  ip saddr 10.89.2.0/24 oifname != "odin2" masquerade\n }\n}' } : r; };
  await N.ensureBridge(run, { pont: 'odin2', sousReseau: '10.89.2', internet: false });
  const t = vieille.texte();
  assert.ok(t.includes('nft delete table ip odin2'), 'l\'ancienne table part');
  assert.ok(t.includes('nft add rule ip odin2 isoler iifname odin2 oifname != odin2 drop'), 'rien ne sort');
  assert.ok(t.includes('nft add rule ip odin2 entree iifname odin2 ct state new,invalid drop'), 'ni ce PC (le port d\'Odin, ses services)');
  // en iptables aussi
  const ipt = lanceur((c) => ((c.cmd === 'ip' && c.args[1] === 'show') || c.cmd === 'nft' || (c.cmd === 'iptables' && c.args.includes('-C')) ? 1 : 0));
  await N.ensureBridge(ipt.run, { pont: 'odin3', sousReseau: '10.89.3', internet: false });
  assert.ok(ipt.texte().includes('iptables -I INPUT -i odin3 -m conntrack --ctstate NEW,INVALID -j DROP'));
  // retirer : si la table ne part pas, le réseau reste noté (sinon un futur réseau sur ce pont hériterait de ses règles)
  const { e } = moteur({ repond: (c) => (c.cmd === 'nft' && c.args[0] === 'delete' ? 1 : 0) });
  e.createReseau('vide');
  await assert.rejects(e.rmReseau('vide'), /règles/);
  assert.deepEqual(e.reseaux().map((r) => r.nom), ['conteneurs', 'vide']);
});
