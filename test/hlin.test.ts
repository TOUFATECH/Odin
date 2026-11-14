// Gygès (Hlín), la vie privée et la visibilité. Les recherches passent par la vraie Pythie, branchée sur un faux
// moteur SearXNG (résultats fabriqués) ; les sites qui donnent la présence d'un pseudo et Have I Been Pwned sont
// de faux serveurs (une fausse fonction fetch) ; le DNS des noms qui imitent est faux lui aussi. Les photos sont
// de vraies images fabriquées par Pillow (un autre écrivain EXIF que le lecteur d'Odin), dans test/fixtures/hlin.
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { isSecretFile } from '../src/heimdall/policy.ts';
import { refusDe } from '../src/valhalla/export/page.ts';
import { accord, formesTel, identifiants, masqueAdresse, masqueMail, masquer, masqueTel, telephone, type Fiche } from '../src/valhalla/hlin/fiches.ts';
import { lettre, plusMois, procedure, reponseAvant } from '../src/valhalla/hlin/retrait.ts';
import { couper, existe, fuitesDe, lireFuite, variantes, type Dns } from '../src/valhalla/hlin/sondes.ts';
import { analyser, classer, fusion, requetes, risque, type Resultat } from '../src/valhalla/hlin/traces.ts';
import { understand } from '../src/valhalla/huginn.ts';
import { rythme, useDns } from '../src/valhalla/modules/hlin.ts';
import { useEngine } from '../src/valhalla/modules/naglfar.ts';
import { allModules } from '../src/valhalla/odin.ts';
import { Valhalla } from '../src/valhalla/service.ts';
import { fakeEngine } from './helpers.ts';

const PHOTOS = join(import.meta.dirname, 'fixtures', 'hlin');
const CLE = '0123456789abcdef0123456789abcdef';
rythme(0);

// ---------------------------------------------------------------- le monde d'essai
type Page = { title: string; url: string; content: string };
interface Monde {
  v: Valhalla; home: string; dir: string; fetched: string[]; questions: string[]; hibp: Array<{ url: string; cle?: string; agent?: string }>;
  /** ce que le faux moteur rend, selon la question */
  web: (q: string) => Page[]; moteurEnPanne: boolean; hibpRep: (email: string) => Response;
  avance(jours: number): void; act(a: string, i?: Record<string, unknown>): ReturnType<Valhalla['act']>; watch(): Promise<void>;
  alertes(): ReturnType<Valhalla['alerts']>; fin(): void;
}
const MOI = { prenom: 'Awa', nom: 'Saïd', villes: 'Mamoudzou', adresses: '12 rue des Fleurs, 97600 Mamoudzou', telephones: '06 39 12 34 56', emails: 'awa.said@exemple.yt', pseudos: 'awa_s976' };
/** Ce que le web « sait » d'Awa Saïd (fabriqué). */
function webDAwa(q: string): Page[] {
  const out: Page[] = [];
  if (q.includes('"Awa Saïd" Mamoudzou')) out.push(
    { title: 'SAÏD Awa - Mamoudzou - PagesJaunes', url: 'https://www.pagesjaunes.fr/pagesblanches/recherche?quoiqui=said', content: 'Awa Saïd, 12 rue des Fleurs, 97600 Mamoudzou. Tél : 06 39 12 34 56' },
    { title: 'Awa Saïd remporte le concours de slam', url: 'https://lejournaldemayotte.yt/2026/05/slam', content: 'La jeune Awa Saïd de Mamoudzou a remporté…' },
    { title: 'Awa Said - Mamoudzou - profil', url: 'https://www.spokeo.com/Awa-Said', content: 'Awa Said, âge, proches, adresses' },
    { title: 'Awa Saïd | Facebook', url: 'https://www.facebook.com/awa.said.976', content: 'Awa Saïd est sur Facebook. Mamoudzou.' },
    { title: 'Recette du gâteau au coco', url: 'https://cuisine-exemple.fr/coco', content: 'Un gâteau facile.' },
  );
  if (q.includes('"06 39 12 34 56"')) out.push({ title: '0639123456 : qui appelle ?', url: 'https://www.tellows.fr/num/0639123456', content: 'Avis sur le numéro 06 39 12 34 56' });
  if (q.includes('"awa.said@exemple.yt"')) out.push({ title: 'Forum couture', url: 'https://forum-couture.fr/t/42', content: 'écrivez-moi : awa.said@exemple.yt' });
  if (q.includes('"awa_s976"')) out.push({ title: 'awa_s976 (@awa_s976) | TikTok', url: 'https://www.tiktok.com/@awa_s976', content: 'Vidéos de awa_s976' });
  return out;
}
function monde(): Monde {
  const home = mkdtempSync(join(tmpdir(), 'hlin-')), fetched: string[] = [], questions: string[] = [], hibp: Monde['hibp'] = [];
  const saved = process.env.BRISINGAMEN_KEY; process.env.BRISINGAMEN_KEY = 'cd'.repeat(32);
  let clock = new Date('2026-11-14T12:00:00Z');
  const w = {} as Monde;
  w.web = webDAwa; w.moteurEnPanne = false;
  w.hibpRep = (email) => (email === 'awa.said@exemple.yt' ? Response.json([{ Name: 'Adobe', Title: 'Adobe', Domain: 'adobe.com', BreachDate: '2013-10-04', PwnCount: 152445165, DataClasses: ['Email addresses', 'Password hints', 'Passwords', 'Usernames'], IsSpamList: false, IsStealerLog: false }]) : new Response('', { status: 404 }));
  const fakeFetch = (async (input: string | URL, init?: RequestInit) => {
    const url = String(input), u = new URL(url); fetched.push(url);
    const h = new Headers(init?.headers);
    if (u.host === 'searx.test') {
      if (w.moteurEnPanne) return new Response('panne', { status: 502 });
      const q = u.searchParams.get('q') ?? ''; questions.push(q);
      return Response.json({ results: w.web(q).map((p) => ({ ...p, engines: ['google'] })) });
    }
    if (u.host === 'haveibeenpwned.com') { hibp.push({ url, cle: h.get('hibp-api-key') ?? undefined, agent: h.get('user-agent') ?? undefined }); return w.hibpRep(decodeURIComponent(u.pathname.split('/').pop()!)); }
    // Les sites qui savent répondre clairement sans connexion (faux serveurs).
    if (u.host === 'api.github.com') return u.pathname === '/users/awa_s976' ? Response.json({ login: 'awa_s976', id: 1 }) : Response.json({ message: 'Not Found' }, { status: 404 });
    if (u.host === 'gitlab.com') return Response.json([]);
    if (u.host === 'public.api.bsky.app') return new Response('trop vite', { status: 429 });
    if (u.host === 'mastodon.social') return Response.json({ error: 'Record not found' }, { status: 404 });
    if (u.host === 'fr.wikipedia.org') return Response.json({ query: { users: [{ name: u.searchParams.get('ususers'), missing: true }] } });
    throw new Error(`réseau coupé par l'essai (${u.host})`);
  }) as unknown as typeof fetch;
  useEngine(() => fakeEngine([]));
  const v = new Valhalla(home, allModules({ paths: { home, workspace: home }, cfg: { venus: {}, voice: {} } } as never), {
    run: async () => ({ code: 1, out: '', err: '' }), fetch: fakeFetch, notify: async () => {}, autonomy: () => 'equilibre', now: () => clock,
  });
  v.ctx('volva').saveSettings({ searxng: 'http://searx.test', lire: false, moteurs: ['searxng'] });
  return Object.assign(w, {
    v, home, dir: v.ctx('hlin').dir, fetched, questions, hibp,
    avance: (j: number) => { clock = new Date(clock.getTime() + j * 864e5); },
    act: (a: string, i: Record<string, unknown> = {}) => v.act('hlin', a, i),
    watch: () => v.module('hlin')!.watch!.run(v.ctx('hlin')) as Promise<void>,
    alertes: () => v.alerts({ module: 'hlin' }),
    fin: () => { useDns(undefined); v.stop(); if (saved === undefined) delete process.env.BRISINGAMEN_KEY; else process.env.BRISINGAMEN_KEY = saved; rmSync(home, { recursive: true, force: true }); },
  });
}
const lireJson = <T>(w: Monde, f: string): T => JSON.parse(readFileSync(join(w.dir, f), 'utf8')) as T;
const resultats = (w: Monde) => lireJson<Resultat[]>(w, 'resultats.json');
const unSite = (w: Monde, site: string) => resultats(w).find((r) => r.site === site);
const ficheAwa = (): Fiche => ({ id: 'moi', genre: 'moi', ...identifiants('moi', { ...MOI }), creee: '', modifiee: '' });

// ---------------------------------------------------------------- pur
test('Gygès · identifiants, numéros et masquage (pur)', () => {
  assert.deepEqual(telephone('06 39 12 34 56'), { national: '0639123456', inter: '+262639123456' }, 'un 0639 est à Mayotte : +262');
  assert.deepEqual(telephone('+33 6 12 34 56 78'), { national: '0612345678', inter: '+33612345678' });
  assert.deepEqual(formesTel('0639123456'), ['06 39 12 34 56', '0639123456', '+262639123456']);
  assert.equal(masqueTel('0639123456'), '06 •• •• •• 56');
  assert.equal(masqueMail('awa.said@exemple.yt'), 'a•••@exemple.yt');
  assert.equal(masqueAdresse('12 rue des Fleurs, 97600 Mamoudzou'), '•••, 97600 Mamoudzou');
  const m = masquer('Awa : 06.39.12.34.56, +262 639 12 34 56, awa.said@exemple.yt, 12 rue des Fleurs. Le 09-11-2026 10:30.', [ficheAwa()]);
  assert.doesNotMatch(m, /39[ .]?12[ .]?34|awa\.said@|rue des Fleurs/, `rien en entier : ${m}`);
  assert.match(m, /06 •• •• •• 56/); assert.match(m, /09-11-2026 10:30/, 'une date n\'est pas un numéro');
  const f = ficheAwa();
  assert.deepEqual([f.nom, f.telephones, f.emails, f.pseudos, f.villes], ['Awa Saïd', ['0639123456'], ['awa.said@exemple.yt'], ['awa_s976'], ['Mamoudzou']]);
  assert.throws(() => identifiants('moi', { prenom: 'Awa', nom: 'Saïd', telephones: '06 39' }), /n'est pas un numéro/);
  assert.throws(() => identifiants('moi', { nom: 'Saïd' }), /il manque le prénom/);
  assert.throws(() => identifiants('moi', { prenom: 'Awa', nom: 'Saïd', emails: 'pas-une-adresse' }), /n'est pas une adresse e-mail/);
  const s = identifiants('societe', { nom: 'TOUFATECH', domaines: 'https://www.TOUFATECH.com/contact', comptes: 'https://www.facebook.com/toufatech/' });
  assert.deepEqual([s.domaines, s.comptes], [['toufatech.com'], ['facebook.com/toufatech']]);
});

test('Gygès · recherches préparées, classement, ce que ça montre, risque, marche à suivre (pur)', () => {
  const f = ficheAwa(), q = requetes(f).map((x) => x.q);
  assert.deepEqual(q, ['"Awa Saïd" Mamoudzou', '"Saïd Awa" Mamoudzou', '"06 39 12 34 56" OR "0639123456"', '"awa.said@exemple.yt"', '"12 rue des Fleurs" Mamoudzou', '"awa_s976"'], 'chaque identifiant entre guillemets, rien d\'autre');
  assert.deepEqual(['https://www.pagesjaunes.fr/x', 'https://spokeo.com/a', 'https://m.facebook.com/a', 'https://www.societe.com/s', 'https://fr.trustpilot.com/review/x', 'https://lejournaldemayotte.yt/a', 'https://annuaire-inverse.exemple/a', 'https://blog.exemple.fr/'].map((u) => classer(u).categorie),
    ['annuaire', 'revendeur de données', 'réseau social', 'registre de sociétés', 'avis', 'presse', 'annuaire', 'autre']);
  const pj = analyser(f, { url: 'https://www.pagesjaunes.fr/pb', titre: 'SAÏD Awa', extrait: 'Awa Saïd, 12 rue des Fleurs, 97600 Mamoudzou. Tél : 06 39 12 34 56' })!;
  assert.deepEqual(pj.montre, ['adresse', 'téléphone', 'nom', 'ville']); assert.equal(pj.risque, 'élevé'); assert.match(pj.raison, /on peut venir chez toi/);
  assert.equal(analyser(f, { url: 'https://cuisine.fr/coco', titre: 'Gâteau', extrait: 'facile' }), undefined, 'hors sujet : écarté');
  const rs = analyser(f, { url: 'https://www.instagram.com/quelquun', titre: 'Photos', extrait: '' })!;
  assert.equal(rs.incertain, true, 'un réseau social sans identifiant visible : à vérifier'); assert.equal(rs.risque, 'faible');
  assert.equal(risque('revendeur de données', ['nom']).niveau, 'moyen');
  assert.equal(risque('autre', ['e-mail']).niveau, 'moyen');
  assert.equal(risque('presse', ['nom']).niveau, 'faible');
  assert.equal(risque('autre', ['nom', 'un autre numéro']).niveau, 'moyen', 'un numéro à côté de ton nom, pas dans ta fiche');
  const r: Resultat = { id: 'r1', fiche: 'moi', genre: 'web', url: 'https://www.pagesjaunes.fr/pb', site: 'pagesjaunes.fr', titre: '', extrait: '', categorie: 'annuaire', montre: pj.montre, par: [], risque: 'élevé', raison: '', etat: 'présent', vu: '', revu: '' };
  const etapes = procedure(r, f).join('\n');
  assert.match(etapes, /liste rouge/); assert.match(etapes, /Résultats vous concernant/); assert.match(etapes, /myactivity\.google\.com\/results-about-you/); assert.match(etapes, /CNIL/); assert.match(etapes, /un mois/);
  assert.match(procedure({ ...r, categorie: 'revendeur de données', site: 'spokeo.com' }, f).join('\n'), /opt out[\s\S]*article 21/);
  assert.match(procedure({ ...r, categorie: 'presse' }, f).join('\n'), /liberté d'information[\s\S]*déréférencement|dereferencement/);
  assert.match(procedure({ ...r, genre: 'fuite', categorie: 'fuite connue', montre: ['mot de passe'] }, f).join('\n'), /ne se retire pas[\s\S]*Change tout de suite le mot de passe[\s\S]*Have I Been Pwned/);
});

test('Gygès · d\'un mois sur l\'autre : nouveau, retiré, et un moteur en panne ne fait rien disparaître (pur)', () => {
  const r = (id: string, par = ['k1']): Resultat => ({ id, fiche: 'moi', genre: 'web', url: `https://${id}.fr`, site: `${id}.fr`, titre: '', extrait: '', categorie: 'autre', montre: [], par, risque: 'faible', raison: '', etat: 'présent', vu: 'avant', revu: 'avant' });
  const avant = [r('a'), r('b'), { ...r('c'), etat: 'ignoré' as const }];
  const b = fusion(avant, [r('a'), r('d')], { fiche: 'moi', quand: 'maintenant', sures: new Set(['k1']), actuelles: new Set(['k1']) });
  assert.deepEqual(b.nouveaux.map((x) => x.id), ['d']); assert.deepEqual(b.retires.map((x) => x.id), ['b']);
  assert.equal(b.liste.find((x) => x.id === 'c')?.etat, 'ignoré', '« pas moi » reste écarté');
  const panne = fusion(avant, [], { fiche: 'moi', quand: 'maintenant', sures: new Set(), actuelles: new Set(['k1']) });
  assert.deepEqual(panne.retires, [], 'la recherche n\'a pas répondu : rien n\'est noté retiré');
  const revenu = fusion(b.liste, [r('b')], { fiche: 'moi', quand: 'plus tard', sures: new Set(['k1']), actuelles: new Set(['k1']) });
  assert.ok(revenu.nouveaux.some((x) => x.id === 'b'), 'revenu après avoir été retiré : signalé de nouveau');
});

test('Gygès · noms de domaine qui imitent, DNS (pur, faux DNS)', async () => {
  assert.deepEqual(couper('boutique.exemple.co.uk'), { nom: 'exemple', ext: 'co.uk' });
  const l = variantes('toufatech.com', 80), noms = l.map((x) => x.nom);
  for (const n of ['toufatech.fr', 't0ufatech.com', 'toufatech-sav.com', 'toufatec.com', 'tuofatech.com']) assert.ok(noms.includes(n), n);
  assert.ok(!noms.includes('toufatech.com') && l.length === 80 && new Set(noms).size === 80);
  const dns: Dns = { a: async (n) => { if (n === 'existe.fr') return ['203.0.113.5']; const e = Object.assign(new Error('x'), { code: n === 'lent.fr' ? 'ETIMEOUT' : n === 'sans-ip.fr' ? 'ENODATA' : 'ENOTFOUND' }); throw e; }, mx: async (n) => n === 'existe.fr' };
  assert.deepEqual(await existe(dns, 'existe.fr'), { existe: true, ip: '203.0.113.5', mx: true });
  assert.deepEqual(await existe(dns, 'personne.fr'), { existe: false });
  assert.deepEqual(await existe(dns, 'sans-ip.fr'), { existe: true, mx: false });
  assert.equal(await existe(dns, 'lent.fr'), undefined, 'pas de réponse claire : on ne conclut pas');
});

test('Gygès · lettre RGPD remplie (pur) et délais de l\'article 12', () => {
  const f = ficheAwa();
  const e = lettre({ fiche: f, type: 'effacement', site: 'pagesjaunes.fr', url: 'https://www.pagesjaunes.fr/pb', montre: ['adresse', 'téléphone', 'nom'], jour: '2026-11-14' }).texte;
  for (const x of ['Awa Saïd', 'E-mail : awa.said@exemple.yt', 'Fait à Mamoudzou, le 14 novembre 2026', '**Objet : demande d\'effacement de mes données personnelles (article 17 du RGPD)**', 'https://www.pagesjaunes.fr/pb', 'mon adresse postale, mon numéro de téléphone, mon nom', 'article 17, paragraphe 1', 'article 17, paragraphe 2', 'article 12, paragraphe 3', 'au plus tard un mois', 'CNIL', 'je ne joins pas de pièce d\'identité', 'Madame, Monsieur'])
    assert.ok(e.includes(x), `la lettre contient « ${x} »`);
  assert.doesNotMatch(e, /0639123456|06 39 12|rue des Fleurs/, 'le site a déjà les données : la lettre ne les recopie pas');
  assert.match(lettre({ fiche: f, type: 'opposition', site: 'spokeo.com', jour: '2026-11-14' }).texte, /article 21[\s\S]*prospection/);
  assert.match(lettre({ fiche: f, type: 'accès', site: 'spokeo.com', jour: '2026-11-14' }).texte, /article 15[\s\S]*d'où vous les tenez[\s\S]*gratuite/);
  assert.match(lettre({ fiche: f, type: 'effacement', site: 'x.fr', jour: '2026-11-01', contact: 'courrier' }).texte, /^Awa Saïd\n12 rue des Fleurs, 97600 Mamoudzou\n[\s\S]*le 1er novembre 2026/, 'réponse par courrier : l\'adresse postale en tête');
  assert.match(lettre({ fiche: f, type: 'relance', site: 'x.fr', jour: '2026-12-20', premiere: { type: 'effacement', envoyee: '2026-11-14' } }).texte, /Le 14 novembre 2026, je vous ai adressé une demande d'effacement[\s\S]*délai d'un mois[\s\S]*quinze jours[\s\S]*CNIL/);
  assert.throws(() => lettre({ fiche: { ...f, genre: 'societe' }, type: 'effacement', site: 'x', jour: '2026-11-14' }), /protège les personnes/);
  assert.equal(reponseAvant('2026-11-14'), '2026-12-14'); assert.equal(reponseAvant('2026-11-14', true), '2027-02-14', 'prolongée : deux mois de plus');
  assert.equal(plusMois('2027-01-31', 1), '2027-02-28');
});

test('Gygès · fuites connues : en-têtes et lecture de Have I Been Pwned (faux serveur)', async () => {
  const vus: Array<{ url: string; h: Headers }> = []; let rep = (): Response => new Response('', { status: 404 });
  const f = (async (u: string, i?: RequestInit) => { vus.push({ url: u, h: new Headers(i?.headers) }); return rep(); }) as unknown as typeof fetch;
  assert.deepEqual(await fuitesDe(f, CLE, 'a+b@exemple.yt'), { etat: 'aucune', fuites: [] });
  assert.equal(vus[0].url, 'https://haveibeenpwned.com/api/v3/breachedAccount/a%2Bb%40exemple.yt?truncateResponse=false');
  assert.equal(vus[0].h.get('hibp-api-key'), CLE); assert.match(vus[0].h.get('user-agent') ?? '', /^Odin-Gyges/);
  rep = () => new Response('', { status: 401 }); assert.equal((await fuitesDe(f, CLE, 'a@b.fr')).etat, 'clé refusée');
  let n = 0; rep = () => (n++ ? Response.json([{ Name: 'Stealer', Title: 'Logs', IsStealerLog: true, DataClasses: ['Email addresses', 'Passwords'] }, { Name: 'Vieux', IsRetired: true }]) : new Response('', { status: 429, headers: { 'retry-after': '2' } }));
  const attentes: number[] = [], r = await fuitesDe(f, CLE, 'a@b.fr', async (ms) => { attentes.push(ms); });
  assert.deepEqual(attentes, [2000], 'il attend ce que le service demande'); assert.equal(r.etat, 'ok');
  assert.deepEqual(r.fuites.map((x) => [x.nom, x.espion, x.donnees.join('+')]), [['Stealer', true, 'e-mail+mot de passe']], 'une fuite retirée du service n\'est pas montrée');
  assert.equal(lireFuite({ Name: '<script>' }), undefined);
});

// ---------------------------------------------------------------- fiches et accord
test('Gygès · fiches : un proche seulement avec son accord noté ; l\'accord se retire et tout est effacé', async () => {
  const w = monde();
  try {
    const proche = { prenom: 'Sara', nom: 'Madi', villes: 'Mamoudzou', pseudos: 'sara_m976', emails: 'sara.madi@exemple.yt', accord_par: 'Sara elle-même', accord_le: '10/11/2026', accord_comment: 'de vive voix' };
    assert.match((await w.act('proche', { ...proche, accord_par: '' })).text, /Il manque « Qui a donné son accord »/);
    const sans = await (async () => w.v.module('hlin')!.actions.find((a) => a.id === 'proche')!.run(w.v.ctx('hlin'), { ...proche, accord_par: '', accord_le: '', accord_comment: '' }))().then(() => 'créée', (e: Error) => e.message);
    assert.match(sans, /sans l'accord de cette personne, pas de fiche/, 'même en appelant l\'action directement');
    assert.match((await w.act('proche', { ...proche, accord_comment: 'ok' })).text, /sans l'accord/);
    assert.match((await w.act('proche', { ...proche, accord_le: '20/11/2026' })).text, /dans le futur/);
    assert.match((await w.act('proche', { ...proche, accord_le: '01/10/2025' })).text, /plus de 12 mois/);
    assert.equal(existsSync(join(w.dir, 'fiches.json')), false, 'aucune fiche écrite');
    // Créer une fiche est une action grave : une automatisation ne peut pas le faire.
    assert.match((await w.v.act('hlin', 'proche', proche, { auto: true })).text, /action grave/);
    assert.match((await w.v.act('hlin', 'moi', MOI, { auto: true })).text, /action grave/);
    const ok = await w.act('proche', proche);
    assert.equal(ok.ok, true, ok.text); assert.match(ok.text, /Sara M\. créée, avec son accord \(donné par Sara elle-même le 10\/11\/2026, de vive voix\)/);
    for (const k of [1, 2, 3, 4]) assert.equal((await w.act('proche', { ...proche, prenom: `Ami${'abcd'[k - 1]}` })).ok, true);
    assert.match((await w.act('proche', { ...proche, prenom: 'Sixième' })).text, /5 proches au plus/);
    // Une recherche sur le proche, une lettre, puis le retrait de l'accord.
    w.web = (q) => (q.includes('"Sara Madi"') ? [{ title: 'Sara Madi - Annuaire', url: 'https://www.118712.fr/sara-madi', content: 'Sara Madi, Mamoudzou, 06 39 99 88 77' }] : []);
    const c = await w.act('chercher', { fiche: 'Sara Madi' });
    assert.equal(c.ok, true, c.text); assert.match(c.text, /sur Sara M\./); assert.doesNotMatch(c.text, /Madi/, 'le nom entier d\'un proche ne sort pas dans la réponse');
    const r = unSite(w, '118712.fr')!; assert.equal(r.categorie, 'annuaire'); assert.doesNotMatch(r.extrait, /99 88/, 'extrait rangé masqué');
    const l = await w.act('lettre', { resultat: r.id, type: 'effacement' }); assert.equal(l.ok, true, l.text);
    assert.equal(readdirSync(join(w.dir, 'lettres')).length, 3);
    assert.match((await w.act('retirer_accord', { fiche: 'moi' })).text, /ta fiche n'existe pas|n'est pas celle d'un proche/);
    assert.match((await w.v.act('hlin', 'retirer_accord', { fiche: 'p-sara-madi' }, { auto: true })).text, /action grave/, 'effacer demande ton accord');
    const x = await w.act('retirer_accord', { fiche: 'p-sara-madi' });
    assert.match(x.text, /Accord retiré : la fiche de Sara M\. est effacée, avec \d+ résultats? et 1 demande/);
    assert.equal(lireJson<Fiche[]>(w, 'fiches.json').some((f) => f.id === 'p-sara-madi'), false);
    assert.equal(resultats(w).some((y) => y.fiche === 'p-sara-madi'), false); assert.deepEqual(lireJson(w, 'demandes.json'), []);
    assert.deepEqual(readdirSync(join(w.dir, 'lettres')), [], 'les lettres aussi');
    assert.match((await w.act('chercher', { fiche: 'p-sara-madi' })).text, /aucune fiche/);
    // L'accord vaut douze mois : après, plus aucune recherche, et un rappel.
    w.avance(366);
    assert.match((await w.act('chercher', { fiche: 'Amia Madi' })).text, /plus de 12 mois/);
    await w.watch();
    assert.ok(w.alertes().some((a) => /L'accord de Amia M\. a plus de 12 mois/.test(a.title)));
    assert.ok(isSecretFile(join(w.dir, 'fiches.json')) && isSecretFile(join(w.dir, 'resultats.json')) && isSecretFile(join(w.dir, 'lettres', 'x.pdf')), 'le dossier de Gygès est fermé aux outils de fichiers');
  } finally { w.fin(); }
});

// ---------------------------------------------------------------- garde-fous
test('Gygès · garde-fous : aucune action ne cherche un nom libre, ni l\'IA ni Logos ni une automatisation', async () => {
  const w = monde();
  try {
    const m = w.v.module('hlin')!;
    // Les seules actions qui prennent un nom sont celles qui CRÉENT une fiche, et elles sont graves (ton accord).
    for (const a of m.actions) {
      const nomme = (a.params ?? []).some((p) => ['nom', 'prenom', 'q', 'question', 'pseudo', 'email', 'telephone'].includes(p.key));
      if (nomme) assert.ok(['moi', 'societe', 'proche'].includes(a.id) && a.grave, `${a.id} : un nom libre seulement pour créer une fiche, avec ton accord`);
    }
    // Chercher un nom qui n'est pas une fiche : refusé, et rien ne part sur le réseau.
    for (const fiche of ['Jean Dupont', 'jean.dupont@exemple.fr', '0612345678']) {
      const r = await w.act('chercher', { fiche });
      assert.equal(r.ok, false); assert.match(r.text, /ta fiche n'existe pas encore|aucune fiche/);
    }
    for (const t of ['vérifie où apparaît Jean Dupont', 'cherche où j\'apparais Jean Dupont', 'cherche les traces sur internet de Jean Dupont']) await w.v.order(t, 'essai', { confirm: true });
    assert.equal(w.fetched.length, 0, 'aucune demande sur le réseau');
    assert.equal(existsSync(join(w.dir, 'fiches.json')), false, 'Logos n\'a créé aucune fiche');
    // Même avec la fiche du propriétaire, un nom d'un tiers n'est pas cherché.
    await w.act('moi', MOI);
    const r = await w.act('chercher', { fiche: 'Jean Dupont' }); assert.match(r.text, /aucune fiche « Jean Dupont »/);
    assert.ok(!w.questions.some((q) => /Dupont/.test(q)));
    // Les recherches lancées par une automatisation prennent la fiche, jamais un nom.
    const auto = await w.v.act('hlin', 'chercher', { fiche: 'Jean Dupont' }, { auto: true }); assert.equal(auto.ok, false);
    // L'action « brut » de Pythie n'est appelée que par Gygès, avec les recherches préparées de la fiche.
    await w.act('chercher', {});
    assert.ok(w.questions.length && w.questions.every((q) => requetes(lireJson<Fiche[]>(w, 'fiches.json')[0]).some((x) => x.q === q)), 'chaque question envoyée vient de la fiche');
    // Aucune connexion, aucune énumération : seuls le moteur (par Pythie) et les interfaces publiques documentées sont appelés.
    const hotes = new Set(w.fetched.map((u) => new URL(u).host));
    assert.deepEqual([...hotes].sort(), ['api.github.com', 'fr.wikipedia.org', 'gitlab.com', 'mastodon.social', 'public.api.bsky.app', 'searx.test']);
    assert.ok(!w.fetched.some((u) => /login|signin|connexion|oauth/i.test(new URL(u).pathname)), 'aucune page de connexion');
  } finally { w.fin(); }
});

// ---------------------------------------------------------------- « où j'apparais » par Pythie
test('Gygès · « où j\'apparais » : recherches par Pythie (faux moteur), pseudos, fuites, classement, risque, retrait', async () => {
  const w = monde();
  try {
    assert.match((await w.act('etat')).text, /Aucune fiche/);
    assert.match((await w.act('chercher', {})).text, /ta fiche n'existe pas encore/);
    const cree = await w.act('moi', MOI); assert.equal(cree.ok, true, cree.text);
    assert.match(cree.text, /Awa Saïd · Mamoudzou · 06 •• •• •• 56 · a•••@exemple\.yt · •••, 97600 Mamoudzou · 1 pseudo/);
    const r = await w.act('chercher', {});
    assert.equal(r.ok, true, r.text);
    assert.ok(w.questions.includes('"Awa Saïd" Mamoudzou') && w.questions.includes('"awa.said@exemple.yt"'), 'les recherches sont passées par Pythie (SearXNG)');
    assert.deepEqual(readdirSync(w.v.ctx('volva').dir).filter((f) => /historique/.test(f)), [], 'rien n\'est gardé dans l\'historique de Pythie');
    assert.ok(w.v.manips().every((x) => x.module !== 'volva'), 'pas de manip notée pour une lecture');
    // Le classement et le risque.
    const pj = unSite(w, 'pagesjaunes.fr')!;
    assert.deepEqual([pj.categorie, pj.risque, pj.montre.slice(0, 3)], ['annuaire', 'élevé', ['adresse', 'téléphone', 'nom']]);
    assert.deepEqual(pj.details, ['06 •• •• •• 56', '•••, 97600 Mamoudzou'], 'lequel de tes numéros et de tes adresses est visible, masqué');
    assert.doesNotMatch(`${pj.titre} ${pj.extrait}`, /39 12|rue des Fleurs/, 'rangé masqué');
    assert.deepEqual([unSite(w, 'spokeo.com')?.categorie, unSite(w, 'spokeo.com')?.risque], ['revendeur de données', 'moyen']);
    assert.deepEqual([unSite(w, 'lejournaldemayotte.yt')?.categorie, unSite(w, 'lejournaldemayotte.yt')?.risque], ['presse', 'faible']);
    assert.deepEqual([unSite(w, 'facebook.com')?.categorie, unSite(w, 'facebook.com')?.risque], ['réseau social', 'moyen']);
    assert.deepEqual([unSite(w, 'tellows.fr')?.categorie, unSite(w, 'tellows.fr')?.risque], ['annuaire', 'élevé']);
    assert.deepEqual([unSite(w, 'forum-couture.fr')?.categorie, unSite(w, 'forum-couture.fr')?.risque, unSite(w, 'forum-couture.fr')?.montre[0]], ['autre', 'moyen', 'e-mail']);
    assert.equal(unSite(w, 'cuisine-exemple.fr'), undefined, 'hors sujet : écarté');
    // Pseudos : réponse claire seulement, sinon le lien à ouvrir soi-même (aucune demande vers Snapchat, Instagram…).
    const profils = resultats(w).filter((x) => x.genre === 'profil');
    assert.equal(profils.find((x) => x.site === 'github.com')?.etat, 'présent');
    assert.equal(profils.find((x) => x.site === 'bsky.app')?.etat, 'à vérifier', 'une limite atteinte n\'est pas une réponse');
    assert.ok(!profils.some((x) => x.site === 'gitlab.com' || x.site === 'mastodon.social' || x.site === 'fr.wikipedia.org'), 'absent : rien');
    for (const s of ['snapchat.com', 'instagram.com', 'tiktok.com', 'facebook.com', 'x.com']) assert.equal(profils.find((x) => x.site === s)?.etat, 'à vérifier', `${s} : lien à ouvrir toi-même`);
    // Fuites : sans clé, le lien pour vérifier soi-même.
    assert.equal(resultats(w).find((x) => x.genre === 'fuite')?.etat, 'à vérifier'); assert.equal(w.hibp.length, 0);
    // La réponse : comptes, sans aucune coordonnée en entier.
    assert.match(r.text, /Recherche faite te concernant : \d+ résultats \(2 élevé, \d+ moyen, \d+ faible\)/);
    assert.doesNotMatch(r.text, /0639123456|06 39 12 34 56|awa\.said@|rue des Fleurs/);
    // Pour chaque résultat : ce qu'il montre, pourquoi ce risque, et comment le retirer.
    const comment = await w.act('resultat', { resultat: pj.id });
    assert.match(comment.text, /Risque élevé : ton adresse postale est visible par tous, avec ton nom et ton numéro/);
    assert.match(comment.text, /Ce que ça montre : adresse, téléphone, nom, ville \(06 •• •• •• 56, •••, 97600 Mamoudzou\)/);
    assert.match(comment.text, /1\. Demande la liste rouge[\s\S]*Résultats vous concernant[\s\S]*CNIL/);
    // La clé Have I Been Pwned va dans le coffre (jamais affichée), puis les fuites sont cherchées.
    assert.match((await w.act('cle_fuites', { cle: 'pas-une-cle' })).text, /pas la bonne forme/);
    const k = await w.act('cle_fuites', { cle: CLE }); assert.equal(k.ok, true, k.text); assert.doesNotMatch(k.text, new RegExp(CLE));
    assert.match((await w.act('cle_fuites', {})).text, /Une clé Have I Been Pwned est rangée dans le coffre/);
    assert.doesNotMatch(JSON.stringify(w.v.manips()), new RegExp(CLE), 'jamais dans le journal');
    const f = await w.act('chercher', { quoi: 'fuites' }); assert.equal(f.ok, true, f.text);
    assert.deepEqual(w.hibp.map((x) => [x.cle, /^Odin-Gyges/.test(x.agent ?? '')]), [[CLE, true]]);
    const fuite = resultats(w).find((x) => x.genre === 'fuite')!;
    assert.deepEqual([fuite.etat, fuite.risque, fuite.titre], ['présent', 'élevé', 'Fuite « Adobe » (04/10/2013)']);
    assert.match(fuite.extrait, /a•••@exemple\.yt fait partie de cette fuite[\s\S]*Source : Have I Been Pwned \(haveibeenpwned\.com\)/, 'source citée (licence CC BY 4.0)');
    assert.ok(!resultats(w).some((x) => x.genre === 'fuite' && x.etat === 'à vérifier'), 'le lien « à vérifier toi-même » est parti');
    // Classer : « pas moi » écarte un homonyme ; « il existe » confirme un profil à vérifier.
    await w.act('marquer', { resultat: unSite(w, 'lejournaldemayotte.yt')!.id, comme: 'pas moi' });
    assert.equal(unSite(w, 'lejournaldemayotte.yt')!.etat, 'ignoré');
    const snap = profils.find((x) => x.site === 'snapchat.com')!;
    await w.act('marquer', { resultat: snap.id, comme: 'il existe' }); assert.equal(resultats(w).find((x) => x.id === snap.id)!.etat, 'présent');
    // Un moteur en panne ne fait rien disparaître.
    w.moteurEnPanne = true;
    const p = await w.act('chercher', { quoi: 'web' });
    assert.match(p.text, /0 retiré[\s\S]*Pas tout vérifié : Pythie/); assert.equal(unSite(w, 'pagesjaunes.fr')!.etat, 'présent');
    assert.equal(resultats(w).find((x) => x.id === snap.id)!.etat, 'présent', 'un profil confirmé reste confirmé');
    // Le bilan et les guides.
    assert.match((await w.act('etat')).text, /Awa Saïd \(toi\) : \d+ résultats — 3 élevé/);
    assert.match((await w.act('guide', { reseau: 'Snapchat' })).text, /Mode Fantôme/);
    assert.match((await w.act('guide', { reseau: 'Myspace' })).text, /pas de guide/);
  } finally { w.fin(); }
});

// ---------------------------------------------------------------- lettre, suivi et rappels
test('Gygès · lettre RGPD en fichiers, suivi des demandes, rappel au délai dépassé, relance, CNIL (horloge avancée)', async () => {
  const w = monde();
  try {
    await w.act('moi', MOI); await w.act('chercher', {});
    const pj = unSite(w, 'pagesjaunes.fr')!;
    assert.match((await w.act('lettre', {})).text, /choisis le résultat/);
    const l = await w.act('lettre', { resultat: `${pj.id} · pagesjaunes.fr · annuaire`, type: 'effacement' });
    assert.equal(l.ok, true, l.text); assert.match(l.text, /Lettre prête pour pagesjaunes\.fr/);
    assert.deepEqual(l.fichiers!.map((x) => x.nom.replace(/-d\w+\./, '-ID.')), ['lettre-effacement-pagesjaunes-fr-2026-11-14-ID.txt', 'lettre-effacement-pagesjaunes-fr-2026-11-14-ID.docx', 'lettre-effacement-pagesjaunes-fr-2026-11-14-ID.pdf']);
    const m = w.v.module('hlin')!, ctx = w.v.ctx('hlin');
    const [txt, docx, pdf] = l.fichiers!.map((x) => m.retrait!(ctx, x.ref)!);
    const texte = readFileSync(txt, 'utf8');
    assert.match(texte, /^Awa Saïd\nE-mail : awa\.said@exemple\.yt\n/); assert.match(texte, /Objet : demande d'effacement de mes données personnelles \(article 17 du RGPD\)/);
    assert.match(texte, /https:\/\/www\.pagesjaunes\.fr\/pagesblanches\/recherche\?quoiqui=said/); assert.match(texte, /Il s'agit de : mon adresse postale, mon numéro de téléphone, mon nom, ma ville\./);
    assert.doesNotMatch(texte, /\*\*/, 'le texte n\'a pas les marques du Markdown');
    assert.equal(readFileSync(docx).subarray(0, 2).toString(), 'PK'); assert.equal(readFileSync(pdf).subarray(0, 5).toString(), '%PDF-');
    for (const ref of ['../fiches.json', 'lettres/../fiches.json', 'resultats.json', 'lettres/x.exe']) assert.equal(m.retrait!(ctx, ref), undefined, `${ref} ne sort pas`);
    assert.match((await w.act('lettre', { resultat: resultats(w).find((x) => x.genre === 'fuite')!.id })).text, /une fuite ne se retire pas par une lettre/);
    // Le suivi.
    const d = lireJson<Array<{ id: string; etat: string }>>(w, 'demandes.json')[0]; assert.equal(d.etat, 'à envoyer');
    assert.match((await w.act('envoyee', { demande: d.id, date: '20/11/2026' })).text, /dans le futur/);
    assert.match((await w.act('envoyee', { demande: d.id })).text, /envoyée le 14\/11\/2026\. Réponse attendue avant le 14\/12\/2026/);
    const f = await w.act('noter_demande', { site: 'Google', par: 'Google « Résultats vous concernant »', resultat: pj.id });
    assert.match(f.text, /Réponse attendue avant le 14\/12\/2026/);
    const g = lireJson<Array<{ id: string; site: string }>>(w, 'demandes.json').find((x) => x.site === 'Google')!;
    assert.match((await w.act('reponse', { demande: g.id, issue: 'prolongée' })).text, /avant le 14\/02\/2027/);
    await w.watch(); assert.deepEqual(w.alertes(), [], 'dans le délai : pas de rappel');
    // Un mois et un jour plus tard : le rappel (une seule fois), avec le bouton « Préparer la relance ».
    w.avance(31); await w.watch(); w.avance(1); await w.watch();
    const rappels = w.alertes().filter((a) => /délai dépassé/.test(a.title));
    assert.equal(rappels.length, 1, 'un seul rappel'); assert.match(rappels[0].title, /Demande de retrait à pagesjaunes\.fr : délai dépassé, pas de réponse/);
    assert.equal(rappels[0].fix?.action, 'relancer'); assert.equal(rappels[0].level, 'moyenne');
    assert.ok(!w.alertes().some((a) => /Google/.test(a.title)), 'la demande prolongée a encore le temps');
    assert.match((await w.act('demandes')).text, /pagesjaunes\.fr · effacement \(art\. 17\) · envoyée le 14\/11\/2026, réponse avant le 14\/12\/2026 · envoyée, délai dépassé/);
    const rel = await w.act('relancer', { demande: d.id }); assert.equal(rel.ok, true, rel.text);
    const relance = readFileSync(m.retrait!(ctx, rel.fichiers!.find((x) => x.nom.endsWith('.txt'))!.ref)!, 'utf8');
    assert.match(relance, /Objet : relance de ma demande restée sans réponse[\s\S]*Le 14 novembre 2026, je vous ai adressé une demande d'effacement[\s\S]*quinze jours[\s\S]*CNIL/);
    // Toujours rien quinze jours après la relance : la plainte à la CNIL.
    w.avance(16); await w.watch();
    const cnil = w.alertes().find((a) => /toujours rien après la relance/.test(a.title)); assert.ok(cnil); assert.match(cnil!.detail ?? '', /cnil\.fr\/fr\/adresser-une-plainte/);
    // La réponse arrive : faite → le résultat est noté retiré.
    assert.match((await w.act('reponse', { demande: d.id, issue: 'faite' })).text, /noté « retiré »/);
    assert.equal(unSite(w, 'pagesjaunes.fr')!.etat, 'retiré');
    assert.match((await w.act('relancer', { demande: d.id })).text, /déjà faite/);
  } finally { w.fin(); }
});

// ---------------------------------------------------------------- revérification chaque mois
test('Gygès · revérification chaque mois : le nouveau est signalé (masqué), le disparu est noté retiré', async () => {
  const w = monde();
  try {
    await w.act('moi', MOI); await w.act('chercher', {});
    await w.watch(); assert.ok(!w.alertes().some((a) => /nouveau/.test(a.title)), 'pas encore un mois');
    // Le mois suivant : le revendeur a retiré sa fiche ; un nouvel annuaire montre l'adresse et le numéro.
    w.web = (q) => [...webDAwa(q).filter((p) => !/spokeo/.test(p.url)), ...(q.includes('"Awa Saïd" Mamoudzou') ? [{ title: 'Awa SAÏD à Mamoudzou', url: 'https://www.118712.fr/annuaire/awa-said', content: 'Awa Saïd — 12 rue des Fleurs 97600 Mamoudzou — 0639123456 — awa.said@exemple.yt' }] : [])];
    const avant = w.questions.length; w.avance(31); await w.watch();
    assert.ok(w.questions.length > avant, 'la revérification est passée par Pythie');
    const a = w.alertes().find((x) => /nouveau résultat/.test(x.title))!;
    assert.ok(a, 'alerte dans Forseti'); assert.equal(a.level, 'haute');
    assert.equal(a.title, '1 nouveau résultat te concernant (1 à risque élevé)');
    assert.match(a.detail ?? '', /118712\.fr \(annuaire\) : montre adresse, téléphone, e-mail, nom, ville \(06 •• •• •• 56, a•••@exemple\.yt, •••, 97600 Mamoudzou\) · risque élevé/);
    assert.match(a.detail ?? '', /1 résultat n'apparaît plus : noté « retiré »/);
    assert.doesNotMatch(JSON.stringify(w.alertes()), /0639123456|39 12 34|awa\.said@|rue des Fleurs/, 'jamais une coordonnée en entier dans une alerte');
    assert.equal(unSite(w, 'spokeo.com')!.etat, 'retiré'); assert.equal(unSite(w, '118712.fr')!.nouveau, true);
    assert.match(lireJson<Fiche[]>(w, 'fiches.json')[0].verifiee ?? '', /^2026-12-15/);
    // Juste après : rien à revérifier (une fois par mois).
    const n = w.questions.length; w.avance(1); await w.watch(); assert.equal(w.questions.length, n);
  } finally { w.fin(); }
});

// ---------------------------------------------------------------- sociétés
test('Gygès · sociétés : fiches et avis, faux comptes, noms de domaine qui imitent (faux DNS)', async () => {
  const w = monde();
  try {
    useDns({
      a: async (n) => { if (n === 'toufatech.fr') return ['203.0.113.5']; if (n === 't0ufatech.com') return ['203.0.113.9']; throw Object.assign(new Error(n), { code: n === 'toufatech-sav.com' ? 'ENODATA' : n === 'toufatech.net' ? 'ETIMEOUT' : 'ENOTFOUND' }); },
      mx: async (n) => n === 'toufatech.fr',
    });
    w.web = (q) => (q.startsWith('"TOUFATECH"') ? [
      { title: 'TOUFATECH | Facebook', url: 'https://www.facebook.com/toufatech', content: 'Page officielle' },
      { title: 'TOUFATECH SAV officiel', url: 'https://www.facebook.com/toufatech.sav', content: 'Remboursement : écrivez-nous en privé' },
      { title: 'Avis TOUFATECH', url: 'https://fr.trustpilot.com/review/toufatech.com', content: 'Avis des clients de TOUFATECH' },
      { title: 'TOUFATECH (Mamoudzou) - Societe.com', url: 'https://www.societe.com/societe/toufatech-123456789.html', content: 'TOUFATECH, SAS' },
      { title: 'Contact - TOUFATECH', url: 'https://toufatech.com/contact', content: 'TOUFATECH' },
    ] : []);
    const c = await w.act('societe', { nom: 'TOUFATECH', villes: 'Mamoudzou', domaines: 'toufatech.com', comptes: 'facebook.com/toufatech', pseudos: 'toufatech' });
    assert.equal(c.ok, true, c.text);
    const r = await w.act('chercher', { fiche: 'TOUFATECH' }); assert.equal(r.ok, true, r.text);
    assert.ok(w.questions.includes('"TOUFATECH" avis') && w.questions.includes('"toufatech.com" -site:toufatech.com'));
    const l = resultats(w);
    const faux = l.find((x) => x.url === 'https://www.facebook.com/toufatech.sav')!;
    assert.deepEqual([faux.risque, /faux compte/.test(faux.raison)], ['élevé', true]);
    assert.equal(l.find((x) => x.url === 'https://www.facebook.com/toufatech')?.officiel, true);
    assert.deepEqual([unSite(w, 'fr.trustpilot.com')?.categorie, unSite(w, 'societe.com')?.categorie], ['avis', 'registre de sociétés']);
    assert.equal(unSite(w, 'toufatech.com'), undefined, 'son propre site n\'est pas une trace');
    const dom = (n: string) => l.find((x) => x.genre === 'domaine' && x.site === n);
    assert.deepEqual([dom('toufatech.fr')?.risque, /faux e-mails/.test(dom('toufatech.fr')?.raison ?? '')], ['élevé', true], 'existe et reçoit du courrier');
    assert.equal(dom('t0ufatech.com')?.risque, 'moyen'); assert.equal(dom('toufatech-sav.com')?.risque, 'moyen');
    assert.equal(dom('toufatech.net'), undefined, 'pas de réponse claire : pas de conclusion');
    assert.match(r.text, /Pas tout vérifié : DNS/);
    assert.match((await w.act('resultat', { resultat: faux.id })).text, /Usurpation d'identité/);
    assert.match((await w.act('resultat', { resultat: dom('toufatech.fr')!.id })).text, /whois[\s\S]*SYRELI|UDRP/);
    assert.match((await w.act('lettre', { resultat: faux.id })).text, /protège les personnes, pas les sociétés/);
  } finally { w.fin(); }
});

// ---------------------------------------------------------------- photos
test('Gygès · photo : lieu caché (GPS), appareil et date d\'une vraie photo ; la copie envoyée est effacée', async () => {
  const w = monde();
  try {
    const arrivee = join(w.dir, 'photos'); mkdirSync(arrivee, { recursive: true });
    for (const f of ['hlin-gps.jpg', 'hlin-gps.png', 'hlin-gps.webp']) {
      copyFileSync(join(PHOTOS, f), join(arrivee, f));
      const r = await w.act('photo', { fichier: `photo:${f}` });
      assert.equal(r.ok, true, r.text);
      assert.match(r.text, /Lieu caché dans la photo : oui \(coordonnées GPS, vers -12\.78, 45\.23\)/, f);
      assert.match(r.text, /Appareil : Fairphone FP5/); assert.match(r.text, /Prise le 14\/07\/2026 à 18:22/); assert.match(r.text, /Options[\s\S]*Lieu/);
      assert.equal(existsSync(join(arrivee, f)), false, `${f} : copie effacée après la lecture`);
    }
    copyFileSync(join(PHOTOS, 'hlin-sans.jpg'), join(arrivee, 'sans.jpg'));
    assert.match((await w.act('photo', { fichier: 'photo:sans.jpg' })).text, /Rien de caché que je sache lire/);
    assert.match((await w.act('photo', { fichier: 'photo:../fiches.json' })).text, /chemin complet|introuvable/);
    assert.match((await w.act('photo', { fichier: join(w.dir, 'fiches.json') })).text, /envoie la photo depuis ton appareil/, 'pas de lecture du dossier protégé');
    assert.match((await w.act('photo', { fichier: join(PHOTOS, 'hlin-gps.jpg') })).text, /Lieu caché dans la photo : oui/, 'un chemin sur la machine d\'Odin');
    assert.ok(existsSync(join(PHOTOS, 'hlin-gps.jpg')), 'une photo qui n\'a pas été envoyée n\'est pas effacée');
  } finally { w.fin(); }
});

// ---------------------------------------------------------------- page
test('Gygès · la page : onglets courts, marche à suivre, rien en clair', async () => {
  const w = monde();
  try {
    const m = w.v.module('hlin')!, vide = await m.view(w.v.ctx('hlin'), new URLSearchParams());
    assert.deepEqual(vide.onglets, ['Moi', 'Résultats', 'Demandes', 'Sociétés']);
    assert.ok(vide.sections.every((s) => vide.onglets!.includes(s.onglet ?? '')), 'chaque section a son onglet');
    assert.equal(vide.sections[0].kind, 'steps'); assert.match(vide.subtitle ?? '', /Commence par ta fiche/);
    await w.act('moi', MOI); await w.act('chercher', {});
    const v = await m.view(w.v.ctx('hlin'), new URLSearchParams());
    const page = JSON.stringify(v);
    // Les adresses des pages restent telles quelles (pour les ouvrir) ; titres, extraits et coordonnées sont masqués.
    assert.doesNotMatch(page.replace(/"default":"[^"]*"/g, '').replace(/https?:\/\/[^"\s]+/g, ''), /0639123456|06 39 12 34 56|awa\.said@exemple|rue des Fleurs/, 'hors du formulaire de ta fiche, rien en clair');
    const table = v.sections.find((s) => s.title === 'Ce qui est visible') as { rows: Array<{ cells: string[]; tone?: string }> };
    assert.equal(table.rows[0].cells[1], 'élevé · nouveau'); assert.equal(table.rows[0].tone, 'mauvais');
    assert.equal(v.kpis![0].value, '2');
    assert.match(refusDe(m) ?? '', /^Gygès garde où tu apparais sur Internet[\s\S]*reste dans Odin/, 'la page de Gygès ne s\'exporte pas et ne se partage pas');
  } finally { w.fin(); }
});

// ---------------------------------------------------------------- Logos (sans IA)
test('Gygès · phrases comprises sans IA, et phrases banales qui ne vont pas chez Gygès', async () => {
  const w = monde();
  try {
    const vers = async (p: string) => { const u = await understand(w.v, p, `s:${p}`); return u && u.kind === 'action' ? `${u.module}.${u.action}` : u && 'module' in u ? `${u.module}?` : '—'; };
    for (const [p, a] of [
      ['où j\'apparais', 'hlin.etat'], ['où est-ce que j\'apparais sur internet ?', 'hlin.etat'], ['bilan de ma vie privée', 'hlin.etat'],
      ['vérifie où j\'apparais', 'hlin.chercher'], ['vérifie ma visibilité', 'hlin.chercher'], ['cherche mes traces sur internet', 'hlin.chercher'],
      ['résultats de ma vie privée', 'hlin.resultats'], ['mes demandes de retrait', 'hlin.demandes'], ['mes fiches de vie privée', 'hlin.fiches'],
      ['prépare une lettre rgpd', 'hlin.lettre'], ['guide de confidentialité instagram', 'hlin.guide'], ['passer mon compte en privé sur snapchat', 'hlin.guide'],
      ['lieu caché dans la photo', 'hlin.photo'], ['que révèle la photo', 'hlin.photo'],
    ]) assert.equal(await vers(p), a, p);
    for (const p of ['j\'apparais sur la photo de classe', 'envoie une lettre à Paul', 'mes demandes de congé', 'mets Sherlock sur la télé', 'je veux être plus visible sur Instagram', 'vérifie mon adresse e-mail', 'c\'est privé', 'cherche Awa Saïd sur internet', 'trouve le numéro de Karim', 'qui est Jean Dupont', 'cherche le pseudo de Sara', 'les résultats du match', 'donne-moi les résultats bruts', 'regarde Maigret ce soir'])
      assert.doesNotMatch(await vers(p), /^hlin/, `« ${p} » ne va pas chez Gygès`);
    const u = await understand(w.v, 'guide de confidentialité tiktok', 's');
    assert.deepEqual(u && u.kind === 'action' ? u.input : {}, { reseau: 'TikTok' });
  } finally { w.fin(); }
});
