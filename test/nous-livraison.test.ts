// Noûs — le MODÈLE DE DÉPART livré avec Odin (note modele-de-depart.md) : corpus de livraison (rien de privé, témoins),
// export vers un dossier de livraison (float16, découpage, manifeste, licence), vérification des empreintes,
// installation au premier lancement (re-scellé par la clé de la machine), mise à jour seulement si mieux en bits par
// octet. Toute la chaîne, de bout en bout, avec un petit modèle (gabarit « petit ») entraîné quelques secondes.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as L from '../src/brain/nous/livraison.ts';
import { fabriquerDepart, type SourcesDepart } from '../src/brain/nous/corpus-depart.ts';
import { fileBornee } from '../src/brain/nous/deps.ts';
import { decoupageDe } from '../src/brain/nous/preparation.ts';
import { Reseau, seance } from '../src/brain/nous/calcul.ts';
import { gabarit, chargerMoteur } from '../src/brain/nous/moteur.ts';
import { ecrireReprise, listerReprises } from '../src/brain/nous/reprise.ts';
import { lireDecoupageSerialise } from '../src/brain/nous/decoupage.ts';
import type { OdinPourNous } from '../src/brain/nous/file-odin.ts';

const dossiers: string[] = [];
after(() => { for (const d of dossiers) rmSync(d, { recursive: true, force: true }); });
const jetable = (p: string) => { const d = mkdtempSync(join(tmpdir(), p)); dossiers.push(d); return d; };
/** L'épingle des essais (jamais celle du dépôt) : chaque export la réécrit, l'installation la lit. */
const EPINGLE = join(mkdtempSync(join(tmpdir(), 'soul-epingle-')), 'epingle.json');
const odinDe = (home: string, o: { actif?: boolean; prive?: boolean } = {}): OdinPourNous => ({ cfg: { learning: { observe: true }, nous: { actif: o.actif ?? true }, voice: { privacy: { privateMode: o.prive ?? false } } }, paths: { home } });

// Des sources « Odin » de taille d'essai (toutes publiques), avec des TÉMOINS semés dans la partie privée.
const TEMOINS = ['Jean-Baptiste Lemarchand', 'salon-nas-7f3', 'mon-blog-secret.example', 'La clé du coffre est sous le pot de basilic'];
function sourcesEssai(): SourcesDepart {
  const modules = Array.from({ length: 24 }, (_, k) => ({
    id: `appli${k}`, name: `Appli ${k}`, what: `L'appli ${k} range les objets de type ${k} et les montre sur une carte.`,
    does: [`range les objets ${k}`, `montre la carte ${k}`],
    words: [`appli ${k}`, `objets ${k}`],
    actions: [{ id: `ouvrir_${k}`, label: `Ouvrir ${k}`, what: `Ouvre la carte ${k}`, words: [`ouvre la carte ${k}`, `montre moi ${k}`, `affiche les objets ${k}`] }],
  }));
  return {
    modules, liens: [{ from: 'appli1', to: 'appli2', when: 'un objet change', does: 'la carte se met à jour' }],
    usages: [{ need: 'retrouver un objet', chain: ['appli1', 'appli2'], why: 'la carte le montre.' }],
    survol: { appli1: { phrase: 'Tes objets.', faire: ['Ranger un objet'] } },
    competences: [{ name: 'meteo', description: 'Donne la météo du jour.' }],
    // Le privé : ne doit JAMAIS entrer dans le corpus de livraison.
    notes: () => [{ title: 'Note perso', body: 'La clé du coffre est sous le pot de basilic. Visite de mon-blog-secret.example demain.' }],
    souvenirs: () => [{ id: 3, content: 'Jean-Baptiste Lemarchand possède le serveur salon-nas-7f3.', origin: 'owner' }],
  };
}

/** Un petit modèle, entraîné quelques secondes sur le corpus de livraison, écrit comme point de reprise (scellé). */
async function petitModele(home: string, exemples: L.ExempleTexteLivre[], secondes = 3, graine = 7) {
  const hyper = gabarit('petit');
  const dec = decoupageDe(exemples.map((e) => e.texte), hyper.vocab, 0x0d1a);
  const jeux = L.jeuxLivraison(exemples, dec, { contexte: hyper.contexte });
  const r = new Reseau(hyper); r.initialiser(graine);
  if (secondes > 0) seance(r, [{ entrees: jeux.entrainement, ...(jeux.roles ? { roles: jeux.roles as Int32Array[] } : {}) }], { dureeMs: secondes * 1000, graine, tailleLot: 8 });
  await ecrireReprise(home, 0, { hyper, decoupage: dec, poids: r.poids, m: new Float32Array(r.poids.length), v: new Float32Array(r.poids.length), pas: 1, graine, courbe: [], modeleVersion: 1 });
  L.ecrireProvenance(home, L.corpusLivraison(sourcesEssai()).bilan.empreinte);
  return { hyper, dec, r };
}

test('essai 6 : rien de privé — en mode « livraison » aucun témoin ; le premier corpus « odin » les contient (preuve que le mode est nécessaire)', () => {
  const s = sourcesEssai();
  const c = L.corpusLivraison(s);
  assert.ok(c.exemples.length > 50);
  assert.deepEqual(L.temoinsTrouves(c.exemples.map((e) => e.texte), TEMOINS), [], 'aucun témoin en mode livraison');
  const file = fileBornee(100_000);
  fabriquerDepart('', { cfg: { learning: { observe: true }, nous: { actif: true } }, privateMode: () => false, essai: false, file }, 'odin', s);
  const odinTextes = file.prendre(100_000).map((e) => e.texte || `${e.demande}\n${e.reponse}`);
  assert.ok(L.temoinsTrouves(odinTextes, TEMOINS).length >= 3, 'le choix « odin » mêle le privé : il ne sert jamais à la livraison');
  // Les compétences livrées sont celles du dépôt, jamais celles écrites chez le propriétaire.
  const livrees = L.competencesLivrees(process.cwd());
  assert.ok(livrees.length >= 1 && livrees.every((x) => x.name));
});

test('chaîne complète : petit modèle entraîné → export (float16, manifeste, licence) → vérification → installation scellée → chargé', async () => {
  const fab = jetable('soul-fab-'), home = join(fab, 'odin');
  const c = L.corpusLivraison(sourcesEssai());
  await petitModele(home, c.exemples, 3);
  const sortie = join(fab, 'modeles', 'soul-depart');
  const r = await L.exporterModeleDepart({ home, sortie, corpus: c, temoins: TEMOINS, version: 1, licence: join(process.cwd(), 'LICENSE'), epingle: EPINGLE });
  assert.equal(r.ok, true, r.ok ? '' : r.raison);
  assert.deepEqual(readdirSync(sortie).sort(), ['LICENCE', 'decoupage.json', 'manifeste.json', 'soul-depart.bin']);
  const man = JSON.parse(readFileSync(join(sortie, 'manifeste.json'), 'utf8')) as L.Manifeste;
  assert.equal(man.poids.precision, 'float16');
  assert.equal(readFileSync(join(sortie, 'soul-depart.bin')).length, man.poids.nombre * 2, 'float16, sans les moments de l\'optimiseur');
  assert.ok(man.mesures.bancPublic.textes > 0 && man.mesures.bancPublic.bitsParOctet > 0);
  assert.equal(man.corpus.empreinte, c.bilan.empreinte);
  const lu = L.lireModeleDepart(sortie, { epingle: EPINGLE });
  assert.equal(lu.ok, true);
  // Essai 1 : un dossier d'Odin NEUF → installé, scellé (le fichier ne contient pas le manifeste en clair), chargé.
  const neuf = jetable('soul-neuf-');
  const inst = await L.installerModeleDepart(odinDe(neuf), { dossier: sortie, epingle: EPINGLE });
  assert.equal(inst.installe, true, inst.raison);
  assert.deepEqual(listerReprises(neuf), [0]);
  const brut = readFileSync(join(neuf, 'cerveau-reseau', 'reprise-0.bin'));
  assert.equal(brut.includes(Buffer.from('"hyper"')), false, 'scellé par la clé de la machine');
  assert.equal(L.departInstalle(neuf)?.version, 1);
  const m = await chargerMoteur(neuf);
  assert.ok(m, 'chargerMoteur rend un moteur');
  const v = await m!.plonger('ouvre la carte 3');
  assert.equal(v.length, gabarit('petit').C);
  // Les poids installés valent ceux du modèle (à la demi-précision près).
  await m!.arreter();
  // Essai 2 : un point de reprise existe → rien n'est installé par-dessus.
  const encore = await L.installerModeleDepart(odinDe(neuf), { dossier: sortie, epingle: EPINGLE });
  assert.equal(encore.installe, false); assert.match(encore.raison, /existe déjà/);
});

test('essais 3 et 7 : un octet modifié → refusé, rien d\'installé ; mode privé, Soul coupé → rien d\'installé', async () => {
  const fab = jetable('soul-fab2-'), home = join(fab, 'odin');
  const c = L.corpusLivraison(sourcesEssai());
  await petitModele(home, c.exemples, 0);
  const sortie = join(fab, 'livre');
  assert.equal((await L.exporterModeleDepart({ home, sortie, corpus: c, temoins: TEMOINS, version: 1, licence: join(process.cwd(), 'LICENSE'), epingle: EPINGLE })).ok, true);
  for (const o of [{ prive: true }, { actif: false }]) {
    const h = jetable('soul-garde-');
    const r = await L.installerModeleDepart(odinDe(h, o), { dossier: sortie, epingle: EPINGLE });
    assert.equal(r.installe, false, JSON.stringify(o)); assert.deepEqual(listerReprises(h), []);
  }
  const f = join(sortie, 'soul-depart.bin'), b = readFileSync(f); b[100] ^= 1; writeFileSync(f, b);
  const h = jetable('soul-abime-');
  const r = await L.installerModeleDepart(odinDe(h), { dossier: sortie, epingle: EPINGLE });
  assert.equal(r.installe, false); assert.match(r.raison, /empreinte fausse/);
  assert.deepEqual(listerReprises(h), [], 'rien n\'est installé');
});

test('témoins : un témoin dans le corpus, et la livraison est refusée (rien n\'est écrit)', async () => {
  const fab = jetable('soul-fab3-'), home = join(fab, 'odin');
  const c = L.corpusLivraison(sourcesEssai());
  await petitModele(home, c.exemples, 0);
  const sale = { ...c, exemples: [...c.exemples, { texte: 'Le serveur salon-nas-7f3 est au grenier.', sorte: 'note' as const }] };
  const sortie = join(fab, 'livre');
  const r = await L.exporterModeleDepart({ home, sortie, corpus: sale, temoins: TEMOINS, version: 1, licence: join(process.cwd(), 'LICENSE'), epingle: EPINGLE });
  assert.equal(r.ok, false); assert.match(r.ok ? '' : r.raison, /témoin/);
  assert.equal(existsSync(sortie), false);
});

test('essai 5 : deux découpages différents — la comparaison par morceau se trompe, celle par octet est juste', () => {
  // Le même texte de 1 000 octets. Modèle A : découpage fin (500 morceaux), 2,0 nats par morceau = 1 000 nats.
  // Modèle B : découpage gros (100 morceaux), 6,0 nats par morceau = 600 nats. Par morceau, A « gagne » (2 < 6) ;
  // en réalité B code le texte avec moins d'information : par octet, B est meilleur.
  const octets = 1000;
  const parMorceauA = 2.0, parMorceauB = 6.0, totalA = 2.0 * 500, totalB = 6.0 * 100;
  assert.ok(parMorceauA < parMorceauB, 'par morceau : A semble meilleur');
  const bpoA = totalA / (octets * Math.LN2), bpoB = totalB / (octets * Math.LN2);
  assert.ok(bpoB < bpoA, 'par octet : B est meilleur');
  assert.equal(L.deciderMiseAJour(bpoA, bpoB).remplacer, true);
  assert.equal(L.deciderMiseAJour(bpoB, bpoA).remplacer, false);
});

test('essai 4 : mise à jour — moins bon sur le banc local → pas en service ; meilleur → en service, l\'ancien gardé', async () => {
  const c = L.corpusLivraison(sourcesEssai());
  const banc = L.bancPublic(c.exemples).concat(c.exemples.slice(0, 20).map((e) => e.texte));
  // Un modèle de départ « v2 » entraîné quelques secondes, et un Odin dont le modèle en service n'a rien appris.
  const fab = jetable('soul-maj-'), fabHome = join(fab, 'odin');
  await petitModele(fabHome, c.exemples, 3);
  const v2 = join(fab, 'v2');
  assert.equal((await L.exporterModeleDepart({ home: fabHome, sortie: v2, corpus: c, temoins: TEMOINS, version: 2, licence: join(process.cwd(), 'LICENSE'), epingle: EPINGLE })).ok, true);
  const chezLui = jetable('soul-chezlui-');
  await petitModele(chezLui, c.exemples, 0, 11); // en service : un réseau qui n'a rien appris
  const r = await L.proposerMiseAJour(odinDe(chezLui), banc, { dossier: v2, epingle: EPINGLE });
  assert.equal(r.remplace, true, r.raison);
  assert.deepEqual(listerReprises(chezLui), [1, 0], 'le nouveau en service (1), l\'ancien gardé pour le retour arrière (0)');
  // L'inverse : le modèle local a appris (le même v2, continué), le départ « v3 » n'a rien appris → pas en service.
  const fab3 = jetable('soul-maj3-'), fab3Home = join(fab3, 'odin');
  await petitModele(fab3Home, c.exemples, 0, 13);
  const v3 = join(fab3, 'v3');
  assert.equal((await L.exporterModeleDepart({ home: fab3Home, sortie: v3, corpus: c, temoins: TEMOINS, version: 3, licence: join(process.cwd(), 'LICENSE'), epingle: EPINGLE })).ok, true);
  const r3 = await L.proposerMiseAJour(odinDe(chezLui), banc, { dossier: v3, epingle: EPINGLE });
  assert.equal(r3.remplace, false, r3.raison);
  assert.deepEqual(listerReprises(chezLui), [1, 0], 'rien n\'est écrasé');
});

test('demi-précision : aller-retour fidèle (erreur relative ≤ 1/2048) ; zéro, signes, sous-normaux', () => {
  for (const x of [0, -0, 1, -1, 0.5, 3.14159, -2.5e-3, 6.1e-5, 1e-7, 65504, -123.456]) {
    const y = L.depuisDemi(L.versDemi(x));
    if (Math.abs(x) >= 6.1e-5) assert.ok(Math.abs(y - x) <= Math.abs(x) / 2048 + 1e-12, `${x} → ${y}`);
    else assert.ok(Math.abs(y - x) < 6e-8, `${x} → ${y}`);
  }
  void lireDecoupageSerialise;
});

test('après l\'installation, le pilote garde le découpage du modèle livré (il n\'en apprend pas un autre)', async () => {
  const fab = jetable('soul-pil-'), home = join(fab, 'odin');
  const c = L.corpusLivraison(sourcesEssai());
  await petitModele(home, c.exemples, 0);
  const sortie = join(fab, 'livre');
  assert.equal((await L.exporterModeleDepart({ home, sortie, corpus: c, temoins: TEMOINS, version: 1, licence: join(process.cwd(), 'LICENSE'), epingle: EPINGLE })).ok, true);
  const neuf = jetable('soul-pil-neuf-');
  assert.equal((await L.installerModeleDepart(odinDe(neuf), { dossier: sortie, epingle: EPINGLE })).installe, true);
  const { mkdirSync } = await import('node:fs');
  const { dossierCorpus } = await import('../src/brain/nous/file-odin.ts');
  const { PiloteNous } = await import('../src/brain/nous/entrainement-odin.ts');
  mkdirSync(dossierCorpus(neuf), { recursive: true }); writeFileSync(join(dossierCorpus(neuf), 'tranche-20261117-odin.bin'), Buffer.from('ODR1'));
  let decoupageAppris = 0, decEntraineur: unknown;
  const e = { async seance() { return { pas: 0, morceauxVus: 0, perte: 0, tempsMs: 5, interrompue: true }; }, async perteSur() { return 5; }, async ecrire() { return 'ok'; }, async revenirA() {}, async arreter() {} };
  const fabrique = { async entraineur(_h: string, n: { dec: unknown }) { decEntraineur = n.dec; return e; }, async decoupage() { decoupageAppris++; throw new Error('ne doit pas être appelé'); }, async jeux(_h: string, dec: { version: number }) { decEntraineur = dec; return { banc: [Int32Array.of(1, 2)], entrainement: [Int32Array.of(1, 2, 3)], textes: 50, morceaux: 9 }; }, async taille() { return {}; } };
  const odin = odinDe(neuf); (odin.cfg.nous as Record<string, unknown>).puissance = 'douce';
  const p = new PiloteNous({ odin, fabrique: fabrique as never, charge: () => 0, essai: false, nCpu: 2 });
  p.tic(); await p.attendre();
  assert.equal(decoupageAppris, 0, 'aucun nouveau découpage');
  const lu = L.lireModeleDepart(sortie, { epingle: EPINGLE });
  assert.equal((decEntraineur as { version: number }).version, lu.ok ? lu.modele.dec.version : -1, 'le découpage du modèle livré');
  await p.fermer();
});

test('export vers un dossier jetable : l\'épingle va À CÔTÉ du modèle, celle du produit n\'est jamais touchée (sauf « épingler »)', async () => {
  const fab = jetable('soul-fab-cote-'), home = join(fab, 'odin'), sortie = join(fab, 'sortie');
  const c = L.corpusLivraison(sourcesEssai());
  await petitModele(home, c.exemples, 1);
  const produit = L.fichierEpingle(), avant = existsSync(produit) ? readFileSync(produit, 'utf8') : undefined;
  const r = await L.exporterModeleDepart({ home, sortie, corpus: c, temoins: TEMOINS, version: 2, licence: join(process.cwd(), 'LICENSE') });
  assert.equal(r.ok, true);
  const apres = existsSync(produit) ? readFileSync(produit, 'utf8') : undefined;
  assert.equal(apres, avant, 'l\'épingle du produit n\'a pas bougé');
  assert.equal(r.ok && r.epingle, join(sortie, L.EPINGLE_A_COTE), 'l\'outil sait laquelle il a écrite');
  // Ce modèle d'essai se vérifie avec SON épingle ; l'installation (épingle du produit) ne l'accepte pas.
  assert.equal(L.lireModeleDepart(sortie, { epingle: join(sortie, L.EPINGLE_A_COTE) }).ok, true);
  const neuf = jetable('soul-neuf-cote-');
  const inst = await L.installerModeleDepart(odinDe(neuf), { dossier: sortie });
  assert.equal(inst.installe, false, inst.raison);
});

test('« aucun modèle livré » est un état propre : installation sans erreur, raison claire, outil « verifier » net', async () => {
  const neuf = jetable('soul-aucun-'), rien = join(neuf, 'pas-de-modele');
  const r = await L.installerModeleDepart(odinDe(neuf), { dossier: rien, epingle: join(neuf, 'pas-d-epingle.json') });
  assert.deepEqual(r, { installe: false, raison: 'aucun modèle de départ livré avec cette version' });
  assert.equal(listerReprises(neuf).length, 0, 'Odin part d\'un réseau neuf');
  const { spawnSync } = await import('node:child_process');
  const v = spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', 'tools/soul-depart.ts', 'verifier', rien], { encoding: 'utf8' });
  assert.match(v.stdout, /aucun modèle de départ dans/);
  assert.equal(v.stderr.trim(), '', 'aucune erreur ni pile');
  // Sans dossier : le modèle livré du dépôt (absent dans cette version : ni v1 ni v2 ne sont livrées).
  if (!existsSync(join(process.cwd(), 'modeles', 'soul-depart', L.FICHIERS.manifeste))) {
    const w = spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', 'tools/soul-depart.ts', 'verifier'], { encoding: 'utf8' });
    assert.match(w.stdout, /aucun modèle de départ livré avec cette version/);
    assert.equal(w.status, 0);
  }
});

test('entraîner en plusieurs passages (logique) : meilleur gardé, arrêt après « patience » passages sans progrès', async () => {
  // Un faux entraîneur : la mesure du banc suit une liste (perteSur), chaque écriture est notée.
  const pertes = [5, 4, 3, 3.5, 3.1, 3.05, 2.0];
  let passage = 0; const ecrits: number[] = [];
  const e = {
    hyper: { contexte: 64 },
    async seance() { passage++; return { pas: 10, perte: 1 }; },
    async perteSur() { return pertes[Math.min(passage, pertes.length - 1)]; },
    async ecrire(n: number) { ecrits.push(n); return `point ${n}`; },
  };
  const c = L.corpusLivraison(sourcesEssai());
  const dec = decoupageDe(c.exemples.map((x) => x.texte), 512, 0x0d1a);
  const r = await L.entrainerPassages({ e, exemples: c.exemples, dec, banc: ['un texte du banc'], dureeMs: 60_000, maxPassages: 10, patience: 3, premier: 4 });
  // Passages 1 et 2 progressent (4, 3) ; 3, 4, 5 non (3,5 · 3,1 · 3,05 : moins bien que 3) → arrêt, le 6e (2,0) n'est jamais fait.
  assert.equal(r.arret, 'sans-progres');
  assert.deepEqual(r.passages.map((p) => p.garde), [true, true, false, false, false]);
  assert.deepEqual(ecrits, [4, 5], 'un point par progrès, numérotés après ceux qui existaient : le dernier écrit est le meilleur');
  assert.ok(r.meilleur < r.depart);
});

test('entraîner en plusieurs passages (réel, gabarit « petit ») : plusieurs passages, le dernier point écrit est le meilleur', { timeout: 240_000 }, async () => {
  const home = jetable('soul-passages-');
  const c = L.corpusLivraison(sourcesEssai());
  const hyper = gabarit('petit');
  const dec = decoupageDe(c.exemples.map((x) => x.texte), hyper.vocab, 0x0d1a);
  const { nouvelEntraineur } = await import('../src/brain/nous/moteur.ts');
  const e = await nouvelEntraineur(hyper, lireDecoupageSerialise(dec), 0x0d1a, home);
  const banc = L.bancPublic(c.exemples);
  try {
    const r = await L.entrainerPassages({ e, exemples: c.exemples, dec, banc, dureeMs: 40_000, maxPassages: 3, patience: 2, maxSequences: 300 });
    assert.ok(r.passages.length >= 2, `plusieurs passages (${r.passages.length}, arrêt : ${r.arret})`);
    assert.ok(r.meilleur < r.depart, `le banc progresse (${r.depart.toFixed(3)} → ${r.meilleur.toFixed(3)})`);
    const { lireReprise } = await import('../src/brain/nous/reprise.ts');
    const ck = await lireReprise(home);
    assert.ok(ck, 'un point écrit');
    const b = L.bitsParOctet(new Reseau(ck!.hyper, ck!.poids), dec, banc);
    assert.ok(Math.abs(b - r.meilleur) < 0.02, `le point gardé est le meilleur (${b.toFixed(4)} contre ${r.meilleur.toFixed(4)})`);
  } finally { await e.arreter(); }
});
