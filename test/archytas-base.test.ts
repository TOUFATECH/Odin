// Archytas — l'entrepôt (base « mémoire » : fichiers dans un dossier temporaire, sans PostgreSQL). On crée,
// liste, voit et supprime des scripts ; et on vérifie que le CODE n'apparaît JAMAIS dans un résumé (v_scripts)
// ni en clair sur le disque (il est chiffré au repos).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { creerMoteur } from '../src/valhalla/archytas/scripts.ts';
import { EntrepotFichiers } from '../src/valhalla/archytas/base.ts';

const tmp = () => mkdtempSync(join(tmpdir(), 'archytas-base-'));

test('créer, lister, voir, supprimer un script (entrepôt en fichiers)', async () => {
  const home = tmp();
  try {
    const m = creerMoteur({ entrepot: new EntrepotFichiers(home) });
    const r = await m.creer({ nom: 'Arroser le jardin', mission: 'arroser à 7 h', description: 'ouvre la vanne', genre: 'declaratif', etapes: [{ faire: 'action', module: 'jardin', action: 'ouvrir' }], declencheurs: [{ genre: 'manuel' }] });
    assert.equal(r.nom, 'Arroser le jardin');
    assert.equal(r.version, 1);
    assert.equal(r.stat.runs, 0);

    const liste = await m.lister();
    assert.equal(liste.length, 1);
    assert.equal(liste[0].nom, 'Arroser le jardin');

    const detail = await m.voir('Arroser le jardin');
    assert.ok(detail);
    assert.deepEqual(detail!.etapes, [{ faire: 'action', module: 'jardin', action: 'ouvrir' }]);

    // Un même nom une seule fois.
    await assert.rejects(() => m.creer({ nom: 'Arroser le jardin', mission: 'x', description: '', genre: 'declaratif', etapes: [], declencheurs: [{ genre: 'manuel' }] }), /existe déjà/);

    await m.supprimer('Arroser le jardin');
    assert.equal((await m.lister()).length, 0);
    assert.equal(await m.voir('Arroser le jardin'), undefined);
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test('le code d\'un script n\'apparaît jamais dans un résumé ni en clair sur le disque', async () => {
  const home = tmp();
  const SECRET = 'const jeton = "sk-SUPERSECRET-ABC12345"; // ne doit jamais fuiter';
  try {
    const m = creerMoteur({ entrepot: new EntrepotFichiers(home) });
    await m.creer({ nom: 'Script code', mission: 'faire un calcul', description: 'additionne', genre: 'code', code: SECRET, declencheurs: [{ genre: 'manuel' }] });

    // Le résumé (v_scripts) ne porte jamais ni code ni étapes.
    const resume = (await m.lister())[0] as unknown as Record<string, unknown>;
    assert.ok(!('code' in resume), 'pas de champ code dans le résumé');
    assert.ok(!('etapes' in resume), 'pas de champ etapes dans le résumé');
    assert.doesNotMatch(JSON.stringify(await m.lister()), /SUPERSECRET/, 'le code ne fuite pas dans la liste');

    // Le détail (propriétaire) rend bien le code (déchiffré).
    const detail = await m.voir('Script code');
    assert.equal(detail!.code, SECRET);

    // Sur le disque, le code est chiffré (jamais en clair).
    const dir = join(home, 'valhalla', 'archytas', 'scripts');
    const brut = readdirSync(dir).map((f) => readFileSync(join(dir, f), 'utf8')).join('\n');
    assert.doesNotMatch(brut, /SUPERSECRET/, 'le code est chiffré au repos (jamais en clair sur le disque)');
    assert.match(brut, /odc1:/, 'le champ chiffré est bien présent');
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test('versions : chaque modification garde une version, le retour arrière est possible', async () => {
  const home = tmp();
  try {
    const m = creerMoteur({ entrepot: new EntrepotFichiers(home) });
    await m.creer({ nom: 'S', mission: 'm', description: '', genre: 'declaratif', etapes: [{ faire: 'poser', variable: 'a', valeur: '1' }], declencheurs: [{ genre: 'manuel' }] });
    await m.editer('S', { etapes: [{ faire: 'poser', variable: 'a', valeur: '2' }] });
    const vs = await m.versions('S');
    assert.ok(vs.length >= 2, 'au moins deux versions gardées');
    assert.ok(existsSync(join(home, 'valhalla', 'archytas', 'versions')));
  } finally { rmSync(home, { recursive: true, force: true }); }
});
