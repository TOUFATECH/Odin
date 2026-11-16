// Écho · DICTÉES gardées, pour qu'Odin « se souvienne de ces paroles ». Le texte d'une dictée mise en forme est gardé
// CHIFFRÉ avec la clé de la machine (comme les conversations), dans ECHO_ODIN (schéma « dictee ») ; repli fichier
// 0o600 avant la base. La mémoire d'Odin (src/muninn), elle, est EN CLAIR sur le disque : on n'y met donc JAMAIS le
// texte d'une dictée (une dictée peut être privée), mais seulement un REPÈRE NEUTRE — la date, la mise en forme,
// l'identifiant. Odin se souvient ainsi « d'une dictée corrigée du 16 novembre » et retrouve le texte chiffré sur
// demande, sans qu'un mot privé ne traîne en clair.
//
// Rétention : rien ne s'efface tout seul. Le propriétaire peut supprimer une dictée (ou toutes) ; la suppression
// efface EN CASCADE le texte chiffré ET le repère en mémoire, comme pour les conversations (oublierConversation).
// On réutilise les patrons existants : le magasin chiffré ressemble à ResumeConversation ; la mémoire reprend
// brancherMemoire / HooksMemoire de conversation-memoire.ts.
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { BaseAttente, quandBase, type AppliBase, type DefAppli } from '../base/index.ts';
import { chiffrerChamp, dechiffrerChamp } from '../../vault.ts';

export const DEF_DICTEE: DefAppli = {
  id: 'rodd_dictee', schema: 'dictee', appli: 'rodd',
  migrations: [{
    v: 1, nom: 'dictées gardées (texte chiffré)',
    sql: `CREATE TABLE dictees (uid text PRIMARY KEY, quand timestamptz NOT NULL, mode text NOT NULL, chiffre text NOT NULL);
CREATE INDEX dictees_quand ON dictees (quand)`,
  }],
  ecritures: {
    ajout: 'INSERT INTO dictees (uid, quand, mode, chiffre) VALUES ($1, $2, $3, $4) ON CONFLICT (uid) DO NOTHING',
    effacer_une: 'DELETE FROM dictees WHERE uid = $1',
    effacer_tout: 'DELETE FROM dictees',
  },
};

/** Ce qui est chiffré d'une dictée. */
export interface ContenuDictee { texte: string; brut: string; ou: string; langue?: string }
export interface DicteeGardee extends ContenuDictee { id: string; at: string; mode: string }
interface Ligne { uid: string; at: string; mode: string; chiffre: string }

const GARDER = 1000;
const ID = /^[A-Za-z0-9_-]{1,64}$/;
export const idValide = (x: unknown): x is string => typeof x === 'string' && ID.test(x);
export const nouvelId = () => `${Date.now().toString(36)}-${randomBytes(5).toString('hex')}`;

export class DicteeArchive {
  private home: string; private dossier: string; private fichier: string;
  private memo: Ligne[] = [];
  private appli?: AppliBase;
  private off?: () => void;
  constructor(home: string, dir: string) {
    this.home = home; this.dossier = join(dir, 'dictee'); this.fichier = join(dir, 'dictee.jsonl');
    this.memo = this.lireFichier().slice(-GARDER);
    this.off = quandBase((b) => {
      const a = b.appli(DEF_DICTEE, this.dossier); this.appli = a;
      const pret = () => void this.brancher().catch((e) => { if (!(e instanceof BaseAttente)) console.error(`[base] dictées d'Écho : ${(e as Error).message}`); });
      a.on('prete', pret); if (a.prete) pret();
    });
  }
  get support(): 'fichiers' | 'base' { return this.appli ? 'base' : 'fichiers'; }
  fermer(): void { this.off?.(); this.off = undefined; }

  private lireFichier(): Ligne[] {
    try { return readFileSync(this.fichier, 'utf8').split('\n').filter(Boolean).flatMap((l) => { try { const x = JSON.parse(l) as Ligne; return x && typeof x.chiffre === 'string' ? [x] : []; } catch { return []; } }); } catch { return []; }
  }
  private reecrireFichier(l: Ligne[]): void {
    if (!l.length) { rmSync(this.fichier, { force: true }); return; }
    mkdirSync(join(this.fichier, '..'), { recursive: true, mode: 0o700 }); const t = `${this.fichier}.tmp`;
    writeFileSync(t, `${l.map((x) => JSON.stringify(x)).join('\n')}\n`, { mode: 0o600 }); renameSync(t, this.fichier);
  }
  private async brancher(): Promise<void> {
    const a = this.appli!; const l = this.lireFichier();
    if (l.length) a.ecrire(...l.map((x): [string, string, string, string, string] => ['ajout', x.uid, x.at, x.mode, x.chiffre]));
    await a.vider();
    if (l.length && existsSync(this.fichier)) rmSync(this.fichier, { force: true });
    const r = await a.q('SELECT uid, quand, mode, chiffre FROM dictees ORDER BY quand DESC LIMIT $1', [GARDER]);
    const lus = r.rows.reverse().map(([uid, quand, mode, chiffre]) => ({ uid: uid!, at: new Date(quand!).toISOString(), mode: mode!, chiffre: chiffre! }));
    const vus = new Set(lus.map((x) => x.uid));
    this.memo = [...lus, ...this.memo.filter((x) => !vus.has(x.uid))].slice(-GARDER);
  }

  /** Garde une dictée (chiffrée). Rend son identifiant. */
  ajouter(d: ContenuDictee & { id?: string; at?: string; mode: string }): string {
    const uid = idValide(d.id) ? d.id : nouvelId();
    const x: Ligne = { uid, at: d.at ?? new Date().toISOString(), mode: String(d.mode || '').slice(0, 20), chiffre: this.sceller(d) };
    if (this.memo.some((m) => m.uid === uid)) return uid;
    this.memo.push(x); if (this.memo.length > GARDER * 1.5) this.memo = this.memo.slice(-GARDER);
    if (this.appli) this.appli.ecrire(['ajout', x.uid, x.at, x.mode, x.chiffre]);
    else { mkdirSync(join(this.fichier, '..'), { recursive: true, mode: 0o700 }); writeFileSync(this.fichier, `${[...this.lireFichier(), x].map((y) => JSON.stringify(y)).join('\n')}\n`, { mode: 0o600 }); }
    return uid;
  }
  /** Les dernières dictées gardées, déchiffrées (la plus récente d'abord). Pour le propriétaire seul. */
  lister(n = 100): DicteeGardee[] {
    const l = this.memo.slice(-Math.max(1, Math.min(GARDER, n))).reverse();
    return l.flatMap((x) => { const c = this.ouvrir(x.chiffre); return c ? [{ id: x.uid, at: x.at, mode: x.mode, ...c }] : []; });
  }
  /** Combien de dictées gardées (sans déchiffrer). */
  compte(): number { return this.memo.length; }
  /** Efface une dictée, ou toutes (mémoire, fichier de repli et base). Rend le nombre effacé. */
  effacer(id?: string): number {
    const avant = this.memo.length;
    this.memo = id ? this.memo.filter((x) => x.uid !== id) : [];
    const f = this.lireFichier(); this.reecrireFichier(id ? f.filter((x) => x.uid !== id) : []);
    if (this.appli) this.appli.ecrire(id ? ['effacer_une', id] : ['effacer_tout']);
    return avant - this.memo.length;
  }

  private sceller(d: ContenuDictee): string {
    return chiffrerChamp(this.home, JSON.stringify({ texte: d.texte, brut: d.brut, ou: d.ou, ...(d.langue ? { langue: d.langue } : {}) }));
  }
  private ouvrir(c: string): ContenuDictee | undefined { try { return JSON.parse(dechiffrerChamp(this.home, c)) as ContenuDictee; } catch { return undefined; } }
}

/** L'archive des dictées d'un contexte d'appli (une par contexte, comme historiqueDe). */
const parCtx = new WeakMap<object, DicteeArchive>();
export function dicteeArchiveDe(ctx: { home: string; dir: string }): DicteeArchive {
  let a = parCtx.get(ctx); if (!a) { mkdirSync(ctx.dir, { recursive: true, mode: 0o700 }); a = new DicteeArchive(ctx.home, ctx.dir); parCtx.set(ctx, a); }
  return a;
}

// ---------------- Le pont vers la mémoire d'Odin (repère neutre, jamais le texte) ----------------

/** Ce qui entre en mémoire : un repère neutre, jamais le texte d'une dictée. */
export interface PointeurDictee { dic: string; mode: string; date: string }
export interface HooksMemoireDictee { noter(p: PointeurDictee): void; oublier(dic: string): void }

let hooks: HooksMemoireDictee | undefined;
/** Branche (ou débranche) la mémoire d'Odin pour les dictées. Appelé une fois au démarrage (odin.ts). */
export function brancherMemoireDictee(h: HooksMemoireDictee | undefined): void { hooks = h; }

/** Un titre neutre : « Dictée corrigée du 2026-11-16 » — aucune parole, juste la date et la mise en forme. */
export function titreDictee(p: Pick<PointeurDictee, 'date' | 'mode'>): string {
  const jour = (p.date || new Date().toISOString()).slice(0, 10);
  const m = p.mode && p.mode !== 'tel quel' ? ` (${p.mode})` : '';
  return `Dictée du ${jour}${m}`;
}
/** Range le repère neutre d'une dictée dans la mémoire d'Odin. */
export function noterDictee(p: PointeurDictee): void {
  if (!idValide(p.dic) || !hooks) return;
  hooks.noter({ dic: p.dic, mode: String(p.mode || '').slice(0, 20), date: p.date });
}
/** Retire le repère d'une dictée (suppression). */
export function oublierDictee(dic: string): void {
  if (!idValide(dic) || !hooks) return;
  hooks.oublier(dic);
}

/** Faut-il garder cette dictée ? Jamais si l'historique est décoché, ni si rien n'a été transcrit. */
export const garderDictees = (reglages: { historique?: unknown }, texte: string) => reglages.historique !== false && Boolean(texte.trim());

/** Garde une dictée (texte chiffré dans ECHO_ODIN) ET note son repère neutre en mémoire. Un seul point d'entrée. */
export function rangerDictee(ctx: { home: string; dir: string; settings: Record<string, unknown> }, d: ContenuDictee & { mode: string; at?: string }): string | undefined {
  if (!garderDictees(ctx.settings, d.texte)) return undefined;
  const at = d.at ?? new Date().toISOString();
  const id = dicteeArchiveDe(ctx).ajouter({ ...d, at });
  noterDictee({ dic: id, mode: d.mode, date: at });
  return id;
}
