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

// L'envoi d'un e-mail (invitation, mot de passe oublié) : branché par Odin sur sa boîte (Réglages → Mail).
type Courrier = (a: string, sujet: string, texte: string) => Promise<void>;
let courrierDe: Courrier = async () => { throw new Error('l\'envoi d\'e-mails n\'est pas réglé (Réglages → Mail)'); };
/** Appelé par Odin (ou un essai) : comment envoyer un e-mail. */
export function brancherCourrier(f: Courrier): void { courrierDe = f; }
export const courrier = (): Courrier => courrierDe;
// Où répond l'interface d'Odin (pour les liens envoyés et pour les postes du parc).
let adresseDe: () => { port: number; tls: boolean } = () => ({ port: 8888, tls: true });
export function brancherAdresseOdin(f: () => { port: number; tls: boolean }): void { adresseDe = f; }
export const adresseOdin = () => adresseDe();
