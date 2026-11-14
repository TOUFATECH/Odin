// Le point de rencontre entre Persona (src/valhalla/modules/var.ts) et la connexion unique (src/valhalla/sso) :
// Persona s'y branche à son chargement. Ce fichier n'importe rien d'Odin : aucune boucle d'imports possible.

import type { ModCtx } from '../types.ts';

let ctxDe: () => ModCtx | undefined = () => undefined;
let pageDe: ((titre: string, corps: string, nonce: string) => string) | undefined;
/** Appelé par Persona : son contexte (le dernier vu) et sa page de connexion (mascotte d'Odin). */
export function brancherPersona(ctx: () => ModCtx | undefined, page: (titre: string, corps: string, nonce: string) => string): void { ctxDe = ctx; pageDe = page; }
/** Le contexte de Persona (undefined si les applis ne tournent pas). */
export const persona = (): ModCtx | undefined => ctxDe();
/** Une page du portail Persona. */
export const personaPage = (titre: string, corps: string, nonce: string): string => (pageDe ? pageDe(titre, corps, nonce) : `<!doctype html><html lang="fr"><meta charset="utf-8"><title>${titre}</title><body>${corps}</body></html>`);
