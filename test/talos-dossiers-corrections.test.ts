// Talos, dossiers et corbeille : les défauts relevés à la relecture, chacun avec son essai.
// Chaque essai tourne dans un dossier jetable : rien n'est écrit dans le vrai dossier d'Odin.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ecrireJson, validerNomDossier } from '../src/draupnir/dossiers.ts';
import type { Workflow } from '../src/draupnir/engine.ts';
import { Talos } from '../src/draupnir/service.ts';
import { setDraupnir } from '../src/tools/draupnir.ts';
import { draupnirPost } from '../src/web/draupnir-api.ts';

const jetable = () => mkdtempSync(join(tmpdir(), 'talos-corrections-'));
const flux = (over: Partial<Workflow> = {}): Partial<Workflow> => ({ name: 'Essai', active: false, nodes: [{ name: 'Go', type: 'déclencheur.manuel', params: {} }], connections: {}, ...over });
const avecTalos = async (f: (d: Talos, home: string) => void | Promise<void>) => {
  const home = jetable(), d = new Talos(home, {});
  try { await f(d, home); } finally { d.stop(); rmSync(home, { recursive: true, force: true }); }
};
const poser = (home: string, fichier: string, w: Record<string, unknown>) => writeFileSync(join(home, 'draupnir', 'flows', fichier), JSON.stringify({ ...flux(), createdAt: '2025-01-01T00:00:00.000Z', updatedAt: '2025-01-01T00:00:00.000Z', ...w }));

test('M1. une ancienne automatisation à l\'identifiant hors [\\w-] se laisse activer, ranger et jeter, puis restaurer', () => avecTalos((d, home) => {
  const x = d.creerDossier('Maison');
  poser(home, 'rsum-mails.json', { id: 'résumé-mails', name: 'Résumé des mails' });
  const w = d.setActive('résumé-mails', true);
  assert.equal(w.id, 'rsum-mails', 'elle reçoit un identifiant propre');
  assert.equal(w.active, true);
  assert.equal(w.createdAt, '2025-01-01T00:00:00.000Z', 'sa date de création est gardée');
  assert.deepEqual(readdirSync(join(home, 'draupnir', 'flows')), ['rsum-mails.json'], 'un seul fichier, au même nom');
  assert.equal(d.ranger(w.id, x.id).dossier, x.id);
  assert.equal(d.save({ ...d.parId(w.id)!, name: 'Mails' }).name, 'Mails');
  // Jetée AVANT toute migration : elle reste visible et restaurable.
  poser(home, 'vieillenote.json', { id: 'vieille note', name: 'Vieille note' });
  d.trash('vieille note');
  const l = d.listeCorbeille();
  assert.equal(l.length, 1, 'visible dans la corbeille');
  assert.match(l[0].cle, /^vieillenote-\d+$/);
  const r = d.restaurerCorbeille(l[0].cle);
  assert.match(r.id, /^[\w-]{1,64}$/);
  assert.equal(r.name, 'Vieille note');
  // Un identifiant dangereux pour une automatisation NOUVELLE reste refusé.
  assert.throws(() => d.save(flux({ id: 'nouvelle idée' })), /^Error: identifiant invalide$/);
}));

test('P6. jeter un fichier dont l\'identifiant contient un chemin n\'écrit jamais hors de la corbeille', () => avecTalos((d, home) => {
  poser(home, 'piege.json', { id: '../../piege', name: 'Piège' });
  d.trash('Piège');
  assert.equal(existsSync(join(home, 'piege.json')), false);
  assert.equal(readdirSync(home).some((f) => f.startsWith('piege')), false, 'rien hors de draupnir/');
  assert.equal(readdirSync(join(home, 'draupnir', 'flows')).length, 0, 'sortie de flows/');
  assert.equal(d.listeCorbeille().length, 1, 'dans la corbeille, sous un nom propre');
}));

test('P5. « v-… » est réservé aux anciennes versions : refusé pour une nouvelle, et une ancienne « v-… » jetée reste visible', () => avecTalos((d, home) => {
  assert.throws(() => d.save(flux({ id: 'v-abc' })), /^Error: identifiant invalide$/);
  poser(home, 'v-old.json', { id: 'v-old', name: 'Ancienne' });
  d.trash('v-old');
  const l = d.listeCorbeille();
  assert.equal(l.length, 1, 'visible dans la corbeille');
  const r = d.restaurerCorbeille(l[0].cle);
  assert.ok(!r.id.startsWith('v-'), 'restaurée sous un nouvel identifiant');
}));

test('P1. un dossier supprimé pendant que l\'éditeur est ouvert : « Enregistrer » passe, sans dossier', () => avecTalos((d) => {
  const x = d.creerDossier('Temporaire'), w = d.save(flux({ dossier: x.id }));
  const copie = d.get(w.id)!;
  d.supprimerDossier(x.id);
  const r = d.save({ ...copie, name: 'Renommée' });
  assert.equal(r.name, 'Renommée');
  assert.equal(r.dossier, undefined);
  assert.throws(() => d.save({ ...d.get(w.id)!, dossier: 'd-inconnu12' }), /^Error: dossier inconnu$/, 'un dossier qui n\'a jamais existé reste refusé');
}));

test('P1 bis. l\'enregistrement de l\'éditeur ne défait pas un rangement fait entre-temps depuis la liste', async () => {
  const home = jetable(), d = new Talos(home, {}); setDraupnir(d);
  try {
    const a = d.creerDossier('A'), b = d.creerDossier('B');
    const w = d.save(flux({ dossier: a.id })), copie = d.get(w.id)!;
    d.ranger(w.id, b.id);
    const r = await draupnirPost({} as never, '/api/draupnir/save', { flow: { ...copie, name: 'Modifiée' } }) as { ok: boolean; flow: Workflow };
    assert.equal(r.ok, true);
    assert.equal(r.flow.name, 'Modifiée');
    assert.equal(r.flow.dossier, b.id, 'toujours dans B');
    // Une automatisation neuve garde le dossier choisi dans « Ranger dans quel dossier ? ».
    const n = await draupnirPost({} as never, '/api/draupnir/save', { flow: flux({ dossier: a.id }) }) as { ok: boolean; flow: Workflow };
    assert.equal(n.flow.dossier, a.id);
  } finally { setDraupnir(undefined); d.stop(); rmSync(home, { recursive: true, force: true }); }
});

test('P2. les noms de dossier acceptent le liant et l\'antiliant sans chasse (persan, langues de l\'Inde, émojis composés)', () => {
  for (const nom of ['می‌خواهم', '👨‍👩‍👧 Famille', 'क्‍ष']) assert.equal(validerNomDossier(nom, []), nom);
  assert.throws(() => validerNomDossier('a​b', []), /caractère interdit/, 'l\'espace sans chasse reste interdite');
  assert.throws(() => validerNomDossier('a‮b', []), /caractère interdit/, 'l\'inversion de sens reste interdite');
});

test('P3. une restauration coupée au milieu ne laisse ni doublon ni perte', () => avecTalos((d, home) => {
  // Coupure juste après l'écriture dans flows/ : simulée par un enregistrement qui écrit puis lève.
  class Coupee extends Talos { coupe = false; override save(i: Partial<Workflow>): Workflow { const w = super.save(i); if (this.coupe) throw new Error('coupure'); return w; } }
  const c = new Coupee(home, {});
  const w = c.save(flux({ id: 'perso', name: 'Perso' }));
  c.trash(w.id);
  const cle = c.listeCorbeille()[0].cle;
  c.coupe = true;
  assert.throws(() => c.restaurerCorbeille(cle), /coupure/);
  c.coupe = false;
  assert.equal(c.list().length, 1, 'revenue dans flows/');
  assert.equal(c.listeCorbeille().length, 0, 'plus dans la corbeille : pas de second exemplaire possible');
  c.stop();
  // Coupure entre le renommage et l'enregistrement : le fichier retourne à la corbeille au passage suivant.
  const x = d.save(flux({ id: 'autre', name: 'Autre' })); d.trash(x.id);
  const k = d.listeCorbeille()[0].cle, dir = join(home, 'draupnir', 'corbeille');
  renameSync(join(dir, `${k}.json`), join(dir, `${k}.vers-autre.restauration`));
  assert.deepEqual(d.listeCorbeille().map((e) => e.cle), [k], 'retournée dans la corbeille');
  // Coupure après l'enregistrement, avant l'effacement : le reste est effacé au passage suivant.
  writeFileSync(join(home, 'draupnir', 'flows', 'autre.json'), JSON.stringify({ ...flux(), id: 'autre', name: 'Autre' }));
  renameSync(join(dir, `${k}.json`), join(dir, `${k}.vers-autre.restauration`));
  assert.equal(d.listeCorbeille().length, 0);
  assert.equal(readdirSync(dir).some((f) => f.endsWith('.restauration')), false);
}));

test('P3 bis. jeter déplace le fichier : jamais à la fois dans flows/ et dans la corbeille', () => avecTalos((d, home) => {
  const w = d.save(flux({ id: 'perso' }));
  d.trash(w.id);
  assert.equal(existsSync(join(home, 'draupnir', 'flows', 'perso.json')), false);
  const f = readdirSync(join(home, 'draupnir', 'corbeille')).filter((x) => x.endsWith('.json'));
  assert.equal(f.length, 1);
  const lu = JSON.parse(readFileSync(join(home, 'draupnir', 'corbeille', f[0]), 'utf8'));
  assert.equal(lu.corbeille.etaitActive, false, 'la trace est ajoutée');
}));

test('P7. écriture atomique : un échec en écrivant laisse l\'ancien fichier entier', () => {
  const dir = jetable();
  try {
    const f = join(dir, 'x.json');
    ecrireJson(f, { v: 1 });
    mkdirSync(`${f}.${process.pid}.tmp`); // le fichier temporaire ne peut pas être écrit
    assert.throws(() => ecrireJson(f, { v: 2 }));
    assert.deepEqual(JSON.parse(readFileSync(f, 'utf8')), { v: 1 });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
