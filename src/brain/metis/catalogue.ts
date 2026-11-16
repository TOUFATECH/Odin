// Catalogue des modèles ouverts téléchargés — la mémoire de Métis : pour chaque modèle, où est son fichier, sa
// taille, son empreinte SHA-256, sa quantification et la vitesse mesurée. C'est la donnée de la base METIS_ODIN.
//
// Les FICHIERS GGUF eux-mêmes restent HORS base et HORS dépôt : ils sont téléchargés par l'appli de téléchargement
// d'Odin (lien de téléchargement : permis), rangés sur le disque, et seulement RÉFÉRENCÉS ici par leur chemin et leur
// empreinte. Au premier jet, le catalogue est un fichier JSON sous le dossier d'Odin (le même rôle que la base
// METIS_ODIN, comme d'autres applis gardent un schéma prêt avant la migration vers Alexandrie).

import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { empreinteFichier, lireGguf, quantDominante } from './gguf.ts';
import type { MesureModele, ModeleCatalogue, ModeleGguf } from './types.ts';

interface FichierCatalogue { version: number; modeles: ModeleCatalogue[] }

function cheminCatalogue(home: string): string { return join(home, 'metis', 'catalogue.json'); }

/** Lit le catalogue (tolérant : un fichier absent ou abîmé donne un catalogue vide, jamais une erreur). */
async function lire(home: string): Promise<FichierCatalogue> {
  try {
    const brut = await readFile(cheminCatalogue(home), 'utf8');
    const d = JSON.parse(brut) as unknown;
    if (d && typeof d === 'object' && Array.isArray((d as FichierCatalogue).modeles)) {
      const modeles = (d as FichierCatalogue).modeles.filter((m) => m && typeof m.id === 'string' && typeof m.chemin === 'string');
      return { version: 1, modeles };
    }
  } catch { /* absent ou illisible : catalogue vide */ }
  return { version: 1, modeles: [] };
}

/** Écrit le catalogue de façon sûre (fichier temporaire puis renommage : jamais de catalogue à moitié écrit). */
async function ecrire(home: string, cat: FichierCatalogue): Promise<void> {
  const chemin = cheminCatalogue(home);
  await mkdir(join(home, 'metis'), { recursive: true });
  const tmp = `${chemin}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(cat, null, 2), 'utf8');
  await rename(tmp, chemin);
}

/** Tous les modèles connus. */
export async function listerModeles(home: string): Promise<ModeleCatalogue[]> {
  return (await lire(home)).modeles;
}

/** Vérifie l'empreinte SHA-256 d'un fichier contre celle attendue (après téléchargement). */
export async function verifierEmpreinte(chemin: string, attendue: string): Promise<boolean> {
  try {
    const e = await empreinteFichier(chemin);
    return e.toLowerCase() === attendue.toLowerCase();
  } catch { return false; }
}

/**
 * Ouvre un modèle du catalogue par son identifiant. L'empreinte du fichier est revérifiée : un fichier modifié
 * depuis l'enregistrement est refusé (le modèle n'est pas ouvert). Les poids sont ensuite lus à la demande.
 */
export async function ouvrir(id: string, home: string): Promise<ModeleGguf> {
  const cat = await lire(home);
  const fiche = cat.modeles.find((m) => m.id === id);
  if (!fiche) throw new Error(`Métis : modèle « ${id} » absent du catalogue`);
  const modele = await lireGguf(fiche.chemin);
  if (fiche.empreinte && modele.empreinte.toLowerCase() !== fiche.empreinte.toLowerCase()) {
    await modele.fermer();
    throw new Error(`Métis : l'empreinte de « ${id} » ne correspond plus (fichier modifié)`);
  }
  return modele;
}

/** Range (ou met à jour) la mesure réelle d'un modèle (le lot « Moteur » y écrit les morceaux/s mesurés). */
export async function enregistrerMesure(id: string, m: MesureModele, home: string): Promise<void> {
  const cat = await lire(home);
  const fiche = cat.modeles.find((x) => x.id === id);
  if (!fiche) throw new Error(`Métis : modèle « ${id} » absent du catalogue`);
  const maj: ModeleCatalogue = { ...fiche, mesure: m };
  cat.modeles = cat.modeles.map((x) => (x.id === id ? maj : x));
  await ecrire(home, cat);
}

/** Nombre total de paramètres d'un modèle (somme des éléments de tous ses tenseurs). */
function compterParametres(modele: ModeleGguf): number {
  let n = 0;
  for (const t of modele.tenseurs.values()) n += t.dims.reduce((a, b) => a * b, 1);
  return n;
}

/**
 * Enregistre un modèle téléchargé dans le catalogue : lit son GGUF (métadonnées seules), en tire la quantification,
 * le nombre de paramètres et l'empreinte, et l'ajoute (ou le remplace s'il est déjà là, même empreinte). L'appli de
 * téléchargement d'Odin appelle ceci après avoir vérifié l'empreinte du fichier reçu.
 */
export async function enregistrerModele(chemin: string, type: 'chat' | 'embeddings', home: string, idChoisi?: string): Promise<ModeleCatalogue> {
  const modele = await lireGguf(chemin);
  try {
    const nom = basename(chemin).replace(/\.gguf$/i, '');
    const id = idChoisi ?? (nom.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || modele.empreinte.slice(0, 12));
    const fiche: ModeleCatalogue = {
      id,
      nom,
      chemin,
      arch: modele.arch,
      tailleOctets: modele.tailleOctets,
      empreinte: modele.empreinte,
      quant: quantDominante(modele.tenseurs),
      parametres: compterParametres(modele),
      type,
    };
    const cat = await lire(home);
    cat.modeles = [...cat.modeles.filter((m) => m.id !== id), fiche];
    await ecrire(home, cat);
    return fiche;
  } finally {
    await modele.fermer();
  }
}

/** Retire un modèle du catalogue (ne touche pas au fichier GGUF sur le disque). */
export async function retirerModele(id: string, home: string): Promise<boolean> {
  const cat = await lire(home);
  const avant = cat.modeles.length;
  cat.modeles = cat.modeles.filter((m) => m.id !== id);
  if (cat.modeles.length === avant) return false;
  await ecrire(home, cat);
  return true;
}
