// Essais du bloqueur intégré de Pégase Android : le vrai fichier de l'extension, chargé dans Node.
// node --test pegase-android/essais-node/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const ext = new URL('../app/src/main/assets/extensions/bloqueur/', import.meta.url);
// Le fichier tel qu'il part dans l'APK, exécuté comme un script classique (le dépôt d'Odin est en modules ES).
const module = { exports: {} };
new Function('module', readFileSync(new URL('filtres.js', ext), 'utf8'))(module);
const Filtres = module.exports;
const regles = Filtres.preparer(JSON.parse(readFileSync(new URL('filtres.json', ext), 'utf8')));
const manifeste = JSON.parse(readFileSync(new URL('manifest.json', ext), 'utf8'));

test('les pubs et pisteurs tiers sont bloqués', () => {
  const page = 'https://www.toufatech.com/devis';
  assert.equal(Filtres.bloquer(regles, 'https://securepubads.g.doubleclick.net/tag/js/gpt.js', page, 'script'), true);
  assert.equal(Filtres.bloquer(regles, 'https://www.google-analytics.com/analytics.js', page, 'script'), true);
  assert.equal(Filtres.bloquer(regles, 'https://cdn.exemple.yt/static/prebid.min.js', page, 'script'), true, 'chemin tiers');
  assert.equal(Filtres.bloquer(regles, 'https://static.criteo.net/js/ld/publishertag.js', page, 'script'), true);
});

test('le site lui-même et le reste passent', () => {
  const page = 'https://www.toufatech.com/devis';
  assert.equal(Filtres.bloquer(regles, 'https://www.toufatech.com/js/app.js', page, 'script'), false);
  assert.equal(Filtres.bloquer(regles, 'https://www.toufatech.com/pagead/x.js', page, 'script'), false, 'chemin sur le site même');
  assert.equal(Filtres.bloquer(regles, 'https://fonts.gstatic.com/s/plex.woff2', page, 'font'), false);
  assert.equal(Filtres.bloquer(regles, 'https://doubleclick.net/', 'https://doubleclick.net/', 'main_frame'), false, 'jamais la page elle-même');
  assert.equal(Filtres.bloquer(regles, 'https://www.criteo.com/img/logo.png', 'https://www.criteo.com/fr/', 'image'), false, 'visiter le site d’une régie');
  assert.equal(Filtres.bloquer(regles, 'data:image/png;base64,AAAA', page, 'image'), false);
  assert.equal(Filtres.bloquer(regles, 'https://clarity.microsoft.com/x', page, 'script'), false, 'exception');
});

test('outils', () => {
  assert.equal(Filtres.hote('https://user@WWW.Exemple.YT:8443/a?b#c'), 'www.exemple.yt');
  assert.equal(Filtres.hote('pas une adresse'), '');
  assert.equal(Filtres.racineDe('a.b.mayotte.com.yt'), 'mayotte.com.yt');
  assert.equal(Filtres.racineDe('192.168.1.10'), '192.168.1.10');
  assert.ok(regles.n > 50);
});

test('le manifeste de l’extension intégrée', () => {
  assert.equal(manifeste.manifest_version, 2);
  assert.equal(manifeste.browser_specific_settings.gecko.id, 'bloqueur@pegase.toufatech');
  for (const p of ['webRequest', 'webRequestBlocking', 'nativeMessaging', 'nativeMessagingFromContent', 'geckoViewAddons']) {
    assert.ok(manifeste.permissions.includes(p), p);
  }
  assert.deepEqual(manifeste.background.scripts, ['filtres.js', 'fond.js']);
  // Les scripts se lisent (pas d'erreur de syntaxe).
  for (const f of ['fond.js', 'page.js']) new Function(readFileSync(new URL(f, ext), 'utf8'));
});
