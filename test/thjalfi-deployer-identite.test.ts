// Genèse · Déployer (lot S6), correction : après un refus « ce n'est pas le PC autorisé », ou quand l'identité connue avant
// diffère de celle vue maintenant (même au-delà de 24 h), « Déployer » ne relit plus seulement l'identité du dernier appareil
// vu : le propriétaire choisit QUELLE identité est la bonne, et seule celle-là est autorisée ; l'autre reste refusée.
// SÛRETÉ : aucun serveur n'écoute ; chaque PC est SIMULÉ (PxeHttp.simuler). Aucun vrai PC, aucun vrai disque. Dossiers temporaires neufs.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { after, test } from 'node:test';
import { Valhalla } from '../src/valhalla/service.ts';
import { allModules } from '../src/valhalla/odin.ts';
import { DEFAULT_CONFIG } from '../src/config.ts';

const dossiers: string[] = [];
after(() => { for (const d of dossiers) rmSync(d, { recursive: true, force: true }); });
const FIX = join(import.meta.dirname, 'fixtures', 'thjalfi');
const isoDir = (dir: string) => { mkdirSync(dir, { recursive: true }); for (const f of readdirSync(FIX)) writeFileSync(join(dir, f.replace(/\.gz$/, '')), gunzipSync(readFileSync(join(FIX, f)))); return dir; };

const C = '52:54:00:c1:5b:77', IP_C = '192.168.1.23', IP_FAUX = '192.168.1.99';
const UBU = 'ubuntu-24-04-3-live-server-amd64';
const JOUR = 24 * 3600_000;

interface Monde { v: Valhalla; dir: string; pc: (mac: string, q?: string, ip?: string) => Promise<string>; avance: (ms: number) => void; fin: () => void }
async function monde(): Promise<Monde> {
  const home = mkdtempSync(join(tmpdir(), 'odin-s6id-')); dossiers.push(home);
  const saved = process.env.BRISINGAMEN_KEY; process.env.BRISINGAMEN_KEY = 'ef'.repeat(32);
  let t = new Date(2026, 10, 21, 9, 0).getTime();
  const v = new Valhalla(home, allModules({ paths: { home, workspace: home }, cfg: DEFAULT_CONFIG } as never), { run: async () => ({ code: 1, out: '', err: '' }), fetch: (async () => { throw new Error('aucun réseau'); }) as never, notify: async () => {}, autonomy: () => 'equilibre', now: () => new Date(t) } as never);
  await v.act('eitri', 'dossier', { chemin: isoDir(join(home, 'iso')) });
  v.ctx('thjalfi').saveSettings({ ip: '192.168.1.10', mode: 'aucun' });
  const mod = v.modules().find((m) => m.id === 'thjalfi') as unknown as { serveurSimule: (c: unknown) => { simuler: (m: string, u: string, f: string) => Promise<{ status: number; body: string }> } };
  const h = mod.serveurSimule(v.ctx('thjalfi'));
  const pc = async (mac: string, q = '', ip = IP_C) => (await h.simuler('GET', `/menu.ipxe?mac=${mac}&fw=efi${q ? `&${q}` : ''}`, ip)).body;
  return { v, dir: join(home, 'valhalla', 'thjalfi'), pc, avance: (ms) => { t += ms; }, fin: () => { v.stop(); if (saved === undefined) delete process.env.BRISINGAMEN_KEY; else process.env.BRISINGAMEN_KEY = saved; } };
}
const autorisees = (w: Monde) => { try { return JSON.parse(readFileSync(join(w.dir, 'deploiements-autorises.json'), 'utf8')) as Array<Record<string, any>>; } catch { return []; } };
const deployer = (w: Monde, plus: Record<string, unknown> = {}) => w.v.act('thjalfi', 'deployer', { pcs: [C], iso: UBU, facon: 'auto', phrase: 'effacer 1 pc', ...plus });
const AUTO = /autoinstall|seed\//;
type Choix = { mac: string; options: Array<{ cle: string; serie?: string; uuid?: string; disque?: number; premiere: number; derniere: number; maintenant?: boolean; refusee?: boolean }> };

test("Déployer · le vrai PC vu à J-2, refus d'un appareil qui recopie son adresse, puis « Déployer » à la main : l'imposteur n'est JAMAIS autorisé sans choix", async () => {
  const w = await monde();
  try {
    await w.pc(C, 'serie=CCC333&uuid=4c4c4544-0042-3510-8051-b4c04f4e3732'); // le vrai PC, au menu
    w.avance(2 * JOUR);
    assert.notEqual((await deployer(w)).ok, false);
    assert.equal(autorisees(w).at(-1)!.serie, 'CCC333');
    // Un autre appareil démarre avec l'adresse de C : refusé (ce n'est pas le PC autorisé).
    assert.doesNotMatch(await w.pc(C, 'serie=FAUX999', IP_FAUX), AUTO);
    w.avance(60_000);
    // « Déployer » à la main sur ce PC : sans choix, rien n'est autorisé.
    const r = await deployer(w);
    assert.equal(r.ok, false, r.text);
    assert.match(r.text, /lequel est le bon|quelle identité/i);
    assert.ok(!autorisees(w).some((a) => a.serie === 'FAUX999'), 'aucune autorisation pour l\'appareil qui a recopié l\'adresse');
    assert.doesNotMatch(await w.pc(C, 'serie=FAUX999', IP_FAUX), AUTO, 'l\'imposteur ne reçoit jamais le menu automatique');
    // Le choix proposé : l'ancienne identité connue ET celle vue maintenant, avec leurs dates.
    const choix = (r.data as { identites: Choix[] }).identites;
    assert.equal(choix.length, 1); assert.equal(choix[0].mac, C);
    const vieille = choix[0].options.find((o) => o.serie === 'CCC333')!, faux = choix[0].options.find((o) => o.serie === 'FAUX999')!;
    assert.ok(vieille && faux, JSON.stringify(choix));
    assert.ok(vieille.premiere < faux.premiere);
    assert.ok(faux.refusee || faux.maintenant);
    // Une clé inventée par la page : refusée.
    const r2 = await deployer(w, { identite: { [C]: 'n\'importe quoi' } });
    assert.equal(r2.ok, false);
    // Le propriétaire choisit l'ancienne : seule celle-là est autorisée ; l'imposteur reste refusé.
    const r3 = await deployer(w, { identite: JSON.stringify({ [C]: vieille.cle }) });
    assert.notEqual(r3.ok, false, r3.text);
    assert.equal(autorisees(w).at(-1)!.serie, 'CCC333');
    assert.doesNotMatch(await w.pc(C, 'serie=FAUX999', IP_FAUX), AUTO, 'l\'autre reste refusée');
  } finally { w.fin(); }
});

test('Déployer · choisir puis le bon PC démarre : il est installé, une seule fois', async () => {
  const w = await monde();
  try {
    await w.pc(C, 'serie=CCC333');
    w.avance(2 * JOUR);
    assert.notEqual((await deployer(w)).ok, false);
    assert.doesNotMatch(await w.pc(C, 'serie=FAUX999', IP_FAUX), AUTO);
    const r = await deployer(w); assert.equal(r.ok, false);
    const o = (r.data as { identites: Choix[] }).identites[0].options.find((x) => x.serie === 'CCC333')!;
    // La phrase et l'appui restent exigés même avec le choix.
    assert.equal((await deployer(w, { identite: { [C]: o.cle }, phrase: 'effacer 2 pc' })).ok, false);
    assert.notEqual((await deployer(w, { identite: { [C]: o.cle } })).ok, false);
    assert.match(await w.pc(C, 'serie=CCC333'), AUTO, 'le vrai PC s\'installe');
    assert.doesNotMatch(await w.pc(C, 'serie=CCC333'), AUTO, 'jamais effacé deux fois');
  } finally { w.fin(); }
});

test('Déployer · sans refus : un autre appareil vu au-delà de 24 h après le vrai → choix exigé ; la page ne choisit pas « le dernier venu »', async () => {
  const w = await monde();
  try {
    await w.pc(C, 'serie=CCC333');
    w.avance(2 * JOUR);
    await w.pc(C, 'serie=FAUX999', IP_FAUX); // seul appareil vu ces dernières 24 h
    const r = await deployer(w);
    assert.equal(r.ok, false, r.text);
    assert.ok(!autorisees(w).length);
    const opts = (r.data as { identites: Choix[] }).identites[0].options;
    assert.deepEqual(opts.map((x) => x.serie).sort(), ['CCC333', 'FAUX999']);
    assert.ok(opts.find((x) => x.serie === 'FAUX999')!.maintenant, 'celle vue maintenant est signalée');
    // Le propriétaire choisit celle vue maintenant (le PC a changé de carte mère, par exemple) : seule elle est autorisée.
    assert.notEqual((await deployer(w, { identite: { [C]: opts.find((x) => x.serie === 'FAUX999')!.cle } })).ok, false);
    assert.equal(autorisees(w).at(-1)!.serie, 'FAUX999');
    assert.doesNotMatch(await w.pc(C, 'serie=CCC333'), AUTO, 'l\'autre reste refusée');
  } finally { w.fin(); }
});

test('Déployer · le même PC vu tous les jours, rien d\'autre : aucun choix demandé', async () => {
  const w = await monde();
  try {
    await w.pc(C, 'serie=CCC333');
    w.avance(2 * JOUR); await w.pc(C, 'serie=CCC333');
    const r = await deployer(w);
    assert.notEqual(r.ok, false, r.text);
    assert.match(await w.pc(C, 'serie=CCC333'), AUTO);
  } finally { w.fin(); }
});

test("Déployer · l'alerte de refus dit vrai (plus de « avant 24 h »)", async () => {
  const w = await monde();
  try {
    await w.pc(C, 'serie=CCC333');
    assert.notEqual((await deployer(w)).ok, false);
    await w.pc(C, 'serie=FAUX999', IP_FAUX);
    const al = w.v.alerts({ module: 'thjalfi' }).find((x) => /Déploiement refusé/.test(x.title));
    assert.ok(al, 'Odin prévient');
    assert.doesNotMatch(al.detail ?? '', /avant 24 h/);
    assert.match(al.detail ?? '', /lequel est le bon/);
  } finally { w.fin(); }
});

test('Déployer (page) · le choix d\'identité : nettoyé, rien de choisi d\'office, le bouton reste fermé tant qu\'il manque un choix', async () => {
  const vm = await import('node:vm');
  const g: Record<string, any> = {}; g.window = g;
  vm.runInNewContext(readFileSync(new URL('../src/web/pages/thjalfi-deployer.js', import.meta.url), 'utf8'), g);
  const L = g.OdinGeneseDeployer.logique;
  const l = L.choixIdentite([{ mac: C, options: [{ cle: 'ccc333||', serie: 'CCC333', premiere: 1, derniere: 2 }, { cle: 'faux999||', serie: 'FAUX<b>\u202e999', premiere: 3, derniere: 3, refusee: true }, { serie: 'sans nom' }] }, null, 'x']);
  assert.equal(l.length, 1); assert.equal(l[0].options.length, 2, 'une identité sans nom est ignorée');
  assert.equal(l[0].options[1].serie, 'FAUX<b>999', 'caractères invisibles retirés (le texte est toujours écrit comme du texte)');
  assert.equal(L.identitesChoisies(l, {}), false, 'rien de choisi d\'office');
  assert.equal(L.identitesChoisies(l, { [C]: 'autre' }), false, 'un nom inconnu ne vaut rien');
  assert.equal(L.identitesChoisies(l, { [C]: 'ccc333||' }), true);
  assert.equal(L.identitesChoisies(null, {}), true, 'aucun choix demandé');
  for (const k of ['id.titre', 'id.lead', 'id.maintenant', 'id.refusee', 'id.manque']) assert.ok(g.OdinGeneseDeployer.MOTS[k], k);
});
