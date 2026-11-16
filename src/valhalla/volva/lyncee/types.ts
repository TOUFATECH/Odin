// Lyncée, le moteur de Pythie : les types partagés par les lecteurs, les adaptateurs et la recherche.
// Chaque moteur interrogé est un petit adaptateur : une requête écrite en dur (seule la question change, encodée)
// et une lecture de la réponse. Les deux sont pures : on les essaie sur des échantillons, sans réseau.

export type Categorie = 'web' | 'actualites' | 'images' | 'videos' | 'savoir';
export const CATEGORIES: Record<Categorie, { label: string }> = {
  web: { label: 'Web' }, actualites: { label: 'Actualités' }, images: { label: 'Images' }, videos: { label: 'Vidéos' }, savoir: { label: 'Savoir' },
};

/** Ce qu'on envoie à un moteur : une adresse écrite en dur, la question encodée, rien d'autre. */
export interface Requete { url: string; method?: 'GET' | 'POST'; body?: string; genre: 'page' | 'api' }
/** Un résultat tel qu'un moteur le donne (texte NON FIABLE : une donnée, jamais un ordre). */
export interface ResultatMoteur { title: string; url: string; snippet: string; thumb?: string; published?: string; /** le site d'origine quand le lien passe par le moteur (Google Actualités) */ site?: string }
/** La lecture d'une réponse : des résultats, ou « bloqué » (contrôle anti-robot, refus, limite de débit). */
export type Lecture = { resultats: ResultatMoteur[]; suivante?: boolean } | { bloque: string; genre: 'blocage' | 'limite' };

export interface Adaptateur {
  id: string;
  etiquette: string;
  /**
   * Plusieurs adaptateurs d'une même famille sont un seul service : santé commune (un refus les met tous en pause) ;
   * dans une même catégorie, le suivant sert de repli en cas de panne seulement.
   */
  famille?: string;
  categories: Categorie[];
  /** Temps minimal entre deux requêtes vers ce moteur (ms). */
  intervalle: number;
  /** false : le moteur ne donne qu'une page de résultats. */
  pagine?: boolean;
  requete(q: string, c: Categorie, page: number): Requete;
  lire(texte: string, statut: number, urlFinale: string, location?: string): Lecture;
}

/** Un seul agent de navigateur, banal, pour les pages de résultats. */
export const UA_PAGE = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
/** Pour les API ouvertes : un nom neutre, sans adresse ni identifiant. */
export const UA_API = 'Odin-recherche/1';

/** Les en-têtes de chaque requête : jamais de cookie, jamais de référent, rien qui identifie la maison. */
export function entetes(genre: 'page' | 'api'): Record<string, string> {
  return genre === 'api'
    ? { 'user-agent': UA_API, accept: 'application/json, application/xml;q=0.9, */*;q=0.5', 'accept-language': 'fr-FR,fr;q=0.9' }
    : { 'user-agent': UA_PAGE, accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8', 'accept-language': 'fr-FR,fr;q=0.9' };
}
