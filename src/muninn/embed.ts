// Recherche par le sens dans la mémoire : un petit modèle LOCAL transforme chaque souvenir en vecteur, pour qu'Odin
// retrouve « mon serveur de fichiers » même si le souvenir parle du « NAS ». Facultatif : sans lui, la recherche par
// mots (avec accents et préfixes) reste active.
//
// Les plongements viennent désormais de Noûs (le cerveau profond d'Odin, src/brain/nous), ou d'un modèle de
// plongements ouvert lu par Métis — plus aucun serveur réglé par adresse. Le câblage se fait dans runtime.ts ; ce
// fichier ne garde que le contrat commun.

export interface Embedder { model: string; embed(text: string, signal?: AbortSignal): Promise<Float32Array> }
