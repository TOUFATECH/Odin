// Corrections de la relecture « absorber un site » (carnet relecture-absorber.md) : chacune avec son essai.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Absorbeur, lireFil, lirePlan, type DepsAbsorbeur } from '../src/valhalla/mathesis/absorber.ts';
import { MagasinMemoire } from '../src/valhalla/mathesis/magasin.ts';
import { OuTrouver } from '../src/valhalla/mathesis/ou-trouver.ts';
import { motsUtiles } from '../src/valhalla/mathesis/outils.ts';
import { optionsOdin } from '../src/valhalla/mathesis/branchement.ts';

const S = 'https://essai.example.org';
const attendre = (ms: number) => new Promise((ok) => setTimeout(ok, ms));
const page = (url: string, texte = 'x') => ({ url, urlFinale: url, site: 'essai.example.org', titre: 't', texte, liens: [], fils: [], nofollow: false, octets: 1, empreinte: url, fraicheur: {} });
function absorbeur(o: Partial<DepsAbsorbeur> = {}, magasin = new MagasinMemoire()): Absorbeur {
  const plan = `<urlset>${Array.from({ length: 10 }, (_, i) => `<url><loc>${S}/a/${i}</loc></url>`).join('')}</urlset>`;
  return new Absorbeur({
    magasin: magasin as never,
    lecteur: { async consignes() { return { tout: 'permis', regles: [], plans: [] } as never; }, async lire(url: string) { return { genre: 'lu', page: page(url, plan) } as never; } },
    robot: { async visiter(url: string) { await attendre(30); return { genre: 'lu', neuf: false, page: page(url) } as never; }, etats: () => ({}) },
    journal: { noter() { return {} as never; } } as never,
    reglages: () => ({ robot: { pagesParSiteJour: 30 } }) as never,
    interdits: () => ({ sites: [], sujets: [] }) as never,
    maintenant: () => Date.parse('2026-11-17T10:00:00Z'), garde: () => undefined, apprendre: () => 0,
    ...o,
  });
}

test('GRAVE corrigé : un fil ou un plan de site piégé de 2 Mo ne fige plus Odin (< 1 s), et les vrais documents se lisent comme avant', () => {
  const T = 2 * 1024 * 1024;
  let t = performance.now(); lireFil('<item>'.repeat(T / 6)); const fil = performance.now() - t;
  t = performance.now(); lirePlan('<url>'.repeat(T / 5)); const plan = performance.now() - t;
  t = performance.now(); lireFil('<entry><link '.repeat(T / 13)); const atom = performance.now() - t;
  assert.ok(fil < 1000 && plan < 1000 && atom < 1000, `fil ${fil.toFixed(0)} ms, plan ${plan.toFixed(0)} ms, atom ${atom.toFixed(0)} ms`);
  assert.deepEqual(lirePlan('<urlset><url><loc>https://a.example.org/a</loc><lastmod>2026-11-10</lastmod></url><url><loc><![CDATA[https://a.example.org/b]]></loc></url></urlset>').pages.map((x) => x.url), ['https://a.example.org/a', 'https://a.example.org/b']);
  assert.deepEqual(lirePlan('<sitemapindex><sitemap><loc>https://a.example.org/s1.xml</loc></sitemap></sitemapindex>').plans, ['https://a.example.org/s1.xml']);
  assert.deepEqual(lireFil('<rss><item><link>https://a.example.org/un</link></item><item><link><![CDATA[https://a.example.org/deux]]></link></item></rss>').map((x) => x.url), ['https://a.example.org/un', 'https://a.example.org/deux']);
  assert.deepEqual(lireFil('<feed><entry><link rel="alternate" href="https://a.example.org/x"/></entry></feed>').map((x) => x.url), ['https://a.example.org/x']);
  // une ouverture sans fermeture au milieu n'empêche pas de lire la suite
  assert.deepEqual(lirePlan('<urlset><url>cassé<url><loc>https://a.example.org/c</loc></url></urlset>').pages.map((x) => x.url), ['https://a.example.org/c']);
});

test('« retirer » ou « pause » pendant un passage n\'est plus annulé à la fin du passage', async () => {
  const a = absorbeur();
  a.ajouter(S, 'page');
  const p = a.passer(5); await attendre(60); a.retirer('essai.example.org'); await p;
  assert.deepEqual(a.liste().map((x) => x.id), [], 'retiré reste retiré');
  a.ajouter(S, 'page');
  const p2 = a.passer(5); await attendre(60); a.pause('essai.example.org'); await p2;
  assert.equal(a.liste()[0].etat, 'en-pause', 'la pause reste');
});

test('un site en panne n\'est pas déclaré « déjà absorbé » ; il est réessayé plus tard', async () => {
  const a = absorbeur({
    lecteur: { async consignes() { return { tout: 'permis', regles: [], plans: [] } as never; }, async lire(url: string) { return { genre: 'saute', url, raison: 'page indisponible (HTTP 503)' } as never; } },
    robot: { async visiter(url: string) { return { genre: 'saute', url, raison: 'page indisponible (HTTP 503)' } as never; }, etats: () => ({}) },
  });
  a.ajouter(S, 'page'); await a.passer(10);
  const s = a.liste()[0];
  assert.equal(s.absorbeLe, undefined); assert.equal(s.decouvert, false); assert.ok((s.prochaineDecouverte ?? 0) > Date.parse('2026-11-17T10:00:00Z'));
  assert.doesNotMatch(a.phrase(s), /déjà absorbé/);
});

test('un plan de 40 000 pages connues « mises à jour » : le fil d\'Odin n\'est plus tenu longtemps', async () => {
  const N = 40_000, urls = Array.from({ length: N }, (_, i) => `${S}/a/${i}`);
  const mag = new MagasinMemoire();
  const plan = `<urlset>${urls.map((u) => `<url><loc>${u}</loc><lastmod>2026-11-17</lastmod></url>`).join('')}</urlset>`;
  const a = absorbeur({
    lecteur: { async consignes() { return { tout: 'permis', regles: [], plans: [] } as never; }, async lire(url: string) { return { genre: 'lu', page: page(url, plan) } as never; } },
    robot: { async visiter() { return { genre: 'saute', raison: 'plafond du jour atteint pour ce site' } as never; }, etats: () => Object.fromEntries(urls.map((u) => [u, { derniereVisiteMs: 1 }])) as never },
  }, mag);
  a.ajouter(S, 'page');
  await a.decouvrir('essai.example.org'); // première découverte : toutes connues
  const s = a.liste()[0];
  // La file du site (dans SA collection) presque pleine, et la découverte due tout de suite.
  const doc = mag.lire<{ file: unknown[]; connues: string[] }>('site:essai.example.org', { file: [], connues: [] });
  mag.ecrire('site:essai.example.org', { ...doc, file: Array.from({ length: 4990 }, (_, i) => ({ url: `${S}/b/${i}`, article: true })) });
  mag.ecrire('absorber', { [s.id]: { ...s, prochaineDecouverte: 0, xmlLuA: {} } });
  const t = performance.now(); await a.decouvrir('essai.example.org'); const ms = performance.now() - t;
  assert.ok(ms < 1000, `${ms.toFixed(0)} ms`); console.log(`# mesuré : ${ms.toFixed(0)} ms`);
});

test('« où trouver » : tous les faits d\'une page en UNE écriture ; adresses connues en empreintes courtes', () => {
  let ecritures = 0;
  const m = new MagasinMemoire(); const e = m.ecrire.bind(m); m.ecrire = ((c: never, v: never) => { ecritures++; e(c, v); }) as never;
  const o = new OuTrouver(m as never);
  o.noterTout(Array.from({ length: 8 }, (_, i) => ({ texte: `fait ${i}`, url: `${S}/p`, titre: 't', site: 'essai.example.org', at: i })));
  assert.equal(ecritures, 1); assert.equal(o.tous().length, 8);
  const a = absorbeur({}, m);
  a.ajouter(S, 'page');
  return a.apercu('essai.example.org').then(() => {
    // (les adresses connues vivent dans la collection du site, avec sa file)
    const c = m.lire<{ connues: string[] }>('site:essai.example.org', { connues: [] }).connues;
    assert.equal(c.length, 10); assert.ok(c.every((x) => x.length === 11), 'empreintes de 11 caractères, pas les adresses');
  });
});

test('toutes les langues : les mots utiles et « où trouver » marchent en russe, chinois, arabe', () => {
  assert.ok(motsUtiles('Как настроить сервер резервного копирования').includes('сервер'));
  assert.ok(motsUtiles('如何配置备份服务器').includes('备份'));
  assert.ok(motsUtiles('كيفية إعداد خادم النسخ الاحتياطي').includes('خادم'));
  assert.ok(motsUtiles('كيفية إعداد خادم').some((m) => m.startsWith('ا') || m.startsWith('إ')), 'la hamza ne coupe plus le mot');
  const o = new OuTrouver(new MagasinMemoire() as never);
  o.noter({ texte: 'Сервер резервного копирования настраивается через веб-интерфейс.', url: 'https://ru.example.org/b', titre: 'Резервное копирование', site: 'ru.example.org', at: 1 });
  assert.equal(o.chercher('сервер резервного копирования').length, 1);
  assert.deepEqual(motsUtiles('le serveur de la maison'), ['serveur', 'maison'], 'le français ne change pas');
});

test('« stop » d\'Odin (initiative-pause) arrête aussi Mathésis jusqu\'à « reprends »', () => {
  const kv = new Map<string, string>();
  const o = optionsOdin({ cfg: {}, muninn: { getKv: (k: string) => kv.get(k), remember() { return { id: 1 }; }, forget: () => true } } as never, { env: {} });
  assert.equal(o.occupe!(), false);
  kv.set('initiative-pause', '1'); assert.equal(o.occupe!(), true);
  kv.set('initiative-pause', ''); assert.equal(o.occupe!(), false);
});

test('« Crawl-delay: 300 » est respecté : la page suivante n\'est pas lue 120 s après mais laissée jusqu\'à son créneau, sans attente longue', async () => {
  const { monter, html } = await import('./mathesis-outils-essai.ts');
  const corps = html('Jardin', ['Le jardin créole mélange les plantes : elles poussent bien à La Réunion toute l\'année, au soleil.']);
  const { m, site, horloge } = monter({ pages: { 'https://lent.fr/robots.txt': { corps: 'User-agent: *\nCrawl-delay: 300\n', type: 'text/plain' }, 'https://lent.fr/a': { corps }, 'https://lent.fr/b': { corps } }, reglages: { heures: [{ de: 0, a: 24 }] } });
  const t0 = horloge.maintenant();
  assert.equal((await m.lecteur.lire('https://lent.fr/a')).genre, 'lu');
  const r2 = await m.lecteur.lire('https://lent.fr/b');
  assert.equal(r2.genre, 'saute'); assert.match((r2 as { raison: string }).raison, /site en pause \(il demande 300 s/);
  assert.equal(site.demandesVers(/lent\.fr\/b/).length, 0, 'pas lue avant son créneau');
  assert.ok(horloge.maintenant() - t0 <= 120_000, 'aucune attente longue dans le passage');
});

test('le registre ne garde que la fiche de chaque site : lire un site n\'écrit ni la file ni les adresses des autres', async () => {
  const mag = new MagasinMemoire();
  const ecrits: Array<{ c: string; octets: number }> = [];
  const e = mag.ecrire.bind(mag); mag.ecrire = ((c: string, v: unknown) => { ecrits.push({ c, octets: JSON.stringify(v).length }); e(c as never, v); }) as never;
  const a = absorbeur({}, mag);
  // 20 sites « pleins » (5 000 pages en file chacun), posés directement dans leurs collections.
  for (let k = 0; k < 20; k++) {
    const id = `site${k}.example.org`;
    a.ajouter(`https://${id}`, 'page');
    mag.ecrire(`site:${id}`, { file: Array.from({ length: 5000 }, (_, i) => ({ url: `https://${id}/articles/une-adresse-de-page-${i}`, article: true })), connues: [] });
  }
  ecrits.length = 0;
  await a.passer(3); // le premier site découvre et lit 3 pages
  const registre = ecrits.filter((x) => x.c === 'absorber');
  assert.ok(registre.length >= 1);
  assert.ok(Math.max(...registre.map((x) => x.octets)) < 40_000, `registre : ${Math.max(...registre.map((x) => x.octets))} octets (les files n'y sont plus)`);
  assert.deepEqual([...new Set(ecrits.filter((x) => x.c.startsWith('site:')).map((x) => x.c))], ['site:site0.example.org'], 'seule la collection du site lu est écrite');
  assert.equal(a.liste()[1].file.length, 5000, 'les autres sites gardent leur file');
});

test('ancienne forme (file dans le registre, adresses dans « absorberConnues ») : déplacée une fois, rien de perdu', () => {
  const mag = new MagasinMemoire();
  mag.ecrire('absorber', { 'essai.example.org': { id: 'essai.example.org', racine: S, ajoute: 0, par: 'page', etat: 'en-cours', plans: [], fils: [], fraicheurs: {}, file: [{ url: `${S}/x`, article: true }], connues: 1, lues: 0, refusees: 0, erreurs: 0, faits: 0, decouvert: true } });
  mag.ecrire('absorberConnues', { 'essai.example.org': [`${S}/x`] });
  const a = absorbeur({}, mag);
  const s = a.trouver('essai.example.org')!;
  assert.equal(s.file.length, 1);
  const doc = mag.lire<{ file: unknown[]; connues: string[] }>('site:essai.example.org', { file: [], connues: [] });
  assert.equal(doc.connues.length, 1); assert.equal(doc.connues[0].length, 11);
  assert.equal((mag.lire<Record<string, { file?: unknown }>>('absorber', {})['essai.example.org']).file, undefined, 'plus de file dans le registre');
});

// ------------------------------------------------------------------ la liste « à vérifier » de la relecture
test('à vérifier : un plan compressé (.xml.gz) est lu (décompressé, borné) ; une bombe de compression s\'arrête à la borne', async () => {
  const { gzipSync } = await import('node:zlib');
  const { monter } = await import('./mathesis-outils-essai.ts');
  const { degonfler } = await import('../src/valhalla/mathesis/lecteur.ts');
  const G = 'https://gz.example.org';
  const plan = `<urlset>${Array.from({ length: 30 }, (_, i) => `<url><loc>${G}/article-${i}.html</loc></url>`).join('')}</urlset>`;
  const pages = {
    [`${G}/robots.txt`]: { corps: `User-agent: *\nDisallow:\nSitemap: ${G}/sitemap.xml.gz\n`, type: 'text/plain' },
    [`${G}/sitemap.xml.gz`]: { corps: gzipSync(Buffer.from(plan)) as never as string, type: 'application/x-gzip' },
  };
  const { m } = monter({ pages, reglages: { heures: [{ de: 0, a: 24 }] } });
  m.absorbeur.ajouter(G, 'page');
  await m.absorbeur.apercu('gz.example.org');
  assert.equal(m.absorbeur.trouver(G)!.file.length, 30, 'les 30 pages du plan compressé');
  const bombe = gzipSync(Buffer.alloc(50 * 1024 * 1024, 0x61));
  const t = performance.now(); const lu = degonfler(bombe, 1024 * 1024);
  assert.ok(lu.length <= 1024 * 1024 && lu.length > 0, `${lu.length} octets`); assert.ok(performance.now() - t < 5000);
});

test('à vérifier : « lues » ne compte que les pages réellement lues ; les pages déjà vues sont comptées à part', async () => {
  const a = absorbeur({ robot: { async visiter() { return { genre: 'pas-due' } as never; }, etats: () => ({}) } });
  a.ajouter(S, 'page');
  await a.passer(5);
  const s = a.trouver(S)!;
  assert.equal(s.lues, 0); assert.equal(s.dejaVues, 5);
});

test('à vérifier : sans contexte (une scène, un lien), monter le rythme d\'un site ou régler Mathésis est tenu pour grave', async () => {
  const { mathesis } = await import('../src/valhalla/mathesis/module.ts');
  const mod = mathesis(() => ({}));
  const a = (id: string) => mod.actions.find((x) => x.id === id)!;
  assert.ok(a('rythme_site').grave?.({ adresse: 'essai.example.org', pagesParJour: 400 }));
  assert.ok(a('regler').grave?.({ pages: 100000 }));
});

test('à vérifier : une page en écriture non latine donne des faits (chinois coupé à « 。 », arabe, russe)', async () => {
  const { recouper } = await import('../src/valhalla/mathesis/recherche.ts');
  const pg = (url: string, titre: string, texte: string) => ({ url, urlFinale: url, site: new URL(url).hostname, titre, texte, liens: [], octets: 1, empreinte: url, fraicheur: {}, nofollow: false }) as never;
  const zh = recouper([pg('https://zh.example.org/b', '如何配置备份服务器', '配置备份服务器之前，先在两台机器上安装同步软件。备份服务器每天夜里两点复制数据。')], '如何配置备份服务器', Date.now(), { sansCentraux: true }).faits.map((f) => f.texte);
  assert.deepEqual(zh, ['配置备份服务器之前，先在两台机器上安装同步软件。', '备份服务器每天夜里两点复制数据。']);
  const ar = recouper([pg('https://ar.example.org/b', 'إعداد خادم النسخ الاحتياطي', 'يبدأ إعداد خادم النسخ الاحتياطي بتثبيت برنامج المزامنة على الجهازين. يقوم خادم النسخ الاحتياطي بنسخ البيانات كل ليلة.')], 'إعداد خادم النسخ الاحتياطي', Date.now(), { sansCentraux: true }).faits;
  assert.equal(ar.length, 2);
});

test('à vérifier : « absorbe ce site » pendant qu\'Odin répond n\'attend pas l\'aperçu (aucune demande, réponse immédiate)', async () => {
  const { monter } = await import('./mathesis-outils-essai.ts');
  const { m, site } = monter({ pages: {}, reglages: { heures: [{ de: 0, a: 24 }] }, occupe: () => true });
  m.absorbeur.ajouter(S, 'discussion');
  const t = performance.now(); const r = await m.absorbeur.apercu('essai.example.org');
  assert.equal(r.lu, false); assert.equal(site.demandes.length, 0); assert.ok(performance.now() - t < 200);
});
