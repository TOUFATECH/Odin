// Arche (identifiant interne naglfar), lot K1 (maquette « Arche et Hydre » validée le 23/11) : le tableau de bord et la
// fiche d'un conteneur. AUCUN vrai conteneur : le moteur est un faux (comme les autres essais de l'appli), les mesures
// du processeur et de la mémoire sont données par l'essai, le « terminal » lance Node lui-même à la place du conteneur.
// - le tableau : ce qui tourne, processeur (entre deux relectures), mémoire, disque, arrêtés, en erreur, mises à jour ;
// - la fiche : ports, dossiers, variables (les secrets masqués), redémarrage, limites, ses données ;
// - le journal : relu, BORNÉ (le moteur n'est jamais appelé pour plus de 400 lignes, chaque ligne coupée à 2 000
//   caractères), nettoyé, secrets masqués, seulement les lignes nouvelles avec « depuis » ;
// - supprimer : données GARDÉES par défaut ; effacées seulement avec le nom tapé à l'identique ; jamais un dossier
//   personnel, partagé ou trop près de la racine ;
// - le terminal : une commande à la fois, après confirmation, pas d'interactif, sortie masquée ;
// - propriétaire seul : membre, automatisation, clé d'API, tablette refusés, et rien n'est touché ; tout est noté ;
// - Windows : le tableau le dit (et ce qui viendra), les gestes refusent proprement, le moteur n'est pas touché.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer as serveurHttp } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Valhalla } from '../src/valhalla/service.ts';
import { allModules, setValhalla } from '../src/valhalla/odin.ts';
import { DEFAULT_CONFIG } from '../src/config.ts';
import { valhallaPost } from '../src/web/valhalla-api.ts';
import { maisonRoute } from '../src/web/maison-api.ts';
import { resetGladsheim } from '../src/valhalla/modules/gladsheim.ts';
import { attendQuOnTape, JOURNAL_MAX, LIGNE_MAX, masquer, nomArche, systemeArche, useEngine, type EngineLike } from '../src/valhalla/modules/naglfar.ts';
import { NAMES } from '../src/valhalla/names.ts';
import type { Ctr } from '../src/valhalla/hringhorni/engine.ts';
import { Vault } from '../src/brain/vault.ts';
import { syncSheets } from '../src/valhalla/fiches.ts';
import { findApp } from '../src/valhalla/directports.ts';
import { appliDeNom, nomBase } from '../src/valhalla/base/noms.ts';

const dossiers: string[] = [];
const neuf = (p: string) => { const d = mkdtempSync(join(tmpdir(), p)); dossiers.push(d); return d; };
const origine = { ...systemeArche };
after(() => { Object.assign(systemeArche, origine); for (const d of dossiers) rmSync(d, { recursive: true, force: true }); });

const SECRET = 'Sup3r-S3cret-Valeur-9f8e7d';
function ctr(nom: string, o: { etat?: Ctr['state']['status']; mounts?: Ctr['spec']['mounts']; env?: Record<string, string>; ports?: Ctr['spec']['ports']; code?: number; erreur?: string; memory?: string } = {}): Ctr {
  const id = `${nom.replace(/[^a-f0-9]/g, 'a').padEnd(12, 'b')}${'c'.repeat(52)}`.slice(0, 64);
  return {
    id, spec: { id, name: nom, image: `registre.example.org/${nom}:1.0`, imageId: 'sha256:img', cmd: [], env: o.env ?? {}, workdir: '/', user: '', ports: o.ports ?? [], mounts: o.mounts ?? [], restart: 'sauf-arret', memory: o.memory, cpus: '1', hostname: nom, network: 'pont', autoRemove: false, created: '2026-11-20T10:00:00.000Z', labels: {} },
    state: { status: o.etat ?? 'en marche', startedAt: '2026-11-23T08:00:00.000Z', ip: '10.89.0.12', ...(o.code !== undefined ? { exitCode: o.code } : {}), ...(o.erreur ? { error: o.erreur } : {}) },
  };
}
/** Un faux moteur : il tient la liste des conteneurs et note chaque geste ; aucun conteneur, aucune commande système. */
function fauxMoteur(cts: Ctr[]) {
  const f = { gestes: [] as string[], logsTail: [] as number[], journal: new Map<string, Array<{ at: string; stream: 'o' | 'e'; text: string }>>(), execs: [] as string[][] };
  const find = (n: string) => { const c = cts.find((x) => x.spec.name === n || x.id.startsWith(n)); if (!c) throw new Error(`conteneur inconnu : ${n}`); return c; };
  const non = () => { throw new Error('essai : pas ce geste'); };
  const e = {
    ps: (all = false) => (all ? cts : cts.filter((c) => c.state.status === 'en marche')),
    find,
    start: async (n: string) => { const c = find(n); f.gestes.push(`start ${n}`); c.state.status = 'en marche'; return c; },
    stop: async (n: string) => { const c = find(n); f.gestes.push(`stop ${n}`); c.state.status = 'arrêté'; return c; },
    restart: async (n: string) => { const c = find(n); f.gestes.push(`restart ${n}`); return c; },
    rm: async (n: string) => { const c = find(n); f.gestes.push(`rm ${n}`); cts.splice(cts.indexOf(c), 1); return c.spec; },
    run: non, pull: non, rmi: non, runJob: non, pullJob: non, startJob: non,
    logs: (n: string, tail = 200) => { f.logsTail.push(tail); return (f.journal.get(find(n).spec.name) ?? []).slice(-tail); },
    images: () => [{ id: 'sha256:img', names: ['registre.example.org/web:1.0'], size: 300 * 1024 ** 2, created: '' }],
    execArgs: async (n: string, argv: string[]) => { find(n); f.execs.push(argv); return { cmd: process.execPath, args: ['-e', argv[0] === 'lent' ? 'setTimeout(()=>{},1500)' : `process.stdout.write(${JSON.stringify(`sortie de ${argv.join(' ')} · MOT_DE_PASSE=${SECRET}`)})`], env: {} }; },
    inspect: non, findImage: () => undefined, jobs: () => [],
    resize: async (n: string, o: { memory?: string; cpus?: string }) => { const c = find(n); f.gestes.push(`resize ${n} ${o.memory ?? ''} ${o.cpus ?? ''}`.trim()); if (o.memory) c.spec.memory = o.memory; if (o.cpus) c.spec.cpus = o.cpus; return c; },
  };
  return { f, e: e as unknown as EngineLike };
}
function monde(cts: Ctr[]) {
  const home = neuf('arche-k1-'), moteurDir = neuf('arche-k1-moteur-');
  const m = fauxMoteur(cts); useEngine(() => m.e);
  let t = 1_000_000;
  Object.assign(systemeArche, {
    plateforme: () => 'linux', coeurs: () => 4, dossierMoteur: () => moteurDir,
    disque: () => ({ libre: 120 * 1024 ** 3, total: 500 * 1024 ** 3 }),
    // 0,4 s de processeur par seconde sur 4 cœurs : 10 % du PC ; 200 Mo de mémoire.
    stat: (c: Ctr) => ({ usageUsec: (t += 0) * 400, memCurrent: 200 * 1024 ** 2, memMax: 512 * 1024 ** 2, cpuQuota: 1, throttled: 0, at: t }),
  });
  const avance = (ms: number) => { t += ms; };
  const v = new Valhalla(home, allModules({ paths: { home, workspace: home }, cfg: DEFAULT_CONFIG } as never), {
    run: async () => ({ code: 1, out: '', err: 'essai : aucune commande' }),
    fetch: (async () => { throw new Error('essai : aucune sortie réseau'); }) as never, notify: async () => {}, autonomy: () => 'equilibre',
  });
  return { v, home, ...m, avance, fin: () => v.stop() };
}
type Tab = { moteur: boolean; nom: string; raison?: string; avenir?: string; conteneurs: Array<Record<string, unknown>>; totaux: Record<string, number>; disque: Record<string, number>; majs: Array<{ image: string; conteneurs: string[] }> };

test('le nom affiché vient d\'un seul endroit (src/valhalla/names.ts), et deux applis ne portent jamais le même nom', () => {
  assert.equal(nomArche(), NAMES.naglfar);
  const parNom = new Map<string, string[]>();
  for (const [id, n] of Object.entries(NAMES)) parNom.set(n.toLowerCase(), [...(parNom.get(n.toLowerCase()) ?? []), id]);
  const doubles = [...parNom.entries()].filter(([, ids]) => ids.length > 1).map(([n, ids]) => `${n} : ${ids.join(', ')}`);
  assert.deepEqual(doubles, [], 'un nom porté par deux applis : leurs fiches du Cerveau s\'écraseraient et Odin ne saurait pas laquelle ouvrir');
});

test('tableau de bord avec un moteur simulé : ce qui tourne, processeur, mémoire, disque, arrêtés, en erreur, mises à jour connues', async () => {
  const w = monde([ctr('web', { ports: [{ host: 8080, inner: 80, proto: 'tcp' }], memory: '512m' }), ctr('wiki', { etat: 'sorti', code: 137, erreur: `plus de mémoire (password=${SECRET})` }), ctr('cache', { etat: 'arrêté' })]);
  try {
    w.v.ctx('naglfar').saveSettings({ versions: [{ image: 'registre.example.org/web:1.0', conteneurs: ['web'], nouvelle: true, locale: 'a', distante: 'b' }] });
    const r1 = await w.v.act('naglfar', 'tableau');
    assert.equal(r1.ok, true, r1.text);
    const t1 = r1.data as Tab;
    assert.equal(t1.moteur, true); assert.equal(t1.nom, nomArche());
    assert.deepEqual([t1.totaux.total, t1.totaux.enMarche, t1.totaux.enErreur, t1.totaux.arretes], [3, 1, 1, 1]);
    assert.equal(t1.totaux.cpu, undefined, 'une seule mesure : le processeur se calcule entre deux relectures');
    assert.equal(t1.totaux.memoire, 200 * 1024 ** 2);
    assert.equal(t1.disque.images, 300 * 1024 ** 2); assert.equal(t1.disque.libre, 120 * 1024 ** 3);
    assert.deepEqual(t1.majs, [{ image: 'registre.example.org/web:1.0', conteneurs: ['web'] }]);
    const web = t1.conteneurs.find((c) => c.nom === 'web')!, wiki = t1.conteneurs.find((c) => c.nom === 'wiki')!;
    assert.equal(web.majDispo, true); assert.equal(web.limiteMemoire, 512 * 1024 ** 2); assert.deepEqual(web.ports, [{ hote: 8080, dedans: 80, proto: 'tcp' }]);
    assert.equal(wiki.enErreur, true); assert.equal(wiki.code, 137);
    assert.doesNotMatch(String(wiki.erreur), new RegExp(SECRET), 'l\'erreur ne montre pas un secret');
    w.avance(1000);
    const t2 = (await w.v.act('naglfar', 'tableau')).data as Tab;
    assert.equal(t2.totaux.cpu, 10, '0,4 s de processeur par seconde sur 4 cœurs = 10 % du PC');
    assert.deepEqual(w.f.gestes, [], 'lire le tableau ne touche à rien');
  } finally { w.fin(); }
});

test('fiche : ports, dossiers, variables (secrets masqués), redémarrage, limites, ses données', async () => {
  const d = neuf('arche-k1-donnees-'), donnees = join(d, 'apps', 'web', 'donnees'), partage = join(d, 'apps', 'partage');
  mkdirSync(donnees, { recursive: true }); mkdirSync(partage, { recursive: true });
  const w = monde([ctr('web', { ports: [{ host: 8080, inner: 80, proto: 'tcp' }], mounts: [{ host: donnees, inner: '/donnees', ro: false }, { host: '/media', inner: '/media', ro: false }, { host: partage, inner: '/p', ro: false }, { host: join(d, 'photos'), inner: '/photos', ro: true }], env: { FUSEAU: 'UTC', MOT_DE_PASSE_ADMIN: SECRET, URL: `postgres://app:${SECRET}@odin-pg/app` } }), ctr('autre', { mounts: [{ host: partage, inner: '/p', ro: true }] })]);
  try {
    const r = await w.v.act('naglfar', 'fiche', { conteneur: 'web' });
    assert.equal(r.ok, true, r.text);
    const f = r.data as Record<string, unknown> & { variables: Array<{ cle: string; valeur: string; secrete?: boolean }>; donnees: Array<{ dossier: string; effacable: boolean; raison?: string }>; dossiers: unknown[] };
    assert.deepEqual(f.ports, [{ hote: 8080, dedans: 80, proto: 'tcp' }]);
    assert.equal(f.dossiers.length, 4); assert.equal(f.redemarrage, 'sauf si je l\'arrête'); assert.equal(f.limiteCoeurs, '1');
    assert.deepEqual(f.variables.find((x) => x.cle === 'FUSEAU'), { cle: 'FUSEAU', valeur: 'UTC' });
    assert.equal(f.variables.find((x) => x.cle === 'MOT_DE_PASSE_ADMIN')?.secrete, true);
    assert.doesNotMatch(JSON.stringify(f), new RegExp(SECRET), 'aucun secret dans la fiche, même caché dans une adresse');
    // Ses données : seulement les dossiers où il écrit ; un dossier trop près de la racine ou partagé n'est jamais effaçable.
    const parDossier = Object.fromEntries(f.donnees.map((x) => [x.dossier, x]));
    assert.equal(parDossier[donnees].effacable, true);
    assert.equal(parDossier['/media'].effacable, false); assert.match(parDossier['/media'].raison!, /racine/);
    assert.equal(parDossier[partage].effacable, false); assert.match(parDossier[partage].raison!, /aussi utilisé par autre/);
    assert.equal(parDossier[join(d, 'photos')], undefined, 'un dossier en lecture seule n\'est pas « ses données »');
    assert.match((await w.v.act('naglfar', 'fiche', { conteneur: 'inconnu' })).text, /conteneur inconnu/);
  } finally { w.fin(); }
});

test('journal : relu, borné (400 lignes au plus, 2 000 caractères par ligne), nettoyé, secrets masqués, « depuis »', async () => {
  const w = monde([ctr('web', { env: { API_TOKEN: SECRET } })]);
  try {
    const l = Array.from({ length: 5000 }, (_, i) => ({ at: `2026-11-23T10:${String(Math.floor(i / 60) % 60).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}.${String(i).padStart(4, '0')}Z`, stream: (i % 7 ? 'o' : 'e') as 'o' | 'e', text: `ligne ${i}` }));
    l[4990] = { ...l[4990], text: `connexion avec le jeton ${SECRET} et \u001b[31mrouge\u001b[0m` };
    l[4995] = { ...l[4995], text: 'x'.repeat(10_000) };
    w.f.journal.set('web', l);
    const r = await w.v.act('naglfar', 'journal_direct', { conteneur: 'web', n: 100_000 });
    assert.equal(r.ok, true, r.text);
    const j = r.data as { lignes: Array<{ at: string; texte: string; flux: string; coupee?: boolean }>; borne: number };
    assert.equal(j.lignes.length, JOURNAL_MAX, 'jamais plus de 400 lignes, même si on en demande 100 000');
    assert.ok(w.f.logsTail.every((n) => n <= JOURNAL_MAX), 'le moteur n\'est jamais appelé pour plus de 400 lignes');
    assert.equal(j.lignes.at(-1)!.texte, 'ligne 4999', 'les dernières');
    const longue = j.lignes.find((x) => x.coupee)!; assert.equal(longue.texte.length, LIGNE_MAX);
    const s = j.lignes.find((x) => x.texte.startsWith('connexion'))!;
    assert.equal(s.texte, 'connexion avec le jeton •••••• et rouge', 'secret masqué, couleurs du terminal retirées');
    assert.doesNotMatch(r.text, new RegExp(SECRET));
    assert.ok(j.lignes.some((x) => x.flux === 'erreur'));
    // « depuis » : seulement les lignes nouvelles (le direct).
    const n = await w.v.act('naglfar', 'journal_direct', { conteneur: 'web', depuis: l[4997].at });
    assert.deepEqual((n.data as { lignes: Array<{ texte: string }> }).lignes.map((x) => x.texte), ['ligne 4998', 'ligne 4999']);
    // Le masque, aussi pour ce qui ressemble à un secret sans être une variable connue.
    assert.equal(masquer('login password=abc123 ok; Authorization: Bearer abcdefghijkl; https://moi:motdepasse@example.org/x'), 'login password=•••••• ok; Authorization: Bearer ••••••; https://moi:••••••@example.org/x');
  } finally { w.fin(); }
});

test('supprimer : données gardées par défaut ; effacées seulement avec le nom tapé à l\'identique ; jamais un dossier partagé', async () => {
  const d = neuf('arche-k1-supp-'), a = join(d, 'apps', 'web', 'donnees'), b = join(d, 'apps', 'wiki', 'pages'), commun = join(d, 'apps', 'commun');
  for (const x of [a, b, commun]) { mkdirSync(x, { recursive: true }); writeFileSync(join(x, 'f.txt'), 'à garder'); }
  const w = monde([ctr('web', { mounts: [{ host: a, inner: '/donnees', ro: false }] }), ctr('wiki', { mounts: [{ host: b, inner: '/pages', ro: false }, { host: commun, inner: '/c', ro: false }] }), ctr('voisin', { mounts: [{ host: commun, inner: '/c', ro: true }] })]);
  try {
    assert.equal(w.v.action('naglfar', 'supprimer_fiche')?.a.params?.find((p) => p.key === 'donnees')?.default, 'garder', 'garder par défaut');
    // Par défaut : le conteneur part, ses données restent.
    const r1 = await w.v.act('naglfar', 'supprimer_fiche', { conteneur: 'web' });
    assert.equal(r1.ok, true, r1.text); assert.match(r1.text, /web supprimé/); assert.match(r1.text, /Données gardées : .*donnees/);
    assert.ok(existsSync(join(a, 'f.txt')), 'données gardées');
    // « Effacer » avec un nom faux (ou vide) : rien n'est supprimé, ni le conteneur ni ses données.
    for (const nom_tape of ['', 'Wiki', 'wik', ' wiki2']) {
      const r = await w.v.act('naglfar', 'supprimer_fiche', { conteneur: 'wiki', donnees: 'effacer', nom_tape });
      assert.equal(r.ok, false, nom_tape); assert.match(r.text, /écris son nom exact .*rien n'a été supprimé/);
    }
    assert.deepEqual(w.f.gestes, ['rm web'], 'le conteneur wiki est toujours là');
    assert.ok(existsSync(join(b, 'f.txt')));
    // Le nom exact : ses données partent, sauf le dossier qu'un autre conteneur lit aussi.
    const r2 = await w.v.act('naglfar', 'supprimer_fiche', { conteneur: 'wiki', donnees: 'effacer', nom_tape: 'wiki' });
    assert.equal(r2.ok, true, r2.text); assert.match(r2.text, /Données effacées : .*pages/); assert.match(r2.text, /Données gardées : .*commun \(aussi utilisé par voisin\)/);
    assert.equal(existsSync(b), false, 'ses données effacées');
    assert.ok(existsSync(join(commun, 'f.txt')), 'le dossier partagé reste');
    // Qui a fait quoi : les trois essais et les deux suppressions, au nom du propriétaire.
    const j = await w.v.act('naglfar', 'qui_a_fait');
    assert.match(j.text, /propriétaire · Supprimer un conteneur \(garde-fou\) \(conteneur : wiki · donnees : effacer · nom_tape : wiki\) · fait/);
    assert.match(j.text, /propriétaire · Supprimer un conteneur \(garde-fou\) .*pas fait : Pour effacer ses données/);
  } finally { w.fin(); }
});

test('terminal : une commande à la fois, après confirmation, jamais interactive, sortie masquée et bornée', async () => {
  const w = monde([ctr('web', { env: { MOT_DE_PASSE: SECRET } }), ctr('dort', { etat: 'arrêté' })]);
  try {
    const a = w.v.action('naglfar', 'terminal')!.a;
    assert.match(a.grave!({ conteneur: 'web', commande: 'ls -la' })!, /lancer « ls -la » dans web .*ne se défait pas/, 'la confirmation dit ce qui se passe');
    const r = await w.v.act('naglfar', 'terminal', { conteneur: 'web', commande: 'ls -la /' });
    assert.equal(r.ok, true, r.text); assert.match(r.text, /sortie de ls -la \/ · MOT_DE_PASSE=••••••/); assert.doesNotMatch(r.text, new RegExp(SECRET));
    assert.deepEqual(w.f.execs, [['ls', '-la', '/']]);
    for (const c of ['vi /etc/hosts', 'bash', 'top', 'python3', 'tail -f /var/log/x', 'sudo ls']) assert.match((await w.v.act('naglfar', 'terminal', { conteneur: 'web', commande: c })).text, /attend qu'on tape dedans/, c);
    for (const c of ['sh -c "ls"', 'python3 -c "print(1)"', 'bash script.sh', 'cat /etc/os-release', 'node --version']) assert.equal(attendQuOnTape(c.split(' ')), false, c);
    assert.match((await w.v.act('naglfar', 'terminal', { conteneur: 'dort', commande: 'ls' })).text, /dort est arrêté/);
    assert.match((await w.v.act('naglfar', 'terminal', { conteneur: 'web', commande: 'x'.repeat(501) })).text, /trop longue/);
    // Une seule à la fois : la deuxième est refusée tant que la première tourne.
    const p1 = w.v.act('naglfar', 'terminal', { conteneur: 'web', commande: 'lent' });
    await new Promise((ok) => setTimeout(ok, 150));
    assert.match((await w.v.act('naglfar', 'terminal', { conteneur: 'web', commande: 'ls' })).text, /tourne déjà dans web .*une seule à la fois/);
    assert.equal((await p1).ok, true);
  } finally { w.fin(); }
});

test('propriétaire seul : membre, automatisation, clé d\'API et tablette refusés pour tout ce qui agit ; rien n\'est touché', async () => {
  const d = neuf('arche-k1-refus-'), donnees = join(d, 'apps', 'web', 'donnees'); mkdirSync(donnees, { recursive: true });
  const w = monde([ctr('web', { mounts: [{ host: donnees, inner: '/d', ro: false }] })]);
  setValhalla(w.v); resetGladsheim();
  const srv = serveurHttp((req, res) => { void maisonRoute(req, res, new URL(req.url!, 'http://x'), { authed: false, name: '', mascot: '<svg></svg>', fail: () => {}, ask: async () => '' }).then((fait) => { if (!fait) { res.writeHead(404); res.end(); } }); });
  try {
    const gestes: Array<[string, Record<string, unknown>]> = [['geste_fiche', { conteneur: 'web', geste: 'arreter' }], ['geste_fiche', { conteneur: 'web', geste: 'redemarrer' }], ['ressources', { conteneur: 'web', memoire: '1g' }], ['terminal', { conteneur: 'web', commande: 'ls' }], ['supprimer_fiche', { conteneur: 'web', donnees: 'effacer', nom_tape: 'web' }]];
    for (const [id] of gestes) assert.equal(w.v.action('naglfar', id)?.a.proprietaireSeul, true, id);
    for (const id of ['tableau', 'fiche', 'journal_direct']) { const a = w.v.action('naglfar', id)!.a; assert.equal(a.proprietaireSeul, undefined, `${id} : ouverte`); assert.equal(a.grave, undefined, `${id} : rien de grave`); }
    const refus = /seul le propriétaire/;
    for (const [id, input] of gestes) {
      assert.match((await w.v.act('naglfar', id, input, { qui: 'member' })).text, refus, `${id} : un membre`);
      assert.match((await w.v.act('naglfar', id, input, { auto: true, by: 'automatisation' })).text, refus, `${id} : une automatisation`);
      const cle = await valhallaPost('/api/valhalla/act', { module: 'naglfar', action: id, input, confirm: true }) as { ok: boolean; text: string };
      assert.equal(cle.ok, false, `${id} : la clé d'API`); assert.match(cle.text, /pas avec la clé d'API/);
      assert.notEqual((await w.v.act('gladsheim', 'bouton', { appli: 'naglfar', action: id, reglages: Object.entries(input).map(([k, v]) => `${k}=${String(v)}`).join('\n'), nom: id })).ok, false);
    }
    const tab = { 'x-odin-maison': ((await w.v.act('gladsheim', 'cle_tablette', { nom: 'Tablette', droits: 'maison' })).data as { key: string }).key, 'x-odin': '1', 'content-type': 'application/json' };
    await new Promise<void>((ok) => srv.listen(0, '127.0.0.1', () => ok()));
    const base = `http://127.0.0.1:${(srv.address() as { port: number }).port}`;
    const tuiles = (w.v.ctx('gladsheim').settings.tiles as Array<{ id: string; module: string; action: string }>).filter((t) => t.module === 'naglfar');
    assert.equal(tuiles.length, gestes.length);
    for (const t of tuiles) {
      const r = await (await fetch(`${base}/api/maison/bouton`, { method: 'POST', headers: tab, body: JSON.stringify({ id: t.id, confirm: true }) })).json() as { ok: boolean; text: string };
      assert.equal(r.ok, false, `tablette : ${t.action}`);
    }
    assert.deepEqual(w.f.gestes, [], 'aucun refusé n\'a touché un conteneur'); assert.deepEqual(w.f.execs, [], 'aucune commande lancée');
    assert.ok(existsSync(donnees), 'données intactes');
    // Les lectures restent ouvertes (le journal masque les secrets) ; « qui a fait quoi » est au propriétaire seul.
    assert.equal((await w.v.act('naglfar', 'tableau', {}, { qui: 'member' })).ok, true);
    assert.match((await w.v.act('naglfar', 'qui_a_fait', {}, { qui: 'member' })).text, refus);
  } finally { srv.close(); setValhalla(undefined); w.fin(); }
});

test('Windows (aucun moteur aujourd\'hui) : le tableau le dit avec ce qui viendra ; les gestes refusent ; le moteur n\'est pas touché', async () => {
  const touche: string[] = [];
  useEngine(() => new Proxy({}, { get: (_t, k) => { touche.push(String(k)); throw new Error('le moteur ne doit pas être appelé'); } }) as EngineLike);
  const home = neuf('arche-k1-win-');
  Object.assign(systemeArche, { plateforme: () => 'win32', dossierMoteur: () => home });
  const v = new Valhalla(home, allModules({ paths: { home, workspace: home }, cfg: DEFAULT_CONFIG } as never), { run: async () => ({ code: 1, out: '', err: '' }), fetch: (async () => { throw new Error('hors ligne'); }) as never, notify: async () => {} });
  try {
    const r = await v.act('naglfar', 'tableau');
    assert.equal(r.ok, true, r.text);
    const t = r.data as Tab;
    assert.equal(t.moteur, false); assert.deepEqual(t.conteneurs, []);
    assert.match(t.raison!, /ne marche que sous Linux/); assert.match(t.avenir!, /sous-système Linux livré avec Windows \(WSL2\)/);
    assert.doesNotMatch(`${t.raison} ${t.avenir}`, /docker|podman|portainer/i, 'aucun nom de produit');
    for (const [id, input] of [['fiche', { conteneur: 'web' }], ['journal_direct', { conteneur: 'web' }], ['geste_fiche', { conteneur: 'web', geste: 'demarrer' }], ['terminal', { conteneur: 'web', commande: 'ls' }], ['supprimer_fiche', { conteneur: 'web' }], ['ressources', { conteneur: 'web', memoire: '1g' }]] as const) {
      const x = await v.act('naglfar', id, input);
      assert.equal(x.ok, false, id); assert.match(x.text, /ne marche que sous Linux.*WSL2/, id);
    }
    assert.deepEqual(touche, [], 'le moteur n\'a pas été appelé');
  } finally { v.stop(); }
});

test('le nom repris (23/11) : « Arche » mène aux conteneurs, « Amphore » à la sauvegarde des bases ; fiches du Cerveau déplacées sans perte', () => {
  assert.equal(NAMES.naglfar, 'Arche'); assert.equal(NAMES.skuld, 'Amphore');
  const home = neuf('arche-k1-noms-');
  const v = new Valhalla(home, allModules({ paths: { home, workspace: home }, cfg: DEFAULT_CONFIG } as never), { run: async () => ({ code: 1, out: '', err: '' }), fetch: (async () => { throw new Error('hors ligne'); }) as never, notify: async () => {} });
  try {
    const mods = v.modules();
    assert.equal(mods.find((m) => m.id === 'naglfar')?.name, 'Arche'); assert.equal(mods.find((m) => m.id === 'skuld')?.name, 'Amphore');
    assert.equal(findApp(mods, 'Arche').id, 'naglfar'); assert.equal(findApp(mods, 'arche').id, 'naglfar'); assert.equal(findApp(mods, 'Amphore').id, 'skuld');
    assert.equal(appliDeNom('la base Amphore'), 'skuld'); assert.equal(appliDeNom('Arche'), 'naglfar');
    assert.deepEqual([nomBase('naglfar'), nomBase('skuld')], ['ARCHE_ODIN', 'AMPHORE_ODIN']);
    // Un Cerveau d'avant : la fiche « Arche » est celle de la sauvegarde des bases, « Argo » celle des conteneurs, chacune avec tes notes.
    const vault = new Vault(join(home, 'cerveau'));
    vault.write('Odin/Applis/Arche', { type: 'fiche', tags: ['odin', 'appli', 'données'], 'tenue par': 'Odin' }, '# Arche\n\n## Mes notes\n\nma note sur les sauvegardes\n');
    vault.write('Odin/Applis/Argo', { type: 'fiche', tags: ['odin', 'appli', 'machines'], 'tenue par': 'Odin' }, '# Argo\n\n## Mes notes\n\nma note sur les conteneurs\n');
    vault.write('Projets/Serveur', { type: 'note' }, 'Les bases : [[Arche]]. Les applis : [[Argo]].');
    syncSheets(vault, mods);
    assert.match(vault.read('Odin/Applis/Amphore')!.body, /ma note sur les sauvegardes/);
    assert.match(vault.read('Odin/Applis/Arche')!.body, /ma note sur les conteneurs/);
    assert.match(vault.read('Odin/Applis/Arche')!.body, /^# Arche/m);
    assert.equal(vault.read('Odin/Applis/Argo'), undefined);
    assert.equal(vault.read('Projets/Serveur')!.body.trim(), 'Les bases : [[Amphore]]. Les applis : [[Arche]].');
    // Refaire ne change rien.
    syncSheets(vault, mods);
    assert.match(vault.read('Odin/Applis/Amphore')!.body, /ma note sur les sauvegardes/); assert.match(vault.read('Odin/Applis/Arche')!.body, /ma note sur les conteneurs/);
  } finally { v.stop(); }
});
