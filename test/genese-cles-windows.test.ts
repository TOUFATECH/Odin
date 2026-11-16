// Genèse · clés d'activation Windows : format vérifié, édition reconnue dans le nom de l'image, clé gardée chiffrée
// (jamais en clair, jamais renvoyée en entier à la page), injectée dans unattend.xml au déploiement ; sans clé pour
// l'édition, l'emplacement <Key> reste vide.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EDITIONS, cleInjectable, editionParId, cleEnClair, clePourImage, clesPubliques, deposerCle, editionDeImage, editionDepuisChoix, indiceCle, masque, normaliserCle, supprimerCle } from '../src/valhalla/thjalfi/cles-windows.ts';
import { unattend, type Answer } from '../src/valhalla/thjalfi/recipes.ts';

test('clés Windows : format, reconnaissance, coffre, injection', () => {
  // --- Format de la clé ---
  assert.equal(normaliserCle('AAAAA-BBBBB-CCCCC-DDDDD-EEEEE'), 'AAAAA-BBBBB-CCCCC-DDDDD-EEEEE');
  assert.equal(normaliserCle('aaaaa bbbbb ccccc ddddd eeeee'), 'AAAAA-BBBBB-CCCCC-DDDDD-EEEEE', 'espaces et minuscules tolérés');
  assert.equal(normaliserCle('AAAAABBBBBCCCCCDDDDDEEEEE'), 'AAAAA-BBBBB-CCCCC-DDDDD-EEEEE', 'sans tirets : regroupé par 5');
  assert.equal(normaliserCle('trop-court'), undefined);
  assert.equal(normaliserCle('AAAAA-BBBBB-CCCCC-DDDDD'), undefined, '4 groupes : refusé');
  assert.equal(indiceCle('AAAAA-BBBBB-CCCCC-DDDDD-EEEEE'), 'EEEEE');
  assert.equal(masque('EEEEE'), '•••••-•••••-•••••-•••••-EEEEE');

  // --- Reconnaissance de l'édition dans le nom de l'image ---
  assert.equal(editionDeImage('Windows 11 Pro 24H2')?.id, 'windows-11-pro');
  assert.equal(editionDeImage('Win11 Famille FR')?.id, 'windows-11-famille');
  assert.equal(editionDeImage('Windows Server 2022 Standard')?.id, 'windows-server-2022');
  assert.equal(editionDeImage('Windows 10 Entreprise')?.id, 'windows-10-entreprise');
  assert.equal(editionDeImage('Win11_24H2_French_x64'), undefined, 'édition ambiguë : rien, donc pas d\'injection');
  assert.equal(editionDepuisChoix('Windows 11 Pro')?.id, 'windows-11-pro');
  // Toutes les versions de Windows sont dans la liste (des plus anciennes aux plus récentes).
  assert.ok(EDITIONS.length >= 30, `beaucoup d'éditions (${EDITIONS.length})`);
  assert.equal(editionDeImage('fr_windows_7_ultimate_x64.iso')?.id, 'windows-7-integrale');
  assert.equal(editionDeImage('Windows 8.1 Pro')?.id, 'windows-8-1-pro', '8.1 avant 8');
  assert.equal(editionDeImage('fr_windows_xp_professional.iso')?.id, 'windows-xp-pro');
  assert.equal(editionDeImage('Windows 95')?.id, 'windows-95');
  // Windows ancien (XP et avant) : reconnu, mais pas d'injection automatique (installation à l'ancienne).
  assert.equal(cleInjectable(editionParId('windows-xp-pro')), false, 'XP : pas d\'injection auto');
  assert.equal(cleInjectable(editionParId('windows-11-pro')), true, 'Windows 11 : injection auto');

  // --- Dépôt / coffre / lecture masquée ---
  const home = mkdtempSync(join(tmpdir(), 'odin-cle-home-')), dir = mkdtempSync(join(tmpdir(), 'odin-cle-dir-'));
  try {
    const cle = 'ABCDE-FGHIJ-KLMNO-PQRST-UVWXY';
    deposerCle(home, dir, 'windows-11-pro', cle);
    const vues = clesPubliques(dir);
    assert.equal(vues.length, 1);
    assert.equal(vues[0].edition, 'Windows 11 Pro');
    assert.equal(vues[0].indice, 'UVWXY');
    // La clé n'apparaît jamais en entier dans ce qui part vers la page.
    assert.doesNotMatch(JSON.stringify(vues), /ABCDE/, 'la page ne reçoit jamais la clé en entier');
    // Mais Odin sait la relire au déploiement.
    assert.equal(cleEnClair(home, dir, 'windows-11-pro'), cle);
    assert.equal(clePourImage(home, dir, 'Windows 11 Pro 24H2'), cle, 'image de la même édition : clé injectée');
    assert.equal(clePourImage(home, dir, 'Windows 10 Pro'), undefined, 'autre édition : jamais la clé du Pro 11');
    assert.equal(clePourImage(home, dir, 'Win11_24H2_French_x64'), undefined, 'édition inconnue : rien');
    // Sur le disque, la clé est chiffrée (coffre), pas en clair.
    const surDisque = readFileSync(join(dir, 'cles-windows.json'), 'utf8');
    assert.doesNotMatch(surDisque, /ABCDE-FGHIJ/, 'jamais en clair sur le disque');
    assert.match(surDisque, /odc1:/, 'chiffrée par le coffre');
    // Remplacement puis suppression.
    deposerCle(home, dir, 'windows-11-pro', '11111-22222-33333-44444-55555');
    assert.equal(cleEnClair(home, dir, 'windows-11-pro'), '11111-22222-33333-44444-55555');
    assert.ok(supprimerCle(dir, 'windows-11-pro'));
    assert.equal(clesPubliques(dir).length, 0);
    assert.equal(cleEnClair(home, dir, 'windows-11-pro'), undefined);
  } finally { rmSync(home, { recursive: true, force: true }); rmSync(dir, { recursive: true, force: true }); }

  // --- Injection dans unattend.xml ---
  const a: Answer = { host: 'pc-1', user: 'admin', password: 'pw', locale: 'fr_FR.UTF-8', keymap: 'fr', timezone: 'Indian/Mayotte', packages: [], report: 'http://x/etat/t' };
  assert.match(unattend({ ...a, productKey: 'ABCDE-FGHIJ-KLMNO-PQRST-UVWXY' }, 'uefi'), /<Key>ABCDE-FGHIJ-KLMNO-PQRST-UVWXY<\/Key>/, 'clé déposée → injectée');
  assert.match(unattend(a, 'uefi'), /<Key><\/Key>/, 'pas de clé → emplacement vide (sans activation)');
});
