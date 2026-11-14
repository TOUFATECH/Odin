// Plume (le correcteur d'Odin) dans le vrai Pégase, contre un VRAI Odin : une faute tapée dans une page web locale est
// soulignée et corrigée d'un clic ; jamais dans un champ de mot de passe, de code ou de carte bancaire ; la page ne voit
// ni Plume ni le jeton ; « Désactiver » coupe tout (plus aucun envoi) et seul Réglages → Plume d'Odin le rallume ;
// « Dans Pégase » dans les réglages de Pégase ; une fenêtre privée n'envoie rien.
// L'état de Plume est lu dans le monde isolé de la page (monde 999 d'Electron, accroche d'essai hors paquet seulement).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { lancer, odinReel, serveur, attendre, pageDe, interface_ } from './banc.mjs';

const MDP_AWA = 'un-cheval-bleu-traverse-mamoudzou';
const etat = (ui) => ui.evaluate(() => window.pegase.etat());

/** Un relais vers Odin qui note les demandes faites à Plume (pour vérifier ce qui part, et ce qui ne part pas). */
async function relaisEspion(portCible) {
  const plume = [];
  const s = net.createServer((c) => {
    const d = net.connect(portCible, '127.0.0.1');
    c.on('data', (b) => { const s = b.toString('utf8'); const m = /^(GET|POST) (\/api\/plume\/[a-z]+)/m.exec(s); if (m) plume.push(`${m[1]} ${m[2]}`); if (s.includes('prochin')) plume.push('TEXTE:prochin'); d.write(b); });
    d.pipe(c);
    const fin = () => { c.destroy(); d.destroy(); }; c.on('error', fin); d.on('error', fin); c.on('close', fin); d.on('close', fin);
  });
  await new Promise((ok) => s.listen(0, '127.0.0.1', ok));
  return { port: s.address().port, plume, fermer: () => new Promise((ok) => s.close(ok)) };
}

const PAGE = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Contact</title>
<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self'"><link rel="stylesheet" href="/s.css"></head>
<body><h1>Formulaire de contact</h1><form><label>Recherche <input id="q" type="search"></label>
<label>Message <textarea id="message" rows="4"></textarea></label>
<label>Mot de passe <input id="mdp" type="password"></label><label>Code reçu par SMS <input id="code" type="text" autocomplete="one-time-code"></label>
<label>Numéro de carte <input id="carte" type="text" autocomplete="cc-number" inputmode="numeric"></label>
<label>Script <textarea id="code-source" class="editeur" spellcheck="false"></textarea></label></form><script src="/espion.js"></script></body></html>`;
const CSS = 'body{font:16px/1.5 sans-serif;max-width:640px;margin:30px auto;padding:0 16px}label{display:block;margin:10px 0}input,textarea{display:block;width:100%;box-sizing:border-box;font:15px sans-serif;padding:8px 10px;border:1px solid #999;border-radius:8px}';
const ESPION = 'window.fuite = () => ({ hote: document.querySelector("plume-pegase") ? "present" : "absent", ombre: (document.querySelector("plume-pegase") || {}).shadowRoot ?? null, essai: typeof __plumeEssai, ipc: typeof ipcRenderer, require: typeof require, texte: document.body.innerText.includes("Plume") });';

test('Plume dans le vrai Pégase, avec un vrai Odin', { timeout: 420_000 }, async () => {
  const odin = await odinReel();
  const espion = await relaisEspion(odin.port);
  const web = await serveur({ '/': PAGE, '/s.css': (q, r) => { r.writeHead(200, { 'content-type': 'text/css' }); r.end(CSS); }, '/espion.js': (q, r) => { r.writeHead(200, { 'content-type': 'text/javascript' }); r.end(ESPION); } });
  const coffre = join(mkdtempSync(join(process.env.PEGASE_TMP || tmpdir(), 'coffre-')), 'c.json');
  const P = await lancer({ premier: true, env: { PEGASE_ODIN_PORTS: String(espion.port), PEGASE_ODIN_RESEAU: 'non', PEGASE_COFFRE_ESSAI: coffre, PEGASE_DNS: 'systeme' } });
  const bilan = [];
  try {
    const { app, ui } = P;
    // Relier Pégase à Odin (1er lancement).
    await ui.waitForSelector('#ecran [data-ecran="odin"]', { timeout: 30_000 });
    await ui.waitForSelector('#statut-odin >> text=Odin trouvé sur ce PC', { timeout: 20_000 });
    await ui.fill('#ecran [name=email]', 'awa@exemple.yt'); await ui.fill('#ecran [name=motdepasse]', MDP_AWA); await ui.click('#ecran button[type=submit]');
    await attendre(async () => (await etat(ui)).ecran === 'navigateur', 20_000);

    await ui.evaluate((u) => window.pegase.faire('ouvrir', { url: u }), `${web.url}/`);
    const page = await pageDe(app, new RegExp(`^${web.url}/$`));
    await page.waitForLoadState('load');
    const wcId = await app.evaluate(({ webContents }, u) => webContents.getAllWebContents().find((w) => w.getURL() === u)?.id, `${web.url}/`);
    const iso = (code) => app.evaluate(({ webContents }, [id, c]) => webContents.fromId(id).executeJavaScriptInIsolatedWorld(999, [{ code: c }]), [wcId, code]);
    await attendre(async () => (await iso('typeof __plumeEssai')) === 'object', 15_000);
    await attendre(async () => (await iso('JSON.stringify(__plumeEssai.etat())')) !== 'null', 15_000);
    bilan.push(`état lu par la page (via Pégase) : ${await iso('JSON.stringify(__plumeEssai.etat())')}`);

    // 1) Une faute tapée : soulignée, puis corrigée d'un clic (vrais clics, vraie frappe).
    await page.click('#message'); await page.keyboard.type('Pour samedi matain : je voudrais un rendez-vous, est ce que c\'est possible ?', { delay: 5 });
    await attendre(async () => (await iso('JSON.stringify(__plumeEssai.suivis().map(s => s.fautes.map(f => f.avant)))')) === '[["matain","est ce que"]]', 15_000);
    assert.equal(await iso(`__plumeEssai.racine().querySelectorAll('.plm-s').length`), 2, 'deux soulignements');
    await page.screenshot({ path: join(process.env.PEGASE_CAPTURES || tmpdir(), 'plume-pegase-1.png') });
    const mot = JSON.parse(await iso(`JSON.stringify((() => { const r = [...__plumeEssai.racine().querySelectorAll('.plm-s')].find(x => x.textContent === 'matain').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })())`));
    await page.mouse.click(mot[0], mot[1]);
    await attendre(async () => (await iso(`!!__plumeEssai.racine().querySelector('.plm-pop')`)) === true, 5000);
    bilan.push(`fenêtre : ${(await iso(`__plumeEssai.racine().querySelector('.plm-pop').innerText`)).replace(/\n+/g, ' / ')}`);
    await page.screenshot({ path: join(process.env.PEGASE_CAPTURES || tmpdir(), 'plume-pegase-2.png') });
    const btn = JSON.parse(await iso(`JSON.stringify((() => { const r = [...__plumeEssai.racine().querySelectorAll('.plm-pop button')].find(b => b.textContent === 'Corriger').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })())`));
    await page.mouse.click(btn[0], btn[1]);
    await attendre(async () => /samedi matin :/.test(await page.inputValue('#message')), 5000);
    bilan.push(`après Corriger : ${await page.inputValue('#message')}`);

    // 2) La page ne voit rien de Plume.
    const fuite = await page.evaluate(() => window.fuite());
    bilan.push(`la page voit : ${JSON.stringify(fuite)}`);
    assert.deepEqual(fuite, { hote: 'present', ombre: null, essai: 'undefined', ipc: 'undefined', require: 'undefined', texte: false });

    // 3) Jamais dans un mot de passe, un code, une carte, un éditeur de code.
    await page.waitForTimeout(1500); // la vérification du message corrigé (600 ms après le clic) est passée
    const avant = espion.plume.filter((x) => x.includes('corriger')).length;
    for (const id of ['#mdp', '#code', '#carte', '#code-source']) { await page.click(id); await page.keyboard.type('matain prochin', { delay: 3 }); }
    await page.waitForTimeout(1500);
    assert.equal(await iso('__plumeEssai.suivis().length'), 1, 'seul le message est suivi');
    assert.equal(espion.plume.filter((x) => x.includes('corriger')).length, avant, 'rien de ces champs n\'est parti vers Odin');
    assert.ok(!espion.plume.includes('TEXTE:prochin'), 'le texte de ces champs n\'a jamais quitté Pégase');
    bilan.push('mot de passe, code, carte, éditeur : rien souligné, rien envoyé');

    // 4) « Dans Pégase » dans les réglages de Pégase.
    await ui.evaluate(() => window.pegase.faire('naviguer', { texte: 'pegase://reglages/plume', nouvel: true }));
    await ui.waitForSelector('[data-plume-pegase]', { timeout: 15_000 });
    bilan.push(`réglages de Pégase : ${(await ui.locator('#corps-reglages').innerText()).replace(/\n+/g, ' / ').slice(0, 260)}`);
    await ui.click('[data-plume-pegase]');
    await attendre(async () => (await odin.cmd('plume')).body.pegase === false, 10_000);
    await ui.click('[data-plume-pegase]');
    await attendre(async () => (await odin.cmd('plume')).body.pegase === true, 10_000);
    bilan.push('« Dans Pégase » coupé puis rallumé depuis les réglages de Pégase (vu dans Odin)');
    const revenir = async () => { const o = (await etat(ui)).onglets.find((x) => x.url === `${web.url}/`); await ui.evaluate((id) => window.pegase.faire('activer', { id }), o.id); await page.waitForTimeout(400); };
    await revenir();

    // 5) Désactiver (dans la fenêtre de Plume) : coupé partout, plus rien n'est envoyé.
    await page.click('#message'); await page.keyboard.press('End'); await page.keyboard.type(' Et une fote de frape.', { delay: 5 });
    await attendre(async () => (await iso(`__plumeEssai.racine().querySelectorAll('.plm-s').length`)) > 0, 15_000);
    const m2 = JSON.parse(await iso(`JSON.stringify((() => { const r = __plumeEssai.racine().querySelector('.plm-s').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })())`));
    await page.mouse.click(m2[0], m2[1]);
    await attendre(async () => (await iso(`!!__plumeEssai.racine().querySelector('.plm-pop')`)) === true, 5000);
    const off = JSON.parse(await iso(`JSON.stringify((() => { const r = [...__plumeEssai.racine().querySelectorAll('.plm-pop button')].find(b => b.textContent.includes('Désactiver')).getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })())`));
    await page.mouse.click(off[0], off[1]);
    await attendre(async () => (await odin.cmd('plume')).body.actif === false, 10_000);
    assert.equal(await iso(`__plumeEssai.racine().querySelectorAll('.plm-s,.plm-puce').length`), 0, 'plus aucun soulignement');
    bilan.push(`message : ${(await iso(`(__plumeEssai.racine().querySelector('.plm-note') || {}).innerText || ''`)).replace(/\n+/g, ' / ')}`);
    await page.screenshot({ path: join(process.env.PEGASE_CAPTURES || tmpdir(), 'plume-pegase-3.png') });
    const n0 = espion.plume.filter((x) => x.includes('corriger')).length;
    await page.click('#message'); await page.keyboard.type(' encore matain prochin', { delay: 5 }); await page.waitForTimeout(1800);
    assert.equal(espion.plume.filter((x) => x.includes('corriger')).length, n0, 'désactivé : plus aucun texte envoyé');
    assert.equal(await iso('__plumeEssai.suivis().length'), 0);
    // Les réglages de Pégase ne le rallument pas (seul Réglages → Plume d'Odin) : « Dans Pégase » est grisé.
    await ui.evaluate(() => window.pegase.faire('naviguer', { texte: 'pegase://reglages/plume', nouvel: true }));
    await ui.waitForSelector('[data-plume-pegase][disabled]', { timeout: 15_000 });
    assert.match(await ui.locator('#corps-reglages').innerText(), /seul Réglages → Plume d’Odin le rallume/);
    // « Ouvrir Réglages → Plume dans Odin » ouvre l'interface d'Odin à #plume.
    await ui.click('[data-plume-odin]');
    const odinPage = await pageDe(app, /#plume$/);
    bilan.push(`Réglages → Plume ouvert : ${odinPage.url()}`);
    // Rallumé dans Odin (Réglages → Plume) : la page le sait et corrige de nouveau.
    await odin.cmd('plume {"actif":true}');
    await revenir(); await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await page.click('#message'); await page.keyboard.type(' matain', { delay: 5 });
    await attendre(async () => Number(await iso(`__plumeEssai.racine().querySelectorAll('.plm-s').length`)) > 0, 20_000);
    bilan.push('rallumé dans Odin : de nouveau souligné dans Pégase');

    // 6) Fenêtre privée : Plume n'y est pas chargé, rien n'est envoyé.
    const n1 = espion.plume.length;
    await ui.evaluate(() => window.pegase.faire('fenetre', { op: 'privee' }));
    let uiPrive; await attendre(async () => { uiPrive = app.windows().filter((w) => w.url().startsWith('pegase://app')).find((w) => w !== ui); return !!uiPrive; }, 15_000);
    await uiPrive.waitForSelector('#haut .g', { timeout: 30_000 });
    await uiPrive.evaluate((u) => window.pegase.faire('ouvrir', { url: u }), `${web.url}/?prive`);
    const pp = await pageDe(app, /\?prive$/); await pp.waitForLoadState('load');
    const idPrive = await app.evaluate(({ webContents }, u) => webContents.getAllWebContents().find((w) => w.getURL() === u)?.id, `${web.url}/?prive`);
    await pp.click('#message'); await pp.keyboard.type('Pour samedi matain, est ce que c\'est possible ?', { delay: 5 }); await pp.waitForTimeout(2000);
    const isoPrive = await app.evaluate(({ webContents }, id) => webContents.fromId(id).executeJavaScriptInIsolatedWorld(999, [{ code: 'typeof __plumeEssai' }]), idPrive);
    assert.equal(isoPrive, 'undefined', 'Plume n\'est pas chargé dans une fenêtre privée');
    assert.equal(espion.plume.length, n1, 'rien n\'est parti vers Odin depuis la fenêtre privée');
    assert.equal(await pp.evaluate(() => !!document.querySelector('plume-pegase')), false);
    bilan.push('fenêtre privée : Plume pas chargé, rien envoyé');
    bilan.push(`demandes à Plume vues sur le réseau : ${espion.plume.length} (${[...new Set(espion.plume)].join(', ')})`);
  } finally { console.log(bilan.join('\n')); await P.fermer(); await web.fermer(); await espion.fermer(); await odin.fermer(); }
});
