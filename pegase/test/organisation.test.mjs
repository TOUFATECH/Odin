// Étape 2 : espaces, favoris, onglets rangés, historique, épingler, menus, les 6 thèmes, profil local chiffré.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { lancer, serveur, pageDe, attendre, interface_ } from './banc.mjs';

const ouvrir = async (ui, url) => { await ui.keyboard.press('Control+t'); await ui.fill('#commande-q', url); await ui.keyboard.press('Enter'); };
const lignes = (ui) => ui.$$eval('.ligne[data-a="activer"]', (l) => l.map((x) => x.textContent.trim()));

test('organisation : espaces, favoris, rangés, historique, thèmes, profil gardé chiffré', { timeout: 240_000 }, async () => {
  const web = await serveur({
    '/a': '<!doctype html><title>Page A secrete-a</title><p>A</p>',
    '/b': '<!doctype html><title>Page B</title><p>B</p>',
    '/c': '<!doctype html><title>Page C</title><p>C</p>',
  });
  let s = await lancer();
  const dossier = s.dossier;
  try {
    let { ui, app } = s;
    await ouvrir(ui, `${web.url}/a`); await pageDe(app, /\/a$/);
    await attendre(async () => (await lignes(ui)).some((t) => t.includes('Page A')));
    // Favori (Ctrl+D) : une tuile apparaît en haut de la barre.
    await ui.keyboard.press('Control+d');
    await ui.waitForSelector('.tuiles .tuile[aria-label="Page A secrete-a"]');
    // Épingler par le clic droit de l'onglet.
    await ui.click('.ligne[data-a="activer"]', { button: 'right' });
    await ui.waitForSelector('.flottant[role="menu"] >> text=Épingler');
    await ui.click('.flottant[role="menu"] >> text=Épingler');
    await attendre(async () => (await ui.$$('.liste[data-drop="epingles"] .ligne[data-a="activer"]')).length === 1);
    // Deuxième onglet (du jour), puis « Ranger » : il part dans la boîte, l'épinglé reste.
    await ouvrir(ui, `${web.url}/b`); await pageDe(app, /\/b$/);
    await attendre(async () => (await lignes(ui)).length === 2);
    await ui.click('button[data-a="ranger"]');
    await attendre(async () => (await lignes(ui)).length === 1);
    await ui.click('button[aria-label="Onglets rangés"]');
    await ui.waitForSelector('.flottant >> text=Page B');
    await ui.click('.flottant button[data-a="rouvrir"]');
    await attendre(async () => (await lignes(ui)).some((t) => t.includes('Page B')));
    // Un deuxième espace, Ctrl+2 / Ctrl+1 pour passer de l'un à l'autre.
    await ui.click('button[aria-label="Nouveau : espace, dossier, onglet"]');
    await ui.click('.flottant >> text=Espace de travail');
    await ui.fill('.boite-dialogue input', 'Maison');
    await ui.keyboard.press('Enter');
    await attendre(async () => (await ui.textContent('.nom-espace b')) === 'Maison');
    assert.equal((await lignes(ui)).length, 0);
    await ouvrir(ui, `${web.url}/c`); await pageDe(app, /\/c$/);
    await attendre(async () => (await lignes(ui)).length === 1);
    await ui.keyboard.press('Control+1');
    await attendre(async () => (await ui.textContent('.nom-espace b')) === 'Perso');
    assert.equal((await lignes(ui)).length, 2);
    // Historique : la page pegase://historique liste les pages vues.
    await ui.keyboard.press('Control+y');
    await ui.waitForSelector('.interne h1 >> text=Historique');
    await ui.waitForSelector('.interne >> text=Page B');
    // Barre de commande : retrouve un onglet ouvert.
    await ui.keyboard.press('Control+t'); await ui.fill('#commande-q', 'Page C');
    await ui.waitForSelector('.resultat >> text=Aller à l’onglet');
    await ui.keyboard.press('Escape');
    // Les 6 thèmes. Le transparent refait la fenêtre (vitre du système) : l'interface est rechargée.
    for (const t of ['noir', 'blanc', 'rouge', 'glace', 'transparent', 'bleu']) {
      await ui.click('button[aria-label="Menu de Pégase"]').catch(async () => { ui = await interface_(app); await ui.click('button[aria-label="Menu de Pégase"]'); });
      await ui.click(`.nuance[data-theme="${t}"]`).catch(() => 0); // le thème transparent refait la fenêtre pendant le clic
      await new Promise((r) => setTimeout(r, 600));
      ui = await attendre(async () => { const p = app.windows().filter((w) => w.url().startsWith('pegase://app') && !w.isClosed()).at(-1); return p && (await p.evaluate(() => document.documentElement.dataset.theme)) === t ? p : null; });
      const transparente = await app.evaluate(() => { const f = [...globalThis.__pegase.fenetres][0]; return f.win.getBackgroundColor(); });
      if (t === 'transparent') assert.match(transparente, /^#00000000$|^#0{6}$/i);
    }
    // Profil local : renommé, gardé après redémarrage.
    await ui.evaluate(() => window.pegase.faire('majProfil', { nom: 'Zaïnaba' }));
    await attendre(async () => (await ui.textContent('button[aria-label="Ton profil Odin"] .avatar')) === 'Z');
  } finally { await s.fermer(true); }
  // Les fichiers du profil sont chiffrés : aucune adresse, aucun titre en clair.
  const dp = join(dossier, 'profils', 'toi');
  const fichiers = readdirSync(dp).filter((f) => f.endsWith('.pgs'));
  assert.ok(fichiers.includes('onglets.json.pgs') && fichiers.includes('favoris.json.pgs'));
  for (const f of fichiers) { const b = readFileSync(join(dp, f)); assert.ok(!b.includes('secrete-a') && !b.includes('127.0.0.1'), `${f} en clair`); }
  // Redémarrage : onglets, espaces, favoris et nom sont revenus.
  s = await lancer({ dossier });
  try {
    const { ui } = s;
    await attendre(async () => (await ui.textContent('.nom-espace b')) !== '');
    await ui.waitForSelector('.tuiles .tuile[aria-label="Page A secrete-a"]');
    assert.equal(await ui.textContent('button[aria-label="Ton profil Odin"] .avatar'), 'Z');
    assert.equal(await ui.$$eval('.esp', (l) => l.length), 2);
    assert.ok((await lignes(ui)).length >= 2);
  } finally { await s.fermer(true); await web.fermer(); }
});
