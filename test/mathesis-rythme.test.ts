// Mathésis — le RYTHME d'absorption, d'après les réponses du propriétaire (17/11/2026) :
//  - « 1 000 000 pages par jour, réglable dans les réglages » : le plafond par site (et celui du jour, tous sites
//    confondus) est un réglage, 1 000 000 par défaut ; plus de refus au-delà de 500 ;
//  - « 2 secondes » entre deux pages d'un même site, par défaut et réglable ; un site qui demande plus l'obtient toujours ;
//  - le propriétaire règle lui-même (plus une action grave) ; un membre ne le change pas ;
//  - un site de 6 000 pages se met en file sans rien perdre ; la page dit l'estimation à jour.
import { test, after } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { Valhalla } from '../src/valhalla/service.ts';
import { mathesis } from '../src/valhalla/mathesis/module.ts';
import { creerMathesis } from '../src/valhalla/mathesis/moteur.ts';
import { MagasinMemoire, oublierBranchementsMathesis } from '../src/valhalla/mathesis/magasin.ts';
import { reglagesParDefaut, PAGES_JOUR_DEFAUT } from '../src/valhalla/mathesis/reglages.ts';
import { FILE_MAX } from '../src/valhalla/mathesis/absorber.ts';
import { auNomDe } from '../src/valhalla/sso/acces.ts';
import { fausseHorloge, fauxResolveur, fauxSite, html, monter, type FaussePage } from './mathesis-outils-essai.ts';

const S = 'https://grand.example.org';
const homes: string[] = [];
after(() => { for (const h of homes) rmSync(h, { recursive: true, force: true }); });
/** L'appli Mathésis dans un Valhalla d'essai (dossier jetable, horloge fausse, aucun réseau). */
function appli() {
  oublierBranchementsMathesis();
  const home = mkdtempSync(join(tmpdir(), 'mathesis-rythme-')); homes.push(home);
  const h = fausseHorloge(new Date(2026, 10, 17, 14, 0).getTime());
  const mod = mathesis(() => ({ transport: fauxSite({}, h).transport, resoudre: fauxResolveur(), temps: { maintenant: h.maintenant, attendre: h.attendre } }));
  return new Valhalla(home, [mod], { notify: async () => {}, fetch: async () => { throw new Error('réseau interdit dans les essais'); }, now: () => new Date(h.t) });
}
const REGLAGES = { heures: [{ de: 0, a: 24 }] };

/** Un site de `n` pages, avec un plan et ses consignes (éventuellement un Crawl-delay). */
function site(n: number, crawlDelay?: number): Record<string, FaussePage> {
  const urls = Array.from({ length: n }, (_, k) => `${S}/articles/page-${k + 1}`);
  const pages: Record<string, FaussePage> = {
    [`${S}/robots.txt`]: { corps: `User-agent: *\nDisallow: /prive/\n${crawlDelay ? `Crawl-delay: ${crawlDelay}\n` : ''}Sitemap: ${S}/sitemap.xml\n`, type: 'text/plain' },
    [`${S}/`]: { corps: html('Grand site', ['Un grand site d\'essai sur les serveurs.']) },
    [`${S}/sitemap.xml`]: { type: 'application/xml', corps: `<urlset>${urls.map((u) => `<url><loc>${u}</loc></url>`).join('')}</urlset>` },
  };
  for (const u of urls.slice(0, 40)) pages[u] = { corps: html(`Article ${u.split('-').pop()}`, [`Cet article ${u.split('-').pop()} parle de la sauvegarde des serveurs avec des exemples concrets.`]) };
  return pages;
}

test('les défauts : 1 000 000 pages par jour (tous sites et par site), 2 s entre deux pages d\'un même site', () => {
  const r = reglagesParDefaut();
  assert.equal(PAGES_JOUR_DEFAUT, 1_000_000);
  assert.equal(r.budgets.pages, 1_000_000);
  assert.equal(r.robot.pagesParSiteAbsorber, 1_000_000);
  assert.equal(r.robot.delaiSiteMs, 2_000);
});

test('le réglage est lu : pages par site et attente, réglés par le propriétaire, sans accord à donner', async () => {
  const { m } = monter({ pages: site(30), reglages: REGLAGES });
  m.absorbeur.ajouter(S, 'page');
  const x = m.absorbeur.trouver('grand.example.org')!;
  assert.equal(m.absorbeur.plafond(x), 1_000_000);
  m.regler({ robot: { ...m.reglages().robot, pagesParSiteAbsorber: 7, delaiSiteMs: 3_000 } });
  assert.equal(m.absorbeur.plafond(m.absorbeur.trouver('grand.example.org')!), 7, 'le plafond par site vient du réglage');
  assert.equal(m.absorbeur.attente(m.absorbeur.trouver('grand.example.org')!), 3_000, 'l\'attente vient du réglage');
  // Par l'appli (page Réglages ou parole) : ni grave, ni refus au-delà de 500.
  const v = appli();
  const f = v.action('mathesis', 'regler')!;
  assert.equal(f.a.grave?.({ pages: 5_000_000, pagesParSite: 2_000_000, attenteS: 2 }, v.ctx('mathesis')), undefined, 'le rythme n\'est plus une action grave');
  assert.match(String(f.a.grave?.({ recherches: 999 }, v.ctx('mathesis'))), /monter le budget « Recherches »/, 'les autres budgets restent graves quand ils montent');
  const ok = await v.act('mathesis', 'regler', { pagesParSite: 2_000_000, attenteS: 4 });
  assert.equal(ok.ok, true, ok.text);
  assert.match(ok.text, /2000000 page\(s\) par jour et par site à absorber, 4 s entre deux pages/);
  const bas = await v.act('mathesis', 'regler', { attenteS: 0.5 });
  assert.equal(bas.ok, true);
  assert.match(bas.text, /2 s entre deux pages/, 'jamais moins de 2 s');
  v.stop();
});

test('l\'attente du site l\'emporte quand elle est plus longue ; sinon le réglage (2 s)', async () => {
  // Le site demande 5 s (Crawl-delay) : jamais moins, même si le réglage dit 2 s.
  const a = monter({ pages: site(12, 5), reglages: REGLAGES });
  a.m.absorbeur.ajouter(S, 'page');
  await a.m.tour({ absorber: 8, manques: 0, revisites: 0 });
  const ta = a.site.demandes.filter((d) => /\/articles\//.test(d.url)).map((d) => d.at);
  assert.ok(ta.length >= 4, `des pages lues (${ta.length})`);
  for (let i = 1; i < ta.length; i++) assert.ok(ta[i] - ta[i - 1] >= 5_000, `écart ${ta[i] - ta[i - 1]} ms (le site demande 5 s)`);
  assert.equal(a.m.absorbeur.attente(a.m.absorbeur.trouver('grand.example.org')!), 5_000);
  // Sans consigne : le réglage, 2 s.
  const b = monter({ pages: site(12), reglages: REGLAGES });
  b.m.absorbeur.ajouter(S, 'page');
  await b.m.tour({ absorber: 8, manques: 0, revisites: 0 });
  const tb = b.site.demandes.map((d) => d.at);
  for (let i = 1; i < tb.length; i++) assert.ok(tb[i] - tb[i - 1] >= 2_000, `écart ${tb[i] - tb[i - 1]} ms`);
  assert.ok(tb.slice(1).some((t, i) => t - tb[i] < 5_000), 'pas plus lent que nécessaire');
});

test('un membre ne change pas le rythme (ni réglages, ni rythme d\'un site)', async () => {
  const v = appli();
  const avant = (await v.act('mathesis', 'regler', {})).text;
  const regler = v.action('mathesis', 'regler')!.a;
  await assert.rejects(async () => auNomDe({ login: 'awa', name: 'Awa', groups: ['famille'] }, () => regler.run(v.ctx('mathesis'), { pagesParSite: 9_000_000, attenteS: 2 })), /seul le propriétaire règle Mathésis/);
  assert.equal((await v.act('mathesis', 'regler', {})).text, avant, 'rien n\'a changé');
  v.stop();
});

test('un site de 6 000 pages se met en file sans rien perdre ; la page dit l\'estimation à jour', async () => {
  const { m } = monter({ pages: site(6_000), reglages: REGLAGES });
  m.absorbeur.ajouter(S, 'page');
  await m.tour({ absorber: 1, manques: 0, revisites: 0 });
  const x = m.absorbeur.trouver('grand.example.org')!;
  assert.equal(x.lues + x.file.length, 6_000, `toutes les adresses sont gardées (${x.lues} lue(s) + ${x.file.length} en file)`);
  assert.ok(FILE_MAX >= 6_000);
  // À 2 s la page, un passage de 14 min sur 15 : ~1 680 pages par heure, donc environ 4 heures pour ~6 000 pages.
  const est = m.absorbeur.estimation(x)!;
  assert.match(est.texte, /^environ 4 heure\(s\)$/, est.texte);
  assert.match(m.absorbeur.phrase(x), /à ce rythme, environ 4 heure\(s\)/);
  // Un plafond du jour plus bas que ce que les heures permettent : l'estimation passe en jours.
  m.absorbeur.regler(x.id, 1_000);
  assert.match(m.absorbeur.estimation(m.absorbeur.trouver('grand.example.org')!)!.texte, /^environ 6 jour\(s\)$/);
  assert.ok(m.absorbeur.pagesParPassage() >= 400, 'un passage de fond lit au rythme du réglage, pas 10 pages');
});

test('des réglages enregistrés avant ce rythme : restés aux anciens défauts → nouveaux défauts ; un choix du propriétaire est gardé', () => {
  const h = fausseHorloge(Date.parse('2026-11-17T02:00:00'));
  const ancien = (pages: number) => {
    const magasin = new MagasinMemoire();
    const r = reglagesParDefaut() as unknown as Record<string, unknown>;
    delete r.version;
    magasin.ecrire('reglages', { ...r, budgets: { ...reglagesParDefaut().budgets, pages, octets: 50 * 1024 * 1024 }, robot: { ...reglagesParDefaut().robot, delaiSiteMs: 10_000 } });
    return creerMathesis({ dossier: 'x', home: 'x', magasin, transport: fauxSite({}, h).transport, temps: { maintenant: h.maintenant, attendre: h.attendre } });
  };
  const m1 = ancien(100);
  assert.equal(m1.reglages().budgets.pages, 1_000_000);
  assert.equal(m1.reglages().budgets.octets, 2 * 1024 * 1024 * 1024);
  assert.equal(m1.reglages().robot.delaiSiteMs, 2_000);
  assert.equal(ancien(250).reglages().budgets.pages, 250, 'une valeur choisie par le propriétaire reste');
});
