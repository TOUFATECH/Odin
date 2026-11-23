// Genèse · Clés USB, lot C4 — RELECTURE EN ADVERSAIRE (sûreté des disques d'abord). Chaque essai rejoue une attaque ou
// une panne : deux écritures en même temps, la clé changée PENDANT l'écriture, une lettre de lecteur réattribuée, un lien
// (jonction) posé sur la clé qui pointe ailleurs, un nom réservé de Windows, un nom de système qui casse le menu, une
// annulation, et les installations Linux qui ne doivent plus effacer un disque toutes seules.
// Uniquement des dossiers temporaires (« faux disques ») et une fausse liste de disques ; ctx.run compte ses appels (zéro).
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import * as E from '../src/valhalla/thjalfi/cle-ecrire.ts';
import * as SC from '../src/valhalla/thjalfi/scripts.ts';
import type { Disque } from '../src/valhalla/thjalfi/disques.ts';
import type { Recipe } from '../src/valhalla/thjalfi/recipes.ts';
import type { ModCtx } from '../src/valhalla/types.ts';

const X = E as unknown as Record<string, any>;
const G = 1024 ** 3;
const dossiers: string[] = [];
const neuf = (n: string) => { const d = mkdtempSync(join(tmpdir(), `odin-c4r-${n}-`)); dossiers.push(d); return d; };
after(() => { for (const d of dossiers) rmSync(d, { recursive: true, force: true }); });

const rUbuntu: Recipe = { kind: 'ubuntu', label: 'Ubuntu', auto: true, os: 'linux' };
const rDebian: Recipe = { kind: 'debian', label: 'Debian', auto: true, os: 'linux' };
const rFedora: Recipe = { kind: 'rhel', label: 'Fedora', auto: true, os: 'linux' };
const rWin: Recipe = { kind: 'windows', label: 'Windows', auto: true, os: 'windows' };
const CLE: Disque = { id: 'faux-cle', chemin: 'faux-9', modele: 'Clé USB 64 Go (fausse)', serie: 'AA11BB227F2A', tailleOctets: 58 * G, genre: 'cle', externe: true, amovible: true, bus: 'usb', partitions: [] };
const PHRASE = 'effacer la clé 58 go';
const cibleDe = (d: Disque) => ({ id: d.id, serie: d.serie, tailleOctets: d.tailleOctets, modele: d.modele });
const tout = (d: string): string[] => (existsSync(d) ? readdirSync(d, { recursive: true, withFileTypes: true }).filter((e) => e.isFile()).map((e) => join(e.parentPath ?? (e as { path?: string }).path ?? d, e.name).slice(d.length + 1).replace(/\\/g, '/')).sort() : []);

function monde(o: { disques?: (img: string) => Disque[] } = {}) {
  const src = neuf('src'), img = neuf('img'), home = neuf('home'), dir = neuf('dir');
  const f = (n: string, c: string) => { const p = join(src, n); writeFileSync(p, c); return p; };
  const biblio = [
    { id: 'ubuntu', nom: 'ubuntu-24.04-desktop-amd64', chemin: f('ubuntu.iso', 'ISO-UBUNTU-FAUSSE'), recipe: rUbuntu },
    { id: 'debian', nom: 'debian-12-amd64-netinst', chemin: f('debian.iso', 'ISO-DEBIAN-FAUSSE'), recipe: rDebian },
    { id: 'fedora', nom: 'Fedora-Server-41-x86_64', chemin: f('fedora.iso', 'ISO-FEDORA-FAUSSE'), recipe: rFedora },
    { id: 'win11', nom: 'Win11_Pro_24H2_French_x64', chemin: f('win11.iso', 'ISO-WINDOWS-FAUSSE'), recipe: rWin },
  ];
  const appels = { run: 0 };
  const liste = () => (o.disques ? o.disques(img) : [CLE]);
  const settings = { get cleDisquesTest() { return liste(); }, cleImageTest: img } as Record<string, unknown>;
  const ctx = {
    home, dir, settings, now: () => new Date(),
    run: async () => { appels.run++; throw new Error('aucune commande pendant les essais'); },
    call: async (m: string) => { if (m === 'fjalar') return { ok: true, text: '', data: { fichiers: [] } }; throw new Error('absent'); },
  } as unknown as ModCtx;
  const actions = E.cleUsb({
    bibliotheque: async () => biblio,
    antivirus: () => undefined,
    cleActivation: () => undefined,
    profil: () => ({ utilisateur: 'famille', langue: 'fr_FR.UTF-8', clavier: 'fr', fuseau: 'Indian/Mayotte' }),
  }).actions;
  const action = (id: string) => actions.find((a) => a.id === id)!;
  return { img, ctx, appels, action };
}
const sys = (id: string, nom: string, choix = 'iso', extra: Record<string, unknown> = {}) => ({ nom, iso: `iso:${id}`, famille: id === 'win11' ? 'windows' : 'linux', choix, ...extra });

// ------------------------------------------------------------------------------------------------ concurrence
test('relecture · deux écritures lancées en même temps sur la même clé : une seule part', async () => {
  const m = monde();
  const entree = { cible: cibleDe(CLE), systemes: [sys('ubuntu', 'Ubuntu')], phrase: PHRASE };
  const [a, b] = await Promise.all([m.action('cle_preparer').run(m.ctx, entree), m.action('cle_preparer').run(m.ctx, entree)]);
  await X.attendreEcriture(CLE.id);
  assert.equal([a, b].filter((r) => r.ok).length, 1, `${a.text} / ${b.text}`);
  assert.match((a.ok ? b : a).text, /déjà en cours/);
  assert.equal(m.appels.run, 0);
});

// ------------------------------------------------------------------------------------------------ TOCTOU
test('relecture · la clé change PENDANT l\'écriture (autre numéro de série, ou débranchée) : Odin s\'arrête au fichier suivant', async () => {
  for (const apres of [(d: Disque) => [{ ...d, serie: 'AUTRE0000000' }], (_d: Disque) => [] as Disque[]]) {
    const m = monde({ disques: (img) => (existsSync(join(img, 'ISO/ubuntu-24.04-desktop-amd64.iso')) ? apres(CLE) : [CLE]) });
    const r = await m.action('cle_preparer').run(m.ctx, { cible: cibleDe(CLE), systemes: [sys('ubuntu', 'Ubuntu'), sys('debian', 'Debian')], phrase: PHRASE });
    assert.equal(r.ok, true, r.text);
    const fin = await X.attendreEcriture(CLE.id);
    assert.equal(fin.ok, false, 'l\'écriture ne continue pas sur un autre disque');
    assert.equal(fin.touchee, true);
    assert.ok(!existsSync(join(m.img, 'ISO/debian-12-amd64-netinst.iso')), tout(m.img).join(', '));
    assert.match(fin.message, /en partie écrite|incompl/i, fin.message);
  }
});

test('relecture · lettre de lecteur / point de montage réattribué à un autre disque pendant l\'écriture : plus rien n\'y est écrit', async () => {
  const racine = neuf('montage');
  const io = X.ioDossier(racine, { chargeur: 'simule' });
  assert.equal(typeof io.marquer, 'function', 'la clé reçoit une marque d\'écriture en cours');
  await io.marquer();
  await io.ecrire('ISO/a.txt', 'a');
  // Le même chemin désigne maintenant un AUTRE disque (vide) : la marque n'y est pas.
  rmSync(racine, { recursive: true, force: true }); mkdirSync(racine);
  await assert.rejects(io.ecrire('ISO/b.txt', 'b'), /plus la même|changé/i);
  const src = join(neuf('s'), 'x.iso'); writeFileSync(src, 'X');
  await assert.rejects(io.copier(src, 'ISO/x.iso'), /plus la même|changé/i);
  assert.deepEqual(tout(racine), [], 'rien n\'est écrit sur l\'autre disque');
});

// ------------------------------------------------------------------------------------------------ hors de la partition
test('relecture · une jonction (ou un lien) posée sur la clé qui pointe ailleurs n\'est jamais suivie', async () => {
  const parent = neuf('lien'), racine = join(parent, 'odin-part'), dehors = join(parent, 'systeme');
  mkdirSync(racine); mkdirSync(dehors);
  symlinkSync(dehors, join(racine, 'ISO'), 'junction');
  const io = X.ioDossier(racine, { chargeur: 'simule' });
  await assert.rejects(io.ecrire('ISO/win.iso', 'x'), /refusé/);
  await assert.rejects(io.ecrire('ISO/sous/win.iso', 'x'), /refusé/);
  const src = join(neuf('s2'), 'x.iso'); writeFileSync(src, 'X');
  await assert.rejects(io.copier(src, 'ISO/x.iso'), /refusé/);
  assert.deepEqual(readdirSync(dehors), [], 'rien écrit hors de la partition ODIN');
});

test('relecture · noms réservés de Windows et flux cachés refusés sur la clé', async () => {
  const racine = neuf('reserve');
  const io = X.ioDossier(racine, { chargeur: 'simule' });
  for (const d of ['ISO/CON', 'ISO/nul.iso', 'odin/COM1.txt', 'aux/x.txt', 'ISO/a.iso:flux', 'ISO/fin.', 'ISO/fin ']) await assert.rejects(io.ecrire(d, 'x'), /refusé/, d);
  assert.deepEqual(tout(racine), []);
});

// ------------------------------------------------------------------------------------------------ menu
test('relecture · un nom de système trafiqué n\'ajoute rien au menu de démarrage', async () => {
  const m = monde();
  const nom = 'Ubuntu" --class linux {\n}\nmenuentry "pirate" {\n  linux /pirate\n';
  const r = await m.action('cle_preparer').run(m.ctx, { cible: cibleDe(CLE), systemes: [sys('ubuntu', nom, 'installe', { installPartition: { tailleGo: 10 } })], phrase: PHRASE });
  assert.equal(r.ok, true, r.text);
  const fin = await X.attendreEcriture(CLE.id);
  assert.equal(fin.ok, true, fin.message);
  const cfg = readFileSync(join(m.img, 'ventoy/ventoy_grub.cfg'), 'utf8');
  assert.equal((cfg.match(/^menuentry /gm) ?? []).length, 1, cfg);
  assert.equal(cfg.split('\n').filter((l) => l.trim()).length, 5, 'une seule entrée de quatre lignes (et le titre)');
  assert.doesNotMatch(cfg, /^\s*linux \/pirate/m, 'aucune commande ajoutée');
  assert.match(cfg, /^menuentry "[^"\n]*\(installé\)" --class linux \{$/m, 'le nom reste entre ses guillemets');
});

// ------------------------------------------------------------------------------------------------ annuler
test('relecture · annuler après le premier octet : la fin le dit, et la clé porte une marque « écriture incomplète »', async () => {
  let stop = false;
  const m2 = monde({ disques: (img) => { if (existsSync(join(img, 'ISO/ubuntu-24.04-desktop-amd64.iso'))) stop = true; return [CLE]; } });
  const r = await m2.action('cle_preparer').run(m2.ctx, { cible: cibleDe(CLE), systemes: [sys('ubuntu', 'Ubuntu'), sys('debian', 'Debian')], phrase: PHRASE });
  assert.equal(r.ok, true);
  // Annuler dès que la première ISO est posée.
  // (la liste des disques est relue avant chaque système : c'est là que « stop » passe à vrai, puis on annule)
  const m2a = m2.action('cle_annuler');
  const fini = { v: false };
  const attente = (async () => { for (let k = 0; k < 20000 && !stop && !fini.v; k++) await new Promise((ok) => setImmediate(ok)); if (stop) await m2a.run(m2.ctx, { cible: { id: CLE.id } }); })();
  const fin = await X.attendreEcriture(CLE.id); fini.v = true; await attente;
  assert.equal(fin.ok, false, 'annulée');
  assert.equal(fin.touchee, true);
  assert.match(fin.message, /en partie écrite|incompl/i, fin.message);
  assert.ok(tout(m2.img).some((f) => /INCOMPLETE/i.test(f)), tout(m2.img).join(', '));
  // Une écriture finie efface la marque.
  const m3 = monde();
  await m3.action('cle_preparer').run(m3.ctx, { cible: cibleDe(CLE), systemes: [sys('ubuntu', 'Ubuntu')], phrase: PHRASE });
  const ok = await X.attendreEcriture(CLE.id);
  assert.equal(ok.ok, true, ok.message);
  assert.ok(!tout(m3.img).some((f) => /INCOMPLETE/i.test(f)), tout(m3.img).join(', '));
});

// ------------------------------------------------------------------------------------------------ point (b)
test('relecture · (b) installations Linux de la clé : le disque du PC est choisi au moment d\'installer, rien n\'est effacé tout seul', async () => {
  const a = { host: 'h', user: 'famille', password: '', locale: 'fr_FR.UTF-8', keymap: 'fr', timezone: 'Indian/Mayotte', packages: [], report: 'http://127.0.0.1/x' };
  const ud = SC.scriptsLinuxCle(a, 'ubuntu', 't')['user-data'];
  assert.doesNotMatch(ud, /storage:\s*\{?\s*layout/, 'plus de partitionnement automatique (Ubuntu)');
  assert.match(ud, /interactive-sections:\s*\n\s*- storage/, 'l\'installateur Ubuntu demande le disque');
  const ps = SC.scriptsLinuxCle(a, 'debian', 't')['preseed.cfg'];
  assert.doesNotMatch(ps, /partman/, 'aucune réponse de partitionnement (Debian) : l\'installateur demande');
  assert.doesNotMatch(ps, /grub-installer\/bootdev/, 'le disque du chargeur aussi est demandé');
  const ks = SC.scriptsLinuxCle(a, 'rhel', 't')['ks.cfg'];
  assert.doesNotMatch(ks, /^(zerombr|clearpart|autopart|ignoredisk)\b/m, 'aucun effacement (Fedora/RHEL) : l\'installateur demande');
  // Sur l'image écrite (faux disque) : les trois familles.
  const m = monde();
  const r = await m.action('cle_preparer').run(m.ctx, { cible: cibleDe(CLE), systemes: [sys('ubuntu', 'Ubuntu'), sys('debian', 'Debian'), sys('fedora', 'Fedora')], phrase: PHRASE });
  assert.equal(r.ok, true, r.text);
  const fin = await X.attendreEcriture(CLE.id);
  assert.equal(fin.ok, true, fin.message);
  const f = tout(m.img);
  const lire = (n: string) => readFileSync(join(m.img, n), 'utf8');
  assert.ok(f.includes('odin/user-data') && f.includes('odin/preseed.cfg'), f.join(', '));
  const ksNom = f.find((x) => /^odin\/.*\.cfg$/.test(x) && x !== 'odin/preseed.cfg')!;
  assert.ok(ksNom, f.join(', '));
  assert.doesNotMatch(lire('odin/user-data'), /storage:/);
  assert.doesNotMatch(lire('odin/preseed.cfg'), /partman/);
  assert.doesNotMatch(lire(ksNom), /^(zerombr|clearpart|autopart)\b/m);
  assert.equal(m.appels.run, 0);
});
