// Genèse · Clés USB, lot C4 (côté serveur) : la clé s'écrit. Ces essais n'écrivent QUE dans des dossiers temporaires
// (un « faux disque » : le dossier joue la partition ODIN) ; la liste des disques est fausse ; aucune commande du système
// n'est lancée (ctx.run compte ses appels : il doit rester à zéro). Jamais un vrai disque lu, écrit ou formaté.
//
// Les huit points ouverts par les relectures précédentes, chacun avec son essai, plus : la phrase vérifiée par le serveur,
// un disque interne ou système refusé même si la page est trafiquée, un numéro de série qui change entre le choix et
// l'écriture, annuler, éjecter, le contenu de l'image écrite, et un membre / une automatisation / une clé d'API refusés.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { after, test } from 'node:test';
import * as E from '../src/valhalla/thjalfi/cle-ecrire.ts';
import * as CC from '../src/valhalla/thjalfi/cle-cible.ts';
import * as SC from '../src/valhalla/thjalfi/scripts.ts';
import { untar } from '../src/valhalla/thjalfi/ecran-pc.ts';
import type { Disque } from '../src/valhalla/thjalfi/disques.ts';
import type { Recipe } from '../src/valhalla/thjalfi/recipes.ts';
import type { ModCtx } from '../src/valhalla/types.ts';

const X = E as unknown as Record<string, any>;
const G = 1024 ** 3;
const dossiers: string[] = [];
const neuf = (n: string) => { const d = mkdtempSync(join(tmpdir(), `odin-c4-${n}-`)); dossiers.push(d); return d; };
after(() => { for (const d of dossiers) rmSync(d, { recursive: true, force: true }); });

const rUbuntu: Recipe = { kind: 'ubuntu', label: 'Ubuntu', auto: true, os: 'linux' };
const rWin: Recipe = { kind: 'windows', label: 'Windows', auto: true, os: 'windows' };
const CLE: Disque = { id: 'faux-cle', chemin: 'faux-9', modele: 'Clé USB 64 Go (fausse)', serie: 'AA11BB227F2A', tailleOctets: 58 * G, genre: 'cle', externe: true, amovible: true, bus: 'usb', partitions: [] };
const INTERNE: Disque = { id: 'faux-interne', chemin: 'faux-1', modele: 'SSD interne (faux)', serie: 'SSD00112233', tailleOctets: 512 * G, genre: 'interne', externe: false, amovible: false, bus: 'nvme', estOdin: true, partitions: [{ nom: 'p1', label: 'ODIN', tailleOctets: 60 * G }] };
const SYSTEME_USB: Disque = { id: 'faux-live', chemin: 'faux-2', modele: 'Clé live (fausse)', serie: 'LIVE998877', tailleOctets: 32 * G, genre: 'cle', externe: true, amovible: true, bus: 'usb', systemeEnCours: true, partitions: [] };

/** Une bibliothèque fausse (fichiers temporaires), des logiciels d'Hermès faux, un ctx qui compte les commandes. */
function monde(o: { disques?: () => Disque[]; bascule?: () => void } = {}) {
  const src = neuf('src'), img = neuf('img'), home = neuf('home'), dir = neuf('dir');
  const f = (n: string, c: string) => { const p = join(src, n); writeFileSync(p, c); return p; };
  const biblio = [
    { id: 'ubuntu', nom: 'ubuntu-24.04-desktop-amd64', chemin: f('ubuntu.iso', 'ISO-UBUNTU-FAUSSE'), recipe: rUbuntu },
    { id: 'win11', nom: 'Win11_Pro_24H2_French_x64', chemin: f('win11.iso', 'ISO-WINDOWS-FAUSSE'), recipe: rWin },
  ];
  const fiches = [
    { source: 'firefox', nom: 'Firefox', fichier: 'Mon App.exe', chemin: f('Mon App.exe', 'EXE-FAUX') },
    { nom: 'GIMP', fichier: 'gimp-faux.deb', chemin: f('gimp-faux.deb', 'DEB-FAUX') },
  ];
  const appels = { run: 0, biblio: 0 };
  const liste = o.disques ?? (() => [CLE, INTERNE, SYSTEME_USB]);
  const settings = { get cleDisquesTest() { return liste(); }, cleImageTest: img } as Record<string, unknown>;
  const ctx = {
    home, dir, settings, now: () => new Date(),
    run: async () => { appels.run++; throw new Error('aucune commande pendant les essais'); },
    call: async (m: string) => { if (m === 'fjalar') return { ok: true, text: '', data: { fichiers: fiches } }; throw new Error('absent'); },
  } as unknown as ModCtx;
  const actions = E.cleUsb({
    bibliotheque: async () => { appels.biblio++; o.bascule?.(); return biblio; },
    antivirus: (_n, c) => (/vssadmin|EICAR/.test(c) ? 'contenu dangereux (essai)' : undefined),
    cleActivation: () => undefined,
    profil: () => ({ utilisateur: 'famille', langue: 'fr_FR.UTF-8', clavier: 'fr', fuseau: 'Indian/Mayotte' }),
  }).actions;
  const action = (id: string) => actions.find((a) => a.id === id)!;
  return { src, img, ctx, appels, action, biblio };
}
const cibleDe = (d: Disque) => ({ id: d.id, serie: d.serie, tailleOctets: d.tailleOctets, modele: d.modele });
const ubuntu = { nom: 'Ubuntu 24.04', iso: 'iso:ubuntu', fichier: 'ubuntu-24.04-desktop-amd64.iso', famille: 'linux', choix: 'iso', logiciels: [{ id: 'gimp-faux.deb', fichier: 'gimp-faux.deb' }] };
const windows = { nom: 'Windows 11', iso: 'iso:win11', fichier: 'Win11_Pro_24H2_French_x64.iso', famille: 'windows', choix: 'iso', logiciels: [{ id: 'firefox', fichier: 'Mon App.exe' }] };
const PHRASE = 'effacer la clé 58 go';
/** Tous les fichiers écrits sous un dossier (chemins relatifs). */
const tout = (d: string): string[] => (existsSync(d) ? readdirSync(d, { recursive: true, withFileTypes: true }).filter((e) => e.isFile()).map((e) => join(e.parentPath ?? (e as { path?: string }).path ?? d, e.name).slice(d.length + 1).replace(/\\/g, '/')).sort() : []);
async function ecrire(m: ReturnType<typeof monde>, entree: Record<string, unknown>) {
  const r = await m.action('cle_preparer').run(m.ctx, entree);
  const fin = r.ok ? await X.attendreEcriture(String(((r.data ?? {}) as { cible?: string }).cible ?? '')) : undefined;
  return { r, fin };
}

// ------------------------------------------------------------------------------------------------ point 1
test('C4 · point 1 : seul un disque « choisissable » est une cible ; un interne (même ODIN), le système, un live : refusés', async () => {
  const ids = CC.ciblesEcrivables([CLE, INTERNE, SYSTEME_USB]).map((c) => c.id);
  assert.deepEqual(ids, ['faux-cle'], 'la même règle que l\'étape « Clé »');
  const m = monde();
  // La page « trafiquée » envoie l'interne, puis le disque du système (live) : le serveur lit SA liste et refuse.
  for (const d of [INTERNE, SYSTEME_USB]) {
    const { r } = await ecrire(m, { cible: { ...cibleDe(d), externe: true, amovible: true, systemeEnCours: false }, systemes: [ubuntu], phrase: PHRASE });
    assert.equal(r.ok, false, d.id); assert.match(r.text, /interne|système|Odin/i);
  }
  const p = await m.action('cle_place').run(m.ctx, { cible: cibleDe(INTERNE), systemes: [] });
  assert.equal(p.ok, false, 'le plan non plus');
  assert.deepEqual(tout(m.img), [], 'rien n\'est écrit');
  assert.equal(m.appels.run, 0, 'aucune commande');
});

test('C4 · point 1 : le numéro de série ou la taille changent → refus (au choix, et juste avant d\'écrire)', async () => {
  const m = monde();
  const autre = await ecrire(m, { cible: { ...cibleDe(CLE), serie: 'ZZ99ZZ99ZZ99' }, systemes: [ubuntu], phrase: PHRASE });
  assert.equal(autre.r.ok, false); assert.match(autre.r.text, /même clé/);
  const taille = await ecrire(m, { cible: { ...cibleDe(CLE), tailleOctets: CLE.tailleOctets + 1 }, systemes: [ubuntu], phrase: PHRASE });
  assert.equal(taille.r.ok, false);
  // Une autre clé prend la place APRÈS le choix (pendant que le serveur prépare) : vu juste avant le premier octet.
  let change = false;
  const m2 = monde({ disques: () => [change ? { ...CLE, serie: 'NOUVELLE1234' } : CLE], bascule: () => { change = true; } });
  const { r, fin } = await ecrire(m2, { cible: cibleDe(CLE), systemes: [ubuntu], phrase: PHRASE });
  assert.equal(r.ok, true, r.text);
  assert.equal(fin?.ok, false); assert.match(String(fin?.message), /même clé/); assert.equal(fin?.touchee, false);
  assert.deepEqual(tout(m2.img), [], 'aucun octet écrit');
  const pr = await m2.action('cle_progres').run(m2.ctx, { cible: { id: CLE.id } });
  assert.equal((pr.data as { reussi: boolean }).reussi, false);
});

// ------------------------------------------------------------------------------------------------ point 2
test('C4 · point 2 : chaque ISO vient de la bibliothèque du serveur, jamais d\'un chemin de la page', async () => {
  const m = monde();
  const piege = await ecrire(m, { cible: cibleDe(CLE), systemes: [{ nom: 'piège', fichier: '../../secret.iso', famille: 'linux', choix: 'iso' }], phrase: PHRASE });
  assert.equal(piege.r.ok, false); assert.match(piege.r.text, /bibliothèque/);
  const chemin = await ecrire(m, { cible: cibleDe(CLE), systemes: [{ nom: 'piège', iso: 'iso:inconnu', fichier: m.biblio[0].chemin, famille: 'linux', choix: 'iso' }], phrase: PHRASE });
  assert.equal(chemin.r.ok, false, 'un chemin du disque n\'est jamais lu');
  // L'orchestrateur lui-même refuse un nom avec un chemin.
  const io = E.ioSimulee();
  const r = await E.ecrireCle({ schema: 'gpt', secureBoot: true, label: 'ODIN', theme: 'bleu', texte: 'matrix', disposition: 'eventail', modeDefaut: 'graphique', delai: 5, systemes: [{ fichier: '../x.iso', nom: 'x', famille: 'Linux', mode: 'demarrer', recipe: rUbuntu }], images: [], vdisks: [], logiciels: [] }, io, E.buildersParDefaut, { cible: 'x', motDePasse: 'jetable-essai' });
  assert.equal(r.ok, false); assert.equal(io.fichiers.size, 0);
  // Le bon chemin : l'ISO copiée est celle de la bibliothèque (son contenu).
  const ok = await ecrire(m, { cible: cibleDe(CLE), systemes: [{ ...ubuntu, logiciels: [] }], phrase: PHRASE });
  assert.equal(ok.fin?.ok, true, ok.fin?.message);
  assert.equal(readFileSync(join(m.img, 'ISO/ubuntu-24.04-desktop-amd64.iso'), 'utf8'), 'ISO-UBUNTU-FAUSSE');
});

// ------------------------------------------------------------------------------------------------ point 3
test('C4 · point 3 : le plan et l\'écriture d\'accord sur Windows installé (fichier dans /vdisk) et la place réservée', async () => {
  const win = { fichier: 'win11.iso', nom: 'Windows 11', famille: 'Windows' as const, mode: 'installer' as const, recipe: rWin, choix: 'installe' as const };
  const lin = { fichier: 'ubuntu.iso', nom: 'Ubuntu', famille: 'Linux' as const, mode: 'installer' as const, recipe: rUbuntu, choix: 'installe' as const, installPartition: { tailleGo: 20 } };
  const plan = CC.planPlace({ id: 'c', genre: 'cle', tailleOctets: 128 * G, estOdin: false }, [win, lin]);
  const wtg = plan.partitions.find((p) => p.role === 'WinToGo')!;
  assert.equal(wtg.lieu, 'fichier'); assert.match(String(wtg.fichier), /^vdisk\/.+wintogo\.vhdx$/);
  assert.equal(CC.reserveGo(plan), 20, 'seul le Linux installé a une vraie partition à réserver');
  const io = E.ioSimulee();
  const r = await E.ecrireCle({ schema: 'gpt', secureBoot: true, label: 'ODIN', theme: 'bleu', texte: 'matrix', disposition: 'eventail', modeDefaut: 'graphique', delai: 5, systemes: [win, lin], images: [], vdisks: [], logiciels: [] }, io, E.buildersParDefaut, { cible: 'c', motDePasse: 'jetable-essai', plan });
  assert.equal(r.ok, true, r.message);
  assert.ok(io.fichiers.has(String(wtg.fichier)), `l'écriture pose le disque Windows là où le plan le dit (${wtg.fichier})`);
  assert.equal(io.ventoy?.reserveGo, 20);
});

// ------------------------------------------------------------------------------------------------ point 4
test('C4 · point 4 : options Windows et tes scripts écrits, disque toujours choisi à l\'installation, scripts revérifiés', async () => {
  const m = monde();
  const bon = [{ nom: 'reseau.ps1', contenu: 'Write-Host reseau' }, { nom: 'fin.sh', contenu: 'echo fin' }];
  const { fin } = await ecrire(m, { cible: cibleDe(CLE), systemes: [windows, ubuntu], phrase: PHRASE, windows: { compte: 'Famille', viePrivee: false, disque: 'vide' }, scripts: bon });
  assert.equal(fin?.ok, true, fin?.message);
  const xml = readFileSync(join(m.img, 'odin/autounattend.xml'), 'utf8');
  assert.match(xml, /<Name>Famille<\/Name>/, 'le compte de l\'étape 5');
  assert.doesNotMatch(xml, /ProtectYourPC/, 'confidentialité laissée à Windows, comme choisi');
  assert.doesNotMatch(xml, /WillWipeDisk|<InstallTo>/, 'même « disque: vide » envoyé : aucun disque effacé tout seul');
  assert.doesNotMatch(xml, /<Password>/, 'aucun mot de passe écrit');
  assert.equal(readFileSync(join(m.img, 'odin/scripts/01-reseau.ps1'), 'utf8'), 'Write-Host reseau');
  assert.match(readFileSync(join(m.img, 'odin/apres.ps1'), 'utf8'), /01-reseau\.ps1/);
  assert.match(readFileSync(join(m.img, 'odin/user-data'), 'utf8'), /01-fin\.sh/);
  // La page « trafiquée » dit qu'un script dangereux est accepté : le serveur le revoit et refuse TOUT, avant d'écrire.
  const m2 = monde();
  const pire = await ecrire(m2, { cible: cibleDe(CLE), systemes: [windows], phrase: PHRASE, scripts: [{ nom: 'menage.cmd', contenu: 'vssadmin delete shadows /all', etat: 'ok' }] });
  assert.equal(pire.fin?.ok, false); assert.match(String(pire.fin?.message), /menage\.cmd/);
  assert.deepEqual(tout(m2.img), [], 'rien n\'est écrit');
  // Sans antivirus : aucun script n'est écrit.
  const io = E.ioSimulee();
  const r = await E.ecrireCle({ schema: 'gpt', secureBoot: true, label: 'ODIN', theme: 'bleu', texte: 'matrix', disposition: 'eventail', modeDefaut: 'graphique', delai: 5, systemes: [], images: [], vdisks: [], logiciels: [] }, io, E.buildersParDefaut, { cible: 'c', motDePasse: 'jetable-essai', scripts: bon });
  assert.equal(r.ok, false); assert.match(r.message, /antivirus/); assert.equal(io.fichiers.size, 0);
});

// ------------------------------------------------------------------------------------------------ point 5
test('C4 · point 5 : chaque chemin lu par les commandes Linux existe dans l\'archive d\'injection écrite sur la clé', async () => {
  const m = monde();
  const { fin } = await ecrire(m, { cible: cibleDe(CLE), systemes: [ubuntu], phrase: PHRASE, scripts: [{ nom: 'fin.sh', contenu: 'echo fin' }] });
  assert.equal(fin?.ok, true, fin?.message);
  const ud = readFileSync(join(m.img, 'odin/user-data'), 'utf8');
  assert.doesNotMatch(ud, /\/cdrom\//, '/cdrom est l\'ISO, pas la clé');
  const archive = untar(gunzipSync(readFileSync(join(m.img, 'odin/inject-ubuntu-24.04-desktop-amd64.tar.gz'))));
  const lus = [...ud.matchAll(/(?<![\w/])\/odin\/[\w./+-]+/g)].map((x) => x[0]).filter((p) => !p.startsWith('/odin/logiciels/') || !ud.includes(`/target${p}`));
  const attendus = [...new Set(lus.filter((p) => /\.(sh|deb)$/.test(p)))];
  assert.ok(attendus.length >= 2, `script et paquet lus (${attendus.join(', ')})`);
  for (const p of attendus) assert.ok(archive.has(p.slice(1)), `${p} est dans l'archive (${[...archive.keys()].join(', ')})`);
  assert.equal(archive.get('odin/logiciels/gimp-faux.deb')?.toString(), 'DEB-FAUX', 'le vrai paquet, pris dans Hermès');
  assert.equal(archive.get('odin/scripts/01-fin.sh')?.toString(), 'echo fin');
});

// ------------------------------------------------------------------------------------------------ point 6
test('C4 · point 6 : un logiciel Windows est copié sous le même nom assaini que celui que lance le script de fin', async () => {
  const m = monde();
  const { fin } = await ecrire(m, { cible: cibleDe(CLE), systemes: [windows], phrase: PHRASE });
  assert.equal(fin?.ok, true, fin?.message);
  assert.equal(SC.nomLogicielSur('Mon App.exe'), 'Mon_App.exe');
  assert.ok(existsSync(join(m.img, 'logiciels/windows/Mon_App.exe')), tout(m.img).join(', '));
  assert.ok(!existsSync(join(m.img, 'logiciels/windows/Mon App.exe')));
  assert.match(readFileSync(join(m.img, 'odin/apres.ps1'), 'utf8'), /\\Mon_App\.exe/);
});

// ------------------------------------------------------------------------------------------------ point 7
test('C4 · point 7 : toutes les actions de la clé (lectures comprises) sont réservées au propriétaire', async () => {
  const { thjalfi } = await import('../src/valhalla/modules/thjalfi.ts');
  // (cle_windows est la clé d'ACTIVATION Windows du coffre, pas une action de la clé USB.)
  const cle = thjalfi().actions.filter((a) => a.id.startsWith('cle_') && a.id !== 'cle_windows');
  assert.ok(cle.length >= 13);
  for (const a of cle) assert.equal(a.proprietaireSeul, true, a.id);
  // Par la vraie porte : une automatisation, un membre (qui: member), la clé d'API (sans la session) : refusés.
  const { Valhalla } = await import('../src/valhalla/service.ts');
  const { setValhalla } = await import('../src/valhalla/odin.ts');
  const { valhallaPost } = await import('../src/web/valhalla-api.ts');
  const v = new Valhalla(neuf('va'), [thjalfi()]);
  await v.activer('thjalfi', true);
  v.ctx('thjalfi').saveSettings({ cleDisquesTest: [CLE] });
  const proprio = await v.act('thjalfi', 'cle_disques', {});
  assert.equal(proprio.ok, true, proprio.text);
  for (const qui of [{ qui: 'member' as const }, { auto: true }, { by: 'automatisation' as const }]) {
    const r = await v.act('thjalfi', 'cle_disques', {}, qui);
    assert.equal(r.ok, false, JSON.stringify(qui)); assert.match(r.text, /propriétaire/);
  }
  setValhalla(v);
  const api = await valhallaPost('/api/valhalla/act', { module: 'thjalfi', action: 'cle_progres', input: {} }) as { ok: boolean; code?: string };
  assert.equal(api.ok, false); assert.equal(api.code, 'proprietaire', 'la clé d\'API (sans la session du propriétaire)');
  // L'écriture : même avec la session, la porte exige d'abord la confirmation (action grave).
  const sans = await valhallaPost('/api/valhalla/act', { module: 'thjalfi', action: 'cle_preparer', input: { cible: cibleDe(CLE), phrase: PHRASE } }, { sessionProprio: true }) as { ok: boolean; confirm?: string };
  assert.equal(sans.ok, false); assert.ok(sans.confirm, 'confirmation demandée');
});

// ------------------------------------------------------------------------------------------------ point 8
test('C4 · point 8 : aucun mot de passe Linux écrit ; il est choisi à la première ouverture de session', async () => {
  const a = { host: 'h', user: 'famille', password: 'Connu-123', locale: 'fr_FR.UTF-8', keymap: 'fr', timezone: 'Indian/Mayotte', packages: [], report: 'http://127.0.0.1/x' };
  const u1 = SC.scriptsLinuxCle(a, 'ubuntu', 't')['user-data'], u2 = SC.scriptsLinuxCle(a, 'ubuntu', 't')['user-data'];
  const h = (t: string) => /password: "([^"]+)"/.exec(t)?.[1];
  assert.notEqual(h(u1), h(u2), 'un mot de passe jetable, tiré au hasard à chaque fois (jamais celui donné)');
  const { sha512crypt } = await import('../src/valhalla/thjalfi/recipes.ts');
  const sel = /^\$6\$([^$]+)\$/.exec(String(h(u1)))?.[1] ?? '';
  assert.notEqual(sha512crypt('Connu-123', sel), h(u1), 'l\'empreinte n\'est pas celle du mot de passe donné');
  for (const [nom, t] of [['ubuntu', u1], ['debian', SC.scriptsLinuxCle(a, 'debian', 't')['preseed.cfg']], ['rhel', SC.scriptsLinuxCle(a, 'rhel', 't')['ks.cfg']]] as const) {
    assert.match(t, /passwd -d famille/, `${nom} : mot de passe retiré à la fin`);
    assert.match(t, /chage -d 0 famille/, `${nom} : à choisir à la première ouverture de session`);
    assert.ok(!t.includes('Connu-123'), nom);
  }
});

// ------------------------------------------------------------------------------------------------ la phrase, l'écriture, l'image
test('C4 · la phrase exacte est vérifiée par le serveur : sans elle, ou fausse, rien n\'est écrit', async () => {
  const m = monde();
  for (const phrase of [undefined, '', 'effacer la clé 64 go', 'oui']) {
    const { r } = await ecrire(m, { cible: cibleDe(CLE), systemes: [ubuntu], ...(phrase === undefined ? {} : { phrase }) });
    assert.equal(r.ok, false, String(phrase)); assert.match(r.text, /Phrase incorrecte.*effacer la clé 58 go/);
  }
  assert.deepEqual(tout(m.img), []);
  assert.equal(X.phraseAttendue(CLE, true), PHRASE);
  assert.equal(X.phraseAttendue({ ...CLE, estOdin: true }, false), 'écrire sur la clé 58 go');
  assert.equal(X.phraseNormale('  Effacer  la CLE 58 Go '), X.phraseNormale(PHRASE), 'majuscules, accents et espaces ne comptent pas');
  const place = await m.action('cle_place').run(m.ctx, { cible: cibleDe(CLE), systemes: [] });
  assert.equal((place.data as { phrase: string }).phrase, PHRASE, 'la page reçoit la phrase du serveur');
});

test('C4 · l\'image écrite sur le faux disque contient ce qui a été choisi (ISO, logiciels, réponses, scripts, menu) ; étapes nommées', async () => {
  const m = monde();
  const r = await m.action('cle_preparer').run(m.ctx, { cible: cibleDe(CLE), systemes: [windows, ubuntu], phrase: PHRASE, windows: { compte: 'Famille' }, scripts: [{ nom: 'a.ps1', contenu: 'Write-Host a' }] });
  assert.equal(r.ok, true, r.text);
  const fin = await X.attendreEcriture(CLE.id);
  assert.equal(fin.ok, true, fin.message);
  const f = tout(m.img);
  for (const n of ['ISO/Win11_Pro_24H2_French_x64.iso', 'ISO/ubuntu-24.04-desktop-amd64.iso', 'logiciels/windows/Mon_App.exe', 'logiciels/linux/gimp-faux.deb', 'odin/autounattend.xml', 'odin/apres.ps1', 'odin/scripts/01-a.ps1', 'odin/user-data', 'ventoy/ventoy.json', 'ventoy/odin-chargeur-essai.json'])
    assert.ok(f.includes(n), `${n} (${f.join(', ')})`);
  const vj = JSON.parse(readFileSync(join(m.img, 'ventoy/ventoy.json'), 'utf8'));
  assert.ok(vj.auto_install.some((x: { image: string }) => x.image === '/ISO/Win11_Pro_24H2_French_x64.iso'));
  assert.match(readFileSync(join(m.img, 'ventoy/odin-chargeur-essai.json'), 'utf8'), /aucun vrai chargeur/);
  const p = (await m.action('cle_progres').run(m.ctx, { cible: { id: CLE.id } })).data as { pct: number; phase: string; phases: string[]; reussi: boolean; touchee: boolean };
  assert.equal(p.pct, 100); assert.equal(p.reussi, true); assert.equal(p.touchee, true);
  assert.deepEqual(p.phases, ['verifier', 'chargeur', 'systemes', 'logiciels', 'installes', 'menu', 'scripts', 'controle']);
  assert.equal(m.appels.run, 0, 'aucune commande lancée');
});

// ------------------------------------------------------------------------------------------------ annuler, éjecter
test('C4 · annuler : avant le premier octet, rien n\'est touché ; après, la clé est dite « déjà touchée »', async () => {
  const m = monde();
  const r = await m.action('cle_preparer').run(m.ctx, { cible: cibleDe(CLE), systemes: [ubuntu], phrase: PHRASE });
  assert.equal(r.ok, true, r.text);
  const a = await m.action('cle_annuler').run(m.ctx, { cible: { id: CLE.id } });
  assert.equal(a.ok, true); assert.match(a.text, /rien n'avait encore été écrit/);
  const fin = await X.attendreEcriture(CLE.id);
  assert.equal(fin.ok, false); assert.match(fin.message, /annulée/); assert.equal(fin.touchee, false);
  assert.deepEqual(tout(m.img), []);
  // Après le premier octet : l'IO s'arrête au fichier suivant, la clé est dite touchée.
  let stop = false, copies = 0;
  const io = E.ioSimulee();
  const copier = io.copier.bind(io); io.copier = async (s, d) => { copies++; stop = true; return copier(s, d); }; io.annule = () => stop;
  const r2 = await E.ecrireCle({ schema: 'gpt', secureBoot: true, label: 'ODIN', theme: 'bleu', texte: 'matrix', disposition: 'eventail', modeDefaut: 'graphique', delai: 5, systemes: [{ fichier: 'a.iso', nom: 'A', famille: 'Linux', mode: 'demarrer', recipe: rUbuntu }, { fichier: 'b.iso', nom: 'B', famille: 'Linux', mode: 'demarrer', recipe: rUbuntu }], images: [], vdisks: [], logiciels: [] }, io, E.buildersParDefaut, { cible: 'c', motDePasse: 'jetable-essai' });
  assert.equal(r2.ok, false); assert.equal(r2.touchee, true); assert.equal(copies, 1, 'arrêt au fichier suivant');
  assert.equal((await m.action('cle_annuler').run(m.ctx, { cible: { id: 'aucune' } })).ok, false, 'rien à annuler');
});

test('C4 · éjecter : la même clé, pas pendant l\'écriture, jamais un interne ; aucune commande en essai', async () => {
  const m = monde();
  const ok = await m.action('cle_ejecter').run(m.ctx, { cible: cibleDe(CLE) });
  assert.equal(ok.ok, true, ok.text); assert.match(ok.text, /éjectée/);
  assert.equal((await m.action('cle_ejecter').run(m.ctx, { cible: cibleDe(INTERNE) })).ok, false);
  assert.equal((await m.action('cle_ejecter').run(m.ctx, { cible: { ...cibleDe(CLE), serie: 'AUTRE0000000' } })).ok, false);
  const r = await m.action('cle_preparer').run(m.ctx, { cible: cibleDe(CLE), systemes: [ubuntu], phrase: PHRASE });
  assert.equal(r.ok, true);
  const pendant = await m.action('cle_ejecter').run(m.ctx, { cible: cibleDe(CLE) });
  await X.attendreEcriture(CLE.id);
  assert.equal(pendant.ok, false); assert.match(pendant.text, /pas finie/);
  assert.equal(m.appels.run, 0, 'aucune commande');
});

test('C4 · un dossier « faux disque » n\'écrit jamais au-dessus de sa racine', async () => {
  const parent = neuf('parent'), racine = join(parent, 'partition-odin'); mkdirSync(racine, { recursive: true });
  const io = X.ioDossier(racine, { chargeur: 'simule' });
  for (const d of ['../dehors.txt', 'a/../../dehors.txt', '/abs.txt', 'C:/x.txt', '']) await assert.rejects(io.ecrire(d, 'x'), /refusé/, d);
  assert.deepEqual(tout(parent), [], 'rien au-dessus de la racine');
  // Hors essai (chargeur gardé) : jamais d'installation sur une clé neuve.
  const vrai = X.ioDossier(racine, { chargeur: 'garder' });
  await assert.rejects(vrai.installerVentoy('c', E.descripteurVentoy(), { schema: 'gpt', secureBoot: true, miseAJour: false }), /pas encore branché/);
});
