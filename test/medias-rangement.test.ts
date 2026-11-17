// Médias reçus : préparer le rangement (pur). Aucun fait sensible ; sujets à relier ; suppression seulement d'un
// téléchargement d'Odin dans ses dossiers de travail, jamais d'un fichier du propriétaire.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { comprendreFichier } from '../src/medias/comprendre.ts';
import { peutSupprimer, preparerRangement } from '../src/medias/rangement.ts';
import { empreinteFichier, inscrireTelechargement } from '../src/medias/telecharges.ts';
import * as F from './medias-fabriquer.ts';

let ws = '', dehors = '';
before(() => { ws = mkdtempSync(join(tmpdir(), 'odin-medias-')); dehors = mkdtempSync(join(tmpdir(), 'odin-medias-')); });
after(() => { rmSync(ws, { recursive: true, force: true }); rmSync(dehors, { recursive: true, force: true }); });

test('photo : aucun fait ne contient coordonnées, heure ni numéro de série', async () => {
  const p = join(ws, 'photo.jpg');
  writeFileSync(p, F.jpegExif({ date: '2026:08:14 17:32:05', marque: 'Fairphone', modele: 'FP5', lat: -12.7806, lon: 45.2275, serie: 'SN-778899' }));
  const c = await comprendreFichier({ chemin: p }, { briques: { absentes: [] }, dossierSortie: join(ws, 'sortie') });
  const r = preparerRangement(c, { provenance: 'joint', chemin: p, workspace: ws, quand: Date.UTC(2026, 10, 17, 12) });
  const tout = JSON.stringify([r.apport, r.reception, r.note]);
  for (const interdit of ['12.78', '12,78', '45.22', '45,22', '17:32', 'SN-778899']) assert.ok(!tout.includes(interdit), interdit);
  assert.ok(r.apport.faits.some((f) => f.texte.includes('Fairphone FP5')));
  assert.deepEqual(r.note.sujets, ['Fairphone FP5']);
  // La fiche locale, elle, garde tout (elle reste sur la machine).
  assert.ok(r.ficheLocale.compris.fiche.position);
  assert.equal(r.suppression.supprimer, false);
});

test('musique : sujets = artiste, album, compositeur, label ; faits tirés de la fiche', async () => {
  const p = join(ws, 'lagon.mp3');
  writeFileSync(p, F.mp3Id3({ version: 3, xing: 100, trames: [['TIT2', F.texteId3('Lagon bleu')], ['TPE1', F.texteId3('Awa Saïd')], ['TALB', F.texteId3('Mamoudzou Sessions')], ['TCOM', F.texteId3('Saïd Ali')], ['TPUB', F.texteId3('Label Ylang')]] }));
  const c = await comprendreFichier({ chemin: p }, { briques: { absentes: [] }, dossierSortie: join(ws, 'sortie') });
  const r = preparerRangement(c, { provenance: 'joint', chemin: p, workspace: ws, quand: Date.now(), canal: 'web' });
  for (const s of ['Awa Saïd', 'Mamoudzou Sessions', 'Saïd Ali', 'Label Ylang', 'Lagon bleu']) assert.ok(r.note.sujets.includes(s), s);
  assert.ok(r.apport.faits.some((f) => f.texte === 'La musique « Lagon bleu » est interprétée par Awa Saïd'));
  assert.equal(r.reception.proprietaire, true);
  assert.equal(r.note.genre, 'son');
});

test('peutSupprimer : vrai seulement pour un téléchargement inscrit dans les dossiers de travail d\'Odin', async () => {
  mkdirSync(join(ws, '.odin-tmp'), { recursive: true });
  mkdirSync(join(ws, 'inbox'), { recursive: true });
  const tmp = join(ws, '.odin-tmp', 'x.jpg'), joint = join(ws, 'inbox', '2026-11-17-photo.jpg'), img = join(ws, 'inbox', 'image-1731840000.jpg'), ext = join(dehors, 'y.jpg');
  for (const f of [tmp, joint, img, ext]) writeFileSync(f, 'x');
  // Sans inscription au registre des téléchargements d'Odin : jamais supprimé, même dans ses dossiers de travail.
  const empreinte = await empreinteFichier(tmp);
  assert.equal(peutSupprimer(tmp, { provenance: 'telecharge', workspace: ws, empreinte }).supprimer, false);
  for (const f of [tmp, img, joint, ext]) await inscrireTelechargement(ws, f);
  assert.equal(peutSupprimer(tmp, { provenance: 'telecharge', workspace: ws, empreinte }).supprimer, true);
  assert.equal(peutSupprimer(img, { provenance: 'telecharge', workspace: ws, empreinte }).supprimer, true);
  assert.equal(peutSupprimer(tmp, { provenance: 'telecharge', workspace: ws }).supprimer, false, 'sans empreinte : gardé');
  assert.equal(peutSupprimer(tmp, { provenance: 'joint', workspace: ws }).supprimer, false);
  assert.equal(peutSupprimer(joint, { provenance: 'telecharge', workspace: ws }).supprimer, false);
  assert.equal(peutSupprimer(joint, { provenance: 'joint', workspace: ws }).raison, 'c\'est ton fichier : je le garde');
  assert.equal(peutSupprimer(ext, { provenance: 'telecharge', workspace: ws }).supprimer, false);
});

test('peutSupprimer : un lien du workspace vers l\'extérieur n\'est jamais supprimé', (t) => {
  const lien = join(ws, '.odin-tmp', 'lien.jpg');
  mkdirSync(join(ws, '.odin-tmp'), { recursive: true });
  writeFileSync(join(dehors, 'cible.jpg'), 'x');
  try { symlinkSync(join(dehors, 'cible.jpg'), lien); }
  catch { t.diagnostic('création de lien symbolique refusée sur cette machine : vérification sautée'); t.skip('lien symbolique non permis'); return; }
  assert.equal(peutSupprimer(lien, { provenance: 'telecharge', workspace: ws }).supprimer, false);
});
