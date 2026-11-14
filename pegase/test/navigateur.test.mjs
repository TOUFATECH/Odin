// Étape 1 : Pégase démarre, la barre de côté s'affiche, un vrai onglet charge une vraie page et navigue.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lancer, serveur, pageDe, attendre } from './banc.mjs';

test('Pégase ouvre une vraie page dans un onglet et navigue', { timeout: 120_000 }, async () => {
  const web = await serveur({
    '/': '<!doctype html><title>Accueil essai</title><h1>Bonjour Pégase</h1><a id="l" href="/deux">suite</a>',
    '/deux': '<!doctype html><title>Deuxième page</title><p id="p">deux</p>',
  });
  const { app, ui, fermer } = await lancer();
  try {
    // La barre de côté et la barre du haut sont là.
    assert.ok(await ui.isVisible('nav.barre'));
    assert.ok(await ui.isVisible('button[aria-label="Menu de Pégase"]'));
    // Ctrl+T, on tape l'adresse, Entrée.
    await ui.keyboard.press('Control+t');
    await ui.waitForSelector('#commande-q');
    await ui.fill('#commande-q', `${web.url}/`);
    await ui.keyboard.press('Enter');
    const page = await pageDe(app, new RegExp(`^${web.url}/$`));
    await page.waitForSelector('h1');
    assert.equal(await page.textContent('h1'), 'Bonjour Pégase');
    // L'onglet apparaît dans la barre de côté avec le titre de la page.
    await ui.waitForSelector('.ligne[data-a="activer"] >> text=Accueil essai');
    // La vue de la page est posée sur la fenêtre (sous la barre du haut, à droite de la barre de côté).
    const zone = await ui.evaluate(() => { const r = document.querySelector('[data-zone]').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
    assert.ok(zone.x >= 290 && zone.y >= 40 && zone.w > 300 && zone.h > 200, JSON.stringify(zone));
    // Navigation : un lien, puis « Page précédente ».
    await page.click('#l');
    await attendre(async () => (await ui.textContent('.ligne.actif'))?.includes('Deuxième page'));
    await attendre(async () => !(await ui.isDisabled('button[aria-label="Page précédente"]')));
    await ui.click('button[aria-label="Page précédente"]');
    await attendre(async () => (await ui.textContent('.ligne.actif'))?.includes('Accueil essai'));
    // Un deuxième onglet, puis on ferme le premier.
    await ui.keyboard.press('Control+t');
    await ui.fill('#commande-q', `${web.url}/deux`);
    await ui.keyboard.press('Enter');
    await attendre(async () => (await ui.$$('.ligne[data-a="activer"]')).length === 2);
    await ui.keyboard.press('Control+w');
    await attendre(async () => (await ui.$$('.ligne[data-a="activer"]')).length === 1);
  } finally { await fermer(); await web.fermer(); }
});
