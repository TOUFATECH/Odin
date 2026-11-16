// L'ENTRÉE UNIQUE d'apprentissage de Noûs (contrat §3). Tout ce qu'Odin lit et vit passe par ici :
// pages lues, échanges, réponses des maîtres (grands modèles), corrections du propriétaire, notes du Cerveau.
// Le prochain chantier « Odin apprend de tout » appellera nourrir() TEL QUEL (audio transcrit, fichiers…).
//
// Trois règles tenues et vérifiées par des essais :
//  - nourrir() NE BLOQUE jamais : il range dans une file bornée en mémoire et rend la main aussitôt ;
//  - nourrir() NE LÈVE jamais : toute erreur est avalée (une panne d'apprentissage n'arrête jamais Odin) ;
//  - nourrir() ne fait RIEN en mode privé, si l'observation est coupée, en démo, sous l'interrupteur de
//    Noûs, ou en essai (NODE_TEST_CONTEXT) — la vie privée et les essais passent avant.
//
// Le masquage propre à Noûs (mot de passe, e-mail, téléphone, IBAN) est appliqué AVANT la mise en file,
// en plus de Heimdall déjà passé en amont : un secret n'entre jamais dans le corpus.

import { enEssai, masqueDe, type NoosDeps, type Sorte } from './deps.ts';
import { contientSecret } from './masque.ts';
import { Redactor } from '../../heimdall/redact.ts';

// Masqueur technique par défaut : les motifs PUBLICS de Heimdall (sk-ant…, AKIA…, Bearer…, « password: »…),
// sans aucun secret d'environnement. Défense en profondeur : même si l'appelant a oublié Heimdall en amont, un
// secret technique n'entre pas dans le corpus privé. Le runtime peut injecter deps.redacteur = Redactor.fromEnv().
const redacteurTech = new Redactor();
const secretRestant = (t: string): boolean => !!t && (contientSecret(t) || redacteurTech.redact(t) !== t);

/** Ce qu'on donne à apprendre (contrat §3). */
export interface Nourriture {
  sorte: Sorte;
  texte?: string;
  demande?: string;
  reponse?: string;
  source: string;
  fiable: boolean;
  note?: number;
  maitre?: string;
}

/**
 * Range un exemple pour l'apprentissage de Noûs. Ne bloque jamais, ne lève jamais. Respecte vie privée,
 * observation coupée, démo, interrupteur et essais. Le texte est masqué avant d'entrer dans la file.
 */
export function nourrir(deps: NoosDeps, n: Nourriture): void {
  try {
    if (!deps || !n || typeof n !== 'object') return;
    // Garde-fous : on ne range rien dans ces cas.
    if (enEssai(deps)) return;
    if (deps.demo) return;
    if (deps.cfg?.learning?.observe === false) return;
    if (deps.cfg?.nous?.actif === false) return;
    if (safePrivate(deps)) return;

    // Masquage en deux passes AVANT la mise en file : d'abord le technique (Heimdall), puis le « à la française »
    // (mot de passe, e-mail, téléphone, IBAN, carte, NIR). On ne suppose jamais Heimdall déjà passé en amont.
    const masque = masqueDe(deps);
    const redact = deps.redacteur ?? ((t: string) => redacteurTech.redact(t));
    const nettoyer = (t: string): string => masque(redact(t));
    const demande = nettoyer(str(n.demande));
    const reponse = nettoyer(str(n.reponse));
    const texte = nettoyer(str(n.texte)) || joindre(n.sorte, demande, reponse);
    if (!texte && !demande && !reponse) return;
    // Filet : si un secret subsiste malgré le masquage, on n'apprend pas cet exemple (il n'entre pas dans le corpus).
    if (secretRestant(texte) || secretRestant(demande) || secretRestant(reponse)) return;

    const note = typeof n.note === 'number' && Number.isFinite(n.note) ? n.note : undefined;
    deps.file.pousser({
      sorte: n.sorte,
      texte,
      demande,
      reponse,
      source: str(n.source),
      fiable: n.fiable === true,
      note,
      maitre: n.maitre ? str(n.maitre) : undefined,
      at: (deps.maintenant ?? Date.now)(),
    });
  } catch {
    // NE LÈVE JAMAIS.
  }
}

function str(x: unknown): string { return typeof x === 'string' ? x : ''; }

/** privateMode() ne doit jamais faire échouer nourrir : une erreur vaut « privé » (on ne range rien). */
function safePrivate(deps: NoosDeps): boolean {
  try { return deps.privateMode?.() === true; } catch { return true; }
}

/** Rassemble un exemple d'échange en texte simple quand `texte` n'est pas fourni (le masquage reste en amont). */
function joindre(sorte: Sorte, demande: string, reponse: string): string {
  if (!demande && !reponse) return '';
  if (sorte === 'echange' || sorte === 'correction' || sorte === 'maitre') {
    return `${demande}\n${reponse}`.trim();
  }
  return (reponse || demande).trim();
}
