// Agora sur l'ordinateur : la connexion à Odin, par la connexion unique (appli « agora »).
// - Trouver Odin (cette machine puis le réseau local), épingler son certificat au premier contact.
// - Se connecter : la session du poste (déjà ouverte par Pégase, Vénus… : rien à taper), sinon identifiant et mot de passe
//   (avec le code de double authentification si la personne en a un), ou par le navigateur (code + PKCE).
// - Appeler /api/agora/* avec un jeton d'appli toujours frais, écouter le flux des ordres (SSE) et s'y reconnecter.
// La bibliothèque cliente de la connexion unique d'Odin est copiée telle quelle depuis clients/odin-sso.mjs (MIT).

import { hostname } from 'node:os';
import type { IncomingMessage } from 'node:http';
import type { Rangement } from './stockage';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const SSO: any = require('./odin-sso.mjs');

export const PLATEFORME: string = SSO.PLATEFORME;
export interface Reponse { status: number; j: Record<string, any> }
const lireJson = (b: Buffer | undefined) => { try { return JSON.parse((b ?? Buffer.alloc(0)).toString('utf8') || '{}') as Record<string, any>; } catch { return {}; } };

/** Lit un flux SSE ligne par ligne (événement, données). */
export class LecteurSse {
  private type = ''; private data: string[] = []; private reste = '';
  constructor(private f: (type: string, data: string) => void) {}
  morceau(x: string): void { this.reste += x; let k; while ((k = this.reste.indexOf('\n')) >= 0) { this.ligne(this.reste.slice(0, k).replace(/\r$/, '')); this.reste = this.reste.slice(k + 1); } }
  ligne(l: string): void {
    if (l === '') { if (this.data.length) this.f(this.type || 'message', this.data.join('\n')); this.type = ''; this.data = []; return; }
    if (l.startsWith(':')) return;
    const i = l.indexOf(':'), champ = i < 0 ? l : l.slice(0, i), val = i < 0 ? '' : l.slice(i + 1).replace(/^ /, '');
    if (champ === 'event') this.type = val; else if (champ === 'data') this.data.push(val);
  }
}

export class Connexion {
  sso: any = null; adresse = ''; nomOdin = '';
  constructor(private r: Rangement) {}
  private nouveau(adresse: string, empreinte: string | null | undefined): any {
    this.adresse = adresse.replace(/\/+$/, '');
    return (this.sso = new SSO.OdinSSO({
      adresse: this.adresse, appli: 'agora',
      appareil: { id: this.r.reglages.appareil, nom: hostname().slice(0, 60), plateforme: PLATEFORME },
      ...(empreinte ? { empreinte } : { premierContact: true }),
      garder: (t: string) => this.r.garderSession(t), relire: () => this.r.relireSession(),
    }));
  }
  /** Odin sur cette machine ou le réseau local. */
  trouver(): Promise<Array<{ adresse: string; nom: string; version: string; empreinte: string | null }>> { return SSO.trouverOdin({ delai: 1200 }); }
  private retenir(): void {
    const vue = this.sso?.empreinteVue as string | null;
    this.r.reglages = { ...this.r.reglages, adresse: this.adresse, ...(this.adresse.startsWith('https:') && vue && !this.r.reglages.empreinte ? { empreinte: vue } : {}), nomOdin: this.nomOdin || 'Odin' };
    this.r.sauverReglages();
  }
  /** Rouvre la session sans rien demander (session gardée, ou session du poste). */
  async ouvrir(): Promise<{ ok: boolean; message?: string }> {
    const a = this.r.reglages.adresse; if (!a) return { ok: false, message: 'Pas encore relié à Odin.' };
    this.nouveau(a, this.r.reglages.empreinte);
    try { const x = await this.sso.ouvrir(); if (x.ok) this.retenir(); return { ok: x.ok, message: x.message }; } catch (e) { return { ok: false, message: (e as Error).message }; }
  }
  async connecter(adresse: string, identifiant: string, motdepasse: string, code?: string, poste = true): Promise<{ ok: boolean; message?: string; codeRequis?: boolean }> {
    const meme = adresse.replace(/\/+$/, '') === this.r.reglages.adresse;
    this.nouveau(adresse, meme ? this.r.reglages.empreinte : null);
    try {
      const x = await this.sso.connecter({ identifiant, motdepasse, ...(code ? { code } : {}), poste });
      if (!x.ok) return { ok: false, message: x.message, codeRequis: x.code === 'code_requis' };
      this.retenir(); return { ok: true };
    } catch (e) { return { ok: false, message: `Odin ne répond pas (${(e as Error).message}).` }; }
  }
  async parNavigateur(adresse: string, ouvrir: (u: string) => Promise<void>): Promise<{ ok: boolean; message?: string }> {
    this.nouveau(adresse, adresse.replace(/\/+$/, '') === this.r.reglages.adresse ? this.r.reglages.empreinte : null);
    try { const x = await this.sso.autoriser({ ouvrir }); if (x.ok) this.retenir(); return { ok: x.ok, message: x.message }; } catch (e) { return { ok: false, message: (e as Error).message }; }
  }
  async deconnecter(): Promise<void> { try { await this.sso?.deconnecter(); } catch { /* hors ligne */ } this.r.garderSession('null'); this.sso = null; }
  /** Un appel à l'API d'Agora (jeton renouvelé tout seul). */
  async api(chemin: string, corps?: unknown): Promise<Reponse> {
    if (!this.sso) return { status: 0, j: { message: 'Pas connecté à Odin.' } };
    const r = await this.sso._api(`/api/agora/${chemin}`, corps === undefined ? {} : { corps });
    return { status: r.status, j: lireJson(r.body) };
  }
  /** Ouvre le flux des ordres (rend la réponse HTTP en flux). */
  async flux(): Promise<IncomingMessage & { statusCode?: number }> { const r = await this.sso._api('/api/agora/flux', { flux: true, delai: 70_000, entetes: { accept: 'text/event-stream' } }); return r.flux; }
  /** Une adresse d'Odin (relative) en flux, avec le jeton et le certificat épinglé : pour télécharger un installateur. */
  async telechargement(chemin: string): Promise<IncomingMessage> { const r = await this.sso._api(chemin, { flux: true, delai: 120_000, entetes: { accept: 'application/octet-stream' } }); return Object.assign(r.flux, { statusCode: r.status }); }
}
