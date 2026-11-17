// Mathésis — les consignes des robots de chaque site (fichier /robots.txt), lues, gardées en cache et respectées.
// Analyse d'après la norme publique : groupes par nom de robot (le nôtre, sinon « * »), règles Allow/Disallow avec
// « * » et « $ », la règle la plus longue l'emporte, Allow l'emporte à égalité, Crawl-delay retenu. Pur, sauf le cache.
//
// Prudence : un site dont les consignes sont illisibles (erreur serveur, refus, trop de demandes, panne) est traité
// comme « tout interdit » jusqu'à la prochaine lecture ; un site sans consignes (404) est « tout permis ».

/** Le nom de robot, fixe et honnête. */
export const NOM_ROBOT = 'OdinMathesis';
export const AGENT_ROBOT = 'OdinMathesis/1.0 (robot de lecture d\'un assistant personnel auto-heberge ; lecture seule ; respecte robots.txt)';

export interface Regle { permis: boolean; chemin: string }
export interface ReglesSite { tout: 'permis' | 'interdit' | 'regles'; regles: Regle[]; delaiS?: number; /** Plans du site annoncés (lignes « Sitemap: »), 10 au plus. */ plans?: string[] }

/** Bornes d'une règle : au-delà, le fichier est jugé hostile (tout interdit). */
export const REGLE_MAX = 2000, JOKERS_MAX = 50;

export const TOUT_PERMIS: ReglesSite = { tout: 'permis', regles: [] };
export const TOUT_INTERDIT: ReglesSite = { tout: 'interdit', regles: [] };

/** Analyse un fichier de consignes et rend les règles qui s'appliquent à `nom`. Pur. */
export function analyserRobots(texte: string, nom = NOM_ROBOT): ReglesSite {
  interface Groupe { agents: string[]; regles: Regle[]; delaiS?: number }
  const groupes: Groupe[] = [];
  let courant: Groupe | undefined;
  let dernierEtaitAgent = false;
  let hostile = false;
  const plans: string[] = [];
  for (const ligneBrute of String(texte ?? '').slice(0, 512 * 1024).split(/\r?\n|\r/)) {
    const ligne = ligneBrute.replace(/#.*$/, '').trim();
    if (!ligne) continue;
    const i = ligne.indexOf(':');
    if (i < 0) continue;
    const cle = ligne.slice(0, i).trim().toLowerCase();
    const val = ligne.slice(i + 1).trim();
    // « Sitemap: » vaut pour tout le fichier, quel que soit le groupe (et ne rompt pas un groupe).
    if (cle === 'sitemap') { if (/^https?:\/\//i.test(val) && val.length <= 2000 && plans.length < 10) plans.push(val); continue; }
    if (cle === 'user-agent') {
      if (!courant || !dernierEtaitAgent) { courant = { agents: [], regles: [] }; groupes.push(courant); }
      courant.agents.push(val.toLowerCase());
      dernierEtaitAgent = true;
      continue;
    }
    dernierEtaitAgent = false;
    if (!courant) continue;
    if (cle === 'allow' || cle === 'disallow') {
      if (!val) continue; // « Disallow: » vide = rien d'interdit
      // Une règle démesurée (trop longue, trop de jokers) : le fichier est jugé hostile, tout interdit.
      if (val.length > REGLE_MAX || val.split('*').length - 1 > JOKERS_MAX) { hostile = true; continue; }
      courant.regles.push({ permis: cle === 'allow', chemin: val });
    } else if (cle === 'crawl-delay') {
      const d = Number(val);
      if (Number.isFinite(d) && d >= 0) courant.delaiS = d;
    }
  }
  if (hostile) return TOUT_INTERDIT;
  const avecPlans = plans.length ? { plans } : {};
  const n = nom.toLowerCase();
  const nommes = groupes.filter((g) => g.agents.some((a) => a !== '*' && a === n));
  const choisis = nommes.length ? nommes : groupes.filter((g) => g.agents.includes('*'));
  if (!choisis.length) return { ...TOUT_PERMIS, ...avecPlans };
  const regles = choisis.flatMap((g) => g.regles);
  const delais = choisis.map((g) => g.delaiS).filter((d): d is number => d !== undefined);
  return { tout: 'regles', regles, ...(delais.length ? { delaiS: Math.max(...delais) } : {}), ...avecPlans };
}

/** Une règle couvre-t-elle ce chemin ? « * » = n'importe quoi, « $ » final = fin du chemin. Pur. */
export function couvre(motif: string, chemin: string): boolean {
  // Comparaison LINÉAIRE, sans expression régulière construite depuis le site (une règle hostile ne peut rien geler) :
  // le premier morceau est un préfixe, les suivants sont cherchés dans l'ordre (le plus à gauche suffit), et avec « $ »
  // le dernier morceau doit finir le chemin sans chevaucher ce qui précède.
  const fin = motif.endsWith('$');
  const morceaux = (fin ? motif.slice(0, -1) : motif).split('*');
  const premier = morceaux[0];
  if (!chemin.startsWith(premier)) return false;
  if (morceaux.length === 1) return fin ? chemin.length === premier.length : true;
  let pos = premier.length;
  for (let k = 1; k < morceaux.length - 1; k++) {
    const m = morceaux[k];
    if (!m) continue;
    const i = chemin.indexOf(m, pos);
    if (i < 0) return false;
    pos = i + m.length;
  }
  const dernier = morceaux[morceaux.length - 1];
  if (fin) return chemin.length - dernier.length >= pos && chemin.endsWith(dernier);
  return dernier === '' || chemin.indexOf(dernier, pos) >= 0;
}

/** Normalise un chemin pour la comparaison (encodage en pour-cent homogène). */
function normaliser(p: string): string {
  try { return encodeURI(decodeURI(p)); } catch { return p; }
}

/** Le robot a-t-il le droit de demander ce chemin (chemin + requête) ? Pur. */
export function permis(r: ReglesSite, cheminEtRequete: string): boolean {
  if (cheminEtRequete === '/robots.txt') return true;
  if (r.tout === 'permis') return true;
  if (r.tout === 'interdit') return false;
  const c = normaliser(cheminEtRequete || '/');
  let meilleure: Regle | undefined;
  let longueur = -1;
  for (const regle of r.regles) {
    const m = normaliser(regle.chemin);
    if (!couvre(m, c)) continue;
    const l = m.length;
    if (l > longueur || (l === longueur && regle.permis && meilleure && !meilleure.permis)) { meilleure = regle; longueur = l; }
  }
  return meilleure ? meilleure.permis : true;
}

/** Les consignes d'un site après une demande de /robots.txt, selon le statut reçu. Pur. */
export function consignesDeStatut(statut: number, texte: string): { regles: ReglesSite; dureeMs: number } {
  const JOUR = 86_400_000, HEURE = 3_600_000;
  if (statut >= 200 && statut < 300) {
    // Des consignes illisibles (binaires, ou une page HTML servie à la place par erreur) ne valent JAMAIS « tout permis ».
    if (/[\u0000-\u0008\u000e-\u001f]/.test(texte) || /^\s*<(!doctype|html|head|body)\b/i.test(texte)) return { regles: TOUT_INTERDIT, dureeMs: JOUR };
    return { regles: analyserRobots(texte), dureeMs: JOUR };
  }
  if (statut === 401 || statut === 403) return { regles: TOUT_INTERDIT, dureeMs: JOUR };
  if (statut === 429) return { regles: TOUT_INTERDIT, dureeMs: HEURE };
  if (statut >= 400 && statut < 500) return { regles: TOUT_PERMIS, dureeMs: JOUR }; // pas de consignes
  return { regles: TOUT_INTERDIT, dureeMs: HEURE };                                 // panne : prudence
}
