// Banc de rapidité : la recherche par le SENS, ancien chemin (store.nearest, un cœur) contre l'index gardé prêt
// (src/brain/nous/sens-vif.ts), sur un fil puis réparti sur les cœurs.
//
//   node --disable-warning=ExperimentalWarning test/rapidite/sens-vif.ts --sortie <dossier> [--court]
//        [--reprise <dossier d'un Odin jetable qui a un point de reprise> [--cles <copie de son dossier de clés>]] [--jeu test/soul-banc/jeux/memoire-developpement.json]
//
// 1. Pour 300, 3 000 et 30 000 souvenirs inventés (vecteurs de 128 nombres, la largeur du gabarit « moyen ») : combien
//    de souvenirs sont comparés, sur combien de cœurs, en combien de temps (médiane et 95e centile sur des questions
//    tirées au hasard). Chaque réponse de l'index est comparée à celle de l'ancien chemin : elles doivent être les mêmes.
// 2. Le seuil : à partir de quelle taille répartir sur les cœurs va plus vite qu'un seul fil.
// 3. (avec --reprise) un vrai point de reprise de Soul : le temps d'un plongement (ce qui précède toute recherche) et la
//    JUSTESSE de la recherche par le sens sur un jeu de TRAVAIL du banc de mémoire (bon souvenir au premier rang, dans
//    les cinq premiers), ancien chemin et index. Jamais un jeu figé.
// Le point de reprise est scellé avec la clé de son coffre. Le coffre choisit son dossier de clés sur ODIN_CLE_DIR, sinon
// (hors `node --test`) sur le VRAI dossier des clés de la machine, où une clé qui ne correspond pas serait REMPLACÉE.
// Ce banc pose donc TOUJOURS ODIN_CLE_DIR sur un dossier temporaire neuf, avant tout chargement du coffre ; les clés
// voulues (option --cles <dossier>, ou ODIN_CLE_DIR déjà posé) y sont COPIÉES, jamais utilisées en place ; le vrai
// dossier des clés de la machine est refusé comme source.
// La charge de la machine et la mémoire libre sont notées avant et après chaque mesure (la machine est partagée).
process.env.ODIN_ESSAI = '1';

import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { availableParallelism, freemem, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { chargeMachine, stat, tableau, type Stat } from './outils.ts';
import { hasard } from './remplir.ts';

const args = process.argv.slice(2);
const opt = (n: string) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };

// Les clés à l'écart (aucun module du coffre n'est encore chargé : les imports au-dessus n'y touchent pas).
const sourceCles = opt('cles') ?? process.env.ODIN_CLE_DIR;
const dossierClesBanc = mkdtempSync(join(tmpdir(), 'odin-cles-banc-'));
process.env.ODIN_CLE_DIR = dossierClesBanc;
async function verifierCles(): Promise<void> {
  const { machineKeyDir, dossierClesMachine } = await import('../../src/vault.ts');
  // Le vrai dossier des clés de la machine, quel que soit le processus : ce banc est un Odin d'essai, et le coffre lui
  // répondrait sinon son dossier d'essai — le refus ci-dessous ne se déclencherait plus.
  const machine = resolve(dossierClesMachine());
  const meme = (a: string, b: string) => (process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b);
  if (meme(resolve(machineKeyDir()), machine)) throw new Error('le dossier des clés du banc est celui de la machine : refusé');
  if (sourceCles) {
    if (meme(resolve(sourceCles), machine)) throw new Error('--cles : le vrai dossier des clés de la machine est refusé ; donnez-en une copie');
    if (existsSync(sourceCles)) cpSync(sourceCles, dossierClesBanc, { recursive: true });
  }
}
const toujours = () => true;
const court = args.includes('--court');
const sortie = resolve(opt('sortie') ?? join(tmpdir(), 'odin-banc-sens-vif'));
const MODELE = 'noos-banc-p1';
const DIM = 128;

function vecteurs(n: number, dim: number, graine: number): Float32Array[] {
  const h = hasard(graine), commun = Float32Array.from({ length: dim }, () => h() - 0.5);
  return Array.from({ length: n }, () => Float32Array.from({ length: dim }, (_, i) => commun[i] * 0.9 + (h() - 0.5)));
}
const r2 = (x: number) => Math.round(x * 1000) / 1000;
const charge = async () => { const c = await chargeMachine(500); return { occupation: c.occupation, memoireLibreGo: c.memoireLibreGo }; };

async function mesurer(f: () => unknown, n: number, chauffe = 5): Promise<Stat> {
  for (let i = 0; i < chauffe; i++) f();
  const t: number[] = [];
  for (let i = 0; i < n; i++) { const a = performance.now(); f(); t.push(performance.now() - a); }
  return stat(t);
}

async function principal(): Promise<void> {
  mkdirSync(sortie, { recursive: true });
  await verifierCles();
  const { Mnemosyne } = await import('../../src/muninn/store.ts');
  const { SensVif } = await import('../../src/brain/nous/sens-vif.ts');
  const { decoder } = await import('../../src/muninn/vecteurs-ram.ts');
  const coeurs = availableParallelism();
  const res: Record<string, unknown> = { coeurs, quand: new Date().toISOString(), largeur: DIM };
  const lignes: Array<Array<string | number>> = [];
  const lignesDe = (mem: InstanceType<typeof Mnemosyne>) => [...(mem as unknown as { vectors: { values(): Iterable<{ id: number; model: string; vec: string }> } }).vectors.values()]
    .filter((l) => l.model === MODELE).map((l) => ({ id: l.id, cle: l.vec, vec: () => decoder(l.vec) }));

  // ---------------------------------------------------------------- 1. avant / après, 300 / 3 000 / 30 000
  const tailles = court ? [300, 3000] : [300, 3000, 30000];
  const mesures: unknown[] = [];
  for (const N of tailles) {
    const mem = new Mnemosyne(':memory:');
    const vs = vecteurs(N, DIM, N);
    for (let i = 0; i < N; i++) { const { id } = mem.remember(`souvenir inventé ${i} n° ${N}`, 'owner'); mem.setVector(id, MODELE, vs[i]); }
    const qs = vecteurs(court ? 30 : 100, DIM, N + 7);
    let k = 0;
    const nq = () => qs[k++ % qs.length];
    const vivant = (id: number | string) => { const m = mem.getMemory(Number(id)); return Boolean(m && !m.superseded_by && m.origin !== 'untrusted'); };
    const repet = N >= 30000 ? 60 : 200;

    const cAvant = await charge();
    const premier = (() => { const a = performance.now(); mem.nearest(MODELE, qs[0], 6); return performance.now() - a; })(); // décodage la première fois
    const avant = await mesurer(() => mem.nearest(MODELE, nq(), 6), repet);
    const un = new SensVif({ nom: `banc-un-${N}`, fils: 0 });
    const tSync = performance.now(); un.synchroniser(MODELE, lignesDe(mem)); const msSync = performance.now() - tSync;
    const apresUn = await mesurer(() => un.chercher(MODELE, nq(), 6, { vivant }), repet);
    const tous = new SensVif({ nom: `banc-tous-${N}`, fils: coeurs - 1, seuilParallele: 0 });
    tous.synchroniser(MODELE, lignesDe(mem));
    const apresTous = await mesurer(() => tous.chercher(MODELE, nq(), 6, { vivant }), repet);
    const auto = new SensVif({ nom: `banc-auto-${N}`, fils: coeurs - 1 });
    auto.synchroniser(MODELE, lignesDe(mem));
    const apresAuto = await mesurer(() => auto.chercher(MODELE, nq(), 6, { vivant }), repet);
    const cApres = await charge();
    // Les réponses : toutes identiques à l'ancien chemin ?
    let differences = 0, rendus = 0;
    for (const q of qs) {
      const ref = mem.nearest(MODELE, q, 6).map((r) => r.id); rendus += ref.length;
      for (const sv of [un, tous, auto]) if (JSON.stringify(sv.chercher(MODELE, q, 6, { vivant })!.map((x) => x.id)) !== JSON.stringify(ref)) differences++;
    }
    const m = { N, compares: { avant: N, apres: tous.compte.derniersCompares }, coeurs: { avant: 1, unFil: 1, tous: tous.compte.derniersFils, auto: auto.compte.derniersFils },
      premierAppelAvantMs: r2(premier), avant, unFil: apresUn, tousLesCoeurs: apresTous, automatique: apresAuto, synchroniserMs: r2(msSync),
      memoireMo: { unFil: un.memoireMo, tous: tous.memoireMo }, differences, rendusParQuestion: r2(rendus / qs.length), chargeAvant: cAvant, chargeApres: cApres };
    mesures.push(m);
    lignes.push([N, `${r2(avant.mediane)} / ${r2(avant.p95)}`, `${r2(apresUn.mediane)} / ${r2(apresUn.p95)}`, `${r2(apresTous.mediane)} / ${r2(apresTous.p95)} (${tous.compte.derniersFils} fils)`, `${r2(apresAuto.mediane)} (${auto.compte.derniersFils} fil${auto.compte.derniersFils > 1 ? 's' : ''})`, `${un.memoireMo} / ${tous.memoireMo}`, differences, `${cAvant.occupation} % ${cAvant.memoireLibreGo} Go → ${cApres.occupation} % ${cApres.memoireLibreGo} Go`]);
    un.fermer(); tous.fermer(); auto.fermer();
    console.log(`N=${N} : avant ${r2(avant.mediane)} ms, un fil ${r2(apresUn.mediane)} ms, ${coeurs} cœurs ${r2(apresTous.mediane)} ms, auto ${r2(apresAuto.mediane)} ms, différences ${differences}`);
  }
  res.mesures = mesures;

  // ---------------------------------------------------------------- 2. le seuil un fil / tous les cœurs
  const seuil: unknown[] = [];
  const lignesSeuil: Array<Array<string | number>> = [];
  for (const N of court ? [1000, 4000, 16000] : [1000, 2000, 4000, 8000, 16000, 32000, 64000]) {
    const sv1 = new SensVif({ nom: `seuil-1-${N}`, fils: 0 }), svT = new SensVif({ nom: `seuil-t-${N}`, fils: coeurs - 1, seuilParallele: 0 });
    const vs = vecteurs(N, DIM, 3 * N);
    const lignesV = vs.map((vec, id) => ({ id, vec }));
    sv1.synchroniser(MODELE, lignesV); svT.synchroniser(MODELE, lignesV);
    const qs = vecteurs(30, DIM, 5 * N); let k = 0;
    const c0 = await charge();
    const a = await mesurer(() => sv1.chercher(MODELE, qs[k++ % 30], 6, { vivant: toujours }), 100);
    const b = await mesurer(() => svT.chercher(MODELE, qs[k++ % 30], 6, { vivant: toujours }), 100);
    const c1 = await charge();
    seuil.push({ N, nombres: N * DIM, unFil: a, tousLesCoeurs: b, chargeAvant: c0, chargeApres: c1 });
    lignesSeuil.push([N, N * DIM, r2(a.mediane), r2(b.mediane), b.mediane < a.mediane ? 'répartir' : 'un fil', `${c0.occupation} % → ${c1.occupation} %, ${c1.memoireLibreGo} Go libres`]);
    sv1.fermer(); svT.fermer();
  }
  res.seuil = seuil;
  // Combien de fils : sur une machine partagée, tous les cœurs ne sont pas libres.
  const lignesFils: Array<Array<string | number>> = [];
  {
    const N = court ? 16000 : 30000, vs = vecteurs(N, DIM, 11 * N), lignesV = vs.map((vec, id) => ({ id, vec }));
    const qs = vecteurs(30, DIM, 13 * N); let k = 0;
    for (const f of [0, 1, 3, 5, coeurs - 1]) {
      const sv = new SensVif({ nom: `fils-${f}`, fils: f, seuilParallele: 0 });
      sv.synchroniser(MODELE, lignesV);
      const c0 = await charge();
      const t = await mesurer(() => sv.chercher(MODELE, qs[k++ % 30], 6, { vivant: toujours }), 100);
      const c1 = await charge();
      lignesFils.push([N, f + 1, r2(t.mediane), r2(t.p95), `${c0.occupation} % → ${c1.occupation} %, ${c1.memoireLibreGo} Go libres`]);
      sv.fermer();
    }
  }

  // ---------------------------------------------------------------- 3. un vrai Soul : plongement et justesse (jeu de travail)
  const reprise = opt('reprise');
  let texteJustesse = '';
  if (reprise) {
    const home = mkdtempSync(join(tmpdir(), 'odin-sens-vif-'));
    try {
      cpSync(reprise, home, { recursive: true }); // tout le dossier : le point de reprise est scellé avec la clé de son coffre
      const { chargerMoteur } = await import('../../src/brain/nous/moteur.ts');
      const moteur = await chargerMoteur(home);
      // Illisible (souvent : pas la clé de son coffre — donnez-en une copie avec --cles) : noté, et le banc continue.
      if (!moteur) {
        res.justesse = { illisible: true };
        texteJustesse = '\n## Justesse : NON mesurée — point de reprise illisible avec les clés données (option --cles : une copie du bon dossier de clés)';
        console.log(texteJustesse);
      } else try {
        const fichier = opt('jeu') ?? 'test/soul-banc/jeux/memoire-developpement.json';
        if (/principal/i.test(fichier)) throw new Error('jeu figé refusé : la justesse se mesure sur un jeu de travail');
        const jeu = JSON.parse(readFileSync(fichier, 'utf8'));
        if (jeu.fige === true) throw new Error('jeu figé refusé');
        const { jugerM } = await import('../soul-banc/memoire.ts');
        const model = moteur.modeleEmbedding;
        const mem = new Mnemosyne(':memory:');
        const versJeu = new Map<number, string>(), versProduit = new Map<string, number>();
        const tri = [...jeu.souvenirs].sort((a: { date: string }, b: { date: string }) => new Date(a.date).getTime() - new Date(b.date).getTime());
        const tPl: number[] = [];
        for (const s of tri) {
          const r = mem.remember(s.texte, s.origine ?? 'owner', 'fact', '', s.sujet ? { subject: s.sujet, topic: s.cle } : {});
          versJeu.set(r.id, s.id); versProduit.set(s.id, r.id);
        }
        for (const id of jeu.oublis ?? []) { const p = versProduit.get(id); if (p !== undefined) mem.forget(p); }
        for (const x of mem.missingVectors(model, 100000)) { const a = performance.now(); const v = await moteur.plonger(x.content); tPl.push(performance.now() - a); mem.setVector(x.id, model, v); }
        const sv = new SensVif({ nom: 'banc-justesse', fils: coeurs - 1, seuilParallele: 0 });
        const lignesM = [...(mem as unknown as { vectors: { values(): Iterable<{ id: number; model: string; vec: string }> } }).vectors.values()].filter((l) => l.model === model).map((l) => ({ id: l.id, cle: l.vec, vec: () => decoder(l.vec) }));
        sv.synchroniser(model, lignesM);
        const vivant = (id: number | string) => { const m = mem.getMemory(Number(id)); return Boolean(m && !m.superseded_by && m.origin !== 'untrusted'); };
        const oublies = new Set<string>(jeu.oublis ?? []);
        const compte = { avec: 0, rang1A: 0, top5A: 0, rang1B: 0, top5B: 0, differences: 0, tQuestion: [] as number[] };
        for (const q of jeu.questions) {
          const a = performance.now(); const v = await moteur.plonger(q.question); compte.tQuestion.push(performance.now() - a);
          const ancien = mem.nearest(model, v, 10).map((r) => versJeu.get(r.id) ?? `#${r.id}`);
          const neuf = (sv.chercher(model, v, 10, { vivant }) ?? []).map((x) => versJeu.get(Number(x.id)) ?? `#${x.id}`);
          if (JSON.stringify(ancien) !== JSON.stringify(neuf)) compte.differences++;
          if (!(q.attendus.length > 0 && q.sorte !== 'oubli')) continue;
          compte.avec++;
          const ja = jugerM(q, { ids: ancien }, oublies), jb = jugerM(q, { ids: neuf }, oublies);
          if (ja.rang1) compte.rang1A++; if (ja.top5) compte.top5A++; if (jb.rang1) compte.rang1B++; if (jb.top5) compte.top5B++;
        }
        sv.fermer();
        const pc = (k: number, n: number) => `${k}/${n} = ${n ? (Math.floor((k / n) * 1000) / 10).toFixed(1) : '—'} %`;
        res.justesse = { jeu: fichier, modele: model, souvenirs: tri.length, oublis: (jeu.oublis ?? []).length, questionsAvecReponse: compte.avec, ancien: { rang1: compte.rang1A, top5: compte.top5A }, index: { rang1: compte.rang1B, top5: compte.top5B }, differences: compte.differences, plongementSouvenirMs: stat(tPl), plongementQuestionMs: stat(compte.tQuestion) };
        texteJustesse = [
          '', `## Justesse de la recherche par le sens (seule), jeu de travail ${fichier}, modèle ${model}`, '',
          `${tri.length} souvenirs, ${compte.avec} questions avec réponse (hors « oubli »).`,
          `- ancien chemin : bon souvenir au 1er rang ${pc(compte.rang1A, compte.avec)} ; dans les 5 premiers ${pc(compte.top5A, compte.avec)}`,
          `- index gardé prêt : 1er rang ${pc(compte.rang1B, compte.avec)} ; 5 premiers ${pc(compte.top5B, compte.avec)}`,
          `- réponses différentes entre les deux (toutes questions) : ${compte.differences}`,
          `- un plongement (Soul, un texte) : médiane ${r2(stat(compte.tQuestion).mediane)} ms par question, ${r2(stat(tPl).mediane)} ms par souvenir`,
        ].join('\n');
        console.log(texteJustesse);
      } finally { await moteur.arreter(); }
    } finally { rmSync(home, { recursive: true, force: true }); }
  }

  const texte = [
    `# Recherche par le sens : ancien chemin contre index gardé prêt (${coeurs} cœurs disponibles, vecteurs de ${DIM})`, '',
    'Temps par question en ms (médiane / 95e centile). Mémoire : Mo demandés au comptable (un fil / tous les cœurs). Charge : occupation du processeur et mémoire libre avant → après.', '',
    tableau(['souvenirs', 'avant (store.nearest, 1 cœur)', 'index, 1 fil', 'index, tous les cœurs', 'index, réglage par défaut', 'mémoire Mo', 'réponses différentes', 'charge'], lignes), '',
    '## Seuil : un fil ou tous les cœurs (médiane, ms)', '',
    tableau(['souvenirs', 'nombres comparés', 'un fil', 'tous les cœurs', 'plus rapide', 'charge'], lignesSeuil), '',
    '## Nombre de fils (ms)', '',
    tableau(['souvenirs', 'fils', 'médiane', '95e centile', 'charge'], lignesFils),
    texteJustesse, '', `Mémoire libre à la fin : ${Math.round(freemem() / 1e8) / 10} Go.`,
  ].join('\n');
  writeFileSync(join(sortie, 'sens-vif.json'), JSON.stringify(res, null, 1));
  writeFileSync(join(sortie, 'sens-vif.txt'), texte);
  console.log(texte);
}

try { await principal(); } finally { rmSync(dossierClesBanc, { recursive: true, force: true }); }
process.exit(0);
