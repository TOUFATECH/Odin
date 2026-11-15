// La bibliothèque commune (src/valhalla/forge/bibliotheque.ts) : le même code pour les ISO (Andromède, Hydre) et
// pour les logiciels (Hermès). Un dossier réglé, scanné (tout fichier du bon genre, même déposé à la main, entre
// dans la bibliothèque après l'antivirus), une fiche complète, les mises à jour avec l'ancienne version dans
// « old » (une seule gardée), et la vérification planifiée (mensuelle par défaut, replanifiable).
// Faux sites, fausses ISO et faux installateurs (petits fichiers) ; aucun téléchargement réel.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { DEFAULT_CONFIG } from '../src/config.ts';
import { iconeType, lirePlan, logoSysteme, PLAN_DEFAUT, prochaineVerif, verifDue, type Fiche } from '../src/valhalla/forge/bibliotheque.ts';
import { rangerOld } from '../src/valhalla/forge/forge.ts';
import { infoPe, MOTIF_LOGICIEL, viseDuNom } from '../src/valhalla/forge/logiciels.ts';
import { ISO } from '../src/valhalla/forge/sources.ts';
import { allModules } from '../src/valhalla/odin.ts';
import { Valhalla } from '../src/valhalla/service.ts';

const sha = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');
type Alerte = { level: string; title: string; detail?: string };

function monde() {
  const home = mkdtempSync(join(tmpdir(), 'odin-biblio-')), routes = new Map<string, string | Buffer>(), alertes: Alerte[] = [];
  const fetchFn = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = String(input instanceof Request ? input.url : input), body = routes.get(url); if (body === undefined) return new Response('introuvable', { status: 404 });
    const buf = Buffer.isBuffer(body) ? body : Buffer.from(body), range = /bytes=(\d+)-/.exec(String((init?.headers as Record<string, string> | undefined)?.range ?? ''));
    return range ? new Response(buf.subarray(Number(range[1])), { status: 206 }) : new Response(buf, { status: 200, headers: { 'content-length': String(buf.length) } });
  };
  const v = new Valhalla(home, allModules({ paths: { home, workspace: home }, cfg: DEFAULT_CONFIG } as never), { run: async () => ({ code: 1, out: '', err: '' }), fetch: fetchFn as typeof fetch, notify: async () => {}, autonomy: () => 'equilibre' });
  v.events.on('alert', (a: Alerte) => alertes.push(a));
  return { v, home, routes, alertes, iso: join(home, 'nas', 'iso'), log: join(home, 'nas', 'logiciels'), fin: () => { v.stop(); rmSync(home, { recursive: true, force: true }); } };
}

/** Un programme Windows minimal avec ses ressources : informations de version et une icône (PNG). Rien d'exécutable. */
function fauxExe(o: { editeur: string; produit: string; version: string }): Buffer {
  const u = (t: string) => Buffer.from(t, 'utf16le');
  const icone = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.from('fausse image')]);
  const groupe = Buffer.alloc(20); groupe.writeUInt16LE(1, 2); groupe.writeUInt16LE(1, 4); groupe.writeUInt16LE(1, 10); groupe.writeUInt16LE(32, 12); groupe.writeUInt32LE(icone.length, 14); groupe.writeUInt16LE(1, 18);
  const version = Buffer.concat([['CompanyName', o.editeur], ['ProductName', o.produit], ['ProductVersion', o.version], ['FileDescription', `Installation de ${o.produit}`]].flatMap(([k, val]) => [u(`${k}\0`), Buffer.alloc(2), u(`${val}\0`), Buffer.alloc(2)]));
  const blobs = [icone, groupe, version], types = [3, 14, 16], tete = 40 + 3 * 64, res = Buffer.alloc(tete);
  res.writeUInt16LE(3, 14); let pos = tete;
  types.forEach((t, i) => {
    const nom = 40 + i * 64, lang = nom + 24, de = lang + 24;
    res.writeUInt32LE(t, 16 + i * 8); res.writeUInt32LE((nom | 0x80000000) >>> 0, 20 + i * 8);
    res.writeUInt16LE(1, nom + 14); res.writeUInt32LE(1, nom + 16); res.writeUInt32LE((lang | 0x80000000) >>> 0, nom + 20);
    res.writeUInt16LE(1, lang + 14); res.writeUInt32LE(1033, lang + 16); res.writeUInt32LE(de, lang + 20);
    res.writeUInt32LE(0x1000 + pos, de); res.writeUInt32LE(blobs[i].length, de + 4); pos += blobs[i].length;
  });
  const rsrc = Buffer.concat([res, ...blobs]), h = Buffer.alloc(512);
  h.write('MZ', 0, 'latin1'); h.writeUInt32LE(64, 0x3c); h.write('PE\0\0', 64, 'latin1'); h.writeUInt16LE(0x14c, 68); h.writeUInt16LE(1, 70); h.writeUInt16LE(224, 84);
  h.writeUInt16LE(0x10b, 88); h.writeUInt32LE(0x1000, 88 + 96 + 16); h.writeUInt32LE(rsrc.length, 88 + 96 + 20);
  h.write('.rsrc', 312, 'latin1'); h.writeUInt32LE(rsrc.length, 320); h.writeUInt32LE(0x1000, 324); h.writeUInt32LE(rsrc.length, 328); h.writeUInt32LE(512, 332);
  return Buffer.concat([h, rsrc]);
}

test('outils purs : plan de vérification (mensuel par défaut), rangement « old », type d\'installateur, logos génériques', () => {
  assert.deepEqual(PLAN_DEFAUT, { frequence: 'mois', jour: 1, heure: '04:00' });
  const nov = new Date('2026-11-15T10:00:00');
  assert.equal(prochaineVerif(PLAN_DEFAUT, nov).toString(), new Date('2026-12-01T04:00:00').toString(), 'le 1er du mois suivant');
  assert.equal(prochaineVerif({ frequence: 'semaine', jour: 3, heure: '06:30' }, nov).toString(), new Date('2026-11-18T06:30:00').toString(), 'mercredi');
  assert.equal(prochaineVerif({ frequence: 'jour', jour: 1, heure: '23:00' }, nov).toString(), new Date('2026-11-15T23:00:00').toString());
  assert.ok(!verifDue(PLAN_DEFAUT, nov) && verifDue(PLAN_DEFAUT, new Date('2026-12-01T04:00:30')), 'jamais faite : au premier passage prévu');
  const faite = { ...PLAN_DEFAUT, derniere: new Date('2026-12-01T04:01:00').getTime() };
  assert.ok(!verifDue(faite, new Date('2026-12-20T12:00:00')) && verifDue(faite, new Date('2027-01-01T04:00:01')), 'puis un mois plus tard, pas avant');
  assert.deepEqual(lirePlan({ frequence: 'semaine', jour: 9, heure: '6:30' }, PLAN_DEFAUT), { frequence: 'semaine', jour: 6, heure: '06:30' });
  assert.deepEqual(lirePlan({ frequence: 'n\'importe', heure: 'midi' }, PLAN_DEFAUT), PLAN_DEFAUT, 'un réglage mal écrit ne casse rien');
  // « old » : l'ancienne part dans old ; s'il y en a déjà une, la plus vieille est supprimée.
  const d = mkdtempSync(join(tmpdir(), 'odin-old-')), src = ISO.find((x) => x.id === 'ubuntu')!;
  try {
    mkdirSync(join(d, 'Ubuntu', 'old'), { recursive: true });
    const f = (v: string, dir = join(d, 'Ubuntu')) => { const p = join(dir, `ubuntu-${v}-desktop-amd64.iso`); writeFileSync(p, v); return { source: src, version: v, path: p, size: 1, mtime: 0 }; };
    f('24.04.1', join(d, 'Ubuntu', 'old'));
    const n = f('24.04.3'), a = f('24.04.2'), r = rangerOld([n, a], n.path, src);
    assert.deepEqual(r.deplacer, [{ de: a.path, vers: join(d, 'Ubuntu', 'old', 'ubuntu-24.04.2-desktop-amd64.iso') }]);
    assert.deepEqual(r.supprimer.map((x) => x.version), ['24.04.1'], 'une seule ancienne version gardée');
  } finally { rmSync(d, { recursive: true, force: true }); }
  for (const n of ['a.exe', 'a.msi', 'a.msix', 'a.dmg', 'a.pkg', 'a.deb', 'a.rpm', 'a.AppImage', 'a.apk', 'a.zip']) assert.ok(MOTIF_LOGICIEL.test(n), n);
  assert.ok(!MOTIF_LOGICIEL.test('notes.txt') && !MOTIF_LOGICIEL.test('image.iso'));
  assert.deepEqual([viseDuNom('a.msi'), viseDuNom('a.dmg'), viseDuNom('a.deb'), viseDuNom('a.rpm'), viseDuNom('a.apk')], ['Windows', 'macOS', 'Linux (Debian, Ubuntu)', 'Linux (Fedora, Rocky)', 'Android']);
  const logos = [{ systeme: 'Windows' }, { systeme: 'macOS' }, { systeme: 'Linux', distribution: 'Ubuntu' }, { systeme: 'Linux', distribution: 'Debian' }, { systeme: 'Linux', distribution: 'Fedora' }, { systeme: 'Linux', distribution: 'Arch Linux' }, { systeme: 'Autre' }].map((x) => logoSysteme(x));
  assert.ok(logos.every((l) => l.startsWith('data:image/svg+xml;base64,')) && new Set(logos).size === logos.length, 'un petit logo dessiné par famille');
  assert.ok(iconeType('a.deb') !== iconeType('a.exe') && iconeType('a.exe').startsWith('data:image/svg+xml;base64,'));
});

test('ressources d\'un programme Windows : éditeur, produit, version et icône lus dans le fichier, sans rien exécuter', () => {
  const d = mkdtempSync(join(tmpdir(), 'odin-pe-'));
  try {
    const f = join(d, 'MonOutil-2.3.1-x64.exe'); writeFileSync(f, fauxExe({ editeur: 'TOUFATECH', produit: 'Mon Outil', version: '2.3.1.0' }));
    const i = infoPe(f)!;
    assert.deepEqual([i.editeur, i.produit, i.version, i.description], ['TOUFATECH', 'Mon Outil', '2.3.1.0', 'Installation de Mon Outil']);
    assert.match(i.icone!, /^data:image\/png;base64,iVBORw0KGg/);
    writeFileSync(join(d, 'texte.exe'), 'pas un programme'); assert.equal(infoPe(join(d, 'texte.exe')), undefined);
    writeFileSync(join(d, 'court.exe'), 'MZ'); assert.equal(infoPe(join(d, 'court.exe')), undefined);
    assert.equal(infoPe(join(d, 'absent.exe')), undefined);
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('Hermès : le dossier des logiciels est scanné (installateurs déposés à la main), fiche complète, vérification mensuelle replanifiable', async () => {
  const w = monde();
  try {
    mkdirSync(join(w.log, 'Bureau'), { recursive: true });
    assert.match((await w.v.act('fjalar', 'dossier', { chemin: w.log })).text, /logiciels/);
    writeFileSync(join(w.log, 'MonOutil-2.3.1-x64.exe'), fauxExe({ editeur: 'TOUFATECH', produit: 'Mon Outil', version: '2.3.1.0' }));
    writeFileSync(join(w.log, 'Bureau', 'paquet_1.2.3_amd64.deb'), 'paquet debian'); writeFileSync(join(w.log, 'Appli-4.5.dmg'), 'image mac'); writeFileSync(join(w.log, 'jeu-1.0.apk'), 'appli android');
    writeFileSync(join(w.log, 'notes.txt'), 'pas un installateur'); writeFileSync(join(w.log, '.cache.exe'), 'caché');
    // Avant le scan : vus dans le dossier, pas encore analysés.
    const B = async () => ((await w.v.act('fjalar', 'bibliotheque_logiciels')).data as { dossier: string; fichiers: Fiche[] });
    const l0 = (await B()).fichiers;
    assert.deepEqual(l0.map((f) => f.nom).sort(), ['Appli-4.5.dmg', 'MonOutil-2.3.1-x64.exe', 'jeu-1.0.apk', 'paquet_1.2.3_amd64.deb']);
    assert.ok(l0.every((f) => f.antivirus?.verdict === 'non analysé' && f.origine === 'déposée'));
    // Le scan (un fichier par passage) : antivirus d'abord, puis la fiche.
    const veille = w.v.module('fjalar')!.watch!; for (let k = 0; k < 4; k++) await veille.run(w.v.ctx('fjalar'));
    const l = (await B()).fichiers, exe = l.find((f) => f.nom === 'MonOutil-2.3.1-x64.exe')!;
    assert.ok(l.every((f) => f.antivirus?.verdict === 'sain' && /^[a-f0-9]{64}$/.test(f.sha256 ?? '')), 'tous analysés, empreinte calculée');
    assert.deepEqual([exe.produit, exe.editeurNom, exe.version, exe.vise, exe.arch], ['Mon Outil', 'TOUFATECH', '2.3.1.0', 'Windows', 'x86_64']); assert.match(exe.icone!, /^data:image\/png/, 'icône extraite du fichier');
    assert.deepEqual([l.find((f) => f.nom.endsWith('.deb'))!.vise, l.find((f) => f.nom.endsWith('.dmg'))!.vise, l.find((f) => f.nom.endsWith('.apk'))!.vise], ['Linux (Debian, Ubuntu)', 'macOS', 'Android']);
    assert.match(l.find((f) => f.nom.endsWith('.deb'))!.icone!, /^data:image\/svg/, 'icône générique par type');
    // La fiche complète.
    const fiche = (await w.v.act('fjalar', 'fiche_logiciel', { nom: 'MonOutil' })).text;
    for (const re of [/📦 MonOutil-2\.3\.1-x64\.exe/, /Logiciel : Mon Outil · éditeur TOUFATECH · version 2\.3\.1\.0 · pour Windows \(x86_64\)/, /Taille : .* · ajouté le /, /Liens : .*origine déposé dans le dossier/, new RegExp(`Empreinte SHA-256 : ${exe.sha256}`), /Antivirus : sain \(/, /Dernière vérification : jamais/, /Installé sur : aucune/]) assert.match(fiche, re);
    // La page : onglet « Logiciels » avec les cartes (icône) et le dossier.
    const vue = await w.v.module('fjalar')!.view(w.v.ctx('fjalar'), new URLSearchParams());
    assert.deepEqual(vue.onglets, ['Logiciels', 'Mises à jour']);
    const cartes = vue.sections.find((s) => s.kind === 'cards' && s.title === 'Bibliothèque (4)') as { items: Array<{ title: string; icon?: string; badge?: string }> };
    assert.ok(cartes.items.every((c) => c.icon?.startsWith('data:image/') && c.badge === 'sain'));
    assert.ok(vue.sections.some((s) => s.title === 'Dossier des logiciels') && vue.sections.some((s) => s.title === 'Vérification de toute la bibliothèque'));
    // Vérification : mensuelle par défaut, replanifiable ; compte rendu (notification + historique) ; un fichier abîmé se voit.
    assert.deepEqual((({ frequence, jour, heure }) => ({ frequence, jour, heure }))((await w.v.act('fjalar', 'plan_verification_logiciels')).data as { frequence: string; jour: number; heure: string }), { frequence: 'mois', jour: 1, heure: '04:00' });
    assert.match((await w.v.act('fjalar', 'verification_logiciels', { frequence: 'semaine', jour: 3, heure: '6:30' })).text, /chaque semaine \(mercredi\) à 06:30\. Prochaine : /);
    writeFileSync(join(w.log, 'Appli-4.5.dmg'), 'image mac modifiée');
    const r = await w.v.act('fjalar', 'verifier_logiciels');
    assert.match(r.text, /Vérification de 4 logiciels : 3 sain\(s\), 1 abîmé\(s\)\./); assert.match(r.text, /❌ Appli-4\.5\.dmg : empreinte changée : fichier abîmé ou modifié/); assert.match(r.text, /✔ MonOutil-2\.3\.1-x64\.exe : empreinte identique, antivirus : rien trouvé/);
    assert.ok(w.alertes.some((a) => a.title === 'Hermès : vérification des logiciels (4)' && a.level === 'haute'));
    assert.match((await w.v.act('fjalar', 'comptes_rendus')).text, /Vérification de 4 logiciels/);
    assert.match((await w.v.act('fjalar', 'fiche_logiciel', { nom: 'MonOutil' })).text, /Dernière vérification : .* · empreinte identique/);
    assert.ok(((await w.v.act('fjalar', 'plan_verification_logiciels')).data as { derniere?: number }).derniere! > Date.now() - 60_000, 'la date du dernier passage est gardée');
  } finally { w.fin(); }
});

test('Hermès : la mise à jour d\'un logiciel présent passe par l\'antivirus, remplace l\'ancienne, qui va dans « old » (une seule gardée)', async () => {
  const w = monde();
  try {
    mkdirSync(w.log, { recursive: true }); await w.v.act('fjalar', 'dossier', { chemin: w.log });
    writeFileSync(join(w.log, '7z2408-x64.exe'), 'ancien 7zip');
    const publier = (tag: string, fichier: string, contenu: Buffer) => { w.routes.set('https://api.github.com/repos/ip7z/7zip/releases/latest', JSON.stringify({ tag_name: tag, html_url: 'h', assets: [{ name: fichier, browser_download_url: `https://github.com/ip7z/7zip/releases/download/${tag}/${fichier}`, size: contenu.length, digest: `sha256:${sha(contenu)}` }] })); w.routes.set(`https://github.com/ip7z/7zip/releases/download/${tag}/${fichier}`, contenu); };
    const v1 = Buffer.from(`MZ${'propre'.repeat(500)}`), v2 = Buffer.from(`MZ${'encore propre'.repeat(500)}`);
    publier('25.01', '7z2501-x64.exe', v1);
    assert.match((await w.v.act('fjalar', 'mettre_a_jour')).text, /✅ 7-Zip 2501 .*empreinte vérifiée/);
    assert.deepEqual(readdirSync(join(w.log, '7-Zip')).sort(), ['7z2501-x64.exe', 'old']); assert.deepEqual(readdirSync(join(w.log, '7-Zip', 'old')), ['7z2408-x64.exe']);
    publier('26.00', '7z2600-x64.exe', v2);
    assert.match((await w.v.act('fjalar', 'mettre_a_jour')).text, /✅ 7-Zip 2600 .* · retiré : 2408/);
    assert.deepEqual(readdirSync(join(w.log, '7-Zip')).sort(), ['7z2600-x64.exe', 'old']); assert.deepEqual(readdirSync(join(w.log, '7-Zip', 'old')), ['7z2501-x64.exe'], 'une seule ancienne version gardée');
    assert.ok(!existsSync(join(w.log, '7z2408-x64.exe')));
    // La bibliothèque : la nouvelle avec sa fiche (lien d'origine, empreinte de l'éditeur vérifiée), l'ancienne marquée.
    const l = ((await w.v.act('fjalar', 'bibliotheque_logiciels')).data as { fichiers: Fiche[] }).fichiers;
    const neuve = l.find((f) => f.nom === '7z2600-x64.exe')!, vieille = l.find((f) => f.nom === '7z2501-x64.exe')!;
    assert.deepEqual([neuve.origine, neuve.source, neuve.editeur, neuve.sha256, neuve.antivirus?.verdict, neuve.ancienne], ['hermes', 'https://github.com/ip7z/7zip/releases/download/26.00/7z2600-x64.exe', true, sha(v2), 'sain', false]);
    assert.equal(vieille.ancienne, true); assert.equal(vieille.sha256, sha(v1), 'sa fiche l\'a suivie dans « old »');
    assert.match((await w.v.act('fjalar', 'fiche_logiciel', { nom: '7z2600' })).text, /identique à celle publiée par l'éditeur/);
    const h = (await w.v.act('fjalar', 'historique', { n: 50 })).text;
    assert.ok(h.includes('rangé dans old · 7-Zip') && h.includes('supprimé · 7-Zip 2408'));
  } finally { w.fin(); }
});

test('ISO : l\'espace ISO est scanné (ISO déposées à la main), fiche complète, vérification mensuelle par défaut et replanifiable', async () => {
  const w = monde();
  try {
    mkdirSync(join(w.iso, 'Linux'), { recursive: true }); await w.v.act('eitri', 'dossier', { chemin: w.iso });
    writeFileSync(join(w.iso, 'Linux', 'ubuntu-24.04.3-live-server-amd64.iso'), 'fausse ubuntu'); writeFileSync(join(w.iso, 'Win11_24H2_French_x64.iso'), 'faux windows'); writeFileSync(join(w.iso, 'lisez-moi.txt'), 'pas une ISO');
    const B = async () => ((await w.v.act('ymir', 'bibliotheque_iso')).data as { dossier: string; isos: Fiche[] });
    const b0 = await B(); assert.equal(b0.dossier, w.iso, 'Hydre lit l\'emplacement réglé dans Andromède');
    assert.deepEqual(b0.isos.map((f) => `${f.nom}:${f.systeme}:${f.antivirus?.verdict}`).sort(), ['Win11_24H2_French_x64.iso:Windows:non analysé', 'ubuntu-24.04.3-live-server-amd64.iso:Linux:non analysé']);
    // Le scan (surveillance d'Hydre) : chaque ISO passe par l'antivirus et reçoit sa fiche.
    const veille = w.v.module('ymir')!.watch!; await veille.run(w.v.ctx('ymir')); await veille.run(w.v.ctx('ymir'));
    const l = (await B()).isos; assert.ok(l.every((f) => f.antivirus?.verdict === 'sain' && f.sha256 === sha(f.systeme === 'Linux' ? 'fausse ubuntu' : 'faux windows')));
    const u = l.find((f) => f.systeme === 'Linux')!;
    assert.deepEqual([u.detail, u.distribution, u.version, u.arch, u.edition], ['Ubuntu Server 24.04.3', 'Ubuntu Server', '24.04.3', 'x86_64', 'serveur']); assert.match(u.icone!, /^data:image\/svg/);
    // Une ISO déposée ensuite apparaît au scan suivant.
    writeFileSync(join(w.iso, 'debian-13.2.0-amd64-netinst.iso'), 'fausse debian'); await veille.run(w.v.ctx('ymir'));
    assert.equal((await B()).isos.find((f) => /debian/.test(f.nom))!.antivirus?.verdict, 'sain');
    // La fiche montre tout.
    const fiche = (await w.v.act('ymir', 'fiche_iso', { iso: 'ubuntu-24.04.3' })).text;
    for (const re of [/📀 ubuntu-24\.04\.3-live-server-amd64\.iso/, /Système : Linux · Ubuntu Server 24\.04\.3 · version 24\.04\.3 · x86_64 · serveur/, /Taille : .* · ajoutée le /, /Source : /, /Empreinte SHA-256 : [a-f0-9]{64}/, /Antivirus : sain \(/, /Dernière vérification : jamais/, /Machines qui l'utilisent : aucune/]) assert.match(fiche, re);
    // L'onglet « ISO » d'Andromède : emplacement, bibliothèque, vérification.
    const vue = await w.v.module('eitri')!.view(w.v.ctx('eitri'), new URLSearchParams());
    assert.deepEqual(vue.onglets, ['ISO', 'Mises à jour']);
    assert.ok(vue.sections.some((s) => s.title === 'Emplacement des ISO (espace ISO, commun avec Hydre)') && vue.sections.some((s) => s.title === 'Bibliothèque (3 ISO)') && vue.sections.some((s) => s.title === 'Vérification de toutes les ISO'));
    // Vérification : mensuelle par défaut ; replanifiée depuis Andromède, relue par Hydre (un seul réglage).
    const plan = async () => (({ frequence, jour, heure }) => ({ frequence, jour, heure }))((await w.v.act('ymir', 'plan_verif_iso')).data as { frequence: string; jour: number; heure: string });
    assert.deepEqual(await plan(), { frequence: 'mois', jour: 1, heure: '04:00' });
    assert.match((await w.v.act('eitri', 'verification_iso', { frequence: 'mois', jour: 15, heure: '02:00' })).text, /chaque mois \(le 15\) à 02:00\. Prochaine : /);
    assert.deepEqual(await plan(), { frequence: 'mois', jour: 15, heure: '02:00' });
    // Le passage : empreinte recalculée (fichier abîmé ?), antivirus, compte rendu.
    writeFileSync(join(w.iso, 'Win11_24H2_French_x64.iso'), 'faux windows abîmé');
    const r = await w.v.act('eitri', 'verifier_isos');
    assert.match(r.text, /Vérification de 3 ISO : 2 sain\(s\), 1 abîmé\(s\)\./); assert.match(r.text, /❌ Win11_24H2_French_x64\.iso : empreinte changée/); assert.match(r.text, /✔ debian-13\.2\.0-amd64-netinst\.iso : empreinte identique, antivirus : rien trouvé/);
    assert.ok(w.alertes.some((a) => a.title === 'Hydre : vérification des ISO (3)'));
    assert.match((await w.v.act('ymir', 'comptes_rendus_iso')).text, /Vérification de 3 ISO/);
    assert.match((await w.v.act('ymir', 'fiche_iso', { iso: 'debian-13.2.0' })).text, /Dernière vérification : .* · empreinte identique/);
  } finally { w.fin(); }
});

test('Andromède : une nouvelle version remplace l\'ancienne, qui va dans « old » (une seule gardée) ; la machine d\'Hydre qui la citait suit', async () => {
  const w = monde();
  try {
    mkdirSync(join(w.iso, 'Ubuntu'), { recursive: true }); await w.v.act('eitri', 'dossier', { chemin: w.iso });
    const vieux = join(w.iso, 'Ubuntu', 'ubuntu-24.04.2-desktop-amd64.iso'); writeFileSync(vieux, 'ubuntu 24.04.2');
    // Une machine d'Hydre créée avec cette ISO.
    const md = join(w.home, 'valhalla', 'ymir', 'machines'); mkdirSync(md, { recursive: true });
    writeFileSync(join(md, 'machines.json'), JSON.stringify([{ id: 'aa11', nom: 'ubuntu-bureau', genre: 'vm', systeme: 'Ubuntu', version: '24.04.2', famille: 'Linux', cpu: 2, ram: 2048, disque: 32, ip: '10.0.3.50', mac: '02:0d:1e:00:00:09', cree: 1, iso: vieux, apps: [], paquets: [] }]));
    const publier = (v: string, contenu: Buffer) => { w.routes.set('https://releases.ubuntu.com/', `<a href="${v}/">${v}/</a>`); w.routes.set(`https://releases.ubuntu.com/${v}/SHA256SUMS`, `${sha(contenu)} *ubuntu-${v}-desktop-amd64.iso\n`); w.routes.set(`https://releases.ubuntu.com/${v}/ubuntu-${v}-desktop-amd64.iso`, contenu); };
    const iso3 = Buffer.alloc(120_000, 3), iso4 = Buffer.alloc(90_000, 4);
    publier('24.04.3', iso3);
    assert.match((await w.v.act('eitri', 'mettre_a_jour')).text, /✅ Ubuntu \(bureau, LTS\) 24\.04\.3 .*empreinte vérifiée/);
    const dansOld = join(w.iso, 'Ubuntu', 'old', 'ubuntu-24.04.2-desktop-amd64.iso');
    assert.ok(existsSync(dansOld) && !existsSync(vieux) && existsSync(join(w.iso, 'Ubuntu', 'ubuntu-24.04.3-desktop-amd64.iso')));
    // La machine n'est pas cassée : son chemin suit l'ISO dans « old », et tu es prévenu.
    const machine = async () => ((await w.v.act('ymir', 'locales')).data as Array<{ nom: string; iso: string }>)[0];
    assert.equal((await machine()).iso, dansOld);
    assert.ok(w.alertes.some((a) => a.title === 'Hydre : ISO remplacée par une nouvelle version' && /ubuntu-bureau : son ISO a été rangée dans « old »/.test(a.detail ?? '')));
    // La nouvelle a sa fiche (lien d'origine, empreinte de l'éditeur) ; l'ancienne est marquée.
    const isos = async () => ((await w.v.act('ymir', 'bibliotheque_iso')).data as { isos: Array<Fiche & { vms?: string[] }> }).isos;
    const l = await isos(), neuve = l.find((f) => /24\.04\.3/.test(f.nom))!, ancienne = l.find((f) => /24\.04\.2/.test(f.nom))!;
    assert.deepEqual([neuve.source, neuve.editeur, neuve.sha256, neuve.antivirus?.verdict, neuve.ancienne], ['https://releases.ubuntu.com/24.04.3/ubuntu-24.04.3-desktop-amd64.iso', true, sha(iso3), 'sain', false]);
    assert.equal(ancienne.ancienne, true); assert.deepEqual(ancienne.vms, ['ubuntu-bureau']);
    // Encore une version : 24.04.3 va dans « old », 24.04.2 (la plus vieille) est supprimée ; la machine cite la nouvelle.
    publier('24.04.4', iso4);
    assert.match((await w.v.act('eitri', 'telecharger', { nom: 'ubuntu' })).text, /24\.04\.4 .* · retiré : 24\.04\.2/);
    assert.deepEqual(readdirSync(join(w.iso, 'Ubuntu')).sort(), ['old', 'ubuntu-24.04.4-desktop-amd64.iso']); assert.deepEqual(readdirSync(join(w.iso, 'Ubuntu', 'old')), ['ubuntu-24.04.3-desktop-amd64.iso']);
    assert.equal((await machine()).iso, join(w.iso, 'Ubuntu', 'ubuntu-24.04.4-desktop-amd64.iso'));
    assert.deepEqual((await isos()).map((f) => `${f.nom}:${f.ancienne}`).sort(), ['ubuntu-24.04.3-desktop-amd64.iso:true', 'ubuntu-24.04.4-desktop-amd64.iso:false']);
    // Une nouvelle version infectée ne remplace rien : elle part en quarantaine, l'ancienne reste en place.
    const pire = Buffer.from('X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*'); publier('24.04.5', pire);
    assert.match((await w.v.act('eitri', 'telecharger', { nom: 'ubuntu' })).text, /🛡 Ubuntu \(bureau, LTS\) 24\.04\.5 mis de côté/);
    assert.deepEqual(readdirSync(join(w.iso, 'Ubuntu')).sort(), ['old', 'ubuntu-24.04.4-desktop-amd64.iso'], 'la version en place n\'a pas bougé');
    assert.ok((w.v.ctx('ullr').settings.quarantine as Array<{ nom?: string }>).some((q) => q.nom === 'ubuntu-24.04.5-desktop-amd64.iso'));
  } finally { w.fin(); }
});
