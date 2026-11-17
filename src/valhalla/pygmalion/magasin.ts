// Pygmalion — le registre des créations : base PYGMALION_ODIN dans Alexandrie (contenu chiffré, compteurs seuls lisibles
// par odin_lecture), et repli en fichier CHIFFRÉ (clé de la machine) qui fait foi tant que la base n'est pas prête.
// Borné, écrit de façon atomique, avec une copie de secours ; un fichier illisible ou posé en clair est mis de côté et
// signalé, jamais écrasé en silence.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { champChiffre, chiffrerChamp, dechiffrerChamp } from '../../vault.ts';
import { nomBase } from '../base/noms.ts';
import { BaseAttente, inscrireMigrable, quandBase, type AppliBase, type DefAppli } from '../base/index.ts';
import { BORNES, type Creation } from './types.ts';

export const nomBasePygmalion = (): string => nomBase('pygmalion', 'Pygmalion');

export const DEF_PYGMALION: DefAppli = {
  id: 'pygmalion', schema: 'pygmalion', appli: 'pygmalion',
  migrations: [{
    v: 1, nom: 'registre des créations d\'Odin (contenu chiffré)',
    sql: `
CREATE TABLE creations (id text PRIMARY KEY, format text NOT NULL, contenu text NOT NULL, quand bigint NOT NULL, octets bigint NOT NULL);
CREATE INDEX creations_quand ON creations (quand);
-- odin_lecture ne voit que des compteurs (jamais un titre, une source ni un chemin).
CREATE VIEW v_compteurs AS SELECT format, count(*) AS nombre, sum(octets) AS octets FROM creations GROUP BY format;
GRANT SELECT ON v_compteurs TO odin_lecture`,
  }],
  ecritures: {
    creation_pose: 'INSERT INTO creations (id, format, contenu, quand, octets) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (id) DO UPDATE SET contenu = EXCLUDED.contenu',
    creation_retire: 'DELETE FROM creations WHERE id = $1',
  },
};

export interface Miroir { ecrire(...ls: Array<[k: string, ...p: Array<string | number | null>]>): void }

interface Etat { v: 1; creations: Creation[] }

export class Registre {
  readonly fichier: string;
  private readonly home: string;
  private etat: Etat = { v: 1, creations: [] };
  private miroir?: Miroir;
  /** le fichier était illisible au démarrage : la phrase à montrer */
  readonly illisible?: string;
  constructor(home: string, dir: string) {
    this.home = home;
    mkdirSync(dir, { recursive: true });
    this.fichier = join(dir, 'creations.json');
    if (existsSync(this.fichier)) {
      const lu = this.lire(this.fichier) ?? (existsSync(`${this.fichier}.secours`) ? this.lire(`${this.fichier}.secours`) : undefined);
      if (!this.lire(this.fichier)) {
        const cote = `${this.fichier}.illisible-${new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14)}`;
        try { renameSync(this.fichier, cote); } catch { /* best effort */ }
        this.illisible = `Le registre des créations était illisible (abîmé ou non chiffré) : mis de côté (${basename(cote)})${lu ? ', copie de secours reprise' : ''}.`;
      }
      if (lu) this.etat = lu;
    }
  }
  private lire(f: string): Etat | undefined {
    try { const t = readFileSync(f, 'utf8'); if (!champChiffre(t)) return undefined; const e = JSON.parse(dechiffrerChamp(this.home, t)) as Etat; return e && e.v === 1 && Array.isArray(e.creations) ? e : undefined; } catch { return undefined; }
  }
  brancherMiroir(m: Miroir): void { this.miroir = m; }
  private sauver(): void {
    if (this.etat.creations.length > BORNES.registre) this.etat.creations = this.etat.creations.slice(-BORNES.registre);
    const tmp = `${this.fichier}.tmp`;
    writeFileSync(tmp, chiffrerChamp(this.home, JSON.stringify(this.etat)), { mode: 0o600 });
    try { if (existsSync(this.fichier)) renameSync(this.fichier, `${this.fichier}.secours`); } catch { /* best effort */ }
    renameSync(tmp, this.fichier);
  }
  ajouter(c: Creation): void {
    this.etat.creations.push(c);
    this.sauver();
    if (this.miroir) { try { this.miroir.ecrire(['creation_pose', c.id, c.format, chiffrerChamp(this.home, JSON.stringify(c)), Date.parse(c.quand), c.octets]); } catch { /* le fichier fait foi */ } }
  }
  liste(): Creation[] { return this.etat.creations.map((c) => ({ ...c, sources: c.sources.map((s) => ({ ...s })) })); }
  /**
   * Ce chemin (relatif au dossier de sortie) est-il une création d'Odin RESTÉE TELLE QUELLE ? Il faut que le registre
   * l'ait rangée à ce chemin ET que l'empreinte actuelle du fichier soit celle de sa dernière version rangée : un fichier
   * modifié depuis par le propriétaire n'est plus une création d'Odin (il n'est donc jamais remplacé). `taille` : la
   * taille actuelle du fichier ; si elle diffère, le fichier n'est pas relu (l'empreinte, calculée à la demande, ne
   * l'est qu'à taille égale).
   */
  estCreation(relatif: string, empreinteActuelle: string | (() => string), taille?: number): boolean {
    const r = relatif.toLowerCase();
    const derniere = this.etat.creations.findLast((c) => c.chemin.toLowerCase() === r);
    if (!derniere || (taille !== undefined && taille !== derniere.octets)) return false;
    const e = typeof empreinteActuelle === 'function' ? empreinteActuelle() : empreinteActuelle;
    return Boolean(e && derniere.empreinte === e);
  }
}

// ------------------------------------------------------------------ Branchement sur Alexandrie (comme Théia)
const branchees = new Set<string>();
export function brancherPygmalion(dir: string, recevoir: (m: Miroir) => void = () => {}): void {
  if (branchees.has(dir)) return;
  branchees.add(dir);
  let appli: AppliBase | undefined;
  let dansBase = false;
  quandBase((b) => {
    appli = b.appli(DEF_PYGMALION, dir);
    const pret = () => { dansBase = true; recevoir(appli!); };
    appli.on('prete', pret); if (appli.prete) pret();
  });
  inscrireMigrable({
    id: 'pygmalion', nom: 'Pygmalion',
    etat: () => ({ support: dansBase ? 'base' : 'fichiers', pret: dansBase, attente: appli?.attente.taille ?? 0, message: dansBase ? 'dans la base d\'Odin' : 'en fichier chiffré (passera dans la base dès qu\'elle sera prête)' }),
    attendre: async () => { await appli?.vider().catch((e) => { if (!(e instanceof BaseAttente)) throw e; }); },
    retour: async () => { dansBase = false; return '↩ Pygmalion est revenu en fichier chiffré.'; },
    repasser: async () => (dansBase ? '🗄 Pygmalion est dans la base d\'Odin.' : '⏳ Pygmalion passera dans la base dès qu\'elle sera prête.'),
  });
}
export function oublierBranchementsPygmalion(): void { branchees.clear(); }
