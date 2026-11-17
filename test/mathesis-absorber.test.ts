// Mathésis — absorber un site (demande du propriétaire, 17/11/2026), sur un FAUX site, sans réseau :
//  - lecture des plans de site, des fils d'actualité, des consignes (Sitemap:) ; adresses normalisées ;
//  - un site d'essai de 40 pages (plan, fil, robots.txt qui interdit /prive/) : tout ce qui est permis est lu, au délai
//    poli, rien de /prive/, état « absorbé » ; puis une page ajoutée au fil : seule elle est lue au passage suivant ;
//  - un site qui interdit tout aux robots : refus clair à l'ajout ;
//  - « absorbe ce site … » et « as-tu absorbé … ? » dans la discussion ; monter le rythme = grave, au-delà = refusé ;
//  - l'adresse de la page et sa date gardées avec chaque fait : « où trouver » cite la page précise ;
//  - coupé, en pause, en mode privé : rien n'est lu.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { estArticle, lireFil, lirePlan, normaliserAdresse, resumerConsignes } from '../src/valhalla/mathesis/absorber.ts';
import { analyserRobots } from '../src/valhalla/mathesis/robots.ts';
import { filsDePage } from '../src/valhalla/mathesis/lecteur.ts';
import { Valhalla } from '../src/valhalla/service.ts';
import { mathesis, type OptionsModuleMathesis } from '../src/valhalla/mathesis/module.ts';
import { oublierBranchementsMathesis } from '../src/valhalla/mathesis/magasin.ts';
import { understand } from '../src/valhalla/huginn.ts';
import type { View } from '../src/valhalla/types.ts';
import { fausseHorloge, fauxSite, fauxResolveur, fauxMoteur, html, monter, type FaussePage } from './mathesis-outils-essai.ts';

const JOUR = 86_400_000;
const S = 'https://essai.example.org';
const homes: string[] = [];
after(() => { for (const h of homes) rmSync(h, { recursive: true, force: true }); });

// ------------------------------------------------------------------ aides pures
test('plans de site, fils d\'actualité, consignes et adresses : lus sans paquet ajouté', () => {
  const index = '<?xml version="1.0"?><sitemapindex><sitemap><loc>https://a.example.org/post-sitemap.xml</loc></sitemap><sitemap><loc>https://a.example.org/page-sitemap.xml</loc></sitemap></sitemapindex>';
  assert.deepEqual(lirePlan(index), { pages: [], plans: ['https://a.example.org/post-sitemap.xml', 'https://a.example.org/page-sitemap.xml'] });
  const plan = '<urlset><url><loc>https://a.example.org/a?x=1&amp;y=2</loc><lastmod>2026-11-10T08:00:00+00:00</lastmod></url><url><loc><![CDATA[https://a.example.org/b]]></loc></url></urlset>';
  const p = lirePlan(plan);
  assert.deepEqual(p.pages.map((x) => x.url), ['https://a.example.org/a?x=1&y=2', 'https://a.example.org/b']);
  assert.equal(p.pages[0].date, Date.parse('2026-11-10T08:00:00+00:00'));
  const rss = '<rss><channel><title>t</title><item><title>Un</title><link>https://a.example.org/un</link><pubDate>Tue, 17 Nov 2026 08:00:00 GMT</pubDate></item></channel></rss>';
  assert.deepEqual(lireFil(rss), [{ url: 'https://a.example.org/un', date: Date.parse('Tue, 17 Nov 2026 08:00:00 GMT') }]);
  const atom = '<feed><entry><link rel="alternate" href="https://a.example.org/deux"/><updated>2026-11-16T10:00:00Z</updated></entry></feed>';
  assert.deepEqual(lireFil(atom), [{ url: 'https://a.example.org/deux', date: Date.parse('2026-11-16T10:00:00Z') }]);
  const r = analyserRobots('Sitemap: https://a.example.org/sitemap_index.xml\nUser-agent: *\nDisallow: /prive/\nCrawl-delay: 15\n');
  assert.deepEqual(r.plans, ['https://a.example.org/sitemap_index.xml']);
  assert.match(resumerConsignes(r), /interdit aux robots \/prive\/ ; il demande 15 s/);
  assert.deepEqual(filsDePage('<head><link rel="alternate" type="application/rss+xml" href="/feed/"></head>', 'https://a.example.org/'), ['https://a.example.org/feed/']);
  assert.equal(normaliserAdresse('https://A.example.org/x?utm_source=y&id=3#haut'), 'https://a.example.org/x?id=3');
  assert.equal(estArticle('https://a.example.org/2026/11/configurer-wireguard/'), true);
  assert.equal(estArticle('https://a.example.org/category/vpn/'), false);
  assert.equal(estArticle('https://a.example.org/'), false);
});

// ------------------------------------------------------------------ le faux site
const FAIT_WG = 'Pour configurer un VPN WireGuard, il faut générer une paire de clés avec la commande wg genkey sur chaque machine.';
function siteEssai(): Record<string, FaussePage> {
  const pages: Record<string, FaussePage> = {
    [`${S}/robots.txt`]: { corps: `User-agent: *\nDisallow: /prive/\nSitemap: ${S}/sitemap.xml\n`, type: 'text/plain' },
    [`${S}/`]: { corps: html('Essai', ['Bienvenue sur le site d\'essai consacré aux réseaux et aux serveurs.'], [{ href: '/articles/page-1', texte: 'Un' }], '<link rel="alternate" type="application/rss+xml" href="/feed/">') },
  };
  const urls: string[] = [];
  for (let k = 1; k <= 35; k++) urls.push(`${S}/articles/page-${k}`);
  for (let k = 1; k <= 5; k++) urls.push(`${S}/prive/secret-${k}`);
  for (const u of urls) {
    const titre = u.endsWith('page-7') ? 'Configurer un VPN WireGuard' : `Article ${u.split('-').pop()} sur les serveurs`;
    const corps = u.endsWith('page-7') ? [FAIT_WG] : [`Cet article ${u.split('-').pop()} sur les serveurs explique la sauvegarde des serveurs avec des exemples concrets.`];
    pages[u] = { corps: html(titre, corps), etag: '"v1"' };
  }
  pages[`${S}/sitemap.xml`] = { type: 'application/xml', etag: '"p1"', corps: `<urlset>${urls.map((u, i) => `<url><loc>${u}</loc><lastmod>2026-11-${String(1 + (i % 15)).padStart(2, '0')}</lastmod></url>`).join('')}</urlset>` };
  pages[`${S}/feed/`] = { type: 'application/rss+xml', etag: '"f1"', corps: `<rss><channel>${urls.slice(0, 3).map((u) => `<item><link>${u}</link><pubDate>Mon, 16 Nov 2026 10:00:00 GMT</pubDate></item>`).join('')}</channel></rss>` };
  return pages;
}
const REGLAGES = { heures: [{ de: 0, a: 24 }], budgets: { recherches: 0, pages: 1000, octets: 100 * 1024 * 1024, minutesVideo: 0, appelsPayants: 0, fichiers: 0, octetsFichiers: 0 } };

test('un site de 40 pages : tout ce qui est permis est lu au délai poli, rien de /prive/, puis « absorbé » ; ensuite seul le nouveau', async () => {
  const pages = siteEssai();
  const { m, site, horloge, muninn } = monter({ pages, reglages: REGLAGES });
  m.regler({ robot: { ...m.reglages().robot, pagesParSiteJour: 200 } });
  const a = m.absorbeur.ajouter(S, 'discussion');
  assert.ok(a.ok && !a.deja);
  for (let k = 0; k < 6; k++) await m.tour({ absorber: 20, manques: 0, revisites: 0 });
  const x = m.absorbeur.trouver('essai.example.org')!;
  assert.equal(site.demandesVers(/\/prive\//).length, 0, 'aucune page de /prive/ demandée');
  for (let k = 1; k <= 35; k++) assert.equal(site.demandesVers(new RegExp(`/articles/page-${k}$`)).length, 1, `page-${k} lue une fois`);
  assert.equal(x.etat, 'en-suivi');
  assert.ok(x.absorbeLe, 'absorbé');
  assert.equal(x.refusees, 5, 'les 5 adresses de /prive/ sont comptées refusées, jamais demandées');
  assert.match(x.consignes ?? '', /\/prive\//);
  assert.equal(x.plans.length, 1); assert.equal(x.fils.length, 1);
  // Le délai poli : jamais deux demandes au même site à moins de l'attente réglée (2 s par défaut).
  const t = site.demandes.map((d) => d.at);
  for (let i = 1; i < t.length; i++) assert.ok(t[i] - t[i - 1] >= 2_000, `écart ${t[i] - t[i - 1]} ms`);
  // « As-tu absorbé ce site ? »
  assert.match(m.absorbeur.phrase(x), /déjà absorbé le .* \(35 page\(s\) lue\(s\)/);
  // L'adresse précise et la date avec chaque fait : la mémoire et « où trouver ».
  const souvenir = muninn.recall('configurer VPN WireGuard clés', 5, true).find((s) => /wg genkey/.test(s.content));
  assert.ok(souvenir, 'le fait est en mémoire');
  assert.match(souvenir!.source ?? '', new RegExp(`@\\d{4}-\\d{2}-\\d{2} ${S}/articles/page-7$`));
  const ou = m.ouTrouver.chercher('Où trouver comment configurer un VPN WireGuard ?');
  assert.equal(ou[0]?.url, `${S}/articles/page-7`);
  assert.equal(ou[0]?.titre, 'Configurer un VPN WireGuard');
  // Un second passage tout de suite : RIEN n'est demandé.
  const avant = site.demandes.length;
  await m.tour({ absorber: 20, manques: 0, revisites: 0 });
  assert.equal(site.demandes.length, avant, 'rien n\'est relu');
  // Le lendemain : une page ajoutée au fil (et au plan) ; seule elle est lue.
  pages[`${S}/articles/page-36`] = { corps: html('Article 36 sur les serveurs', ['Cet article 36 sur les serveurs explique la supervision des serveurs avec des exemples concrets.']) };
  pages[`${S}/feed/`] = { ...pages[`${S}/feed/`], etag: '"f2"', corps: `<rss><channel><item><link>${S}/articles/page-36</link><pubDate>Wed, 18 Nov 2026 10:00:00 GMT</pubDate></item></channel></rss>` };
  horloge.avancer(JOUR + 60_000);
  const n0 = site.demandes.length;
  await m.tour({ absorber: 20, manques: 0, revisites: 0 });
  const articles = site.demandes.slice(n0).filter((d) => /\/articles\//.test(d.url)).map((d) => d.url);
  assert.deepEqual(articles, [`${S}/articles/page-36`], 'seule la nouvelle page est lue');
  assert.ok(site.demandes.slice(n0).some((d) => /sitemap\.xml$/.test(d.url) && d.entetes['if-none-match'] === '"p1"'), 'le plan est revu par une demande conditionnelle');
  assert.equal(m.absorbeur.trouver(S)!.lues, 36);
});

test('un site qui interdit tout aux robots : refus clair à l\'ajout, rien d\'autre n\'est demandé', async () => {
  const { v, site } = monterAppli({ [`https://ferme.example.net/robots.txt`]: { corps: 'User-agent: *\nDisallow: /\n', type: 'text/plain' } });
  const r = await v.act('mathesis', 'absorber', { adresse: 'https://ferme.example.net' });
  assert.equal(r.ok, false);
  assert.match(r.text, /interdit les robots/);
  assert.deepEqual(site.demandes.map((d) => d.url), ['https://ferme.example.net/robots.txt']);
  const e = await v.act('mathesis', 'etat_site', { adresse: 'ferme.example.net' });
  assert.match(e.text, /refusé/);
  v.stop();
});

// ------------------------------------------------------------------ l'appli : discussion, page, droits
function monterAppli(pages: Record<string, FaussePage> = siteEssai(), o: Partial<OptionsModuleMathesis> = {}) {
  oublierBranchementsMathesis();
  const home = mkdtempSync(join(tmpdir(), 'mathesis-absorber-')); homes.push(home);
  const h = fausseHorloge(new Date(2026, 10, 17, 14, 0).getTime());
  const site = fauxSite(pages, h);
  const opts: OptionsModuleMathesis = { transport: site.transport, resoudre: fauxResolveur(), temps: { maintenant: h.maintenant, attendre: h.attendre }, chercher: fauxMoteur({}).chercher, ...o };
  const mod = mathesis(() => opts);
  const v = new Valhalla(home, [mod], { notify: async () => {}, fetch: async () => { throw new Error('réseau interdit dans les essais'); }, now: () => new Date(h.t) });
  const page = async (): Promise<View> => mod.view(v.ctx('mathesis'), new URLSearchParams()) as Promise<View>;
  return { v, mod, site, h, page };
}

test('dans la discussion : « absorbe ce site … » l\'ajoute (consignes et plan lus) ; le redire dit où il en est ; « as-tu absorbé … ? »', async () => {
  const { v, page } = monterAppli();
  const u = await understand(v, `absorbe ce site ${S}`);
  assert.equal(u?.kind, 'action');
  assert.equal((u as { action: string }).action, 'absorber');
  assert.equal((u as { input: Record<string, unknown> }).input.adresse, S);
  const r1 = await v.order(`absorbe ce site ${S}`);
  assert.match(r1.text, /Ajouté : essai\.example\.org\. Ses consignes : le site interdit aux robots \/prive\/\. 35 page\(s\) à lire trouvée\(s\) dans son plan \(et 5 interdite\(s\) par ses consignes, laissée\(s\)\) ; à ce rythme \(une page toutes les 2 s, 1\s000\s000 par jour au plus\), il me faudra moins d'une heure/);
  const r2 = await v.order('absorbe essai.example.org');
  assert.match(r2.text, /Déjà dans la liste — essai\.example\.org : en cours/);
  const q = await understand(v, 'as-tu absorbé essai.example.org ?');
  assert.equal((q as { action?: string }).action, 'etat_site');
  const r3 = await v.order('as-tu absorbé le site korben-essai.example.net ?');
  assert.match(r3.text, /pas .* dans ma liste de sites à absorber/);
  // La page : l'onglet « Sites » montre le site, son état, ses pages lues et restantes.
  const vue = await page();
  assert.ok(vue.onglets?.includes('Sites'));
  const t = vue.sections.find((x) => x.kind === 'table' && /^Sites à absorber/.test(x.title ?? '')) as { rows: Array<{ cells: string[] }> };
  assert.deepEqual(t.rows[0].cells.slice(0, 4), ['essai.example.org', 'en cours', '0 / 35', '35 (à ce rythme, moins d\'une heure)']);
  v.stop();
});

test('le rythme d\'un site : le propriétaire le règle lui-même (plus une action grave), jusqu\'à 10 000 000 ; un membre ne le change pas', async () => {
  const { v } = monterAppli();
  await v.act('mathesis', 'absorber', { adresse: S });
  // Décision du propriétaire (17/11/2026) : le rythme se règle d'un clic, sans accord à donner.
  const monte = await v.act('mathesis', 'rythme_site', { adresse: 'essai.example.org', pagesParJour: 5000 });
  assert.equal(monte.ok, true, monte.text); assert.match(monte.text, /5000 page\(s\) par jour/);
  const trop = await v.act('mathesis', 'rythme_site', { adresse: 'essai.example.org', pagesParJour: 20_000_000 });
  assert.equal(trop.ok, false); assert.match(trop.text, /de 1 à 10\s000\s000/);
  // Un membre (une personne de Persona connectée à l'interface) ne change pas le rythme.
  const { auNomDe } = await import('../src/valhalla/sso/acces.ts');
  const action = v.action('mathesis', 'rythme_site')!.a;
  await assert.rejects(async () => auNomDe({ login: 'awa', name: 'Awa', groups: [] }, () => action.run(v.ctx('mathesis'), { adresse: 'essai.example.org', pagesParJour: 9 })), /seul le propriétaire/);
  const baisse = await v.act('mathesis', 'rythme_site', { adresse: 'essai.example.org', pagesParJour: 10 }, { auto: true });
  assert.equal(baisse.ok, true);
  const oublie = await v.act('mathesis', 'retirer_site', { adresse: 'essai.example.org', oublier: true }, { auto: true });
  assert.equal(oublie.ok, false, 'oublier ce qui a été appris est grave');
  v.stop();
});

test('coupé, en pause, en mode privé : rien n\'est lu ; aucun site n\'est dans la liste par défaut', async () => {
  for (const cas of ['coupe', 'pause', 'prive'] as const) {
    let prive = false;
    const { m, site } = monter({ pages: siteEssai(), reglages: REGLAGES, prive: () => prive });
    assert.deepEqual(m.absorbeur.liste(), [], 'aucun site par défaut');
    m.absorbeur.ajouter(S, 'page');
    if (cas === 'coupe') m.eteindre(); else if (cas === 'pause') m.pause(); else prive = true;
    await m.tour({ absorber: 20, manques: 0, revisites: 0 });
    assert.equal(site.demandes.length, 0, cas);
  }
});

test('l\'adresse de la page dans la source : sans adresse, rien ne change ; avec, le même fait n\'est pas réappris', async () => {
  const { apprendreDeTout } = await import('../src/learn/apprendre-de-tout.ts');
  const { Mnemosyne } = await import('../src/muninn/store.ts');
  const { fileBornee } = await import('../src/brain/nous/deps.ts');
  const memoire = new Mnemosyne(':memory:');
  const deps = { memoire, nous: { cfg: { learning: { observe: true }, nous: { actif: false } }, privateMode: () => false, demo: false, file: fileBornee() }, maintenant: () => Date.UTC(2026, 10, 17) };
  const fait = { texte: 'Le protocole WireGuard utilise le port UDP 51820 par défaut sur la plupart des installations.' };
  const a = apprendreDeTout(deps, { sorte: 'lecture', source: 'web:a.example.org', date: Date.UTC(2026, 10, 17), faits: [fait] });
  assert.equal(memoire.recall('WireGuard port UDP 51820', 3, true)[0]?.source, 'web:a.example.org@2026-11-17', 'sans adresse : la source d\'avant');
  const b = apprendreDeTout(deps, { sorte: 'lecture', source: 'web:a.example.org', date: Date.UTC(2026, 10, 17), faits: [fait], adresse: 'https://a.example.org/wg' });
  assert.equal(a.retenus, 1); assert.equal(b.ignores, 1, 'même empreinte : pas réappris');
  const c = apprendreDeTout(deps, { sorte: 'lecture', source: 'web:b.example.org', date: Date.UTC(2026, 10, 17), faits: [{ texte: 'Le protocole WireGuard tient en environ quatre mille lignes de code dans le noyau Linux.' }], adresse: 'https://b.example.org/wg?x=1' });
  assert.equal(c.retenus, 1);
  assert.equal(memoire.recall('WireGuard lignes noyau Linux', 3, true)[0]?.source, 'web:b.example.org@2026-11-17 https://b.example.org/wg?x=1');
  const d = apprendreDeTout(deps, { sorte: 'lecture', source: 'web:c.example.org', faits: [{ texte: 'Le protocole WireGuard a été intégré au noyau Linux dans sa version 5.6 en mars 2020.' }], adresse: 'javascript:alert(1)' });
  assert.equal(d.retenus, 1);
  assert.doesNotMatch(memoire.recall('WireGuard noyau 5.6', 3, true)[0]?.source ?? '', /javascript/, 'une adresse qui n\'est pas http(s) n\'est pas écrite');
});

test('vu sur un vrai site : le fil des commentaires et les pages « comment-page-N » sont laissés ; un index de plans est lu en plusieurs fois', async () => {
  const W = 'https://wp.example.org';
  const enfants = Array.from({ length: 6 }, (_, k) => `${W}/post-sitemap${k + 1}.xml`);
  const pages: Record<string, FaussePage> = {
    [`${W}/robots.txt`]: { corps: `User-agent: *\nDisallow: /wp-admin/\nSitemap: ${W}/sitemap_index.xml\n`, type: 'text/plain' },
    [`${W}/sitemap_index.xml`]: { type: 'application/xml', corps: `<sitemapindex>${enfants.map((u) => `<sitemap><loc>${u}</loc></sitemap>`).join('')}</sitemapindex>` },
    [`${W}/`]: { corps: html('Accueil', ['Le site d\'essai sur les serveurs et les réseaux, avec des tutoriels.'], [], `<link rel="alternate" type="application/rss+xml" href="${W}/feed/"><link rel="alternate" type="application/rss+xml" href="${W}/comments/feed/">`) },
    [`${W}/feed/`]: { type: 'application/rss+xml', corps: `<rss><channel><item><link>${W}/tuto-a/</link></item><item><link>${W}/tuto-a/comment-page-1/</link></item></channel></rss>` },
    [`${W}/comments/feed/`]: { type: 'application/rss+xml', corps: `<rss><channel><item><link>${W}/tuto-b/comment-page-1/</link></item></channel></rss>` },
  };
  enfants.forEach((u, k) => { pages[u] = { type: 'application/xml', corps: `<urlset><url><loc>${W}/tuto-${k}/</loc></url></urlset>` }; });
  const { m, site, horloge } = monter({ pages, reglages: REGLAGES });
  m.absorbeur.ajouter(W, 'page');
  await m.absorbeur.decouvrir('wp.example.org');
  const x = m.absorbeur.trouver(W)!;
  assert.equal(site.demandesVers(/\/comments\/feed\/$/).length, 0, 'le fil des commentaires n\'est pas lu');
  assert.equal(x.file.some((f) => /comment-page/.test(f.url)), false, 'aucune page de commentaires en file');
  assert.equal(x.fils.length, 1);
  // Index + 3 plans lus (4 au plus par découverte) ; les 3 autres attendent la découverte suivante, une heure plus tard.
  assert.equal(x.plansAVoir?.length, 3);
  horloge.avancer(3_600_000 + 1000);
  await m.absorbeur.decouvrir('wp.example.org');
  for (const u of enfants) assert.equal(site.demandesVers(new RegExp(`${u.replace(/[.]/g, '\.')}$`)).length, 1, `${u} lu une fois`);
  assert.deepEqual(m.absorbeur.trouver(W)!.plansAVoir, []);
});

test('vu sur un vrai site : un plan de site plus gros que la borne est lu en partie (son début), pas laissé', async () => {
  const G = 'https://gros.example.org';
  const urls = Array.from({ length: 2000 }, (_, k) => `${G}/article-numero-${k}-avec-un-titre-assez-long.html`);
  const pages: Record<string, FaussePage> = {
    [`${G}/robots.txt`]: { corps: `User-agent: *\nDisallow:\nSitemap: ${G}/sitemap-main.xml\n`, type: 'text/plain' },
    [`${G}/sitemap-main.xml`]: { type: 'application/xml', corps: `<urlset>${urls.map((u) => `<url><loc>${u}</loc><lastmod>2026-11-01</lastmod></url>`).join('')}</urlset>` },
  };
  const { m } = monter({ pages, reglages: REGLAGES });
  m.regler({ robot: { ...m.reglages().robot, tailleMaxPage: 32 * 1024 } });
  assert.ok(pages[`${G}/sitemap-main.xml`].corps!.length > 100 * 1024, 'le plan dépasse largement la borne');
  m.absorbeur.ajouter(G, 'page');
  await m.absorbeur.apercu('gros.example.org');
  const n = m.absorbeur.trouver(G)!.file.length;
  assert.ok(n > 100 && n < 2000, `le début du plan est lu (${n} adresses)`);
});

test('vu sur un vrai site : un plan lu à l\'aperçu n\'est pas redemandé à la découverte ; le fil d\'Ariane n\'est pas un fait', async () => {
  const { m, site } = monter({ pages: siteEssai(), reglages: REGLAGES });
  m.regler({ robot: { ...m.reglages().robot, pagesParSiteJour: 200 } });
  m.absorbeur.ajouter(S, 'discussion');
  await m.absorbeur.apercu('essai.example.org');
  await m.tour({ absorber: 5, manques: 0, revisites: 0 });
  const parUrl = new Map<string, number>();
  for (const d of site.demandes) parUrl.set(d.url, (parUrl.get(d.url) ?? 0) + 1);
  assert.deepEqual([...parUrl].filter(([u, n]) => n > 1 && !/robots\.txt$/.test(u)), [], 'aucune adresse demandée deux fois');
  const { phrasesPertinentes } = await import('../src/valhalla/mathesis/recherche.ts');
  const ariane = 'IT-Essai » Actualités » Actu Cybersécurité » SignDrop : cette faille zero-day Windows détourne la protection CLFS du système.';
  assert.deepEqual(phrasesPertinentes(ariane, ['faille', 'windows', 'clfs']).gardees, []);
  const citation = 'Le chercheur parle d\'une « faille » dans « CLFS » et dit que la faille Windows touche CLFS directement.';
  assert.equal(phrasesPertinentes(citation, ['faille', 'windows', 'clfs']).gardees.length, 1, 'des guillemets français ne sont pas un fil d\'Ariane');
});
