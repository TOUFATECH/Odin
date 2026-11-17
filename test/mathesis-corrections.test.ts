// Mathésis — essais de NON-RÉGRESSION des constats de la relecture croisée (carnets/relecture-mathesis.md). Chaque essai
// reprend le banc du relecteur et échouait avant la correction.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { monter, html } from './mathesis-outils-essai.ts';
import { analyserRobots, couvre, permis } from '../src/valhalla/mathesis/robots.ts';
import { consignesPage, liensDe, texteDePage } from '../src/valhalla/mathesis/lecteur.ts';
import { ipInterdite } from '../src/valhalla/mathesis/adresses.ts';
import { creerMathesis } from '../src/valhalla/mathesis/moteur.ts';
import { MagasinFichiers } from '../src/valhalla/mathesis/magasin.ts';
import { optionsOdin, sansReseau } from '../src/valhalla/mathesis/branchement.ts';

const ROBOTS_OK = { corps: 'User-agent: *\nDisallow: /prive/\n', type: 'text/plain' };
const tmp = () => mkdtempSync(join(tmpdir(), 'mathesis-corr-'));

// ------------------------------------------------------------------ 1. jokers des consignes : linéaire
test('1. une règle à jokers hostile ne gèle pas Odin (comparaison linéaire, bornée)', async () => {
  const t0 = performance.now();
  assert.equal(couvre(`/${'a*'.repeat(30)}b`, `/${'a'.repeat(40)}`), false);
  assert.ok(performance.now() - t0 < 50, `${(performance.now() - t0).toFixed(1)} ms`);
  // La comparaison reste juste.
  assert.equal(couvre('/prive/', '/prive/x'), true);
  assert.equal(couvre('/*.pdf$', '/doc/a.pdf'), true);
  assert.equal(couvre('/*.pdf$', '/doc/a.pdf?x'), false);
  assert.equal(couvre('/a*b*c', '/axxbyyc/z'), true);
  assert.equal(couvre('/a*b*c$', '/axxbyycz'), false);
  assert.equal(couvre('/a$', '/a'), true);
  assert.equal(couvre('/a$', '/ab'), false);
  assert.equal(couvre('*', '/n/importe'), true);
  assert.equal(couvre('/ab*ab$', '/ab'), false, 'les morceaux ne se chevauchent pas');
  // Un fichier aux règles démesurées est jugé hostile : tout interdit.
  assert.equal(analyserRobots(`User-agent: *\nDisallow: /${'a*'.repeat(60)}b\n`).tout, 'interdit');
  assert.equal(analyserRobots(`User-agent: *\nDisallow: /${'x'.repeat(3000)}\n`).tout, 'interdit');
  // Bout en bout : le robot répond vite.
  const robots = `User-agent: *\nDisallow: /${'a*'.repeat(24)}b\n`;
  const { m } = monter({ pages: { 'https://exemple.fr/robots.txt': { corps: robots, type: 'text/plain' }, [`https://exemple.fr/${'a'.repeat(40)}`]: { corps: html('x', ['y']) } } });
  const t1 = performance.now();
  await m.lecteur.lire(`https://exemple.fr/${'a'.repeat(40)}`);
  assert.ok(performance.now() - t1 < 1000, `${(performance.now() - t1).toFixed(0)} ms`);
});

// ------------------------------------------------------------------ 2. consignes trop grosses
test('2. des consignes de plus de 512 Kio sont lues sur leurs 512 premiers Kio, jamais « tout permis »', async () => {
  const gros = `User-agent: *\nDisallow: /\n${'# remplissage\n'.repeat(45_000)}`;
  const { m, site } = monter({ pages: { 'https://exemple.fr/robots.txt': { corps: gros, type: 'text/plain' }, 'https://exemple.fr/secret': { corps: html('Secret', ['texte']) } } });
  const r = await m.lecteur.lire('https://exemple.fr/secret');
  assert.equal(r.genre, 'saute');
  assert.equal(site.demandesVers(/secret/).length, 0, 'la page interdite n\'est jamais demandée');
  // Des consignes servies comme une page HTML (erreur du site) ou binaires ne valent jamais « tout permis ».
  const h = monter({ pages: { 'https://h.fr/robots.txt': { corps: '<!doctype html><html><body>Page introuvable</body></html>', type: 'text/html' }, 'https://h.fr/x': { corps: html('x', ['y']) } } });
  assert.equal((await h.m.lecteur.lire('https://h.fr/x')).genre, 'saute');
  assert.equal(h.site.demandesVers(/h\.fr\/x$/).length, 0);
  const b = monter({ pages: { 'https://b.fr/robots.txt': { corps: 'User-agent: *\u0000\u0001\u0002', type: 'text/plain' }, 'https://b.fr/x': { corps: html('x', ['y']) } } });
  assert.equal((await b.m.lecteur.lire('https://b.fr/x')).genre, 'saute');
});

// ------------------------------------------------------------------ 3. extraction linéaire
test('3. une page hostile (liens ou balises non fermés) est lue en temps borné', async () => {
  const liens = '<a href="/x">'.repeat(160_000);
  let t0 = performance.now();
  const l = liensDe(liens, 'https://exemple.fr/', 120);
  assert.ok(performance.now() - t0 < 500, `liensDe : ${(performance.now() - t0).toFixed(0)} ms`);
  assert.ok(l.length >= 1);
  t0 = performance.now();
  consignesPage('<meta name="robots" '.repeat(100_000), null);
  assert.ok(performance.now() - t0 < 500, `consignesPage : ${(performance.now() - t0).toFixed(0)} ms`);
  // De bout en bout (extraction du texte comprise), 2 Mo de balises non fermées.
  const hostile = `<html><body>${'<script><div class="content"><a href="/x">'.repeat(45_000)}</body></html>`;
  const { m } = monter({ pages: { 'https://exemple.fr/robots.txt': ROBOTS_OK, 'https://exemple.fr/h': { corps: hostile } } });
  t0 = performance.now();
  await m.lecteur.lire('https://exemple.fr/h');
  assert.ok(performance.now() - t0 < 3000, `lecture complète : ${(performance.now() - t0).toFixed(0)} ms`);
  t0 = performance.now();
  texteDePage('<p>'.repeat(300_000) + '<ul class="menu">'.repeat(100_000));
  assert.ok(performance.now() - t0 < 1000, `texteDePage : ${(performance.now() - t0).toFixed(0)} ms`);
  assert.equal(texteDePage('<html><head><title>Le titre</title></head><body><script>x()</script><p>Un &amp; deux</p><nav>menu</nav><p>trois</p></body></html>').text, 'Un & deux\ntrois');
  // Les liens ordinaires restent bien lus (texte compris).
  assert.deepEqual(liensDe('<p><A HREF="/a">Le jardin</A> et <a rel="nofollow" href="/b">B</a></p>', 'https://e.fr/', 10), [{ url: 'https://e.fr/a', texte: 'Le jardin' }]);
});

// ------------------------------------------------------------------ 4. réglages abîmés : l'état le plus prudent
test('4. réglages, interdits ou budget abîmés : éteint, alerte, interdits de secours, budget épuisé ; clair refusé', () => {
  const d = tmp();
  try {
    const m1 = creerMathesis({ dossier: d, home: d });
    m1.interdits.interdire('sites', 'interdit.fr');
    m1.interdits.interdire('sites', 'autre.fr');
    writeFileSync(join(d, 'donnees', 'reglages.odc'), 'odc1:abime');
    writeFileSync(join(d, 'donnees', 'interdits.odc'), 'odc1:abime');
    const m2 = creerMathesis({ dossier: d, home: d });
    assert.equal(m2.reglages().actif, false, 'un fichier de réglages abîmé n\'allume jamais le robot');
    assert.ok(m2.alertes().some((a) => /réglages/.test(a)), 'le propriétaire est prévenu');
    assert.deepEqual(m2.interdits.lire().sites, ['interdit.fr', 'autre.fr'], 'les interdits reviennent de la copie de secours (dernière version lisible)');
    // Sans copie de secours lisible : rien ne sort.
    for (const f of readdirSync(join(d, 'donnees'))) if (f.startsWith('interdits')) writeFileSync(join(d, 'donnees', f), 'odc1:abime');
    const m3 = creerMathesis({ dossier: d, home: d });
    assert.equal(m3.reglages().actif, false);
    assert.ok(m3.alertes().some((a) => /interdits/.test(a)));
    // Budget illisible : épuisé pour la journée.
    writeFileSync(join(d, 'donnees', 'budget.odc'), 'pas chiffré du tout {');
    const m4 = creerMathesis({ dossier: d, home: d });
    assert.equal(m4.budget.restant('recherches'), 0);
    assert.equal(m4.budget.restant('pages'), 0);
    // Un fichier EN CLAIR n'est jamais accepté.
    writeFileSync(join(d, 'donnees', 'reglages.odc'), JSON.stringify({ actif: true, heures: [{ de: 0, a: 24 }], vitesse: 'soutenue' }));
    const m5 = creerMathesis({ dossier: d, home: d });
    assert.equal(m5.reglages().actif, false);
    assert.notEqual(m5.reglages().vitesse, 'soutenue');
    // Le propriétaire peut rallumer ensuite (l'état prudent n'est pas un piège).
    m5.interdits.interdire('sites', 'interdit.fr'); // le propriétaire refait ses interdits (ils étaient illisibles)
    m5.allumer();
    assert.equal(creerMathesis({ dossier: d, home: d }).reglages().actif, true);
  } finally { rmSync(d, { recursive: true, force: true }); }
});

// ------------------------------------------------------------------ 5. délai sous lectures croisées, gardé au redémarrage
test('5. le délai par site tient sous lectures simultanées et après un redémarrage', async () => {
  const pages: Record<string, { corps: string; type?: string }> = { 'https://exemple.fr/robots.txt': { corps: '', type: 'text/plain' } };
  for (let i = 0; i < 6; i++) pages[`https://exemple.fr/p${i}`] = { corps: html(`p${i}`, ['texte']) };
  // Une horloge-ordonnanceur : les attentes simultanées se réveillent dans l'ordre de leur échéance, comme de vrais
  // minuteurs (une simple horloge qui avance de `ms` à chaque appel ne sait pas représenter des attentes croisées).
  const h = { t: new Date(2026, 10, 17, 14, 0).getTime() };
  const enAttente: Array<{ at: number; ok: () => void }> = [];
  const attendre = (ms: number) => new Promise<void>((ok) => { enAttente.push({ at: h.t + Math.max(0, ms), ok }); });
  let actif = true;
  const pilote = (async () => { while (actif) { await new Promise((r) => setImmediate(r)); if (enAttente.length) { enAttente.sort((a, b) => a.at - b.at); const x = enAttente.shift()!; h.t = Math.max(h.t, x.at); x.ok(); } } })();
  // Quoi qu'il arrive (une vérification qui échoue comprise), l'horloge s'arrête : sinon l'essai ne finit jamais.
  try {
  const { site, magasin } = monter({ pages });
  // Les demandes sont datées avec CETTE horloge (le faux site a la sienne).
  const vraiesDates: number[] = [];
  const m2transport = async (u: string, i: Parameters<typeof site.transport>[1]) => { vraiesDates.push(h.t); return site.transport(u, i); };
  const mm = creerMathesis({ dossier: 'x', home: 'x', magasin, transport: m2transport, resoudre: async () => ['93.184.216.34'], temps: { maintenant: () => h.t, attendre } });
  await mm.lecteur.lire('https://exemple.fr/p0');
  await Promise.all([mm.lecteur.lire('https://exemple.fr/p1'), mm.lecteur.lire('https://exemple.fr/p2'), mm.lecteur.lire('https://exemple.fr/p3')]);
  const t = [...vraiesDates].sort((a, b) => a - b);
  for (let i = 1; i < t.length; i++) assert.ok(t[i] - t[i - 1] >= 2_000, `écarts : ${t.map((x, k) => (k ? x - t[k - 1] : 0)).join(', ')}`);
  // Redémarrage : un nouveau moteur sur le même magasin respecte le dernier créneau.
  const dernier = t.at(-1)!;
  const m3 = creerMathesis({ dossier: 'x', home: 'x', magasin, transport: m2transport, resoudre: async () => ['93.184.216.34'], temps: { maintenant: () => h.t, attendre } });
  await m3.lecteur.lire('https://exemple.fr/p4');
  assert.ok(vraiesDates.at(-1)! - dernier >= 2_000, `après redémarrage : ${vraiesDates.at(-1)! - dernier} ms`);
  } finally { actif = false; await pilote; }
});

// ------------------------------------------------------------------ 6. IPv6 : seulement l'unicast global public
test('6. IPv6 : seules les adresses publiques ordinaires passent', () => {
  for (const ip of ['::127.0.0.1', 'fe90::1', 'febf::1', 'fec0::1', '2002:7f00:1::1', '2001:0:4136:e378::1', '192.88.99.1', '::1', '::', 'fd12::1', 'ff02::1', '2001:db8::1', '3fff::1', '64:ff9b::7f00:1', '::ffff:10.0.0.1', '100::1', '2001:10::1']) {
    assert.equal(ipInterdite(ip), true, ip);
  }
  for (const ip of ['2606:2800:220:1:248:1893:25c8:1946', '2a00:1450:4007:80f::200e', '93.184.216.34']) assert.equal(ipInterdite(ip), false, ip);
});

// ------------------------------------------------------------------ 7. descente https → http
test('7. une redirection de https vers http est refusée', async () => {
  const { m, site } = monter({ pages: { 'https://exemple.fr/robots.txt': ROBOTS_OK, 'https://exemple.fr/a': { statut: 301, entetes: { location: 'http://exemple.fr/a' } }, 'http://exemple.fr/robots.txt': ROBOTS_OK, 'http://exemple.fr/a': { corps: html('a', ['b']) } } });
  const r = await m.lecteur.lire('https://exemple.fr/a');
  assert.equal(r.genre, 'saute');
  assert.match((r as { raison: string }).raison, /https vers http/);
  assert.equal(site.demandesVers(/^http:/).length, 0);
});

// ------------------------------------------------------------------ 8. « ne pas garder » : seulement des compteurs
test('8. « ne pas garder » : ni sujet, ni adresse, ni empreinte, ni état de page ne sont gardés', async () => {
  const fait = 'La tour Eiffel mesure 330 mètres de haut depuis l\'ajout de sa dernière antenne en 2022.';
  const { m, magasin } = monter({
    pages: { 'https://a.fr/robots.txt': ROBOTS_OK, 'https://b.fr/robots.txt': ROBOTS_OK, 'https://a.fr/t': { corps: html('A', [fait]) }, 'https://b.fr/t': { corps: html('B', [fait]) } },
    resultats: () => ['https://a.fr/t', 'https://b.fr/t'], reglages: { nePasGarder: true },
  });
  m.curiosite.signaler({ sujet: 'hauteur tour eiffel', origine: 'question_sans_reponse' });
  const b = await m.tour({ manques: 1, revisites: 0 });
  assert.equal(b.manques[0].pagesLues, 2);
  const journal = JSON.stringify(magasin.lire('journal', []));
  assert.doesNotMatch(journal, /eiffel|a\.fr|b\.fr|330/i, journal);
  assert.deepEqual(magasin.lire('pages', {}), {});
  assert.deepEqual(magasin.lire('empreintes', {}), {});
});

// ------------------------------------------------------------------ 9. plafond du site avant le budget
test('9. le plafond du site est vérifié avant de dépenser une page du budget', async () => {
  const pages: Record<string, { corps: string; type?: string }> = { 'https://exemple.fr/robots.txt': { corps: '', type: 'text/plain' } };
  for (let i = 0; i < 5; i++) pages[`https://exemple.fr/p${i}`] = { corps: html(`p${i}`, ['texte']) };
  const { m } = monter({ pages, reglages: { robot: { delaiSiteMs: 10_000, pagesParSiteJour: 3, pagesParSiteAbsorber: 1_000_000, profondeurMax: 2, tailleMaxPage: 2 * 1024 * 1024, delaiDemandeMs: 15_000, redirectionsMax: 3, liensParPage: 40, pagesParManque: 6 } } });
  for (let i = 0; i < 5; i++) await m.lecteur.lire(`https://exemple.fr/p${i}`);
  // 3 demandes au site : robots.txt + 2 pages ; les 3 lectures refusées par le plafond ne coûtent rien.
  assert.equal(m.budget.utilise().pages, 2);
});

// ------------------------------------------------------------------ 10. la base reçoit les écritures
test('10. la base MATHESIS_ODIN reçoit chaque écriture (contenu chiffré), une fois branchée', () => {
  const d = tmp();
  try {
    const recu: unknown[][] = [];
    const mag = new MagasinFichiers(d, d);
    mag.ecrire('journal', [{ quoi: 'avant la base' }]);
    mag.brancherMiroir({ ecrire: (...l: unknown[][]) => { recu.push(...l); } });
    assert.ok(recu.some((l) => l[0] === 'document_pose' && l[1] === 'journal'), 'ce qui était déjà là est reporté au branchement');
    mag.ecrire('curiosite', [{ sujet: 'secret-xyz' }]);
    const l = recu.find((x) => x[1] === 'curiosite')!;
    assert.match(String(l[3]), /^odc1:/);
    assert.ok(!JSON.stringify(recu).includes('secret-xyz'), 'rien en clair dans la base');
    assert.ok(existsSync(join(d, 'donnees', 'curiosite.odc')), 'le fichier reste la source de vérité');
  } finally { rmSync(d, { recursive: true, force: true }); }
});

// ------------------------------------------------------------------ B. instance d'essai : jamais le web
test('B. une instance d\'essai (ODIN_ESSAI) ne fait aucune demande vers le web ; un Odin sans modèle cherche comme les autres', async () => {
  assert.equal(sansReseau({ ODIN_ESSAI: '1' }), true);
  assert.equal(sansReseau({}), false);
  const o = optionsOdin({ cfg: {} }, { env: { ODIN_ESSAI: '1' } });
  assert.deepEqual(await o.chercher!('x'), []);
  await assert.rejects(o.transport!('https://exemple.fr/', { method: 'GET', headers: {}, redirect: 'manual' }), /aucun réseau/);
  await assert.rejects(o.resoudre!('exemple.fr'), /aucun réseau/);
});
