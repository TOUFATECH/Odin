// Connexion par QR code : un écran qui n'est pas connecté (un port direct d'appli, ou l'interface d'Odin) montre un
// QR code ; un téléphone DÉJÀ connecté à Odin le scanne, la personne voit quel écran demande à entrer (appareil,
// adresse, appli) et touche « Autoriser ». L'écran entre alors au nom de CETTE personne (le propriétaire, ou un membre
// de Persona) : aucun mot de passe ne passe par l'écran, et les droits restent ceux de la personne qui a autorisé.
// Rien n'est donné sans ce geste : la demande expire en 3 minutes, sert une seule fois, et le nombre de demandes est limité.

import { randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { deviceName } from './pairing.ts';

/** Qui a autorisé l'écran : le propriétaire d'Odin, ou une personne de Persona (son identifiant). */
export type Qui = { proprio: true } | { login: string };
export interface DemandeQr { code: string; appareil: string; ip: string; appli?: string; debut: number; etat: 'attente' | 'ok' | 'refus' }
interface Entree extends DemandeQr { secret: string; qui?: Qui }

export const DUREE_QR = 3 * 60_000;
const LETTRES = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export class ConnexionQr {
  private demandes = new Map<string, Entree>();
  private parIp = new Map<string, number[]>();

  /** Nouvelle demande d'un écran. undefined si trop de demandes (5 par adresse et par 10 min, 20 en attente au plus). */
  debut(ua: string, ip: string, appli?: string, now = Date.now()): { code: string; secret: string } | undefined {
    this.nettoyer(now);
    const vus = (this.parIp.get(ip) ?? []).filter((t) => now - t < 10 * 60_000);
    if (vus.length >= 5 || this.demandes.size >= 20) return undefined;
    this.parIp.set(ip, [...vus, now]);
    let code = ''; do { code = ''; for (let i = 0; i < 8; i++) code += LETTRES[randomInt(LETTRES.length)]; } while (this.demandes.has(code)); // tirage sans biais
    const e: Entree = { code, secret: randomBytes(24).toString('hex'), appareil: deviceName(ua), ip, ...(appli ? { appli } : {}), debut: now, etat: 'attente' };
    this.demandes.set(code, e);
    return { code, secret: e.secret };
  }

  /** Ce que le téléphone montre avant d'autoriser (rien de secret). */
  voir(code: string, now = Date.now()): DemandeQr | undefined {
    this.nettoyer(now);
    const e = this.demandes.get(norm(code)); if (!e) return undefined;
    return { code: e.code, appareil: e.appareil, ip: e.ip, ...(e.appli ? { appli: e.appli } : {}), debut: e.debut, etat: e.etat };
  }

  /** Décision prise sur le téléphone connecté. Une demande déjà décidée ne change plus. */
  decider(code: string, qui: Qui, ok: boolean, now = Date.now()): DemandeQr | undefined {
    this.nettoyer(now);
    const e = this.demandes.get(norm(code)); if (!e) return undefined;
    if (e.etat === 'attente') { e.etat = ok ? 'ok' : 'refus'; if (ok) e.qui = qui; }
    return this.voir(e.code, now);
  }

  /**
   * L'écran demande où en est sa demande (avec son secret, jamais le code seul). « ok » ne sert qu'une fois : la demande
   * est alors retirée, et l'écran reçoit qui l'a autorisé.
   */
  collecter(secret: string, now = Date.now()): { etat: 'attente' | 'refus' | 'expire' } | { etat: 'ok'; qui: Qui; appli?: string } {
    this.nettoyer(now);
    const s = Buffer.from(String(secret ?? ''));
    const e = [...this.demandes.values()].find((x) => { const b = Buffer.from(x.secret); return b.length === s.length && timingSafeEqual(b, s); });
    if (!e) return { etat: 'expire' };
    if (e.etat === 'attente') return { etat: 'attente' };
    this.demandes.delete(e.code);
    return e.etat === 'ok' && e.qui ? { etat: 'ok', qui: e.qui, ...(e.appli ? { appli: e.appli } : {}) } : { etat: 'refus' };
  }

  private nettoyer(now: number): void { for (const [k, e] of this.demandes) if (now - e.debut > DUREE_QR) this.demandes.delete(k); }
}
const norm = (c: string) => String(c ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 16);
