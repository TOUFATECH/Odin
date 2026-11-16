// L'ENTRÉE UNIQUE d'apprentissage d'Odin (point 1 de la demande du propriétaire). UNE seule porte, pas un
// mécanisme par appli : chaque RECHERCHE, chaque ÉCHANGE (texte, audio transcrit, fichier analysé) et chaque
// ACTION d'appli passe par ici. Pour chacun, Odin :
//   1. juge le fait (confiance.ts) : « à vérifier » / « confirmé » / « contesté » / « donné par toi » ;
//   2. le range dans la mémoire (muninn) avec son niveau, sa source et sa date — l'origine en découle, jamais
//      au-dessus de « owner » (une correction du propriétaire prime et n'est JAMAIS écrasée par une recherche) ;
//   3. renforce/crée les liens du Cerveau entre les sujets appris (crochet facultatif) ;
//   4. nourrit Noûs TEL QUEL (src/brain/nous/entree.ts) : muet en privé/essai/observe=false/démo (son contrat) ;
//      ce qui vient d'Internet n'est « fiable » pour Noûs que lorsqu'il est « confirmé » (sinon : apprendre la langue).
// Idempotente par EMPREINTE (source + contenu) : la même chose apprise deux fois n'est pas ré-absorbée.
//
// Ce module ne lève jamais : une panne d'apprentissage n'arrête jamais Odin (comme nourrir()).

import { nourrir } from '../brain/nous/entree.ts';
import type { NoosDeps, Sorte } from '../brain/nous/deps.ts';
import type { Origin } from '../muninn/store.ts';
import { empreinteDe } from './empreinte.ts';
import { juger, type Jugement, type Niveau, type VerdictBrut } from './confiance.ts';
import { nettoyerPourMemoire } from './nettoyer.ts';

/** La part de muninn dont l'entrée commune a besoin (Mnemosyne la satisfait structurellement). */
export interface MemoireApprentissage {
  remember(content: string, origin: Origin, kind?: string, tags?: string, meta?: { subject?: string; topic?: string; source?: string }): { id: number; updated: boolean; replaced?: string };
  getKv(key: string): string | undefined;
  setKv(key: string, value: string): void;
  readonly privateMode?: boolean;
}

/** Un fait à apprendre : son texte, de quoi/qui il parle (sujet), ce qu'il en dit (clé), et le verdict de la
 *  recherche vérifiée pour CE fait (s'il y en a un). */
export interface Fait {
  texte: string;
  sujet?: string;
  cle?: string;
  verdict?: VerdictBrut;
}

/** Un apport à apprendre (une recherche, un échange, une action d'appli, un fichier, un audio transcrit). */
export interface Apport {
  sorte: Sorte;
  /** D'où vient l'apport (« web:example.fr », « conversation:… », « fichier:rapport.pdf », « appli:venus »…). */
  source: string;
  /** Quand l'apport a été obtenu (fraîcheur). Horodatage ou texte court. */
  date?: number | string;
  faits?: Fait[];
  /** Vrai quand l'apport vient du propriétaire : il prime (« donné par toi »). Une 'correction' l'est toujours. */
  proprietaire?: boolean;
  /** Ne rien ranger (mode privé ponctuel). */
  prive?: boolean;
  /** Pour nourrir Noûs : l'échange brut (demande → réponse), le texte lu, le nom du maître, etc. */
  demande?: string;
  reponse?: string;
  texte?: string;
  maitre?: string;
  /** Horloge injectable (essais). */
  maintenant?: number;
}

/** Le câblage de l'entrée commune. */
export interface DepsApprentissage {
  memoire: MemoireApprentissage;
  nous: NoosDeps;
  /** Renfort/création de liens du Cerveau entre les sujets appris ensemble (facultatif, câblé au démarrage). */
  relier?: (sujets: string[], now: number) => void;
  /** Horloge injectable. */
  maintenant?: () => number;
}

/** Ce que l'apprentissage a fait, pour le journal et les essais. */
export interface ResultatApprentissage {
  /** Faits nouvellement rangés. */
  retenus: number;
  /** Faits déjà connus (même empreinte) non ré-absorbés. */
  ignores: number;
  /** Faits écartés (sans intérêt). */
  rejetes: number;
  /** Identifiants des souvenirs touchés. */
  souvenirs: number[];
  /** Niveau de confiance de chaque fait retenu. */
  niveaux: Niveau[];
}

const VU = 'appris:vu:';
/** Sorte d'apport → sorte de souvenir (« lesson » pour une correction, « note » pour une note). */
const KIND_DE: Record<Sorte, string> = { lecture: 'fact', echange: 'fact', maitre: 'fact', correction: 'lesson', note: 'note' };

/** Rang d'un niveau, pour décider d'une MONTÉE de confiance à la revérification (plus haut = plus sûr). */
const RANG: Record<Niveau, number> = { 'à vérifier': 1, 'contesté': 1, 'confirmé': 2, 'donné par toi': 3 };

/** Niveau de confiance → origine muninn (jamais au-dessus de « owner »). */
function origineDe(niveau: Niveau): Origin {
  if (niveau === 'donné par toi') return 'owner';
  if (niveau === 'confirmé') return 'agent';
  return 'untrusted'; // « à vérifier » et « contesté » restent en quarantaine (hors du rappel courant)
}

function dateCourte(d: number | string | undefined, now: number): string {
  if (d == null) return new Date(now).toISOString().slice(0, 10);
  if (typeof d === 'number') return new Date(d).toISOString().slice(0, 10);
  return d.slice(0, 40);
}

/**
 * Apprend d'un apport. Ne lève jamais. Rend un petit bilan. En privé, ne range rien et ne nourrit pas Noûs.
 */
export function apprendreDeTout(deps: DepsApprentissage, apport: Apport): ResultatApprentissage {
  const res: ResultatApprentissage = { retenus: 0, ignores: 0, rejetes: 0, souvenirs: [], niveaux: [] };
  try {
    if (!deps || !apport || typeof apport !== 'object') return res;
    const now = apport.maintenant ?? deps.maintenant?.() ?? Date.now();
    // Vie privée : rien n'est rangé, et Noûs n'est pas nourri (son contrat le tairait de toute façon).
    if (apport.prive === true || deps.memoire.privateMode === true) return res;

    // Le propriétaire prime : une 'correction' (ou un apport marqué propriétaire) devient « donné par toi ».
    const proprio = apport.proprietaire === true || apport.sorte === 'correction';
    const dateTxt = dateCourte(apport.date, now);

    // Faits réellement gardés (texte nettoyé + niveau), pour nourrir Noûs PAR NIVEAU ensuite.
    const gardes: Array<{ texte: string; niveau: Niveau }> = [];
    for (const fait of apport.faits ?? []) {
      const texte = String(fait?.texte ?? '').trim();
      if (!texte) continue;
      const emp = empreinteDe(apport.source, texte);
      const jug: Jugement = juger({ texte, verdict: fait.verdict, proprietaire: proprio });
      // Déjà vu (même source, même contenu) : on ne reprend QUE si la confiance MONTE (ex. « à vérifier » →
      // « confirmé » quand des sources indépendantes concordent) ou si le fait est PÉRIMÉ (à revérifier). La
      // trace retient la date ET le niveau pour permettre cette ré-évaluation sans ré-absorber l'identique.
      const vu = deps.memoire.getKv(VU + emp);
      if (vu) {
        const barre = vu.indexOf('|');
        const at = Number(barre >= 0 ? vu.slice(0, barre) : vu);
        const ancien = (barre >= 0 ? vu.slice(barre + 1) : '') as Niveau;
        const perime = Number.isFinite(at) && now - at > jug.fraicheurMs;
        const monte = RANG[jug.niveau] > (RANG[ancien] ?? 0);
        if (!monte && !perime) { res.ignores++; continue; }
      }
      deps.memoire.setKv(VU + emp, `${now}|${jug.niveau}`);
      if (!jug.garder) { res.rejetes++; continue; }
      // Vie privée : jamais de secret ni de donnée sensible en clair dans muninn (clair sur le disque). On
      // masque comme Noûs (Heimdall + « à la française ») ; si un secret subsiste, on ne range pas ce fait.
      const net = nettoyerPourMemoire(texte);
      if (!net.sur) { res.rejetes++; continue; }
      const origin = origineDe(jug.niveau);
      const tags = `confiance:${jug.niveau}`;
      const source = `${apport.source}@${dateTxt}`;
      const r = deps.memoire.remember(net.texte, origin, KIND_DE[apport.sorte] ?? 'fact', tags, { subject: fait.sujet, topic: fait.cle, source });
      if (r.id) res.souvenirs.push(r.id);
      res.retenus++;
      res.niveaux.push(jug.niveau);
      gardes.push({ texte: net.texte, niveau: jug.niveau });
    }

    // Les sujets appris ensemble se relient dans le Cerveau (crochet facultatif, jamais bloquant).
    if (deps.relier && res.retenus > 0) {
      const sujets = [...new Set((apport.faits ?? []).map((f) => String(f?.sujet ?? '').trim()).filter(Boolean))];
      if (sujets.length >= 2) { try { deps.relier(sujets, now); } catch { /* jamais bloquant */ } }
    }

    // Noûs TEL QUEL, PAR NIVEAU (contrat §3 / point 5) : un fait n'est « fiable » que s'il est « confirmé » ou
    // donné par le propriétaire. Tout ce qui vient d'Internet sans être confirmé (y compris mêlé à un fait
    // confirmé dans le même apport) n'entre JAMAIS dans le corpus fiable : il ne sert qu'à apprendre la langue.
    const estFiable = (n: Niveau): boolean => n === 'confirmé' || n === 'donné par toi';
    const txtFiable = gardes.filter((g) => estFiable(g.niveau)).map((g) => g.texte).join('\n');
    const txtLangue = gardes.filter((g) => !estFiable(g.niveau)).map((g) => g.texte).join('\n');
    const base = { sorte: apport.sorte, source: apport.source, maitre: apport.maitre };
    if (apport.demande || apport.reponse) {
      nourrir(deps.nous, { ...base, demande: apport.demande, reponse: apport.reponse, fiable: proprio });
    }
    // Un texte brut lu (page, fichier, audio transcrit) : « fiable » seulement s'il vient du propriétaire.
    if (apport.texte) nourrir(deps.nous, { ...base, texte: apport.texte, fiable: proprio });
    if (txtFiable) nourrir(deps.nous, { ...base, texte: txtFiable, fiable: true });
    if (txtLangue) nourrir(deps.nous, { ...base, texte: txtLangue, fiable: false });
  } catch {
    // NE LÈVE JAMAIS.
  }
  return res;
}
