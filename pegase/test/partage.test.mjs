// Étape 3 : écran partagé (2 à 4 pages, plusieurs groupes), barre réduite, vidéo qui suit.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { lancer, serveur, pageDe, attendre } from './banc.mjs';

const ouvrir = async (ui, url) => { await ui.keyboard.press('Control+t'); await ui.fill('#commande-q', url); await ui.keyboard.press('Enter'); };
const zones = (ui) => ui.$$eval('[data-zone]', (l) => l.map((x) => { const r = x.getBoundingClientRect(); return { id: x.dataset.zone, x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }; }));

test('écran partagé, barre réduite et vidéo qui suit', { timeout: 240_000 }, async () => {
  // Une vraie petite vidéo (WebM), fabriquée par ffmpeg pour l'essai.
  const video = join(process.env.PEGASE_TMP || '/tmp', 'essai-pegase.webm');
  if (!existsSync(video)) execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=duration=30:size=320x180:rate=15', '-c:v', 'libvpx', '-b:v', '150k', video]);
  const web = await serveur({
    '/1': '<!doctype html><title>Un</title><p>1</p>', '/2': '<!doctype html><title>Deux</title><p>2</p>',
    '/3': '<!doctype html><title>Trois</title><p>3</p>', '/4': '<!doctype html><title>Quatre</title><p>4</p>',
    '/video': '<!doctype html><title>Ma vidéo</title><video id="v" src="/v.webm" muted autoplay loop width="320"></video>',
    '/v.webm': (req, res) => { res.writeHead(200, { 'content-type': 'video/webm' }); res.end(readFileSync(video)); },
  });
  const { app, ui, fermer } = await lancer();
  try {
    for (const n of [1, 2, 3, 4]) { await ouvrir(ui, `${web.url}/${n}`); await pageDe(app, new RegExp(`/${n}$`)); }
    await attendre(async () => (await ui.$$('.ligne[data-a="activer"]')).length === 4);
    // Clic droit sur « Un » → « Ouvrir en écran partagé » : 2 pages côte à côte.
    await ui.click('.ligne[data-a="activer"] >> text=Un', { button: 'right' });
    await ui.click('.flottant >> text=Ouvrir en écran partagé');
    await attendre(async () => (await zones(ui)).length === 2);
    let z = await zones(ui);
    assert.ok(z[0].y === z[1].y && Math.abs(z[0].w - z[1].w) < 3 && z[0].x + z[0].w <= z[1].x, JSON.stringify(z));
    // La barre de côté montre un groupe de 2 pages.
    await ui.waitForSelector('.groupe[aria-label^="Groupe de 2 pages"]');
    // Jusqu'à 4 pages : on ajoute Deux et Trois → grille 2 × 2.
    // Jusqu'à 4 pages dans le même groupe → grille 2 × 2.
    const ids = await ui.evaluate(() => window.pegase.etat().then((e) => e.onglets.map((o) => [o.titre, o.id])));
    const id = (t) => ids.find((x) => x[0] === t)[1];
    await ui.evaluate(([a, b, c, d]) => window.pegase.faire('partager', { a, b }).then(() => window.pegase.faire('partager', { a, b: c })).then(() => window.pegase.faire('partager', { a, b: d })), [id('Un'), id('Deux'), id('Trois'), id('Quatre')]);
    await attendre(async () => (await zones(ui)).length === 4);
    z = await zones(ui);
    const xs = new Set(z.map((r) => r.x)), ys = new Set(z.map((r) => r.y));
    assert.equal(xs.size, 2); assert.equal(ys.size, 2);
    if (process.env.PEGASE_CAPTURES) execFileSync('import', ['-window', 'root', join(process.env.PEGASE_CAPTURES, 'quatre.png')]);
    await ouvrir(ui, `${web.url}/video`);
    const pv = await pageDe(app, /\/video$/);
    await attendre(async () => (await zones(ui)).length === 1);
    // Barre réduite (Ctrl+S) : la page prend toute la largeur.
    const avant = (await zones(ui))[0];
    await ui.keyboard.press('Control+s');
    await attendre(async () => { const r = (await zones(ui))[0]; return r && r.w > avant.w + 200; });
    await ui.keyboard.press('Control+s');
    await attendre(async () => !(await ui.$('.bord-gauche')));
    // La vidéo joue ; on revient au groupe de 4 : elle suit dans un coin.
    await attendre(() => pv.evaluate(() => !document.getElementById('v').paused && document.getElementById('v').currentTime > 0.3));
    await ui.click('.groupe');
    // Les vignettes sont une petite vue à part, posée par-dessus les pages.
    const vg = await pageDe(app, /#vignettes$/);
    await vg.waitForSelector('.video[data-video]');
    await attendre(async () => (await vg.$$('[data-zone-video]')).length === 1);
    const pose = await app.evaluate(() => { const f = [...globalThis.__pegase.fenetres][0]; const b = f.vignettes.getBounds(); const [W, H] = f.win.getContentSize(); return { b, W, H }; });
    assert.ok(pose.b.x + pose.b.width <= pose.W && pose.b.y + pose.b.height <= pose.H && pose.b.width > 300, JSON.stringify(pose));
    await new Promise((r) => setTimeout(r, 400));
    if (process.env.PEGASE_CAPTURES) execFileSync('import', ['-window', 'root', join(process.env.PEGASE_CAPTURES, 'video.png')]);
    // Elle continue de jouer pendant qu'on regarde autre chose.
    const t1 = await pv.evaluate(() => document.getElementById('v').currentTime);
    await new Promise((r) => setTimeout(r, 1500));
    assert.ok((await pv.evaluate(() => document.getElementById('v').currentTime)) > t1);
    // Pause depuis la petite fenêtre, puis « Retourner à l'onglet de la vidéo ».
    await vg.click('.video button[aria-label="Pause"]');
    await attendre(() => pv.evaluate(() => document.getElementById('v').paused));
    await vg.click('.video button[aria-label="Retourner à l\'onglet de la vidéo"]').catch(() => 0);
    await attendre(async () => (await zones(ui)).length === 1 && (await app.evaluate(() => [...globalThis.__pegase.fenetres][0].vignettes === null)));
  } finally { await fermer(); await web.fermer(); }
});
