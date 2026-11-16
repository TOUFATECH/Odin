// Genèse · clé USB : le dossier /ecran-odin (écran graphique hors ligne). On vérifie qu'il contient la page /ecran
// (réutilisée), le systemes.json figé servi là où la page le cherche, et un calque Alpine (kiosque) qui sert le
// dossier en local et, au choix, règle le défaut de Ventoy puis redémarre — le tout SANS serveur Odin.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gunzipSync } from 'node:zlib';
import { buildEcranOffline } from '../src/valhalla/thjalfi/ecran-offline.ts';
import { untar } from '../src/valhalla/thjalfi/ecran-pc.ts';
import { ecranPage } from '../src/valhalla/thjalfi/ecran-page.ts';

const etat = { systemes: [{ id: 'a', name: 'ubuntu-24.04.iso', title: 'Ubuntu', modes: ['installer'] }], disposition: 'liste', theme: 'matrix', dit: { _: 'Choisis.' } };

test('bundle complet : page /ecran réutilisée, systemes.json figé, servi à /ecran/etat', () => {
  const b = buildEcranOffline(etat as never);
  assert.equal(b.fichiers['index.html'], ecranPage(), 'la page /ecran telle quelle (pas recopiée)');
  const fige = JSON.parse(b.fichiers['systemes.json']);
  assert.equal(fige.theme, 'matrix');
  assert.equal(fige.systemes[0].name, 'ubuntu-24.04.iso');
  // La page va chercher fetch('/ecran/etat') : le fichier est servi à ce chemin.
  assert.equal(b.fichiers['ecran/etat'], b.fichiers['systemes.json']);
  assert.ok(b.fichiers['LISEZMOI.txt'].includes('SANS serveur Odin') || b.fichiers['LISEZMOI.txt'].includes('sans serveur'), 'dit qu\'il marche hors ligne');
});

test('le choix règle le défaut de Ventoy et redémarre ; aucun serveur Odin requis', () => {
  const b = buildEcranOffline(etat as never);
  const choisir = b.fichiers['cgi-bin/choisir'];
  assert.match(choisir, /grub-editenv/, 'écrit le défaut de Ventoy (grubenv)');
  assert.match(choisir, /odin_next/, 'la variable lue au redémarrage');
  assert.match(choisir, /reboot/, 'redémarre pour lancer le système');
  assert.match(b.fichiers['odin.cfg'], /odin_next/, 'le bout GRUB lit le choix au redémarrage');
});

test('overlay Alpine : kiosque hors ligne (httpd local), paquets du kiosque, aucun réseau', () => {
  const b = buildEcranOffline(etat as never);
  const files = untar(gunzipSync(b.overlay));
  const world = files.get('etc/apk/world')!.toString('utf8');
  for (const p of ['cage', 'chromium', 'busybox']) assert.ok(world.includes(p), `paquet ${p}`);
  const start = files.get('etc/local.d/odin-ecran-cle.start')!.toString('utf8');
  assert.match(start, /busybox httpd/, 'sert le dossier en local');
  assert.match(start, /127\.0\.0\.1/, 'seulement en local (pas de serveur Odin)');
  assert.match(start, /mount -L ODIN/, 'monte la 1re partition de la clé');
  assert.ok(!/192\.168\.|\/ecran\/ovl/.test(start), 'aucune adresse réseau d\'Odin');
});
