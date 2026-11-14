// Argo · surveiller les nouvelles versions des images (l'idée de What's Up Docker, code maison) : pour chaque image
// utilisée par un conteneur, Odin demande au registre l'empreinte actuelle de son étiquette (« nginx:latest ») et la
// compare à celle de l'image qu'il a sur le disque. Rien n'est téléchargé ni changé : on prévient, et le bouton
// « Mettre à jour » (avec la barre de progression déjà là) fait le reste avec ton accord.
import { parseRef, Registry } from './registry.ts';
import type { Image } from './store.ts';

export interface Version { image: string; conteneurs: string[]; locale: string; distante?: string; nouvelle: boolean; erreur?: string; quand: string }

/** Compare chaque image utilisée à son registre. `figee` : une image désignée par empreinte (@sha256) ne « vieillit » pas. */
export async function verifierVersions(images: Image[], conteneurs: Array<{ nom: string; image: string }>, o: { fetch: typeof fetch; quand: string; max?: number }): Promise<Version[]> {
  const out: Version[] = [], vues = new Set<string>();
  for (const c of conteneurs) {
    if (vues.has(c.image) || out.length >= (o.max ?? 60)) continue; vues.add(c.image);
    const img = images.find((i) => i.names.includes(c.image)) ?? images.find((i) => i.names.some((n) => n.split(':')[0] === c.image.split(':')[0] && (n.split(':')[1] ?? 'latest') === (c.image.split(':')[1] ?? 'latest')));
    const v: Version = { image: c.image, conteneurs: conteneurs.filter((x) => x.image === c.image).map((x) => x.nom), locale: img?.digest ?? '', nouvelle: false, quand: o.quand };
    try {
      const ref = parseRef(c.image);
      if (ref.digest) { v.distante = ref.digest; out.push(v); continue; }
      if (!img) { v.erreur = 'image absente du disque (elle sera récupérée au prochain lancement)'; out.push(v); continue; }
      const m = await new Registry(ref, o.fetch).manifest();
      v.distante = m.digest; v.nouvelle = m.digest !== img.digest;
    } catch (e) { v.erreur = (e as Error).message.slice(0, 200); }
    out.push(v);
  }
  return out;
}
