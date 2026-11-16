// Écho · historique des conversations traduites : TEXTE seulement (jamais le son), chiffré avec la clé de la machine.
// Seuls la date et l'identifiant de la conversation sont en clair. Rangé dans la base de l'appli (schéma
// « conversation » de ECHO_ODIN) dès qu'elle est prête ; avant, dans conversation.jsonl (mode 0o600), qui passe dans
// la base au premier branchement. Aucune vue pour odin_lecture : c'est privé.
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { BaseAttente, quandBase, type AppliBase, type DefAppli } from '../base/index.ts';
import { chiffrerChamp, dechiffrerChamp } from '../../vault.ts';
import { exporterTexte, type Langue, type Qui } from './conversation.ts';

export const DEF_CONVERSATION: DefAppli = {
  id: 'rodd_conversation', schema: 'conversation', appli: 'rodd',
  migrations: [{
    v: 1, nom: 'conversations traduites (texte chiffré)',
    sql: `CREATE TABLE tours (uid text PRIMARY KEY, conv text NOT NULL, quand timestamptz NOT NULL, chiffre text NOT NULL);
CREATE INDEX tours_quand ON tours (quand)`,
  }],
  ecritures: {
    ajout: 'INSERT INTO tours (uid, conv, quand, chiffre) VALUES ($1, $2, $3, $4) ON CONFLICT (uid) DO NOTHING',
    remplacer: 'UPDATE tours SET chiffre = $2 WHERE uid = $1',
    effacer_conv: 'DELETE FROM tours WHERE conv = $1',
    effacer_tout: 'DELETE FROM tours',
  },
};

/** Ce qui est chiffré d'un tour. */
export interface ContenuTour { qui: Qui; de: Langue; vers: Langue; entendu: string; traduit: string; corrige?: boolean }
export interface TourGarde extends ContenuTour { id: string; conv: string; at: string }
interface Ligne { uid: string; conv: string; at: string; chiffre: string }

const GARDER = 500;
const ID = /^[A-Za-z0-9_-]{1,64}$/;
export const idValide = (x: unknown): x is string => typeof x === 'string' && ID.test(x);
export const nouvelId = () => `${Date.now().toString(36)}-${randomBytes(5).toString('hex')}`;

export class HistoriqueConversation {
  private home: string; private fichier: string; private dossier: string;
  private memo: Ligne[] = [];
  private appli?: AppliBase;
  private off?: () => void;
  constructor(home: string, dir: string) {
    this.home = home; this.dossier = join(dir, 'conversation'); this.fichier = join(dir, 'conversation.jsonl');
    this.memo = this.lireFichier().slice(-GARDER);
    this.off = quandBase((b) => {
      const a = b.appli(DEF_CONVERSATION, this.dossier); this.appli = a;
      const pret = () => void this.brancher().catch((e) => { if (!(e instanceof BaseAttente)) console.error(`[base] conversations d'Écho : ${(e as Error).message}`); });
      a.on('prete', pret); if (a.prete) pret();
    });
  }
  /** où vit l'historique */
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
  /** La base est prête : les 500 derniers tours sont relus, puis le fichier de repli y passe et disparaît. */
  private async brancher(): Promise<void> {
    const a = this.appli!; const l = this.lireFichier();
    if (l.length) { a.ecrire(...l.map((x): [string, string, string, string, string] => ['ajout', x.uid, x.conv, x.at, x.chiffre])); }
    await a.vider();
    if (l.length) rmSync(this.fichier, { force: true });
    const r = await a.q('SELECT uid, conv, quand, chiffre FROM tours ORDER BY quand DESC LIMIT $1', [GARDER]);
    const lus = r.rows.reverse().map(([uid, conv, quand, chiffre]) => ({ uid: uid!, conv: conv!, at: new Date(quand!).toISOString(), chiffre: chiffre! }));
    const vus = new Set(lus.map((x) => x.uid));
    this.memo = [...lus, ...this.memo.filter((x) => !vus.has(x.uid))].slice(-GARDER);
  }

  /** Ajoute un tour (chiffré). Rend son identifiant. */
  ajouter(t: ContenuTour & { id?: string; conv: string; at?: string }): string {
    const x: Ligne = { uid: idValide(t.id) ? t.id : nouvelId(), conv: idValide(t.conv) ? t.conv : 'sans-id', at: t.at ?? new Date().toISOString(), chiffre: this.sceller(t) };
    if (this.memo.some((m) => m.uid === x.uid)) { this.remplacer(x.uid, t); return x.uid; }
    this.memo.push(x); if (this.memo.length > GARDER * 1.5) this.memo = this.memo.slice(-GARDER);
    if (this.appli) this.appli.ecrire(['ajout', x.uid, x.conv, x.at, x.chiffre]);
    else { mkdirSync(join(this.fichier, '..'), { recursive: true, mode: 0o700 }); appendFileSync(this.fichier, `${JSON.stringify(x)}\n`, { mode: 0o600 }); }
    return x.uid;
  }
  /** Remplace le contenu d'un tour (texte corrigé, suite ajoutée). Faux s'il n'existe pas. */
  remplacer(uid: string, t: ContenuTour): boolean {
    const m = this.memo.find((x) => x.uid === uid); if (!m) return false;
    m.chiffre = this.sceller(t);
    if (this.appli) this.appli.ecrire(['remplacer', uid, m.chiffre]);
    else this.reecrireFichier(this.lireFichier().map((x) => (x.uid === uid ? { ...x, chiffre: m.chiffre } : x)));
    return true;
  }
  /** Les derniers tours, déchiffrés (le plus récent d'abord). */
  lister(n = 100, conv?: string): TourGarde[] {
    const l = this.memo.filter((x) => !conv || x.conv === conv).slice(-Math.max(1, Math.min(GARDER, n))).reverse();
    return l.flatMap((x) => { const c = this.ouvrir(x.chiffre); return c ? [{ id: x.uid, conv: x.conv, at: x.at, ...c }] : []; });
  }
  /** Les conversations (début, nombre de tours), la plus récente d'abord. */
  conversations(): Array<{ conv: string; debut: string; n: number }> {
    const m = new Map<string, { conv: string; debut: string; n: number; fin: string }>();
    for (const x of this.memo) { const c = m.get(x.conv); if (c) { c.n++; if (x.at < c.debut) c.debut = x.at; if (x.at > c.fin) c.fin = x.at; } else m.set(x.conv, { conv: x.conv, debut: x.at, n: 1, fin: x.at }); }
    return [...m.values()].sort((a, b) => b.fin.localeCompare(a.fin)).map(({ conv, debut, n }) => ({ conv, debut, n }));
  }
  /** Efface une conversation, ou tout (mémoire, fichier de repli et base). Rend le nombre de tours effacés. */
  effacer(conv?: string): number {
    const avant = this.memo.length;
    this.memo = conv ? this.memo.filter((x) => x.conv !== conv) : [];
    const f = this.lireFichier(); this.reecrireFichier(conv ? f.filter((x) => x.conv !== conv) : []);
    if (this.appli) this.appli.ecrire(conv ? ['effacer_conv', conv] : ['effacer_tout']);
    return avant - this.memo.length;
  }
  /** Une conversation (ou les dernières) en texte, du plus ancien au plus récent. */
  exporter(conv?: string): { nom: string; texte: string } {
    const l = this.lister(GARDER, conv);
    const d = l.length ? new Date(l[l.length - 1].at) : new Date();
    const jour = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const premier = l[l.length - 1], paire = premier ? (premier.qui === 'moi' ? { moi: premier.de, lui: premier.vers } : { moi: premier.vers, lui: premier.de }) : undefined;
    return { nom: `conversation-${jour}.txt`, texte: l.length ? exporterTexte(l, paire) : 'Aucune conversation gardée.\n' };
  }

  private sceller(t: ContenuTour): string {
    return chiffrerChamp(this.home, JSON.stringify({ qui: t.qui, de: t.de, vers: t.vers, entendu: t.entendu, traduit: t.traduit, ...(t.corrige ? { corrige: true } : {}) }));
  }
  private ouvrir(c: string): ContenuTour | undefined { try { return JSON.parse(dechiffrerChamp(this.home, c)) as ContenuTour; } catch { return undefined; } }
}

/** L'historique d'un contexte d'appli (un par contexte, comme journalDe). */
const parCtx = new WeakMap<object, HistoriqueConversation>();
export function historiqueDe(ctx: { home: string; dir: string }): HistoriqueConversation {
  let h = parCtx.get(ctx); if (!h) { mkdirSync(ctx.dir, { recursive: true, mode: 0o700 }); h = new HistoriqueConversation(ctx.home, ctx.dir); parCtx.set(ctx, h); }
  return h;
}
/** Faut-il garder ce tour ? Jamais si « garder » est décoché ou si le mode privé de la voix est actif. */
export const garderTours = (reglages: { garder: boolean }, privateMode: boolean | undefined) => reglages.garder && !privateMode;
// (existsSync gardé pour les essais qui vérifient le fichier de repli)
export const fichierRepli = (dir: string) => { const f = join(dir, 'conversation.jsonl'); return existsSync(f) ? f : undefined; };
