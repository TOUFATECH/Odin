import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OdinBrowser, describeLook, findBrowser } from '../src/browser/browser.ts';
import { checkBrowserUrl } from '../src/tools/browser.ts';

const FORM = `<!doctype html><meta charset="utf-8"><title>Inscription</title>
<h1>Inscription à la newsletter</h1>
<form action="/merci" method="get">
  <label for="nom">Nom</label><input id="nom" name="nom" placeholder="Ton nom">
  <label for="mdp">Mot de passe</label><input id="mdp" name="mdp" type="password">
  <label for="ville">Ville</label><select id="ville" name="ville"><option>Paris</option><option>Mamoudzou</option><option>Lyon</option></select>
  <label><input type="checkbox" name="ok" value="1"> J'accepte</label>
  <button type="submit">Envoyer</button>
</form>
<div style="height:3000px"></div><a href="/bas">Tout en bas</a>`;

test('navigateur : ouvrir, voir, remplir un formulaire, choisir, cocher, envoyer, défiler', { skip: !findBrowser() && 'aucun navigateur Chrome/Chromium/Edge sur cette machine' }, async (t) => {
  const srv = createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    if (req.url?.startsWith('/merci')) { const q = new URL(req.url, 'http://x').searchParams; return void res.end(`<title>Merci</title><p>Merci ${q.get('nom')} de ${q.get('ville')}, accord=${q.get('ok') ?? 'non'}, mdp=${q.get('mdp') ? 'reçu' : 'vide'}</p>`); }
    res.end(FORM);
  });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  const home = mkdtempSync(join(tmpdir(), 'odin-nav-'));
  const b = new OdinBrowser({ home });
  try {
    const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
    // Un navigateur installé peut refuser de démarrer (machine d'intégration sans bac à sable) : ce n'est pas un défaut d'Odin.
    let l: Awaited<ReturnType<typeof b.open>>;
    try { l = await b.open(await checkBrowserUrl(`${base}/`)); } catch (e) { if (/le navigateur s'est arrêté|n'a pas démarré/.test((e as Error).message)) return t.skip('le navigateur de cette machine ne démarre pas'); throw e; }
    assert.equal(l.title, 'Inscription');
    const desc = describeLook(l);
    assert.match(desc, /\[\d+\] champ « Nom »/);
    assert.match(desc, /liste « Ville » = « Paris » choix : Paris \| Mamoudzou \| Lyon/);
    assert.match(desc, /bouton « Envoyer »/);
    assert.ok(!l.items.some((i) => /Tout en bas/.test(i.name)), 'seuls les éléments visibles sont numérotés');
    const n = (re: RegExp) => l.items.find((i) => re.test(`${i.kind} ${i.name}`))!.n;
    let after = await b.type(n(/^champ Nom$/), 'Mia');
    assert.equal(after.items.find((i) => i.name === 'Mia' || i.value === 'Mia')?.value, 'Mia');
    after = await b.type(n(/password/), 'secret123');
    assert.match(describeLook(after), /= « •••• »/, 'un mot de passe tapé n\'est jamais relu en clair');
    await b.select(n(/^liste/), 'mamoudzou');
    await b.click({ n: n(/^case/) });
    const done = await b.click({ n: n(/bouton/) });
    assert.equal(done.title, 'Merci');
    assert.match(done.text, /Merci Mia de Mamoudzou, accord=1, mdp=reçu/);
    const back = await b.back();
    assert.equal(back.title, 'Inscription');
    const low = await b.scroll('down', 5);
    assert.match(describeLook(low), /lien « Tout en bas »/, 'après défilement, la suite devient visible');
    const png = await b.screenshot(true);
    assert.equal(png.subarray(1, 4).toString(), 'PNG');
    await assert.rejects(checkBrowserUrl('http://169.254.169.254/latest/meta-data'), /métadonnées/);
    await assert.rejects(checkBrowserUrl('file:///etc/passwd'), /http/);
  } finally {
    await b.shutdown(); srv.close();
    // Le navigateur peut encore écrire dans son profil une fraction de seconde après son arrêt (vu sur macOS) :
    // le ménage du dossier temporaire ne doit pas faire échouer un essai qui a réussi.
    try { rmSync(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }); } catch { /* dossier temporaire laissé au système */ }
  }
});
