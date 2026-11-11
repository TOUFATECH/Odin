// Le compte du propriétaire d'Odin et ses sessions.
// À la première connexion on crée le compte (prénom, nom, adresse e-mail, mot de passe) ; ensuite ces
// identifiants sont obligatoires pour entrer dans Odin depuis un navigateur.
//   - le mot de passe n'est jamais gardé : seulement son empreinte scrypt (sel aléatoire, coût élevé) ;
//   - une session = un identifiant aléatoire dans un cookie HttpOnly ; sur le disque il n'y a que son
//     empreinte SHA-256 (un fichier volé ne permet pas d'entrer) ;
//   - après 5 erreurs de mot de passe, chaque nouvel essai doit attendre (jusqu'à 15 minutes) ;
//   - fichiers en droits 600, interdits aux outils d'Odin (Heimdall), jamais affichés ni envoyés.
// Les programmes (raccourcis du téléphone, MCP) n'utilisent pas ce compte mais la clé d'API.

import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { chmodSync, existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface PassHash { algo: 'scrypt'; N: number; r: number; p: number; salt: string; hash: string }
export interface Account { prenom: string; nom: string; email: string; created: string; changed: string; pass: PassHash }
export type Via = 'création du compte' | 'mot de passe' | 'appareil autorisé';
interface StoredSession { h: string; created: number; seen: number; device: string; ip: string; via: Via }
export interface SessionInfo { id: string; created: number; seen: number; expires: number; device: string; ip: string; via: Via; current: boolean }
export interface Profile { prenom: string; nom: string; email: string; created: string; changed: string }

/** Coût scrypt : 64 Mo de mémoire par vérification (recommandation OWASP : N ≥ 2^16, r = 8, p = 1). */
export const SCRYPT_N = 65536;
const KEYLEN = 32;
export const SESSION_IDLE_MS = 30 * 86_400_000;      // 30 jours sans visite : la session expire
export const SESSION_MAX_MS = 90 * 86_400_000;       // 90 jours au plus, quoi qu'il arrive
const MAX_SESSIONS = 30;
export const SESSION_COOKIE = 'odin_session';
export const SESSION_RE = /(?:^|;\s*)odin_session=([A-Za-z0-9_-]{43})(?:;|$)/;

// Mots de passe les plus essayés par les robots : refusés d'office (comparaison sans accents ni casse).
const COMMON = new Set(('123456789012 1234567890 12345678910 123456789a azertyuiop azertyuiop123 qwertyuiop qwertyuiop123 motdepasse motdepasse1 motdepasse123 password12 password123 password1234 ' +
  'administrateur administrator adminadmin admin12345 changeme123 bienvenue1 bienvenue123 bonjour123 iloveyou123 jetaime123 marseille13 0123456789 9876543210 1q2w3e4r5t 1qaz2wsx3edc aaaaaaaaaa abcdefghij ' +
  'abcdefghijkl letmein123 welcome123 soleil1234 doudou1234 loulou1234 azerty12345 azerty123456 odinodinodin toufatech1 toufatech123').split(' '));
const plain = (t: string) => t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');

export const validEmail = (e: string) => e.length <= 254 && /^[^\s@<>"'(),;:\\]+@[^\s@<>"'(),;:\\]+\.[^\s@<>"'(),;:\\.]{2,}$/.test(e);
const cleanName = (t: unknown) => String(t ?? '').replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim();

/** Pourquoi ce mot de passe est refusé (undefined = accepté). Longueur d'abord : pas de règle de « caractères spéciaux ». */
export function passwordProblem(password: string, who: { prenom?: string; nom?: string; email?: string } = {}): string | undefined {
  if (typeof password !== 'string' || password.length < 10) return 'Le mot de passe doit faire au moins 10 caractères (une phrase courte marche très bien).';
  if (password.length > 200) return 'Le mot de passe est trop long (200 caractères au plus).';
  const p = plain(password);
  if (new Set(password).size < 5) return 'Ce mot de passe répète trop les mêmes caractères.';
  if (COMMON.has(p) || /^(?:0123456789|1234567890|9876543210|azertyuiop|qwertyuiop)+\d{0,4}$/.test(p)) return 'Ce mot de passe fait partie des plus essayés par les pirates : choisis-en un autre.';
  for (const part of [who.prenom, who.nom, (who.email ?? '').split('@')[0]]) {
    const w = plain(part ?? '');
    if (w.length >= 4 && p.replace(w, '').length < 6) return 'Ce mot de passe ressemble trop à ton nom ou à ton adresse e-mail.';
  }
  return undefined;
}

/** Force estimée (0 à 4) pour la jauge de l'écran de création : indicatif, la vraie règle est passwordProblem. */
export function passwordStrength(password: string): number {
  if (!password) return 0;
  const kinds = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((re) => re.test(password)).length;
  const bits = password.length * Math.log2(kinds === 1 ? 26 : kinds === 2 ? 36 : kinds === 3 ? 62 : 90) * (new Set(password).size / password.length > 0.6 ? 1 : 0.6);
  return bits < 40 ? 1 : bits < 60 ? 2 : bits < 80 ? 3 : 4;
}

const sha = (t: string) => createHash('sha256').update(t).digest('hex');
function derive(password: string, salt: Buffer, N: number, r: number, p: number): Promise<Buffer> {
  return new Promise((res, rej) => scrypt(password.normalize('NFKC'), salt, KEYLEN, { N, r, p, maxmem: 256 * N * r + 1024 * 1024 }, (e, k) => (e ? rej(e) : res(k))));
}

export class Accounts {
  private home: string;
  private now: () => number;
  private N: number;
  /** Une seule vérification de mot de passe à la fois (64 Mo chacune) : pas de saturation par essais en rafale. */
  private queue: Promise<unknown> = Promise.resolve();
  private fails = 0;
  private lockedUntil = 0;
  private cache?: { at: number; list: StoredSession[] };

  constructor(home: string, opts: { now?: () => number; scryptN?: number } = {}) {
    this.home = home; this.now = opts.now ?? Date.now; this.N = opts.scryptN ?? SCRYPT_N;
  }
  private get file(): string { return join(this.home, 'compte.json'); }
  private get sessFile(): string { return join(this.home, 'sessions.json'); }
  private write(file: string, data: unknown): void {
    const tmp = `${file}.tmp`;
    writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
    try { chmodSync(tmp, 0o600); } catch { /* Windows : droits gérés par le profil utilisateur */ }
    renameSync(tmp, file);
  }
  private account(): Account | undefined { try { const a = JSON.parse(readFileSync(this.file, 'utf8')) as Account; return a?.pass?.hash ? a : undefined; } catch { return undefined; } }

  exists(): boolean { return existsSync(this.file) && Boolean(this.account()); }
  profile(): Profile | undefined { const a = this.account(); return a ? { prenom: a.prenom, nom: a.nom, email: a.email, created: a.created, changed: a.changed } : undefined; }

  private async hash(password: string): Promise<PassHash> {
    const salt = randomBytes(16);
    const k = await (this.queue = this.queue.then(() => derive(password, salt, this.N, 8, 1), () => derive(password, salt, this.N, 8, 1))) as Buffer;
    return { algo: 'scrypt', N: this.N, r: 8, p: 1, salt: salt.toString('base64'), hash: k.toString('base64') };
  }
  /** Compare en temps constant ; sans compte, on calcule quand même (même durée : rien à deviner). */
  private async check(password: string, pass?: PassHash): Promise<boolean> {
    const ref = pass ?? { algo: 'scrypt' as const, N: this.N, r: 8, p: 1, salt: 'b2Rpbi1zZWwtZmFjdGljZQ==', hash: '' };
    const job = () => derive(String(password).slice(0, 1000), Buffer.from(ref.salt, 'base64'), ref.N, ref.r, ref.p);
    const k = await (this.queue = this.queue.then(job, job)) as Buffer;
    const want = Buffer.from(ref.hash, 'base64');
    return Boolean(pass) && want.length === k.length && timingSafeEqual(want, k);
  }

  /** Crée le compte (une seule fois). Lève une erreur lisible si une donnée ne va pas. */
  async create(input: { prenom?: unknown; nom?: unknown; email?: unknown; password?: unknown }): Promise<Profile> {
    if (this.exists()) throw new Error('Le compte existe déjà : connecte-toi.');
    const prenom = cleanName(input.prenom), nom = cleanName(input.nom), email = String(input.email ?? '').trim().toLowerCase(), password = String(input.password ?? '');
    if (prenom.length < 1 || prenom.length > 60) throw new Error('Indique ton prénom.');
    if (nom.length < 1 || nom.length > 60) throw new Error('Indique ton nom.');
    if (!validEmail(email)) throw new Error('Cette adresse e-mail n\'a pas la bonne forme.');
    const bad = passwordProblem(password, { prenom, nom, email }); if (bad) throw new Error(bad);
    const pass = await this.hash(password);
    if (this.exists()) throw new Error('Le compte existe déjà : connecte-toi.'); // deux créations en même temps : la première gagne
    const at = new Date(this.now()).toISOString();
    this.write(this.file, { prenom, nom, email, created: at, changed: at, pass } satisfies Account);
    this.fails = 0; this.lockedUntil = 0;
    return { prenom, nom, email, created: at, changed: at };
  }

  /** Secondes à attendre avant le prochain essai de mot de passe (0 = tout de suite). */
  waitSeconds(): number { return Math.max(0, Math.ceil((this.lockedUntil - this.now()) / 1000)); }

  /** Vérifie e-mail + mot de passe. Le message d'erreur ne dit jamais lequel des deux est faux. */
  async login(email: unknown, password: unknown): Promise<{ ok: true } | { ok: false; error: string; retryAfter?: number }> {
    const wait = this.waitSeconds();
    if (wait > 0) return { ok: false, error: `Trop d'essais : réessaie dans ${wait >= 60 ? `${Math.ceil(wait / 60)} min` : `${wait} s`}.`, retryAfter: wait };
    const a = this.account();
    const mailOk = Boolean(a) && String(email ?? '').trim().toLowerCase() === a!.email;
    const passOk = await this.check(String(password ?? ''), a?.pass);
    if (mailOk && passOk) { this.fails = 0; this.lockedUntil = 0; return { ok: true }; }
    this.fails++;
    // À partir de 5 erreurs de suite : 30 s, puis 1 min, 2 min… jusqu'à 15 min. Un seul bon mot de passe remet à zéro.
    if (this.fails >= 5) this.lockedUntil = this.now() + Math.min(15 * 60_000, 30_000 * 2 ** (this.fails - 5));
    return { ok: false, error: 'Adresse e-mail ou mot de passe incorrect.', ...(this.fails >= 5 ? { retryAfter: this.waitSeconds() } : {}) };
  }

  /** Change le mot de passe (l'actuel est exigé) : toutes les autres sessions sont fermées. */
  async changePassword(current: unknown, next: unknown, keepToken?: string): Promise<void> {
    const a = this.account(); if (!a) throw new Error('Aucun compte.');
    if (this.waitSeconds() > 0) throw new Error(`Trop d'essais : réessaie dans ${this.waitSeconds()} s.`);
    if (!(await this.check(String(current ?? ''), a.pass))) { this.fails++; if (this.fails >= 5) this.lockedUntil = this.now() + Math.min(15 * 60_000, 30_000 * 2 ** (this.fails - 5)); throw new Error('Le mot de passe actuel est incorrect.'); }
    const bad = passwordProblem(String(next ?? ''), a); if (bad) throw new Error(bad);
    if (String(next) === String(current)) throw new Error('Le nouveau mot de passe est identique à l\'ancien.');
    a.pass = await this.hash(String(next)); a.changed = new Date(this.now()).toISOString();
    this.write(this.file, a); this.fails = 0;
    this.revokeOthers(keepToken);
  }

  /** Change prénom, nom ou e-mail (le mot de passe est exigé pour l'e-mail, qui sert à se connecter). */
  async update(patch: { prenom?: unknown; nom?: unknown; email?: unknown }, password?: unknown): Promise<Profile> {
    const a = this.account(); if (!a) throw new Error('Aucun compte.');
    const prenom = patch.prenom === undefined ? a.prenom : cleanName(patch.prenom), nom = patch.nom === undefined ? a.nom : cleanName(patch.nom);
    const email = patch.email === undefined ? a.email : String(patch.email).trim().toLowerCase();
    if (prenom.length < 1 || prenom.length > 60 || nom.length < 1 || nom.length > 60) throw new Error('Prénom et nom obligatoires.');
    if (!validEmail(email)) throw new Error('Cette adresse e-mail n\'a pas la bonne forme.');
    if (email !== a.email && !(await this.check(String(password ?? ''), a.pass))) throw new Error('Mot de passe incorrect : il est demandé pour changer l\'adresse e-mail.');
    Object.assign(a, { prenom, nom, email, changed: new Date(this.now()).toISOString() });
    this.write(this.file, a);
    return this.profile()!;
  }

  // ---------------- Sessions
  private load(): StoredSession[] {
    if (this.cache && this.now() - this.cache.at < 2000) return this.cache.list;
    let list: StoredSession[] = [];
    try { list = JSON.parse(readFileSync(this.sessFile, 'utf8')) as StoredSession[]; } catch { /* aucune session */ }
    const t = this.now();
    const alive = (Array.isArray(list) ? list : []).filter((s) => s && typeof s.h === 'string' && t - s.seen < SESSION_IDLE_MS && t - s.created < SESSION_MAX_MS);
    this.cache = { at: t, list: alive };
    return alive;
  }
  private save(list: StoredSession[]): void { this.cache = { at: this.now(), list }; try { this.write(this.sessFile, list); } catch { /* dossier en lecture seule : la session vit en mémoire */ } }

  /** Ouvre une session et renvoie son identifiant secret (à mettre dans le cookie, jamais ailleurs). */
  open(meta: { device: string; ip: string; via: Via }): string {
    const token = randomBytes(32).toString('base64url'), t = this.now();
    const list = [...this.load(), { h: sha(token), created: t, seen: t, device: meta.device.slice(0, 80), ip: meta.ip.slice(0, 60), via: meta.via }];
    this.save(list.sort((a, b) => b.seen - a.seen).slice(0, MAX_SESSIONS));
    return token;
  }
  /** La session de ce cookie est-elle valable ? (met à jour « vu pour la dernière fois », au plus toutes les 5 min) */
  valid(token: string | undefined): boolean {
    if (!token || token.length !== 43 || !this.exists()) return false;
    const h = Buffer.from(sha(token)), list = this.load();
    const s = list.find((x) => { const b = Buffer.from(x.h); return b.length === h.length && timingSafeEqual(b, h); });
    if (!s) return false;
    if (this.now() - s.seen > 5 * 60_000) { s.seen = this.now(); this.save(list); }
    return true;
  }
  close(token: string | undefined): void { if (!token) return; const h = sha(token); this.save(this.load().filter((s) => s.h !== h)); }
  /** Ferme une session par son identifiant public (les 12 premiers caractères de son empreinte). */
  revoke(id: string): boolean { const list = this.load(), next = list.filter((s) => s.h.slice(0, 12) !== id); this.save(next); return next.length !== list.length; }
  revokeOthers(keepToken?: string): number { const list = this.load(), h = keepToken ? sha(keepToken) : ''; const next = list.filter((s) => s.h === h); this.save(next); return list.length - next.length; }
  sessions(currentToken?: string): SessionInfo[] {
    const h = currentToken ? sha(currentToken) : '';
    return this.load().map((s) => ({ id: s.h.slice(0, 12), created: s.created, seen: s.seen, expires: Math.min(s.seen + SESSION_IDLE_MS, s.created + SESSION_MAX_MS), device: s.device, ip: s.ip, via: s.via, current: s.h === h })).sort((a, b) => Number(b.current) - Number(a.current) || b.seen - a.seen);
  }

  /** Efface le compte et toutes les sessions (commande « odin compte oublier », sur la machine d'Odin seulement). */
  reset(): void { rmSync(this.file, { force: true }); rmSync(this.sessFile, { force: true }); this.cache = undefined; this.fails = 0; this.lockedUntil = 0; }
}

/** Cookie de session : invisible pour les scripts, jamais envoyé depuis un autre site. */
export const sessionCookie = (token: string, secure: boolean) => `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${Math.round(SESSION_MAX_MS / 1000)}${secure ? '; Secure' : ''}`;
export const clearSessionCookie = (secure: boolean) => `${SESSION_COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secure ? '; Secure' : ''}`;
