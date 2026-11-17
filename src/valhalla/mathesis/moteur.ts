// Mathésis — la façade du moteur : tout assemblé, et UN « tour » de travail borné.
// Un tour : la garde (interrupteur, pause, heures, occupé, privé) → les prochains manques (confiés d'abord) →
// recherche autonome de chacun (lot 2, lecture par le robot du lot 3) → revisite des pages dues si le budget le
// permet. La garde est reconsultée avant CHAQUE recherche et CHAQUE demande : dès qu'Odin doit répondre (fonction
// `occupe`), ou sur `abandonner()`, le travail s'arrête aussitôt.
//
// Le démarrage au lancement (Talos / start du module), la page et les réglages à l'écran viendront au passage suivant.
import { apprendreDeTout, type Apport, type DepsApprentissage, type ResultatApprentissage } from '../../learn/apprendre-de-tout.ts';
import { resolveurSysteme } from './adresses.ts';
import { Budget, jourDe } from './budget.ts';
import { Curiosite } from './curiosite.ts';
import { Empreintes } from './empreintes.ts';
import { RegistreInterdits } from './interdits.ts';
import { Journal } from './journal.ts';
import { Lecteur, transportSysteme } from './lecteur.ts';
import { MagasinFichiers, type Magasin } from './magasin.ts';
import { rangerPages, rechercherManque, chercheurOdin, type BilanManque, type DepsRecherche } from './recherche.ts';
import { garde, normaliserReglages, PHRASES_ARRET } from './reglages.ts';
import { Robot } from './robot.ts';
import { poserEtatMathesis, viderManques } from './signaux.ts';
import { LecteurMaison, type BilanMaison, type LireImage } from './maison.ts';
import type { Chercheur, Manque, RaisonArret, Reglages, Resolveur, Temps, Transport } from './types.ts';

const attendreReel = (ms: number, signal?: AbortSignal) => new Promise<void>((ok, ko) => {
  if (ms <= 0) return ok();
  if (signal?.aborted) return ko(new Error('abandon'));
  const t = setTimeout(() => { signal?.removeEventListener('abort', fin); ok(); }, ms);
  const fin = () => { clearTimeout(t); ko(new Error('abandon')); };
  signal?.addEventListener('abort', fin, { once: true });
});

export interface OptionsMathesis {
  /** Le dossier de données (ctx.dir du futur module). */
  dossier: string;
  /** Le dossier d'Odin (pour la clé de la machine du repli chiffré). */
  home: string;
  /** Magasin (défaut : fichiers chiffrés sous `dossier`). */
  magasin?: Magasin;
  transport?: Transport;
  resoudre?: Resolveur;
  temps?: Partial<Temps>;
  /** LE moteur de recherche d'Odin (défaut : webSearch). */
  chercher?: Chercheur;
  /** L'entrée commune d'apprentissage : soit ses dépendances (mémoire + Noûs), soit une fonction. Sans elle, rien n'est rangé. */
  apprentissage?: DepsApprentissage | ((a: Apport) => ResultatApprentissage);
  /** Vrai quand Odin doit répondre (ou que la machine est prise) : le travail s'arrête aussitôt. */
  occupe?: () => boolean;
  /** Mode privé de la mémoire. */
  prive?: () => boolean;
  /** L'œil d'Odin pour les images avec du texte (lot 4), s'il est prêt. */
  lireImage?: () => LireImage | undefined;
}

export interface BilanTour { arret?: RaisonArret; phrase: string; manques: BilanManque[]; revisitees: number; changees: number; maison?: BilanMaison }

export function creerMathesis(o: OptionsMathesis) {
  const temps: Temps = { maintenant: o.temps?.maintenant ?? Date.now, attendre: o.temps?.attendre ?? attendreReel };
  const magasin = o.magasin ?? new MagasinFichiers(o.dossier, o.home);
  const reglages = (): Reglages => normaliserReglages(magasin.lire('reglages', undefined));
  // La boîte aux manques ne garde rien quand Mathésis est coupée ; au rallumage, ce qui aurait pu s'y trouver est jeté.
  const regler = (r: Partial<Reglages>): Reglages => {
    const avant = reglages().actif;
    const n = normaliserReglages({ ...reglages(), ...r }); magasin.ecrire('reglages', n);
    if (avant !== n.actif) viderManques();
    poserEtatMathesis(n.actif);
    return n;
  };
  const interdits = new RegistreInterdits(magasin);
  const budget = new Budget(magasin, () => reglages().budgets, temps.maintenant);
  const journal = new Journal(magasin, temps.maintenant);
  const empreintes = new Empreintes(magasin, temps.maintenant);
  const curiosite = new Curiosite(magasin, temps.maintenant, () => interdits.lire());
  // Un fichier de protection illisible (abîmé, clé perdue, posé en clair) : l'état le PLUS PRUDENT s'applique, jamais
  // le défaut, et le propriétaire est prévenu (le module pose l'alerte).
  const alertes: string[] = [];
  reglages(); interdits.lire(); budget.utilise();
  for (const x of magasin.illisibles?.() ?? []) {
    if (x.collection === 'reglages') {
      regler({ actif: false });
      alertes.push(`Les réglages de Mathésis étaient illisibles${x.secours ? ' (relus de leur copie de secours)' : ''} : Mathésis est COUPÉE par prudence. Vérifie ses réglages, puis rallume-la dans sa page.`);
    } else if (x.collection === 'interdits') {
      if (x.secours) { magasin.ecrire('interdits', interdits.lire()); alertes.push('La liste des interdits de Mathésis était illisible : elle a été reprise de sa copie de secours. Vérifie-la.'); }
      else { regler({ actif: false }); alertes.push('La liste des interdits de Mathésis est illisible et sans copie de secours : Mathésis est COUPÉE (rien ne sort). Refais tes interdits, puis rallume-la.'); }
    } else if (x.collection === 'budget' && !x.secours) {
      magasin.ecrire('budget', { jour: jourDe(temps.maintenant()), utilise: { ...reglages().budgets }, parSite: {} });
      alertes.push('Le compteur du jour de Mathésis était illisible : le budget est considéré comme épuisé jusqu\'à demain.');
    }
  }
  let courant: AbortController | undefined;
  const signalCourant = () => courant?.signal;
  const gardeMaintenant = (): RaisonArret | undefined => garde({ reglages: reglages(), maintenant: temps.maintenant(), occupe: o.occupe, prive: o.prive, signal: signalCourant() });
  poserEtatMathesis(reglages().actif);
  const lecteur = new Lecteur({
    transport: o.transport ?? transportSysteme, resoudre: o.resoudre ?? resolveurSysteme, temps, budget, magasin,
    reglages, interdits: () => interdits.lire(), garde: gardeMaintenant,
    surRefus: (site, raison) => journal.noter(reglages().nePasGarder ? { genre: 'refus', quoi: 'un site mis en pause (nom non gardé)', pourquoi: raison } : { genre: 'refus', quoi: `site mis en pause : ${site}`, pourquoi: raison, source: site }),
  });
  const robot = new Robot({ lecteur, magasin, journal, reglages, interdits: () => interdits.lire(), maintenant: temps.maintenant });
  const apprendre = typeof o.apprentissage === 'function'
    ? o.apprentissage
    : o.apprentissage ? ((a: Apport) => apprendreDeTout(o.apprentissage as DepsApprentissage, a))
      : ((): ResultatApprentissage => ({ retenus: 0, ignores: 0, rejetes: 0, souvenirs: [], niveaux: [] }));
  const maison = new LecteurMaison({ magasin, budget, empreintes, journal, reglages, interdits: () => interdits.lire(), garde: gardeMaintenant, apprendre, maintenant: temps.maintenant, lireImage: o.lireImage });
  const deps: DepsRecherche = {
    chercher: o.chercher ?? chercheurOdin(),
    obtenirPages: async (m, graines, signal) => { const b = await robot.explorer(m, graines, signal); return { pages: b.pages, ...(b.arret ? { arret: b.arret } : {}) }; },
    apprendre, budget, journal, empreintes, curiosite, reglages, interdits: () => interdits.lire(), garde: gardeMaintenant, maintenant: temps.maintenant,
  };

  /** Un tour de travail borné. Ne lève jamais. Un seul tour à la fois. */
  async function tour(t: { manques?: number; revisites?: number; maison?: boolean; signal?: AbortSignal } = {}): Promise<BilanTour> {
    const bilan: BilanTour = { phrase: '', manques: [], revisitees: 0, changees: 0 };
    if (courant) { bilan.arret = 'occupe'; bilan.phrase = 'un tour est déjà en cours'; return bilan; }
    courant = new AbortController();
    const fin = () => courant?.abort();
    t.signal?.addEventListener('abort', fin, { once: true });
    if (t.signal?.aborted) courant.abort();
    try {
      const g = gardeMaintenant();
      if (g) { bilan.arret = g; bilan.phrase = PHRASES_ARRET[g]; return bilan; }
      // Les manques déposés par le reste d'Odin (recherche vérifiée sans réponse sûre, fait à une seule source).
      for (const x of viderManques()) curiosite.signaler(x);
      for (const m of curiosite.prochains(t.manques ?? 3)) {
        const b = await rechercherManque(deps, m, courant.signal);
        bilan.manques.push(b);
        if (b.arret) { bilan.arret = b.arret; break; }
      }
      if (!bilan.arret && (t.revisites ?? 5) > 0) {
        const rv = await robot.revisiter(t.revisites ?? 5, courant.signal);
        bilan.revisitees = rv.inchangees;
        for (const [sujet, pages] of rv.parSujet) {
          bilan.changees += pages.length;
          const m: Manque = { id: `revisite:${sujet}`, sujet, cle: sujet, genre: 'sujet', origine: 'perime', priorite: 0, raison: 'une page déjà lue a changé', confie: false, ajoute: temps.maintenant(), vu: 1, essais: 0, etat: 'en_attente' };
          rangerPages(deps, m, pages);
        }
        if (rv.arret) bilan.arret = rv.arret;
      }
      // Lot 4 : les dossiers OUVERTS par le propriétaire (aucun par défaut), en lecture seule.
      if (!bilan.arret && reglages().dossiers.length && t.maison !== false) {
        bilan.maison = await maison.parcourir(courant.signal);
        if (bilan.maison.arret) bilan.arret = bilan.maison.arret;
      }
      bilan.phrase = bilan.arret ? PHRASES_ARRET[bilan.arret] : `${bilan.manques.length} manque(s) traité(s), ${bilan.changees} page(s) modifiée(s) relue(s)${bilan.maison ? `, ${bilan.maison.lus} fichier(s) des dossiers ouverts lu(s)` : ''}`;
      return bilan;
    } catch (e) {
      bilan.phrase = `panne du tour : ${String((e as Error)?.message ?? e).slice(0, 160)}`;
      return bilan;
    } finally {
      t.signal?.removeEventListener('abort', fin);
      courant = undefined;
    }
  }

  return {
    magasin, lecteur, robot, maison, curiosite, apprendre, journal, budget, empreintes, interdits, reglages, regler, tour,
    /** L'interrupteur unique. */
    allumer: () => regler({ actif: true }),
    eteindre: () => { const r = regler({ actif: false }); courant?.abort(); return r; },
    /** Pause immédiate : le tour en cours s'arrête à la prochaine demande. */
    pause: () => { const r = regler({ pause: true }); courant?.abort(); return r; },
    reprendre: () => regler({ pause: false }),
    /** Abandon immédiat du tour en cours (Odin doit répondre). */
    abandonner: () => { courant?.abort(); },
    enCours: () => courant !== undefined,
    /** Ce que le propriétaire doit savoir (fichier de protection illisible…), posé en alerte par le module. */
    alertes: () => [...alertes],
  };
}
export type Mathesis = ReturnType<typeof creerMathesis>;
