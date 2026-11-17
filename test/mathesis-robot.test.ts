// Mathésis — lot 3 : le robot de lecture contre un faux site (aucun réseau). Date et empreinte notées, page
// inchangée non relue, page modifiée relue, page interdite par les consignes jamais demandée, délai entre deux
// demandes tenu, plafonds tenus ; et les limites : lecture seule, aucun cookie, nom honnête, pas d'IP, pas de port,
// pas d'adresse privée (même par redirection ou par le DNS), refus laissés et sites mis en pause.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { monter, html, JOUR_PLEIN, type FaussePage } from './mathesis-outils-essai.ts';
import { controlerAdresse, controlerForme, ipInterdite, lookupGarde } from '../src/valhalla/mathesis/adresses.ts';
import { analyserRobots, permis, consignesDeStatut, AGENT_ROBOT } from '../src/valhalla/mathesis/robots.ts';
import { transportSysteme, liensDe, consignesPage } from '../src/valhalla/mathesis/lecteur.ts';
import { intervalleSuivant, lienPertinent } from '../src/valhalla/mathesis/robot.ts';

const JOUR = 86_400_000;
const ROBOTS = { corps: 'User-agent: *\nDisallow: /prive/\nCrawl-delay: 2\n\nUser-agent: AutreRobot\nDisallow: /\n', type: 'text/plain' };
const P = (t: string) => `Le jardin créole mélange ${t} : les plantes du jardin créole poussent bien à La Réunion toute l'année.`;

// ------------------------------------------------------------------ adresses
test('adresses : schémas, identifiants, ports, IP écrites en chiffres, noms de la maison — refusés', () => {
  for (const u of ['ftp://exemple.fr/x', 'file:///etc/passwd', 'javascript:alert(1)', 'data:text/html,x', 'https://user:mdp@exemple.fr/',
    'https://exemple.fr:8080/', 'http://exemple.fr:443/', 'https://exemple.fr:22/', 'http://127.0.0.1/', 'http://2130706433/', 'http://0x7f000001/',
    'http://[::1]/', 'http://[fe80::1]/', 'http://93.184.216.34/', 'http://localhost/', 'http://nas.local/', 'http://box.lan/', 'http://routeur/']) {
    assert.equal(controlerForme(u).ok, false, u);
  }
  assert.equal(controlerForme('https://exemple.fr/page?q=1#ancre').ok, true);
  assert.equal(controlerForme('http://exemple.fr:80/').ok, true, 'port 80 explicite = port habituel');
  for (const ip of ['10.1.2.3', '192.168.1.1', '172.16.0.1', '127.0.0.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1', '255.255.255.255', '::1', 'fe80::1', 'fd00::1', 'ff02::1', '::ffff:127.0.0.1', '::ffff:7f00:1', '198.18.0.1']) {
    assert.equal(ipInterdite(ip), true, ip);
  }
  assert.equal(ipInterdite('93.184.216.34'), false);
  assert.equal(ipInterdite('2606:2800:220:1::1'), false);
});

test('adresses : un nom qui mène à une adresse privée est refusé (contrôle et connexion)', async () => {
  const res = async (h: string) => (h === 'piege.exemple.fr' ? ['93.184.216.34', '192.168.1.10'] : h === 'absent.fr' ? [] : ['93.184.216.34']);
  assert.equal((await controlerAdresse('https://piege.exemple.fr/', res)).ok, false);
  assert.equal((await controlerAdresse('https://absent.fr/', res)).ok, false);
  assert.equal((await controlerAdresse('https://exemple.fr/', res)).ok, true);
  // Au moment même de la connexion (rebond DNS) : la garde refuse.
  const base = (h: string, _o: unknown, cb: (e: NodeJS.ErrnoException | null, a: Array<{ address: string; family: number }>) => void) => cb(null, h === 'rebond.fr' ? [{ address: '127.0.0.1', family: 4 }] : [{ address: '93.184.216.34', family: 4 }]);
  const g = lookupGarde(base as never);
  const r1 = await new Promise<{ err: NodeJS.ErrnoException | null; adr?: unknown }>((ok) => g('rebond.fr', {}, (err, adr) => ok({ err, adr })));
  assert.equal(r1.err?.code, 'EODINPRIVE');
  const r2 = await new Promise<{ err: NodeJS.ErrnoException | null; adr?: unknown }>((ok) => g('exemple.fr', {}, (err, adr) => ok({ err, adr })));
  assert.equal(r2.err, null);
  assert.equal(r2.adr, '93.184.216.34');
});

test('le transport système refuse toute autre méthode que GET et HEAD', async () => {
  for (const m of ['POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS']) {
    await assert.rejects(transportSysteme('https://exemple.fr/', { method: m as 'GET', headers: {}, redirect: 'manual' }), /méthode refusée/);
  }
});

// ------------------------------------------------------------------ consignes des robots
test('consignes des robots : notre groupe, sinon « * », règle la plus longue, Allow à égalité, * et $', () => {
  const r = analyserRobots('User-agent: *\nDisallow: /\n\nUser-agent: OdinMathesis\nDisallow: /prive/\nAllow: /prive/public/\nDisallow: /*.pdf$\nCrawl-delay: 5\n');
  assert.equal(r.delaiS, 5);
  assert.equal(permis(r, '/article'), true);
  assert.equal(permis(r, '/prive/x'), false);
  assert.equal(permis(r, '/prive/public/x'), true);
  assert.equal(permis(r, '/doc/a.pdf'), false);
  assert.equal(permis(r, '/doc/a.pdf?x=1'), true);
  assert.equal(permis(analyserRobots('User-agent: *\nDisallow: /\n'), '/x'), false);
  assert.equal(permis(analyserRobots('User-agent: *\nDisallow:\n'), '/x'), true);
  assert.equal(permis(analyserRobots('User-agent: *\nDisallow: /a\nAllow: /a\n'), '/a'), true, 'Allow l\'emporte à égalité');
  assert.equal(consignesDeStatut(404, '').regles.tout, 'permis');
  assert.equal(consignesDeStatut(403, '').regles.tout, 'interdit');
  assert.equal(consignesDeStatut(500, '').regles.tout, 'interdit');
  assert.equal(consignesDeStatut(429, '').regles.tout, 'interdit');
});

test('liens : nofollow écarté, schémas étranges écartés ; consignes de page ; lien pertinent', () => {
  const l = liensDe('<a href="/a">A</a><a href="javascript:x()">J</a><a rel="nofollow" href="/b">B</a><a href="mailto:x@y.fr">M</a><a href="https://autre.fr/c#z">C</a>', 'https://exemple.fr/p', 10);
  assert.deepEqual(l.map((x) => x.url), ['https://exemple.fr/a', 'https://autre.fr/c']);
  assert.deepEqual(consignesPage('<meta name="robots" content="noindex, nofollow">', null), { noindex: true, nofollow: true });
  assert.deepEqual(consignesPage('', 'none'), { noindex: true, nofollow: true });
  assert.equal(lienPertinent({ url: 'https://exemple.fr/jardin-creole', texte: 'en savoir plus' }, ['jardin', 'creole']), true);
  assert.equal(lienPertinent({ url: 'https://exemple.fr/mentions-legales', texte: 'Mentions' }, ['jardin', 'creole']), false);
  assert.equal(intervalleSuivant(8 * JOUR, true), 4 * JOUR);
  assert.equal(intervalleSuivant(8 * JOUR, false), 12 * JOUR);
});

// ------------------------------------------------------------------ le robot contre un faux site
function siteJardin(): Record<string, FaussePage> {
  return {
    'https://jardin.fr/robots.txt': ROBOTS,
    'https://jardin.fr/creole': { etag: '"v1"', entetes: { 'cache-control': 'max-age=172800', 'set-cookie': 'pistage=1' }, corps: html('Jardin créole', [P('légumes et fleurs'), P('arbres fruitiers')], [{ href: '/jardin-creole/plantes', texte: 'Les plantes du jardin créole' }, { href: '/prive/jardin-creole', texte: 'Jardin créole privé' }, { href: '/mentions', texte: 'Mentions légales' }]) },
    'https://jardin.fr/jardin-creole/plantes': { corps: html('Plantes', [P('brèdes et piments')]) },
    'https://jardin.fr/prive/jardin-creole': { corps: html('Privé', [P('secret')]) },
  };
}

test('robot : date et empreinte notées, page interdite jamais demandée, délai tenu, nom honnête, ni cookie ni autre méthode', async () => {
  const { m, site } = monter({ pages: siteJardin() });
  const b = await m.robot.explorer({ id: 'x', sujet: 'jardin créole', raison: 'essai' }, ['https://jardin.fr/creole']);
  assert.equal(b.pages.length, 2);
  const e = m.robot.etats()['https://jardin.fr/creole'];
  assert.equal(e.derniereVisite, new Date(e.derniereVisiteMs).toISOString().slice(0, 10));
  assert.match(e.empreinte ?? '', /^[0-9a-f]{64}$/);
  assert.equal(e.fraicheur.etag, '"v1"');
  assert.equal(e.fraicheur.maxAgeS, 172800);
  assert.equal(e.intervalleMs, 2 * JOUR, 'revisite d\'après les indications du site');
  assert.equal(site.demandesVers(/\/prive\//).length, 0, 'jamais demandée');
  assert.equal(site.demandesVers(/\/mentions/).length, 0, 'lien hors sujet non suivi');
  assert.ok(b.sautees.some((s) => /consignes des robots/.test(s.raison)));
  // Délai entre deux demandes au même site : au moins le réglage (2 s par défaut, décision du 17/11/2026), jamais moins que le crawl-delay.
  const t = site.demandes.map((d) => d.at);
  for (let i = 1; i < t.length; i++) assert.ok(t[i] - t[i - 1] >= 2_000, `écart ${t[i] - t[i - 1]} ms`);
  for (const d of site.demandes) {
    assert.equal(d.methode, 'GET');
    assert.equal(d.entetes['user-agent'], AGENT_ROBOT);
    assert.equal(d.entetes.cookie, undefined);
    assert.equal(d.entetes.authorization, undefined);
  }
  // Les consignes sont gardées en cache : un deuxième passage ne les redemande pas.
  const avant = site.demandesVers(/robots\.txt/).length;
  await m.robot.explorer({ id: 'x', sujet: 'jardin créole', raison: 'essai' }, ['https://jardin.fr/creole']);
  assert.equal(site.demandesVers(/robots\.txt/).length, avant);
});

test('robot : page inchangée pas relue (pas due, puis 304, puis même empreinte) ; page modifiée relue ; revisite adaptée', async () => {
  const pages = siteJardin();
  const { m, site, horloge } = monter({ pages, reglages: { heures: [{ de: 0, a: 24 }] } });
  const sujet = { id: 'x', sujet: 'jardin créole', raison: 'essai' };
  await m.robot.explorer(sujet, ['https://jardin.fr/creole']);
  const n0 = site.demandesVers(/\/creole$/).length;
  // Une heure plus tard : pas due → pas demandée du tout.
  horloge.avancer(3_600_000);
  const b1 = await m.robot.explorer(sujet, ['https://jardin.fr/creole']);
  assert.equal(site.demandesVers(/\/creole$/).length, n0);
  assert.equal(b1.pasDues, 1);
  // Trois jours plus tard : demande conditionnelle → 304 → pas relue, intervalle allongé.
  horloge.avancer(3 * JOUR);
  const b2 = await m.robot.explorer(sujet, ['https://jardin.fr/creole']);
  const dern = site.demandesVers(/\/creole$/).at(-1)!;
  assert.equal(dern.entetes['if-none-match'], '"v1"');
  assert.equal(b2.inchangees, 1);
  assert.equal(b2.pages.length, 0);
  assert.equal(m.robot.etats()['https://jardin.fr/creole'].intervalleMs, 3 * JOUR);
  // Le site change de version mais pas de contenu : même empreinte → pas réanalysée.
  pages['https://jardin.fr/creole'] = { ...pages['https://jardin.fr/creole'], etag: '"v2"' };
  horloge.avancer(4 * JOUR);
  const b3 = await m.robot.explorer(sujet, ['https://jardin.fr/creole']);
  assert.equal(b3.pages.length, 0);
  // Le contenu change : relue et rendue, intervalle raccourci, changement compté.
  pages['https://jardin.fr/creole'] = { etag: '"v3"', corps: html('Jardin créole', [P('nouveautés de saison')]) };
  horloge.avancer(10 * JOUR);
  const rv = await m.robot.revisiter(5);
  assert.equal([...rv.parSujet.values()].flat().length, 1);
  const e = m.robot.etats()['https://jardin.fr/creole'];
  assert.equal(e.changements, 1);
  assert.ok(e.intervalleMs < 4.5 * JOUR);
  assert.equal(e.premiereVisite, '2026-11-17');
  assert.notEqual(e.derniereVisite, e.premiereVisite);
});

test('robot : refus (403, 429, anti-robot, connexion) laissés, site mis en pause, on n\'insiste pas', async () => {
  const pages: Record<string, { statut?: number; corps?: string; type?: string; entetes?: Record<string, string> }> = {
    'https://refus.fr/a': { statut: 403, corps: 'non' },
    'https://refus.fr/b': { corps: html('b', [P('b')]) },
    'https://lent.fr/a': { statut: 429, entetes: { 'retry-after': '7200' } },
    'https://defi.fr/a': { corps: '<html><title>Just a moment...</title><div class="cf-chl">Verify you are human</div></html>' },
    'https://compte.fr/a': { statut: 302, entetes: { location: '/login?suite=/a' } },
  };
  const { m, site } = monter({ pages });
  const sujet = { id: 'x', sujet: 'jardin créole', raison: 'essai' };
  const b = await m.robot.explorer(sujet, ['https://refus.fr/a', 'https://lent.fr/a', 'https://defi.fr/a', 'https://compte.fr/a']);
  assert.equal(b.refus.length, 4, JSON.stringify(b));
  for (const h of ['refus.fr', 'lent.fr', 'defi.fr', 'compte.fr']) assert.ok(m.lecteur.enPause(h), h);
  const avant = site.demandes.length;
  const b2 = await m.robot.explorer(sujet, ['https://refus.fr/b']);
  assert.equal(site.demandes.length, avant, 'le site en pause n\'est plus sollicité');
  assert.ok(b2.sautees.some((s) => /en pause/.test(s.raison)));
  assert.equal(site.demandesVers(/login/).length, 0, 'jamais de page de connexion demandée');
  assert.ok(m.journal.lire().some((e) => e.genre === 'refus'));
});

test('robot : redirection vers une adresse privée ou une IP, jamais suivie ; trop de redirections bornées', async () => {
  const pages = {
    'https://saut.fr/a': { statut: 301, entetes: { location: 'http://192.168.1.1/admin' } },
    'https://saut.fr/b': { statut: 302, entetes: { location: 'https://interne.saut.fr/x' } },
    'https://saut.fr/c': { statut: 302, entetes: { location: 'https://saut.fr:8443/x' } },
    'https://boucle.fr/1': { statut: 302, entetes: { location: '/2' } },
    'https://boucle.fr/2': { statut: 302, entetes: { location: '/3' } },
    'https://boucle.fr/3': { statut: 302, entetes: { location: '/4' } },
    'https://boucle.fr/4': { statut: 302, entetes: { location: '/5' } },
    'https://boucle.fr/5': { corps: html('fin', [P('fin')]) },
  };
  const { m, site } = monter({ pages, resolveur: { 'interne.saut.fr': ['10.0.0.8'] }, reglages: { heures: [{ de: 0, a: 24 }] } });
  const r1 = await m.lecteur.lire('https://saut.fr/a');
  const r2 = await m.lecteur.lire('https://saut.fr/b');
  const r3 = await m.lecteur.lire('https://saut.fr/c');
  assert.equal(r1.genre, 'saute'); assert.equal(r2.genre, 'saute'); assert.equal(r3.genre, 'saute');
  assert.equal(site.demandes.some((d) => /192\.168|interne\.saut|8443/.test(d.url)), false);
  const r4 = await m.lecteur.lire('https://boucle.fr/1');
  assert.equal(r4.genre, 'saute');
  assert.match((r4 as { raison: string }).raison, /trop de redirections/);
  assert.equal(site.demandesVers(/boucle\.fr\/5/).length, 0);
});

test('robot : taille, type, plafond par site et par jour, budget de pages — tous tenus sous charge', async () => {
  const gros = 'x'.repeat(40 * 1024);
  const pages: Record<string, { corps?: string; type?: string }> = {
    'https://borne.fr/gros': { corps: html('gros', [gros]) },
    'https://borne.fr/image': { corps: 'PNG', type: 'image/png' },
  };
  for (let i = 0; i < 20; i++) pages[`https://charge.fr/p${i}`] = { corps: html(`p${i}`, [P(`page ${i}`)]) };
  const a = monter({ pages, reglages: { robot: { tailleMaxPage: 16 * 1024, pagesParSiteJour: 5, pagesParSiteAbsorber: 1_000_000, delaiSiteMs: 10_000, profondeurMax: 2, delaiDemandeMs: 15_000, redirectionsMax: 3, liensParPage: 40, pagesParManque: 50 } } });
  assert.match((await a.m.lecteur.lire('https://borne.fr/gros') as { raison: string }).raison, /trop grosse/);
  assert.match((await a.m.lecteur.lire('https://borne.fr/image') as { raison: string }).raison, /pas du texte/);
  const graines = Object.keys(pages).filter((u) => u.includes('charge.fr'));
  const b = await a.m.robot.explorer({ id: 'x', sujet: 'page', raison: 'charge' }, graines);
  // 5 demandes au plus pour ce site aujourd'hui (consignes des robots comprises).
  assert.equal(a.site.demandesVers(/charge\.fr/).length, 5);
  assert.ok(b.sautees.some((s) => /plafond du jour/.test(s.raison)));

  const c = monter({ pages, reglages: { budgets: { recherches: 10, pages: 3, octets: 1e8, minutesVideo: 0, appelsPayants: 0, fichiers: 0, octetsFichiers: 0 } } });
  const bc = await c.m.robot.explorer({ id: 'x', sujet: 'page', raison: 'charge' }, graines);
  assert.equal(bc.arret, 'budget');
  assert.equal(c.site.demandesVers(/charge\.fr\/p/).length, 3, 'pas une page de plus que le budget');
  assert.equal(c.m.budget.restant('pages'), 0);
});

test('interrupteur éteint, hors des heures, occupé, abandon : rien ne part, ou tout s\'arrête aussitôt', async () => {
  const pages = siteJardin();
  const e = monter({ pages, resultats: () => ['https://jardin.fr/creole'] });
  e.m.curiosite.signaler({ sujet: 'jardin créole', origine: 'question_sans_reponse' });
  e.m.eteindre();
  const b = await e.m.tour();
  assert.equal(b.arret, 'eteint');
  assert.equal(e.site.demandes.length, 0);
  assert.equal(e.moteurRecherche.questions.length, 0);
  assert.equal((await e.m.lecteur.lire('https://jardin.fr/creole')).genre, 'arret', 'même une lecture directe est refusée');

  const j = monter({ pages, resultats: () => ['https://jardin.fr/creole'], debut: JOUR_PLEIN, reglages: { heures: [{ de: 22, a: 7 }] } });
  j.m.curiosite.signaler({ sujet: 'jardin créole', origine: 'question_sans_reponse' });
  assert.equal((await j.m.tour()).arret, 'hors_heures');
  assert.equal(j.site.demandes.length, 0);

  // Odin doit répondre au milieu du travail : arrêt à la demande suivante.
  let occupe = false;
  const o = monter({ pages, resultats: () => ['https://jardin.fr/creole'], occupe: () => occupe });
  o.m.curiosite.signaler({ sujet: 'jardin créole', origine: 'question_sans_reponse' });
  const promesse = o.m.tour({ revisites: 0 });
  occupe = true; // pendant que la première recherche est en cours
  const bo = await promesse;
  assert.equal(bo.arret, 'occupe');
  assert.equal(o.site.demandes.length, 0, 'aucune page demandée après le signal « occupé »');

  // Abandon explicite.
  const a = monter({ pages, resultats: () => ['https://jardin.fr/creole'] });
  a.m.curiosite.signaler({ sujet: 'jardin créole', origine: 'question_sans_reponse' });
  const ac = new AbortController(); ac.abort();
  const ba = await a.m.tour({ signal: ac.signal });
  assert.equal(ba.arret, 'abandon');
  assert.equal(a.site.demandes.length, 0);
});

test('la carte (point de branchement) montre les sites lus et leurs dates', async () => {
  const { m } = monter({ pages: siteJardin() });
  await m.robot.explorer({ id: 'x', sujet: 'jardin créole', raison: 'essai' }, ['https://jardin.fr/creole']);
  const c = m.robot.carte();
  assert.equal(c.length, 1);
  assert.equal(c[0].site, 'jardin.fr');
  assert.equal(c[0].pages, 2);
  assert.equal(c[0].derniereLecture, '2026-11-17');
});
