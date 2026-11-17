// Banc de rapidité : L'AIGUILLEUR DE SOUL PRÊT EN MÉMOIRE VIVE.
//
//   node --disable-warning=ExperimentalWarning --expose-gc test/rapidite/aiguilleur-pret.ts [--sortie <dossier>] [--tours 3] [--chemins ancien,pret] [--espacees 6]
//
// Pour chaque chemin (« ancien » : creerAiguilleurSync avec l'ancien vote gardé comme référence, tout refait à chaque
// démarrage sauf la calibration gardée ; « vote » : creerAiguilleurSync avec le vote rapide ; « pret » :
// creerAiguilleurPret, vote rapide et préparation gardée sur le disque, vérifiée par empreinte) :
//   - démarrage À FROID dans un processus neuf, sur un dossier d'Odin jetable et vide (rien de gardé) ;
//   - démarrage À CHAUD dans un autre processus neuf, sur le même dossier (ce que le premier a gardé est relu) ;
//   - pour chacun : temps de construction (matière, index, calibration), mémoire prise (tas JS + tableaux, après un
//     ramasse-miettes, avant et après la construction ; mémoire résidente), puis toutes les demandes du jeu de travail
//     test/soul-banc/jeux/developpement.json (contexte compris), temps par demande (médiane, 95e centile, maximum).
// Les deux chemins sont mesurés l'un après l'autre dans la même minute, tour par tour, et la charge du processeur et la
// mémoire libre de la machine sont notées avec chaque mesure. Les réponses des deux chemins sont comparées une à une
// (applis, actions, confiances, décisions, raisons : tout) : une seule différence fait échouer le banc.
// Rien n'est écrit dans le vrai dossier d'Odin : chaque mesure a son dossier jetable.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { cpus, freemem, tmpdir, totalmem } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';

const ICI = fileURLToPath(import.meta.url);
const RACINE = resolve(ICI, '..', '..', '..');
const args = process.argv.slice(2);
const un = (nom: string, defaut: string) => { const i = args.indexOf(`--${nom}`); return i >= 0 && args[i + 1] ? args[i + 1] : defaut; };

// ------------------------------------------------------------------------------------------------ outils
function stat(v0: number[]): { n: number; mediane: number; p95: number; max: number; moyenne: number } {
  const v = v0.filter(Number.isFinite).sort((a, b) => a - b);
  const q = (p: number) => { if (!v.length) return NaN; const i = (v.length - 1) * p, a = Math.floor(i), b = Math.ceil(i); return v[a] + (v[b] - v[a]) * (i - a); };
  const r = (x: number) => Math.round(x * 1000) / 1000;
  return { n: v.length, mediane: r(q(0.5)), p95: r(q(0.95)), max: r(v[v.length - 1] ?? NaN), moyenne: r(v.reduce((s, x) => s + x, 0) / Math.max(1, v.length)) };
}
/** Occupation du processeur de toute la machine pendant `ms` millisecondes, et mémoire libre. */
async function charge(ms = 1000): Promise<{ occupation: number; coeurs: number; libreGo: number; totalGo: number }> {
  const a = cpus(); await new Promise((r) => setTimeout(r, ms)); const b = cpus();
  let occ = 0, tot = 0;
  a.forEach((x, i) => { const t0 = x.times, t1 = b[i].times; const t = (t1.user - t0.user) + (t1.nice - t0.nice) + (t1.sys - t0.sys) + (t1.irq - t0.irq) + (t1.idle - t0.idle); occ += t - (t1.idle - t0.idle); tot += t; });
  return { occupation: tot ? Math.round((1000 * occ) / tot) / 10 : NaN, coeurs: a.length, libreGo: Math.round(freemem() / 1e8) / 10, totalGo: Math.round(totalmem() / 1e8) / 10 };
}
const mo = (o: number) => Math.round(o / 1e5) / 10;
/** Nombre de demandes isolées mesurées par passage. */
const ESPACEES = Math.max(0, Number(un('espacees', '6')) | 0);

// ------------------------------------------------------------------------------------------------ l'enfant : une mesure
interface MesureEnfant {
  chemin: string; etat: string; msImports: number; msConstruction: number; bilan: Record<string, unknown>;
  /** Un second aiguilleur dans le même processus : temps, et d'où vient son index. */
  msReconstruction: number; reconstructionDe: string;
  memoire: { avantMo: number; apresMo: number; priseMo: number; rssAvantMo: number; rssApresMo: number; picRssMo: number };
  demandes: { n: number; mediane: number; p95: number; max: number; moyenne: number };
  /** Demandes isolées (une par seconde et un peu plus : ce que coûte de regarder le disque à chaque demande). */
  espacees: { n: number; mediane: number; p95: number; max: number; moyenne: number };
}
async function enfant(home: string, chemin: string, etat: string, fichierReponses: string, fichierMesure: string): Promise<void> {
  process.env.ODIN_HOME = home; process.env.ODIN_CLE_DIR = join(home, 'cles'); process.env.ODIN_ESSAI = '1'; process.env.ODIN_NO_VOICE_INSTALL = '1';
  const gc = (globalThis as { gc?: () => void }).gc ?? (() => {});
  const t0 = performance.now();
  const A = await import('../../src/brain/nous/aiguilleur.ts');
  const P = chemin === 'pret' ? await import('../../src/brain/nous/aiguilleur-pret.ts' as string) as { creerAiguilleurPret: typeof A.creerAiguilleurSync } : undefined;
  const { allModules } = await import('../../src/valhalla/odin.ts');
  const { USAGES } = await import('../../src/valhalla/links.ts');
  const { SURVOL } = await import('../../src/valhalla/survol.ts');
  const { contexteDe } = await import('../soul-banc/mesure.ts');
  const mods = allModules({ paths: { home, workspace: home }, cfg: { venus: {}, voice: {} } } as never);
  const jeu = JSON.parse(readFileSync(join(RACINE, 'test', 'soul-banc', 'jeux', 'developpement.json'), 'utf8')) as { demandes: Array<{ id: string; phrase: string; contexte?: unknown }> };
  const msImports = performance.now() - t0;
  gc(); gc();
  const m0 = process.memoryUsage(); let pic = m0.rss;
  const suivi = setInterval(() => { pic = Math.max(pic, process.memoryUsage().rss); }, 20); suivi.unref();
  const t1 = performance.now();
  // Les mêmes options que methodeBanc (variante « ngrammes », celle du banc).
  const o = { modules: mods, home, usages: USAGES, survol: SURVOL, reglages: { poidsMots: 0 } };
  // « ancien » : l'ancien chemin du vote, gardé comme référence (tri complet, tables refaites à chaque demande).
  if (chemin === 'ancien') A.cheminDeReference(true);
  const a = P ? P.creerAiguilleurPret(o) : A.creerAiguilleurSync(o);
  const msConstruction = performance.now() - t1;
  pic = Math.max(pic, process.memoryUsage().rss);
  clearInterval(suivi);
  gc(); gc();
  const m1 = process.memoryUsage();
  const tas = (m: NodeJS.MemoryUsage) => m.heapUsed + m.external + m.arrayBuffers;
  const temps: number[] = [], reponses: unknown[] = [];
  for (const d of jeu.demandes) {
    const ctx = contexteDe(d.contexte) as Parameters<typeof a.aiguiller>[1];
    const t = performance.now(); const r = a.aiguiller(d.phrase, ctx); temps.push(performance.now() - t);
    reponses.push({ id: d.id, r });
  }
  // Un second passage (le premier réchauffe le moteur JavaScript) : c'est lui qui est compté.
  temps.length = 0;
  for (const d of jeu.demandes) { const ctx = contexteDe(d.contexte) as Parameters<typeof a.aiguiller>[1]; const t = performance.now(); a.aiguiller(d.phrase, ctx); temps.push(performance.now() - t); }
  // Demandes isolées, espacées d'un peu plus d'une seconde (attente sans calcul : la ronde du disque peut passer).
  const isolees: number[] = [];
  for (const d of jeu.demandes.slice(0, ESPACEES)) {
    await new Promise((r) => setTimeout(r, 1050));
    const ctx = contexteDe(d.contexte) as Parameters<typeof a.aiguiller>[1];
    const t = performance.now(); a.aiguiller(d.phrase, ctx); isolees.push(performance.now() - t);
  }
  // Un aiguilleur refait dans le même processus (matière rechargée, par exemple) : ce que la mémoire vive a gardé sert.
  const t2 = performance.now();
  const a2 = P ? P.creerAiguilleurPret(o) : A.creerAiguilleurSync(o);
  const msReconstruction = Math.round(performance.now() - t2);
  for (const d of jeu.demandes.slice(0, 50)) if (JSON.stringify(a2.aiguiller(d.phrase, contexteDe(d.contexte) as Parameters<typeof a.aiguiller>[1])) !== JSON.stringify((reponses.find((x) => (x as { id: string }).id === d.id) as { r: unknown }).r)) throw new Error(`réponse différente après reconstruction : ${d.id}`);
  writeFileSync(fichierReponses, JSON.stringify(reponses));
  const { calibration: _c, matiere: _m, ...bilan } = a.bilan as unknown as Record<string, unknown>;
  const out: MesureEnfant = {
    chemin, etat, msImports: Math.round(msImports), msConstruction: Math.round(msConstruction), bilan, msReconstruction, reconstructionDe: String(a2.bilan.preparationDe ?? 'calcul'),
    memoire: { avantMo: mo(tas(m0)), apresMo: mo(tas(m1)), priseMo: mo(tas(m1) - tas(m0)), rssAvantMo: mo(m0.rss), rssApresMo: mo(m1.rss), picRssMo: mo(pic) },
    demandes: stat(temps), espacees: stat(isolees),
  };
  writeFileSync(fichierMesure, JSON.stringify(out));
}

// ------------------------------------------------------------------------------------------------ le parent
async function principal(): Promise<void> {
  const { SORTIE } = await import('./outils.ts');
  const sortie = un('sortie', join(SORTIE, 'memoire-vive'));
  const tours = Math.max(1, Number(un('tours', '2')) | 0);
  const chemins = un('chemins', 'ancien,vote,pret').split(',').map((x) => x.trim()).filter(Boolean);
  mkdirSync(sortie, { recursive: true });
  const lignes: Array<MesureEnfant & { tour: number; machine: Awaited<ReturnType<typeof charge>> }> = [];
  const reponsesDe = new Map<string, string>();
  const travail = mkdtempSync(join(tmpdir(), 'odin-aiguilleur-pret-'));
  try {
    for (let tour = 1; tour <= tours; tour++) {
      for (const chemin of chemins) {
        const home = mkdtempSync(join(tmpdir(), `odin-aiguilleur-${chemin}-`));
        try {
          for (const etat of ['froid', 'chaud']) {
            const machine = await charge(1000);
            const fr = join(travail, `rep-${chemin}-${etat}-${tour}.json`), fm = join(travail, `mes-${chemin}-${etat}-${tour}.json`);
            execFileSync(process.execPath, ['--disable-warning=ExperimentalWarning', '--expose-gc', ICI, '--enfant', home, chemin, etat, fr, fm], { stdio: 'inherit', cwd: RACINE });
            const m = JSON.parse(readFileSync(fm, 'utf8')) as MesureEnfant;
            lignes.push({ ...m, tour, machine });
            reponsesDe.set(`${chemin}-${etat}-${tour}`, readFileSync(fr, 'utf8'));
            console.log(`tour ${tour} ${chemin} ${etat} : construction ${m.msConstruction} ms (index ${m.bilan.msIndex} ms, calibration ${m.bilan.msCalibration} ms, ${m.bilan.calibrationDe}${m.bilan.preparationDe ? `, préparation ${m.bilan.preparationDe}` : ''}) ; mémoire prise ${m.memoire.priseMo} Mo (pic résident ${m.memoire.picRssMo} Mo) ; demande médiane ${m.demandes.mediane} ms, p95 ${m.demandes.p95} ms, isolée ${m.espacees.mediane} ms ; machine ${machine.occupation} % de ${machine.coeurs} cœurs, ${machine.libreGo} Go libres sur ${machine.totalGo}`);
          }
        } finally { rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
      }
    }
  } finally { rmSync(travail, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
  // Toutes les réponses doivent être identiques (d'un chemin à l'autre, d'un état à l'autre, d'un tour à l'autre).
  const toutes = [...reponsesDe.entries()], ref = toutes[0];
  const differents = toutes.filter(([, r]) => r !== ref[1]).map(([k]) => k);
  const resultat = { quand: new Date().toISOString(), tours, chemins, mesures: lignes, reponsesIdentiques: differents.length === 0, differents, reference: ref[0] };
  const texte = [
    `Aiguilleur prêt : ${new Date().toISOString()}`, '',
    '| tour | chemin | démarrage | construction (ms) | index (ms) | calibration (ms) | refait dans le processus (ms) | prise (Mo) | pic résident (Mo) | demande médiane (ms) | p95 (ms) | max (ms) | isolée, médiane (ms) | processeur | mémoire libre |',
    '|---:|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|',
    ...lignes.map((l) => `| ${l.tour} | ${l.chemin} | ${l.etat} | ${l.msConstruction} | ${l.bilan.msIndex} | ${l.bilan.msCalibration} | ${l.msReconstruction} (${l.reconstructionDe}) | ${l.memoire.priseMo} | ${l.memoire.picRssMo} | ${l.demandes.mediane} | ${l.demandes.p95} | ${l.demandes.max} | ${l.espacees.mediane} | ${l.machine.occupation} % / ${l.machine.coeurs} | ${l.machine.libreGo} / ${l.machine.totalGo} Go |`),
    '', `Réponses identiques sur les ${toutes.length} passages : ${differents.length === 0 ? 'oui' : `NON (${differents.join(', ')})`}.`,
  ].join('\n');
  const nom = `aiguilleur-pret-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  writeFileSync(join(sortie, `${nom}.json`), JSON.stringify(resultat, null, 1));
  writeFileSync(join(sortie, `${nom}.md`), texte);
  console.log(texte);
  if (differents.length) process.exitCode = 1;
}

if (args[0] === '--enfant') { await enfant(args[1], args[2], args[3], args[4], args[5]); process.exit(0); }
else if (resolve(process.argv[1] ?? '') === resolve(ICI)) await principal();
