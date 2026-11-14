// Import des favoris (vrais fichiers de Chrome, Firefox en mozLz4 compressé, Arc), agenda (.ics, glisser-déposer),
// cookies (valeurs masquées, effacer un site), mots de passe (proposer d'enregistrer, chiffrés, afficher après le mot de
// passe d'Odin, remplissage au clic sur la clé) : dans le vrai Pégase.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { lancer, serveur, pageDe, attendre, principal } from './banc.mjs';

/** Un compresseur LZ4 (format « block ») tout simple, pour fabriquer une vraie sauvegarde Firefox (.jsonlz4). */
function lz4(src) {
  const out = []; const t = new Map(); let ancre = 0, i = 0; const n = src.length;
  const longueur = (x) => { while (x >= 255) { out.push(255); x -= 255; } out.push(x); };
  const emettre = (fin, decalage, m) => {
    const lit = fin - ancre; out.push((Math.min(lit, 15) << 4) | (m === undefined ? 0 : Math.min(m - 4, 15)));
    if (lit >= 15) longueur(lit - 15);
    for (let k = ancre; k < fin; k++) out.push(src[k]);
    if (m === undefined) return;
    out.push(decalage & 255, decalage >> 8);
    if (m - 4 >= 15) longueur(m - 4 - 15);
  };
  while (i < n - 12) {
    const cle = src.readUInt32LE(i), ref = t.get(cle); t.set(cle, i);
    if (ref !== undefined && i - ref < 65535 && src.readUInt32LE(ref) === cle) {
      let m = 4; while (i + m < n - 5 && src[ref + m] === src[i + m]) m++;
      emettre(i, i - ref, m); i += m; ancre = i;
    } else i++;
  }
  emettre(n);
  return Buffer.from(out);
}

function fauxNavigateurs(maison) {
  const as = join(maison, 'Library', 'Application Support');
  // Chrome : le vrai format du fichier « Bookmarks », et le nom du profil dans « Local State ».
  mkdirSync(join(as, 'Google', 'Chrome', 'Default'), { recursive: true });
  writeFileSync(join(as, 'Google', 'Chrome', 'Local State'), JSON.stringify({ profile: { info_cache: { Default: { name: 'Awa' } } } }));
  writeFileSync(join(as, 'Google', 'Chrome', 'Default', 'Bookmarks'), JSON.stringify({ checksum: '0', version: 1, roots: {
    bookmark_bar: { type: 'folder', name: 'Barre de favoris', children: [
      { type: 'url', name: 'Mayotte la 1ère', url: 'https://la1ere.francetvinfo.fr/mayotte/' },
      { type: 'folder', name: 'Travail', children: [{ type: 'url', name: 'TOUFATECH', url: 'https://toufatech.com/' }, { type: 'url', name: 'Mauvais', url: 'javascript:alert(1)' }] }] },
    other: { type: 'folder', name: 'Autres favoris', children: [{ type: 'url', name: 'Météo', url: 'https://meteofrance.yt/' }] },
    synced: { type: 'folder', name: 'Mobile', children: [] } } }));
  // Firefox : profiles.ini + bookmarkbackups/*.jsonlz4 (en-tête « mozLz40\0 », taille, bloc LZ4).
  const ff = join(as, 'Firefox'); const pr = join(ff, 'Profiles', 'k3v9x2m7.default-release', 'bookmarkbackups'); mkdirSync(pr, { recursive: true });
  writeFileSync(join(ff, 'profiles.ini'), '[Profile0]\nName=default-release\nIsRelative=1\nPath=Profiles/k3v9x2m7.default-release\nDefault=1\n');
  const arbre = { guid: 'root________', title: '', type: 'text/x-moz-place-container', root: 'placesRoot', children: [
    { guid: 'toolbar_____', title: 'toolbar', type: 'text/x-moz-place-container', root: 'toolbarFolder', children: [
      { title: 'Service public', type: 'text/x-moz-place', uri: 'https://www.service-public.fr/' },
      { title: 'Recettes', type: 'text/x-moz-place-container', children: Array.from({ length: 30 }, (_, i) => ({ title: `Recette mahoraise ${i}`, type: 'text/x-moz-place', uri: `https://recettes.exemple.yt/mataba-${i}` })) }] },
    { guid: 'menu________', title: 'menu', type: 'text/x-moz-place-container', root: 'bookmarksMenuFolder', children: [{ title: 'TOUFATECH (doublon)', type: 'text/x-moz-place', uri: 'https://toufatech.com/' }] }] };
  const json = Buffer.from(JSON.stringify(arbre));
  const tete = Buffer.alloc(12); tete.write('mozLz40\0', 0, 'latin1'); tete.writeUInt32LE(json.length, 8);
  const comp = lz4(json); assert.ok(comp.length < json.length * 0.6, 'vraiment compressé (avec des répétitions)');
  writeFileSync(join(pr, 'bookmarks-2026-11-13_33_abcdef.jsonlz4'), Buffer.concat([tete, comp]));
  // Arc : StorableSidebar.json (espaces → espaces de travail, onglets épinglés).
  mkdirSync(join(as, 'Arc'), { recursive: true });
  writeFileSync(join(as, 'Arc', 'StorableSidebar.json'), JSON.stringify({ sidebar: { containers: [{ global: {} }, {
    spaces: ['s1', { id: 's1', title: 'Clients', containerIDs: ['unpinned', 'u1', 'pinned', 'p1'] }],
    items: ['p1', { id: 'p1', title: null, childrenIds: ['t1', 'd1'], data: { itemContainer: {} } },
      't1', { id: 't1', title: 'OQG Barber', childrenIds: [], data: { tab: { savedURL: 'https://oqgbarber.com/', savedTitle: 'OQG' } } },
      'd1', { id: 'd1', title: 'Factures', childrenIds: ['t2'], data: { list: {} } },
      't2', { id: 't2', title: null, childrenIds: [], data: { tab: { savedURL: 'https://chronopost.fr/', savedTitle: 'Chronopost' } } }] }] } }));
}

test('import des favoris, agenda, cookies, mots de passe', { timeout: 300_000 }, async () => {
  const tmp = process.env.PEGASE_TMP || tmpdir();
  const maison = mkdtempSync(join(tmp, 'maison-')); fauxNavigateurs(maison);
  const web = await serveur({
    '/connexion': '<!doctype html><title>Espace gérant</title><form action="/connecte" method="POST"><input id="e" name="email" autocomplete="username"><input id="p" type="password" name="motdepasse"><button id="ok">Se connecter</button></form>',
    '/connecte': (q, r) => { r.writeHead(200, { 'content-type': 'text/html' }); r.end('<title>Connecté</title><p>ok</p>'); },
    '/cookies': (q, r) => { r.writeHead(200, { 'content-type': 'text/html', 'set-cookie': ['session_id=valeur-tres-secrete; HttpOnly; Path=/; SameSite=Lax', 'langue=fr; Path=/; Max-Age=86400'] }); r.end('<title>Cookies</title><p>cookies</p>'); },
  });
  const { app, ui, fermer } = await lancer({ env: { PEGASE_IMPORT_RACINE: maison, PEGASE_IMPORT_SYSTEME: 'darwin', PEGASE_DNS: 'systeme', PEGASE_HTTP_OK: 'localhost' } });
  const faire = (a, x) => ui.evaluate(([a, x]) => window.pegase.faire(a, x), [a, x]);
  try {
    // ——— Import
    await faire('interne', { page: 'importer' });
    await ui.waitForSelector('.interne >> text=/Chrome, Firefox et Arc sont installés sur ce PC/');
    await ui.click('.interne [data-tout]');
    await ui.waitForSelector('.interne >> text=C’est fait', { timeout: 20_000 });
    const favs = await faire('favoris');
    const urls = favs.filter((f) => f.type === 'favori').map((f) => f.url);
    for (const u of ['https://la1ere.francetvinfo.fr/mayotte/', 'https://toufatech.com/', 'https://meteofrance.yt/', 'https://www.service-public.fr/', 'https://recettes.exemple.yt/mataba-29']) assert.ok(urls.includes(u), u);
    assert.ok(!urls.some((u) => u.startsWith('javascript:')), 'pas de javascript: importé');
    assert.equal(urls.filter((u) => u === 'https://toufatech.com/').length, 1, 'pas de doublon');
    assert.ok(favs.some((f) => f.type === 'dossier' && f.nom === 'Importés de Chrome'));
    assert.ok(favs.some((f) => f.type === 'dossier' && /Recettes/.test(f.nom)), 'les dossiers sont gardés');
    const e = await ui.evaluate(() => window.pegase.etat());
    const clients = e.espaces.find((x) => x.nom === 'Clients'); assert.ok(clients, 'espace d’Arc');
    assert.deepEqual(e.onglets.filter((o) => o.espace === clients.id && o.epingle).map((o) => o.url).sort(), ['https://chronopost.fr/', 'https://oqgbarber.com/']);

    // ——— Agenda : import .ics (fichier choisi par la personne), rendez-vous dans la semaine, glisser à un autre jour, export
    const lun = new Date(); lun.setHours(0, 0, 0, 0); lun.setDate(lun.getDate() - ((lun.getDay() + 6) % 7));
    const z = (d) => `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}T${String(d.getUTCHours()).padStart(2, '0')}${String(d.getUTCMinutes()).padStart(2, '0')}00Z`;
    const d1 = new Date(lun.getTime() + 86400_000 + 9 * 3600_000), d2 = new Date(d1.getTime() + 30 * 60_000);
    const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'BEGIN:VEVENT', 'UID:dentiste-1@exemple', `DTSTART:${z(d1)}`, `DTEND:${z(d2)}`, 'SUMMARY:Dentiste\\, contrôle', 'LOCATION:Mamoudzou', 'DESCRIPTION:Apporter la carte vitale', 'BEGIN:VALARM', 'TRIGGER:-PT30M', 'ACTION:DISPLAY', 'END:VALARM', 'END:VEVENT', 'END:VCALENDAR', ''].join('\r\n');
    const fichierIcs = join(maison, 'rdv.ics'); writeFileSync(fichierIcs, ics);
    await faire('interne', { page: 'agenda' });
    await ui.waitForSelector('.interne .semaine');
    await ui.setInputFiles('.interne input[data-ics]', fichierIcs);
    await ui.waitForSelector('.interne .evt >> text=Dentiste, contrôle');
    const rdv = (await faire('agenda')).find((x) => x.titre === 'Dentiste, contrôle');
    assert.equal(rdv.lieu, 'Mamoudzou'); assert.equal(rdv.rappel, 30); assert.equal(new Date(rdv.debut).getTime(), d1.getTime());
    // Glisser le rendez-vous au jeudi (même heure à 15 minutes près).
    const cible = (await ui.$$('.interne .colonne-jour'))[3];
    const bc = await cible.boundingBox(); const ev = await ui.$('.interne .evt'); const be = await ev.boundingBox();
    await ui.mouse.move(be.x + 10, be.y + 5); await ui.mouse.down();
    await ui.mouse.move(be.x + 40, be.y + 20, { steps: 4 }); await ui.mouse.move(bc.x + 20, be.y + 5, { steps: 6 }); await ui.mouse.up();
    await attendre(async () => { const r = (await faire('agenda')).find((x) => x.id === rdv.id); return new Date(r.debut).getDay() === 4 && Math.abs(new Date(r.debut).getHours() * 60 + new Date(r.debut).getMinutes() - (d1.getHours() * 60 + d1.getMinutes())) <= 15; });
    const sortie = await faire('agendaIcs');
    assert.match(sortie, /BEGIN:VCALENDAR\r\n/); assert.match(sortie, /SUMMARY:Dentiste\\, contrôle\r\n/); assert.match(sortie, /UID:dentiste-1@exemple@pegase\.odin|UID:dentiste-1@pegase\.odin|UID:dentiste-1@exemple/); assert.match(sortie, /TRIGGER:-PT30M/);
    assert.ok(sortie.split('\r\n').every((l) => Buffer.byteLength(l) <= 75), 'lignes pliées à 75 octets');

    // ——— Cookies : un site, valeurs masquées, afficher au clic, effacer le site
    await faire('ouvrir', { url: `http://localhost:${web.port}/cookies` });
    await pageDe(app, /\/cookies$/);
    await faire('naviguer', { texte: 'pegase://reglages/cookies' });
    await ui.waitForSelector('.interne [data-site="localhost"]');
    await ui.click('.interne [data-site="localhost"]');
    await ui.waitForSelector('.interne .valeur-masquee');
    assert.ok(!(await ui.textContent('.interne .corps-reglages')).includes('valeur-tres-secrete'), 'valeur masquée');
    const lignes = await ui.$$('.interne .site-cookies.ouvert tbody tr');
    const noms = await Promise.all(lignes.map((l) => l.$eval('td b', (b) => b.textContent)));
    const i = noms.indexOf('session_id'); assert.ok(i >= 0, JSON.stringify(noms));
    assert.match(await lignes[i].textContent(), /HttpOnly/);
    await (await lignes[i].$('.valeur-masquee')).click();
    await ui.waitForSelector('.interne .valeur-masquee.montree >> text=valeur-tres-secrete');
    await ui.click('.interne [data-suppr-site="localhost"]');
    await attendre(async () => !(await ui.$('.interne [data-site="localhost"]')));

    // ——— Mots de passe : connexion sur un site → « Enregistrer le mot de passe ? »
    await faire('ouvrir', { url: `http://localhost:${web.port}/connexion` });
    const pc = await pageDe(app, /\/connexion$/);
    await pc.fill('#e', 'contact@exemple.yt'); await pc.fill('#p', 'Coucou-Le-Lagon-2026!');
    await pc.press('#p', 'Enter');
    await ui.waitForSelector('.proposer-mdp >> text=Enregistrer le mot de passe ?', { timeout: 10_000 });
    assert.ok(!(await ui.textContent('.proposer-mdp')).includes('Coucou'), 'le mot de passe n’est jamais montré');
    await ui.click('.proposer-mdp [data-op="enregistrer"]');
    const liste = await faire('mdpListe');
    assert.equal(liste.entrees.length, 1); assert.equal(liste.entrees[0].site, `localhost:${web.port}`); assert.equal(liste.entrees[0].identifiant, 'contact@exemple.yt');
    assert.ok(!JSON.stringify(liste).includes('Coucou'), 'jamais envoyé à l’interface');
    // Afficher : seulement après le mot de passe d'Odin.
    await principal(app, () => [...globalThis.__pegase.synchros.values()][0].retenirMotDePasse('mot-de-passe-odin-essai'));
    await faire('naviguer', { texte: 'pegase://reglages/motsdepasse' });
    await ui.waitForSelector('.interne .secret');
    await ui.click('.interne [data-afficher]');
    await ui.fill('.boite-mdp input', 'pas-le-bon'); await ui.click('.boite-mdp [type=submit]');
    await ui.waitForSelector('.toast >> text=Ce n’est pas ton mot de passe d’Odin');
    await ui.click('.interne [data-afficher]');
    await ui.fill('.boite-mdp input', 'mot-de-passe-odin-essai'); await ui.click('.boite-mdp [type=submit]');
    await ui.waitForSelector('.interne .secret >> text=Coucou-Le-Lagon-2026!');
    // Remplissage : la clé apparaît dans le champ du mot de passe du site exact ; au clic, les champs se remplissent.
    await faire('ouvrir', { url: `http://localhost:${web.port}/connexion` });
    const p2 = await attendre(async () => app.windows().filter((w) => /\/connexion$/.test(w.url())).at(-1));
    await p2.waitForSelector('#p');
    await p2.click('#p');
    const hote = await p2.waitForSelector('pegase-cle', { state: 'attached', timeout: 5000 });
    assert.equal(await p2.evaluate(() => document.querySelector('pegase-cle').shadowRoot), null, 'l’intérieur de la clé est invisible pour la page');
    const b = await hote.boundingBox();
    await p2.mouse.click(b.x + b.width / 2, b.y + b.height / 2); // ouvre le menu de la clé
    await p2.waitForTimeout(300);
    await p2.mouse.click(b.x + 40, b.y + 30 + 30 + 14); // 1re ligne : l'identifiant enregistré
    await attendre(async () => (await p2.inputValue('#p')) === 'Coucou-Le-Lagon-2026!');
    assert.equal(await p2.inputValue('#e'), 'contact@exemple.yt');
    // Les fichiers du profil ne contiennent jamais le mot de passe en clair.
    const dossierProfil = await principal(app, () => [...globalThis.__pegase.profils.values()][0].opts.dossier);
    for (const f of readdirSync(dossierProfil)) { if (f.endsWith('.pgs')) assert.ok(!readFileSync(join(dossierProfil, f)).includes('Coucou-Le-Lagon'), f); }
  } finally { await fermer(); await web.fermer(); }
});
