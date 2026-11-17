// Mathésis — petites aides pures partagées (repli de texte, mots utiles, empreinte, identifiants).
import { createHash, randomBytes } from 'node:crypto';

/** Minuscules, sans accents, espaces simples. */
export const plier = (t: string): string => String(t ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();

const VIDES = new Set(('le la les un une des de du d l et ou en au aux a ce ces cet cette est sont pour par sur dans avec sans qui que quoi quel quelle quels quelles ' +
  'comment pourquoi combien ne pas plus se sa son ses leur leurs il elle ils elles on nous vous je tu y the of and to in is are for on with what how why ' +
  'a an be was were it this that these those by at from as or not do does where who which ' +
  'el los las del y en con por para que como una uno der die das und ist mit den dem ein eine zu von il lo gli di da per che non e o do da em os as um uma ' +
  'и в во не что как на с со по к о об для это из у за').split(' '));

/** Écritures sans espaces entre les mots (chinois, japonais, thaï…) : découpées en paires de caractères. */
const SANS_ESPACES = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}]/u;
/** Les mots porteurs de sens d'un texte, dans TOUTES les écritures (repliés, sans mots vides, 2 caractères au moins). */
export function motsUtiles(t: string): string[] {
  const mots: string[] = [];
  for (const m of plier(t).replace(/[^\p{L}\p{M}\p{N} ]+/gu, ' ').split(' ')) {
    if (!m) continue;
    if (SANS_ESPACES.test(m)) { const c = [...m]; if (c.length === 1) continue; for (let i = 0; i + 1 < c.length; i++) mots.push(c[i] + c[i + 1]); continue; }
    if ([...m].length >= 2 && !VIDES.has(m)) mots.push(m);
  }
  return [...new Set(mots)];
}

/** Empreinte d'un contenu : sha256 du texte replié (une simple mise en forme ne la change pas). */
export const empreinteContenu = (t: string): string => createHash('sha256').update(plier(t)).digest('hex');

/** Un identifiant court. */
export const nouvelId = (): string => `${Date.now().toString(36)}${randomBytes(3).toString('hex')}`;

/** Une date AAAA-MM-JJ (UTC) d'un instant. */
export const dateCourte = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

/** Coupe un texte pour l'affichage. */
export const court = (t: string, n = 200): string => { const s = String(t ?? '').replace(/\s+/g, ' ').trim(); return s.length > n ? `${s.slice(0, n - 1)}…` : s; };
