// Autocollants Telegram du visage d'Odin (un WEBP par humeur d'origine, rendus par tools/render-moods.cjs).
// Une humeur de la palette qui n'a pas encore son image prend celle de son socle (une rage : l'autocollant de la colère).
import { existsSync, readFileSync } from 'node:fs';
import { MOODS, isMood, socle, type Mood } from './mood.ts';

export { MOODS };
const cache = new Map<string, Uint8Array | null>();
/** L'image d'une humeur, exactement (sans repli). */
function image(mood: string): Uint8Array | undefined {
  if (!cache.has(mood)) {
    const f = new URL(`./stickers/${mood}.webp`, import.meta.url);
    cache.set(mood, existsSync(f) ? new Uint8Array(readFileSync(f)) : null);
  }
  return cache.get(mood) ?? undefined;
}
/** Le nom de l'autocollant vraiment pris pour cette humeur : le sien, sinon celui de son socle ; rien s'il n'y en a aucun. */
export function cleAutocollant(mood: Mood | string): string | undefined {
  if (!isMood(mood)) return undefined;
  return image(mood) ? mood : image(socle(mood)) ? socle(mood) : undefined;
}
export function moodSticker(mood: Mood | string): Uint8Array | undefined {
  const cle = cleAutocollant(mood);
  return cle ? image(cle) : undefined;
}
