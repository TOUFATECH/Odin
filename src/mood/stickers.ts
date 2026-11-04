// Autocollants Telegram du visage d'Odin (un WEBP par humeur, rendus par tools/render-moods.cjs).
import { existsSync, readFileSync } from 'node:fs';
import { MOODS, type Mood } from './mood.ts';

export { MOODS };
const cache = new Map<string, Uint8Array | null>();
export function moodSticker(mood: Mood | string): Uint8Array | undefined {
  if (!(mood in MOODS)) return undefined;
  if (!cache.has(mood)) {
    const f = new URL(`./stickers/${mood}.webp`, import.meta.url);
    cache.set(mood, existsSync(f) ? new Uint8Array(readFileSync(f)) : null);
  }
  return cache.get(mood) ?? undefined;
}
