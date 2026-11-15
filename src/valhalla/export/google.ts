// Export des pages d'applis · vers Google Docs, avec le compte Google du propriétaire.
//
// Connexion : flux OAuth 2.0 « appareils à saisie limitée » de Google (comme « Se connecter avec un code ») :
//   1. POST https://oauth2.googleapis.com/device/code (client_id, scope) → user_code, verification_url, interval ;
//   2. tu saisis le code sur la page de Google, depuis n'importe quel appareil ;
//   3. Odin interroge POST https://oauth2.googleapis.com/token (grant_type=urn:ietf:params:oauth:grant-type:device_code)
//      au rythme demandé (« authorization_pending » : on attend ; « slow_down » : 5 s de plus ; « access_denied »,
//      « expired_token » : on s'arrête et on le dit).
// Portée demandée : https://www.googleapis.com/auth/drive.file (seulement les fichiers créés par Odin, rien d'autre
// du Drive). Le client OAuth est celui du propriétaire (type « Téléviseurs et appareils à saisie limitée »).
//
// Envoi : Drive API v3, téléversement « multipart » avec conversion : POST
// https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart, corps multipart/related (métadonnées JSON
// { name, mimeType: application/vnd.google-apps.document } puis la page en HTML) : Google en fait un document Docs.
//
// Secrets : identifiant et secret du client, jeton de rafraîchissement → fichier env d'Odin, par writeSecret
// (chiffré par le coffre Thésauros quand il est activé). Le jeton d'accès ne vit qu'en mémoire. Aucun secret
// n'apparaît dans un message, une réponse d'API ou un journal : tout texte venu de Google est nettoyé avant.
//
// Écrit d'après la documentation officielle de Google (OAuth 2.0 for TV and Limited-Input Device Applications ;
// Drive API, « Upload file data »). Essayé uniquement contre un faux serveur (test/export-google.test.ts) :
// aucune vraie connexion à Google n'a été faite depuis la machine d'essai.

import { randomBytes } from 'node:crypto';
import { odinPaths } from '../../config.ts';
import { writeSecret } from '../../settings.ts';
import { vaultState } from '../../vault.ts';
import { enHtml } from './html.ts';
import { jourIso, type PageExport } from './page.ts';

export const SCOPE_DRIVE_FILE = 'https://www.googleapis.com/auth/drive.file';
export const NOMS_GOOGLE = { id: 'GOOGLE_OAUTH_CLIENT_ID', secret: 'GOOGLE_OAUTH_CLIENT_SECRET', rafraichir: 'GOOGLE_OAUTH_REFRESH_TOKEN' } as const;
const DEVICE_GRANT = 'urn:ietf:params:oauth:grant-type:device_code';

export interface OptionsGoogle {
  /** adresse des jetons (par défaut https://oauth2.googleapis.com) */
  oauth?: string;
  /** adresse du téléversement Drive (par défaut https://www.googleapis.com/upload/drive/v3) */
  upload?: string;
  env?: NodeJS.ProcessEnv;
  fetch?: typeof fetch;
  /** durée d'une seconde d'« interval » (essais : quelques millisecondes) */
  pasMs?: number;
}
export interface EtatGoogle {
  /** l'identifiant du client OAuth est enregistré */
  client: boolean;
  /** un jeton de rafraîchissement est rangé : on peut exporter */
  connecte: boolean;
  /** connexion par code en cours */
  attente?: { code: string; adresse: string; expire: string };
  /** la dernière connexion a échoué (refus, code expiré…) */
  erreur?: string;
  /** coffre verrouillé : les secrets ne sont pas lisibles */
  coffre?: string;
}

/** Retire tout secret connu d'un texte (Google peut en répéter un dans sa réponse). Pur. */
export function nettoyer(texte: string, ...secrets: Array<string | undefined>): string {
  let t = texte;
  for (const x of secrets) if (x && x.length >= 6) t = t.split(x).join('[masqué]');
  // Par prudence : tout ce qui ressemble à un jeton Google (ya29.…, 1//…, GOCSPX-…) est masqué aussi.
  return t.replace(/\bya29\.[\w.-]+/g, '[masqué]').replace(/\b1\/\/[\w.-]+/g, '[masqué]').replace(/\bGOCSPX-[\w-]+/g, '[masqué]');
}

/** Le titre du document Google : « Nom de l'appli - onglet - date ». Pur. */
export function titreDocument(p: PageExport): string {
  const sur = (t: string) => t.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
  return `${sur(p.app.name) || 'Odin'}${p.onglet ? ` - ${sur(p.onglet)}` : ''} - ${jourIso(new Date(p.at))}`;
}

/** Le corps multipart/related de Drive : métadonnées JSON, puis le contenu. Pur (la frontière est donnée). */
export function corpsMultipart(frontiere: string, meta: Record<string, unknown>, type: string, contenu: Buffer): Buffer {
  if (contenu.includes(`--${frontiere}`)) throw new Error('frontière présente dans le contenu');
  return Buffer.concat([
    Buffer.from(`--${frontiere}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${frontiere}\r\nContent-Type: ${type}\r\n\r\n`, 'utf8'),
    contenu,
    Buffer.from(`\r\n--${frontiere}--\r\n`, 'utf8'),
  ]);
}

interface Attente { device: string; code: string; adresse: string; fin: number; intervalle: number; minuteur?: NodeJS.Timeout }
type Reponse = { status: number; corps: Record<string, unknown> };

export class ConnexionGoogle {
  private acces?: { jeton: string; fin: number };
  private attente?: Attente;
  private erreur?: string;
  private readonly oauth: string;
  private readonly upload: string;
  private readonly env: NodeJS.ProcessEnv;
  private readonly f: typeof fetch;
  private readonly pasMs: number;
  readonly home: string;
  constructor(home: string, o: OptionsGoogle = {}) {
    this.home = home;
    this.oauth = (o.oauth ?? 'https://oauth2.googleapis.com').replace(/\/$/, '');
    this.upload = (o.upload ?? 'https://www.googleapis.com/upload/drive/v3').replace(/\/$/, '');
    this.env = o.env ?? process.env; this.f = o.fetch ?? fetch; this.pasMs = o.pasMs ?? 1000;
  }
  private get id() { return this.env[NOMS_GOOGLE.id] ?? ''; }
  private get secret() { return this.env[NOMS_GOOGLE.secret] ?? ''; }
  private get rafraichir() { return this.env[NOMS_GOOGLE.rafraichir] ?? ''; }
  private propre(t: string) { return nettoyer(t, this.secret, this.rafraichir, this.acces?.jeton, this.attente?.device); }
  private ecrire(nom: string, valeur: string) { writeSecret(odinPaths(this.home), nom, valeur, this.env); }

  connecte(): boolean { return Boolean(this.rafraichir && this.id); }
  etat(): EtatGoogle {
    const a = this.attente && this.attente.fin > Date.now() ? this.attente : undefined;
    const verrou = vaultState(this.home) === 'locked' && !this.connecte();
    return {
      client: Boolean(this.id), connecte: this.connecte(),
      ...(a ? { attente: { code: a.code, adresse: a.adresse, expire: new Date(a.fin).toISOString() } } : {}),
      ...(this.erreur ? { erreur: this.erreur } : {}),
      ...(verrou ? { coffre: 'Le coffre est verrouillé : déverrouille-le (Accueil) pour que la connexion Google soit lisible.' } : {}),
    };
  }

  /** Enregistre le client OAuth du propriétaire (identifiant et secret) dans le coffre. Un autre client oublie l'ancienne connexion. */
  enregistrerClient(id: string, secret: string): void {
    const i = id.trim(), s = secret.trim();
    if (!/^[A-Za-z0-9._-]{8,200}\.apps\.googleusercontent\.com$/.test(i)) throw new Error('identifiant de client invalide : il finit par « .apps.googleusercontent.com » (console Google Cloud → Identifiants)');
    if (!/^[A-Za-z0-9_-]{10,120}$/.test(s)) throw new Error('secret du client invalide (console Google Cloud → Identifiants → ton client)');
    if (i !== this.id && this.rafraichir) this.ecrire(NOMS_GOOGLE.rafraichir, '');
    this.ecrire(NOMS_GOOGLE.id, i); this.ecrire(NOMS_GOOGLE.secret, s);
    this.acces = undefined; this.erreur = undefined;
  }

  private async poster(url: string, champs: Record<string, string>): Promise<Reponse> {
    let r: Response;
    try { r = await this.f(url, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(champs).toString(), signal: AbortSignal.timeout(30_000) }); }
    catch { throw new Error('Google ne répond pas (pas d\'Internet ?) : réessaie dans un instant'); }
    const t = await r.text().catch(() => '');
    let corps: Record<string, unknown> = {}; try { corps = JSON.parse(t) as Record<string, unknown>; } catch { /* pas du JSON */ }
    return { status: r.status, corps };
  }

  /** Démarre la connexion par code : rend le code à saisir et l'adresse de Google ; Odin attend la réponse tout seul. */
  async demarrer(): Promise<{ code: string; adresse: string; expire: string }> {
    if (!this.id) throw new Error('enregistre d\'abord l\'identifiant et le secret de ton client OAuth Google');
    this.arreter(); this.erreur = undefined;
    const r = await this.poster(`${this.oauth}/device/code`, { client_id: this.id, scope: SCOPE_DRIVE_FILE });
    const c = r.corps;
    if (r.status !== 200 || typeof c.device_code !== 'string' || typeof c.user_code !== 'string') {
      const e = String(c.error ?? '');
      throw new Error(this.propre(e === 'invalid_client' ? 'Google ne reconnaît pas ce client : il doit être du type « Téléviseurs et appareils à saisie limitée »' : e === 'rate_limit_exceeded' ? 'trop de demandes de connexion : réessaie plus tard' : `Google a refusé de donner un code (${e || `HTTP ${r.status}`})`));
    }
    const adresse = String(c.verification_url ?? c.verification_uri ?? 'https://www.google.com/device');
    if (!/^https:\/\//.test(adresse)) throw new Error('adresse de vérification inattendue');
    const a: Attente = { device: c.device_code, code: c.user_code.slice(0, 40), adresse, fin: Date.now() + Math.min(Number(c.expires_in) || 1800, 1800) * 1000, intervalle: Math.max(Number(c.interval) || 5, 1) };
    this.attente = a; this.planifier(a);
    return { code: a.code, adresse: a.adresse, expire: new Date(a.fin).toISOString() };
  }
  arreter(): void { if (this.attente?.minuteur) clearTimeout(this.attente.minuteur); this.attente = undefined; }
  private planifier(a: Attente) { a.minuteur = setTimeout(() => { void this.sonder().catch(() => undefined); }, a.intervalle * this.pasMs); a.minuteur.unref?.(); }

  /** Une interrogation de Google. Rend « attente », « connecte » ou « fini » (refus, expiration, erreur). */
  async sonder(): Promise<'attente' | 'connecte' | 'fini'> {
    const a = this.attente; if (!a) return this.connecte() ? 'connecte' : 'fini';
    if (Date.now() > a.fin) { this.attente = undefined; this.erreur = 'Le code a expiré : recommence la connexion.'; return 'fini'; }
    const r = await this.poster(`${this.oauth}/token`, { client_id: this.id, client_secret: this.secret, device_code: a.device, grant_type: DEVICE_GRANT });
    if (this.attente !== a) return this.connecte() ? 'connecte' : 'fini';
    const c = r.corps, e = String(c.error ?? '');
    if (r.status === 200 && typeof c.access_token === 'string') {
      this.attente = undefined;
      if (typeof c.refresh_token !== 'string') { this.erreur = 'Google n\'a pas donné de jeton durable : recommence la connexion.'; return 'fini'; }
      this.ecrire(NOMS_GOOGLE.rafraichir, c.refresh_token);
      this.acces = { jeton: c.access_token, fin: Date.now() + (Number(c.expires_in) || 3600) * 1000 };
      return 'connecte';
    }
    if (e === 'authorization_pending') { this.planifier(a); return 'attente'; }
    if (e === 'slow_down') { a.intervalle += 5; this.planifier(a); return 'attente'; }
    this.attente = undefined;
    this.erreur = e === 'access_denied' ? 'Tu as refusé l\'accès sur la page de Google : rien n\'est relié.'
      : e === 'expired_token' ? 'Le code a expiré : recommence la connexion.'
      : e === 'invalid_client' ? 'Google refuse ce client (identifiant ou secret faux, ou type de client inadapté).'
      : e === 'admin_policy_enforced' || e === 'org_internal' ? 'L\'administrateur de ce compte Google n\'autorise pas cet accès.'
      : this.propre(`Connexion refusée par Google (${e || `HTTP ${r.status}`}).`);
    return 'fini';
  }

  /** Un jeton d'accès valable (rafraîchi au besoin). */
  async jetonAcces(): Promise<string> {
    if (this.acces && this.acces.fin - 60_000 > Date.now()) return this.acces.jeton;
    if (!this.connecte()) throw new Error(vaultState(this.home) === 'locked' ? 'le coffre est verrouillé : déverrouille-le pour exporter vers Google Docs' : 'Odin n\'est pas relié à ton compte Google');
    const r = await this.poster(`${this.oauth}/token`, { client_id: this.id, client_secret: this.secret, refresh_token: this.rafraichir, grant_type: 'refresh_token' });
    const c = r.corps;
    if (r.status === 200 && typeof c.access_token === 'string') { this.acces = { jeton: c.access_token, fin: Date.now() + (Number(c.expires_in) || 3600) * 1000 }; return c.access_token; }
    if (c.error === 'invalid_grant') { this.ecrire(NOMS_GOOGLE.rafraichir, ''); this.acces = undefined; throw new Error('la connexion Google a été retirée ou a expiré : relie à nouveau ton compte'); }
    throw new Error(this.propre(`Google refuse de renouveler l'accès (${String(c.error ?? `HTTP ${r.status}`)})`));
  }

  /** Crée un document Google Docs à partir de la page (HTML converti par Drive). Rend son identifiant et son lien. */
  async creerDocument(p: PageExport, bandeau = `Exporté depuis Odin le ${new Date(p.at).toLocaleString('fr-FR')}`): Promise<{ id: string; lien: string; nom: string }> {
    const nom = titreDocument(p), frontiere = `odin_${randomBytes(16).toString('hex')}`;
    const corps = corpsMultipart(frontiere, { name: nom, mimeType: 'application/vnd.google-apps.document' }, 'text/html; charset=UTF-8', Buffer.from(enHtml(p, bandeau), 'utf8'));
    for (let essai = 0; essai < 2; essai++) {
      const jeton = await this.jetonAcces();
      let r: Response;
      try { r = await this.f(`${this.upload}/files?uploadType=multipart&fields=id,name`, { method: 'POST', headers: { authorization: `Bearer ${jeton}`, 'content-type': `multipart/related; boundary=${frontiere}`, 'content-length': String(corps.length) }, body: corps, signal: AbortSignal.timeout(60_000) }); }
      catch { throw new Error('Google Drive ne répond pas (pas d\'Internet ?) : réessaie dans un instant'); }
      const t = await r.text().catch(() => '');
      if (r.status === 401 && essai === 0) { this.acces = undefined; continue; } // jeton périmé : un rafraîchissement, une seule nouvelle tentative
      let j: { id?: unknown; error?: { message?: unknown; errors?: Array<{ reason?: unknown }> } } = {}; try { j = JSON.parse(t); } catch { /* pas du JSON */ }
      if (r.ok) {
        const id = String(j.id ?? '');
        if (!/^[A-Za-z0-9_-]{10,200}$/.test(id)) throw new Error('Google Drive n\'a pas rendu d\'identifiant de document');
        return { id, lien: `https://docs.google.com/document/d/${id}/edit`, nom };
      }
      const raison = String(j.error?.errors?.[0]?.reason ?? '');
      const pourquoi = r.status === 401 ? 'Google refuse l\'accès : relie à nouveau ton compte'
        : r.status === 403 && /storageQuota/i.test(raison) ? 'ton Drive est plein'
        : r.status === 403 && /rateLimit|userRateLimit/i.test(raison) ? 'trop de demandes d\'un coup : réessaie dans une minute'
        : r.status === 403 ? 'Google n\'autorise pas cet envoi (accès « drive.file » retiré, ou API Drive non activée pour ton client)'
        : r.status === 429 ? 'trop de demandes d\'un coup : réessaie dans une minute'
        : r.status >= 500 ? 'Google Drive est en panne pour l\'instant : réessaie plus tard'
        : `envoi refusé (HTTP ${r.status})`;
      throw new Error(this.propre(`Export vers Google Docs impossible : ${pourquoi}.`));
    }
    throw new Error('Export vers Google Docs impossible : Google refuse l\'accès, relie à nouveau ton compte.');
  }

  /** Retire la connexion : le jeton est révoqué chez Google, puis oublié par Odin (même si Google ne répond pas). */
  async deconnecter(): Promise<{ revoque: boolean }> {
    this.arreter();
    const t = this.rafraichir || this.acces?.jeton; let revoque = false;
    if (t) { try { const r = await this.poster(`${this.oauth}/revoke`, { token: t }); revoque = r.status === 200; } catch { revoque = false; } }
    if (this.rafraichir) this.ecrire(NOMS_GOOGLE.rafraichir, '');
    this.acces = undefined; this.erreur = undefined;
    return { revoque };
  }
}

const connexions = new Map<string, ConnexionGoogle>();
/** La connexion Google d'une installation d'Odin (une par dossier d'Odin). */
export function googleDe(home: string): ConnexionGoogle {
  let c = connexions.get(home); if (!c) { c = new ConnexionGoogle(home); connexions.set(home, c); }
  return c;
}
/** Pour les essais : une connexion qui parle à un autre serveur (faux serveur Google). */
export function reglerGoogle(home: string, o: OptionsGoogle): ConnexionGoogle {
  connexions.get(home)?.arreter();
  const c = new ConnexionGoogle(home, o); connexions.set(home, c); return c;
}
