// Genèse · clé USB (lot A) — COPIER une VM pour qu'elle démarre sur un vrai PC. On vérifie : la liste des VM via un
// FAUX Hydre (aucun vrai Proxmox) ; le plan de copie exige d'abord un arrêt propre / un instantané ; Windows →
// VHDX + pilotes, Linux → odin-boot ; une VM Proxmox sans disque exposé → voie « disque exporté déposé ». Aucune
// IO réelle, aucun vrai disque, aucun service contacté.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listerVms, planCopieVm, familleVm, type AppelHydre } from '../src/valhalla/thjalfi/cle-vm.ts';
import type { SourceVm } from '../src/valhalla/thjalfi/cle-types.ts';

/** Un faux Hydre : rend des données figées selon l'action demandée (jamais de vrai Proxmox). */
function fauxHydre(locales: unknown[], machines: unknown[]): AppelHydre {
  return {
    async call(_module, action) {
      if (action === 'locales') return { data: locales };
      if (action === 'machines') return { data: machines };
      return { data: [] };
    },
  };
}

test('listerVms : VM locales d\'Hydre (disque lisible) et VM Proxmox (sans disque)', async () => {
  const ctx = fauxHydre(
    [
      { id: 'a1', nom: 'debian-maison', genre: 'vm', systeme: 'Debian', version: '13' },
      { id: 'c2', nom: 'conteneur', genre: 'lxc', systeme: 'Ubuntu' }, // un LXC : ignoré
      { id: 'w3', nom: 'windows-bureau', genre: 'vm', systeme: 'Windows 11' },
    ],
    [{ vmid: 100, name: 'web-proxmox', server: 'pve1', type: 'qemu' }, { vmid: 101, name: 'lxc-proxmox', type: 'lxc' }],
  );
  const vms = await listerVms(ctx);
  assert.equal(vms.length, 3); // 2 VM locales + 1 VM Proxmox (le LXC Proxmox ignoré)
  const deb = vms.find((v) => v.nom === 'debian-maison')!;
  assert.equal(deb.origine, 'hydre-locale');
  assert.equal(deb.famille, 'linux');
  assert.ok(deb.disque); // disque lisible
  const win = vms.find((v) => v.nom === 'windows-bureau')!;
  assert.equal(win.famille, 'windows');
  const pve = vms.find((v) => v.origine === 'proxmox')!;
  assert.equal(pve.vmid, 100);
  assert.equal(pve.serveur, 'pve1');
  assert.equal(pve.disque, undefined); // Hydre n'expose pas le disque d'une VM Proxmox
});

test('listerVms : tolérant si Hydre ne rend rien (aucune VM)', async () => {
  const ctx: AppelHydre = { async call() { return {}; } };
  assert.deepEqual(await listerVms(ctx), []);
});

test('planCopieVm : refuse une VM non arrêtée / sans instantané (cohérence du disque)', () => {
  const src: SourceVm = { origine: 'hydre-locale', nom: 'debian', famille: 'linux', disque: 'vm/disque.qcow2', instantaneFait: false };
  const plan = planCopieVm(src);
  assert.equal(plan.possible, false);
  assert.match(plan.blocage ?? '', /arrête|instantané/i);
});

test('planCopieVm : Windows → VHDX Windows To Go + injection des pilotes', () => {
  const src: SourceVm = { origine: 'hydre-locale', nom: 'windows-bureau', famille: 'windows', disque: 'vm/disque.qcow2', instantaneFait: true };
  const plan = planCopieVm(src);
  assert.equal(plan.possible, true);
  assert.equal(plan.pilotesWindows, true);
  assert.match(plan.destination ?? '', /\/vdisk\/.*wintogo\.vhdx$/);
  assert.ok(plan.etapes.some((e) => /pilotes/i.test(e)));
});

test('planCopieVm : Linux → conversion si besoin puis odin-boot', () => {
  const src: SourceVm = { origine: 'hydre-locale', nom: 'debian', famille: 'linux', disque: 'debian.qcow2', instantaneFait: true };
  const plan = planCopieVm(src);
  assert.equal(plan.possible, true);
  assert.equal(plan.prepareOdinBoot, true);
  assert.match(plan.conversion ?? '', /qemu-img convert/); // qcow2 → brut
  assert.ok(plan.etapes.some((e) => /odin-boot/i.test(e)));
});

test('planCopieVm : VM Proxmox sans disque → voie « disque exporté déposé »', () => {
  const src: SourceVm = { origine: 'proxmox', vmid: 100, serveur: 'pve1', nom: 'web', famille: 'linux', instantaneFait: true };
  const plan = planCopieVm(src);
  assert.equal(plan.possible, false);
  assert.equal(plan.voieDepot, true);
  assert.match(plan.blocage ?? '', /exporte|dépose|déposé/i);
});

test('familleVm : Windows, Linux, inconnu', () => {
  assert.equal(familleVm('Windows 11'), 'windows');
  assert.equal(familleVm('Ubuntu 24.04'), 'linux');
  assert.equal(familleVm('quelque chose'), 'inconnu');
});
