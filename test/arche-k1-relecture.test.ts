// Arche, lot K1 — relecture adverse (23/11) : ce qui pouvait encore mal tourner, prouvé sans aucun vrai conteneur.
// - supprimer avec ses données : jamais un dossier système (/etc, /usr, /var…), jamais un dossier à toi même rangé plus
//   bas (Documents/…, Images/…), jamais à travers un lien ou une jonction Windows posée plus haut dans le chemin, majuscules
//   comprises ; ce qui est effacé est le dossier vérifié (le vrai chemin), pas un autre ;
// - le terminal : une commande qui ne finit pas (ou qui laisse un programme derrière elle) est arrêtée au bout du délai,
//   l'action rend la main, et la suivante peut partir.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Valhalla } from '../src/valhalla/service.ts';
import { allModules } from '../src/valhalla/odin.ts';
import { DEFAULT_CONFIG } from '../src/config.ts';
import { donneesDe, LIGNE_MAX, masquer, systemeArche, TERMINAL, useEngine, type EngineLike } from '../src/valhalla/modules/naglfar.ts';
import type { Ctr } from '../src/valhalla/hringhorni/engine.ts';

const dossiers: string[] = [];
const neuf = (p: string) => { const d = mkdtempSync(join(tmpdir(), p)); dossiers.push(d); return d; };
const origine = { ...systemeArche }, delai = TERMINAL.delaiMs;
after(() => { Object.assign(systemeArche, origine); TERMINAL.delaiMs = delai; for (const d of dossiers) rmSync(d, { recursive: true, force: true }); });

function ctr(nom: string, mounts: Ctr['spec']['mounts'] = []): Ctr {
  const id = `${nom.replace(/[^a-f0-9]/g, 'a').padEnd(12, 'b')}${'c'.repeat(52)}`.slice(0, 64);
  return { id, spec: { id, name: nom, image: 'registre.example.org/x:1', imageId: 'sha256:img', cmd: [], env: {}, workdir: '/', user: '', ports: [], mounts, restart: 'non', cpus: '1', hostname: nom, network: 'pont', autoRemove: false, created: '2026-11-20T10:00:00.000Z', labels: {} }, state: { status: 'en marche', startedAt: '2026-11-23T08:00:00.000Z' } };
}
function monde(cts: Ctr[], execArgs?: EngineLike['execArgs']) {
  const home = neuf('arche-rel-home-'), moteurDir = neuf('arche-rel-moteur-'), maison = neuf('arche-rel-maison-');
  const gestes: string[] = [];
  const find = (n: string) => { const c = cts.find((x) => x.spec.name === n); if (!c) throw new Error(`conteneur inconnu : ${n}`); return c; };
  const non = () => { throw new Error('essai : pas ce geste'); };
  useEngine(() => ({ ps: () => cts, find, rm: async (n: string) => { const c = find(n); gestes.push(`rm ${n}`); cts.splice(cts.indexOf(c), 1); return c.spec; }, execArgs: execArgs ?? non, logs: () => [], images: () => [], jobs: () => [], start: non, stop: non, restart: non, run: non, pull: non, rmi: non, runJob: non, pullJob: non, startJob: non, inspect: non, findImage: () => undefined, resize: non } as unknown as EngineLike));
  Object.assign(systemeArche, { plateforme: () => 'linux', coeurs: () => 4, dossierMoteur: () => moteurDir, maison: () => maison, disque: () => undefined, stat: () => undefined });
  const v = new Valhalla(home, allModules({ paths: { home, workspace: home }, cfg: DEFAULT_CONFIG } as never), { run: async () => ({ code: 1, out: '', err: '' }), fetch: (async () => { throw new Error('hors ligne'); }) as never, notify: async () => {}, autonomy: () => 'equilibre' });
  return { v, home, maison, gestes, fin: () => v.stop() };
}

test('supprimer : jamais un dossier système, ni un dossier à toi rangé plus bas, ni à travers un lien ou une jonction posés plus haut', async () => {
  const d = neuf('arche-rel-supp-'), w0 = monde([]);
  try {
    // Le « dossier personnel » de l'essai (systemeArche.maison) : Documents/notes, Images/vacances, et un dossier libre.
    const notes = join(w0.maison, 'Documents', 'notes'), vacances = join(w0.maison, 'Images', 'vacances', 'juillet'), libre = join(w0.maison, 'conteneurs', 'web', 'donnees');
    for (const x of [notes, vacances, libre]) { mkdirSync(x, { recursive: true }); writeFileSync(join(x, 'f.txt'), 'à garder'); }
    // Une jonction (Windows) ou un lien (Linux) posé PLUS HAUT dans le chemin, qui mène dans Documents.
    const apps = join(d, 'apps'); mkdirSync(apps, { recursive: true });
    symlinkSync(join(w0.maison, 'Documents'), join(apps, 'passage'), 'junction');
    const parLeLien = join(apps, 'passage', 'notes');
    const cts = [ctr('web', [
      { host: '/etc/nginx/conf.d', inner: '/etc/nginx/conf.d', ro: false },
      { host: '/var/lib/postgresql/data', inner: '/var/lib/postgresql/data', ro: false },
      { host: '/usr/share/nginx/html', inner: '/usr/share/nginx/html', ro: false },
      { host: notes, inner: '/notes', ro: false },
      { host: vacances, inner: '/photos', ro: false },
      { host: parLeLien, inner: '/l', ro: false },
      { host: libre, inner: '/donnees', ro: false },
    ])];
    const par = Object.fromEntries(donneesDe(cts[0], cts, w0.home).map((x) => [x.dossier, x]));
    for (const s of ['/etc/nginx/conf.d', '/var/lib/postgresql/data', '/usr/share/nginx/html']) { assert.equal(par[s].effacable, false, s); assert.match(par[s].raison!, /système/, s); }
    for (const s of [notes, vacances]) { assert.equal(par[s].effacable, false, s); assert.match(par[s].raison!, /personnel|à toi/, s); }
    assert.equal(par[parLeLien].effacable, false, 'à travers une jonction posée plus haut'); assert.match(par[parLeLien].raison!, /personnel|à toi|lien/);
    assert.equal(par[libre].effacable, true, 'un dossier à lui, rangé à part, peut partir');
    // Majuscules : le même dossier d'Odin écrit autrement n'est pas effaçable sur un système qui ne distingue pas la casse.
    if (process.platform === 'win32') {
      const odinData = join(w0.home, 'valhalla', 'donnees'); mkdirSync(odinData, { recursive: true });
      const c2 = ctr('casse', [{ host: odinData.toUpperCase(), inner: '/o', ro: false }]);
      const x = donneesDe(c2, [c2], w0.home)[0]; assert.equal(x.effacable, false); assert.match(x.raison!, /Odin/);
    }
    // Et pour de vrai : « effacer » avec le nom tapé n'efface que le dossier libre.
    const w = monde(cts); Object.assign(systemeArche, { maison: () => w0.maison });
    try {
      const r = await w.v.act('naglfar', 'supprimer_fiche', { conteneur: 'web', donnees: 'effacer', nom_tape: 'web' });
      assert.equal(r.ok, true, r.text);
      assert.equal(existsSync(libre), false, 'ses données effacées');
      for (const x of [notes, vacances]) assert.equal(readFileSync(join(x, 'f.txt'), 'utf8'), 'à garder', x);
    } finally { w.fin(); }
  } finally { w0.fin(); }
});

test('terminal : une commande qui ne finit pas (et garde la sortie ouverte par un programme laissé derrière) est arrêtée, l\'action rend la main, la suivante part', async () => {
  const d = neuf('arche-rel-term-'), pidFichier = join(d, 'pid');
  // Comme l'outil qui entre dans le conteneur : il lance un programme qui ne finit jamais et qui garde la sortie ouverte.
  const sansFin = `const c=require('child_process').spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:['ignore','inherit','inherit']});require('fs').writeFileSync(${JSON.stringify(pidFichier)},String(c.pid));setInterval(()=>{},1000);`;
  const w = monde([ctr('web')], async (_n: string, argv: string[]) => ({ cmd: process.execPath, args: ['-e', argv[0] === 'ls' ? 'process.stdout.write("fini")' : sansFin], env: {} }));
  TERMINAL.delaiMs = 600;
  try {
    const t0 = Date.now();
    const r = await Promise.race([w.v.act('naglfar', 'terminal', { conteneur: 'web', commande: 'sleep infinity' }), new Promise<{ ok: boolean; text: string }>((ok) => setTimeout(() => ok({ ok: false, text: 'BLOQUÉE' }), 8000))]);
    assert.notEqual(r.text, 'BLOQUÉE', 'l\'action doit rendre la main');
    assert.match(r.text, /arrêtée au bout de/); assert.ok(Date.now() - t0 < 6000);
    const r2 = await w.v.act('naglfar', 'terminal', { conteneur: 'web', commande: 'ls' });
    assert.equal(r2.ok, true, r2.text); assert.match(r2.text, /fini/);
  } finally {
    try { process.kill(Number(readFileSync(pidFichier, 'utf8')), 'SIGKILL'); } catch { /* déjà parti */ }
    w.fin();
  }
});

test('journal : un secret coupé par la borne des 2 000 caractères n\'en laisse aucun bout ; « "password": "…" » (JSON) est masqué', async () => {
  const secret = 'Zq9-unSecretTresLong-7Hk2Pw', c = ctr('web');
  c.spec.env = { API_TOKEN: secret };
  const journal = [
    { at: '2026-11-23T10:00:00.000Z', stream: 'o' as const, text: `${'x'.repeat(LIGNE_MAX - 10)}${secret} fin` },
    { at: '2026-11-23T10:00:01.000Z', stream: 'o' as const, text: '{"user":"moi","password":"hunter2-tres-secret","db_pass": "autre-secret"}' },
  ];
  const w = monde([c]);
  useEngine(() => ({ ps: () => [c], find: () => c, logs: () => journal } as unknown as EngineLike));
  try {
    const r = await w.v.act('naglfar', 'journal_direct', { conteneur: 'web' });
    assert.equal(r.ok, true, r.text);
    const l = (r.data as { lignes: Array<{ texte: string }> }).lignes;
    assert.ok(l[0].texte.length <= LIGNE_MAX);
    assert.doesNotMatch(l[0].texte, new RegExp(secret.slice(0, 6)), 'aucun bout du secret');
    assert.doesNotMatch(l[1].texte, /hunter2|autre-secret/);
    assert.match(masquer('{"password":"abc123xyz"}'), /"password":"••••••"|"password":••••••/);
  } finally { w.fin(); }
});

test('terminal : une commande plus longue que la confirmation le dit (rien de caché sans le savoir)', () => {
  const w = monde([ctr('web')]);
  try {
    const g = w.v.action('naglfar', 'terminal')!.a.grave!;
    assert.match(g({ conteneur: 'web', commande: 'ls -la' })!, /^lancer « ls -la » dans web/);
    const longue = `ls ${'a'.repeat(200)} ; rm -rf /donnees`;
    assert.match(g({ conteneur: 'web', commande: longue })!, /… » \(\d+ caractères de plus, pas montrés ici\) dans web/);
  } finally { w.fin(); }
});
