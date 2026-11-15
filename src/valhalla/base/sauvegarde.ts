// La base d'Odin — sauvegardes : pg_dump de la base de CHAQUE appli (PEGASE_ODIN, PERSONA_ODIN… : le nom passe tel quel
// au programme, la casse est gardée), au format PostgreSQL, relu par pg_restore --list, puis
// CHIFFRÉ avec le même format que les sauvegardes d'Odin (AES-256-GCM, clé dérivée par scrypt ; clé générée, rangée dans
// les secrets d'Alexandrie et le coffre). Chaque nuit ; gardées 7 jours, 4 semaines et 3 mois (la règle d'Arche).
// Restauration : dans une NOUVELLE base à côté (<base>_RESTAUREE_<date>), jamais par-dessus sans ton accord.
// Le mot de passe passe par un fichier temporaire protégé (jamais sur la ligne de commande).
import { randomBytes } from 'node:crypto';
import { chmodSync, chownSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { decryptBackup, encryptBackup } from '../../backup.ts';
import { dirOf, password, setPassword } from '../urdr/bases.ts';
import { keep } from '../skuld/dump.ts';
import type { BaseOdin } from './index.ts';
import { lancer, motDePasseAdmin, programmes, type Cible } from './serveur.ts';

export const SECRET_SAUVEGARDES = 'odin-sauvegardes';
export const dossierSauvegardes = (home: string) => join(dirOf(home), 'sauvegardes', 'odin');
export interface Sauvegarde { fichier: string; date: string; octets: number; base: string }

/** La clé des sauvegardes (créée une fois). `nouvelle` : vrai si elle vient d'être créée (à ranger dans le coffre). */
export function cleSauvegardes(home: string): { cle: string; nouvelle: boolean } {
  const k = password(home, SECRET_SAUVEGARDES); if (k) return { cle: k, nouvelle: false };
  const cle = randomBytes(32).toString('base64url'); setPassword(home, SECRET_SAUVEGARDES, cle); return { cle, nouvelle: true };
}
export function sauvegardes(home: string): Sauvegarde[] {
  const d = dossierSauvegardes(home);
  // Nom du fichier : <base>-<AAAAMMJJ>-<HHMMSS>.dump.odinbk (« odin-… » : l'ancienne base commune)
  try {
    return readdirSync(d).flatMap((f) => { const m = /^([A-Za-z0-9_]+)-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})\.dump\.odinbk$/.exec(f); return m ? [{ fichier: join(d, f), base: m[1], date: `${m[2]}-${m[3]}-${m[4]}T${m[5]}:${m[6]}:${m[7]}Z`, octets: statSync(join(d, f)).size }] : []; })
      .sort((a, b) => b.date.localeCompare(a.date) || a.base.localeCompare(b.base));
  } catch { return []; }
}

/** Un programme PostgreSQL (pg_dump, pg_restore, createdb) : celui du serveur à Odin, de la machine, ou du conteneur. */
async function outil(home: string, c: Cible, nom: string, args: string[], o: { sortie?: string } = {}): Promise<string> {
  const pw = motDePasseAdmin(home) ?? '';
  const tmp = mkdtempSync(join(tmpdir(), 'odin-base-')); chmodSync(tmp, 0o700);
  try {
    const pass = join(tmp, 'pgpass'); writeFileSync(pass, `*:*:*:*:${pw.replace(/[\\:]/g, '\\$&')}\n`, { mode: 0o600 });
    let cmd: string, argv: string[], env: Record<string, string> = { PGPASSFILE: pass, PGSSLMODE: 'disable', PGCONNECT_TIMEOUT: '15' }, sous: string | undefined;
    if (c.mode === 'hringhorni') {
      const { engine } = await import('../modules/naglfar.ts');
      const x = await engine().execArgs(c.conteneur ?? 'odin-pg', [nom, '-U', c.admin, ...args]); cmd = x.cmd; argv = x.args; env = { ...env, ...x.env };
    } else {
      const bin = c.bin ?? programmes(); cmd = bin && existsSync(join(bin, nom)) ? join(bin, nom) : nom;
      argv = ['-h', c.hote, '-p', String(c.port), '-U', c.admin, ...args];
      // En root, le programme tourne sous le compte du serveur (il doit pouvoir lire le fichier du mot de passe).
      if (process.getuid?.() === 0 && c.sous) { sous = c.sous; const [u, g] = idDe(c.sous); chownSync(tmp, u, g); chownSync(pass, u, g); if (o.sortie) chownSync(join(o.sortie, '..'), u, g); }
    }
    const r = await lancer(cmd, argv, { env, sous, ms: 6 * 3600_000 });
    if (r.code !== 0) throw new Error(`${nom} : ${r.sortie.split('\n').slice(-3).join(' ') || `code ${r.code}`}`);
    return r.sortie;
  } finally { rmSync(tmp, { recursive: true, force: true }); }
}
function idDe(n: string): [number, number] { const l = readFileSync('/etc/passwd', 'utf8').split('\n').find((x) => x.startsWith(`${n}:`))?.split(':'); return l ? [Number(l[2]), Number(l[3])] : [0, 0]; }
const horodatage = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);

/** Sauvegarde chiffrée de la base de chaque appli, relue avant d'être gardée (le total, et la dernière écrite). */
export async function sauvegarder(b: BaseOdin, now = new Date()): Promise<Sauvegarde & { elements: number; bases: string[] }> {
  const noms = b.basesDesApplis(); if (!noms.length) throw new Error('aucune appli n\'a encore de base : rien à sauvegarder');
  let elements = 0, octets = 0, der: Sauvegarde | undefined;
  for (const nom of noms) { const r = await sauvegarderUne(b, nom, now); elements += r.elements; octets += r.octets; der = r; }
  return { ...der!, octets, elements, bases: noms };
}
async function sauvegarderUne(b: BaseOdin, base: string, now: Date): Promise<Sauvegarde & { elements: number }> {
  const c = b.cible; if (!c || b.etat !== 'prete') throw new Error('la base d\'Odin n\'est pas prête : sauvegarde remise à plus tard');
  const d = dossierSauvegardes(b.home); mkdirSync(d, { recursive: true, mode: 0o700 });
  const tmp = mkdtempSync(join(tmpdir(), 'odin-dump-')); chmodSync(tmp, 0o700);
  try {
    const brut = join(tmp, 'odin.dump');
    if (c.mode === 'hringhorni') throw new Error('sauvegarde chiffrée du conteneur odin-pg : passe par Arche (plan de la base « odin-pg »)');
    await outil(b.home, c, 'pg_dump', ['-Fc', '-d', base, '-f', brut], { sortie: brut });
    // Relue : pg_restore doit lister son contenu.
    const liste = await outil(b.home, c, 'pg_restore', ['--list', brut], { sortie: brut });
    const elements = liste.split('\n').filter((l) => /^\d+;/.test(l)).length;
    if (!elements) throw new Error('sauvegarde vide ou illisible');
    const f = join(d, `${base}-${horodatage(now)}.dump.odinbk`), t = `${f}.tmp`;
    writeFileSync(t, encryptBackup(readFileSync(brut), cleSauvegardes(b.home).cle), { mode: 0o600 }); renameSync(t, f);
    // Durée de garde (la règle d'Arche) : 7 jours, 4 semaines, 3 mois ; jamais sans la dernière.
    const l = sauvegardes(b.home).filter((x) => x.base === base), k = keep(l.map((x) => x.date), { jours: 7, semaines: 4, mois: 3 }, now);
    for (const x of l) if (!k.has(x.date)) rmSync(x.fichier, { force: true });
    return { fichier: f, base, date: now.toISOString(), octets: statSync(f).size, elements };
  } finally { rmSync(tmp, { recursive: true, force: true }); }
}

/** Restaure une sauvegarde dans une NOUVELLE base à côté (rend son nom) ; la base sauvegardée n'est pas touchée. */
export async function restaurerACote(b: BaseOdin, fichier: string, now = new Date()): Promise<string> {
  const c = b.cible; if (!c || b.etat !== 'prete') throw new Error('la base d\'Odin n\'est pas prête');
  const de = sauvegardes(b.home).find((x) => x.fichier === fichier)?.base ?? 'odin';
  const nom = `${de.toUpperCase()}_RESTAUREE_${horodatage(now).replace('-', '_')}`.slice(0, 63);
  const tmp = mkdtempSync(join(tmpdir(), 'odin-rest-')); chmodSync(tmp, 0o755);
  try {
    const brut = join(tmp, 'odin.dump'); writeFileSync(brut, decryptBackup(readFileSync(fichier), cleSauvegardes(b.home).cle), { mode: 0o644 });
    await outil(b.home, c, 'createdb', [nom]);
    await outil(b.home, c, 'pg_restore', ['--no-owner', '--no-privileges', '-d', nom, brut]);
    return nom;
  } finally { rmSync(tmp, { recursive: true, force: true }); }
}
