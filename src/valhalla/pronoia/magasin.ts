// Prónoia — le magasin : tout ce que Prónoia garde, BORNÉ, chiffré au repos, purgé après la durée de garde, effaçable
// d'un coup. La source de vérité est un fichier chiffré d'un bloc (clé de la machine, `ecrireFichierPrive`) ; quand la
// base PRONOIA_ODIN est prête, chaque écriture y est aussi reportée (contenus chiffrés, voir base.ts).
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { champChiffre, chiffrerChamp, dechiffrerChamp } from '../../vault.ts';
import type { Miroir } from './base.ts';
import { REGLAGES_DEFAUT, type Demande, type EvenementDate, type Prevision, type Reglages } from './types.ts';

/** Les bornes : la mémoire ne grandit jamais au-delà. */
export const BORNES = { demandes: 2000, evenements: 5000, previsions: 2000, prevenus: 500 } as const;
const JOUR = 86_400_000;

/** Les mesures du temps gagné (lot 2), gardées pour le bilan. */
export interface MesuresPreparation { servies: number; manquees: number; perdues: number; gagneMs: number; refusees: number }

export interface Etat {
  v: 1;
  reglages: Reglages;
  demandes: Demande[];
  evenements: EvenementDate[];
  previsions: Prevision[];
  /** anti-répétition : clé → dernier moment où on a proposé de prévenir */
  prevenus: Record<string, number>;
  mesures: MesuresPreparation;
  /** effacement / purge faits quand la base n'était pas prête : à rejouer dans la base dès qu'elle l'est */
  enAttenteBase?: { effacer?: boolean; purge?: number };
}
const vide = (): Etat => ({ v: 1, reglages: { ...REGLAGES_DEFAUT }, demandes: [], evenements: [], previsions: [], prevenus: {}, mesures: { servies: 0, manquees: 0, perdues: 0, gagneMs: 0, refusees: 0 } });

export const nouvelId = (): string => randomBytes(8).toString('hex');

/** Lit un état : SEULEMENT un contenu chiffré par la clé de la machine (un fichier posé en clair est refusé). */
function lireEtat(home: string, f: string): Etat | undefined {
  try {
    const t = readFileSync(f, 'utf8');
    if (!champChiffre(t)) return undefined;
    const lu = JSON.parse(dechiffrerChamp(home, t)) as Etat;
    if (!lu || lu.v !== 1) return undefined;
    return { ...vide(), ...lu, reglages: { ...REGLAGES_DEFAUT, ...lu.reglages }, mesures: { ...vide().mesures, ...lu.mesures } };
  } catch { return undefined; }
}

export class Magasin {
  readonly fichier: string;
  readonly home: string;
  etat: Etat;
  private miroir?: Miroir;
  /** le fichier était illisible au démarrage : la phrase à montrer (il a été mis de côté, pas écrasé) */
  readonly illisible?: string;
  constructor(home: string, dir: string) {
    this.home = home;
    mkdirSync(dir, { recursive: true });
    this.fichier = join(dir, 'pronoia.json');
    const existe = existsSync(this.fichier);
    const lu = existe ? lireEtat(home, this.fichier) : undefined;
    if (lu) this.etat = lu;
    else {
      this.etat = vide();
      if (existe) {
        // Illisible (abîmé, clé perdue, ou posé EN CLAIR) : on ne l'écrase pas en silence, on le met de côté, on reprend
        // la copie de secours (la dernière version lisible : une coupure du propriétaire y survit) ; sans elle, Prónoia
        // repart de zéro COUPÉE par prudence. Dans les deux cas, on le dit (bilan, alerte du module).
        const cote = `${this.fichier}.illisible-${new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14)}`;
        try { renameSync(this.fichier, cote); } catch { /* best effort */ }
        const secours = existsSync(this.secours) ? lireEtat(home, this.secours) : undefined;
        if (secours) this.etat = secours;
        // Toujours COUPÉE par prudence : la copie de secours peut dater d'avant une coupure du propriétaire.
        this.etat.reglages.actif = false;
        this.illisible = secours
          ? `Le fichier de Prónoia était illisible (abîmé ou non chiffré) : mis de côté (${basename(cote)}) ; Prónoia a repris sa copie de secours et reste coupée par prudence (rallume-la si tout va bien).`
          : `Le fichier de Prónoia était illisible (abîmé ou non chiffré) : mis de côté (${basename(cote)}) ; Prónoia repart de zéro, coupée par prudence (rallume-la si tout va bien).`;
      }
    }
  }
  /** La copie de secours : la version précédente, lisible, du fichier. */
  get secours(): string { return `${this.fichier}.secours`; }

  /** La base est prête : les écritures y sont désormais reportées, et un effacement ou une purge en attente y est rejoué. */
  brancherMiroir(m: Miroir): void {
    this.miroir = m;
    const a = this.etat.enAttenteBase;
    if (!a) return;
    if (a.effacer) this.reporter(() => [['effacer_previsions'], ['effacer_demandes'], ['effacer_evenements']]);
    if (typeof a.purge === 'number') { const l = a.purge; this.reporter(() => [['purge_previsions', l], ['purge_demandes', l], ['purge_evenements', l]]); }
    this.etat.enAttenteBase = undefined;
    this.sauver();
  }

  private chiffre(o: unknown): string { return chiffrerChamp(this.home, JSON.stringify(o)); }
  private reporter(f: () => Array<[string, ...Array<string | number | null>]>): void {
    if (!this.miroir) return;
    try { this.miroir.ecrire(...f()); } catch { /* la base ne gêne jamais Prónoia : le fichier fait foi */ }
  }

  /** Écrit le fichier chiffré (bornes appliquées avant). */
  sauver(): void {
    const e = this.etat;
    if (e.demandes.length > BORNES.demandes) e.demandes = e.demandes.slice(-BORNES.demandes);
    if (e.evenements.length > BORNES.evenements) e.evenements = e.evenements.slice(-BORNES.evenements);
    if (e.previsions.length > BORNES.previsions) e.previsions = e.previsions.slice(-BORNES.previsions);
    const cles = Object.keys(e.prevenus);
    if (cles.length > BORNES.prevenus) for (const k of cles.sort((a, b) => e.prevenus[a] - e.prevenus[b]).slice(0, cles.length - BORNES.prevenus)) delete e.prevenus[k];
    // Écriture atomique : un fichier temporaire, puis renommage (une coupure laisse l'ancien fichier intact).
    if (this.minuterie) { clearTimeout(this.minuterie); this.minuterie = undefined; }
    const tmp = `${this.fichier}.tmp`;
    writeFileSync(tmp, chiffrerChamp(this.home, JSON.stringify(e)), { mode: 0o600 });
    // La version précédente (écrite par nous, relue au démarrage) devient la copie de secours.
    try { if (existsSync(this.fichier)) renameSync(this.fichier, this.secours); } catch { /* best effort */ }
    renameSync(tmp, this.fichier);
  }

  private minuterie?: ReturnType<typeof setTimeout>;
  /** Sauvegarde DIFFÉRÉE (une seule écriture pour une rafale) : jamais dans le fil d'une réponse d'Odin. */
  planifierSauvegarde(ms = 1500): void {
    if (this.minuterie) return;
    this.minuterie = setTimeout(() => { this.minuterie = undefined; try { this.sauver(); } catch { /* disque : réessayé à la prochaine écriture */ } }, ms);
    this.minuterie.unref?.();
  }

  ajouterDemande(d: Demande): void {
    this.etat.demandes.push(d);
    this.reporter(() => [['demande_pose', nouvelId(), d.at, this.chiffre(d.texte)]]);
  }
  ajouterEvenement(ev: EvenementDate): void {
    this.etat.evenements.push(ev);
    this.reporter(() => [['evenement_pose', nouvelId(), ev.at, ev.appli, this.chiffre(ev)]]);
  }
  /** Pose ou met à jour une prévision. */
  poserPrevision(p: Prevision): void {
    const i = this.etat.previsions.findIndex((x) => x.id === p.id);
    if (i >= 0) this.etat.previsions[i] = p; else this.etat.previsions.push(p);
    this.reporter(() => [['prevision_pose', p.id, p.sorte, this.chiffre({ quoi: p.quoi, cle: p.cle, sources: p.sources, des: p.des, verifiable: p.verifiable }), p.echeance, p.confiance, p.etat, p.cree, p.resolue ?? null, p.ecartMin ?? null]]);
  }

  /** Retire tout ce qui est plus vieux que la durée de garde. Rend le nombre d'éléments retirés. */
  purger(maintenant: number): number {
    const limite = maintenant - this.etat.reglages.gardeJours * JOUR;
    const e = this.etat, avant = e.demandes.length + e.evenements.length + e.previsions.length;
    e.demandes = e.demandes.filter((d) => d.at >= limite);
    e.evenements = e.evenements.filter((x) => x.at >= limite);
    e.previsions = e.previsions.filter((p) => p.cree >= limite);
    for (const k of Object.keys(e.prevenus)) if (e.prevenus[k] < limite) delete e.prevenus[k];
    const retire = avant - (e.demandes.length + e.evenements.length + e.previsions.length);
    if (this.miroir) this.reporter(() => [['purge_previsions', limite], ['purge_demandes', limite], ['purge_evenements', limite]]);
    else e.enAttenteBase = { ...e.enAttenteBase, purge: Math.max(limite, e.enAttenteBase?.purge ?? 0) }; // rejouée au branchement
    return retire;
  }

  /** Efface TOUT ce que Prónoia a appris et prévu (les réglages restent). Le fichier est d'abord écrasé. */
  effacerTout(): void {
    const reglages = this.etat.reglages;
    // Sans base branchée, l'effacement est noté pour être rejoué dans la base dès qu'elle sera prête.
    this.etat = { ...vide(), reglages, ...(this.miroir ? {} : { enAttenteBase: { effacer: true } }) };
    // Le fichier, sa copie de secours et les fichiers illisibles mis de côté : tous écrasés puis retirés.
    const dir = dirname(this.fichier), nom = basename(this.fichier);
    let tous: string[] = [];
    try { tous = readdirSync(dir).filter((x) => x === nom || x.startsWith(`${nom}.`)).map((x) => join(dir, x)); } catch { /* dossier absent */ }
    for (const f of tous) { try { writeFileSync(f, Buffer.alloc(statSync(f).size)); rmSync(f, { force: true }); } catch { /* best effort */ } }
    if (this.miroir) this.reporter(() => [['effacer_previsions'], ['effacer_demandes'], ['effacer_evenements']]);
    this.sauver();
  }
}
