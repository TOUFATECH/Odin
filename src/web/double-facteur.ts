// Le double facteur du compte du propriétaire d'Odin : un code à 6 chiffres (TOTP, RFC 6238) donné par une appli
// d'authentification du téléphone, demandé après le mot de passe à chaque connexion, s'il l'a activé (Réglages → Accès).
//   - activation : Odin crée le secret et le montre (QR code et texte) à la session qui l'a demandé, avec le mot de passe ;
//     il n'est gardé qu'après un premier code juste ; changer de téléphone exige en plus un code de l'ancien ;
//   - sur le disque, le secret n'existe que chiffré avec la clé de la machine (compte.json, interdit aux outils d'Odin) ;
//     jamais dans un journal, une conversation, un export ni une réponse à la page une fois activé ;
//   - un code ne sert qu'une fois : le dernier pas de 30 s accepté est noté ; un code de ce pas ou d'avant est refusé ;
//   - fenêtre de ±30 s (horloge du téléphone un peu décalée) ;
//   - codes faux : comptés par adresse ; après 5, attente qui grandit (30 s, 1 min… 15 min) pour cette adresse
//     seulement : un inconnu ailleurs ne bloque pas le propriétaire ;
//   - et comptés pour le compte (toutes adresses, sur une heure) : une adresse qui change à chaque essai (forgée derrière
//     un tunnel) n'essaie pas sans fin ; au-delà de 20, les codes de connexion attendent (1 min, 2 min… 15 min) d'où
//     qu'ils viennent, et le propriétaire est prévenu (quelqu'un a son mot de passe). Ni ses sessions déjà ouvertes, ni
//     son lien de secours (adresse e-mail + mot de passe) ne sont bloqués par cette attente ;
//   - secours (téléphone perdu) : un lien à usage unique, valable 15 minutes, envoyé à l'adresse e-mail du compte ; le lien
//     ET le mot de passe retirent le double facteur, puis un nouveau QR code est proposé ; c'est noté ;
//   - dernier recours, sans e-mail : « odin compte double-facteur retirer », sur la machine d'Odin, Odin arrêté.
// Les comptes des personnes de Persona gardent leur propre double facteur (src/valhalla/modules/var.ts) : rien ne change.

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { createConnection } from 'node:net';
import { totp } from '../valhalla/modules/brisingamen.ts';
import { svg as qrSvg } from '../valhalla/qr.ts';
import { buildMail, smtpSend, type MailConfig } from '../tools/mail.ts';
import { chiffrerChamp, dechiffrerChamp } from '../vault.ts';
import { Accounts, type NoteDeuxFacteur } from './account.ts';

export const PAS_MS = 30_000;
export const DUREE_SECOURS_MS = 15 * 60_000;
const DUREE_ACTIVATION_MS = 10 * 60_000;
const ESSAIS_LIBRES = 5;
const RATES_PAR_LIEN = 3;
/** Codes faux tolérés pour le compte, toutes adresses ensemble, sur une heure. */
const PLAFOND_COMPTE = 20;
const FENETRE_COMPTE_MS = 60 * 60_000;
export const COMMANDE_DERNIER_RECOURS = 'odin compte double-facteur retirer';

/** Envoie un e-mail (texte) : l'envoi d'Odin (Réglages → Mail), ou un faux dans les essais. */
export type Envoi = (a: string, sujet: string, texte: string) => Promise<void>;
export type Verdict = { ok: true } | { ok: false; error: string; code: 'code_faux' | 'trop_d_essais' | 'illisible' | 'inactif'; attente?: number };
export interface NouveauQr { secret: string; uri: string; svg: string }

const sha = (t: string) => createHash('sha256').update(t).digest('hex');
const egal = (a: string, b: string) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); };
const propre = (c: unknown) => String(c ?? '').replace(/[\s-]/g, '');
/** 160 bits au hasard, en base32 (ce que lisent les applis d'authentification). */
function nouveauSecret(): string { const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'; let s = ''; for (const b of randomBytes(32)) s += A[b % 32]; return s; }
const attendre = (s: number) => `${s >= 60 ? `${Math.ceil(s / 60)} min` : `${s} s`}`;

/** Le plus récent des pas de 30 s (d'avant, de maintenant, d'après) dont ce code est le code ; undefined : aucun. */
export function pasDuCode(secret: string, code: string, now: number): number | undefined {
  if (!/^\d{6}$/.test(code)) return undefined;
  const ici = Math.floor(now / PAS_MS);
  let trouve: number | undefined;
  for (const p of [ici - 1, ici, ici + 1]) if (egal(totp(secret, p * PAS_MS).code, code)) trouve = p;
  return trouve;
}

export class DoubleFacteur {
  private home: string;
  private comptes: Accounts;
  private now: () => number;
  private envoi?: Envoi;
  private pret: () => boolean;
  /** Activation pas encore confirmée : empreinte de la session → secret (en mémoire seulement, 10 minutes). */
  private enAttente = new Map<string, { secret: string; exp: number }>();
  /** Codes faux par adresse. */
  private essais = new Map<string, { n: number; jusqua: number }>();
  /** Le lien de secours valable (un seul à la fois) : empreinte du jeton, expiration, mauvais mots de passe. */
  private lien?: { h: string; exp: number; rates: number };
  private dernierEnvoi = 0;

  /** Codes faux du compte, toutes adresses (fenêtre d'une heure) : nombre, début, attente, adresses vues, alerte faite. */
  private compte = { n: 0, debut: 0, jusqua: 0, adresses: new Set<string>(), alerte: false };
  private alerte?: (texte: string) => void;

  constructor(home: string, comptes: Accounts, o: { now?: () => number; envoi?: Envoi; envoiPret?: () => boolean; /** prévient le propriétaire (codes faux en série) */ alerte?: (texte: string) => void } = {}) {
    this.home = home; this.comptes = comptes; this.now = o.now ?? Date.now; this.envoi = o.envoi; this.pret = o.envoiPret ?? (() => true); this.alerte = o.alerte;
  }

  actif(): boolean { return Boolean(this.comptes.deuxFacteur()); }
  /** Un envoi d'e-mail est-il réglé (sinon le secours passe par la commande sur la machine) ? */
  envoiPret(): boolean { return Boolean(this.envoi) && this.pret(); }

  /** Ce que la page des Réglages peut montrer : jamais le secret actif ; le QR code en attente seulement à sa session. */
  etat(session?: string): { actif: boolean; depuis?: string; journal: NoteDeuxFacteur[]; envoi: boolean; enAttente?: NouveauQr } {
    const d = this.comptes.deuxFacteur(), a = session ? this.enAttente.get(sha(session)) : undefined;
    return { actif: Boolean(d), ...(d ? { depuis: d.depuis } : {}), journal: this.comptes.journalDeuxFacteur(), envoi: this.envoiPret(), ...(a && a.exp > this.now() ? { enAttente: this.qr(a.secret) } : {}) };
  }

  private qr(secret: string): NouveauQr {
    const login = this.comptes.profile()?.email ?? 'compte';
    const uri = `otpauth://totp/${encodeURIComponent(`Odin:${login}`).replace('%3A', ':')}?secret=${secret}&issuer=Odin&algorithm=SHA1&digits=6&period=30`;
    return { secret, uri, svg: qrSvg(uri, { scale: 4, margin: 2 }) };
  }

  /** Secondes à attendre avant le prochain code depuis cette adresse (0 = tout de suite). */
  attente(ip: string): number { const e = this.essais.get(ip); return e ? Math.max(0, Math.ceil((e.jusqua - this.now()) / 1000)) : 0; }
  /** Secondes à attendre pour le compte entier (codes faux en série, toutes adresses). */
  private attenteCompte(): number { return Math.max(0, Math.ceil((this.compte.jusqua - this.now()) / 1000)); }
  /** Avant un code de connexion : l'attente de cette adresse, ou celle du compte si elle est plus longue. */
  attenteConnexion(ip: string): number { return Math.max(this.attente(ip), this.attenteCompte()); }
  /** Un code faux de connexion compte aussi pour le compte ; au-delà du plafond, attente pour toutes et alerte. */
  private rateCompte(ip: string): void {
    const c = this.compte, now = this.now();
    if (now - c.debut > FENETRE_COMPTE_MS && now >= c.jusqua) { c.n = 0; c.debut = now; c.adresses.clear(); c.alerte = false; }
    c.n++; if (c.adresses.size < 1000) c.adresses.add(ip);
    if (c.n < PLAFOND_COMPTE) return;
    c.jusqua = now + Math.min(15 * 60_000, 60_000 * 2 ** (c.n - PLAFOND_COMPTE));
    if (c.alerte) return;
    c.alerte = true;
    const nb = c.adresses.size, w = this.attenteCompte(), adr = `${nb} adresse${nb > 1 ? 's' : ''}`;
    this.comptes.poserDeuxFacteur(this.comptes.deuxFacteur(), { quoi: 'codes faux en série : codes suspendus', ip: adr });
    try {
      this.alerte?.(`${c.n} codes faux du double facteur en moins d'une heure sur ton compte Odin, depuis ${adr}. Chaque essai est passé par le bon mot de passe : quelqu'un le connaît sans doute. Change ton mot de passe (Réglages → Accès). Les codes de connexion attendent ${attendre(w)} (et plus si ça continue) ; tes sessions ouvertes et le lien de secours marchent toujours.`);
    } catch { /* l'alerte reste dans le journal du double facteur */ }
  }
  private rate(ip: string): void {
    const e = this.essais.get(ip) ?? { n: 0, jusqua: 0 };
    e.n++; if (e.n >= ESSAIS_LIBRES) e.jusqua = this.now() + Math.min(15 * 60_000, 30_000 * 2 ** (e.n - ESSAIS_LIBRES));
    this.essais.delete(ip); this.essais.set(ip, e);
    // Au plus 5000 adresses retenues (les plus anciennes partent) : pas de mémoire qui gonfle sans fin.
    while (this.essais.size > 5000) this.essais.delete(this.essais.keys().next().value!);
  }

  /**
   * Commence l'activation (ou le changement de téléphone) pour cette session : le mot de passe est exigé, et si le
   * double facteur est déjà actif, un code valide de l'actuel. Le nouveau secret ne remplace rien tant qu'il n'est pas confirmé.
   */
  async commencer(session: string, preuve: { password?: unknown; code?: unknown }, ip: string): Promise<NouveauQr> {
    if (!this.comptes.exists()) throw new Error('Aucun compte.');
    if (!session) throw new Error('Seulement depuis ton navigateur, connecté avec ton compte.');
    if (!(await this.comptes.motDePasseOk(preuve.password))) throw new Error(this.comptes.waitSeconds() > 0 ? `Trop d'essais : réessaie dans ${attendre(this.comptes.waitSeconds())}.` : 'Mot de passe incorrect.');
    if (this.actif()) { const v = this.verifier(preuve.code, ip, { connecte: true }); if (!v.ok) throw new Error(v.error); }
    const now = this.now(); for (const [k, x] of this.enAttente) if (x.exp < now) this.enAttente.delete(k);
    while (this.enAttente.size >= 20) this.enAttente.delete(this.enAttente.keys().next().value!);
    const secret = nouveauSecret();
    this.enAttente.set(sha(session), { secret, exp: now + DUREE_ACTIVATION_MS });
    return this.qr(secret);
  }
  /** Après le lien de secours : la nouvelle session reçoit aussitôt un nouveau QR code (rien n'est actif avant son premier code). */
  proposer(session: string): void { this.enAttente.set(sha(session), { secret: nouveauSecret(), exp: this.now() + DUREE_ACTIVATION_MS }); }

  /** Le premier code du nouveau secret : l'activation (ou le changement de téléphone) est faite. */
  confirmer(session: string, code: unknown, ip: string): void {
    const k = sha(session), a = this.enAttente.get(k);
    if (!a || a.exp < this.now()) { this.enAttente.delete(k); throw new Error('Aucune activation en cours (ou plus de 10 minutes) : recommence.'); }
    const w = this.attente(ip); if (w > 0) throw new Error(`Trop de codes faux : réessaie dans ${attendre(w)}.`);
    const pas = pasDuCode(a.secret, propre(code), this.now());
    if (pas === undefined) { this.rate(ip); throw new Error('Code incorrect. Vérifie l\'heure du téléphone, puis tape le code affiché maintenant.'); }
    const avant = this.actif();
    this.comptes.poserDeuxFacteur({ secret: chiffrerChamp(this.home, a.secret), depuis: new Date(this.now()).toISOString(), pas }, { quoi: avant ? 'téléphone changé' : 'activé', ip });
    this.enAttente.delete(k); this.essais.delete(ip);
  }

  /**
   * Vérifie un code ; un code juste est aussitôt noté comme utilisé (il ne resservira pas). `connecte` : depuis une
   * session déjà ouverte (changer de téléphone, retirer) : seule l'attente de l'adresse joue, pas celle du compte.
   */
  verifier(code: unknown, ip: string, o: { connecte?: boolean } = {}): Verdict {
    const d = this.comptes.deuxFacteur();
    if (!d) return { ok: false, code: 'inactif', error: 'Le double facteur n\'est pas activé.' };
    const w = o.connecte ? this.attente(ip) : this.attenteConnexion(ip);
    if (w > 0) return { ok: false, code: 'trop_d_essais', error: `Trop de codes faux : réessaie dans ${attendre(w)}.`, attente: w };
    let secret: string;
    try { secret = dechiffrerChamp(this.home, d.secret); } catch {
      return { ok: false, code: 'illisible', error: 'Le double facteur ne peut pas être lu sur cette machine (clé de la machine différente) : utilise « J\'ai perdu mon téléphone ».' };
    }
    const c = propre(code), pas = pasDuCode(secret, c, this.now());
    const faux = () => { this.rate(ip); if (!o.connecte) this.rateCompte(ip); };
    if (pas === undefined) { faux(); return this.apres(ip, o, { ok: false, code: 'code_faux', error: c ? 'Code incorrect.' : 'Code incorrect : tape le code à 6 chiffres de ton appli d\'authentification.' }); }
    if (pas <= d.pas) { faux(); return this.apres(ip, o, { ok: false, code: 'code_faux', error: 'Ce code a déjà servi : attends le suivant (il change toutes les 30 secondes).' }); }
    this.comptes.poserDeuxFacteur({ ...d, pas });
    this.essais.delete(ip);
    return { ok: true };
  }
  private apres(ip: string, o: { connecte?: boolean }, v: Verdict & { ok: false }): Verdict { const w = o.connecte ? this.attente(ip) : this.attenteConnexion(ip); return w > 0 ? { ...v, attente: w } : v; }

  /** Retire le double facteur, connecté : le mot de passe ET un code valide. */
  async retirer(preuve: { password?: unknown; code?: unknown }, ip: string): Promise<void> {
    if (!this.actif()) throw new Error('Le double facteur n\'est pas activé.');
    if (!(await this.comptes.motDePasseOk(preuve.password))) throw new Error(this.comptes.waitSeconds() > 0 ? `Trop d'essais : réessaie dans ${attendre(this.comptes.waitSeconds())}.` : 'Mot de passe incorrect.');
    const v = this.verifier(preuve.code, ip, { connecte: true }); if (!v.ok) throw new Error(v.error);
    this.comptes.poserDeuxFacteur(undefined, { quoi: 'retiré (mot de passe et code)', ip });
  }

  /**
   * « J'ai perdu mon téléphone » (le mot de passe vient d'être vérifié) : un lien à usage unique, 15 minutes, part à
   * l'adresse e-mail du compte. Un seul lien valable à la fois ; au plus un envoi par minute.
   */
  async demanderSecours(ip: string, liens: (jeton: string) => string[]): Promise<{ ok: true; message: string } | { ok: false; error: string }> {
    const p = this.comptes.profile();
    if (!p || !this.actif()) return { ok: false, error: 'Le double facteur n\'est pas activé.' };
    const sans = `L'envoi d'e-mails d'Odin n'est pas réglé (Réglages → Mail) : aucun lien ne peut partir. Dernier recours, sur la machine d'Odin : arrête Odin, puis tape « ${COMMANDE_DERNIER_RECOURS} ».`;
    if (!this.envoi || !this.envoiPret()) return { ok: false, error: sans };
    const masque = p.email.replace(/^(.).*?(@.*)$/, '$1…$2'), now = this.now();
    if (now - this.dernierEnvoi < 60_000 && this.lien && this.lien.exp > now) return { ok: true, message: `Un lien de secours vient de partir vers ${masque} : regarde ta boîte (et les indésirables).` };
    const jeton = randomBytes(32).toString('base64url');
    this.lien = { h: sha(jeton), exp: now + DUREE_SECOURS_MS, rates: 0 };
    const texte = [
      `Bonjour ${p.prenom},`, '',
      'Quelqu\'un (toi, sans doute) a demandé à entrer dans Odin sans le téléphone du double facteur.',
      'Ouvre ce lien, puis tape ton adresse e-mail et ton mot de passe : le double facteur sera retiré et un nouveau QR code te sera proposé.',
      '', ...liens(jeton), '',
      'Le lien sert une seule fois et vaut 15 minutes.',
      'Si ce n\'est pas toi : quelqu\'un connaît ton mot de passe. Ne touche pas au lien, et change ton mot de passe dans Odin (Réglages → Accès).',
    ].join('\n');
    try { await this.envoi(p.email, 'Odin : lien de secours du double facteur', texte); } catch (e) {
      this.lien = undefined;
      return { ok: false, error: `Le lien n'a pas pu partir (${(e as Error).message.slice(0, 160)}). Dernier recours, sur la machine d'Odin : arrête Odin, puis tape « ${COMMANDE_DERNIER_RECOURS} ».` };
    }
    this.dernierEnvoi = now;
    this.comptes.poserDeuxFacteur(this.comptes.deuxFacteur(), { quoi: 'lien de secours envoyé', ip });
    return { ok: true, message: `Un lien de secours est parti vers ${masque}. Il vaut 15 minutes et sert une seule fois, avec ton mot de passe.` };
  }

  /** Le lien de secours ET le mot de passe : le double facteur est retiré (noté). Trois mauvais mots de passe brûlent le lien. */
  async utiliserSecours(jeton: unknown, email: unknown, password: unknown, ip: string): Promise<{ ok: true } | { ok: false; status: number; error: string; retryAfter?: number }> {
    const j = String(jeton ?? ''), l = this.lien, now = this.now();
    const w = this.attente(ip);
    if (w > 0) return { ok: false, status: 429, error: `Trop d'essais : réessaie dans ${attendre(w)}.`, retryAfter: w };
    if (!this.actif() || !l || l.exp < now || !/^[A-Za-z0-9_-]{43}$/.test(j) || !egal(sha(j), l.h)) {
      this.rate(ip);
      if (l && l.exp < now) this.lien = undefined;
      return { ok: false, status: 403, error: 'Lien de secours inconnu, expiré ou déjà utilisé : redemande-le depuis l\'écran du code (« J\'ai perdu mon téléphone »).' };
    }
    const r = await this.comptes.login(email, password);
    if (!r.ok) {
      if (++l.rates >= RATES_PAR_LIEN) this.lien = undefined;
      return { ok: false, status: r.retryAfter ? 429 : 401, error: r.error, ...(r.retryAfter ? { retryAfter: r.retryAfter } : {}) };
    }
    if (this.lien !== l) return { ok: false, status: 403, error: 'Lien de secours déjà utilisé.' }; // deux envois en même temps : le premier gagne
    this.lien = undefined; this.essais.delete(ip);
    this.comptes.poserDeuxFacteur(undefined, { quoi: 'retiré par le lien de secours', ip });
    return { ok: true };
  }
}

/** L'envoi d'e-mail d'Odin (Réglages → Mail, mot de passe d'application dans MAIL_PASSWORD), relu à chaque envoi. */
export function envoiParOdin(cfg: () => MailConfig): { envoi: Envoi; envoiPret: () => boolean } {
  return {
    envoiPret: () => { const c = cfg(); return Boolean(c?.smtpHost && c.user && (process.env.MAIL_PASSWORD ?? '').trim()); },
    envoi: async (a, sujet, texte) => { const c = cfg(); await smtpSend(c, [a], buildMail(c.from || c.user, [a], sujet, texte)); },
  };
}

/** Un Odin écoute-t-il sur ce port de cette machine (la commande de dernier recours exige qu'il soit arrêté) ? */
export function odinEcoute(port: number, hotes: string[]): Promise<boolean> {
  const un = (host: string) => new Promise<boolean>((res) => {
    const s = createConnection({ host, port, timeout: 1500 }, () => { s.destroy(); res(true); });
    s.on('error', () => res(false)); s.on('timeout', () => { s.destroy(); res(false); });
  });
  return Promise.all([...new Set(hotes.filter((h) => h && h !== '0.0.0.0' && h !== '::'))].map(un)).then((l) => l.some(Boolean));
}

/**
 * Dernier recours (« odin compte double-facteur retirer ») : sur la machine d'Odin, Odin arrêté. Retire le double
 * facteur du compte et le note ; false s'il n'était pas activé. Les sessions ouvertes et le mot de passe ne changent pas.
 */
export function retirerSurLaMachine(home: string): boolean {
  const acc = new Accounts(home);
  if (!acc.deuxFacteur()) return false;
  acc.poserDeuxFacteur(undefined, { quoi: 'retiré par la commande sur la machine d\'Odin', ip: 'machine' });
  return true;
}
