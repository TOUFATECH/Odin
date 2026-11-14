// Étape 4 : bloqueur avec la vraie EasyList, téléchargements en quarantaine (EICAR bloqué, jamais écrit hors quarantaine).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { lancer, serveur, pageDe, attendre } from './banc.mjs';

const TMP = process.env.PEGASE_TMP || tmpdir();
const ouvrir = async (ui, url) => { await ui.keyboard.press('Control+t'); await ui.fill('#commande-q', url); await ui.keyboard.press('Enter'); };
// La signature EICAR, assemblée ici seulement (jamais écrite telle quelle dans le dépôt).
const EICAR = ['X5O!P%@AP[4\\PZX54(P^)7CC)7}$', 'EICAR-STANDARD-ANTIVIRUS-', 'TEST-FILE!$H+H*'].join('');

test('bloqueur (vraie EasyList) et quarantaine des téléchargements', { timeout: 240_000 }, async () => {
  // La vraie EasyList (téléchargée pour l'essai, gardée dans le dossier temporaire).
  const liste = join(TMP, 'easylist.txt');
  if (!existsSync(liste)) execFileSync('curl', ['-sS', '-o', liste, 'https://raw.githubusercontent.com/ghostery/adblocker/master/packages/adblocker/assets/easylist/easylist.txt']);
  const telechargements = mkdtempSync(join(TMP, 'dl-'));
  const fichier = (nom, contenu, type = 'application/octet-stream') => (req, res) => { res.writeHead(200, { 'content-type': type, 'content-disposition': `attachment; filename="${nom}"` }); res.end(contenu); };
  const web = await serveur({
    '/pub': `<!doctype html><title>Page avec pubs</title><h1>Article</h1>
      <div class="adsbygoogle-box" id="cosm">PUB</div>
      <script src="/pagead/conversion.js"></script>
      <script src="http://ib.adnxs.com/ttj.js"></script>
      <script src="/ok.js"></script>`,
    '/pagead/conversion.js': (q, r) => { r.writeHead(200, { 'content-type': 'text/javascript' }); r.end('window.PUB1=1'); },
    '/ttj.js': (q, r) => { r.writeHead(200, { 'content-type': 'text/javascript' }); r.end('window.PUB2=1'); },
    '/ok.js': (q, r) => { r.writeHead(200, { 'content-type': 'text/javascript' }); r.end('window.OK=1'); },
    '/eicar.com': fichier('eicar.com', EICAR),
    '/devis.pdf': fichier('devis-client.pdf', '%PDF-1.4\n% essai\n', 'application/pdf'),
    '/facture.pdf.exe': fichier('facture.pdf.exe', 'MZ pas vraiment un programme'),
  });
  const { app, ui, fermer, dossier } = await lancer({
    args: [`--host-resolver-rules=MAP ib.adnxs.com 127.0.0.1:${web.port}, MAP actu.exemple-pegase.fr 127.0.0.1:${web.port}`],
    env: { PEGASE_LISTES: liste, PEGASE_TELECHARGEMENTS: telechargements, PEGASE_DNS: 'systeme' },
  });
  try {
    assert.ok(await ui.evaluate(() => window.pegase.faire('bloqueurPret')), 'bloqueur prêt');
    // Un vrai nom de domaine (les filtres d'apparence génériques ne s'appliquent pas aux adresses IP).
    await ouvrir(ui, `http://actu.exemple-pegase.fr/pub`);
    const page = await pageDe(app, /\/pub$/);
    await page.waitForSelector('h1');
    await attendre(() => page.evaluate(() => window.OK === 1));
    // Les deux scripts de pub n'ont jamais atteint le serveur ; le script normal, si.
    assert.ok(!web.vus.some((v) => v.url.startsWith('/pagead/')), 'règle /pagead/conversion.js$script');
    assert.ok(!web.vus.some((v) => v.url === '/ttj.js'), 'règle ||adnxs.com^');
    assert.equal(await page.evaluate(() => window.PUB1 ?? window.PUB2 ?? null), null);
    // Filtre d'apparence : l'emplacement de pub est masqué.
    await attendre(() => page.evaluate(() => getComputedStyle(document.getElementById('cosm')).display === 'none'));
    // Le compteur du Bouclier le dit.
    await attendre(async () => (await ui.evaluate(() => window.pegase.etat().then((e) => e.onglets.find((o) => o.url.endsWith('/pub'))?.bloques))) >= 2);

    // Téléchargements : EICAR bloqué, nom trompeur bloqué, document sain enregistré.
    let n = 0;
    for (const u of ['/eicar.com', '/facture.pdf.exe', '/devis.pdf']) {
      await ui.evaluate((url) => window.pegase.faire('naviguer', { texte: url }), `${web.url}${u}`);
      n++; await attendre(async () => (await ui.evaluate(() => window.pegase.etat().then((e) => e.telechargements.length))) === n);
    }
    const dls = await attendre(async () => { const l = await ui.evaluate(() => window.pegase.etat().then((e) => e.telechargements)); return l.length === 3 && l.every((t) => t.etat === 'sain' || t.etat === 'bloque') ? l : null; }, 30_000);
    const de = (n) => dls.find((t) => t.nom === n);
    assert.equal(de('eicar.com').etat, 'bloque'); assert.match(de('eicar.com').detail, /EICAR/);
    assert.equal(de('facture.pdf.exe').etat, 'bloque'); assert.match(de('facture.pdf.exe').detail, /trompeur/);
    assert.equal(de('devis-client.pdf').etat, 'sain');
    // Sur le disque : seul le document sain est dans « Téléchargements » ; les autres restent en quarantaine.
    assert.deepEqual(readdirSync(telechargements), ['devis-client.pdf']);
    const q = join(dossier, 'quarantaine');
    const restes = readdirSync(q).flatMap((d) => readdirSync(join(q, d)).map((f) => join(q, d, f)));
    assert.equal(restes.length, 2);
    for (const r of restes) assert.equal(statSync(r).mode & 0o777, 0, 'fichier bloqué illisible');
    // Le panneau « Protégé » montre les verdicts.
    await ui.click('button[aria-label="Asclépios : téléchargements analysés"]');
    await ui.waitForSelector('.flottant >> text=Fichier d’essai antivirus EICAR');
  } finally { await fermer(); await web.fermer(); }
});
