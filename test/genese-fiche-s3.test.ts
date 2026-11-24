// Genèse · Systèmes, lot S3 (côté serveur) : la fiche d'un système, « où il sert », les versions gardées, et « Retirer »
// avec son garde-fou. Hydre (ymir) est la vraie ; Genèse (thjalfi) et Andromède (eitri) sont fausses et disent ce qu'on
// veut : menu PXE, PC autorisés, déploiements, versions. Le journal des clés est un faux fichier dans un dossier neuf.
// Ce qui est vérifié : refus tant qu'un déploiement ou une VM allumée s'en sert ; un avertissement nommé par usage ; le nom
// tapé ; jamais un fichier hors de la bibliothèque (aucun lien suivi, chemin réel relu, mise de côté puis effacement) ; le
// menu PXE et les PC qui le citaient retombent sur un défaut sûr ; seul le propriétaire. Aucun réseau, aucun vrai disque.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, test } from 'node:test';
import { effacerDansLeDossier, reprendreMisDeCote } from '../src/valhalla/forge/bibliotheque.ts';
import { ymir } from '../src/valhalla/modules/ymir.ts';
import { assemblerVersions, bilanUsages, nomATaper, nomSurCle, nomTapeJuste } from '../src/valhalla/ymir/bibliotheque.ts';
import { systemeVm } from '../src/valhalla/ymir/local.ts';
import type { Module } from '../src/valhalla/types.ts';

const dossiers: string[] = [];
const neuf = (n: string) => { const d = mkdtempSync(join(tmpdir(), `odin-s3-${n}-`)); dossiers.push(d); return d; };
after(() => { for (const d of dossiers) rmSync(d, { recursive: true, force: true }); });
const UBU = 'ubuntu-24.04.1-desktop-amd64.iso', VIEILLE = 'ubuntu-22.04.5-desktop-amd64.iso';

// ------------------------------------------------------------------ la logique pure
test('S3 · où il sert : chaque usage nommé ; seuls un déploiement pas fini et une VM allumée bloquent', () => {
  const base = { chemin: `E:\\ISO\\${UBU}`, nom: UBU, sha256: 'b'.repeat(64), genese: [{ id: 'ubuntu', name: 'ubuntu-24.04.1-desktop-amd64', path: `e:/iso/${UBU}`, recipe: { auto: true, label: 'Ubuntu' } }, { id: 'debian', name: 'debian-12', path: 'E:/ISO/debian-12.iso' }] };
  const b = bilanUsages({
    ...base,
    menu: { entrees: [{ id: 'cache1', cache: true }, { id: 'debian' }, { id: 'ubuntu', nom: 'Ubuntu 24.04.1' }], defaut: 'ubuntu' },
    autorises: [{ mac: '52:54:00:00:00:01', nom: 'PC-01', iso: 'ubuntu', auto: true }, { mac: '52:54:00:00:00:02', iso: 'ubuntu-24.04.1-desktop-amd64' }, { mac: '52:54:00:00:00:03', iso: 'debian' }],
    lots: [{ iso: 'ubuntu', pcs: [{ etat: 'prêt', nom: 'PC-04' }] }, { iso: 'debian', pcs: [{ etat: 'en cours', nom: 'PC-05' }] }],
    enCours: [{ mac: '52:54:00:00:00:09', host: 'PC-09', iso: 'ubuntu', step: 'fini' }],
    vms: [{ nom: 'vm-ubuntu-1', iso: `E:/ISO/${UBU}`, allumee: false }, { nom: 'vm-debian', iso: 'E:/ISO/debian-12.iso', allumee: true }],
    cles: [{ at: 10, dest: `ISO/${UBU}`, sha256: 'x', cible: 'usb-1' }, { at: 30, dest: 'ISO/autre.iso', sha256: 'b'.repeat(64), cible: 'usb-2' }, { at: 20, dest: `ISO/${UBU}`, sha256: 'x', cible: 'usb-1' }, { at: 40, dest: 'ISO/debian-12.iso', sha256: 'c', cible: 'usb-3' }],
  });
  assert.deepEqual(b.bloquants, [], 'rien ne bloque : le déploiement de PC-04 est fini, celui en cours est pour Debian, la VM allumée est sur Debian');
  assert.deepEqual(b.genese, { id: 'ubuntu', name: 'ubuntu-24.04.1-desktop-amd64', auto: true, label: 'Ubuntu' });
  const g = (x: string) => b.usages.filter((u) => u.genre === x);
  assert.deepEqual(g('cle').map((u) => [u.nom, u.at]), [['usb-2', 30], ['usb-1', 20]], 'par clé, la dernière copie (par le nom ou l\'empreinte)');
  assert.deepEqual(g('menu'), [{ genre: 'menu', nom: 'Ubuntu 24.04.1', bloque: false, position: 2, defaut: true }], 'entrée 2 (la cachée ne compte pas), par défaut');
  assert.deepEqual(g('pc').map((u) => [u.nom, u.mac, u.auto ?? false]), [['PC-01', '52:54:00:00:00:01', true], ['52:54:00:00:00:02', '52:54:00:00:00:02', false]]);
  assert.deepEqual(g('vm').map((u) => [u.nom, u.bloque]), [['vm-ubuntu-1', false]]);
  assert.equal(g('deploiement').length, 0);
  assert.deepEqual(b.lu, { genese: true, cles: true, vms: true });
});

test('S3 · bloquent : un déploiement qui attend ou s\'installe, une installation en cours, une VM allumée ; Genèse ou Hydre illisible aussi', () => {
  const base = { chemin: `/srv/iso/${UBU}`, nom: UBU, genese: [{ id: 'ubuntu', name: 'ubuntu-24.04.1-desktop-amd64', path: `/srv/iso/${UBU}` }], autorises: [], vms: [] as Array<{ nom: string; iso?: string; allumee: boolean }> };
  const lot = bilanUsages({ ...base, lots: [{ iso: 'ubuntu', isoNom: 'Ubuntu', pcs: [{ etat: 'attente', nom: 'PC-01' }, { etat: 'en cours', mac: '52:54:00:00:00:02' }, { etat: 'prêt', nom: 'PC-03' }] }] });
  assert.equal(lot.bloquants.length, 1); assert.match(lot.bloquants[0], /2 PC \(PC-01, 52:54:00:00:00:02\).*Suivi/);
  assert.deepEqual(lot.usages.find((u) => u.genre === 'deploiement')?.pcs, ['PC-01', '52:54:00:00:00:02']);
  const vif = bilanUsages({ ...base, enCours: [{ mac: 'm', host: 'PC-07', iso: 'ubuntu', step: 'installation' }] });
  assert.match(vif.bloquants.join(), /PC-07/);
  const vm = bilanUsages({ ...base, vms: [{ nom: 'vm-ubuntu', iso: `/srv/iso/${UBU}`, allumee: true }] });
  assert.match(vm.bloquants.join(), /vm-ubuntu est allumée.*arrête-la d'abord/);
  assert.equal(vm.usages[0].bloque, true);
  const sansGenese = bilanUsages({ chemin: base.chemin, nom: UBU, vms: [] });
  assert.match(sansGenese.bloquants.join(), /Genèse ne répond pas/);
  const sansVm = bilanUsages({ chemin: base.chemin, nom: UBU, genese: base.genese, autorises: [] });
  assert.match(sansVm.bloquants.join(), /Hydre ne lit pas ses machines/);
  assert.equal(bilanUsages({ ...base }).bloquants.length, 0, 'rien ne s\'en sert : permis');
  assert.equal(bilanUsages({ ...base }).lu.cles, false, 'journal des clés pas lu : dit, pas inventé');
});

test('S3 · le nom à taper (celui de la carte) et sa comparaison (sans accents, majuscules, espaces en trop)', () => {
  assert.equal(nomATaper({ nom: UBU, detail: 'Ubuntu 24.04.1', version: '24.04.1' }), 'Ubuntu 24.04.1');
  assert.equal(nomATaper({ nom: 'Win11_24H2_French_x64.iso', detail: 'Windows 11', version: '24H2' }), 'Windows 11 24H2');
  assert.equal(nomATaper({ nom: 'outil.iso', detail: 'Système inconnu' }), 'outil');
  assert.ok(nomTapeJuste('  ubuntu   24.04.1 ', 'Ubuntu 24.04.1'));
  assert.ok(nomTapeJuste('Systeme Ete', 'Système Été'));
  assert.ok(!nomTapeJuste('Ubuntu 24.04', 'Ubuntu 24.04.1'));
  assert.ok(!nomTapeJuste('', ''), 'un nom vide ne confirme jamais rien');
  assert.equal(nomSurCle('Mon ISO (1).iso'), 'Mon_ISO__1_.iso', 'même nom que sur la clé');
});

test('S3 · versions gardées : celle-ci en service, l\'ancienne dans « old », la nouvelle chez l\'éditeur ; sans source, la fiche seule', () => {
  const f = { nom: UBU, chemin: `E:\\ISO\\${UBU}`, taille: 5, version: '24.04.1' };
  const v = assemblerVersions(f, [
    { nom: UBU, chemin: `E:/ISO/${UBU}`, taille: 5, source: 'ubuntu-desktop', versionReconnue: '24.04.1', etat: 'nouvelle version', derniere: '24.04.2' },
    { nom: VIEILLE, chemin: `E:/ISO/old/${VIEILLE}`, taille: 4, ancienne: true, source: 'ubuntu-desktop', versionReconnue: '22.04.5' },
    { nom: 'debian.iso', chemin: 'E:/ISO/debian.iso', source: 'debian' },
  ], [{ id: 'ubuntu-desktop' }]);
  assert.deepEqual(v.versions.map((x) => [x.version, x.enService, x.ancienne]), [['24.04.1', true, false], ['22.04.5', false, true]]);
  assert.deepEqual(v.nouvelle, { version: '24.04.2', source: 'ubuntu-desktop' });
  assert.equal(v.surveille, true); assert.equal(v.source, 'ubuntu-desktop');
  const seul = assemblerVersions(f, undefined, undefined);
  assert.deepEqual(seul.versions.map((x) => x.nom), [UBU]); assert.equal(seul.surveille, undefined, 'Andromède muet : rien d\'affirmé');
  assert.equal(seul.nouvelle, undefined);
});

// ------------------------------------------------------------------ effacer : ce fichier, et rien d'autre
test('S3 · effacer : seulement un vrai fichier rangé dans la bibliothèque ; « .. », dossier caché et dossier extérieur refusés', async () => {
  const racine = neuf('racine'), dehors = neuf('dehors');
  writeFileSync(join(racine, 'a.iso'), 'a'); writeFileSync(join(dehors, 'b.iso'), 'b');
  mkdirSync(join(racine, '.arrivees')); writeFileSync(join(racine, '.arrivees', 'c.iso'), 'c');
  await assert.rejects(effacerDansLeDossier(racine, join(racine, '..', dehors.split(/[\\/]/).pop()!, 'b.iso')), /rien n'est effacé/);
  await assert.rejects(effacerDansLeDossier(racine, join(dehors, 'b.iso')), /rien n'est effacé/);
  await assert.rejects(effacerDansLeDossier(racine, join(racine, '.arrivees', 'c.iso')), /rien n'est effacé/);
  await assert.rejects(effacerDansLeDossier(racine, racine), /rien n'est effacé/, 'jamais le dossier lui-même');
  assert.ok(existsSync(join(dehors, 'b.iso')) && existsSync(join(racine, '.arrivees', 'c.iso')));
  await effacerDansLeDossier(racine, join(racine, 'a.iso'));
  assert.ok(!existsSync(join(racine, 'a.iso')));
  assert.deepEqual(readdirSync(racine), ['.arrivees'], 'rien de mis de côté ne reste');
});

test('S3 · effacer : aucun lien suivi — un dossier lien (jonction) vers ailleurs, ou un fichier lien : rien n\'est effacé', async (t) => {
  const racine = neuf('racine'), dehors = neuf('dehors');
  writeFileSync(join(dehors, 'precieux.iso'), 'ne pas toucher');
  try { symlinkSync(dehors, join(racine, 'lien'), 'junction'); } catch { t.skip('ce système refuse de créer un lien de dossier'); return; }
  await assert.rejects(effacerDansLeDossier(racine, join(racine, 'lien', 'precieux.iso')), /lien/);
  assert.ok(existsSync(join(dehors, 'precieux.iso')), 'le fichier extérieur est intact');
  let fichierLien = true; try { symlinkSync(join(dehors, 'precieux.iso'), join(racine, 'raccourci.iso'), 'file'); } catch { fichierLien = false; }
  if (fichierLien) {
    await assert.rejects(effacerDansLeDossier(racine, join(racine, 'raccourci.iso')), /lien/);
    assert.ok(existsSync(join(dehors, 'precieux.iso')));
  }
});

test('S3 · effacer : la garde relue une fois le fichier mis de côté peut tout arrêter ; il revient à sa place, intact', async () => {
  const racine = neuf('racine'); mkdirSync(join(racine, 'old')); writeFileSync(join(racine, 'old', 'x.iso'), 'contenu');
  let vu: string[] = [];
  await assert.rejects(effacerDansLeDossier(racine, join(racine, 'old', 'x.iso'), async () => { vu = readdirSync(join(racine, 'old')); return 'un déploiement vient de commencer'; }), /un déploiement vient de commencer/);
  assert.equal(vu.length, 1); assert.match(vu[0], /^\.retrait-[0-9a-f]{12}-x\.iso$/, 'pendant la garde : mis de côté, caché (jamais listé), son nom gardé');
  assert.deepEqual(readdirSync(join(racine, 'old')), ['x.iso'], 'remis à sa place');
  await assert.rejects(effacerDansLeDossier(racine, join(racine, 'old', 'x.iso'), async () => { throw new Error('lecture impossible'); }), /lecture impossible/);
  assert.ok(existsSync(join(racine, 'old', 'x.iso')), 'une garde qui échoue arrête aussi');
});

// ------------------------------------------------------------------ Hydre pour de vrai, Genèse et Andromède fausses
interface Genese { lots?: unknown[]; lotsApres?: unknown[]; machines?: unknown[]; muet?: boolean; defaut?: string; autorises?: unknown[]; reseauMuet?: boolean; autoriserRefuse?: boolean; cles?: unknown[] }
function monde(o: Genese = {}) {
  const home = neuf('home'), espace = join(home, 'ISO'); mkdirSync(join(espace, 'old'), { recursive: true });
  writeFileSync(join(espace, UBU), 'iso ubuntu'); writeFileSync(join(espace, 'old', VIEILLE), 'iso ancienne'); writeFileSync(join(espace, 'debian-12.7.0-amd64-netinst.iso'), 'iso debian');
  const appels: Array<{ m: string; a: string; i: Record<string, unknown> }> = [];
  let suivis = 0;
  const m = (id: string, acts: Record<string, (i: Record<string, unknown>) => { ok?: boolean; text: string; data?: unknown }>) => ({ id, name: id, family: 'Machines', what: 'essai', does: [], from: [], upstream: [], words: [],
    actions: Object.entries(acts).map(([aid, run]) => ({ id: aid, label: aid, what: aid, read: !['menu_pxe_regler', 'autoriser'].includes(aid), run: async (_c: unknown, i: Record<string, unknown>) => { appels.push({ m: id, a: aid, i }); return run(i); } })) }) as unknown as Module;
  const muet = () => ({ ok: false, text: 'Genèse ne répond pas (essai)' });
  const thjalfi = m('thjalfi', {
    isos: () => (o.muet ? muet() : { text: 'x', data: [{ id: 'ubuntu-24-04-1-desktop-amd64', name: 'ubuntu-24.04.1-desktop-amd64', path: join(espace, UBU), recipe: { kind: 'ubuntu', auto: true, label: 'Ubuntu' } }, { id: 'debian', name: 'debian-12.7.0-amd64-netinst', path: join(espace, 'debian-12.7.0-amd64-netinst.iso') }].filter((x) => existsSync(x.path)) }),
    cle_journal: () => ({ text: 'x', data: { lignes: o.cles ?? [] } }),
    menu_pxe: () => ({ text: 'x', data: { entrees: [{ id: 'debian', nom: 'Debian 12' }, { id: 'ubuntu-24-04-1-desktop-amd64', nom: 'Ubuntu 24.04.1' }], defaut: o.defaut ?? 'ubuntu-24-04-1-desktop-amd64' } }),
    reseau: () => (o.reseauMuet ? muet() : { text: 'x', data: { autorises: o.autorises ?? [{ mac: '52:54:00:aa:bb:01', nom: 'PC-01', iso: 'ubuntu-24.04.1-desktop-amd64', auto: true, fait: false }] } }),
    deploiement_suivi: () => { suivis++; return { text: 'x', data: { lots: suivis > 1 && o.lotsApres ? o.lotsApres : o.lots ?? [] } }; },
    machines: () => ({ text: 'x', data: o.machines ?? [] }),
    menu_pxe_regler: () => ({ text: '✔ Menu PXE enregistré' }),
    autoriser: () => (o.autoriserRefuse ? { ok: false, text: 'réglage refusé (essai)' } : { text: '✔ autorisé' }),
  });
  const eitri = m('eitri', {
    etat: () => ({ text: 'x', data: { dossier: espace } }),
    disponibles: () => ({ text: 'x', data: { fichiers: [{ nom: UBU, chemin: join(espace, UBU), taille: 10, source: 'ubuntu-desktop', versionReconnue: '24.04.1', etat: 'nouvelle version', derniere: '24.04.2' }, { nom: VIEILLE, chemin: join(espace, 'old', VIEILLE), taille: 12, ancienne: true, source: 'ubuntu-desktop', versionReconnue: '22.04.5' }] } }),
    surveilles: () => ({ text: 'x', data: { surveilles: [{ id: 'ubuntu-desktop' }] } }),
  });
  return { home, espace, appels, thjalfi, eitri };
}
async function valhalla(w: ReturnType<typeof monde>) {
  const { Valhalla } = await import('../src/valhalla/service.ts');
  const v = new Valhalla(w.home, [ymir, w.thjalfi, w.eitri], { fetch: (async () => { throw new Error('aucun réseau'); }) as never, run: async () => ({ code: 1, out: '', err: 'aucune commande' }), notify: async () => {} });
  for (const id of ['ymir', 'thjalfi', 'eitri']) await v.activer(id, true);
  return v;
}
const ICI = (w: ReturnType<typeof monde>) => join(w.espace, UBU);

test('S3 · iso_usages : lecture, propriétaire seul ; usages nommés, nom à taper ; fiche_iso avec ses versions gardées', async () => {
  // Une clé ODIN où elle a été copiée (journal des clés, lu par Genèse elle-même : action en lecture cle_journal).
  const w = monde({ cles: [{ at: Date.UTC(2026, 10, 12), dest: `ISO/${UBU}`, sha256: 'z', cible: 'usb-Kingston-64' }, { casse: true }] }), v = await valhalla(w);
  try {
    const r = await v.act('ymir', 'iso_usages', { iso: ICI(w) });
    assert.equal(r.ok, true, r.text);
    const d = r.data as { aTaper: string; usages: Array<{ genre: string; nom: string; defaut?: boolean }>; bloquants: string[]; genese: { id: string; auto: boolean }; lu: Record<string, boolean> };
    assert.equal(d.aTaper, 'Ubuntu 24.04.1', 'le nom de sa carte');
    assert.deepEqual(d.usages.map((u) => u.genre), ['cle', 'menu', 'pc']);
    assert.equal(d.usages[0].nom, 'usb-Kingston-64'); assert.equal(d.usages[1].defaut, true);
    assert.deepEqual(d.bloquants, []); assert.deepEqual(d.genese, { id: 'ubuntu-24-04-1-desktop-amd64', name: 'ubuntu-24.04.1-desktop-amd64', auto: true, label: 'Ubuntu' });
    assert.match(r.text, /Clé ODIN usb-Kingston-64.*garde sa copie/); assert.match(r.text, /PC PC-01 \(52:54:00:aa:bb:01\).*installation automatique/);
    // Seulement des lectures chez Genèse.
    assert.ok(w.appels.every((x) => !['menu_pxe_regler', 'autoriser'].includes(x.a)));
    assert.ok(w.appels.some((x) => x.a === 'cle_journal'), 'le journal des clés est lu par Genèse');
    // Propriétaire seul : ni un membre, ni une automatisation, ni Odin seul ; rien ne fuit.
    for (const qui of [{ qui: 'member' as const }, { auto: true }, { by: 'automatisation' as const }, { by: 'odin' as const }]) {
      const n = await v.act('ymir', 'iso_usages', { iso: ICI(w) }, qui);
      assert.equal(n.ok, false, JSON.stringify(qui)); assert.match(n.text, /propriétaire/); assert.equal(n.data, undefined);
    }
    // La fiche : les versions gardées (celle-ci, l'ancienne dans « old ») et la nouvelle chez l'éditeur.
    const f = await v.act('ymir', 'fiche_iso', { iso: ICI(w) });
    const fd = f.data as { versions: Array<{ version?: string; ancienne: boolean }>; nouvelle?: { version: string }; surveille?: boolean };
    assert.deepEqual(fd.versions.map((x) => [x.version, x.ancienne]), [['24.04.1', false], ['22.04.5', true]]);
    assert.equal(fd.nouvelle?.version, '24.04.2'); assert.equal(fd.surveille, true);
    assert.match(f.text, /Versions gardées : 24\.04\.1 \(en service\), 22\.04\.5 \(dans « old »\) · 24\.04\.2 disponible/);
  } finally { v.stop(); }
});

test('S3 · retirer_systeme : refusé avec un mauvais nom, pendant un déploiement, avec une VM allumée — le fichier reste', async () => {
  const w = monde({ lots: [{ iso: 'ubuntu-24-04-1-desktop-amd64', isoNom: 'Ubuntu', pcs: [{ etat: 'attente', nom: 'PC-02' }] }] }), v = await valhalla(w);
  try {
    const aTaper = ((await v.act('ymir', 'iso_usages', { iso: ICI(w) })).data as { aTaper: string }).aTaper;
    const r = await v.act('ymir', 'retirer_systeme', { iso: ICI(w), nom: aTaper });
    assert.equal(r.ok, false); assert.match(r.text, /Refusé, rien n'est effacé : un déploiement .*\(PC-02\)/);
    assert.ok(existsSync(ICI(w)));
  } finally { v.stop(); }
  const w2 = monde(), v2 = await valhalla(w2);
  try {
    const mauvais = await v2.act('ymir', 'retirer_systeme', { iso: ICI(w2), nom: 'ubuntu' });
    assert.equal(mauvais.ok, false); assert.match(mauvais.text, /il faut taper exactement « .+ »/);
    assert.ok(existsSync(ICI(w2)));
    // Une VM allumée sur cette ISO (son processus « vit ») : refusé.
    const L = join(v2.ctx('ymir').dir, 'machines'); mkdirSync(join(L, 'vm', 'vm-ubuntu-1'), { recursive: true });
    writeFileSync(join(L, 'machines.json'), JSON.stringify([{ id: 'm1', nom: 'vm-ubuntu-1', genre: 'vm', systeme: 'Linux', version: '', famille: 'Linux', cpu: 2, ram: 2048, disque: 20, ip: '', mac: '', cree: 1, iso: ICI(w2), apps: [], paquets: [] }]));
    writeFileSync(join(L, 'vm', 'vm-ubuntu-1', 'pid'), '4242');
    const avant = systemeVm.enVie; systemeVm.enVie = (pid: number) => pid === 4242;
    try {
      const aTaper = ((await v2.act('ymir', 'iso_usages', { iso: ICI(w2) })).data as { aTaper: string }).aTaper;
      const r = await v2.act('ymir', 'retirer_systeme', { iso: ICI(w2), nom: aTaper });
      assert.equal(r.ok, false); assert.match(r.text, /vm-ubuntu-1 est allumée/);
      assert.ok(existsSync(ICI(w2)));
      // Éteinte : un simple avertissement, le retrait passe ; elle garde son disque.
      systemeVm.enVie = () => false;
      const ok = await v2.act('ymir', 'retirer_systeme', { iso: ICI(w2), nom: aTaper });
      assert.equal(ok.ok, true, ok.text); assert.match(ok.text, /vm-ubuntu-1 garde son disque/);
      assert.ok(!existsSync(ICI(w2)));
    } finally { systemeVm.enVie = avant; }
  } finally { v2.stop(); }
});

test('S3 · retirer_systeme : le bon nom → le fichier seul part ; le menu PXE retombe sur le disque du PC, le PC autorisé sur le menu normal', async () => {
  const w = monde(), v = await valhalla(w);
  try {
    const u = (await v.act('ymir', 'iso_usages', { iso: ICI(w) })).data as { aTaper: string };
    const r = await v.act('ymir', 'retirer_systeme', { iso: ICI(w), nom: `  ${u.aTaper.toUpperCase()} ` });
    assert.equal(r.ok, true, r.text);
    assert.ok(!existsSync(ICI(w)), 'le fichier est effacé');
    assert.ok(existsSync(join(w.espace, 'old', VIEILLE)) && existsSync(join(w.espace, 'debian-12.7.0-amd64-netinst.iso')), 'rien d\'autre');
    assert.deepEqual(readdirSync(w.espace).filter((x) => x.startsWith('.retrait')), []);
    const regler = w.appels.filter((x) => x.a === 'menu_pxe_regler'), autoriser = w.appels.filter((x) => x.a === 'autoriser');
    assert.deepEqual(regler.map((x) => x.i), [{ defaut: 'disque' }], 'par défaut : le disque du PC');
    assert.deepEqual(autoriser.map((x) => x.i), [{ mac: '52:54:00:aa:bb:01', nom: 'PC-01', auto: false }], 'PC-01 : menu normal, plus d\'installation automatique');
    assert.match(r.text, /retirée de la bibliothèque/); assert.match(r.text, /Menu PXE : par défaut, le disque du PC/); assert.match(r.text, /PC-01 : menu normal/);
    // Il n'est plus dans la bibliothèque.
    const l = ((await v.act('ymir', 'bibliotheque_iso')).data as { isos: Array<{ nom: string }> }).isos.map((x) => x.nom);
    assert.ok(!l.includes(UBU));
    // Pas la défaut ? Le menu n'est pas touché.
    const w2 = monde({ defaut: 'debian', autorises: [] }), v2 = await valhalla(w2);
    try {
      const a = ((await v2.act('ymir', 'iso_usages', { iso: ICI(w2) })).data as { aTaper: string }).aTaper;
      assert.equal((await v2.act('ymir', 'retirer_systeme', { iso: ICI(w2), nom: a })).ok, true);
      assert.equal(w2.appels.filter((x) => x.a === 'menu_pxe_regler' || x.a === 'autoriser').length, 0);
    } finally { v2.stop(); }
  } finally { v.stop(); }
});

test('S3 · course fermée : un déploiement qui commence pendant le retrait remet le fichier à sa place', async () => {
  const w = monde({ lotsApres: [{ iso: 'ubuntu-24-04-1-desktop-amd64', pcs: [{ etat: 'en cours', nom: 'PC-08' }] }] }), v = await valhalla(w);
  try {
    // 1re lecture des déploiements : rien ; la relecture, une fois le fichier mis de côté : PC-08 s'installe.
    const a = 'Ubuntu 24.04.1';
    const r = await v.act('ymir', 'retirer_systeme', { iso: ICI(w), nom: a });
    assert.equal(r.ok, false, r.text); assert.match(r.text, /PC-08/);
    assert.ok(existsSync(ICI(w)), 'remis à sa place');
    assert.deepEqual(readdirSync(w.espace).filter((x) => x.startsWith('.')), [], 'rien de caché ne reste');
    assert.equal(w.appels.filter((x) => x.a === 'menu_pxe_regler' || x.a === 'autoriser').length, 0, 'rien de changé chez Genèse');
  } finally { v.stop(); }
});

test('S3 · Genèse muette : retrait refusé (Odin ne peut pas dire qu\'aucun déploiement ne s\'en sert)', async () => {
  const w = monde({ muet: true }), v = await valhalla(w);
  try {
    const r = await v.act('ymir', 'retirer_systeme', { iso: ICI(w), nom: 'Ubuntu 24.04.1' });
    assert.equal(r.ok, false); assert.match(r.text, /Genèse ne répond pas/);
    assert.ok(existsSync(ICI(w)));
  } finally { v.stop(); }
});

test('S3 · Genèse désactivée (ses serveurs arrêtés, aucun déploiement possible) : le retrait n\'est pas bloqué', async () => {
  const w = monde({ muet: true }), v = await valhalla(w);
  try {
    assert.equal((await v.activer('thjalfi', false)).ok, true);
    const r = await v.act('ymir', 'retirer_systeme', { iso: ICI(w), nom: 'Ubuntu 24.04.1' });
    assert.equal(r.ok, true, r.text); assert.ok(!existsSync(ICI(w)));
    assert.equal(w.appels.filter((x) => x.m === 'thjalfi').length, 0, 'Genèse n\'est pas sollicitée');
  } finally { v.stop(); }
});

test('S3 · retirer_systeme et retirer_iso : propriétaire seul, graves ; retirer_iso ne suit plus un dossier lien vers ailleurs', async (t) => {
  const A = (id: string) => ymir.actions.find((x) => x.id === id)!;
  for (const id of ['retirer_systeme', 'retirer_iso']) { assert.equal(A(id).proprietaireSeul, true, id); assert.equal(typeof A(id).grave, 'function', id); }
  assert.equal(A('iso_usages').read, true); assert.equal(A('iso_usages').proprietaireSeul, true);
  const w = monde({ autorises: [] }), v = await valhalla(w);
  try {
    for (const qui of [{ qui: 'member' as const }, { auto: true }, { by: 'automatisation' as const }]) {
      const n = await v.act('ymir', 'retirer_systeme', { iso: ICI(w), nom: 'ubuntu-24.04.1-desktop-amd64' }, qui);
      assert.equal(n.ok, false, JSON.stringify(qui)); assert.ok(existsSync(ICI(w)));
    }
    // Un dossier lien (jonction) rangé dans le dossier des ISO, vers un dossier extérieur : son ISO apparaît dans la
    // bibliothèque, mais la retirer n'efface jamais le fichier extérieur (avant : il était effacé).
    const dehors = neuf('dehors'); writeFileSync(join(dehors, 'precieux.iso'), 'à garder');
    try { symlinkSync(dehors, join(w.espace, 'partage'), 'junction'); } catch { t.skip('ce système refuse de créer un lien de dossier'); return; }
    const r = await v.act('ymir', 'retirer_iso', { iso: join(w.espace, 'partage', 'precieux.iso') });
    assert.equal(r.ok, false, r.text); assert.match(r.text, /lien/);
    assert.ok(existsSync(join(dehors, 'precieux.iso')), 'le fichier extérieur est intact');
  } finally { v.stop(); }
});

test('S3 · la carte écrit le chemin en minuscules avec « / » : le bon fichier est retrouvé (et jamais un au hasard)', async () => {
  const w = monde({ autorises: [] }), v = await valhalla(w);
  try {
    const carte = ICI(w).split('\\').join('/').toLowerCase();
    const u = await v.act('ymir', 'iso_usages', { iso: carte });
    assert.equal(u.ok, true, u.text); assert.equal((u.data as { nom: string }).nom, UBU);
    const r = await v.act('ymir', 'retirer_systeme', { iso: carte, nom: 'Ubuntu 24.04.1' });
    assert.equal(r.ok, true, r.text); assert.ok(!existsSync(ICI(w)));
    assert.ok(existsSync(join(w.espace, 'old', VIEILLE)), 'l\'ancienne version reste');
  } finally { v.stop(); }
});

// ------------------------------------------------------------------ relecture du lot S3 (trous trouvés, puis fermés)
test('S3 relecture · pendant la garde, le fichier mis de côté n\'est plus dans la liste de Genèse : relu par son identifiant connu', () => {
  // Comme la vraie Genèse : un fichier caché (« .retrait-… ») n'est plus listé. Ses déploiements le citent toujours.
  const sans = { chemin: `/srv/iso/${UBU}`, nom: UBU, genese: [{ id: 'debian', name: 'debian-12', path: '/srv/iso/debian-12.iso' }], autorises: [], vms: [], lots: [{ iso: 'ubuntu', pcs: [{ etat: 'en cours', nom: 'PC-08' }] }] };
  assert.deepEqual(bilanUsages(sans).bloquants, [], 'sans le système connu, la relecture ne voyait plus rien (le trou)');
  assert.match(bilanUsages({ ...sans, connu: { id: 'ubuntu', name: 'ubuntu-24.04.1-desktop-amd64' } }).bloquants.join(), /PC-08/);
});

test('S3 relecture · PC autorisés illisibles chez Genèse : refusé (une installation automatique resterait armée)', async () => {
  assert.match(bilanUsages({ chemin: `/srv/iso/${UBU}`, nom: UBU, genese: [], vms: [] }).bloquants.join(), /quels PC sont autorisés/);
  const w = monde({ reseauMuet: true }), v = await valhalla(w);
  try {
    const r = await v.act('ymir', 'retirer_systeme', { iso: ICI(w), nom: 'Ubuntu 24.04.1' });
    assert.equal(r.ok, false, r.text); assert.match(r.text, /quels PC sont autorisés/); assert.ok(existsSync(ICI(w)));
  } finally { v.stop(); }
});

test('S3 relecture · un PC qui cite le système est remis sur le menu normal AVANT l\'effacement ; refusé par Genèse : rien n\'est effacé', async () => {
  const w = monde({ autoriserRefuse: true }), v = await valhalla(w);
  try {
    const r = await v.act('ymir', 'retirer_systeme', { iso: ICI(w), nom: 'Ubuntu 24.04.1' });
    assert.equal(r.ok, false, r.text); assert.match(r.text, /PC-01 cite ce système.*réglage refusé/);
    assert.ok(existsSync(ICI(w)), 'remis à sa place'); assert.deepEqual(readdirSync(w.espace).filter((x) => x.startsWith('.')), []);
    assert.equal(w.appels.filter((x) => x.a === 'menu_pxe_regler').length, 0, 'le menu n\'est pas touché');
  } finally { v.stop(); }
});

test('S3 relecture · retirer_iso par un bout de nom qui répond à plusieurs ISO : refusé, jamais une au hasard', async () => {
  const w = monde({ autorises: [] }); writeFileSync(join(w.espace, 'debian-13.1.0-amd64-netinst.iso'), 'autre debian');
  const v = await valhalla(w);
  try {
    const r = await v.act('ymir', 'retirer_iso', { iso: 'debian' });
    assert.equal(r.ok, false, r.text); assert.match(r.text, /plusieurs ISO répondent/);
    assert.ok(existsSync(join(w.espace, 'debian-12.7.0-amd64-netinst.iso')) && existsSync(join(w.espace, 'debian-13.1.0-amd64-netinst.iso')));
    const un = await v.act('ymir', 'retirer_iso', { iso: 'debian-13.1' });
    assert.equal(un.ok, true, un.text); assert.ok(!existsSync(join(w.espace, 'debian-13.1.0-amd64-netinst.iso')) && existsSync(join(w.espace, 'debian-12.7.0-amd64-netinst.iso')));
  } finally { v.stop(); }
});

test('S3 relecture · un retrait coupé net laisse un fichier mis de côté : il revient à sa place (jamais effacé, jamais caché pour toujours)', async () => {
  const racine = neuf('orphelins'); mkdirSync(join(racine, 'old'));
  writeFileSync(join(racine, '.retrait-0123456789ab-a.iso'), 'a');
  writeFileSync(join(racine, 'old', '.retrait-abcdefabcdef-b.iso'), 'ancien b'); writeFileSync(join(racine, '.retrait-111111111111-note.txt'), 'pas une iso');
  writeFileSync(join(racine, 'b.iso'), 'nouveau b'); writeFileSync(join(racine, '.retrait-222222222222-b.iso'), 'b mis de côté');
  assert.equal(reprendreMisDeCote(racine, /\.iso$/i), 3);
  assert.deepEqual(readdirSync(racine).sort(), ['.retrait-111111111111-note.txt', 'a.iso', 'b (retrouvé 222222).iso', 'b.iso', 'old']);
  assert.deepEqual(readdirSync(join(racine, 'old')), ['b.iso']);
  // Un retrait EN COURS (garde qui attend) n'est jamais repris sous ses pieds.
  writeFileSync(join(racine, 'c.iso'), 'c'); let repris = -1;
  await effacerDansLeDossier(racine, join(racine, 'c.iso'), async () => { repris = reprendreMisDeCote(racine, /\.iso$/i); return undefined; });
  assert.equal(repris, 0); assert.ok(!existsSync(join(racine, 'c.iso')));
});

test('S3 relecture · effacer : flux NTFS, nom réservé, point final refusés ; un dossier remplacé par une jonction pendant la garde : rien dehors', async (t) => {
  const racine = neuf('attaque'), dehors = neuf('dehors');
  writeFileSync(join(racine, 'a.iso'), 'a');
  for (const p of ['a.iso:flux', 'a.iso::$DATA', 'CON', 'a.iso.', 'a.iso ']) await assert.rejects(effacerDansLeDossier(racine, join(racine, p)), /rien n'est effacé/, p);
  assert.ok(existsSync(join(racine, 'a.iso')));
  mkdirSync(join(racine, 'sous')); writeFileSync(join(racine, 'sous', 'x.iso'), 'à effacer'); writeFileSync(join(dehors, 'x.iso'), 'précieux');
  let jonction = true;
  await assert.rejects(effacerDansLeDossier(racine, join(racine, 'sous', 'x.iso'), async () => {
    // Pendant la garde : le dossier est déplacé et remplacé par une jonction vers un dossier extérieur.
    renameSync(join(racine, 'sous'), join(racine, 'sous-vrai'));
    try { symlinkSync(dehors, join(racine, 'sous'), 'junction'); } catch { jonction = false; }
    return undefined;
  }), /rien n'est effacé|disparu/);
  if (!jonction) { t.skip('ce système refuse de créer un lien de dossier'); return; }
  assert.deepEqual(readdirSync(dehors), ['x.iso'], 'le dossier extérieur est intact');
  assert.equal(readdirSync(join(racine, 'sous-vrai')).length, 1, 'le vrai fichier est resté de côté…');
  rmSync(join(racine, 'sous')); assert.equal(reprendreMisDeCote(racine, /\.iso$/i), 1);
  assert.deepEqual(readdirSync(join(racine, 'sous-vrai')), ['x.iso'], '… puis il est revenu à sa place');
});

test('S3 relecture · deux retraits du même fichier en même temps : un seul efface, l\'autre refuse, rien d\'autre ne part', async () => {
  const racine = neuf('double'); writeFileSync(join(racine, 'a.iso'), 'a'); writeFileSync(join(racine, 'b.iso'), 'b');
  const lent = () => new Promise<undefined>((r) => setTimeout(() => r(undefined), 30));
  const l = await Promise.allSettled([effacerDansLeDossier(racine, join(racine, 'a.iso'), lent), effacerDansLeDossier(racine, join(racine, 'a.iso'), lent)]);
  assert.deepEqual(l.map((x) => x.status).sort(), ['fulfilled', 'rejected']);
  assert.deepEqual(readdirSync(racine), ['b.iso']);
});
