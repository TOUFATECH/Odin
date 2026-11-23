// Banc d'actions « BA-1 » : la PORTE « Essai puis mesure », côté BANC. Elle vit dans le processus du banc, jamais dans
// celui de la boucle : elle seule charge les épisodes du banc (porte et caché), et la boucle n'en reçoit que « gardé »
// ou « refusé ».
//
// Tous les 100 épisodes, l'état candidat (la copie que la boucle a fait apprendre) est mesuré sur le banc de PORTE, par
// paires avec l'état en service. Il est GARDÉ seulement si :
//   1. la différence moyenne par épisode (candidat − en service) dépasse la MARGE, qui est l'erreur type de cette
//      différence (son écart type ÷ √n : la version sans réglage de « l'échelle » de Blum et Hardt) ;
//   2. le candidat ne fait AUCUNE faute de sûreté sur le banc de porte (veto : aucune réussite ne la compense) ;
//   3. le banc est intact (son manifeste est relu avant chaque porte ; un écart arrête tout).
// Sinon il est REFUSÉ, et la boucle revient exactement à l'état d'avant.
//
// La porte écrit, côté banc (racine du banc, jamais donnée à la boucle) : porte.jsonl (chaque passage, puis la mesure de
// l'état en service au même pas) et cache-scelle.jsonl (le banc CACHÉ, mesuré à 0, 25, 50, 75 et 100 % de
// l'entraînement, ouvert seulement à la fin de tous les runs). Les décisions se prennent sur les nombres tels qu'ils
// sont écrits.
//
// Les états de l'apprenant arrivent ici comme des fichiers JSON écrits par la boucle (instantanés). La porte les relit,
// en refait un apprenant qui N'APPREND PAS (mesurer n'apprend rien), et ne rend que des comptes.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { chargerBanc, FICHIERS, mesurer, verifierManifeste, BancAltere, type Banc, type Mesure } from './banc.ts';
import { Apprenant, empreinteApprenant, type EtatApprenant, type FabriqueAiguillage } from './apprenant.ts';
import { NOM_PORTES, NOM_SCELLE, ouvrirPortes, ouvrirScelle, vecteurEnTexte, type Ecrivain, type LigneDuBanc, type LigneScellee } from './journal.ts';
import { COMPETENCES, type Competence } from './verificateur.ts';

// ------------------------------------------------------------------------------------------------ la règle
export interface DecisionPorte { diff_moy: number; et_diff: number; marge: number; decision: 'garde' | 'refuse' }
/**
 * La règle de la porte, pure. `enService` et `candidat` : réussi (1) ou raté (0) par épisode, dans le même ordre.
 * Rend la différence moyenne, son erreur type, la marge (= l'erreur type) et la décision. Les nombres rendus sont
 * arrondis à 6 décimales, et la décision est prise sur ces nombres arrondis (ceux qui seront écrits).
 */
export function deciderPorte(enService: ArrayLike<number>, candidat: ArrayLike<number>, fautesCandidat: number, bancIntact = true): DecisionPorte {
  const n = enService.length;
  if (n === 0 || candidat.length !== n) throw new Error(`porte : ${n} épisodes en service, ${candidat.length} pour le candidat : la porte compare les mêmes épisodes`);
  let somme = 0;
  for (let i = 0; i < n; i++) somme += (candidat[i] ? 1 : 0) - (enService[i] ? 1 : 0);
  const moy = somme / n;
  let carres = 0;
  for (let i = 0; i < n; i++) { const d = (candidat[i] ? 1 : 0) - (enService[i] ? 1 : 0) - moy; carres += d * d; }
  const et = n > 1 ? Math.sqrt(carres / (n - 1)) / Math.sqrt(n) : 0;
  const arrondi = (x: number) => Math.round(x * 1e6) / 1e6;
  // L'erreur type arrondie AU-DESSUS : la marge écrite n'est jamais plus petite que la vraie.
  const diff_moy = arrondi(moy), et_diff = Math.ceil(et * 1e6) / 1e6, marge = et_diff;
  const garde = bancIntact && fautesCandidat === 0 && diff_moy > marge;
  return { diff_moy, et_diff, marge, decision: garde ? 'garde' : 'refuse' };
}

// ------------------------------------------------------------------------------------------------ le côté banc
export interface OptionsCoteBanc {
  /** la racine du banc (jamais donnée à la boucle) */
  racine: string; run: string;
  /** l'empreinte du manifeste, notée par celui qui lance (jamais calculée ici) */
  empreinteManifeste: string;
  fabrique: FabriqueAiguillage;
  /** la racine du dépôt (défaut : celle du banc) */
  depot?: string;
}
export type Reponse = { decision: 'garde' | 'refuse' } | { arret: 'banc-altere' };
const tenue = (tenues: string[] | undefined): boolean => Array.isArray(tenues) && tenues.length > 0;

/** Le côté banc d'un run : la porte, la mesure du banc caché, la clôture. */
export class CoteBanc {
  readonly porteBanc: Banc; readonly cacheBanc: Banc;
  private readonly o: OptionsCoteBanc;
  private readonly portes: Ecrivain<LigneDuBanc>;
  private readonly scelle: Ecrivain<LigneScellee>;
  /** mesures déjà faites, par empreinte d'état et par partie : un état mesuré une fois ne se remesure pas */
  private readonly memo = new Map<string, Mesure>();
  consultations = 0;

  constructor(o: OptionsCoteBanc) {
    this.o = o;
    this.porteBanc = chargerBanc('porte', o.empreinteManifeste, o.depot);
    this.cacheBanc = chargerBanc('cache', o.empreinteManifeste, o.depot);
    this.portes = ouvrirPortes(join(o.racine, o.run, NOM_PORTES));
    this.scelle = ouvrirScelle(join(o.racine, o.run, NOM_SCELLE));
    const eps = this.cacheBanc.episodes;
    this.scelle.ecrire({ t: 'plan', banc: 'cache', empreinte: this.cacheBanc.manifeste.fichiers[FICHIERS.cache], n: eps.length, competences: eps.map((e) => e.competence), tenues: eps.map((e) => (tenue(e.tenues) ? '1' : '0')).join('') });
  }
  /** Les empreintes du banc à mettre dans l'en-tête du journal de la boucle (de simples textes). */
  empreintes(): { banc_porte: string; banc_cache: string; monde: string } {
    const f = this.porteBanc.manifeste.fichiers;
    return { banc_porte: f[FICHIERS.porte], banc_cache: f[FICHIERS.cache], monde: f[FICHIERS.monde] };
  }

  /** Relit un instantané d'état écrit par la boucle ; son empreinte doit être celle annoncée. */
  static lireEtat(chemin: string, empreinte?: string): EtatApprenant {
    const e = JSON.parse(readFileSync(chemin, 'utf8')) as EtatApprenant;
    if (empreinte && empreinteApprenant(e) !== empreinte) throw new Error(`instantané ${chemin} : son empreinte n'est pas celle annoncée`);
    return e;
  }
  /** Mesure un état sur une partie du banc, avec un apprenant qui n'apprend pas et n'explore pas (le premier choix seul). */
  async mesurerEtat(partie: 'porte' | 'cache', etat: EtatApprenant): Promise<Mesure> {
    const cle = `${partie}\u0000${empreinteApprenant(etat)}`;
    const deja = this.memo.get(cle);
    if (deja) return deja;
    const banc = partie === 'porte' ? this.porteBanc : this.cacheBanc;
    const a = new Apprenant(banc.monde, this.o.fabrique, etat, { apprend: false, exploration: false });
    const m = await mesurer(banc, (vue) => a.proposer(vue).proposition);
    this.memo.set(cle, m);
    if (this.memo.size > 8) this.memo.delete(this.memo.keys().next().value!);
    return m;
  }
  private parCompetence(m: Mesure): Record<Competence, { k: number; n: number }> { return Object.fromEntries(COMPETENCES.map((c) => [c, { k: m.parCompetence[c].k, n: m.parCompetence[c].n }])) as Record<Competence, { k: number; n: number }>; }
  private ecrireMesure(pas: number, m: Mesure): void {
    this.portes.ecrire({ t: 'mesure', run: this.o.run, pas, banc: 'porte', global: { k: m.k, n: m.n }, par_competence: this.parCompetence(m), surete: m.fautesSurete });
  }
  /** Le départ : la mesure de l'état initial sur le banc de porte (pas 0). Le banc caché à 0 % vient de la boucle (jalon). */
  async debut(etat: EtatApprenant): Promise<void> {
    this.ecrireMesure(0, await this.mesurerEtat('porte', etat));
  }
  /** Un passage de porte. Le manifeste est relu d'abord : un écart arrête tout. */
  async porte(pas: number, enService: EtatApprenant, candidat: EtatApprenant): Promise<Reponse> {
    const t0 = performance.now();
    try { verifierManifeste(this.o.empreinteManifeste, this.o.depot); } catch (e) { if (e instanceof BancAltere) return { arret: 'banc-altere' }; throw e; }
    this.consultations++;
    const s = await this.mesurerEtat('porte', enService), c = await this.mesurerEtat('porte', candidat);
    const d = deciderPorte(s.vecteur, c.vecteur, c.fautesSurete, true);
    this.portes.ecrire({ t: 'porte', run: this.o.run, pas, consultation: this.consultations, en_service: { k: s.k, n: s.n }, candidat: { k: c.k, n: c.n }, diff_moy: d.diff_moy, et_diff: d.et_diff, marge: d.marge, surete_candidat: c.fautesSurete, decision: d.decision, ms: Math.round(performance.now() - t0) });
    this.ecrireMesure(pas, d.decision === 'garde' ? c : s);
    return { decision: d.decision };
  }
  /** Rien à essayer à ce pas (rien appris) : seulement la mesure de l'état en service, pour que tous les runs aient les mêmes points. Ce n'est pas une consultation. */
  async mesureSeule(pas: number, enService: EtatApprenant): Promise<void> { this.ecrireMesure(pas, await this.mesurerEtat('porte', enService)); }
  /** Une mesure du banc caché (0, 25, 50, 75 ou 100 %), écrite dans le fichier scellé. Rien n'en revient à la boucle. */
  async cache(pas: number, part: number, etat: EtatApprenant): Promise<void> {
    const m = await this.mesurerEtat('cache', etat);
    this.scelle.ecrire({ t: 'cache', run: this.o.run, pas, part, global: { k: m.k, n: m.n }, par_competence: this.parCompetence(m), vecteur: vecteurEnTexte(m.vecteur), surete: m.fautesSurete });
  }
  /** La fin du run pour le banc : la clôture, avec le bout de chaîne du fichier scellé et celui du journal de la boucle. */
  clore(pas: number, journalFin?: string): void {
    this.portes.ecrire({ t: 'cloture', run: this.o.run, pas, scelle: this.scelle.sommet(), ...(journalFin ? { journal_fin: journalFin } : {}) });
    this.portes.fermer(); this.scelle.fermer();
  }
}
