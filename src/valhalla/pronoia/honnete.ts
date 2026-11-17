// Prónoia — l'honnêteté des prévisions. Une prévision est TOUJOURS dite comme une estimation : sa confiance en %, sa
// date, ce sur quoi elle se fonde. Sous le seuil, c'est un « pressentiment », marqué en tête du texte. Aucun mot de
// certitude n'est employé. Et une demande qui AGIT (envoyer, acheter, éteindre, supprimer, payer…) n'est jamais
// préparée d'avance : on peut la proposer en complétion, jamais la lancer.
import type { Prevision, Reglages } from './types.ts';

/** Une confiance bornée à [0, 1] (NaN → 0). */
export const borner = (x: number): number => (Number.isFinite(x) ? Math.max(0, Math.min(1, x)) : 0);
/** En pour cent, arrondi vers le BAS : on n'embellit jamais une confiance. */
export const pourcent = (x: number): number => Math.floor(borner(x) * 100);

export const estPressentiment = (p: Pick<Prevision, 'confiance'>, r: Pick<Reglages, 'seuilPressentiment'>): boolean => borner(p.confiance) < r.seuilPressentiment;

const JOURS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
const hm = (d: Date) => `${d.getHours()}h${String(d.getMinutes()).padStart(2, '0')}`;
/** Une date lisible, relative au moment présent (aujourd'hui / demain / le jour). */
export function quand(ms: number, maintenant: number): string {
  const d = new Date(ms), n = new Date(maintenant);
  const jour = (x: Date) => Math.floor((x.getTime() - x.getTimezoneOffset() * 60_000) / 86_400_000);
  const ecart = jour(d) - jour(n);
  if (ecart === 0) return `aujourd'hui vers ${hm(d)}`;
  if (ecart === 1) return `demain vers ${hm(d)}`;
  if (ecart > 1 && ecart < 7) return `${JOURS[d.getDay()]} vers ${hm(d)}`;
  return `le ${d.toLocaleDateString('fr-FR')} vers ${hm(d)}`;
}

/**
 * Le texte honnête d'une prévision : « Pressentiment (confiance 42 %, peu sûr) : … » ou « Prévision (confiance 85 %) :
 * probablement … », puis l'échéance, la date où elle a été faite et ses sources.
 */
export function formuler(p: Prevision, r: Pick<Reglages, 'seuilPressentiment'>, maintenant: number): string {
  const pc = pourcent(p.confiance);
  const tete = estPressentiment(p, r) ? `Pressentiment (confiance ${pc} %, peu sûr)` : `Prévision (confiance ${pc} %)`;
  const fenetre = p.sorte === 'evenement' ? ` — ${quand(p.des ?? p.echeance, maintenant)}` : '';
  const fonde = p.sources.length ? ` D'après : ${p.sources.map((s) => s.detail).join(' ; ')}.` : '';
  return `${tete} : peut-être ${p.quoi}${fenetre}. Estimation faite ${quand(p.cree, maintenant).replace(/^aujourd'hui /, '')}, à partir de ce qu'Odin a appris chez toi, pas une certitude.${fonde}`;
}

/** Mots de certitude interdits dans un texte de prévision (vérifiés par les essais). */
export const MOTS_CERTITUDE = /\b(certainement|assurément|sans aucun doute|c'est sûr|à coup sûr|forcément|va arriver)\b/i;

const plat = (t: string) => t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
// Les verbes qui AGISSENT (changent quelque chose, envoient, dépensent, effacent, ouvrent). Une demande qui en contient un
// n'est jamais préparée d'avance : préparer = lecture seule.
const AGIT = /\b(envoie|envoyer|envoi|ecris a|ecrire a|reponds|repondre a|appelle|appeler|achete|acheter|commande|commander|paie|payer|paye|vire|virer|transfere|supprime|supprimer|efface|effacer|eteins|eteindre|allume|allumer|ouvre|ouvrir|ferme|fermer|verrouille|deverrouille|demarre|demarrer|arrete|arreter|redemarre|installe|installer|desinstalle|publie|publier|poste|poster|partage|partager|reserve|reserver|annule|annuler|lance|lancer|programme|programmer|regle|regler|change|changer|modifie|modifier|active|activer|desactive|desactiver|declenche|signe|valide|accepte|refuse|mets|met)\b/;
/** Une demande qui agit (et qu'on ne prépare donc jamais d'avance) ? */
export const demandeAgit = (texte: string): boolean => AGIT.test(plat(texte));

/**
 * Les jetons d'une demande, DANS L'ORDRE : chaque mot (de toute longueur : « m », « km », « h », « j » comptent), chaque
 * nombre (« 1 000,5 » = « 1000.5 ») et chaque symbole qui change le sens (€, $, £, ¥, %, °, +, − et le signe d'un nombre).
 * Seules la casse, les accents, les espaces et la ponctuation de phrase (. , ; : ! ? guillemets) sont oubliés.
 */
export function jetonsDe(t: string): string[] {
  const x = plat(t).replace(/(\d)[\s\u00a0\u202f](?=\d{3}\b)/g, '$1').replace(/[\u2019']/g, ' ').replace(/[\u2212\u2013\u2014]/g, '-');
  return [...x.matchAll(/\d+(?:[.,]\d+)?|[a-z0-9]+|[\u20ac$\u00a3\u00a5%\u00b0+-]/g)].map((m) => m[0].replace(/^(\d+),(\d+)$/, '$1.$2'));
}
/**
 * Deux demandes sont-elles ÉQUIVALENTES (même réponse attendue) ? Seulement si leurs jetons sont les MÊMES, dans le
 * MÊME ORDRE (unités, devises, signe, ordre « USD EUR » ≠ « EUR USD » compris). Sert à décider si une réponse préparée
 * peut être servie : dans le doute, non.
 */
export function demandesEquivalentes(a: string, b: string): boolean {
  const ja = jetonsDe(a), jb = jetonsDe(b);
  return ja.length > 0 && ja.length === jb.length && ja.every((x, i) => x === jb[i]);
}
