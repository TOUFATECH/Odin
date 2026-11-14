// Pages pegase:// de l'étape 5 : agenda, import, profil, synchro Odin.
import type { Ctx } from './commun';
type Page = (el: HTMLElement, ctx: Ctx) => void | (() => void);
export const pagesSuite: Record<string, Page> = {};
