// Genèse · clé USB — odin-boot (notre vtoyboot) : génération des hooks initramfs-tools / dracut / mkinitcpio,
// et préparation SIMULÉE sur un faux disque virtuel (jamais un vrai).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scriptOdinBoot, hookInitramfsTools, localTopInitramfs, dracutModuleSetup, dracutHook, mkinitcpioHook, mkinitcpioInstall, fichiersOdinBoot, preparerDisque, LABEL_CLE } from '../src/valhalla/thjalfi/odin-boot.ts';

test('le script principal gère les trois générateurs d\'initramfs', () => {
  const s = scriptOdinBoot();
  assert.match(s, /initramfs-tools/);
  assert.match(s, /dracut/);
  assert.match(s, /mkinitcpio/);
  // La référence au principe de vtoyboot est citée, pas recopiée.
  assert.match(s, /github\.com\/ventoy\/vtoyboot/);
  assert.match(s, /^#!\/bin\/sh/);
});

test('les hooks cherchent la clé ODIN et montent le disque virtuel', () => {
  for (const f of [hookInitramfsTools(), localTopInitramfs(), dracutHook(), mkinitcpioHook()]) {
    assert.ok(f.length > 20);
  }
  assert.match(localTopInitramfs(), new RegExp(`blkid -L ${LABEL_CLE}`));
  assert.match(dracutHook(), /losetup/);
  assert.match(mkinitcpioHook(), /\/vdisk\//);
  assert.match(dracutModuleSetup(), /inst_hook pre-mount/);
  assert.match(mkinitcpioInstall(), /add_runscript/);
});

test('le script posé a un CONTENU réel (pas un crochet vide) : copy_exec et blkid -L ODIN inlinés', () => {
  const s = scriptOdinBoot();
  // Les corps des crochets sont inlinés (ici-documents), pas des variables d'environnement jamais définies.
  assert.doesNotMatch(s, /\$ODIN_HOOK_INITRAMFS|\$ODIN_LOCALTOP|\$ODIN_DRACUT_SETUP|\$ODIN_DRACUT_HOOK|\$ODIN_MKINITCPIO_HOOK|\$ODIN_MKINITCPIO_INSTALL/);
  assert.match(s, /copy_exec \/sbin\/losetup/);
  assert.match(s, new RegExp(`blkid -L ${LABEL_CLE}`));
  assert.match(s, /inst_hook pre-mount/);
  assert.match(s, /add_runscript/);
  // cat > "$1" (ici-document) remplace le printf '%s' "$2" qui écrivait du vide.
  assert.match(s, /poser_fichier\(\) \{ mkdir -p "\$\(dirname "\$1"\)"; cat > "\$1"; \}/);
});

test('fichiersOdinBoot : tous les fichiers à poser', () => {
  const f = fichiersOdinBoot();
  assert.ok(f['odin-boot']);
  assert.ok(f['hooks/odin-boot']);
  assert.ok(f['dracut/99odinboot/module-setup.sh']);
  assert.ok(f['mkinitcpio/install/odinboot']);
});

test('préparation simulée dans une VM : aucun vrai disque, le script est passé', async () => {
  let recu = '';
  const r = await preparerDisque({ vm: 'ubuntu-test' }, { dansVm: async (_vm, script) => { recu = script; return { ok: true, sortie: '' }; } });
  assert.equal(r.ok, true);
  assert.match(recu, /odin-boot/);
  assert.match(r.message, /ubuntu-test/);
});

test('préparation simulée sur un disque éteint : copie de sauvegarde annoncée', async () => {
  const r = await preparerDisque({ disque: '/tmp/faux.img' }, { surDisqueEteint: async (chemin) => ({ ok: true, sortie: '', sauvegarde: `${chemin}.bak` }) });
  assert.equal(r.ok, true);
  assert.equal(r.sauvegarde, '/tmp/faux.img.bak');
});

test('sans exécuteur adapté : refus clair, rien n\'est tenté', async () => {
  assert.equal((await preparerDisque({ vm: 'x' }, {})).ok, false);
  assert.equal((await preparerDisque({}, {})).ok, false);
});
