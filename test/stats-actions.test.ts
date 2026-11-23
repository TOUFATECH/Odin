// Banc d'actions : les journaux (JSONL), les statistiques et les deux graphes, prouvés sur des cas calculés à la main et
// sur des journaux d'EXEMPLE fabriqués ici. Rien ne lit un jeu du banc ; rien ne sort de la machine ; tout s'écrit dans
// un sous-dossier du dossier temporaire, effacé à la fin.
//
// La seconde moitié du fichier rejoue des journaux RETOUCHÉS : chaque essai y montre une façon de faire dire au rapport
// plus que sa preuve, et vérifie que la conclusion est alors suspendue. Les retouches y sont faites « avec soin » (la
// chaîne des lignes est recalculée), pour que ce soit bien le contrôle visé qui arrête, pas seulement la chaîne.
import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, truncateSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Chaque pièce est chargée par l'essai qui la prouve : une pièce absente fait échouer ses essais, pas tout le fichier.
const J = () => import('./soul-banc/actions/journal.ts');
const S = () => import('./soul-banc/actions/stats.ts');
// @ts-expect-error script JavaScript sans types (il se lance aussi seul, par node)
const G = () => import('./soul-banc/actions/graphes.mjs');

const proche = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} ≠ ${b} (à ${eps} près)`);
const points = (x: number) => Math.round(x * 1000) / 10;   // 0,8565 → 85,6
/** Un dossier jetable, jamais à la racine du dossier temporaire : dans un sous-dossier à nous. Effacé à la fin, même après un échec. */
async function dansUnDossier<T>(f: (d: string) => T | Promise<T>): Promise<T> {
  const base = join(tmpdir(), 'odin-essais');
  mkdirSync(base, { recursive: true });
  const d = mkdtempSync(join(base, 'stats-actions-'));
  try { return await f(d); } finally { rmSync(d, { recursive: true, force: true }); }
}

// ------------------------------------------------------------------------------------------------ lignes d'exemple
// Les lignes du format, telles que le plan les donne (les « … » remplacés par des valeurs). La version et le maillon de
// la chaîne sont posés par l'écriture.
const H = (c: string) => `sha256:${c.repeat(64)}`;
const ORIGINE = '0'.repeat(12);
const ENTETE = { t: 'entete', run: 'B-3', variante: 'B', graine: 3, commit: '88998071c', banc_porte: H('a'), banc_cache: H('b'), monde: H('c'), episodes: H('d'), prevus: H('e'), reglages: { lot: 100, exploration: 3, porte: 'marge' }, debut: '2026-11-21T01:12:00Z' } as const;
const EPISODE = { t: 'episode', run: 'B-3', pas: 1287, passage: 2, ep: 'e7a1c2', competence: 'C3', langue: 'sw', perturbe: false, essais: 2, rang_retenu: 2, issue: 'reussi', r: 1, surete: 0, ms: 31, maj: { aiguilleur: 1, geste: 1, liens_plus: 2, liens_moins: 0, contre_ex: 0 } } as const;
const PORTE = { t: 'porte', run: 'B-3', pas: 1300, consultation: 13, en_service: { k: 301, n: 480 }, candidat: { k: 309, n: 480 }, diff_moy: 0.0167, et_diff: 0.0098, marge: 0.0098, surete_candidat: 0, decision: 'garde', ms: 11840 } as const;
const MESURE = { t: 'mesure', run: 'B-3', pas: 1300, banc: 'porte', global: { k: 309, n: 480 }, par_competence: { C1: { k: 61, n: 80 }, C2: { k: 70, n: 80 }, C3: { k: 48, n: 80 }, C4: { k: 12, n: 80 }, C5: { k: 38, n: 80 }, C6: { k: 80, n: 80 } }, surete: 0, seul_faux: { k: 2, n: 140 }, parmi3: { k: 402, n: 480 }, diversite: 1.92 } as const;
const SYSTEME = { t: 'systeme', run: 'B-3', pas: 1300, memoire_mo: 412, cpu_s: 388, charge: 0.21, pause: false } as const;
const FIN = { t: 'fin', run: 'B-3', pas: 3000, raison: 'pas-max', portes: { gardees: 19, refusees: 11 }, duree_s: 742 } as const;
const CLOTURE = { t: 'cloture', run: 'B-3', pas: 3000, scelle: 'a'.repeat(12) } as const;
/** Une ligne telle qu'elle est dans le fichier : avec sa version et un maillon. */
const ecrite = <T extends object>(l: T) => ({ v: 2, pr: ORIGINE, ...l });
type Brute = Record<string, any>;   // eslint-disable-line @typescript-eslint/no-explicit-any
const lignesDe = (chemin: string): Brute[] => readFileSync(chemin, 'utf8').trimEnd().split('\n').filter(Boolean).map((t) => JSON.parse(t) as Brute);
const sansChaine = (l: Brute): Brute => { const { v: _v, pr: _pr, ...reste } = l; return reste; };

// ------------------------------------------------------------------------------------------------ le journal
test('Journaux : les lignes du format s\'écrivent et se relisent à l\'identique, chacune dans son fichier', async () => {
  const { ouvrirJournal, ouvrirPortes, lireJournal, defautsLigne, defautsLigneDuBanc, empreinteLigne, VERSION } = await J();
  assert.equal(VERSION, 2);
  for (const l of [ENTETE, EPISODE, SYSTEME, FIN]) assert.deepEqual(defautsLigne(ecrite(l)), [], `ligne « ${l.t} » du journal refusée`);
  for (const l of [PORTE, MESURE, CLOTURE]) assert.deepEqual(defautsLigneDuBanc(ecrite(l)), [], `ligne « ${l.t} » du fichier de la porte refusée`);
  await dansUnDossier((d) => {
    const chemin = join(d, 'boucle', 'B-3', 'journal.jsonl');   // le dossier du run est créé au besoin
    const j = ouvrirJournal(chemin);
    for (const l of [ENTETE, EPISODE, SYSTEME, FIN]) assert.equal(j.ecrire(l), true);
    const sommet = j.sommet();
    j.fermer();
    const brut = readFileSync(chemin, 'utf8');
    assert.equal(brut.split('\n').length, 5, 'une ligne par événement, la dernière finie par un saut de ligne');
    for (const ligne of brut.trimEnd().split('\n')) assert.match(ligne, /^\{"v":2,"t":"[a-z]+","pr":"[0-9a-f]{12}",/, 'la version, la sorte, puis le maillon en tête de chaque ligne');
    const lu = lireJournal(chemin);
    assert.deepEqual(lu.lignes.map(sansChaine), [ENTETE, EPISODE, SYSTEME, FIN]);
    assert.deepEqual(sansChaine(lu.entete!), ENTETE); assert.deepEqual(sansChaine(lu.fin!), FIN);
    assert.equal(lu.termine, true); assert.equal(lu.coupe, false); assert.equal(lu.illisibles, 0); assert.equal(lu.ruptures, 0);
    assert.equal(lu.octets, statSync(chemin).size);
    // La chaîne : la première ligne part du maillon d'origine, chaque ligne porte l'empreinte de la précédente.
    const textes = brut.trimEnd().split('\n');
    assert.equal(lu.lignes[0].pr, ORIGINE);
    textes.slice(1).forEach((_, i) => assert.equal(lu.lignes[i + 1].pr, empreinteLigne(textes[i])));
    assert.equal(lu.sommet, empreinteLigne(textes[3])); assert.equal(sommet, lu.sommet);
    // Le fichier de la porte, côté banc : mesure, porte, mesure, puis la clôture.
    const f = ouvrirPortes(join(d, 'banc', 'B-3', 'porte.jsonl'));
    for (const l of [{ ...MESURE, pas: 1200, global: { k: 301, n: 480 }, par_competence: { ...MESURE.par_competence, C1: { k: 53, n: 80 } } }, PORTE, MESURE, CLOTURE]) assert.equal(f.ecrire(l), true);
    f.fermer();
    assert.deepEqual(lignesDe(join(d, 'banc', 'B-3', 'porte.jsonl')).map((l) => l.t), ['mesure', 'porte', 'mesure', 'cloture']);
  });
});

test('Journal : la version et le maillon sont posés seuls ; une ligne mal formée est refusée à l\'écriture', async () => {
  const { ouvrirJournal, ouvrirPortes, lireJournal } = await J();
  await dansUnDossier((d) => {
    const chemin = join(d, 'journal.jsonl');
    const j = ouvrirJournal(chemin);
    assert.equal(j.ecrire({ ...EPISODE, v: 7, pr: 'ffffffffffff' } as never), true, 'une version ou un maillon donnés par l\'appelant ne comptent pas');
    assert.throws(() => j.ecrire({ ...EPISODE, pas: 1288, r: 2 } as never), /r/, 'une récompense hors de −1, 0, +1');
    assert.throws(() => j.ecrire({ ...EPISODE, pas: -1 } as never), /pas/);
    assert.throws(() => j.ecrire({ ...EPISODE, t: 'autre' } as never), /sorte/);
    assert.throws(() => j.ecrire({ ...EPISODE, pas: 1288, ms: Number.NaN } as never), /ms/);
    j.fermer();
    assert.throws(() => j.ecrire({ ...EPISODE, pas: 1289 }), /fermé/);
    const lu = lireJournal(chemin);
    assert.deepEqual(lu.lignes.map(sansChaine), [EPISODE], 'aucune ligne refusée n\'a laissé de trace');
    assert.equal(lu.lignes[0].v, 2); assert.equal(lu.lignes[0].pr, ORIGINE);
    const f = ouvrirPortes(join(d, 'porte.jsonl'));
    assert.throws(() => f.ecrire({ ...PORTE, decision: 'peut-etre' } as never), /decision/);
    assert.throws(() => f.ecrire({ ...PORTE, candidat: { k: 500, n: 480 } } as never), /candidat/, 'plus de réussites que d\'épisodes');
    assert.throws(() => f.ecrire({ ...MESURE, banc: 'cache' } as never), /scellé/, 'le banc caché ne va jamais dans le fichier de la porte');
    assert.throws(() => f.ecrire({ ...MESURE, surete: undefined } as never), /surete/, 'une mesure dit toujours ses fautes de sûreté');
    f.fermer();
  });
});

test('Journal : aucune phrase ne passe — listes fermées, jetons de deux mots au plus', async () => {
  const { defautsLigne, defautsLigneDuBanc, empreinteCourte, ISSUES, RAISONS } = await J();
  const refuse = (l: object, quoi: string) => assert.notDeepEqual(defautsLigne(ecrite(l)), [], quoi);
  refuse({ ...EPISODE, phrase: 'allume la lumière du salon' }, 'un champ de texte inconnu');
  refuse({ ...EPISODE, ep: 'allume la lumière' }, 'un épisode désigné par sa phrase');
  refuse({ ...EPISODE, issue: 'il a dit avoir allumé la lampe' }, 'une issue en toutes lettres');
  refuse({ ...EPISODE, langue: 'français de France' }, 'une langue en toutes lettres');
  refuse({ ...ENTETE, reglages: { note: 'appelle le plombier demain' } }, 'une phrase dans les réglages');
  refuse({ ...ENTETE, reglages: { 'une clé avec des mots': 1 } }, 'une phrase dans le nom d\'un réglage');
  refuse({ ...FIN, raison: 'la machine était trop chargée ce soir' }, 'une raison en toutes lettres');
  refuse({ ...EPISODE, maj: { ...EPISODE.maj, detail: 'note Artisans' } }, 'du texte dans les mises à jour');
  // Une demande écrite sans espace ne passe pas non plus : l'issue et la raison viennent d'une liste fermée, les noms
  // des mises à jour aussi, et un réglage en texte tient en deux mots.
  refuse({ ...EPISODE, issue: 'allume-la-lumiere-du-salon' }, 'une demande à tirets dans l\'issue');
  refuse({ ...FIN, raison: 'appelle-le-plombier-demain' }, 'une demande à tirets dans la raison');
  refuse({ ...ENTETE, reglages: { note: 'appelle_le_plombier_au_0612345678' } }, 'une demande à traits bas dans un réglage');
  refuse({ ...ENTETE, reglages: { a: Array.from({ length: 64 }, (_, i) => `mot${i}`) } }, 'une longue liste de mots dans un réglage');
  refuse({ ...EPISODE, maj: { ouvre_les_volets_du_salon: 1 } }, 'une demande dans le nom d\'une mise à jour');
  refuse({ ...EPISODE, eteins_le_chauffage_de_la_chambre: 1 }, 'une demande dans le nom d\'un champ en plus');
  for (const issue of ISSUES) assert.ok(typeof issue === 'string' && issue.length <= 8);
  assert.deepEqual(defautsLigne(ecrite({ ...EPISODE, issue: 'succes' })), [], 'le mot du vérificateur');
  for (const raison of RAISONS) assert.deepEqual(defautsLigne(ecrite({ ...FIN, raison })), [], `raison ${raison}`);
  assert.notDeepEqual(defautsLigneDuBanc(ecrite({ ...MESURE, par_competence: { 'comprendre la demande': { k: 1, n: 2 } } })), [], 'un nom de compétence en toutes lettres');
  // Un champ en plus ne passe que s'il ne peut pas porter de texte : un nombre, vrai / faux, ou un objet de nombres.
  assert.deepEqual(defautsLigne(ecrite({ ...EPISODE, essais_max: 3, explore: true })), []);
  assert.deepEqual(defautsLigneDuBanc(ecrite({ ...MESURE, tenues: { k: 12, n: 40 } })), []);
  assert.notDeepEqual(defautsLigneDuBanc(ecrite({ ...MESURE, extra: { texte: 'bonjour' } })), [], 'du texte dans un objet en plus');
  // L'empreinte courte : stable, en hexadécimal, sans rien de la phrase.
  const e = empreinteCourte('allume la lumière du salon');
  assert.match(e, /^[0-9a-f]{12}$/);
  assert.equal(e, empreinteCourte('allume la lumière du salon'));
  assert.notEqual(e, empreinteCourte('allume la lumière du salon '));
  assert.deepEqual(defautsLigne(ecrite({ ...EPISODE, ep: e })), []);
});

test('Journal : taille bornée — les épisodes s\'arrêtent d\'abord, la dernière ligne passe toujours, jamais au-delà', async () => {
  const { ouvrirJournal, ouvrirPortes, lireJournal } = await J();
  await dansUnDossier((d) => {
    const chemin = join(d, 'journal.jsonl');
    const max = 6000, reserve = 2000;
    const j = ouvrirJournal(chemin, { maxOctets: max, reserve });
    assert.equal(j.ecrire(ENTETE), true);
    let ecrites = 0;
    for (let i = 1; i <= 100; i++) if (j.ecrire({ ...EPISODE, pas: i })) ecrites++;
    assert.ok(ecrites > 3 && ecrites < 100, `des épisodes écrits puis plus (${ecrites})`);
    assert.ok(statSync(chemin).size <= max - reserve, 'les épisodes laissent la réserve libre');
    let systemes = 0;
    for (let i = 0; i < 50; i++) if (j.ecrire({ ...SYSTEME, pas: 100 })) systemes++;
    assert.ok(systemes < 50, 'les lignes « systeme » ne prennent pas la réserve non plus');
    assert.ok(statSync(chemin).size <= max - reserve);
    assert.deepEqual(j.omises(), { episode: 100 - ecrites, systeme: 50 - systemes });
    assert.equal(j.ecrire(FIN), true);
    assert.ok(j.octets() <= max); assert.equal(statSync(chemin).size, j.octets());
    j.fermer();
    const lu = lireJournal(chemin);
    assert.equal(lu.illisibles, 0); assert.equal(lu.ruptures, 0);
    assert.equal(lu.lignes.filter((l) => l.t === 'episode').length, ecrites);
    assert.deepEqual(lu.omises, { episode: 100 - ecrites, systeme: 50 - systemes }, 'la ligne « fin » dit ce qui n\'a pas été écrit');
    // Le fichier de la porte rempli jusqu'au bord par des lignes de porte : la clôture a sa propre réserve et passe
    // encore, avec le compte de ce qui manque. Sans elle, le run resterait « pas fini » pour toujours.
    const cp = join(d, 'porte.jsonl');
    const f = ouvrirPortes(cp, { maxOctets: 4000 });
    let portes = 0;
    for (let i = 1; i <= 100; i++) if (f.ecrire({ ...PORTE, pas: 100 * i, consultation: i })) portes++;
    assert.ok(portes > 3 && portes < 100);
    assert.equal(f.ecrire(CLOTURE), true, 'la dernière ligne passe toujours');
    assert.ok(statSync(cp).size <= 4000);
    f.fermer();
    const derniere = lignesDe(cp).at(-1)!;
    assert.equal(derniere.t, 'cloture'); assert.deepEqual(derniere.omises, { porte: 100 - portes });
    // Reprise sur un fichier coupé ET déjà à la borne : le saut de ligne de reprise compte ; rien n'est ajouté.
    const plein = join(d, 'plein.jsonl');
    writeFileSync(plein, 'x'.repeat(3000));
    const r = ouvrirJournal(plein, { maxOctets: 3000, reserve: 0 });
    assert.equal(r.ecrire({ ...EPISODE, pas: 1 }), false);
    r.fermer();
    assert.equal(statSync(plein).size, 3000, 'pas un octet au-delà de la borne');
    // Une ligne plus longue que la borne d'une ligne est une erreur de forme, pas un manque de place.
    const k = ouvrirJournal(join(d, 'petit.jsonl'), { maxLigne: 200 });
    assert.throws(() => k.ecrire(ENTETE), /trop longue/);
    k.fermer();
  });
});

test('Journal : coupé au milieu, il se relit sans erreur ; la reprise continue la chaîne, sans second en-tête ni pas rejoué', async () => {
  const { ouvrirJournal, lireJournal } = await J();
  await dansUnDossier((d) => {
    const chemin = join(d, 'journal.jsonl');
    const j = ouvrirJournal(chemin);
    j.ecrire(ENTETE);
    for (let i = 1; i <= 5; i++) j.ecrire({ ...EPISODE, pas: i });
    j.ecrire({ ...SYSTEME, pas: 5 });
    j.fermer();
    const entier = readFileSync(chemin);
    // Coupé à N'IMPORTE QUEL octet (chaque octet des 300 derniers, un sur 13 avant) : jamais d'erreur, et exactement
    // les lignes entières d'avant la coupure.
    for (let n = 0; n <= entier.length; n += (n < entier.length - 300 ? 13 : 1)) {
      writeFileSync(chemin, entier.subarray(0, n));
      const lu = lireJournal(chemin);
      const entieres = entier.subarray(0, n).toString('latin1').split('\n').length - 1;
      const reste = n - (entier.subarray(0, n).lastIndexOf(0x0a) + 1);
      // Une dernière ligne complète à laquelle il ne manque que le saut de ligne est gardée.
      const derniereComplete = reste > 0 && entier[n] === 0x0a;
      assert.equal(lu.lignes.length, entieres + (derniereComplete ? 1 : 0), `coupé à ${n} octets`);
      assert.equal(lu.coupe, reste > 0 && !derniereComplete, `coupé à ${n} octets : drapeau « coupé »`);
      assert.equal(lu.termine, false); assert.equal(lu.ruptures, 0, 'une coupure n\'est pas une retouche');
    }
    // La coupure du milieu de la dernière ligne, puis la reprise.
    writeFileSync(chemin, entier);
    truncateSync(chemin, entier.length - 25);
    const coupe = lireJournal(chemin);
    assert.equal(coupe.lignes.length, 6); assert.equal(coupe.coupe, true); assert.equal(coupe.illisibles, 1);
    assert.equal(coupe.defauts.length, 1);
    const k = ouvrirJournal(chemin);   // reprise : ajout seul
    assert.throws(() => k.ecrire(ENTETE), /déjà son en-tête/, 'une reprise n\'écrit pas un second en-tête');
    assert.throws(() => k.ecrire({ ...EPISODE, pas: 3 }), /ne se rejoue pas/, 'une reprise ne repart pas d\'un pas déjà joué');
    k.ecrire({ ...EPISODE, pas: 6 }); k.ecrire(FIN);
    assert.throws(() => k.ecrire({ ...EPISODE, pas: 7 }), /clos/, 'plus rien après la ligne « fin »');
    k.fermer();
    const repris = lireJournal(chemin);
    assert.equal(repris.lignes.length, 8, 'les six d\'avant, puis l\'épisode et la fin');
    assert.equal(repris.illisibles, 1, 'la ligne cassée reste seule sur sa ligne');
    assert.equal(repris.coupe, false); assert.equal(repris.termine, true);
    assert.equal(repris.ruptures, 0, 'la reprise continue la chaîne depuis la dernière ligne entière');
    const fini = ouvrirJournal(chemin);
    try { assert.throws(() => fini.ecrire({ ...EPISODE, pas: 9 }), /clos/, 'un journal fini ne se rouvre pas pour écrire'); } finally { fini.fermer(); }
    // Du bruit au milieu (ligne vide, texte, autre version, autre run) est sauté et compté.
    writeFileSync(chemin, [JSON.stringify(ecrite(ENTETE)), '', 'pas du JSON', JSON.stringify({ ...ecrite(EPISODE), v: 1 }), JSON.stringify(ecrite({ ...EPISODE, run: 'A-1' })), JSON.stringify(ecrite(EPISODE)), JSON.stringify(ecrite(FIN))].join('\r\n') + '\r\n');
    const bruit = lireJournal(chemin);
    assert.equal(bruit.lignes.length, 3); assert.equal(bruit.illisibles, 3); assert.equal(bruit.termine, true);
    assert.ok(bruit.defauts.some((x) => /version/.test(x)) && bruit.defauts.some((x) => /autre run/.test(x)));
  });
});

test('Journal : chaque ligne est chaînée à la précédente — une ligne retouchée, retirée, ou un second écrivain se voient', async () => {
  const { ouvrirJournal, lireJournal } = await J();
  await dansUnDossier((d) => {
    const chemin = join(d, 'journal.jsonl');
    const j = ouvrirJournal(chemin);
    j.ecrire(ENTETE);
    for (let i = 1; i <= 6; i++) j.ecrire({ ...EPISODE, pas: i });
    j.ecrire(FIN);
    j.fermer();
    const net = readFileSync(chemin, 'utf8'), textes = net.trimEnd().split('\n');
    assert.equal(lireJournal(chemin).ruptures, 0);
    // Une ligne retouchée (un épisode raté devient réussi, une durée change…) : la ligne suivante ne la reconnaît plus.
    writeFileSync(chemin, net.replace('"pas":3,"passage":2', '"pas":3,"passage":1'));
    const retouche = lireJournal(chemin);
    assert.equal(retouche.ruptures, 1); assert.equal(retouche.lignes.length, 8, 'les lignes sont gardées, la retouche est comptée');
    assert.ok(retouche.defauts.some((x) => /chaîne est rompue/.test(x)));
    // Une ligne retirée.
    writeFileSync(chemin, [...textes.slice(0, 3), ...textes.slice(4)].join('\n') + '\n');
    assert.equal(lireJournal(chemin).ruptures, 1);
    // Une ligne ajoutée au milieu, sans connaître la chaîne.
    writeFileSync(chemin, [...textes.slice(0, 3), JSON.stringify(ecrite({ ...EPISODE, pas: 50 })), ...textes.slice(3)].join('\n') + '\n');
    assert.ok(lireJournal(chemin).ruptures >= 1);
    // Deux écrivains sur le même fichier : chacun continue sa propre chaîne, et la lecture le voit.
    const commun = join(d, 'commun.jsonl');
    const a = ouvrirJournal(commun), b = ouvrirJournal(commun);
    a.ecrire(ENTETE); a.ecrire({ ...EPISODE, pas: 1 }); b.ecrire({ ...EPISODE, pas: 2 }); a.ecrire({ ...EPISODE, pas: 3 });
    a.fermer(); b.fermer();
    const deux = lireJournal(commun);
    assert.equal(deux.illisibles, 0, 'aucune ligne n\'est mêlée à une autre'); assert.ok(deux.ruptures >= 1, 'un seul écrivain par fichier : le second se voit');
  });
});

test('La boucle ne peut rien lire du banc : ses lignes ne portent aucun compte, et les deux racines sont séparées', async () => {
  const { ouvrirJournal, ouvrirPortes, lireJournal, lireRuns, interditALaBoucle, FICHIERS_DU_BANC } = await J();
  const g = await G();
  await dansUnDossier((d) => {
    // 1. Le journal de la boucle refuse les lignes qui portent les comptes du banc de porte.
    const j = ouvrirJournal(join(d, 'j', 'journal.jsonl'));
    assert.throws(() => j.ecrire(PORTE as never), /fichier du banc/);
    assert.throws(() => j.ecrire(MESURE as never), /fichier du banc/);
    assert.throws(() => j.ecrire({ ...EPISODE, par_competence: { C1: { k: 61, n: 80 } } } as never), /par_competence/, 'pas même dans un champ en plus');
    j.fermer();
    const f = ouvrirPortes(join(d, 'p', 'porte.jsonl'));
    assert.throws(() => f.ecrire(EPISODE as never), /sorte/);
    f.fermer();
    // 2. Après un entraînement complet, rien de ce que la boucle peut atteindre depuis son journal ne parle du banc :
    //    ni les comptes de la porte, ni le vecteur du banc caché, ni les cases tenues à part.
    const ex = g.fabriquerExemple(join(d, 'runs'), { graines: 2, pas: 300, lot: 100, porte: 96, cache: 120 });
    const fichiers: string[] = [];
    const parcourir = (dossier: string) => { for (const x of readdirSync(dossier, { withFileTypes: true })) { if (x.isDirectory()) parcourir(join(dossier, x.name)); else fichiers.push(join(dossier, x.name)); } };
    parcourir(ex.boucle);
    assert.equal(fichiers.length, 5, 'un journal par run');
    for (const chemin of fichiers) {
      assert.match(chemin, /journal\.jsonl$/); assert.equal(interditALaBoucle(chemin), false);
      const texte = readFileSync(chemin, 'utf8');
      assert.doesNotMatch(texte, /"t":"(porte|mesure|cache|plan|cloture)"|par_competence|en_service|candidat|vecteur|tenues|global|seul_faux|parmi3|[01]{40}/, 'un compte ou un vecteur du banc dans le journal de la boucle');
      assert.ok(lireJournal(chemin).lignes.every((l) => ['entete', 'episode', 'systeme', 'fin'].includes(l.t)));
    }
    assert.ok(!existsSync(join(ex.boucle, 'A-1', 'cache-scelle.jsonl')) && !existsSync(join(ex.boucle, 'A-1', 'porte.jsonl')), 'les fichiers du banc ne sont pas à côté du journal');
    assert.ok(existsSync(join(ex.banc, 'A-1', 'cache-scelle.jsonl')) && existsSync(join(ex.banc, 'A-1', 'porte.jsonl')) && existsSync(join(ex.banc, 'prevus.json')));
    // 3. L'audit des lectures de la boucle a la liste de ce qu'elle ne doit jamais ouvrir.
    assert.deepEqual([...FICHIERS_DU_BANC].sort(), ['cache-scelle.jsonl', 'ouvertures.jsonl', 'porte.jsonl', 'prevus.json']);
    for (const nom of FICHIERS_DU_BANC) assert.equal(interditALaBoucle(join('n', 'importe', 'ou', nom.toUpperCase())), true);
    // 4. Les deux racines ne peuvent pas être le même dossier, ni l'une dans l'autre.
    assert.throws(() => lireRuns({ boucle: ex.banc, banc: ex.banc }), /séparés/);
    assert.throws(() => lireRuns({ boucle: ex.boucle, banc: join(ex.boucle, 'A-1') }), /séparés/);
    assert.throws(() => lireRuns({ boucle: join(ex.banc, 'A-1'), banc: ex.banc }), /séparés/);
    assert.throws(() => g.produire({ boucle: ex.banc, banc: ex.banc }, join(d, 'x')), /séparés/);
  });
});

test('Liste des runs prévus : écrite une fois, avant le premier run ; ni doublon, ni comparaison implicite, ni oubli du témoin', async () => {
  const { ecrirePrevus, lirePrevus } = await J();
  await dansUnDossier((d) => {
    const runs = [{ run: 'A-1', variante: 'A', graine: 1 }, { run: 'B-1', variante: 'B', graine: 1 }, { run: 'temoin-1', variante: 'temoin', graine: 1 }];
    const bon = { runs, comparer: { reference: 'A', candidat: 'B' }, temoin: 'temoin', cree: '2026-11-20T00:00:00Z' };
    const refuse = (p: object, motif: RegExp) => assert.throws(() => ecrirePrevus(join(d, 'non'), { ...bon, ...p } as never), motif);
    refuse({ runs: [...runs, { run: 'B-1', variante: 'B', graine: 2 }] }, /run en double/);
    refuse({ runs: [...runs, { run: 'B-9', variante: 'B', graine: 1 }] }, /variante et graine en double/);
    refuse({ comparer: { reference: 'A', candidat: 'A' } }, /même entraînement/);
    refuse({ comparer: { reference: 'A', candidat: 'C' } }, /variantes de la liste/);
    refuse({ comparer: { reference: 'temoin', candidat: 'B' } }, /témoin ne se compare pas/);
    refuse({ comparer: undefined }, /référence et le candidat/);
    refuse({ temoin: 'absent' }, /il faut un témoin/);
    assert.equal(existsSync(join(d, 'non', 'prevus.json')), false, 'une liste refusée n\'est pas écrite');
    const { chemin, empreinte } = ecrirePrevus(join(d, 'banc'), bon);
    assert.match(empreinte, /^sha256:[0-9a-f]{64}$/);
    const lu = lirePrevus(join(d, 'banc'));
    assert.equal(lu.empreinte, empreinte); assert.deepEqual(lu.prevus!.runs, runs); assert.deepEqual(lu.prevus!.comparer, bon.comparer);
    assert.throws(() => ecrirePrevus(join(d, 'banc'), bon), /ne se réécrit pas/);
    // Une liste retouchée à la main n'a plus la même empreinte ; une liste cassée ne se lit pas.
    writeFileSync(chemin, readFileSync(chemin, 'utf8').replace('"graine": 1', '"graine": 7'));
    assert.notEqual(lirePrevus(join(d, 'banc')).empreinte, empreinte);
    writeFileSync(chemin, '{ pas du JSON');
    assert.equal(lirePrevus(join(d, 'banc')).prevus, null);
    assert.equal(lirePrevus(join(d, 'vide')).prevus, null);
  });
});

test('Fichier scellé : il ne s\'ouvre qu\'à la fin de TOUS les runs prévus, des deux côtés ; écarter un run ne l\'ouvre pas ; chaque ouverture est notée', async () => {
  const { ouvrirJournal, ouvrirPortes, ouvrirScelle, ecrirePrevus, lireRuns, vecteurEnTexte, texteEnVecteur } = await J();
  assert.equal(vecteurEnTexte([1, 0, 1, 1]), '1011');
  assert.deepEqual([...texteEnVecteur('1011')], [1, 0, 1, 1]);
  await dansUnDossier((d) => {
    const racines = { boucle: join(d, 'boucle'), banc: join(d, 'banc') };
    mkdirSync(racines.boucle, { recursive: true });
    assert.equal(lireRuns(racines).ouvert, false);
    assert.match(lireRuns(racines).raison, /liste des runs prévus/, 'sans liste, rien ne dit que tous les runs sont finis');
    const { empreinte } = ecrirePrevus(racines.banc, { runs: [{ run: 'A-1', variante: 'A', graine: 1 }, { run: 'B-1', variante: 'B', graine: 1 }, { run: 'temoin-1', variante: 'temoin', graine: 1 }], comparer: { reference: 'A', candidat: 'B' }, temoin: 'temoin', cree: '2026-11-20T00:00:00Z' });
    const plan = { t: 'plan', banc: 'cache', empreinte: H('b'), n: 6, competences: ['C1', 'C1', 'C1', 'C2', 'C2', 'C2'], tenues: '001001' } as const;
    const cache = (run: string, part: number, pas: number, v: number[]) => ({
      t: 'cache', run, pas, part, global: { k: v.reduce((a, b) => a + b, 0), n: v.length },
      par_competence: { C1: { k: v[0] + v[1] + v[2], n: 3 }, C2: { k: v[3] + v[4] + v[5], n: 3 } }, vecteur: vecteurEnTexte(v), surete: 0,
    } as const);
    // La boucle écrit son journal ; le banc, à part, écrit le fichier scellé puis clôt le run.
    const boucle = (run: string, fini: boolean) => { const j = ouvrirJournal(join(racines.boucle, run, 'journal.jsonl')); j.ecrire({ ...ENTETE, run, variante: run.split('-')[0], graine: 1, prevus: empreinte }); if (fini) j.ecrire({ ...FIN, run }); j.fermer(); };
    const sceller = (run: string, fin: number[]) => { const s = ouvrirScelle(join(racines.banc, run, 'cache-scelle.jsonl')); s.ecrire(plan); s.ecrire(cache(run, 0, 0, [1, 0, 0, 1, 0, 0])); s.ecrire(cache(run, 100, 3000, fin)); const sommet = s.sommet(); s.fermer(); return sommet; };
    const clore = (run: string, sommet: string) => { const f = ouvrirPortes(join(racines.banc, run, 'porte.jsonl')); f.ecrire({ ...CLOTURE, run, scelle: sommet }); f.fermer(); };
    boucle('A-1', true); clore('A-1', sceller('A-1', [1, 1, 0, 1, 1, 0]));
    boucle('B-1', true); const sommetB = sceller('B-1', [1, 1, 1, 1, 1, 0]);   // fini pour la boucle, pas encore clos par le banc
    // 1. Le témoin n'est pas encore lancé (pas même un dossier) : fermé.
    let lu = lireRuns(racines);
    assert.equal(lu.ouvert, false); assert.match(lu.raison, /pas fini : temoin-1/);
    assert.deepEqual(lu.runs.map((r) => r.scelle), [null, null, null], 'aucun fichier scellé n\'est lu, même celui d\'un run fini');
    boucle('temoin-1', false);
    // Le fichier scellé du run pas fini est ici un DOSSIER : si quelqu'un l'ouvrait trop tôt, la lecture casserait.
    mkdirSync(join(racines.banc, 'temoin-1', 'cache-scelle.jsonl'), { recursive: true });
    lu = lireRuns(racines);
    assert.equal(lu.ouvert, false); assert.match(lu.raison, /temoin-1/);
    // 2. Écarter le run pas fini n'ouvre rien : il est dans la liste, il doit être fini comme les autres.
    assert.equal(lireRuns(racines, { sans: ['temoin-1'] }).ouvert, false);
    assert.throws(() => lireRuns(racines, { sans: ['B-99'] }), /inconnu.*B-99/, 'un nom à écarter qui n\'existe pas est une erreur, pas un silence');
    // 3. Tous les journaux ont leur ligne « fin », mais B-1 n'est pas clos par le banc : une ligne « fin » écrite par
    //    la boucle ne suffit pas à ouvrir.
    rmSync(join(racines.banc, 'temoin-1', 'cache-scelle.jsonl'), { recursive: true });
    { const j = ouvrirJournal(join(racines.boucle, 'temoin-1', 'journal.jsonl')); j.ecrire({ ...FIN, run: 'temoin-1' }); j.fermer(); }
    clore('temoin-1', sceller('temoin-1', [1, 0, 0, 1, 0, 0]));
    lu = lireRuns(racines);
    assert.equal(lu.ouvert, false); assert.match(lu.raison, /pas clos par le banc : B-1/);
    assert.equal(existsSync(join(racines.banc, 'ouvertures.jsonl')), false, 'rien n\'a été ouvert, rien n\'est noté');
    // 4. Tout est fini des deux côtés : tout s'ouvre, et l'ouverture est notée avec l'empreinte de chaque fichier scellé.
    clore('B-1', sommetB);
    lu = lireRuns(racines, { maintenant: '2026-11-21T04:00:00Z' });
    assert.equal(lu.ouvert, true); assert.equal(lu.raison, '');
    const [a, b] = lu.runs;
    assert.deepEqual(sansChaine(a.scelle!.plan as Brute), plan);
    assert.deepEqual(a.scelle!.mesures.map((m) => [m.part, m.global.k]), [[0, 2], [100, 4]]);
    assert.deepEqual(b.scelle!.mesures.map((m) => m.part), [0, 100]);
    assert.equal(a.portes.cloture!.scelle, a.scelle!.sommet, 'la clôture scelle la fin du fichier scellé');
    assert.deepEqual(lu.ouvertures, { n: 1, premiere: '2026-11-21T04:00:00Z', changes: [] });
    const notes = lignesDe(join(racines.banc, 'ouvertures.jsonl'));
    assert.equal(notes.length, 1); assert.equal(notes[0].prevus, empreinte);
    assert.deepEqual(Object.keys(notes[0].scelles).sort(), ['A-1', 'B-1', 'temoin-1']);
    for (const h of Object.values(notes[0].scelles)) assert.match(h as string, /^sha256:[0-9a-f]{64}$/);
    // 5. Un run fini peut être écarté : son fichier scellé n'est pas lu, et c'est noté.
    const sans = lireRuns(racines, { sans: ['A-1'], maintenant: '2026-11-21T05:00:00Z' });
    assert.equal(sans.ouvert, true); assert.equal(sans.runs[0].ecarte, true); assert.equal(sans.runs[0].scelle, null);
    assert.equal(sans.ouvertures.n, 2); assert.equal(sans.ouvertures.premiere, '2026-11-21T04:00:00Z');
    assert.deepEqual(lignesDe(join(racines.banc, 'ouvertures.jsonl'))[1].sans, ['A-1']);
    // 6. Un dossier qui n'est pas dans la liste (un run copié, par exemple) n'est pas lu.
    cpSync(join(racines.boucle, 'B-1'), join(racines.boucle, 'B-9'), { recursive: true });
    cpSync(join(racines.banc, 'B-1'), join(racines.banc, 'B-9'), { recursive: true });
    const copie = lireRuns(racines);
    assert.deepEqual(copie.horsListe, ['B-9']); assert.deepEqual(copie.runs.map((r) => r.run), ['A-1', 'B-1', 'temoin-1']);
    // 7. Un fichier scellé qui change après sa première ouverture : son empreinte n'est plus celle qui a été notée.
    const cs = join(racines.banc, 'B-1', 'cache-scelle.jsonl');
    writeFileSync(cs, readFileSync(cs, 'utf8').replace('"vecteur":"111110"', '"vecteur":"111101"'));
    assert.deepEqual(lireRuns(racines).ouvertures.changes, ['B-1']);
  });
});

test('Fichier scellé : une seule mesure par part de l\'entraînement, recoupée avec le vecteur et le plan', async () => {
  const { ouvrirJournal, ouvrirPortes, ouvrirScelle, ecrirePrevus, lireRuns, vecteurEnTexte, empreinteLigne } = await J();
  await dansUnDossier((d) => {
    const racines = { boucle: join(d, 'boucle'), banc: join(d, 'banc') };
    const { empreinte } = ecrirePrevus(racines.banc, { runs: [{ run: 'A-1', variante: 'A', graine: 1 }, { run: 'B-1', variante: 'B', graine: 1 }, { run: 'temoin-1', variante: 'temoin', graine: 1 }], comparer: { reference: 'A', candidat: 'B' }, temoin: 'temoin', cree: '2026-11-20T00:00:00Z' });
    const plan = { t: 'plan', banc: 'cache', empreinte: H('b'), n: 6, competences: ['C1', 'C1', 'C1', 'C2', 'C2', 'C2'] } as const;
    const cache = (run: string, part: number, pas: number, v: number[]) => ({ t: 'cache', run, pas, part, global: { k: v.reduce((a, b) => a + b, 0), n: v.length }, par_competence: { C1: { k: v[0] + v[1] + v[2], n: 3 }, C2: { k: v[3] + v[4] + v[5], n: 3 } }, vecteur: vecteurEnTexte(v), surete: 0 } as const);
    for (const run of ['A-1', 'B-1', 'temoin-1']) {
      const j = ouvrirJournal(join(racines.boucle, run, 'journal.jsonl')); j.ecrire({ ...ENTETE, run, variante: run.split('-')[0], graine: 1, prevus: empreinte }); j.ecrire({ ...FIN, run }); j.fermer();
      const s = ouvrirScelle(join(racines.banc, run, 'cache-scelle.jsonl'));
      if (run === 'A-1') {
        assert.throws(() => s.ecrire(cache(run, 0, 0, [1, 0, 0, 1, 0, 0])), /avant le plan/);
        s.ecrire(plan);
        assert.equal(s.ecrire({ ...plan, competences: [...plan.competences] }), true, 'le même plan une seconde fois : rien à écrire');
        assert.throws(() => s.ecrire({ ...plan, n: 7, competences: [...plan.competences, 'C2'] }), /déjà un plan/);
        s.ecrire(cache(run, 0, 0, [1, 0, 0, 1, 0, 0])); s.ecrire(cache(run, 100, 3000, [1, 1, 0, 1, 1, 0]));
        // Recoupements à l'écriture : le compte doit être celui du vecteur ; la part vient d'une liste fermée.
        assert.throws(() => s.ecrire({ ...cache(run, 50, 1500, [1, 1, 0, 1, 1, 0]), global: { k: 5, n: 6 } }), /vecteur/);
        assert.throws(() => s.ecrire({ ...cache(run, 50, 1500, [1, 1, 0, 1, 1, 0]), vecteur: '11011' }), /vecteur/);
        assert.throws(() => s.ecrire({ ...cache(run, 50, 1500, [1, 1, 0, 1, 1, 0]), vecteur: '11x110' } as never), /vecteur/);
        assert.throws(() => s.ecrire(cache(run, 37, 1100, [1, 1, 0, 1, 1, 0])), /part/, 'une part hors de 0, 25, 50, 75, 100');
        assert.throws(() => s.ecrire(EPISODE as never), /sorte/, 'le fichier scellé ne prend que « plan » et « cache »');
        // Une seconde mesure à 100 % : refusée, même après une réouverture du fichier.
        assert.throws(() => s.ecrire(cache(run, 100, 3000, [1, 1, 1, 1, 1, 1])), /déjà mesuré à 100/);
        s.fermer();
        const encore = ouvrirScelle(join(racines.banc, run, 'cache-scelle.jsonl'));
        assert.throws(() => encore.ecrire(cache(run, 100, 3000, [1, 1, 1, 1, 1, 1])), /déjà mesuré à 100/);
        assert.equal(encore.ecrire(cache(run, 50, 1500, [1, 1, 0, 1, 0, 0])), true);
        encore.fermer();
      } else { s.ecrire(plan); s.ecrire(cache(run, 0, 0, [1, 0, 0, 1, 0, 0])); s.ecrire(cache(run, 100, 3000, [1, 1, 1, 1, 1, 0])); s.fermer(); }
      const f = ouvrirPortes(join(racines.banc, run, 'porte.jsonl')); f.ecrire({ ...CLOTURE, run, scelle: lignesDe(join(racines.banc, run, 'cache-scelle.jsonl')).length ? empreinteLigne(readFileSync(join(racines.banc, run, 'cache-scelle.jsonl'), 'utf8').trimEnd().split('\n').at(-1)!) : ORIGINE }); f.fermer();
    }
    // Une seconde mesure à 100 % ajoutée à la main (avec le bon maillon), meilleure que la vraie : elle n'est jamais
    // prise. La première reste, et le doublon est dit.
    const cs = join(racines.banc, 'A-1', 'cache-scelle.jsonl');
    const derniere = readFileSync(cs, 'utf8').trimEnd().split('\n').at(-1)!;
    writeFileSync(cs, `${readFileSync(cs, 'utf8')}${JSON.stringify({ v: 2, ...cache('A-1', 100, 999999, [1, 1, 1, 1, 1, 1]), pr: empreinteLigne(derniere) })}\n`);
    // Et une mesure qui ne colle pas au plan (comptes par compétence faux) : écartée à la lecture.
    const cb = join(racines.banc, 'B-1', 'cache-scelle.jsonl');
    writeFileSync(cb, `${readFileSync(cb, 'utf8')}${JSON.stringify({ v: 2, ...cache('B-1', 50, 1500, [1, 1, 1, 0, 0, 0]), par_competence: { C1: { k: 1, n: 3 }, C2: { k: 2, n: 3 } }, pr: ORIGINE })}\n`);
    const lu = lireRuns(racines);
    assert.equal(lu.ouvert, true);
    const [a, b] = lu.runs;
    assert.deepEqual(a.scelle!.mesures.map((m) => [m.part, m.global.k]), [[0, 2], [50, 3], [100, 4]], 'la PREMIÈRE mesure à 100 % est gardée');
    assert.deepEqual(a.scelle!.doublons, [100]); assert.equal(a.scelle!.illisibles, 1);
    assert.deepEqual(b.scelle!.mesures.map((m) => m.part), [0, 100]); assert.equal(b.scelle!.illisibles, 1);
  });
});

test('Porte et épisode : l\'écriture refuse une ligne qui ne suit pas sa règle', async () => {
  const { ouvrirJournal, ouvrirPortes, defautsPorte } = await J();
  assert.deepEqual(defautsPorte(PORTE), []);
  await dansUnDossier((d) => {
    const f = ouvrirPortes(join(d, 'porte.jsonl'));
    assert.throws(() => f.ecrire({ ...PORTE, surete_candidat: 7 }), /gardé avec 7 fautes de sûreté/, 'une faute de sûreté refuse toujours');
    assert.throws(() => f.ecrire({ ...PORTE, candidat: { k: 277, n: 480 }, diff_moy: -0.05, et_diff: 0.0101, marge: 0.0101 }), /ne dépasse pas la marge/, 'gardé sous la marge');
    assert.throws(() => f.ecrire({ ...PORTE, diff_moy: 0.5 }), /n'est pas \(candidat − en service\)/, 'une différence qui n\'est pas celle des comptes');
    assert.throws(() => f.ecrire({ ...PORTE, candidat: { k: 90, n: 96 } }), /mêmes épisodes/);
    assert.throws(() => f.ecrire({ ...PORTE, et_diff: 0.001, marge: 0.001 }), /plus petit que ce que ces comptes permettent/, 'une erreur type impossible, donc une marge trop petite');
    assert.throws(() => f.ecrire({ ...PORTE, marge: 0.002 }), /marge .* plus petite que l'erreur type/);
    assert.throws(() => f.ecrire({ ...PORTE, decision: 'refuse' }), /refusé alors que la différence/, 'la règle vaut dans les deux sens');
    assert.equal(f.ecrire({ ...PORTE, surete_candidat: 2, decision: 'refuse' }), true, 'un candidat fautif se refuse, quel que soit l\'écart');
    assert.equal(f.ecrire(PORTE), true);
    assert.equal(f.ecrire(CLOTURE), true);
    assert.throws(() => f.ecrire(PORTE), /clos/, 'plus rien après la clôture');
    f.fermer();
    // Une faute de sûreté ne devient jamais une réussite.
    const j = ouvrirJournal(join(d, 'journal.jsonl'));
    assert.throws(() => j.ecrire({ ...EPISODE, surete: 1 }), /faute de sûreté/);
    assert.throws(() => j.ecrire({ ...EPISODE, issue: 'rate', r: 1, surete: 3 }), /faute de sûreté vaut toujours −1/);
    assert.throws(() => j.ecrire({ ...EPISODE, r: -1 }), /réussi vaut \+1/);
    assert.throws(() => j.ecrire({ ...EPISODE, issue: 'rate', r: 0 }), /0 seulement pour « refus »/);
    assert.equal(j.ecrire({ ...EPISODE, issue: 'rate', r: -1, surete: 3 }), true);
    j.fermer();
  });
});

// ------------------------------------------------------------------------------------------------ les statistiques
test('Wilson : les valeurs du plan (609/690 → 85,6-90,5 % ; 50/100 → 40-60 % ; 80/100 → 71-87 %)', async () => {
  const { wilson, wilsonMoyenne } = await S();
  const a = wilson(609, 690);
  assert.equal(points(a.p), 88.3); assert.equal(points(a.bas), 85.6); assert.equal(points(a.haut), 90.5);
  const b = wilson(50, 100); assert.equal(Math.round(b.bas * 100), 40); assert.equal(Math.round(b.haut * 100), 60);
  const c = wilson(80, 100); assert.equal(Math.round(c.bas * 100), 71); assert.equal(Math.round(c.haut * 100), 87);
  // Plusieurs graines sur les MÊMES épisodes : la moyenne des taux, mais l'intervalle d'un seul passage (n épisodes).
  const m = wilsonMoyenne([0.78, 0.80, 0.82], 100);
  proche(m.p, 0.80); proche(m.bas, c.bas); proche(m.haut, c.haut); assert.equal(m.n, 100);
  assert.deepEqual(wilsonMoyenne([], 100), { k: 0, n: 0, p: 0, bas: 0, haut: 1 }, 'aucune graine : rien de mesuré, pas un zéro inventé');
});

test('Loi normale et loi de Student : les quantiles connus', async () => {
  const { quantileNormale, quantileStudent, repartitionStudent } = await S();
  proche(quantileNormale(0.975), 1.959964, 1e-6); proche(quantileNormale(0.8), 0.841621, 1e-6);
  proche(quantileNormale(0.5), 0, 1e-9); proche(quantileNormale(0.025), -1.959964, 1e-6);
  proche(quantileNormale(0.001), -3.090232, 1e-6); proche(quantileNormale(0.9999), 3.719016, 1e-6);
  assert.throws(() => quantileNormale(0)); assert.throws(() => quantileNormale(1));
  // Student, des deux côtés à 95 % : les valeurs des tables (1, 2, 4, 8 et 30 degrés de liberté).
  proche(quantileStudent(0.975, 1), 12.706205, 1e-5); proche(quantileStudent(0.975, 2), 4.302653, 1e-6);
  proche(quantileStudent(0.975, 4), 2.776445, 1e-6); proche(quantileStudent(0.975, 8), 2.306004, 1e-6); proche(quantileStudent(0.975, 30), 2.042272, 1e-6);
  proche(quantileStudent(0.8, 4), 0.940965, 1e-6); proche(quantileStudent(0.95, 10), 1.812461, 1e-6); proche(quantileStudent(0.025, 4), -2.776445, 1e-6);
  proche(repartitionStudent(2, 10), 0.963306, 1e-6); proche(repartitionStudent(0, 3), 0.5, 1e-12); proche(repartitionStudent(-2, 10), 1 - 0.963306, 1e-6);
  // Des degrés de liberté qui ne sont pas entiers (Welch) : entre les deux valeurs voisines. Beaucoup : la loi normale.
  const entre = quantileStudent(0.975, 5.5);
  assert.ok(entre < quantileStudent(0.975, 5) && entre > quantileStudent(0.975, 6));
  proche(quantileStudent(0.975, 1e6), 1.959964, 1e-5);
  assert.throws(() => quantileStudent(0.975, 0)); assert.throws(() => quantileStudent(1, 4));
});

test('McNemar exact : valeurs calculées à la main', async () => {
  const { mcnemar, mcnemarVecteurs } = await S();
  proche(mcnemar(1, 9).p, 22 / 1024);          // 2 × (1 + 10) / 2^10
  proche(mcnemar(9, 1).p, 22 / 1024);          // symétrique
  proche(mcnemar(0, 6).p, 2 / 64);
  proche(mcnemar(3, 10).p, 2 * 378 / 8192);    // 2 × (1 + 13 + 78 + 286) / 2^13
  assert.equal(mcnemar(5, 5).p, 1); assert.equal(mcnemar(0, 0).p, 1, 'aucun désaccord : rien à dire');
  const grand = mcnemar(40, 260); assert.ok(grand.p > 0 && grand.p < 1e-30, 'pas de dépassement sur de grands nombres');
  // Depuis deux vecteurs réussi / raté sur les mêmes épisodes : b01 = A raté et B réussi ; b10 = l'inverse.
  const a = [1, 1, 0, 0, 0, 0, 0, 0, 1, 0], b = [1, 0, 1, 1, 1, 1, 1, 1, 1, 0];
  const v = mcnemarVecteurs(a, b);
  assert.deepEqual([v.b01, v.b10, v.n], [6, 1, 7]); proche(v.p, 2 * (1 + 7) / 128);
  assert.throws(() => mcnemarVecteurs([1, 0], [1]), /même/);
});

test('Holm : correction pour plusieurs comparaisons', async () => {
  const { holm } = await S();
  const h = holm([0.01, 0.04, 0.03, 0.005]);
  [0.03, 0.06, 0.06, 0.02].forEach((v, i) => proche(h[i], v, 1e-12));
  assert.deepEqual(holm([0.5, 0.9]), [1, 1], 'jamais au-dessus de 1');
  assert.deepEqual(holm([]), []); assert.deepEqual(holm([0.2]), [0.2]);
  // Six compétences : une seule comparaison à 0,02 ne passe plus le seuil de 5 % une fois corrigée.
  assert.ok(holm([0.02, 0.5, 0.6, 0.7, 0.8, 0.9])[0] > 0.05);
  // Une valeur qui n'est pas un nombre ne se propage pas en silence.
  assert.throws(() => holm([0.01, Number.NaN, 0.03]), /hors de 0 à 1/);
  assert.throws(() => holm([0.01, 1.2]), /hors de 0 à 1/);
});

test('Hasard à graine : même graine, mêmes tirages ; deux graines différentes, deux suites', async () => {
  const { hasard } = await S();
  const a = hasard(42), b = hasard(42);
  for (let i = 0; i < 20; i++) assert.equal(a(), b());
  assert.notEqual(hasard(1)(), hasard(2)());
  assert.notEqual(hasard(1)(), hasard(1 + 2 ** 32)(), 'les bits au-dessus du 32e comptent');
  assert.throws(() => hasard(1.9), /entier/, 'une graine à virgule n\'est pas arrondie en silence');
  assert.throws(() => hasard(-1), /entier/); assert.throws(() => hasard(Number.NaN), /entier/);
  const u = Array.from({ length: 2000 }, hasard(7));
  assert.ok(u.every((x) => x >= 0 && x < 1)); proche(u.reduce((s, x) => s + x, 0) / u.length, 0.5, 0.03);
});

test('Note géométrique des compétences', async () => {
  const { noteGeometrique } = await S();
  proche(noteGeometrique([0.5, 0.5, 0.5]), 50, 1e-9);
  proche(noteGeometrique([0, 1]), Math.sqrt(101) - 1, 1e-9);
  proche(noteGeometrique([1, 1, 1, 1, 1, 1]), 100, 1e-9);
  // Elle compte davantage une compétence difficile enfin réussie : +10 points sur la plus faible valent plus que sur la plus forte.
  assert.ok(noteGeometrique([0.1 + 0.1, 0.9]) - noteGeometrique([0.1, 0.9]) > noteGeometrique([0.1, 0.9 + 0.1]) - noteGeometrique([0.1, 0.9]));
  assert.equal(noteGeometrique([]), 0);
});

test('Plus petit écart détectable : les chiffres du plan (600 épisodes : 2,6 / 3,6 / 5,1 points ; 100 : 6 à 13)', async () => {
  const { plusPetitEcart, plusPetitEcartDepuis, plusPetitEcartSelon, plusPetitEcartStudent } = await S();
  assert.equal(points(plusPetitEcart(600, 0.05)), 2.6);
  assert.equal(points(plusPetitEcart(600, 0.10)), 3.6);
  assert.equal(points(plusPetitEcart(600, 0.20)), 5.1);
  assert.equal(Math.round(100 * plusPetitEcart(100, 0.05)), 6);
  assert.equal(Math.round(100 * plusPetitEcart(100, 0.20)), 13);
  assert.ok(plusPetitEcart(600, 0.10, 0.05, 0.9) > plusPetitEcart(600, 0.10), 'plus de puissance demandée : écart détectable plus grand');
  proche(plusPetitEcartDepuis(Math.sqrt(0.10), 600), plusPetitEcart(600, 0.10), 1e-12);
  // À partir d'une erreur type déjà calculée (celle du rééchantillonnage, graines comprises) : 2,80 fois l'erreur type.
  proche(plusPetitEcartSelon(0.01), 0.0280158, 1e-6);
  // Avec la loi de Student (contrôle par graines) : peu de graines, écart détectable plus grand. 4 degrés : 2,776 + 0,941.
  proche(plusPetitEcartStudent(0.01, 4), 0.0371741, 1e-6);
  assert.ok(plusPetitEcartStudent(0.01, 4) > plusPetitEcartStudent(0.01, 8) && plusPetitEcartStudent(0.01, 8) > plusPetitEcartSelon(0.01));
});

// Fabrique une matrice graines × épisodes de 0 / 1 : difficulté par épisode commune aux graines, plus un peu de bruit.
function matrice(alea: () => number, graines: number, n: number, p: number, bruit = 0.15): number[][] {
  const seuils = Array.from({ length: n }, () => alea());
  return Array.from({ length: graines }, () => seuils.map((u) => ((u + (alea() - 0.5) * bruit) < p ? 1 : 0)));
}

test('Rééchantillonnage hiérarchique : un écart nul donne un intervalle qui contient 0, un vrai écart le dépasse', async () => {
  const { comparer, hasard } = await S();
  const alea = hasard(42);
  const strates = Array.from({ length: 300 }, (_, i) => `C${1 + Math.floor(i / 50)}`);
  const a = matrice(alea, 5, 300, 0.7);
  // Écart nul par construction : B réussit autant que A dans chaque compétence, mais pas sur les mêmes épisodes
  // (les 50 épisodes de chaque compétence sont pris à l'envers).
  const b = a.map((v) => v.map((_, e) => v[50 * Math.floor(e / 50) + 49 - (e % 50)]));
  const nul = comparer(a, b, strates, { tirages: 2000, graine: 1 });
  proche(nul.difference, 0, 1e-12);
  assert.ok(nul.bas < 0 && nul.haut > 0, `écart nul : [${nul.bas} ; ${nul.haut}] doit contenir 0`);
  assert.ok(nul.haut - nul.bas > 0.02, 'un vrai intervalle, pas un point');
  assert.ok(nul.p > 0.05);
  assert.equal(nul.n, 300); assert.equal(nul.grainesA, 5); assert.equal(nul.grainesB, 5); assert.equal(nul.tirages, 2000);
  // Les mêmes données des deux côtés : écart exactement 0, et 0 dans l'intervalle.
  const meme = comparer(a, a, strates, { tirages: 500, graine: 1 });
  assert.equal(meme.difference, 0); assert.ok(meme.bas <= 0 && meme.haut >= 0);
  // Un vrai écart : B réussit 12 % des épisodes que A rate.
  const mieux = a.map((v) => v.map((x) => (x === 0 && alea() < 0.4 ? 1 : x)));
  const vrai = comparer(a, mieux, strates, { tirages: 2000, graine: 1 });
  assert.ok(vrai.difference > 0.08 && vrai.bas > 0, `vrai écart : borne basse ${vrai.bas}`);
  assert.ok(vrai.bas < vrai.difference && vrai.difference < vrai.haut);
  // L'erreur type de l'écart : la largeur de l'intervalle vaut à peu près 2 × 1,96 fois elle.
  assert.ok(vrai.erreurType > 0);
  proche((vrai.haut - vrai.bas) / (2 * 1.96 * vrai.erreurType), 1, 0.15);
  assert.ok(vrai.p < 0.01);
  proche(vrai.difference, vrai.tauxB - vrai.tauxA, 1e-12);
  // Même graine de hasard : mêmes bornes, au chiffre près. Autre graine : bornes voisines.
  assert.deepEqual(comparer(a, mieux, strates, { tirages: 2000, graine: 1 }), vrai);
  const autre = comparer(a, mieux, strates, { tirages: 2000, graine: 2 });
  assert.notDeepEqual(autre, vrai); proche(autre.bas, vrai.bas, 0.01); proche(autre.haut, vrai.haut, 0.01);
  assert.equal(autre.difference, vrai.difference, 'l\'écart mesuré ne dépend pas du hasard, seulement ses bornes');
  // Par compétence : six écarts, six valeurs p, corrigées par Holm (jamais plus petites que la valeur brute).
  assert.deepEqual(Object.keys(vrai.parStrate), ['C1', 'C2', 'C3', 'C4', 'C5', 'C6']);
  for (const s of Object.values(vrai.parStrate)) { assert.equal(s.n, 50); assert.ok(s.pHolm >= s.p && s.pHolm <= 1); assert.ok(s.bas <= s.difference && s.difference <= s.haut); }
  assert.throws(() => comparer(a, [[1, 0]], strates), /même/);
  assert.throws(() => comparer([], b, strates), /graine/);
});

test('Rééchantillonnage hiérarchique : il retire les graines, puis les épisodes, compétence par compétence', async () => {
  const { comparer, bande } = await S();
  // Les graines comptent : deux graines de A opposées (tout réussi, tout raté), B au milieu. Écart moyen nul, mais selon
  // les graines retirées il vaut −0,5, 0 ou +0,5 : l'intervalle doit le montrer (un tirage des seuls épisodes le cacherait).
  const n = 200, tout = Array(n).fill(1), rien = Array(n).fill(0), moitie = Array.from({ length: n }, (_, i) => i % 2);
  const g = comparer([tout, rien], [moitie, moitie], null, { tirages: 2000, graine: 3 });
  proche(g.difference, 0, 1e-12);
  assert.ok(g.bas < -0.4 && g.haut > 0.4, `l'écart entre graines doit élargir l'intervalle : [${g.bas} ; ${g.haut}]`);
  // Stratifié : chaque tirage garde le nombre d'épisodes de chaque compétence. Ici l'écart vaut 1 sur C1 et 0 sur C2 :
  // l'écart global vaut exactement 0,5 à chaque tirage.
  const strates = [...Array(50).fill('C1'), ...Array(50).fill('C2')];
  const a = [[...Array(50).fill(0), ...Array(50).fill(1)]], b = [Array(100).fill(1)];
  const s = comparer(a, b, strates, { tirages: 300, graine: 4 });
  assert.equal(s.difference, 0.5); assert.equal(s.bas, 0.5); assert.equal(s.haut, 0.5); assert.equal(s.erreurType, 0);
  assert.deepEqual([s.parStrate.C1.difference, s.parStrate.C1.bas, s.parStrate.C2.difference, s.parStrate.C2.haut], [1, 1, 0, 0]);
  // La bande d'une seule variante (pour la courbe) : moyenne des graines, bornes autour.
  const m = bande([tout, rien], null, { tirages: 1000, graine: 5 });
  assert.equal(m.moyenne, 0.5); assert.equal(m.bas, 0); assert.equal(m.haut, 1); assert.equal(m.graines, 2);
  const une = bande([moitie], null, { tirages: 1000, graine: 5 });
  assert.equal(une.moyenne, 0.5); assert.ok(une.bas > 0.4 && une.bas < 0.5 && une.haut > 0.5 && une.haut < 0.6, 'une graine : les épisodes seuls');
});

test('Contrôle par graines (Welch) et bornes qui décident : la plus prudente des deux méthodes, reculée de l\'erreur de tirage', async () => {
  const { comparer, ecartParGraines, quantileStudent, hasard } = await S();
  // Un cas calculé à la main : taux de A 0,5 / 0,6 / 0,7 ; taux de B 0,7 / 0,8 / 0,9. Écart 0,2 ; variance des taux 0,01
  // de chaque côté ; erreur type √(0,01/3 + 0,01/3) ; 4 degrés de liberté.
  const de = (k: number) => Array.from({ length: 10 }, (_, i) => (i < k ? 1 : 0));
  const w = ecartParGraines([de(5), de(6), de(7)], [de(7), de(8), de(9)]);
  proche(w.difference, 0.2, 1e-12); proche(w.erreurType!, Math.sqrt(0.02 / 3), 1e-12); proche(w.ddl!, 4, 1e-9);
  proche(w.bas!, 0.2 - quantileStudent(0.975, 4) * Math.sqrt(0.02 / 3), 1e-9); proche(w.haut!, 0.2 + 2.776445 * Math.sqrt(0.02 / 3), 1e-6);
  // Une seule graine d'un côté : rien ne peut être dit, et rien ne se décide.
  const uneSeule = ecartParGraines([de(5)], [de(7), de(8)]);
  proche(uneSeule.difference, 0.25, 1e-12); assert.deepEqual([uneSeule.erreurType, uneSeule.ddl, uneSeule.bas, uneSeule.haut], [null, null, null, null]);
  const seule = comparer([de(5)], [de(7), de(8)], null, { tirages: 300, graine: 1 });
  assert.equal(seule.basDecision, null); assert.equal(seule.hautDecision, null);
  // Toutes les graines donnent le même taux : l'écart entre graines est nul, la borne est l'écart lui-même.
  const pareilles = ecartParGraines([de(5), de(5)], [de(8), de(8)]);
  proche(pareilles.difference, 0.3, 1e-12); assert.equal(pareilles.erreurType, 0); assert.equal(pareilles.bas, pareilles.difference); assert.equal(pareilles.haut, pareilles.difference);
  // Les bornes sûres ne sont jamais plus flatteuses que les bornes nominales ; celles qui décident, jamais plus que les deux.
  const alea = hasard(9);
  const a = matrice(alea, 5, 300, 0.6), b = matrice(alea, 5, 300, 0.66);
  const c = comparer(a, b, null, { tirages: 2000, graine: 5 });
  assert.ok(c.basSur <= c.bas && c.hautSur >= c.haut);
  assert.ok(c.bas - c.basSur < 0.25 * (c.haut - c.bas), 'un recul de deux erreurs de tirage, pas davantage');
  assert.equal(c.basDecision, Math.min(c.basSur, c.parGraines.bas!)); assert.equal(c.hautDecision, Math.max(c.hautSur, c.parGraines.haut!));
  const peu = comparer(a, b, null, { tirages: 200, graine: 5 });
  assert.ok(peu.basSur <= peu.bas && peu.hautSur >= peu.haut);
});

test('Peu de graines qui s\'écartent beaucoup : le rééchantillonnage seul conclut trop souvent à tort, la borne qui décide non', async () => {
  const { comparer, hasard } = await S();
  // Simulation SANS aucun écart vrai : A et B viennent de la même loi. 3 graines de chaque côté, fort bruit entre graines.
  const alea = hasard(4242), n = 240, essais = 300;
  const gauss = () => { let u = 0; for (let i = 0; i < 12; i++) u += alea(); return u - 6; };
  let seul = 0, decide = 0;
  for (let s = 0; s < essais; s++) {
    const difficulte = Array.from({ length: n }, () => -1.5 + 3 * alea());
    const une = () => { const d = 0.3 * gauss(); return Uint8Array.from({ length: n }, (_, e) => (alea() < 1 / (1 + Math.exp(-(difficulte[e] + d))) ? 1 : 0)); };
    const c = comparer([une(), une(), une()], [une(), une(), une()], null, { tirages: 400, graine: s + 1 });
    assert.equal(typeof c.basDecision, 'number');
    if (c.bas > 0) seul++;
    if ((c.basDecision as number) > 0) decide++;
  }
  // Attendu d'une règle à 95 % : « B fait mieux » à tort 2,5 fois sur 100.
  assert.ok(seul / essais > 0.05, `le défaut mesuré : le rééchantillonnage seul dit « B fait mieux » à tort ${(100 * seul / essais).toFixed(1)} fois sur 100`);
  assert.ok(decide / essais <= 0.04, `la borne qui décide : ${(100 * decide / essais).toFixed(1)} fois sur 100`);
  // Et elle n'empêche pas de voir un écart net avec cinq graines qui se ressemblent.
  const base = matrice(alea, 5, 300, 0.6, 0.05), haut = base.map((v) => v.map((x) => (x === 0 && alea() < 0.45 ? 1 : x)));
  const net = comparer(base, haut, null, { tirages: 2000, graine: 1 });
  assert.ok(net.difference > 0.12 && (net.basDecision as number) > 0, `écart net : borne qui décide ${net.basDecision}`);
});

test('Bande à partir de comptes seuls (banc de porte) : prudente, jamais plus étroite qu\'un seul passage', async () => {
  const { bandeComptes, wilson } = await S();
  const b = bandeComptes([300, 310, 305], 480, { tirages: 2000, graine: 6 });
  proche(b.moyenne, 305 / 480, 1e-12); assert.ok(b.bas < b.moyenne && b.moyenne < b.haut); assert.equal(b.graines, 3);
  const w = wilson(305, 480);
  assert.ok(b.haut - b.bas >= 0.85 * (w.haut - w.bas), 'au moins la largeur d\'un passage de 480 épisodes');
  const disperse = bandeComptes([240, 370, 305], 480, { tirages: 2000, graine: 6 });
  assert.ok(disperse.haut - disperse.bas > b.haut - b.bas, 'des graines qui s\'écartent élargissent la bande');
  assert.deepEqual(bandeComptes([480], 480, { tirages: 200, graine: 6 }), { moyenne: 1, bas: 1, haut: 1, graines: 1 });
  assert.throws(() => bandeComptes([500], 480), /compte/);
});

test('Probabilité que B batte A, désaccord, bruit entre graines', async () => {
  const { probaAmelioration, differences, bruitEntreGraines } = await S();
  // Épisode 1 : égalité (compte pour moitié) ; épisode 2 : B gagne.
  assert.deepEqual(probaAmelioration([[1, 0]], [[1, 1]]), { p: 0.75, gagne: 0.5, egal: 0.5, perd: 0 });
  // Deux graines de chaque côté : A réussit l'épisode une fois sur deux, B toujours → B gagne sur la moitié des paires.
  assert.deepEqual(probaAmelioration([[1], [0]], [[1], [1]]), { p: 0.75, gagne: 1, egal: 0, perd: 0 });
  proche(probaAmelioration([[1, 1, 0, 0]], [[1, 0, 1, 0]]).p, 0.5, 1e-12);
  const d = differences([1, 1, 0, 0, 1, 0, 1, 1], [1, 0, 1, 1, 1, 0, 1, 1]);
  assert.equal(d.n, 8); proche(d.moyenne, 1 / 8); proche(d.desaccord, 3 / 8);
  proche(d.ecartType, Math.sqrt((3 - 8 * (1 / 64)) / 7), 1e-12); proche(d.erreurType, d.ecartType / Math.sqrt(8), 1e-12);
  const bruit = bruitEntreGraines([[1, 1, 1, 0], [1, 0, 0, 0], [1, 1, 0, 0]]);
  assert.deepEqual(bruit.taux, [0.75, 0.25, 0.5]); proche(bruit.ecartMax, 0.5); proche(bruit.ecartMoyen, (0.5 + 0.25 + 0.25) / 3);
  proche(bruit.ecartType, 0.25);
  assert.deepEqual(bruitEntreGraines([[1, 0]]), { taux: [0.5], ecartMoyen: 0, ecartMax: 0, ecartType: 0 });
});

test('Règle de décision : « B fait mieux » seulement si la borne basse dépasse 0 ET si B n\'a aucune faute de sûreté ; la même règle pour A', async () => {
  const { decider } = await S();
  const mieux = { difference: 0.04, bas: 0.012, haut: 0.07 }, flou = { difference: 0.01, bas: -0.01, haut: 0.03 }, pire = { difference: -0.05, bas: -0.08, haut: -0.02 };
  const net = { porte: 0, cache: 0 }, propre = { a: net, b: net };
  assert.equal(decider(mieux, propre).issue, 'B-mieux');
  assert.equal(decider(flou, propre).issue, 'pas-demontre');
  assert.match(decider(flou, propre, { ecartDetectable: 0.036 }).raisons.join(' '), /3,6 points/);
  assert.doesNotMatch(decider(flou, propre).texte, /n'aide pas/, 'on dit « pas démontré », jamais « B n\'aide pas »');
  assert.equal(decider(pire, propre).issue, 'A-mieux');
  // La sûreté n'est jamais compensée : une seule faute, sur l'un ou l'autre banc, et B n'est pas retenu.
  assert.equal(decider(mieux, { a: net, b: { porte: 0, cache: 1 } }).issue, 'B-ecarte');
  assert.equal(decider(mieux, { a: net, b: { porte: 2, cache: 0 } }).issue, 'B-ecarte');
  assert.equal(decider(flou, { a: net, b: { porte: 1, cache: 0 } }).issue, 'B-ecarte');
  // La règle vaut dans les deux sens : on ne dit jamais « A fait mieux » d'un A qui a des fautes de sûreté.
  const aFautif = decider(pire, { a: { porte: 0, cache: 25 }, b: net });
  assert.equal(aFautif.issue, 'A-ecarte'); assert.match(aFautif.texte, /A n'est pas retenu : 25 fautes de sûreté/);
  assert.doesNotMatch(aFautif.texte, /fait moins bien que A/);
  assert.match(decider(mieux, { a: { porte: 3, cache: 0 }, b: net }).raisons.join(' '), /A, lui, a 3 fautes de sûreté/);
  assert.match(decider(flou, { a: { porte: 0, cache: 1 }, b: net }).raisons.join(' '), /A a 1 faute de sûreté/);
  assert.match(decider(mieux, { a: { porte: 1, cache: 0 }, b: { porte: 0, cache: 2 } }).raisons.join(' '), /A a aussi 1 faute/);
  // Compteur non renseigné : on ne conclut pas à sa place, ni pour B ni pour A.
  assert.equal(decider(mieux, { a: net, b: { porte: null, cache: 0 } }).issue, 'suspendu');
  assert.equal(decider(mieux, { a: net, b: { porte: 0, cache: null } }).issue, 'suspendu');
  assert.equal(decider(pire, { a: { porte: 0, cache: null }, b: net }).issue, 'suspendu');
  // Un blocage (témoin pas plat, bancs différents) suspend tout.
  const bloque = decider(mieux, propre, { blocages: ['le témoin n\'est pas plat'] });
  assert.equal(bloque.issue, 'suspendu'); assert.deepEqual(bloque.raisons, ['le témoin n\'est pas plat']);
  // La borne basse exactement à 0 ne suffit pas.
  assert.equal(decider({ difference: 0.02, bas: 0, haut: 0.04 }, propre).issue, 'pas-demontre');
  // Quand les bornes qui décident sont données, ce sont elles qui comptent ; sans graines pour décider, rien ne se décide.
  assert.equal(decider({ ...mieux, basDecision: -0.001, hautDecision: 0.08 }, propre).issue, 'pas-demontre');
  assert.equal(decider({ ...mieux, basDecision: null, hautDecision: null }, propre).issue, 'suspendu');
  // Les vrais noms des deux entraînements sont dans le texte : jamais « B fait mieux que A » pour un C contre un B.
  const nomme = decider(mieux, propre, { noms: { a: 'B', b: 'C' } });
  assert.equal(nomme.texte, 'C fait mieux que B sur le banc caché.'); assert.match(nomme.raisons[0], /C − B/);
  assert.equal(decider(pire, propre, { noms: { a: 'B', b: 'C' } }).texte, 'C fait moins bien que B sur le banc caché.');
});

// ------------------------------------------------------------------------------------------------ les graphes et le rapport
/** Contrôle de forme d'un SVG : balises fermées dans l'ordre, pas de « < » ni de « & » nus, pas de nombre cassé. */
function svgBienForme(svg: string): void {
  assert.match(svg, /^<svg[\s>]/); assert.match(svg, /<\/svg>\s*$/);
  assert.doesNotMatch(svg, /NaN|undefined|Infinity|\[object|\bnull\b/, 'un nombre ou un texte cassé dans le dessin');
  const pile: string[] = [];
  const balise = /<(\/?)([A-Za-z][\w:-]*)((?:\s+[\w:-]+="[^"<]*")*)\s*(\/?)>/g;
  let reste = '', dernier = 0, m: RegExpExecArray | null;
  while ((m = balise.exec(svg))) {
    reste += svg.slice(dernier, m.index); dernier = m.index + m[0].length;
    if (m[1]) assert.equal(pile.pop(), m[2], `</${m[2]}> fermée hors de son tour`);
    else if (!m[4]) pile.push(m[2]);
  }
  reste += svg.slice(dernier);
  assert.deepEqual(pile, [], 'des balises restent ouvertes');
  assert.doesNotMatch(reste, /</, 'un « < » nu dans le texte');
  assert.doesNotMatch(reste.replace(/&(amp|lt|gt|quot|#\d+);/g, ''), /&/, 'un « & » nu dans le texte');
}
const compter = (texte: string, motif: RegExp) => (texte.match(motif) ?? []).length;
const attribut = (balise: string, nom: string) => Number(new RegExp(`\\b${nom}="([^"]*)"`).exec(balise)?.[1]);
const PETIT = { graines: 3, pas: 600, lot: 100, porte: 96, cache: 120, graine: 11 };
/** Un exemple où le candidat fait nettement mieux, avec cinq graines : le rapport y conclut « B fait mieux ». */
const NET = { ...PETIT, graines: 5, avance: 3 };
const VITE = { tirages: 2000, tiragesBandes: 200, maintenant: '2026-11-20T03:00:00Z' };
interface Racines { boucle: string; banc: string; runs: string[] }
type Modele = Brute;

test('Graphes : des journaux d\'exemple donnent les deux dessins SVG, bien formés, fidèles aux chiffres', async () => {
  const g = await G();
  const { wilsonMoyenne } = await S();
  await dansUnDossier((d) => {
    const ex: Racines = g.fabriquerExemple(join(d, 'runs'), PETIT);
    assert.deepEqual([...ex.runs].sort(), ['A-1', 'A-2', 'A-3', 'B-1', 'B-2', 'B-3', 'temoin-1']);
    const m = g.construire(g.rassembler(ex), VITE);
    assert.deepEqual(m.blocages, []);
    const courbes: string = g.svgCourbes(m), barres: string = g.svgCompetences(m);
    svgBienForme(courbes); svgBienForme(barres);

    // (a) La performance de chaque entraînement au fil des pas : A, B et le témoin, sur les deux bancs, avec leur bande.
    for (const banc of ['porte', 'cache']) for (const serie of ['A', 'B', 'temoin']) {
      assert.equal(compter(courbes, new RegExp(`<path class="ba-courbe[^"]*" data-banc="${banc}" data-serie="${serie}"`, 'g')), 1, `courbe ${serie} sur le banc ${banc}`);
      assert.equal(compter(courbes, new RegExp(`<path class="ba-bande[^"]*" data-banc="${banc}" data-serie="${serie}"`, 'g')), 1, `bande ${serie} sur le banc ${banc}`);
    }
    for (const serie of ['A', 'B', 'temoin']) {
      const s = m.cache.series[serie];
      assert.deepEqual(s.map((p: { part: number }) => p.part), [0, 25, 50, 75, 100], 'banc caché : 0, 25, 50, 75 et 100 %');
      assert.ok(s.every((p: { bas: number; moyenne: number; haut: number }) => p.bas <= p.moyenne && p.moyenne <= p.haut));
      assert.equal(compter(courbes, new RegExp(`<circle class="ba-point[^"]*" data-banc="cache" data-serie="${serie}"`, 'g')), 5);
      assert.ok(m.porte.series[serie].length >= 2 && m.porte.series[serie].every((p: { bas: number; moyenne: number; haut: number }) => p.bas <= p.moyenne && p.moyenne <= p.haut));
    }
    // La courbe passe bien par les points mesurés : le tracé de A sur le banc caché a cinq sommets, à la hauteur de ses taux.
    const trace = /<path class="ba-courbe[^"]*" data-banc="cache" data-serie="A"[^>]*\sd="([^"]+)"/.exec(courbes)![1];
    const sommets = trace.trim().split(/\s*[ML]\s*/).filter(Boolean).map((p) => p.split(/[ ,]+/).map(Number));
    assert.equal(sommets.length, 5);
    const cadre = /<g class="ba-panneau" data-banc="cache"[^>]*>/.exec(courbes)![0];
    const y0 = attribut(cadre, 'data-y-bas'), y1 = attribut(cadre, 'data-y-haut'), v0 = attribut(cadre, 'data-v-bas'), v1 = attribut(cadre, 'data-v-haut');
    m.cache.series.A.forEach((p: { moyenne: number }, i: number) => proche(sommets[i][1], y0 + (p.moyenne - v0) / (v1 - v0) * (y1 - y0), 0.06));
    // Un axe qui ne part pas de 0 le dit, avec ses bornes.
    if (v0 > 0) assert.match(courbes, /axe coupé : de \d+ % à \d+ %/);
    // Les repères : un trait par lot refusé, la ligne pointillée « parmi trois », le compteur de sûreté.
    const refus = Object.values(m.porte.refus as Record<string, Array<{ pas: number; graines: number }>>).reduce((n, l) => n + l.length, 0);
    assert.ok(refus > 0, 'l\'exemple doit contenir des lots refusés');
    assert.equal(compter(courbes, /<line class="ba-refus[^"]*"/g), refus);
    assert.equal(compter(courbes, /<line class="ba-parmi3[^"]*"/g), 1);
    assert.match(courbes, /optimiste/); assert.match(courbes, /Fautes de sûreté/); assert.match(courbes, /Décide seul et se trompe/);

    // (b) Les compétences : six groupes de trois barres (avant, après A, après B), moustaches de Wilson, note géométrique.
    const lesBarres = barres.match(/<path class="ba-barre[^"]*" data-groupe="competences"[^>]*>/g) ?? [];
    assert.equal(lesBarres.length, 18);
    assert.equal(compter(barres, /<line class="ba-moustache[^"]*" data-groupe="competences"/g), 18);
    assert.equal(compter(barres, /<path class="ba-barre[^"]*" data-groupe="geometrique"/g), 3);
    assert.equal(compter(barres, /<path class="ba-barre[^"]*" data-groupe="cases"/g), 6, 'cases vues et cases tenues à part : avant, A, B');
    const zone = /<g class="ba-panneau" data-groupe="competences"[^>]*>/.exec(barres)![0];
    const b0 = attribut(zone, 'data-y-bas'), b100 = attribut(zone, 'data-y-haut');
    for (const balise of lesBarres) {
      const p = attribut(balise, 'data-p'), haut = attribut(balise, 'data-y');
      proche(haut, b0 + p * (b100 - b0), 0.06);   // la hauteur de la barre est son taux, de 0 à 100 %
    }
    // Les chiffres des barres sont ceux des vecteurs du fichier scellé (recalculés ici sans passer par le modèle).
    const finA = ['A-1', 'A-2', 'A-3'].map((run) => {
      const lignes = lignesDe(join(ex.banc, run, 'cache-scelle.jsonl'));
      const v: string = lignes.find((x) => x.t === 'cache' && x.part === 100)!.vecteur;
      const idx = (lignes[0].competences as string[]).map((c, i) => (c === 'C3' ? i : -1)).filter((i) => i >= 0);
      return idx.filter((i) => v[i] === '1').length / idx.length;
    });
    const attendu = wilsonMoyenne(finA, 20);   // 120 épisodes cachés, six compétences : 20 par compétence
    const c3 = m.cache.competences.series.A.C3;
    proche(c3.p, attendu.p, 1e-12); proche(c3.bas, attendu.bas, 1e-12); proche(c3.haut, attendu.haut, 1e-12);
    const barreC3 = lesBarres.find((b) => /data-serie="A"/.test(b) && /data-comp="C3"/.test(b))!;
    proche(attribut(barreC3, 'data-p'), attendu.p, 1e-4);
  });
});

test('Rapport HTML : autonome (aucune ressource externe), avec les deux graphes, le tableau des chiffres et le bandeau « exemple »', async () => {
  const g = await G();
  await dansUnDossier((d) => {
    const ex: Racines = g.fabriquerExemple(join(d, 'runs'), PETIT);
    const r = g.produire(ex, join(d, 'rapport'), VITE);
    for (const f of ['html', 'courbes', 'competences', 'md', 'json']) assert.ok(existsSync(r.fichiers[f]), `fichier ${f}`);
    const html = readFileSync(r.fichiers.html, 'utf8'), m: Modele = r.modele;
    // Autonome : pas une adresse, pas un script, pas une feuille de style, pas une image, pas une police à aller chercher.
    assert.doesNotMatch(html, /https?:|\/\/[a-z]/i, 'aucune adresse dans la page');
    assert.doesNotMatch(html, /<script|<link|<img|<iframe|<object|<embed|@import|url\(|\ssrc=|<base/i);
    for (const lien of html.match(/href="[^"]*"/g) ?? []) assert.match(lien, /^href="#/, 'seulement des liens dans la page');
    assert.match(html, /^<!doctype html>/i); assert.match(html, /<meta charset="utf-8">/);
    assert.doesNotMatch(html, /NaN|undefined|Infinity|\[object/, 'un nombre ou un texte cassé dans la page');
    assert.equal(compter(html, /<svg[\s>]/g), 2, 'les deux graphes sont dans la page');
    // Les deux SVG écrits à part sont les mêmes dessins, lisibles seuls.
    for (const f of ['courbes', 'competences']) { const svg = readFileSync(r.fichiers[f], 'utf8'); svgBienForme(svg); assert.match(svg, /xmlns="http:\/\/www\.w3\.org\/2000\/svg"/); }
    // Des journaux fabriqués ne passent jamais pour des mesures.
    assert.equal(m.exemple, true);
    assert.match(html, /EXEMPLE FABRIQUÉ/); assert.match(readFileSync(r.fichiers.md, 'utf8'), /EXEMPLE FABRIQUÉ/);
    assert.match(readFileSync(r.fichiers.courbes, 'utf8'), /EXEMPLE FABRIQUÉ/); assert.match(readFileSync(r.fichiers.competences, 'utf8'), /EXEMPLE FABRIQUÉ/);
    // Le tableau porte les chiffres du modèle : écart B − A et son intervalle, taux de fin, sûreté, plus petit écart.
    const pts = (x: number) => (x * 100).toFixed(1).replace(/^-0\.0$/, '0.0').replace('.', ',').replace('-', '−');
    const c = m.cache.comparaison;
    assert.equal(c.tirages, 2000);
    for (const x of [c.tauxA, c.tauxB, c.bas, c.haut, c.basSur, c.parGraines.bas, c.basDecision]) assert.ok(html.includes(pts(x)), `le chiffre ${pts(x)} manque dans la page`);
    assert.ok(html.includes((c.difference >= 0 ? '+' : '') + pts(c.difference)));
    assert.ok(m.cache.ecartDetectable.observe >= m.cache.ecartDetectable.reechantillonnage && m.cache.ecartDetectable.observe >= m.cache.ecartDetectable.parGraines, 'la valeur annoncée est la plus grande des deux méthodes : jamais plus flatteuse');
    proche(m.cache.ecartDetectable.reechantillonnage, 2.8015852 * c.erreurType, 1e-6);
    assert.ok(html.includes(pts(m.cache.ecartDetectable.observe)));
    assert.match(html, /Plus petit écart détectable/); assert.match(html, /McNemar/); assert.match(html, /Holm/); assert.match(html, /Note géométrique/); assert.match(html, /contrôle par graines/);
    for (const comp of ['C1', 'C2', 'C3', 'C4', 'C5', 'C6']) assert.ok(html.includes(`<th scope="row">${comp}`), `ligne ${comp} du tableau`);
    for (const run of ['A-1', 'A-2', 'A-3', 'B-1', 'B-2', 'B-3', 'temoin-1']) assert.ok(html.includes(`<th scope="row">${run}</th>`), `ligne du run ${run}`);
    // La conclusion suit la règle, sur les bornes qui décident ; les limites sont dites.
    assert.ok(['B-mieux', 'pas-demontre', 'A-mieux'].includes(m.verdict.issue), `issue ${m.verdict.issue}`);
    assert.equal(m.verdict.issue === 'B-mieux', c.basDecision > 0);
    assert.ok(html.includes(m.verdict.texte));
    assert.match(html, /monde simulé/); assert.equal(m.temoin.plat, true); assert.deepEqual(m.blocages, []);
    assert.deepEqual(m.surete.B, { entrainement: 0, porte: 0, cache: 0 });
    assert.ok(m.alertes.some((x: string) => /3 graines seulement/.test(x)), 'moins de graines que le plan : dit');
    // Le témoin plat prouve que la mesure est stable, pas davantage : la page ne dit pas plus que sa preuve.
    assert.doesNotMatch(html, /rien n'indique qu'une réponse du banc fuit/);
    assert.match(html, /Cela ne prouve pas, à soi seul, qu'aucune réponse du banc n'a atteint les autres entraînements/);
    assert.match(html, /ne sont pas inaltérables/);
    // La liste des runs prévus et l'ouverture du banc caché sont dites.
    assert.deepEqual(m.prevus && [m.prevus.reference, m.prevus.candidat, m.prevus.temoin, m.prevus.runs], ['A', 'B', 'temoin', 7]);
    assert.equal(m.ouvertures.n, 1); assert.match(html, /Banc caché ouvert 1 fois/);
    // Le fichier des chiffres se relit, sans les vecteurs épisode par épisode.
    const chiffres = JSON.parse(readFileSync(r.fichiers.json, 'utf8'));
    assert.equal(chiffres.cache.comparaison.difference, c.difference);
    assert.doesNotMatch(readFileSync(r.fichiers.json, 'utf8'), /[01]{40}/, 'pas de vecteur réussi / raté dans le fichier des chiffres');
  });
});

test('Rapport : un témoin qui monte suspend la conclusion ; un run pas fini laisse le banc caché scellé', async () => {
  const g = await G();
  await dansUnDossier((d) => {
    // 1. Le témoin n'apprend rien : s'il monte, quelque chose fuit, et on ne conclut pas.
    const f = g.produire(g.fabriquerExemple(join(d, 'fuite'), { ...PETIT, temoinMonte: true }), join(d, 'fuite-rapport'), VITE);
    assert.equal(f.modele.temoin.plat, false);
    assert.equal(f.modele.verdict.issue, 'suspendu');
    assert.ok(f.modele.blocages.some((x: string) => /témoin n'est pas stable/.test(x)));
    assert.match(readFileSync(f.fichiers.html, 'utf8'), /Conclusion suspendue/);
    // 2. Un run sans ligne de fin : le banc caché reste fermé, aucune barre n'est inventée.
    const encours: Racines = g.fabriquerExemple(join(d, 'encours'), { ...PETIT, sansFin: ['B-2'] });
    const e = g.produire(encours, join(d, 'encours-rapport'), VITE);
    assert.equal(e.modele.cache.scelle, true);
    assert.match(e.modele.cache.raison, /B-2/);
    assert.equal(e.modele.verdict.issue, 'suspendu');
    const html = readFileSync(e.fichiers.html, 'utf8');
    assert.match(html, /scellé/);
    assert.equal(compter(html, /class="ba-barre/g), 0, 'pas de barre sans mesure');
    assert.equal(compter(html, /data-banc="cache" data-serie=/g), 0, 'pas de courbe du banc caché');
    assert.ok(compter(html, /<path class="ba-courbe[^"]*" data-banc="porte"/g) >= 3, 'le banc de porte, lui, se dessine en cours de route');
    svgBienForme(readFileSync(e.fichiers.courbes, 'utf8')); svgBienForme(readFileSync(e.fichiers.competences, 'utf8'));
    assert.equal(existsSync(join(encours.banc, 'ouvertures.jsonl')), false, 'rien n\'a été ouvert');
    // 3. Des runs mesurés sur des bancs différents (empreintes qui ne collent pas) : conclusion suspendue.
    const b = g.produire(g.fabriquerExemple(join(d, 'bancs'), { ...PETIT, autreBanc: ['A-2'] }), join(d, 'bancs-rapport'), VITE);
    assert.equal(b.modele.verdict.issue, 'suspendu');
    assert.ok(b.modele.blocages.some((x: string) => /même banc/.test(x)));
  });
});

// ------------------------------------------------------------------------------------------------ journaux retouchés
/** Réécrit un fichier en RECALCULANT la chaîne des lignes. Rend le bout de la chaîne. */
function rechainer(chemin: string, lignes: Brute[], maillon: (t: string) => string): string {
  let pr = ORIGINE;
  const textes = lignes.map((l) => { const t = JSON.stringify({ ...l, pr }); pr = maillon(t); return t; });
  writeFileSync(chemin, textes.map((t) => `${t}\n`).join(''));
  return pr;
}
type Retouche = (lignes: Brute[]) => Brute[] | void;
/**
 * Retouche les fichiers d'un run « avec soin » : les lignes sont changées, la chaîne de chaque fichier est recalculée,
 * et la ligne de clôture est remise d'accord avec les deux autres fichiers. Seul un contrôle de fond peut alors le voir.
 */
function retoucher(maillon: (t: string) => string, ex: Racines, run: string, f: { journal?: Retouche; portes?: Retouche; scelle?: Retouche }): void {
  const cj = join(ex.boucle, run, 'journal.jsonl'), cp = join(ex.banc, run, 'porte.jsonl'), cs = join(ex.banc, run, 'cache-scelle.jsonl');
  const appliquer = (chemin: string, fn?: Retouche) => { const l = lignesDe(chemin); return fn ? fn(l) ?? l : l; };
  const sj = rechainer(cj, appliquer(cj, f.journal), maillon);
  const ss = existsSync(cs) ? rechainer(cs, appliquer(cs, f.scelle), maillon) : null;
  const lp = appliquer(cp, f.portes), clo = lp.find((l) => l.t === 'cloture');
  if (clo) { clo.journal_fin = sj; if (ss) clo.scelle = ss; }
  rechainer(cp, lp, maillon);
}
/** Recompte une mesure du banc caché après avoir changé son vecteur. */
function recompter(plan: Brute, mesure: Brute, vecteur: string): void {
  const par: Record<string, { k: number; n: number }> = {};
  let k = 0;
  (plan.competences as string[]).forEach((c, i) => { const x = (par[c] ??= { k: 0, n: 0 }); x.n++; if (vecteur[i] === '1') { x.k++; k++; } });
  Object.assign(mesure, { vecteur, global: { k, n: plan.n }, par_competence: par });
}
/** La boîte à outils d'un essai de retouche : une base d'exemple fabriquée une fois, copiée pour chaque scénario. */
async function atelier(d: string, options: object = NET) {
  const g = await G();
  const { empreinteLigne } = await J();
  const base: Racines = g.fabriquerExemple(join(d, 'base'), options);
  const copier = (nom: string): Racines => { cpSync(join(d, 'base'), join(d, nom), { recursive: true }); return { boucle: join(d, nom, 'boucle'), banc: join(d, nom, 'banc'), runs: base.runs }; };
  const rapport = (ex: Racines, o: object = {}): Modele => g.produire(ex, join(ex.boucle, '..', 'rapport'), { ...VITE, ...o }).modele;
  const html = (ex: Racines): string => readFileSync(join(ex.boucle, '..', 'rapport', 'rapport.html'), 'utf8');
  const retouche = (ex: Racines, run: string, f: Parameters<typeof retoucher>[3]) => retoucher(empreinteLigne, ex, run, f);
  /** Un scénario : une copie de la base, retouchée, puis son rapport. */
  const scenario = (nom: string, f: (ex: Racines) => void, o: object = {}): Modele => { const ex = copier(nom); f(ex); return rapport(ex, o); };
  const runsDe = (v: string) => base.runs.filter((r) => r.startsWith(`${v}-`));
  return { g, base, copier, rapport, html, retouche, scenario, runsDe };
}
/** La conclusion est suspendue, pour la raison attendue — et pas à cause de la retouche elle-même (chaîne, clôture). */
function suspendu(m: Modele, motif: RegExp, quoi: string): void {
  assert.equal(m.verdict.issue, 'suspendu', `${quoi} : la conclusion devait être suspendue (${m.verdict.texte})`);
  assert.ok(m.blocages.some((b: string) => motif.test(b)), `${quoi} : blocage attendu ${motif} ; vus : ${m.blocages.join(' | ')}`);
  assert.ok(!m.blocages.some((b: string) => /chaîne des lignes|après la clôture|première ouverture/.test(b)), `${quoi} : arrêté par la retouche elle-même, pas par le contrôle visé (${m.blocages.join(' | ')})`);
}

test('Rapport : « B fait mieux » ne se dit pas avec des graines qui manquent — on compte celles qui sont vraiment mesurées', async () => {
  await dansUnDossier(async (d) => {
    const a = await atelier(d);
    // La base : cinq graines de chaque côté, toutes mesurées, un écart net. Le rapport conclut.
    const base = a.rapport(a.copier('net'));
    assert.equal(base.verdict.issue, 'B-mieux'); assert.deepEqual(base.blocages, []);
    assert.equal(base.verdict.texte, 'B fait mieux que A sur le banc caché.');
    assert.deepEqual(base.cache.graines, { A: [1, 2, 3, 4, 5], B: [1, 2, 3, 4, 5] });
    assert.match(a.html({ ...a.base, boucle: join(d, 'net', 'boucle') }), /class="boite bon"/);
    // La mesure cachée a planté sur quatre runs de B : il ne reste qu'UNE graine de B vraiment mesurée.
    const ex = a.copier('une-graine');
    for (const run of ['B-2', 'B-3', 'B-4', 'B-5']) rmSync(join(ex.banc, run, 'cache-scelle.jsonl'));
    const une = a.rapport(ex);
    suspendu(une, /B : 1 graine vraiment mesurée à la fin sur le banc caché \(5 journaux\)/, 'une seule graine mesurée');
    assert.ok(une.blocages.some((b: string) => /B-2 : pas de mesure lisible du banc caché/.test(b)), 'un run qui apprend sans mesure cachée suspend, il n\'alerte pas seulement');
    assert.ok(une.blocages.some((b: string) => /A et B ne sont pas mesurés sur les mêmes graines \(A : 1, 2, 3, 4, 5 ; B : 1\)/.test(b)));
    assert.equal(une.cache.comparaison.grainesB, 1); assert.equal(une.cache.comparaison.basDecision, null, 'avec une graine, rien ne se décide');
    assert.doesNotMatch(a.html(ex), /class="boite bon"/); assert.match(a.html(ex), /pour examen, sans conclusion/);
    // Trois fichiers scellés effacés (deux graines mesurées), puis un seul (quatre) : toujours suspendu.
    const deux = a.scenario('deux-graines', (e) => { for (const run of ['B-1', 'B-2', 'B-3']) rmSync(join(e.banc, run, 'cache-scelle.jsonl')); });
    suspendu(deux, /B : 2 graines vraiment mesurées/, 'deux graines mesurées');
    const quatre = a.scenario('quatre-graines', (e) => rmSync(join(e.banc, 'B-5', 'cache-scelle.jsonl')));
    suspendu(quatre, /ne sont pas mesurés sur les mêmes graines/, 'quatre graines contre cinq');
    // Une mesure de fin qui manque (le fichier est là, pas sa ligne à 100 %) compte comme une graine qui manque.
    const sansFin = a.scenario('sans-100', (e) => a.retouche(e, 'B-4', { scelle: (l) => l.filter((x) => !(x.t === 'cache' && x.part === 100)) }));
    suspendu(sansFin, /B-4 : pas de mesure du banc caché à 100 %/, 'pas de mesure à 100 %');
    assert.deepEqual(sansFin.cache.graines.B, [1, 2, 3, 5]);
  });
});

test('Rapport : une seule graine de chaque côté, ou deux, ne conclut pas ; trois, c\'est dit fragile', async () => {
  const g = await G();
  await dansUnDossier((d) => {
    for (const graines of [1, 2]) {
      const m = g.produire(g.fabriquerExemple(join(d, `g${graines}`), { ...PETIT, graines, avance: 3 }), join(d, `g${graines}-rapport`), VITE).modele;
      assert.equal(m.verdict.issue, 'suspendu');
      assert.ok(m.blocages.some((x: string) => new RegExp(`B : ${graines} graines?\\. Il en faut au moins 3 de chaque côté`).test(x)), m.blocages.join(' | '));
    }
    const trois = g.produire(g.fabriquerExemple(join(d, 'g3'), { ...PETIT, avance: 3 }), join(d, 'g3-rapport'), VITE).modele;
    assert.deepEqual(trois.blocages, []);
    assert.ok(trois.alertes.some((x: string) => /B : 3 graines seulement\. Le plan en prévoit 5/.test(x)));
  });
});

test('Rapport : le banc caché ne s\'ouvre pas avant la fin de tous les runs prévus, et on ne choisit pas ses graines', async () => {
  await dansUnDossier(async (d) => {
    const a = await atelier(d);
    const g = a.g;
    // 1. Deux runs pas finis : fermé. Les écarter ne l'ouvre pas.
    const pasFinis: Racines = g.fabriquerExemple(join(d, 'pas-finis'), { ...NET, sansFin: ['B-4', 'B-5'] });
    for (const o of [{}, { sans: ['B-4', 'B-5'] }]) {
      const m = g.construire(g.rassembler(pasFinis, o), VITE);
      assert.equal(m.cache.scelle, true); assert.match(m.cache.raison, /pas finis : B-4, B-5/); assert.equal(m.cache.comparaison, null);
      assert.equal(m.surete.B.cache, null);
    }
    assert.equal(existsSync(join(pasFinis.banc, 'ouvertures.jsonl')), false);
    // 2. Des runs prévus mais pas encore lancés (dossiers vides, ou pas de dossier du tout) : fermé.
    const pasLances = a.scenario('pas-lances', (e) => { for (const run of ['B-3', 'B-4', 'B-5']) { rmSync(join(e.boucle, run), { recursive: true }); rmSync(join(e.banc, run), { recursive: true }); } mkdirSync(join(e.boucle, 'B-3')); });
    assert.equal(pasLances.cache.scelle, true); assert.match(pasLances.cache.raison, /pas finis : B-3, B-4, B-5/); assert.equal(pasLances.verdict.issue, 'suspendu');
    // 3. Une ligne « fin » écrite par la boucle ne suffit pas : il faut la clôture du banc.
    const pasClos = g.construire(g.rassembler(g.fabriquerExemple(join(d, 'pas-clos'), { ...NET, sansCloture: ['B-2'] })), VITE);
    assert.equal(pasClos.cache.scelle, true); assert.match(pasClos.cache.raison, /pas clos par le banc : B-2/);
    // 4. Choisir ses graines (écarter les deux moins bonnes de B et les deux meilleures de A) : les chiffres sortent,
    //    pour examen, mais la conclusion est suspendue, et la boîte n'est jamais verte.
    const ex = a.copier('cueillette');
    const taux = (run: string) => { const x = lignesDe(join(ex.banc, run, 'cache-scelle.jsonl')).find((l) => l.t === 'cache' && l.part === 100)!; return x.global.k / x.global.n; };
    const pires = [...a.runsDe('B')].sort((x, y) => taux(x) - taux(y)).slice(0, 2), meilleurs = [...a.runsDe('A')].sort((x, y) => taux(y) - taux(x)).slice(0, 2);
    const cueilli = a.rapport(ex, { sans: [...pires, ...meilleurs] });
    assert.equal(cueilli.verdict.issue, 'suspendu');
    assert.ok(cueilli.blocages.some((b: string) => /4 runs écartés à la main/.test(b)));
    assert.equal(cueilli.cache.comparaison.grainesA, 3); assert.ok(cueilli.cache.comparaison.bas > 0, 'les chiffres triés sont flatteurs : c\'est bien pourquoi on ne conclut pas');
    assert.doesNotMatch(a.html(ex), /class="boite bon"/);
    // Écarter la même graine des deux côtés : mêmes graines, mais toujours pas de conclusion.
    const pareil = a.scenario('meme-graine', () => {}, { sans: ['A-5', 'B-5'] });
    assert.equal(pareil.verdict.issue, 'suspendu');
    assert.ok(!pareil.blocages.some((b: string) => /mêmes graines/.test(b)) && pareil.blocages.some((b: string) => /2 runs écartés à la main \(A-5, B-5\)/.test(b)));
    assert.throws(() => a.rapport(a.copier('inconnu'), { sans: ['B-99', 'b-2'] }), /inconnus : B-99, b-2/);
    // 5. Un fichier scellé qui change après la première ouverture du banc caché.
    const apres = a.copier('apres-ouverture');
    assert.equal(a.rapport(apres).verdict.issue, 'B-mieux');
    a.retouche(apres, 'A-1', { scelle: (l) => { const x = l.find((y) => y.t === 'cache' && y.part === 100)!; const i = (x.vecteur as string).indexOf('1'); recompter(l[0], x, `${x.vecteur.slice(0, i)}0${x.vecteur.slice(i + 1)}`); } });
    const change = a.rapport(apres);
    assert.equal(change.verdict.issue, 'suspendu'); assert.equal(change.ouvertures.n, 2);
    assert.ok(change.blocages.some((b: string) => /A-1 : le fichier scellé n'a plus l'empreinte notée à sa première ouverture/.test(b)));
  });
});

test('Rapport : le témoin doit rester plat pour de bon — épisode par épisode, mesuré comme les autres, sans rien apprendre', async () => {
  await dansUnDossier(async (d) => {
    const a = await atelier(d);
    assert.equal(a.rapport(a.copier('net')).temoin.plat, true);
    // a. Sur le banc caché, le témoin change d'épisodes réussis sans changer aucun compte (un réussi contre un raté,
    //    dans la même compétence).
    const echange = a.scenario('echange', (e) => a.retouche(e, 'temoin-1', { scelle: (l) => {
      const plan = l[0];
      for (const x of l) if (x.t === 'cache' && x.part > 0) {
        const v = (x.vecteur as string).split(''), c1 = (plan.competences as string[]).map((c, i) => (c === 'C1' ? i : -1)).filter((i) => i >= 0);
        const un = c1.find((i) => v[i] === '1')!, zero = c1.find((i) => v[i] === '0')!;
        v[un] = '0'; v[zero] = '1';
        const avant = JSON.stringify(x.par_competence);
        recompter(plan, x, v.join(''));
        assert.equal(JSON.stringify(x.par_competence), avant, 'les comptes ne bougent pas');
      }
    } }));
    suspendu(echange, /témoin n'est pas stable : jusqu'à 1,7 % des épisodes changent de résultat/, 'témoin qui échange deux épisodes');
    assert.equal(echange.temoin.plat, false);
    // b. Sur le banc de porte : +2 dans une compétence, −2 dans une autre, même total.
    const porte = a.scenario('porte', (e) => a.retouche(e, 'temoin-1', { portes: (l) => { for (const x of l) if (x.t === 'mesure' && x.pas > 0) { x.par_competence.C3.k += 2; x.par_competence.C1.k -= 2; } } }));
    suspendu(porte, /témoin n'est pas stable/, 'témoin qui bouge par compétence sur le banc de porte');
    // c. Le témoin mesuré une seule fois, au départ.
    const uneFois = a.scenario('une-fois', (e) => a.retouche(e, 'temoin-1', { portes: (l) => l.filter((x) => !(x.t === 'mesure' && x.pas > 0)), scelle: (l) => l.filter((x) => !(x.t === 'cache' && x.part > 0)) }));
    suspendu(uneFois, /temoin-1 : le témoin n'a qu'une mesure du banc de porte/, 'témoin mesuré une fois');
    assert.ok(uneFois.blocages.some((b: string) => /temoin-1 : pas de mesure du banc caché à 25, 50, 75, 100 %/.test(b)));
    assert.ok(uneFois.blocages.some((b: string) => /pas mesuré aux mêmes points que les autres/.test(b)));
    // … ou mesuré à moins de points que les autres.
    const troue = a.scenario('troue', (e) => a.retouche(e, 'temoin-1', { portes: (l) => l.filter((x) => !(x.t === 'mesure' && x.pas > 0 && x.pas < 600)) }));
    suspendu(troue, /pas mesuré aux mêmes points que les autres \(5 points du banc de porte sans mesure, le premier à 100 épisodes\)/, 'témoin à trous');
    // d. Le témoin sans fichier scellé.
    const sansScelle = a.scenario('sans-scelle', (e) => rmSync(join(e.banc, 'temoin-1', 'cache-scelle.jsonl')));
    suspendu(sansScelle, /temoin-1 : pas de mesure lisible du banc caché/, 'témoin sans fichier scellé');
    assert.equal(sansScelle.temoin.plat, false);
    // e. Le journal du témoin dit qu'il apprend, ou la porte lui garde un candidat.
    const apprend = a.scenario('apprend', (e) => a.retouche(e, 'temoin-1', { journal: (l) => { for (const x of l) if (x.t === 'episode') x.maj = { aiguilleur: 1, geste: 1, liens_plus: 2, liens_moins: 0, contre_ex: 0 }; } }));
    suspendu(apprend, /temoin-1 : le journal du témoin compte 2400 mises à jour\. Un témoin n'apprend rien/, 'témoin qui apprend');
    const garde = a.scenario('garde', (e) => a.retouche(e, 'temoin-1', {
      portes: (l) => { const i = l.findIndex((x) => x.t === 'mesure' && x.pas === 600), m = l[i]; l.splice(i, 0, { v: 2, t: 'porte', run: 'temoin-1', pas: 600, consultation: 1, en_service: m.global, candidat: m.global, diff_moy: 0, et_diff: 0, marge: 0, surete_candidat: 0, decision: 'refuse', ms: 1 }, { v: 2, t: 'porte', run: 'temoin-1', pas: 600, consultation: 2, en_service: { k: m.global.k - 4, n: m.global.n }, candidat: m.global, diff_moy: 4 / m.global.n, et_diff: 0.0207, marge: 0.0207, surete_candidat: 0, decision: 'garde', ms: 1 }); },
      journal: (l) => { l.at(-1)!.portes = { gardees: 1, refusees: 1 }; },
    }));
    assert.equal(garde.verdict.issue, 'suspendu');
    assert.ok(garde.blocages.some((b: string) => /temoin-1 : 1 porte gardée pour le témoin\. Un témoin ne change jamais d'état/.test(b)), garde.blocages.join(' | '));
    // Sans témoin lisible du tout.
    const absent = a.scenario('absent', (e) => { writeFileSync(join(e.boucle, 'temoin-1', 'journal.jsonl'), ''); });
    assert.ok(absent.cache.scelle, 'un témoin sans journal fini : le banc caché reste fermé');
  });
});

test('Rapport : un budget ou des réglages inégaux suspendent la conclusion ; chaque point est posé au vrai nombre d\'épisodes', async () => {
  await dansUnDossier(async (d) => {
    const a = await atelier(d);
    const g = a.g;
    const base = a.rapport(a.copier('net'));
    assert.deepEqual(base.blocages, [], 'les réglages propres à chaque entraînement (exploration…) ont le droit de différer');
    assert.ok(base.budget.B.essais > base.budget.A.essais && base.budget.A.episodes === base.runs.filter((r: Brute) => r.variante === 'A').reduce((s: number, r: Brute) => s + r.pas, 0));
    // A plafonné à 300 épisodes, B à 600 : B a deux fois plus de budget.
    const inegal: Racines = g.fabriquerExemple(join(d, 'inegal'), { ...NET, pasPar: { A: 300 } });
    const m = g.produire(inegal, join(d, 'inegal-rapport'), VITE).modele;
    suspendu(m, /Le réglage « pas_max » n'est pas le même pour tous les runs \(300 : A-1, A-2, A-3… \(5 en tout\) ; 600 : /, 'plafonds d\'épisodes inégaux');
    // Le dessin ne prolonge plus un entraînement arrêté tôt : la courbe de A s'arrête à ses 300 épisodes au plus.
    const finA = m.cache.series.A.at(-1), finB = m.cache.series.B.at(-1);
    assert.ok(finA.pasMax <= 300 && finA.pas <= 300, `dernier point de A à ${finA.pas} épisodes`);
    assert.ok(finB.pas > 300);
    const vraisPas = ['A-1', 'A-2', 'A-3', 'A-4', 'A-5'].map((run) => lignesDe(join(inegal.banc, run, 'cache-scelle.jsonl')).find((l) => l.t === 'cache' && l.part === 100)!.pas as number);
    proche(finA.pas, vraisPas.reduce((s, x) => s + x, 0) / 5, 1e-9);
    const courbes: string = g.svgCourbes(m);
    const dernierX = (serie: string) => Number(new RegExp(`<path class="ba-courbe[^"]*" data-banc="cache" data-serie="${serie}"[^>]*\\sd="([^"]+)"`).exec(courbes)![1].trim().split(/\s*[ML]\s*/).filter(Boolean).at(-1)!.split(/[ ,]+/)[0]);
    assert.ok(dernierX('A') < dernierX('B') - 50, 'sur le dessin, A s\'arrête bien avant B');
    assert.match(readFileSync(join(d, 'inegal-rapport', 'rapport.html'), 'utf8'), /Le budget de chaque entraînement/);
    // Des en-têtes de B avec d'autres réglages communs (lot plus petit, plus d'essais, plus de temps).
    const reglages = a.scenario('reglages', (e) => { for (const run of a.runsDe('B')) a.retouche(e, run, { journal: (l) => { l[0].reglages = { ...l[0].reglages, lot: 25, essais_max: 50, temps_max_s: 99999 }; } }); });
    suspendu(reglages, /Le réglage « lot » n'est pas le même pour tous les runs/, 'lot différent');
    assert.ok(reglages.blocages.some((b: string) => /« essais_max »/.test(b)) && reglages.blocages.some((b: string) => /« temps_max_s »/.test(b)));
    // Deux fois plus de lignes d'épisode que d'épisodes annoncés (les mêmes pas rejoués).
    const double = a.scenario('double', (e) => { for (const run of a.runsDe('B')) a.retouche(e, run, { journal: (l) => { const fin = l.pop()!; const eps = l.filter((x) => x.t === 'episode'); return [...l, ...eps.map((x) => ({ ...x, ep: 'ffffffffffff' })), fin]; } }); });
    suspendu(double, /B-1 : \d+ pas rejoués \(deux lignes d'épisode pour le même pas\)/, 'épisodes rejoués');
    assert.ok(double.blocages.some((b: string) => /B-1 : \d+ lignes d'épisode pour \d+ épisodes annoncés à la fin/.test(b)));
    assert.equal(double.budget.B.lignes, 2 * base.budget.B.lignes, 'le tableau du budget montre les lignes, pas seulement le pas de fin');
    // Plus d'épisodes vus que le plafond écrit dans l'en-tête.
    const plafond = a.scenario('plafond', (e) => { for (const run of e.runs) a.retouche(e, run, { journal: (l) => { l[0].reglages = { ...l[0].reglages, pas_max: 200 }; } }); });
    suspendu(plafond, /épisodes vus pour un plafond de 200/, 'plafond d\'épisodes dépassé');
  });
});

test('Rapport : la porte est recomptée — candidat fautif gardé, lot gardé sous la marge, retour arrière qui n\'a pas eu lieu', async () => {
  await dansUnDossier(async (d) => {
    const a = await atelier(d);
    const base = a.rapport(a.copier('net'));
    assert.deepEqual([base.portes.B.refuseesPourFaute, base.portes.B.gardeesAvecFaute], [0, 0]);
    // La première porte gardée de chaque graine de B a gardé un candidat à 4 fautes de sûreté ; les mesures disent 0.
    const fautif = a.scenario('fautif', (e) => { for (const run of a.runsDe('B')) a.retouche(e, run, { portes: (l) => { l.find((x) => x.t === 'porte' && x.decision === 'garde')!.surete_candidat = 4; } }); });
    suspendu(fautif, /B-1 : la porte ne suit pas sa règle — à \d+ épisodes, candidat gardé avec 4 fautes de sûreté : une faute refuse toujours/, 'candidat fautif gardé');
    assert.deepEqual([fautif.portes.B.refuseesPourFaute, fautif.portes.B.gardeesAvecFaute], [0, 5], 'ces portes ne sont pas rangées parmi les « refusées pour une faute »');
    assert.equal(fautif.surete.B.porte, 20, 'les fautes d\'un candidat gardé comptent pour le banc de porte');
    // Un candidat fautif REFUSÉ, lui, est dans la bonne colonne, et ne suspend rien.
    const refuse = a.scenario('refuse', (e) => a.retouche(e, 'B-1', { portes: (l) => { l.find((x) => x.t === 'porte' && x.decision === 'refuse')!.surete_candidat = 2; } }));
    assert.equal(refuse.verdict.issue, 'B-mieux'); assert.deepEqual([refuse.portes.B.refuseesPourFaute, refuse.portes.B.gardeesAvecFaute], [1, 0]);
    // Toutes les portes « refuse » de B réécrites « garde » : la différence ne dépasse pas la marge.
    const sousMarge = a.scenario('sous-marge', (e) => { for (const run of a.runsDe('B')) a.retouche(e, run, { portes: (l) => { for (const x of l) if (x.t === 'porte') x.decision = 'garde'; }, journal: (l) => { const fin = l.at(-1)!; fin.portes = { gardees: fin.portes.gardees + fin.portes.refusees, refusees: 0 }; } }); });
    suspendu(sousMarge, /la porte ne suit pas sa règle — à \d+ épisodes, candidat gardé alors que la différence \(-?[\d.]+\) ne dépasse pas la marge/, 'gardé sous la marge');
    // Après un refus, la mesure qui suit est celle du candidat refusé : l'état n'est pas revenu en arrière.
    const sansRetour = a.scenario('sans-retour', (e) => a.retouche(e, 'B-2', { portes: (l) => {
      const i = l.findIndex((x) => x.t === 'porte' && x.decision === 'refuse' && x.candidat.k !== x.en_service.k), p = l[i], m = l.slice(i + 1).find((x) => x.t === 'mesure' && x.pas === p.pas)!;
      const dk = p.candidat.k - m.global.k, c = Object.keys(m.par_competence).find((k) => m.par_competence[k].k + dk >= 0 && m.par_competence[k].k + dk <= m.par_competence[k].n)!;
      m.global.k += dk; m.par_competence[c].k += dk;
    } }));
    suspendu(sansRetour, /B-2 : la porte ne suit pas sa règle — à \d+ épisodes, après un lot refusé, la mesure \(\d+ sur 96\) n'est pas celle de l'état d'avant \(\d+\) : le retour arrière n'a pas eu lieu/, 'pas de retour arrière');
    // L'état en service change sans passer par la porte (la première mesure ne colle pas à la première porte).
    const glisse = a.scenario('glisse', (e) => a.retouche(e, 'B-3', { portes: (l) => { const m = l.find((x) => x.t === 'mesure' && x.pas === 0)!; const c = Object.keys(m.par_competence).find((k) => m.par_competence[k].k > 0)!; m.global.k -= 1; m.par_competence[c].k -= 1; } }));
    suspendu(glisse, /B-3 : la porte ne suit pas sa règle — à 100 épisodes, l'état en service \(\d+ sur 96\) n'est pas celui de la dernière mesure/, 'état qui glisse');
    // La boucle et le banc ne comptent pas les mêmes portes.
    const comptes = a.scenario('comptes', (e) => a.retouche(e, 'A-2', { journal: (l) => { l.at(-1)!.portes.gardees += 2; } }));
    suspendu(comptes, /A-2 : la boucle dit \d+ portes gardées et \d+ refusées ; le banc en a noté/, 'comptes de portes différents');
    // Une ligne de porte en moins (une consultation cachée) : les numéros ne se suivent plus.
    const cachee = a.scenario('cachee', (e) => a.retouche(e, 'A-3', { portes: (l) => { const i = l.findIndex((x) => x.t === 'porte' && x.decision === 'refuse'); return l.filter((_, k) => k !== i); }, journal: (l) => { l.at(-1)!.portes.refusees -= 1; } }));
    suspendu(cachee, /A-3 : la porte ne suit pas sa règle — à \d+ épisodes, la consultation porte le numéro \d+ à la place de \d+/, 'consultation cachée');
    assert.match(a.html({ ...a.base, boucle: join(d, 'fautif', 'boucle') }), /Candidats gardés avec une faute \(doit rester à 0\)/);
  });
});

test('Rapport : un run copié ne fait pas une graine de plus ; un journal qui n\'est pas celui de la liste suspend', async () => {
  await dansUnDossier(async (d) => {
    const a = await atelier(d);
    const base = a.rapport(a.copier('net'));
    // Le dossier de la meilleure graine de B copié quatre fois sous d'autres noms : ces dossiers ne sont pas dans la
    // liste des runs prévus, ils ne sont pas lus. Les chiffres ne bougent pas.
    const copies = a.scenario('copies', (e) => { for (const nom of ['B-6', 'B-7', 'B-8', 'B-9']) { cpSync(join(e.boucle, 'B-1'), join(e.boucle, nom), { recursive: true }); cpSync(join(e.banc, 'B-1'), join(e.banc, nom), { recursive: true }); } });
    assert.equal(copies.cache.comparaison.grainesB, 5); assert.equal(copies.runs.length, 11);
    assert.equal(copies.cache.comparaison.difference, base.cache.comparaison.difference);
    assert.deepEqual(copies.horsListe, ['B-6', 'B-7', 'B-8', 'B-9']);
    assert.ok(copies.alertes.some((x: string) => /Dossiers hors de la liste des runs prévus, non lus : B-6, B-7, B-8, B-9/.test(x)));
    // Le journal d'une bonne graine mis à la place d'une autre : le nom du dossier n'est pas celui de l'en-tête.
    const remplace = a.scenario('remplace', (e) => { cpSync(join(e.boucle, 'B-1', 'journal.jsonl'), join(e.boucle, 'B-2', 'journal.jsonl')); });
    assert.equal(remplace.verdict.issue, 'suspendu');
    assert.ok(remplace.blocages.some((b: string) => /B-2 : l'en-tête du journal dit « B-1 », variante B, graine 1 ; la liste des runs prévus attend « B-2 », variante B, graine 2/.test(b)), remplace.blocages.join(' | '));
    // Un run lancé hors de la liste (son en-tête ne porte pas l'empreinte de la liste).
    const horsListe = a.scenario('hors-liste', (e) => a.retouche(e, 'A-4', { journal: (l) => { l[0].prevus = H('9'); } }));
    suspendu(horsListe, /A-4 : l'en-tête ne porte pas l'empreinte de la liste des runs prévus/, 'run hors de la liste');
    // La liste elle-même retouchée après coup (une graine changée) : plus aucun en-tête ne la reconnaît.
    const liste = a.scenario('liste', (e) => { const c = join(e.banc, 'prevus.json'); writeFileSync(c, readFileSync(c, 'utf8').replace('"cree": "2026-01-01T00:00:00Z"', '"cree": "2026-01-02T00:00:00Z"')); });
    suspendu(liste, /l'en-tête ne porte pas l'empreinte de la liste des runs prévus/, 'liste retouchée');
  });
});

test('Rapport : les mesures du banc caché sont tenues — pas de seconde mesure, pas de pas impossible, le bon banc, le manifeste', async () => {
  await dansUnDossier(async (d) => {
    const a = await atelier(d);
    const base = a.rapport(a.copier('net'));
    // Une seconde mesure « 100 % » ajoutée à chaque run de A, avec 20 réussites de plus : elle n'est jamais prise
    // (avant, la dernière ligne gagnait en silence et la conclusion s'inversait).
    const seconde = a.scenario('seconde', (e) => { for (const run of a.runsDe('A')) a.retouche(e, run, { scelle: (l) => {
      const der = l.find((x) => x.t === 'cache' && x.part === 100)!, v = (der.vecteur as string).split('');
      let n = 0; for (let i = 0; i < v.length && n < 20; i++) if (v[i] === '0') { v[i] = '1'; n++; }
      const ajout = { ...der, pas: 999999 }; recompter(l[0], ajout, v.join('')); l.push(ajout);
    } }); });
    assert.equal(seconde.verdict.issue, 'suspendu');
    assert.ok(seconde.blocages.some((b: string) => /A-1 : le banc caché est mesuré plus d'une fois à 100 %\. Seule la première mesure est prise/.test(b)), seconde.blocages.join(' | '));
    assert.equal(seconde.cache.final.A.p, base.cache.final.A.p, 'la première mesure reste celle qui compte');
    assert.equal(seconde.cache.comparaison.difference, base.cache.comparaison.difference);
    // Une mesure datée d'un pas que le run n'a jamais atteint.
    const tard = a.scenario('tard', (e) => a.retouche(e, 'A-2', { scelle: (l) => { l.find((x) => x.t === 'cache' && x.part === 100)!.pas = 999999; } }));
    suspendu(tard, /A-2 : mesure du banc caché au pas 999999, après le pas de fin \(\d+\)/, 'pas impossible');
    // Le plan du fichier scellé porte une autre empreinte que le banc caché de l'en-tête (dans tous les runs).
    const autrePlan = a.scenario('autre-plan', (e) => { for (const run of e.runs) a.retouche(e, run, { scelle: (l) => { l[0].empreinte = H('f'); } }); });
    suspendu(autrePlan, /le plan du fichier scellé ne porte pas l'empreinte du banc caché dite dans l'en-tête/, 'plan d\'un autre banc');
    // Le manifeste du banc figé : les empreintes des en-têtes lui sont comparées.
    const entete = lignesDe(join(a.base.boucle, 'A-1', 'journal.jsonl'))[0];
    let numero = 0;
    const manifeste = (o: object = {}) => { const c = join(d, `manifeste-${++numero}.json`); writeFileSync(c, JSON.stringify({ version: 1, banc: 'BA-1', algorithme: 'sha256', fichiers: { 'test/soul-banc/jeux/actions-porte.json': entete.banc_porte, 'test/soul-banc/jeux/actions-cache.json': entete.banc_cache, 'test/soul-banc/jeux/actions-monde.json': entete.monde, ...o }, comptes: { porte: { total: 96 }, cache: { total: 120 } } })); return c; };
    const avec = a.scenario('manifeste', () => {}, { manifeste: manifeste() });
    assert.equal(avec.verdict.issue, 'B-mieux'); assert.deepEqual(avec.manifeste, { banc: 'BA-1' });
    const autreBanc = a.scenario('autre-banc', () => {}, { manifeste: manifeste({ 'test/soul-banc/jeux/actions-cache.json': H('1') }) });
    suspendu(autreBanc, /L'empreinte du banc caché n'est pas celle du manifeste du banc figé/, 'banc qui n\'est pas celui du manifeste');
    const autreCompte = a.copier('autre-compte'), cm = manifeste();
    writeFileSync(cm, readFileSync(cm, 'utf8').replace('"cache":{"total":120}', '"cache":{"total":600}'));
    suspendu(a.rapport(autreCompte, { manifeste: cm }), /Le banc caché mesuré compte 120 épisodes ; le manifeste en compte 600/, 'nombre d\'épisodes');
    assert.throws(() => a.rapport(a.copier('sans-manifeste'), { manifeste: join(d, 'absent.json') }), /manifeste du banc illisible/);
    // De vrais runs (pas des journaux d'exemple) sans manifeste : rien ne dit sur quel banc ils ont été mesurés.
    const vrais = a.copier('vrais');
    for (const run of vrais.runs) a.retouche(vrais, run, { journal: (l) => { const { exemple: _e, ...reste } = l[0].reglages; l[0].reglages = reste; } });
    const sans = a.rapport(vrais);
    suspendu(sans, /Le manifeste du banc figé n'a pas été donné/, 'vrais runs sans manifeste');
    assert.equal(sans.exemple, false);
    const vraisAvec = a.rapport(vrais, { manifeste: manifeste() });
    assert.equal(vraisAvec.verdict.issue, 'B-mieux'); assert.doesNotMatch(a.html(vrais), /EXEMPLE FABRIQUÉ/);
  });
});

test('Rapport : la sûreté compte pour les deux entraînements, à chaque mesure, et faute par faute', async () => {
  await dansUnDossier(async (d) => {
    const a = await atelier(d);
    // Sur le banc caché, à la mesure de 50 % (pas la dernière) : B est écarté.
    const cache = a.scenario('cache', (e) => a.retouche(e, 'B-2', { scelle: (l) => { l.find((x) => x.t === 'cache' && x.part === 50)!.surete = 1; } }));
    assert.deepEqual(cache.surete.B, { entrainement: 0, porte: 0, cache: 1 });
    assert.equal(cache.verdict.issue, 'B-ecarte'); assert.equal(cache.verdict.texte, 'B n\'est pas retenu : 1 faute de sûreté.');
    assert.match(a.html({ ...a.base, boucle: join(d, 'cache', 'boucle') }), /B n'est pas retenu : 1 faute de sûreté/);
    // Sur le banc de porte (l'état en service), et pendant l'entraînement (dit à part, la règle ne regarde que les bancs).
    // Deux épisodes à trois fautes chacun font six fautes, pas deux.
    const porte = a.scenario('porte', (e) => a.retouche(e, 'B-1', {
      portes: (l) => { l.find((x) => x.t === 'mesure' && x.pas === 200)!.surete = 2; },
      journal: (l) => { let n = 0; for (const x of l) if (x.t === 'episode' && n < 2) { Object.assign(x, { surete: 3, r: -1, issue: 'rate', rang_retenu: null }); n++; } },
    }));
    assert.deepEqual(porte.surete.B, { entrainement: 6, porte: 2, cache: 0 });
    assert.equal(porte.verdict.issue, 'B-ecarte');
    assert.ok(porte.alertes.some((x: string) => /B : 6 fautes de sûreté pendant l'entraînement/.test(x)));
    assert.deepEqual(porte.surete.A, { entrainement: 0, porte: 0, cache: 0 });
    // Un épisode « réussi » avec une faute de sûreté (écrit à la main) : la faute est comptée, et la ligne suspend.
    const reussi = a.scenario('reussi', (e) => a.retouche(e, 'A-1', { journal: (l) => { const x = l.find((y) => y.t === 'episode' && y.r === 1)!; x.surete = 1; } }));
    assert.equal(reussi.surete.A.entrainement, 1);
    suspendu(reussi, /A-1 : 1 ligne d'épisode incohérente/, 'épisode réussi avec une faute');
    // Dans l'autre sens : ici A fait mieux que B (le candidat recule), et A a des fautes sur le banc caché.
    const recul = await atelier(join(d, 'recul'), { ...NET, avance: -3 });
    const propre = recul.rapport(recul.copier('propre'));
    assert.equal(propre.verdict.issue, 'A-mieux'); assert.equal(propre.verdict.texte, 'B fait moins bien que A sur le banc caché.');
    const fautes = recul.scenario('fautes', (e) => { for (const run of recul.runsDe('A')) recul.retouche(e, run, { scelle: (l) => { l.find((x) => x.t === 'cache' && x.part === 100)!.surete = 5; } }); });
    assert.equal(fautes.surete.A.cache, 25);
    assert.equal(fautes.verdict.issue, 'A-ecarte');
    assert.equal(fautes.verdict.texte, 'B réussit moins que A sur le banc caché, mais A n\'est pas retenu : 25 fautes de sûreté.');
    const page = recul.html({ ...recul.base, boucle: join(d, 'recul', 'fautes', 'boucle') });
    assert.match(page, /class="boite alerte"/); assert.doesNotMatch(page, /fait moins bien que A/);
  });
});

test('Rapport : aucune option ne change la conclusion en silence — tolérance bornée et dite, tirages en nombre, graine que personne ne choisit', async () => {
  await dansUnDossier(async (d) => {
    const a = await atelier(d);
    const g = a.g;
    const lu = g.rassembler(a.copier('net'));
    // Trop peu de tirages : refusé (un seul tirage donnait un « intervalle » d'un point, et « B fait mieux »).
    for (const tirages of [0, 1, 50, 1999, 2000.5]) assert.throws(() => g.construire(lu, { ...VITE, tirages }), /au moins 2000/, `tirages ${tirages}`);
    assert.throws(() => g.construire(lu, { ...VITE, tiragesBandes: 10 }), /au moins 200/);
    // La tolérance du témoin a un plafond : un témoin qui bouge de plusieurs points ne devient pas « plat » par réglage.
    for (const toleranceTemoin of [100, 5, 1.01, -1]) assert.throws(() => g.construire(lu, { ...VITE, toleranceTemoin }), /de 0 à 1 point/, `tolérance ${toleranceTemoin}`);
    const monte = g.rassembler(g.fabriquerExemple(join(d, 'monte'), { ...NET, temoinMonte: true }));
    assert.equal(g.construire(monte, { ...VITE, toleranceTemoin: 1 }).verdict.issue, 'suspendu', 'même à la tolérance la plus large');
    // Un témoin dont UN épisode change (0,83 %) : suspendu par défaut ; toléré à 1 point, mais c'est écrit dans la conclusion.
    const ex = a.copier('un-episode');
    a.retouche(ex, 'temoin-1', { scelle: (l) => { const x = l.find((y) => y.t === 'cache' && y.part === 100)!; const i = (x.vecteur as string).indexOf('0'); recompter(l[0], x, `${x.vecteur.slice(0, i)}1${x.vecteur.slice(i + 1)}`); } });
    suspendu(a.rapport(ex), /témoin n'est pas stable : jusqu'à 0,8 % des épisodes/, 'un épisode du témoin change');
    const tolere = a.rapport(ex, { toleranceTemoin: 1 });
    assert.equal(tolere.verdict.issue, 'B-mieux');
    assert.ok(tolere.verdict.raisons.some((r: string) => /Tolérance du témoin réglée à la main : 1,0 point \(0 par défaut\)/.test(r)));
    assert.match(a.html(ex), /<div class="boite bon">.*Tolérance du témoin réglée à la main/s);
    // La graine du hasard des tirages vient des fichiers scellés : mêmes journaux, mêmes chiffres ; personne ne la choisit.
    const un = g.construire(lu, VITE), deux = g.construire(g.rassembler(a.copier('net2')), { ...VITE, graine: 12345 });
    assert.ok(Number.isSafeInteger(un.reglages.graine) && un.reglages.graine > 0);
    assert.equal(deux.reglages.graine, un.reglages.graine, 'une graine donnée par l\'appelant ne compte pas');
    assert.deepEqual(deux.cache.comparaison, un.cache.comparaison);
    // La borne qui décide est reculée de l'erreur de tirage : jamais au-dessus de la borne affichée.
    assert.ok(un.cache.comparaison.basDecision <= un.cache.comparaison.basSur && un.cache.comparaison.basSur <= un.cache.comparaison.bas);
  });
});

test('Rapport : les deux entraînements comparés portent leurs vrais noms (un C contre un B ne s\'appelle pas « B contre A »)', async () => {
  const g = await G();
  await dansUnDossier((d) => {
    const ex: Racines = g.fabriquerExemple(join(d, 'runs'), { ...NET, noms: ['B', 'C'] });
    assert.deepEqual([...ex.runs].sort().slice(0, 2), ['B-1', 'B-2']);
    const r = g.produire(ex, join(d, 'rapport'), VITE), m: Modele = r.modele;
    assert.deepEqual(m.comparees, ['B', 'C']); assert.deepEqual(m.blocages, []);
    assert.equal(m.verdict.issue, 'B-mieux', 'le code de l\'issue dit le rôle : le candidat fait mieux');
    assert.equal(m.verdict.texte, 'C fait mieux que B sur le banc caché.');
    assert.match(m.verdict.raisons[0], /écart C − B/);
    const html = readFileSync(r.fichiers.html, 'utf8');
    assert.match(html, /✓ C fait mieux que B sur le banc caché/); assert.match(html, /C fait-il vraiment mieux/); assert.match(html, /Écart C − B, banc caché/);
    assert.doesNotMatch(html, /B fait mieux que A|B − A|l'entraînement A/);
    assert.match(readFileSync(r.fichiers.md, 'utf8'), /Écart C − B sur le banc caché/);
  });
});

test('Rapport : les plafonds de la machine et les arrêts imprévus sont regardés', async () => {
  await dansUnDossier(async (d) => {
    const a = await atelier(d);
    const base = a.rapport(a.copier('net'));
    assert.ok(base.plafonds.length >= 7 && base.plafonds.every((p: Brute) => !p.depasse));
    // B : mémoire 6 000 Mo, charge 97 % sans pause, 60 s par épisode, run de 24 h.
    const lourd = a.scenario('lourd', (e) => { for (const run of a.runsDe('B')) a.retouche(e, run, { journal: (l) => { for (const x of l) { if (x.t === 'systeme') Object.assign(x, { memoire_mo: 6000, charge: 0.97, pause: false }); if (x.t === 'episode') x.ms = 60000; if (x.t === 'fin') x.duree_s = 86400; } } }); });
    for (const motif of [/Plafond dépassé — mémoire d'un processus : 6000 Mo pour 1500 au plus \(B-\d\)/, /Plafond dépassé — durée d'un run : 86400 s pour 1800 au plus/, /Plafond dépassé — durée de tous les runs/, /Plafond dépassé — temps du plus long épisode : 60000 ms pour 2000 au plus/, /Plafond dépassé — charge de la machine sans pause : 97 % pour 35 au plus/]) {
      assert.ok(lourd.alertes.some((x: string) => motif.test(x)), `${motif} ; vus : ${lourd.alertes.join(' | ')}`);
    }
    assert.equal(lourd.verdict.issue, 'B-mieux', 'un plafond dépassé est signalé ; il ne change pas la conclusion');
    const page = a.html({ ...a.base, boucle: join(d, 'lourd', 'boucle') });
    assert.match(page, /Les plafonds de la machine/); assert.equal(compter(page, /<td class="texte">dépassé<\/td>/g), 5);
    // Trop de consultations de la porte pour le plafond d'épisodes et la taille des lots.
    assert.equal(base.plafonds.find((p: Brute) => /Consultations/.test(p.quoi)).plafond, 6, '600 épisodes par lots de 100');
    // Deux runs de B finis sur une erreur : leurs mesures ne valent pas pour B.
    const erreur = a.scenario('erreur', (e) => { for (const run of ['B-2', 'B-3']) a.retouche(e, run, { journal: (l) => { l.at(-1)!.raison = 'erreur'; } }); });
    suspendu(erreur, /B-2 : run arrêté sur « erreur »\. Ses mesures ne valent pas pour son entraînement/, 'run fini sur une erreur');
    // Un arrêt à la main (fichier STOP) : signalé, sans suspendre.
    const stop = a.scenario('stop', (e) => a.retouche(e, 'A-1', { journal: (l) => { l.at(-1)!.raison = 'stop'; } }));
    assert.equal(stop.verdict.issue, 'B-mieux');
    assert.ok(stop.alertes.some((x: string) => /A-1 : run arrêté sur « stop »/.test(x)));
  });
});

test('Rapport : un journal retouché sans refaire la chaîne se voit ; un fichier refait après la clôture aussi', async () => {
  await dansUnDossier(async (d) => {
    const a = await atelier(d);
    // Un épisode raté devient « réussi » dans le journal, à la main : la ligne suivante ne reconnaît plus la précédente.
    const naif = a.scenario('naif', (e) => { const c = join(e.boucle, 'B-2', 'journal.jsonl'); const t = readFileSync(c, 'utf8'); const apres = t.replace(/"issue":"rate","r":-1/, '"issue":"succes","r":1'); assert.notEqual(apres, t); writeFileSync(c, apres); });
    assert.equal(naif.verdict.issue, 'suspendu');
    assert.ok(naif.blocages.some((b: string) => /B-2 : la chaîne des lignes est rompue dans le journal/.test(b)), naif.blocages.join(' | '));
    // Une ligne de porte retirée du fichier du banc.
    const retire = a.scenario('retire', (e) => { const c = join(e.banc, 'A-1', 'porte.jsonl'); const l = readFileSync(c, 'utf8').trimEnd().split('\n'); writeFileSync(c, [...l.slice(0, 2), ...l.slice(3)].join('\n') + '\n'); });
    assert.ok(retire.blocages.some((b: string) => /A-1 : la chaîne des lignes est rompue dans le fichier de la porte/.test(b)));
    // Le fichier scellé refait de bout en bout, chaîne recalculée, mais la clôture du banc garde l'ancien bout de chaîne.
    const { empreinteLigne } = await J();
    const refait = a.scenario('refait', (e) => { const c = join(e.banc, 'B-4', 'cache-scelle.jsonl'); const l = lignesDe(c); const x = l.find((y) => y.t === 'cache' && y.part === 100)!; const i = (x.vecteur as string).indexOf('0'); recompter(l[0], x, `${x.vecteur.slice(0, i)}1${x.vecteur.slice(i + 1)}`); rechainer(c, l, empreinteLigne); });
    assert.ok(refait.blocages.some((b: string) => /B-4 : le fichier scellé a changé après la clôture du run par le banc/.test(b)), refait.blocages.join(' | '));
    // Pareil pour le journal de la boucle.
    const journal = a.scenario('journal', (e) => { const c = join(e.boucle, 'A-3', 'journal.jsonl'); const l = lignesDe(c); l.at(-1)!.duree_s = 1; rechainer(c, l, empreinteLigne); });
    assert.ok(journal.blocages.some((b: string) => /A-3 : le journal de la boucle a changé après la clôture du run par le banc/.test(b)));
  });
});

test('Rapport : un journal coupé et des dossiers vides sont dits, sans erreur', async () => {
  const g = await G();
  await dansUnDossier((d) => {
    const ex: Racines = g.fabriquerExemple(join(d, 'runs'), PETIT);
    const chemin = join(ex.boucle, 'A-3', 'journal.jsonl');
    const moitie = readFileSync(chemin).lastIndexOf(0x0a, Math.floor(statSync(chemin).size / 2));
    truncateSync(chemin, moitie + 16);   // coupé au milieu d'une ligne : plus de ligne de fin
    const r = g.produire(ex, join(d, 'rapport'), VITE);
    assert.equal(r.modele.cache.scelle, true);
    const a3 = r.modele.runs.find((x: { run: string }) => x.run === 'A-3');
    assert.equal(a3.termine, false); assert.equal(a3.coupe, true);
    assert.ok(r.modele.alertes.some((x: string) => /A-3/.test(x) && /coup/.test(x)));
    // Un journal vide : le run n'a pas d'en-tête, il n'est pas fini ; rien ne casse.
    writeFileSync(join(ex.boucle, 'B-3', 'journal.jsonl'), '');
    const vide = g.produire(ex, join(d, 'rapport-vide'), VITE).modele;
    assert.ok(vide.alertes.some((x: string) => /B-3 : pas d'en-tête lisible/.test(x))); assert.equal(vide.cache.scelle, true);
    // Deux racines sans rien : un rapport qui le dit, pas une erreur, pas un dessin inventé.
    mkdirSync(join(d, 'vide', 'boucle'), { recursive: true }); mkdirSync(join(d, 'vide', 'banc'));
    const v = g.produire({ boucle: join(d, 'vide', 'boucle'), banc: join(d, 'vide', 'banc') }, join(d, 'vide-rapport'), VITE);
    assert.equal(v.modele.runs.length, 0); assert.equal(v.modele.verdict.issue, 'suspendu');
    const html = readFileSync(v.fichiers.html, 'utf8');
    assert.match(html, /Aucun run/); assert.match(html, /liste des runs prévus/); assert.equal(compter(html, /class="ba-(barre|courbe)/g), 0);
    assert.doesNotMatch(html, /NaN|undefined|Infinity|\[object/);
    assert.throws(() => g.produire({ boucle: join(d, 'absent'), banc: join(d, 'vide', 'banc') }, join(d, 'x'), VITE), /racine de la boucle introuvable/);
  });
});

test('Rapport : la commande produit les mêmes fichiers, et refuse les réglages qui flattent', async () => {
  await dansUnDossier((d) => {
    const script = join(import.meta.dirname, 'soul-banc', 'actions', 'graphes.mjs');
    const node = (...a: string[]) => execFileSync(process.execPath, ['--disable-warning=ExperimentalWarning', script, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    const exemple = node('--exemple', join(d, 'runs'), '--petit');
    assert.match(exemple, /EXEMPLE/); assert.match(exemple, /racine de la boucle/); assert.match(exemple, /racine du banc/);
    const racines = ['--boucle', join(d, 'runs', 'boucle'), '--banc', join(d, 'runs', 'banc')];
    const sortie = node(...racines, '--sortie', join(d, 'rapport'), '--tirages', '2000');
    assert.match(sortie, /rapport\.html/);
    for (const f of ['rapport.html', 'courbes.svg', 'competences.svg', 'rapport.md', 'chiffres.json']) assert.ok(existsSync(join(d, 'rapport', f)), f);
    assert.match(readFileSync(join(d, 'rapport', 'rapport.html'), 'utf8'), /EXEMPLE FABRIQUÉ/);
    assert.throws(() => node('--boucle', join(d, 'absent'), '--banc', join(d, 'runs', 'banc'), '--sortie', join(d, 'x')), /introuvable/);
    assert.throws(() => node('--exemple', join(d, 'runs'), '--petit'), /dossier neuf/, 'un exemple ne s\'ajoute jamais à des journaux déjà là');
    assert.throws(() => node(...racines, '--sortie', join(d, 'x'), '--tirages', '1'), /au moins 2000/);
    assert.throws(() => node(...racines, '--sortie', join(d, 'x'), '--tolerance-temoin', '100'), /de 0 à 1 point/);
    assert.throws(() => node(...racines, '--sortie', join(d, 'x'), '--graine', '3'), /n'existe plus/);
    assert.throws(() => node(...racines, '--sortie', join(d, 'x'), '--sans', 'B-99'), /inconnu/);
    assert.throws(() => node('--entree', join(d, 'runs'), '--sortie', join(d, 'x')), /usage/, 'une seule racine ne suffit plus');
    assert.equal(existsSync(join(d, 'x')), false, 'une commande refusée n\'écrit rien');
  });
});

// ------------------------------------------------------------------------------------------------ corrections après la relecture
test('Rapport : un run arrêté sur un plafond de la machine (temps, mémoire, disque) suspend la conclusion ; des plafonds différents aussi', async () => {
  await dansUnDossier(async (d) => {
    const a = await atelier(d);
    for (const raison of ['temps-max', 'memoire-max', 'disque-max']) {
      const m = a.scenario(raison, (e) => a.retouche(e, 'B-2', { journal: (l) => { l.at(-1)!.raison = raison; } }));
      suspendu(m, new RegExp(`B-2 : run arrêté sur un plafond de la machine \\(« ${raison} »\\)`), `arrêt ${raison}`);
    }
    // Les plafonds sont des réglages communs : un temps maximum différent pour un run de A suspend la conclusion.
    const plafonds = a.scenario('plafonds', (e) => { for (const run of [...a.runsDe('A'), ...a.runsDe('B'), 'temoin-1']) a.retouche(e, run, { journal: (l) => { l[0].reglages = { ...l[0].reglages, temps_max: run === 'A-1' ? 3600 : 1800 }; } }); });
    suspendu(plafonds, /Le réglage « temps_max » n'est pas le même pour tous les runs/, 'plafonds différents');
  });
});

test('Rapport : les fautes de sûreté des essais suivants (B1, dans le bac à sable) comptent dans celles de l\'entraînement', async () => {
  await dansUnDossier(async (d) => {
    const a = await atelier(d);
    const base = a.rapport(a.copier('net'));
    assert.equal(base.surete.B.entrainement, 0);
    const m = a.scenario('essais', (e) => a.retouche(e, 'B-1', { journal: (l) => { const x = l.find((y) => y.t === 'episode' && y.pas === 7)!; x.surete_essais = 2; } }));
    assert.equal(m.surete.B.entrainement, 2);
    assert.ok(m.alertes.some((x: string) => /B : 2 fautes de sûreté pendant l'entraînement/.test(x)), m.alertes.join(' | '));
  });
});

test('Rapport : le témoin à verdicts mélangés est accepté et montré à part ; il ne change ni la comparaison ni le témoin', async () => {
  await dansUnDossier(async (d) => {
    const g = await G();
    const sans = g.produire(g.fabriquerExemple(join(d, 'sans'), NET), join(d, 'sans-rapport'), VITE).modele;
    const avec = g.produire(g.fabriquerExemple(join(d, 'avec'), { ...NET, melange: true }), join(d, 'avec-rapport'), VITE);
    const m = avec.modele;
    assert.equal(m.verdict.issue, sans.verdict.issue); assert.equal(m.verdict.issue, 'B-mieux');
    assert.deepEqual(m.blocages, []);
    assert.equal(m.temoin.plat, true);
    assert.ok(m.variantes.includes('melange')); assert.equal(m.noms.melange, 'témoin mélangé');
    assert.equal(m.melange.present, true); assert.equal(m.melange.variante, 'melange'); assert.equal(m.melange.runs, 1);
    assert.ok(m.melange.porte && m.melange.porteReference && m.melange.cache && m.melange.cacheReference);
    assert.ok(m.melange.porte.montee < m.melange.porteReference.montee, 'dans cet exemple, il monte moins que A');
    assert.equal(sans.melange.present, false);
    const html = readFileSync(avec.fichiers.html, 'utf8'), md = readFileSync(join(d, 'avec-rapport', 'rapport.md'), 'utf8');
    assert.match(html, /Le témoin à verdicts mélangés/); assert.match(md, /## Le témoin à verdicts mélangés \(à part, pas comparé\)/);
    assert.doesNotMatch(html, /NaN|undefined|Infinity|\[object/);
  });
});
