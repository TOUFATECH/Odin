// Banc d'actions « BA-1 » : la BOUCLE d'auto-apprentissage. Un épisode d'entraînement → l'apprenant propose → le monde
// simulé joue → le vérificateur (un programme) juge → l'apprenant retient (sur une COPIE) → tous les 100 épisodes, la
// porte « Essai puis mesure » garde la copie ou la refuse (retour exact à l'état d'avant).
//
// DEUX PROCESSUS. La commande ci-dessous lance le côté BANC (ce processus : il charge le banc, tient la porte, écrit
// porte.jsonl et le fichier scellé dans la racine du banc) puis la BOUCLE dans un processus enfant. La boucle ne reçoit
// jamais le chemin de la racine du banc ni le banc : elle envoie ses instantanés d'état et reçoit « garde » ou
// « refuse », rien d'autre. Elle écrit son journal (journal.jsonl) dans la racine de la boucle.
//
//   node --disable-warning=ExperimentalWarning test/soul-banc/actions/boucle.ts --variante A|B|temoin|melange --graine N
//        --pas N --sortie <racine de la boucle> --empreinte sha256:<empreinte du manifeste notée avant de lancer>
//        [--banc <racine du banc>] [--lot 100] [--aiguilleur odin|poche] [--temps-max 1800] [--memoire-max 1536]
//        [--disque-max 200] [--charge-max 0.35] [--graine-lot 20261120] [--runs A:1,B:1,temoin:1,melange:1] [--arret-refus N]
//        [--cache <dossier jetable où l'aiguilleur garde sa calibration, partagé par les runs>]
//
// L'empreinte du manifeste est OBLIGATOIRE et vient de celui qui lance : elle ne se calcule jamais ici.
// Sans --banc, la racine du banc est un dossier neuf au nom tiré au hasard dans le dossier temporaire. La racine du banc
// et celle de la boucle ne s'emboîtent jamais (l'une dans l'autre : refusé).
//
// Les variantes : A = l'existant branché sur le vérificateur (apprend de ses seules réussites vérifiées, premier choix
// seul) ; B = A + B1 (essayer les choix suivants dans le bac à sable), B2 (la voie fautive baisse après un échec), B3
// (au deuxième passage, pratiquer selon le progrès : un tirage AVEC remise, qui change ce qui est pratiqué, pas
// seulement l'ordre) ; témoin = rien n'apprend ; melange = le témoin à verdicts mélangés : il apprend comme A, mais de
// verdicts pris au hasard (graine fixe) parmi ceux des derniers épisodes, jamais du sien. S'il monte autant que A, la
// montée vient de la porte, pas de ce qui est appris. Les réglages B1, B2, B3 se coupent un par un (--sans-exploration,
// --sans-facteur, --sans-progres) pour les essais « B moins une ».
//
// GARDE-FOUS de la boucle : le processus enfant tourne sous le modèle de permissions de Node (lecture des seules sources,
// du monde, des gabarits et des jeux de travail, de son dossier et du cache ; écriture dans son dossier seulement ; ni
// fil de travail, ni processus fils, ni réseau) ; audit des lectures en plus (la liste des fichiers ouverts, et un
// fichier du banc ouvert = lecture refusée, run annulé) ; plafonds de temps (pauses non comptées), de mémoire, de
// disque, écrits dans l'en-tête du journal ; pause quand la machine est chargée par autre chose ; arrêt propre par un
// fichier STOP posé dans le dossier du run ; les portes refusées de suite NE coupent PAS le run (choix du propriétaire du 23/11 : aller jusqu'au bout ; --arret-refus N remet un arrêt après N refus) ; priorité
// basse et un seul fil pour les deux processus.
import { fork, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import { cpus, constants as osConstants, setPriority, tmpdir } from 'node:os';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire, syncBuiltinESMExports } from 'node:module';
import { vueApprenant } from './banc.ts';
import { chargerMonde, type Monde } from './monde.ts';
import { verifier, COMPETENCES, type Competence, type Episode, type Verdict } from './verificateur.ts';
import { hasard, lotEntrainement, melanger, retirer } from './episodes.ts';
import { empreinteCourte, interditALaBoucle, NOM_JOURNAL, ouvrirJournal, PARTS, type Ecrivain, type Ligne } from './journal.ts';
import { Apprenant, aiguilleurDePoche, empreinteApprenant, fabriqueAiguilleurOdin, majVide, type EtatApprenant, type FabriqueAiguillage, type Maj, type Vue } from './apprenant.ts';

const ICI = fileURLToPath(import.meta.url);
export const RACINE = fileURLToPath(new URL('../../../', import.meta.url));

// ------------------------------------------------------------------------------------------------ les variantes
export type Variante = 'A' | 'B' | 'temoin' | 'melange';
export const VARIANTES: readonly Variante[] = Object.freeze(['A', 'B', 'temoin', 'melange']);
/** `melange` : l'apprenant apprend de verdicts mélangés entre épisodes (le témoin à verdicts mélangés). */
export interface ReglagesBoucle { apprend: boolean; exploration: boolean; facteurSigne: boolean; pratiqueProgres: boolean; melange: boolean }
export function reglagesDe(v: Variante): ReglagesBoucle {
  if (v === 'A') return { apprend: true, exploration: false, facteurSigne: false, pratiqueProgres: false, melange: false };
  if (v === 'B') return { apprend: true, exploration: true, facteurSigne: true, pratiqueProgres: true, melange: false };
  if (v === 'melange') return { apprend: true, exploration: false, facteurSigne: false, pratiqueProgres: false, melange: true };
  return { apprend: false, exploration: false, facteurSigne: false, pratiqueProgres: false, melange: false };
}

// ------------------------------------------------------------------------------------------------ l'audit des lectures
/** Les fichiers que la boucle ne doit JAMAIS ouvrir : les jeux et le manifeste du banc, les fichiers du côté banc, les jeux figés « principal ». */
export function interditDeLecture(chemin: string): boolean {
  const c = resolve(String(chemin)).toLowerCase(), b = basename(c);
  if (interditALaBoucle(c)) return true;
  if (/^actions-(porte|cache|manifeste)\.json$/.test(b)) return true;
  if (b.includes('principal') && b.endsWith('.json')) return true;
  return false;
}
export interface Audit { ouverts: Set<string>; refus: string[]; retirer(): void }
/**
 * Surveille chaque ouverture de fichier du processus (lecture comme écriture) : la note, et REFUSE (erreur levée) celles
 * que `interdit` désigne. Les refus sont comptés : un seul suffit à annuler le run.
 */
export function installerAudit(interdit: (chemin: string) => boolean = interditDeLecture): Audit {
  const ouverts = new Set<string>(), refus: string[] = [];
  // L'objet du module tel que le voient tous ses usagers (les imports nommés sont remis à jour juste après).
  const brut = createRequire(import.meta.url)('node:fs') as typeof fs;
  const f = brut as unknown as Record<string, (...a: unknown[]) => unknown>;
  const p = brut.promises as unknown as Record<string, (...a: unknown[]) => unknown>;
  const noms = ['openSync', 'readFileSync', 'open', 'readFile', 'createReadStream'], nomsP = ['open', 'readFile'];
  const garde = (orig: (...a: unknown[]) => unknown, promesse: boolean) => function (this: unknown, ...a: unknown[]) {
    const x = a[0];
    if (typeof x === 'string' || x instanceof URL || Buffer.isBuffer(x)) {
      const chemin = x instanceof URL ? fileURLToPath(x) : String(x);
      if (interdit(chemin)) {
        refus.push(chemin);
        const e = Object.assign(new Error(`lecture refusée à la boucle : ${basename(chemin)} est un fichier du banc`), { code: 'EACCES' });
        if (promesse) return Promise.reject(e);
        throw e;
      }
      if (ouverts.size < 5000) ouverts.add(resolve(chemin));
    }
    return orig.apply(this, a);
  };
  const avant = new Map<string, (...a: unknown[]) => unknown>(), avantP = new Map<string, (...a: unknown[]) => unknown>();
  for (const n of noms) { avant.set(n, f[n]); f[n] = garde(f[n], false); }
  for (const n of nomsP) { avantP.set(n, p[n]); p[n] = garde(p[n], true); }
  syncBuiltinESMExports();
  return { ouverts, refus, retirer() { for (const [n, g] of avant) f[n] = g; for (const [n, g] of avantP) p[n] = g; syncBuiltinESMExports(); } };
}

// ------------------------------------------------------------------------------------------------ la machine
/** La charge de la machine par AUTRE CHOSE que ce processus, entre deux appels (0 à 1). */
export function mesureurDeCharge(): () => number {
  const lire = () => { let occupe = 0, total = 0; for (const c of cpus()) { const t = c.times; occupe += t.user + t.nice + t.sys + t.irq; total += t.user + t.nice + t.sys + t.irq + t.idle; } return { occupe, total }; };
  let a = lire(), u = process.cpuUsage(), t = Date.now();
  return () => {
    const b = lire(), v = process.cpuUsage(), s = Date.now();
    const machine = b.total > a.total ? (b.occupe - a.occupe) / (b.total - a.total) : 0;
    const moi = s > t ? ((v.user - u.user + v.system - u.system) / 1000) / ((s - t) * Math.max(1, cpus().length)) : 0;
    a = b; u = v; t = s;
    return Math.max(0, Math.min(1, machine - moi));
  };
}
function tailleDossier(d: string, max = 20000): number {
  let n = 0, vus = 0;
  const pile = [d];
  while (pile.length && vus < max) {
    const x = pile.pop()!;
    let l: fs.Dirent[]; try { l = fs.readdirSync(x, { withFileTypes: true }); } catch { continue; }
    for (const e of l) { vus++; const c = join(x, e.name); if (e.isDirectory()) pile.push(c); else { try { n += fs.statSync(c).size; } catch { /* parti */ } } }
  }
  return n;
}
const attendre = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
function prioriteBasse(): void { try { setPriority(0, osConstants.priority.PRIORITY_LOW); } catch { /* pas permis : tant pis */ } }

// ------------------------------------------------------------------------------------------------ B3 : pratiquer selon le progrès
/** Le progrès absolu récent de chaque compétence, sur SES épisodes d'entraînement (jamais sur le banc). */
export class Progres {
  readonly fenetre: number;
  private readonly issues = new Map<string, number[]>();
  private readonly plats = new Map<string, number>();
  constructor(fenetre = 20) { this.fenetre = fenetre; }
  noter(c: string, juste: boolean): void {
    const l = this.issues.get(c) ?? []; l.push(juste ? 1 : 0); this.issues.set(c, l);
    if (l.length % this.fenetre === 0 && l.length >= 2 * this.fenetre) this.plats.set(c, this.progres(c) < 0.02 ? (this.plats.get(c) ?? 0) + 1 : 0);
  }
  /** |réussite de la dernière fenêtre − celle d'avant| (0 tant qu'il n'y a pas deux fenêtres). */
  progres(c: string): number {
    const l = this.issues.get(c) ?? [], f = this.fenetre;
    if (l.length < 2 * f) return 0;
    const n = l.length - (l.length % f), moy = (a: number, b: number) => l.slice(a, b).reduce((s, x) => s + x, 0) / f;
    return Math.abs(moy(n - f, n) - moy(n - 2 * f, n - f));
  }
  /** Une compétence qui ne progresse plus depuis trois fenêtres descend au plancher. */
  poids(c: string, plancher: number): number { return (this.plats.get(c) ?? 0) >= 3 ? plancher : Math.max(plancher, this.progres(c)); }
}
/**
 * Tire l'épisode suivant du deuxième passage : 20 % au hasard ; sinon une compétence en proportion de son progrès
 * (avec un plancher pour qu'aucune ne soit oubliée), puis un épisode de cette compétence. Sans remise par défaut ;
 * avec remise (`remise`), le lot ne change pas : c'est ainsi que la boucle tire, pour que la pratique suive le progrès
 * (sans remise sur tout le lot, le deuxième passage rejouerait chaque épisode une fois : seul l'ordre changerait).
 */
export function tirerSelonProgres(reste: Episode[], progres: Progres, alea: () => number, plancher = 0.05, hasardPart = 0.2, remise = false): Episode {
  const prendre = (i: number): Episode => (remise ? reste[i] : reste.splice(i, 1)[0]);
  if (alea() < hasardPart) return prendre(Math.floor(alea() * reste.length));
  const presentes = [...new Set(reste.map((e) => e.competence))].sort();
  const poids = presentes.map((c) => progres.poids(c, plancher)), total = poids.reduce((s, x) => s + x, 0);
  let x = alea() * total, choisie = presentes[presentes.length - 1];
  for (let i = 0; i < presentes.length; i++) { x -= poids[i]; if (x <= 0) { choisie = presentes[i]; break; } }
  const idx = reste.map((e, i) => (e.competence === choisie ? i : -1)).filter((i) => i >= 0);
  return prendre(idx[Math.floor(alea() * idx.length)]);
}

// ------------------------------------------------------------------------------------------------ la signature du comportement
/** Combien de phrases d'entraînement fixes servent à la signature du comportement. */
export const PHRASES_SIGNATURE = 30;
/** Les vues fixes de la signature : des épisodes d'entraînement pris à intervalle régulier, dans l'ordre de leur nom. */
export function vuesDeSignature(episodes: readonly Episode[], n = PHRASES_SIGNATURE): Vue[] {
  const tries = [...episodes].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)), pas = Math.max(1, Math.floor(tries.length / n));
  return tries.filter((_, i) => i % pas === 0).slice(0, n).map((e) => vueApprenant(e));
}
/**
 * L'empreinte de ce que l'apprenant FAIT (pas de ce qu'il contient) : sur des vues fixes, ce que son aiguillage choisit
 * et ce qu'il propose en premier. Deux apprenants de même signature répondent pareil à ces phrases.
 */
export function signatureComportement(app: Apprenant, vues: readonly Vue[]): string {
  const h = createHash('sha256');
  for (const v of vues) h.update(`${JSON.stringify([app.aiguillage(v), app.essais(v, 1)[0].proposition])}\n`);
  return `sha256:${h.digest('hex')}`;
}

// ------------------------------------------------------------------------------------------------ l'entraînement (le cœur, sans processus)
export type ReponsePorte = { decision: 'garde' | 'refuse' } | { arret: 'banc-altere' };
export interface Plafonds { tempsS: number; memoireMo: number; disqueMo: number; chargeMax: number; pauseMs: number; pausesMax: number; episodeMs: number }
export const PLAFONDS: Plafonds = Object.freeze({ tempsS: 30 * 60, memoireMo: 1536, disqueMo: 200, chargeMax: 0.35, pauseMs: 5000, pausesMax: 12, episodeMs: 2000 });
/** Combien de verdicts récents le témoin à verdicts mélangés garde pour en tirer un au hasard. */
export const RESERVE_MELANGE = 50;
export interface OptionsEntrainement {
  monde: Monde; episodes: Episode[]; fabrique: FabriqueAiguillage;
  run: string; variante: Variante; graine: number;
  /** nombre de pas en tout (défaut : deux passages) */
  pas?: number; lot?: number;
  reglages?: Partial<ReglagesBoucle>;
  /** la porte : reçoit les deux états, rend « garde » / « refuse » (ou l'arrêt si le banc a changé) */
  porte: (pas: number, enService: EtatApprenant, candidat: EtatApprenant) => Promise<ReponsePorte>;
  /** quand rien n'a été appris depuis la dernière porte : le banc mesure quand même l'état en service à ce pas (rien n'en revient), pour que toutes les courbes aient les mêmes points */
  mesure?: (pas: number, enService: EtatApprenant) => Promise<void>;
  /** une mesure du banc caché à 0, 25, 50, 75 ou 100 % (rien n'en revient) */
  jalon?: (pas: number, part: number, etat: EtatApprenant) => Promise<void>;
  journal?: Ecrivain<Ligne>;
  entete?: Record<string, unknown>;
  /** le dossier du run : fichier STOP, instantanés, taille sur le disque */
  dossier?: string;
  plafonds?: Partial<Plafonds>;
  /** arrêt après tant de portes refusées de suite ; 0 ou absent = jamais (on va jusqu'au bout, la porte refuse toujours ce qui n'est pas meilleur) */
  arretApresRefus?: number;
  /** le suivi du progrès de B3 (pour les essais : un suivi réglé d'avance) */
  progres?: Progres;
  /** appelé après chaque épisode (pour les essais) */
  apresEpisode?: (x: { pas: number; ep: Episode; premier: Verdict; retenu: number | null; maj: Maj }) => void;
  /** appelé après chaque porte, l'apprenant remis dans l'état en service (pour les essais) */
  apresPorte?: (x: { pas: number; decision: 'garde' | 'refuse'; app: Apprenant; enService: EtatApprenant; signature: string; vues: readonly Vue[] }) => void;
}
export interface Resultat { raison: string; pas: number; gardees: number; refusees: number; duree_s: number; pauses_s: number; etat: EtatApprenant; journalFin?: string; reussites: number[] }
const entierPositif = (x: number): boolean => Number.isInteger(x) && x >= 1;

/**
 * L'entraînement lui-même. Ne lit aucun fichier du banc : il ne connaît que le monde, ses épisodes d'entraînement, et
 * une fonction `porte` qui ne rend qu'une décision.
 */
export async function entrainer(o: OptionsEntrainement): Promise<Resultat> {
  const R = { ...reglagesDe(o.variante), ...(o.reglages ?? {}) }, P = { ...PLAFONDS, ...(o.plafonds ?? {}) };
  const lot = o.lot ?? 100, total = o.pas ?? 2 * o.episodes.length, alea = hasard(o.graine);
  if (!entierPositif(lot)) throw new Error(`lot : un nombre entier d'épisodes, au moins 1 (${lot})`);
  if (!entierPositif(total)) throw new Error(`pas : un nombre entier d'épisodes, au moins 1 (${total})`);
  if (!o.episodes.length) throw new Error('aucun épisode d\'entraînement');
  const debut = Date.now(), charge = mesureurDeCharge();
  const app = new Apprenant(o.monde, o.fabrique, undefined, { apprend: R.apprend, exploration: R.exploration, facteurSigne: R.facteurSigne });
  // Ce que la porte compare pour savoir s'il y a du neuf : l'état sans son horloge (le temps qui passe n'est pas un apprentissage).
  const contenu = (e: EtatApprenant) => empreinteApprenant({ ...e, horloge: 0 });
  // Ce que l'état en service FAIT, sur des phrases d'entraînement fixes : vérifié après chaque retour arrière.
  const vues = vuesDeSignature(o.episodes), signature = () => signatureComportement(app, vues);
  let enService = app.etat(), empService = contenu(enService), sigService = signature();
  let gardees = 0, refusees = 0, refusDeSuite = 0, raison = 'pas-max', pas = 0, lents = 0, pause = false, pausesMs = 0;
  const progres = o.progres ?? new Progres(), reussites: number[] = [];
  o.journal?.ecrire({ t: 'entete', ...(o.entete ?? {}), run: o.run, variante: o.variante, graine: o.graine, reglages: { ...(o.entete?.reglages as object ?? {}), lot, pas_max: total, exploration: R.exploration, facteur_signe: R.facteurSigne, pratique_progres: R.pratiqueProgres, apprend: R.apprend, verdicts_melanges: R.melange, temps_max: P.tempsS, memoire_max: P.memoireMo, disque_max: P.disqueMo, charge_max: P.chargeMax }, debut: new Date(debut).toISOString() } as never);
  const jalons = PARTS.filter((x) => x > 0).map((part) => ({ part, pas: Math.max(1, Math.round(total * part / 100)), fait: false }));
  if (o.jalon) await o.jalon(0, 0, enService);
  const ecrireInstantane = (nom: string, e: EtatApprenant) => { if (o.dossier) { const d = join(o.dossier, 'instantanes'); fs.mkdirSync(d, { recursive: true }); fs.writeFileSync(join(d, `${nom}.json`), JSON.stringify(e)); } };
  ecrireInstantane('en-service', enService);

  const passer = async (): Promise<boolean> => {
    const candidat = app.etat(), empCand = contenu(candidat);
    if (empCand === empService) { if (o.mesure) await o.mesure(pas, enService); return true; }   // rien appris : rien à essayer, seulement la mesure du point
    ecrireInstantane('candidat', candidat);
    const r = await o.porte(pas, enService, candidat);
    if ('arret' in r) { raison = r.arret; return false; }
    if (r.decision === 'garde') {
      enService = candidat; empService = empCand; gardees++; refusDeSuite = 0; ecrireInstantane('en-service', enService);
      // L'état gardé tourne désormais TEL QUE LE BANC L'A MESURÉ : l'aiguillage est refait à partir de ses leçons, comme
      // au banc (les leçons ajoutées une à une pendant le lot ne donnent pas toujours le même aiguillage).
      app.charger(enService); sigService = signature();
      o.apresPorte?.({ pas, decision: 'garde', app, enService, signature: sigService, vues });
      return true;
    }
    refusees++; refusDeSuite++;
    app.charger(enService);
    if (app.empreinte() !== empreinteApprenant(enService)) throw new Error('retour arrière : l\'état remis en place n\'a pas l\'empreinte de l\'état en service');
    const sig = signature();
    if (sig !== sigService) throw new Error(`retour arrière : l'apprenant remis en place ne répond pas comme l'état en service sur les ${vues.length} phrases fixes (signature ${sig.slice(7, 19)} au lieu de ${sigService.slice(7, 19)})`);
    o.apresPorte?.({ pas, decision: 'refuse', app, enService, signature: sig, vues });
    if (o.arretApresRefus && refusDeSuite >= o.arretApresRefus) { raison = 'refus-de-suite'; return false; }
    return true;
  };

  // Le témoin à verdicts mélangés : une réserve des derniers verdicts, et un hasard à graine fixe (tirée de celle du run).
  const reserve: Array<Pick<Verdict, 'toutJuste' | 'issue' | 'voie' | 'fauteSurete' | 'detail'>> = [];
  const aleaMelange = hasard((Math.imul(o.graine ^ 0x6d656c61, 2246822519) + 7) >>> 0);
  const ordre1 = melanger(o.episodes, alea), alea2 = hasard((Math.imul(o.graine ^ 0x5bd1e995, 2654435761) + 1) >>> 0);
  const ordre2 = R.pratiqueProgres ? null : melanger(o.episodes, alea2);
  let continuer = true;
  while (continuer && pas < total) {
    // Les plafonds et l'arrêt propre. Le temps passé en pause (machine occupée par autre chose) n'est pas compté.
    if (o.dossier && fs.existsSync(join(o.dossier, 'STOP'))) { raison = 'stop'; break; }
    if ((Date.now() - debut - pausesMs) / 1000 > P.tempsS) { raison = 'temps-max'; break; }
    if (pas % 25 === 0 && process.memoryUsage().rss / 2 ** 20 > P.memoireMo) { raison = 'memoire-max'; break; }
    if (pas % 100 === 0 && o.dossier && tailleDossier(o.dossier) / 2 ** 20 > P.disqueMo) { raison = 'disque-max'; break; }
    if (pas % 50 === 0 && P.chargeMax < 1) { let n = 0; pause = false; while (charge() > P.chargeMax && n++ < P.pausesMax) { pause = true; const t = Date.now(); await attendre(P.pauseMs); pausesMs += Date.now() - t; } }
    // L'épisode suivant. Au deuxième passage, B3 tire AVEC remise selon le progrès (même nombre de pas que les autres).
    const passage = pas < o.episodes.length ? 1 : 2;
    let ep: Episode;
    if (passage === 1) ep = ordre1[pas % ordre1.length];
    else if (ordre2) ep = ordre2[(pas - o.episodes.length) % ordre2.length];
    else ep = tirerSelonProgres(o.episodes, progres, alea2, undefined, undefined, true);
    pas++;
    const t0 = performance.now(), vue = vueApprenant(ep);
    const essais = app.essais(vue);
    const premier = verifier(o.monde, ep, essais[0].proposition);
    let retenu: number | null = premier.toutJuste ? 1 : null, fautesEssais = 0, faits = 1;
    let verdictRetenu: Verdict | null = premier.toutJuste ? premier : null;
    if (!premier.toutJuste && !premier.fauteSurete) for (let i = 1; i < essais.length; i++) {
      faits++;
      const v = verifier(o.monde, ep, essais[i].proposition);
      if (v.fauteSurete) { fautesEssais++; continue; }
      if (v.toutJuste) { retenu = i + 1; verdictRetenu = v; break; }
    }
    const maj = majVide(), ajouter = (m: Maj) => { for (const k of Object.keys(m) as Array<keyof Maj>) maj[k] += m[k]; };
    // L'apprenant ne reçoit du verdict que ce qui dit OÙ est la faute : jamais son texte (« pourquoi »), jamais la réponse attendue.
    const pourApprendre = (v: Verdict) => ({ toutJuste: v.toutJuste, issue: v.issue, voie: v.voie, fauteSurete: v.fauteSurete, detail: { ...v.detail } });
    if (R.melange) {
      // Le verdict appris n'est pas celui de cet épisode : il est tiré au hasard parmi ceux des derniers épisodes (le sien compris).
      reserve.push(pourApprendre(premier));
      if (reserve.length > RESERVE_MELANGE) reserve.shift();
      ajouter(app.retenir(vue, essais[0], reserve[Math.floor(aleaMelange() * reserve.length)]));
    } else {
      if (retenu !== 1) ajouter(app.retenir(vue, essais[0], pourApprendre(premier)));
      if (retenu !== null && verdictRetenu) ajouter(app.retenir(vue, essais[retenu - 1], pourApprendre(verdictRetenu)));
    }
    app.avancer();
    progres.noter(ep.competence, premier.toutJuste);
    reussites.push(premier.toutJuste ? 1 : 0);
    const ms = performance.now() - t0;
    if (ms > P.episodeMs) lents++;
    // Une réponse tolérée (réussie, sans rien à en apprendre) a sa propre issue : « tolere », récompense 0.
    const tolere = premier.issue === 'succes' && !premier.toutJuste;
    o.journal?.ecrire({ t: 'episode', run: o.run, pas, passage, ep: empreinteCourte(`${ep.id}\u0000${ep.phrase}`), competence: ep.competence, langue: ep.langue, perturbe: Boolean(ep.perturbe), essais: faits, rang_retenu: retenu, issue: tolere ? 'tolere' : premier.issue, r: premier.recompense, surete: premier.fauteSurete ? 1 : 0, ms: Math.round(ms * 10) / 10, maj: { ...maj }, ...(fautesEssais ? { surete_essais: fautesEssais } : {}) } as never);
    o.apresEpisode?.({ pas, ep, premier, retenu, maj });
    if (pas % 100 === 0) o.journal?.ecrire({ t: 'systeme', run: o.run, pas, memoire_mo: Math.round(process.memoryUsage().rss / 2 ** 20), cpu_s: Math.round((process.cpuUsage().user + process.cpuUsage().system) / 1e4) / 100, charge: Math.round(charge() * 1000) / 1000, pause, lents } as never);
    // La porte, tous les `lot` épisodes (et au dernier pas).
    if (pas % lot === 0 || pas === total) continuer = await passer();
    for (const j of jalons) if (!j.fait && pas >= j.pas && continuer) { j.fait = true; if (o.jalon) await o.jalon(pas, j.part, enService); }
  }
  // Un arrêt avant la fin : ce qui n'a pas passé la porte est perdu (l'état en service reste) ; les mesures du banc
  // caché qui manquent sont faites sur cet état, qui ne bougera plus.
  if (raison !== 'pas-max' || pas < total) app.charger(enService);
  for (const j of jalons) if (!j.fait) { j.fait = true; if (o.jalon) await o.jalon(pas, j.part, enService); }
  const duree_s = Math.round((Date.now() - debut) / 100) / 10, pauses_s = Math.round(pausesMs / 100) / 10;
  let journalFin: string | undefined;
  if (o.journal) { o.journal.ecrire({ t: 'fin', run: o.run, pas, raison, portes: { gardees, refusees }, duree_s, ...(pauses_s ? { pauses_s } : {}) } as never); journalFin = o.journal.sommet(); }
  return { raison, pas, gardees, refusees, duree_s, pauses_s, etat: enService, journalFin, reussites };
}

// ------------------------------------------------------------------------------------------------ les processus
interface Args { [k: string]: string | boolean | undefined }
function lireArgs(argv: string[]): Args {
  const a: Args = {};
  for (let i = 0; i < argv.length; i++) { const x = argv[i]; if (!x.startsWith('--')) continue; const k = x.slice(2), v = argv[i + 1]; if (v === undefined || v.startsWith('--')) a[k] = true; else { a[k] = v; i++; } }
  return a;
}
const nombre = (x: unknown, d: number): number => { const n = Number(x); return x === undefined || x === true || !Number.isFinite(n) ? d : n; };
/** Le numéro du commit en cours, lu dans le dossier .git (rien n'est lancé). */
function commitEnCours(depot: string): string {
  try {
    const head = fs.readFileSync(join(depot, '.git', 'HEAD'), 'utf8').trim();
    if (/^[0-9a-f]{40}$/.test(head)) return head;
    const ref = /^ref: (.+)$/.exec(head)?.[1];
    if (!ref) return '0000000';
    try { return fs.readFileSync(join(depot, '.git', ref), 'utf8').trim(); } catch { /* rangé à part */ }
    const l = fs.readFileSync(join(depot, '.git', 'packed-refs'), 'utf8').split('\n').find((x) => x.endsWith(` ${ref}`));
    return l ? l.slice(0, 40) : '0000000';
  } catch { return '0000000'; }
}
/** Vrai si `x` est `parent` ou se trouve dedans (sans tenir compte de la casse sous Windows). */
export function dedans(x: string, parent: string): boolean {
  const n = (c: string) => { const r = resolve(c).replace(/[\\/]+$/, ''); return process.platform === 'win32' ? r.toLowerCase() : r; };
  const a = n(x), b = n(parent);
  return a === b || a.startsWith(b + sep);
}
/** Les modules chargés d'avance par NODE_OPTIONS (--import, --require) : le processus enfant en hérite, il doit pouvoir les lire. */
function prechargements(): string[] {
  const out: string[] = [];
  for (const m of (process.env.NODE_OPTIONS ?? '').matchAll(/--(?:import|require|r)(?:=|\s+)("[^"]+"|\S+)/g)) {
    let x = m[1].replace(/^"|"$/g, '');
    try { if (x.startsWith('file:')) x = fileURLToPath(x); } catch { continue; }
    if (/^([A-Za-z]:|[\\/]|\.)/.test(x)) out.push(resolve(x));
  }
  return out;
}
/** Les jeux que la boucle a le droit de lire : le monde, les gabarits d'entraînement, et les trois jeux de TRAVAIL. */
export const JEUX_DE_LA_BOUCLE: readonly string[] = Object.freeze(['actions-monde', 'actions-entrainement-gabarits', 'taches-developpement', 'comprehension-developpement', 'developpement']);
/**
 * Ce que le processus de la BOUCLE a le droit de lire et d'écrire, sous le modèle de permissions de Node : les sources
 * (src/, le dossier des actions, fuites.ts), le monde, les gabarits et les jeux de travail, son dossier, le cache de
 * l'aiguilleur (en lecture : la calibration est faite avant, par le côté banc) et les modules chargés d'avance.
 * Écriture : son dossier seulement. Ni fil de travail, ni processus fils, ni réseau (rien n'est permis pour eux).
 */
export function permissionsBoucle(o: { dossier: string; cache: string }): { lire: string[]; ecrire: string[]; execArgv: string[] } {
  const ici = join(RACINE, 'test', 'soul-banc');
  const lire = [join(RACINE, 'src'), join(ici, 'actions'), join(ici, 'fuites.ts'), ...JEUX_DE_LA_BOUCLE.map((n) => join(ici, 'jeux', `${n}.json`)), resolve(o.dossier), resolve(o.cache), ...prechargements()];
  const ecrire = [resolve(o.dossier)];
  return { lire, ecrire, execArgv: ['--permission', ...lire.map((x) => `--allow-fs-read=${x}`), ...ecrire.map((x) => `--allow-fs-write=${x}`)] };
}

/** L'aiguillage demandé : celui d'Odin (dossier jetable) ou celui de poche (les actions du monde, nommées par leur nom). */
async function fabriqueDe(genre: string, home: string, cache: string, monde: Monde): Promise<FabriqueAiguillage> {
  if (genre === 'poche') return aiguilleurDePoche(Object.entries(monde.registre).flatMap(([appli, acts]) => Object.keys(acts).map((action) => ({ texte: `${appli} ${action.replace(/_/g, ' ')}`, appli, action }))));
  return fabriqueAiguilleurOdin({ home, cache });
}

/** Le processus de la BOUCLE (enfant). Il ne connaît ni la racine du banc ni le banc. */
async function roleBoucle(a: Args): Promise<void> {
  prioriteBasse();
  const audit = installerAudit();
  const dossier = String(a.dossier), run = String(a.run), variante = String(a.variante) as Variante, graine = nombre(a.graine, 1);
  let id = 0;
  const attente = new Map<number, (x: unknown) => void>();
  process.on('message', (m: { id?: number; t?: string }) => { if (m?.id !== undefined && attente.has(m.id)) { attente.get(m.id)!(m); attente.delete(m.id); } });
  const demander = <T>(m: Record<string, unknown>): Promise<T> => new Promise<T>((ok) => { const i = ++id; attente.set(i, ok as (x: unknown) => void); process.send!({ ...m, id: i }); });
  const depart = await demander<{ retirer: string[]; entete: Record<string, unknown> }>({ t: 'pret' });
  const monde = chargerMonde();
  const episodes = retirer(lotEntrainement(monde, { graine: nombre(a['graine-lot'], 20261120) }).episodes, depart.retirer);
  const empEpisodes = `sha256:${createHash('sha256').update(episodes.map((e) => `${e.id}\u0000${e.phrase}`).join('\n')).digest('hex')}`;
  const fabrique = await fabriqueDe(String(a.aiguilleur ?? 'odin'), join(dossier, 'odin-boucle'), String(a.cache), monde);
  const journal = ouvrirJournal(join(dossier, NOM_JOURNAL));
  const reglages: Partial<ReglagesBoucle> = {};
  if (a['sans-exploration']) reglages.exploration = false;
  if (a['sans-facteur']) reglages.facteurSigne = false;
  if (a['sans-progres']) reglages.pratiqueProgres = false;
  let resultat: Resultat | undefined, erreur: unknown;
  try {
    resultat = await entrainer({
      monde, episodes, fabrique, run, variante, graine, pas: nombre(a.pas, 2 * episodes.length), lot: nombre(a.lot, 100), reglages, journal, dossier, arretApresRefus: nombre(a['arret-refus'], 0),
      entete: { ...depart.entete, episodes: empEpisodes, reglages: { aiguilleur: String(a.aiguilleur ?? 'odin'), graine_lot: nombre(a['graine-lot'], 20261120), episodes: episodes.length, arret_refus: nombre(a['arret-refus'], 0) } },
      plafonds: { tempsS: nombre(a['temps-max'], PLAFONDS.tempsS), memoireMo: nombre(a['memoire-max'], PLAFONDS.memoireMo), disqueMo: nombre(a['disque-max'], PLAFONDS.disqueMo), chargeMax: nombre(a['charge-max'], PLAFONDS.chargeMax) },
      porte: async (pas, s, c) => {
        const d = join(dossier, 'instantanes');
        return demander<ReponsePorte & { id: number }>({ t: 'porte', pas, enService: join(d, 'en-service.json'), candidat: join(d, 'candidat.json'), e1: empreinteApprenant(s), e2: empreinteApprenant(c) }).then((r) => ('arret' in r ? { arret: r.arret } : { decision: r.decision }));
      },
      mesure: async (pas, e) => { const f = join(dossier, 'instantanes', 'en-service.json'); await demander({ t: 'mesure', pas, etat: f, e: empreinteApprenant(e) }); },
      jalon: async (pas, part, e) => { const f = join(dossier, 'instantanes', `jalon-${part}.json`); fs.mkdirSync(dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(e)); await demander({ t: 'jalon', pas, part, etat: f, e: empreinteApprenant(e) }); fs.rmSync(f, { force: true }); },
    });
  } catch (e) { erreur = e; }
  if (!resultat) {
    try { journal.ecrire({ t: 'fin', run, pas: 0, raison: audit.refus.length ? 'banc-faux' : 'erreur', portes: { gardees: 0, refusees: 0 }, duree_s: 0 }); } catch { /* journal déjà clos */ }
  }
  journal.fermer();
  const ouverts = [...audit.ouverts].map((x) => relative(RACINE, x).split(sep).join('/'));
  audit.retirer();
  // Ce que le modèle de permissions de Node interdit vraiment à ce processus (vu de l'intérieur).
  const perm = (process as unknown as { permission?: { has(s: string, r?: string): boolean } }).permission;
  const jeuxDuBanc = ['actions-porte', 'actions-cache', 'actions-manifeste'].map((n) => join(RACINE, 'test', 'soul-banc', 'jeux', `${n}.json`));
  const permission = perm ? {
    actif: true, lecture_jeux_du_banc: jeuxDuBanc.some((f) => perm.has('fs.read', f)), lecture_depot: perm.has('fs.read', RACINE), lecture_temporaire: perm.has('fs.read', tmpdir()),
    ecriture_hors_dossier: perm.has('fs.write', RACINE) || perm.has('fs.write', tmpdir()), fils_de_travail: perm.has('worker'), processus_fils: perm.has('child'), reseau: perm.has('net'),
  } : { actif: false };
  fs.writeFileSync(join(dossier, 'audit.json'), JSON.stringify({ refus: audit.refus.map((x) => basename(x)), ouverts: ouverts.sort(), permission }, null, 1));
  await demander({ t: 'fin', pas: resultat?.pas ?? 0, journalFin: journal.sommet(), refus: audit.refus.length, raison: resultat?.raison ?? 'erreur' });
  if (erreur) { console.error(String((erreur as Error)?.stack ?? erreur)); process.exitCode = 1; }
  if (audit.refus.length) { console.error(`AUDIT : ${audit.refus.length} lecture(s) d'un fichier du banc refusée(s) : run annulé.`); process.exitCode = 3; }
  process.disconnect?.();
}

/** Le processus du BANC (celui qu'on lance) : la porte, le banc caché, et la boucle dans un processus enfant. */
async function roleLanceur(a: Args): Promise<number> {
  prioriteBasse();
  const variante = String(a.variante ?? '') as Variante;
  if (!VARIANTES.includes(variante)) throw new Error(`--variante ${VARIANTES.join(', ')}`);
  for (const k of ['lot', 'pas', 'arret-refus']) {
    if (a[k] === undefined) continue;
    const n = Number(a[k]);
    if (typeof a[k] !== 'string' || !Number.isInteger(n) || n < (k === 'arret-refus' ? 0 : 1)) throw new Error(`--${k} : un nombre entier${k === 'arret-refus' ? ', 0 ou plus' : ' d\'épisodes, au moins 1'} (${String(a[k])})`);
  }
  const graine = nombre(a.graine, 1), run = `${variante}-${graine}`;
  if (typeof a.sortie !== 'string') throw new Error('--sortie <racine de la boucle>');
  const empreinte = typeof a.empreinte === 'string' ? a.empreinte : process.env.BANC_EMPREINTE ?? '';
  if (!/^sha256:[0-9a-f]{64}$/.test(empreinte)) throw new Error('--empreinte sha256:<64 chiffres> : l\'empreinte du manifeste, notée AVANT de lancer (elle ne se calcule jamais ici)');
  const racineBoucle = resolve(a.sortie), racineBanc = resolve(typeof a.banc === 'string' ? a.banc : fs.mkdtempSync(join(tmpdir(), 'banc-')));
  // Les deux racines ne s'emboîtent jamais : la boucle lit son dossier, et rien du banc ne doit s'y trouver.
  if (dedans(racineBanc, racineBoucle) || dedans(racineBoucle, racineBanc)) throw new Error('--banc et --sortie : la racine du banc ne peut pas être dans celle de la boucle, ni l\'inverse');
  const { lirePrevus, ecrirePrevus } = await import('./journal.ts');
  let prevus = lirePrevus(racineBanc);
  if (!prevus.prevus) {
    const runs = String(a.runs ?? `A:${graine},B:${graine},temoin:${graine},melange:${graine}`).split(',').map((x) => { const [v, g] = x.split(':'); return { run: `${v}-${g}`, variante: v, graine: Number(g) }; });
    ecrirePrevus(racineBanc, { runs, comparer: { reference: 'A', candidat: 'B' }, temoin: 'temoin' });
    prevus = lirePrevus(racineBanc);
  }
  if (!prevus.prevus?.runs.some((r) => r.run === run)) throw new Error(`le run ${run} n'est pas dans la liste des runs prévus de ${racineBanc}`);
  const dossier = join(racineBoucle, run), cache = resolve(typeof a.cache === 'string' ? a.cache : join(racineBoucle, '_aiguilleur'));
  const droits = permissionsBoucle({ dossier, cache });
  const visible = droits.lire.find((x) => dedans(racineBanc, x) || dedans(x, racineBanc));
  if (visible) throw new Error(`la racine du banc serait lisible par la boucle (${visible}) : choisir d'autres dossiers`);
  fs.mkdirSync(dossier, { recursive: true }); fs.mkdirSync(cache, { recursive: true });
  // Le côté banc : le banc chargé (manifeste vérifié), la porte, le fichier scellé.
  const { CoteBanc } = await import('./porte.ts');
  const { phrasesDe, phrasesDuBanc, controleFuites } = await import('./banc.ts');
  const monde = chargerMonde();
  const fabrique = await fabriqueDe(String(a.aiguilleur ?? 'odin'), join(racineBanc, run, 'odin-banc'), cache, monde);
  const cote = new CoteBanc({ racine: racineBanc, run, empreinteManifeste: empreinte, fabrique });
  // Le contrôle de fuite, ici (côté banc) : ce qui ressemble au banc est retiré de l'entraînement, jamais du banc.
  const lot = lotEntrainement(monde, { graine: nombre(a['graine-lot'], 20261120) });
  const fuites = controleFuites(phrasesDe(lot.episodes), phrasesDuBanc(empreinte), { monde: cote.porteBanc.monde });
  console.log(`Run ${run} : ${lot.episodes.length} épisodes d'entraînement, ${fuites.aRetirer.length} retirés par le contrôle de fuite (${JSON.stringify(fuites.comptes)}).`);
  const entete = { ...cote.empreintes(), commit: commitEnCours(RACINE).slice(0, 40), prevus: prevus.empreinte };
  const enfant: ChildProcess = fork(ICI, ['--role', 'boucle', '--dossier', dossier, '--run', run, '--variante', variante, '--graine', String(graine), '--cache', cache,
    ...['pas', 'lot', 'aiguilleur', 'temps-max', 'memoire-max', 'disque-max', 'charge-max', 'graine-lot', 'arret-refus'].flatMap((k) => (typeof a[k] === 'string' ? [`--${k}`, a[k] as string] : [])),
    ...['sans-exploration', 'sans-facteur', 'sans-progres'].filter((k) => a[k]).map((k) => `--${k}`)], {
    // Le modèle de permissions de Node : la boucle ne lit que ce qu'il lui faut, n'écrit que dans son dossier, et n'a ni
    // fil de travail, ni processus fils, ni réseau. L'audit des lectures reste en plus (la liste des fichiers ouverts).
    execArgv: ['--disable-warning=ExperimentalWarning', `--max-old-space-size=${nombre(a['memoire-max'], PLAFONDS.memoireMo)}`, ...droits.execArgv],
    env: { ...process.env, UV_THREADPOOL_SIZE: '1' }, stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
  });
  let fin: { pas: number; journalFin?: string; refus: number; raison: string } | undefined, file = Promise.resolve();
  enfant.on('message', (m: Record<string, unknown>) => {
    // Une demande à la fois, dans l'ordre.
    file = file.then(async () => {
      const id = m.id;
      try {
        if (m.t === 'pret') { enfant.send({ id, retirer: fuites.aRetirer, entete }); await cote.debut(new Apprenant(monde, fabrique).etat()); return; }
        if (m.t === 'porte') {
          const r = await cote.porte(m.pas as number, CoteBanc.lireEtat(m.enService as string, m.e1 as string), CoteBanc.lireEtat(m.candidat as string, m.e2 as string));
          console.log(`  porte au pas ${m.pas} : ${'arret' in r ? `ARRÊT (${r.arret})` : r.decision}`);
          enfant.send({ id, ...r }); return;
        }
        if (m.t === 'mesure') { await cote.mesureSeule(m.pas as number, CoteBanc.lireEtat(m.etat as string, m.e as string)); enfant.send({ id, ok: true }); return; }
        if (m.t === 'jalon') { await cote.cache(m.pas as number, m.part as number, CoteBanc.lireEtat(m.etat as string, m.e as string)); enfant.send({ id, ok: true }); return; }
        if (m.t === 'fin') { fin = m as never; cote.clore(m.pas as number, m.journalFin as string); enfant.send({ id, ok: true }); }
      } catch (e) { console.error(`côté banc : ${String((e as Error)?.stack ?? e)}`); enfant.kill(); }
    });
  });
  const code = await new Promise<number>((ok) => enfant.on('exit', (c) => ok(c ?? 1)));
  await file;
  if (!fin) { try { cote.clore(0); } catch { /* déjà clos */ } }
  console.log(`Run ${run} fini : ${fin ? `${fin.raison}, ${fin.pas} pas` : 'sans fin écrite'} ; journal : ${join(dossier, NOM_JOURNAL)} ; banc : ${racineBanc}${fin?.refus ? ` ; AUDIT : ${fin.refus} lecture(s) refusée(s), run annulé` : ''}.`);
  return fin?.refus ? 3 : code;
}

if (process.argv[1] && resolve(process.argv[1]) === ICI) {
  const a = lireArgs(process.argv.slice(2));
  if (a.role === 'boucle') roleBoucle(a).catch((e) => { console.error(String((e as Error)?.stack ?? e)); process.exitCode = 1; process.disconnect?.(); });
  else roleLanceur(a).then((c) => { process.exitCode = c; }, (e) => { console.error(String((e as Error)?.message ?? e)); process.exitCode = 2; });
}
