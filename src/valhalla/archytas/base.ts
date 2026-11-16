// Où Archytas range ses scripts. Deux entrepôts, même interface :
//  - EntrepotFichiers : le repli, toujours disponible (fichiers sous <home>/valhalla/archytas/). Le CODE est
//    TOUJOURS chiffré au repos (clé de la machine, src/vault.ts) ; jamais en clair, jamais dans le dépôt. Les
//    résumés (liste, suivi, graphe) ne rendent JAMAIS le code ni les étapes. C'est l'entrepôt des essais.
//  - DEF_ARCHYTAS : le schéma de la base ARCHYTAS_ODIN (Alexandrie) — tables scripts/versions/executions,
//    code chiffré, vues v_scripts/v_usage SANS code ni secret (GRANT au compte de lecture d'Odin). Posé pour
//    que la base soit prête ; l'entrepôt base (EntrepotBase) l'alimente quand elle répond.
//
// Honnête : sans PostgreSQL, Odin tourne sur le repli en fichiers (chiffrés) ; les données passeront dans la
// base par une migration, comme les autres applis.

import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chiffrerChamp, dechiffrerChamp } from '../../vault.ts';
import type { DefAppli } from '../base/index.ts';
import type { Entrepot, ExecutionRangee, RangScript, ScriptDetail, ScriptResume, Version, VersionRangee } from './scripts.ts';
import { statVide } from './usage.ts';

// ---------------------------------------------------------------------------------------------------------
// Le schéma de la base ARCHYTAS_ODIN (Alexandrie). Le code est chiffré (code_chiffre) ; les vues n'exposent
// ni le code ni les étapes ni l'erreur brute.
// ---------------------------------------------------------------------------------------------------------
export const DEF_ARCHYTAS: DefAppli = {
  id: 'archytas',
  migrations: [{
    v: 1, nom: 'scripts, versions et exécutions d\'Archytas',
    sql: `
CREATE TABLE scripts (nom text PRIMARY KEY, mission text NOT NULL, description text NOT NULL DEFAULT '', genre text NOT NULL,
  etapes jsonb, code_chiffre text, declencheurs jsonb NOT NULL DEFAULT '[]', cree bigint NOT NULL, modifie bigint NOT NULL,
  dernier_usage bigint, version int NOT NULL DEFAULT 1, actif boolean NOT NULL DEFAULT true, capacites jsonb NOT NULL DEFAULT '[]',
  runs int NOT NULL DEFAULT 0, ok int NOT NULL DEFAULT 0, echecs int NOT NULL DEFAULT 0, ms_moyen int NOT NULL DEFAULT 0, par text);
CREATE TABLE versions (nom text NOT NULL, version int NOT NULL, code_chiffre text, etapes jsonb, change text NOT NULL DEFAULT '', at bigint NOT NULL, PRIMARY KEY (nom, version));
CREATE TABLE executions (nom text NOT NULL, version int NOT NULL, at bigint NOT NULL, ok boolean NOT NULL, ms int NOT NULL, erreur_masquee text);
CREATE INDEX executions_nom ON executions (nom, at);
-- Les vues qu'Odin (compte de lecture) peut lire : JAMAIS le code, JAMAIS les étapes, JAMAIS l'erreur brute.
CREATE VIEW v_scripts AS SELECT nom, mission, description, genre, version, actif, capacites,
  to_timestamp(cree / 1000.0) AS cree, to_timestamp(modifie / 1000.0) AS modifie, to_timestamp(dernier_usage / 1000.0) AS dernier_usage,
  runs, ok, echecs, ms_moyen FROM scripts;
CREATE VIEW v_usage AS SELECT nom, mission, genre, runs, ok, echecs, ms_moyen, to_timestamp(dernier_usage / 1000.0) AS dernier_usage,
  CASE WHEN runs = 0 THEN 'jamais' WHEN dernier_usage > (extract(epoch from now()) * 1000 - 2592000000) THEN 'recent' ELSE 'ancien' END AS fraicheur FROM scripts;
GRANT SELECT ON v_scripts, v_usage TO odin_lecture`,
  }],
  ecritures: {
    script: `INSERT INTO scripts (nom, mission, description, genre, etapes, code_chiffre, declencheurs, cree, modifie, dernier_usage, version, actif, capacites, runs, ok, echecs, ms_moyen, par)
      SELECT x.nom, x.mission, x.description, x.genre, x.etapes, x.code_chiffre, x.declencheurs, x.cree, x.modifie, x.dernier_usage, x.version, x.actif, x.capacites, x.runs, x.ok, x.echecs, x.ms_moyen, x.par
      FROM jsonb_to_record($1::jsonb) AS x(nom text, mission text, description text, genre text, etapes jsonb, code_chiffre text, declencheurs jsonb, cree bigint, modifie bigint, dernier_usage bigint, version int, actif boolean, capacites jsonb, runs int, ok int, echecs int, ms_moyen int, par text)
      ON CONFLICT (nom) DO UPDATE SET mission = EXCLUDED.mission, description = EXCLUDED.description, genre = EXCLUDED.genre, etapes = EXCLUDED.etapes, code_chiffre = EXCLUDED.code_chiffre, declencheurs = EXCLUDED.declencheurs, modifie = EXCLUDED.modifie, dernier_usage = EXCLUDED.dernier_usage, version = EXCLUDED.version, actif = EXCLUDED.actif, capacites = EXCLUDED.capacites, runs = EXCLUDED.runs, ok = EXCLUDED.ok, echecs = EXCLUDED.echecs, ms_moyen = EXCLUDED.ms_moyen`,
    script_suppr: 'DELETE FROM scripts WHERE nom = $1',
    version: 'INSERT INTO versions (nom, version, code_chiffre, etapes, change, at) VALUES ($1, $2, $3, $4::jsonb, $5, $6) ON CONFLICT (nom, version) DO NOTHING',
    version_suppr: 'DELETE FROM versions WHERE nom = $1',
    execution: 'INSERT INTO executions (nom, version, at, ok, ms, erreur_masquee) VALUES ($1, $2, $3, $4, $5, $6)',
    execution_suppr: 'DELETE FROM executions WHERE nom = $1',
  },
};

// ---------------------------------------------------------------------------------------------------------
// Projection sûre : d'un script rangé, le résumé (jamais le code ni les étapes) et le détail (propriétaire).
// ---------------------------------------------------------------------------------------------------------
export function resumeDe(r: RangScript): ScriptResume {
  return {
    nom: r.nom, mission: r.mission, description: r.description, genre: r.genre, version: r.version, actif: r.actif,
    cree: r.cree, modifie: r.modifie, dernierUsage: r.dernierUsage, declencheurs: r.declencheurs, stat: r.stat, capacites: r.capacites,
  };
}
export function detailDe(r: RangScript): ScriptDetail {
  return { ...resumeDe(r), etapes: r.etapes, code: r.code };
}

// ---------------------------------------------------------------------------------------------------------
// L'entrepôt en fichiers (repli, essais). Code chiffré au repos.
// ---------------------------------------------------------------------------------------------------------
const hash8 = (s: string): string => { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); } return (h >>> 0).toString(36).padStart(7, '0'); };
const slug = (nom: string): string => `${nom.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'script'}-${hash8(nom)}`;

interface RangDisque {
  nom: string; mission: string; description: string; genre: RangScript['genre']; etapes?: RangScript['etapes'];
  codeChiffre?: string; declencheurs: RangScript['declencheurs']; capacites: string[];
  cree: number; modifie: number; dernierUsage?: number; version: number; actif: boolean; stat: RangScript['stat'];
}

export class EntrepotFichiers implements Entrepot {
  private readonly home: string;
  private readonly dir: string;
  private index?: Map<string, string>; // nom -> slug
  private cacheListe?: ScriptResume[]; // les résumés, gardés en mémoire pour ne pas relire le disque à chaque ouverture
  constructor(home: string) { this.home = home; this.dir = join(home, 'valhalla', 'archytas'); }

  private sous(d: string): string { const p = join(this.dir, d); mkdirSync(p, { recursive: true }); return p; }
  private chemin(nom: string): string { return join(this.sous('scripts'), `${this.slugDe(nom)}.json`); }
  private slugDe(nom: string): string { const i = this.charger(); let s = i.get(nom); if (!s) { s = slug(nom); i.set(nom, s); } return s; }

  /** Construit (une fois) l'index nom → slug depuis le dossier des scripts. */
  private charger(): Map<string, string> {
    if (this.index) return this.index;
    const m = new Map<string, string>();
    try { for (const f of readdirSync(this.sous('scripts'))) { if (!f.endsWith('.json')) continue; try { const r = JSON.parse(readFileSync(join(this.sous('scripts'), f), 'utf8')) as RangDisque; if (r?.nom) m.set(r.nom, f.replace(/\.json$/, '')); } catch { /* fichier illisible : ignoré */ } } } catch { /* dossier absent */ }
    this.index = m; return m;
  }
  private ecrireJson(f: string, data: unknown): void { mkdirSync(join(f, '..'), { recursive: true }); const tmp = `${f}.tmp`; writeFileSync(tmp, JSON.stringify(data), { mode: 0o600 }); renameSync(tmp, f); }

  private versDisque(r: RangScript): RangDisque {
    return { nom: r.nom, mission: r.mission, description: r.description, genre: r.genre, etapes: r.etapes, codeChiffre: r.code !== undefined ? chiffrerChamp(this.home, r.code) : undefined, declencheurs: r.declencheurs, capacites: r.capacites, cree: r.cree, modifie: r.modifie, dernierUsage: r.dernierUsage, version: r.version, actif: r.actif, stat: r.stat };
  }
  private depuisDisque(d: RangDisque): RangScript {
    const code = d.codeChiffre !== undefined ? safeDechiffrer(this.home, d.codeChiffre) : undefined;
    return { nom: d.nom, mission: d.mission, description: d.description, genre: d.genre, etapes: d.etapes, code, declencheurs: d.declencheurs ?? [], capacites: d.capacites ?? [], cree: d.cree, modifie: d.modifie, dernierUsage: d.dernierUsage, version: d.version ?? 1, actif: d.actif ?? true, stat: d.stat ?? statVide() };
  }
  private lireDisque(nom: string): RangDisque | undefined {
    const f = this.chemin(nom); if (!existsSync(f)) return undefined;
    try { return JSON.parse(readFileSync(f, 'utf8')) as RangDisque; } catch { return undefined; }
  }

  async lire(nom: string): Promise<RangScript | undefined> { const d = this.lireDisque(nom); return d ? this.depuisDisque(d) : undefined; }
  async voir(nom: string): Promise<ScriptDetail | undefined> { const r = await this.lire(nom); return r ? detailDe(r) : undefined; }
  // UN SEUL balayage du disque (chaque fichier lu une fois), gardé en cache mémoire : ouvrir la fenêtre Script
  // (qui demande liste + suivi + graphe, trois fois `lister`) ne relit plus le disque trois fois, et les
  // ouvertures suivantes ne le relisent plus du tout. Le cache est invalidé dès qu'on pose ou supprime un script.
  async lister(): Promise<ScriptResume[]> {
    if (this.cacheListe) return this.cacheListe.slice();
    const out: ScriptResume[] = [];
    const idx = this.index ?? (this.index = new Map<string, string>());
    const dir = this.sous('scripts');
    try {
      for (const f of readdirSync(dir)) {
        if (!f.endsWith('.json')) continue;
        try { const d = JSON.parse(readFileSync(join(dir, f), 'utf8')) as RangDisque; if (d?.nom) { out.push(resumeDe(this.depuisDisque(d))); idx.set(d.nom, f.replace(/\.json$/, '')); } } catch { /* fichier illisible : ignoré */ }
      }
    } catch { /* dossier absent */ }
    out.sort((a, b) => b.modifie - a.modifie);
    this.cacheListe = out;
    return out.slice();
  }
  async poser(r: RangScript): Promise<void> { this.ecrireJson(this.chemin(r.nom), this.versDisque(r)); this.charger().set(r.nom, this.slugDe(r.nom)); this.cacheListe = undefined; }
  async supprimer(nom: string): Promise<void> {
    const s = this.slugDe(nom);
    rmSync(join(this.sous('scripts'), `${s}.json`), { force: true });
    rmSync(join(this.sous('versions'), `${s}.jsonl`), { force: true });
    rmSync(join(this.sous('executions'), `${s}.jsonl`), { force: true });
    this.charger().delete(nom);
    this.cacheListe = undefined;
  }

  private lignes<T>(d: string, nom: string): T[] {
    const f = join(this.sous(d), `${this.slugDe(nom)}.jsonl`); if (!existsSync(f)) return [];
    return readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l) as T; } catch { return undefined; } }).filter((x): x is T => x !== undefined);
  }
  private ajouterLigne(d: string, nom: string, obj: unknown, garder = 500): void {
    const f = join(this.sous(d), `${this.slugDe(nom)}.jsonl`);
    const avant = existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter(Boolean) : [];
    const tout = [...avant, JSON.stringify(obj)].slice(-garder);
    const tmp = `${f}.tmp`; writeFileSync(tmp, `${tout.join('\n')}\n`, { mode: 0o600 }); renameSync(tmp, f);
  }

  async versions(nom: string): Promise<Version[]> {
    return this.lignes<VersionRangee>('versions', nom).map((v) => ({ version: v.version, change: v.change, at: v.at })).sort((a, b) => b.version - a.version);
  }
  async poserVersion(nom: string, v: VersionRangee): Promise<void> {
    const chiffre: VersionRangee = { version: v.version, change: v.change, at: v.at, etapes: v.etapes, ...(v.code !== undefined ? { code: chiffrerChamp(this.home, v.code) } : {}) };
    this.ajouterLigne('versions', nom, chiffre, 100);
  }
  async lireVersion(nom: string, version: number): Promise<VersionRangee | undefined> {
    const v = this.lignes<VersionRangee>('versions', nom).reverse().find((x) => x.version === version);
    if (!v) return undefined;
    return { version: v.version, change: v.change, at: v.at, etapes: v.etapes, ...(v.code !== undefined ? { code: safeDechiffrer(this.home, v.code) } : {}) };
  }
  async noterExecution(e: ExecutionRangee): Promise<void> { this.ajouterLigne('executions', e.nom, e, 500); }
  async executions(nom?: string, limit = 500): Promise<ExecutionRangee[]> {
    if (nom) return this.lignes<ExecutionRangee>('executions', nom).slice(-limit);
    const out: ExecutionRangee[] = [];
    for (const n of this.charger().keys()) out.push(...this.lignes<ExecutionRangee>('executions', n));
    return out.sort((a, b) => b.at - a.at).slice(0, limit);
  }
}

/** Déchiffre une valeur chiffrée ; si la clé est absente (restauration sans clé), rend un marqueur, jamais une erreur qui casse la liste. */
function safeDechiffrer(home: string, v: string): string {
  try { return dechiffrerChamp(home, v); } catch { return ''; }
}
