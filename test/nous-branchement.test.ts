// Noûs branché dans Odin, étapes 1 à 3 : la file UNIQUE et son lecteur (corpus chiffré, borné), la route d'état honnête
// et ses réglages, le PREMIER CORPUS fabriqué par Odin lui-même. Faux Odin, aucun calcul de réseau, aucune charge.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readdirSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileNousOdin, depsNousOdin, viderVersCorpus, dossierCorpus, magasinDisque, scellageMachine, tailleCorpus, etatCorpus, type OdinPourNous } from '../src/brain/nous/file-odin.ts';
import { fabriquerDepart, departFait, DEMANDES_EXEMPLES, type SourcesDepart } from '../src/brain/nous/corpus-depart.ts';
import { faireDepart, faireDepartParLots, tacheNous, oublierTacheNous } from '../src/brain/nous/tache-odin.ts';
import { lireTranche } from '../src/brain/nous/corpus.ts';
import { nourrir } from '../src/brain/nous/entree.ts';
import { fileBornee, type NoosDeps } from '../src/brain/nous/deps.ts';
import { nousEtat, nousPost, oublierCacheNous } from '../src/web/nous-api.ts';
import { fileNousMathesis } from '../src/valhalla/mathesis/branchement.ts';
import { fileNousPronoia } from '../src/valhalla/pronoia/branchement.ts';

const homes: string[] = [];
after(() => { fileNousOdin.vider(); for (const h of homes) rmSync(h, { recursive: true, force: true }); });
function faux(o: { actif?: boolean; prive?: boolean; demo?: boolean; disqueMaxMo?: number; corpusDepart?: string } = {}): OdinPourNous & { cfg: Record<string, unknown> & OdinPourNous['cfg']; paths: { home: string; config: string } } {
  const home = mkdtempSync(join(tmpdir(), 'nous-')); homes.push(home);
  return { cfg: { learning: { observe: true }, nous: { actif: o.actif ?? true, disqueMaxMo: o.disqueMaxMo ?? 2000, corpusDepart: o.corpusDepart ?? 'odin', heuresNuit: 8, filsNuit: 3 }, voice: { privacy: { privateMode: o.prive ?? false } } }, demo: o.demo ?? false, paths: { home, config: join(home, 'config.json') } } as never;
}
/** Le texte de tous les exemples du corpus (déchiffrés, octets → texte). */
function lireCorpus(home: string): string[] {
  const dir = dossierCorpus(home), m = magasinDisque(dir), s = scellageMachine(home)!;
  return m.lister().flatMap((nom) => lireTranche(m.lire(nom), s).map((e) => Buffer.from(Array.from(e.morceaux, (x) => x - 8)).toString('utf8')));
}
const depsEssai = (odin: OdinPourNous, file = fileBornee(60_000)): NoosDeps => ({ ...depsNousOdin(odin), essai: false, file });

test('étape 1 : UNE file, donnée à Mathésis et à Prónoia (et à Archytas par odin.ts)', () => {
  assert.equal(fileNousMathesis, fileNousOdin);
  assert.equal(fileNousPronoia, fileNousOdin);
  const odin = faux();
  fileNousOdin.vider();
  nourrir({ ...depsNousOdin(odin), essai: false }, { sorte: 'note', texte: 'Le compost se retourne chaque mois.', source: 'mathesis:page', fiable: true });
  assert.equal(fileNousOdin.taille(), 1);
  fileNousOdin.vider();
});

test('étape 1 : le lecteur range la file dans le corpus — chiffré, sans doublon, par source ; ce que ça coûte', () => {
  const odin = faux(), file = fileBornee(10_000);
  const d = depsEssai(odin, file);
  for (let i = 0; i < 300; i++) nourrir(d, { sorte: 'note', texte: `Fait numéro ${i % 200} : le lagon de Mayotte abrite des tortues vertes et des dugongs, une phrase ordinaire.`, source: i % 2 ? 'mathesis:page' : 'pronoia:evenement', fiable: true });
  const b = viderVersCorpus(odin, { file });
  assert.equal(b.pris, 300); assert.equal(b.raison, undefined);
  assert.equal(b.ecrits, 200, 'les doublons sont retirés');
  const dir = dossierCorpus(odin.paths.home);
  for (const f of readdirSync(dir)) assert.doesNotMatch(readFileSync(join(dir, f)).toString('latin1'), /lagon|tortues/, 'rien en clair sur le disque');
  assert.ok(lireCorpus(odin.paths.home).some((t) => t.startsWith('Fait numéro 7 : le lagon')), 'relu à l\'identique');
  assert.deepEqual(readdirSync(dir).map((n) => n.replace(/^tranche-\d{8}-/, '')).sort(), ['mathesis.bin', 'pronoia.bin']);
  console.log(`# mesuré : 300 exemples rangés en ${b.ms} ms (${Math.round(tailleCorpus(dir) / 1024)} Ko sur le disque)`);
});

test('étape 1 : borné par « disqueMaxMo » ; rien si Noûs est coupé, en mode privé ou en démonstration', () => {
  const plein = faux({ disqueMaxMo: 1 }), f1 = fileBornee(10_000);
  const d = depsEssai(plein, f1);
  const raisons: string[] = [];
  for (let k = 0; k < 6; k++) {
    for (let i = 0; i < 400; i++) nourrir(d, { sorte: 'lecture', texte: `${k}-${i} ${Array.from({ length: 600 }, () => String.fromCharCode(97 + Math.floor(Math.random() * 26))).join('')}`, source: `essai${k}`, fiable: false });
    raisons.push(viderVersCorpus(plein, { file: f1, max: 2000 }).raison ?? '');
  }
  // L'estimation (4 octets par morceau, avant compression) est prudente : le disque reste SOUS le plafond.
  const t = tailleCorpus(dossierCorpus(plein.paths.home));
  assert.ok(t <= 1024 * 1024, `${t} octets pour 1 Mo permis`);
  assert.ok(raisons.some((r) => /corpus plein/.test(r)), 'le surplus est refusé et c\'est dit');
  for (const [nom, odin] of [['coupé', faux({ actif: false })], ['privé', faux({ prive: true })], ['démo', faux({ demo: true })]] as const) {
    const f = fileBornee(100);
    f.pousser({ sorte: 'note', texte: 'quelque chose', demande: '', reponse: '', source: 'x', fiable: true, at: Date.now() });
    const b = viderVersCorpus(odin, { file: f });
    assert.equal(b.ecrits, 0, nom); assert.equal(f.taille(), 0, `${nom} : la file est vidée sans rien garder`);
    assert.equal(existsSync(dossierCorpus(odin.paths.home)), false, `${nom} : aucun corpus créé`);
  }
});

test('étape 2 : la route d\'état est honnête ; pause et réglages vont dans la configuration ; l\'essai dit « pas encore de modèle »', () => {
  oublierCacheNous();
  const odin = faux();
  const e = nousEtat(odin as never) as Record<string, any>;
  assert.equal(e.ok, true); assert.equal(e.entraine, false); assert.match(e.message, /pas encore de point de reprise/);
  assert.equal(e.travail, null, 'aucune part « 80 / 20 » affichée comme une mesure');
  assert.deepEqual(e.duels, { joues: 0, gagnes: 0, egalites: 0, apres: 0 });
  assert.equal(e.depart.choix, 'odin'); assert.equal(e.depart.fait, false);
  assert.deepEqual(nousPost(odin as never, '/api/brain/nous/pause', { actif: false }), { ok: true, actif: false });
  assert.equal((odin.cfg.nous as Record<string, unknown>).actif, false);
  assert.match(readFileSync(odin.paths.config, 'utf8'), /"actif": false/);
  const r = nousPost(odin as never, '/api/brain/nous/reglages', { heuresNuit: 99, filsNuit: 2, disqueMaxMo: 10, corpusDepart: 'memoire' }) as Record<string, any>;
  assert.deepEqual(r.reglages, { heuresNuit: 12, filsNuit: 2, disqueMaxMo: 50, corpusDepart: 'memoire', puissance: 'pleine' }, 'valeurs bornées');
  assert.equal((nousPost(odin as never, '/api/brain/nous/reglages', { corpusDepart: 'n-importe' }) as Record<string, unknown>).ok, false);
  assert.match(String((nousPost(odin as never, '/api/brain/nous/essai', { texte: 'bonjour' }) as Record<string, unknown>).text), /Pas encore de modèle/);
  assert.equal(nousPost(odin as never, '/api/brain/nous/inconnu', {}), undefined);
});

const SOURCES: SourcesDepart = {
  modules: [
    { id: 'gjoll', name: 'Vortex', what: 'Le VPN de la maison.', does: ['un tunnel chiffré'], words: ['vpn'], actions: [{ id: 'appareils', label: 'Appareils VPN', what: 'Les appareils du VPN et leur dernière connexion', words: ['qui est sur le vpn', 'appareils vpn'] }] },
    { id: 'freyja', name: 'Vénus', what: 'Les films et séries.', actions: [{ id: 'regarder', label: 'Regarder', what: 'Film, série ou chaîne', words: ['mets le film', 'regarde la serie'] }] },
    { id: 'eitri', name: 'Andromède', what: 'Les ISO.', actions: [{ id: 'envoyer_hydre', label: 'Envoyer à Hydre', what: 'ISO vers une VM' }] },
  ],
  liens: [{ from: 'gjoll', to: 'garmr', when: 'le VPN s\'allume', does: 'son port est ouvert' }],
  usages: [{ need: 'regarder un film', chain: ['freyja'], why: 'Vénus les range.' }],
  survol: { freyja: { phrase: 'Tes films.', faire: ['Regarder un film'] } },
  competences: [{ name: 'meteo', description: 'Donne la météo du jour.' }],
  notes: () => [{ title: 'Recette', body: 'Le rougail saucisse : saucisses, tomates, oignons. Mot de passe: hunter2' }],
  souvenirs: () => [{ content: 'Le propriétaire se lève à 6 h.', origin: 'owner' }, { content: 'Texte d\'une page web inconnue', origin: 'untrusted' }],
};

test('étape 3 : le premier corpus part de ce qu\'Odin est — applis, liens, guide, compétences, notes, mémoire — et des paires demande → action', () => {
  const odin = faux();
  const file = fileBornee(60_000);
  const b = fabriquerDepart(odin.paths.home, depsEssai(odin, file), 'odin', SOURCES);
  assert.equal(b.raison, undefined);
  assert.ok(b.textes >= 8, `${b.textes} textes`);
  // Les demandes d'exemple (en plusieurs langues) dont l'appli et l'action existent dans ces fausses définitions.
  const resolues = DEMANDES_EXEMPLES.filter((ex) => SOURCES.modules!.some((m) => m.id === ex.module && (m.actions ?? []).some((x) => ex.action.test(x.id)))).length;
  assert.equal(b.paires, 4 + resolues, 'paires tirées des mots des actions (4) + demandes réelles résolues');
  assert.ok(b.nonResolues.includes('j\'ai branché une clé USB, démarre dessus'), 'pas de Genèse dans ces fausses définitions : dit, pas inventé');
  const tout = Array.from({ length: file.taille() }, () => file.prendre(1)[0]);
  const textes = tout.map((e) => `${e.texte}|${e.demande}|${e.reponse}`).join('\n');
  assert.match(textes, /L'appli Vortex \(gjoll\) : Le VPN de la maison\.[\s\S]*Appareils VPN/);
  assert.match(textes, /qui est connecté sur le VPN \?\|Vortex \(gjoll\) → Appareils VPN \(appareils\)/);
  assert.match(textes, /lance tel film\|Vénus \(freyja\) → Regarder \(regarder\)/);
  assert.match(textes, /Lien entre applis : gjoll → garmr/);
  assert.match(textes, /Compétence « meteo »/);
  assert.match(textes, /rougail saucisse/);
  assert.doesNotMatch(textes, /hunter2/, 'secret masqué par nourrir()');
  assert.doesNotMatch(textes, /page web inconnue/, 'un souvenir non fiable n\'entre pas');
  assert.equal(departFait(odin.paths.home).fait, false, 'pas encore « fait » : seulement après le rangement complet');
  assert.ok(DEMANDES_EXEMPLES.length >= 4, 'les demandes d\'exemple (en plusieurs langues depuis le 17/11)');
});

test('étape 3 : bout en bout jusqu\'au corpus chiffré ; « memoire » seulement ; rien en privé, coupé, ou sans choix', () => {
  oublierTacheNous();
  const odin = faux();
  const r = faireDepart(odin, SOURCES, { deps: depsEssai(odin) });
  assert.ok(r.vidage.ecrits > 10, JSON.stringify(r.vidage));
  const corpus = lireCorpus(odin.paths.home).join('\n');
  assert.match(corpus, /Vortex/); assert.doesNotMatch(corpus, /hunter2/);
  oublierCacheNous();
  const e = nousEtat(odin as never) as Record<string, any>;
  assert.ok(e.lu.total > 10); assert.equal(e.depart.fait, true);
  assert.ok(etatCorpus(odin.paths.home).parSource.some((x) => x.source === 'odin'));
  console.log(`# mesuré : premier corpus (${r.textes} textes, ${r.paires} paires) en ${r.ms} ms, rangé en ${r.vidage.ms} ms`);
  const mem = faux({ corpusDepart: 'memoire' }), fm = fileBornee(1000);
  const bm = fabriquerDepart(mem.paths.home, depsEssai(mem, fm), 'memoire', SOURCES);
  assert.equal(bm.paires, 0); assert.equal(bm.textes, 2, 'seulement la note et le souvenir fiable');
  for (const [nom, o, choix] of [['privé', faux({ prive: true }), 'odin'], ['coupé', faux({ actif: false }), 'odin'], ['demander', faux(), 'demander'], ['web', faux(), 'web']] as const) {
    const f = fileBornee(1000);
    const x = fabriquerDepart(o.paths.home, depsEssai(o, f), choix, SOURCES);
    assert.equal(f.taille(), 0, nom); assert.ok(x.raison, nom); assert.equal(departFait(o.paths.home).fait, false, nom);
  }
});

test('la tâche périodique : une fois toutes les 5 minutes ; Noûs coupé = rien du tout (aucun fichier, aucun premier corpus)', () => {
  oublierTacheNous();
  const coupe = faux({ actif: false });
  let appels = 0;
  tacheNous(coupe, 1_000_000, () => { appels++; return SOURCES; });
  assert.equal(appels, 0, 'les sources ne sont même pas lues');
  assert.equal(existsSync(join(coupe.paths.home, 'cerveau-reseau')), false, 'aucun fichier');
  const odin = faux();
  tacheNous(odin, 2_000_000, () => { appels++; return SOURCES; });
  tacheNous(odin, 2_000_000 + 60_000, () => { appels++; return SOURCES; });
  assert.equal(appels, 1, 'une seule fois dans les 5 minutes');
});

test('le premier corpus par petits lots : il rend la main à Odin entre chaque lot ; Noûs coupé en cours de route = le reste est jeté', async () => {
  oublierTacheNous();
  const odin = faux();
  const gros: SourcesDepart = { ...SOURCES, modules: Array.from({ length: 60 }, (_, i) => ({ id: `m${i}`, name: `Appli ${i}`, what: `Elle fait la chose numéro ${i}.`, actions: [{ id: 'a', label: `Action ${i}`, words: [`fais la chose ${i}`, `chose numero ${i}`] }] })) };
  const r = await faireDepartParLots(odin, gros, { deps: depsEssai(odin) });
  assert.ok(r.lots >= 2, `${r.lots} lots`); assert.ok(r.vidage.ecrits > 150);
  console.log(`# mesuré : ${r.lots} lots, pire lot ${r.pireLotMs} ms`);
  const coupe = faux();
  const p = faireDepartParLots(coupe, gros, { deps: depsEssai(coupe) });
  (coupe.cfg.nous as Record<string, unknown>).actif = false;
  const r2 = await p;
  assert.equal(r2.vidage.ecrits, 0, 'coupé avant le premier lot : rien écrit');
});
