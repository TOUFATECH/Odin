// La base d'Odin — le journal d'attente : chaque écriture d'une appli y est notée d'abord (ajout à la fin du fichier
// + fsync : elle survit à un arrêt brutal), puis part dans la base. Base arrêtée ou pas encore prête : les écritures
// s'y accumulent et partent dès qu'elle revient. Rien n'est perdu.
// Règle : chaque écriture est REJOUABLE (un upsert, un « ajoute si absent »…) : si Odin s'arrête entre l'envoi et
// le nettoyage du journal, la rejouer ne double rien.
import { appendFileSync, closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync, writeSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Valeur } from './pool.ts';

export interface Ligne { k: string; p: Valeur[] }

export class Attente {
  readonly fichier: string;
  private l: Ligne[] = [];
  constructor(fichier: string) {
    this.fichier = fichier;
    if (existsSync(fichier)) for (const x of readFileSync(fichier, 'utf8').split('\n')) {
      if (!x.trim()) continue;
      try { const o = JSON.parse(x) as Ligne; if (typeof o.k === 'string' && Array.isArray(o.p)) this.l.push(o); } catch { /* ligne coupée par un arrêt brutal : elle n'a jamais été confirmée */ }
    }
  }
  get taille(): number { return this.l.length; }
  lignes(): readonly Ligne[] { return this.l; }
  /** Note des écritures (d'un coup, sur le disque, avant de rendre la main). */
  ajouter(...ls: Ligne[]): void {
    if (!ls.length) return;
    mkdirSync(dirname(this.fichier), { recursive: true, mode: 0o700 });
    const fd = openSync(this.fichier, 'a', 0o600);
    try { writeSync(fd, ls.map((x) => JSON.stringify(x)).join('\n') + '\n'); fsyncSync(fd); } finally { closeSync(fd); }
    this.l.push(...ls);
  }
  /** Envoie les écritures notées (dans l'ordre) ; seules celles qui sont parties sont retirées du journal. */
  async vider(envoyer: (ls: readonly Ligne[]) => Promise<void>): Promise<number> {
    const n = this.l.length; if (!n) return 0;
    await envoyer(this.l.slice(0, n));
    this.l = this.l.slice(n);
    if (!this.l.length) rmSync(this.fichier, { force: true });
    else { const t = `${this.fichier}.tmp`; writeFileSync(t, this.l.map((x) => JSON.stringify(x)).join('\n') + '\n', { mode: 0o600 }); renameSync(t, this.fichier); }
    return n;
  }
  /** Une écriture que la base refuse (requête fausse) : mise de côté, pour ne pas bloquer les suivantes. */
  rejeter(x: Ligne, raison: string): void { appendFileSync(`${this.fichier.replace(/\.jsonl$/, '')}.rejets.jsonl`, JSON.stringify({ ...x, raison }) + '\n', { mode: 0o600 }); }
}
