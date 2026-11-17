// Banc de compréhension (test/soul-banc/comprehension.ts) : les fonctions pures prouvées sur de petits cas calculés à
// la main, puis les deux jeux contrôlés contre le catalogue RÉEL des applis (chaque appli, action et nom de réglage
// existe ; « manque » ne cite que des réglages obligatoires) et contre toute la matière d'apprentissage (aucune fuite).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  comptes, defautsJeuC, juger, lireListe, lireMoment, lireNombre, memeValeur, normerTexte, rapportC, releveC, sansBord,
  type DemandeC, type InfosActions, type JeuC, type ReponseC,
} from './soul-banc/comprehension.ts';
import { dossierJetable, environnementBanc, modulesDuProduit } from './soul-banc/catalogue.ts';

const proche = (a: number, b: number, eps = 1e-4) => assert.ok(Math.abs(a - b) <= eps, `${a} ≠ ${b}`);
const dem = (o: Partial<DemandeC> & { id: string }): DemandeC => ({ langue: 'fr', ecriture: 'Latn', phrase: o.id, appli: 'frigg', action: 'reserver', reglages: {}, manque: [], sorte: 'complete', aRelire: false, ...o });
const rep = (o: Partial<ReponseC> = {}): ReponseC => ({ appli: 'frigg', action: 'reserver', reglages: {}, manque: [], decision: 'agir', ...o });
const INFOS: InfosActions = new Map([
  ['frigg.reserver', [
    { key: 'service', kind: 'text', required: true }, { key: 'jour', kind: 'text', required: true }, { key: 'heure', kind: 'text', required: true },
    { key: 'nom', kind: 'text', required: true }, { key: 'contact', kind: 'text', required: true }, { key: 'note', kind: 'text', required: false, default: '' },
  ]],
  ['garmr.bannir', [{ key: 'ip', kind: 'text', required: true }, { key: 'raison', kind: 'text', required: false, default: 'à la demande' }, { key: 'minutes', kind: 'number', required: false, default: 60 }]],
  ['vidarr.services', [{ key: 'service', kind: 'select', required: true, options: ['tiktok', 'youtube'] }, { key: 'coupe', kind: 'boolean', required: false, default: true }]],
]);

test('Textes : casse, accents, largeur, guillemets, petits mots du bord', () => {
  assert.equal(normerTexte('  « Lampe du SALON » '), 'lampe du salon');
  assert.equal(normerTexte('Ｃａｆé'), 'cafe', 'pleine largeur et accent');
  assert.equal(sansBord('la lampe du salon'), 'lampe du salon');
  assert.equal(sansBord("l'imprimante"), 'imprimante');
  assert.equal(sansBord('the porch light'), 'porch light');
  assert.equal(sansBord('le'), 'le', 'un mot seul reste');
  assert.ok(memeValeur('Lampe du salon', 'la lampe du salon'));
  assert.ok(memeValeur('lampe-du-salon', 'Lampe du salon'), 'traits d\'union comme des espaces');
  assert.ok(memeValeur('nginx:1.27', 'nginx:1.27'));
  assert.ok(!memeValeur('salon', 'télé du salon'), 'un mot de plus qui n\'est pas un petit mot change la valeur');
  assert.ok(memeValeur('01 99 00 12 34', '0199001234'), 'téléphone : seuls les chiffres comptent');
  assert.ok(memeValeur('札幌', '札幌'));
  assert.ok(!memeValeur('札幌', ''), 'une valeur vide n\'est jamais juste');
});

test('Adresses web : sans « https:// », sans « www. », sans « / » final', () => {
  assert.ok(memeValeur('boutique.example.org', 'https://boutique.example.org/'));
  assert.ok(memeValeur('https://www.example.org/a', 'example.org/a'));
  assert.ok(!memeValeur('example.org', 'example.net'));
});

test('Nombres et durées', () => {
  assert.ok(memeValeur(22, '22'));
  assert.ok(memeValeur(22, 22));
  assert.ok(memeValeur(99.5, '99,5'));
  assert.ok(!memeValeur(22, 23));
  assert.equal(lireNombre('2 h', 'minutes'), 120);
  assert.equal(lireNombre('1h30', 'minutes'), 90);
  assert.equal(lireNombre('PT2H', 'minutes'), 120);
  assert.equal(lireNombre('90 s', 'minutes'), 1.5);
  assert.equal(lireNombre('2 minutes', 'secondes'), 120);
  assert.equal(lireNombre('2 h', 'longueur'), undefined, 'une durée n\'est convertie que pour un réglage de durée');
  assert.equal(lireNombre('22°', 'valeur'), 22);
  assert.ok(memeValeur(120, '2 heures', 'minutes'));
  assert.ok(!memeValeur(120, '2 heures', 'n'));
});

test('Dates et heures : date seule, date et heure, heure seule, texte libre résolu', () => {
  assert.deepEqual(lireMoment('2026-11-18'), { date: '2026-11-18' });
  assert.deepEqual(lireMoment('2026-11-18T15:30:00'), { date: '2026-11-18', heure: '15:30' });
  assert.deepEqual(lireMoment('18/11/2026 à 9h'), { date: '2026-11-18', heure: '09:00' });
  assert.deepEqual(lireMoment('3 pm'), { heure: '15:00' });
  assert.deepEqual(lireMoment(new Date(2026, 10, 19, 14, 30)), { date: '2026-11-19', heure: '14:30' });
  assert.ok(memeValeur('2026-11-18', '2026-11-18 09:00'), 'date seule attendue : l\'heure obtenue est ignorée');
  assert.ok(!memeValeur('2026-11-18 09:00', '2026-11-18'), 'date et heure attendues : il faut les deux');
  assert.ok(memeValeur('21:00', '21h'));
  assert.ok(memeValeur('21:00', '2026-11-17T21:00'), 'heure seule attendue : la date obtenue est ignorée');
  assert.ok(!memeValeur('21:00', '20:00'));
  const resoudre = (t: string) => (/jeudi/.test(t) ? new Date(2026, 10, 19, /14/.test(t) ? 14 : 9, /30/.test(t) ? 30 : 0) : undefined);
  assert.ok(memeValeur('2026-11-19 14:30', 'jeudi 14h30', 'quand', { resoudreDate: resoudre }));
  assert.ok(!memeValeur('2026-11-19 14:30', 'jeudi', 'quand', { resoudreDate: resoudre }), 'jeudi sans heure ne donne pas 14 h 30');
  assert.ok(!memeValeur('2026-11-19 14:30', 'jeudi 14h30', 'quand'), 'sans résolveur, un texte libre ne vaut pas une date');
  assert.ok(!memeValeur('2026-11-19', 'jeudi', 'jour', { resoudreDate: resoudre, texteLibre: false }), 'un réglage qui n\'est pas un texte libre n\'est pas résolu');
});

test('Oui / non, allumé / éteint, listes, plusieurs bonnes valeurs', () => {
  assert.ok(memeValeur(true, true)); assert.ok(memeValeur(true, 'oui')); assert.ok(memeValeur(false, 'off')); assert.ok(!memeValeur(true, false));
  assert.ok(memeValeur('on', 'allume')); assert.ok(memeValeur('off', 'false')); assert.ok(!memeValeur('on', 'off'));
  assert.deepEqual(lireListe('salon, cuisine et chambre'), ['salon', 'cuisine', 'chambre']);
  assert.deepEqual(lireListe('salle de bain'), ['salle de bain'], 'les espaces ne coupent pas');
  assert.ok(memeValeur(['salon', 'cuisine'], 'la cuisine et le salon'), 'l\'ordre ne compte pas');
  assert.ok(memeValeur(['salon', 'cuisine'], ['cuisine', 'salon']));
  assert.ok(!memeValeur(['salon', 'cuisine'], 'salon'));
  assert.ok(memeValeur(['salle de bain'], 'salle de bain'));
  assert.ok(memeValeur({ un_de: ['salon', 'télé du salon'] }, 'Télé du salon'));
  assert.ok(!memeValeur({ un_de: ['salon', 'télé du salon'] }, 'cuisine'));
});

test('Juger une demande complète', () => {
  const d = dem({ id: 'c', reglages: { service: 'coupe', jour: '2026-11-20', heure: '15:00', nom: 'Malik Benali', contact: '01 99 00 12 34' } });
  const bon = rep({ reglages: { service: 'Coupe', jour: '2026-11-20', heure: '15h', nom: 'Malik Benali', contact: '0199001234', note: '' } });
  const j = juger(d, bon, { infos: INFOS });
  assert.ok(j.entiere); assert.ok(j.tousReglages); assert.deepEqual(j.enTrop, []);
  assert.ok(!juger(d, { ...bon, decision: 'demander' }, { infos: INFOS }).entiere, 'complète : il fallait agir');
  assert.ok(!juger(d, { ...bon, manque: ['nom'] }, { infos: INFOS }).entiere, 'complète : rien ne manquait');
  const faux = juger(d, rep({ reglages: { ...bon.reglages, service: 'coupe pour Malik Benali' } }), { infos: INFOS });
  assert.ok(!faux.entiere); assert.deepEqual(faux.reglages, { service: false, jour: true, heure: true, nom: true, contact: true });
  const autre = juger(d, { ...bon, action: 'creneaux' }, { infos: INFOS });
  assert.ok(autre.appli && !autre.action && !autre.entiere); assert.ok(Object.values(autre.reglages).every((x) => !x), 'action fausse : réglages faux d\'office');
  const trop = juger(d, rep({ reglages: { ...bon.reglages, note: 'urgent' } }), { infos: INFOS });
  assert.deepEqual(trop.enTrop, ['note']); assert.ok(trop.entiere, 'une valeur en trop est comptée à part, sans casser la demande');
  const defaut = juger(dem({ id: 'b', appli: 'garmr', action: 'bannir', reglages: { ip: '198.51.100.3' } }), rep({ appli: 'garmr', action: 'bannir', reglages: { ip: '198.51.100.3', raison: 'à la demande', minutes: 60 } }), { infos: INFOS });
  assert.deepEqual(defaut.enTrop, [], 'une valeur par défaut n\'est pas en trop');
  const aussi = juger(dem({ id: 'a', appli: 'midgard', action: 'commander', aussi: ['appareils.commander'], reglages: { valeur: 'on' } }), rep({ appli: 'appareils', action: 'commander', reglages: { valeur: 'on' } }));
  assert.ok(aussi.entiere, '« aussi » accepte une autre appli·action');
});

test('Juger une demande où il manque un réglage : demander, sans inventer', () => {
  const d = dem({ id: 'm', sorte: 'manque', reglages: { service: 'coupe', jour: '2026-11-18', heure: '10:30' }, manque: ['nom', 'contact'] });
  const bon = rep({ reglages: { service: 'coupe', jour: '2026-11-18', heure: '10:30' }, manque: ['nom', 'contact'], decision: 'demander' });
  const j = juger(d, bon, { infos: INFOS });
  assert.ok(j.entiere); assert.deepEqual(j.manquesReperes, ['nom', 'contact']); assert.deepEqual(j.inventes, []);
  const invente = juger(d, { ...bon, reglages: { ...bon.reglages, nom: 'coupe' }, manque: ['contact'] }, { infos: INFOS });
  assert.deepEqual(invente.inventes, ['nom']); assert.deepEqual(invente.manquesRates, ['nom']); assert.ok(!invente.entiere);
  const agit = juger(d, { ...bon, decision: 'agir', manque: [] }, { infos: INFOS });
  assert.ok(!agit.entiere && !agit.decisionJuste);
  const trop = juger(d, { ...bon, reglages: {}, manque: ['service', 'nom', 'contact'] }, { infos: INFOS });
  assert.deepEqual(trop.demandesATort, ['service']); assert.ok(!trop.entiere, 'demander ce que la phrase donne n\'est pas comprendre');
});

test('Juger une demande ambiguë ou hors du champ', () => {
  const a = dem({ id: 'a', sorte: 'ambigue', appli: null, action: null });
  assert.ok(juger(a, rep({ decision: 'demander', appli: null })).entiere);
  assert.ok(juger(a, rep({ decision: 'passer' })).entiere);
  assert.ok(!juger(a, rep({ decision: 'agir' })).entiere, 'ambiguë : agir seul est faux');
  const h = dem({ id: 'h', sorte: 'hors-champ', appli: null, action: null });
  assert.ok(juger(h, rep({ appli: null, action: null, decision: 'passer' })).entiere);
  assert.ok(juger(h, rep({ decision: 'passer' })).entiere, 'passer la main est juste hors du champ');
  assert.ok(!juger(h, rep({ decision: 'agir' })).entiere);
  assert.ok(!juger(h, rep({ decision: 'demander' })).entiere, 'hors champ : demander une précision à une appli est faux');
});

test('Relevés : comptes et intervalles de Wilson', () => {
  const d1 = dem({ id: '1', reglages: { service: 'coupe', jour: '2026-11-18', heure: '10:00', nom: 'A', contact: 'a@example.org' } });
  const d2 = dem({ id: '2', sorte: 'manque', reglages: { service: 'coupe' }, manque: ['jour', 'heure', 'nom', 'contact'] });
  const d3 = dem({ id: '3', sorte: 'hors-champ', appli: null, action: null, langue: 'en' });
  const r1 = rep({ reglages: { ...d1.reglages, nom: 'B' } });
  const r2 = rep({ reglages: { service: 'coupe', jour: '2026-11-18' }, manque: ['heure', 'nom', 'contact'], decision: 'demander' });
  const r3 = rep({ decision: 'agir' });
  const js = [[d1, r1], [d2, r2], [d3, r3]].map(([d, r]) => ({ demande: d as DemandeC, j: juger(d as DemandeC, r as ReponseC) }));
  const r = releveC(js);
  assert.equal(r.n, 3);
  assert.deepEqual([r.appli.k, r.appli.n, r.action.k, r.action.n], [2, 2, 2, 2], 'appli et action : dans le champ seulement');
  assert.deepEqual([r.reglages.k, r.reglages.n], [5, 6]);
  assert.deepEqual([r.manquesReperes.k, r.manquesReperes.n, r.inventes.k, r.inventes.n], [3, 4, 1, 4]);
  assert.deepEqual([r.entieres.k, r.entieres.n], [0, 3]);
  proche(r.reglages.bas, 0.43649); proche(r.reglages.haut, 0.96994);
  const rap = rapportC([{ demande: d1, reponse: r1, ms: 1 }, { demande: d2, reponse: r2, ms: 1 }, { demande: d3, reponse: r3, ms: 1 }]);
  assert.deepEqual(Object.keys(rap.parSorte), ['complete', 'hors-champ', 'manque']);
  assert.deepEqual(Object.keys(rap.parLangue), ['en', 'fr']);
  assert.equal(rap.parReglage.nom.k, 0); assert.equal(rap.parReglage.service.k, 2);
  assert.equal(rap.francais.n, 2); assert.equal(rap.autres.n, 1);
});

// ------------------------------------------------------------------------------------------------ version 2 (relecture du 17/11)
test('Ouvrir / fermer : les mêmes ensembles que allumé / éteint, dans les langues des jeux (M1)', () => {
  for (const x of ['fermer', 'ferme', 'close', 'shut', 'off']) assert.ok(memeValeur('fermer', x), `fermer ← ${x}`);
  for (const x of ['ouvrir', 'ouvre', 'open', 'on']) assert.ok(memeValeur('ouvrir', x), `ouvrir ← ${x}`);
  assert.ok(!memeValeur('fermer', 'ouvre')); assert.ok(!memeValeur('ouvrir', 'close'));
});

test('Une heure ISO en UTC (« …Z ») est lue à l\'heure locale (P1)', () => {
  const d = new Date('2026-11-18T14:30:00Z'), p = (n: number) => String(n).padStart(2, '0');
  const local = { date: `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`, heure: `${p(d.getHours())}:${p(d.getMinutes())}` };
  assert.deepEqual(lireMoment('2026-11-18T14:30:00Z'), local);
  assert.deepEqual(lireMoment('2026-11-18T14:30:00.000Z'), local);
  assert.deepEqual(lireMoment('2026-11-18T15:30:00'), { date: '2026-11-18', heure: '15:30' }, 'sans fuseau : déjà local');
});

test('Le titre se calcule dans le champ, avec la base « toujours passer la main » à côté (G2) ; la pire langue a n ≥ 10 (M8)', () => {
  const ds = [
    dem({ id: 'c', reglages: { service: 'coupe' } }), dem({ id: 'm', sorte: 'manque', reglages: {}, manque: ['nom'] }),
    dem({ id: 'a', sorte: 'ambigue', appli: null, action: null }), dem({ id: 'h', sorte: 'hors-champ', appli: null, action: null }),
  ];
  const passe: ReponseC = { appli: null, action: null, reglages: {}, manque: [], decision: 'passer' };
  const r = rapportC(ds.map((d) => ({ demande: d, reponse: passe, ms: 1 })));
  assert.deepEqual([r.titre.k, r.titre.n], [0, 2], 'passer la main ne gagne rien dans le champ');
  assert.deepEqual([r.global.entieres.k, r.global.entieres.n], [2, 4]);
  assert.deepEqual([r.base.global.entieres.k, r.base.titre.k, r.base.titre.n], [2, 0, 2], 'la base abstention est publiée');
  assert.deepEqual([r.base.parSorte.ambigue.entieres.k, r.base.parSorte.complete.entieres.k], [1, 0]);
  const bon = rapportC([{ demande: ds[0], reponse: rep({ reglages: { service: 'coupe' } }), ms: 1 }]);
  assert.deepEqual([bon.titre.k, bon.titre.n], [1, 1]);
  assert.equal(bon.pireLangue, null, 'une langue de moins de 10 demandes ne peut pas être « la pire »');
  const dix = Array.from({ length: 10 }, (_, i) => ({ demande: dem({ id: `e${i}`, langue: 'el', reglages: { service: 'coupe' } }), reponse: passe, ms: 1 }));
  assert.equal(rapportC([...dix, { demande: dem({ id: 'x', langue: 'tr' }), reponse: passe, ms: 1 }]).pireLangue?.langue, 'el');
});

test('Les ratées où la méthode dit ne pas connaître la chose sont comptées à part (M5)', () => {
  const d = dem({ id: 'l', appli: 'appareils', action: 'commander', reglages: { appareil: 'lampe', valeur: 'on' } });
  const r = rapportC([
    { demande: d, reponse: rep({ appli: 'appareils', action: 'commander', reglages: { appareil: 'lampe', valeur: 'on' }, decision: 'demander', detail: 'dit : je ne connais pas « lampe »' }), ms: 1 },
    { demande: d, reponse: rep({ decision: 'passer', appli: null, detail: 'autre' }), ms: 1 },
  ]);
  assert.deepEqual([r.maisonInconnue.k, r.maisonInconnue.n], [1, 2]);
});

test('Contrôle de forme d\'un jeu', () => {
  assert.deepEqual(defautsJeuC({}), ['le jeu n\'a pas de liste « demandes »']);
  const jeu = (demandes: unknown[]) => ({ version: 1, origine: 'essai', maintenant: '2026-11-17T10:00:00', demandes });
  assert.deepEqual(defautsJeuC(jeu([dem({ id: 'x', appli: 'garmr', action: 'bannir', reglages: { ip: '198.51.100.3' } })]), INFOS), []);
  const d = defautsJeuC(jeu([
    dem({ id: 'x', appli: 'garmr', action: 'bannir', reglages: { adresse: '198.51.100.3' } }),
    dem({ id: 'x', appli: 'garmr', action: 'bannir', sorte: 'manque', reglages: {}, manque: ['minutes'] }),
    dem({ id: 'y', appli: 'vidarr', action: 'services', reglages: { service: 'netflix', coupe: 'oui' as never } }),
    dem({ id: 'z', appli: 'garmr', action: 'inventee', reglages: {} }),
    dem({ id: 'w', sorte: 'hors-champ', appli: 'garmr', action: null }),
  ]), INFOS);
  const a = (re: RegExp) => assert.ok(d.some((x) => re.test(x)), `défaut attendu : ${re} dans ${JSON.stringify(d)}`);
  a(/réglage inconnu « garmr\.bannir\.adresse »/); a(/l'obligatoire « ip » n'est pas donné/); a(/id en double/); a(/« minutes » n'est pas obligatoire/);
  a(/n'est pas une option de service/); a(/coupe attend oui \/ non/); a(/action inconnue « garmr\.inventee »/); a(/hors champ avec une appli/);
});

// ------------------------------------------------------------------------------------------------ les deux jeux
const lire = (n: string) => JSON.parse(readFileSync(new URL(`./soul-banc/jeux/${n}.json`, import.meta.url), 'utf8')) as JeuC;
const dev = lire('comprehension-developpement'), juge = lire('comprehension-principal');

test('Les deux jeux : tailles, langues, écritures, sortes, origine honnête', () => {
  for (const [j, min, fige] of [[dev, 250, false], [juge, 350, true]] as const) {
    const c = comptes(j) as { demandes: number; applis: number; parLangue: Record<string, number>; parEcriture: Record<string, number>; parSorte: Record<string, number> };
    assert.ok(c.demandes >= min, `${c.demandes} demandes`);
    assert.equal(Boolean(j.fige), fige);
    assert.ok(c.applis >= 50, `${c.applis} applis`);
    const fr = (c.parLangue.fr ?? 0) / c.demandes; assert.ok(fr >= 0.4 && fr <= 0.6, `français ${fr}`);
    assert.ok(Object.keys(c.parLangue).filter((l) => l !== 'fr').length >= 8, 'au moins huit autres langues');
    assert.ok(Object.keys(c.parEcriture).length >= 5, 'au moins cinq écritures');
    assert.ok((c.parSorte.manque ?? 0) / c.demandes >= 0.25, 'au moins un quart de demandes où un réglage manque');
    for (const s of ['complete', 'manque', 'ambigue', 'hors-champ']) assert.ok((c.parSorte[s] ?? 0) > 0, `sorte ${s}`);
    assert.ok(!Object.keys(c.parLangue).some((l) => /^(swb|buc|shi|kib|zdj|wni)$/.test(l)), 'ni shimaoré ni kibushi');
    assert.match(j.origine, /agent/); assert.match(j.origine, /Non relu par une personne/);
    assert.equal(j.maintenant, '2026-11-17T10:00:00');
  }
  const ids = new Set(dev.demandes.map((d) => d.id));
  assert.ok(!juge.demandes.some((d) => ids.has(d.id)), 'aucun identifiant commun');
  const p = new Set(dev.demandes.map((d) => normerTexte(d.phrase)));
  assert.ok(!juge.demandes.some((d) => p.has(normerTexte(d.phrase))), 'aucune phrase commune');
});

test('Version 2 : jeu figé, rien de proche (≥ 0,6) du jeu de travail, chaque langue ≥ 10 demandes, aucune appli de l\'OS', async () => {
  assert.equal(juge.version, 2); assert.equal(dev.version, 2);
  const F = await import('./soul-banc/fuites.ts');
  const proches = F.fuitesContre(dev.demandes as never, new F.Index(juge.demandes.map((d) => ({ texte: d.phrase, source: d.id }))), 0.6);
  assert.deepEqual(proches.map((f) => `${f.id} ~ ${f.source}`), [], 'M7 : aucun gabarit commun au jeu de travail et au jeu figé');
  const c = comptes(juge) as { parLangue: Record<string, number> };
  for (const [l, n] of Object.entries(c.parLangue)) assert.ok(n >= 10, `M8 : ${l} n'a que ${n} demandes`);
  assert.ok(![...dev.demandes, ...juge.demandes].some((d) => d.appli === 'pegase'), 'P8 : Pégase peut quitter main');
  // P5 : un tableur rendu en lignes « ; » vaut la valeur écrite avec des virgules (seuls les lettres et chiffres comptent).
  assert.ok(memeValeur('billets 800, location 650', 'billets;800\nlocation;650'));
});

test('Les deux jeux contre le catalogue réel et la matière d\'apprentissage', { timeout: 600_000 }, async () => {
  const { home, fin } = dossierJetable('odin-soul-comprehension-essai-');
  environnementBanc(home);
  try {
    const mods = await modulesDuProduit(home);
    const { infosDe } = await import('./soul-banc/comprehension.ts');
    const infos = infosDe(mods), applis = new Set(mods.map((m) => m.id));
    assert.deepEqual(defautsJeuC(dev, infos, applis), []);
    assert.deepEqual(defautsJeuC(juge, infos, applis), []);
    const F = await import('./soul-banc/fuites.ts');
    const { sources } = await F.sourcesApprentissage(mods);
    const { textesDesJeux } = await import('./soul-banc/logique.ts');
    const index = new F.Index([...sources, ...(await textesDesJeux(['comprehension-developpement', 'comprehension-principal']))]);
    const forme = (j: JeuC) => j.demandes as never;
    for (const j of [dev, juge]) {
      assert.deepEqual(F.fuitesContre(forme(j), index, 0.8).map((f) => `${f.id} ← ${f.source}`), [], 'aucune phrase apprise, indexée ou déjà dans un jeu d\'aiguillage');
      assert.deepEqual(F.doublonsInternes(forme(j), 0.8).map((f) => f.id), [], 'aucun quasi-doublon interne');
    }
    assert.deepEqual(F.fuitesContre(forme(dev), new F.Index(juge.demandes.map((d) => ({ texte: d.phrase, source: d.id }))), 0.8).map((f) => f.id), [], 'rien de presque identique entre les deux jeux');
  } finally { fin(); }
});
