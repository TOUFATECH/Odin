// Noûs — étape 4 : Odin lance LUI-MÊME l'entraînement de Noûs, à tout moment où il est LIBRE (jour, soir ou nuit).
//
// Libre = aucune réponse en cours (src/brain/nous/occupation.ts, tenu par Agent.run) et machine pas chargée par
// d'autres programmes. Dès qu'Odin commence à répondre, la séance s'arrête TOUT DE SUITE (signal d'arrêt partagé lu
// entre deux séquences par chaque fil de calcul) ; elle reprend plus tard là où elle en était (les poids de travail
// restent en mémoire, rien n'est perdu).
//
// Puissance (réglage `nous.puissance`) : « douce » = 1 fil, « normale » = la moitié des fils, « pleine » = tous les
// fils de la machine moins un (celui d'Odin). Le calcul tourne dans des workers : le fil d'Odin ne calcule jamais.
//
// Règle d'or (inchangée, nuit.ts) : les poids EN SERVICE ne changent qu'à un point de reprise qui fait MIEUX sur le
// banc tenu à part (porteDeQualite) ; retour arrière si la perte diverge (divergence) ou si ce n'est pas mieux.
// Une « tranche » d'entraînement = TRANCHE_MS de calcul effectif (cumulé à travers les interruptions), puis la porte.
//
// Avant le premier réseau : le VRAI découpage est appris sur le corpus (worker de préparation), puis les textes sont
// réencodés avec lui à chaque tranche (le corpus reste rangé en octets, sans perte).
//
// Rien si Noûs est coupé, en mode privé ou en démonstration ; rien sans corpus. Disque borné : 2 points de reprise
// (reprise.ts), le corpus par `disqueMaxMo`. Temps borné : une tranche à la fois, jamais pendant une réponse.
import { cpus, availableParallelism } from 'node:os';
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { divergence, porteDeQualite } from './nuit.ts';
import { quandOdinRepond, reponsesEnCours } from './occupation.ts';
import { enFond, type Jeux } from './preparation.ts';
import { decoupageAJour, lireDecoupageSerialise, serialiserDecoupage, type DecoupageSerialise } from './decoupage.ts';
import { listerReprises, lireReprise, prochainNumero } from './reprise.ts';
import { dossierCorpus, tailleCorpus, type OdinPourNous } from './file-odin.ts';
import { enEssai } from './deps.ts';
import { quandOubli } from './oubli.ts';
import type { Hyper } from './tailles.ts';
import type { Lot } from './etapes.ts';
import type { Avancee } from './nuit.ts';

export type Puissance = 'douce' | 'normale' | 'pleine';
export const PUISSANCES: Record<Puissance, string> = {
  douce: '1 fil : Noûs apprend lentement, la machine reste très libre',
  normale: 'la moitié des fils de la machine',
  pleine: 'tous les fils moins un (celui d\'Odin) : Noûs apprend le plus vite possible quand Odin est libre',
};
/** Le nombre de fils de calcul pour une puissance (la machine a `n` fils). */
export function filsPour(p: Puissance | string | undefined, n = availableParallelism()): number {
  if (p === 'douce') return 1;
  if (p === 'normale') return Math.max(1, Math.floor(n / 2));
  return Math.max(1, n - 1);
}

/** La part du processeur prise par les AUTRES programmes depuis la dernière mesure (0 à 1). */
export function chargeDesAutres(): () => number {
  const lire = () => { let occ = 0, tot = 0; for (const c of cpus()) { const t = c.times; occ += t.user + t.nice + t.sys + t.irq; tot += t.user + t.nice + t.sys + t.irq + t.idle; } return { occ, tot, moi: process.cpuUsage() }; };
  let avant = lire();
  return () => {
    const maint = lire();
    const tot = maint.tot - avant.tot, occ = maint.occ - avant.occ;
    const moi = ((maint.moi.user - avant.moi.user) + (maint.moi.system - avant.moi.system)) / 1000; // ms, tous fils d'Odin
    avant = maint;
    if (!(tot > 0)) return 0;
    return Math.max(0, Math.min(1, (occ - moi) / tot));
  };
}

/** Ce que l'entraînement attend du moteur (moteur.ts, Entraineur). */
export interface EntraineurPilote {
  seance(lots: Iterable<Lot>, o: { dureeMs: number; fils: number; signal: AbortSignal; graine: number }): Promise<Avancee>;
  perteSur(jeu: Int32Array[]): Promise<number>;
  ecrire(n: number): Promise<string>;
  revenirA(n: number): Promise<void>;
  arreter(): Promise<void>;
}

/** Ce que le pilote sait faire, injecté (le vrai moteur et les vrais workers en service ; des faux en essai). */
export interface Fabrique {
  /** Un entraîneur : le dernier point de reprise s'il existe, sinon un réseau neuf (taille et découpage donnés). */
  entraineur(home: string, neuf: { hyper: Hyper; dec: DecoupageSerialise; graine: number }): Promise<EntraineurPilote>;
  decoupage(home: string, vocab: number, graine: number, dir?: string): Promise<{ dec: DecoupageSerialise; textes: number }>;
  jeux(home: string, dec: DecoupageSerialise, contexte: number, graine: number, dir?: string): Promise<Jeux>;
  taille(): Promise<Hyper>;
}

export const fabriqueReelle: Fabrique = {
  async entraineur(home, neuf) {
    const m = await import('./moteur.ts');
    if (listerReprises(home).length) return m.chargerEntraineur(home);
    return m.nouvelEntraineur(neuf.hyper, lireDecoupageSerialise(neuf.dec), neuf.graine, home);
  },
  decoupage: (home, vocab, graine, dir) => enFond({ type: 'decoupage', home, dir, vocab, graine }),
  jeux: (home, dec, contexte, graine, dir) => enFond({ type: 'jeux', home, dir, dec, contexte, graine, maxSequences: 2048 }),
  taille: () => enFond({ type: 'taille' }),
};

/** Ce que la page montre (et ce qui est gardé sur le disque d'une fois sur l'autre). */
export interface EtatEntrainement {
  apprend: boolean;
  depuis?: string;            // début de la séance en cours
  phase?: string;             // ce qu'il fait maintenant (découpage, préparation, apprentissage, porte de qualité…)
  arret?: string;             // pourquoi il n'apprend pas en ce moment
  pas: number;                // pas d'apprentissage en tout
  tempsMs: number;            // temps de calcul en tout
  tranchesMs: number;         // calcul dans la tranche en cours (avant la porte de qualité)
  perte?: number;             // dernière perte d'entraînement
  perteBanc?: number;         // perte du réseau EN SERVICE sur le banc
  dernierPoint: number;       // point de reprise en service (-1 : aucun)
  fils: number;
  puissance: Puissance;
  derniere?: { quand: string; gardee: boolean; raison: string; perteAvant: number; perteApres: number; point?: number };
  interruptions: number;
  sansCible?: number;         // exemples vus qui n'avaient rien à apprendre (réponse hors du contexte), comptés à part
  dernierArretMs?: number;    // temps entre « Odin répond » et la fin de la séance (mesuré)
  bancSig?: string;           // le banc sur lequel perteBanc a été mesurée
  decoupageAncien?: string;   // le découpage en service est d'une ancienne règle (dit sur la page)
}

/** Lit un decoupage.json sans jamais lever : `dec` absent si le fichier manque ou est illisible. */
export function lireDecoupageFichier(f: string): { dec?: DecoupageSerialise } {
  try {
    const j = JSON.parse(readFileSync(f, 'utf8')) as { vocab: number; version: number; fusions: number[] };
    if (!j || !Number.isInteger(j.vocab) || !Number.isFinite(j.version) || !Array.isArray(j.fusions)) return {};
    return { dec: { vocab: j.vocab, version: j.version, fusions: Int32Array.from(j.fusions) } };
  } catch { return {}; }
}

/** Une empreinte du banc (nombre de séquences et leurs morceaux). */
function signature(banc: Int32Array[]): string { let h = 2166136261; for (const s of banc) for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s[i], 16777619) >>> 0; return `${banc.length}:${h.toString(36)}`; }

export const TRANCHE_MS = 10 * 60_000;
export const CHARGE_MAX = 0.35;
const GRAINE = 0x0d1a;

export interface OptionsPilote { essai?: boolean; odin: OdinPourNous; fabrique?: Fabrique; charge?: () => number; dir?: string; trancheMs?: number; seanceMs?: number; nCpu?: number; quandNouveauPoint?: (n: number) => void }

export class PiloteNous {
  readonly etat: EtatEntrainement;
  private o: OptionsPilote;
  private f: Fabrique;
  private charge: () => number;
  private e?: EntraineurPilote;
  private dec?: DecoupageSerialise;
  private jeux?: Jeux;
  private ac?: AbortController;
  private cycleEnCours?: Promise<void>;
  private arretDemandeA = 0;
  private desabonner: () => void;
  private derniereCharge = 0;
  private pasAvant = 0;
  private oubliEnAttente = false; // après « pas assez d'exemples » ou une panne : on attend avant de réessayer
  /** Attente avant un nouvel essai quand il n'y a rien à apprendre (ou après une panne). */
  static ATTENTE_MS = 15 * 60_000;

  constructor(o: OptionsPilote) {
    this.o = o; this.f = o.fabrique ?? fabriqueReelle; this.charge = o.charge ?? chargeDesAutres();
    const puissance = (o.odin.cfg.nous as { puissance?: Puissance } | undefined)?.puissance ?? 'pleine';
    this.etat = { apprend: false, pas: 0, tempsMs: 0, tranchesMs: 0, dernierPoint: -1, fils: filsPour(puissance, o.nCpu), puissance, interruptions: 0, ...this.lireEtat(), };
    this.etat.apprend = false; this.etat.phase = undefined;
    // Au démarrage, les poids de travail de la tranche entamée sont perdus (l'entraîneur repart du point en service) :
    // la tranche recommence, et la perte du banc sera remesurée sur le banc d'aujourd'hui (constat 4).
    this.etat.tranchesMs = 0;
    this.etat.dernierPoint = listerReprises(this.home)[0] ?? -1;
    // Dès qu'Odin commence à répondre : arrêt immédiat.
    const finReponse = quandOdinRepond(() => this.interrompre('Odin répond'));
    // Un oubli : la séance s'arrête, la tranche préparée (qui peut contenir le texte oublié) est jetée, et les poids de
    // travail reviennent au point en service avant de reprendre (rien d'appris sur le texte oublié n'est mis en service).
    const surOubli = (h: string) => { if (h !== this.o.odin.paths.home) return; this.oubliEnAttente = true; this.interrompre('un souvenir a été oublié'); };
    quandOubli.add(surOubli);
    this.desabonner = () => { finReponse(); quandOubli.delete(surOubli); };
  }

  private get home(): string { return this.o.odin.paths.home; }
  private fichier(nom: string): string { const d = join(this.home, 'cerveau-reseau'); mkdirSync(d, { recursive: true }); return join(d, nom); }
  private lireEtat(): Partial<EtatEntrainement> { try { return JSON.parse(readFileSync(join(this.home, 'cerveau-reseau', 'entrainement.json'), 'utf8')) as Partial<EtatEntrainement>; } catch { return {}; } }
  private garderEtat(): void {
    try { const f = this.fichier('entrainement.json'); writeFileSync(`${f}.tmp`, JSON.stringify({ ...this.etat, apprend: false }), { mode: 0o600 }); renameSync(`${f}.tmp`, f); } catch { /* rien */ }
  }

  /** Noûs a-t-il le droit d'apprendre (interrupteur, mode privé, démonstration) ? */
  private permis(): string | undefined {
    const c = this.o.odin.cfg;
    if (c.nous?.actif === false) return 'Noûs est en pause';
    if (this.o.odin.demo) return 'démonstration';
    if (c.voice?.privacy?.privateMode === true) return 'mode privé';
    // « stop » : plus aucune initiative jusqu'à « reprends » — l'entraînement non plus.
    try { if (this.o.odin.muninn?.getKv('initiative-pause') === '1') return 'en pause après « stop » (jusqu\'à « reprends »)'; } catch { /* mémoire indisponible : rien */ }
    return undefined;
  }

  /** Arrête la séance en cours (si elle tourne). */
  interrompre(raison: string): void {
    if (!this.ac || this.ac.signal.aborted) return;
    this.arretDemandeA = performance.now();
    this.etat.arret = raison; this.etat.interruptions++;
    this.ac.abort();
  }

  /** À chaque passage de la tâche périodique (et à tout moment) : lancer si Odin est libre, arrêter sinon. Ne bloque jamais. */
  tic(o: { occupe?: boolean } = {}): void {
    const puissance = (this.o.odin.cfg.nous as { puissance?: Puissance } | undefined)?.puissance ?? 'pleine';
    this.etat.puissance = puissance; this.etat.fils = filsPour(puissance, this.o.nCpu);
    const interdit = this.permis();
    if (interdit) { this.interrompre(interdit); this.etat.arret = interdit; return; }
    if (o.occupe || reponsesEnCours() > 0) { this.interrompre('Odin répond'); this.etat.arret = 'Odin répond'; return; }
    this.derniereCharge = this.charge();
    if (this.derniereCharge > CHARGE_MAX) { this.interrompre('la machine est occupée par d\'autres programmes'); this.etat.arret = `la machine est occupée par d'autres programmes (${Math.round(this.derniereCharge * 100)} %)`; return; }
    if (this.cycleEnCours) return;
    if (enEssai({ essai: this.o.essai })) { this.etat.arret = 'lanceur d\'essais : aucun entraînement'; return; }
    if (Date.now() < this.pasAvant) return;
    if (!tailleCorpus(this.o.dir ?? dossierCorpus(this.home))) { this.etat.arret = 'corpus vide : Noûs attend d\'avoir lu'; this.pasAvant = Date.now() + PiloteNous.ATTENTE_MS; return; }
    this.cycleEnCours = this.cycle().catch((e) => { this.etat.arret = `panne : ${String((e as Error)?.message ?? e).slice(0, 160)}`; this.pasAvant = Date.now() + PiloteNous.ATTENTE_MS; }).finally(() => { this.cycleEnCours = undefined; this.etat.apprend = false; this.etat.phase = undefined; this.garderEtat(); });
  }

  /** (essais) attendre la fin du cycle en cours. */
  async attendre(): Promise<void> { await this.cycleEnCours; }

  /** Arrêt complet (Odin s'arrête, ou Noûs est coupé). */
  async fermer(delaiMs = 10_000): Promise<void> {
    this.desabonner(); this.interrompre('arrêt');
    // Jamais sans fin : un cycle qui ne rend pas la main (worker figé) n'empêche pas Odin de s'arrêter. Passé le délai,
    // l'entraîneur est arrêté de force (son worker est terminé), ce qui fait aussi échouer le cycle en attente.
    const attendre = (ms: number) => new Promise<void>((ok) => { const t = setTimeout(ok, ms); (t as { unref?: () => void }).unref?.(); });
    if (this.cycleEnCours) await Promise.race([this.cycleEnCours.catch(() => undefined), attendre(delaiMs)]);
    const e = this.e; this.e = undefined;
    try { if (e) await Promise.race([e.arreter(), attendre(Math.min(5000, delaiMs))]); } catch { /* rien */ }
  }

  private libre(): boolean { return !this.permis() && reponsesEnCours() === 0; }

  /** Un cycle : (découpage) → (entraîneur) → (jeux) → apprentissage interrompable → porte de qualité au bout d'une tranche. */
  private async cycle(): Promise<void> {
    const home = this.home;
    // 1. Le découpage : celui du point de reprise s'il existe, sinon celui appris sur le corpus (une fois).
    if (!this.dec) {
      const ck = listerReprises(home).length ? await lireReprise(home) : undefined;
      if (ck) {
        // Un point de reprise garde SON découpage (ses poids en dépendent) ; s'il est d'une ancienne règle, c'est dit.
        this.dec = serialiserDecoupage(ck.decoupage);
        this.etat.decoupageAncien = ck.decoupageAncien ? 'le réseau en service a été appris avec un découpage d\'une ancienne règle : le réentraîner depuis le modèle de départ le corrigerait' : undefined;
      } else {
        // Sans point de reprise : decoupage.json, s'il est lisible ET de la règle d'aujourd'hui ; sinon il est mis de côté
        // (`.abime` ou `.ancien`) et le découpage est réappris (constats 5 et 8).
        const f = this.fichier('decoupage.json');
        const lu = lireDecoupageFichier(f);
        if (lu.dec && decoupageAJour(lu.dec)) this.dec = lu.dec;
        else {
          if (existsSync(f)) { try { renameSync(f, `${f}.${lu.dec ? 'ancien' : 'abime'}`); } catch { /* on réapprend quand même */ } }
          this.etat.decoupageAncien = undefined;
          this.etat.phase = 'apprend son découpage sur le corpus';
          const r = await this.f.decoupage(home, 4096, GRAINE, this.o.dir);
          if (r.textes < 20) { this.etat.arret = `corpus trop petit (${r.textes} textes) : Noûs attend d'avoir lu davantage`; this.pasAvant = Date.now() + PiloteNous.ATTENTE_MS; return; }
          this.dec = r.dec;
          // Écriture atomique : une coupure au milieu ne laisse jamais un fichier tronqué.
          writeFileSync(`${f}.tmp`, JSON.stringify({ vocab: r.dec.vocab, version: r.dec.version, fusions: Array.from(r.dec.fusions) }), { mode: 0o600 });
          renameSync(`${f}.tmp`, f);
        }
      }
    }
    if (!this.libre()) return;
    // 2. L'entraîneur (gardé d'une séance à l'autre : ses poids de travail ne se perdent pas à une interruption).
    if (!this.e) {
      this.etat.phase = 'prépare son réseau';
      const hyper = listerReprises(home).length ? undefined : await this.f.taille();
      this.e = await this.f.entraineur(home, { hyper: hyper as Hyper, dec: this.dec, graine: GRAINE });
    }
    if (!this.libre()) return;
    // Après un oubli : retour au point en service, tranche et jeux jetés (ils peuvent contenir le texte oublié).
    if (this.oubliEnAttente) {
      this.oubliEnAttente = false; this.jeux = undefined; this.etat.tranchesMs = 0;
      if (this.etat.dernierPoint >= 0) await this.e.revenirA(this.etat.dernierPoint); else { await this.e.arreter(); this.e = undefined; return; }
    }
    // 3. Les jeux de la tranche (une part du corpus, tirée à la graine ; le banc, toujours le même).
    if (!this.jeux) {
      this.etat.phase = 'prépare ses exemples';
      this.jeux = await this.f.jeux(home, this.dec, 128, GRAINE + this.etat.pas, this.o.dir);
      if (!this.jeux.entrainement.length || !this.jeux.banc.length) { this.etat.arret = 'pas encore assez d\'exemples (corpus ou banc vide)'; this.jeux = undefined; this.pasAvant = Date.now() + PiloteNous.ATTENTE_MS; return; }
    }
    if (!this.libre()) return;
    // La perte du réseau EN SERVICE sur CE banc : remesurée dès que le banc a changé (la porte compare toujours deux
    // mesures faites sur le MÊME banc). Le banc ne change qu'avec de nouveaux jeux, donc au début d'une tranche (ou
    // après un redémarrage, qui remet la tranche à zéro) : les poids de l'entraîneur sont alors ceux du point en service.
    const sig = signature(this.jeux.banc);
    if (this.etat.perteBanc === undefined || this.etat.bancSig !== sig) {
      this.etat.phase = 'mesure sa perte sur le banc'; this.etat.perteBanc = await this.e.perteSur(this.jeux.banc); this.etat.bancSig = sig;
    }
    // 4. Apprendre, jusqu'à la fin de la tranche ou à la première interruption.
    const tranche = this.o.trancheMs ?? TRANCHE_MS;
    this.ac = new AbortController();
    this.etat.apprend = true; this.etat.arret = undefined; this.etat.phase = 'apprend'; this.etat.depuis = new Date().toISOString();
    if (!this.libre()) this.ac.abort();
    const demande = Math.max(1000, Math.min(this.o.seanceMs ?? tranche, tranche - this.etat.tranchesMs));
    const av = await this.e.seance([{ entrees: this.jeux.entrainement, ...(this.jeux.roles ? { roles: this.jeux.roles as Int32Array[] } : {}) }], { dureeMs: demande, fils: this.etat.fils, signal: this.ac.signal, graine: GRAINE + this.etat.pas });
    if (av.interrompue && this.arretDemandeA) this.etat.dernierArretMs = Math.round(performance.now() - this.arretDemandeA);
    this.arretDemandeA = 0;
    this.etat.apprend = false;
    this.etat.pas += av.pas; this.etat.tempsMs += av.tempsMs; this.etat.tranchesMs += av.tempsMs;
    if (av.sansCible) this.etat.sansCible = (this.etat.sansCible ?? 0) + av.sansCible;
    if (av.pas) this.etat.perte = Math.round(av.perte * 1000) / 1000;
    this.garderEtat();
    if (av.interrompue) return; // reprendra au prochain moment libre, poids de travail gardés
    // La séance s'arrête d'elle-même quand tous les exemples tirés ont été vus (un passage) : c'est aussi la fin de
    // la tranche. Sinon, la tranche continue au prochain passage.
    const epuise = av.tempsMs < demande - 50;
    if (!epuise && this.etat.tranchesMs < tranche) return;
    // 5. La porte de qualité (seulement si Odin est toujours libre).
    if (!this.libre()) return;
    this.etat.phase = 'porte de qualité';
    const avant = this.etat.perteBanc, apres = await this.e.perteSur(this.jeux.banc);
    const quand = new Date().toISOString();
    if (divergence(avant, apres)) {
      if (this.etat.dernierPoint >= 0) await this.e.revenirA(this.etat.dernierPoint);
      else { await this.e.arreter(); this.e = undefined; } // un réseau neuf qui diverge : on repart d'un neuf
      this.etat.derniere = { quand, gardee: false, raison: 'la perte a divergé : retour arrière', perteAvant: avant, perteApres: apres };
    } else if (porteDeQualite(avant, apres)) {
      const n = prochainNumero(home);
      await this.e.ecrire(n);
      this.etat.dernierPoint = n; this.etat.perteBanc = apres;
      this.etat.derniere = { quand, gardee: true, raison: 'mieux sur le banc : mis en service', perteAvant: avant, perteApres: apres, point: n };
      try { this.o.quandNouveauPoint?.(n); } catch { /* rien */ }
    } else {
      if (this.etat.dernierPoint >= 0) await this.e.revenirA(this.etat.dernierPoint);
      this.etat.derniere = { quand, gardee: false, raison: 'pas mieux sur le banc : refusé, retour au point en service', perteAvant: avant, perteApres: apres };
    }
    this.etat.tranchesMs = 0; this.jeux = undefined;
    this.garderEtat();
  }
}

// Le pilote d'un Odin lancé (un seul).
let pilote: PiloteNous | undefined;
/** Le pilote d'Odin (créé au premier appel). */
export function piloteNous(o: OptionsPilote): PiloteNous { return (pilote ??= new PiloteNous(o)); }
/** Le pilote s'il existe (pour la page). */
export function piloteExistant(): PiloteNous | undefined { return pilote; }
/** (essais) oublie le pilote. */
export async function oublierPilote(): Promise<void> { await pilote?.fermer(); pilote = undefined; }
