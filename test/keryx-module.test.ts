// Kéryx — la page doit être JOIGNABLE dans un vrai Odin. Régression du défaut : keryx n'était pas un module, donc
// /api/valhalla/view?id=keryx répondait « appli inconnue » et la page (OdinPages.keryx) n'était jamais ni dans la
// grille des applis ni ouverte. Ici on vérifie que keryx est bien un module enregistré, avec une vue qui s'affiche.
// UN FICHIER À LA FOIS.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { allModules } from '../src/valhalla/odin.ts';
import { rename, NAME_STORY, SIMILAIRES, similairesDe } from '../src/valhalla/names.ts';

const modules = (): ReturnType<typeof allModules> => {
  const h = mkdtempSync(join(tmpdir(), 'keryx-mod-'));
  try { return allModules({ paths: { home: h, workspace: h }, cfg: { venus: {}, voice: {} } } as never).map(rename); }
  finally { rmSync(h, { recursive: true, force: true }); }
};

test('keryx est un module enregistré (sinon /api/valhalla/view?id=keryx → « appli inconnue »)', () => {
  const m = modules().find((x) => x.id === 'keryx');
  assert.ok(m, 'keryx figure dans allModules : la grille le montre et openApp le trouve');
  assert.equal(m!.name, 'Kéryx');
  assert.ok(['Données', 'Machines', 'Accès', 'Sécurité', 'Maison'].includes(m!.family), 'famille valide');
  assert.ok(m!.what.trim(), 'a un « ce qu\'elle fait »');
  assert.ok(NAME_STORY.keryx?.trim(), 'a l\'histoire de son nom');
});

test('keryx : sa vue s\'affiche (la page custom OdinPages.keryx prend ensuite la main) ; « Alternative à » = Instinct', async () => {
  const m = modules().find((x) => x.id === 'keryx')!;
  const v = await m.view({ home: '', dir: '', settings: {} } as never, new URLSearchParams());
  assert.ok(Array.isArray(v.sections), 'la vue rend une liste de sections (même vide : la page custom gère le reste)');
  // « Alternative à » : Instinct, et seulement là (jamais « copié » / « inspiré de »).
  assert.deepEqual(SIMILAIRES.keryx, ['Instinct']);
  assert.ok(similairesDe(m).some((x) => x.nom === 'Instinct'), 'Instinct apparaît comme alternative');
});
