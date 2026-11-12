// Le lien des applis avec la mémoire d'Odin : événements, alertes et actions rangés chaque jour dans le Cerveau,
// sans secret (champs sensibles retirés, texte masqué), état des applis une fois par jour, vieux jours à la corbeille.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Vault } from '../src/brain/vault.ts';
import { Valhalla } from '../src/valhalla/service.ts';
import { allModules } from '../src/valhalla/odin.ts';
import { DEFAULT_CONFIG } from '../src/config.ts';
import { AppJournal, clean } from '../src/valhalla/journal.ts';

test('journal des applis dans le Cerveau, sans secret', async () => {
  assert.equal(clean({ nom: 'PC de Nour', mot_de_passe: 'x', token: 'y', cle: 'z', objet: { a: 1 }, ip: '192.168.1.20' }), 'nom : PC de Nour · ip : 192.168.1.20');
  const home = mkdtempSync(join(tmpdir(), 'journal-'));
  try {
    let now = new Date('2026-11-12T10:00:00');
    const v = new Valhalla(home, allModules({ paths: { home, workspace: home }, cfg: DEFAULT_CONFIG } as never), { run: async () => ({ code: 1, out: '', err: '' }), fetch, notify: async () => {}, autonomy: () => 'equilibre', now: () => now } as never);
    const vault = new Vault(join(home, 'cerveau')), j = new AppJournal(v, vault, (t) => t.replaceAll('SECRET-42', '••••'), () => now, 3600_000);
    v.ctx('vidarr').emit('machine_coupee', { ip: '192.168.1.20', nom: 'PC de Nour', jeton: 'SECRET-42' });
    v.ctx('ullr').alert({ level: 'haute', title: 'Fichier suspect', detail: 'clé SECRET-42 vue\nautre ligne', key: 'k1' });
    await v.act('gladsheim', 'theme', { theme: 'plage' });
    await v.act('gladsheim', 'boutons');
    assert.ok(await j.flush() >= 3);
    const note = vault.read('Odin/Journal des applis/2026-11-12.md')!;
    assert.ok(note, 'note du jour');
    assert.match(note.body, /## \[\[Víðarr\]\]\n- 10:00 · machine coupee — ip : 192\.168\.1\.20 · nom : PC de Nour/);
    assert.match(note.body, /alerte haute : Fichier suspect — clé •••• vue/);
    assert.match(note.body, /fait : Thème \(par toi\)/); assert.ok(!/fait : Boutons/.test(note.body), 'les lectures ne sont pas notées');
    assert.ok(!note.body.includes('SECRET-42'), 'aucun secret');
    assert.match(note.body, /## État des applis\n- \[\[/);
    // Le lendemain : nouvelle note ; au-delà de 90 jours : corbeille.
    vault.write('Odin/Journal des applis/2026-08-01.md', { type: 'journal' }, '# vieux');
    now = new Date('2026-11-13T09:00:00'); v.ctx('eitri').emit('telecharge', { nom: 'Ubuntu', version: '24.04.4' }); await j.flush();
    assert.match(vault.read('Odin/Journal des applis/2026-11-13.md')!.body, /telecharge — nom : Ubuntu · version : 24\.04\.4/);
    assert.equal(vault.read('Odin/Journal des applis/2026-08-01.md'), undefined);
    assert.ok(vault.search('PC de Nour').length >= 1, 'Odin retrouve l\'info dans sa mémoire');
    await j.stop(); v.stop();
  } finally { rmSync(home, { recursive: true, force: true }); }
});
