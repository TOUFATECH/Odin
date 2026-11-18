// Ce que le noyau et le code sensible CHARGENT : les fichiers qu'ils importent, puis ce que ceux-là importent, et ainsi
// de suite. CALCULÉ en suivant les imports relatifs, statiques (`import … from './x.ts'`, `export … from`, `import './x'`)
// ET à la demande (`import('./x.ts')`, par ex. src/tools/self.ts qui charge src/tools/builtin.ts au moment d'une commande),
// ET les fichiers désignés par leur chemin écrit en entier (`new URL('./gardien.ts', import.meta.url)` : un processus ou
// un Worker lancé, l'interface servie) ; jamais une liste écrite à la main, qui changerait au prochain changement du code.
//
// Lecture large, voulue (côté prudent) : un import cité dans un commentaire, ou un `import type` (effacé au lancement),
// compte aussi. Ce qui n'est PAS suivi, dit franchement : un nom calculé (`import(variable)`, `new URL(` + gabarit avec
// `${…}`), un dossier (`new URL('./pages/', …)` : pages d'applis et données lues au démarrage), un chemin assemblé
// autrement (join, readFileSync sur un nom construit) et un paquet (`node:…`, nom nu).
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, posix } from 'node:path';
import { NOYAU_FICHIERS, SENSIBLE_DOSSIERS, SENSIBLE_FICHIERS, fichiersNoyau, estNoyau, estSensible } from '../heimdall/noyau.ts';

const insensible = process.platform === 'win32' || process.platform === 'darwin';
/** Un chemin relatif à la racine, en « / », sans « ./ » ; en minuscules là où le système ne distingue pas la casse. */
export const cleChemin = (rel: string): string => { const r = posix.normalize(rel.replace(/\\/g, '/')).replace(/^\.\//, ''); return insensible ? r.toLowerCase() : r; };

// Statique : tout ce qui sépare « import »/« export » de « from », même sur plusieurs lignes et même avec un commentaire
// qui contient une apostrophe ou un « ; » ; un « from » trouvé plus loin que prévu n'ajoute qu'un fichier gardé de plus.
const STATIQUE = /\b(?:import|export)\s[\s\S]*?\bfrom\s*(['"])([^'"\n]+)\1/g;
const NU = /\bimport\s*(['"])([^'"\n]+)\1/g;
const A_LA_DEMANDE = /\bimport\s*\(\s*(['"`])([^'"`\n$]+)\1\s*[,)]/g;
const PAR_SON_CHEMIN = /\bnew\s+URL\s*\(\s*(['"`])([^'"`\n$]+)\1\s*,\s*import\.meta\.url\s*\)/g;

/** Les noms relatifs (« ./ », « ../ ») chargés par un texte de code : statiques, à la demande, par leur chemin. Pur. */
export function importsRelatifs(texte: string): string[] {
  const vus = new Set<string>();
  for (const re of [STATIQUE, NU, A_LA_DEMANDE, PAR_SON_CHEMIN]) for (const m of texte.matchAll(new RegExp(re.source, re.flags))) {
    const nom = m[2].trim().replace(/[?#].*$/, '');
    if ((nom.startsWith('./') || nom.startsWith('../')) && !nom.endsWith('/')) vus.add(nom);
  }
  return [...vus];
}

/** Les candidats pour un nom importé depuis `depuis` (relatifs à la racine), dans l'ordre où Node les essaierait. Pur. */
function candidats(depuis: string, nom: string): string[] {
  const base = posix.normalize(posix.join(posix.dirname(depuis.replace(/\\/g, '/')), nom));
  if (base.startsWith('../') || base === '..') return [];
  return /\.(?:[cm]?[jt]s|json)$/i.test(base) ? [base] : [base, `${base}.ts`, `${base}.js`, `${base}/index.ts`, `${base}/index.js`];
}

/**
 * Tous les fichiers atteints depuis `depart` en suivant les imports relatifs (départ compris). `lire` rend le texte d'un
 * fichier (chemin relatif à la racine) ou undefined s'il n'existe pas. Pur sur ces textes. Rend des clés `cleChemin`.
 */
export function fermeture(depart: Iterable<string>, lire: (rel: string) => string | undefined): Set<string> {
  const atteints = new Set<string>();
  const file: Array<{ rel: string; texte: string }> = [];
  const ajouter = (rel: string, texte: string | undefined): boolean => {
    if (texte === undefined) return false;
    const k = cleChemin(rel);
    if (!atteints.has(k)) { atteints.add(k); file.push({ rel: posix.normalize(rel.replace(/\\/g, '/')), texte }); }
    return true;
  };
  for (const d of depart) ajouter(d, lire(d));
  while (file.length) {
    const { rel, texte } = file.shift()!;
    for (const nom of importsRelatifs(texte)) for (const c of candidats(rel, nom)) if (ajouter(c, atteints.has(cleChemin(c)) ? '' : lire(c))) break;
  }
  return atteints;
}

/** Lecteur sur le disque : le texte d'un fichier de la racine, undefined s'il n'existe pas ou n'est pas un fichier. */
export function lecteurDisque(racine: string): (rel: string) => string | undefined {
  return (rel) => { try { const p = join(racine, rel); return statSync(p).isFile() ? readFileSync(p, 'utf8') : undefined; } catch { return undefined; } };
}

/** Les fichiers de départ : tout le noyau présent et tout le code sensible présent (ses dossiers parcourus). */
export function fichiersDeDepart(racine: string): string[] {
  const out = new Set<string>(fichiersNoyau(racine));
  for (const f of [...NOYAU_FICHIERS, ...SENSIBLE_FICHIERS]) if (existsSync(join(racine, f))) out.add(f);
  const parcourir = (relDir: string): void => {
    let noms: string[] = []; try { noms = readdirSync(join(racine, relDir)); } catch { return; }
    for (const n of noms) { const rel = `${relDir}${n}`; try { if (statSync(join(racine, rel)).isDirectory()) parcourir(`${rel}/`); else out.add(rel); } catch { /* disparu */ } }
  };
  for (const d of SENSIBLE_DOSSIERS) parcourir(d);
  return [...out].sort();
}

export interface FichiersGardes {
  /** Le noyau, le code sensible et tout ce qu'ils chargent (clés `cleChemin`). */
  tous: Set<string>;
  /** Seulement les fichiers chargés qui ne sont ni noyau ni sensibles (clés `cleChemin`, triées). */
  charges: string[];
}

/** Calcule, maintenant, les fichiers qu'un membre ne peut jamais faire réécrire. `lire` remplaçable (essais). */
export function fichiersGardes(racine: string, lire = lecteurDisque(racine)): FichiersGardes {
  const tous = fermeture(fichiersDeDepart(racine), lire);
  return { tous, charges: [...tous].filter((k) => !estNoyau(k) && !estSensible(k)).sort() };
}
