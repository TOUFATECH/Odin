// Clic droit maison, affichage mobile (vraie émulation : taille, densité, agent, tactile, réseau, pliable) et
// inspecteur (vrais outils de Chromium, en français, ancrés à droite / en bas, panneau Bouclier), dans le vrai Pégase.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lancer, serveur, pageDe, attendre, principal } from './banc.mjs';

test('clic droit, affichage mobile, inspecteur', { timeout: 240_000 }, async () => {
  const web = await serveur({
    '/': '<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><title>Mobile</title><h1 id="t">Bonjour</h1><a id="l" href="/deux">Réalisations</a><p style="height:2000px">x</p>',
    '/deux': '<!doctype html><title>Deux</title><p>deux</p>',
  });
  const { app, ui, fermer } = await lancer({ env: { PEGASE_DNS: 'systeme' } });
  const faire = (a, x) => ui.evaluate(([a, x]) => window.pegase.faire(a, x), [a, x]);
  try {
    await faire('ouvrir', { url: `${web.url}/` });
    const page = await pageDe(app, new RegExp(`^${web.url}/$`));
    await page.waitForSelector('#t');
    // ——— Clic droit sur la page : le menu de Pégase (maquette « Clic droit »), sans « Caster ».
    await page.click('#t', { button: 'right' });
    await ui.waitForSelector('.menu-page');
    const items = await ui.$$eval('.menu-page .item', (l) => l.map((b) => ({ t: b.textContent.trim(), off: b.disabled })));
    const noms = items.map((x) => x.t);
    for (const n of ['Retour', 'Avancer', 'Actualiser', 'Enregistrer sous', 'Imprimer', 'Traduire en français', 'Demander à Odin sur cette page', 'Affichage mobile', 'Afficher le code source', 'Inspecter']) assert.ok(noms.some((x) => x.startsWith(n)), n);
    assert.ok(!noms.some((x) => /caster/i.test(x)), 'pas de Caster');
    assert.ok(items.find((x) => x.t.startsWith('Traduire')).off, 'traduction grisée sans Odin');
    await ui.keyboard.press('Escape');
    // Clic droit sur un lien : nouvel onglet, écran partagé, copier, enregistrer, Demander à Odin, Inspecter.
    await page.click('#l', { button: 'right' });
    await ui.waitForSelector('.menu-page >> text=Ouvrir dans un écran partagé');
    for (const n of ['Ouvrir dans un nouvel onglet', 'Copier l’adresse du lien', 'Enregistrer le lien sous', 'Demander à Odin sur ce lien', 'Inspecter']) assert.ok(await ui.$(`.menu-page >> text=${n}`), n);
    await ui.keyboard.press('Escape');

    // ——— Affichage mobile : vraie émulation de l'iPhone 18 Pro Max (440 × 956, ×3, agent, tactile).
    await page.click('#t', { button: 'right' });
    await ui.click('.menu-page >> text=Affichage mobile');
    await ui.waitForSelector('.barre-mobile');
    await attendre(async () => (await page.evaluate(() => innerWidth)) === 440, 15_000);
    const m = await page.evaluate(() => ({ w: innerWidth, h: innerHeight, dpr: devicePixelRatio, ua: navigator.userAgent, tactile: navigator.maxTouchPoints, mobile: matchMedia('(pointer: coarse)').matches }));
    assert.equal(m.dpr, 3); assert.match(m.ua, /iPhone/); assert.ok(m.tactile > 0, 'tactile');
    assert.ok(!/Electron|Pégase|pegase/i.test(m.ua));
    // Un pliable : ouvert puis plié.
    await ui.selectOption('[data-mobile-appareil]', 'galaxy-z-fold8-ultra');
    await attendre(async () => (await page.evaluate(() => innerWidth)) === 954, 15_000);
    await ui.click('[data-op="plier"]');
    await attendre(async () => (await page.evaluate(() => innerWidth)) === 412, 15_000);
    // Tourner, réseau « hors ligne ».
    await ui.click('[data-op="tourner"]');
    await attendre(async () => (await page.evaluate(() => innerWidth)) === 960, 15_000);
    await ui.selectOption('[data-mobile-reseau]', 'horsligne');
    await attendre(() => page.evaluate(() => !navigator.onLine && fetch('/deux?' + Math.random()).then(() => false, () => true)), 15_000);
    await ui.selectOption('[data-mobile-reseau]', 'rapide');
    // Mode libre : largeurs rapides.
    await ui.selectOption('[data-mobile-appareil]', 'libre');
    await ui.click('.largeurs >> text=Tablette · 768');
    await attendre(async () => (await page.evaluate(() => innerWidth)) === 768, 15_000);
    await ui.click('[data-op="quitter"]');
    await attendre(async () => (await page.evaluate(() => innerWidth)) > 768, 15_000);

    // ——— Inspecteur : les vrais outils de Chromium, en français, ancrés à droite puis en bas ; panneau Bouclier.
    await page.click('#t', { button: 'right' });
    await ui.click('.menu-page >> text=Inspecter');
    await ui.waitForSelector('.cadre-outils');
    await attendre(() => principal(app, () => { const f = [...globalThis.__pegase.fenetres][0]; return !!f.outils?.vue && f.outils.vue.webContents.getURL().startsWith('devtools://'); }), 20_000);
    // Le réglage « français » est posé dans l'inspecteur. (Electron 45 n'embarque que la traduction anglaise des outils de
    // Chromium : l'interface de l'inspecteur reste en anglais tant qu'Electron ne fournit pas « fr.json ».)
    await attendre(() => principal(app, () => { const f = [...globalThis.__pegase.fenetres][0]; return f.outils.vue.webContents.executeJavaScript('new Promise((ok) => InspectorFrontendHost.getPreferences((p) => ok(p.language)))'); }).then((l) => l === '"fr"'), 20_000);
    const pos = await ui.$eval('.cadre-outils', (e) => { const r = e.getBoundingClientRect(); return { x: r.x, w: r.width }; });
    assert.ok(pos.x > 400, 'ancré à droite');
    await ui.click('[data-a="outilsPosition"][data-p="bas"]');
    await ui.waitForSelector('.travail.pos-bas');
    await ui.click('[data-a="outilsPanneau"][data-p="bouclier"]');
    await ui.waitForSelector('.bouclier-liste');
    await ui.click('[data-a="outilsFermer"]');
    await attendre(async () => !(await ui.$('.cadre-outils')));
    // Aucun port de débogage n'a été ouvert par l'inspecteur (il passe par le processus, pas par le réseau).
    assert.equal(await principal(app, ({ app }) => app.commandLine.getSwitchValue('remote-debugging-port') === '0' || !app.commandLine.hasSwitch('remote-debugging-port')), true);
    // ——— Afficher le code source (view-source:).
    await faire('activer', { id: (await ui.evaluate(() => window.pegase.etat())).onglets.find((o) => o.url === `${web.url}/`).id });
    await ui.keyboard.press('Control+u');
    await attendre(async () => (await ui.evaluate(() => window.pegase.etat())).onglets.some((o) => o.url.startsWith('view-source:')), 10_000);
  } finally { await fermer(); await web.fermer(); }
});
