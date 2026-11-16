// Talos — attente d'Internet.
//
// Un nœud qui a besoin d'Internet ne doit pas échouer en boucle quand la connexion est coupée :
// il se met « en attente d'Internet » et se replanifie au retour, au lieu de passer en erreur à
// chaque minute. Ce fichier dit quels nœuds dépendent du réseau et porte la logique d'attente.

import { enLigne, etatInternet, auRetour } from '../net/etat-internet.ts';
import type { EtatReseau } from '../net/etat-internet.ts';
import type { FlowNode, NodeDef } from './engine.ts';

/** Types de nœuds qui parlent à l'extérieur (hors « Répondre au webhook », purement local). */
const TYPES_RESEAU = new Set([
  'web.requête', 'web.flux',
  'odin.mail', 'odin.message',
  'déclencheur.flux', 'déclencheur.surveille',
]);

/** Un nœud a-t-il besoin d'Internet pour s'exécuter ? */
export function besoinInternet(node: FlowNode, catalog: Map<string, NodeDef>): boolean {
  if (TYPES_RESEAU.has(node.type)) return true;
  // Tout nœud du groupe « Web » sauf la réponse de webhook (locale).
  const def = catalog.get(node.type);
  return def?.group === 'Web' && node.type !== 'web.répondre';
}

/** État réseau courant (pour décider d'attendre). */
export function reseauCourant(): EtatReseau { return etatInternet().reseau; }

/**
 * Faut-il mettre ce nœud en attente plutôt qu'en erreur ?
 * Oui si le nœud dépend d'Internet et qu'on n'est pas en ligne.
 */
export function doitAttendre(node: FlowNode, catalog: Map<string, NodeDef>): boolean {
  return !enLigne() && besoinInternet(node, catalog);
}

/** Message clair pour l'affichage dans Talos. */
export function messageAttente(node: FlowNode): string {
  const r = reseauCourant();
  const raison = r === 'sans-reseau' ? 'pas de réseau' : r === 'dns-muet' ? 'DNS en panne' : 'pas de connexion Internet';
  return `« ${node.name} » attend le retour d'Internet (${raison}).`;
}

/**
 * Enregistre une action à rejouer dès qu'Internet revient (une seule fois).
 * Si Internet est déjà là, rejoue tout de suite.
 */
export function replanifierAuRetour(rejouer: () => void): void {
  if (enLigne()) { rejouer(); return; }
  auRetour(rejouer);
}
