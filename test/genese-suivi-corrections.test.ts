// Genèse · le suivi des installations par le réseau (PXE), deuxième série : ce que la relecture a trouvé, corrigé.
//   - Qui parle ? Un jeton d'installation ne vaut que depuis l'adresse du poste ; l'écran d'Odin ne le montre jamais.
//   - Mot de passe : force brute lente bloquée et signalée, 10 caractères, blocages qui s'allongent.
//   - Poste bloqué, poste sans adresse MAC, « postes non autorisés seulement », annulation, inondation de fausses adresses.
//   - Déroulement : poste qui recommence, Odin arrêté longtemps, « fini » tardif, première étape notée, boucle.
//   - Notifications regroupées ; phrases et réglages qui ne changent rien sans qu'on le demande.
// Les faux postes parlent depuis plusieurs adresses (127.0.0.1, 127.0.0.2…) : le vrai poste et celui qui triche.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { Valhalla } from '../src/valhalla/service.ts';
import { allModules } from '../src/valhalla/odin.ts';
import { DEFAULT_CONFIG } from '../src/config.ts';
import { COUT, Essais, RALENTI, VERROU_MS, VERROUS_MS, refusMotDePasse } from '../src/valhalla/thjalfi/cle.ts';
import { LOT_MS, Lots } from '../src/valhalla/thjalfi/lots.ts';
import { DEF_JOURNAUX } from '../src/valhalla/base/journal.ts';
import type { Ligne } from '../src/valhalla/thjalfi/suivi.ts';
import type { AlertIn } from '../src/valhalla/types.ts';

COUT.N = 1024; // empreintes rapides pour les essais (65536 en vrai)
RALENTI.ms = 0; // pas d'attente réelle entre deux essais de mot de passe (3 s en vrai)
const FIX = join(import.meta.dirname, 'fixtures', 'thjalfi');
const U = 'ubuntu-24-04-3-live-server-amd64', R = 'rocky-9-6-x86-64-minimal';
const MIN = 60_000, MDP = 'Maison2026!';
/** Le vrai poste, celui qui triche, un troisième. */
const V = '127.0.0.1', P = '127.0.0.2', AUTRE = '127.0.0.3';
const pause = (ms = 80) => new Promise((r) => setTimeout(r, ms));
const ouvert = (t: string) => /item e-ubuntu/.test(t) && /kernel \$\{base\}\/f\//.test(t);
const ferme = (t: string) => /item cle Installer un systeme/.test(t);
const noyau = (mac: string, iso = U) => `/f/${iso}/${iso === U ? 'casper/vmlinuz' : 'images/pxeboot/vmlinuz'}?m=${mac}`;
const INITRD = `/f/${U}/casper/initrd`;

interface Rep { status: number; text: string }
interface Alerte { title: string; level: string; detail?: string; count: number }
interface W {
  v: () => Valhalla; dir: string; messages: string[];
  /** une demande HTTP depuis l'adresse donnée */
  get: (ip: string, p: string, h?: Record<string, string>) => Promise<Rep>;
  cle: (ip: string, mac: string, mdp: string, qui?: string) => Promise<Rep>;
  avance: (ms: number) => void; maintenant: () => number;
  veille: () => Promise<void>;
  act: (action: string, input?: Record<string, unknown>, o?: { auto?: boolean }) => Promise<{ ok?: boolean; text: string; data?: unknown }>;
  alertes: (re?: RegExp) => Alerte[];
  /** Odin s'arrête (pendant `arret` ms) puis redémarre sur les mêmes fichiers */
  relance: (arret?: number) => Promise<void>;
  end: () => void;
}
async function monde(): Promise<W> {
  const home = mkdtempSync(join(tmpdir(), 'genese-corr-')), messages: string[] = [];
  let T = Date.parse('2026-11-15T08:00:00Z');
  const avant = process.env.BRISINGAMEN_KEY; process.env.BRISINGAMEN_KEY = 'cd'.repeat(32);
  const creer = () => new Valhalla(home, allModules({ paths: { home, workspace: home }, cfg: DEFAULT_CONFIG } as never), { run: async () => ({ code: 1, out: '', err: '' }), fetch: (async () => { throw new Error('réseau coupé'); }) as never, notify: async (t: string) => { messages.push(t); }, autonomy: () => 'equilibre', now: () => new Date(T) } as never);
  let v = creer();
  const iso = join(home, 'iso'); mkdirSync(iso, { recursive: true });
  for (const f of readdirSync(FIX)) writeFileSync(join(iso, f.replace(/\.gz$/, '')), gunzipSync(readFileSync(join(FIX, f))));
  await v.act('eitri', 'dossier', { chemin: iso });
  const dir = join(home, 'valhalla', 'thjalfi'), boot = join(dir, 'boot'); mkdirSync(boot, { recursive: true }); writeFileSync(join(boot, 'undionly.kpxe'), 'KPXE'); writeFileSync(join(boot, 'ipxe.efi'), 'EFI');
  v.ctx('thjalfi').saveSettings({ ports: { http: 0, tftp: 0, dhcp: 0, pxe: 0, client: 0 }, ip: '127.0.0.1', mode: 'aucun' });
  const allumer = async () => Number(/http:\/\/127\.0\.0\.1:(\d+)/.exec((await v.act('thjalfi', 'allumer')).text)![1]);
  let port = await allumer();
  const demande = (ip: string, path: string, o: { method?: string; body?: string; headers?: Record<string, string> } = {}) => new Promise<Rep>((ok, ko) => {
    const r = request({ host: '127.0.0.1', port, path, method: o.method ?? 'GET', localAddress: ip, agent: false, headers: { ...(o.body !== undefined ? { 'content-type': 'application/x-www-form-urlencoded', 'content-length': String(Buffer.byteLength(o.body)) } : {}), ...(o.headers ?? {}) } }, (x) => {
      const parts: Buffer[] = []; x.on('data', (c: Buffer) => parts.push(c)); x.on('end', () => ok({ status: x.statusCode ?? 0, text: Buffer.concat(parts).toString('utf8') }));
    });
    r.on('error', ko); r.end(o.body);
  });
  return {
    v: () => v, dir, messages,
    get: (ip, p, h = {}) => demande(ip, p, { headers: h }),
    cle: (ip, mac, mdp, qui = '') => demande(ip, `/cle.ipxe?mac=${mac}&fw=efi`, { method: 'POST', body: new URLSearchParams({ mdp, qui }).toString() }),
    avance: (ms) => { T += ms; }, maintenant: () => T,
    veille: async () => { await v.modules().find((m) => m.id === 'thjalfi')!.watch!.run(v.ctx('thjalfi')); },
    act: (action, input = {}, o = {}) => v.act('thjalfi', action, input, o),
    alertes: (re) => (v.alerts({ module: 'thjalfi', limit: 500 }) as unknown as Alerte[]).filter((a) => !re || re.test(a.title)),
    relance: async (arret = 0) => { v.stop(); T += arret; v = creer(); port = await allumer(); },
    end: () => { v.stop(); if (avant === undefined) delete process.env.BRISINGAMEN_KEY; else process.env.BRISINGAMEN_KEY = avant; rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); },
  };
}
interface Vue { mac: string; id: string; nom: string | null; ip: string; image: string; mode: string; etape: string; etat: string; enCours: boolean; raison: string; etapes: Array<{ at: number; etape: string; detail: string }> }
const poste = async (w: W, mac: string) => ((await w.act('poste', { mac })).data as { poste: Vue | null }).poste;
const rapport = async (w: W) => (await w.act('rapport', { periode: 'tout' })).data as { total: number; reussies: number; echecs: number; abandons: number; lignes: Ligne[]; evenements: Array<{ quoi: string; mac?: string; detail?: string }> };
/** Un poste autorisé en installation automatique demande le menu depuis `ip` : rend le jeton de son installation. */
async function autorise(w: W, mac: string, nom: string, iso = 'ubuntu', ip = V): Promise<string> {
  const r = await w.act('autoriser', { mac, iso, nom, auto: true }); assert.notEqual(r.ok, false, r.text);
  const jeton = /seed\/([\w-]+)\//.exec((await w.get(ip, `/menu.ipxe?mac=${mac}&fw=efi`)).text)?.[1];
  assert.ok(jeton, `menu avec installation automatique pour ${mac}`); return jeton!;
}

// ---------------- Les fonctions pures ----------------
test('essais de mot de passe : le compte ne retombe qu\'après un vrai calme, le blocage s\'allonge ; 10 caractères, pas de mot de passe courant', () => {
  const es = new Essais(); for (let i = 0; i < 4; i++) es.rate('k', 0);
  assert.equal(es.rate('k', 14 * MIN).verrou, 14 * MIN + VERROU_MS, 'la 5e erreur compte même 14 min après la 1re (pas de remise à zéro à heure fixe)');
  let t = 14 * MIN + VERROU_MS + 1000, r: { n: number; verrou?: number } = { n: 0 };
  for (let i = 0; i < 5; i++) r = es.rate('k', t); assert.equal(r.verrou, t + VERROUS_MS[1], 'deuxième blocage : 1 h');
  t += VERROUS_MS[1] + 1000; for (let i = 0; i < 5; i++) r = es.rate('k', t); assert.equal(r.verrou, t + VERROUS_MS[2], 'troisième : 24 h');
  // Par adresse IP : 19 erreurs, un quart d'heure d'attente, et la 20e bloque quand même.
  const ip = new Essais(); for (let i = 0; i < 19; i++) ip.rate('i', 0, 20, 3600_000);
  assert.equal(ip.rate('i', 16 * MIN, 20, 3600_000).verrou, 16 * MIN + VERROU_MS);
  assert.match(refusMotDePasse('azerty1') ?? '', /trop court \(10 caractères au moins\)/); assert.equal(refusMotDePasse(MDP), undefined);
  for (const courant of ['azertyuiop', '1234567890', 'aaaaaaaaaaaa', 'MotDePasse123', 'Password123', 'abcabcabcabc', 'admin2026!!']) assert.match(refusMotDePasse(courant) ?? '', /trop courant/, courant);
});

test('notifications regroupées : la première part tout de suite, les suivantes du même genre en une seule', () => {
  const envoyees: AlertIn[] = [], l = new Lots((a) => envoyees.push(a));
  const a = (n: number, level: AlertIn['level'] = 'haute'): AlertIn => ({ level, title: `❌ Installation ratée sur pc-${n}`, detail: `raison ${n}`, key: `k${n}` });
  l.dire('échec', 'pc-1', a(1), 0); assert.equal(envoyees.length, 1, 'la première tout de suite');
  l.dire('échec', 'pc-2', a(2, 'critique'), 1000); l.dire('échec', 'pc-3', a(3), 2000); assert.equal(envoyees.length, 1, 'les suivantes attendent');
  l.dire('échec', 'pc-1', a(1), 3000); assert.equal(envoyees.length, 2, 'la même encore (poste en boucle) : laissée à Odin, qui la compte');
  l.dire('début', 'pc-9', { level: 'info', title: '▶ pc-9 démarre' }, 3000); assert.equal(envoyees.length, 3, 'un autre genre ne se mélange pas');
  l.vider(10_000); assert.equal(envoyees.length, 3, 'pas encore 30 s sans rien');
  l.vider(2000 + LOT_MS);
  assert.equal(envoyees.length, 4); assert.equal(envoyees[3].title, '❌ 2 autres installations ratées : pc-2, pc-3'); assert.equal(envoyees[3].level, 'critique', 'le niveau le plus fort du lot'); assert.match(envoyees[3].detail ?? '', /pc-2 : raison 2\npc-3 : raison 3/);
  l.fermer();
});

test('base : une vue ne garde qu\'une ligne par installation (la dernière), lisible par Odin, sans adresse IP', () => {
  const m = DEF_JOURNAUX.migrations.find((x) => x.v === 3); assert.ok(m, 'migration v3');
  assert.match(m!.sql, /CREATE VIEW v_installations AS SELECT DISTINCT ON \(COALESCE\(donnees->>'id', uid\)\)/); assert.match(m!.sql, /WHERE journal = 'thjalfi' ORDER BY COALESCE\(donnees->>'id', uid\), n DESC/);
  assert.match(m!.sql, /GRANT SELECT ON v_installations TO odin_lecture/); assert.doesNotMatch(m!.sql, /'ip'/);
  assert.deepEqual(DEF_JOURNAUX.migrations.map((x) => x.v), [1, 2, 3], 'les migrations d\'avant ne changent pas');
});

// ---------------- Qui parle ? ----------------
test('jeton d\'installation : jamais montré par l\'écran d\'Odin ; refusé depuis une autre adresse que celle du poste ; il n\'ouvre aucun laissez-passer', async () => {
  const w = await monde(), A = '52:54:00:c1:00:01';
  try {
    await w.act('mot_de_passe', { mot_de_passe: MDP });
    await w.act('autoriser', { mac: A, iso: 'ubuntu', nom: 'compta', auto: true });
    assert.equal(JSON.parse((await w.get(P, `/ecran/etat?mac=${A}`)).text).machine, null, 'mot de passe pas encore donné : l\'écran ne dit rien de ce poste');
    assert.match((await w.cle(V, A, MDP, 'Awa')).text, /Mot de passe accepte/);
    const jeton = /seed\/([\w-]+)\//.exec((await w.get(V, `/menu.ipxe?mac=${A}&fw=efi`)).text)![1];
    const ecran = (await w.get(P, `/ecran/etat?mac=${A}`)).text, m = (JSON.parse(ecran) as { machine: Record<string, unknown> }).machine;
    assert.deepEqual(Object.keys(m).sort(), ['host', 'iso', 'isoName', 'step', 'updated'], 'une fiche réduite : étape, image, nom');
    assert.ok(!ecran.includes(jeton) && !ecran.includes('Awa') && !/"token"|"steps"|"serie"|"installateur"/.test(ecran), 'ni jeton, ni installateur, ni étapes');
    // Quelqu'un a lu le jeton sur le réseau : depuis son adresse, il ne vaut rien.
    assert.equal((await w.get(P, `/seed/${jeton}/user-data`)).status, 404); assert.equal((await w.get(P, `/etat/${jeton}?e=installation`)).status, 404);
    assert.ok(ferme((await w.get(P, `/menu.ipxe?mac=${A}&fw=efi`)).text), 'le jeton n\'a pas fait entrer son adresse dans le laissez-passer');
    assert.equal((await w.get(P, noyau(A))).status, 403); assert.equal((await w.get(P, INITRD)).status, 403); assert.equal((await w.get(P, `/iso/${U}.iso`, { range: 'bytes=0-9' })).status, 403);
    assert.equal(w.alertes(/Le jeton d'installation de compta est présenté depuis une autre adresse/).length, 1, 'Odin prévient'); assert.equal(w.alertes(/jeton d'installation/)[0].level, 'haute');
    // Le vrai poste, lui, continue.
    assert.equal((await w.get(V, noyau(A))).status, 200); assert.equal((await w.get(V, `/seed/${jeton}/user-data`)).status, 200); assert.equal((await w.get(V, `/etat/${jeton}?e=installation`)).text, 'ok');
    // Même quand le poste se tait longtemps : avec le mot de passe demandé, une autre adresse doit l'avoir donné elle-même.
    w.avance(5 * MIN); assert.equal((await w.get(P, `/etat/${jeton}?e=fini&nom=pirate`)).status, 404); assert.equal((await poste(w, A))?.etat, 'en cours');
  } finally { w.end(); }
});

test('retours rejoués : un tiers ne marque rien ; « fini » ne compte qu\'une fois ; le jeton meurt 10 min après la fin ; « fini » après « échec » ne réécrit pas l\'historique', async () => {
  const w = await monde(), B = '52:54:00:c2:00:01', C = '52:54:00:c2:00:02', D = '52:54:00:c2:00:03';
  try {
    const jb = await autorise(w, B, 'compta'); await w.get(V, noyau(B)); await w.get(V, `/etat/${jb}?e=installation`);
    assert.equal((await w.get(P, `/etat/${jb}?e=echec&raison=setup`)).status, 404, 'un retour venu d\'une autre adresse que le poste est refusé');
    assert.equal((await rapport(w)).total, 0); assert.equal((await poste(w, B))?.etat, 'en cours');
    w.avance(10 * MIN); assert.equal((await w.get(V, `/etat/${jb}?e=fini&nom=compta&ip=192.168.1.9`)).text, 'ok');
    for (let i = 0; i < 3; i++) assert.equal((await w.get(V, `/etat/${jb}?e=fini&nom=autre-nom&ip=10.66.66.66`)).status, 200);
    let r = await rapport(w); assert.equal(r.total, 1); assert.equal(r.lignes[0].host, 'compta'); assert.equal(r.lignes[0].ip, '192.168.1.9', 'le « fini » rejoué ne change ni le nom ni l\'adresse');
    assert.equal((w.v().ctx('thjalfi').settings.stats as Record<string, { finis: number }>)[U].finis, 1, 'compté une fois'); assert.equal(w.alertes(/compta installée/).length, 1); assert.equal(w.alertes(/compta installée/)[0].count, 1);
    assert.equal(readFileSync(join(w.dir, 'historique.jsonl'), 'utf8').trim().split('\n').length, 1, 'une seule ligne écrite');
    assert.equal((await w.get(V, `/seed/${jb}/user-data`)).status, 200, 'encore 10 min pour les scripts d\'après installation');
    w.avance(11 * MIN); assert.equal((await w.get(V, `/seed/${jb}/user-data`)).status, 404, 'puis le jeton ne sert plus'); assert.equal((await w.get(V, `/etat/${jb}?e=logiciels`)).status, 404);
    // Le poste dit « échec » (deux fois), puis un « fini » arrive : l'historique garde « échouée », et c'est signalé.
    const jc = await autorise(w, C, 'serveur-c', 'rocky'); await w.get(V, noyau(C, R)); await w.get(V, `/etat/${jc}?e=installation`);
    await w.get(V, `/etat/${jc}?e=echec&raison=kickstart`); await w.get(V, `/etat/${jc}?e=echec&raison=kickstart`);
    assert.equal(w.alertes(/Installation ratée sur serveur-c/).length, 1); assert.equal(w.alertes(/Installation ratée sur serveur-c/)[0].count, 1, 'l\'échec redit n\'est pas un deuxième raté');
    assert.equal((await poste(w, C))!.etapes.filter((e) => e.etape === 'échec').length, 1, 'l\'étape « échec » n\'est notée qu\'une fois');
    assert.equal((await w.get(V, `/etat/${jc}?e=fini&nom=serveur-c`)).status, 200);
    r = await rapport(w); assert.equal(r.lignes.filter((x) => x.mac === C).length, 1); assert.equal(r.lignes.find((x) => x.mac === C)?.result, 'échec'); assert.equal((await poste(w, C))?.etat, 'échouée');
    assert.equal(w.alertes(/serveur-c dit « terminée » après avoir dit « échouée »/).length, 1);
    // Un poste dont l'adresse change vraiment (bail renouvelé) : accepté quand l'ancienne se tait depuis 3 min, noté et signalé.
    const jd = await autorise(w, D, 'atelier'); await w.get(V, noyau(D)); await w.get(V, `/etat/${jd}?e=installation`);
    w.avance(MIN); assert.equal((await w.get(AUTRE, `/etat/${jd}?e=vie`)).status, 404, 'trop tôt : le poste vient de parler depuis son adresse');
    w.avance(4 * MIN); assert.equal((await w.get(AUTRE, `/etat/${jd}?e=vie`)).text, 'ok'); assert.equal((await poste(w, D))?.ip, AUTRE);
    assert.equal(w.alertes(/atelier a changé d'adresse pendant son installation/).length, 1); assert.ok((await rapport(w)).evenements.some((e) => e.quoi === 'adresse' && e.mac === D));
  } finally { w.end(); }
});

// ---------------- Le mot de passe ----------------
test('force brute lente : bloquée (15 min puis 1 h) et signalée, même en changeant d\'adresse MAC ; personne ne bloque le poste d\'un autre', async () => {
  const w = await monde(), VM = '52:54:00:c3:00:01';
  try {
    await w.act('mot_de_passe', { mot_de_passe: MDP });
    let bloques = 0;
    for (let tour = 0; tour < 4; tour++) {
      for (let i = 0; i < 19; i++) { const x = await w.cle(P, `52:54:00:d${tour}:00:${String(10 + Math.floor(i / 4))}`, `devine-${tour}-${i}`); if (/Trop d'essais/.test(x.text)) bloques++; }
      w.avance(15 * MIN + 1000);
    }
    assert.ok(bloques >= 30, `attendre un quart d'heure entre deux séries ne sert à rien (${bloques} essais refusés sans calcul)`);
    assert.equal(w.alertes(/mots de passe d'installation refusés en une heure/).length, 1, 'Odin prévient dès 10 refus, tous postes confondus'); assert.equal(w.alertes(/refusés en une heure/)[0].level, 'haute');
    assert.ok(w.alertes(/L'adresse 127\.0\.0\.2 essaie le mot de passe sous \d+ adresses MAC/).length >= 1, 'changer d\'adresse MAC est vu');
    assert.ok(w.alertes(/20 mots de passe refusés : l'adresse 127\.0\.0\.2 est bloquée (15 min|1 h 00)/).length >= 2, 'bloquée 15 min, puis 1 h');
    w.avance(-(15 * MIN + 1000)); assert.match((await w.cle(P, '52:54:00:d9:00:01', MDP)).text, /Trop d'essais : ce poste est bloque (4\d|5\d|60) min/, 'même le bon mot de passe attend, depuis cette adresse');
    // Celui qui triche cite l'adresse MAC d'un vrai poste et se trompe exprès : le vrai poste, depuis son adresse, n'est pas bloqué.
    for (let i = 0; i < 5; i++) await w.cle(AUTRE, VM, `faux-${i}`);
    assert.match((await w.cle(AUTRE, VM, MDP)).text, /Trop d'essais/); assert.match((await w.cle(V, VM, MDP)).text, /Mot de passe accepte/);
    const partout = [JSON.stringify(w.v().alerts({ limit: 500 })), ...readdirSync(w.dir).filter((f) => /\.(json|jsonl)$/.test(f) && f !== 'secrets.json').map((f) => readFileSync(join(w.dir, f), 'utf8'))].join('\n');
    assert.ok(!partout.includes('devine-') && !partout.includes(MDP), 'rien de ce qui a été tapé n\'est gardé');
  } finally { w.end(); }
});

test('mot de passe et Odin qui redémarre : une installation lancée garde son droit jusqu\'à la fin (20 min sans rien charger, ou Odin relancé)', async () => {
  const w = await monde(), Q = '52:54:00:c4:00:01';
  try {
    await w.act('mot_de_passe', { mot_de_passe: MDP });
    assert.match((await w.cle(V, Q, MDP, 'Awa')).text, /accepte/); assert.ok(ouvert((await w.get(V, `/menu.ipxe?mac=${Q}&fw=efi`)).text));
    assert.equal((await poste(w, Q))!.etapes[0].detail, 'mot de passe accepté (Awa)');
    assert.equal((await w.get(V, noyau(Q))).status, 200); assert.equal((await w.get(V, INITRD)).status, 200);
    w.avance(21 * MIN); assert.equal((await w.get(V, INITRD)).status, 200, 'l\'installateur est resté 21 min sur ses questions : ses fichiers lui sont toujours servis');
    assert.ok(ferme((await w.get(V, `/menu.ipxe?mac=${Q}&fw=efi`)).text), 'le menu, lui, redemande le mot de passe');
    await w.relance(MIN);
    assert.equal((await w.get(V, INITRD)).status, 200, 'Odin a redémarré : l\'installation continue'); assert.equal((await w.get(V, `/iso/${U}.iso?m=${Q}`, { range: 'bytes=0-9' })).status, 206);
    assert.equal((await poste(w, Q))?.etat, 'en cours');
    assert.equal((await w.get(P, INITRD)).status, 403, 'ce droit ne vaut que depuis l\'adresse du poste'); assert.equal((await w.get(P, noyau(Q))).status, 403);
    // Mettre un premier mot de passe ne casse pas les installations déjà lancées.
    const w2 = await monde(), Z = '52:54:00:c4:00:02';
    try {
      await w2.get(V, `/menu.ipxe?mac=${Z}&fw=efi`); await w2.get(V, noyau(Z));
      await w2.act('mot_de_passe', { mot_de_passe: MDP });
      assert.equal((await w2.get(V, INITRD)).status, 200); assert.equal((await w2.get(V, '/menu.ipxe?mac=52:54:00:c4:00:03&fw=efi')).text.includes('item cle'), true);
    } finally { w2.end(); }
  } finally { w.end(); }
});

test('« postes non autorisés seulement » : une seule adresse IP par poste autorisé ; une deuxième est refusée et signalée ; la limite est dite', async () => {
  const w = await monde(), S = '52:54:00:c5:00:01';
  try {
    const r = await w.act('mot_de_passe', { mot_de_passe: MDP, pour: 'postes non autorisés seulement' });
    assert.match(r.text, /Attention : un poste autorisé est reconnu à son adresse MAC.*un appareil qui prend cette adresse passe sans mot de passe/);
    const js = await autorise(w, S, 'accueil');
    const autre = (await w.get(P, `/menu.ipxe?mac=${S}&fw=efi`)).text;
    assert.ok(ferme(autre) && !/seed\//.test(autre), 'une deuxième adresse qui cite l\'adresse MAC du poste autorisé n\'a ni menu ni jeton');
    assert.equal((await w.get(P, noyau(S))).status, 403); assert.equal((await w.get(P, INITRD)).status, 403); assert.equal((await w.get(P, `/seed/${js}/user-data`)).status, 404);
    assert.equal(w.alertes(/Deux adresses pour le poste autorisé accueil/).length, 1); assert.equal(w.alertes(/Deux adresses/)[0].level, 'haute');
    assert.equal((await w.get(V, noyau(S))).status, 200); assert.equal((await w.get(V, `/seed/${js}/user-data`)).status, 200); assert.equal((await w.get(V, INITRD)).status, 200);
    assert.equal((w.v().ctx('thjalfi').settings.machines as Array<{ mac: string; fait?: boolean }>).find((x) => x.mac === S)?.fait, true, 'c\'est bien le vrai poste qui a lancé son installation');
    const vue = await w.v().modules().find((m) => m.id === 'thjalfi')!.view(w.v().ctx('thjalfi'), new URLSearchParams());
    assert.match((vue.sections.find((s) => s.title === 'Protection des installations') as { text: string }).text, /aux postes non autorisés.*Attention : un poste autorisé est reconnu à son adresse MAC/s);
  } finally { w.end(); }
});

test('réglages : rien ne change sans qu\'on le demande ; tout ce qui affaiblit la protection demande ton accord', async () => {
  const w = await monde(), X = '52:54:00:c6:00:01', auto = { auto: true };
  try {
    const a = w.v().modules().find((m) => m.id === 'thjalfi')!.actions, mp = a.find((x) => x.id === 'mot_de_passe')!;
    assert.equal(mp.params!.find((p) => p.key === 'pour')!.default, 'ne change pas'); assert.ok(!mp.params!.some((p) => p.key === 'retirer'), 'retirer est une action à part');
    // Ce qui renforce passe sans accord (premier mot de passe, bloquer, suspendre).
    assert.notEqual((await w.act('mot_de_passe', { mot_de_passe: MDP, pour: 'postes non autorisés seulement' }, auto)).ok, false);
    assert.notEqual((await w.act('bloquer', { mac: X }, auto)).ok, false); assert.notEqual((await w.act('suspendre', {}, auto)).ok, false);
    const portee = () => (w.v().ctx('thjalfi').settings.cle as { pour: string; depuis: number });
    const avant = portee();
    // La phrase « mot de passe d'installation » arrive sans réglage : elle dit où on en est, et ne touche à rien.
    for (const entree of [{}, { mot_de_passe: '', pour: 'ne change pas' }]) { const r = await w.act('mot_de_passe', entree, auto); assert.match(r.text, /demandé aux postes non autorisés seulement.*Rien n'est changé\./s); }
    assert.deepEqual(portee(), avant, 'ni la portée ni la date n\'ont bougé');
    // Ce qui affaiblit : jamais depuis une automatisation ni un autre assistant.
    for (const [action, entree] of [['mot_de_passe', { mot_de_passe: 'Choisi-Par-Un-Autre-1' }], ['debloquer', { mac: X }], ['reprendre', {}], ['retirer_mot_de_passe', {}]] as Array<[string, Record<string, unknown>]>) { const r = await w.act(action, entree, auto); assert.equal(r.ok, false, action); assert.match(r.text, /action grave/, action); }
    assert.match((await w.cle(V, '52:54:00:c6:00:09', 'Choisi-Par-Un-Autre-1')).text, /refuse|suspendu/i, 'le mot de passe n\'a pas été changé');
    assert.match((await w.act('mot_de_passe', { pour: 'toutes les installations' }, auto)).text, /inchangé.*à tous les postes/, 'le demander à plus de postes renforce');
    const moins = await w.act('mot_de_passe', { pour: 'postes non autorisés seulement' }, auto); assert.equal(moins.ok, false); assert.match(moins.text, /action grave.*ne plus demander le mot de passe d'installation aux postes autorisés/);
    // Avec ton accord (toi, dans l'interface) : tout passe.
    assert.match((await w.act('reprendre')).text, /de nouveau possibles/); assert.match((await w.act('debloquer', { mac: X })).text, /débloqué/);
    assert.match((await w.act('mot_de_passe', { mot_de_passe: 'Nouveau-Secret-22' })).text, /changé/); assert.match((await w.act('retirer_mot_de_passe')).text, /retiré/);
    assert.equal((await w.act('retirer_mot_de_passe')).ok, false, 'plus rien à retirer');
    assert.match((await w.act('mot_de_passe', {})).text, /Aucun mot de passe d'installation/);
  } finally { w.end(); }
});

// ---------------- Blocage, annulation, postes sans adresse ----------------
test('poste bloqué : sans adresse MAC ou avec une autre jamais vue, il reste refusé ; un poste sans adresse MAC n\'a ni menu ni fichiers (rien hors du suivi)', async () => {
  const w = await monde(), X = '52:54:00:c7:00:01', Y = '52:54:00:c7:00:02', Z = '52:54:00:c7:00:03';
  try {
    const menu = (await w.get(V, `/menu.ipxe?mac=${X}&fw=efi`)).text;
    assert.match(menu, /\nkernel \$\{base\}\/f\/[^\n]+ \|\| goto echec\n/); assert.match(menu, /\ninitrd --name initrd [^\n]+ \|\| goto echec\n/, 'un fichier refusé ramène le poste au menu, pas à l\'invite iPXE');
    await w.act('bloquer', { mac: X, raison: 'essai' });
    // Un refus de fichier apparaît dans le déroulement du poste, et Odin prévient.
    const k = await w.get(V, noyau(X)); assert.equal(k.status, 403); assert.match(k.text, /poste bloqué/);
    assert.ok((await poste(w, X))!.etapes.some((e) => e.detail === 'refusé : poste bloqué'), 'noté dans le déroulement'); assert.equal(w.alertes(/a retenté de démarrer par le réseau/).length, 1);
    // Depuis l'invite iPXE du même poste : pas d'adresse MAC, une fausse, une illisible.
    for (const p of ['/menu.ipxe', '/menu.ipxe?mac=52:54:00:c7:00:99&fw=efi', '/menu.ipxe?mac=zz']) { const t = (await w.get(V, p)).text; assert.ok(!ouvert(t), p); assert.match(t, /est bloque dans Odin/, p); }
    for (const p of [`/f/${U}/casper/vmlinuz`, `/f/${U}/casper/vmlinuz?m=zz`, `/f/${U}/casper/vmlinuz?m=52:54:00:c7:00:99`, `/iso/${U}.iso`, '/boot/wimboot']) assert.equal((await w.get(V, p)).status, 403, p);
    // Un poste que tu as autorisé, lui, n'est pas pris pour le poste bloqué (même derrière la même adresse).
    assert.ok((await autorise(w, Y, 'voisin')).length > 10);
    // Suspendre après le menu : le refus est noté aussi, pour le poste concerné.
    await w.get(AUTRE, `/menu.ipxe?mac=${Z}&fw=efi`); await w.act('suspendre');
    assert.equal((await w.get(AUTRE, noyau(Z))).status, 403); assert.ok((await poste(w, Z))!.etapes.some((e) => e.detail === 'refusé : installations suspendues dans Odin'));
    assert.equal((await w.get(P, noyau(Y))).status, 403, 'suspendu : citer l\'adresse MAC d\'un autre ne donne rien'); await w.act('reprendre');
    // Sans mot de passe : un poste qui ne donne pas d'adresse MAC n'a rien, et c'est noté et signalé.
    const sans = (await w.get(P, '/menu.ipxe')).text; assert.ok(!ouvert(sans)); assert.match(sans, /n'a pas donne son adresse/); assert.match(sans, /sanboot --no-describe --drive 0x80/);
    for (const p of [`/f/${U}/casper/vmlinuz`, INITRD, `/iso/${U}.iso`]) { const x = await w.get(P, p); assert.equal(x.status, 403, p); assert.match(x.text, /poste inconnu d'Odin/); }
    assert.equal(w.alertes(/Demande sans adresse MAC refusée \(127\.0\.0\.2\)/).length, 1); assert.ok((await rapport(w)).evenements.some((e) => e.quoi === 'refus' && /sans adresse MAC depuis 127\.0\.0\.2/.test(e.detail ?? '')));
    // Un poste suivi, lui, reçoit ses fichiers sans adresse MAC (l'installateur ne la donne pas).
    assert.equal((await w.get(AUTRE, noyau(Z))).status, 200); assert.equal((await w.get(AUTRE, INITRD)).status, 200); assert.equal((await w.get(AUTRE, `/iso/${U}.iso`, { range: 'bytes=0-9' })).status, 206);
    // Débloqué (avec ton accord) : l'adresse n'est plus refusée.
    await w.act('debloquer', { mac: X }); assert.ok(ouvert((await w.get(V, '/menu.ipxe?mac=52:54:00:c7:00:99&fw=efi')).text));
  } finally { w.end(); }
});

test('annuler : l\'adresse du poste ne suit pas celui qui cite son adresse MAC ; coupée quelle que soit l\'adresse MAC citée ; « échec » dit par un autre ignoré', async () => {
  const w = await monde(), A = '52:54:00:c8:00:01';
  try {
    await w.get(V, `/menu.ipxe?mac=${A}&fw=efi`); await w.get(V, noyau(A));
    await w.get(P, `/menu.ipxe?mac=${A}&fw=efi`); await w.get(P, `/menu.ipxe?mac=${A}&echec=1`);
    const p = (await poste(w, A))!; assert.equal(p.ip, V, 'l\'adresse IP de la fiche reste celle du poste'); assert.equal(p.etat, 'en cours', 'un « échec » dit depuis une autre adresse ne marque rien');
    assert.notEqual((await w.act('annuler', { mac: A })).ok, false);
    assert.equal((await w.get(V, INITRD)).status, 403); assert.equal((await w.get(V, `${INITRD}?m=52:54:00:c8:00:99`)).status, 403, 'une autre adresse MAC ne passe pas la coupure'); assert.equal((await w.get(V, noyau(A))).status, 403);
    await w.get(P, `/menu.ipxe?mac=${A}&fw=efi`); assert.equal((await w.get(V, INITRD)).status, 403, 'la coupure n\'est pas levée par un autre');
    assert.ok(ouvert((await w.get(V, `/menu.ipxe?mac=${A}&fw=efi`)).text), 'le poste redémarre : il a de nouveau le menu'); assert.equal((await w.get(V, INITRD)).status, 200);
  } finally { w.end(); }
});

test('inondation : une installation en cours n\'est jamais chassée du suivi ; les fausses adresses MAC d\'une même adresse sont plafonnées ; pas une alerte par poste', async () => {
  const w = await monde(), A = '52:54:00:c9:00:01';
  try {
    await w.get(V, `/menu.ipxe?mac=${A}&fw=efi`); await w.get(V, noyau(A)); await pause();
    assert.equal((await poste(w, A))?.etat, 'en cours');
    w.avance(2 * MIN); // l'image se charge : seuls des octets partent
    // 205 vrais postes (chacun son adresse) s'allument et demandent le menu.
    for (let i = 0; i < 205; i++) await w.get(`127.0.${1 + (i >> 7)}.${1 + (i & 127)}`, `/menu.ipxe?mac=02:00:00:00:${(i >> 8).toString(16).padStart(2, '0')}:${(i & 255).toString(16).padStart(2, '0')}&fw=efi`);
    await pause(400); w.avance(LOT_MS + 1000); await w.veille();
    assert.equal((await poste(w, A))?.etat, 'en cours', 'la fiche de l\'installation en cours est toujours là');
    assert.ok(w.alertes(/inconnus? au démarrage réseau/).length <= 3, `les postes inconnus arrivés ensemble sont regroupés (${w.alertes(/inconnus? au démarrage réseau/).length} notifications pour 206 postes)`);
    assert.ok(w.alertes(/^🆕 \d+ autres postes inconnus au démarrage réseau : /).length >= 1);
    // Une seule adresse qui change d'adresse MAC à chaque demande : 10 au plus, puis plus rien (ni menu, ni fiche, ni alerte par poste).
    const avant = ((await w.act('suivi')).data as { postes: unknown[] }).postes.length;
    let menus = 0; for (let i = 0; i < 40; i++) { const mac = `02:11:00:00:00:${i.toString(16).padStart(2, '0')}`; if (ouvert((await w.get(P, `/menu.ipxe?mac=${mac}&fw=efi`)).text)) { menus++; await w.get(P, noyau(mac)); await w.get(P, `/menu.ipxe?mac=${mac}&echec=1`); } }
    await pause(300); w.avance(LOT_MS + 1000); await w.veille();
    assert.equal(menus, 10, 'dix adresses MAC nouvelles par heure et par adresse IP');
    assert.equal(w.alertes(/Trop de postes inconnus depuis l'adresse 127\.0\.0\.2/).length, 1); assert.ok(w.alertes(/ratées?/).length <= 2, 'les faux échecs sont regroupés');
    assert.ok((await rapport(w)).echecs <= 10, 'l\'historique n\'est pas noyé'); assert.ok(((await w.act('suivi')).data as { postes: unknown[] }).postes.length <= avant + 10);
    assert.notEqual((await w.act('annuler', { mac: A })).ok, false, 'l\'installation en cours peut toujours être annulée');
  } finally { w.end(); }
});

// ---------------- Le déroulement ----------------
test('un poste qui recommence en pleine installation : l\'ancien passage est clos avec son résultat, un nouveau commence et est signalé', async () => {
  const w = await monde(), A = '52:54:00:ca:00:01', B = '52:54:00:ca:00:02';
  try {
    // La première étape de chaque passage est notée, avec l'heure.
    await w.get(V, `/menu.ipxe?mac=${B}&fw=efi`);
    const pb = (await poste(w, B))!; assert.equal(pb.etapes.length, 1); assert.equal(pb.etapes[0].etape, 'menu'); assert.equal(pb.etapes[0].at, w.maintenant());
    const ja = await autorise(w, A, 'poste-a'); w.avance(MIN); await w.get(V, noyau(A)); w.avance(MIN); await w.get(V, `/etat/${ja}?e=installation`);
    const p1 = (await poste(w, A))!; assert.equal(p1.etapes[0].etape, 'menu');
    // 10 min plus tard le poste redémarre par le réseau : une simple demande de menu ne clôt rien, mais elle est notée.
    w.avance(10 * MIN); await w.get(V, `/menu.ipxe?mac=${A}&fw=efi`);
    let p = (await poste(w, A))!; assert.equal(p.id, p1.id); assert.equal(p.etape, 'installation'); assert.equal(p.etapes.at(-1)!.detail, 'le poste a redemandé le menu'); assert.equal(p.etapes.at(-1)!.at, w.maintenant());
    // Puis il charge Rocky à la main : c'est une autre installation.
    assert.equal((await w.get(V, noyau(A, R))).status, 200);
    p = (await poste(w, A))!; assert.notEqual(p.id, p1.id, 'nouveau passage, nouvel identifiant'); assert.equal(p.etape, 'chargement'); assert.match(p.image, /Rocky/); assert.equal(p.mode, 'manuelle'); assert.equal(p.etat, 'en cours');
    const h = (await rapport(w)).lignes; assert.equal(h.length, 1, 'l\'installation interrompue a sa ligne');
    assert.equal(h[0].id, p1.id); assert.equal(h[0].result, 'sans nouvelles'); assert.match(h[0].isoName, /ubuntu/); assert.match(h[0].raison ?? '', /le poste a redémarré et relance un système \(dernière étape : installation\)/);
    assert.equal(w.alertes(/^▶ poste-a démarre ubuntu/).length, 1); assert.equal(w.alertes(/^▶ poste-a démarre Rocky/).length, 1, 'le second début est signalé');
    assert.equal(w.alertes(/poste-a : installation interrompue \(le poste a redémarré\)/).length, 1);
    // Quelqu'un d'autre qui cite son adresse MAC en demandant un noyau ne clôt pas son installation.
    await w.get(V, `/etat/${ja}?e=vie`); const id2 = (await poste(w, A))!.id;
    const jb = await autorise(w, B, 'poste-b'); await w.get(V, noyau(B)); await w.get(V, `/etat/${jb}?e=installation`); const idb = (await poste(w, B))!.id;
    await w.get(P, noyau(B, R)); assert.equal((await poste(w, B))!.id, idb); assert.match((await poste(w, B))!.image, /ubuntu/, 'ni l\'image ni le passage ne changent'); assert.equal((await poste(w, A))!.id, id2);
  } finally { w.end(); }
});

test('Odin arrêté longtemps : au redémarrage rien n\'est dit abandonné ; un signe de vie rouvre ; « fini » tardif = terminée, sans raison d\'abandon', async () => {
  const w = await monde(), A = '52:54:00:cb:00:01', B = '52:54:00:cb:00:02';
  try {
    const ja = await autorise(w, A, 'salle-1'); await w.get(V, noyau(A)); await w.get(V, `/etat/${ja}?e=installation`);
    await w.relance(45 * MIN); // mise à jour, panne : 45 min d'arrêt, l'installation continue pendant ce temps
    await w.veille(); assert.equal((await poste(w, A))?.etat, 'en cours', 'le silence ne se compte pas pendant qu\'Odin était arrêté'); assert.equal(w.alertes(/abandonnée/).length, 0);
    assert.equal((await w.get(V, `/etat/${ja}?e=vie`)).text, 'ok'); w.avance(20 * MIN); await w.veille(); assert.equal((await poste(w, A))?.etat, 'en cours');
    w.avance(11 * MIN); await w.veille();
    let p = (await poste(w, A))!; assert.equal(p.etat, 'abandonnée'); assert.match(p.raison, /plus de signe de vie depuis 31 min/); assert.equal(w.alertes(/salle-1 : installation abandonnée/).length, 1);
    // Le poste redonne signe de vie : son installation n'était pas abandonnée.
    assert.equal((await w.get(V, `/etat/${ja}?e=vie`)).text, 'ok');
    p = (await poste(w, A))!; assert.equal(p.etat, 'en cours'); assert.equal(p.etape, 'installation'); assert.equal(p.raison, ''); assert.equal(p.etapes.at(-1)!.detail, 'le poste redonne signe de vie');
    // De nouveau le silence, puis « fini » : la fiche dit « terminée », plus la raison de l'abandon.
    w.avance(31 * MIN); await w.veille(); assert.equal((await poste(w, A))?.etat, 'abandonnée');
    w.avance(5 * MIN); assert.equal((await w.get(V, `/etat/${ja}?e=fini&nom=salle-1&ip=192.168.1.71`)).text, 'ok');
    p = (await poste(w, A))!; assert.equal(p.etat, 'terminée'); assert.equal(p.raison, '', 'la raison de l\'abandon n\'est plus affichée');
    let r = await rapport(w); assert.equal(r.lignes.filter((x) => x.mac === A).length, 1); assert.equal(r.lignes.find((x) => x.mac === A)?.result, 'fini'); assert.equal(r.lignes.find((x) => x.mac === A)?.raison, undefined, 'ni dans la ligne « terminée »');
    // Poste réglé « réseau d'abord » : abandon déclaré, il redemande le menu, puis son premier démarrage dit « fini ». Une seule installation.
    const jb = await autorise(w, B, 'salle-2'); await w.get(V, noyau(B)); await w.get(V, `/etat/${jb}?e=installation`); const idb = (await poste(w, B))!.id;
    w.avance(31 * MIN); await w.veille(); assert.equal((await poste(w, B))?.etat, 'abandonnée');
    w.avance(MIN); await w.get(V, `/menu.ipxe?mac=${B}&fw=efi`); assert.equal((await poste(w, B))?.etat, 'au menu');
    w.avance(MIN); assert.equal((await w.get(V, `/etat/${jb}?e=fini&nom=salle-2&ip=192.168.1.72`)).text, 'ok');
    r = await rapport(w); const lb = r.lignes.filter((x) => x.mac === B);
    assert.equal(lb.length, 1, 'une seule installation au rapport'); assert.equal(lb[0].result, 'fini'); assert.equal(lb[0].id, idb); assert.match(lb[0].isoName, /ubuntu/, 'la bonne image, pas « ? »'); assert.equal(lb[0].ms, 33 * MIN);
    assert.equal(r.reussies, 2); assert.equal(r.abandons, 0);
    assert.ok((await poste(w, B))!.etapes.some((e) => e.etape === 'installation') && (await poste(w, B))!.etapes.some((e) => e.detail === 'le poste a redémarré par le réseau'));
    // Abandon déclaré, puis l'installateur signale enfin son erreur : c'est la même installation, pas un « deuxième raté ».
    const C = '52:54:00:cb:00:03', jc = await autorise(w, C, 'salle-3'); await w.get(V, noyau(C)); await w.get(V, `/etat/${jc}?e=installation`);
    w.avance(31 * MIN); await w.veille(); await w.get(V, `/etat/${jc}?e=echec&raison=ubuntu`);
    const rate = w.alertes(/Installation ratée sur salle-3/); assert.equal(rate.length, 1); assert.equal(rate[0].level, 'haute', 'pas « critique »'); assert.doesNotMatch(rate[0].detail ?? '', /déjà \d+ raté/);
    assert.equal((await rapport(w)).lignes.filter((x) => x.mac === C).length, 1); assert.equal((await rapport(w)).lignes.find((x) => x.mac === C)?.result, 'échec');
  } finally { w.end(); }
});

test('avalanche : vingt postes démarrent, finissent ou ratent ensemble → deux notifications par genre, pas vingt', async () => {
  const w = await monde();
  try {
    const lot = async (prefixe: string, octet: string) => { const l: Array<{ mac: string; jeton: string }> = []; for (let i = 1; i <= 20; i++) { const mac = `52:54:00:${octet}:00:${String(i).padStart(2, '0')}`; l.push({ mac, jeton: await autorise(w, mac, `${prefixe}-${String(i).padStart(2, '0')}`) }); } return l; };
    const passe = async () => { w.avance(LOT_MS + 1000); await w.veille(); };
    const a = await lot('pc', 'e1');
    for (const x of a) await w.get(V, noyau(x.mac)); await passe();
    const debuts = w.alertes(/démarr/); assert.equal(debuts.length, 2, debuts.map((x) => x.title).join(' | '));
    assert.ok(debuts.some((x) => /^▶ pc-01 démarre/.test(x.title)), 'la première tout de suite'); assert.ok(debuts.some((x) => /^▶ 19 autres installations ont démarré : pc-02, pc-03, pc-04 et 16 autres$/.test(x.title)), 'les autres en une seule');
    for (const x of a) await w.get(V, `/etat/${x.jeton}?e=installation`);
    for (const [i, x] of a.entries()) await w.get(V, `/etat/${x.jeton}?e=fini&nom=pc-${String(i + 1).padStart(2, '0')}`); await passe();
    assert.equal(w.alertes(/installée|installations terminées/).length, 2); assert.ok(w.alertes(/^✅ 19 autres installations terminées : pc-02, pc-03, pc-04 et 16 autres$/).length === 1);
    assert.equal((await rapport(w)).reussies, 20, 'le détail poste par poste reste dans l\'historique');
    const b = await lot('px', 'e2'); for (const x of b) await w.get(V, noyau(x.mac)); await passe();
    const avant = w.messages.length;
    for (const x of b) { await w.get(V, `/etat/${x.jeton}?e=installation`); await w.get(V, `/etat/${x.jeton}?e=echec&raison=ubuntu`); } await passe();
    const rates = w.alertes(/ratées?/); assert.equal(rates.length, 2); assert.ok(rates.some((x) => /^❌ 19 autres installations ratées : px-02, px-03, px-04 et 16 autres$/.test(x.title) && x.level === 'haute'));
    assert.equal(w.messages.length - avant, 2, 'deux messages envoyés pour vingt échecs'); assert.equal((await rapport(w)).echecs, 20);
    // 20 abandons vus à la même minute par la surveillance.
    const c = await lot('py', 'e3'); for (const x of c) { await w.get(V, noyau(x.mac)); await w.get(V, `/etat/${x.jeton}?e=installation`); }
    w.avance(31 * MIN); await w.veille(); await passe();
    assert.equal(w.alertes(/abandonnées?/).length, 2); assert.ok(w.alertes(/^❔ 19 autres installations abandonnées/).length === 1);
  } finally { w.end(); }
});

test('boucle d\'une demi-heure (un tour toutes les 30 s) : une installation, un compte d\'essais, quelques lignes écrites', async () => {
  const w = await monde(), X = '52:54:00:cc:00:01';
  try {
    await w.get(V, `/menu.ipxe?mac=${X}&fw=efi`);
    for (let i = 0; i < 60; i++) { await w.get(V, noyau(X)); await w.get(V, `/menu.ipxe?mac=${X}&echec=1`); w.avance(30_000); if (i % 2) await w.veille(); }
    w.avance(3 * MIN); await w.veille();
    const r = await rapport(w); assert.equal(r.total, 1, 'une seule installation au rapport'); assert.equal(r.echecs, 1); assert.equal(r.lignes[0].tours, 60); assert.ok(r.lignes[0].ms >= 29 * MIN, 'sa durée couvre toute la boucle');
    assert.match((await w.act('rapport', { periode: 'tout' })).text, /^1 installation en tout : 0 réussie, 1 échec sur le poste/);
    const ecrites = readFileSync(join(w.dir, 'historique.jsonl'), 'utf8').trim().split('\n').length; assert.ok(ecrites <= 8, `${ecrites} lignes écrites pour 60 tours`);
    const fil = readFileSync(join(w.dir, 'etapes.jsonl'), 'utf8').trim().split('\n').length; assert.ok(fil <= 25, `${fil} entrées dans le fil pour 60 tours`);
    const al = w.alertes(/Installation ratée/); assert.equal(al.length, 1); assert.equal(al[0].level, 'haute', 'une boucle n\'est pas une urgence'); assert.ok(al[0].count >= 50);
    assert.ok(w.messages.filter((m) => /ratée/.test(m)).length <= 1, 'un seul message');
  } finally { w.end(); }
});
