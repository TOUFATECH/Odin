// Le script du ciel étoilé (ciel.js), servi à part (/ciel.js) ou glissé tel quel dans les pages qui n'ont pas de
// route vers lui (première connexion au téléphone, portail de connexion).
import { readFileSync } from 'node:fs';

export const CIEL_JS: string = (() => { try { return readFileSync(new URL('./ciel.js', import.meta.url), 'utf8'); } catch { return ''; } })();
