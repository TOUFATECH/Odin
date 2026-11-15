// Arche · 2e site : chaque sauvegarde de base est copiée ailleurs (ici un autre disque ; le partage réseau et le
// serveur SFTP passent par le même mécanisme) puis relue (empreinte comparée) ; une copie abîmée est vue,
// « Rattraper » recopie, et le 2e site garde les mêmes sauvegardes qu'ici.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Valhalla } from '../src/valhalla/service.ts';
import { skuld, useTools } from '../src/valhalla/modules/skuld.ts';
import { saveBases } from '../src/valhalla/urdr/bases.ts';

test('Arche : copie vérifiée au 2e site, copie abîmée repérée, rattrapage, même durée de garde', async () => {
  const home = mkdtempSync(join(tmpdir(), 'arche-')), loin = join(home, 'nas', 'arche');
  saveBases(home, [{ id: 'notes', nom: 'Notes', type: 'postgres', utilisateur: 'app_notes', base: 'app_notes', conteneur: 'odin-pg', ajoutee: new Date().toISOString() }]);
  let n = 0;
  useTools(() => ({ has: async () => false, inContainer: async () => ({ cmd: process.execPath, args: ['-e', `process.stdout.write('PGDMP-archive-de-test-${++n}')`], env: {} }) }));
  const v = new Valhalla(home, [skuld]);
  try {
    // Sans 2e site : la sauvegarde reste ici seulement.
    assert.doesNotMatch((await v.act('skuld', 'sauvegarder', { base: 'notes' })).text, /2e site/);
    // Un chemin relatif est refusé ; un vrai dossier est essayé (écriture puis relecture).
    assert.match((await v.act('skuld', 'second_site', { genre: 'disque', dossier: 'relatif' })).text, /chemin absolu/);
    assert.match((await v.act('skuld', 'second_site', { genre: 'disque', dossier: loin })).text, /🏝 2e site : .*écriture et relecture vérifiées/);
    assert.deepEqual(readdirSync(loin), [], 'le fichier d\'essai est effacé');
    // Rattraper : la sauvegarde d'avant part au 2e site.
    assert.match((await v.act('skuld', 'rattraper_site')).text, /1 sauvegarde\(s\) copiée\(s\) et vérifiée\(s\)/);
    await new Promise((r) => setTimeout(r, 1100)); // un autre nom d'archive (à la seconde près)
    const r = await v.act('skuld', 'sauvegarder', { base: 'notes' });
    assert.match(r.text, /2e site : copiée et vérifiée sur/);
    const copies = readdirSync(join(loin, 'notes')).sort(); assert.equal(copies.length, 2);
    assert.match((await v.act('skuld', 'verifier_site')).text, /2 copie\(s\) identiques/);
    // Une copie abîmée sur le 2e site : vue, alerte, puis recopiée.
    writeFileSync(join(loin, 'notes', copies[0]), 'abîmé');
    const vf = await v.act('skuld', 'verifier_site'); assert.equal(vf.ok, false); assert.match(vf.text, /copie différente de l'original/);
    assert.ok(v.alerts().some((a) => /abîmées/.test(a.title) && a.fix?.action === 'rattraper_site'));
    assert.match((await v.act('skuld', 'rattraper_site')).text, /1 sauvegarde\(s\) copiée\(s\)/);
    assert.match((await v.act('skuld', 'verifier_site')).text, /2 copie\(s\) identiques/);
    // Une sauvegarde qui n'est plus gardée ici disparaît aussi du 2e site à la copie suivante.
    rmSync(join(home, 'valhalla', 'skuld', 'archives', 'notes', copies[0]));
    await new Promise((r2) => setTimeout(r2, 1100));
    await v.act('skuld', 'sauvegarder', { base: 'notes' });
    assert.ok(!existsSync(join(loin, 'notes', copies[0]))); assert.equal(readdirSync(join(loin, 'notes')).length, 2);
    const h = (await v.act('skuld', 'historique')).data as Array<{ copie?: string }>; assert.match(h[0].copie ?? '', /vérifiée/);
    const page = await skuld.view(v.ctx('skuld'), new URLSearchParams());
    assert.ok(page.kpis?.some((k) => k.label === '2e site' && k.value === 'copie vérifiée'));
    // Un 2e site qui ne répond plus : la sauvegarde est bonne, la copie est signalée.
    v.ctx('skuld').saveSettings({ secondSite: { genre: 'sftp', poste: 'poste-inconnu', dossier: '/srv' } });
    await new Promise((r3) => setTimeout(r3, 1100));
    const ko = await v.act('skuld', 'sauvegarder', { base: 'notes' }); assert.match(ko.text, /💾 Notes sauvegardée .*⚠ 2e site : poste « poste-inconnu » inconnu/);
    assert.ok(v.alerts().some((a) => /copie au 2e site ratée/.test(a.title)));
    assert.match((await v.act('skuld', 'second_site', {})).text, /Plus de 2e site/);
  } finally { useTools(); v.stop(); rmSync(home, { recursive: true, force: true }); }
});
