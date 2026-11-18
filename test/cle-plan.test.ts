// Genèse · clé USB — le plan de double démarrage et le plan de retrait, sur des tables de partitions SIMULÉES.
// Garde-fous : arrêt si chiffré, refus si pas de place, réduction seulement d'un FS sain. Aucune commande réelle.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planDualBoot, planRetrait, espaceLibre } from '../src/valhalla/thjalfi/cle-plan.ts';
import type { Disque } from '../src/valhalla/thjalfi/disques.ts';

const GO = 1024 ** 3;
const disque = (o: Partial<Disque> & { partitions: Disque['partitions'] }): Disque => ({
  id: 'd', chemin: '/dev/sda', tailleOctets: 500 * GO, genre: 'interne', externe: false, amovible: false, ...o,
});

test('espace libre : taille moins les partitions', () => {
  const d = disque({ tailleOctets: 500 * GO, partitions: [{ nom: 'p1', tailleOctets: 100 * GO }] });
  assert.equal(espaceLibre(d), 400 * GO);
});

test('plan : de l\'espace libre suffisant, rien n\'est touché', () => {
  const d = disque({ tailleOctets: 500 * GO, partitions: [{ nom: 'p1', tailleOctets: 400 * GO, fs: 'ntfs', systeme: 'windows' }] });
  const p = planDualBoot(d, 60);
  assert.equal(p.possible, true);
  assert.equal(p.methode, 'espace-libre');
  assert.equal(p.nouvelle?.tailleOctets, 60 * GO);
  assert.ok(p.etapes.every((e) => e.sur), 'aucune étape destructrice');
  assert.ok(p.sauvegardes.length >= 1, 'la table de partitions est sauvegardée');
});

test('plan : réduction d\'un Windows sain quand il n\'y a pas assez d\'espace libre', () => {
  const d = disque({ tailleOctets: 500 * GO, partitions: [{ nom: 'C', tailleOctets: 480 * GO, fs: 'ntfs', systeme: 'windows', utiliseOctets: 200 * GO }] });
  const p = planDualBoot(d, 60);
  assert.equal(p.possible, true);
  assert.equal(p.methode, 'reduction');
  assert.equal(p.reduire?.nom, 'C');
  assert.ok(p.reduire && p.reduire.versOctets < p.reduire.deOctets, 'Windows est réduit, pas effacé');
  // Une étape de réduction est marquée « pas sûre » (elle demande vérification), mais aucune n'efface.
  assert.ok(p.etapes.some((e) => !e.sur));
});

test('garde-fou : disque chiffré sans clé → arrêt net', () => {
  const d = disque({ chiffre: 'bitlocker', partitions: [{ nom: 'C', tailleOctets: 480 * GO, fs: 'ntfs', chiffre: 'bitlocker' }] });
  const p = planDualBoot(d, 60);
  assert.equal(p.possible, false);
  assert.match(p.blocage ?? '', /chiffré|BitLocker/i);
  assert.equal(p.etapes.length, 0);
});

test('garde-fou : pas assez de place et FS non réductible → refus', () => {
  const d = disque({ tailleOctets: 60 * GO, partitions: [{ nom: 'p1', tailleOctets: 58 * GO, fs: 'exfat' }] });
  const p = planDualBoot(d, 60);
  assert.equal(p.possible, false);
  assert.match(p.blocage ?? '', /place|réduit/i);
});

test('garde-fou : Windows presque plein n\'est pas réduit', () => {
  const d = disque({ tailleOctets: 256 * GO, partitions: [{ nom: 'C', tailleOctets: 250 * GO, fs: 'ntfs', systeme: 'windows', utiliseOctets: 240 * GO }] });
  const p = planDualBoot(d, 60);
  assert.equal(p.possible, false, 'pas 60 Go + 10 de marge réellement libres');
});

test('plan de retrait : enlève la partition ODIN, jamais les autres', () => {
  const d = disque({ partitions: [{ nom: 'C', tailleOctets: 400 * GO, fs: 'ntfs', systeme: 'windows' }, { nom: 'ODIN', tailleOctets: 60 * GO, label: 'ODIN', systeme: 'odin' }] });
  const p = planRetrait(d);
  assert.equal(p.possible, true);
  assert.match(p.etapes.map((e) => e.texte).join(' '), /ODIN/);
  // Sans partition ODIN, il n'y a rien à retirer.
  const sans = disque({ partitions: [{ nom: 'C', tailleOctets: 400 * GO, fs: 'ntfs', systeme: 'windows' }] });
  assert.equal(planRetrait(sans).possible, false);
});

// ---- Chiffrement INCONNU (lot « genese-chiffrement-inconnu ») : sans les droits d'administrateur, ou pour une
// partition sans lettre, Odin ne sait pas lire BitLocker. Règle de Genèse : arrêt net si le disque est chiffré sans
// clé de récupération ; dans le doute, « inconnu » vaut « chiffré ». Disques SIMULÉS, aucune commande.
import { parseGetDisk, type SortieWindows } from '../src/valhalla/thjalfi/disques.ts';
import { ciblesEcrivables, cibleDepuisDisque } from '../src/valhalla/thjalfi/cle-cible.ts';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

/** Aucune phrase du plan ne demande la clé de récupération à Odin. */
const neDemandePasLaCle = (t: string) => {
  assert.doesNotMatch(t, /donne(-moi)? la clé|donne sa clé|tape la clé|saisis la clé|entre la clé/i, 'Odin ne demande jamais la clé');
};

test('inconnu : un Windows NTFS au chiffrement inconnu n\'est jamais réduit (arrêt net, il dit pourquoi et quoi faire)', () => {
  const d = disque({ tailleOctets: 500 * GO, partitions: [{ nom: 'C', tailleOctets: 480 * GO, fs: 'ntfs', systeme: 'windows', utiliseOctets: 200 * GO, montage: 'C:', chiffreInconnu: true }] });
  const p = planDualBoot(d, 60);
  assert.equal(p.possible, false, `aucun plan d'écriture (reçu : ${p.methode ?? 'refus'})`);
  assert.equal(p.reduire, undefined, 'aucune réduction');
  assert.equal(p.etapes.length, 0);
  assert.match(p.blocage ?? '', /inconnu|ne peux pas lire|ne peut pas lire/i, 'il dit pourquoi');
  assert.match(p.blocage ?? '', /administrateur/i, 'relancer Odin en administrateur');
  assert.match(p.blocage ?? '', /Gérer BitLocker/, 'ou vérifier soi-même');
  neDemandePasLaCle(p.blocage ?? '');
});

test('inconnu : même avec assez d\'espace libre, aucune partition n\'est créée sur ce disque', () => {
  const d = disque({ tailleOctets: 500 * GO, partitions: [{ nom: 'C', tailleOctets: 300 * GO, fs: 'ntfs', systeme: 'windows', chiffreInconnu: true }] });
  const p = planDualBoot(d, 60);
  assert.equal(p.possible, false, `aucun plan d'écriture (reçu : ${p.methode ?? 'refus'})`);
  assert.equal(p.nouvelle, undefined);
});

test('inconnu : une seule partition au chiffrement inconnu suffit (le Windows lisible n\'y change rien)', () => {
  const d = disque({ tailleOctets: 1000 * GO, partitions: [
    { nom: 'C', tailleOctets: 400 * GO, fs: 'ntfs', systeme: 'windows', utiliseOctets: 100 * GO, montage: 'C:' },
    { nom: 'Disque 0 partition 4', tailleOctets: 200 * GO, chiffreInconnu: true },
  ] });
  assert.equal(planDualBoot(d, 60).possible, false);
});

test('inconnu, de bout en bout : sortie Windows sans droits → disque lu → plan refusé', () => {
  const w: SortieWindows = {
    disks: [{ Number: 0, FriendlyName: 'Disque interne B', Size: 500 * GO, BusType: 'NVMe', IsSystem: true }],
    partitions: [
      { DiskNumber: 0, PartitionNumber: 1, Type: 'System', Size: 300 * 1024 ** 2 },
      { DiskNumber: 0, PartitionNumber: 2, DriveLetter: 'C', Size: 480 * GO, Type: 'Basic' },
    ],
    volumes: [{ DriveLetter: 'C', FileSystem: 'NTFS', FileSystemLabel: 'Systeme', Size: 480 * GO, SizeRemaining: 280 * GO }],
    bitlocker: { C: 'inconnu' },
  };
  const p = planDualBoot(parseGetDisk(w)[0], 60);
  assert.equal(p.possible, false, `aucun plan d'écriture (reçu : ${p.methode ?? 'refus'})`);
});

test('contrôle : un Windows lisible et non chiffré garde son plan (EFI, MSR et récupération sans lettre comprises)', () => {
  const w: SortieWindows = {
    disks: [{ Number: 0, FriendlyName: 'Disque interne C', Size: 500 * GO, BusType: 'NVMe', IsSystem: true }],
    partitions: [
      { DiskNumber: 0, PartitionNumber: 1, Type: 'System', Size: 300 * 1024 ** 2, IsSystem: true },
      { DiskNumber: 0, PartitionNumber: 2, Type: 'Reserved', Size: 16 * 1024 ** 2 },
      { DiskNumber: 0, PartitionNumber: 3, DriveLetter: 'C', Size: 480 * GO, Type: 'Basic', IsBoot: true },
      { DiskNumber: 0, PartitionNumber: 4, Type: 'Recovery', Size: 700 * 1024 ** 2 },
    ],
    volumes: [{ DriveLetter: 'C', FileSystem: 'NTFS', FileSystemLabel: 'Systeme', Size: 480 * GO, SizeRemaining: 280 * GO }],
    bitlocker: { C: false },
  };
  const d = parseGetDisk(w)[0];
  assert.ok(d.partitions.every((x) => !x.chiffreInconnu && !x.chiffre), 'rien d\'inconnu sur ce disque');
  const p = planDualBoot(d, 60);
  assert.equal(p.possible, true);
  assert.equal(p.methode, 'reduction');
  // Et avec de l'espace libre : le plan « espace libre » reste aussi.
  const libre = planDualBoot(disque({ tailleOctets: 500 * GO, partitions: [{ nom: 'C', tailleOctets: 300 * GO, fs: 'ntfs', systeme: 'windows' }] }), 60);
  assert.equal(libre.possible, true);
  assert.equal(libre.methode, 'espace-libre');
});

test('contrôle : un disque chiffré connu garde son refus, et le refus ne demande jamais la clé', () => {
  for (const chiffre of ['bitlocker', 'luks', 'filevault'] as const) {
    const d = disque({ partitions: [{ nom: 'C', tailleOctets: 480 * GO, fs: 'ntfs', chiffre }, { nom: 'X', tailleOctets: 10 * GO, chiffreInconnu: true }] });
    const p = planDualBoot(d, 60);
    assert.equal(p.possible, false);
    assert.match(p.blocage ?? '', /chiffré \((BitLocker|LUKS|FileVault)\)/, 'le chiffrement connu est nommé, pas « inconnu »');
    assert.equal(p.etapes.length, 0);
    neDemandePasLaCle(p.blocage ?? '');
  }
});

test('contrôle : la clé USB cible garde son comportement (chiffrement inconnu ou non)', () => {
  const cle = disque({ id: 'cle1', chemin: '/dev/sdz', tailleOctets: 32 * GO, genre: 'cle', externe: true, amovible: true, partitions: [{ nom: 'p1', tailleOctets: 32 * GO, fs: 'exfat' }] });
  const cleInconnue = { ...cle, partitions: [{ ...cle.partitions[0], chiffreInconnu: true as const }] };
  assert.deepEqual(ciblesEcrivables([cleInconnue]), ciblesEcrivables([cle]));
  assert.deepEqual(cibleDepuisDisque(cleInconnue), cibleDepuisDisque(cle));
  assert.equal(ciblesEcrivables([cle]).length, 1);
});

// La page (navigateur) rendue dans un DOM minimal, sans réseau : fetch rend une liste SIMULÉE, jamais les vrais disques.
interface Noeud { tag: string; attrs: Record<string, string>; kids: Array<Noeud | string>; className: string }
async function rendrePage(internes: Disque[], externes: Disque[] = []): Promise<{ textes: string[]; etiquettes: Array<{ texte: string; title?: string }>; notes: string[]; attributs: string[]; css: string }> {
  class Node {}
  class Texte extends Node { t: string; constructor(t: string) { super(); this.t = t; } }
  class Elem extends Node implements Noeud {
    tag: string; attrs: Record<string, string> = {}; kids: Array<Noeud | string> = []; className = ''; style = { cssText: '' }; innerHTML = '';
    constructor(t: string) { super(); this.tag = t; }
    setAttribute(k: string, v: unknown) { this.attrs[k] = String(v); }
    addEventListener() {}
    append(...k: Array<Noeud | string>) { this.kids.push(...k); }
    replaceChildren(...k: Array<Noeud | string>) { this.kids = [...k]; }
  }
  const document = { createElement: (t: string) => new Elem(t), createElementNS: (_n: string, t: string) => new Elem(t), createTextNode: (t: string) => new Texte(t) };
  const fetch = async () => ({ json: async () => ({ ok: true, data: { externes, internes } }) });
  const window: Record<string, unknown> = {};
  vm.runInNewContext(readFileSync(new URL('../src/web/pages/thjalfi-cle.js', import.meta.url), 'utf8'), { window, document, Node, fetch });
  const root = new Elem('div');
  await (window.OdinGeneseCle as { dessiner: (r: unknown, o: string, h: unknown) => Promise<void> }).dessiner(root, 'cle', {});
  const textes: string[] = [], etiquettes: Array<{ texte: string; title?: string }> = [], notes: string[] = [], attributs: string[] = [];
  let css = '';
  const texteDe = (n: unknown): string => (n instanceof Texte ? n.t : typeof n === 'string' ? n : (n as Noeud).kids.map(texteDe).join(''));
  const parcourir = (n: unknown) => {
    if (n instanceof Texte) { textes.push(n.t); return; }
    if (typeof n === 'string') { textes.push(n); return; }
    const e = n as Noeud;
    if (e.tag === 'span' && /\bcle-tag\b/.test(e.className)) etiquettes.push({ texte: texteDe(e), ...(e.attrs.title ? { title: e.attrs.title } : {}) });
    if (/\bcle-note\b/.test(e.className)) notes.push(texteDe(e));
    if (e.tag === 'style') css += texteDe(e);
    attributs.push(...Object.values(e.attrs));
    e.kids.forEach(parcourir);
  };
  parcourir(root);
  return { textes, etiquettes, notes, attributs, css };
}

test('page : la carte d\'un disque au chiffrement inconnu porte l\'étiquette « Chiffrement inconnu »', async () => {
  const d = disque({ id: 'physicaldrive0', modele: 'Disque interne D', partitions: [{ nom: 'C', tailleOctets: 480 * GO, fs: 'ntfs', systeme: 'windows', chiffreInconnu: true }] });
  const r = await rendrePage([d]);
  const e = r.etiquettes.find((x) => x.texte === 'Chiffrement inconnu');
  assert.ok(e, `étiquette absente (vues : ${r.etiquettes.map((x) => x.texte).join(', ')})`);
  assert.match(e.title ?? '', /administrateur/i, 'l\'étiquette explique quoi faire');
  for (const t of r.textes) neDemandePasLaCle(t);
});

test('contrôle page : un disque lisible n\'a aucune étiquette de chiffrement ; un disque BitLocker garde la sienne', async () => {
  const lisible = disque({ id: 'a', modele: 'Disque interne E', partitions: [{ nom: 'C', tailleOctets: 480 * GO, fs: 'ntfs', systeme: 'windows' }] });
  const bl = disque({ id: 'b', modele: 'Disque interne F', partitions: [{ nom: 'C', tailleOctets: 480 * GO, fs: 'ntfs', chiffre: 'bitlocker' }] });
  const r = await rendrePage([lisible, bl]);
  const noms = r.etiquettes.map((x) => x.texte);
  assert.ok(noms.includes('BitLocker'), 'BitLocker gardé');
  assert.ok(!noms.includes('Chiffrement inconnu'), 'rien d\'inconnu ici');
});

// ---- Corrections après relecture (même lot) : la consigne dit QUELLE cause s'applique (sans droits, ou partition
// sans lettre : BitLocker se lit par la lettre, l'administrateur n'y change rien) ; l'aide se lit sans survol ; une
// clé USB n'est pas dite « intouchable » quand sa préparation l'efface ; l'étiquette prend la couleur d'alerte du thème.

test('inconnu, avec lettre : le refus dit « droits d\'administrateur », pas « pas de lettre »', () => {
  const d = disque({ partitions: [{ nom: 'C', tailleOctets: 480 * GO, fs: 'ntfs', systeme: 'windows', utiliseOctets: 200 * GO, montage: 'C:', chiffreInconnu: true }] });
  const b = planDualBoot(d, 60).blocage ?? '';
  assert.match(b, /C:/);
  assert.match(b, /administrateur/i);
  assert.doesNotMatch(b, /pas de lettre/i, 'la cause qui ne s\'applique pas n\'est pas dite');
});

test('inconnu, sans lettre : le refus dit que l\'administrateur n\'y change rien, et quoi faire soi-même', () => {
  const d = disque({ tailleOctets: 1000 * GO, partitions: [
    { nom: 'C', tailleOctets: 400 * GO, fs: 'ntfs', systeme: 'windows', utiliseOctets: 100 * GO, montage: 'C:' },
    { nom: 'Disque 0 partition 4', tailleOctets: 200 * GO, chiffreInconnu: true },
  ] });
  const p = planDualBoot(d, 60);
  assert.equal(p.possible, false);
  const b = p.blocage ?? '';
  assert.match(b, /pas de lettre/i, 'il dit la cause');
  assert.match(b, /même en administrateur/i, 'relancer en administrateur ne suffit pas');
  assert.match(b, /Gestion des disques/, 'quoi faire soi-même');
  assert.doesNotMatch(b, /Relance Odin en administrateur pour qu'il puisse le lire/, 'pas une consigne qui redonne le même refus');
  neDemandePasLaCle(b);
});

test('inconnu, les deux causes : chacune est dite pour sa partition', () => {
  const d = disque({ partitions: [
    { nom: 'C', tailleOctets: 300 * GO, fs: 'ntfs', systeme: 'windows', montage: 'C:', chiffreInconnu: true },
    { nom: 'Disque 0 partition 4', tailleOctets: 100 * GO, chiffreInconnu: true },
  ] });
  const p = planDualBoot(d, 60);
  assert.equal(p.possible, false);
  assert.match(p.blocage ?? '', /C:.*administrateur/s);
  assert.match(p.blocage ?? '', /pas de lettre/i);
});

test('page : l\'aide « chiffrement inconnu » se lit sans survol (une ligne visible sur la carte)', async () => {
  const d = disque({ id: 'physicaldrive0', modele: 'Disque interne G', partitions: [{ nom: 'C', tailleOctets: 480 * GO, fs: 'ntfs', systeme: 'windows', montage: 'C:', chiffreInconnu: true }] });
  const r = await rendrePage([d]);
  assert.ok(r.notes.some((n) => /administrateur/i.test(n) && /Gérer BitLocker/.test(n)), `aucune ligne visible (notes : ${r.notes.join(' | ')})`);
  for (const t of [...r.textes, ...r.attributs]) neDemandePasLaCle(t);
});

test('page : un disque dont une partition n\'a pas de lettre dit cette cause', async () => {
  const d = disque({ id: 'physicaldrive1', modele: 'Disque interne H', partitions: [
    { nom: 'C', tailleOctets: 300 * GO, fs: 'ntfs', systeme: 'windows', montage: 'C:' },
    { nom: 'Disque 1 partition 4', tailleOctets: 100 * GO, chiffreInconnu: true },
  ] });
  const r = await rendrePage([d]);
  assert.ok(r.notes.some((n) => /pas de lettre/i.test(n) && /Gestion des disques/.test(n)), `cause absente (notes : ${r.notes.join(' | ')})`);
  for (const t of [...r.textes, ...r.attributs]) neDemandePasLaCle(t);
});

test('page : une clé USB au chiffrement inconnu n\'est pas dite « intouchable » (sa préparation l\'efface), son bouton reste', async () => {
  const cle = disque({ id: 'cle1', chemin: '/dev/sdz', modele: 'Cle USB J', tailleOctets: 32 * GO, genre: 'cle', externe: true, amovible: true, partitions: [{ nom: 'p1', tailleOctets: 32 * GO, fs: 'exfat', montage: 'E:', chiffreInconnu: true }] });
  const r = await rendrePage([], [cle]);
  assert.ok(r.etiquettes.some((x) => x.texte === 'Chiffrement inconnu'), 'l\'information reste');
  const aide = [...r.notes, ...r.etiquettes.map((x) => x.title ?? '')].join(' ');
  assert.doesNotMatch(aide, /n'y touche pas/i, 'pas de « n\'y touche pas » au-dessus d\'un bouton qui efface');
  assert.match(aide, /effac/i, 'il dit que la préparation peut effacer');
  assert.ok(r.textes.includes('Préparer la clé ODIN'), 'le comportement de la clé ne change pas');
  for (const t of [...r.textes, ...r.attributs]) neDemandePasLaCle(t);
});

test('page : l\'étiquette de chiffrement prend la couleur d\'alerte du thème (--warn)', async () => {
  const r = await rendrePage([]);
  const regle = /\.cle-tag\.lock\{([^}]*)\}/.exec(r.css)?.[1] ?? '';
  // Le texte part de --warn (assombri vers --ink) : 5,2:1 en clair au lieu de 2,5:1 avec l'ancien orange fixe.
  assert.match(regle, /(^|;)color:(var\(--warn\b|color-mix\(in srgb,var\(--warn\b)/, `couleur du texte (règle : ${regle})`);
  assert.doesNotMatch(regle, /(^|;)color:var\(--cwarn\)/, 'plus l\'orange fixe');
});
