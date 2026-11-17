// Mathésis — petites aides pures partagées (repli de texte, mots utiles, empreinte, identifiants).
import { createHash, randomBytes } from 'node:crypto';

/** Minuscules, sans accents, espaces simples. */
export const plier = (t: string): string => String(t ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();

const VIDES = new Set(('le la les un une des de du d l et ou en au aux a ce ces cet cette est sont pour par sur dans avec sans qui que quoi quel quelle quels quelles ' +
  'comment pourquoi combien ne pas plus se sa son ses leur leurs il elle ils elles on nous vous je tu y the of and to in is are for on with what how why').split(' '));

/** Les mots porteurs de sens d'un texte (repliés, sans mots vides, 2 lettres au moins). */
export function motsUtiles(t: string): string[] {
  return [...new Set(plier(t).replace(/[^a-z0-9 ]+/g, ' ').split(' ').filter((m) => m.length >= 2 && !VIDES.has(m)))];
}

/** Empreinte d'un contenu : sha256 du texte replié (une simple mise en forme ne la change pas). */
export const empreinteContenu = (t: string): string => createHash('sha256').update(plier(t)).digest('hex');

/** Un identifiant court. */
export const nouvelId = (): string => `${Date.now().toString(36)}${randomBytes(3).toString('hex')}`;

/** Une date AAAA-MM-JJ (UTC) d'un instant. */
export const dateCourte = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

/** Coupe un texte pour l'affichage. */
export const court = (t: string, n = 200): string => { const s = String(t ?? '').replace(/\s+/g, ' ').trim(); return s.length > n ? `${s.slice(0, n - 1)}…` : s; };
