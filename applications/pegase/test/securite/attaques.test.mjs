// Le banc d'attaques POUR DE VRAI : le vrai Pégase (sous xvfb), un serveur piège local, et les attaques du contrôle
// de sécurité (Réglages → Sécurité → « Relancer le contrôle »), plus celles qui passent par l'interface elle-même
// (javascript: tapé dans la barre, titre de page piégé, adresse trompeuse). Chaque attaque : « bloqué » ou « FAILLE ».
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { lancer, serveur, pageDe, attendre, ici } from '../banc.mjs';

test('banc d’attaques : tout est bloqué', { timeout: 300_000 }, async () => {
  const web = await serveur({
    '/titre': '<!doctype html><title>&lt;img src=x onerror="document.title=\'XSS\'"&gt;&lt;script&gt;alert(1)&lt;/script&gt;</title><p>titre piégé</p>',
    '/rien': '<!doctype html><title>Rien</title><p>rien</p>',
  });
  const { app, ui, fermer } = await lancer({ env: { PEGASE_DNS: 'systeme' }, args: [`--host-resolver-rules=MAP paypal.com.connexion-securisee.verification.piege-exemple.fr 127.0.0.1:${web.port}`] });
  const faire = (a, x) => ui.evaluate(([a, x]) => window.pegase.faire(a, x), [a, x]);
  const extra = [];
  try {
    // ——— Attaques par l'interface.
    // javascript: tapé dans la barre de commande : cherché, jamais exécuté.
    await ui.keyboard.press('Control+t'); await ui.fill('#commande-q', 'javascript:document.title="PIRATE"'); await ui.keyboard.press('Enter');
    await attendre(async () => (await ui.evaluate(() => window.pegase.etat())).onglets.some((o) => /duckduckgo|recherche/.test(o.url)), 10_000).catch(() => 0);
    const titres = (await ui.evaluate(() => window.pegase.etat())).onglets.map((o) => o.titre);
    extra.push({ groupe: 'Interface', nom: 'javascript: tapé dans la barre d’adresse', resultat: titres.includes('PIRATE') ? 'FAILLE' : 'bloqué' });
    // Titre de page piégé (HTML) : affiché comme du texte dans la barre de côté, rien n'est exécuté.
    await faire('ouvrir', { url: `${web.url}/titre` }); await pageDe(app, /\/titre$/);
    await ui.waitForSelector('.ligne[data-a="activer"] >> text=<img src=x');
    const injecte = await ui.evaluate(() => !!document.querySelector('#nav img[src="x"], #nav script') || document.title === 'XSS');
    extra.push({ groupe: 'Interface', nom: 'Titre de page avec du HTML (XSS dans l’interface)', resultat: injecte ? 'FAILLE' : 'bloqué' });
    // L'interface refuse tout script en ligne (CSP stricte) et ne peut pas naviguer.
    const csp = await ui.evaluate(() => { try { const s = document.createElement('script'); s.textContent = 'window.__x = 1'; document.body.appendChild(s); return window.__x === 1; } catch { return false; } });
    extra.push({ groupe: 'Interface', nom: 'Script en ligne dans l’interface (CSP)', resultat: csp ? 'FAILLE' : 'bloqué' });
    // Adresse trompeuse : le vrai domaine reste visible dans la barre.
    await faire('ouvrir', { url: `http://paypal.com.connexion-securisee.verification.piege-exemple.fr:${web.port}/rien` });
    await ui.waitForSelector('.avertissement [data-continuer]', { timeout: 30_000 }).catch(async (e) => { console.log('ÉTAT', JSON.stringify((await ui.evaluate(() => window.pegase.etat())).onglets.map((o) => [o.url, o.titre]))); throw e; }); // HTTPS d'abord : le site n'est pas chiffré
    await ui.click('.avertissement [data-continuer]');
    await pageDe(app, /piege-exemple\.fr:\d+\/rien$/);
    let montre = '';
    await attendre(async () => { montre = await ui.$eval('#haut .site-dom', (b) => b.textContent).catch(() => ''); return montre === 'piege-exemple.fr'; }, 15_000).catch(() => 0);
    const visible = await ui.$eval('#haut .site-dom', (b) => { const r = b.getBoundingClientRect(), p = b.closest('.adresse').getBoundingClientRect(); return r.width > 20 && r.left >= p.left - 1 && r.right <= p.right + 1; }).catch(() => false);
    extra.push({ groupe: 'Interface', nom: 'Long sous-domaine dans la barre (domaine montré en entier)', resultat: montre === 'piege-exemple.fr' && visible ? 'bloqué' : 'FAILLE', detail: `montré en entier : ${montre}` });
    // ——— Le contrôle complet, lancé depuis la page Réglages → Sécurité (comme la personne le ferait).
    await faire('interne', { page: 'reglages/securite' });
    await ui.waitForSelector('.interne [data-relancer]');
    await ui.click('.interne [data-relancer]');
    await ui.waitForSelector('.interne .resultat-controle.ok, .interne .resultat-controle.faille', { timeout: 180_000 });
    const r = await faire('controleResultats');
    const essais = r.groupes.flatMap((g) => g.essais.map((e) => ({ groupe: g.nom, ...e })));
    const tout = [...essais, ...extra];
    writeFileSync(join(ici, 'securite', 'resultats.json'), JSON.stringify({ date: r.date, pegase: r.version, chromium: r.chromium, essais: tout }, null, 1));
    const failles = tout.filter((e) => e.resultat === 'FAILLE');
    console.log(tout.map((e) => `${e.resultat.padEnd(10)} ${e.groupe} · ${e.nom}${e.detail ? ` (${e.detail})` : ''}`).join('\n'));
    assert.deepEqual(failles, [], 'aucune faille');
    assert.ok(tout.filter((e) => e.resultat === 'bloqué').length >= 28, `${tout.filter((e) => e.resultat === 'bloqué').length} attaques bloquées`);
  } finally { await fermer(); await web.fermer(); }
});
