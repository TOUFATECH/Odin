// Argos — les réponses lancées sur un poste du parc (par son compagnon, ou par SSH) : tuer un processus, mettre un
// fichier en quarantaine là-bas, isoler le poste du réseau sauf Odin. Toute réponse est grave (accord du propriétaire),
// réversible quand c'est possible, et journalisée (quelle cible, quelle consigne, qui, quand) sous
// <home>/valhalla/argos/reponses.jsonl. Aucune réponse n'est exécutée ici : ce fichier construit la consigne, dit en
// clair ce qu'elle fait, prépare la consigne qui la défait, et tient le journal. Le compagnon (ou SSH) agit.

import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { dirname, join } from 'node:path';
import { consigneInverse, texteConsigne, verifierConsigne, type ConsigneReponse, type GenreReponse } from '../compagnon/reponse.ts';

/** Une ligne du journal des réponses : la consigne, son texte, qui l'a demandée, et son état. */
export interface LigneReponse { id: string; at: string; poste: string; genre: GenreReponse; texte: string; consigne: ConsigneReponse; par: string; etat: 'lancée' | 'annulée'; annuleId?: string }

const fichier = (home: string) => join(home, 'valhalla', 'argos', 'reponses.jsonl');
const nouvelId = () => randomBytes(6).toString('hex');

/**
 * Construit une consigne de réponse valide (ou lève une erreur en clair). `odin` est l'adresse par laquelle le poste
 * joint Odin, gardée ouverte pendant une isolation. Pur.
 */
export function construireConsigne(genre: GenreReponse, o: { pid?: number; nom?: string; fichier?: string; sha256?: string; odin?: string }, now = Date.now()): ConsigneReponse {
  const c: ConsigneReponse = { id: nouvelId(), genre, at: now, ...(o.pid != null ? { pid: o.pid } : {}), ...(o.nom ? { nom: o.nom } : {}), ...(o.fichier ? { fichier: o.fichier } : {}), ...(o.sha256 ? { sha256: o.sha256 } : {}), ...(o.odin ? { odin: o.odin } : {}) };
  const raison = verifierConsigne(c); if (raison) throw new Error(raison);
  return c;
}
/** La raison « grave » d'une réponse (pour demander l'accord du propriétaire, Heimdall). Pur. */
export function raisonGrave(genre: GenreReponse, poste: string, o: { pid?: number; nom?: string; fichier?: string; odin?: string } = {}): string {
  // L'aperçu de l'isolement ne dépend pas de l'adresse d'Odin (texteConsigne l'ignore) : on ne force donc aucune adresse
  // ici (surtout pas un nom littéral « odin »). L'adresse réelle, et l'exigence d'une IP, sont vérifiées au lancement.
  if (genre === 'isoler') return texteConsigne({ id: 'aperçu', genre: 'isoler', at: 0, ...(o.odin ? { odin: o.odin } : {}) }, poste);
  return texteConsigne(construireConsigne(genre, o), poste);
}

/** Journalise une réponse lancée et rend sa ligne, plus la consigne qui la défait (ou rien si non réversible). */
export function journaliserReponse(home: string, poste: string, consigne: ConsigneReponse, par: string, now = Date.now()): { ligne: LigneReponse; inverse?: ConsigneReponse } {
  const texte = texteConsigne(consigne, poste);
  const ligne: LigneReponse = { id: consigne.id, at: new Date(now).toISOString(), poste, genre: consigne.genre, texte, consigne, par, etat: 'lancée', ...(consigne.annuleId ? { annuleId: consigne.annuleId } : {}) };
  ajouter(home, ligne);
  const inverse = consigneInverse(consigne, nouvelId(), now);
  return { ligne, ...(inverse ? { inverse } : {}) };
}
/** Journalise l'annulation d'une réponse (la consigne inverse a été lancée). */
export function journaliserAnnulation(home: string, poste: string, inverse: ConsigneReponse, par: string, now = Date.now()): LigneReponse {
  const texte = texteConsigne(inverse, poste);
  const ligne: LigneReponse = { id: inverse.id, at: new Date(now).toISOString(), poste, genre: inverse.genre, texte, consigne: inverse, par, etat: 'lancée', ...(inverse.annuleId ? { annuleId: inverse.annuleId } : {}) };
  ajouter(home, ligne); return ligne;
}
function ajouter(home: string, ligne: LigneReponse): void { const f = fichier(home); mkdirSync(dirname(f), { recursive: true, mode: 0o700 }); appendFileSync(f, `${JSON.stringify(ligne)}\n`, { mode: 0o600 }); }

/** Le journal des réponses d'un poste (ou de tous), du plus récent au plus ancien. */
export function journalReponses(home: string, poste?: string): LigneReponse[] {
  if (!existsSync(fichier(home))) return [];
  const out: LigneReponse[] = [];
  for (const l of readFileSync(fichier(home), 'utf8').split('\n')) { if (!l.trim()) continue; try { const x = JSON.parse(l) as LigneReponse; if (!poste || x.poste === poste) out.push(x); } catch { /* ligne illisible */ } }
  return out.reverse();
}
