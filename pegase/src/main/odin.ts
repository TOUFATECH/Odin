// Pégase ↔ Odin (docs/pegase-protocole.md d'Odin, version 1) : trouver Odin, se connecter (jeton d'appareil
// « pg1. » ou connexion unique du poste), synchro en temps réel (envoi groupé, flux SSE, empreintes toutes les
// 30 s, file d'attente chiffrée hors ligne, conflits), IA, signatures d'Asclépios, copies et restauration.
// Les mots de passe ne sont jamais écrits ni journalisés ; le jeton est chiffré par le système (safeStorage).
import { app } from 'electron';
import { hostname, networkInterfaces } from 'node:os';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Collection, Enregistrement, EtatSynchro } from '../commun/types';
import { COLLECTIONS } from '../commun/types';
import { FichierChiffre } from './stockage';
import type { ProfilOuvert } from './profil';

// La bibliothèque cliente de la connexion unique d'Odin, copiée telle quelle depuis clients/odin-sso.mjs (MIT).
// eslint-disable-next-line @typescript-eslint/no-require-imports
const SSO: any = require('./odin-sso.mjs');

const ESSAI = !app.isPackaged && !!process.env.PEGASE_ESSAI;
export const PLATEFORME = ({ win32: 'windows', darwin: 'mac', linux: 'linux' } as Record<string, string>)[process.platform] ?? 'autre';
export const nomAppareil = (): string => {
  const h = hostname().replace(/\.local$/, '').slice(0, 40) || 'ordinateur';
  return `Pégase · ${h}`.slice(0, 60);
};

export interface ProfilOdin { id: string; login: string; email: string; nom: string; groupes: string[]; role: string; voir: 'tout' | 'sans-historique' | 'rien' }
export interface OdinTrouve { adresse: string; nom: string; version: string; empreinte: string | null; dns: boolean; comptes: boolean }
/** Ce qui est gardé (chiffré) sur le PC pour un profil relié à Odin. */
export interface Lien {
  adresse: string; empreinte: string | null; nom: string; version: string; dns: boolean;
  /** jeton d'appareil (pg1.…) chiffré par safeStorage, en base64 ; ou mode SSO (jetons de l'appli gardés à part) */
  jeton?: string; mode: 'jeton' | 'sso'; sso?: string;
  profil?: ProfilOdin; appareil?: { id: string; nom: string };
  derniere?: number; depuis?: Partial<Record<Collection, number>>;
}
interface Local { premierFait: boolean; lien: Lien | null; verif?: { sel: string; hash: string }; journal: { quoi: string; quand: number }[]; signaturesVersion?: number }

type Reponse = { status: number; j: any };

/** Une requête vers Odin (certificat épinglé dès qu'on le connaît ; le corps ne part qu'après la vérification). */
export async function appel(adresse: string, chemin: string, o: { empreinte?: string | null; corps?: unknown; jeton?: string; entetes?: Record<string, string>; delai?: number; brut?: Buffer; premierContact?: boolean } = {}): Promise<Reponse> {
  const entetes: Record<string, string> = { ...(o.entetes ?? {}) };
  if (o.jeton) entetes.authorization = `Bearer ${o.jeton}`;
  const r = await SSO.requete(adresse, chemin, {
    corps: o.brut ?? o.corps, entetes, delai: o.delai ?? 15_000, max: 64 * 1024 * 1024,
    ...(o.empreinte ? { empreinte: o.empreinte } : { premierContact: true }),
  });
  let j: any = {}; try { j = JSON.parse(r.body.toString('utf8') || '{}'); } catch { j = { texte: r.body.toString('utf8') }; }
  return { status: r.status, j };
}

/** Les ports où chercher Odin (7777 et 7443 ; les essais en ajoutent un). */
function ports(): number[] {
  const l = [7777, 7443];
  if (ESSAI && process.env.PEGASE_ODIN_PORTS) l.unshift(...process.env.PEGASE_ODIN_PORTS.split(',').map(Number).filter(Boolean));
  return l;
}

/** Demande « bonjour » à une adresse (https puis http). */
export async function bonjour(hote: string, port: number, delai = 1500): Promise<OdinTrouve | null> {
  for (const proto of ['https', 'http']) {
    const adresse = `${proto}://${hote.includes(':') && !hote.startsWith('[') ? `[${hote}]` : hote}:${port}`;
    try {
      const r = await SSO.requete(adresse, '/api/pegase/bonjour', { premierContact: true, delai, max: 64 * 1024 });
      const j = JSON.parse(r.body.toString('utf8') || '{}');
      if (r.status === 200 && j.odin === true) {
        // L'empreinte annoncée doit être celle du certificat vraiment présenté (sinon on ne la croit pas).
        const vue = r.empreinte || null;
        if (proto === 'https' && j.empreinte && vue && j.empreinte !== vue) continue;
        return { adresse, nom: String(j.nom || 'Odin'), version: String(j.version || ''), empreinte: proto === 'https' ? vue : null, dns: !!j.dns, comptes: !!j.comptes };
      }
    } catch { /* rien ici */ }
  }
  return null;
}

/** Cherche Odin : ce PC d'abord, puis le réseau local /24 (32 requêtes à la fois, 1,5 s chacune). */
export async function trouverOdin(o: { reseau?: boolean; surTrouve?: (t: OdinTrouve) => void } = {}): Promise<OdinTrouve[]> {
  const trouves: OdinTrouve[] = [];
  for (const p of ports()) { const t = await bonjour('127.0.0.1', p); if (t) { trouves.push(t); o.surTrouve?.(t); return trouves; } }
  if (o.reseau === false || (ESSAI && process.env.PEGASE_ODIN_RESEAU === 'non')) return trouves;
  const hotes: string[] = [];
  for (const l of Object.values(networkInterfaces())) for (const i of l ?? []) {
    if (i.family !== 'IPv4' || i.internal) continue;
    const b = i.address.split('.').slice(0, 3).join('.');
    for (let k = 1; k < 255; k++) hotes.push(`${b}.${k}`);
  }
  const essais = [...new Set(hotes)].flatMap((h) => ports().map((p) => [h, p] as const));
  let i = 0;
  const un = async () => { for (;;) { const e = essais[i++]; if (!e) return; if (trouves.some((t) => new URL(t.adresse).hostname === e[0])) continue; const t = await bonjour(e[0], e[1]); if (t) { trouves.push(t); o.surTrouve?.(t); } } };
  await Promise.all(Array.from({ length: 32 }, un));
  return trouves;
}

// Le jeton est rangé dans odin.json.pgs, chiffré en AES-256-GCM avec la clé du profil, elle-même gardée par le
// système (safeStorage : DPAPI, Trousseau, libsecret). Il n'est jamais écrit en clair ni journalisé.
const chiffrerTexte = (t: string): string => `p:${t}`;
const dechiffrerTexte = (t?: string): string | undefined => (t?.startsWith('p:') ? t.slice(2) : undefined);

/** Le coffre du système pour la connexion unique (dans les essais : un fichier, jamais dans un Pégase installé). */
function coffreSso(): any {
  const f = ESSAI ? process.env.PEGASE_COFFRE_ESSAI : '';
  if (!f) return SSO.coffre;
  const lire = (): Record<string, string> => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return {}; } };
  return {
    disponible: async () => true,
    ranger: async (n: string, s: string) => { const c = lire(); c[n] = s; writeFileSync(f, JSON.stringify(c)); },
    lire: async (n: string) => lire()[n],
    effacer: async (n: string) => { const c = lire(); delete c[n]; writeFileSync(f, JSON.stringify(c)); },
  };
}

/** Les collections qui ne partent jamais : aucune (mais rien d'une fenêtre privée, et jamais cookies ni mots de passe). */
const MAX_ENVOI = 1000;

/**
 * La synchro d'un profil avec Odin.
 * etat : « local » (pas relié), « ok » (toutes les empreintes égales), « encours », « horsligne » (n en attente).
 */
export class Synchro {
  readonly local: FichierChiffre<Local>;
  private file: FichierChiffre<Enregistrement[]>;
  etat: EtatSynchro = { etat: 'local', attente: 0 };
  private sso: any = null;
  private minuterieEnvoi: NodeJS.Timeout | null = null;
  private minuterieVerif: NodeJS.Timeout | null = null;
  private minuterieReprise: NodeJS.Timeout | null = null;
  private flux: any = null;
  private dernierSigne = 0;
  private essaisReprise = 0;
  private arrete = false;
  private envoiEnCours: Promise<void> | null = null;
  /** Ce qui s'est passé (pour l'interface : messages, révocation, restauration). */
  surMessage: (texte: string) => void = () => {};
  surEtat: () => void = () => {};

  constructor(readonly p: ProfilOuvert, readonly appareilNom = nomAppareil()) {
    this.local = new FichierChiffre<Local>(join(p.opts.dossier, 'odin.json.pgs'), p.base.cle, { premierFait: false, lien: null, journal: [] });
    this.file = new FichierChiffre<Enregistrement[]>(join(p.opts.dossier, 'attente.json.pgs'), p.base.cle, []);
    p.base.surChangement((e, local) => { if (local) this.mettreEnFile(e); });
    this.etat.attente = this.file.valeur.length;
  }

  get lien(): Lien | null { return this.local.valeur.lien; }
  get connecte(): boolean { return !!this.lien && (this.etat.etat === 'ok' || this.etat.etat === 'encours'); }

  // ————— Connexion —————
  /** Au démarrage : le lien gardé, sinon la connexion unique du poste (sans mot de passe). */
  async demarrer(trouve?: OdinTrouve | null): Promise<boolean> {
    this.arrete = false;
    if (this.lien) { this.majEtat(this.file.valeur.length ? 'horsligne' : 'encours'); void this.ouvrirFlux(); return true; }
    if (trouve) return (await this.essayerSso(trouve)).ok;
    return false;
  }

  /** Connexion unique : un jeton du poste dans le coffre du système → jetons de Pégase, sans mot de passe. */
  async essayerSso(t: OdinTrouve): Promise<{ ok: boolean; message?: string }> {
    try {
      const s = this.nouveauSso(t, undefined);
      const r = await s.ouvrir();
      if (!r.ok) return { ok: false, message: r.message };
      this.sso = s;
      const lien: Lien = { adresse: t.adresse, empreinte: t.empreinte, nom: t.nom, version: t.version, dns: t.dns, mode: 'sso', sso: this.ssoGarde };
      const moi = await appel(t.adresse, '/api/pegase/moi', { empreinte: t.empreinte, jeton: await s.jeton(), entetes: { 'x-pegase-appareil': encodeURIComponent(this.appareilNom).slice(0, 60) } });
      if (moi.status !== 200) return { ok: false, message: moi.j.erreur ?? 'Odin a refusé la connexion unique.' };
      lien.profil = moi.j.profil; lien.appareil = moi.j.appareil;
      this.relier(lien, 'connexion unique du poste');
      return { ok: true };
    } catch (e) { return { ok: false, message: String((e as Error).message ?? e) }; }
  }
  private ssoGarde: string | undefined;
  private nouveauSso(t: { adresse: string; empreinte: string | null }, garde: string | undefined): any {
    this.ssoGarde = garde;
    return new SSO.OdinSSO({
      adresse: t.adresse, appli: 'pegase', appareil: { nom: this.appareilNom, plateforme: PLATEFORME },
      empreinte: t.empreinte || undefined, premierContact: !t.empreinte, coffre: coffreSso(),
      garder: (x: string) => { this.ssoGarde = chiffrerTexte(x); if (this.local.valeur.lien?.mode === 'sso') { this.local.valeur.lien.sso = this.ssoGarde; this.local.sauver(); } },
      relire: () => dechiffrerTexte(this.ssoGarde),
    });
  }

  /** E-mail (ou identifiant) et mot de passe de Persona. Rend { ok } ou { ok: false, code, texte }. */
  async connecter(t: OdinTrouve, email: string, motdepasse: string, code?: string): Promise<{ ok: boolean; code?: string; texte?: string; attente?: number }> {
    const r = await appel(t.adresse, '/api/pegase/connexion', { empreinte: t.empreinte, corps: { email, motdepasse, ...(code ? { code } : {}), appareil: { nom: this.appareilNom, plateforme: PLATEFORME } } }).catch((e) => ({ status: 0, j: { erreur: `Odin ne répond pas (${(e as Error).message}).` } }));
    if (r.status !== 200) return { ok: false, code: r.j.code, texte: r.j.erreur ?? `Odin a répondu ${r.status}.`, attente: r.j.attente };
    this.retenirMotDePasse(motdepasse);
    this.relier({ adresse: t.adresse, empreinte: t.empreinte, nom: t.nom, version: t.version, dns: t.dns, mode: 'jeton', jeton: chiffrerTexte(r.j.jeton), profil: r.j.profil, appareil: r.j.appareil }, 'connexion');
    // Connexion unique : on ouvre aussi la session du poste pour les autres programmes d'Odin (si le coffre du système est là).
    if (!code) void this.ouvrirPoste(t, email, motdepasse);
    return { ok: true };
  }
  private async ouvrirPoste(t: OdinTrouve, identifiant: string, motdepasse: string): Promise<void> {
    try { const c = coffreSso(); if (!(await c.disponible())) return; const s = this.nouveauSso(t, undefined); const r = await s.connecter({ identifiant, motdepasse, poste: true }); if (r.ok && r.poste) this.journal('session du poste ouverte (connexion unique)'); } catch { /* pas de coffre : pas de SSO du poste */ }
  }

  /** Créer une personne d'Odin depuis Pégase (avec l'accord du propriétaire, sauf réponse immédiate). */
  async creerCompte(t: OdinTrouve, nom: string, email: string, motdepasse: string): Promise<{ ok: boolean; etat?: string; demande?: string; code?: string; texte?: string; codeErreur?: string }> {
    const r = await appel(t.adresse, '/api/pegase/compte', { empreinte: t.empreinte, corps: { email, nom, motdepasse, appareil: { nom: this.appareilNom, plateforme: PLATEFORME } } }).catch((e) => ({ status: 0, j: { erreur: `Odin ne répond pas (${(e as Error).message}).` } }));
    if (r.status !== 200) return { ok: false, texte: r.j.erreur ?? `Odin a répondu ${r.status}.`, codeErreur: r.j.code };
    this.retenirMotDePasse(motdepasse);
    if (r.j.etat === 'ok') { this.relier({ adresse: t.adresse, empreinte: t.empreinte, nom: t.nom, version: t.version, dns: t.dns, mode: 'jeton', jeton: chiffrerTexte(r.j.jeton), profil: r.j.profil, appareil: r.j.appareil }, 'compte créé'); return { ok: true, etat: 'ok' }; }
    return { ok: true, etat: 'attente', demande: r.j.demande, code: r.j.code };
  }
  async etatCompte(t: OdinTrouve, demande: string): Promise<{ ok: boolean; etat: string; texte?: string }> {
    const r = await appel(t.adresse, '/api/pegase/compte/etat', { empreinte: t.empreinte, corps: { demande } }).catch(() => ({ status: 0, j: { erreur: 'Odin ne répond pas.' } }));
    if (r.status === 200 && r.j.etat === 'ok') { this.relier({ adresse: t.adresse, empreinte: t.empreinte, nom: t.nom, version: t.version, dns: t.dns, mode: 'jeton', jeton: chiffrerTexte(r.j.jeton), profil: r.j.profil, appareil: r.j.appareil }, 'compte créé avec l’accord du propriétaire'); return { ok: true, etat: 'ok' }; }
    if (r.status === 200) return { ok: true, etat: 'attente' };
    return { ok: false, etat: r.j.etat ?? 'erreur', texte: r.j.erreur ?? 'Odin ne répond pas.' };
  }

  /** Garde de quoi vérifier « retape ton mot de passe Odin » sans réseau (empreinte scrypt salée, jamais le mot de passe). */
  retenirMotDePasse(mdp: string): void {
    const { scryptSync, randomBytes } = require('node:crypto') as typeof import('node:crypto');
    const sel = randomBytes(16);
    this.local.valeur.verif = { sel: sel.toString('base64'), hash: scryptSync(mdp.normalize('NFC'), sel, 32, { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }).toString('base64') };
    this.local.sauver(true);
  }
  verifierMotDePasse(mdp: string): boolean | null {
    const v = this.local.valeur.verif; if (!v) return null;
    const { scryptSync, timingSafeEqual } = require('node:crypto') as typeof import('node:crypto');
    const h = scryptSync(String(mdp).normalize('NFC'), Buffer.from(v.sel, 'base64'), 32, { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
    return timingSafeEqual(h, Buffer.from(v.hash, 'base64'));
  }

  private relier(lien: Lien, pourquoi: string): void {
    this.local.valeur.lien = lien; this.local.valeur.premierFait = true;
    this.journal(pourquoi);
    this.local.sauver(true);
    // Le profil de Pégase prend le nom de la personne d'Odin.
    if (lien.profil) {
      const pr = this.p.profil();
      if (pr.nom !== lien.profil.nom || pr.email !== lien.profil.email) this.p.mettre('profil', { ...pr, nom: lien.profil.nom, email: lien.profil.email, lettre: (lien.profil.nom || 'T').trim().slice(0, 1).toUpperCase() });
    }
    this.majEtat('encours');
    void this.ouvrirFlux();
    void this.verifier();
  }

  premierFait(): void { this.local.valeur.premierFait = true; this.local.sauver(true); }

  /** Oublie Odin sur ce PC (et révoque le jeton côté Odin si on le peut). */
  async deconnecter(revoquer = true): Promise<void> {
    const l = this.lien; if (!l) return;
    if (revoquer) { try { await this.api('/api/pegase/deconnexion', { corps: {} }); } catch { /* hors ligne : le jeton reste révocable dans Odin */ } }
    if (l.mode === 'sso' && this.sso && revoquer) await this.sso.deconnecter().catch(() => 0);
    this.fermerFlux(); this.sso = null;
    this.local.valeur.lien = null; this.local.sauver(true);
    this.majEtat('local');
    this.journal('déconnecté d’Odin');
  }

  // ————— Appels avec le jeton —————
  private async jeton(): Promise<{ jeton: string; entetes: Record<string, string> }> {
    const l = this.lien; if (!l) throw new Error('Pas relié à Odin.');
    if (l.mode === 'jeton') { const j = dechiffrerTexte(l.jeton); if (!j) throw new Error('Le jeton d’Odin ne peut plus être lu sur ce PC : reconnecte-toi.'); return { jeton: j, entetes: {} }; }
    if (!this.sso) this.sso = this.nouveauSso(l, l.sso);
    if (!this.sso.etat) { const r = await this.sso.ouvrir(); if (!r.ok) throw Object.assign(new Error(r.message), { code: 'jeton_invalide' }); }
    return { jeton: await this.sso.jeton(), entetes: { 'x-pegase-appareil': encodeURIComponent(this.appareilNom).slice(0, 60) } };
  }
  async api(chemin: string, o: { corps?: unknown; brut?: Buffer; entetes?: Record<string, string>; delai?: number } = {}): Promise<Reponse> {
    const l = this.lien; if (!l) throw new Error('Pas relié à Odin.');
    const { jeton, entetes } = await this.jeton();
    const r = await appel(l.adresse, chemin, { empreinte: l.empreinte, jeton, corps: o.corps, brut: o.brut, entetes: { ...entetes, ...(o.entetes ?? {}) }, delai: o.delai });
    if (r.status === 401 && (r.j.code === 'jeton_invalide' || r.j.code === 'jeton_requis')) {
      if (l.mode === 'sso' && this.sso) { const n = await this.sso.renouveler().catch(() => ({ ok: false })); if (n.ok) return this.api(chemin, o); }
      this.oublier(r.j.erreur ?? 'Ce Pégase n’est plus reconnu par Odin : reconnecte-toi.');
    }
    return r;
  }
  /** Jeton refusé (appareil révoqué dans Odin) : on oublie le lien, les données restent sur le PC. */
  private oublier(texte: string): void {
    this.fermerFlux(); this.sso = null;
    this.local.valeur.lien = null; this.local.sauver(true);
    this.majEtat('local'); this.journal('jeton refusé par Odin'); this.surMessage(texte);
  }

  // ————— Envoi —————
  private mettreEnFile(e: Enregistrement): void {
    if (this.p.prive) return;
    const f = this.file.valeur;
    const i = f.findIndex((x) => x.col === e.col && x.id === e.id);
    if (i >= 0) f.splice(i, 1);
    f.push(e); this.file.sauver();
    this.etat.attente = f.length;
    if (!this.lien) return;
    if (!this.minuterieEnvoi) this.minuterieEnvoi = setTimeout(() => { this.minuterieEnvoi = null; void this.envoyer(); }, 250);
  }
  /** Envoie la file d'attente (regroupée, 1 000 au plus par envoi) ; garde tout si Odin ne répond pas. */
  envoyer(): Promise<void> {
    // (la promesse est rangée AVANT de pouvoir se terminer : sinon un envoi fini tout de suite resterait « en cours »)
    if (this.envoiEnCours) return this.envoiEnCours;
    const p = this.envoyerFile().finally(() => { if (this.envoiEnCours === p) this.envoiEnCours = null; });
    this.envoiEnCours = p;
    return p;
  }
  private async envoyerFile(): Promise<void> {
    {
      try {
        while (this.lien && this.file.valeur.length) {
          const lot = this.file.valeur.slice(0, MAX_ENVOI);
          const r = await this.api('/api/pegase/envoyer', { corps: { changements: lot.map(({ id, col, data, maj, suppr }) => ({ id, col, data: suppr ? {} : data, maj, ...(suppr ? { suppr: true } : {}) })) } });
          if (r.status !== 200) { if (this.lien) this.horsLigne(); return; }
          // Ce qui a été envoyé sort de la file (sauf s'il a changé entre-temps).
          const envoyes = new Map(lot.map((e) => [`${e.col}|${e.id}`, e.maj]));
          this.file.valeur = this.file.valeur.filter((e) => envoyes.get(`${e.col}|${e.id}`) !== e.maj);
          this.file.sauver();
          for (const g of r.j.gagnants ?? []) this.p.base.recevoir(g);
          this.etat.attente = this.file.valeur.length;
          this.essaisReprise = 0;
        }
        if (this.lien && this.etat.etat === 'horsligne') { this.majEtat('encours'); void this.verifier(); }
        else this.planifierEtat();
      } catch { if (this.lien) this.horsLigne(); }
    }
  }

  // ————— Réception : le flux —————
  private async ouvrirFlux(): Promise<void> {
    if (!this.lien || this.flux || this.arrete) return;
    const l = this.lien;
    try {
      const { jeton, entetes } = await this.jeton();
      const r = await SSO.requete(l.adresse, '/api/pegase/flux', { flux: true, empreinte: l.empreinte || undefined, premierContact: !l.empreinte, delai: 0, entetes: { ...entetes, authorization: `Bearer ${jeton}`, accept: 'text/event-stream' } });
      if (r.status !== 200) {
        let j: any = {}; try { j = JSON.parse(await lireTout(r.flux)); } catch { /* */ }
        if (r.status === 401) { if (l.mode === 'sso' && this.sso && (await this.sso.renouveler().catch(() => ({ ok: false }))).ok) { this.reprendre(500); return; } this.oublier(j.erreur ?? 'Ce Pégase n’est plus reconnu par Odin.'); return; }
        if (r.status === 403) { this.oublier(j.erreur ?? 'Odin a refusé l’accès à Pégase.'); return; }
        this.horsLigne(); return;
      }
      this.flux = r.flux; this.dernierSigne = Date.now(); this.essaisReprise = 0;
      if (this.etat.etat === 'horsligne') this.majEtat('encours');
      let tampon = '';
      r.flux.setEncoding('utf8');
      r.flux.on('data', (morceau: string) => {
        tampon += morceau; this.dernierSigne = Date.now();
        let k: number;
        while ((k = tampon.indexOf('\n\n')) >= 0) { const bloc = tampon.slice(0, k); tampon = tampon.slice(k + 2); this.evenement(bloc); }
      });
      const fin = () => { if (this.flux !== r.flux) return; this.flux = null; if (this.lien && !this.arrete) { this.horsLigne(); } };
      r.flux.on('end', fin); r.flux.on('error', fin); r.flux.on('close', fin);
      // Signe de vie : sans « verif » depuis 70 s, on rouvre le flux.
      if (!this.minuterieVerif) this.minuterieVerif = setInterval(() => {
        if (!this.lien) return;
        if (this.flux && Date.now() - this.dernierSigne > 70_000) { const f = this.flux; this.flux = null; try { f.destroy(); } catch { /* */ } void this.ouvrirFlux(); }
        if (!this.flux) void this.verifier();
      }, ESSAI && process.env.PEGASE_VERIF_MS ? Number(process.env.PEGASE_VERIF_MS) : 30_000);
      this.minuterieVerif.unref?.();
      void this.envoyer();
    } catch { this.horsLigne(); }
  }
  private evenement(bloc: string): void {
    let ev = 'message', data = '';
    for (const ligne of bloc.split('\n')) { if (ligne.startsWith('event:')) ev = ligne.slice(6).trim(); else if (ligne.startsWith('data:')) data += ligne.slice(5).trim(); }
    let j: any = {}; try { j = JSON.parse(data || '{}'); } catch { return; }
    if (ev === 'changements') { for (const e of j.changements ?? []) if (COLLECTIONS.includes(e.col)) this.p.base.recevoir(e); this.local.valeur.lien && (this.local.valeur.lien.derniere = Date.now()); this.planifierEtat(); }
    else if (ev === 'verif') { void this.comparer(j.empreintes ?? {}); }
    else if (ev === 'restaure') { this.journal(j.texte ?? 'données restaurées depuis Odin'); this.surMessage(j.texte ?? 'Odin a remis une copie de tes données.'); }
    else if (ev === 'revoque') { this.oublier(j.texte ?? 'Cet appareil a été déconnecté depuis Odin.'); }
  }
  private fermerFlux(): void {
    if (this.minuterieVerif) { clearInterval(this.minuterieVerif); this.minuterieVerif = null; }
    if (this.minuterieReprise) { clearTimeout(this.minuterieReprise); this.minuterieReprise = null; }
    const f = this.flux; this.flux = null; try { f?.destroy(); } catch { /* */ }
  }
  private horsLigne(): void {
    this.majEtat('horsligne');
    this.reprendre(Math.min(30_000, 2000 * 2 ** this.essaisReprise++));
  }
  private reprendre(ms: number): void {
    if (this.minuterieReprise || this.arrete) return;
    this.minuterieReprise = setTimeout(() => { this.minuterieReprise = null; if (this.lien) { void this.ouvrirFlux(); void this.envoyer(); } }, ms);
    this.minuterieReprise.unref?.();
  }

  // ————— Vérification « à l'identique » —————
  /** Compare les empreintes d'Odin avec les nôtres ; tire puis renvoie ce qui diffère. */
  async verifier(): Promise<void> {
    if (!this.lien) return;
    try {
      const r = await this.api('/api/pegase/empreintes');
      if (r.status !== 200) { if (this.lien) this.horsLigne(); return; }
      await this.comparer(r.j);
    } catch { if (this.lien) this.horsLigne(); }
  }
  private comparaison: Promise<void> | null = null;
  private async comparer(emp: Record<string, { n: number; hash: string }>): Promise<void> {
    if (this.comparaison) return this.comparaison;
    const p = (async () => {
      try {
        await this.envoyer();
        const differentes = COLLECTIONS.filter((c) => emp[c] && emp[c].hash !== this.p.base.empreinte(c).hash);
        if (differentes.length) this.majEtat('encours');
        for (const col of differentes) await this.tirer(col);
        await this.envoyer();
        if (this.lien) { this.lien.derniere = Date.now(); this.local.sauver(); }
        this.planifierEtat();
      } catch { if (this.lien) this.horsLigne(); }
    })().finally(() => { if (this.comparaison === p) this.comparaison = null; this.planifierEtat(); });
    this.comparaison = p;
    return p;
  }
  /** Tire une collection, garde ce qui est plus récent, et renvoie à Odin ce qu'il n'a pas (ou a en plus ancien). */
  async tirer(col: Collection): Promise<void> {
    const vus = new Map<string, Enregistrement>();
    let depuis: number | undefined;
    for (let tour = 0; tour < 50; tour++) {
      const r = await this.api('/api/pegase/tirer', { corps: { col, ...(depuis !== undefined ? { depuis } : {}), limite: 20000 } });
      if (r.status !== 200) throw new Error(r.j.erreur ?? 'tirage refusé');
      for (const e of r.j.changements ?? []) { vus.set(e.id, e); this.p.base.recevoir(e); }
      if (r.j.complet !== false || r.j.suite == null) break;
      depuis = r.j.suite;
    }
    for (const e of this.p.base.enregistrements(col)) {
      const o = vus.get(e.id);
      if (!o || o.maj < e.maj) this.mettreEnFile(e);
    }
  }

  private planifierEtat(): void {
    if (!this.lien) return this.majEtat('local');
    if (this.etat.etat === 'horsligne' && !this.flux) return;
    this.majEtat(this.file.valeur.length || this.comparaison ? 'encours' : 'ok');
  }
  private majEtat(e: EtatSynchro['etat']): void {
    this.etat = { etat: e, attente: this.file.valeur.length, odin: this.lien?.nom, derniere: this.lien?.derniere };
    this.surEtat();
  }
  journal(quoi: string): void { const l = this.local.valeur.journal; l.unshift({ quoi, quand: Date.now() }); l.length = Math.min(l.length, 30); this.local.sauver(); }

  // ————— Le reste du contrat —————
  async copies(): Promise<any[]> { const r = await this.api('/api/pegase/copies'); return r.status === 200 ? r.j.copies ?? [] : []; }
  async restaurer(copie: string): Promise<string> { const r = await this.api('/api/pegase/restaurer', { corps: { copie } }); return r.j.texte ?? r.j.erreur ?? 'Odin n’a pas répondu.'; }
  async demander(texte: string, page?: { url: string; titre: string; extrait: string }): Promise<string> {
    const r = await this.api('/api/pegase/demander', { corps: { texte: texte.slice(0, 4000), ...(page ? { page: { ...page, extrait: page.extrait.slice(0, 20_000) } } : {}) }, delai: 130_000 }).catch(() => null);
    if (!r) return 'Je travaille encore dessus : la réponse arrivera dans Odin.';
    return r.status === 200 ? String(r.j.reponse ?? '') : r.j.erreur ?? `Odin a répondu ${r.status}.`;
  }
  async propositions(): Promise<any[]> { const r = await this.api('/api/pegase/propositions').catch(() => null); return r?.status === 200 ? r.j.propositions ?? [] : []; }
  async voir(v: 'tout' | 'sans-historique' | 'rien'): Promise<boolean> { const r = await this.api('/api/pegase/moi', { corps: { voir: v } }); if (r.status === 200 && this.lien) { this.lien.profil = r.j.profil; this.local.sauver(); } return r.status === 200; }
  async moi(): Promise<any> { const r = await this.api('/api/pegase/moi'); return r.status === 200 ? r.j : null; }
  async lienAgenda(nouvelle = false): Promise<string | null> { const r = await this.api('/api/pegase/agenda/lien', { corps: nouvelle ? { nouvelle: true } : {} }); return r.status === 200 ? r.j.url : null; }
  async adresse(url: string): Promise<{ verdict: string; texte: string } | null> { const r = await this.api('/api/pegase/adresse', { corps: { url } }).catch(() => null); return r?.status === 200 ? r.j : null; }
  /** Les empreintes des fichiers malveillants connus d'Asclépios (gardées, mises à jour par version). */
  async signatures(fichier: string): Promise<Set<string> | null> {
    const v = this.local.valeur.signaturesVersion;
    const r = await this.api(`/api/pegase/signatures${v !== undefined && existsSync(fichier) ? `?version=${v}` : ''}`).catch(() => null);
    if (!r || r.status !== 200) return null;
    if (r.j.inchange) return null;
    writeFileSync(fichier, JSON.stringify(r.j.empreintes ?? []));
    this.local.valeur.signaturesVersion = r.j.version; this.local.sauver();
    return new Set((r.j.empreintes ?? []).map((x: string) => String(x).toLowerCase()));
  }
  async analyser(octets: Buffer, nom: string): Promise<{ sain: boolean; menace?: string } | null> {
    const r = await this.api('/api/pegase/analyser', { brut: octets, entetes: { 'content-type': 'application/octet-stream', 'x-nom': encodeURIComponent(nom) }, delai: 5 * 60_000 }).catch(() => null);
    if (!r || r.status !== 200) return null;
    return { sain: r.j.verdict === 'sain', menace: r.j.verdict === 'sain' ? undefined : (r.j.menaces?.[0] ? `${r.j.menaces[0]} (Asclépios)` : r.j.texte ?? 'Douteux selon Asclépios') };
  }

  arreter(): void { this.arrete = true; this.fermerFlux(); this.local.sauver(true); this.file.sauver(true); }
}

function lireTout(s: NodeJS.ReadableStream): Promise<string> {
  return new Promise((ok) => { let t = ''; s.setEncoding('utf8'); s.on('data', (d) => { t += d; }); s.on('end', () => ok(t)); s.on('error', () => ok(t)); });
}
